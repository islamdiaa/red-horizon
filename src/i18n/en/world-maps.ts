/**
 * World Conquest region battlefields (src/sim/mapgen-region.ts): the battlefield names a world battle shows. The
 * generator runs in the simulation, so it emits this English and the screens translate it (trSource). Battlefields
 * the old Conquest maps already name (mountain pass, coastline...) use those strings (conquest-battle.ts).
 */
import { sourceStrings } from '../core';

export const WORLD_MAPS = sourceStrings('worldmap', {
  cityCentre: 'City centre',
  harbour: 'Harbour',
  canyon: 'Canyon lands',
  dunes: 'Sand sea',
  jungle: 'Jungle',
  oasis: 'Oasis',
  glacier: 'Glacier',
  volcano: 'Volcano slopes',
  town: 'Market town',
  plains: 'Open country',
});
