/**
 * World Conquest persistence (localStorage, or any KV store in tests), versioned:
 *
 *   rh.world.run   the active (or just finished) run: WorldRun JSON, version WORLD_RUN_VERSION
 *   rh.world.meta  across runs: records, medals, Weekly World bests, history (WorldMeta, WORLD_META_VERSION)
 *   rh.save.conquest  the battle in progress (Game.save, shared with Europe Conquest: check its runId)
 *
 * recordWorldEnd counts a finished run once (by id): medals, records, the weekly best and commander XP on the
 * shared profile. The clock is read only here at the edge (`now`, for the history's date).
 */
import { defaultStorage, loadProfile, saveProfile, type KV } from '../../meta/profile';
import { rankIndexFor, rankName } from '../../meta/ranks';
import { endMedals, worldScore } from './score';
import { WORLD_RUN_VERSION, ownedCount, HUMAN, type WorldRun } from './state';

export const WORLD_RUN_KEY = 'rh.world.run';
export const WORLD_META_KEY = 'rh.world.meta';
export const WORLD_META_VERSION = 1;
/** Commander XP for each new medal. */
export const MEDAL_XP = 150;

export function saveWorldRun(run: WorldRun, kv: KV = defaultStorage()): boolean {
  try { kv.setItem(WORLD_RUN_KEY, JSON.stringify(run)); return true; } catch { return false; }
}

/** The saved run, or null (missing, corrupt, another version). Untrusted JSON: shape-checked before use. */
export function loadWorldRun(kv: KV = defaultStorage()): WorldRun | null {
  try {
    const raw = kv.getItem(WORLD_RUN_KEY);
    if (!raw) return null;
    return parseWorldRun(raw);
  } catch {
    return null;
  }
}

export function parseWorldRun(raw: string): WorldRun | null {
  try {
    const r = JSON.parse(raw) as WorldRun;
    if (!r || typeof r !== 'object' || r.mode !== 'world' || r.v !== WORLD_RUN_VERSION) return null;
    if (!Array.isArray(r.territories) || !Array.isArray(r.links) || !Array.isArray(r.zones) || !Array.isArray(r.powers) || !r.territories.length) return null;
    if (!r.territories.every((t) => t && typeof t.id === 'string' && Number.isInteger(t.owner) && Number.isInteger(t.troops) && t.troops >= 0)) return null;
    if (!r.powers.every((p, i) => p && p.id === i && Array.isArray(p.cards))) return null;
    if (typeof r.rng !== 'number' || typeof r.turn !== 'number') return null;
    // fields added after version 1 shipped get their defaults here
    r.offers ??= [];
    r.medals ??= [];
    r.log ??= [];
    r.battleScore ??= 0;
    r.quiet ??= 0;
    r.askDefence ??= true;
    r.report ??= null;
    return r;
  } catch {
    return null;
  }
}

export function clearWorldRun(kv: KV = defaultStorage()) {
  try { kv.setItem(WORLD_RUN_KEY, ''); } catch { /* ignore */ }
}

// =====================================================================================================
// Meta
// =====================================================================================================
export interface WorldRecord {
  id: string;
  at: number;
  home: string;
  size: string;
  difficulty: string;
  status: 'won' | 'lost';
  ending: string;
  turns: number;
  score: number;
  territories: number;
  weekly?: string;
}

export interface WorldMeta {
  v: number;
  runs: number;
  victories: number;
  bestScore: number;
  /** Fewest turns to a victory, per size. */
  bestTurns: { world: number | null; blitz: number | null };
  medals: string[];
  /** Best score per Weekly World key (the last 26 weeks). */
  weekly: { week: string; score: number; turns: number; won: boolean }[];
  history: WorldRecord[];
  /** Runs already counted. */
  recorded: string[];
}

export function defaultWorldMeta(): WorldMeta {
  return { v: WORLD_META_VERSION, runs: 0, victories: 0, bestScore: 0, bestTurns: { world: null, blitz: null }, medals: [], weekly: [], history: [], recorded: [] };
}

