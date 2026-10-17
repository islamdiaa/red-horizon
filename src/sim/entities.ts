import { BUILDINGS, UNITS, WEAPONS, type BuildingTypeDef, type TypeDef, type UnitTypeDef, type WeaponDef } from '../data/rules';
import type { PathPoint } from './pathfinding';
import type { Player } from './player';
import type { Order } from './types';
import type { FormationShape, Stance } from './types';
import type { EconTask } from './economy-data';

export class WeaponSlot {
  cooldown = 0;     // seconds until ready
  burstLeft = 0;
  burstTimer = 0;
  constructor(public def: WeaponDef) {}
}

/** A support aircraft's scripted run: fly in from the map edge over (tx, ty) along (dx, dy), deliver, fly out. */
export interface Sortie {
  kind: 'spyplane' | 'paratroopers' | 'parabombs';
  tx: number;
  ty: number;
  /** Unit flight direction. */
  dx: number;
  dy: number;
  /** Distance past the target at which the plane leaves the map. */
  exit: number;
  /** Payload items delivered so far. */
  drops: number;
  /** Fly-by sound / warning played. */
  warned: boolean;
}

export type HarvestState ='seek' | 'toOre' | 'harvesting' | 'toRefinery' | 'waitDock' | 'unloading' | 'idle';

export abstract class Entity {
  id: number;
  owner: Player;
  hp: number;
  alive = true;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  weapons: WeaponSlot[] = [];
  /** Current weapon target. */
  target: Entity | null = null;
  targetX = 0;
  targetY = 0;
  hasGroundTarget = false;
  lastDamagedTick = -99999;
  lastAttacker = 0;
  /** Iron Curtain invulnerability, seconds remaining. */
  invulnerable = 0;
  /** Tick of last shot (render recoil). */
  lastFireTick = -99999;
  lastFireMuzzle = 0;
  kills = 0;
  /** Veterancy: experience (credits worth destroyed) and rank 0 = rookie, 1 = veteran, 2 = elite. */
  xp = 0;
  rank = 0;
  scanTimer = 0;
  /**
   * Hidden from enemies (submerged submarine, mine, camo pillbox) unless detected: see World.canSee.
   * `revealedTo` is the bitmask of player ids (1 << id) that currently detect this entity.
   */
  cloaked = false;
  revealedTo = 0;
  abstract readonly kind:'infantry' | 'vehicle' | 'aircraft' | 'naval' | 'building';
  abstract readonly type: TypeDef;

  constructor(id: number, owner: Player, x: number, y: number, hp: number) {
    this.id = id;
    this.owner = owner;
    this.x = this.prevX = x;
    this.y = this.prevY = y;
    this.hp = hp;
  }

  /**
   * Commander rules: per-entity health multiplier (a Reinforced defence, sim/economy.ts). Declared only (no class
   * field), so Classic entities and their saves carry nothing; set as a plain property when it applies.
   */
  declare hpBoost?: number;

  get maxHp(): number {
    const c = this.owner.cmd; // doctrine health (Commander rules only)
    return c ? this.type.strength * (c.rules?.hp[this.type.id] ?? 1) * (this.hpBoost ?? 1) : this.type.strength;
  }
  get healthFrac(): number {
    return this.hp / this.maxHp; // maxHp = type.strength under Classic rules
  }
  isBuilding(): this is Building {
    return this.kind === 'building';
  }
  isUnit(): this is Unit {
    return this.kind !== 'building';
  }
}

export class Unit extends Entity {
  readonly kind: 'infantry' | 'vehicle' | 'aircraft' | 'naval';
  readonly ut: UnitTypeDef;
  heading = 0;
  prevHeading = 0;
  turret = 0;
  prevTurret = 0;
  order: Order = { type: 'idle' };
  /** Queued orders (shift-click waypoints). */
  orderQueue: Order[] = [];

