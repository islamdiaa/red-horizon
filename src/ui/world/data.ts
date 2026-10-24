/**
 * The world geography as the screens see it: the atlas the rules build runs from (regions, zones, homelands; GEO's
 * data once registered), the land outline, and the globe's sites for a view: every region (the setup screen) or a
 * run's map. With GEO's geography the globe uses its cell raster, so the cells on screen are the rules' cells (they
 * never jump a sea) and a Blitz run's other territories keep their World shapes, dimmed.
 */
import type { WorldHomeland, WorldRegion, WorldZone } from '../../conquest/world/types';
import type { WorldRun } from '../../conquest/world/state';
import { atlas } from '../../conquest/world/atlas';
import { buildWorld, landRings, worldRegions, type WorldMap } from '../../conquest/world/geo';
import { REGION_BY_ID } from '../../conquest/world/regions';
import type { GlobeWorld } from './globe';
import { MAX_SITES } from './globe';

export interface Geography {
  regions: readonly WorldRegion[];
  zones: readonly WorldZone[];
  homelands: readonly WorldHomeland[];
  /** region id -> index in `regions` */
  byId: Map<string, number>;
}

/** The globe's current sites: which region each site is, and the drawable world. */
export interface Sites {
  ids: string[];
  index: Map<string, number>;
  world: GlobeWorld;
  /** Zone id per site. */
  zones: string[];
  key: string;
}

let geoCache: { atlas: unknown; g: Geography } | null = null;

export function geography(): Geography {
  const a = atlas();
  if (geoCache?.atlas === a) return geoCache.g;
  const g: Geography = { regions: a.regions, zones: a.zones, homelands: a.homelands, byId: new Map(a.regions.map((r, i) => [r.id, i])) };
  geoCache = { atlas: a, g };
  return g;
}

let land: GlobeWorld['land'] | null = null;
function landOutline(): GlobeWorld['land'] {
  return (land ??= landRings().map((r) => r.ring.map(([lon, lat]) => [lon, lat] as [number, number])));
}

/** Whether region ids come from GEO's data (its cells and raster apply). */
function geoKnows(ids: readonly string[]): boolean {
  return ids.length > 0 && ids.every((id) => !!REGION_BY_ID[id]);
}

function fromMap(map: WorldMap, key: string): Sites {
  const ids = map.regions.slice(0, MAX_SITES);
  const zoneIds: string[] = [];
  const zones = ids.map((id) => REGION_BY_ID[id]?.zone ?? '');
  for (const z of zones) if (!zoneIds.includes(z)) zoneIds.push(z);
  return {
    ids, index: new Map(ids.map((id, i) => [id, i])), zones, key,
    world: {
      sites: map.territories.slice(0, MAX_SITES).map((t, i) => ({ id: t.id, lon: t.site[0], lat: t.site[1], zone: zoneIds.indexOf(zones[i]) })),
      anchors: map.territories.slice(0, MAX_SITES).map((t) => t.anchor),
      land: landOutline(), landRule: 'evenodd',
      labels: map.raster,
    },
  };
}

function plain(list: { id: string; lon: number; lat: number; zone: string }[], key: string): Sites {
  const ids = list.slice(0, MAX_SITES).map((r) => r.id);
  const zones = list.slice(0, MAX_SITES).map((r) => r.zone);
  const zoneIds = [...new Set(zones)];
  return {
    ids, index: new Map(ids.map((id, i) => [id, i])), zones, key,
    world: { sites: list.slice(0, MAX_SITES).map((r, i) => ({ id: r.id, lon: r.lon, lat: r.lat, zone: zoneIds.indexOf(zones[i]) })), land: landOutline(), landRule: 'evenodd', maxReach: 14 },
  };
}

let sitesCache: Sites | null = null;

/** Sites for the setup screen: every region of the atlas. */
export function allSites(): Sites {
  const g = geography();
  const ids = g.regions.map((r) => r.id);
  const key = `all:${ids.length}:${ids[0]}`;
  if (sitesCache?.key === key) return sitesCache;
  sitesCache = geoKnows(ids) ? fromMap(buildWorld(ids), key) : plain([...g.regions], key);
  return sitesCache;
}

/** Sites for a run: its World map's cells (a Blitz run sits inside them), else its own territories. */
export function runSites(run: WorldRun): Sites {
  const ids = run.territories.map((t) => t.id);
  const key = `run:${run.id}:${run.seed}:${ids.length}`;
  if (sitesCache?.key === key) return sitesCache;
  let s: Sites | null = null;
  if (geoKnows(ids)) {
    try {
      const within = worldRegions(run.seed);
      const set = new Set(within);
      s = fromMap(buildWorld(ids.every((id) => set.has(id)) ? within : ids), key);
    } catch (e) { console.warn('world map', e); }
  }
  sitesCache = s ?? plain(run.territories.map((t) => ({ id: t.id, lon: t.lon, lat: t.lat, zone: t.zone })), key);
  return sitesCache;
}
