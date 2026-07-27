import { clamp, clamp01, lerp, TAU } from '../core/math.js';

/**
 * Fully synthesized audio. No recordings, no sample packs — every sound is
 * built from oscillators, filtered noise and impulse-response convolution
 * generated at load time.
 */
export class AudioSystem {
  constructor(ctx) {
    this.ctx = ctx;
    this.rng = ctx.rng.stream('audio');
    this.enabled = false;
    this.masterVolume = 0.7;
    this._noiseBuf = null;
    this._irOutdoor = null;
    this._irIndoor = null;
    this._voices = 0;
    this._lastShot = 0;
  }

  init() {
    this.player = this.ctx.get('player');
    const ev = this.ctx.events;
    ev.on('weapon:fire', () => this.gunshot());
    ev.on('weapon:dryfire', () => this.dryFire());
    ev.on('weapon:reload', (d) => this.reload(d.empty));
    ev.on('weapon:reloadStage', (s) => this.reloadStage(s));
    ev.on('weapon:shellBounce', () => this.shellBounce());
    ev.on('fx:impact', (d) => this.impact(d.sound, d.point));
    ev.on('fx:explosion', (d) => this.explosion(d.pos, d.scale));
    ev.on('player:footstep', (d) => this.footstep(d.surface, d.speed));
    ev.on('player:jump', () => this.footstep('concrete', 2));
    ev.on('player:land', (d) => this.land(d.force, d.surface));
    ev.on('player:damage', () => this.hurt());
    ev.on('ai:fire', (d) => this.enemyShot(d.dist));
    ev.on('ai:nearMiss', (d) => this.crack(d.dist));
    ev.on('ai:kill', () => this.bodyFall());

    // The context can only start after a gesture; wire that up now.
    const start = () => this.resume();
    window.addEventListener('pointerdown', start, { once: true });
    window.addEventListener('keydown', start, { once: true });
  }

