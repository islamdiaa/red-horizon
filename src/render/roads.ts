import { hash2 } from '../core/rng';
import { T, type GameMap } from '../sim/map';

/**
 * Procedural road network (render only): deterministic from the map (terrain, heights, trees, ore, bridges, start
 * positions, seed); never reads or writes simulation state beyond the static map.
 *
 * - Main roads link the start positions (a minimum spanning tree plus one loop on 3+ player maps) and cross
 *   rivers on the map's bridges.
 * - Dirt tracks run from every base to its nearest ore fields and from outlying ore fields to the main roads.
 * Routes are A* paths over a cost grid (rock and open water are impassable except the bridge cells; forests,
 * ore, slopes and the map border are expensive; existing roads are cheap, so later routes merge into earlier
 * ones), simplified and Chaikin-smoothed into polylines, then rasterised into a mask the terrain shader reads.
 */

export type RoadKind = 'main' | 'track';

export interface RoadSegment {
  kind: RoadKind;
  /** Centre line in map cells (x, y), smoothed. */
  points: [number, number][];
}

export interface RoadNetwork {
  segments: RoadSegment[];
  /** Mask texels per map cell. */
  res: number;
  /** RGBA, (w * res) x (h * res), row-major from the north-west: r = 1 - distance to the centre line / ROAD_REACH,
   *  g = main road (255) or track (110), b = per-road wear variation, a = 255 under a road. */
  mask: Uint8Array;
  /** Cells whose centre is within a road's core (ground clutter is cleared there). */
  cells: Uint8Array;
  /** FNV-1a of the mask and segments (tests, cache keys). */
  hash: number;
}

/** Mask texels per map cell (the same as the base-dressing mask). */
export const ROAD_RES = 4;
/** Distance from the centre line covered by the mask (cells): half width + shoulder. */
export const ROAD_REACH = 1.7;
/** Half widths (cells). */
export const ROAD_HALF = { main: 0.62, track: 0.38 } as const;

interface Node { x: number; y: number; kind: 'start' | 'ore' }

