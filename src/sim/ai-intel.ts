/**
 * What an AI player knows about its enemies, built only from what its own side has actually seen (no map-hack):
 * enemy structures it has spotted (remembered where they stood until it looks again and finds them gone, like the
 * player's fog "ghosts"), enemy units seen recently (for counter-composition and threat estimates) and its best
 * guess of where each enemy base is (the last known structures, otherwise the unexplored start positions a
 * commander can read off the map).
 *
 * A spy in an enemy Radar Dome shares that player's radar view (sim/infiltration.ts, RA RadarSpied): while the dome
 * stands, the AI knows where that player's units and structures are, as a human sees them on the minimap.
 *
 * Scripted missions and fog-free games keep the classic omniscient AI: mission AIs are balanced around knowing
 * where the player is, and without fog everybody sees everything anyway.
 *
 * Everything here is plain data restored by save.ts through AIController.saveState / loadState.
 */
import { WEAPONS } from '../data/rules';
import { Building, Unit, type Entity } from './entities';
import type { Player } from './player';
import { TICK_HZ } from './types';
import type { World } from './world';
import { apparentType } from './infiltration';

export interface KnownStructure {
  id: number;
  /** Apparent type (decoys pass for the real thing). */
  type: string;
  owner: number;
  x: number;
  y: number;
  cx: number;
  cy: number;
  w: number;
  h: number;
  cost: number;
  /** Has a weapon (defence) / anti-aircraft weapon. */
  armed: boolean;
  aa: boolean;
  range: number;
  /** Tick last seen. */
  seen: number;
}

export interface SeenUnit {
  id: number;
  type: string;
  owner: number;
  x: number;
  y: number;
  cost: number;
  cls: UnitClass;
  seen: number;
}

export type UnitClass = 'infantry' | 'armour' | 'light' | 'artillery' | 'air' | 'naval';

/** Enemy army value by class (seen recently). */
export type ArmyMix = Record<UnitClass, number> & { total: number };

/** Seconds a sighting of a unit stays in the composition estimate. */
const UNIT_MEMORY = 150;
/**
 * Edge (cells) of the squares the AI remembers having seen (huntPoint). Version 6: 4 cells (was 8), and a square is seen
 * once all its open ground is in view at once (it was its centre cell): a square whose centre was a tree or rock was
 * never searched, so a unit hiding in a map corner was never found.
 */
const HUNT_SQUARE = 4;

export function unitClass(u: { ut: Unit['ut'] }): UnitClass {
  const t = u.ut;
  if (t.kind === 'aircraft') return 'air';
  if (t.kind === 'naval') return 'naval';
  if (t.kind === 'infantry') return 'infantry';
  const w = t.primary ? WEAPONS[t.primary] : null;
  if (w && (w.minRange || t.noMovingFire)) return 'artillery';
  return t.armor === 'heavy' ? 'armour' : 'light';
}

export class AIIntel {
  structures = new Map<number, KnownStructure>();
  units = new Map<number, SeenUnit>();
  /** Tick the first enemy structure was spotted (-1 = enemy base not found yet). */
  foundTick = -1;
  /** Enemy units seen destroyed recently (for counter-attacks after a successful defence). */
  deaths: { tick: number; x: number; y: number; value: number }[] = [];

  /**
   * Tick each 8-cell square of the map was last in view (-1 = never): where to look for an enemy whose last structures
   * it has lost track of (huntPoint, version 5). Null until the first update; saved with the AI.
   */
  seenAt: Int32Array | null = null;

  /** Experiments only (AITuning.mapHack): the classic all-seeing AI. */
  mapHack = false;
  /**
   * (AITuning.proPower, version 5; every skirmish level, as it only reads what the AI sees) A Tesla Coil it sees
   * standing dark for want of power is no threat (strengthNear, and the Classic commander's defenceAt).
   */
  powerAware = false;
  /** Per known structure: known structures of the same owner within 8 cells (enemyBase); derived, rebuilt after update(). */
  private nearCache: Map<number, number> | null = null;

  constructor(readonly world: World, readonly p: Player) {}

  /** Scripted missions and fog-free games: the AI knows the battlefield (classic behaviour). */
  get omniscient(): boolean {
    return this.mapHack || !!this.world.mission || !this.world.fog;
  }

  /** Whether the AI can see this enemy entity right now. */
  sees(e: Entity): boolean {
    if (this.omniscient) {
      if (e instanceof Building) return !e.bt.mine;
      if (e instanceof Unit && e.kind === 'naval' && e.cloaked) return this.world.canSee(this.p, e);
      return !(e instanceof Unit && e.ut.spy && e.disguise >= 0);
    }
    if (e instanceof Unit && e.ut.spy && e.disguise >= 0) return false; // looks like one of ours
    return this.world.canSee(this.p, e);
  }

