import * as THREE from 'three';
import { clamp01, lerp, smoothstep } from '../core/math.js';
import {
  Field, fbmField, ridgedField, worleyField, valueNoiseField, whiteField,
  speckleField, streakField, crackField, brickLattice, bandField,
  fieldsToTexture, heightToNormal, fieldToGray, canvasToTexture, ctx2d,
  FONT_STACK, FONT_CONDENSED, fitText, grungeCanvas,
} from './procgen.js';

const SIZE = { hero: 1024, high: 512, mid: 384, low: 256 };

/**
 * MaterialSystem — the single owner of every texture and material in the game.
 * Materials are shared aggressively: `get(name)` always returns the same instance
 * so the renderer can batch. Use `variant(name, {color,repeat})` when a surface
 * needs its own tint; that clones the material but reuses all textures.
 */
export class MaterialSystem {
  constructor(ctx) {
    this.ctx = ctx;
    this.rng = ctx.rng.stream('materials');
    this._mats = new Map();
    this._texs = new Map();
    this._builders = new Map();
    this._variants = new Map();
    this.textureCount = 0;
  }

  init() {
    this._registerBuilders();
    // Build everything eagerly: a shader/texture stall mid-firefight is a bug.
    for (const name of this._builders.keys()) this.get(name);
  }

  get(name) {
    let m = this._mats.get(name);
    if (m) return m;
    const b = this._builders.get(name);
    if (!b) throw new Error(`MaterialSystem: unknown material "${name}"`);
    m = b();
    m.name = name;
    this._mats.set(name, m);
    return m;
  }

  has(name) { return this._builders.has(name); }

  /** Cloned material sharing textures. Keyed so repeats de-duplicate. */
  variant(name, opts = {}) {
    const key = `${name}|${opts.color ?? ''}|${opts.repeat ?? ''}|${opts.roughness ?? ''}|${opts.metalness ?? ''}|${opts.emissive ?? ''}|${opts.emissiveIntensity ?? ''}|${opts.opacity ?? ''}`;
    let m = this._variants.get(key);
    if (m) return m;
    const base = this.get(name);
    m = base.clone();
    if (opts.color !== undefined) m.color = new THREE.Color(opts.color);
    if (opts.roughness !== undefined) m.roughness = opts.roughness;
    if (opts.metalness !== undefined) m.metalness = opts.metalness;
    if (opts.emissive !== undefined) {
      m.emissive = new THREE.Color(opts.emissive);
      m.emissiveIntensity = opts.emissiveIntensity ?? 1;
    }
    if (opts.opacity !== undefined) { m.opacity = opts.opacity; m.transparent = opts.opacity < 1; }
    if (opts.repeat) {
      // Repeat must not mutate the shared texture, so clone the maps.
      const r = opts.repeat;
      for (const slot of ['map', 'normalMap', 'roughnessMap', 'aoMap', 'metalnessMap', 'alphaMap', 'emissiveMap']) {
        if (m[slot]) {
          const t = m[slot].clone();
          t.needsUpdate = true;
          t.repeat.set(r[0], r[1]);
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          m[slot] = t;
        }
      }
    }
    m.name = `${name}#${this._variants.size}`;
    this._variants.set(key, m);
    return m;
  }

  /** Register an externally-built texture so it is disposed with the system. */
  track(tex) { this._texs.set(`t${this.textureCount++}`, tex); return tex; }

  /** Standard material factory that wires the usual map set. */
  std(opts) {
    const m = new THREE.MeshStandardMaterial({
      color: opts.color ?? 0xffffff,
      roughness: opts.roughness ?? 0.9,
      metalness: opts.metalness ?? 0,
      map: opts.map || null,
      normalMap: opts.normalMap || null,
      roughnessMap: opts.roughnessMap || null,
      metalnessMap: opts.metalnessMap || null,
      aoMap: opts.aoMap || null,
      emissive: opts.emissive ?? 0x000000,
      emissiveIntensity: opts.emissiveIntensity ?? 1,
      emissiveMap: opts.emissiveMap || null,
      transparent: opts.transparent ?? false,
      opacity: opts.opacity ?? 1,
      side: opts.side ?? THREE.FrontSide,
      alphaMap: opts.alphaMap || null,
      alphaTest: opts.alphaTest ?? 0,
      envMapIntensity: opts.envMapIntensity ?? 1,
      depthWrite: opts.depthWrite ?? true,
      flatShading: opts.flatShading ?? false,
      vertexColors: opts.vertexColors ?? false,
    });
    if (opts.normalScale) m.normalScale.set(opts.normalScale, opts.normalScale);
    for (const t of [opts.map, opts.normalMap, opts.roughnessMap, opts.aoMap, opts.metalnessMap, opts.alphaMap, opts.emissiveMap]) {
      if (t) this.track(t);
    }
    return m;
  }

  /* ================================================================ *
   *  Builders
   * ================================================================ */
  _registerBuilders() {
    const B = (n, fn) => this._builders.set(n, fn);

    B('asphalt', () => this._asphalt(false));
    B('asphaltWet', () => this._asphalt(true));
    B('asphaltPatched', () => this._asphaltPatched());
    B('sidewalk', () => this._sidewalk());
    B('curb', () => this._curb());
    B('concrete', () => this._concrete(0x9a9691, 0.92));
    B('concreteDark', () => this._concrete(0x605d59, 0.95));
    B('concreteBarrier', () => this._concrete(0xa8a49c, 0.88));
    B('brickRed', () => this._brick(0x7d3a2c, 0x9c5140, 0xb9b1a4));
    B('brickBrown', () => this._brick(0x6b4a38, 0x8a6248, 0xa89f92));
    B('brickTan', () => this._brick(0x9b7f5e, 0xb59873, 0xb8b0a2));
    B('brickPainted', () => this._brickPainted());
    B('brickDark', () => this._brick(0x4a2f28, 0x634034, 0x8a8177));
    B('limestone', () => this._limestone());
    B('plaster', () => this._plaster());
    B('stucco', () => this._stucco());
    B('terracotta', () => this._terracotta());

    B('glassDark', () => this._glass(0x0d1418, 0.05, 0.62));
    B('glassBlue', () => this._glass(0x16242c, 0.06, 0.5));
    B('glassBroken', () => this._glassBroken());
    B('glassShop', () => this._glass(0x101519, 0.09, 0.34));

    B('metalPainted', () => this._metalPainted(0x3c4247));
    B('metalDarkPainted', () => this._metalPainted(0x22262a));
    B('metalRust', () => this._metalRust());
    B('galvanized', () => this._galvanized());
    B('steelBare', () => this._steel());
    B('fireEscape', () => this._fireEscapeMetal());
    B('chrome', () => this._chrome());
    B('copperOx', () => this._copperOx());

    B('wood', () => this._wood(0x6b4f34));
    B('woodWeathered', () => this._wood(0x7a705f, true));
    B('plywood', () => this._plywood());
    B('waterTankWood', () => this._waterTankWood());

    B('rubber', () => this._rubber());
    B('vehiclePaint', () => this._vehiclePaint(0xb0b4b8));
    B('taxiPaint', () => this._vehiclePaint(0xd8a11a, 0.9));
    B('vehicleBurnt', () => this._burnt());
    B('carGlass', () => this._carGlass());

    B('soot', () => this._soot());
    B('dirt', () => this._dirtGround());
    B('rubble', () => this._rubble());
    B('debris', () => this._debris());
    B('trashBag', () => this._trashBag());
    B('canvasAwning', () => this._awning(0x8a2f2a));

    B('tileSubway', () => this._subwayTile());
    B('roadPaintWhite', () => this._roadPaint(0xd9d6cc));
    B('roadPaintYellow', () => this._roadPaint(0xc9a531));
    B('manhole', () => this._manhole());
    B('grate', () => this._grate());
    B('interiorFloor', () => this._interiorFloor());
    B('ceilingPanel', () => this._ceilingPanel());
    B('scaffoldPlank', () => this._scaffoldPlank());
    B('billboardBack', () => this._metalPainted(0x2b2f33));
    B('foliageDead', () => this._deadFoliage());
  }

  /* ---------------------------- ground ---------------------------- */