/** Build the road network of a map (pure and deterministic; a few milliseconds on a 128 map). */
export function buildRoads(map: GameMap): RoadNetwork {
  const W = map.w, H = map.h, N = W * H;
  const seed = map.seed | 0;
  // ---- cost grid ------------------------------------------------------------------------------------------
  const bridge = new Uint8Array(N);
  for (const b of map.bridges ?? []) for (const [x, y] of b.cells) if (x >= 0 && y >= 0 && x < W && y < H) bridge[y * W + x] = 1;
  const cost = new Float32Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const t = map.terrain[i];
    if (bridge[i]) { cost[i] = 1; continue; }
    if (t === T.Water || t === T.Rock) { cost[i] = Infinity; continue; }
    let c = 1;
    if (map.tree[i]) c += 14;
    if (map.oreField[i] || map.ore[i]) c += 5;
    if (t === T.Sand) c += 0.3;
    // slope: the steepest rise to a neighbouring corner
    const h = map.heightAt(x + 0.5, y + 0.5);
    let s = 0;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) s = Math.max(s, Math.abs(map.heightAt(x + 0.5 + dx, y + 0.5 + dy) - h));
    c += s * 18;
    // near water or rock: a little dearer (roads keep off the banks and the cliff foot)
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const qx = x + dx, qy = y + dy;
      if (qx < 0 || qy < 0 || qx >= W || qy >= H) continue;
      const q = map.terrain[qy * W + qx];
      if ((q === T.Water && !bridge[qy * W + qx]) || q === T.Rock) { c += 1.5; break; }
    }
    const edge = Math.min(x, y, W - 1 - x, H - 1 - y);
    if (edge < 2) c += (2 - edge) * 3;
    // gentle noise so roads meander instead of running dead straight
    c += hash2(x >> 1, y >> 1, seed + 6151) * 0.6;
    cost[i] = c;
  }
  const passable = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && cost[y * W + x] < Infinity;

  // ---- nodes ----------------------------------------------------------------------------------------------
  const starts: Node[] = (map.startPositions ?? [])
    .map((s) => snap(s.x, s.y))
    .filter((p): p is [number, number] => !!p)
    .map(([x, y]) => ({ x, y, kind: 'start' as const }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const ores = oreFields(map).map(([x, y]) => snap(x, y)).filter((p): p is [number, number] => !!p).map(([x, y]) => ({ x, y, kind: 'ore' as const }));

  /** Nearest passable cell centre to (x, y) within a few cells. */
  function snap(x: number, y: number): [number, number] | null {
    const cx = Math.floor(x), cy = Math.floor(y);
    for (let r = 0; r <= 4; r++) {
      let best: [number, number] | null = null, bd = Infinity;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const qx = cx + dx, qy = cy + dy;
        if (!passable(qx, qy) || bridge[qy * W + qx]) continue;
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = [qx, qy]; }
      }
      if (best) return best;
    }
    return null;
  }

  // ---- routing --------------------------------------------------------------------------------------------
  const onRoad = new Uint8Array(N);
  const routes: { kind: RoadKind; cells: number[] }[] = [];
  const astar = makeAStar(W, H, cost, onRoad);

  const link = (a: Node, b: Node, kind: RoadKind) => {
    const path = astar(a.y * W + a.x, b.y * W + b.x);
    if (!path) return false;
    for (const c of path) onRoad[c] = kind === 'main' ? 2 : Math.max(onRoad[c], 1);
    routes.push({ kind, cells: path });
    return true;
  };

  // main roads: minimum spanning tree over the starts (Prim, Euclidean), plus one loop with 3+ starts
  if (starts.length >= 2) {
    const inTree = [0];
    const edges: [number, number][] = [];
    while (inTree.length < starts.length) {
      let best: [number, number] | null = null, bd = Infinity;
      for (const i of inTree) for (let j = 0; j < starts.length; j++) {
        if (inTree.includes(j)) continue;
        const d = Math.hypot(starts[i].x - starts[j].x, starts[i].y - starts[j].y);
        if (d < bd - 1e-9) { bd = d; best = [i, j]; }
      }
      if (!best) break;
      edges.push(best);
      inTree.push(best[1]);
    }
    if (starts.length >= 3) {
      // close the loop between the two tree leaves farthest apart along the tree
      let best: [number, number] | null = null, bd = -1;
      for (let i = 0; i < starts.length; i++) for (let j = i + 1; j < starts.length; j++) {
        if (edges.some(([a, b]) => (a === i && b === j) || (a === j && b === i))) continue;
        const d = Math.hypot(starts[i].x - starts[j].x, starts[i].y - starts[j].y);
        if (best === null || d < bd) { bd = d; best = [i, j]; }
      }
      if (best) edges.push(best);
    }
    for (const [i, j] of edges) link(starts[i], starts[j], 'main');
  }
  // dirt tracks: each base to its nearest ore fields (two on big maps)
  const linked = new Set<number>();
  for (const s of starts) {
    const near = ores.map((o, k) => ({ o, k, d: Math.hypot(o.x - s.x, o.y - s.y) }))
      .filter((e) => e.d > 3 && e.d < Math.max(W, H) * 0.45)
      .sort((p, q) => p.d - q.d || p.k - q.k)
      .slice(0, W >= 96 ? 2 : 1);
    for (const e of near) if (link(s, e.o, 'track')) linked.add(e.k);
  }
  // outlying ore fields: a track to the nearest road cell when there is one within reach
  ores.forEach((o, k) => {
    if (linked.has(k)) return;
    let best = -1, bd = Infinity;
    for (let i = 0; i < N; i++) {
      if (!onRoad[i]) continue;
      const d = Math.hypot((i % W) - o.x, ((i / W) | 0) - o.y);
      if (d < bd) { bd = d; best = i; }
    }
    if (best >= 0 && bd > 3 && bd < 18) link(o, { x: best % W, y: (best / W) | 0, kind: 'start' }, 'track');
  });

  /** An ore cell or right next to one. */
  const nearOre = (c: number) => {
    const x = c % W, y = (c / W) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const qx = x + dx, qy = y + dy;
      if (qx >= 0 && qy >= 0 && qx < W && qy < H && (map.oreField[qy * W + qx] || map.ore[qy * W + qx])) return true;
    }
    return false;
  };

  // ---- polylines --------------------------------------------------------------------------------------------
  const segments: RoadSegment[] = [];
  routes.forEach((r, k) => {
    let pts: [number, number][] = r.cells.map((c) => [(c % W) + 0.5, ((c / W) | 0) + 0.5]);
    // ore tracks end where the field begins (the harvesters churn the rest): run them towards the field, then cut
    if (r.kind === 'track') {
      let cells = r.cells;
      if (nearOre(cells[0]) && !nearOre(cells[cells.length - 1])) cells = cells.slice().reverse();
      let cut = cells.length;
      for (let i = 0; i < cells.length; i++) if (nearOre(cells[i])) { cut = i; break; }
      pts = cells.slice(0, Math.max(2, cut + 1)).map((c) => [(c % W) + 0.5, ((c / W) | 0) + 0.5]);
    }
    pts = simplify(pts, 0.6, (a, b) => clearLine(a, b, passable, bridge, W));
    for (let it = 0; it < 2; it++) pts = chaikin(pts);
    // a slight wander, deterministic per road
    pts = pts.map(([x, y], i) => {
      if (i === 0 || i === pts.length - 1) return [x, y];
      const n = (hash2(Math.round(x * 2), Math.round(y * 2), seed + 77 + k) - 0.5) * 0.18;
      return [x + n, y - n];
    });
    if (pts.length >= 2) segments.push({ kind: r.kind, points: pts.map(([x, y]) => [round3(x), round3(y)]) });
  });

  // World Conquest city streets (sim/mapgen-region.ts): main roads along the street grid
  for (const st of map.streets ?? []) if (st.length >= 2) segments.push({ kind: 'main', points: st.map(([x, y]) => [round3(x), round3(y)] as [number, number]) });
  const { mask, cells } = rasterize(map, segments, bridge);
  let h = 2166136261;
  for (let i = 0; i < mask.length; i++) h = Math.imul(h ^ mask[i], 16777619);
  for (const s of segments) for (const [x, y] of s.points) h = Math.imul(h ^ Math.round(x * 1000) ^ (Math.round(y * 1000) << 12), 16777619);
  return { segments, res: ROAD_RES, mask, cells, hash: h >>> 0 };
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** Ore field centroids (4-connected clusters of ore-field cells, cells), sorted for determinism. */
export function oreFields(map: GameMap): [number, number][] {
  const W = map.w, H = map.h;
  const seen = new Uint8Array(W * H);
  const out: [number, number][] = [];
  const stack: number[] = [];
  for (let i = 0; i < W * H; i++) {
    if (seen[i] || !(map.oreField[i] || map.ore[i])) continue;
    let sx = 0, sy = 0, n = 0;
    stack.push(i);
    seen[i] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      const x = c % W, y = (c / W) | 0;
      sx += x + 0.5; sy += y + 0.5; n++;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const qx = x + dx, qy = y + dy;
        if (qx < 0 || qy < 0 || qx >= W || qy >= H) continue;
        const q = qy * W + qx;
        if (!seen[q] && (map.oreField[q] || map.ore[q])) { seen[q] = 1; stack.push(q); }
      }
    }
    if (n >= 4) out.push([sx / n, sy / n]);
  }
  return out.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

