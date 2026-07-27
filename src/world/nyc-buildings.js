import * as THREE from 'three';
import { boxGeo, planeGeo, cylGeo, mat4 } from './batcher.js';
import { fireEscape, waterTower, rooftopKit, parapet, cornice, windowAC, awning, facadeScaffold } from './nyc-details.js';
import { makeShopSign, makeBladeSign, makeInteriorBackdrop, makeBillboard } from './nyc-signage.js';
import { TAU, clamp01, lerp, smoothstep } from '../core/math.js';

/**
 * Procedural Manhattan architecture.
 *
 * A building is a solid core inset behind a facade skin. The skin is built from
 * piers and spandrels with rectangular voids; glazing sits at the core plane, so
 * every window is genuinely recessed ~0.25 m and self-shadows. That single
 * decision is what stops the block reading as decorated boxes.
 */

export const ARCHETYPES = {
  NY_BRICK_APARTMENT: {
    floors: [5, 7], floorH: [3.05, 3.35], groundH: [3.9, 4.4],
    wall: ['brickRed', 'brickBrown', 'brickDark'],
    base: 'limestone', trim: 'limestone',
    bay: [2.35, 2.9], winW: 0.62, winH: 0.66,
    fireEscape: 0.92, cornice: 0.85, waterTower: 0.45,
    ground: 'stoop', ac: 0.5,
  },
  NY_PREWAR_MASONRY: {
    floors: [6, 9], floorH: [3.2, 3.6], groundH: [4.4, 5.2],
    wall: ['brickTan', 'brickBrown', 'limestone'],
    base: 'limestone', trim: 'limestone',
    bay: [2.6, 3.3], winW: 0.6, winH: 0.7,
    fireEscape: 0.55, cornice: 1.0, waterTower: 0.55,
    ground: 'lobby', ac: 0.25, stringCourse: true,
  },
  NY_COMMERCIAL_LOWRISE: {
    floors: [2, 4], floorH: [3.3, 3.9], groundH: [4.2, 4.9],
    wall: ['brickRed', 'brickPainted', 'terracotta', 'brickTan'],
    base: 'concrete', trim: 'limestone',
    bay: [2.4, 3.1], winW: 0.7, winH: 0.62,
    fireEscape: 0.5, cornice: 0.7, waterTower: 0.12,
    ground: 'store', ac: 0.3, signage: 1.0,
  },
  NY_CORNER_STORE: {
    floors: [2, 3], floorH: [3.2, 3.6], groundH: [4.3, 4.8],
    wall: ['brickRed', 'brickPainted'],
    base: 'concrete', trim: 'limestone',
    bay: [2.3, 2.8], winW: 0.66, winH: 0.6,
    fireEscape: 0.7, cornice: 0.6, waterTower: 0.1,
    ground: 'store', ac: 0.4, signage: 1.0, cornerEntry: true,
  },
  NY_GLASS_OFFICE: {
    floors: [9, 15], floorH: [3.5, 3.9], groundH: [5.4, 6.4],
    wall: ['concrete', 'limestone'],
    base: 'limestone', trim: 'metalDarkPainted',
    bay: [1.6, 2.0], winW: 0.9, winH: 0.84,
    fireEscape: 0, cornice: 0, waterTower: 0,
    ground: 'lobby', ac: 0, curtainWall: true, setback: 0.55,
  },
  NY_INDUSTRIAL: {
    floors: [4, 6], floorH: [3.6, 4.2], groundH: [4.6, 5.4],
    wall: ['brickDark', 'brickBrown'],
    base: 'concreteDark', trim: 'concreteDark',
    bay: [3.0, 3.8], winW: 0.82, winH: 0.72,
    fireEscape: 0.6, cornice: 0.4, waterTower: 0.6,
    ground: 'dock', ac: 0.15, steelSash: true,
  },
  NY_DAMAGED_HIGHRISE: {
    floors: [8, 12], floorH: [3.2, 3.6], groundH: [4.6, 5.4],
    wall: ['brickTan', 'concrete', 'brickBrown'],
    base: 'limestone', trim: 'limestone',
    bay: [2.4, 3.0], winW: 0.66, winH: 0.72,
    fireEscape: 0.4, cornice: 0.5, waterTower: 0.3,
    ground: 'lobby', ac: 0.2, collapse: true,
  },
};

const WINDOW_STATES = ['dark', 'reflect', 'lit', 'broken', 'boarded', 'missing', 'soot'];

export class BuildingGenerator {
  constructor(world) {
    this.world = world;
    this.ctx = world.ctx;
    this.b = world.batcher;
    this.phys = world.phys;
    this.materials = world.materials;
    this.rng = world.rng.stream('buildings');
    this.signCache = [];
    this.interiorCache = [];
    this.buildings = [];
  }

  /** Shared, reused sign textures — a block has variety but not 60 unique maps. */
  _signMaterial(rng) {
    if (this.signCache.length < 14) {
      const { tex, type, name } = makeShopSign(rng);
      const m = this.materials.std({ map: tex, roughness: 0.78, envMapIntensity: 0.5 });
      m.name = `sign:${name}`;
      this.signCache.push({ m, type, name });
    }
    return rng.pick(this.signCache);
  }

