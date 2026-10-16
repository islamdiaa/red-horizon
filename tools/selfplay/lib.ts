/**
 * Self-play harness core: build a headless skirmish exactly like the game does (src/game.ts), let AIs play
 * it out and collect what happened (winner, length, unit usage, value killed / lost, economy).
 *
 * Used by run.ts (batches of matches over a worker pool), optimize.ts (hill-climbing of AI parameters) and the
 * worker. Everything is deterministic for a given MatchSpec.
 */
import { BUILDINGS, UNITS, WEAPONS, WARHEADS, type Faction } from '../../src/data/rules';
import { generateMap } from '../../src/sim/mapgen';
import { GameMap } from '../../src/sim/map';
import { World, type PlayerSetup } from '../../src/sim/world';
import { TICK_HZ } from '../../src/sim/types';
import { Building, Unit, type Entity } from '../../src/sim/entities';
import type { AIDifficulty } from '../../src/sim/ai';
import type { Personality } from '../../src/sim/ai-personality';
import { loadCuratedMap, getMapDef } from '../../src/maps';
import { LegacyAIController } from './legacy/ai';

export type MapKind = 'land' | 'sea' | 'curated';

export interface PlayerSpec {
  faction: Faction;
  difficulty: AIDifficulty;
  /** Personality id or a full personality object (src/sim/ai-personality.ts); undefined = default. */
  personality?: string | Personality;
  /** Play this slot with the frozen round-4 AI (tools/selfplay/legacy) instead of the current one. */
  legacy?: boolean;
  /** Label used in reports (defaults to personality id / "legacy"). */
  label?: string;
}

export interface MatchSpec {
  id: number;
  seed: number;
  map: MapKind;
  /** Generated maps: edge length (default 96). */
  size?: number;
  /** Curated map id (map = 'curated'). */
  curated?: string;
  players: PlayerSpec[];
  /** Hard stop in simulated minutes (default 45). */
  maxMinutes?: number;
  credits?: number;
  startUnits?: 'mcv' | 'light' | 'heavy';
  /**
   * Rule experiments: field overrides applied to the rules tables for this match only (restored afterwards), e.g.
   * { units: { '4tnk': { cost: 1900 } }, weapons: { TeslaZap: { damage: 90 } }, buildings: { afld: { powers: [] } } }.
   */
  rules?: RuleOverrides;
  /** Generated map knobs (defaults as the skirmish menu: 0.5 / 0.5 / 0.6). */
  water?: number;
  trees?: number;
  ore?: number;
}

export interface PlayerResult {
  slot: number;
  faction: Faction;
  difficulty: AIDifficulty;
  label: string;
  won: boolean;
  defeated: boolean;
  /** Units built by type (first time each unit id was seen). */
  built: Record<string, number>;
  /** Structures placed by type. */
  structures: Record<string, number>;
  /** Value (cost) of enemy units / structures this player destroyed, and of its own it lost. */
  killedValue: number;
  lostValue: number;
  /** Destroyed enemy value by the killer's unit type (cost-effectiveness in real games). */
  killsByType: Record<string, number>;
  /** Own value lost by unit type. */
  lostByType: Record<string, number>;
  harvested: number;
  spent: number;
  /** End-of-game (or timeout) material score: army + structures + bank. */
  score: number;
  /** Minute this player first destroyed an enemy unit or structure (-1 = never). */
  firstKillMin: number;
  /** Superweapon / support power commands issued. */
  powers: Record<string, number>;
}

export interface MatchResult {
  id: number;
  seed: number;
  map: string;
  /** Winning team, or -1 when the game timed out (see `leader`). */
  winnerTeam: number;
  /** Team with the best material score at the end (decides timed-out games in the optimizer). */
  leader: number;
  minutes: number;
  timedOut: boolean;
  players: PlayerResult[];
  /** Wall time of the run (ms) and simulation cost (ms per tick). */
  wallMs: number;
  msPerTick: number;
}

const TEAM_COLORS = [0x3d7be0, 0xd23a2c, 0xe0b030, 0x3fa34d];

export interface RuleOverrides {
  units?: Record<string, Record<string, unknown>>;
  weapons?: Record<string, Record<string, unknown>>;
  warheads?: Record<string, Record<string, unknown>>;
  buildings?: Record<string, Record<string, unknown>>;
}

