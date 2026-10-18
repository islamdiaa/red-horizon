/**
 * Build fingerprint for multiplayer rooms and leaderboard submissions: the game version, the net protocol, the
 * simulation version and a hash of the base rule tables (units, structures, weapons, warheads). Two builds with
 * different rules would desync, so they never share a room, and the leaderboard server only verifies runs of its
 * own build.
 *
 * Computed once when this module loads, before any mod or mutator changes the tables (mods are applied when a
 * match starts and restored afterwards).
 */
import { VERSION } from '../config';
import { BUILDINGS, UNITS, WARHEADS, WEAPONS } from '../data/rules';
import { NET_PROTOCOL } from './protocol';
import { SIM_VERSION } from '../sim/version';

function fnv(s: string): string {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995) ^ (b >>> 15);
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

const rulesHash = fnv(JSON.stringify([UNITS, BUILDINGS, WEAPONS, WARHEADS]));

/**
 * "<version>/<protocol>/s<simulation version>/<rules hash>". The simulation version (src/sim/version.ts) covers what
 * the rule tables don't: AI, Commander and economy numbers, any change to how the simulation steps.
 */
export const BUILD_FINGERPRINT = `${VERSION}/${NET_PROTOCOL}/s${SIM_VERSION}/${rulesHash}`;
