/**
 * Round-5 MODES data types (no DOM, no runtime code): branching replays ("rewind & take command"),
 * challenges, King of the Hill and co-op survival. They travel inside GameSetup (src/game.ts), save
 * games and replay files, so everything here is plain JSON.
 */
import type { Faction } from '../data/rules';
import type { AIDifficulty } from '../sim/ai';
import type { GameSetup } from '../game';

/** Camera, clock and weather at a starting moment (the subset of SaveData.game a Game restores). */
export interface StartView {
  cam?: { x: number; y: number; dist: number; yaw?: number };
  hours?: number;
  wxIdx?: number;
  wxTimer?: number;
}

/**
 * GameSetup.branch: a live game started from a replay moment. The human commands `local`; every other
 * player is AI (players that were human in the parent are played at `ai` difficulty from `tick` on).
 * The serialized world at `tick` is stored in `start`, so a branch replays on its own (no parent needed).
 */
export interface BranchInfo {
  /** Replay id of the parent recording. */
  parent: string;
  /** Replay id of the original match at the root of the tree. */
  root: string;
  /** 1 = branch of an original match, 2 = branch of a branch… */
  depth: number;
  /** Simulation tick the branch starts at (the parent's tick when command was taken). */
  tick: number;
  /** Player index the human commands from here on. */
  local: number;
  /** Difficulty of the AI that takes over players who were human in the parent. */
  ai: AIDifficulty;
  /** World at `tick` (src/sim/save.ts serializeWorld, JSON). */
  start: unknown;
  /** Replay state hash (src/replay/hash.ts) of the parent world at `tick`; the loaded start hashes the same. */
  hash: string;
  /** Camera, clock and weather when command was taken. */
  view?: StartView;
  /** Name of the commander taken over (for lists). */
  name?: string;
}

/** What the challenger must do. */
export type ChallengeGoalKind = 'win' | 'survive' | 'destroy' | 'protect' | 'hold';

export interface ChallengeGoal {
  kind: ChallengeGoalKind;
  /** survive: seconds to last; hold: seconds of sole control of the zone (accumulated). */
  seconds?: number;
  /** destroy / protect: entity ids in the starting state (built-ins: filled in by their setup script). */
  targets?: number[];
  /** hold: zone centre and radius (cells). */
  x?: number;
  y?: number;
  r?: number;
  /** Objective text, e.g. "Destroy the Soviet Construction Yard". */
  label?: string;
}

/** A challenge ("Can you win from here?"): a starting state, a side, a goal, a time limit. File: .rhchallenge.json */
export interface ChallengeDef {
  v: 1;
  id: string;
  title: string;
  description?: string;
  createdAt: number;
  /** Build that created it (config VERSION). */
  gameVersion: string;
  /** The match the moment comes from: map, seed, players and options (a GameSetup without per-device / mode fields). */
  setup: ChallengeSetup;
  /** Serialized world at the starting moment. Absent for built-ins: their scripted setup builds the stage. */
  state?: unknown;
  /** Camera, clock and weather at the starting moment. */
  view?: StartView;
  /** Built-in scripted setup id (src/modes/builtins.ts). */
  builtin?: string;
  /** Player index the challenger commands. */
  side: number;
  /** AI difficulty for players that were human in the source match. */
  ai: AIDifficulty;
  goal: ChallengeGoal;
  /** Seconds. win / destroy / hold fail when it runs out; survive / protect succeed when it does. */
  timeLimit: number;
  /** Three-star par: seconds (win / destroy / hold) or most units lost (survive / protect). */
  par?: { time?: number; losses?: number };
  /** Where it came from. */
  source?: { kind: 'replay' | 'moment' | 'builtin' | 'import'; replayId?: string; tick?: number; moment?: string; map?: string };
}

/**
 * GameSetup fields a challenge keeps from its source match (see ChallengeDef.setup): map, seed, players,
 * options, mods and custom map content; without per-device and mode fields.
 */
export type ChallengeSetup = Omit<GameSetup, 'load' | 'replay' | 'quality' | 'branch' | 'challenge' | 'demo' | 'intro' | 'mission' | 'customMission' | 'allies'>;

/** GameSetup.allies: AI teammates for co-op survival (same team, separate bases). */
export interface AllySetup {
  /** Default: the human's faction. */
  faction?: Faction;
  difficulty: AIDifficulty;
}

/** King of the Hill state (MissionRuntime flags.koth; JSON). */
export interface KothState {
  x: number;
  y: number;
  r: number;
  /** Ticks of sole control needed to win. */
  target: number;
  /** Ticks held, per team. */
  held: Record<string, number>;
  /** Team holding the hill alone right now (-1: nobody). */
  holder: number;
  contested: boolean;
  /** Teams with units on the hill right now. */
  present: number[];
  /** AI hill squads: player id -> unit ids. */
  squads: Record<string, number[]>;
  /** Last team that held it (for capture / loss messages). */
  last: number;
  /** Warnings already given (team -> fraction step). */
  warned: Record<string, number>;
  /** Open, reachable cells on the hill where AI squads stand. */
  spots?: [number, number][];
}

/** Outcome of a challenge attempt (MissionRuntime flags.ch.res). */
export interface ChallengeResult {
  won: boolean;
  /** Seconds since the challenge started. */
  time: number;
  score: number;
  stars: number;
  kills: number;
  structuresKilled: number;
  losses: number;
  structuresLost: number;
  /** Time bonus (win / destroy / hold) or condition bonus (protect / survive). */
  bonus: number;
  bonusLabel: string;
  reason?: string;
}
