import * as THREE from 'three';

/* ------------------------------------------------------------------ *
 *  Shared fullscreen-quad plumbing
 * ------------------------------------------------------------------ */
// three prepends "#version 300 es" for GLSL3 RawShaderMaterial, so the sources
// below must not declare it themselves.
const QUAD_VERT = /* glsl */`
precision highp float;
in vec3 position;
in vec2 uv;
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

class Pass {
  constructor(fragment, uniforms) {
    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: QUAD_VERT,
      fragmentShader: fragment,
      uniforms,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }
  render(renderer, target) {
    renderer.setRenderTarget(target || null);
    renderer.render(this.scene, this.camera);
  }
  dispose() {
    this.material.dispose();
    this.mesh.geometry.dispose();
  }
}

const HDR = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, colorSpace: THREE.NoColorSpace };

function makeRT(w, h, opts = {}) {
  const rt = new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
    ...HDR,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: opts.depth !== false,
    stencilBuffer: false,
    samples: opts.samples || 0,
    ...opts.override,
  });
  rt.texture.generateMipmaps = false;
  return rt;
}

/* ------------------------------------------------------------------ *
 *  Shaders
 * ------------------------------------------------------------------ */

const COMMON = /* glsl */`
precision highp float;
precision highp int;
in vec2 vUv;
out vec4 fragColor;
`;

const SSAO_FRAG = /* glsl */`
${COMMON}
uniform sampler2D tDepth;
uniform vec2 uRes;
uniform float uNear, uFar, uTanHalf, uAspect;
uniform float uRadius, uStrength, uBias;
uniform float uFrame;

float linDepth(vec2 uv) {
  float d = texture(tDepth, uv).r;
  float z = d * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
}

vec3 viewPos(vec2 uv, float z) {
  vec2 ndc = uv * 2.0 - 1.0;
  return vec3(ndc.x * uTanHalf * uAspect * z, ndc.y * uTanHalf * z, -z);
}

float hash(vec2 p) {
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p + 19.19);
  return fract(p.x * p.y);
}

