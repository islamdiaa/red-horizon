/**
 * World Conquest region battlefields come alive in the World constructor (one gated call in world.ts). Kept apart
 * from landmarks.ts so its tables stay out of the first download (this module is all the game's start needs).
 */
import type { World } from './world';
import { raiseCivilians } from './civilian';

/**
 * World constructor (one gated call): a region battlefield's scenery comes alive. Every player starts with the
 * landmarks explored (famous places are on everyone's maps) and the map's civilian buildings stand. A no-op on
 * every other map (no landmarks, no sites), so skirmish, campaign and Europe Conquest worlds are unchanged.
 * A loaded game then replaces the entities and fog with the saved ones.
 */
export function initRegionScenery(w: World) {
  const map = w.map;
  if (!map.landmarks.length && !map.civilianSites.length) return;
  // (the ground 4 cells round it too: the landmark should not stand in a black void on the start screen)
  const R = 4;
  for (const l of map.landmarks) {
    for (const p of w.players) {
      for (let y = l.cy - R; y < l.cy + l.h + R; y++) for (let x = l.cx - R; x < l.cx + l.w + R; x++) {
        if (map.inBounds(x, y)) p.explored[map.idx(x, y)] = 1;
      }
    }
  }
  raiseCivilians(w);
}
