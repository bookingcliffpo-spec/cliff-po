import * as THREE from 'three';
import { buildCarbine, buildShellPool } from './weapon-model.js';
import { clamp, clamp01, damp, lerp, smoothstep, TAU } from '../core/math.js';
import { v3, quat } from '../core/scratch.js';

const SPEC = {
  name: 'MK-4 CARBINE',
  rpm: 720,
  magSize: 30,
  reserve: 210,
  damage: 26,
  headMultiplier: 2.6,
  range: 180,
  falloffStart: 45,
  falloffEnd: 140,
  falloffMin: 0.55,
  reloadTime: 2.05,
  reloadEmptyTime: 2.75,
  adsTime: 0.19,
  spreadHip: 0.032,
  spreadAds: 0.0028,
  spreadMove: 0.03,
  spreadJump: 0.06,
  recoilPitch: 0.0125,
  recoilYaw: 0.0042,
  recoilKickBack: 0.022,
  muzzleVelocity: 880,
};

// Rest / aim poses in view space, relative to the camera.
const HIP_POS = new THREE.Vector3(0.108, -0.098, -0.235);
const HIP_ROT = new THREE.Euler(0.03, 0.10, 0.045, 'YXZ');
const ADS_POS = new THREE.Vector3(0, -0.0345, -0.145);
const ADS_ROT = new THREE.Euler(0, 0, 0, 'YXZ');
const SPRINT_POS = new THREE.Vector3(0.135, -0.148, -0.20);
const SPRINT_ROT = new THREE.Euler(-0.22, 0.68, 0.30, 'YXZ');

export class WeaponSystem {
  constructor(ctx) {
    this.ctx = ctx;
    this.spec = SPEC;
    this.ammo = SPEC.magSize;
    this.reserve = SPEC.reserve;
    this.chambered = true;
    this.fireTimer = 0;
    this.reloading = 0;
    this.reloadTotal = 0;
    this.reloadStage = '';
    this.firing = false;
    this.shotsFired = 0;
    this.recoilIndex = 0;
    this.lastFireTime = -10;
    this.inspecting = 0;

    this.pos = HIP_POS.clone();
    this.rot = new THREE.Euler().copy(HIP_ROT);
    this.velOffset = new THREE.Vector3();
    this.swayOffset = new THREE.Vector3();
    this.swayRot = new THREE.Vector2();
    this.kick = 0;
    this.kickRot = 0;
    this.bobT = 0;

    this.shells = [];
    this._shellCursor = 0;
    this._m4 = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._v = new THREE.Vector3();
    this._muzzleWorld = new THREE.Vector3();
    this._dir = new THREE.Vector3();
  }

  init() {
    this.render = this.ctx.get('render');
    this.player = this.ctx.get('player');
    this.phys = this.ctx.get('physics');
    this.materials = this.ctx.get('materials');
    this.rng = this.ctx.rng.stream('weapons');

    this.model = buildCarbine(this.materials);
    this.model.root.position.copy(HIP_POS);
    this.model.root.rotation.copy(HIP_ROT);
    this.render.viewScene.add(this.model.root);

    // Ambient fill for the view model so it never goes to silhouette even when
    // the player is standing in shadow.
    const key = new THREE.DirectionalLight(0xfff0dd, 1.35);
    key.position.set(0.6, 1.0, 0.45);
    this.render.viewScene.add(key);
    const rim = new THREE.DirectionalLight(0x92a8c4, 0.75);
    rim.position.set(-0.7, 0.35, -0.8);
    this.render.viewScene.add(rim);
    this.render.viewScene.add(new THREE.AmbientLight(0x60697a, 0.75));

    this.shellMesh = buildShellPool(this.materials, 24);
    this.render.scene.add(this.shellMesh);
    for (let i = 0; i < 24; i++) {
      this.shells.push({ alive: false, p: new THREE.Vector3(), v: new THREE.Vector3(), rot: new THREE.Euler(), spin: new THREE.Vector3(), t: 0 });
    }
    this._hideAllShells();

    this.fx = this.ctx.get('fx');
    this.audio = this.ctx.has('audio') ? this.ctx.get('audio') : null;
  }

