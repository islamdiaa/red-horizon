/**
 * World Conquest geography: the land outline (Natural Earth 1:110m land and lakes, data/land110.ts), `isLand`,
 * sphere projection helpers, and the territories of a run: cells around the region sites, clipped to land, with their
 * outlines, label anchors, land borders and sea lanes.
 *
 * Cells. Every territory is its site's spherical Voronoi cell (nearest site by great-circle distance), except that a
 * cell only spreads over land connected to its own site: the cells are grown from the sites over an equirectangular
 * raster (0.25°), in order of exact great-circle distance, so inland borders are the exact bisectors while no cell
 * jumps a sea (London does not get Calais, Iceland does not get east Greenland). Islands without a site join the
 * territory nearest across at most ISLAND_HOP_KM of sea; Antarctica and remote islets belong to nobody.
 *
 * Pure and deterministic (no DOM, no Math.random, portable sin/cos from net/dmath): the same region list gives the
 * same cells, links and outlines on every machine, in node tests too.
 */
import { datan2, dcos, dsin } from '../../net/dmath';
import { Rng } from '../../core/rng';
import { LAND_110, LAND_HOLES } from './data/land110';
import { HOMELAND_BY_ID, REGION_BY_ID, WORLD_REGIONS, WORLD_ZONES, zoneBonus } from './regions';

/** [longitude, latitude] in degrees. */
export type LonLat = [number, number];

export const EARTH_KM = 6371;
const DEG = Math.PI / 180;

// =====================================================================================================
// Land outline
// =====================================================================================================
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
export interface LandRing { ring: LonLat[]; hole: boolean }
let RINGS: LandRing[] | null = null;

/**
 * The world's land outline: Natural Earth 1:110m rings ([lon, lat], not closed: the last point joins the first).
 * Holes are water inside land (the Caspian Sea and 24 lakes: the Great Lakes, Victoria, Baikal...): fill even-odd.
 */
export function landRings(): readonly LandRing[] {
  if (RINGS) return RINGS;
  const val = new Map([...B64].map((c, i) => [c, i]));
  const holes = new Set(LAND_HOLES);
  RINGS = LAND_110.split('.').map((s, ri) => {
    const nums: number[] = [];
    let z = 0, mul = 1;
    for (const ch of s) {
      const c = val.get(ch)!;
      z += (c & 31) * mul;
      if (c & 32) { mul *= 32; continue; }
      nums.push(z % 2 ? -(z + 1) / 2 : z / 2);
      z = 0; mul = 1;
    }
    const ring: LonLat[] = [];
    let x = 0, y = 0;
    for (let i = 0; i + 1 < nums.length; i += 2) { x += nums[i]; y += nums[i + 1]; ring.push([x / 100, y / 100]); }
    return { ring, hole: holes.has(ri) };
  });
  return RINGS;
}

/** Ring edges bucketed by 1° latitude bands (x1, y1, x2, y2, ring), for point-in-polygon and scanline fills. */
let BANDS: Float64Array[] | null = null;
function bands(): Float64Array[] {
  if (BANDS) return BANDS;
  const lists: number[][] = Array.from({ length: 180 }, () => []);
  landRings().forEach(({ ring }, ri) => {
    for (let i = 0; i < ring.length; i++) {
      const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length];
      if (y1 === y2) continue;
      const b0 = Math.max(0, Math.floor(Math.min(y1, y2) + 90)), b1 = Math.min(179, Math.floor(Math.max(y1, y2) + 90));
      for (let b = b0; b <= b1; b++) lists[b].push(x1, y1, x2, y2, ri);
    }
  });
  BANDS = lists.map((l) => Float64Array.from(l));
  return BANDS;
}

