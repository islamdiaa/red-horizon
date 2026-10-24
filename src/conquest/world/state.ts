/**
 * World Conquest run state: the JSON document saved between turns (storage.ts), and the small pure helpers every
 * rule module shares (index caches, the run's random generator, ownership queries).
 *
 * Determinism: everything random goes through `withRng(run, ...)`, which runs on the run's own mulberry32 state
 * (`run.rng`) and stores it back. No Math.random, no Date, no iteration over unordered state: arrays only, in a
 * fixed order. The caches below are derived from the run's arrays and never feed back into it.
 */
import { Rng } from '../../core/rng';
import type { Faction } from '../../data/rules';
import type { Veteran } from '../state';
import type { BattleSpec } from '../battle';
import type { CardKind, Continent, LandmarkId } from './types';

export const WORLD_RUN_VERSION = 1;
/** Owner of territories no power holds (they defend, never attack). */
export const NEUTRAL = -1;
/** The human player's power id. */
export const HUMAN = 0;

export type WorldSize = 'world' | 'blitz';
export type WorldDifficulty = 'recruit' | 'easy' | 'normal' | 'hard' | 'brutal';
export const WORLD_DIFFICULTIES: WorldDifficulty[] = ['recruit', 'easy', 'normal', 'hard', 'brutal'];
export type Phase = 'reinforce' | 'attack' | 'fortify';
/** Rival personalities (the human's power has 'human'). */
export type PowerPersonality = 'holder' | 'aggressor' | 'turtle' | 'opportunist' | 'naval';
export const PERSONALITY_IDS: PowerPersonality[] = ['holder', 'aggressor', 'turtle', 'opportunist', 'naval'];

export interface WTerritory {
  /** Region id (WORLD_REGIONS). */
  id: string;
  zone: string;
  continent: Continent;
  lon: number;
  lat: number;
  owner: number;
  troops: number;
  /** The power whose capital this is (stays a capital when taken: +2 troops a turn to whoever holds it). */
  capital?: number;
  /** Sea lanes from or to here are usable (a port at one end). */
  port: boolean;
  /** Has at least one sea lane. */
  coastal: boolean;
  landmark?: LandmarkId;
}

export interface WLink {
  a: string;
  b: string;
  sea: boolean;
}

export interface WZone {
  id: string;
  continent: Continent;
  /** Troops a turn for holding every territory in it (in this run). */
  bonus: number;
  territories: string[];
}

export interface WPower {
  id: number;
  /** Regime name key (src/i18n/en/world.ts `regime.<key>`); the human's is 'player'. */
  name: string;
  /** Fictional commander (src/conquest/data.ts COMMANDERS); the human's is ''. */
  commander: string;
  faction: Faction;
  personality: PowerPersonality | 'human';
  /** Homeland id it started from. */
  home: string;
  /** Its capital territory id. */
  capital: string;
  cards: CardKind[];
  alive: boolean;
  color: number;
  /** Ceasefire with the human lasts until the end of this turn (0 = none). Rivals only. */
  ceasefire: number;
  /** Turn until which nobody signs a ceasefire with this power (it broke one). */
  distrust: number;
  /** A ceasefire was last proposed to it on this turn (one offer per rival every few turns). */
  offered: number;
  eliminatedBy?: number;
  eliminatedTurn?: number;
  /** Troops it lost to each power (decays): who it is angry with (the AI's grudges). */
  grudge: number[];
}

