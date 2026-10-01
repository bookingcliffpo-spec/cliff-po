import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { DEVICE_COOKIE, DEVICE_COOKIE_OPTIONS, resolveDeviceId } from "@/generation/device";
import { GenerationError } from "@/generation/errors";
import { validateUpload } from "@/generation/media-rules";
import { readStorageConfig } from "@/generation/storage/config";
import { signSupabaseUpload } from "@/generation/storage/supabase";

export const runtime = "nodejs";

/** Issues a one-time signed upload URL for Supabase Storage. The browser
    declares the file's type and size; both are checked here, and the bucket
    only accepts the supported types. The service key never leaves the server.
    Protect the whole app with APP_PASSWORD (see proxy.ts) when it is reachable
    from the internet. */
export async function POST(request: Request): Promise<NextResponse> {
  let config;
  try {
    config = readStorageConfig();
  } catch (caught) {
    return failure(500, caught instanceof GenerationError ? caught.message : "Upload failed — storage is misconfigured.");
  }
  if (!config || config.driver !== "supabase") {
    return failure(503, "Upload failed — Supabase storage is not configured on this server.");
  }

  const declared = (await request.json().catch(() => null)) as { contentType?: unknown; size?: unknown } | null;
  if (typeof declared?.contentType !== "string" || typeof declared.size !== "number") {
    return failure(400, "Upload failed — the file's type and size were not declared.");
  }
  const type = declared.contentType.split(";")[0]!.trim().toLowerCase();
  const problem = validateUpload({ type, size: declared.size });
  if (problem) return failure(problem.includes("up to") ? 413 : 415, problem);

  const jar = await cookies();
  const device = resolveDeviceId(jar.get(DEVICE_COOKIE)?.value);
  let response: NextResponse;
  try {
    response = NextResponse.json(await signSupabaseUpload(config, { type, deviceId: device.deviceId }));
  } catch (caught) {
    if (!(caught instanceof GenerationError)) {
      console.warn("[supabase] sign failed", caught instanceof Error ? caught.name : typeof caught);
    }
    response =
      caught instanceof GenerationError
        ? failure(caught.status ?? 502, caught.message)
        : failure(500, "Upload failed — could not authorize the upload.");
  }
  if (device.minted) response.cookies.set(DEVICE_COOKIE, device.deviceId, DEVICE_COOKIE_OPTIONS);
  return response;
}

function failure(status: number, error: string) {
  return NextResponse.json({ error, code: "upload_failed" }, { status });
}
