// Builds public/cinematic-prompt.html: a single self-contained page with the
// Director's Panel. Option lists come from src/generation/cinema.ts so the
// page and the studio never disagree.
//   node --experimental-strip-types tools/build-cinematic-html.mjs
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = path.join(mkdtempSync(path.join(tmpdir(), "cinema-")), "cinema.mts");
copyFileSync(path.join(root, "src/generation/cinema.ts"), tmp);
const m = await import(pathToFileURL(tmp).href);

const data = {
  GENRES: m.GENRES, ERAS: m.ERAS, TEMPOS: m.TEMPOS, CAMERAS: m.CAMERAS, LENSES: m.LENSES,
  APERTURES: m.APERTURES, MOVES: m.MOVES, PALETTES: m.PALETTES, LIGHTING: m.LIGHTING, LIGHT_ANGLES: m.LIGHT_ANGLES,
};
const template = readFileSync(path.join(root, "tools/cinematic-prompt.template.html"), "utf8");
const html = template.replace("__DATA__", JSON.stringify(data).replace(/</g, "\\u003c"));
const out = path.join(root, "public/cinematic-prompt.html");
writeFileSync(out, html);
console.log(`wrote ${path.relative(root, out)} (${(html.length / 1024).toFixed(1)} KB)`);
