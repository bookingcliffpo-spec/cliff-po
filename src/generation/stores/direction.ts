import { create } from "zustand";
import { persist } from "zustand/middleware";

import { sanitizeDirection, type Direction } from "../cinema";
import { browserStorage } from "./browser-storage";

type DirectionState = {
  /** Whether the Director's notes are added to video prompts. */
  enabled: boolean;
  direction: Direction;
  setEnabled: (enabled: boolean) => void;
  set: (patch: Direction) => void;
  replace: (direction: Direction) => void;
  reset: () => void;
};

export const useDirection = create<DirectionState>()(
  persist(
    (set) => ({
      enabled: true,
      direction: {},
      setEnabled: (enabled) => set({ enabled }),
      set: (patch) => set((state) => ({ direction: sanitizeDirection({ ...state.direction, ...patch }) })),
      replace: (direction) => set({ direction: sanitizeDirection(direction) }),
      reset: () => set({ direction: {} }),
    }),
    {
      name: "openhiggsfield.direction.v1",
      storage: browserStorage(),
      skipHydration: true,
      partialize: (state) => ({ enabled: state.enabled, direction: state.direction }),
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<DirectionState>;
        return {
          ...current,
          enabled: typeof saved.enabled === "boolean" ? saved.enabled : current.enabled,
          direction: sanitizeDirection(saved.direction),
        };
      },
    },
  ),
);
