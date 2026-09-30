import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { hasValidServerApiKey, isProviderConfigured } from "@/generation/config";
import { PLATFORM_KEY_COOKIE, decodeCredentials } from "@/generation/credentials";
import { isStorageConfigured } from "@/generation/storage/config";

export const dynamic = "force-dynamic";

/** Configuration health, as booleans only — never a value, a length, or a hint
    of a credential. providerConfigured means a valid HF_API_BASE_URL plus a
    usable key (HF_API_KEY, or one saved in this browser). */
export async function GET() {
  let browserKey = false;
  try {
    const jar = await cookies();
    browserKey = decodeCredentials(jar.get(PLATFORM_KEY_COOKIE)?.value) !== null;
  } catch {
    browserKey = false;
  }
  return NextResponse.json(
    {
      providerConfigured: isProviderConfigured() && (hasValidServerApiKey() || browserKey),
      storageConfigured: isStorageConfigured(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
