/**
 * The campaign's recurring radio cast, and the simulation's default end reason: English that the mission scripts
 * (src/missions/common.ts) and the simulation emit, translated where it is shown (trSource). Kept apart from the
 * campaign screen's strings (campaign.ts) because the mission scripts load with the game.
 */
import { sourceStrings } from '../core';
// the mission scripts' own text (briefings, radio, objectives...): registered with the cast the scripts load
import './missions';

/** Speaker names (rank and name) of the recurring cast: the mission scripts emit this English. */
export const CAST = sourceStrings('campaign.cast', {
  rourke: 'Field Marshal Rourke',
  brandt: 'Major Brandt',
  // an Allied commando's code name
  kestrel: 'Kestrel',
  saarinen: 'Dr. Saarinen',
  hollander: 'Capt. Hollander',
  morozov: 'General Morozov',
  orlova: 'Commissar Orlova',
  belinsky: 'Dr. Belinsky',
  gromova: 'Sgt. Gromova',
  // the tactical computer's radio voice
  eva: 'Battle Control',
});

/** English the simulation emits (src/sim/mission.ts): the default reason a mission is lost. */
export const SIM = sourceStrings('campaign.sim', {
  allLost: 'All forces lost',
});
