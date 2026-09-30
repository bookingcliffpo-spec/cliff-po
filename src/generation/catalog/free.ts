import type { ModelEntry } from "./types";

/* Models that need no API key. The studio shows only the ones the server has
   enabled (see generation/free/providers.ts). */

export const FREE_ASPECT = ["1:1", "4:3", "3:4", "16:9", "9:16"] as const;

export const freeFlux: ModelEntry = {
  id: "free-flux",
  provider: "pollinations",
  surface: "image",
  label: "Flux · Free",
  roles: {},
  settings: {
    aspectRatio: { type: "enum", values: FREE_ASPECT, default: "1:1" },
    enhancePrompt: { type: "boolean", default: false },
  },
};

export const freeTurbo: ModelEntry = {
  id: "free-turbo",
  provider: "pollinations",
  surface: "image",
  label: "Turbo · Free",
  roles: {},
  settings: {
    aspectRatio: { type: "enum", values: FREE_ASPECT, default: "1:1" },
  },
};

export const localStableDiffusion: ModelEntry = {
  id: "local-sd",
  provider: "local-sd",
  surface: "image",
  label: "Stable Diffusion · Local GPU",
  roles: {},
  settings: {
    aspectRatio: { type: "enum", values: FREE_ASPECT, default: "1:1" },
    steps: { type: "range", min: 10, max: 60, default: 25 },
  },
};

export const demoArt: ModelEntry = {
  id: "demo-art",
  provider: "demo",
  surface: "image",
  label: "Demo · Offline",
  roles: {},
  settings: {
    aspectRatio: { type: "enum", values: FREE_ASPECT, default: "1:1" },
  },
};

/** Pixel size per aspect ratio, around one megapixel. */
export const FREE_SIZES: Record<(typeof FREE_ASPECT)[number], { width: number; height: number }> = {
  "1:1": { width: 1024, height: 1024 },
  "4:3": { width: 1152, height: 864 },
  "3:4": { width: 864, height: 1152 },
  "16:9": { width: 1280, height: 720 },
  "9:16": { width: 720, height: 1280 },
};

export function sizeFor(aspect: unknown): { width: number; height: number } {
  return FREE_SIZES[aspect as keyof typeof FREE_SIZES] ?? FREE_SIZES["1:1"];
}
