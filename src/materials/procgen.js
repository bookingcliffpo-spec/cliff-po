// Procedural texture synthesis. Everything the game renders is born here.
// No image files, no external textures. Canvas2D + typed-array field math.
import * as THREE from 'three';
import { clamp01, lerp, smoothstep } from '../core/math.js';

export function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') {
    try { return new OffscreenCanvas(w, h); } catch (e) { /* fall through */ }
  }
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/* ------------------------------------------------------------------ *
 * Field: a float32 scalar image with tiling-aware sampling.
 * ------------------------------------------------------------------ */
export class Field {
  constructor(w, h, fill = 0) {
    this.w = w; this.h = h;
    this.data = new Float32Array(w * h);
    if (fill !== 0) this.data.fill(fill);
  }
  idx(x, y) {
    x = ((x % this.w) + this.w) % this.w;
    y = ((y % this.h) + this.h) % this.h;
    return y * this.w + x;
  }
  get(x, y) { return this.data[this.idx(x, y)]; }
  set(x, y, v) { this.data[this.idx(x, y)] = v; }
  add(x, y, v) { this.data[this.idx(x, y)] += v; }
  map(fn) {
    const { w, h, data } = this;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      data[i] = fn(data[i], x, y);
    }
    return this;
  }
  copy() {
    const f = new Field(this.w, this.h);
    f.data.set(this.data);
    return f;
  }
  minmax() {
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < this.data.length; i++) {
      const v = this.data[i];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    return [mn, mx];
  }
  normalize(lo = 0, hi = 1) {
    const [mn, mx] = this.minmax();
    const s = mx - mn < 1e-9 ? 0 : (hi - lo) / (mx - mn);
    for (let i = 0; i < this.data.length; i++) this.data[i] = lo + (this.data[i] - mn) * s;
    return this;
  }
  /** Separable box blur, wrapping. radius in px, iterations approximates gaussian. */
  blur(radius, iterations = 2) {
    if (radius < 0.5) return this;
    const { w, h } = this;
    let src = this.data;
    let dst = new Float32Array(w * h);
    const r = Math.max(1, Math.round(radius));
    const norm = 1 / (r * 2 + 1);
    for (let it = 0; it < iterations; it++) {
      // horizontal
      for (let y = 0; y < h; y++) {
        const row = y * w;
        let sum = 0;
        for (let k = -r; k <= r; k++) sum += src[row + (((k % w) + w) % w)];
        for (let x = 0; x < w; x++) {
          dst[row + x] = sum * norm;
          const out = row + (((x - r) % w) + w) % w;
          const inn = row + (((x + r + 1) % w) + w) % w;
          sum += src[inn] - src[out];
        }
      }
      const t = src; src = dst; dst = t;
      // vertical
      for (let x = 0; x < w; x++) {
        let sum = 0;
        for (let k = -r; k <= r; k++) sum += src[((((k % h) + h) % h) * w) + x];
        for (let y = 0; y < h; y++) {
          dst[y * w + x] = sum * norm;
          const out = ((((y - r) % h) + h) % h) * w + x;
          const inn = ((((y + r + 1) % h) + h) % h) * w + x;
          sum += src[inn] - src[out];
        }
      }
      const t2 = src; src = dst; dst = t2;
    }
    if (src !== this.data) this.data.set(src);
    return this;
  }
}

/* ------------------------------------------------------------------ *
 * Noise primitives (all tileable, all seeded)
 * ------------------------------------------------------------------ */

function permTable(rng) {
  const p = new Uint8Array(512);
  const base = new Uint8Array(256);
  for (let i = 0; i < 256; i++) base[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const t = base[i]; base[i] = base[j]; base[j] = t;
  }
  for (let i = 0; i < 512; i++) p[i] = base[i & 255];
  return p;
}

