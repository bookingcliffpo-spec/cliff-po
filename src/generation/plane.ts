import { findModel, getModel, parseSettings } from "./catalog";
import type { GenerationPlane } from "./catalog/types";
import { DEFAULT_MODEL, useActive } from "./stores/active";
import { useImageMedia, useVideoMedia } from "./stores/media";
import { useImagePrompt, useVideoPrompt } from "./stores/prompt";
import { useSettings } from "./stores/settings";

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
    prompt: { text },
    media,
    settings: parseSettings(model, useSettings.getState().byModel[model.id] ?? {}, "lenient"),
  };
}
