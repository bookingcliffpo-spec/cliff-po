// =============================================================
//  HARLEM '85  —  GTA-style third-person city
//  Three.js + GLTFLoader, ES modules. All hero assets are the
//  uploaded GLBs; only roads / sidewalks / props are generated.
// =============================================================
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ---------------------------------------------------------------
//  CONFIG
// ---------------------------------------------------------------
const CONFIG = {
  assets: {
    player:   'assets/player.glb',
    car:      'assets/car.glb',
    npc:      'assets/npc.glb',
    building: 'assets/building.glb',
    asphalt:  'assets/asphalt.jpg',
    brick:    'assets/brick.jpg',
    sidewalk: 'assets/sidewalk.jpg',
  },
  gridN: 4,            // blocks per side
  block: 52,           // block footprint (units)
  road: 16,            // street width
  maxBuildings: 170,   // safety cap
  npcCount: 25,
  carCount: 6,
  buildingHeight: 20,  // normalized target height
  playerHeight: 1.85,
  npcHeight: 1.8,
  carLength: 4.4,
  // model facing offsets (radians) — flip if a model faces backwards
  carYawOffset: Math.PI,
  charYawOffset: 0,
  shadows: true,
};

const PITCH = CONFIG.block + CONFIG.road;
const SPAN = (CONFIG.gridN - 1) * PITCH;
const WORLD_HALF = SPAN / 2 + CONFIG.block / 2 + CONFIG.road; // playable bound

// ---------------------------------------------------------------
//  DOM
// ---------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const loaderEl = $('loader');
const statusEl = $('loader-status');
const barFill = $('bar-fill');
const errOverlay = $('error-overlay');
const errText = $('error-text');
const modeBadge = $('mode-badge');
const speedBadge = $('speed-badge');
const promptEl = $('prompt');
const touchUI = $('touch-ui');

function showError(msg) {
  console.error('[ASSET ERROR]', msg);
  errText.textContent = String(msg);
  errOverlay.classList.add('show');
}

// ---------------------------------------------------------------
//  RENDERER / SCENE / CAMERA
// ---------------------------------------------------------------
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = CONFIG.shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8ec9ee);
// very-far fog only, never blocks the playable area
scene.fog = new THREE.Fog(0x9fd0f0, 260, 620);

const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 1500);
camera.position.set(0, 12, 18);

// ---------------------------------------------------------------
//  LIGHTING  (bright daytime)
// ---------------------------------------------------------------
const hemi = new THREE.HemisphereLight(0xddeeff, 0x6b6b5e, 1.05);
scene.add(hemi);

const ambient = new THREE.AmbientLight(0xffffff, 0.35);
scene.add(ambient);

const sun = new THREE.DirectionalLight(0xfff2d6, 2.0);
sun.position.set(60, 90, 40);
sun.castShadow = CONFIG.shadows;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 260;
sun.shadow.bias = -0.0004;
const SHADOW_SPAN = 70; // shadow camera follows player, tight for crisp shadows
sun.shadow.camera.left = -SHADOW_SPAN;
sun.shadow.camera.right = SHADOW_SPAN;
sun.shadow.camera.top = SHADOW_SPAN;
sun.shadow.camera.bottom = -SHADOW_SPAN;
scene.add(sun);
scene.add(sun.target);

// ---------------------------------------------------------------
//  GRADIENT SKY DOME
// ---------------------------------------------------------------
(function buildSky() {
  const skyGeo = new THREE.SphereGeometry(700, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(0x3a86d6) },
      bottom: { value: new THREE.Color(0xcfeaff) },
    },
    vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `varying vec3 vP; uniform vec3 top; uniform vec3 bottom;
      void main(){ float h = clamp((normalize(vP).y*0.5)+0.5,0.0,1.0); gl_FragColor = vec4(mix(bottom, top, pow(h,0.8)),1.0); }`,
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));
})();

// ---------------------------------------------------------------
//  LOADING MANAGER + LOADERS
// ---------------------------------------------------------------
const manager = new THREE.LoadingManager();
manager.onProgress = (url, loaded, total) => {
  const pct = total ? Math.round((loaded / total) * 100) : 0;
  barFill.style.width = pct + '%';
  statusEl.textContent = `Loading assets… ${loaded}/${total}`;
};
manager.onError = (url) => showError('Failed to load: ' + url);

