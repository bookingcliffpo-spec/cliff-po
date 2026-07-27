import * as THREE from 'three';
import { clamp } from '../core/math.js';

const CELL = 8;

/**
 * Static-world physics. The city is described to this system as a set of
 * yaw-aligned oriented boxes; that is enough for buildings, walls, barriers,
 * vehicles and rubble, and it makes both capsule resolution and hitscan
 * queries branch-free and allocation-free.
 */
class Collider {
  constructor(id, cx, cy, cz, hx, hy, hz, yaw, surface, flags) {
    this.id = id;
    this.cx = cx; this.cy = cy; this.cz = cz;
    this.hx = hx; this.hy = hy; this.hz = hz;
    this.yaw = yaw;
    this.cos = Math.cos(yaw); this.sin = Math.sin(yaw);
    this.surface = surface;
    this.flags = flags;               // bit 1: blocks movement, bit 2: blocks bullets, bit 4: climbable ledge
    // conservative world AABB for the broadphase
    const ex = Math.abs(this.cos) * hx + Math.abs(this.sin) * hz;
    const ez = Math.abs(this.sin) * hx + Math.abs(this.cos) * hz;
    this.minX = cx - ex; this.maxX = cx + ex;
    this.minY = cy - hy; this.maxY = cy + hy;
    this.minZ = cz - ez; this.maxZ = cz + ez;
  }
  toLocal(x, y, z, out) {
    const dx = x - this.cx, dz = z - this.cz;
    out.x = dx * this.cos + dz * this.sin;
    out.y = y - this.cy;
    out.z = -dx * this.sin + dz * this.cos;
    return out;
  }
  toWorldDir(x, z, out) {
    out.x = x * this.cos - z * this.sin;
    out.z = x * this.sin + z * this.cos;
    return out;
  }
}

export const SOLID = 1;
export const OPAQUE = 2;
export const LEDGE = 4;
export const BREAKABLE = 8;

export class PhysicsSystem {
  constructor(ctx) {
    this.ctx = ctx;
    this.colliders = [];
    this.grid = new Map();
    this.gravity = -19.6;          // snappier than real g; standard for shooters
    this._nextId = 1;
    this._lp = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this.hit = {
      hit: false, distance: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(),
      surface: 'concrete', collider: null,
    };
    this.dynamicBodies = [];
    /**
     * Optional analytic ground height. The roadway is a displaced mesh (crown
     * camber, craters, settlement) and approximating it with boxes would either
     * float the player or drop them into the bowls, so the world hands us the
     * same function the mesh was built from.
     */
    this.terrainFn = null;
  }

  init() { }

  /* --------------------------- authoring --------------------------- */

  /** Add a yaw-aligned box collider. Returns its id. */
  addBox(cx, cy, cz, hx, hy, hz, yaw = 0, surface = 'concrete', flags = SOLID | OPAQUE) {
    const c = new Collider(this._nextId++, cx, cy, cz, hx, hy, hz, yaw, surface, flags);
    this.colliders.push(c);
    this._index(c);
    return c.id;
  }

  /** Convenience: add a collider matching a Mesh's local box geometry. */
  addFromObject(obj, surface = 'concrete', flags = SOLID | OPAQUE) {
    obj.updateWorldMatrix(true, false);
    const box = new THREE.Box3().setFromObject(obj);
    const c = box.getCenter(new THREE.Vector3());
    const s = box.getSize(new THREE.Vector3());
    return this.addBox(c.x, c.y, c.z, s.x / 2, s.y / 2, s.z / 2, 0, surface, flags);
  }

