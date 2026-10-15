/**
 * Bridges (RA: bridge templates over water, destroyed by AP / HE explosions — COMBAT.CPP Explosion_Damage
 * destroys a bridge cell with chance damage / BridgeStrength, BridgeStrength = 1000).
 *
 * The map lists bridges (`GameMap.bridges`: the water cells they span and their axis). The world keeps their
 * state in `World.bridges`; `GameMap.bridgeAt` marks every cell under an intact bridge with the bridge id, which
 * makes it passable to ground units (map.terrainPassable). Damage reaches a bridge through a hook in
 * combat.impact: every explosive (wall-breaching: AP / HE / nuke) hit landing on a bridge cell takes its raw
 * damage off the bridge's 1000 hp (the deterministic equivalent of RA's damage/1000 collapse chance), so
 * force-firing the ground on a bridge brings it down. A destroyed bridge's cells are water again (ground units
 * on it are lost). An engineer sent with the 'repairBridge' command to either end rebuilds it (and is used up).
 */
import { T, type GameMap, type MapBridge } from './map';
import { Unit, type Entity } from './entities';
import { DT, type Order } from './types';
import type { World } from './world';

/** RA BridgeStrength. */
export const BRIDGE_STRENGTH = 1000;

export interface Bridge {
  /** 1-based; also the value stored in GameMap.bridgeAt while intact. */
  id: number;
  /** Cells the deck covers (water cells). */
  cells: [number, number][];
  /** 'x' = the deck runs along x (east-west), 'y' = along y. */
  axis: 'x' | 'y';
  hp: number;
  maxHp: number;
  alive: boolean;
  /** Land cells just past either end of the deck: where engineers stand to rebuild it. */
  ends: [number, number][];
}

/** Build World.bridges from the map and mark the intact decks passable (World constructor). */
export function initBridges(world: World) {
  const m = world.map;
  m.bridgeAt.fill(0);
  world.bridges = m.bridges.slice(0, 255).map((mb, k) => ({
    id: k + 1, cells: mb.cells.map(([x, y]) => [x, y] as [number, number]), axis: mb.axis,
    hp: BRIDGE_STRENGTH, maxHp: BRIDGE_STRENGTH, alive: true, ends: bridgeEnds(m, mb),
  }));
  for (const b of world.bridges) stampBridge(m, b, true);
}

function stampBridge(m: GameMap, b: Bridge, on: boolean) {
  for (const [x, y] of b.cells) if (m.inBounds(x, y)) m.bridgeAt[m.idx(x, y)] = on ? b.id : 0;
}

/** Land cells beyond both ends of every lane of the deck. */
function bridgeEnds(m: GameMap, mb: MapBridge): [number, number][] {
  const lanes = new Map<number, number[]>();
  for (const [x, y] of mb.cells) {
    const lane = mb.axis === 'x' ? y : x, pos = mb.axis === 'x' ? x : y;
    const l = lanes.get(lane) ?? [];
    l.push(pos);
    lanes.set(lane, l);
  }
  const out: [number, number][] = [];
  for (const [lane, ps] of lanes) {
    const lo = Math.min(...ps) - 1, hi = Math.max(...ps) + 1;
    for (const p of [lo, hi]) {
      const [x, y] = mb.axis === 'x' ? [p, lane] : [lane, p];
      if (m.inBounds(x, y)) out.push([x, y]);
    }
  }
  return out;
}

/** The bridge (intact or not) whose deck covers cell (x, y), if any. */
export function bridgeAtCell(world: World, x: number, y: number): Bridge | null {
  for (const b of world.bridges) for (const [cx, cy] of b.cells) if (cx === x && cy === y) return b;
  return null;
}

