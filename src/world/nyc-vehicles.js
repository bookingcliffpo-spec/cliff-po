import * as THREE from 'three';
import { boxGeo, planeGeo, cylGeo, coneGeo, mat4 } from './batcher.js';
import { PLAN, frontage, isRoad } from './nyc-layout.js';
import { roadHeight } from './nyc-streets.js';
import { ctx2d, canvasToTexture, FONT_STACK, FONT_CONDENSED, fitText } from '../materials/procgen.js';
import { TAU, clamp01, lerp } from '../core/math.js';

/**
 * Procedural traffic. These need to survive a look at 3 m through a red dot,
 * so the silhouette work matters more than the polycount: greenhouse taper,
 * wheel-arch cut, sill undercut, bumper standoff, mirror, light glass.
 */

export const CLASSES = {
  sedan: {
    L: 4.72, W: 1.83, H: 1.46, wheelR: 0.34, wheelW: 0.24,
    cabinFrac: [0.20, 0.80], roofFrac: [0.32, 0.70], beltH: 0.78, roofH: 1.44,
    noseH: 0.94, tailH: 1.0, taper: 0.86,
  },
  taxi: {
    L: 4.92, W: 1.88, H: 1.55, wheelR: 0.35, wheelW: 0.25,
    cabinFrac: [0.19, 0.82], roofFrac: [0.30, 0.72], beltH: 0.82, roofH: 1.52,
    noseH: 0.98, tailH: 1.04, taper: 0.87, taxi: true,
  },
  suv: {
    L: 4.86, W: 1.98, H: 1.82, wheelR: 0.39, wheelW: 0.28,
    cabinFrac: [0.16, 0.90], roofFrac: [0.24, 0.86], beltH: 1.0, roofH: 1.8,
    noseH: 1.18, tailH: 1.34, taper: 0.9,
  },
  van: {
    L: 5.6, W: 2.05, H: 2.55, wheelR: 0.38, wheelW: 0.27,
    cabinFrac: [0.10, 0.98], roofFrac: [0.08, 0.98], beltH: 1.25, roofH: 2.5,
    noseH: 1.3, tailH: 2.5, taper: 0.96, boxBody: true,
  },
  police: {
    L: 4.95, W: 1.94, H: 1.55, wheelR: 0.36, wheelW: 0.26,
    cabinFrac: [0.19, 0.82], roofFrac: [0.30, 0.72], beltH: 0.84, roofH: 1.52,
    noseH: 1.0, tailH: 1.06, taper: 0.87, lightbar: true,
  },
  ambulance: {
    L: 6.2, W: 2.2, H: 2.75, wheelR: 0.42, wheelW: 0.3,
    cabinFrac: [0.06, 0.44], roofFrac: [0.06, 0.42], beltH: 1.35, roofH: 2.1,
    noseH: 1.35, tailH: 2.7, taper: 0.98, boxBody: true, boxFrom: 0.44, lightbar: true,
  },
  bus: {
    L: 12.0, W: 2.55, H: 3.15, wheelR: 0.52, wheelW: 0.32,
    cabinFrac: [0.02, 0.99], roofFrac: [0.02, 0.99], beltH: 1.55, roofH: 3.1,
    noseH: 1.9, tailH: 3.05, taper: 0.99, boxBody: true, bus: true,
  },
  truck: {
    L: 7.4, W: 2.4, H: 3.0, wheelR: 0.48, wheelW: 0.3,
    cabinFrac: [0.04, 0.36], roofFrac: [0.06, 0.34], beltH: 1.5, roofH: 2.7,
    noseH: 1.5, tailH: 2.6, taper: 0.98, boxBody: true, boxFrom: 0.38, utility: true,
  },
};

const BODY_COLORS = [
  0x2b3138, 0x8e9296, 0x5a6068, 0x1d232a, 0x6d3230,
  0x24405e, 0x3c4a3a, 0xa8a49c, 0x704a2a, 0x39323a,
];

