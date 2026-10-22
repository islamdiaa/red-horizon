/** Campaign progress & best results, persisted locally. */
import type { MissionDef } from '../sim/mission';
import { MISSION_LEVELS, isMissionLevel, type MissionLevel } from '../sim/handicap';

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
 * The campaign difficulty the player picked last. Until they pick one: Easy for a commander who has not won a campaign
 * mission yet (Normal is a seasoned player's level: tools/campaign-levels.ts), Normal for one who has (their earlier
 * wins were all at Normal).
 */
export function loadLevel(): MissionLevel {
  try {
    const v = localStorage.getItem(LEVEL_KEY);
    if (isMissionLevel(v)) return v;
    return Object.values(loadProgress()).some((r) => r?.completed) ? 'normal' : 'easy';
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
