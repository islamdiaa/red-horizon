/**
 * Shared cast and script helpers for the Allied and Soviet campaigns.
 * Everything here runs inside the deterministic simulation (use m.world.rng, never Math.random).
 */
import type { MissionRuntime, Portrait, Pt } from '../sim/mission';
import type { Building, Entity, Unit } from '../sim/entities';
import type { World } from '../sim/world';
import { floodReach } from '../sim/mapgen';

export interface Speaker {
  name: string;
  portrait: Portrait;
}

/** The recurring cast. Portraits: Allied officers use the commander/intel art, Soviets the red art. */
export const CAST = {
  // --- Allied
  rourke: { name: 'Field Marshal Rourke', portrait: 'commander' },
  brandt: { name: 'Major Brandt', portrait: 'intel' },
  kestrel: { name: 'Kestrel', portrait: 'commando' },
  saarinen: { name: 'Dr. Saarinen', portrait: 'scientist' },
  hollander: { name: 'Capt. Hollander', portrait: 'pilot' },
  // --- Soviet
  morozov: { name: 'General Morozov', portrait: 'enemy' },
  orlova: { name: 'Commissar Orlova', portrait: 'intel' },
  orlovaEnemy: { name: 'Commissar Orlova', portrait: 'enemy' },
  belinsky: { name: 'Dr. Belinsky', portrait: 'scientist' },
  belinskyEnemy: { name: 'Dr. Belinsky', portrait: 'enemy' },
  gromova: { name: 'Sgt. Gromova', portrait: 'commando' },
  // --- neutral voices
  eva: { name: 'Battle Control', portrait: 'eva' },
} satisfies Record<string, Speaker>;

export function say(m: MissionRuntime, who: Speaker, text: string) {
  m.say(who.name, text, who.portrait);
}

/** Living units from ids stored in flags. */
export function unitsOf(m: MissionRuntime, key: string): Unit[] {
  return m.livingUnits(m.flags[key]);
}
export function ids(list: Entity[]): number[] {
  return list.map((e) => e.id);
}
export function entity<T extends Entity = Entity>(m: MissionRuntime, id: number | undefined): T | null {
  if (!id) return null;
  const e = m.world.getEntity(id);
  return e && e.alive ? (e as T) : null;
}

const reachCache = new WeakMap<World, Uint8Array>();
/** Cells reachable on the ground from the human start (cached per world). */
export function reach(m: MissionRuntime): Uint8Array {
  let r = reachCache.get(m.world);
  if (!r) {
    const s = m.start(0);
    r = floodReach(m.world.map, Math.floor(s.x), Math.floor(s.y));
    reachCache.set(m.world, r);
  }
  return r;
}

/** Passable map-edge point reachable from the human start, closest to (x, y). */
export function edgeNear(m: MissionRuntime, x: number, y: number): [number, number] {
  const map = m.world.map;
  const r = reach(m);
  let best: [number, number] | null = null, bd = Infinity;
  const W = map.w, H = map.h;
  for (let k = 0; k < W; k++) {
    for (const [cx, cy] of [[k, 1], [k, H - 2], [1, k], [W - 2, k]] as [number, number][]) {
      if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
      const i = map.idx(cx, cy);
      if (!r[i] || !map.passable(cx, cy)) continue;
      const d = Math.hypot(cx + 0.5 - x, cy + 0.5 - y);
      if (d < bd) { bd = d; best = [cx + 0.5, cy + 0.5]; }
    }
  }
  return best ?? m.nearestEdge(x, y);
}

/** Nearest reachable, passable cell centre to (x, y) within radius r. */
export function ground(m: MissionRuntime, x: number, y: number, r = 10): [number, number] {
  const map = m.world.map;
  const rc = reach(m);
  const fx = Math.floor(x), fy = Math.floor(y);
  for (let d = 0; d <= r; d++) {
    let best: [number, number] | null = null, bd = Infinity;
    for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;
      const cx = fx + dx, cy = fy + dy;
      if (!map.inBounds(cx, cy) || !map.passable(cx, cy) || !rc[map.idx(cx, cy)]) continue;
      const dd = Math.hypot(cx + 0.5 - x, cy + 0.5 - y);
      if (dd < bd) { bd = dd; best = [cx + 0.5, cy + 0.5]; }
    }
    if (best) return best;
  }
  return [x, y];
}

/** Scripted attack wave: spawn at `from`, attack-move to `to`. Returns the spawned units. */
export function wave(m: MissionRuntime, p: number, types: string[], from: Pt, to: Pt): Unit[] {
  const f = Array.isArray(from) ? from : [from.x, from.y] as [number, number];
  const t = Array.isArray(to) ? to : [to.x, to.y] as [number, number];
  return m.reinforce(p, types, f, t, true);
}