const gltfLoader = new GLTFLoader(manager);
const texLoader = new THREE.TextureLoader(manager);

function loadTexture(path, repeat) {
  return new Promise((res, rej) => {
    texLoader.load(path, (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(repeat, repeat);
      t.anisotropy = renderer.capabilities.getMaxAnisotropy();
      res(t);
    }, undefined, (e) => rej(new Error(`Texture ${path}: ${e.message || e}`)));
  });
}

// ---------------------------------------------------------------
//  MODEL NORMALIZER  — recenters & scales any GLB consistently
//  Returns a Group whose footprint is centered on XZ and whose
//  base sits on y = 0. userData.dims holds final world dimensions.
// ---------------------------------------------------------------
function normalizeModel(srcScene, { height, length, recenterXZ = true, bottomToZero = true }) {
  const holder = new THREE.Group();
  holder.add(srcScene);

  let box = new THREE.Box3().setFromObject(srcScene);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  // shift inner object so it's centered on XZ and bottom rests at y=0
  srcScene.position.x -= recenterXZ ? center.x : 0;
  srcScene.position.z -= recenterXZ ? center.z : 0;
  srcScene.position.y -= bottomToZero ? box.min.y : center.y;

  // scale to requested dimension
  let s = 1;
  if (height) s = height / size.y;
  else if (length) s = length / size.z;
  holder.scale.setScalar(s);

  holder.userData.dims = { w: size.x * s, h: size.y * s, d: size.z * s };
  return holder;
}

// fix vertex-colored, normal-less player meshes so they light correctly
function fixCharacter(root, { castShadow = true } = {}) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.frustumCulled = true;
    o.castShadow = castShadow;
    o.receiveShadow = false;
    const g = o.geometry;
    if (g && !g.attributes.normal && g.attributes.position) g.computeVertexNormals();
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach((m) => {
      if (!m) return;
      if (g && g.attributes.color) m.vertexColors = true;
      if ('metalness' in m) m.metalness = 0.0;
      if ('roughness' in m) m.roughness = 0.85;
      m.needsUpdate = true;
    });
  });
}

// ---------------------------------------------------------------
//  STATE
// ---------------------------------------------------------------
const colliders = [];          // Box3[] of buildings (for player + car)
const colliderCenters = [];    // Vector3[] for broadphase
const cityGroup = new THREE.Group();
scene.add(cityGroup);

let player = null;             // { holder }
let playerHeading = 0;
let playerBobT = 0;
const cars = [];               // { holder, heading, speed }
const npcs = [];               // { holder, heading, timer, bobT, speed }

let templateNPC = null, templateCar = null, templateBuilding = null;
let brickMat = null;

let mode = 'foot';             // 'foot' | 'car'
let currentCar = null;
let nearCar = null;

// camera orbit
let camYaw = Math.PI, camPitch = 0.42, camDist = 11, targetDist = 11;

