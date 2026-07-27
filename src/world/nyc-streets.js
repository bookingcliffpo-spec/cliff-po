import * as THREE from 'three';
import { boxGeo, planeGeo, cylGeo, mat4 } from './batcher.js';
import { PLAN, frontage, isRoad, isOpen } from './nyc-layout.js';
import { clamp01, lerp, smoothstep, TAU } from '../core/math.js';

/**
 * The street surface.
 *
 * The roadway is one displaced mesh rather than a flat plane: it carries the
 * crown camber that every real street has, settlement around the manholes,
 * shell craters with raised lips, and the gutter fall to the curb. Flat asphalt
 * is the single fastest way to make a city look like a prototype.
 */

const CRATERS = [];
const PATCHES = [];

export function craterList() { return CRATERS; }

/** Deterministic road surface height at a world point. */
export function roadHeight(x, z) {
  let y = 0;

  // crown: streets fall ~12 cm from centreline to gutter
  for (const st of PLAN.streets) {
    const d = st.axis === 'z' ? Math.abs(x - st.center) : Math.abs(z - st.center);
    const along = st.axis === 'z' ? z : x;
    if (along < st.from - 2 || along > st.to + 2) continue;
    if (d > st.halfRoad + 1) continue;
    const t = clamp01(d / st.halfRoad);
    y += -0.115 * t * t + 0.115 * 0.0;
    // gutter trough right at the curb
    y -= smoothstep(0.82, 1.0, t) * 0.035;
  }

  // craters
  for (let i = 0; i < CRATERS.length; i++) {
    const c = CRATERS[i];
    const dx = x - c.x, dz = z - c.z;
    const r = Math.hypot(dx, dz);
    if (r > c.r * 1.9) continue;
    const t = r / c.r;
    if (t < 1) {
      y -= c.depth * (1 - t * t) * (1 - t * 0.25);
    } else {
      // ejecta lip
      const l = smoothstep(1.9, 1.0, t);
      y += c.depth * 0.34 * l * l;
    }
  }

  // low-frequency settlement so nothing is ever perfectly planar
  y += Math.sin(x * 0.11 + 1.7) * Math.cos(z * 0.093 - 0.4) * 0.035;
  y += Math.sin(x * 0.037 - z * 0.041) * 0.045;

  return y;
}

export class StreetBuilder {
  constructor(world) {
    this.world = world;
    this.b = world.batcher;
    this.phys = world.phys;
    this.materials = world.materials;
    this.rng = world.rng.stream('streets');
  }

  build() {
    this._seedCraters();
    this._roadSurface();
    this._sidewalks();
    this._markings();
    this._utilities();
    this._craterDressing();
  }

  _seedCraters() {
    const rng = this.rng.stream('craters');
    CRATERS.length = 0;
    // The intersection took the worst of it.
    CRATERS.push({ x: 2.5, z: -1.5, r: 4.6, depth: 0.62 });
    CRATERS.push({ x: -6.2, z: 6.8, r: 3.1, depth: 0.44 });
    const spots = [
      [0, -34], [0, 30], [-4, 52], [6, -58], [-38, 0], [44, 2],
      [-62, -62], [58, 62], [3, -70], [-70, 30], [72, -28], [26, 62],
    ];
    for (const [sx, sz] of spots) {
      const x = sx + rng.sym(4), z = sz + rng.sym(4);
      if (!isRoad(x, z)) continue;
      CRATERS.push({ x, z, r: rng.range(1.6, 3.6), depth: rng.range(0.22, 0.5) });
    }
    // asphalt repair patches
    PATCHES.length = 0;
    for (let i = 0; i < 26; i++) {
      const x = rng.range(-90, 90), z = rng.range(-78, 78);
      if (!isRoad(x, z)) continue;
      PATCHES.push({ x, z, w: rng.range(1.4, 4.5), d: rng.range(1.2, 3.6), yaw: rng.sym(0.4) });
    }
  }

