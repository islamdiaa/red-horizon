/**
 * Conquest persistence (localStorage, or any KV store in tests).
 *
 *   rh.conquest.run   the active (or just finished) run: ConquestRun JSON, version RUN_VERSION
 *   rh.conquest.meta  meta progression across runs: ConquestMeta JSON
 *   rh.save.conquest  the latest autosave of the battle in progress (written by Game.save, see src/game.ts)
 */
import { defaultStorage, loadProfile, saveProfile, type KV } from '../meta/profile';
import { rankIndexFor, rankName } from '../meta/ranks';
import { DOCTRINES, PERKS, TITLES } from './data';
import { RUN_VERSION, owned, type ConquestRun } from './state';

export type { KV };
export const RUN_KEY = 'rh.conquest.run';
export const META_KEY = 'rh.conquest.meta';
export const META_VERSION = 1;

// =====================================================================================================
// Run
// =====================================================================================================
export function saveRun(run: ConquestRun, kv: KV = defaultStorage()): boolean {
  try { kv.setItem(RUN_KEY, JSON.stringify(run)); return true; } catch { return false; }
}

export function loadRun(kv: KV = defaultStorage()): ConquestRun | null {
  try {
    const raw = kv.getItem(RUN_KEY);
    if (!raw) return null;
    const run = JSON.parse(raw) as ConquestRun;
    if (!run || run.v !== RUN_VERSION || !Array.isArray(run.territories) || !Array.isArray(run.links)) return null;
    run.renown ??= 0;
    run.name ??= 'Operation Conquest';
    run.armyAt ??= run.territories.find((t) => t.capital === 'player')?.id ?? run.territories[0].id;
    run.reportSeen ??= true;
    return run;
  } catch {
    return null;
  }
}

export function clearRun(kv: KV = defaultStorage()) {
  try { kv.setItem(RUN_KEY, ''); } catch { /* ignore */ }
}

// =====================================================================================================
// Meta progression
// =====================================================================================================
export interface RunRecord {
  id: string;
  at: number;
  faction: string;
  difficulty: string;
  doctrine: string;
  status: 'won' | 'lost';
  turns: number;
  score: number;
  territories: number;
  ending: string;
}

export interface ConquestMeta {
  v: number;
  renown: number;
  runs: number;
  victories: number;
  bestScore: number;
  /** Fewest turns to a victory. */
  bestTurns: number | null;
  titles: string[];
  /** Title shown on the conquest screen. */
  title: string | null;
  history: RunRecord[];
  /** Runs already counted (so a finished run is never counted twice). */
  recorded: string[];
}

export function defaultMeta(): ConquestMeta {
  return { v: META_VERSION, renown: 0, runs: 0, victories: 0, bestScore: 0, bestTurns: null, titles: [], title: null, history: [], recorded: [] };
}

export function loadMeta(kv: KV = defaultStorage()): ConquestMeta {
  try {
    const raw = kv.getItem(META_KEY);
    if (!raw) return defaultMeta();
    return { ...defaultMeta(), ...(JSON.parse(raw) as Partial<ConquestMeta>) };
  } catch {
    return defaultMeta();
  }
}

export function saveMeta(meta: ConquestMeta, kv: KV = defaultStorage()) {
  try { kv.setItem(META_KEY, JSON.stringify(meta)); } catch { /* ignore */ }
}

export interface RunEndSummary {
  meta: ConquestMeta;
  /** Newly unlocked things (display strings). */
  unlocks: string[];
  xp: number;
  rankBefore: number;
  rankAfter: number;
  rankName: string;
}

/**
 * Count a finished run into the meta progression (idempotent per run id): renown, records, titles, unlocks,
 * and commander XP on the shared profile (src/meta). Call while no battle is being tracked.
 */
export function recordRunEnd(run: ConquestRun, kv: KV = defaultStorage(), now = Date.now()): RunEndSummary | null {
  if (run.status === 'active' || !run.score) return null;
  const meta = loadMeta(kv);
  const profile = loadProfile(kv);
  if (meta.recorded.includes(run.id)) {
    return { meta, unlocks: run.unlocks ?? [], xp: run.score.xp, rankBefore: rankIndexFor(profile.xp), rankAfter: rankIndexFor(profile.xp), rankName: rankName(rankIndexFor(profile.xp), profile.faction) };
  }
  const before = meta.renown;
  const won = run.status === 'won';
  meta.recorded = [...meta.recorded.slice(-40), run.id];
  meta.runs++;
  if (won) meta.victories++;
  meta.renown += run.score.renown;
  meta.bestScore = Math.max(meta.bestScore, run.score.total);
  if (won) meta.bestTurns = meta.bestTurns === null ? run.turn : Math.min(meta.bestTurns, run.turn);
  meta.history.unshift({
    id: run.id, at: now, faction: run.faction, difficulty: run.difficulty, doctrine: run.doctrine, status: won ? 'won' : 'lost', turns: run.turn,
    score: run.score.total, territories: owned(run).length, ending: run.ending ?? '',
  });
  if (meta.history.length > 12) meta.history.length = 12;
  const unlocks: string[] = [];
  for (const d of DOCTRINES) if (d.renown > before && d.renown <= meta.renown) unlocks.push(`Doctrine: ${d.name}`);
  const perkNames = new Set<string>();
  for (const p of PERKS) if ((p.renown ?? 0) > before && (p.renown ?? 0) <= meta.renown && !perkNames.has(p.id)) { perkNames.add(p.id); unlocks.push(`Perk: ${p.name}`); }
  const earn = (id: string) => {
    if (meta.titles.includes(id)) return;
    meta.titles.push(id);
    const t = TITLES.find((x) => x.id === id);
    if (t) unlocks.push(`Title: ${t.name}`);
    meta.title ??= id;
  };
  earn('field_commander');
  if (won && run.faction === 'allies') earn('liberator');
  if (won && run.faction === 'soviet') earn('hero_soviet');
  if (won && run.difficulty === 'hard') earn('iron_marshal');
  if (run.stats.peakTerritories >= 18) earn('conqueror');
  if (run.core.filter((v) => v.rank >= 2).length >= 8) earn('old_guard');
  if (won && run.turn <= 12) earn('blitz_master');
  if (meta.runs >= 5) earn('veteran_commander');
  saveMeta(meta, kv);
  run.unlocks = unlocks;
  // commander XP on the shared profile
  const xpBefore = profile.xp;
  profile.xp += run.score.xp;
  saveProfile(profile, kv);
  return { meta, unlocks, xp: run.score.xp, rankBefore: rankIndexFor(xpBefore), rankAfter: rankIndexFor(profile.xp), rankName: rankName(rankIndexFor(profile.xp), profile.faction) };
}
