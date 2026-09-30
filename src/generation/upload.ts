import { put } from "@vercel/blob/client";

import type { MediaKind } from "./media-rules";
import { mediaUrlProblem, validateUpload } from "./media-rules";
import type { StorageDriver } from "./storage/config";

/** An upload that did not produce a URL, with a message ready to show. */
export class UploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadError";
  }
}

export type UploadOptions = {
  driver: StorageDriver | null;
  expected?: MediaKind;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
};

const MULTIPART_OVER = 32 * 1024 * 1024;

/** Sends a file to the configured storage and resolves with a public URL the
    provider can fetch. The file is checked here first so a wrong type or an
    oversized video is refused before a byte is sent; the server checks again. */
export async function uploadMedia(file: File, options: UploadOptions): Promise<{ url: string }> {
  const problem = validateUpload(file, options.expected);
  if (problem) throw new UploadError(problem);
  if (!options.driver) {
    throw new UploadError(
      "Uploads aren't available here — this server has nowhere to keep files. Run the free studio on your computer (uploads go to your PC), or add upload storage (OPEN_HIGGSFIELD_READ_WRITE_TOKEN or STORAGE_DRIVER=local).",
    );
  }
  const { url } =
    options.driver === "local"
      ? await uploadLocal(file, options, "/api/upload")
      : options.driver === "wangp"
        ? await uploadLocal(file, options, "/api/wangp/upload")
        : await uploadBlob(file, options);
  /* Private hosts are allowed here: whether the provider can reach them is the
     submit action's call, which knows the server's settings. Files kept by the
     WanGP bridge are addressed by a studio path. */
  const bad = /^\/api\/wangp\/files\/[A-Za-z0-9._-]+$/.test(url) ? null : mediaUrlProblem(url, true);
  if (bad) throw new UploadError(bad);
  options.onProgress?.(1);
  return { url };
}

async function uploadBlob(file: File, options: UploadOptions): Promise<{ url: string }> {
  const multipart = file.size > MULTIPART_OVER;
  let res: Response;
  try {
    res = await fetch("/api/blob", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "blob.generate-client-token",
        payload: {
          pathname: file.name || "upload",
          clientPayload: JSON.stringify({ contentType: file.type, size: file.size }),
          multipart,
        },
      }),
      signal: options.signal,
    });
  } catch {
    throw new UploadError("Upload failed — could not reach the studio server.");
  }
  const json = (await res.json().catch(() => null)) as {
    clientToken?: unknown;
    pathname?: unknown;
    error?: unknown;
  } | null;
  if (!res.ok || typeof json?.clientToken !== "string" || typeof json.pathname !== "string") {
    throw new UploadError(
      typeof json?.error === "string" ? json.error : `Upload failed — the server refused the upload (${res.status}).`,
    );
  }
  try {
    const blob = await put(json.pathname, file, {
      access: "public",
      token: json.clientToken,
      contentType: file.type,
      multipart,
      abortSignal: options.signal,
      onUploadProgress: ({ percentage }) => options.onProgress?.(Math.min(0.99, percentage / 100)),
    });
    return { url: blob.url };
  } catch (caught) {
    if (options.signal?.aborted) throw new UploadError("Upload canceled.");
    const name = caught instanceof Error ? caught.name : "";
    throw new UploadError(
      name.includes("ContentType") || name.includes("FileTooLarge")
        ? "Upload failed — storage rejected this file's type or size."
        : "Upload failed — the file could not be sent to storage. Check your connection and retry.",
    );
  }
}

/** XMLHttpRequest rather than fetch: it is the only browser API that reports
    upload progress. */
function uploadLocal(file: File, options: UploadOptions, endpoint: string): Promise<{ url: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", endpoint);
    xhr.setRequestHeader("content-type", file.type);
    xhr.setRequestHeader("x-file-size", String(file.size));
    xhr.responseType = "json";
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) options.onProgress?.(Math.min(0.99, event.loaded / event.total));
    };
    xhr.onload = () => {
      const body = xhr.response as { url?: unknown; error?: unknown } | null;
      if (xhr.status >= 200 && xhr.status < 300 && typeof body?.url === "string") {
        resolve({ url: body.url });
        return;
      }
      reject(
        new UploadError(
          typeof body?.error === "string" ? body.error : `Upload failed — the server refused the upload (${xhr.status}).`,
        ),
      );
    };
    xhr.onerror = () => reject(new UploadError("Upload failed — could not reach the studio server."));
    xhr.onabort = () => reject(new UploadError("Upload canceled."));
    options.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}
