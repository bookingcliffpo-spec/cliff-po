import * as THREE from 'three';
import { clamp, clamp01, damp, lerp, smoothstep, wrapAngle, TAU } from '../core/math.js';
import { v3 } from '../core/scratch.js';

const STANCE = {
  stand: { height: 1.78, eye: 1.66, speed: 4.35, accel: 62 },
  crouch: { height: 1.16, eye: 1.06, speed: 2.05, accel: 46 },
  prone: { height: 0.62, eye: 0.5, speed: 0.9, accel: 22 },
};

const RADIUS = 0.34;

export class PlayerSystem {
  constructor(ctx) {
    this.ctx = ctx;
    this.input = ctx.input;

    this.pos = new THREE.Vector3();      // feet
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.stance = 'stand';
    this.height = STANCE.stand.height;
    this.eyeHeight = STANCE.stand.eye;

    this.onGround = false;
    this.groundSurface = 'asphalt';
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.sprinting = false;
    this.ads = false;
    this.adsAmount = 0;
    this.lean = 0;
    this.leanTarget = 0;
    this.slideTime = 0;
    this.mantling = null;

    this.health = 100;
    this.maxHealth = 100;
    this.regenDelay = 0;
    this.lastDamageDir = new THREE.Vector3();
    this.dead = false;

    this.bobPhase = 0;
    this.bobAmp = 0;
    this.stepDistance = 0;
    this.landImpulse = 0;
    this.recoilKick = new THREE.Vector2();
    this.viewRoll = 0;
    this.breath = 0;
    this.stamina = 1;

    this._look = new THREE.Vector2();
    this._contact = { ground: false, ceiling: false, wall: false, surface: 'concrete', groundNormalY: 1 };
    this._prevY = 0;
    this._camOffset = new THREE.Vector3();
    this.footstepEvents = 0;
  }

  init() {
    this.render = this.ctx.get('render');
    this.phys = this.ctx.get('physics');
    const world = this.ctx.get('world');
    const s = world.spawn;
    this.pos.set(s.x, world.groundAt(s.x, s.z) + 0.05, s.z);
    this.yaw = s.yaw;
    this.pitch = -0.02;
    this._prevY = this.pos.y;
    this.applyToCamera(0);
  }

  get eyePos() {
    return v3[0].set(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z);
  }

  get forward() {
    return v3[1].set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
  }

