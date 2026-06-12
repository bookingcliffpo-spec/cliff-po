import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.164.1/build/three.module.js";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.164.1/examples/jsm/loaders/GLTFLoader.js";

const canvas = document.getElementById("game");
const mini = document.getElementById("mini");
const mctx = mini ? mini.getContext("2d") : null;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fd3ff);
scene.fog = new THREE.Fog(0x8fd3ff, 100, 320);

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

scene.add(new THREE.AmbientLight(0xffffff, 2.2));

const sun = new THREE.DirectionalLight(0xfff1cf, 1.4);
sun.position.set(40, 90, 50);
scene.add(sun);

const loader = new GLTFLoader();
const textureLoader = new THREE.TextureLoader();

const keys = {};
const touchKeys = {};
const colliders = [];
const npcs = [];
const cars = [];

let playerModel = null;
let usingVehicle = false;
let currentCar = null;
let musicOn = false;
let audioCtx = null;
let beatTimer = null;

window.addEventListener("keydown", (e) => {
  keys[e.key.toLowerCase()] = true;
});

window.addEventListener("keyup", (e) => {
  keys[e.key.toLowerCase()] = false;
});

function material(color, roughness = 0.7, metalness = 0) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness
  });
}

function box(w, h, d, color, x, y, z, roughness = 0.7, metalness = 0) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    material(color, roughness, metalness)
  );

  mesh.position.set(x, y, z);
  scene.add(mesh);
  return mesh;
}

function cyl(r, h, color, x, y, z) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r, h, 20),
    material(color)
  );

  mesh.position.set(x, y, z);
  scene.add(mesh);
  return mesh;
}

function loadTexture(path, repeatX = 1, repeatY = 1, fallbackColor = 0x777777) {
  const tex = textureLoader.load(
    path,
    () => {},
    undefined,
    () => {}
  );

  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.colorSpace = THREE.SRGBColorSpace;

  return new THREE.MeshStandardMaterial({
    map: tex,
    color: 0xffffff,
    roughness: 0.65
  });
}

const asphaltMat = loadTexture("./assets/asphalt.jpg", 40, 40);
const brickMat = loadTexture("./assets/brick.jpg", 2, 6);
const sidewalkMat = loadTexture("./assets/sidewalk.jpg", 20, 20);

const fallbackAsphalt = new THREE.MeshStandardMaterial({
  color: 0x202020,
  roughness: 0.5
});

const fallbackBrick = new THREE.MeshStandardMaterial({
  color: 0x7a4a2a,
  roughness: 0.9
});

const fallbackSidewalk = new THREE.MeshStandardMaterial({
  color: 0x8a8a80,
  roughness: 0.8
});

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(320, 320),
  asphaltMat || fallbackAsphalt
);

ground.rotation.x = -Math.PI / 2;
scene.add(ground);

function makeTextSign(text, width = 512, height = 160, size = 44, bg = "#243c2c", fg = "#ffffff") {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;

  const ctx = c.getContext("2d");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "#d8c891";
  ctx.lineWidth = 8;
  ctx.strokeRect(8, 8, width - 16, height - 16);

  ctx.fillStyle = fg;
  ctx.font = `900 ${size}px Arial`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const lines = text.split("\n");

  lines.forEach((line, index) => {
    ctx.fillText(
      line,
      width / 2,
      height / 2 + (index - (lines.length - 1) / 2) * size * 1.15
    );
  });

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;

  return new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: tex
    })
  );
}

function cloneModel(model) {
  const clone = model.clone(true);

  clone.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = false;
      obj.receiveShadow = false;
      if (obj.material) obj.material.needsUpdate = true;
    }
  });

  return clone;
}

const player = new THREE.Group();
player.position.set(0, 0, 0);
scene.add(player);

function createFallbackPlayer() {
  const skin = 0x6b3f22;

  const legs = box(0.62, 1, 0.3, 0x1b355d, 0, 0.5, 0);
  const body = box(0.8, 1.05, 0.38, 0x080a12, 0, 1.35, 0);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.32, 24, 24),
    material(skin)
  );

  head.position.y = 2.1;
  player.add(head);

  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.36, 0.36, 0.16, 24),
    material(0x050505)
  );

  cap.position.y = 2.42;
  player.add(cap);

  const brim = new THREE.Mesh(
    new THREE.BoxGeometry(0.45, 0.05, 0.25),
    material(0x050505)
  );

  brim.position.set(0, 2.38, -0.28);
  player.add(brim);

  const chain = new THREE.Mesh(
    new THREE.TorusGeometry(0.28, 0.025, 8, 24),
    material(0xffd700, 0.2, 0.9)
  );

  chain.rotation.x = Math.PI / 2;
  chain.position.set(0, 1.62, -0.23);
  player.add(chain);

  player.add(legs, body);
}

