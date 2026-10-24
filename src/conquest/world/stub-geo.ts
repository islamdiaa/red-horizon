/**
 * A small synthetic world for the strategic layer's tests and for headless play before (or without) the real
 * geography: 18 zones on six continents, ~110 sites laid out in spirals around each zone's centre, 40 homelands.
 * Not shown to players; the real data is GEO's regions.ts. Deterministic (no randomness at all).
 */
import type { Terrain } from '../geo';
import { LANDMARK_IDS, type Continent, type Culture, type LandmarkId, type MapFeature, type WonderEffect, type WorldClimate, type WorldHomeland, type WorldRegion, type WorldResource, type WorldZone } from './types';

interface ZoneSeed { id: string; name: string; continent: Continent; lon: number; lat: number; n: number; climate: WorldClimate; culture: Culture; terrain: Terrain[]; homes: number; faction: 'allies' | 'soviet' }

const Z: ZoneSeed[] = [
  { id: 'scandinavia', name: 'Scandinavia', continent: 'europe', lon: 16, lat: 63, n: 5, climate: 'winter', culture: 'nordic', terrain: ['forest', 'lakes', 'mountain'], homes: 2, faction: 'allies' },
  { id: 'western-europe', name: 'Western Europe', continent: 'europe', lon: 2, lat: 48, n: 7, climate: 'temperate', culture: 'western', terrain: ['plains', 'urban', 'river'], homes: 3, faction: 'allies' },
  { id: 'eastern-europe', name: 'Eastern Europe', continent: 'europe', lon: 26, lat: 50, n: 7, climate: 'temperate', culture: 'slavic', terrain: ['plains', 'forest', 'steppe'], homes: 3, faction: 'soviet' },
  { id: 'mediterranean', name: 'Mediterranean', continent: 'europe', lon: 14, lat: 40, n: 6, climate: 'desert', culture: 'mediterranean', terrain: ['coast', 'mountain', 'islands'], homes: 2, faction: 'allies' },
  { id: 'levant', name: 'The Levant', continent: 'asia', lon: 42, lat: 31, n: 6, climate: 'desert', culture: 'middle-eastern', terrain: ['steppe', 'mountain', 'coast'], homes: 2, faction: 'soviet' },
  { id: 'central-asia', name: 'Central Asia', continent: 'asia', lon: 68, lat: 44, n: 6, climate: 'desert', culture: 'middle-eastern', terrain: ['steppe', 'mountain'], homes: 2, faction: 'soviet' },
  { id: 'siberia', name: 'Siberia', continent: 'asia', lon: 100, lat: 62, n: 6, climate: 'winter', culture: 'slavic', terrain: ['forest', 'steppe', 'lakes'], homes: 1, faction: 'soviet' },
  { id: 'south-asia', name: 'South Asia', continent: 'asia', lon: 79, lat: 22, n: 6, climate: 'tropical', culture: 'south-asian', terrain: ['plains', 'river', 'mountain'], homes: 3, faction: 'allies' },
  { id: 'east-asia', name: 'East Asia', continent: 'asia', lon: 114, lat: 34, n: 7, climate: 'temperate', culture: 'east-asian', terrain: ['plains', 'river', 'mountain', 'urban'], homes: 3, faction: 'soviet' },
  { id: 'indochina', name: 'Indochina', continent: 'asia', lon: 104, lat: 12, n: 5, climate: 'tropical', culture: 'southeast-asian', terrain: ['forest', 'river', 'coast'], homes: 2, faction: 'allies' },
  { id: 'north-africa', name: 'North Africa', continent: 'africa', lon: 10, lat: 27, n: 6, climate: 'desert', culture: 'middle-eastern', terrain: ['steppe', 'coast', 'river'], homes: 2, faction: 'allies' },
  { id: 'west-africa', name: 'West Africa', continent: 'africa', lon: 2, lat: 9, n: 5, climate: 'tropical', culture: 'african', terrain: ['forest', 'plains', 'coast'], homes: 2, faction: 'allies' },
  { id: 'southern-africa', name: 'Southern Africa', continent: 'africa', lon: 27, lat: -16, n: 6, climate: 'temperate', culture: 'african', terrain: ['plains', 'steppe', 'mountain'], homes: 2, faction: 'allies' },
  { id: 'north-america', name: 'North America', continent: 'north-america', lon: -96, lat: 48, n: 8, climate: 'temperate', culture: 'north-american', terrain: ['plains', 'forest', 'urban', 'lakes'], homes: 3, faction: 'allies' },
  { id: 'central-america', name: 'Central America', continent: 'north-america', lon: -95, lat: 19, n: 5, climate: 'tropical', culture: 'latin-american', terrain: ['forest', 'mountain', 'coast'], homes: 2, faction: 'allies' },
  { id: 'andes', name: 'The Andes', continent: 'south-america', lon: -70, lat: -18, n: 6, climate: 'temperate', culture: 'latin-american', terrain: ['mountain', 'coast', 'plains'], homes: 2, faction: 'soviet' },
  { id: 'amazonia', name: 'Amazonia', continent: 'south-america', lon: -52, lat: -8, n: 5, climate: 'tropical', culture: 'latin-american', terrain: ['forest', 'river', 'coast'], homes: 2, faction: 'allies' },
  { id: 'australasia', name: 'Australasia', continent: 'oceania', lon: 138, lat: -26, n: 6, climate: 'desert', culture: 'oceanian', terrain: ['steppe', 'coast', 'plains'], homes: 2, faction: 'allies' },
];

