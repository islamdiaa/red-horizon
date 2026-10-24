/**
 * The seam between the World Conquest screens and the strategic layer (STRAT, src/conquest/world): every rule call
 * the screens make goes through `W`, so a change in the rules' module layout touches only this file.
 */
import * as R from '../../conquest/world/index';

export type { NewWorldOptions, RollResult } from '../../conquest/world/run';
export type { AttackOdds as Odds } from '../../conquest/world/odds';
export type { WorldEndSummary as EndSummary, WorldMeta } from '../../conquest/world/storage';

export const W = {
  ...R,
};

/** (Kept for the screens' start-up: the rules are part of this chunk.) */
export async function ensureApi(): Promise<boolean> {
  return true;
}
