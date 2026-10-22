import { BUILDINGS, UNITS, getType, isBuildingType, type Faction, type TypeDef } from '../data/rules';
import type { AnnouncerKey } from '../audio/types';
import type { PlanItem, QueueKind } from './types';
import type { SuperKind } from './superweapons';
import type { PlayerCmd } from './doctrine';
import { econBuildable, tierAllows, type PlayerEcon } from './economy-data';
import type { Handicap } from './handicap';

export interface QueueItem {
  type: string;
  progress: number; // 0..1
  paid: number;
  paused: boolean;
}

export class ProductionQueue {
  items: QueueItem[] = [];
  /** Structure finished and waiting for placement. */
  ready: string | null = null;
  stalled = false;
  constructor(public kind: QueueKind) {}
  count(type: string) {
    let n = 0;
    for (const it of this.items) if (it.type === type) n++;
    return n;
  }
}

/** What a player's spies have found out (player ids per category). */
export interface PlayerIntel {
  radar: number[];
  power: number[];
  credits: number[];
  production: number[];
}

export interface PlayerStats {
  unitsBuilt: number;
  unitsLost: number;
  unitsKilled: number;
  buildingsBuilt: number;
  buildingsLost: number;
  buildingsKilled: number;
  harvested: number;
  spent: number;
}

/** Types that are not available yet (systems not implemented). */
export const DISABLED_TYPES = new Set<string>();

export function queueKindOf(t: TypeDef): QueueKind {
  if (isBuildingType(t)) return 'structure';
  if (t.kind === 'infantry') return 'infantry';
  if (t.kind === 'aircraft') return 'aircraft';
  if (t.kind === 'naval') return 'naval';
  return 'vehicle';
}

export class Player {
  readonly id: number;
  name: string;
  faction: Faction;
  color: number;
  team: number;
  isHuman: boolean;
  /** Cash (unlimited). */
  cash: number;
  /** Processed ore in storage (limited by silos/refineries). */
  ore = 0;
  storage = 0;
  powerOut = 0;
  powerUse = 0;
  defeated = false;
  /** Surrendered (sim/resign.ts): out of the match and beaten, whatever the side does; set only then (saved with the player). */
  declare resigned?: boolean;
  queues: Record<QueueKind, ProductionQueue> = {
    structure: new ProductionQueue('structure'),
    infantry: new ProductionQueue('infantry'),
    vehicle: new ProductionQueue('vehicle'),
    aircraft: new ProductionQueue('aircraft'),
    naval: new ProductionQueue('naval'),
  };
  /** Count of completed buildings by type id. */
  owned = new Map<string, number>();
  /** Fog of war: number of own units seeing each cell, and explored flags. */
  visible: Uint16Array;
  explored: Uint8Array;
  radar = false;
  stats: PlayerStats = { unitsBuilt: 0, unitsLost: 0, unitsKilled: 0, buildingsBuilt: 0, buildingsLost: 0, buildingsKilled: 0, harvested: 0, spent: 0 };
  /** Superweapon charge in seconds; ready when >= the building's superCharge. */
  superCharge: Record<SuperKind, number> = { nuke: 0, ironcurtain: 0, chrono: 0, gps: 0, sonar: 0, spyplane: 0, paratroopers: 0, parabombs: 0 };
  superAnnounced: Record<SuperKind, boolean> = { nuke: false, ironcurtain: false, chrono: false, gps: false, sonar: false, spyplane: false, paratroopers: false, parabombs: false };
  /** Announcement throttle (tick of last per key). */
  lastAnnounce = new Map<AnnouncerKey, number>();
  /** Production speed multiplier (AI difficulty). */
  buildSpeed = 1;
  /** Harvest income multiplier (AI difficulty). */
  incomeBias = 1;
  /** Last known location of an attack on this player (for camera jump). */
  lastAttackX = -1;
  lastAttackY = -1;
  /** Mission tech restriction: only these types may be built (null = unrestricted). */
  allowedTypes: Set<string> | null = null;
  /** Snapshot of buildable ids to detect "new construction options". */
  knownOptions = new Set<string>();
  /**
   * Espionage results (spies, see infiltration.ts): ids of the players whose radar view (their `visible` cells
   * and units, for the minimap), power, credits and factory production this player can currently see.
   * Recomputed every second from the infiltrated structures still standing.
   */
  intel: PlayerIntel = { radar: [], power: [], credits: [], production: [] };
  /** GPS satellite launched: the whole map stays explored, radar can't be jammed. */
  gps = false;
  /** Seconds left of the full-visibility snapshot after a GPS launch. */
  gpsPulse = 0;
  /** Sonar pulses granted by spies in enemy sub pens (one-shot each). */
  sonarCharges = 0;
  /** Temporary reveals (spy plane photos): cells within r of (x, y) visible for t more seconds. */
  reveals: { x: number; y: number; r: number; t: number }[] = [];
  /** Sonar pulse: enemy submarines are revealed to this player's team until this tick (see World.revealCloaked). */
  sonarUntil = 0;
  /** Naval yards (shipyard / sub pen) destroyed so far and the tick of the last loss (naval AI pacing). */
  yardsLost = 0;
  yardLostTick = -1e9;
  /** Planned build order (orders.ts): built and placed in order by the Construction Yard. */
  buildPlan: (PlanItem & { started?: boolean; placing?: number; wait?: number })[] = [];
  /** Repeat production (sim/repeat.ts): unit types that keep being built while money allows, in the order switched on. */
  repeat: string[] = [];
  /**
   * Commander rules state (doctrine modifiers, command points, power effects; sim/doctrine.ts). Undefined
   * under Classic rules. A non-enumerable property set by sim/commander.ts (`declare`: no class field is emitted),
   * so Classic players and their saves carry no extra field.
   */
  declare cmd?: PlayerCmd;
  /** Commander rules economy (tech tier, research; sim/economy.ts): non-enumerable like `cmd`, undefined under Classic rules. */
  declare econ?: PlayerEcon;
  /** Campaign difficulty: RA's handicap for this side (sim/handicap.ts); non-enumerable like `cmd`, undefined at Normal and outside missions. */
  declare hc?: Handicap;

