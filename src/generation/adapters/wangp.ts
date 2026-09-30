import type { GenerationPlane } from "../catalog/types";
import { GenerationError } from "../errors";
import { withReferenceNotes } from "./references";
import { urls } from "./types";

/** Maps the studio's WanGP models onto WanGP settings
    (github.com/deepbeepmeep/Wan2GP, docs/SETTINGS.md and docs/API.md).

    WanGP infers most mode flags from the media that is supplied (start/end
    images, continuation source, references, audio) — see
    apply_media_flag_defaults in WanGP's shared/api.py — so this module sets
    only the control-video flags it cannot infer. Media stay URLs here; the
    bridge downloads them and swaps in local paths. */

type Env = Record<string, string | undefined>;

export type WanGPTask = {
  settings: Record<string, unknown>;
  /** Post-processing the bridge applies with ffmpeg. */
  post: { stripAudio?: boolean; container?: "mp4" | "mov"; reverseInput?: boolean; reverseOutput?: boolean };
};

/** WanGP model_type per action. Override any of them with WANGP_MODEL_<ACTION>
    (for example WANGP_MODEL_CINEMA=ltx2_22B_distilled_gguf_q4_k_m on a GPU with
    less memory). */
export const WANGP_DEFAULT_MODELS = {
  cinema: "ltx2_22B_distilled", // LTX-2.3: video + native soundtrack, start/end frames, continuation
  reference: "ltx2_22B_msr", // LTX-2.3 MSR: up to 5 subject/background references
  edit: "kiwi_edit", // Kiwi-Edit 5B: instruction + reference video edit
  editInstruct: "kiwi_edit_instruct_only", // Kiwi-Edit 5B: instruction-only video edit
  extend: "ltx2_22B_distilled", // continuation of a source video
  motion: "animate", // Wan 2.2 Animate 14B: motion transfer / person replacement
  swap: "ltx2_22B_distilled_edit_anything", // LTX-2.3 EditAnything: reference-driven replacement
} as const;

export type WanGPAction = keyof typeof WANGP_DEFAULT_MODELS;

export function wangpModel(action: WanGPAction, env: Env = process.env): string {
  const key = `WANGP_MODEL_${action.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`;
  const override = env[key]?.trim();
  return override && /^[A-Za-z0-9._-]+$/.test(override) ? override : WANGP_DEFAULT_MODELS[action];
}

const SIZES: Record<string, Record<string, string>> = {
  "720p": { "16:9": "1280x720", "4:3": "960x720", "1:1": "720x720", "3:4": "720x960", "9:16": "720x1280", "21:9": "1680x720" },
  "480p": { "16:9": "848x480", "4:3": "640x480", "1:1": "480x480", "3:4": "480x640", "9:16": "480x848", "21:9": "1120x480" },
};

export function wangpResolution(resolution: unknown, aspect: unknown): string {
  const table = SIZES[String(resolution)] ?? SIZES["720p"]!;
  return table[String(aspect)] ?? table["16:9"]!;
}

function unsupported(message: string): GenerationError {
  return new GenerationError("unsupported_settings", `Unsupported settings — ${message}`, { status: 400 });
}

function common(plane: GenerationPlane, model: string): Record<string, unknown> {
  const s = plane.settings;
  return {
    model_type: model,
    prompt: plane.prompt.text,
    resolution: wangpResolution(s.resolution, s.aspectRatio),
    ...(typeof s.duration === "number" ? { video_length: `${s.duration}s` } : {}),
    seed: -1,
  };
}

function post(plane: GenerationPlane, extra: Partial<WanGPTask["post"]> = {}): WanGPTask["post"] {
  const s = plane.settings;
  return {
    ...(s.generateAudio === false ? { stripAudio: true } : {}),
    container: s.outputFormat === "mov" ? "mov" : "mp4",
    ...extra,
  };
}

const REGION_PHRASES: Record<string, string> = {
  object: "the targeted object",
  face: "the face",
  label: "the label, sign or on-screen text",
  wardrobe: "the clothing",
  background: "the background",
};

