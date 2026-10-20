/**
 * How a Game (src/game.ts) sets up the game modes (branches, challenges, King of the Hill, co-op), in order:
 *   1. withModeStart(setup)        a branch / challenge moment becomes the setup's `load`
 *   2. modeMissionId(setup)        co-op survival: GameSetup.allies -> the co-op mission id
 *   3. applyRoster(players, setup) the chosen player is human, everybody else AI (before the World exists)
 *   4. attachModeRuntime(...)      KOTH / challenge scripting (a MissionRuntime) before the load restores it
 *   5. startModes(world, setup)    after the load: run fresh setups, hand the player over; returns the local player
 * DOM-free: src/modes/headless.ts and the tests build worlds through exactly the same steps.
 */
import type { GameSetup } from '../game';
import { MissionRuntime, type MissionDef } from '../sim/mission';
import type { Player } from '../sim/player';
import { SAVE_VERSION } from '../sim/save';
import type { PlayerSetup, World } from '../sim/world';
import { coopMissionId } from '../missions/special';
import { getMapDef } from '../maps';
import { challengeSetup, challengeUpdate } from './challenge';
import { KOTH_DEFAULT_MINUTES, kothSetup, kothUpdate } from './koth';
import { MODES_EN } from './text';

/** Player index the human commands. */
export function localIndex(setup: Pick<GameSetup, 'branch' | 'challenge'>): number {
  return setup.branch?.local ?? setup.challenge?.side ?? 0;
}

/** True for games that start from a recorded moment or a challenge (no regular progression for them). */
export function isWhatIf(setup: Pick<GameSetup, 'branch' | 'challenge'>): boolean {
  return !!(setup.branch || setup.challenge);
}

/**
 * A branch / challenge starts from its stored world: use it as the load (a deep copy, so the running game
 * never mutates the stored start). A real save being resumed wins.
 */
export function withModeStart(setup: GameSetup): GameSetup {
  if (setup.load) return setup;
  const start = setup.branch?.start ?? setup.challenge?.state;
  if (!start) return setup;
  const view = setup.branch?.view ?? setup.challenge?.view ?? {};
  return { ...setup, intro: false, load: { version: SAVE_VERSION, savedAt: 0, world: JSON.parse(JSON.stringify(start)), game: { ...view, modeStart: true } } };
}

/** Steps 1 + 2 for the Game constructor. */
export function prepareModeSetup(setup: GameSetup): GameSetup {
  setup = withModeStart(setup);
  if (setup.mission && setup.allies?.length) setup = { ...setup, mission: modeMissionId(setup), allies: undefined };
  return setup;
}

/** Mission id to load: co-op survival when allies are given. */
export function modeMissionId(setup: Pick<GameSetup, 'mission' | 'allies'>): string {
  const id = setup.mission ?? '';
  return setup.allies?.length ? coopMissionId(id, setup.allies) : id;
}

/** Branch / challenge roster: the chosen player is human; every other player is AI (former humans at the given difficulty). */
export function applyRoster(players: PlayerSetup[], setup: GameSetup) {
  if (!isWhatIf(setup)) return;
  const local = localIndex(setup);
  const ai = setup.branch?.ai ?? setup.challenge?.ai ?? 'normal';
  players.forEach((p, i) => {
    if (i === local) { p.isHuman = true; p.ai = undefined; }
    else if (!p.ai) { p.isHuman = false; p.ai = ai; }
  });
}

interface ModeDef extends MissionDef {
  /** Fresh start on a loaded moment (the moment's own mission state, e.g. KOTH, came with the load). */
  start(m: MissionRuntime): void;
}

/** A curated / custom map may pin its hill: MapDef.hill = [x, y, r] (cells). */
function mapHill(setup: GameSetup): [number, number, number] | undefined {
  const def = (setup.customMap ?? (setup.mapId ? getMapDef(setup.mapId) : undefined)) as { hill?: [number, number, number] } | undefined;
  const h = def?.hill;
  return Array.isArray(h) && h.length === 3 && h.every((v) => typeof v === 'number') ? h : undefined;
}

function modeDef(setup: GameSetup): ModeDef | null {
  const ch = setup.challenge;
  const koth = !!setup.koth;
  if (!ch && !koth) return null;
  const minutes = setup.kothMinutes ?? KOTH_DEFAULT_MINUTES;
  const title = ch?.title ?? MODES_EN.koth.title; // (English: mission state; shown through trSource)
  return {
    id: ch ? 'challenge' : 'koth', campaign: 'special', index: 0, title, codename: title.toUpperCase(), location: '', briefing: [],
    map: { size: setup.mapSize, seed: setup.seed, players: 1 + setup.opponents.length }, players: [],
    setup(m) {
      if (koth) kothSetup(m, minutes, setup.mapId, mapHill(setup));
      if (ch) challengeSetup(m, ch);
    },
    start(m) {
      if (koth && !m.flags.koth) kothSetup(m, minutes, setup.mapId, mapHill(setup));
      if (ch) challengeSetup(m, ch);
    },
    update(m) {
      if (koth) kothUpdate(m);
      if (ch) challengeUpdate(m, ch);
    },
  };
}

/** KOTH / challenge runtime for a skirmish-based game (before the load, which restores its state). */
export function attachModeRuntime(world: World, setup: GameSetup, isMission: boolean): MissionRuntime | null {
  if (isMission) return null;
  const def = modeDef(setup);
  if (!def) return null;
  const rt = new MissionRuntime(world, def);
  rt.humanId = localIndex(setup);
  world.mission = rt;
  return rt;
}

/** After the world (and any save) is loaded: hand the chosen player to the human and start fresh modes. Idempotent for resumed saves. */
export function startModes(world: World, setup: GameSetup): Player {
  const local = localIndex(setup);
  // (challenges never have the skirmish build-up time, even when their moment came from a match that had one)
  if (setup.challenge) world.ceasefireUntil = 0;
  if (isWhatIf(setup)) {
    // players that were human in the source are now played by their AI (with that difficulty's economy)
    for (const ai of world.ais) if (ai.player.isHuman) ai.setMode(ai.difficulty);
    const me = world.players[local];
    if (me && !me.isHuman) { me.buildSpeed = 1; me.incomeBias = 1; }
    for (const p of world.players) p.isHuman = p.id === local;
  }
  const rt = world.mission;
  const def = rt?.def as ModeDef | undefined;
  if (rt && def?.start) {
    if (!setup.load) def.setup(rt);
    else if (setup.load.game?.modeStart) def.start(rt);
    // (as missions do: what the stage hands out is not announced as "new construction options")
    for (const p of world.players) { if (!setup.load) world.updateVisibility(p); for (const o of p.buildOptions()) p.knownOptions.add(o); } // (a save restores the fog exactly as it was)
  }
  return world.players[local] ?? world.players[0];
}
