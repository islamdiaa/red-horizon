/** The replay viewer (src/replay/playback.ts) and replay files (src/replay/store.ts, recorder.ts). */
import { sourceStrings, strings } from '../core';

/**
 * English the recorder writes into replay files (src/replay/recorder.ts): it stays English in the file, and
 * display sites translate it with trSource().
 */
export const REPLAY_SOURCE = sourceStrings('replay.source', {
  // the name of a generated battlefield: "Random 96×96"
  randomMap: 'Random {w}×{h}',
});

export default strings('replay', {
  bar: {
    restart: 'Restart (Home)',
    back: 'Back 30 s',
    play: 'Pause / play (Space)',
    skip: 'Skip 30 s',
    // tooltip of the 1× 2× 4× 8× buttons; [ and ] are the keys
    speed: '{s}× speed ([ / ])',
    branchedAt: 'Branched from the parent replay at {time}',
    observer: 'Observer view: no fog of war (V cycles views)',
    leave: 'Leave the replay',
    take: 'Take command',
    takeTip: 'Take command from this moment (T)',
    challengeTip: 'Make a challenge from this moment (C)',
    branch: 'Branch',
    replay: 'Replay',
    // under the Branch tag: the map and the branch point
    branchFrom: '{map} · from {time}',
    seeking: 'Seeking',
  },
  sync: {
    desyncAt: 'Desync at {time}',
    inSync: 'In sync',
    verifying: 'Verifying',
    desyncTip: 'The simulation no longer matches the recording from {time} (recorded with build {build}, simulation {sim}; this build runs simulation {mine}). What follows may differ from the original match.',
    verifiedTip: 'Simulation verified against {n} of {total} recorded checkpoints.',
    olderVersion: 'This replay was recorded with an older version of the game and drifts from the original match from {time}.',
    newerVersion: 'This replay was recorded with a newer version of the game and drifts from the original match from {time}.',
    drifts: 'The replay drifts from the recording from {time}: what follows may differ from the original match.',
  },
  end: {
    kicker: 'Replay complete',
    abandoned: 'End of recording',
    wins: '{name} wins',
    over: 'Match over',
    leftAt: 'The match was left at {time}',
    victoryFor: 'Victory for {name} · {time}',
    defeatFor: 'Defeat for {name} · {time}',
    // stands in for an unknown player name in "Victory for …"
    commander: 'the commander',
    again: 'Watch again',
    replays: 'Replays',
    mainMenu: 'Main menu',
  },
  players: {
    title: 'Players',
    switchHint: 'V · switch view',
    // an AI player: {level} is its difficulty
    ai: 'AI · {level, select, easy {easy} normal {normal} hard {hard} brutal {brutal} other {{level}}}',
    commander: 'Commander',
    viewAs: 'View the battle as {name}',
    observer: 'Observer',
    noFog: 'No fog of war',
  },
  file: {
    tooLarge: 'File too large for a replay',
    invalidJson: 'Not a replay file (invalid JSON)',
    notReplay: 'Not a Red Horizon replay, or from an unsupported version',
  },
});
