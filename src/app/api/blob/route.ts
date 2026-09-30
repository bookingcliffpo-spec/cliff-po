import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { DEVICE_COOKIE, DEVICE_COOKIE_OPTIONS, blobPathname, resolveDeviceId } from "@/generation/device";
import { GenerationError } from "@/generation/errors";
import { MEDIA_MAX_BYTES, kindOfType, validateUpload } from "@/generation/media-rules";
import { readStorageConfig } from "@/generation/storage/config";

/** Issues scoped client tokens for direct-to-Blob uploads. Each token is bound
    to one content type and that type's size cap, so the limits the browser
    checks are enforced again by Blob itself. Protect the whole app with
    APP_PASSWORD (see proxy.ts) when it is reachable from the internet. */
export async function POST(request: Request): Promise<NextResponse> {
  let incoming: HandleUploadBody;
  try {
    incoming = (await request.json()) as HandleUploadBody;
  } catch {
    return failure(400, "Upload failed — the upload request was malformed.");
  }

  let config;
  try {
    config = readStorageConfig();
  } catch (caught) {
    return failure(500, caught instanceof GenerationError ? caught.message : "Upload failed — storage is misconfigured.");
  }
  if (!config || config.driver !== "vercel-blob") {
    return failure(
      503,
      "Upload failed — Vercel Blob is not configured. Set OPEN_HIGGSFIELD_READ_WRITE_TOKEN, or use STORAGE_DRIVER=local.",
    );
  }

  const device = incoming.type === "blob.generate-client-token" ? await readDeviceId() : null;

  try {
    const body = device ? withDevicePath(incoming, device.deviceId) : incoming;
    const json = await handleUpload({
      body,
      request,
      token: config.token,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        const declared = parseClientPayload(clientPayload);
        const problem = validateUpload(declared);
        if (problem) throw new GenerationError("upload_failed", problem);
        const kind = kindOfType(declared.type)!;
        return {
          allowedContentTypes: [declared.type],
          maximumSizeInBytes: MEDIA_MAX_BYTES[kind],
          addRandomSuffix: true,
          validUntil: Date.now() + 15 * 60_000,
        };
      },
    });
    const response =
      json.type === "blob.generate-client-token" && body.type === "blob.generate-client-token"
        ? NextResponse.json({ ...json, pathname: body.payload.pathname })
        : NextResponse.json(json);
    return withDeviceCookie(response, device);
  } catch (caught) {
    const message =
      caught instanceof GenerationError ? caught.message : "Upload failed — could not authorize the upload.";
    if (!(caught instanceof GenerationError)) {
      console.warn("[blob] token request failed", caught instanceof Error ? caught.name : typeof caught);
    }
    return withDeviceCookie(failure(caught instanceof GenerationError ? 400 : 500, message), device);
  }
}

function failure(status: number, error: string) {
  return NextResponse.json({ error, code: "upload_failed" }, { status });
}

function parseClientPayload(raw: string | null): { type: string; size: number } {
  try {
    const parsed = JSON.parse(raw ?? "") as { contentType?: unknown; size?: unknown };
    if (typeof parsed.contentType === "string" && typeof parsed.size === "number") {
      return { type: parsed.contentType, size: parsed.size };
    }
  } catch {
    /* fall through */
  }
  throw new GenerationError("upload_failed", "Upload failed — the file's type and size were not declared.");
}

async function readDeviceId() {
  const jar = await cookies();
  return resolveDeviceId(jar.get(DEVICE_COOKIE)?.value);
}

function withDeviceCookie(response: NextResponse, device: { deviceId: string; minted: boolean } | null) {
  if (device?.minted) response.cookies.set(DEVICE_COOKIE, device.deviceId, DEVICE_COOKIE_OPTIONS);
  return response;
}

function withDevicePath(body: HandleUploadBody, deviceId: string): HandleUploadBody {
  if (body.type !== "blob.generate-client-token") return body;
  return {
    ...body,
    payload: { ...body.payload, pathname: blobPathname(deviceId, body.payload.pathname) },
  };
}
