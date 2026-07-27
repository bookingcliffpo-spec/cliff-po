import { clamp01, lerp, damp, TAU } from '../core/math.js';

const CSS = `
#hud{position:fixed;inset:0;pointer-events:none;font-family:"Barlow Condensed","Arial Narrow",Arial,sans-serif;
  color:#e8e6e0;text-shadow:0 1px 3px rgba(0,0,0,.85);user-select:none;z-index:20;letter-spacing:.5px}
#hud .lo{position:absolute;left:0;right:0;bottom:0;top:0}
#xhair{position:absolute;left:50%;top:50%;width:38px;height:38px;margin:-19px 0 0 -19px}
#xhair i{position:absolute;background:#e9ece8;box-shadow:0 0 3px rgba(0,0,0,.9);opacity:.92}
#xhair .d{left:50%;top:50%;width:2px;height:2px;margin:-1px 0 0 -1px;border-radius:50%;background:#fff}
#hitmark{position:absolute;left:50%;top:50%;width:34px;height:34px;margin:-17px 0 0 -17px;opacity:0}
#hitmark i{position:absolute;width:9px;height:2px;background:#fff;box-shadow:0 0 4px #000}
#ammo{position:absolute;right:42px;bottom:34px;text-align:right;line-height:1}
#ammo .n{font-size:52px;font-weight:700;letter-spacing:1px}
#ammo .r{font-size:22px;opacity:.62;margin-left:6px;font-weight:600}
#ammo .w{font-size:13px;opacity:.55;letter-spacing:3px;margin-top:4px}
#ammo.low .n{color:#e2603c}
#health{position:absolute;left:42px;bottom:38px;width:230px}
#health .bar{height:7px;background:rgba(255,255,255,.13);border-left:2px solid rgba(255,255,255,.4);overflow:hidden}
#health .fill{height:100%;background:linear-gradient(90deg,#cfd6cf,#8fa08c);transition:width .12s linear}
#health.hurt .fill{background:linear-gradient(90deg,#d8563a,#8a2f22)}
#health .lbl{font-size:12px;opacity:.55;letter-spacing:3px;margin-bottom:6px}
#stamina{height:3px;margin-top:5px;background:rgba(255,255,255,.09)}
#stamina div{height:100%;background:rgba(210,220,230,.55)}
#feed{position:absolute;right:42px;top:96px;text-align:right;font-size:15px;line-height:1.65;font-weight:600}
#feed div{opacity:0;transform:translateX(14px)}
#feed b{color:#e2b13c;font-weight:700}
#compass{position:absolute;left:50%;top:26px;width:420px;height:26px;margin-left:-210px;overflow:hidden;
  -webkit-mask-image:linear-gradient(90deg,transparent,#000 18%,#000 82%,transparent);
  mask-image:linear-gradient(90deg,transparent,#000 18%,#000 82%,transparent)}
#compass canvas{width:420px;height:26px;display:block}
#map{position:absolute;left:38px;top:34px;width:168px;height:168px;
  border:1px solid rgba(255,255,255,.16);background:rgba(8,10,12,.42);backdrop-filter:blur(2px)}
#map canvas{width:100%;height:100%;display:block}
#dmg{position:absolute;inset:0;opacity:0;background:radial-gradient(ellipse at center,rgba(120,0,0,0) 42%,rgba(140,10,6,.82) 100%)}
#dmgArrows{position:absolute;left:50%;top:50%}
#dmgArrows div{position:absolute;left:-9px;top:-118px;width:18px;height:20px;opacity:0;
  border-left:9px solid transparent;border-right:9px solid transparent;border-bottom:20px solid rgba(235,70,50,.9)}
#msg{position:absolute;left:0;right:0;top:31%;text-align:center;font-size:30px;font-weight:700;letter-spacing:7px;opacity:0}
#msg small{display:block;font-size:14px;letter-spacing:4px;opacity:.6;margin-top:10px;font-weight:500}
#stats{position:absolute;right:12px;top:12px;font:11px/1.5 ui-monospace,Menlo,Consolas,monospace;
  opacity:.42;text-align:right;white-space:pre}
#vig{position:absolute;inset:0;box-shadow:inset 0 0 190px rgba(0,0,0,.55);pointer-events:none}
#prompt{position:absolute;left:0;right:0;bottom:23%;text-align:center;font-size:15px;letter-spacing:3px;opacity:0}
#lowhp{position:absolute;inset:0;opacity:0;background:radial-gradient(ellipse at center,rgba(90,0,0,0) 30%,rgba(120,8,4,.6) 100%)}
`;

