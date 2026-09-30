import { demoSvg } from "@/generation/free/demo-art";

/** Offline placeholder images for the "Demo · Offline" model. */
export function GET(request: Request) {
  const url = new URL(request.url);
  const prompt = (url.searchParams.get("p") ?? "").slice(0, 280);
  const seed = clamp(Number(url.searchParams.get("s")), 1, 2_147_483_647, 1);
  const width = clamp(Number(url.searchParams.get("w")), 64, 2048, 1024);
  const height = clamp(Number(url.searchParams.get("h")), 64, 2048, 1024);
  return new Response(demoSvg(prompt, seed, width, height), {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=31536000, immutable",
      /* SVG is a document; nothing inside it may run. */
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}
