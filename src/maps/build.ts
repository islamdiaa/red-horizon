/**
 * Builds a fully valid GameMap from a curated MapDef: terrain, trees, ore fields (+ oreFieldCells),
 * shore sand, fords, bridges (map.bridges), vertex heights and start positions.
 * Deterministic (seeded noise only), so a save or replay can rebuild the identical map from its id.
 */
import { Noise2D, hash2 } from '../core/rng';
import { GameMap, ORE_MAX, T, WATER_LEVEL, type MapBridge } from '../sim/map';
import type { Feature, MapDef, Pt, Shape } from './format';

/** One element of a map's symmetry group: forward / inverse point maps (continuous coordinates). */
interface Xf {
  f(x: number, y: number): Pt;
  inv(x: number, y: number): Pt;
  /** The transform turns x-axis bridges into y-axis bridges. */
  swap: boolean;
}

export function symmetryGroup(def: MapDef): Xf[] {
  const N = def.size;
  const id: Xf = { f: (x, y) => [x, y], inv: (x, y) => [x, y], swap: false };
  const r180: Xf = { f: (x, y) => [N - x, N - y], inv: (x, y) => [N - x, N - y], swap: false };
  switch (def.symmetry) {
    case 'rot2':
      return [id, r180];
    case 'mirror4':
      return [id,
        { f: (x, y) => [N - x, y], inv: (x, y) => [N - x, y], swap: false },
        { f: (x, y) => [x, N - y], inv: (x, y) => [x, N - y], swap: false },
        r180];
    case 'rot4':
      return [id,
        { f: (x, y) => [N - y, x], inv: (x, y) => [y, N - x], swap: true },
        r180,
        { f: (x, y) => [y, N - x], inv: (x, y) => [N - y, x], swap: true }];
    // editor symmetries: none (every start authored) and the 2-player mirrors
    case 'none':
      return [id];
    case 'mirrorX':
      return [id, { f: (x, y) => [N - x, y], inv: (x, y) => [N - x, y], swap: false }];
    case 'mirrorY':
      return [id, { f: (x, y) => [x, N - y], inv: (x, y) => [x, N - y], swap: false }];
    case 'mirrorD':
      return [id, { f: (x, y) => [y, x], inv: (x, y) => [y, x], swap: true }];
    case 'rot3': {
      const [cx, cy] = def.center ?? [N / 2, N / 2];
      const rot = (a: number): Xf => {
        const c = Math.cos(a), s = Math.sin(a);
        return {
          f: (x, y) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c],
          inv: (x, y) => [cx + (x - cx) * c + (y - cy) * s, cy - (x - cx) * s + (y - cy) * c],
          swap: false,
        };
      };
      return [id, rot((2 * Math.PI) / 3), rot((4 * Math.PI) / 3)];
    }
  }
}

// ---------------------------------------------------------------------------
// Shapes: signed distance (negative inside) and bounds
// ---------------------------------------------------------------------------
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - ax - dx * t, py - ay - dy * t);
}

function sdf(s: Shape, x: number, y: number): number {
  if ('circle' in s) return Math.hypot(x - s.circle[0], y - s.circle[1]) - s.r;
  if ('ellipse' in s) {
    const a = ((s.angle ?? 0) * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a);
    const dx = x - s.ellipse[0], dy = y - s.ellipse[1];
    const lx = dx * c + dy * sn, ly = -dx * sn + dy * c;
    return (Math.hypot(lx / s.rx, ly / s.ry) - 1) * Math.min(s.rx, s.ry);
  }
  if ('path' in s) {
    let d = Infinity;
    const p = s.path;
    if (p.length === 1) d = Math.hypot(x - p[0][0], y - p[0][1]);
    for (let i = 0; i + 1 < p.length; i++) d = Math.min(d, segDist(x, y, p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]));
    return d - s.w / 2;
  }
  if ('rect' in s) {
    const [x0, y0, x1, y1] = s.rect;
    return Math.max(x0 - x, x - x1, y0 - y, y - y1);
  }
  // polygon: distance to the outline, negative inside (even-odd rule)
  const p = s.poly;
  let d = Infinity, inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i], [xj, yj] = p[j];
    d = Math.min(d, segDist(x, y, xi, yi, xj, yj));
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside ? -d : d;
}