  /** Any cell of the rectangle currently in view. */
  private viewing(cx: number, cy: number, w: number, h: number): boolean {
    const m = this.world.map, vis = this.p.visible;
    for (let y = cy; y < cy + h; y++) for (let x = cx; x < cx + w; x++) {
      if (m.inBounds(x, y) && vis[y * m.w + x]) return true;
    }
    return false;
  }

  /** Any cell of the rectangle explored by this side. */
  private explored(cx: number, cy: number, w: number, h: number): boolean {
    const m = this.world.map, ex = this.p.explored;
    for (let y = cy; y < cy + h; y++) for (let x = cx; x < cx + w; x++) {
      if (m.inBounds(x, y) && ex[y * m.w + x]) return true;
    }
    return false;
  }

  /** On the shared radar of a spied Radar Dome (not submerged submarines, not disguised spies). */
  private onRadar(e: Entity): boolean {
    const r = this.p.intel.radar;
    if (!r.length || !r.includes(e.owner.id)) return false;
    return !(e instanceof Unit && ((e.kind === 'naval' && e.cloaked) || (e.ut.spy && e.disguise >= 0)));
  }

  /** Refresh from what is visible now (cheap: one pass over units and structures). */
  update() {
    const w = this.world, p = this.p, tick = w.tick;
    const radar = !this.omniscient && p.intel.radar.length > 0;
    if (!this.omniscient) this.markSeen(tick);
    for (const b of w.buildings) {
      if (!b.alive || !p.isEnemy(b.owner) || b.bt.wall || b.bt.mine || b.buildAnim < 0.05) continue;
      if (!this.sees(b) && !(radar && this.onRadar(b))) continue;
      const t = apparentType(b, p);
      const wd = b.weapons[0]?.def;
      let s = this.structures.get(b.id);
      if (!s) {
        s = { id: b.id, type: t.id, owner: b.owner.id, x: b.x, y: b.y, cx: b.cx, cy: b.cy, w: b.w, h: b.h, cost: t.cost, armed: !!wd, aa: !!wd?.antiAir, range: wd?.range ?? 0, seen: tick };
        this.structures.set(b.id, s);
        if (this.foundTick < 0) this.foundTick = tick;
      }
      s.seen = tick;
      s.type = t.id;
      s.owner = b.owner.id;
    }
    for (const [id, s] of this.structures) {
      if (s.seen === tick) continue;
      const e = w.entities.get(id);
      const alive = !!e && e.alive && p.isEnemy(e.owner);
      if (this.omniscient || (radar && p.intel.radar.includes(s.owner))) { if (!alive) this.structures.delete(id); continue; }
      // looked at the spot and it isn't there (destroyed, sold, captured, or hidden by a gap generator: forget)
      if (this.viewing(s.cx, s.cy, s.w, s.h) && (!alive || !this.sees(e!))) this.structures.delete(id);
      // shrouded again (a gap generator): what the map no longer shows, the AI no longer knows
      else if (!this.explored(s.cx, s.cy, s.w, s.h)) this.structures.delete(id);
    }
    this.nearCache = null;
    for (const u of w.units) {
      if (!u.alive || !p.isEnemy(u.owner) || u.ut.supportPlane) continue;
      if (!this.sees(u) && !(radar && this.onRadar(u))) continue;
      let s = this.units.get(u.id);
      if (!s) {
        s = { id: u.id, type: u.ut.id, owner: u.owner.id, x: u.x, y: u.y, cost: u.ut.cost, cls: unitClass(u), seen: tick };
        this.units.set(u.id, s);
      }
      s.x = u.x; s.y = u.y; s.seen = tick;
    }
    const m = w.map;
    while (this.deaths.length && tick - this.deaths[0].tick > TICK_HZ * 90) this.deaths.shift();
    for (const [id, s] of this.units) {
      if (s.seen === tick) continue;
      if (tick - s.seen > UNIT_MEMORY * TICK_HZ) { this.units.delete(id); continue; }
      const e = w.entities.get(id);
      // saw it die (its last position is in view and it isn't there)
      if ((!e || !e.alive) && m.inBounds(Math.floor(s.x), Math.floor(s.y)) && p.visible[m.idx(Math.floor(s.x), Math.floor(s.y))]) {
        this.units.delete(id);
        if (!e || !e.alive) this.deaths.push({ tick, x: s.x, y: s.y, value: s.type === 'harv' || s.type === 'mcv' ? 0 : s.cost });
      }
    }
  }

