import * as THREE from 'three';
import { boxGeo, planeGeo, cylGeo, mat4 } from './batcher.js';
import { TAU, clamp01 } from '../core/math.js';

const WALK_Y = 0.155;

/**
 * Enterable ground floors.
 *
 * Buildings flagged `hollow` are built as a shell by the building generator;
 * this fills them with real rooms — partitions, doorways, counters, shelving,
 * cover and lighting. An empty rectangular box is not an interior.
 */
export class InteriorBuilder {
  constructor(world) {
    this.world = world;
    this.b = world.batcher;
    this.phys = world.phys;
    this.materials = world.materials;
    this.rng = world.rng.stream('interiors');
  }

  /** Called once per hollow building after its shell exists. */
  build(rec) {
    const rng = this.rng.stream(`${rec.lot.cx.toFixed(1)}_${rec.lot.cz.toFixed(1)}`);
    const kind = rec.interiorKind;
    const room = {
      x0: rec.core.x0 + 0.3, x1: rec.core.x1 - 0.3,
      z0: rec.core.z0 + 0.3, z1: rec.core.z1 - 0.3,
      h: rec.groundH,
    };
    room.w = room.x1 - room.x0;
    room.d = room.z1 - room.z0;
    room.cx = (room.x0 + room.x1) / 2;
    room.cz = (room.z0 + room.z1) / 2;

    this._floorAndCeiling(room, rng, kind);
    if (kind === 'store') this._cornerStore(room, rng, rec);
    else if (kind === 'lobby') this._lobby(room, rng, rec);
    else if (kind === 'office') this._office(room, rng, rec);
    else this._collapsed(room, rng, rec);
    this._rubbleAndProps(room, rng, kind);
  }

