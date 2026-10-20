/**
 * Commander rules economy and tech evolution: the behaviour (the tables are in economy-data.ts, the player-facing
 * explanation in docs/ECONOMY.md).
 *
 *  - Tech tiers: the Construction Yard upgrades to Tier 2 and Tier 3 (`cy_t2`, `cy_t3`); a tier is the player's for
 *    good, and every yard they own shows its modules (`Building.upgrades`).
 *  - Structure upgrades (`upgrade` command): paid while they build, like production; per structure (Turbine,
 *    Processor, Training Ground, Reinforced) or one per player (Assembly Line, Armour Shop, Satellite Uplink).
 *  - Research at a Research Lab (`research` command): global upgrades in two levels, compiled into the player's
 *    modifier tables through the doctrine path (sim/doctrine.ts), so every cost / time / health / armour / weapon
 *    read in the simulation picks them up.
 *  - New structures: Ore Purifier / Smelter (+25% / +40% ore value), Mining Outpost (a forward dock), Logistics Centre
 *    (cheaper units, free repairs nearby), Bunker (infantry garrison) and Fortress Gate (opens for its team only).
 *
 * Deterministic: driven by commands and the world tick, no randomness. State: `World.econ` (tiers and research per
 * player) plus plain properties on the structures (`upgrades`, `task`, `garrison`, `hpBoost`), which saves carry with
 * the entities. Classic worlds have `econ === null` and never reach this module.
 */
import { BUILDINGS, type BuildingTypeDef, type TypeDef } from '../data/rules';
import { Building, Unit, distToEntity, type Entity } from './entities';
import type { Player } from './player';
import { DT, TICK_HZ, type Command } from './types';
import type { DeathHow, World } from './world';
import { DOCTRINES, applyDoctrineToEntity, applyEffects, blankRules, type DoctrineEffect } from './doctrine';
import { findTarget, maxRange, pickWeapon, updateUnitWeapons } from './combat';
import { SUPER_KINDS, superAvailable, superFull } from './superweapons';
import {
  CHRONO_MINER_COOLDOWN, CHRONO_MINER_RANGE, CHRONO_RECHARGE, LEVEL2_TIER, LOGISTICS_DISCOUNT, LOGISTICS_RADIUS, MAX_TIER,
  MEDIC_INFANTRY, MEDIC_QUIET, MEDIC_VEHICLE, REINFORCED_HP, RESEARCH, RESEARCH_IDS, UPGRADES, UPLINK_CHARGE, UPLINK_SIGHT,
  harvestCapacity, synergyMul, upgradeBaseCost, type EconTask, type PlayerEcon,
} from './economy-data';

export interface EconState {
  players: PlayerEcon[];
  /**
   * Derived, not saved (rebuilt every 10 ticks and on load): whether any structure has a task / a garrison, and the
   * fortress gates. They only spare the per-tick passes over every structure when there is nothing to do.
   */
  busy: boolean;
  manned: boolean;
  /** Signature of the standing gates the pathfinder knows (rebuilt the tick they change; -1 = rebuild). */
  gateSig: number;
}

// =====================================================================================================
// Setup
// =====================================================================================================

function attach(p: Player, e: PlayerEcon | undefined) {
  // non-enumerable: Player is serialised field by field (save.ts) and Classic saves must not change
  Object.defineProperty(p, 'econ', { value: e, enumerable: false, writable: true, configurable: true });
}

function newPlayerEcon(): PlayerEcon {
  return { tier: 1, levels: {}, sig: 0 };
}

/** Turn the Commander economy on for a world being built (World constructor, right after initCommander). */
export function initEcon(world: World) {
  const players = world.players.map((p) => {
    const e = newPlayerEcon();
    attach(p, e);
    return e;
  });
  world.econ = { players, busy: false, manned: false, gateSig: 0 };
}

/** Rebuild the derived lists (every 10 ticks, and on load). */
function scan(world: World) {
  const E = world.econ!;
  let busy = false, manned = false;
  for (const b of world.buildings) {
    if (!b.alive) continue;
    if (b.task) busy = true;
    if (b.garrison) manned = true;
  }
  E.busy = busy;
  E.manned = manned;
}

// =====================================================================================================
// Prices, times and why something can't be started
// =====================================================================================================

const isVehicle = (t: TypeDef) => t.kind === 'vehicle';
const isUnitType = (t: TypeDef) => t.kind !== 'building';

/** Price of an upgrade on a structure for a player (doctrine synergy included). */
export function upgradeCost(p: Player, host: BuildingTypeDef, id: string): number {
  const u = UPGRADES[id];
  return u ? Math.round(upgradeBaseCost(u, host) * synergyMul(p, id)) : 0;
}