  /** Value of the enemy army seen within the last `sec` seconds, by class. */
  armyMix(sec = UNIT_MEMORY, owner = -1): ArmyMix {
    const out: ArmyMix = { infantry: 0, armour: 0, light: 0, artillery: 0, air: 0, naval: 0, total: 0 };
    const since = this.world.tick - sec * TICK_HZ;
    for (const s of this.units.values()) {
      if (s.seen < since || (owner >= 0 && s.owner !== owner)) continue;
      // harvesters / MCVs are not army
      if (s.type === 'harv' || s.type === 'mcv') continue;
      out[s.cls] += s.cost;
      out.total += s.cost;
    }
    return out;
  }

  /** Known enemy army value (units seen recently and, optionally, armed structures) within r cells of a point. */
  strengthNear(x: number, y: number, r: number, sec = 30, structures = true): number {
    const since = this.world.tick - sec * TICK_HZ;
    let v = 0;
    for (const s of this.units.values()) {
      if (s.seen < since || s.type === 'harv' || s.type === 'mcv') continue;
      if (Math.hypot(s.x - x, s.y - y) < r) {
        const e = this.world.entities.get(s.id);
        v += s.cost * (e && e.alive && this.sees(e) ? e.healthFrac : 1);
      }
    }
    if (structures) for (const s of this.structures.values()) {
      if (!s.armed || Math.hypot(s.x - x, s.y - y) > r + s.range || this.dark(s)) continue;
      // static defences count double: they out-trade mobile units of the same price
      v += s.cost * 2;
    }
    return v;
  }

  /** A known defence that needs power (a Tesla Coil) seen standing dark right now (powerAware only). */
  dark(s: KnownStructure): boolean {
    if (!this.powerAware) return false;
    // (scripted missions keep the AI they were balanced with)
    const mission = this.world.mission?.def.id;
    if (mission && mission !== 'koth' && mission !== 'challenge') return false;
    const b = this.world.entities.get(s.id);
    return b instanceof Building && b.alive && !!b.bt.requiresPower && !b.powered && this.sees(b);
  }

  knownStructures(): KnownStructure[] {
    return [...this.structures.values()];
  }

  /** Enemy start positions a commander can read off the map, nearest first, minus the ones explored and empty. */
  candidateStarts(fromX: number, fromY: number): [number, number][] {
    const w = this.world, m = w.map, p = this.p;
    const out: [number, number, number, number][] = [];
    for (const s of m.startPositions) {
      // our own start (and an ally's base) is not a candidate
      if (Math.hypot(s.x - fromX, s.y - fromY) < 12) continue;
      if (w.buildings.some((b) => b.alive && b.owner.team === p.team && Math.hypot(b.x - s.x, b.y - s.y) < 10)) continue;
      const i = m.idx(Math.floor(s.x), Math.floor(s.y));
      const known = [...this.structures.values()].some((o) => Math.hypot(o.x - s.x, o.y - s.y) < 14);
      if (p.explored[i] && !known) continue; // looked: nobody home
      // (equally far starts, as on a symmetric four-player map, go round the map one way, version 5: each player looks
      // at the neighbour on the same side of it, so neighbours don't all pick the same one. The list order used to send
      // every equidistant scout, and so every low-level wave, at the first seat: the human's)
      const vx = m.w / 2 - fromX, vy = m.h / 2 - fromY, side = vx * (s.y - fromY) - vy * (s.x - fromX);
      out.push([s.x, s.y, Math.round(Math.hypot(s.x - fromX, s.y - fromY)), side > 0 ? 0 : 1]);
    }
    out.sort((a, b) => a[2] - b[2] || a[3] - b[3]);
    return out.map(([x, y]) => [x, y]);
  }

