/**
 * World Conquest: the shared vocabulary of the world campaign (start from any homeland, conquer the world).
 * Pure types and tiny constants, no logic: the geography (geo data), the turn logic, the battlefield generator,
 * the landmark and city models and the screens all build on these. Change them only together (one owner per
 * module, see the round contract); adding a member at the end of a union is safe, renaming one is not (saved runs).
 */
import type { Terrain } from '../geo';

/** Battlefield climates. 'tropical' is new with World Conquest (jungle, monsoon); the rest are the existing three. */
export type WorldClimate = 'temperate' | 'winter' | 'desert' | 'tropical';

/** Architecture style of a region's towns and cities (civilian buildings on its battlefields). */
export type Culture =
  | 'western'        // Western Europe: brick and stone terraces, slate and tile roofs
  | 'nordic'         // Scandinavia, Baltic: timber, steep roofs, bright paint
  | 'slavic'         // Eastern Europe, Russia: plaster blocks, onion domes, wooden izbas
  | 'mediterranean'  // Southern Europe, Maghreb coast: white plaster, terracotta roofs, arcades
  | 'middle-eastern' // Arabia, Levant, Persia, North Africa inland: flat roofs, courtyards, domes, minaret-free skylines
  | 'african'        // sub-Saharan Africa: adobe, thatch, corrugated roofs, colonial-era offices
  | 'south-asian'    // India, Pakistan, Bangladesh, Sri Lanka: jharokha balconies, chhatris, flat roofs
  | 'east-asian'     // China, Korea, Japan, Mongolia: curved tiled roofs, pagodas, timber halls
  | 'southeast-asian' // Indochina, Malaya, Indonesia, Philippines: stilt houses, steep layered roofs
  | 'north-american' // USA, Canada: clapboard houses, 1950s brick downtown, grain silos, water towers
  | 'latin-american' // Mexico to Patagonia: colourful plaster, haciendas, plazas
  | 'oceanian';      // Australia, New Zealand, Pacific: verandah houses, tin roofs

/** Continents (grouping for setup, achievements and the map legend). */
export type Continent = 'europe' | 'asia' | 'africa' | 'north-america' | 'south-america' | 'oceania';

/** What a territory produces (strategic layer). */
export type WorldResource = 'oil' | 'ore' | 'industry' | 'grain' | 'manpower' | 'science' | 'port';

/**
 * Battlefield features a region asks for, so its maps look like the place: the generator honours as many as fit
 * (in this order of importance). Directions are on the battlefield (north = top of the map).
 */
export type MapFeature =
  | 'river'          // a big river crosses the field (the Nile, the Rhine, the Mississippi...)
  | 'coast'          // open sea along one edge
  | 'harbour'        // a bay with docks
  | 'island'         // the field is an island or islands
  | 'mountains'      // high ridges and passes
  | 'canyon'         // dry gorges
  | 'dunes'          // sand seas
  | 'jungle'         // dense tropical forest
  | 'lakes'          // many lakes
  | 'city'           // a dense city centre with streets
  | 'town'           // villages and a small town
  | 'farmland'       // fields and hedgerows
  | 'oasis'          // palms around water in a desert
  | 'glacier'        // ice fields
  | 'volcano';       // a volcanic peak (natural landmark terrain)

/** A named place a world run can draw a territory from. */
export interface WorldRegion {
  id: string;
  /** English display name (translated for display by the geo module's names table). */
  name: string;
  lon: number;
  lat: number;
  continent: Continent;
  /** Bonus zone (a WorldZone id): hold every territory of a zone for its reinforcement bonus, Risk style. */
  zone: string;
  terrain: Terrain;
  climate: WorldClimate;
  culture: Culture;
  /** Battlefield look, most important first. */
  features: MapFeature[];
  resources: WorldResource[];
  /** The landmark standing on this region's battlefields (an id of LANDMARK_IDS), if it has one. */
  landmark?: LandmarkId;
  /** A homeland a player or a rival power can start from (its id in WORLD_HOMELANDS). */
  homeland?: string;
  /** ISO 3166-1 alpha-2 code when the region is a whole country (Intl.DisplayNames can name it in every language). */
  iso?: string;
  /** Always included in a run (keeps continents connected and recognisable). */
  core?: boolean;
}

