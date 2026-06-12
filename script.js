import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.164.1/build/three.module.js";

const canvas=document.getElementById("game");
const mini=document.getElementById("mini");
const mctx=mini.getContext("2d");

const scene=new THREE.Scene();
scene.background=new THREE.Color(0x8fd3ff);
scene.fog=new THREE.Fog(0x8fd3ff,120,420);

const camera=new THREE.PerspectiveCamera(65,innerWidth/innerHeight,.1,1000);
const renderer=new THREE.WebGLRenderer({canvas,antialias:true});
renderer.setSize(innerWidth,innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.shadowMap.enabled=true;
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.2;

scene.add(new THREE.HemisphereLight(0xcceeff,0x3b2a1a,1.2));
const sun=new THREE.DirectionalLight(0xfff0c8,3.6);
sun.position.set(-70,100,60);
sun.castShadow=true;
sun.shadow.mapSize.set(2048,2048);
scene.add(sun);

const colliders=[], keys={}, touch={};

function material(color,rough=.7,metal=0){
  return new THREE.MeshStandardMaterial({color,roughness:rough,metalness:metal});
}

function box(w,h,d,color,x,y,z,rough=.7,metal=0){
  const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material(color,rough,metal));
  m.position.set(x,y,z);
  m.castShadow=true;
  m.receiveShadow=true;
  scene.add(m);
  return m;
}

function cyl(r,h,color,x,y,z){
  const m=new THREE.Mesh(new THREE.CylinderGeometry(r,r,h,32),material(color));
  m.position.set(x,y,z);
  m.castShadow=true;
  m.receiveShadow=true;
  scene.add(m);
  return m;
}

function sign(text,w=512,h=180,size=44,bg="#2b160b",fg="#f5c76b"){
  const c=document.createElement("canvas");
  c.width=w;c.height=h;
  const ctx=c.getContext("2d");
  ctx.fillStyle=bg;ctx.fillRect(0,0,w,h);
  ctx.strokeStyle="#d9a441";ctx.lineWidth=10;ctx.strokeRect(8,8,w-16,h-16);
  ctx.fillStyle=fg;ctx.font=`900 ${size}px Arial`;ctx.textAlign="center";ctx.textBaseline="middle";
  const lines=text.split("\n");
  lines.forEach((t,i)=>ctx.fillText(t,w/2,h/2+(i-(lines.length-1)/2)*size*1.1));
  const tex=new THREE.CanvasTexture(c);
  const s=new THREE.Sprite(new THREE.SpriteMaterial({map:tex}));
  return s;
}

function brickTexture(){
  const c=document.createElement("canvas");
  c.width=512;c.height=512;
  const ctx=c.getContext("2d");
  ctx.fillStyle="#6b3e28";ctx.fillRect(0,0,512,512);
  for(let y=0;y<512;y+=32){
    for(let x=(y/32)%2? -40:0;x<512;x+=80){
      ctx.fillStyle="rgba(0,0,0,.22)";
      ctx.fillRect(x,y,76,3);
      ctx.fillRect(x,y,3,30);
      ctx.fillStyle="rgba(255,220,160,.05)";
      ctx.fillRect(x+4,y+5,65,12);
    }
  }
  return new THREE.CanvasTexture(c);
}

function asphaltTexture(){
  const c=document.createElement("canvas");
  c.width=512;c.height=512;
  const ctx=c.getContext("2d");
  ctx.fillStyle="#202020";ctx.fillRect(0,0,512,512);
  for(let i=0;i<3000;i++){
    const g=Math.floor(30+Math.random()*80);
    ctx.fillStyle=`rgba(${g},${g},${g},${Math.random()*.2})`;
    ctx.fillRect(Math.random()*512,Math.random()*512,1+Math.random()*3,1+Math.random()*3);
  }
  return new THREE.CanvasTexture(c);
}

const asphalt=asphaltTexture();
asphalt.wrapS=asphalt.wrapT=THREE.RepeatWrapping;
asphalt.repeat.set(30,30);

const brick=brickTexture();
brick.wrapS=brick.wrapT=THREE.RepeatWrapping;
brick.repeat.set(2,6);

const ground=new THREE.Mesh(
  new THREE.PlaneGeometry(420,420),
  new THREE.MeshStandardMaterial({map:asphalt,roughness:.42,metalness:.05})
);
ground.rotation.x=-Math.PI/2;
ground.receiveShadow=true;
scene.add(ground);

function road(x,z,w,d){
  box(w,.04,d,0x111111,x,.04,z,.35,.05);
}

