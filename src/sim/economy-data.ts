/**
 * Commander rules economy and tech evolution: the data. Tech tiers, structure upgrades, research, the doctrine
 * synergies and the small per-player state they need. Pure tables and helpers (no World access), so the shared
 * hot paths (player.ts, harvest.ts, doctrine.ts, entities.ts) can read them without import cycles. The behaviour
 * lives in economy.ts; the player-facing explanation is docs/ECONOMY.md.
 *
 * Everything here is only reached when a player has `econ` (Commander rules). Classic players never do.
 */
import { BUILDINGS, UNITS, BAIL_COUNT, type Faction, type TypeDef, type BuildingTypeDef } from '../data/rules';
import type { DoctrineEffect } from './doctrine';
import type { Player } from './player';

// =====================================================================================================
// Per-player state
// =====================================================================================================

/** Commander economy state of one player (Player.econ, non-enumerable like Player.cmd; saved by economy.ts). */
export interface PlayerEcon {
  /** Tech tier 1..3 (Construction Yard upgrades cy_t2 / cy_t3). Permanent once reached. */
  tier: number;
  /** Research levels reached (0..2) by research id. */
  levels: Record<string, number>;
  /** Bit signature of the inputs of the compiled modifiers (economy.ts recompiles when it changes). Not saved. */
  sig: number;
}

/** Work in progress on a structure (Building.task): an upgrade, or a research project at a lab. */
export interface EconTask {
  kind: 'upgrade' | 'research';
  id: string;
  /** Research level being researched (1 or 2); 1 for upgrades. */
  level: number;
  /** 0..1 */
  progress: number;
  /** Credits paid so far (refunded if the work is cancelled or the structure is lost). */
  paid: number;
  /** Player who pays (an engineer capture mid-task refunds them). */
  player: number;
}

// =====================================================================================================
// Tiers
// =====================================================================================================

export const MAX_TIER = 3;

/** Tier a structure needs (missing = tier 1). Units follow through their prerequisites (Tech Centres need T2). */
export const TIER_OF: Record<string, number> = {
  rlab: 2, lgst: 2, purf: 2, smlt: 2, gate: 2, atek: 2, stek: 2,
  mslo: 3, iron: 3, pdox: 3,
};

export const TIER_NAMES = ['', 'Foundation', 'Industrial', 'Command'];

/** Tier a type needs (1 = from the start). */
export function tierOf(id: string): number {
  return TIER_OF[id] ?? 1;
}

// =====================================================================================================
// Structure upgrades
// =====================================================================================================

export interface UpgradeDef {
  id: string;
  name: string;
  /** Structure types it can be installed on. */
  hosts: string[];
  /** Price (credits); per host type where it varies. */
  cost: number;
  /** Seconds at full power and normal speed. */
  time: number;
  /** Tech tier needed. */
  tier: number;
  /** Another upgrade the same structure must have first (cy_t3 needs cy_t2). */
  after?: string;
  /** Other structures the player must own ("a|b" = either). */
  prereq?: string[];
  /** One per player: an effect for the whole army (installing it on a second structure adds nothing). */
  unique?: boolean;
  /** Player-facing effect (one line) and flavour. */
  effect: string;
  blurb: string;
}

const DEFENCE_HOSTS = ['pbox', 'hbox', 'gun', 'ftur', 'tsla', 'agun', 'sam', 'bnkr', 'gate'];

