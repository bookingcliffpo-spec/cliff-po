import type { GenerationPlane, MediaRole } from "../catalog/types";

/** A provider request: the model path to POST to and its JSON body. */
export type Mapped = { path: string; body: Record<string, unknown> };
export type Mapper = (plane: GenerationPlane) => Mapped;

export function urls(plane: GenerationPlane, role: MediaRole): string[] {
  return (plane.media[role] ?? []).map((item) => item.url);
}