const PRESET_INSTRUCTIONS: Record<string, string> = {
  "swap-character": "Replace the main character with the person in the reference image",
  "swap-face": "Replace the main person's face with the face in the reference image",
  "swap-product": "Replace the product in the video with the product in the reference image",
  "swap-outfit": "Dress the main person in the outfit from the reference image",
  "swap-location": "Move the scene into the location shown in the reference image",
  "swap-object": "Replace the main object with the object in the reference image",
  "style-anime": "Restyle the whole video as hand-drawn anime",
  "style-claymation": "Restyle the whole video as claymation stop-motion",
  "style-pixar": "Restyle the whole video as a 3D animated feature film",
  "style-watercolor": "Restyle the whole video as a flowing watercolor painting",
  "style-oil-painting": "Restyle the whole video as a textured oil painting",
  "style-comic": "Restyle the whole video as an inked comic book",
  "style-lego": "Rebuild the whole scene out of toy bricks",
  "style-sketch": "Restyle the whole video as a pencil sketch",
  "style-cyberpunk": "Restyle the scene as neon cyberpunk",
  "style-noir": "Restyle the video as black-and-white film noir",
  "style-vintage-film": "Restyle the video as scratched vintage film footage",
  "style-vaporwave": "Restyle the video with a vaporwave aesthetic",
  "style-low-poly": "Restyle the scene as low-poly 3D",
  "style-stop-motion": "Restyle the video as felt stop-motion animation",
  "style-origami": "Rebuild the scene out of folded paper origami",
  "style-marble-statue": "Turn the people into living marble statues",
  "style-neon-glow": "Outline everything in glowing neon light",
  "env-snow": "Make it snow heavily in the scene",
  "env-rain": "Make it a rainy scene with wet reflective surfaces",
  "env-night": "Turn the scene into night",
  "env-sunset": "Relight the scene at sunset",
  "env-underwater": "Place the scene underwater",
  "env-desert": "Move the scene into a desert",
  "env-space": "Move the scene into outer space",
  "env-jungle": "Move the scene into a dense jungle",
  "env-city": "Move the scene into a busy city street",
};

export function swapInstruction(plane: GenerationPlane): string {
  const s = plane.settings;
  const preset = String(s.preset ?? "custom");
  const base = preset === "custom" ? plane.prompt.text : PRESET_INSTRUCTIONS[preset] ?? plane.prompt.text;
  const keep: string[] = [];
  if (s.preserveMotion !== false) keep.push("the original motion");
  if (s.preserveCamera !== false) keep.push("the camera movement");
  if (s.preserveTiming !== false) keep.push("the timing");
  if (s.preserveBackground !== false && !preset.startsWith("env-") && preset !== "swap-location") {
    keep.push("the background");
  }
  const extra = preset !== "custom" && plane.prompt.text && plane.prompt.text !== base ? ` ${plane.prompt.text}` : "";
  return `${base}.${extra}${keep.length ? ` Keep ${keep.join(", ")} exactly as in the source video.` : ""}`.replace(
    /\.\./g,
    ".",
  );
}