  _asphalt(wet) {
    const rng = this.rng.stream(wet ? 'asphaltWet' : 'asphalt');
    const S = SIZE.hero;
    const agg = worleyField(S, S, 130, rng.stream('agg'), 'f1');
    const agg2 = worleyField(S, S, 58, rng.stream('agg2'), 'f2f1');
    const macro = fbmField(S, S, 3, 5, rng.stream('macro'));
    const grit = speckleField(S, S, rng.stream('grit'), 0.9, 1.7);
    const cracks = crackField(S, S, rng.stream('cracks'), { seeds: 7, width: 1.5, stepLen: 4, maxDepth: 3, branch: 0.05 });
    const patch = fbmField(S, S, 2, 3, rng.stream('patch'));
    const oil = fbmField(S, S, 4, 4, rng.stream('oil'));
    const micro = whiteField(S, S, rng.stream('micro'));

    // height for normals: aggregate bumps minus cracks
    const height = new Field(S, S);
    for (let i = 0; i < height.data.length; i++) {
      const a = 1 - clamp01(agg.data[i] * 1.15);
      height.data[i] = a * 0.55 + agg2.data[i] * 0.18 + grit.data[i] * 0.28
        + macro.data[i] * 0.22 - cracks.data[i] * 0.95 + micro.data[i] * 0.045;
    }
    height.normalize(0, 1);

    const map = fieldsToTexture(S, S, (x, y, out) => {
      const i = y * S + x;
      const a = 1 - clamp01(agg.data[i] * 1.15);
      const m = macro.data[i];
      const p = smoothstep(0.55, 0.72, patch.data[i]);
      // base charcoal, lighter where worn/polished by traffic
      let base = 26 + m * 16 + a * 22 + agg2.data[i] * 14;
      base = lerp(base, base * 0.78 + 10, p);          // asphalt patch (darker, newer)
      const gr = grit.data[i];
      let r = base + gr * 26 + micro.data[i] * 9 - 4;
      let g = base + gr * 25 + micro.data[i] * 9 - 3;
      let b = base + gr * 23 + micro.data[i] * 9;
      // aggregate stones show slight warm/grey variance
      if (a > 0.62) { const t = (a - 0.62) * 2.4; r += t * 16; g += t * 15; b += t * 12; }
      // oil staining
      const o = smoothstep(0.62, 0.86, oil.data[i]);
      r = lerp(r, r * 0.42, o); g = lerp(g, g * 0.42, o); b = lerp(b, b * 0.46, o);
      // cracks are dark and dirty
      const c = clamp01(cracks.data[i]);
      r = lerp(r, 12, c); g = lerp(g, 11, c); b = lerp(b, 11, c);
      out.r = clamp01(r / 255) * 255; out.g = clamp01(g / 255) * 255; out.b = clamp01(b / 255) * 255;
    });

    const rough = new Field(S, S);
    for (let i = 0; i < rough.data.length; i++) {
      let r = 0.86 - agg2.data[i] * 0.12 + micro.data[i] * 0.06 - macro.data[i] * 0.08;
      const o = smoothstep(0.62, 0.86, oil.data[i]);
      r = lerp(r, 0.42, o);
      if (wet) {
        // puddles pool in the low areas of the macro field
        const pud = smoothstep(0.62, 0.34, height.data[i]) * smoothstep(0.35, 0.62, macro.data[i]);
        r = lerp(r, 0.08, pud);
      }
      rough.data[i] = clamp01(r);
    }

    return this.std({
      color: 0xffffff,
      map,
      normalMap: heightToNormal(height, wet ? 1.1 : 2.1),
      normalScale: wet ? 0.7 : 1.0,
      roughnessMap: fieldToGray(rough),
      roughness: 1,
      metalness: wet ? 0.06 : 0.0,
      envMapIntensity: wet ? 1.25 : 0.55,
    });
  }

  _asphaltPatched() {
    const m = this.get('asphalt').clone();
    m.color = new THREE.Color(0x8f8f92);
    return m;
  }

  _sidewalk() {
    const rng = this.rng.stream('sidewalk');
    const S = SIZE.hero;
    // NYC sidewalk: ~1.5m square slabs with scored joints, heavy aggregate.
    const slabs = 4;
    const agg = worleyField(S, S, 200, rng.stream('agg'), 'f1');
    const grit = speckleField(S, S, rng.stream('grit'), 0.75, 1.4);
    const macro = fbmField(S, S, 3, 4, rng.stream('macro'));
    const stain = fbmField(S, S, 6, 4, rng.stream('stain'));
    const cracks = crackField(S, S, rng.stream('cracks'), { seeds: 5, width: 1.0, stepLen: 3, branch: 0.04 });
    const micro = whiteField(S, S, rng.stream('micro'));
    const gum = speckleField(S, S, rng.stream('gum'), 0.02, 4.5);

    const joint = new Field(S, S);
    const slabId = new Field(S, S);
    const cell = S / slabs;
    const jw = 3.2;
    const ids = [];
    for (let i = 0; i < slabs * slabs; i++) ids.push(rng.range(-0.05, 0.05));
    for (let y = 0; y < S; y++) {
      const sy = Math.floor(y / cell), ry = y % cell;
      for (let x = 0; x < S; x++) {
        const sx = Math.floor(x / cell), rx = x % cell;
        const dx = Math.min(rx, cell - rx);
        const dy = Math.min(ry, cell - ry);
        const d = Math.min(dx, dy);
        const i = y * S + x;
        joint.data[i] = 1 - clamp01(d / jw);
        slabId.data[i] = ids[(sy * slabs + sx) % ids.length];
      }
    }

    const height = new Field(S, S);
    for (let i = 0; i < height.data.length; i++) {
      height.data[i] = (1 - agg.data[i]) * 0.3 + grit.data[i] * 0.32 + macro.data[i] * 0.15
        - joint.data[i] * 0.85 - cracks.data[i] * 0.6 + micro.data[i] * 0.05;
    }
    height.normalize(0, 1);

    const map = fieldsToTexture(S, S, (x, y, out) => {
      const i = y * S + x;
      let base = 148 + macro.data[i] * 26 + slabId.data[i] * 210;
      base += grit.data[i] * 30 - (1 - agg.data[i]) * 10;
      base += micro.data[i] * 11 - 5;
      // dirt accumulating in joints and low spots
      const s = smoothstep(0.45, 0.85, stain.data[i]);
      base = lerp(base, base * 0.72, s * 0.75);
      const j = joint.data[i];
      base = lerp(base, 62, j * 0.9);
      const c = clamp01(cracks.data[i]);
      base = lerp(base, 70, c * 0.85);
      let r = base * 1.005, g = base * 0.995, b = base * 0.965;
      // flattened gum spots — a real NYC sidewalk tell
      const gm = clamp01(gum.data[i] * 1.5);
      if (gm > 0.25) { const t = smoothstep(0.25, 0.6, gm); r = lerp(r, 44, t); g = lerp(g, 42, t); b = lerp(b, 40, t); }
      out.r = clamp01(r / 255) * 255; out.g = clamp01(g / 255) * 255; out.b = clamp01(b / 255) * 255;
    });

    const rough = new Field(S, S);
    for (let i = 0; i < rough.data.length; i++) {
      rough.data[i] = clamp01(0.9 - macro.data[i] * 0.1 + micro.data[i] * 0.06 - grit.data[i] * 0.05);
    }

    return this.std({
      map,
      normalMap: heightToNormal(height, 1.9),
      roughnessMap: fieldToGray(rough),
      roughness: 1,
      envMapIntensity: 0.5,
    });
  }

  _curb() {
    const m = this.get('sidewalk').clone();
    m.color = new THREE.Color(0xb8b4ad);
    return m;
  }

  _concrete(tint, rough) {
    const rng = this.rng.stream(`concrete${tint}`);
    const S = SIZE.high;
    const macro = fbmField(S, S, 3, 5, rng.stream('m'));
    const pores = worleyField(S, S, 90, rng.stream('p'), 'f1');
    const grit = speckleField(S, S, rng.stream('g'), 0.5, 1.3);
    const streak = streakField(S, S, rng.stream('s'), 34, { maxLen: 0.9, width: 3 });
    const crack = crackField(S, S, rng.stream('c'), { seeds: 4, width: 0.9, stepLen: 3, branch: 0.05 });
    const micro = whiteField(S, S, rng.stream('mi'));
    const form = bandField(S, S, 6, rng.stream('f'), 0.5);

    const height = new Field(S, S);
    for (let i = 0; i < height.data.length; i++) {
      height.data[i] = macro.data[i] * 0.4 + (1 - pores.data[i]) * 0.12 + grit.data[i] * 0.2
        - crack.data[i] * 0.9 + micro.data[i] * 0.05;
    }
    height.normalize(0, 1);

    const c = new THREE.Color(tint);
    const map = fieldsToTexture(S, S, (x, y, out) => {
      const i = y * S + x;
      let v = 0.72 + macro.data[i] * 0.4 - 0.2 + form.data[i] * 0.09 + grit.data[i] * 0.13 + micro.data[i] * 0.05;
      v *= 1 - clamp01(streak.data[i]) * 0.34;              // rain streaking
      v = lerp(v, v * 0.5, clamp01(crack.data[i]));
      if (pores.data[i] < 0.12) v *= 0.78;                   // blow holes
      out.r = clamp01(c.r * v) * 255;
      out.g = clamp01(c.g * v * 0.995) * 255;
      out.b = clamp01(c.b * v * 0.985) * 255;
    });

    const rf = new Field(S, S);
    for (let i = 0; i < rf.data.length; i++) {
      rf.data[i] = clamp01(rough - macro.data[i] * 0.1 + micro.data[i] * 0.05 + clamp01(streak.data[i]) * 0.05);
    }

    return this.std({
      map,
      normalMap: heightToNormal(height, 1.5),
      roughnessMap: fieldToGray(rf),
      roughness: 1,
      envMapIntensity: 0.45,
    });
  }

  /* ---------------------------- masonry --------------------------- */

