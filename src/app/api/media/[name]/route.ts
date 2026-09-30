import { localMediaDir } from "@/generation/storage/config";
import { openStored } from "@/generation/storage/local";

export const runtime = "nodejs";

/** Serves files from the local media directory: uploads stored by the local
    driver, and images made by a local Stable Diffusion server. Public on
    purpose: the provider fetches inputs from here without the studio's
    password. Names are random 128-bit ids, so a URL is only known to whoever
    created it. */
export async function GET(_request: Request, context: { params: Promise<{ name: string }> }) {
  const { name } = await context.params;
  const file = await openStored(localMediaDir(), name);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(file.stream, {
    headers: {
      "Content-Type": file.type,
      "Content-Length": String(file.size),
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
