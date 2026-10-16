/**
 * [CTRL] Formations: group moves that keep their shape in transit.
 *
 * A FormationGroup is a virtual centre that follows one A* path at the pace of the slowest member (90 % of
 * it, so whoever drifts back can catch up). Every member steers for its slot: the centre plus its offset,
 * turned with the group's heading. The centre slows down and waits while members lag behind (forming up,
 * fighting on an attack-move, working round an obstacle), slots that fall on blocked ground are pulled in
 * towards the centre (the formation squeezes through a gap and opens up again behind it), members far out
 * of position path back on their own, and on arrival everybody walks the last few steps to a claimed final
 * slot as a plain move.
 *
 * Shapes (Unit.formShape, set with the 'formation' command): line, box, wedge, or 'none' = automatic: a
 * tight group keeps its relative positions (and holds them on the way), a spread-out group converges into a
 * box sorted by role (armour in front, rocket infantry behind it, artillery and support at the back).
 * The automatic formation applies to human players' group moves; AI armies move as before unless they ask
 * for a shape. World.ctrl (CtrlState) is saved with the world.
 */
import { mphToCellsPerSecond } from '../data/rules';
import { angleDiff, turnTowards } from '../core/util';
import { Unit } from './entities';
import { maxRange } from './combat';
import { DT, type Command, type FormationShape, type Order } from './types';
import type { World } from './world';

export interface FormationGroup {
  id: number;
  /** Member unit ids; member k keeps slot (offsets[2k], offsets[2k+1]). */
  members: number[];
  /** Slot offsets: (forward, right) cells, or world (dx, dy) when `fixed`. */
  offsets: number[];
  /** Centre waypoints as flattened x, y pairs, and the index of the pair being approached. */
  path: number[];
  idx: number;
  /** Centre position and heading (radians). */
  x: number;
  y: number;
  h: number;
  /** Offsets are world-aligned (automatic formation keeps relative positions) instead of turning with h. */
  fixed: boolean;
  /** The shape it was laid out in. */
  shape?: FormationShape;
  /** Cruise speed (cells/s) and the fraction of it the centre moves at this tick (0 = waiting). */
  speed: number;
  f: number;
  /** Ticks the centre has been held back (a jam never stalls the formation for good). */
  wait?: number;
}

/** World-level unit-control state (World.ctrl), serialised with saves. */
export interface CtrlState {
  nextId: number;
  groups: FormationGroup[];
}

export const newCtrlState = (): CtrlState => ({ nextId: 1, groups: [] });

export const FORMATION_SHAPES: FormationShape[] = ['none', 'line', 'box', 'wedge'];

type MoveOrder = Extract<Order, { type: 'move' }>;
type MoveCmd = Extract<Command, { c: 'move' }>;

/** Members further than this from their slot don't hold the formation back (they path back on their own). */
const STRAGGLER = 6;
/** Group moves shorter than this are plain moves to the final slots. */
const MIN_TRAVEL = 4;

const isGround = (u: Unit) => u.kind === 'infantry' || u.kind === 'vehicle';
const speedOf = (u: Unit) => mphToCellsPerSecond(u.ut.speed);

function passable(world: World, x: number, y: number): boolean {
  return world.map.passable(Math.floor(x), Math.floor(y));
}

