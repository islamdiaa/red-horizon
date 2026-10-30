// Frozen copy of the simulation-version-2 skirmish AI (src/sim/ai-naval.ts as it was then), used by
// the self-play harness as the "experienced player" stand-in (tools/selfplay/standin.ts). Do not edit: it is a
// fixed yardstick, so the difficulty benchmarks stay comparable across AI changes.
/**
 * Naval AI, run by every AIController (see the hooks in ai.ts): decides whether a navy is worth having, builds
 * a shipyard / sub pen and a fleet, defends its home waters, hunts enemy ships and bombards structures near
 * the coast with cruisers. The commander personality (ai-personality.ts) scales its appetite for a navy; without map-hack
 * it only hunts ships and yards its side has seen (ai-intel.ts).
 *
 * A navy is only built when the base has a decent body of water nearby that also reaches an enemy base (or
 * the enemy already has ships), so land maps never waste money on it. The logic is stateless between thinks
 * (everything is derived from the world), so saved games need nothing extra.
 */
import { BUILDINGS, type BuildingTypeDef } from '../../../src/data/rules';
import { Building, Unit, type Entity } from '../../../src/sim/entities';
import type { GameMap } from '../../../src/sim/map';
import type { Player } from '../../../src/sim/player';
import { pickWeapon } from '../../../src/sim/combat';
import { TICK_HZ } from '../../../src/sim/types';
import type { World } from '../../../src/sim/world';
import type { AIDifficulty } from './ai';
import type { AIIntel } from './ai-intel';
import { trait, type Personality } from './ai-personality';
import { ceasefireActive, hostileTo, inHomeArea } from '../../../src/sim/ceasefire';

/** What the naval AI reads from its AIController (optional: missions' scripted use and tests may omit it). */
export interface NavalAIView {
  personality: Personality;
  intel: AIIntel;
}

/**
 * Water bodies smaller than this are lakes, not seas worth a navy: 7% of the map (generated sea maps have a sea
 * of 10% or more; the lakes of a default skirmish map stay under 6%).
 */
const minSea = (m: GameMap) => Math.max(150, m.w * m.h * 0.07);
/** Water within this many cells of a base counts as its home waters. */
const HOME_R = 15;
/** Ships per difficulty. */
const FLEET_CAP: Record<AIDifficulty, number> = { easy: 2, normal: 4, hard: 6, brutal: 8 };

interface SeaInfo {
  /** Body label per cell (-1 = not navigable water). */
  label: Int32Array;
  size: number[];
  /** Bridge-deck state the labels were computed for (terrain itself never changes in play). */
  key: string;
  /** Per body: distance (cells, BFS over everything) from that body's water; built on demand. */
  coast: Map<number, Float32Array>;
}
const seaCache = new WeakMap<GameMap, SeaInfo>();

/** Water bodies of the map (recomputed when a bridge deck collapses or is repaired). */
export function seaInfo(m: GameMap): SeaInfo {
  let key = '';
  for (const b of m.bridges) for (const [x, y] of b.cells) key += m.inBounds(x, y) && m.bridgeAt[m.idx(x, y)] ? '1' : '0';
  const old = seaCache.get(m);
  if (old && old.key === key) return old;
  const label = new Int32Array(m.w * m.h).fill(-1);
  const size: number[] = [];
  const q = new Int32Array(m.w * m.h);
  for (let s = 0; s < m.w * m.h; s++) {
    if (label[s] !== -1 || !m.navalTerrain(s)) continue;
    const id = size.length;
    let qh = 0, qt = 0;
    q[qt++] = s;
    label[s] = id;
    while (qh < qt) {
      const i = q[qh++];
      const x = i % m.w, y = (i / m.w) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue;
        const j = ny * m.w + nx;
        if (label[j] !== -1 || !m.navalTerrain(j)) continue;
        // diagonal moves need an open orthogonal neighbour (as the path search)
        if (dx && dy && !m.navalTerrain(y * m.w + nx) && !m.navalTerrain(ny * m.w + x)) continue;
        label[j] = id;
        q[qt++] = j;
      }
    }
    size.push(qt);
  }
  const info: SeaInfo = { label, size, key, coast: new Map() };
  seaCache.set(m, info);
  return info;
}

