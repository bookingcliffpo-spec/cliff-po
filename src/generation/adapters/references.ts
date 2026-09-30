import type { GenerationPlane, ReferenceTag } from "../catalog/types";

const TAG_PHRASES: Record<ReferenceTag, string> = {
  character: "the character (keep their identity, body and look)",
  face: "the face (keep this exact facial identity)",
  product: "the product (keep its exact shape, branding and details)",
  wardrobe: "the wardrobe (dress the subject in this outfit)",
  location: "the location (set the scene in this environment)",
  style: "the visual style (match its look, palette and texture)",
  object: "the object (keep its exact appearance)",
};

/** A sentence telling the model what each tagged reference image is for, or
    "" when no reference carries a tag. Images are numbered in the order they
    are sent. */
export function referenceNotes(plane: GenerationPlane, offset = 0): string {
  const refs = plane.media.reference ?? [];
  const notes = refs
    .map((item, index) => (item.tag ? `image ${index + 1 + offset} is ${TAG_PHRASES[item.tag]}` : ""))
    .filter(Boolean);
  return notes.length ? `References: ${notes.join("; ")}.` : "";
}

export function withReferenceNotes(prompt: string, plane: GenerationPlane, offset = 0): string {
  const notes = referenceNotes(plane, offset);
  return notes ? `${prompt}\n\n${notes}` : prompt;
}
