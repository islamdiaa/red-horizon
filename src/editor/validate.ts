/**
 * Map / mission validation for the editor (no DOM). The map checks are the ones the curated-map test
 * suite (tests/maps.test.ts) holds every shipped map to: room for a base at every start, starts linked
 * by land, ore shared fairly (same nearest-start rule, gems count double), bridges that span water.
 */
import { bridgeCells, landReach, nearestStart, oreValue } from '../maps/build';
import type { MapDef } from '../maps/format';
import { BUILDINGS, UNITS } from '../data/rules';
import { T, type GameMap } from '../sim/map';
import { checkMission, type MissionSpec } from './mission';

export type Level = 'ok' | 'warning' | 'error';
export interface Check {
  level: Level;
  title: string;
  detail?: string;
  /** Map point to focus when the check is clicked. */
  at?: [number, number];
}

export interface OreShare {
  /** Ore value nearest to this start (bails, gems double). */
  total: number;
  /** Ore value within 17 cells of the base. */
  near: number;
}

export interface MapReport {
  checks: Check[];
  ore: OreShare[];
  /** (max - min) / max of the per-player ore totals. */
  spread: number;
  /** No errors: the map can be played in skirmish. */
  playable: boolean;
  errors: number;
  warnings: number;
}

const cellOf = (s: { x: number; y: number }) => [Math.floor(s.x), Math.floor(s.y)] as const;

/** Water cells near a start where a 3×3 shipyard fits next to land the base reaches. */
function shipyardSpot(map: GameMap, s: { x: number; y: number }, radius: number, reach: Uint8Array): boolean {
  for (let y = Math.floor(s.y - radius); y <= s.y + radius; y++) for (let x = Math.floor(s.x - radius); x <= s.x + radius; x++) {
    if (Math.hypot(x + 1.5 - s.x, y + 1.5 - s.y) > radius) continue;
    let ok = true;
    for (let dy = 0; dy < 3 && ok; dy++) for (let dx = 0; dx < 3; dx++) {
      if (!map.inBounds(x + dx, y + dy) || map.terrain[map.idx(x + dx, y + dy)] !== T.Water) { ok = false; break; }
    }
    if (!ok) continue;
    for (let dy = -1; dy <= 3; dy++) for (let dx = -1; dx <= 3; dx++) {
      if (dx >= 0 && dx < 3 && dy >= 0 && dy < 3) continue;
      if (map.inBounds(x + dx, y + dy) && reach[map.idx(x + dx, y + dy)]) return true;
    }
  }
  return false;
}

/** Per-player ore shares (the fairness rule of tests/maps.test.ts). */
export function oreShares(map: GameMap): OreShare[] {
  const n = map.startPositions.length;
  const out: OreShare[] = Array.from({ length: n }, () => ({ total: 0, near: 0 }));
  for (let i = 0; i < map.w * map.h; i++) {
    if (!map.ore[i]) continue;
    const k = nearestStart(map, i);
    const v = oreValue(map, i);
    if (k >= 0) out[k].total += v;
    const x = (i % map.w) + 0.5, y = Math.floor(i / map.w) + 0.5;
    map.startPositions.forEach((s, j) => { if (Math.hypot(s.x - x, s.y - y) < 17) out[j].near += v; });
  }
  return out;
}

