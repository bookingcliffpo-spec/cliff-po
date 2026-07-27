const ACTIONS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  crouch: ['ControlLeft', 'KeyC'],
  reload: ['KeyR'],
  use: ['KeyF', 'KeyE'],
  leanLeft: ['KeyQ'],
  leanRight: ['KeyE'],
  melee: ['KeyV'],
  fireMode: ['KeyB'],
  inspect: ['KeyT'],
  next: ['Digit1', 'Digit2'],
};

export class Input {
  constructor(engine) {
    this.engine = engine;
    this.keys = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.mouse = { dx: 0, dy: 0, left: false, right: false, leftPressed: false, rightPressed: false, wheel: 0 };
    this.locked = false;
    this.sensitivity = 0.0022;
    this.invertY = false;
    this.enabled = true;
    // Deterministic scripted input for capture runs.
    this.scripted = null;

    this._onKeyDown = (e) => {
      if (!this.enabled) return;
      if (e.code === 'Tab' || (e.code === 'Space' && this.locked)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    };
    this._onKeyUp = (e) => {
      this.keys.delete(e.code);
      this.released.add(e.code);
    };
    this._onMouseMove = (e) => {
      if (!this.locked || !this.enabled) return;
      this.mouse.dx += e.movementX || 0;
      this.mouse.dy += e.movementY || 0;
    };
    this._onMouseDown = (e) => {
      if (!this.enabled) return;
      if (e.button === 0) { if (!this.mouse.left) this.mouse.leftPressed = true; this.mouse.left = true; }
      if (e.button === 2) { if (!this.mouse.right) this.mouse.rightPressed = true; this.mouse.right = true; }
    };
    this._onMouseUp = (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    };
    this._onWheel = (e) => { this.mouse.wheel += Math.sign(e.deltaY); };
    this._onContext = (e) => e.preventDefault();
    this._onLockChange = () => {
      this.locked = document.pointerLockElement === engine.canvas;
      engine.events.emit('pointerlock', this.locked);
    };
    this._onBlur = () => { this.keys.clear(); this.mouse.left = false; this.mouse.right = false; };

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this._onKeyDown);
      window.addEventListener('keyup', this._onKeyUp);
      window.addEventListener('mousemove', this._onMouseMove);
      window.addEventListener('mousedown', this._onMouseDown);
      window.addEventListener('mouseup', this._onMouseUp);
      window.addEventListener('wheel', this._onWheel, { passive: true });
      window.addEventListener('contextmenu', this._onContext);
      window.addEventListener('blur', this._onBlur);
      document.addEventListener('pointerlockchange', this._onLockChange);
    }
  }

  requestLock() {
    const c = this.engine.canvas;
    if (c && c.requestPointerLock) c.requestPointerLock();
  }

  down(action) {
    if (this.scripted) return !!this.scripted.actions[action];
    const codes = ACTIONS[action];
    if (!codes) return false;
    for (let i = 0; i < codes.length; i++) if (this.keys.has(codes[i])) return true;
    return false;
  }

  justPressed(action) {
    if (this.scripted) return !!this.scripted.justPressed[action];
    const codes = ACTIONS[action];
    if (!codes) return false;
    for (let i = 0; i < codes.length; i++) if (this.pressed.has(codes[i])) return true;
    return false;
  }

  /** Consumed look delta in radians (yaw, pitch). */
  look(out) {
    if (this.scripted) {
      out.x = this.scripted.look.x;
      out.y = this.scripted.look.y;
      return out;
    }
    out.x = -this.mouse.dx * this.sensitivity;
    out.y = (this.invertY ? 1 : -1) * this.mouse.dy * this.sensitivity;
    return out;
  }

  get fire() { return this.scripted ? this.scripted.fire : this.mouse.left; }
  get firePressed() { return this.scripted ? this.scripted.firePressed : this.mouse.leftPressed; }
  get ads() { return this.scripted ? this.scripted.ads : this.mouse.right; }

  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    this.mouse.wheel = 0;
    this.mouse.leftPressed = false;
    this.mouse.rightPressed = false;
    if (this.scripted) this.scripted.justPressed = {};
  }

  /** Install a deterministic input source: {actions,justPressed,look,fire,ads}. */
  setScripted(src) { this.scripted = src; }

  dispose() {
    if (typeof window === 'undefined') return;
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    window.removeEventListener('wheel', this._onWheel);
    window.removeEventListener('contextmenu', this._onContext);
    window.removeEventListener('blur', this._onBlur);
    document.removeEventListener('pointerlockchange', this._onLockChange);
  }
}

export { ACTIONS };
