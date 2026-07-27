import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Draw-call budget enforcement.
 *
 * Everything static in the city goes through here. Two strategies:
 *  - `add()`    bakes a transformed geometry into a per-material merge list.
 *               One draw call per material, per batch group.
 *  - `instance()` accumulates matrices for a shared geometry+material pair.
 *               One draw call per pair regardless of count.
 *
 * Nothing reaches the scene graph until `build()` runs.
 */
export class Batcher {
  constructor(materials, scene) {
    this.materials = materials;
    this.scene = scene;
    this._merge = new Map();     // materialKey -> {mat, geos[], group}
    this._inst = new Map();      // key -> {geo, mat, mats[], colors[], group}
    this.meshes = [];
    this.stats = { merged: 0, instanced: 0, drawCalls: 0, triangles: 0 };
  }

  _matOf(material) {
    return typeof material === 'string' ? this.materials.get(material) : material;
  }

  /**
   * Bake `geo` transformed by `matrix` into the merge bucket for `material`.
   * `geo` is cloned; callers keep ownership of theirs.
   */
  add(geo, matrix, material, group = 'static') {
    const mat = this._matOf(material);
    const key = `${group}|${mat.uuid}`;
    let b = this._merge.get(key);
    if (!b) { b = { mat, geos: [], group }; this._merge.set(key, b); }
    const g = geo.clone();
    if (matrix) g.applyMatrix4(matrix);
    // merge requires identical attribute sets
    if (!g.attributes.uv) {
      const count = g.attributes.position.count;
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    g.deleteAttribute('uv1');
    g.deleteAttribute('uv2');
    g.deleteAttribute('tangent');
    g.deleteAttribute('color');
    b.geos.push(g);
    return this;
  }

  /** Convenience: box baked into the merge bucket. */
  box(w, h, d, x, y, z, material, yaw = 0, group = 'static', uvScale = null) {
    const geo = boxGeo(w, h, d, uvScale);
    const m = new THREE.Matrix4();
    if (yaw) m.makeRotationY(yaw);
    m.setPosition(x, y, z);
    this.add(geo, m, material, group);
    return this;
  }

  /**
   * Accumulate an instance.
   *
   * The bucket is keyed on the geometry and material *identities*, not on the
   * caller's `key` — that is only a debug name. Callers pass cached geometry
   * (see boxGeo/planeGeo/cylGeo/…), so identical dimensions share a bucket
   * automatically and differing dimensions can never collide into one.
   */
  instance(name, geo, material, matrix, group = 'static') {
    const mat = this._matOf(material);
    const m = matrix.clone();

    // Small parts collapse onto a shared unit primitive with the dimensions
    // folded into the instance matrix. Without this, every distinct sill width
    // in the city becomes its own draw call — measured at 4300+ before, ~200
    // after — and at these sizes the UV difference is sub-pixel.
    const sub = geo.userData && geo.userData.sub;
    if (sub && (sub.always || sub.max <= UNIT_MAX)) {
      m.multiply(sub.scale);
      geo = sub.geo;
    }

    const key = `${geo.uuid}|${mat.uuid}`;
    let b = this._inst.get(key);
    if (!b) { b = { geo, mat, mats: [], group, name }; this._inst.set(key, b); }
    b.mats.push(m);
    return this;
  }

  /** Build everything and attach it under `root`. */
  build(root, opts = {}) {
    const castShadow = opts.castShadow !== false;
    const receiveShadow = opts.receiveShadow !== false;

    for (const [key, b] of this._merge) {
      if (!b.geos.length) continue;
      let merged;
      try {
        merged = mergeGeometries(b.geos, false);
      } catch (e) {
        // Attribute mismatch — fall back to per-geometry meshes so we still render.
        for (const g of b.geos) {
          const m = new THREE.Mesh(g, b.mat);
          m.castShadow = castShadow; m.receiveShadow = receiveShadow;
          root.add(m); this.meshes.push(m);
        }
        continue;
      }
      for (const g of b.geos) g.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      const mesh = new THREE.Mesh(merged, b.mat);
      mesh.name = `merge:${key}`;
      mesh.castShadow = castShadow;
      mesh.receiveShadow = receiveShadow;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      root.add(mesh);
      this.meshes.push(mesh);
      this.stats.merged++;
      this.stats.triangles += merged.index ? merged.index.count / 3 : merged.attributes.position.count / 3;
    }

    for (const [key, b] of this._inst) {
      const n = b.mats.length;
      if (!n) continue;
      const im = new THREE.InstancedMesh(b.geo, b.mat, n);
      im.name = `inst:${key}`;
      for (let i = 0; i < n; i++) im.setMatrixAt(i, b.mats[i]);
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = castShadow;
      im.receiveShadow = receiveShadow;
      im.frustumCulled = true;
      im.computeBoundingSphere();
      root.add(im);
      this.meshes.push(im);
      this.stats.instanced++;
      const tri = b.geo.index ? b.geo.index.count / 3 : b.geo.attributes.position.count / 3;
      this.stats.triangles += tri * n;
    }

    this.stats.drawCalls = this.stats.merged + this.stats.instanced;
    // Buckets holding only a handful of instances are the ones worth hunting.
    let thin = 0;
    for (const b of this._inst.values()) if (b.mats.length < 4) thin++;
    this.stats.thinBuckets = thin;
    this._merge.clear();
    this._inst.clear();
    return this;
  }

  dispose() {
    for (const m of this.meshes) {
      if (m.geometry) m.geometry.dispose();
      if (m.dispose) m.dispose();
    }
    this.meshes.length = 0;
  }
}

/* ------------------------------------------------------------------ *
 *  Geometry helpers with proper world-scale UVs
 * ------------------------------------------------------------------ */

const _boxCache = new Map();

/** Largest dimension that still collapses onto a shared unit primitive. */
export const UNIT_MAX = 3.0;

const _unitCache = new Map();
function unitPrim(kind, seg) {
  const k = `${kind}:${seg || 0}`;
  let g = _unitCache.get(k);
  if (!g) {
    g = kind === 'box' ? new THREE.BoxGeometry(1, 1, 1)
      : kind === 'plane' ? new THREE.PlaneGeometry(1, 1)
        : new THREE.CylinderGeometry(0.5, 0.5, 1, seg, 1, false);
    _unitCache.set(k, g);
  }
  return g;
}

/**
 * `always` marks geometry whose UVs are already normalised (0..1), so folding
 * the size into the matrix is lossless and size is irrelevant. Geometry with
 * metre-scale UVs only substitutes below UNIT_MAX, where the tiling difference
 * is under a pixel.
 */
function tagSub(g, kind, seg, sx, sy, sz, always = false) {
  g.userData.sub = {
    geo: unitPrim(kind, seg),
    scale: new THREE.Matrix4().makeScale(sx, sy, sz),
    max: Math.max(sx, sy, sz),
    always,
  };
  return g;
}

/**
 * A box whose UVs are in metres (so a shared tiling material looks consistent
 * whatever the box size). `uvScale` overrides metres-per-tile.
 */
export function boxGeo(w, h, d, uvScale = null) {
  const s = uvScale || 1;
  const key = `${w.toFixed(3)},${h.toFixed(3)},${d.toFixed(3)},${s}`;
  let g = _boxCache.get(key);
  if (g) return g;
  g = new THREE.BoxGeometry(w, h, d);
  tagSub(g, 'box', 0, w, h, d);
  const uv = g.attributes.uv;
  const pos = g.attributes.position;
  // BoxGeometry face order: +X, -X, +Y, -Y, +Z, -Z, 4 verts each
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    const [fu, fv] = dims[f];
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, uv.getX(k) * fu / s, uv.getY(k) * fv / s);
    }
  }
  uv.needsUpdate = true;
  g.computeBoundingBox();
  _boxCache.set(key, g);
  return g;
}