/** Where the outline crosses a parallel: [longitude, ring] pairs sorted by longitude (land lies between pairs). */
function crossings(lat: number): [number, number][] {
  const e = bands()[Math.min(179, Math.max(0, Math.floor(lat + 90)))];
  const xs: [number, number][] = [];
  for (let i = 0; i < e.length; i += 5) {
    const y1 = e[i + 1], y2 = e[i + 3];
    if ((y1 > lat) === (y2 > lat)) continue;
    const x1 = e[i], x2 = e[i + 2];
    xs.push([x1 + ((lat - y1) * (x2 - x1)) / (y2 - y1), e[i + 4]]);
  }
  return xs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

/** The ring a hole ring lies in (the Caspian in Eurasia), so land around a hole counts as that ring. */
let PARENT: number[] | null = null;
function ringParents(): number[] {
  if (PARENT) return PARENT;
  const rings = landRings();
  PARENT = rings.map(({ ring, hole }, ri) => {
    if (!hole) return ri;
    const [x, y] = ring[0];
    for (let rj = 0; rj < rings.length; rj++) {
      if (rj === ri || rings[rj].hole) continue;
      const r = rings[rj].ring;
      let inside = false;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        if ((r[i][1] > y) !== (r[j][1] > y) && x < ((r[j][0] - r[i][0]) * (y - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) inside = !inside;
      }
      if (inside) return rj;
    }
    return ri;
  });
  return PARENT;
}

/** Whether a point is on land (Natural Earth 110m; the Caspian Sea and the big lakes are water). */
export function isLand(lon: number, lat: number): boolean {
  if (!(lat > -90 && lat < 90)) return lat <= -90; // the South Pole is under Antarctica
  lon = ((((lon + 180) % 360) + 360) % 360) - 180;
  let inside = false;
  for (const [x] of crossings(lat)) if (x > lon) inside = !inside;
  return inside;
}

// =====================================================================================================
// Sphere helpers (rendering and UI; generation below uses the portable dsin/dcos)
// =====================================================================================================
/** Unit-sphere (or radius r) position, three.js convention: y up, (lon 0, lat 0) at +z, 90°E at +x. */
export function toVec3(lon: number, lat: number, r = 1): [number, number, number] {
  const la = lat * DEG, lo = lon * DEG, c = Math.cos(la);
  return [r * c * Math.sin(lo), r * Math.sin(la), r * c * Math.cos(lo)];
}
/** Inverse of toVec3 (any radius). */
export function fromVec3(x: number, y: number, z: number): LonLat {
  const r = Math.hypot(x, y, z) || 1;
  return [Math.atan2(x, z) / DEG, Math.asin(Math.max(-1, Math.min(1, y / r))) / DEG];
}
/** Great-circle distance in km. */
export function distanceKm(a: LonLat, b: LonLat): number {
  const [x1, y1, z1] = toVec3(a[0], a[1]), [x2, y2, z2] = toVec3(b[0], b[1]);
  return EARTH_KM * Math.atan2(Math.hypot(y1 * z2 - z1 * y2, z1 * x2 - x1 * z2, x1 * y2 - y1 * x2), x1 * x2 + y1 * y2 + z1 * z2);
}
/** `n` + 1 points along the great circle from a to b (longitudes continuous: they may leave [-180, 180]). */
export function greatCircle(a: LonLat, b: LonLat, n = 24): LonLat[] {
  const p = toVec3(a[0], a[1]), q = toVec3(b[0], b[1]);
  const dot = Math.max(-1, Math.min(1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2]));
  const om = Math.acos(dot), so = Math.sin(om);
  const out: LonLat[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const ka = so < 1e-9 ? 1 - t : Math.sin((1 - t) * om) / so, kb = so < 1e-9 ? t : Math.sin(t * om) / so;
    const ll = fromVec3(p[0] * ka + q[0] * kb, p[1] * ka + q[1] * kb, p[2] * ka + q[2] * kb);
    if (out.length) ll[0] = unwrapLon(ll[0], out[out.length - 1][0]);
    out.push(ll);
  }
  return out;
}
const unwrapLon = (lon: number, ref: number) => lon + 360 * Math.round((ref - lon) / 360);
/** distanceKm with portable maths, for decisions that must come out the same on every engine. */
function ddist(a: LonLat, b: LonLat): number {
  const v = (lon: number, lat: number) => { const c = dcos(lat * DEG); return [c * dsin(lon * DEG), dsin(lat * DEG), c * dcos(lon * DEG)]; };
  const [x1, y1, z1] = v(a[0], a[1]), [x2, y2, z2] = v(b[0], b[1]);
  const cx = y1 * z2 - z1 * y2, cy = z1 * x2 - x1 * z2, cz = x1 * y2 - y1 * x2;
  return EARTH_KM * datan2(Math.sqrt(cx * cx + cy * cy + cz * cz), x1 * x2 + y1 * y2 + z1 * z2);
}

// =====================================================================================================
// Raster
// =====================================================================================================
/** Raster resolution: 0.25° equirectangular, row 0 at the North Pole, column 0 at 180°W. */
export const RASTER_W = 1440, RASTER_H = 720;
const STEP = 360 / RASTER_W;
const W = RASTER_W, H = RASTER_H, N = W * H;
/** Islands with no site of their own join the nearest territory across at most this much sea. */
export const ISLAND_HOP_KM = 560;
/** Land cells below this latitude are never claimed (Antarctica). */
const SOUTH_LIMIT = -60;
/** Pack ice: neither island hops nor sea lanes cross the sea beyond this latitude. */
const ICE_LAT = 76;
const ICE_ROW = Math.floor((90 - ICE_LAT) / STEP);

interface Grid {
  land: Uint8Array;
  /** Natural Earth ring (landmass) of each land pixel: cells only spread within their own landmass. */
  ring: Int16Array;
  /**
   * Steps between neighbouring land pixels that cross water (a strait narrower than a pixel): bit (dy + 1) * 3 + dx + 1
   * of the pixel the step starts from. Cells never spread across them; a border across one is a strait.
   */
  water: Uint16Array;
  sinLat: Float64Array; cosLat: Float64Array; sinLon: Float64Array; cosLon: Float64Array;
  /** km per step east (per row), north, diagonal (per row). */
  dx: Float64Array; dy: number; dd: Float64Array;
  /** Area of one pixel per row, km². */
  area: Float64Array;
}
let GRID: Grid | null = null;
function grid(): Grid {
  if (GRID) return GRID;
  const land = new Uint8Array(N);
  const ring = new Int16Array(N).fill(-1);
  const parent = ringParents();
  const sinLat = new Float64Array(H), cosLat = new Float64Array(H), sinLon = new Float64Array(W), cosLon = new Float64Array(W);
  const dx = new Float64Array(H), dd = new Float64Array(H), area = new Float64Array(H);
  const dy = EARTH_KM * STEP * DEG;
  for (let y = 0; y < H; y++) {
    const lat = 90 - (y + 0.5) * STEP;
    sinLat[y] = dsin(lat * DEG); cosLat[y] = dcos(lat * DEG);
    dx[y] = dy * cosLat[y]; dd[y] = Math.sqrt(dx[y] * dx[y] + dy * dy); area[y] = dx[y] * dy;
    const xs = crossings(lat);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      // pixel centres lon_c = -180 + (x + 0.5) * STEP with xs[k] <= lon_c < xs[k + 1]; the crossing that opens the
      // span names its ring (a hole's far shore names the ring around the hole)
      const x0 = Math.max(0, Math.ceil((xs[k][0] + 180) / STEP - 0.5)), x1 = Math.min(W - 1, Math.ceil((xs[k + 1][0] + 180) / STEP - 0.5) - 1);
      const ri = parent[xs[k][1]];
      for (let x = x0; x <= x1; x++) { land[y * W + x] = 1; ring[y * W + x] = ri; }
    }
  }
  for (let x = 0; x < W; x++) { const lon = -180 + (x + 0.5) * STEP; sinLon[x] = dsin(lon * DEG); cosLon[x] = dcos(lon * DEG); }
  // straits narrower than a pixel: test the steps between coastline cells
  const water = new Uint16Array(N);
  const coastCell = new Uint8Array(N);
  for (const { ring: r } of landRings()) {
    for (let i = 0; i < r.length; i++) {
      const [x1, y1] = r[i], [x2, y2] = r[(i + 1) % r.length];
      const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / (STEP / 3)));
      for (let k = 0; k <= n; k++) coastCell[pixelOf(x1 + ((x2 - x1) * k) / n, y1 + ((y2 - y1) * k) / n)] = 1;
    }
  }
  for (let p = 0; p < N; p++) {
    if (!coastCell[p] || !land[p]) continue;
    const y = (p / W) | 0, x = p - y * W;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if ((!dx && !dy) || y + dy < 0 || y + dy >= H) continue;
      const q = (y + dy) * W + ((x + dx + W) % W);
      if (land[q] && crossesCoast(lonOf(x), latOf(y), lonOf(x) + dx * STEP, latOf(y + dy))) water[p] |= 1 << ((dy + 1) * 3 + dx + 1);
    }
  }
  GRID = { land, ring, water, sinLat, cosLat, sinLon, cosLon, dx, dy, dd, area };
  return GRID;
}

/** Whether the straight segment between two nearby points crosses the coastline (water in between). */
function crossesCoast(ax: number, ay: number, bx: number, by: number): boolean {
  if (Math.abs(ax - bx) > 180) return false;
  const B = bands();
  const b0 = Math.max(0, Math.floor(Math.min(ay, by) + 90)), b1 = Math.min(179, Math.floor(Math.max(ay, by) + 90));
  const orient = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) => (qx - px) * (ry - py) - (qy - py) * (rx - px);
  for (let b = b0; b <= b1; b++) {
    const e = B[b];
    for (let i = 0; i < e.length; i += 5) {
      const x1 = e[i], y1 = e[i + 1], x2 = e[i + 2], y2 = e[i + 3];
      if (Math.max(x1, x2) < Math.min(ax, bx) || Math.min(x1, x2) > Math.max(ax, bx)) continue;
      const d1 = orient(ax, ay, bx, by, x1, y1), d2 = orient(ax, ay, bx, by, x2, y2);
      if ((d1 > 0) === (d2 > 0)) continue;
      const d3 = orient(x1, y1, x2, y2, ax, ay), d4 = orient(x1, y1, x2, y2, bx, by);
      if ((d3 > 0) !== (d4 > 0)) return true;
    }
  }
  return false;
}

const pixelOf = (lon: number, lat: number): number => {
  const x = ((Math.floor((lon + 180) / STEP) % W) + W) % W;
  const y = Math.min(H - 1, Math.max(0, Math.floor((90 - lat) / STEP)));
  return y * W + x;
};
const lonOf = (x: number) => -180 + (x + 0.5) * STEP;
const latOf = (y: number) => 90 - (y + 0.5) * STEP;
/** Whether the step between neighbouring pixels p and q crosses water (see Grid.water). */
const wet = (g: Grid, p: number, q: number): boolean => {
  const yp = (p / W) | 0, yq = (q / W) | 0;
  let dx = (q - yq * W) - (p - yp * W);
  if (dx > 1) dx -= W; else if (dx < -1) dx += W;
  return (g.water[p] & (1 << ((yq - yp + 1) * 3 + dx + 1))) !== 0;
};