export function validateMap(def: MapDef, map: GameMap, opts: { skirmish?: boolean } = {}): MapReport {
  const checks: Check[] = [];
  const add = (level: Level, title: string, detail?: string, at?: [number, number]) => checks.push({ level, title, detail, at });
  const starts = map.startPositions;
  const skirmish = opts.skirmish !== false;

  // ---- starts
  if (starts.length < 2) add(skirmish ? 'error' : 'warning', `${starts.length} start position${starts.length === 1 ? '' : 's'}`, 'Skirmish needs 2 to 4 players: add starts with the Start tool or pick a symmetry.');
  else if (starts.length > 4) add('error', `${starts.length} start positions`, 'At most 4 players.');
  else add('ok', `${starts.length} players`, def.symmetry === 'none' ? 'Free layout (no symmetry): check the fairness below.' : undefined);
  let roomOk = true;
  starts.forEach((s, k) => {
    const [sx, sy] = cellOf(s);
    let free = 0, total = 0;
    for (let y = sy - 8; y <= sy + 8; y++) for (let x = sx - 8; x <= sx + 8; x++) {
      if (Math.hypot(x - sx, y - sy) > 8) continue;
      total++;
      if (map.buildable(x, y)) free++;
    }
    let mcv = true;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!map.buildable(sx + dx, sy + dy)) mcv = false;
    const edge = sx >= 8 && sy >= 8 && sx < map.w - 8 && sy < map.h - 8;
    if (!mcv) { roomOk = false; add('error', `Start ${k + 1}: the MCV can't deploy`, 'The 3×3 cells around the start must be open, buildable ground.', [s.x, s.y]); }
    else if (free / total <= 0.92) { roomOk = false; add('warning', `Start ${k + 1}: cramped base`, `${Math.round((free / total) * 100)}% of the cells within 8 of the start are buildable (92% recommended). Clear water, rock, trees or ore.`, [s.x, s.y]); }
    if (!edge) { roomOk = false; add('warning', `Start ${k + 1}: too close to the edge`, 'Keep starts at least 8 cells from the map edge.', [s.x, s.y]); }
  });
  if (roomOk && starts.length) add('ok', 'Every start has room for a full base');
  for (let a = 0; a < starts.length; a++) for (let b = a + 1; b < starts.length; b++) {
    const d = Math.hypot(starts[a].x - starts[b].x, starts[a].y - starts[b].y);
    if (d < 20) add('warning', `Starts ${a + 1} and ${b + 1} are only ${Math.round(d)} cells apart`, 'Bases this close start the game in contact.', [(starts[a].x + starts[b].x) / 2, (starts[a].y + starts[b].y) / 2]);
  }

  // ---- reachability
  if (starts.length >= 2) {
    const [s0x, s0y] = cellOf(starts[0]);
    const land = landReach(map, s0x, s0y, new Set());
    const withBridges = landReach(map, s0x, s0y, bridgeCells(map));
    const cut = starts.filter((s) => !land[map.idx(...cellOf(s))]);
    if (!cut.length) add('ok', 'Every start is reachable by land');
    else {
      const overBridges = cut.filter((s) => withBridges[map.idx(...cellOf(s))]);
      const isolated = cut.filter((s) => !withBridges[map.idx(...cellOf(s))]);
      if (overBridges.length) add('warning', `Start${overBridges.length > 1 ? 's' : ''} ${overBridges.map((s) => starts.indexOf(s) + 1).join(', ')} only reachable over bridges`, 'Bridges can be destroyed: add a ford for a permanent land route.');
      if (isolated.length) {
        const naval = isolated.every((s) => { const [x, y] = cellOf(s); return shipyardSpot(map, s, 12.5, landReach(map, x, y, new Set())); }) && shipyardSpot(map, starts[0], 12.5, land);
        add(naval ? 'warning' : 'error', `Start${isolated.length > 1 ? 's' : ''} ${isolated.map((s) => starts.indexOf(s) + 1).join(', ')} cut off by land`,
          naval ? 'Naval map: armies can only meet by sea (transports) or air. Tag it "Naval" if that is the plan.' : 'No land, ford, bridge or shipyard route: these bases can never meet. Add a ford, a bridge or shore for shipyards.',
          [isolated[0].x, isolated[0].y]);
      }
    }
  }

  // ---- bridges
  const defs = def.bridges ?? [];
  if (defs.length) {
    if (map.bridges.length < defs.length) add('warning', 'A bridge has no crossing', 'Bridges need straight water with land at both ends; it was skipped.');
    else add('ok', `${map.bridges.length} bridge${map.bridges.length === 1 ? '' : 's'}`);
  }

  // ---- ore
  const ore = oreShares(map);
  let spread = 0;
  if (starts.length >= 2) {
    const tot = ore.map((o) => o.total);
    const lo = Math.min(...tot), hi = Math.max(...tot);
    spread = hi > 0 ? (hi - lo) / hi : 0;
    if (hi === 0) add('error', 'No ore on the map', 'Paint ore or gem fields: without them nobody can earn credits.');
    else {
      const pct = Math.round(spread * 1000) / 10;
      if (spread <= 0.03) add('ok', `Ore is fair (${pct}% spread)`, `Per player: ${tot.join(' · ')}.`);
      else add(spread <= 0.1 ? 'warning' : 'error', `Ore is uneven (${pct}% spread)`, `Per player: ${tot.join(' · ')}. Curated maps stay within 3%: use a symmetry or even out the fields.`);
      if (lo < 700) add('warning', 'Little ore per player', `The poorest player has ${lo} (curated maps give everyone more than 700).`);
      const poor = ore.map((o, k) => (o.near < 250 ? k + 1 : 0)).filter(Boolean);
      if (poor.length) add('warning', `Start${poor.length > 1 ? 's' : ''} ${poor.join(', ')}: no ore near the base`, 'Put at least one field within 17 cells of every base.');
    }
  }

  // ---- naval tag
  if (def.naval) {
    const no = starts.filter((s) => { const [x, y] = cellOf(s); return !shipyardSpot(map, s, 12.5, landReach(map, x, y, new Set())); });
    if (no.length) add('warning', 'Tagged naval, but not every base has shipyard water', `Start${no.length > 1 ? 's' : ''} ${no.map((s) => starts.indexOf(s) + 1).join(', ')}: needs a 3×3 patch of water within 12 cells.`);
  }

  const errors = checks.filter((c) => c.level === 'error').length;
  const warnings = checks.filter((c) => c.level === 'warning').length;
  return { checks, ore, spread, playable: errors === 0, errors, warnings };
}

