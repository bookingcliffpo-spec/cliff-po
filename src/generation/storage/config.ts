import path from "node:path";

import { GenerationError } from "../errors";

type Env = Record<string, string | undefined>;

export type StorageDriver = "vercel-blob" | "local";

export type StorageConfig =
  | { driver: "vercel-blob"; token: string }
  | { driver: "local"; dir: string; publicBaseUrl: string };

/** Where uploads go. Two drivers:

    - vercel-blob: client-direct uploads to Vercel Blob. Needs a read-write
      token (OPEN_HIGGSFIELD_READ_WRITE_TOKEN, or Vercel's own
      BLOB_READ_WRITE_TOKEN).
    - local: files are written to LOCAL_UPLOAD_DIR on this server and served
      from /api/media. Free and self-hostable, but only works on a long-lived
      server with a disk (not serverless) and PUBLIC_BASE_URL must be an origin
      the provider can reach.

    STORAGE_DRIVER picks one explicitly; unset, Blob is used when its token is
    present. Returns null when nothing is configured. */
export function readStorageConfig(env: Env = process.env): StorageConfig | null {
  const explicit = env.STORAGE_DRIVER?.trim().toLowerCase();
  const token = (env.OPEN_HIGGSFIELD_READ_WRITE_TOKEN || env.BLOB_READ_WRITE_TOKEN || "").trim();

  if (explicit === "local") {
    const base = env.PUBLIC_BASE_URL?.trim();
    if (!base) {
      throw new GenerationError(
        "missing_config",
        "Missing PUBLIC_BASE_URL — local storage needs the public origin the provider fetches uploads from.",
      );
    }
    let publicBaseUrl: string;
    try {
      const url = new URL(base);
      if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("protocol");
      publicBaseUrl = url.toString().replace(/\/+$/, "");
    } catch {
      throw new GenerationError("missing_config", "PUBLIC_BASE_URL is not a valid http(s) URL.");
    }
    const dir = localMediaDir(env);
    return { driver: "local", dir, publicBaseUrl };
  }

  if (explicit === "vercel-blob" || explicit === "blob" || (!explicit && token)) {
    if (!token) {
      throw new GenerationError(
        "missing_config",
        "Missing OPEN_HIGGSFIELD_READ_WRITE_TOKEN (or BLOB_READ_WRITE_TOKEN) for Vercel Blob storage.",
      );
    }
    return { driver: "vercel-blob", token };
  }

  if (explicit) {
    throw new GenerationError("missing_config", "STORAGE_DRIVER must be 'vercel-blob' or 'local'.");
  }
  return null;
}

export function storageDriver(env: Env = process.env): StorageDriver | null {
  try {
    return readStorageConfig(env)?.driver ?? null;
  } catch {
    return null;
  }
}

export function isStorageConfigured(env: Env = process.env): boolean {
  return storageDriver(env) !== null;
}

export function requireStorage(env: Env = process.env): StorageConfig {
  const config = readStorageConfig(env);
  if (!config) {
    throw new GenerationError(
      "missing_config",
      "Uploads are not configured. Set OPEN_HIGGSFIELD_READ_WRITE_TOKEN (Vercel Blob) or STORAGE_DRIVER=local with PUBLIC_BASE_URL.",
    );
  }
  return config;
}

/** The directory /api/media serves from: local uploads, and images made by a
    local Stable Diffusion server. */
export function localMediaDir(env: Env = process.env): string {
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), env.LOCAL_UPLOAD_DIR?.trim() || ".uploads");
}