/** Min-heap of (key, item), ties by item: deterministic. */
class Heap {
  k = new Float64Array(1 << 16); v = new Int32Array(1 << 16); n = 0;
  push(key: number, item: number) {
    if (this.n === this.k.length) {
      const k = new Float64Array(this.n * 2), v = new Int32Array(this.n * 2);
      k.set(this.k); v.set(this.v); this.k = k; this.v = v;
    }
    let i = this.n++;
    const K = this.k, V = this.v;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (K[p] < key || (K[p] === key && V[p] <= item)) break;
      K[i] = K[p]; V[i] = V[p]; i = p;
    }
    K[i] = key; V[i] = item;
  }
  /** Pops the smallest; its key is left in `top`. */
  top = 0;
  pop(): number {
    const K = this.k, V = this.v;
    const item = V[0]; this.top = K[0];
    const n = --this.n;
    if (n > 0) {
      const key = K[n], it = V[n];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const m = r < n && (K[r] < K[l] || (K[r] === K[l] && V[r] < V[l])) ? r : l;
        if (K[m] > key || (K[m] === key && V[m] >= it)) break;
        K[i] = K[m]; V[i] = V[m]; i = m;
      }
      K[i] = key; V[i] = it;
    }
    return item;
  }
}

/** The 8 neighbours of pixel p (wrapping east-west), with their step lengths, into the given buffers. */
function neighbours8(g: Grid, p: number, out: Int32Array, len: Float64Array): number {
  const y = (p / W) | 0, x = p - y * W;
  const xl = x === 0 ? W - 1 : x - 1, xr = x === W - 1 ? 0 : x + 1;
  let n = 0;
  out[n] = y * W + xl; len[n++] = g.dx[y];
  out[n] = y * W + xr; len[n++] = g.dx[y];
  if (y > 0) {
    const r = (y - 1) * W, d = (g.dd[y] + g.dd[y - 1]) / 2;
    out[n] = r + x; len[n++] = g.dy;
    out[n] = r + xl; len[n++] = d;
    out[n] = r + xr; len[n++] = d;
  }
  if (y < H - 1) {
    const r = (y + 1) * W, d = (g.dd[y] + g.dd[y + 1]) / 2;
    out[n] = r + x; len[n++] = g.dy;
    out[n] = r + xl; len[n++] = d;
    out[n] = r + xr; len[n++] = d;
  }
  return n;
}
const isSeaNext4 = (land: Uint8Array, p: number): boolean => {
  const y = (p / W) | 0, x = p - y * W;
  return !land[y * W + (x === 0 ? W - 1 : x - 1)] || !land[y * W + (x === W - 1 ? 0 : x + 1)]
    || (y > 0 && !land[p - W]) || (y < H - 1 && !land[p + W]);
};

// =====================================================================================================
// Partition: territories of a set of sites
// =====================================================================================================
interface SeaCandidate { d: number; p: number; q: number }
interface Partition {
  ids: string[];
  /** Territory index per pixel, -1 sea, -2 land nobody holds. */
  label: Int16Array;
  sitePx: number[];
  /** Shortest sea crossing between two territories' coasts (key a * 4096 + b, a < b) and where the fronts met. */
  sea: Map<number, SeaCandidate>;
  seaPrev: Int32Array;
  /** Land border length between two territories, km (same keys). */
  border: Map<number, number>;
  links: WorldLink[];
}
const pairKey = (a: number, b: number) => (a < b ? a * 4096 + b : b * 4096 + a);
/** Sea lanes are searched up to this far from a coast. */
const LANE_SEARCH_KM = 1400;
/** Two territories touching along less than this are not land neighbours. */
const MIN_BORDER_KM = 30;
/** The crossing length given to straits closed at the raster's resolution. */
const STRAIT_CONTACT_KM = 10;

/** Classic long crossings (Risk's), added when both ends are on the map: they tie the continents together. */
export const LONG_LANES: readonly [string, string][] = [
  ['alaska', 'kamchatka'], ['dakar', 'recife'], ['iceland', 'scotland'], ['iceland', 'oslo'], ['greenland', 'quebec'],
  ['hawaii', 'san-francisco'], ['hawaii', 'tokyo'], ['new-zealand', 'sydney'], ['perth', 'java'], ['cairo', 'athens'],
];

const partCache = new Map<string, Partition>();