export const UPGRADES: Record<string, UpgradeDef> = {
  cy_t2: {
    id: 'cy_t2', name: 'Tier 2: Industrial', hosts: ['fact'], cost: 1000, time: 30, tier: 1, prereq: ['proc', 'tent|barr'], unique: true,
    effect: 'Unlocks the Research Lab, Logistics Centre, Ore Purifier, Fortress Gate, Tech Centre and Tier 2 upgrades.',
    blurb: 'Cranes, extra bays and a bigger crew: the yard can build industrial and advanced structures.',
  },
  cy_t3: {
    id: 'cy_t3', name: 'Tier 3: Command', hosts: ['fact'], cost: 2000, time: 45, tier: 2, after: 'cy_t2', prereq: ['dome'], unique: true,
    effect: 'Unlocks superweapons, Level II research and the Armour Shop.',
    blurb: 'A command tower crowns the yard: the war\'s most advanced projects are now within reach.',
  },
  powr_turbine: {
    id: 'powr_turbine', name: 'Turbine', hosts: ['powr', 'apwr'], cost: 300, time: 15, tier: 1,
    effect: '+50% power output from this plant.',
    blurb: 'More power without more plants to guard.',
  },
  proc_processor: {
    id: 'proc_processor', name: 'Ore Processor', hosts: ['proc'], cost: 800, time: 25, tier: 2,
    effect: 'Ore unloaded here is worth 20% more, and trucks unload twice as fast.',
    blurb: 'A second processing line: the queue at the dock shrinks, the money grows.',
  },
  barr_training: {
    id: 'barr_training', name: 'Training Ground', hosts: ['tent', 'barr'], cost: 1000, time: 30, tier: 2,
    effect: 'Infantry trained here arrive as Veterans.',
    blurb: 'Live-fire drills: recruits leave the gate already blooded.',
  },
  weap_assembly: {
    id: 'weap_assembly', name: 'Assembly Line', hosts: ['weap'], cost: 1500, time: 40, tier: 2, unique: true,
    effect: 'All vehicles build 25% faster (one Assembly Line is enough).',
    blurb: 'A second line runs night and day.',
  },
  weap_armor: {
    id: 'weap_armor', name: 'Armour Shop', hosts: ['weap'], cost: 2000, time: 45, tier: 3, unique: true,
    effect: 'All your vehicles +10% health while you keep it.',
    blurb: 'Every hull gets extra plates bolted on.',
  },
  def_reinforced: {
    id: 'def_reinforced', name: 'Reinforced', hosts: DEFENCE_HOSTS, cost: 0, time: 12, tier: 2,
    effect: '+30% health for this defence.',
    blurb: 'Poured concrete and armour collars.',
  },
  dome_uplink: {
    id: 'dome_uplink', name: 'Satellite Uplink', hosts: ['dome'], cost: 1200, time: 30, tier: 2, unique: true,
    effect: 'The dome sees 6 cells further, and support powers (GPS, spy plane, paratroopers, parabombs) recharge 25% faster.',
    blurb: 'A dish on the dome, a direct line to orbit.',
  },
};

export const UPGRADE_IDS = Object.keys(UPGRADES);

/** Reinforcing a defence costs 40% of the defence (at least $150, rounded to $50). */
export function upgradeBaseCost(u: UpgradeDef, host: BuildingTypeDef): number {
  if (u.id === 'def_reinforced') return Math.max(150, Math.round((host.cost * 0.4) / 50) * 50);
  return u.cost;
}

/** Upgrades a structure type can take (display order). */
export function upgradesFor(typeId: string): UpgradeDef[] {
  return UPGRADE_IDS.map((id) => UPGRADES[id]).filter((u) => u.hosts.includes(typeId));
}

// numbers the simulation reads
export const TURBINE_MUL = 1.5;
export const PROCESSOR_MUL = 1.2;
export const PROCESSOR_UNLOAD = 0.5;
export const PURIFIER_MUL = 1.25;
export const REINFORCED_HP = 1.3;
export const UPLINK_SIGHT = 6;
export const UPLINK_CHARGE = 0.25;
export const LOGISTICS_DISCOUNT = 0.9;
export const LOGISTICS_RADIUS = 6;

// =====================================================================================================
// Research
// =====================================================================================================