/** Tileable value noise over an integer lattice of `period` cells. */
export function valueNoiseField(w, h, period, rng, smooth = true) {
  const f = new Field(w, h);
  const px = Math.max(1, Math.round(period));
  const py = Math.max(1, Math.round(period * (h / w)));
  const lat = new Float32Array((px + 1) * (py + 1));
  for (let y = 0; y < py; y++) for (let x = 0; x < px; x++) lat[y * (px + 1) + x] = rng.next();
  // wrap edges
  for (let y = 0; y < py; y++) lat[y * (px + 1) + px] = lat[y * (px + 1)];
  for (let x = 0; x <= px; x++) lat[py * (px + 1) + x] = lat[x];

  for (let y = 0; y < h; y++) {
    const fy = (y / h) * py;
    const y0 = Math.floor(fy);
    let ty = fy - y0;
    if (smooth) ty = ty * ty * (3 - 2 * ty);
    for (let x = 0; x < w; x++) {
      const fx = (x / w) * px;
      const x0 = Math.floor(fx);
      let tx = fx - x0;
      if (smooth) tx = tx * tx * (3 - 2 * tx);
      const a = lat[y0 * (px + 1) + x0];
      const b = lat[y0 * (px + 1) + x0 + 1];
      const c = lat[(y0 + 1) * (px + 1) + x0];
      const d = lat[(y0 + 1) * (px + 1) + x0 + 1];
      f.data[y * w + x] = lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
    }
  }
  return f;
}

/** Fractal brownian motion of tileable value noise. */
export function fbmField(w, h, baseperiod, octaves, rng, gain = 0.5, lacunarity = 2) {
  const out = new Field(w, h);
  let amp = 1, per = baseperiod, total = 0;
  for (let o = 0; o < octaves; o++) {
    const n = valueNoiseField(w, h, per, rng);
    for (let i = 0; i < out.data.length; i++) out.data[i] += n.data[i] * amp;
    total += amp;
    amp *= gain;
    per *= lacunarity;
  }
  for (let i = 0; i < out.data.length; i++) out.data[i] /= total;
  return out;
}

/** Ridged fBm — good for cracks, rock, plaster. */
export function ridgedField(w, h, baseperiod, octaves, rng, gain = 0.5) {
  const out = new Field(w, h);
  let amp = 1, per = baseperiod, total = 0;
  for (let o = 0; o < octaves; o++) {
    const n = valueNoiseField(w, h, per, rng);
    for (let i = 0; i < out.data.length; i++) {
      out.data[i] += (1 - Math.abs(n.data[i] * 2 - 1)) * amp;
    }
    total += amp;
    amp *= gain;
    per *= 2;
  }
  for (let i = 0; i < out.data.length; i++) out.data[i] /= total;
  return out;
}

/** Tileable Worley/cellular. Returns F1 distance normalized to ~[0,1]. */
export function worleyField(w, h, cells, rng, mode = 'f1') {
  const f = new Field(w, h);
  const cx = Math.max(1, Math.round(cells));
  const cy = Math.max(1, Math.round(cells * (h / w)));
  const pts = new Float32Array(cx * cy * 2);
  for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
    const k = (j * cx + i) * 2;
    pts[k] = (i + rng.next()) / cx;
    pts[k + 1] = (j + rng.next()) / cy;
  }
  for (let y = 0; y < h; y++) {
    const uy = y / h;
    const gj = Math.floor(uy * cy);
    for (let x = 0; x < w; x++) {
      const ux = x / w;
      const gi = Math.floor(ux * cx);
      let d1 = 1e9, d2 = 1e9;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const ii = ((gi + ox) % cx + cx) % cx;
        const jj = ((gj + oy) % cy + cy) % cy;
        const k = (jj * cx + ii) * 2;
        let dx = pts[k] - ux;
        let dy = pts[k + 1] - uy;
        if (dx > 0.5) dx -= 1; else if (dx < -0.5) dx += 1;
        if (dy > 0.5) dy -= 1; else if (dy < -0.5) dy += 1;
        const d = dx * dx + dy * dy;
        if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
      }
      const a = Math.sqrt(d1) * cx;
      const b = Math.sqrt(d2) * cx;
      f.data[y * w + x] = mode === 'f2f1' ? clamp01(b - a) : clamp01(a);
    }
  }
  return f;
}

