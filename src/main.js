import { Engine } from './core/engine.js';
import { RenderSystem } from './render/render-system.js';
import { MaterialSystem } from './materials/material-system.js';
import { SkySystem } from './sky/sky-system.js';
import { WorldSystem } from './world/world-system.js';
import { PhysicsSystem } from './physics/physics-system.js';
import { PlayerSystem } from './player/player-system.js';
import { WeaponSystem } from './weapons/weapon-system.js';
import { FxSystem } from './fx/fx-system.js';
import { AiSystem } from './ai/ai-system.js';
import { UiSystem } from './ui/ui-system.js';
import { AudioSystem } from './audio/audio-system.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('game');

const engine = new Engine({
  canvas,
  seed: params.get('seed') || 'NYC-1',
  quality: params.get('quality') || 'high',
  deterministic: params.has('capture'),
  captureDt: 1 / 60,
});

// Registration order is the contract (see ARCHITECTURE.md §1).
engine.register('render', new RenderSystem(engine));
engine.register('materials', new MaterialSystem(engine));
engine.register('sky', new SkySystem(engine));
engine.register('physics', new PhysicsSystem(engine));
engine.register('world', new WorldSystem(engine));
engine.register('player', new PlayerSystem(engine));
engine.register('fx', new FxSystem(engine));
engine.register('ai', new AiSystem(engine));
engine.register('weapons', new WeaponSystem(engine));
engine.register('ui', new UiSystem(engine));
engine.register('audio', new AudioSystem(engine));

const loader = document.getElementById('loader');
const bar = document.getElementById('loadbar');
const label = document.getElementById('loadlabel');
const startPanel = document.getElementById('start');

const LABELS = {
  render: 'Initialising renderer',
  materials: 'Synthesising materials',
  sky: 'Building the sky',
  physics: 'Preparing collision',
  world: 'Constructing Manhattan',
  player: 'Deploying',
  fx: 'Loading effects',
  ai: 'Deploying hostiles',
  weapons: 'Checking weapon',
  ui: 'Bringing up HUD',
  audio: 'Calibrating audio',
  prewarm: 'Compiling shaders',
  ready: 'Ready',
};

let stageT = performance.now();
function progress(key, t) {
  if (bar) bar.style.width = `${Math.round(t * 100)}%`;
  if (label) label.textContent = LABELS[key] || key;
  const now = performance.now();
  console.log(`[stage] ${key} (prev took ${(now - stageT).toFixed(0)} ms)`);
  stageT = now;
}

async function boot() {
  const t0 = performance.now();
  try {
    engine.get('render').setQuality(engine.quality);
    await engine.init(progress);
  } catch (err) {
    if (label) label.textContent = `Failed: ${err.message}`;
    console.error(err);
    throw err;
  }
  const buildMs = performance.now() - t0;
  console.log(`[cod] world built in ${buildMs.toFixed(0)} ms`, engine.get('world').stats);

  if (loader) loader.classList.add('done');
  if (engine.deterministic) {
    // Capture runs must show the game and nothing else.
    if (loader) loader.style.display = 'none';
    if (startPanel) startPanel.style.display = 'none';
  } else if (startPanel) {
    startPanel.classList.add('show');
  }

  engine.start();

  // Expose a stable handle for the capture harness and for debugging.
  window.__cod = {
    engine,
    get: (k) => engine.get(k),
    stats: () => ({ ...engine.stats, world: engine.get('world').stats, buildMs }),
    advance: (frames, dt) => engine.advance(frames, dt),
    teleport(x, y, z, yaw, pitch) {
      const p = engine.get('player');
      p.pos.set(x, y, z);
      p.vel.set(0, 0, 0);
      if (yaw !== undefined) p.yaw = yaw;
      if (pitch !== undefined) p.pitch = pitch;
      p.applyToCamera(0);
      engine.get('render').update(0);
    },
    setScriptedInput(src) { engine.input.setScripted(src); },
    hideHud(v) {
      const h = document.getElementById('hud');
      if (h) h.style.display = v ? 'none' : '';
    },
    ready: true,
  };
  window.dispatchEvent(new CustomEvent('cod:ready'));
}

function beginPlay() {
  if (startPanel) startPanel.classList.remove('show');
  engine.input.requestLock();
  engine.get('audio').resume();
}

if (startPanel) {
  startPanel.addEventListener('click', beginPlay);
}
canvas.addEventListener('click', () => {
  if (!engine.input.locked && engine.started) beginPlay();
});

engine.events.on('pointerlock', (locked) => {
  if (!locked && startPanel && engine.started && !engine.deterministic) {
    startPanel.classList.add('show');
    startPanel.querySelector('h1').textContent = 'PAUSED';
  }
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'F1') {
    e.preventDefault();
    const ui = engine.get('ui');
    ui.showStats = !ui.showStats;
    ui.el.stats.textContent = '';
  }
});

boot();
