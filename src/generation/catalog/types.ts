export type Surface = "image" | "video";
export type MediaRole = "start" | "end" | "reference" | "video" | "audio";

/** What a reference image stands for. The adapters turn tags into prompt
    language ("use image 2 as the product") for models that read references. */
export type ReferenceTag = "character" | "face" | "product" | "wardrobe" | "location" | "style" | "object";

export const REFERENCE_TAGS: readonly ReferenceTag[] = [
  "character",
  "face",
  "product",
  "wardrobe",
  "location",
  "style",
  "object",
];

export type MediaItem = {
  id: string;
  url: string;
  role: MediaRole;
  /** Only on reference images. */
  tag?: ReferenceTag;
};

export type SettingField =
  | { type: "enum"; values: readonly string[]; default: string }
  | { type: "range"; min: number; max: number; default: number; step?: number }
  | { type: "boolean"; default: boolean };

export type PlatformPaths = {
  text?: string;
  image?: string;
  firstLast?: string;
  reference?: string;
};

/** Who runs a model. Everything except "higgsfield" works without an API key. */
export type ProviderId = "higgsfield" | "pollinations" | "local-sd" | "demo" | "wangp";

export type ModelEntry = {
  id: string;
  /** Defaults to "higgsfield". */
  provider?: ProviderId;
  surface: Surface;
  label: string;
  roles: Partial<Record<MediaRole, number>>;
  settings: Record<string, SettingField>;
  /** Submit paths when the shared mapper is enough. Soul, Kling 3, and Seedance keep custom maps. */
  paths?: PlatformPaths;
};

export type GenerationPlane = {
  model: string;
  prompt: { text: string };
  media: Partial<Record<MediaRole, MediaItem[]>>;
  settings: Record<string, unknown>;
};
