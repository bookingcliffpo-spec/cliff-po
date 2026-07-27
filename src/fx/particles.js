import * as THREE from 'three';
import { fbmField, worleyField, whiteField, fieldsToTexture, makeCanvas, canvasToTexture } from '../materials/procgen.js';
import { clamp01 } from '../core/math.js';

/**
 * A camera-facing particle pool.
 *
 * One InstancedBufferGeometry, one draw call per pool. Per-particle state lives
 * in plain typed arrays; nothing is allocated after construction. Particles can
 * billboard normally or stretch along their velocity (tracers, sparks, embers).
 */

const VERT = /* glsl */`
precision highp float;
in vec3 position;
in vec2 uv;
in vec3 iPos;
in vec3 iVel;
in vec4 iData;       // x: size, y: rotation, z: alpha, w: stretch
in vec3 iColor;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform vec3 uCamPos;

out vec2 vUv;
out vec3 vColor;
out float vAlpha;
out float vFog;

uniform float uFogDensity;

void main() {
  vUv = uv;
  vColor = iColor;
  vAlpha = iData.z;

  float size = iData.x;
  float rot = iData.y;
  float stretch = iData.w;

  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp    = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);

  vec3 offset;
  if (stretch > 0.0001) {
    vec3 dir = length(iVel) > 0.0001 ? normalize(iVel) : camUp;
    vec3 toCam = normalize(uCamPos - iPos);
    vec3 right = cross(dir, toCam);
    float rl = length(right);
    right = rl > 0.0001 ? right / rl : camRight;
    offset = right * (position.x * size) + dir * (position.y * (size + stretch));
  } else {
    float c = cos(rot), s = sin(rot);
    vec2 p = vec2(position.x * c - position.y * s, position.x * s + position.y * c) * size;
    offset = camRight * p.x + camUp * p.y;
  }

  vec4 mv = viewMatrix * vec4(iPos + offset, 1.0);
  // Same exp2 curve the scene fog uses, so a smoke column two blocks away
  // dissolves into the haze instead of sitting on top of it.
  float fd = uFogDensity * -mv.z;
  vFog = 1.0 - exp(-fd * fd);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */`
