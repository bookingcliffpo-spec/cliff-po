import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { demoSvg } from "@/generation/free/demo-art";
import {
  availableProviders,
  freeProviders,
  isFreeRequestId,
  pollinationsUrl,
  statusFromFreeId,
} from "@/generation/free/providers";
import { pollStatuses, submitPlane } from "@/generation/service";
import { validatePlane } from "@/generation/validate-plane";

import { fakeFetch, json } from "./helpers";

const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const plane = (model: string, settings: Record<string, unknown> = {}, text = "a red fox in snow") =>
  validatePlane({ model, prompt: { text }, settings, media: {} });

describe("which providers are available", () => {
  it("offers free images and the offline demo with nothing configured", () => {
    expect(freeProviders({})).toEqual(["pollinations", "demo"]);
    expect(availableProviders({})).toEqual(["pollinations", "demo"]);
  });

  it("adds Higgsfield when its origin is set and local SD when its URL is set", () => {
    expect(availableProviders({ HF_API_BASE_URL: "https://api.test", LOCAL_SD_URL: "http://gpu:7860" })).toEqual([
      "higgsfield",
      "pollinations",
      "local-sd",
      "demo",
    ]);
  });

  it("lets FREE_PROVIDERS switch the hosted and demo providers off", () => {
    expect(freeProviders({ FREE_PROVIDERS: "" })).toEqual([]);
    expect(freeProviders({ FREE_PROVIDERS: "demo" })).toEqual(["demo"]);
  });
});

