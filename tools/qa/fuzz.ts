// Command fuzzer: random, sanitiser-legal commands from the whole command vocabulary into random skirmishes
// (map sizes up to 192, 2-4 players, both rulesets, mutators, King of the Hill, sea and curated maps), with
// world invariants checked as it runs and three determinism checks per case: a save / load at a random tick must
// keep the same hash, the command log replayed into a fresh world must reproduce it, and some cases run on the
// portable maths path.
//   node --import tsx tools/qa/fuzz.ts [--from 1] [--count 20] [--minutes 5] [--size 0] [-v]
// FUZZ_ALL=1 sends most commands to the AI players' units too; FUZZ_NOSAVE=1 skips the save / load check.
// One case per seed; the seed alone reproduces it (`--from <seed> --count 1 -v`).
import { headlessGame } from '../../src/modes/headless';
import type { GameSetup } from '../../src/game';
import { serializeWorld } from '../../src/sim/save';
import { worldHash } from '../../src/replay/hash';
import { enterPortableMath, exitPortableMath } from '../../src/net/dmath';
import { sanitizeCommand } from '../../src/net/commands';
import { setupScenario } from '../../src/debug';
import { BUILDINGS, UNITS } from '../../src/data/rules';
import { SUPER_KINDS } from '../../src/sim/superweapons';
import { POWER_IDS } from '../../src/sim/commander';
import { UPGRADE_IDS, RESEARCH_IDS } from '../../src/sim/economy-data';
import { FORMATION_SHAPES } from '../../src/sim/formation';
import { QUEUE_LIMIT } from '../../src/sim/production';
import { MUTATORS } from '../../src/modes/mutators';
import { CURATED_MAPS } from '../../src/maps';
import { Building, Unit, type Entity } from '../../src/sim/entities';
import type { World } from '../../src/sim/world';
import type { Command, Stance } from '../../src/sim/types';
import type { AIDifficulty } from '../../src/sim/ai';

