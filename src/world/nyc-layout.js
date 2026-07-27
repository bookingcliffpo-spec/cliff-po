/**
 * Deterministic district plan.
 *
 * Everything downstream — streets, buildings, props, AI navigation, audio
 * zones — reads this plan. Nothing else in the engine knows where a curb is.
 *
 * Axes: +X east, +Z south, +Y up. The avenue runs north/south along X = 0.
 */

export const PLAN = {
  bounds: { minX: -98, maxX: 98, minZ: -84, maxZ: 84 },

  // Road centrelines. halfRoad = curb to centreline. walk = sidewalk width.
  streets: [
    // The avenue — wide, long sightlines, the spine of the level.
    { id: 'avenue', axis: 'z', center: 0, halfRoad: 12.0, walk: 5.5, from: -84, to: 84, kind: 'avenue' },
    // Main cross street, meets the avenue at the intersection.
    { id: 'cross', axis: 'x', center: 0, halfRoad: 8.0, walk: 4.5, from: -98, to: 98, kind: 'street' },
    // Side Street A — tight brick corridor to the north.
    { id: 'streetA', axis: 'x', center: -62, halfRoad: 6.0, walk: 4.0, from: -98, to: 98, kind: 'street' },
    // Side Street B — commercial block to the south.
    { id: 'streetB', axis: 'x', center: 62, halfRoad: 6.5, walk: 4.5, from: -98, to: 98, kind: 'street' },
    // Boundary avenues, blocked at both ends by collapse and wreckage.
    { id: 'westAve', axis: 'z', center: -84, halfRoad: 7.0, walk: 4.0, from: -84, to: 84, kind: 'boundary' },
    { id: 'eastAve', axis: 'z', center: 84, halfRoad: 7.0, walk: 4.0, from: -84, to: 84, kind: 'boundary' },
  ],

  // Service alleys cut through the blocks. Narrow, dark, close-quarters.
  alleys: [
    { id: 'alleyN', axis: 'z', center: -46, halfRoad: 2.4, from: -58, to: -12, kind: 'alley' },
    { id: 'alleyS', axis: 'x', center: 36, halfRoad: 2.2, from: 17.5, to: 75, kind: 'alley' },
    { id: 'alleyE', axis: 'z', center: 46, halfRoad: 2.3, from: 12, to: 58, kind: 'alley' },
  ],
};

/** Half-width from centreline to the building line for a street. */
export function frontage(st) { return st.halfRoad + st.walk; }

/**
 * The four main blocks. Buildings ring each block's perimeter; the interior
 * is a courtyard of rubble, generators, ventilation and fire-escape landings.
 */
export function buildBlocks() {
  const ave = PLAN.streets[0], cross = PLAN.streets[1];
  const A = PLAN.streets[2], B = PLAN.streets[3];
  const W = PLAN.streets[4], E = PLAN.streets[5];

  const xW0 = W.center + frontage(W);      // -73
  const xW1 = ave.center - frontage(ave);  // -17.5
  const xE0 = ave.center + frontage(ave);  //  17.5
  const xE1 = E.center - frontage(E);      //  73

  const zN0 = A.center + frontage(A);      // -52
  const zN1 = cross.center - frontage(cross); // -12.5
  const zS0 = cross.center + frontage(cross); //  12.5
  const zS1 = B.center - frontage(B);      //  51

  return [
    { id: 'NW', x0: xW0, x1: xW1, z0: zN0, z1: zN1, theme: 'prewar' },
    { id: 'NE', x0: xE0, x1: xE1, z0: zN0, z1: zN1, theme: 'mixed' },
    { id: 'SW', x0: xW0, x1: xW1, z0: zS0, z1: zS1, theme: 'commercial' },
    { id: 'SE', x0: xE0, x1: xE1, z0: zS0, z1: zS1, theme: 'modern' },
  ];
}

/**
 * Subdivide a block's perimeter into building lots.
 * Each lot records which way it faces so storefronts, entrances, fire escapes
 * and signage end up on the street side rather than buried in a courtyard.
 */
