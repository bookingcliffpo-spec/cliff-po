import { randomInt } from "node:crypto";

import { sizeFor } from "../catalog/free";
import type { GenerationPlane, ProviderId } from "../catalog/types";
import { isProviderConfigured } from "../config";
import { GenerationError } from "../errors";
import type { GenerationStatus } from "../higgsfield/types";
import { generateLocalSd } from "./local-sd";
import { wangpConfig } from "./wangp-client";

type Env = Record<string, string | undefined>;

export const DEFAULT_POLLINATIONS_BASE = "https://image.pollinations.ai/prompt/";

/** Providers that need no API key, as the server has them configured.

    - pollinations: free hosted image generation, no signup, rate-limited. The
      server only builds the image URL; the visitor's browser loads it.
      On unless FREE_PROVIDERS leaves it out.
    - demo: offline placeholder art drawn by this server. Always free, never
      AI. On unless FREE_PROVIDERS leaves it out.
    - local-sd: your own Stable Diffusion server (AUTOMATIC1111 / Forge /
      SD.Next with --api). Free and unlimited on your GPU. On when
      LOCAL_SD_URL is set. */
export function freeProviders(env: Env = process.env): ProviderId[] {
  const listed = env.FREE_PROVIDERS;
  const enabled =
    listed === undefined
      ? new Set(["pollinations", "demo"])
      : new Set(listed.split(",").map((part) => part.trim().toLowerCase()).filter(Boolean));
  const out: ProviderId[] = [];
  if (enabled.has("pollinations")) out.push("pollinations");
  if (env.LOCAL_SD_URL?.trim()) out.push("local-sd");
  if (wangpConfig(env)) out.push("wangp");
  if (enabled.has("demo")) out.push("demo");
  return out;
}

/** Every provider a request could go to right now. Higgsfield counts as
    available when its API origin is configured — a key can still be added in
    the studio. */
export function availableProviders(env: Env = process.env): ProviderId[] {
  return [...(isProviderConfigured(env) ? (["higgsfield"] as ProviderId[]) : []), ...freeProviders(env)];
}

function pollinationsBase(env: Env): string {
  const raw = env.POLLINATIONS_IMAGE_URL?.trim() || DEFAULT_POLLINATIONS_BASE;
  return raw.endsWith("/") ? raw : `${raw}/`;
}

/* ---------- request ids ----------

   Keyless runs finish inside the submit call, so their request id carries the
   result itself: a status poll (after a reload, say) can answer from the id
   alone, with no database and no second call out. */

const PREFIX = { pollinations: "pl_", demo: "dm_", "local-sd": "sd_" } as const;

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value: string): string | null {
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

export function isFreeRequestId(id: string): boolean {
  return Object.values(PREFIX).some((prefix) => id.startsWith(prefix));
}

function completed(requestId: string, urls: string[]): GenerationStatus {
  return { status: "completed", requestId, images: urls.map((url) => ({ url })) };
}

/** Rebuilds a keyless run's result from its id. Ids that do not decode to a
    URL this server would itself have produced are refused. */
export function statusFromFreeId(id: string, env: Env = process.env): GenerationStatus | null {
  if (id.startsWith(PREFIX.pollinations)) {
    const url = decode(id.slice(PREFIX.pollinations.length));
    return url && url.startsWith(pollinationsBase(env)) ? completed(id, [url]) : null;
  }
  if (id.startsWith(PREFIX.demo)) {
    const url = decode(id.slice(PREFIX.demo.length));
    return url && url.startsWith("/api/demo?") ? completed(id, [url]) : null;
  }
  if (id.startsWith(PREFIX["local-sd"])) {
    const names = id.slice(PREFIX["local-sd"].length).split(".");
    const urls = [];
    for (let i = 0; i + 1 < names.length; i += 2) {
      const name = `${names[i]}.${names[i + 1]}`;
      if (!/^[a-f0-9]{32}\.png$/.test(name)) return null;
      urls.push(`/api/media/${name}`);
    }
    return urls.length ? completed(id, urls) : null;
  }
  return null;
}

/* ---------- generation ---------- */

export function pollinationsUrl(plane: GenerationPlane, seed: number, env: Env = process.env): string {
  const { width, height } = sizeFor(plane.settings.aspectRatio);
  const model = plane.model === "free-turbo" ? "turbo" : "flux";
  const params = new URLSearchParams({
    width: String(width),
    height: String(height),
    seed: String(seed),
    model,
    nologo: "true",
    private: "true",
    ...(plane.settings.enhancePrompt === true ? { enhance: "true" } : {}),
  });
  return `${pollinationsBase(env)}${encodeURIComponent(plane.prompt.text)}?${params}`;
}

export function demoUrl(plane: GenerationPlane, seed: number): string {
  const { width, height } = sizeFor(plane.settings.aspectRatio);
  const params = new URLSearchParams({
    p: plane.prompt.text.slice(0, 280),
    s: String(seed),
    w: String(width),
    h: String(height),
  });
  return `/api/demo?${params}`;
}

/** Runs a keyless model. Returns the finished result: none of these providers
    queue, so there is nothing to poll. */
export async function generateFree(
  plane: GenerationPlane,
  provider: ProviderId,
  deps: { env?: Env; fetch?: typeof fetch } = {},
): Promise<GenerationStatus> {
  const env = deps.env ?? process.env;
  if (!freeProviders(env).includes(provider)) {
    throw new GenerationError(
      "missing_config",
      provider === "local-sd"
        ? "Local Stable Diffusion is not configured — set LOCAL_SD_URL to your AUTOMATIC1111/Forge server started with --api."
        : "This free model is turned off on the server (FREE_PROVIDERS).",
    );
  }
  /* A fresh seed per press, so a batch of four is four different pictures. */
  const seed = randomInt(1, 2_147_483_647);

  if (provider === "pollinations") {
    const url = pollinationsUrl(plane, seed, env);
    const id = `${PREFIX.pollinations}${encode(url)}`;
    return completed(id, [url]);
  }
  if (provider === "demo") {
    const url = demoUrl(plane, seed);
    return completed(`${PREFIX.demo}${encode(url)}`, [url]);
  }
  if (provider === "local-sd") {
    const names = await generateLocalSd(plane, seed, { env, fetch: deps.fetch });
    const id = `${PREFIX["local-sd"]}${names.join(".")}`;
    return completed(id, names.map((name) => `/api/media/${name}`));
  }
  throw new GenerationError("invalid_model", "Invalid model — no free provider for it.");
}
