/**
 * World Conquest region battlefields: a map generated to look like the territory being fought over, from its
 * climate, terrain, features (the Nile, a harbour, the Andes, dunes, a city centre...), architecture style and
 * landmark. Unlike the symmetric skirmish generator (mapgen.ts) these maps are asymmetric (an attacker and a
 * defender), but fair to the battle kind:
 *   - ground routes join the starts (fords and passes, never only destructible bridges; naval island maps: a sea
 *     route between the harbours instead);
 *   - every ore field is reachable from a start, and each side has its own fields near home;
 *   - every start stands on a flat, clear area (no start is boxed in);
 *   - the landmark never seals a route and never stands on a start; it stands between the starts where the
 *     fighting is, visible from the human's starting camera (the human starts at the bottom, the enemy up-screen).
 * The same region gives the same look (features, style and the region's look choices) and every battle seed a
 * different layout.
 *
 *   regionBattlefield(opts)  the JSON map spec a battle stores (BattleSpec.map, MissionMapSpec + `region`)
 *   regionMapFor(spec)       the GameMap of such a spec (null for any other spec)
 *   generateRegion(opts)     the map plus what was placed and the fairness report (tests, tools)
 *
 * Deterministic: everything comes from the options (Rng / Noise2D / hash2 seeded from them), no Math.random, no
 * unordered iteration. A battlefield takes a few tens of milliseconds.
 */
import { Noise2D, Rng, hash2 } from '../core/rng';
import { GameMap, ORE_MAX, T, WATER_LEVEL, type MapBridge } from './map';
import type { Culture, LandmarkId, MapFeature, WorldClimate } from '../conquest/world/types';
import { LANDMARK_IDS } from '../conquest/world/types';
import type { Terrain } from '../conquest/geo';
import type { MissionMapSpec } from './mission';
import { LANDMARK_HEIGHTS, LANDMARK_SETTING, placeLandmark, placedSize, type PlacedLandmark } from './landmarks';
import { civilianSize, civilianType, type CivilianKind, type CivilianSite } from './civilian';
import { BATTLE as BATTLE_EN } from '../i18n/en/conquest-battle'; // the English the battlefield names emit (translated where shown)
import { WORLD_MAPS } from '../i18n/en/world-maps';

// =====================================================================================================
// Options and the map spec
// =====================================================================================================
export type RegionKind = 'attack' | 'defend' | 'hold' | 'naval' | 'boss';
export const REGION_KINDS: readonly RegionKind[] = ['attack', 'defend', 'hold', 'naval', 'boss'];

/** What a world battle asks of its battlefield (STRAT passes exactly these; plain JSON). */
export interface RegionOptions {
  kind: RegionKind;
  terrain: Terrain;
  climate: WorldClimate;
  culture: Culture;
  features: MapFeature[];
  landmark?: LandmarkId;
  /** uint32: the layout. */
  seed: number;
  /** Garrison strength 1..6 (bigger battlefields from 4). */
  strength: number;
  /** 2, or 3 for a capital (boss) battle: the human plus two enemy bases. */
  players: number;
  /** Region id (optional): its own look choices (river course, coast side...), the same for every battle there. */
  region?: string;
}

/** The map spec a world battle stores: MissionMapSpec-compatible JSON plus the region options. */
export type RegionBattleMap = Omit<MissionMapSpec, 'climate'> & {
  climate: WorldClimate;
  water: number;
  trees: number;
  ore: number;
  region: RegionOptions;
  /** English battlefield name (translated where shown: trSource) and its id. */
  label: string;
  labelKey: string;
};

const ALL_FEATURES: readonly MapFeature[] = ['river', 'coast', 'harbour', 'island', 'mountains', 'canyon', 'dunes', 'jungle', 'lakes', 'city', 'town', 'farmland', 'oasis', 'glacier', 'volcano'];
const TERRAINS: readonly Terrain[] = ['plains', 'forest', 'mountain', 'lakes', 'river', 'coast', 'urban', 'steppe', 'islands'];
const CLIMATES: readonly WorldClimate[] = ['temperate', 'winter', 'desert', 'tropical'];
const CULTURES: readonly Culture[] = ['western', 'nordic', 'slavic', 'mediterranean', 'middle-eastern', 'african', 'south-asian', 'east-asian', 'southeast-asian', 'north-american', 'latin-american', 'oceanian'];
const HOURS = [7.5, 9, 10.5, 12, 13.5, 15, 16.5, 18, 19.5, 22];

/** Options made safe and canonical (untrusted spec from a save or a link: anything unknown falls back). */
export function normaliseRegion(o: Partial<RegionOptions>): RegionOptions {
  const kind = REGION_KINDS.includes(o.kind as RegionKind) ? o.kind as RegionKind : 'attack';
  const feats: MapFeature[] = [];
  for (const f of Array.isArray(o.features) ? o.features : []) if (ALL_FEATURES.includes(f) && !feats.includes(f) && feats.length < 8) feats.push(f);
  const out: RegionOptions = {
    kind,
    terrain: TERRAINS.includes(o.terrain as Terrain) ? o.terrain as Terrain : 'plains',
    climate: CLIMATES.includes(o.climate as WorldClimate) ? o.climate as WorldClimate : 'temperate',
    culture: CULTURES.includes(o.culture as Culture) ? o.culture as Culture : 'western',
    features: feats,
    seed: (Number(o.seed) >>> 0) || 1,
    strength: Math.max(1, Math.min(6, Math.round(Number(o.strength) || 1))),
    players: kind === 'boss' ? 3 : Math.max(2, Math.min(4, Math.round(Number(o.players) || 2))),
  };
  if (o.landmark && (LANDMARK_IDS as readonly string[]).includes(o.landmark)) out.landmark = o.landmark;
  if (typeof o.region === 'string' && o.region.length <= 64) out.region = o.region;
  return out;
}

/** Battlefield size (cells, square) of a battle. */
export function regionSize(o: Pick<RegionOptions, 'kind' | 'strength' | 'features'>): number {
  if (o.kind === 'boss') return 80;
  if (o.kind === 'naval') return 72;
  return o.strength >= 4 || (o.features.includes('city') && o.features.length >= 4) ? 72 : 64;
}

/** The features a battlefield draws, most important first (the region's own, then what its terrain implies). */
export function regionFeatures(o: Pick<RegionOptions, 'terrain' | 'climate' | 'features' | 'kind'>): MapFeature[] {
  const f = [...o.features];
  const add = (x: MapFeature) => { if (!f.includes(x)) f.push(x); };
  switch (o.terrain) {
    case 'river': add('river'); break;
    case 'coast': add('coast'); break;
    case 'islands': add('island'); break;
    case 'mountain': add('mountains'); break;
    case 'lakes': add('lakes'); break;
    case 'urban': add('city'); break;
    case 'plains': add('farmland'); break;
    case 'forest': if (o.climate === 'tropical') add('jungle'); break;
    default: break;
  }
  if (o.kind === 'naval') {
    // the sea between the harbours is the battlefield's water: no river or lakes besides it
    if (!f.includes('island') && !f.includes('coast')) add('coast');
    drop(f, 'river'); drop(f, 'lakes'); drop(f, 'canyon'); drop(f, 'glacier');
  }
  if (o.climate !== 'desert') { drop(f, 'dunes'); drop(f, 'oasis'); }
  if (o.climate !== 'winter') drop(f, 'glacier');
  if (o.climate !== 'tropical' && o.climate !== 'temperate') drop(f, 'jungle');
  if (f.includes('island')) drop(f, 'coast');
  if (f.includes('city')) drop(f, 'town');
  return f;
}
function drop<T>(a: T[], x: T) { const i = a.indexOf(x); if (i >= 0) a.splice(i, 1); }

/** Battlefield names (English, translated where shown): the old Conquest battlefields' where they fit, new ones else. */
const M = BATTLE_EN.map, X = WORLD_MAPS;
const LABELS: Record<string, string> = {
  capital: M.capital, coastalWaters: M.coastalWaters, riverCrossing: M.river, cityCentre: X.cityCentre, harbour: X.harbour,
  mountainPass: M.pass, canyon: X.canyon, dunes: X.dunes, jungle: X.jungle, lakes: M.lakes, islands: M.islands, coast: M.coastline,
  farmland: M.farmland, oasis: X.oasis, glacier: X.glacier, volcano: X.volcano, town: X.town, steppe: M.steppe, forest: M.forest,
  plains: X.plains,
};
export const REGION_LABELS: Readonly<Record<string, string>> = LABELS;

function labelOf(o: RegionOptions, feats: MapFeature[]): string {
  if (o.kind === 'boss') return 'capital';
  if (o.kind === 'naval') return feats.includes('island') ? 'islands' : feats.includes('harbour') ? 'harbour' : 'coastalWaters';
  const first = feats[0];
  const by: Partial<Record<MapFeature, string>> = {
    river: 'riverCrossing', city: 'cityCentre', harbour: 'harbour', mountains: 'mountainPass', canyon: 'canyon', dunes: 'dunes', jungle: 'jungle',
    lakes: 'lakes', island: 'islands', coast: 'coast', farmland: 'farmland', oasis: 'oasis', glacier: 'glacier', volcano: 'volcano', town: 'town',
  };
  return (first && by[first]) || (o.terrain === 'steppe' ? 'steppe' : o.terrain === 'forest' ? 'forest' : 'plains');
}

/**
 * The battlefield spec of a world battle (pure, cheap: nothing is generated here). Store it as the battle's map;
 * build the map from it with `regionMapFor`.
 */
export function regionBattlefield(opts: RegionOptions): RegionBattleMap {
  const o = normaliseRegion(opts);
  const feats = regionFeatures(o);
  const sea = o.kind === 'naval';
  const coastal = feats.includes('coast') || feats.includes('island') || feats.includes('harbour');
  const trees = o.climate === 'tropical' ? 0.8 : o.climate === 'desert' ? 0.12 : feats.includes('jungle') ? 0.85 : o.terrain === 'forest' ? 0.75 : o.terrain === 'steppe' ? 0.1 : 0.4;
  const labelKey = labelOf(o, feats);
  return {
    size: regionSize({ ...o, features: feats }), seed: o.seed, players: o.players, climate: o.climate,
    hour: HOURS[o.seed % HOURS.length], weather: 'auto', dayCycle: true,
    // (water >= 0.9 marks a sea battle for the battle script: naval yards are allowed)
    water: sea ? 0.95 : coastal ? 0.92 : feats.includes('river') || feats.includes('lakes') ? 0.5 : 0.2,
    trees, ore: 0.7,
    region: o, label: LABELS[labelKey] ?? LABELS.plains, labelKey,
  };
}

/** The GameMap of a map spec carrying `region` (game.ts / harnesses); null for any other spec. */
export function regionMapFor(spec: { region?: unknown } | null | undefined): GameMap | null {
  if (!spec || !spec.region || typeof spec.region !== 'object') return null;
  return generateRegion(spec.region as RegionOptions).map;
}

// =====================================================================================================
// Generation
// =====================================================================================================
export interface RegionReport {
  /** Generation time (ms): 0 here (the sim reads no clock); tools time the call and fill it in. */
  ms: number;
  size: number;
  features: MapFeature[];
  /** Features drawn (in order). */
  honoured: MapFeature[];
  /** Ground route between the human start and every enemy start without using a bridge. */
  paths: boolean;
  /** Sea route between the human's and the first enemy's harbour water (naval battles). */
  seaPath: boolean;
  /** Ore cells per start reachable on foot, and in the 14 cells around it. */
  ore: number[];
  oreNear: number[];
  /** Buildable cells within 9 cells of each start. */
  room: number[];
  /** wide / narrow: share of the landmark's silhouette on the 16:9 / 4:3 start screen; dist: the start camera's distance. */
  landmark: { id: LandmarkId; visible: boolean; distance: number; sealed: boolean; wide?: number; narrow?: number; dist?: number } | null;
  civilians: number;
  bridges: number;
  repairs: number;
  /** Civilian buildings left out because they closed off ground. */
  dropped: number;
  /** Naval battles: water bodies of 12+ cells near a start that are not joined to the main sea. */
  ponds: number;
}