function loadPlayerModel() {
  loader.load(
    "./assets/player.glb",
    (gltf) => {
      playerModel = gltf.scene;
      playerModel.scale.set(1, 1, 1);
      playerModel.position.set(0, 0, 0);

      player.clear();
      player.add(playerModel);
    },
    undefined,
    () => {
      createFallbackPlayer();
    }
  );
}

function createRoads() {
  for (let i = -4; i <= 4; i++) {
    box(320, 0.04, 13, 0x101010, 0, 0.03, i * 34);
    box(13, 0.04, 320, 0x101010, i * 34, 0.04, 0);

    const side1 = new THREE.Mesh(
      new THREE.BoxGeometry(320, 0.08, 4),
      sidewalkMat || fallbackSidewalk
    );

    side1.position.set(0, 0.08, i * 34 + 9);
    scene.add(side1);

    const side2 = side1.clone();
    side2.position.set(0, 0.08, i * 34 - 9);
    scene.add(side2);

    const side3 = new THREE.Mesh(
      new THREE.BoxGeometry(4, 0.08, 320),
      sidewalkMat || fallbackSidewalk
    );

    side3.position.set(i * 34 + 9, 0.09, 0);
    scene.add(side3);

    const side4 = side3.clone();
    side4.position.set(i * 34 - 9, 0.09, 0);
    scene.add(side4);
  }

  for (let i = -145; i <= 145; i += 18) {
    box(0.35, 0.07, 5, 0xe8c64a, 0, 0.13, i);
    box(5, 0.07, 0.35, 0xe8c64a, i, 0.13, 0);
  }
}

function createFallbackBuilding(x, z, w, d, h, type = "brownstone") {
  const b = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    brickMat || fallbackBrick
  );

  b.position.set(x, h / 2, z);
  scene.add(b);

  colliders.push({ x, z, w, d });

  const frontZ = z - d / 2 - 0.04;

  for (let y = 3; y < h - 1; y += 3.2) {
    for (let wx = -w / 2 + 2; wx < w / 2 - 1; wx += 3) {
      const win = box(1.15, 1.1, 0.08, 0xffcc77, x + wx, y, frontZ, 0.25, 0.15);
      win.material.emissive = new THREE.Color(0x2a1800);
      win.material.emissiveIntensity = 0.35;
    }
  }

  box(w * 0.45, 2, 0.15, 0x111111, x, 1.1, frontZ - 0.08);
  box(w * 0.8, 0.35, 0.3, 0xc99c52, x, 2.45, frontZ - 0.12);

  if (type === "store") {
    const names = ["SOUL FOOD", "BILL'S RECORDS", "BARBER SHOP", "LENNOX LOUNGE", "BODEGA"];
    const sign = makeTextSign(
      names[Math.floor(Math.random() * names.length)],
      512,
      140,
      42,
      "#2b160b",
      "#f4c76b"
    );

    sign.position.set(x, 4.1, frontZ - 0.35);
    sign.scale.set(9, 2.7, 1);
    scene.add(sign);
  }
}

function loadBuildings() {
  loader.load(
    "./assets/building.glb",
    (gltf) => {
      const model = gltf.scene;

      for (let x = -102; x <= 102; x += 34) {
        for (let z = -102; z <= 102; z += 34) {
          if (Math.abs(x) < 30 && Math.abs(z) < 30) continue;

          const b = cloneModel(model);
          b.position.set(x + 12, 0, z + 12);
          b.scale.set(1.6, 1.6, 1.6);
          scene.add(b);

          colliders.push({
            x: x + 12,
            z: z + 12,
            w: 16,
            d: 16
          });
        }
      }
    },
    undefined,
    () => {
      for (let x = -102; x <= 102; x += 34) {
        for (let z = -102; z <= 102; z += 34) {
          if (Math.abs(x) < 30 && Math.abs(z) < 30) continue;

          const h = 10 + Math.random() * 22;
          const type = Math.random() > 0.6 ? "store" : "brownstone";

          createFallbackBuilding(x + 12, z + 12, 14, 14, h, type);
        }
      }
    }
  );
}

