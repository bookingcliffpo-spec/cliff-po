import * as THREE from 'three';
import { boxGeo, unitBox, cylGeo, planeGeo, sphereGeo, torusGeo, coneGeo, mat4 } from './batcher.js';
import { TAU, lerp, clamp01 } from '../core/math.js';

/**
 * The NYC identity kit: fire escapes, rooftop water tanks, sidewalk sheds,
 * HVAC, parapets, storefront bays. These are what make the block read as
 * New York with every sign switched off.
 */

/* ================================================================== *
 *  FIRE ESCAPE
 * ================================================================== */

const FE = {
  platformDepth: 1.15,
  platformW: 3.1,
  railH: 0.95,
  balusterEvery: 0.16,
};

/**
 * Bolt a fire escape onto a facade.
 * `nx,nz` is the outward facade normal; `x,z` the wall surface point at its centre.
 */
export function fireEscape(b, phys, rng, opts) {
  const { x, z, nx, nz, baseY, floors, floorH } = opts;
  const yaw = Math.atan2(nx, nz);
  const W = opts.width || FE.platformW;
  const D = FE.platformDepth;
  const out = D / 2 + 0.06;   // platform centre stands off the wall

  const M = (px, py, pz, sx, sy, sz) => {
    // px = along-wall, py = up, pz = out from wall
    const wx = x + nx * pz - nz * px;
    const wz = z + nz * pz + nx * px;
    return mat4(wx, py, wz, yaw, 0, 0, sx, sy, sz);
  };

  const grate = 'grate';
  const metal = 'fireEscape';

  for (let f = 0; f < floors; f++) {
    const py = baseY + floorH * (f + 1);

    // --- platform deck (open grating, casts a beautiful striped shadow) ---
    b.instance('fe.deck', planeGeo(W, D, 0.35), grate,
      (() => {
        const m = M(0, py, out, 1, 1, 1);
        m.multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
        return m;
      })());
    // deck edge angle iron
    b.instance('fe.edge', boxGeo(W, 0.09, 0.05), metal, M(0, py + 0.045, out + D / 2 - 0.025, 1, 1, 1));
    b.instance('fe.edge', boxGeo(W, 0.09, 0.05), metal, M(0, py + 0.045, out - D / 2 + 0.025, 1, 1, 1));
    b.instance('fe.edgeS', boxGeo(0.05, 0.09, D), metal, M(-W / 2 + 0.025, py + 0.045, out, 1, 1, 1));
    b.instance('fe.edgeS', boxGeo(0.05, 0.09, D), metal, M(W / 2 - 0.025, py + 0.045, out, 1, 1, 1));

    // --- support brackets back to the wall ---
    for (const sx of [-W / 2 + 0.25, 0, W / 2 - 0.25]) {
      const m = M(sx, py - 0.34, out - 0.05, 1, 1, 1);
      m.multiply(new THREE.Matrix4().makeRotationX(-0.62));
      b.instance('fe.brace', boxGeo(0.055, 1.05, 0.055), metal, m);
    }
    b.instance('fe.wallplate', boxGeo(W, 0.1, 0.08), metal, M(0, py - 0.05, 0.05, 1, 1, 1));

    // --- railings ---
    const railY = py + FE.railH;
    b.instance('fe.rail', boxGeo(W, 0.05, 0.05), metal, M(0, railY, out + D / 2 - 0.03, 1, 1, 1));
    b.instance('fe.rail2', boxGeo(W, 0.032, 0.032), metal, M(0, py + FE.railH * 0.52, out + D / 2 - 0.03, 1, 1, 1));
    b.instance('fe.railS', boxGeo(0.05, 0.05, D), metal, M(-W / 2 + 0.03, railY, out, 1, 1, 1));
    b.instance('fe.railS', boxGeo(0.05, 0.05, D), metal, M(W / 2 - 0.03, railY, out, 1, 1, 1));

    const nBal = Math.floor(W / FE.balusterEvery);
    for (let i = 0; i <= nBal; i++) {
      const px = -W / 2 + (i / nBal) * W;
      b.instance('fe.bal', boxGeo(0.022, FE.railH, 0.022), metal, M(px, py + FE.railH / 2, out + D / 2 - 0.03, 1, 1, 1));
    }
    // side balusters
    for (let i = 0; i <= 6; i++) {
      const pz = out - D / 2 + (i / 6) * D;
      b.instance('fe.balS', boxGeo(0.022, FE.railH, 0.022), metal, M(-W / 2 + 0.03, py + FE.railH / 2, pz, 1, 1, 1));
      b.instance('fe.balS', boxGeo(0.022, FE.railH, 0.022), metal, M(W / 2 - 0.03, py + FE.railH / 2, pz, 1, 1, 1));
    }
    // corner posts
    for (const sx of [-W / 2 + 0.03, W / 2 - 0.03]) {
      for (const pz of [out - D / 2 + 0.03, out + D / 2 - 0.03]) {
        b.instance('fe.post', boxGeo(0.05, FE.railH + 0.06, 0.05), metal, M(sx, py + FE.railH / 2, pz, 1, 1, 1));
      }
    }

    // --- ladder up to the next platform, alternating sides ---
    if (f < floors - 1) {
      const side = (f % 2 === 0) ? -1 : 1;
      const lx = side * (W / 2 - 0.42);
      const lz = out + D / 2 - 0.3;
      const lh = floorH;
      const lean = 0.16;
      const mk = (dx) => {
        const m = M(lx + dx, py + lh / 2, lz - lean * 0.5, 1, 1, 1);
        m.multiply(new THREE.Matrix4().makeRotationX(lean));
        return m;
      };
      b.instance('fe.stringer', boxGeo(0.04, lh, 0.05), metal, mk(-0.21));
      b.instance('fe.stringer', boxGeo(0.04, lh, 0.05), metal, mk(0.21));
      const rungs = Math.floor(lh / 0.3);
      for (let r = 1; r < rungs; r++) {
        const ry = py + (r / rungs) * lh;
        const m = M(lx, ry, lz - lean * ((r / rungs) - 0.5) * lh, 1, 1, 1);
        b.instance('fe.rung', boxGeo(0.44, 0.022, 0.022), metal, m);
      }
    }
  }

  // --- drop ladder hanging over the sidewalk, counterweighted ---
  const dropTop = baseY + floorH;
  const dropLen = rng.range(2.4, 3.4);
  const dside = -1;
  const dx = dside * (W / 2 - 0.42);
  const dz = out + D / 2 - 0.22;
  b.instance('fe.dstr', boxGeo(0.04, dropLen, 0.05), metal, M(dx - 0.21, dropTop - dropLen / 2, dz, 1, 1, 1));
  b.instance('fe.dstr', boxGeo(0.04, dropLen, 0.05), metal, M(dx + 0.21, dropTop - dropLen / 2, dz, 1, 1, 1));
  const dr = Math.floor(dropLen / 0.3);
  for (let r = 0; r < dr; r++) {
    b.instance('fe.rung', boxGeo(0.44, 0.022, 0.022), metal, M(dx, dropTop - dropLen + (r + 0.5) * 0.3, dz, 1, 1, 1));
  }

  // Fire escapes are cover and a landmark, so give the lowest run a collider.
  const wx = x + nx * out, wz = z + nz * out;
  phys.addBox(wx, baseY + floorH * 1.5, wz, W / 2, floorH * floors * 0.5, D / 2, yaw, 'metal', 1 | 2);
}

