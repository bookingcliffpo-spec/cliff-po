import type { Direction } from "@/generation/cinema";

/** One-pick cinematic looks for the Simple page — the Director's Panel,
    pre-set. The full panel is in the advanced studio. */
export const LOOKS: Record<string, { label: string; direction: Direction }> = {
  none: { label: "None", direction: {} },
  noir: {
    label: "Noir detective",
    direction: { genre: "noir", era: "1970s", camera: "35mm", lens: "anamorphic", move: "push-in", palette: "noir-bw", lighting: "low-key", lightAngle: "side" },
  },
  epic: {
    label: "Epic aerial",
    direction: { genre: "epic", camera: "imax", lens: "24mm", move: "helicopter", palette: "golden", lighting: "golden-hour", emotion: 75 },
  },
  vhs: { label: "80s VHS", direction: { era: "1980s", camera: "vhs", palette: "synthwave", lighting: "neon-night", tempo: "dynamic" } },
  homemovie: {
    label: "Home movie (8mm)",
    direction: { camera: "8mm", era: "1960s", palette: "vintage-fade", move: "handheld", lighting: "daylight" },
  },
  camcorder: {
    label: "Y2K camcorder",
    direction: { camera: "dv", era: "2000s", move: "handheld", tempo: "frenetic", palette: "music-video" },
  },
  horror: {
    label: "Horror",
    direction: { genre: "horror", move: "dolly-zoom", palette: "horror-green", lighting: "low-key", lightAngle: "under", brightness: -2 },
  },
  action: {
    label: "Action",
    direction: { genre: "action", move: "robot-arm", tempo: "frenetic", lens: "14mm", palette: "teal-orange", emotion: 95 },
  },
  product: {
    label: "Product hero",
    direction: { lens: "macro", aperture: "f2.8", move: "orbit", lighting: "high-key", palette: "luxury", diffusion: 45 },
  },
  romance: {
    label: "Dreamy romance",
    direction: { genre: "drama", lens: "85mm", aperture: "f1.4", palette: "dreamy-haze", lighting: "golden-hour", lightAngle: "back", diffusion: 80 },
  },
};