/** Apply rule overrides in place; returns a function that restores the originals. */
export function applyRules(r?: RuleOverrides): () => void {
  const undo: (() => void)[] = [];
  const patch = (table: Record<string, any>, o?: Record<string, Record<string, unknown>>) => {
    for (const [id, fields] of Object.entries(o ?? {})) {
      const t = table[id];
      if (!t) throw new Error(`rules override: unknown id ${id}`);
      for (const [k, v] of Object.entries(fields)) {
        const had = k in t, old = t[k];
        t[k] = v;
        undo.push(() => { if (had) t[k] = old; else delete t[k]; });
      }
    }
  };
  patch(UNITS, r?.units);
  patch(WEAPONS, r?.weapons);
  patch(WARHEADS, r?.warheads);
  patch(BUILDINGS, r?.buildings);
  return () => { for (const f of undo.reverse()) f(); };
}

/** Build the world for a match, mirroring Game's skirmish setup (map, start shuffle, climate tweaks). */
export function buildMatch(spec: MatchSpec): World {
  const n = spec.players.length;
  let map;
  if (spec.map === 'curated') {
    map = loadCuratedMap(spec.curated!);
    if (!map) throw new Error(`unknown curated map ${spec.curated}`);
    const def = getMapDef(spec.curated!)!;
    if (def.players !== n) throw new Error(`${spec.curated} is a ${def.players}-player map`);
  } else {
    map = generateMap({
      size: spec.size ?? 96, players: n, seed: spec.seed, ore: spec.ore ?? 0.6, trees: spec.trees ?? 0.5,
      water: spec.map === 'sea' ? 1 : spec.water ?? 0.5,
    });
    // (as the game: start positions are shuffled by the seed)
    if (spec.seed & 2) map.startPositions.reverse();
  }
  const players: PlayerSetup[] = spec.players.map((ps, i) => ({
    name: `P${i}`, faction: ps.faction, color: TEAM_COLORS[i], team: i, isHuman: false,
    ai: ps.legacy ? undefined : ps.difficulty,
    personality: ps.legacy ? undefined : ps.personality,
  } as PlayerSetup));
  const world = new World({ map, players, credits: spec.credits ?? 10000, startUnits: spec.startUnits ?? 'light', fog: true, seed: spec.seed });
  // legacy slots: the frozen round-4 controller thinks in the slot order the world would give it
  const legacy = spec.players.map((ps, i) => (ps.legacy ? i : -1)).filter((i) => i >= 0);
  if (legacy.length) {
    const ais: any[] = [];
    for (let i = 0; i < n; i++) {
      const p = world.players[i];
      if (spec.players[i].legacy) {
        const ai = new LegacyAIController(world, p, spec.players[i].difficulty);
        p.isHuman = false;
        ais.push(ai);
      } else {
        ais.push(world.ais.find((a) => a.player === p));
      }
    }
    world.ais = ais.filter(Boolean);
  }
  return world;
}

function labelOf(ps: PlayerSpec): string {
  if (ps.label) return ps.label;
  if (ps.legacy) return 'legacy';
  if (!ps.personality) return 'default';
  return typeof ps.personality === 'string' ? ps.personality : ps.personality.id;
}

/** Material score: what a player still has (units, structures at half value, bank). */
function materialScore(world: World, pid: number): number {
  let s = 0;
  for (const u of world.units) if (u.alive && u.owner.id === pid && !u.ut.supportPlane) s += u.ut.cost * u.healthFrac;
  for (const b of world.buildings) if (b.alive && b.owner.id === pid && !b.bt.mine && !b.bt.wall) s += b.bt.cost * 0.5 * b.healthFrac;
  s += world.players[pid].credits * 0.5;
  return s;
}

/** Play one match to the end (or the time limit) and summarise it. */
export function playMatch(spec: MatchSpec): MatchResult {
  const restore = applyRules(spec.rules);
  try {
    return playMatchInner(spec);
  } finally {
    restore();
  }
}

