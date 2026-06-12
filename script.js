import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.164.1/build/three.module.js";

const canvas = document.getElementById("game");
const mini = document.getElementById("mini");
const mctx = mini ? mini.getContext("2d") : null;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fd3ff);
scene.fog = new THREE.Fog(0x8fd3ff, 90, 260);

const camera = new THREE.PerspectiveCamera(
  65,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  powerPreference: "high-performance"
});

renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = false;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;

const ambient = new THREE.AmbientLight(0xffffff, 2.1);
scene.add(ambient);

const sun = new THREE.DirectionalLight(0xfff1cf, 1.3);
sun.position.set(40, 80, 30);
scene.add(sun);

const keys = {};
const touchKeys = {};
const colliders = [];
const npcs = [];

window.addEventListener("keydown", (e) => {
  keys[e.key.toLowerCase()] = true;
});

window.addEventListener("keyup", (e) => {
  keys[e.key.toLowerCase()] = false;
});

function makeMaterial(color, roughness = 0.7, metalness = 0) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness
  });
}

function makeBox(width, height, depth, color, x, y, z, roughness = 0.7, metalness = 0) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    makeMaterial(color, roughness, metalness)
  );

  mesh.position.set(x, y, z);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  scene.add(mesh);

  return mesh;
}

function makeCylinder(radius, height, color, x, y, z) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, height, 18),
    makeMaterial(color)
  );

  mesh.position.set(x, y, z);
  scene.add(mesh);

  return mesh;
}

function makeCanvasTexture(type) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;

  const ctx = c.getContext("2d");

  if (type === "asphalt") {
    ctx.fillStyle = "#202020";
    ctx.fillRect(0, 0, 256, 256);

    for (let i = 0; i < 900; i++) {
      const g = 35 + Math.random() * 70;
      ctx.fillStyle = `rgba(${g},${g},${g},0.25)`;
      ctx.fillRect(Math.random() * 256, Math.random() * 256, 1, 1);
    }
  }

  if (type === "brick") {
    ctx.fillStyle = "#7a4a2a";
    ctx.fillRect(0, 0, 256, 256);

    for (let y = 0; y < 256; y += 24) {
      for (let x = (y / 24) % 2 ? -32 : 0; x < 256; x += 64) {
        ctx.fillStyle = "rgba(0,0,0,.28)";
        ctx.fillRect(x, y, 62, 3);
        ctx.fillRect(x, y, 3, 21);

        ctx.fillStyle = "rgba(255,255,255,.05)";
        ctx.fillRect(x + 4, y + 5, 48, 8);
      }
    }
  }

  if (type === "sidewalk") {
    ctx.fillStyle = "#8a8a80";
    ctx.fillRect(0, 0, 256, 256);

    ctx.strokeStyle = "rgba(0,0,0,.22)";
    ctx.lineWidth = 3;

    for (let i = 0; i < 256; i += 64) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 256);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(256, i);
      ctx.stroke();
    }
  }

  const texture = new THREE.CanvasTexture(c);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;

  return texture;
}

const asphaltTexture = makeCanvasTexture("asphalt");
asphaltTexture.repeat.set(40, 40);

const brickTexture = makeCanvasTexture("brick");
brickTexture.repeat.set(2, 6);

const sidewalkTexture = makeCanvasTexture("sidewalk");
sidewalkTexture.repeat.set(20, 20);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(260, 260),
  new THREE.MeshStandardMaterial({
    map: asphaltTexture,
    roughness: 0.45,
    metalness: 0.05
  })
);

ground.rotation.x = -Math.PI / 2;
scene.add(ground);

function makeSignText(text, width = 512, height = 160, fontSize = 44, bg = "#243c2c", fg = "#ffffff") {
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
  ctx.font = `900 ${fontSize}px Arial`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const lines = text.split("\n");

  lines.forEach((line, index) => {
    ctx.fillText(
      line,
      width / 2,
      height / 2 + (index - (lines.length - 1) / 2) * fontSize * 1.2
    );
  });

  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;

  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture
    })
  );

  return sprite;
}