export interface RegionResult {
  map: GameMap;
  options: RegionOptions;
  landmark: PlacedLandmark | null;
  sites: CivilianSite[];
  /** Starting camera focus of the human. */
  focus: { x: number; y: number };
  report: RegionReport;
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** FNV-1a of a string (look seed). */
function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** Look choices that belong to the region (the same for every battle there). */
interface Look {
  /** River runs east-west (across the attack) or north-south (between a west and an east side). */
  riverNS: boolean;
  /** Coast along the west, east or north edge. */
  coast: 'w' | 'e' | 'n';
  /** Dune / wind direction. */
  wind: number;
  /** Attacker starts on the west side (else east). */
  west: boolean;
}

function lookOf(o: RegionOptions): Look {
  const key = o.region ?? `${o.terrain}|${o.climate}|${o.culture}|${o.features.join(',')}|${o.landmark ?? ''}`;
  const h = hashStr(key);
  const r = new Rng(h);
  const riverNS = r.chance(0.5);
  const cs = r.next();
  return { riverNS, coast: cs < 0.4 ? 'w' : cs < 0.8 ? 'e' : 'n', wind: r.range(0, Math.PI), west: r.chance(0.5) };
}

interface Ctx {
  o: RegionOptions;
  N: number;
  map: GameMap;
  rng: Rng;
  noise: Noise2D;
  look: Look;
  feats: MapFeature[];
  honoured: MapFeature[];
  starts: { x: number; y: number }[];
  /** Base area radius per start. */
  baseR: number[];
  /** Cells nothing may be painted on any more (bases, landmark and its margin, corridors, plazas). */
  lock: Uint8Array;
  /** Base areas (radius 11 around every start). */
  base: Uint8Array;
  /** Corridor cells (kept open: no trees, no buildings). */
  lane: Uint8Array;
  /** Cells claimed by features (no ore, no buildings): ploughed fields, streets, quays. */
  claim: Uint8Array;
  /** River centre-line points and per-point direction (for crossings), if a river was drawn. */
  river: { pts: [number, number][]; hw: number; ns: boolean } | null;
  /** Extra height brushes per vertex. */
  lift: Float32Array;
  /** Fixed vertex heights (NaN = free): plazas, landmark and building pads. */
  pad: Float32Array;
  sites: CivilianSite[];
  /** Footprint occupancy of the civilian sites. */
  occ: Uint8Array;
  streets: [number, number][][];
  landmark: PlacedLandmark | null;
  /** The human's starting camera focus and distance (null: the default, just south of the start, at 20). */
  focus: { x: number; y: number; dist: number } | null;
  repairs: number;
  dunes: boolean;
  canyon: boolean;
}

/** Generate a region battlefield. */
export function generateRegion(opts: RegionOptions): RegionResult {
  const o = normaliseRegion(opts);
  const feats = regionFeatures(o);
  const N = regionSize({ ...o, features: feats });
  const map = new GameMap(N, N);
  map.seed = o.seed;
  map.climate = o.climate;
  const look = lookOf(o);
  const c: Ctx = {
    o, N, map, rng: new Rng((o.seed ^ 0x2545f491) >>> 0), noise: new Noise2D((o.seed ^ 0x9e3779b9) >>> 0), look, feats, honoured: [],
    starts: [], baseR: [], lock: new Uint8Array(N * N), base: new Uint8Array(N * N), lane: new Uint8Array(N * N), claim: new Uint8Array(N * N),
    river: null, lift: new Float32Array((N + 1) * (N + 1)), pad: new Float32Array((N + 1) * (N + 1)).fill(NaN),
    sites: [], occ: new Uint8Array(N * N), streets: [], landmark: null, focus: null, repairs: 0, dunes: false, canyon: false,
  };
  placeStarts(c);
  baseTerrain(c);
  // big water first, then rivers and lakes, then the rock features
  for (const f of feats) {
    if (f === 'island') islandFeature(c);
    else if (f === 'coast' && o.kind !== 'naval') coastFeature(c);
  }
  if (o.kind === 'naval') navalSea(c);
  if (feats.includes('harbour')) harbourFeature(c);
  if (feats.includes('river')) riverFeature(c);
  if (feats.includes('lakes')) lakesFeature(c);
  if (feats.includes('mountains')) mountainsFeature(c);
  if (feats.includes('canyon')) canyonFeature(c);
  if (feats.includes('glacier')) glacierFeature(c);
  if (feats.includes('volcano')) volcanoFeature(c);
  if (feats.includes('dunes')) dunesFeature(c);
  despeckle(c);
  clearBases(c);
  if (o.kind === 'hold') holdZone(c);
  landmarkFeature(c);
  corridors(c);
  if (feats.includes('oasis')) oasisFeature(c);
  shores(c);
  ore(c);
  if (feats.includes('city')) cityFeature(c);
  if (feats.includes('farmland')) farmlandFeature(c);
  if (feats.includes('town') || (!feats.includes('city') && (o.terrain === 'plains' || o.terrain === 'river' || o.terrain === 'coast'))) townFeature(c, feats.includes('town') ? 3 : 2);
  if (feats.includes('harbour')) quayside(c);
  trees(c);
  heights(c);
  bridges(c);
  const report = validate(c);
  map.civilianSites = c.sites;
  map.streets = c.streets;
  map.startFocus = c.focus;
  map.startPositions = c.starts.map((s) => ({ x: s.x, y: s.y }));
  for (let i = 0; i < N * N; i++) if (map.oreField[i]) map.oreFieldCells.push(i);
  // honoured features in the asked order
  report.honoured = feats.filter((f) => c.honoured.includes(f));
  const s0 = c.starts[0];
  return { map, options: o, landmark: c.landmark, sites: c.sites, focus: c.focus ?? { x: s0.x, y: s0.y + 1 }, report };
}

// ---- starts -----------------------------------------------------------------------------------------
/** Base area radius kept flat and open around every start (the battle script lays bases out within ~11 cells). */
const BASE_R = 11;
/** The human's construction yard and landing ground: nothing stands closer to the human start (landmark). */
const HUMAN_R = 7.5;
/** The human's base area when a water landmark stands in front of it (bridge, falls, harbour works). */
const HUMAN_WET_R = 8;

function placeStarts(c: Ctx) {
  const { N, rng, o, look } = c;
  const island = c.feats.includes('island');
  const m = Math.max(9, Math.round(N * 0.14)) + (island ? Math.round(N * 0.06) : 0) + (c.feats.includes('coast') && look.coast === 'n' ? 3 : 0);
  // the human starts at the bottom, the enemy up-screen (the start camera looks north at the front)
  const west = look.west !== (rng.next() < 0.3); // mostly the region's side, sometimes the other
  const side = west ? -1 : 1;
  const span = N * 0.28;
  const ns = c.feats.includes('river') && look.riverNS;
  const ax = N / 2 + side * span * rng.range(0.55, 1);
  // (a capital battle's two enemy bases take the two top corners)
  const dk = ns || o.players >= 3 ? rng.range(0.7, 1) : rng.range(-0.2, 1);
  const dx = N / 2 - side * span * dk;
  const A = { x: Math.round(ax) + 0.5, y: N - m - 0.5 };
  const D = { x: Math.round(dx) + 0.5, y: m + 0.5 };
  c.starts = [A, D];
  if (o.players >= 3) {
    // a capital battle's second base: up-screen on the attacker's side, apart from the first
    c.starts.push({ x: D.x < N / 2 ? N - m - 0.5 : m + 0.5, y: m + Math.round(N * 0.08) + 0.5 });
  }
  if (o.players >= 4) c.starts.push({ x: A.x < N / 2 ? N - m - 0.5 : m + 0.5, y: N - m - 0.5 });
  // (a landmark on the water near the human start: the human's yard keeps a smaller ring so the water can reach
  // the start camera's view)
  const lmSet = o.landmark ? LANDMARK_SETTING[o.landmark] : null;
  c.baseR = c.starts.map((_, k) => (k === 0 && (lmSet === 'span' || lmSet === 'river' || lmSet === 'shore') ? HUMAN_WET_R : BASE_R));
  c.starts.forEach((s, k) => {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (Math.hypot(x + 0.5 - s.x, y + 0.5 - s.y) < c.baseR[k]) { c.base[y * N + x] = 1; c.lock[y * N + x] = 1; }
    }
  });
}

/** Point at fraction t from the human start to the first enemy start, `s` cells to the side (to the right). */
function frameAt(c: Ctx, t: number, s: number): [number, number] {
  const A = c.starts[0], D = c.starts[1];
  const dx = D.x - A.x, dy = D.y - A.y, L = Math.hypot(dx, dy) || 1;
  return [A.x + dx * t - (dy / L) * s, A.y + dy * t + (dx / L) * s];
}
/** (t, s) of a point in the attack frame. */
function frameOf(c: Ctx, x: number, y: number): [number, number] {
  const A = c.starts[0], D = c.starts[1];
  const dx = D.x - A.x, dy = D.y - A.y, L = Math.hypot(dx, dy) || 1;
  const rx = x - A.x, ry = y - A.y;
  return [(rx * dx + ry * dy) / (L * L), (-rx * dy + ry * dx) / L];
}
function distStarts(c: Ctx, x: number, y: number): number {
  let d = Infinity;
  for (const s of c.starts) d = Math.min(d, Math.hypot(x - s.x, y - s.y));
  return d;
}
/** Distance from the nearest base area's edge (negative inside one). */
function baseGap(c: Ctx, x: number, y: number): number {
  let d = Infinity;
  c.starts.forEach((s, k) => { d = Math.min(d, Math.hypot(x - s.x, y - s.y) - c.baseR[k]); });
  return d;
}

// ---- base terrain -----------------------------------------------------------------------------------
function baseTerrain(c: Ctx) {
  const { N, map, noise, o } = c;
  const desert = o.climate === 'desert', winter = o.climate === 'winter', tropical = o.climate === 'tropical';
  const steppe = o.terrain === 'steppe';
  const sandT = desert ? (c.feats.includes('dunes') ? 0.75 : 0.5) : 0;
  const dirtT = steppe ? 0.6 : desert ? 0.64 : tropical ? 0.68 : 0.66;
  const rockT = (o.terrain === 'mountain' ? 0.66 : winter ? 0.71 : desert ? 0.72 : 0.74);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    const df = noise.fbm(x * 0.07 + 300, y * 0.07 + 300, 3);
    const rf = noise.fbm(x * 0.09 + 50, y * 0.09 + 50, 3);
    const sf = noise.fbm(x * 0.045 + 700, y * 0.045 + 700, 3);
    let t: number = T.Clear;
    if (sandT && sf < sandT) t = T.Sand;
    if (df > dirtT) t = T.Dirt;
    if (rf > rockT && !c.base[i]) t = T.Rock;
    map.terrain[i] = t;
  }
}

/** Remove single-cell water / rock specks (as mapgen does). */
function despeckle(c: Ctx) {
  const { N, map } = c;
  for (let pass = 0; pass < 2; pass++) {
    const copy = map.terrain.slice();
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const t = copy[i];
      if (t !== T.Water && t !== T.Rock) continue;
      let same = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) { same++; continue; }
        if (copy[ny * N + nx] === t) same++;
      }
      if (same < 3) map.terrain[i] = T.Clear;
    }
  }
}

/** Open, flat ground around every start (water and rock give way to land, trees and features stay out). */
function clearBases(c: Ctx) {
  const { N, map, o } = c;
  const g = o.climate === 'desert' ? T.Sand : T.Clear;
  for (let i = 0; i < N * N; i++) {
    if (!c.base[i]) continue;
    const t = map.terrain[i];
    if (t === T.Water || t === T.Rock) map.terrain[i] = g;
    // (naval battles: the shore of the harbour bay may reach into the outer ring)
  }
  if (o.kind === 'naval') navalBays(c);
}

/** Radius of the open ground kept at a Seize & Hold battle's objective. */
const HOLD_R = 6.5;

/**
 * Seize & Hold: the objective zone (where the battle script puts it, 52% of the way from the human start to the
 * enemy's) is open, level ground: no rock, water, trees, ore or buildings, and the landmark stands elsewhere.
 */
function holdZone(c: Ctx) {
  const { N, map, o } = c;
  const A = c.starts[0], D = c.starts[1];
  const zx = A.x + (D.x - A.x) * 0.52, zy = A.y + (D.y - A.y) * 0.52;
  const g = o.climate === 'desert' ? T.Sand : T.Clear;
  for (let y = Math.floor(zy - HOLD_R - 1); y <= zy + HOLD_R + 1; y++) for (let x = Math.floor(zx - HOLD_R - 1); x <= zx + HOLD_R + 1; x++) {
    if (!map.inBounds(x, y)) continue;
    const d = Math.hypot(x + 0.5 - zx, y + 0.5 - zy);
    if (d > HOLD_R + 0.5) continue;
    const i = y * N + x;
    if (map.terrain[i] === T.Rock || map.terrain[i] === T.Water) map.terrain[i] = d < HOLD_R - 1.5 ? g : T.Dirt;
    c.lock[i] = 1;
    c.claim[i] = 1;
  }
  for (let y = Math.floor(zy - HOLD_R); y <= zy + HOLD_R + 1; y++) for (let x = Math.floor(zx - HOLD_R); x <= zx + HOLD_R + 1; x++) {
    if (x >= 0 && y >= 0 && x <= N && y <= N && Math.hypot(x - zx, y - zy) < HOLD_R) c.lift[y * (N + 1) + x] = Math.min(c.lift[y * (N + 1) + x], 0);
  }
}

