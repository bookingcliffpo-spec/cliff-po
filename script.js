import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.164.1/build/three.module.js";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.164.1/examples/jsm/loaders/GLTFLoader.js";

const canvas = document.getElementById("game");
const mini = document.getElementById("mini");
const mctx = mini ? mini.getContext("2d") : null;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 120, 420);

const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, 1000);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  powerPreference: "high-performance"
});

renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = false;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;

scene.add(new THREE.AmbientLight(0xffffff, 2.5));

const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(40, 90, 50);
scene.add(sun);

const loader = new GLTFLoader();
const textureLoader = new THREE.TextureLoader();

const keys = {};
const touchKeys = {};
const colliders = [];
const cars = [];
const npcs = [];

let currentCar = null;
let usingVehicle = false;
let musicOn = false;
let audioCtx = null;
let beatTimer = null;

window.addEventListener("keydown", e => keys[e.key.toLowerCase()] = true);
window.addEventListener("keyup", e => keys[e.key.toLowerCase()] = false);

function mat(color, roughness = 0.7, metalness = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function box(w, h, d, color, x, y, z, roughness = 0.7, metalness = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, roughness, metalness));
  mesh.position.set(x, y, z);
  scene.add(mesh);
  return mesh;
}

function cyl(r, h, color, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 20), mat(color));
  mesh.position.set(x, y, z);
  scene.add(mesh);
  return mesh;
}

function safeTexture(path, repeatX, repeatY, fallbackColor) {
  const texture = textureLoader.load(path);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.colorSpace = THREE.SRGBColorSpace;

  return new THREE.MeshStandardMaterial({
    map: texture,
    color: 0xffffff,
    roughness: 0.65
  });
}

const asphaltMat = safeTexture("./assets/asphalt.jpg", 35, 35, 0x222222);
const brickMat = safeTexture("./assets/brick.jpg", 2, 6, 0x8b4a2b);
const sidewalkMat = safeTexture("./assets/sidewalk.jpg", 20, 20, 0x888888);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(340, 340),
  asphaltMat
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

function normalizeModel(model, targetHeight = 2) {
  const box3 = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();

  box3.getSize(size);
  box3.getCenter(center);

  if (!isFinite(size.y) || size.y === 0) return false;

  model.position.sub(center);
  model.position.y += size.y / 2;

  const scale = targetHeight / size.y;
  model.scale.setScalar(scale);

  model.traverse(obj => {
    if (obj.isMesh) {
      obj.frustumCulled = false;
      obj.castShadow = false;
      obj.receiveShadow = false;
    }
  });

  return true;
}

function cloneModel(model) {
  const clone = model.clone(true);
  clone.traverse(obj => {
    if (obj.isMesh) {
      obj.frustumCulled = false;
      obj.castShadow = false;
      obj.receiveShadow = false;
    }
  });
  return clone;
}

function makeSign(text, w = 512, h = 140, size = 44, bg = "#243c2c", fg = "#ffffff") {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = "#d8c891";
  ctx.lineWidth = 8;
  ctx.strokeRect(8, 8, w - 16, h - 16);

  ctx.fillStyle = fg;
  ctx.font = `900 ${size}px Arial`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const lines = text.split("\n");
  lines.forEach((line, i) => {
    ctx.fillText(line, w / 2, h / 2 + (i - (lines.length - 1) / 2) * size * 1.15);
  });

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;

  return new THREE.Sprite(new THREE.SpriteMaterial({ map: tex }));
}

function createRoads() {
  for (let i = -4; i <= 4; i++) {
    box(340, 0.04, 13, 0x101010, 0, 0.03, i * 34);
    box(13, 0.04, 340, 0, i * 34, 0.04, 0);

    const s1 = new THREE.Mesh(new THREE.BoxGeometry(340, 0.08, 4), sidewalkMat);
    s1.position.set(0, 0.08, i * 34 + 9);
    scene.add(s1);

    const s2 = s1.clone();
    s2.position.set(0, 0.08, i * 34 - 9);
    scene.add(s2);

    const s3 = new THREE.Mesh(new THREE.BoxGeometry(4, 0.08, 340), sidewalkMat);
    s3.position.set(i * 34 + 9, 0.09, 0);
    scene.add(s3);

    const s4 = s3.clone();
    s4.position.set(i * 34 - 9, 0.09, 0);
    scene.add(s4);
  }

  for (let i = -150; i <= 150; i += 18) {
    box(0.35, 0.07, 5, 0xe8c64a, 0, 0.13, i);
    box(5, 0.07, 0.35, 0xe8c64a, i, 0.13, 0);
  }
}

