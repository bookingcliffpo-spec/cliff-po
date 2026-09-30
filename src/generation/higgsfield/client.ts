import { toAuthorizationHeader } from "../credentials";
import { GenerationError, MESSAGES, redact, timeoutMessage } from "../errors";
import { providerError } from "./provider-errors";
import type { GenerationStatus, QueuedGeneration } from "./types";

const MODEL_PATH = /^[a-z0-9][a-z0-9._/-]*$/i;

export const SUBMIT_TIMEOUT_MS = 60_000;
export const STATUS_TIMEOUT_MS = 20_000;
/** Longest wait a Retry-After header may ask of us inside one call. Anything
    longer is handed back to the caller as a rate-limit failure. */
const MAX_RETRY_AFTER_MS = 8_000;

export type Logger = Pick<Console, "info" | "warn">;

export type HiggsfieldClientOptions = {
  apiKey: string;
  baseUrl: string;
  fetch?: typeof fetch;
  submitTimeoutMs?: number;
  statusTimeoutMs?: number;
  /** Extra attempts for calls that are safe to repeat. */
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
  logger?: Logger | null;
};

type CallOptions = { signal?: AbortSignal };

export function isModelPath(path: string): boolean {
  return MODEL_PATH.test(path) && !path.includes("..") && !path.includes("//");
}