  _roadSurface() {
    const { minX, maxX, minZ, maxZ } = PLAN.bounds;
    const step = 1.05;
    const nx = Math.ceil((maxX - minX) / step);
    const nz = Math.ceil((maxZ - minZ) / step);
    const geo = new THREE.PlaneGeometry(maxX - minX, maxZ - minZ, nx, nz);
    geo.rotateX(-Math.PI / 2);
    geo.translate((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      pos.setY(i, roadHeight(x, z));
      // world-scale UVs: one asphalt tile every 5 m
      uv.setXY(i, x / 5, z / 5);
    }
    pos.needsUpdate = true;
    uv.needsUpdate = true;
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, this.materials.variant('asphalt', { repeat: [1, 1] }));
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.name = 'roadSurface';
    mesh.matrixAutoUpdate = false;
    this.world.root.add(mesh);
    this.world.roadMesh = mesh;

    // The roadway is analytic, not a collider: the physics system samples the
    // very same height function, so the player walks the crown and the crater
    // bowls exactly as they are drawn.
    this.phys.terrainFn = roadHeight;
    // Last-resort floor well below everything, in case a query escapes the map.
    this.phys.addBox((minX + maxX) / 2, -6, (minZ + maxZ) / 2,
      (maxX - minX) / 2 + 60, 3, (maxZ - minZ) / 2 + 60, 0, 'asphalt', 1 | 2);

    // Wet asphalt patches where water has pooled in the low spots.
    const rng = this.rng.stream('wet');
    for (let i = 0; i < 34; i++) {
      const x = rng.range(minX + 6, maxX - 6), z = rng.range(minZ + 6, maxZ - 6);
      if (!isRoad(x, z)) continue;
      const y = roadHeight(x, z);
      if (y > -0.02) continue;                     // only genuinely low ground
      const w = rng.range(1.6, 5.5), d = rng.range(1.2, 4.0);
      const m = mat4(x, y + 0.012, z, rng.next() * TAU);
      m.multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
      this.b.instance(`pud.${w.toFixed(1)}x${d.toFixed(1)}`, planeGeo(w, d, 2.5),
        this.materials.variant('asphaltWet', { color: 0x6a6d70 }), m);
    }

    // Repair patches
    for (const p of PATCHES) {
      const m = mat4(p.x, roadHeight(p.x, p.z) + 0.017, p.z, p.yaw);
      m.multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
      this.b.instance(`patch.${p.w.toFixed(1)}x${p.d.toFixed(1)}`, planeGeo(p.w, p.d, 4),
        this.materials.variant('asphalt', { color: 0x6e6e70 }), m);
    }
  }

  _sidewalks() {
    const rng = this.rng.stream('walk');
    const H = 0.155;
    for (const st of PLAN.streets) {
      const f = frontage(st);
      for (const side of [-1, 1]) {
        const inner = st.halfRoad, outer = f;
        const midOff = (inner + outer) / 2 * side;
        const wdt = outer - inner;
        const len = st.to - st.from;
        const cAlong = (st.from + st.to) / 2;

        if (st.axis === 'z') {
          const cx = st.center + midOff;
          this.b.box(wdt, H, len, cx, H / 2, cAlong, 'sidewalk', 0, 'walk', 2.4);
          this.phys.addBox(cx, H / 2, cAlong, wdt / 2, H / 2, len / 2, 0, 'concrete', 1 | 2);
          // curb face
          const kx = st.center + side * (st.halfRoad + 0.16);
          this.b.box(0.32, H + 0.06, len, kx, (H + 0.06) / 2 - 0.03, cAlong, 'curb', 0, 'walk', 1.2);
        } else {
          const cz = st.center + midOff;
          this.b.box(len, H, wdt, cAlong, H / 2, cz, 'sidewalk', 0, 'walk', 2.4);
          this.phys.addBox(cAlong, H / 2, cz, len / 2, H / 2, wdt / 2, 0, 'concrete', 1 | 2);
          const kz = st.center + side * (st.halfRoad + 0.16);
          this.b.box(len, H + 0.06, 0.32, cAlong, (H + 0.06) / 2 - 0.03, kz, 'curb', 0, 'walk', 1.2);
        }
      }
    }

    // Block interiors and alleys get a rougher concrete apron.
    for (const blk of this.world.blocks) {
      this.b.box(blk.x1 - blk.x0, H, blk.z1 - blk.z0,
        (blk.x0 + blk.x1) / 2, H / 2, (blk.z0 + blk.z1) / 2, 'concrete', 0, 'walk', 3);
      this.phys.addBox((blk.x0 + blk.x1) / 2, H / 2, (blk.z0 + blk.z1) / 2,
        (blk.x1 - blk.x0) / 2, H / 2, (blk.z1 - blk.z0) / 2, 0, 'concrete', 1 | 2);
    }
    for (const al of PLAN.alleys) {
      const len = al.to - al.from, c = (al.from + al.to) / 2;
      if (al.axis === 'z') {
        this.b.box(al.halfRoad * 2, 0.02, len, al.center, H + 0.01, c, 'asphalt', 0, 'walk', 3);
      } else {
        this.b.box(len, 0.02, al.halfRoad * 2, c, H + 0.01, al.center, 'asphalt', 0, 'walk', 3);
      }
    }
  }

