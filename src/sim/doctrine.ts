/**
 * Commander rules, part 1: doctrines.
 *
 * A doctrine is a per-player rule set picked before a Commander skirmish: two clear bonuses and one drawback,
 * expressed as multipliers on unit / structure stats (cost, build time, health, speed, damage taken, power drain)
 * and on weapons (damage, reload, range). Everything here is deterministic and per player:
 *
 *  - The global rule tables (UNITS, BUILDINGS, WEAPONS in data/rules.ts) are never touched. A doctrine is compiled
 *    into lookup tables (`DoctrineRules`) and, for weapons, into per-player *variants* of the WeaponDef objects
 *    (same id, modified numbers). An entity of a doctrine player gets the variants in its weapon slots
 *    (`applyDoctrineToEntity`), so every range / damage / reload read in the simulation picks them up for free.
 *  - The other stats are read through tiny guarded hooks (`costOf`, `cmdHpMul`, `cmdSpeed`, `cmdArmor`, ...) placed
 *    in production.ts, entities.ts, unitlogic.ts and combat.ts. Each hook only does anything when the player has a
 *    `cmd` (Commander rules are on); with Classic rules `p.cmd` is undefined and the sim runs bit-identically to
 *    the original code.
 *  - Mods (src/mods/engine.ts) change the shared tables before the World exists; doctrines are compiled on top of
 *    whatever the (modded) tables say, so both compose.
 *
 * The per-match commander state (points, unlocked powers, timed buffs) lives in the same `PlayerCmd` object; the
 * powers themselves are in commander.ts.
 */
import { BUILDINGS, UNITS, WEAPONS, type Faction, type TypeDef, type WeaponDef } from '../data/rules';
import type { Building, Entity, Unit } from './entities';
import type { Player } from './player';
import { powerMul } from './economy-data';

// =====================================================================================================
// Definitions
// =====================================================================================================

/** Stats a doctrine can scale. Type stats are keyed by unit / structure id, weapon stats by weapon id. */
export type TypeStat = 'cost' | 'time' | 'hp' | 'speed' | 'armor' | 'power';
export type WeaponStat = 'damage' | 'rof' | 'range';

export type DoctrineEffect =
  | { stat: TypeStat; mul: number; types: (t: TypeDef) => boolean }
  | { stat: WeaponStat; mul: number; weapons: string[] }
  | { stat: 'gap'; mul: number }
  /** Command points earned (commander.ts; battle, trickle and comeback share, not objective grants). */
  | { stat: 'points'; mul: number }
  /** Commander power recharge time (commander.ts power ids). */
  | { stat: 'cooldown'; mul: number; powers: string[] };

export interface DoctrineDef {
  id: string;
  faction: Faction;
  name: string;
  /** Icon key (ui/doctrine-picker.ts draws it). */
  icon: string;
  /** One line of flavour for the picker. */
  blurb: string;
  /** Exactly two bonuses and one drawback, in player-facing words (the numbers match `effects`). */
  bonuses: [string, string];
  drawback: string;
  /** Commander rank (meta/ranks.ts index) needed to pick it; 0 = available from the start. */
  rank: number;
  effects: DoctrineEffect[];
  /** AI: unit weight multipliers while playing this doctrine (it leans into what the doctrine is good at). */
  prefer: Record<string, number>;
  /** AI: how strongly a personality trait (ai-personality.ts) draws a commander to this doctrine. */
  affinity: Record<string, number>;
  /** AI: extra static defences it allows itself with this doctrine. */
  defences?: number;
}

// selectors ------------------------------------------------------------------------------------------
const ids = (...list: string[]) => {
  const s = new Set(list);
  return (t: TypeDef) => s.has(t.id);
};
const isKind = (kind: string) => (t: TypeDef) => t.kind === kind;
/** Combat vehicles (not harvesters / MCVs / support vehicles: their price is economy, not army). */
const combatVehicle = (t: TypeDef) => t.kind === 'vehicle' && !('harvester' in t && t.harvester) && !('deploysInto' in t && t.deploysInto);
const isDefence = (t: TypeDef) => t.kind === 'building' && t.category === 'defense' && !('wall' in t && t.wall) && !('mine' in t && t.mine);
const isWall = (t: TypeDef) => t.kind === 'building' && 'wall' in t && !!t.wall;