export function createHiggsfieldClient(options: HiggsfieldClientOptions) {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const fetchImpl = options.fetch ?? fetch;
  const auth = toAuthorizationHeader(options.apiKey);
  const secrets = [options.apiKey];
  const retries = Math.max(0, options.retries ?? 2);
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const logger = options.logger === undefined ? console : options.logger;

  /** One HTTP exchange with timeout and abort. Never logs headers or bodies:
      bodies carry prompts and media URLs, and headers carry the key. */
  async function exchange(
    method: "GET" | "POST",
    path: string,
    body: Record<string, unknown> | undefined,
    timeoutMs: number,
    signal: AbortSignal | undefined,
  ): Promise<unknown> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onAbort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener("abort", onAbort, { once: true });

    const started = Date.now();
    try {
      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}${path}`, {
          method,
          headers: {
            Authorization: auth,
            Accept: "application/json",
            ...(body ? { "Content-Type": "application/json" } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal: controller.signal,
          cache: "no-store",
        });
      } catch (caught) {
        if (timedOut) {
          throw new GenerationError("timeout", timeoutMessage(Math.round(timeoutMs / 1000)), {
            retryable: true,
          });
        }
        if (signal?.aborted) throw new GenerationError("network_error", "Request canceled.");
        throw new GenerationError("network_error", MESSAGES.network, { retryable: true, cause: caught });
      }

      const payload = await readPayload(response);
      if (timedOut) {
        throw new GenerationError("timeout", timeoutMessage(Math.round(timeoutMs / 1000)), {
          retryable: true,
        });
      }
      logger?.info("[higgsfield]", method, redact(path, secrets), response.status, `${Date.now() - started}ms`);
      if (!response.ok) {
        const error = providerError(response.status, payload, secrets);
        (error as GenerationError & { retryAfterMs?: number }).retryAfterMs = retryAfter(response);
        throw error;
      }
      return payload;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  /** Repeats a call while the failure says repeating is safe. `idempotent`
      decides what counts: a GET may be repeated after any transient failure,
      but a POST that may have reached the provider could start a second paid
      run, so it is only repeated after a 429 — the one answer that promises
      nothing was accepted. */
  async function withRetry<T>(idempotent: boolean, signal: AbortSignal | undefined, run: () => Promise<T>) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await run();
      } catch (caught) {
        if (!(caught instanceof GenerationError) || attempt >= retries || signal?.aborted) throw caught;
        const safe = idempotent ? caught.retryable : caught.code === "rate_limited";
        if (!safe) throw caught;
        const hinted = (caught as GenerationError & { retryAfterMs?: number }).retryAfterMs;
        if (hinted !== undefined && hinted > MAX_RETRY_AFTER_MS) throw caught;
        const backoff = hinted ?? Math.min(4_000, 400 * 2 ** attempt) + Math.floor(Math.random() * 150);
        logger?.warn("[higgsfield] retrying after", caught.code, `${backoff}ms`);
        await sleep(backoff);
      }
    }
  }

  return {
    async submit(
      modelPath: string,
      input: Record<string, unknown>,
      call: CallOptions = {},
    ): Promise<QueuedGeneration> {
      const path = modelPath.replace(/^\/+/, "");
      if (!isModelPath(path)) throw new GenerationError("invalid_model", MESSAGES.invalidModel, { status: 400 });
      const payload = await withRetry(false, call.signal, () =>
        exchange("POST", `/${path}`, input, options.submitTimeoutMs ?? SUBMIT_TIMEOUT_MS, call.signal),
      );
      return mapQueued(payload);
    },

    /** Asks the provider to stop a queued or running request. Best effort:
        a request that already finished simply stays finished. */
    async cancel(requestId: string, call: CallOptions = {}): Promise<void> {
      if (!requestId) throw new GenerationError("invalid_request", "Missing request id.", { status: 400 });
      await exchange(
        "POST",
        `/requests/${encodeURIComponent(requestId)}/cancel`,
        {},
        options.statusTimeoutMs ?? STATUS_TIMEOUT_MS,
        call.signal,
      );
    },

    async status(requestId: string, call: CallOptions = {}): Promise<GenerationStatus> {
      if (!requestId) throw new GenerationError("invalid_request", "Missing request id.", { status: 400 });
      const payload = await withRetry(true, call.signal, () =>
        exchange(
          "GET",
          `/requests/${encodeURIComponent(requestId)}/status`,
          undefined,
          options.statusTimeoutMs ?? STATUS_TIMEOUT_MS,
          call.signal,
        ),
      );
      return mapStatus(payload, requestId);
    },
  };
}

export type HiggsfieldClient = ReturnType<typeof createHiggsfieldClient>;

/* ---------- response mapping ---------- */

function mapQueued(payload: unknown): QueuedGeneration {
  const data = asRecord(payload);
  const requestId = stringField(data, "request_id") ?? stringField(data, "requestId") ?? stringField(data, "id");
  if (!requestId) {
    throw new GenerationError("provider_error", "The provider accepted the request but returned no request id.", {
      status: 502,
    });
  }
  return {
    status: normalizeStatus(stringField(data, "status") ?? "queued"),
    requestId,
  };
}

const STATUS_ALIASES: Record<string, string> = {
  complete: "completed",
  succeeded: "completed",
  success: "completed",
  done: "completed",
  cancelled: "canceled",
  error: "failed",
  errored: "failed",
  in_queue: "queued",
  pending: "queued",
  processing: "in_progress",
  running: "in_progress",
};

export function normalizeStatus(raw: string): string {
  const key = raw.trim().toLowerCase();
  return STATUS_ALIASES[key] ?? key;
}

export function mapStatus(payload: unknown, fallbackId: string): GenerationStatus {
  const data = asRecord(payload);
  const images = Array.isArray(data.images)
    ? data.images.flatMap((item) => {
        const url = typeof item === "string" ? item : asRecord(item).url;
        return typeof url === "string" && url ? [{ url }] : [];
      })
    : [];
  const videos = Array.isArray(data.videos)
    ? data.videos.flatMap((item) => {
        const url = asRecord(item).url;
        return typeof url === "string" && url ? [url] : [];
      })
    : [];
  const single = asRecord(data.video).url;
  const videoUrl = typeof single === "string" && single ? single : videos[0];
  const error = errorText(data.error);

  return {
    status: normalizeStatus(stringField(data, "status") ?? "unknown"),
    /* The id we asked about is the id the rows are keyed by; a status payload
       that spells it differently must not fork the record. */
    requestId: fallbackId,
    ...(images.length ? { images } : {}),
    ...(videoUrl ? { video: { url: videoUrl } } : {}),
    ...(error ? { error } : {}),
  };
}

function errorText(value: unknown): string | undefined {
  if (typeof value === "string" && value) return value.slice(0, 240);
  const record = asRecord(value);
  const message = record.message ?? record.detail;
  return typeof message === "string" && message ? message.slice(0, 240) : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key];
  return typeof field === "string" && field ? field : undefined;
}

/** Bodies are read as text first so an HTML error page or an empty 204 cannot
    throw from JSON.parse. */
async function readPayload(response: Response): Promise<unknown> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    return null;
  }
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text.slice(0, 2_000);
  }
}

function retryAfter(response: Response): number | undefined {
  const header = response.headers.get("retry-after");
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}