  fixedUpdate(dt) {
    if (this.dead) { this._deathUpdate(dt); return; }
    const inp = this.input;

    // ---------------- look ----------------
    inp.look(this._look);
    const adsScale = lerp(1, 0.55, this.adsAmount);
    this.yaw = wrapAngle(this.yaw + this._look.x * adsScale);
    this.pitch = clamp(this.pitch + this._look.y * adsScale, -1.45, 1.45);
    // recoil recovery is applied to the view, then bled back into aim
    this.recoilKick.x = damp(this.recoilKick.x, 0, 9, dt);
    this.recoilKick.y = damp(this.recoilKick.y, 0, 9, dt);

    // ---------------- stance ----------------
    const wantCrouch = inp.down('crouch');
    const canStand = this.phys.capsuleFree(this.pos.x, this.pos.y + 0.02, this.pos.z, RADIUS * 0.92, STANCE.stand.height);
    const targetStance = wantCrouch || !canStand ? 'crouch' : 'stand';

    const speedNow = Math.hypot(this.vel.x, this.vel.z);
    // slide: crouch while sprinting with speed
    if (targetStance === 'crouch' && this.stance === 'stand' && this.sprinting && speedNow > 4.0 && this.onGround && this.slideTime <= 0) {
      this.slideTime = 0.62;
      this.ctx.events.emit('player:slide');
    }
    this.stance = targetStance;
    const st = STANCE[this.stance];
    this.height = damp(this.height, st.height, 16, dt);
    this.eyeHeight = damp(this.eyeHeight, this.slideTime > 0 ? st.eye - 0.1 : st.eye, 14, dt);

    // ---------------- movement input ----------------
    let ix = 0, iz = 0;
    if (inp.down('forward')) iz -= 1;
    if (inp.down('back')) iz += 1;
    if (inp.down('left')) ix -= 1;
    if (inp.down('right')) ix += 1;
    const mag = Math.hypot(ix, iz);
    if (mag > 0) { ix /= mag; iz /= mag; }

    this.ads = inp.ads && !this.sprinting;
    const wantSprint = inp.down('sprint') && iz < -0.2 && this.stance === 'stand' && this.stamina > 0.02 && !inp.ads;
    this.sprinting = wantSprint && this.onGround;
    this.stamina = clamp01(this.stamina + (this.sprinting ? -dt * 0.14 : dt * 0.28));

    this.adsAmount = damp(this.adsAmount, this.ads ? 1 : 0, 16, dt);

    // world-space wish direction
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    let wx = ix * cy - iz * sy;
    let wz = -ix * sy - iz * cy;

    let maxSpeed = st.speed;
    if (this.sprinting) maxSpeed *= 1.62;
    if (this.ads) maxSpeed *= 0.55;
    if (this.slideTime > 0) maxSpeed = 7.2;
    if (mag === 0 && this.slideTime <= 0) maxSpeed = 0;

    const accel = this.onGround ? st.accel * (this.slideTime > 0 ? 0.15 : 1) : 12;
    const targetVx = wx * maxSpeed;
    const targetVz = wz * maxSpeed;

    if (this.slideTime > 0) {
      this.slideTime -= dt;
      // slides carry momentum and bleed it off
      this.vel.x = damp(this.vel.x, targetVx * 0.4, 2.2, dt);
      this.vel.z = damp(this.vel.z, targetVz * 0.4, 2.2, dt);
    } else {
      this.vel.x += clamp(targetVx - this.vel.x, -accel * dt, accel * dt);
      this.vel.z += clamp(targetVz - this.vel.z, -accel * dt, accel * dt);
      if (this.onGround && mag === 0) {
        const f = 1 - Math.min(1, dt * 11);
        this.vel.x *= f; this.vel.z *= f;
      }
    }

    // ---------------- jump / gravity ----------------
    if (inp.justPressed('jump')) this.jumpBuffer = 0.16;
    this.jumpBuffer -= dt;
    this.coyote = this.onGround ? 0.12 : this.coyote - dt;

    if (this.jumpBuffer > 0 && this.coyote > 0 && !this.mantling) {
      this.vel.y = 6.35;
      this.onGround = false;
      this.coyote = 0;
      this.jumpBuffer = 0;
      this.slideTime = 0;
      this.ctx.events.emit('player:jump');
    }

    if (this.mantling) {
      this._mantleUpdate(dt);
    } else {
      this.vel.y += this.phys.gravity * dt;
      if (this.vel.y < -34) this.vel.y = -34;

      this.pos.x += this.vel.x * dt;
      this.pos.y += this.vel.y * dt;
      this.pos.z += this.vel.z * dt;

      const before = this.vel.y;
      this.phys.resolveCapsule(this.pos, RADIUS, Math.max(this.height, 0.6), this._contact);

      if (this._contact.ground) {
        if (!this.onGround && before < -4.2) {
          this.landImpulse = clamp01(-before / 18);
          this.ctx.events.emit('player:land', { force: this.landImpulse, surface: this._contact.surface });
          if (before < -17) this.damage(clamp01((-before - 17) / 14) * 45, null);
        }
        this.onGround = true;
        this.vel.y = Math.max(0, this.vel.y);
        this.groundSurface = this._contact.surface;
      } else {
        this.onGround = false;
      }
      if (this._contact.ceiling && this.vel.y > 0) this.vel.y = 0;

      // ---- mantle: a wall in front, a ledge within reach, forward pressed ----
      if (!this.onGround && this.vel.y < 1.5 && iz < -0.3 && this._contact.wall) {
        this._tryMantle();
      } else if (this.onGround && iz < -0.3 && inp.justPressed('jump')) {
        this._tryMantle();
      }
    }

    // ---------------- lean ----------------
    const lq = this.input.down('leanLeft') ? 1 : 0;
    const lr = (this.input.down('leanRight') && this.input.down('sprint')) ? -1 : 0;
    this.leanTarget = lq + lr;
    if (this.sprinting) this.leanTarget = 0;
    // block the lean if there is a wall on that side
    if (this.leanTarget !== 0) {
      const lx = Math.cos(this.yaw) * this.leanTarget;
      const lz = -Math.sin(this.yaw) * this.leanTarget;
      if (!this.phys.capsuleFree(this.pos.x + lx * 0.6, this.pos.y + 0.1, this.pos.z + lz * 0.6, RADIUS * 0.7, this.height * 0.8)) {
        this.leanTarget = 0;
      }
    }
    this.lean = damp(this.lean, this.leanTarget, 11, dt);

    // ---------------- bob / footsteps ----------------
    const planar = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround) {
      this.stepDistance += planar * dt;
      const stride = this.sprinting ? 2.1 : this.stance === 'crouch' ? 1.35 : 1.72;
      if (this.stepDistance > stride) {
        this.stepDistance -= stride;
        this.footstepEvents++;
        this.ctx.events.emit('player:footstep', { surface: this.groundSurface, speed: planar });
      }
    }
    this.bobAmp = damp(this.bobAmp, this.onGround ? clamp01(planar / 5) * (this.ads ? 0.28 : 1) : 0, 8, dt);
    this.bobPhase += planar * dt * (this.sprinting ? 4.6 : 5.4);
    this.landImpulse = damp(this.landImpulse, 0, 7, dt);
    this.breath += dt;

