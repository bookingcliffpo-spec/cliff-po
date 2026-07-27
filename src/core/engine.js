import { Rng } from './rng.js';
import { EventBus } from './events.js';
import { Input } from './input.js';

export const FIXED_DT = 1 / 120;
const MAX_SUBSTEPS = 6;
const MAX_FRAME_DT = 0.25;

/**
 * The engine context. Systems resolve each other through ctx.get(key) at runtime;
 * direct cross-directory imports are a contract violation (see ARCHITECTURE.md).
 */
export class Engine {
  constructor(opts = {}) {
    this.canvas = opts.canvas;
    this.seed = opts.seed || 'NYC-1';
    this.rng = new Rng(this.seed);
    this.events = new EventBus();
    this.input = new Input(this);
    this.quality = opts.quality || 'high';

    this._systems = new Map();
    this._order = [];
    this._acc = 0;
    this._raf = 0;
    this._last = 0;

    this.tick = 0;
    this.elapsed = 0;
    this.frame = 0;
    this.dt = 0;
    this.timeScale = 1;
    this.paused = false;
    this.started = false;

    // Deterministic capture mode: fixed dt, driven manually.
    this.deterministic = !!opts.deterministic;
    this.captureDt = opts.captureDt || 1 / 60;

    this.stats = { fps: 0, drawCalls: 0, triangles: 0, programs: 0, ms: 0 };
    this._fpsAcc = 0;
    this._fpsCount = 0;
  }

  register(key, system) {
    if (this._systems.has(key)) throw new Error(`Engine: system "${key}" already registered`);
    this._systems.set(key, system);
    this._order.push({ key, system });
    system.key = key;
    return system;
  }

  get(key) {
    const s = this._systems.get(key);
    if (!s) throw new Error(`Engine: system "${key}" is not registered (ordering violation?)`);
    return s;
  }

  has(key) { return this._systems.has(key); }

  async init(onProgress) {
    const total = this._order.length;
    for (let i = 0; i < total; i++) {
      const { key, system } = this._order[i];
      if (onProgress) onProgress(key, i / total);
      if (system.init) await system.init();
      // Yield so the loading UI can paint between heavy systems.
      await frameYield();
    }
    if (onProgress) onProgress('prewarm', 0.94);
    for (const { system } of this._order) {
      if (system.prewarm) await system.prewarm();
    }
    await frameYield();
    if (onProgress) onProgress('ready', 1);
  }

  start() {
    if (this.started) return;
    this.started = true;
    this._last = performance.now();
    if (!this.deterministic) {
      const loop = (now) => {
        this._raf = requestAnimationFrame(loop);
        let dt = (now - this._last) / 1000;
        this._last = now;
        if (dt > MAX_FRAME_DT) dt = MAX_FRAME_DT;
        this.step(dt);
      };
      this._raf = requestAnimationFrame(loop);
    }
  }

  /** One presented frame. Called by rAF, or manually by the capture harness. */
  step(dt) {
    const t0 = performance.now();
    if (this.paused) dt = 0;
    dt *= this.timeScale;
    this.dt = dt;

    this._acc += dt;
    let substeps = 0;
    while (this._acc >= FIXED_DT && substeps < MAX_SUBSTEPS) {
      this._acc -= FIXED_DT;
      substeps++;
      this.tick++;
      for (let i = 0; i < this._order.length; i++) {
        const s = this._order[i].system;
        if (s.fixedUpdate) s.fixedUpdate(FIXED_DT, this.tick);
      }
    }
    if (substeps === MAX_SUBSTEPS) this._acc = 0; // spiral-of-death guard

    this.elapsed += dt;
    this.frame++;
    this.alpha = this._acc / FIXED_DT;

    for (let i = 0; i < this._order.length; i++) {
      const s = this._order[i].system;
      if (s.update) s.update(dt, this.elapsed);
    }

    const render = this._systems.get('render');
    if (render && render.render) render.render(dt);

    this.input.endFrame();

    const ms = performance.now() - t0;
    this.stats.ms = ms;
    this._fpsAcc += dt;
    this._fpsCount++;
    if (this._fpsAcc >= 0.5) {
      this.stats.fps = this._fpsCount / this._fpsAcc;
      this._fpsAcc = 0;
      this._fpsCount = 0;
    }
  }

  /** Advance N frames at a fixed dt. Used by the deterministic capture harness. */
  advance(frames, dt = this.captureDt) {
    for (let i = 0; i < frames; i++) this.step(dt);
  }

  stop() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
    this.started = false;
  }

  dispose() {
    this.stop();
    for (let i = this._order.length - 1; i >= 0; i--) {
      const s = this._order[i].system;
      if (s.dispose) s.dispose();
    }
    this._systems.clear();
    this._order.length = 0;
    this.input.dispose();
  }
}

export function frameYield() {
  return new Promise((r) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => r());
    else setTimeout(r, 0);
  });
}