/** Everything the run's diary and the rivals' playback can say (keys + params: src/i18n/en/world.ts `event.<kind>`). */
export type WorldEvent =
  | { kind: 'turn'; power: number; turn: number }
  | { kind: 'reinforce'; power: number; to: string; n: number }
  | { kind: 'trade'; power: number; cards: CardKind[]; n: number }
  | { kind: 'attack'; power: number; from: string; to: string; defender: number; attLoss: number; defLoss: number; rolls: number; conquered: boolean; dice?: DiceRoll[]; battle?: boolean }
  | { kind: 'conquer'; power: number; from: string; to: string; n: number; prev: number }
  | { kind: 'fortify'; power: number; from: string; to: string; n: number }
  | { kind: 'card'; power: number; card: CardKind }
  | { kind: 'eliminated'; power: number; by: number; cards: number }
  | { kind: 'zone'; power: number; zone: string }
  | { kind: 'ceasefire'; power: number; with: number; turns: number }
  | { kind: 'refused'; power: number; with: number }
  | { kind: 'break'; power: number; with: number }
  | { kind: 'offer'; power: number; turns: number }
  | { kind: 'defence'; power: number; from: string; to: string; n: number }
  | { kind: 'battle'; power: number; from: string; to: string; won: boolean; attLoss: number; defLoss: number }
  | { kind: 'medal'; power: number; medal: string }
  | { kind: 'won'; power: number; ending: string }
  | { kind: 'lost'; power: number; ending: string };
export type WorldEventKind = WorldEvent['kind'];
export type LoggedEvent = WorldEvent & { turn: number };

export interface DiceRoll {
  att: number[];
  def: number[];
  attLoss: number;
  defLoss: number;
}

/** An RTS battle the human committed to (its spec travels in GameSetup.conquest). */
export interface WorldPending {
  spec: BattleSpec;
  action: 'attack' | 'defend';
  from: string;
  to: string;
  attacker: number;
  defender: number;
  /** Troops in the fight on each side. */
  attackers: number;
  defenders: number;
  committed: number;
}

/** A rival's attack on a key territory of yours, waiting for your choice: let the dice decide, or fight it. */
export interface WorldDefence {
  power: number;
  from: string;
  to: string;
  attackers: number;
}

/** A conquest just made: how many troops moved in, and the range you may change it to (until the next action). */
export interface WorldConquest {
  from: string;
  to: string;
  min: number;
  max: number;
  moved: number;
}

export interface WorldArmy {
  warChest: number;
  rp: number;
  core: Veteran[];
  nextVet: number;
  perks: string[];
  research: string[];
  perkChoice: string[] | null;
  doctrine: string;
}

export interface WorldStats {
  conquered: number;
  lost: number;
  diceAttacks: number;
  battlesWon: number;
  battlesLost: number;
  defencesWon: number;
  defencesLost: number;
  eliminated: number;
  capitals: number;
  cardsTraded: number;
  troopsKilled: number;
  troopsLost: number;
  peakTerritories: number;
  kills: number;
  losses: number;
}

export interface WorldScoreLine { key: string; value: number }
export interface WorldScore { lines: WorldScoreLine[]; multiplier: number; total: number; xp: number }

export interface WorldReport {
  from: string;
  to: string;
  action: 'attack' | 'defend';
  won: boolean;
  captured: boolean;
  attLoss: number;
  defLoss: number;
  moved: number;
  warChest: number;
  rp: number;
  card: CardKind | null;
  score: number;
  veterans: { id: number; name: string; type: string; rank: number; fate: 'survived' | 'promoted' | 'lost' | 'recruit' }[];
  perkOffered: boolean;
}

