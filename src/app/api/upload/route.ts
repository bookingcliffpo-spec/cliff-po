import { NextResponse } from "next/server";

import { GenerationError } from "@/generation/errors";
import { MEDIA_MAX_BYTES, kindOfType, validateUpload } from "@/generation/media-rules";
import { readStorageConfig } from "@/generation/storage/config";
import { saveUpload } from "@/generation/storage/local";

export const runtime = "nodejs";

/** Local-disk uploads (STORAGE_DRIVER=local). The browser sends the raw file as
    the request body; the answer is a public URL under PUBLIC_BASE_URL that the
    provider can fetch. */
export async function POST(request: Request): Promise<NextResponse> {
  let config;
  try {
    config = readStorageConfig();
  } catch (caught) {
    return failure(500, caught instanceof GenerationError ? caught.message : "Upload failed — storage is misconfigured.");
  }
  if (!config || config.driver !== "local") {
    return failure(503, "Upload failed — local storage is not enabled on this server (STORAGE_DRIVER=local).");
  }

  const type = (request.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  const declared = Number(request.headers.get("content-length") ?? request.headers.get("x-file-size") ?? NaN);
  const problem = validateUpload({ type, size: Number.isFinite(declared) ? declared : 1 });
  if (problem) return failure(problem.includes("up to") ? 413 : 415, problem);
  if (!request.body) return failure(400, "Upload failed — the file is empty.");

  try {
    const { name } = await saveUpload(config.dir, request.body, type, MEDIA_MAX_BYTES[kindOfType(type)!]);
    return NextResponse.json({ url: `${config.publicBaseUrl}/api/media/${name}` });
  } catch (caught) {
    if (caught instanceof GenerationError) return failure(400, caught.message);
    console.warn("[upload] failed", caught instanceof Error ? caught.name : typeof caught);
    return failure(500, "Upload failed — the file could not be stored.");
  }
}

function failure(status: number, error: string) {
  return NextResponse.json({ error, code: "upload_failed" }, { status });
}