  // --- movement
  path: PathPoint[] | null = null;
  pathIdx = 0;
  goalX = 0;
  goalY = 0;
  hasGoal = false;
  pathPending = false;
  /** Last search that could not reach its goal (start/goal cells packed) and when — repeats are throttled. */
  pathFailKey = -1;
  pathFailTick = -1e9;
  moving = false;
  speedFrac = 0;
  progressTimer = 0;
  progressDist = 0;
  stuckCount = 0;
  /** Group-move speed cap (cells/s, 0 = none) so mixed groups arrive together. */
  speedCap = 0;
  /** Building id the unit is currently driving out of (ignored for collision). */
  exitBuilding = 0;
  /** Engagement behaviour (see Stance). */
  stance: Stance = 'guard';
  /** Formation kept on group moves (formation.ts); 'none' = automatic. */
  formShape: FormationShape = 'none';
  /** Where an idle unit returns after chasing a target. */
  guardX: number;
  guardY: number;
  chasing = false;

  // --- harvester
  cargo = 0;
  cargoValue = 0;
  hstate: HarvestState = 'idle';
  harvestTimer = 0;
  lastOreX = -1;
  lastOreY = -1;
  dockAt = 0;
  harvesting = false;
  waitTimer = 0;
  /** Credits deposited since the last "+$" pop-up while unloading. */
  unloadCredit = 0;

  // --- aircraft
  altitude = 0;
  ammo = 0;
  homePad = 0;

  // --- infantry / special
  passengers: Unit[] = [];
  /** Id of the transport this unit is riding in (0 = on foot). */
  transport = 0;
  /** Last C4 charge planted (Tanya): fuse seconds left and the building it is on (indicator only;
   * the charge itself lives on the building and goes off even if this unit dies or moves on). */
  c4Timer = 0;
  c4Target = 0;

  // --- espionage / support powers (see infiltration.ts, powers.ts, mines.ts)
  /** Spy: id of the player whose soldier it appears to be to enemies (-1 = not disguised). */
  disguise = -1;
  /** Paratrooper: seconds of parachute descent left (0 = on the ground). */
  parachute = 0;
  /** Support aircraft (Badger / spy plane): the scripted run it is flying, null otherwise. */
  sortie: Sortie | null = null;

  // --- naval (see naval.ts)
  /** Submarine under water (cloaked). Subs surface to fire and dive again a few seconds later. */
  submerged = false;
  /** Seconds left of the surfacing manoeuvre (can't fire yet). */
  surfacing = 0;
  /** Seconds until a surfaced submarine dives again. */
  diveTimer = 0;
  /** Seconds a submarine is forced to stay surfaced (sonar pulse). */
  surfaceLock = 0;
  /** Transport ramp, 0 = closed .. 1 = fully lowered (LST loading / unloading); rampHold keeps it open. */
  ramp = 0;
  rampHold = 0;

  // --- Aftermath / Counterstrike units (see aftermath.ts)
  /** M.A.D. Tank: 0 = mobile, 1 = deployed and arming (crew bailed out), 2 = pumping its quake pulses. */
  madStage = 0;
  /** M.A.D. Tank: seconds left in the current stage (stage 2: until the next pulse). */
  madTimer = 0;
  /** M.A.D. Tank: 0..1 progress from deploying to the final pulse (renderer: piston / anim.charge). */
  madCharge = 0;
  /** M.A.D. Tank: quake pulses released so far. */
  madPulses = 0;
  /** Chrono Tank: seconds until it can chronoshift again (0 = ready). */
  chronoCooldown = 0;
  /** Demolition truck: has a target and is driving in to detonate (renderer / sfx). */
  armed = false;

  constructor(id: number, type: UnitTypeDef, owner: Player, x: number, y: number) {
    super(id, owner, x, y, type.strength);
    this.ut = type;
    this.kind = type.kind;
    this.guardX = x;
    this.guardY = y;
    if (type.primary) this.weapons.push(new WeaponSlot(WEAPONS[type.primary]));
    if (type.secondary && type.secondary !== type.primary) this.weapons.push(new WeaponSlot(WEAPONS[type.secondary]));
    this.ammo = type.ammo ?? 0;
    // a parked demolition truck never sets off on its own (aftermath.ts)
    if (type.demolition) this.stance = 'passive';
  }

