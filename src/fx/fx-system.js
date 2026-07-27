import * as THREE from 'three';
import {
  ParticlePool, makeSmokeTexture, makeSparkTexture, makeDustTexture,
  makeBloodTexture, makeImpactDecal,
} from './particles.js';
import { TAU, clamp01, lerp, damp } from '../core/math.js';
import { v3 } from '../core/scratch.js';

const BUDGET = { smoke: 900, dust: 520, spark: 380, blood: 160, tracer: 96, ember: 140 };
const DECALS = 320;

/**
 * FXSystem — impacts, tracers, muzzle effects, environmental smoke and steam.
 *
 * The surface vocabulary here is what makes shooting feel like it is happening
 * to a real material: brick throws masonry dust and chips, metal throws sparks
 * and rings, glass sheets off, wood splinters, asphalt puffs grey.
 */
const SURFACE = {
  concrete: { dust: [0.72, 0.70, 0.66], chips: 7, sparks: 0, dustN: 12, sound: 'concrete' },
  brick: { dust: [0.66, 0.45, 0.36], chips: 8, sparks: 0, dustN: 14, sound: 'concrete' },
  asphalt: { dust: [0.42, 0.41, 0.40], chips: 5, sparks: 0, dustN: 10, sound: 'concrete' },
  metal: { dust: [0.55, 0.56, 0.58], chips: 2, sparks: 14, dustN: 3, sound: 'metal' },
  wood: { dust: [0.52, 0.40, 0.26], chips: 9, sparks: 0, dustN: 7, sound: 'wood' },
  glass: { dust: [0.80, 0.85, 0.88], chips: 12, sparks: 0, dustN: 5, sound: 'glass' },
  flesh: { dust: [0.45, 0.08, 0.06], chips: 0, sparks: 0, dustN: 0, sound: 'flesh' },
};

export class FxSystem {
  constructor(ctx) {
    this.ctx = ctx;
    this.rng = ctx.rng.stream('fx');
    this.wind = new THREE.Vector3(0.55, 0.05, -0.32);
    this.time = 0;
    this._decalIndex = 0;
    this._emitAccum = new Map();
  }

