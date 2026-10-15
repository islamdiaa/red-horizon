/**
 * Mission scripting runtime. Missions (campaign, survival, challenges) are plain TS objects
 * with a setup() and an update() callback that drive the world through this API.
 * Everything here runs inside the deterministic simulation tick (use world.rng, never Math.random).
 */
import { BUILDINGS, UNITS, type Faction } from '../data/rules';
import type { AnnouncerKey } from '../audio/types';
import { Building, Entity, Unit } from './entities';
import type { Player } from './player';
import type { AIDifficulty } from './ai';
import { DT, TICK_HZ } from './types';
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
  climate?: 'temperate' | 'winter' | 'desert';
  timeOfDay?: 'day' | 'dusk' | 'night';
  /** Fixed starting hour (overrides timeOfDay). */
  hour?: number;
  weather?: string;
  dayCycle?: boolean;
}

export interface MissionPlayerSpec {
  name: string;
  faction: Faction;
  color?: number;
  team?: number;
  /** AI behaviour; omit for the human player (index 0). */
  ai?: AIMode;
  credits?: number;
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
  setup(m: MissionRuntime): void;
  update?(m: MissionRuntime): void;
}

const EDGE_OFFSET = 1.5;

export class MissionRuntime {
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

  constructor(readonly world: World, readonly def: MissionDef) {}

  // ---------------------------------------------------------------------------
  // Basics
  // ---------------------------------------------------------------------------
  get time(): number {
    return this.world.time;
  }
  get human(): Player {
    return this.world.players[0];
  }
  player(i: number): Player {
    return this.world.players[i];
  }
  private P(p: number | Player): Player {
    return typeof p === 'number' ? this.world.players[p] : p;
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
      if (m.occupant[i] || m.terrain[i] === 1 || m.terrain[i] === 2) return null;
      m.removeTree(i);
      if (m.ore[i]) m.setOre(i, 0);
    }
    const b = this.world.addBuilding(type, pl, cx, cy, built);
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
  isDone(id: string): boolean {
    return this.objectives.find((x) => x.id === id)?.state === 'done';
  }
  /** Radio transmission with a speaker portrait. */
  say(speaker: string, text: string, portrait: Portrait = 'commander') {
    this.events.push({ e: 'message', speaker, text, portrait, faction: this.human.faction });
  }
  announce(key: AnnouncerKey) {
    this.world.events.push({ e: 'announce', player: 0, key });
  }
  camera(x: number, y: number) {
    this.events.push({ e: 'camera', x, y });
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
    this.events.push({ e: 'end', won: false, reason });
    const other = this.world.players.find((p) => p.team !== this.human.team);
    this.world.endGame(other ? other.team : -1);
  }
}

/** Seconds → ticks helper for scripts. */
export const secondsToTicks = (s: number) => Math.round(s * TICK_HZ);
export { Unit, Building };
