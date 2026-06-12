import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.164.1/build/three.module.js";

const canvas = document.getElementById("game");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 80, 230);

const camera = new THREE.PerspectiveCamera(
  70,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true
});

renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;

const ambient = new THREE.AmbientLight(0xffffff, 1.1);
scene.add(ambient);

const sun = new THREE.DirectionalLight(0xffffff, 2.4);
sun.position.set(40, 80, 30);
sun.castShadow = true;
scene.add(sun);

const player = new THREE.Group();
player.position.set(0, 1, 0);
scene.add(player);

const body = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1.6, 0.55),
  new THREE.MeshStandardMaterial({ color: 0xffd700 })
);
body.position.y = 0.8;
body.castShadow = true;
player.add(body);

const head = new THREE.Mesh(
  new THREE.SphereGeometry(0.35, 32, 32),
  new THREE.MeshStandardMaterial({ color: 0x8b5a2b })
);
head.position.y = 1.85;
head.castShadow = true;
player.add(head);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(260, 260),
  new THREE.MeshStandardMaterial({ color: 0x242424 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

function makeBox(w, h, d, color, x, y, z) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color })
  );
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

const buildings = [];

function createCity() {
  // roads
  for (let i = -4; i <= 4; i++) {
    makeBox(260, 0.03, 10, 0x151515, 0, 0.02, i * 28);
    makeBox(10, 0.03, 260, 0x151515, i * 28, 0.025, 0);
  }

  // lane lines
  for (let i = -120; i <= 120; i += 12) {
    makeBox(0.25, 0.04, 4, 0xf1c232, 0, 0.05, i);
    makeBox(4, 0.04, 0.25, 0xf1c232, i, 0.05, 0);
  }

  // sidewalks
  for (let i = -4; i <= 4; i++) {
    makeBox(260, 0.08, 3, 0x777777, 0, 0.06, i * 28 + 7);
    makeBox(260, 0.08, 3, 0x777777, 0, 0.06, i * 28 - 7);
    makeBox(3, 0.08, 260, 0x777777, i * 28 + 7, 0.06, 0);
    makeBox(3, 0.08, 260, 0x777777, i * 28 - 7, 0.06, 0);
  }

  // buildings safely away from player spawn
  for (let x = -112; x <= 112; x += 28) {
    for (let z = -112; z <= 112; z += 28) {
      if (Math.abs(x) < 35 && Math.abs(z) < 35) continue;

      const h = 10 + Math.random() * 28;
      const colors = [0x4a3328, 0x6b3f2a, 0x555555, 0x7a5a3a, 0x333333];
      const color = colors[Math.floor(Math.random() * colors.length)];

      const b = makeBox(13, h, 13, color, x + 12, h / 2, z + 12);
      buildings.push(b);

      // fake windows
      for (let wy = 3; wy < h - 1; wy += 3) {
        for (let wx = -4; wx <= 4; wx += 4) {
          makeBox(1.2, 1.2, 0.08, 0xffd36a, x + 12 + wx, wy, z + 5.45);
        }
      }
    }
  }

  // spawn safe circle
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(3.5, 4, 64),
    new THREE.MeshBasicMaterial({ color: 0x00ff66, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(0, 0.09, 0);
  scene.add(ring);
}

createCity();

const keys = {};
const touchKeys = {};

window.addEventListener("keydown", (e) => {
  keys[e.key.toLowerCase()] = true;
});

window.addEventListener("keyup", (e) => {
  keys[e.key.toLowerCase()] = false;
});

function bindButton(id, key) {
  const btn = document.getElementById(id);
  btn.addEventListener("touchstart", (e) => {
    e.preventDefault();
    touchKeys[key] = true;
  });
  btn.addEventListener("touchend", (e) => {
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

function pressed(name) {
  return keys[name] || touchKeys[name];
}

function collisionCheck(nextX, nextZ) {
  for (const b of buildings) {
    const dx = Math.abs(nextX - b.position.x);
    const dz = Math.abs(nextZ - b.position.z);
    if (dx < 8 && dz < 8) return true;
  }
  return false;
}

function updatePlayer() {
  const speed = pressed("shift") ? 0.28 : 0.16;

  let moveX = 0;
  let moveZ = 0;

  if (pressed("w") || keys["arrowup"] || pressed("up")) moveZ -= speed;
  if (pressed("s") || keys["arrowdown"] || pressed("down")) moveZ += speed;
  if (pressed("a") || keys["arrowleft"] || pressed("left")) moveX -= speed;
  if (pressed("d") || keys["arrowright"] || pressed("right")) moveX += speed;

  const nextX = player.position.x + moveX;
  const nextZ = player.position.z + moveZ;

  if (!collisionCheck(nextX, player.position.z)) player.position.x = nextX;
  if (!collisionCheck(player.position.x, nextZ)) player.position.z = nextZ;

  if (moveX !== 0 || moveZ !== 0) {
    player.rotation.y = Math.atan2(moveX, moveZ);
  }

  const camOffset = new THREE.Vector3(0, 5, 9);
  const targetCamPos = player.position.clone().add(camOffset);

  camera.position.lerp(targetCamPos, 0.12);
  camera.lookAt(player.position.x, player.position.y + 1.3, player.position.z);
}

function animate() {
  requestAnimationFrame(animate);
  updatePlayer();
  renderer.render(scene, camera);
}

camera.position.set(0, 6, 12);
camera.lookAt(player.position);
animate();

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});