/* ================================================================== *
 *  ROOFTOP WATER TANK
 * ================================================================== */

export function waterTower(b, phys, rng, x, roofY, z, scale = 1) {
  const legH = rng.range(2.6, 4.2) * scale;
  const r = rng.range(1.55, 2.05) * scale;
  const bodyH = rng.range(3.0, 4.0) * scale;
  const yaw = rng.next() * TAU;
  const baseY = roofY;

  // steel frame: four splayed legs + two levels of cross bracing
  const legR = r * 0.82;
  const legs = [];
  for (let i = 0; i < 4; i++) {
    const a = yaw + i * (TAU / 4) + TAU / 8;
    const lx = x + Math.cos(a) * legR, lz = z + Math.sin(a) * legR;
    legs.push([lx, lz, a]);
    const m = mat4(lx, baseY + legH / 2, lz, a, 0, 0);
    b.instance('wt.leg', boxGeo(0.13 * scale, legH, 0.13 * scale), 'fireEscape', m);
    // footing pad
    b.instance('wt.pad', boxGeo(0.4 * scale, 0.12, 0.4 * scale), 'concreteDark', mat4(lx, baseY + 0.06, lz, a));
  }
  for (let lvl = 0; lvl < 2; lvl++) {
    const ly = baseY + legH * (0.34 + lvl * 0.42);
    for (let i = 0; i < 4; i++) {
      const a = legs[i], bnd = legs[(i + 1) % 4];
      const mx = (a[0] + bnd[0]) / 2, mz = (a[1] + bnd[1]) / 2;
      const len = Math.hypot(bnd[0] - a[0], bnd[1] - a[1]);
      const ang = Math.atan2(bnd[0] - a[0], bnd[1] - a[1]);
      b.instance('wt.brace', boxGeo(0.07 * scale, 0.07 * scale, len), 'fireEscape', mat4(mx, ly, mz, ang));
      // diagonal
      const m = mat4(mx, ly + legH * 0.2, mz, ang);
      m.multiply(new THREE.Matrix4().makeRotationX(0.5));
      b.instance('wt.diag', boxGeo(0.045 * scale, 0.045 * scale, len * 1.12), 'fireEscape', m);
    }
  }

  const tankY = baseY + legH + bodyH / 2;

  // slatted cedar body — very slight taper, staves read in the normal map
  const bodyGeo = cylGeo(r, r * 1.03, bodyH, 20, true);
  b.instance('wt.body', bodyGeo, 'waterTankWood', mat4(x, tankY, z, yaw));
  // steel hoops
  for (let i = 0; i < 4; i++) {
    const hy = baseY + legH + bodyH * (0.1 + i * 0.27);
    b.instance('wt.hoop', torusGeo(r * 1.012, 0.035 * scale, 6, 24),
      'fireEscape', (() => { const m = mat4(x, hy, z, yaw); m.multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)); return m; })());
  }
  // floor of the tank so you cannot see through it from below
  b.instance('wt.floor', cylGeo(r, r, 0.12, 20), 'waterTankWood', mat4(x, baseY + legH + 0.06, z, yaw));
  // conical roof + finial
  b.instance('wt.roof', coneGeo(r * 1.12, r * 0.68, 20), 'waterTankWood',
    mat4(x, baseY + legH + bodyH + r * 0.32, z, yaw));
  b.instance('wt.finial', cylGeo(0.07, 0.07, 0.5, 8), 'fireEscape', mat4(x, baseY + legH + bodyH + r * 0.68, z));

  // downpipe running to the roof deck
  b.instance('wt.pipe', cylGeo(0.09 * scale, 0.09 * scale, legH + bodyH * 0.4, 8), 'fireEscape',
    mat4(x + r * 0.95, baseY + (legH + bodyH * 0.4) / 2, z, yaw));
  // access ladder
  const lh = legH + bodyH * 0.9;
  const lx2 = x - r * 1.05, lz2 = z;
  b.instance('wt.lstr', boxGeo(0.035, lh, 0.04), 'fireEscape', mat4(lx2, baseY + lh / 2, lz2 - 0.19));
  b.instance('wt.lstr', boxGeo(0.035, lh, 0.04), 'fireEscape', mat4(lx2, baseY + lh / 2, lz2 + 0.19));
  for (let i = 0; i < Math.floor(lh / 0.31); i++) {
    b.instance('wt.lrung', boxGeo(0.02, 0.02, 0.4), 'fireEscape', mat4(lx2, baseY + 0.3 + i * 0.31, lz2));
  }

  if (phys) phys.addBox(x, tankY, z, r, bodyH / 2 + legH / 2, r, 0, 'wood', 1 | 2);
  return { x, z, top: baseY + legH + bodyH + r * 0.68 };
}

