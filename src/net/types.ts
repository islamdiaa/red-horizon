import type { Command } from '../sim/types';

/** What the Game (src/game.ts) needs from a multiplayer match it runs in (src/net/game-link.ts implements it). */
export interface NetLink {
  /** The lockstep drives the simulation (false once the match is over: the finale runs locally). */
  readonly active: boolean;
  /** A local command: scheduled a few ticks ahead and sent to the other players. */
  issue(cmd: Command): void;
  /**
   * Advance the simulation for one frame; `step` runs one world step with the Game's per-step work (`fast`: the
   * client is catching up, skip the presentation of what happened).
   */
  frame(dt: number, step: (fast: boolean) => void): void;
  /** Interpolation factor between the last two ticks. */
  readonly alpha: number;
  /** The local player may surrender now (src/net/surrender.ts). */
  readonly canSurrender?: boolean;
  /** Surrender (sim/resign.ts) through the lockstep; false when not possible now. */
  surrender?(): boolean;
}