/** Price of a research level for a player (doctrine synergy included). */
export function researchCost(p: Player, id: string, level: number): number {
  const r = RESEARCH[id];
  return r ? Math.round(r.levels[Math.max(0, Math.min(1, level - 1))].cost * synergyMul(p, id)) : 0;
}

/** Seconds a task of `base` seconds takes for this player right now (power, difficulty, Rapid Deployment II). */
export function taskSeconds(p: Player, base: number): number {
  let s = base;
  if ((p.econ?.levels.rapid_deployment ?? 0) >= 2) s /= 1.25;
  if (p.lowPower) s *= 1 + (1 - p.powerRatio) * 2;
  return Math.max(1, s / p.buildSpeed);
}

export type EconIssue = 'unknown' | 'host' | 'busy' | 'owned' | 'tier' | 'after' | 'prereq' | 'unique' | 'faction' | 'max' | 'researching' | 'lab' | 'inactive';

/** Why `p` can't start upgrade `id` on `b` right now (null = it can). */
export function upgradeIssue(world: World, p: Player, b: Building, id: string): EconIssue | null {
  const e = p.econ;
  if (!e || !Object.prototype.hasOwnProperty.call(UPGRADES, id)) return 'unknown';
  const u = UPGRADES[id];
  if (b.owner !== p || !u.hosts.includes(b.bt.id)) return 'host';
  if (!b.alive || !b.active) return 'inactive';
  if (id === 'cy_t2' && e.tier >= 2) return 'owned';
  if (id === 'cy_t3' && e.tier >= 3) return 'owned';
  if (id === 'def_reinforced' ? (b.hpBoost ?? 1) > 1 : b.upgrades?.includes(id)) return 'owned';
  if (b.task) return 'busy';
  if (e.tier < u.tier) return 'tier';
  if (u.after === 'cy_t2' && e.tier < 2) return 'after';
  if (u.prereq && !u.prereq.every((r) => r.split('|').some((a) => p.has(a)))) return 'prereq';
  if (u.unique && id !== 'cy_t2' && id !== 'cy_t3') {
    for (const o of world.buildings) {
      if (o === b || !o.alive || o.owner !== p) continue;
      if (o.upgrades?.includes(id) || (o.task?.kind === 'upgrade' && o.task.id === id)) return 'unique';
    }
  }
  if (id === 'cy_t2' || id === 'cy_t3') {
    // one tier project at a time (two yards can't both work on it)
    for (const o of world.buildings) if (o !== b && o.alive && o.owner === p && o.task?.kind === 'upgrade' && o.task.id === id) return 'unique';
  }
  return null;
}

/** Why `p` can't start research `id` at lab `b` right now (null = it can). */
export function researchIssue(world: World, p: Player, b: Building, id: string): EconIssue | null {
  const e = p.econ;
  if (!e || !Object.prototype.hasOwnProperty.call(RESEARCH, id)) return 'unknown';
  const r = RESEARCH[id];
  if (!r.factions.includes(p.faction)) return 'faction';
  if (b.owner !== p || b.bt.id !== 'rlab') return 'lab';
  if (!b.alive || !b.active) return 'inactive';
  const level = (e.levels[id] ?? 0) + 1;
  if (level > 2) return 'max';
  if (b.task) return 'busy';
  if (level === 2 && e.tier < LEVEL2_TIER) return 'tier';
  for (const o of world.buildings) if (o.alive && o.owner === p && o.task?.kind === 'research' && o.task.id === id) return 'researching';
  return null;
}

// =====================================================================================================
// Commands
// =====================================================================================================

export type EconCommand = Extract<Command, { c: 'upgrade' | 'research' | 'evacuate' }>;

export function econCommand(world: World, cmd: EconCommand) {
  const p = world.players[cmd.player];
  if (!p?.econ || p.defeated) return;
  const b = world.entities.get(cmd.building);
  if (!(b instanceof Building) || b.owner !== p || !b.alive) return;
  if (cmd.c === 'evacuate') { evacuate(world, b, false); return; }
  const kind = cmd.c === 'upgrade' ? 'upgrade' : 'research';
  const id = cmd.c === 'upgrade' ? cmd.upgrade : cmd.tech;
  if (cmd.cancel) {
    if (b.task && b.task.kind === kind && b.task.id === id) cancelTask(world, b, true);
    return;
  }
  const issue = kind === 'upgrade' ? upgradeIssue(world, p, b, id) : researchIssue(world, p, b, id);
  if (issue) {
    if (issue === 'busy' || issue === 'unique' || issue === 'researching') world.announce(p, 'cancelled', 1);
    return;
  }
  const level = kind === 'research' ? (p.econ.levels[id] ?? 0) + 1 : 1;
  b.task = { kind, id, level, progress: 0, paid: 0, player: p.id };
  world.econ!.busy = true;
  world.announce(p, kind === 'upgrade' ? 'building' : 'training', 0);
  world.events.push({ e: 'econ', stage: 'start', player: p.id, building: b.id, id, level, x: b.x, y: b.y });
}