function bounds(s: Shape): [number, number, number, number] {
  if ('circle' in s) return [s.circle[0] - s.r, s.circle[1] - s.r, s.circle[0] + s.r, s.circle[1] + s.r];
  if ('ellipse' in s) {
    const r = Math.max(s.rx, s.ry);
    return [s.ellipse[0] - r, s.ellipse[1] - r, s.ellipse[0] + r, s.ellipse[1] + r];
  }
  if ('rect' in s) return s.rect;
  const pts = 'path' in s ? s.path : s.poly;
  const pad = 'path' in s ? s.w / 2 : 0;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Multi-source BFS distance (4-neighbour, in cells) from cells matching `src`. */
function bfsDistance(w: number, h: number, src: (i: number) => boolean): Float32Array {
  const n = w * h;
  const d = new Float32Array(n).fill(1e9);
  const q = new Int32Array(n);
  let qh = 0, qt = 0;
  for (let i = 0; i < n; i++) if (src(i)) { d[i] = 0; q[qt++] = i; }
  while (qh < qt) {
    const i = q[qh++];
    const x = i % w, y = (i / w) | 0, nd = d[i] + 1;
    if (x > 0 && d[i - 1] > nd) { d[i - 1] = nd; q[qt++] = i - 1; }
    if (x < w - 1 && d[i + 1] > nd) { d[i + 1] = nd; q[qt++] = i + 1; }
    if (y > 0 && d[i - w] > nd) { d[i - w] = nd; q[qt++] = i - w; }
    if (y < h - 1 && d[i + w] > nd) { d[i + w] = nd; q[qt++] = i + w; }
  }
  return d;
}

/** Cells under a map bridge (a Set of cell indices). */
export function bridgeCells(map: GameMap): Set<number> {
  const s = new Set<number>();
  for (const b of map.bridges) for (const [x, y] of b.cells) s.add(map.idx(x, y));
  return s;
}

/**
 * Ground units' reach from a cell, counting intact map bridges as passable (8-neighbour, no corner
 * cutting past blocked cells). Ore cells are passable (harvesters drive onto them).
 */
export function landReach(map: GameMap, sx: number, sy: number, bridges = bridgeCells(map)): Uint8Array {
  const n = map.w * map.h;
  const ok = (i: number) => map.terrainPassable(i) || bridges.has(i);
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
      if (seen[j] || !ok(j)) continue;
      if (dx && dy && !ok(y * map.w + nx) && !ok(ny * map.w + x)) continue;
      seen[j] = 1;
      q[qt++] = j;
    }
  }
  return seen;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------
const GROUND: Record<NonNullable<MapDef['ground']>, number> = { clear: T.Clear, water: T.Water, dirt: T.Dirt, sand: T.Sand };