export class VehicleBuilder {
  constructor(world) {
    this.world = world;
    this.b = world.batcher;
    this.phys = world.phys;
    this.materials = world.materials;
    this.rng = world.rng.stream('vehicles');
    this.count = 0;
    this._taxiSide = null;
  }

  build() {
    const rng = this.rng;
    // Parked along the curb, jammed in the intersection, abandoned mid-turn.
    this._parkedRuns();
    this._intersectionWrecks();
    this._scattered();
  }

  /* ------------------------------ placement ----------------------------- */

  _parkedRuns() {
    const rng = this.rng.stream('parked');
    for (const st of PLAN.streets) {
      if (st.kind === 'boundary') continue;
      for (const side of [-1, 1]) {
        let t = st.from + rng.range(14, 24);
        while (t < st.to - 16) {
          const cls = rng.weighted(
            ['sedan', 'taxi', 'suv', 'van', 'police', 'truck'],
            [0.34, 0.22, 0.18, 0.13, 0.06, 0.07]);
          const spec = CLASSES[cls];
          const off = side * (st.halfRoad - spec.W / 2 - rng.range(0.15, 0.55));
          const [x, z] = st.axis === 'z' ? [st.center + off, t] : [t, st.center + off];
          if (Math.abs(x) > PLAN.bounds.maxX - 8 || Math.abs(z) > PLAN.bounds.maxZ - 8) { t += 8; continue; }
          if (this._nearIntersection(x, z, 12)) { t += spec.L + 2; continue; }
          const yaw = (st.axis === 'z' ? 0 : Math.PI / 2) + rng.sym(0.05) + (side > 0 ? Math.PI : 0);
          this.spawn(cls, x, z, yaw, rng);
          t += spec.L + rng.range(1.2, 5.5);
          if (rng.bool(0.22)) t += rng.range(4, 12);       // gaps in the parked line
        }
      }
    }
  }

  _intersectionWrecks() {
    const rng = this.rng.stream('wrecks');
    // The overturned bus is the level's landmark: it blocks the west approach
    // and gives the intersection a readable silhouette from every street.
    this.spawn('bus', -4.5, -6.0, 0.42, rng, { roll: Math.PI * 0.62, burnt: true, damage: 1 });
    this.spawn('taxi', 6.2, 2.4, 2.35, rng, { damage: 0.85, burnt: true });
    this.spawn('sedan', -8.5, 5.4, 1.1, rng, { damage: 0.7 });
    this.spawn('police', 9.5, -7.5, -0.7, rng, { damage: 0.5, doorsOpen: true });
    this.spawn('van', -10.5, -13.5, 0.15, rng, { damage: 0.6 });
    this.spawn('ambulance', 12.5, 12.0, Math.PI * 0.55, rng, { damage: 0.4, doorsOpen: true });
    this.spawn('suv', 3.0, 14.5, Math.PI + 0.3, rng, { damage: 0.55, burnt: true });
    this.spawn('taxi', -2.0, 22.0, 0.05, rng, { damage: 0.3 });
    this.spawn('sedan', 5.5, -24.0, Math.PI - 0.1, rng, { damage: 0.45 });
    this.spawn('truck', -6.0, -32.0, 0.2, rng, { damage: 0.5 });
  }

  _scattered() {
    const rng = this.rng.stream('scatter');
    const spots = [
      [-40, -6, 1.6], [42, 4, -1.4], [-64, 3, 0.2], [66, -2, Math.PI],
      [-3, -62, 1.5], [4, 62, -1.6], [-30, -62, 0.1], [34, 62, Math.PI],
      [-46, -30, 0.6], [48, 30, 2.4], [-20, 44, 1.1], [24, -44, 2.9],
    ];
    for (const [x, z, yaw] of spots) {
      if (!isRoad(x, z)) continue;
      const cls = rng.weighted(['sedan', 'taxi', 'suv', 'van', 'truck'], [0.3, 0.25, 0.2, 0.15, 0.1]);
      this.spawn(cls, x + rng.sym(2), z + rng.sym(2), yaw + rng.sym(0.3), rng,
        { damage: rng.range(0.2, 0.9), burnt: rng.bool(0.2) });
    }
  }

