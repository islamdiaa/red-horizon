/**
 * The odds shown before you commit to an attack: the chance a blitz takes the territory from the troops there now,
 * the expected losses on both sides, and the chances of the next single roll. Pure (no randomness is used).
 */
import { blitzOdds, rollOdds } from './dice';
import { diceMods } from './rules';
import { terr, type WorldRun } from './state';

export interface AttackOdds {
  /** Chance a blitz from here conquers the territory. */
  win: number;
  /** Expected troops lost by the attacker and the defender over the blitz. */
  attLoss: number;
  defLoss: number;
  /** The next single roll: the attacker wins every pair, the defender does, or they split. */
  roll: { att: number; def: number; split: number };
  attDice: number;
  defDice: number;
  /** Wonder modifiers on each side's best die. */
  mods: { att: number; def: number };
}

export function attackOdds(run: WorldRun, fromId: string, toId: string, opts: { dice?: number; troops?: number } = {}): AttackOdds {
  const from = terr(run, fromId), to = terr(run, toId);
  const x = Math.max(0, Math.min(from.troops - 1, opts.troops ?? from.troops - 1));
  const mods = diceMods(run, from, to);
  const attDice = Math.max(0, Math.min(3, x, opts.dice ?? 3));
  const defDice = Math.min(2, to.troops);
  const b = blitzOdds(x, to.troops, mods.att, mods.def);
  const roll = attDice && defDice ? rollOdds(attDice, defDice, mods.att, mods.def) : { att: 0, def: 0, split: 0 };
  return { win: b.win, attLoss: b.attLoss, defLoss: b.defLoss, roll, attDice, defDice, mods };
}