  _brick(dark, light, mortarCol) {
    const rng = this.rng.stream(`brick${dark}`);
    const S = SIZE.hero;
    const rows = 16;
    const lat = brickLattice(S, S, rows, rng.stream('lat'), { mortar: 0.06, aspect: 2.45 });
    const macro = fbmField(S, S, 3, 4, rng.stream('macro'));
    const grain = fbmField(S, S, 40, 3, rng.stream('grain'));
    const micro = whiteField(S, S, rng.stream('micro'));
    const streak = streakField(S, S, rng.stream('streak'), 46, { maxLen: 0.85, width: 3.5 });
    const efflor = fbmField(S, S, 7, 3, rng.stream('eff'));
    const soot = fbmField(S, S, 2, 3, rng.stream('soot'));
    const chip = speckleField(S, S, rng.stream('chip'), 0.06, 3.2);
    const mortarGrit = speckleField(S, S, rng.stream('mg'), 0.6, 1.2);

    const dc = new THREE.Color(dark), lc = new THREE.Color(light), mc = new THREE.Color(mortarCol);

    const height = new Field(S, S);
    for (let i = 0; i < height.data.length; i++) {
      const m = lat.mask.data[i];
      // bricks proud of mortar, each with its own tiny depth offset
      let hgt = m * (0.62 + lat.id.data[i] * 0.1) + (1 - m) * 0.18;
      hgt += grain.data[i] * 0.07 * m + mortarGrit.data[i] * 0.1 * (1 - m);
      hgt -= lat.edge.data[i] * 0.16 * m;                  // rounded brick arrises
      hgt -= clamp01(chip.data[i]) * 0.35 * m;             // spalled corners
      hgt += micro.data[i] * 0.035;
      height.data[i] = hgt;
    }
    height.normalize(0, 1);

    const map = fieldsToTexture(S, S, (x, y, out) => {
      const i = y * S + x;
      const m = lat.mask.data[i];
      const id = lat.id.data[i];
      let r, g, b;
      if (m > 0.5) {
        const t = clamp01(id * 0.9 + macro.data[i] * 0.35 - 0.1);
        r = lerp(dc.r, lc.r, t); g = lerp(dc.g, lc.g, t); b = lerp(dc.b, lc.b, t);
        const gr = grain.data[i] * 0.28 - 0.12;
        r += gr * 0.14; g += gr * 0.11; b += gr * 0.09;
        // fired-clay flecks
        const ch = clamp01(chip.data[i]);
        if (ch > 0.3) { const s = smoothstep(0.3, 0.75, ch); r = lerp(r, 0.62, s); g = lerp(g, 0.5, s); b = lerp(b, 0.42, s); }
      } else {
        const t = mortarGrit.data[i] * 0.3 + macro.data[i] * 0.2 - 0.12;
        r = mc.r + t * 0.35; g = mc.g + t * 0.35; b = mc.b + t * 0.33;
        // mortar darkens where water tracks
        r *= 0.94; g *= 0.94; b *= 0.93;
      }
      // efflorescence — white mineral bloom, mostly near mortar
      const ef = smoothstep(0.62, 0.9, efflor.data[i]) * (1 - m * 0.55);
      r = lerp(r, 0.82, ef * 0.5); g = lerp(g, 0.81, ef * 0.5); b = lerp(b, 0.79, ef * 0.5);
      // vertical rain streaking, strongest below sills
      const st = clamp01(streak.data[i]);
      r *= 1 - st * 0.4; g *= 1 - st * 0.4; b *= 1 - st * 0.37;
      // decades of soot on the upper-facing edges
      const so = smoothstep(0.5, 0.85, soot.data[i]);
      r = lerp(r, 0.13, so * 0.4); g = lerp(g, 0.12, so * 0.4); b = lerp(b, 0.12, so * 0.4);
      // grime pooling into the mortar joints
      const eg = lat.edge.data[i] * m;
      r *= 1 - eg * 0.22; g *= 1 - eg * 0.22; b *= 1 - eg * 0.2;
      const mi = micro.data[i] * 0.06 - 0.03;
      out.r = clamp01(r + mi) * 255; out.g = clamp01(g + mi) * 255; out.b = clamp01(b + mi) * 255;
    });

    const rf = new Field(S, S);
    for (let i = 0; i < rf.data.length; i++) {
      const m = lat.mask.data[i];
      let v = m > 0.5 ? 0.78 + grain.data[i] * 0.14 : 0.95;
      v -= clamp01(streak.data[i]) * 0.06;
      v += micro.data[i] * 0.05;
      rf.data[i] = clamp01(v);
    }

    // Cheap baked cavity: darken where the height field is low.
    const ao = new Field(S, S);
    const blurred = height.copy().blur(6, 2);
    for (let i = 0; i < ao.data.length; i++) {
      ao.data[i] = clamp01(0.55 + (height.data[i] - blurred.data[i]) * 2.2 + 0.35);
    }

    return this.std({
      map,
      normalMap: heightToNormal(height, 2.6),
      roughnessMap: fieldToGray(rf),
      aoMap: fieldToGray(ao),
      roughness: 1,
      envMapIntensity: 0.4,
    });
  }

  _brickPainted() {
    const base = this.get('brickTan');
    const m = base.clone();
    m.color = new THREE.Color(0x8d8478);
    m.roughness = 0.96;
    return m;
  }

  _limestone() {
    const rng = this.rng.stream('limestone');
    const S = SIZE.high;
    const courses = bandField(S, S, 7, rng.stream('c'), 0.55);
    const macro = fbmField(S, S, 4, 5, rng.stream('m'));
    const veins = ridgedField(S, S, 6, 4, rng.stream('v'));
    const pit = worleyField(S, S, 120, rng.stream('p'), 'f1');
    const micro = whiteField(S, S, rng.stream('mi'));
    const streak = streakField(S, S, rng.stream('s'), 40, { maxLen: 0.95, width: 4 });
    const soot = fbmField(S, S, 3, 3, rng.stream('so'));

    // joint lines between courses
    const joint = new Field(S, S);
    const ch = S / 7;
    for (let y = 0; y < S; y++) {
      const ry = y % ch;
      const d = Math.min(ry, ch - ry);
      const v = 1 - clamp01(d / 2.6);
      for (let x = 0; x < S; x++) joint.data[y * S + x] = v;
    }

    const height = new Field(S, S);
    for (let i = 0; i < height.data.length; i++) {
      height.data[i] = macro.data[i] * 0.3 + veins.data[i] * 0.12 + (1 - pit.data[i]) * 0.14
        - joint.data[i] * 0.8 + courses.data[i] * 0.08 + micro.data[i] * 0.04;
    }
    height.normalize(0, 1);

    const map = fieldsToTexture(S, S, (x, y, out) => {
      const i = y * S + x;
      let v = 0.68 + courses.data[i] * 0.12 + macro.data[i] * 0.22 - 0.1 + veins.data[i] * 0.06;
      v *= 1 - clamp01(streak.data[i]) * 0.42;
      v = lerp(v, v * 0.45, joint.data[i]);
      if (pit.data[i] < 0.1) v *= 0.8;
      const so = smoothstep(0.55, 0.9, soot.data[i]);
      v = lerp(v, v * 0.42, so * 0.55);
      const mi = micro.data[i] * 0.05 - 0.025;
      out.r = clamp01(v * 0.95 + mi) * 255;
      out.g = clamp01(v * 0.925 + mi) * 255;
      out.b = clamp01(v * 0.855 + mi) * 255;
    });

    const rf = new Field(S, S);
    for (let i = 0; i < rf.data.length; i++) rf.data[i] = clamp01(0.85 + micro.data[i] * 0.08 - macro.data[i] * 0.08);

    return this.std({ map, normalMap: heightToNormal(height, 1.6), roughnessMap: fieldToGray(rf), roughness: 1, envMapIntensity: 0.45 });
  }

  _plaster() {
    const rng = this.rng.stream('plaster');
    const S = SIZE.high;
    const macro = fbmField(S, S, 4, 5, rng.stream('m'));
    const trowel = fbmField(S, S, 12, 3, rng.stream('t'));
    const crack = crackField(S, S, rng.stream('c'), { seeds: 12, width: 1.0, stepLen: 3, branch: 0.1, maxDepth: 5 });
    const peel = worleyField(S, S, 14, rng.stream('p'), 'f2f1');
    const micro = whiteField(S, S, rng.stream('mi'));

    const height = new Field(S, S);
    for (let i = 0; i < height.data.length; i++) {
      const pe = smoothstep(0.18, 0.06, peel.data[i]);
      height.data[i] = macro.data[i] * 0.35 + trowel.data[i] * 0.2 - crack.data[i] * 0.8 - pe * 0.5 + micro.data[i] * 0.04;
    }
    height.normalize(0, 1);

    const map = fieldsToTexture(S, S, (x, y, out) => {
      const i = y * S + x;
      let v = 0.74 + macro.data[i] * 0.22 - 0.11 + trowel.data[i] * 0.1;
      const cr = clamp01(crack.data[i]);
      v = lerp(v, 0.3, cr * 0.8);
      const pe = smoothstep(0.2, 0.05, peel.data[i]);
      // exposed lath/substrate behind failed plaster
      let r = v * 0.96, g = v * 0.93, b = v * 0.87;
      r = lerp(r, 0.34, pe); g = lerp(g, 0.27, pe); b = lerp(b, 0.22, pe);
      const mi = micro.data[i] * 0.05 - 0.025;
      out.r = clamp01(r + mi) * 255; out.g = clamp01(g + mi) * 255; out.b = clamp01(b + mi) * 255;
    });
    return this.std({ map, normalMap: heightToNormal(height, 1.8), roughness: 0.95, envMapIntensity: 0.35 });
  }

  _stucco() {
    const m = this.get('plaster').clone();
    m.color = new THREE.Color(0xa39a8b);
    return m;
  }