  _interiorMaterial(rng) {
    if (this.interiorCache.length < 6) {
      const tex = makeInteriorBackdrop(rng);
      this.interiorCache.push(this.materials.std({ map: tex, roughness: 0.95, envMapIntensity: 0.15 }));
    }
    return rng.pick(this.interiorCache);
  }

  pickArchetype(lot, rng) {
    const t = lot.theme;
    if (lot.corner && rng.bool(0.55)) return 'NY_CORNER_STORE';
    if (t === 'prewar') return rng.weighted(
      ['NY_BRICK_APARTMENT', 'NY_PREWAR_MASONRY', 'NY_COMMERCIAL_LOWRISE', 'NY_DAMAGED_HIGHRISE'],
      [0.42, 0.3, 0.18, 0.1]);
    if (t === 'commercial') return rng.weighted(
      ['NY_COMMERCIAL_LOWRISE', 'NY_BRICK_APARTMENT', 'NY_CORNER_STORE', 'NY_INDUSTRIAL'],
      [0.4, 0.24, 0.2, 0.16]);
    if (t === 'modern') return rng.weighted(
      ['NY_GLASS_OFFICE', 'NY_COMMERCIAL_LOWRISE', 'NY_PREWAR_MASONRY', 'NY_DAMAGED_HIGHRISE'],
      [0.34, 0.24, 0.24, 0.18]);
    return rng.weighted(
      ['NY_BRICK_APARTMENT', 'NY_INDUSTRIAL', 'NY_COMMERCIAL_LOWRISE', 'NY_PREWAR_MASONRY', 'NY_DAMAGED_HIGHRISE'],
      [0.3, 0.2, 0.2, 0.2, 0.1]);
  }

  /** Which faces of this lot look onto a street. */
  facesFor(lot, block) {
    const faces = [];
    const push = (axis, sign) => faces.push({ axis, sign });
    if (lot.side === 'north') push('z', -1);
    if (lot.side === 'south') push('z', 1);
    if (lot.side === 'west') push('x', -1);
    if (lot.side === 'east') push('x', 1);
    if (lot.side === 'north' || lot.side === 'south') {
      if (lot.x0 <= block.x0 + 0.05) push('x', -1);
      if (lot.x1 >= block.x1 - 0.05) push('x', 1);
    }
    return faces;
  }