// ---------------------------------------------------------------
//  TEXTURED GROUND / ROADS / SIDEWALKS
// ---------------------------------------------------------------
function buildGround(asphaltTex, sidewalkTex) {
  // whole ground = asphalt streets
  const gSize = SPAN + CONFIG.block + CONFIG.road * 3;
  asphaltTex.repeat.set(gSize / 7, gSize / 7);
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(gSize, gSize),
    new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.96, metalness: 0 })
  );
  road.rotation.x = -Math.PI / 2;
  road.receiveShadow = true;
  cityGroup.add(road);

  // painted lane lines down each street centerline
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xf4d35e });
  for (let i = 0; i <= CONFIG.gridN; i++) {
    const off = -SPAN / 2 - PITCH / 2 + i * PITCH;
    if (i === 0 || i === CONFIG.gridN) continue;
    const len = SPAN + CONFIG.block;
    const hLine = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.4), lineMat);
    hLine.rotation.x = -Math.PI / 2; hLine.position.set(0, 0.02, off);
    cityGroup.add(hLine);
    const vLine = new THREE.Mesh(new THREE.PlaneGeometry(0.4, len), lineMat);
    vLine.rotation.x = -Math.PI / 2; vLine.position.set(off, 0.02, 0);
    cityGroup.add(vLine);
  }

  // sidewalk slabs on each block + concrete curbs
  const curbMat = new THREE.MeshStandardMaterial({ color: 0xb8b8b2, roughness: 1 });
  const half = (CONFIG.gridN - 1) / 2;
  for (let i = 0; i < CONFIG.gridN; i++) {
    for (let j = 0; j < CONFIG.gridN; j++) {
      const cx = (i - half) * PITCH;
      const cz = (j - half) * PITCH;
      const swTex = sidewalkTex.clone();
      swTex.needsUpdate = true;
      swTex.wrapS = swTex.wrapT = THREE.RepeatWrapping;
      swTex.colorSpace = THREE.SRGBColorSpace;
      swTex.repeat.set(CONFIG.block / 6, CONFIG.block / 6);
      const slab = new THREE.Mesh(
        new THREE.PlaneGeometry(CONFIG.block, CONFIG.block),
        new THREE.MeshStandardMaterial({ map: swTex, roughness: 0.95 })
      );
      slab.rotation.x = -Math.PI / 2;
      slab.position.set(cx, 0.06, cz);
      slab.receiveShadow = true;
      cityGroup.add(slab);

      // four curbs (thin raised border)
      const b = CONFIG.block;
      const curbGeo = new THREE.BoxGeometry(b, 0.22, 0.6);
      [[0, -b / 2], [0, b / 2]].forEach(([dx, dz]) => {
        const m = new THREE.Mesh(curbGeo, curbMat);
        m.position.set(cx + dx, 0.11, cz + dz);
        m.receiveShadow = true; cityGroup.add(m);
      });
      const curbGeo2 = new THREE.BoxGeometry(0.6, 0.22, b);
      [[-b / 2, 0], [b / 2, 0]].forEach(([dx, dz]) => {
        const m = new THREE.Mesh(curbGeo2, curbMat);
        m.position.set(cx + dx, 0.11, cz + dz);
        m.receiveShadow = true; cityGroup.add(m);
      });
    }
  }
}

// ---------------------------------------------------------------
//  PROP PREFABS  (traffic light, street sign, lamp, stoop)
// ---------------------------------------------------------------
function makeTrafficLight() {
  const g = new THREE.Group();
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x22252b, roughness: 0.7, metalness: 0.4 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 6, 10), poleMat);
  pole.position.y = 3; pole.castShadow = true; g.add(pole);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.16, 0.16), poleMat);
  arm.position.set(1.2, 5.6, 0); g.add(arm);
  const housing = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.4, 0.4),
    new THREE.MeshStandardMaterial({ color: 0x111316, roughness: 0.6 }));
  housing.position.set(2.3, 5.0, 0); g.add(housing);
  const cols = [0xff3b30, 0xffcc00, 0x34c759];
  cols.forEach((c, i) => {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 10),
      new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: i === 2 ? 1.4 : 0.15 }));
    lamp.position.set(2.3, 5.45 - i * 0.45, 0.22); g.add(lamp);
  });
  return g;
}

function makeStreetSign() {
  const g = new THREE.Group();
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.6, metalness: 0.5 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 4.4, 8), poleMat);
  pole.position.y = 2.2; pole.castShadow = true; g.add(pole);
  const plate = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.5, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x1c7a3e, roughness: 0.5 }));
  plate.position.set(0.7, 4.2, 0); g.add(plate);
  return g;
}

function makeLamp() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x2b2b30, roughness: 0.6, metalness: 0.4 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 6.5, 10), mat);
  pole.position.y = 3.25; pole.castShadow = true; g.add(pole);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 12),
    new THREE.MeshStandardMaterial({ color: 0xfff3c4, emissive: 0xffe9a8, emissiveIntensity: 0.5 }));
  head.position.y = 6.6; g.add(head);
  return g;
}

function makeStoop() {
  // brick stoop (a few steps) — Harlem brownstone vibe, uses brick.jpg
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.35, 0.7 + i * 0.5), brickMat);
    step.position.set(0, 0.175 + i * 0.35, -(i * 0.35));
    step.castShadow = true; step.receiveShadow = true; g.add(step);
  }
  const sideGeo = new THREE.BoxGeometry(0.4, 1.4, 1.8);
  [-1.4, 1.4].forEach((x) => {
    const s = new THREE.Mesh(sideGeo, brickMat);
    s.position.set(x, 0.7, -0.2); s.castShadow = true; g.add(s);
  });
  return g;
}

