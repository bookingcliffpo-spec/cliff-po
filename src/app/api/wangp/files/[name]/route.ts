import { fetchWanGPFile } from "@/generation/free/wangp-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Streams a WanGP output from the bridge, so the browser never needs the
    bridge's address or token. Range requests pass through for video seeking. */
export async function GET(request: Request, context: { params: Promise<{ name: string }> }) {
  const { name } = await context.params;
  const upstream = await fetchWanGPFile(name, request.headers.get("range"));
  if (!upstream || !upstream.body) return new Response("Not found", { status: 404 });
  const headers = new Headers({ "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=86400" });
  for (const key of ["content-type", "content-length", "content-range", "accept-ranges"]) {
    const value = upstream.headers.get(key);
    if (value) headers.set(key, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
