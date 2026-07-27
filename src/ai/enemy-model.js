import * as THREE from 'three';
import { clamp01, lerp, TAU } from '../core/math.js';

/**
 * Enemy combatant. Geometry and materials are shared across every instance —
 * only the transforms differ — so a squad costs geometry uploads once.
 */
let SHARED = null;

function shared(materials) {
  if (SHARED) return SHARED;
  const fatigue = materials.std({ color: 0x3b3f38, roughness: 0.92, metalness: 0.02, envMapIntensity: 0.5 });
  const plate = materials.std({ color: 0x2c2f31, roughness: 0.78, metalness: 0.1, envMapIntensity: 0.6 });
  const webbing = materials.std({ color: 0x4a4a40, roughness: 0.95, metalness: 0.0 });
  const helmet = materials.std({ color: 0x33372f, roughness: 0.7, metalness: 0.08, envMapIntensity: 0.7 });
  const skin = materials.std({ color: 0x6e5140, roughness: 0.82, metalness: 0 });
  const boot = materials.std({ color: 0x1c1d1e, roughness: 0.9, metalness: 0.03 });
  const gunMat = materials.std({ color: 0x232528, roughness: 0.5, metalness: 0.6, envMapIntensity: 0.9 });
  const visor = materials.std({ color: 0x0e1416, roughness: 0.15, metalness: 0.8, envMapIntensity: 1.4 });

  SHARED = {
    mats: { fatigue, plate, webbing, helmet, skin, boot, gunMat, visor },
    geo: {
      torso: new THREE.BoxGeometry(0.42, 0.52, 0.24),
      chestRig: new THREE.BoxGeometry(0.40, 0.34, 0.12),
      pouch: new THREE.BoxGeometry(0.11, 0.13, 0.07),
      pack: new THREE.BoxGeometry(0.34, 0.4, 0.18),
      neck: new THREE.CylinderGeometry(0.055, 0.06, 0.08, 8),
      head: new THREE.BoxGeometry(0.19, 0.23, 0.21),
      helmet: new THREE.SphereGeometry(0.135, 12, 9, 0, TAU, 0, 1.5),
      helmetRim: new THREE.TorusGeometry(0.128, 0.018, 6, 14),
      visor: new THREE.BoxGeometry(0.17, 0.06, 0.02),
      upperArm: new THREE.CapsuleGeometry(0.058, 0.2, 3, 8),
      foreArm: new THREE.CapsuleGeometry(0.05, 0.18, 3, 8),
      hand: new THREE.BoxGeometry(0.08, 0.09, 0.07),
      thigh: new THREE.CapsuleGeometry(0.077, 0.25, 3, 8),
      shin: new THREE.CapsuleGeometry(0.062, 0.25, 3, 8),
      boot: new THREE.BoxGeometry(0.11, 0.08, 0.25),
      rifle: new THREE.BoxGeometry(0.05, 0.09, 0.62),
      rifleMag: new THREE.BoxGeometry(0.04, 0.15, 0.05),
      rifleStock: new THREE.BoxGeometry(0.05, 0.09, 0.18),
      barrel: new THREE.CylinderGeometry(0.011, 0.011, 0.22, 8),
      optic: new THREE.CylinderGeometry(0.018, 0.018, 0.07, 8),
    },
  };
  return SHARED;
}

export function buildEnemy(materials, rng) {
  const S = shared(materials);
  const M = S.mats, G = S.geo;
  const root = new THREE.Group();
  root.name = 'enemy';

  const mk = (geo, mat, parent, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };

  // hips → the whole body hangs off this so crouching is one transform
  const hips = new THREE.Group();
  hips.position.y = 0.92;
  root.add(hips);

  const torso = mk(G.torso, M.fatigue, hips, 0, 0.24, 0);
  mk(G.chestRig, M.plate, hips, 0, 0.26, -0.15);
  mk(G.pack, M.webbing, hips, 0, 0.2, 0.19);
  for (let i = 0; i < 3; i++) {
    mk(G.pouch, M.webbing, hips, -0.13 + i * 0.13, 0.17, -0.22);
  }
  mk(G.neck, M.skin, hips, 0, 0.53, 0);

  const headG = new THREE.Group();
  headG.position.set(0, 0.63, 0);
  hips.add(headG);
  const head = mk(G.head, M.skin, headG, 0, 0, 0);
  mk(G.helmet, M.helmet, headG, 0, 0.03, 0.005);
  const rim = mk(G.helmetRim, M.helmet, headG, 0, 0.02, 0.005, Math.PI / 2, 0, 0);
  mk(G.visor, M.visor, headG, 0, 0.0, -0.105);
  // NVG mount stub
  mk(G.pouch, M.helmet, headG, 0, 0.09, -0.11);

  const arms = [];
  for (const s of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(s * 0.245, 0.42, 0);
    hips.add(shoulder);
    const upper = mk(G.upperArm, M.fatigue, shoulder, 0, -0.13, 0);
    const elbow = new THREE.Group();
    elbow.position.set(0, -0.26, 0);
    shoulder.add(elbow);
    const fore = mk(G.foreArm, M.fatigue, elbow, 0, -0.12, 0);
    const hand = mk(G.hand, M.plate, elbow, 0, -0.25, 0);
    arms.push({ shoulder, elbow, upper, fore, hand, side: s });
  }

  const legs = [];
  for (const s of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(s * 0.105, -0.02, 0);
    hips.add(hip);
    const thigh = mk(G.thigh, M.fatigue, hip, 0, -0.17, 0);
    const knee = new THREE.Group();
    knee.position.set(0, -0.36, 0);
    hip.add(knee);
    const shin = mk(G.shin, M.fatigue, knee, 0, -0.17, 0);
    const foot = mk(G.boot, M.boot, knee, 0, -0.35, -0.06);
    legs.push({ hip, knee, thigh, shin, foot, side: s });
  }

  // weapon carried in the right hand, indexed off the left
  const gun = new THREE.Group();
  arms[1].elbow.add(gun);
  gun.position.set(-0.06, -0.26, -0.12);
  gun.rotation.set(0.1, 0.1, 0);
  mk(G.rifle, M.gunMat, gun, 0, 0, 0);
  mk(G.rifleStock, M.gunMat, gun, 0, -0.005, 0.34);
  mk(G.rifleMag, M.gunMat, gun, 0, -0.1, -0.02, 0.25, 0, 0);
  mk(G.barrel, M.gunMat, gun, 0, 0.01, -0.42, Math.PI / 2, 0, 0);
  mk(G.optic, M.gunMat, gun, 0, 0.06, -0.02, Math.PI / 2, 0, 0);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.01, -0.53);
  gun.add(muzzle);

  const flashMat = materials.std({
    color: 0x000000, emissive: 0xffb066, emissiveIntensity: 8,
    transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide,
  });
  const flash = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), flashMat);
  flash.visible = false;
  muzzle.add(flash);

  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

  return { root, hips, headG, head, torso, arms, legs, gun, muzzle, flash };
}

