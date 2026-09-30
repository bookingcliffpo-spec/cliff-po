/** What every server action hands back. Production React masks the message of
    anything thrown across the server/client boundary (the client sees only a
    digest), so failures travel as plain data instead of as exceptions. */
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: number; code?: ErrorCode };

export type ActionFailure = Extract<ActionResult<never>, { ok: false }>;

/** Stable, machine-readable failure kinds. The UI keys behavior off these
    (open the key modal, retry, stop polling) — never off message text. */
export type ErrorCode =
  | "missing_api_key"
  | "invalid_api_key"
  | "forbidden"
  | "insufficient_balance"
  | "missing_config"
  | "invalid_model"
  | "unsupported_settings"
  | "invalid_request"
  | "upload_failed"
  | "timeout"
  | "rate_limited"
  | "provider_unavailable"
  | "provider_error"
  | "network_error"
  | "not_found"
  | "unknown";

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function fail(error: string, code?: ErrorCode, status?: number): ActionFailure {
  return {
    ok: false,
    error,
    ...(code ? { code } : {}),
    ...(typeof status === "number" ? { status } : {}),
  };
}

/** Narrows anything that came back from a server action. A response that is
    not a result at all (a stale deployment, a proxy error page) is reported as
    a failure rather than trusted. */
export function asActionResult<T>(value: unknown): ActionResult<T> {
  if (value !== null && typeof value === "object" && "ok" in value) {
    const record = value as { ok: unknown; error?: unknown };
    if (record.ok === true) return value as ActionResult<T>;
    if (record.ok === false && typeof record.error === "string") return value as ActionResult<T>;
  }
  return fail("The server returned an unexpected response. Reload and try again.", "unknown");
}

/** Calls a server action from the client and guarantees a result. The action
    itself never throws, but the transport can (offline, deployment swapped
    mid-session, the action id no longer exists), and a rejected promise must
    not escape into an unhandled rejection. */
export async function callAction<T>(run: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return asActionResult<T>(await run());
  } catch {
    return fail(
      "Could not reach the studio server. Check your connection, then reload if it persists.",
      "network_error",
    );
  }
}