/* ================================================================== *
 *  ROOFTOP MECHANICAL
 * ================================================================== */

export function rooftopKit(b, phys, rng, lot, roofY) {
  const cx = lot.cx, cz = lot.cz;
  const halfW = lot.w / 2 - 1.6, halfD = lot.d / 2 - 1.6;
  const place = () => [cx + rng.sym(halfW), cz + rng.sym(halfD)];

  // Stair bulkhead — every NYC roof has one and it makes a great silhouette.
  {
    const w = rng.range(2.4, 3.6), d = rng.range(2.2, 3.2), h = rng.range(2.4, 3.1);
    const [x, z] = [cx + rng.sym(halfW * 0.6), cz + rng.sym(halfD * 0.6)];
    b.box(w, h, d, x, roofY + h / 2, z, rng.bool(0.5) ? 'brickDark' : 'concreteDark', 0, 'roof', 2.2);
    b.box(w + 0.24, 0.14, d + 0.24, x, roofY + h + 0.07, z, 'concreteDark', 0, 'roof', 2);
    // door
    b.box(0.9, 2.0, 0.08, x, roofY + 1.0, z + d / 2 + 0.03, 'metalDarkPainted', 0, 'roof', 1);
    if (phys) phys.addBox(x, roofY + h / 2, z, w / 2, h / 2, d / 2, 0, 'concrete', 1 | 2);
  }

  // HVAC packages
  const nHvac = rng.int(2, 5);
  for (let i = 0; i < nHvac; i++) {
    const [x, z] = place();
    const w = rng.range(1.3, 2.6), d = rng.range(1.0, 1.9), h = rng.range(0.8, 1.5);
    const yaw = rng.next() * TAU;
    b.instance('rk.hvac', boxGeo(w, h, d, 1.2), 'galvanized', mat4(x, roofY + h / 2 + 0.1, z, yaw));
    b.instance('rk.hvacBase', boxGeo(w + 0.2, 0.2, d + 0.2), 'concreteDark', mat4(x, roofY + 0.1, z, yaw));
    // fan cowl
    b.instance('rk.cowl', cylGeo(d * 0.32, d * 0.32, 0.22, 12), 'metalPainted', mat4(x + w * 0.2, roofY + h + 0.22, z, yaw));
    b.instance('rk.grille', cylGeo(d * 0.3, d * 0.3, 0.04, 12), 'grate', mat4(x + w * 0.2, roofY + h + 0.34, z, yaw));
    if (phys) phys.addBox(x, roofY + h / 2 + 0.1, z, w / 2, h / 2, d / 2, yaw, 'metal', 1 | 2);
  }

  // Mushroom vents and pipe stacks
  for (let i = 0; i < rng.int(3, 8); i++) {
    const [x, z] = place();
    const h = rng.range(0.5, 1.4);
    b.instance('rk.vpipe', cylGeo(0.11, 0.11, h, 8), 'galvanized', mat4(x, roofY + h / 2, z));
    b.instance('rk.vcap', cylGeo(0.24, 0.16, 0.16, 10), 'galvanized', mat4(x, roofY + h + 0.08, z));
  }
  // Brick chimney flue
  if (rng.bool(0.55)) {
    const [x, z] = place();
    const h = rng.range(1.6, 3.2);
    b.box(0.8, h, 0.8, x, roofY + h / 2, z, 'brickDark', 0, 'roof', 1.6);
    b.box(1.0, 0.12, 1.0, x, roofY + h + 0.06, z, 'concreteDark', 0, 'roof', 1);
  }
  // Satellite dishes and antennas
  for (let i = 0; i < rng.int(1, 4); i++) {
    const [x, z] = place();
    const h = rng.range(0.7, 1.3);
    b.instance('rk.mast', cylGeo(0.035, 0.035, h, 6), 'galvanized', mat4(x, roofY + h / 2, z));
    if (rng.bool(0.6)) {
      const m = mat4(x, roofY + h, z, rng.next() * TAU, -0.6, 0);
      b.instance('rk.dish', sphereGeo(0.34, 12, 8, TAU, 0, 0.9), 'metalPainted', m);
    } else {
      for (let k = 0; k < 4; k++) {
        b.instance('rk.ant', boxGeo(0.5 - k * 0.08, 0.018, 0.018), 'galvanized', mat4(x, roofY + h * (0.55 + k * 0.14), z, rng.next() * TAU));
      }
    }
  }
  // Utility boxes and conduit
  for (let i = 0; i < rng.int(1, 3); i++) {
    const [x, z] = place();
    b.instance('rk.ubox', boxGeo(0.55, 0.75, 0.3, 0.9), 'metalPainted', mat4(x, roofY + 0.38, z, rng.next() * TAU));
  }
}

