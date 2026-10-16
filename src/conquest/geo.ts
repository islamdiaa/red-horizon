/**
 * Conquest geography: a stylised Europe (same equirectangular projection as the campaign theatre map),
 * the pool of named regions a run draws its territories from, and the geometry helpers that turn a set of
 * sites into territories (Voronoi cells clipped to land), land borders and sea lanes.
 *
 * Pure data + maths: no DOM, deterministic, usable from node tests.
 */

export type Pt = [number, number];

/** Projection shared with the campaign theatre map (src/ui/campaign.ts): lon/lat -> map px. */
export const proj = (lon: number, lat: number): Pt => [(lon + 11) * 14.6, (72.5 - lat) * 15.6];
export const unproj = (x: number, y: number): Pt => [x / 14.6 - 11, 72.5 - y / 15.6];

/** Conquest viewport in projected px (Europe 1953: Atlantic to the Volga, Lapland to the Mediterranean). */
export const VIEW = { x: 0, y: 12, w: 852, h: 584 };

// The coastline below is the campaign theatre silhouette (kept in sync by hand; see src/ui/campaign.ts).
/** Main landmass: Europe + Asia Minor + Middle East + North Africa, traced clockwise from Gibraltar. */
export const LAND: Pt[] = [
  [-5.6, 36.0], [-2.0, 36.7], [0.2, 38.8], [-0.3, 39.5], [0.9, 41.0], [3.2, 41.9], [3.1, 43.1], [4.8, 43.4], [6.5, 43.1], [7.5, 43.8], [8.8, 44.4], [10.2, 43.9],
  [11.1, 42.4], [12.3, 41.7], [14.2, 40.8], [15.6, 40.0], [15.7, 38.2], [16.6, 38.9], [17.2, 39.4], [18.5, 40.1], [17.0, 41.0], [16.0, 41.6], [14.2, 42.4], [13.6, 43.5],
  [12.3, 44.6], [12.4, 45.4], [13.8, 45.7], [15.2, 44.3], [17.4, 43.0], [19.4, 41.9], [19.4, 40.4], [20.2, 39.6], [21.2, 37.8], [22.4, 36.5], [23.0, 37.9], [24.0, 38.2],
  [22.9, 40.6], [24.5, 40.9], [26.0, 40.8], [26.4, 40.1], [26.2, 39.2], [27.2, 37.9], [28.2, 36.7], [30.6, 36.8], [32.8, 36.1], [34.6, 36.8], [36.2, 36.6], [35.9, 35.4],
  [35.6, 33.9], [34.9, 32.5], [34.3, 31.3], [32.3, 31.3], [29.9, 31.2], [25.0, 31.6], [23.0, 32.6], [20.1, 32.1], [19.9, 30.5], [17.5, 31.0], [15.2, 32.4], [11.5, 33.1],
  [10.2, 34.3], [11.1, 36.8], [10.3, 37.3], [8.6, 36.9], [3.0, 36.8], [1.0, 36.5], [-2.2, 35.1], [-5.9, 35.8], [-6.8, 34.0], [-8.5, 32.8], [-9.8, 30.5], [-10.5, 27.0],
  [58.5, 27.0], [58.5, 72.8], [56.0, 70.6], [53.0, 68.3], [49.0, 68.0], [44.0, 66.2], [40.5, 64.5], [37.0, 64.2], [34.8, 64.5], [33.5, 66.4], [32.5, 67.1], [36.0, 66.5],
  [41.0, 66.9], [40.5, 67.9], [38.0, 68.4], [33.0, 69.4], [31.0, 69.8], [28.5, 70.4], [25.8, 71.1], [23.5, 70.6], [19.5, 70.0], [16.5, 68.8], [14.5, 68.0], [13.0, 66.5],
  [12.3, 65.0], [10.5, 64.0], [8.5, 63.3], [5.6, 62.3], [5.0, 61.0], [5.0, 59.6], [5.6, 58.9], [6.8, 58.1], [8.1, 58.1], [10.3, 59.0], [10.6, 59.8], [11.2, 59.1],
  [11.9, 58.0], [12.6, 56.2], [12.9, 55.4], [14.2, 55.4], [16.4, 56.3], [16.6, 57.8], [18.2, 59.3], [17.3, 60.6], [17.5, 62.4], [19.5, 63.6], [21.3, 64.6], [22.5, 65.8],
  [25.4, 65.0], [24.6, 64.2], [22.4, 63.4], [21.4, 61.5], [21.5, 60.5], [22.9, 59.9], [25.5, 60.3], [28.5, 60.6], [30.2, 59.9], [28.0, 59.5], [24.0, 59.4], [23.5, 58.6],
  [24.4, 57.3], [21.6, 57.4], [21.0, 56.1], [21.1, 55.2], [19.9, 54.4], [18.6, 54.4], [16.5, 54.5], [14.2, 53.9], [13.4, 54.4], [11.9, 54.2], [10.9, 54.0], [10.0, 54.8],
  [10.6, 55.6], [10.5, 57.6], [8.6, 57.1], [8.1, 56.0], [8.6, 55.0], [8.6, 53.9], [7.0, 53.5], [6.0, 53.4], [4.8, 53.0], [4.4, 52.2], [3.6, 51.5], [2.5, 51.1],
  [1.6, 50.9], [1.5, 50.2], [0.1, 49.5], [-1.3, 49.6], [-1.6, 48.6], [-3.0, 48.8], [-4.8, 48.4], [-4.3, 47.8], [-2.3, 47.2], [-1.2, 46.2], [-1.2, 45.0], [-1.5, 43.5],
  [-3.8, 43.4], [-7.0, 43.6], [-8.0, 43.7], [-9.3, 43.0], [-8.8, 42.0], [-8.7, 41.0], [-9.5, 38.7], [-8.9, 37.0], [-7.4, 37.2], [-6.3, 36.5],
];
export const ISLANDS: Pt[][] = [
  // Great Britain
  [[-5.7, 50.1], [-3.4, 50.6], [-1.0, 50.8], [1.4, 51.2], [1.7, 52.7], [0.3, 53.4], [-0.1, 54.5], [-1.6, 55.6], [-2.1, 57.0], [-1.8, 57.6], [-3.1, 58.6], [-5.0, 58.6],
    [-5.6, 57.6], [-6.2, 56.4], [-4.9, 55.6], [-5.1, 54.8], [-3.0, 54.0], [-3.1, 53.4], [-4.7, 52.8], [-4.1, 51.9], [-5.3, 51.7], [-3.2, 51.4], [-4.5, 51.1]],
  // Ireland
  [[-6.0, 52.2], [-6.2, 53.3], [-5.9, 54.6], [-7.5, 55.3], [-8.5, 54.4], [-10.0, 54.0], [-9.6, 52.6], [-10.3, 51.8], [-8.4, 51.6]],
  // Sicily, Sardinia, Corsica, Crete, Cyprus
  [[12.4, 37.9], [15.6, 38.2], [15.1, 36.7]],
  [[8.4, 41.0], [9.8, 41.0], [9.6, 39.1], [8.4, 38.9]],
  [[8.6, 42.9], [9.5, 42.9], [9.4, 41.4], [8.8, 41.6]],
  [[23.5, 35.6], [26.3, 35.2], [24.0, 34.9]],
  [[32.3, 35.1], [34.6, 35.6], [33.9, 34.6], [32.5, 34.7]],
  // Zealand
  [[11.0, 55.9], [12.6, 56.0], [12.2, 55.2], [11.2, 55.2]],
];
export const SEAS: Pt[][] = [
  // Black Sea
  [[28.0, 41.3], [27.5, 42.5], [28.6, 43.8], [29.7, 45.2], [30.7, 46.5], [33.0, 46.0], [32.5, 45.4], [33.5, 44.4], [35.5, 45.0], [36.6, 45.4], [37.5, 44.7], [39.7, 43.6], [41.5, 41.6], [39.7, 41.0], [36.3, 41.3], [33.4, 42.0], [31.0, 41.1]],
  // Caspian Sea
  [[47.0, 44.9], [47.9, 46.3], [49.2, 46.4], [51.3, 47.0], [53.0, 46.8], [53.2, 45.3], [51.4, 44.5], [51.3, 43.2], [52.7, 42.0], [53.0, 40.0], [53.9, 37.4], [51.5, 36.8], [49.8, 37.5], [48.9, 38.4], [49.5, 40.4], [48.4, 41.9], [47.5, 43.0]],
  // Persian Gulf
  [[48.0, 30.0], [50.2, 29.2], [51.4, 27.9], [54.0, 26.5], [56.3, 26.9], [56.6, 26.0], [52.0, 26.0], [49.5, 27.0]],
];