  _markings() {
    const b = this.b;
    const rng = this.rng.stream('paint');
    const Y = (x, z) => roadHeight(x, z) + 0.016;
    const flat = (x, z, yaw = 0) => {
      const m = mat4(x, Y(x, z), z, yaw);
      m.multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
      return m;
    };

    for (const st of PLAN.streets) {
      const isAve = st.kind === 'avenue';
      const along = st.axis === 'z';
      const c = st.center;

      // double yellow centreline on the avenue, single on streets
      const lines = isAve ? [-0.16, 0.16] : [0];
      for (const off of lines) {
        const seg = 6;
        for (let t = st.from + 4; t < st.to - 4; t += seg) {
          const len = Math.min(seg - 0.4, st.to - 4 - t);
          if (len < 1) break;
          const [x, z] = along ? [c + off, t + len / 2] : [t + len / 2, c + off];
          // skip the intersection boxes
          if (this._inIntersection(x, z)) continue;
          b.instance(`mk.center.${len.toFixed(1)}`, planeGeo(along ? 0.13 : len, along ? len : 0.13, 1),
            'roadPaintYellow', flat(x, z));
        }
      }

      // white lane dashes
      const laneCount = isAve ? 2 : 1;
      for (let l = 1; l <= laneCount; l++) {
        for (const side of [-1, 1]) {
          const off = side * (st.halfRoad * (l / (laneCount + 1)));
          if (Math.abs(off) < 0.4) continue;
          for (let t = st.from + 3; t < st.to - 3; t += 6.2) {
            const len = 2.9;
            const [x, z] = along ? [c + off, t + len / 2] : [t + len / 2, c + off];
            if (this._inIntersection(x, z)) continue;
            b.instance('mk.dash', planeGeo(along ? 0.12 : len, along ? len : 0.12, 1),
              'roadPaintWhite', flat(x, z));
          }
        }
      }

      // solid edge line at the gutter
      for (const side of [-1, 1]) {
        const off = side * (st.halfRoad - 0.55);
        const seg = 10;
        for (let t = st.from + 2; t < st.to - 2; t += seg) {
          const len = Math.min(seg - 0.2, st.to - 2 - t);
          if (len < 1) break;
          const [x, z] = along ? [c + off, t + len / 2] : [t + len / 2, c + off];
          if (this._inIntersection(x, z)) continue;
          if (rng.bool(0.18)) continue;      // worn away in places
          b.instance(`mk.edge.${len.toFixed(1)}`, planeGeo(along ? 0.1 : len, along ? len : 0.1, 1),
            'roadPaintWhite', flat(x, z));
        }
      }
    }

    // Crosswalks at every street/avenue meeting
    for (const a of PLAN.streets) {
      for (const c of PLAN.streets) {
        if (a.axis === c.axis) continue;
        const ix = a.axis === 'z' ? a.center : c.center;
        const iz = a.axis === 'z' ? c.center : a.center;
        if (ix < PLAN.bounds.minX || ix > PLAN.bounds.maxX) continue;
        if (iz < PLAN.bounds.minZ || iz > PLAN.bounds.maxZ) continue;
        this._crosswalk(ix, iz, a, c, flat);
      }
    }

    // Stop bars and turn arrows on the avenue approaches
    for (const side of [-1, 1]) {
      const z = side * 10.5;
      b.instance('mk.stopbar', planeGeo(11.2, 0.45, 1), 'roadPaintWhite', flat(side * 5.9, z));
      this._arrow(b, side * 5.9, z + side * 5.5, side < 0 ? 0 : Math.PI, flat);
      this._arrow(b, side * 9.2, z + side * 5.5, side < 0 ? 0 : Math.PI, flat, true);
    }
  }

