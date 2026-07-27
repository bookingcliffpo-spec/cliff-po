import * as THREE from 'three';
import { Batcher } from './batcher.js';
import { PLAN, buildBlocks, buildLots, SPAWN, isOpen, isRoad, frontage } from './nyc-layout.js';
import { StreetBuilder, roadHeight } from './nyc-streets.js';
import { BuildingGenerator } from './nyc-buildings.js';
import { PropBuilder } from './nyc-props.js';
import { VehicleBuilder } from './nyc-vehicles.js';
import { SkylineBuilder } from './nyc-skyline.js';
import { InteriorBuilder } from './nyc-interiors.js';
import { clamp01, TAU } from '../core/math.js';

/**
 * WorldSystem — owns the NYC district.
 *
 * Build order matters: layout → streets → buildings (which claim lots and
 * declare interiors) → interiors → props → vehicles → skyline. Everything is
 * funnelled through one Batcher so the whole city lands in the scene as a few
 * dozen merged meshes and instanced meshes rather than thousands of Meshes.
 */
export class WorldSystem {
  constructor(ctx) {
    this.ctx = ctx;
    this.rng = ctx.rng.stream('world');
    this.root = new THREE.Group();
    this.root.name = 'NYC';

    this.blocks = [];
    this.lots = [];
    this.buildings = [];
    this.coverPoints = [];
    this.smokeSources = [];
    this.steamVents = [];
    this.dustSources = [];
    this.interiorLights = [];
    this.spawnPoints = [];
    this.patrolNodes = [];
    this.lights = [];
  }

  init() {
    const render = this.ctx.get('render');
    this.materials = this.ctx.get('materials');
    this.phys = this.ctx.get('physics');
    this.batcher = new Batcher(this.materials, render.scene);
    render.scene.add(this.root);

    this._layout();
    const streets = new StreetBuilder(this);
    streets.build();

    const bg = new BuildingGenerator(this);
    for (const lot of this.lots) {
      const blk = this.blocks.find((b) => b.id === lot.block);
      this.buildings.push(bg.generate(lot, blk));
    }

    const interiors = new InteriorBuilder(this);
    for (const rec of this.buildings) {
      if (rec.hollow) interiors.build(rec);
    }

    new PropBuilder(this).build();
    const veh = new VehicleBuilder(this);
    veh.build();
    this.vehicleCount = veh.count;

    new SkylineBuilder(this).build();

    this.batcher.build(this.root, { castShadow: true, receiveShadow: true });
    this._placeLights(render);
    this._buildNav();

    this.stats = {
      ...this.batcher.stats,
      buildings: this.buildings.length,
      vehicles: this.vehicleCount,
      cover: this.coverPoints.length,
      colliders: this.phys.colliderCount,
    };
  }

  _layout() {
    const rng = this.rng.stream('layout');
    this.blocks = buildBlocks();
    for (const blk of this.blocks) {
      const lots = buildLots(blk, rng.stream(blk.id));
      for (const l of lots) this.lots.push(l);
    }

    // Choose the four enterable buildings: one of each kind, all near the
    // player's route so they read as options rather than easter eggs.
    const wants = [
      { kind: 'store', near: [24, 8] },
      { kind: 'lobby', near: [-24, -18] },
      { kind: 'office', near: [22, -20] },
      { kind: 'collapsed', near: [-22, 20] },
    ];
    for (const w of wants) {
      let best = null, bestD = Infinity;
      for (const lot of this.lots) {
        if (lot.hollow) continue;
        if (lot.w < 11 || lot.d < 11) continue;
        const d = Math.hypot(lot.cx - w.near[0], lot.cz - w.near[1]);
        if (d < bestD) { bestD = d; best = lot; }
      }
      if (best) { best.hollow = true; best.interiorKind = w.kind; }
    }
  }