export function buildMap(def: MapDef): GameMap {
  const N = def.size;
  const map = new GameMap(N, N);
  map.seed = def.seed;
  map.climate = def.climate;
  const G = symmetryGroup(def);
  const noise = new Noise2D(def.seed);
  const ford = new Uint8Array(N * N);
  map.terrain.fill(GROUND[def.ground ?? 'clear']);

  // ---- start positions (cell centres) ------------------------------------------
  const starts: { x: number; y: number }[] = [];
  for (const s of def.starts) for (const g of G) {
    const [x, y] = g.f(s[0], s[1]);
    starts.push({ x: Math.floor(x) + 0.5, y: Math.floor(y) + 0.5 });
  }
  map.startPositions = starts;

  // ---- features ------------------------------------------------------------------
  def.features.forEach((ft, k) => paintFeature(map, ft, k, ft.once ? [G[0]] : G, noise, def.seed, ford));

  // ---- base areas: open ground around every start ------------------------------------
  const R = def.clearRadius ?? 9.5;
  for (const s of starts) {
    for (let y = Math.floor(s.y - R); y <= s.y + R; y++) for (let x = Math.floor(s.x - R); x <= s.x + R; x++) {
      if (!map.inBounds(x, y)) continue;
      const d = Math.hypot(x + 0.5 - s.x, y + 0.5 - s.y);
      if (d > R) continue;
      const i = map.idx(x, y);
      map.tree[i] = 0;
      ford[i] = 0;
      if (map.terrain[i] === T.Water || map.terrain[i] === T.Rock) map.terrain[i] = T.Clear;
      if (d <= 6.5) { map.terrain[i] = T.Clear; map.ore[i] = 0; map.gems[i] = 0; map.oreField[i] = 0; }
    }
  }

  // ---- shores: sand along the waterline ------------------------------------------------
  const distWater = bfsDistance(N, N, (i) => map.terrain[i] === T.Water);
  for (let i = 0; i < N * N; i++) {
    const t = map.terrain[i];
    if ((t === T.Clear || t === T.Dirt) && distWater[i] <= 2 && !map.ore[i]) map.terrain[i] = T.Sand;
  }
  // harvesters need a little room around ore
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = map.idx(x, y);
    if (!map.tree[i]) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (map.inBounds(nx, ny) && map.ore[map.idx(nx, ny)]) map.tree[i] = 0;
    }
  }

  // ---- bridges ----------------------------------------------------------------------------
  const seenBridge = new Set<string>();
  for (const b of def.bridges ?? []) {
    for (const g of G) {
      const [fx, fy] = g.f(Math.floor(b.at[0]) + 0.5, Math.floor(b.at[1]) + 0.5);
      const axis = g.swap ? (b.axis === 'x' ? 'y' : 'x') : b.axis;
      const br = traceBridge(map, Math.floor(fx), Math.floor(fy), axis);
      if (!br) continue;
      const key = br.cells.map(([x, y]) => x + ',' + y).join(';');
      if (seenBridge.has(key)) continue;
      seenBridge.add(key);
      map.bridges.push(br);
    }
  }

  // ---- ore nobody can reach on foot is removed (as the generator does) ---------------------
  const bridges = bridgeCells(map);
  const reach = new Uint8Array(N * N);
  for (const s of starts) {
    const r = landReach(map, Math.floor(s.x), Math.floor(s.y), bridges);
    for (let i = 0; i < N * N; i++) reach[i] |= r[i];
  }
  for (let i = 0; i < N * N; i++) if (map.ore[i] && !reach[i]) { map.ore[i] = 0; map.gems[i] = 0; map.oreField[i] = 0; }
  // rotations by 120° don't map grid cells onto grid cells: even out the rasterisation error
  if (def.symmetry === 'rot3') equaliseOre(map);
  for (let i = 0; i < N * N; i++) if (map.oreField[i]) map.oreFieldCells.push(i);

  buildHeights(map, def, G, noise, starts, ford);
  return map;
}

/** Ore value a player can reach first: gems count double (as in RA, 50 vs 25 credits a bail). */
export const oreValue = (map: GameMap, i: number) => map.ore[i] * (map.gems[i] ? 2 : 1);

/** Index of the start nearest to cell i, or -1 on a tie (shared ore). */
export function nearestStart(map: GameMap, i: number): number {
  const x = (i % map.w) + 0.5, y = Math.floor(i / map.w) + 0.5;
  let best = -1, bd = Infinity, tie = false;
  map.startPositions.forEach((s, k) => {
    const d = Math.hypot(s.x - x, s.y - y);
    if (d < bd - 1e-6) { bd = d; best = k; tie = false; } else if (Math.abs(d - bd) <= 1e-6) tie = true;
  });
  return tie ? -1 : best;
}