export interface WorldRun {
  v: number;
  mode: 'world';
  id: string;
  seed: number;
  size: WorldSize;
  difficulty: WorldDifficulty;
  ironman: boolean;
  fog: boolean;
  /** Homeland id the human started from. */
  home: string;
  faction: Faction;
  /** Geography data version the run was built from (atlas.ts). */
  atlas: string;
  turn: number;
  phase: Phase;
  player: number;
  /** Whose turn it is (0 = the human; a rival only while its turn waits on a defence choice). */
  current: number;
  toPlace: number;
  status: 'active' | 'won' | 'lost';
  ending?: string;
  rng: number;
  territories: WTerritory[];
  links: WLink[];
  zones: WZone[];
  powers: WPower[];
  /** Sets traded so far by anyone (the escalation). */
  trades: number;
  /** The current power conquered something this turn (earns a card at the end of it). */
  conqueredThisTurn: boolean;
  fortifiesLeft: number;
  /** Sea lanes without a port still usable this turn (navy wonder). */
  navyLeft: number;
  /** Portless sea lanes already crossed this turn ("a|b", sorted ids): crossing one again is free. */
  lanes?: string[];
  /** Territories whose defence the human was already asked about during the current rival's turn. */
  asked?: string[];
  /** Attacks the current rival made on the human this turn. */
  humanHits?: number;
  /** Attacks all rivals together made on the human since the human's last turn. */
  roundHits?: number;
  /** Rival attacks on your capitals and wonders stop for your choice: dice, or fight it (default on). */
  askDefence: boolean;
  conquest: WorldConquest | null;
  pending: WorldPending | null;
  defence: WorldDefence | null;
  /** Ceasefire offers from rivals waiting for an answer (expire at the end of your turn). */
  offers: { power: number; turns: number }[];
  /** Fog (Hard and above): last troop count each power saw on each territory (-1 unknown). */
  seen?: number[][];
  army: WorldArmy;
  stats: WorldStats;
  /** Medals earned in this run (continent:<id>, wonder:<id>, homeland:<id>, ...). */
  medals: string[];
  log: LoggedEvent[];
  /** Rival turns played (all powers) since the last territory changed hands: stall detection. */
  quiet: number;
  /** Score earned in RTS battles (worldScore adds it). */
  battleScore: number;
  /** Weekly World key ("2026-W43") when this is the week's challenge. */
  weekly?: string;
  score?: WorldScore;
  /** The last battle report (shown once). */
  report: WorldReport | null;
}

// =====================================================================================================
// Random generator (the run's own stream)
// =====================================================================================================
const activeRng = new WeakMap<WorldRun, Rng>();
export function withRng<T>(run: WorldRun, fn: (rng: Rng) => T): T {
  const outer = activeRng.get(run);
  if (outer) return fn(outer);
  const rng = new Rng(1);
  (rng as unknown as { s: number }).s = run.rng >>> 0;
  activeRng.set(run, rng);
  try {
    return fn(rng);
  } finally {
    activeRng.delete(run);
    run.rng = (rng as unknown as { s: number }).s >>> 0;
  }
}