// ---------------------------------------------------------------
//  CITY: place building clones around every block, lining streets
// ---------------------------------------------------------------
function buildCity() {
  const dims = templateBuilding.userData.dims;
  const bW = dims.w, bD = dims.d;
  const half = (CONFIG.gridN - 1) / 2;
  const inset = bD / 2 + 0.6;
  const tlPrefab = makeTrafficLight();
  const signPrefab = makeStreetSign();
  const lampPrefab = makeLamp();

  for (let i = 0; i < CONFIG.gridN; i++) {
    for (let j = 0; j < CONFIG.gridN; j++) {
      const cx = (i - half) * PITCH;
      const cz = (j - half) * PITCH;
      const b = CONFIG.block;

      // edges: [axis, fixedCoord, outwardDir, yaw]
      const edges = [
        { along: 'x', fixed: cz - b / 2 + inset, dir: [0, -1], yaw: Math.PI },   // north
        { along: 'x', fixed: cz + b / 2 - inset, dir: [0, 1], yaw: 0 },          // south
        { along: 'z', fixed: cx - b / 2 + inset, dir: [-1, 0], yaw: -Math.PI / 2 }, // west
        { along: 'z', fixed: cx + b / 2 - inset, dir: [1, 0], yaw: Math.PI / 2 }, // east
      ];

      edges.forEach((edge) => {
        const start = -b / 2 + bW;            // leave corners open (alleys)
        const end = b / 2 - bW;
        const stepLen = bW + 1.6;
        for (let p = start; p <= end + 0.001; p += stepLen) {
          if (colliders.length >= CONFIG.maxBuildings) return;
          const clone = templateBuilding.clone(true);
          const vary = 0.85 + Math.random() * 0.5;
          clone.scale.multiplyScalar(vary);
          let px = cx, pz = cz;
          if (edge.along === 'x') { px = cx + p; pz = edge.fixed; }
          else { px = edge.fixed; pz = cz + p; }
          clone.position.set(px, 0, pz);
          clone.rotation.y = edge.yaw + (Math.random() < 0.5 ? Math.PI : 0) + CONFIG.charYawOffset;
          cityGroup.add(clone);

          clone.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = true; } });

          // collider from world bounds
          const box = new THREE.Box3().setFromObject(clone);
          box.expandByScalar(-0.3);
          colliders.push(box);
          colliderCenters.push(box.getCenter(new THREE.Vector3()));

          // brick stoop in front of ~55% of buildings
          if (Math.random() < 0.55) {
            const stoop = makeStoop();
            stoop.position.set(px + edge.dir[0] * (bD / 2 * vary + 0.3), 0, pz + edge.dir[1] * (bD / 2 * vary + 0.3));
            stoop.rotation.y = Math.atan2(edge.dir[0], edge.dir[1]);
            cityGroup.add(stoop);
          }
        }
      });

      // corner props: traffic light + sign + lamp
      const tl = tlPrefab.clone(true);
      tl.position.set(cx - b / 2 - CONFIG.road / 2 + 1, 0, cz - b / 2 - CONFIG.road / 2 + 1);
      tl.rotation.y = Math.PI / 4; cityGroup.add(tl);

      const sg = signPrefab.clone(true);
      sg.position.set(cx + b / 2 + 1.5, 0, cz - b / 2 - 1.5);
      sg.rotation.y = -Math.PI / 3; cityGroup.add(sg);

      const lp1 = lampPrefab.clone(true);
      lp1.position.set(cx, 0, cz - b / 2 + 1.2); cityGroup.add(lp1);
      const lp2 = lampPrefab.clone(true);
      lp2.position.set(cx, 0, cz + b / 2 - 1.2); cityGroup.add(lp2);
    }
  }
}

// ---------------------------------------------------------------
//  SPAWNERS
// ---------------------------------------------------------------
function spawnPlayer(holder) {
  player = { holder };
  fixCharacter(holder, { castShadow: true });
  // spawn on a street near the center
  holder.position.set(PITCH / 2, 0, PITCH / 2);
  playerHeading = Math.PI;
  scene.add(holder);
}

