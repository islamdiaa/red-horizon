/**
 * The geography a world run is built from (GEO's regions, zones, homelands and landmarks, or the synthetic stub),
 * and the assembly of a run's map from it: which regions take part (World: about 100, Blitz: your continent and its
 * neighbours, about 30), the links between them (land borders and sea lanes), zone bonuses and ports.
 * Pure and deterministic: the same atlas, size, homeland and seed always give the same map.
 */
import { Rng } from '../../core/rng';
import type { LandmarkId, WonderEffect, WorldHomeland, WorldRegion, WorldZone } from './types';
import { STUB_HOMELANDS, STUB_REGIONS, STUB_ZONES, stubWonder } from './stub-geo';
import { LANDMARK_INFO, WORLD_HOMELANDS, WORLD_REGIONS, WORLD_ZONES } from './regions';
import { isLand, worldLinks, worldMap } from './geo';
import type { WLink, WTerritory, WZone, WorldSize } from './state';

export interface Atlas {
  /** Data version (stored in the run). */
  version: string;
  regions: readonly WorldRegion[];
  zones: readonly WorldZone[];
  homelands: readonly WorldHomeland[];
  wonder(id: LandmarkId): WonderEffect | undefined;
  /** Links between exactly these regions (land borders + sea lanes); absent: computed here from the sites. */
  links?(ids: readonly string[]): WLink[];
  /** Land test for sea-lane detection when links() is absent. */
  isLand?(lon: number, lat: number): boolean;
  /** The whole map of a run (GEO's worldMap): its regions, links and zones (bonus for the run's territories). */
  runMap?(seed: number, size: WorldSize, home: string): { regions: readonly string[]; links: readonly { a: string; b: string; sea: boolean }[]; zones: readonly { id: string; territories: readonly string[]; bonus: number }[] };
}

export const STUB_ATLAS: Atlas = { version: 'stub-1', regions: STUB_REGIONS, zones: STUB_ZONES, homelands: STUB_HOMELANDS, wonder: stubWonder };

/** The real world (GEO: src/conquest/world/regions.ts and geo.ts). */
export const GEO_ATLAS: Atlas = {
  version: 'geo-1',
  regions: WORLD_REGIONS,
  zones: WORLD_ZONES,
  homelands: WORLD_HOMELANDS,
  wonder: (id) => LANDMARK_INFO[id]?.wonder,
  isLand,
  links: (ids) => worldLinks(ids),
  runMap: (seed, size, home) => {
    const m = worldMap(seed, size, home);
    return { regions: m.regions, links: m.links, zones: m.zones };
  },
};

let current: Atlas = GEO_ATLAS;
/** The atlas new runs are built from. */
export function atlas(): Atlas { return current; }
/** Swap the atlas (the real geography registers itself; tests may pin the stub). */
export function setAtlas(a: Atlas) { current = a; regionCache = null; }

let regionCache: { a: Atlas; byId: Map<string, WorldRegion>; homes: Map<string, WorldHomeland>; zones: Map<string, WorldZone> } | null = null;
function maps(a: Atlas = current) {
  if (regionCache?.a === a) return regionCache;
  regionCache = {
    a,
    byId: new Map(a.regions.map((r) => [r.id, r])),
    homes: new Map(a.homelands.map((h) => [h.id, h])),
    zones: new Map(a.zones.map((z) => [z.id, z])),
  };
  return regionCache;
}
export function regionById(id: string): WorldRegion | undefined { return maps().byId.get(id); }
export function homelandById(id: string): WorldHomeland | undefined { return maps().homes.get(id); }
export function zoneById(id: string): WorldZone | undefined { return maps().zones.get(id); }

// =====================================================================================================
// Geometry on the sphere
// =====================================================================================================
type V3 = [number, number, number];
const RAD = Math.PI / 180;
export function vec(lon: number, lat: number): V3 {
  const cl = Math.cos(lat * RAD);
  return [cl * Math.cos(lon * RAD), cl * Math.sin(lon * RAD), Math.sin(lat * RAD)];
}
/** Great-circle angle between two sites, degrees. */
export function arc(a: { lon: number; lat: number }, b: { lon: number; lat: number }): number {
  const p = vec(a.lon, a.lat), q = vec(b.lon, b.lat);
  const d = Math.max(-1, Math.min(1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2]));
  return Math.acos(d) / RAD;
}

/**
 * Links among sites: the spherical Gabriel graph (no other site inside the sphere on the pair's chord as diameter:
 * a subgraph of the Delaunay triangulation, so it is planar and connected), long edges dropped, then reconnected
 * with the shortest sea lanes. Sea lanes: the arc between the sites crosses water (atlas.isLand) or, without a land
 * test, the sites are on different continents or far apart.
 */
