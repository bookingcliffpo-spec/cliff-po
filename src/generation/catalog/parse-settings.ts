import type { ModelEntry, SettingField } from "./types";

/** A setting value the model does not allow. Carries the key so the server can
    say which dial was wrong. */
export class InvalidSettingError extends Error {
  readonly key: string;
  constructor(key: string, detail: string) {
    super(`${key} ${detail}`);
    this.name = "InvalidSettingError";
    this.key = key;
  }
}

/** Resolves raw settings against the model's allow-list.

    strict (the server): an out-of-range or unknown value throws, so a request
    the provider would reject is refused before it is paid for.

    lenient (the UI): an invalid value falls back to the default. Settings are
    persisted in localStorage, and a value saved under an older catalog — a
    duration the model no longer allows — must not throw during render. */
export function parseSettings(
  model: ModelEntry,
  raw: Record<string, unknown> | null | undefined,
  mode: "strict" | "lenient" = "strict",
): Record<string, unknown> {
  const source = raw && typeof raw === "object" ? raw : {};
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(model.settings)) {
    const value = source[key];
    if (value === undefined || value === null) {
      out[key] = field.default;
      continue;
    }
    const problem = check(field, value);
    if (problem) {
      if (mode === "strict") throw new InvalidSettingError(key, problem);
      out[key] = field.default;
      continue;
    }
    out[key] = value;
  }
  return out;
}

function check(field: SettingField, value: unknown): string | null {
  if (field.type === "enum") {
    if (typeof value !== "string" || !field.values.includes(value)) {
      return `must be one of ${field.values.join(", ")}`;
    }
    return null;
  }
  if (field.type === "range") {
    if (typeof value !== "number" || !Number.isFinite(value)) return "must be a number";
    if (value < field.min || value > field.max) return `must be between ${field.min} and ${field.max}`;
    /* Without a declared step the range is whole numbers — a duration of 5.5s
       is not something any provider accepts. */
    if (field.step === undefined && !Number.isInteger(value)) return "must be a whole number";
    return null;
  }
  return typeof value === "boolean" ? null : "must be on or off";
}