function cancelTask(world: World, b: Building, announce: boolean) {
  const t = b.task;
  if (!t) return;
  const payer = world.players[t.player] ?? b.owner;
  if (t.paid > 0) payer.refund(t.paid);
  delete b.task;
  if (announce) world.announce(payer, 'cancelled', 0);
  world.events.push({ e: 'econ', stage: 'cancel', player: payer.id, building: b.id, id: t.id, level: t.level, x: b.x, y: b.y });
}

// =====================================================================================================
// Completing work
// =====================================================================================================

function addUpgrade(b: Building, id: string) {
  const list = b.upgrades ?? (b.upgrades = []);
  if (!list.includes(id)) list.push(id);
}

/** Yards show the owner's tier as modules. */
function syncYard(b: Building) {
  const tier = b.owner.econ?.tier ?? 1;
  const want = tier >= 3 ? 2 : tier >= 2 ? 1 : 0;
  const has = (b.upgrades?.includes('cy_t2') ? 1 : 0) + (b.upgrades?.includes('cy_t3') ? 1 : 0);
  if (want === has && (want === 0 || b.upgrades![0] === 'cy_t2')) return;
  const rest = (b.upgrades ?? []).filter((u) => u !== 'cy_t2' && u !== 'cy_t3');
  b.upgrades = [...(want >= 1 ? ['cy_t2'] : []), ...(want >= 2 ? ['cy_t3'] : []), ...rest];
}

function complete(world: World, b: Building, t: EconTask) {
  const p = b.owner;
  const e = p.econ!;
  delete b.task;
  if (t.kind === 'research') {
    e.levels[t.id] = Math.max(e.levels[t.id] ?? 0, t.level);
  } else if (t.id === 'cy_t2' || t.id === 'cy_t3') {
    e.tier = Math.max(e.tier, t.id === 'cy_t3' ? 3 : 2);
    for (const o of world.buildings) if (o.alive && o.owner === p && o.bt.id === 'fact') syncYard(o);
    world.checkNewOptions(p);
  } else if (t.id === 'def_reinforced') {
    const before = b.maxHp;
    b.hpBoost = REINFORCED_HP;
    b.hp = Math.min(b.maxHp, b.hp * (b.maxHp / before));
  } else {
    addUpgrade(b, t.id);
  }
  refreshRules(world, p);
  world.announce(p, 'construction_complete', 0);
  world.events.push({ e: 'econ', stage: 'done', player: p.id, building: b.id, id: t.id, level: t.level, x: b.x, y: b.y });
}

function stepTask(world: World, b: Building) {
  const t = b.task!;
  const p = b.owner;
  // captured mid-task: the old owner gets the money back
  if (t.player !== p.id) { cancelTask(world, b, false); return; }
  if (!b.active) return; // (selling: the sale refunds it)
  if (t.kind === 'research' && (p.econ!.levels[t.id] ?? 0) >= t.level) { cancelTask(world, b, false); return; }
  const cost = t.kind === 'upgrade' ? upgradeCost(p, b.bt, t.id) : researchCost(p, t.id, t.level);
  const base = t.kind === 'upgrade' ? UPGRADES[t.id].time : RESEARCH[t.id].levels[t.level - 1].time;
  const inc = DT / taskSeconds(p, base);
  const step = Math.min(inc, 1 - t.progress);
  const pay = cost * step;
  if (!p.spend(pay)) { world.announce(p, 'insufficient_funds', 10); return; }
  t.progress += step;
  t.paid += pay;
  if (t.progress >= 1 - 1e-6) complete(world, b, t);
}

// =====================================================================================================
// Compiled modifiers (doctrine + research + army-wide upgrades)
// =====================================================================================================

const F_ASSEMBLY = 1, F_ARMOUR = 2, F_LOGISTICS = 4;

const ASSEMBLY_FX: DoctrineEffect[] = [{ stat: 'time', mul: 0.8, types: isVehicle }];
const ARMOUR_FX: DoctrineEffect[] = [{ stat: 'hp', mul: 1.1, types: isVehicle }];
const LOGISTICS_FX: DoctrineEffect[] = [{ stat: 'cost', mul: LOGISTICS_DISCOUNT, types: isUnitType }];