export function computeLinks(rs: readonly WorldRegion[], isLand?: (lon: number, lat: number) => boolean): WLink[] {
  const n = rs.length;
  const P = rs.map((r) => vec(r.lon, r.lat));
  const d2 = (i: number, j: number) => { const a = P[i], b = P[j]; return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2; };
  const out: WLink[] = [];
  const parent = rs.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const seaOf = (i: number, j: number, deg: number) => {
    if (isLand) {
      let water = 0;
      for (let k = 1; k <= 9; k++) {
        const f = k / 10;
        const a = P[i], b = P[j];
        const x = a[0] + (b[0] - a[0]) * f, y = a[1] + (b[1] - a[1]) * f, z = a[2] + (b[2] - a[2]) * f;
        const lon = Math.atan2(y, x) / RAD, lat = Math.atan2(z, Math.hypot(x, y)) / RAD;
        if (!isLand(lon, lat)) water++;
      }
      return water >= 3;
    }
    return rs[i].continent !== rs[j].continent || deg > 14;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const m: V3 = [(P[i][0] + P[j][0]) / 2, (P[i][1] + P[j][1]) / 2, (P[i][2] + P[j][2]) / 2];
      const r2 = d2(i, j) / 4;
      let ok = true;
      for (let k = 0; k < n && ok; k++) {
        if (k === i || k === j) continue;
        const q = P[k];
        if ((q[0] - m[0]) ** 2 + (q[1] - m[1]) ** 2 + (q[2] - m[2]) ** 2 < r2) ok = false;
      }
      if (!ok) continue;
      const deg = arc(rs[i], rs[j]);
      const sea = seaOf(i, j, deg);
      if (deg > (sea ? 38 : 26)) continue;
      out.push({ a: rs[i].id, b: rs[j].id, sea });
      parent[find(i)] = find(j);
    }
  }
  // reconnect components with the shortest sea lanes
  for (;;) {
    const roots = new Set(rs.map((_, i) => find(i)));
    if (roots.size <= 1) break;
    let best: [number, number, number] | null = null;
    const r0 = find(0);
    for (let i = 0; i < n; i++) {
      if (find(i) !== r0) continue;
      for (let j = 0; j < n; j++) {
        if (find(j) === r0) continue;
        const deg = arc(rs[i], rs[j]);
        if (!best || deg < best[2]) best = [i, j, deg];
      }
    }
    if (!best) break;
    out.push({ a: rs[best[0]].id, b: rs[best[1]].id, sea: true });
    parent[find(best[0])] = find(best[1]);
  }
  return out;
}

// =====================================================================================================
// A run's map
// =====================================================================================================
export interface RunMap {
  territories: WTerritory[];
  links: WLink[];
  zones: WZone[];
}

/** Map rules a run is built with (the harnesses' experiments change them in their own threads). */
export const MAP_TUNE = { zoneScale: 1 };

/** Zone bonus for a set of territories: about 0.4 a territory plus 0.5 a border territory (Risk's continents fit this). */
export function zoneBonus(size: number, borders: number): number {
  return Math.max(1, Math.round(0.4 * size + 0.5 * borders - 0.2));
}

/** World: every region (core + a seeded selection when the atlas has more than ~110). Blitz: whole zones near home. */
export function pickRegions(a: Atlas, size: WorldSize, home: WorldHomeland, seed: number): WorldRegion[] {
  const all = a.regions;
  if (size === 'world') {
    if (all.length <= 110) return [...all];
    const rng = new Rng(seed ^ 0x51ed270b);
    const core = all.filter((r) => r.core || r.homeland || r.landmark || r.id === home.capital);
    const rest = all.filter((r) => !(r.core || r.homeland || r.landmark || r.id === home.capital));
    rng.shuffle(rest);
    const keep = new Set([...core, ...rest.slice(0, Math.max(0, 100 - core.length))].map((r) => r.id));
    return all.filter((r) => keep.has(r.id));
  }
  // Blitz: zones by distance from the home zone over the full world's links (same continent first)
  const links = a.links ? a.links(all.map((r) => r.id)) : computeLinks(all, a.isLand);
  const zoneOfR = new Map(all.map((r) => [r.id, r.zone]));
  const zAdj = new Map<string, Set<string>>();
  for (const l of links) {
    const za = zoneOfR.get(l.a)!, zb = zoneOfR.get(l.b)!;
    if (za === zb) continue;
    if (!zAdj.has(za)) zAdj.set(za, new Set());
    if (!zAdj.has(zb)) zAdj.set(zb, new Set());
    zAdj.get(za)!.add(zb); zAdj.get(zb)!.add(za);
  }
  const homeRegion = all.find((r) => r.id === home.capital) ?? all[0];
  const homeZone = homeRegion.zone;
  const count = (z: string) => all.filter((r) => r.zone === z).length;
  const dist = new Map<string, number>([[homeZone, 0]]);
  const q = [homeZone];
  while (q.length) {
    const z = q.shift()!;
    for (const n of [...(zAdj.get(z) ?? [])].sort()) if (!dist.has(n)) { dist.set(n, dist.get(z)! + 1); q.push(n); }
  }
  const centre = (z: string) => { const rs = all.filter((r) => r.zone === z); return { lon: rs[0].lon, lat: rs[0].lat }; };
  const cont = (z: string) => all.find((r) => r.zone === z)!.continent;
  const order = [...dist.keys()].filter((z) => z !== homeZone).sort((x, y) =>
    (dist.get(x)! - dist.get(y)!) || ((cont(x) === homeRegion.continent ? 0 : 1) - (cont(y) === homeRegion.continent ? 0 : 1)) || (arc(centre(x), homeRegion) - arc(centre(y), homeRegion)) || (x < y ? -1 : 1));
  const zones = [homeZone];
  let total = count(homeZone);
  for (const z of order) {
    if (total >= 26) break;
    const c = count(z);
    if (total + c > 36) continue;
    // keep the selection contiguous
    if (!zones.some((s) => zAdj.get(s)?.has(z))) continue;
    zones.push(z);
    total += c;
  }
  const keep = new Set(zones);
  return all.filter((r) => keep.has(r.zone));
}