function partitionOf(ids: readonly string[]): Partition {
  const key = ids.join(',');
  const hit = partCache.get(key);
  if (hit) return hit;
  const g = grid();
  const { land, ring } = g;
  const n = ids.length;
  const sx = new Float64Array(n), sy = new Float64Array(n), sz = new Float64Array(n);
  const sites = ids.map((id) => {
    const r = REGION_BY_ID[id];
    if (!r) throw new Error(`unknown region ${id}`);
    return r;
  });
  sites.forEach((r, k) => {
    const la = r.lat * DEG, lo = r.lon * DEG, c = dcos(la);
    sx[k] = c * dsin(lo); sy[k] = dsin(la); sz[k] = c * dcos(lo);
  });
  const claim = (p: number) => land[p] === 1 && ((p / W) | 0) < (90 - SOUTH_LIMIT) / STEP;
  const keyOf = (p: number, k: number) => {
    const y = (p / W) | 0, x = p - y * W;
    const c = g.cosLat[y];
    return 1 - (sx[k] * c * g.sinLon[x] + sy[k] * g.sinLat[y] + sz[k] * c * g.cosLon[x]);
  };
  // ---- the site pixels (the nearest claimable pixel when the site's own pixel is sea at this resolution)
  const sitePx = sites.map((r, k) => {
    const p0 = pixelOf(r.lon, r.lat);
    if (claim(p0)) return p0;
    const y0 = (p0 / W) | 0, x0 = p0 - y0 * W;
    let best = -1, bk = Infinity;
    for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
      const y = y0 + dy;
      if (y < 0 || y >= H) continue;
      const p = y * W + ((x0 + dx + W) % W);
      if (!claim(p)) continue;
      const kk = keyOf(p, k);
      if (kk < bk || (kk === bk && p < best)) { bk = kk; best = p; }
    }
    if (best < 0) throw new Error(`region ${r.id} is not on land`);
    return best;
  });

  // ---- phase 1: grow every site over its own land, in order of exact distance to the site
  const label = new Int16Array(N).fill(-1);
  const best = new Float64Array(N).fill(Infinity);
  const done = new Uint8Array(N);
  const heap = new Heap();
  const nb = new Int32Array(8), nl = new Float64Array(8), nb2 = new Int32Array(8), nl2 = new Float64Array(8);
  sitePx.forEach((p, k) => { if (best[p] > 0) { best[p] = 0; label[p] = k; heap.push(0, p); } });
  while (heap.n) {
    const p = heap.pop();
    if (done[p] || heap.top > best[p]) continue;
    done[p] = 1;
    const k = label[p];
    const m = neighbours8(g, p, nb, nl);
    for (let i = 0; i < m; i++) {
      const q = nb[i];
      if (done[q] || !claim(q) || ring[q] !== ring[p] || wet(g, p, q)) continue;
      const kk = keyOf(q, k);
      if (kk < best[q] || (kk === best[q] && k < label[q])) { best[q] = kk; label[q] = k; heap.push(kk, q); }
    }
  }
  // ---- phase 2: landmasses without a site join the nearest territory across the sea, each one whole (and chains
  // of islands too: an island taken passes the claim on)
  const dist = new Float64Array(N).fill(Infinity);
  const run = new Float64Array(N);
  const lab2 = new Int16Array(N).fill(-1);
  const open = (p: number) => { const m = neighbours8(g, p, nb, nl); for (let i = 0; i < m; i++) if (!land[nb[i]] || label[nb[i]] < 0) return true; return false; };
  for (let p = 0; p < N; p++) if (label[p] >= 0 && open(p)) { dist[p] = 0; lab2[p] = label[p]; heap.push(0, p); }
  const comp: number[] = [];
  while (heap.n) {
    const p = heap.pop();
    if (heap.top > dist[p]) continue;
    const m = neighbours8(g, p, nb, nl);
    for (let i = 0; i < m; i++) {
      const q = nb[i];
      if (label[q] >= 0) continue;
      const nd = dist[p] + nl[i];
      if (land[q]) {
        if (!claim(q)) continue;
        // the first front to touch an unclaimed landmass takes all of it
        const k = lab2[p], rq = ring[q];
        comp.length = 0; comp.push(q); label[q] = k;
        for (let c = 0; c < comp.length; c++) {
          const mm = neighbours8(g, comp[c], nb2, nl2);
          for (let j = 0; j < mm; j++) { const u = nb2[j]; if (label[u] < 0 && land[u] && ring[u] === rq && claim(u) && !wet(g, comp[c], u)) { label[u] = k; comp.push(u); } }
        }
        for (const u of comp) { dist[u] = nd; run[u] = 0; lab2[u] = k; heap.push(nd, u); }
        continue;
      }
      const y = (q / W) | 0;
      if (y < ICE_ROW) continue;
      const r = run[p] + nl[i];
      if (r > ISLAND_HOP_KM) continue;
      if (nd < dist[q] || (nd === dist[q] && lab2[p] < lab2[q])) { dist[q] = nd; run[q] = r; lab2[q] = lab2[p]; heap.push(nd, q); }
    }
  }
  for (let p = 0; p < N; p++) if (land[p] && label[p] < 0) label[p] = -2;

  // ---- land borders (pixel edges between two territories on the same landmass); where two landmasses touch at
  // this resolution (Sakhalin and Hokkaido, Zealand and Scania) it is a strait: a sea crossing of STRAIT_CONTACT_KM
  const border = new Map<number, number>();
  const contact = new Map<number, SeaCandidate>();
  const touch = (p: number, q: number, len: number) => {
    const a = label[p], b = label[q];
    if (a < 0 || b < 0 || a === b) return;
    const kk = pairKey(a, b);
    if (ring[p] === ring[q] && !wet(g, p, q)) border.set(kk, (border.get(kk) ?? 0) + len);
    else if (!contact.has(kk)) contact.set(kk, { d: STRAIT_CONTACT_KM, p, q: -1 - q });
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x;
    if (label[p] < 0) continue;
    touch(p, y * W + (x === W - 1 ? 0 : x + 1), g.dy);
    if (y < H - 1) touch(p, p + W, (g.dx[y] + g.dx[y + 1]) / 2);
  }

  // ---- sea crossings: fronts from every coast through the sea; where two territories' fronts meet
  dist.fill(Infinity);
  const slab = new Int16Array(N).fill(-1);
  const prev = new Int32Array(N).fill(-1);
  for (let p = 0; p < N; p++) if (label[p] >= 0 && isSeaNext4(land, p)) { dist[p] = 0; slab[p] = label[p]; heap.push(0, p); }
  while (heap.n) {
    const p = heap.pop();
    if (heap.top > dist[p]) continue;
    const m = neighbours8(g, p, nb, nl);
    for (let i = 0; i < m; i++) {
      const q = nb[i];
      if (land[q] || q < ICE_ROW * W) continue;
      const nd = dist[p] + nl[i];
      if (nd > LANE_SEARCH_KM) continue;
      if (nd < dist[q] || (nd === dist[q] && slab[p] < slab[q])) { dist[q] = nd; slab[q] = slab[p]; prev[q] = p; heap.push(nd, q); }
    }
  }
  const sea = new Map<number, SeaCandidate>();
  for (let p = 0; p < N; p++) {
    const a = slab[p];
    if (a < 0 || land[p]) continue;
    const m = neighbours8(g, p, nb, nl);
    for (let i = 0; i < m; i++) {
      const q = nb[i], b = land[q] ? label[q] : slab[q];
      if (b < 0 || b === a || (land[q] && !isSeaNext4(land, q))) continue;
      const d = dist[p] + nl[i] + (land[q] ? 0 : dist[q]);
      const kk = pairKey(a, b);
      const cur = sea.get(kk);
      if (!cur || d < cur.d || (d === cur.d && p < cur.p)) sea.set(kk, { d, p, q });
    }
  }

  for (const [kk, c] of contact) { const cur = sea.get(kk); if (!cur || c.d < cur.d) sea.set(kk, c); }
  const part: Partition = { ids: [...ids], label, sitePx, sea, seaPrev: prev, border, links: [] };
  part.links = chooseLinks(part, [...ids.keys()]);
  partCache.set(key, part);
  if (partCache.size > 3) partCache.delete(partCache.keys().next().value!); // ~8 MB each: keep a few
  return part;
}

/** A link of the territory graph. */
export interface WorldLink {
  a: string;
  b: string;
  /** A sea lane (needs a port at one end in the rules) rather than a land border. */
  sea: boolean;
  /** Land: border length; sea: the crossing, coast to coast. */
  km: number;
  /** One of the classic long crossings (LONG_LANES) or a connector added to tie the map together. */
  long?: boolean;
  /** Sea lanes: the route, coast to coast ([lon, lat], longitudes continuous). */
  path?: LonLat[];
}

/** Graph distance from `from` over `links`, up to `cap` hops. */
function hops(adj: Map<number, Set<number>>, from: number, to: number, cap: number): number {
  if (from === to) return 0;
  let front = [from];
  const seen = new Set(front);
  for (let d = 1; d <= cap; d++) {
    const next: number[] = [];
    for (const u of front) for (const v of adj.get(u) ?? []) {
      if (v === to) return d;
      if (!seen.has(v)) { seen.add(v); next.push(v); }
    }
    front = next;
  }
  return Infinity;
}

/** Sea lanes within this are always links (straits, short crossings); longer ones up to SHORT_SEA_KM only where the graph needs them. */
const STRAIT_KM = 250;
const SHORT_SEA_KM = 700;
const MAX_AUTO_LANES = 4;

