/**
 * World Conquest's regions, bonus zones, homelands and landmarks: the data every world run draws from.
 *
 * Each region is a real place (its lon/lat is the city or place it is named after) with what its battlefields look
 * like: terrain, climate, the architecture of its towns, its map features (most important first), what it produces,
 * and the landmark standing on it, if any. Territories are cut from these sites by ./geo.ts.
 *
 * Names follow the game's alternate 1953 (Leningrad, Peking, Bombay) and never name an area disputed today: such
 * areas are part of a geographic region around them, and no region's site lies inside one (tests/world-geo.test.ts).
 * Holy sites of living religions are never landmarks or objectives. English here; display names and blurbs are
 * translated through ./names.ts (tools/i18n/data-sources.ts, tables world*).
 */
import type { LandmarkId, WonderEffect, WorldHomeland, WorldRegion, WorldZone } from './types';

/**
 * Zone bonus, Risk style: (territories + border territories) / 3, rounded. On Risk's own board it gives Australia 2,
 * South America 2, Africa 3 (Risk: 2, 2, 3) and North America, Europe, Asia 4, 4, 6 (Risk: 5, 5, 7); here, where
 * sea lanes make most territories borders, it comes to about 0.6 troops per territory held, Risk's own rate.
 */
export const zoneBonus = (territories: number, borders: number): number => Math.max(1, Math.round((territories + borders) / 3));

/** The bonus zones (bonus = zoneBonus of the zone on the full map; a run's map recomputes it for its own territories). */
export const WORLD_ZONES: WorldZone[] = [
  { id: 'british-isles', name: 'British Isles', continent: 'europe', bonus: 3 },
  { id: 'scandinavia', name: 'Scandinavia', continent: 'europe', bonus: 3 },
  { id: 'western-europe', name: 'Western Europe', continent: 'europe', bonus: 5 },
  { id: 'central-europe', name: 'Central Europe', continent: 'europe', bonus: 5 },
  { id: 'southern-europe', name: 'Southern Europe', continent: 'europe', bonus: 4 },
  { id: 'eastern-europe', name: 'Eastern Europe', continent: 'europe', bonus: 4 },
  { id: 'middle-east', name: 'The Middle East', continent: 'asia', bonus: 6 },
  { id: 'siberia', name: 'Siberia', continent: 'asia', bonus: 5 },
  { id: 'east-asia', name: 'East Asia', continent: 'asia', bonus: 6 },
  { id: 'south-asia', name: 'South Asia', continent: 'asia', bonus: 3 },
  { id: 'southeast-asia', name: 'Southeast Asia', continent: 'asia', bonus: 4 },
  { id: 'north-africa', name: 'North Africa', continent: 'africa', bonus: 4 },
  { id: 'sub-saharan-africa', name: 'Sub-Saharan Africa', continent: 'africa', bonus: 5 },
  { id: 'great-north', name: 'The Great North', continent: 'north-america', bonus: 5 },
  { id: 'united-states', name: 'United States', continent: 'north-america', bonus: 5 },
  { id: 'central-america', name: 'Central America', continent: 'north-america', bonus: 2 },
  { id: 'south-america', name: 'South America', continent: 'south-america', bonus: 4 },
  { id: 'oceania', name: 'Oceania', continent: 'oceania', bonus: 3 },
];

type R = Omit<WorldRegion, 'continent'>;
const Z = (zone: string, list: R[]): WorldRegion[] => {
  const continent = WORLD_ZONES.find((z) => z.id === zone)!.continent;
  return list.map((r) => ({ ...r, zone, continent }));
};