/** Vertical streaks / drips — the single most important weathering cue. */
export function streakField(w, h, rng, count = 90, opts = {}) {
  const f = new Field(w, h);
  const minLen = opts.minLen ?? 0.15;
  const maxLen = opts.maxLen ?? 0.75;
  const width = opts.width ?? 4;
  const fromTop = opts.fromTop ?? true;
  for (let i = 0; i < count; i++) {
    const x0 = rng.next() * w;
    const len = Math.floor(h * lerp(minLen, maxLen, rng.next() * rng.next()));
    const y0 = fromTop ? rng.next() * h * 0.35 : rng.next() * h;
    const strength = rng.range(0.25, 1);
    const wob = rng.range(0.2, 1.4);
    const wl = rng.range(40, 200);
    const ww = Math.max(1, width * rng.range(0.3, 1.6));
    for (let t = 0; t < len; t++) {
      const y = y0 + t;
      const fade = (1 - t / len) * strength * smoothstep(0, 0.12, t / len);
      const x = x0 + Math.sin((t / wl) * Math.PI * 2) * wob * 6;
      for (let k = -ww; k <= ww; k++) {
        const falloff = 1 - Math.abs(k) / (ww + 1);
        f.add(Math.round(x + k), Math.round(y), fade * falloff * falloff);
      }
    }
  }
  return f;
}

/** Branching crack network. Used for masonry, asphalt, concrete, glass. */
export function crackField(w, h, rng, opts = {}) {
  const f = new Field(w, h);
  const seeds = opts.seeds ?? 10;
  const maxDepth = opts.maxDepth ?? 4;
  const stepLen = opts.stepLen ?? 3;
  const widthPx = opts.width ?? 1.2;
  const branchP = opts.branch ?? 0.06;
  const wander = opts.wander ?? 0.35;
  const lenScale = opts.lenScale ?? 1;

  const draw = (x, y, a, life, depth, wmul) => {
    let px = x, py = y, ang = a;
    const steps = Math.floor(life);
    for (let s = 0; s < steps; s++) {
      ang += rng.sym(wander);
      px += Math.cos(ang) * stepLen;
      py += Math.sin(ang) * stepLen;
      const ww = widthPx * wmul * (1 - s / steps) + 0.4;
      const strength = (1 - s / steps) * 0.9 + 0.1;
      const r = Math.ceil(ww);
      for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) {
        const d = Math.hypot(ox, oy);
        if (d > ww) continue;
        const v = (1 - d / (ww + 0.001)) * strength;
        const i = f.idx(Math.round(px + ox), Math.round(py + oy));
        if (v > f.data[i]) f.data[i] = v;
      }
      if (depth < maxDepth && rng.next() < branchP) {
        draw(px, py, ang + rng.sym(1.1) + (rng.bool() ? 0.7 : -0.7), life * 0.5, depth + 1, wmul * 0.6);
      }
    }
  };

  for (let i = 0; i < seeds; i++) {
    draw(rng.next() * w, rng.next() * h, rng.next() * Math.PI * 2,
      (20 + rng.next() * 55) * lenScale, 0, 1);
  }
  return f;
}

/** Dense speckle for grit, sand, aggregate, dust. */
export function speckleField(w, h, rng, density = 0.35, sizeMax = 2) {
  const f = new Field(w, h);
  const n = Math.floor(w * h * density * 0.02);
  for (let i = 0; i < n; i++) {
    const x = Math.floor(rng.next() * w);
    const y = Math.floor(rng.next() * h);
    const r = rng.range(0.5, sizeMax);
    const v = rng.range(0.2, 1);
    const ri = Math.ceil(r);
    for (let oy = -ri; oy <= ri; oy++) for (let ox = -ri; ox <= ri; ox++) {
      const d = Math.hypot(ox, oy);
      if (d > r) continue;
      f.add(x + ox, y + oy, v * (1 - d / (r + 0.001)));
    }
  }
  return f;
}

