import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.164.1/build/three.module.js";

const canvas = document.getElementById("game");
const mini = document.getElementById("miniMap");
const mctx = mini.getContext("2d");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fd3ff);
scene.fog = new THREE.Fog(0x8fd3ff, 90, 320);

const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, 1000);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const hemi = new THREE.HemisphereLight(0xbfe7ff, 0x3b2a1a, 1.2);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff1cf, 3.2);
sun.position.set(-55, 90, 45);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);

const keys = {};
const touchKeys = {};
const colliders = [];
const cars = [];
const npcs = [];

window.addEventListener("keydown", e => keys[e.key.toLowerCase()] = true);
window.addEventListener("keyup", e => keys[e.key.toLowerCase()] = false);

function mat(color, rough = .6, metal = 0) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: rough,
    metalness: metal
  });
}

function box(w,h,d,color,x,y,z, rough=.7, metal=0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), mat(color, rough, metal));
  mesh.position.set(x,y,z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

function cyl(r,h,color,x,y,z) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r,r,h,24), mat(color));
  mesh.position.set(x,y,z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

function textSprite(text, size=64) {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 160;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "rgba(20,10,5,.85)";
  ctx.fillRect(0,0,c.width,c.height);
  ctx.strokeStyle = "#d9a441";
  ctx.lineWidth = 8;
  ctx.strokeRect(8,8,c.width-16,c.height-16);
  ctx.fillStyle = "#f4c96b";
  ctx.font = `bold ${size}px Arial`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, c.width/2, c.height/2);
  const tex = new THREE.CanvasTexture(c);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex }));
  s.scale.set(10,3,1);
  return s;
}

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(340,340),
  new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: .45 })
);
ground.rotation.x = -Math.PI/2;
ground.receiveShadow = true;
scene.add(ground);

function createRoads() {
  for (let i=-5;i<=5;i++) {
    box(340,.04,13,0x121212,0,.03,i*32,.35);
    box(13,.04,340,0x121212,i*32,.04,0,.35);

    box(340,.08,4,0x767676,0,.08,i*32+8.5);
    box(340,.08,4,0x767676,0,.08,i*32-8.5);
    box(4,.08,340,0x767676,i*32+8.5,.09,0);
    box(4,.08,340,0x767676,i*32-8.5,.09,0);
  }

  for (let i=-160;i<=160;i+=14) {
    box(.35,.07,5,0xe8c64a,0,.13,i);
    box(5,.07,.35,0xe8c64a,i,.13,0);
  }

  for (let x=-160;x<=160;x+=32) {
    for (let z=-160;z<=160;z+=32) {
      for (let k=-5;k<=5;k+=2) {
        box(1.2,.08,.25,0xf2f2f2,x+k,.16,z+6.2);
        box(.25,.08,1.2,0xf2f2f2,x+6.2,.16,z+k);
      }
    }
  }
}

function createBuilding(x,z,w,d,h,color,type="brownstone") {
  const b = box(w,h,d,color,x,h/2,z,.9);
  colliders.push({x,z,w,d});
  const rows = Math.floor(h/3);
  const frontZ = z - d/2 - .04;

  for (let r=1;r<rows;r++) {
    for (let c=-Math.floor(w/3); c<=Math.floor(w/3); c+=3) {
      const win = box(1.1,1.25,.08,0xffd37a,x+c,r*3,frontZ,.3);
      win.material.emissive = new THREE.Color(0x2b1b00);
      win.material.emissiveIntensity = .45;
    }
  }

  box(w*.55,2,.14,0x111111,x,1.15,frontZ-.05);
  box(w*.45,.35,.25,0xcaa35b,x,2.45,frontZ-.12);

  if (type === "store") {
    const sign = textSprite(["SOUL FOOD","BILL'S RECORDS","BARBER SHOP","LENNOX LOUNGE"][Math.floor(Math.random()*4)], 42);
    sign.position.set(x,4,frontZ-.3);
    scene.add(sign);
  }

  if (type === "apollo") {
    const sign = textSprite("APOLLO", 70);
    sign.position.set(x,9,frontZ-.5);
    sign.scale.set(8,9,1);
    scene.add(sign);
  }

  for (let fy=4;fy<h-2;fy+=5) {
    box(.25,3,.25,0x111111,x-w/2-.25,fy,z);
    box(2,.18,.25,0x111111,x-w/2-.25,fy-1.5,z);
  }
}

function createCity() {
  createRoads();

  for (let x=-144;x<=144;x+=32) {
    for (let z=-144;z<=144;z+=32) {
      if (Math.abs(x)<28 && Math.abs(z)<28) continue;
      const h = 10 + Math.random()*26;
      const colors = [0x5a3825,0x6b3d27,0x7c5431,0x4a3328,0x8a613a];
      const type = Math.random()>.72 ? "store" : "brownstone";
      createBuilding(x+12,z+12,15,15,h,colors[Math.floor(Math.random()*colors.length)], type);
    }
  }

  createBuilding(-62,-20,18,18,22,0x5c2d1e,"apollo");

  const mural = textSprite("WELCOME TO HARLEM", 42);
  mural.position.set(-12,7,-42);
  mural.scale.set(13,4,1);
  scene.add(mural);

  for (let i=0;i<70;i++) {
    const x = (Math.random()-.5)*300;
    const z = (Math.random()-.5)*300;
    cyl(.12,4,0x202020,x,2,z);
    const lamp = new THREE.PointLight(0xffcc66,.7,20);
    lamp.position.set(x,4.4,z);
    scene.add(lamp);
  }

  for (let i=0;i<30;i++) makeCar((Math.random()-.5)*250,(Math.random()-.5)*250);
  for (let i=0;i<35;i++) makeNPC((Math.random()-.5)*250,(Math.random()-.5)*250);
}