function roadPositions() {
  // centerlines of streets between blocks
  const lines = [];
  for (let i = 0; i <= CONFIG.gridN; i++) lines.push(-SPAN / 2 - PITCH / 2 + i * PITCH);
  return lines;
}

function spawnCars() {
  const lines = roadPositions();
  for (let k = 0; k < CONFIG.carCount; k++) {
    const holder = templateCar.clone(true);
    holder.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; o.frustumCulled = true; } });
    // place on a random vertical street, random spot
    const x = lines[1 + (k % (lines.length - 2))];
    const z = (-SPAN / 2) + Math.random() * SPAN;
    holder.position.set(x + (Math.random() < 0.5 ? -3.5 : 3.5), 0, z);
    const heading = Math.random() < 0.5 ? 0 : Math.PI;
    holder.rotation.y = heading + CONFIG.carYawOffset;
    scene.add(holder);
    cars.push({ holder, heading, speed: 0 });
  }
}

function spawnNPCs(template) {
  for (let k = 0; k < CONFIG.npcCount; k++) {
    const holder = template.clone(true);
    holder.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = true; } });
    let pos, tries = 0;
    do {
      pos = new THREE.Vector3((Math.random() * 2 - 1) * WORLD_HALF * 0.85, 0, (Math.random() * 2 - 1) * WORLD_HALF * 0.85);
      tries++;
    } while (insideBuilding(pos, 1.2) && tries < 30);
    holder.position.copy(pos);
    const heading = Math.random() * Math.PI * 2;
    holder.rotation.y = heading + CONFIG.charYawOffset;
    scene.add(holder);
    npcs.push({ holder, heading, timer: Math.random() * 3, bobT: Math.random() * 10, speed: 1.1 + Math.random() * 0.7 });
  }
}

// ---------------------------------------------------------------
//  COLLISION
// ---------------------------------------------------------------
function insideBuilding(pos, radius) {
  for (let i = 0; i < colliders.length; i++) {
    const b = colliders[i];
    if (pos.x > b.min.x - radius && pos.x < b.max.x + radius &&
        pos.z > b.min.z - radius && pos.z < b.max.z + radius) return true;
  }
  return false;
}

function resolveCollision(pos, radius) {
  const p = pos.clone();
  for (let i = 0; i < colliders.length; i++) {
    const c = colliderCenters[i];
    const dx = p.x - c.x, dz = p.z - c.z;
    if (dx * dx + dz * dz > 1600) continue; // broadphase 40u
    const b = colliders[i];
    const minx = b.min.x - radius, maxx = b.max.x + radius;
    const minz = b.min.z - radius, maxz = b.max.z + radius;
    if (p.x > minx && p.x < maxx && p.z > minz && p.z < maxz) {
      const dxL = p.x - minx, dxR = maxx - p.x, dzT = p.z - minz, dzB = maxz - p.z;
      const m = Math.min(dxL, dxR, dzT, dzB);
      if (m === dxL) p.x = minx; else if (m === dxR) p.x = maxx;
      else if (m === dzT) p.z = minz; else p.z = maxz;
    }
  }
  // world bounds
  p.x = THREE.MathUtils.clamp(p.x, -WORLD_HALF, WORLD_HALF);
  p.z = THREE.MathUtils.clamp(p.z, -WORLD_HALF, WORLD_HALF);
  return p;
}

// ---------------------------------------------------------------
//  INPUT
// ---------------------------------------------------------------
const keys = {};
window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'KeyE') tryEnter();
  if (e.code === 'KeyF') tryExit();
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });

// pointer-drag camera orbit (desktop full screen, mobile right half)
let dragging = false, lastX = 0, lastY = 0, dragId = null;
const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

function pointerDown(e) {
  const x = e.clientX, y = e.clientY;
  if (isTouch && x < window.innerWidth * 0.45) return; // left half = joystick
  dragging = true; lastX = x; lastY = y; dragId = e.pointerId;
}
function pointerMove(e) {
  if (!dragging || (dragId !== null && e.pointerId !== dragId)) return;
  const dx = e.clientX - lastX, dy = e.clientY - lastY;
  lastX = e.clientX; lastY = e.clientY;
  camYaw -= dx * 0.005;
  camPitch = THREE.MathUtils.clamp(camPitch + dy * 0.004, 0.08, 1.2);
}
function pointerUp(e) { if (e.pointerId === dragId || !isTouch) { dragging = false; dragId = null; } }