const FEATURE_OF: Record<string, MapFeature[]> = {
  plains: ['farmland', 'town'], forest: ['town'], mountain: ['mountains'], lakes: ['lakes'], river: ['river', 'town'], coast: ['coast', 'harbour'],
  urban: ['city'], steppe: ['town'], islands: ['island', 'harbour'],
};
const RES: WorldResource[] = ['oil', 'ore', 'industry', 'grain', 'manpower', 'science'];

function build(): { regions: WorldRegion[]; zones: WorldZone[]; homelands: WorldHomeland[] } {
  const regions: WorldRegion[] = [], zones: WorldZone[] = [], homelands: WorldHomeland[] = [];
  let lm = 0, total = 0;
  for (const z of Z) {
    zones.push({ id: z.id, name: z.name, continent: z.continent, bonus: Math.max(1, Math.round(z.n * 0.45)) });
    const ids: string[] = [];
    for (let k = 0; k < z.n; k++) {
      const ang = k * 2.39996, r = k === 0 ? 0 : 4.2 * Math.sqrt(k);
      const lat = Math.max(-80, Math.min(80, z.lat + r * Math.sin(ang)));
      const lon = z.lon + (r * Math.cos(ang)) / Math.max(0.35, Math.cos((lat * Math.PI) / 180));
      const terrain = z.terrain[(k + total) % z.terrain.length];
      const outer = k >= z.n - 2;
      const resources: WorldResource[] = [RES[(k * 7 + total) % RES.length]];
      if (outer && k % 2 === 0) resources.push('port');
      const id = `${z.id}-${k + 1}`;
      ids.push(id);
      const region: WorldRegion = {
        id, name: `${z.name} ${k + 1}`, lon, lat, continent: z.continent, zone: z.id, terrain, climate: z.climate, culture: z.culture,
        features: [...(FEATURE_OF[terrain] ?? ['town'])], resources, core: k < 3,
      };
      if (k === 1 && lm < LANDMARK_IDS.length) region.landmark = LANDMARK_IDS[lm++];
      regions.push(region);
      total++;
    }
    // homelands: the centre site and (for bigger zones) sites further out, each with one neighbour
    const starts = [0, 3, 5].slice(0, z.homes);
    starts.forEach((k, h) => {
      if (k >= z.n) return;
      const id = `${z.id}-home-${h + 1}`;
      const capital = ids[k];
      const second = ids[(k + 1) % z.n];
      regions[regions.length - z.n + k].homeland = id;
      homelands.push({ id, name: `${z.name} ${String.fromCharCode(65 + h)}`, capital, regions: [capital, second], faction: z.faction, blurb: `${z.name}, homeland ${h + 1}.` });
    });
  }
  return { regions, zones, homelands };
}

const BUILT = build();
export const STUB_REGIONS: readonly WorldRegion[] = BUILT.regions;
export const STUB_ZONES: readonly WorldZone[] = BUILT.zones;
export const STUB_HOMELANDS: readonly WorldHomeland[] = BUILT.homelands;

/** Wonder effects for the stub (the real ones are GEO's LANDMARK_INFO). */
const EFFECTS: WonderEffect[] = [
  { kind: 'troops', add: 2 }, { kind: 'income', pct: 25 }, { kind: 'card', every: 4 }, { kind: 'defence', dice: 1 }, { kind: 'attack', dice: 1 },
  { kind: 'fortify', add: 1 }, { kind: 'navy', add: 2 }, { kind: 'intel', turns: 1 }, { kind: 'diplomacy', pct: 20 },
];
export function stubWonder(id: LandmarkId): WonderEffect {
  return EFFECTS[LANDMARK_IDS.indexOf(id) % EFFECTS.length];
}