/** Straight segment over passable ground (sampled every 0.35 cells). */
export function clearLine(world: World, x0: number, y0: number, x1: number, y1: number): boolean {
  const d = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(1, Math.ceil(d / 0.35));
  for (let k = 1; k <= n; k++) {
    const t = k / n;
    if (!passable(world, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false;
  }
  return true;
}

/** Drive straight at (x, y) this tick (a one-waypoint path; replaces any queued search). */
export function steerTo(u: Unit, x: number, y: number) {
  const p = u.path;
  if (p && p.length === 1 && u.pathIdx === 0) { p[0].x = x; p[0].y = y; }
  else { u.path = [{ x, y }]; u.pathIdx = 0; }
  u.goalX = x;
  u.goalY = y;
  u.hasGoal = true;
  u.pathPending = false;
  u.stuckCount = 0;
  u.progressTimer = 0;
}

function memberOf(u: Unit, gid: number): boolean {
  const o = u.order;
  if (o.type === 'move') return o.formation === gid;
  if (o.type === 'attack' && o.resume?.type === 'move') return o.resume.formation === gid;
  return false;
}

export function groupById(world: World, id: number | undefined): FormationGroup | undefined {
  if (!id) return undefined;
  for (const g of world.ctrl.groups) if (g.id === id) return g;
  return undefined;
}

/** Lower = further forward: tough short-range units lead, long-range / fragile / support units follow. */
function frontScore(u: Unit): number {
  if (!u.weapons.length || u.ut.medic || u.ut.harvester || u.ut.deploysInto || u.ut.engineer || u.ut.spy || u.ut.thief) return 100;
  let s = maxRange(u) - u.maxHp / 150;
  if (u.weapons.some((w) => w.def.minRange)) s += 20;
  if (u.ut.noMovingFire) s += 5;
  if (u.ut.dog) s -= 3;
  return s;
}

/** Row sizes, front row first. */
function shapeRows(shape: Exclude<FormationShape, 'none'>, n: number): number[] {
  const rows: number[] = [];
  if (shape === 'wedge') {
    for (let r = 1, left = n; left > 0; r++) { rows.push(Math.min(r, left)); left -= r; }
  } else {
    const cols = shape === 'line' ? (n <= 12 ? n : Math.ceil(n / 2)) : Math.ceil(Math.sqrt(n));
    for (let left = n; left > 0; left -= cols) rows.push(Math.min(cols, left));
  }
  return rows;
}

/**
 * Slot offsets (forward, right) for `units` in `shape` facing h, centred on the shape's middle. Members are
 * sorted into rows by role and, within a row, left to right by where they stand now (no crossing over).
 */
export function layoutShape(shape: Exclude<FormationShape, 'none'>, units: Unit[], cx: number, cy: number, h: number): number[] {
  const n = units.length;
  const vehicles = units.some((u) => u.kind !== 'infantry');
  const s = vehicles ? 1.3 : 0.9;
  const depth = shape === 'wedge' ? s * 0.85 : s;
  const rows = shapeRows(shape, n);
  const order = units.map((_, k) => k).sort((a, b) => frontScore(units[a]) - frontScore(units[b]) || units[a].id - units[b].id);
  const rx = -Math.sin(h), ry = Math.cos(h);
  const lat = (k: number) => (units[k].x - cx) * rx + (units[k].y - cy) * ry;
  const offs = new Array<number>(n * 2).fill(0);
  let at = 0, sumF = 0;
  rows.forEach((cnt, r) => {
    const row = order.slice(at, at + cnt).sort((a, b) => lat(a) - lat(b) || units[a].id - units[b].id);
    at += cnt;
    row.forEach((k, j) => {
      offs[2 * k] = -r * depth;
      offs[2 * k + 1] = (j - (cnt - 1) / 2) * s;
      sumF += offs[2 * k];
    });
  });
  const mf = sumF / n;
  for (let k = 0; k < n; k++) offs[2 * k] -= mf;
  return offs;
}

/** World position of slot k at centre (x, y) / heading h (no obstacle handling). */
function slotAt(g: { offsets: number[]; fixed: boolean }, k: number, x: number, y: number, h: number): [number, number] {
  const ox = g.offsets[2 * k], oy = g.offsets[2 * k + 1];
  if (g.fixed) return [x + ox, y + oy];
  const c = Math.cos(h), s = Math.sin(h);
  return [x + c * ox - s * oy, y + s * ox + c * oy];
}

let squeezed = false;
/** Slot k of a group in transit, pulled in towards the centre while it lies on blocked ground (sets `squeezed`). */
function slotPoint(world: World, g: FormationGroup, k: number): [number, number] {
  const [sx, sy] = slotAt(g, k, g.x, g.y, g.h);
  squeezed = false;
  if (passable(world, sx, sy)) return [sx, sy];
  squeezed = true;
  for (const f of [0.66, 0.33]) {
    const px = g.x + (sx - g.x) * f, py = g.y + (sy - g.y) * f;
    if (passable(world, px, py)) return [px, py];
  }
  return [g.x, g.y];
}

/** Distinct final positions: whole cells for vehicles, quarter cells for infantry (like World.formation). */
class SlotClaims {
  private veh = new Set<number>();
  private inf = new Set<number>();
  private infCells = new Set<number>();
  constructor(private world: World) {}

  private free(x: number, y: number, inf: boolean): boolean {
    const m = this.world.map;
    const cx = Math.floor(x), cy = Math.floor(y);
    if (!m.passable(cx, cy)) return false;
    const c = cy * m.w + cx;
    if (this.veh.has(c)) return false;
    if (!inf) return !this.infCells.has(c);
    return !this.inf.has(Math.floor(y * 2) * (m.w * 2) + Math.floor(x * 2));
  }

  private take(x: number, y: number, inf: boolean) {
    const m = this.world.map;
    const c = Math.floor(y) * m.w + Math.floor(x);
    if (inf) { this.inf.add(Math.floor(y * 2) * (m.w * 2) + Math.floor(x * 2)); this.infCells.add(c); }
    else this.veh.add(c);
  }

  claim(px: number, py: number, inf: boolean): [number, number] {
    const m = this.world.map;
    px = Math.min(m.w - 0.01, Math.max(0.01, px));
    py = Math.min(m.h - 0.01, Math.max(0.01, py));
    if (this.free(px, py, inf)) { this.take(px, py, inf); return [px, py]; }
    const step = inf ? 0.5 : 1;
    const bx = inf ? Math.floor(px * 2) / 2 + 0.25 : Math.floor(px) + 0.5;
    const by = inf ? Math.floor(py * 2) / 2 + 0.25 : Math.floor(py) + 0.5;
    for (let r = 1; r < 12; r++) {
      let best: [number, number] | null = null, bestD = Infinity;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const sx = bx + dx * step, sy = by + dy * step;
        if (sx < 0 || sy < 0 || sx >= m.w || sy >= m.h || !this.free(sx, sy, inf)) continue;
        const d = (sx - px) ** 2 + (sy - py) ** 2;
        if (d < bestD) { bestD = d; best = [sx, sy]; }
      }
      if (best) { this.take(best[0], best[1], inf); return best; }
    }
    return [px, py];
  }
}

/** The shape most of the units are set to. */
function dominantShape(units: Unit[]): FormationShape {
  const n: Record<FormationShape, number> = { none: 0, line: 0, box: 0, wedge: 0 };
  for (const u of units) n[FORMATION_SHAPES.includes(u.formShape) ? u.formShape : 'none']++;
  let best: FormationShape = 'none';
  for (const s of FORMATION_SHAPES) if (n[s] > n[best]) best = s;
  return best;
}

/** Centre path (flattened) from the group's centre to (gx, gy); null when no progress is possible. */
function centrePath(world: World, sx: number, sy: number, gx: number, gy: number): number[] | null {
  const m = world.map;
  const path = world.pathfinder.find(Math.floor(sx), Math.floor(sy), Math.floor(gx), Math.floor(gy), Math.max(9000, m.w * m.h), 0, 'ground');
  if (!path || !path.length) return null;
  const out: number[] = [];
  for (const p of path) out.push(p.x, p.y);
  const last = path[path.length - 1];
  if (Math.floor(last.x) === Math.floor(gx) && Math.floor(last.y) === Math.floor(gy)) {
    out[out.length - 2] = gx;
    out[out.length - 1] = gy;
  }
  return out;
}

/**
 * World 'move' hook: a group move of two or more ground units in a formation (and the rest of the selection
 * the usual way). False = not a formation move (queued waypoints, single units, AI without a shape).
 */
export function formationMove(world: World, units: Unit[], cmd: MoveCmd): boolean {
  if (cmd.queue || !Number.isFinite(cmd.x) || !Number.isFinite(cmd.y)) return false;
  const ground = units.filter(isGround);
  if (ground.length < 2) return false;
  const shape = dominantShape(ground);
  if (shape === 'none' && !ground[0].owner.isHuman) return false;
  const m = world.map;
  const gx = Math.min(m.w - 0.01, Math.max(0.01, cmd.x)), gy = Math.min(m.h - 0.01, Math.max(0.01, cmd.y));
  const n = ground.length;
  let cx = 0, cy = 0;
  for (const u of ground) { cx += u.x; cy += u.y; }
  cx /= n; cy /= n;
  let maxR = 0;
  for (const u of ground) maxR = Math.max(maxR, Math.hypot(u.x - cx, u.y - cy));
  // already marching in this formation (a new order on the way): carry on from where the group is, same slots
  const prev = continuing(world, ground, shape);
  const tight = !!prev || maxR < 2.5 + Math.sqrt(n) * 0.7;
  const travel = Math.hypot(gx - cx, gy - cy);

  // where the centre starts: the group's centre, the centroid, or the member nearest to it when that is blocked
  let sx = prev ? prev.x : cx, sy = prev ? prev.y : cy;
  if (!prev && !passable(world, cx, cy)) {
    let bd = Infinity;
    for (const u of ground) { const d = Math.hypot(u.x - cx, u.y - cy); if (d < bd) { bd = d; sx = u.x; sy = u.y; } }
  }
  const path = tight && travel > MIN_TRAVEL ? centrePath(world, sx, sy, gx, gy) : null;
  // the formation ends where the path ends (the nearest reachable point if the goal can't be reached)
  const ex = path ? path[path.length - 2] : gx, ey = path ? path[path.length - 1] : gy;
  // final facing: along the last couple of cells of the route
  let hf = Math.atan2(ey - cy, ex - cx);
  if (path) {
    let px = sx, py = sy, acc = 0;
    for (let k = path.length - 4; k >= 0; k -= 2) {
      acc += Math.hypot(path[k + 2] - path[k], path[k + 3] - path[k + 1]);
      px = path[k]; py = path[k + 1];
      if (acc >= 2.5) break;
    }
    if (Math.hypot(ex - px, ey - py) > 0.3) hf = Math.atan2(ey - py, ex - px);
  }
  if (!Number.isFinite(hf)) hf = 0;

  const fixed = prev ? prev.fixed : shape === 'none' && tight;
  const offsets = prev ? ground.flatMap((u) => { const k = prev.members.indexOf(u.id); return [prev.offsets[2 * k], prev.offsets[2 * k + 1]]; })
    : fixed ? ground.flatMap((u) => [u.x - cx, u.y - cy])
    : layoutShape(shape === 'none' ? 'box' : shape, ground, cx, cy, hf);
  const geo = { offsets, fixed };
  // final slots, front row first
  const claims = new SlotClaims(world);
  const finals: [number, number][] = new Array(n);
  const claimOrder = ground.map((_, k) => k).sort((a, b) => (fixed ? 0 : offsets[2 * b] - offsets[2 * a]) || (ground[a].kind === 'infantry' ? 1 : 0) - (ground[b].kind === 'infantry' ? 1 : 0) || ground[a].id - ground[b].id);
  for (const k of claimOrder) {
    const [px, py] = slotAt(geo, k, ex, ey, hf);
    finals[k] = claims.claim(px, py, ground[k].kind === 'infantry');
  }
  const attackMove = !!cmd.attackMove;
  const slowest = Math.min(...ground.map(speedOf));
  if (path && travel > MIN_TRAVEL) {
    const h0 = Math.atan2(path[1] - sy, path[0] - sx);
    const g: FormationGroup = {
      id: world.ctrl.nextId++, members: ground.map((u) => u.id), offsets, path, idx: 0,
      x: sx, y: sy, h: prev ? prev.h : Number.isFinite(h0) ? h0 : hf, fixed, shape, speed: slowest * 0.9, f: prev ? prev.f : 0,
    };
    world.ctrl.groups.push(g);
    ground.forEach((u, k) => world.giveOrder(u, { type: 'move', x: finals[k][0], y: finals[k][1], attackMove, formation: g.id }));
  } else {
    // spread out (or a short hop): everyone walks to the final slots, travelling together at the slowest pace
    const cap = slowest * 1.05;
    ground.forEach((u, k) => {
      world.giveOrder(u, { type: 'move', x: finals[k][0], y: finals[k][1], attackMove });
      u.speedCap = cap;
    });
  }
  const others = units.filter((u) => !isGround(u));
  if (others.length) {
    const dests = world.formation(others, cmd.x, cmd.y);
    others.forEach((u, k) => world.giveOrder(u, { type: 'move', x: dests[k][0], y: dests[k][1], attackMove }));
  }
  return true;
}

/** The group all these units are marching in (same shape), if any: a new order continues it. */
function continuing(world: World, ground: Unit[], shape: FormationShape): FormationGroup | null {
  const g = inFormation(world, ground[0]);
  if (!g || (g.shape ?? 'none') !== shape) return null;
  for (const u of ground) if (inFormation(world, u) !== g) return null;
  return g;
}

/** 'formation' command: remember the shape; idle units form up on the spot, facing the way they face. */
export function setFormation(world: World, units: Unit[], shape: FormationShape) {
  if (!FORMATION_SHAPES.includes(shape)) shape = 'none';
  const ground = units.filter(isGround);
  for (const u of ground) u.formShape = shape;
  if (shape === 'none') return;
  const idle = ground.filter((u) => u.order.type === 'idle' || u.order.type === 'guard');
  if (idle.length < 2) return;
  let cx = 0, cy = 0, hx = 0, hy = 0;
  for (const u of idle) { cx += u.x; cy += u.y; hx += Math.cos(u.heading); hy += Math.sin(u.heading); }
  cx /= idle.length; cy /= idle.length;
  const h = Math.hypot(hx, hy) > 1e-3 ? Math.atan2(hy, hx) : -Math.PI / 2;
  const geo = { offsets: layoutShape(shape, idle, cx, cy, h), fixed: false };
  const claims = new SlotClaims(world);
  idle.forEach((u, k) => {
    const [px, py] = slotAt(geo, k, cx, cy, h);
    const [x, y] = claims.claim(px, py, u.kind === 'infantry');
    world.giveOrder(u, { type: 'move', x, y, attackMove: false });
  });
}

/** Pre-tick: prune members, then move each group's centre as fast as its members keep up. */
export function updateFormations(world: World) {
  const gs = world.ctrl.groups;
  if (!gs.length) return;
  let w = 0;
  for (const g of gs) if (stepGroup(world, g)) gs[w++] = g;
  gs.length = w;
}

function stepGroup(world: World, g: FormationGroup): boolean {
  let n = 0;
  for (let k = 0; k < g.members.length; k++) {
    const u = world.entities.get(g.members[k]);
    if (!(u instanceof Unit) || !u.alive || u.transport || !memberOf(u, g.id)) continue;
    g.members[n] = g.members[k];
    g.offsets[2 * n] = g.offsets[2 * k];
    g.offsets[2 * n + 1] = g.offsets[2 * k + 1];
    n++;
  }
  g.members.length = n;
  g.offsets.length = 2 * n;
  if (!n || g.idx * 2 >= g.path.length) return false;
  // the worst lag among the members holding formation sets the pace; members squeezed by an obstacle
  // (single file through a gap) don't count, and the centre keeps crawling while any are
  let worst = 0, halfW = 0, narrow = false;
  for (let k = 0; k < n; k++) {
    const u = world.entities.get(g.members[k]) as Unit;
    const [sx, sy] = slotPoint(world, g, k);
    const lag = Math.hypot(sx - u.x, sy - u.y);
    if (squeezed) narrow = true;
    else if (lag < STRAGGLER && lag > worst) worst = lag;
    halfW = Math.max(halfW, Math.abs(g.fixed ? Math.hypot(g.offsets[2 * k], g.offsets[2 * k + 1]) : g.offsets[2 * k + 1]));
  }
  g.f = Math.max(0, Math.min(1, 1 - (worst - 1.1) / 2));
  g.wait = g.f < 0.5 ? (g.wait ?? 0) + 1 : 0;
  if (narrow || g.wait > 60) g.f = Math.max(g.f, 0.35);
  const tx = g.path[2 * g.idx], ty = g.path[2 * g.idx + 1];
  const want = Math.atan2(ty - g.y, tx - g.x);
  let step = g.speed * g.f * DT;
  if (Math.hypot(tx - g.x, ty - g.y) > 1e-3) {
    if (g.fixed) g.h = want;
    else {
      // wheel round at a rate the outer members can follow; pivot before setting off at a sharp turn
      const diff = Math.abs(angleDiff(g.h, want));
      g.h = turnTowards(g.h, want, Math.min(2, (1.5 * g.speed) / Math.max(1, halfW)) * DT * Math.max(0.25, g.f));
      step *= Math.max(0, Math.cos(Math.min(diff, Math.PI / 2)));
    }
  }
  while (step > 1e-6 && g.idx * 2 < g.path.length) {
    const px = g.path[2 * g.idx], py = g.path[2 * g.idx + 1];
    const d = Math.hypot(px - g.x, py - g.y);
    if (d <= step) { g.x = px; g.y = py; step -= d; g.idx++; }
    else { g.x += ((px - g.x) / d) * step; g.y += ((py - g.y) / d) * step; step = 0; }
  }
  return true;
}

function release(u: Unit, o: MoveOrder) {
  delete o.formation;
  o.started = false;
  u.path = null;
  u.hasGoal = false;
  u.pathPending = false;
  u.speedCap = 0;
}

/**
 * unitlogic.move hook for formation members: steer for the slot (a little ahead of it while the group moves).
 * False once the group has arrived or dissolved: the order then finishes as a plain move to (o.x, o.y).
 */
export function formationSteer(world: World, u: Unit, o: MoveOrder): boolean {
  const g = groupById(world, o.formation);
  const k = g ? g.members.indexOf(u.id) : -1;
  if (!g || k < 0 || g.idx * 2 >= g.path.length) { release(u, o); return false; }
  const [sx, sy] = slotPoint(world, g, k);
  // lead the slot along the direction of travel so the unit cruises instead of creeping up on it
  const wx = g.path[2 * g.idx], wy = g.path[2 * g.idx + 1];
  const wl = Math.hypot(wx - g.x, wy - g.y);
  const lead = g.f > 0.05 && wl > 1e-3 ? 0.5 + 0.5 * g.f : 0;
  let tx = sx, ty = sy;
  if (lead) {
    const lx = sx + ((wx - g.x) / wl) * lead, ly = sy + ((wy - g.y) / wl) * lead;
    if (passable(world, lx, ly)) { tx = lx; ty = ly; }
  }
  const d = Math.hypot(tx - u.x, ty - u.y);
  if (!lead && d < 0.12) {
    u.path = null;
    u.hasGoal = false;
    u.pathPending = false;
    u.speedCap = 0;
    return true;
  }
  if (d < 5 && clearLine(world, u.x, u.y, tx, ty)) {
    steerTo(u, tx, ty);
    u.speedCap = Math.max(0.2, g.speed * g.f + 1.6 * (d - lead));
  } else {
    // out of position or something in the way: path to the slot
    u.speedCap = 0;
    if (!u.pathPending && (!u.path || (world.tick + u.id) % 19 === 0)) world.requestPath(u, sx, sy);
  }
  return true;
}

/** Whether a unit is currently steered by a formation (for the UI). */
export function inFormation(world: World, u: Unit): FormationGroup | undefined {
  const o = u.order;
  const id = o.type === 'move' ? o.formation : o.type === 'attack' && o.resume?.type === 'move' ? o.resume.formation : undefined;
  return groupById(world, id);
}

export { isGround };