/** Explosion hook (combat.impact): an explosive hit at (x, y) damages the bridge under it. */
export function damageBridgeAt(world: World, x: number, y: number, damage: number, attacker: Entity | null) {
  const m = world.map;
  const cx = Math.floor(x), cy = Math.floor(y);
  if (!m.inBounds(cx, cy)) return;
  const id = m.bridgeAt[m.idx(cx, cy)];
  if (!id) return;
  const b = world.bridges[id - 1];
  if (!b || !b.alive || damage <= 0) return;
  b.hp -= damage;
  if (b.hp <= 0) destroyBridge(world, b, attacker);
}

/** Nuclear blast: every intact bridge cell within r takes the damage. */
export function damageBridgesInRadius(world: World, x: number, y: number, r: number, damage: number) {
  for (const b of world.bridges) {
    if (!b.alive) continue;
    if (b.cells.some(([cx, cy]) => Math.hypot(cx + 0.5 - x, cy + 0.5 - y) <= r)) {
      b.hp -= damage;
      if (b.hp <= 0) destroyBridge(world, b, null);
    }
  }
}

export function destroyBridge(world: World, b: Bridge, attacker: Entity | null) {
  if (!b.alive) return;
  const m = world.map;
  b.alive = false;
  b.hp = 0;
  stampBridge(m, b, false);
  // whatever was driving across goes into the water
  const onDeck = (u: Unit) => {
    const cx = Math.floor(u.x), cy = Math.floor(u.y);
    return m.inBounds(cx, cy) && m.terrain[m.idx(cx, cy)] === T.Water && b.cells.some(([x, y]) => x === cx && y === cy);
  };
  for (const u of world.units) {
    if (!u.alive || u.kind === 'aircraft' || u.kind === 'naval') continue;
    if (onDeck(u)) world.lethal(u, 'normal', attacker ?? undefined);
    else if (u.hasGoal || u.path) world.requestPath(u, u.goalX, u.goalY); // plan around the gap
  }
  b.cells.forEach(([x, y], k) => {
    if (k % 2 === 0) world.events.push({ e: 'impact', x: x + 0.5, y: y + 0.5, z: m.surfaceAt(x + 0.5, y + 0.5), kind: 'large', scale: 1, owner: attacker?.owner.id ?? -1 });
  });
  const [mx, my] = centre(b);
  world.events.push({ e: 'bridge', id: b.id, alive: false });
  world.sfx('bridge_collapse', mx, my);
  for (const p of world.players) {
    if (p.defeated) continue;
    if (b.cells.some(([x, y]) => p.explored[m.idx(x, y)])) world.announce(p, 'bridge_destroyed', 2);
  }
}

export function repairBridge(world: World, b: Bridge, by: Unit | null) {
  const wasDead = !b.alive;
  b.alive = true;
  b.hp = b.maxHp;
  stampBridge(world.map, b, true);
  const [mx, my] = centre(b);
  if (wasDead) world.events.push({ e: 'bridge', id: b.id, alive: true });
  world.sfx('repair', mx, my);
  if (by) world.announce(by.owner, 'bridge_repaired', 0);
}

function centre(b: Bridge): [number, number] {
  let x = 0, y = 0;
  for (const [cx, cy] of b.cells) { x += cx + 0.5; y += cy + 0.5; }
  return [x / b.cells.length, y / b.cells.length];
}

/** 'repairBridge' command: engineers head for the bridge. */
export function orderRepairBridge(world: World, units: Unit[], bridgeId: number) {
  const b = world.bridges[bridgeId - 1];
  if (!b || (b.alive && b.hp >= b.maxHp)) return;
  for (const u of units) if (u.ut.engineer) world.giveOrder(u, { type: 'repairBridge', bridge: b.id });
}

