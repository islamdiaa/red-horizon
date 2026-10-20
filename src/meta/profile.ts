/**
 * Commander profile persisted in localStorage under `rh.profile`. Loading is migration-safe:
 * unknown / malformed fields fall back to defaults, older versions are upgraded step by step and
 * fields written by newer builds are preserved untouched.
 */

import { defaultContracts, normalizeContracts, type ContractsState } from './contracts';
import { defaultCosmetics, normalizeCosmetics, type CosmeticsState } from './unlocks';

export const PROFILE_KEY = 'rh.profile';
/** v2: contracts, Commendations and cosmetics (src/meta/contracts.ts, src/meta/unlocks.ts). */
export const PROFILE_VERSION = 2;
/** Commendations never exceed this (corrupt or edited profiles are clamped). */
export const MAX_COMMENDATIONS = 1_000_000;

export interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

/** localStorage when available (and writable), otherwise an in-memory store (node tests, private mode). */
export function defaultStorage(): KV {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    if (ls) {
      const k = '__rh_probe';
      ls.setItem(k, '1');
      ls.removeItem(k);
      return ls;
    }
  } catch { /* fall through */ }
  const mem = new Map<string, string>();
  return { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v) };
}

export type FactionKey = 'allies' | 'soviet';
export type DiffKey = 'recruit' | 'easy' | 'normal' | 'hard' | 'brutal';

export interface LifetimeStats {
  games: number;
  wins: number;
  losses: number;
  skirmishes: number;
  skirmishWins: number;
  missions: number;
  missionWins: number;
  /** Seconds of battle time. */
  timePlayed: number;
  kills: number;
  structuresDestroyed: number;
  unitsLost: number;
  structuresLost: number;
  unitsBuilt: number;
  structuresBuilt: number;
  harvested: number;
  spent: number;
  gamesByFaction: Record<FactionKey, number>;
  winsByFaction: Record<FactionKey, number>;
  gamesByDifficulty: Record<DiffKey, number>;
  winsByDifficulty: Record<DiffKey, number>;
  /** Kills credited to each unit type (favourite unit). */
  killsByUnit: Record<string, number>;
  fastestWin: number | null;
  bestSurvivalWave: number;
  bestSurvivalScore: number;
  survivalRuns: number;
  dailyPlayed: number;
  dailyWins: number;
}

export interface MatchRecord {
  at: number;
  mode: 'skirmish' | 'mission';
  missionId?: string;
  title: string;
  faction: string;
  difficulty?: string;
  opponents: number;
  won: boolean;
  abandoned?: boolean;
  time: number;
  kills: number;
  lost: number;
  score?: number;
  stars?: number;
  wave?: number;
  xp: number;
  medals: string[];
  climate?: string;
}

export interface DailyRecord {
  score: number;
  won: boolean;
  time: number;
  attempts: number;
  at: number;
}

export interface Profile {
  v: number;
  name: string;
  created: number;
  /** Last faction played (drives rank naming and insignia colours). */
  faction: FactionKey;
  xp: number;
  stats: LifetimeStats;
  counters: Record<string, number>;
  /** Unlocked medals: number of tiers reached and when. */
  medals: Record<string, { tier: number; at: number[] }>;
  history: MatchRecord[];
  daily: { best: Record<string, DailyRecord>; streak: number; longest: number; lastDay: string | null };
  survival: Record<string, { bestScore: number; bestWave: number; runs: number; at: number }>;
  climates: Record<string, number>;
  /** Daily and weekly contracts (v2). */
  contracts: ContractsState;
  /** Commendations: earned from contracts, spent in the Locker; never purchasable (v2). */
  commendations: number;
  /** Claimed, equipped and announced cosmetics (v2). */
  cosmetics: CosmeticsState;
}

export function defaultStats(): LifetimeStats {
  return {
    games: 0, wins: 0, losses: 0, skirmishes: 0, skirmishWins: 0, missions: 0, missionWins: 0, timePlayed: 0,
    kills: 0, structuresDestroyed: 0, unitsLost: 0, structuresLost: 0, unitsBuilt: 0, structuresBuilt: 0, harvested: 0, spent: 0,
    gamesByFaction: { allies: 0, soviet: 0 }, winsByFaction: { allies: 0, soviet: 0 },
    gamesByDifficulty: { recruit: 0, easy: 0, normal: 0, hard: 0, brutal: 0 }, winsByDifficulty: { recruit: 0, easy: 0, normal: 0, hard: 0, brutal: 0 }, // (older profiles: recruit filled in as 0)
    killsByUnit: {}, fastestWin: null, bestSurvivalWave: 0, bestSurvivalScore: 0, survivalRuns: 0, dailyPlayed: 0, dailyWins: 0,
  };
}

export function defaultProfile(now = Date.now()): Profile {
  return {
    v: PROFILE_VERSION, name: 'Commander', created: now, faction: 'allies', xp: 0, stats: defaultStats(), counters: {}, medals: {},
    history: [], daily: { best: {}, streak: 0, longest: 0, lastDay: null }, survival: {}, climates: {},
    contracts: defaultContracts(), commendations: 0, cosmetics: defaultCosmetics(),
  };
}

