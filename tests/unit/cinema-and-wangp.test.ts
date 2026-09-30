import { describe, expect, it } from "vitest";

import { toWanGP, swapInstruction, wangpModel, wangpResolution } from "@/generation/adapters/wangp";
import { toPlatform } from "@/generation/adapters";
import { SWAP_PRESETS } from "@/generation/catalog/wangp";
import {
  CAMERAS,
  GENRES,
  LIGHTING,
  PALETTES,
  buildCinematicPrompt,
  directionText,
  hasDirection,
  sanitizeDirection,
} from "@/generation/cinema";
import { freeProviders } from "@/generation/free/providers";
import { cancelRequest, pollStatuses, submitPlane } from "@/generation/service";
import { validatePlane } from "@/generation/validate-plane";

import { fakeFetch, json } from "./helpers";

const IMG = "https://cdn.example.test/a.png";
const IMG2 = "https://cdn.example.test/b.png";
const VID = "https://cdn.example.test/a.mp4";
const WAV = "https://cdn.example.test/a.wav";
const ENV = { WANGP_URL: "http://gpu.local:7870/", WANGP_TOKEN: "bridge-token-123" };

type Media = Partial<Record<"start" | "end" | "reference" | "video" | "audio", Array<string | { url: string; tag: string }>>>;

function plane(model: string, media: Media = {}, settings: Record<string, unknown> = {}, text = "a fox runs") {
  return validatePlane({
    model,
    prompt: { text },
    settings,
    media: Object.fromEntries(
      Object.entries(media).map(([role, list]) => [
        role,
        list!.map((entry, i) => (typeof entry === "string" ? { id: `${role}${i}`, url: entry, role } : { id: `${role}${i}`, role, ...entry })),
      ]),
    ),
  });
}

describe("Director's Panel", () => {
  it("covers the Cinema Studio option sets", () => {
    expect(GENRES.map((g) => g.label)).toEqual(["General", "Action", "Epic", "Drama", "Comedy", "Horror", "Noir"]);
    expect(CAMERAS.map((c) => c.label)).toEqual(expect.arrayContaining(["35mm Film", "8mm Film", "DV Camcorder"]));
    expect(PALETTES.length).toBeGreaterThanOrEqual(50);
    expect(LIGHTING).toHaveLength(6);
  });

  it("leaves the prompt alone when nothing is set", () => {
    expect(hasDirection({})).toBe(false);
    expect(hasDirection({ brightness: 0 })).toBe(false);
    expect(buildCinematicPrompt("  a fox  ", {})).toBe("a fox");
  });

  it("appends readable cinematography notes after the visitor's words", () => {
    const prompt = buildCinematicPrompt("a detective walks into the rain", {
      genre: "noir",
      era: "1970s",
      tempo: "single",
      camera: "35mm",
      lens: "anamorphic",
      aperture: "f1.4",
      move: "helicopter",
      palette: "teal-orange",
      lighting: "low-key",
      lightAngle: "back",
      lightColor: "#ff2040",
      brightness: -1,
      diffusion: 80,
      emotion: 95,
    });
    expect(prompt.startsWith("a detective walks into the rain\n\n")).toBe(true);
    expect(prompt).toContain("film noir mood");
    expect(prompt).toContain("1970s New Hollywood look");
    expect(prompt).toContain("one continuous unbroken take");
    expect(prompt).toContain("shot on 35mm film");
    expect(prompt).toContain("anamorphic lens");
    expect(prompt).toContain("f/1.4");
    expect(prompt).toContain("aerial helicopter shot");
    expect(prompt).toContain("teal-and-orange");
    expect(prompt).toContain("red-tinted backlight");
    expect(prompt).toContain("dim exposure");
    expect(prompt).toContain("heavily diffused");
    expect(prompt).toContain("intense, overwhelming emotion");
  });

  it("drops unknown ids and clamps numbers from saved state", () => {
    expect(sanitizeDirection({ genre: "noir", camera: "<script>", brightness: 9, lightColor: "red" })).toEqual({
      genre: "noir",
      brightness: 2,
    });
    expect(directionText(sanitizeDirection("nope"))).toBe("");
  });
});

describe("reference tags", () => {
  it("are kept on references and turned into prompt notes for Seedance", () => {
    const p = plane("seedance-2.5", { reference: [{ url: IMG, tag: "character" }, { url: IMG2, tag: "product" }] });
    expect(p.media.reference![0]!.tag).toBe("character");
    const mapped = toPlatform(p);
    expect(mapped.body.prompt).toContain("image 1 is the character");
    expect(mapped.body.prompt).toContain("image 2 is the product");
  });

  it("drops unknown tags", () => {
    const p = plane("seedance-2.5", { reference: [{ url: IMG, tag: "hacker" }] });
    expect(p.media.reference![0]!.tag).toBeUndefined();
  });
});

