/**
 * Curated skirmish maps: registry and loader API.
 *
 *   listMaps()            -> MapInfo[] for the map picker
 *   getMapDef(id)         -> the MapDef (description) or undefined
 *   loadCuratedMap(id)    -> a fresh, fully built GameMap (or null for an unknown id)
 *
 * See format.ts for the description format and build.ts for the builder.
 */
import type { GameMap } from '../sim/map';
import { buildMap } from './build';
import { MAP_DEFS } from './defs';
import type { MapDef, MapInfo } from './format';
import { getCustomMap } from './custom'; // custom (editor) maps

export type { MapDef, MapInfo } from './format';
export { buildMap } from './build';
export { customMaps, isCustomMapId } from './custom';

export const CURATED_MAPS: readonly MapDef[] = MAP_DEFS;

export function getMapDef(id: string): MapDef | undefined {
  return MAP_DEFS.find((m) => m.id === id) ?? getCustomMap(id); // editor maps too
}

export function mapInfo(def: MapDef): MapInfo {
  return {
    id: def.id, name: def.name, desc: def.desc, size: def.size, players: def.players, climate: def.climate,
    tags: def.tags ?? [], naval: !!def.naval,
  };
}

export function listMaps(): MapInfo[] {
  return MAP_DEFS.map(mapInfo);
}

/** Build a curated map by id (a new GameMap every call: the game mutates ore, trees and occupancy). */
export function loadCuratedMap(id: string): GameMap | null {
  const def = getMapDef(id);
  return def ? buildMap(def) : null;
}