describe("free submit with no API key at all", () => {
  it("Pollinations: returns a finished run with a keyless image URL", async () => {
    const { impl, calls } = fakeFetch([]);
    const result = await submitPlane(
      { model: "free-flux", prompt: { text: "a red fox in snow" }, settings: { aspectRatio: "16:9" }, media: {} },
      { env: {}, fetch: impl, logger: null },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(calls).toHaveLength(0);
    const url = result.data.result!.images![0]!.url;
    expect(url).toMatch(/^https:\/\/image\.pollinations\.ai\/prompt\/a%20red%20fox%20in%20snow\?/);
    const params = new URL(url).searchParams;
    expect(params.get("width")).toBe("1280");
    expect(params.get("height")).toBe("720");
    expect(params.get("model")).toBe("flux");
    expect(params.get("nologo")).toBe("true");
    expect(result.data.status).toBe("completed");
  });

  it("uses a fresh seed per press so a batch is not four copies", async () => {
    const deps = { env: {}, logger: null };
    const seeds = new Set<string>();
    for (let i = 0; i < 4; i++) {
      const result = await submitPlane(
        { model: "free-turbo", prompt: { text: "x" }, settings: {}, media: {} },
        deps,
      );
      if (result.ok) seeds.add(new URL(result.data.result!.images![0]!.url).searchParams.get("seed")!);
    }
    expect(seeds.size).toBe(4);
  });

  it("maps Turbo and prompt enhancement", () => {
    const url = new URL(pollinationsUrl(plane("free-flux", { enhancePrompt: true }), 7, {}));
    expect(url.searchParams.get("enhance")).toBe("true");
    expect(new URL(pollinationsUrl(plane("free-turbo"), 7, {})).searchParams.get("model")).toBe("turbo");
  });

  it("demo: returns a local placeholder image", async () => {
    const result = await submitPlane({ model: "demo-art", prompt: { text: "hello" }, settings: {}, media: {} }, { env: {}, logger: null });
    expect(result.ok && result.data.result!.images![0]!.url).toMatch(/^\/api\/demo\?p=hello&s=\d+&w=1024&h=1024$/);
  });

  it("refuses a free provider the server has turned off", async () => {
    const result = await submitPlane(
      { model: "free-flux", prompt: { text: "x" }, settings: {}, media: {} },
      { env: { FREE_PROVIDERS: "demo" }, logger: null },
    );
    expect(result).toMatchObject({ ok: false, code: "missing_config" });
  });

  it("still requires a key for the paid models", async () => {
    const result = await submitPlane(
      { model: "soul-2", prompt: { text: "x" }, settings: {}, media: {} },
      { env: { HF_API_BASE_URL: "https://api.test" }, logger: null },
    );
    expect(result).toMatchObject({ ok: false, code: "missing_api_key" });
  });
});

describe("local Stable Diffusion", () => {
  let dir: string | null = null;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = null;
  });

  it("calls txt2img and stores the PNG it returns", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "ohf-sd-"));
    const { impl, calls } = fakeFetch([json({ images: [PNG_B64] })]);
    const env = { LOCAL_SD_URL: "http://gpu.local:7860/", LOCAL_UPLOAD_DIR: dir };
    const result = await submitPlane(
      { model: "local-sd", prompt: { text: "castle" }, settings: { aspectRatio: "3:4", steps: 30 }, media: {} },
      { env, fetch: impl, logger: null },
    );
    expect(calls[0]!.url).toBe("http://gpu.local:7860/sdapi/v1/txt2img");
    expect(calls[0]!.body).toMatchObject({ prompt: "castle", width: 864, height: 1152, steps: 30, batch_size: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const url = result.data.result!.images![0]!.url;
    expect(url).toMatch(/^\/api\/media\/[a-f0-9]{32}\.png$/);
    expect(await readdir(dir)).toEqual([url.split("/").pop()]);
    /* A reload can recover the run from its id alone. */
    expect(statusFromFreeId(result.data.requestId, env)).toMatchObject({ status: "completed", images: [{ url }] });
  });

  it("explains an unreachable server and a server started without --api", async () => {
    const env = { LOCAL_SD_URL: "http://gpu.local:7860" };
    const down = await submitPlane(
      { model: "local-sd", prompt: { text: "x" }, settings: {}, media: {} },
      { env, fetch: fakeFetch([new TypeError("fetch failed")]).impl, logger: null },
    );
    expect(down).toMatchObject({ ok: false, error: expect.stringMatching(/running with --api/) });
    const noApi = await submitPlane(
      { model: "local-sd", prompt: { text: "x" }, settings: {}, media: {} },
      { env, fetch: fakeFetch([json({ detail: "Not Found" }, 404)]).impl, logger: null },
    );
    expect(noApi).toMatchObject({ ok: false, error: expect.stringMatching(/start it with --api/) });
  });

  it("is refused when LOCAL_SD_URL is not set", async () => {
    const result = await submitPlane({ model: "local-sd", prompt: { text: "x" }, settings: {}, media: {} }, { env: {}, logger: null });
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/LOCAL_SD_URL/) });
  });
});

describe("status polling for keyless runs", () => {
  it("answers from the id without a key or a network call", async () => {
    const submitted = await submitPlane({ model: "demo-art", prompt: { text: "x" }, settings: {}, media: {} }, { env: {}, logger: null });
    if (!submitted.ok) throw new Error("submit failed");
    const id = submitted.data.requestId;
    expect(isFreeRequestId(id)).toBe(true);
    const { impl, calls } = fakeFetch([]);
    const result = await pollStatuses({ requestIds: [id] }, { env: {}, fetch: impl, logger: null });
    expect(result).toMatchObject({ ok: true, data: [{ requestId: id, status: { status: "completed" } }] });
    expect(calls).toHaveLength(0);
  });

  it("refuses ids that decode to URLs it would not have produced", () => {
    const forged = `pl_${Buffer.from("https://evil.example/x.png").toString("base64url")}`;
    expect(statusFromFreeId(forged, {})).toBeNull();
    expect(statusFromFreeId("sd_../../etc.passwd", {})).toBeNull();
  });
});

describe("demo art", () => {
  it("is deterministic, escaped, and labelled as not AI", () => {
    const svg = demoSvg('<script>alert("x")</script> & more', 42, 640, 480);
    expect(svg).toBe(demoSvg('<script>alert("x")</script> & more', 42, 640, 480));
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("DEMO · NOT AI");
    expect(svg).toContain('width="640"');
  });
});