  _floorAndCeiling(room, rng, kind) {
    const b = this.b;
    b.box(room.w + 0.6, 0.12, room.d + 0.6, room.cx, WALK_Y + 0.06, room.cz,
      kind === 'store' ? 'tileSubway' : 'interiorFloor', 0, 'interior', 2.2);
    // suspended ceiling, partly fallen
    const tiles = 5;
    for (let i = 0; i < tiles; i++) {
      for (let k = 0; k < tiles; k++) {
        if (rng.bool(0.26)) continue;                    // fallen tile
        const x = room.x0 + (i + 0.5) * (room.w / tiles);
        const z = room.z0 + (k + 0.5) * (room.d / tiles);
        b.instance('int.ceil', boxGeo(room.w / tiles - 0.08, 0.05, room.d / tiles - 0.08, 1.2),
          'ceilingPanel', mat4(x, room.h - 0.35, z));
      }
    }
    // exposed grid and conduit above
    for (let i = 0; i <= tiles; i++) {
      b.instance(`int.tgrid.${room.w.toFixed(0)}`, boxGeo(room.w, 0.04, 0.05), 'galvanized',
        mat4(room.cx, room.h - 0.32, room.z0 + i * (room.d / tiles)));
      b.instance(`int.tgridz.${room.d.toFixed(0)}`, boxGeo(0.05, 0.04, room.d), 'galvanized',
        mat4(room.x0 + i * (room.w / tiles), room.h - 0.32, room.cz));
    }
    b.instance(`int.duct.${room.w.toFixed(0)}`, boxGeo(room.w * 0.8, 0.42, 0.42, 1), 'galvanized',
      mat4(room.cx, room.h - 0.62, room.cz + room.d * 0.2));

    // strip lights, most dead, one or two alive
    const nL = 3;
    for (let i = 0; i < nL; i++) {
      const x = room.x0 + (i + 0.5) * (room.w / nL);
      const alive = rng.bool(0.4);
      b.instance('int.strip', boxGeo(1.5, 0.09, 0.2), 'metalPainted', mat4(x, room.h - 0.42, room.cz));
      b.instance('int.striplens', planeGeo(1.4, 0.16, 1),
        alive
          ? this.materials.variant('glassShop', { color: 0x2c3230, emissive: 0xbfd0c4, emissiveIntensity: 2.6, opacity: 0.95 })
          : this.materials.variant('glassShop', { color: 0x23282a, emissive: 0x000000, opacity: 0.9 }),
        (() => { const m = mat4(x, room.h - 0.47, room.cz); m.multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)); return m; })());
      if (alive) {
        this.world.interiorLights.push({
          x, y: room.h - 0.6, z: room.cz, color: 0xbfd0c4, intensity: 4.5, distance: 12,
          flicker: rng.bool(0.5) ? rng.range(0.5, 2.5) : 0,
        });
      }
    }
  }

  /* ------------------------------ archetypes ---------------------------- */

  _cornerStore(room, rng, rec) {
    const b = this.b;
    // Aisle shelving running the depth of the shop — the classic bodega layout.
    const aisles = Math.max(1, Math.floor(room.w / 3.4));
    for (let a = 0; a < aisles; a++) {
      const x = room.x0 + 1.4 + a * ((room.w - 3.4) / Math.max(1, aisles));
      const len = room.d * rng.range(0.5, 0.7);
      const z = room.cz - room.d * 0.06;
      const h = 1.85;
      b.instance(`st.shelf.${len.toFixed(1)}`, boxGeo(0.62, h, len, 1), 'metalPainted', mat4(x, WALK_Y + h / 2, z));
      // shelf boards + goods
      for (let s = 1; s < 5; s++) {
        b.instance(`st.board.${len.toFixed(1)}`, boxGeo(0.7, 0.04, len), 'metalDarkPainted', mat4(x, WALK_Y + s * 0.4, z));
        const n = Math.floor(len / 0.28);
        for (let i = 0; i < n; i++) {
          if (rng.bool(0.42)) continue;                 // looted
          const gz = z - len / 2 + (i + 0.5) * (len / n);
          const gs = rng.range(0.1, 0.2);
          b.instance('st.goods', boxGeo(1, 1, 1),
            this.materials.variant('plywood', { color: rng.pick([0xa8452a, 0x2a5a8a, 0xd8b83a, 0x3a7a4a, 0xb8b0a0]) }),
            mat4(x + rng.sym(0.14), WALK_Y + s * 0.4 + gs * 0.6, gz, rng.sym(0.4), 0, 0,
              gs * 1.4, gs * 1.7, gs));
        }
      }
      this.phys.addBox(x, WALK_Y + h / 2, z, 0.35, h / 2, len / 2, 0, 'metal', 1 | 2);
      this.world.coverPoints.push({ x, z, height: WALK_Y + h, quality: 0.7, kind: 'shelf', interior: true });
    }

    // Counter with a register, against the back wall.
    const cw = Math.min(4.2, room.w * 0.5);
    const cx = room.x1 - cw / 2 - 0.6;
    const cz = room.z1 - 1.6;
    b.instance(`st.counter.${cw.toFixed(1)}`, boxGeo(cw, 1.05, 0.7, 1), 'wood', mat4(cx, WALK_Y + 0.52, cz));
    b.instance(`st.counter2.${cw.toFixed(1)}`, boxGeo(cw + 0.1, 0.06, 0.8), 'metalDarkPainted', mat4(cx, WALK_Y + 1.08, cz));
    b.instance('st.register', boxGeo(0.4, 0.3, 0.34), 'metalPainted', mat4(cx + cw * 0.3, WALK_Y + 1.25, cz));
    this.phys.addBox(cx, WALK_Y + 0.52, cz, cw / 2, 0.52, 0.35, 0, 'wood', 1 | 2);
    this.world.coverPoints.push({ x: cx, z: cz - 0.9, height: WALK_Y + 1.1, quality: 0.9, kind: 'counter', interior: true });

    // Glass-door refrigerator wall.
    const fw = Math.min(6, room.w * 0.7);
    for (let i = 0; i < 4; i++) {
      const x = room.x0 + 0.9 + i * (fw / 4);
      b.instance('st.fridge', boxGeo(fw / 4 - 0.06, 2.1, 0.75, 1), 'metalPainted',
        mat4(x, WALK_Y + 1.05, room.z0 + 0.5));
      const lit = rng.bool(0.35);
      b.instance('st.fridgeglass', planeGeo(fw / 4 - 0.24, 1.7, 1),
        lit ? this.materials.variant('glassShop', { color: 0x1e2a26, emissive: 0x9ec0b0, emissiveIntensity: 1.4, opacity: 0.8 })
          : this.materials.variant('glassShop', { color: 0x0d1214, opacity: 0.75 }),
        mat4(x, WALK_Y + 1.1, room.z0 + 0.9));
      if (lit) this.world.interiorLights.push({ x, y: WALK_Y + 1.4, z: room.z0 + 1.4, color: 0x9ec0b0, intensity: 2.2, distance: 6 });
    }
    this.phys.addBox(room.x0 + 0.9 + fw / 2 - fw / 8, WALK_Y + 1.05, room.z0 + 0.5, fw / 2, 1.05, 0.4, 0, 'metal', 1 | 2);
  }

  _lobby(room, rng, rec) {
    const b = this.b;
    // Reception desk island.
    const dw = Math.min(5, room.w * 0.45);
    b.instance(`lb.desk.${dw.toFixed(1)}`, boxGeo(dw, 1.1, 1.0, 1), 'wood', mat4(room.cx, WALK_Y + 0.55, room.cz + room.d * 0.12));
    b.instance(`lb.desktop.${dw.toFixed(1)}`, boxGeo(dw + 0.2, 0.07, 1.2), 'limestone', mat4(room.cx, WALK_Y + 1.13, room.cz + room.d * 0.12));
    this.phys.addBox(room.cx, WALK_Y + 0.55, room.cz + room.d * 0.12, dw / 2, 0.55, 0.5, 0, 'wood', 1 | 2);
    this.world.coverPoints.push({ x: room.cx, z: room.cz + room.d * 0.12 - 1.2, height: WALK_Y + 1.15, quality: 0.9, kind: 'desk', interior: true });

    // Marble-clad columns down the middle.
    const cols = Math.max(2, Math.floor(room.w / 5));
    for (let i = 0; i < cols; i++) {
      const x = room.x0 + (i + 0.5) * (room.w / cols);
      for (const z of [room.z0 + room.d * 0.3, room.z1 - room.d * 0.3]) {
        b.instance('lb.col', boxGeo(0.62, room.h, 0.62, 1.4), 'limestone', mat4(x, room.h / 2, z));
        b.instance('lb.colbase', boxGeo(0.8, 0.3, 0.8), 'limestone', mat4(x, WALK_Y + 0.15, z));
        b.instance('lb.colcap', boxGeo(0.82, 0.22, 0.82), 'limestone', mat4(x, room.h - 0.4, z));
        this.phys.addBox(x, room.h / 2, z, 0.32, room.h / 2, 0.32, 0, 'concrete', 1 | 2);
        this.world.coverPoints.push({ x, z, height: room.h, quality: 1.0, kind: 'column', interior: true });
      }
    }

    // Elevator bank on the back wall.
    const bank = Math.min(3, Math.floor(room.w / 3));
    for (let i = 0; i < bank; i++) {
      const x = room.cx + (i - (bank - 1) / 2) * 2.3;
      b.instance('lb.elev', boxGeo(1.9, 2.5, 0.16), 'chrome', mat4(x, WALK_Y + 1.25, room.z1 - 0.25));
      b.instance('lb.elevgap', boxGeo(0.06, 2.4, 0.2), 'metalDarkPainted', mat4(x, WALK_Y + 1.2, room.z1 - 0.32));
      b.instance('lb.elevsurr', boxGeo(2.2, 2.8, 0.1), 'limestone', mat4(x, WALK_Y + 1.4, room.z1 - 0.35));
    }
    // Seating and a fallen planter.
    b.instance('lb.bench', boxGeo(2.4, 0.42, 0.7, 1), 'wood', mat4(room.x0 + 1.6, WALK_Y + 0.3, room.cz));
    this.phys.addBox(room.x0 + 1.6, WALK_Y + 0.3, room.cz, 1.2, 0.3, 0.35, 0, 'wood', 1 | 2);
  }

  _office(room, rng, rec) {
    const b = this.b;
    // Partition maze — real walls with real doorways, so it plays as CQB.
    const cellW = 4.2;
    const nx = Math.max(1, Math.floor(room.w / cellW));
    for (let i = 1; i < nx; i++) {
      const x = room.x0 + i * (room.w / nx);
      // wall in two pieces with a door gap
      const gapZ = room.z0 + room.d * rng.range(0.3, 0.7);
      const gap = 1.1;
      const seg1 = gapZ - gap / 2 - room.z0;
      const seg2 = room.z1 - (gapZ + gap / 2);
      if (seg1 > 0.4) {
        b.box(0.16, room.h - 0.4, seg1, x, (room.h - 0.4) / 2 + WALK_Y, room.z0 + seg1 / 2, 'plaster', 0, 'interior', 2);
        this.phys.addBox(x, (room.h - 0.4) / 2, room.z0 + seg1 / 2, 0.08, (room.h - 0.4) / 2, seg1 / 2, 0, 'wood', 1 | 2);
      }
      if (seg2 > 0.4) {
        b.box(0.16, room.h - 0.4, seg2, x, (room.h - 0.4) / 2 + WALK_Y, room.z1 - seg2 / 2, 'plaster', 0, 'interior', 2);
        this.phys.addBox(x, (room.h - 0.4) / 2, room.z1 - seg2 / 2, 0.08, (room.h - 0.4) / 2, seg2 / 2, 0, 'wood', 1 | 2);
      }
      // door frame + a door hanging off one hinge
      b.instance('of.dframe', boxGeo(0.2, 2.15, 1.2), 'wood', mat4(x, WALK_Y + 1.08, gapZ));
      if (rng.bool(0.5)) {
        const dm = mat4(x, WALK_Y + 1.02, gapZ + 0.5, rng.range(0.6, 1.4));
        b.instance('of.door', boxGeo(0.05, 2.0, 0.95), 'wood', dm);
      }
      this.world.coverPoints.push({ x: x + 0.6, z: gapZ, height: WALK_Y + 1.2, quality: 0.85, kind: 'doorway', interior: true });
    }

    // Desks, chairs, overturned filing cabinets.
    for (let i = 0; i < nx; i++) {
      const cxx = room.x0 + (i + 0.5) * (room.w / nx);
      for (let k = 0; k < 2; k++) {
        const z = room.z0 + (k + 0.5) * (room.d / 2) + rng.sym(0.8);
        const yaw = rng.sym(0.5) + (rng.bool() ? 0 : Math.PI / 2);
        b.instance('of.desk', boxGeo(1.6, 0.06, 0.8), 'wood', mat4(cxx + rng.sym(0.6), WALK_Y + 0.74, z, yaw));
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          b.instance('of.leg', boxGeo(0.06, 0.72, 0.06), 'metalDarkPainted',
            mat4(cxx + rng.sym(0.6) + sx * 0.72, WALK_Y + 0.36, z + sz * 0.34, yaw));
        }
        this.phys.addBox(cxx, WALK_Y + 0.4, z, 0.8, 0.4, 0.4, yaw, 'wood', 1);
        this.world.coverPoints.push({ x: cxx, z, height: WALK_Y + 0.8, quality: 0.55, kind: 'desk', interior: true });
        // monitor + chair
        b.instance('of.mon', boxGeo(0.5, 0.34, 0.05), 'metalDarkPainted', mat4(cxx + rng.sym(0.5), WALK_Y + 0.95, z - 0.2, yaw));
        b.instance('of.chair', boxGeo(0.48, 0.08, 0.48), 'rubber', mat4(cxx + rng.sym(1), WALK_Y + 0.45, z + 0.9, rng.next() * TAU));
      }
      // filing cabinet, sometimes toppled
      const toppled = rng.bool(0.5);
      const fz = room.z1 - 0.8;
      b.instance('of.cab', boxGeo(0.5, 1.35, 0.62, 1), 'metalPainted',
        toppled ? mat4(cxx, WALK_Y + 0.31, fz, rng.next() * TAU, 0, Math.PI / 2)
          : mat4(cxx, WALK_Y + 0.68, fz, rng.sym(0.3)));
      this.phys.addBox(cxx, WALK_Y + (toppled ? 0.31 : 0.68), fz, 0.35, toppled ? 0.31 : 0.68, 0.35, 0, 'metal', 1 | 2);
    }
  }

  _collapsed(room, rng, rec) {
    const b = this.b;
    // A floor plate has come down at an angle across the room.
    const slabYaw = rng.range(0.2, 1.2);
    const sx = room.cx + rng.sym(room.w * 0.15);
    const sz = room.cz + rng.sym(room.d * 0.15);
    b.instance('cp.slab', boxGeo(room.w * 0.8, 0.3, room.d * 0.55), 'concreteDark',
      mat4(sx, WALK_Y + 1.5, sz, slabYaw, 0.55, 0.12));
    this.phys.addBox(sx, WALK_Y + 1.2, sz, room.w * 0.4, 0.8, room.d * 0.28, slabYaw, 'concrete', 1 | 2);
    this.world.coverPoints.push({ x: sx, z: sz, height: WALK_Y + 2.2, quality: 0.95, kind: 'slab', interior: true });

    // Rebar hanging out of the break.
    for (let i = 0; i < 14; i++) {
      b.instance('cp.rebar', cylGeo(0.014, 0.014, rng.range(0.8, 2.2), 5), 'metalRust',
        mat4(sx + rng.sym(room.w * 0.35), WALK_Y + rng.range(1.2, 2.6), sz + rng.sym(room.d * 0.25),
          rng.next() * TAU, rng.sym(1.2), rng.sym(1.2)));
    }
    // Broken joists and a shaft of daylight from the hole above.
    for (let i = 0; i < 8; i++) {
      b.instance('cp.joist', boxGeo(rng.range(1.5, 3.5), 0.16, 0.12), 'wood',
        mat4(room.x0 + rng.next() * room.w, WALK_Y + rng.range(0.2, 2.4), room.z0 + rng.next() * room.d,
          rng.next() * TAU, rng.sym(0.9), rng.sym(0.4)));
    }
    // Standing water where the roof failed.
    const m = mat4(room.cx + rng.sym(2), WALK_Y + 0.135, room.cz + rng.sym(2), rng.next() * TAU);
    m.multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
    b.instance('cp.water', planeGeo(rng.range(2.5, 5), rng.range(2, 4), 2),
      this.materials.variant('asphaltWet', { color: 0x3a3f42 }), m);

    this.world.dustSources.push({ x: room.cx, y: 1.2, z: room.cz, radius: room.w * 0.4 });
  }

  _rubbleAndProps(room, rng, kind) {
    const b = this.b;
    const n = rng.int(18, 40);
    for (let i = 0; i < n; i++) {
      const x = room.x0 + rng.next() * room.w;
      const z = room.z0 + rng.next() * room.d;
      const s = rng.range(0.06, 0.3);
      b.instance('int.rub', boxGeo(1, 1, 1), rng.bool(0.3) ? 'brickRed' : 'rubble',
        mat4(x, WALK_Y + 0.12 + s * 0.4, z, rng.next() * TAU, rng.sym(0.8), rng.sym(0.8),
          s * rng.range(1, 2.2), s * rng.range(0.5, 1), s * rng.range(1, 1.8)));
    }
    // scattered paper
    for (let i = 0; i < 30; i++) {
      const m = mat4(room.x0 + rng.next() * room.w, WALK_Y + 0.125, room.z0 + rng.next() * room.d, rng.next() * TAU);
      m.multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2 + rng.sym(0.2)));
      b.instance('int.paper', planeGeo(0.22, 0.3, 1),
        this.materials.variant('plywood', { color: 0xc4bdae }), m);
    }
    // dust haze marker for the FX system
    this.world.dustSources.push({ x: room.cx, y: 1.4, z: room.cz, radius: Math.min(room.w, room.d) * 0.45, interior: true });
  }
}
