import { GenerationError, MESSAGES, redact } from "../errors";

const DETAIL_MAX = 240;

/** Turns a non-2xx provider response into a GenerationError with a message a
    person can act on. The provider's own detail is kept where it explains the
    problem (validation errors), trimmed and scrubbed of anything credential-
    shaped; it is dropped where it would only restate the status. */
export function providerError(
  status: number,
  body: unknown,
  secrets: readonly string[] = [],
): GenerationError {
  const detail = detailOf(body, secrets);
  const lower = detail.toLowerCase();

  if (status === 402 || /insufficient|not enough credit|balance|out of credits|payment required/.test(lower)) {
    return new GenerationError("insufficient_balance", MESSAGES.insufficientBalance, { status });
  }
  if (status === 401) {
    return new GenerationError("invalid_api_key", MESSAGES.invalidApiKey, { status });
  }
  if (status === 403) {
    if (/invalid|unauthori[sz]ed|api key|credential/.test(lower)) {
      return new GenerationError("invalid_api_key", MESSAGES.invalidApiKey, { status });
    }
    return new GenerationError("forbidden", MESSAGES.forbidden, { status });
  }
  if (status === 429) {
    return new GenerationError("rate_limited", MESSAGES.rateLimited, { status, retryable: true });
  }
  if (status === 408 || status === 504) {
    return new GenerationError("timeout", "Provider timeout — the provider did not answer in time.", {
      status,
      retryable: true,
    });
  }
  if (status >= 500) {
    return new GenerationError("provider_unavailable", `The provider is temporarily unavailable (${status}) — try again shortly.`, {
      status,
      retryable: true,
    });
  }
  if (status === 404) {
    return new GenerationError(
      "invalid_model",
      detail && !/^not found$/i.test(detail) ? `Invalid model — ${detail}` : MESSAGES.invalidModel,
      { status },
    );
  }
  if (status === 400 || status === 422) {
    if (/model/.test(lower) && /unknown|invalid|not found|unsupported/.test(lower)) {
      return new GenerationError("invalid_model", `Invalid model — ${detail}`, { status });
    }
    return new GenerationError(
      "unsupported_settings",
      detail ? `Unsupported settings — ${detail}` : "Unsupported settings — the provider rejected the request.",
      { status },
    );
  }
  return new GenerationError(
    "provider_error",
    detail ? `Provider error (${status}) — ${detail}` : `Provider error (${status}).`,
    { status },
  );
}

/** Reads the useful sentence out of the shapes providers answer with:
    `{detail: "..."}`, FastAPI's `{detail: [{loc, msg}]}`, `{error: {message}}`,
    `{message}`, or a bare string. */
export function detailOf(body: unknown, secrets: readonly string[] = []): string {
  const text = rawDetail(body);
  if (!text) return "";
  const clean = redact(text.replace(/\s+/g, " ").trim(), secrets);
  /* HTML error pages from a gateway say nothing a person can use. */
  if (/^<(!doctype|html)/i.test(clean)) return "";
  return clean.length > DETAIL_MAX ? `${clean.slice(0, DETAIL_MAX - 1)}…` : clean;
}

function rawDetail(body: unknown): string {
  if (typeof body === "string") return body;
  if (body === null || typeof body !== "object") return "";
  const record = body as Record<string, unknown>;
  for (const key of ["detail", "error", "message", "msg", "errors"]) {
    const value = record[key];
    const text = fromValue(value);
    if (text) return text;
  }
  return "";
}

function fromValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          const entry = item as { loc?: unknown; msg?: unknown; message?: unknown };
          const msg = typeof entry.msg === "string" ? entry.msg : typeof entry.message === "string" ? entry.message : "";
          const loc = Array.isArray(entry.loc)
            ? entry.loc.filter((part) => part !== "body").join(".")
            : "";
          return loc && msg ? `${loc}: ${msg}` : msg;
        }
        return "";
      })
      .filter(Boolean)
      .join("; ");
  }
  if (value && typeof value === "object") {
    const nested = value as { message?: unknown; detail?: unknown };
    if (typeof nested.message === "string") return nested.message;
    if (typeof nested.detail === "string") return nested.detail;
  }
  return "";
}