/** Engineer with a 'repairBridge' order: walk to the nearest end and rebuild (unitlogic hook). */
export function updateRepairBridge(world: World, u: Unit, o: Extract<Order, { type: 'repairBridge' }>) {
  const b = world.bridges[o.bridge - 1];
  if (!b || (b.alive && b.hp >= b.maxHp)) { finish(world, u); return; }
  const m = world.map;
  let best: [number, number] | null = null, bd = Infinity;
  for (const [x, y] of b.ends) {
    if (!m.passable(x, y)) continue;
    const d = Math.hypot(x + 0.5 - u.x, y + 0.5 - u.y);
    if (d < bd) { bd = d; best = [x, y]; }
  }
  if (!best) { finish(world, u); return; }
  if (bd < 0.75) {
    repairBridge(world, b, u);
    world.kill(u, 'sold');
    return;
  }
  u.waitTimer += DT;
  if (!u.path && !u.pathPending && (!u.hasGoal || u.waitTimer > 1)) {
    u.waitTimer = 0;
    world.requestPath(u, best[0] + 0.5, best[1] + 0.5);
  }
}

function finish(world: World, u: Unit) {
  const next = u.orderQueue.shift();
  if (next) world.setOrder(u, next);
  else {
    world.setOrder(u, { type: 'idle' });
    u.guardX = u.x;
    u.guardY = u.y;
  }
}

// ---------------------------------------------------------------------------
// Map generation helper
// ---------------------------------------------------------------------------

type Img = (x: number, y: number) => [number, number];

/** The symmetry group of the map's terrain (generated skirmish maps are symmetric; keep bridges fair). */
function symmetryOf(m: GameMap): Img[] {
  const W = m.w, H = m.h;
  const id: Img = (x, y) => [x, y];
  const rot: Img = (x, y) => [W - 1 - x, H - 1 - y];
  const fx: Img = (x, y) => [W - 1 - x, y];
  const fy: Img = (x, y) => [x, H - 1 - y];
  const same = (f: Img) => {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const [a, b] = f(x, y);
      if (m.terrain[m.idx(x, y)] !== m.terrain[m.idx(a, b)]) return false;
    }
    return true;
  };
  if (same(fx) && same(fy)) return [id, fx, fy, rot];
  if (same(rot)) return [id, rot];
  return [id];
}

/**
 * Lay a few bridges over narrow water where they save a long detour on land (deterministic; respects the
 * map's symmetry so skirmish maps stay fair). `maxBridges` counts symmetric copies as one. Returns how many
 * bridges were added to `map.bridges`. Curated maps can call it, or fill `map.bridges` by hand.
 */