  _inIntersection(x, z) {
    for (const a of PLAN.streets) {
      for (const c of PLAN.streets) {
        if (a.axis === c.axis) continue;
        const ix = a.axis === 'z' ? a.center : c.center;
        const iz = a.axis === 'z' ? c.center : a.center;
        const hx = a.axis === 'z' ? a.halfRoad : c.halfRoad;
        const hz = a.axis === 'z' ? c.halfRoad : a.halfRoad;
        if (Math.abs(x - ix) < hx + 3.4 && Math.abs(z - iz) < hz + 3.4) return true;
      }
    }
    return false;
  }

  _crosswalk(ix, iz, a, c, flat) {
    const b = this.b;
    const rng = this.rng.stream(`cw${ix}${iz}`);
    // Continental (ladder) bars, the NYC standard.
    const barW = 0.52, gap = 0.85;
    // across the avenue (a is axis z)
    const ave = a.axis === 'z' ? a : c;
    const str = a.axis === 'z' ? c : a;
    for (const side of [-1, 1]) {
      const z = iz + side * (str.halfRoad + 1.5);
      const n = Math.floor((ave.halfRoad * 2 - 1.2) / gap);
      for (let i = 0; i < n; i++) {
        const x = ix - ave.halfRoad + 0.9 + i * gap;
        if (rng.bool(0.12)) continue;
        b.instance('cw.bar', planeGeo(barW, 2.6, 1), 'roadPaintWhite', flat(x, z));
      }
    }
    for (const side of [-1, 1]) {
      const x = ix + side * (ave.halfRoad + 1.5);
      const n = Math.floor((str.halfRoad * 2 - 1.2) / gap);
      for (let i = 0; i < n; i++) {
        const z = iz - str.halfRoad + 0.9 + i * gap;
        if (rng.bool(0.12)) continue;
        b.instance('cw.barz', planeGeo(2.6, barW, 1), 'roadPaintWhite', flat(x, z));
      }
    }
  }

  _arrow(b, x, z, yaw, flat, turn = false) {
    // shaft
    b.instance('mk.arrowShaft', planeGeo(0.42, 2.4, 1), 'roadPaintWhite', flat(x, z, yaw));
    // head, built from two angled bars
    for (const s of [-1, 1]) {
      const m = flat(x + Math.sin(yaw + s * 0.9) * 0.42, z + Math.cos(yaw + s * 0.9) * 1.55, yaw + s * 0.72);
      b.instance('mk.arrowHead', planeGeo(0.38, 1.2, 1), 'roadPaintWhite', m);
    }
    if (turn) {
      const m = flat(x + Math.sin(yaw + Math.PI / 2) * 0.9, z + Math.cos(yaw + Math.PI / 2) * 0.9, yaw + Math.PI / 2);
      b.instance('mk.arrowShaft', planeGeo(0.42, 1.6, 1), 'roadPaintWhite', m);
    }
  }