/** Distance from every cell to the nearest water cell of body `id`. */
function coastDistance(m: GameMap, info: SeaInfo, id: number): Float32Array {
  let d = info.coast.get(id);
  if (d) return d;
  d = new Float32Array(m.w * m.h).fill(1e9);
  const q = new Int32Array(m.w * m.h);
  let qh = 0, qt = 0;
  for (let i = 0; i < m.w * m.h; i++) if (info.label[i] === id) { d[i] = 0; q[qt++] = i; }
  while (qh < qt) {
    const i = q[qh++];
    const x = i % m.w, y = (i / m.w) | 0;
    const nd = d[i] + 1;
    if (x > 0 && d[i - 1] > nd) { d[i - 1] = nd; q[qt++] = i - 1; }
    if (x < m.w - 1 && d[i + 1] > nd) { d[i + 1] = nd; q[qt++] = i + 1; }
    if (y > 0 && d[i - m.w] > nd) { d[i - m.w] = nd; q[qt++] = i - m.w; }
    if (y < m.h - 1 && d[i + m.w] > nd) { d[i + m.w] = nd; q[qt++] = i + m.w; }
  }
  info.coast.set(id, d);
  return d;
}

/** Sea bodies (label ids) within HOME_R of a point. */
function watersNear(m: GameMap, info: SeaInfo, x: number, y: number, r = HOME_R): Set<number> {
  const out = new Set<number>();
  const fx = Math.floor(x), fy = Math.floor(y);
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (dx * dx + dy * dy > r * r) continue;
    const cx = fx + dx, cy = fy + dy;
    if (!m.inBounds(cx, cy)) continue;
    const id = info.label[m.idx(cx, cy)];
    if (id >= 0 && info.size[id] >= minSea(m)) out.add(id);
  }
  return out;
}

/** Centre of a player's base: its Construction Yard, its structures, or its start position. */
export function baseOf(world: World, p: Player): [number, number] {
  const fact = world.buildings.find((b) => b.alive && b.owner === p && b.bt.id === 'fact');
  if (fact) return [fact.x, fact.y];
  let n = 0, sx = 0, sy = 0;
  for (const b of world.buildings) if (b.alive && b.owner === p && !b.bt.wall) { n++; sx += b.x; sy += b.y; }
  if (n) return [sx / n, sy / n];
  const s = world.map.startPositions[p.id % world.map.startPositions.length];
  return [s.x, s.y];
}

const isNavalYard = (b: Building) => !!b.bt.water && b.bt.factory === 'naval';

/** Enemy naval presence the AI knows of: ships seen recently, yards it has spotted (everything without intel). */
function enemyNavy(world: World, p: Player, ai?: NavalAIView): { ships: Unit[]; subs: boolean; yards: Building[] } {
  const ships: Unit[] = [];
  let subs = false;
  const recent = world.tick - TICK_HZ * 30;
  for (const u of world.units) {
    if (!u.alive || u.kind !== 'naval' || !p.isEnemy(u.owner)) continue;
    if (ai && !ai.intel.sees(u) && !((ai.intel.units.get(u.id)?.seen ?? -1e9) >= recent)) continue;
    if (u.ut.cloakable) subs = true;
    ships.push(u);
  }
  const yards = world.buildings.filter((b) => b.alive && isNavalYard(b) && p.isEnemy(b.owner) && (!ai || ai.intel.structures.has(b.id)));
  if (yards.some((b) => b.bt.id === 'spen')) subs = true;
  return { ships, subs, yards };
}

/** Our home sea bodies that also wash an enemy base (water-borne attack possible). */
function sharedWaters(world: World, p: Player, info: SeaInfo): Set<number> {
  const [bx, by] = baseOf(world, p);
  const mine = watersNear(world.map, info, bx, by);
  const out = new Set<number>();
  if (!mine.size) return out;
  for (const o of world.players) {
    if (o.defeated || !p.isEnemy(o)) continue;
    const [ox, oy] = baseOf(world, o);
    for (const id of watersNear(world.map, info, ox, oy)) if (mine.has(id)) out.add(id);
  }
  return out;
}