  _nearIntersection(x, z, r) {
    for (const a of PLAN.streets) {
      for (const c of PLAN.streets) {
        if (a.axis === c.axis) continue;
        const ix = a.axis === 'z' ? a.center : c.center;
        const iz = a.axis === 'z' ? c.center : a.center;
        if (Math.abs(x - ix) < r && Math.abs(z - iz) < r) return true;
      }
    }
    return false;
  }

  /* -------------------------------- build ------------------------------- */

  spawn(cls, x, z, yaw, rng, opts = {}) {
    const S = CLASSES[cls];
    const damage = opts.damage ?? rng.range(0, 0.55);
    const burnt = opts.burnt ?? rng.bool(0.1);
    const roll = opts.roll || 0;
    const b = this.b;
    const G = 'vehicles';

    const ground = roadHeight(x, z);
    const sag = damage > 0.5 ? -0.06 : 0;   // flat tyres drop the body
    const baseY = ground + S.wheelR + sag;
    const rootY = roll ? ground + S.W * 0.5 : baseY;

    // Local → world transform (yaw about Y, optional roll about the length axis)
    const root = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0, yaw, roll, 'YZX'));
    root.setPosition(x, rootY, z);
    const M = (lx, ly, lz, ry = 0, rp = 0, rr = 0, sx = 1, sy = 1, sz = 1) => {
      const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rp, ry, rr, 'YXZ'));
      m.scale(new THREE.Vector3(sx, sy, sz));
      m.setPosition(lx, ly, lz);
      return root.clone().multiply(m);
    };

    // --- materials ---
    let bodyMat;
    if (burnt) bodyMat = this.materials.get('vehicleBurnt');
    else if (S.taxi) bodyMat = this.materials.get('taxiPaint');
    else if (S.lightbar && cls === 'police') bodyMat = this.materials.variant('vehiclePaint', { color: 0x1c2027 });
    else if (cls === 'ambulance') bodyMat = this.materials.variant('vehiclePaint', { color: 0xc9c4b8 });
    else if (cls === 'bus') bodyMat = this.materials.variant('vehiclePaint', { color: 0x3a4a55 });
    else bodyMat = this.materials.variant('vehiclePaint', { color: rng.pick(BODY_COLORS) });
    const trimMat = burnt ? this.materials.get('vehicleBurnt') : this.materials.get('metalDarkPainted');
    const glassMat = damage > 0.62 || burnt ? this.materials.get('glassBroken') : this.materials.get('carGlass');

    const L = S.L, W = S.W;
    const bodyBottom = -S.wheelR + 0.22;

    // --- lower body: sill, floor, doors -------------------------------
    const sillH = S.beltH - bodyBottom;
    b.add(boxGeo(L * 0.985, sillH, W, 1.2), M(0, bodyBottom + sillH / 2, 0), bodyMat, G);
    // rocker undercut so the body does not read as a slab
    b.add(boxGeo(L * 0.8, 0.16, W * 1.005), M(0, bodyBottom + 0.06, 0), trimMat, G);

    // --- nose and tail slope -------------------------------------------
    if (!S.boxBody) {
      // bonnet
      b.add(boxGeo(L * 0.24, S.noseH - bodyBottom - sillH * 0.1, W * 0.97, 1.2),
        M(-L * 0.38, bodyBottom + (S.noseH - bodyBottom) / 2, 0), bodyMat, G);
      // windscreen rake wedge
      const wsM = M(-L * 0.18, S.beltH + (S.roofH - S.beltH) * 0.5, 0, 0, 0, -0.62);
      b.add(boxGeo(0.1, (S.roofH - S.beltH) * 1.5, W * 0.9), wsM, trimMat, G);
      // boot
      b.add(boxGeo(L * 0.2, S.tailH - bodyBottom, W * 0.97, 1.2),
        M(L * 0.4, bodyBottom + (S.tailH - bodyBottom) / 2, 0), bodyMat, G);
    }

    // --- greenhouse -----------------------------------------------------
    const c0 = S.roofFrac[0] * L - L / 2;
    const c1 = S.roofFrac[1] * L - L / 2;
    const roofL = c1 - c0;
    const roofW = W * S.taper;
    b.add(boxGeo(roofL, 0.09, roofW, 1.2), M((c0 + c1) / 2, S.roofH, 0), bodyMat, G);
    // pillars
    const pillarH = S.roofH - S.beltH;
    for (const px of [c0 + 0.06, c1 - 0.06]) {
      for (const s of [-1, 1]) {
        b.add(boxGeo(0.1, pillarH, 0.1), M(px, S.beltH + pillarH / 2, s * (roofW / 2 - 0.05)), trimMat, G);
      }
    }
    // B-pillar
    if (roofL > 1.6) {
      for (const s of [-1, 1]) {
        b.add(boxGeo(0.09, pillarH, 0.09), M((c0 + c1) / 2, S.beltH + pillarH / 2, s * (roofW / 2 - 0.05)), trimMat, G);
      }
    }
    // side glass
    for (const s of [-1, 1]) {
      b.add(planeGeo(roofL - 0.24, pillarH - 0.1, 1),
        M((c0 + c1) / 2, S.beltH + pillarH / 2, s * (roofW / 2 - 0.02), s > 0 ? 0 : Math.PI, 0, 0),
        glassMat, G);
    }
    // windscreen + rear screen
    b.add(planeGeo(roofW - 0.16, (pillarH + 0.22) * 1.18, 1),
      M(c0 - 0.16, S.beltH + pillarH * 0.55, 0, -Math.PI / 2, 0.55, 0), glassMat, G);
    b.add(planeGeo(roofW - 0.2, (pillarH + 0.16) * 1.12, 1),
      M(c1 + 0.14, S.beltH + pillarH * 0.55, 0, Math.PI / 2, 0.5, 0), glassMat, G);

    if (S.boxBody) {
      // cargo box sides above the belt line
      const from = (S.boxFrom ?? 0) * L - L / 2;
      const bl = L / 2 - from;
      b.add(boxGeo(bl, S.roofH - S.beltH, W, 1.4), M(from + bl / 2, (S.roofH + S.beltH) / 2, 0), bodyMat, G);
      // corrugation ribs
      const ribs = Math.floor(bl / 0.55);
      for (let i = 0; i < ribs; i++) {
        for (const s of [-1, 1]) {
          b.add(boxGeo(0.05, S.roofH - S.beltH - 0.1, 0.04),
            M(from + 0.3 + i * 0.55, (S.roofH + S.beltH) / 2, s * (W / 2 + 0.02)), trimMat, G);
        }
      }
      b.add(boxGeo(bl, 0.09, W), M(from + bl / 2, S.roofH, 0), bodyMat, G);
      // rear doors
      b.add(boxGeo(0.08, S.roofH - bodyBottom - 0.2, W * 0.95), M(L / 2 - 0.04, (S.roofH + bodyBottom) / 2, 0), trimMat, G);
      for (const s of [-1, 1]) {
        b.add(boxGeo(0.05, S.roofH - bodyBottom - 0.4, 0.06), M(L / 2 + 0.02, (S.roofH + bodyBottom) / 2, s * W * 0.22), 'chrome', G);
      }
    }

    if (S.bus) {
      // long window band and doors
      for (const s of [-1, 1]) {
        for (let i = 0; i < 6; i++) {
          const wx = -L / 2 + 1.6 + i * 1.62;
          b.add(planeGeo(1.42, S.roofH - S.beltH - 0.35, 1),
            M(wx, S.beltH + (S.roofH - S.beltH) * 0.5, s * (W / 2 + 0.012), s > 0 ? 0 : Math.PI, 0, 0), glassMat, G);
          b.add(boxGeo(0.12, S.roofH - S.beltH - 0.3, 0.06), M(wx + 0.81, S.beltH + (S.roofH - S.beltH) * 0.5, s * (W / 2 + 0.02)), trimMat, G);
        }
      }
      // roof hatches and the destination sign
      for (let i = 0; i < 2; i++) {
        b.add(boxGeo(0.7, 0.1, 0.7), M(-2 + i * 4, S.roofH + 0.06, 0), trimMat, G);
      }
      b.add(boxGeo(0.06, 0.42, 1.6), M(-L / 2 + 0.05, S.roofH - 0.36, 0),
        this.materials.variant('metalDarkPainted', { color: 0x141518, emissive: 0x000000 }), G);
      // articulated door leaves
      for (const dx of [-L / 2 + 1.2, L / 2 - 3.4]) {
        b.add(boxGeo(1.0, S.roofH - bodyBottom - 0.3, 0.07), M(dx, (S.roofH + bodyBottom) / 2, -(W / 2 + 0.02)), trimMat, G);
      }
    }

    // --- bumpers, lights, grille ---------------------------------------
    const bumperY = bodyBottom + 0.22;
    b.add(boxGeo(0.22, 0.3, W * 1.01, 1), M(-L / 2 - 0.06, bumperY, 0), trimMat, G);
    b.add(boxGeo(0.22, 0.3, W * 1.01, 1), M(L / 2 + 0.06, bumperY, 0), trimMat, G);
    // grille
    b.add(boxGeo(0.07, 0.3, W * 0.62), M(-L / 2 - 0.02, bumperY + 0.34, 0), 'grate', G);

    const headMat = burnt ? trimMat : this.materials.variant('glassShop', { color: 0xcfd6dc, emissive: 0x000000, opacity: 0.85 });
    const tailLight = burnt ? trimMat : this.materials.variant('glassShop', { color: 0x8a1c14, emissive: 0x2a0806, opacity: 0.9 });
    for (const s of [-1, 1]) {
      const broken = damage > 0.55 && rng.bool(0.6);
      if (!broken) {
        b.add(boxGeo(0.08, 0.2, 0.42), M(-L / 2 - 0.03, bumperY + 0.36, s * (W * 0.34)), headMat, G);
      } else {
        b.add(boxGeo(0.1, 0.22, 0.44), M(-L / 2 - 0.03, bumperY + 0.36, s * (W * 0.34)), trimMat, G);
      }
      b.add(boxGeo(0.07, 0.24, 0.4), M(L / 2 + 0.03, bumperY + 0.4, s * (W * 0.34)), tailLight, G);
      // mirrors
      if (!S.bus) {
        b.add(boxGeo(0.12, 0.14, 0.24), M(c0 + 0.1, S.beltH + 0.16, s * (W / 2 + 0.16)), trimMat, G);
        b.add(boxGeo(0.05, 0.05, 0.16), M(c0 + 0.1, S.beltH + 0.14, s * (W / 2 + 0.05)), trimMat, G);
      }
    }

    // --- wheels + arches ------------------------------------------------
    const axles = S.bus ? [-L * 0.34, L * 0.22, L * 0.32] : [-L * 0.31, L * 0.31];
    for (const ax of axles) {
      for (const s of [-1, 1]) {
        const flat = damage > 0.45 && rng.bool(0.45);
        const wr = S.wheelR * (flat ? 0.88 : 1);
        const wz = s * (W / 2 - S.wheelW * 0.42);
        const wm = M(ax, -S.wheelR + wr, wz, 0, 0, Math.PI / 2, 1, flat ? 1.0 : 1, flat ? 0.82 : 1);
        b.instance(`veh.tyre.${wr.toFixed(2)}`, cylGeo(wr, wr, S.wheelW, 16), 'rubber', wm);
        b.instance(`veh.rim.${wr.toFixed(2)}`, cylGeo(wr * 0.58, wr * 0.58, S.wheelW + 0.02, 12), 'steelBare', wm);
        b.instance(`veh.hub.${wr.toFixed(2)}`, cylGeo(wr * 0.22, wr * 0.22, S.wheelW + 0.06, 8), 'chrome', wm);
        // wheel arch lip
        b.add(boxGeo(wr * 2.5, 0.09, 0.1), M(ax, bodyBottom + wr * 0.95, s * (W / 2 + 0.01)), trimMat, G);
        // arch liner darkness
        b.add(boxGeo(wr * 2.2, wr * 0.9, 0.06), M(ax, bodyBottom + wr * 0.5, s * (W / 2 - 0.05)),
          this.materials.variant('rubber', { color: 0x0a0b0c }), G);
      }
    }

    // --- class-specific dressing ---------------------------------------
    if (S.taxi) this._taxiKit(b, M, S, rng, burnt, damage, G);
    if (S.lightbar) this._lightbar(b, M, S, cls, rng, burnt, G);
    if (cls === 'police') this._policeKit(b, M, S, rng, burnt, G);
    if (cls === 'ambulance') this._ambulanceKit(b, M, S, rng, burnt, G);
    if (S.utility) this._utilityKit(b, M, S, rng, G);

    // --- damage ---------------------------------------------------------
    if (damage > 0.3) {
      // crumpled panels: overlapping skewed plates read as deformation
      const n = Math.floor(damage * 5);
      for (let i = 0; i < n; i++) {
        const lx = rng.range(-L / 2, L / 2);
        const s = rng.bool() ? 1 : -1;
        b.add(boxGeo(rng.range(0.3, 0.9), rng.range(0.2, 0.5), 0.09),
          M(lx, rng.range(bodyBottom + 0.3, S.beltH), s * (W / 2 + 0.01), 0, rng.sym(0.5), rng.sym(0.6)),
          burnt ? trimMat : bodyMat, G);
      }
      // bonnet sprung open
      if (rng.bool(0.4) && !S.boxBody) {
        b.add(boxGeo(L * 0.22, 0.06, W * 0.9), M(-L * 0.3, S.noseH + 0.3, 0, 0, -0.65, 0), bodyMat, G);
      }
    }
    if (opts.doorsOpen || (damage > 0.4 && rng.bool(0.35))) {
      const s = rng.bool() ? 1 : -1;
      const dm = M(c0 + 0.4, S.beltH * 0.5 + 0.1, s * (W / 2), 0, 0, 0);
      dm.multiply(new THREE.Matrix4().makeRotationY(s * -1.1));
      dm.multiply(new THREE.Matrix4().makeTranslation(0.55, 0, 0));
      b.add(boxGeo(1.1, S.beltH - bodyBottom - 0.1, 0.09), dm, bodyMat, G);
      const gm = dm.clone();
      gm.multiply(new THREE.Matrix4().makeTranslation(0, S.beltH * 0.55, 0));
      b.add(planeGeo(0.95, pillarH * 0.85, 1), gm, glassMat, G);
    }
    if (burnt) {
      this.world.smokeSources.push({ x, y: rootY + S.H * 0.6, z, rate: 0.32, scale: 1.15, kind: 'vehicle' });
    }
    // Glass on the ground beside every wrecked vehicle.
    if (damage > 0.5) {
      for (let i = 0; i < 3; i++) {
        const a = rng.next() * TAU, r = rng.range(1, 2.6);
        const gx = x + Math.cos(a) * r, gz = z + Math.sin(a) * r;
        const m = mat4(gx, roadHeight(gx, gz) + 0.014, gz, rng.next() * TAU);
        m.multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
        b.instance('veh.glassdrop', planeGeo(rng.range(0.6, 1.6), rng.range(0.5, 1.2), 1),
          this.materials.variant('glassBroken', { opacity: 0.4 }), m);
      }
    }

    // --- collision + cover ----------------------------------------------
    const ch = roll ? W / 2 : S.H / 2;
    const cy = roll ? ground + W / 2 : ground + S.H / 2;
    this.phys.addBox(x, cy, z, (roll ? S.H : L) / 2, ch, (roll ? L : W) / 2 * (roll ? 1 : 1), yaw, 'metal', 1 | 2);
    this.world.coverPoints.push({
      x, z, height: ground + (roll ? W : S.H), quality: S.H > 2 ? 1.0 : 0.9,
      kind: 'vehicle', yaw, length: L, width: W,
    });
    this.count++;
  }

  /* ------------------------------ kits ---------------------------------- */

  _taxiKit(b, M, S, rng, burnt, damage, G) {
    if (!this._taxiSide) {
      const { canvas, c } = ctx2d(512, 128, { alpha: false });
      c.fillStyle = '#d8a11a';
      c.fillRect(0, 0, 512, 128);
      c.fillStyle = '#16181b';
      c.fillRect(0, 44, 512, 40);
      c.font = `bold 34px ${FONT_CONDENSED}`;
      c.fillStyle = '#d8a11a';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('METRO CAB  ·  555-0100', 256, 64);
      c.fillStyle = '#16181b';
      c.font = `bold 22px ${FONT_CONDENSED}`;
      c.fillText('LICENSED', 84, 106);
      c.fillText('4A-72', 428, 106);
      this._taxiSide = this.materials.std({ map: canvasToTexture(canvas), roughness: 0.7, metalness: 0.3 });
    }
    const L = S.L, W = S.W;
    // roof light box
    const rm = M(-S.L * 0.02, S.roofH + 0.13, 0);
    b.add(boxGeo(0.86, 0.2, 0.3), rm, burnt ? this.materials.get('vehicleBurnt')
      : this.materials.variant('metalPainted', { color: 0xd8a11a }), G);
    b.add(boxGeo(0.7, 0.14, 0.22), M(-S.L * 0.02, S.roofH + 0.14, 0),
      burnt ? this.materials.get('vehicleBurnt')
        : this.materials.variant('glassShop', { color: 0xe8c65a, emissive: 0x000000, opacity: 0.9 }), G);
    // door livery
    if (!burnt) {
      for (const s of [-1, 1]) {
        b.add(planeGeo(1.9, 0.44, 1), M(0, S.beltH - 0.36, s * (W / 2 + 0.015), s > 0 ? 0 : Math.PI, 0, 0),
          this._taxiSide, G);
      }
    }
    // partition + meter suggested behind the windscreen
    b.add(boxGeo(0.05, 0.5, W * 0.78), M(-S.L * 0.02, S.beltH + 0.28, 0), 'grate', G);
  }

  _lightbar(b, M, S, cls, rng, burnt, G) {
    const y = S.roofH + 0.11;
    b.add(boxGeo(1.35, 0.14, 0.28), M(-S.L * 0.04, y, 0), 'metalDarkPainted', G);
    const red = this.materials.variant('glassShop', { color: 0x6a1410, emissive: 0x1a0402, opacity: 0.9 });
    const blue = this.materials.variant('glassShop', { color: 0x14204a, emissive: 0x02061a, opacity: 0.9 });
    for (let i = 0; i < 4; i++) {
      const lx = -S.L * 0.04 - 0.5 + i * 0.33;
      b.add(boxGeo(0.28, 0.11, 0.24), M(lx, y + 0.01, 0), i % 2 ? blue : red, G);
    }
    for (const s of [-1, 1]) {
      b.add(boxGeo(0.06, 0.1, 0.06), M(-S.L * 0.04 + s * 0.7, y - 0.09, 0), 'metalDarkPainted', G);
    }
  }

  _policeKit(b, M, S, rng, burnt, G) {
    if (burnt) return;
    const W = S.W;
    const white = this.materials.variant('vehiclePaint', { color: 0xd6d2c8 });
    for (const s of [-1, 1]) {
      b.add(boxGeo(S.L * 0.55, 0.42, 0.02), M(0, S.beltH - 0.34, s * (W / 2 + 0.012)), white, G);
    }
    // push bar
    b.add(boxGeo(0.09, 0.5, W * 0.9), M(-S.L / 2 - 0.18, S.beltH - 0.42, 0), 'steelBare', G);
    for (const s of [-1, 1]) {
      b.add(boxGeo(0.4, 0.08, 0.08), M(-S.L / 2 - 0.06, S.beltH - 0.28, s * W * 0.3), 'steelBare', G);
    }
    // spotlight on the A-pillar
    b.add(cylGeo(0.09, 0.09, 0.16, 10), M(S.roofFrac[0] * S.L - S.L / 2, S.beltH + 0.2, -(W / 2 + 0.1), 0, 0, Math.PI / 2), 'chrome', G);
  }

  _ambulanceKit(b, M, S, rng, burnt, G) {
    if (burnt) return;
    const W = S.W, L = S.L;
    const stripe = this.materials.variant('vehiclePaint', { color: 0x9c2620 });
    for (const s of [-1, 1]) {
      b.add(boxGeo(L * 0.6, 0.3, 0.02), M(L * 0.1, S.beltH + 0.5, s * (W / 2 + 0.014)), stripe, G);
    }
    // rear step bumper and grab rails
    b.add(boxGeo(0.4, 0.12, W * 0.9), M(L / 2 + 0.2, -S.wheelR + 0.45, 0), 'grate', G);
    for (const s of [-1, 1]) {
      b.add(cylGeo(0.025, 0.025, 1.6, 6), M(L / 2 + 0.06, S.roofH * 0.55, s * W * 0.42), 'chrome', G);
    }
    // roof AC and beacons
    b.add(boxGeo(0.9, 0.28, 1.0), M(L * 0.2, S.roofH + 0.14, 0), 'galvanized', G);
  }

  _utilityKit(b, M, S, rng, G) {
    const L = S.L, W = S.W;
    // flatbed with tool lockers and a small crane stub
    b.add(boxGeo(L * 0.5, 0.14, W), M(L * 0.18, S.beltH + 0.1, 0), 'steelBare', G);
    for (const s of [-1, 1]) {
      b.add(boxGeo(L * 0.5, 0.55, 0.12), M(L * 0.18, S.beltH + 0.4, s * (W / 2 - 0.06)), 'metalPainted', G);
      for (let i = 0; i < 3; i++) {
        b.add(boxGeo(0.7, 0.5, 0.35), M(L * 0.02 + i * 0.8, S.beltH + 0.38, s * (W / 2 - 0.28)), 'metalPainted', G);
      }
    }
    b.add(cylGeo(0.09, 0.11, 1.9, 8), M(L * 0.42, S.beltH + 1.0, 0), 'metalRust', G);
    b.add(boxGeo(1.6, 0.12, 0.12), M(L * 0.42, S.beltH + 1.9, 0, 0, 0.3, 0), 'metalRust', G);
    // traffic cones in the bed
    for (let i = 0; i < 4; i++) {
      b.instance('veh.cone', coneGeo(0.16, 0.5, 8), this.materials.variant('rubber', { color: 0xa8461c }),
        M(L * 0.05 + i * 0.35, S.beltH + 0.42, rng.sym(0.4)));
    }
  }
}