/** Links among the territories `members` (indices into part.ids): land borders, sea lanes, long crossings, connectors. */
function chooseLinks(part: Partition, members: number[]): WorldLink[] {
  const inSet = new Set(members);
  const adj = new Map<number, Set<number>>();
  const links: WorldLink[] = [];
  const has = new Set<number>();
  const add = (a: number, b: number, l: Omit<WorldLink, 'a' | 'b'>) => {
    const kk = pairKey(a, b);
    if (a === b || has.has(kk)) return;
    has.add(kk);
    const [i, j] = a < b ? [a, b] : [b, a];
    const [x, y] = part.ids[i] < part.ids[j] ? [part.ids[i], part.ids[j]] : [part.ids[j], part.ids[i]];
    // a sea route runs from a's coast to b's
    const from = l.path ? part.label[pixelOf(l.path[0][0], l.path[0][1])] : -1;
    const path = l.path && from >= 0 && part.ids[from] !== x ? [...l.path].reverse() : l.path;
    links.push({ a: x, b: y, ...l, ...(path ? { path } : {}) });
    if (!adj.has(i)) adj.set(i, new Set());
    if (!adj.has(j)) adj.set(j, new Set());
    adj.get(i)!.add(j); adj.get(j)!.add(i);
  };
  const unkey = (kk: number): [number, number] => [Math.floor(kk / 4096), kk % 4096];
  // land
  for (const [kk, km] of [...part.border].sort((x, y) => x[0] - y[0])) {
    const [a, b] = unkey(kk);
    if (km >= MIN_BORDER_KM && inSet.has(a) && inSet.has(b)) add(a, b, { sea: false, km: Math.round(km) });
  }
  // sea: straits always, short seas where the two are otherwise far apart in the graph
  const lanes = [...part.sea].filter(([kk]) => { const [a, b] = unkey(kk); return inSet.has(a) && inSet.has(b) && !has.has(kk); })
    .sort((x, y) => x[1].d - y[1].d || x[0] - y[0]);
  const count = new Map<number, number>();
  for (const [kk, c] of lanes) {
    const [a, b] = unkey(kk);
    if (c.d > SHORT_SEA_KM) break;
    if (c.d > STRAIT_KM) {
      if ((count.get(a) ?? 0) >= MAX_AUTO_LANES || (count.get(b) ?? 0) >= MAX_AUTO_LANES) continue;
      if (hops(adj, a, b, 3) <= 3) continue;
    }
    add(a, b, { sea: true, km: Math.round(c.d), path: seaPath(part, c) });
    count.set(a, (count.get(a) ?? 0) + 1); count.set(b, (count.get(b) ?? 0) + 1);
  }
  // the classic long crossings
  const idx = new Map(part.ids.map((id, i) => [id, i]));
  for (const [x, y] of LONG_LANES) {
    const a = idx.get(x), b = idx.get(y);
    if (a === undefined || b === undefined || !inSet.has(a) || !inSet.has(b)) continue;
    const c = part.sea.get(pairKey(a, b));
    if (c) add(a, b, { sea: true, km: Math.round(c.d), long: true, path: seaPath(part, c) });
    else { const [p, q] = nearestCoasts(part, a, b); add(a, b, { sea: true, km: Math.round(ddist(p, q)), long: true, path: greatCircle(p, q) }); }
  }
  // tie every piece together: the shortest crossing between two pieces, again and again
  for (let guard = 0; guard < members.length; guard++) {
    const comp = new Map<number, number>();
    let nc = 0;
    for (const s of members) {
      if (comp.has(s)) continue;
      const stack = [s];
      comp.set(s, nc);
      while (stack.length) { const u = stack.pop()!; for (const v of adj.get(u) ?? []) if (!comp.has(v) && inSet.has(v)) { comp.set(v, nc); stack.push(v); } }
      nc++;
    }
    if (nc <= 1) break;
    let pick: [number, number, SeaCandidate | null] | null = null, bd = Infinity;
    for (const [kk, c] of lanes) {
      const [a, b] = unkey(kk);
      if (comp.get(a) !== comp.get(b) && c.d < bd) { bd = c.d; pick = [a, b, c]; }
    }
    if (!pick) {
      // nothing within the sea search: the closest pair of sites between the first piece and the rest
      for (const a of members) for (const b of members) {
        if (comp.get(a) !== 0 || comp.get(b) === 0) continue;
        const d = ddist(regionLL(part.ids[a]), regionLL(part.ids[b]));
        if (d < bd) { bd = d; pick = [a, b, null]; }
      }
    }
    if (!pick) break;
    const [a, b, c] = pick;
    if (c) add(a, b, { sea: true, km: Math.round(c.d), long: true, path: seaPath(part, c) });
    else { const [p, q] = nearestCoasts(part, a, b); add(a, b, { sea: true, km: Math.round(ddist(p, q)), long: true, path: greatCircle(p, q) }); }
  }
  return links.sort((x, y) => (x.a < y.a ? -1 : x.a > y.a ? 1 : x.b < y.b ? -1 : x.b > y.b ? 1 : 0));
}

const regionLL = (id: string): LonLat => [REGION_BY_ID[id].lon, REGION_BY_ID[id].lat];
const pxLL = (p: number): LonLat => { const y = (p / W) | 0; return [lonOf(p - y * W), latOf(y)]; };

/** The sea route of a crossing: both fronts traced back to their coasts. */
function seaPath(part: Partition, c: SeaCandidate): LonLat[] {
  const g = grid();
  if (c.q < 0) { const a = pxLL(c.p), b = pxLL(-1 - c.q); b[0] = unwrapLon(b[0], a[0]); return [a, b]; }
  const trace = (p: number) => { const out: number[] = []; for (let s = p, guard = 0; s >= 0 && guard < 20000; s = part.seaPrev[s], guard++) out.push(s); return out; };
  const a = trace(c.p).reverse();
  const b = g.land[c.q] ? [c.q] : trace(c.q);
  const pts = [...a, ...b].map(pxLL);
  for (let i = 1; i < pts.length; i++) pts[i][0] = unwrapLon(pts[i][0], pts[i - 1][0]);
  return simplify(pts, 0.35);
}

/** The closest pair of coastal pixels of two territories (sampled), as [lon, lat]. */
function nearestCoasts(part: Partition, a: number, b: number): [LonLat, LonLat] {
  const g = grid();
  const ca: number[] = [], cb: number[] = [];
  for (let p = 0; p < N; p++) {
    if (part.label[p] === a && isSeaNext4(g.land, p)) ca.push(p);
    else if (part.label[p] === b && isSeaNext4(g.land, p)) cb.push(p);
  }
  const A = ca.length ? ca : [part.sitePx[a]], B = cb.length ? cb : [part.sitePx[b]];
  const sa = Math.max(1, Math.floor(A.length / 400)), sb = Math.max(1, Math.floor(B.length / 400));
  let best: [number, number] = [A[0], B[0]], bd = Infinity;
  const v = (p: number) => { const y = (p / W) | 0, x = p - y * W; return [g.cosLat[y] * g.sinLon[x], g.sinLat[y], g.cosLat[y] * g.cosLon[x]]; };
  for (let i = 0; i < A.length; i += sa) {
    const [x1, y1, z1] = v(A[i]);
    for (let j = 0; j < B.length; j += sb) {
      const [x2, y2, z2] = v(B[j]);
      const d = 1 - (x1 * x2 + y1 * y2 + z1 * z2);
      if (d < bd) { bd = d; best = [A[i], B[j]]; }
    }
  }
  return [pxLL(best[0]), pxLL(best[1])];
}

