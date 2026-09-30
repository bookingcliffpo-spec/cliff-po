/** Offline placeholder art: a deterministic abstract composition seeded by the
    prompt and seed, with the prompt set in type and a DEMO tag. It is not AI —
    it exists so the whole studio can be tried and tested with no key and no
    network. */

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: number) {
  let state = seed || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 100_000) / 100_000;
  };
}

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function wrap(text: string, perLine: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > perLine && line) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    } else {
      line = next;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (words.join(" ").length > lines.join(" ").length && lines.length) {
    lines[lines.length - 1] = `${lines[lines.length - 1]!.replace(/.$/, "")}…`;
  }
  return lines;
}

export function demoSvg(prompt: string, seed: number, width: number, height: number): string {
  const random = rng(hash(`${prompt}|${seed}`));
  const hue = Math.floor(random() * 360);
  const shapes: string[] = [];
  for (let i = 0; i < 7; i++) {
    const cx = Math.round(random() * width);
    const cy = Math.round(random() * height);
    const r = Math.round((0.15 + random() * 0.45) * Math.min(width, height));
    const h = (hue + Math.round(random() * 120) - 60 + 360) % 360;
    const o = (0.25 + random() * 0.45).toFixed(2);
    shapes.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="hsl(${h} 80% 58%)" fill-opacity="${o}"/>`);
  }
  const size = Math.round(Math.min(width, height) / 18);
  const lines = wrap(prompt, Math.max(12, Math.floor((width - size * 2.8) / (size * 0.62))), 4);
  const text = lines
    .map(
      (line, i) =>
        `<text x="${Math.round(size * 1.4)}" y="${Math.round(height - size * 1.6 - (lines.length - 1 - i) * size * 1.3)}" font-size="${size}">${escape(line)}</text>`,
    )
    .join("");
  const tag = Math.round(size * 0.6);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<defs>
<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 55% 14%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360} 60% 8%)"/></linearGradient>
<filter id="b"><feGaussianBlur stdDeviation="${Math.round(Math.min(width, height) / 14)}"/></filter>
<linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0.45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.72"/></linearGradient>
</defs>
<rect width="100%" height="100%" fill="url(#g)"/>
<g filter="url(#b)">${shapes.join("")}</g>
<rect width="100%" height="100%" fill="url(#fade)"/>
<g font-family="Inter, system-ui, sans-serif" font-weight="600" fill="#fff" letter-spacing="-0.01em">${text}</g>
<g font-family="Inter, system-ui, sans-serif" font-weight="700" font-size="${tag}">
<rect x="${tag}" y="${tag}" width="${Math.round(tag * 10.2)}" height="${tag * 1.9}" rx="${tag * 0.5}" fill="#d1fe17"/>
<text x="${tag * 1.6}" y="${tag * 2.3}" fill="#0a0a0b">DEMO · NOT AI</text>
</g>
</svg>`;
}