precision highp float;
in vec2 vUv;
in vec3 vColor;
in float vAlpha;
in float vFog;
out vec4 fragColor;
uniform sampler2D uMap;
uniform float uEmissive;
uniform vec3 uFogColor;
uniform float uAdditive;
void main() {
  vec4 t = texture(uMap, vUv);
  float a = t.a * vAlpha;
  if (a < 0.004) discard;
  vec3 c = vColor * t.rgb * uEmissive;
  // Additive effects (sparks, tracers) fade out with distance; alpha-blended
  // ones tint toward the fog colour the way real particulate does.
  c = mix(c, uFogColor * (1.0 - uAdditive), clamp(vFog, 0.0, 1.0));
  a *= mix(1.0, 1.0 - vFog, uAdditive);
  fragColor = vec4(c, a);
}`;

export class ParticlePool {
  constructor(capacity, texture, opts = {}) {
    this.capacity = capacity;
    this.count = 0;
    this.cursor = 0;

    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.data = new Float32Array(capacity * 4);
    this.color = new Float32Array(capacity * 3);

    // simulation state (CPU only)
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.size0 = new Float32Array(capacity);
    this.size1 = new Float32Array(capacity);
    this.alpha0 = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
    this.spin = new Float32Array(capacity);
    this.stretchK = new Float32Array(capacity);
    this.alive = new Uint8Array(capacity);

    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.attributes.position);
    geo.setAttribute('uv', base.attributes.uv);
    geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(this.pos, 3));
    geo.setAttribute('iVel', new THREE.InstancedBufferAttribute(this.vel, 3));
    geo.setAttribute('iData', new THREE.InstancedBufferAttribute(this.data, 4));
    geo.setAttribute('iColor', new THREE.InstancedBufferAttribute(this.color, 3));
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.geometry = geo;

    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uMap: { value: texture },
        uEmissive: { value: opts.emissive ?? 1 },
        uCamPos: { value: new THREE.Vector3() },
        uFogColor: { value: new THREE.Color(0.5, 0.55, 0.6) },
        uFogDensity: { value: 0.0042 },
        uAdditive: { value: opts.additive ? 1 : 0 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = opts.renderOrder ?? 10;
    this.mesh.matrixAutoUpdate = false;
  }

  /**
   * @param {object} p position/velocity/life/size/color spec
   */
  emit(p) {
    let i = -1;
    // find a free slot, preferring the oldest
    for (let k = 0; k < 8; k++) {
      const c = (this.cursor + k) % this.capacity;
      if (!this.alive[c]) { i = c; break; }
    }
    if (i < 0) i = this.cursor % this.capacity;      // recycle the oldest
    this.cursor = (i + 1) % this.capacity;

    this.alive[i] = 1;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = p.vx || 0; this.vel[i * 3 + 1] = p.vy || 0; this.vel[i * 3 + 2] = p.vz || 0;
    this.life[i] = 0;
    this.maxLife[i] = p.life;
    this.size0[i] = p.size;
    this.size1[i] = p.sizeEnd ?? p.size;
    this.alpha0[i] = p.alpha ?? 1;
    this.drag[i] = p.drag ?? 0.6;
    this.gravity[i] = p.gravity ?? 0;
    this.spin[i] = p.spin ?? 0;
    this.stretchK[i] = p.stretch ?? 0;
    this.data[i * 4] = p.size;
    this.data[i * 4 + 1] = p.rot ?? 0;
    this.data[i * 4 + 2] = p.alpha ?? 1;
    this.data[i * 4 + 3] = 0;
    this.color[i * 3] = p.r ?? 1;
    this.color[i * 3 + 1] = p.g ?? 1;
    this.color[i * 3 + 2] = p.b ?? 1;
    return i;
  }

  update(dt, camPos, wind) {
    let maxIndex = 0;
    let live = 0;
    const wx = wind ? wind.x : 0, wy = wind ? wind.y : 0, wz = wind ? wind.z : 0;
    for (let i = 0; i < this.capacity; i++) {
      if (!this.alive[i]) continue;
      this.life[i] += dt;
      const t = this.life[i] / this.maxLife[i];
      if (t >= 1) {
        this.alive[i] = 0;
        this.data[i * 4 + 2] = 0;
        this.data[i * 4] = 0;
        continue;
      }
      live++;
      const i3 = i * 3, i4 = i * 4;
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i3] = (this.vel[i3] + wx * dt) * d;
      this.vel[i3 + 1] = (this.vel[i3 + 1] + (this.gravity[i] + wy) * dt) * d;
      this.vel[i3 + 2] = (this.vel[i3 + 2] + wz * dt) * d;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;

      const sz = this.size0[i] + (this.size1[i] - this.size0[i]) * t;
      this.data[i4] = sz;
      this.data[i4 + 1] += this.spin[i] * dt;
      // fade in fast, out slow
      const fadeIn = Math.min(1, t / 0.12);
      const fadeOut = 1 - Math.max(0, (t - 0.35) / 0.65);
      this.data[i4 + 2] = this.alpha0[i] * fadeIn * fadeOut * fadeOut;
      if (this.stretchK[i] > 0) {
        const sp = Math.hypot(this.vel[i3], this.vel[i3 + 1], this.vel[i3 + 2]);
        this.data[i4 + 3] = sp * this.stretchK[i];
      }
      if (i > maxIndex) maxIndex = i;
    }
    this.count = live;
    this.geometry.instanceCount = live > 0 ? maxIndex + 1 : 0;
    if (live > 0 || this._wasLive) {
      this.geometry.attributes.iPos.needsUpdate = true;
      this.geometry.attributes.iVel.needsUpdate = true;
      this.geometry.attributes.iData.needsUpdate = true;
      this.geometry.attributes.iColor.needsUpdate = true;
    }
    this._wasLive = live > 0;
    this.material.uniforms.uCamPos.value.copy(camPos);
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/* ------------------------------------------------------------------ *
 *  Procedural particle textures
 * ------------------------------------------------------------------ */

export function makeSmokeTexture(rng, size = 128) {
  const f = fbmField(size, size, 4, 5, rng.stream('smoke'));
  const w = worleyField(size, size, 6, rng.stream('smokeW'), 'f2f1');
  return fieldsToTexture(size, size, (x, y, out) => {
    const i = y * size + x;
    const dx = (x / size - 0.5) * 2, dy = (y / size - 0.5) * 2;
    const r = Math.hypot(dx, dy);
    const puff = clamp01(1 - r);
    const n = f.data[i] * 0.75 + w.data[i] * 0.45;
    let a = clamp01(puff * puff * (0.35 + n * 1.1) * 1.35);
    a *= clamp01(1 - Math.pow(r, 2.2));
    const v = 0.72 + f.data[i] * 0.35;
    out.r = v * 255; out.g = v * 255; out.b = v * 255;
    out.a = a * 255;
  }, { wrap: THREE.ClampToEdgeWrapping, srgb: false });
}

export function makeSparkTexture(rng, size = 64) {
  return fieldsToTexture(size, size, (x, y, out) => {
    const dx = (x / size - 0.5) * 2, dy = (y / size - 0.5) * 2;
    // narrow vertical streak, bright core
    const a = clamp01(1 - Math.abs(dx) * 3.2) * clamp01(1 - Math.abs(dy) * 1.05);
    const core = Math.pow(a, 2.5);
    out.r = 255; out.g = (170 + core * 85);
    out.b = (90 + core * 120);
    out.a = clamp01(a * 1.2) * 255;
  }, { wrap: THREE.ClampToEdgeWrapping, srgb: false });
}

export function makeDustTexture(rng, size = 96) {
  const f = fbmField(size, size, 6, 4, rng.stream('dust'));
  return fieldsToTexture(size, size, (x, y, out) => {
    const i = y * size + x;
    const dx = (x / size - 0.5) * 2, dy = (y / size - 0.5) * 2;
    const r = Math.hypot(dx, dy);
    const a = clamp01((1 - r) * (0.4 + f.data[i] * 1.2));
    out.r = 255; out.g = 250; out.b = 240;
    out.a = clamp01(a * a * 1.4) * 255;
  }, { wrap: THREE.ClampToEdgeWrapping, srgb: false });
}

export function makeBloodTexture(rng, size = 64) {
  const f = fbmField(size, size, 8, 3, rng.stream('blood'));
  return fieldsToTexture(size, size, (x, y, out) => {
    const i = y * size + x;
    const dx = (x / size - 0.5) * 2, dy = (y / size - 0.5) * 2;
    const r = Math.hypot(dx, dy);
    const a = clamp01((1 - r * 1.05) * (0.5 + f.data[i]));
    out.r = 255; out.g = 60; out.b = 45;
    out.a = clamp01(a * a * 1.6) * 255;
  }, { wrap: THREE.ClampToEdgeWrapping, srgb: false });
}

/** Bullet hole decals — one atlas row per surface family. */
export function makeImpactDecal(rng, kind, size = 128) {
  const f = fbmField(size, size, 7, 4, rng.stream(`dec${kind}`));
  const cr = worleyField(size, size, 9, rng.stream(`decC${kind}`), 'f2f1');
  const cfg = {
    concrete: { hole: 0.13, ring: 0.42, holeCol: [22, 21, 20], ringCol: [186, 182, 172], spall: 1.0 },
    brick: { hole: 0.14, ring: 0.4, holeCol: [26, 16, 13], ringCol: [176, 150, 132], spall: 0.95 },
    metal: { hole: 0.1, ring: 0.24, holeCol: [12, 12, 14], ringCol: [198, 200, 205], spall: 0.35 },
    wood: { hole: 0.12, ring: 0.34, holeCol: [24, 16, 9], ringCol: [150, 118, 76], spall: 0.8 },
    glass: { hole: 0.1, ring: 0.62, holeCol: [16, 20, 22], ringCol: [222, 232, 238], spall: 1.3 },
    asphalt: { hole: 0.14, ring: 0.36, holeCol: [14, 14, 14], ringCol: [128, 126, 122], spall: 0.9 },
    flesh: { hole: 0.18, ring: 0.5, holeCol: [48, 8, 6], ringCol: [128, 20, 16], spall: 0.6 },
  }[kind] || { hole: 0.13, ring: 0.4, holeCol: [22, 21, 20], ringCol: [180, 176, 168], spall: 1 };

  return fieldsToTexture(size, size, (x, y, out) => {
    const i = y * size + x;
    const dx = (x / size - 0.5) * 2, dy = (y / size - 0.5) * 2;
    const r = Math.hypot(dx, dy);
    const ang = Math.atan2(dy, dx);
    // irregular crater edge
    const wob = 1 + (f.data[i] - 0.5) * 0.55;
    const holeR = cfg.hole * wob;
    const ringR = cfg.ring * wob;

    let a = 0;
    let cr_ = 0, cg = 0, cb = 0;
    if (r < holeR) {
      a = 1;
      cr_ = cfg.holeCol[0]; cg = cfg.holeCol[1]; cb = cfg.holeCol[2];
    } else if (r < ringR) {
      const t = (r - holeR) / (ringR - holeR);
      a = (1 - t) * (0.55 + f.data[i] * 0.7) * cfg.spall;
      const s = 0.6 + f.data[i] * 0.7;
      cr_ = cfg.ringCol[0] * s; cg = cfg.ringCol[1] * s; cb = cfg.ringCol[2] * s;
      // radial spall streaks
      const streak = Math.pow(Math.abs(Math.sin(ang * 9 + f.data[i] * 6)), 3);
      a *= 0.55 + streak * 0.9;
    } else if (kind === 'glass' && r < 0.95) {
      // radiating crack web well beyond the impact
      const web = Math.pow(clamp01(1 - cr.data[i] * 5), 2);
      const radial = Math.pow(Math.abs(Math.sin(ang * 7 + f.data[i] * 3)), 8);
      a = clamp01((web * 0.7 + radial * 0.5) * (1 - r)) * 0.9;
      cr_ = 230; cg = 238; cb = 244;
    }
    out.r = cr_; out.g = cg; out.b = cb;
    out.a = clamp01(a) * 255;
  }, { wrap: THREE.ClampToEdgeWrapping, srgb: true });
}