function createRoads(){
  for(let i=-6;i<=6;i++){
    road(0,i*32,420,14);
    road(i*32,0,14,420);

    box(420,.08,4,0x777777,0,.08,i*32+9);
    box(420,.08,4,0x777777,0,.08,i*32-9);
    box(4,.08,420,0x777777,i*32+9,.08,0);
    box(4,.08,420,0x777777,i*32-9,.08,0);
  }
  for(let i=-200;i<=200;i+=16){
    box(.35,.09,5,0xe3c34d,0,.13,i,.3);
    box(5,.09,.35,0xe3c34d,i,.13,0,.3);
  }
}

function building(x,z,w,d,h,type="brownstone"){
  const matB=new THREE.MeshStandardMaterial({
    map:brick,
    color:type==="store"?0xffffff:0xb48a61,
    roughness:.85
  });
  const b=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),matB);
  b.position.set(x,h/2,z);
  b.castShadow=true;b.receiveShadow=true;
  scene.add(b);
  colliders.push({x,z,w,d});

  const front=z-d/2-.05;
  for(let y=3;y<h-1;y+=3){
    for(let xx=-w/2+2;xx<w/2-1;xx+=3.2){
      const win=box(1.25,1.3,.08,0xffc96b,x+xx,y,front,.25,.15);
      win.material.emissive=new THREE.Color(0x2a1800);
      win.material.emissiveIntensity=.45;
    }
  }

  box(w*.45,2,.18,0x111111,x,1.15,front-.1);
  box(w*.7,.35,.35,0xd6aa58,x,2.45,front-.15);

  if(type==="store"){
    const names=["SOUL FOOD","BILL'S RECORDS","BARBER SHOP","LENNOX LOUNGE","BODEGA","CHICKEN & FISH"];
    const s=sign(names[Math.floor(Math.random()*names.length)],512,150,42);
    s.position.set(x,4.2,front-.35);
    s.scale.set(10,3,1);
    scene.add(s);
  }

  for(let y=5;y<h-2;y+=5){
    box(.25,3,.25,0x111111,x-w/2-.35,y,z);
    box(2.2,.18,.25,0x111111,x-w/2-.35,y-1.5,z);
  }
}

function makeCar(x,z,color=0x050505){
  const car=new THREE.Group();
  const body=new THREE.Mesh(new THREE.BoxGeometry(3.4,.75,6),material(color,.22,.45));
  body.position.y=.7;body.castShadow=true;car.add(body);
  const top=new THREE.Mesh(new THREE.BoxGeometry(2.2,.8,2.4),material(0x111111,.28,.35));
  top.position.set(0,1.25,-.3);top.castShadow=true;car.add(top);
  const glass=new THREE.Mesh(new THREE.BoxGeometry(2,.45,1.7),material(0x4eb5ff,.08,.1));
  glass.position.set(0,1.45,-.65);car.add(glass);
  for(const sx of[-1.25,1.25])for(const sz of[-2,2]){
    const w=new THREE.Mesh(new THREE.CylinderGeometry(.42,.42,.3,24),material(0x050505));
    w.rotation.z=Math.PI/2;w.position.set(sx,.35,sz);car.add(w);
  }
  car.position.set(x,0,z);
  car.rotation.y=Math.random()*Math.PI;
  scene.add(car);
}

function makeNPC(x,z){
  const npc=new THREE.Group();
  const skin=[0x5b351f,0x7a4a2a,0x3b2316][Math.floor(Math.random()*3)];
  const shirt=[0x111111,0x1d3557,0x5a189a,0x7f5539][Math.floor(Math.random()*4)];
  const body=new THREE.Mesh(new THREE.BoxGeometry(.55,1,.32),material(shirt));
  body.position.y=1;body.castShadow=true;npc.add(body);
  const head=new THREE.Mesh(new THREE.SphereGeometry(.24,18,18),material(skin));
  head.position.y=1.65;head.castShadow=true;npc.add(head);
  npc.position.set(x,0,z);
  scene.add(npc);
}

function streetProps(){
  for(let i=0;i<80;i++){
    const x=(Math.random()-.5)*380,z=(Math.random()-.5)*380;
    cyl(.1,4,0x222222,x,2,z);
    const l=new THREE.PointLight(0xffcc77,.45,18);
    l.position.set(x,4.4,z);scene.add(l);
  }
  for(let i=0;i<45;i++){
    const x=(Math.random()-.5)*360,z=(Math.random()-.5)*360;
    cyl(.28,.7,0xaa2222,x,.35,z);
  }
  for(let i=0;i<22;i++){
    const s=sign(["W 125 ST","ONE WAY","LENOX AVE","PARKING","APOLLO"][Math.floor(Math.random()*5)],420,120,45,"#16492d","#ffffff");
    s.position.set((Math.random()-.5)*320,5,(Math.random()-.5)*320);
    s.scale.set(5,1.5,1);
    scene.add(s);
  }
}