export class UiSystem {
  constructor(ctx) {
    this.ctx = ctx;
    this.hitmarkT = 0;
    this.hitmarkHead = false;
    this.dmgT = 0;
    this.msgT = 0;
    this.feed = [];
    this.dmgArrows = [];
    this.showStats = true;
    this.spreadPx = 8;
  }

  init() {
    this.player = this.ctx.get('player');
    this.weapons = this.ctx.get('weapons');
    this.ai = this.ctx.get('ai');
    this.world = this.ctx.get('world');

    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.id = 'hud';
    root.innerHTML = `
      <div id="vig"></div>
      <div id="lowhp"></div>
      <div id="dmg"></div>
      <div id="dmgArrows"></div>
      <div id="xhair">
        <i class="t"></i><i class="b"></i><i class="l"></i><i class="r"></i><i class="d"></i>
      </div>
      <div id="hitmark"><i class="a"></i><i class="b"></i><i class="c"></i><i class="d"></i></div>
      <div id="compass"><canvas width="840" height="52"></canvas></div>
      <div id="map"><canvas width="336" height="336"></canvas></div>
      <div id="health">
        <div class="lbl">VITALS</div>
        <div class="bar"><div class="fill" style="width:100%"></div></div>
        <div id="stamina"><div style="width:100%"></div></div>
      </div>
      <div id="ammo">
        <div><span class="n">30</span><span class="r">/210</span></div>
        <div class="w">MK-4 CARBINE</div>
      </div>
      <div id="feed"></div>
      <div id="msg"></div>
      <div id="prompt"></div>
      <div id="stats"></div>`;
    document.body.appendChild(root);
    this.root = root;

    this.el = {
      xhair: root.querySelector('#xhair'),
      xt: root.querySelector('#xhair .t'), xb: root.querySelector('#xhair .b'),
      xl: root.querySelector('#xhair .l'), xr: root.querySelector('#xhair .r'),
      xd: root.querySelector('#xhair .d'),
      hitmark: root.querySelector('#hitmark'),
      ammoN: root.querySelector('#ammo .n'),
      ammoR: root.querySelector('#ammo .r'),
      ammo: root.querySelector('#ammo'),
      hp: root.querySelector('#health .fill'),
      hpBox: root.querySelector('#health'),
      stam: root.querySelector('#stamina div'),
      feed: root.querySelector('#feed'),
      dmg: root.querySelector('#dmg'),
      lowhp: root.querySelector('#lowhp'),
      arrows: root.querySelector('#dmgArrows'),
      msg: root.querySelector('#msg'),
      prompt: root.querySelector('#prompt'),
      stats: root.querySelector('#stats'),
      compass: root.querySelector('#compass canvas'),
      map: root.querySelector('#map canvas'),
    };
    this.cctx = this.el.compass.getContext('2d');
    this.mctx = this.el.map.getContext('2d');

    for (const hm of this.el.hitmark.children) {
      hm.style.left = '50%'; hm.style.top = '50%';
    }
    this._layoutHitmark();

    const ev = this.ctx.events;
    ev.on('weapon:hitmarker', (d) => {
      this.hitmarkT = 0.22;
      this.hitmarkHead = d.headshot;
      if (d.killed) this.pushFeed(`<b>YOU</b> eliminated <b>HOSTILE</b>${d.headshot ? ' — HEADSHOT' : ''}`);
    });
    ev.on('player:damage', (d) => {
      this.dmgT = 0.55;
      this._addArrow(d.dir);
    });
    ev.on('player:death', () => this.message('YOU ARE DOWN', 'RESPAWNING'));
    ev.on('player:respawn', () => { this.msgT = 0; this.el.msg.style.opacity = 0; });
    ev.on('ai:spotted', () => this.pushFeed('<b>CONTACT</b>'));
    ev.on('weapon:reload', () => this.showPrompt('RELOADING', 1.2));

    this._mapScale = 1.05;
  }

  _layoutHitmark() {
    const c = this.el.hitmark.children;
    const set = (i, x, y, r) => {
      c[i].style.transform = `translate(${x}px,${y}px) rotate(${r}deg)`;
    };
    set(0, -14, -14, 45); set(1, 6, -14, -45); set(2, -14, 6, -45); set(3, 6, 6, 45);
  }

  pushFeed(html) {
    const d = document.createElement('div');
    d.innerHTML = html;
    this.el.feed.appendChild(d);
    this.feed.push({ el: d, t: 0 });
    if (this.feed.length > 6) {
      const old = this.feed.shift();
      old.el.remove();
    }
  }

  message(text, sub) {
    this.el.msg.innerHTML = `${text}${sub ? `<small>${sub}</small>` : ''}`;
    this.msgT = 2.6;
  }

