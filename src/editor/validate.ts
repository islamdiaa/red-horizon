/**
 * Map / mission validation for the editor (no DOM). The map checks are the ones the curated-map test
 * suite (tests/maps.test.ts) holds every shipped map to: room for a base at every start, starts linked
 * by land, ore shared fairly (same nearest-start rule, gems count double), bridges that span water.
 */
import { bridgeCells, landReach, nearestStart, oreValue } from '../maps/build';
import type { MapDef } from '../maps/format';
import { BUILDINGS, UNITS } from '../data/rules';
import { T, type GameMap } from '../sim/map';
import type { MissionSpec, Placement } from './mission';
import tEd from '../i18n/en/editor'; // interface strings (checks are built when the Check tab shows them)
import { fmtInt, fmtNum } from '../i18n/core';
import { typeName } from '../i18n/names';

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
/** Start numbers as a list: "2, 3". */
const startList = (nums: number[]) => nums.join(', ');

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
  if (starts.length < 2) add(skirmish ? 'error' : 'warning', tEd('vmap.startsFew', { n: starts.length }), tEd('vmap.startsFewDetail'));
  else if (starts.length > 4) add('error', tEd('vmap.startsMany', { n: starts.length }), tEd('vmap.startsManyDetail'));
  else add('ok', tEd('vmap.players', { n: starts.length }), def.symmetry === 'none' ? tEd('vmap.freeLayout') : undefined);
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
    if (!mcv) { roomOk = false; add('error', tEd('vmap.noDeploy', { n: k + 1 }), tEd('vmap.noDeployDetail'), [s.x, s.y]); }
    else if (free / total <= 0.92) { roomOk = false; add('warning', tEd('vmap.cramped', { n: k + 1 }), tEd('vmap.crampedDetail', { pct: Math.round((free / total) * 100) }), [s.x, s.y]); }
    if (!edge) { roomOk = false; add('warning', tEd('vmap.edge', { n: k + 1 }), tEd('vmap.edgeDetail'), [s.x, s.y]); }
  });
  if (roomOk && starts.length) add('ok', tEd('vmap.room'));
  for (let a = 0; a < starts.length; a++) for (let b = a + 1; b < starts.length; b++) {
    const d = Math.hypot(starts[a].x - starts[b].x, starts[a].y - starts[b].y);
    if (d < 20) add('warning', tEd('vmap.close', { a: a + 1, b: b + 1, d: Math.round(d) }), tEd('vmap.closeDetail'), [(starts[a].x + starts[b].x) / 2, (starts[a].y + starts[b].y) / 2]);
  }

  // ---- reachability
  if (starts.length >= 2) {
    const [s0x, s0y] = cellOf(starts[0]);
    const land = landReach(map, s0x, s0y, new Set());
    const withBridges = landReach(map, s0x, s0y, bridgeCells(map));
    const cut = starts.filter((s) => !land[map.idx(...cellOf(s))]);
    if (!cut.length) add('ok', tEd('vmap.reachable'));
    else {
      const overBridges = cut.filter((s) => withBridges[map.idx(...cellOf(s))]);
      const isolated = cut.filter((s) => !withBridges[map.idx(...cellOf(s))]);
      if (overBridges.length) add('warning', tEd('vmap.bridgesOnly', { n: overBridges.length, list: startList(overBridges.map((s) => starts.indexOf(s) + 1)) }), tEd('vmap.bridgesOnlyDetail'));
      if (isolated.length) {
        const naval = isolated.every((s) => { const [x, y] = cellOf(s); return shipyardSpot(map, s, 12.5, landReach(map, x, y, new Set())); }) && shipyardSpot(map, starts[0], 12.5, land);
        add(naval ? 'warning' : 'error', tEd('vmap.cutOff', { n: isolated.length, list: startList(isolated.map((s) => starts.indexOf(s) + 1)) }),
          tEd(naval ? 'vmap.navalOnly' : 'vmap.isolated'),
          [isolated[0].x, isolated[0].y]);
      }
    }
  }

  // ---- bridges
  const defs = def.bridges ?? [];
  if (defs.length) {
    if (map.bridges.length < defs.length) add('warning', tEd('vmap.badBridge'), tEd('vmap.badBridgeDetail'));
    else add('ok', tEd('vmap.bridges', { n: map.bridges.length }));
  }

  // ---- ore
  const ore = oreShares(map);
  let spread = 0;
  if (starts.length >= 2) {
    const tot = ore.map((o) => o.total);
    const lo = Math.min(...tot), hi = Math.max(...tot);
    spread = hi > 0 ? (hi - lo) / hi : 0;
    if (hi === 0) add('error', tEd('vmap.noOre'), tEd('vmap.noOreDetail'));
    else {
      const pct = fmtNum(Math.round(spread * 1000) / 10, 1);
      const list = tot.map((t) => fmtInt(t)).join(' · ');
      if (spread <= 0.03) add('ok', tEd('vmap.oreFair', { pct }), tEd('vmap.perPlayer', { list }));
      else add(spread <= 0.1 ? 'warning' : 'error', tEd('vmap.oreUneven', { pct }), tEd('vmap.oreUnevenDetail', { list }));
      if (lo < 700) add('warning', tEd('vmap.littleOre'), tEd('vmap.littleOreDetail', { n: lo }));
      const poor = ore.map((o, k) => (o.near < 250 ? k + 1 : 0)).filter(Boolean);
      if (poor.length) add('warning', tEd('vmap.noOreNear', { n: poor.length, list: startList(poor) }), tEd('vmap.noOreNearDetail'));
    }
  }

  // ---- naval tag
  if (def.naval) {
    const no = starts.filter((s) => { const [x, y] = cellOf(s); return !shipyardSpot(map, s, 12.5, landReach(map, x, y, new Set())); });
    if (no.length) add('warning', tEd('vmap.navalTag'), tEd('vmap.navalTagDetail', { n: no.length, list: startList(no.map((s) => starts.indexOf(s) + 1)) }));
  }

  const errors = checks.filter((c) => c.level === 'error').length;
  const warnings = checks.filter((c) => c.level === 'warning').length;
  return { checks, ore, spread, playable: errors === 0, errors, warnings };
}

