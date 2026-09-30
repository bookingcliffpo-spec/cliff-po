import { findModel, providerOf } from "@/generation/catalog";
import type { GenerationPlane, MediaItem, MediaRole, ProviderId, ReferenceTag } from "@/generation/catalog/types";

/** The Simple page's choices, and the one function that turns them into a
    generation. The page shows upload → prompt → Generate; this decides which
    model and mode that means, so nobody has to pick "reference-to-video". */

export type Target = "video-free" | "video-seedance" | "image-free" | "demo";

export type VideoAction = "edit" | "extend" | "motion" | "swap-character" | "swap-object" | "restyle";

export const TARGETS: ReadonlyArray<{ id: Target; label: string; hint: string; provider: ProviderId }> = [
  { id: "video-free", label: "Video · Free (my GPU)", hint: "Runs on your computer with WanGP — free, no limits", provider: "wangp" },
  { id: "video-seedance", label: "Video · Seedance 2.5", hint: "Hosted by Higgsfield — uses your credits", provider: "higgsfield" },
  { id: "image-free", label: "Image · Free", hint: "Free Flux images, no key (rate-limited)", provider: "pollinations" },
  { id: "demo", label: "Demo (test only)", hint: "Placeholder pictures — not AI, works offline", provider: "demo" },
];

export const DURATIONS = [5, 10, 15, 20, 30] as const;
export const ASPECTS = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"] as const;

export const RESTYLES = [
  ["style-anime", "Anime"],
  ["style-claymation", "Claymation"],
  ["style-pixar", "3D animated"],
  ["style-watercolor", "Watercolor"],
  ["style-comic", "Comic book"],
  ["style-cyberpunk", "Cyberpunk"],
  ["style-noir", "Film noir"],
  ["style-vintage-film", "Vintage film"],
  ["style-lego", "Toy bricks"],
  ["style-sketch", "Pencil sketch"],
] as const;

export type SimpleInput = {
  target: Target;
  prompt: string;
  images: Array<{ url: string; tag?: ReferenceTag }>;
  video?: string;
  duration: number;
  aspect: string;
  /* ---- More settings ---- */
  start?: string;
  end?: string;
  audio?: string;
  resolution?: "480p" | "720p";
  sound?: boolean;
  videoAction?: VideoAction;
  restyle?: string;
};

export type SimplePlan = {
  plane: GenerationPlane;
  /** What the app decided, in words — shown under the Generate button. */
  summary: string;
  /** Inputs that the chosen mode will not use. */
  notes: string[];
};

export class PlanError extends Error {}

/** Which targets this server can run, in display order. */
export function availableTargets(providers: readonly ProviderId[] | null): typeof TARGETS {
  if (!providers) return TARGETS;
  const usable = TARGETS.filter((target) => providers.includes(target.provider));
  /* The demo is only worth offering when nothing real is available. */
  const real = usable.filter((target) => target.id !== "demo");
  return real.length ? real : usable;
}

let ids = 0;
function item(url: string, role: MediaRole, tag?: ReferenceTag): MediaItem {
  return { id: `s${++ids}`, url, role, ...(tag ? { tag } : {}) };
}

/** Keeps only the settings the model declares, clamping numbers into range, so
    a simple choice (30 s) never trips a model's validation (Extend: max 20). */
function settingsFor(modelId: string, wanted: Record<string, unknown>): Record<string, unknown> {
  const model = findModel(modelId);
  if (!model) throw new PlanError("That model is not available.");
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(model.settings)) {
    const value = wanted[key];
    if (value === undefined) continue;
    if (field.type === "range" && typeof value === "number") {
      out[key] = Math.min(field.max, Math.max(field.min, Math.round(value)));
    } else if (field.type === "enum" && typeof value === "string") {
      if (field.values.includes(value)) out[key] = value;
    } else if (field.type === "boolean" && typeof value === "boolean") {
      out[key] = value;
    }
  }
  return out;
}

function plane(
  model: string,
  input: SimpleInput,
  media: MediaItem[],
  extra: Record<string, unknown> = {},
): GenerationPlane {
  const grouped: GenerationPlane["media"] = {};
  for (const entry of media) (grouped[entry.role] ??= []).push(entry);
  return {
    model,
    prompt: { text: input.prompt.trim() },
    media: grouped,
    settings: settingsFor(model, {
      duration: input.duration,
      aspectRatio: input.aspect,
      resolution: input.resolution ?? "720p",
      generateAudio: input.sound ?? true,
      ...extra,
    }),
  };
}

/** Turns the Simple page's inputs into one generation. Throws PlanError with a
    sentence a person can act on when the combination cannot work. */