/* ================================================================== *
 *  PARAPET + CORNICE
 * ================================================================== */

export function parapet(b, phys, lot, roofY, material, h = 1.0, corniceMat = null) {
  const { x0, x1, z0, z1 } = lot;
  const t = 0.34;
  const mid = roofY + h / 2;
  const w = x1 - x0, d = z1 - z0;
  b.box(w, h, t, (x0 + x1) / 2, mid, z0 + t / 2, material, 0, 'roof', 2);
  b.box(w, h, t, (x0 + x1) / 2, mid, z1 - t / 2, material, 0, 'roof', 2);
  b.box(t, h, d - t * 2, x0 + t / 2, mid, (z0 + z1) / 2, material, 0, 'roof', 2);
  b.box(t, h, d - t * 2, x1 - t / 2, mid, (z0 + z1) / 2, material, 0, 'roof', 2);
  // stone coping
  const cm = corniceMat || 'limestone';
  const ct = t + 0.14;
  b.box(w + 0.14, 0.12, ct, (x0 + x1) / 2, roofY + h + 0.06, z0 + t / 2, cm, 0, 'roof', 1.5);
  b.box(w + 0.14, 0.12, ct, (x0 + x1) / 2, roofY + h + 0.06, z1 - t / 2, cm, 0, 'roof', 1.5);
  b.box(ct, 0.12, d, x0 + t / 2, roofY + h + 0.06, (z0 + z1) / 2, cm, 0, 'roof', 1.5);
  b.box(ct, 0.12, d, x1 - t / 2, roofY + h + 0.06, (z0 + z1) / 2, cm, 0, 'roof', 1.5);

  if (phys) {
    phys.addBox((x0 + x1) / 2, mid, z0 + t / 2, w / 2, h / 2, t / 2, 0, 'concrete', 1 | 2);
    phys.addBox((x0 + x1) / 2, mid, z1 - t / 2, w / 2, h / 2, t / 2, 0, 'concrete', 1 | 2);
    phys.addBox(x0 + t / 2, mid, (z0 + z1) / 2, t / 2, h / 2, d / 2, 0, 'concrete', 1 | 2);
    phys.addBox(x1 - t / 2, mid, (z0 + z1) / 2, t / 2, h / 2, d / 2, 0, 'concrete', 1 | 2);
  }
}