function flagsOf(world: World): number[] {
  const f = world.players.map(() => 0);
  for (const b of world.buildings) {
    if (!b.alive || b.owner.id < 0 || !b.active) continue;
    const u = b.upgrades;
    if (u) {
      if (u.includes('weap_assembly')) f[b.owner.id] |= F_ASSEMBLY;
      if (u.includes('weap_armor')) f[b.owner.id] |= F_ARMOUR;
    }
    if (b.bt.id === 'lgst') f[b.owner.id] |= F_LOGISTICS;
  }
  return f;
}

function signature(e: PlayerEcon, flags: number): number {
  let s = 0;
  for (let i = RESEARCH_IDS.length - 1; i >= 0; i--) s = s * 3 + Math.min(2, e.levels[RESEARCH_IDS[i]] ?? 0);
  return s * 8 + flags;
}

/** Rebuild a player's modifier tables when what feeds them changed (research, army-wide upgrades, logistics). */
function compileRules(p: Player, f: number) {
  const e = p.econ!, c = p.cmd!;
  const r = blankRules(c.doctrine ?? '');
  if (c.doctrine && DOCTRINES[c.doctrine]) applyEffects(r, DOCTRINES[c.doctrine].effects);
  for (const id of RESEARCH_IDS) {
    const lv = e.levels[id] ?? 0;
    for (let k = 0; k < lv && k < 2; k++) applyEffects(r, RESEARCH[id].levels[k].effects);
  }
  if (f & F_ASSEMBLY) applyEffects(r, ASSEMBLY_FX);
  if (f & F_ARMOUR) applyEffects(r, ARMOUR_FX);
  if (f & F_LOGISTICS) applyEffects(r, LOGISTICS_FX);
  return r;
}

function refreshRules(world: World, p: Player, flags?: number) {
  const e = p.econ, c = p.cmd;
  if (!e || !c) return;
  const f = flags ?? flagsOf(world)[p.id];
  const sig = signature(e, f);
  if (sig === e.sig) return;
  e.sig = sig;
  const r = compileRules(p, f);
  // keep everybody's health fraction across the change, then hand out the new weapon variants
  const mine: Entity[] = [];
  const old: number[] = [];
  for (const x of world.entities.values()) if (x.owner === p && x.alive) { mine.push(x); old.push(x.maxHp); }
  c.rules = r;
  // (shots in flight switch too, so a save taken now restores them exactly: see loadEcon)
  for (const pr of world.projectiles) {
    if (pr.owner !== p) continue;
    const v = r.weapons[pr.weapon.id];
    if (v) pr.weapon = v;
  }
  for (let i = 0; i < mine.length; i++) {
    const x = mine[i];
    const m = x.maxHp;
    if (m !== old[i] && x.hp > 0) x.hp = Math.max(1, Math.min(m, x.hp * (m / old[i])));
    applyDoctrineToEntity(x);
  }
}

// =====================================================================================================
// Per tick
// =====================================================================================================

/** World.step hook (after commander powers, before structures and units update). */
export function econTick(world: World) {
  const t = world.tick;
  const E = world.econ!;
  if (E.busy) for (const b of world.buildings) if (b.task && b.alive) stepTask(world, b);
  if (t % 5 === 0) {
    const flags = flagsOf(world);
    for (const p of world.players) if (!p.defeated) refreshRules(world, p, flags[p.id]);
  }
  updateGates(world);
  if (t % 10 === 0) {
    scan(world);
    chronoMiners(world);
    for (const b of world.buildings) {
      if (!b.alive) continue;
      if (b.bt.id === 'fact') syncYard(b);
      if (b.garrison?.length) checkGarrison(world, b);
    }
  }
  if (t % TICK_HZ === 0) perSecond(world);
}