/** White noise at 1px — micro surface roughness. */
export function whiteField(w, h, rng) {
  const f = new Field(w, h);
  for (let i = 0; i < f.data.length; i++) f.data[i] = rng.next();
  return f;
}

/* ------------------------------------------------------------------ *
 * Field → texture conversion
 * ------------------------------------------------------------------ */

/**
 * Convert fields to an RGBA texture.
 * shade(x,y,fields,out) writes out.r/g/b in 0..255.
 */
export function fieldsToTexture(w, h, shade, opts = {}) {
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const out = { r: 0, g: 0, b: 0, a: 255 };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out.a = 255;
      shade(x, y, out);
      const i = (y * w + x) * 4;
      d[i] = out.r; d[i + 1] = out.g; d[i + 2] = out.b; d[i + 3] = out.a;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvasToTexture(canvas, opts);
}

export function canvasToTexture(canvas, opts = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = opts.wrap ?? THREE.RepeatWrapping;
  tex.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  tex.anisotropy = opts.anisotropy ?? 8;
  tex.generateMipmaps = opts.mipmaps !== false;
  tex.minFilter = opts.mipmaps === false ? THREE.LinearFilter : THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  if (opts.repeat) tex.repeat.set(opts.repeat[0], opts.repeat[1]);
  tex.needsUpdate = true;
  return tex;
}