/**
 * Procedural animation. There is no skeleton and no clip data — poses are
 * driven directly from locomotion speed, stance and aim, which keeps enemies
 * responsive and costs nothing to author.
 */
export function animateEnemy(m, s, dt) {
  const speed = s.speed;
  const walk = clamp01(speed / 4.2);
  s.gaitPhase += dt * (2.2 + walk * 7.5);
  const g = s.gaitPhase;

  // stance
  const targetHipY = s.crouched ? 0.62 : 0.92;
  m.hips.position.y = lerp(m.hips.position.y, targetHipY, 1 - Math.exp(-12 * dt));
  m.hips.rotation.x = lerp(m.hips.rotation.x, s.crouched ? 0.22 : 0.06 + walk * 0.12, 1 - Math.exp(-10 * dt));

  // legs
  const swing = walk * 0.72;
  for (let i = 0; i < 2; i++) {
    const l = m.legs[i];
    const ph = g + (i === 0 ? 0 : Math.PI);
    l.hip.rotation.x = Math.sin(ph) * swing - (s.crouched ? 0.55 : 0) + walk * 0.05;
    l.knee.rotation.x = Math.max(0, -Math.sin(ph - 0.6)) * swing * 1.5 + (s.crouched ? 0.95 : 0.05);
  }
  // vertical bounce
  m.hips.position.y += Math.abs(Math.sin(g)) * 0.035 * walk;

  // torso counter-rotation
  m.hips.rotation.y = Math.sin(g) * 0.12 * walk;

  // arms: weapon up when aiming, low-ready otherwise
  const aim = s.aiming;
  const ra = m.arms[1], la = m.arms[0];
  const rTargetX = aim ? -1.32 : -0.75;
  const lTargetX = aim ? -1.45 : -0.85;
  ra.shoulder.rotation.x = lerp(ra.shoulder.rotation.x, rTargetX + Math.sin(g) * 0.06 * walk, 1 - Math.exp(-11 * dt));
  ra.shoulder.rotation.z = lerp(ra.shoulder.rotation.z, aim ? 0.28 : 0.12, 1 - Math.exp(-11 * dt));
  ra.elbow.rotation.x = lerp(ra.elbow.rotation.x, aim ? -0.62 : -0.9, 1 - Math.exp(-11 * dt));
  la.shoulder.rotation.x = lerp(la.shoulder.rotation.x, lTargetX - Math.sin(g) * 0.06 * walk, 1 - Math.exp(-11 * dt));
  la.shoulder.rotation.z = lerp(la.shoulder.rotation.z, aim ? -0.52 : -0.18, 1 - Math.exp(-11 * dt));
  la.elbow.rotation.x = lerp(la.elbow.rotation.x, aim ? -0.95 : -1.1, 1 - Math.exp(-11 * dt));

  // head tracks the aim point independently of the body
  m.headG.rotation.y = lerp(m.headG.rotation.y, s.headYaw, 1 - Math.exp(-9 * dt));
  m.headG.rotation.x = lerp(m.headG.rotation.x, s.headPitch, 1 - Math.exp(-9 * dt));

  // recoil shove
  if (s.recoil > 0) {
    m.gun.rotation.x = 0.1 + s.recoil * 0.5;
    ra.shoulder.rotation.x -= s.recoil * 0.16;
  } else {
    m.gun.rotation.x = 0.1;
  }
}

export function disposeShared() {
  if (!SHARED) return;
  for (const k in SHARED.geo) SHARED.geo[k].dispose();
  SHARED = null;
}