const TESLA_WEAPONS = ['TeslaZap', 'TTankZap', 'PortaTesla'];

/** Every doctrine, keyed by id. Four per faction; the first two of each faction are open from the start. */
export const DOCTRINES: Record<string, DoctrineDef> = {
  // ------------------------------------------------------------------------------------------ Soviet
  armouredfist: {
    id: 'armouredfist', faction: 'soviet', name: 'Armoured Fist', icon: 'tank', rank: 0,
    blurb: 'Steel first. Heavy columns that shrug off fire, Mammoths rolling off the line.',
    bonuses: ['Heavy and Mammoth Tanks +10% health', 'Mammoth Tanks build 15% faster'],
    drawback: 'Infantry cost 15% more',
    effects: [
      { stat: 'hp', mul: 1.1, types: ids('3tnk', '4tnk') },
      { stat: 'time', mul: 1 / 1.15, types: ids('4tnk') },
      { stat: 'cost', mul: 1.15, types: isKind('infantry') },
    ],
    prefer: { '3tnk': 1.15, '4tnk': 1.25 },
    affinity: { tech: 1, aggression: 0.5 },
  },
  humanwave: {
    id: 'humanwave', faction: 'soviet', name: 'Human Wave', icon: 'infantry', rank: 0,
    blurb: 'Quantity has a quality all its own. The barracks never stop.',
    bonuses: ['Infantry cost 25% less', 'Infantry train 25% faster'],
    drawback: 'Vehicles cost 10% more',
    effects: [
      { stat: 'cost', mul: 0.75, types: isKind('infantry') },
      { stat: 'time', mul: 0.75, types: isKind('infantry') },
      { stat: 'cost', mul: 1.1, types: combatVehicle },
    ],
    prefer: { e1: 1.2, e2: 1.25, e3: 1.15, e4: 1.2 },
    affinity: { infantry: 1.6, aggression: 0.4 },
  },
  tesla: {
    id: 'tesla', faction: 'soviet', name: 'Tesla Doctrine', icon: 'bolt', rank: 3,
    blurb: 'Volkov\'s favourite toys: coils, tanks and troopers that hit like lightning.',
    bonuses: ['Tesla weapons deal 15% more damage', 'Tesla Coils reach 15% further'],
    drawback: 'Tesla Coils drain 30% more power',
    effects: [
      { stat: 'damage', mul: 1.15, weapons: TESLA_WEAPONS },
      { stat: 'range', mul: 1.15, weapons: ['TeslaZap'] },
      { stat: 'power', mul: 1.3, types: ids('tsla') },
    ],
    prefer: { ttnk: 1.8, shok: 1.6, '3tnk': 0.9 },
    affinity: { defence: 1.4, tech: 0.6 },
    defences: 2,
  },
  ironrain: {
    id: 'ironrain', faction: 'soviet', name: 'Iron Rain', icon: 'rocket', rank: 6,
    blurb: 'Death from above and beyond: V2 batteries and air wings that never rest.',
    bonuses: ['V2 Rocket Launchers reach 25% further and have 30% more health', 'Aircraft reload 25% faster'],
    drawback: 'Defensive structures cost 10% more',
    effects: [
      { stat: 'range', mul: 1.25, weapons: ['SCUD'] },
      { stat: 'hp', mul: 1.3, types: ids('v2rl') },
      { stat: 'rof', mul: 0.75, weapons: ['Maverick', 'ChainGun'] },
      { stat: 'cost', mul: 1.1, types: isDefence },
    ],
    prefer: { v2rl: 1.25 },
    affinity: { artillery: 1.5, air: 1.2 },
  },
  // ------------------------------------------------------------------------------------------ Allies
  blitzkrieg: {
    id: 'blitzkrieg', faction: 'allies', name: 'Blitzkrieg', icon: 'speed', rank: 0,
    blurb: 'Speed is armour. Strike before the enemy can dig in.',
    bonuses: ['Vehicles move 15% faster', 'Vehicles build 10% faster'],
    drawback: 'Defensive structures have 15% less health',
    effects: [
      { stat: 'speed', mul: 1.15, types: combatVehicle },
      { stat: 'time', mul: 1 / 1.1, types: combatVehicle },
      { stat: 'hp', mul: 0.85, types: isDefence },
    ],
    prefer: { '2tnk': 1.15, '1tnk': 1.1 },
    affinity: { aggression: 1.2, harass: 1 },
  },
  fortress: {
    id: 'fortress', faction: 'allies', name: 'Fortress Europe', icon: 'fort', rank: 0,
    blurb: 'Hold the line. Every approach covered, every wall cheap.',
    bonuses: ['Defensive structures +25% health', 'Walls cost 50% less'],
    drawback: 'Vehicles build 10% slower',
    effects: [
      { stat: 'hp', mul: 1.25, types: isDefence },
      { stat: 'cost', mul: 0.5, types: isWall },
      { stat: 'time', mul: 1.1, types: combatVehicle },
    ],
    prefer: { arty: 1.15 },
    affinity: { defence: 1.6, caution: 0.6 },
    defences: 3,
  },
  precision: {
    id: 'precision', faction: 'allies', name: 'Precision Strike', icon: 'target', rank: 4,
    blurb: 'Find them, fix them, finish them from a distance.',
    bonuses: ['Artillery, Longbows and Cruisers deal 20% more damage', 'Artillery and Cruisers reach 15% further'],
    drawback: 'Infantry cost 10% more',
    effects: [
      { stat: 'damage', mul: 1.2, weapons: ['155mm', 'Hellfire', '8Inch'] },
      { stat: 'range', mul: 1.15, weapons: ['155mm', '8Inch'] },
      { stat: 'cost', mul: 1.1, types: isKind('infantry') },
    ],
    prefer: { arty: 1.15, heli: 1.2 },
    affinity: { artillery: 1.6, air: 0.8 },
  },
  shadow: {
    id: 'shadow', faction: 'allies', name: 'Shadow Network', icon: 'eye', rank: 8,
    blurb: 'The war is won before the first shot: spies everywhere, fields of shroud.',
    bonuses: ['Spies, Thieves, Gap Generators and Radar Jammers cost 40% less; gap shroud reaches 40% further', 'Earn 20% more command points; Recon Sweep and Sabotage recharge 40% faster'],
    drawback: 'Pillboxes and Turrets cost 15% more',
    effects: [
      { stat: 'cost', mul: 0.6, types: ids('spy', 'thf', 'gap', 'mgg', 'mrj') },
      { stat: 'gap', mul: 1.4 },
      { stat: 'points', mul: 1.2 },
      { stat: 'cooldown', mul: 0.6, powers: ['recon', 'sabotage'] },
      { stat: 'cost', mul: 1.15, types: ids('pbox', 'hbox', 'gun') },
    ],
    prefer: {},
    affinity: { subterfuge: 1.8, harass: 0.5 },
  },
};