describe("WanGP adapter", () => {
  it("resolution follows quality and aspect ratio", () => {
    expect(wangpResolution("720p", "16:9")).toBe("1280x720");
    expect(wangpResolution("480p", "9:16")).toBe("480x848");
    expect(wangpResolution("720p", "21:9")).toBe("1680x720");
  });

  it("text-to-video with native audio on LTX-2.3", () => {
    const task = toWanGP(plane("wangp-cinema", {}, { duration: 30, aspectRatio: "21:9", resolution: "480p" }), {});
    expect(task.settings).toMatchObject({
      model_type: "ltx2_22B_distilled",
      prompt: "a fox runs",
      resolution: "1120x480",
      video_length: "30s",
    });
    expect(task.post).toEqual({ container: "mp4" });
  });

  it("image-to-video with start and end frames, audio reference, audio off and MOV", () => {
    const task = toWanGP(
      plane("wangp-cinema", { start: [IMG], end: [IMG2], audio: [WAV] }, { generateAudio: false, outputFormat: "mov" }),
      {},
    );
    expect(task.settings).toMatchObject({ image_start: IMG, image_end: IMG2, audio_guide: WAV });
    expect(task.post).toEqual({ stripAudio: true, container: "mov" });
    expect(() => toWanGP(plane("wangp-cinema", { end: [IMG] }), {})).toThrow(/end frame needs a start frame/);
  });

  it("reference-to-video puts a location reference first as the background", () => {
    const task = toWanGP(
      plane("wangp-reference", { reference: [{ url: IMG, tag: "character" }, { url: IMG2, tag: "location" }] }),
      {},
    );
    expect(task.settings).toMatchObject({ model_type: "ltx2_22B_msr", image_refs: [IMG2, IMG], video_prompt_type: "KI" });
    expect(String(task.settings.prompt)).toContain("image 1 is the location");
  });

  it("video edit: instruction-only without a reference, reference-guided with one, regional scope", () => {
    const plain = toWanGP(plane("wangp-edit", { video: [VID] }, {}, "make the car red"), {});
    expect(plain.settings).toMatchObject({ model_type: "kiwi_edit_instruct_only", video_guide: VID, video_prompt_type: "UV" });
    const guided = toWanGP(plane("wangp-edit", { video: [VID], reference: [IMG] }, { region: "wardrobe" }, "this jacket"), {});
    expect(guided.settings).toMatchObject({ model_type: "kiwi_edit", video_prompt_type: "UVI", image_refs: [IMG] });
    expect(String(guided.settings.prompt)).toMatch(/^Only change the clothing: this jacket Keep everything else/);
  });

  it("extend forward continues the source; backward reverses in and out", () => {
    const forward = toWanGP(plane("wangp-extend", { video: [VID] }, { duration: 8 }), {});
    expect(forward.settings).toMatchObject({ video_source: VID, video_length: "8s" });
    const backward = toWanGP(plane("wangp-extend", { video: [VID] }, { direction: "backward" }), {});
    expect(backward.post).toMatchObject({ reverseInput: true, reverseOutput: true, stripAudio: true });
  });

  it("motion transfer uses Wan Animate's own modes", () => {
    const animate = toWanGP(plane("wangp-motion", { video: [VID], reference: [IMG] }), {});
    expect(animate.settings).toMatchObject({ model_type: "animate", video_guide: VID, image_refs: [IMG], video_prompt_type: "PVBKI" });
    const replace = toWanGP(plane("wangp-motion", { video: [VID], reference: [IMG] }, { motionMode: "replace" }), {});
    expect(replace.settings.video_prompt_type).toBe("PVBAIH#");
    expect(() => toWanGP(plane("wangp-motion", { video: [VID] }), {})).toThrow(/character image/);
  });

  it("swap presets: reference swaps, promptless restyles, preservation clauses", () => {
    expect(SWAP_PRESETS.length).toBeGreaterThanOrEqual(30);
    const swap = toWanGP(plane("wangp-swap", { video: [VID], reference: [IMG] }, { preset: "swap-product" }, ""), {});
    expect(swap.settings).toMatchObject({ model_type: "ltx2_22B_distilled_edit_anything", video_prompt_type: "VGI" });
    expect(String(swap.settings.prompt)).toMatch(/^Replace the product.*Keep the original motion, the camera movement, the timing, the background exactly/);
    const style = toWanGP(plane("wangp-swap", { video: [VID] }, { preset: "style-anime", preserveBackground: false }, ""), {});
    expect(style.settings).toMatchObject({ model_type: "kiwi_edit_instruct_only", video_prompt_type: "UV" });
    expect(() => toWanGP(plane("wangp-swap", { video: [VID] }, { preset: "swap-face" }), {})).toThrow(/needs a reference/);
    expect(swapInstruction(plane("wangp-swap", { video: [VID] }, { preset: "env-snow" }, ""))).not.toContain("background");
  });

  it("models can be overridden per action", () => {
    expect(wangpModel("cinema", { WANGP_MODEL_CINEMA: "ltx2_22B_distilled_gguf_q4_k_m" })).toBe("ltx2_22B_distilled_gguf_q4_k_m");
    expect(wangpModel("editInstruct", { WANGP_MODEL_EDIT_INSTRUCT: "x" })).toBe("x");
    expect(wangpModel("cinema", { WANGP_MODEL_CINEMA: "../bad" })).toBe("ltx2_22B_distilled");
  });

  it("allows private media and the bridge's own outputs for WanGP only", () => {
    expect(() => plane("wangp-extend", { video: ["http://192.168.1.10:3000/api/media/x.mp4"] })).not.toThrow();
    expect(() => plane("wangp-extend", { video: ["/api/wangp/files/abc_0.mp4"] })).not.toThrow();
    expect(() => plane("seedance-2.5", { video: ["/api/wangp/files/abc_0.mp4"] })).toThrow(/invalid URL/);
  });
});