// ---- water features ---------------------------------------------------------------------------------
function islandFeature(c: Ctx) {
  const { N, map, noise } = c;
  const depth = Math.round(N * 0.1);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    if (c.base[i]) continue;
    const e = Math.min(x, y, N - 1 - x, N - 1 - y);
    const wob = (noise.fbm(x * 0.08 + 900, y * 0.08 + 900, 3) - 0.5) * 8;
    if (e < depth + wob) map.terrain[i] = T.Water;
  }
  c.honoured.push('island');
}

function coastFeature(c: Ctx) {
  const { N, map, noise, look } = c;
  const depth = Math.round(N * 0.15);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    if (c.base[i]) continue;
    const e = look.coast === 'w' ? x : look.coast === 'e' ? N - 1 - x : y;
    const along = look.coast === 'n' ? x : y;
    const wob = (noise.fbm(along * 0.07 + 1200, e * 0.02 + 40, 3) - 0.5) * 10 + Math.sin(along * 0.11 + look.wind * 3) * 2;
    if (e < depth + wob) map.terrain[i] = T.Water;
  }
  c.honoured.push('coast');
}

/** Naval battles: a sea between the bases with a bay reaching toward each (the battle script's harbours). */
function navalSea(c: Ctx) {
  const { N, map, noise } = c;
  const A = c.starts[0], D = c.starts[1];
  const C = { x: N / 2, y: N / 2 };
  // an elongated sea across the middle, leaving land at one or both ends for the ground route round it
  const leaveW = c.rng.chance(0.5);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    const wob = (noise.fbm(x * 0.1 + 500, y * 0.1 + 500, 2) - 0.5) * 6;
    const ry = Math.abs(y + 0.5 - C.y) / (N * 0.17);
    let inSea = ry + wob * 0.05 < 1;
    // a land bridge at one side (the ground route round the sea)
    const edge = leaveW ? x : N - 1 - x;
    if (edge < N * 0.16 + wob) inSea = false;
    if (inSea && !c.base[i]) map.terrain[i] = T.Water;
  }
  void A; void D;
  c.honoured.push('coast');
}

/** Bays from the sea toward the human's and the enemy's harbour (12 cells from each start toward the centre). */
function navalBays(c: Ctx) {
  const { N, map } = c;
  const C = { x: N / 2, y: N / 2 };
  for (const s of c.starts.slice(0, 2)) {
    const dx = C.x - s.x, dy = C.y - s.y, l = Math.hypot(dx, dy) || 1;
    const bx = s.x + (dx / l) * 12.5, by = s.y + (dy / l) * 12.5;
    // the arm from the bay to the open sea (toward the centre line)
    const ex = bx, ey = C.y;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const px = x + 0.5, py = y + 0.5;
      const t = clamp(((px - bx) * (ex - bx) + (py - by) * (ey - by)) / Math.max(1, (ex - bx) ** 2 + (ey - by) ** 2), 0, 1);
      const d = Math.hypot(px - bx - (ex - bx) * t, py - by - (ey - by) * t);
      const ds = Math.hypot(px - s.x, py - s.y);
      if ((Math.hypot(px - bx, py - by) < 4.6 || d < 3.4) && ds > 7.5) map.terrain[y * N + x] = T.Water;
    }
  }
}

function harbourFeature(c: Ctx) {
  const { N, map, look, rng } = c;
  // a naval battle's harbours are the bays off the sea (navalBays), with the quays along them
  if (c.o.kind === 'naval') { c.honoured.push('harbour'); return; }
  // a bay cut into the land from the coast (or from the island's shore), about midway between the bases
  const coastW = look.coast === 'w', coastN = look.coast === 'n';
  const anyWater = map.terrain.some((t) => t === T.Water);
  if (!anyWater) coastFeature(c);
  const midY = Math.round(N * rng.range(0.4, 0.55));
  const midX = Math.round(N * rng.range(0.4, 0.6));
  const bw = Math.round(N * 0.11), bl = Math.round(N * 0.24);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    if (c.base[i]) continue;
    let inBay: boolean;
    if (coastN) inBay = Math.abs(x + 0.5 - midX) < bw / 2 + Math.sin(y * 0.5) * 0.6 && y < N * 0.12 + bl;
    else {
      const e = coastW ? x : N - 1 - x;
      inBay = Math.abs(y + 0.5 - midY) < bw / 2 + Math.sin(x * 0.5) * 0.6 && e < N * 0.12 + bl;
    }
    if (inBay && baseGap(c, x + 0.5, y + 0.5) > 2) map.terrain[i] = T.Water;
  }
  c.honoured.push('harbour');
}

/** Warehouses and shops along the harbour's quays. */
function quayside(c: Ctx) {
  const { N, map } = c;
  const kinds: CivilianKind[] = ['warehouse', 'warehouse', 'shop', 'apartment'];
  let n = 0;
  for (let y = 2; y < N - 3 && n < 8; y += 3) for (let x = 2; x < N - 3 && n < 8; x += 4) {
    // a dry cell next to water, away from bases
    const i = y * N + x;
    if (map.terrain[i] === T.Water || c.lock[i] || c.claim[i]) continue;
    let wet = 0;
    for (const [dx, dy] of [[0, -2], [0, 3], [-2, 0], [4, 0]]) if (map.inBounds(x + dx, y + dy) && map.terrain[map.idx(x + dx, y + dy)] === T.Water) wet++;
    if (!wet) continue;
    const kind = kinds[(x * 7 + y * 3) % kinds.length];
    if (trySite(c, kind, x, y, (x + y) % 2 ? 0 : 2)) n++;
  }
}

function riverFeature(c: Ctx) {
  const { N, map, noise, rng, look, o } = c;
  const A = c.starts[0], D = c.starts[1];
  const ns = look.riverNS && Math.abs(A.x - D.x) > N * 0.3;
  const big = o.climate === 'desert' || o.terrain === 'river';
  const hw = big ? rng.range(2.4, 3.1) : rng.range(1.7, 2.4);
  const span0 = c.o.landmark && (LANDMARK_SETTING[c.o.landmark] === 'span' || LANDMARK_SETTING[c.o.landmark] === 'river');
  const amp = span0 ? 0.8 : rng.range(1.5, 3.5), freq = rng.range(0.08, 0.14), ph = rng.range(0, 6.28);
  // a span landmark stands on the river: the river then runs where the human's camera sees it
  const span = c.o.landmark && (LANDMARK_SETTING[c.o.landmark] === 'span' || LANDMARK_SETTING[c.o.landmark] === 'river');
  let pos: number;
  if (ns) {
    const lo = Math.min(A.x, D.x) + BASE_R + hw + amp + 1, hi = Math.max(A.x, D.x) - BASE_R - hw - amp - 1;
    pos = lo < hi ? rng.range(lo, hi) : (A.x + D.x) / 2;
    if (span) pos = A.x < D.x ? A.x + 11.5 : A.x - 11.5;
  } else {
    const lo = D.y + BASE_R + hw + amp + 1, hi = A.y - BASE_R - hw - amp - 1;
    pos = lo < hi ? rng.range(lo + (hi - lo) * 0.3, hi - (hi - lo) * 0.15) : (A.y + D.y) / 2;
    if (span) pos = A.y - 11.5;
  }
  const pts: [number, number][] = [];
  for (let k = -2; k <= N + 2; k++) {
    const m = pos + Math.sin(k * freq + ph) * amp + (noise.fbm(k * 0.05 + 77, 3.3, 2) - 0.5) * 3;
    pts.push(ns ? [m, k] : [k, m]);
  }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const k = ns ? y + 2 : x + 2;
    const m = ns ? pts[k][0] : pts[k][1];
    const w = hw + (noise.fbm(x * 0.13 + 33, y * 0.13 + 33, 2) - 0.5) * 1.2;
    const d = Math.abs((ns ? x + 0.5 : y + 0.5) - m);
    if (d < w && !c.base[y * N + x]) map.terrain[y * N + x] = T.Water;
  }
  c.river = { pts, hw, ns };
  c.honoured.push('river');
}

function lakesFeature(c: Ctx) {
  const { N, map, noise } = c;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    if (c.base[i] || baseGap(c, x + 0.5, y + 0.5) < 3) continue;
    const wf = noise.fbm(x * 0.06 + 100, y * 0.06 + 7, 4);
    if (wf < 0.33) map.terrain[i] = T.Water;
  }
  c.honoured.push('lakes');
}

// ---- rock features -------------------------------------------------------------------------------------
function mountainsFeature(c: Ctx) {
  const { N, map, noise, rng } = c;
  // one or two ridges across the attack (passes are left for the corridors), high peaks on the flanks
  const ridges = c.o.terrain === 'mountain' || rng.chance(0.5) ? 2 : 1;
  const ts = ridges === 2 ? [rng.range(0.33, 0.42), rng.range(0.58, 0.68)] : [rng.range(0.45, 0.58)];
  const A = c.starts[0], D = c.starts[1];
  const L = Math.hypot(D.x - A.x, D.y - A.y);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    if (c.base[i]) continue;
    const [t, s] = frameOf(c, x + 0.5, y + 0.5);
    for (const t0 of ts) {
      const w = 2.2 + noise.fbm(s * 0.08 + t0 * 50, 9.1, 3) * 3.2;
      const d = Math.abs((t - t0) * L + (noise.fbm(s * 0.05 + 300, t0 * 9, 2) - 0.5) * 9);
      // passes: low noise along the ridge
      const pass = noise.fbm(s * 0.09 + 41 + t0 * 13, 2.7, 2) < 0.33;
      if (d < w && !pass && map.terrain[i] !== T.Water) { map.terrain[i] = T.Rock; c.lift[y * (N + 1) + x] += 1.4 * (1 - d / w); }
    }
    // scattered peaks
    const pf = noise.fbm(x * 0.11 + 600, y * 0.11 + 600, 3);
    if (pf > 0.66 && baseGap(c, x + 0.5, y + 0.5) > 4 && map.terrain[i] !== T.Water) { map.terrain[i] = T.Rock; c.lift[y * (N + 1) + x] += (pf - 0.66) * 6; }
  }
  c.honoured.push('mountains');
}

function canyonFeature(c: Ctx) {
  const { N, map, noise } = c;
  // a plateau cut by dry gorges: rock where the noise is high, the gorges between (dirt floors, dug in)
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    if (c.base[i] || baseGap(c, x + 0.5, y + 0.5) < 2) continue;
    const v = noise.fbm(x * 0.07 + 1500, y * 0.07 + 1500, 3);
    const gorge = Math.abs(noise.fbm(x * 0.05 + 1700, y * 0.05 + 1700, 2) - 0.5);
    if (v > 0.5 && gorge > 0.06 && map.terrain[i] !== T.Water) { map.terrain[i] = T.Rock; c.lift[y * (N + 1) + x] += 0.8; }
    else if (gorge < 0.06 && map.terrain[i] !== T.Water) { map.terrain[i] = T.Dirt; c.lift[y * (N + 1) + x] -= 0.35; }
  }
  c.canyon = true;
  c.honoured.push('canyon');
}

function glacierFeature(c: Ctx) {
  const { N, map, noise, look } = c;
  // ice tongues from the edge away from the coast, cut by crevasses (impassable ice: rock cells, smooth and high)
  const fromW = look.coast !== 'w';
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    if (c.base[i] || baseGap(c, x + 0.5, y + 0.5) < 3) continue;
    const e = fromW ? x : N - 1 - x;
    const reach = N * 0.24 + (noise.fbm(y * 0.06 + 2100, 1.5, 3) - 0.5) * 14;
    if (e < reach && noise.fbm(x * 0.12 + 2200, y * 0.12 + 2200, 2) > 0.38 && map.terrain[i] !== T.Water) {
      map.terrain[i] = T.Rock;
      c.lift[y * (N + 1) + x] += 0.6 * smooth(reach, 0, e);
    }
  }
  c.honoured.push('glacier');
}

function volcanoFeature(c: Ctx) {
  const { N, map, rng } = c;
  // a cone on a flank: rock slopes, a crater, ash fields round it
  const side = rng.chance(0.5) ? 1 : -1;
  let best: [number, number] | null = null;
  for (let k = 0; k < 12 && !best; k++) {
    const [x, y] = frameAt(c, rng.range(0.4, 0.7), side * rng.range(N * 0.2, N * 0.32) * (k > 6 ? -1 : 1));
    if (x < 8 || y < 8 || x > N - 8 || y > N - 8) continue;
    if (baseGap(c, x, y) < 10) continue;
    best = [x, y];
  }
  if (!best) return;
  const [vx, vy] = best;
  const R = 8;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    if (c.base[i]) continue;
    const r = Math.hypot(x + 0.5 - vx, y + 0.5 - vy);
    if (r < R * 0.7 && (map.terrain[i] !== T.Water || r < R * 0.4)) map.terrain[i] = T.Rock;
    else if (r < R * 1.5 && map.terrain[i] !== T.Water) map.terrain[i] = T.Dirt;
  }
  for (let y = 0; y <= N; y++) for (let x = 0; x <= N; x++) {
    const r = Math.hypot(x - vx, y - vy);
    if (r < R * 1.3) c.lift[y * (N + 1) + x] += 4.2 * Math.pow(1 - r / (R * 1.3), 1.4) - (r < 2.2 ? 1.6 * (1 - r / 2.2) : 0);
  }
  c.honoured.push('volcano');
}