export function addBridgesToMap(map: GameMap, maxBridges = map.w >= 96 ? 2 : 1): number {
  const W = map.w, H = map.h;
  const land = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    const i = map.idx(x, y);
    const t = map.terrain[i];
    return t !== T.Water && t !== T.Rock && map.tree[i] === 0;
  };
  const water = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && map.terrain[map.idx(x, y)] === T.Water && !map.bridgeAt[map.idx(x, y)];
  interface Cand { axis: 'x' | 'y'; lanes: number[]; lo: number; hi: number; score: number }
  const cands: Cand[] = [];
  const nearStart = (x: number, y: number) => map.startPositions.some((s) => Math.hypot(s.x - x, s.y - y) < 11);
  // straight water runs of length 2..7 with land at both ends, in rows (axis x) and columns (axis y)
  for (const axis of ['x', 'y'] as const) {
    const lanesN = axis === 'x' ? H : W, len = axis === 'x' ? W : H;
    const at = (lane: number, p: number): [number, number] => (axis === 'x' ? [p, lane] : [lane, p]);
    const run = (lane: number, lo: number, hi: number) => {
      for (let p = lo; p <= hi; p++) if (!water(...at(lane, p))) return false;
      return land(...at(lane, lo - 1)) && land(...at(lane, hi + 1));
    };
    for (let lane = 1; lane < lanesN - 1; lane++) {
      let p = 1;
      while (p < len - 1) {
        if (!water(...at(lane, p)) || !land(...at(lane, p - 1))) { p++; continue; }
        let q = p;
        while (q + 1 < len && water(...at(lane, q + 1))) q++;
        const L = q - p + 1;
        if (L >= 2 && L <= 7 && land(...at(lane, q + 1))) {
          const [ax, ay] = at(lane, p - 1), [bx, by] = at(lane, q + 1);
          if (!nearStart(ax, ay) && !nearStart(bx, by)) {
            // two lanes wide when the neighbouring lane has the same crossing
            const lanes = run(lane + 1, p, q) ? [lane, lane + 1] : [lane];
            cands.push({ axis, lanes, lo: p, hi: q, score: 0 });
          }
        }
        p = q + 1;
      }
    }
  }
  if (!cands.length) return 0;
  // usefulness: how much walking the bridge saves (bounded BFS on land between its two ends)
  const seen = new Int32Array(W * H);
  let gen = 0;
  const queue = new Int32Array(W * H);
  const dist = new Int32Array(W * H);
  const detour = (ax: number, ay: number, bx: number, by: number, limit: number): number => {
    gen++;
    let qh = 0, qt = 0;
    const s = map.idx(ax, ay), g = map.idx(bx, by);
    seen[s] = gen;
    queue[qt++] = s;
    dist[s] = 0;
    while (qh < qt) {
      const i = queue[qh++];
      const d = dist[i];
      if (i === g) return d;
      if (d >= limit) continue;
      const x = i % W, y = (i / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (!land(nx, ny) && !(map.inBounds(nx, ny) && map.bridgeAt[map.idx(nx, ny)])) continue;
        const j = map.idx(nx, ny);
        if (seen[j] === gen) continue;
        seen[j] = gen;
        dist[j] = d + 1;
        queue[qt++] = j;
      }
    }
    return limit + 1;
  };
  const LIMIT = 40;
  for (const c of cands) {
    const L = c.hi - c.lo + 1;
    const lane = c.lanes[0];
    const [ax, ay] = c.axis === 'x' ? [c.lo - 1, lane] : [lane, c.lo - 1];
    const [bx, by] = c.axis === 'x' ? [c.hi + 1, lane] : [lane, c.hi + 1];
    const saving = detour(ax, ay, bx, by, LIMIT) - (L + 1);
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    c.score = saving - L * 0.5 + (c.lanes.length > 1 ? 3 : 0) - Math.hypot(mx - W / 2, my - H / 2) * 0.05;
    if (saving < 10) c.score = -Infinity;
  }
  const ok = cands.filter((c) => c.score > -Infinity).sort((a, b) => b.score - a.score || a.lo - b.lo || a.lanes[0] - b.lanes[0]);
  const imgs = symmetryOf(map);
  const chosen: { cx: number; cy: number }[] = [];
  let added = 0;
  for (const c of ok) {
    if (added >= maxBridges) break;
    const cells: [number, number][] = [];
    for (const lane of c.lanes) for (let p = c.lo; p <= c.hi; p++) cells.push(c.axis === 'x' ? [p, lane] : [lane, p]);
    const copies: MapBridge[] = [];
    let valid = true;
    for (const f of imgs) {
      const cc = cells.map(([x, y]) => f(x, y));
      // a symmetric copy that lands on the original (the crossing is its own mirror image) is skipped
      const key = (q: [number, number][]) => q.map(([x, y]) => x + ',' + y).sort().join(';');
      if (copies.some((o) => key(o.cells) === key(cc))) continue;
      if (cc.some(([x, y]) => !water(x, y))) { valid = false; break; }
      const mx = cc.reduce((s, q) => s + q[0], 0) / cc.length, my = cc.reduce((s, q) => s + q[1], 0) / cc.length;
      if (chosen.some((o) => Math.hypot(o.cx - mx, o.cy - my) < 10)) { valid = false; break; }
      copies.push({ cells: cc, axis: c.axis });
    }
    if (!valid || !copies.length) continue;
    for (const b of copies) {
      map.bridges.push(b);
      const mx = b.cells.reduce((s, q) => s + q[0], 0) / b.cells.length, my = b.cells.reduce((s, q) => s + q[1], 0) / b.cells.length;
      chosen.push({ cx: mx, cy: my });
    }
    added++;
  }
  return added;
}
