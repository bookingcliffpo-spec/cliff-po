import type { ModelEntry } from "./types";
import { SEEDANCE_ASPECT } from "./tokens";

/* Free video on your own GPU through WanGP (github.com/deepbeepmeep/Wan2GP),
   reached via the bridge in bridge/wangp_bridge.py. Each entry mirrors one
   Seedance 2.5 / Cinema Studio / Genjutsu action; adapters/wangp.ts maps it
   onto WanGP models (LTX-2.3, Kiwi-Edit, Wan 2.2 Animate). */

const shape = {
  aspectRatio: { type: "enum", values: SEEDANCE_ASPECT, default: "16:9" },
  resolution: { type: "enum", values: ["480p", "720p"], default: "720p" },
} as const satisfies ModelEntry["settings"];

const duration = { type: "range", min: 4, max: 30, default: 5 } as const;
const output = {
  generateAudio: { type: "boolean", default: true },
  outputFormat: { type: "enum", values: ["mp4", "mov"], default: "mp4" },
} as const satisfies ModelEntry["settings"];

export const wangpCinema: ModelEntry = {
  id: "wangp-cinema",
  provider: "wangp",
  surface: "video",
  label: "Cinema Video · Free GPU",
  roles: { start: 1, end: 1, audio: 1 },
  settings: { ...shape, duration, ...output },
};

export const wangpReference: ModelEntry = {
  id: "wangp-reference",
  provider: "wangp",
  surface: "video",
  label: "Reference to Video · Free GPU",
  roles: { reference: 5, audio: 1 },
  settings: { ...shape, duration, ...output },
};

export const wangpEdit: ModelEntry = {
  id: "wangp-edit",
  provider: "wangp",
  surface: "video",
  label: "Video Edit · Free GPU",
  roles: { video: 1, reference: 1 },
  settings: {
    region: {
      type: "enum",
      values: ["whole", "object", "face", "label", "wardrobe", "background"],
      default: "whole",
    },
    resolution: shape.resolution,
    duration,
    ...output,
  },
};

export const wangpExtend: ModelEntry = {
  id: "wangp-extend",
  provider: "wangp",
  surface: "video",
  label: "Video Extend · Free GPU",
  roles: { video: 1 },
  settings: {
    direction: { type: "enum", values: ["forward", "backward"], default: "forward" },
    resolution: shape.resolution,
    duration: { type: "range", min: 2, max: 20, default: 5 },
    ...output,
  },
};

export const wangpMotion: ModelEntry = {
  id: "wangp-motion",
  provider: "wangp",
  surface: "video",
  label: "Motion Transfer · Free GPU",
  roles: { video: 1, reference: 1 },
  settings: {
    motionMode: { type: "enum", values: ["animate", "replace"], default: "animate" },
    resolution: shape.resolution,
    duration,
    outputFormat: output.outputFormat,
  },
};

/** Genjutsu-style presets. "custom" uses the prompt as the instruction. */
export const SWAP_PRESETS = [
  "custom",
  "swap-character",
  "swap-face",
  "swap-product",
  "swap-outfit",
  "swap-location",
  "swap-object",
  "style-anime",
  "style-claymation",
  "style-pixar",
  "style-watercolor",
  "style-oil-painting",
  "style-comic",
  "style-lego",
  "style-sketch",
  "style-cyberpunk",
  "style-noir",
  "style-vintage-film",
  "style-vaporwave",
  "style-low-poly",
  "style-stop-motion",
  "style-origami",
  "style-marble-statue",
  "style-neon-glow",
  "env-snow",
  "env-rain",
  "env-night",
  "env-sunset",
  "env-underwater",
  "env-desert",
  "env-space",
  "env-jungle",
  "env-city",
] as const;

export const wangpSwap: ModelEntry = {
  id: "wangp-swap",
  provider: "wangp",
  surface: "video",
  label: "Swap & Restyle · Free GPU",
  roles: { video: 1, reference: 1 },
  settings: {
    preset: { type: "enum", values: SWAP_PRESETS, default: "swap-character" },
    preserveMotion: { type: "boolean", default: true },
    preserveCamera: { type: "boolean", default: true },
    preserveTiming: { type: "boolean", default: true },
    preserveBackground: { type: "boolean", default: true },
    resolution: shape.resolution,
    duration,
    outputFormat: output.outputFormat,
  },
};

export const WANGP_MODELS: readonly ModelEntry[] = [
  wangpCinema,
  wangpReference,
  wangpEdit,
  wangpExtend,
  wangpMotion,
  wangpSwap,
];