/**
 * Projecting cornice band — the single detail that most separates a pre-war
 * building from a box.
 */
export function cornice(b, lot, y, material, proj = 0.42, h = 0.55) {
  const { x0, x1, z0, z1 } = lot;
  const w = x1 - x0, d = z1 - z0;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  // three stepped courses
  for (let i = 0; i < 3; i++) {
    const p = proj * (0.35 + i * 0.33);
    const hh = h / 3;
    const yy = y + hh * (i + 0.5);
    b.box(w + p * 2, hh, d + p * 2, cx, yy, cz, material, 0, 'facade', 1.4);
  }
  // dentil course
  const n = Math.max(4, Math.floor(w / 0.42));
  for (let i = 0; i < n; i++) {
    const dx = x0 + (i + 0.5) * (w / n);
    b.instance('cor.dentil', boxGeo(0.18, 0.16, 0.2), material, mat4(dx, y - 0.1, z0 - proj * 0.5));
    b.instance('cor.dentil', boxGeo(0.18, 0.16, 0.2), material, mat4(dx, y - 0.1, z1 + proj * 0.5));
  }
  const nd = Math.max(4, Math.floor(d / 0.42));
  for (let i = 0; i < nd; i++) {
    const dz = z0 + (i + 0.5) * (d / nd);
    b.instance('cor.dentilS', boxGeo(0.2, 0.16, 0.18), material, mat4(x0 - proj * 0.5, y - 0.1, dz));
    b.instance('cor.dentilS', boxGeo(0.2, 0.16, 0.18), material, mat4(x1 + proj * 0.5, y - 0.1, dz));
  }
}

