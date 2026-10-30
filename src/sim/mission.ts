/**
 * Mission scripting runtime. Missions (campaign, survival, challenges) are plain TS objects
 * with a setup() and an update() callback that drive the world through this API.
 * Everything here runs inside the deterministic simulation tick (use world.rng, never Math.random).
 */
import { BUILDINGS, UNITS, WEAPONS, type Faction } from '../data/rules';
import type { AnnouncerKey } from '../audio/types';
import { Building, Entity, Unit } from './entities';
import type { Player } from './player';
import type { AIDifficulty } from './ai';
import type { Projectile } from './combat';
import { recalcPlayerEconomy } from './production';
import { superBuilding, superChargeTime, type SuperKind } from './superweapons';
import { assignHandicaps, isMissionLevel, type MissionLevel } from './handicap';
import { DT, TICK_HZ } from './types';
import type { RegionOptions } from './mapgen-region'; // World Conquest
import type { World } from './world';

export type ObjectiveState = 'active' | 'done' | 'failed';
export interface Objective {
  id: string;
  text: string;
  primary: boolean;
  state: ObjectiveState;
  /** Optional progress text, e.g. "3 / 5". */
  progress?: string;
}

export type Portrait = 'commander' | 'intel' | 'commando' | 'enemy' | 'eva' | 'scientist' | 'pilot';

export type MissionEvent =
  | { e: 'message'; speaker: string; text: string; portrait: Portrait; faction?: Faction }
  | { e: 'objective'; objective: Objective; change: 'added' | 'done' | 'failed' | 'progress' }
  | { e: 'timer'; label: string; seconds: number | null }
  | { e: 'camera'; x: number; y: number }
  /** A flashing waypoint for the player (tutorials, rendezvous points). */
  | { e: 'beacon'; x: number; y: number }
  | { e: 'score'; label: string; value: number }
  | { e: 'end'; won: boolean; reason?: string };

export type AIMode = AIDifficulty | 'passive' | 'defensive';

export interface MissionMapSpec {
  size: number;
  seed: number;
  players: number;
  water?: number;
  trees?: number;
  ore?: number;
  climate?: 'temperate' | 'winter' | 'desert' | 'tropical'; // ('tropical': World Conquest region battlefields)
  timeOfDay?: 'day' | 'dusk' | 'night';
  /** Fixed starting hour (overrides timeOfDay). */
  hour?: number;
  weather?: string;
  dayCycle?: boolean;
  /** Rock / cliff density for the generator (mapgen `rocks`, 0..1). */
  rocks?: number;
  /** Curated map id (src/maps) used instead of the generator. */
  mapId?: string;
  /** World Conquest: a region battlefield (sim/mapgen-region.ts regionBattlefield) used instead of the generator. */
  region?: RegionOptions;
}

export interface MissionPlayerSpec {
  name: string;
  faction: Faction;
  color?: number;
  team?: number;
  /** AI behaviour; omit for the human player (index 0). */
  ai?: AIMode;
  credits?: number;
  /** AI commander personality id (src/sim/ai-personality.ts), passed to PlayerSetup.personality. */
  personality?: string;
}

export interface MissionDef {
  id: string;
  campaign: 'allies' | 'soviet' | 'special';
  /** Order inside the campaign (1-based). */
  index: number;
  title: string;
  codename: string;
  location: string;
  date?: string;
  briefing: string[];
  /** Short list of tips shown on the briefing screen. */
  tips?: string[];
  map: MissionMapSpec;
  players: MissionPlayerSpec[];
  fog?: boolean;
  /** Starting kit for player 0 (the script can also spawn units itself). */
  startUnits?: 'none' | 'mcv' | 'light' | 'heavy';
  /** Credits for player 0. */
  credits?: number;
  /** Types the human may build (null/undefined = everything their tech allows). */
  allowedBuild?: string[];
  /** Seconds for the speed medal. */
  parTime?: number;
  /** Victory when all enemies are eliminated (default false: the script decides). */
  winOnElimination?: boolean;
  /** Survival-style missions report a score instead of win/lose stars. */
  scored?: boolean;
  /** Closing radio lines for the debrief screen (optional). */
  debrief?: MissionDebrief;
  setup(m: MissionRuntime): void;
  update?(m: MissionRuntime): void;
}