canvas.addEventListener('pointerdown', pointerDown);
window.addEventListener('pointermove', pointerMove);
window.addEventListener('pointerup', pointerUp);
window.addEventListener('pointercancel', pointerUp);

canvas.addEventListener('wheel', (e) => {
  targetDist = THREE.MathUtils.clamp(targetDist + e.deltaY * 0.01, 5, 24);
  e.preventDefault();
}, { passive: false });

$('help-close').addEventListener('click', () => $('help').classList.add('hidden'));

// ---- mobile joystick ----
const joyVec = { x: 0, z: 0 };
let sprintHeld = false;
(function setupTouch() {
  if (!isTouch) return;
  touchUI.classList.remove('hidden');
  const joy = $('joystick'), knob = $('joy-knob');
  let active = false, startX = 0, startY = 0;
  const R = 55;
  joy.addEventListener('pointerdown', (e) => {
    active = true; const r = joy.getBoundingClientRect();
    startX = r.left + r.width / 2; startY = r.top + r.height / 2;
    joy.setPointerCapture(e.pointerId);
  });
  joy.addEventListener('pointermove', (e) => {
    if (!active) return;
    let dx = e.clientX - startX, dy = e.clientY - startY;
    const len = Math.hypot(dx, dy) || 1;
    const cl = Math.min(len, R);
    const nx = (dx / len) * cl, ny = (dy / len) * cl;
    knob.style.transform = `translate(${nx}px, ${ny}px)`;
    joyVec.x = nx / R; joyVec.z = ny / R;
  });
  const end = () => { active = false; joyVec.x = 0; joyVec.z = 0; knob.style.transform = 'translate(0,0)'; };
  joy.addEventListener('pointerup', end);
  joy.addEventListener('pointercancel', end);

  const sBtn = $('btn-sprint');
  sBtn.addEventListener('pointerdown', () => sprintHeld = true);
  sBtn.addEventListener('pointerup', () => sprintHeld = false);
  sBtn.addEventListener('pointercancel', () => sprintHeld = false);
  $('btn-action').addEventListener('click', () => { if (mode === 'foot') tryEnter(); else tryExit(); });
})();

// ---------------------------------------------------------------
//  ENTER / EXIT VEHICLE
// ---------------------------------------------------------------
function tryEnter() {
  if (mode !== 'foot' || !nearCar) return;
  mode = 'car'; currentCar = nearCar; nearCar = null;
  player.holder.visible = false;
  promptEl.classList.add('hidden');
  modeBadge.textContent = 'DRIVING';
  targetDist = 15;
  $('btn-action').textContent = 'F';
}
function tryExit() {
  if (mode !== 'car') return;
  const car = currentCar;
  // place player to the left of the car
  const left = new THREE.Vector3(Math.cos(car.heading), 0, -Math.sin(car.heading)).multiplyScalar(3.2);
  const pos = car.holder.position.clone().add(left);
  player.holder.position.copy(resolveCollision(pos, 0.6));
  player.holder.visible = true;
  car.speed = 0;
  mode = 'foot'; currentCar = null;
  modeBadge.textContent = 'ON FOOT';
  targetDist = 11;
  $('btn-action').textContent = 'E';
}

// ---------------------------------------------------------------
//  UPDATE: PLAYER (on foot)
// ---------------------------------------------------------------
const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
function getCameraBasis(target) {
  _f.subVectors(target, camera.position); _f.y = 0; _f.normalize();
  _r.crossVectors(_up, _f).normalize(); // screen-left? use up×f
  return { f: _f, r: _r };
}