function createRoads() {
  for (let i = -3; i <= 3; i++) {
    makeBox(260, 0.04, 12, 0x101010, 0, 0.03, i * 34, 0.35, 0.02);
    makeBox(12, 0.04, 260, 0x101010, i * 34, 0.04, 0, 0.35, 0.02);

    const side1 = new THREE.Mesh(
      new THREE.BoxGeometry(260, 0.08, 4),
      new THREE.MeshStandardMaterial({ map: sidewalkTexture })
    );

    side1.position.set(0, 0.08, i * 34 + 9);
    scene.add(side1);

    const side2 = side1.clone();
    side2.position.set(0, 0.08, i * 34 - 9);
    scene.add(side2);

    const side3 = new THREE.Mesh(
      new THREE.BoxGeometry(4, 0.08, 260),
      new THREE.MeshStandardMaterial({ map: sidewalkTexture })
    );

    side3.position.set(i * 34 + 9, 0.09, 0);
    scene.add(side3);

    const side4 = side3.clone();
    side4.position.set(i * 34 - 9, 0.09, 0);
    scene.add(side4);
  }

  for (let i = -120; i <= 120; i += 18) {
    makeBox(0.35, 0.07, 5, 0xe8c64a, 0, 0.13, i);
    makeBox(5, 0.07, 0.35, 0xe8c64a, i, 0.13, 0);
  }
}

function createBuilding(x, z, w, d, h, type = "brownstone") {
  const material = new THREE.MeshStandardMaterial({
    map: brickTexture,
    color: type === "store" ? 0xffffff : 0xb77a4a,
    roughness: 0.9
  });

  const b = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    material
  );

  b.position.set(x, h / 2, z);
  scene.add(b);

  colliders.push({ x, z, w, d });

  const frontZ = z - d / 2 - 0.04;

  for (let y = 3; y < h - 1; y += 3.2) {
    for (let wx = -w / 2 + 2; wx < w / 2 - 1; wx += 3) {
      const win = makeBox(1.15, 1.1, 0.08, 0xffcc77, x + wx, y, frontZ, 0.25, 0.15);
      win.material.emissive = new THREE.Color(0x2a1800);
      win.material.emissiveIntensity = 0.35;
    }
  }

  makeBox(w * 0.45, 2, 0.15, 0x111111, x, 1.1, frontZ - 0.08);
  makeBox(w * 0.8, 0.35, 0.3, 0xc99c52, x, 2.45, frontZ - 0.12);

  if (type === "store") {
    const names = [
      "SOUL FOOD",
      "BILL'S RECORDS",
      "BARBER SHOP",
      "LENNOX LOUNGE",
      "BODEGA",
      "CHICKEN & FISH"
    ];

    const sign = makeSignText(
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

  for (let y = 5; y < h - 2; y += 5) {
    makeBox(0.22, 3, 0.22, 0x111111, x - w / 2 - 0.35, y, z);
    makeBox(2, 0.16, 0.22, 0x111111, x - w / 2 - 0.35, y - 1.5, z);
  }
}

function createCar(x, z, color = 0x050505) {
  const car = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(3.3, 0.75, 5.8),
    makeMaterial(color, 0.25, 0.45)
  );

  body.position.y = 0.7;
  car.add(body);

  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 0.75, 2.4),
    makeMaterial(0x111111, 0.3, 0.35)
  );

  roof.position.set(0, 1.25, -0.3);
  car.add(roof);

  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(2, 0.42, 1.6),
    makeMaterial(0x4eb5ff, 0.12, 0.1)
  );

  glass.position.set(0, 1.45, -0.65);
  car.add(glass);

  for (const sx of [-1.25, 1.25]) {
    for (const sz of [-2, 2]) {
      const wheel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.42, 0.42, 0.28, 18),
        makeMaterial(0x050505)
      );

      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(sx, 0.35, sz);
      car.add(wheel);
    }
  }

  car.position.set(x, 0, z);
  car.rotation.y = Math.random() * Math.PI;
  scene.add(car);
}

function createNPC(x, z) {
  const npc = new THREE.Group();

  const skinColors = [0x5b351f, 0x7a4a2a, 0x3b2316];
  const shirtColors = [0x111111, 0x1d3557, 0x5a189a, 0x7f5539];

  const skin = skinColors[Math.floor(Math.random() * skinColors.length)];
  const shirt = shirtColors[Math.floor(Math.random() * shirtColors.length)];

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 1, 0.32),
    makeMaterial(shirt)
  );

  body.position.y = 1;
  npc.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.24, 18, 18),
    makeMaterial(skin)
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