function playMatchInner(spec: MatchSpec): MatchResult {
  const t0 = performance.now();
  const world = buildMatch(spec);
  const n = spec.players.length;
  const res: PlayerResult[] = spec.players.map((ps, i) => ({
    slot: i, faction: ps.faction, difficulty: ps.difficulty, label: labelOf(ps), won: false, defeated: false,
    built: {}, structures: {}, killedValue: 0, lostValue: 0, killsByType: {}, lostByType: {}, harvested: 0, spent: 0, score: 0,
    firstKillMin: -1, powers: {},
  }));
  // losses / kills: wrap World.kill (every death goes through it)
  const kill = world.kill.bind(world);
  world.kill = (e: Entity, how = 'normal', killer?: Entity) => {
    if (e.alive && how !== 'sold' && !(e instanceof Building && (e.bt.mine || e.bt.wall)) && !(e instanceof Unit && e.ut.supportPlane)) {
      const cost = e.type.cost;
      const victim = res[e.owner.id];
      if (victim) {
        victim.lostValue += cost;
        victim.lostByType[e.type.id] = (victim.lostByType[e.type.id] ?? 0) + cost;
      }
      const k = killer?.owner.id;
      if (k !== undefined && k !== e.owner.id && res[k]) {
        res[k].killedValue += cost;
        res[k].killsByType[killer!.type.id] = (res[k].killsByType[killer!.type.id] ?? 0) + cost;
        if (res[k].firstKillMin < 0) res[k].firstKillMin = world.time / 60;
      }
    }
    kill(e, how, killer);
  };
  const issue = world.issue.bind(world);
  world.issue = (c) => {
    if (c.c === 'superweapon' && res[c.player]) res[c.player].powers[c.kind] = (res[c.player].powers[c.kind] ?? 0) + 1;
    issue(c);
  };
  const seen = new Set<number>();
  const maxTicks = (spec.maxMinutes ?? 45) * 60 * TICK_HZ;
  for (let t = 1; t <= maxTicks; t++) {
    world.step();
    for (const ev of world.events) {
      if (ev.e === 'placed') {
        const b = world.entities.get(ev.id);
        if (b instanceof Building && res[b.owner.id] && !b.bt.mine) res[b.owner.id].structures[b.bt.id] = (res[b.owner.id].structures[b.bt.id] ?? 0) + 1;
      }
    }
    world.events.length = 0;
    if (t % 10 === 0) {
      for (const u of world.units) {
        if (seen.has(u.id)) continue;
        seen.add(u.id);
        if (u.ut.supportPlane || !res[u.owner.id]) continue;
        res[u.owner.id].built[u.ut.id] = (res[u.owner.id].built[u.ut.id] ?? 0) + 1;
      }
    }
    if (world.gameOver) break;
  }
  const scores = world.players.map((p) => materialScore(world, p.id));
  for (const p of world.players) {
    const r = res[p.id];
    r.defeated = p.defeated;
    r.won = world.gameOver && world.winnerTeam === p.team;
    r.harvested = Math.round(p.stats.harvested);
    r.spent = Math.round(p.stats.spent);
    r.score = Math.round(scores[p.id]);
  }
  let leader = 0;
  for (let i = 1; i < n; i++) if (scores[i] > scores[leader]) leader = i;
  const wallMs = performance.now() - t0;
  return {
    id: spec.id, seed: spec.seed, map: spec.map === 'curated' ? spec.curated! : `${spec.map}${spec.size ?? 96}`,
    winnerTeam: world.gameOver ? world.winnerTeam : -1, leader: world.gameOver && world.winnerTeam >= 0 ? world.winnerTeam : leader,
    minutes: world.time / 60, timedOut: !world.gameOver, players: res, wallMs, msPerTick: wallMs / Math.max(1, world.tick),
  };
}

/** Unit ids by category for reports. */
export function unitKind(id: string): string {
  return UNITS[id]?.kind ?? 'building';
}

// ---------------------------------------------------------------------------
// Cost-equal duels (tools/selfplay/balance.ts): equal-budget groups attack-move into each other on open ground
// ---------------------------------------------------------------------------

export interface DuelSpec { a: string; b: string; seed: number; budget: number; rules?: RuleOverrides }
export interface DuelResult extends DuelSpec { aCost: number; bCost: number; aLeft: number; bLeft: number; seconds: number; aN: number; bN: number }

