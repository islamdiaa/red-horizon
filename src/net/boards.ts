/**
 * Verified leaderboards: which runs can be ranked, the exact setup each is played on, and the submission
 * format. Shared by the game (recording, submitting, showing) and the server (re-simulation). DOM-free.
 *
 * A board is a game mode with a fixed battlefield: the Daily Challenge (one board per UTC day), the three
 * Survival fronts (solo and co-op with AI allies) and the built-in scenario challenges; every board keeps
 * per-day tops. The server never takes a setup from the client: it rebuilds it from the board id, so only the
 * commands are the player's.
 */
import type { GameSetup } from '../game';
import type { Command } from '../sim/types';
import { SURVIVAL_VARIANTS, parseCoopId, coopMissionId } from '../missions/special';
import { BUILTINS } from '../modes/builtins';
import { challengeGameSetup } from '../modes/author';
import { cleanName } from './names';

export type BoardKind = 'daily' | 'survival' | 'challenge';

export interface BoardInfo {
  kind: BoardKind;
  /** 'daily', a survival mission id ('survival', 'survival-winter:coop:hard'...) or a built-in challenge id. */
  id: string;
  title: string;
}

/** Most commands one run may carry, and the most ticks it may last (the server's own cap can be lower). */
export const MAX_RUN_CMDS = 40_000;
export const MAX_RUN_TICKS = 20 * 60 * 120;
export const SUBMISSION_VERSION = 1;

