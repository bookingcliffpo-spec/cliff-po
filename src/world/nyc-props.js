import * as THREE from 'three';
import { boxGeo, planeGeo, cylGeo, sphereGeo, torusGeo, coneGeo, mat4 } from './batcher.js';
import { PLAN, frontage, isRoad } from './nyc-layout.js';
import { roadHeight } from './nyc-streets.js';
import { makeStreetSign, makeTrafficSign, makeBillboard } from './nyc-signage.js';
import { TAU, clamp01, lerp } from '../core/math.js';

const WALK_Y = 0.155;

/**
 * Street furniture. The difference between a street and a corridor with a road
 * texture is roughly 400 of these objects.
 */
export class PropBuilder {
  constructor(world) {
    this.world = world;
    this.b = world.batcher;
    this.phys = world.phys;
    this.materials = world.materials;
    this.rng = world.rng.stream('props');
    this.coverPoints = world.coverPoints;
  }

  build() {
    this._lampPosts();
    this._trafficSignals();
    this._signPoles();
    this._hydrants();
    this._trash();
    this._dumpsters();
    this._bollardsAndBarriers();
    this._newsboxes();
    this._utilityBoxes();
    this._subwayEntrance();
    this._streetTrees();
    this._bicycles();
    this._debrisFields();
    this._billboards();
    this._alleyDressing();
    this._boundaryBlockades();
  }

  /* ------------------------------ lighting ------------------------------ */

  _lampPosts() {
    const b = this.b, rng = this.rng.stream('lamps');
    for (const st of PLAN.streets) {
      const step = st.kind === 'avenue' ? 26 : 30;
      for (const side of [-1, 1]) {
        for (let t = st.from + 14; t < st.to - 14; t += step) {
          const off = side * (st.halfRoad + 0.95);
          const [x, z] = st.axis === 'z' ? [st.center + off, t + rng.sym(3)] : [t + rng.sym(3), st.center + off];
          if (Math.abs(x) > PLAN.bounds.maxX - 4 || Math.abs(z) > PLAN.bounds.maxZ - 4) continue;
          // arm reaches out over the roadway
          const armYaw = st.axis === 'z' ? (side < 0 ? Math.PI / 2 : -Math.PI / 2) : (side < 0 ? Math.PI : 0);
          this._lamp(b, x, z, armYaw, rng);
        }
      }
    }
  }

