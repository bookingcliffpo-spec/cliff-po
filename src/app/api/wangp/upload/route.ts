import { NextResponse } from "next/server";

import { wangpConfig } from "@/generation/free/wangp-client";
import { validateUpload } from "@/generation/media-rules";

export const runtime = "nodejs";

/** Uploads for the free local setup: the file streams through to the WanGP
    bridge, which keeps it next to the model. The answer is a studio path the
    WanGP models can use as an input. */
export async function POST(request: Request): Promise<NextResponse> {
  const config = wangpConfig();
  if (!config) return failure(503, "Upload failed — WanGP is not connected (WANGP_URL).");
  const type = (request.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  const declared = Number(request.headers.get("x-file-size") ?? request.headers.get("content-length") ?? NaN);
  const problem = validateUpload({ type, size: Number.isFinite(declared) ? declared : 1 });
  if (problem) return failure(problem.includes("up to") ? 413 : 415, problem);
  /* Read whole, then forward with a length: the bridge (Python stdlib) needs
     Content-Length, and this route only runs on the owner's own machine. */
  let bytes: ArrayBuffer;
  try {
    bytes = await request.arrayBuffer();
  } catch {
    return failure(400, "Upload failed — the file could not be read.");
  }
  const actual = validateUpload({ type, size: bytes.byteLength });
  if (actual) return failure(actual.includes("up to") ? 413 : 400, actual);

  let upstream: Response;
  try {
    upstream = await fetch(`${config.url}/v1/uploads`, {
      method: "POST",
      headers: { "Content-Type": type, ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}) },
      body: bytes,
    });
  } catch {
    return failure(502, "Upload failed — could not reach the WanGP bridge.");
  }
  const json = (await upstream.json().catch(() => null)) as { name?: unknown; error?: unknown } | null;
  if (!upstream.ok || typeof json?.name !== "string" || !/^[A-Za-z0-9._-]{1,200}$/.test(json.name)) {
    return failure(
      upstream.status === 401 ? 502 : upstream.status || 502,
      typeof json?.error === "string" ? `Upload failed — ${json.error}` : "Upload failed — the WanGP bridge refused the file.",
    );
  }
  return NextResponse.json({ url: `/api/wangp/files/${json.name}` });
}

function failure(status: number, error: string) {
  return NextResponse.json({ error, code: "upload_failed" }, { status });
}