function fallbackPlayer() {
  player.clear();

  const legs = box(0.62, 1, 0.3, 0x1b355d, 0, 0.5, 0);
  const body = box(0.8, 1.05, 0.38, 0x080a12, 0, 1.35, 0);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 24, 24), mat(0x6b3f22));
  head.position.y = 2.1;
  player.add(head);

  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.16, 24), mat(0x050505));
  cap.position.y = 2.42;
  player.add(cap);

  const chain = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.025, 8, 24), mat(0xffd700, 0.2, 0.9));
  chain.rotation.x = Math.PI / 2;
  chain.position.set(0, 1.62, -0.23);
  player.add(chain);

  player.add(legs, body);
}

const player = new THREE.Group();
player.position.set(0, 0, 0);
scene.add(player);

loader.load(
  "./assets/player.glb",
  gltf => {
    const model = gltf.scene;
    const ok = normalizeModel(model, 2.4);

    if (!ok) {
      fallbackPlayer();
      return;
    }

    player.clear();
    player.add(model);
    console.log("PLAYER GLB LOADED");
  },
  undefined,
  err => {
    console.error("PLAYER GLB FAILED", err);
    fallbackPlayer();
  }
);

function fallbackBuilding(x, z, h = 18) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(15, h, 15), brickMat);
  b.position.set(x, h / 2, z);
  scene.add(b);

  colliders.push({ x, z, w: 15, d: 15 });

  const front = z - 7.55;

  for (let y = 3; y < h - 1; y += 3.2) {
    for (let wx = -5; wx <= 5; wx += 3) {
      const win = box(1.1, 1.1, 0.08, 0xffcc77, x + wx, y, front);
      win.material.emissive = new THREE.Color(0x2a1800);
      win.material.emissiveIntensity = 0.35;
    }
  }
}

function loadBuildings() {
  loader.load(
    "./assets/building.glb",
    gltf => {
      const base = gltf.scene;
      normalizeModel(base, 18);

      for (let x = -102; x <= 102; x += 34) {
        for (let z = -102; z <= 102; z += 34) {
          if (Math.abs(x) < 30 && Math.abs(z) < 30) continue;

          const b = cloneModel(base);
          b.position.set(x + 12, 0, z + 12);
          scene.add(b);

          colliders.push({ x: x + 12, z: z + 12, w: 16, d: 16 });
        }
      }

      console.log("BUILDING GLB LOADED");
    },
    undefined,
    err => {
      console.error("BUILDING GLB FAILED", err);

      for (let x = -102; x <= 102; x += 34) {
        for (let z = -102; z <= 102; z += 34) {
          if (Math.abs(x) < 30 && Math.abs(z) < 30) continue;
          fallbackBuilding(x + 12, z + 12, 12 + Math.random() * 20);
        }
      }
    }
  );
}

function fallbackCar(x, z, color = 0x990000) {
  const car = new THREE.Group();

  const body = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.75, 5.8), mat(color, 0.3, 0.35));
  body.position.y = 0.7;
  car.add(body);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.75, 2.3), mat(0x111111));
  roof.position.set(0, 1.25, -0.3);
  car.add(roof);

  car.position.set(x, 0, z);
  car.rotation.y = Math.random() * Math.PI;
  scene.add(car);
  cars.push(car);
}

function loadCars() {
  loader.load(
    "./assets/car.glb",
    gltf => {
      const base = gltf.scene;
      normalizeModel(base, 1.4);

      for (let i = 0; i < 8; i++) {
        const car = cloneModel(base);
        car.position.set((Math.random() - 0.5) * 170, 0, (Math.random() - 0.5) * 170);
        car.rotation.y = Math.random() * Math.PI;
        scene.add(car);
        cars.push(car);
      }

      console.log("CAR GLB LOADED");
    },
    undefined,
    err => {
      console.error("CAR GLB FAILED", err);

      for (let i = 0; i < 8; i++) {
        fallbackCar((Math.random() - 0.5) * 170, (Math.random() - 0.5) * 170);
      }
    }
  );
}

