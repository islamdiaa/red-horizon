/**
 * Shared helpers for the headless simulation test suite (`npm test`).
 *
 * Everything here imports only the deterministic simulation (src/sim, src/data, src/core):
 * no DOM, no three.js. Run a single file with:
 *   node --import tsx --test tests/combat.test.ts
 */
import { createHash } from 'node:crypto';
import { BUILDINGS, type Faction } from '../src/data/rules';
import { Building, Unit, type Entity } from '../src/sim/entities';
import { GameMap, T } from '../src/sim/map';
import { generateMap, type MapGenOptions } from '../src/sim/mapgen';
import type { Player } from '../src/sim/player';
import { recalcPlayerEconomy } from '../src/sim/production';
import { TICK_HZ, DT, type GameEvent } from '../src/sim/types';
import { World, type PlayerSetup } from '../src/sim/world';
import type { AIDifficulty } from '../src/sim/ai';

export { TICK_HZ, DT, T, World, GameMap, Building, Unit };
export type { Entity, Player, GameEvent };

// ---------------------------------------------------------------------------
// World builders
// ---------------------------------------------------------------------------

export interface SandboxOptions {
  w?: number;
  h?: number;
  /** One entry per player. */
  factions?: Faction[];
  /** Team per player (defaults to one team each). */
  teams?: number[];
  credits?: number;
  fog?: boolean;
  seed?: number;
  /** Keep the MCV every player starts with (default: removed). */
  keepMcv?: boolean;
  /** AI difficulty per player (undefined = human / scripted). */
  ai?: (AIDifficulty | undefined)[];
}

export interface Sandbox {
  world: World;
  map: GameMap;
  p0: Player;
  p1: Player;
}

/**
 * A flat, all-clear test map (no water, trees, ore or relief) with an empty world:
 * no fog, no crates, starting MCVs removed. Ideal for precise rule tests.
 */
export function sandbox(opts: SandboxOptions = {}): Sandbox {
  const w = opts.w ?? 48, h = opts.h ?? 48;
  const map = new GameMap(w, h);
  map.startPositions = [
    { x: 6.5, y: h - 6.5 }, { x: w - 6.5, y: 6.5 }, { x: 6.5, y: 6.5 }, { x: w - 6.5, y: h - 6.5 },
  ];
  const factions = opts.factions ?? ['allies', 'soviet'];
  const players: PlayerSetup[] = factions.map((f, i) => ({
    name: `P${i}`, faction: f, color: 0xffffff, team: opts.teams?.[i] ?? i, isHuman: !opts.ai?.[i], ai: opts.ai?.[i],
  }));
  const world = new World({ map, players, credits: opts.credits ?? 10000, startUnits: 'mcv', fog: opts.fog ?? false, seed: opts.seed ?? 1 });
  world.cratesEnabled = false;
  if (!opts.keepMcv) {
    for (const u of world.units) world.entities.delete(u.id);
    world.units = [];
  }
  return { world, map, p0: world.players[0], p1: world.players[1] };
}

/** Procedural skirmish world exactly like the game / tools/simtest.ts builds it. */
export function skirmish(opts: {
  seed: number; size?: number; players?: number; ai?: (AIDifficulty | undefined)[]; credits?: number;
  fog?: boolean; startUnits?: 'mcv' | 'light' | 'heavy'; map?: Partial<MapGenOptions>;
}): World {
  const n = opts.players ?? 2;
  const map = generateMap({ size: opts.size ?? 64, players: n, seed: opts.seed, water: 0.5, trees: 0.5, ore: 0.6, ...opts.map });
  const factions: Faction[] = ['allies', 'soviet', 'allies', 'soviet'];
  const ai = opts.ai ?? Array.from({ length: n }, () => 'normal' as AIDifficulty);
  return new World({
    map,
    players: Array.from({ length: n }, (_, i) => ({ name: `P${i}`, faction: factions[i], color: 0xffffff, team: i, isHuman: !ai[i], ai: ai[i] })),
    credits: opts.credits ?? 5000, startUnits: opts.startUnits ?? 'mcv', fog: opts.fog ?? true, seed: opts.seed,
  });
}

/** Add a finished structure (no construction animation) and refresh power/storage. */
export function building(world: World, type: string, p: Player, cx: number, cy: number): Building {
  if (!BUILDINGS[type]) throw new Error(`unknown building ${type}`);
  const b = world.addBuilding(type, p, cx, cy, true);
  recalcPlayerEconomy(world, p);
  return b;
}