/** Douglas-Peucker in degrees (longitudes scaled by the cosine of the latitude). */
function simplify(pts: LonLat[], tol: number): LonLat[] {
  if (pts.length <= 2) return pts.map((p) => [+p[0].toFixed(3), +p[1].toFixed(3)] as LonLat);
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    const c = Math.cos(((pts[i][1] + pts[j][1]) / 2) * DEG);
    const ax = pts[i][0] * c, ay = pts[i][1], bx = pts[j][0] * c, by = pts[j][1];
    const vx = bx - ax, vy = by - ay, L = vx * vx + vy * vy;
    let far = -1, fd = tol * tol;
    for (let k = i + 1; k < j; k++) {
      const px = pts[k][0] * c - ax, py = pts[k][1] - ay;
      const t = L > 0 ? Math.max(0, Math.min(1, (px * vx + py * vy) / L)) : 0;
      const dx = px - t * vx, dy = py - t * vy, d = dx * dx + dy * dy;
      if (d > fd) { fd = d; far = k; }
    }
    if (far >= 0) { keep[far] = 1; stack.push([i, far], [far, j]); }
  }
  return pts.filter((_, i) => keep[i]).map((p) => [+p[0].toFixed(3), +p[1].toFixed(3)] as LonLat);
}

// =====================================================================================================
// A run's map
// =====================================================================================================
export interface WorldTerritory {
  id: string;
  /** The region's own position (the city or place it is named after): the site its cell is grown from. */
  site: LonLat;
  /** Where its label goes: the point deepest inside its largest piece. */
  anchor: LonLat;
  /** Distance from the anchor to the nearest edge of the territory, km (label size). */
  inradiusKm: number;
  /** Closed outline loops (outer edges and holes; the last point joins the first), longitudes continuous per loop. */
  rings: LonLat[][];
  areaKm2: number;
  /** Touches the sea. */
  coastal: boolean;
}
export interface WorldBorder { a: string; b: string; lines: LonLat[][] }
export interface WorldZoneInfo {
  id: string;
  territories: string[];
  /** Territories of the zone linked to a territory outside it (the fronts to hold). */
  borders: number;
  /** Troops per turn for holding all of it, for this map (zoneBonus of its size and borders). */
  bonus: number;
}
export interface WorldMap {
  /** Region ids on the map, in territory order. */
  regions: string[];
  /** The sites the cells were grown from (a Blitz map uses its World's: the same shapes). */
  within: string[];
  territories: WorldTerritory[];
  links: WorldLink[];
  /** Land borders between territories, as polylines. */
  borders: WorldBorder[];
  zones: WorldZoneInfo[];
  /** Equirectangular territory raster: row 0 at 90°N, column 0 at 180°W, RASTER_W x RASTER_H; a territory index, -1 sea, -2 land off the map. */
  raster: { w: number; h: number; label: Int16Array };
}

const mapCache = new Map<string, WorldMap>();

/**
 * The map of the territories `ids`, cut from the cells of the sites `within` (default: `ids` themselves). A Blitz map
 * is `buildWorld(blitzRegions(seed, home), worldRegions(seed))`: its territories keep their World shapes and links.
 * Cached (pure: the same arguments give an equal map).
 */
export function buildWorld(ids: readonly string[], within: readonly string[] = ids): WorldMap {
  const key = `${within.join(',')}|${ids.join(',')}`;
  const hit = mapCache.get(key);
  if (hit) return hit;
  const part = partitionOf(within);
  const g = grid();
  const at = new Map(part.ids.map((id, i) => [id, i]));
  const members = ids.map((id) => {
    const i = at.get(id);
    if (i === undefined) throw new Error(`region ${id} is not among the map's sites`);
    return i;
  });
  // ---- labels re-indexed to `ids`, the rest off the map
  const remap = new Int16Array(part.ids.length).fill(-2);
  members.forEach((m, i) => { remap[m] = i; });
  const label = new Int16Array(N);
  for (let p = 0; p < N; p++) { const l = part.label[p]; label[p] = l >= 0 ? remap[l] : l; }
  // ---- links: the World's among these, plus connectors if the subset falls apart
  const sameSet = members.length === part.ids.length;
  const links = sameSet ? part.links : chooseSubsetLinks(part, members);
  // ---- territories
  const T = ids.length;
  const area = new Float64Array(T);
  const coastal = new Uint8Array(T);
  for (let p = 0; p < N; p++) {
    const l = label[p];
    if (l < 0) continue;
    area[l] += g.area[(p / W) | 0];
    if (!coastal[l] && isSeaNext4(g.land, p)) coastal[l] = 1;
  }
  const anchors = anchorsOf(label, T, members.map((m) => part.sitePx[m]));
  const { rings, borders } = outlines(label, T);
  const territories: WorldTerritory[] = ids.map((id, i) => ({
    id, site: regionLL(id), anchor: anchors.ll[i], inradiusKm: Math.round(anchors.r[i]),
    rings: rings[i], areaKm2: Math.round(area[i]), coastal: coastal[i] === 1,
  }));
  const map: WorldMap = {
    regions: [...ids], within: [...within], territories, links, borders: borders.map(([a, b, lines]) => ({ a: ids[a], b: ids[b], lines })),
    zones: zonesOf(ids, links), raster: { w: W, h: H, label },
  };
  mapCache.set(key, map);
  if (mapCache.size > 4) mapCache.delete(mapCache.keys().next().value!);
  return map;
}

/** Links among a subset: the full map's links between members, then connectors if needed. */
function chooseSubsetLinks(part: Partition, members: number[]): WorldLink[] {
  const inIds = new Set(members.map((m) => part.ids[m]));
  const base = part.links.filter((l) => inIds.has(l.a) && inIds.has(l.b));
  // connected already? (a Blitz subset is grown over the links, so normally yes)
  const adj = new Map<string, string[]>();
  for (const l of base) { (adj.get(l.a) ?? adj.set(l.a, []).get(l.a)!).push(l.b); (adj.get(l.b) ?? adj.set(l.b, []).get(l.b)!).push(l.a); }
  const first = part.ids[members[0]];
  const seen = new Set([first]);
  const stack = [first];
  while (stack.length) for (const v of adj.get(stack.pop()!) ?? []) if (!seen.has(v)) { seen.add(v); stack.push(v); }
  if (seen.size === members.length) return base;
  return chooseLinks(part, members);
}

/** Zone bonuses for the territories on a map. */
function zonesOf(ids: readonly string[], links: readonly WorldLink[]): WorldZoneInfo[] {
  const zoneOf = new Map(ids.map((id) => [id, REGION_BY_ID[id].zone]));
  const front = new Set<string>();
  for (const l of links) if (zoneOf.get(l.a) !== zoneOf.get(l.b)) { front.add(l.a); front.add(l.b); }
  const out: WorldZoneInfo[] = [];
  for (const z of WORLD_ZONES) {
    const territories = ids.filter((id) => zoneOf.get(id) === z.id);
    if (!territories.length) continue;
    const borders = territories.filter((id) => front.has(id)).length;
    out.push({ id: z.id, territories, borders, bonus: zoneBonus(territories.length, borders) });
  }
  return out;
}

/** The territory at a point of the globe (an id of map.regions), or null for sea and land off the map. */
export function territoryAt(map: WorldMap, lon: number, lat: number): string | null {
  const l = map.raster.label[pixelOf(lon, lat)];
  return l >= 0 ? map.regions[l] : null;
}