export const DOCTRINE_IDS = Object.keys(DOCTRINES);

/** The doctrines of a faction, in picker order (starting ones first). */
export function doctrinesFor(faction: Faction): DoctrineDef[] {
  return DOCTRINE_IDS.map((id) => DOCTRINES[id]).filter((d) => d.faction === faction).sort((a, b) => a.rank - b.rank);
}

/** Whether a commander of `rank` (meta/ranks.ts index) may pick this doctrine. UI only: the sim takes any valid id. */
export function doctrineUnlocked(d: DoctrineDef, rank: number): boolean {
  return rank >= d.rank;
}

/** A doctrine id that is valid for the faction, or null. */
export function validDoctrine(id: string | null | undefined, faction: Faction): string | null {
  if (!id || !Object.prototype.hasOwnProperty.call(DOCTRINES, id)) return null;
  return DOCTRINES[id].faction === faction ? id : null;
}

// =====================================================================================================
// Compiled per-player rules
// =====================================================================================================

/** Lookup tables of one doctrine (missing key = x1). Built once per match per player; never saved. */
export interface DoctrineRules {
  id: string;
  cost: Record<string, number>;
  time: Record<string, number>;
  hp: Record<string, number>;
  speed: Record<string, number>;
  armor: Record<string, number>;
  power: Record<string, number>;
  gap: number;
  /** Command points earned multiplier. */
  points: number;
  /** Commander power recharge multipliers by power id. */
  cooldown: Record<string, number>;
  /** Per-player weapon variants by weapon id (same id as the base weapon, modified numbers). */
  weapons: Record<string, WeaponDef>;
}

