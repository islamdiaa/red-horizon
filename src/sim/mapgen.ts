import { Noise2D, Rng, hash2 } from '../core/rng';
import { GameMap, ORE_MAX, T, WATER_LEVEL } from './map';
import { addBridgesToMap } from './bridges';

export interface MapGenOptions {
  size: number;          // square maps
  players: number;       // 2..4
  seed: number;
  water: number;         // 0..1 amount of lakes
  /** Naval map: a central sea with a bay reaching towards every start (default: water >= 0.9). */
  sea?: boolean;
  trees: number;         // 0..1 forest density
  ore: number;           // 0..1 ore richness
  /** Lay bridges over narrow water that would otherwise force a long detour (default: on, except sea maps; bridges.ts). */
  bridges?: boolean;
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * Generates a fair, symmetric skirmish map:
 * 2 players => 180° rotational symmetry (bottom-left vs top-right),
 * 3-4 players => 4-way mirror symmetry (corners).
 */
export function generateMap(opts: MapGenOptions): GameMap {
  const N = opts.size;
  const map = new GameMap(N, N);
  map.seed = opts.seed;
  const rng = new Rng(opts.seed);
  const noise = new Noise2D(opts.seed);
  const four = opts.players > 2;
  const flipDiag = !four && rng.chance(0.5); // which diagonal the 2 players use

  // ---- symmetry helpers (cells) -------------------------------------------
  // Canonical cell for symmetric evaluation.
  const canon = (x: number, y: number): [number, number] => {
    if (four) return [Math.min(x, N - 1 - x), Math.min(y, N - 1 - y)];
    if (flipDiag) {
      // players top-left vs bottom-right: split on anti-diagonal
      // cells on the split line pair up with each other: tie-break so exactly one of a pair is canonical
      return x + y > N - 1 || (x + y === N - 1 && x > y) ? [N - 1 - x, N - 1 - y] : [x, y];
    }
    return x > y || (x === y && x > N - 1 - x) ? [N - 1 - x, N - 1 - y] : [x, y];
  };
  const canonV = (x: number, y: number): [number, number] => {
    if (four) return [Math.min(x, N - x), Math.min(y, N - y)];
    if (flipDiag) return x + y > N ? [N - x, N - y] : [x, y];
    return x > y ? [N - x, N - y] : [x, y];
  };
  /** All symmetric images of a canonical point (continuous coords). */
  const images = (x: number, y: number): [number, number][] => {
    if (four) {
      return [[x, y], [N - x, y], [x, N - y], [N - x, N - y]];
    }
    return [[x, y], [N - x, N - y]];
  };
  /** All symmetric images of the cell containing a point (integer cells: mirror is N-1-x, not N-x). */
  const cellImages = (x: number, y: number): [number, number][] => {
    const fx = Math.floor(x), fy = Math.floor(y);
    if (four) return [[fx, fy], [N - 1 - fx, fy], [fx, N - 1 - fy], [N - 1 - fx, N - 1 - fy]];
    return [[fx, fy], [N - 1 - fx, N - 1 - fy]];
  };

  // ---- start positions ------------------------------------------------------
  const m = Math.max(8, Math.round(N * 0.11));
  let starts: { x: number; y: number }[];
  if (four) {
    starts = [
      { x: m + 0.5, y: N - m - 0.5 },
      { x: N - m - 0.5, y: m + 0.5 },
      { x: m + 0.5, y: m + 0.5 },
      { x: N - m - 0.5, y: N - m - 0.5 },
    ].slice(0, opts.players);
  } else if (flipDiag) {
    starts = [{ x: m + 0.5, y: m + 0.5 }, { x: N - m - 0.5, y: N - m - 0.5 }];
  } else {
    starts = [{ x: m + 0.5, y: N - m - 0.5 }, { x: N - m - 0.5, y: m + 0.5 }];
  }
  map.startPositions = starts;
  const allCorners = four
    ? [{ x: m + 0.5, y: N - m - 0.5 }, { x: N - m - 0.5, y: m + 0.5 }, { x: m + 0.5, y: m + 0.5 }, { x: N - m - 0.5, y: N - m - 0.5 }]
    : starts;
  const baseR = 9;
  const distStart = (x: number, y: number) => {
    let d = Infinity;
    for (const s of allCorners) d = Math.min(d, Math.hypot(x - s.x, y - s.y));
    return d;
  };

  // ---- naval maps: a central sea with a bay reaching towards every start --------
  // (ground routes then run around the sea along the map edges; every bay can host a shipyard)
  const sea = opts.sea ?? opts.water >= 0.9;
  const C = N / 2;
  const seaR = N * 0.16, tipD = 12.5, tipR = 4.2, armW = 3.2;
  const tips = allCorners.map((s) => {
    const dx = C - s.x, dy = C - s.y, l = Math.hypot(dx, dy);
    return { x: s.x + (dx / l) * tipD, y: s.y + (dy / l) * tipD };
  });
  const seaAt = (px: number, py: number, wob: number) => {
    if (Math.hypot(px - C, py - C) < seaR + wob * 2) return true;
    for (const tp of tips) {
      if (Math.hypot(px - tp.x, py - tp.y) < tipR + wob * 0.4) return true;
      // the arm joining the bay to the open sea
      const ax = C - tp.x, ay = C - tp.y;
      const t = Math.max(0, Math.min(1, ((px - tp.x) * ax + (py - tp.y) * ay) / (ax * ax + ay * ay)));
      if (Math.hypot(px - tp.x - ax * t, py - tp.y - ay * t) < armW + wob * 0.6) return true;
    }
    return false;
  };
  const lakes = sea ? Math.min(opts.water, 0.35) : opts.water;

  // ---- terrain classification ----------------------------------------------
  const waterT = 0.2 + lakes * 0.17;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const [cx, cy] = canon(x, y);
      const i = map.idx(x, y);
      const ds = distStart(cx + 0.5, cy + 0.5);
      const wf = noise.fbm(cx * 0.035 + 100, cy * 0.035 + 7, 4);
      const rf = noise.fbm(cx * 0.09 + 50, cy * 0.09 + 50, 3);
      const df = noise.fbm(cx * 0.07 + 300, cy * 0.07 + 300, 3);
      let t: number = T.Clear;
      if (sea && seaAt(cx + 0.5, cy + 0.5, (noise.fbm(cx * 0.11 + 500, cy * 0.11 + 500, 2) - 0.5) * 3)) t = T.Water;
      else if (lakes > 0 && wf < waterT && ds > baseR + 5) t = T.Water;
      else if (rf > 0.7 && ds > baseR + 3) t = T.Rock;
      else if (df > 0.66) t = T.Dirt;
      map.terrain[i] = t;
    }
  }

  // Remove single-cell water/rock specks for cleaner shapes (symmetric since input is).
  for (let pass = 0; pass < 2; pass++) {
    const copy = map.terrain.slice();
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = map.idx(x, y);
      const t = copy[i];
      if (t !== T.Water && t !== T.Rock) continue;
      let same = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) { same++; continue; }
        if (copy[map.idx(nx, ny)] === t) same++;
      }
      if (same < 3) map.terrain[i] = T.Clear;
    }
  }

  // ---- connectivity: carve corridors between all starts ---------------------
  const wigAmp = sea ? 3 : 6;
  const carve = (ax: number, ay: number, bx: number, by: number, width: number) => {
    const steps = Math.ceil(Math.hypot(bx - ax, by - ay) * 2);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      // gentle wiggle so corridors are not ruler-straight
      const wig = (noise.value(t * 4 + 11, 3.3) - 0.5) * wigAmp;
      const nx = -(by - ay), ny = bx - ax;
      const nl = Math.hypot(nx, ny) || 1;
      const px = ax + (bx - ax) * t + (nx / nl) * wig;
      const py = ay + (by - ay) * t + (ny / nl) * wig;
      for (let dy = -width; dy <= width; dy++) for (let dx = -width; dx <= width; dx++) {
        if (dx * dx + dy * dy > width * width + 1) continue;
        for (const [cx, cy] of cellImages(px + dx, py + dy)) {
          if (!map.inBounds(cx, cy)) continue;
          const i = map.idx(cx, cy);
          if (map.terrain[i] === T.Water || map.terrain[i] === T.Rock) map.terrain[i] = T.Sand;
        }
      }
    }
  };
  // ground corridors: between every pair of starts, or on sea maps around the sea along the map edges
  const routes: [number, number, number, number][] = [];
  if (!sea) {
    for (let a = 0; a < allCorners.length; a++) {
      for (let b = a + 1; b < allCorners.length; b++) routes.push([allCorners[a].x, allCorners[a].y, allCorners[b].x, allCorners[b].y]);
    }
  } else {
    const ring = [{ x: m + 0.5, y: m + 0.5 }, { x: N - m - 0.5, y: m + 0.5 }, { x: N - m - 0.5, y: N - m - 0.5 }, { x: m + 0.5, y: N - m - 0.5 }];
    for (let k = 0; k < 4; k++) routes.push([ring[k].x, ring[k].y, ring[(k + 1) % 4].x, ring[(k + 1) % 4].y]);
  }
  for (const [ax, ay, bx, by] of routes) carve(ax, ay, bx, by, 1);

  // ---- distance to water (for shores and heights) ---------------------------
  const distWater = bfsDistance(map, (i) => map.terrain[i] === T.Water);
  const distLand = bfsDistance(map, (i) => map.terrain[i] !== T.Water);
  for (let i = 0; i < N * N; i++) {
    if (map.terrain[i] !== T.Water && map.terrain[i] !== T.Rock && distWater[i] <= 2) map.terrain[i] = T.Sand;
  }

  // ---- ore fields -----------------------------------------------------------
  type Field = { x: number; y: number; r: number; gems: boolean };
  const canonFields: Field[] = [];
  const s0 = four ? allCorners[0] : starts[0];
  const other = four ? { x: N / 2, y: N / 2 } : starts[1];
  const toward = Math.atan2(other.y - s0.y, other.x - s0.x);
  const fieldCount = 2;
  for (let k = 0; k < fieldCount; k++) {
    const spreadA = rng.range(0.6, 1.2);
    // (sea maps: keep the home fields clear of the bay, which points at the map centre)
    const ang = toward + (k === 0 ? -1 : 1) * (sea ? 0.95 + (spreadA - 0.6) * 0.6 : spreadA);
    const d = rng.range(8.5, 11.5);
    canonFields.push({ x: s0.x + Math.cos(ang) * d, y: s0.y + Math.sin(ang) * d, r: rng.range(3.3, 4.0) * (0.8 + opts.ore * 0.4), gems: false });
  }
  // contested mid fields
  const mid = { x: (s0.x + other.x) / 2, y: (s0.y + other.y) / 2 };
  const perp = toward + Math.PI / 2;
  // (2-player sea maps: the middle is open sea, so the contested fields sit on the flanks)
  const offR = rng.range(N * 0.12, N * 0.2);
  const off = sea && !four ? N * 0.34 : offR;
  canonFields.push({ x: mid.x + Math.cos(perp) * off, y: mid.y + Math.sin(perp) * off, r: rng.range(3.6, 4.4), gems: false });
  // a third field a bit further out, behind the base flank
  const ang3 = toward + Math.PI + rng.range(-0.5, 0.5) * 2;
  canonFields.push({ x: s0.x + Math.cos(ang3) * 9 + (four ? 0 : 0), y: s0.y + Math.sin(ang3) * 9, r: rng.range(3.0, 3.6), gems: false });
  if (four) canonFields.push({ x: (s0.x + N / 2) / 2 + (sea ? -5 : 3), y: (s0.y + N / 2) / 2 + (sea ? -5 : -3), r: 3.6, gems: false });
  // gem field near the centre (symmetric images overlap into one rich field)
  const gx = N / 2 + (four ? 0 : rng.range(-3, 3)), gy = N / 2 + (four ? 0 : rng.range(-3, 3));
  if (!sea) canonFields.push({ x: gx, y: gy, r: 2.3, gems: true });
  // sea maps: gems on the flanks (2 players) or at the edge midpoints between neighbours (4 players)
  else if (!four) canonFields.push({ x: N / 2 + Math.cos(perp) * N * 0.25, y: N / 2 + Math.sin(perp) * N * 0.25, r: 2.3, gems: true });
  else if (opts.players === 4) canonFields.push({ x: N / 2, y: m + 3.5, r: 2.3, gems: true }, { x: m + 3.5, y: N / 2, r: 2.3, gems: true });

  const fields: Field[] = [];
  for (const f of canonFields) for (const [x, y] of images(f.x, f.y)) fields.push({ ...f, x, y });
  if (four && opts.players === 3) {
    // nobody starts in the fourth corner: its ore would be a free bonus for the two neighbouring players
    const nearest = (x: number, y: number) => {
      let bi = 0, bd = Infinity;
      allCorners.forEach((c, i) => { const d = Math.hypot(x - c.x, y - c.y); if (d < bd) { bd = d; bi = i; } });
      return bi;
    };
    for (let i = fields.length - 1; i >= 0; i--) if (!fields[i].gems && nearest(fields[i].x, fields[i].y) === 3) fields.splice(i, 1);
  }

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = map.idx(x, y);
      const t = map.terrain[i];
      if (t === T.Water || t === T.Rock) continue;
      const [cx, cy] = canon(x, y);
      let best = 0, gem = false;
      for (const f of fields) {
        const d = Math.hypot(x + 0.5 - f.x, y + 0.5 - f.y);
        const wob = (noise.value(cx * 0.5 + 77, cy * 0.5 + 33) - 0.5) * 1.6;
        const r = f.r + wob;
        if (d < r) {
          const v = Math.pow(1 - d / r, 0.6) * (0.75 + 0.25 * hash2(cx, cy, opts.seed + 5));
          if (v > best) { best = v; gem = f.gems; }
        }
      }
      if (best > 0.06) {
        const bails = Math.max(2, Math.round((0.35 + best * 0.75) * ORE_MAX * (0.75 + opts.ore * 0.4)));
        map.ore[i] = Math.min(ORE_MAX, bails);
        map.gems[i] = gem ? 1 : 0;
        map.oreField[i] = gem ? 2 : 1;
        if (map.terrain[i] === T.Sand) map.terrain[i] = T.Clear;
      }
    }
  }

  // ---- trees ----------------------------------------------------------------
  if (opts.trees > 0) {
    const forestT = 0.72 - opts.trees * 0.14;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const i = map.idx(x, y);
        const t = map.terrain[i];
        if (t === T.Water || t === T.Rock || map.ore[i] > 0) continue;
        const [cx, cy] = canon(x, y);
        if (distStart(cx + 0.5, cy + 0.5) < baseR + 2) continue;
        const tf = noise.fbm(cx * 0.06 + 200, cy * 0.06 + 200, 3);
        const h = hash2(cx, cy, opts.seed + 99);
        const inForest = tf > forestT && h < 0.78;
        const lone = h < 0.012 * (0.5 + opts.trees);
        if (inForest || lone) {
          // keep a little clearance around ore fields so harvesters can reach them
          let nearOre = false;
          for (let dy = -1; dy <= 1 && !nearOre; dy++) for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (map.inBounds(nx, ny) && map.ore[map.idx(nx, ny)] > 0) { nearOre = true; break; }
          }
          if (!nearOre) map.tree[i] = 1 + Math.floor(hash2(cx, cy, opts.seed + 7) * 4);
        }
      }
    }
  }
  // re-open the corridors through forests
  for (const [ax, ay, bx, by] of routes) {
    {
      const A = { x: ax, y: ay }, B = { x: bx, y: by };
      const steps = Math.ceil(Math.hypot(B.x - A.x, B.y - A.y) * 2);
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const wig = (noise.value(t * 4 + 11, 3.3) - 0.5) * wigAmp;
        const nx = -(B.y - A.y), ny = B.x - A.x, nl = Math.hypot(nx, ny) || 1;
        const px = A.x + (B.x - A.x) * t + (nx / nl) * wig, py = A.y + (B.y - A.y) * t + (ny / nl) * wig;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          for (const [cx, cy] of cellImages(px + dx, py + dy)) {
            if (map.inBounds(cx, cy)) map.tree[map.idx(cx, cy)] = 0;
          }
        }
      }
    }
  }

  // ---- remove ore / trees in unreachable pockets ----------------------------
  const reach = floodReach(map, Math.floor(starts[0].x), Math.floor(starts[0].y));
  for (let i = 0; i < N * N; i++) {
    if (!reach[i] && map.ore[i] > 0) {
      // allow ore at the edge of forests (harvester reaches from neighbour) – only clear if fully enclosed
      map.ore[i] = 0;
      map.gems[i] = 0;
      map.oreField[i] = 0;
    }
  }
  for (let i = 0; i < N * N; i++) if (map.oreField[i]) map.oreFieldCells.push(i);

  // ---- vertex heights ---------------------------------------------------------
  const W = N + 1;
  const cellAt = (x: number, y: number) => map.terrain[map.idx(Math.min(N - 1, Math.max(0, x)), Math.min(N - 1, Math.max(0, y)))];
  for (let vy = 0; vy <= N; vy++) {
    for (let vx = 0; vx <= N; vx++) {
      const [cx, cy] = canonV(vx, vy);
      let h = (noise.fbm(cx * 0.04, cy * 0.04, 4) - 0.5) * 0.55 + (noise.fbm(cx * 0.25 + 9, cy * 0.25 + 9, 2) - 0.5) * 0.08;
      // rock hills: fraction of surrounding cells that are rock
      let rock = 0, water = 0, dw = 0, dl = 0;
      for (let dy = -1; dy <= 0; dy++) for (let dx = -1; dx <= 0; dx++) {
        const t = cellAt(vx + dx, vy + dy);
        if (t === T.Rock) rock++;
        if (t === T.Water) water++;
        const ci = map.idx(Math.min(N - 1, Math.max(0, vx + dx)), Math.min(N - 1, Math.max(0, vy + dy)));
        dw += distWater[ci];
        dl += distLand[ci];
      }
      dw /= 4;
      dl /= 4;
      if (rock > 0) {
        const rn = noise.fbm(cx * 0.3 + 40, cy * 0.3 + 40, 3);
        h += (rock / 4) * (0.7 + rn * 1.6);
      }
      if (water > 0) {
        const depth = Math.min(dl, 4);
        h = WATER_LEVEL - 0.08 - (water / 4) * (0.12 + depth * 0.16);
      } else if (dw < 4) {
        // shore slope down to the waterline
        h = WATER_LEVEL + 0.1 + (h - WATER_LEVEL - 0.1) * smooth(0.5, 4, dw) * 1;
        if (h < WATER_LEVEL + 0.05) h = WATER_LEVEL + 0.05;
      }
      // flatten bases
      const ds = distStart(cx, cy);
      if (!(sea && water > 0)) h = h * (1 - smooth(baseR + 4, baseR - 1, ds) * 0.85);
      map.heights[vy * W + vx] = h;
    }
  }

  // (sea maps keep their water open for naval play unless bridges are asked for)
  if (opts.bridges ?? !sea) addBridgesToMap(map);
  return map;
}

