import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { GenerationError } from "@/generation/errors";
import { MEDIA_MAX_BYTES, mediaUrlProblem, validateUpload } from "@/generation/media-rules";
import { isStorageConfigured, readStorageConfig } from "@/generation/storage/config";
import { isStoredName, openStored, saveUpload } from "@/generation/storage/local";
import { validatePlane } from "@/generation/validate-plane";

describe("upload validation", () => {
  it("accepts the supported types within their size caps", () => {
    expect(validateUpload({ type: "image/png", size: 1024 })).toBeNull();
    expect(validateUpload({ type: "video/mp4", size: 50 * 1024 * 1024 })).toBeNull();
    expect(validateUpload({ type: "audio/wav", size: 1024 })).toBeNull();
  });

  it("rejects unsupported types with the list of supported ones", () => {
    expect(validateUpload({ type: "image/svg+xml", size: 10 })).toMatch(/not supported.*JPEG, PNG/);
    expect(validateUpload({ type: "", size: 10 })).toMatch(/not supported/);
    expect(validateUpload({ type: "application/pdf", size: 10 })).toMatch(/not supported/);
  });

  it("rejects empty and oversized files", () => {
    expect(validateUpload({ type: "image/png", size: 0 })).toMatch(/empty/);
    expect(validateUpload({ type: "image/png", size: MEDIA_MAX_BYTES.image + 1 })).toMatch(/up to 20 MB/);
  });

  it("rejects a file of the wrong kind for the role", () => {
    expect(validateUpload({ type: "video/mp4", size: 10 }, "image")).toMatch(/takes an image/);
    expect(validateUpload({ type: "image/png", size: 10 }, "audio")).toMatch(/takes an audio file/);
  });
});

describe("media URLs handed to the provider", () => {
  it("refuses browser-only URLs", () => {
    expect(mediaUrlProblem("blob:https://studio/123")).toMatch(/local preview/);
    expect(mediaUrlProblem("data:image/png;base64,AAAA")).toMatch(/local preview/);
  });

  it("refuses private hosts unless allowed", () => {
    expect(mediaUrlProblem("http://localhost:3000/api/media/x.png")).toMatch(/private address/);
    expect(mediaUrlProblem("http://192.168.1.4/x.png")).toMatch(/private address/);
    expect(mediaUrlProblem("http://localhost:3000/x.png", true)).toBeNull();
  });

  it("accepts public http(s) URLs", () => {
    expect(mediaUrlProblem("https://abc.public.blob.vercel-storage.com/x.png")).toBeNull();
  });

  it("is enforced by the submit validation as an upload failure", () => {
    try {
      validatePlane({
        model: "seedance-2.5",
        prompt: { text: "x" },
        settings: {},
        media: { start: [{ id: "1", url: "blob:https://studio/1", role: "start" }] },
      });
      expect.unreachable();
    } catch (caught) {
      expect(caught).toBeInstanceOf(GenerationError);
      expect((caught as GenerationError).code).toBe("upload_failed");
    }
  });
});

describe("storage configuration", () => {
  it("is unconfigured with nothing set", () => {
    expect(readStorageConfig({})).toBeNull();
    expect(isStorageConfigured({})).toBe(false);
  });

  it("uses Vercel Blob when a token is present under either name", () => {
    expect(readStorageConfig({ OPEN_HIGGSFIELD_READ_WRITE_TOKEN: "t" })).toEqual({ driver: "vercel-blob", token: "t" });
    expect(readStorageConfig({ BLOB_READ_WRITE_TOKEN: "u" })).toEqual({ driver: "vercel-blob", token: "u" });
  });

  it("requires PUBLIC_BASE_URL for local storage", () => {
    expect(() => readStorageConfig({ STORAGE_DRIVER: "local" })).toThrow(/PUBLIC_BASE_URL/);
    expect(readStorageConfig({ STORAGE_DRIVER: "local", PUBLIC_BASE_URL: "https://studio.example/" })).toMatchObject({
      driver: "local",
      publicBaseUrl: "https://studio.example",
    });
  });

  it("names an unknown driver", () => {
    expect(() => readStorageConfig({ STORAGE_DRIVER: "s3" })).toThrow(/STORAGE_DRIVER/);
  });
});

describe("local storage driver", () => {
  let dir: string | null = null;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = null;
  });

  function streamOf(bytes: number, chunk = 1024) {
    let sent = 0;
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= bytes) return controller.close();
        const size = Math.min(chunk, bytes - sent);
        sent += size;
        controller.enqueue(new Uint8Array(size));
      },
    });
  }

  it("stores a file under a random name and serves it back", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "ohf-"));
    const { name, size } = await saveUpload(dir, streamOf(4096), "image/png", 10_000);
    expect(isStoredName(name)).toBe(true);
    expect(name.endsWith(".png")).toBe(true);
    expect(size).toBe(4096);
    const opened = await openStored(dir, name);
    expect(opened).toMatchObject({ size: 4096, type: "image/png" });
    await opened!.stream.cancel();
  });

  it("stops an oversized upload and leaves nothing behind", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "ohf-"));
    await expect(saveUpload(dir, streamOf(20_000), "image/png", 10_000)).rejects.toThrow(/larger than allowed/);
    expect(await readdir(dir)).toEqual([]);
  });

  it("refuses names that are not ones it issued", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "ohf-"));
    expect(await openStored(dir, "../../etc/passwd")).toBeNull();
    expect(isStoredName("abc.png")).toBe(false);
  });
});