// ---------------------------------------------------------------------------
// Defensive readers
// ---------------------------------------------------------------------------
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown, d: string): string => (typeof v === 'string' ? v : d);
function numRecord(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (isObj(v)) for (const [k, x] of Object.entries(v)) if (typeof x === 'number' && Number.isFinite(x)) out[k] = x;
  return out;
}
function mergeNums<T extends object>(def: T, v: unknown): T {
  const out = { ...def } as Record<string, unknown>;
  if (!isObj(v)) return out as T;
  for (const k of Object.keys(def)) {
    const dv = (def as Record<string, unknown>)[k];
    const x = v[k];
    if (typeof dv === 'number') out[k] = num(x, dv);
    else if (dv === null) out[k] = typeof x === 'number' && Number.isFinite(x) ? x : null;
    else if (isObj(dv)) out[k] = { ...dv, ...numRecord(x) };
  }
  return out as T;
}

/** Migrations from version n to n+1 (operate on raw JSON). */
const MIGRATIONS: Record<number, (p: Obj) => Obj> = {
  // v0: pre-release profiles had no version field and stored `rank` instead of computing it
  0: (p) => {
    const { rank: _drop, ...rest } = p as Obj & { rank?: unknown };
    return { ...rest, v: 1 };
  },
  // v1 -> v2: contracts, Commendations and cosmetics start empty (normalizeProfile fills the defaults);
  // unlocks earned before v2 (rank, wins, medals) are derived from the record, so nothing is lost
  1: (p) => ({ ...p, v: 2 }),
};

export function normalizeProfile(raw: unknown, now = Date.now()): Profile {
  const d = defaultProfile(now);
  if (!isObj(raw)) return d;
  let p: Obj = raw;
  let v = num(p.v, 0);
  while (v < PROFILE_VERSION && MIGRATIONS[v]) {
    try { p = MIGRATIONS[v](p); } catch { /* keep going with what we have */ }
    v++;
  }
  const medals: Profile['medals'] = {};
  if (isObj(p.medals)) {
    for (const [k, m] of Object.entries(p.medals)) {
      if (isObj(m) && num(m.tier) > 0) medals[k] = { tier: Math.floor(num(m.tier)), at: Array.isArray(m.at) ? m.at.filter((x): x is number => typeof x === 'number') : [] };
    }
  }
  const history: MatchRecord[] = Array.isArray(p.history)
    ? p.history.filter(isObj).slice(0, 20).map((h) => ({
      at: num(h.at), mode: h.mode === 'mission' ? 'mission' : 'skirmish', missionId: typeof h.missionId === 'string' ? h.missionId : undefined,
      title: str(h.title, 'Battle'), faction: str(h.faction, 'allies'), difficulty: typeof h.difficulty === 'string' ? h.difficulty : undefined,
      opponents: num(h.opponents, 1), won: !!h.won, abandoned: !!h.abandoned, time: num(h.time), kills: num(h.kills), lost: num(h.lost),
      score: typeof h.score === 'number' ? h.score : undefined, stars: typeof h.stars === 'number' ? h.stars : undefined,
      wave: typeof h.wave === 'number' ? h.wave : undefined, xp: num(h.xp),
      medals: Array.isArray(h.medals) ? h.medals.filter((x): x is string => typeof x === 'string') : [], climate: typeof h.climate === 'string' ? h.climate : undefined,
    }))
    : [];
  const dailyRaw = isObj(p.daily) ? p.daily : {};
  const best: Record<string, DailyRecord> = {};
  if (isObj(dailyRaw.best)) {
    for (const [k, r] of Object.entries(dailyRaw.best)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(k) && isObj(r)) best[k] = { score: num(r.score), won: !!r.won, time: num(r.time), attempts: num(r.attempts, 1), at: num(r.at) };
    }
  }
  const survival: Profile['survival'] = {};
  if (isObj(p.survival)) {
    for (const [k, r] of Object.entries(p.survival)) {
      if (isObj(r)) survival[k] = { bestScore: num(r.bestScore), bestWave: num(r.bestWave), runs: num(r.runs), at: num(r.at) };
    }
  }
  const stats = mergeNums(defaultStats(), p.stats);
  stats.killsByUnit = numRecord(isObj(p.stats) ? p.stats.killsByUnit : undefined);
  return {
    ...p, // keep fields written by newer versions
    v: Math.max(PROFILE_VERSION, num(p.v, PROFILE_VERSION)),
    name: str(p.name, d.name).slice(0, 24) || d.name,
    created: num(p.created, now),
    faction: p.faction === 'soviet' ? 'soviet' : 'allies',
    xp: Math.max(0, num(p.xp)),
    stats,
    counters: numRecord(p.counters),
    medals,
    history,
    daily: { best, streak: num(dailyRaw.streak), longest: num(dailyRaw.longest), lastDay: typeof dailyRaw.lastDay === 'string' ? dailyRaw.lastDay : null },
    survival,
    climates: numRecord(p.climates),
    contracts: normalizeContracts(p.contracts),
    commendations: Math.min(MAX_COMMENDATIONS, Math.max(0, Math.floor(num(p.commendations)))),
    cosmetics: normalizeCosmetics(p.cosmetics),
  };
}

export function loadProfile(storage: KV = defaultStorage()): Profile {
  try {
    const raw = storage.getItem(PROFILE_KEY);
    return normalizeProfile(raw ? JSON.parse(raw) : null);
  } catch {
    return defaultProfile();
  }
}

export function saveProfile(p: Profile, storage: KV = defaultStorage()) {
  try {
    storage.setItem(PROFILE_KEY, JSON.stringify(p));
  } catch { /* quota / private mode: progress for this session only */ }
}