function dunesFeature(c: Ctx) {
  const { N, map, noise } = c;
  for (let i = 0; i < N * N; i++) if (map.terrain[i] === T.Clear || map.terrain[i] === T.Dirt) {
    const x = i % N, y = (i / N) | 0;
    if (noise.fbm(x * 0.05 + 2600, y * 0.05 + 2600, 2) > 0.3) map.terrain[i] = T.Sand;
  }
  c.dunes = true;
  c.honoured.push('dunes');
}

function oasisFeature(c: Ctx) {
  const { N, map, rng } = c;
  let made = 0;
  for (let k = 0; k < 20 && made < 2; k++) {
    const [x, y] = frameAt(c, rng.range(0.3, 0.7), (k % 2 ? 1 : -1) * rng.range(6, N * 0.3));
    const cx = Math.round(x), cy = Math.round(y);
    if (cx < 6 || cy < 6 || cx > N - 7 || cy > N - 7 || baseGap(c, cx, cy) < 6) continue;
    let ok = true;
    for (let dy = -5; dy <= 5 && ok; dy++) for (let dx = -5; dx <= 5; dx++) if (c.lock[(cy + dy) * N + cx + dx] || c.lane[(cy + dy) * N + cx + dx]) { ok = false; break; }
    if (!ok) continue;
    const r = rng.range(1.8, 2.6);
    for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
      const d = Math.hypot(dx, dy);
      const i = (cy + dy) * N + cx + dx;
      if (d < r) map.terrain[i] = T.Water;
      else if (d < r + 3.2) {
        if (map.terrain[i] === T.Rock) map.terrain[i] = T.Clear;
        if (map.terrain[i] !== T.Water) map.terrain[i] = d < r + 1.2 ? T.Sand : T.Clear;
        c.claim[i] = 2; // palms
      }
    }
    // a few houses by the water
    for (let h = 0; h < 4; h++) {
      const a = rng.range(0, Math.PI * 2);
      trySite(c, h === 0 ? 'hall' : 'house', Math.round(cx + Math.cos(a) * (r + 4.5)), Math.round(cy + Math.sin(a) * (r + 4.5)), 0);
    }
    made++;
  }
  if (made) c.honoured.push('oasis');
}

// ---- the landmark ---------------------------------------------------------------------------------------
/** The start camera (render/camera.ts): yaw 0, settling at distance 20 after the drop-in (game.ts). */
const CAM = { dist: 20, fov: 32, pitchNear: 0.66, pitchFar: 0.96, minDist: 9, maxDist: 64 };
/** Screen bounds between the HUD bars (normalised device coordinates): the bottom bar takes the lowest ~22%. */
const SCREEN = { x: 0.92, bottom: -0.55, top: 0.92 };
/** Start-camera distances a region battlefield may ask for to frame a tall landmark (camera.ts' own default is 26). */
const START_DISTS = [20, 23, 26];
const ASPECT_WIDE = 16 / 9, ASPECT_43 = 4 / 3;

/** Where a point (map x, y, height above the ground) lands in the start camera focused on (fx, fy): NDC, or null behind. */
export function startNdc(fx: number, fy: number, x: number, y: number, h: number, aspect = ASPECT_43, dist = CAM.dist): [number, number] | null {
  const pitch = CAM.pitchNear + (CAM.pitchFar - CAM.pitchNear) * Math.min(1, Math.max(0, (dist - CAM.minDist) / (CAM.maxDist - CAM.minDist)));
  const cy = Math.sin(pitch) * dist, cz = fy + Math.cos(pitch) * dist;
  // forward (looking north and down), up, right = +x
  const fwd1 = -Math.sin(pitch), fwd2 = -Math.cos(pitch);
  const up1 = Math.cos(pitch), up2 = -Math.sin(pitch);
  const d0 = x - fx, d1 = h - cy, d2 = y - cz;
  const z = d1 * fwd1 + d2 * fwd2;
  if (z <= 0.5) return null;
  const tan = Math.tan((CAM.fov / 2) * Math.PI / 180);
  return [d0 / (z * tan * aspect), (d1 * up1 + d2 * up2) / (z * tan)];
}

/**
 * Whether a point shows on the starting screen (inside the frame between the HUD bars). `inset` < 1 asks for it
 * further inside; `dist` is the camera distance.
 */
export function onStartScreen(fx: number, fy: number, x: number, y: number, h: number, aspect = ASPECT_43, inset = 1, dist = CAM.dist): boolean {
  const p = startNdc(fx, fy, x, y, h, aspect, dist);
  return !!p && Math.abs(p[0]) <= SCREEN.x * inset && p[1] >= SCREEN.bottom * inset && p[1] <= SCREEN.top * inset;
}

/**
 * How much of a landmark's silhouette shows on the start screen (0..1): its centre line and its two front corners,
 * each at 11 heights from the ground to the top of the model.
 */
export function landmarkShows(fx: number, fy: number, cx: number, cy: number, w: number, h: number, height: number, aspect = ASPECT_WIDE, dist = CAM.dist): number {
  let seen = 0, n = 0;
  for (const [px, py] of [[cx + w / 2, cy + h / 2], [cx + 0.5, cy + h - 0.5], [cx + w - 0.5, cy + h - 0.5]]) {
    for (let j = 0; j <= 10; j++) { n++; if (onStartScreen(fx, fy, px, py, (height * j) / 10, aspect, 1, dist)) seen++; }
  }
  return seen / n;
}
/** Share of its silhouette a landmark must show on the 16:9 start screen. */
const SHOW_MIN = 0.6;

/** A start camera framing: focus and distance, with the landmark's share on the wide and the 4:3 screen. */
interface Framing { x: number; y: number; dist: number; wide: number; narrow: number }

/** Whether the human's start (its MCV / landing force) sits in the lower half of the screen, well inside it. */
function startInFrame(f: { x: number; y: number; dist: number }, A: { x: number; y: number }): boolean {
  for (const asp of [ASPECT_WIDE, ASPECT_43]) {
    const p = startNdc(f.x, f.y, A.x, A.y, 0.5, asp, f.dist);
    if (!p || Math.abs(p[0]) > 0.8 || p[1] < SCREEN.bottom + 0.08 || p[1] > -0.02) return false;
  }
  return true;
}

/**
 * The start camera that shows the most of a landmark while the human's start stays in the lower half of the
 * screen: the default focus (just south of the start) moved up to 10 cells toward the landmark, at the closest of
 * START_DISTS that shows SHOW_MIN of it (a tall tower needs the wider view).
 */
function bestFraming(A: { x: number; y: number }, cx: number, cy: number, w: number, h: number, height: number): Framing {
  const mx = cx + w / 2, my = cy + h / 2;
  const dx = mx - A.x, dy = my - (A.y + 1), l = Math.hypot(dx, dy) || 1;
  let best: Framing = { x: A.x, y: A.y + 1, dist: CAM.dist, wide: -1, narrow: -1 };
  for (const dist of START_DISTS) {
    let here: Framing | null = null;
    for (let k = 0; k <= 10; k++) {
      const f = { x: A.x + (dx / l) * k, y: A.y + 1 + (dy / l) * k, dist };
      if (!startInFrame(f, A)) continue;
      const wide = landmarkShows(f.x, f.y, cx, cy, w, h, height, ASPECT_WIDE, dist);
      if (here && wide < here.wide - 0.001) continue;
      const narrow = landmarkShows(f.x, f.y, cx, cy, w, h, height, ASPECT_43, dist);
      if (!here || wide * 0.7 + narrow * 0.3 > here.wide * 0.7 + here.narrow * 0.3) here = { ...f, wide, narrow };
    }
    if (!here) continue;
    if (here.wide >= SHOW_MIN) return here;
    if (here.wide > best.wide) best = here;
  }
  return best;
}

function landmarkFeature(c: Ctx) {
  const id = c.o.landmark;
  if (!id) return;
  const { N, map, rng } = c;
  const set = LANDMARK_SETTING[id];
  const wet = set === 'span' || set === 'river' || set === 'shore';
  const A = c.starts[0];
  const fx = A.x, fy = A.y + 1;
  const height = LANDMARK_HEIGHTS[id];
  void fx; void fy;
  // facing: the model's front to the camera (south); bridges and river works lie across the water: a river running
  // east-west, or an inlet from a side edge (no river), turns them a quarter
  let facing: 0 | 1 = 0;
  // (naval battles: the landmark's water is a bay off the sea up-screen, so its deck runs east-west)
  if ((set === 'span' || set === 'river') && (!c.river || !c.river.ns) && c.o.kind !== 'naval') facing = 1;
  const { w, h } = placedSize(id, facing);
  interface Cand { cx: number; cy: number; score: number; foc: { x: number; y: number; dist: number } }
  const cands: Cand[] = [];
  for (let cy = 1; cy + h < N - 1; cy++) for (let cx = 1; cx + w < N - 1; cx++) {
    const mx = cx + w / 2, my = cy + h / 2;
    // clear of every enemy base area and of the human's yard and landing ground (the start camera sees only
    // about 11 cells up-screen of the human start, so the landmark stands at the edge of that ground)
    let bad = false;
    for (let k = 0; k < c.starts.length; k++) {
      const s = c.starts[k];
      const qx = clamp(s.x, cx, cx + w), qy = clamp(s.y, cy, cy + h);
      if (Math.hypot(qx - s.x, qy - s.y) < (k === 0 ? HUMAN_R : BASE_R + 2)) { bad = true; break; }
    }
    if (bad) continue;
    // (cheap first: only spots near the start can be framed with it)
    if (Math.hypot(mx - A.x, my - A.y) > 24) continue;
    // the water a bridge / shore landmark digs keeps clear of the human's base and the enemy bases
    if (wet && !(c.river && (set === 'span' || set === 'river'))) {
      const wr = waterRect(c, cx, cy, w, h, set, facing);
      // (a naval battle's own harbour bay already reaches 8 cells from the human start)
      if (wr && c.starts.some((st, k) => rectDist(wr, st) < (k === 0 ? (c.o.kind === 'naval' ? 8 : 9.5) : BASE_R + 1))) continue;
    }
    const fr = bestFraming(A, cx, cy, w, h, height);
    if (fr.wide < SHOW_MIN) continue;
    const show = fr.wide * 0.7 + fr.narrow * 0.3;
    const foc = { x: fr.x, y: fr.y, dist: fr.dist };
    let water = 0;
    for (let y = cy; y < cy + h; y++) for (let x = cx; x < cx + w; x++) if (map.terrain[y * N + x] === T.Water) water++;
    const cells = w * h;
    let fit: number;
    if (set === 'span' || set === 'river') {
      if (c.river) fit = riverUnder(c, cx, cy, w, h, facing) ? 1.5 : -1; // on the river, across it
      else fit = 0.5; // an inlet is dug for it
    } else if (set === 'shore') {
      fit = water > 0 && water < cells * 0.6 ? 1.2 : 0.4; // (no water: a bay is dug in front of it)
    } else {
      fit = water > cells * 0.25 ? -1 : 1 - water / cells; // (a little water under it is filled in)
    }
    if (fit < 0) continue;
    // where the fighting is: up-screen of the start, off to the side of the straight line to the enemy
    const [t, s] = frameOf(c, mx, my);
    const d = Math.hypot(mx - fx, my - fy);
    // (up-screen of the start toward the enemy, t 0.12..0.45, rather than beside it)
    const ahead = Math.max(0, my - (A.y - 7)) * 0.7 + Math.max(0, 0.12 - t) * 20 + Math.max(0, t - 0.45) * 10;
    // (tall ones stand better beside the start, where their tops stay on the screen; a wider start view costs a little)
    const tall = height >= 5 ? 0.4 : 1;
    const score = fit * 3 + show * 8 - Math.abs(d - 9 - Math.min(w, h) / 2) * 0.3 - Math.max(0, 3 + Math.min(w, h) / 2 - Math.abs(s)) * 0.5
      - ahead * tall - (foc.dist - CAM.dist) * 0.12 + rng.next() * 1.5;
    cands.push({ cx, cy, score, foc });
  }
  cands.sort((a, b) => b.score - a.score || a.cy - b.cy || a.cx - b.cx);
  for (const k of cands.slice(0, 30)) {
    if (!fitsWithoutSealing(c, k.cx, k.cy, w, h, set)) continue;
    if (wet) landmarkWater(c, k.cx, k.cy, w, h, set, facing);
    standLandmark(c, id, k.cx, k.cy, facing, set);
    c.focus = k.foc;
    return;
  }
}