function createCity(){
  createRoads();

  for(let x=-176;x<=176;x+=32){
    for(let z=-176;z<=176;z+=32){
      if(Math.abs(x)<32&&Math.abs(z)<32)continue;
      const h=12+Math.random()*30;
      building(x+12,z+12,16,16,h,Math.random()>.6?"store":"brownstone");
    }
  }

  const apollo=sign("APOLLO",320,600,78,"#2b160b","#ff9b2f");
  apollo.position.set(-52,15,-28);
  apollo.scale.set(5,14,1);
  scene.add(apollo);

  const mural=sign("WELCOME TO\nHARLEM",600,260,68,"#4a1e16","#f4c66b");
  mural.position.set(-18,8,-44);
  mural.scale.set(16,7,1);
  scene.add(mural);

  for(let i=0;i<35;i++)makeCar((Math.random()-.5)*330,(Math.random()-.5)*330,[0x050505,0x7a0000,0x15315b,0xb8b8b8][Math.floor(Math.random()*4)]);
  for(let i=0;i<45;i++)makeNPC((Math.random()-.5)*330,(Math.random()-.5)*330);
  streetProps();
}

const player=new THREE.Group();
player.position.set(0,0,0);
scene.add(player);

function createPlayer(){
  const skin=0x6b3f22;
  const pants=0x1b355d;
  const jacket=0x080a12;

  const leg1=box(.28,1,.28,pants,-.2,.5,0);
  const leg2=box(.28,1,.28,pants,.2,.5,0);
  const body=box(.75,1.05,.38,jacket,0,1.35,0);
  const head=new THREE.Mesh(new THREE.SphereGeometry(.32,32,32),material(skin,.42));
  head.position.y=2.1;head.castShadow=true;player.add(head);
  const cap=new THREE.Mesh(new THREE.CylinderGeometry(.36,.36,.16,32),material(0x050505));
  cap.position.y=2.42;cap.castShadow=true;player.add(cap);
  const brim=box(.45,.05,.25,0x050505,0,2.38,-.28);
  const chain=new THREE.Mesh(new THREE.TorusGeometry(.28,.025,8,32),material(0xffd700,.2,.9));
  chain.rotation.x=Math.PI/2;chain.position.set(0,1.6,-.23);player.add(chain);
  player.add(leg1,leg2,body,brim);
}
createPlayer();
createCity();

function bind(id,key){
  const b=document.getElementById(id);
  b.addEventListener("touchstart",e=>{e.preventDefault();touch[key]=true});
  b.addEventListener("touchend",e=>{e.preventDefault();touch[key]=false});
}
["up","down","left","right"].forEach(id=>bind(id,id));

addEventListener("keydown",e=>keys[e.key.toLowerCase()]=true);
addEventListener("keyup",e=>keys[e.key.toLowerCase()]=false);

function pressed(k){return keys[k]||touch[k]}

function blocked(x,z){
  for(const c of colliders){
    if(Math.abs(x-c.x)<c.w/2+1&&Math.abs(z-c.z)<c.d/2+1)return true;
  }
  return false;
}

function updatePlayer(){
  let speed=pressed("shift")?.34:.2;
  let mx=0,mz=0;
  if(pressed("w")||keys.arrowup||pressed("up"))mz-=speed;
  if(pressed("s")||keys.arrowdown||pressed("down"))mz+=speed;
  if(pressed("a")||keys.arrowleft||pressed("left"))mx-=speed;
  if(pressed("d")||keys.arrowright||pressed("right"))mx+=speed;

  const nx=player.position.x+mx,nz=player.position.z+mz;
  if(!blocked(nx,player.position.z))player.position.x=nx;
  if(!blocked(player.position.x,nz))player.position.z=nz;
  if(mx||mz)player.rotation.y=Math.atan2(mx,mz);

  const target=player.position.clone().add(new THREE.Vector3(0,4.7,8.8));
  camera.position.lerp(target,.1);
  camera.lookAt(player.position.x,1.45,player.position.z);
}

function drawMini(){
  mini.width=150;mini.height=150;
  mctx.fillStyle="#222";mctx.fillRect(0,0,150,150);
  mctx.strokeStyle="#777";
  for(let i=0;i<150;i+=20){
    mctx.beginPath();mctx.moveTo(i,0);mctx.lineTo(i,150);mctx.stroke();
    mctx.beginPath();mctx.moveTo(0,i);mctx.lineTo(150,i);mctx.stroke();
  }
  mctx.fillStyle="#ffcc33";
  mctx.beginPath();mctx.arc(75,75,6,0,Math.PI*2);mctx.fill();
}

function animate(){
  requestAnimationFrame(animate);
  updatePlayer();
  drawMini();
  renderer.render(scene,camera);
}

camera.position.set(0,5,9);
animate();

addEventListener("resize",()=>{
  camera.aspect=innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth,innerHeight);
});