  prewarm() {
    this.model.flash.visible = true;
    this.render.renderer.compile(this.render.viewScene, this.render.viewCamera);
    this.model.flash.visible = false;
  }

  get fireInterval() { return 60 / this.spec.rpm; }
  get isReloading() { return this.reloading > 0; }

  /* ------------------------------- input -------------------------------- */

  fixedUpdate(dt) {
    const p = this.player;
    const inp = this.ctx.input;
    if (p.dead) { this.firing = false; return; }

    this.fireTimer -= dt;

    if (this.reloading > 0) {
      this.reloading -= dt;
      const t = 1 - this.reloading / this.reloadTotal;
      const prevStage = this.reloadStage;
      this.reloadStage = t < 0.28 ? 'drop' : t < 0.62 ? 'insert' : t < 0.85 ? 'seat' : 'charge';
      if (prevStage !== this.reloadStage) {
        this.ctx.events.emit('weapon:reloadStage', this.reloadStage);
      }
      if (this.reloading <= 0) this._finishReload();
    }

    if (inp.justPressed('reload')) this.beginReload();
    if (inp.justPressed('inspect') && !this.isReloading) this.inspecting = 1.6;
    if (this.inspecting > 0) this.inspecting -= dt;

    const canFire = !this.isReloading && !p.sprinting && this.ammo > 0 && !p.mantling;
    this.firing = inp.fire && canFire;

    if (inp.fire && this.ammo <= 0 && !this.isReloading && this.fireTimer <= 0) {
      this.fireTimer = 0.25;
      this.ctx.events.emit('weapon:dryfire');
      this.beginReload();
    }

    while (this.firing && this.fireTimer <= 0) {
      this._fire();
      this.fireTimer += this.fireInterval;
    }
    if (!this.firing && this.fireTimer < 0) this.fireTimer = 0;

    // recoil pattern decays back to the start when you stop shooting
    if (this.ctx.elapsed - this.lastFireTime > 0.35) {
      this.recoilIndex = damp(this.recoilIndex, 0, 6, dt);
    }

    this._updateShells(dt);
  }

  beginReload() {
    if (this.isReloading || this.ammo >= this.spec.magSize || this.reserve <= 0) return;
    const empty = this.ammo === 0;
    this.reloadTotal = empty ? this.spec.reloadEmptyTime : this.spec.reloadTime;
    this.reloading = this.reloadTotal;
    this.reloadStage = 'drop';
    this.ctx.events.emit('weapon:reload', { empty });
  }

  _finishReload() {
    const want = this.spec.magSize - this.ammo;
    const take = Math.min(want, this.reserve);
    this.ammo += take;
    this.reserve -= take;
    this.reloading = 0;
    this.reloadStage = '';
    this.ctx.events.emit('weapon:reloadDone');
  }

  /* -------------------------------- firing ------------------------------ */

  currentSpread() {
    const p = this.player;
    const base = lerp(this.spec.spreadHip, this.spec.spreadAds, p.adsAmount);
    const moving = Math.hypot(p.vel.x, p.vel.z) / 5;
    let s = base + moving * this.spec.spreadMove * (1 - p.adsAmount * 0.75);
    if (!p.onGround) s += this.spec.spreadJump;
    if (p.stance === 'crouch') s *= 0.72;
    s += this.recoilIndex * 0.0022 * (1 - p.adsAmount * 0.6);
    return s;
  }

