// Preallocated scratch objects for hot paths. Never store references to these.
import * as THREE from 'three';

export const v3 = Array.from({ length: 16 }, () => new THREE.Vector3());
export const v2 = Array.from({ length: 8 }, () => new THREE.Vector2());
export const quat = Array.from({ length: 6 }, () => new THREE.Quaternion());
export const mat4 = Array.from({ length: 8 }, () => new THREE.Matrix4());
export const euler = Array.from({ length: 4 }, () => new THREE.Euler());
export const color = Array.from({ length: 6 }, () => new THREE.Color());
export const box3 = Array.from({ length: 4 }, () => new THREE.Box3());
export const ray = new THREE.Ray();