/** Every region a world run can draw a territory from (~125; a World run uses ~100 of them, a Blitz run ~30). */
export const WORLD_REGIONS: WorldRegion[] = [
  // ------------------------------------------------------------------ Europe
  ...Z('british-isles', [
    { id: 'london', name: 'London', lon: -0.13, lat: 51.51, zone: '', terrain: 'urban', climate: 'temperate', culture: 'western', features: ['city', 'river', 'farmland'], resources: ['industry', 'science', 'manpower'], landmark: 'big-ben', homeland: 'britain', core: true },
    { id: 'thames', name: 'Thames Estuary', lon: 0.62, lat: 51.56, zone: '', terrain: 'coast', climate: 'temperate', culture: 'western', features: ['harbour', 'river', 'coast', 'town'], resources: ['port', 'industry'], landmark: 'tower-bridge', homeland: 'britain', core: true },
    { id: 'midlands', name: 'Midlands', lon: -1.9, lat: 52.48, zone: '', terrain: 'urban', climate: 'temperate', culture: 'western', features: ['town', 'farmland', 'river'], resources: ['industry', 'manpower'] },
    { id: 'scotland', name: 'Scotland', lon: -4.25, lat: 56.6, zone: '', terrain: 'mountain', climate: 'temperate', culture: 'western', features: ['mountains', 'lakes', 'coast', 'harbour'], resources: ['port', 'manpower'], core: true },
    { id: 'ireland', name: 'Ireland', lon: -7.9, lat: 53.3, zone: '', terrain: 'plains', climate: 'temperate', culture: 'western', features: ['farmland', 'coast', 'town', 'harbour'], resources: ['grain', 'manpower', 'port'], homeland: 'ireland', core: true },
  ]),
  ...Z('scandinavia', [
    { id: 'iceland', name: 'Iceland', lon: -19.0, lat: 64.9, zone: '', terrain: 'islands', climate: 'winter', culture: 'nordic', features: ['island', 'volcano', 'glacier', 'harbour'], resources: ['port'], homeland: 'iceland', iso: 'IS', core: true },
    { id: 'oslo', name: 'Oslo', lon: 10.75, lat: 59.91, zone: '', terrain: 'mountain', climate: 'winter', culture: 'nordic', features: ['coast', 'mountains', 'harbour', 'town'], resources: ['port', 'industry'], core: true },
    { id: 'stockholm', name: 'Stockholm', lon: 18.07, lat: 59.33, zone: '', terrain: 'forest', climate: 'temperate', culture: 'nordic', features: ['coast', 'lakes', 'city', 'harbour'], resources: ['industry', 'port'], homeland: 'sweden', core: true },
    { id: 'finland', name: 'Finland', lon: 25.5, lat: 62.0, zone: '', terrain: 'lakes', climate: 'winter', culture: 'nordic', features: ['lakes', 'town', 'river'], resources: ['manpower', 'industry'], iso: 'FI' },
    { id: 'lapland', name: 'Lapland', lon: 20.6, lat: 67.6, zone: '', terrain: 'forest', climate: 'winter', culture: 'nordic', features: ['lakes', 'mountains', 'river'], resources: ['ore'], homeland: 'sweden', core: true },
  ]),
  ...Z('western-europe', [
    { id: 'paris', name: 'Paris', lon: 2.35, lat: 48.86, zone: '', terrain: 'urban', climate: 'temperate', culture: 'western', features: ['city', 'river', 'farmland'], resources: ['industry', 'science', 'manpower'], landmark: 'eiffel-tower', homeland: 'france', core: true },
    { id: 'normandy', name: 'Normandy', lon: -0.37, lat: 49.18, zone: '', terrain: 'coast', climate: 'temperate', culture: 'western', features: ['coast', 'farmland', 'town', 'harbour'], resources: ['port', 'grain'], homeland: 'france', core: true },
    { id: 'provence', name: 'Provence', lon: 5.37, lat: 43.5, zone: '', terrain: 'coast', climate: 'temperate', culture: 'mediterranean', features: ['harbour', 'coast', 'mountains', 'town'], resources: ['port'] },
    { id: 'flanders', name: 'Flanders', lon: 3.72, lat: 51.05, zone: '', terrain: 'plains', climate: 'temperate', culture: 'western', features: ['farmland', 'town', 'river', 'harbour'], resources: ['industry', 'port'], homeland: 'low-countries', core: true },
    { id: 'holland', name: 'Holland', lon: 4.9, lat: 52.37, zone: '', terrain: 'lakes', climate: 'temperate', culture: 'western', features: ['farmland', 'river', 'coast', 'town'], resources: ['port', 'grain'], landmark: 'dutch-windmills', homeland: 'low-countries', core: true },
    { id: 'castile', name: 'Castile', lon: -3.7, lat: 40.42, zone: '', terrain: 'steppe', climate: 'desert', culture: 'mediterranean', features: ['farmland', 'town', 'mountains'], resources: ['grain', 'manpower'], homeland: 'spain', core: true },
    { id: 'andalusia', name: 'Andalusia', lon: -3.6, lat: 37.18, zone: '', terrain: 'mountain', climate: 'temperate', culture: 'mediterranean', features: ['mountains', 'town', 'farmland', 'coast'], resources: ['grain', 'port'], landmark: 'alhambra', homeland: 'spain', core: true },
    { id: 'lisbon', name: 'Lisbon', lon: -9.0, lat: 38.8, zone: '', terrain: 'coast', climate: 'temperate', culture: 'mediterranean', features: ['harbour', 'coast', 'city'], resources: ['port'] },
  ]),
  ...Z('central-europe', [
    { id: 'berlin', name: 'Berlin', lon: 13.4, lat: 52.52, zone: '', terrain: 'urban', climate: 'temperate', culture: 'western', features: ['city', 'river', 'lakes'], resources: ['industry', 'science'], landmark: 'brandenburg-gate', homeland: 'germany', core: true },
    { id: 'hamburg', name: 'Hamburg', lon: 10.0, lat: 53.55, zone: '', terrain: 'coast', climate: 'temperate', culture: 'western', features: ['harbour', 'river', 'city'], resources: ['port', 'industry'] },
    { id: 'rhineland', name: 'Rhineland', lon: 6.96, lat: 50.94, zone: '', terrain: 'river', climate: 'temperate', culture: 'western', features: ['river', 'city', 'farmland'], resources: ['industry', 'ore'], homeland: 'germany', core: true },
    { id: 'bavaria', name: 'Bavaria', lon: 11.58, lat: 48.14, zone: '', terrain: 'forest', climate: 'temperate', culture: 'western', features: ['mountains', 'lakes', 'town', 'farmland'], resources: ['industry', 'grain'], landmark: 'neuschwanstein', core: true },
    { id: 'alps', name: 'Swiss Alps', lon: 7.9, lat: 46.6, zone: '', terrain: 'mountain', climate: 'winter', culture: 'western', features: ['mountains', 'glacier', 'lakes', 'town'], resources: ['science', 'industry'], landmark: 'matterhorn', core: true },
    { id: 'vienna', name: 'Vienna', lon: 16.37, lat: 48.21, zone: '', terrain: 'river', climate: 'temperate', culture: 'western', features: ['river', 'city', 'farmland'], resources: ['industry', 'manpower'] },
    { id: 'warsaw', name: 'Warsaw', lon: 21.01, lat: 52.23, zone: '', terrain: 'plains', climate: 'temperate', culture: 'slavic', features: ['river', 'farmland', 'city'], resources: ['manpower', 'grain'], homeland: 'poland', core: true },
  ]),
  ...Z('southern-europe', [
    { id: 'tuscany', name: 'Tuscany', lon: 11.25, lat: 43.77, zone: '', terrain: 'plains', climate: 'temperate', culture: 'mediterranean', features: ['farmland', 'town', 'river', 'coast'], resources: ['grain', 'port'], landmark: 'leaning-tower', homeland: 'italy', core: true },
    { id: 'rome', name: 'Rome', lon: 12.5, lat: 41.9, zone: '', terrain: 'urban', climate: 'temperate', culture: 'mediterranean', features: ['city', 'river', 'coast'], resources: ['manpower', 'science', 'port'], landmark: 'colosseum', homeland: 'italy', core: true },
    { id: 'belgrade', name: 'Belgrade', lon: 20.46, lat: 44.8, zone: '', terrain: 'river', climate: 'temperate', culture: 'slavic', features: ['river', 'farmland', 'town'], resources: ['manpower'] },
    { id: 'athens', name: 'Athens', lon: 23.73, lat: 37.98, zone: '', terrain: 'coast', climate: 'temperate', culture: 'mediterranean', features: ['coast', 'harbour', 'city', 'mountains'], resources: ['port'], landmark: 'parthenon', homeland: 'greece', core: true },
    { id: 'bucharest', name: 'Bucharest', lon: 26.1, lat: 44.43, zone: '', terrain: 'plains', climate: 'temperate', culture: 'slavic', features: ['farmland', 'river', 'town'], resources: ['oil', 'grain'] },
    { id: 'istanbul', name: 'Istanbul', lon: 28.75, lat: 41.1, zone: '', terrain: 'urban', climate: 'temperate', culture: 'middle-eastern', features: ['city', 'harbour', 'coast'], resources: ['port', 'industry'], landmark: 'galata-tower', homeland: 'turkey', core: true },
  ]),
  ...Z('eastern-europe', [
    { id: 'leningrad', name: 'Leningrad', lon: 30.32, lat: 59.94, zone: '', terrain: 'urban', climate: 'winter', culture: 'slavic', features: ['city', 'river', 'harbour'], resources: ['industry', 'science', 'port'], landmark: 'winter-palace', homeland: 'soviet-union', core: true },
    { id: 'moscow', name: 'Moscow', lon: 37.62, lat: 55.75, zone: '', terrain: 'urban', climate: 'winter', culture: 'slavic', features: ['city', 'river'], resources: ['industry', 'science', 'manpower'], landmark: 'st-basils', homeland: 'soviet-union', core: true },
    { id: 'kyiv', name: 'Kyiv', lon: 30.52, lat: 50.45, zone: '', terrain: 'river', climate: 'temperate', culture: 'slavic', features: ['river', 'city', 'farmland'], resources: ['grain', 'industry'], homeland: 'ukraine', core: true },
    { id: 'odessa', name: 'Odessa', lon: 30.63, lat: 46.53, zone: '', terrain: 'coast', climate: 'temperate', culture: 'slavic', features: ['harbour', 'coast', 'farmland'], resources: ['port', 'grain'], homeland: 'ukraine', core: true },
    { id: 'stalingrad', name: 'Stalingrad', lon: 44.52, lat: 48.71, zone: '', terrain: 'river', climate: 'winter', culture: 'slavic', features: ['river', 'city', 'farmland'], resources: ['industry', 'oil'], homeland: 'soviet-union', core: true },
    { id: 'caucasus', name: 'Caucasus', lon: 44.8, lat: 42.0, zone: '', terrain: 'mountain', climate: 'temperate', culture: 'middle-eastern', features: ['mountains', 'town', 'river'], resources: ['oil'] },
  ]),
  // ------------------------------------------------------------------ Asia
  ...Z('middle-east', [
    { id: 'anatolia', name: 'Anatolia', lon: 32.86, lat: 39.93, zone: '', terrain: 'steppe', climate: 'temperate', culture: 'middle-eastern', features: ['mountains', 'town', 'farmland'], resources: ['manpower', 'grain'], homeland: 'turkey', core: true },
    { id: 'levant', name: 'Levant', lon: 36.29, lat: 33.51, zone: '', terrain: 'mountain', climate: 'desert', culture: 'middle-eastern', features: ['mountains', 'coast', 'city', 'harbour'], resources: ['port', 'grain'] },
    { id: 'petra', name: 'Petra', lon: 35.44, lat: 30.33, zone: '', terrain: 'mountain', climate: 'desert', culture: 'middle-eastern', features: ['canyon', 'mountains', 'oasis'], resources: ['ore'], landmark: 'petra', core: true },
    { id: 'mesopotamia', name: 'Mesopotamia', lon: 44.37, lat: 33.31, zone: '', terrain: 'river', climate: 'desert', culture: 'middle-eastern', features: ['river', 'city', 'oasis', 'farmland'], resources: ['oil', 'grain'] },
    { id: 'tehran', name: 'Tehran', lon: 51.39, lat: 35.69, zone: '', terrain: 'mountain', climate: 'desert', culture: 'middle-eastern', features: ['mountains', 'city', 'oasis'], resources: ['oil', 'manpower'], homeland: 'iran', core: true },
    { id: 'fars', name: 'Fars', lon: 52.53, lat: 29.61, zone: '', terrain: 'mountain', climate: 'desert', culture: 'middle-eastern', features: ['mountains', 'oasis', 'town', 'coast'], resources: ['oil', 'port'], landmark: 'persepolis', homeland: 'iran', core: true },
    { id: 'arabia', name: 'Arabia', lon: 46.72, lat: 24.69, zone: '', terrain: 'steppe', climate: 'desert', culture: 'middle-eastern', features: ['dunes', 'oasis', 'town', 'coast'], resources: ['oil', 'port'], homeland: 'arabia', core: true },
    { id: 'samarkand', name: 'Samarkand', lon: 66.97, lat: 39.65, zone: '', terrain: 'plains', climate: 'desert', culture: 'middle-eastern', features: ['oasis', 'city', 'mountains'], resources: ['grain'], landmark: 'registan', core: true },
    { id: 'hindu-kush', name: 'Hindu Kush', lon: 69.17, lat: 34.53, zone: '', terrain: 'mountain', climate: 'desert', culture: 'middle-eastern', features: ['mountains', 'canyon', 'town'], resources: ['manpower'], homeland: 'afghanistan', core: true },
  ]),
  ...Z('siberia', [
    { id: 'urals', name: 'Urals', lon: 60.6, lat: 56.84, zone: '', terrain: 'mountain', climate: 'winter', culture: 'slavic', features: ['mountains', 'city', 'river'], resources: ['ore', 'industry'] },
    { id: 'novosibirsk', name: 'Novosibirsk', lon: 82.93, lat: 55.03, zone: '', terrain: 'plains', climate: 'winter', culture: 'slavic', features: ['river', 'town', 'farmland'], resources: ['industry', 'grain'] },
    { id: 'baikal', name: 'Baikal', lon: 104.3, lat: 52.29, zone: '', terrain: 'lakes', climate: 'winter', culture: 'slavic', features: ['lakes', 'mountains', 'river'], resources: ['ore', 'industry'] },
    { id: 'yakutsk', name: 'Yakutsk', lon: 129.73, lat: 62.03, zone: '', terrain: 'forest', climate: 'winter', culture: 'slavic', features: ['river', 'lakes', 'town'], resources: ['ore'] },
    { id: 'kolyma', name: 'Kolyma', lon: 150.8, lat: 59.57, zone: '', terrain: 'mountain', climate: 'winter', culture: 'slavic', features: ['mountains', 'coast', 'harbour'], resources: ['ore', 'port'] },
    { id: 'kamchatka', name: 'Kamchatka', lon: 158.65, lat: 53.02, zone: '', terrain: 'mountain', climate: 'winter', culture: 'slavic', features: ['volcano', 'coast', 'harbour'], resources: ['port'], core: true },
    { id: 'vladivostok', name: 'Vladivostok', lon: 131.9, lat: 43.12, zone: '', terrain: 'coast', climate: 'winter', culture: 'slavic', features: ['harbour', 'coast', 'mountains'], resources: ['port'] },
    { id: 'mongolia', name: 'Mongolia', lon: 106.92, lat: 47.92, zone: '', terrain: 'steppe', climate: 'winter', culture: 'east-asian', features: ['dunes', 'town', 'mountains'], resources: ['manpower', 'grain'], homeland: 'mongolia', iso: 'MN', core: true },
  ]),
  ...Z('east-asia', [
    { id: 'peking', name: 'Peking', lon: 116.4, lat: 39.9, zone: '', terrain: 'urban', climate: 'temperate', culture: 'east-asian', features: ['city', 'farmland', 'mountains'], resources: ['manpower', 'industry'], landmark: 'forbidden-city', homeland: 'china', core: true },
    { id: 'shanxi', name: 'Shanxi', lon: 112.55, lat: 37.87, zone: '', terrain: 'mountain', climate: 'temperate', culture: 'east-asian', features: ['mountains', 'canyon', 'town'], resources: ['ore'], landmark: 'great-wall', core: true },
    { id: 'manchuria', name: 'Manchuria', lon: 123.43, lat: 41.8, zone: '', terrain: 'plains', climate: 'winter', culture: 'east-asian', features: ['farmland', 'city', 'river'], resources: ['industry', 'ore'] },
    { id: 'shanghai', name: 'Shanghai', lon: 121.3, lat: 31.2, zone: '', terrain: 'urban', climate: 'temperate', culture: 'east-asian', features: ['city', 'harbour', 'river'], resources: ['port', 'industry'], homeland: 'china', core: true },
    { id: 'canton', name: 'Canton', lon: 113.26, lat: 23.13, zone: '', terrain: 'coast', climate: 'tropical', culture: 'east-asian', features: ['harbour', 'river', 'city'], resources: ['port', 'manpower'] },
    { id: 'sichuan', name: 'Sichuan', lon: 104.07, lat: 30.67, zone: '', terrain: 'mountain', climate: 'temperate', culture: 'east-asian', features: ['mountains', 'farmland', 'river'], resources: ['grain', 'manpower'] },
    { id: 'korea', name: 'Korea', lon: 127.0, lat: 37.57, zone: '', terrain: 'mountain', climate: 'temperate', culture: 'east-asian', features: ['mountains', 'coast', 'town', 'harbour'], resources: ['manpower', 'port'] },
    { id: 'tokyo', name: 'Tokyo', lon: 139.69, lat: 35.69, zone: '', terrain: 'urban', climate: 'temperate', culture: 'east-asian', features: ['city', 'harbour', 'coast'], resources: ['industry', 'science', 'port'], landmark: 'mount-fuji', homeland: 'japan', core: true },
    { id: 'kansai', name: 'Kansai', lon: 135.5, lat: 34.69, zone: '', terrain: 'coast', climate: 'temperate', culture: 'east-asian', features: ['city', 'harbour', 'mountains'], resources: ['industry', 'port'], landmark: 'himeji-castle', homeland: 'japan', core: true },
  ]),
  ...Z('south-asia', [
    { id: 'karachi', name: 'Karachi', lon: 67.2, lat: 24.95, zone: '', terrain: 'coast', climate: 'desert', culture: 'south-asian', features: ['harbour', 'coast', 'river'], resources: ['port'], homeland: 'pakistan', core: true },
    { id: 'delhi', name: 'Delhi', lon: 77.21, lat: 28.61, zone: '', terrain: 'urban', climate: 'temperate', culture: 'south-asian', features: ['city', 'river', 'farmland'], resources: ['manpower', 'grain'], landmark: 'taj-mahal', homeland: 'india', core: true },
    { id: 'bombay', name: 'Bombay', lon: 73.0, lat: 19.1, zone: '', terrain: 'coast', climate: 'tropical', culture: 'south-asian', features: ['harbour', 'city', 'coast'], resources: ['port', 'industry'], landmark: 'gateway-of-india', homeland: 'india', core: true },
    { id: 'bengal', name: 'Bengal', lon: 88.36, lat: 22.57, zone: '', terrain: 'river', climate: 'tropical', culture: 'south-asian', features: ['river', 'jungle', 'city', 'harbour'], resources: ['manpower', 'grain', 'port'] },
    { id: 'madras', name: 'Madras', lon: 80.1, lat: 13.08, zone: '', terrain: 'coast', climate: 'tropical', culture: 'south-asian', features: ['coast', 'harbour', 'town'], resources: ['port'] },
    { id: 'himalaya', name: 'Himalaya', lon: 85.32, lat: 27.7, zone: '', terrain: 'mountain', climate: 'winter', culture: 'south-asian', features: ['mountains', 'glacier', 'town'], resources: ['manpower'] },
  ]),
  ...Z('southeast-asia', [
    { id: 'rangoon', name: 'Rangoon', lon: 96.16, lat: 16.9, zone: '', terrain: 'river', climate: 'tropical', culture: 'southeast-asian', features: ['jungle', 'river', 'harbour'], resources: ['grain', 'oil', 'port'] },
    { id: 'bangkok', name: 'Bangkok', lon: 100.5, lat: 13.9, zone: '', terrain: 'river', climate: 'tropical', culture: 'southeast-asian', features: ['river', 'city', 'jungle', 'harbour'], resources: ['grain', 'port'], homeland: 'thailand', core: true },
    { id: 'angkor', name: 'Angkor', lon: 103.87, lat: 13.41, zone: '', terrain: 'forest', climate: 'tropical', culture: 'southeast-asian', features: ['jungle', 'lakes', 'river'], resources: ['grain'], landmark: 'angkor-wat', core: true },
    { id: 'hanoi', name: 'Hanoi', lon: 105.85, lat: 21.03, zone: '', terrain: 'river', climate: 'tropical', culture: 'southeast-asian', features: ['river', 'farmland', 'mountains'], resources: ['grain', 'manpower'], homeland: 'vietnam', core: true },
    { id: 'sumatra', name: 'Sumatra', lon: 101.5, lat: -0.4, zone: '', terrain: 'forest', climate: 'tropical', culture: 'southeast-asian', features: ['jungle', 'volcano', 'coast'], resources: ['oil', 'port'], homeland: 'indonesia', core: true },
    { id: 'java', name: 'Java', lon: 110.0, lat: -7.3, zone: '', terrain: 'forest', climate: 'tropical', culture: 'southeast-asian', features: ['volcano', 'farmland', 'city', 'harbour'], resources: ['manpower', 'grain', 'port'], homeland: 'indonesia', core: true },
    { id: 'borneo', name: 'Borneo', lon: 114.5, lat: 0.5, zone: '', terrain: 'forest', climate: 'tropical', culture: 'southeast-asian', features: ['jungle', 'river', 'coast'], resources: ['oil'] },
    { id: 'luzon', name: 'Luzon', lon: 121.0, lat: 15.0, zone: '', terrain: 'coast', climate: 'tropical', culture: 'southeast-asian', features: ['harbour', 'city', 'volcano', 'jungle'], resources: ['port', 'grain'], homeland: 'philippines', core: true },
  ]),
  // ------------------------------------------------------------------ Africa
  ...Z('north-africa', [
    { id: 'casablanca', name: 'Casablanca', lon: -7.4, lat: 33.4, zone: '', terrain: 'coast', climate: 'desert', culture: 'middle-eastern', features: ['harbour', 'coast', 'city', 'mountains'], resources: ['port', 'ore'], homeland: 'morocco', core: true },
    { id: 'algiers', name: 'Algiers', lon: 3.06, lat: 36.6, zone: '', terrain: 'coast', climate: 'desert', culture: 'mediterranean', features: ['coast', 'harbour', 'mountains', 'city'], resources: ['oil', 'port'], homeland: 'algeria', core: true },
    { id: 'tunis', name: 'Tunis', lon: 10.1, lat: 36.7, zone: '', terrain: 'coast', climate: 'desert', culture: 'mediterranean', features: ['coast', 'harbour', 'oasis'], resources: ['port', 'grain'] },
    { id: 'tripoli', name: 'Tripoli', lon: 13.19, lat: 32.8, zone: '', terrain: 'coast', climate: 'desert', culture: 'middle-eastern', features: ['coast', 'dunes', 'oasis', 'harbour'], resources: ['oil', 'port'] },
    { id: 'cairo', name: 'Cairo', lon: 31.24, lat: 30.04, zone: '', terrain: 'urban', climate: 'desert', culture: 'middle-eastern', features: ['river', 'city', 'dunes'], resources: ['manpower', 'grain'], landmark: 'pyramids', homeland: 'egypt', core: true },
    { id: 'sahara', name: 'Sahara', lon: 5.53, lat: 22.79, zone: '', terrain: 'steppe', climate: 'desert', culture: 'african', features: ['dunes', 'oasis', 'mountains'], resources: ['oil', 'ore'] },
    { id: 'khartoum', name: 'Khartoum', lon: 32.53, lat: 15.59, zone: '', terrain: 'river', climate: 'desert', culture: 'middle-eastern', features: ['river', 'dunes', 'town'], resources: ['grain'] },
  ]),
  ...Z('sub-saharan-africa', [
    { id: 'dakar', name: 'Dakar', lon: -16.9, lat: 14.8, zone: '', terrain: 'coast', climate: 'desert', culture: 'african', features: ['harbour', 'coast', 'town'], resources: ['port'], core: true },
    { id: 'lagos', name: 'Lagos', lon: 3.6, lat: 6.7, zone: '', terrain: 'coast', climate: 'tropical', culture: 'african', features: ['harbour', 'jungle', 'river', 'city'], resources: ['port', 'manpower', 'oil'], homeland: 'nigeria', core: true },
    { id: 'congo', name: 'Congo', lon: 15.31, lat: -4.32, zone: '', terrain: 'river', climate: 'tropical', culture: 'african', features: ['jungle', 'river', 'town'], resources: ['ore'], homeland: 'congo', core: true },
    { id: 'abyssinia', name: 'Abyssinia', lon: 38.75, lat: 9.03, zone: '', terrain: 'mountain', climate: 'temperate', culture: 'african', features: ['mountains', 'canyon', 'town'], resources: ['manpower', 'grain'], homeland: 'ethiopia', core: true },
    { id: 'kilimanjaro', name: 'Kilimanjaro', lon: 37.35, lat: -3.07, zone: '', terrain: 'mountain', climate: 'tropical', culture: 'african', features: ['mountains', 'farmland', 'glacier'], resources: ['grain'], landmark: 'kilimanjaro', core: true },
    { id: 'zambezi', name: 'Zambezi', lon: 25.86, lat: -17.92, zone: '', terrain: 'river', climate: 'tropical', culture: 'african', features: ['river', 'canyon', 'farmland'], resources: ['ore'], landmark: 'victoria-falls', core: true },
    { id: 'transvaal', name: 'Transvaal', lon: 28.05, lat: -26.2, zone: '', terrain: 'steppe', climate: 'temperate', culture: 'western', features: ['town', 'farmland', 'mountains'], resources: ['ore', 'industry'], homeland: 'south-africa', core: true },
    { id: 'cape', name: 'Cape Town', lon: 18.6, lat: -33.9, zone: '', terrain: 'coast', climate: 'temperate', culture: 'western', features: ['harbour', 'mountains', 'coast'], resources: ['port'], landmark: 'table-mountain', homeland: 'south-africa', core: true },
    { id: 'madagascar', name: 'Madagascar', lon: 46.9, lat: -19.0, zone: '', terrain: 'islands', climate: 'tropical', culture: 'african', features: ['island', 'coast', 'mountains', 'harbour'], resources: ['port', 'grain'], iso: 'MG' },
  ]),
  // ------------------------------------------------------------------ North America
  ...Z('great-north', [
    { id: 'alaska', name: 'Alaska', lon: -149.9, lat: 61.4, zone: '', terrain: 'mountain', climate: 'winter', culture: 'north-american', features: ['mountains', 'coast', 'glacier', 'harbour'], resources: ['port', 'oil'], core: true },
    { id: 'vancouver', name: 'Vancouver', lon: -122.8, lat: 49.4, zone: '', terrain: 'coast', climate: 'temperate', culture: 'north-american', features: ['harbour', 'mountains', 'coast'], resources: ['port'] },
    { id: 'prairies', name: 'Prairies', lon: -104.6, lat: 50.45, zone: '', terrain: 'plains', climate: 'winter', culture: 'north-american', features: ['farmland', 'town', 'lakes'], resources: ['grain'] },
    { id: 'hudson', name: 'Hudson Bay', lon: -94.4, lat: 58.6, zone: '', terrain: 'lakes', climate: 'winter', culture: 'north-american', features: ['coast', 'lakes', 'glacier', 'harbour'], resources: ['port'] },
    { id: 'ontario', name: 'Ontario', lon: -79.38, lat: 43.75, zone: '', terrain: 'forest', climate: 'temperate', culture: 'north-american', features: ['lakes', 'city', 'river'], resources: ['industry', 'manpower'], homeland: 'canada', core: true },
    { id: 'quebec', name: 'Quebec', lon: -71.21, lat: 46.81, zone: '', terrain: 'river', climate: 'winter', culture: 'north-american', features: ['river', 'city', 'lakes', 'harbour'], resources: ['ore', 'industry', 'port'], homeland: 'canada', core: true },
    { id: 'greenland', name: 'Greenland', lon: -42.0, lat: 72.0, zone: '', terrain: 'islands', climate: 'winter', culture: 'nordic', features: ['glacier', 'coast', 'harbour', 'island'], resources: ['science', 'port'], iso: 'GL', core: true },
  ]),
  ...Z('united-states', [
    { id: 'washington', name: 'Washington', lon: -77.04, lat: 38.91, zone: '', terrain: 'urban', climate: 'temperate', culture: 'north-american', features: ['city', 'river', 'farmland'], resources: ['industry', 'science', 'manpower'], homeland: 'usa', core: true },
    { id: 'new-york', name: 'New York', lon: -73.95, lat: 40.8, zone: '', terrain: 'urban', climate: 'temperate', culture: 'north-american', features: ['city', 'harbour', 'river'], resources: ['industry', 'port', 'science'], landmark: 'empire-state', homeland: 'usa', core: true },
    { id: 'new-jersey', name: 'New Jersey', lon: -74.6, lat: 40.2, zone: '', terrain: 'coast', climate: 'temperate', culture: 'north-american', features: ['harbour', 'coast', 'town'], resources: ['port', 'industry'], landmark: 'statue-of-liberty', core: true },
    { id: 'chicago', name: 'Chicago', lon: -87.63, lat: 41.88, zone: '', terrain: 'urban', climate: 'temperate', culture: 'north-american', features: ['city', 'lakes', 'farmland'], resources: ['industry', 'grain'] },
    { id: 'dakota', name: 'Dakota', lon: -103.46, lat: 43.88, zone: '', terrain: 'plains', climate: 'temperate', culture: 'north-american', features: ['farmland', 'mountains', 'town'], resources: ['grain', 'ore'], landmark: 'mount-rushmore', core: true },
    { id: 'texas', name: 'Texas', lon: -97.74, lat: 30.27, zone: '', terrain: 'plains', climate: 'desert', culture: 'north-american', features: ['farmland', 'town', 'coast'], resources: ['oil'] },
    { id: 'san-francisco', name: 'San Francisco', lon: -122.2, lat: 37.8, zone: '', terrain: 'coast', climate: 'temperate', culture: 'north-american', features: ['harbour', 'coast', 'city'], resources: ['port', 'science'], landmark: 'golden-gate', core: true },
  ]),
  ...Z('central-america', [
    { id: 'mexico', name: 'Mexico City', lon: -99.13, lat: 19.43, zone: '', terrain: 'mountain', climate: 'temperate', culture: 'latin-american', features: ['city', 'mountains', 'volcano'], resources: ['manpower', 'oil'], homeland: 'mexico', core: true },
    { id: 'yucatan', name: 'Yucatán', lon: -88.57, lat: 20.68, zone: '', terrain: 'forest', climate: 'tropical', culture: 'latin-american', features: ['jungle', 'town', 'coast'], resources: ['grain'], landmark: 'chichen-itza', core: true },
    { id: 'havana', name: 'Havana', lon: -82.38, lat: 22.95, zone: '', terrain: 'coast', climate: 'tropical', culture: 'latin-american', features: ['harbour', 'coast', 'city'], resources: ['port', 'grain'], homeland: 'cuba', core: true },
    { id: 'panama', name: 'Panama', lon: -79.6, lat: 9.1, zone: '', terrain: 'coast', climate: 'tropical', culture: 'latin-american', features: ['jungle', 'harbour', 'coast'], resources: ['port'], landmark: 'panama-locks', core: true },
  ]),
  // ------------------------------------------------------------------ South America
  ...Z('south-america', [
    { id: 'caracas', name: 'Caracas', lon: -66.9, lat: 10.3, zone: '', terrain: 'coast', climate: 'tropical', culture: 'latin-american', features: ['coast', 'mountains', 'city', 'harbour'], resources: ['oil', 'port'], homeland: 'venezuela', core: true },
    { id: 'bogota', name: 'Bogotá', lon: -74.07, lat: 4.71, zone: '', terrain: 'mountain', climate: 'temperate', culture: 'latin-american', features: ['mountains', 'city', 'jungle'], resources: ['manpower', 'ore'] },
    { id: 'amazon', name: 'Amazon', lon: -60.02, lat: -3.12, zone: '', terrain: 'forest', climate: 'tropical', culture: 'latin-american', features: ['jungle', 'river', 'lakes'], resources: ['ore'] },
    { id: 'recife', name: 'Recife', lon: -35.2, lat: -8.1, zone: '', terrain: 'coast', climate: 'tropical', culture: 'latin-american', features: ['harbour', 'coast', 'town'], resources: ['port', 'grain'], homeland: 'brazil', core: true },
    { id: 'rio', name: 'Rio de Janeiro', lon: -43.3, lat: -22.8, zone: '', terrain: 'coast', climate: 'tropical', culture: 'latin-american', features: ['harbour', 'city', 'mountains'], resources: ['port', 'manpower'], landmark: 'sugarloaf', homeland: 'brazil', core: true },
    { id: 'cusco', name: 'Cusco', lon: -71.97, lat: -13.53, zone: '', terrain: 'mountain', climate: 'temperate', culture: 'latin-american', features: ['mountains', 'canyon', 'town'], resources: ['ore'], landmark: 'machu-picchu', homeland: 'peru', core: true },
    { id: 'santiago', name: 'Santiago', lon: -70.65, lat: -33.45, zone: '', terrain: 'mountain', climate: 'temperate', culture: 'latin-american', features: ['mountains', 'city', 'farmland'], resources: ['ore'], homeland: 'chile', core: true },
    { id: 'buenos-aires', name: 'Buenos Aires', lon: -58.6, lat: -34.6, zone: '', terrain: 'plains', climate: 'temperate', culture: 'latin-american', features: ['farmland', 'city', 'river', 'harbour'], resources: ['grain', 'port', 'manpower'], homeland: 'argentina', core: true },
    { id: 'patagonia', name: 'Patagonia', lon: -69.0, lat: -44.5, zone: '', terrain: 'steppe', climate: 'winter', culture: 'latin-american', features: ['mountains', 'glacier', 'lakes'], resources: ['oil'] },
  ]),
  // ------------------------------------------------------------------ Oceania
  ...Z('oceania', [
    { id: 'sydney', name: 'Sydney', lon: 151.0, lat: -33.8, zone: '', terrain: 'coast', climate: 'temperate', culture: 'oceanian', features: ['harbour', 'city', 'coast'], resources: ['port', 'industry'], landmark: 'harbour-bridge', homeland: 'australia', core: true },
    { id: 'perth', name: 'Perth', lon: 116.0, lat: -31.95, zone: '', terrain: 'coast', climate: 'desert', culture: 'oceanian', features: ['coast', 'dunes', 'town', 'harbour'], resources: ['ore', 'port'] },
    { id: 'darwin', name: 'Darwin', lon: 131.0, lat: -12.6, zone: '', terrain: 'coast', climate: 'tropical', culture: 'oceanian', features: ['coast', 'jungle', 'harbour'], resources: ['port'], core: true },
    { id: 'new-zealand', name: 'New Zealand', lon: 175.6, lat: -40.4, zone: '', terrain: 'islands', climate: 'temperate', culture: 'oceanian', features: ['island', 'mountains', 'coast', 'harbour'], resources: ['grain', 'port'], homeland: 'new-zealand', iso: 'NZ', core: true },
    { id: 'new-guinea', name: 'New Guinea', lon: 143.5, lat: -5.8, zone: '', terrain: 'forest', climate: 'tropical', culture: 'southeast-asian', features: ['jungle', 'mountains', 'coast'], resources: ['ore', 'oil'], core: true },
    { id: 'hawaii', name: 'Hawaii', lon: -155.5, lat: 19.6, zone: '', terrain: 'islands', climate: 'tropical', culture: 'oceanian', features: ['island', 'volcano', 'harbour'], resources: ['port'], core: true },
  ]),
];

