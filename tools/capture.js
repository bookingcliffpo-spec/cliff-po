#!/usr/bin/env node
/**
 * Deterministic capture harness.
 *
 * Boots the built game in headless Chromium, drives the engine through
 * window.__cod with a fixed timestep, and writes PNGs for a fixed set of
 * camera stations. Same seed + same station list => same images.
 *
 *   node tools/capture.js                  # all stations
 *   node tools/capture.js --smoke          # boot + console error check only
 *   node tools/capture.js --only spawn     # one station
 *   node tools/capture.js --out shots/x    # output directory
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + '/..';

/** Camera stations: [name, x, y, z, yawDeg, pitchDeg, description] */
export const STATIONS = [
  ['spawn', 33.5, 0.0, 3.2, 90, -2, 'Player spawn, looking west down the cross street'],
  ['intersection', 2.0, 0.0, 18.0, 0, -3, 'The main intersection from the south'],
  ['avenue-north', -3.0, 0.0, 34.0, 0, -1, 'Looking north up the avenue'],
  ['avenue-south', 4.0, 0.0, -38.0, 180, -1, 'Looking south down the avenue'],
  ['alley', -46.0, 0.0, -20.0, 180, -4, 'Service alley, north block'],
  ['storefronts', 26.0, 0.0, 16.0, 200, -6, 'Commercial frontage, south-east block'],
  ['fireescape', -22.0, 0.0, -14.0, 300, 22, 'Fire escapes above the sidewalk'],
  ['rooftopview', 0.0, 0.0, 56.0, 350, 12, 'Skyline over the block tops'],
  ['taxi', 7.5, 0.0, 6.0, 250, -8, 'Close on the wrecked cab at the intersection'],
  ['subway', -14.5, 0.0, -12.0, 180, -12, 'Subway entrance'],
  ['interior', 24.0, 0.0, 12.0, 180, -3, 'Enterable storefront'],
  ['weapon-ads', 33.5, 0.0, 3.2, 90, -2, 'ADS pose against the street'],
  ['crosstown', -60.0, 0.0, 2.0, 90, -2, 'Cross street looking west'],
  ['streetA', -6.0, 0.0, -62.0, 90, -2, 'Side Street A corridor'],
];

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const val = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };

const SMOKE = flag('--smoke');
const ONLY = val('--only', null);
const OUTDIR = path.resolve(ROOT, val('--out', 'shots'));
const SEED = val('--seed', 'NYC-1');
const W = parseInt(val('--width', '1600'), 10);
const H = parseInt(val('--height', '900'), 10);
const WARM = parseInt(val('--warm', '70'), 10);

async function main() {
  await fs.mkdir(OUTDIR, { recursive: true });

  const server = await createServer({
    root: ROOT,
    logLevel: 'error',
    server: { port: 5199, host: '127.0.0.1' },
  });
  await server.listen();
  const url = `http://127.0.0.1:5199/index.html?capture=1&seed=${encodeURIComponent(SEED)}`;

  // The environment ships its own Chromium build; prefer it over whatever
  // revision this playwright version would otherwise look for.
  const bundled = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  const exe = process.env.PLAYWRIGHT_CHROMIUM
    || (await fs.access(bundled).then(() => bundled).catch(() => undefined));

  const browser = await chromium.launch({
    executablePath: exe,
    args: [
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--disable-gpu-sandbox', '--no-sandbox', '--ignore-gpu-blocklist',
    ],
  });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });

  const errors = [];
  const warnings = [];
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error') errors.push(t);
    else if (m.type() === 'warning') warnings.push(t);
    if (t.startsWith('[stage]') || t.startsWith('[cod]')) console.log('  ' + t);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__cod && window.__cod.ready, null, { timeout: 240000 });
  const bootMs = Date.now() - t0;

  const stats = await page.evaluate(() => window.__cod.stats());
  console.log(`boot ${bootMs} ms | build ${Math.round(stats.buildMs)} ms`);
  console.log(`world:`, JSON.stringify(stats.world));

  // Settle: let smoke columns populate and shaders finish warming.
  await page.evaluate((n) => window.__cod.advance(n, 1 / 60), WARM);

  const runtime = await page.evaluate(() => ({
    draws: window.__cod.engine.stats.drawCalls,
    tris: window.__cod.engine.stats.triangles,
    ms: window.__cod.engine.stats.ms,
  }));
  console.log(`runtime: ${runtime.draws} draws, ${(runtime.tris / 1000) | 0}k tris, ${runtime.ms.toFixed(1)} ms/frame`);

  if (errors.length) {
    console.log(`\n!! ${errors.length} console error(s):`);
    for (const e of errors.slice(0, 12)) console.log('   ' + e.slice(0, 400));
  } else {
    console.log('no console errors');
  }

  if (SMOKE) {
    await browser.close();
    await server.close();
    process.exit(errors.length ? 1 : 0);
  }

  const list = ONLY ? STATIONS.filter((s) => s[0] === ONLY) : STATIONS;
  for (const [name, x, y, z, yawDeg, pitchDeg, desc] of list) {
    await page.evaluate(({ x, y, z, yawDeg, pitchDeg, name }) => {
      const w = window.__cod.get('world');
      const p = window.__cod.get('player');
      const ground = w.groundAt(x, z);
      window.__cod.teleport(x, ground + (y || 0), z, (yawDeg * Math.PI) / 180, (pitchDeg * Math.PI) / 180);
      // ADS station holds the aim pose
      const scripted = {
        actions: {}, justPressed: {}, look: { x: 0, y: 0 },
        fire: false, firePressed: false, ads: name === 'weapon-ads',
      };
      window.__cod.setScriptedInput(scripted);
      p.ads = name === 'weapon-ads';
    }, { x, y, z, yawDeg, pitchDeg, name });

    // let the pose, FOV, shadows and particles settle at this station
    await page.evaluate(({ x, y, z, yawDeg, pitchDeg }) => {
      for (let i = 0; i < 26; i++) {
        const w = window.__cod.get('world');
        window.__cod.teleport(x, w.groundAt(x, z) + (y || 0), z, (yawDeg * Math.PI) / 180, (pitchDeg * Math.PI) / 180);
        window.__cod.advance(1, 1 / 60);
      }
    }, { x, y, z, yawDeg, pitchDeg });

    const file = path.join(OUTDIR, `${name}.png`);
    await page.screenshot({ path: file });
    console.log(`  ${name.padEnd(14)} ${desc}`);
  }

  await browser.close();
  await server.close();
  console.log(`\n${list.length} shots -> ${OUTDIR}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