/** Once a second: field medicine, logistics repairs, uplink and chrono recharges. */
function perSecond(world: World) {
  const quiet = MEDIC_QUIET * TICK_HZ;
  for (const u of world.units) {
    if (!u.alive || u.hp >= u.maxHp || u.owner.id < 0) continue;
    const lv = u.owner.econ?.levels.field_medicine ?? 0;
    if (!lv || world.tick - u.lastDamagedTick < quiet) continue;
    const rate = u.kind === 'infantry' ? MEDIC_INFANTRY : u.kind === 'vehicle' && lv >= 2 ? MEDIC_VEHICLE : 0;
    if (rate) u.hp = Math.min(u.maxHp, u.hp + u.maxHp * rate);
  }
  for (const b of world.buildings) {
    if (!b.alive || !b.active || b.bt.id !== 'lgst' || b.owner.id < 0) continue;
    const p = b.owner;
    world.grid.query(b.x, b.y, LOGISTICS_RADIUS + 1.5, (u) => {
      if (!u.alive || u.owner !== p || u.kind !== 'vehicle' || u.hp >= u.maxHp || b.distTo(u.x, u.y) > LOGISTICS_RADIUS) return;
      u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.02);
    });
    for (const o of world.buildings) {
      if (!o.alive || o.owner !== p || o.hp >= o.maxHp || o.bt.wall || !o.active) continue;
      if (Math.max(Math.abs(o.x - b.x) - (o.w + b.w) / 2, Math.abs(o.y - b.y) - (o.h + b.h) / 2) > LOGISTICS_RADIUS) continue;
      o.hp = Math.min(o.maxHp, o.hp + o.maxHp * 0.005);
    }
  }
  for (const p of world.players) {
    const e = p.econ;
    if (!e || p.defeated || p.lowPower) continue;
    let uplink = false;
    for (const b of world.buildings) if (b.alive && b.owner === p && b.active && b.upgrades?.includes('dome_uplink')) { uplink = true; break; }
    const chrono = (e.levels.chrono_logistics ?? 0) >= 2;
    if (!uplink && !chrono) continue;
    for (const k of SUPER_KINDS) {
      let extra = 0;
      if (uplink && (k === 'gps' || k === 'spyplane' || k === 'paratroopers' || k === 'parabombs')) extra = UPLINK_CHARGE;
      if (chrono && k === 'chrono') extra = CHRONO_RECHARGE;
      if (!extra || !superAvailable(world, p, k)) continue;
      const full = superFull(world, p, k);
      if (p.superCharge[k] < full) p.superCharge[k] = Math.min(full, p.superCharge[k] + extra);
    }
    if (chrono) {
      for (const u of world.units) {
        if (u.alive && u.owner === p && u.ut.chronoShift && u.chronoCooldown > 0.1) u.chronoCooldown = Math.max(0.05, u.chronoCooldown - CHRONO_RECHARGE);
      }
    }
  }
}

/** Chrono Logistics I: full Ore Trucks far from their refinery jump next to it. */
function chronoMiners(world: World) {
  for (const u of world.units) {
    if (!u.alive || !u.ut.harvester) continue;
    if (u.chronoCooldown > 0) { u.chronoCooldown = Math.max(0, u.chronoCooldown - DT * 10); continue; }
    const p = u.owner;
    if ((p.econ?.levels.chrono_logistics ?? 0) < 1 || u.hstate !== 'toRefinery' || u.cargo < harvestCapacity(p)) continue;
    let r = u.dockAt ? world.entities.get(u.dockAt) : undefined;
    if (!(r instanceof Building) || !r.alive || r.owner !== p) {
      r = undefined;
      let best = Infinity;
      for (const b of world.buildings) {
        if (!b.alive || b.owner !== p || !b.bt.dock || !b.active) continue;
        const d = Math.hypot(b.x - u.x, b.y - u.y);
        if (d < best) { best = d; r = b; }
      }
    }
    if (!(r instanceof Building)) continue;
    const [dx, dy] = r.dockCell()!;
    if (Math.hypot(dx + 0.5 - u.x, dy + 0.5 - u.y) < CHRONO_MINER_RANGE) continue;
    const [x, y] = world.findFreeSpot(dx + 0.5, dy + 2.5, 4);
    if (!world.map.passable(Math.floor(x), Math.floor(y))) continue;
    const fx = u.x, fy = u.y;
    u.x = u.prevX = x;
    u.y = u.prevY = y;
    u.path = null;
    u.hasGoal = false;
    u.pathPending = false;
    u.chronoCooldown = CHRONO_MINER_COOLDOWN;
    world.events.push({ e: 'teleport', id: u.id, fromX: fx, fromY: fy, x, y });
    world.sfx('chrono', x, y);
  }
}

// =====================================================================================================
// Bunkers
// =====================================================================================================

/** Infantry that may garrison a bunker: armed foot soldiers (no dogs, medics, engineers or agents). */
export function canGarrison(u: Unit, b: Building): boolean {
  return u.kind === 'infantry' && u.owner === b.owner && !!b.bt.garrison && u.weapons.length > 0 && !u.ut.dog && !u.ut.medic && !u.ut.engineer && !u.ut.spy && !u.ut.thief
    && b.active && (b.garrison?.length ?? 0) < b.bt.garrison;
}