/** Trim the richer players' ore (largest piles first) down to the poorest player's total. */
function equaliseOre(map: GameMap) {
  const n = map.startPositions.length;
  const cells: number[][] = Array.from({ length: n }, () => []);
  const total = new Array(n).fill(0);
  for (let i = 0; i < map.w * map.h; i++) {
    if (!map.ore[i]) continue;
    const k = nearestStart(map, i);
    if (k < 0) continue;
    cells[k].push(i);
    total[k] += oreValue(map, i);
  }
  const target = Math.min(...total);
  for (let k = 0; k < n; k++) {
    let excess = total[k] - target;
    const list = cells[k];
    while (excess > 0) {
      list.sort((a, b) => map.ore[b] - map.ore[a] || a - b);
      let changed = false;
      for (const i of list) {
        if (excess <= 0) break;
        if (map.ore[i] <= 2) continue;
        const v = map.gems[i] ? 2 : 1;
        if (v > excess && excess < 2) { if (!map.gems[i]) { map.ore[i]--; excess -= 1; changed = true; } continue; }
        map.ore[i]--;
        excess -= v;
        changed = true;
      }
      if (!changed) break;
    }
  }
}

function paintFeature(map: GameMap, ft: Feature, k: number, G: Xf[], noise: Noise2D, seed: number, ford: Uint8Array) {
  if (ft.t === 'raise' || ft.t === 'lower') return; // height brushes act on vertices (buildHeights)
  const N = map.w;
  const wob = ft.wobble ?? 1.2, freq = ft.freq ?? 0.22;
  const [bx0, by0, bx1, by1] = bounds(ft);
  const pad = wob + 1;
  const salt = k * 31.7;
  for (const g of G) {
    // bounding box of this copy
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [cx, cy] of [[bx0 - pad, by0 - pad], [bx1 + pad, by0 - pad], [bx0 - pad, by1 + pad], [bx1 + pad, by1 + pad]] as Pt[]) {
      const [x, y] = g.f(cx, cy);
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(N - 1, Math.ceil(y1)); y++) {
      for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(N - 1, Math.ceil(x1)); x++) {
        const [px, py] = g.inv(x + 0.5, y + 0.5);
        let d = sdf(ft, px, py);
        if (wob > 0) d += wob * (noise.fbm(px * freq + salt, py * freq - salt, 2) - 0.5) * 2.4;
        if (d >= 0) continue;
        applyFeature(map, ft, map.idx(x, y), -d, px, py, seed + k, ford);
      }
    }
  }
}

/** Per-point hash in the authored frame (identical for every exact symmetric copy). */
const phash = (px: number, py: number, salt: number) => hash2(Math.floor(px * 8 + 1e4), Math.floor(py * 8 + 1e4), salt);

function applyFeature(map: GameMap, ft: Feature, i: number, depth: number, px: number, py: number, salt: number, ford: Uint8Array) {
  const clearOre = () => { map.ore[i] = 0; map.gems[i] = 0; map.oreField[i] = 0; };
  switch (ft.t) {
    case 'water':
    case 'rock':
      map.terrain[i] = ft.t === 'water' ? T.Water : T.Rock;
      map.tree[i] = 0;
      ford[i] = 0;
      clearOre();
      break;
    case 'clear':
    case 'sand':
    case 'dirt':
      map.terrain[i] = ft.t === 'clear' ? T.Clear : ft.t === 'sand' ? T.Sand : T.Dirt;
      map.tree[i] = 0;
      ford[i] = 0;
      break;
    case 'deforest': // editor eraser brushes
      map.tree[i] = 0;
      break;
    case 'noore':
      clearOre();
      break;
    case 'ford':
      map.terrain[i] = T.Sand;
      map.tree[i] = 0;
      ford[i] = 1;
      clearOre();
      break;
    case 'forest': {
      const t = map.terrain[i];
      if (t === T.Water || t === T.Rock || map.ore[i] || ford[i]) break;
      if (phash(px, py, salt) < (ft.density ?? 0.72)) map.tree[i] = 1 + Math.floor(phash(px, py, salt + 7) * 4);
      break;
    }
    case 'ore':
    case 'gems': {
      const t = map.terrain[i];
      if (t === T.Water || t === T.Rock || ford[i]) break;
      const v = (0.42 + 0.58 * Math.min(1, depth / 2.4)) * ORE_MAX * (ft.rich ?? 1) + (phash(px, py, salt) - 0.5) * 1.6;
      const bails = Math.max(2, Math.min(ORE_MAX, Math.round(v)));
      if (bails <= map.ore[i]) break;
      map.ore[i] = bails;
      map.gems[i] = ft.t === 'gems' ? 1 : 0;
      map.oreField[i] = ft.t === 'gems' ? 2 : 1;
      map.tree[i] = 0;
      if (t === T.Sand) map.terrain[i] = T.Clear;
      break;
    }
  }
}

