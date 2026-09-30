import { describe, expect, it } from "vitest";

import { readProviderConfig, readServerApiKey, isProviderConfigured } from "@/generation/config";
import {
  decodeCredentials,
  encodeCredentials,
  normalizeApiKey,
  parseCredentialInput,
  toAuthorizationHeader,
} from "@/generation/credentials";
import { GenerationError } from "@/generation/errors";

describe("credential parsing", () => {
  it("accepts id:secret and trims surrounding whitespace", () => {
    expect(normalizeApiKey("  abc:def  ")).toBe("abc:def");
    expect(normalizeApiKey("id:sec:ret")).toBe("id:sec:ret");
  });

  it.each([["", "no colon", ":secret", "id:", "id :secret", "id:sec ret"], [undefined], [42]].flat())(
    "rejects %j",
    (raw) => {
      expect(normalizeApiKey(raw)).toBeNull();
    },
  );

  it("parses studio input under either field name", () => {
    expect(parseCredentialInput({ api_key: " a:b " })).toEqual({ apiKey: "a:b" });
    expect(parseCredentialInput({ apiKey: "a:b" })).toEqual({ apiKey: "a:b" });
  });

  it("throws a GenerationError with a safe message for bad input", () => {
    expect(() => parseCredentialInput(null)).toThrow(GenerationError);
    expect(() => parseCredentialInput({ api_key: "   " })).toThrow("Enter an API key.");
    try {
      parseCredentialInput({ api_key: "nocolon" });
    } catch (caught) {
      expect(caught).toBeInstanceOf(GenerationError);
      expect((caught as GenerationError).code).toBe("invalid_api_key");
      expect((caught as GenerationError).message).toBe("API key must be id:secret.");
    }
  });

  it("round-trips the cookie and ignores anything malformed", () => {
    expect(decodeCredentials(encodeCredentials("a:b"))).toEqual({ apiKey: "a:b" });
    expect(decodeCredentials(undefined)).toBeNull();
    expect(decodeCredentials("not json")).toBeNull();
    expect(decodeCredentials(JSON.stringify({ apiKey: "bad" }))).toBeNull();
    expect(decodeCredentials(JSON.stringify([1]))).toBeNull();
  });
});

describe("authorization header", () => {
  it("formats the provider's Key scheme", () => {
    expect(toAuthorizationHeader("id:secret")).toBe("Key id:secret");
    expect(toAuthorizationHeader(" id:secret ")).toBe("Key id:secret");
  });

  it("refuses to build a header from a malformed key", () => {
    expect(() => toAuthorizationHeader("secret-only")).toThrow(GenerationError);
  });
});

describe("server configuration", () => {
  it("reports a missing HF_API_BASE_URL by name", () => {
    expect(() => readProviderConfig({})).toThrow(/Missing HF_API_BASE_URL/);
    expect(isProviderConfigured({})).toBe(false);
  });

  it("rejects a base URL that is not http(s) or carries credentials", () => {
    expect(() => readProviderConfig({ HF_API_BASE_URL: "ftp://x" })).toThrow(/not a valid/);
    expect(() => readProviderConfig({ HF_API_BASE_URL: "https://u:p@x.test" })).toThrow(/not a valid/);
    expect(() => readProviderConfig({ HF_API_BASE_URL: "nonsense" })).toThrow(/not a valid/);
  });

  it("normalizes a valid base URL", () => {
    expect(readProviderConfig({ HF_API_BASE_URL: " https://api.example.test/v1/ " })).toEqual({
      baseUrl: "https://api.example.test/v1",
    });
  });

  it("treats an unset HF_API_KEY as absent but a malformed one as an error", () => {
    expect(readServerApiKey({})).toBeNull();
    expect(readServerApiKey({ HF_API_KEY: "  " })).toBeNull();
    expect(readServerApiKey({ HF_API_KEY: "a:b" })).toBe("a:b");
    expect(() => readServerApiKey({ HF_API_KEY: "oops" })).toThrow(/HF_API_KEY is malformed/);
  });
});