/** Why a structure can't stand somewhere (its text: src/i18n/en/editor.ts why.*). */
export type FootprintProblem = 'unknown' | 'outside' | 'needsWater' | 'water' | 'rock' | 'overlap';

/** Why a structure can't stand at (cx, cy) on this map (null = fine); `taken` marks cells other placements use. */
export function footprintProblem(map: GameMap, type: string, cx: number, cy: number, taken?: Set<number>): FootprintProblem | null {
  const bt = BUILDINGS[type];
  if (!bt) return 'unknown';
  for (let dy = 0; dy < bt.size[1]; dy++) for (let dx = 0; dx < bt.size[0]; dx++) {
    const x = cx + dx, y = cy + dy;
    if (!map.inBounds(x, y)) return 'outside';
    const i = map.idx(x, y);
    const t = map.terrain[i];
    if (bt.water ? t !== T.Water : t === T.Water || t === T.Rock) return bt.water ? 'needsWater' : t === T.Water ? 'water' : 'rock';
    if (taken?.has(i)) return 'overlap';
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
      if (why) out.push({ level: 'error', title: tEd('vmission.footprint', { name: typeName(bt), n: pl.player + 1, why: tEd(`why.${why}`) }), at: [cx + bt.size[0] / 2, cy + bt.size[1] / 2] });
      for (let dy = 0; dy < bt.size[1]; dy++) for (let dx = 0; dx < bt.size[0]; dx++) if (map.inBounds(cx + dx, cy + dy)) taken.add(map.idx(cx + dx, cy + dy));
    } else {
      const ut = UNITS[pl.type];
      if (!ut) return;
      const x = Math.floor(pl.x), y = Math.floor(pl.y);
      if (!map.inBounds(x, y)) { out.push({ level: 'error', title: tEd('vmission.outside', { name: typeName(ut) }) }); return; }
      const wet = map.terrain[map.idx(x, y)] === T.Water;
      if (ut.kind === 'naval' && !wet) out.push({ level: 'warning', title: tEd('vmission.onLand', { name: typeName(ut), n: pl.player + 1 }), detail: tEd('vmission.onLandDetail'), at: [pl.x, pl.y] });
      if (ut.kind !== 'naval' && ut.kind !== 'aircraft' && !map.terrainPassable(map.idx(x, y))) out.push({ level: 'warning', title: tEd('vmission.blocked', { name: typeName(ut), n: pl.player + 1 }), detail: tEd('vmission.blockedDetail'), at: [pl.x, pl.y] });
    }
  });
  if (!out.some((c) => c.level === 'error')) out.unshift({ level: 'ok', title: tEd('vmission.ready') });
  return out;
}

