// Seeded deterministic random. Math.random() is banned engine-wide.

function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// sfc32 — small, fast, good statistical quality, period >= 2^128
function sfc32(a, b, c, d) {
  return function () {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

export class Rng {
  constructor(seed = 'NYC-1') {
    this.seed = typeof seed === 'string' ? seed : String(seed);
    const h = hashString(this.seed);
    this._next = sfc32(h, h ^ 0x9e3779b9, Math.imul(h, 0x85ebca6b) >>> 0, 0xdeadbeef ^ h);
    // discard early correlated output
    for (let i = 0; i < 20; i++) this._next();
    this._streams = new Map();
  }

  /** Named independent sub-stream. Adding a new stream never perturbs existing ones. */
  stream(name) {
    let s = this._streams.get(name);
    if (!s) {
      s = new Rng(`${this.seed}::${name}`);
      this._streams.set(name, s);
    }
    return s;
  }

  /** [0,1) */
  next() { return this._next(); }

  /** [min,max) */
  range(min, max) { return min + this._next() * (max - min); }

  /** integer [min,max] inclusive */
  int(min, max) { return Math.floor(min + this._next() * (max - min + 1)); }

  /** symmetric [-a, a] */
  sym(a = 1) { return (this._next() * 2 - 1) * a; }

  bool(p = 0.5) { return this._next() < p; }

  pick(arr) { return arr[Math.floor(this._next() * arr.length) % arr.length]; }

  /** Weighted pick. weights parallel to items. */
  weighted(items, weights) {
    let total = 0;
    for (let i = 0; i < weights.length; i++) total += weights[i];
    let r = this._next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i];
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  }

  /** Fisher-Yates, in place. */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this._next() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /** Approximately gaussian via central limit. */
  gauss(mean = 0, sd = 1) {
    let s = 0;
    for (let i = 0; i < 4; i++) s += this._next();
    return mean + (s - 2) * 0.8660254 * sd;
  }
}

export { hashString };