function streetProps() {
  for (let i = 0; i < 15; i++) {
    const x = (Math.random() - 0.5) * 230;
    const z = (Math.random() - 0.5) * 230;

    makeCylinder(0.1, 4, 0x222222, x, 2, z);
  }

  for (let i = 0; i < 18; i++) {
    const x = (Math.random() - 0.5) * 230;
    const z = (Math.random() - 0.5) * 230;

    makeCylinder(0.28, 0.7, 0xaa2222, x, 0.35, z);
  }

  const street = makeSignText("LENOX AVE", 420, 120, 46, "#3b725c", "#ffffff");
  street.position.set(-24, 4.5, -20);
  street.scale.set(5, 1.4, 1);
  scene.add(street);

  const mural = makeSignText("WELCOME TO\nHARLEM", 600, 260, 64, "#4a1e16", "#f4c66b");
  mural.position.set(-18, 8, -44);
  mural.scale.set(14, 6, 1);
  scene.add(mural);

  const apollo = makeSignText("APOLLO", 320, 600, 76, "#2b160b", "#ff9b2f");
  apollo.position.set(-52, 14, -28);
  apollo.scale.set(4.5, 12, 1);
  scene.add(apollo);
}

function createCity() {
  createRoads();

  for (let x = -84; x <= 84; x += 28) {
    for (let z = -84; z <= 84; z += 28) {
      if (Math.abs(x) < 28 && Math.abs(z) < 28) continue;

      const h = 10 + Math.random() * 22;
      const type = Math.random() > 0.6 ? "store" : "brownstone";

      createBuilding(x + 12, z + 12, 14, 14, h, type);
    }
  }

  for (let i = 0; i < 8; i++) {
    createCar(
      (Math.random() - 0.5) * 170,
      (Math.random() - 0.5) * 170,
      [0x050505, 0x7a0000, 0x15315b, 0xb8b8b8][Math.floor(Math.random() * 4)]
    );
  }

  for (let i = 0; i < 10; i++) {
    createNPC(
      (Math.random() - 0.5) * 170,
      (Math.random() - 0.5) * 170
    );
  }

  streetProps();
}

const player = new THREE.Group();
player.position.set(0, 0, 0);
scene.add(player);

function createPlayer() {
  const skin = 0x6b3f22;
  const pants = 0x1b355d;
  const jacket = 0x080a12;

  const leg1 = new THREE.Mesh(
    new THREE.BoxGeometry(0.28, 1, 0.28),
    makeMaterial(pants)
  );

  leg1.position.set(-0.2, 0.5, 0);
  player.add(leg1);

  const leg2 = leg1.clone();
  leg2.position.set(0.2, 0.5, 0);
  player.add(leg2);

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.75, 1.05, 0.38),
    makeMaterial(jacket)
  );

  body.position.y = 1.35;
  player.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.32, 24, 24),
    makeMaterial(skin, 0.42)
  );

  head.position.y = 2.1;
  player.add(head);

  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.36, 0.36, 0.16, 24),
    makeMaterial(0x050505)
  );

  cap.position.y = 2.42;
  player.add(cap);

  const brim = new THREE.Mesh(
    new THREE.BoxGeometry(0.45, 0.05, 0.25),
    makeMaterial(0x050505)
  );

  brim.position.set(0, 2.38, -0.28);
  player.add(brim);

  const chain = new THREE.Mesh(
    new THREE.TorusGeometry(0.28, 0.025, 8, 24),
    makeMaterial(0xffd700, 0.2, 0.9)
  );

  chain.rotation.x = Math.PI / 2;
  chain.position.set(0, 1.62, -0.23);
  player.add(chain);
}

createPlayer();
createCity();

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

function updatePlayer() {
  const speed = pressed("shift") ? 0.55 : 0.3;

  let mx = 0;
  let mz = 0;

  if (pressed("w") || keys["arrowup"] || pressed("up")) mz -= speed;
  if (pressed("s") || keys["arrowdown"] || pressed("down")) mz += speed;
  if (pressed("a") || keys["arrowleft"] || pressed("left")) mx -= speed;
  if (pressed("d") || keys["arrowright"] || pressed("right")) mx += speed;

  const nx = player.position.x + mx;
  const nz = player.position.z + mz;

  if (!blocked(nx, player.position.z)) player.position.x = nx;
  if (!blocked(player.position.x, nz)) player.position.z = nz;

  if (mx !== 0 || mz !== 0) {
    player.rotation.y = Math.atan2(mx, mz);
  }

  const cameraTarget = player.position.clone().add(
    new THREE.Vector3(0, 4.6, 8.7)
  );

  camera.position.lerp(cameraTarget, 0.25);
  camera.lookAt(
    player.position.x,
    player.position.y + 1.45,
    player.position.z
  );
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
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});