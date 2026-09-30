import { toWanGP } from "../adapters/wangp";
import type { GenerationPlane } from "../catalog/types";
import { GenerationError, redact, timeoutMessage } from "../errors";
import type { GenerationStatus } from "../higgsfield/types";

type Env = Record<string, string | undefined>;

/** Request ids for WanGP jobs: "wg_" + the bridge's job id. */
export const WANGP_PREFIX = "wg_";
const JOB_ID = /^[A-Za-z0-9_-]{8,64}$/;
export const FILE_NAME = /^[A-Za-z0-9._-]{1,200}$/;

export function isWanGPRequestId(id: string): boolean {
  return id.startsWith(WANGP_PREFIX) && JOB_ID.test(id.slice(WANGP_PREFIX.length));
}

export function wangpConfig(env: Env = process.env): { url: string; token: string | null } | null {
  const raw = env.WANGP_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return { url: url.toString().replace(/\/+$/, ""), token: env.WANGP_TOKEN?.trim() || null };
  } catch {
    return null;
  }
}

function requireConfig(env: Env) {
  const config = wangpConfig(env);
  if (!config) {
    throw new GenerationError(
      "missing_config",
      "WanGP is not connected — run bridge/wangp_bridge.py next to WanGP and set WANGP_URL to its address.",
    );
  }
  return config;
}

async function call(
  env: Env,
  method: "GET" | "POST",
  path: string,
  body: unknown,
  deps: { fetch?: typeof fetch; timeoutMs?: number },
): Promise<unknown> {
  const config = requireConfig(env);
  const fetchImpl = deps.fetch ?? fetch;
  const controller = new AbortController();
  const timeoutMs = deps.timeoutMs ?? 30_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(`${config.url}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
      cache: "no-store",
    });
  } catch {
    throw controller.signal.aborted
      ? new GenerationError("timeout", timeoutMessage(Math.round(timeoutMs / 1000)), { retryable: true })
      : new GenerationError(
          "network_error",
          "Could not reach the WanGP bridge — is it running, and is WANGP_URL reachable from the studio server?",
          { retryable: true },
        );
  } finally {
    clearTimeout(timer);
  }
  const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
  if (!response.ok) {
    const detail = typeof payload?.error === "string" ? redact(payload.error.slice(0, 300), [config.token ?? ""]) : "";
    if (response.status === 401 || response.status === 403) {
      throw new GenerationError("invalid_api_key", "The WanGP bridge rejected the token — check WANGP_TOKEN.", {
        status: response.status,
      });
    }
    if (response.status === 404) {
      throw new GenerationError("not_found", detail || "The WanGP bridge does not know this job.", { status: 404 });
    }
    if (response.status === 400 || response.status === 422) {
      throw new GenerationError("unsupported_settings", `Unsupported settings — ${detail || "WanGP rejected the job."}`, {
        status: response.status,
      });
    }
    throw new GenerationError(
      "provider_unavailable",
      `WanGP bridge error (${response.status})${detail ? ` — ${detail}` : ""}`,
      { status: response.status, retryable: response.status >= 500 },
    );
  }
  return payload;
}

/** Queues a WanGP job. Returns its request id. */
export async function submitWanGP(
  plane: GenerationPlane,
  deps: { env?: Env; fetch?: typeof fetch } = {},
): Promise<string> {
  const env = deps.env ?? process.env;
  const task = toWanGP(plane, env);
  const payload = (await call(env, "POST", "/v1/jobs", task, deps)) as { id?: unknown } | null;
  const id = typeof payload?.id === "string" ? payload.id : "";
  if (!JOB_ID.test(id)) {
    throw new GenerationError("provider_error", "The WanGP bridge accepted the job but returned no job id.");
  }
  return `${WANGP_PREFIX}${id}`;
}

type BridgeJob = {
  status?: unknown;
  progress?: unknown;
  phase?: unknown;
  error?: unknown;
  files?: unknown;
};

/** The studio's view of one WanGP job. Output files are served through
    /api/wangp/files so the browser never needs the bridge's address or token. */
export async function statusWanGP(
  requestId: string,
  deps: { env?: Env; fetch?: typeof fetch } = {},
): Promise<GenerationStatus> {
  const env = deps.env ?? process.env;
  const id = requestId.slice(WANGP_PREFIX.length);
  const job = ((await call(env, "GET", `/v1/jobs/${id}`, undefined, deps)) ?? {}) as BridgeJob;
  const status = typeof job.status === "string" ? job.status : "unknown";
  const files = Array.isArray(job.files)
    ? job.files.filter((name): name is string => typeof name === "string" && FILE_NAME.test(name))
    : [];
  const video = files.find((name) => /\.(mp4|mov|webm|mkv)$/i.test(name));
  const images = files.filter((name) => /\.(png|jpe?g|webp)$/i.test(name));
  const progress = typeof job.progress === "number" && Number.isFinite(job.progress) ? job.progress : undefined;
  return {
    status,
    requestId,
    ...(video ? { video: { url: `/api/wangp/files/${video}` } } : {}),
    ...(!video && images.length ? { images: images.map((name) => ({ url: `/api/wangp/files/${name}` })) } : {}),
    ...(typeof job.error === "string" && job.error ? { error: job.error.slice(0, 300) } : {}),
    ...(progress !== undefined ? { progress: Math.max(0, Math.min(100, progress)) } : {}),
    ...(typeof job.phase === "string" && job.phase ? { phase: job.phase.slice(0, 80) } : {}),
  };
}

export async function cancelWanGP(requestId: string, deps: { env?: Env; fetch?: typeof fetch } = {}): Promise<void> {
  const env = deps.env ?? process.env;
  await call(env, "POST", `/v1/jobs/${requestId.slice(WANGP_PREFIX.length)}/cancel`, {}, deps);
}

/** Streams one output file from the bridge, for the /api/wangp/files route. */
export async function fetchWanGPFile(
  name: string,
  range: string | null,
  deps: { env?: Env; fetch?: typeof fetch } = {},
): Promise<Response | null> {
  if (!FILE_NAME.test(name)) return null;
  const config = wangpConfig(deps.env ?? process.env);
  if (!config) return null;
  try {
    const response = await (deps.fetch ?? fetch)(`${config.url}/v1/files/${encodeURIComponent(name)}`, {
      headers: {
        ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
        ...(range ? { Range: range } : {}),
      },
      cache: "no-store",
    });
    return response.ok || response.status === 206 ? response : null;
  } catch {
    return null;
  }
}