function spawnGroup(w: World, pid: number, type: string, n: number, x: number, y: number, face: number): Unit[] {
  const out: Unit[] = [];
  const isInf = UNITS[type].kind === 'infantry';
  const step = isInf ? 0.6 : 1.1;
  const cols = Math.ceil(Math.sqrt(n * 2));
  for (let k = 0; k < n; k++) {
    const r = Math.floor(k / cols), c = k % cols;
    const u = w.addUnit(type, w.players[pid], x + (pid === 0 ? -r : r) * step, y + (c - cols / 2) * step);
    u.heading = u.prevHeading = u.turret = u.prevTurret = face;
    if (u.kind === 'aircraft') { u.altitude = 1; }
    out.push(u);
  }
  return out;
}

export function playDuel(d: DuelSpec): DuelResult {
  const restore = applyRules(d.rules);
  try {
    return playDuelInner(d);
  } finally {
    restore();
  }
}

function playDuelInner(d: DuelSpec): DuelResult {
  const map = new GameMap(60, 40);
  map.startPositions = [{ x: 8.5, y: 31.5 }, { x: 51.5, y: 8.5 }];
  const w = new World({
    map, credits: 0, startUnits: 'none', fog: false, seed: d.seed,
    players: [{ name: 'A', faction: UNITS[d.a].owner[0], color: 0, team: 0, isHuman: true }, { name: 'B', faction: UNITS[d.b].owner[0], color: 0, team: 1, isHuman: true }],
  });
  w.cratesEnabled = false;
  // equal budgets: pick the budget (between 1x and 2x the nominal one) at which both sides' unit counts cost the
  // closest to each other (Lanchester's square law punishes even a 5% rounding difference)
  let aN = 1, bN = 1, bestErr = Infinity;
  for (let B = d.budget; B <= d.budget * 2; B += 50) {
    const na = Math.max(1, Math.round(B / UNITS[d.a].cost)), nb = Math.max(1, Math.round(B / UNITS[d.b].cost));
    const ca = na * UNITS[d.a].cost, cb = nb * UNITS[d.b].cost;
    const err = Math.abs(ca - cb) / Math.max(ca, cb);
    if (err < bestErr - 0.005) { bestErr = err; aN = na; bN = nb; }
  }
  // alternate creation order (the first-created side would otherwise update first)
  let A: Unit[], B: Unit[];
  if (d.seed % 2) { A = spawnGroup(w, 0, d.a, aN, 20.5, 20.5, 0); B = spawnGroup(w, 1, d.b, bN, 40.5, 20.5, Math.PI); }
  else { B = spawnGroup(w, 1, d.b, bN, 40.5, 20.5, Math.PI); A = spawnGroup(w, 0, d.a, aN, 20.5, 20.5, 0); }
  w.issue({ c: 'move', player: 0, units: A.map((u) => u.id), x: 45.5, y: 20.5, attackMove: true });
  w.issue({ c: 'move', player: 1, units: B.map((u) => u.id), x: 15.5, y: 20.5, attackMove: true });
  let t = 0, quiet = 0;
  const max = 240 * TICK_HZ;
  for (; t < max; t++) {
    w.step();
    const fired = w.events.some((e) => e.e === 'fire');
    w.events.length = 0;
    if (!A.some((u) => u.alive) || !B.some((u) => u.alive)) break;
    quiet = fired ? 0 : quiet + 1;
    if (quiet > 30 * TICK_HZ && t > 40 * TICK_HZ) break;
    if (t % (TICK_HZ * 5) === 0) {
      const ia = A.filter((u) => u.alive && u.order.type === 'idle').map((u) => u.id);
      const ib = B.filter((u) => u.alive && u.order.type === 'idle').map((u) => u.id);
      const ca = B.find((u) => u.alive), cb = A.find((u) => u.alive);
      if (ia.length && ca) w.issue({ c: 'move', player: 0, units: ia, x: ca.x, y: ca.y, attackMove: true });
      if (ib.length && cb) w.issue({ c: 'move', player: 1, units: ib, x: cb.x, y: cb.y, attackMove: true });
    }
  }
  const val = (us: Unit[]) => us.reduce((s, u) => s + (u.alive ? u.ut.cost * u.hp / u.maxHp : 0), 0);
  return { ...d, aCost: aN * UNITS[d.a].cost, bCost: bN * UNITS[d.b].cost, aLeft: val(A), bLeft: val(B), seconds: t / TICK_HZ, aN, bN };
}