/** Water cells crossed by a straight bridge through (x, y) along `axis`, with land at both ends. */
export function traceBridge(map: GameMap, x: number, y: number, axis: 'x' | 'y'): MapBridge | null {
  if (!map.inBounds(x, y) || map.terrain[map.idx(x, y)] !== T.Water) return null;
  const dx = axis === 'x' ? 1 : 0, dy = axis === 'y' ? 1 : 0;
  let a = 0, b = 0;
  const water = (k: number) => {
    const cx = x + dx * k, cy = y + dy * k;
    return map.inBounds(cx, cy) && map.terrain[map.idx(cx, cy)] === T.Water;
  };
  while (water(a - 1)) a--;
  while (water(b + 1)) b++;
  const land = (k: number) => {
    const cx = x + dx * k, cy = y + dy * k;
    return map.inBounds(cx, cy) && map.terrainPassable(map.idx(cx, cy));
  };
  if (!land(a - 1) || !land(b + 1)) return null;
  const cells: [number, number][] = [];
  for (let k = a; k <= b; k++) cells.push([x + dx * k, y + dy * k]);
  return { cells, axis };
}

function buildHeights(map: GameMap, def: MapDef, G: Xf[], noise: Noise2D, starts: { x: number; y: number }[], ford: Uint8Array) {
  const N = map.w, W = N + 1;
  const distWater = bfsDistance(N, N, (i) => map.terrain[i] === T.Water);
  const distLand = bfsDistance(N, N, (i) => map.terrain[i] !== T.Water);
  const amp = G.length > 1 ? 1.35 : 1;
  /** Noise averaged over the symmetry group, so relief is symmetric too. */
  const sym = (fn: (x: number, y: number) => number, vx: number, vy: number) => {
    let s = 0;
    for (const g of G) { const [x, y] = g.f(vx, vy); s += fn(x, y); }
    return (s / G.length - 0.5) * amp + 0.5;
  };
  const relief = def.relief ?? 1;
  const bump = heightBrushes(def, G, N);
  const cell = (x: number, y: number) => map.idx(Math.min(N - 1, Math.max(0, x)), Math.min(N - 1, Math.max(0, y)));
  for (let vy = 0; vy <= N; vy++) {
    for (let vx = 0; vx <= N; vx++) {
      let h = (sym((x, y) => noise.fbm(x * 0.04, y * 0.04, 4), vx, vy) - 0.5) * 0.55
        + (sym((x, y) => noise.fbm(x * 0.25 + 9, y * 0.25 + 9, 2), vx, vy) - 0.5) * 0.08;
      let rock = 0, water = 0, dw = 0, dl = 0, fd = 0;
      for (let dy = -1; dy <= 0; dy++) for (let dx = -1; dx <= 0; dx++) {
        const ci = cell(vx + dx, vy + dy);
        const t = map.terrain[ci];
        if (t === T.Rock) rock++;
        if (t === T.Water) water++;
        fd += ford[ci];
        dw += distWater[ci];
        dl += distLand[ci];
      }
      dw /= 4;
      dl /= 4;
      if (rock > 0) h += (rock / 4) * (0.7 + sym((x, y) => noise.fbm(x * 0.3 + 40, y * 0.3 + 40, 3), vx, vy) * 1.6) * relief;
      if (water > 0) {
        h = WATER_LEVEL - 0.08 - (water / 4) * (0.12 + Math.min(dl, 4) * 0.16);
      } else if (fd > 0) {
        h = WATER_LEVEL + 0.03; // a sandbar just above the waterline
      } else if (dw < 4) {
        h = WATER_LEVEL + 0.1 + (h - WATER_LEVEL - 0.1) * smooth(0.5, 4, dw);
        if (h < WATER_LEVEL + 0.05) h = WATER_LEVEL + 0.05;
      }
      // raise / lower brushes (dry land only, never below the waterline)
      if (bump && water === 0 && fd === 0) h = Math.max(WATER_LEVEL + 0.05, h + bump[vy * W + vx]);
      // flatten base areas (never lifting the sea floor above the waterline)
      if (water === 0) {
        let ds = Infinity;
        for (const s of starts) ds = Math.min(ds, Math.hypot(vx - s.x, vy - s.y));
        h *= 1 - smooth(13, 8, ds) * 0.85;
      }
      map.heights[vy * W + vx] = h;
    }
  }
}