/** Unit box with 0..1 UVs — for instanced parts that carry their own material. */
export function unitBox() {
  let g = _boxCache.get('unit');
  if (!g) { g = new THREE.BoxGeometry(1, 1, 1); _boxCache.set('unit', g); }
  return g;
}

const _cylCache = new Map();
export function cylGeo(rt, rb, h, seg = 12, open = false) {
  const key = `c${rt},${rb},${h},${seg},${open}`;
  let g = _cylCache.get(key);
  if (!g) {
    g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
    // Only straight cylinders can be expressed as a scaled unit cylinder.
    // cylinder UVs are already normalised, so size never blocks substitution
    if (rt === rb && !open) tagSub(g, 'cyl', seg, rt * 2, h, rt * 2, true);
    _cylCache.set(key, g);
  }
  return g;
}

const _planeCache = new Map();
export function planeGeo(w, h, uvScale = null) {
  const key = `p${w},${h},${uvScale}`;
  let g = _planeCache.get(key);
  if (!g) {
    g = new THREE.PlaneGeometry(w, h);
    if (uvScale) {
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / uvScale, uv.getY(i) * h / uvScale);
      uv.needsUpdate = true;
    }
    tagSub(g, 'plane', 0, w, h, 1, !uvScale);
    _planeCache.set(key, g);
  }
  return g;
}

/**
 * Cached primitives. Instancing keys on geometry identity, so anything that
 * appears more than once MUST come from a cache — a freshly constructed
 * geometry per call would produce one draw call per object.
 */
const _miscCache = new Map();
function cached(key, make) {
  let g = _miscCache.get(key);
  if (!g) { g = make(); _miscCache.set(key, g); }
  return g;
}

export function sphereGeo(r, w = 10, h = 7, phiLen, thetaStart, thetaLen) {
  const k = `s${r},${w},${h},${phiLen},${thetaStart},${thetaLen}`;
  return cached(k, () => new THREE.SphereGeometry(r, w, h, 0, phiLen ?? Math.PI * 2, thetaStart ?? 0, thetaLen ?? Math.PI));
}

export function torusGeo(r, t, rs = 6, ts = 16) {
  return cached(`t${r},${t},${rs},${ts}`, () => new THREE.TorusGeometry(r, t, rs, ts));
}

export function coneGeo(r, h, seg = 8, open = false) {
  return cached(`k${r},${h},${seg},${open}`, () => new THREE.ConeGeometry(r, h, seg, 1, open));
}

export function mat4(x, y, z, yaw = 0, pitch = 0, roll = 0, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Matrix4();
  const e = new THREE.Euler(pitch, yaw, roll, 'YXZ');
  m.makeRotationFromEuler(e);
  m.scale(new THREE.Vector3(sx, sy, sz));
  m.setPosition(x, y, z);
  return m;
}

export function clearGeoCaches() {
  for (const g of _boxCache.values()) g.dispose();
  for (const g of _cylCache.values()) g.dispose();
  for (const g of _planeCache.values()) g.dispose();
  for (const g of _miscCache.values()) g.dispose();
  _boxCache.clear(); _cylCache.clear(); _planeCache.clear(); _miscCache.clear();
}
