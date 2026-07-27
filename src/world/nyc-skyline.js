import * as THREE from 'three';
import { boxGeo, planeGeo, cylGeo, coneGeo, mat4 } from './batcher.js';
import { PLAN } from './nyc-layout.js';
import { TAU, clamp01, lerp, smoothstep } from '../core/math.js';

/**
 * Everything beyond the playable district.
 *
 * Three rings: a near ring of full-height blocks that close the street canyons,
 * a mid ring that fills the gaps between them, and a far skyline of original
 * Manhattan-flavoured silhouettes that dissolve into the haze. None of it is
 * collidable — the boundary rubble handles that — and none of it is lit
 * per-window; the window grids are emissive-tinted instanced planes.
 */
export class SkylineBuilder {
  constructor(world) {
    this.world = world;
    this.b = world.batcher;
    this.materials = world.materials;
    this.rng = world.rng.stream('skyline');
  }

  build() {
    this._nearRing();
    this._midField();
    this._farSkyline();
    this._landmarks();
    this._bridge();
  }

  /** Buildings immediately outside the boundary streets — these close the canyon. */
  _nearRing() {
    const rng = this.rng.stream('near');
    const { minX, maxX, minZ, maxZ } = PLAN.bounds;
    const wallMats = ['brickRed', 'brickBrown', 'brickTan', 'brickDark', 'concrete', 'limestone'];

    const runs = [
      { axis: 'x', fixed: minZ - 12, from: minX - 30, to: maxX + 30, face: 1 },
      { axis: 'x', fixed: maxZ + 12, from: minX - 30, to: maxX + 30, face: -1 },
      { axis: 'z', fixed: minX - 12, from: minZ - 30, to: maxZ + 30, face: 1 },
      { axis: 'z', fixed: maxX + 12, from: minZ - 30, to: maxZ + 30, face: -1 },
    ];

    for (const r of runs) {
      let t = r.from;
      while (t < r.to) {
        const w = rng.range(14, 26);
        const d = rng.range(18, 30);
        const h = rng.range(24, 62);
        const [cx, cz] = r.axis === 'x'
          ? [t + w / 2, r.fixed - r.face * d / 2]
          : [r.fixed - r.face * d / 2, t + w / 2];
        const mat = rng.pick(wallMats);
        this.b.box(r.axis === 'x' ? w : d, h, r.axis === 'x' ? d : w, cx, h / 2, cz, mat, 0, 'skyNear', 3.2);
        this._windowGrid(cx, cz, r.axis === 'x' ? w : d, r.axis === 'x' ? d : w, h, rng, 0.55);
        // roof kit silhouette
        this.b.box((r.axis === 'x' ? w : d) + 0.5, 0.9, (r.axis === 'x' ? d : w) + 0.5, cx, h + 0.45, cz,
          rng.pick(['concreteDark', mat]), 0, 'skyNear', 3);
        if (rng.bool(0.4)) this._roofSilhouette(cx, cz, h + 0.9, Math.min(w, d), rng);
        t += w + rng.range(0.5, 3);
      }
    }
  }

  _midField() {
    const rng = this.rng.stream('mid');
    const wallMats = ['brickRed', 'brickBrown', 'brickTan', 'brickDark', 'concrete', 'limestone'];
    for (let i = 0; i < 130; i++) {
      const a = rng.next() * TAU;
      const r = rng.range(150, 420);
      const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
      const w = rng.range(22, 48), d = rng.range(22, 48);
      const h = rng.range(30, 130) * lerp(1, 1.9, smoothstep(150, 420, r));
      const mat = rng.pick(wallMats);
      this.b.box(w, h, d, cx, h / 2, cz, mat, rng.sym(0.25), 'skyMid', 5);
      if (r < 260) this._windowGrid(cx, cz, w, d, h, rng, 0.3);
      this.b.box(w + 1, 1.2, d + 1, cx, h + 0.6, cz, 'concreteDark', 0, 'skyMid', 4);
      if (rng.bool(0.28)) this._roofSilhouette(cx, cz, h + 1.2, Math.min(w, d), rng);
    }
  }

