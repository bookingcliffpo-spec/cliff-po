import { create } from "zustand";
import { persist } from "zustand/middleware";

import { findModel } from "../catalog";
import type { Surface } from "../catalog/types";
import { browserStorage } from "./browser-storage";

/** Results one press of Generate produces. Models that do not carry a count of
    their own are submitted once per result — every unit is a real platform
    request — so the ceiling is deliberately small. */
export const MAX_BATCH = 4;

export const DEFAULT_MODEL = "seedance-2.5";

type ActiveState = {
  surface: Surface;
  model: string;
  batch: number;
  setModel: (id: string) => void;
  setBatch: (count: number) => void;
};

export const useActive = create<ActiveState>()(
  persist(
    (set) => ({
      surface: "video",
      model: DEFAULT_MODEL,
      batch: 1,
      setModel: (id) => {
        const model = findModel(id) ?? findModel(DEFAULT_MODEL)!;
        set((state) =>
          state.model === model.id && state.surface === model.surface
            ? state
            : { model: model.id, surface: model.surface },
        );
      },
      setBatch: (count) =>
        set((state) => {
          const batch = Math.min(MAX_BATCH, Math.max(1, Math.round(count)));
          return state.batch === batch ? state : { batch };
        }),
    }),
    {
      name: "openhiggsfield.active.v2",
      storage: browserStorage(),
      partialize: (state) => ({ surface: state.surface, model: state.model, batch: state.batch }),
      /* Rehydrated after mount by useHydrateStores, never during the first
         render — the server rendered the defaults, and reading localStorage
         while hydrating would make the client's first render disagree. */
      skipHydration: true,
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const model = findModel(state.model);
        if (!model) state.setModel(DEFAULT_MODEL);
        else if (model.surface !== state.surface) state.setModel(model.id);
        if (!Number.isInteger(state.batch) || state.batch < 1 || state.batch > MAX_BATCH) state.setBatch(1);
      },
    },
  ),
);
