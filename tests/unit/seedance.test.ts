import { describe, expect, it } from "vitest";

import { toPlatform } from "@/generation/adapters";
import { seedanceMode } from "@/generation/adapters/seedance";
import { getModel } from "@/generation/catalog";
import type { GenerationPlane, MediaRole } from "@/generation/catalog/types";
import { GenerationError } from "@/generation/errors";
import { validatePlane } from "@/generation/validate-plane";

const IMG = "https://cdn.example.test/a.png";
const IMG2 = "https://cdn.example.test/b.png";
const VID = "https://cdn.example.test/a.mp4";
const WAV = "https://cdn.example.test/a.wav";

function plane(
  model: string,
  media: Partial<Record<MediaRole, string[]>> = {},
  settings: Record<string, unknown> = {},
): GenerationPlane {
  return validatePlane({
    model,
    prompt: { text: "a fox in the snow" },
    settings,
    media: Object.fromEntries(
      Object.entries(media).map(([role, list]) => [role, list!.map((url, i) => ({ id: `${role}${i}`, url, role }))]),
    ),
  });
}

describe("Seedance 2.5 catalog entry", () => {
  const entry = getModel("seedance-2.5");

  it("offers 480p/720p, 4–30s, audio toggle, MP4/MOV and provider aspect ratios", () => {
    expect(entry.settings.resolution).toMatchObject({ type: "enum", values: ["480p", "720p"] });
    expect(entry.settings.duration).toMatchObject({ type: "range", min: 4, max: 30 });
    expect(entry.settings.generateAudio).toMatchObject({ type: "boolean" });
    expect(entry.settings.outputFormat).toMatchObject({ type: "enum", values: ["mp4", "mov"] });
    expect(entry.settings.aspectRatio).toMatchObject({
      type: "enum",
      values: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"],
    });
  });

  it("takes start, end, reference, video and audio inputs", () => {
    expect(entry.roles).toEqual({ start: 1, end: 1, reference: 30, video: 10, audio: 10 });
  });
});

