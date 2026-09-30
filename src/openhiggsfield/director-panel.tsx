"use client";

import {
  APERTURES,
  CAMERAS,
  ERAS,
  GENRES,
  LENSES,
  LIGHTING,
  LIGHT_ANGLES,
  MOVES,
  PALETTES,
  TEMPOS,
  directionText,
  hasDirection,
  type Direction,
  type Option,
} from "@/generation/cinema";
import { useDirection } from "@/generation/stores/direction";

type Key = Exclude<keyof Direction, "brightness" | "diffusion" | "emotion" | "lightColor">;

const PICKS: Array<{ key: Key; label: string; options: readonly Option[] }> = [
  { key: "genre", label: "Genre", options: GENRES },
  { key: "era", label: "Era", options: ERAS },
  { key: "tempo", label: "Tempo", options: TEMPOS },
  { key: "camera", label: "Camera", options: CAMERAS },
  { key: "lens", label: "Lens", options: LENSES },
  { key: "aperture", label: "Aperture", options: APERTURES },
  { key: "move", label: "Camera move", options: MOVES },
  { key: "palette", label: `Color palette (${PALETTES.length})`, options: PALETTES },
  { key: "lighting", label: "Lighting preset", options: LIGHTING },
  { key: "lightAngle", label: "Lighting angle", options: LIGHT_ANGLES },
];

const LEVELS: Array<{
  key: "brightness" | "diffusion" | "emotion";
  label: string;
  steps: Array<{ value: number; label: string }>;
}> = [
  {
    key: "brightness",
    label: "Brightness",
    steps: [
      { value: -2, label: "Very dark" },
      { value: -1, label: "Dim" },
      { value: 1, label: "Bright" },
      { value: 2, label: "Very bright" },
    ],
  },
  {
    key: "diffusion",
    label: "Diffusion",
    steps: [
      { value: 10, label: "Hard light" },
      { value: 45, label: "Soft light" },
      { value: 80, label: "Heavy diffusion" },
    ],
  },
  {
    key: "emotion",
    label: "Emotion strength",
    steps: [
      { value: 15, label: "Subtle" },
      { value: 45, label: "Natural" },
      { value: 75, label: "Strong" },
      { value: 95, label: "Intense" },
    ],
  },
];

/** Count of choices made, for the composer pill. */
export function directionCount(direction: Direction): number {
  return Object.values(direction).filter((value) => value !== undefined && value !== "" && value !== 0).length;
}

/** Cinema-Studio-style controls that turn into prompt language. The preview
    shows exactly what is appended to the prompt. */
export function DirectorPanel() {
  const { enabled, direction, set, setEnabled, reset } = useDirection();
  const notes = directionText(direction);

  return (
    <div className="ohf-popover ohf-popover--director ohf-scroll" role="dialog" aria-label="Director's Panel">
      <div className="ohf-director-head">
        <div>
          <div className="ohf-director-title">Director&rsquo;s Panel</div>
          <div className="ohf-director-sub">Cinematography added to every video prompt</div>
        </div>
        <label className="ohf-director-toggle">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          <span>Apply</span>
        </label>
      </div>

      <div className="ohf-director-grid">
        {PICKS.map(({ key, label, options }) => (
          <label key={key} className="ohf-director-field">
            <span className="ohf-field-label">{label}</span>
            <select
              className="ohf-select"
              aria-label={label.replace(/ \(\d+\)$/, "")}
              value={direction[key] ?? ""}
              onChange={(event) => set({ [key]: event.target.value || undefined })}
            >
              <option value="">Any</option>
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ))}

        {LEVELS.map(({ key, label, steps }) => (
          <label key={key} className="ohf-director-field">
            <span className="ohf-field-label">{label}</span>
            <select
              className="ohf-select"
              aria-label={label}
              value={direction[key] === undefined ? "" : String(direction[key])}
              onChange={(event) => set({ [key]: event.target.value === "" ? undefined : Number(event.target.value) })}
            >
              <option value="">{key === "brightness" ? "Neutral" : "Any"}</option>
              {steps.map((step) => (
                <option key={step.value} value={step.value}>
                  {step.label}
                </option>
              ))}
            </select>
          </label>
        ))}

        <label className="ohf-director-field">
          <span className="ohf-field-label">Light color</span>
          <span className="ohf-director-color">
            <input
              type="color"
              aria-label="Custom lighting color"
              value={direction.lightColor ?? "#ffd9a8"}
              onChange={(event) => set({ lightColor: event.target.value })}
            />
            {direction.lightColor ? (
              <button type="button" className="ohf-btn-quiet" onClick={() => set({ lightColor: undefined })}>
                Clear
              </button>
            ) : (
              <span className="ohf-director-hint">Off</span>
            )}
          </span>
        </label>
      </div>

      <div className="ohf-director-preview" aria-live="polite">
        <span className="ohf-field-label">Added to your prompt</span>
        <p>{notes || "Nothing yet — pick a genre, a camera, a move…"}</p>
      </div>

      <div className="ohf-director-actions">
        <button type="button" className="ohf-btn-quiet" disabled={!hasDirection(direction)} onClick={reset}>
          Reset all
        </button>
      </div>
    </div>
  );
}