/** The rectangle [x0, y0, x1, y1) of the water landmarkWater digs for a landmark without a river under it. */
function waterRect(c: Ctx, cx: number, cy: number, w: number, h: number, set: string, facing: 0 | 1): [number, number, number, number] | null {
  const N = c.N, mx = cx + w / 2, my = cy + h / 2;
  if (c.o.kind === 'naval') {
    if (set === 'span') { const half = (w - 4) / 2; return [Math.round(mx - half), 0, Math.round(mx + half), cy + h + 2]; }
    if (set === 'river') { const half = (w - 4) / 2; return [Math.round(mx - half), 0, Math.round(mx + half), cy]; }
    return [cx - 2, 0, cx + w + 2, cy + (c.o.landmark === 'statue-of-liberty' ? h + 2 : 0)];
  }
  const toWest = mx < N / 2;
  if (set === 'span' || set === 'river') {
    const half = ((facing === 0 ? w : h) - 4) / 2;
    if (facing === 1) return [toWest ? 0 : cx - 3, Math.round(my - half), toWest ? cx + w + 4 : N, Math.round(my + half) + 1];
    return [Math.round(mx - half), 0, Math.round(mx + half), cy + h + 4];
  }
  const island = c.o.landmark === 'statue-of-liberty';
  return [toWest ? 0 : cx - 3, cy - (island ? 4 : 6), toWest ? cx + w + 4 : N, cy + (island ? h + 3 : 1)];
}
/** Distance from a point to a cell rectangle [x0, y0, x1, y1). */
function rectDist(r: [number, number, number, number], p: { x: number; y: number }): number {
  const qx = clamp(p.x, r[0], r[2]), qy = clamp(p.y, r[1], r[3]);
  return Math.hypot(qx - p.x, qy - p.y);
}

/** Whether the river runs across the footprint's long axis: land at both ends, water through the middle. */
function riverUnder(c: Ctx, cx: number, cy: number, w: number, h: number, facing: 0 | 1): boolean {
  const { N, map } = c;
  const along = facing === 0 ? w : h;
  let endsDry = 0, midWet = 0;
  for (let k = 0; k < along; k++) {
    const lx = facing === 0 ? cx + k : cx + Math.floor(w / 2), ly = facing === 0 ? cy + Math.floor(h / 2) : cy + k;
    const wet = map.terrain[ly * N + lx] === T.Water;
    if ((k < 2 || k >= along - 2) && !wet) endsDry++;
    if (k >= 2 && k < along - 2 && wet) midWet++;
  }
  return endsDry >= 3 && midWet >= 2;
}

/**
 * The water a bridge, falls, locks or shore landmark needs where there is none: an inlet from the nearest side
 * edge under a bridge's deck (ships pass beneath, it ends just past the bridge, so ground units walk round its
 * head), a channel through falls and locks, a bay behind a waterfront monument or round an island fort.
 */
function landmarkWater(c: Ctx, cx: number, cy: number, w: number, h: number, set: string, facing: 0 | 1) {
  const { N, map } = c;
  const mx = cx + w / 2, my = cy + h / 2;
  const dig = (x: number, y: number) => {
    if (!map.inBounds(x, y) || c.base[y * N + x]) return;
    map.terrain[y * N + x] = T.Water;
  };
  if (c.o.kind === 'naval') {
    // a naval battle: the landmark's water opens north into the sea (a bay, never a pond a shipyard could trap a
    // fleet in): columns dug from just south of the landmark (bridges), or from its north edge (falls, locks, shore
    // works), up to the first open water
    const toSea = (x0: number, x1: number, y0: number) => {
      for (let x = x0; x < x1; x++) for (let y = y0; y >= 0; y--) {
        if (!map.inBounds(x, y)) break;
        const inside = x >= cx && x < cx + w && y >= cy && y < cy + h;
        if (map.terrain[y * N + x] === T.Water && !inside && y < cy) break;
        if (!inside || set === 'span') dig(x, y);
      }
    };
    if (set === 'span') { const half = (w - 4) / 2; toSea(Math.round(mx - half), Math.round(mx + half), cy + h + 1); }
    else if (set === 'river') toSea(Math.round(mx - (w - 4) / 2), Math.round(mx + (w - 4) / 2), cy - 1);
    else {
      toSea(cx - 1, cx + w + 1, cy - 1);
      if (c.o.landmark === 'statue-of-liberty') for (let y = cy - 2; y < cy + h + 2; y++) for (let x = cx - 2; x < cx + w + 2; x++) {
        const inside = x >= cx && x < cx + w && y >= cy && y < cy + h;
        if (!inside) dig(x, y); else if (map.inBounds(x, y)) map.terrain[y * N + x] = T.Sand;
      }
    }
    return;
  }
  if (set === 'span' || set === 'river') {
    // the deck runs along the long axis; the water across it, (long - 4) wide
    const along = facing === 0 ? w : h;
    const half = (along - 4) / 2;
    if (c.river && riverUnder(c, cx, cy, w, h, facing)) {
      // the river widens under a long bridge (an estuary), a few cells up and down stream of it
      for (let k = -half; k < half; k++) for (let j = -(facing === 0 ? h : w) / 2 - 3; j < (facing === 0 ? h : w) / 2 + 3; j++) {
        const x = Math.floor(facing === 0 ? mx + k : mx + j), y = Math.floor(facing === 0 ? my + j : my + k);
        dig(x, y);
      }
      return;
    }
    if (facing === 1) {
      // deck north-south: the inlet runs east-west to the nearer side edge, and 3 cells past the bridge
      const toWest = mx < N / 2;
      const x0 = toWest ? 0 : cx - 3, x1 = toWest ? cx + w + 3 : N - 1;
      for (let x = x0; x <= x1; x++) for (let y = Math.round(my - half); y < Math.round(my + half); y++) {
        const wob = Math.round(Math.sin(x * 0.45) * 0.6);
        dig(x, y + wob);
      }
    } else {
      // deck east-west: the water runs north to the map's top or the nearest water
      for (let y = 0; y <= cy + h + 3; y++) for (let x = Math.round(mx - half); x < Math.round(mx + half); x++) dig(x, y);
    }
    return;
  }
  // shore: water north of the monument (out to the nearer side edge); an island fort gets a moat of sea round it
  const island = c.o.landmark === 'statue-of-liberty';
  const toWest = mx < N / 2;
  for (let y = cy - (island ? 4 : 6); y < cy + (island ? h + 3 : 1); y++) {
    const x0 = toWest ? 0 : cx - 3, x1 = toWest ? cx + w + 3 : N - 1;
    for (let x = x0; x <= x1; x++) {
      const inside = x >= cx && x < cx + w && y >= cy && y < cy + h;
      if (!inside) dig(x, y);
    }
  }
  if (island) {
    // the fort's island: its footprint is land, the sea all round (2 cells)
    for (let y = cy - 2; y < cy + h + 2; y++) for (let x = cx - 2; x < cx + w + 2; x++) {
      const inside = x >= cx && x < cx + w && y >= cy && y < cy + h;
      if (inside) { if (map.inBounds(x, y)) map.terrain[y * N + x] = T.Sand; } else dig(x, y);
    }
  }
}

/** Whether a footprint leaves the human and every enemy start connected on foot (counting water as crossable). */
function fitsWithoutSealing(c: Ctx, cx: number, cy: number, w: number, h: number, set: string): boolean {
  const { N, map } = c;
  const blocked = (i: number) => {
    const x = i % N, y = (i / N) | 0;
    if (x >= cx && x < cx + w && y >= cy && y < cy + h) return set !== 'span' || map.terrain[i] !== T.Water;
    return false;
  };
  // flood over everything but the footprint (rock and water count: corridors open them later)
  const seen = new Uint8Array(N * N);
  const q = new Int32Array(N * N);
  let qh = 0, qt = 0;
  const s0 = Math.floor(c.starts[0].y) * N + Math.floor(c.starts[0].x);
  seen[s0] = 1; q[qt++] = s0;
  while (qh < qt) {
    const i = q[qh++];
    const x = i % N, y = (i / N) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const j = ny * N + nx;
      if (seen[j] || blocked(j)) continue;
      seen[j] = 1;
      q[qt++] = j;
    }
  }
  return c.starts.every((s) => seen[Math.floor(s.y) * N + Math.floor(s.x)] === 1);
}

function standLandmark(c: Ctx, id: LandmarkId, cx: number, cy: number, facing: 0 | 1, set: string) {
  const { N, map, o } = c;
  const { w, h } = placedSize(id, facing);
  const ground = set === 'plaza' ? T.Dirt : o.climate === 'desert' ? T.Sand : set === 'peak' || set === 'cliff' ? T.Rock : T.Clear;
  // the ground round it: a paved / open apron (2 cells), rock behind a cliff, foothills round a peak
  const apron = set === 'peak' ? 1 : 2;
  for (let y = cy - apron; y < cy + h + apron; y++) for (let x = cx - apron; x < cx + w + apron; x++) {
    if (!map.inBounds(x, y)) continue;
    const i = y * N + x;
    const inside = x >= cx && x < cx + w && y >= cy && y < cy + h;
    c.lock[i] = 1;
    if (inside) continue;
    if (set === 'span' || set === 'shore' || set === 'river') continue; // (the water stays round bridges and shore works)
    if (map.terrain[i] === T.Rock || map.terrain[i] === T.Water) map.terrain[i] = o.climate === 'desert' ? T.Sand : T.Clear;
    if (set === 'plaza') c.claim[i] = 1;
  }
  if (set === 'cliff') {
    // a rock face behind (north of) the carving
    for (let y = cy - 4; y < cy; y++) for (let x = cx - 1; x < cx + w + 1; x++) {
      if (!map.inBounds(x, y) || c.base[y * N + x]) continue;
      map.terrain[y * N + x] = T.Rock;
      c.lift[y * (N + 1) + x] += 1.6;
    }
  }
  if (set === 'peak') {
    // foothills: broken rock round the base, never closing it in (gaps every few cells)
    const mx = cx + w / 2, my = cy + h / 2, R = Math.max(w, h) / 2;
    for (let y = Math.floor(my - R - 3); y <= my + R + 3; y++) for (let x = Math.floor(mx - R - 3); x <= mx + R + 3; x++) {
      if (!map.inBounds(x, y) || c.base[y * N + x] || c.lock[y * N + x]) continue;
      const d = Math.hypot(x + 0.5 - mx, y + 0.5 - my) - R;
      if (d > 0 && d < 2.5 && hash2(x, y, o.seed + 31) < 0.45) map.terrain[y * N + x] = T.Rock;
    }
  }
  // flat pad: the footprint's mean height is set in heights()
  c.landmark = placeLandmark(map, id, cx, cy, facing, ground);
}

// ---- corridors ----------------------------------------------------------------------------------------
/** Binary-heap Dijkstra over the grid (8 neighbours) from a start cell to a goal cell; returns the path cells. */
function cheapestPath(N: number, cost: Float32Array, from: number, to: number): number[] {
  const dist = new Float64Array(N * N).fill(Infinity);
  const prev = new Int32Array(N * N).fill(-1);
  const heap: number[] = [];
  const hd: number[] = [];
  const push = (i: number, d: number) => {
    heap.push(i); hd.push(d);
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (hd[p] <= hd[k]) break;
      [heap[p], heap[k]] = [heap[k], heap[p]]; [hd[p], hd[k]] = [hd[k], hd[p]];
      k = p;
    }
  };
  const pop = (): number => {
    const top = heap[0];
    const li = heap.pop()!, ld = hd.pop()!;
    if (heap.length) {
      heap[0] = li; hd[0] = ld;
      let k = 0;
      for (;;) {
        const a = 2 * k + 1, b = a + 1;
        let m = k;
        if (a < heap.length && hd[a] < hd[m]) m = a;
        if (b < heap.length && hd[b] < hd[m]) m = b;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]]; [hd[m], hd[k]] = [hd[k], hd[m]];
        k = m;
      }
    }
    return top;
  };
  dist[from] = 0;
  push(from, 0);
  while (heap.length) {
    const d0 = hd[0];
    const i = pop();
    if (d0 > dist[i]) continue;
    if (i === to) break;
    const x = i % N, y = (i / N) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const j = ny * N + nx;
      const cj = cost[j];
      if (!(cj < Infinity)) continue;
      if (dx && dy && (!(cost[y * N + nx] < Infinity) || !(cost[ny * N + x] < Infinity))) continue;
      const nd = d0 + cj * (dx && dy ? 1.414 : 1);
      if (nd < dist[j]) { dist[j] = nd; prev[j] = i; push(j, nd); }
    }
  }
  if (prev[to] < 0 && from !== to) return [];
  const out: number[] = [];
  for (let k = to; k >= 0; k = prev[k]) { out.push(k); if (k === from) break; }
  return out.reverse();
}