  /**
   * A fixed, small set of real point lights. Everything else that "glows" is
   * emissive material — hundreds of dynamic lights would cost more than the
   * rest of the frame put together.
   */
  _placeLights(render) {
    const budget = 12;
    const spawn = new THREE.Vector3(SPAWN.x, 1.6, SPAWN.z);
    const sorted = this.interiorLights
      .map((l) => ({ ...l, d: Math.hypot(l.x - spawn.x, l.z - spawn.z) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, budget);
    for (const l of sorted) {
      const p = new THREE.PointLight(l.color, l.intensity, l.distance || 10, 2);
      p.position.set(l.x, l.y, l.z);
      p.castShadow = false;
      p.userData.flicker = l.flicker || 0;
      p.userData.base = l.intensity;
      render.scene.add(p);
      this.lights.push(p);
    }
  }

  /**
   * Navigation and encounter graph. The AI does not use a navmesh — the street
   * plan already is one — so we sample walkable points and link them.
   */
  _buildNav() {
    const rng = this.rng.stream('nav');
    const nodes = [];
    const step = 4.5;
    for (let x = PLAN.bounds.minX + 4; x < PLAN.bounds.maxX - 4; x += step) {
      for (let z = PLAN.bounds.minZ + 4; z < PLAN.bounds.maxZ - 4; z += step) {
        if (!isOpen(x, z)) continue;
        const y = isRoad(x, z) ? roadHeight(x, z) : 0.155;
        if (!this.phys.capsuleFree(x, y + 0.1, z, 0.36, 1.7)) continue;
        nodes.push({ x, y, z, links: [] });
      }
    }
    // link neighbours
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        if (d > step * 1.6) continue;
        if (!this.phys.lineOfSight(a.x, a.y + 0.9, a.z, b.x, b.y + 0.9, b.z)) continue;
        a.links.push(j); b.links.push(i);
      }
    }
    this.navNodes = nodes;

    // Interior nodes so enemies can hold rooms.
    for (const rec of this.buildings) {
      if (!rec.hollow) continue;
      for (let i = 0; i < 8; i++) {
        const x = rec.core.x0 + rng.range(1, rec.core.x1 - rec.core.x0 - 1);
        const z = rec.core.z0 + rng.range(1, rec.core.z1 - rec.core.z0 - 1);
        if (!this.phys.capsuleFree(x, 0.3, z, 0.36, 1.7)) continue;
        nodes.push({ x, y: 0.155, z, links: [], interior: true });
      }
    }

    // Attach the nearest nav node to each cover point so the AI can path to it.
    for (const c of this.coverPoints) {
      let best = -1, bestD = Infinity;
      for (let i = 0; i < nodes.length; i++) {
        const d = Math.hypot(nodes[i].x - c.x, nodes[i].z - c.z);
        if (d < bestD) { bestD = d; best = i; }
      }
      c.node = best;
      c.dist = bestD;
    }
    this.coverPoints = this.coverPoints.filter((c) => c.dist < 7);

    // Enemy encounter clusters spread across the district, deliberately not
    // all in the player's opening sightline.
    this.encounters = [
      { x: -2, z: -22, radius: 12, count: 3, tag: 'avenue-north' },
      { x: 6, z: 26, radius: 12, count: 3, tag: 'avenue-south' },
      { x: -30, z: 4, radius: 10, count: 2, tag: 'cross-west' },
      { x: 44, z: -3, radius: 12, count: 3, tag: 'cross-east' },
      { x: -46, z: -34, radius: 10, count: 2, tag: 'alley-north' },
      { x: 40, z: 40, radius: 12, count: 3, tag: 'block-se' },
      { x: -8, z: -60, radius: 12, count: 2, tag: 'street-a' },
      { x: 8, z: 62, radius: 12, count: 2, tag: 'street-b' },
      { x: 24, z: 8, radius: 8, count: 2, tag: 'store-interior' },
    ];
  }

  /** Nearest walkable ground height, used by spawn logic. */
  groundAt(x, z) {
    return isRoad(x, z) ? roadHeight(x, z) : 0.155;
  }

  get spawn() { return SPAWN; }

  update(dt, elapsed) {
    // Flickering fixtures — the only per-frame work the world does.
    for (let i = 0; i < this.lights.length; i++) {
      const l = this.lights[i];
      const f = l.userData.flicker;
      if (!f) continue;
      const t = elapsed * f;
      const n = Math.sin(t * 11.3) * Math.sin(t * 4.7) * Math.sin(t * 23.1);
      l.intensity = l.userData.base * (0.55 + 0.45 * clamp01(n * 0.5 + 0.75));
    }
  }

  dispose() {
    this.batcher.dispose();
    this.root.removeFromParent();
  }
}