void main() {
  float z = linDepth(vUv);
  if (z > uFar * 0.35) { fragColor = vec4(1.0); return; }
  vec3 p = viewPos(vUv, z);

  vec2 texel = 1.0 / uRes;
  // reconstruct normal from the closest depth neighbours (avoids edge bleeding)
  float zl = linDepth(vUv - vec2(texel.x, 0.0));
  float zr = linDepth(vUv + vec2(texel.x, 0.0));
  float zd = linDepth(vUv - vec2(0.0, texel.y));
  float zu = linDepth(vUv + vec2(0.0, texel.y));
  vec3 dx = (abs(zr - z) < abs(z - zl))
    ? viewPos(vUv + vec2(texel.x, 0.0), zr) - p
    : p - viewPos(vUv - vec2(texel.x, 0.0), zl);
  vec3 dy = (abs(zu - z) < abs(z - zd))
    ? viewPos(vUv + vec2(0.0, texel.y), zu) - p
    : p - viewPos(vUv - vec2(0.0, texel.y), zd);
  vec3 n = normalize(cross(dx, dy));

  float ang = hash(gl_FragCoord.xy + uFrame * 0.017) * 6.2831853;
  float ca = cos(ang), sa = sin(ang);

  // radius shrinks with distance so AO stays a contact effect
  float radius = uRadius / max(z * 0.55, 1.0);
  float occ = 0.0;
  const int N = 12;
  for (int i = 0; i < N; i++) {
    float fi = float(i);
    float a = fi * 2.3999632 + ang;                  // golden-angle spiral
    float r = radius * sqrt((fi + 0.5) / float(N));
    vec2 off = vec2(cos(a), sin(a)) * r;
    // project the world-space offset into screen space
    vec2 suv = vUv + off / (z * uTanHalf * 2.0) * vec2(1.0 / uAspect, 1.0);
    if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) continue;
    float sz = linDepth(suv);
    vec3 sp = viewPos(suv, sz);
    vec3 d = sp - p;
    float len = length(d);
    if (len < 0.0001) continue;
    float ndl = max(dot(n, d / len), 0.0);
    float rangeCheck = smoothstep(0.0, 1.0, uRadius / max(len, 0.0001));
    occ += max(ndl - uBias, 0.0) * rangeCheck;
  }
  occ /= float(N);
  float ao = clamp(1.0 - occ * uStrength, 0.0, 1.0);
  // fade AO out at distance — it is a close-contact cue only
  ao = mix(ao, 1.0, smoothstep(18.0, 46.0, z));
  fragColor = vec4(ao, ao, ao, 1.0);
}`;

const BLUR_FRAG = /* glsl */`
${COMMON}
uniform sampler2D tSrc;
uniform vec2 uDir;
uniform vec2 uRes;
void main() {
  vec2 t = uDir / uRes;
  vec4 c = texture(tSrc, vUv) * 0.2270270270;
  c += texture(tSrc, vUv + t * 1.3846153846) * 0.3162162162;
  c += texture(tSrc, vUv - t * 1.3846153846) * 0.3162162162;
  c += texture(tSrc, vUv + t * 3.2307692308) * 0.0702702703;
  c += texture(tSrc, vUv - t * 3.2307692308) * 0.0702702703;
  fragColor = c;
}`;

const AO_BLUR_FRAG = /* glsl */`
${COMMON}
uniform sampler2D tSrc;
uniform sampler2D tDepth;
uniform vec2 uDir;
uniform vec2 uRes;
uniform float uNear, uFar;
float linDepth(vec2 uv) {
  float d = texture(tDepth, uv).r;
  float z = d * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
}
void main() {
  vec2 t = uDir / uRes;
  float z0 = linDepth(vUv);
  float sum = 0.0, wsum = 0.0;
  for (int i = -3; i <= 3; i++) {
    vec2 uv = vUv + t * float(i);
    float zi = linDepth(uv);
    float w = exp(-abs(zi - z0) * 3.0) * exp(-float(i * i) * 0.16);
    sum += texture(tSrc, uv).r * w;
    wsum += w;
  }
  float v = wsum > 0.0 ? sum / wsum : texture(tSrc, vUv).r;
  fragColor = vec4(v, v, v, 1.0);
}`;

const AO_APPLY_FRAG = /* glsl */`
${COMMON}
uniform sampler2D tColor;
uniform sampler2D tAO;
uniform float uEnabled;
void main() {
  vec4 c = texture(tColor, vUv);
  float ao = mix(1.0, texture(tAO, vUv).r, uEnabled);
  // Bias toward 1 so AO reads as ambient occlusion, not a dirt multiply.
  ao = mix(1.0, ao, 0.82);
  fragColor = vec4(c.rgb * ao, c.a);
}`;

const BRIGHT_FRAG = /* glsl */`
${COMMON}
uniform sampler2D tSrc;
uniform float uThreshold, uKnee;
void main() {
  vec3 c = texture(tSrc, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float soft = clamp(l - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 0.0001);
  float contrib = max(soft, l - uThreshold) / max(l, 0.0001);
  fragColor = vec4(c * contrib, 1.0);
}`;

const COMPOSITE_FRAG = /* glsl */`
${COMMON}
uniform sampler2D tColor;
uniform sampler2D tBloom0;
uniform sampler2D tBloom1;
uniform sampler2D tBloom2;
uniform sampler2D tDepth;
uniform vec2 uRes;
uniform float uBloom, uExposure, uVignette, uGrain, uCA, uTime;
uniform float uNear, uFar, uFogDensity;
uniform vec3 uLift, uGamma, uGain;
uniform float uSaturation, uContrast;

// ACES filmic (Stephen Hill fit)
const mat3 ACESIn = mat3(
  0.59719, 0.07600, 0.02840,
  0.35458, 0.90834, 0.13383,
  0.04823, 0.01566, 0.83777);
const mat3 ACESOut = mat3(
   1.60475, -0.10208, -0.00327,
  -0.53108,  1.10813, -0.07276,
  -0.07367, -0.00605,  1.07602);
vec3 rrt(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 aces(vec3 c) {
  c = ACESIn * c;
  c = rrt(c);
  c = ACESOut * c;
  return clamp(c, 0.0, 1.0);
}

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

float hash(vec2 p) {
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p + 19.19);
  return fract(p.x * p.y);
}

void main() {
  vec2 uv = vUv;
  vec2 c2 = uv - 0.5;
  float r2 = dot(c2, c2);

  // lateral chromatic aberration, zero at the centre
  vec2 caOff = c2 * r2 * uCA;
  vec3 col;
  col.r = texture(tColor, uv + caOff).r;
  col.g = texture(tColor, uv).g;
  col.b = texture(tColor, uv - caOff).b;

  vec3 bloom = texture(tBloom0, uv).rgb * 0.55
             + texture(tBloom1, uv).rgb * 0.32
             + texture(tBloom2, uv).rgb * 0.20;
  col += bloom * uBloom;

  col *= uExposure;
  col = aces(col);

  // lift/gamma/gain grade in display space
  col = clamp(col, 0.0, 1.0);
  col = uLift + col * (uGain - uLift);
  col = pow(max(col, vec3(0.0)), uGamma);
  float l = luma(col);
  col = mix(vec3(l), col, uSaturation);
  col = clamp((col - 0.5) * uContrast + 0.5, 0.0, 1.0);

  // vignette
  float vig = 1.0 - uVignette * smoothstep(0.16, 0.78, r2);
  col *= vig;

  // film grain, stronger in shadows where sensors are noisy
  float g = hash(gl_FragCoord.xy + uTime * 13.7) - 0.5;
  col += g * uGrain * (1.0 - smoothstep(0.0, 0.7, l));

  fragColor = vec4(col, 1.0);
}`;

// FXAA 3.11 (console-quality subset) + a light unsharp mask.
const FXAA_FRAG = /* glsl */`
${COMMON}
uniform sampler2D tSrc;
uniform vec2 uRes;
uniform float uSharpen;

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

void main() {
  vec2 inv = 1.0 / uRes;
  vec3 rgbM = texture(tSrc, vUv).rgb;
  vec3 rgbNW = texture(tSrc, vUv + vec2(-1.0, -1.0) * inv).rgb;
  vec3 rgbNE = texture(tSrc, vUv + vec2( 1.0, -1.0) * inv).rgb;
  vec3 rgbSW = texture(tSrc, vUv + vec2(-1.0,  1.0) * inv).rgb;
  vec3 rgbSE = texture(tSrc, vUv + vec2( 1.0,  1.0) * inv).rgb;

  float lM = luma(rgbM);
  float lNW = luma(rgbNW), lNE = luma(rgbNE), lSW = luma(rgbSW), lSE = luma(rgbSE);
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));

  vec3 outCol = rgbM;
  if (lMax - lMin >= lMax * 0.125) {
    vec2 dir;
    dir.x = -((lNW + lNE) - (lSW + lSE));
    dir.y =  ((lNW + lSW) - (lNE + lSE));
    float reduce = max((lNW + lNE + lSW + lSE) * 0.03125, 0.0078125);
    float rcpMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + reduce);
    dir = clamp(dir * rcpMin, vec2(-8.0), vec2(8.0)) * inv;

    vec3 rgbA = 0.5 * (texture(tSrc, vUv + dir * (1.0 / 3.0 - 0.5)).rgb
                     + texture(tSrc, vUv + dir * (2.0 / 3.0 - 0.5)).rgb);
    vec3 rgbB = rgbA * 0.5 + 0.25 * (texture(tSrc, vUv + dir * -0.5).rgb
                                   + texture(tSrc, vUv + dir *  0.5).rgb);
    float lB = luma(rgbB);
    outCol = (lB < lMin || lB > lMax) ? rgbA : rgbB;
  }

  // unsharp mask restores micro-detail the resolve softened
  vec3 blur = (rgbNW + rgbNE + rgbSW + rgbSE) * 0.25;
  outCol += (outCol - blur) * uSharpen;

  fragColor = vec4(clamp(outCol, 0.0, 1.0), 1.0);
}`;

/* ------------------------------------------------------------------ *
 *  The chain
 * ------------------------------------------------------------------ */
export class PostChain {
  constructor(render) {
    this.r = render;
    this.renderer = render.renderer;
    this.bloomEnabled = true;
    this.ssaoEnabled = true;

    this.exposure = 1.0;
    this.bloomStrength = 0.34;
    this.bloomThreshold = 1.05;
    this.vignette = 0.42;
    this.grain = 0.035;
    this.ca = 0.0026;
    this.sharpen = 0.28;
    this.saturation = 1.0;
    this.contrast = 1.045;
    this.lift = new THREE.Vector3(0.008, 0.010, 0.016);
    this.gammaV = new THREE.Vector3(1.0, 0.995, 0.985);
    this.gain = new THREE.Vector3(1.0, 0.998, 0.99);

    this.aoRadius = 0.9;
    this.aoStrength = 1.15;

    this._time = 0;
    this._frame = 0;
  }

  init() {
    const u = THREE.UniformsUtils;
    this.ssao = new Pass(SSAO_FRAG, {
      tDepth: { value: null }, uRes: { value: new THREE.Vector2() },
      uNear: { value: 0.1 }, uFar: { value: 1000 },
      uTanHalf: { value: 0.5 }, uAspect: { value: 1 },
      uRadius: { value: this.aoRadius }, uStrength: { value: this.aoStrength },
      uBias: { value: 0.03 }, uFrame: { value: 0 },
    });
    this.aoBlur = new Pass(AO_BLUR_FRAG, {
      tSrc: { value: null }, tDepth: { value: null },
      uDir: { value: new THREE.Vector2(1, 0) }, uRes: { value: new THREE.Vector2() },
      uNear: { value: 0.1 }, uFar: { value: 1000 },
    });
    this.aoApply = new Pass(AO_APPLY_FRAG, {
      tColor: { value: null }, tAO: { value: null }, uEnabled: { value: 1 },
    });
    this.bright = new Pass(BRIGHT_FRAG, {
      tSrc: { value: null }, uThreshold: { value: this.bloomThreshold }, uKnee: { value: 0.55 },
    });
    this.blur = new Pass(BLUR_FRAG, {
      tSrc: { value: null }, uDir: { value: new THREE.Vector2(1, 0) }, uRes: { value: new THREE.Vector2() },
    });
    this.composite = new Pass(COMPOSITE_FRAG, {
      tColor: { value: null }, tBloom0: { value: null }, tBloom1: { value: null }, tBloom2: { value: null },
      tDepth: { value: null }, uRes: { value: new THREE.Vector2() },
      uBloom: { value: this.bloomStrength }, uExposure: { value: this.exposure },
      uVignette: { value: this.vignette }, uGrain: { value: this.grain }, uCA: { value: this.ca },
      uTime: { value: 0 }, uNear: { value: 0.1 }, uFar: { value: 1000 }, uFogDensity: { value: 0 },
      uLift: { value: this.lift }, uGamma: { value: this.gammaV }, uGain: { value: this.gain },
      uSaturation: { value: this.saturation }, uContrast: { value: this.contrast },
    });
    this.fxaa = new Pass(FXAA_FRAG, {
      tSrc: { value: null }, uRes: { value: new THREE.Vector2() }, uSharpen: { value: this.sharpen },
    });
  }

  resize(w, h) {
    this.w = w; this.h = h;
    const dispose = (rt) => { if (rt) rt.dispose(); };
    dispose(this.rtA); dispose(this.rtB); dispose(this.rtLDR);
    dispose(this.rtAO); dispose(this.rtAO2);
    if (this.bloomRTs) for (const p of this.bloomRTs) { dispose(p.a); dispose(p.b); }
    if (this.depthTex) this.depthTex.dispose();

    this.depthTex = new THREE.DepthTexture(w, h);
    this.depthTex.type = THREE.UnsignedIntType;
    this.depthTex.minFilter = THREE.NearestFilter;
    this.depthTex.magFilter = THREE.NearestFilter;

    this.rtA = makeRT(w, h);
    this.rtA.depthTexture = this.depthTex;
    this.rtB = makeRT(w, h);
    this.rtLDR = makeRT(w, h, { override: { type: THREE.UnsignedByteType } });

    const aw = Math.max(1, w >> 1), ah = Math.max(1, h >> 1);
    this.rtAO = makeRT(aw, ah, { depth: false, override: { format: THREE.RedFormat, type: THREE.UnsignedByteType } });
    this.rtAO2 = makeRT(aw, ah, { depth: false, override: { format: THREE.RedFormat, type: THREE.UnsignedByteType } });

    this.bloomRTs = [];
    for (let i = 0; i < 3; i++) {
      const s = 1 << (i + 1);
      const bw = Math.max(1, w / s | 0), bh = Math.max(1, h / s | 0);
      this.bloomRTs.push({ a: makeRT(bw, bh, { depth: false }), b: makeRT(bw, bh, { depth: false }), w: bw, h: bh });
    }
  }

  prewarm() { /* programs link on the first render() below */ }

  render(dt) {
    const R = this.renderer;
    const r = this.r;
    this._time += dt;
    this._frame++;

    const prevTarget = R.getRenderTarget();
    const prevAutoClear = R.autoClear;

    // 1. World
    R.autoClear = true;
    R.setRenderTarget(this.rtA);
    R.clear(true, true, true);
    R.render(r.scene, r.camera);

    const near = r.camera.near, far = r.camera.far;
    const tanHalf = Math.tan((r.camera.fov * Math.PI) / 360);

    // 2. Ambient occlusion from depth
    let aoTex = null;
    if (this.ssaoEnabled) {
      const su = this.ssao.material.uniforms;
      su.tDepth.value = this.depthTex;
      su.uRes.value.set(this.rtAO.width, this.rtAO.height);
      su.uNear.value = near; su.uFar.value = far;
      su.uTanHalf.value = tanHalf; su.uAspect.value = r.camera.aspect;
      su.uRadius.value = this.aoRadius; su.uStrength.value = this.aoStrength;
      su.uFrame.value = this._frame;
      this.ssao.render(R, this.rtAO);

      const bu = this.aoBlur.material.uniforms;
      bu.tDepth.value = this.depthTex;
      bu.uNear.value = near; bu.uFar.value = far;
      bu.uRes.value.set(this.rtAO.width, this.rtAO.height);
      bu.tSrc.value = this.rtAO.texture;
      bu.uDir.value.set(1, 0);
      this.aoBlur.render(R, this.rtAO2);
      bu.tSrc.value = this.rtAO2.texture;
      bu.uDir.value.set(0, 1);
      this.aoBlur.render(R, this.rtAO);
      aoTex = this.rtAO.texture;
    }

    // 3. Apply AO into rtB (ping-pong so we never read and write the same target)
    const au = this.aoApply.material.uniforms;
    au.tColor.value = this.rtA.texture;
    au.tAO.value = aoTex || this.rtA.texture;
    au.uEnabled.value = this.ssaoEnabled ? 1 : 0;
    this.aoApply.render(R, this.rtB);

    // 4. First-person weapon on top, its own depth range
    R.setRenderTarget(this.rtB);
    R.autoClear = false;
    R.clearDepth();
    R.render(r.viewScene, r.viewCamera);
    R.autoClear = true;

    // 5. Bloom pyramid
    if (this.bloomEnabled) {
      const brU = this.bright.material.uniforms;
      brU.tSrc.value = this.rtB.texture;
      brU.uThreshold.value = this.bloomThreshold;
      this.bright.render(R, this.bloomRTs[0].a);

      const blU = this.blur.material.uniforms;
      for (let i = 0; i < this.bloomRTs.length; i++) {
        const lvl = this.bloomRTs[i];
        if (i > 0) {
          // downsample from the previous blurred level
          blU.tSrc.value = this.bloomRTs[i - 1].a.texture;
          blU.uRes.value.set(lvl.w, lvl.h);
          blU.uDir.value.set(1, 0);
          this.blur.render(R, lvl.b);
          blU.tSrc.value = lvl.b.texture;
          blU.uDir.value.set(0, 1);
          this.blur.render(R, lvl.a);
        } else {
          blU.uRes.value.set(lvl.w, lvl.h);
          blU.tSrc.value = lvl.a.texture;
          blU.uDir.value.set(1, 0);
          this.blur.render(R, lvl.b);
          blU.tSrc.value = lvl.b.texture;
          blU.uDir.value.set(0, 1);
          this.blur.render(R, lvl.a);
        }
      }
    }

    // 6. Tonemap + grade
    const cu = this.composite.material.uniforms;
    cu.tColor.value = this.rtB.texture;
    cu.tBloom0.value = this.bloomEnabled ? this.bloomRTs[0].a.texture : null;
    cu.tBloom1.value = this.bloomEnabled ? this.bloomRTs[1].a.texture : null;
    cu.tBloom2.value = this.bloomEnabled ? this.bloomRTs[2].a.texture : null;
    cu.tDepth.value = this.depthTex;
    cu.uRes.value.set(this.w, this.h);
    cu.uBloom.value = this.bloomEnabled ? this.bloomStrength : 0;
    cu.uExposure.value = this.exposure;
    cu.uVignette.value = this.vignette;
    cu.uGrain.value = this.grain;
    cu.uCA.value = this.ca;
    cu.uTime.value = this._time;
    cu.uNear.value = near; cu.uFar.value = far;
    cu.uSaturation.value = this.saturation;
    cu.uContrast.value = this.contrast;
    this.composite.render(R, this.rtLDR);

    // 7. Antialias + sharpen straight to the backbuffer
    const fu = this.fxaa.material.uniforms;
    fu.tSrc.value = this.rtLDR.texture;
    fu.uRes.value.set(this.w, this.h);
    fu.uSharpen.value = this.sharpen;
    this.fxaa.render(R, null);

    R.setRenderTarget(prevTarget);
    R.autoClear = prevAutoClear;
  }

  dispose() {
    for (const p of [this.ssao, this.aoBlur, this.aoApply, this.bright, this.blur, this.composite, this.fxaa]) {
      if (p) p.dispose();
    }
    for (const rt of [this.rtA, this.rtB, this.rtLDR, this.rtAO, this.rtAO2]) if (rt) rt.dispose();
    if (this.bloomRTs) for (const p of this.bloomRTs) { p.a.dispose(); p.b.dispose(); }
    if (this.depthTex) this.depthTex.dispose();
  }
}