export function compileDoctrine(id: string): DoctrineRules {
  return applyEffects(blankRules(id), DOCTRINES[id].effects);
}

/** Empty (x1) rules. */
export function blankRules(id: string): DoctrineRules {
  return { id, cost: {}, time: {}, hp: {}, speed: {}, armor: {}, power: {}, gap: 1, points: 1, cooldown: {}, weapons: {} };
}

/** Fold effects into compiled rules (doctrines; Commander research and upgrades, sim/economy.ts, use the same path). */
export function applyEffects(r: DoctrineRules, effects: DoctrineEffect[]): DoctrineRules {
  const types: TypeDef[] = [...Object.values(UNITS), ...Object.values(BUILDINGS)];
  for (const e of effects) {
    if (e.stat === 'gap') { r.gap *= e.mul; continue; }
    if (e.stat === 'points') { r.points *= e.mul; continue; }
    if (e.stat === 'cooldown') { for (const pw of e.powers) r.cooldown[pw] = (r.cooldown[pw] ?? 1) * e.mul; continue; }
    if ('types' in e) {
      const table = r[e.stat];
      for (const t of types) if (e.types(t)) table[t.id] = (table[t.id] ?? 1) * e.mul;
      continue;
    }
    for (const wid of e.weapons) {
      const base = WEAPONS[wid];
      if (!base) continue;
      const v = r.weapons[wid] ?? (r.weapons[wid] = { ...base });
      if (e.stat === 'damage') v.damage = v.damage * e.mul;
      else if (e.stat === 'rof') v.rof = v.rof * e.mul;
      else v.range = v.range * e.mul;
    }
  }
  return r;
}

// =====================================================================================================
// Per-player commander state (doctrine + the commander powers' timed effects, see commander.ts)
// =====================================================================================================

/**
 * Everything Commander rules keep per player. Referenced from `Player.cmd` (a non-enumerable property, so Classic
 * saves are unchanged) and from `World.commander.players`; saved by commander.ts (`rules` is rebuilt on load).
 */
export interface PlayerCmd {
  doctrine: string | null;
  /** Compiled doctrine (derived, not saved). */
  rules: DoctrineRules | null;
  /** Spendable command points (fractional: kills earn partial points). */
  points: number;
  /** Command points earned so far this match (the commander level and tier gates follow it). */
  earned: number;
  /** Powers unlocked, in unlock order. */
  unlocked: string[];
  /** Tick at which each unlocked power is ready again, and the length of its current recharge (ticks). */
  ready: Record<string, number>;
  span: Record<string, number>;
  /** Elite Training: this many more combat units arrive as Veterans. */
  eliteLeft: number;
  /** Rally Cry: unit id -> tick the speed / rate-of-fire boost ends. */
  rally: Map<number, number>;
  /** Aegis Shield: unit id -> tick the damage reduction ends. */
  aegis: Map<number, number>;
  /** Sabotage: id of one of this player's structures -> tick its power comes back. */
  offline: Map<number, number>;
  /** Earning multiplier of the comeback rule (commander.ts), refreshed every 10 s. */
  catchup: number;
  /** Times each power was used (stats, AI pacing). */
  uses: Record<string, number>;
  /** Powers switched off for this player (self-play experiments, tests). */
  disabled: boolean;
}

/** Rally Cry boosts. */
export const RALLY_SPEED = 1.3;
export const RALLY_ROF = 0.75;
/** Aegis Shield: share of incoming damage that still gets through. */
export const AEGIS_FACTOR = 0.5;

// =====================================================================================================
// Simulation hooks (each is only reached when `owner.cmd` is set: Commander rules)
// =====================================================================================================