/* ================================================================== *
 *  SIDEWALK SHED (scaffolding)
 * ================================================================== */

export function sidewalkShed(b, phys, rng, opts) {
  const { x, z, len, yaw, width } = opts;
  const H = 3.9;
  const w = width || 3.6;
  const postEvery = 2.4;
  const n = Math.max(2, Math.round(len / postEvery));
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const P = (a, o) => [x + c * a - s * o, z + s * a + c * o];

  for (let i = 0; i <= n; i++) {
    const a = -len / 2 + (i / n) * len;
    for (const o of [-w / 2, w / 2]) {
      const [px, pz] = P(a, o);
      b.instance('sh.post', cylGeo(0.06, 0.06, H, 8), 'galvanized', mat4(px, H / 2, pz));
      b.instance('sh.base', boxGeo(0.3, 0.06, 0.3), 'steelBare', mat4(px, 0.03, pz));
      if (phys) phys.addBox(px, H / 2, pz, 0.1, H / 2, 0.1, 0, 'metal', 1);
    }
    // cross bracing between bays
    if (i < n) {
      const a2 = -len / 2 + ((i + 0.5) / n) * len;
      for (const o of [-w / 2, w / 2]) {
        const [px, pz] = P(a2, o);
        const m = mat4(px, H * 0.55, pz, yaw);
        m.multiply(new THREE.Matrix4().makeRotationZ(rng.bool() ? 0.85 : -0.85));
        b.instance('sh.brace', boxGeo(0.045, postEvery * 1.35, 0.045), 'galvanized', m);
      }
    }
  }
  // ledgers
  for (const o of [-w / 2, w / 2]) {
    for (const hy of [H - 0.12, H * 0.52]) {
      const [px, pz] = P(0, o);
      b.instance(`sh.ledger${o > 0 ? 'a' : 'b'}`, boxGeo(len, 0.07, 0.07), 'galvanized', mat4(px, hy, pz, yaw));
    }
  }
  // deck + plywood parapet on the outer edge
  const [dx, dz] = P(0, 0);
  b.instance('sh.deck', boxGeo(len, 0.1, w), 'scaffoldPlank', mat4(dx, H - 0.05, dz, yaw));
  const [ox, oz] = P(0, w / 2);
  b.instance('sh.para', boxGeo(len, 0.9, 0.06), 'plywood', mat4(ox, H + 0.4, oz, yaw));
  // underside lighting strip — sheds are always lit, day and night
  b.instance('sh.light', boxGeo(len * 0.9, 0.06, 0.14), 'metalPainted', mat4(dx, H - 0.16, dz, yaw));

  if (phys) {
    phys.addBox(dx, H, dz, len / 2, 0.12, w / 2, yaw, 'wood', 1 | 2);
    phys.addBox(ox, H + 0.4, oz, len / 2, 0.45, 0.06, yaw, 'wood', 1 | 2);
  }
  return { height: H };
}