/** Build the run's territories, links and zones (owners and troops are set by newWorldRun). */
export function buildRunMap(a: Atlas, size: WorldSize, home: WorldHomeland, seed: number): RunMap {
  const given = a.runMap?.(seed, size, home.id);
  const byRegion = maps(a).byId;
  const rs = given ? given.regions.map((id) => byRegion.get(id)).filter((r): r is WorldRegion => !!r) : pickRegions(a, size, home, seed);
  const ids = rs.map((r) => r.id);
  const links = (given ? given.links : a.links ? a.links(ids) : computeLinks(rs, a.isLand)).map((l) => ({ a: l.a, b: l.b, sea: !!l.sea }));
  const territories: WTerritory[] = rs.map((r) => ({
    id: r.id, zone: r.zone, continent: r.continent, lon: r.lon, lat: r.lat, owner: -1, troops: 1,
    port: r.resources.includes('port') || r.features.includes('harbour'), coastal: false,
    ...(r.landmark ? { landmark: r.landmark } : {}),
  }));
  const byId = new Map(territories.map((t, i) => [t.id, i]));
  for (const l of links) if (l.sea) { territories[byId.get(l.a)!].coastal = true; territories[byId.get(l.b)!].coastal = true; }
  ensurePorts(territories, links, byId);
  // zones (only those with territories in the run), bonus: the atlas's when the zone is whole, else the formula
  const zoneIds: string[] = [];
  for (const t of territories) if (!zoneIds.includes(t.zone)) zoneIds.push(t.zone);
  const full = new Map<string, number>();
  for (const r of a.regions) full.set(r.zone, (full.get(r.zone) ?? 0) + 1);
  const zones: WZone[] = zoneIds.map((id) => {
    const ts = territories.filter((t) => t.zone === id).map((t) => t.id);
    const set = new Set(ts);
    const borders = ts.filter((t) => links.some((l) => (l.a === t && !set.has(l.b)) || (l.b === t && !set.has(l.a)))).length;
    const def = a.zones.find((z) => z.id === id);
    const whole = full.get(id) === ts.length;
    const geoBonus = given?.zones.find((z) => z.id === id)?.bonus;
    const bonus = geoBonus ?? (whole && def ? def.bonus : zoneBonus(ts.length, borders));
    return { id, continent: def?.continent ?? territories[byId.get(ts[0])!].continent, bonus: Math.max(1, Math.round(bonus * MAP_TUNE.zoneScale)), territories: ts };
  });
  return { territories, links, zones };
}

/** Every sea lane whose ends both lack a port, and that is the only way between them, gets a port at one end. */
function ensurePorts(T: WTerritory[], links: WLink[], byId: Map<string, number>) {
  for (let guard = 0; guard < 64; guard++) {
    const parent = T.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (const l of links) {
      const a = byId.get(l.a)!, b = byId.get(l.b)!;
      if (!l.sea || T[a].port || T[b].port) parent[find(a)] = find(b);
    }
    const roots = new Set(T.map((_, i) => find(i)));
    if (roots.size <= 1) return;
    // the dead lane touching the most sea lanes gets a port at its busier end
    let best: { t: number; lanes: number } | null = null;
    for (const l of links) {
      const a = byId.get(l.a)!, b = byId.get(l.b)!;
      if (!l.sea || T[a].port || T[b].port || find(a) === find(b)) continue;
      for (const t of [a, b]) {
        const lanes = links.filter((x) => x.sea && (x.a === T[t].id || x.b === T[t].id)).length;
        if (!best || lanes > best.lanes || (lanes === best.lanes && T[t].id < T[best.t].id)) best = { t, lanes };
      }
    }
    if (!best) return;
    T[best.t].port = true;
  }
}