/** 8-connected A* with a binary heap; road cells cost a third (routes merge). Ties broken by cell index. */
function makeAStar(W: number, H: number, cost: Float32Array, onRoad: Uint8Array) {
  const N = W * H;
  const g = new Float64Array(N);
  const from = new Int32Array(N);
  const closed = new Uint8Array(N);
  const heap: number[] = [];
  const f = new Float64Array(N);
  const less = (a: number, b: number) => f[a] < f[b] || (f[a] === f[b] && a < b);
  const push = (v: number) => {
    heap.push(v);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(heap[i], heap[p])) break;
      [heap[i], heap[p]] = [heap[p], heap[i]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < heap.length && less(heap[l], heap[m])) m = l;
        if (r < heap.length && less(heap[r], heap[m])) m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m], heap[i]];
        i = m;
      }
    }
    return top;
  };
  const step = (i: number) => (onRoad[i] ? cost[i] * 0.33 : cost[i]);
  return (s: number, t: number): number[] | null => {
    g.fill(Infinity);
    closed.fill(0);
    heap.length = 0;
    const tx = t % W, ty = (t / W) | 0;
    const hfun = (i: number) => {
      const dx = Math.abs((i % W) - tx), dy = Math.abs(((i / W) | 0) - ty);
      // weighted (not admissible: road cells cost a third): far fewer expansions, slightly straighter roads
      return (Math.max(dx, dy) + 0.4142 * Math.min(dx, dy)) * 0.9;
    };
    g[s] = 0;
    f[s] = hfun(s);
    from[s] = -1;
    push(s);
    while (heap.length) {
      const c = pop();
      if (closed[c]) continue;
      if (c === t) {
        const out: number[] = [];
        for (let v = t; v >= 0; v = from[v]) out.push(v);
        return out.reverse();
      }
      closed[c] = 1;
      const cx = c % W, cy = (c / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx;
        if (closed[n] || cost[n] === Infinity) continue;
        // no corner cutting past impassable cells
        if (dx && dy && (cost[cy * W + nx] === Infinity || cost[ny * W + cx] === Infinity)) continue;
        const ng = g[c] + (step(c) + step(n)) * 0.5 * (dx && dy ? 1.4142 : 1);
        if (ng < g[n]) {
          g[n] = ng;
          f[n] = ng + hfun(n);
          from[n] = c;
          push(n);
        }
      }
    }
    return null;
  };
}

