import * as THREE from 'three';
import { ctx2d, canvasToTexture, fbmField, streakField, speckleField, grungeCanvas, fitText, FONT_STACK, FONT_CONDENSED } from '../materials/procgen.js';
import { clamp01, lerp } from '../core/math.js';

/**
 * Storefront and street signage. All names are invented; the point is the
 * typographic rhythm of a Manhattan block, not any real business.
 */

const SHOP_TYPES = [
  { kind: 'DELI', names: ['CORNER DELI', 'SUNSET DELI', 'ATLAS DELI & GROCERY', 'MERIDIAN DELI'], bg: '#1c3f6e', fg: '#ffd23f', sub: 'SANDWICHES · COFFEE · BEER' },
  { kind: 'GROCERY', names: ['HUDSON MARKET', 'FULTON GROCERY', 'KELLER FOODS'], bg: '#134a2c', fg: '#f4efe2', sub: 'FRESH PRODUCE · OPEN 24 HRS' },
  { kind: 'PHARMACY', names: ['LENOX PHARMACY', 'DRUGS & SUNDRIES', 'CANAL RX'], bg: '#8c1c22', fg: '#f6f1e6', sub: 'PRESCRIPTIONS' },
  { kind: 'PIZZA', names: ['RAY BROS PIZZA', 'ORIGINAL SLICE', 'VESUVIO PIZZA'], bg: '#0f5c33', fg: '#f7e9c4', sub: 'HOT SLICES · WHOLE PIES' },
  { kind: 'LAUNDRY', names: ['WASH & FOLD', 'SUDS LAUNDROMAT', 'CLEAN CITY'], bg: '#1d5f77', fg: '#f2f6f7', sub: 'SELF SERVICE · DRY CLEAN' },
  { kind: 'BARBER', names: ['AVE BARBERS', 'CLASSIC CUTS', 'GRANT ST BARBER'], bg: '#2a2f36', fg: '#e2c46a', sub: 'EST. 1974' },
  { kind: 'LIQUOR', names: ['LIQUORS', 'WINE & SPIRITS', 'BOWERY LIQUOR'], bg: '#5d1730', fg: '#e8d9a8', sub: 'FINE WINES' },
  { kind: 'DINER', names: ['STARLITE DINER', 'THE ANCHOR', 'MIDTOWN LUNCH'], bg: '#6d2018', fg: '#f0e6cf', sub: 'BREAKFAST ALL DAY' },
  { kind: 'CAFE', names: ['CAFE ORION', 'ESPRESSO BAR', 'DAYBREAK COFFEE'], bg: '#3b2a20', fg: '#e9d7b4', sub: 'COFFEE · PASTRY' },
  { kind: 'DISCOUNT', names: ['99¢ & UP', 'BARGAIN CITY', 'DISCOUNT WORLD'], bg: '#b8451c', fg: '#fff3d0', sub: 'EVERYTHING MUST GO' },
  { kind: 'HARDWARE', names: ['ACME HARDWARE', 'KEYS · LOCKS · TOOLS', 'CITY SUPPLY CO'], bg: '#2c3d52', fg: '#f0d99a', sub: 'PAINT · PLUMBING' },
  { kind: 'ELECTRONICS', names: ['CIRCUIT CITY ELEC.', 'PHONE REPAIR', 'TV & RADIO'], bg: '#14202e', fg: '#67c7e8', sub: 'UNLOCK · REPAIR' },
];

const STREET_NAMES = [
  'W 48 ST', 'E 48 ST', 'HARROW AVE', 'MERIDIAN AVE', 'W 47 ST',
  'CANAL ST', 'GRANT ST', 'LENOX AVE', 'FULTON ST', 'W 49 ST',
];

function weather(canvas, rng, amount = 0.55) {
  const w = canvas.width, h = canvas.height;
  const dirt = fbmField(96, 96, 4, 4, rng.stream('dirt'));
  const drip = streakField(96, 96, rng.stream('drip'), 22, { maxLen: 1.0, width: 2 });
  const f = dirt;
  for (let i = 0; i < f.data.length; i++) f.data[i] = clamp01(f.data[i] * 0.7 + drip.data[i] * 0.8);
  grungeCanvas(canvas, f, amount, 'darken');
  return canvas;
}