  constructor(opts: { id: number; name: string; faction: Faction; color: number; team: number; isHuman: boolean; cash: number; mapCells: number }) {
    this.id = opts.id;
    this.name = opts.name;
    this.faction = opts.faction;
    this.color = opts.color;
    this.team = opts.team;
    this.isHuman = opts.isHuman;
    this.cash = opts.cash;
    this.visible = new Uint16Array(opts.mapCells);
    this.explored = new Uint8Array(opts.mapCells);
  }

  get credits(): number {
    return Math.floor(this.cash + this.ore);
  }
  get lowPower(): boolean {
    return this.powerUse > this.powerOut;
  }
  /** 0..1 how much of the demand is satisfied. */
  get powerRatio(): number {
    if (this.powerUse <= 0) return 1;
    return Math.min(1, this.powerOut / this.powerUse);
  }

  isEnemy(other: Player): boolean {
    // the neutral pseudo-player (id -1: tech structures, convoys, sim/events.ts) is nobody's enemy
    return other !== this && other.team !== this.team && (this.id | other.id) >= 0;
  }

  has(typeId: string): boolean {
    return (this.owned.get(typeId) ?? 0) > 0;
  }

  /** Spend money: stored ore first, then cash. Returns false (and spends nothing) if not enough. */
  spend(amount: number): boolean {
    if (this.cash + this.ore < amount) return false;
    if (this.ore >= amount) {
      this.ore -= amount;
    } else {
      const rest = amount - this.ore;
      this.ore = 0;
      this.cash -= rest;
    }
    this.stats.spent += amount;
    return true;
  }

  refund(amount: number) {
    this.cash += amount;
    this.stats.spent -= amount;
  }

  /** Deposit processed ore. Returns the amount that fit into storage. */
  depositOre(amount: number): number {
    const room = Math.max(0, this.storage - this.ore);
    const take = Math.min(room, amount);
    this.ore += take;
    this.stats.harvested += take;
    return take;
  }

  prereqsMet(t: TypeDef): boolean {
    for (const req of t.prereq) {
      const alts = req.split('|');
      if (!alts.some((a) => this.has(a))) return false;
    }
    return true;
  }

  /** Whether this player may build the type right now (tech + factory present). */
  canBuild(typeId: string): boolean {
    const t = getType(typeId);
    if ((!t.buildable && !(this.econ && econBuildable(this, t))) || DISABLED_TYPES.has(typeId)) return false; // (Commander structures)
    if (this.allowedTypes && !this.allowedTypes.has(typeId)) return false;
    if (!t.owner.includes(this.faction)) return false;
    if (!this.prereqsMet(t)) return false;
    if (this.econ && !tierAllows(this, typeId)) return false; // Commander tech tiers
    return this.hasFactoryFor(typeId);
  }

  hasFactoryFor(typeId: string): boolean {
    const t = getType(typeId);
    if (isBuildingType(t)) return this.has('fact');
    for (const [bid, n] of this.owned) {
      if (n <= 0) continue;
      const b = BUILDINGS[bid];
      if (!b.factory || b.factory !== t.kind) continue;
      if (b.factoryOnly && !b.factoryOnly.includes(typeId)) continue;
      if (!b.factoryOnly && t.kind === 'infantry' && typeId === 'dog') continue;
      return true;
    }
    return false;
  }

  /** All type ids visible in the sidebar for this faction (buildable now). */
  buildOptions(): string[] {
    const out: string[] = [];
    for (const id of Object.keys(BUILDINGS)) if (this.canBuild(id)) out.push(id);
    for (const id of Object.keys(UNITS)) if (this.canBuild(id)) out.push(id);
    return out;
  }
}