  generate(lot, block) {
    const rng = this.rng.stream(`${lot.block}:${lot.cx.toFixed(1)}:${lot.cz.toFixed(1)}`);
    let key = this.pickArchetype(lot, rng);
    if (lot.hollow) {
      key = lot.interiorKind === 'store' ? 'NY_CORNER_STORE'
        : lot.interiorKind === 'lobby' ? 'NY_PREWAR_MASONRY'
          : lot.interiorKind === 'office' ? 'NY_COMMERCIAL_LOWRISE'
            : 'NY_DAMAGED_HIGHRISE';
    }
    const A = ARCHETYPES[key];
    const b = this.b;

    const floors = rng.int(A.floors[0], A.floors[1]);
    const floorH = rng.range(A.floorH[0], A.floorH[1]);
    const groundH = rng.range(A.groundH[0], A.groundH[1]);
    const height = groundH + floorH * floors;
    const wallMat = rng.pick(A.wall);

    // Damage grade drives everything from window states to whether the top
    // three floors even exist. Varying this per building is what makes the
    // destruction read as a battle rather than a filter.
    let damage = clamp01(rng.gauss(lot.theme === 'modern' ? 0.34 : 0.45, 0.26));
    // An enterable building must actually be enterable: its glazing is gone.
    if (lot.hollow) damage = Math.max(damage, 0.88);

    const faces = this.facesFor(lot, block);
    const inset = 0.26;

    // --- solid core --------------------------------------------------
    const core = { x0: lot.x0, x1: lot.x1, z0: lot.z0, z1: lot.z1 };
    for (const f of faces) {
      if (f.axis === 'x') { if (f.sign < 0) core.x0 += inset; else core.x1 -= inset; }
      else { if (f.sign < 0) core.z0 += inset; else core.z1 -= inset; }
    }
    const cw = core.x1 - core.x0, cd = core.z1 - core.z0;
    const ccx = (core.x0 + core.x1) / 2, ccz = (core.z0 + core.z1) / 2;

    // Collapse: the top of a damaged high-rise is sheared off at an angle.
    let topY = height;
    let collapseFrom = Infinity;
    if (A.collapse && damage > 0.5) {
      collapseFrom = groundH + floorH * Math.max(2, Math.floor(floors * rng.range(0.45, 0.75)));
      topY = collapseFrom;
    }

    if (lot.hollow) {
      // Enterable ground floor: the mass starts at the first-floor slab and the
      // ground level is a shell whose street faces are open through the glazing.
      const mh = topY - groundH;
      b.box(cw, mh, cd, ccx, groundH + mh / 2, ccz, wallMat, 0, `blk${lot.block}`, 2.6);
      this.phys.addBox(ccx, groundH + mh / 2, ccz, cw / 2, mh / 2, cd / 2, 0, 'brick', 1 | 2);
      // slab soffit over the room
      b.box(cw, 0.3, cd, ccx, groundH - 0.15, ccz, 'concreteDark', 0, `blk${lot.block}`, 2.4);
      // party walls enclosing the room on every side that is not a shopfront
      const T = 0.32;
      for (const [axis, sign] of [['x', -1], ['x', 1], ['z', -1], ['z', 1]]) {
        if (faces.some((f) => f.axis === axis && f.sign === sign)) continue;
        const wx = axis === 'x' ? (sign < 0 ? core.x0 + T / 2 : core.x1 - T / 2) : ccx;
        const wz = axis === 'z' ? (sign < 0 ? core.z0 + T / 2 : core.z1 - T / 2) : ccz;
        const ww = axis === 'x' ? T : cw;
        const wd = axis === 'z' ? T : cd;
        b.box(ww, groundH, wd, wx, groundH / 2, wz, 'plaster', 0, 'interior', 2.2);
        this.phys.addBox(wx, groundH / 2, wz, ww / 2, groundH / 2, wd / 2, 0, 'concrete', 1 | 2);
      }
    } else {
      b.box(cw, topY, cd, ccx, topY / 2, ccz, wallMat, 0, `blk${lot.block}`, 2.6);
      this.phys.addBox(ccx, topY / 2, ccz, cw / 2, topY / 2, cd / 2, 0, 'brick', 1 | 2);
    }

    // Party walls: blank masonry on the non-street sides, offset slightly so
    // adjacent buildings do not z-fight.
    for (const [axis, sign] of [['x', -1], ['x', 1], ['z', -1], ['z', 1]]) {
      if (faces.some((f) => f.axis === axis && f.sign === sign)) continue;
      // it is a party wall; nothing to draw, the neighbour covers it
    }

    // --- facades -----------------------------------------------------
    const facadeInfo = [];
    for (const f of faces) {
      const info = this._facade(b, lot, core, f, {
        A, key, rng, floors, floorH, groundH, height: topY, wallMat, damage, inset,
      });
      facadeInfo.push(info);
    }

    // --- collapse debris + exposed floor plates ----------------------
    if (collapseFrom < Infinity) {
      this._collapseTop(b, rng, lot, core, collapseFrom, height, wallMat, floorH);
    }

    // --- roof --------------------------------------------------------
    const roofY = topY;
    if (collapseFrom === Infinity) {
      const roofLot = { x0: core.x0, x1: core.x1, z0: core.z0, z1: core.z1 };
      if (A.cornice > 0 && rng.bool(A.cornice)) {
        cornice(b, { x0: lot.x0, x1: lot.x1, z0: lot.z0, z1: lot.z1 }, roofY - 0.7, A.trim,
          rng.range(0.3, 0.5), rng.range(0.45, 0.7));
      }
      parapet(b, this.phys, roofLot, roofY, wallMat, rng.range(0.85, 1.25), A.trim);
      b.box(cw, 0.24, cd, ccx, roofY - 0.12, ccz, 'concreteDark', 0, 'roof', 2.5);
      rooftopKit(b, this.phys, rng, { cx: ccx, cz: ccz, w: cw, d: cd }, roofY);
      if (rng.bool(A.waterTower) && Math.min(cw, cd) > 9) {
        waterTower(b, this.phys, rng, ccx + rng.sym(cw * 0.22), roofY, ccz + rng.sym(cd * 0.22),
          rng.range(0.92, 1.12));
      }
    }

    // --- street-level fittings --------------------------------------
    for (let i = 0; i < faces.length; i++) {
      const f = faces[i];
      const info = facadeInfo[i];
      // Fire escapes belong on older brick walls, never on curtain wall.
      if (A.fireEscape > 0 && rng.bool(A.fireEscape) && info.width > 4.5) {
        const feFloors = Math.min(floors, Math.max(3, floors - (rng.bool(0.4) ? 1 : 0)));
        fireEscape(b, this.phys, rng, {
          x: info.planeX, z: info.planeZ, nx: info.nx, nz: info.nz,
          baseY: groundH - floorH * 0.15, floors: feFloors, floorH,
          width: Math.min(3.4, info.width * 0.42),
        });
      }
      if (rng.bool(0.18) && info.width > 8) {
        facadeScaffold(b, this.phys, rng, {
          x: info.planeX, z: info.planeZ, nx: info.nx, nz: info.nz,
          len: info.width * 0.7, height: Math.min(height * 0.75, floorH * 4),
        });
      }
    }

    const rec = {
      key, lot, height: topY, floors, floorH, groundH, damage, faces, core, wallMat,
      cx: ccx, cz: ccz, interiorKind: lot.interiorKind || null, hollow: !!lot.hollow,
    };
    this.buildings.push(rec);
    return rec;
  }