describe("WanGP through the service", () => {
  it("is only offered when WANGP_URL is set", () => {
    expect(freeProviders({})).not.toContain("wangp");
    expect(freeProviders(ENV)).toContain("wangp");
  });

  it("submits to the bridge with its token and returns a queued request", async () => {
    const { impl, calls } = fakeFetch([json({ id: "job12345678" })]);
    const result = await submitPlane(
      { model: "wangp-cinema", prompt: { text: "x" }, settings: {}, media: {} },
      { env: ENV, fetch: impl, logger: null },
    );
    expect(result).toEqual({ ok: true, data: { requestId: "wg_job12345678", status: "queued" } });
    expect(calls[0]!.url).toBe("http://gpu.local:7870/v1/jobs");
    expect(calls[0]!.headers.authorization).toBe("Bearer bridge-token-123");
    expect(calls[0]!.body).toMatchObject({ settings: { model_type: "ltx2_22B_distilled" }, post: { container: "mp4" } });
  });

  it("explains a missing WANGP_URL", async () => {
    const result = await submitPlane({ model: "wangp-cinema", prompt: { text: "x" }, settings: {}, media: {} }, { env: {}, logger: null });
    expect(result).toMatchObject({ ok: false, code: "missing_config", error: expect.stringMatching(/WANGP_URL/) });
  });

  it("reports progress, then the finished video through the studio's file route", async () => {
    const { impl } = fakeFetch([
      json({ status: "in_progress", progress: 42, phase: "Denoising", files: [] }),
      json({ status: "completed", progress: 100, files: ["job12345678_0.mp4"] }),
    ]);
    const deps = { env: ENV, fetch: impl, logger: null };
    const first = await pollStatuses({ requestIds: ["wg_job12345678"] }, deps);
    expect(first).toMatchObject({ ok: true, data: [{ status: { status: "in_progress", progress: 42, phase: "Denoising" } }] });
    const second = await pollStatuses({ requestIds: ["wg_job12345678"] }, deps);
    expect(second).toMatchObject({
      ok: true,
      data: [{ status: { status: "completed", video: { url: "/api/wangp/files/job12345678_0.mp4" } } }],
    });
  });

  it("surfaces a failed WanGP job's reason, and a rejected token", async () => {
    const { impl } = fakeFetch([json({ status: "failed", error: "Out of VRAM", files: [] }), json({ error: "no" }, 401)]);
    const deps = { env: ENV, fetch: impl, logger: null };
    expect(await pollStatuses({ requestIds: ["wg_job12345678"] }, deps)).toMatchObject({
      ok: true,
      data: [{ status: { status: "failed", error: "Out of VRAM" } }],
    });
    expect(await pollStatuses({ requestIds: ["wg_job12345678"] }, deps)).toMatchObject({
      ok: true,
      data: [{ code: "invalid_api_key", final: true }],
    });
  });

  it("cancels on the bridge", async () => {
    const { impl, calls } = fakeFetch([json({ ok: true })]);
    expect(await cancelRequest({ requestId: "wg_job12345678" }, { env: ENV, fetch: impl, logger: null })).toEqual({ ok: true, data: null });
    expect(calls[0]!.url).toBe("http://gpu.local:7870/v1/jobs/job12345678/cancel");
    expect(calls[0]!.method).toBe("POST");
  });

  it("cancels on Higgsfield, and treats keyless runs as already finished", async () => {
    const { impl, calls } = fakeFetch([json({})]);
    const env = { HF_API_BASE_URL: "https://api.test", HF_API_KEY: "abc_id:abc_secret" };
    expect(await cancelRequest({ requestId: "req_1" }, { env, fetch: impl, logger: null })).toEqual({ ok: true, data: null });
    expect(calls[0]!.url).toBe("https://api.test/requests/req_1/cancel");
    expect(await cancelRequest({ requestId: "dm_abc" }, { env: {}, logger: null })).toEqual({ ok: true, data: null });
    expect(await cancelRequest({}, { env: {}, logger: null })).toMatchObject({ ok: false, code: "invalid_request" });
  });
});