  _fire() {
    const p = this.player;
    const rng = this.rng;
    this.ammo--;
    this.shotsFired++;
    this.recoilIndex = Math.min(this.recoilIndex + 1, 22);
    this.lastFireTime = this.ctx.elapsed;

    // --- muzzle position in world space ---
    this.model.root.updateWorldMatrix(true, false);
    this._muzzleWorld.set(0, 0.018, -0.49).applyMatrix4(this.model.root.matrixWorld);
    const vc = this.render.viewCamera;
    // convert from view-camera space to world
    this._muzzleWorld.applyMatrix4(vc.matrixWorld);

    // --- direction: camera forward + spread ---
    const cam = this.render.camera;
    this._dir.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const spread = this.currentSpread();
    const a = rng.next() * TAU;
    const r = Math.sqrt(rng.next()) * spread;
    const right = v3[2].set(1, 0, 0).applyQuaternion(cam.quaternion);
    const up = v3[3].set(0, 1, 0).applyQuaternion(cam.quaternion);
    this._dir.addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();

    // --- hitscan from the eye, not the muzzle (standard FPS convention) ---
    const eye = p.eyePos;
    const ai = this.ctx.get('ai');
    const world = this.phys.raycast(eye.x, eye.y, eye.z, this._dir.x, this._dir.y, this._dir.z, this.spec.range, 2);
    const enemy = ai.raycastEnemies(eye, this._dir, world.hit ? world.distance : this.spec.range);

    let hitPoint = null;
    if (enemy) {
      const falloff = this._falloff(enemy.distance);
      const dmg = this.spec.damage * falloff * (enemy.part === 'head' ? this.spec.headMultiplier : enemy.part === 'limb' ? 0.78 : 1);
      const killed = ai.damageEnemy(enemy.enemy, dmg, this._dir, enemy.part);
      this.ctx.events.emit('weapon:hitmarker', { headshot: enemy.part === 'head', killed });
      this.fx.bloodImpact(enemy.point, this._dir);
      hitPoint = enemy.point;
    } else if (world.hit) {
      this.fx.surfaceImpact(world.point, world.normal, world.surface, this._dir);
      hitPoint = world.point;
    } else {
      hitPoint = v3[4].copy(eye).addScaledVector(this._dir, this.spec.range);
    }

    this.fx.tracer(this._muzzleWorld, hitPoint, this.spec.muzzleVelocity);
    this.fx.muzzleSmoke(this._muzzleWorld, this._dir);
    this._ejectShell();

    // --- felt recoil ---
    const pat = this._recoilPattern(this.recoilIndex);
    p.addRecoil(this.spec.recoilPitch * pat.pitch * (1 - p.adsAmount * 0.28),
      this.spec.recoilYaw * pat.yaw * (1 - p.adsAmount * 0.3));
    this.kick = Math.min(this.kick + this.spec.recoilKickBack, 0.055);
    this.kickRot += 0.055;

    this.model.flash.visible = true;
    this.model.flash.rotation.z = rng.next() * TAU;
    const fs = rng.range(0.75, 1.25);
    this.model.flash.scale.setScalar(fs * (1 - p.adsAmount * 0.25));
    this.model.flashLight.intensity = 26;
    this._flashTimer = 0.038;

    this.ctx.events.emit('weapon:fire', { ammo: this.ammo, adsAmount: p.adsAmount });
  }

  /** A shaped recoil pattern: vertical first, then a lazy horizontal drift. */
  _recoilPattern(i) {
    const t = i;
    const pitch = 1.25 - smoothstep(0, 9, t) * 0.45;
    const yaw = Math.sin(t * 0.72) * 0.85 + Math.sin(t * 0.31 + 1.4) * 0.55;
    return { pitch, yaw };
  }

  _falloff(d) {
    if (d <= this.spec.falloffStart) return 1;
    const t = clamp01((d - this.spec.falloffStart) / (this.spec.falloffEnd - this.spec.falloffStart));
    return lerp(1, this.spec.falloffMin, t);
  }

  /* -------------------------------- shells ------------------------------ */

  _ejectShell() {
    const s = this.shells[this._shellCursor];
    this._shellCursor = (this._shellCursor + 1) % this.shells.length;
    const rng = this.rng;
    const cam = this.render.camera;
    const right = v3[5].set(1, 0, 0).applyQuaternion(cam.quaternion);
    const up = v3[6].set(0, 1, 0).applyQuaternion(cam.quaternion);
    const fwd = v3[7].set(0, 0, -1).applyQuaternion(cam.quaternion);

    s.alive = true;
    s.t = 0;
    s.p.copy(this.player.eyePos)
      .addScaledVector(right, 0.20).addScaledVector(up, -0.06).addScaledVector(fwd, 0.12);
    s.v.copy(right).multiplyScalar(rng.range(2.0, 3.4))
      .addScaledVector(up, rng.range(1.2, 2.2))
      .addScaledVector(fwd, rng.range(-0.5, 0.4));
    s.v.x += this.player.vel.x; s.v.z += this.player.vel.z;
    s.spin.set(rng.range(-24, 24), rng.range(-24, 24), rng.range(-24, 24));
    s.rot.set(rng.next() * TAU, rng.next() * TAU, rng.next() * TAU);
  }