/** Illuminated / painted storefront fascia sign. */
export function makeShopSign(rng, width = 1024, height = 220, forcedType = null) {
  const type = forcedType || rng.pick(SHOP_TYPES);
  const name = rng.pick(type.names);
  const { canvas, c } = ctx2d(width, height, { alpha: false });

  // panel with a subtle vertical gradient — signs are never flat colour
  const grad = c.createLinearGradient(0, 0, 0, height);
  const bg = new THREE.Color(type.bg);
  grad.addColorStop(0, `#${bg.clone().offsetHSL(0, 0, 0.06).getHexString()}`);
  grad.addColorStop(0.55, type.bg);
  grad.addColorStop(1, `#${bg.clone().offsetHSL(0, 0, -0.05).getHexString()}`);
  c.fillStyle = grad;
  c.fillRect(0, 0, width, height);

  // border trim
  c.strokeStyle = 'rgba(255,255,255,0.18)';
  c.lineWidth = Math.max(2, height * 0.022);
  c.strokeRect(height * 0.05, height * 0.05, width - height * 0.1, height - height * 0.1);

  const hasSub = rng.bool(0.72);
  const mainY = hasSub ? height * 0.44 : height * 0.55;
  const px = fitText(c, name, width * 0.9, height * (hasSub ? 0.52 : 0.62), FONT_STACK, 'bold');
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  // drop shadow gives the lettering physical depth on the panel
  c.fillStyle = 'rgba(0,0,0,0.45)';
  c.fillText(name, width / 2 + px * 0.035, mainY + px * 0.045);
  c.fillStyle = type.fg;
  c.fillText(name, width / 2, mainY);

  if (hasSub) {
    const spx = fitText(c, type.sub, width * 0.82, height * 0.2, FONT_CONDENSED, 'normal');
    c.font = `normal ${spx}px ${FONT_CONDENSED}`;
    c.fillStyle = 'rgba(255,255,255,0.72)';
    c.letterSpacing = `${spx * 0.12}px`;
    c.fillText(type.sub, width / 2, height * 0.775);
    c.letterSpacing = '0px';
  }

  weather(canvas, rng, rng.range(0.35, 0.75));
  const tex = canvasToTexture(canvas, { wrap: THREE.ClampToEdgeWrapping, anisotropy: 8 });
  return { tex, type, name };
}

/** Vertical blade sign — the projecting kind bolted to a corner. */
export function makeBladeSign(rng, width = 256, height = 768) {
  const type = rng.pick(SHOP_TYPES);
  const word = type.kind;
  const { canvas, c } = ctx2d(width, height, { alpha: false });
  c.fillStyle = '#15181c';
  c.fillRect(0, 0, width, height);
  const grad = c.createLinearGradient(0, 0, width, 0);
  grad.addColorStop(0, '#0d0f12');
  grad.addColorStop(0.5, type.bg);
  grad.addColorStop(1, '#0d0f12');
  c.fillStyle = grad;
  c.fillRect(width * 0.07, height * 0.03, width * 0.86, height * 0.94);

  c.textAlign = 'center';
  c.textBaseline = 'middle';
  const n = word.length;
  const cellH = (height * 0.86) / n;
  const px = Math.min(width * 0.62, cellH * 0.82);
  c.font = `bold ${px}px ${FONT_STACK}`;
  for (let i = 0; i < n; i++) {
    const y = height * 0.07 + cellH * (i + 0.5);
    c.fillStyle = 'rgba(0,0,0,0.5)';
    c.fillText(word[i], width / 2 + px * 0.04, y + px * 0.05);
    c.fillStyle = type.fg;
    c.fillText(word[i], width / 2, y);
  }
  weather(canvas, rng, rng.range(0.4, 0.8));
  return canvasToTexture(canvas, { wrap: THREE.ClampToEdgeWrapping });
}

/** Green NYC street-name blade. */
export function makeStreetSign(rng, name = null) {
  const w = 512, h = 128;
  const { canvas, c } = ctx2d(w, h, { alpha: false });
  c.fillStyle = '#0f5233';
  c.fillRect(0, 0, w, h);
  c.strokeStyle = 'rgba(255,255,255,0.85)';
  c.lineWidth = 5;
  c.strokeRect(9, 9, w - 18, h - 18);
  const label = name || rng.pick(STREET_NAMES);
  const px = fitText(c, label, w * 0.84, h * 0.6, FONT_CONDENSED, 'bold');
  c.font = `bold ${px}px ${FONT_CONDENSED}`;
  c.fillStyle = '#f2f5f2';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(label, w / 2, h * 0.52);
  weather(canvas, rng, 0.4);
  return canvasToTexture(canvas, { wrap: THREE.ClampToEdgeWrapping });
}

/** Regulatory / warning street signage. */
export function makeTrafficSign(rng, kind) {
  const w = 256, h = 320;
  const { canvas, c } = ctx2d(w, h, { alpha: false });
  if (kind === 'stop') {
    c.fillStyle = '#8d1f16';
    c.fillRect(0, 0, w, w);
    c.fillStyle = '#f4f1ea';
    c.font = `bold 96px ${FONT_STACK}`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('STOP', w / 2, w / 2);
  } else if (kind === 'oneway') {
    c.fillStyle = '#111417';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#e8e4da';
    c.fillRect(12, h * 0.34, w - 24, h * 0.3);
    c.fillStyle = '#111417';
    c.font = `bold 54px ${FONT_CONDENSED}`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('ONE WAY', w / 2, h * 0.49);
  } else {
    // parking regulation — the dense white/red kind on every NYC pole
    c.fillStyle = '#eae7de';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = '#9c2018'; c.lineWidth = 8;
    c.strokeRect(10, 10, w - 20, h - 20);
    c.fillStyle = '#9c2018';
    c.font = `bold 46px ${FONT_CONDENSED}`;
    c.textAlign = 'center'; c.textBaseline = 'top';
    c.fillText('NO', w / 2, 34);
    c.fillText('PARKING', w / 2, 84);
    c.fillStyle = '#1b1f24';
    c.font = `bold 30px ${FONT_CONDENSED}`;
    c.fillText('8AM - 6PM', w / 2, 150);
    c.fillText('MON THRU FRI', w / 2, 188);
    c.fillText('TOW AWAY ZONE', w / 2, 236);
  }
  weather(canvas, rng, rng.range(0.3, 0.7));
  return canvasToTexture(canvas, { wrap: THREE.ClampToEdgeWrapping });
}