/** Height field → tangent-space normal map (Sobel). */
export function heightToNormal(field, strength = 2.0, opts = {}) {
  const { w, h } = field;
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tl = field.get(x - 1, y - 1), t = field.get(x, y - 1), tr = field.get(x + 1, y - 1);
      const l = field.get(x - 1, y), r = field.get(x + 1, y);
      const bl = field.get(x - 1, y + 1), b = field.get(x, y + 1), br = field.get(x + 1, y + 1);
      const dx = (tr + 2 * r + br) - (tl + 2 * l + bl);
      const dy = (bl + 2 * b + br) - (tl + 2 * t + tr);
      let nx = -dx * strength;
      let ny = -dy * strength;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len;
      const nzz = nz / len;
      const i = (y * w + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * 0.5 + 0.5) * 255;
      d[i + 2] = (nzz * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvasToTexture(canvas, { ...opts, srgb: false });
}

/** Single-channel field → grayscale texture (roughness / ao / metalness / alpha). */
export function fieldToGray(field, opts = {}) {
  const { w, h } = field;
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const alphaFrom = opts.alphaFrom || null;
  for (let i = 0; i < w * h; i++) {
    const v = clamp01(field.data[i]) * 255;
    d[i * 4] = v; d[i * 4 + 1] = v; d[i * 4 + 2] = v;
    d[i * 4 + 3] = alphaFrom ? clamp01(alphaFrom.data[i]) * 255 : 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvasToTexture(canvas, { ...opts, srgb: false });
}

/* ------------------------------------------------------------------ *
 * Structural pattern helpers
 * ------------------------------------------------------------------ */

/**
 * Running-bond brick lattice.
 * Returns { mask (1 inside brick, 0 in mortar), id (per-brick random 0..1),
 *           edge (0 at center → 1 at mortar), bevel (height) }
 */
export function brickLattice(w, h, rows, rng, opts = {}) {
  const mortar = opts.mortar ?? 0.055;   // fraction of a brick cell
  const aspect = opts.aspect ?? 2.6;     // brick width / height
  const offset = opts.offset ?? 0.5;
  const jitter = opts.jitter ?? 0.012;
  const cellH = h / rows;
  const cellW = cellH * aspect;
  const cols = Math.max(1, Math.round(w / cellW));
  const cw = w / cols;

  const mask = new Field(w, h);
  const id = new Field(w, h);
  const edge = new Field(w, h);
  const ids = new Float32Array(rows * cols * 3);
  for (let i = 0; i < rows * cols; i++) {
    ids[i * 3] = rng.next();
    ids[i * 3 + 1] = rng.sym(jitter);   // per-brick height offset
    ids[i * 3 + 2] = rng.next();        // secondary
  }
  const mh = mortar * cellH * 1.6;
  const mw = mortar * cw * 0.65;

  for (let y = 0; y < h; y++) {
    const row = Math.floor(y / cellH);
    const ry = y - row * cellH;
    const shift = (row % 2) * offset * cw;
    for (let x = 0; x < w; x++) {
      const xs = ((x + shift) % w + w) % w;
      const col = Math.floor(xs / cw);
      const rx = xs - col * cw;
      const k = ((row % rows) * cols + (col % cols));
      const inX = rx > mw && rx < cw - mw;
      const inY = ry > mh && ry < cellH - mh;
      const i = y * w + x;
      mask.data[i] = inX && inY ? 1 : 0;
      id.data[i] = ids[k * 3];
      // distance to nearest mortar joint, normalized
      const dx = Math.min(rx - mw, cw - mw - rx) / (cw * 0.5);
      const dy = Math.min(ry - mh, cellH - mh - ry) / (cellH * 0.5);
      edge.data[i] = 1 - clamp01(Math.min(dx, dy) * 2.2);
    }
  }
  return { mask, id, edge, cols, rows, cellW: cw, cellH };
}

/** Horizontal band pattern — stone courses, concrete panels, siding. */
export function bandField(w, h, bands, rng, jitter = 0.35) {
  const f = new Field(w, h);
  const bh = h / bands;
  const vals = new Float32Array(bands + 1);
  for (let i = 0; i <= bands; i++) vals[i] = rng.next();
  for (let y = 0; y < h; y++) {
    const b = Math.floor(y / bh);
    const t = (y - b * bh) / bh;
    const v = lerp(vals[b % bands], vals[(b + 1) % bands], jitter * smoothstep(0.85, 1, t));
    for (let x = 0; x < w; x++) f.data[y * w + x] = v;
  }
  return f;
}

/* ------------------------------------------------------------------ *
 * Canvas drawing helpers (signage, decals, markings)
 * ------------------------------------------------------------------ */

export function ctx2d(w, h, opts = {}) {
  const canvas = makeCanvas(w, h);
  const c = canvas.getContext('2d', { willReadFrequently: true, alpha: opts.alpha !== false });
  return { canvas, c };
}

/** Multiply a canvas by a grunge field (adds wear to drawn art). */
export function grungeCanvas(canvas, field, amount = 0.5, mode = 'darken') {
  const c = canvas.getContext('2d', { willReadFrequently: true });
  const w = canvas.width, h = canvas.height;
  const img = c.getImageData(0, 0, w, h);
  const d = img.data;
  const fw = field.w, fh = field.h;
  for (let y = 0; y < h; y++) {
    const fy = Math.floor((y / h) * fh);
    for (let x = 0; x < w; x++) {
      const fx = Math.floor((x / w) * fw);
      const g = clamp01(field.data[fy * fw + fx]);
      const i = (y * w + x) * 4;
      if (mode === 'darken') {
        const m = 1 - g * amount;
        d[i] *= m; d[i + 1] *= m; d[i + 2] *= m;
      } else if (mode === 'erode') {
        d[i + 3] *= clamp01(1 - g * amount);
      }
    }
  }
  c.putImageData(img, 0, 0);
  return canvas;
}

export const FONT_STACK = '"Arial Black","Helvetica Neue",Helvetica,Arial,sans-serif';
export const FONT_CONDENSED = '"Arial Narrow","Helvetica Neue",Helvetica,Arial,sans-serif';

export function fitText(c, text, maxW, startPx, font = FONT_STACK, weight = 'bold') {
  let px = startPx;
  for (let i = 0; i < 40; i++) {
    c.font = `${weight} ${px}px ${font}`;
    if (c.measureText(text).width <= maxW) break;
    px -= Math.max(1, px * 0.06);
  }
  return px;
}
