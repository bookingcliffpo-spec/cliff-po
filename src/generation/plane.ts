import { findModel, getModel, parseSettings } from "./catalog";
import type { GenerationPlane } from "./catalog/types";
import { DEFAULT_MODEL, useActive } from "./stores/active";
import { useImageMedia, useVideoMedia } from "./stores/media";
import { useImagePrompt, useVideoPrompt } from "./stores/prompt";
import { useSettings } from "./stores/settings";
import { buildCinematicPrompt, hasDirection, type Direction } from "./cinema";
import { useDirection } from "./stores/direction";

/** The Director's notes in force for the next video press, or null. */
export function activeDirection(): Direction | null {
  const { surface } = useActive.getState();
  const { enabled, direction } = useDirection.getState();
  return surface === "video" && enabled && hasDirection(direction) ? direction : null;
}

export function assemblePlane(): GenerationPlane {
  const { model: modelId, surface } = useActive.getState();
  const model = findModel(modelId) ?? getModel(DEFAULT_MODEL);
  const text = (surface === "image" ? useImagePrompt : useVideoPrompt).getState().text;
  const items = (surface === "image" ? useImageMedia : useVideoMedia).getState().items;
  const media: GenerationPlane["media"] = {};
  for (const item of items) {
    const max = model.roles[item.role];
    if (!max) continue;
    const list = media[item.role] ?? [];
    if (list.length >= max) continue;
    /* A preview that never finished uploading has no URL the provider can
       fetch; it is left off rather than sent. */
    if (!/^https?:\/\//.test(item.url)) continue;
    list.push(item);
    media[item.role] = list;
  }
  return {
    model: model.id,
    /* The visitor's words plus the Director's notes, for video. */
    prompt: { text: buildCinematicPrompt(text, activeDirection()) },
    media,
    settings: parseSettings(model, useSettings.getState().byModel[model.id] ?? {}, "lenient"),
  };
}