  /* ---------------------------------------------------------------- *
   *  Facade skin
   * ---------------------------------------------------------------- */
  _facade(b, lot, core, face, o) {
    const { A, rng, floors, floorH, groundH, height, wallMat, damage, inset } = o;
    const horiz = face.axis === 'z';        // facade runs along X
    const a0 = horiz ? lot.x0 : lot.z0;
    const a1 = horiz ? lot.x1 : lot.z1;
    const width = a1 - a0;
    const plane = face.axis === 'x'
      ? (face.sign < 0 ? lot.x0 : lot.x1)
      : (face.sign < 0 ? lot.z0 : lot.z1);
    const nx = face.axis === 'x' ? face.sign : 0;
    const nz = face.axis === 'z' ? face.sign : 0;
    const yaw = Math.atan2(nx, nz);

    // world position helper: a along the facade, d out from the core plane
    const W = (a, y, d) => {
      if (face.axis === 'x') return [plane + face.sign * (d - inset), y, a];
      return [a, y, plane + face.sign * (d - inset)];
    };
    const put = (a, y, d, w, h, t, matName, group = 'facade', uv = 2.2) => {
      const [x, yy, z] = W(a, y, d);
      if (face.axis === 'x') b.box(t, h, w, x, yy, z, matName, 0, group, uv);
      else b.box(w, h, t, x, yy, z, matName, 0, group, uv);
    };
    const putI = (key, a, y, d, geo, matName) => {
      const [x, yy, z] = W(a, y, d);
      b.instance(key, geo, matName, mat4(x, yy, z, yaw));
    };

    const bayW = rng.range(A.bay[0], A.bay[1]);
    const bays = Math.max(2, Math.round(width / bayW));
    const bw = width / bays;
    const pierW = bw * (A.curtainWall ? 0.16 : (1 - A.winW));
    const winW = bw - pierW;

    // --- ground floor treatment -------------------------------------
    const groundKind = A.ground;
    if (groundKind === 'store' && width > 6) {
      this._storefronts(b, { a0, a1, bays, bw, groundH, face, plane, inset, W, put, putI, yaw, nx, nz, rng, A, damage, lot });
    } else if (groundKind === 'lobby') {
      this._lobby(b, { a0, a1, width, groundH, W, put, putI, yaw, nx, nz, rng, A, damage, face, plane, inset });
    } else if (groundKind === 'dock') {
      this._loadingDock(b, { a0, a1, width, groundH, W, put, putI, yaw, nx, nz, rng, A, damage });
    } else {
      this._stoopBase(b, { a0, a1, width, groundH, bays, bw, W, put, putI, yaw, nx, nz, rng, A, damage });
    }

    // Water table / base course
    put((a0 + a1) / 2, groundH + 0.14, inset + 0.06, width, 0.28, inset * 2 + 0.12, A.trim, 'facade', 1.6);

    // --- upper floors ------------------------------------------------
    const glassMats = {
      dark: 'glassDark', reflect: 'glassBlue', lit: 'glassDark',
      broken: 'glassBroken', boarded: 'plywood', missing: null, soot: 'glassDark',
    };

    for (let fl = 0; fl < floors; fl++) {
      const fy = groundH + fl * floorH;
      const winH = floorH * A.winH;
      const sillY = fy + floorH * (A.curtainWall ? 0.12 : 0.28);
      const headY = sillY + winH;
      if (headY > height - 0.4) break;

      // spandrel under the sill
      put((a0 + a1) / 2, fy + (sillY - fy) / 2, inset / 2, width, sillY - fy, inset, wallMat, 'facade', 2.4);
      // spandrel above the head
      const topBandH = (fy + floorH) - headY;
      if (topBandH > 0.02) {
        put((a0 + a1) / 2, headY + topBandH / 2, inset / 2, width, topBandH, inset, wallMat, 'facade', 2.4);
      }

      for (let i = 0; i < bays; i++) {
        const ca = a0 + (i + 0.5) * bw;
        // pier between windows
        put(ca - bw / 2, fy + floorH / 2, inset / 2, pierW, floorH, inset, wallMat, 'facade', 2.4);
        if (i === bays - 1) put(ca + bw / 2, fy + floorH / 2, inset / 2, pierW, floorH, inset, wallMat, 'facade', 2.4);

        // --- the window itself ---
        const st = this._windowState(rng, damage, fl, floors);
        const gm = glassMats[st];
        const wY = (sillY + headY) / 2;

        if (gm) {
          const geo = planeGeo(winW - 0.1, winH - 0.08, 1.6);
          const key = `win.${gm}.${(winW - 0.1).toFixed(2)}x${(winH - 0.08).toFixed(2)}`;
          putI(key, ca, wY, 0.035, geo, gm);
        }
        if (st === 'missing' || st === 'broken') {
          // interior darkness behind the opening
          const geo = planeGeo(winW - 0.06, winH - 0.04);
          putI(`win.void.${(winW).toFixed(2)}`, ca, wY, 0.005, geo, this._interiorMaterial(rng));
        }
        if (st === 'lit') {
          const geo = planeGeo(winW - 0.14, winH - 0.12, 1);
          putI(`win.lit.${(winW).toFixed(2)}`, ca, wY, 0.02, geo,
            this.materials.variant('glassDark', { emissive: 0xffcf95, emissiveIntensity: 1.5, color: 0x2a2318 }));
        }

        // frame: sill, jambs, head
        putI(`fr.sill.${winW.toFixed(2)}`, ca, sillY - 0.05, inset + 0.06, boxGeo(winW + 0.16, 0.11, inset * 0.9 + 0.12), A.trim);
        putI(`fr.head.${winW.toFixed(2)}`, ca, headY + 0.06, inset + 0.02, boxGeo(winW + 0.14, 0.13, inset * 0.9 + 0.06), A.trim);
        if (!A.curtainWall) {
          putI('fr.jamb', ca - winW / 2 - 0.02, wY, inset * 0.55, boxGeo(0.06, winH, inset * 0.7), 'metalDarkPainted');
          putI('fr.jamb', ca + winW / 2 + 0.02, wY, inset * 0.55, boxGeo(0.06, winH, inset * 0.7), 'metalDarkPainted');
          // muntin bar — two-over-two sash
          putI(`fr.mun.${winW.toFixed(2)}`, ca, wY, 0.06, boxGeo(winW - 0.08, 0.045, 0.045), 'metalDarkPainted');
        } else {
          // curtain wall mullions
          putI('cw.mull', ca - winW / 2 - 0.02, wY, 0.09, boxGeo(0.1, floorH, 0.16), 'metalDarkPainted');
          putI(`cw.trans.${winW.toFixed(2)}`, ca, sillY - 0.06, 0.09, boxGeo(winW, 0.12, 0.16), 'metalDarkPainted');
        }
        if (A.steelSash) {
          for (let k = 1; k < 4; k++) {
            putI(`fr.sash.${winW.toFixed(2)}`, ca - winW / 2 + (k / 4) * winW, wY, 0.055, boxGeo(0.035, winH - 0.1, 0.04), 'metalDarkPainted');
          }
        }
        // window air conditioner
        if (fl > 0 && rng.bool(A.ac * 0.35) && st !== 'missing') {
          const [wx, , wz] = W(ca, 0, 0);
          windowAC(b, wx, sillY + 0.24, wz, nx, nz);
        }
      }

      // string course between floors on pre-war stock
      if (A.stringCourse && fl > 0 && fl % 3 === 0) {
        put((a0 + a1) / 2, fy - 0.08, inset + 0.1, width, 0.22, inset * 2 + 0.2, A.trim, 'facade', 1.4);
      }
    }

    // Blank wall above the top window row up to the roof.
    const lastTop = groundH + floors * floorH;
    if (height - lastTop > 0.05) {
      put((a0 + a1) / 2, (lastTop + height) / 2, inset / 2, width, height - lastTop, inset, wallMat, 'facade', 2.4);
    }

    // Painted ghost sign — a faded advert from decades before the war.
    if (rng.bool(0.16) && width > 9) {
      const gh = Math.min(6, height * 0.3);
      const geo = planeGeo(width * 0.8, gh, 1);
      putI(`ghost.${width.toFixed(1)}`, (a0 + a1) / 2, groundH + floorH * 1.6 + gh / 2, inset + 0.055, geo,
        this.materials.variant('brickRed', { color: 0x8b8378, opacity: 0.42 }));
    }

    // The facade skin needs its own collider, otherwise the player can stand
    // inside the 0.26 m of piers and sills in front of the core.
    const [cbx, , cbz] = W((a0 + a1) / 2, 0, inset / 2);
    const hA = face.axis === 'x' ? inset / 2 : width / 2;
    const hB = face.axis === 'x' ? width / 2 : inset / 2;
    if (lot.hollow) {
      // leave the shopfront glazing open so the interior is reachable
      const upper = height - groundH;
      if (upper > 0.2) this.phys.addBox(cbx, groundH + upper / 2, cbz, hA, upper / 2, hB, 0, 'brick', 1 | 2);
      this.phys.addBox(cbx, 0.28, cbz, hA, 0.28, hB, 0, 'metal', 1 | 2);
    } else {
      this.phys.addBox(cbx, height / 2, cbz, hA, height / 2, hB, 0, 'brick', 1 | 2);
    }

    const [px, , pz] = W((a0 + a1) / 2, 0, inset);
    return { width, planeX: px, planeZ: pz, nx, nz, yaw, bays, bw };
  }