export const REGION_BY_ID: Record<string, WorldRegion> = Object.fromEntries(WORLD_REGIONS.map((r) => [r.id, r]));
export const ZONE_BY_ID: Record<string, WorldZone> = Object.fromEntries(WORLD_ZONES.map((z) => [z.id, z]));

/** Starting nations (fictional 1953 regimes: the commanders and rival regimes are the strategic layer's). */
export const WORLD_HOMELANDS: WorldHomeland[] = [
  // Europe
  { id: 'britain', name: 'Britain', capital: 'london', regions: ['london', 'thames'], faction: 'allies', blurb: 'An island fortress with the Channel for a moat and the Royal Navy at the door. Hold the sea lanes and strike where you please.' },
  { id: 'ireland', name: 'Ireland', capital: 'ireland', regions: ['ireland'], faction: 'allies', blurb: 'One green island on the Atlantic rim: small, hard to reach and nobody\'s first target. Start quiet, finish loud.' },
  { id: 'france', name: 'France', capital: 'paris', regions: ['paris', 'normandy'], faction: 'allies', blurb: 'The crossroads of Western Europe, with roads to every border and a coast on two seas. Everyone is a neighbour.' },
  { id: 'spain', name: 'Spain', capital: 'castile', regions: ['castile', 'andalusia'], faction: 'allies', blurb: 'A high plateau behind the Pyrenees, with Gibraltar\'s strait as the door to Africa. Easy to defend, slow to leave.' },
  { id: 'low-countries', name: 'Low Countries', capital: 'holland', regions: ['holland', 'flanders'], faction: 'allies', blurb: 'Dykes, ports and canals between the great powers. Rich, flat and in everyone\'s way: strike first.' },
  { id: 'germany', name: 'Germany', capital: 'berlin', regions: ['berlin', 'rhineland'], faction: 'allies', blurb: 'The industrial heart of Europe, ringed by rivals on every side. Fast hands win here; slow ones are surrounded.' },
  { id: 'italy', name: 'Italy', capital: 'rome', regions: ['rome', 'tuscany'], faction: 'allies', blurb: 'A long peninsula reaching into the middle of the Mediterranean. Ports everywhere, and the Alps at your back.' },
  { id: 'greece', name: 'Greece', capital: 'athens', regions: ['athens'], faction: 'allies', blurb: 'Mountains, islands and a fleet\'s worth of harbours where Europe meets the Levant. A small start with long reach.' },
  { id: 'poland', name: 'Poland', capital: 'warsaw', regions: ['warsaw'], faction: 'soviet', blurb: 'Open plains between Berlin and Moscow, with no mountain to hide behind. Survive the first turns and the map is yours.' },
  { id: 'soviet-union', name: 'Soviet Union', capital: 'moscow', regions: ['moscow', 'leningrad', 'stalingrad'], faction: 'soviet', blurb: 'The largest country on Earth, with a long winter and a longer border. Deep reserves, and fronts in every direction.' },
  { id: 'ukraine', name: 'Ukraine', capital: 'kyiv', regions: ['kyiv', 'odessa'], faction: 'soviet', blurb: 'The black-earth breadbasket on the Black Sea, with grain enough to feed armies and steppe enough to lose them.' },
  { id: 'sweden', name: 'Sweden', capital: 'stockholm', regions: ['stockholm', 'lapland'], faction: 'allies', blurb: 'Iron mines in the north, shipyards in the south and the Baltic all around. Neutral by habit, not by necessity.' },
  { id: 'iceland', name: 'Iceland', capital: 'iceland', regions: ['iceland'], faction: 'allies', blurb: 'A volcanic rock alone in the North Atlantic, with the convoy lanes of two continents at its door. The hardest start of all.' },
  // Asia
  { id: 'turkey', name: 'Turkey', capital: 'anatolia', regions: ['anatolia', 'istanbul'], faction: 'allies', blurb: 'Keeper of the straits between the Black Sea and the Mediterranean, with a foot in Europe and one in Asia.' },
  { id: 'iran', name: 'Iran', capital: 'tehran', regions: ['tehran', 'fars'], faction: 'allies', blurb: 'Oil fields, mountain walls and the Gulf at your feet. Every road between Arabia and Turkestan runs through you.' },
  { id: 'arabia', name: 'Arabia', capital: 'arabia', regions: ['arabia'], faction: 'allies', blurb: 'Sand seas around a kingdom of oil and oases. Few neighbours can reach you, and you can reach three seas.' },
  { id: 'afghanistan', name: 'Afghanistan', capital: 'hindu-kush', regions: ['hindu-kush'], faction: 'soviet', blurb: 'Mountain passes that empires break their teeth on. The best defence in the world, and the slowest way out of it.' },
  { id: 'china', name: 'China', capital: 'peking', regions: ['peking', 'shanghai'], faction: 'soviet', blurb: 'Endless manpower from the Great Wall to the Yangtze. Hold East Asia and no rival can match your reinforcements.' },
  { id: 'japan', name: 'Japan', capital: 'tokyo', regions: ['tokyo', 'kansai'], faction: 'allies', blurb: 'Island factories and harbours off the coast of Asia. The sea keeps you safe until you are ready to cross it.' },
  { id: 'mongolia', name: 'Mongolia', capital: 'mongolia', regions: ['mongolia'], faction: 'soviet', blurb: 'The steppe of the old horse empires, between Siberia and China. Nothing between you and the horizon but grass.' },
  { id: 'india', name: 'India', capital: 'delhi', regions: ['delhi', 'bombay'], faction: 'allies', blurb: 'A subcontinent of millions behind the Himalaya, with the Indian Ocean as its front yard. Grow first, then strike.' },
  { id: 'pakistan', name: 'Pakistan', capital: 'karachi', regions: ['karachi'], faction: 'allies', blurb: 'The Indus and the port of Karachi, at the gate between the Middle East and India. Two worlds to choose from.' },
  { id: 'thailand', name: 'Thailand', capital: 'bangkok', regions: ['bangkok'], faction: 'allies', blurb: 'The rice bowl of Indochina, the one kingdom of the region no colonial empire ever took. Keep it that way, then take theirs.' },
  { id: 'vietnam', name: 'Vietnam', capital: 'hanoi', regions: ['hanoi'], faction: 'soviet', blurb: 'Jungle, paddies and mountains made for a defender. Whoever comes for you comes the hard way.' },
  { id: 'indonesia', name: 'Indonesia', capital: 'java', regions: ['java', 'sumatra'], faction: 'soviet', blurb: 'Thousands of islands on the oil route between two oceans. Rule the straits and the trade of half the world is yours.' },
  { id: 'philippines', name: 'Philippines', capital: 'luzon', regions: ['luzon'], faction: 'allies', blurb: 'Seven thousand islands on the edge of the Pacific, a short hop from Asia and a long one from everywhere else.' },
  // Africa
  { id: 'egypt', name: 'Egypt', capital: 'cairo', regions: ['cairo'], faction: 'soviet', blurb: 'The Nile, the pyramids and the road between Africa and Asia. Every army in history has wanted Cairo.' },
  { id: 'morocco', name: 'Morocco', capital: 'casablanca', regions: ['casablanca'], faction: 'allies', blurb: 'Atlantic ports and Atlas peaks across the strait from Spain. Europe is a short crossing away.' },
  { id: 'algeria', name: 'Algeria', capital: 'algiers', regions: ['algiers'], faction: 'soviet', blurb: 'A white city on the sea with the whole Sahara behind it. North Africa is yours to unite.' },
  { id: 'nigeria', name: 'Nigeria', capital: 'lagos', regions: ['lagos'], faction: 'allies', blurb: 'The giant of West Africa, rich in people, with the Niger delta at its feet. The Atlantic road to the Americas starts next door.' },
  { id: 'ethiopia', name: 'Ethiopia', capital: 'abyssinia', regions: ['abyssinia'], faction: 'allies', blurb: 'An ancient empire on a mountain plateau that no invader has kept. Look down on Africa and Arabia alike.' },
  { id: 'congo', name: 'Congo', capital: 'congo', regions: ['congo'], faction: 'soviet', blurb: 'The great river and the rainforest at the heart of Africa, with copper and uranium under the green.' },
  { id: 'south-africa', name: 'South Africa', capital: 'cape', regions: ['cape', 'transvaal'], faction: 'allies', blurb: 'Gold mines and the Cape of Good Hope, where two oceans meet. Far from every rival: build up in peace.' },
  // North America
  { id: 'usa', name: 'United States', capital: 'washington', regions: ['washington', 'new-york'], faction: 'allies', blurb: 'The arsenal of the free world between two oceans. Unmatched industry, and every enemy an ocean away.' },
  { id: 'canada', name: 'Canada', capital: 'ontario', regions: ['ontario', 'quebec'], faction: 'allies', blurb: 'Forest, lakes and tundra to the Arctic Ocean. A huge, quiet start with the Atlantic convoys at hand.' },
  { id: 'mexico', name: 'Mexico', capital: 'mexico', regions: ['mexico'], faction: 'allies', blurb: 'Volcanoes, oil and the bridge between the two Americas. North or south: the choice is yours.' },
  { id: 'cuba', name: 'Cuba', capital: 'havana', regions: ['havana'], faction: 'soviet', blurb: 'The key to the Caribbean, ninety miles from the mainland. Small, but every lane in the Gulf runs past you.' },
  // South America
  { id: 'brazil', name: 'Brazil', capital: 'rio', regions: ['rio', 'recife'], faction: 'allies', blurb: 'Half a continent of jungle, rivers and harbours, and the shortest crossing to Africa. Room to grow, and then some.' },
  { id: 'argentina', name: 'Argentina', capital: 'buenos-aires', regions: ['buenos-aires'], faction: 'soviet', blurb: 'The pampas and their endless herds, from the River Plate to the ice of Patagonia. The south of the world is yours.' },
  { id: 'chile', name: 'Chile', capital: 'santiago', regions: ['santiago'], faction: 'allies', blurb: 'A thin strip between the Andes and the Pacific, with copper in the mountains. The mountains guard your back.' },
  { id: 'peru', name: 'Peru', capital: 'cusco', regions: ['cusco'], faction: 'allies', blurb: 'The old Inca heartland high in the Andes. Thin air, steep valleys and a fortress at every pass.' },
  { id: 'venezuela', name: 'Venezuela', capital: 'caracas', regions: ['caracas'], faction: 'soviet', blurb: 'Oil on the Caribbean shore, at the top of South America. Panama and the islands are within reach.' },
  // Oceania
  { id: 'australia', name: 'Australia', capital: 'sydney', regions: ['sydney'], faction: 'allies', blurb: 'An island continent at the end of the world. Unite it quietly, then island-hop north into Asia.' },
  { id: 'new-zealand', name: 'New Zealand', capital: 'new-zealand', regions: ['new-zealand'], faction: 'allies', blurb: 'Two green islands at the far end of the Pacific. The last place anyone attacks, and the longest road to victory.' },
];

