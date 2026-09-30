import { GenerationError, MESSAGES } from "./errors";

export const PLATFORM_KEY_COOKIE = "api_key";

export const PLATFORM_KEY_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 30,
};

/** A key is `id:secret` — both halves non-empty, no whitespace inside. Returns
    the trimmed key, or null when the shape is wrong. */
export function normalizeApiKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim();
  if (!key || /\s/.test(key)) return null;
  const colon = key.indexOf(":");
  if (colon <= 0 || colon === key.length - 1) return null;
  return key;
}

export function encodeCredentials(apiKey: string): string {
  return JSON.stringify({ apiKey });
}

export function decodeCredentials(raw: string | undefined): { apiKey: string } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const apiKey = normalizeApiKey((parsed as { apiKey?: unknown }).apiKey);
    return apiKey ? { apiKey } : null;
  } catch {
    return null;
  }
}

/** Reads the key a visitor typed into the studio. Throws GenerationError so the
    action wrapper can hand the message back as data. */
export function parseCredentialInput(data: unknown): { apiKey: string } {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new GenerationError("invalid_request", "Enter an API key.");
  }
  const record = data as { apiKey?: unknown; api_key?: unknown };
  const raw = record.apiKey ?? record.api_key;
  if (typeof raw !== "string" || !raw.trim()) {
    throw new GenerationError("invalid_request", "Enter an API key.");
  }
  const apiKey = normalizeApiKey(raw);
  if (!apiKey) throw new GenerationError("invalid_api_key", MESSAGES.keyFormat);
  return { apiKey };
}

/** The provider's scheme: `Authorization: Key <id:secret>`. */
export function toAuthorizationHeader(apiKey: string): string {
  const key = normalizeApiKey(apiKey);
  if (!key) throw new GenerationError("invalid_api_key", MESSAGES.keyFormat);
  return `Key ${key}`;
}
