/**
 * Records a ranked run for the verified leaderboards: the player's commands with the tick they were issued
 * at, and - the moment the match ends - the tick, the world hash and the mission score. DOM-free (the tests
 * record runs the same way the game does).
 */
import type { Command } from '../sim/types';
import type { World } from '../sim/world';
import { worldHash } from '../replay/hash';
import { hookStep } from '../replay/core';
import { MAX_RUN_CMDS, SUBMISSION_VERSION, type BoardInfo, type Submission } from './boards';
import { BUILD_FINGERPRINT } from './fingerprint';

export interface RunResult { ticks: number; hash: string; score: number; won: boolean }

export class RunRecorder {
  readonly cmds: [number, Command][] = [];
  result: RunResult | null = null;
  /** Too many commands to submit, or the world was changed outside the command stream. */
  spoiled = false;
  onEnd: ((r: RunResult) => void) | null = null;
  private unhook: () => void;

  constructor(readonly world: World, readonly board: BoardInfo, readonly day: string) {
    this.unhook = hookStep(world, null, () => {
      if (this.result || !world.gameOver) return;
      this.result = { ticks: world.tick, hash: worldHash(world), score: Math.round(world.mission?.score ?? 0), won: !!world.mission?.won };
      this.unhook();
      this.onEnd?.(this.result);
    });
  }

  /** A command of the player, as it is issued (it runs when the world next steps). */
  record(cmd: Command) {
    if (this.result) return;
    if (this.cmds.length >= MAX_RUN_CMDS) { this.spoiled = true; return; }
    this.cmds.push([this.world.tick, JSON.parse(JSON.stringify(cmd)) as Command]);
  }

  discard() {
    this.spoiled = true;
    this.unhook();
  }

  /** The submission for a finished run (null while it runs or when it cannot be ranked). */
  submission(name: string, player: string): Submission | null {
    const r = this.result;
    if (!r || this.spoiled) return null;
    return { v: SUBMISSION_VERSION, build: BUILD_FINGERPRINT, kind: this.board.kind, id: this.board.id, day: this.day, name, player, ticks: r.ticks, hash: r.hash, score: r.score, won: r.won, cmds: this.cmds };
  }
}