// =====================================================================================================
// Mission validation (structure + references; validateMission adds the map-dependent checks)
// =====================================================================================================
export interface MissionIssue {
  level: 'error' | 'warning';
  text: string;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function checkMission(spec: MissionSpec, starts: number): MissionIssue[] {
  const out: MissionIssue[] = [];
  const err = (text: string) => out.push({ level: 'error', text });
  const warn = (text: string) => out.push({ level: 'warning', text });
  if (!spec.title?.trim()) err(tEd('vmission.noTitle'));
  if (!spec.players?.length) { err(tEd('vmission.noPlayers')); return out; }
  if (spec.players.length > starts) err(tEd('vmission.tooManyPlayers', { n: spec.players.length, starts }));
  if (spec.players.length > 6) err(tEd('vmission.maxPlayers'));
  const p0 = spec.players[0];
  if (!spec.players.slice(1).some((p) => p.team !== p0.team) && !spec.objectives.some((o) => o.kind === 'survive' || o.kind === 'reach' || o.kind === 'build')) {
    warn(tEd('vmission.noEnemy'));
  }
  const tags = new Map<string, Placement>();
  spec.placements.forEach((pl, i) => {
    const t = pl.kind === 'unit' ? UNITS[pl.type] : BUILDINGS[pl.type];
    if (!t) err(tEd('vmission.unknownType', { i: i + 1, kind: pl.kind, type: pl.type }));
    if (!(pl.player >= 0 && pl.player < spec.players.length)) err(tEd('vmission.noPlayer', { i: i + 1, name: t ? typeName(t) : pl.type, n: pl.player + 1 }));
    if (pl.tag) {
      if (tags.has(pl.tag)) err(tEd('vmission.tagTwice', { tag: pl.tag }));
      tags.set(pl.tag, pl);
    }
    if (pl.health !== undefined && !(pl.health > 0 && pl.health <= 1)) err(tEd('vmission.health', { i: i + 1 }));
  });
  const hasForces = spec.placements.some((p) => p.player === 0) || p0.startUnits !== 'none';
  if (!hasForces && !spec.triggers.some((t) => t.when === 'start' && t.actions.some((a) => a.kind === 'reinforce' && (a.player ?? 0) === 0))) {
    err(tEd('vmission.noForces'));
  }
  const objIds = new Set<string>();
  for (const o of spec.objectives) {
    const name = o.text || o.id;
    if (objIds.has(o.id)) err(tEd('vmission.objectiveTwice', { id: o.id }));
    objIds.add(o.id);
    if (!o.text?.trim()) warn(tEd('vmission.noText', { name }));
    switch (o.kind) {
      case 'destroy':
      case 'protect': {
        const pl = o.tag ? tags.get(o.tag) : undefined;
        if (!pl) { err(tEd('vmission.chooseTag', { name })); break; }
        if (o.kind === 'destroy' && pl.player === 0) err(tEd('vmission.ownTarget', { name }));
        if (o.kind === 'protect' && spec.players[pl.player] && spec.players[pl.player].team !== p0.team) warn(tEd('vmission.protectEnemy', { name }));
        break;
      }
      case 'destroyAll':
        if (o.player !== undefined && !(o.player > 0 && o.player < spec.players.length)) err(tEd('vmission.noSuchPlayer', { name, n: o.player + 1 }));
        break;
      case 'survive':
        if (!isNum(o.seconds) || o.seconds < 10) err(tEd('vmission.surviveShort', { name }));
        break;
      case 'reach':
        if (!isNum(o.x) || !isNum(o.y) || !isNum(o.r) || o.r < 1) err(tEd('vmission.placeArea', { name }));
        break;
      case 'build':
        if (!o.type || !BUILDINGS[o.type]) err(tEd('vmission.chooseStructure', { name }));
        if (!isNum(o.count) || o.count < 1) err(tEd('vmission.buildOne', { name }));
        break;
    }
  }
  const primaries = spec.objectives.filter((o) => o.primary);
  if (!primaries.length) err(tEd('vmission.noPrimary'));
  if (primaries.length && primaries.every((o) => o.kind === 'protect')) warn(tEd('vmission.onlyProtect'));
  for (const t of spec.triggers) {
    const name = t.id;
    if ((t.when === 'objectiveDone' || t.when === 'objectiveFailed') && !objIds.has(t.objective ?? '')) err(tEd('vmission.unknownObjective', { name }));
    if (t.when === 'destroyed' && !tags.has(t.tag ?? '')) err(tEd('vmission.unknownTag', { name, tag: t.tag ?? '' }));
    if (t.when === 'time' && (!isNum(t.seconds) || t.seconds < 0)) err(tEd('vmission.setTime', { name }));
    if (t.when === 'area' && (!isNum(t.x) || !isNum(t.y) || !isNum(t.r))) err(tEd('vmission.triggerArea', { name }));
    if (!t.actions.length) warn(tEd('vmission.doesNothing', { name }));
    for (const a of t.actions) {
      if ((a.kind === 'reinforce' || a.kind === 'credits' || a.kind === 'ai' || a.kind === 'attack') && !(isNum(a.player) && a.player >= 0 && a.player < spec.players.length)) err(tEd('vmission.choosePlayer', { name }));
      if (a.kind === 'reinforce') {
        if (!a.units?.length || a.units.some((u) => !UNITS[u])) err(tEd('vmission.badUnits', { name }));
        if (!isNum(a.x) || !isNum(a.y)) err(tEd('vmission.noArrival', { name }));
      }
      if (a.kind === 'objective' && !spec.objectives.some((o) => o.id === a.objective && o.hidden)) err(tEd('vmission.notHidden', { name, objective: a.objective ?? '' }));
      if (a.kind === 'message' && !a.text?.trim()) warn(tEd('vmission.emptyMessage', { name }));
    }
  }
  for (const o of spec.objectives) {
    if (o.hidden && !spec.triggers.some((t) => t.actions.some((a) => a.kind === 'objective' && a.objective === o.id))) warn(tEd('vmission.neverRevealed', { name: o.text || o.id }));
  }
  return out;
}
