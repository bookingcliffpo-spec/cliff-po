import * as THREE from 'three';
import { PostChain } from './post.js';
import { clamp, damp } from '../core/math.js';

/**
 * RenderSystem — owns the WebGLRenderer, both scenes, both cameras, the shadow
 * cascade follow logic, the environment probe and the post chain.
 */
export class RenderSystem {
  constructor(ctx) {
    this.ctx = ctx;
    this.canvas = ctx.canvas;

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,           // we run our own resolve + sharpen in post
      alpha: false,
      stencil: false,
      depth: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true, // capture harness reads pixels
    });
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping; // done in composite, in linear
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = true;
    this.renderer.info.autoReset = false;

    const caps = this.renderer.capabilities;
    this.maxAniso = caps.getMaxAnisotropy();

    this.scene = new THREE.Scene();
    this.scene.matrixWorldAutoUpdate = true;

    this.camera = new THREE.PerspectiveCamera(74, 1, 0.06, 2600);
    this.camera.rotation.order = 'YXZ';

    // First-person weapon lives in its own scene so it can never clip world geometry.
    this.viewScene = new THREE.Scene();
    this.viewCamera = new THREE.PerspectiveCamera(58, 1, 0.006, 12);
    this.viewCamera.rotation.order = 'YXZ';

    this.baseFov = 74;
    this.fovTarget = 74;
    this.viewBaseFov = 58;
    this.viewFovTarget = 58;

    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    this.renderScale = 1.0;

    this.post = new PostChain(this);

    // Sun + shadow rig (the sky system positions and colours it).
    this.sun = new THREE.DirectionalLight(0xffffff, 3.0);
    this.sun.castShadow = true;
    const sc = this.sun.shadow;
    sc.mapSize.set(4096, 4096);
    sc.camera.near = 1;
    sc.camera.far = 420;
    sc.bias = -0.00045;
    sc.normalBias = 0.055;
    sc.radius = 2.2;
    sc.blurSamples = 12;
    this.shadowSpan = 78;
    this._applyShadowSpan();
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this._shadowFocus = new THREE.Vector3();
    this._resizeQueued = true;
    this._onResize = () => { this._resizeQueued = true; };
    window.addEventListener('resize', this._onResize);

    this.width = 1; this.height = 1;
    this.envRT = null;
    this.pmrem = null;
  }

  init() {
    this._resize();
    this.post.init();
  }

  _applyShadowSpan() {
    const c = this.sun.shadow.camera;
    c.left = -this.shadowSpan; c.right = this.shadowSpan;
    c.top = this.shadowSpan; c.bottom = -this.shadowSpan;
    c.updateProjectionMatrix();
  }

  setQuality(q) {
    if (q === 'low') {
      this.pixelRatio = 1; this.renderScale = 0.75;
      this.sun.shadow.mapSize.set(1536, 1536);
      this.post.bloomEnabled = true; this.post.ssaoEnabled = false;
    } else if (q === 'medium') {
      this.pixelRatio = Math.min(window.devicePixelRatio || 1, 1.25);
      this.renderScale = 0.9;
      this.sun.shadow.mapSize.set(2048, 2048);
      this.post.bloomEnabled = true; this.post.ssaoEnabled = true;
    } else {
      this.pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
      this.renderScale = 1.0;
      this.sun.shadow.mapSize.set(4096, 4096);
      this.post.bloomEnabled = true; this.post.ssaoEnabled = true;
    }
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    this._resizeQueued = true;
  }

  /** Build an IBL probe from the current sky. Called by the sky system. */
  updateEnvironment(skyScene) {
    if (!this.pmrem) {
      this.pmrem = new THREE.PMREMGenerator(this.renderer);
      this.pmrem.compileEquirectangularShader();
    }
    if (this.envRT) this.envRT.dispose();
    // far must clear the sky dome radius or the probe renders a black interior
    this.envRT = this.pmrem.fromScene(skyScene, 0.04, 1, 5000);
    this.scene.environment = this.envRT.texture;
    this.viewScene.environment = this.envRT.texture;
  }

  _resize() {
    const w = Math.max(2, this.canvas.clientWidth || window.innerWidth);
    const h = Math.max(2, this.canvas.clientHeight || window.innerHeight);
    this.width = w; this.height = h;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.viewCamera.aspect = aspect;
    this.viewCamera.updateProjectionMatrix();
    this.post.resize(Math.floor(w * this.pixelRatio * this.renderScale), Math.floor(h * this.pixelRatio * this.renderScale));
    this._resizeQueued = false;
  }

  /** Snap the shadow frustum to texel boundaries so shadows do not swim. */
  _updateShadow() {
    const cam = this.camera;
    const dir = this.sun.position.clone().normalize();
    // Focus a little ahead of the camera so most of the shadow map is useful.
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    fwd.y = 0; fwd.normalize();
    this._shadowFocus.copy(cam.position).addScaledVector(fwd, this.shadowSpan * 0.42);
    this._shadowFocus.y = 0;

    const texel = (this.shadowSpan * 2) / this.sun.shadow.mapSize.x;
    const f = this._shadowFocus;
    f.x = Math.round(f.x / texel) * texel;
    f.z = Math.round(f.z / texel) * texel;

    this.sun.target.position.copy(f);
    this.sun.position.copy(f).addScaledVector(dir, 190);
    this.sun.target.updateMatrixWorld();
    this.sun.updateMatrixWorld();
  }

  update(dt) {
    if (this._resizeQueued) this._resize();
    this.camera.fov = damp(this.camera.fov, this.fovTarget, 14, dt);
    this.camera.updateProjectionMatrix();
    this.viewCamera.fov = damp(this.viewCamera.fov, this.viewFovTarget, 14, dt);
    this.viewCamera.updateProjectionMatrix();
    this.viewCamera.position.copy(this.camera.position);
    this.viewCamera.quaternion.copy(this.camera.quaternion);
  }

  render(dt) {
    this._updateShadow();
    this.renderer.info.reset();
    this.post.render(dt);
    const info = this.renderer.info;
    const st = this.ctx.stats;
    st.drawCalls = info.render.calls;
    st.triangles = info.render.triangles;
    st.programs = info.programs ? info.programs.length : 0;
  }

  /** Compile every shader before the first presented frame. */
  async prewarm() {
    this.renderer.compile(this.scene, this.camera);
    this.renderer.compile(this.viewScene, this.viewCamera);
    this.renderer.shadowMap.needsUpdate = true;
    this.post.prewarm();
    // Two throwaway frames force shadow + post program links.
    this.post.render(1 / 60);
    this.post.render(1 / 60);
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.post.dispose();
    if (this.envRT) this.envRT.dispose();
    if (this.pmrem) this.pmrem.dispose();
    this.renderer.dispose();
  }
}
