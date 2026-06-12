import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.164.1/build/three.module.js";

const canvas = document.getElementById("game");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);

const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, 1000);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(1);

scene.add(new THREE.AmbientLight(0xffffff, 2.3));

const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(50, 80, 50);
scene.add(sun);

const keys = {};
const touchKeys = {};

window.addEventListener("keydown", e => keys[e.key.toLowerCase()] = true);
window.addEventListener("keyup", e => keys[e.key.toLowerCase()] = false);

function mat(color) {
  return new THREE.MeshStandardMaterial({ color });
}

function box(w, h, d, color, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  mesh.position.set(x, y, z);
  scene.add(mesh);
  return mesh;
}

const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), mat(0x222222));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

for (let i = -4; i <= 4; i++) {
  box(300, 0.05, 12, 0x111111, 0, 0.03, i * 34);
  box(12, 0.05, 300, 0x111111, i * 34, 0.04, 0);
  box(300, 0.08, 4, 0x888888, 0, 0.08, i * 34 + 9);
  box(300, 0.08, 4, 0x888888, 0, 0.08, i * 34 - 9);
}

for (let i = -120; i <= 120; i += 18) {
  box(0.35, 0.08, 5, 0xe8c64a, 0, 0.12, i);
}

for (let x = -102; x <= 102; x += 34) {
  for (let z = -102; z <= 102; z += 34) {
    if (Math.abs(x) < 30 && Math.abs(z) < 30) continue;
    const h = 12 + Math.random() * 20;
    box(15, h, 15, 0x8b4a2b, x, h / 2, z);
  }
}

const player = new THREE.Group();
player.position.set(0, 0, 0);
scene.add(player);

const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.1, 0.4), mat(0x111111));
body.position.y = 1.3;
player.add(body);

const legs = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1, 0.3), mat(0x1b355d));
legs.position.y = 0.5;
player.add(legs);

const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 24, 24), mat(0x6b3f22));
head.position.y = 2.1;
player.add(head);

const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.16, 24), mat(0x050505));
cap.position.y = 2.42;
player.add(cap);

function bind(id, key) {
  const b = document.getElementById(id);
  if (!b) return;
  b.addEventListener("touchstart", e => { e.preventDefault(); touchKeys[key] = true; });
  b.addEventListener("touchend", e => { e.preventDefault(); touchKeys[key] = false; });
  b.addEventListener("mousedown", () => touchKeys[key] = true);
  b.addEventListener("mouseup", () => touchKeys[key] = false);
}

bind("up", "up");
bind("down", "down");
bind("left", "left");
bind("right", "right");

function pressed(k) {
  return keys[k] || touchKeys[k];
}

function update() {
  const speed = pressed("shift") ? 0.55 : 0.3;

  let mx = 0;
  let mz = 0;

  if (pressed("w") || keys.arrowup || pressed("up")) mz -= speed;
  if (pressed("s") || keys.arrowdown || pressed("down")) mz += speed;
  if (pressed("a") || keys.arrowleft || pressed("left")) mx -= speed;
  if (pressed("d") || keys.arrowright || pressed("right")) mx += speed;

  player.position.x += mx;
  player.position.z += mz;

  if (mx || mz) player.rotation.y = Math.atan2(mx, mz);

  camera.position.lerp(player.position.clone().add(new THREE.Vector3(0, 5, 9)), 0.22);
  camera.lookAt(player.position.x, 1.5, player.position.z);
}

function animate() {
  requestAnimationFrame(animate);
  update();
  renderer.render(scene, camera);
}

camera.position.set(0, 5, 9);
animate();

window.addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});