  _windowState(rng, damage, floor, floors) {
    // Lower floors take more small-arms damage; upper floors take blast.
    const lowBias = 1 - floor / Math.max(1, floors);
    const dmg = clamp01(damage * (0.55 + lowBias * 0.75));
    const r = rng.next();
    if (r < dmg * 0.42) return 'broken';
    if (r < dmg * 0.56) return 'missing';
    if (r < dmg * 0.72) return 'boarded';
    if (r < dmg * 0.82) return 'soot';
    const s = rng.next();
    if (s < 0.055) return 'lit';
    if (s < 0.42) return 'reflect';
    return 'dark';
  }

  /* ------------------------- ground floors ------------------------- */

  _storefronts(b, o) {
    const { a0, a1, bays, bw, groundH, W, put, putI, yaw, nx, nz, rng, A, damage, inset } = o;
    const bulk = 0.55;                     // bulkhead below the display glass
    const transom = groundH * 0.16;
    const glassH = groundH - bulk - transom - 0.5;
    const nShops = Math.max(1, Math.round((a1 - a0) / rng.range(7, 11)));
    const shopW = (a1 - a0) / nShops;

    for (let s = 0; s < nShops; s++) {
      const s0 = a0 + s * shopW;
      const sc = s0 + shopW / 2;
      const shopDamage = clamp01(damage + rng.sym(0.3));
      const shattered = shopDamage > 0.45;
      const gated = !shattered && rng.bool(0.34);

      // structural pier between shops
      put(s0, groundH / 2, inset / 2, 0.42, groundH, inset, A.base, 'facade', 1.6);
      if (s === nShops - 1) put(a1, groundH / 2, inset / 2, 0.42, groundH, inset, A.base, 'facade', 1.6);

      // bulkhead
      put(sc, bulk / 2, inset * 0.7, shopW - 0.5, bulk, inset * 1.4, 'metalDarkPainted', 'facade', 1);
      // display glass
      const gy = bulk + glassH / 2;
      if (gated) {
        putI(`sf.gate.${shopW.toFixed(1)}`, sc, gy + 0.1, inset + 0.05,
          planeGeo(shopW - 0.55, glassH + 0.4, 0.4), 'grate');
        putI(`sf.gatebox.${shopW.toFixed(1)}`, sc, bulk + glassH + 0.34, inset + 0.06,
          boxGeo(shopW - 0.5, 0.36, 0.26), 'metalPainted');
      } else {
        putI(`sf.glass.${shopW.toFixed(1)}x${glassH.toFixed(1)}`, sc, gy, inset + 0.02,
          planeGeo(shopW - 0.62, glassH, 1.4), shattered ? 'glassBroken' : 'glassShop');
        // the dark shop behind it
        putI(`sf.int.${shopW.toFixed(1)}`, sc, gy, 0.02,
          planeGeo(shopW - 0.6, glassH), this._interiorMaterial(rng));
        // mullion splitting the display window
        putI('sf.mull', sc, gy, inset + 0.04, boxGeo(0.09, glassH, 0.09), 'metalDarkPainted');
        if (shattered) {
          // glass on the sidewalk below
          const [gx, , gz] = W(sc, 0, inset + 0.6);
          b.instance('sf.shards', planeGeo(shopW - 0.5, 1.2, 1), this.materials.variant('glassBroken', { opacity: 0.5 }),
            (() => { const m = mat4(gx, 0.015, gz, yaw); m.multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2)); return m; })());
        }
      }
      // entrance door recess
      const dw = 1.05;
      const da = sc + shopW * (rng.bool() ? 0.28 : -0.28);
      putI('sf.door', da, 1.05, inset - 0.06, boxGeo(dw, 2.1, 0.07), 'metalDarkPainted');
      putI('sf.doorglass', da, 1.25, inset - 0.02, planeGeo(dw - 0.2, 1.5, 1), shattered ? 'glassBroken' : 'glassShop');
      putI('sf.handle', da + 0.3, 1.05, inset + 0.02, boxGeo(0.04, 0.55, 0.04), 'chrome');