export interface ResearchLevel {
  cost: number;
  time: number;
  effect: string;
  /** Modifiers compiled into the player's rules (the doctrine path: sim/doctrine.ts). */
  effects: DoctrineEffect[];
}

export interface ResearchDef {
  id: string;
  name: string;
  /** Who can research it. */
  factions: Faction[];
  /** UI icon key (ui/research.ts). */
  icon: string;
  /** Branch shown in the research tree. */
  branch: 'armour' | 'firepower' | 'production' | 'economy' | 'support';
  blurb: string;
  levels: [ResearchLevel, ResearchLevel];
}

// selectors
const isVehicle = (t: TypeDef) => t.kind === 'vehicle';
const isInfantry = (t: TypeDef) => t.kind === 'infantry';
const isUnit = (t: TypeDef) => t.kind !== 'building';
const isStructure = (t: TypeDef) => t.kind === 'building';
const notMcv = (t: TypeDef) => isVehicle(t) && !('deploysInto' in t && t.deploysInto);
const TANKS = new Set(['3tnk', '4tnk', 'ttnk', 'qtnk']);
const isTank = (t: TypeDef) => TANKS.has(t.id);
const isHarvester = (t: TypeDef) => t.kind === 'vehicle' && 'harvester' in t && !!t.harvester;

/** Weapons carried by vehicles and defences (Precision Optics). */
function opticsWeapons(): string[] {
  const s = new Set<string>();
  for (const u of Object.values(UNITS)) if (u.kind === 'vehicle' && !u.harvester) { if (u.primary) s.add(u.primary); if (u.secondary) s.add(u.secondary); }
  for (const b of Object.values(BUILDINGS)) if (b.category === 'defense' && b.primary) s.add(b.primary);
  return [...s].sort();
}

const BOTH: Faction[] = ['allies', 'soviet'];
const TESLA = ['TeslaZap', 'TTankZap', 'PortaTesla'];

