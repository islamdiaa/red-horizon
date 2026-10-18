/**
 * Game modes (src/modes/**): scenario challenges, King of the Hill, "make this a challenge" moments, Quick Battle.
 *
 * MODES_SRC (keys modes.src.*) is English that runs inside the simulation (objectives, radio lines, end reasons,
 * challenge results) or is stored in challenge files (built-in and moment challenges). Its text lives in
 * src/modes/text.ts (the server bundles import it, so no i18n there); the screens that show it translate it with
 * trSource(). {placeholders} are filled with English-formatted values (times as m:ss).
 */
import { sourceStrings, strings } from '../core';
import { MODES_EN } from '../../modes/text';

export const MODES_SRC = sourceStrings('modes.src', MODES_EN);

export default strings('modes', {
  /** HUD chip of a branch or challenge game. */
  badge: {
    challenge: 'Challenge',
    branch: 'Branch',
    // a game taken over from a replay moment: "from 12:30 as Commander"
    from: 'from {time} as {name}',
  },
  /** Goal tags in the challenge list: "Win · 15:00". */
  tag: {
    win: 'Win · {limit}',
    survive: 'Survive · {limit}',
    destroy: 'Destroy · {limit}',
    protect: 'Protect · {limit}',
    hold: 'Hold {hold} · {limit}',
  },
  /** End-screen map name of a generated battlefield. */
  randomMap: 'Random {w}×{h}',
  /** Quick Battle loading card. */
  quick: {
    battlefield: 'Battlefield',
    opponent: 'Opponent',
    rules: 'Rules',
    rulesValue: 'Commander · battlefield events',
    mutators: 'Mutators',
    rival: 'Rival',
    climate: { temperate: 'Temperate', winter: 'Winter', desert: 'Desert' },
    time: { day: 'Day', dusk: 'Dusk', night: 'Night' },
  },
  /** Challenge file import errors (shown in the challenge list). */
  file: {
    invalidJson: 'Not a challenge file (invalid JSON)',
    noDecompress: 'This browser cannot read compressed challenge files',
    damaged: 'The challenge file is damaged',
    notChallenge: 'Not a Red Horizon challenge, or from an unsupported version',
    newer: 'This challenge needs a newer version of the game',
    tooLarge: 'File too large for a challenge',
  },
});