      // transom + fascia sign
      const fy = groundH - transom / 2 - 0.18;
      put(sc, fy, inset * 0.8, shopW - 0.42, transom + 0.36, inset * 1.6, 'metalDarkPainted', 'facade', 1);
      const sign = this._signMaterial(rng);
      const sw = shopW - 0.75;
      const sh = (transom + 0.2) * 0.86;
      const [sx, , sz] = W(sc, 0, inset * 1.6 + 0.03);
      b.instance(`sf.sign.${sw.toFixed(1)}x${sh.toFixed(1)}`, planeGeo(sw, sh), sign.m,
        mat4(sx, fy, sz, yaw));
      // sign lightbox housing
      putI(`sf.signbox.${shopW.toFixed(1)}`, sc, fy, inset * 1.5, boxGeo(shopW - 0.6, sh + 0.16, 0.14), 'metalPainted');

      // awning over the display window
      if (rng.bool(0.5)) {
        const [ax, , az] = W(sc, 0, inset);
        const tint = rng.pick([0x8a2f2a, 0x1f4a2e, 0x223d63, 0x5a4a22, 0x3a2233]);
        awning(b, this.phys, rng, {
          x: ax, y: groundH - transom - 0.35, z: az, nx, nz,
          width: shopW - 0.7, mat: this.materials.variant('canvasAwning', { color: tint }),
        });
      }
      // projecting blade sign on some shops
      if (rng.bool(0.22)) {
        const [bx, , bz] = W(sc + shopW * 0.34, 0, inset + 0.9);
        const tex = makeBladeSign(rng);
        const bm = this.materials.std({ map: tex, roughness: 0.72, side: THREE.DoubleSide });
        b.instance('sf.blade', planeGeo(0.55, 1.7), bm,
          mat4(bx, groundH + 0.7, bz, yaw + Math.PI / 2));
        b.instance('sf.bladearm', boxGeo(0.05, 0.05, 0.9), 'metalDarkPainted',
          mat4(bx, groundH + 1.5, bz, yaw + Math.PI / 2));
      }
    }
  }

  _lobby(b, o) {
    const { a0, a1, width, groundH, W, put, putI, yaw, nx, nz, rng, A, damage, inset } = o;
    const cw = width;
    const ca = (a0 + a1) / 2;
    // stone base with a recessed glazed entrance
    put(ca, groundH / 2, inset / 2, width, groundH, inset, A.base, 'facade', 2.0);
    const ew = Math.min(5.4, width * 0.4);
    // carve the entrance by placing the glazing forward of a void
    putI(`lb.glass.${ew.toFixed(1)}`, ca, groundH * 0.42, inset - 0.16,
      planeGeo(ew, groundH * 0.72, 1.5), damage > 0.5 ? 'glassBroken' : 'glassShop');
    putI(`lb.int.${ew.toFixed(1)}`, ca, groundH * 0.42, 0.06,
      planeGeo(ew + 0.4, groundH * 0.78), this._interiorMaterial(rng));
    // reveal jambs so the entrance reads as a real recess
    putI('lb.jamb', ca - ew / 2 - 0.1, groundH * 0.42, inset * 0.5, boxGeo(0.2, groundH * 0.8, inset), A.base);
    putI('lb.jamb', ca + ew / 2 + 0.1, groundH * 0.42, inset * 0.5, boxGeo(0.2, groundH * 0.8, inset), A.base);
    putI(`lb.head.${ew.toFixed(1)}`, ca, groundH * 0.84, inset * 0.6, boxGeo(ew + 0.6, 0.3, inset * 1.4), A.trim);
    // revolving-door drum suggestion
    putI('lb.drum', ca, 1.15, inset - 0.5, cylGeo(1.05, 1.05, 2.3, 14, true), 'chrome');
    putI('lb.canopy', ca, groundH * 0.9, inset + 0.7, boxGeo(ew + 1.2, 0.16, 1.6), 'metalDarkPainted');
    for (const s of [-1, 1]) {
      putI('lb.canopyrod', ca + s * (ew / 2 + 0.4), groundH * 0.9 + 0.5, inset + 0.4, boxGeo(0.04, 1.0, 0.04), 'chrome');
    }
    // address numerals
    put(ca, groundH - 0.35, inset + 0.08, 1.4, 0.4, 0.06, 'chrome', 'facade', 1);
  }

  _loadingDock(b, o) {
    const { a0, a1, width, groundH, W, put, putI, yaw, nx, nz, rng, A, damage } = o;
    const inset = 0.26;
    const ca = (a0 + a1) / 2;
    put(ca, groundH / 2, inset / 2, width, groundH, inset, A.base, 'facade', 2.0);
    const doors = Math.max(1, Math.floor(width / 5));
    for (let i = 0; i < doors; i++) {
      const da = a0 + (i + 0.5) * (width / doors);
      const dw = Math.min(3.6, width / doors - 0.8);
      putI(`ld.door.${dw.toFixed(1)}`, da, 1.9, inset - 0.05, boxGeo(dw, 3.4, 0.1),
        rng.bool(0.5) ? 'metalRust' : 'metalPainted');
      // roll-up door slats
      for (let k = 0; k < 11; k++) {
        putI(`ld.slat.${dw.toFixed(1)}`, da, 0.35 + k * 0.31, inset + 0.01, boxGeo(dw - 0.06, 0.05, 0.05), 'metalDarkPainted');
      }
      // concrete dock ledge
      putI(`ld.ledge.${dw.toFixed(1)}`, da, 0.55, inset + 0.55, boxGeo(dw + 0.4, 1.1, 1.1), 'concreteDark');
      const [lx, , lz] = W(da, 0, inset + 0.55);
      this.phys.addBox(lx, 0.55, lz, (dw + 0.4) / 2, 0.55, 0.55, yaw, 'concrete', 1 | 2);
      // bumper
      putI(`ld.bump.${dw.toFixed(1)}`, da, 0.95, inset + 1.12, boxGeo(dw * 0.8, 0.18, 0.14), 'rubber');
    }
  }

  _stoopBase(b, o) {
    const { a0, a1, width, groundH, bays, bw, W, put, putI, yaw, nx, nz, rng, A, damage } = o;
    const inset = 0.26;
    const ca = (a0 + a1) / 2;
    put(ca, groundH / 2, inset / 2, width, groundH, inset, A.base, 'facade', 2.0);

    // basement windows behind area railings
    for (let i = 0; i < bays; i++) {
      const wa = a0 + (i + 0.5) * bw;
      if (rng.bool(0.55)) {
        putI('sb.bwin', wa, 0.85, inset - 0.05, planeGeo(bw * 0.5, 0.8, 1), 'glassDark');
        putI('sb.bguard', wa, 0.85, inset + 0.04, planeGeo(bw * 0.55, 0.86, 0.24), 'grate');
      }
    }

    // the stoop itself
    const sa = ca + rng.sym(width * 0.18);
    const steps = 6;
    const sw = 1.9;
    for (let i = 0; i < steps; i++) {
      const d = inset + 0.35 + (steps - i) * 0.31;
      putI('st.step', sa, 0.12 + i * 0.185, d, boxGeo(sw, 0.19, 0.34), A.base);
    }
    const [px, , pz] = W(sa, 0, inset + 0.4);
    this.phys.addBox(px, 0.6, pz, sw / 2, 0.6, 1.2, yaw, 'concrete', 1 | 2);
    // cheek walls
    for (const s of [-1, 1]) {
      const m = mat4(...W(sa + s * (sw / 2 + 0.12), 0.62, inset + 1.3), yaw);
      m.multiply(new THREE.Matrix4().makeRotationX(0.0));
      b.instance('st.cheek', boxGeo(0.24, 1.2, 2.1), A.base, m);
    }
    // railings
    for (const s of [-1, 1]) {
      const [rx, , rz] = W(sa + s * (sw / 2 + 0.1), 0, inset + 1.3);
      b.instance('st.rail', boxGeo(0.045, 0.045, 2.2), 'fireEscape', mat4(rx, 1.55, rz, yaw));
      for (let k = 0; k < 7; k++) {
        const [bx, , bz] = W(sa + s * (sw / 2 + 0.1), 0, inset + 0.4 + k * 0.3);
        b.instance('st.bal', boxGeo(0.022, 0.7, 0.022), 'fireEscape', mat4(bx, 1.2 + k * 0.06, bz, yaw));
      }
    }
    // entry door at the top of the stoop
    putI('sb.door', sa, groundH * 0.42, inset - 0.04, boxGeo(1.15, 2.2, 0.1), 'wood');
    putI('sb.dtrim', sa, groundH * 0.42 + 0.05, inset + 0.06, boxGeo(1.45, 2.4, 0.12), A.trim);
    putI('sb.dglass', sa, groundH * 0.42 + 0.72, inset + 0.02, planeGeo(0.8, 0.6, 1), 'glassDark');
  }

  /* ---------------------- collapsed structure ---------------------- */

  _collapseTop(b, rng, lot, core, y0, fullHeight, wallMat, floorH) {
    const cw = core.x1 - core.x0, cd = core.z1 - core.z0;
    const ccx = (core.x0 + core.x1) / 2, ccz = (core.z0 + core.z1) / 2;
    // Remaining structure: a wedge of the original mass sheared diagonally.
    const dir = rng.next() * TAU;
    const steps = 5;
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const h = (fullHeight - y0) * (1 - t) * rng.range(0.5, 0.9);
      if (h < 0.6) continue;
      const w = cw * (0.85 - t * 0.6);
      const d = cd * (0.85 - t * 0.6);
      const ox = Math.cos(dir) * cw * 0.16 * t;
      const oz = Math.sin(dir) * cd * 0.16 * t;
      b.box(w, h, d, ccx + ox, y0 + h / 2, ccz + oz, wallMat, rng.sym(0.06), 'ruin', 2.6);
      this.phys.addBox(ccx + ox, y0 + h / 2, ccz + oz, w / 2, h / 2, d / 2, 0, 'brick', 1 | 2);
      // exposed concrete floor plate
      b.box(w * 1.02, 0.22, d * 1.02, ccx + ox, y0 + h, ccz + oz, 'concreteDark', 0, 'ruin', 2.5);
      // twisted rebar
      for (let k = 0; k < 5; k++) {
        const a = rng.next() * TAU;
        const rx = ccx + ox + Math.cos(a) * w * 0.45;
        const rz = ccz + oz + Math.sin(a) * d * 0.45;
        const m = mat4(rx, y0 + h + 0.5, rz, rng.next() * TAU, rng.sym(0.7), rng.sym(0.7));
        b.instance('cl.rebar', cylGeo(0.016, 0.016, 1.3, 5), 'metalRust', m);
      }
    }
    // Rubble spilling down the face
    for (let i = 0; i < 16; i++) {
      const a = rng.next() * TAU;
      const r = rng.range(0.3, 0.7);
      const s = rng.range(0.5, 1.8);
      b.instance('cl.chunk', boxGeo(1, 1, 1), 'rubble',
        mat4(ccx + Math.cos(a) * cw * r, y0 - rng.range(0, 6), ccz + Math.sin(a) * cd * r,
          rng.next() * TAU, rng.sym(0.8), rng.sym(0.8), s, s * rng.range(0.5, 1), s * rng.range(0.6, 1.2)));
    }
  }
}