export const RESEARCH: Record<string, ResearchDef> = {
  // ------------------------------------------------------------------------------------- Allies
  composite_armor: {
    id: 'composite_armor', name: 'Composite Armour', factions: ['allies'], icon: 'shield', branch: 'armour',
    blurb: 'Layered ceramic plates turn shells aside.',
    levels: [
      { cost: 1500, time: 40, effect: 'Vehicles take 10% less damage.', effects: [{ stat: 'armor', mul: 0.9, types: isVehicle }] },
      { cost: 2500, time: 60, effect: 'Vehicles take 20% less damage.', effects: [{ stat: 'armor', mul: 0.8 / 0.9, types: isVehicle }] },
    ],
  },
  precision_optics: {
    id: 'precision_optics', name: 'Precision Optics', factions: ['allies'], icon: 'target', branch: 'firepower',
    blurb: 'Laser rangefinders on every gun.',
    levels: [
      { cost: 1500, time: 40, effect: 'Vehicle and defence weapons reach 10% further.', effects: [{ stat: 'range', mul: 1.1, weapons: opticsWeapons() }] },
      { cost: 2500, time: 60, effect: 'Vehicle and defence weapons reach 20% further.', effects: [{ stat: 'range', mul: 1.2 / 1.1, weapons: opticsWeapons() }] },
    ],
  },
  rapid_deployment: {
    id: 'rapid_deployment', name: 'Rapid Deployment', factions: ['allies'], icon: 'gauge', branch: 'production',
    blurb: 'Prefabricated everything.',
    levels: [
      { cost: 1200, time: 35, effect: 'Units build 15% faster.', effects: [{ stat: 'time', mul: 1 / 1.15, types: isUnit }] },
      { cost: 2000, time: 50, effect: 'Structures, upgrades and research also build 25% faster.', effects: [{ stat: 'time', mul: 1 / 1.25, types: isStructure }] },
    ],
  },
  chrono_logistics: {
    id: 'chrono_logistics', name: 'Chrono Logistics', factions: ['allies'], icon: 'chrono', branch: 'economy',
    blurb: 'Einstein\'s gift to the supply corps.',
    levels: [
      { cost: 1500, time: 40, effect: 'Full Ore Trucks far from a refinery chronoshift next to it (each once every 45 s).', effects: [] },
      { cost: 2000, time: 50, effect: 'The Chronosphere and Chrono Tanks recharge 30% faster.', effects: [] },
    ],
  },
  // ------------------------------------------------------------------------------------- Soviets
  reactive_armor: {
    id: 'reactive_armor', name: 'Reactive Armour', factions: ['soviet'], icon: 'shield', branch: 'armour',
    blurb: 'Explosive bricks that meet the shell halfway.',
    levels: [
      { cost: 1500, time: 40, effect: 'Heavy, Mammoth, Tesla and M.A.D. Tanks +15% health.', effects: [{ stat: 'hp', mul: 1.15, types: isTank }] },
      { cost: 2500, time: 60, effect: 'Heavy, Mammoth, Tesla and M.A.D. Tanks +30% health.', effects: [{ stat: 'hp', mul: 1.3 / 1.15, types: isTank }] },
    ],
  },
  tesla_amplifiers: {
    id: 'tesla_amplifiers', name: 'Tesla Amplifiers', factions: ['soviet'], icon: 'bolt', branch: 'firepower',
    blurb: 'More coils, more current, more screaming.',
    levels: [
      { cost: 1200, time: 35, effect: 'Tesla weapons deal 15% more damage.', effects: [{ stat: 'damage', mul: 1.15, weapons: TESLA }] },
      { cost: 2000, time: 50, effect: 'Tesla Coils reach 15% further and drain 40% less power.', effects: [{ stat: 'range', mul: 1.15, weapons: ['TeslaZap'] }, { stat: 'power', mul: 0.6, types: (t) => t.id === 'tsla' }] },
    ],
  },
  conscription: {
    id: 'conscription', name: 'Conscription', factions: ['soviet'], icon: 'infantry', branch: 'production',
    blurb: 'Every factory worker knows which end of a rifle to hold.',
    levels: [
      { cost: 1000, time: 30, effect: 'Infantry cost 15% less.', effects: [{ stat: 'cost', mul: 0.85, types: isInfantry }] },
      { cost: 2000, time: 50, effect: 'Infantry cost 25% less and train 25% faster.', effects: [{ stat: 'cost', mul: 0.75 / 0.85, types: isInfantry }, { stat: 'time', mul: 0.75, types: isInfantry }] },
    ],
  },
  heavy_industry: {
    id: 'heavy_industry', name: 'Heavy Industry', factions: ['soviet'], icon: 'vehicle', branch: 'economy',
    blurb: 'Five-year plans, delivered in two.',
    levels: [
      { cost: 1500, time: 40, effect: 'Vehicles cost 10% less.', effects: [{ stat: 'cost', mul: 0.9, types: notMcv }] },
      { cost: 2500, time: 60, effect: 'Vehicles cost 15% less and build 15% faster.', effects: [{ stat: 'cost', mul: 0.85 / 0.9, types: notMcv }, { stat: 'time', mul: 1 / 1.15, types: notMcv }] },
    ],
  },
  // ------------------------------------------------------------------------------------- shared
  improved_harvesters: {
    id: 'improved_harvesters', name: 'Improved Harvesters', factions: BOTH, icon: 'ore', branch: 'economy',
    blurb: 'Bigger hoppers, thicker hulls.',
    levels: [
      { cost: 1000, time: 30, effect: 'Ore Trucks carry 25% more and take 25% less damage.', effects: [{ stat: 'armor', mul: 0.75, types: isHarvester }] },
      { cost: 1800, time: 45, effect: 'Ore Trucks carry 50% more.', effects: [] },
    ],
  },
  field_medicine: {
    id: 'field_medicine', name: 'Field Medicine', factions: BOTH, icon: 'plus', branch: 'support',
    blurb: 'Medics and mechanics in every squad.',
    levels: [
      { cost: 1000, time: 30, effect: 'Infantry heal 1.5% of their health per second when out of combat for 8 s.', effects: [] },
      { cost: 1800, time: 45, effect: 'Vehicles heal 1% per second out of combat too.', effects: [] },
    ],
  },
};