/** Remember units as "hunters": scripted attackers that keep pushing at the human side. */
export function addHunters(m: MissionRuntime, units: Unit[], key = 'hunters') {
  const list: number[] = (m.flags[key] ??= []);
  for (const u of units) list.push(u.id);
}

/** Every `period` seconds, idle hunters attack-move towards the closest human asset (or `near`). */
export function hunt(m: MissionRuntime, key = 'hunters', period = 10, near?: Pt) {
  if (!m.every(period, 'hunt:' + key)) return;
  const all = m.livingUnits(m.flags[key]);
  m.flags[key] = all.map((u) => u.id);
  const idle = all.filter((u) => u.order.type === 'idle' && !u.target && u.kind !== 'aircraft' && u.weapons.length);
  if (!idle.length) return;
  const c = centroid(idle);
  const target = near ? (Array.isArray(near) ? { x: near[0], y: near[1] } : near) : closestHumanAsset(m, c.x, c.y);
  if (target) m.move(idle, target.x, target.y, true);
}

/** Scripted wave whose units keep hunting after they arrive. */
export function huntWave(m: MissionRuntime, p: number, types: string[], from: Pt, to: Pt, key = 'hunters'): Unit[] {
  const units = wave(m, p, types, from, to);
  addHunters(m, units, key);
  return units;
}

export function centroid(list: Entity[]): { x: number; y: number } {
  if (!list.length) return { x: 0, y: 0 };
  let x = 0, y = 0;
  for (const e of list) { x += e.x; y += e.y; }
  return { x: x / list.length, y: y / list.length };
}

/** Closest structure (preferred) or unit of the human side to a point. */
export function closestHumanAsset(m: MissionRuntime, x: number, y: number): Entity | null {
  const team = m.human.team;
  let best: Entity | null = null, bd = Infinity;
  for (const b of m.world.buildings) {
    if (!b.alive || b.owner.team !== team || b.bt.wall) continue;
    const d = Math.hypot(b.x - x, b.y - y);
    if (d < bd) { bd = d; best = b; }
  }
  if (best) return best;
  for (const u of m.world.units) {
    if (!u.alive || u.owner.team !== team) continue;
    const d = Math.hypot(u.x - x, u.y - y);
    if (d < bd) { bd = d; best = u; }
  }
  return best;
}

/** Non-wall structures of a player. */
export function structures(m: MissionRuntime, p: number, types?: string[]): Building[] {
  return m.buildings(p, types).filter((b) => !b.bt.wall);
}

/** Escorts stay close to the unit they protect (call every few seconds). */
export function escort(m: MissionRuntime, guards: Unit[], ward: Entity | null, leash = 3) {
  if (!ward || !ward.alive) return;
  const far = guards.filter((g) => g.alive && !g.target && Math.hypot(g.x - ward.x, g.y - ward.y) > leash);
  if (far.length) m.move(far, ward.x, ward.y, true);
}

/** Human units within r of a point (optionally of given types). */
export function humanNear(m: MissionRuntime, x: number, y: number, r: number, types?: string[]): Unit[] {
  return m.unitsNear(0, x, y, r, types ? (u) => types.includes(u.ut.id) : undefined);
}

/** Power summary, handy when tuning pre-built bases. */
export function power(m: MissionRuntime, p: number): { out: number; use: number; low: boolean } {
  const pl = m.player(p);
  return { out: pl.powerOut, use: pl.powerUse, low: pl.lowPower };
}

/** Units sitting inside transports are not in world.units: find a unit by id including passengers. */
export function findUnitAnywhere(m: MissionRuntime, id: number): { unit: Unit; carrier: Unit | null } | null {
  const direct = m.world.getEntity(id);
  if (direct && direct.alive && !(direct as Unit).transport) return { unit: direct as Unit, carrier: null };
  for (const u of m.world.units) {
    if (!u.alive || !u.passengers.length) continue;
    const p = u.passengers.find((x) => x.id === id);
    if (p) return { unit: p, carrier: u };
  }
  return null;
}

/** Position of a unit, or of the transport carrying it. */
export function whereIs(m: MissionRuntime, id: number): { x: number; y: number } | null {
  const f = findUnitAnywhere(m, id);
  if (!f) return null;
  return f.carrier ? { x: f.carrier.x, y: f.carrier.y } : { x: f.unit.x, y: f.unit.y };
}

/**
 * Place a set of structures relative to an anchor, oriented towards `facing`:
 * each entry is [type, forward cells, side cells]. Returns the placed buildings in order (null if no room).
 */
