#!/usr/bin/env node
/**
 * Architecture guard. Enforces the rules in ARCHITECTURE.md §6 that a build
 * cannot catch on its own.
 *
 *   node tools/verify.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');

const failures = [];
const notes = [];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

const files = walk(SRC);
const rel = (f) => path.relative(ROOT, f);

for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const lines = src.split('\n');
  const dir = path.relative(SRC, path.dirname(f)).split(path.sep)[0];

  // main.js is the composition root: it is the one place allowed to import
  // every system in order to register them.
  const isRoot = path.relative(SRC, f) === 'main.js';

  lines.forEach((line, i) => {
    const at = `${rel(f)}:${i + 1}`;
    const isComment = /^\s*(\/\/|\*|\/\*)/.test(line);

    // Rule 1 — determinism.
    if (!isComment && /\bMath\.random\s*\(/.test(line)) {
      failures.push(`${at}  Math.random() is banned; draw from ctx.rng`);
    }

    // Rule 2 — no cross-directory imports outside core.
    const imp = line.match(/^\s*import[\s\S]*?from\s+['"](\.[^'"]+)['"]/);
    if (imp && !isRoot) {
      const target = path.resolve(path.dirname(f), imp[1]);
      const tdir = path.relative(SRC, path.dirname(target)).split(path.sep)[0];
      if (tdir && tdir !== dir && tdir !== 'core' && tdir !== '..') {
        // materials is a leaf library the world and fx layers are allowed to use
        const allowed = tdir === 'materials' && (dir === 'world' || dir === 'fx');
        if (!allowed) {
          failures.push(`${at}  cross-directory import ${dir} -> ${tdir} (use ctx.get)`);
        }
      }
    }
  });

  // Rule 4 — no external assets.
  if (/\b(fetch|XMLHttpRequest|TextureLoader|GLTFLoader|FileLoader|ImageBitmapLoader)\b/.test(src)) {
    failures.push(`${rel(f)}  loads an external asset; everything must be generated in code`);
  }
  if (/https?:\/\//.test(src.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''))) {
    failures.push(`${rel(f)}  references a URL outside a comment`);
  }
}

// Every system in the registry must exist and expose the lifecycle contract.
const main = fs.readFileSync(path.join(SRC, 'main.js'), 'utf8');
const registered = [...main.matchAll(/engine\.register\('([a-z]+)'/g)].map((m) => m[1]);
const EXPECTED = ['render', 'materials', 'sky', 'physics', 'world', 'player', 'fx', 'ai', 'weapons', 'ui', 'audio'];
for (const key of EXPECTED) {
  if (!registered.includes(key)) failures.push(`main.js  system "${key}" is not registered`);
}
// render must come first, materials second — later systems read them in init().
if (registered[0] !== 'render') failures.push('main.js  render must be registered first');
if (registered[1] !== 'materials') failures.push('main.js  materials must be registered second');
notes.push(`registered systems: ${registered.join(', ')}`);

// The assets directory must not be referenced by the game.
const usesAssets = files.some((f) => /['"][^'"]*assets\//.test(fs.readFileSync(f, 'utf8')));
if (usesAssets) failures.push('src  references assets/ — the game must be fully procedural');

for (const n of notes) console.log(`  ${n}`);
if (failures.length) {
  console.log(`\n${failures.length} violation(s):`);
  for (const f of failures) console.log('  ' + f);
  process.exit(1);
}
console.log(`\nverify: ${files.length} files clean`);
