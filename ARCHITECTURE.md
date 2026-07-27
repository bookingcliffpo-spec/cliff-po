# Claude of Duty — Engine Architecture

**Desolate New York City.** A browser FPS rendered entirely through Three.js/WebGL2.
Every texture, mesh, material and sound in this project is generated in code at load
time. There are no downloaded assets, no GLTF imports, no HDRIs, no image files, and
no external services. `npm install && npm run build` is the complete pipeline, and the
game runs offline afterwards.

---

## 1. The subsystem contract

The engine is a registry of **systems**. A system is a plain object with an optional
lifecycle. Systems never import each other directly across directories — they resolve
one another at runtime through the context:

```js
const world = ctx.get('world');
```

Calling `ctx.get()` for a system that has not been registered throws. This is
deliberate: it makes ordering violations loud instead of silent.

### Registration order

Order matters because `init()` runs in registration order and later systems may read
earlier ones. The canonical order is:

| # | key         | responsibility                                                        |
|---|-------------|-----------------------------------------------------------------------|
| 1 | `render`    | WebGLRenderer, scenes, cameras, tone mapping, post pipeline, resize     |
| 2 | `materials`  | Procedural texture + material library. Owns all `CanvasTexture`s.      |
| 3 | `sky`       | Sky dome shader, sun/ambient/hemisphere lighting, fog, smoke columns    |
| 4 | `world`     | NYC generation: layout, buildings, streets, props, vehicles, interiors  |
| 5 | `physics`   | Static collision broadphase + capsule resolution + ray/hitscan queries  |
| 6 | `player`    | Capsule controller, camera, stance, health                             |
| 7 | `weapons`   | View model, ADS, recoil, sway, reload, ballistics                      |
| 8 | `fx`        | Particles, decals, tracers, shells, muzzle flash, impact vocabulary     |
| 9 | `ai`        | Enemy squads, navigation, cover selection, combat behaviour            |
|10 | `ui`        | HUD, crosshair, hitmarkers, killfeed, compass, damage feedback         |
|11 | `audio`     | Synthesized weapon + ambience graph (WebAudio, no recordings)          |

### Lifecycle

```
new System(ctx)
  ↓
system.init()          once, in registration order
  ↓
system.prewarm()       once, before the first presented frame
  ↓
loop {
  system.fixedUpdate(FIXED_DT, tick)   0..N times per frame, deterministic
  system.update(dt, elapsed)           once per frame, presentation-rate
  system.render()                      render system only
}
  ↓
system.dispose()
```

- **`fixedUpdate`** runs at a fixed 1/120 s step with an accumulator and a max-substep
  clamp. All movement, ballistics, AI and physics live here. Given the same seed and
  the same input sequence, the same simulation results. This is what makes the capture
  harness deterministic.
- **`update`** is for interpolation, cosmetics, particles and UI. Never put gameplay
  state changes here.

---

## 2. Determinism

`ctx.rng` is a seeded `sfc32` stream created from `?seed=` (default `NYC-1`).
**`Math.random()` is banned in `src/`** — a lint check in `tools/verify.js` enforces it.
World generation draws from named sub-streams (`ctx.rng.stream('buildings')`) so that
adding a prop later does not reshuffle the whole city.

The capture harness (`tools/capture.js`) drives the engine through
`window.__cod` with a fixed frame count and a fixed dt, which is why screenshots are
reproducible.

---

## 3. Rendering

Two scenes, two cameras:

- `scene` / `camera` — the world, rendered with a 0.1–2600 m frustum.
- `viewScene` / `viewCamera` — the first-person weapon, rendered on top with its own
  narrow FOV so the gun never clips into geometry.

Post-processing is a hand-rolled chain (no `EffectComposer` dependency):
bright-pass → separable blur → composite with tonemapping, vignette, chromatic
aberration, film grain and a subtle sharpen. ACES-derived filmic tonemapping runs in
the composite pass, not the renderer, so bloom happens in linear light.

### Budgets

| resource            | budget      |
|---------------------|-------------|
| draw calls          | < 900       |
| unique materials    | < 90        |
| live particles      | 2200        |
| live decals         | 320         |
| dynamic point lights| 12 visible  |
| shadow casters      | 1 cascade-ish directional + baked-in AO |

Repeated architecture (windows, fire-escape rails, bricks, railings, bollards,
debris) **must** be `InstancedMesh`. Static per-block geometry is merged with
`BufferGeometryUtils.mergeGeometries` before it reaches the scene graph.

---

## 4. Materials

`materials.get(name)` returns a shared `MeshStandardMaterial`. Every close-range
material carries, at minimum:

- albedo with macro (low-frequency) **and** micro (high-frequency) variation
- a normal map derived from the same height field as the albedo
- a roughness map that is *not* uniform
- edge grime / dirt accumulation in crevices

Textures are built on `OffscreenCanvas` (falling back to `<canvas>`) by
`src/materials/procgen.js`, which provides value noise, fBm, Worley, brick lattices,
crack fields, streak/drip fields and a Sobel height→normal converter.

---

## 5. World

`src/world/` owns everything NYC. `nyc-layout.js` produces a deterministic block plan
(streets, sidewalks, lots, doorways, interiors, spawn points, cover points) and the
other modules consume that plan. Nothing else in the engine knows about street
geometry — physics, AI and audio all read the plan through `world.*` accessors.

---

## 6. Rules

1. No `Math.random()` in `src/`.
2. No cross-directory imports except `src/core/*` and `three`.
3. No allocation in `update`/`fixedUpdate` hot paths — use the scratch vectors in
   `src/core/scratch.js`.
4. No external assets. If you need a texture, generate it.
5. Anything repeated more than ~24 times is an `InstancedMesh`.
6. `prewarm()` must compile every shader and upload every texture before the first
   presented frame. Shader stalls mid-firefight are a bug.