  _updateShells(dt) {
    let any = false;
    for (let i = 0; i < this.shells.length; i++) {
      const s = this.shells[i];
      if (!s.alive) continue;
      any = true;
      s.t += dt;
      s.v.y += this.phys.gravity * dt;
      s.p.addScaledVector(s.v, dt);
      s.rot.x += s.spin.x * dt; s.rot.y += s.spin.y * dt; s.rot.z += s.spin.z * dt;
      const ground = this.phys.groundAt(s.p.x, s.p.y + 0.3, s.p.z, 2.5);
      if (s.p.y <= ground) {
        s.p.y = ground;
        s.v.y = -s.v.y * 0.32;
        s.v.x *= 0.55; s.v.z *= 0.55;
        s.spin.multiplyScalar(0.4);
        if (Math.abs(s.v.y) < 0.4) { s.v.set(0, 0, 0); s.spin.set(0, 0, 0); }
        if (s.t < 1.6 && Math.abs(s.v.y) > 0.6) this.ctx.events.emit('weapon:shellBounce', { pos: s.p });
      }
      if (s.t > 7) s.alive = false;
      this._e.copy(s.rot);
      this._q.setFromEuler(this._e);
      this._m4.compose(s.p, this._q, this._v.set(1, 1, 1));
      this.shellMesh.setMatrixAt(i, this._m4);
    }
    if (any) this.shellMesh.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < this.shells.length; i++) {
      if (!this.shells[i].alive) {
        this._m4.makeScale(0, 0, 0);
        this.shellMesh.setMatrixAt(i, this._m4);
      }
    }
  }

  _hideAllShells() {
    const m = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.shells.length; i++) this.shellMesh.setMatrixAt(i, m);
    this.shellMesh.instanceMatrix.needsUpdate = true;
  }

  /* ------------------------------ view model ---------------------------- */

  update(dt) {
    const p = this.player;
    const m = this.model;

    if (this._flashTimer > 0) {
      this._flashTimer -= dt;
      if (this._flashTimer <= 0) { m.flash.visible = false; m.flashLight.intensity = 0; }
      else m.flashLight.intensity = 26 * (this._flashTimer / 0.038);
    }

    // --- pose blend: sprint > ads > hip ---
    const ads = p.adsAmount;
    const sprint = clamp01((p.sprinting ? 1 : 0));
    this._sprintBlend = damp(this._sprintBlend || 0, sprint, 11, dt);
    const sb = this._sprintBlend;

    const tp = this._v.set(0, 0, 0);
    tp.copy(HIP_POS).lerp(ADS_POS, ads).lerp(SPRINT_POS, sb);
    const trx = lerp(lerp(HIP_ROT.x, ADS_ROT.x, ads), SPRINT_ROT.x, sb);
    const try_ = lerp(lerp(HIP_ROT.y, ADS_ROT.y, ads), SPRINT_ROT.y, sb);
    const trz = lerp(lerp(HIP_ROT.z, ADS_ROT.z, ads), SPRINT_ROT.z, sb);

    // --- sway from look input (weapon lags the camera) ---
    const look = this.ctx.input.scripted ? { x: 0, y: 0 } : { x: -this.ctx.input.mouse.dx, y: -this.ctx.input.mouse.dy };
    const swayScale = (1 - ads * 0.78) * 0.00055;
    this.swayRot.x = damp(this.swayRot.x, clamp(look.x * swayScale * 60, -0.09, 0.09), 9, dt);
    this.swayRot.y = damp(this.swayRot.y, clamp(look.y * swayScale * 60, -0.07, 0.07), 9, dt);

    // --- movement lag ---
    const localVx = p.vel.x * Math.cos(p.yaw) - p.vel.z * Math.sin(p.yaw);
    const localVz = -p.vel.x * Math.sin(p.yaw) - p.vel.z * Math.cos(p.yaw);
    const lagScale = (1 - ads * 0.7) * 0.0075;
    this.velOffset.x = damp(this.velOffset.x, clamp(-localVx * lagScale, -0.03, 0.03), 8, dt);
    this.velOffset.y = damp(this.velOffset.y, clamp(-p.vel.y * lagScale * 0.9, -0.035, 0.035), 8, dt);
    this.velOffset.z = damp(this.velOffset.z, clamp(localVz * lagScale * 0.6, -0.02, 0.02), 8, dt);

    // --- bob ---
    this.bobT = p.bobPhase;
    const bobAmt = p.bobAmp * (1 - ads * 0.82);
    const bobX = Math.sin(this.bobT) * 0.0135 * bobAmt;
    const bobY = -Math.abs(Math.cos(this.bobT)) * 0.011 * bobAmt;
    // sprint gets a bigger, slower figure-of-eight
    const spX = Math.sin(this.bobT * 0.5) * 0.03 * sb;
    const spY = Math.abs(Math.sin(this.bobT * 1.0)) * 0.022 * sb;

    // --- idle breathing ---
    const br = (1 - ads * 0.55) * 0.0022;
    const brX = Math.sin(p.breath * 1.1) * br;
    const brY = Math.sin(p.breath * 1.6 + 0.7) * br;

    // --- recoil kick ---
    this.kick = damp(this.kick, 0, 13, dt);
    this.kickRot = damp(this.kickRot, 0, 12, dt);

    // --- reload animation ---
    let rlPos = v3[8].set(0, 0, 0);
    let rlRot = { x: 0, y: 0, z: 0 };
    if (this.isReloading) {
      const t = 1 - this.reloading / this.reloadTotal;
      const dip = Math.sin(clamp01(t) * Math.PI);
      rlPos.set(0.012 * dip, -0.075 * dip, 0.03 * dip);
      rlRot.x = -0.42 * dip;
      rlRot.z = 0.30 * dip;
      rlRot.y = 0.24 * dip;
      // magazine drops away and a fresh one comes up
      const mg = m.magazine;
      if (t < 0.3) {
        const k = t / 0.3;
        mg.position.y = -0.062 - k * 0.30;
        mg.rotation.x = k * 0.9;
        mg.visible = k < 0.95;
      } else if (t < 0.68) {
        const k = (t - 0.3) / 0.38;
        mg.visible = true;
        mg.position.y = -0.062 - (1 - k) * 0.26;
        mg.rotation.x = (1 - k) * 0.55;
      } else {
        mg.visible = true;
        mg.position.y = -0.062;
        mg.rotation.x = 0;
      }
      // charging handle yank at the end of an empty reload
      if (t > 0.86 && this.reloadTotal > this.spec.reloadTime) {
        const k = (t - 0.86) / 0.14;
        rlPos.z += Math.sin(k * Math.PI) * 0.02;
        rlRot.z += Math.sin(k * Math.PI) * 0.12;
      }
    } else {
      m.magazine.position.y = -0.062;
      m.magazine.rotation.x = 0;
      m.magazine.visible = true;
    }

    // --- inspect animation ---
    if (this.inspecting > 0) {
      const t = 1 - this.inspecting / 1.6;
      const s = Math.sin(t * Math.PI);
      rlPos.x += 0.03 * s; rlPos.y += -0.02 * s; rlPos.z += 0.05 * s;
      rlRot.y += 0.7 * s; rlRot.z += -0.35 * s; rlRot.x += 0.2 * s;
    }

    // --- landing dip ---
    const land = p.landImpulse;

    m.root.position.set(
      tp.x + this.velOffset.x + bobX + spX + brX + rlPos.x + this.swayRot.x * 0.09,
      tp.y + this.velOffset.y + bobY - spY + brY + rlPos.y - land * 0.05 - this.kick * 0.12,
      tp.z + this.velOffset.z + rlPos.z + this.kick,
    );
    m.root.rotation.set(
      trx + this.swayRot.y + rlRot.x - this.kickRot * 0.5 - land * 0.18,
      try_ + this.swayRot.x + rlRot.y,
      trz + rlRot.z + this.swayRot.x * 0.4,
      'YXZ',
    );

    // red dot only glows when you can actually see through the tube
    m.dot.material.emissiveIntensity = lerp(1.2, 6.5, ads);
  }

  dispose() {
    this.render.viewScene.remove(this.model.root);
  }
}
