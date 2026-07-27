import * as THREE from 'three';
import { DEG, clamp01, lerp } from '../core/math.js';

/**
 * Late-afternoon storm over Manhattan. Heavy overcast with a break in the deck
 * that the sun is punching through low and to the west, so the avenue running
 * that way gets a hard warm rake and everything else sits in cool bounce.
 */
const SKY_FRAG = /* glsl */`
precision highp float;
varying vec3 vWorld;
uniform vec3 uSunDir;
uniform vec3 uZenith, uHorizon, uGroundCol;
uniform vec3 uSunTint, uHazeTint;
uniform float uTime, uCloudCover, uCloudSharp, uHazeHeight, uSunPower, uExposure;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                 mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                 mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 6; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return v;
}

void main() {
  vec3 dir = normalize(vWorld);
  float up = dir.y;

  // --- base gradient -------------------------------------------------
  float t = clamp(up * 0.5 + 0.5, 0.0, 1.0);
  float horizonMix = pow(1.0 - clamp(abs(up), 0.0, 1.0), 3.2);
  vec3 sky = mix(uHorizon, uZenith, smoothstep(0.0, 0.62, up));

  // pollution / haze band sitting on the horizon
  float haze = exp(-max(up, 0.0) / max(uHazeHeight, 0.001));
  sky = mix(sky, uHazeTint, haze * 0.72);

  // --- cloud deck ----------------------------------------------------
  // project onto a virtual plane so clouds converge at the horizon
  float py = max(up, 0.008);
  vec2 cuv = dir.xz / py;
  vec3 q = vec3(cuv * 0.055, uTime * 0.006);
  float base = fbm(q * 1.0 + vec3(uTime * 0.004, 0.0, 0.0));
  float detail = fbm(q * 3.7 - vec3(0.0, uTime * 0.01, 0.0));
  float dens = base * 0.72 + detail * 0.34;
  dens = smoothstep(uCloudCover - uCloudSharp, uCloudCover + uCloudSharp, dens);
  dens *= smoothstep(0.0, 0.10, up);          // clouds fade into horizon haze

  // cheap single-scatter: clouds are lit from the sun side and dark underneath
  float sunAmt = max(dot(dir, uSunDir), 0.0);
  float silver = pow(sunAmt, 7.0);
  vec3 cloudLit = mix(vec3(0.62, 0.645, 0.685), uSunTint * 1.35, silver * 0.85);
  vec3 cloudDark = vec3(0.185, 0.198, 0.226);
  float thick = smoothstep(0.0, 1.0, detail);
  vec3 cloud = mix(cloudDark, cloudLit, thick * 0.62 + silver * 0.5);
  // the break in the deck: thinner cloud right around the sun
  float breakMask = smoothstep(0.55, 0.98, sunAmt);
  dens *= 1.0 - breakMask * 0.82;

  sky = mix(sky, cloud, clamp(dens, 0.0, 1.0));

  // --- sun ------------------------------------------------------------
  float disc = smoothstep(0.99955, 0.99985, sunAmt);
  float glow = pow(sunAmt, uSunPower) * 0.55 + pow(sunAmt, 12.0) * 0.35;
  sky += uSunTint * glow * (1.0 - clamp(dens, 0.0, 1.0) * 0.75);
  sky += uSunTint * disc * 9.0 * (1.0 - clamp(dens, 0.0, 1.0) * 0.9);

  // --- below the horizon ---------------------------------------------
  float below = smoothstep(0.02, -0.06, up);
  sky = mix(sky, uGroundCol, below);

  gl_FragColor = vec4(sky * uExposure, 1.0);
}`;

const SKY_VERT = /* glsl */`
varying vec3 vWorld;
void main() {
  vWorld = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
}`;

export class SkySystem {
  constructor(ctx) {
    this.ctx = ctx;
    this.rng = ctx.rng.stream('sky');
    this.time = 0;
  }

  init() {
    const render = this.ctx.get('render');
    this.render = render;

    // Sun low in the west-north-west, late afternoon, storm breaking.
    const az = 288 * DEG;
    const el = 13.5 * DEG;
    this.sunDir = new THREE.Vector3(
      Math.cos(el) * Math.sin(az),
      Math.sin(el),
      Math.cos(el) * Math.cos(az),
    ).normalize();

    this.uniforms = {
      uSunDir: { value: this.sunDir },
      uZenith: { value: new THREE.Color(0x2c3846) },
      uHorizon: { value: new THREE.Color(0x6e7683) },
      uGroundCol: { value: new THREE.Color(0x21252b) },
      uSunTint: { value: new THREE.Color(0xffd7a4) },
      uHazeTint: { value: new THREE.Color(0x9aa0a6) },
      uTime: { value: 0 },
      uCloudCover: { value: 0.44 },
      uCloudSharp: { value: 0.24 },
      uHazeHeight: { value: 0.085 },
      uSunPower: { value: 220 },
      uExposure: { value: 1.0 },
    };

    const geo = new THREE.SphereGeometry(2200, 48, 32);
    this.material = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      fog: false,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.matrixAutoUpdate = false;
    render.scene.add(this.mesh);

    // --- lighting rig --------------------------------------------------
    const sun = render.sun;
    sun.color.setHex(0xffd9b0);
    sun.intensity = 3.35;
    sun.position.copy(this.sunDir).multiplyScalar(190);

    // Cool sky bounce from above, warm-grey bounce off the asphalt below.
    this.hemi = new THREE.HemisphereLight(0x93a3ba, 0x4a463f, 1.05);
    render.scene.add(this.hemi);

    // A weak fill from the opposite side keeps the shadow side readable
    // without flattening the image the way raising ambient would.
    this.fill = new THREE.DirectionalLight(0x8fa2bd, 0.5);
    this.fill.position.set(-this.sunDir.x, 0.55, -this.sunDir.z).multiplyScalar(120);
    this.fill.castShadow = false;
    render.scene.add(this.fill);

    // Atmospheric perspective. Tuned so the far skyline dissolves but the
    // playable block stays crisp and readable for combat.
    this.fogColor = new THREE.Color(0x8b939d);
    render.scene.fog = new THREE.FogExp2(this.fogColor.getHex(), 0.0042);
    render.scene.fog.color.copy(this.fogColor);
    render.scene.background = null;

    // Build the IBL probe from the sky itself so metals and glass reflect the
    // real sky gradient rather than a flat grey. This happens during init, not
    // prewarm, so every material compiles once with the environment already
    // attached instead of relinking on the first frame.
    const probeScene = new THREE.Scene();
    const probeMesh = new THREE.Mesh(this.mesh.geometry, this.material);
    probeMesh.frustumCulled = false;
    probeScene.add(probeMesh);
    render.updateEnvironment(probeScene);
    probeScene.remove(probeMesh);
  }

  update(dt) {
    this.time += dt;
    this.uniforms.uTime.value = this.time;
    const cam = this.render.camera;
    this.mesh.position.copy(cam.position);
    this.mesh.updateMatrix();
    this.mesh.updateMatrixWorld(true);
  }

  /** Sky-relative ambient colour, used by the audio/UI systems for tinting. */
  get ambientColor() { return this.hemi.color; }

  dispose() {
    this.material.dispose();
    this.mesh.geometry.dispose();
  }
}
