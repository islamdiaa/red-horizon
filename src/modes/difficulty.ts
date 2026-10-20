/**
 * AI difficulty helpers for the menus (DOM-free): ordering, capping and the dynamic-difficulty default. The levels
 * themselves (and their order, easiest first) come from the simulation (src/sim/ai.ts AI_DIFFICULTIES).
 */
import { AI_DIFFICULTIES, type AIDifficulty } from '../sim/ai';

export { AI_DIFFICULTIES };

/** Whether a stored / received value is a known AI difficulty. */
export function isDifficulty(v: unknown): v is AIDifficulty {
  return typeof v === 'string' && (AI_DIFFICULTIES as readonly string[]).includes(v);
}

/** Position in AI_DIFFICULTIES (0 = Recruit); unknown values count as Normal. */
export function difficultyIndex(d: AIDifficulty | string | undefined): number {
  const i = (AI_DIFFICULTIES as readonly string[]).indexOf(d ?? '');
  return i >= 0 ? i : AI_DIFFICULTIES.indexOf('normal');
}

/** `d` moved `n` levels (negative = easier), clamped to the ends. */
export function stepDifficulty(d: AIDifficulty, n: number): AIDifficulty {
  return AI_DIFFICULTIES[Math.max(0, Math.min(AI_DIFFICULTIES.length - 1, difficultyIndex(d) + n))];
}

/** The easier of `d` and `cap`. */
export function capDifficulty(d: AIDifficulty, cap: AIDifficulty): AIDifficulty {
  return difficultyIndex(d) <= difficultyIndex(cap) ? d : cap;
}

/** Recruit and Easy: the levels for newcomers (assist-only dynamic difficulty, newcomer-safe Quick Battle mutators). */
export function isNewcomerLevel(d: AIDifficulty | string | undefined): boolean {
  return d === 'recruit' || d === 'easy';
}

/**
 * Dynamic difficulty's default in the skirmish setup: on when every AI opponent is Recruit or Easy (it then only
 * eases off for a struggling player), off otherwise. An explicit choice by the player overrides it.
 */
export function dynamicDefault(levels: readonly (AIDifficulty | string | undefined)[]): boolean {
  return levels.length > 0 && levels.every(isNewcomerLevel);
}
