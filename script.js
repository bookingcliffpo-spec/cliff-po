alert("NEW SCRIPT IS LOADING");
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.164.1/build/three.module.js";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.164.1/examples/jsm/loaders/GLTFLoader.js";

const canvas = document.getElementById("game");
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);

const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(1);

scene.add(new THREE.AmbientLight(0xffffff, 2.5));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(50, 80, 50);
scene.add(sun);

const loader = new GLTFLoader();
const keys = {};
const touchKeys = {};

window.addEventListener("keydown", e => keys[e.key.toLowerCase()] = true);
window.addEventListener("keyup", e => keys[e.key.toLowerCase()] = false);

function mat(color) {
  return new THREE.MeshStandardMaterial({ color });
}

function box(w,h,d,color,x,y,z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), mat(color));
  m.position.set(x,y,z);
  scene.add(m);
  return m;
}

/* ALWAYS VISIBLE WORLD */
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(300,300),
  mat(0x222222)
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

for (let i = -4; i <= 4; i++) {
  box(300,.05,12,0x111111,0,.03,i*34);
  box(12,.05,300,0x111111,i*34,.04,0);
  box(300,.08,4,0x888888,0,.08,i*34+9);
  box(300,.08,4,0x888888,0,.08,i*34-9);
}

for (let i = -120; i <= 120; i += 18) {
  box(.35,.08,5,0xe8c64a,0,.12,i);
}

/* PLAYER */
const player = new THREE.Group();
player.position.set(0,0,0);
scene.add(player);

function fallbackPlayer() {
  player.clear();
  const body = box(.8,1.1,.4,0x111111,0,1.3,0);
  const legs = box(.55,1,.3,0x1b355d,0,.5,0);
  const head = new THREE.Mesh(new THREE.SphereGeometry(.32,24,24), mat(0x6b3f22));
  head.position.y = 2.1;
  player.add(body, legs, head);
}

fallbackPlayer();

loader.load("./assets/player.glb", gltf => {
  const model = gltf.scene;
  model.scale.set(.01,.01,.01);
  model.position.set(0,0,0);
  player.clear();
  player.add(model);
  console.log("player loaded");
}, undefined, err => {
  console.error("player failed", err);
});

/* BUILDINGS */
function fallbackBuildings() {
  for (let x = -100; x <= 100; x += 34) {
    for (let z = -100; z <= 100; z += 34) {
      if (Math.abs(x) < 30 && Math.abs(z) < 30) continue;
      const h = 12 + Math.random() * 20;
      box(15,h,15,0x8b4a2b,x,h/2,z);
    }
  }
}

fallbackBuildings();

loader.load("./assets/building.glb", gltf => {
  const base = gltf.scene;
  base.scale.set(.02,.02,.02);

  for (let x = -100; x <= 100; x += 50) {
    for (let z = -100; z <= 100; z += 50) {
      if (Math.abs(x) < 30 && Math.abs(z) < 30) continue;
      const b = base.clone(true);
      b.position.set(x,0,z);
      scene.add(b);
    }
  }

  console.log("building loaded");
}, undefined, err => {
  console.error("building failed", err);
});

/* CARS */
loader.load("./assets/car.glb", gltf => {
  const base = gltf.scene;
  base.scale.set(.02,.02,.02);

  for (let i = 0; i < 5; i++) {
    const c = base.clone(true);
    c.position.set((Math.random()-.5)*100,0,(Math.random()-.5)*100);
    scene.add(c);
  }

  console.log("car loaded");
}, undefined, err => {
  console.error("car failed", err);
});

/* CONTROLS */
function bind(id,key) {
  const b = document.getElementById(id);
  if (!b) return;
  b.addEventListener("touchstart", e => { e.preventDefault(); touchKeys[key] = true; });
  b.addEventListener("touchend", e => { e.preventDefault(); touchKeys[key] = false; });
  b.addEventListener("mousedown", () => touchKeys[key] = true);
  b.addEventListener("mouseup", () => touchKeys[key] = false);
}

bind("up","up");
bind("down","down");
bind("left","left");
bind("right","right");

function pressed(k) {
  return keys[k] || touchKeys[k];
}

function update() {
  const speed = pressed("shift") ? .55 : .3;

  let mx = 0;
  let mz = 0;

  if (pressed("w") || keys.arrowup || pressed("up")) mz -= speed;
  if (pressed("s") || keys.arrowdown || pressed("down")) mz += speed;
  if (pressed("a") || keys.arrowleft || pressed("left")) mx -= speed;
  if (pressed("d") || keys.arrowright || pressed("right")) mx += speed;

  player.position.x += mx;
  player.position.z += mz;

  if (mx || mz) player.rotation.y = Math.atan2(mx,mz);

  camera.position.lerp(
    player.position.clone().add(new THREE.Vector3(0,5,9)),
    .2
  );

  camera.lookAt(player.position.x,1.5,player.position.z);
}

function animate() {
  requestAnimationFrame(animate);
  update();
  renderer.render(scene,camera);
}

camera.position.set(0,5,9);
animate();

window.addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
