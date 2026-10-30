/**
 * World Conquest landmarks on the battlefield (sim side). A landmark is static scenery that belongs to the map,
 * like its terrain and trees: never an entity in `World.entities`, so it is never targetable, never damaged, never
 * selectable and never an objective by construction (no hooks in combat, AI or victory code). It blocks movement
 * like terrain: the land cells under its footprint are T.Rock (ground units and ships go round); the water cells
 * under a bridge landmark stay water, so ships pass beneath it and nobody walks its deck.
 *
 * The region battlefield generator (mapgen-region.ts) places it (`placeLandmark`) and lists it in
 * `GameMap.landmarks`; the renderer stands the model (src/render/landmarks) on the footprint. The map is
 * regenerated from the battle's spec on load, so nothing here is saved. At the start every player has the
 * footprint explored (region-scenery.ts), so the landmark shows from the starting camera.
 *
 * Deterministic: pure functions of the map.
 */
import { LANDMARK_IDS, type LandmarkFootprint, type LandmarkId } from '../conquest/world/types';
import { T, type GameMap } from './map';

/**
 * Footprints in cells at facing 0: w = east-west, h = north-south; the model's front faces +z (south, towards the
 * default camera). Agreed with the landmark models (src/render/landmarks: the models scale to fit).
 */
export const LANDMARK_FOOTPRINTS: Record<LandmarkId, LandmarkFootprint> = {
  'eiffel-tower': { w: 4, h: 4 }, 'big-ben': { w: 5, h: 3 }, 'tower-bridge': { w: 10, h: 3 }, colosseum: { w: 7, h: 6 },
  'leaning-tower': { w: 3, h: 3 }, parthenon: { w: 7, h: 5 }, 'brandenburg-gate': { w: 5, h: 2 }, 'st-basils': { w: 5, h: 5 },
  'winter-palace': { w: 9, h: 5 }, neuschwanstein: { w: 6, h: 5 }, 'dutch-windmills': { w: 6, h: 3 }, matterhorn: { w: 8, h: 8 },
  'galata-tower': { w: 3, h: 3 }, alhambra: { w: 7, h: 5 },
  pyramids: { w: 10, h: 8 }, petra: { w: 6, h: 3 }, persepolis: { w: 7, h: 5 }, 'table-mountain': { w: 12, h: 6 },
  kilimanjaro: { w: 12, h: 12 }, 'victoria-falls': { w: 10, h: 4 },
  'great-wall': { w: 12, h: 3 }, 'forbidden-city': { w: 8, h: 6 }, 'mount-fuji': { w: 12, h: 12 }, 'himeji-castle': { w: 6, h: 6 },
  'taj-mahal': { w: 7, h: 7 }, 'gateway-of-india': { w: 4, h: 2 }, 'angkor-wat': { w: 9, h: 9 }, registan: { w: 9, h: 7 },
  'statue-of-liberty': { w: 5, h: 5 }, 'golden-gate': { w: 16, h: 3 }, 'empire-state': { w: 3, h: 3 }, 'mount-rushmore': { w: 8, h: 4 },
  'chichen-itza': { w: 6, h: 6 }, 'machu-picchu': { w: 9, h: 7 }, sugarloaf: { w: 8, h: 6 }, 'panama-locks': { w: 10, h: 5 },
  'harbour-bridge': { w: 14, h: 3 },
};

/** Model heights (world units) the models are built to (every one <= 7.6): the start camera frames them. */
export const LANDMARK_HEIGHTS: Record<LandmarkId, number> = {
  'eiffel-tower': 7.3, 'big-ben': 7, 'tower-bridge': 5, colosseum: 2.3, 'leaning-tower': 5, parthenon: 2.6, 'brandenburg-gate': 2.6,
  'st-basils': 5, 'winter-palace': 1.8, neuschwanstein: 6, 'dutch-windmills': 3, matterhorn: 7, 'galata-tower': 5, alhambra: 2.5,
  pyramids: 3, petra: 4, persepolis: 2, 'table-mountain': 4, kilimanjaro: 6, 'victoria-falls': 2.5,
  'great-wall': 2, 'forbidden-city': 2.6, 'mount-fuji': 5.5, 'himeji-castle': 5, 'taj-mahal': 4.5, 'gateway-of-india': 2.6,
  'angkor-wat': 3.5, registan: 2.8, 'statue-of-liberty': 6.5, 'golden-gate': 6, 'empire-state': 7.5, 'mount-rushmore': 4,
  'chichen-itza': 2.6, 'machu-picchu': 5, sugarloaf: 5, 'panama-locks': 1.2, 'harbour-bridge': 4.5,
};