export function buildLots(block, rng) {
  const lots = [];
  const depth = () => rng.range(15.5, 21);

  const sides = [
    { dir: 'north', axis: 'x', a0: block.x0, a1: block.x1, fixed: block.z0, normal: [0, -1] },
    { dir: 'south', axis: 'x', a0: block.x0, a1: block.x1, fixed: block.z1, normal: [0, 1] },
    { dir: 'west', axis: 'z', a0: block.z0, a1: block.z1, fixed: block.x0, normal: [-1, 0] },
    { dir: 'east', axis: 'z', a0: block.z0, a1: block.z1, fixed: block.x1, normal: [1, 0] },
  ];

  // Corners are handled by the north/south runs; east/west runs are inset so
  // corner buildings read as single masses with two street faces.
  const cornerInset = 17.5;

  for (const s of sides) {
    const isEW = s.axis === 'z';
    let a = s.a0 + (isEW ? cornerInset : 0);
    const end = s.a1 - (isEW ? cornerInset : 0);
    if (end - a < 8) continue;
    let guard = 0;
    while (a < end - 6 && guard++ < 40) {
      let w = rng.range(9.5, 17.5);
      if (a + w > end - 6) w = end - a;
      const d = depth();
      const isCorner = !isEW && (a <= s.a0 + 0.1 || a + w >= s.a1 - 0.1);
      const lot = {
        block: block.id,
        side: s.dir,
        theme: block.theme,
        corner: isCorner,
        normal: s.normal,
      };
      if (isEW) {
        lot.x0 = s.normal[0] < 0 ? s.fixed : s.fixed - d;
        lot.x1 = s.normal[0] < 0 ? s.fixed + d : s.fixed;
        lot.z0 = a; lot.z1 = a + w;
        lot.frontAxis = 'z';
      } else {
        lot.z0 = s.normal[1] < 0 ? s.fixed : s.fixed - d;
        lot.z1 = s.normal[1] < 0 ? s.fixed + d : s.fixed;
        lot.x0 = a; lot.x1 = a + w;
        lot.frontAxis = 'x';
      }
      lot.w = lot.x1 - lot.x0;
      lot.d = lot.z1 - lot.z0;
      lot.cx = (lot.x0 + lot.x1) / 2;
      lot.cz = (lot.z0 + lot.z1) / 2;
      lots.push(lot);
      a += w;
    }
  }
  return lots;
}

/** True if a world point sits on drivable roadway. */
export function isRoad(x, z) {
  for (const st of PLAN.streets) {
    if (st.axis === 'z') { if (Math.abs(x - st.center) <= st.halfRoad && z >= st.from && z <= st.to) return true; }
    else { if (Math.abs(z - st.center) <= st.halfRoad && x >= st.from && x <= st.to) return true; }
  }
  for (const al of PLAN.alleys) {
    if (al.axis === 'z') { if (Math.abs(x - al.center) <= al.halfRoad && z >= al.from && z <= al.to) return true; }
    else { if (Math.abs(z - al.center) <= al.halfRoad && x >= al.from && x <= al.to) return true; }
  }
  return false;
}

/** True on roadway or sidewalk — i.e. anywhere the player can walk outdoors. */
export function isOpen(x, z) {
  for (const st of PLAN.streets) {
    const f = frontage(st);
    if (st.axis === 'z') { if (Math.abs(x - st.center) <= f && z >= st.from && z <= st.to) return true; }
    else { if (Math.abs(z - st.center) <= f && x >= st.from && x <= st.to) return true; }
  }
  for (const al of PLAN.alleys) {
    if (al.axis === 'z') { if (Math.abs(x - al.center) <= al.halfRoad && z >= al.from && z <= al.to) return true; }
    else { if (Math.abs(z - al.center) <= al.halfRoad && x >= al.from && x <= al.to) return true; }
  }
  return false;
}

/** Distance from (x,z) to the nearest curb line, negative when on roadway. */
export function curbDistance(x, z) {
  let best = Infinity;
  for (const st of PLAN.streets) {
    const d = st.axis === 'z' ? Math.abs(x - st.center) : Math.abs(z - st.center);
    const along = st.axis === 'z' ? z : x;
    if (along < st.from || along > st.to) continue;
    best = Math.min(best, d - st.halfRoad);
  }
  return best;
}

/** The player's opening position: a side street, looking at the intersection. */
export const SPAWN = { x: 33.5, y: 0, z: 3.2, yaw: Math.PI / 2 + 0.06 };
