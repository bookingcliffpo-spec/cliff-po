import type { GenerationPlane } from "../catalog/types";
import { GenerationError } from "../errors";
import { urls, type Mapped } from "./types";

/** Seedance (ByteDance) request mapping, for 2.0 / 2.0 Fast / 2.0 Mini / 2.5
    and the 2.5 Edit and Extend variants.

    The mode is chosen from the inputs, never from a separate switch:
      - start frame (optional end frame)  → {prefix}/image-to-video
      - reference images / videos / audio → {prefix}/reference-to-video
      - nothing attached                  → {prefix}/text-to-video

    Combinations the provider cannot honour are refused here rather than
    silently dropped — a run that quietly ignores half its inputs still costs
    credits. */

export const SEEDANCE_PATHS = {
  "seedance-2": "bytedance/seedance-2.0",
  "seedance-2-fast": "bytedance/seedance-2.0/fast",
  "seedance-2-mini": "bytedance/seedance-2.0/mini",
  "seedance-2.5": "bytedance/seedance-2.5",
} as const;

export const SEEDANCE_SOURCE_PATHS = {
  "seedance-2.5-edit": { path: "bytedance/seedance-2.5/video-edit", withDuration: false },
  "seedance-2.5-extend": { path: "bytedance/seedance-2.5/video-extend", withDuration: true },
} as const;

export type SeedanceMode = "text-to-video" | "image-to-video" | "reference-to-video";

function unsupported(message: string): GenerationError {
  return new GenerationError("unsupported_settings", `Unsupported settings — ${message}`, { status: 400 });
}

function sharedBody(plane: GenerationPlane, withDuration: boolean): Record<string, unknown> {
  const { settings } = plane;
  return {
    prompt: plane.prompt.text,
    ...(settings.resolution !== undefined ? { resolution: settings.resolution } : {}),
    ...(typeof settings.generateAudio === "boolean" ? { generate_audio: settings.generateAudio } : {}),
    ...(withDuration && typeof settings.duration === "number" ? { duration: settings.duration } : {}),
    ...(settings.outputFormat ? { output_format: settings.outputFormat } : {}),
  };
}

export function seedanceMode(plane: GenerationPlane): SeedanceMode {
  const start = urls(plane, "start");
  const end = urls(plane, "end");
  const refs = [...urls(plane, "reference"), ...urls(plane, "video"), ...urls(plane, "audio")];
  if (end.length && !start.length) throw unsupported("an end frame needs a start frame.");
  if (start.length && refs.length) {
    throw unsupported(
      "Seedance takes either a start/end frame or reference media, not both. Remove one of them.",
    );
  }
  if (start.length) return "image-to-video";
  if (refs.length) return "reference-to-video";
  return "text-to-video";
}

export function mapSeedance(plane: GenerationPlane, prefix: string): Mapped {
  const mode = seedanceMode(plane);
  const shared = sharedBody(plane, true);
  const aspect = plane.settings.aspectRatio ? { aspect_ratio: plane.settings.aspectRatio } : {};

  if (mode === "image-to-video") {
    const [start] = urls(plane, "start");
    const [end] = urls(plane, "end");
    /* The frame decides the shape; sending an aspect ratio beside it makes the
       provider crop or reject. */
    return {
      path: `${prefix}/image-to-video`,
      body: { ...shared, image_url: start, ...(end ? { end_image_url: end } : {}) },
    };
  }

  if (mode === "reference-to-video") {
    const refs = urls(plane, "reference");
    const videos = urls(plane, "video");
    const audios = urls(plane, "audio");
    if (audios.length && !refs.length && !videos.length) {
      throw unsupported("audio references need at least one image or video reference beside them.");
    }
    return {
      path: `${prefix}/reference-to-video`,
      body: {
        ...shared,
        ...aspect,
        ...(refs.length ? { image_urls: refs } : {}),
        ...(videos.length ? { video_urls: videos } : {}),
        ...(audios.length ? { audio_urls: audios } : {}),
      },
    };
  }

  return { path: `${prefix}/text-to-video`, body: { ...shared, ...aspect } };
}

/** Edit and Extend work on an existing clip: exactly one source video, plus
    optional reference images and audio. */
export function mapSeedanceSource(plane: GenerationPlane, path: string, withDuration: boolean): Mapped {
  const videos = urls(plane, "video");
  if (videos.length === 0) throw unsupported("attach the source video to edit or extend.");
  if (videos.length > 1) throw unsupported("only one source video can be edited or extended at a time.");
  if (urls(plane, "start").length || urls(plane, "end").length) {
    throw unsupported("start and end frames are not used when editing or extending a video.");
  }
  const refs = urls(plane, "reference");
  const audios = urls(plane, "audio");
  return {
    path,
    body: {
      ...sharedBody(plane, withDuration),
      video_url: videos[0],
      ...(refs.length ? { image_urls: refs } : {}),
      ...(audios.length ? { audio_urls: audios } : {}),
    },
  };
}