export function hashStr(s: string, h = 2166136261): number {
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function mix(a: number, b: number): number {
  let h = Math.imul((a ^ 0x9e3779b9) >>> 0, 0x85ebca6b) ^ Math.imul(b >>> 0, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x27d4eb2f); h ^= h >>> 13;
  return h >>> 0;
}

// =====================================================================================================
// Index caches: topology only (ids, links, zones), derived from the run's arrays and rebuilt when they change
// identity (e.g. after a load). Anything that changes during a run is read from the territories themselves.
// =====================================================================================================
export interface RunIndex {
  byId: Map<string, number>;
  /** Neighbour indices per territory. */
  adj: number[][];
  /** Parallel to adj: the link is a sea lane. */
  sea: boolean[][];
  zoneOf: number[];
  zoneIdx: Map<string, number>;
  /** Territory indices per zone. */
  zoneT: number[][];
  /** Zone indices adjacent to each zone. */
  zoneAdj: number[][];
  /** Number of a zone's territories with a neighbour outside the zone. */
  zoneBorders: number[];
}
const indexCache = new WeakMap<WTerritory[], { links: WLink[]; zones: WZone[]; ix: RunIndex }>();

export function ix(run: Pick<WorldRun, 'territories' | 'links' | 'zones'>): RunIndex {
  const c = indexCache.get(run.territories);
  if (c && c.links === run.links && c.zones === run.zones) return c.ix;
  const T = run.territories;
  const byId = new Map<string, number>();
  T.forEach((t, i) => byId.set(t.id, i));
  const adj: number[][] = T.map(() => []), sea: boolean[][] = T.map(() => []);
  for (const l of run.links) {
    const a = byId.get(l.a), b = byId.get(l.b);
    if (a === undefined || b === undefined || a === b) continue;
    adj[a].push(b); sea[a].push(l.sea);
    adj[b].push(a); sea[b].push(l.sea);
  }
  const zoneIdx = new Map<string, number>();
  run.zones.forEach((z, i) => zoneIdx.set(z.id, i));
  const zoneOf = T.map((t) => zoneIdx.get(t.zone) ?? -1);
  const zoneT: number[][] = run.zones.map(() => []);
  T.forEach((_, i) => { if (zoneOf[i] >= 0) zoneT[zoneOf[i]].push(i); });
  const zoneAdj: number[][] = run.zones.map(() => []);
  const zoneBorders = run.zones.map(() => 0);
  T.forEach((_, i) => {
    const z = zoneOf[i];
    let border = false;
    for (const n of adj[i]) {
      const zn = zoneOf[n];
      if (zn !== z) { border = true; if (z >= 0 && zn >= 0 && !zoneAdj[z].includes(zn)) zoneAdj[z].push(zn); }
    }
    if (border && z >= 0) zoneBorders[z]++;
  });
  for (const za of zoneAdj) za.sort((a, b) => a - b);
  // (topology only: ids, links and zones never change in a run; owners, troops and capital markers are read live)
  const out: RunIndex = { byId, adj, sea, zoneOf, zoneIdx, zoneT, zoneAdj, zoneBorders };
  indexCache.set(T, { links: run.links, zones: run.zones, ix: out });
  return out;
}

export function tIndex(run: WorldRun, id: string): number {
  const i = ix(run).byId.get(id);
  if (i === undefined) throw new Error(`unknown territory ${id}`);
  return i;
}
export function terr(run: WorldRun, id: string): WTerritory {
  return run.territories[tIndex(run, id)];
}
export function findTerr(run: WorldRun, id: string | null | undefined): WTerritory | undefined {
  if (!id) return undefined;
  const i = ix(run).byId.get(id);
  return i === undefined ? undefined : run.territories[i];
}

/** Territory indices a power owns, in map order. */
export function ownedIdx(run: WorldRun, p: number): number[] {
  const out: number[] = [];
  run.territories.forEach((t, i) => { if (t.owner === p) out.push(i); });
  return out;
}
export function ownedCount(run: WorldRun, p: number): number {
  let n = 0;
  for (const t of run.territories) if (t.owner === p) n++;
  return n;
}
export function troopsOf(run: WorldRun, p: number): number {
  let n = 0;
  for (const t of run.territories) if (t.owner === p) n += t.troops;
  return n;
}

/** Zones a power holds entirely (zone indices). */
export function heldZones(run: WorldRun, p: number): number[] {
  const X = ix(run);
  const out: number[] = [];
  X.zoneT.forEach((ts, z) => { if (ts.length && ts.every((i) => run.territories[i].owner === p)) out.push(z); });
  return out;
}
export function zoneHolder(run: WorldRun, zoneId: string): number {
  const X = ix(run);
  const z = X.zoneIdx.get(zoneId);
  if (z === undefined) return NEUTRAL;
  const ts = X.zoneT[z];
  if (!ts.length) return NEUTRAL;
  const o = run.territories[ts[0]].owner;
  return o !== NEUTRAL && ts.every((i) => run.territories[i].owner === o) ? o : NEUTRAL;
}

/** Power ids still in the game, rivals only (in order). */
export function aliveRivals(run: WorldRun): number[] {
  return run.powers.filter((p) => p.id !== HUMAN && p.alive).map((p) => p.id);
}

export function emptyWorldStats(): WorldStats {
  return { conquered: 0, lost: 0, diceAttacks: 0, battlesWon: 0, battlesLost: 0, defencesWon: 0, defencesLost: 0, eliminated: 0, capitals: 0, cardsTraded: 0, troopsKilled: 0, troopsLost: 0, peakTerritories: 0, kills: 0, losses: 0 };
}

/** Append to the run's diary (capped). */
export function logEvent(run: WorldRun, e: WorldEvent) {
  run.log.push({ ...e, turn: run.turn } as LoggedEvent);
  if (run.log.length > 240) run.log.splice(0, run.log.length - 240);
}

/** Is a power at ceasefire with another this turn (only rival <-> human ceasefires exist). */
export function atCeasefire(run: WorldRun, a: number, b: number): boolean {
  if (a === b || a === NEUTRAL || b === NEUTRAL) return false;
  if (a !== HUMAN && b !== HUMAN) return false;
  const rival = run.powers[a === HUMAN ? b : a];
  return !!rival && rival.ceasefire >= run.turn;
}