  showPrompt(text, time) {
    this.el.prompt.textContent = text;
    this.promptT = time;
  }

  _addArrow(dir) {
    const el = document.createElement('div');
    this.el.arrows.appendChild(el);
    this.dmgArrows.push({ el, t: 0, dir: { x: dir.x, z: dir.z } });
    if (this.dmgArrows.length > 5) {
      const o = this.dmgArrows.shift();
      o.el.remove();
    }
  }

  update(dt) {
    const p = this.player, w = this.weapons;

    // ---- crosshair: gap tracks live spread ----
    const spread = w.currentSpread();
    const px = clamp01(spread / 0.09);
    this.spreadPx = damp(this.spreadPx, 3 + px * 26, 18, dt);
    const g = this.spreadPx;
    const len = 7 - p.adsAmount * 3;
    const th = 2;
    const set = (el, x, y, ww, hh) => {
      el.style.left = `${19 + x}px`; el.style.top = `${19 + y}px`;
      el.style.width = `${ww}px`; el.style.height = `${hh}px`;
    };
    set(this.el.xt, -th / 2, -g - len, th, len);
    set(this.el.xb, -th / 2, g, th, len);
    set(this.el.xl, -g - len, -th / 2, len, th);
    set(this.el.xr, g, -th / 2, len, th);
    // fade the reticle out as the optic takes over
    this.el.xhair.style.opacity = `${(1 - p.adsAmount) * (p.sprinting ? 0.25 : 1)}`;
    this.el.xd.style.opacity = `${0.5 + p.adsAmount * 0.5}`;

    // ---- hitmarker ----
    if (this.hitmarkT > 0) {
      this.hitmarkT -= dt;
      const k = clamp01(this.hitmarkT / 0.22);
      this.el.hitmark.style.opacity = `${k}`;
      this.el.hitmark.style.transform = `scale(${1.35 - k * 0.35})`;
      for (const c of this.el.hitmark.children) {
        c.style.background = this.hitmarkHead ? '#ff5a3c' : '#fff';
      }
    } else this.el.hitmark.style.opacity = '0';

    // ---- ammo / health ----
    this.el.ammoN.textContent = String(w.ammo).padStart(2, '0');
    this.el.ammoR.textContent = `/${w.reserve}`;
    this.el.ammo.classList.toggle('low', w.ammo <= 7);
    const hp = clamp01(p.health / p.maxHealth);
    this.el.hp.style.width = `${hp * 100}%`;
    this.el.hpBox.classList.toggle('hurt', hp < 0.4);
    this.el.stam.style.width = `${p.stamina * 100}%`;
    this.el.lowhp.style.opacity = `${clamp01((0.45 - hp) / 0.45) * (0.55 + Math.sin(this.ctx.elapsed * 4) * 0.12)}`;

    // ---- damage flash + directional arrows ----
    if (this.dmgT > 0) { this.dmgT -= dt; this.el.dmg.style.opacity = `${clamp01(this.dmgT / 0.55) * 0.9}`; }
    else this.el.dmg.style.opacity = '0';
    for (let i = this.dmgArrows.length - 1; i >= 0; i--) {
      const a = this.dmgArrows[i];
      a.t += dt;
      if (a.t > 1.5) { a.el.remove(); this.dmgArrows.splice(i, 1); continue; }
      const ang = Math.atan2(a.dir.x, -a.dir.z) - p.yaw;
      a.el.style.opacity = `${clamp01(1 - a.t / 1.5)}`;
      a.el.style.transform = `rotate(${ang}rad) translateY(0px)`;
      a.el.style.transformOrigin = '9px 118px';
    }

    // ---- killfeed ----
    for (let i = this.feed.length - 1; i >= 0; i--) {
      const f = this.feed[i];
      f.t += dt;
      const k = f.t < 0.18 ? f.t / 0.18 : clamp01((4.5 - f.t) / 0.6);
      f.el.style.opacity = `${k}`;
      f.el.style.transform = `translateX(${(1 - k) * 14}px)`;
      if (f.t > 5) { f.el.remove(); this.feed.splice(i, 1); }
    }

    // ---- messages ----
    if (this.msgT > 0) {
      this.msgT -= dt;
      this.el.msg.style.opacity = `${clamp01(Math.min(this.msgT, 0.4) / 0.4)}`;
    } else this.el.msg.style.opacity = '0';
    if (this.promptT > 0) {
      this.promptT -= dt;
      this.el.prompt.style.opacity = `${clamp01(this.promptT * 3)}`;
    } else this.el.prompt.style.opacity = '0';

    this._drawCompass();
    this._drawMap();

    if (this.showStats) {
      const s = this.ctx.stats;
      this.el.stats.textContent =
        `${s.fps.toFixed(0)} fps   ${s.ms.toFixed(1)} ms\n` +
        `draw ${s.drawCalls}  tri ${(s.triangles / 1000).toFixed(0)}k\n` +
        `part ${this.ctx.get('fx').liveParticles}  ai ${this.ai.aliveCount}`;
    }
  }

