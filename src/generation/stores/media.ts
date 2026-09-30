import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { MediaItem } from "../catalog/types";
import { browserStorage } from "./browser-storage";

type MediaState = {
  items: MediaItem[];
  add: (item: MediaItem) => void;
  remove: (id: string) => void;
  update: (id: string, patch: Partial<Pick<MediaItem, "tag">>) => void;
};

function createMediaStore(name: string) {
  return create<MediaState>()(
    persist(
      (set) => ({
        items: [],
        add: (item) => set((state) => ({ items: [...state.items, item] })),
        remove: (id) => set((state) => ({ items: state.items.filter((item) => item.id !== id) })),
        update: (id, patch) =>
          set((state) => ({ items: state.items.map((item) => (item.id === id ? { ...item, ...patch } : item)) })),
      }),
      {
        name,
        storage: browserStorage(),
        skipHydration: true,
        partialize: (state) => ({
          items: state.items.filter((item) => !item.url.startsWith("blob:")),
        }),
      },
    ),
  );
}

export const useImageMedia = createMediaStore("openhiggsfield.imageMedia.v1");
export const useVideoMedia = createMediaStore("openhiggsfield.videoMedia.v1");