export const HOMELAND_BY_ID: Record<string, WorldHomeland> = Object.fromEntries(WORLD_HOMELANDS.map((h) => [h.id, h]));

/** Landmarks: where each stands, its wonder bonus while its territory is held, and a line about it. */
export const LANDMARK_INFO: Record<LandmarkId, { name: string; region: string; wonder: WonderEffect; blurb: string }> = {
  'eiffel-tower': { name: 'Eiffel Tower', region: 'paris', wonder: { kind: 'intel', turns: 1 }, blurb: 'Iron lattice over the Seine, and a radio mast since the century began: its operators hear every army on the continent.' },
  'big-ben': { name: 'Big Ben', region: 'london', wonder: { kind: 'diplomacy', pct: 25 }, blurb: 'The clock tower of Westminster. Treaties are signed to its chimes, and kept a little longer.' },
  'tower-bridge': { name: 'Tower Bridge', region: 'thames', wonder: { kind: 'navy', add: 1 }, blurb: 'The gateway to the Port of London: its bascules rise for a fleet bound anywhere in the world.' },
  'colosseum': { name: 'Colosseum', region: 'rome', wonder: { kind: 'troops', add: 1 }, blurb: 'The arena of the legions. Rome still raises soldiers in its shadow.' },
  'leaning-tower': { name: 'Leaning Tower of Pisa', region: 'tuscany', wonder: { kind: 'card', every: 4 }, blurb: 'Galileo\'s bell tower, leaning for eight centuries and not falling yet. Fortune favours the stubborn.' },
  'parthenon': { name: 'Parthenon', region: 'athens', wonder: { kind: 'defence', dice: 1 }, blurb: 'The temple on the Acropolis, the rock that Athens has defended since the age of bronze.' },
  'brandenburg-gate': { name: 'Brandenburg Gate', region: 'berlin', wonder: { kind: 'fortify', add: 1 }, blurb: 'The great gate of Berlin, where every road and railway of Central Europe meets.' },
  'st-basils': { name: "St Basil's Cathedral", region: 'moscow', wonder: { kind: 'troops', add: 2 }, blurb: 'Onion domes over Red Square, where the parades march before they march west.' },
  'winter-palace': { name: 'Winter Palace', region: 'leningrad', wonder: { kind: 'defence', dice: 1 }, blurb: 'The tsars\' palace on the Neva, in the city that held out through a nine-hundred-day siege.' },
  'neuschwanstein': { name: 'Neuschwanstein Castle', region: 'bavaria', wonder: { kind: 'income', pct: 15 }, blurb: 'A fairy-tale castle in the Bavarian Alps, built by a king who spent a fortune and left a treasury of visitors.' },
  'dutch-windmills': { name: 'Windmills of Holland', region: 'holland', wonder: { kind: 'income', pct: 20 }, blurb: 'The mills that pumped a country out of the sea and turned its polders into Europe\'s market garden.' },
  'matterhorn': { name: 'Matterhorn', region: 'alps', wonder: { kind: 'defence', dice: 1 }, blurb: 'The pyramid peak of the Alps, above an alpine redoubt with a fortress in every mountain.' },
  'galata-tower': { name: 'Galata Tower', region: 'istanbul', wonder: { kind: 'navy', add: 1 }, blurb: 'The old Genoese watchtower over the Golden Horn, keeping watch on the straits between two seas.' },
  'alhambra': { name: 'Alhambra', region: 'andalusia', wonder: { kind: 'card', every: 4 }, blurb: 'The red fortress-palace of Granada, its courtyards of fountains under the snows of the Sierra Nevada.' },
  'pyramids': { name: 'Pyramids of Giza', region: 'cairo', wonder: { kind: 'troops', add: 2 }, blurb: 'Four and a half thousand years on the edge of the desert, and they have watched every army pass.' },
  'petra': { name: 'Petra', region: 'petra', wonder: { kind: 'income', pct: 15 }, blurb: 'The rose-red city carved into the cliffs, once the toll gate of every caravan between Arabia and the sea.' },
  'persepolis': { name: 'Persepolis', region: 'fars', wonder: { kind: 'diplomacy', pct: 20 }, blurb: 'The ruined Gate of All Nations, where the envoys of the known world brought tribute to the Persian kings.' },
  'table-mountain': { name: 'Table Mountain', region: 'cape', wonder: { kind: 'navy', add: 1 }, blurb: 'The flat-topped mountain over the Cape, the landmark of every ship between the Atlantic and the Indian Ocean.' },
  'kilimanjaro': { name: 'Mount Kilimanjaro', region: 'kilimanjaro', wonder: { kind: 'intel', turns: 1 }, blurb: 'Snow on the equator: the roof of Africa looks out over the whole savanna.' },
  'victoria-falls': { name: 'Victoria Falls', region: 'zambezi', wonder: { kind: 'income', pct: 15 }, blurb: 'The smoke that thunders: the Zambezi falls a hundred metres into a gorge, with power enough for a nation.' },
  'great-wall': { name: 'Great Wall of China', region: 'shanxi', wonder: { kind: 'defence', dice: 1 }, blurb: 'Watchtowers on every ridge from the sea to the desert: the longest defence line ever built.' },
  'forbidden-city': { name: 'Forbidden City', region: 'peking', wonder: { kind: 'troops', add: 2 }, blurb: 'The emperors\' palace at the heart of Peking, with its golden roofs and nine thousand rooms.' },
  'mount-fuji': { name: 'Mount Fuji', region: 'tokyo', wonder: { kind: 'card', every: 3 }, blurb: 'The snow-capped volcano over the plain of Tokyo, seen from a hundred kilometres out at sea.' },
  'himeji-castle': { name: 'Himeji Castle', region: 'kansai', wonder: { kind: 'defence', dice: 1 }, blurb: 'The White Heron castle, a maze of gates and walls that no army has ever taken.' },
  'taj-mahal': { name: 'Taj Mahal', region: 'delhi', wonder: { kind: 'diplomacy', pct: 20 }, blurb: 'The white marble tomb on the Yamuna, built by an emperor for love: rivals speak softly here.' },
  'gateway-of-india': { name: 'Gateway of India', region: 'bombay', wonder: { kind: 'navy', add: 1 }, blurb: 'The basalt arch on the Bombay waterfront, where the fleets of the Indian Ocean come ashore.' },
  'angkor-wat': { name: 'Angkor Wat', region: 'angkor', wonder: { kind: 'troops', add: 1 }, blurb: 'The lotus towers of the Khmer kings, rising out of the jungle by the great lake.' },
  'registan': { name: 'Registan', region: 'samarkand', wonder: { kind: 'fortify', add: 1 }, blurb: 'Three tiled madrasas around the square of Samarkand, at the crossroads of the Silk Road.' },
  'statue-of-liberty': { name: 'Statue of Liberty', region: 'new-jersey', wonder: { kind: 'diplomacy', pct: 25 }, blurb: 'Liberty Enlightening the World, raising her torch over New York Harbor from the Jersey shore.' },
  'golden-gate': { name: 'Golden Gate Bridge', region: 'san-francisco', wonder: { kind: 'navy', add: 1 }, blurb: 'The orange span across the Golden Gate, the door between San Francisco Bay and the Pacific.' },
  'empire-state': { name: 'Empire State Building', region: 'new-york', wonder: { kind: 'income', pct: 25 }, blurb: 'The tallest building in the world, over the busiest city in the world. Money never sleeps here.' },
  'mount-rushmore': { name: 'Mount Rushmore', region: 'dakota', wonder: { kind: 'attack', dice: 1 }, blurb: 'Four presidents carved into the granite of the Black Hills, staring down every army on the plains.' },
  'chichen-itza': { name: 'Chichen Itza', region: 'yucatan', wonder: { kind: 'card', every: 3 }, blurb: 'The stepped pyramid of the Maya, a stone calendar whose shadow marks the turn of every season.' },
  'machu-picchu': { name: 'Machu Picchu', region: 'cusco', wonder: { kind: 'defence', dice: 1 }, blurb: 'The lost Inca citadel on a ridge above the clouds, reached only by mountain paths.' },
  'sugarloaf': { name: 'Sugarloaf Mountain', region: 'rio', wonder: { kind: 'troops', add: 1 }, blurb: 'The granite dome over Guanabara Bay, with its cable car above the busiest harbour in South America.' },
  'panama-locks': { name: 'Panama Canal Locks', region: 'panama', wonder: { kind: 'navy', add: 2 }, blurb: 'The locks that lift ships across a continent: whoever holds them holds the short way between two oceans.' },
  'harbour-bridge': { name: 'Sydney Harbour Bridge', region: 'sydney', wonder: { kind: 'fortify', add: 1 }, blurb: 'The coat hanger over Sydney Harbour, the steel arch that ties the city together.' },
};