function createFallbackCar(x, z, color = 0x050505) {
  const car = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(3.3, 0.75, 5.8),
    material(color, 0.25, 0.45)
  );

  body.position.y = 0.7;
  car.add(body);

  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 0.75, 2.4),
    material(0x111111, 0.3, 0.35)
  );

  roof.position.set(0, 1.25, -0.3);
  car.add(roof);

  for (const sx of [-1.25, 1.25]) {
    for (const sz of [-2, 2]) {
      const wheel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.42, 0.42, 0.28, 18),
        material(0x050505)
      );

      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(sx, 0.35, sz);
      car.add(wheel);
    }
  }

  car.position.set(x, 0, z);
  car.rotation.y = Math.random() * Math.PI;
  scene.add(car);
  cars.push(car);
}

function loadCars() {
  loader.load(
    "./assets/car.glb",
    (gltf) => {
      const model = gltf.scene;

      for (let i = 0; i < 8; i++) {
        const car = cloneModel(model);

        car.position.set(
          (Math.random() - 0.5) * 180,
          0,
          (Math.random() - 0.5) * 180
        );

        car.scale.set(1.2, 1.2, 1.2);
        car.rotation.y = Math.random() * Math.PI;

        scene.add(car);
        cars.push(car);
      }
    },
    undefined,
    () => {
      for (let i = 0; i < 8; i++) {
        createFallbackCar(
          (Math.random() - 0.5) * 170,
          (Math.random() - 0.5) * 170,
          [0x050505, 0x7a0000, 0x15315b, 0xb8b8b8][Math.floor(Math.random() * 4)]
        );
      }
    }
  );
}

function createFallbackNPC(x, z) {
  const npc = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 1, 0.32),
    material(0x222244)
  );

  body.position.y = 1;
  npc.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.24, 18, 18),
    material(0x6b3f22)
  );

  head.position.y = 1.65;
  npc.add(head);

  npc.position.set(x, 0, z);
  scene.add(npc);

  npcs.push({
    mesh: npc,
    angle: Math.random() * Math.PI * 2,
    speed: 0.008 + Math.random() * 0.01
  });
}

function loadNPCs() {
  loader.load(
    "./assets/npc.glb",
    (gltf) => {
      const model = gltf.scene;

      for (let i = 0; i < 10; i++) {
        const npc = cloneModel(model);

        npc.position.set(
          (Math.random() - 0.5) * 170,
          0,
          (Math.random() - 0.5) * 170
        );

        npc.scale.set(1, 1, 1);
        scene.add(npc);

        npcs.push({
          mesh: npc,
          angle: Math.random() * Math.PI * 2,
          speed: 0.008 + Math.random() * 0.01
        });
      }
    },
    undefined,
    () => {
      for (let i = 0; i < 10; i++) {
        createFallbackNPC(
          (Math.random() - 0.5) * 170,
          (Math.random() - 0.5) * 170
        );
      }
    }
  );
}

function streetProps() {
  for (let i = 0; i < 15; i++) {
    const x = (Math.random() - 0.5) * 230;
    const z = (Math.random() - 0.5) * 230;

    cyl(0.1, 4, 0x222222, x, 2, z);
  }

  for (let i = 0; i < 18; i++) {
    const x = (Math.random() - 0.5) * 230;
    const z = (Math.random() - 0.5) * 230;

    cyl(0.28, 0.7, 0xaa2222, x, 0.35, z);
  }

  const street = makeTextSign("LENOX AVE", 420, 120, 46, "#3b725c", "#ffffff");
  street.position.set(-24, 4.5, -20);
  street.scale.set(5, 1.4, 1);
  scene.add(street);

  const mural = makeTextSign("WELCOME TO\nHARLEM", 600, 260, 64, "#4a1e16", "#f4c66b");
  mural.position.set(-18, 8, -44);
  mural.scale.set(14, 6, 1);
  scene.add(mural);

  const apollo = makeTextSign("APOLLO", 320, 600, 76, "#2b160b", "#ff9b2f");
  apollo.position.set(-52, 14, -28);
  apollo.scale.set(4.5, 12, 1);
  scene.add(apollo);
}