/** Add a unit at a map position (cell centres are x + 0.5). */
export function unit(world: World, type: string, p: Player, x: number, y: number, heading = 0): Unit {
  const u = world.addUnit(type, p, x, y);
  u.heading = u.prevHeading = u.turret = u.prevTurret = heading;
  return u;
}

/** Give a player plenty of power so nothing is throttled. */
export function powerUp(world: World, p: Player, cx: number, cy: number, n = 3): Building[] {
  const out: Building[] = [];
  for (let k = 0; k < n; k++) out.push(building(world, 'apwr', p, cx + k * 3, cy));
  return out;
}

/** Set a rectangle of cells to a terrain type. */
export function paint(map: GameMap, x0: number, y0: number, x1: number, y1: number, t: number) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) map.terrain[map.idx(x, y)] = t;
}

/** Put ore (or gems) into a rectangle of cells and register them as an ore field. */
export function ore(map: GameMap, x0: number, y0: number, x1: number, y1: number, bails = 9, gems = false) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = map.idx(x, y);
    map.oreField[i] = gems ? 2 : 1;
    map.ore[i] = bails;
    map.gems[i] = gems ? 1 : 0;
    if (!map.oreFieldCells.includes(i)) map.oreFieldCells.push(i);
  }
}

export function totalOre(map: GameMap): number {
  let s = 0;
  for (let i = 0; i < map.ore.length; i++) s += map.ore[i];
  return s;
}

// ---------------------------------------------------------------------------
// Running the simulation
// ---------------------------------------------------------------------------

/** Step `ticks` times. Events are drained every tick (optionally collected). */
export function run(world: World, ticks: number, events?: GameEvent[]) {
  for (let t = 0; t < ticks; t++) {
    world.step();
    if (events) events.push(...world.events);
    world.events.length = 0;
  }
}

export const seconds = (s: number) => Math.round(s * TICK_HZ);