/** Why a structure can't stand at (cx, cy) on this map (null = fine); `taken` marks cells other placements use. */
export function footprintProblem(map: GameMap, type: string, cx: number, cy: number, taken?: Set<number>): string | null {
  const bt = BUILDINGS[type];
  if (!bt) return 'unknown structure';
  for (let dy = 0; dy < bt.size[1]; dy++) for (let dx = 0; dx < bt.size[0]; dx++) {
    const x = cx + dx, y = cy + dy;
    if (!map.inBounds(x, y)) return 'outside the map';
    const i = map.idx(x, y);
    const t = map.terrain[i];
    if (bt.water ? t !== T.Water : t === T.Water || t === T.Rock) return bt.water ? 'needs water' : t === T.Water ? 'on water' : 'on rock';
    if (taken?.has(i)) return 'overlaps another structure';
  }
  return null;
}

/** Mission checks that need the built map (placement terrain, overlaps, areas) plus the spec checks. */
export function validateMission(spec: MissionSpec, map: GameMap): Check[] {
  const out: Check[] = checkMission(spec, map.startPositions.length).map((i) => ({ level: i.level, title: i.text }));
  const taken = new Set<number>();
  spec.placements.forEach((pl) => {
    if (pl.kind === 'structure') {
      const bt = BUILDINGS[pl.type];
      if (!bt) return;
      const cx = Math.round(pl.x), cy = Math.round(pl.y);
      const why = footprintProblem(map, pl.type, cx, cy, taken);
      if (why) out.push({ level: 'error', title: `${bt.name} (player ${pl.player + 1}) ${why}`, at: [cx + bt.size[0] / 2, cy + bt.size[1] / 2] });
      for (let dy = 0; dy < bt.size[1]; dy++) for (let dx = 0; dx < bt.size[0]; dx++) if (map.inBounds(cx + dx, cy + dy)) taken.add(map.idx(cx + dx, cy + dy));
    } else {
      const ut = UNITS[pl.type];
      if (!ut) return;
      const x = Math.floor(pl.x), y = Math.floor(pl.y);
      if (!map.inBounds(x, y)) { out.push({ level: 'error', title: `${ut.name} is outside the map` }); return; }
      const wet = map.terrain[map.idx(x, y)] === T.Water;
      if (ut.kind === 'naval' && !wet) out.push({ level: 'warning', title: `${ut.name} (player ${pl.player + 1}) is on land`, detail: 'Ships are moved to the nearest water.', at: [pl.x, pl.y] });
      if (ut.kind !== 'naval' && ut.kind !== 'aircraft' && !map.terrainPassable(map.idx(x, y))) out.push({ level: 'warning', title: `${ut.name} (player ${pl.player + 1}) stands on blocked ground`, detail: 'It will be moved to the nearest free spot.', at: [pl.x, pl.y] });
    }
  });
  if (!out.some((c) => c.level === 'error')) out.unshift({ level: 'ok', title: 'Mission is ready to play' });
  return out;
}