/** Whether this AI should run a navy at all. */
function navyWanted(world: World, p: Player, info: SeaInfo, ai?: NavalAIView): boolean {
  const [bx, by] = baseOf(world, p);
  const home = watersNear(world.map, info, bx, by);
  if (!home.size) return false;
  const naval = ai?.personality.naval ?? 0.5;
  // (a commander who hates the sea only answers a fleet in its own waters)
  if (naval >= 0.15 && sharedWaters(world, p, info).size) return true;
  // enemy ships that could reach our waters
  const { ships, yards } = enemyNavy(world, p, ai);
  return ships.some((u) => home.has(info.label[world.map.idx(Math.floor(u.x), Math.floor(u.y))])) ||
    yards.some((b) => home.has(info.label[world.map.idx(b.cx, b.cy)]));
}

/** Best spot for a shipyard / sub pen: valid placement on a sea near the base (enemy-shared waters first). */
export function navalPlacement(world: World, p: Player, bt: BuildingTypeDef): [number, number] | null {
  const m = world.map;
  const info = seaInfo(m);
  const [bx, by] = baseOf(world, p);
  const shared = sharedWaters(world, p, info);
  let best: [number, number] | null = null, bestScore = Infinity;
  const R = 18;
  const ox = Math.round(bx - bt.size[0] / 2), oy = Math.round(by - bt.size[1] / 2);
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const px = ox + dx, py = oy + dy;
    if (!m.inBounds(px, py) || !m.inBounds(px + bt.size[0] - 1, py + bt.size[1] - 1)) continue;
    const id = info.label[m.idx(px, py)];
    if (id < 0 || info.size[id] < minSea(m)) continue;
    const score = Math.hypot(dx, dy) + (shared.size && !shared.has(id) ? 20 : 0);
    if (score >= bestScore) continue;
    if (!world.canPlace(p, bt.id, px, py)) continue;
    bestScore = score;
    best = [px, py];
  }
  return best;
}

/**
 * Land structures: when we want a navy but no water spot is in reach yet, power plants and silos are used as
 * stepping stones that grow the base towards the shore. Returns null to let the normal placement decide.
 */
function shorewardPlacement(world: World, p: Player, bt: BuildingTypeDef, ai?: NavalAIView): [number, number] | null {
  if (bt.id !== 'powr' && bt.id !== 'apwr' && bt.id !== 'silo') return null;
  const yard = p.faction === 'allies' ? 'syrd' : 'spen';
  if (!p.canBuild(yard) || world.buildings.some((b) => b.alive && b.owner === p && isNavalYard(b))) return null;
  const m = world.map;
  const info = seaInfo(m);
  if (!navyWanted(world, p, info, ai)) return null;
  if (navalPlacement(world, p, BUILDINGS[yard])) return null;
  const [bx, by] = baseOf(world, p);
  const shared = sharedWaters(world, p, info);
  const targets = shared.size ? shared : watersNear(m, info, bx, by);
  let best: [number, number] | null = null, bestScore = Infinity;
  const R = 14;
  for (const id of targets) {
    const coast = coastDistance(m, info, id);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const px = Math.round(bx) + dx, py = Math.round(by) + dy;
      if (!m.inBounds(px, py)) continue;
      const cd = coast[m.idx(px, py)];
      if (cd < 2) continue;
      const score = cd * 2 + Math.hypot(dx, dy) * 0.3;
      if (score >= bestScore) continue;
      if (!world.canPlace(p, bt.id, px, py)) continue;
      // keep a walkway around it
      let crowded = false;
      for (let y = py - 1; y <= py + bt.size[1] && !crowded; y++) for (let x = px - 1; x <= px + bt.size[0]; x++) {
        if (x >= px && x < px + bt.size[0] && y >= py && y < py + bt.size[1]) continue;
        if (m.inBounds(x, y) && m.occupant[m.idx(x, y)]) { crowded = true; break; }
      }
      if (crowded) continue;
      bestScore = score;
      best = [px, py];
    }
  }
  return best;
}