/** Price of a type for a player (whole credits). Classic: the rules' cost. */
export function costOf(p: Player, t: TypeDef): number {
  const m = p.cmd?.rules?.cost[t.id];
  if (p.hc) return Math.round((m === undefined ? t.cost : t.cost * m) * p.hc.cost); // campaign difficulty: RA's Cost handicap, which the build time follows (sim/handicap.ts)
  return m === undefined ? t.cost : Math.round(t.cost * m);
}

/** Price of a type id (UI helper). */
export function priceOf(p: Player, typeId: string): number {
  const t = UNITS[typeId] ?? BUILDINGS[typeId];
  return t ? costOf(p, t) : 0;
}

/** Build-time multiplier on top of the (doctrine-adjusted) price. */
export function cmdTimeMul(p: Player, t: TypeDef): number {
  return p.cmd?.rules?.time[t.id] ?? 1;
}

/** Health multiplier of an entity (Entity.maxHp). */
export function cmdHpMul(c: PlayerCmd, t: TypeDef): number {
  return c.rules?.hp[t.id] ?? 1;
}

/** Ground speed multiplier: doctrine and Rally Cry. */
export function cmdSpeed(u: Unit): number {
  const c = u.owner.cmd!;
  const m = c.rules?.speed[u.ut.id] ?? 1;
  return c.rally.size && c.rally.has(u.id) ? m * RALLY_SPEED : m;
}

/** Incoming damage multiplier: doctrine armour and Aegis Shield. */
export function cmdArmor(e: Entity): number {
  const c = e.owner.cmd!;
  const m = c.rules?.armor[e.type.id] ?? 1;
  return c.aegis.size && c.aegis.has(e.id) ? m * AEGIS_FACTOR : m;
}

/** Reload multiplier from timed effects (Rally Cry); doctrine reloads are baked into the weapon variants. */
export function cmdRof(e: Entity): number {
  const c = e.owner.cmd!;
  return c.rally.size && c.rally.has(e.id) ? RALLY_ROF : 1;
}

/** Power of a structure for its owner's economy: drain multiplier, and no output while sabotaged. */
export function cmdPower(b: Building): number {
  const c = b.owner.cmd!;
  const pw = b.bt.power;
  if (pw > 0) return c.offline.size && c.offline.has(b.id) ? 0 : b.upgrades ? pw * powerMul(b.upgrades) : pw; // (turbine upgrade, sim/economy.ts)
  const m = c.rules?.power[b.bt.id];
  return m === undefined ? pw : pw * m;
}

/** A sabotaged structure: no power output, its weapons silent. */
export function cmdOffline(b: Building): boolean {
  const c = b.owner.cmd;
  return !!c && c.offline.size > 0 && c.offline.has(b.id);
}

/** Gap generator shroud radius multiplier. */
export function cmdGap(p: Player): number {
  return p.cmd?.rules?.gap ?? 1;
}

/** Put the owner's weapon variants into an entity's slots (spawn, load, capture). Returns true if any changed. */
export function applyDoctrineToEntity(e: Entity): boolean {
  const vars = e.owner.cmd?.rules?.weapons;
  let changed = false;
  for (const s of e.weapons) {
    const want = (vars && vars[s.def.id]) || WEAPONS[s.def.id] || s.def;
    if (want !== s.def) { s.def = want; changed = true; }
  }
  return changed;
}

/** The weapon a projectile of `owner` with this weapon id should carry (save / load). */
export function weaponFor(owner: Player, id: string): WeaponDef | undefined {
  return owner.cmd?.rules?.weapons[id] ?? WEAPONS[id];
}

/** AI: extra static defences for the player's doctrine (ai.ts defenceCap). */
export function doctrineDefences(p: Player): number {
  const id = p.cmd?.doctrine;
  return id ? DOCTRINES[id].defences ?? 0 : 0;
}

/** AI: unit weight multiplier for the player's doctrine (ai.ts mix). */
export function doctrinePrefer(p: Player, typeId: string): number {
  const id = p.cmd?.doctrine;
  return id ? DOCTRINES[id].prefer[typeId] ?? 1 : 1;
}
