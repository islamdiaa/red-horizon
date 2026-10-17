/**
 * Leaderboard verification: re-simulate a submitted run with the engine (headless) and accept its score only
 * if the run ends where it claims, with the same world hash and the same score. Cheat-resistant by design: the
 * setup comes from the board, never from the player, so the only input a player controls is the command
 * stream - and whatever score those commands earn is what the simulation computes.
 *
 * Runs in a worker thread on the server (server/src/leaderboard/worker.ts), one at a time with a time limit.
 */
import { headlessGame } from '../modes/headless';
import { setDailyDay } from '../missions/special';
import { worldHash } from '../replay/hash';
import { CommandFeeder, hookStep } from '../replay/core';
import { sanitizeCommand } from './commands';
import { boardSetup, type Submission } from './boards';
import type { Command } from '../sim/types';
import { enterPortableMath, exitPortableMath } from './dmath';

export type VerifyResult =
  | { ok: true; score: number; ticks: number; won: boolean }
  | { ok: false; reason: string };

export interface VerifyOptions {
  /** Longest run the server simulates (ticks). */
  maxTicks: number;
  /** Polled every few hundred ticks: true = give up (time limit). */
  expired?(): boolean;
}

export function verifyRun(sub: Submission, o: VerifyOptions): VerifyResult {
  if (sub.ticks > o.maxTicks) return { ok: false, reason: 'The run is longer than this server verifies.' };
  const setup = boardSetup(sub.kind, sub.id);
  if (!setup) return { ok: false, reason: 'Unknown leaderboard.' };
  if (sub.kind === 'daily') setDailyDay(sub.day);
  enterPortableMath(); // as the game ran it
  try {
    const g = headlessGame(setup);
    const w = g.world, me = g.local.id;
    const cmds: [number, Command][] = [];
    for (const [t, raw] of sub.cmds) {
      const c = sanitizeCommand(raw, me);
      if (!c) return { ok: false, reason: 'The run contains an invalid command.' };
      cmds.push([t, c]);
    }
    const feeder = new CommandFeeder(w, cmds, []);
    hookStep(w, () => feeder.beforeStep(), null);
    while (!w.gameOver && w.tick < sub.ticks) {
      w.step();
      w.events.length = 0;
      if (w.mission) w.mission.events.length = 0;
      if ((w.tick & 255) === 0 && o.expired?.()) return { ok: false, reason: 'Verification took too long.' };
    }
    if (!w.gameOver) return { ok: false, reason: 'The run does not end where it claims.' };
    if (w.tick !== sub.ticks) return { ok: false, reason: `The run ends at a different time (${w.tick} vs ${sub.ticks}).` };
    if (worldHash(w) !== sub.hash) return { ok: false, reason: 'The final state does not match (different game version or a modified run).' };
    const score = Math.round(w.mission?.score ?? 0);
    if (score !== sub.score) return { ok: false, reason: `The score does not match (${score} vs ${sub.score}).` };
    if (score <= 0) return { ok: false, reason: 'Only runs that score are ranked.' };
    const won = !!w.mission?.won;
    return { ok: true, score, ticks: w.tick, won };
  } finally {
    exitPortableMath();
    if (sub.kind === 'daily') setDailyDay(null);
  }
}