  _utilities() {
    const b = this.b;
    const rng = this.rng.stream('utils');
    const flat = (x, z, yaw, lift = 0.012) => {
      const m = mat4(x, roadHeight(x, z) + lift, z, yaw);
      m.multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
      return m;
    };

    // Manhole covers, set into the asphalt with a settlement ring.
    const manholes = [];
    for (const st of PLAN.streets) {
      const step = st.kind === 'avenue' ? 22 : 30;
      for (let t = st.from + 12; t < st.to - 12; t += step) {
        const off = rng.range(-st.halfRoad * 0.55, st.halfRoad * 0.55);
        const [x, z] = st.axis === 'z' ? [st.center + off, t + rng.sym(5)] : [t + rng.sym(5), st.center + off];
        manholes.push([x, z]);
      }
    }
    for (const [x, z] of manholes) {
      b.instance('mh.cover', planeGeo(0.78, 0.78, 1), 'manhole', flat(x, z, rng.next() * TAU, 0.02));
      // sunken collar of patched asphalt
      b.instance('mh.ring', planeGeo(1.5, 1.5, 3), this.materials.variant('asphalt', { color: 0x6b6b6d }),
        flat(x, z, rng.next() * TAU, 0.014));
    }

    // Storm grates and steam vents against the curb.
    for (const st of PLAN.streets) {
      for (const side of [-1, 1]) {
        const step = 26;
        for (let t = st.from + 16; t < st.to - 16; t += step) {
          const off = side * (st.halfRoad - 0.5);
          const [x, z] = st.axis === 'z' ? [st.center + off, t + rng.sym(6)] : [t + rng.sym(6), st.center + off];
          const yaw = st.axis === 'z' ? 0 : Math.PI / 2;
          b.instance('sg.grate', planeGeo(0.55, 1.3, 1), 'grate', flat(x, z, yaw, 0.02));
          b.instance('sg.frame', boxGeo(0.72, 0.1, 1.5), 'metalRust',
            mat4(x, roadHeight(x, z) - 0.02, z, yaw));
        }
      }
    }

    // Sidewalk vault grates — the big rectangular ones that vent the subway.
    for (let i = 0; i < 18; i++) {
      const st = rng.pick(PLAN.streets);
      const f = frontage(st);
      const side = rng.bool() ? 1 : -1;
      const off = side * (st.halfRoad + st.walk * rng.range(0.3, 0.75));
      const t = rng.range(st.from + 10, st.to - 10);
      const [x, z] = st.axis === 'z' ? [st.center + off, t] : [t, st.center + off];
      if (Math.abs(x) < 20 && Math.abs(z) < 16) continue;
      const yaw = st.axis === 'z' ? 0 : Math.PI / 2;
      const m = mat4(x, 0.162, z, yaw);
      m.multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
      b.instance('vg.grate', planeGeo(1.6, 2.6, 1), 'grate', m);
      b.instance('vg.frame', boxGeo(1.85, 0.14, 2.85), 'metalRust', mat4(x, 0.09, z, yaw));
      this.world.steamVents.push({ x, y: 0.18, z, scale: 1.4, rate: rng.range(0.35, 0.9) });
    }
  }

  _craterDressing() {
    const b = this.b;
    const rng = this.rng.stream('craterDress');
    for (const c of CRATERS) {
      // Lifted, fractured asphalt slabs around the rim.
      const n = Math.floor(c.r * 5);
      for (let i = 0; i < n; i++) {
        const a = rng.next() * TAU;
        const rr = c.r * rng.range(0.75, 1.35);
        const x = c.x + Math.cos(a) * rr, z = c.z + Math.sin(a) * rr;
        const s = rng.range(0.35, 1.1) * (0.6 + c.r * 0.16);
        const m = mat4(x, roadHeight(x, z) + s * 0.08, z, rng.next() * TAU, rng.sym(0.55), rng.sym(0.55),
          s, s * rng.range(0.1, 0.24), s * rng.range(0.7, 1.3));
        b.instance('cr.slab', boxGeo(1, 1, 1), 'asphalt', m);
      }
      // Exposed subgrade and rubble in the bowl.
      for (let i = 0; i < Math.floor(c.r * 6); i++) {
        const a = rng.next() * TAU;
        const rr = c.r * rng.range(0, 0.85);
        const x = c.x + Math.cos(a) * rr, z = c.z + Math.sin(a) * rr;
        const s = rng.range(0.12, 0.5);
        b.instance('cr.rock', boxGeo(1, 1, 1), 'rubble',
          mat4(x, roadHeight(x, z) + s * 0.4, z, rng.next() * TAU, rng.sym(1), rng.sym(1), s, s * 0.7, s * 1.2));
      }
      // Scorch ring
      const m = mat4(c.x, roadHeight(c.x, c.z) + 0.03, c.z, rng.next() * TAU);
      m.multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
      b.instance(`cr.scorch.${c.r.toFixed(1)}`, planeGeo(c.r * 3.6, c.r * 3.6, 1), 'soot', m);
      if (c.r > 2.6) {
        this.world.smokeSources.push({ x: c.x, y: 0.2, z: c.z, rate: 0.5, scale: 1.5, kind: 'ground' });
      }
    }
  }
}