/** How deep inside a shape its centre lies (cells): the radius of a raise / lower dome. */
function innerDepth(s: Shape): number {
  if ('circle' in s) return s.r;
  if ('ellipse' in s) return Math.min(s.rx, s.ry);
  if ('path' in s) return s.w / 2;
  if ('rect' in s) return Math.min(s.rect[2] - s.rect[0], s.rect[3] - s.rect[1]) / 2;
  return 3;
}

/**
 * Per-vertex height change from the editor's raise / lower brushes: a smooth dome per feature.
 * Symmetric copies of one feature take the maximum (not the sum), so a dab on a symmetry axis is not
 * doubled; the result is symmetric because the maximum over a symmetry orbit is invariant.
 */
function heightBrushes(def: MapDef, G: Xf[], N: number): Float32Array | null {
  const fts = def.features.filter((f) => f.t === 'raise' || f.t === 'lower');
  if (!fts.length) return null;
  const W = N + 1;
  const out = new Float32Array(W * W);
  const tmp = new Float32Array(W * W);
  const touched: number[] = [];
  for (const ft of fts) {
    const amt = (ft.amount ?? 0.6) * (ft.t === 'lower' ? -1 : 1);
    const inner = Math.max(0.5, innerDepth(ft));
    const [bx0, by0, bx1, by1] = bounds(ft);
    for (const g of ft.once ? [G[0]] : G) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [cx, cy] of [[bx0 - 1, by0 - 1], [bx1 + 1, by0 - 1], [bx0 - 1, by1 + 1], [bx1 + 1, by1 + 1]] as Pt[]) {
        const [x, y] = g.f(cx, cy);
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
      for (let vy = Math.max(0, Math.floor(y0)); vy <= Math.min(N, Math.ceil(y1)); vy++) {
        for (let vx = Math.max(0, Math.floor(x0)); vx <= Math.min(N, Math.ceil(x1)); vx++) {
          const [px, py] = g.inv(vx, vy);
          const d = sdf(ft, px, py);
          if (d >= 0) continue;
          const t = smooth(0, inner, -d);
          const k = vy * W + vx;
          if (!tmp[k]) touched.push(k);
          if (t > tmp[k]) tmp[k] = t;
        }
      }
    }
    for (const k of touched) { out[k] += amt * tmp[k]; tmp[k] = 0; }
    touched.length = 0;
  }
  return out;
}