/** placeReadyStructure hook: naval yards go on water, other buildings may creep towards the shore. */
export function aiPlacement(world: World, p: Player, bt: BuildingTypeDef, ai?: NavalAIView): [number, number] | null {
  if (bt.water) return navalPlacement(world, p, bt);
  return shorewardPlacement(world, p, bt, ai);
}

/** planStructures hook: the shipyard / sub pen once the core base stands and a navy makes sense. */
export function aiNavalStructure(world: World, p: Player, ai?: NavalAIView): string | null {
  const type = p.faction === 'allies' ? 'syrd' : 'spen';
  if (!p.canBuild(type) || !p.has('weap')) return null;
  if (world.buildings.some((b) => b.alive && b.owner === p && isNavalYard(b))) return null;
  // a lost yard is rebuilt after a pause, and only twice while the enemy fleet that sank it is still afloat
  if (p.yardsLost && world.tick - p.yardLostTick < TICK_HZ * 150) return null;
  if (p.yardsLost >= 3 && enemyNavy(world, p, ai).ships.some((u) => u.weapons.length)) return null;
  const naval = ai?.personality.naval ?? 0.5;
  let procs = 0;
  for (const b of world.buildings) if (b.alive && b.owner === p && b.bt.id === 'proc') procs++;
  if (procs < (naval >= 0.8 ? 1 : 2) && world.time < 600) return null;
  // (like the land AI: start a structure with half its price in the bank)
  if (p.powerOut - p.powerUse < 30 || p.credits < 350) return null;
  const info = seaInfo(world.map);
  if (!navyWanted(world, p, info, ai)) return null;
  // subs only fight ships: the Soviets wait until there is something to sink (or the match drags on);
  // a naval commander builds its pens anyway
  if (p.faction === 'soviet' && naval < 0.8) {
    const { ships, yards } = enemyNavy(world, p, ai);
    if (!ships.length && !yards.length && world.time < 900 * trait(naval, 1.5, 0.6)) return null;
  }
  const spot = navalPlacement(world, p, BUILDINGS[type]);
  if (!spot) return null;
  // don't launch a yard into a waiting wolf pack (the AI knows where the enemy fleet is, as for land units)
  const cx = spot[0] + 1.5, cy = spot[1] + 1.5;
  if (enemyNavy(world, p, ai).ships.some((u) => u.weapons.length && Math.hypot(u.x - cx, u.y - cy) < 14)) return null;
  return type;
}

// ---------------------------------------------------------------------------
// Fleet
// ---------------------------------------------------------------------------

const ALLIED_MIX: [string, number][] = [['pt', 25], ['dd', 40], ['ca', 35]];
/**
 * Skirmish: cruisers first. Their 8-inch guns shell the shore from 20 cells out, which is what wins a sea map; gunboats
 * and destroyers mostly hunt Soviet submarines (ANTI_SUB_MIX once subs show up). Self-play on generated sea maps:
 * Allied win share 36% with the mission mix, 48% with this one.
 */
const ALLIED_SKIRMISH_MIX: [string, number][] = [['pt', 15], ['dd', 40], ['ca', 63]];
const ANTI_SUB_SKIRMISH_MIX: [string, number][] = [['pt', 18], ['dd', 60], ['ca', 22]];
const ANTI_SUB_MIX: [string, number][] = [['pt', 30], ['dd', 60], ['ca', 10]];

function pick(world: World, p: Player, mix: [string, number][], ai?: NavalAIView): string | null {
  const opts = mix.filter(([t]) => p.canBuild(t)).map(([t, w]): [string, number] => [t, w * (ai?.personality.prefer?.[t] ?? 1)]);
  if (!opts.length) return null;
  const total = opts.reduce((s, [, w]) => s + w, 0);
  let r = world.rng.next() * total;
  for (const [t, w] of opts) { r -= w; if (r <= 0) return t; }
  return opts[0][0];
}

