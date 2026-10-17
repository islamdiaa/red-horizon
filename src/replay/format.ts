/**
 * Replay file format (version 1).
 *
 * A replay is the match setup (map, seed, players, options) plus every command the human player
 * issued, stamped with the simulation tick at which it was issued. AI players are not recorded: the
 * simulation and the AI are deterministic, so feeding the same commands at the same ticks into a
 * world built from the same setup reproduces the match exactly. A state hash every HASH_EVERY ticks
 * lets playback detect a desync (e.g. a replay recorded by an older build with different rules).
 *
 * Typical size: a 20-minute match is ~1–2 k commands, ~60–150 KB of JSON.
 */
import type { Command } from '../sim/types';
import type { GameSetup } from '../game';

export const REPLAY_VERSION = 1;
/** State hash interval in ticks (10 s at 20 Hz). */
export const HASH_EVERY = 200;
/** Replays kept in storage (oldest are pruned; whole trees of branches are kept or pruned together). */
export const MAX_REPLAYS = 16;

/**
 * Everything the Game constructor needs to rebuild the match (minus per-device options). Includes the skirmish
 * options that change the simulation, e.g. `ceasefire` (build-up time, sim/ceasefire.ts): replays recorded before
 * it existed have no such field and replay without a ceasefire, as they were played.
 */
export type ReplaySetup = Omit<GameSetup, 'load' | 'replay' | 'quality'>;

export interface ReplayPlayer {
  name: string;
  faction: string;
  color: number;
  team: number;
  /** AI difficulty, or undefined for the human player. */
  ai?: string;
}

export type ReplayResult = 'victory' | 'defeat' | 'abandoned';

export interface ReplayData {
  v: number;
  id: string;
  /** Wall-clock time the match started (ms since epoch). */
  createdAt: number;
  /** When it was last written to storage (pruning order). */
  storedAt?: number;
  /** Build that recorded it (config VERSION). */
  gameVersion: string;
  setup: ReplaySetup;
  mapName: string;
  /** Map code of a generated map (src/maps/code.ts), to share the battlefield. */
  mapCode?: string;
  mapW: number;
  mapH: number;
  players: ReplayPlayer[];
  /** Index of the recording (human) player. */
  local: number;
  /** Length of the recording in ticks. */
  ticks: number;
  result: ReplayResult;
  winnerTeam: number;
  /** [tick at issue, command] — applied right before the world steps from that tick. */
  cmds: [number, Command][];
  /** [tick, hash] after the world stepped to that tick. */
  hashes: [number, string][];
}

/** In-progress recording, carried inside a save game so a resumed match keeps its replay. */
export interface RecorderState {
  id: string;
  createdAt: number;
  cmds: [number, Command][];
  hashes: [number, string][];
}

/** What GameSetup.replay holds: the replay to watch and where to start. */
export interface PlaybackOptions {
  data: ReplayData;
  /** Fast-forward to this tick on start (seeking backwards restarts the match and seeks). */
  seekTo?: number;
  /** Viewed player index (-1 = observer without fog). */
  view?: number;
  speed?: number;
  /** Start paused (after a seek while paused). */
  paused?: boolean;
  /** "Continue": once the seek is done, take command of this player (a branch at that tick). */
  takeCommand?: { local: number; ai?: import('../sim/ai').AIDifficulty };
}

/** Light structural validation for imported files. */
export function isReplayData(x: unknown): x is ReplayData {
  const r = x as ReplayData;
  return !!r && typeof r === 'object' && r.v === REPLAY_VERSION && typeof r.id === 'string' && !!r.setup && typeof r.setup === 'object' &&
    typeof r.setup.seed === 'number' && Array.isArray(r.cmds) && Array.isArray(r.hashes) && Array.isArray(r.players) && typeof r.ticks === 'number' &&
    r.cmds.every((c) => Array.isArray(c) && typeof c[0] === 'number' && !!c[1] && typeof c[1] === 'object' && typeof (c[1] as Command).c === 'string');
}

export function newReplayId(now: number, rand: number): string {
  return `r${now.toString(36)}${Math.floor(rand * 36 ** 4).toString(36).padStart(4, '0')}`;
}
