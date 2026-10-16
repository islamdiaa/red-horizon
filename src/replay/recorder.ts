/**
 * Game-level replay recording: every skirmish records the local player's commands (Game.issue)
 * and a state hash every 10 s; the replay is stored when the match ends or is left. The in-progress
 * recording travels inside save games, so a resumed match keeps recording into the same replay.
 * Missions and the menu backdrop are not recorded.
 */
import { VERSION } from '../config';
import type { Game } from '../game';
import { getMapDef } from '../maps';
import { mapCodeForSetup } from '../maps/code';
import type { Command } from '../sim/types';
import { CommandRecorder, hookStep } from './core';
import { REPLAY_VERSION, newReplayId, type RecorderState, type ReplayData } from './format';
import { saveReplay } from './store';

/** Matches shorter than this (and not finished) are not worth keeping. */
const MIN_TICKS = 20 * 30;

export class ReplayRecorder {
  readonly id: string;
  readonly createdAt: number;
  private core: CommandRecorder;
  private unhook: () => void;
  private done = false;
  /** Called with the stored replay (e.g. to show a toast). */
  onSaved: ((r: ReplayData) => void) | null = null;

  constructor(private game: Game, restore?: RecorderState | null) {
    const now = Date.now();
    this.id = restore?.id ?? newReplayId(now, Math.random());
    this.createdAt = restore?.createdAt ?? now;
    this.core = new CommandRecorder(game.world, restore ?? undefined);
    this.unhook = hookStep(game.world, null, () => {
      this.core.afterStep();
      if (game.world.gameOver && !this.done) this.finish();
    });
  }

  record(cmd: Command) {
    if (!this.done) this.core.record(cmd);
  }

  get commandCount(): number {
    return this.core.cmds.length;
  }

  /** In-progress state for save games. */
  snapshot(): RecorderState {
    return { id: this.id, createdAt: this.createdAt, cmds: this.core.cmds, hashes: this.core.hashes };
  }

  /** Stop recording without storing anything (test scenarios that edit the world directly). */
  discard() {
    this.done = true;
    this.unhook();
  }

  toData(): ReplayData {
    const g = this.game, w = g.world;
    const { load: _l, replay: _r, quality: _q, ...setup } = g.setup;
    const def = setup.customMap ?? (setup.mapId ? getMapDef(setup.mapId) : undefined); // [EDIT] custom maps travel in the setup
    const code = mapCodeForSetup(setup);
    const local = g.local;
    return {
      v: REPLAY_VERSION, id: this.id, createdAt: this.createdAt, gameVersion: VERSION, setup,
      mapName: def?.name ?? `Random ${w.map.w}×${w.map.h}`, mapCode: code ?? undefined, mapW: w.map.w, mapH: w.map.h,
      players: w.players.map((p) => ({ name: p.name, faction: p.faction, color: p.color, team: p.team, ai: w.ais.find((a) => a.player === p)?.difficulty })),
      local: local.id, ticks: w.tick,
      result: w.gameOver ? (w.winnerTeam === local.team ? 'victory' : 'defeat') : 'abandoned', winnerTeam: w.winnerTeam,
      cmds: this.core.cmds, hashes: this.core.hashes,
    };
  }

  /** Store the replay (match over, or the player left it). Idempotent. */
  finish() {
    if (this.done) return;
    this.done = true;
    this.unhook();
    const w = this.game.world;
    if (!w.gameOver && w.tick - (this.game.setup.branch?.tick ?? 0) < MIN_TICKS) return; // [MODES] a branch counts from its start
    const data = this.toData();
    saveReplay(data).then(() => this.onSaved?.(data)).catch((e) => console.warn('replay not saved', e));
  }
}
