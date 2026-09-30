import { dop } from "./dop";
import { flux2 } from "./flux-2";
import { demoArt, freeFlux, freeTurbo, localStableDiffusion } from "./free";
import { WANGP_MODELS } from "./wangp";
import { flux3 } from "./flux-3";
import { grokImagine2 } from "./grok-imagine-2";
import { grokImagineVideo15 } from "./grok-imagine-video-1.5";
import { happyHorse1 } from "./happy-horse-1";
import { happyHorse11 } from "./happy-horse-1.1";
import { ideogram4 } from "./ideogram-4";
import { kling25 } from "./kling-2.5";
import { kling26 } from "./kling-2.6";
import {
  kling34k,
  kling3MotionPro,
  kling3MotionStd,
  kling3Pro,
  kling3Std,
  kling3Turbo,
} from "./kling-3";
import { klingO1 } from "./kling-o1";
import { klingO3 } from "./kling-o3";
import { ltx25Fast } from "./ltx-2.5-fast";
import { ltx25Pro } from "./ltx-2.5-pro";
import { minimaxH3 } from "./minimax-h3";
import { minimaxHailuo23 } from "./minimax-hailuo-2.3";
import { InvalidSettingError, parseSettings } from "./parse-settings";
import { pixverse6 } from "./pixverse-6";
import { qwenImage3 } from "./qwen-image-3";
import { recraft41 } from "./recraft-4.1";
import { seedance2, seedance2Fast, seedance2Mini } from "./seedance-2";
import { seedance25, seedance25Edit, seedance25Extend } from "./seedance-2.5";
import { soul2, soulCinema } from "./soul";
import type { ModelEntry, ProviderId } from "./types";
import { wan26 } from "./wan-2.6";
import { wan27 } from "./wan-2.7";
import { wan3 } from "./wan-3";
import { wan3Prime } from "./wan-3-prime";
import { zImageTurbo } from "./z-image-turbo";

export const MODELS: readonly ModelEntry[] = [
  freeFlux,
  freeTurbo,
  localStableDiffusion,
  demoArt,
  ...WANGP_MODELS,
  soul2,
  soulCinema,
  seedance25,
  seedance25Edit,
  seedance25Extend,
  seedance2,
  seedance2Fast,
  seedance2Mini,
  kling3Turbo,
  kling3Std,
  kling3Pro,
  kling34k,
  kling3MotionStd,
  kling3MotionPro,
  flux2,
  grokImagine2,
  ideogram4,
  recraft41,
  qwenImage3,
  zImageTurbo,
  wan3,
  wan3Prime,
  wan27,
  wan26,
  flux3,
  minimaxH3,
  minimaxHailuo23,
  happyHorse1,
  happyHorse11,
  kling26,
  kling25,
  klingO3,
  klingO1,
  ltx25Fast,
  ltx25Pro,
  grokImagineVideo15,
  pixverse6,
  dop,
];

export function providerOf(model: ModelEntry): ProviderId {
  return model.provider ?? "higgsfield";
}

export function findModel(id: unknown): ModelEntry | undefined {
  return typeof id === "string" ? MODELS.find((entry) => entry.id === id) : undefined;
}

export function getModel(id: string): ModelEntry {
  const model = findModel(id);
  if (!model) throw new Error(`Unknown model: ${id}`);
  return model;
}

export type { GenerationPlane, MediaItem, MediaRole, ModelEntry, PlatformPaths, ProviderId, ReferenceTag, Surface } from "./types";
export { REFERENCE_TAGS } from "./types";
export { InvalidSettingError, parseSettings };

/** Whether a press needs words. Image-to-video animates a start frame on its
    own, motion transfer and extension take their direction from the source
    clip, and swap presets carry their own instruction. */
export function promptRequired(
  model: ModelEntry,
  media: Partial<Record<string, unknown[]>>,
  settings: Record<string, unknown>,
): boolean {
  const has = (role: string) => (media[role]?.length ?? 0) > 0;
  if (model.id === "wangp-swap") return settings.preset === "custom";
  if (model.id === "wangp-motion" || model.id === "wangp-extend") return false;
  if (model.surface === "video" && model.roles.start && has("start")) return false;
  return true;
}