/** Label anchors: the pixel of each territory farthest from its edge (distance over the territory), ties nearest the site. */
function anchorsOf(label: Int16Array, T: number, sitePx: number[]): { ll: LonLat[]; r: number[] } {
  const g = grid();
  const dist = new Float64Array(N).fill(Infinity);
  const heap = new Heap();
  const nb = new Int32Array(8), nl = new Float64Array(8);
  for (let p = 0; p < N; p++) {
    const l = label[p];
    if (l < 0) continue;
    const y = (p / W) | 0, x = p - y * W;
    const edge = label[y * W + (x === 0 ? W - 1 : x - 1)] !== l || label[y * W + (x === W - 1 ? 0 : x + 1)] !== l
      || y === 0 || y === H - 1 || label[p - W] !== l || label[p + W] !== l;
    if (edge) { dist[p] = g.dx[y] / 2; heap.push(dist[p], p); }
  }
  while (heap.n) {
    const p = heap.pop();
    if (heap.top > dist[p]) continue;
    const m = neighbours8(g, p, nb, nl);
    for (let i = 0; i < m; i++) {
      const q = nb[i];
      if (label[q] !== label[p]) continue;
      const nd = dist[p] + nl[i];
      if (nd < dist[q]) { dist[q] = nd; heap.push(nd, q); }
    }
  }
  const bestP = sitePx.slice(), bestD = new Float64Array(T).fill(-1), bestS = new Float64Array(T).fill(Infinity);
  const sv = sitePx.map((p) => { const y = (p / W) | 0, x = p - y * W; return [g.cosLat[y] * g.sinLon[x], g.sinLat[y], g.cosLat[y] * g.cosLon[x]]; });
  for (let p = 0; p < N; p++) {
    const l = label[p];
    if (l < 0) continue;
    const d = Math.round(dist[p] * 10);
    if (d < bestD[l]) continue;
    const y = (p / W) | 0, x = p - y * W, [a, b, c] = sv[l];
    const s = 1 - (a * g.cosLat[y] * g.sinLon[x] + b * g.sinLat[y] + c * g.cosLat[y] * g.cosLon[x]);
    if (d > bestD[l] || s < bestS[l]) { bestD[l] = d; bestS[l] = s; bestP[l] = p; }
  }
  return { ll: bestP.map((p) => { const [lo, la] = pxLL(p); return [+lo.toFixed(3), +la.toFixed(3)] as LonLat; }), r: [...bestD].map((d) => Math.max(0, d) / 10) };
}

/**
 * Outlines from the label raster: the pixel edges between different labels are chained into arcs between junctions
 * (shared by both sides, so neighbouring outlines match exactly), smoothed (corner cutting) and simplified; each
 * territory's rings are its arcs joined end to end.
 */
function outlines(label: Int16Array, T: number): { rings: LonLat[][][]; borders: [number, number, LonLat[][]][] } {
  const V = W * (H + 1);
  // boundary edges: vertical (between x-1 and x in row y) and horizontal (between rows cy-1 and cy at column x)
  const ea: number[] = [], eb: number[] = [], ek: number[] = [];
  const head = new Int32Array(V).fill(-1);
  const nxt: number[] = [];
  const link = (v: number, e: number) => { nxt.push(head[v]); head[v] = nxt.length - 1; void e; };
  const inc: number[] = []; // edge index per incidence slot (parallel to nxt)
  const addEdge = (va: number, vb: number, l1: number, l2: number) => {
    const e = ea.length;
    ea.push(va); eb.push(vb); ek.push(l1 < l2 ? (l1 + 3) * 8192 + (l2 + 3) : (l2 + 3) * 8192 + (l1 + 3));
    link(va, e); inc.push(e);
    link(vb, e); inc.push(e);
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x, l = label[p];
    const lx = label[y * W + (x === 0 ? W - 1 : x - 1)];
    if (lx !== l && (lx >= 0 || l >= 0)) addEdge(y * W + x, (y + 1) * W + x, lx, l);
    if (y > 0) {
      const lu = label[p - W];
      if (lu !== l && (lu >= 0 || l >= 0)) addEdge(y * W + x, y * W + (x === W - 1 ? 0 : x + 1), lu, l);
    }
  }
  const E = ea.length;
  const deg = (v: number) => { let c = 0; for (let s = head[v]; s >= 0; s = nxt[s]) c++; return c; };
  const junction = (v: number) => {
    let c = 0, k = -1, same = true;
    for (let s = head[v]; s >= 0; s = nxt[s]) { c++; const kk = ek[inc[s]]; if (k < 0) k = kk; else if (kk !== k) same = false; }
    return c !== 2 || !same;
  };
  const used = new Uint8Array(E);
  const arcs: { v: number[]; k: number }[] = [];
  const walk = (start: number, e0: number) => {
    const vs = [start];
    let v = start, e = e0;
    for (let guard = 0; guard <= E; guard++) {
      used[e] = 1;
      v = ea[e] === v ? eb[e] : ea[e];
      vs.push(v);
      if (v === start || junction(v)) break;
      let ne = -1;
      for (let s = head[v]; s >= 0; s = nxt[s]) if (!used[inc[s]]) { ne = inc[s]; break; }
      if (ne < 0) break;
      e = ne;
    }
    arcs.push({ v: vs, k: ek[e0] });
  };
  for (let v = 0; v < V; v++) {
    if (head[v] < 0 || !junction(v)) continue;
    for (let s = head[v]; s >= 0; s = nxt[s]) if (!used[inc[s]]) walk(v, inc[s]);
  }
  for (let e = 0; e < E; e++) if (!used[e]) walk(ea[e], e);
  void deg;
  // ---- arcs to smoothed, simplified lon/lat polylines
  const vLL = (v: number): LonLat => { const cy = (v / W) | 0, cx = v - cy * W; return [-180 + cx * STEP, 90 - cy * STEP]; };
  const arcLL = arcs.map(({ v }) => {
    const c = v.map(vLL);
    for (let i = 1; i < c.length; i++) c[i][0] = unwrapLon(c[i][0], c[i - 1][0]);
    const closed = v[0] === v[v.length - 1];
    const pts: LonLat[] = closed ? [] : [c[0]];
    for (let i = 0; i + 1 < c.length; i++) pts.push([(c[i][0] + c[i + 1][0]) / 2, (c[i][1] + c[i + 1][1]) / 2]);
    if (closed) pts.push(pts[0]); else pts.push(c[c.length - 1]);
    return simplify(pts, 0.06);
  });
  // ---- per territory: chain its arcs into rings
  const byT: number[][] = Array.from({ length: T }, () => []);
  const sides = arcs.map(({ k }) => [Math.floor(k / 8192) - 3, (k % 8192) - 3]);
  sides.forEach(([a, b], i) => { if (a >= 0) byT[a].push(i); if (b >= 0 && b !== a) byT[b].push(i); });
  const rings: LonLat[][][] = byT.map((list) => {
    const out: LonLat[][] = [];
    const ends = new Map<number, number[]>();
    for (const i of list) {
      const v = arcs[i].v;
      if (v[0] === v[v.length - 1]) continue;
      for (const end of [v[0], v[v.length - 1]]) (ends.get(end) ?? ends.set(end, []).get(end)!).push(i);
    }
    const taken = new Set<number>();
    for (const i of list) {
      if (taken.has(i)) continue;
      taken.add(i);
      const v = arcs[i].v;
      if (v[0] === v[v.length - 1]) { if (arcLL[i].length > 3) out.push(arcLL[i].slice(0, -1)); continue; }
      const ring: LonLat[] = arcLL[i].map((p) => [p[0], p[1]] as LonLat);
      const start = v[0];
      let at = v[v.length - 1];
      for (let guard = 0; guard < list.length && at !== start; guard++) {
        const cand = (ends.get(at) ?? []).find((j) => !taken.has(j));
        if (cand === undefined) break;
        taken.add(cand);
        const cv = arcs[cand].v;
        const fwd = cv[0] === at;
        const pts = fwd ? arcLL[cand] : [...arcLL[cand]].reverse();
        const shift = 360 * Math.round((ring[ring.length - 1][0] - pts[0][0]) / 360);
        for (let k = 1; k < pts.length; k++) ring.push([+(pts[k][0] + shift).toFixed(3), pts[k][1]]);
        at = fwd ? cv[cv.length - 1] : cv[0];
      }
      if (ring.length > 3) { ring.pop(); out.push(ring); }
    }
    return out;
  });
  // ---- land borders between two territories, as polylines
  const bmap = new Map<number, LonLat[][]>();
  sides.forEach(([a, b], i) => {
    if (a < 0 || b < 0) return;
    const kk = a * 4096 + b;
    (bmap.get(kk) ?? bmap.set(kk, []).get(kk)!).push(arcLL[i]);
  });
  const borders = [...bmap].sort((x, y) => x[0] - y[0]).map(([kk, lines]) => [Math.floor(kk / 4096), kk % 4096, lines] as [number, number, LonLat[][]]);
  return { rings, borders };
}