  resume() {
    if (this.ac) { if (this.ac.state === 'suspended') this.ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ac = new AC({ latencyHint: 'interactive' });
    this._build();
    this.enabled = true;
  }

  _build() {
    const ac = this.ac;
    this.master = ac.createGain();
    this.master.gain.value = this.masterVolume;

    // gentle limiter so a full-auto burst never clips
    this.limiter = ac.createDynamicsCompressor();
    this.limiter.threshold.value = -9;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 9;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.16;
    this.master.connect(this.limiter);
    this.limiter.connect(ac.destination);

    this.sfx = ac.createGain(); this.sfx.gain.value = 1; this.sfx.connect(this.master);
    this.amb = ac.createGain(); this.amb.gain.value = 0.5; this.amb.connect(this.master);

    // --- reverb sends ---
    this._irOutdoor = this._makeIR(2.6, 0.9, 'street');
    this._irIndoor = this._makeIR(1.1, 0.5, 'room');
    this.convOut = ac.createConvolver(); this.convOut.buffer = this._irOutdoor;
    this.convIn = ac.createConvolver(); this.convIn.buffer = this._irIndoor;
    this.sendOut = ac.createGain(); this.sendOut.gain.value = 0.42;
    this.sendIn = ac.createGain(); this.sendIn.gain.value = 0.0;
    this.sendOut.connect(this.convOut); this.convOut.connect(this.master);
    this.sendIn.connect(this.convIn); this.convIn.connect(this.master);

    this._noiseBuf = this._makeNoise(3);
    this._startAmbience();
  }

  _makeNoise(seconds) {
    const ac = this.ac;
    const n = Math.floor(ac.sampleRate * seconds);
    const buf = ac.createBuffer(1, n, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = this.rng.next() * 2 - 1;
    return buf;
  }

  /** Synthetic impulse response: noise burst with a shaped decay + early taps. */
  _makeIR(seconds, damping, kind) {
    const ac = this.ac;
    const n = Math.floor(ac.sampleRate * seconds);
    const buf = ac.createBuffer(2, n, ac.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const env = Math.pow(1 - t, kind === 'street' ? 2.1 : 3.4);
        let s = (this.rng.next() * 2 - 1) * env;
        // progressive low-pass models air + surface absorption
        lp += (s - lp) * (1 - damping * t * 0.85);
        d[i] = lp;
      }
      // discrete early reflections give the street its slap-back
      if (kind === 'street') {
        const taps = [0.021, 0.038, 0.061, 0.094, 0.147, 0.212];
        for (let k = 0; k < taps.length; k++) {
          const idx = Math.floor(taps[k] * ac.sampleRate) + (ch ? 37 : 0);
          if (idx < n) d[idx] += (0.7 - k * 0.1) * (ch ? -1 : 1);
        }
      }
    }
    return buf;
  }

  _noise(dur, gainVal, filterType, freq, q) {
    const ac = this.ac;
    const src = ac.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = true;
    src.playbackRate.value = 0.75 + this.rng.next() * 0.5;
    const f = ac.createBiquadFilter();
    f.type = filterType; f.frequency.value = freq; f.Q.value = q ?? 1;
    const g = ac.createGain();
    g.gain.value = gainVal;
    src.connect(f); f.connect(g);
    src.start(0, this.rng.next() * 2);
    src.stop(ac.currentTime + dur + 0.05);
    return { src, f, g };
  }

  _out(node, sendAmount = 1) {
    node.connect(this.sfx);
    if (this.sendOut) {
      const s = this.ac.createGain();
      s.gain.value = sendAmount;
      node.connect(s);
      s.connect(this.sendOut);
      s.connect(this.sendIn);
    }
  }

  /* ------------------------------ weapon -------------------------------- */

  gunshot() {
    if (!this.enabled) return;
    const ac = this.ac, t = ac.currentTime;

    // 1. supersonic crack — very short, very bright
    const crack = this._noise(0.05, 0, 'highpass', 2400, 0.7);
    crack.g.gain.setValueAtTime(0.0001, t);
    crack.g.gain.exponentialRampToValueAtTime(0.9, t + 0.0012);
    crack.g.gain.exponentialRampToValueAtTime(0.0008, t + 0.045);
    this._out(crack.g, 0.5);

    // 2. body — band-passed noise sweeping down, the "punch"
    const body = this._noise(0.3, 0, 'bandpass', 900, 1.1);
    body.f.frequency.setValueAtTime(1500, t);
    body.f.frequency.exponentialRampToValueAtTime(240, t + 0.16);
    body.g.gain.setValueAtTime(0.0001, t);
    body.g.gain.exponentialRampToValueAtTime(0.85, t + 0.004);
    body.g.gain.exponentialRampToValueAtTime(0.0008, t + 0.24);
    this._out(body.g, 1.0);

    // 3. low thump from the gas system
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(190, t);
    osc.frequency.exponentialRampToValueAtTime(48, t + 0.13);
    const og = ac.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.62, t + 0.005);
    og.gain.exponentialRampToValueAtTime(0.0008, t + 0.19);
    osc.connect(og);
    this._out(og, 0.7);
    osc.start(t); osc.stop(t + 0.22);

    // 4. mechanical clatter of the bolt cycling
    const mech = this._noise(0.09, 0, 'bandpass', 3400, 3);
    mech.g.gain.setValueAtTime(0.0001, t + 0.018);
    mech.g.gain.exponentialRampToValueAtTime(0.14, t + 0.026);
    mech.g.gain.exponentialRampToValueAtTime(0.0006, t + 0.085);
    this._out(mech.g, 0.25);

    this._lastShot = t;
  }

  enemyShot(dist) {
    if (!this.enabled) return;
    const ac = this.ac, t = ac.currentTime;
    const atten = clamp01(1 - dist / 140);
    const delay = clamp(dist / 343, 0, 0.5);
    const g = ac.createGain();
    g.gain.value = 0.34 * atten * atten;
    const n = this._noise(0.4, 0, 'bandpass', lerp(280, 1200, atten), 1.2);
    n.g.gain.setValueAtTime(0.0001, t + delay);
    n.g.gain.exponentialRampToValueAtTime(0.75, t + delay + 0.005);
    n.g.gain.exponentialRampToValueAtTime(0.0008, t + delay + lerp(0.55, 0.22, atten));
    n.g.connect(g);
    this._out(g, 1.1);
  }

  /** Ballistic crack of a round passing close by. */
  crack(missDist) {
    if (!this.enabled) return;
    const ac = this.ac, t = ac.currentTime;
    const near = clamp01(1 - missDist / 3.2);
    const n = this._noise(0.08, 0, 'highpass', 1800, 0.8);
    n.g.gain.setValueAtTime(0.0001, t);
    n.g.gain.exponentialRampToValueAtTime(0.35 + near * 0.55, t + 0.0015);
    n.g.gain.exponentialRampToValueAtTime(0.0006, t + 0.06);
    this._out(n.g, 0.6);
  }

