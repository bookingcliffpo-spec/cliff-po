"use server";

import { cookies } from "next/headers";

import type { ProviderId } from "./catalog/types";
import { availableProviders } from "./free/providers";
import { hasValidServerApiKey, isProviderConfigured, readServerApiKey } from "./config";
import {
  PLATFORM_KEY_COOKIE,
  PLATFORM_KEY_COOKIE_OPTIONS,
  decodeCredentials,
  encodeCredentials,
  parseCredentialInput,
} from "./credentials";
import { toFailure } from "./errors";
import type { QueuedGeneration, StatusResult } from "./higgsfield/types";
import { ok, type ActionResult } from "./result";
import { cancelRequest, pollStatuses, submitPlane, type CredentialSource } from "./service";
import { storageDriver, type StorageDriver } from "./storage/config";

/* Every export here is a server action and every one returns an ActionResult.
   None of them throws: production React replaces a thrown error's message with
   an opaque digest on its way to the client, so the studio could only ever say
   "something failed". Failures are values, sanitized on this side. */

export type StudioStatus = {
  /** Which key generations will be billed to, or null when there is none. */
  credential: CredentialSource | null;
  /** HF_API_BASE_URL is set and valid. */
  providerConfigured: boolean;
  /** HF_API_KEY is set but malformed. */
  serverKeyInvalid: boolean;
  storage: StorageDriver | null;
  /** Providers a request can go to: "higgsfield" when HF_API_BASE_URL is set,
      plus the keyless ones enabled on this server. */
  providers: ProviderId[];
};

export async function getStudioStatus(): Promise<ActionResult<StudioStatus>> {
  try {
    const cookieKey = await readCookieKey();
    const serverKey = hasValidServerApiKey();
    let serverKeyInvalid = false;
    try {
      readServerApiKey();
    } catch {
      serverKeyInvalid = true;
    }
    return ok({
      credential: serverKey ? "server" : cookieKey ? "browser" : null,
      providerConfigured: isProviderConfigured(),
      serverKeyInvalid,
      storage: storageDriver(),
      providers: availableProviders(),
    });
  } catch (caught) {
    return toFailure(caught);
  }
}

export async function savePlatformCredentials(data: unknown): Promise<ActionResult<null>> {
  try {
    const { apiKey } = parseCredentialInput(data);
    const jar = await cookies();
    jar.set(PLATFORM_KEY_COOKIE, encodeCredentials(apiKey), PLATFORM_KEY_COOKIE_OPTIONS);
    return ok(null);
  } catch (caught) {
    return toFailure(caught);
  }
}

export async function clearPlatformCredentials(): Promise<ActionResult<null>> {
  try {
    const jar = await cookies();
    jar.set(PLATFORM_KEY_COOKIE, "", { ...PLATFORM_KEY_COOKIE_OPTIONS, maxAge: 0 });
    return ok(null);
  } catch (caught) {
    return toFailure(caught);
  }
}

export async function submitGeneration(plane: unknown): Promise<ActionResult<QueuedGeneration>> {
  return submitPlane(plane, { cookieApiKey: await readCookieKey() });
}

/** Every request in flight, answered in one round trip. */
export async function getGenerationStatuses(data: unknown): Promise<ActionResult<StatusResult[]>> {
  return pollStatuses(data, { cookieApiKey: await readCookieKey() });
}

/** Stops a queued or running generation. */
export async function cancelGeneration(data: unknown): Promise<ActionResult<null>> {
  return cancelRequest(data, { cookieApiKey: await readCookieKey() });
}

async function readCookieKey(): Promise<string | null> {
  try {
    const jar = await cookies();
    return decodeCredentials(jar.get(PLATFORM_KEY_COOKIE)?.value)?.apiKey ?? null;
  } catch {
    return null;
  }
}