  _index(c) {
    const x0 = Math.floor(c.minX / CELL), x1 = Math.floor(c.maxX / CELL);
    const z0 = Math.floor(c.minZ / CELL), z1 = Math.floor(c.maxZ / CELL);
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const k = x * 73856093 ^ z * 19349663;
        let arr = this.grid.get(k);
        if (!arr) { arr = []; this.grid.set(k, arr); }
        arr.push(c);
      }
    }
  }

  _cell(x, z) { return this.grid.get((Math.floor(x / CELL) * 73856093) ^ (Math.floor(z / CELL) * 19349663)); }

  /**
   * Collect colliders overlapping a world AABB into `out`.
   *
   * A collider spans several grid cells, so results must be de-duplicated. A
   * per-query stamp does that in O(1) — an indexOf scan here is quadratic and
   * shows up immediately in hitscan-heavy frames.
   */
  query(minX, minY, minZ, maxX, maxY, maxZ, out) {
    out.length = 0;
    const stamp = ++this._queryStamp;
    const x0 = Math.floor(minX / CELL), x1 = Math.floor(maxX / CELL);
    const z0 = Math.floor(minZ / CELL), z1 = Math.floor(maxZ / CELL);
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const arr = this.grid.get((x * 73856093) ^ (z * 19349663));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const c = arr[i];
          if (c._stamp === stamp) continue;
          c._stamp = stamp;
          if (c.maxX < minX || c.minX > maxX) continue;
          if (c.maxY < minY || c.minY > maxY) continue;
          if (c.maxZ < minZ || c.minZ > maxZ) continue;
          out.push(c);
        }
      }
    }
    return out;
  }

  /* ------------------------ capsule resolution --------------------- */

  /**
   * Push a vertical capsule out of the world.
   * pos is the capsule's *feet* position. Mutates pos, returns contact flags.
   */
  resolveCapsule(pos, radius, height, out) {
    out.ground = false;
    out.ceiling = false;
    out.wall = false;
    out.groundNormalY = 1;
    out.surface = 'concrete';

    const bottomY = pos.y + radius;
    const topY = pos.y + height - radius;

    const list = this._scratchList || (this._scratchList = []);
    this.query(pos.x - radius - 0.6, pos.y - 0.6, pos.z - radius - 0.6,
      pos.x + radius + 0.6, pos.y + height + 0.6, pos.z + radius + 0.6, list);

    const lp = this._lp;
    for (let iter = 0; iter < 4; iter++) {
      let moved = false;
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (!(c.flags & SOLID)) continue;

        // Closest point on the capsule segment to the box, in box-local space.
        // Work with the segment's Y range and solve XZ separately: for a
        // yaw-box vs vertical capsule this is exact.
        const by = clamp(c.cy, pos.y + radius, pos.y + height - radius);
        this.toLocalXZ(c, pos.x, pos.z, lp);
        const ly = by - c.cy;

        // vertical overlap of capsule segment with box slab
        const segLo = pos.y + radius, segHi = pos.y + height - radius;
        const boxLo = c.cy - c.hy, boxHi = c.cy + c.hy;
        const vLo = Math.max(segLo - radius, boxLo);
        const vHi = Math.min(segHi + radius, boxHi);
        if (vHi < vLo) continue;

        const qx = clamp(lp.x, -c.hx, c.hx);
        const qz = clamp(lp.z, -c.hz, c.hz);
        const dx = lp.x - qx, dz = lp.z - qz;
        const dist2 = dx * dx + dz * dz;

        if (dist2 > radius * radius) continue;  // no XZ overlap

        // How far to push in Y vs XZ? Choose the cheapest axis.
        const capLo = pos.y, capHi = pos.y + height;
        const pushUp = boxHi - capLo;
        const pushDown = capHi - boxLo;
        const dist = Math.sqrt(dist2);
        const pushXZ = dist2 > 1e-8 ? radius - dist : radius - Math.max(Math.abs(lp.x) - c.hx, Math.abs(lp.z) - c.hz);

        const canStepUp = pushUp > 0 && pushUp <= 0.62 && capLo <= boxHi;
        if (canStepUp && pushUp <= pushXZ + 0.35) {
          pos.y = boxHi + 0.0005;
          out.ground = true;
          out.surface = c.surface;
          moved = true;
          continue;
        }
        if (pushDown > 0 && pushDown < pushXZ && pushDown < 0.5 && capHi >= boxLo) {
          pos.y = boxLo - height - 0.0005;
          out.ceiling = true;
          moved = true;
          continue;
        }

        // Horizontal depenetration
        let nx, nz;
        if (dist2 > 1e-8) {
          nx = dx / dist; nz = dz / dist;
        } else {
          // capsule centre inside the box footprint — push out the near face
          const ox = c.hx - Math.abs(lp.x);
          const oz = c.hz - Math.abs(lp.z);
          if (ox < oz) { nx = Math.sign(lp.x) || 1; nz = 0; }
          else { nx = 0; nz = Math.sign(lp.z) || 1; }
        }
        const pen = radius - dist;
        if (pen <= 0) continue;
        const w = this._tmp;
        w.x = nx * c.cos - nz * c.sin;
        w.z = nx * c.sin + nz * c.cos;
        pos.x += w.x * (pen + 0.0008);
        pos.z += w.z * (pen + 0.0008);
        out.wall = true;
        out.wallNormalX = w.x;
        out.wallNormalZ = w.z;
        moved = true;
      }
      if (!moved) break;
    }

    // Ground probe: short ray down from just above the feet.
    const g = this.raycast(pos.x, pos.y + 0.25, pos.z, 0, -1, 0, 0.32 + 0.25, SOLID);
    if (g.hit && g.normal.y > 0.55) {
      if (pos.y - g.point.y < 0.32) {
        pos.y = g.point.y;
        out.ground = true;
        out.groundNormalY = g.normal.y;
        out.surface = g.surface;
      }
    }

    // Analytic roadway. Colliders (kerbs, sidewalk slabs, block aprons) all sit
    // above it, so whichever is higher wins and the two never fight.
    if (this.terrainFn) {
      const ty = this.terrainFn(pos.x, pos.z);
      if (pos.y <= ty + 0.001) {
        pos.y = ty;
        out.ground = true;
        out.groundNormalY = 1;
        if (!g.hit) out.surface = 'asphalt';
      }
    }
    return out;
  }

  toLocalXZ(c, x, z, out) {
    const dx = x - c.cx, dz = z - c.cz;
    out.x = dx * c.cos + dz * c.sin;
    out.z = -dx * c.sin + dz * c.cos;
    return out;
  }

  /** Is a vertical capsule free at this position? */
  capsuleFree(x, y, z, radius, height) {
    const list = this._freeList || (this._freeList = []);
    this.query(x - radius, y, z - radius, x + radius, y + height, z + radius, list);
    const lp = this._lp;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!(c.flags & SOLID)) continue;
      if (c.cy + c.hy <= y + 0.02 || c.cy - c.hy >= y + height - 0.02) continue;
      this.toLocalXZ(c, x, z, lp);
      const qx = clamp(lp.x, -c.hx, c.hx);
      const qz = clamp(lp.z, -c.hz, c.hz);
      const dx = lp.x - qx, dz = lp.z - qz;
      if (dx * dx + dz * dz < radius * radius * 0.92) return false;
    }
    return true;
  }

  /* ----------------------------- rays ------------------------------ */

  /**
   * Ray vs the static world. Direction must be normalized.
   * Returns the shared `hit` record — copy anything you need to keep.
   */
  raycast(ox, oy, oz, dx, dy, dz, maxDist, mask = OPAQUE) {
    const hit = this.hit;
    hit.hit = false;
    hit.distance = maxDist;
    hit.collider = null;

    const list = this._rayList || (this._rayList = []);
    // Conservative AABB of the whole segment; fine for our ranges (< 220 m).
    const ex = ox + dx * maxDist, ey = oy + dy * maxDist, ez = oz + dz * maxDist;
    this.query(
      Math.min(ox, ex) - 0.1, Math.min(oy, ey) - 0.1, Math.min(oz, ez) - 0.1,
      Math.max(ox, ex) + 0.1, Math.max(oy, ey) + 0.1, Math.max(oz, ez) + 0.1, list,
    );

    let best = maxDist;
    let bestC = null, bnx = 0, bny = 0, bnz = 0;

    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!(c.flags & mask)) continue;
      // transform ray into box-local space
      const rx = ox - c.cx, rz = oz - c.cz;
      const lox = rx * c.cos + rz * c.sin;
      const loz = -rx * c.sin + rz * c.cos;
      const loy = oy - c.cy;
      const ldx = dx * c.cos + dz * c.sin;
      const ldz = -dx * c.sin + dz * c.cos;
      const ldy = dy;

      let tmin = 0, tmax = best;
      let nAxis = 0, nSign = 0;

      // X slab
      if (Math.abs(ldx) < 1e-9) { if (lox < -c.hx || lox > c.hx) continue; }
      else {
        const inv = 1 / ldx;
        let t1 = (-c.hx - lox) * inv, t2 = (c.hx - lox) * inv;
        let s = -1;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
        if (t1 > tmin) { tmin = t1; nAxis = 0; nSign = s; }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) continue;
      }
      // Y slab
      if (Math.abs(ldy) < 1e-9) { if (loy < -c.hy || loy > c.hy) continue; }
      else {
        const inv = 1 / ldy;
        let t1 = (-c.hy - loy) * inv, t2 = (c.hy - loy) * inv;
        let s = -1;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
        if (t1 > tmin) { tmin = t1; nAxis = 1; nSign = s; }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) continue;
      }
      // Z slab
      if (Math.abs(ldz) < 1e-9) { if (loz < -c.hz || loz > c.hz) continue; }
      else {
        const inv = 1 / ldz;
        let t1 = (-c.hz - loz) * inv, t2 = (c.hz - loz) * inv;
        let s = -1;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
        if (t1 > tmin) { tmin = t1; nAxis = 2; nSign = s; }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) continue;
      }

      if (tmin < 0 || tmin >= best) continue;
      best = tmin;
      bestC = c;
      if (nAxis === 0) { bnx = nSign; bny = 0; bnz = 0; }
      else if (nAxis === 1) { bnx = 0; bny = nSign; bnz = 0; }
      else { bnx = 0; bny = 0; bnz = nSign; }
    }

    if (bestC) {
      hit.hit = true;
      hit.distance = best;
      hit.point.set(ox + dx * best, oy + dy * best, oz + dz * best);
      // rotate the local normal back to world
      hit.normal.set(bnx * bestC.cos - bnz * bestC.sin, bny, bnx * bestC.sin + bnz * bestC.cos);
      hit.surface = bestC.surface;
      hit.collider = bestC;
    }
    return hit;
  }

  /** Line-of-sight test between two points. */
  lineOfSight(ax, ay, az, bx, by, bz) {
    let dx = bx - ax, dy = by - ay, dz = bz - az;
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-4) return true;
    dx /= d; dy /= d; dz /= d;
    const h = this.raycast(ax, ay, az, dx, dy, dz, d - 0.05, OPAQUE);
    return !h.hit;
  }

  /** Drop a point onto the ground; returns the ground Y (or the input y). */
  groundAt(x, y, z, maxDrop = 40) {
    const h = this.raycast(x, y, z, 0, -1, 0, maxDrop, SOLID);
    const t = this.terrainFn ? this.terrainFn(x, z) : -Infinity;
    if (h.hit) return Math.max(h.point.y, t > y ? -Infinity : t);
    return t > -Infinity ? t : y - maxDrop;
  }

  fixedUpdate(dt) {
    // Loose debris chunks thrown by explosions/impacts.
    const b = this.dynamicBodies;
    for (let i = b.length - 1; i >= 0; i--) {
      const o = b[i];
      o.life -= dt;
      if (o.life <= 0) { b.splice(i, 1); if (o.onExpire) o.onExpire(o); continue; }
      o.vy += this.gravity * dt;
      const nx = o.x + o.vx * dt, ny = o.y + o.vy * dt, nz = o.z + o.vz * dt;
      const g = this.groundAt(o.x, o.y + 0.3, o.z, 3);
      if (ny <= g && o.vy < 0) {
        o.y = g;
        o.vy = -o.vy * o.restitution;
        o.vx *= o.friction; o.vz *= o.friction;
        o.spin *= 0.6;
        if (Math.abs(o.vy) < 0.6) { o.vy = 0; o.resting = true; }
      } else {
        o.x = nx; o.y = ny; o.z = nz;
      }
      o.rot += o.spin * dt;
    }
  }

  addDebrisBody(o) { this.dynamicBodies.push(o); return o; }

  get colliderCount() { return this.colliders.length; }

  dispose() { this.colliders.length = 0; this.grid.clear(); }
}
