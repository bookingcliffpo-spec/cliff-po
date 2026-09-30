import { toPlatform } from "./adapters";
import { findModel, providerOf } from "./catalog";
import { generateFree, isFreeRequestId, statusFromFreeId } from "./free/providers";
import { readProviderConfig, readServerApiKey } from "./config";
import { GenerationError, MESSAGES, toFailure } from "./errors";
import { createHiggsfieldClient, type Logger } from "./higgsfield/client";
import type { QueuedGeneration, StatusResult } from "./higgsfield/types";
import { ok, type ActionResult, type ErrorCode } from "./result";
import { validatePlane } from "./validate-plane";

/** The generation service with its surroundings passed in, so it can be tested
    without Next: the server actions supply the real env and cookie, tests
    supply a fake fetch. Every function returns an ActionResult and never
    throws. */
export type ServiceDeps = {
  env?: Record<string, string | undefined>;
  /** Key a visitor saved in the studio (httpOnly cookie), if any. */
  cookieApiKey?: string | null;
  fetch?: typeof fetch;
  logger?: Logger | null;
  sleep?: (ms: number) => Promise<void>;
};

export type CredentialSource = "server" | "browser";

export const MAX_STATUS_BATCH = 50;

/** HF_API_KEY wins over a key saved in the browser: when the owner configured a
    server key, that is the one that is billed. */
export function resolveCredentials(deps: ServiceDeps): {
  apiKey: string;
  baseUrl: string;
  source: CredentialSource;
} {
  const env = deps.env ?? process.env;
  const { baseUrl } = readProviderConfig(env);
  const serverKey = readServerApiKey(env);
  if (serverKey) return { apiKey: serverKey, baseUrl, source: "server" };
  if (deps.cookieApiKey) return { apiKey: deps.cookieApiKey, baseUrl, source: "browser" };
  throw new GenerationError("missing_api_key", MESSAGES.missingApiKey);
}

function clientFor(deps: ServiceDeps) {
  const credentials = resolveCredentials(deps);
  return {
    credentials,
    client: createHiggsfieldClient({
      apiKey: credentials.apiKey,
      baseUrl: credentials.baseUrl,
      fetch: deps.fetch,
      logger: deps.logger,
      sleep: deps.sleep,
    }),
  };
}

function secretsOf(deps: ServiceDeps): string[] {
  const env = deps.env ?? process.env;
  return [env.HF_API_KEY ?? "", deps.cookieApiKey ?? ""].filter(Boolean);
}

export async function submitPlane(
  data: unknown,
  deps: ServiceDeps = {},
): Promise<ActionResult<QueuedGeneration>> {
  try {
    const env = deps.env ?? process.env;
    const plane = validatePlane(data, { allowPrivateMedia: env.ALLOW_PRIVATE_MEDIA_URLS === "true" });
    const provider = providerOf(findModel(plane.model)!);
    if (provider !== "higgsfield") {
      const result = await generateFree(plane, provider, { env, fetch: deps.fetch });
      return ok({ requestId: result.requestId, status: result.status, result });
    }
    const { path, body } = toPlatform(plane);
    const { client } = clientFor(deps);
    return ok(await client.submit(path, body));
  } catch (caught) {
    logUnexpected(deps, "submit", caught);
    return toFailure(caught, secretsOf(deps));
  }
}

/** Codes a later poll cannot fix. A request that fails with one of these is
    settled at once rather than retried until the deadline. */
const FINAL_CODES = new Set<ErrorCode>([
  "missing_api_key",
  "invalid_api_key",
  "forbidden",
  "missing_config",
  "invalid_request",
  "not_found",
  "insufficient_balance",
]);

export function isFinalCode(code: ErrorCode | undefined): boolean {
  return code !== undefined && FINAL_CODES.has(code);
}

export async function pollStatuses(
  data: unknown,
  deps: ServiceDeps = {},
): Promise<ActionResult<StatusResult[]>> {
  try {
    const env = deps.env ?? process.env;
    const requestIds = parseRequestIds(data);
    /* Keyless runs answer from their id; only Higgsfield ids need the key,
       so a studio with no key can still resume its free runs. */
    const hosted = requestIds.filter((id) => !isFreeRequestId(id));
    const client = hosted.length ? clientFor(deps).client : null;
    const secrets = secretsOf(deps);
    /* Next dispatches server actions one at a time per client, so a poll per
       run would queue ahead of the next submit — the fan-out belongs on this
       side of the call, where it is genuinely parallel. */
    const results = await Promise.all(
      requestIds.map(async (requestId): Promise<StatusResult> => {
        if (isFreeRequestId(requestId)) {
          const status = statusFromFreeId(requestId, env);
          return status
            ? { requestId, status }
            : { requestId, error: "This run's result could not be recovered.", code: "not_found", final: true };
        }
        try {
          return { requestId, status: await client!.status(requestId) };
        } catch (caught) {
          if (caught instanceof GenerationError && caught.status === 404) {
            return {
              requestId,
              error: "The provider no longer knows this request.",
              code: "not_found",
              final: true,
            };
          }
          const failure = toFailure(caught, secrets);
          return { requestId, error: failure.error, code: failure.code, final: isFinalCode(failure.code) };
        }
      }),
    );
    return ok(results);
  } catch (caught) {
    logUnexpected(deps, "status", caught);
    return toFailure(caught, secretsOf(deps));
  }
}

function parseRequestIds(data: unknown): string[] {
  const requestIds =
    data !== null && typeof data === "object" && !Array.isArray(data)
      ? (data as { requestIds?: unknown }).requestIds
      : undefined;
  if (!Array.isArray(requestIds) || requestIds.length === 0) {
    throw new GenerationError("invalid_request", "Invalid status request.");
  }
  if (requestIds.length > MAX_STATUS_BATCH) {
    throw new GenerationError("invalid_request", "Too many requests in one status poll.");
  }
  const unique = new Set<string>();
  for (const requestId of requestIds) {
    /* Keyless ids carry their result URL, so they may be long. */
    const max = typeof requestId === "string" && isFreeRequestId(requestId) ? 4000 : 200;
    if (typeof requestId !== "string" || !requestId || requestId.length > max) {
      throw new GenerationError("invalid_request", "Invalid request id.");
    }
    unique.add(requestId);
  }
  return [...unique];
}

/** Unexpected exceptions are logged by name only: their messages can carry
    URLs or payload fragments, and the person already gets a safe summary. */
function logUnexpected(deps: ServiceDeps, where: string, caught: unknown) {
  if (caught instanceof GenerationError) return;
  const logger = deps.logger === undefined ? console : deps.logger;
  logger?.warn(`[generation] unexpected ${where} failure`, caught instanceof Error ? caught.name : typeof caught);
}