  dryFire() {
    if (!this.enabled) return;
    const t = this.ac.currentTime;
    const n = this._noise(0.06, 0, 'bandpass', 2600, 5);
    n.g.gain.setValueAtTime(0.0001, t);
    n.g.gain.exponentialRampToValueAtTime(0.22, t + 0.003);
    n.g.gain.exponentialRampToValueAtTime(0.0006, t + 0.05);
    this._out(n.g, 0.3);
  }

  reload() { /* stages carry the sound */ }

  reloadStage(stage) {
    if (!this.enabled) return;
    const t = this.ac.currentTime;
    const cfg = {
      drop: { f: 420, q: 2.2, g: 0.26, d: 0.14 },
      insert: { f: 900, q: 3.0, g: 0.3, d: 0.1 },
      seat: { f: 1700, q: 4.0, g: 0.34, d: 0.08 },
      charge: { f: 2600, q: 3.4, g: 0.4, d: 0.13 },
    }[stage];
    if (!cfg) return;
    const n = this._noise(cfg.d + 0.05, 0, 'bandpass', cfg.f, cfg.q);
    n.g.gain.setValueAtTime(0.0001, t);
    n.g.gain.exponentialRampToValueAtTime(cfg.g, t + 0.004);
    n.g.gain.exponentialRampToValueAtTime(0.0006, t + cfg.d);
    this._out(n.g, 0.35);
    if (stage === 'charge') {
      const o = this.ac.createOscillator();
      o.type = 'square';
      o.frequency.setValueAtTime(160, t);
      o.frequency.exponentialRampToValueAtTime(70, t + 0.09);
      const g = this.ac.createGain();
      g.gain.setValueAtTime(0.12, t);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 0.1);
      o.connect(g); this._out(g, 0.3);
      o.start(t); o.stop(t + 0.12);
    }
  }

  shellBounce() {
    if (!this.enabled) return;
    const ac = this.ac, t = ac.currentTime;
    const o = ac.createOscillator();
    o.type = 'triangle';
    o.frequency.value = 2200 + this.rng.next() * 2600;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.055, t);
    g.gain.exponentialRampToValueAtTime(0.0004, t + 0.16);
    o.connect(g);
    this._out(g, 0.5);
    o.start(t); o.stop(t + 0.18);
  }

  /* ------------------------------ impacts ------------------------------- */

  impact(kind, point) {
    if (!this.enabled) return;
    const ac = this.ac, t = ac.currentTime;
    const cfg = {
      concrete: { f: 700, q: 1.2, g: 0.2, d: 0.14, hp: false },
      metal: { f: 3200, q: 8, g: 0.24, d: 0.35, ring: true },
      wood: { f: 950, q: 2.4, g: 0.2, d: 0.12 },
      glass: { f: 4200, q: 2.0, g: 0.24, d: 0.4, shards: true },
      flesh: { f: 380, q: 1.4, g: 0.26, d: 0.1 },
    }[kind] || { f: 700, q: 1.2, g: 0.18, d: 0.13 };

    const n = this._noise(cfg.d + 0.08, 0, 'bandpass', cfg.f, cfg.q);
    n.g.gain.setValueAtTime(0.0001, t);
    n.g.gain.exponentialRampToValueAtTime(cfg.g, t + 0.003);
    n.g.gain.exponentialRampToValueAtTime(0.0005, t + cfg.d);
    this._out(n.g, 0.55);

    if (cfg.ring) {
      const o = ac.createOscillator();
      o.type = 'triangle';
      o.frequency.value = 1400 + this.rng.next() * 2200;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.09, t);
      g.gain.exponentialRampToValueAtTime(0.0004, t + 0.32);
      o.connect(g); this._out(g, 0.7);
      o.start(t); o.stop(t + 0.34);
    }
    if (cfg.shards) {
      for (let i = 0; i < 5; i++) {
        const d = this.rng.range(0.02, 0.3);
        const o = ac.createOscillator();
        o.type = 'triangle';
        o.frequency.value = 3000 + this.rng.next() * 4500;
        const g = ac.createGain();
        g.gain.setValueAtTime(0.0001, t + d);
        g.gain.exponentialRampToValueAtTime(0.05, t + d + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0003, t + d + 0.16);
        o.connect(g); this._out(g, 0.6);
        o.start(t + d); o.stop(t + d + 0.18);
      }
    }
  }

  explosion(pos, scale = 1) {
    if (!this.enabled) return;
    const ac = this.ac, t = ac.currentTime;
    const n = this._noise(2.2, 0, 'lowpass', 480, 0.7);
    n.f.frequency.setValueAtTime(2200, t);
    n.f.frequency.exponentialRampToValueAtTime(90, t + 0.9);
    n.g.gain.setValueAtTime(0.0001, t);
    n.g.gain.exponentialRampToValueAtTime(1.0 * scale, t + 0.01);
    n.g.gain.exponentialRampToValueAtTime(0.0008, t + 1.9);
    this._out(n.g, 1.6);
    const o = ac.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(24, t + 0.7);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.8 * scale, t);
    g.gain.exponentialRampToValueAtTime(0.0006, t + 1.2);
    o.connect(g); this._out(g, 1);
    o.start(t); o.stop(t + 1.3);
  }

  /* ------------------------------ player -------------------------------- */

  footstep(surface, speed) {
    if (!this.enabled) return;
    const t = this.ac.currentTime;
    const cfg = {
      asphalt: { f: 620, q: 1.1, g: 0.10 },
      concrete: { f: 780, q: 1.3, g: 0.11 },
      metal: { f: 1900, q: 3.2, g: 0.12 },
      wood: { f: 520, q: 1.8, g: 0.10 },
      glass: { f: 3400, q: 2.2, g: 0.12 },
    }[surface] || { f: 700, q: 1.2, g: 0.10 };
    const vol = cfg.g * clamp(speed / 4, 0.35, 1.5);
    const n = this._noise(0.13, 0, 'bandpass', cfg.f * this.rng.range(0.85, 1.2), cfg.q);
    n.g.gain.setValueAtTime(0.0001, t);
    n.g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    n.g.gain.exponentialRampToValueAtTime(0.0004, t + 0.11);
    this._out(n.g, 0.3);
    // grit scuff
    const s = this._noise(0.1, 0, 'highpass', 4200, 0.8);
    s.g.gain.setValueAtTime(0.0001, t + 0.008);
    s.g.gain.exponentialRampToValueAtTime(vol * 0.5, t + 0.02);
    s.g.gain.exponentialRampToValueAtTime(0.0003, t + 0.09);
    this._out(s.g, 0.2);
  }

  land(force, surface) {
    if (!this.enabled) return;
    this.footstep(surface, 4 + force * 4);
    const ac = this.ac, t = ac.currentTime;
    const o = ac.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.16);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.18 * (0.4 + force), t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.2);
    o.connect(g); this._out(g, 0.4);
    o.start(t); o.stop(t + 0.22);
  }

  hurt() {
    if (!this.enabled) return;
    const t = this.ac.currentTime;
    const n = this._noise(0.5, 0, 'lowpass', 500, 0.9);
    n.g.gain.setValueAtTime(0.22, t);
    n.g.gain.exponentialRampToValueAtTime(0.0005, t + 0.45);
    this._out(n.g, 0.3);
  }

  bodyFall() {
    if (!this.enabled) return;
    const t = this.ac.currentTime;
    const n = this._noise(0.4, 0, 'lowpass', 260, 0.8);
    n.g.gain.setValueAtTime(0.0001, t + 0.35);
    n.g.gain.exponentialRampToValueAtTime(0.2, t + 0.37);
    n.g.gain.exponentialRampToValueAtTime(0.0004, t + 0.62);
    this._out(n.g, 0.6);
  }

  /* ----------------------------- ambience ------------------------------- */

  _startAmbience() {
    const ac = this.ac;

    // 1. wind funnelling down the avenue
    const wind = ac.createBufferSource();
    wind.buffer = this._noiseBuf; wind.loop = true;
    const wf = ac.createBiquadFilter();
    wf.type = 'bandpass'; wf.frequency.value = 380; wf.Q.value = 0.55;
    const wg = ac.createGain(); wg.gain.value = 0.09;
    wind.connect(wf); wf.connect(wg); wg.connect(this.amb);
    wind.start();
    this._windFilter = wf; this._windGain = wg;

    // 2. low urban rumble — traffic that is not there any more, just the city
    const rum = ac.createBufferSource();
    rum.buffer = this._noiseBuf; rum.loop = true; rum.playbackRate.value = 0.22;
    const rf = ac.createBiquadFilter();
    rf.type = 'lowpass'; rf.frequency.value = 92; rf.Q.value = 0.7;
    const rg = ac.createGain(); rg.gain.value = 0.2;
    rum.connect(rf); rf.connect(rg); rg.connect(this.amb);
    rum.start();

    // 3. electrical hum from a transformer that never got shut off
    const hum = ac.createOscillator();
    hum.type = 'sawtooth'; hum.frequency.value = 60;
    const hf = ac.createBiquadFilter();
    hf.type = 'lowpass'; hf.frequency.value = 220;
    const hg = ac.createGain(); hg.gain.value = 0.012;
    hum.connect(hf); hf.connect(hg); hg.connect(this.amb);
    hum.start();

    this._ambT = 0;
    this._nextEvent = 4;
  }

  /** Occasional distant sirens, metal groans, far-off gunfire. */
  _ambientEvent() {
    const ac = this.ac, t = ac.currentTime;
    const r = this.rng.next();
    if (r < 0.3) {
      // distant two-tone siren, heavily filtered by distance
      const o = ac.createOscillator();
      o.type = 'sine';
      const g = ac.createGain();
      const f = ac.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 900;
      const base = 620 + this.rng.next() * 180;
      const dur = 5.5;
      for (let i = 0; i < 7; i++) {
        o.frequency.setValueAtTime(base, t + i * 0.8);
        o.frequency.setValueAtTime(base * 0.72, t + i * 0.8 + 0.4);
      }
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.028, t + 1.2);
      g.gain.exponentialRampToValueAtTime(0.0002, t + dur);
      o.connect(f); f.connect(g); g.connect(this.amb);
      o.start(t); o.stop(t + dur + 0.2);
    } else if (r < 0.58) {
      // structural groan — a building settling
      const o = ac.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(48 + this.rng.next() * 40, t);
      o.frequency.linearRampToValueAtTime(30 + this.rng.next() * 20, t + 2.4);
      const f = ac.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 300; f.Q.value = 4;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05, t + 0.7);
      g.gain.exponentialRampToValueAtTime(0.0002, t + 2.6);
      o.connect(f); f.connect(g); g.connect(this.amb);
      o.start(t); o.stop(t + 2.8);
    } else if (r < 0.82) {
      // distant firefight, several blocks over
      const n = this.rng.int(3, 9);
      for (let i = 0; i < n; i++) {
        const d = i * this.rng.range(0.08, 0.3);
        const b = this._noise(0.35, 0, 'lowpass', 320, 1.1);
        b.g.gain.setValueAtTime(0.0001, t + d);
        b.g.gain.exponentialRampToValueAtTime(this.rng.range(0.02, 0.06), t + d + 0.01);
        b.g.gain.exponentialRampToValueAtTime(0.0002, t + d + 0.3);
        b.g.connect(this.amb);
      }
    } else {
      // steam hiss / metal movement nearby
      const s = this._noise(2.5, 0, 'bandpass', 2600 + this.rng.next() * 2400, 0.8);
      s.g.gain.setValueAtTime(0.0001, t);
      s.g.gain.exponentialRampToValueAtTime(0.03, t + 0.4);
      s.g.gain.exponentialRampToValueAtTime(0.0002, t + 2.4);
      s.g.connect(this.amb);
    }
  }

  update(dt) {
    if (!this.enabled) return;
    this._ambT += dt;
    this._nextEvent -= dt;
    if (this._nextEvent <= 0) {
      this._nextEvent = this.rng.range(7, 22);
      this._ambientEvent();
    }
    // wind swells slowly
    if (this._windFilter) {
      const s = Math.sin(this._ambT * 0.13) * 0.5 + 0.5;
      this._windFilter.frequency.value = lerp(280, 620, s);
      this._windGain.gain.value = lerp(0.055, 0.13, s);
    }

    // Interior acoustics: swap the reverb send when the player is under cover.
    const phys = this.ctx.get('physics');
    const p = this.player;
    const roof = phys.raycast(p.pos.x, p.pos.y + p.eyeHeight, p.pos.z, 0, 1, 0, 14, 2);
    const indoors = roof.hit;
    const target = indoors ? 1 : 0;
    this._indoor = lerp(this._indoor || 0, target, 1 - Math.exp(-3 * dt));
    this.sendIn.gain.value = this._indoor * 0.55;
    this.sendOut.gain.value = (1 - this._indoor) * 0.42;
  }

  dispose() {
    if (this.ac) this.ac.close();
  }
}