/** Debrief radio lines: shown on the mission-complete / mission-failed screen. */
export interface MissionDebrief {
  speaker: string;
  portrait: Portrait;
  win: string;
  lose: string;
}

/** A map point (cells). */
export type Pt = { x: number; y: number } | [number, number];
const px = (p: Pt) => (Array.isArray(p) ? p[0] : p.x);
const py = (p: Pt) => (Array.isArray(p) ? p[1] : p.y);

const EDGE_OFFSET = 1.5;

export class MissionRuntime {
  /** The most recently created runtime (read by the debrief screen for objectives / end reason). */
  static current: MissionRuntime | null = null;
  /** Reason passed to lose(), if any. */
  endReason: string | null = null;
  readonly objectives: Objective[] = [];
  events: MissionEvent[] = [];
  /** Free-form script state. */
  flags: Record<string, any> = {};
  ended = false;
  won = false;
  score = 0;
  /** Countdown currently shown in the HUD. */
  hudTimerKey: string | null = null;
  private onceKeys = new Set<string>();
  private everyT = new Map<string, number>();
  private timers = new Map<string, number>();

  constructor(readonly world: World, readonly def: MissionDef) {
    MissionRuntime.current = this;
  }

  // ---------------------------------------------------------------------------
  // Basics
  // ---------------------------------------------------------------------------
  get time(): number {
    return this.world.time;
  }
  /** Index of the human player (0 for missions; a branch / challenge can hand any player to the human). */
  humanId = 0;
  get human(): Player {
    return this.world.players[this.humanId] ?? this.world.players[0];
  }
  player(i: number): Player {
    return this.world.players[i];
  }
  private P(p: number | Player): Player {
    return typeof p === 'number' ? this.world.players[p] : p;
  }

  // ---------------------------------------------------------------------------
  // Difficulty (campaign level: RA's handicaps, sim/handicap.ts)
  // ---------------------------------------------------------------------------
  /** The campaign difficulty this mission is played at (kept in the flags, so saves carry it; Normal by default). */
  get level(): MissionLevel {
    const l = this.flags.__level;
    return isMissionLevel(l) ? l : 'normal';
  }
  /**
   * Set the level before the mission's setup (the scripts read `level` / `byLevel` there) and hand every side its
   * handicap. Normal (or nothing) leaves the mission exactly as it was.
   */
  setLevel(level: MissionLevel | null | undefined) {
    if (level && level !== 'normal' && isMissionLevel(level)) this.flags.__level = level;
    else delete this.flags.__level;
    this.applyLevel();
  }
  /** Re-attach the handicaps from the level and the current teams (after a save loads, after a team change). */
  applyLevel() {
    assignHandicaps(this.world.players, this.human, this.level);
  }
  /** A per-level value: `byLevel(normal, { recruit: …, easy: … })` (levels not listed take the Normal value). */
  byLevel<T>(normal: T, levels: Partial<Record<MissionLevel, T>>): T {
    const v = levels[this.level];
    return v === undefined ? normal : v;
  }
  /** Easier than Normal (Recruit or Easy). */
  get eased(): boolean {
    return this.level === 'recruit' || this.level === 'easy';
  }
  /** Harder than Normal (Hard or Brutal). */
  get tightened(): boolean {
    return this.level === 'hard' || this.level === 'brutal';
  }

  /** Called by the world each tick. */
  tick() {
    if (this.ended) return;
    for (const [k, t] of this.timers) {
      const nt = t - DT;
      this.timers.set(k, nt);
    }
    this.def.update?.(this);
    if (!this.ended && this.human.defeated) this.lose('All forces lost');
  }