/** The WanGP job for one plane. */
export function toWanGP(plane: GenerationPlane, env: Env = process.env): WanGPTask {
  const start = urls(plane, "start");
  const end = urls(plane, "end");
  const refs = urls(plane, "reference");
  const videos = urls(plane, "video");
  const audios = urls(plane, "audio");

  switch (plane.model) {
    case "wangp-cinema": {
      if (end.length && !start.length) throw unsupported("an end frame needs a start frame.");
      return {
        settings: {
          ...common(plane, wangpModel("cinema", env)),
          ...(start[0] ? { image_start: start[0] } : {}),
          ...(end[0] ? { image_end: end[0] } : {}),
          /* With an audio reference LTX-2 builds the video on that soundtrack;
             without one it generates the soundtrack itself. */
          ...(audios[0] ? { audio_guide: audios[0] } : {}),
        },
        post: post(plane),
      };
    }

    case "wangp-reference": {
      if (!refs.length) throw unsupported("attach at least one reference image.");
      const items = plane.media.reference ?? [];
      /* A location reference goes first as the background ("KI"); the rest are
         subjects. */
      const location = items.findIndex((item) => item.tag === "location");
      const ordered = location > 0 ? [items[location]!, ...items.filter((_, i) => i !== location)] : items;
      const reordered: GenerationPlane = { ...plane, media: { ...plane.media, reference: ordered } };
      return {
        settings: {
          ...common(reordered, wangpModel("reference", env)),
          prompt: withReferenceNotes(plane.prompt.text, reordered),
          image_refs: ordered.map((item) => item.url),
          video_prompt_type: location >= 0 ? "KI" : "I",
          ...(audios[0] ? { audio_guide: audios[0] } : {}),
        },
        post: post(plane),
      };
    }

    case "wangp-edit": {
      if (!videos[0]) throw unsupported("attach the video to edit.");
      const region = String(plane.settings.region ?? "whole");
      const scope = REGION_PHRASES[region];
      const instruction = scope
        ? `Only change ${scope}: ${plane.prompt.text} Keep everything else in the video identical.`
        : plane.prompt.text;
      const withRef = refs.length > 0;
      return {
        settings: {
          ...common(plane, wangpModel(withRef ? "edit" : "editInstruct", env)),
          prompt: withRef ? withReferenceNotes(instruction, plane) : instruction,
          video_guide: videos[0],
          video_prompt_type: withRef ? "UVI" : "UV",
          ...(withRef ? { image_refs: [refs[0]] } : {}),
        },
        post: post(plane),
      };
    }

    case "wangp-extend": {
      if (!videos[0]) throw unsupported("attach the video to extend.");
      const backward = plane.settings.direction === "backward";
      return {
        settings: {
          ...common(plane, wangpModel("extend", env)),
          /* The continuation source; WanGP sets image_prompt_type "V" and
             returns the source followed by the new frames. */
          video_source: videos[0],
        },
        /* Backward extension: reverse the clip, continue it, reverse back —
           the new footage then leads into the original. Audio is dropped,
           since a reversed soundtrack is unusable. */
        post: post(plane, backward ? { reverseInput: true, reverseOutput: true, stripAudio: true } : {}),
      };
    }

    case "wangp-motion": {
      if (!videos[0]) throw unsupported("attach the video whose motion should be transferred.");
      if (!refs[0]) throw unsupported("attach the character image to animate.");
      const replace = plane.settings.motionMode === "replace";
      return {
        settings: {
          ...common(plane, wangpModel("motion", env)),
          video_guide: videos[0],
          image_refs: [refs[0]],
          /* Wan Animate's own choices: animate the reference with the whole
             control video's motion, or replace the person in the control video. */
          video_prompt_type: replace ? "PVBAIH#" : "PVBKI",
        },
        post: { container: plane.settings.outputFormat === "mov" ? "mov" : "mp4" },
      };
    }

    case "wangp-swap": {
      if (!videos[0]) throw unsupported("attach the source video.");
      const preset = String(plane.settings.preset ?? "custom");
      const needsRef = preset.startsWith("swap-");
      if (needsRef && !refs[0]) throw unsupported("this swap needs a reference image of the replacement.");
      if (preset === "custom" && !plane.prompt.text.trim()) throw unsupported("describe the change to make.");
      return {
        settings: {
          ...common(plane, wangpModel(refs[0] ? "swap" : "editInstruct", env)),
          prompt: swapInstruction(plane),
          video_guide: videos[0],
          ...(refs[0]
            ? { image_refs: [refs[0]], video_prompt_type: "VGI" }
            : { video_prompt_type: "UV" }),
        },
        post: { container: plane.settings.outputFormat === "mov" ? "mov" : "mp4" },
      };
    }
  }
  throw new GenerationError("invalid_model", "Invalid model — no WanGP mapping for it.");
}