/** How a landmark sits in the landscape (the generator prepares the ground for it). */
export type LandmarkSetting =
  | 'plaza'    // a paved square in a town or city
  | 'open'     // open ground (desert plateau, a park, a hill top)
  | 'span'     // a bridge over water running north-south under it at facing 0 (two land cells at each end)
  | 'river'    // across a river (falls, locks): the whole footprint blocks
  | 'peak'     // a mountain: rock and foothills around it
  | 'cliff'    // carved into a rock face: rock behind (north of) it
  | 'shore';   // on the water's edge (a harbour island, a star fort)

export const LANDMARK_SETTING: Record<LandmarkId, LandmarkSetting> = {
  'eiffel-tower': 'plaza', 'big-ben': 'plaza', 'tower-bridge': 'span', colosseum: 'plaza', 'leaning-tower': 'plaza', parthenon: 'open',
  'brandenburg-gate': 'plaza', 'st-basils': 'plaza', 'winter-palace': 'plaza', neuschwanstein: 'open', 'dutch-windmills': 'open',
  matterhorn: 'peak', 'galata-tower': 'plaza', alhambra: 'open', pyramids: 'open', petra: 'cliff', persepolis: 'open',
  'table-mountain': 'peak', kilimanjaro: 'peak', 'victoria-falls': 'river', 'great-wall': 'open', 'forbidden-city': 'plaza',
  'mount-fuji': 'peak', 'himeji-castle': 'open', 'taj-mahal': 'open', 'gateway-of-india': 'shore', 'angkor-wat': 'open', registan: 'plaza',
  'statue-of-liberty': 'shore', 'golden-gate': 'span', 'empire-state': 'plaza', 'mount-rushmore': 'cliff', 'chichen-itza': 'open',
  'machu-picchu': 'peak', sugarloaf: 'peak', 'panama-locks': 'river', 'harbour-bridge': 'span',
};

/** A landmark standing on a map. */
export interface PlacedLandmark {
  id: LandmarkId;
  /** Top-left footprint cell on the map. */
  cx: number;
  cy: number;
  /** Footprint as placed on the map (w and h swapped for facing 1 and 3). */
  w: number;
  h: number;
  /** Quarter turns clockwise seen from above; 0 = the model's front to +z (south). */
  facing: 0 | 1 | 2 | 3;
  /** Terrain type (T.*) the renderer paints under the model (the sim cells are T.Rock). */
  ground: number;
}

export function isLandmarkId(id: unknown): id is LandmarkId {
  return typeof id === 'string' && (LANDMARK_IDS as readonly string[]).includes(id);
}

/** The footprint of a landmark as placed with a facing (w x h on the map). */
export function placedSize(id: LandmarkId, facing: 0 | 1 | 2 | 3): { w: number; h: number } {
  const f = LANDMARK_FOOTPRINTS[id];
  return facing % 2 ? { w: f.h, h: f.w } : { w: f.w, h: f.h };
}

/**
 * Stand a landmark on the map: its land cells become T.Rock (blocked like terrain, nothing grows or is built
 * there), water cells stay water for bridges, ore and trees under it go. Returns the placed record (also pushed
 * onto `map.landmarks`).
 */
export function placeLandmark(map: GameMap, id: LandmarkId, cx: number, cy: number, facing: 0 | 1 | 2 | 3, ground: number): PlacedLandmark {
  const { w, h } = placedSize(id, facing);
  const span = LANDMARK_SETTING[id] === 'span';
  for (let y = cy; y < cy + h; y++) for (let x = cx; x < cx + w; x++) {
    if (!map.inBounds(x, y)) continue;
    const i = map.idx(x, y);
    if (!(span && map.terrain[i] === T.Water)) map.terrain[i] = T.Rock;
    map.tree[i] = 0;
    map.ore[i] = 0;
    map.gems[i] = 0;
    map.oreField[i] = 0;
  }
  const lm: PlacedLandmark = { id, cx, cy, w, h, facing, ground };
  map.landmarks.push(lm);
  return lm;
}

/** The landmark covering a map cell, or null. */
export function landmarkAt(map: GameMap, x: number, y: number): PlacedLandmark | null {
  for (const l of map.landmarks) if (x >= l.cx && y >= l.cy && x < l.cx + l.w && y < l.cy + l.h) return l;
  return null;
}

/** Whether cell index i lies under a landmark. */
export function isLandmarkCell(map: GameMap, i: number): boolean {
  if (!map.landmarks.length) return false;
  return landmarkAt(map, i % map.w, (i / map.w) | 0) !== null;
}

/** Per-cell mask of the landmark footprints (renderers: what to keep clear of clutter). */
export function landmarkMask(map: GameMap, margin = 0): Uint8Array {
  const out = new Uint8Array(map.w * map.h);
  for (const l of map.landmarks) {
    for (let y = l.cy - margin; y < l.cy + l.h + margin; y++) for (let x = l.cx - margin; x < l.cx + l.w + margin; x++) {
      if (map.inBounds(x, y)) out[map.idx(x, y)] = 1;
    }
  }
  return out;
}