    // ---------------- health ----------------
    this.regenDelay -= dt;
    if (this.regenDelay <= 0 && this.health < this.maxHealth) {
      this.health = Math.min(this.maxHealth, this.health + dt * 22);
    }
    if (this.health <= 0 && !this.dead) this._die();

    // Keep the player inside the world if anything goes badly wrong.
    if (this.pos.y < -12) {
      const w = this.ctx.get('world');
      this.pos.set(w.spawn.x, w.groundAt(w.spawn.x, w.spawn.z) + 0.2, w.spawn.z);
      this.vel.set(0, 0, 0);
    }
  }

  _tryMantle() {
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    // find a ledge between knee and chest height
    for (const probeY of [1.35, 1.05, 0.75, 1.65]) {
      const ox = this.pos.x + fx * 0.55;
      const oz = this.pos.z + fz * 0.55;
      const down = this.phys.raycast(ox, this.pos.y + probeY + 0.4, oz, 0, -1, 0, 0.55, 1);
      if (!down.hit || down.normal.y < 0.7) continue;
      const ledgeY = down.point.y;
      const rise = ledgeY - this.pos.y;
      if (rise < 0.35 || rise > 1.75) continue;
      if (!this.phys.capsuleFree(ox, ledgeY + 0.05, oz, RADIUS * 0.9, 1.2)) continue;
      this.mantling = {
        t: 0,
        dur: 0.34 + rise * 0.1,
        from: this.pos.clone(),
        to: new THREE.Vector3(ox + fx * 0.45, ledgeY + 0.02, oz + fz * 0.45),
      };
      this.vel.set(0, 0, 0);
      this.ctx.events.emit('player:mantle');
      return true;
    }
    return false;
  }

  _mantleUpdate(dt) {
    const m = this.mantling;
    m.t += dt;
    const t = clamp01(m.t / m.dur);
    // up first, then forward — reads as a real pull-up rather than a lerp
    const up = smoothstep(0, 0.62, t);
    const fwd = smoothstep(0.38, 1, t);
    this.pos.x = lerp(m.from.x, m.to.x, fwd);
    this.pos.z = lerp(m.from.z, m.to.z, fwd);
    this.pos.y = lerp(m.from.y, m.to.y, up);
    if (t >= 1) {
      this.mantling = null;
      this.onGround = true;
    }
  }

  /* ------------------------------ camera ------------------------------- */

  update(dt) {
    this.applyToCamera(dt);
  }

  applyToCamera(dt) {
    const cam = this.render.camera;
    const bobX = Math.sin(this.bobPhase) * 0.035 * this.bobAmp;
    const bobY = -Math.abs(Math.cos(this.bobPhase)) * 0.028 * this.bobAmp;
    const sway = Math.sin(this.bobPhase * 0.5) * 0.012 * this.bobAmp;
    // idle breathing, suppressed while aiming
    const br = (1 - this.adsAmount * 0.8);
    const breathY = Math.sin(this.breath * 1.7) * 0.0055 * br;
    const breathX = Math.sin(this.breath * 1.1 + 1.2) * 0.004 * br;

    const leanOffX = Math.cos(this.yaw) * this.lean * 0.42;
    const leanOffZ = -Math.sin(this.yaw) * this.lean * 0.42;

    cam.position.set(
      this.pos.x + bobX + leanOffX + breathX,
      this.pos.y + this.eyeHeight + bobY - this.landImpulse * 0.34 + breathY,
      this.pos.z + sway + leanOffZ,
    );
    cam.rotation.set(
      this.pitch + this.recoilKick.y,
      this.yaw + this.recoilKick.x,
      -this.lean * 0.22 + Math.sin(this.bobPhase * 0.5) * 0.012 * this.bobAmp + this.viewRoll,
      'YXZ',
    );

    // FOV: sprint widens, ADS narrows.
    const r = this.render;
    const sprintFov = this.sprinting ? 6 : 0;
    r.fovTarget = r.baseFov + sprintFov - this.adsAmount * 18;
    r.viewFovTarget = r.viewBaseFov - this.adsAmount * 12;
    this.viewRoll = damp(this.viewRoll, 0, 8, dt || 1 / 60);
  }

  /* ------------------------------ combat ------------------------------- */

  addRecoil(pitchKick, yawKick) {
    this.recoilKick.y += pitchKick;
    this.recoilKick.x += yawKick;
    // permanent aim climb — a fraction of the kick is not recovered
    this.pitch = clamp(this.pitch + pitchKick * 0.32, -1.45, 1.45);
    this.yaw += yawKick * 0.32;
  }

  damage(amount, fromPos) {
    if (this.dead) return;
    this.health -= amount;
    this.regenDelay = 4.2;
    if (fromPos) {
      this.lastDamageDir.set(fromPos.x - this.pos.x, 0, fromPos.z - this.pos.z).normalize();
    }
    this.viewRoll += (this.ctx.rng.next() - 0.5) * 0.06;
    this.ctx.events.emit('player:damage', { amount, health: this.health, dir: this.lastDamageDir });
    if (this.health <= 0) this._die();
  }

  _die() {
    this.dead = true;
    this.deathT = 0;
    this.ctx.events.emit('player:death');
  }

  _deathUpdate(dt) {
    this.deathT += dt;
    this.eyeHeight = damp(this.eyeHeight, 0.28, 3, dt);
    this.viewRoll = damp(this.viewRoll, 0.9, 2, dt);
    this.vel.x *= 0.9; this.vel.z *= 0.9;
    if (this.deathT > 3.2) this.respawn();
  }

  respawn() {
    const w = this.ctx.get('world');
    this.dead = false;
    this.health = this.maxHealth;
    this.pos.set(w.spawn.x, w.groundAt(w.spawn.x, w.spawn.z) + 0.05, w.spawn.z);
    this.yaw = w.spawn.yaw; this.pitch = 0;
    this.vel.set(0, 0, 0);
    this.viewRoll = 0;
    this.eyeHeight = STANCE.stand.eye;
    this.ctx.events.emit('player:respawn');
  }

  dispose() { }
}
