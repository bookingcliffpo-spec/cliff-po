import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.164.1/build/three.module.js";

const canvas = document.getElementById("game");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);

const renderer = new THREE.WebGLRenderer({
  canvas: canvas,
  antialias: true
});

renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.position.set(10, 20, 10);
scene.add(sun);

const ambient = new THREE.AmbientLight(0xffffff, 1);
scene.add(ambient);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.MeshStandardMaterial({ color: 0x333333 })
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const player = new THREE.Mesh(
  new THREE.BoxGeometry(1, 2, 1),
  new THREE.MeshStandardMaterial({ color: 0xffd700 })
);
player.position.y = 1;
scene.add(player);

for (let i = 0; i < 30; i++) {
  const building = new THREE.Mesh(
    new THREE.BoxGeometry(4, Math.random() * 12 + 4, 4),
    new THREE.MeshStandardMaterial({ color: 0x555555 })
  );

  building.position.set(
    (Math.random() - 0.5) * 100,
    building.geometry.parameters.height / 2,
    (Math.random() - 0.5) * 100
  );

  scene.add(building);
}

const keys = {};

window.addEventListener("keydown", (e) => {
  keys[e.key.toLowerCase()] = true;
});

window.addEventListener("keyup", (e) => {
  keys[e.key.toLowerCase()] = false;
});

function updatePlayer() {
  const speed = keys["shift"] ? 0.18 : 0.1;

  if (keys["w"] || keys["arrowup"]) player.position.z -= speed;
  if (keys["s"] || keys["arrowdown"]) player.position.z += speed;
  if (keys["a"] || keys["arrowleft"]) player.position.x -= speed;
  if (keys["d"] || keys["arrowright"]) player.position.x += speed;

  camera.position.set(
    player.position.x,
    player.position.y + 5,
    player.position.z + 8
  );

  camera.lookAt(player.position);
}

function animate() {
  requestAnimationFrame(animate);
  updatePlayer();
  renderer.render(scene, camera);
}

animate();

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});