export function layout(m: MissionRuntime, p: number, anchor: Pt, facing: Pt, items: [string, number, number][]): (Building | null)[] {
  const a = Array.isArray(anchor) ? { x: anchor[0], y: anchor[1] } : anchor;
  return items.map(([type, fwd, side]) => {
    const [x, y] = m.toward(a, facing, fwd, side);
    // structures must be reachable on the ground, or a mission can stall on one last building in a forest pocket
    for (const [ox, oy] of [[0, 0], [2, 0], [-2, 0], [0, 2], [0, -2], [3, 3], [-3, -3], [3, -3], [-3, 3]]) {
      const b = m.placeNear(p, type, x + ox, y + oy);
      if (!b) continue;
      if (reachableAround(m, b)) return b;
      unplace(m, b);
    }
    return null;
  });
}

/** Whether any cell bordering the footprint is reachable from the human start. */
export function reachableAround(m: MissionRuntime, b: Building): boolean {
  const map = m.world.map;
  const r = reach(m);
  for (let y = b.cy - 1; y <= b.cy + b.h; y++) for (let x = b.cx - 1; x <= b.cx + b.w; x++) {
    if (x >= b.cx && x < b.cx + b.w && y >= b.cy && y < b.cy + b.h) continue;
    if (map.inBounds(x, y) && r[map.idx(x, y)]) return true;
  }
  return false;
}

/** Take back a just-placed structure (setup only). */
function unplace(m: MissionRuntime, b: Building) {
  m.remove(b);
  b.owner.stats.buildingsLost = Math.max(0, b.owner.stats.buildingsLost);
}

/** Spawn units at a point offset from an anchor ([forward, side] towards `facing`). */
export function squad(m: MissionRuntime, p: number, types: string[], anchor: Pt, facing: Pt, fwd = 0, side = 0): Unit[] {
  const a = Array.isArray(anchor) ? { x: anchor[0], y: anchor[1] } : anchor;
  const f = Array.isArray(facing) ? { x: facing[0], y: facing[1] } : facing;
  const [x, y] = m.toward(a, f, fwd, side);
  const [gx, gy] = ground(m, x, y, 6);
  return m.spawnGroup(p, types, gx, gy, Math.atan2(f.y - gy, f.x - gx));
}

/** Give an AI player difficulty parameters (build speed, income) and a behaviour (full / defensive / passive). */
export function aiProfile(m: MissionRuntime, p: number, difficulty: 'easy' | 'normal' | 'hard' | 'brutal', behaviour: 'full' | 'defensive' | 'passive' = 'full') {
  m.setAI(p, difficulty);
  if (behaviour !== 'full') m.setAI(p, behaviour);
}

/**
 * Workaround for units that stall next to a structure they were ordered to enter (engineers, C4):
 * when a unit already stands in the cell beside the footprint but more than 0.7 cells from its edge,
 * the pathfinder has nowhere to go and the order never completes. Step such units up to the wall.
 */
export function nudgeEntries(m: MissionRuntime) {
  if (m.world.tick % 10 !== 0) return;
  for (const u of m.world.units) {
    if (!u.alive || u.order.type !== 'enter' || u.path || u.moving) continue;
    const t = m.world.getEntity(u.order.target);
    if (!t || !t.alive || t.kind !== 'building') continue;
    const b = t as Building;
    const d = b.distTo(u.x, u.y);
    if (d <= 0.7 || d > 1.6) continue;
    const [cx, cy] = b.closestPoint(u.x, u.y);
    const k = 0.55 / d;
    u.x = cx + (u.x - cx) * k;
    u.y = cy + (u.y - cy) * k;
  }
}

/** Compass word for the direction from a to b (map y grows southwards). */
export function compass(a: { x: number; y: number }, b: { x: number; y: number }): string {
  const ang = Math.atan2(-(b.y - a.y), b.x - a.x); // 0 = east, counter-clockwise
  const names = ['east', 'north-east', 'north', 'north-west', 'west', 'south-west', 'south', 'south-east'];
  const k = Math.round(((ang + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8;
  return names[k];
}

/** Wrap a mission so announcements raised while its base is laid out (low power, structure lost) are dropped. */
export function quietSetup<T extends { setup(m: MissionRuntime): void }>(def: T): T {
  const setup = def.setup.bind(def);
  def.setup = (m: MissionRuntime) => {
    setup(m);
    m.world.events = m.world.events.filter((e) => e.e !== 'announce');
    for (const p of m.world.players) p.lastAnnounce.clear();
  };
  return def;
}