  _farSkyline() {
    const rng = this.rng.stream('far');
    // Flat, hazy masses. At this distance only silhouette and value matter.
    for (let ring = 0; ring < 3; ring++) {
      const R = 620 + ring * 340;
      const n = 60 + ring * 20;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + rng.sym(0.05);
        const r = R * rng.range(0.85, 1.2);
        const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
        const w = rng.range(40, 110), d = rng.range(40, 110);
        const h = rng.range(60, 260) * (1 + ring * 0.25);
        const shade = lerp(0.42, 0.24, ring / 2);
        const mat = this.materials.variant('concrete', {
          color: new THREE.Color(shade * 0.92, shade * 0.95, shade).getHex(),
        });
        this.b.box(w, h, d, cx, h / 2, cz, mat, rng.sym(0.4), `skyFar${ring}`, 12);
        // stepped setbacks give the far towers an Art Deco profile
        if (rng.bool(0.45)) {
          const sh = h * rng.range(0.15, 0.4);
          this.b.box(w * 0.62, sh, d * 0.62, cx, h + sh / 2, cz, mat, 0, `skyFar${ring}`, 12);
          if (rng.bool(0.5)) this.b.box(w * 0.3, sh * 0.7, d * 0.3, cx, h + sh + sh * 0.35, cz, mat, 0, `skyFar${ring}`, 12);
        }
      }
    }
  }

  /** Original towers that give the horizon a recognisable Manhattan rhythm. */
  _landmarks() {
    const rng = this.rng.stream('landmarks');

    // The tall central glass tower, framed by the avenue looking north.
    this._glassTower(-40, -520, 74, 74, 330, rng);
    // A stepped Art Deco spire to the north-east.
    this._decoTower(320, -430, 58, 58, 260, rng);
    // A second, squatter deco mass to the west.
    this._decoTower(-430, 210, 66, 66, 190, rng);
    // Twin slabs south-east.
    this._glassTower(360, 300, 52, 40, 210, rng);
    this._glassTower(430, 340, 46, 38, 178, rng);
  }

  _glassTower(x, z, w, d, h, rng) {
    const mat = this.materials.variant('glassBlue', {
      color: 0x2f3b45, opacity: 1, roughness: 0.28, metalness: 0.85,
    });
    const frame = this.materials.variant('concrete', { color: 0x3c4249 });
    const tiers = 3;
    let cy = 0, cw = w, cd = d;
    for (let i = 0; i < tiers; i++) {
      const th = h / tiers * rng.range(0.85, 1.15);
      this.b.box(cw, th, cd, x, cy + th / 2, z, mat, 0, 'landmark', 8);
      // spandrel banding — the horizontal rhythm reads from miles away
      const bands = Math.floor(th / 4.2);
      for (let k = 0; k < bands; k++) {
        this.b.box(cw + 0.5, 0.55, cd + 0.5, x, cy + (k + 0.5) * (th / bands), z, frame, 0, 'landmark', 8);
      }
      cy += th;
      cw *= 0.82; cd *= 0.82;
    }
    // crown mast
    this.b.box(6, 34, 6, x, cy + 17, z, frame, 0, 'landmark', 4);
    this.b.box(1.6, 26, 1.6, x, cy + 34 + 13, z, frame, 0, 'landmark', 3);
  }

  _decoTower(x, z, w, d, h, rng) {
    const mat = this.materials.variant('limestone', { color: 0x9a9080 });
    const trim = this.materials.variant('copperOx', {});
    let cy = 0, cw = w, cd = d;
    const steps = 6;
    for (let i = 0; i < steps; i++) {
      const th = (h / steps) * (1.25 - i * 0.11);
      this.b.box(cw, th, cd, x, cy + th / 2, z, mat, 0, 'landmark', 8);
      // setback cap
      this.b.box(cw + 1.6, 1.4, cd + 1.6, x, cy + th + 0.7, z, trim, 0, 'landmark', 6);
      // vertical piers on the face for that Deco stripe
      const piers = Math.max(4, Math.floor(cw / 5));
      for (let k = 0; k < piers; k++) {
        const px = x - cw / 2 + (k + 0.5) * (cw / piers);
        this.b.box(1.1, th, cd + 0.7, px, cy + th / 2, z, mat, 0, 'landmark', 8);
      }
      cy += th + 1.4;
      cw *= 0.8; cd *= 0.8;
    }
    // crown and spire
    this.b.box(cw * 1.2, 6, cd * 1.2, x, cy + 3, z, trim, 0, 'landmark', 4);
    for (let i = 0; i < 4; i++) {
      const s = 1 - i * 0.22;
      this.b.box(cw * s, 7, cd * s, x, cy + 6 + i * 7 + 3.5, z, trim, 0, 'landmark', 4);
    }
    this.b.box(2.2, 44, 2.2, x, cy + 34 + 22, z, trim, 0, 'landmark', 4);
  }

  /** Instanced window bands. One draw call for thousands of windows. */
  _windowGrid(cx, cz, w, d, h, rng, litChance) {
    const floorH = 3.6;
    const floors = Math.floor((h - 4) / floorH);
    const cols = Math.max(2, Math.floor(w / 3.0));
    const colsD = Math.max(2, Math.floor(d / 3.0));
    const wDark = this.materials.get('glassDark');
    const wLit = this.materials.variant('glassDark', {
      color: 0x241d13, emissive: 0xffb066, emissiveIntensity: 1.1,
    });
    const wBroken = this.materials.variant('glassDark', { color: 0x090b0d });
    const geoA = planeGeo(w / cols * 0.6, floorH * 0.55, 1);
    const geoB = planeGeo(d / colsD * 0.6, floorH * 0.55, 1);

    for (let f = 1; f < floors; f++) {
      const y = 3 + f * floorH;
      for (const [axis, sgn] of [['z', -1], ['z', 1], ['x', -1], ['x', 1]]) {
        const n = axis === 'z' ? cols : colsD;
        const span = axis === 'z' ? w : d;
        const geo = axis === 'z' ? geoA : geoB;
        for (let i = 0; i < n; i++) {
          const o = -span / 2 + (i + 0.5) * (span / n);
          const r = rng.next();
          const mat = r < litChance * 0.16 ? wLit : (r < litChance * 0.16 + 0.16 ? wBroken : wDark);
          const [x, z, yaw] = axis === 'z'
            ? [cx + o, cz + sgn * (d / 2 + 0.06), sgn < 0 ? Math.PI : 0]
            : [cx + sgn * (w / 2 + 0.06), cz + o, sgn < 0 ? -Math.PI / 2 : Math.PI / 2];
          this.b.instance(`sky.win.${axis}.${mat.name}`, geo, mat, mat4(x, y, z, yaw));
        }
      }
    }
  }

  _roofSilhouette(cx, cz, y, span, rng) {
    const b = this.b;
    const kind = rng.next();
    if (kind < 0.45) {
      // water tank silhouette
      const r = rng.range(1.6, 2.4), legH = rng.range(2.8, 4.5), bh = rng.range(3, 4.2);
      const x = cx + rng.sym(span * 0.25), z = cz + rng.sym(span * 0.25);
      for (let i = 0; i < 4; i++) {
        const a = i * TAU / 4 + 0.78;
        b.instance('sk.wtleg', boxGeo(0.16, legH, 0.16), 'fireEscape',
          mat4(x + Math.cos(a) * r * 0.8, y + legH / 2, z + Math.sin(a) * r * 0.8));
      }
      b.instance('sk.wtbody', cylGeo(r, r, bh, 12), 'waterTankWood', mat4(x, y + legH + bh / 2, z));
      b.instance('sk.wtroof', coneGeo(r * 1.15, r * 0.7, 12), 'waterTankWood',
        mat4(x, y + legH + bh + r * 0.34, z));
    } else if (kind < 0.7) {
      // mechanical penthouse
      const w = span * rng.range(0.3, 0.55), h = rng.range(3, 7);
      b.box(w, h, w, cx + rng.sym(span * 0.2), y + h / 2, cz + rng.sym(span * 0.2), 'concreteDark', 0, 'skyRoof', 4);
    } else {
      // antenna farm
      const x = cx + rng.sym(span * 0.3), z = cz + rng.sym(span * 0.3);
      const h = rng.range(6, 18);
      b.instance('sk.mast', cylGeo(0.16, 0.22, h, 5), 'galvanized', mat4(x, y + h / 2, z));
      for (let i = 0; i < 4; i++) {
        b.instance('sk.guy', cylGeo(0.03, 0.03, h * 0.9, 3), 'galvanized',
          mat4(x + Math.cos(i * TAU / 4) * h * 0.2, y + h * 0.45, z + Math.sin(i * TAU / 4) * h * 0.2,
            i * TAU / 4, 0.4, 0));
      }
    }
  }

  /** A suspension span glimpsed between the blocks to the south-east. */
  _bridge() {
    const rng = this.rng.stream('bridge');
    const mat = this.materials.variant('concrete', { color: 0x4a5158 });
    const cable = this.materials.variant('metalDarkPainted', { color: 0x3a4046 });
    const bx = 520, bz = 250, yaw = -0.5;
    const deckY = 46;
    const span = 420;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    // deck
    this.b.box(span, 3.2, 22, bx, deckY, bz, mat, yaw, 'bridge', 12);
    // towers
    for (const t of [-1, 1]) {
      const tx = bx + c * t * span * 0.28, tz = bz + s * t * span * 0.28;
      for (const o of [-8, 8]) {
        const px = tx - s * o, pz = tz + c * o;
        this.b.box(9, 118, 9, px, 59, pz, mat, yaw, 'bridge', 10);
      }
      this.b.box(26, 5, 6, tx, 108, tz, mat, yaw, 'bridge', 8);
      this.b.box(26, 5, 6, tx, 78, tz, mat, yaw, 'bridge', 8);
    }
    // main cables approximated by a chain of segments
    for (const o of [-8, 8]) {
      const segs = 26;
      for (let i = 0; i < segs; i++) {
        const t0 = (i / segs) * 2 - 1;
        const t1 = ((i + 1) / segs) * 2 - 1;
        const y0 = deckY + 62 * (t0 * t0);
        const y1 = deckY + 62 * (t1 * t1);
        const a0 = t0 * span * 0.42, a1 = t1 * span * 0.42;
        const mx = bx + c * (a0 + a1) / 2 - s * o;
        const mz = bz + s * (a0 + a1) / 2 + c * o;
        const len = Math.hypot(a1 - a0, y1 - y0);
        const pitch = Math.atan2(y1 - y0, a1 - a0);
        this.b.instance('br.cable', boxGeo(len, 1.1, 1.1), cable, mat4(mx, (y0 + y1) / 2, mz, yaw, 0, pitch));
        // hangers
        const hy = (y0 + y1) / 2;
        if (hy - deckY > 3) {
          this.b.instance('br.hanger', boxGeo(0.5, hy - deckY, 0.5), cable, mat4(mx, deckY + (hy - deckY) / 2, mz, yaw));
        }
      }
    }
  }
}