export function loadWorldMeta(kv: KV = defaultStorage()): WorldMeta {
  try {
    const raw = kv.getItem(WORLD_META_KEY);
    if (!raw) return defaultWorldMeta();
    const m = JSON.parse(raw) as Partial<WorldMeta>;
    if (!m || typeof m !== 'object' || (m.v ?? 1) > WORLD_META_VERSION) return defaultWorldMeta();
    const d = defaultWorldMeta();
    return {
      ...d, ...m,
      bestTurns: { ...d.bestTurns, ...(m.bestTurns ?? {}) },
      medals: Array.isArray(m.medals) ? m.medals.filter((x) => typeof x === 'string') : [],
      weekly: Array.isArray(m.weekly) ? m.weekly : [],
      history: Array.isArray(m.history) ? m.history : [],
      recorded: Array.isArray(m.recorded) ? m.recorded : [],
    };
  } catch {
    return defaultWorldMeta();
  }
}

export function saveWorldMeta(meta: WorldMeta, kv: KV = defaultStorage()) {
  try { kv.setItem(WORLD_META_KEY, JSON.stringify(meta)); } catch { /* ignore */ }
}

/** The best score kept for a Weekly World key (null: not played). */
export function weeklyBest(meta: WorldMeta, week: string): { score: number; turns: number; won: boolean } | null {
  return meta.weekly.find((w) => w.week === week) ?? null;
}

export interface WorldEndSummary {
  meta: WorldMeta;
  /** Medals earned for the first time by this run. */
  medals: string[];
  xp: number;
  weeklyBest: boolean;
  rankBefore: number;
  rankAfter: number;
  rankName: string;
}

/** Count a finished run (idempotent per run id): records, medals, the weekly best and commander XP. */
export function recordWorldEnd(run: WorldRun, kv: KV = defaultStorage(), now = 0): WorldEndSummary | null {
  if (run.status === 'active') return null;
  run.score ??= worldScore(run);
  const meta = loadWorldMeta(kv);
  const profile = loadProfile(kv);
  if (meta.recorded.includes(run.id)) {
    const r = rankIndexFor(profile.xp);
    return { meta, medals: [], xp: 0, weeklyBest: false, rankBefore: r, rankAfter: r, rankName: rankName(r, profile.faction) };
  }
  const won = run.status === 'won';
  meta.recorded = [...meta.recorded.slice(-60), run.id];
  meta.runs++;
  if (won) {
    meta.victories++;
    const k = run.size;
    meta.bestTurns[k] = meta.bestTurns[k] === null ? run.turn : Math.min(meta.bestTurns[k]!, run.turn);
  }
  meta.bestScore = Math.max(meta.bestScore, run.score.total);
  const fresh: string[] = [];
  for (const m of [...run.medals, ...endMedals(run)]) if (!meta.medals.includes(m)) { meta.medals.push(m); fresh.push(m); }
  let weeklyNew = false;
  if (run.weekly) {
    const prev = weeklyBest(meta, run.weekly);
    if (!prev || run.score.total > prev.score) {
      weeklyNew = true;
      meta.weekly = [{ week: run.weekly, score: run.score.total, turns: run.turn, won }, ...meta.weekly.filter((w) => w.week !== run.weekly)].slice(0, 26);
    }
  }
  meta.history.unshift({
    id: run.id, at: now, home: run.home, size: run.size, difficulty: run.difficulty, status: won ? 'won' : 'lost', ending: run.ending ?? '',
    turns: run.turn, score: run.score.total, territories: ownedCount(run, HUMAN), ...(run.weekly ? { weekly: run.weekly } : {}),
  });
  if (meta.history.length > 12) meta.history.length = 12;
  saveWorldMeta(meta, kv);
  const xp = run.score.xp + MEDAL_XP * fresh.length;
  const xpBefore = profile.xp;
  profile.xp += xp;
  saveProfile(profile, kv);
  return { meta, medals: fresh, xp, weeklyBest: weeklyNew, rankBefore: rankIndexFor(xpBefore), rankAfter: rankIndexFor(profile.xp), rankName: rankName(rankIndexFor(profile.xp), profile.faction) };
}