function updatePlayer(dt) {
  let ix = 0, iz = 0;
  if (keys['KeyW'] || keys['ArrowUp']) iz += 1;
  if (keys['KeyS'] || keys['ArrowDown']) iz -= 1;
  if (keys['KeyA'] || keys['ArrowLeft']) ix -= 1;
  if (keys['KeyD'] || keys['ArrowRight']) ix += 1;
  if (isTouch) { ix += joyVec.x; iz -= joyVec.z; }

  const { f, r } = getCameraBasis(player.holder.position);
  const move = new THREE.Vector3()
    .addScaledVector(f, iz)
    .addScaledVector(r, -ix);
  const moving = move.lengthSq() > 0.0004;
  const sprint = keys['ShiftLeft'] || keys['ShiftRight'] || sprintHeld;
  const speed = sprint ? 9.5 : 4.6;

  if (moving) {
    move.normalize();
    const desired = player.holder.position.clone().addScaledVector(move, speed * dt);
    player.holder.position.copy(resolveCollision(desired, 0.6));
    const targetH = Math.atan2(move.x, move.z);
    playerHeading = lerpAngle(playerHeading, targetH, 0.22);
    playerBobT += dt * (sprint ? 16 : 10);
  } else {
    playerBobT += dt * 2.5;
  }
  player.holder.rotation.y = playerHeading + CONFIG.charYawOffset;
  player.holder.position.y = moving ? Math.abs(Math.sin(playerBobT)) * 0.10 : Math.sin(playerBobT) * 0.02;

  const mph = Math.round((moving ? speed : 0) * 2.2);
  speedBadge.textContent = mph + ' MPH';

  // proximity to cars
  nearCar = null;
  let best = 4.0;
  for (const c of cars) {
    const d = c.holder.position.distanceTo(player.holder.position);
    if (d < best) { best = d; nearCar = c; }
  }
  if (nearCar) { promptEl.textContent = 'PRESS E — ENTER CAR'; promptEl.classList.remove('hidden'); }
  else promptEl.classList.add('hidden');
}

// ---------------------------------------------------------------
//  UPDATE: DRIVING
// ---------------------------------------------------------------
function updateDriving(dt) {
  const car = currentCar;
  let throttle = 0, steer = 0;
  if (keys['KeyW'] || keys['ArrowUp']) throttle += 1;
  if (keys['KeyS'] || keys['ArrowDown']) throttle -= 1;
  if (keys['KeyA'] || keys['ArrowLeft']) steer += 1;
  if (keys['KeyD'] || keys['ArrowRight']) steer -= 1;
  if (isTouch) { throttle += -joyVec.z; steer += -joyVec.x; }

  const accel = 16, maxFwd = 34, maxRev = -12, drag = 0.92;
  car.speed += throttle * accel * dt;
  if (throttle === 0) car.speed *= drag;
  car.speed = THREE.MathUtils.clamp(car.speed, maxRev, maxFwd);
  if (Math.abs(car.speed) < 0.05) car.speed = 0;

  // steering scales with speed; reverse inverts
  const steerRate = 1.6;
  const speedFactor = THREE.MathUtils.clamp(Math.abs(car.speed) / 8, 0, 1);
  car.heading += steer * steerRate * dt * speedFactor * Math.sign(car.speed || 1);

  const dir = new THREE.Vector3(Math.sin(car.heading), 0, Math.cos(car.heading));
  const desired = car.holder.position.clone().addScaledVector(dir, car.speed * dt);
  const resolved = resolveCollision(desired, 1.7);
  if (resolved.distanceToSquared(desired) > 0.01) car.speed *= -0.25; // bumped a wall
  car.holder.position.copy(resolved);
  car.holder.position.y = 0;
  car.holder.rotation.y = car.heading + CONFIG.carYawOffset;

  speedBadge.textContent = Math.round(Math.abs(car.speed) * 2.2) + ' MPH';
}

// ---------------------------------------------------------------
//  UPDATE: NPCs (wander + face direction + procedural walk)
// ---------------------------------------------------------------
function updateNPCs(dt) {
  for (const n of npcs) {
    n.timer -= dt;
    if (n.timer <= 0) {
      n.heading += (Math.random() - 0.5) * Math.PI;
      n.timer = 2 + Math.random() * 4;
    }
    const dir = new THREE.Vector3(Math.sin(n.heading), 0, Math.cos(n.heading));
    const desired = n.holder.position.clone().addScaledVector(dir, n.speed * dt);
    const resolved = resolveCollision(desired, 0.5);
    if (resolved.distanceToSquared(desired) > 0.001) {
      n.heading += Math.PI * (0.5 + Math.random()); // turn away
      n.timer = 1 + Math.random() * 2;
    }
    n.holder.position.copy(resolved);
    n.holder.rotation.y = lerpAngle(n.holder.rotation.y, n.heading + CONFIG.charYawOffset, 0.12);
    n.bobT += dt * 9;
    n.holder.position.y = Math.abs(Math.sin(n.bobT)) * 0.07;
  }
}