  init() {
    this.render = this.ctx.get('render');
    this.materials = this.ctx.get('materials');
    this.scene = this.render.scene;
    const rng = this.rng;

    const smokeTex = makeSmokeTexture(rng);
    const sparkTex = makeSparkTexture(rng);
    const dustTex = makeDustTexture(rng);
    const bloodTex = makeBloodTexture(rng);

    this.pools = {
      smoke: new ParticlePool(BUDGET.smoke, smokeTex, { renderOrder: 10 }),
      dust: new ParticlePool(BUDGET.dust, dustTex, { renderOrder: 11 }),
      spark: new ParticlePool(BUDGET.spark, sparkTex, { additive: true, emissive: 3.4, renderOrder: 12 }),
      ember: new ParticlePool(BUDGET.ember, sparkTex, { additive: true, emissive: 2.2, renderOrder: 12 }),
      blood: new ParticlePool(BUDGET.blood, bloodTex, { renderOrder: 13 }),
      tracer: new ParticlePool(BUDGET.tracer, sparkTex, { additive: true, emissive: 5.0, renderOrder: 14 }),
    };
    for (const k in this.pools) this.scene.add(this.pools[k].mesh);

    // Match the particle fog to the scene fog exactly.
    const fog = this.scene.fog;
    if (fog) {
      for (const k in this.pools) {
        const u = this.pools[k].material.uniforms;
        u.uFogDensity.value = fog.density;
        u.uFogColor.value.copy(fog.color);
      }
    }

    // --- decals ---
    this.decalKinds = ['concrete', 'brick', 'metal', 'wood', 'glass', 'asphalt', 'flesh'];
    this.decalMeshes = {};
    const per = Math.floor(DECALS / this.decalKinds.length);
    for (const k of this.decalKinds) {
      const tex = makeImpactDecal(rng, k);
      const mat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
        toneMapped: true,
      });
      const geo = new THREE.PlaneGeometry(1, 1);
      const im = new THREE.InstancedMesh(geo, mat, per);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false;
      im.renderOrder = 5;
      im.count = per;
      const hide = new THREE.Matrix4().makeScale(0, 0, 0);
      for (let i = 0; i < per; i++) im.setMatrixAt(i, hide);
      im.instanceMatrix.needsUpdate = true;
      this.scene.add(im);
      this.decalMeshes[k] = { mesh: im, cursor: 0, capacity: per };
    }

    this._m4 = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._up = new THREE.Vector3(0, 1, 0);
    this._alt = new THREE.Vector3(1, 0, 0);
    this._scale = new THREE.Vector3();

    // --- persistent environmental emitters ---
    const world = this.ctx.get('world');
    this.smokeSources = world.smokeSources;
    this.steamVents = world.steamVents;
    this.dustSources = world.dustSources;
    for (const s of this.smokeSources) s._acc = 0;
    for (const s of this.steamVents) s._acc = 0;

    // ambient floating dust motes across the whole map
    this._moteAcc = 0;
  }

  prewarm() {
    // Push one particle through every pool so the shaders link now.
    const p = this.render.camera.position;
    for (const k in this.pools) {
      this.pools[k].emit({ x: p.x, y: p.y - 40, z: p.z, life: 0.02, size: 0.01, alpha: 0.01 });
      this.pools[k].update(0.001, p, this.wind);
    }
    this.render.renderer.compile(this.scene, this.render.camera);
  }

  /* ------------------------------- impacts ------------------------------ */

  surfaceImpact(point, normal, surface, incoming) {
    const S = SURFACE[surface] || SURFACE.concrete;
    const rng = this.rng;
    const nx = normal.x, ny = normal.y, nz = normal.z;

    // reflected direction for the spall cone
    const dot = incoming.x * nx + incoming.y * ny + incoming.z * nz;
    const rx = incoming.x - 2 * dot * nx;
    const ry = incoming.y - 2 * dot * ny;
    const rz = incoming.z - 2 * dot * nz;

    // dust puff hugging the surface
    for (let i = 0; i < S.dustN; i++) {
      const sp = rng.range(0.6, 3.4);
      this.pools.dust.emit({
        x: point.x + nx * 0.03, y: point.y + ny * 0.03, z: point.z + nz * 0.03,
        vx: nx * sp + rng.sym(1.5), vy: ny * sp + rng.range(0.2, 1.6), vz: nz * sp + rng.sym(1.5),
        life: rng.range(0.45, 1.15), size: rng.range(0.06, 0.16), sizeEnd: rng.range(0.35, 0.8),
        alpha: rng.range(0.35, 0.7), drag: 2.6, gravity: -0.9, spin: rng.sym(3),
        r: S.dust[0], g: S.dust[1], b: S.dust[2], rot: rng.next() * TAU,
      });
    }
    // chips flying off
    for (let i = 0; i < S.chips; i++) {
      const sp = rng.range(3, 9);
      this.pools.dust.emit({
        x: point.x + nx * 0.02, y: point.y + ny * 0.02, z: point.z + nz * 0.02,
        vx: rx * sp + rng.sym(3), vy: ry * sp + rng.range(0.5, 3), vz: rz * sp + rng.sym(3),
        life: rng.range(0.35, 0.8), size: rng.range(0.012, 0.032), sizeEnd: rng.range(0.01, 0.02),
        alpha: 0.95, drag: 0.35, gravity: -16, spin: rng.sym(14),
        r: S.dust[0] * 0.8, g: S.dust[1] * 0.8, b: S.dust[2] * 0.8,
      });
    }
    // sparks off steel
    for (let i = 0; i < S.sparks; i++) {
      const sp = rng.range(5, 15);
      this.pools.spark.emit({
        x: point.x + nx * 0.02, y: point.y + ny * 0.02, z: point.z + nz * 0.02,
        vx: rx * sp + rng.sym(5), vy: ry * sp + rng.range(0.5, 5), vz: rz * sp + rng.sym(5),
        life: rng.range(0.14, 0.42), size: rng.range(0.012, 0.028), sizeEnd: 0.004,
        alpha: 1, drag: 1.1, gravity: -14, stretch: 0.014,
        r: 1, g: rng.range(0.55, 0.8), b: rng.range(0.15, 0.35),
      });
    }
    // a small lingering puff of settling dust
    if (S.dustN > 6) {
      this.pools.smoke.emit({
        x: point.x + nx * 0.1, y: point.y + ny * 0.1, z: point.z + nz * 0.1,
        vx: nx * 0.5, vy: 0.5, vz: nz * 0.5,
        life: rng.range(0.9, 1.8), size: 0.14, sizeEnd: rng.range(0.7, 1.2),
        alpha: 0.2, drag: 1.4, gravity: 0.25, spin: rng.sym(0.8),
        r: S.dust[0], g: S.dust[1], b: S.dust[2], rot: rng.next() * TAU,
      });
    }

    this.decal(point, normal, surface, rng.range(0.14, 0.28));
    this.ctx.events.emit('fx:impact', { point, surface, sound: S.sound });
  }

  bloodImpact(point, dir) {
    const rng = this.rng;
    for (let i = 0; i < 14; i++) {
      const sp = rng.range(1.5, 6);
      this.pools.blood.emit({
        x: point.x, y: point.y, z: point.z,
        vx: dir.x * sp + rng.sym(2.6), vy: dir.y * sp + rng.range(0.4, 2.6), vz: dir.z * sp + rng.sym(2.6),
        life: rng.range(0.3, 0.7), size: rng.range(0.02, 0.07), sizeEnd: rng.range(0.03, 0.1),
        alpha: rng.range(0.6, 1), drag: 1.8, gravity: -11, spin: rng.sym(6),
        r: 0.55, g: 0.06, b: 0.05,
      });
    }
    // fine mist
    for (let i = 0; i < 6; i++) {
      this.pools.blood.emit({
        x: point.x, y: point.y, z: point.z,
        vx: dir.x * 3 + rng.sym(1.4), vy: rng.range(0, 1.4), vz: dir.z * 3 + rng.sym(1.4),
        life: rng.range(0.35, 0.6), size: 0.06, sizeEnd: 0.24,
        alpha: 0.35, drag: 3.2, gravity: -1.5, r: 0.4, g: 0.05, b: 0.04, rot: rng.next() * TAU,
      });
    }
    this.ctx.events.emit('fx:impact', { point, surface: 'flesh', sound: 'flesh' });
  }

  decal(point, normal, kind, size) {
    const set = this.decalMeshes[kind] || this.decalMeshes.concrete;
    const i = set.cursor;
    set.cursor = (set.cursor + 1) % set.capacity;
    // orient the quad to the surface, with a random roll
    const n = v3[9].set(normal.x, normal.y, normal.z).normalize();
    const up = Math.abs(n.y) > 0.95 ? this._alt : this._up;
    const t = v3[10].crossVectors(up, n).normalize();
    const b = v3[11].crossVectors(n, t);
    const roll = this.rng.next() * TAU;
    const c = Math.cos(roll), s = Math.sin(roll);
    const m = this._m4;
    m.makeBasis(
      v3[12].copy(t).multiplyScalar(c).addScaledVector(b, s),
      v3[13].copy(t).multiplyScalar(-s).addScaledVector(b, c),
      n,
    );
    m.scale(this._scale.set(size, size, 1));
    m.setPosition(point.x + n.x * 0.012, point.y + n.y * 0.012, point.z + n.z * 0.012);
    set.mesh.setMatrixAt(i, m);
    set.mesh.instanceMatrix.needsUpdate = true;
  }

  /* ------------------------------- weapon ------------------------------- */

  tracer(from, to, speed) {
    const rng = this.rng;
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < 0.001) return;
    const life = Math.min(d / speed, 0.42);
    // only every third round is a tracer, as it would be from a real belt/mag
    if (rng.bool(0.62)) return;
    this.pools.tracer.emit({
      x: from.x, y: from.y, z: from.z,
      vx: (dx / d) * speed, vy: (dy / d) * speed, vz: (dz / d) * speed,
      life, size: 0.026, sizeEnd: 0.014, alpha: 0.95, drag: 0, gravity: -0.6,
      stretch: 0.0075, r: 1, g: 0.62, b: 0.24,
    });
  }

  muzzleSmoke(pos, dir) {
    const rng = this.rng;
    for (let i = 0; i < 3; i++) {
      this.pools.smoke.emit({
        x: pos.x, y: pos.y, z: pos.z,
        vx: dir.x * rng.range(1.5, 4) + rng.sym(0.7),
        vy: dir.y * rng.range(1.5, 4) + rng.range(0.2, 0.9),
        vz: dir.z * rng.range(1.5, 4) + rng.sym(0.7),
        life: rng.range(0.35, 0.85), size: rng.range(0.04, 0.09), sizeEnd: rng.range(0.28, 0.5),
        alpha: rng.range(0.14, 0.3), drag: 3.2, gravity: 0.55, spin: rng.sym(2.4),
        r: 0.72, g: 0.71, b: 0.69, rot: rng.next() * TAU,
      });
    }
    for (let i = 0; i < 4; i++) {
      this.pools.spark.emit({
        x: pos.x, y: pos.y, z: pos.z,
        vx: dir.x * rng.range(5, 12) + rng.sym(2.5),
        vy: dir.y * rng.range(5, 12) + rng.sym(2),
        vz: dir.z * rng.range(5, 12) + rng.sym(2.5),
        life: rng.range(0.05, 0.13), size: rng.range(0.01, 0.02), sizeEnd: 0.003,
        alpha: 1, drag: 3, gravity: -6, stretch: 0.01,
        r: 1, g: 0.72, b: 0.34,
      });
    }
  }

  explosion(pos, scale = 1) {
    const rng = this.rng;
    for (let i = 0; i < 22 * scale; i++) {
      const a = rng.next() * TAU, e = rng.range(0.1, 1.2);
      const sp = rng.range(2, 9) * scale;
      this.pools.smoke.emit({
        x: pos.x, y: pos.y, z: pos.z,
        vx: Math.cos(a) * sp, vy: e * sp * 0.7, vz: Math.sin(a) * sp,
        life: rng.range(1.4, 3.4), size: rng.range(0.4, 1) * scale, sizeEnd: rng.range(2.5, 5) * scale,
        alpha: rng.range(0.35, 0.7), drag: 1.4, gravity: 0.5, spin: rng.sym(1.2),
        r: 0.24, g: 0.22, b: 0.21, rot: rng.next() * TAU,
      });
    }
    for (let i = 0; i < 28 * scale; i++) {
      const a = rng.next() * TAU;
      const sp = rng.range(6, 22) * scale;
      this.pools.ember.emit({
        x: pos.x, y: pos.y, z: pos.z,
        vx: Math.cos(a) * sp, vy: rng.range(2, 14), vz: Math.sin(a) * sp,
        life: rng.range(0.5, 1.6), size: rng.range(0.02, 0.06), sizeEnd: 0.006,
        alpha: 1, drag: 1.2, gravity: -12, stretch: 0.008,
        r: 1, g: rng.range(0.4, 0.7), b: 0.12,
      });
    }
    this.ctx.events.emit('fx:explosion', { pos, scale });
  }

  /* ---------------------------- environmental --------------------------- */

  _emitColumn(s, dt) {
    const rng = this.rng;
    s._acc += dt * (s.rate || 0.5) * 9;
    while (s._acc >= 1) {
      s._acc -= 1;
      const sc = s.scale || 1;
      const kind = s.kind || 'ground';
      const dark = kind === 'vehicle' ? 0.13 : kind === 'ruin' ? 0.2 : 0.17;
      this.pools.smoke.emit({
        x: s.x + rng.sym(0.5 * sc), y: s.y, z: s.z + rng.sym(0.5 * sc),
        vx: rng.sym(0.5), vy: rng.range(1.1, 2.4) * sc, vz: rng.sym(0.5),
        life: rng.range(4.5, 9), size: rng.range(0.6, 1.3) * sc, sizeEnd: rng.range(4, 8) * sc,
        alpha: rng.range(0.16, 0.34), drag: 0.28, gravity: 0.34, spin: rng.sym(0.35),
        r: dark, g: dark * 0.98, b: dark * 0.96, rot: rng.next() * TAU,
      });
      // embers rising from a burning wreck
      if (kind === 'vehicle' && rng.bool(0.25)) {
        this.pools.ember.emit({
          x: s.x + rng.sym(0.4), y: s.y, z: s.z + rng.sym(0.4),
          vx: rng.sym(0.8), vy: rng.range(1.5, 3.5), vz: rng.sym(0.8),
          life: rng.range(0.8, 2.2), size: 0.022, sizeEnd: 0.004,
          alpha: 0.9, drag: 0.7, gravity: 0.6, r: 1, g: 0.45, b: 0.12,
        });
      }
    }
  }

  _emitSteam(s, dt) {
    const rng = this.rng;
    // Street steam is intermittent, not a constant fog machine.
    if (s._phase === undefined) { s._phase = rng.next() * 20; s._on = false; }
    s._phase -= dt;
    if (s._phase <= 0) {
      s._on = !s._on;
      s._phase = s._on ? rng.range(2.5, 7) : rng.range(4, 14);
    }
    if (!s._on) return;
    s._acc += dt * (s.rate || 0.6) * 7;
    while (s._acc >= 1) {
      s._acc -= 1;
      const sc = s.scale || 1;
      this.pools.smoke.emit({
        x: s.x + rng.sym(0.55 * sc), y: s.y, z: s.z + rng.sym(0.7 * sc),
        vx: rng.sym(0.35), vy: rng.range(0.7, 1.7) * sc, vz: rng.sym(0.35),
        life: rng.range(2.2, 4.6), size: rng.range(0.25, 0.6) * sc, sizeEnd: rng.range(1.8, 3.6) * sc,
        alpha: rng.range(0.1, 0.22), drag: 0.6, gravity: 0.28, spin: rng.sym(0.5),
        r: 0.82, g: 0.84, b: 0.86, rot: rng.next() * TAU,
      });
    }
  }

  update(dt, elapsed) {
    this.time += dt;
    const cam = this.render.camera;
    const rng = this.rng;

    // Wind drifts slowly so smoke columns are never static.
    const w = this.wind;
    w.x = 0.55 + Math.sin(this.time * 0.13) * 0.35;
    w.z = -0.32 + Math.cos(this.time * 0.09) * 0.3;

    // Only run emitters that are near enough to matter.
    for (const s of this.smokeSources) {
      const d = Math.hypot(s.x - cam.position.x, s.z - cam.position.z);
      if (d > 130) continue;
      this._emitColumn(s, dt * (d > 60 ? 0.45 : 1));
    }
    for (const s of this.steamVents) {
      const d = Math.hypot(s.x - cam.position.x, s.z - cam.position.z);
      if (d > 55) continue;
      this._emitSteam(s, dt);
    }

    // Airborne dust and paper drifting through the sunlight.
    this._moteAcc += dt * 16;
    while (this._moteAcc >= 1) {
      this._moteAcc -= 1;
      const a = rng.next() * TAU, r = rng.range(3, 26);
      this.pools.dust.emit({
        x: cam.position.x + Math.cos(a) * r,
        y: rng.range(0.3, 9),
        z: cam.position.z + Math.sin(a) * r,
        vx: w.x * rng.range(0.3, 1.2), vy: rng.sym(0.12), vz: w.z * rng.range(0.3, 1.2),
        life: rng.range(3, 7), size: rng.range(0.012, 0.05), sizeEnd: rng.range(0.012, 0.05),
        alpha: rng.range(0.1, 0.34), drag: 0.12, gravity: -0.045, spin: rng.sym(1.2),
        r: 0.86, g: 0.84, b: 0.79, rot: rng.next() * TAU,
      });
    }

    for (const k in this.pools) this.pools[k].update(dt, cam.position, this.wind);
  }

  get liveParticles() {
    let n = 0;
    for (const k in this.pools) n += this.pools[k].count;
    return n;
  }

  dispose() {
    for (const k in this.pools) this.pools[k].dispose();
    for (const k in this.decalMeshes) {
      this.decalMeshes[k].mesh.geometry.dispose();
      this.decalMeshes[k].mesh.material.dispose();
    }
  }
}