function fallbackNPC(x, z) {
  const npc = new THREE.Group();

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1, 0.32), mat(0x222244));
  body.position.y = 1;
  npc.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 18, 18), mat(0x6b3f22));
  head.position.y = 1.65;
  npc.add(head);

  npc.position.set(x, 0, z);
  scene.add(npc);

  npcs.push({ mesh: npc, angle: Math.random() * Math.PI * 2, speed: 0.01 });
}

function loadNPCs() {
  loader.load(
    "./assets/npc.glb",
    gltf => {
      const base = gltf.scene;
      normalizeModel(base, 2);

      for (let i = 0; i < 8; i++) {
        const npc = cloneModel(base);
        npc.position.set((Math.random() - 0.5) * 150, 0, (Math.random() - 0.5) * 150);
        scene.add(npc);
        npcs.push({ mesh: npc, angle: Math.random() * Math.PI * 2, speed: 0.008 });
      }

      console.log("NPC GLB LOADED");
    },
    undefined,
    err => {
      console.error("NPC GLB FAILED", err);

      for (let i = 0; i < 8; i++) {
        fallbackNPC((Math.random() - 0.5) * 150, (Math.random() - 0.5) * 150);
      }
    }
  );
}

function props() {
  for (let i = 0; i < 12; i++) {
    cyl(0.1, 4, 0x222222, (Math.random() - 0.5) * 220, 2, (Math.random() - 0.5) * 220);
  }

  const street = makeSign("LENOX AVE", 420, 120, 46, "#3b725c", "#ffffff");
  street.position.set(-24, 4.5, -20);
  street.scale.set(5, 1.4, 1);
  scene.add(street);

  const mural = makeSign("WELCOME TO\nHARLEM", 600, 260, 64, "#4a1e16", "#f4c66b");
  mural.position.set(-18, 8, -44);
  mural.scale.set(14, 6, 1);
  scene.add(mural);

  const apollo = makeSign("APOLLO", 320, 600, 76, "#2b160b", "#ff9b2f");
  apollo.position.set(-52, 14, -28);
  apollo.scale.set(4.5, 12, 1);
  scene.add(apollo);
}

createRoads();
loadBuildings();
loadCars();
loadNPCs();
props();

function bindButton(id, key) {
  const btn = document.getElementById(id);
  if (!btn) return;

  btn.addEventListener("touchstart", e => {
    e.preventDefault();
    touchKeys[key] = true;
  });

  btn.addEventListener("touchend", e => {
    e.preventDefault();
    touchKeys[key] = false;
  });

  btn.addEventListener("mousedown", () => touchKeys[key] = true);
  btn.addEventListener("mouseup", () => touchKeys[key] = false);
}

bindButton("up", "up");
bindButton("down", "down");
bindButton("left", "left");
bindButton("right", "right");

function pressed(k) {
  return keys[k] || touchKeys[k];
}

function blocked(x, z) {
  for (const c of colliders) {
    if (Math.abs(x - c.x) < c.w / 2 + 1 && Math.abs(z - c.z) < c.d / 2 + 1) return true;
  }
  return false;
}

function nearestCar() {
  let closest = null;
  let best = 999;

  for (const car of cars) {
    const d = car.position.distanceTo(player.position);
    if (d < best) {
      best = d;
      closest = car;
    }
  }

  return best < 5 ? closest : null;
}

function toggleVehicle() {
  if (!usingVehicle) {
    const car = nearestCar();

    if (car) {
      usingVehicle = true;
      currentCar = car;
      player.visible = false;
    }
  } else {
    usingVehicle = false;
    player.visible = true;

    player.position.copy(currentCar.position);
    player.position.x += 2;

    currentCar = null;
  }
}

window.addEventListener("keydown", e => {
  if (e.key.toLowerCase() === "e") toggleVehicle();
});