/** unitlogic 'enter' hook: an infantryman reached its own bunker. True if it went in. */
export function garrisonEnter(world: World, u: Unit, b: Building): boolean {
  if (!canGarrison(u, b)) return false;
  (b.garrison ??= []).push(u.id);
  world.econ!.manned = true;
  u.transport = b.id;
  world.setOrder(u, { type: 'idle' });
  u.orderQueue.length = 0;
  u.target = null;
  world.listsChanged();
  world.events.push({ e: 'death', id: u.id, x: u.x, y: u.y, how: 'sold' }); // (the renderer drops the model, as for a transport)
  world.events.push({ e: 'econ', stage: 'garrison', player: u.owner.id, building: b.id, id: u.ut.id, level: b.garrison.length, x: b.x, y: b.y });
  world.sfx('door', b.x, b.y);
  return true;
}

/** Everybody out (evacuate order, sale, destruction, capture). `hurt` = the bunker was destroyed around them. */
function evacuate(world: World, b: Building, hurt: boolean, only?: (u: Unit) => boolean) {
  const g = b.garrison;
  if (!g?.length) return;
  const keep: number[] = [];
  for (const id of g) {
    const u = world.entities.get(id);
    if (!(u instanceof Unit) || !u.alive) continue;
    if (only && !only(u)) { keep.push(id); continue; }
    const [x, y] = world.findFreeSpot(b.x, b.cy + b.h + 0.4, 4, false);
    u.x = u.prevX = x;
    u.y = u.prevY = y;
    u.transport = 0;
    u.guardX = x;
    u.guardY = y;
    u.target = null;
    u.heading = u.prevHeading = Math.PI / 2;
    if (hurt) u.hp = Math.max(1, u.hp - u.maxHp * 0.3);
    world.rejoin(u);
  }
  if (keep.length) b.garrison = keep;
  else delete b.garrison;
  world.sfx('door', b.x, b.y);
  world.events.push({ e: 'econ', stage: 'evacuate', player: b.owner.id, building: b.id, id: b.bt.id, level: keep.length, x: b.x, y: b.y });
}

/** Garrisons of another owner (an engineer captured the bunker) come out; dead ids are dropped. */
function checkGarrison(world: World, b: Building) {
  const g = b.garrison!;
  if (g.some((id) => { const u = world.entities.get(id); return !(u instanceof Unit) || !u.alive; })) {
    b.garrison = g.filter((id) => { const u = world.entities.get(id); return u instanceof Unit && u.alive; });
  }
  if (b.garrison!.some((id) => world.entities.get(id)!.owner !== b.owner)) evacuate(world, b, false, (u) => u.owner !== b.owner);
  if (b.garrison && !b.garrison.length) delete b.garrison;
}

/** Combat-phase hook (World.step, deaths deferred): garrisoned infantry fire from the bunker's edge nearest the target. */
export function econCombat(world: World) {
  if (!world.econ!.manned) return;
  for (const b of world.buildings) {
    const g = b.garrison;
    if (!g?.length || !b.alive || !b.active) continue;
    for (const id of g) {
      const u = world.entities.get(id);
      if (!(u instanceof Unit) || !u.alive || u.owner !== b.owner) continue;
      u.moving = false;
      const reach = maxRange(u) + Math.max(b.w, b.h) / 2;
      let t = u.target;
      if (t && (!t.alive || !u.owner.isEnemy(t.owner) || !world.canSee(u.owner, t) || Math.hypot(t.x - b.x, t.y - b.y) > reach + 0.5)) t = u.target = null;
      if (!t && u.stance !== 'passive' && (world.tick + u.id) % 5 === 0) {
        u.x = b.x; u.y = b.y;
        t = u.target = findTarget(world, u, reach, reach);
      }
      // stand at the firing slit facing the target (or the bunker's centre when idle)
      let slit = -1;
      if (t) slit = aimSlit(b, u, t);
      else { u.x = b.x; u.y = b.y; }
      u.prevX = u.x; u.prevY = u.y;
      const ev0 = world.events.length;
      updateUnitWeapons(world, u);
      // (the shots leave through that slit: the renderer flashes the bunker's muzzle m<slit>, falling back to m0)
      if (slit >= 0) for (let k = ev0; k < world.events.length; k++) {
        const ev = world.events[k];
        if (ev.e === 'fire' && ev.shooter === u.id) { ev.muzzle = slit; ev.via = b.id; }
      }
    }
  }
}

/**
 * Firing slits of a bunker, as the models have them (render/models/commander-structures.ts muzzles m0..m7): two
 * per side, south (+y) first, then east, north and west; [side normal x, y, offset along the side as a fraction of
 * the footprint]. A slit's firing point is on the footprint's edge in front of it.
 */
