import type { MediaRole } from "./catalog/types";

/** One allow-list for uploads, read by the browser (to refuse a file before it
    is sent), by the upload routes (to refuse it again), and by the submit
    action (to refuse URLs the provider cannot fetch). */

export type MediaKind = "image" | "video" | "audio";

const MB = 1024 * 1024;

export const MEDIA_TYPES: Record<MediaKind, readonly string[]> = {
  image: ["image/jpeg", "image/png", "image/webp", "image/gif"],
  video: ["video/mp4"],
  audio: ["audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"],
};

export const MEDIA_MAX_BYTES: Record<MediaKind, number> = {
  image: 20 * MB,
  video: 200 * MB,
  audio: 30 * MB,
};

export const ROLE_KIND: Record<MediaRole, MediaKind> = {
  start: "image",
  end: "image",
  reference: "image",
  video: "video",
  audio: "audio",
};

export const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/vnd.wave": "wav",
};

export const ALL_MEDIA_TYPES: readonly string[] = Object.values(MEDIA_TYPES).flat();

export function kindOfType(type: string): MediaKind | null {
  const clean = type.split(";")[0]!.trim().toLowerCase();
  for (const kind of Object.keys(MEDIA_TYPES) as MediaKind[]) {
    if (MEDIA_TYPES[kind].includes(clean)) return kind;
  }
  return null;
}

function formatBytes(bytes: number): string {
  return bytes >= MB ? `${Math.round(bytes / MB)} MB` : `${Math.round(bytes / 1024)} KB`;
}

/** Why a file cannot be uploaded, or null when it can. `expected` narrows the
    check to the kind a media role takes. */
export function validateUpload(
  file: { type: string; size: number; name?: string },
  expected?: MediaKind,
): string | null {
  const kind = kindOfType(file.type || "");
  if (!kind) {
    return `Upload failed — ${file.type || "this file type"} is not supported. Use JPEG, PNG, WebP or GIF images, MP4 video, or WAV audio.`;
  }
  if (expected && kind !== expected) {
    return `Upload failed — this input takes ${expected === "image" ? "an image" : `a${expected === "audio" ? "n" : ""} ${expected} file`}.`;
  }
  if (!Number.isFinite(file.size) || file.size <= 0) return "Upload failed — the file is empty.";
  if (file.size > MEDIA_MAX_BYTES[kind]) {
    return `Upload failed — ${kind} files can be up to ${formatBytes(MEDIA_MAX_BYTES[kind])} (this one is ${formatBytes(file.size)}).`;
  }
  return null;
}

const PRIVATE_HOST =
  /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|\[?::1\]?|[^.]+\.local|[^.]+\.internal)$/i;

/** Why a media URL cannot be handed to the provider, or null when it can. The
    provider fetches inputs from the public internet, so browser-only URLs
    (blob:, data:) and private hosts are refused with a reason instead of
    failing somewhere inside the provider. */
export function mediaUrlProblem(raw: string, allowPrivate = false): string | null {
  if (raw.startsWith("blob:") || raw.startsWith("data:")) {
    return "Upload failed — an input is still a local preview. Wait for the upload to finish, or attach it again.";
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "Upload failed — an input has an invalid URL. Attach it again.";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return "Upload failed — inputs must be http(s) URLs.";
  }
  if (!allowPrivate && PRIVATE_HOST.test(url.hostname)) {
    return "Upload failed — an input is hosted on a private address the provider cannot reach. Set PUBLIC_BASE_URL to a public origin.";
  }
  return null;
}