  _lamp(b, x, z, yaw, rng) {
    const H = 8.4;
    const lean = rng.bool(0.14) ? rng.sym(0.09) : 0;
    // base + shaft: the classic tapered octagonal davit pole
    b.instance('lp.base', cylGeo(0.19, 0.24, 0.55, 8), 'metalDarkPainted', mat4(x, WALK_Y + 0.27, z, yaw));
    const m = mat4(x, WALK_Y + H / 2, z, yaw, lean, 0);
    b.instance('lp.shaft', cylGeo(0.075, 0.135, H, 8), 'metalDarkPainted', m);
    // access door plate
    b.instance('lp.hatch', boxGeo(0.14, 0.4, 0.03), 'metalPainted', mat4(x, WALK_Y + 0.95, z, yaw));

    // curved arm
    const armLen = 2.5;
    const segs = 6;
    for (let i = 0; i < segs; i++) {
      const t = i / (segs - 1);
      const ax = x + Math.sin(yaw) * armLen * t;
      const az = z + Math.cos(yaw) * armLen * t;
      const ay = WALK_Y + H + Math.sin(t * 1.3) * 0.62 - t * t * 0.28;
      const pitch = -0.75 + t * 1.35;
      b.instance('lp.arm', cylGeo(0.055, 0.062, armLen / segs * 1.5, 6),
        'metalDarkPainted', mat4(ax, ay, az, yaw, pitch, 0));
    }
    const hx = x + Math.sin(yaw) * armLen, hz = z + Math.cos(yaw) * armLen;
    const hy = WALK_Y + H + 0.42;
    // cobra head luminaire
    b.instance('lp.head', boxGeo(0.42, 0.16, 0.86), 'metalPainted', mat4(hx, hy, hz, yaw, 0.12, 0));
    b.instance('lp.lens', planeGeo(0.36, 0.72, 1),
      this.materials.variant('glassDark', { color: 0x30302c, emissive: 0x000000 }),
      (() => { const mm = mat4(hx, hy - 0.09, hz, yaw, 0.12, 0); mm.multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2)); return mm; })());

    this.phys.addBox(x, WALK_Y + H / 2, z, 0.16, H / 2, 0.16, 0, 'metal', 1 | 2);
    this.coverPoints.push({ x, z, height: 0.0, quality: 0.15, dirX: 0, dirZ: 0, kind: 'pole' });
  }

  /* --------------------------- traffic signals -------------------------- */

  _trafficSignals() {
    const b = this.b, rng = this.rng.stream('signals');
    const inter = [];
    for (const a of PLAN.streets) {
      for (const c of PLAN.streets) {
        if (a.axis === c.axis) continue;
        const ix = a.axis === 'z' ? a.center : c.center;
        const iz = a.axis === 'z' ? c.center : a.center;
        if (Math.abs(ix) > PLAN.bounds.maxX - 6 || Math.abs(iz) > PLAN.bounds.maxZ - 6) continue;
        const key = `${ix},${iz}`;
        if (inter.indexOf(key) >= 0) continue;
        inter.push(key);
        const hx = a.axis === 'z' ? a.halfRoad : c.halfRoad;
        const hz = a.axis === 'z' ? c.halfRoad : a.halfRoad;
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            const px = ix + sx * (hx + 1.1), pz = iz + sz * (hz + 1.1);
            this._signal(b, px, pz, Math.atan2(-sx, -sz), rng, hx);
          }
        }
      }
    }
  }

  _signal(b, x, z, yaw, rng, reach) {
    const H = 6.6;
    const broken = rng.bool(0.42);
    const lean = broken ? rng.sym(0.22) : 0;
    b.instance('ts.base', cylGeo(0.2, 0.26, 0.4, 8), 'metalDarkPainted', mat4(x, WALK_Y + 0.2, z, yaw));
    b.instance('ts.pole', cylGeo(0.085, 0.12, H, 8), 'metalDarkPainted', mat4(x, WALK_Y + H / 2, z, yaw, lean, 0));

    // mast arm over the roadway
    const armLen = Math.min(reach + 1.2, 6.2);
    b.instance(`ts.arm.${armLen.toFixed(1)}`, cylGeo(0.06, 0.075, armLen, 6), 'metalDarkPainted',
      mat4(x + Math.sin(yaw) * armLen / 2, WALK_Y + H - 0.2, z + Math.cos(yaw) * armLen / 2, yaw, Math.PI / 2, 0));
    // gusset
    const gm = mat4(x + Math.sin(yaw) * 0.6, WALK_Y + H - 0.85, z + Math.cos(yaw) * 0.6, yaw);
    gm.multiply(new THREE.Matrix4().makeRotationX(-0.8));
    b.instance('ts.gusset', cylGeo(0.04, 0.04, 1.5, 5), 'metalDarkPainted', gm);

    // signal head, hanging skewed if the blast got it
    const hx = x + Math.sin(yaw) * (armLen - 0.5);
    const hz = z + Math.cos(yaw) * (armLen - 0.5);
    const hang = broken ? rng.range(0.5, 1.3) : 0;
    const hm = mat4(hx, WALK_Y + H - 0.85 - hang, hz, yaw + (broken ? rng.sym(1.4) : 0), broken ? rng.sym(0.9) : 0, 0);
    b.instance('ts.head', boxGeo(0.34, 1.05, 0.3), 'metalDarkPainted', hm);
    b.instance('ts.visorTop', boxGeo(0.36, 0.06, 0.34), 'metalDarkPainted',
      mat4(hx, WALK_Y + H - 0.85 - hang + 0.55, hz, yaw));
    // lenses — dead, this grid has been down a while
    const lensCols = [0x2a1010, 0x2a2410, 0x0f2416];
    for (let i = 0; i < 3; i++) {
      const ly = WALK_Y + H - 0.85 - hang + 0.33 - i * 0.33;
      b.instance('ts.lens', cylGeo(0.11, 0.11, 0.06, 10),
        this.materials.variant('glassDark', { color: lensCols[i] }),
        mat4(hx + Math.sin(yaw) * 0.17, ly, hz + Math.cos(yaw) * 0.17, yaw, 0, Math.PI / 2));
      b.instance('ts.visor', cylGeo(0.14, 0.14, 0.13, 10, true), 'metalDarkPainted',
        mat4(hx + Math.sin(yaw) * 0.22, ly + 0.02, hz + Math.cos(yaw) * 0.22, yaw, 0, Math.PI / 2));
    }
    if (broken) {
      // dangling conductor
      b.instance('ts.wire', cylGeo(0.012, 0.012, hang + 0.6, 4), 'metalDarkPainted',
        mat4(hx, WALK_Y + H - 0.85 - hang / 2, hz, yaw));
    }

    // pedestrian signal on the pole
    b.instance('ts.ped', boxGeo(0.3, 0.4, 0.22), 'metalDarkPainted',
      mat4(x + Math.sin(yaw + Math.PI / 2) * 0.2, WALK_Y + 3.1, z + Math.cos(yaw + Math.PI / 2) * 0.2, yaw + Math.PI / 2));

    this.phys.addBox(x, WALK_Y + H / 2, z, 0.18, H / 2, 0.18, 0, 'metal', 1 | 2);
  }

  /* ------------------------------- signage ------------------------------ */

  _signPoles() {
    const b = this.b, rng = this.rng.stream('signpoles');
    // street name blades at intersections
    const made = new Set();
    for (const a of PLAN.streets) {
      for (const c of PLAN.streets) {
        if (a.axis === c.axis) continue;
        const ix = a.axis === 'z' ? a.center : c.center;
        const iz = a.axis === 'z' ? c.center : a.center;
        if (Math.abs(ix) > PLAN.bounds.maxX - 6 || Math.abs(iz) > PLAN.bounds.maxZ - 6) continue;
        const k = `${ix},${iz}`;
        if (made.has(k)) continue;
        made.add(k);
        const hx = a.axis === 'z' ? a.halfRoad : c.halfRoad;
        const hz = a.axis === 'z' ? c.halfRoad : a.halfRoad;
        const px = ix - (hx + 1.6), pz = iz - (hz + 1.6);
        const H = 3.5;
        b.instance('sp.pole', cylGeo(0.05, 0.055, H, 6), 'metalDarkPainted', mat4(px, WALK_Y + H / 2, pz));
        for (let i = 0; i < 2; i++) {
          const tex = makeStreetSign(rng);
          const m = this.materials.std({ map: tex, roughness: 0.8, side: THREE.DoubleSide });
          b.instance('sp.blade', planeGeo(1.35, 0.34), m,
            mat4(px + (i ? 0.5 : 0), WALK_Y + H - 0.2 - i * 0.42, pz + (i ? 0 : 0.5), i ? Math.PI / 2 : 0));
        }
        this.phys.addBox(px, WALK_Y + H / 2, pz, 0.08, H / 2, 0.08, 0, 'metal', 1 | 2);
      }
    }

    // regulatory signs scattered along the curb
    for (let i = 0; i < 30; i++) {
      const st = rng.pick(PLAN.streets);
      const side = rng.bool() ? 1 : -1;
      const off = side * (st.halfRoad + 0.85);
      const t = rng.range(st.from + 12, st.to - 12);
      const [x, z] = st.axis === 'z' ? [st.center + off, t] : [t, st.center + off];
      if (Math.abs(x) > PLAN.bounds.maxX - 5 || Math.abs(z) > PLAN.bounds.maxZ - 5) continue;
      const H = 2.9;
      const yaw = st.axis === 'z' ? (side < 0 ? Math.PI / 2 : -Math.PI / 2) : (side < 0 ? 0 : Math.PI);
      b.instance('sp.pole2', cylGeo(0.032, 0.036, H, 6), 'galvanized', mat4(x, WALK_Y + H / 2, z));
      const kind = rng.weighted(['parking', 'oneway', 'stop'], [0.62, 0.24, 0.14]);
      const tex = makeTrafficSign(rng, kind);
      const mm = this.materials.std({ map: tex, roughness: 0.72, side: THREE.DoubleSide, metalness: 0.1 });
      const sz = kind === 'stop' ? [0.7, 0.7] : kind === 'oneway' ? [0.66, 0.34] : [0.46, 0.62];
      const bend = rng.bool(0.25) ? rng.sym(0.35) : 0;
      b.instance(`sp.sign.${kind}`, planeGeo(sz[0], sz[1]), mm,
        mat4(x, WALK_Y + H - 0.45, z, yaw + bend));
      this.phys.addBox(x, WALK_Y + H / 2, z, 0.06, H / 2, 0.06, 0, 'metal', 1 | 2);
    }
  }

  /* ------------------------------ hydrants ------------------------------ */

  _hydrants() {
    const b = this.b, rng = this.rng.stream('hydrants');
    for (const st of PLAN.streets) {
      for (const side of [-1, 1]) {
        for (let t = st.from + 22; t < st.to - 22; t += rng.range(38, 62)) {
          const off = side * (st.halfRoad + 0.75);
          const [x, z] = st.axis === 'z' ? [st.center + off, t] : [t, st.center + off];
          if (Math.abs(x) > PLAN.bounds.maxX - 5 || Math.abs(z) > PLAN.bounds.maxZ - 5) continue;
          const yaw = rng.next() * TAU;
          const col = rng.pick([0xb03a24, 0xc8a326, 0x9a9d9f]);
          const mat = this.materials.variant('metalPainted', { color: col });
          b.instance('hy.base', cylGeo(0.2, 0.24, 0.14, 10), mat, mat4(x, WALK_Y + 0.07, z, yaw));
          b.instance('hy.body', cylGeo(0.13, 0.16, 0.62, 10), mat, mat4(x, WALK_Y + 0.42, z, yaw));
          b.instance('hy.dome', sphereGeo(0.14, 10, 6), mat, mat4(x, WALK_Y + 0.74, z, yaw));
          b.instance('hy.cap', cylGeo(0.045, 0.045, 0.1, 6), mat, mat4(x, WALK_Y + 0.86, z, yaw));
          // side outlets
          for (const s of [-1, 1]) {
            b.instance('hy.out', cylGeo(0.075, 0.075, 0.16, 8), mat,
              mat4(x + Math.sin(yaw + s * Math.PI / 2) * 0.16, WALK_Y + 0.48, z + Math.cos(yaw + s * Math.PI / 2) * 0.16,
                yaw + s * Math.PI / 2, 0, Math.PI / 2));
          }
          b.instance('hy.front', cylGeo(0.09, 0.09, 0.2, 8), mat,
            mat4(x + Math.sin(yaw) * 0.18, WALK_Y + 0.36, z + Math.cos(yaw) * 0.18, yaw, Math.PI / 2, 0));
          this.phys.addBox(x, WALK_Y + 0.4, z, 0.22, 0.4, 0.22, 0, 'metal', 1 | 2);
          this.coverPoints.push({ x, z, height: 0.8, quality: 0.2, kind: 'hydrant' });
        }
      }
    }
  }

  /* -------------------------------- trash ------------------------------- */

  _trash() {
    const b = this.b, rng = this.rng.stream('trash');
    // wire mesh corner baskets
    for (let i = 0; i < 26; i++) {
      const st = rng.pick(PLAN.streets);
      const side = rng.bool() ? 1 : -1;
      const off = side * (st.halfRoad + 0.8);
      const t = rng.range(st.from + 10, st.to - 10);
      const [x, z] = st.axis === 'z' ? [st.center + off, t] : [t, st.center + off];
      if (Math.abs(x) > PLAN.bounds.maxX - 5 || Math.abs(z) > PLAN.bounds.maxZ - 5) continue;
      const tipped = rng.bool(0.3);
      const yaw = rng.next() * TAU;
      const m = tipped
        ? mat4(x, WALK_Y + 0.32, z, yaw, Math.PI / 2 * rng.range(0.8, 1.0), 0)
        : mat4(x, WALK_Y + 0.44, z, yaw);
      b.instance('tb.body', cylGeo(0.32, 0.28, 0.88, 12, true), 'grate', m);
      b.instance('tb.rim', torusGeo(0.32, 0.022, 5, 14), 'metalDarkPainted',
        (() => { const mm = m.clone(); mm.multiply(new THREE.Matrix4().makeTranslation(0, 0.44, 0)); mm.multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)); return mm; })());
      b.instance('tb.fill', cylGeo(0.28, 0.26, 0.5, 10), 'trashBag',
        (() => { const mm = m.clone(); mm.multiply(new THREE.Matrix4().makeTranslation(0, -0.1, 0)); return mm; })());
      if (!tipped) this.phys.addBox(x, WALK_Y + 0.44, z, 0.34, 0.44, 0.34, 0, 'metal', 1 | 2);
      // spilled contents
      for (let k = 0; k < rng.int(2, 7); k++) {
        const a = rng.next() * TAU, r = rng.range(0.4, 1.8);
        const s = rng.range(0.06, 0.18);
        b.instance('tb.junk', boxGeo(1, 1, 1), 'debris',
          mat4(x + Math.cos(a) * r, WALK_Y + s * 0.5, z + Math.sin(a) * r, rng.next() * TAU, rng.sym(0.6), rng.sym(0.6),
            s * rng.range(1, 2.4), s, s * rng.range(1, 2)));
      }
    }

    // Piles of bagged refuse stacked against the buildings — very NYC.
    for (let i = 0; i < 34; i++) {
      const st = rng.pick(PLAN.streets);
      const side = rng.bool() ? 1 : -1;
      const f = frontage(st);
      const off = side * (f - rng.range(0.5, 1.4));
      const t = rng.range(st.from + 8, st.to - 8);
      const [x, z] = st.axis === 'z' ? [st.center + off, t] : [t, st.center + off];
      if (Math.abs(x) > PLAN.bounds.maxX - 5 || Math.abs(z) > PLAN.bounds.maxZ - 5) continue;
      const n = rng.int(3, 11);
      for (let k = 0; k < n; k++) {
        const a = rng.next() * TAU, r = rng.range(0, 1.2);
        const s = rng.range(0.3, 0.52);
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        b.instance('bag', sphereGeo(1, 8, 6), 'trashBag',
          mat4(px, WALK_Y + s * 0.72, pz, rng.next() * TAU, rng.sym(0.3), rng.sym(0.3),
            s * rng.range(0.9, 1.3), s * rng.range(0.7, 1.0), s * rng.range(0.9, 1.3)));
      }
      this.phys.addBox(x, WALK_Y + 0.4, z, 1.1, 0.4, 1.1, 0, 'concrete', 1);
      this.coverPoints.push({ x, z, height: 0.85, quality: 0.35, kind: 'trash' });
    }

    // Loose paper and windblown litter across the whole map.
    for (let i = 0; i < 260; i++) {
      const x = rng.range(PLAN.bounds.minX + 4, PLAN.bounds.maxX - 4);
      const z = rng.range(PLAN.bounds.minZ + 4, PLAN.bounds.maxZ - 4);
      const onRoad = isRoad(x, z);
      const y = onRoad ? roadHeight(x, z) + 0.012 : WALK_Y + 0.012;
      const s = rng.range(0.12, 0.32);
      const m = mat4(x, y, z, rng.next() * TAU, 0, rng.sym(0.15), 1, 1, 1);
      m.multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2 + rng.sym(0.25)));
      b.instance('lit.paper', planeGeo(s, s * rng.range(0.7, 1.4), 1),
        this.materials.variant('plywood', { color: 0xbdb6a8 }), m);
    }
  }

  _dumpsters() {
    const b = this.b, rng = this.rng.stream('dumpsters');
    const spots = [];
    // alleys first — that is where they belong
    for (const al of PLAN.alleys) {
      const n = Math.floor((al.to - al.from) / 9);
      for (let i = 0; i < n; i++) {
        const t = al.from + (i + 0.5) * ((al.to - al.from) / n);
        const off = (rng.bool() ? 1 : -1) * (al.halfRoad - 0.85);
        spots.push(al.axis === 'z' ? [al.center + off, t, al.axis === 'z' ? 0 : Math.PI / 2] : [t, al.center + off, Math.PI / 2]);
      }
    }
    for (let i = 0; i < 14; i++) {
      const st = rng.pick(PLAN.streets);
      const side = rng.bool() ? 1 : -1;
      const off = side * (frontage(st) - 1.5);
      const t = rng.range(st.from + 12, st.to - 12);
      spots.push(st.axis === 'z' ? [st.center + off, t, 0] : [t, st.center + off, Math.PI / 2]);
    }

    for (const [x, z, baseYaw] of spots) {
      if (Math.abs(x) > PLAN.bounds.maxX - 4 || Math.abs(z) > PLAN.bounds.maxZ - 4) continue;
      const yaw = baseYaw + rng.sym(0.22);
      const W = rng.range(1.7, 2.2), D = rng.range(1.05, 1.35), H = rng.range(1.15, 1.4);
      const col = rng.pick([0x2f4a35, 0x3a3d42, 0x4a3226, 0x24384a]);
      const mat = this.materials.variant('metalPainted', { color: col });
      const y = WALK_Y + H / 2;
      b.instance(`dp.body.${W.toFixed(1)}`, boxGeo(W, H, D, 1.1), mat, mat4(x, y, z, yaw));
      // ribbing
      for (let k = 0; k < 5; k++) {
        b.instance('dp.rib', boxGeo(0.06, H - 0.1, D + 0.03), mat,
          mat4(x + Math.cos(yaw) * (-W / 2 + 0.2 + k * (W - 0.4) / 4), y, z + Math.sin(yaw) * (-W / 2 + 0.2 + k * (W - 0.4) / 4), yaw));
      }
      // lids — usually one open
      const openA = rng.bool(0.55) ? rng.range(0.9, 1.5) : 0.04;
      for (const s of [-1, 1]) {
        const lm = mat4(x - Math.sin(yaw) * s * D * 0.24, WALK_Y + H + 0.03, z - Math.cos(yaw) * s * D * 0.24, yaw);
        lm.multiply(new THREE.Matrix4().makeRotationX(s > 0 ? openA : -0.04));
        b.instance('dp.lid', boxGeo(W - 0.06, 0.06, D * 0.5), this.materials.variant('metalPainted', { color: 0x1e2124 }), lm);
      }
      // contents visible over the rim
      b.instance('dp.fill', boxGeo(W - 0.2, 0.4, D - 0.2), 'debris', mat4(x, WALK_Y + H - 0.1, z, yaw));
      // caster wheels
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        b.instance('dp.wheel', cylGeo(0.09, 0.09, 0.06, 8), 'rubber',
          mat4(x + Math.cos(yaw) * sx * (W / 2 - 0.2) - Math.sin(yaw) * sz * (D / 2 - 0.14), WALK_Y + 0.09,
            z + Math.sin(yaw) * sx * (W / 2 - 0.2) + Math.cos(yaw) * sz * (D / 2 - 0.14), yaw, 0, Math.PI / 2));
      }
      this.phys.addBox(x, y, z, W / 2, H / 2, D / 2, yaw, 'metal', 1 | 2);
      this.coverPoints.push({ x, z, height: H + WALK_Y, quality: 0.85, kind: 'dumpster', yaw });
    }
  }

  /* --------------------------- barriers & bollards ---------------------- */

  _bollardsAndBarriers() {
    const b = this.b, rng = this.rng.stream('barriers');

    // Jersey barriers, mostly around the intersection and the checkpoints.
    const runs = [
      { x: -18, z: -13, yaw: 0, n: 5 },
      { x: 16, z: 12, yaw: 0, n: 4 },
      { x: 12, z: -20, yaw: Math.PI / 2, n: 4 },
      { x: -13, z: 26, yaw: Math.PI / 2, n: 5 },
      { x: 0, z: -46, yaw: 0, n: 7 },
      { x: 4, z: 44, yaw: 0, n: 6 },
      { x: -66, z: 2, yaw: 0, n: 4 },
      { x: 66, z: -4, yaw: 0, n: 4 },
    ];
    for (const r of runs) {
      for (let i = 0; i < r.n; i++) {
        const t = (i - (r.n - 1) / 2) * 2.05;
        const x = r.x + Math.cos(r.yaw) * t;
        const z = r.z + Math.sin(r.yaw) * t;
        const yaw = r.yaw + rng.sym(0.09);
        const knocked = rng.bool(0.16);
        this._jersey(b, x, z, yaw, knocked, rng);
      }
    }

    // Steel bollards protecting building corners.
    for (let i = 0; i < 40; i++) {
      const st = rng.pick(PLAN.streets);
      const side = rng.bool() ? 1 : -1;
      const off = side * (st.halfRoad + 0.6);
      const t = rng.range(st.from + 8, st.to - 8);
      const [x, z] = st.axis === 'z' ? [st.center + off, t] : [t, st.center + off];
      if (Math.abs(x) > PLAN.bounds.maxX - 4 || Math.abs(z) > PLAN.bounds.maxZ - 4) continue;
      const h = rng.range(0.75, 0.95);
      const lean = rng.bool(0.2) ? rng.sym(0.25) : 0;
      b.instance('bo.post', cylGeo(0.09, 0.1, h, 10),
        this.materials.variant('metalPainted', { color: rng.pick([0x2b2e31, 0x8a6a1e, 0x6a2a22]) }),
        mat4(x, WALK_Y + h / 2, z, 0, lean, 0));
      b.instance('bo.cap', sphereGeo(0.095, 10, 5), 'metalPainted', mat4(x, WALK_Y + h, z));
      this.phys.addBox(x, WALK_Y + h / 2, z, 0.12, h / 2, 0.12, 0, 'metal', 1 | 2);
    }

    // Orange plastic construction barriers and plywood hoarding.
    for (let i = 0; i < 22; i++) {
      const st = rng.pick(PLAN.streets);
      const t = rng.range(st.from + 12, st.to - 12);
      const off = rng.sym(st.halfRoad * 0.8);
      const [x, z] = st.axis === 'z' ? [st.center + off, t] : [t, st.center + off];
      if (Math.abs(x) > PLAN.bounds.maxX - 5 || Math.abs(z) > PLAN.bounds.maxZ - 5) continue;
      const yaw = (st.axis === 'z' ? Math.PI / 2 : 0) + rng.sym(0.5);
      const y = roadHeight(x, z);
      const tipped = rng.bool(0.25);
      const om = this.materials.variant('metalPainted', { color: 0xc25a1c, roughness: 0.85, metalness: 0.05 });
      if (tipped) {
        b.instance('cb.body', boxGeo(1.9, 0.95, 0.1), om, mat4(x, y + 0.1, z, yaw, Math.PI / 2, 0));
      } else {
        b.instance('cb.body', boxGeo(1.9, 0.95, 0.1), om, mat4(x, y + 0.55, z, yaw));
        b.instance('cb.foot', boxGeo(0.14, 0.1, 0.7), 'metalDarkPainted', mat4(x - Math.cos(yaw) * 0.85, y + 0.05, z - Math.sin(yaw) * 0.85, yaw));
        b.instance('cb.foot', boxGeo(0.14, 0.1, 0.7), 'metalDarkPainted', mat4(x + Math.cos(yaw) * 0.85, y + 0.05, z + Math.sin(yaw) * 0.85, yaw));
        // reflective stripes
        for (let k = 0; k < 3; k++) {
          b.instance('cb.stripe', boxGeo(0.34, 0.9, 0.02),
            this.materials.variant('metalPainted', { color: 0xd8d4c8 }),
            mat4(x + Math.cos(yaw) * (-0.6 + k * 0.6), y + 0.55, z + Math.sin(yaw) * (-0.6 + k * 0.6), yaw));
        }
        this.phys.addBox(x, y + 0.5, z, 0.95, 0.5, 0.14, yaw, 'metal', 1);
        this.coverPoints.push({ x, z, height: y + 1.0, quality: 0.4, kind: 'barrier', yaw });
      }
    }

    // Plywood hoarding around a collapsed frontage.
    for (const [hx, hz, hy, hlen] of [[-17.5, 30, 0, 14], [17.5, -34, 0, 12], [-40, -12.5, Math.PI / 2, 10]]) {
      const yaw = hy;
      const n = Math.round(hlen / 1.22);
      for (let i = 0; i < n; i++) {
        const t = (i - (n - 1) / 2) * 1.22;
        const x = hx + Math.cos(yaw) * t, z = hz + Math.sin(yaw) * t;
        b.instance('hd.panel', boxGeo(1.22, 2.45, 0.05), 'plywood', mat4(x, WALK_Y + 1.22, z, yaw));
        b.instance('hd.rail', boxGeo(1.22, 0.09, 0.09), 'wood', mat4(x, WALK_Y + 2.2, z + 0.07, yaw));
        b.instance('hd.rail', boxGeo(1.22, 0.09, 0.09), 'wood', mat4(x, WALK_Y + 0.5, z + 0.07, yaw));
        this.phys.addBox(x, WALK_Y + 1.22, z, 0.61, 1.22, 0.06, yaw, 'wood', 1 | 2);
      }
      this.coverPoints.push({ x: hx, z: hz, height: WALK_Y + 2.4, quality: 0.7, kind: 'hoarding', yaw });
    }
  }

  _jersey(b, x, z, yaw, knocked, rng) {
    const y = isRoad(x, z) ? roadHeight(x, z) : WALK_Y;
    const H = 0.95, W = 2.0;
    const m = knocked
      ? mat4(x, y + 0.3, z, yaw, 0, Math.PI / 2 * rng.range(0.75, 1))
      : mat4(x, y + H / 2, z, yaw);
    // tapered profile: wide foot, narrow top
    b.instance('jb.foot', boxGeo(W, 0.2, 0.62), 'concreteBarrier',
      knocked ? m : mat4(x, y + 0.1, z, yaw));
    b.instance('jb.mid', boxGeo(W, 0.42, 0.42), 'concreteBarrier',
      knocked ? m : mat4(x, y + 0.36, z, yaw));
    b.instance('jb.top', boxGeo(W, 0.42, 0.26), 'concreteBarrier',
      knocked ? m : mat4(x, y + 0.74, z, yaw));
    if (!knocked) {
      this.phys.addBox(x, y + H / 2, z, W / 2, H / 2, 0.32, yaw, 'concrete', 1 | 2);
      this.coverPoints.push({ x, z, height: y + H, quality: 0.95, kind: 'jersey', yaw });
    }
  }

  /* ----------------------------- misc street ---------------------------- */

  _newsboxes() {
    const b = this.b, rng = this.rng.stream('news');
    for (let i = 0; i < 16; i++) {
      const st = rng.pick(PLAN.streets);
      const side = rng.bool() ? 1 : -1;
      const off = side * (st.halfRoad + 1.0);
      const t = rng.range(st.from + 14, st.to - 14);
      const [bx, bz] = st.axis === 'z' ? [st.center + off, t] : [t, st.center + off];
      if (Math.abs(bx) > PLAN.bounds.maxX - 5 || Math.abs(bz) > PLAN.bounds.maxZ - 5) continue;
      const n = rng.int(2, 5);
      const baseYaw = st.axis === 'z' ? (side < 0 ? Math.PI / 2 : -Math.PI / 2) : (side < 0 ? 0 : Math.PI);
      for (let k = 0; k < n; k++) {
        const o = (k - (n - 1) / 2) * 0.58;
        const x = bx + Math.cos(baseYaw) * o, z = bz - Math.sin(baseYaw) * o;
        const col = rng.pick([0x1d3f6b, 0x8a2420, 0x25563a, 0x6a5a1e, 0x3a3a3d]);
        const mm = this.materials.variant('metalPainted', { color: col });
        b.instance('nb.body', boxGeo(0.5, 0.72, 0.44, 0.6), mm, mat4(x, WALK_Y + 0.66, z, baseYaw + rng.sym(0.1)));
        b.instance('nb.win', planeGeo(0.36, 0.4, 1), 'glassDark',
          mat4(x + Math.sin(baseYaw) * 0.23, WALK_Y + 0.82, z + Math.cos(baseYaw) * 0.23, baseYaw));
        b.instance('nb.legs', boxGeo(0.46, 0.3, 0.4), 'metalDarkPainted', mat4(x, WALK_Y + 0.15, z, baseYaw));
        this.phys.addBox(x, WALK_Y + 0.5, z, 0.28, 0.5, 0.25, baseYaw, 'metal', 1 | 2);
      }
      this.coverPoints.push({ x: bx, z: bz, height: WALK_Y + 1.0, quality: 0.35, kind: 'newsbox' });
    }
  }

  _utilityBoxes() {
    const b = this.b, rng = this.rng.stream('utilbox');
    for (let i = 0; i < 20; i++) {
      const st = rng.pick(PLAN.streets);
      const side = rng.bool() ? 1 : -1;
      const off = side * (frontage(st) - rng.range(0.6, 1.2));
      const t = rng.range(st.from + 10, st.to - 10);
      const [x, z] = st.axis === 'z' ? [st.center + off, t] : [t, st.center + off];
      if (Math.abs(x) > PLAN.bounds.maxX - 5 || Math.abs(z) > PLAN.bounds.maxZ - 5) continue;
      const yaw = st.axis === 'z' ? 0 : Math.PI / 2;
      const w = rng.range(0.7, 1.3), h = rng.range(0.9, 1.5), d = rng.range(0.4, 0.65);
      b.instance(`ub.body.${w.toFixed(1)}`, boxGeo(w, h, d, 0.8),
        this.materials.variant('metalPainted', { color: rng.pick([0x4a5054, 0x3e4a3e, 0x55504a]) }),
        mat4(x, WALK_Y + h / 2, z, yaw));
      b.instance('ub.vent', planeGeo(w * 0.7, h * 0.3, 0.3), 'grate',
        mat4(x + Math.sin(yaw) * (d / 2 + 0.01), WALK_Y + h * 0.35, z + Math.cos(yaw) * (d / 2 + 0.01), yaw));
      this.phys.addBox(x, WALK_Y + h / 2, z, w / 2, h / 2, d / 2, yaw, 'metal', 1 | 2);
      this.coverPoints.push({ x, z, height: WALK_Y + h, quality: 0.45, kind: 'utilbox', yaw });
    }
    // Payphone hoods and mailboxes
    for (let i = 0; i < 8; i++) {
      const st = rng.pick(PLAN.streets);
      const side = rng.bool() ? 1 : -1;
      const off = side * (st.halfRoad + 1.1);
      const t = rng.range(st.from + 16, st.to - 16);
      const [x, z] = st.axis === 'z' ? [st.center + off, t] : [t, st.center + off];
      if (Math.abs(x) > PLAN.bounds.maxX - 5) continue;
      const yaw = rng.next() * TAU;
      const mb = this.materials.variant('metalPainted', { color: 0x1f3d6b });
      b.instance('mb.body', boxGeo(0.7, 1.1, 0.6, 0.7), mb, mat4(x, WALK_Y + 0.62, z, yaw));
      b.instance('mb.top', cylGeo(0.3, 0.3, 0.7, 12, false), mb, mat4(x, WALK_Y + 1.17, z, yaw, 0, Math.PI / 2));
      b.instance('mb.legs', boxGeo(0.6, 0.14, 0.5), 'metalDarkPainted', mat4(x, WALK_Y + 0.07, z, yaw));
      this.phys.addBox(x, WALK_Y + 0.7, z, 0.38, 0.7, 0.34, yaw, 'metal', 1 | 2);
      this.coverPoints.push({ x, z, height: WALK_Y + 1.4, quality: 0.5, kind: 'mailbox', yaw });
    }
  }

  /* --------------------------- subway entrance -------------------------- */

  _subwayEntrance() {
    const b = this.b, rng = this.rng.stream('subway');
    const spots = [
      { x: -14.5, z: -18, yaw: 0 },
      { x: 15.0, z: 20, yaw: Math.PI },
    ];
    for (const s of spots) {
      this._subway(b, rng, s.x, s.z, s.yaw);
    }
  }

  _subway(b, rng, x, z, yaw) {
    const W = 3.4, L = 5.2;
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    const P = (a, o) => [x + c * a - sn * o, z + sn * a + c * o];

    // The stairwell void: a dark shaft with real steps descending into it.
    const steps = 12;
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const [sx, sz] = P(-L / 2 + 0.5 + t * (L - 1.2), 0);
      const sy = WALK_Y - 0.16 - t * 3.1;
      b.instance('sw.step', boxGeo(0.38, 0.17, W - 0.7), 'concreteDark', mat4(sx, sy, sz, yaw));
    }
    // shaft walls in subway tile
    for (const o of [-W / 2, W / 2]) {
      const [wx, wz] = P(0, o);
      b.instance('sw.wall', boxGeo(L, 3.6, 0.25), 'tileSubway', mat4(wx, WALK_Y - 1.8, wz, yaw));
    }
    const [bx, bz] = P(L / 2, 0);
    b.instance('sw.back', boxGeo(0.25, 3.6, W), 'tileSubway', mat4(bx, WALK_Y - 1.8, bz, yaw));
    const [fx, fz] = P(-L / 2, 0);
    b.instance('sw.void', planeGeo(W, 3.4, 1), this.materials.variant('concreteDark', { color: 0x05070a }),
      mat4(fx + c * 0.1, WALK_Y - 1.9, fz + sn * 0.1, yaw));
    // ceiling over the lower run so you cannot see sky through it
    b.instance('sw.ceil', boxGeo(L * 0.55, 0.2, W), 'concreteDark', mat4(...(() => { const [a, bq] = P(L * 0.22, 0); return [a, WALK_Y - 0.1, bq]; })(), yaw));

    // Cheek walls with a stainless cap rail — the NYC stair enclosure.
    for (const o of [-W / 2 - 0.2, W / 2 + 0.2]) {
      const [px, pz] = P(0, o);
      b.instance('sw.cheek', boxGeo(L + 0.6, 1.05, 0.34), 'concrete', mat4(px, WALK_Y + 0.52, pz, yaw));
      b.instance('sw.caprail', boxGeo(L + 0.6, 0.07, 0.42), 'chrome', mat4(px, WALK_Y + 1.08, pz, yaw));
      this.phys.addBox(px, WALK_Y + 0.55, pz, (L + 0.6) / 2, 0.55, 0.2, yaw, 'concrete', 1 | 2);
      this.coverPoints.push({ x: px, z: pz, height: WALK_Y + 1.1, quality: 0.8, kind: 'subway', yaw });
      // pipe railing above the cheek wall
      for (let i = 0; i <= 6; i++) {
        const [rx, rz] = P(-L / 2 + (i / 6) * L, o);
        b.instance('sw.bal', cylGeo(0.025, 0.025, 0.85, 6), 'chrome', mat4(rx, WALK_Y + 1.5, rz));
      }
      const [rx2, rz2] = P(0, o);
      b.instance('sw.rail', cylGeo(0.032, 0.032, L, 6), 'chrome', mat4(rx2, WALK_Y + 1.92, rz2, yaw, 0, Math.PI / 2));
    }
    // back wall of the enclosure
    const [ex, ez] = P(L / 2 + 0.3, 0);
    b.instance('sw.end', boxGeo(0.34, 1.05, W + 0.8), 'concrete', mat4(ex, WALK_Y + 0.52, ez, yaw));

    // Entrance globes on cast posts.
    for (const o of [-W / 2 - 0.2, W / 2 + 0.2]) {
      const [gx, gz] = P(-L / 2 - 0.1, o);
      b.instance('sw.post', cylGeo(0.06, 0.08, 2.7, 8), 'metalDarkPainted', mat4(gx, WALK_Y + 1.35, gz));
      b.instance('sw.globe', sphereGeo(0.22, 14, 10),
        this.materials.variant('glassShop', { color: 0x7a6a3a, emissive: 0x6a5518, emissiveIntensity: 0.8, opacity: 0.9 }),
        mat4(gx, WALK_Y + 2.85, gz));
      b.instance('sw.globebase', cylGeo(0.1, 0.13, 0.16, 8), 'metalDarkPainted', mat4(gx, WALK_Y + 2.62, gz));
      this.phys.addBox(gx, WALK_Y + 1.35, gz, 0.1, 1.35, 0.1, 0, 'metal', 1 | 2);
    }

    // Sign panel over the stair head
    const [ssx, ssz] = P(-L / 2 - 0.05, 0);
    const tex = makeStreetSign(rng, 'SUBWAY');
    b.instance('sw.sign', planeGeo(1.6, 0.42),
      this.materials.std({ map: tex, roughness: 0.8, side: THREE.DoubleSide }),
      mat4(ssx, WALK_Y + 2.35, ssz, yaw + Math.PI / 2));

    this.world.steamVents.push({ x: fx, y: WALK_Y, z: fz, scale: 1.8, rate: 1.1 });
    this.world.interiorLights.push({ x, y: WALK_Y - 1.6, z, color: 0x8fa89a, intensity: 2.4, distance: 9 });
  }

  /* ------------------------------ greenery ------------------------------ */

  _streetTrees() {
    const b = this.b, rng = this.rng.stream('trees');
    for (const st of PLAN.streets) {
      if (st.kind === 'boundary') continue;
      for (const side of [-1, 1]) {
        for (let t = st.from + 20; t < st.to - 20; t += rng.range(16, 26)) {
          const off = side * (st.halfRoad + 1.3);
          const [x, z] = st.axis === 'z' ? [st.center + off, t] : [t, st.center + off];
          if (Math.abs(x) > PLAN.bounds.maxX - 6 || Math.abs(z) > PLAN.bounds.maxZ - 6) continue;
          // tree pit with cast-iron guard
          b.instance('tr.pit', boxGeo(1.3, 0.04, 1.3), 'dirt', mat4(x, WALK_Y + 0.02, z));
          b.instance('tr.guard', planeGeo(1.35, 1.35, 0.5), 'grate',
            (() => { const m = mat4(x, WALK_Y + 0.04, z, rng.next() * TAU); m.multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2)); return m; })());
          const alive = rng.bool(0.25);
          const h = rng.range(3.6, 6.2);
          const lean = rng.sym(0.09);
          b.instance('tr.trunk', cylGeo(0.11, 0.19, h, 7), 'wood', mat4(x, WALK_Y + h / 2, z, 0, lean, 0));
          // bare branch structure — nothing has leafed out since the shelling
          const branches = rng.int(4, 8);
          for (let i = 0; i < branches; i++) {
            const a = rng.next() * TAU;
            const el = rng.range(0.5, 1.15);
            const bl = rng.range(0.9, 2.2);
            const by = WALK_Y + h * rng.range(0.6, 1.0);
            b.instance('tr.branch', cylGeo(0.03, 0.055, bl, 5), 'wood',
              mat4(x + Math.cos(a) * bl * 0.3, by, z + Math.sin(a) * bl * 0.3, a + Math.PI / 2, el, 0));
            for (let k = 0; k < 2; k++) {
              const a2 = a + rng.sym(1.0);
              b.instance('tr.twig', cylGeo(0.015, 0.028, bl * 0.6, 4), 'wood',
                mat4(x + Math.cos(a) * bl * 0.7 + Math.cos(a2) * 0.3, by + rng.range(0.2, 0.8),
                  z + Math.sin(a) * bl * 0.7 + Math.sin(a2) * 0.3, a2 + Math.PI / 2, rng.range(0.3, 1.2), 0));
            }
          }
          if (alive) {
            for (let i = 0; i < 5; i++) {
              const cs = rng.range(0.7, 1.3);
              b.instance('tr.canopy', sphereGeo(1, 7, 5), 'foliageDead',
                mat4(x + rng.sym(1.1), WALK_Y + h * rng.range(0.75, 1.05), z + rng.sym(1.1),
                  rng.next() * TAU, 0, 0, cs, cs * 0.8, cs));
            }
          }
          // tree guard stakes
          for (const s of [-1, 1]) {
            b.instance('tr.stake', boxGeo(0.05, 1.8, 0.05), 'wood', mat4(x + s * 0.5, WALK_Y + 0.9, z));
          }
          this.phys.addBox(x, WALK_Y + h / 2, z, 0.22, h / 2, 0.22, 0, 'wood', 1 | 2);
        }
      }
    }
  }

  _bicycles() {
    const b = this.b, rng = this.rng.stream('bikes');
    for (let i = 0; i < 12; i++) {
      const st = rng.pick(PLAN.streets);
      const side = rng.bool() ? 1 : -1;
      const off = side * (st.halfRoad + 1.0);
      const t = rng.range(st.from + 14, st.to - 14);
      const [x, z] = st.axis === 'z' ? [st.center + off, t] : [t, st.center + off];
      if (Math.abs(x) > PLAN.bounds.maxX - 5 || Math.abs(z) > PLAN.bounds.maxZ - 5) continue;
      const yaw = rng.next() * TAU;
      const fallen = rng.bool(0.45);
      const roll = fallen ? Math.PI / 2 * rng.range(0.8, 1) : 0;
      const y = WALK_Y + (fallen ? 0.32 : 0.34);
      const frameMat = this.materials.variant('metalPainted', { color: rng.pick([0x2a4a6a, 0x6a2a2a, 0x2a2a2a, 0x4a6a3a]) });
      const M = (dx, dy, dz, ry = 0, rp = 0, rr = 0) => {
        const m = mat4(x, y, z, yaw, 0, roll);
        m.multiply(new THREE.Matrix4().makeTranslation(dx, dy, dz));
        if (ry || rp || rr) m.multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rp, ry, rr, 'YXZ')));
        return m;
      };
      for (const wx of [-0.52, 0.52]) {
        b.instance('bk.wheel', torusGeo(0.33, 0.022, 5, 18), 'rubber', M(wx, 0, 0, Math.PI / 2));
        for (let s = 0; s < 6; s++) {
          b.instance('bk.spoke', cylGeo(0.004, 0.004, 0.64, 3), 'chrome', M(wx, 0, 0, Math.PI / 2, 0, s * 0.52));
        }
      }
      b.instance('bk.tube', cylGeo(0.018, 0.018, 0.85, 5), frameMat, M(0, 0.12, 0, 0, 0, Math.PI / 2 + 0.15));
      b.instance('bk.tube', cylGeo(0.018, 0.018, 0.6, 5), frameMat, M(-0.2, 0.05, 0, 0, 0, 0.6));
      b.instance('bk.tube', cylGeo(0.018, 0.018, 0.55, 5), frameMat, M(0.28, 0.1, 0, 0, 0, -0.5));
      b.instance('bk.bar', cylGeo(0.016, 0.016, 0.42, 5), 'chrome', M(0.42, 0.36, 0, Math.PI / 2));
      b.instance('bk.seat', boxGeo(0.19, 0.05, 0.09), 'rubber', M(-0.24, 0.36, 0));
      if (!fallen) {
        b.instance('bk.rack', cylGeo(0.03, 0.03, 0.9, 8), 'galvanized', mat4(x + 0.1, WALK_Y + 0.45, z, yaw, 0, 0));
      }
    }
  }

  /* --------------------------- rubble & debris -------------------------- */

  _debrisFields() {
    const b = this.b, rng = this.rng.stream('debris');
    // Rubble spilling from damaged frontages onto the sidewalk.
    const piles = [
      [-17.5, 34, 5.5], [17.5, -40, 4.5], [-52, -12.5, 4], [52, 12.5, 5],
      [-73, 24, 4], [73, -20, 4.5], [0, -52, 6], [-30, 12.5, 3.5], [30, -12.5, 3.5],
      [12, 51, 4], [-12, -52, 4],
    ];
    for (const [px, pz, radius] of piles) {
      const n = Math.floor(radius * 9);
      for (let i = 0; i < n; i++) {
        const a = rng.next() * TAU;
        const r = radius * Math.sqrt(rng.next());
        const x = px + Math.cos(a) * r, z = pz + Math.sin(a) * r;
        const fall = 1 - r / radius;
        const s = rng.range(0.1, 0.55) * (0.5 + fall);
        const y = (isRoad(x, z) ? roadHeight(x, z) : WALK_Y) + s * 0.4;
        b.instance('db.chunk', boxGeo(1, 1, 1), rng.bool(0.35) ? 'brickRed' : 'rubble',
          mat4(x, y, z, rng.next() * TAU, rng.sym(0.9), rng.sym(0.9),
            s * rng.range(0.8, 1.8), s * rng.range(0.5, 1.1), s * rng.range(0.8, 1.6)));
      }
      // a mound the player can take cover behind
      const mh = 0.35 + radius * 0.14;
      this.phys.addBox(px, WALK_Y + mh / 2, pz, radius * 0.55, mh / 2, radius * 0.55, 0, 'concrete', 1 | 2);
      this.coverPoints.push({ x: px, z: pz, height: WALK_Y + mh, quality: 0.75, kind: 'rubble' });
      // bent rebar poking out
      for (let i = 0; i < 6; i++) {
        const a = rng.next() * TAU, r = radius * rng.range(0.2, 0.8);
        b.instance('db.rebar', cylGeo(0.014, 0.014, rng.range(0.8, 1.8), 5), 'metalRust',
          mat4(px + Math.cos(a) * r, WALK_Y + 0.5, pz + Math.sin(a) * r, rng.next() * TAU, rng.sym(0.9), rng.sym(0.9)));
      }
      this.world.dustSources.push({ x: px, y: 0.3, z: pz, radius });
    }

    // Broken glass scatter under every shattered shopfront.
    for (let i = 0; i < 90; i++) {
      const st = rng.pick(PLAN.streets);
      const side = rng.bool() ? 1 : -1;
      const off = side * (frontage(st) - rng.range(0.4, 2.6));
      const t = rng.range(st.from + 6, st.to - 6);
      const [x, z] = st.axis === 'z' ? [st.center + off, t] : [t, st.center + off];
      if (Math.abs(x) > PLAN.bounds.maxX - 4 || Math.abs(z) > PLAN.bounds.maxZ - 4) continue;
      const s = rng.range(0.5, 1.6);
      const m = mat4(x, WALK_Y + 0.014, z, rng.next() * TAU);
      m.multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
      b.instance('db.glass', planeGeo(s, s * rng.range(0.5, 1.3), 1),
        this.materials.variant('glassBroken', { opacity: 0.38 }), m);
    }
  }

  _billboards() {
    const b = this.b, rng = this.rng.stream('billboards');
    const spots = [
      { x: -17.6, z: -30, yaw: -Math.PI / 2, y: 16, w: 11, h: 5.2 },
      { x: 17.6, z: 26, yaw: Math.PI / 2, y: 14, w: 9.5, h: 4.6 },
      { x: -40, z: -52.2, yaw: Math.PI, y: 13, w: 10, h: 4.8 },
    ];
    for (const s of spots) {
      const tex = makeBillboard(rng);
      const m = this.materials.std({ map: tex, roughness: 0.86, envMapIntensity: 0.4 });
      b.instance(`bb.face.${s.w}x${s.h}`, planeGeo(s.w, s.h), m, mat4(s.x, s.y, s.z, s.yaw));
      b.instance(`bb.back.${s.w}x${s.h}`, boxGeo(s.w + 0.4, s.h + 0.4, 0.25), 'billboardBack',
        mat4(s.x - Math.sin(s.yaw) * 0.16, s.y, s.z - Math.cos(s.yaw) * 0.16, s.yaw));
      // catwalk + lighting hoods
      b.instance(`bb.walk.${s.w}`, boxGeo(s.w, 0.06, 0.7), 'grate',
        mat4(s.x + Math.sin(s.yaw) * 0.4, s.y - s.h / 2 - 0.3, s.z + Math.cos(s.yaw) * 0.4, s.yaw));
      for (let i = 0; i < 4; i++) {
        const o = (i - 1.5) * (s.w / 4);
        b.instance('bb.hood', boxGeo(0.36, 0.2, 0.24), 'metalDarkPainted',
          mat4(s.x + Math.cos(s.yaw) * o + Math.sin(s.yaw) * 0.8, s.y - s.h / 2 - 0.05, s.z - Math.sin(s.yaw) * o + Math.cos(s.yaw) * 0.8, s.yaw, -0.5, 0));
      }
      // truss legs down to the roof
      for (const sx of [-1, 1]) {
        b.instance('bb.leg', boxGeo(0.18, 4.5, 0.18), 'metalRust',
          mat4(s.x + Math.cos(s.yaw) * sx * s.w * 0.36, s.y - s.h / 2 - 2.2, s.z - Math.sin(s.yaw) * sx * s.w * 0.36, s.yaw));
      }
    }
  }

  _alleyDressing() {
    const b = this.b, rng = this.rng.stream('alley');
    for (const al of PLAN.alleys) {
      const len = al.to - al.from;
      const n = Math.floor(len / 4);
      for (let i = 0; i < n; i++) {
        const t = al.from + (i + 0.5) * (len / n);
        for (const side of [-1, 1]) {
          const off = side * (al.halfRoad - 0.15);
          const [x, z] = al.axis === 'z' ? [al.center + off, t] : [t, al.center + off];
          const yaw = al.axis === 'z' ? (side < 0 ? Math.PI / 2 : -Math.PI / 2) : (side < 0 ? 0 : Math.PI);

          // vertical soil / vent stacks running up the wall
          if (rng.bool(0.55)) {
            const h = rng.range(4, 11);
            b.instance('al.pipe', cylGeo(0.075, 0.075, h, 8), 'metalRust', mat4(x, WALK_Y + h / 2, z, yaw));
            for (let k = 0; k < Math.floor(h / 2.2); k++) {
              b.instance('al.clamp', boxGeo(0.2, 0.05, 0.22), 'metalRust', mat4(x, WALK_Y + 0.8 + k * 2.2, z, yaw));
            }
          }
          // conduit runs
          if (rng.bool(0.4)) {
            b.instance('al.conduit', cylGeo(0.035, 0.035, 6, 6), 'galvanized',
              mat4(x, WALK_Y + rng.range(2.4, 3.4), z, yaw, 0, Math.PI / 2));
          }
          // wall lamp with a caged bulb
          if (rng.bool(0.22)) {
            const ly = WALK_Y + 2.9;
            b.instance('al.lampb', boxGeo(0.16, 0.2, 0.16), 'metalRust', mat4(x, ly, z, yaw));
            b.instance('al.lampg', sphereGeo(0.13, 8, 6),
              this.materials.variant('glassShop', { color: 0x6a5a2a, emissive: 0xffb054, emissiveIntensity: 2.2, opacity: 0.95 }),
              mat4(x + Math.sin(yaw) * 0.2, ly - 0.05, z + Math.cos(yaw) * 0.2, yaw));
            this.world.interiorLights.push({ x: x + Math.sin(yaw) * 0.4, y: ly, z: z + Math.cos(yaw) * 0.4, color: 0xffb054, intensity: 3.4, distance: 8 });
          }
          // steel service door
          if (rng.bool(0.3)) {
            b.instance('al.door', boxGeo(0.98, 2.1, 0.1), 'metalRust', mat4(x, WALK_Y + 1.05, z, yaw));
            b.instance('al.doorf', boxGeo(1.16, 2.28, 0.06), 'concreteDark', mat4(x, WALK_Y + 1.12, z, yaw));
            b.instance('al.step', boxGeo(1.2, 0.14, 0.5), 'concreteDark',
              mat4(x - Math.sin(yaw) * 0.28, WALK_Y + 0.07, z - Math.cos(yaw) * 0.28, yaw));
          }
          // wooden pallets and crates
          if (rng.bool(0.32)) {
            const px = x - Math.sin(yaw) * 0.5, pz = z - Math.cos(yaw) * 0.5;
            const lean = rng.bool(0.5);
            const m = mat4(px, WALK_Y + (lean ? 0.6 : 0.06), pz, yaw + rng.sym(0.4), lean ? 1.2 : 0, 0);
            b.instance('al.pallet', boxGeo(1.2, 0.12, 0.8), 'wood', m);
            if (rng.bool(0.5)) {
              b.instance('al.crate', boxGeo(0.7, 0.6, 0.6), 'plywood',
                mat4(px + rng.sym(0.4), WALK_Y + 0.3, pz + rng.sym(0.3), rng.next() * TAU));
              this.phys.addBox(px, WALK_Y + 0.3, pz, 0.4, 0.3, 0.35, 0, 'wood', 1 | 2);
            }
          }
        }
      }
      // puddles down the centre of the alley
      for (let i = 0; i < Math.floor(len / 5); i++) {
        const t = al.from + rng.range(1, len - 1);
        const [x, z] = al.axis === 'z' ? [al.center + rng.sym(al.halfRoad * 0.6), t] : [t, al.center + rng.sym(al.halfRoad * 0.6)];
        const m = mat4(x, WALK_Y + 0.024, z, rng.next() * TAU);
        m.multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
        b.instance('al.pud', planeGeo(rng.range(1.2, 2.8), rng.range(0.9, 2.0), 2),
          this.materials.variant('asphaltWet', { color: 0x55585a }), m);
      }
      // steam from a broken utility line
      const st = al.from + len * 0.4;
      const [sx, sz] = al.axis === 'z' ? [al.center, st] : [st, al.center];
      this.world.steamVents.push({ x: sx, y: WALK_Y, z: sz, scale: 1.2, rate: 0.7 });
    }
  }

  /* --------------------------- map boundaries --------------------------- */

  _boundaryBlockades() {
    const b = this.b, rng = this.rng.stream('bounds');
    const { minX, maxX, minZ, maxZ } = PLAN.bounds;

    // The map ends where the city collapsed into the street. Every boundary is
    // something you can see and understand, not an invisible wall.
    const walls = [
      { x: 0, z: minZ + 2, w: maxX - minX, d: 5, yaw: 0 },
      { x: 0, z: maxZ - 2, w: maxX - minX, d: 5, yaw: 0 },
      { x: minX + 2, z: 0, w: 5, d: maxZ - minZ, yaw: 0 },
      { x: maxX - 2, z: 0, w: 5, d: maxZ - minZ, yaw: 0 },
    ];
    for (const w of walls) {
      // Physical stop, tall enough that nothing can be mantled over.
      this.phys.addBox(w.x, 18, w.z, w.w / 2, 18, w.d / 2, 0, 'concrete', 1 | 2);
    }

    // Collapsed masonry choking the boundary streets.
    for (const s of [[-84, minZ + 8], [-84, maxZ - 8], [84, minZ + 8], [84, maxZ - 8],
    [minX + 8, -62], [maxX - 8, -62], [minX + 8, 62], [maxX - 8, 62],
    [minX + 8, 0], [maxX - 8, 0], [0, minZ + 8], [0, maxZ - 8]]) {
      const [cx, cz] = s;
      for (let i = 0; i < 60; i++) {
        const a = rng.next() * TAU;
        const r = rng.range(0, 9);
        const sc = rng.range(0.4, 1.9) * (1 - r / 12);
        const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        const y = rng.range(0, 5.5) * (1 - r / 11);
        b.instance('bd.chunk', boxGeo(1, 1, 1), rng.bool(0.4) ? 'brickDark' : 'rubble',
          mat4(x, Math.max(0.2, y), z, rng.next() * TAU, rng.sym(1), rng.sym(1),
            sc * rng.range(1, 2.6), sc * rng.range(0.6, 1.4), sc * rng.range(1, 2.2)));
      }
      // leaning slabs
      for (let i = 0; i < 8; i++) {
        const a = rng.next() * TAU, r = rng.range(2, 7);
        b.instance('bd.slab', boxGeo(4.5, 0.35, 3), 'concreteDark',
          mat4(cx + Math.cos(a) * r, rng.range(1, 3.5), cz + Math.sin(a) * r,
            rng.next() * TAU, rng.range(0.4, 1.2), rng.sym(0.5)));
      }
      this.phys.addBox(cx, 4, cz, 9, 4, 9, 0, 'concrete', 1 | 2);
      if (rng.bool(0.5)) this.world.smokeSources.push({ x: cx, y: 1.5, z: cz, rate: 0.35, scale: 2.2, kind: 'ruin' });
    }
  }
}
