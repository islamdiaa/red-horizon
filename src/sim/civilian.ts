/**
 * World Conquest civilian buildings: the towns and cities of a region battlefield. Ordinary Buildings (they block,
 * burn, collapse and leave rubble through the normal destruction path) owned by the civic pseudo-player (id -1,
 * not in world.players, nobody's enemy: never auto-targeted, never captured or infiltrated; force-fire and splash
 * damage bring them down). They are empty: cost 0, so no survivors run out and no XP or credits are paid; no
 * weapons, no sight, no power. Each carries `scenery` (culture style, kind, seed, facing), which only the renderer
 * reads (src/render/civilian).
 *
 * The generator (mapgen-region.ts) lists the sites on the map (`GameMap.civilianSites`); `raiseCivilians` stands
 * them up when the World is built (landmarks.ts initRegionScenery). A save restores them like any building (the
 * owner id -1 comes back as the civic owner when the save has no Commander variety state: save.ts).
 *
 * Deterministic: the sites come from the map; no RNG is drawn here.
 */
import type { Culture } from '../conquest/world/types';
import type { Building } from './entities';
import { makeNeutral } from './events';
import type { Player } from './player';
import type { World } from './world';

/** Civilian building kinds (the models' grammar: src/render/civilian). */
export type CivilianKind = 'house' | 'apartment' | 'shop' | 'hall' | 'tower' | 'farm' | 'warehouse';

/** Footprint of each kind at facing 0 (cells, w = east-west). */
export const CIVILIAN_FOOTPRINTS: Record<CivilianKind, { w: number; h: number }> = {
  house: { w: 1, h: 1 }, apartment: { w: 2, h: 2 }, shop: { w: 2, h: 1 }, hall: { w: 3, h: 2 }, tower: { w: 1, h: 1 },
  farm: { w: 2, h: 2 }, warehouse: { w: 3, h: 2 },
};

/** The renderer-only look of a civilian building. */
export interface CivilianScenery {
  culture: Culture;
  kind: CivilianKind;
  seed: number;
  /** Quarter turns clockwise seen from above; 0 = front to +z (south). */
  facing: 0 | 1 | 2 | 3;
}

/** A civilian building to raise: its type (by footprint on the map), top-left cell and look. */
export interface CivilianSite extends CivilianScenery {
  type: string;
  cx: number;
  cy: number;
}

/** Building type id of a footprint on the map (rules.ts: cv11 ... cv33). */
export function civilianType(w: number, h: number): string {
  return `cv${w}${h}`;
}

/** Every civilian building type (rules.ts). */
export const CIVILIAN_TYPES = ['cv11', 'cv21', 'cv12', 'cv22', 'cv32', 'cv23'] as const;

/** Footprint on the map of a kind with a facing. */
export function civilianSize(kind: CivilianKind, facing: 0 | 1 | 2 | 3): { w: number; h: number } {
  const f = CIVILIAN_FOOTPRINTS[kind];
  return facing % 2 ? { w: f.h, h: f.w } : { w: f.w, h: f.h };
}

export function isCivilian(b: Building): boolean {
  return !!b.bt.civilian;
}

const owners = new WeakMap<World, Player>();

/** The civic pseudo-player of a world (id -1; the Commander variety's neutral player when there is one). */
export function civicOwner(w: World): Player {
  if (w.variety) return w.variety.neutral;
  let p = owners.get(w);
  if (!p) {
    p = makeNeutral(w);
    p.name = 'Civilians';
    owners.set(w, p);
  }
  return p;
}

/** Stand the map's civilian buildings (fresh World). Sites whose footprint is no longer clear are skipped. */
export function raiseCivilians(w: World) {
  const map = w.map;
  if (!map.civilianSites.length) return;
  const owner = civicOwner(w);
  for (const s of map.civilianSites) {
    if (!/^cv[1-3][1-3]$/.test(s.type)) continue;
    const sw = +s.type[2], sh = +s.type[3];
    let clear = true;
    for (let dy = 0; dy < sh && clear; dy++) for (let dx = 0; dx < sw; dx++) {
      const x = s.cx + dx, y = s.cy + dy;
      if (!map.inBounds(x, y) || !map.terrainPassable(map.idx(x, y)) || map.occupant[map.idx(x, y)]) { clear = false; break; }
    }
    if (!clear) continue;
    const b = w.addBuilding(s.type, owner, s.cx, s.cy, true);
    b.scenery = { culture: s.culture, kind: s.kind, seed: s.seed, facing: s.facing };
  }
}