const TICK_HZ = 20;
const arg = (k: string, d: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const VERBOSE = process.argv.includes('-v');

// ------------------------------------------------------------------------------------------------ fuzz RNG
/** The fuzzer's own generator (never the world's). */
export class FRng {
  constructor(public s: number) { this.s = (s >>> 0) || 1; }
  next(): number { let t = (this.s = (this.s + 0x6d2b79f5) >>> 0); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
  int(a: number, b: number) { return a + Math.floor(this.next() * (b - a + 1)); }
  pick<T>(a: readonly T[]): T { return a[Math.floor(this.next() * a.length)]; }
  chance(p: number) { return this.next() < p; }
  sub<T>(a: readonly T[], max: number): T[] {
    const n = Math.min(a.length, this.int(1, max)), out: T[] = [], used = new Set<number>();
    for (let k = 0; k < n * 3 && out.length < n; k++) { const i = Math.floor(this.next() * a.length); if (!used.has(i)) { used.add(i); out.push(a[i]); } }
    return out;
  }
}

// ------------------------------------------------------------------------------------------------ case setup
export interface FuzzCase { seed: number; setup: GameSetup; dmath: boolean; prep: 'none' | 'base' | 'battle'; zoo: boolean; minutes: number; others: number }

export function makeCase(seed: number, minutes: number, forceSize = 0): FuzzCase {
  const r = new FRng(seed * 7919 + 13);
  const size = forceSize || r.pick([48, 64, 64, 96, 96, 128, 128, 192]);
  const curated = r.chance(0.15) ? r.pick(CURATED_MAPS) : null;
  const maxP = curated ? Math.max(2, (curated as any).players ?? 2) : size <= 48 ? 2 : 4; // (the game's limit: 4 players)
  const nP = r.int(2, maxP);
  const teams = nP >= 3 && r.chance(0.35); // some opponents on the player's side (2v2, 3v5...)
  const diffs: AIDifficulty[] = ['recruit', 'easy', 'normal', 'hard', 'brutal'];
  const rules = r.chance(0.6) ? 'commander' : 'classic';
  const sea = r.chance(0.2);
  const setup: GameSetup = {
    faction: r.chance(0.5) ? 'allies' : 'soviet', color: 0x3d7be0,
    opponents: Array.from({ length: nP - 1 }, (_, i) => ({ faction: r.pick(['allies', 'soviet', 'random'] as const), difficulty: r.pick(diffs), ...(teams && i < Math.floor((nP - 1) / 2) ? { ally: true } : {}) })),
    mapSize: size, water: sea ? 0.9 : r.pick([0.2, 0.4, 0.6]), trees: r.pick([0.2, 0.5, 0.8]), ore: r.pick([0.4, 0.6, 0.9]),
    credits: r.pick([5000, 10000, 30000, 100000]), startUnits: r.pick(['mcv', 'light', 'heavy'] as const), fog: r.chance(0.6),
    timeOfDay: 'day', quality: 'low', seed: r.int(1, 1e6), intro: false,
    rules, mutators: r.chance(0.4) ? r.sub(MUTATORS.map((m) => m.id), 3) : [],
    koth: r.chance(0.15), kothMinutes: 2, ceasefire: r.chance(0.2) ? r.int(1, 2) : 0,
    events: rules === 'commander' ? r.chance(0.8) : undefined, dynamicDifficulty: r.chance(0.2),
  } as GameSetup;
  if (curated) (setup as any).mapId = curated.id;
  const others = r.pick([0, 0, 0.1, 0.3]);
  return { seed, setup, dmath: r.chance(0.25), prep: r.pick(['none', 'none', 'base', 'battle'] as const), zoo: r.chance(0.7), minutes, others: process.env.FUZZ_ALL ? 0.75 : others };
}

const ZOO_SKIP = new Set(['badr', 'u2', 'truk']);
/** Deterministic preparation applied to the main world and to the replay world alike. */
export function prepare(world: World, fc: FuzzCase) {
  if (fc.prep !== 'none') { // (the debug scenario drops structures on the start units: move them out, as placing does)
    setupScenario(world, fc.prep);
    for (const b of world.buildings) (world as any).clearFootprintUnits(b);
    // (and drops part of its battle armies in the sea on water maps: those go)
    const m = world.map;
    for (const u of world.units) {
      const i = m.idx(Math.floor(u.x), Math.floor(u.y));
      if (u.kind !== 'aircraft' && (u.kind === 'naval' ? !m.navalTerrain(i) : !m.terrainPassable(i))) { u.alive = false; world.entities.delete(u.id); }
    }
    for (const u of world.units) if (!u.alive) world.entities.delete(u.id); // (the scenario's MCVs, marked dead)
    world.units = world.units.filter((u) => u.alive);
  }
  if (!fc.zoo) return;
  const p = world.players[0], s = world.map.startPositions[0];
  for (const t of Object.values(UNITS)) {
    if (ZOO_SKIP.has(t.id) || !(t as any).owner?.includes(p.faction)) continue;
    const naval = t.kind === 'naval';
    const [x, y] = world.findFreeSpot(s.x + 3, s.y + 3, naval ? 40 : 8, t.kind === 'vehicle', naval);
    if (naval && !world.map.navalTerrain(world.map.idx(Math.floor(x), Math.floor(y)))) continue;
    const u = world.addUnit(t.id, p, x, y);
    if (u.kind === 'aircraft') u.altitude = u.ut.vtol ? 1.55 : 2.3;
  }
  (world as any).dirtyLists = true;
}

// ------------------------------------------------------------------------------------------------ commands
const ALL_TYPES = [...Object.keys(UNITS), ...Object.keys(BUILDINGS)];
const STANCES: Stance[] = ['aggressive', 'guard', 'hold', 'passive'];

export function genCommand(w: World, r: FRng, pi: number, dead: number[]): Command | null {
  const p = w.players[pi];
  if (!p || p.defeated) return null;
  const m = w.map;
  const own = w.units.filter((u) => u.alive && u.owner === p);
  const ownB = w.buildings.filter((b) => b.alive && b.owner === p);
  const foes: Entity[] = [...w.units.filter((u) => u.alive && p.isEnemy(u.owner)), ...w.buildings.filter((b) => b.alive && p.isEnemy(b.owner))];
  const anyId = (): number => (r.chance(0.6) && foes.length ? r.pick(foes).id : r.chance(0.5) && dead.length ? r.pick(dead) : r.chance(0.5) && own.length ? r.pick(own).id : r.int(1, (w as any).nextId + 5));
  const pos = (): [number, number] => {
    const q = r.next();
    if (q < 0.8) return [r.next() * m.w, r.next() * m.h];
    if (q < 0.93 && own.length) { const u = r.pick(own); return [u.x + (r.next() - 0.5) * 12, u.y + (r.next() - 0.5) * 12]; }
    if (q < 0.99) return [(r.next() * 1.4 - 0.2) * m.w, (r.next() * 1.4 - 0.2) * m.h];
    return [(r.next() * 2 - 1) * 4096, (r.next() * 2 - 1) * 4096];
  };
  const units = (filter?: (u: Unit) => boolean): number[] => {
    const pool = filter ? own.filter(filter) : own;
    const ids = (pool.length ? r.sub(pool, r.chance(0.2) ? 40 : 8) : []).map((u) => u.id);
    if (r.chance(0.05)) ids.push(anyId());
    return ids;
  };
  const bld = (filter?: (b: Building) => boolean) => { const pool = filter ? ownB.filter(filter) : ownB; return pool.length && r.chance(0.95) ? r.pick(pool).id : anyId(); };
  const opts = p.buildOptions();
  const type = () => (opts.length && r.chance(0.85) ? r.pick(opts) : r.pick(ALL_TYPES));
  const placeSpot = (t: string): [number, number] => {
    const bt = BUILDINGS[t];
    for (let k = 0; k < 80 && bt && ownB.length; k++) {
      const b = r.pick(ownB), cx = b.cx + r.int(-8, 8), cy = b.cy + r.int(-8, 8);
      if (w.canPlace(p, t, cx, cy)) return [cx, cy];
    }
    const [x, y] = pos();
    return [Math.round(x), Math.round(y)];
  };
  const P = pi;
  if (r.chance(0.0004)) return { c: 'resign', player: P }; // surrender (rare: it ends that side's game)
  switch (r.int(0, 33)) {
    case 0: case 1: case 2: { const [x, y] = pos(); return { c: 'move', player: P, units: units(), x, y, attackMove: r.chance(0.4), queue: r.chance(0.15) }; }
    case 3: case 4: return { c: 'attack', player: P, units: units(), target: anyId(), forced: r.chance(0.2) };
    case 5: { const [x, y] = pos(); return { c: 'attackGround', player: P, units: units(), x, y }; }
    case 6: return { c: r.pick(['stop', 'scatter'] as const), player: P, units: units() };
    case 7: return { c: 'deploy', player: P, units: units((u) => !!(u.ut.deploysInto || u.ut.passengers || u.ut.minelayer || u.kind === 'aircraft' || u.kind === 'naval' || r.chance(0.1))) };
    case 8: { const c = m.oreFieldCells.length ? r.pick(m.oreFieldCells) : 0; return { c: 'harvest', player: P, units: units((u) => !!u.ut.harvester), x: c % m.w + 0.5, y: Math.floor(c / m.w) + 0.5 }; }
    case 9: { // board a transport, garrison a bunker, dock, infiltrate, capture
      const carriers = [...own.filter((u) => u.ut.passengers), ...w.buildings.filter((b) => b.alive && (b.owner === p ? b.bt.dock || b.bt.id === 'bunk' : true))];
      const target = carriers.length && r.chance(0.9) ? r.pick(carriers).id : anyId();
      return { c: 'enter', player: P, units: units((u) => u.kind === 'infantry' || !!u.ut.harvester || r.chance(0.1)), target };
    }
    case 10: case 11: case 12: return { c: 'build', player: P, type: type(), count: r.chance(0.3) ? r.int(1, 10) : undefined };
    case 13: return { c: r.pick(['cancel', 'pause'] as const), player: P, type: type(), ...(r.chance(0.3) ? { all: true } : {}) } as Command;
    case 14: case 15: { // place what is ready (a legal spot, mostly)
      const q = p.queues.structure;
      const t = q.ready && r.chance(0.9) ? q.ready : type();
      const [cx, cy] = placeSpot(t);
      const wall = BUILDINGS[t]?.wall && r.chance(0.6);
      return { c: 'place', player: P, type: t, cx, cy, ...(wall ? { cx2: cx + r.int(-12, 12), cy2: cy + r.int(-12, 12) } : {}) };
    }
    case 16: return { c: r.pick(['sell', 'repair', 'primary', 'evacuate'] as const), player: P, building: r.chance(0.97) ? bld() : anyId() };
    case 17: { const [x, y] = pos(); return { c: 'rally', player: P, building: bld((b) => !!b.bt.factory), x, y }; }
    case 18: { const [x, y] = pos(); const ct = own.find((u) => r.chance(0.3)); return { c: 'superweapon', player: P, kind: r.pick(SUPER_KINDS), x, y, unit: ct?.id }; }
    case 19: return { c: 'stance', player: P, units: units(), stance: r.pick(STANCES) };
    case 20: { const [x, y] = pos(); return { c: 'mine', player: P, units: units((u) => !!u.ut.minelayer || r.chance(0.1)), x, y }; }
    case 21: return { c: 'repairBridge', player: P, units: units((u) => !!u.ut.engineer || r.chance(0.1)), bridge: r.int(0, w.bridges.length + 1) };
    case 22: { const [x, y] = pos(); const u = own.find((o) => o.ut.id === 'ctnk') ?? (own.length ? r.pick(own) : null); return u ? { c: 'chronoJump', player: P, unit: u.id, x, y } : null; }
    case 23: return { c: 'patrol', player: P, units: units(), points: Array.from({ length: r.int(1, 5) }, () => pos()), queue: r.chance(0.2) };
    case 24: { const friends = [...own, ...ownB]; return { c: 'guard', player: P, units: units(), target: friends.length && r.chance(0.9) ? r.pick(friends).id : anyId(), queue: r.chance(0.1) }; }
    case 25: return { c: 'formation', player: P, units: units(), shape: r.pick(FORMATION_SHAPES) };
    case 26: return { c: 'rallyUnit', player: P, building: bld((b) => !!b.bt.factory), target: r.chance(0.2) ? 0 : own.length ? r.pick(own).id : 0 };
    case 27: {
      const structs = opts.filter((t) => BUILDINGS[t]);
      const items = Array.from({ length: r.int(0, 4) }, () => { const t = structs.length ? r.pick(structs) : 'powr'; const [cx, cy] = placeSpot(t); return { type: t, cx, cy }; });
      return { c: 'queuePlan', player: P, items, mode: r.pick(['append', 'append', 'replace', 'remove'] as const) };
    }
    case 28: return { c: 'repeat', player: P, building: bld((b) => !!b.bt.factory), type: type(), on: r.chance(0.7) };
    case 29: { const [x, y] = pos(); const tb = foes.find((f) => f instanceof Building && r.chance(0.3)); return { c: 'commanderPower', player: P, power: r.pick(POWER_IDS), x, y, target: tb?.id }; }
    case 30: return { c: 'unlockPower', player: P, power: r.pick(POWER_IDS) };
    case 31: { const ev = w.variety?.active.length ? r.pick(w.variety.active) : null; return { c: 'battleEvent', player: P, event: ev ? (ev as any).id : r.int(0, 50), act: 'hire' }; }
    case 32: return { c: 'upgrade', player: P, building: bld(), upgrade: r.pick(UPGRADE_IDS), cancel: r.chance(0.1) };
    case 33: return { c: 'research', player: P, building: bld(), tech: r.pick(RESEARCH_IDS), cancel: r.chance(0.1) };
  }
  return null;
}

// ------------------------------------------------------------------------------------------------ invariants
/**
 * `stale`: references to dead / missing entities seen at earlier checks, with the tick first seen. A reference to
 * something that died this tick is normal (dropped at the holder's next update); one held for 5 s is reported.
 */
export function invariants(w: World, stale?: Map<number, number>): string[] {
  const out: string[] = [];
  const nowStale = new Set<number>();
  const held = (k: number) => { nowStale.add(k); if (!stale) return true; const t0 = stale.get(k); if (t0 === undefined) { stale.set(k, w.tick); return false; } return w.tick - t0 >= 100 && w.tick - t0 < 110; };
  const m = w.map;
  const bad = (v: number) => !Number.isFinite(v);
  for (const p of w.players) {
    if (bad(p.cash) || bad(p.ore)) out.push(`${p.name} money not finite cash=${p.cash} ore=${p.ore}`);
    if (p.cash < -1e-6) out.push(`${p.name} cash negative`);
    if (p.ore < -1e-6) out.push(`${p.name} ore negative`);
    if (bad(p.powerOut) || bad(p.powerUse) || p.powerOut < 0 || p.powerUse < 0) out.push(`${p.name} power bad ${p.powerOut}/${p.powerUse}`);
    for (const q of Object.values(p.queues)) {
      if (q.items.length > QUEUE_LIMIT) out.push(`${p.name} ${q.kind} queue over limit ${q.items.length}`);
      if (q.kind === 'structure' && q.items.length > 1) out.push(`${p.name} structure queue holds ${q.items.length}`);
      for (const it of q.items) {
        if (bad(it.progress) || it.progress < 0 || it.progress > 1 + 1e-9 || bad(it.paid) || it.paid < -1e-6) out.push(`${p.name} ${q.kind} item ${it.type} bad progress=${it.progress} paid=${it.paid}`);
        if (!UNITS[it.type] && !BUILDINGS[it.type]) out.push(`${p.name} unknown queued type ${it.type}`);
      }
      if (q.ready && !BUILDINGS[q.ready] && !UNITS[q.ready]) out.push(`${p.name} unknown ready type ${q.ready}`);
    }
    for (const [k, v] of Object.entries(p.superCharge)) if (bad(v as number)) out.push(`${p.name} superCharge ${k} not finite`);
  }
  const seen = new Set<number>();
  for (const e of [...w.units, ...w.buildings]) {
    if (seen.has(e.id)) out.push(`duplicate id ${e.id}`);
    seen.add(e.id);
    if (!e.alive) { out.push(`dead ${e.type.id} #${e.id} still listed`); continue; }
    if (w.entities.get(e.id) !== e) out.push(`${e.type.id} #${e.id} missing from the entity map`);
    if (e.target && !e.target.alive && held(e.id * 65536 + e.target.id)) out.push(`${e.type.id} keeps targeting a dead ${e.target.type.id} for 5 s`);
  }
  for (const u of w.units) {
    if (!u.alive) continue;
    if (bad(u.x) || bad(u.y) || bad(u.heading) || bad(u.hp) || bad(u.turret) || bad(u.altitude)) { out.push(`${u.ut.id} non-finite state x=${u.x} y=${u.y} h=${u.heading} hp=${u.hp} t=${u.turret} alt=${u.altitude}`); continue; }
    if (u.x < 0 || u.y < 0 || u.x >= m.w || u.y >= m.h) out.push(`${u.ut.id} off map (${u.x.toFixed(2)}, ${u.y.toFixed(2)}) order=${u.order.type}`);
    if (u.hp > u.maxHp + 1e-6) out.push(`${u.ut.id} hp over max`);
    if (u.hp <= 0) out.push(`${u.ut.id} alive with hp ${u.hp}`);
    if (u.transport) out.push(`${u.ut.id} is a passenger but listed`);
    for (const ps of u.passengers) {
      if (!ps.alive) out.push(`${u.ut.id} carries a dead ${ps.ut.id}`);
      if (ps.transport !== u.id) out.push(`${u.ut.id} carries ${ps.ut.id} whose transport is ${ps.transport}`);
      if (w.units.includes(ps)) out.push(`passenger ${ps.ut.id} also on the map`);
    }
    // (a truck heading home whose refinery is gone keeps the old id until another refinery exists: it looks again
    // every tick, harmless; any other state must have let go of it)
    if (u.dockAt && u.hstate !== 'toRefinery' && !(w.entities.get(u.dockAt)?.alive) && held(2e9 + u.id)) out.push(`${u.ut.id} docked at a missing structure for 5 s (${u.hstate})`);
    if (u.order.type === 'attack' || u.order.type === 'enter' || u.order.type === 'escort') {
      const t = w.entities.get((u.order as any).target);
      if ((!t || !t.alive) && held(-(u.id * 65536 + (u.order as any).target))) out.push(`${u.ut.id} keeps an ${u.order.type} order on a missing target for 5 s`);
    }
    if (u.kind === 'aircraft' && u.altitude > 0.05) continue;
    const cx = Math.floor(u.x), cy = Math.floor(u.y);
    if (!m.inBounds(cx, cy)) continue;
    const i = m.idx(cx, cy);
    const occ = m.occupant[i];
    if (occ && occ !== u.exitBuilding && m.passableOverride[i] !== 1 && u.kind !== 'aircraft') {
      const b = w.entities.get(occ);
      out.push(`${u.ut.id} inside ${b instanceof Building ? b.bt.id : '?'} order=${u.order.type}`);
    }
    if (u.kind === 'naval' ? !m.navalTerrain(i) : u.kind !== 'aircraft' && !m.terrainPassable(i)) out.push(`${u.ut.id} on illegal terrain t=${m.terrain[i]} tree=${m.tree[i]} order=${u.order.type}`);
  }
  for (const b of w.buildings) {
    if (!b.alive) continue;
    if (bad(b.hp) || b.hp > b.maxHp + 1e-6) out.push(`${b.bt.id} bad hp ${b.hp}/${b.maxHp}`);
    if (b.garrison) for (const id of b.garrison) if (!w.entities.get(id)) out.push(`${b.bt.id} garrison holds missing #${id}`);
    // (a Service Depot's pad reservation lapses lazily: the next vehicle to come takes it over, unitlogic serviceDepot)
    if (b.dockOccupant && !b.bt.repairPad && !(w.entities.get(b.dockOccupant)?.alive)) out.push(`${b.bt.id} dock held by a missing unit`);
  }
  const tkey = (t: string) => { let h = 7; for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) % 999983; return h; };
  // tech counts: every player's owned map is exactly its finished (counted) living structures
  const owned = new Map<object, Map<string, number>>();
  for (const b of w.buildings) {
    if (!b.alive || !b.counted) continue;
    let m2 = owned.get(b.owner);
    if (!m2) owned.set(b.owner, (m2 = new Map()));
    m2.set(b.bt.id, (m2.get(b.bt.id) ?? 0) + 1);
  }
  for (const p of w.players) {
    const want = owned.get(p) ?? new Map<string, number>();
    for (const [t, n] of p.owned) if ((want.get(t) ?? 0) !== n && held(3e9 + p.id * 1e6 + tkey(t))) out.push(`${p.name} owned ${t}=${n} but has ${want.get(t) ?? 0} counted`);
    for (const [t, n] of want) if ((p.owned.get(t) ?? 0) !== n && held(3e9 + p.id * 1e6 + tkey(t))) out.push(`${p.name} has ${n} counted ${t} but owned says ${p.owned.get(t) ?? 0}`);
  }
  // the entity map holds the listed units and structures plus carried / garrisoned infantry, nothing dead
  let carried = 0;
  for (const u of w.units) carried += u.passengers.length;
  for (const b of w.buildings) carried += b.garrison?.length ?? 0;
  for (const e of w.entities.values()) if (!e.alive && held(4e9 + e.id)) { out.push(`dead ${e.type.id} #${e.id} kept in the entity map`); break; }
  if (w.entities.size > w.units.length + w.buildings.length + carried + 8 && held(5e9)) out.push(`entity map ${w.entities.size} > listed ${w.units.length + w.buildings.length} + carried ${carried}`);
  for (const pr of w.projectiles) if (bad(pr.x) || bad(pr.y) || bad(pr.z)) out.push(`projectile ${pr.weapon.id} non-finite`);
  if (w.projectiles.length > 1500) out.push(`projectile count ${w.projectiles.length}`);
  if (stale) for (const k of [...stale.keys()]) if (!nowStale.has(k)) stale.delete(k);
  return out;
}

/** What differs between two worlds, in the parts worldHash covers (first few findings). */
export function diffWorlds(a: World, b: World): string {
  const out: string[] = [];
  const A = a as any, B = b as any;
  const cmp = (what: string, x: unknown, y: unknown) => { const sx = JSON.stringify(x), sy = JSON.stringify(y); if (sx !== sy && out.length < 6) out.push(`${what}: ${sx?.slice(0, 160)} vs ${sy?.slice(0, 160)}`); };
  cmp('tick/rng/nextId', [a.tick, A.rng.s, A.nextId, a.gameOver, a.winnerTeam], [b.tick, B.rng.s, B.nextId, b.gameOver, b.winnerTeam]);
  a.players.forEach((p, i) => {
    const q = b.players[i];
    cmp(`player ${i}`, [p.cash, p.ore, p.storage, p.powerOut, p.powerUse, p.defeated], [q.cash, q.ore, q.storage, q.powerOut, q.powerUse, q.defeated]);
    cmp(`queues ${i}`, Object.entries(p.queues).map(([k, x]) => [k, x.items.map((it) => [it.type, it.progress])]), Object.entries(q.queues).map(([k, x]) => [k, x.items.map((it) => [it.type, it.progress])]));
    cmp(`superCharge ${i}`, Object.entries(p.superCharge), Object.entries(q.superCharge));
  });
  cmp('unit ids', a.units.map((u) => u.id), b.units.map((u) => u.id));
  for (let i = 0; i < a.units.length && out.length < 6; i++) {
    const u = a.units[i], v = b.units[i];
    if (v) cmp(`unit ${u.ut.id}#${u.id}`, [u.x, u.y, u.hp, u.heading, u.alive, u.target?.id ?? 0, u.order.type, u.owner.id], [v.x, v.y, v.hp, v.heading, v.alive, v.target?.id ?? 0, v.order.type, v.owner.id]);
  }
  cmp('building ids', a.buildings.map((x) => x.id), b.buildings.map((x) => x.id));
  for (let i = 0; i < a.buildings.length && out.length < 6; i++) { const x = a.buildings[i], y = b.buildings[i]; if (y) cmp(`building ${x.bt.id}#${x.id}`, [x.hp, x.owner.id, x.cx, x.cy], [y.hp, y.owner.id, y.cx, y.cy]); }
  cmp('projectiles', a.projectiles.map((p) => [p.x, p.y, p.t]), b.projectiles.map((p) => [p.x, p.y, p.t]));
  cmp('crates', A.crates, B.crates);
  if (a.commander && b.commander) a.commander.players.forEach((c, i) => { const d = b.commander!.players[i]; cmp(`commander ${i}`, [c.points, c.unlocked, c.eliteLeft, c.rally.size, c.aegis.size, c.offline.size, c.unlocked.map((id) => c.ready[id] ?? 0)], [d.points, d.unlocked, d.eliteLeft, d.rally.size, d.aegis.size, d.offline.size, d.unlocked.map((id) => d.ready[id] ?? 0)]); });
  if (a.econ && b.econ) {
    a.econ.players.forEach((e, i) => cmp(`econ ${i}`, [e.tier, Object.entries(e.levels)], [b.econ!.players[i].tier, Object.entries(b.econ!.players[i].levels)]));
    for (let i = 0; i < a.buildings.length && out.length < 6; i++) { const x = a.buildings[i] as any, y = b.buildings[i] as any; if (y) cmp(`econ building ${x.bt.id}#${x.id}`, [x.task?.progress, x.upgrades?.length, x.garrison?.length], [y.task?.progress, y.upgrades?.length, y.garrison?.length]); }
  }
  if (a.variety && b.variety) { const v = a.variety, w = b.variety; cmp('variety', [v.rng, v.rng2, v.next, v.active.length, v.dd.level, v.captures], [w.rng, w.rng2, w.next, w.active.length, w.dd.level, w.captures]); }
  let ore = 0; for (let i = 0; i < a.map.ore.length; i++) if (a.map.ore[i] !== b.map.ore[i]) ore++;
  if (ore) out.push(`ore differs in ${ore} cells`);
  return out.join(' ; ') || 'no difference found in the hashed parts';
}

// ------------------------------------------------------------------------------------------------ one case
export interface CaseResult { seed: number; desc: string; ticks: number; cmds: number; issues: Map<string, string>; ms: number }

const key = (s: string) => s.replace(/#\d+/g, '#').replace(/-?\d+(\.\d+)?(e[-+]?\d+)?/g, 'N');

export function runCase(fc: FuzzCase): CaseResult {
  const t0 = performance.now();
  const s = fc.setup;
  const desc = `size=${s.mapSize}${(s as any).mapId ? ' map=' + (s as any).mapId : ''} p=${1 + s.opponents.length}${s.opponents.some((o) => o.ally) ? ' teams' : ''} ${s.rules}${s.mutators?.length ? ' mut=' + s.mutators.join(',') : ''}${s.koth ? ' koth' : ''}${s.water >= 0.9 ? ' sea' : ''}${fc.dmath ? ' dmath' : ''} prep=${fc.prep}${fc.zoo ? '+zoo' : ''} cf=${s.ceasefire}`;
  const issues = new Map<string, string>();
  const add = (kind: string, msg: string, tick: number) => { const k = kind + ':' + key(msg); if (!issues.has(k)) issues.set(k, `[${kind}] t=${(tick / TICK_HZ).toFixed(1)}s ${msg}`); };
  if (fc.dmath) enterPortableMath();
  let tick = 0, ncmds = 0;
  try {
    const A = headlessGame(s).world;
    prepare(A, fc);
    const r = new FRng(fc.seed * 31 + 7);
    const total = fc.minutes * 60 * TICK_HZ;
    const saveAt = Math.floor(total * (0.25 + r.next() * 0.4));
    const log: [number, Command][] = [];
    const hashes = new Map<number, string>();
    const dead: number[] = [];
    const stale = new Map<number, number>();
    let B: World | null = null;
    const killed = (ev: any) => { if (ev.e === 'death') { dead.push(ev.id); if (dead.length > 200) dead.shift(); } };
    for (tick = 0; tick < total && !A.gameOver; tick++) {
      // commands, generated from A's state, checked by the network sanitiser (the legal input space), fed to A and B
      const n = r.chance(0.5) ? r.int(1, 3) : 0;
      for (let k = 0; k < n; k++) {
        const pi = r.chance(fc.others) ? r.int(1, A.players.length - 1) : 0;
        const raw = genCommand(A, r, pi, dead);
        const cmd = raw && sanitizeCommand(JSON.parse(JSON.stringify(raw)), pi);
        if (!cmd) continue;
        log.push([A.tick, JSON.parse(JSON.stringify(cmd))]);
        A.issue(cmd);
        if (B) B.issue(JSON.parse(JSON.stringify(cmd)));
        ncmds++;
      }
      try { A.step(); } catch (e) { add('exception', String((e as Error)?.stack ?? e).split('\n').slice(0, 6).join(' | '), A.tick); break; }
      for (const ev of A.events) killed(ev);
      A.events.length = 0;
      if (A.mission) A.mission.events.length = 0;
      if (B) {
        try { B.step(); } catch (e) { add('exception-loaded', String((e as Error)?.stack ?? e).split('\n').slice(0, 4).join(' | '), B.tick); B = null; }
        if (B) { B.events.length = 0; if (B.mission) B.mission.events.length = 0; }
      }
      if (A.tick % 10 === 0) for (const v of invariants(A, stale)) add('invariant', v, A.tick);
      if (A.tick % 100 === 0) hashes.set(A.tick, worldHash(A));
      if (B && A.tick % 10 === 0 && worldHash(A) !== worldHash(B)) { add('save-load-desync', `diverged ${(A.tick - saveAt) / TICK_HZ}s after a save at ${(saveAt / TICK_HZ).toFixed(1)}s: ` + diffWorlds(A, B), A.tick); B = null; }
      if (tick === saveAt && !process.env.FUZZ_NOSAVE) {
        const json = JSON.parse(JSON.stringify(serializeWorld(A)));
        B = headlessGame({ ...s, load: { version: 1, savedAt: 0, world: json } }).world;
        if (worldHash(A) !== worldHash(B)) add('save-load', 'hash differs right after loading: ' + diffWorlds(A, B), A.tick);
      }
    }
    // replay: the command log into a fresh world
    const C = headlessGame(s).world;
    prepare(C, fc);
    let li = 0, replayBad = false;
    for (let t = 0; t < tick && !C.gameOver; t++) {
      while (li < log.length && log[li][0] === C.tick) C.issue(JSON.parse(JSON.stringify(log[li++][1])));
      try { C.step(); } catch (e) { add('exception-replay', String((e as Error)?.message ?? e), C.tick); replayBad = true; break; }
      C.events.length = 0;
      if (C.mission) C.mission.events.length = 0;
      const h = hashes.get(C.tick);
      if (h && h !== worldHash(C)) { add('replay-desync', `replay diverged at ${(C.tick / TICK_HZ).toFixed(1)}s`, C.tick); replayBad = true; break; }
    }
    void replayBad;
  } catch (e) {
    add('exception-setup', String((e as Error)?.stack ?? e).split('\n').slice(0, 5).join(' | '), tick);
  } finally {
    if (fc.dmath) exitPortableMath();
  }
  return { seed: fc.seed, desc, ticks: tick, cmds: ncmds, issues, ms: performance.now() - t0 };
}

// ------------------------------------------------------------------------------------------------ CLI
if (process.argv[1]?.endsWith('fuzz.ts')) {
  const from = +arg('from', '1'), count = +arg('count', '20'), minutes = +arg('minutes', '5'), size = +arg('size', '0');
  let bad = 0;
  const kinds = new Map<string, number>();
  for (let sd = from; sd < from + count; sd++) {
    const res = runCase(makeCase(sd, minutes, size));
    const tag = res.issues.size ? `FAIL(${res.issues.size})` : 'ok';
    console.log(`seed ${sd} ${tag} ${res.desc} ticks=${res.ticks} cmds=${res.cmds} ${(res.ms / 1000).toFixed(1)}s`);
    if (res.issues.size) bad++;
    for (const [k, v] of res.issues) {
      kinds.set(k.split(':').slice(0, 2).join(':'), (kinds.get(k.split(':').slice(0, 2).join(':')) ?? 0) + 1);
      if (VERBOSE || [...res.issues.keys()].indexOf(k) < 6) console.log('   ', v.slice(0, 400));
    }
  }
  console.log(`\n${count - bad}/${count} cases clean`);
  for (const [k, n] of [...kinds].sort((a, b) => b[1] - a[1])) console.log(`  ${n}x ${k.slice(0, 160)}`);
  process.exit(bad ? 1 : 0);
}