export interface Submission {
  v: number;
  /** Game build fingerprint (src/net/fingerprint.ts): the server only verifies runs of its own build. */
  build: string;
  kind: BoardKind;
  id: string;
  /** Daily Challenge: the UTC day it was issued for (YYYY-MM-DD). Ignored for the other boards. */
  day: string;
  name: string;
  /** Random per-browser id (not personal): one entry per player and board-day, the best one. */
  player: string;
  /** The tick the run ended at, the world hash then, and the mission score. */
  ticks: number;
  hash: string;
  score: number;
  won: boolean;
  /** The player's commands, [tick at issue, command]. */
  cmds: [number, Command][];
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const COOP_RE = /^(survival(?:-winter|-desert)?):coop:(easy|normal|hard|brutal)(?:\+\2)?$/;

/** The board a survival mission id belongs to (solo, or co-op with one or two allies of one difficulty). */
function survivalBoard(id: string): BoardInfo | null {
  const v = SURVIVAL_VARIANTS.find((x) => x.id === id);
  if (v) return { kind: 'survival', id, title: `Survival · ${v.title}` };
  if (!COOP_RE.test(id)) return null;
  const p = parseCoopId(id);
  if (!p || coopMissionId(p.variant.id, p.allies) !== id) return null;
  return { kind: 'survival', id, title: `Survival · ${p.variant.title} · co-op (${p.allies.length} ${p.allies[0].difficulty} ${p.allies.length > 1 ? 'allies' : 'ally'})` };
}

/** Board info for a kind and id, or null when it is not a ranked board. */
export function boardInfo(kind: unknown, id: unknown): BoardInfo | null {
  if (typeof id !== 'string' || id.length > 64) return null;
  if (kind === 'daily') return id === 'daily' ? { kind, id, title: 'Daily Challenge' } : null;
  if (kind === 'survival') return survivalBoard(id);
  if (kind === 'challenge') { const b = BUILTINS[id]; return b && Object.prototype.hasOwnProperty.call(BUILTINS, id) ? { kind, id, title: b.def.title } : null; }
  return null;
}

/** Every board with a fixed id (the leaderboard screen's tabs; co-op survival boards are reached from runs). */
export function listBoards(): BoardInfo[] {
  return [
    { kind: 'daily', id: 'daily', title: 'Daily Challenge' },
    ...SURVIVAL_VARIANTS.map((v): BoardInfo => ({ kind: 'survival', id: v.id, title: `Survival · ${v.title}` })),
    ...Object.values(BUILTINS).map((b): BoardInfo => ({ kind: 'challenge', id: b.def.id, title: b.def.title })),
  ];
}

/** The setup a board's runs are played on (as the game deploys it, without mods). */
export function boardSetup(kind: BoardKind, id: string): GameSetup | null {
  const info = boardInfo(kind, id);
  if (!info) return null;
  if (kind === 'challenge') return { ...challengeGameSetup(BUILTINS[id].def, 'low'), mods: undefined };
  // (as main.ts deployMission: the mission defines the battlefield and the players)
  return { faction: 'allies', color: 0x3d7be0, opponents: [], mapSize: 64, water: 0.5, trees: 0.5, ore: 0.6, credits: 5000, startUnits: 'mcv', fog: true, timeOfDay: 'day', quality: 'low', seed: 0, mission: id, intro: false, mods: undefined };
}

/**
 * The board a game's run counts for, or null: an unmodded, fresh run of the daily, a survival front or a
 * built-in challenge (not resumed from a save, not a replay, not a branch).
 */
export function boardOfSetup(setup: GameSetup): BoardInfo | null {
  if (setup.load || setup.replay || setup.branch || setup.demo || setup.conquest || setup.customMission || setup.customMap || setup.net) return null;
  if (setup.mods && (setup.mods as { mods?: unknown[] }).mods?.length) return null;
  if (setup.challenge) {
    const b = setup.challenge.builtin ? BUILTINS[setup.challenge.builtin] : undefined;
    if (!b || setup.challenge.id !== b.def.id || JSON.stringify(setup.challenge) !== JSON.stringify(b.def)) return null;
    return boardInfo('challenge', b.def.id);
  }
  if (!setup.mission || setup.allies?.length) return null;
  if (setup.mission === 'daily') return boardInfo('daily', 'daily');
  return boardInfo('survival', setup.mission);
}

/**
 * Portable math (src/net/dmath.ts) is recorded in the setup (`dmath: true`), so replays, branches and saves run
 * the maths their game ran with: new multiplayer matches and new ranked runs get the flag; anything continued
 * from a recording (replay, branch, save, a challenge from a moment) keeps what it recorded, and recordings
 * without the field (older ones) use the engine's maths.
 */
export function withPortableFlag(setup: GameSetup): GameSetup {
  if ('dmath' in setup || setup.load || setup.replay || setup.branch) return setup;
  return setup.net || boardOfSetup(setup) ? { ...setup, dmath: true } : setup;
}

/** Whether a game (after withPortableFlag) runs with portable math. */
export function portableMathFor(setup: GameSetup): boolean {
  return setup.dmath === true;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Shape-check an untrusted submission (the commands are checked again when the run is re-simulated). */
export function parseSubmission(raw: unknown): Submission | string {
  if (!isObj(raw)) return 'Not a submission.';
  const r = raw;
  if (r.v !== SUBMISSION_VERSION) return 'Unsupported submission version.';
  if (typeof r.build !== 'string' || r.build.length > 80) return 'Bad build.';
  const info = boardInfo(r.kind, r.id);
  if (!info) return 'Unknown leaderboard.';
  if (typeof r.day !== 'string' || !DAY.test(r.day)) return 'Bad day.';
  if (typeof r.player !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(r.player)) return 'Bad player id.';
  if (!Number.isInteger(r.ticks) || (r.ticks as number) < 1 || (r.ticks as number) > MAX_RUN_TICKS) return 'Bad length.';
  if (typeof r.hash !== 'string' || !/^[0-9a-f]{16}$/.test(r.hash)) return 'Bad hash.';
  if (!Number.isInteger(r.score) || Math.abs(r.score as number) > 1e9) return 'Bad score.';
  if (typeof r.won !== 'boolean') return 'Bad result.';
  if (!Array.isArray(r.cmds) || r.cmds.length > MAX_RUN_CMDS) return 'Too many commands.';
  let last = 0;
  for (const c of r.cmds) {
    if (!Array.isArray(c) || c.length !== 2 || !Number.isInteger(c[0]) || c[0] < last || c[0] > (r.ticks as number) || !isObj(c[1]) || typeof c[1].c !== 'string') return 'Bad command list.';
    last = c[0];
  }
  return {
    v: SUBMISSION_VERSION, build: r.build, kind: info.kind, id: info.id, day: r.day, name: cleanName(r.name), player: r.player,
    ticks: r.ticks as number, hash: r.hash, score: r.score as number, won: r.won, cmds: r.cmds as [number, Command][],
  };
}

/** UTC day key of a time. */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
