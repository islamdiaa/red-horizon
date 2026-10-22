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
import { SIM_VERSION, simVersionOf } from '../sim/version';
import { REPLAY_SOURCE } from '../i18n/en/replay';

const fillName = (tpl: string, w: number, h: number) => tpl.replace('{w}', String(w)).replace('{h}', String(h));

/** Matches shorter than this (and not finished) are not worth keeping. */
export const MIN_TICKS = 20 * 30;
/**
 * A branch ("take command") is a deliberate what-if: it is kept from this length on once the player has given it an
 * order, however short (the pause menu says when leaving would drop it).
 */
export const MIN_BRANCH_TICKS = 20 * 5;

/** Whether a recording of this length is kept: finished, 30 s or more, or a branch with an order and 5 s or more. */
export function keepsRecording(o: { gameOver: boolean; ticks: number; branch: boolean; commands: number }): boolean {
  if (o.gameOver || o.ticks >= MIN_TICKS) return true;
  return o.branch && o.commands > 0 && o.ticks >= MIN_BRANCH_TICKS;
}

export class ReplayRecorder {
  readonly id: string;
  readonly createdAt: number;
  /** Simulation version of the whole recording: the one it started with (src/sim/version.ts). */
  readonly sim: number;
  private core: CommandRecorder;
  private unhook: () => void;
  private done = false;
  /** Called with the stored replay (e.g. to show a toast). */
  onSaved: ((r: ReplayData) => void) | null = null;

  constructor(private game: Game, restore?: RecorderState | null) {
    const now = Date.now();
    this.id = restore?.id ?? newReplayId(now, Math.random());
    this.createdAt = restore?.createdAt ?? now;
    this.sim = restore ? simVersionOf(restore) : SIM_VERSION; // (resumed from a save: the version it began under)
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
    return { id: this.id, createdAt: this.createdAt, sim: this.sim, cmds: this.core.cmds, hashes: this.core.hashes };
  }

  /** Stop recording without storing anything (test scenarios that edit the world directly). */
  discard() {
    this.done = true;
    this.unhook();
  }

  toData(): ReplayData {
    const g = this.game, w = g.world;
    const { load: _l, replay: _r, quality: _q, ...setup } = g.setup; // (incl. setup.ceasefire: playback rebuilds the build-up time from it)
    const def = setup.customMap ?? (setup.mapId ? getMapDef(setup.mapId) : undefined); // custom maps travel in the setup
    const code = mapCodeForSetup(setup);
    const local = g.local;
    return {
      v: REPLAY_VERSION, id: this.id, createdAt: this.createdAt, gameVersion: VERSION, sim: this.sim, setup,
      // (the map name stays English in the file: display sites translate it with trSource)
      mapName: def?.name ?? fillName(REPLAY_SOURCE.randomMap, w.map.w, w.map.h), mapCode: code ?? undefined, mapW: w.map.w, mapH: w.map.h,
      players: w.players.map((p) => ({ name: p.name, faction: p.faction, color: p.color, team: p.team, ai: w.ais.find((a) => a.player === p)?.difficulty })),
      local: local.id, ticks: w.tick,
      result: w.gameOver ? (w.winnerTeam === local.team && !local.resigned ? 'victory' : 'defeat') : 'abandoned', winnerTeam: w.winnerTeam, // (MP: who surrendered lost)
      cmds: this.core.cmds, hashes: this.core.hashes,
    };
  }

  /** Whether leaving now would store the replay (see keepsRecording; a branch counts from its start). */
  get keeps(): boolean {
    const w = this.game.world, branch = this.game.setup.branch;
    return keepsRecording({ gameOver: w.gameOver, ticks: w.tick - (branch?.tick ?? 0), branch: !!branch, commands: this.core.cmds.length });
  }

  /** Store the replay (match over, or the player left it). Idempotent. */
  finish() {
    if (this.done) return;
    const keep = this.keeps;
    this.done = true;
    this.unhook();
    if (!keep) return;
    const data = this.toData();
    saveReplay(data).then(() => this.onSaved?.(data)).catch((e) => console.warn('replay not saved', e));
  }
}