  // ---------------------------------------------------------------------------
  // Trigger helpers
  // ---------------------------------------------------------------------------
  /** True exactly once per key. */
  once(key: string): boolean {
    if (this.onceKeys.has(key)) return false;
    this.onceKeys.add(key);
    return true;
  }
  /** True once, after `seconds` of mission time. */
  after(seconds: number, key: string): boolean {
    return this.time >= seconds && this.once('after:' + key);
  }
  /** True every `seconds` (first time after one period). */
  every(seconds: number, key: string): boolean {
    const next = this.everyT.get(key) ?? this.time + seconds;
    if (!this.everyT.has(key)) this.everyT.set(key, next);
    if (this.time >= next) {
      this.everyT.set(key, next + seconds);
      return true;
    }
    return false;
  }
  /** Start / read a named countdown (seconds left, or null if not running). Shows in the HUD when `label` is set. */
  startTimer(key: string, seconds: number, label?: string) {
    this.timers.set(key, seconds);
    if (label) {
      this.hudTimerKey = key;
      this.events.push({ e: 'timer', label, seconds });
    }
  }
  timeLeft(key: string): number | null {
    const t = this.timers.get(key);
    return t === undefined ? null : Math.max(0, t);
  }
  timerDone(key: string): boolean {
    const t = this.timers.get(key);
    return t !== undefined && t <= 0;
  }
  clearTimer(key: string) {
    this.timers.delete(key);
    if (this.hudTimerKey === key) {
      this.hudTimerKey = null;
      this.events.push({ e: 'timer', label: '', seconds: null });
    }
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------
  units(p?: number | Player, type?: string | string[]): Unit[] {
    const pl = p === undefined ? null : this.P(p);
    const types = type === undefined ? null : Array.isArray(type) ? type : [type];
    return this.world.units.filter((u) => u.alive && (!pl || u.owner === pl) && (!types || types.includes(u.ut.id)));
  }
  buildings(p?: number | Player, type?: string | string[]): Building[] {
    const pl = p === undefined ? null : this.P(p);
    const types = type === undefined ? null : Array.isArray(type) ? type : [type];
    return this.world.buildings.filter((b) => b.alive && (!pl || b.owner === pl) && (!types || types.includes(b.bt.id)));
  }
  alive(e: Entity | number | null | undefined): boolean {
    if (e === null || e === undefined) return false;
    const ent = typeof e === 'number' ? this.world.getEntity(e) : e;
    return !!ent && ent.alive;
  }
  /** Any unit of player p within radius r of (x, y). */
  unitsNear(p: number | Player, x: number, y: number, r: number, filter?: (u: Unit) => boolean): Unit[] {
    const pl = this.P(p);
    const out: Unit[] = [];
    this.world.grid.query(x, y, r + 1, (u) => {
      if (u.alive && u.owner === pl && Math.hypot(u.x - x, u.y - y) <= r && (!filter || filter(u))) out.push(u);
    });
    return out;
  }
  /** Enemy forces of player p (units + non-wall structures) remaining. */
  enemiesRemaining(p: number | Player = 0): number {
    const pl = this.P(p);
    let n = 0;
    for (const u of this.world.units) if (u.alive && pl.isEnemy(u.owner)) n++;
    for (const b of this.world.buildings) if (b.alive && !b.bt.wall && pl.isEnemy(b.owner)) n++;
    return n;
  }
  get mapW() { return this.world.map.w; }
  get mapH() { return this.world.map.h; }
  start(i: number): { x: number; y: number } {
    const s = this.world.map.startPositions;
    return s[i % s.length];
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  spawnUnit(p: number | Player, type: string, x: number, y: number, heading?: number): Unit {
    const pl = this.P(p);
    const isInf = UNITS[type].kind === 'infantry';
    const [sx, sy] = this.world.findFreeSpot(x, y, 6, !isInf);
    const u = this.world.addUnit(type, pl, sx, sy);
    // a player that receives fresh forces is back in the fight (wave-only enemies start empty)
    pl.defeated = false;
    if (heading !== undefined) u.heading = u.prevHeading = u.turret = u.prevTurret = heading;
    if (u.kind === 'aircraft') u.altitude = u.ut.vtol ? 1.55 : 2.3;
    return u;
  }
  /** Spawn a list of units clustered around a point. */
  spawnGroup(p: number | Player, types: string[], x: number, y: number, heading?: number): Unit[] {
    const out: Unit[] = [];
    types.forEach((t, k) => {
      const a = (k / Math.max(1, types.length)) * Math.PI * 2;
      const r = k === 0 ? 0 : 0.8 + (k % 3) * 0.4;
      out.push(this.spawnUnit(p, t, x + Math.cos(a) * r, y + Math.sin(a) * r, heading));
    });
    return out;
  }
  /** Place a finished structure (top-left cell). Clears trees/ore under it. */
  placeBuilding(p: number | Player, type: string, cx: number, cy: number, built = true): Building | null {
    const pl = this.P(p);
    const bt = BUILDINGS[type];
    const m = this.world.map;
    for (let dy = 0; dy < bt.size[1]; dy++) for (let dx = 0; dx < bt.size[0]; dx++) {
      const x = cx + dx, y = cy + dy;
      if (!m.inBounds(x, y)) return null;
      const i = m.idx(x, y);
      // shipyards / sub pens stand on water, everything else on dry, open ground
      const wet = m.terrain[i] === 1;
      if (m.occupant[i] || (bt.water ? !wet : wet || m.terrain[i] === 2)) return null;
      m.removeTree(i);
      if (m.ore[i]) m.setOre(i, 0);
    }
    const b = this.world.addBuilding(type, pl, cx, cy, built);
    pl.defeated = false;
    this.world.events.push({ e: 'placed', id: b.id });
    return b;
  }
  /** Place a structure near (x, y) using a spiral search for a free footprint. */
  placeNear(p: number | Player, type: string, x: number, y: number, built = true): Building | null {
    const bt = BUILDINGS[type];
    for (let r = 0; r < 10; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const cx = Math.round(x - bt.size[0] / 2) + dx, cy = Math.round(y - bt.size[1] / 2) + dy;
        if (!this.footprintFree(type, cx, cy)) continue;
        return this.placeBuilding(p, type, cx, cy, built);
      }
    }
    return null;
  }
  private footprintFree(type: string, cx: number, cy: number): boolean {
    const bt = BUILDINGS[type];
    const m = this.world.map;
    for (let dy = -1; dy <= bt.size[1]; dy++) for (let dx = -1; dx <= bt.size[0]; dx++) {
      const x = cx + dx, y = cy + dy;
      if (!m.inBounds(x, y)) return false;
      const inner = dx >= 0 && dy >= 0 && dx < bt.size[0] && dy < bt.size[1];
      const i = m.idx(x, y);
      if (m.occupant[i]) return false;
      if (inner && (m.terrain[i] === 1 || m.terrain[i] === 2)) return false;
    }
    return true;
  }
  move(units: Unit[], x: number, y: number, attackMove = false) {
    if (!units.length) return;
    this.world.issue({ c: 'move', player: units[0].owner.id, units: units.map((u) => u.id), x, y, attackMove });
  }
  attack(units: Unit[], target: Entity) {
    if (!units.length) return;
    this.world.issue({ c: 'attack', player: units[0].owner.id, units: units.map((u) => u.id), target: target.id });
  }
  /** Reveal (explore) a circle of the map for a player. */
  reveal(p: number | Player, x: number, y: number, r: number) {
    const pl = this.P(p);
    const m = this.world.map;
    for (let dy = -Math.ceil(r); dy <= r; dy++) for (let dx = -Math.ceil(r); dx <= r; dx++) {
      const cx = Math.floor(x) + dx, cy = Math.floor(y) + dy;
      if (m.inBounds(cx, cy) && dx * dx + dy * dy <= r * r) pl.explored[m.idx(cx, cy)] = 1;
    }
  }
  /** Map edge point closest to (x, y) on the given side. */
  edgePoint(side: 'n' | 's' | 'e' | 'w', along: number): [number, number] {
    const w = this.mapW, h = this.mapH;
    switch (side) {
      case 'n': return [along, EDGE_OFFSET];
      case 's': return [along, h - EDGE_OFFSET];
      case 'w': return [EDGE_OFFSET, along];
      default: return [w - EDGE_OFFSET, along];
    }
  }
  /** Units arrive from a map edge point and move (attack-move by default) to a destination. */
  reinforce(p: number | Player, types: string[], from: [number, number], to: [number, number], attackMove = true): Unit[] {
    const heading = Math.atan2(to[1] - from[1], to[0] - from[0]);
    const units = this.spawnGroup(p, types, from[0], from[1], heading);
    this.move(units, to[0], to[1], attackMove);
    return units;
  }
  setAI(p: number | Player, mode: AIMode) {
    const pl = this.P(p);
    const ai = this.world.ais.find((a) => a.player === pl);
    ai?.setMode(mode);
  }
  /** Restrict what the human can build (null = no restriction). */
  allowBuild(types: string[] | null) {
    this.human.allowedTypes = types ? new Set(types) : null;
    this.world.checkNewOptions(this.human);
  }
  give(p: number | Player, credits: number) {
    this.P(p).cash += credits;
  }

  // ---------------------------------------------------------------------------
  // Campaign helpers (geometry, entity control, set pieces)
  // ---------------------------------------------------------------------------
  /** Point `dist` cells from a towards b, shifted `side` cells perpendicular to the a→b line. */
  toward(a: Pt, b: Pt, dist: number, side = 0): [number, number] {
    const ax = px(a), ay = py(a);
    const dx = px(b) - ax, dy = py(b) - ay;
    const l = Math.hypot(dx, dy) || 1;
    return this.clampPt(ax + (dx / l) * dist - (dy / l) * side, ay + (dy / l) * dist + (dx / l) * side);
  }
  /** Point at fraction t of the way from a to b, shifted `side` cells perpendicular. */
  between(a: Pt, b: Pt, t: number, side = 0): [number, number] {
    const d = Math.hypot(px(b) - px(a), py(b) - py(a));
    return this.toward(a, b, d * t, side);
  }
  /** Keep a point inside the map, `margin` cells from the edge. */
  clampPt(x: number, y: number, margin = 1.5): [number, number] {
    return [Math.min(this.mapW - margin, Math.max(margin, x)), Math.min(this.mapH - margin, Math.max(margin, y))];
  }
  dist(a: Pt, b: Pt): number {
    return Math.hypot(px(a) - px(b), py(a) - py(b));
  }
  /** Nearest passable, uncrowded spot around a point. */
  freeSpot(x: number, y: number, r = 6, forVehicle = true): [number, number] {
    return this.world.findFreeSpot(x, y, r, forVehicle);
  }
  /** Closest entity of a list to a point. */
  nearest<T extends Entity>(list: T[], x: number, y: number): T | null {
    let best: T | null = null, bd = Infinity;
    for (const e of list) {
      const d = Math.hypot(e.x - x, e.y - y);
      if (e.alive && d < bd) { bd = d; best = e; }
    }
    return best;
  }
  /** Living entities from stored ids (scripts keep ids in `flags`). */
  living(ids: number[] | undefined): Entity[] {
    const out: Entity[] = [];
    for (const id of ids ?? []) {
      const e = this.world.getEntity(id);
      if (e && e.alive) out.push(e);
    }
    return out;
  }
  livingUnits(ids: number[] | undefined): Unit[] {
    return this.living(ids).filter((e): e is Unit => e instanceof Unit);
  }
  /** Armed combat units of a player (no harvesters, MCVs or medics). */
  army(p: number | Player, includeAir = true): Unit[] {
    return this.units(p).filter((u) => u.weapons.length && !u.ut.harvester && !u.ut.deploysInto && !u.ut.medic && (includeAir || u.kind !== 'aircraft'));
  }
  /** Units with no current order and no target. */
  idleUnits(p: number | Player): Unit[] {
    return this.units(p).filter((u) => u.order.type === 'idle' && !u.target && !u.ut.harvester);
  }
  eliminated(p: number | Player): boolean {
    return this.P(p).defeated;
  }
  /** Change the remaining seconds of a running countdown without re-announcing it. */
  setTimeLeft(key: string, seconds: number) {
    if (this.timers.has(key)) this.timers.set(key, seconds);
  }
  /** Set an entity's health as a fraction of its maximum (pre-damaged structures, wounded survivors). */
  setHealth(e: Entity | null | undefined, frac: number) {
    if (!e || !e.alive) return;
    e.hp = Math.max(1, Math.min(e.maxHp, Math.round(e.maxHp * frac)));
  }
  /** Remove an entity without an explosion or a recorded loss (e.g. a unit leaving the map). */
  remove(e: Entity | null | undefined) {
    if (!e || !e.alive) return;
    const isUnit = e instanceof Unit;
    this.world.kill(e, 'sold');
    if (isUnit) e.owner.stats.unitsLost = Math.max(0, e.owner.stats.unitsLost - 1);
  }
  /** Hand units or structures to another player (defections, freed prisoners, captured gear). */
  transfer(list: Entity[], to: number | Player) {
    const now = this.P(to);
    const touched = new Set<Player>([now]);
    for (const e of list) {
      if (!e.alive || e.owner === now) continue;
      const old = e.owner;
      touched.add(old);
      e.target = null;
      if (e instanceof Unit) {
        e.owner = now;
        e.orderQueue.length = 0;
        this.world.setOrder(e, { type: 'idle' });
        e.guardX = e.x;
        e.guardY = e.y;
        e.homePad = 0;
        for (const ps of e.passengers) ps.owner = now;
      } else if (e instanceof Building) {
        if (e.counted) {
          // only finished structures count towards tech (a half-built one is counted when it completes)
          old.owned.set(e.bt.id, Math.max(0, (old.owned.get(e.bt.id) ?? 1) - 1));
          now.owned.set(e.bt.id, (now.owned.get(e.bt.id) ?? 0) + 1);
        }
        e.owner = now;
        e.repairing = false;
        e.primary = false;
        this.world.events.push({ e: 'captured', id: e.id, from: old.id, to: now.id });
      }
    }
    for (const p of touched) recalcPlayerEconomy(this.world, p);
    this.world.checkNewOptions(now);
  }
  /** Switch a player's team mid-mission (betrayals, defections). Drops targets that became friendly. */
  setTeam(p: number | Player, team: number) {
    const pl = this.P(p);
    pl.team = team;
    if (this.flags.__level) this.applyLevel(); // a side that changes camp takes that camp's handicap
    for (const e of [...this.world.units, ...this.world.buildings] as Entity[]) {
      if (e.target && !e.owner.isEnemy(e.target.owner)) e.target = null;
    }
    for (const o of this.world.players) this.world.updateVisibility(o);
  }
  /** Idle units of the list walk a looping route (call every tick or every few seconds). */
  patrol(units: Unit[], route: [number, number][], key = 'patrol') {
    if (!route.length) return;
    const idx: Record<number, number> = (this.flags['__' + key] ??= {});
    for (const u of units) {
      if (!u.alive || u.order.type !== 'idle' || u.target || u.chasing) continue;
      const k = ((idx[u.id] ?? -1) + 1) % route.length;
      idx[u.id] = k;
      this.world.issue({ c: 'move', player: u.owner.id, units: [u.id], x: route[k][0], y: route[k][1], attackMove: true });
    }
  }
  /** Place a straight line of wall segments (sandbags, barbed wire, concrete). */
  wall(p: number | Player, type: string, x0: number, y0: number, x1: number, y1: number): Building[] {
    const out: Building[] = [];
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let k = 0; k <= n; k++) {
      const t = n ? k / n : 0;
      const x = Math.round(x0 + (x1 - x0) * t), y = Math.round(y0 + (y1 - y0) * t);
      const m = this.world.map;
      if (!m.inBounds(x, y) || m.occupant[m.idx(x, y)]) continue;
      const b = this.placeBuilding(p, type, x, y);
      if (b) out.push(b);
    }
    return out;
  }
  /** Mark the whole map as explored for a player. */
  revealAll(p: number | Player = 0) {
    this.P(p).explored.fill(1);
  }
  /** Off-map artillery: a shell from `from` (default: nearest map edge) lands near (x, y). */
  shell(p: number | Player, x: number, y: number, opts: { from?: [number, number]; weapon?: string; scatter?: number } = {}) {
    const pl = this.P(p);
    const w = WEAPONS[opts.weapon ?? '155mm'];
    const rng = this.world.rng;
    const sc = opts.scatter ?? 1.2;
    const a = rng.range(0, Math.PI * 2), r = Math.sqrt(rng.next()) * sc;
    const [tx, ty] = this.clampPt(x + Math.cos(a) * r, y + Math.sin(a) * r, 0.5);
    const from = opts.from ?? this.nearestEdge(x, y);
    const m = this.world.map;
    const sz = 1.5, tz = m.heightAt(tx, ty);
    const d = Math.hypot(tx - from[0], ty - from[1]);
    const proj: Projectile = {
      id: 700000 + ((this.world.tick * 7 + (this.flags.__shells = (this.flags.__shells ?? 0) + 1)) % 99999), weapon: w, owner: pl, shooter: 0, kind: 'ballistic',
      x: from[0], y: from[1], z: sz, prevX: from[0], prevY: from[1], prevZ: sz, sx: from[0], sy: from[1], sz, tx, ty, tz,
      target: null, t: 0, dur: Math.min(4, 0.7 + d * 0.06), arc: Math.min(9, 0.6 + d * 0.2), speed: 0, vx: 0, vy: 0, alive: true,
    };
    this.world.projectiles.push(proj);
  }
  /** Atomic strike on (x, y), launched from the player's Missile Silo if it has one, otherwise from off-map. */
  nuke(p: number | Player, x: number, y: number, from?: [number, number]) {
    const pl = this.P(p);
    const silo = superBuilding(this.world, pl, 'nuke');
    const src: [number, number] = silo ? [silo.x, silo.y] : from ?? this.nearestEdge(x, y);
    if (silo) { pl.superCharge.nuke = 0; pl.superAnnounced.nuke = false; silo.doorHold = 4; }
    const m = this.world.map;
    const sz = m.heightAt(src[0], src[1]) + 0.5;
    const dist = Math.hypot(x - src[0], y - src[1]);
    const proj: Projectile = {
      id: this.world.nextProjectileId++, weapon: WEAPONS.Nuke, owner: pl, shooter: silo?.id ?? 0, kind: 'scud',
      x: src[0], y: src[1], z: sz, prevX: src[0], prevY: src[1], prevZ: sz, sx: src[0], sy: src[1], sz,
      tx: x, ty: y, tz: m.heightAt(x, y), target: null,
      t: 0, dur: 4.5 + dist * 0.04, arc: 14 + dist * 0.25, speed: 0, vx: 0, vy: 0, alive: true, special: 'nuke',
    };
    this.world.projectiles.push(proj);
    this.world.events.push({ e: 'nuke', x: src[0], y: src[1], stage: 'launch' });
    this.world.events.push({ e: 'sfx', key: 'nuke_launch', x: src[0], y: src[1] });
    this.world.announce(pl, 'nuke_launched', 0);
    for (const o of this.world.players) if (o !== pl) this.world.announce(o, 'nuke_warning', 0);
  }
  /** Superweapon charge state for a player (null when it has no such structure). */
  superState(p: number | Player, kind: SuperKind): { charge: number; full: number; left: number; ready: boolean } | null {
    const pl = this.P(p);
    const b = superBuilding(this.world, pl, kind);
    if (!b) return null;
    const full = b.bt.superCharge ?? superChargeTime(kind);
    const charge = pl.superCharge[kind];
    return { charge, full, left: Math.max(0, full - charge), ready: charge >= full };
  }
  /** Set a superweapon's charge (seconds; may be negative to delay it). */
  setSuperCharge(p: number | Player, kind: SuperKind, seconds: number) {
    const pl = this.P(p);
    pl.superCharge[kind] = seconds;
    pl.superAnnounced[kind] = false;
  }
  /** The map-edge point closest to (x, y). */
  nearestEdge(x: number, y: number): [number, number] {
    const w = this.mapW, h = this.mapH;
    const opts: [number, number, number][] = [[x, EDGE_OFFSET, y], [x, h - EDGE_OFFSET, h - y], [EDGE_OFFSET, y, x], [w - EDGE_OFFSET, y, w - x]];
    opts.sort((a, b) => a[2] - b[2]);
    return [opts[0][0], opts[0][1]];
  }