  get type(): UnitTypeDef {
    return this.ut;
  }
  get isAir(): boolean {
    return this.kind === 'aircraft' && this.altitude > 0.2;
  }
}

export class Building extends Entity {
  readonly kind = 'building' as const;
  readonly bt: BuildingTypeDef;
  /** Top-left footprint cell. */
  cx: number;
  cy: number;
  turret = 0;
  prevTurret = 0;
  /** 0..1 construction ("make") animation; building is inactive until 1. */
  buildAnim = 0;
  repairing = false;
  repairTimer = 0;
  primary = false;
  rallyX = -1;
  rallyY = -1;
  /** Rally to a unit: id of the own unit new units join and guard (0 = none, see orders.ts). */
  rallyUnit = 0;
  door = 0;
  doorHold = 0;
  /** Refinery: harvester currently docked. */
  dockOccupant = 0;
  load = 0;
  /** Tesla charge-up progress in seconds. */
  charge = 0;
  charging = false;
  /** Selling animation seconds remaining (-1 = not selling). */
  selling = -1;
  powered = true;
  /** Planted C4: seconds until detonation (0 = none), planting player id and unit id (kill credit). */
  c4Timer = 0;
  c4Owner = -1;
  c4By = 0;
  /** Counted in owner.owned (tech / factory availability): set when construction completes. */
  counted = false;
  /** Bitmask of player ids (1 << id) whose spies have infiltrated this structure (intel while it stands). */
  spiedBy = 0;
  /** Radar dome / SAM site jammed by an enemy Mobile Radar Jammer in range. */
  jammed = false;
  /**
   * Commander rules economy (sim/economy.ts). Declared only (no class fields: Classic structures and saves carry
   * nothing), set as plain properties when they apply, so saves restore them with the other fields.
   * `upgrades`: completed upgrade modules (renderer: render/models/upgrade-modules.ts); `task`: the upgrade or
   * research in progress here; `garrison`: ids of the infantry inside a bunker.
   */
  declare upgrades?: string[];
  declare task?: EconTask;
  declare garrison?: number[];

  constructor(id: number, type: BuildingTypeDef, owner: Player, cx: number, cy: number) {
    super(id, owner, cx + type.size[0] / 2, cy + type.size[1] / 2, type.strength);
    this.bt = type;
    this.cx = cx;
    this.cy = cy;
    if (type.primary) this.weapons.push(new WeaponSlot(WEAPONS[type.primary]));
    this.turret = Math.PI / 2; // face south (towards camera)
    this.prevTurret = this.turret;
  }

  get type(): BuildingTypeDef {
    return this.bt;
  }
  get w() {
    return this.bt.size[0];
  }
  get h() {
    return this.bt.size[1];
  }
  get active(): boolean {
    return this.buildAnim >= 1 && this.selling < 0;
  }
  /** Distance from a point to this building's footprint rectangle. */
  distTo(px: number, py: number): number {
    const dx = Math.max(this.cx - px, 0, px - (this.cx + this.w));
    const dy = Math.max(this.cy - py, 0, py - (this.cy + this.h));
    return Math.hypot(dx, dy);
  }
  /** Closest point on the footprint to (px, py). */
  closestPoint(px: number, py: number): [number, number] {
    return [Math.min(Math.max(px, this.cx), this.cx + this.w), Math.min(Math.max(py, this.cy), this.cy + this.h)];
  }
  dockCell(): [number, number] | null {
    const d = this.bt.dock;
    return d ? [this.cx + d[0], this.cy + d[1]] : null;
  }
  exitCell(): [number, number] {
    const e = this.bt.exit ?? [Math.floor(this.w / 2), this.h];
    return [this.cx + e[0], this.cy + e[1]];
  }
}

export function isUnitType(id: string) {
  return id in UNITS;
}
export function isBuildingTypeId(id: string) {
  return id in BUILDINGS;
}

/** Distance from point to entity (edge for buildings, centre for units). */
export function distToEntity(px: number, py: number, e: Entity): number {
  if (e.kind === 'building') return (e as Building).distTo(px, py);
  return Math.hypot(e.x - px, e.y - py);
}