const projPoly = (pts: Pt[]): Pt[] => pts.map(([lo, la]) => proj(lo, la));
const LAND_PX = projPoly(LAND);
const ISLANDS_PX = ISLANDS.map(projPoly);
const SEAS_PX = SEAS.map(projPoly);

/** SVG path data for a list of lon/lat polygons. */
export function polyPath(pts: Pt[], projected = false): string {
  return pts.map((p, i) => { const [x, y] = projected ? p : proj(p[0], p[1]); return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`; }).join('') + 'Z';
}
export const LAND_D = [LAND, ...ISLANDS].map((p) => polyPath(p)).join('');
export const SEA_D = SEAS.map((p) => polyPath(p)).join('');

function inPoly(x: number, y: number, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Whether a projected point is on land (inside the mainland or an island, outside the inland seas). */
export function isLand(x: number, y: number): boolean {
  if (SEAS_PX.some((s) => inPoly(x, y, s))) return false;
  return inPoly(x, y, LAND_PX) || ISLANDS_PX.some((s) => inPoly(x, y, s));
}

// =====================================================================================================
// Region pool
// =====================================================================================================
export type Terrain = 'plains' | 'forest' | 'mountain' | 'lakes' | 'river' | 'coast' | 'urban' | 'steppe' | 'islands';
export type Climate = 'temperate' | 'winter' | 'desert';

export interface RegionDef {
  id: string;
  name: string;
  lon: number;
  lat: number;
  terrain: Terrain;
  /** Capital candidate for a side. */
  capital?: 'allies' | 'soviet';
  /** Always part of a run (capitals, a few anchors so the map keeps its shape). */
  core?: boolean;
  /** Possible neutral power (Switzerland, Sweden, Spain...). */
  neutral?: boolean;
}

/** Named regions of 1953 Europe. A run picks a well-spread subset of them. */
export const REGIONS: RegionDef[] = [
  // --- British Isles
  { id: 'london', name: 'London', lon: -0.4, lat: 51.6, terrain: 'urban', capital: 'allies', core: true },
  { id: 'midlands', name: 'Midlands', lon: -1.9, lat: 53.1, terrain: 'plains' },
  { id: 'highlands', name: 'Highlands', lon: -4.3, lat: 57.0, terrain: 'mountain' },
  { id: 'ireland', name: 'Ireland', lon: -7.8, lat: 53.2, terrain: 'plains', neutral: true },
  // --- France & the Low Countries
  { id: 'paris', name: 'Paris', lon: 2.35, lat: 48.85, terrain: 'urban', capital: 'allies', core: true },
  { id: 'normandy', name: 'Normandy', lon: -0.6, lat: 49.0, terrain: 'coast' },
  { id: 'brittany', name: 'Brittany', lon: -3.1, lat: 48.1, terrain: 'coast' },
  { id: 'flanders', name: 'Flanders', lon: 3.9, lat: 50.8, terrain: 'plains' },
  { id: 'holland', name: 'Holland', lon: 5.2, lat: 52.2, terrain: 'lakes' },
  { id: 'lorraine', name: 'Lorraine', lon: 6.2, lat: 48.7, terrain: 'forest' },
  { id: 'burgundy', name: 'Burgundy', lon: 4.6, lat: 47.0, terrain: 'plains' },
  { id: 'aquitaine', name: 'Aquitaine', lon: 0.2, lat: 44.9, terrain: 'forest' },
  { id: 'provence', name: 'Provence', lon: 5.4, lat: 43.8, terrain: 'coast' },
  // --- Iberia
  { id: 'pyrenees', name: 'Pyrenees', lon: 0.6, lat: 42.6, terrain: 'mountain' },
  { id: 'castile', name: 'Castile', lon: -3.7, lat: 40.6, terrain: 'steppe', neutral: true },
  { id: 'andalusia', name: 'Andalusia', lon: -4.8, lat: 37.6, terrain: 'plains' },
  { id: 'lisbon', name: 'Lisbon', lon: -8.4, lat: 39.4, terrain: 'coast' },
  { id: 'catalonia', name: 'Catalonia', lon: 1.6, lat: 41.7, terrain: 'coast' },
  { id: 'galicia-es', name: 'Asturias', lon: -6.2, lat: 42.9, terrain: 'mountain' },
  // --- Germany & the Alps
  { id: 'rhineland', name: 'Rhineland', lon: 7.2, lat: 50.4, terrain: 'river' },
  { id: 'ruhr', name: 'Ruhr', lon: 7.6, lat: 51.6, terrain: 'urban' },
  { id: 'hamburg', name: 'Hamburg', lon: 10.0, lat: 53.5, terrain: 'coast' },
  { id: 'berlin', name: 'Berlin', lon: 13.4, lat: 52.5, terrain: 'urban', core: true },
  { id: 'saxony', name: 'Saxony', lon: 12.9, lat: 51.0, terrain: 'plains' },
  { id: 'bavaria', name: 'Bavaria', lon: 11.4, lat: 48.3, terrain: 'forest' },
  { id: 'alps', name: 'Swiss Alps', lon: 8.0, lat: 46.6, terrain: 'mountain', neutral: true },
  { id: 'jutland', name: 'Jutland', lon: 9.2, lat: 56.0, terrain: 'coast' },
  // --- Italy
  { id: 'lombardy', name: 'Lombardy', lon: 9.6, lat: 45.4, terrain: 'river' },
  { id: 'rome', name: 'Rome', lon: 12.6, lat: 42.2, terrain: 'urban' },
  { id: 'naples', name: 'Naples', lon: 15.2, lat: 40.9, terrain: 'coast' },
  { id: 'sicily', name: 'Sicily', lon: 14.1, lat: 37.6, terrain: 'islands' },
  // --- Central & Eastern Europe
  { id: 'bohemia', name: 'Bohemia', lon: 14.6, lat: 49.9, terrain: 'forest' },
  { id: 'vienna', name: 'Vienna', lon: 16.2, lat: 48.0, terrain: 'river' },
  { id: 'silesia', name: 'Silesia', lon: 17.4, lat: 51.0, terrain: 'plains' },
  { id: 'pomerania', name: 'Danzig', lon: 18.4, lat: 54.0, terrain: 'coast' },
  { id: 'warsaw', name: 'Warsaw', lon: 21.0, lat: 52.2, terrain: 'plains', core: true },
  { id: 'krakow', name: 'Galicia', lon: 21.0, lat: 49.9, terrain: 'mountain' },
  { id: 'budapest', name: 'Budapest', lon: 19.2, lat: 47.3, terrain: 'river' },
  { id: 'carpathia', name: 'Carpathians', lon: 24.4, lat: 47.6, terrain: 'mountain' },
  { id: 'belgrade', name: 'Belgrade', lon: 20.6, lat: 44.6, terrain: 'river' },
  { id: 'dinaric', name: 'Dinaric Alps', lon: 17.6, lat: 43.9, terrain: 'mountain' },
  { id: 'sofia', name: 'Sofia', lon: 24.0, lat: 42.8, terrain: 'mountain' },
  { id: 'bucharest', name: 'Bucharest', lon: 26.2, lat: 44.6, terrain: 'plains' },
  { id: 'athens', name: 'Athens', lon: 22.6, lat: 38.6, terrain: 'coast' },
  { id: 'thrace', name: 'Thrace', lon: 27.6, lat: 41.4, terrain: 'coast' },
  // --- Scandinavia & the Baltic
  { id: 'oslo', name: 'Oslo', lon: 9.8, lat: 60.4, terrain: 'mountain' },
  { id: 'stockholm', name: 'Stockholm', lon: 16.6, lat: 59.6, terrain: 'forest', neutral: true },
  { id: 'lapland', name: 'Lapland', lon: 22.0, lat: 67.0, terrain: 'forest' },
  { id: 'finland', name: 'Finland', lon: 25.6, lat: 62.0, terrain: 'lakes' },
  { id: 'riga', name: 'Riga', lon: 24.8, lat: 56.8, terrain: 'forest' },
  { id: 'konigsberg', name: 'Königsberg', lon: 21.8, lat: 54.5, terrain: 'coast' },
  // --- Soviet Union
  { id: 'leningrad', name: 'Leningrad', lon: 30.6, lat: 59.6, terrain: 'urban' },
  { id: 'karelia', name: 'Karelia', lon: 33.0, lat: 63.0, terrain: 'lakes' },
  { id: 'murmansk', name: 'Murmansk', lon: 34.0, lat: 68.0, terrain: 'coast' },
  { id: 'archangel', name: 'Archangel', lon: 41.0, lat: 63.5, terrain: 'forest' },
  { id: 'minsk', name: 'Minsk', lon: 27.6, lat: 53.6, terrain: 'lakes' },
  { id: 'smolensk', name: 'Smolensk', lon: 32.2, lat: 54.8, terrain: 'forest' },
  { id: 'moscow', name: 'Moscow', lon: 37.6, lat: 55.75, terrain: 'urban', capital: 'soviet', core: true },
  { id: 'gorky', name: 'Gorky', lon: 43.6, lat: 56.4, terrain: 'river' },
  { id: 'kiev', name: 'Kiev', lon: 30.5, lat: 50.4, terrain: 'river', core: true },
  { id: 'lvov', name: 'Lvov', lon: 25.4, lat: 50.0, terrain: 'plains' },
  { id: 'kursk', name: 'Kursk', lon: 36.2, lat: 51.8, terrain: 'steppe' },
  { id: 'kharkov', name: 'Kharkov', lon: 36.6, lat: 49.6, terrain: 'urban' },
  { id: 'odessa', name: 'Odessa', lon: 30.2, lat: 46.9, terrain: 'coast' },
  { id: 'crimea', name: 'Crimea', lon: 34.2, lat: 45.2, terrain: 'coast' },
  { id: 'rostov', name: 'Rostov', lon: 39.8, lat: 47.4, terrain: 'steppe' },
  { id: 'stalingrad', name: 'Stalingrad', lon: 44.0, lat: 49.2, terrain: 'river' },
  { id: 'voronezh', name: 'Voronezh', lon: 40.0, lat: 51.9, terrain: 'steppe' },
  { id: 'caucasus', name: 'Caucasus', lon: 43.2, lat: 43.6, terrain: 'mountain' },
  { id: 'anatolia', name: 'Anatolia', lon: 32.0, lat: 39.4, terrain: 'steppe', neutral: true },
];

export const REGION_BY_ID: Record<string, RegionDef> = Object.fromEntries(REGIONS.map((r) => [r.id, r]));

// =====================================================================================================
// Geometry: a fine Voronoi mesh over the map, partitioned into territories by over-land distance
// =====================================================================================================
/**
 * A jittered grid of points with their Voronoi cells. Territories are unions of mesh cells, assigned by
 * geodesic (over-land) distance from each territory's site: borders follow natural, irregular cell edges,
 * never leak across the sea, and neighbouring territories share exactly the same edges (no slivers).
 */
export interface Mesh {
  n: number;
  spacing: number;
  px: Float64Array;
  py: Float64Array;
  /** Cell centre on land. */
  land: Uint8Array;
  /** Land a European territory may claim (not North Africa or the Levant). */
  claim: Uint8Array;
  /** Land cell with a water neighbour. */
  coast: Uint8Array;
  cells: Pt[][];
  /** Neighbour across each polygon edge of a cell (-1 = viewport boundary). */
  etag: number[][];
  /** Shared edges between neighbouring cells (i < j). */
  edges: { i: number; j: number; p: Pt; q: Pt; len: number }[];
  /** Neighbour lists: [cell, edge length] pairs. */
  nbr: [number, number][][];
}

type TagPt = { x: number; y: number; tag: number };

function clipTagged(poly: TagPt[], mx: number, my: number, nx: number, ny: number, tag: number): TagPt[] {
  const out: TagPt[] = [];
  const side = (p: TagPt) => (p.x - mx) * nx + (p.y - my) * ny;
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k], b = poly[(k + 1) % poly.length];
    const sa = side(a), sb = side(b);
    const ain = sa <= 0, bin = sb <= 0;
    if (ain) out.push(a);
    if (ain !== bin) {
      const t = sa / (sa - sb);
      const I = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, tag: ain ? tag : a.tag };
      out.push(I);
    }
  }
  return out;
}

const meshCache = new Map<string, Mesh>();

/** Build (or fetch from cache) the mesh for a seed. Deterministic. */
export function buildMesh(seed: number, spacing = 11): Mesh {
  const key = `${seed}:${spacing}`;
  const hit = meshCache.get(key);
  if (hit) return hit;
  const cols = Math.ceil(VIEW.w / spacing), rows = Math.ceil(VIEW.h / spacing);
  const n = cols * rows;
  const px = new Float64Array(n), py = new Float64Array(n);
  let s = (seed ^ 0x9e3779b9) >>> 0;
  const rnd = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  for (let gy = 0; gy < rows; gy++) for (let gx = 0; gx < cols; gx++) {
    const i = gy * cols + gx;
    px[i] = VIEW.x + (gx + 0.5 + (rnd() - 0.5) * 0.8) * spacing;
    py[i] = VIEW.y + (gy + 0.5 + (rnd() - 0.5) * 0.8) * spacing;
  }
  const land = new Uint8Array(n), claim = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    land[i] = isLand(px[i], py[i]) ? 1 : 0;
    const [lon, lat] = unproj(px[i], py[i]);
    const africa = (lon < -1.5 && lat < 35.95) || (lon >= -1.5 && lon <= 12 && lat < 37.5) || (lon > 34 && lat < 36.9);
    claim[i] = land[i] && !africa ? 1 : 0;
  }
  const x0 = VIEW.x, y0 = VIEW.y, x1 = VIEW.x + VIEW.w, y1 = VIEW.y + VIEW.h;
  const cells: Pt[][] = [];
  const etag: number[][] = [];
  const edges: Mesh['edges'] = [];
  const nbr: [number, number][][] = Array.from({ length: n }, () => []);
  for (let gy = 0; gy < rows; gy++) for (let gx = 0; gx < cols; gx++) {
    const i = gy * cols + gx;
    const r = spacing * 1.7;
    const bx0 = Math.max(x0, px[i] - r), by0 = Math.max(y0, py[i] - r), bx1 = Math.min(x1, px[i] + r), by1 = Math.min(y1, py[i] + r);
    let poly: TagPt[] = [{ x: bx0, y: by0, tag: -1 }, { x: bx1, y: by0, tag: -1 }, { x: bx1, y: by1, tag: -1 }, { x: bx0, y: by1, tag: -1 }];
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (!dx && !dy) continue;
      const ox = gx + dx, oy = gy + dy;
      if (ox < 0 || oy < 0 || ox >= cols || oy >= rows) continue;
      const j = oy * cols + ox;
      poly = clipTagged(poly, (px[i] + px[j]) / 2, (py[i] + py[j]) / 2, px[j] - px[i], py[j] - py[i], j);
      if (!poly.length) break;
    }
    cells.push(poly.map((p) => [p.x, p.y] as Pt));
    etag.push(poly.map((p) => p.tag));
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k], b = poly[(k + 1) % poly.length];
      const j = a.tag;
      if (j < 0) continue;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 1e-6) continue;
      nbr[i].push([j, len]);
      if (i < j) edges.push({ i, j, p: [a.x, a.y], q: [b.x, b.y], len });
    }
  }
  const coast = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (land[i] && nbr[i].some(([j]) => !land[j])) coast[i] = 1;
  const mesh: Mesh = { n, spacing, px, py, land, claim, coast, cells, etag, edges, nbr };
  meshCache.set(key, mesh);
  return mesh;
}

/** Nearest mesh cell to a point (optionally land only). */
export function cellAt(mesh: Mesh, x: number, y: number, landOnly = false): number {
  let best = -1, bd = Infinity;
  for (let i = 0; i < mesh.n; i++) {
    if (landOnly && !mesh.land[i]) continue;
    const d = (mesh.px[i] - x) ** 2 + (mesh.py[i] - y) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/** Dijkstra over the mesh from labelled sources, through cells accepted by `pass`, up to `cap` px. */
function grow(mesh: Mesh, label: Int16Array, dist: Float64Array, pass: (i: number) => boolean, cap: number) {
  // small binary heap of [dist, cell]
  const heap: [number, number][] = [];
  const push = (d: number, i: number) => {
    heap.push([d, i]);
    let k = heap.length - 1;
    while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] < heap[k][0] || (heap[p][0] === heap[k][0] && heap[p][1] <= heap[k][1])) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; }
  };
  const pop = (): [number, number] => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        const lt = (a: number, b: number) => heap[a][0] < heap[b][0] || (heap[a][0] === heap[b][0] && heap[a][1] < heap[b][1]);
        if (l < heap.length && lt(l, m)) m = l;
        if (r < heap.length && lt(r, m)) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top;
  };
  for (let i = 0; i < mesh.n; i++) if (label[i] >= 0) push(dist[i], i);
  while (heap.length) {
    const [d, i] = pop();
    if (d > dist[i]) continue;
    for (const [j] of mesh.nbr[i]) {
      if (!pass(j)) continue;
      const nd = d + Math.hypot(mesh.px[j] - mesh.px[i], mesh.py[j] - mesh.py[i]);
      if (nd > cap) continue;
      if (nd < dist[j] - 1e-9 || (Math.abs(nd - dist[j]) <= 1e-9 && label[i] < label[j])) {
        dist[j] = nd;
        label[j] = label[i];
        push(nd, j);
      }
    }
  }
}

export interface Partition {
  /** Territory index per land cell (-1 = unclaimed land or sea). */
  land: Int16Array;
  /** Territory index per cell for drawing (land plus a coastal fringe of sea, clipped to the coastline). */
  draw: Int16Array;
  /** Cell holding each site. */
  siteCell: number[];
}

/** Assign mesh cells to the sites by over-land distance (capped, so remote land stays unclaimed). */
export function partition(mesh: Mesh, sites: Pt[], cap = 175): Partition {
  const land = new Int16Array(mesh.n).fill(-1);
  const dist = new Float64Array(mesh.n).fill(Infinity);
  const siteCell = sites.map(([x, y]) => cellAt(mesh, x, y, true));
  siteCell.forEach((c, k) => { if (land[c] < 0) { land[c] = k; dist[c] = 0; } });
  grow(mesh, land, dist, (i) => mesh.claim[i] === 1, cap);
  const draw = land.slice();
  const d2 = new Float64Array(mesh.n).fill(Infinity);
  for (let i = 0; i < mesh.n; i++) if (draw[i] >= 0) d2[i] = 0;
  grow(mesh, draw, d2, (i) => mesh.land[i] === 0, mesh.spacing * 2.5);
  return { land, draw, siteCell };
}

/** Closed outline loops of the cells with `label[i] === k` (exact shared mesh edges). */
export function outlineLoops(mesh: Mesh, label: Int16Array, k: number): Pt[][] {
  const kf = (p: Pt) => `${Math.round(p[0] * 100)},${Math.round(p[1] * 100)}`;
  const next = new Map<string, { from: Pt; to: Pt }[]>();
  for (let i = 0; i < mesh.n; i++) {
    if (label[i] !== k) continue;
    const poly = mesh.cells[i];
    const tags = mesh.etag[i];
    for (let e = 0; e < poly.length; e++) {
      const a = poly[e], b = poly[(e + 1) % poly.length];
      // keep the edge unless the cell across it has the same label
      const j = tags[e];
      if (j >= 0 && label[j] === k) continue;
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-6) continue;
      const ka = kf(a);
      const list = next.get(ka) ?? [];
      list.push({ from: a, to: b });
      next.set(ka, list);
    }
  }
  const loops: Pt[][] = [];
  for (const [start, list] of next) {
    while (list.length) {
      const first = list.pop()!;
      const loop: Pt[] = [first.from];
      let cur = first.to;
      for (let guard = 0; guard < 100000; guard++) {
        const ck = kf(cur);
        if (ck === start) break;
        loop.push(cur);
        let cand = next.get(ck);
        if (!cand || !cand.length) {
          // rounding can split a vertex shared by two cells: look one notch around it
          const [cx, cy] = ck.split(',').map(Number);
          for (let dx = -1; dx <= 1 && (!cand || !cand.length); dx++) for (let dy = -1; dy <= 1; dy++) {
            const alt = next.get(`${cx + dx},${cy + dy}`);
            if (alt && alt.length) { cand = alt; break; }
          }
        }
        if (!cand || !cand.length) break;
        cur = cand.pop()!.to;
      }
      if (loop.length >= 3) loops.push(loop);
    }
  }
  return loops;
}

/** SVG path data of a territory (outline loops). */
export function territoryPath(mesh: Mesh, label: Int16Array, k: number): string {
  return outlineLoops(mesh, label, k).map((l) => polyPath(l, true)).join('');
}

/** Mesh edges separating two different territories (for border / front-line drawing). */
export function borderEdges(mesh: Mesh, label: Int16Array): { a: number; b: number; p: Pt; q: Pt }[] {
  const out: { a: number; b: number; p: Pt; q: Pt }[] = [];
  for (const e of mesh.edges) {
    const a = label[e.i], b = label[e.j];
    if (a < 0 || b < 0 || a === b) continue;
    out.push({ a: Math.min(a, b), b: Math.max(a, b), p: e.p, q: e.q });
  }
  return out;
}

/** Land border length between every pair of territories. */
export function landBorders(mesh: Mesh, part: Partition): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of mesh.edges) {
    const a = part.land[e.i], b = part.land[e.j];
    if (a < 0 || b < 0 || a === b) continue;
    const k = a < b ? `${a}:${b}` : `${b}:${a}`;
    out.set(k, (out.get(k) ?? 0) + e.len);
  }
  return out;
}

/** Shortest sea route (px) between every pair of coastal territories, up to `cap`. */
export function seaRoutes(mesh: Mesh, part: Partition, cap = 150): Map<string, number> {
  const label = new Int16Array(mesh.n).fill(-1);
  const dist = new Float64Array(mesh.n).fill(Infinity);
  for (let i = 0; i < mesh.n; i++) if (mesh.coast[i] && part.land[i] >= 0) { label[i] = part.land[i]; dist[i] = 0; }
  grow(mesh, label, dist, (i) => mesh.land[i] === 0, cap);
  const out = new Map<string, number>();
  for (const e of mesh.edges) {
    const a = label[e.i], b = label[e.j];
    if (a < 0 || b < 0 || a === b) continue;
    // a meeting point in the water (or a water cell touching the other side's coast)
    if (mesh.land[e.i] && mesh.land[e.j]) continue;
    const d = dist[e.i] + dist[e.j] + Math.hypot(mesh.px[e.i] - mesh.px[e.j], mesh.py[e.i] - mesh.py[e.j]);
    const k = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (d < (out.get(k) ?? Infinity)) out.set(k, d);
  }
  return out;
}

/** Coastal land cells per territory. */
export function coastCells(mesh: Mesh, part: Partition, k: number): number {
  let n = 0;
  for (let i = 0; i < mesh.n; i++) if (mesh.coast[i] && part.land[i] === k) n++;
  return n;
}
