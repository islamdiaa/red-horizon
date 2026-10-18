/**
 * The replay player's "This moment" panel (src/ui/moment.ts): take command of a player from a replay moment, or
 * turn the moment into a challenge.
 */
import { strings } from '../core';

export default strings('moment', {
  title: 'This moment',
  close: 'Close (Esc)',
  tab: {
    take: 'Take command',
    challenge: 'Make a challenge',
  },
  // section heading: the player you will command / the side the challenger plays
  command: 'Command',
  challenger: 'Challenger plays',
  player: {
    units: '{n, plural, one {# unit} other {# units}}',
    // structures, abbreviated ("bldg" = buildings)
    buildings: '{n} bldg',
    // a human player of the recorded match
    recorded: 'Recorded',
  },
  former: 'Their old commander',
  // {names}: the human players who are replaced
  formerNote: '{names} will be played by the AI:',
  take: {
    heading: 'Rewind & take command',
    over: 'The match is already over at this moment. Rewind to an earlier point to take command.',
    note: 'A new live game starts from this exact moment with you in command of [b]{name}[/b]; every other player is AI. It is recorded as a branch of this replay, so it shows under it in the Replays list.',
    button: 'Take command',
  },
  goal: {
    heading: 'Goal',
    win: 'Win',
    winSub: 'defeat every enemy',
    survive: 'Survive',
    surviveSub: 'stay in the fight',
    destroy: 'Destroy',
    destroySub: 'a target structure',
    protect: 'Protect',
    protectSub: 'keep a structure',
    hold: 'Hold',
    holdSub: 'the area in view',
  },
  params: {
    timeLimit: 'Time limit',
    surviveFor: 'Survive for',
    target: 'Target',
    noEnemy: 'No enemy structures to destroy at this moment.',
    protect: 'Protect',
    // "Protect [structure] for [time]"
    for: 'for',
    noOwn: 'This side has no structures to protect at this moment.',
    zone: 'Zone: the point at the centre of your view ({x}, {y}), radius {r}. Move the camera before opening this panel to choose another spot.',
    holdFor: 'Hold for',
    // "Hold for [time] within [time]"
    within: 'within',
  },
  // a target structure in the list: several of a kind, and an enemy's
  target: {
    count: '{name} ({n})',
    enemy: '{name} · {player}',
  },
  titleHeading: 'Title',
  // the goal and the side the challenger plays
  summary: '{goal} · as {name}',
  // the challenge's objective and description (saved with the challenge)
  objective: {
    destroy: 'Destroy: {target} within {time}',
    protect: 'Protect: {target} for {time}',
    description: '{goal}. From {map} at {time}, as {name}.',
    // when the side has no name
    commander: 'commander',
  },
  play: 'Play now',
  save: 'Save',
  export: 'Export',
  msg: {
    pickTarget: 'Pick a target first.',
    saved: 'Saved: find it under Challenges › Scenario challenges.',
    saveFailed: 'Could not save the challenge.',
  },
});