/**
 * Ground routes: the cheapest way from the human start to each enemy start (and a flank route), carved where it
 * has to (rock to a dirt pass, water to a ford) and kept open (no trees, no buildings). The cost grid prefers open
 * ground, so the routes follow the passes and crossings the features left.
 */
function corridors(c: Ctx) {
  const { N, map, o } = c;
  const lm = c.landmark;
  const naval = o.kind === 'naval';
  const islandSea = naval && c.feats.includes('island');
  const cost = new Float32Array(N * N);
  const fill = (extra: Uint8Array | null) => {
    for (let i = 0; i < N * N; i++) {
      const t = map.terrain[i];
      const x = i % N, y = (i / N) | 0;
      // (naval battles never ford the sea: the ground route goes round it)
      let k = t === T.Rock ? 22 : t === T.Water ? (naval ? Infinity : 26) : 1;
      if (lm && x >= lm.cx - 1 && x < lm.cx + lm.w + 1 && y >= lm.cy - 1 && y < lm.cy + lm.h + 1) k = Infinity;
      if (x === 0 || y === 0 || x === N - 1 || y === N - 1) k += 6;
      if (extra && extra[i]) k += 5;
      cost[i] = k;
    }
  };
  const routes: [number, number][] = [[0, 1]];
  for (let k = 2; k < c.starts.length; k++) routes.push([0, k], [1, k]);
  const cell = (s: { x: number; y: number }) => Math.floor(s.y) * N + Math.floor(s.x);
  const near = new Uint8Array(N * N);
  if (islandSea) return; // (two islands: the sea is the route; the battle script brings transports)
  fill(null);
  for (const [a, b] of routes) carvePath(c, cheapestPath(N, cost, cell(c.starts[a]), cell(c.starts[b])), 1, near);
  // a flank route between the two main bases, away from the first
  const spread = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) if (near[i]) {
    const x = i % N, y = (i / N) | 0;
    for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < N && ny < N) spread[ny * N + nx] = 1;
    }
  }
  fill(spread);
  const flank = cheapestPath(N, cost, cell(c.starts[0]), cell(c.starts[1]));
  // only where it costs little to open (the map's own second way through), so features keep their shape
  let blockedOnFlank = 0;
  for (const i of flank) if (map.terrain[i] === T.Rock || map.terrain[i] === T.Water) blockedOnFlank++;
  if (blockedOnFlank <= 10) carvePath(c, flank, 1, null);
}

function carvePath(c: Ctx, path: number[], width: number, mark: Uint8Array | null) {
  const { N, map, o } = c;
  const dry = o.climate === 'desert' ? T.Sand : T.Dirt;
  for (const i of path) {
    const x = i % N, y = (i / N) | 0;
    for (let dy = -width; dy <= width; dy++) for (let dx = -width; dx <= width; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const j = ny * N + nx;
      if (map.landmarks.length && isUnderLandmark(c, nx, ny)) continue;
      const t = map.terrain[j];
      if (t === T.Rock) { map.terrain[j] = dry; c.repairs++; }
      else if (t === T.Water) { map.terrain[j] = T.Sand; c.claim[j] = 3; c.repairs++; } // a ford
      c.lane[j] = 1;
      if (mark) mark[j] = 1;
    }
  }
}

function isUnderLandmark(c: Ctx, x: number, y: number): boolean {
  const l = c.landmark;
  return !!l && x >= l.cx && x < l.cx + l.w && y >= l.cy && y < l.cy + l.h;
}

/** Sand along the waterline (as mapgen), except on fords already sand. */
function shores(c: Ctx) {
  const { N, map } = c;
  const dw = bfsDistance(N, (i) => map.terrain[i] === T.Water);
  for (let i = 0; i < N * N; i++) {
    const t = map.terrain[i];
    if (t !== T.Water && t !== T.Rock && dw[i] <= (c.o.climate === 'tropical' ? 1 : 2) && !isUnderLandmark(c, i % N, (i / N) | 0)) map.terrain[i] = T.Sand;
  }
}

// ---- ore ------------------------------------------------------------------------------------------------
function ore(c: Ctx) {
  const { N, map, rng, noise, o } = c;
  type Field = { x: number; y: number; r: number; gems: boolean; owner: number };
  const fields: Field[] = [];
  const C = { x: N / 2, y: N / 2 };
  const home = (s: { x: number; y: number }, toward: { x: number; y: number }, owner: number) => {
    const a0 = Math.atan2(toward.y - s.y, toward.x - s.x);
    for (let k = 0; k < 2; k++) {
      const spread = rng.range(0.7, 1.25);
      const a = a0 + (k ? 1 : -1) * spread;
      const d = rng.range(8.5, 11);
      fields.push({ x: s.x + Math.cos(a) * d, y: s.y + Math.sin(a) * d, r: rng.range(3.3, 4.0) * (0.8 + 0.7 * 0.4), gems: false, owner });
    }
    // a third field behind the base
    const a3 = a0 + Math.PI + rng.range(-0.6, 0.6);
    fields.push({ x: s.x + Math.cos(a3) * 8.5, y: s.y + Math.sin(a3) * 8.5, r: rng.range(2.8, 3.4), gems: false, owner });
  };
  const A = c.starts[0], D = c.starts[1];
  home(A, D, 0);
  home(D, A, 1);
  for (let k = 2; k < c.starts.length; k++) home(c.starts[k], A, k);
  // contested fields between the bases, one on each side of the line
  for (const sd of [-1, 1]) {
    const [x, y] = frameAt(c, rng.range(0.42, 0.58), sd * rng.range(N * 0.12, N * 0.22));
    fields.push({ x, y, r: rng.range(3.4, 4.2), gems: false, owner: -1 });
  }
  if (o.strength >= 3) { const [x, y] = frameAt(c, 0.5, rng.range(-4, 4)); fields.push({ x, y, r: 2.2, gems: true, owner: -1 }); }
  const reaches = c.starts.map((s) => landReachFrom(c, s));
  for (const f of fields) {
    // slide a field that lands on water / rock / the landmark toward its owner (contested: the centre) until it is
    // on open ground its owner reaches (a few tries)
    let fx = f.x, fy = f.y;
    const to = f.owner >= 0 ? c.starts[f.owner] : C;
    for (let k = 0; k < 12; k++) {
      const i = Math.floor(clamp(fy, 0, N - 1)) * N + Math.floor(clamp(fx, 0, N - 1));
      const reached = f.owner >= 0 ? reaches[f.owner][i] : reaches.some((r) => r[i]);
      if (map.terrainPassable(i) && !(c.lock[i] && !c.base[i]) && reached) break;
      fx += (to.x - fx) * 0.15 + (rng.next() - 0.5) * 3;
      fy += (to.y - fy) * 0.15 + (rng.next() - 0.5) * 3;
    }
    f.x = fx; f.y = fy;
  }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    const t = map.terrain[i];
    if (t === T.Water || t === T.Rock || (c.lock[i] && !c.base[i]) || c.claim[i]) continue;
    let best = 0, gem = false;
    for (const f of fields) {
      const d = Math.hypot(x + 0.5 - f.x, y + 0.5 - f.y);
      const r = f.r + (noise.value(x * 0.5 + 77, y * 0.5 + 33) - 0.5) * 1.6;
      if (d < r) {
        const v = Math.pow(1 - d / r, 0.6) * (0.75 + 0.25 * hash2(x, y, o.seed + 5));
        if (v > best) { best = v; gem = f.gems; }
      }
    }
    if (best > 0.06) {
      const bails = Math.max(2, Math.round((0.35 + best * 0.75) * ORE_MAX * (0.75 + 0.7 * 0.4)));
      map.ore[i] = Math.min(ORE_MAX, bails);
      map.gems[i] = gem ? 1 : 0;
      map.oreField[i] = gem ? 2 : 1;
      if (map.terrain[i] === T.Sand && o.climate !== 'desert') map.terrain[i] = T.Clear;
    }
  }
}

// ---- civilian buildings -----------------------------------------------------------------------------------
/** Place a civilian building if its footprint (and a 1-cell walk round it for streets) is free. */
function trySite(c: Ctx, kind: CivilianKind, cx: number, cy: number, facing: 0 | 1 | 2 | 3, dense = false): boolean {
  const { N, map, o } = c;
  if (c.sites.length >= 64) return false;
  const { w, h } = civilianSize(kind, facing);
  for (let y = cy - (dense ? 0 : 1); y < cy + h + (dense ? 0 : 1); y++) for (let x = cx - (dense ? 0 : 1); x < cx + w + (dense ? 0 : 1); x++) {
    if (x < 1 || y < 1 || x >= N - 1 || y >= N - 1) return false;
    const i = y * N + x;
    const inside = x >= cx && x < cx + w && y >= cy && y < cy + h;
    if (c.occ[i]) return false;
    if (inside) {
      const t = map.terrain[i];
      if (t === T.Water || t === T.Rock || c.lock[i] || c.lane[i] || map.ore[i] || c.claim[i] === 1 || c.claim[i] === 3) return false;
    }
  }
  for (let y = cy; y < cy + h; y++) for (let x = cx; x < cx + w; x++) {
    c.occ[y * N + x] = 1;
    map.tree[y * N + x] = 0;
    if (map.terrain[y * N + x] === T.Sand && o.climate !== 'desert') map.terrain[y * N + x] = T.Clear;
  }
  c.sites.push({ type: civilianType(w, h), cx, cy, kind, culture: o.culture, seed: hash2(cx, cy, o.seed + 401) * 4294967296 >>> 0, facing });
  return true;
}

/** What a city block holds, by culture (tall downtowns in the Americas and East Asia, low towns in Africa). */
function cityMix(culture: Culture): CivilianKind[] {
  switch (culture) {
    case 'north-american': return ['tower', 'tower', 'apartment', 'apartment', 'shop', 'hall'];
    case 'east-asian': return ['tower', 'apartment', 'apartment', 'shop', 'shop', 'hall'];
    case 'african': case 'oceanian': return ['house', 'house', 'shop', 'apartment', 'hall'];
    case 'middle-eastern': case 'south-asian': return ['apartment', 'house', 'shop', 'shop', 'hall'];
    case 'southeast-asian': case 'latin-american': return ['apartment', 'shop', 'house', 'shop', 'hall', 'tower'];
    default: return ['apartment', 'apartment', 'shop', 'tower', 'hall', 'house'];
  }
}

function cityFeature(c: Ctx) {
  const { N, rng, o } = c;
  // the centre: the landmark's square if it stands in one, else between the bases
  const lm = c.landmark;
  let [mx, my] = lm && LANDMARK_SETTING[lm.id] === 'plaza' ? [lm.cx + lm.w / 2, lm.cy + lm.h / 2] : frameAt(c, 0.5, rng.range(-3, 3));
  mx = clamp(mx, N * 0.3, N * 0.7); my = clamp(my, N * 0.3, N * 0.7);
  const hx = Math.round(N * 0.22), hy = Math.round(N * 0.18);
  const pitch = 6; // a 4-cell block and a 2-cell street
  const x0 = Math.round(mx - hx), y0 = Math.round(my - hy);
  const mix = cityMix(o.culture);
  // streets (render: main roads)
  for (let x = x0; x <= x0 + 2 * hx; x += pitch) c.streets.push([[x + 1, Math.max(1, y0 - 1)], [x + 1, Math.min(N - 2, y0 + 2 * hy + 1)]]);
  for (let y = y0; y <= y0 + 2 * hy; y += pitch) c.streets.push([[Math.max(1, x0 - 1), y + 1], [Math.min(N - 2, x0 + 2 * hx + 1), y + 1]]);
  for (let by = y0 + 2; by + 4 <= y0 + 2 * hy + 2; by += pitch) for (let bx = x0 + 2; bx + 4 <= x0 + 2 * hx + 2; bx += pitch) {
    // fill a 4x4 block: a pattern of footprints
    const pat = Math.floor(hash2(bx, by, o.seed + 77) * 4);
    const put = (kind: CivilianKind, x: number, y: number, f: 0 | 1 | 2 | 3) => trySite(c, kind, x, y, f, true);
    const pick = (k: number) => mix[Math.floor(hash2(bx + k, by - k, o.seed + 91) * mix.length)];
    const big = (k: number): CivilianKind => { const p = pick(k); return p === 'house' || p === 'tower' || p === 'shop' ? 'apartment' : p === 'hall' ? 'apartment' : p; };
    if (pat === 0) { put(big(0), bx, by, 2); put(big(1), bx + 2, by, 2); put(big(2), bx, by + 2, 0); put(big(3), bx + 2, by + 2, 0); }
    else if (pat === 1) { put('hall', bx, by, 2); put(pick(1) === 'tower' ? 'tower' : 'house', bx + 3, by, 2); put('shop', bx, by + 3, 0); put('shop', bx + 2, by + 3, 0); }
    else if (pat === 2) { put(big(0), bx, by, 3); put('shop', bx + 2, by, 2); put('tower', bx + 2, by + 1, 1); put(big(1), bx, by + 2, 0); put('shop', bx + 2, by + 3, 0); }
    else { put('tower', bx, by, 2); put('tower', bx + 3, by, 2); put(big(2), bx + 1, by + 1, 0); put('shop', bx, by + 3, 0); put('shop', bx + 2, by + 3, 0); }
  }
  // streets stay open
  for (const [[ax, ay], [bx, by]] of c.streets) {
    const steps = Math.ceil(Math.hypot(bx - ax, by - ay));
    for (let k = 0; k <= steps; k++) {
      const px = ax + ((bx - ax) * k) / steps, py = ay + ((by - ay) * k) / steps;
      for (const [x, y] of [[Math.floor(px - 0.5), Math.floor(py - 0.5)], [Math.floor(px), Math.floor(py)]]) {
        if (x >= 0 && y >= 0 && x < N && y < N) c.claim[y * N + x] = c.claim[y * N + x] || 4;
      }
    }
  }
  if (c.sites.length) c.honoured.push('city');
}