/** Naval think: production, rally point, defence, hunting, shore bombardment. `defensive` = never attack. */
export function aiNavalThink(world: World, p: Player, thinks: number, difficulty: AIDifficulty, defensive: boolean, ai?: NavalAIView) {
  // every 3 s, staggered per player
  if ((thinks + p.id) % 3 !== 0) return;
  const yards = world.buildings.filter((b) => b.alive && b.owner === p && isNavalYard(b) && b.active);
  const ships = world.units.filter((u) => u.alive && u.owner === p && u.kind === 'naval' && u.weapons.length);
  if (!yards.length && !ships.length) return;
  const m = world.map;
  const info = seaInfo(m);
  const enemy = enemyNavy(world, p, ai);
  // (ships seen recently; submerged subs only once detected)
  const visibleEnemy = enemy.ships.filter((u) => !u.cloaked || world.canSee(p, u));
  const [bx, by] = baseOf(world, p);

  // --- production
  if (yards.length) {
    const yard = yards[0];
    if (yard.rallyX < 0) {
      const a = Math.atan2(yard.y - by, yard.x - bx);
      const [rx, ry] = world.findFreeSpot(yard.x + Math.cos(a) * 4, yard.y + Math.sin(a) * 4, 5, true, true);
      if (m.navalPassable(Math.floor(rx), Math.floor(ry))) world.issue({ c: 'rally', player: p.id, building: yard.id, x: rx, y: ry });
    }
    const q = p.queues.naval;
    const shared = sharedWaters(world, p, info).size > 0;
    const naval = ai?.personality.naval ?? 0.5;
    let cap = Math.round(FLEET_CAP[difficulty] * trait(naval, 0.3, 2));
    if (p.faction === 'soviet' && naval < 0.8) cap = Math.min(cap, Math.max(2, enemy.ships.length + 1));
    else if (!shared) cap = Math.min(cap, 2 + enemy.ships.length);
    // one hull at a time, paid as it is built like the land queues (so the land army isn't starved)
    const reserve = world.time < 600 ? 600 : 250;
    if (!q.items.length && ships.length < cap && p.credits > reserve) {
      const t = p.faction === 'soviet' ? (p.canBuild('ss') ? 'ss' : null) : pick(world, p, world.mission ? (enemy.subs ? ANTI_SUB_MIX : ALLIED_MIX) : enemy.subs ? ANTI_SUB_SKIRMISH_MIX : ALLIED_SKIRMISH_MIX, ai);
      if (t) world.issue({ c: 'build', player: p.id, type: t });
    }
  }
  if (!ships.length) return;

  const idle = ships.filter((u) => (u.order.type === 'idle' || u.order.type === 'guard') && !u.target);
  const home = yards[0] ?? null;

  // --- damaged ships limp home to be repaired alongside the yard
  if (home) {
    const hurt = idle.filter((u) => u.healthFrac < 0.45 && home.distTo(u.x, u.y) > 1.5);
    for (const u of hurt) {
      const [x, y] = world.findFreeSpot(home.x, home.y, 3, true, true);
      world.issue({ c: 'move', player: p.id, units: [u.id], x, y });
    }
  }
  const fit = idle.filter((u) => u.healthFrac >= 0.45);

  // --- defend home waters: every ship not already fighting turns on intruders
  // (build-up time: only ships inside the base area or shooting at us count; the rest are left in peace)
  const truce = ceasefireActive(world);
  const intruder = nearest(visibleEnemy.filter((u) => (Math.hypot(u.x - bx, u.y - by) < HOME_R + 8 ||
    (home && Math.hypot(u.x - home.x, u.y - home.y) < 12)) && (!truce || hostileTo(world, p, u) || inHomeArea(world, p, u.x, u.y))), bx, by);
  if (intruder) {
    const ids = ships.filter((u) => u.order.type !== 'attack' && pickWeapon(u, intruder)).map((u) => u.id);
    if (ids.length) world.issue({ c: 'move', player: p.id, units: ids, x: intruder.x, y: intruder.y, attackMove: true });
    return;
  }
  if (defensive || !fit.length) return;
  const busy = new Set<number>();

  // --- hunt: enemy ships (and their yards) when the fleet is the stronger
  const myValue = ships.reduce((s, u) => s + u.ut.cost * u.healthFrac, 0);
  const theirValue = visibleEnemy.reduce((s, u) => s + u.ut.cost * u.healthFrac, 0);
  const hunters = fit.filter((u) => u.ut.id !== 'ca');
  if (hunters.length && fit.length >= 2 && myValue >= theirValue * 1.3) {
    const prey = nearest(visibleEnemy.filter((u) => hunters.some((h) => pickWeapon(h, u))), hunters[0].x, hunters[0].y) ??
      nearest(enemy.yards.filter((b) => hunters.some((h) => pickWeapon(h, b))), hunters[0].x, hunters[0].y);
    if (prey) {
      const ids = hunters.filter((u) => pickWeapon(u, prey)).map((u) => u.id);
      for (const id of ids) busy.add(id);
      if (ids.length) {
        if (prey instanceof Building) world.issue({ c: 'attack', player: p.id, units: ids, target: prey.id });
        else world.issue({ c: 'move', player: p.id, units: ids, x: prey.x, y: prey.y, attackMove: true });
      }
    }
  }

  // --- coastal raids: with no ships to hunt, destroyers / gunboats shell soft structures near the water
  if (!visibleEnemy.length && hunters.length >= 2 && !enemy.yards.length) {
    const id = info.label[m.idx(Math.floor(hunters[0].x), Math.floor(hunters[0].y))];
    if (id >= 0) {
      const coast = coastDistance(m, info, id);
      let best: Building | null = null, bestD = Infinity;
      for (const b of world.buildings) {
        if (!b.alive || !p.isEnemy(b.owner) || b.bt.wall || b.weapons.length || (ai && !ai.intel.structures.has(b.id))) continue;
        if (coast[m.idx(Math.floor(b.x), Math.floor(b.y))] > 5) continue;
        const d = Math.hypot(b.x - hunters[0].x, b.y - hunters[0].y);
        if (d < bestD) { bestD = d; best = b; }
      }
      const raiders = best ? hunters.filter((u) => pickWeapon(u, best!)).map((u) => u.id) : [];
      for (const id of raiders) busy.add(id);
      if (best && raiders.length) world.issue({ c: 'attack', player: p.id, units: raiders, target: best.id });
    }
  }

  // --- shore bombardment: cruisers shell the most valuable structure their guns can reach from the sea
  const cruisers = fit.filter((u) => u.ut.id === 'ca');
  if (cruisers.length) {
    const id = info.label[m.idx(Math.floor(cruisers[0].x), Math.floor(cruisers[0].y))];
    if (id >= 0) {
      const coast = coastDistance(m, info, id);
      const range = cruisers[0].weapons[0].def.range - 2;
      // (skirmish: Tesla Coils go dark without power, so the plants feeding them come first)
      let coils = 0;
      if (ai && !world.mission) for (const s of ai.intel.structures.values()) if (s.type === 'tsla') coils++;
      let best: Building | null = null, bestScore = Infinity;
      for (const b of world.buildings) {
        if (!b.alive || !p.isEnemy(b.owner) || b.bt.wall || (ai && !ai.intel.structures.has(b.id))) continue;
        if (coast[m.idx(Math.floor(b.x), Math.floor(b.y))] > range) continue;
        let score = Math.hypot(b.x - cruisers[0].x, b.y - cruisers[0].y) * 0.2;
        if (b.weapons.length) score -= 6; // silence coastal defences first
        if (b.bt.factory || b.bt.id === 'proc') score -= 4;
        if (coils && b.bt.power > 0) score -= 4 + Math.min(4, coils);
        if (score < bestScore) { bestScore = score; best = b; }
      }
      if (best) {
        world.issue({ c: 'attack', player: p.id, units: cruisers.map((u) => u.id), target: best.id });
        for (const u of cruisers) busy.add(u.id);
      }
    }
  }

  // --- nothing to do far from home: back to the anchorage (no camping in front of the enemy harbour)
  if (home && home.rallyX >= 0) {
    const back = fit.filter((u) => !busy.has(u.id) && Math.hypot(u.x - home.rallyX, u.y - home.rallyY) > 10).map((u) => u.id);
    if (back.length) world.issue({ c: 'move', player: p.id, units: back, x: home.rallyX, y: home.rallyY });
  }
}

function nearest<T extends Entity>(list: T[], x: number, y: number): T | null {
  let best: T | null = null, bestD = Infinity;
  for (const e of list) {
    const d = Math.hypot(e.x - x, e.y - y);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}