/** Free-standing pipe scaffolding climbing a facade under repair. */
export function facadeScaffold(b, phys, rng, opts) {
  const { x, z, nx, nz, len, height } = opts;
  const yaw = Math.atan2(nx, nz);
  const lifts = Math.max(2, Math.round(height / 2.0));
  const bays = Math.max(2, Math.round(len / 2.4));
  const depth = 1.15;
  const P = (a, o) => [x + nx * o - nz * a, z + nz * o + nx * a];

  for (let i = 0; i <= bays; i++) {
    const a = -len / 2 + (i / bays) * len;
    for (const o of [0.28, depth]) {
      const [px, pz] = P(a, o);
      b.instance('fs.post', cylGeo(0.05, 0.05, height, 6), 'galvanized', mat4(px, height / 2, pz));
    }
  }
  for (let l = 1; l <= lifts; l++) {
    const ly = (l / lifts) * height;
    for (const o of [0.28, depth]) {
      const [px, pz] = P(0, o);
      b.instance('fs.ledger', boxGeo(0.05, 0.05, len), 'galvanized', mat4(px, ly, pz, yaw + Math.PI / 2));
    }
    // plank deck every lift
    const [dx, dz] = P(0, (0.28 + depth) / 2);
    b.instance('fs.deck', boxGeo(len, 0.06, depth - 0.28), 'scaffoldPlank', mat4(dx, ly + 0.04, dz, yaw + Math.PI / 2));
    // toe board
    const [tx, tz] = P(0, depth);
    b.instance('fs.toe', boxGeo(len, 0.22, 0.03), 'scaffoldPlank', mat4(tx, ly + 0.15, tz, yaw + Math.PI / 2));
    if (phys) phys.addBox(dx, ly, dz, len / 2, 0.08, (depth - 0.28) / 2, yaw + Math.PI / 2, 'wood', 1 | 2);
    // diagonal
    for (let i = 0; i < bays; i++) {
      const a2 = -len / 2 + ((i + 0.5) / bays) * len;
      const [px, pz] = P(a2, depth);
      const m = mat4(px, ly - height / lifts / 2, pz, yaw);
      m.multiply(new THREE.Matrix4().makeRotationZ(i % 2 ? 0.75 : -0.75));
      b.instance('fs.diag', boxGeo(0.04, 2.9, 0.04), 'galvanized', m);
    }
  }
  // torn safety netting
  const [ndx, ndz] = P(0, depth + 0.06);
  b.instance('fs.net', planeGeo(len, height * 0.7, 1), 'grate',
    (() => { const m = mat4(ndx, height * 0.45, ndz, yaw); return m; })());
}

/* ================================================================== *
 *  MISC FACADE FURNITURE
 * ================================================================== */

/** Through-wall air conditioner poking out of an apartment window. */
export function windowAC(b, x, y, z, nx, nz) {
  const yaw = Math.atan2(nx, nz);
  const ox = x + nx * 0.24, oz = z + nz * 0.24;
  b.instance('ac.body', boxGeo(0.66, 0.42, 0.5, 0.7), 'galvanized', mat4(ox, y, oz, yaw));
  b.instance('ac.grille', planeGeo(0.6, 0.36, 0.4), 'grate', mat4(x + nx * 0.5, y, z + nz * 0.5, yaw));
  b.instance('ac.brkt', boxGeo(0.05, 0.3, 0.34), 'fireEscape', mat4(x + nx * 0.34, y - 0.32, z + nz * 0.34, yaw));
}

/** Retractable canvas awning over a shop window. */
export function awning(b, phys, rng, opts) {
  const { x, y, z, nx, nz, width, mat } = opts;
  const yaw = Math.atan2(nx, nz);
  const proj = rng.range(1.1, 1.7);
  const drop = rng.range(0.32, 0.5);
  const collapsed = rng.bool(0.28);
  const p = collapsed ? proj * 0.35 : proj;
  const cx = x + nx * (p / 2), cz = z + nz * (p / 2);
  const tilt = collapsed ? -0.85 : -0.32;
  const m = mat4(cx, y - drop * 0.4, cz, yaw);
  m.multiply(new THREE.Matrix4().makeRotationX(tilt));
  b.instance(`awn.${mat}`, boxGeo(width, 0.05, p * 1.12), mat, m);
  // valance
  const vx = x + nx * p, vz = z + nz * p;
  b.instance(`awn.val.${mat}`, boxGeo(width, drop, 0.04), mat, mat4(vx, y - drop * 0.72, vz, yaw));
  // frame arms
  for (const s of [-1, 1]) {
    const ax = x + nx * (p / 2) - nz * s * (width / 2 - 0.06);
    const az = z + nz * (p / 2) + nx * s * (width / 2 - 0.06);
    const am = mat4(ax, y - drop * 0.4, az, yaw);
    am.multiply(new THREE.Matrix4().makeRotationX(tilt));
    b.instance('awn.arm', boxGeo(0.035, 0.035, p * 1.1), 'metalDarkPainted', am);
  }
  b.instance('awn.roller', cylGeo(0.06, 0.06, width, 8), 'metalDarkPainted',
    mat4(x + nx * 0.06, y, z + nz * 0.06, yaw + Math.PI / 2));
  if (phys && !collapsed) {
    phys.addBox(cx, y - drop * 0.4, cz, width / 2, 0.1, p / 2, yaw, 'wood', 1 | 2);
  }
}