function townFeature(c: Ctx, count: number) {
  const { N, rng, o } = c;
  let made = 0;
  const kinds: CivilianKind[] = o.culture === 'north-american' ? ['house', 'house', 'shop', 'farm', 'hall'] : ['house', 'house', 'house', 'shop', 'shop', 'hall', 'farm'];
  for (let k = 0; k < 30 && made < count; k++) {
    const side = (k + made) % 2 ? 1 : -1;
    const [x, y] = frameAt(c, rng.range(0.2, 0.8), side * rng.range(5, N * 0.3));
    const cx = Math.round(x), cy = Math.round(y);
    if (cx < 5 || cy < 5 || cx > N - 6 || cy > N - 6 || baseGap(c, cx, cy) < 5) continue;
    if (c.lock[cy * N + cx] || c.map.terrain[cy * N + cx] === T.Water || c.map.terrain[cy * N + cx] === T.Rock) continue;
    // a village square, houses round it facing in
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) c.claim[(cy + dy) * N + cx + dx] = 1;
    let n = 0;
    const want = 5 + Math.floor(rng.next() * 5);
    for (let a = 0; a < 16 && n < want; a++) {
      const ang = (a / 16) * Math.PI * 2 + rng.range(-0.2, 0.2);
      const r = 2.8 + (a % 3) * 1.4;
      const hx = Math.round(cx + Math.cos(ang) * r), hy = Math.round(cy + Math.sin(ang) * r);
      const dx = cx - hx, dy = cy - hy;
      const facing = (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 0 : 2) as 0 | 1 | 2 | 3;
      if (trySite(c, kinds[Math.floor(hash2(hx, hy, o.seed + 5) * kinds.length)], hx, hy, facing)) n++;
    }
    if (n >= 3) made++;
  }
  if (made && c.feats.includes('town')) c.honoured.push('town');
}

function farmlandFeature(c: Ctx) {
  const { N, map, rng, o } = c;
  // ploughed plots and crop fields on the flanks, hedgerows with gaps between some of them, a farm in a few
  let plots = 0;
  for (let k = 0; k < 40 && plots < 9; k++) {
    const pw = 5 + Math.floor(rng.next() * 4), ph = 4 + Math.floor(rng.next() * 3);
    const px = Math.floor(rng.range(2, N - pw - 2)), py = Math.floor(rng.range(2, N - ph - 2));
    let ok = true;
    for (let y = py - 1; y <= py + ph && ok; y++) for (let x = px - 1; x <= px + pw; x++) {
      const i = y * N + x;
      if (c.lock[i] || c.claim[i] || map.ore[i] || map.terrain[i] === T.Water || map.terrain[i] === T.Rock || c.occ[i]) { ok = false; break; }
    }
    if (!ok) continue;
    const ploughed = plots % 2 === 0;
    for (let y = py; y < py + ph; y++) for (let x = px; x < px + pw; x++) {
      const i = y * N + x;
      if (c.lane[i]) continue;
      map.terrain[i] = ploughed && (o.climate !== 'winter') ? T.Dirt : T.Clear;
      c.claim[i] = 5;
    }
    // hedgerow along the north edge (gaps), sometimes the west
    for (let x = px; x < px + pw; x++) if ((x - px) % 5 !== 2 && !c.lane[(py - 1) * N + x]) c.claim[(py - 1) * N + x] = 6;
    if (rng.chance(0.5)) for (let y = py; y < py + ph; y++) if ((y - py) % 4 !== 1 && !c.lane[y * N + px - 1]) c.claim[y * N + px - 1] = 6;
    if (rng.chance(0.35)) trySite(c, 'farm', px + pw + 1, py, 3);
    plots++;
  }
  if (plots) c.honoured.push('farmland');
}

// ---- trees ------------------------------------------------------------------------------------------------
function trees(c: Ctx) {
  const { N, map, noise, o } = c;
  const desert = o.climate === 'desert', tropical = o.climate === 'tropical';
  const jungle = c.feats.includes('jungle');
  let density = tropical ? 0.75 : desert ? 0.08 : o.terrain === 'forest' ? 0.8 : o.terrain === 'steppe' ? 0.1 : o.climate === 'winter' ? 0.5 : 0.42;
  if (jungle) density = 0.92;
  if (c.feats.includes('city')) density *= 0.6;
  // (a jungle is a closed canopy: far more of the ground under trees; the corridors and bases stay open)
  const forestT = 0.72 - density * (jungle ? 0.3 : 0.16);
  // rivers in dry lands: a green strip along the banks (the Nile)
  const dw = desert || c.river ? bfsDistance(N, (i) => map.terrain[i] === T.Water) : null;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    const t = map.terrain[i];
    if (t === T.Water || t === T.Rock || map.ore[i] || c.occ[i] || c.lane[i] || (c.lock[i] && !c.base[i])) continue;
    if (c.base[i] || baseGap(c, x + 0.5, y + 0.5) < 1) continue;
    if (c.claim[i] && c.claim[i] !== 2 && c.claim[i] !== 6) continue;
    const tf = noise.fbm(x * 0.06 + 200, y * 0.06 + 200, 3);
    const h = hash2(x, y, o.seed + 99);
    let grow = (tf > forestT && h < 0.8) || h < 0.012 * (0.5 + density);
    if (c.claim[i] === 2) grow = h < 0.75; // oasis palms
    if (c.claim[i] === 6) grow = h < 0.85; // hedgerows
    if (desert && dw && dw[i] >= 2 && dw[i] <= 4 && c.river) grow = grow || h < 0.55;
    if (!grow) continue;
    // a little clearance round ore for the harvesters
    let nearOre = false;
    for (let dy = -1; dy <= 1 && !nearOre; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < N && ny < N && map.ore[ny * N + nx]) { nearOre = true; break; }
    }
    if (!nearOre) map.tree[i] = 1 + Math.floor(hash2(x, y, o.seed + 7) * 4);
  }
  if (jungle) c.honoured.push('jungle');
}

// ---- heights ------------------------------------------------------------------------------------------------
function heights(c: Ctx) {
  const { N, map, noise, o, look } = c;
  const W = N + 1;
  const distWater = bfsDistance(N, (i) => map.terrain[i] === T.Water);
  const distLand = bfsDistance(N, (i) => map.terrain[i] !== T.Water);
  const relief = o.terrain === 'mountain' ? 1.4 : o.terrain === 'plains' || o.terrain === 'steppe' ? 0.75 : 1;
  const cellAt = (x: number, y: number) => clamp(y, 0, N - 1) * N + clamp(x, 0, N - 1);
  const wx = Math.cos(look.wind), wy = Math.sin(look.wind);
  for (let vy = 0; vy <= N; vy++) for (let vx = 0; vx <= N; vx++) {
    let h = ((noise.fbm(vx * 0.04, vy * 0.04, 4) - 0.5) * 0.55 + (noise.fbm(vx * 0.25 + 9, vy * 0.25 + 9, 2) - 0.5) * 0.08) * relief;
    let rock = 0, water = 0, sand = 0, dw = 0, dl = 0, ford = 0;
    for (let dy = -1; dy <= 0; dy++) for (let dx = -1; dx <= 0; dx++) {
      const ci = cellAt(vx + dx, vy + dy);
      const t = map.terrain[ci];
      if (t === T.Rock && !isUnderLandmark(c, ci % N, (ci / N) | 0)) rock++;
      if (t === T.Water) water++;
      if (t === T.Sand) sand++;
      if (c.claim[ci] === 3) ford++;
      dw += distWater[ci];
      dl += distLand[ci];
    }
    dw /= 4; dl /= 4;
    if (rock > 0) h += (rock / 4) * (0.7 + noise.fbm(vx * 0.3 + 40, vy * 0.3 + 40, 3) * 1.6) * (o.terrain === 'mountain' ? 1.3 : 1);
    h += c.lift[vy * W + vx] * (rock > 0 ? 1 : 0.35);
    if (c.dunes && sand >= 3 && !rock) {
      // dune ridges across the wind
      const u = vx * wx + vy * wy, v = -vx * wy + vy * wx;
      const r = 1 - Math.abs(2 * noise.fbm(u * 0.11 + 5, v * 0.035 + 5, 3) - 1);
      h += r * r * 0.75;
    }
    if (water > 0) {
      h = WATER_LEVEL - 0.08 - (water / 4) * (0.12 + Math.min(dl, 4) * 0.16);
    } else if (ford > 0) {
      h = WATER_LEVEL + 0.03;
    } else if (dw < 4) {
      h = WATER_LEVEL + 0.1 + (h - WATER_LEVEL - 0.1) * smooth(0.5, 4, dw);
      if (h < WATER_LEVEL + 0.05) h = WATER_LEVEL + 0.05;
    }
    // flatten base areas (never lifting a sea floor)
    if (water === 0) {
      let f = 0;
      c.starts.forEach((s, k) => { f = Math.max(f, smooth(c.baseR[k] + 3, c.baseR[k] - 2, Math.hypot(vx - s.x, vy - s.y))); });
      h *= 1 - f * 0.85;
    }
    map.heights[vy * W + vx] = h;
  }
  // dry lands: mesas and canyon walls stay below the height the terrain caps with snow (except real mountains)
  if (o.climate === 'desert' && !c.feats.includes('mountains') && !c.feats.includes('volcano')) {
    for (let i = 0; i < map.heights.length; i++) if (map.heights[i] > 2.4) map.heights[i] = 2.4 + (map.heights[i] - 2.4) * 0.15;
  }
  // flat pads under the landmark and the civilian buildings (their mean height; never below the shore)
  const padRect = (cx: number, cy: number, w: number, h: number, keepWater: boolean) => {
    let s = 0, n = 0;
    for (let y = cy; y <= cy + h; y++) for (let x = cx; x <= cx + w; x++) { s += map.heights[y * W + x]; n++; }
    let m = s / n;
    if (!keepWater) m = Math.max(m, WATER_LEVEL + 0.12);
    for (let y = cy; y <= cy + h; y++) for (let x = cx; x <= cx + w; x++) {
      const i = y * W + x;
      if (keepWater && map.heights[i] < WATER_LEVEL) continue;
      map.heights[i] = m;
    }
  };
  const l = c.landmark;
  if (l) {
    const set = LANDMARK_SETTING[l.id];
    padRect(l.cx, l.cy, l.w, l.h, set === 'span' || set === 'shore');
  }
  for (const s of c.sites) {
    const sw = +s.type[2], sh = +s.type[3];
    padRect(s.cx, s.cy, sw, sh, false);
  }
}

