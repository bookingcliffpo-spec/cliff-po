import { describe, expect, it } from "vitest";

import { GenerationError, redact, toFailure } from "@/generation/errors";
import { detailOf, providerError } from "@/generation/higgsfield/provider-errors";

import { API_KEY } from "./helpers";

describe("provider error parsing", () => {
  it.each([
    [401, { detail: "Unauthorized" }, "invalid_api_key", /Invalid API key/],
    [403, { detail: "Invalid API key" }, "invalid_api_key", /Invalid API key/],
    [403, { detail: "Model not enabled for this account" }, "forbidden", /Access denied/],
    [402, null, "insufficient_balance", /Insufficient provider balance/],
    [400, { detail: "Insufficient credits" }, "insufficient_balance", /Insufficient provider balance/],
    [429, { detail: "slow down" }, "rate_limited", /Rate limited/],
    [500, "<html>oops</html>", "provider_unavailable", /temporarily unavailable \(500\)/],
    [503, null, "provider_unavailable", /temporarily unavailable \(503\)/],
    [504, null, "timeout", /Provider timeout/],
    [404, { detail: "Not Found" }, "invalid_model", /^Invalid model — the provider/],
    [422, { detail: "duration must be <= 15" }, "unsupported_settings", /Unsupported settings — duration must be <= 15/],
    [400, { detail: "Unknown model foo" }, "invalid_model", /Invalid model — Unknown model foo/],
  ] as const)("maps %i %j to %s", (status, body, code, message) => {
    const error = providerError(status, body);
    expect(error).toBeInstanceOf(GenerationError);
    expect(error.code).toBe(code);
    expect(error.message).toMatch(message);
    expect(error.status).toBe(status);
  });

  it("marks only transient failures retryable", () => {
    expect(providerError(429, null).retryable).toBe(true);
    expect(providerError(502, null).retryable).toBe(true);
    expect(providerError(401, null).retryable).toBe(false);
    expect(providerError(422, null).retryable).toBe(false);
  });

  it("reads FastAPI-style validation arrays", () => {
    const body = {
      detail: [
        { loc: ["body", "duration"], msg: "ensure this value is less than or equal to 15" },
        { loc: ["body", "resolution"], msg: "unexpected value" },
      ],
    };
    expect(detailOf(body)).toBe(
      "duration: ensure this value is less than or equal to 15; resolution: unexpected value",
    );
  });

  it("reads nested error objects and bare messages", () => {
    expect(detailOf({ error: { message: "bad aspect" } })).toBe("bad aspect");
    expect(detailOf({ message: "plain" })).toBe("plain");
    expect(detailOf("text body")).toBe("text body");
    expect(detailOf(null)).toBe("");
  });

  it("drops HTML error pages and truncates long details", () => {
    expect(detailOf("<!DOCTYPE html><html>502</html>")).toBe("");
    expect(detailOf({ detail: "x".repeat(1000) }).length).toBeLessThanOrEqual(240);
  });

  it("never echoes the credential back", () => {
    const error = providerError(422, { detail: `bad header Key ${API_KEY}` }, [API_KEY]);
    expect(error.message).not.toContain(API_KEY);
    expect(error.message).not.toContain("fake_secret_value");
  });
});

describe("redaction and serializable failures", () => {
  it("scrubs known secrets, Authorization values and id:secret pairs", () => {
    const text = `Authorization: Key ${API_KEY} Bearer abc.def.ghi123 other ${API_KEY.split(":")[1]}`;
    const clean = redact(text, [API_KEY]);
    expect(clean).not.toContain("fake_secret_value");
    expect(clean).not.toContain("abc.def.ghi123");
    expect(redact("Key rejected by server")).toBe("Key rejected by server");
  });

  it("passes GenerationError messages through and hides everything else", () => {
    expect(toFailure(new GenerationError("rate_limited", "Rate limited", { status: 429 }))).toEqual({
      ok: false,
      error: "Rate limited",
      code: "rate_limited",
      status: 429,
    });
    const leaked = toFailure(new Error(`fetch failed for https://x?key=${API_KEY}`));
    expect(leaked).toEqual({ ok: false, error: "Something went wrong on the server. Try again.", code: "unknown" });
  });

  it("produces plain JSON-serializable values", () => {
    const failure = toFailure(new GenerationError("timeout", "Provider timeout", { status: 504 }));
    expect(JSON.parse(JSON.stringify(failure))).toEqual(failure);
  });
});