const SLITS: readonly [number, number, number][] = [
  [0, 1, -0.132], [0, 1, 0.132], [1, 0, 0.119], [1, 0, -0.119], [0, -1, 0.132], [0, -1, -0.132], [-1, 0, -0.119], [-1, 0, 0.119],
];

/**
 * Put a garrisoned shooter at the slit facing its target and return the slit index: the slit whose firing point is
 * nearest the target, when the target is in weapon range from there; otherwise the point of the wall nearest the
 * target (a bunker reaches as far as before) and the slit on that side nearest to it.
 */
function aimSlit(b: Building, u: Unit, t: Entity): number {
  const hw = b.w / 2, hh = b.h / 2;
  let best = 0, bestD = Infinity, bx = b.x, by = b.y;
  for (let i = 0; i < SLITS.length; i++) {
    const [nx, ny, f] = SLITS[i];
    const x = b.x + (nx ? nx * hw : f * b.w), y = b.y + (ny ? ny * hh : f * b.h);
    const d = distToEntity(x, y, t);
    if (d < bestD) { bestD = d; best = i; bx = x; by = y; }
  }
  const slot = pickWeapon(u, t);
  if (slot && bestD <= slot.def.range) { u.x = bx; u.y = by; return best; }
  const [px, py] = b.closestPoint(t.x, t.y);
  u.x = px; u.y = py;
  // (the side the wall point is on, then the nearer of its two slits)
  const dx = px - b.x, dy = py - b.y;
  const side = Math.abs(dx) * b.h > Math.abs(dy) * b.w ? (dx > 0 ? 1 : 3) : dy > 0 ? 0 : 2;
  const [nx, , f] = SLITS[side * 2];
  const along = nx ? (py - b.y) / b.h : (px - b.x) / b.w;
  return side * 2 + (Math.abs(along - f) <= Math.abs(along + f) ? 0 : 1);
}

// =====================================================================================================
// Fortress gates
// =====================================================================================================

/**
 * Open for the owner's team (a unit close by or in the gateway, no enemy pressing), shut otherwise. The pathfinder's
 * gate map follows the standing gates the same tick they change (before anybody searches a path this tick), so a
 * restored game routes exactly like the original.
 */
function updateGates(world: World) {
  const m = world.map;
  let sig = 0;
  for (const b of world.buildings) {
    if (!b.bt.gate || !b.alive || b.buildAnim < 1) continue;
    sig = (Math.imul(sig, 31) + b.id * 4 + b.owner.team + 1) | 0;
    const team = b.owner.team;
    let friend = false, foe = false, inside = false;
    world.grid.query(b.x, b.y, 2.2, (u) => {
      if (!u.alive || u.isAir || u.kind === 'naval') return;
      const d = Math.hypot(u.x - b.x, u.y - b.y);
      if (Math.floor(u.x) === b.cx && Math.floor(u.y) === b.cy) inside = true;
      if (u.owner.team === team) { if (d < 1.9) friend = true; }
      else if (u.owner.isEnemy(b.owner) && d < 1.5) foe = true;
    });
    const open = inside || (friend && !foe && b.selling < 0);
    m.passableOverride[m.idx(b.cx, b.cy)] = open ? 1 : 0;
    if (open) b.doorHold = 0.25; // (World.updateBuilding animates b.door from it)
  }
  if (sig !== world.econ!.gateSig) { world.econ!.gateSig = sig; syncGateMap(world); }
}

/** The pathfinder routes each team through its own gates, closed or not. */
function syncGateMap(world: World) {
  const g = world.pathfinder.gates;
  g.clear();
  for (const b of world.buildings) if (b.bt.gate && b.alive && b.buildAnim >= 1) g.set(world.map.idx(b.cx, b.cy), b.owner.team);
}

// =====================================================================================================
// Hooks for the shared simulation
// =====================================================================================================

/** World.kill hook (structures): garrison out, work in progress refunded. */
export function econKilled(world: World, b: Building, how: DeathHow) {
  if (b.garrison?.length) evacuate(world, b, how !== 'sold');
  if (b.task) cancelTask(world, b, false);
  if (b.bt.gate) world.map.passableOverride[world.map.idx(b.cx, b.cy)] = 0;
}

/** Production hook: infantry from a barracks with a Training Ground arrive as Veterans. */
export function econTrained(world: World, f: Building, u: Unit) {
  if (u.kind !== 'infantry' || !f.upgrades?.includes('barr_training') || u.rank >= 1) return;
  u.rank = 1;
  u.xp = Math.max(u.xp, Math.max(300, u.ut.cost));
  world.events.push({ e: 'promoted', id: u.id, rank: 1 });
}

