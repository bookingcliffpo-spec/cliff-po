import { describe, expect, it, vi } from "vitest";

import { readStorageConfig } from "@/generation/storage/config";
import { signSupabaseUpload } from "@/generation/storage/supabase";

const KEY = "fake_service_role_value";

describe("supabase storage config", () => {
  it("is picked up from the Vercel integration's variables", () => {
    expect(readStorageConfig({ SUPABASE_URL: "https://abc.supabase.co/", SUPABASE_SERVICE_ROLE_KEY: KEY })).toEqual({
      driver: "supabase",
      url: "https://abc.supabase.co",
      key: KEY,
      bucket: "studio-uploads",
    });
    expect(readStorageConfig({ NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co", SUPABASE_SECRET_KEY: KEY })).toMatchObject({
      driver: "supabase",
    });
  });

  it("needs both the URL and a server key", () => {
    expect(readStorageConfig({ SUPABASE_URL: "https://abc.supabase.co" })).toBeNull();
    expect(() => readStorageConfig({ STORAGE_DRIVER: "supabase" })).toThrow(/SUPABASE_URL/);
    expect(() => readStorageConfig({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: KEY, SUPABASE_BUCKET: "Bad Name" })).toThrow(
      /SUPABASE_BUCKET/,
    );
  });

  it("yields to Blob when both are set", () => {
    expect(
      readStorageConfig({ BLOB_READ_WRITE_TOKEN: "t", SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: KEY }),
    ).toMatchObject({ driver: "vercel-blob" });
  });
});

describe("signSupabaseUpload", () => {
  const storage = { url: "https://abc.supabase.co", key: KEY, bucket: "bucket-a" };

  it("creates the bucket, then signs a path under the device and returns public + upload URLs", async () => {
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>).apikey).toBe(KEY);
      if (url.endsWith("/storage/v1/bucket")) {
        expect(JSON.parse(init.body as string)).toMatchObject({ id: "bucket-a", public: true });
        return new Response(JSON.stringify({ name: "bucket-a" }), { status: 200 });
      }
      const path = url.split("/object/upload/sign/")[1];
      return new Response(JSON.stringify({ url: `/object/upload/sign/${path}?token=one-time` }), { status: 200 });
    });
    const signed = await signSupabaseUpload(storage, { type: "image/png", deviceId: "d".repeat(32) }, fetchImpl as typeof fetch);
    expect(signed.uploadUrl).toMatch(/^https:\/\/abc\.supabase\.co\/storage\/v1\/object\/upload\/sign\/bucket-a\/d{32}\/[0-9a-f]{32}\.png\?token=one-time$/);
    expect(signed.publicUrl).toMatch(/^https:\/\/abc\.supabase\.co\/storage\/v1\/object\/public\/bucket-a\/d{32}\/[0-9a-f]{32}\.png$/);
    expect(signed.uploadUrl + signed.publicUrl).not.toContain(KEY);
  });

  it("treats an existing bucket as ready", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith("/bucket")
        ? new Response(JSON.stringify({ statusCode: "409", error: "Duplicate", message: "The resource already exists" }), { status: 400 })
        : new Response(JSON.stringify({ url: "/object/upload/sign/bucket-b/x.png?token=t" }), { status: 200 }),
    );
    await expect(
      signSupabaseUpload({ ...storage, bucket: "bucket-b" }, { type: "image/png", deviceId: "e".repeat(32) }, fetchImpl as typeof fetch),
    ).resolves.toMatchObject({ uploadUrl: expect.stringContaining("token=t") });
  });

  it("explains a rejected key without echoing it", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 403 }));
    const promise = signSupabaseUpload({ ...storage, bucket: "bucket-c" }, { type: "image/png", deviceId: "f".repeat(32) }, fetchImpl as typeof fetch);
    await expect(promise).rejects.toThrow(/refused the server's key/);
    await expect(promise).rejects.not.toThrow(new RegExp(KEY));
  });

  it("refuses unsupported types before calling Supabase", async () => {
    const fetchImpl = vi.fn();
    await expect(signSupabaseUpload(storage, { type: "application/pdf", deviceId: "a".repeat(32) }, fetchImpl as typeof fetch)).rejects.toThrow(
      /not supported/,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