/** Step until `pred` holds; returns the number of ticks taken, or -1 on timeout. */
export function runUntil(world: World, pred: () => boolean, maxTicks: number, events?: GameEvent[]): number {
  for (let t = 1; t <= maxTicks; t++) {
    world.step();
    if (events) events.push(...world.events);
    world.events.length = 0;
    if (pred()) return t;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Invariants & hashing
// ---------------------------------------------------------------------------

/** Returns a list of human-readable invariant violations (empty = healthy). */
export function checkInvariants(world: World, maxEntities = 1500): string[] {
  const out: string[] = [];
  const m = world.map;
  const bad = (v: number) => !Number.isFinite(v);
  for (const p of world.players) {
    if (p.cash < -1e-6) out.push(`${p.name} cash negative: ${p.cash}`);
    if (p.ore < -1e-6) out.push(`${p.name} ore negative: ${p.ore}`);
    if (bad(p.cash) || bad(p.ore)) out.push(`${p.name} money not finite`);
    if (p.ore > p.storage + 1e-6) out.push(`${p.name} ore ${p.ore} exceeds storage ${p.storage}`);
  }
  for (const u of world.units) {
    if (!u.alive) { out.push(`dead unit #${u.id} ${u.ut.id} still listed after step`); continue; }
    if (bad(u.x) || bad(u.y) || bad(u.heading) || bad(u.hp)) { out.push(`unit #${u.id} ${u.ut.id} has non-finite state x=${u.x} y=${u.y} h=${u.heading} hp=${u.hp}`); continue; }
    if (u.x < 0 || u.y < 0 || u.x >= m.w || u.y >= m.h) out.push(`unit #${u.id} ${u.ut.id} off map (${u.x.toFixed(2)}, ${u.y.toFixed(2)})`);
    if (u.hp > u.maxHp + 1e-6) out.push(`unit #${u.id} ${u.ut.id} hp ${u.hp} > max ${u.maxHp}`);
    if (u.kind === 'aircraft' || u.transport) continue;
    const cx = Math.floor(u.x), cy = Math.floor(u.y);
    if (!m.inBounds(cx, cy)) continue;
    const i = m.idx(cx, cy);
    const occ = m.occupant[i];
    if (occ && occ !== u.exitBuilding && m.passableOverride[i] !== 1) {
      const b = world.entities.get(occ);
      out.push(`unit #${u.id} ${u.ut.id} (${u.owner.name}) inside building #${occ} ${b instanceof Building ? b.bt.id : '?'} at (${u.x.toFixed(2)}, ${u.y.toFixed(2)}) order=${u.order.type}`);
    }
    if (u.kind === 'naval' ? !m.navalTerrain(i) : !m.terrainPassable(i)) out.push(`unit #${u.id} ${u.ut.id} on impassable terrain (${u.x.toFixed(2)}, ${u.y.toFixed(2)}) t=${m.terrain[i]} tree=${m.tree[i]}`);
  }
  for (const b of world.buildings) {
    if (!b.alive) out.push(`dead building #${b.id} still listed`);
    if (bad(b.hp) || b.hp > b.maxHp + 1e-6) out.push(`building #${b.id} ${b.bt.id} bad hp ${b.hp}`);
  }
  for (const pr of world.projectiles) {
    if (bad(pr.x) || bad(pr.y) || bad(pr.z)) out.push(`projectile ${pr.weapon.id} non-finite position`);
  }
  const n = world.entities.size;
  if (n > maxEntities) out.push(`entity count ${n} exceeds ${maxEntities}`);
  if (world.projectiles.length > 600) out.push(`projectile count ${world.projectiles.length}`);
  return out;
}

const r = (v: number) => (Number.isFinite(v) ? v : String(v));

/**
 * Canonical hash of the complete simulation state. Two worlds that hash equal will
 * evolve identically. (Projectile ids are excluded: they come from a module-level
 * counter in combat.ts, see determinism.test.ts.)
 */
export function stateHash(world: World): string {
  const h = createHash('sha256');
  const w = world as any;
  const put = (v: unknown) => h.update(JSON.stringify(v) + '\n');
  const bytes = (a: ArrayBufferView) => h.update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
  put([world.tick, w.rng.s, w.nextId, world.gameOver, world.winnerTeam, w.crateTimer, w.commands?.length, w.pathQueue?.length]);
  for (const p of world.players) {
    put([p.id, r(p.cash), r(p.ore), p.storage, p.powerOut, p.powerUse, p.defeated, p.radar, p.superCharge, p.stats,
      [...p.owned.entries()].sort(), p.lastAttackX, p.lastAttackY]);
    for (const q of Object.values(p.queues)) put([q.kind, q.ready, q.stalled, q.items.map((it) => [it.type, r(it.progress), r(it.paid), it.paused])]);
    bytes(p.explored);
  }
  for (const u of world.units) {
    put([u.id, u.ut.id, u.owner.id, r(u.x), r(u.y), r(u.heading), r(u.turret), r(u.hp), u.alive, u.order, u.orderQueue,
      u.target?.id ?? 0, u.path?.length ?? -1, u.pathIdx, r(u.goalX), r(u.goalY), u.hasGoal, u.pathPending, r(u.speedFrac),
      u.cargo, r(u.cargoValue), u.hstate, r(u.altitude), u.ammo, u.rank, r(u.xp), u.passengers.map((x) => x.id), u.transport,
      r(u.invulnerable), u.weapons.map((s) => [r(s.cooldown), s.burstLeft, r(s.burstTimer)]), u.dockAt, u.homePad, u.exitBuilding]);
  }
  for (const b of world.buildings) {
    put([b.id, b.bt.id, b.owner.id, b.cx, b.cy, r(b.hp), r(b.buildAnim), r(b.selling), b.repairing, r(b.charge), r(b.turret),
      b.primary, b.rallyX, b.rallyY, b.dockOccupant, r(b.invulnerable), b.target?.id ?? 0, b.weapons.map((s) => [r(s.cooldown), s.burstLeft])]);
  }
  for (const p of world.projectiles) {
    put([p.weapon.id, p.owner.id, p.shooter, p.kind, r(p.x), r(p.y), r(p.z), r(p.tx), r(p.ty), r(p.t), p.alive, p.target?.id ?? 0]);
  }
  put(world.crates);
  bytes(world.map.ore);
  bytes(world.map.gems);
  bytes(world.map.tree);
  bytes(world.map.occupant);
  bytes(world.map.oreField);
  return h.digest('hex').slice(0, 16);
}

/** Cells covered by the footprint of a building type placed at (cx, cy). */
export function footprint(type: string, cx: number, cy: number): [number, number][] {
  const bt = BUILDINGS[type];
  const out: [number, number][] = [];
  for (let dy = 0; dy < bt.size[1]; dy++) for (let dx = 0; dx < bt.size[0]; dx++) out.push([cx + dx, cy + dy]);
  return out;
}
