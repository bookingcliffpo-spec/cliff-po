import { fail, type ActionFailure, type ErrorCode } from "./result";

/** A failure whose message is already safe to show a person: no credentials,
    no headers, no stack. Anything thrown on the server that is not one of these
    is reported with a generic message instead of its own. */
export class GenerationError extends Error {
  readonly code: ErrorCode;
  readonly status?: number;
  /** Whether the same call may succeed if simply repeated. */
  readonly retryable: boolean;

  constructor(
    code: ErrorCode,
    message: string,
    options: { status?: number; retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "GenerationError";
    this.code = code;
    this.status = options.status;
    this.retryable = options.retryable ?? false;
  }
}

export const MESSAGES = {
  missingApiKey:
    "No API key configured. Set HF_API_KEY on the server, or add a key in the studio.",
  missingBaseUrl: "Missing HF_API_BASE_URL — set the generation API origin on the server.",
  invalidBaseUrl: "HF_API_BASE_URL is not a valid http(s) URL.",
  invalidServerKey: "HF_API_KEY is malformed — it must be id:secret.",
  keyFormat: "API key must be id:secret.",
  invalidApiKey: "Invalid API key — the provider rejected the credential.",
  forbidden: "Access denied — this API key is not allowed to use that model or endpoint.",
  insufficientBalance: "Insufficient provider balance — add credits with the provider, then retry.",
  rateLimited: "Rate limited by the provider — wait a moment, then retry.",
  providerUnavailable: "The provider is temporarily unavailable — try again shortly.",
  invalidModel: "Invalid model — the provider does not recognise this model.",
  network: "Could not reach the provider — check HF_API_BASE_URL and the server's network.",
  unknown: "Something went wrong on the server. Try again.",
} as const;

export function timeoutMessage(seconds: number): string {
  return `Provider timeout — no response within ${seconds}s.`;
}

/** Converts anything caught on the server into a serializable failure. Only
    GenerationError messages are passed through; everything else is generic,
    because an arbitrary Error.message can carry a URL, a header, or a key. */
export function toFailure(caught: unknown, secrets: readonly string[] = []): ActionFailure {
  if (caught instanceof GenerationError) {
    return fail(redact(caught.message, secrets), caught.code, caught.status);
  }
  return fail(MESSAGES.unknown, "unknown");
}

/* Case-sensitive and shaped like a token (8+ token characters including a
   digit, colon, dot or underscore), so prose such as "Key rejected" survives. */
const AUTH_PATTERN = /\b(Key|Bearer|Basic)\s+(?=[A-Za-z0-9._~+/=:-]*[0-9:._])[A-Za-z0-9._~+/=:-]{8,}/g;
const PAIR_PATTERN = /\b[A-Za-z0-9_-]{8,}:[A-Za-z0-9_-]{16,}\b/g;

/** Scrubs credentials out of text before it is logged or shown: the literal
    secrets we hold, anything shaped like an Authorization value, and anything
    shaped like an id:secret pair. */
export function redact(text: string, secrets: readonly string[] = []): string {
  let out = text;
  for (const secret of secrets) {
    if (!secret) continue;
    out = out.split(secret).join("[redacted]");
    const colon = secret.indexOf(":");
    if (colon > 0) {
      const secretPart = secret.slice(colon + 1);
      if (secretPart.length >= 6) out = out.split(secretPart).join("[redacted]");
    }
  }
  return out.replace(AUTH_PATTERN, "$1 [redacted]").replace(PAIR_PATTERN, "[redacted]");
}
