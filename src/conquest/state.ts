/**
 * Conquest run state: the JSON document saved in localStorage between battles (see storage.ts), plus small
 * pure helpers shared by the generator, the turn logic and the battle builder.
 */
import { Rng } from '../core/rng';
import type { Faction } from '../data/rules';
import type { Terrain, Climate } from './geo';
import { PERSONALITIES, RESEARCH, LOCKED_TYPES, MONTHS, type Difficulty, type PersonalityId, type ResourceKind } from './data';
import type { BattleSpec, BattleKind } from './battle';

export const RUN_VERSION = 1;

export type Owner = 'player' | 'enemy' | 'neutral';
export type AttackObjective = 'assault' | 'capture' | 'hold' | 'naval';

export interface Territory {
  id: string;
  name: string;
  /** Site in projected map px (geo.proj). */
  x: number;
  y: number;
  lon: number;
  lat: number;
  terrain: Terrain;
  coastal: boolean;
  capital?: 'player' | 'enemy';
  /** Strategic value 1..3: loot, research points, perk picks, score. */
  value: number;
  /** War chest income per turn while the player holds it. */
  income: number;
  res?: ResourceKind;
  /** Battle type when the player attacks it. */
  objective: AttackObjective;
  owner: Owner;
  /** Garrison strength 1..6 while held by the enemy / a neutral. */
  strength: number;
  /** Enemy front (commander) index. */
  front: number;
  /** Player fortifications 0..2 (pre-built defences in defence battles). */
  fort: number;
  /** Partisans will join an attack here (event). */
  partisans?: boolean;
  /** Turn the player took it. */
  captured?: number;
}

export interface Link {
  a: string;
  b: string;
  /** Sea lane (no land border): attacks across it are amphibious / naval. */
  sea: boolean;
}

export interface Veteran {
  id: number;
  type: string;
  /** 1 veteran, 2 elite. */
  rank: number;
  xp: number;
  name: string;
  battles: number;
  joined: number;
}

export interface EnemyFront {
  commander: string;
  personality: PersonalityId;
}

export interface PendingBattle {
  spec: BattleSpec;
  action: 'attack' | 'defend';
  /** Credits taken from the war chest for this battle. */
  committed: number;
}

export interface PendingEvent {
  id: string;
  territory?: string;
  /** Extra data (e.g. a named defector, the threatened superweapon kind). */
  data?: Record<string, any>;
}

export type LogKind = 'win' | 'loss' | 'info' | 'event' | 'threat' | 'perk' | 'research' | 'income';
export interface LogEntry {
  turn: number;
  kind: LogKind;
  text: string;
}

export interface VetChange {
  id: number;
  name: string;
  type: string;
  rank: number;
  before: number;
  /** survived | promoted | lost | recovered | recruit */
  fate: 'survived' | 'promoted' | 'lost' | 'recovered' | 'recruit';
}

export interface BattleReport {
  battleId: string;
  territory: string;
  name: string;
  kind: BattleKind;
  action: 'attack' | 'defend';
  won: boolean;
  time: number;
  par: number;
  captured: boolean;
  /** Territory lost (failed defence). */
  lost: boolean;
  committed: number;
  returned: number;
  loot: number;
  bonus: { label: string; credits: number; rp: number }[];
  rp: number;
  morale: number;
  veterans: VetChange[];
  objectives: { text: string; primary: boolean; state: string }[];
  kills: number;
  losses: number;
  perkOffered: boolean;
  superweaponDestroyed?: boolean;
}

export interface RunStats {
  battlesWon: number;
  battlesLost: number;
  defended: number;
  captured: number;
  capturedValue: number;
  lost: number;
  kills: number;
  losses: number;
  veteransLost: number;
  peakTerritories: number;
  creditsEarned: number;
}

export interface ScoreLine { label: string; value: number }
export interface Score { lines: ScoreLine[]; multiplier: number; total: number; renown: number; xp: number }