// ---------------------------------------------------------------
//  UPDATE: CAMERA (smooth GTA-style follow)
// ---------------------------------------------------------------
function updateCamera(dt) {
  const focus = (mode === 'car' ? currentCar.holder : player.holder);
  const target = focus.position.clone();
  target.y += (mode === 'car' ? 1.6 : 1.5);

  camDist += (targetDist - camDist) * Math.min(1, dt * 6);
  const offset = new THREE.Vector3(
    Math.sin(camYaw) * Math.cos(camPitch),
    Math.sin(camPitch),
    Math.cos(camYaw) * Math.cos(camPitch)
  ).multiplyScalar(camDist);

  const desired = target.clone().add(offset);
  if (desired.y < 1.4) desired.y = 1.4;
  camera.position.lerp(desired, Math.min(1, dt * 8));
  camera.lookAt(target);

  // keep shadow frustum on the action
  sun.target.position.copy(focus.position);
  sun.position.copy(focus.position).add(new THREE.Vector3(50, 80, 35));
}

// ---------------------------------------------------------------
//  HELPERS
// ---------------------------------------------------------------
function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// ---------------------------------------------------------------
//  MAIN LOOP
// ---------------------------------------------------------------
const clock = new THREE.Clock();
let running = false;
function animate() {
  requestAnimationFrame(animate);
  if (!running) return;
  const dt = Math.min(clock.getDelta(), 0.05);
  if (mode === 'foot') updatePlayer(dt); else updateDriving(dt);
  updateNPCs(dt);
  updateCamera(dt);
  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------
//  BOOT  — load every uploaded asset, then build the world
// ---------------------------------------------------------------
async function boot() {
  try {
    statusEl.textContent = 'Loading textures…';
    const [asphaltTex, sidewalkTex, brickTex] = await Promise.all([
      loadTexture(CONFIG.assets.asphalt, 8),
      loadTexture(CONFIG.assets.sidewalk, 6),
      loadTexture(CONFIG.assets.brick, 4),
    ]);
    brickMat = new THREE.MeshStandardMaterial({ map: brickTex, roughness: 0.95, metalness: 0 });

    statusEl.textContent = 'Loading models…';
    const [pG, cG, nG, bG] = await Promise.all([
      gltfLoader.loadAsync(CONFIG.assets.player),
      gltfLoader.loadAsync(CONFIG.assets.car),
      gltfLoader.loadAsync(CONFIG.assets.npc),
      gltfLoader.loadAsync(CONFIG.assets.building),
    ]);

    // --- normalize templates ---
    const playerHolder = normalizeModel(pG.scene, { height: CONFIG.playerHeight });
    templateCar = normalizeModel(cG.scene, { length: CONFIG.carLength });
    templateNPC = normalizeModel(nG.scene, { height: CONFIG.npcHeight });
    templateBuilding = normalizeModel(bG.scene, { height: CONFIG.buildingHeight });

    // --- world ---
    statusEl.textContent = 'Paving streets…';
    buildGround(asphaltTex, sidewalkTex);

    spawnPlayer(playerHolder);
    console.log('PLAYER LOADED');

    statusEl.textContent = 'Raising brownstones…';
    buildCity();
    console.log('BUILDINGS LOADED');

    spawnNPCs(templateNPC);
    console.log('NPCS LOADED');

    spawnCars();
    console.log('CARS LOADED');

    // --- start ---
    clock.start();
    running = true;
    if (!animateStarted) { animateStarted = true; animate(); }
    loaderEl.classList.add('hidden');
    setTimeout(() => loaderEl.remove(), 800);
  } catch (err) {
    showError((err && err.stack) ? err.stack : err);
  }
}
let animateStarted = false;
boot();