/** A run's links as STRAT's graph wants them: land borders and sea lanes among `ids` (cells of `within`). */
export function worldLinks(ids: readonly string[], within: readonly string[] = ids): { a: string; b: string; sea: boolean; km: number }[] {
  return buildWorld(ids, within).links.map((l) => ({ a: l.a, b: l.b, sea: l.sea, km: l.km }));
}

// =====================================================================================================
// Which regions a run uses
// =====================================================================================================
/** World size: about this many territories. */
export const WORLD_TARGET = 102;
/** Blitz size: about this many (whole zones). */
export const BLITZ_MIN = 25, BLITZ_MAX = 34;

/** The regions of a World run: every core region, plus a seeded, well-spread choice of the others (~WORLD_TARGET). */
export function worldRegions(seed: number): string[] {
  const rng = new Rng((seed >>> 0) ^ 0x51ed270b);
  const zoneSize = new Map<string, number>();
  for (const r of WORLD_REGIONS) zoneSize.set(r.zone, (zoneSize.get(r.zone) ?? 0) + 1);
  const drop = new Set<string>();
  const optional = rng.shuffle(WORLD_REGIONS.filter((r) => !r.core).map((r) => r.id));
  const dropN = Math.max(0, WORLD_REGIONS.length - WORLD_TARGET);
  for (let pass = 0; pass < 3 && drop.size < dropN; pass++) {
    const spread = [1400, 900, 0][pass];
    for (const id of optional) {
      if (drop.size >= dropN) break;
      if (drop.has(id)) continue;
      const r = REGION_BY_ID[id];
      const left = zoneSize.get(r.zone)!;
      if (left <= 4 || left <= Math.ceil(WORLD_ZONES_SIZE.get(r.zone)! * 0.6)) continue;
      if ([...drop].some((d) => ddist(regionLL(d), regionLL(id)) < spread)) continue;
      drop.add(id);
      zoneSize.set(r.zone, left - 1);
    }
  }
  return WORLD_REGIONS.filter((r) => !drop.has(r.id)).map((r) => r.id);
}
const WORLD_ZONES_SIZE = new Map<string, number>();
for (const r of WORLD_REGIONS) WORLD_ZONES_SIZE.set(r.zone, (WORLD_ZONES_SIZE.get(r.zone) ?? 0) + 1);

/**
 * The regions of a Blitz run from `homeland`: its own zones, then whole neighbouring zones, nearest first (over the
 * World map's links; seeded ties), while the total stays within BLITZ_MAX; at least BLITZ_MIN. Always connected.
 */
export function blitzRegions(seed: number, homeland: string): string[] {
  const home = HOMELAND_BY_ID[homeland];
  if (!home) throw new Error(`unknown homeland ${homeland}`);
  const world = worldRegions(seed);
  const map = partitionOf(world);
  const rng = new Rng((seed >>> 0) ^ 0x7b1f3a59 ^ hashStr(homeland));
  const adj = new Map<string, string[]>();
  for (const l of map.links) { (adj.get(l.a) ?? adj.set(l.a, []).get(l.a)!).push(l.b); (adj.get(l.b) ?? adj.set(l.b, []).get(l.b)!).push(l.a); }
  // graph distance from the homeland's capital
  const dist = new Map([[home.capital, 0]]);
  let front = [home.capital];
  while (front.length) {
    const next: string[] = [];
    for (const u of front) for (const v of adj.get(u) ?? []) if (!dist.has(v)) { dist.set(v, dist.get(u)! + 1); next.push(v); }
    front = next;
  }
  const members = new Map<string, string[]>();
  for (const id of world) { const z = REGION_BY_ID[id].zone; (members.get(z) ?? members.set(z, []).get(z)!).push(id); }
  const chosen = new Set<string>();
  const zones = new Set<string>();
  const take = (z: string) => { zones.add(z); for (const id of members.get(z) ?? []) chosen.add(id); };
  for (const id of home.regions) take(REGION_BY_ID[id].zone);
  const tie = new Map([...members.keys()].map((z) => [z, rng.next()]));
  for (let guard = 0; guard < 30; guard++) {
    // zones touching what we have, by how close their nearest territory is to the capital
    const cand = [...members.keys()].filter((z) => !zones.has(z) && members.get(z)!.some((id) => (adj.get(id) ?? []).some((v) => chosen.has(v))));
    if (!cand.length) break;
    const score = (z: string) => Math.min(...members.get(z)!.map((id) => dist.get(id) ?? 99)) + tie.get(z)! * 0.9;
    cand.sort((a, b) => score(a) - score(b) || (a < b ? -1 : 1));
    const fit = cand.find((z) => chosen.size + members.get(z)!.length <= BLITZ_MAX);
    if (!fit || chosen.size >= BLITZ_MIN + 3) break;
    take(fit);
  }
  return world.filter((id) => chosen.has(id));
}

/** The map of a run: World (~100 territories) or Blitz (~30 around the homeland, cut from the same World). */
export function worldMap(seed: number, size: 'world' | 'blitz', homeland: string): WorldMap {
  const world = worldRegions(seed);
  return size === 'world' ? buildWorld(world) : buildWorld(blitzRegions(seed, homeland), world);
}

/** Forget every cached map (tests: proves a fresh build gives the same result). */
export function clearGeoCaches() { partCache.clear(); mapCache.clear(); }

/** The full map of every region (tests, tools, the zone bonuses in regions.ts). */
export const fullWorld = (): WorldMap => buildWorld(WORLD_REGIONS.map((r) => r.id));

function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}