const player = new THREE.Group();
player.position.set(0,0,0);
scene.add(player);

function createPlayer() {
  const legs = box(.32,1,.32,0x1d3557,-.23,.5,0);
  const legs2 = box(.32,1,.32,0x1d3557,.23,.5,0);
  const torso = box(.9,1.1,.45,0x080b12,0,1.45,0);
  const head = new THREE.Mesh(new THREE.SphereGeometry(.34,32,32), mat(0x6b3f22,.45));
  head.position.y = 2.25;
  head.castShadow = true;
  player.add(head);

  const cap = new THREE.Mesh(new THREE.CylinderGeometry(.38,.38,.18,32), mat(0x050505));
  cap.position.y = 2.55;
  cap.castShadow = true;
  player.add(cap);

  const brim = box(.5,.06,.22,0x050505,0,2.5,-.3);
  const chain = new THREE.Mesh(new THREE.TorusGeometry(.32,.025,8,32), mat(0xffd700,.25,.8));
  chain.rotation.x = Math.PI/2;
  chain.position.set(0,1.65,-.25);
  player.add(chain);

  player.add(legs,legs2,torso,brim);
}
createPlayer();

function makeCar(x,z) {
  const car = new THREE.Group();
  const body = box(3.4,.75,6,0x050505,0,.7,0,.22,.4);
  const top = box(2.2,.8,2.5,0x111111,0,1.25,-.3,.25,.3);
  const glass = box(2,.45,1.8,0x5ab4ff,0,1.42,-.65,.1,.1);
  car.add(body,top,glass);
  for (const sx of [-1.25,1.25]) for (const sz of [-2,2]) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(.42,.42,.28,24), mat(0x050505,.8));
    wheel.rotation.z = Math.PI/2;
    wheel.position.set(sx,.35,sz);
    car.add(wheel);
  }
  car.position.set(x,0,z);
  car.rotation.y = Math.random()*Math.PI;
  scene.add(car);
  cars.push(car);
}

function makeNPC(x,z) {
  const npc = new THREE.Group();
  const skin = [0x5b351f,0x7a4a2a,0x3b2316][Math.floor(Math.random()*3)];
  npc.add(box(.65,1,.35,0x222244,0,1,0));
  const h = new THREE.Mesh(new THREE.SphereGeometry(.25,16,16), mat(skin));
  h.position.y = 1.65;
  npc.add(h);
  npc.position.set(x,0,z);
  scene.add(npc);
  npcs.push({mesh:npc, angle:Math.random()*6.28, speed:.01+Math.random()*.02});
}

createCity();

function bindButton(id,key) {
  const btn = document.getElementById(id);
  btn.addEventListener("touchstart",e=>{e.preventDefault();touchKeys[key]=true;});
  btn.addEventListener("touchend",e=>{e.preventDefault();touchKeys[key]=false;});
  btn.addEventListener("mousedown",()=>touchKeys[key]=true);
  btn.addEventListener("mouseup",()=>touchKeys[key]=false);
}

bindButton("up","up"); bindButton("down","down"); bindButton("left","left"); bindButton("right","right");

function pressed(k){ return keys[k] || touchKeys[k]; }

function blocked(x,z) {
  for (const c of colliders) {
    if (Math.abs(x-c.x)<c.w/2+1 && Math.abs(z-c.z)<c.d/2+1) return true;
  }
  return false;
}

function updatePlayer() {
  const speed = pressed("shift") ? .34 : .2;
  let mx=0,mz=0;
  if (pressed("w")||keys.arrowup||pressed("up")) mz-=speed;
  if (pressed("s")||keys.arrowdown||pressed("down")) mz+=speed;
  if (pressed("a")||keys.arrowleft||pressed("left")) mx-=speed;
  if (pressed("d")||keys.arrowright||pressed("right")) mx+=speed;

  const nx = player.position.x + mx;
  const nz = player.position.z + mz;

  if (!blocked(nx, player.position.z)) player.position.x = nx;
  if (!blocked(player.position.x, nz)) player.position.z = nz;

  if (mx || mz) player.rotation.y = Math.atan2(mx,mz);

  const offset = new THREE.Vector3(0,4.6,8.5);
  const target = player.position.clone().add(offset);
  camera.position.lerp(target,.11);
  camera.lookAt(player.position.x,1.45,player.position.z);
}

function updateNPCs() {
  for (const n of npcs) {
    n.mesh.position.x += Math.sin(n.angle)*n.speed;
    n.mesh.position.z += Math.cos(n.angle)*n.speed;
    if (Math.random()<.01) n.angle += (Math.random()-.5)*1.5;
  }
}

function drawMiniMap() {
  mctx.clearRect(0,0,150,150);
  mctx.fillStyle = "#2b2b2b";
  mctx.fillRect(0,0,150,150);
  mctx.strokeStyle = "#777";
  for (let i=0;i<150;i+=20) {
    mctx.beginPath(); mctx.moveTo(i,0); mctx.lineTo(i,150); mctx.stroke();
    mctx.beginPath(); mctx.moveTo(0,i); mctx.lineTo(150,i); mctx.stroke();
  }
  mctx.fillStyle = "#ffcf33";
  mctx.beginPath(); mctx.arc(75,75,6,0,Math.PI*2); mctx.fill();
}

function animate() {
  requestAnimationFrame(animate);
  updatePlayer();
  updateNPCs();
  drawMiniMap();
  renderer.render(scene,camera);
}

camera.position.set(0,5,9);
animate();

window.addEventListener("resize",()=>{
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth,innerHeight);
});