/** Does the straight line a-b stay on passable cells (bridge cells only along their own axis is fine)? */
function clearLine(a: [number, number], b: [number, number], passable: (x: number, y: number) => boolean, _bridge: Uint8Array, _W: number): boolean {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(1, Math.ceil(L * 3));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
    // the road's width must fit too
    for (const [ox, oy] of [[0, 0], [0.35, 0], [-0.35, 0], [0, 0.35], [0, -0.35]]) if (!passable(Math.floor(x + ox), Math.floor(y + oy))) return false;
  }
  return true;
}

/** Ramer-Douglas-Peucker, keeping a point wherever dropping it would cut across impassable ground. */
function simplify(pts: [number, number][], eps: number, ok: (a: [number, number], b: [number, number]) => boolean): [number, number][] {
  if (pts.length <= 2) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const rec = (i0: number, i1: number) => {
    if (i1 <= i0 + 1) return;
    const [ax, ay] = pts[i0], [bx, by] = pts[i1];
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
    let worst = -1, wd = -1;
    for (let i = i0 + 1; i < i1; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L;
      if (d > wd) { wd = d; worst = i; }
    }
    if (wd > eps || !ok(pts[i0], pts[i1])) {
      keep[worst] = 1;
      rec(i0, worst);
      rec(worst, i1);
    }
  };
  rec(0, pts.length - 1);
  return pts.filter((_, i) => keep[i]);
}