/** Large weather-blown billboard, half torn. */
export function makeBillboard(rng, w = 1024, h = 512) {
  const { canvas, c } = ctx2d(w, h, { alpha: false });
  const palettes = [
    ['#1b2a3a', '#e2b13c', '#f2eee4'],
    ['#3a1c22', '#d9663a', '#efe6d6'],
    ['#132a24', '#57b389', '#eef3ee'],
    ['#241d33', '#8f7ad1', '#efeaf7'],
  ];
  const p = rng.pick(palettes);
  const grad = c.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, p[0]);
  grad.addColorStop(1, new THREE.Color(p[0]).offsetHSL(0, 0, 0.1).getStyle());
  c.fillStyle = grad;
  c.fillRect(0, 0, w, h);

  // abstract graphic shapes — advertising with the brand filed off
  for (let i = 0; i < 5; i++) {
    c.globalAlpha = rng.range(0.15, 0.45);
    c.fillStyle = p[1];
    const r = rng.range(w * 0.08, w * 0.32);
    c.beginPath();
    c.arc(rng.range(0, w), rng.range(0, h), r, 0, Math.PI * 2);
    c.fill();
  }
  c.globalAlpha = 1;

  const words = ['NOW LEASING', 'STAY CONNECTED', 'THE CITY NEVER', 'OPENING SOON', 'DRINK COLD', 'GO FURTHER'];
  const word = rng.pick(words);
  const px = fitText(c, word, w * 0.84, h * 0.3, FONT_STACK, 'bold');
  c.font = `bold ${px}px ${FONT_STACK}`;
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillStyle = 'rgba(0,0,0,0.4)';
  c.fillText(word, w / 2 + 6, h * 0.44 + 6);
  c.fillStyle = p[2];
  c.fillText(word, w / 2, h * 0.44);

  // torn strips of paper hanging off the board
  const tears = rng.int(2, 5);
  c.fillStyle = '#2a2723';
  for (let i = 0; i < tears; i++) {
    const x0 = rng.range(0, w);
    const tw = rng.range(w * 0.05, w * 0.2);
    c.beginPath();
    c.moveTo(x0, h);
    let y = h;
    for (let s = 0; s < 8; s++) {
      y -= rng.range(h * 0.03, h * 0.11);
      c.lineTo(x0 + rng.sym(tw * 0.4), y);
    }
    c.lineTo(x0 + tw, h);
    c.closePath();
    c.fill();
  }
  weather(canvas, rng, rng.range(0.5, 0.85));
  return canvasToTexture(canvas, { wrap: THREE.ClampToEdgeWrapping });
}

/** A dark shop interior seen through glass — depth without geometry cost. */
export function makeInteriorBackdrop(rng, w = 512, h = 256) {
  const { canvas, c } = ctx2d(w, h, { alpha: false });
  c.fillStyle = '#0a0c0e';
  c.fillRect(0, 0, w, h);
  // shelving suggested by faint horizontal bands and scattered highlights
  const rows = rng.int(3, 5);
  for (let r = 0; r < rows; r++) {
    const y = h * (0.24 + r * (0.68 / rows));
    c.fillStyle = `rgba(${rng.int(28, 52)},${rng.int(26, 46)},${rng.int(24, 42)},1)`;
    c.fillRect(0, y, w, h * 0.045);
    for (let i = 0; i < rng.int(8, 22); i++) {
      const bw = rng.range(w * 0.012, w * 0.04);
      c.fillStyle = `rgba(${rng.int(40, 110)},${rng.int(36, 100)},${rng.int(30, 90)},${rng.range(0.25, 0.7)})`;
      c.fillRect(rng.range(0, w), y - h * 0.075, bw, h * 0.075);
    }
  }
  // a single failing fluorescent tube deep in the shop
  if (rng.bool(0.45)) {
    const lx = rng.range(w * 0.2, w * 0.8);
    const g = c.createRadialGradient(lx, h * 0.18, 0, lx, h * 0.18, w * 0.3);
    g.addColorStop(0, 'rgba(150,175,180,0.55)');
    g.addColorStop(1, 'rgba(150,175,180,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  }
  return canvasToTexture(canvas, { wrap: THREE.ClampToEdgeWrapping });
}

export { SHOP_TYPES, STREET_NAMES };