/** Extra sight of a structure (Satellite Uplink). */
export function econSight(b: Building): number {
  return b.upgrades?.includes('dome_uplink') ? UPLINK_SIGHT : 0;
}

/**
 * Mining outposts may stand away from the base: next to an ore field (within 4 cells), on ground the player can
 * see right now, and not within 8 cells of an enemy structure.
 */
export function outpostSiteOk(world: World, p: Player, bt: BuildingTypeDef, cx: number, cy: number): boolean {
  const m = world.map;
  for (let dy = 0; dy < bt.size[1]; dy++) for (let dx = 0; dx < bt.size[0]; dx++) {
    const x = cx + dx, y = cy + dy;
    if (!m.inBounds(x, y) || (world.fog && !p.visible[m.idx(x, y)])) return false;
  }
  let ore = false;
  for (let y = cy - 4; y < cy + bt.size[1] + 4 && !ore; y++) for (let x = cx - 4; x < cx + bt.size[0] + 4; x++) {
    if (m.inBounds(x, y) && m.oreField[m.idx(x, y)] && m.ore[m.idx(x, y)] > 0) { ore = true; break; }
  }
  if (!ore) return false;
  const mx = cx + bt.size[0] / 2, my = cy + bt.size[1] / 2;
  for (const b of world.buildings) {
    if (!b.alive || !p.isEnemy(b.owner) || b.bt.wall || b.bt.mine) continue;
    if (b.distTo(mx, my) < 8) return false;
  }
  return true;
}

/** Player tier (1 under Classic rules, for UI helpers). */
export function tierOfPlayer(p: Player): number {
  return p.econ?.tier ?? 1;
}

/** Highest tier any player can still reach. */
export { MAX_TIER };

// =====================================================================================================
// Save / load
// =====================================================================================================

export function saveEcon(s: EconState, world: World) {
  return {
    v: 1, players: s.players.map((e) => ({ tier: e.tier, levels: { ...e.levels } })),
    // the pathfinder's gate map exactly as the last gate pass left it
    gateSig: s.gateSig, gates: [...world.pathfinder.gates.entries()],
  };
}

/** Restore (or clear) the economy after the entities were restored (save.ts, after loadCommander). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function loadEcon(world: World, s: any) {
  if (!s || !Array.isArray(s.players)) {
    world.econ = null;
    for (const p of world.players) if (p.econ) attach(p, undefined);
    world.pathfinder.gates.clear();
    return;
  }
  const players = world.players.map((p, i) => {
    const ps = s.players[i] ?? {};
    const e = newPlayerEcon();
    e.tier = Math.max(1, Math.min(MAX_TIER, Math.floor(+ps.tier) || 1));
    // in the saved order (the order research finished in: the state hash walks the levels in that order)
    const saved = ps.levels && typeof ps.levels === 'object' ? Object.keys(ps.levels).filter((id) => RESEARCH_IDS.includes(id)) : [];
    for (const id of [...saved, ...RESEARCH_IDS]) {
      if (e.levels[id] !== undefined) continue;
      const lv = Math.floor(+(ps.levels?.[id] ?? 0)) || 0;
      if (lv > 0) e.levels[id] = Math.min(2, lv);
    }
    attach(p, e);
    return e;
  });
  world.econ = { players, busy: false, manned: false, gateSig: typeof s.gateSig === 'number' ? s.gateSig : -1 };
  scan(world);
  // rebuild the compiled modifiers exactly as they were (the entities' health was saved as it was: no rescaling)
  const flags = flagsOf(world);
  for (const p of world.players) {
    const e = p.econ!, c = p.cmd;
    if (!c) continue;
    const sig = signature(e, flags[p.id]);
    if (sig === 0) continue;
    c.rules = compileRules(p, flags[p.id]);
    e.sig = sig;
  }
  for (const x of world.entities.values()) if (x.owner.cmd) applyDoctrineToEntity(x);
  // projectiles in flight carry the owner's weapon variants
  for (const pr of world.projectiles) {
    const v = pr.owner.cmd?.rules?.weapons[pr.weapon.id];
    if (v) pr.weapon = v;
  }
  const g = world.pathfinder.gates;
  g.clear();
  if (Array.isArray(s.gates)) {
    for (const e of s.gates) if (Array.isArray(e) && Number.isInteger(e[0]) && Number.isInteger(e[1])) g.set(e[0], e[1]);
  } else syncGateMap(world);
}

/** Commander structure types (UI lists). */
export const ECON_STRUCTURES = Object.values(BUILDINGS).filter((b) => b.commander).map((b) => b.id);