/** One round of Chaikin corner cutting (end points kept). */
function chaikin(pts: [number, number][]): [number, number][] {
  if (pts.length < 3) return pts;
  const out: [number, number][] = [pts[0]];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    out.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Distance field of the centre lines into the RGBA mask (see RoadNetwork.mask). */
function rasterize(map: GameMap, segments: RoadSegment[], bridge: Uint8Array): { mask: Uint8Array; cells: Uint8Array } {
  const R = ROAD_RES, W = map.w * R, H = map.h * R;
  const mask = new Uint8Array(W * H * 4);
  const best = new Float32Array(W * H).fill(Infinity);
  const cells = new Uint8Array(map.w * map.h);
  // tracks first, then main roads, which take over where they meet a track
  const order = segments.map((_, k) => k).sort((a, b) => (segments[a].kind === 'main' ? 1 : 0) - (segments[b].kind === 'main' ? 1 : 0) || a - b);
  for (const k of order) {
    const s = segments[k];
    const main = s.kind === 'main';
    const kindG = main ? 255 : 110;
    const wear = Math.round(80 + hash2(k, segments.length, (map.seed | 0) + 31) * 175);
    // a track counts as narrower: its distance is scaled up so the shader's single width fits both
    const dk = ROAD_HALF.main / ROAD_HALF[s.kind];
    for (let q = 0; q + 1 < s.points.length; q++) {
      const [ax, ay] = s.points[q], [bx, by] = s.points[q + 1];
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - ROAD_REACH) * R)), i1 = Math.min(W - 1, Math.ceil((Math.max(ax, bx) + ROAD_REACH) * R));
      const j0 = Math.max(0, Math.floor((Math.min(ay, by) - ROAD_REACH) * R)), j1 = Math.min(H - 1, Math.ceil((Math.max(ay, by) + ROAD_REACH) * R));
      const dx = bx - ax, dy = by - ay, LL = dx * dx + dy * dy || 1e-9;
      for (let j = j0; j <= j1; j++) {
        const py = (j + 0.5) / R;
        for (let i = i0; i <= i1; i++) {
          const px = (i + 0.5) / R;
          const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / LL));
          const ex = px - (ax + dx * t), ey = py - (ay + dy * t);
          const d = Math.sqrt(ex * ex + ey * ey) * dk;
          const n = j * W + i;
          if (d >= ROAD_REACH || !(main ? d < best[n] + 0.15 : d < best[n])) continue;
          const ci = Math.min(map.h - 1, py | 0) * map.w + Math.min(map.w - 1, px | 0);
          const tt = map.terrain[ci];
          if ((tt === T.Water && !bridge[ci]) || tt === T.Rock) continue;
          best[n] = Math.min(best[n], d);
          const o = n * 4;
          mask[o] = Math.round(255 * (1 - best[n] / ROAD_REACH));
          mask[o + 1] = kindG;
          mask[o + 2] = wear;
          mask[o + 3] = 255;
        }
      }
    }
  }
  // cells under a road's core
  for (let cy = 0; cy < map.h; cy++) for (let cx = 0; cx < map.w; cx++) {
    const o = ((cy * R + (R >> 1)) * W + cx * R + (R >> 1)) * 4;
    if (mask[o + 3] && 1 - mask[o] / 255 < (ROAD_HALF.main + 0.15) / ROAD_REACH) cells[cy * map.w + cx] = 1;
  }
  return { mask, cells };
}

/** Distance (cells, main-road scale) from (x, y) to the nearest road centre line, from the mask; ROAD_REACH if none. */
export function roadDistance(net: RoadNetwork, w: number, h: number, x: number, y: number): number {
  const R = net.res, W = w * R;
  const i = Math.floor(x * R), j = Math.floor(y * R);
  if (i < 0 || j < 0 || i >= W || j >= h * R) return ROAD_REACH;
  const o = (j * W + i) * 4;
  return net.mask[o + 3] ? (1 - net.mask[o] / 255) * ROAD_REACH : ROAD_REACH;
}

// ---------------------------------------------------------------------------------------------------------
// Shared per map (the terrain and the vegetation both need it; the editor rebuilds with new map objects)

const cache = new WeakMap<GameMap, { key: number; net: RoadNetwork }>();

/** The map's road network, computed once per map content. */
export function roadsFor(map: GameMap): RoadNetwork {
  let k = 2166136261;
  const mix = (v: number) => { k = Math.imul(k ^ (v | 0), 16777619); };
  mix(map.w); mix(map.h); mix(map.seed);
  for (let i = 0; i < map.terrain.length; i++) mix(map.terrain[i] | (map.tree[i] << 3) | (map.oreField[i] << 5));
  for (let i = 0; i < map.heights.length; i += 3) mix(Math.round(map.heights[i] * 64));
  for (const s of map.startPositions ?? []) { mix(Math.round(s.x * 8)); mix(Math.round(s.y * 8)); }
  for (const b of map.bridges ?? []) for (const [x, y] of b.cells) mix(x * 4099 + y);
  for (const st of map.streets ?? []) for (const [x, y] of st) mix(Math.round(x * 8) * 4099 + Math.round(y * 8));
  const hit = cache.get(map);
  if (hit && hit.key === k >>> 0) return hit.net;
  const net = buildRoads(map);
  cache.set(map, { key: k >>> 0, net });
  return net;
}