export interface ConquestRun {
  v: number;
  id: string;
  seed: number;
  faction: Faction;
  enemy: Faction;
  difficulty: Difficulty;
  doctrine: string;
  turn: number;
  status: 'active' | 'won' | 'lost';
  /** Why the run ended (defeat reason / victory line). */
  ending?: string;
  /** RNG state for everything decided between battles. */
  rng: number;
  warChest: number;
  rp: number;
  morale: number;
  moraleMax: number;
  perks: string[];
  research: string[];
  territories: Territory[];
  links: Link[];
  fronts: EnemyFront[];
  /** Commander of the enemy capital (boss battle). */
  boss: EnemyFront;
  core: Veteran[];
  nextVet: number;
  /** Enemy counterattack declared against a player territory: answer it this turn or lose it. */
  threat: { target: string; from: string } | null;
  /** Enemy superweapon being readied in a territory: strikes when `turns` reaches 0. */
  superThreat: { territory: string; turns: number; kind: 'nuke' | 'iron' | 'chrono' } | null;
  pending: PendingBattle | null;
  event: PendingEvent | null;
  perkChoice: string[] | null;
  report: BattleReport | null;
  /** Battle lost last turn: the enemy pursues (counterattack more likely). */
  pursuit: boolean;
  log: LogEntry[];
  stats: RunStats;
  startedAt: number;
  endedAt?: number;
  score?: Score;
  /** Meta unlocks earned when the run ended (doctrines, titles, perks). */
  unlocks?: string[];
  /** Renown when the run started (meta progression gates the perk pool). */
  renown: number;
  /** Operation codename (display). */
  name: string;
  /** Where the core army stands on the map (display). */
  armyAt: string;
  /** The last battle report has been shown. */
  reportSeen: boolean;
}

// =====================================================================================================
// Helpers
// =====================================================================================================
/** Run a function with the run's RNG and store its state back (between-battle randomness is deterministic). */
export function withRng<T>(run: ConquestRun, fn: (rng: Rng) => T): T {
  const outer = activeRng.get(run);
  if (outer) return fn(outer); // nested: share the stream
  const rng = new Rng(1);
  (rng as any).s = run.rng >>> 0;
  activeRng.set(run, rng);
  try {
    return fn(rng);
  } finally {
    activeRng.delete(run);
    run.rng = (rng as any).s >>> 0;
  }
}
const activeRng = new WeakMap<ConquestRun, Rng>();

export function territory(run: ConquestRun, id: string): Territory {
  const t = run.territories.find((x) => x.id === id);
  if (!t) throw new Error(`unknown territory ${id}`);
  return t;
}
export function findTerritory(run: ConquestRun, id: string | undefined | null): Territory | undefined {
  return id ? run.territories.find((x) => x.id === id) : undefined;
}

export function neighbours(run: ConquestRun, id: string): { id: string; sea: boolean }[] {
  const out: { id: string; sea: boolean }[] = [];
  for (const l of run.links) {
    if (l.a === id) out.push({ id: l.b, sea: l.sea });
    else if (l.b === id) out.push({ id: l.a, sea: l.sea });
  }
  return out;
}

export function linkBetween(run: ConquestRun, a: string, b: string): Link | undefined {
  return run.links.find((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a));
}

export const owned = (run: ConquestRun) => run.territories.filter((t) => t.owner === 'player');
export const hasPerk = (run: ConquestRun, id: string) => run.perks.includes(id);
export const hasResearch = (run: ConquestRun, id: string) => run.research.includes(id);
export const capitalOf = (run: ConquestRun, side: 'player' | 'enemy') => run.territories.find((t) => t.capital === side)!;
export const resCount = (run: ConquestRun, r: ResourceKind) => owned(run).filter((t) => t.res === r).length;