  /**
   * Best guess of the nearest enemy base: a known Construction Yard, else the densest cluster of known structures,
   * else the nearest unexplored enemy start position. Null when the AI has no idea at all.
   */
  enemyBase(fromX: number, fromY: number): [number, number] | null {
    let best: KnownStructure | null = null, bestScore = Infinity;
    // (the cluster sizes don't depend on where we look from: counted once per update, not once per call)
    let cache = this.nearCache;
    if (!cache) {
      // (structures bucketed by owner and 8-cell square, so each one only looks at its neighbours: the same counts as
      // comparing every pair, without the quadratic cost in a late four-player game)
      cache = new Map();
      const B = 8, key = (owner: number, bx: number, by: number) => (owner * 1024 + by + 1) * 1024 + bx + 1;
      const buckets = new Map<number, KnownStructure[]>();
      for (const s of this.structures.values()) {
        const k = key(s.owner, Math.floor(s.x / B), Math.floor(s.y / B));
        const l = buckets.get(k);
        if (l) l.push(s); else buckets.set(k, [s]);
      }
      for (const s of this.structures.values()) {
        const bx = Math.floor(s.x / B), by = Math.floor(s.y / B);
        let near = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          for (const o of buckets.get(key(s.owner, bx + dx, by + dy)) ?? []) if (Math.hypot(o.x - s.x, o.y - s.y) < 8) near++;
        }
        cache.set(s.id, near);
      }
      this.nearCache = cache;
    }
    for (const s of this.structures.values()) {
      if (!this.world.players[s.owner] || this.world.players[s.owner].defeated) continue;
      const near = cache.get(s.id) ?? 0;
      const score = Math.hypot(s.x - fromX, s.y - fromY) - near * 3 - (s.type === 'fact' ? 10 : 0);
      if (score < bestScore) { bestScore = score; best = s; }
    }
    if (best) return [best.x, best.y];
    return this.candidateStarts(fromX, fromY)[0] ?? null;
  }

  /** Value of enemy units seen destroyed within r of a point in the last `sec` seconds. */
  killedNear(x: number, y: number, r: number, sec: number): number {
    const since = this.world.tick - sec * TICK_HZ;
    let v = 0;
    for (const d of this.deaths) if (d.tick >= since && Math.hypot(d.x - x, d.y - y) < r) v += d.value;
    return v;
  }

  /** Squares of the map in view now: all their open ground (terrain a ground unit can stand on) visible at once. */
  private markSeen(tick: number) {
    const m = this.world.map, vis = this.p.visible, G = HUNT_SQUARE;
    const gw = Math.ceil(m.w / G), gh = Math.ceil(m.h / G);
    if (!this.seenAt || this.seenAt.length !== gw * gh) this.seenAt = new Int32Array(gw * gh).fill(-1);
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
      let all = true;
      for (let y = gy * G; y < Math.min(m.h, gy * G + G) && all; y++) for (let x = gx * G; x < Math.min(m.w, gx * G + G); x++) {
        const i = y * m.w + x;
        if (!vis[i] && m.terrainPassable(i)) { all = false; break; }
      }
      if (all) this.seenAt[gy * gw + gx] = tick;
    }
  }

  /**
   * Where to look for an enemy whose structures it no longer knows of (its last buildings hidden somewhere, a base
   * moved by MCV, a beaten player's last units hiding): the open cell nearest the centre of the square it has gone
   * longest without seeing, the nearest of those first. `zone` (ai-ops.ts landZones): only ground that units standing
   * there can drive to; `claimed`: points other search parties are already heading for (their squares and the
   * neighbouring ones are left to them). Null with nothing to search (no fog, or everything seen within 20 s).
   */
  huntPoint(fromX: number, fromY: number, zone?: { zones: Int32Array; id: number }, claimed: readonly [number, number][] = []): [number, number] | null {
    const m = this.world.map, G = HUNT_SQUARE, seen = this.seenAt;
    if (!seen || this.omniscient) return null;
    const gw = Math.ceil(m.w / G), gh = Math.ceil(m.h / G);
    let best: [number, number] | null = null, bestT = Infinity, bestD = Infinity;
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
      const t = seen[gy * gw + gx];
      if (t > bestT) continue;
      const mx = gx * G + G / 2, my = gy * G + G / 2;
      if (claimed.some(([x, y]) => Math.abs(x - mx) < G * 2 && Math.abs(y - my) < G * 2)) continue;
      // the square's open cell nearest its centre (on the searchers' ground)
      let cell = -1, cd = Infinity;
      for (let y = gy * G; y < Math.min(m.h, gy * G + G); y++) for (let x = gx * G; x < Math.min(m.w, gx * G + G); x++) {
        const i = y * m.w + x;
        if (!m.terrainPassable(i) || (zone && zone.zones[i] !== zone.id)) continue;
        const d = (x + 0.5 - mx) ** 2 + (y + 0.5 - my) ** 2;
        if (d < cd) { cd = d; cell = i; }
      }
      if (cell < 0) continue;
      const cx = (cell % m.w) + 0.5, cy = ((cell / m.w) | 0) + 0.5, d = Math.hypot(cx - fromX, cy - fromY);
      if (t < bestT || d < bestD) { bestT = t; bestD = d; best = [cx, cy]; }
    }
    return best && bestT < this.world.tick - TICK_HZ * 20 ? best : null;
  }

  saveState() {
    return { s: [...this.structures.values()], u: [...this.units.values()], f: this.foundTick, d: this.deaths, h: this.seenAt ? [...this.seenAt] : undefined };
  }

  loadState(st: { s?: KnownStructure[]; u?: SeenUnit[]; f?: number; d?: AIIntel['deaths']; h?: number[] } | undefined) {
    this.structures = new Map((st?.s ?? []).map((s) => [s.id, { ...s }]));
    this.nearCache = null;
    this.units = new Map((st?.u ?? []).map((s) => [s.id, { ...s }]));
    this.foundTick = st?.f ?? -1;
    this.seenAt = Array.isArray(st?.h) ? Int32Array.from(st!.h) : null;
    this.deaths = (st?.d ?? []).map((d) => ({ ...d }));
  }
}