describe("Seedance 2.5 mapping", () => {
  it("text-to-video with every setting mapped to provider fields", () => {
    const mapped = toPlatform(
      plane("seedance-2.5", {}, { resolution: "480p", duration: 30, generateAudio: false, outputFormat: "mov", aspectRatio: "21:9" }),
    );
    expect(mapped).toEqual({
      path: "bytedance/seedance-2.5/text-to-video",
      body: {
        prompt: "a fox in the snow",
        resolution: "480p",
        generate_audio: false,
        duration: 30,
        output_format: "mov",
        aspect_ratio: "21:9",
      },
    });
  });

  it("image-to-video from a start image, without an aspect ratio", () => {
    const mapped = toPlatform(plane("seedance-2.5", { start: [IMG] }));
    expect(mapped.path).toBe("bytedance/seedance-2.5/image-to-video");
    expect(mapped.body).toMatchObject({ image_url: IMG, resolution: "720p", duration: 5, output_format: "mp4" });
    expect(mapped.body).not.toHaveProperty("aspect_ratio");
    expect(mapped.body).not.toHaveProperty("end_image_url");
  });

  it("image-to-video with an optional end image", () => {
    const mapped = toPlatform(plane("seedance-2.5", { start: [IMG], end: [IMG2] }));
    expect(mapped.body).toMatchObject({ image_url: IMG, end_image_url: IMG2 });
  });

  it("reference-to-video with image, video and audio reference arrays", () => {
    const mapped = toPlatform(
      plane("seedance-2.5", { reference: [IMG, IMG2], video: [VID], audio: [WAV] }, { aspectRatio: "9:16" }),
    );
    expect(mapped).toEqual({
      path: "bytedance/seedance-2.5/reference-to-video",
      body: expect.objectContaining({
        image_urls: [IMG, IMG2],
        video_urls: [VID],
        audio_urls: [WAV],
        aspect_ratio: "9:16",
        generate_audio: true,
      }),
    });
  });

  it("picks the mode from the inputs", () => {
    expect(seedanceMode(plane("seedance-2.5"))).toBe("text-to-video");
    expect(seedanceMode(plane("seedance-2.5", { start: [IMG] }))).toBe("image-to-video");
    expect(seedanceMode(plane("seedance-2.5", { reference: [IMG] }))).toBe("reference-to-video");
    expect(seedanceMode(plane("seedance-2.5", { video: [VID] }))).toBe("reference-to-video");
  });

  it("refuses an end frame without a start frame", () => {
    expect(() => toPlatform(plane("seedance-2.5", { end: [IMG] }))).toThrow(/end frame needs a start frame/);
  });

  it("refuses frames and references together instead of dropping one silently", () => {
    expect(() => toPlatform(plane("seedance-2.5", { start: [IMG], reference: [IMG2] }))).toThrow(
      /either a start\/end frame or reference media/,
    );
  });

  it("refuses audio references on their own", () => {
    expect(() => toPlatform(plane("seedance-2.5", { audio: [WAV] }))).toThrow(/audio references need/);
  });

  it.each([3, 31, 5.5, "10"])("rejects duration %j", (duration) => {
    expect(() => plane("seedance-2.5", {}, { duration })).toThrow(/Unsupported settings — Seedance 2.5: duration/);
  });

  it.each([4, 30])("accepts duration %i", (duration) => {
    expect(toPlatform(plane("seedance-2.5", {}, { duration })).body.duration).toBe(duration);
  });

  it.each(["1080p", "4k"])("rejects resolution %s", (resolution) => {
    expect(() => plane("seedance-2.5", {}, { resolution })).toThrow(/resolution must be one of 480p, 720p/);
  });

  it("rejects an output format the provider does not produce", () => {
    expect(() => plane("seedance-2.5", {}, { outputFormat: "webm" })).toThrow(/outputFormat/);
  });

  it("rejects more inputs than the model takes", () => {
    expect(() => plane("seedance-2.5", { start: [IMG, IMG2] })).toThrow(/at most 1 start input/);
  });

  it("marks every refusal as an unsupported-settings GenerationError", () => {
    try {
      toPlatform(plane("seedance-2.5", { end: [IMG] }));
    } catch (caught) {
      expect(caught).toBeInstanceOf(GenerationError);
      expect((caught as GenerationError).code).toBe("unsupported_settings");
    }
  });
});

describe("Seedance 2.5 Edit / Extend", () => {
  it("edit sends the source video without a duration", () => {
    const mapped = toPlatform(plane("seedance-2.5-edit", { video: [VID], reference: [IMG] }));
    expect(mapped.path).toBe("bytedance/seedance-2.5/video-edit");
    expect(mapped.body).toMatchObject({ video_url: VID, image_urls: [IMG] });
    expect(mapped.body).not.toHaveProperty("duration");
  });

  it("extend sends the source video with a duration", () => {
    const mapped = toPlatform(plane("seedance-2.5-extend", { video: [VID] }, { duration: 12 }));
    expect(mapped.path).toBe("bytedance/seedance-2.5/video-extend");
    expect(mapped.body).toMatchObject({ video_url: VID, duration: 12 });
  });

  it("requires a source video", () => {
    expect(() => toPlatform(plane("seedance-2.5-edit"))).toThrow(/attach the source video/);
  });
});

describe("Seedance 2.0 family", () => {
  it("maps each variant to its own path prefix", () => {
    expect(toPlatform(plane("seedance-2")).path).toBe("bytedance/seedance-2.0/text-to-video");
    expect(toPlatform(plane("seedance-2-fast", { start: [IMG] })).path).toBe(
      "bytedance/seedance-2.0/fast/image-to-video",
    );
    expect(toPlatform(plane("seedance-2-mini", { reference: [IMG] })).path).toBe(
      "bytedance/seedance-2.0/mini/reference-to-video",
    );
  });

  it("caps Seedance 2.0 at 15 seconds", () => {
    expect(() => plane("seedance-2", {}, { duration: 20 })).toThrow(/between 4 and 15/);
  });
});