  // ---------------------------------------------------------------------------
  // Objectives & storytelling
  // ---------------------------------------------------------------------------
  objective(id: string, text: string, primary = true): Objective {
    let o = this.objectives.find((x) => x.id === id);
    if (o) return o;
    o = { id, text, primary, state: 'active' };
    this.objectives.push(o);
    this.events.push({ e: 'objective', objective: o, change: 'added' });
    return o;
  }
  progress(id: string, text: string) {
    const o = this.objectives.find((x) => x.id === id);
    if (!o || o.progress === text) return;
    o.progress = text;
    this.events.push({ e: 'objective', objective: o, change: 'progress' });
  }
  complete(id: string) {
    const o = this.objectives.find((x) => x.id === id);
    if (!o || o.state !== 'active') return;
    o.state = 'done';
    this.events.push({ e: 'objective', objective: o, change: 'done' });
  }
  fail(id: string) {
    const o = this.objectives.find((x) => x.id === id);
    if (!o || o.state !== 'active') return;
    o.state = 'failed';
    this.events.push({ e: 'objective', objective: o, change: 'failed' });
  }
  /** Rewrite an objective's text (e.g. the extraction point moved). */
  retext(id: string, text: string) {
    const o = this.objectives.find((x) => x.id === id);
    if (!o || o.text === text) return;
    o.text = text;
    this.events.push({ e: 'objective', objective: o, change: 'progress' });
  }
  /** State of an objective (undefined if it was never added). */
  state(id: string): ObjectiveState | undefined {
    return this.objectives.find((x) => x.id === id)?.state;
  }
  isDone(id: string): boolean {
    return this.objectives.find((x) => x.id === id)?.state === 'done';
  }
  /** Radio transmission with a speaker portrait. */
  say(speaker: string, text: string, portrait: Portrait = 'commander') {
    this.events.push({ e: 'message', speaker, text, portrait, faction: this.human.faction });
  }
  announce(key: AnnouncerKey) {
    this.world.events.push({ e: 'announce', player: this.humanId, key }); // humanId (0 in missions)
  }
  camera(x: number, y: number) {
    this.events.push({ e: 'camera', x, y });
  }
  /** Flash a waypoint marker (on the ground and the radar). Re-send it periodically while it matters. */
  beacon(x: number, y: number) {
    this.events.push({ e: 'beacon', x, y });
  }
  addScore(label: string, value: number) {
    this.score += value;
    this.events.push({ e: 'score', label, value: this.score });
  }

  win() {
    if (this.ended) return;
    this.ended = true;
    this.won = true;
    for (const o of this.objectives) if (o.primary && o.state === 'active') o.state = 'done';
    this.events.push({ e: 'end', won: true });
    this.world.endGame(this.human.team);
  }
  lose(reason?: string) {
    if (this.ended) return;
    this.ended = true;
    this.won = false;
    this.endReason = reason ?? null;
    this.events.push({ e: 'end', won: false, reason });
    const other = this.world.players.find((p) => p.team !== this.human.team);
    this.world.endGame(other ? other.team : -1);
  }
}

/** Seconds → ticks helper for scripts. */
export const secondsToTicks = (s: number) => Math.round(s * TICK_HZ);
export { Unit, Building };
