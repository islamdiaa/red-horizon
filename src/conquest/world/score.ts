/**
 * World Conquest score and medals. The score rewards what a commander would boast about: territories and zones
 * held, conquests, the RTS battles fought yourself (worth more than dice), capitals, wonders, rivals eliminated,
 * the victory and its speed; times the difficulty (and Ironman, fog). Medals are earned in play (continents,
 * wonders) and at the end (the homeland you won from, the size and difficulty). All cosmetic.
 */
import { heldZones, ownedCount, HUMAN, type WorldRun, type WorldScore } from './state';

export const DIFFICULTY_MULT = { recruit: 0.5, easy: 0.75, normal: 1, hard: 1.4, brutal: 1.8 } as const;
/** Turns under which a victory earns a speed bonus. */
export const PAR_TURNS = { world: 60, blitz: 25 } as const;

export function worldScore(run: WorldRun): WorldScore {
  const lines: WorldScore['lines'] = [];
  const add = (key: string, value: number) => { if (value) lines.push({ key, value: Math.round(value) }); };
  add('territories', 15 * ownedCount(run, HUMAN));
  add('zones', 60 * heldZones(run, HUMAN).reduce((s, z) => s + run.zones[z].bonus, 0));
  add('conquests', 20 * run.stats.conquered);
  add('battles', run.battleScore);
  add('capitals', 250 * run.stats.capitals);
  add('wonders', 150 * run.territories.filter((t) => t.owner === HUMAN && t.landmark).length);
  add('eliminated', 400 * run.stats.eliminated);
  if (run.status === 'won') {
    add('victory', run.ending === 'armistice' ? 2000 : 5000);
    add('speed', Math.max(0, PAR_TURNS[run.size] - run.turn) * 120);
  }
  const multiplier = Math.round(DIFFICULTY_MULT[run.difficulty] * (run.ironman ? 1.25 : 1) * (run.fog ? 1.1 : 1) * 100) / 100;
  const total = Math.round(lines.reduce((s, l) => s + l.value, 0) * multiplier);
  return { lines, multiplier, total, xp: Math.min(8000, Math.round(total / 3)) };
}

/** Medals a finished run earns on top of the ones earned in play (run.medals). */
export function endMedals(run: WorldRun): string[] {
  const out: string[] = [];
  if (run.status !== 'won') return out;
  out.push(`homeland:${run.home}`);
  out.push(`victory:${run.size}:${run.difficulty}`);
  if (run.ironman) out.push(`ironman:${run.size}`);
  if (run.stats.battlesWon === 0 && run.stats.defencesWon === 0) out.push('dice-only');
  if (run.weekly) out.push(`weekly:${run.weekly}`);
  return out;
}

/** The share-card line: "Ruled the world from Iceland in 61 turns" (the UI translates; these are its parameters). */
export function shareLine(run: WorldRun): { key: string; home: string; turns: number; size: string; difficulty: string; score: number } {
  const key = run.status === 'won' ? (run.size === 'world' ? 'ruledWorld' : 'ruledRegion') : 'fellAt';
  return { key, home: run.home, turns: run.turn, size: run.size, difficulty: run.difficulty, score: (run.score ?? worldScore(run)).total };
}
