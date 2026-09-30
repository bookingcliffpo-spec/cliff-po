import { normalizeApiKey } from "./credentials";
import { GenerationError, MESSAGES } from "./errors";

type Env = Record<string, string | undefined>;

export type ProviderConfig = { baseUrl: string };

/** HF_API_BASE_URL, validated. Throws a GenerationError naming the variable, so
    a missing or mistyped origin reads as a configuration problem instead of an
    opaque fetch failure. */
export function readProviderConfig(env: Env = process.env): ProviderConfig {
  const raw = env.HF_API_BASE_URL?.trim();
  if (!raw) throw new GenerationError("missing_config", MESSAGES.missingBaseUrl);
  const baseUrl = parseOrigin(raw);
  if (!baseUrl) throw new GenerationError("missing_config", MESSAGES.invalidBaseUrl);
  return { baseUrl };
}

export function isProviderConfigured(env: Env = process.env): boolean {
  try {
    readProviderConfig(env);
    return true;
  } catch {
    return false;
  }
}

/** The owner's server-side key, if one is set. A set-but-malformed key is a
    configuration error rather than "no key", so it is never silently ignored in
    favour of a cookie. */
export function readServerApiKey(env: Env = process.env): string | null {
  const raw = env.HF_API_KEY;
  if (raw === undefined || raw.trim() === "") return null;
  const key = normalizeApiKey(raw);
  if (!key) throw new GenerationError("missing_config", MESSAGES.invalidServerKey);
  return key;
}

export function hasValidServerApiKey(env: Env = process.env): boolean {
  try {
    return readServerApiKey(env) !== null;
  } catch {
    return false;
  }
}

function parseOrigin(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}