function updatePlayer() {
  const speed = pressed("shift") ? 0.55 : 0.3;

  let mx = 0;
  let mz = 0;

  if (pressed("w") || keys.arrowup || pressed("up")) mz -= speed;
  if (pressed("s") || keys.arrowdown || pressed("down")) mz += speed;
  if (pressed("a") || keys.arrowleft || pressed("left")) mx -= speed;
  if (pressed("d") || keys.arrowright || pressed("right")) mx += speed;

  if (usingVehicle && currentCar) {
    currentCar.position.x += mx * 1.8;
    currentCar.position.z += mz * 1.8;

    if (mx || mz) currentCar.rotation.y = Math.atan2(mx, mz);

    camera.position.lerp(currentCar.position.clone().add(new THREE.Vector3(0, 5.5, 11)), 0.2);
    camera.lookAt(currentCar.position.x, 1.3, currentCar.position.z);
    return;
  }

  const nx = player.position.x + mx;
  const nz = player.position.z + mz;

  if (!blocked(nx, player.position.z)) player.position.x = nx;
  if (!blocked(player.position.x, nz)) player.position.z = nz;

  if (mx || mz) player.rotation.y = Math.atan2(mx, mz);

  camera.position.lerp(player.position.clone().add(new THREE.Vector3(0, 4.6, 8.7)), 0.22);
  camera.lookAt(player.position.x, 1.45, player.position.z);
}

function updateNPCs() {
  for (const npc of npcs) {
    npc.mesh.position.x += Math.sin(npc.angle) * npc.speed;
    npc.mesh.position.z += Math.cos(npc.angle) * npc.speed;

    if (Math.random() < 0.01) npc.angle += (Math.random() - 0.5) * 1.4;
  }
}

let lastMini = 0;

function drawMini(time) {
  if (!mctx) return;
  if (time - lastMini < 300) return;

  lastMini = time;
  mini.width = 150;
  mini.height = 150;

  mctx.fillStyle = "#222";
  mctx.fillRect(0, 0, 150, 150);

  mctx.strokeStyle = "#777";

  for (let i = 0; i < 150; i += 20) {
    mctx.beginPath();
    mctx.moveTo(i, 0);
    mctx.lineTo(i, 150);
    mctx.stroke();

    mctx.beginPath();
    mctx.moveTo(0, i);
    mctx.lineTo(150, i);
    mctx.stroke();
  }

  mctx.fillStyle = "#ffcc33";
  mctx.beginPath();
  mctx.arc(75, 75, 6, 0, Math.PI * 2);
  mctx.fill();
}

let lastFrame = 0;

function animate(time) {
  requestAnimationFrame(animate);

  if (time - lastFrame < 16) return;
  lastFrame = time;

  updatePlayer();
  updateNPCs();
  drawMini(time);

  renderer.render(scene, camera);
}

camera.position.set(0, 5, 9);
camera.lookAt(player.position);
animate();

window.addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const musicButton = document.createElement("button");
musicButton.innerText = "♪ MUSIC";
musicButton.style.position = "fixed";
musicButton.style.top = "115px";
musicButton.style.right = "25px";
musicButton.style.zIndex = "999";
musicButton.style.padding = "10px 14px";
musicButton.style.borderRadius = "10px";
musicButton.style.border = "none";
musicButton.style.background = "rgba(0,0,0,.65)";
musicButton.style.color = "white";
musicButton.style.fontWeight = "900";
document.body.appendChild(musicButton);

let musicOn = false;
let audioCtx = null;
let beatTimer = null;

function playBeat() {
  if (!audioCtx) audioCtx = new AudioContext();

  const now = audioCtx.currentTime;

  function drum(freq, time, decay = 0.12) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.frequency.value = freq;
    osc.type = "sine";

    gain.gain.setValueAtTime(0.7, time);
    gain.gain.exponentialRampToValueAtTime(0.01, time + decay);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start(time);
    osc.stop(time + decay);
  }

  drum(60, now, 0.18);
  drum(160, now + 0.35, 0.08);
}

musicButton.addEventListener("click", () => {
  musicOn = !musicOn;

  if (musicOn) {
    musicButton.innerText = "♪ ON";
    playBeat();
    beatTimer = setInterval(playBeat, 960);
  } else {
    musicButton.innerText = "♪ MUSIC";
    clearInterval(beatTimer);
  }
});