/** Multi-source BFS distance (in cells) from cells matching `src`. */
function bfsDistance(map: GameMap, src: (i: number) => boolean): Float32Array {
  const n = map.w * map.h;
  const d = new Float32Array(n).fill(1e9);
  const q = new Int32Array(n);
  let qh = 0, qt = 0;
  for (let i = 0; i < n; i++) if (src(i)) { d[i] = 0; q[qt++] = i; }
  while (qh < qt) {
    const i = q[qh++];
    const x = i % map.w, y = (i / map.w) | 0;
    const nd = d[i] + 1;
    if (x > 0 && d[i - 1] > nd) { d[i - 1] = nd; q[qt++] = i - 1; }
    if (x < map.w - 1 && d[i + 1] > nd) { d[i + 1] = nd; q[qt++] = i + 1; }
    if (y > 0 && d[i - map.w] > nd) { d[i - map.w] = nd; q[qt++] = i - map.w; }
    if (y < map.h - 1 && d[i + map.w] > nd) { d[i + map.w] = nd; q[qt++] = i + map.w; }
  }
  return d;
}

/** Cells reachable on foot from (sx, sy); ore cells count as reachable if adjacent to a reachable cell. */
export function floodReach(map: GameMap, sx: number, sy: number): Uint8Array {
  const n = map.w * map.h;
  const seen = new Uint8Array(n);
  const q = new Int32Array(n);
  let qh = 0, qt = 0;
  const s = map.idx(sx, sy);
  seen[s] = 1;
  q[qt++] = s;
  while (qh < qt) {
    const i = q[qh++];
    const x = i % map.w, y = (i / map.w) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h) continue;
      const j = ny * map.w + nx;
      if (seen[j]) continue;
      if (!map.terrainPassable(j)) continue;
      seen[j] = 1;
      q[qt++] = j;
    }
  }
  return seen;
}
