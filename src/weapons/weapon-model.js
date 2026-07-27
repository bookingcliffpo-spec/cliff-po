import * as THREE from 'three';

/**
 * The first-person carbine, built from primitives at true scale (the receiver
 * is 4.5 cm wide, the optic tube 30 mm). It lives in the view scene, so it can
 * be modelled tight to the camera without ever intersecting world geometry.
 */

function part(group, geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = false;
  m.receiveShadow = false;
  group.add(m);
  return m;
}

export function buildCarbine(materials) {
  const G = new THREE.Group();
  G.name = 'carbine';

  const poly = materials.std({ color: 0x24262a, roughness: 0.62, metalness: 0.12, envMapIntensity: 0.9 });
  const alloy = materials.std({ color: 0x2b2e33, roughness: 0.42, metalness: 0.82, envMapIntensity: 1.2 });
  const steel = materials.std({ color: 0x1b1d20, roughness: 0.3, metalness: 0.94, envMapIntensity: 1.5 });
  const dark = materials.std({ color: 0x141518, roughness: 0.55, metalness: 0.5, envMapIntensity: 0.8 });
  const rubber = materials.std({ color: 0x191a1c, roughness: 0.92, metalness: 0.02, envMapIntensity: 0.3 });
  const glass = materials.std({
    color: 0x0d1a16, roughness: 0.06, metalness: 0.7, transparent: true, opacity: 0.55,
    envMapIntensity: 2.2,
  });
  const glow = materials.std({
    color: 0x120202, roughness: 0.4, emissive: 0xff2a12, emissiveIntensity: 4.2,
  });
  const brass = materials.std({ color: 0x8a6a2a, roughness: 0.34, metalness: 0.95, envMapIntensity: 1.4 });
  const glove = materials.std({ color: 0x2a2d31, roughness: 0.88, metalness: 0.03, envMapIntensity: 0.5 });
  const gloveTrim = materials.std({ color: 0x3c4045, roughness: 0.8, metalness: 0.05 });
  const skin = materials.std({ color: 0x8a6a52, roughness: 0.78, metalness: 0.0 });

  // ---------------- receiver ----------------
  const lower = part(G, new THREE.BoxGeometry(0.045, 0.052, 0.20), alloy, 0, -0.013, 0.03);
  part(G, new THREE.BoxGeometry(0.046, 0.038, 0.175), alloy, 0, 0.028, 0.02);   // upper
  // upper receiver rounded top
  part(G, new THREE.CylinderGeometry(0.023, 0.023, 0.175, 12, 1, false, -Math.PI / 2, Math.PI),
    alloy, 0, 0.041, 0.02, Math.PI / 2, 0, 0);
  // magwell flare
  part(G, new THREE.BoxGeometry(0.042, 0.05, 0.052), alloy, 0, -0.032, -0.008);

  // picatinny rail teeth along the top
  const toothGeo = new THREE.BoxGeometry(0.021, 0.006, 0.0068);
  for (let i = 0; i < 22; i++) {
    part(G, toothGeo, alloy, 0, 0.062, -0.075 + i * 0.0115);
  }
  part(G, new THREE.BoxGeometry(0.024, 0.008, 0.27), alloy, 0, 0.056, 0.045);

  // ejection port + dust cover + forward assist
  part(G, new THREE.BoxGeometry(0.006, 0.026, 0.05), dark, 0.024, 0.03, 0.005);
  part(G, new THREE.BoxGeometry(0.008, 0.03, 0.055), alloy, 0.026, 0.03, 0.005);
  part(G, new THREE.CylinderGeometry(0.008, 0.008, 0.016, 8), alloy, 0.026, 0.014, 0.028, 0, 0, Math.PI / 2);
  // charging handle
  part(G, new THREE.BoxGeometry(0.052, 0.012, 0.012), alloy, 0, 0.05, 0.118);
  part(G, new THREE.BoxGeometry(0.016, 0.016, 0.05), alloy, -0.02, 0.05, 0.1);

  // ---------------- handguard ----------------
  const hg = part(G, new THREE.BoxGeometry(0.042, 0.042, 0.235), poly, 0, 0.018, -0.185);
  part(G, new THREE.CylinderGeometry(0.021, 0.021, 0.235, 12), poly, 0, 0.018, -0.185, Math.PI / 2, 0, 0);
  // M-LOK style slots
  const slotGeo = new THREE.BoxGeometry(0.005, 0.009, 0.032);
  for (let s = -1; s <= 1; s += 2) {
    for (let i = 0; i < 5; i++) {
      part(G, slotGeo, dark, s * 0.0215, 0.018, -0.27 + i * 0.042);
      part(G, slotGeo, dark, s * 0.0155, -0.0, -0.27 + i * 0.042, 0, 0, s * 0.9);
    }
  }
  // handguard top rail continuation
  for (let i = 0; i < 18; i++) {
    part(G, toothGeo, alloy, 0, 0.062, -0.09 - i * 0.0115);
  }

  // ---------------- barrel + muzzle ----------------
  part(G, new THREE.CylinderGeometry(0.0092, 0.0098, 0.30, 12), steel, 0, 0.018, -0.31, Math.PI / 2, 0, 0);
  // gas block + tube
  part(G, new THREE.BoxGeometry(0.02, 0.026, 0.03), steel, 0, 0.022, -0.30);
  part(G, new THREE.CylinderGeometry(0.0032, 0.0032, 0.2, 6), steel, 0, 0.036, -0.21, Math.PI / 2, 0, 0);
  // muzzle brake with ports
  const brake = part(G, new THREE.CylinderGeometry(0.0138, 0.0138, 0.058, 12), steel, 0, 0.018, -0.455, Math.PI / 2, 0, 0);
  for (let i = 0; i < 3; i++) {
    part(G, new THREE.BoxGeometry(0.032, 0.0055, 0.0075), dark, 0, 0.018, -0.44 - i * 0.014);
  }
  part(G, new THREE.CylinderGeometry(0.0102, 0.0102, 0.062, 12), dark, 0, 0.018, -0.456, Math.PI / 2, 0, 0);

  // ---------------- optic ----------------
  const optic = new THREE.Group();
  optic.position.set(0, 0.085, 0.01);
  G.add(optic);
  part(optic, new THREE.BoxGeometry(0.03, 0.026, 0.05), alloy, 0, -0.019, 0);        // mount
  part(optic, new THREE.BoxGeometry(0.036, 0.008, 0.055), alloy, 0, -0.031, 0);      // clamp
  part(optic, new THREE.CylinderGeometry(0.0075, 0.0075, 0.012, 6), alloy, 0.02, -0.03, 0.018, 0, 0, Math.PI / 2);
  part(optic, new THREE.CylinderGeometry(0.0165, 0.0165, 0.082, 16, 1, true), alloy, 0, 0, 0, Math.PI / 2, 0, 0);
  part(optic, new THREE.TorusGeometry(0.0168, 0.0022, 6, 18), alloy, 0, 0, -0.041, 0, 0, 0);
  part(optic, new THREE.TorusGeometry(0.0168, 0.0022, 6, 18), alloy, 0, 0, 0.041, 0, 0, 0);
  const lens = part(optic, new THREE.CircleGeometry(0.0148, 20), glass, 0, 0, -0.039);
  lens.rotation.y = Math.PI;
  part(optic, new THREE.CircleGeometry(0.0148, 20), glass, 0, 0, 0.039);
  const dot = part(optic, new THREE.CircleGeometry(0.00085, 8), glow, 0, 0, 0.037);
  dot.name = 'reddot';
  // turrets
  part(optic, new THREE.CylinderGeometry(0.0072, 0.0072, 0.013, 10), alloy, 0, 0.021, 0);
  part(optic, new THREE.CylinderGeometry(0.0072, 0.0072, 0.013, 10), alloy, 0.021, 0, 0, 0, 0, Math.PI / 2);
  // killflash shade
  part(optic, new THREE.CylinderGeometry(0.0172, 0.0172, 0.022, 16, 1, true), dark, 0, 0, -0.051, Math.PI / 2, 0, 0);

  // ---------------- backup irons ----------------
  const rear = part(G, new THREE.BoxGeometry(0.024, 0.02, 0.006), alloy, 0, 0.072, 0.075);
  part(G, new THREE.BoxGeometry(0.008, 0.014, 0.007), dark, 0, 0.078, 0.075);
  part(G, new THREE.BoxGeometry(0.007, 0.026, 0.007), alloy, 0, 0.075, -0.30);
  part(G, new THREE.BoxGeometry(0.018, 0.006, 0.007), alloy, 0, 0.064, -0.30);

  // ---------------- grip / stock / trigger ----------------
  const grip = part(G, new THREE.BoxGeometry(0.032, 0.098, 0.042), poly, 0, -0.078, 0.082, 0.34, 0, 0);
  part(G, new THREE.BoxGeometry(0.034, 0.02, 0.044), rubber, 0, -0.122, 0.096, 0.34, 0, 0);
  // finger grooves
  for (let i = 0; i < 3; i++) {
    part(G, new THREE.CylinderGeometry(0.004, 0.004, 0.033, 6), dark, 0, -0.055 - i * 0.024, 0.062 - i * 0.008, 0, 0, Math.PI / 2);
  }
  // trigger guard + trigger
  part(G, new THREE.TorusGeometry(0.021, 0.0035, 6, 14, Math.PI), alloy, 0, -0.042, 0.052, 0, Math.PI / 2, 0);
  part(G, new THREE.BoxGeometry(0.006, 0.021, 0.006), steel, 0, -0.036, 0.052, 0.2, 0, 0);
  // safety selector + mag release
  part(G, new THREE.BoxGeometry(0.018, 0.007, 0.007), alloy, -0.026, -0.008, 0.062);
  part(G, new THREE.CylinderGeometry(0.005, 0.005, 0.008, 8), alloy, 0.026, -0.014, 0.05, 0, 0, Math.PI / 2);

  // buffer tube + stock
  part(G, new THREE.CylinderGeometry(0.017, 0.017, 0.155, 12), alloy, 0, -0.004, 0.205, Math.PI / 2, 0, 0);
  const stock = part(G, new THREE.BoxGeometry(0.042, 0.062, 0.10), poly, 0, -0.012, 0.235);
  part(G, new THREE.BoxGeometry(0.046, 0.03, 0.026), rubber, 0, -0.028, 0.285);      // butt pad
  part(G, new THREE.BoxGeometry(0.03, 0.024, 0.05), poly, 0, 0.022, 0.225);          // cheek riser
  part(G, new THREE.BoxGeometry(0.05, 0.014, 0.02), poly, 0, -0.038, 0.212);         // sling loop shelf

  // ---------------- magazine ----------------
  const magG = new THREE.Group();
  magG.name = 'magazine';
  magG.position.set(0, -0.062, -0.005);
  G.add(magG);
  // curved body from stacked segments
  for (let i = 0; i < 6; i++) {
    const t = i / 5;
    part(magG, new THREE.BoxGeometry(0.026, 0.026, 0.041), poly,
      0, -t * 0.125, -t * t * 0.028, -t * 0.30, 0, 0);
  }
  part(magG, new THREE.BoxGeometry(0.03, 0.012, 0.045), rubber, 0, -0.14, -0.032, -0.3, 0, 0);
  // witness holes
  for (let i = 0; i < 4; i++) {
    part(magG, new THREE.CylinderGeometry(0.0022, 0.0022, 0.028, 6), dark,
      0, -0.028 - i * 0.028, -0.004 - i * 0.006, 0, 0, Math.PI / 2);
  }
  // a round visible at the feed lips
  part(magG, new THREE.CylinderGeometry(0.0028, 0.0028, 0.024, 8), brass, 0, 0.012, -0.002, Math.PI / 2, 0, 0);

  // ---------------- hands ----------------
  const hands = new THREE.Group();
  hands.name = 'hands';
  G.add(hands);

  // firing hand wrapping the grip
  const rh = new THREE.Group();
  rh.position.set(0.012, -0.082, 0.088);
  rh.rotation.set(0.3, -0.12, 0.1);
  hands.add(rh);
  part(rh, new THREE.BoxGeometry(0.038, 0.075, 0.055), glove, 0, 0, 0);
  part(rh, new THREE.BoxGeometry(0.04, 0.03, 0.058), gloveTrim, 0, 0.03, 0.002);
  for (let i = 0; i < 4; i++) {
    part(rh, new THREE.BoxGeometry(0.017, 0.017, 0.036), glove, -0.014, 0.018 - i * 0.019, -0.03, 0.35, 0, 0);
  }
  part(rh, new THREE.BoxGeometry(0.018, 0.036, 0.02), glove, 0.016, 0.012, -0.02, 0, 0, -0.5);
  // forearm + sleeve
  part(rh, new THREE.CylinderGeometry(0.032, 0.038, 0.19, 10), gloveTrim, 0.012, 0.03, 0.115, 1.28, 0, 0.1);
  part(rh, new THREE.CylinderGeometry(0.033, 0.033, 0.03, 10), glove, 0.004, 0.036, 0.036, 1.28, 0, 0.1);

  // support hand on the handguard
  const lh = new THREE.Group();
  lh.position.set(-0.008, -0.012, -0.235);
  lh.rotation.set(0.1, 0.25, -0.35);
  hands.add(lh);
  part(lh, new THREE.BoxGeometry(0.036, 0.052, 0.072), glove, 0, 0, 0);
  part(lh, new THREE.BoxGeometry(0.038, 0.024, 0.075), gloveTrim, 0, -0.022, 0);
  for (let i = 0; i < 4; i++) {
    part(lh, new THREE.BoxGeometry(0.016, 0.03, 0.016), glove, 0.012, 0.016, -0.026 + i * 0.019, 0, 0, 0.45);
  }
  part(lh, new THREE.BoxGeometry(0.016, 0.028, 0.018), glove, -0.016, 0.008, -0.028, 0, 0, -0.45);
  part(lh, new THREE.CylinderGeometry(0.03, 0.036, 0.185, 10), gloveTrim, 0.03, -0.01, 0.115, 1.42, 0.22, 0);

  // ---------------- muzzle flash rig ----------------
  const flash = new THREE.Group();
  flash.name = 'muzzleFlash';
  flash.position.set(0, 0.018, -0.49);
  flash.visible = false;
  G.add(flash);
  const flashMat = materials.std({
    color: 0x000000, emissive: 0xffb867, emissiveIntensity: 9,
    transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide,
  });
  const flashCore = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), flashMat);
  flash.add(flashCore);
  const petalMat = materials.std({
    color: 0x000000, emissive: 0xffa03c, emissiveIntensity: 7,
    transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide,
  });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const p = new THREE.Mesh(new THREE.ConeGeometry(0.024, 0.10, 6, 1, true), petalMat);
    p.position.set(Math.cos(a) * 0.012, Math.sin(a) * 0.012, -0.045);
    p.rotation.set(-Math.PI / 2, 0, a);
    flash.add(p);
  }
  const flashLight = new THREE.PointLight(0xffb066, 0, 4, 2);
  flashLight.position.set(0, 0.018, -0.5);
  G.add(flashLight);

  return {
    root: G, optic, magazine: magG, hands, rightHand: rh, leftHand: lh,
    flash, flashLight, dot, brake, charging: null,
    materials: { poly, alloy, steel, dark, rubber, glass, glow, brass },
  };
}

/** Ejected brass, instanced and recycled. */
export function buildShellPool(materials, count = 24) {
  const geo = new THREE.CylinderGeometry(0.0046, 0.0042, 0.0195, 8);
  const mat = materials.std({ color: 0x9a7431, roughness: 0.28, metalness: 0.96, envMapIntensity: 1.6 });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  return mesh;
}
