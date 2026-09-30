import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { DEVICE_COOKIE, DEVICE_COOKIE_OPTIONS, resolveDeviceId } from "./generation/device";

/* Paths that must stay reachable without the studio password: the provider
   fetches uploaded inputs from /api/media, and uptime checks read /api/health
   (which only reports booleans). */
const PUBLIC_PATHS = [/^\/api\/media\//, /^\/api\/health$/];

/** With HF_API_KEY set on the server, anyone who can open the studio spends the
    owner's credits. APP_PASSWORD puts the whole app — pages, server actions,
    upload routes — behind HTTP Basic auth. Any username is accepted. */
export function proxy(request: NextRequest) {
  const password = process.env.APP_PASSWORD;
  const path = request.nextUrl.pathname;
  if (password && !PUBLIC_PATHS.some((pattern) => pattern.test(path)) && !authorized(request, password)) {
    return new NextResponse("Authentication required", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="OpenHiggsfield", charset="UTF-8"' },
    });
  }

  if (path.startsWith("/api/")) return NextResponse.next();
  const { deviceId, minted } = resolveDeviceId(request.cookies.get(DEVICE_COOKIE)?.value);
  if (!minted) return NextResponse.next();
  const response = NextResponse.next();
  response.cookies.set(DEVICE_COOKIE, deviceId, DEVICE_COOKIE_OPTIONS);
  return response;
}

function authorized(request: NextRequest, password: string): boolean {
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Basic ")) return false;
  let decoded: string;
  try {
    decoded = atob(header.slice(6).trim());
  } catch {
    return false;
  }
  const colon = decoded.indexOf(":");
  return colon >= 0 && safeEqual(decoded.slice(colon + 1), password);
}

/** Compares without an early exit, so response time does not reveal how much
    of a guess was right. */
export function safeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
