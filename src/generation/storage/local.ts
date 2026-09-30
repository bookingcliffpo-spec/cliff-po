import { randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { GenerationError } from "../errors";
import { EXTENSIONS } from "../media-rules";

/** Uploaded files are named by random id plus the extension of their declared
    type, so a stored name is never a path the visitor chose. */
const NAME = /^[a-f0-9]{32}\.(jpg|png|webp|gif|mp4|wav)$/;

const TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  wav: "audio/wav",
};

export function isStoredName(name: string): boolean {
  return NAME.test(name);
}

export function contentTypeOf(name: string): string {
  return TYPES[name.split(".").pop() ?? ""] ?? "application/octet-stream";
}

/** Streams a request body to disk, stopping as soon as it exceeds maxBytes so
    an oversized upload never fills the disk. */
export async function saveUpload(
  dir: string,
  body: ReadableStream<Uint8Array>,
  contentType: string,
  maxBytes: number,
): Promise<{ name: string; size: number }> {
  const ext = EXTENSIONS[contentType];
  if (!ext) throw new GenerationError("upload_failed", "Upload failed — unsupported file type.");
  await mkdir(dir, { recursive: true });
  const name = `${randomBytes(16).toString("hex")}.${ext}`;
  const target = path.join(/*turbopackIgnore: true*/ dir, name);

  let size = 0;
  const limiter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      size += chunk.byteLength;
      if (size > maxBytes) {
        controller.error(new GenerationError("upload_failed", "Upload failed — the file is larger than allowed."));
        return;
      }
      controller.enqueue(chunk);
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(body.pipeThrough(limiter) as import("node:stream/web").ReadableStream<Uint8Array>),
      createWriteStream(target, { flags: "wx" }),
    );
  } catch (caught) {
    await rm(target, { force: true });
    if (caught instanceof GenerationError) throw caught;
    throw new GenerationError("upload_failed", "Upload failed — the file could not be stored.");
  }
  if (size === 0) {
    await rm(target, { force: true });
    throw new GenerationError("upload_failed", "Upload failed — the file is empty.");
  }
  return { name, size };
}

export async function openStored(
  dir: string,
  name: string,
): Promise<{ stream: ReadableStream<Uint8Array>; size: number; type: string } | null> {
  if (!isStoredName(name)) return null;
  const file = path.join(/*turbopackIgnore: true*/ dir, name);
  try {
    const info = await stat(file);
    if (!info.isFile()) return null;
    return {
      stream: Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>,
      size: info.size,
      type: contentTypeOf(name),
    };
  } catch {
    return null;
  }
}