// ---- bridges ------------------------------------------------------------------------------------------------
function bridges(c: Ctx) {
  const { N, map, rng } = c;
  if (!c.river) return;
  const { ns } = c.river;
  // one or two bridges across the river where it is narrow and not under the landmark, apart from the fords
  const cands: { b: MapBridge; score: number }[] = [];
  for (let k = 4; k < N - 4; k++) {
    const lanes: number[] = [k, k + 1];
    let lo = -1, hi = -1, ok = true;
    for (const lane of lanes) {
      // the run of water across the river at this lane
      let a = -1, b = -1;
      for (let p = 1; p < N - 1; p++) {
        const [x, y] = ns ? [p, lane] : [lane, p];
        if (map.terrain[y * N + x] === T.Water) { if (a < 0) a = p; b = p; }
        else if (a >= 0 && b >= 0 && p > b + 1) break;
      }
      if (a < 0 || b - a + 1 > 8 || b - a + 1 < 2) { ok = false; break; }
      if (lo >= 0 && (a !== lo || b !== hi)) { ok = false; break; }
      lo = a; hi = b;
    }
    if (!ok) continue;
    const cells: [number, number][] = [];
    for (const lane of lanes) for (let p = lo; p <= hi; p++) cells.push(ns ? [p, lane] : [lane, p]);
    // land at both ends, no landmark, no ford next to it
    const end = (p: number, lane: number) => { const [x, y] = ns ? [p, lane] : [lane, p]; const t = map.inBounds(x, y) ? map.terrain[y * N + x] : T.Water; return t !== T.Water && t !== T.Rock && !c.occ[y * N + x]; };
    if (!end(lo - 1, k) || !end(hi + 1, k) || !end(lo - 1, k + 1) || !end(hi + 1, k + 1)) continue;
    if (cells.some(([x, y]) => isUnderLandmark(c, x, y) || c.claim[y * N + x] === 3)) continue;
    const [mx, my] = ns ? [(lo + hi) / 2, k + 1] : [k + 1, (lo + hi) / 2];
    if (baseGap(c, mx, my) < 2) continue;
    if (c.landmark && Math.hypot(mx - (c.landmark.cx + c.landmark.w / 2), my - (c.landmark.cy + c.landmark.h / 2)) < 8) continue;
    cands.push({ b: { cells, axis: ns ? 'x' : 'y' }, score: -(hi - lo) + rng.next() * 2 - Math.abs(k - N / 2) * 0.05 });
  }
  cands.sort((a, b) => b.score - a.score);
  const chosen: MapBridge[] = [];
  for (const cd of cands) {
    if (chosen.length >= (N >= 72 ? 2 : 1)) break;
    const [x0, y0] = cd.b.cells[0];
    if (chosen.some((b) => Math.hypot(b.cells[0][0] - x0, b.cells[0][1] - y0) < 14)) continue;
    chosen.push(cd.b);
  }
  // the approaches stay open
  for (const b of chosen) for (const [x, y] of b.cells) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    if (map.inBounds(x + dx, y + dy)) map.tree[(y + dy) * N + x + dx] = 0;
  }
  map.bridges.push(...chosen);
}

// ---- validation -----------------------------------------------------------------------------------------------
function bfsDistance(N: number, src: (i: number) => boolean): Float32Array {
  const d = new Float32Array(N * N).fill(1e9);
  const q = new Int32Array(N * N);
  let qh = 0, qt = 0;
  for (let i = 0; i < N * N; i++) if (src(i)) { d[i] = 0; q[qt++] = i; }
  while (qh < qt) {
    const i = q[qh++];
    const x = i % N, y = (i / N) | 0;
    const nd = d[i] + 1;
    if (x > 0 && d[i - 1] > nd) { d[i - 1] = nd; q[qt++] = i - 1; }
    if (x < N - 1 && d[i + 1] > nd) { d[i + 1] = nd; q[qt++] = i + 1; }
    if (y > 0 && d[i - N] > nd) { d[i - N] = nd; q[qt++] = i - N; }
    if (y < N - 1 && d[i + N] > nd) { d[i + N] = nd; q[qt++] = i + N; }
  }
  return d;
}

/** Cells reachable on foot from a start without bridges, civilian buildings standing (8 neighbours, no corner cuts). */
function landReachFrom(c: Ctx, s: { x: number; y: number }, naval = false, sitesBlock = true): Uint8Array {
  const { N, map } = c;
  const ok = (i: number) => (naval ? map.terrain[i] === T.Water : map.terrain[i] !== T.Water && map.terrain[i] !== T.Rock && map.tree[i] === 0 && !(sitesBlock && c.occ[i]));
  const seen = new Uint8Array(N * N);
  const q = new Int32Array(N * N);
  let qh = 0, qt = 0;
  const st = Math.floor(s.y) * N + Math.floor(s.x);
  seen[st] = 1; q[qt++] = st;
  while (qh < qt) {
    const i = q[qh++];
    const x = i % N, y = (i / N) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const j = ny * N + nx;
      if (seen[j] || !ok(j)) continue;
      if (dx && dy && !ok(y * N + nx) && !ok(ny * N + x)) continue;
      seen[j] = 1;
      q[qt++] = j;
    }
  }
  return seen;
}

function validate(c: Ctx): RegionReport {
  const { N, map, o } = c;
  const naval = o.kind === 'naval';
  const islandSea = naval && c.feats.includes('island');
  // ground routes (repair: carve a straight corridor if something sealed one)
  let reach = landReachFrom(c, c.starts[0]);
  let paths = c.starts.every((s) => reach[Math.floor(s.y) * N + Math.floor(s.x)] === 1);
  if (!paths && !islandSea) {
    for (const s of c.starts.slice(1)) {
      if (reach[Math.floor(s.y) * N + Math.floor(s.x)]) continue;
      // (open rock and water cost more than land; the sea of a naval battle most)
      const cost = new Float32Array(N * N);
      for (let i = 0; i < N * N; i++) cost[i] = map.terrain[i] === T.Water ? (naval ? 400 : 12) : map.terrain[i] === T.Rock ? 6 : 1;
      if (c.landmark) for (let y = c.landmark.cy - 1; y <= c.landmark.cy + c.landmark.h; y++) for (let x = c.landmark.cx - 1; x <= c.landmark.cx + c.landmark.w; x++) if (map.inBounds(x, y)) cost[y * N + x] = Infinity;
      const path = cheapestPath(N, cost, Math.floor(c.starts[0].y) * N + Math.floor(c.starts[0].x), Math.floor(s.y) * N + Math.floor(s.x));
      carvePath(c, path, 1, null);
      for (const i of path) {
        const x = i % N, y = (i / N) | 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (map.inBounds(x + dx, y + dy)) map.tree[(y + dy) * N + x + dx] = 0;
      }
      // civilian buildings on the new corridor go
      c.sites = c.sites.filter((st) => {
        const sw = +st.type[2], sh = +st.type[3];
        for (let y = st.cy; y < st.cy + sh; y++) for (let x = st.cx; x < st.cx + sw; x++) if (c.lane[y * N + x]) {
          for (let yy = st.cy; yy < st.cy + sh; yy++) for (let xx = st.cx; xx < st.cx + sw; xx++) c.occ[yy * N + xx] = 0;
          return false;
        }
        return true;
      });
    }
    reach = landReachFrom(c, c.starts[0]);
    paths = c.starts.every((s) => reach[Math.floor(s.y) * N + Math.floor(s.x)] === 1);
  }
  // civilian buildings never close off ground: while some open ground is reachable from a start only with the
  // buildings gone, the building touching most of it goes (they could be shot down, but the pathfinder and every
  // AI would treat the pocket as lost)
  let dropped = 0;
  for (let guard = 0; guard < 40 && c.sites.length; guard++) {
    const open = new Uint8Array(N * N), shut = new Uint8Array(N * N);
    for (const s of c.starts) {
      const a = landReachFrom(c, s, false, false), b = landReachFrom(c, s, false, true);
      for (let i = 0; i < N * N; i++) { if (a[i]) open[i] = 1; if (b[i]) shut[i] = 1; }
    }
    const lost = new Uint8Array(N * N);
    let nLost = 0;
    for (let i = 0; i < N * N; i++) if (open[i] && !shut[i] && !c.occ[i]) { lost[i] = 1; nLost++; }
    if (!nLost) break;
    let worst = -1, worstN = 0;
    c.sites.forEach((st, k) => {
      const sw = +st.type[2], sh = +st.type[3];
      let n = 0;
      for (let y = st.cy - 1; y <= st.cy + sh; y++) for (let x = st.cx - 1; x <= st.cx + sw; x++) if (map.inBounds(x, y) && lost[y * N + x]) n++;
      if (n > worstN) { worstN = n; worst = k; }
    });
    if (worst < 0) break;
    const st = c.sites[worst];
    for (let y = st.cy; y < st.cy + +st.type[3]; y++) for (let x = st.cx; x < st.cx + +st.type[2]; x++) c.occ[y * N + x] = 0;
    c.sites.splice(worst, 1);
    dropped++;
  }
  if (dropped) reach = landReachFrom(c, c.starts[0]);
  // ore nobody can reach on foot goes (ore cells are open ground: a harvester has to drive onto them)
  const reaches = c.starts.map((s) => (islandSea ? landReachFrom(c, s) : reach));
  for (let i = 0; i < N * N; i++) {
    if (!map.ore[i]) continue;
    if (!reaches.some((r) => r[i])) { map.ore[i] = 0; map.gems[i] = 0; map.oreField[i] = 0; }
  }
  const oreN: number[] = [], oreNear: number[] = [], room: number[] = [];
  c.starts.forEach((s, k) => {
    let n = 0, near = 0, b = 0;
    const r = reaches[k];
    for (let i = 0; i < N * N; i++) {
      const x = i % N, y = (i / N) | 0;
      const d = Math.hypot(x + 0.5 - s.x, y + 0.5 - s.y);
      if (map.ore[i] && (r[i] || d < 16)) { n++; if (d < 14) near++; }
      if (d < 9 && map.buildable(x, y) && !c.occ[i]) b++;
    }
    oreN.push(n); oreNear.push(near); room.push(b);
  });
  // sea route between the two harbours (naval)
  let seaPath = !naval;
  if (naval) {
    const C = { x: N / 2, y: N / 2 };
    const bay = (s: { x: number; y: number }) => { const dx = C.x - s.x, dy = C.y - s.y, l = Math.hypot(dx, dy) || 1; return { x: s.x + (dx / l) * 12.5, y: s.y + (dy / l) * 12.5 }; };
    const nearestWater = (p: { x: number; y: number }) => {
      for (let r = 0; r < 10; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const x = Math.floor(p.x) + dx, y = Math.floor(p.y) + dy;
        if (map.inBounds(x, y) && map.terrain[y * N + x] === T.Water) return { x: x + 0.5, y: y + 0.5 };
      }
      return null;
    };
    const wa = nearestWater(bay(c.starts[0])), wb = nearestWater(bay(c.starts[1]));
    if (wa && wb) seaPath = landReachFrom(c, wa, true)[Math.floor(wb.y) * N + Math.floor(wb.x)] === 1;
  }
  // water bodies near a start that are not the sea a naval battle is fought on (a yard there traps its fleet)
  let ponds = 0;
  if (naval) {
    const lab = new Int32Array(N * N).fill(-1);
    const sizes: number[] = [];
    for (let i = 0; i < N * N; i++) {
      if (map.terrain[i] !== T.Water || lab[i] >= 0) continue;
      const id = sizes.length, q = [i];
      lab[i] = id;
      let n = 0;
      while (q.length) {
        const j = q.pop()!; n++;
        const x = j % N, y = (j / N) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
          const k = ny * N + nx;
          if (map.terrain[k] === T.Water && lab[k] < 0) { lab[k] = id; q.push(k); }
        }
      }
      sizes.push(n);
    }
    const main = sizes.indexOf(Math.max(...sizes));
    const near = new Set<number>();
    for (let i = 0; i < N * N; i++) if (lab[i] >= 0 && lab[i] !== main && sizes[lab[i]] >= 12) {
      if (distStarts(c, i % N + 0.5, ((i / N) | 0) + 0.5) < 18) near.add(lab[i]);
    }
    ponds = near.size;
  }
  let lm: RegionReport['landmark'] = null;
  if (c.landmark) {
    const l = c.landmark;
    const s0 = c.starts[0];
    const f = c.focus ?? { x: s0.x, y: s0.y + 1, dist: CAM.dist };
    const wide = landmarkShows(f.x, f.y, l.cx, l.cy, l.w, l.h, LANDMARK_HEIGHTS[l.id], ASPECT_WIDE, f.dist);
    const narrow = landmarkShows(f.x, f.y, l.cx, l.cy, l.w, l.h, LANDMARK_HEIGHTS[l.id], ASPECT_43, f.dist);
    const visible = wide >= SHOW_MIN && startInFrame(f, s0);
    lm = { id: l.id, visible, distance: Math.hypot(l.cx + l.w / 2 - s0.x, l.cy + l.h / 2 - s0.y), sealed: !paths, wide: +wide.toFixed(2), narrow: +narrow.toFixed(2), dist: f.dist };
  } else if (o.landmark) {
    lm = { id: o.landmark, visible: false, distance: -1, sealed: false };
  }
  return {
    ms: 0, size: N, features: c.feats, honoured: [], paths: islandSea ? true : paths, seaPath, ore: oreN, oreNear, room, landmark: lm,
    civilians: c.sites.length, bridges: map.bridges.length, repairs: c.repairs, dropped, ponds,
  };
}
