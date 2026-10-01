import { GenerationError } from "../errors";
import { ALL_MEDIA_TYPES, EXTENSIONS } from "../media-rules";

export type SupabaseStorage = { url: string; key: string; bucket: string };

export type SignedUpload = {
  /** Where the browser PUTs the file. Carries a one-time token, not the key. */
  uploadUrl: string;
  /** The public URL the provider fetches once the upload lands. */
  publicUrl: string;
};

type Fetch = typeof fetch;

const TIMEOUT_MS = 15_000;
const ensured = new Set<string>();

/** Creates a signed upload URL for one file in the public bucket, creating the
    bucket on first use. The service key stays on the server; the browser only
    sees the one-time upload URL. */
export async function signSupabaseUpload(
  storage: SupabaseStorage,
  file: { type: string; deviceId: string },
  fetchImpl: Fetch = fetch,
): Promise<SignedUpload> {
  const ext = EXTENSIONS[file.type];
  if (!ext) throw new GenerationError("upload_failed", "Upload failed — this file type is not supported.");
  await ensureBucket(storage, fetchImpl);

  const path = `${file.deviceId}/${randomName()}.${ext}`;
  const res = await call(storage, fetchImpl, `/object/upload/sign/${storage.bucket}/${path}`, {});
  const body = (await res.json().catch(() => null)) as { url?: unknown } | null;
  if (!res.ok || typeof body?.url !== "string" || !body.url.startsWith("/")) {
    throw storageFailure(res.status, "could not authorize the upload");
  }
  return {
    uploadUrl: `${storage.url}/storage/v1${body.url}`,
    publicUrl: `${storage.url}/storage/v1/object/public/${storage.bucket}/${path}`,
  };
}

async function ensureBucket(storage: SupabaseStorage, fetchImpl: Fetch): Promise<void> {
  const cacheKey = `${storage.url}/${storage.bucket}`;
  if (ensured.has(cacheKey)) return;
  const res = await call(storage, fetchImpl, "/bucket", {
    id: storage.bucket,
    name: storage.bucket,
    public: true,
    allowed_mime_types: ALL_MEDIA_TYPES,
  });
  if (!res.ok) {
    /* An existing bucket answers 409, or 400 with a "Duplicate" body. */
    const text = await res.text().catch(() => "");
    if (res.status !== 409 && !/duplicate|already exists/i.test(text)) {
      throw storageFailure(res.status, "could not prepare the upload bucket");
    }
  }
  ensured.add(cacheKey);
}

async function call(storage: SupabaseStorage, fetchImpl: Fetch, path: string, json: unknown): Promise<Response> {
  try {
    return await fetchImpl(`${storage.url}/storage/v1${path}`, {
      method: "POST",
      headers: {
        apikey: storage.key,
        authorization: `Bearer ${storage.key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(json),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new GenerationError("upload_failed", "Upload failed — could not reach Supabase Storage.", { status: 502 });
  }
}

function storageFailure(status: number, what: string): GenerationError {
  if (status === 401 || status === 403) {
    return new GenerationError(
      "upload_failed",
      "Upload failed — Supabase refused the server's key. Check SUPABASE_SERVICE_ROLE_KEY.",
      { status: 502 },
    );
  }
  return new GenerationError("upload_failed", `Upload failed — Supabase ${what} (${status}).`, { status: 502 });
}

function randomName(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