/** Breadth-first graph distances from a territory over the links. */
export function distances(run: Pick<ConquestRun, 'links'>, from: string): Map<string, number> {
  const d = new Map<string, number>([[from, 0]]);
  const q = [from];
  while (q.length) {
    const cur = q.shift()!;
    for (const l of run.links) {
      const n = l.a === cur ? l.b : l.b === cur ? l.a : null;
      if (!n || d.has(n)) continue;
      d.set(n, d.get(cur)! + 1);
      q.push(n);
    }
  }
  return d;
}

/** Core army capacity: 6 + perks, research and manpower territories. */
export function coreCapacity(run: ConquestRun): number {
  return 6 + (hasPerk(run, 'hardened_core') ? 3 : 0) + (hasResearch(run, 'academy') ? 3 : 0) + Math.min(3, resCount(run, 'manpower'));
}

/** Type ids the human may build in battle (everything except unresearched tech). */
export function allowedTypes(run: ConquestRun, allTypes: string[], extra: string[] = []): string[] {
  const unlocked = new Set<string>(extra);
  for (const r of RESEARCH) if (run.research.includes(r.id)) for (const u of r.unlocks ?? []) unlocked.add(u);
  return allTypes.filter((t) => !LOCKED_TYPES.has(t) || unlocked.has(t));
}

/** Calendar: turn 1 is March 1953, one month per turn. */
export function dateOf(turn: number): { month: number; year: number; label: string } {
  const k = 2 + turn - 1;
  const month = ((k % 12) + 12) % 12, year = 1953 + Math.floor(k / 12);
  return { month, year, label: `${MONTHS[month]} ${year}` };
}

/** Battle climate from latitude, terrain and season. */
export function climateOf(t: Pick<Territory, 'lat' | 'lon' | 'terrain'>, turn: number): Climate {
  const { month } = dateOf(turn);
  const winterMonths = month === 11 || month <= 1;
  const coldSeason = month >= 9 || month <= 3;
  if (t.lat >= 59.5) return 'winter';
  if (t.terrain === 'mountain' && (coldSeason || t.lat > 45)) return coldSeason ? 'winter' : 'temperate';
  if (t.lat >= 53.5 && t.lon >= 23 && coldSeason) return 'winter';
  if (winterMonths && t.lat >= 47) return 'winter';
  if (t.lat < 41.5 && month >= 4 && month <= 8 && t.terrain !== 'islands') return 'desert';
  if (t.lat < 40 && (t.terrain === 'steppe' || t.terrain === 'plains')) return 'desert';
  return 'temperate';
}

export function personalityOf(run: ConquestRun, t: Territory) {
  const f = t.capital === 'enemy' ? run.boss : run.fronts[t.front] ?? run.fronts[0];
  return { ...f, def: PERSONALITIES[f.personality] };
}

export function log(run: ConquestRun, kind: LogKind, text: string) {
  run.log.push({ turn: run.turn, kind, text });
  if (run.log.length > 120) run.log.splice(0, run.log.length - 120);
}

/** Enemy-held / neutral territories the player can attack this turn, with the territory to attack from. */
export function attackTargets(run: ConquestRun): { target: string; from: string; sea: boolean }[] {
  const out: { target: string; from: string; sea: boolean }[] = [];
  for (const t of run.territories) {
    if (t.owner === 'player') continue;
    let best: { from: string; sea: boolean } | null = null;
    for (const n of neighbours(run, t.id)) {
      const src = territory(run, n.id);
      if (src.owner !== 'player') continue;
      // prefer a land border over a sea lane
      if (!best || (best.sea && !n.sea)) best = { from: src.id, sea: n.sea };
    }
    if (best) out.push({ target: t.id, ...best });
  }
  return out;
}

export function emptyStats(): RunStats {
  return { battlesWon: 0, battlesLost: 0, defended: 0, captured: 0, capturedValue: 0, lost: 0, kills: 0, losses: 0, veteransLost: 0, peakTerritories: 0, creditsEarned: 0 };
}
