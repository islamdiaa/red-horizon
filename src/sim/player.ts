import { BUILDINGS, UNITS, getType, isBuildingType, type Faction, type TypeDef } from '../data/rules';
import type { AnnouncerKey } from '../audio/types';
import type { QueueKind } from './types';

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
export const DISABLED_TYPES = new Set<string>(['apc']);

export function queueKindOf(t: TypeDef): QueueKind {
  if (isBuildingType(t)) return 'structure';
  if (t.kind === 'infantry') return 'infantry';
  if (t.kind === 'aircraft') return 'aircraft';
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
  queues: Record<QueueKind, ProductionQueue> = {
    structure: new ProductionQueue('structure'),
    infantry: new ProductionQueue('infantry'),
    vehicle: new ProductionQueue('vehicle'),
    aircraft: new ProductionQueue('aircraft'),
  };
  /** Count of completed buildings by type id. */
  owned = new Map<string, number>();
  /** Fog of war: number of own units seeing each cell, and explored flags. */
  visible: Uint16Array;
  explored: Uint8Array;
  radar = false;
  stats: PlayerStats = { unitsBuilt: 0, unitsLost: 0, unitsKilled: 0, buildingsBuilt: 0, buildingsLost: 0, buildingsKilled: 0, harvested: 0, spent: 0 };
  /** Superweapon charge in seconds; ready when >= the building's superCharge. */
  superCharge: Record<'nuke' | 'ironcurtain' | 'chrono', number> = { nuke: 0, ironcurtain: 0, chrono: 0 };
  superAnnounced: Record<'nuke' | 'ironcurtain' | 'chrono', boolean> = { nuke: false, ironcurtain: false, chrono: false };
  /** Announcement throttle (tick of last per key). */
  lastAnnounce = new Map<AnnouncerKey, number>();
  /** Production speed multiplier (AI difficulty). */
  buildSpeed = 1;
  /** Harvest income multiplier (AI difficulty). */
  incomeBias = 1;
  /** Last known location of an attack on this player (for camera jump). */
  lastAttackX = -1;
  lastAttackY = -1;
  /** Snapshot of buildable ids to detect "new construction options". */
  knownOptions = new Set<string>();

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
    return other !== this && other.team !== this.team;
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
    if (!t.buildable || DISABLED_TYPES.has(typeId)) return false;
    if (!t.owner.includes(this.faction)) return false;
    if (!this.prereqsMet(t)) return false;
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
