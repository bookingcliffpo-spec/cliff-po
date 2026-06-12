import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.164/build/three.module.js';

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);

const renderer = new THREE.WebGLRenderer({ antialias: true });

renderer.setSize(window.innerWidth, window.innerHeight);

document.body.appendChild(renderer.domElement);

const geometry = new THREE.BoxGeometry();

const material = new THREE.MeshStandardMaterial({
  color: 0xffd700
});

const cube = new THREE.Mesh(geometry, material);

scene.add(cube);

const light = new THREE.DirectionalLight(0xffffff, 2);

light.position.set(5, 10, 5);

scene.add(light);

camera.position.z = 5;

function animate() {
  requestAnimationFrame(animate);

  cube.rotation.y += 0.01;

  renderer.render(scene, camera);
}

animate();