  _terracotta() {
    const m = this.get('brickTan').clone();
    m.color = new THREE.Color(0xa8836a);
    m.roughness = 0.72;
    return m;
  }

  /* ----------------------------- glass ---------------------------- */

  _glass(tint, rough, opacity) {
    const rng = this.rng.stream(`glass${tint}`);
    const S = SIZE.high;
    const grime = fbmField(S, S, 4, 4, rng.stream('g'));
    const streak = streakField(S, S, rng.stream('s'), 60, { maxLen: 1.0, width: 2.4 });
    const dust = speckleField(S, S, rng.stream('d'), 0.25, 1.1);
    const micro = whiteField(S, S, rng.stream('mi'));

    const c = new THREE.Color(tint);
    const map = fieldsToTexture(S, S, (x, y, out) => {
      const i = y * S + x;
      const g = clamp01(grime.data[i] * 0.6 + clamp01(streak.data[i]) * 0.5 + dust.data[i] * 0.3);
      const v = 1 + g * 0.55;
      out.r = clamp01(c.r * v + g * 0.1) * 255;
      out.g = clamp01(c.g * v + g * 0.1) * 255;
      out.b = clamp01(c.b * v + g * 0.095) * 255;
    });

    const rf = new Field(S, S);
    for (let i = 0; i < rf.data.length; i++) {
      rf.data[i] = clamp01(rough + clamp01(streak.data[i]) * 0.35 + grime.data[i] * 0.25 + dust.data[i] * 0.2 + micro.data[i] * 0.03);
    }

    return this.std({
      map,
      roughnessMap: fieldToGray(rf),
      roughness: 1,
      metalness: 0.75,
      transparent: true,
      opacity,
      envMapIntensity: 1.9,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
  }

  _glassBroken() {
    const rng = this.rng.stream('glassBroken');
    const S = SIZE.high;
    // radial shatter + crack web
    const shard = crackField(S, S, rng.stream('c'), { seeds: 3, width: 1.6, stepLen: 6, branch: 0.22, maxDepth: 6, wander: 0.18, lenScale: 2.2 });
    const web = worleyField(S, S, 16, rng.stream('w'), 'f2f1');
    const grime = fbmField(S, S, 5, 4, rng.stream('g'));
    const hole = worleyField(S, S, 5, rng.stream('h'), 'f1');

    const alpha = new Field(S, S);
    for (let i = 0; i < alpha.data.length; i++) {
      // missing panes where the shatter is densest
      const gone = smoothstep(0.3, 0.12, hole.data[i]) * smoothstep(0.35, 0.7, shard.data[i] + grime.data[i] * 0.3);
      alpha.data[i] = clamp01(1 - gone * 1.4);
    }

    const map = fieldsToTexture(S, S, (x, y, out) => {
      const i = y * S + x;
      const cr = clamp01(shard.data[i]) + smoothstep(0.14, 0.0, web.data[i]) * 0.7;
      const v = 0.06 + clamp01(cr) * 0.5 + grime.data[i] * 0.12;
      out.r = clamp01(v * 0.95) * 255; out.g = clamp01(v) * 255; out.b = clamp01(v * 1.05) * 255;
    });

    const rf = new Field(S, S);
    for (let i = 0; i < rf.data.length; i++) rf.data[i] = clamp01(0.12 + clamp01(shard.data[i]) * 0.7 + grime.data[i] * 0.3);

    return this.std({
      map,
      roughnessMap: fieldToGray(rf),
      alphaMap: fieldToGray(alpha),
      transparent: true,
      opacity: 0.72,
      alphaTest: 0.12,
      roughness: 1,
      metalness: 0.55,
      side: THREE.DoubleSide,
      envMapIntensity: 1.4,
      depthWrite: false,
    });
  }

  _carGlass() {
    const m = this._glass(0x14181c, 0.09, 0.55);
    m.envMapIntensity = 1.6;
    return m;
  }

  /* ----------------------------- metal ---------------------------- */

  _metalPainted(tint) {
    const rng = this.rng.stream(`mp${tint}`);
    const S = SIZE.high;
    const macro = fbmField(S, S, 5, 4, rng.stream('m'));
    const chips = speckleField(S, S, rng.stream('c'), 0.18, 2.6);
    const rustBloom = fbmField(S, S, 9, 4, rng.stream('r'));
    const streak = streakField(S, S, rng.stream('s'), 26, { maxLen: 0.7, width: 2 });
    const scratch = crackField(S, S, rng.stream('sc'), { seeds: 14, width: 0.6, stepLen: 8, branch: 0.02, wander: 0.08, maxDepth: 1 });
    const micro = whiteField(S, S, rng.stream('mi'));
    const dent = fbmField(S, S, 8, 3, rng.stream('d'));

    const c = new THREE.Color(tint);
    const height = new Field(S, S);
    for (let i = 0; i < height.data.length; i++) {
      height.data[i] = dent.data[i] * 0.5 - clamp01(chips.data[i]) * 0.3 - scratch.data[i] * 0.15 + micro.data[i] * 0.04;
    }
    height.normalize(0, 1);

    const map = fieldsToTexture(S, S, (x, y, out) => {
      const i = y * S + x;
      const v = 0.86 + macro.data[i] * 0.28 - 0.14;
      let r = c.r * v, g = c.g * v, b = c.b * v;
      // paint chipped away → rust underneath
      const ch = clamp01(chips.data[i] * 1.2);
      const ru = smoothstep(0.55, 0.85, rustBloom.data[i]);
      const rust = clamp01(ch * 0.9 + ru * 0.6);
      r = lerp(r, 0.42, rust); g = lerp(g, 0.22, rust); b = lerp(b, 0.11, rust);
      const st = clamp01(streak.data[i]);
      r = lerp(r, 0.3, st * 0.35); g = lerp(g, 0.19, st * 0.35); b = lerp(b, 0.12, st * 0.35);
      const sc = clamp01(scratch.data[i]);
      r = lerp(r, 0.62, sc * 0.5); g = lerp(g, 0.62, sc * 0.5); b = lerp(b, 0.6, sc * 0.5);
      const mi = micro.data[i] * 0.04 - 0.02;
      out.r = clamp01(r + mi) * 255; out.g = clamp01(g + mi) * 255; out.b = clamp01(b + mi) * 255;
    });

    const rf = new Field(S, S);
    const mf = new Field(S, S);
    for (let i = 0; i < rf.data.length; i++) {
      const rust = clamp01(clamp01(chips.data[i] * 1.2) * 0.9 + smoothstep(0.55, 0.85, rustBloom.data[i]) * 0.6);
      rf.data[i] = clamp01(lerp(0.48, 0.94, rust) + macro.data[i] * 0.08 - clamp01(scratch.data[i]) * 0.25);
      mf.data[i] = clamp01(lerp(0.72, 0.25, rust));
    }

    return this.std({
      map,
      normalMap: heightToNormal(height, 1.1),
      roughnessMap: fieldToGray(rf),
      metalnessMap: fieldToGray(mf),
      roughness: 1, metalness: 1,
      envMapIntensity: 1.0,
    });
  }

  _metalRust() {
    const rng = this.rng.stream('rust');
    const S = SIZE.high;
    const macro = fbmField(S, S, 4, 5, rng.stream('m'));
    const flake = worleyField(S, S, 40, rng.stream('f'), 'f2f1');
    const pit = worleyField(S, S, 110, rng.stream('p'), 'f1');
    const streak = streakField(S, S, rng.stream('s'), 55, { maxLen: 1.0, width: 3 });
    const micro = whiteField(S, S, rng.stream('mi'));

    const height = new Field(S, S);
    for (let i = 0; i < height.data.length; i++) {
      height.data[i] = macro.data[i] * 0.4 + smoothstep(0.2, 0.0, flake.data[i]) * 0.35
        - (1 - pit.data[i]) * 0.2 + micro.data[i] * 0.06;
    }
    height.normalize(0, 1);

    const map = fieldsToTexture(S, S, (x, y, out) => {
      const i = y * S + x;
      const t = clamp01(macro.data[i] * 1.1 - 0.05);
      // deep oxide → bright orange scale → dark pitted steel
      let r = lerp(0.28, 0.66, t), g = lerp(0.12, 0.31, t), b = lerp(0.06, 0.14, t);
      const fl = smoothstep(0.16, 0.0, flake.data[i]);
      r = lerp(r, 0.18, fl * 0.7); g = lerp(g, 0.16, fl * 0.7); b = lerp(b, 0.15, fl * 0.7);
      const st = clamp01(streak.data[i]);
      r = lerp(r, 0.45, st * 0.4); g = lerp(g, 0.21, st * 0.4); b = lerp(b, 0.1, st * 0.4);
      const mi = micro.data[i] * 0.07 - 0.035;
      out.r = clamp01(r + mi) * 255; out.g = clamp01(g + mi) * 255; out.b = clamp01(b + mi) * 255;
    });

    const rf = new Field(S, S);
    const mf = new Field(S, S);
    for (let i = 0; i < rf.data.length; i++) {
      rf.data[i] = clamp01(0.88 - macro.data[i] * 0.12 + micro.data[i] * 0.06);
      mf.data[i] = clamp01(0.18 + (1 - macro.data[i]) * 0.35);
    }
    return this.std({ map, normalMap: heightToNormal(height, 2.0), roughnessMap: fieldToGray(rf), metalnessMap: fieldToGray(mf), roughness: 1, metalness: 1, envMapIntensity: 0.7 });
  }

  _galvanized() {
    const rng = this.rng.stream('galv');
    const S = SIZE.mid;
    const spangle = worleyField(S, S, 26, rng.stream('s'), 'f2f1');
    const macro = fbmField(S, S, 5, 4, rng.stream('m'));
    const dirt = fbmField(S, S, 8, 3, rng.stream('d'));
    const micro = whiteField(S, S, rng.stream('mi'));
    const height = new Field(S, S);
    for (let i = 0; i < height.data.length; i++) height.data[i] = spangle.data[i] * 0.4 + macro.data[i] * 0.2 + micro.data[i] * 0.06;
    height.normalize(0, 1);
    const map = fieldsToTexture(S, S, (x, y, out) => {
      const i = y * S + x;
      let v = 0.6 + spangle.data[i] * 0.3 + macro.data[i] * 0.18 - 0.09;
      v *= 1 - smoothstep(0.5, 0.85, dirt.data[i]) * 0.35;
      out.r = clamp01(v * 0.97 + micro.data[i] * 0.04 - 0.02) * 255;
      out.g = clamp01(v * 0.985 + micro.data[i] * 0.04 - 0.02) * 255;
      out.b = clamp01(v * 1.0 + micro.data[i] * 0.04 - 0.02) * 255;
    });
    const rf = new Field(S, S);
    for (let i = 0; i < rf.data.length; i++) rf.data[i] = clamp01(0.42 + dirt.data[i] * 0.4 + micro.data[i] * 0.06 - spangle.data[i] * 0.1);
    return this.std({ map, normalMap: heightToNormal(height, 0.9), roughnessMap: fieldToGray(rf), roughness: 1, metalness: 0.92, envMapIntensity: 1.1 });
  }

  _steel() {
    const rng = this.rng.stream('steel');
    const S = SIZE.mid;
    const brush = fbmField(S, S, 3, 3, rng.stream('b'));
    const scratch = crackField(S, S, rng.stream('s'), { seeds: 20, width: 0.5, stepLen: 10, branch: 0.01, wander: 0.05, maxDepth: 1 });
    const micro = whiteField(S, S, rng.stream('mi'));
    const map = fieldsToTexture(S, S, (x, y, out) => {
      const i = y * S + x;
      const v = 0.5 + brush.data[i] * 0.16 + clamp01(scratch.data[i]) * 0.2 + micro.data[i] * 0.05 - 0.1;
      out.r = clamp01(v * 0.97) * 255; out.g = clamp01(v * 0.985) * 255; out.b = clamp01(v) * 255;
    });
    const rf = new Field(S, S);
    for (let i = 0; i < rf.data.length; i++) rf.data[i] = clamp01(0.38 + brush.data[i] * 0.16 + micro.data[i] * 0.06 - clamp01(scratch.data[i]) * 0.15);
    return this.std({ map, roughnessMap: fieldToGray(rf), roughness: 1, metalness: 0.95, envMapIntensity: 1.3 });
  }

  _fireEscapeMetal() {
    const rng = this.rng.stream('fe');
    const S = SIZE.mid;
    const macro = fbmField(S, S, 5, 4, rng.stream('m'));
    const rust = fbmField(S, S, 11, 4, rng.stream('r'));
    const chips = speckleField(S, S, rng.stream('c'), 0.3, 2.2);
    const micro = whiteField(S, S, rng.stream('mi'));
    const height = new Field(S, S);
    for (let i = 0; i < height.data.length; i++) height.data[i] = macro.data[i] * 0.3 + clamp01(chips.data[i]) * 0.25 + micro.data[i] * 0.05;
    height.normalize(0, 1);
    const map = fieldsToTexture(S, S, (x, y, out) => {
      const i = y * S + x;
      // near-black weathered enamel with rust bleeding through
      let r = 0.1, g = 0.1, b = 0.105;
      const v = 0.85 + macro.data[i] * 0.3;
      r *= v; g *= v; b *= v;
      const ru = clamp01(smoothstep(0.52, 0.88, rust.data[i]) * 0.85 + clamp01(chips.data[i]) * 0.7);
      r = lerp(r, 0.4, ru); g = lerp(g, 0.19, ru); b = lerp(b, 0.09, ru);
      const mi = micro.data[i] * 0.05 - 0.025;
      out.r = clamp01(r + mi) * 255; out.g = clamp01(g + mi) * 255; out.b = clamp01(b + mi) * 255;
    });
    const rf = new Field(S, S);
    const mf = new Field(S, S);
    for (let i = 0; i < rf.data.length; i++) {
      const ru = clamp01(smoothstep(0.52, 0.88, rust.data[i]) * 0.85 + clamp01(chips.data[i]) * 0.7);
      rf.data[i] = clamp01(lerp(0.55, 0.92, ru) + micro.data[i] * 0.05);
      mf.data[i] = clamp01(lerp(0.6, 0.2, ru));
    }
    return this.std({ map, normalMap: heightToNormal(height, 1.2), roughnessMap: fieldToGray(rf), metalnessMap: fieldToGray(mf), roughness: 1, metalness: 1, envMapIntensity: 0.85 });
  }

  _chrome() {
    return this.std({ color: 0xc8ccd0, roughness: 0.22, metalness: 1, envMapIntensity: 1.6 });
  }

  _copperOx() {
    const rng = this.rng.stream('cu');
    const S = SIZE.mid;
    const macro = fbmField(S, S, 5, 5, rng.stream('m'));
    const streak = streakField(S, S, rng.stream('s'), 30, { maxLen: 0.9, width: 3 });
    const map = fieldsToTexture(S, S, (x, y, out) => {
      const i = y * S + x;
      const t = clamp01(macro.data[i] * 1.2 - 0.1);
      let r = lerp(0.28, 0.34, t), g = lerp(0.45, 0.55, t), b = lerp(0.42, 0.47, t);
      const st = clamp01(streak.data[i]);
      r = lerp(r, 0.22, st * 0.5); g = lerp(g, 0.34, st * 0.5); b = lerp(b, 0.31, st * 0.5);
      out.r = r * 255; out.g = g * 255; out.b = b * 255;
    });
    return this.std({ map, roughness: 0.82, metalness: 0.4, envMapIntensity: 0.7 });
  }

  /* ------------------------------ wood ---------------------------- */

  _wood(tint, weathered = false) {
    const rng = this.rng.stream(`wood${tint}${weathered}`);
    const S = SIZE.high;
    const grainN = fbmField(S, S, 3, 4, rng.stream('g'));
    const micro = whiteField(S, S, rng.stream('mi'));
    const knots = worleyField(S, S, 7, rng.stream('k'), 'f1');
    const split = crackField(S, S, rng.stream('sp'), { seeds: 8, width: 0.7, stepLen: 9, branch: 0.02, wander: 0.04, maxDepth: 1 });

    // plank division
    const planks = 6;
    const pw = S / planks;
    const pid = new Field(S, S);
    const pjoint = new Field(S, S);
    const pv = [];
    for (let i = 0; i < planks; i++) pv.push(rng.range(-0.12, 0.12));
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const p = Math.floor(y / pw);
      const ry = y % pw;
      pid.data[y * S + x] = pv[p % planks];
      pjoint.data[y * S + x] = 1 - clamp01(Math.min(ry, pw - ry) / 2.4);
    }

    const grain = new Field(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x;
      // rings along the plank length
      const w = Math.sin((x * 0.35 + grainN.data[i] * 26 + pid.data[i] * 60) * 0.9);
      grain.data[i] = w * 0.5 + 0.5;
    }

    const height = new Field(S, S);
    for (let i = 0; i < height.data.length; i++) {
      height.data[i] = grain.data[i] * 0.22 - pjoint.data[i] * 0.8 - split.data[i] * 0.5
        + smoothstep(0.18, 0.0, knots.data[i]) * 0.3 + micro.data[i] * 0.06;
    }
    height.normalize(0, 1);

    const c = new THREE.Color(tint);
    const map = fieldsToTexture(S, S, (x, y, out) => {
      const i = y * S + x;
      let v = 0.78 + grain.data[i] * 0.3 - 0.15 + pid.data[i] * 0.7;
      if (weathered) v = lerp(v, v * 1.15 + 0.1, 0.6);
      let r = c.r * v, g = c.g * v, b = c.b * v;
      if (weathered) { const gray = (r + g + b) / 3; r = lerp(r, gray, 0.55); g = lerp(g, gray, 0.55); b = lerp(b, gray, 0.5); }
      const kn = smoothstep(0.2, 0.02, knots.data[i]);
      r = lerp(r, c.r * 0.42, kn); g = lerp(g, c.g * 0.4, kn); b = lerp(b, c.b * 0.38, kn);
      const sp = clamp01(split.data[i]);
      r = lerp(r, r * 0.35, sp); g = lerp(g, g * 0.35, sp); b = lerp(b, b * 0.35, sp);
      r = lerp(r, r * 0.4, pjoint.data[i]); g = lerp(g, g * 0.4, pjoint.data[i]); b = lerp(b, b * 0.4, pjoint.data[i]);
      const mi = micro.data[i] * 0.05 - 0.025;
      out.r = clamp01(r + mi) * 255; out.g = clamp01(g + mi) * 255; out.b = clamp01(b + mi) * 255;
    });

    const rf = new Field(S, S);
    for (let i = 0; i < rf.data.length; i++) rf.data[i] = clamp01((weathered ? 0.94 : 0.8) - grain.data[i] * 0.08 + micro.data[i] * 0.06);
    return this.std({ map, normalMap: heightToNormal(height, 1.7), roughnessMap: fieldToGray(rf), roughness: 1, envMapIntensity: 0.35 });
  }

  _waterTankWood() {
    const m = this._wood(0x6d5a41, true);
    m.color = new THREE.Color(0xb9ada0);
    return m;
  }

  _plywood() {
    const rng = this.rng.stream('ply');
    const S = SIZE.high;
    const grain = fbmField(S, S, 2, 4, rng.stream('g'));
    const flake = fbmField(S, S, 22, 3, rng.stream('f'));
    const micro = whiteField(S, S, rng.stream('mi'));
    const stain = fbmField(S, S, 6, 3, rng.stream('s'));
    const height = new Field(S, S);
    for (let i = 0; i < height.data.length; i++) height.data[i] = flake.data[i] * 0.3 + grain.data[i] * 0.2 + micro.data[i] * 0.07;
    height.normalize(0, 1);
    const map = fieldsToTexture(S, S, (x, y, out) => {
      const i = y * S + x;
      const v = 0.72 + grain.data[i] * 0.34 - 0.17 + flake.data[i] * 0.18 - 0.09;
      let r = 0.66 * v * 1.16, g = 0.52 * v * 1.12, b = 0.36 * v * 1.05;
      const st = smoothstep(0.5, 0.85, stain.data[i]);
      r = lerp(r, r * 0.55, st); g = lerp(g, g * 0.55, st); b = lerp(b, b * 0.58, st);
      const mi = micro.data[i] * 0.06 - 0.03;
      out.r = clamp01(r + mi) * 255; out.g = clamp01(g + mi) * 255; out.b = clamp01(b + mi) * 255;
    });
    return this.std({ map, normalMap: heightToNormal(height, 1.4), roughness: 0.93, envMapIntensity: 0.3 });
  }

  _scaffoldPlank() {
    const m = this._wood(0x8a7351, true);
    m.color = new THREE.Color(0xc0b7a6);
    return m;
  }

  /* ---------------------------- vehicles -------------------------- */

  _vehiclePaint(tint, dirtAmt = 0.7) {
    const rng = this.rng.stream(`vp${tint}`);
    const S = SIZE.high;
    const orange = speckleField(S, S, rng.stream('o'), 0.12, 2.0);
    const dirt = fbmField(S, S, 6, 4, rng.stream('d'));
    const lowerDirt = new Field(S, S);
    for (let y = 0; y < S; y++) {
      const t = smoothstep(0.45, 1.0, y / S);
      for (let x = 0; x < S; x++) lowerDirt.data[y * S + x] = t;
    }
    const swirl = crackField(S, S, rng.stream('s'), { seeds: 22, width: 0.5, stepLen: 12, branch: 0.01, wander: 0.06, maxDepth: 1 });
    const micro = whiteField(S, S, rng.stream('mi'));
    const dent = fbmField(S, S, 9, 3, rng.stream('de'));

    const height = new Field(S, S);
    for (let i = 0; i < height.data.length; i++) height.data[i] = dent.data[i] * 0.4 - clamp01(orange.data[i]) * 0.35 + micro.data[i] * 0.03;
    height.normalize(0, 1);

    const c = new THREE.Color(tint);
    const map = fieldsToTexture(S, S, (x, y, out) => {
      const i = y * S + x;
      let r = c.r, g = c.g, b = c.b;
      const v = 0.94 + dent.data[i] * 0.12;
      r *= v; g *= v; b *= v;
      const ru = clamp01(orange.data[i] * 1.2);
      r = lerp(r, 0.34, ru * 0.85); g = lerp(g, 0.17, ru * 0.85); b = lerp(b, 0.08, ru * 0.85);
      const d = clamp01((smoothstep(0.42, 0.85, dirt.data[i]) * 0.7 + lowerDirt.data[i] * 0.8) * dirtAmt);
      r = lerp(r, 0.24, d * 0.7); g = lerp(g, 0.22, d * 0.7); b = lerp(b, 0.19, d * 0.7);
      const sw = clamp01(swirl.data[i]);
      r = lerp(r, r * 1.5 + 0.08, sw * 0.4); g = lerp(g, g * 1.5 + 0.08, sw * 0.4); b = lerp(b, b * 1.5 + 0.08, sw * 0.4);
      const mi = micro.data[i] * 0.03 - 0.015;
      out.r = clamp01(r + mi) * 255; out.g = clamp01(g + mi) * 255; out.b = clamp01(b + mi) * 255;
    });

    const rf = new Field(S, S);
    for (let i = 0; i < rf.data.length; i++) {
      const d = clamp01((smoothstep(0.42, 0.85, dirt.data[i]) * 0.7 + lowerDirt.data[i] * 0.8) * dirtAmt);
      const ru = clamp01(orange.data[i] * 1.2);
      rf.data[i] = clamp01(lerp(0.22, 0.82, Math.max(d * 0.85, ru)) + clamp01(swirl.data[i]) * 0.15 + micro.data[i] * 0.04);
    }
    return this.std({
      map, normalMap: heightToNormal(height, 0.85), normalScale: 0.6,
      roughnessMap: fieldToGray(rf), roughness: 1, metalness: 0.55, envMapIntensity: 1.35,
    });
  }

  _burnt() {
    const rng = this.rng.stream('burnt');
    const S = SIZE.high;
    const macro = fbmField(S, S, 5, 5, rng.stream('m'));
    const blister = worleyField(S, S, 55, rng.stream('b'), 'f1');
    const ash = fbmField(S, S, 14, 3, rng.stream('a'));
    const micro = whiteField(S, S, rng.stream('mi'));
    const height = new Field(S, S);
    for (let i = 0; i < height.data.length; i++) height.data[i] = (1 - blister.data[i]) * 0.4 + macro.data[i] * 0.3 + micro.data[i] * 0.08;
    height.normalize(0, 1);
    const map = fieldsToTexture(S, S, (x, y, out) => {
      const i = y * S + x;
      let v = 0.045 + macro.data[i] * 0.09 + (1 - blister.data[i]) * 0.05;
      // heat-tint bloom where the paint burned but the steel survived
      const t = smoothstep(0.55, 0.85, macro.data[i]);
      let r = v, g = v * 0.96, b = v * 0.95;
      r = lerp(r, 0.14, t * 0.5); g = lerp(g, 0.1, t * 0.5); b = lerp(b, 0.09, t * 0.5);
      const a = smoothstep(0.6, 0.9, ash.data[i]);
      r = lerp(r, 0.3, a * 0.35); g = lerp(g, 0.29, a * 0.35); b = lerp(b, 0.28, a * 0.35);
      const mi = micro.data[i] * 0.03;
      out.r = clamp01(r + mi) * 255; out.g = clamp01(g + mi) * 255; out.b = clamp01(b + mi) * 255;
    });
    const rf = new Field(S, S);
    for (let i = 0; i < rf.data.length; i++) rf.data[i] = clamp01(0.88 + micro.data[i] * 0.08 - macro.data[i] * 0.1);
    return this.std({ map, normalMap: heightToNormal(height, 2.2), roughnessMap: fieldToGray(rf), roughness: 1, metalness: 0.3, envMapIntensity: 0.3 });
  }

  _rubber() {
    const rng = this.rng.stream('rubber');
    const S = SIZE.mid;
    const macro = fbmField(S, S, 8, 4, rng.stream('m'));
    const micro = whiteField(S, S, rng.stream('mi'));
    const wear = fbmField(S, S, 20, 3, rng.stream('w'));
    const height = new Field(S, S);
    for (let i = 0; i < height.data.length; i++) height.data[i] = macro.data[i] * 0.3 + micro.data[i] * 0.12 + wear.data[i] * 0.15;
    height.normalize(0, 1);
    const map = fieldsToTexture(S, S, (x, y, out) => {
      const i = y * S + x;
      const v = 0.055 + macro.data[i] * 0.05 + micro.data[i] * 0.03 + wear.data[i] * 0.035;
      out.r = clamp01(v) * 255; out.g = clamp01(v * 0.99) * 255; out.b = clamp01(v * 1.0) * 255;
    });
    const rf = new Field(S, S);
    for (let i = 0; i < rf.data.length; i++) rf.data[i] = clamp01(0.86 + micro.data[i] * 0.08 - wear.data[i] * 0.12);
    return this.std({ map, normalMap: heightToNormal(height, 1.4), roughnessMap: fieldToGray(rf), roughness: 1, metalness: 0.02, envMapIntensity: 0.25 });
  }

  /* --------------------------- ground junk ------------------------ */

  _soot() {
    const rng = this.rng.stream('soot');
    const S = SIZE.mid;
    const f = fbmField(S, S, 4, 5, rng.stream('f'));
    const alpha = new Field(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const dx = (x / S - 0.5) * 2, dy = (y / S - 0.5) * 2;
      const r = Math.hypot(dx, dy);
      alpha.data[i] = clamp01((1 - smoothstep(0.25, 1.0, r)) * (0.35 + f.data[i] * 0.9));
    }
    const map = fieldsToTexture(S, S, (x, y, out) => {
      const i = y * S + x;
      const v = 0.03 + f.data[i] * 0.05;
      out.r = v * 255; out.g = v * 255; out.b = v * 255;
    });
    return this.std({ map, alphaMap: fieldToGray(alpha), transparent: true, opacity: 0.9, roughness: 0.98, depthWrite: false });
  }

  _dirtGround() {
    const rng = this.rng.stream('dirtG');
    const S = SIZE.high;
    const macro = fbmField(S, S, 4, 5, rng.stream('m'));
    const grit = speckleField(S, S, rng.stream('g'), 0.9, 2.2);
    const micro = whiteField(S, S, rng.stream('mi'));
    const height = new Field(S, S);
    for (let i = 0; i < height.data.length; i++) height.data[i] = macro.data[i] * 0.4 + grit.data[i] * 0.35 + micro.data[i] * 0.08;
    height.normalize(0, 1);
    const map = fieldsToTexture(S, S, (x, y, out) => {
      const i = y * S + x;
      const v = 0.3 + macro.data[i] * 0.24 + grit.data[i] * 0.18 + micro.data[i] * 0.07 - 0.12;
      out.r = clamp01(v * 1.02) * 255; out.g = clamp01(v * 0.94) * 255; out.b = clamp01(v * 0.84) * 255;
    });
    return this.std({ map, normalMap: heightToNormal(height, 2.0), roughness: 0.97, envMapIntensity: 0.3 });
  }

  _rubble() {
    const rng = this.rng.stream('rubble');
    const S = SIZE.high;
    const chunks = worleyField(S, S, 30, rng.stream('c'), 'f2f1');
    const chunks2 = worleyField(S, S, 70, rng.stream('c2'), 'f2f1');
    const macro = fbmField(S, S, 5, 4, rng.stream('m'));
    const dust = fbmField(S, S, 10, 3, rng.stream('d'));
    const micro = whiteField(S, S, rng.stream('mi'));
    const height = new Field(S, S);
    for (let i = 0; i < height.data.length; i++) {
      height.data[i] = smoothstep(0.0, 0.35, chunks.data[i]) * 0.5 + smoothstep(0.0, 0.3, chunks2.data[i]) * 0.28
        + macro.data[i] * 0.2 + micro.data[i] * 0.07;
    }
    height.normalize(0, 1);
    const map = fieldsToTexture(S, S, (x, y, out) => {
      const i = y * S + x;
      const seg = chunks.data[i];
      let v = 0.4 + macro.data[i] * 0.3 - 0.15 + smoothstep(0.0, 0.3, seg) * 0.16;
      // mixed concrete-grey with brick-red fragments
      const brickish = smoothstep(0.55, 0.85, dust.data[i]);
      let r = v, g = v * 0.975, b = v * 0.93;
      r = lerp(r, v * 1.25, brickish); g = lerp(g, v * 0.7, brickish); b = lerp(b, v * 0.58, brickish);
      // concrete dust film over everything
      const df = smoothstep(0.35, 0.75, dust.data[i]) * 0.35;
      r = lerp(r, 0.62, df); g = lerp(g, 0.6, df); b = lerp(b, 0.56, df);
      const mi = micro.data[i] * 0.07 - 0.035;
      out.r = clamp01(r + mi) * 255; out.g = clamp01(g + mi) * 255; out.b = clamp01(b + mi) * 255;
    });
    const rf = new Field(S, S);
    for (let i = 0; i < rf.data.length; i++) rf.data[i] = clamp01(0.93 + micro.data[i] * 0.06 - macro.data[i] * 0.06);
    return this.std({ map, normalMap: heightToNormal(height, 2.4), roughnessMap: fieldToGray(rf), roughness: 1, envMapIntensity: 0.3 });
  }

  _debris() {
    const m = this.get('rubble').clone();
    m.color = new THREE.Color(0x8e8880);
    return m;
  }

  _trashBag() {
    const rng = this.rng.stream('bag');
    const S = SIZE.mid;
    const wrinkle = fbmField(S, S, 9, 4, rng.stream('w'));
    const micro = whiteField(S, S, rng.stream('mi'));
    const height = new Field(S, S);
    for (let i = 0; i < height.data.length; i++) height.data[i] = wrinkle.data[i] * 0.6 + micro.data[i] * 0.05;
    height.normalize(0, 1);
    const map = fieldsToTexture(S, S, (x, y, out) => {
      const i = y * S + x;
      const v = 0.055 + wrinkle.data[i] * 0.07;
      out.r = clamp01(v) * 255; out.g = clamp01(v * 1.02) * 255; out.b = clamp01(v * 1.05) * 255;
    });
    const rf = new Field(S, S);
    for (let i = 0; i < rf.data.length; i++) rf.data[i] = clamp01(0.38 + wrinkle.data[i] * 0.25);
    return this.std({ map, normalMap: heightToNormal(height, 1.6), roughnessMap: fieldToGray(rf), roughness: 1, metalness: 0.05, envMapIntensity: 0.8 });
  }

  _awning(tint) {
    const rng = this.rng.stream(`awn${tint}`);
    const S = SIZE.mid;
    const weave = new Field(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      weave.data[y * S + x] = (Math.sin(x * 1.9) * 0.5 + 0.5) * 0.5 + (Math.sin(y * 1.9) * 0.5 + 0.5) * 0.5;
    }
    const fade = fbmField(S, S, 4, 4, rng.stream('f'));
    const dirt = streakField(S, S, rng.stream('d'), 30, { maxLen: 1.0, width: 3 });
    const micro = whiteField(S, S, rng.stream('mi'));
    const c = new THREE.Color(tint);
    const map = fieldsToTexture(S, S, (x, y, out) => {
      const i = y * S + x;
      const v = 0.85 + weave.data[i] * 0.18 - 0.09;
      // sun-bleached, not saturated
      let r = c.r * v, g = c.g * v, b = c.b * v;
      const f = smoothstep(0.4, 0.85, fade.data[i]);
      r = lerp(r, r * 0.6 + 0.28, f); g = lerp(g, g * 0.6 + 0.26, f); b = lerp(b, b * 0.6 + 0.24, f);
      const d = clamp01(dirt.data[i]);
      r *= 1 - d * 0.45; g *= 1 - d * 0.45; b *= 1 - d * 0.42;
      const mi = micro.data[i] * 0.04 - 0.02;
      out.r = clamp01(r + mi) * 255; out.g = clamp01(g + mi) * 255; out.b = clamp01(b + mi) * 255;
    });
    const hf = new Field(S, S);
    for (let i = 0; i < hf.data.length; i++) hf.data[i] = weave.data[i] * 0.5 + micro.data[i] * 0.1;
    return this.std({ map, normalMap: heightToNormal(hf, 1.1), roughness: 0.93, side: THREE.DoubleSide, envMapIntensity: 0.35 });
  }

  _deadFoliage() {
    const rng = this.rng.stream('foliage');
    const S = SIZE.low;
    const f = fbmField(S, S, 8, 4, rng.stream('f'));
    const map = fieldsToTexture(S, S, (x, y, out) => {
      const i = y * S + x;
      const v = 0.22 + f.data[i] * 0.22;
      out.r = clamp01(v * 1.15) * 255; out.g = clamp01(v * 0.96) * 255; out.b = clamp01(v * 0.62) * 255;
    });
    return this.std({ map, roughness: 0.96, side: THREE.DoubleSide, envMapIntensity: 0.3 });
  }

  /* --------------------------- markings --------------------------- */

  _roadPaint(tint) {
    const rng = this.rng.stream(`paint${tint}`);
    const S = SIZE.mid;
    const wear = fbmField(S, S, 5, 4, rng.stream('w'));
    const scuff = speckleField(S, S, rng.stream('s'), 0.55, 2.4);
    const micro = whiteField(S, S, rng.stream('mi'));
    const c = new THREE.Color(tint);
    const map = fieldsToTexture(S, S, (x, y, out) => {
      const i = y * S + x;
      const v = 0.9 + wear.data[i] * 0.2 - 0.1;
      out.r = clamp01(c.r * v) * 255; out.g = clamp01(c.g * v) * 255; out.b = clamp01(c.b * v) * 255;
    });
    const alpha = new Field(S, S);
    for (let i = 0; i < alpha.data.length; i++) {
      // paint worn through to asphalt in traffic lanes
      alpha.data[i] = clamp01(1 - smoothstep(0.45, 0.82, wear.data[i]) * 1.15 - clamp01(scuff.data[i]) * 0.5);
    }
    const rf = new Field(S, S);
    for (let i = 0; i < rf.data.length; i++) rf.data[i] = clamp01(0.72 + micro.data[i] * 0.1 + clamp01(scuff.data[i]) * 0.15);
    return this.std({
      map, alphaMap: fieldToGray(alpha), roughnessMap: fieldToGray(rf), roughness: 1,
      transparent: true, alphaTest: 0.22, depthWrite: false, envMapIntensity: 0.4,
    });
  }

  _manhole() {
    const rng = this.rng.stream('manhole');
    const S = SIZE.high;
    const rust = fbmField(S, S, 6, 4, rng.stream('r'));
    const micro = whiteField(S, S, rng.stream('mi'));
    const height = new Field(S, S);
    const cx = S / 2, cy = S / 2;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const dx = x - cx, dy = y - cy;
      const r = Math.hypot(dx, dy) / (S * 0.5);
      const a = Math.atan2(dy, dx);
      let h = 0;
      if (r < 0.94) {
        // radial waffle pattern of a cast-iron cover
        const rings = Math.sin(r * 46) * 0.5 + 0.5;
        const spokes = Math.sin(a * 28) * 0.5 + 0.5;
        h = 0.5 + rings * spokes * 0.5;
        if (r > 0.78 && r < 0.9) h = 0.75;          // outer smooth band
        if (r < 0.16) h = 0.7;                       // centre boss
      } else {
        h = 0.15;                                     // seating ring
      }
      height.data[i] = h + micro.data[i] * 0.05 + rust.data[i] * 0.06;
    }
    height.normalize(0, 1);
    const map = fieldsToTexture(S, S, (x, y, out) => {
      const i = y * S + x;
      const v = 0.14 + height.data[i] * 0.16 + rust.data[i] * 0.1;
      let r = v * 1.25, g = v * 1.05, b = v * 0.9;
      const ru = smoothstep(0.5, 0.85, rust.data[i]);
      r = lerp(r, 0.32, ru * 0.6); g = lerp(g, 0.18, ru * 0.6); b = lerp(b, 0.1, ru * 0.6);
      out.r = clamp01(r) * 255; out.g = clamp01(g) * 255; out.b = clamp01(b) * 255;
    });
    const rf = new Field(S, S);
    for (let i = 0; i < rf.data.length; i++) rf.data[i] = clamp01(0.55 + rust.data[i] * 0.35 + micro.data[i] * 0.06);
    return this.std({ map, normalMap: heightToNormal(height, 2.6), roughnessMap: fieldToGray(rf), roughness: 1, metalness: 0.7, envMapIntensity: 0.8 });
  }