export const RESEARCH_IDS = Object.keys(RESEARCH);

/** Research a faction can do, in tree order (its own four, then the shared two). */
export function researchFor(faction: Faction): ResearchDef[] {
  const own = RESEARCH_IDS.map((id) => RESEARCH[id]).filter((r) => r.factions.length === 1 && r.factions[0] === faction);
  const shared = RESEARCH_IDS.map((id) => RESEARCH[id]).filter((r) => r.factions.length > 1);
  return [...own, ...shared];
}

/** Level II research needs this tier. */
export const LEVEL2_TIER = 3;
export const CHRONO_MINER_RANGE = 10;
export const CHRONO_MINER_COOLDOWN = 45;
export const CHRONO_RECHARGE = 0.3;
export const MEDIC_INFANTRY = 0.015;
export const MEDIC_VEHICLE = 0.01;
export const MEDIC_QUIET = 8;

// =====================================================================================================
// Doctrine synergy: the research (or upgrade) that fits a doctrine costs 25% less
// =====================================================================================================

export const SYNERGY: Record<string, string> = {
  armouredfist: 'reactive_armor',
  humanwave: 'conscription',
  tesla: 'tesla_amplifiers',
  ironrain: 'heavy_industry',
  blitzkrieg: 'rapid_deployment',
  fortress: 'def_reinforced',
  precision: 'precision_optics',
  shadow: 'chrono_logistics',
};
export const SYNERGY_DISCOUNT = 0.75;

/** Price multiplier of a research / upgrade id for a player (doctrine synergy). */
export function synergyMul(p: Player, id: string): number {
  const d = p.cmd?.doctrine;
  return d && SYNERGY[d] === id ? SYNERGY_DISCOUNT : 1;
}

// =====================================================================================================
// Hot-path helpers (only called when `p.econ` is set)
// =====================================================================================================

/** Research level a player has reached (0 = none). */
export function levelOf(p: Player, id: string): number {
  return p.econ?.levels[id] ?? 0;
}

/** Ore Truck capacity in bails (Improved Harvesters). */
export function harvestCapacity(p: Player): number {
  const l = p.econ?.levels.improved_harvesters ?? 0;
  return l >= 2 ? Math.round(BAIL_COUNT * 1.5) : l >= 1 ? Math.round(BAIL_COUNT * 1.25) : BAIL_COUNT;
}

/** Whether the tier gate lets a player build a type (prerequisites and factories are checked by Player.canBuild). */
export function tierAllows(p: Player, id: string): boolean {
  const e = p.econ;
  return !e || e.tier >= tierOf(id);
}

/** A Commander structure the tech tree makes buildable (Classic: never). */
export function econBuildable(p: Player, t: TypeDef): boolean {
  return !!p.econ && t.kind === 'building' && !!(t as BuildingTypeDef).commander;
}

/** Power output multiplier of a structure (turbines). */
export function powerMul(upgrades: string[] | undefined): number {
  return upgrades && upgrades.includes('powr_turbine') ? TURBINE_MUL : 1;
}

/** Value multiplier of ore unloaded at refinery `r` (Ore Processor there; a powered Purifier / Smelter anywhere). */
export function oreValueMul(p: Player, r: { upgrades?: string[] }): number {
  let m = r.upgrades && r.upgrades.includes('proc_processor') ? PROCESSOR_MUL : 1;
  if ((p.has('purf') || p.has('smlt')) && !p.lowPower) m *= PURIFIER_MUL;
  return m;
}
