import { describe, expect, it } from "vitest";

import { createHiggsfieldClient } from "@/generation/higgsfield/client";
import { pollStatuses, submitPlane } from "@/generation/service";

import { API_KEY, fakeFetch, json, noSleep } from "./helpers";

const BASE = "https://provider.example.test";
const ENV = { HF_API_BASE_URL: BASE, HF_API_KEY: API_KEY };

function client(fetchImpl: typeof fetch, extra: Partial<Parameters<typeof createHiggsfieldClient>[0]> = {}) {
  return createHiggsfieldClient({ apiKey: API_KEY, baseUrl: `${BASE}/`, fetch: fetchImpl, sleep: noSleep, logger: null, ...extra });
}

const soulPlane = {
  model: "soul-2",
  prompt: { text: "portrait, rim light" },
  settings: { aspectRatio: "3:4" },
  media: {},
};

describe("Higgsfield client", () => {
  it("POSTs JSON to /{model-path} with the Key authorization header", async () => {
    const { impl, calls } = fakeFetch([json({ request_id: "req_1", status: "queued" })]);
    const queued = await client(impl).submit("bytedance/seedance-2.5/text-to-video", { prompt: "x" });
    expect(queued).toEqual({ requestId: "req_1", status: "queued" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${BASE}/bytedance/seedance-2.5/text-to-video`);
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.headers.authorization).toBe(`Key ${API_KEY}`);
    expect(calls[0]!.headers["content-type"]).toBe("application/json");
    expect(calls[0]!.body).toEqual({ prompt: "x" });
  });

  it("GETs /requests/{id}/status and maps media", async () => {
    const { impl, calls } = fakeFetch([
      json({ status: "COMPLETED", request_id: "other-spelling", video: { url: "https://cdn/x.mp4" } }),
    ]);
    const status = await client(impl).status("req/1");
    expect(calls[0]!.url).toBe(`${BASE}/requests/req%2F1/status`);
    expect(calls[0]!.method).toBe("GET");
    expect(status).toEqual({ status: "completed", requestId: "req/1", video: { url: "https://cdn/x.mp4" } });
  });

  it("refuses model paths that could escape the API", async () => {
    const { impl, calls } = fakeFetch([]);
    await expect(client(impl).submit("../admin", {})).rejects.toMatchObject({ code: "invalid_model" });
    await expect(client(impl).submit("a//b", {})).rejects.toMatchObject({ code: "invalid_model" });
    expect(calls).toHaveLength(0);
  });

  it("parses a non-JSON body without throwing", async () => {
    const { impl } = fakeFetch([new Response("<html>Bad gateway</html>", { status: 502 })]);
    await expect(client(impl, { retries: 0 }).status("r")).rejects.toMatchObject({ code: "provider_unavailable" });
  });

  it("reports a successful response with no request id", async () => {
    const { impl } = fakeFetch([new Response("", { status: 200 })]);
    await expect(client(impl).submit("m", {})).rejects.toMatchObject({ code: "provider_error" });
  });

  it("retries a status poll after a 503", async () => {
    const { impl, calls } = fakeFetch([json({}, 503), json({ status: "in_progress" })]);
    await expect(client(impl).status("r")).resolves.toMatchObject({ status: "in_progress" });
    expect(calls).toHaveLength(2);
  });

  it("retries a status poll after a network error", async () => {
    const { impl, calls } = fakeFetch([new TypeError("fetch failed"), json({ status: "queued" })]);
    await expect(client(impl).status("r")).resolves.toMatchObject({ status: "queued" });
    expect(calls).toHaveLength(2);
  });

  it("never repeats a submit after a 5xx (it may have started a paid run)", async () => {
    const { impl, calls } = fakeFetch([json({}, 500), json({ request_id: "dup" })]);
    await expect(client(impl).submit("m", {})).rejects.toMatchObject({ code: "provider_unavailable" });
    expect(calls).toHaveLength(1);
  });

  it("repeats a submit after a 429, honouring Retry-After", async () => {
    const waits: number[] = [];
    const { impl, calls } = fakeFetch([json({}, 429, { "retry-after": "1" }), json({ request_id: "r2" })]);
    const queued = await client(impl, { sleep: async (ms) => void waits.push(ms) }).submit("m", {});
    expect(queued.requestId).toBe("r2");
    expect(calls).toHaveLength(2);
    expect(waits).toEqual([1000]);
  });

  it("gives up on a Retry-After longer than it will wait", async () => {
    const { impl, calls } = fakeFetch([json({}, 429, { "retry-after": "120" })]);
    await expect(client(impl).submit("m", {})).rejects.toMatchObject({ code: "rate_limited" });
    expect(calls).toHaveLength(1);
  });

  it("times out a request that never answers", async () => {
    const hang = (_call: unknown, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    const { impl } = fakeFetch([hang]);
    await expect(client(impl, { submitTimeoutMs: 20 }).submit("m", {})).rejects.toMatchObject({
      code: "timeout",
      message: expect.stringMatching(/Provider timeout/),
    });
  });

  it("honours an external AbortSignal", async () => {
    const hang = (_call: unknown, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    const { impl, calls } = fakeFetch([hang]);
    const controller = new AbortController();
    const pending = client(impl).status("r", { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ message: "Request canceled." });
    expect(calls).toHaveLength(1);
  });
});

describe("submit (service)", () => {
  it("returns ok with the queued request", async () => {
    const { impl, calls } = fakeFetch([json({ request_id: "req_9", status: "IN_QUEUE" })]);
    const result = await submitPlane(soulPlane, { env: ENV, fetch: impl, logger: null });
    expect(result).toEqual({ ok: true, data: { requestId: "req_9", status: "queued" } });
    expect(calls[0]!.url).toBe(`${BASE}/higgsfield-ai/soul/v2/standard`);
    expect(calls[0]!.body).toMatchObject({ prompt: "portrait, rim light", aspect_ratio: "3:4", batch_size: 1 });
  });

  it("returns a safe failure for a rejected key, never throwing", async () => {
    const { impl } = fakeFetch([json({ detail: `invalid key ${API_KEY}` }, 401)]);
    const result = await submitPlane(soulPlane, { env: ENV, fetch: impl, logger: null });
    expect(result).toEqual({
      ok: false,
      error: "Invalid API key — the provider rejected the credential.",
      code: "invalid_api_key",
      status: 401,
    });
    expect(JSON.stringify(result)).not.toContain("sk_live_secret");
  });

  it("returns an insufficient-balance failure", async () => {
    const { impl } = fakeFetch([json({ detail: "Not enough credits" }, 402)]);
    const result = await submitPlane(soulPlane, { env: ENV, fetch: impl, logger: null });
    expect(result).toMatchObject({ ok: false, code: "insufficient_balance", error: expect.stringMatching(/Insufficient provider balance/) });
  });

  it("reports missing HF_API_BASE_URL without calling out", async () => {
    const { impl, calls } = fakeFetch([]);
    const result = await submitPlane(soulPlane, { env: { HF_API_KEY: API_KEY }, fetch: impl, logger: null });
    expect(result).toEqual({
      ok: false,
      error: "Missing HF_API_BASE_URL — set the generation API origin on the server.",
      code: "missing_config",
    });
    expect(calls).toHaveLength(0);
  });

  it("reports a missing key, and uses a browser key when no server key is set", async () => {
    const missing = await submitPlane(soulPlane, { env: { HF_API_BASE_URL: BASE }, logger: null });
    expect(missing).toMatchObject({ ok: false, code: "missing_api_key" });

    const { impl, calls } = fakeFetch([json({ request_id: "r" })]);
    const viaCookie = await submitPlane(soulPlane, {
      env: { HF_API_BASE_URL: BASE },
      cookieApiKey: "cookie_id:cookie_secret",
      fetch: impl,
      logger: null,
    });
    expect(viaCookie.ok).toBe(true);
    expect(calls[0]!.headers.authorization).toBe("Key cookie_id:cookie_secret");
  });

  it("prefers HF_API_KEY over a browser key", async () => {
    const { impl, calls } = fakeFetch([json({ request_id: "r" })]);
    await submitPlane(soulPlane, { env: ENV, cookieApiKey: "c:d", fetch: impl, logger: null });
    expect(calls[0]!.headers.authorization).toBe(`Key ${API_KEY}`);
  });

  it("returns invalid-model and unsupported-settings failures before calling out", async () => {
    const { impl, calls } = fakeFetch([]);
    const deps = { env: ENV, fetch: impl, logger: null };
    expect(await submitPlane({ ...soulPlane, model: "nope" }, deps)).toMatchObject({ ok: false, code: "invalid_model" });
    expect(await submitPlane({ ...soulPlane, settings: { aspectRatio: "7:1" } }, deps)).toMatchObject({
      ok: false,
      code: "unsupported_settings",
    });
    expect(await submitPlane("garbage", deps)).toMatchObject({ ok: false, code: "invalid_request" });
    expect(calls).toHaveLength(0);
  });

  it("hides unexpected exceptions behind a generic message", async () => {
    const impl = (() => {
      throw new RangeError(`boom ${API_KEY}`);
    }) as unknown as typeof fetch;
    const result = await submitPlane(soulPlane, { env: ENV, fetch: impl, logger: null });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("sk_live_secret");
  });
});

describe("status polling (service)", () => {
  it("answers every request in one call, isolating per-request failures", async () => {
    const { impl } = fakeFetch([
      (call) =>
        call.url.includes("/a/")
          ? json({ status: "completed", images: [{ url: "https://cdn/1.png" }] })
          : json({ detail: "gone" }, 404),
      (call) =>
        call.url.includes("/a/")
          ? json({ status: "completed", images: [{ url: "https://cdn/1.png" }] })
          : json({ detail: "gone" }, 404),
    ]);
    const result = await pollStatuses({ requestIds: ["a", "b"] }, { env: ENV, fetch: impl, logger: null });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual([
      { requestId: "a", status: { status: "completed", requestId: "a", images: [{ url: "https://cdn/1.png" }] } },
      { requestId: "b", error: "The provider no longer knows this request.", code: "not_found", final: true },
    ]);
  });

  it("marks transient per-request failures as not final", async () => {
    const { impl } = fakeFetch([json({}, 503), json({}, 503), json({}, 503)]);
    const result = await pollStatuses({ requestIds: ["a"] }, { env: ENV, fetch: impl, logger: null, sleep: noSleep });
    expect(result).toMatchObject({ ok: true, data: [{ requestId: "a", code: "provider_unavailable", final: false }] });
  });

  it("rejects malformed polls as data", async () => {
    expect(await pollStatuses({ requestIds: [] }, { env: ENV, logger: null })).toMatchObject({ ok: false, code: "invalid_request" });
    expect(await pollStatuses(null, { env: ENV, logger: null })).toMatchObject({ ok: false });
  });
});
