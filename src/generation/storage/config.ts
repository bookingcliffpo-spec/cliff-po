import path from "node:path";

import { GenerationError } from "../errors";

type Env = Record<string, string | undefined>;

export type StorageDriver = "vercel-blob" | "supabase" | "local" | "wangp";

export type StorageConfig =
  | { driver: "vercel-blob"; token: string }
  | { driver: "supabase"; url: string; key: string; bucket: string }
  | { driver: "wangp" }
  | { driver: "local"; dir: string; publicBaseUrl: string };

/** Where uploads go. Drivers:

    - vercel-blob: client-direct uploads to Vercel Blob. Needs a read-write
      token (OPEN_HIGGSFIELD_READ_WRITE_TOKEN, or Vercel's own
      BLOB_READ_WRITE_TOKEN).
    - supabase: client-direct uploads to a public Supabase Storage bucket
      through signed upload URLs. Needs SUPABASE_URL and
      SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY); the bucket
      (SUPABASE_BUCKET, default studio-uploads) is created on first use.
    - local: files are written to LOCAL_UPLOAD_DIR on this server and served
      from /api/media. Free and self-hostable, but only works on a long-lived
      server with a disk (not serverless) and PUBLIC_BASE_URL must be an origin
      the provider can reach.

    STORAGE_DRIVER picks one explicitly; unset, the first configured of Blob,
    Supabase and the WanGP bridge is used. Returns null when nothing is
    configured. */
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

  /* Supabase Storage, as set up by Vercel's Supabase integration: the
     project URL plus its service-role (or secret) key, both server-side. */
  const supabaseUrl = (env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const supabaseKey = (env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || "").trim();
  if (explicit === "supabase" || (!explicit && supabaseUrl && supabaseKey)) {
    if (!supabaseUrl || !supabaseKey) {
      throw new GenerationError(
        "missing_config",
        "STORAGE_DRIVER=supabase needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY).",
      );
    }
    let url: string;
    try {
      const parsed = new URL(supabaseUrl);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("protocol");
      url = parsed.origin;
    } catch {
      throw new GenerationError("missing_config", "SUPABASE_URL is not a valid http(s) URL.");
    }
    const bucket = (env.SUPABASE_BUCKET || "studio-uploads").trim();
    if (!/^[a-z0-9][a-z0-9._-]{1,62}$/.test(bucket)) {
      throw new GenerationError("missing_config", "SUPABASE_BUCKET may only use lowercase letters, digits, '.', '_' and '-'.");
    }
    return { driver: "supabase", url, key: supabaseKey, bucket };
  }

  /* The free local setup: with WanGP connected and nothing else configured,
     uploads are kept by the WanGP bridge on the same machine — no storage
     account needed. Only WanGP models can read them. */
  if (explicit === "wangp" || (!explicit && env.WANGP_URL?.trim())) {
    if (!env.WANGP_URL?.trim()) {
      throw new GenerationError("missing_config", "STORAGE_DRIVER=wangp needs WANGP_URL.");
    }
    return { driver: "wangp" };
  }

  if (explicit) {
    throw new GenerationError("missing_config", "STORAGE_DRIVER must be 'vercel-blob', 'supabase', 'local' or 'wangp'.");
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
      "Uploads are not configured. Set OPEN_HIGGSFIELD_READ_WRITE_TOKEN (Vercel Blob), SUPABASE_URL with SUPABASE_SERVICE_ROLE_KEY, or STORAGE_DRIVER=local with PUBLIC_BASE_URL.",
    );
  }
  return config;
}

/** The directory /api/media serves from: local uploads, and images made by a
    local Stable Diffusion server. */
export function localMediaDir(env: Env = process.env): string {
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), env.LOCAL_UPLOAD_DIR?.trim() || ".uploads");
}
