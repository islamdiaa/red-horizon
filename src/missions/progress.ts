/** Campaign progress & best results, persisted locally. */
import type { MissionDef } from '../sim/mission';
import { MISSION_LEVELS, isMissionLevel, type MissionLevel } from '../sim/handicap';
import { getMission } from './index';

export interface MissionRecord {
  completed: boolean;
  stars: number;          // 0..3
  bestTime?: number;      // seconds
  bestScore?: number;     // scored missions
  /** Hardest campaign difficulty it was won at (absent: won before the levels existed, i.e. at Normal). */
  level?: MissionLevel;
}

const KEY = 'rh.campaign';
const LEVEL_KEY = 'rh.campaign.level';
/** The level of the last mission won that takes the campaign level (the default until the player picks one). */
const LAST_WIN_KEY = 'rh.campaign.lastWin';

export function loadProgress(): Record<string, MissionRecord> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function recordResult(id: string, r: { won: boolean; stars: number; time: number; score?: number; level?: MissionLevel }) {
  const all = loadProgress();
  const prev = all[id] ?? { completed: false, stars: 0 };
  const next: MissionRecord = {
    completed: prev.completed || r.won,
    stars: Math.max(prev.stars, r.won ? r.stars : 0),
    bestTime: r.won ? Math.min(prev.bestTime ?? Infinity, r.time) : prev.bestTime,
    bestScore: r.score !== undefined ? Math.max(prev.bestScore ?? 0, r.score) : prev.bestScore,
  };
  // the hardest level won (stars and unlocks don't depend on it: every level completes the mission)
  const won = r.won && r.level ? r.level : null;
  const had = prev.level ?? (prev.completed ? 'normal' : null);
  const best = [won, had].filter((l): l is MissionLevel => !!l).sort((a, b) => MISSION_LEVELS.indexOf(b) - MISSION_LEVELS.indexOf(a))[0];
  if (best) next.level = best;
  all[id] = next;
  localStorage.setItem(KEY, JSON.stringify(all));
  // (only missions played at the campaign level: a survival or daily win says nothing about it; a custom mission does)
  const def = getMission(id);
  if (r.won && r.level && (!def || takesLevel(def))) {
    try { localStorage.setItem(LAST_WIN_KEY, r.level); } catch { /* no storage */ }
  }
  return next;
}

/** A mission is unlocked when the previous one in its campaign is completed. */
export function isUnlocked(id: string, order: string[]): boolean {
  const i = order.indexOf(id);
  if (i <= 0) return true;
  return !!loadProgress()[order[i - 1]]?.completed;
}

/**
 * Whether a mission is played at the campaign difficulty: the Allied and Soviet campaigns and the special operations
 * that tell a story (the naval operations, custom missions). Not Boot Camp (a drill), the scored operations (survival
 * and the daily challenge keep one level so their leaderboards compare), co-op survival (its allies' own setting),
 * Conquest (its run's difficulty) or the skirmish modes that run as missions (King of the Hill, challenges).
 */
export function takesLevel(def: Pick<MissionDef, 'id' | 'campaign' | 'scored'>): boolean {
  if (def.campaign === 'allies' || def.campaign === 'soviet') return true;
  return !def.scored && !['bootcamp', 'conquest', 'koth', 'challenge'].includes(def.id); // (King of the Hill and challenges are skirmish modes)
}

/**
 * The campaign difficulty the player picked last. Until they pick one: Normal for a commander with wins from before the
 * levels existed (a completed record without a level, of a mission that takes the level: those were all played at
 * Normal), else the level of their last
 * win (a new player who won Grey Dawn at Easy plays the next mission at Easy too), else Easy (Normal is a seasoned
 * player's level: tools/campaign-levels.ts).
 */
export function loadLevel(): MissionLevel {
  try {
    const v = localStorage.getItem(LEVEL_KEY);
    if (isMissionLevel(v)) return v;
    // (only missions that take the level: Survival's five-wave record carries none and says nothing about it)
    if (Object.entries(loadProgress()).some(([id, r]) => r?.completed && !r.level && (() => { const d = getMission(id); return !d || takesLevel(d); })())) return 'normal';
    const last = localStorage.getItem(LAST_WIN_KEY);
    return isMissionLevel(last) ? last : 'easy';
  } catch {
    return 'normal';
  }
}

export function saveLevel(level: MissionLevel) {
  try { localStorage.setItem(LEVEL_KEY, level); } catch { /* no storage */ }
}

/** The level a fresh start of this mission is played at. */
export function missionLevelFor(def: Pick<MissionDef, 'id' | 'campaign' | 'scored'>): MissionLevel {
  return takesLevel(def) ? loadLevel() : 'normal';
}
