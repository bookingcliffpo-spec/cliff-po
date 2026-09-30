import { sizeFor } from "../catalog/free";
import type { GenerationPlane } from "../catalog/types";
import { GenerationError, timeoutMessage } from "../errors";
import { localMediaDir } from "../storage/config";
import { saveUpload } from "../storage/local";

type Env = Record<string, string | undefined>;

const TIMEOUT_MS = 5 * 60_000;
const MAX_IMAGE_BYTES = 40 * 1024 * 1024;

/** Calls an AUTOMATIC1111-compatible txt2img API (AUTOMATIC1111, Forge,
    SD.Next — started with --api) and stores the PNGs it returns in the local
    media directory. Returns the stored file names. */
export async function generateLocalSd(
  plane: GenerationPlane,
  seed: number,
  deps: { env?: Env; fetch?: typeof fetch },
): Promise<string[]> {
  const env = deps.env ?? process.env;
  const base = env.LOCAL_SD_URL?.trim().replace(/\/+$/, "");
  if (!base) throw new GenerationError("missing_config", "LOCAL_SD_URL is not set.");
  const fetchImpl = deps.fetch ?? fetch;
  const { width, height } = sizeFor(plane.settings.aspectRatio);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchImpl(`${base}/sdapi/v1/txt2img`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: plane.prompt.text,
        width,
        height,
        steps: typeof plane.settings.steps === "number" ? plane.settings.steps : 25,
        seed,
        batch_size: 1,
      }),
      signal: controller.signal,
    });
  } catch {
    throw controller.signal.aborted
      ? new GenerationError("timeout", timeoutMessage(TIMEOUT_MS / 1000))
      : new GenerationError(
          "network_error",
          "Could not reach the local Stable Diffusion server — is it running with --api at LOCAL_SD_URL?",
        );
  } finally {
    clearTimeout(timer);
  }

  const payload = (await response.json().catch(() => null)) as { images?: unknown; detail?: unknown } | null;
  if (!response.ok) {
    const detail = typeof payload?.detail === "string" ? ` — ${payload.detail.slice(0, 200)}` : "";
    throw new GenerationError(
      response.status === 404 ? "missing_config" : "provider_error",
      response.status === 404
        ? "The local Stable Diffusion server has no API — start it with --api."
        : `Local Stable Diffusion failed (${response.status})${detail}`,
      { status: response.status },
    );
  }
  const images = Array.isArray(payload?.images) ? payload.images.filter((item) => typeof item === "string") : [];
  if (images.length === 0) {
    throw new GenerationError("provider_error", "Local Stable Diffusion returned no image.");
  }

  const dir = localMediaDir(env);
  const names: string[] = [];
  for (const image of images as string[]) {
    const bytes = Buffer.from(image.replace(/^data:image\/\w+;base64,/, ""), "base64");
    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        ctrl.enqueue(new Uint8Array(bytes));
        ctrl.close();
      },
    });
    const { name } = await saveUpload(dir, stream, "image/png", MAX_IMAGE_BYTES);
    names.push(name);
  }
  return names;
}