  _drawCompass() {
    const c = this.cctx;
    const W = 840, H = 52;
    c.clearRect(0, 0, W, H);
    const yaw = this.player.yaw;
    const pxPerRad = W / (Math.PI * 1.5);
    const cards = [
      [0, 'N'], [Math.PI / 4, 'NE'], [Math.PI / 2, 'E'], [Math.PI * 0.75, 'SE'],
      [Math.PI, 'S'], [-Math.PI * 0.75, 'SW'], [-Math.PI / 2, 'W'], [-Math.PI / 4, 'NW'],
    ];
    c.strokeStyle = 'rgba(232,230,224,.32)';
    c.lineWidth = 2;
    for (let d = -180; d <= 180; d += 5) {
      const a = d * Math.PI / 180;
      let rel = a + yaw;
      while (rel > Math.PI) rel -= TAU;
      while (rel < -Math.PI) rel += TAU;
      const x = W / 2 + rel * pxPerRad;
      if (x < -20 || x > W + 20) continue;
      const major = d % 45 === 0;
      c.beginPath();
      c.moveTo(x, major ? 8 : 18);
      c.lineTo(x, 26);
      c.stroke();
    }
    c.font = 'bold 22px "Barlow Condensed",Arial Narrow,Arial,sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'top';
    c.fillStyle = 'rgba(240,238,232,.92)';
    for (const [a, label] of cards) {
      let rel = a + yaw;
      while (rel > Math.PI) rel -= TAU;
      while (rel < -Math.PI) rel += TAU;
      const x = W / 2 + rel * pxPerRad;
      if (x < -30 || x > W + 30) continue;
      c.fillText(label, x, 28);
    }
    // centre bug
    c.fillStyle = '#e2b13c';
    c.beginPath();
    c.moveTo(W / 2, 4); c.lineTo(W / 2 - 7, -6); c.lineTo(W / 2 + 7, -6);
    c.closePath(); c.fill();
    c.fillRect(W / 2 - 1.5, 4, 3, 26);
  }

  _drawMap() {
    const c = this.mctx;
    const S = 336;
    const p = this.player;
    const range = 62;
    const k = (S / 2) / range;
    c.clearRect(0, 0, S, S);
    c.save();
    c.translate(S / 2, S / 2);
    c.rotate(p.yaw);

    // streets
    c.strokeStyle = 'rgba(190,200,210,.30)';
    c.lineWidth = 2;
    const plan = this.world && this.world.blocks;
    c.fillStyle = 'rgba(150,160,172,.22)';
    if (plan) {
      for (const b of plan) {
        const x0 = (b.x0 - p.pos.x) * k, z0 = (b.z0 - p.pos.z) * k;
        const x1 = (b.x1 - p.pos.x) * k, z1 = (b.z1 - p.pos.z) * k;
        c.fillRect(x0, z0, x1 - x0, z1 - z0);
        c.strokeRect(x0, z0, x1 - x0, z1 - z0);
      }
    }

    // enemies
    for (const e of this.ai.enemies) {
      if (e.state === 'dead') continue;
      const dx = (e.pos.x - p.pos.x), dz = (e.pos.z - p.pos.z);
      if (Math.hypot(dx, dz) > range) continue;
      const known = e.alertLevel > 0 || e.awareness > 0.3;
      c.fillStyle = known ? 'rgba(226,80,52,.95)' : 'rgba(226,80,52,.35)';
      c.beginPath();
      c.arc(dx * k, dz * k, 4.5, 0, TAU);
      c.fill();
    }
    c.restore();

    // player marker
    c.fillStyle = '#e8e6e0';
    c.beginPath();
    c.moveTo(S / 2, S / 2 - 9);
    c.lineTo(S / 2 - 6.5, S / 2 + 7);
    c.lineTo(S / 2 + 6.5, S / 2 + 7);
    c.closePath();
    c.fill();
    // view cone
    c.fillStyle = 'rgba(232,230,224,.10)';
    c.beginPath();
    c.moveTo(S / 2, S / 2);
    c.arc(S / 2, S / 2, S / 2, -Math.PI / 2 - 0.65, -Math.PI / 2 + 0.65);
    c.closePath();
    c.fill();
  }

  dispose() { this.root.remove(); }
}