/**
 * A bonus zone (Risk's continents, finer: Scandinavia, Iberia, the Levant, Indochina...): whoever holds every
 * territory in it gets `bonus` extra troops at the start of each turn.
 */
export interface WorldZone {
  id: string;
  /** English display name. */
  name: string;
  continent: Continent;
  /** Extra troops per turn for holding the whole zone (about the zone's size and how many borders it has to defend). */
  bonus: number;
}

/** Risk-style reinforcement cards, earned by conquering at least one territory in a turn; sets trade for troops. */
export type CardKind = 'infantry' | 'armour' | 'air';

/** A starting nation: its capital region, the regions it owns at the start, and its flavour. */
export interface WorldHomeland {
  id: string;
  /** English display name, e.g. "Britain", "Brazil", "Japan". */
  name: string;
  capital: string;
  regions: string[];
  /** Default doctrine side for this homeland's army (the player may pick the other one). */
  faction: 'allies' | 'soviet';
  /** One line of flavour for the homeland picker (English, translated). */
  blurb: string;
}

/**
 * Landmarks: famous places standing on their region's battlefields, modelled in code (no downloaded assets).
 * Indestructible scenery: never targetable, never damaged; holding the territory gives its wonder bonus.
 * Rules: built before 1953 (the game's alternate 1950s), no holy sites of living religions as objectives
 * (no Mecca, Medina, Jerusalem's Old City, the Vatican), no trademarked signs.
 */
export const LANDMARK_IDS = [
  // Europe
  'eiffel-tower', 'big-ben', 'tower-bridge', 'colosseum', 'leaning-tower', 'parthenon', 'brandenburg-gate',
  'st-basils', 'winter-palace', 'neuschwanstein', 'dutch-windmills', 'matterhorn', 'galata-tower', 'alhambra',
  // Africa and the Middle East
  'pyramids', 'petra', 'persepolis', 'table-mountain', 'kilimanjaro', 'victoria-falls',
  // Asia
  'great-wall', 'forbidden-city', 'mount-fuji', 'himeji-castle', 'taj-mahal', 'gateway-of-india', 'angkor-wat',
  'registan',
  // The Americas
  'statue-of-liberty', 'golden-gate', 'empire-state', 'mount-rushmore', 'chichen-itza', 'machu-picchu',
  'sugarloaf', 'panama-locks',
  // Oceania
  'harbour-bridge',
] as const;
export type LandmarkId = typeof LANDMARK_IDS[number];

/** A landmark's wonder bonus on the world map while its territory is held. */
export type WonderEffect =
  | { kind: 'troops'; add: number }          // extra troops each turn
  | { kind: 'income'; pct: number }          // war chest income (what battles you fight yourself can buy)
  | { kind: 'card'; every: number }          // a free reinforcement card every N turns
  | { kind: 'defence'; dice: number }        // auto-resolve: the defender's best die +N in this zone
  | { kind: 'attack'; dice: number }         // auto-resolve: the attacker's best die +N from this zone
  | { kind: 'fortify'; add: number }         // extra fortify moves per turn
  | { kind: 'navy'; add: number }            // sea lanes usable without a port, N per turn
  | { kind: 'intel'; turns: number }         // see rivals' planned attacks this many turns ahead
  | { kind: 'diplomacy'; pct: number };      // rivals more willing to sign ceasefires

/** Footprint of a landmark on a battlefield, in cells (sim side; the model fits inside it). */
export interface LandmarkFootprint { w: number; h: number }
