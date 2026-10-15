/** Campaign progress & best results, persisted locally. */
export interface MissionRecord {
  completed: boolean;
  stars: number;          // 0..3
  bestTime?: number;      // seconds
  bestScore?: number;     // scored missions
}

const KEY = 'rh.campaign';

export function loadProgress(): Record<string, MissionRecord> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function recordResult(id: string, r: { won: boolean; stars: number; time: number; score?: number }) {
  const all = loadProgress();
  const prev = all[id] ?? { completed: false, stars: 0 };
  const next: MissionRecord = {
    completed: prev.completed || r.won,
    stars: Math.max(prev.stars, r.won ? r.stars : 0),
    bestTime: r.won ? Math.min(prev.bestTime ?? Infinity, r.time) : prev.bestTime,
    bestScore: r.score !== undefined ? Math.max(prev.bestScore ?? 0, r.score) : prev.bestScore,
  };
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
