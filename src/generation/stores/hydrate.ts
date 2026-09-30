"use client";

import { useEffect, useState } from "react";

import { useActive } from "./active";
import { useDirection } from "./direction";
import { useImageMedia, useVideoMedia } from "./media";
import { useImagePrompt, useVideoPrompt } from "./prompt";
import { useSettings } from "./settings";

const STORES = [useActive, useImageMedia, useVideoMedia, useImagePrompt, useVideoPrompt, useSettings, useDirection];

/** Reads the persisted studio state after the first client render. Every store
    is created with skipHydration, so server HTML and the hydrating client both
    render the defaults; the saved model, prompt and dials arrive one commit
    later instead of as a hydration mismatch. Returns true once they have. */
export function useHydrateStores(): boolean {
  const [hydrated, setHydrated] = useState(() => STORES.every((store) => store.persist.hasHydrated()));
  useEffect(() => {
    if (hydrated) return;
    let live = true;
    void Promise.all(STORES.map((store) => store.persist.rehydrate())).finally(() => {
      if (live) setHydrated(true);
    });
    return () => {
      live = false;
    };
  }, [hydrated]);
  return hydrated;
}