function setupWorld() {
  createRoads();
  loadPlayerModel();
  loadBuildings();
  loadCars();
  loadNPCs();
  streetProps();
}

setupWorld();

function bindButton(id, key) {
  const btn = document.getElementById(id);
  if (!btn) return;

  btn.addEventListener("touchstart", (e) => {
    e.preventDefault();
    touchKeys[key] = true;
  });

  btn.addEventListener("touchend", (e) => {
    e.preventDefault();
    touchKeys[key] = false;
  });

  btn.addEventListener("mousedown", () => {
    touchKeys[key] = true;
  });

  btn.addEventListener("mouseup", () => {
    touchKeys[key] = false;
  });
}

bindButton("up", "up");
bindButton("down", "down");
bindButton("left", "left");
bindButton("right", "right");

function pressed(key) {
  return keys[key] || touchKeys[key];
}

function blocked(x, z) {
  for (const c of colliders) {
    if (
      Math.abs(x - c.x) < c.w / 2 + 1 &&
      Math.abs(z - c.z) < c.d / 2 + 1
    ) {
      return true;
    }
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

    if (currentCar) {
      player.position.copy(currentCar.position);
      player.position.x += 2;
    }

    currentCar = null;
  }
}

window.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() === "e") {
    toggleVehicle();
  }
});

function updatePlayer() {
  const speed = pressed("shift") ? 0.55 : 0.3;

  let mx = 0;
  let mz = 0;

  if (pressed("w") || keys["arrowup"] || pressed("up")) mz -= speed;
  if (pressed("s") || keys["arrowdown"] || pressed("down")) mz += speed;
  if (pressed("a") || keys["arrowleft"] || pressed("left")) mx -= speed;
  if (pressed("d") || keys["arrowright"] || pressed("right")) mx += speed;

  if (usingVehicle && currentCar) {
    currentCar.position.x += mx * 1.8;
    currentCar.position.z += mz * 1.8;

    if (mx !== 0 || mz !== 0) {
      currentCar.rotation.y = Math.atan2(mx, mz);
    }

    const carCam = currentCar.position.clone().add(new THREE.Vector3(0, 5.5, 11));
    camera.position.lerp(carCam, 0.2);
    camera.lookAt(currentCar.position.x, currentCar.position.y + 1.2, currentCar.position.z);

    return;
  }

  const nx = player.position.x + mx;
  const nz = player.position.z + mz;

  if (!blocked(nx, player.position.z)) player.position.x = nx;
  if (!blocked(player.position.x, nz)) player.position.z = nz;

  if (mx !== 0 || mz !== 0) {
    player.rotation.y = Math.atan2(mx, mz);
  }

  const cameraTarget = player.position.clone().add(new THREE.Vector3(0, 4.6, 8.7));
  camera.position.lerp(cameraTarget, 0.25);
  camera.lookAt(player.position.x, player.position.y + 1.45, player.position.z);
}

function updateNPCs() {
  for (const npc of npcs) {
    npc.mesh.position.x += Math.sin(npc.angle) * npc.speed;
    npc.mesh.position.z += Math.cos(npc.angle) * npc.speed;

    if (Math.random() < 0.01) {
      npc.angle += (Math.random() - 0.5) * 1.4;
    }
  }
}

let lastMiniDraw = 0;

function drawMiniMap(time) {
  if (!mctx) return;
  if (time - lastMiniDraw < 300) return;

  lastMiniDraw = time;

  mini.width = 150;
  mini.height = 150;

  mctx.fillStyle = "#222";
  mctx.fillRect(0, 0, 150, 150);

  mctx.strokeStyle = "#777";
  mctx.lineWidth = 1;

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
  drawMiniMap(time);

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

/* MUSIC BUTTON */
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

function playBeat() {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }

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

  function hat(time) {
    const bufferSize = audioCtx.sampleRate * 0.04;
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const source = audioCtx.createBufferSource();
    const gain = audioCtx.createGain();

    gain.gain.setValueAtTime(0.12, time);
    gain.gain.exponentialRampToValueAtTime(0.01, time + 0.04);

    source.buffer = buffer;
    source.connect(gain);
    gain.connect(audioCtx.destination);

    source.start(time);
    source.stop(time + 0.04);
  }

  drum(60, now, 0.18);
  drum(160, now + 0.35, 0.08);

  for (let i = 0; i < 8; i++) {
    hat(now + i * 0.12);
  }
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