export function planSimple(input: SimpleInput): SimplePlan {
  const notes: string[] = [];
  const images = input.images;
  const hasFrames = Boolean(input.start || input.end);
  if (input.end && !input.start) throw new PlanError("An end frame needs a start frame too (More settings).");

  if (input.target === "image-free" || input.target === "demo") {
    if (images.length || input.video || hasFrames) notes.push("Image models here use your prompt only; uploads are ignored.");
    if (!input.prompt.trim()) throw new PlanError("Type a prompt first.");
    const model = input.target === "demo" ? "demo-art" : "free-flux";
    return { plane: plane(model, input, []), summary: input.target === "demo" ? "Demo picture" : "Free image", notes };
  }

  if (input.target === "video-seedance") {
    const action = input.videoAction ?? "edit";
    if (input.video && (action === "edit" || action === "extend")) {
      const model = action === "extend" ? "seedance-2.5-extend" : "seedance-2.5-edit";
      if (!input.prompt.trim()) throw new PlanError("Describe the change to make.");
      const media = [item(input.video, "video"), ...images.slice(0, 30).map((i) => item(i.url, "reference", i.tag))];
      if (input.audio) media.push(item(input.audio, "audio"));
      return { plane: plane(model, input, media), summary: action === "extend" ? "Seedance · extend video" : "Seedance · edit video", notes };
    }
    if (input.video && action !== "edit" && action !== "extend") {
      throw new PlanError("Motion transfer and swaps run on the free GPU model — switch Model to “Video · Free”.");
    }
    if (hasFrames) {
      if (images.length) notes.push("Start/end frames are used; reference images are ignored in this mode.");
      const media = [item(input.start!, "start"), ...(input.end ? [item(input.end, "end")] : [])];
      return { plane: plane("seedance-2.5", input, media), summary: "Seedance · animate start frame", notes };
    }
    const media = images.slice(0, 30).map((i) => item(i.url, "reference", i.tag));
    if (input.audio) media.push(item(input.audio, "audio"));
    if (!media.length && !input.prompt.trim()) throw new PlanError("Type a prompt first.");
    return {
      plane: plane("seedance-2.5", input, media),
      summary: media.length ? "Seedance · video from your references" : "Seedance · video from your prompt",
      notes,
    };
  }

  /* ---- video-free: WanGP on the owner's GPU ---- */
  if (input.video) {
    const action = input.videoAction ?? "edit";
    const ref = images[0];
    if (images.length > 1) notes.push("Only the first image is used when working on a video.");
    switch (action) {
      case "extend":
        return { plane: plane("wangp-extend", input, [item(input.video, "video")]), summary: "Extend your video", notes };
      case "motion":
        if (!ref) throw new PlanError("Upload an image of the character that should copy the video's motion.");
        return {
          plane: plane("wangp-motion", input, [item(input.video, "video"), item(ref.url, "reference")]),
          summary: "Motion transfer onto your character",
          notes,
        };
      case "swap-character":
      case "swap-object": {
        if (!ref) throw new PlanError("Upload an image of the replacement.");
        const preset = action === "swap-character" ? "swap-character" : ref.tag === "product" ? "swap-product" : "swap-object";
        return {
          plane: plane("wangp-swap", input, [item(input.video, "video"), item(ref.url, "reference", ref.tag)], { preset }),
          summary: action === "swap-character" ? "Swap the character" : "Swap the object",
          notes,
        };
      }
      case "restyle":
        return {
          plane: plane("wangp-swap", input, [item(input.video, "video")], { preset: input.restyle ?? "style-anime" }),
          summary: "Restyle your video",
          notes,
        };
      default:
        if (!input.prompt.trim()) throw new PlanError("Describe the change to make to your video.");
        return {
          plane: plane("wangp-edit", input, [item(input.video, "video"), ...(ref ? [item(ref.url, "reference", ref.tag)] : [])]),
          summary: ref ? "Edit your video using your image" : "Edit your video",
          notes,
        };
    }
  }

  const audio = input.audio ? [item(input.audio, "audio")] : [];
  if (hasFrames) {
    if (images.length) notes.push("Start/end frames are used; reference images are ignored in this mode.");
    return {
      plane: plane("wangp-cinema", input, [item(input.start!, "start"), ...(input.end ? [item(input.end, "end")] : []), ...audio]),
      summary: input.end ? "Animate from start to end frame" : "Animate your start frame",
      notes,
    };
  }
  if (images.length) {
    if (images.length > 5) notes.push("The free model uses up to 5 reference images; the rest are ignored.");
    return {
      plane: plane("wangp-reference", input, [...images.slice(0, 5).map((i) => item(i.url, "reference", i.tag)), ...audio]),
      summary: "Video from your images",
      notes,
    };
  }
  if (!input.prompt.trim()) throw new PlanError("Type a prompt first.");
  return { plane: plane("wangp-cinema", input, audio), summary: "Video from your prompt", notes };
}

export function isVideoTarget(target: Target): boolean {
  return target === "video-free" || target === "video-seedance";
}

export function providerForModel(modelId: string): ProviderId | null {
  const model = findModel(modelId);
  return model ? providerOf(model) : null;
}