  _grate() {
    const rng = this.rng.stream('grate');
    const S = SIZE.high;
    const rust = fbmField(S, S, 7, 4, rng.stream('r'));
    const alpha = new Field(S, S);
    const height = new Field(S, S);
    const bars = 22;
    const bw = S / bars;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const ry = y % bw;
      const solidBar = ry < bw * 0.42;
      // cross members every few bars
      const cross = (x % (bw * 5)) < bw * 0.5;
      const solid = solidBar || cross || y < 4 || y > S - 5 || x < 4 || x > S - 5;
      alpha.data[i] = solid ? 1 : 0;
      height.data[i] = solid ? 0.8 : 0.0;
    }
    const map = fieldsToTexture(S, S, (x, y, out) => {
      const i = y * S + x;
      const v = 0.13 + rust.data[i] * 0.1;
      let r = v * 1.2, g = v * 1.02, b = v * 0.9;
      const ru = smoothstep(0.48, 0.85, rust.data[i]);
      r = lerp(r, 0.34, ru * 0.65); g = lerp(g, 0.18, ru * 0.65); b = lerp(b, 0.09, ru * 0.65);
      out.r = clamp01(r) * 255; out.g = clamp01(g) * 255; out.b = clamp01(b) * 255;
    });
    return this.std({
      map, alphaMap: fieldToGray(alpha), normalMap: heightToNormal(height, 1.5),
      transparent: true, alphaTest: 0.5, roughness: 0.78, metalness: 0.65,
      side: THREE.DoubleSide, envMapIntensity: 0.7,
    });
  }

  _subwayTile() {
    const rng = this.rng.stream('tile');
    const S = SIZE.high;
    // 3x6 subway tile, running bond
    const lat = brickLattice(S, S, 12, rng.stream('l'), { mortar: 0.05, aspect: 2.0 });
    const crackle = crackField(S, S, rng.stream('c'), { seeds: 26, width: 0.5, stepLen: 4, branch: 0.14, maxDepth: 4 });
    const grime = fbmField(S, S, 6, 4, rng.stream('g'));
    const streak = streakField(S, S, rng.stream('s'), 40, { maxLen: 1.0, width: 2.5 });
    const micro = whiteField(S, S, rng.stream('mi'));
    const height = new Field(S, S);
    for (let i = 0; i < height.data.length; i++) {
      const m = lat.mask.data[i];
      height.data[i] = m * 0.7 + (1 - m) * 0.1 - lat.edge.data[i] * 0.25 * m + micro.data[i] * 0.02;
    }
    height.normalize(0, 1);
    const map = fieldsToTexture(S, S, (x, y, out) => {
      const i = y * S + x;
      const m = lat.mask.data[i];
      let v = m > 0.5 ? 0.86 + lat.id.data[i] * 0.06 : 0.42;
      v -= clamp01(crackle.data[i]) * 0.22 * m;
      const g = smoothstep(0.4, 0.8, grime.data[i]);
      v = lerp(v, v * 0.62, g * 0.8);
      v *= 1 - clamp01(streak.data[i]) * 0.4;
      const mi = micro.data[i] * 0.03 - 0.015;
      out.r = clamp01(v * 0.99 + mi) * 255; out.g = clamp01(v * 0.98 + mi) * 255; out.b = clamp01(v * 0.94 + mi) * 255;
    });
    const rf = new Field(S, S);
    for (let i = 0; i < rf.data.length; i++) {
      const m = lat.mask.data[i];
      rf.data[i] = clamp01((m > 0.5 ? 0.24 : 0.9) + smoothstep(0.4, 0.8, grime.data[i]) * 0.45 + clamp01(crackle.data[i]) * 0.2);
    }
    return this.std({ map, normalMap: heightToNormal(height, 1.6), roughnessMap: fieldToGray(rf), roughness: 1, envMapIntensity: 0.9 });
  }

  _interiorFloor() {
    const rng = this.rng.stream('ifloor');
    const S = SIZE.high;
    const lat = brickLattice(S, S, 5, rng.stream('l'), { mortar: 0.02, aspect: 1.0, offset: 0 });
    const macro = fbmField(S, S, 4, 4, rng.stream('m'));
    const scuff = fbmField(S, S, 14, 3, rng.stream('s'));
    const dust = fbmField(S, S, 6, 4, rng.stream('d'));
    const micro = whiteField(S, S, rng.stream('mi'));
    const debris = speckleField(S, S, rng.stream('de'), 0.35, 2.6);
    const height = new Field(S, S);
    for (let i = 0; i < height.data.length; i++) {
      height.data[i] = lat.mask.data[i] * 0.4 + debris.data[i] * 0.3 + micro.data[i] * 0.05 + macro.data[i] * 0.1;
    }
    height.normalize(0, 1);
    const map = fieldsToTexture(S, S, (x, y, out) => {
      const i = y * S + x;
      const m = lat.mask.data[i];
      let v = m > 0.5 ? 0.36 + lat.id.data[i] * 0.14 + macro.data[i] * 0.14 : 0.2;
      v *= 1 - scuff.data[i] * 0.25;
      let r = v * 1.02, g = v * 0.98, b = v * 0.93;
      const du = smoothstep(0.35, 0.8, dust.data[i]);
      r = lerp(r, 0.55, du * 0.6); g = lerp(g, 0.53, du * 0.6); b = lerp(b, 0.5, du * 0.6);
      const de = clamp01(debris.data[i]);
      r = lerp(r, 0.6, de * 0.5); g = lerp(g, 0.58, de * 0.5); b = lerp(b, 0.55, de * 0.5);
      const mi = micro.data[i] * 0.05 - 0.025;
      out.r = clamp01(r + mi) * 255; out.g = clamp01(g + mi) * 255; out.b = clamp01(b + mi) * 255;
    });
    const rf = new Field(S, S);
    for (let i = 0; i < rf.data.length; i++) rf.data[i] = clamp01(0.62 + smoothstep(0.35, 0.8, dust.data[i]) * 0.35 + micro.data[i] * 0.05);
    return this.std({ map, normalMap: heightToNormal(height, 1.5), roughnessMap: fieldToGray(rf), roughness: 1, envMapIntensity: 0.4 });
  }

  _ceilingPanel() {
    const rng = this.rng.stream('ceil');
    const S = SIZE.mid;
    const lat = brickLattice(S, S, 4, rng.stream('l'), { mortar: 0.03, aspect: 2.0, offset: 0 });
    const pit = speckleField(S, S, rng.stream('p'), 0.8, 1.4);
    const stain = fbmField(S, S, 5, 4, rng.stream('s'));
    const height = new Field(S, S);
    for (let i = 0; i < height.data.length; i++) height.data[i] = lat.mask.data[i] * 0.5 + pit.data[i] * 0.25;
    height.normalize(0, 1);
    const map = fieldsToTexture(S, S, (x, y, out) => {
      const i = y * S + x;
      const m = lat.mask.data[i];
      let v = m > 0.5 ? 0.7 : 0.4;
      v -= pit.data[i] * 0.12;
      const st = smoothstep(0.45, 0.85, stain.data[i]);
      let r = v, g = v * 0.98, b = v * 0.94;
      r = lerp(r, 0.42, st * 0.7); g = lerp(g, 0.35, st * 0.7); b = lerp(b, 0.26, st * 0.7);
      out.r = clamp01(r) * 255; out.g = clamp01(g) * 255; out.b = clamp01(b) * 255;
    });
    return this.std({ map, normalMap: heightToNormal(height, 1.2), roughness: 0.95, envMapIntensity: 0.3 });
  }

  /* --------------------------- utilities -------------------------- */

  dispose() {
    for (const m of this._mats.values()) m.dispose();
    for (const m of this._variants.values()) m.dispose();
    for (const t of this._texs.values()) t.dispose();
    this._mats.clear(); this._variants.clear(); this._texs.clear();
  }
}
