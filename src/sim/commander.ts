/**
 * [DOCTRINE] Commander rules, part 2: command points and commander powers.
 *
 * Under Commander rules (skirmish default; World option `rules: 'commander'`) every player
 *  - fights with a doctrine (doctrine.ts; the AI picks its own from its personality and the seed),
 *  - earns command points (CP): a few to start with, a steady trickle, CP for every enemy unit / structure
 *    destroyed (by value), a smaller share for its own losses, and objective grants (`grantCommandPoints`, used by
 *    battlefield events). A comeback rule scales all earnings by how far behind or ahead the player is,
 *  - spends them on a three-tier power tree (`POWERS`): a power is unlocked once (`unlockPower` command, CP cost by
 *    tier; tiers open with the commander level, which follows the CP earned) and then used on a cooldown
 *    (`commanderPower` command).
 *
 * Deterministic: everything is driven by commands and the world tick; randomness comes from world.rng (only
 * consumed under Commander rules). The whole state is in `World.commander` and saved by save.ts
 * (`saveCommander` / `loadCommander`); Classic worlds have `commander === null` and never reach this module.
 */
import { UNITS, type Faction, type WeaponDef } from '../data/rules';
import { Rng } from '../core/rng';
import { Building, Unit, type Entity } from './entities';
import type { Player } from './player';
import { TICK_HZ, type Command } from './types';
import type { World, DeathHow } from './world';
import { impact } from './combat';
import { recalcPlayerEconomy } from './production';
import type { Personality } from './ai-personality';
import { DOCTRINES, applyDoctrineToEntity, compileDoctrine, doctrinesFor, validDoctrine, weaponFor, type PlayerCmd } from './doctrine';

// =====================================================================================================
// Tuning
// =====================================================================================================

/** CP every player starts with: enough for a first tier-1 power right away. */
export const START_POINTS = 2;
/** Passive trickle: one CP every this many seconds. */
export const TRICKLE_SECONDS = 90;
/** Enemy value (credits) destroyed per CP. */
export const KILL_VALUE = 2500;
/** Own value lost per CP (the comeback share). */
export const LOSS_VALUE = 6000;
/** CP price of a power by tier (index 1..3). */
export const TIER_COST = [0, 2, 4, 6];
/** CP earned to reach commander level n + 1 (level 1 at 0). */
export const LEVELS = [0, 4, 9, 15, 22, 30, 40, 52, 66, 82, 100];
/** Commander level that opens each tier. */
export const TIER_LEVEL = [0, 1, 3, 5];
/** Comeback rule: earnings x clamp(sqrt(enemy material / own material)). */
export const CATCHUP_MIN = 0.75;
export const CATCHUP_MAX = 1.75;
/** Comeback rule on recharge times (x1 / catch-up, clamped) and on Emergency Funds (x catch-up, clamped). */
export const COMEBACK_CD_MIN = 0.85;
export const COMEBACK_CD_MAX = 1.15;
export const COMEBACK_FUNDS_MIN = 0.85;
export const COMEBACK_FUNDS_MAX = 1.25;

// =====================================================================================================
// Powers
// =====================================================================================================

export type PowerId = 'recon' | 'repair' | 'funds' | 'rally' | 'elite' | 'barrage' | 'reinforce' | 'sabotage' | 'aegis' | 'storm';

export interface PowerDef {
  id: PowerId;
  name: string;
  tier: 1 | 2 | 3;
  factions: Faction[];
  /** Icon key (ui/commander.ts). */
  icon: string;
  desc: string;
  /** How it is aimed: a map point, an enemy structure, or not at all. */
  target: 'point' | 'structure' | 'none';
  /** Area radius in cells (reticle), 0 = none. */
  radius: number;
  /** Reticle colour. */
  color: number;
  /** Seconds between uses. */
  cooldown: number;
  /** Hurts the enemy (the AI holds it during a ceasefire; the target area is announced to the enemy). */
  offensive: boolean;
}

const BOTH: Faction[] = ['allies', 'soviet'];

export const POWERS: Record<PowerId, PowerDef> = {
  recon: { id: 'recon', name: 'Recon Sweep', tier: 1, factions: BOTH, icon: 'recon', target: 'point', radius: 9, color: 0x7dffb0, cooldown: 60, offensive: false,
    desc: 'Reveals the target area for 25 s.' },
  repair: { id: 'repair', name: 'Field Repair', tier: 1, factions: BOTH, icon: 'repair', target: 'point', radius: 4.5, color: 0x5cff8a, cooldown: 90, offensive: false,
    desc: 'Repairs 45% of the health of your units in the area, and 20% of your structures.' },
  funds: { id: 'funds', name: 'Emergency Funds', tier: 1, factions: BOTH, icon: 'funds', target: 'none', radius: 0, color: 0xffd34d, cooldown: 210, offensive: false,
    desc: 'An immediate $1,000 from High Command (more when you are behind, less when far ahead).' },
  rally: { id: 'rally', name: 'Rally Cry', tier: 2, factions: BOTH, icon: 'rally', target: 'point', radius: 5, color: 0xffb040, cooldown: 100, offensive: false,
    desc: 'Your units in the area move 30% faster and fire 33% faster for 20 s.' },
  elite: { id: 'elite', name: 'Elite Training', tier: 2, factions: BOTH, icon: 'elite', target: 'none', radius: 0, color: 0xffe27a, cooldown: 120, offensive: false,
    desc: 'Your next 4 combat units arrive as Veterans.' },
  barrage: { id: 'barrage', name: 'Artillery Barrage', tier: 2, factions: BOTH, icon: 'barrage', target: 'point', radius: 3.5, color: 0xff6a30, cooldown: 100, offensive: true,
    desc: 'After a 3 s warning that the enemy sees too, 14 shells rain on the area.' },
  reinforce: { id: 'reinforce', name: 'Reinforcements', tier: 3, factions: BOTH, icon: 'reinforce', target: 'point', radius: 1.5, color: 0x8fd0ff, cooldown: 210, offensive: false,
    desc: 'A tank column rolls in from the map edge behind your base and heads for the target.' },
  sabotage: { id: 'sabotage', name: 'Sabotage', tier: 3, factions: BOTH, icon: 'sabotage', target: 'structure', radius: 1, color: 0xff3a6a, cooldown: 150, offensive: true,
    desc: 'Cuts the power at an enemy structure for 40 s: a power plant stops generating, a defence goes silent.' },
  aegis: { id: 'aegis', name: 'Aegis Shield', tier: 3, factions: ['allies'], icon: 'aegis', target: 'point', radius: 3.5, color: 0x40c8ff, cooldown: 150, offensive: false,
    desc: 'Your units in the area take half damage for 15 s.' },
  storm: { id: 'storm', name: 'Tesla Storm', tier: 3, factions: ['soviet'], icon: 'storm', target: 'point', radius: 5, color: 0x9ad8ff, cooldown: 180, offensive: true,
    desc: 'After a 2 s warning, 10 lightning strikes hit enemies in the area.' },
};

export const POWER_IDS = Object.keys(POWERS) as PowerId[];

/** A faction's power tree: three tiers, in display order. */
export function powerTree(faction: Faction): PowerDef[][] {
  const tiers: PowerDef[][] = [[], [], []];
  for (const id of POWER_IDS) {
    const d = POWERS[id];
    if (d.factions.includes(faction)) tiers[d.tier - 1].push(d);
  }
  return tiers;
}

// effect numbers
const RECON_R = 9, RECON_S = 25;
const REPAIR_UNIT = 0.45, REPAIR_BUILDING = 0.2;
const FUNDS = 1000;
/** Emergency Funds: $1,000, scaled by the comeback rule ($850 far ahead .. $1,250 far behind). */
export function fundsFor(c: PlayerCmd): number {
  return Math.round((FUNDS * Math.max(COMEBACK_FUNDS_MIN, Math.min(COMEBACK_FUNDS_MAX, c.catchup))) / 50) * 50;
}
const RALLY_S = 20;
export const ELITE_N = 4;
const BARRAGE_WARN = 3, BARRAGE_SHELLS = 14, BARRAGE_EVERY = 6;
const SABOTAGE_S = 40;
const AEGIS_S = 15;
const STORM_WARN = 2, STORM_BOLTS = 10, STORM_EVERY = 16;
const REINFORCEMENTS: Record<Faction, string[]> = { allies: ['2tnk', '2tnk', '1tnk', 'e3', 'e3'], soviet: ['3tnk', '3tnk', 'v2rl', 'e2', 'e2'] };

/** Weapons only commander powers fire (never added to the shared WEAPONS table; save.ts restores them by id). */
export const CMD_WEAPONS: Record<string, WeaponDef> = {
  CmdBarrage: { id: 'CmdBarrage', damage: 180, rof: 1, range: 99, projectile: 'bomb', speed: 100, warhead: 'HE', burst: 1, report: 'artillery', antiAir: false, antiGround: true },
  CmdStorm: { id: 'CmdStorm', damage: 150, rof: 1, range: 99, projectile: 'tesla', speed: 100, warhead: 'Super', burst: 1, report: 'tesla_zap', antiAir: false, antiGround: true },
};

// =====================================================================================================
// State
// =====================================================================================================

/** A barrage / storm in progress: `left` hits still to come, the next one at tick `next`. */
export interface Strike {
  kind: 'barrage' | 'storm';
  player: number;
  x: number;
  y: number;
  r: number;
  next: number;
  left: number;
}

export interface CommanderState {
  players: PlayerCmd[];
  strikes: Strike[];
}

/** Commander level for CP earned (1-based). */
export function commanderLevel(earned: number): number {
  let n = 0;
  for (const t of LEVELS) if (earned >= t) n++;
  return n;
}

/** CP earned needed for the next level (Infinity at the top). */
export function nextLevelAt(earned: number): number {
  for (const t of LEVELS) if (earned < t) return t;
  return Infinity;
}

export function tierOpen(c: PlayerCmd, tier: number): boolean {
  return commanderLevel(c.earned) >= TIER_LEVEL[tier];
}

export function powerCost(id: PowerId): number {
  return TIER_COST[POWERS[id].tier];
}

/**
 * Comeback rule for recharges: a player behind on the field recharges faster (down to x0.85), one far ahead slower
 * (up to x1.15). `catchup` is the earning multiplier (CATCHUP_MIN..CATCHUP_MAX, 1 = even).
 */
export function comebackCooldown(catchup: number): number {
  return Math.max(COMEBACK_CD_MIN, Math.min(COMEBACK_CD_MAX, 1 / catchup));
}

/** Ticks until the power is ready again (0 = ready; only meaningful once unlocked). */
export function powerCooldown(world: World, c: PlayerCmd, id: PowerId): number {
  return Math.max(0, (c.ready[id] ?? 0) - world.tick);
}

/** Why a power can't be unlocked right now (null = it can). */
export function unlockIssue(c: PlayerCmd, faction: Faction, id: string): 'unknown' | 'faction' | 'owned' | 'tier' | 'points' | null {
  if (!Object.prototype.hasOwnProperty.call(POWERS, id)) return 'unknown';
  const d = POWERS[id as PowerId];
  if (!d.factions.includes(faction)) return 'faction';
  if (c.unlocked.includes(id)) return 'owned';
  if (!tierOpen(c, d.tier)) return 'tier';
  if (c.points + 1e-9 < TIER_COST[d.tier]) return 'points';
  return null;
}

function newPlayerCmd(doctrine: string | null): PlayerCmd {
  return {
    doctrine, rules: doctrine ? compileDoctrine(doctrine) : null, points: START_POINTS, earned: 0, unlocked: [], ready: {}, span: {},
    eliteLeft: 0, rally: new Map(), aegis: new Map(), offline: new Map(), catchup: 1, uses: {}, disabled: false,
  };
}

function attach(p: Player, c: PlayerCmd | undefined) {
  // non-enumerable: Player is serialised field by field (save.ts) and Classic saves must not change
  Object.defineProperty(p, 'cmd', { value: c, enumerable: false, writable: true, configurable: true });
}

/** The AI's doctrine: weighted by its personality's traits, drawn from the match seed (never from world.rng). */
export function pickAIDoctrine(faction: Faction, pers: Personality | null, seed: number, playerId: number): string {
  const rng = new Rng((seed ^ Math.imul(playerId + 1, 0x9e3779b1) ^ 0xd0c7) >>> 0);
  const opts = doctrinesFor(faction);
  const w = opts.map((d) => {
    let v = 1;
    for (const [k, a] of Object.entries(d.affinity)) {
      const t = pers ? (pers as unknown as Record<string, number>)[k] : 0.5;
      if (typeof t === 'number') v += a * (t - 0.5) * 3;
    }
    // (favourite units of the personality that the doctrine boosts)
    for (const [u, m] of Object.entries(pers?.prefer ?? {})) if ((d.prefer[u] ?? 1) > 1 && m > 1) v += 0.4 * Math.min(2, m - 1);
    return Math.max(0.15, v);
  });
  let r = rng.next() * w.reduce((s, x) => s + x, 0);
  for (let i = 0; i < opts.length; i++) { r -= w[i]; if (r <= 0) return opts[i].id; }
  return opts[0].id;
}

/**
 * Turn Commander rules on for a world being built (World constructor, before the starting units exist).
 * `doctrines[i]`: a doctrine id for player i, 'none' for no doctrine, null / undefined = no doctrine for a human,
 * the AI's own pick for an AI player.
 */
export function initCommander(world: World, doctrines: (string | null | undefined)[] | undefined, seed: number) {
  const players = world.players.map((p) => {
    const want = doctrines?.[p.id];
    let d = want === 'none' ? null : validDoctrine(want, p.faction);
    const ai = world.ais.find((a) => a.player === p);
    if (!d && ai && want !== 'none') d = pickAIDoctrine(p.faction, ai.personality, seed, p.id);
    const c = newPlayerCmd(d);
    attach(p, c);
    return c;
  });
  world.commander = { players, strikes: [] };
}

// =====================================================================================================
// Earning
// =====================================================================================================

function emitPoints(world: World, p: Player, c: PlayerCmd, before: number, beforeLevel: number) {
  if (Math.floor(c.points + 1e-9) > Math.floor(before + 1e-9)) world.events.push({ e: 'commander', stage: 'points', player: p.id, power: '', x: -1, y: -1, amount: Math.floor(c.points + 1e-9) });
  const lvl = commanderLevel(c.earned);
  if (lvl > beforeLevel) world.events.push({ e: 'commander', stage: 'level', player: p.id, power: '', x: -1, y: -1, amount: lvl });
}

function earn(world: World, p: Player, amount: number, grant = false) {
  const c = p.cmd;
  if (!c || p.defeated || !(amount > 0)) return;
  if (!grant && c.rules) amount *= c.rules.points; // (Shadow Network)
  const before = c.points, lvl = commanderLevel(c.earned);
  c.points += amount;
  c.earned += amount;
  emitPoints(world, p, c, before, lvl);
}

/**
 * Objective reward (battlefield events: a neutral structure captured, a convoy destroyed, ...): `amount` CP straight
 * to the player (not scaled by the comeback rule). No-op under Classic rules. Deterministic: call it from the sim.
 */
export function grantCommandPoints(world: World, player: number, amount: number, _reason = '') {
  if (!world.commander) return;
  const p = world.players[player];
  if (p) earn(world, p, amount, true);
}

/** World.kill hook: CP for the killer (enemy value destroyed) and a comeback share for the victim. */
export function commanderKill(world: World, e: Entity, how: DeathHow, killer?: Entity) {
  if (how === 'sold' || !e.alive) return;
  if (e instanceof Building && (e.bt.wall || e.bt.mine)) return;
  if (e instanceof Unit && (e.ut.supportPlane || e.transport)) return;
  const value = e.type.cost;
  // (only other commanders' losses count: neutral property and convoys reward through grantCommandPoints)
  if (killer && e.owner.cmd && killer.owner !== e.owner && killer.owner.isEnemy(e.owner)) {
    const k = killer.owner;
    earn(world, k, (value / KILL_VALUE) * (k.cmd?.catchup ?? 1));
  }
  const v = e.owner;
  earn(world, v, (value / LOSS_VALUE) * (v.cmd?.catchup ?? 1));
}

/** Units + structures a player has on the field, by value (the comeback rule's yardstick). */
function material(world: World, p: Player): number {
  let s = 0;
  for (const u of world.units) if (u.alive && u.owner === p && !u.ut.supportPlane) s += u.ut.cost * u.healthFrac;
  for (const b of world.buildings) if (b.alive && b.owner === p && !b.bt.wall && !b.bt.mine) s += b.bt.cost * 0.5 * b.healthFrac;
  return s;
}

function updateCatchup(world: World) {
  const C = world.commander!;
  const mat = world.players.map((p) => (p.defeated ? 0 : material(world, p)));
  for (const p of world.players) {
    if (p.defeated) continue;
    let sum = 0, n = 0;
    for (const o of world.players) if (!o.defeated && p.isEnemy(o)) { sum += mat[o.id]; n++; }
    const ratio = n ? Math.max(1500, sum / n) / Math.max(1500, mat[p.id]) : 1;
    C.players[p.id].catchup = Math.max(CATCHUP_MIN, Math.min(CATCHUP_MAX, Math.sqrt(ratio)));
  }
}

// =====================================================================================================
// Spawns, captures (doctrine stats and Elite Training)
// =====================================================================================================

/** World.addUnit / addBuilding hook: doctrine weapons and full (doctrine) health; Elite Training. */
export function commanderSpawn(world: World, e: Entity) {
  const c = e.owner.cmd;
  if (!c) return;
  applyDoctrineToEntity(e);
  if (c.rules?.hp[e.type.id] !== undefined) e.hp = e.maxHp;
  if (c.eliteLeft > 0 && e instanceof Unit && e.weapons.length && !e.ut.harvester && !e.ut.supportPlane && !e.ut.deploysInto && !e.ut.medic) {
    c.eliteLeft--;
    e.rank = 1;
    e.xp = Math.max(e.xp, Math.max(300, e.ut.cost));
    world.events.push({ e: 'promoted', id: e.id, rank: 1 });
  }
}

/** Engineer capture hook (unitlogic.ts): the structure now fights with its new owner's doctrine. */
export function commanderCaptured(world: World, b: Building, from: Player) {
  const frac = b.hp / (b.bt.strength * (from.cmd?.rules?.hp[b.bt.id] ?? 1));
  applyDoctrineToEntity(b);
  b.hp = Math.max(1, Math.min(b.maxHp, b.maxHp * frac));
  from.cmd?.offline.delete(b.id);
}

// =====================================================================================================
// Commands
// =====================================================================================================

export function commanderCommand(world: World, cmd: Extract<Command, { c: 'commanderPower' | 'unlockPower' }>) {
  const p = world.players[cmd.player];
  const c = p?.cmd;
  if (!c || p.defeated) return;
  if (cmd.c === 'unlockPower') { unlockPower(world, p, c, cmd.power); return; }
  usePower(world, p, c, cmd.power, cmd.x, cmd.y, cmd.target);
}

function unlockPower(world: World, p: Player, c: PlayerCmd, id: string) {
  if (unlockIssue(c, p.faction, id)) return;
  const d = POWERS[id as PowerId];
  c.points -= TIER_COST[d.tier];
  c.unlocked.push(d.id);
  c.ready[d.id] = world.tick;
  world.events.push({ e: 'commander', stage: 'unlock', player: p.id, power: d.id, x: -1, y: -1 });
}

/** Whether `p` may use power `id` now (unlocked, ready, not switched off). */
export function powerReady(world: World, c: PlayerCmd, id: string): boolean {
  return !c.disabled && c.unlocked.includes(id) && world.tick >= (c.ready[id] ?? Infinity);
}

/** The enemy structure a Sabotage at (x, y) / on `target` hits, or null. */
export function sabotageTarget(world: World, p: Player, x?: number, y?: number, target?: number): Building | null {
  let b: Building | null = null;
  const t = target ? world.entities.get(target) : undefined;
  if (t instanceof Building) b = t;
  else if (x !== undefined && y !== undefined) {
    let best = 2.5;
    for (const o of world.buildings) {
      if (!o.alive || !p.isEnemy(o.owner)) continue;
      const d = o.distTo(x, y);
      if (d < best) { best = d; b = o; }
    }
  }
  if (!b || !b.alive || !b.active || !p.isEnemy(b.owner) || !b.owner.cmd || b.bt.wall || b.bt.mine) return null; // (neutral structures: no)
  // it has to be known: seen now, or its ground explored (a fog-of-war ghost)
  const m = world.map;
  const cx = Math.min(m.w - 1, Math.max(0, Math.floor(b.x))), cy = Math.min(m.h - 1, Math.max(0, Math.floor(b.y)));
  if (!world.canSee(p, b) && !p.explored[cy * m.w + cx]) return null;
  return b;
}

function usePower(world: World, p: Player, c: PlayerCmd, id: string, x?: number, y?: number, target?: number) {
  if (!Object.prototype.hasOwnProperty.call(POWERS, id) || !powerReady(world, c, id)) return;
  const d = POWERS[id as PowerId];
  const m = world.map;
  const onMap = typeof x === 'number' && typeof y === 'number' && x >= 0 && y >= 0 && x < m.w && y < m.h;
  if (d.target === 'point' && !onMap) { world.announce(p, 'select_target', 0); return; }
  const t = world.tick;
  let ex = x ?? -1, ey = y ?? -1;
  switch (d.id) {
    case 'recon':
      p.reveals.push({ x: x!, y: y!, r: RECON_R, t: RECON_S });
      world.sfx('sonar_ping', x!, y!);
      break;
    case 'repair': {
      for (const u of world.units) {
        if (!u.alive || u.owner !== p || u.hp >= u.maxHp || Math.hypot(u.x - x!, u.y - y!) > d.radius) continue;
        u.hp = Math.min(u.maxHp, u.hp + u.maxHp * REPAIR_UNIT);
      }
      for (const b of world.buildings) {
        if (!b.alive || b.owner !== p || b.hp >= b.maxHp || b.distTo(x!, y!) > d.radius) continue;
        b.hp = Math.min(b.maxHp, b.hp + b.maxHp * REPAIR_BUILDING);
      }
      world.sfx('repair', x!, y!);
      break;
    }
    case 'funds': {
      const amount = fundsFor(c);
      p.cash += amount;
      const at = baseOf(world, p);
      ex = at[0]; ey = at[1];
      world.events.push({ e: 'credits', player: p.id, amount, x: ex, y: ey });
      world.sfx('cash_tick', ex, ey);
      break;
    }
    case 'rally':
      for (const u of world.units) if (u.alive && u.owner === p && u.weapons.length && Math.hypot(u.x - x!, u.y - y!) <= d.radius) c.rally.set(u.id, t + RALLY_S * TICK_HZ);
      world.sfx('promote', x!, y!);
      break;
    case 'elite':
      c.eliteLeft += ELITE_N;
      ex = ey = -1;
      break;
    case 'barrage':
      world.commander!.strikes.push({ kind: 'barrage', player: p.id, x: x!, y: y!, r: d.radius, next: t + BARRAGE_WARN * TICK_HZ, left: BARRAGE_SHELLS });
      warn(world, p, d.id, x!, y!, d.radius);
      break;
    case 'storm':
      world.commander!.strikes.push({ kind: 'storm', player: p.id, x: x!, y: y!, r: d.radius, next: t + STORM_WARN * TICK_HZ, left: STORM_BOLTS });
      warn(world, p, d.id, x!, y!, d.radius);
      break;
    case 'aegis':
      for (const u of world.units) if (u.alive && u.owner === p && Math.hypot(u.x - x!, u.y - y!) <= d.radius) c.aegis.set(u.id, t + AEGIS_S * TICK_HZ);
      world.sfx('iron_curtain', x!, y!);
      break;
    case 'sabotage': {
      const b = sabotageTarget(world, p, onMap ? x : undefined, onMap ? y : undefined, target);
      const vc = b?.owner.cmd;
      if (!b || !vc) { world.announce(p, 'select_target', 0); return; }
      vc.offline.set(b.id, t + SABOTAGE_S * TICK_HZ);
      b.target = null;
      b.charge = 0;
      recalcPlayerEconomy(world, b.owner);
      world.sfx('power_down', b.x, b.y);
      ex = b.x; ey = b.y;
      break;
    }
    case 'reinforce': {
      if (!reinforce(world, p, x!, y!)) { world.announce(p, 'cannot_deploy', 0); return; }
      world.announce(p, 'reinforcements', 0);
      break;
    }
  }
  // (a captured Communications Array shortens pending recharges further: sim/neutral.ts)
  const span = Math.round(d.cooldown * TICK_HZ * (c.rules?.cooldown[d.id] ?? 1) * comebackCooldown(c.catchup));
  c.ready[d.id] = t + span;
  c.span[d.id] = span;
  c.uses[d.id] = (c.uses[d.id] ?? 0) + 1;
  world.events.push({ e: 'commander', stage: 'cast', player: p.id, power: d.id, x: ex, y: ey, r: d.radius });
}

/** Offensive powers announce their target area to everybody (the UI draws the warning ring and warns the target side). */
function warn(world: World, p: Player, id: PowerId, x: number, y: number, r: number) {
  world.events.push({ e: 'commander', stage: 'warn', player: p.id, power: id, x, y, r });
}

function baseOf(world: World, p: Player): [number, number] {
  let fact: Building | null = null, any: Building | null = null;
  for (const b of world.buildings) {
    if (!b.alive || b.owner !== p) continue;
    if (b.bt.id === 'fact' && !fact) fact = b;
    if (!any && !b.bt.wall && !b.bt.mine) any = b;
  }
  const b = fact ?? any;
  if (b) return [b.x, b.y];
  const u = world.units.find((o) => o.alive && o.owner === p);
  if (u) return [u.x, u.y];
  const s = world.map.startPositions[p.id % world.map.startPositions.length];
  return [s.x, s.y];
}

/**
 * Reinforcements: the column enters at the map edge nearest the caster's base (an edge cell it can drive from to
 * the base), then attack-moves to the target. Falls back to the base itself on maps without such an edge.
 */
function reinforce(world: World, p: Player, x: number, y: number): boolean {
  const m = world.map;
  const [bx, by] = baseOf(world, p);
  const cands: [number, number, number][] = [];
  for (let i = 0; i < m.w; i++) { cands.push([i, 0, 0], [i, m.h - 1, 0]); }
  for (let j = 1; j < m.h - 1; j++) { cands.push([0, j, 0], [m.w - 1, j, 0]); }
  for (const c of cands) c[2] = (c[0] + 0.5 - bx) ** 2 + (c[1] + 0.5 - by) ** 2;
  cands.sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0]);
  let sx = -1, sy = -1, tries = 0;
  for (const [cx, cy] of cands) {
    if (!m.passable(cx, cy)) continue;
    if (++tries > 8) break;
    const path = world.pathfinder.find(cx, cy, Math.floor(bx), Math.floor(by), Math.max(9000, m.w * m.h), 0, 'ground');
    const last = path && path.length ? path[path.length - 1] : null;
    if (last && Math.hypot(last.x - bx, last.y - by) < 4) { sx = cx + 0.5; sy = cy + 0.5; break; }
  }
  if (sx < 0) {
    const s = world.findFreeSpot(bx, by + 3, 6);
    if (!m.passable(Math.floor(s[0]), Math.floor(s[1]))) return false;
    [sx, sy] = s;
  }
  // (comeback: one tank more for a commander who is well behind)
  const c = p.cmd!;
  const extra = c.catchup >= 1.5 ? 1 : 0;
  const list = [...REINFORCEMENTS[p.faction], ...REINFORCEMENTS[p.faction].slice(0, extra)];
  const ids: number[] = [];
  const face = Math.atan2(y - sy, x - sx);
  list.forEach((type, k) => {
    if (!UNITS[type]) return;
    const [fx, fy] = world.findFreeSpot(sx - Math.cos(face) * (k >> 1) * 0.9, sy - Math.sin(face) * (k >> 1) * 0.9, 4, UNITS[type].kind !== 'infantry');
    const u = world.addUnit(type, p, fx, fy);
    u.heading = u.prevHeading = u.turret = u.prevTurret = face;
    ids.push(u.id);
  });
  if (!ids.length) return false;
  p.stats.unitsBuilt += ids.length;
  world.issue({ c: 'move', player: p.id, units: ids, x, y, attackMove: true });
  world.events.push({ e: 'commander', stage: 'arrive', player: p.id, power: 'reinforce', x: sx, y: sy });
  return true;
}

// =====================================================================================================
// Per tick
// =====================================================================================================

function prune(map: Map<number, number>, t: number): boolean {
  let any = false;
  for (const [id, until] of map) if (until <= t) { map.delete(id); any = true; }
  return any;
}

/** World.step hook (after production, before buildings and units update). */
export function commanderTick(world: World) {
  const C = world.commander!;
  const t = world.tick;
  for (const p of world.players) {
    const c = C.players[p.id];
    if (c.rally.size) prune(c.rally, t);
    if (c.aegis.size) prune(c.aegis, t);
    if (c.offline.size && prune(c.offline, t)) recalcPlayerEconomy(world, p);
  }
  if (t % (TICK_HZ * 10) === 0) updateCatchup(world);
  if (t % (TICK_HZ * TRICKLE_SECONDS) === 0) for (const p of world.players) earn(world, p, C.players[p.id].catchup);
  if (C.strikes.length) {
    for (const s of C.strikes) {
      if (s.left <= 0 || t < s.next) continue;
      s.left--;
      s.next = t + (s.kind === 'barrage' ? BARRAGE_EVERY : STORM_EVERY);
      if (s.kind === 'barrage') barrageShell(world, s);
      else stormBolt(world, s);
    }
    if (C.strikes.some((s) => s.left <= 0)) C.strikes = C.strikes.filter((s) => s.left > 0);
  }
}

function barrageShell(world: World, s: Strike) {
  const rng = world.rng, m = world.map;
  const a = rng.range(0, Math.PI * 2), d = Math.sqrt(rng.next()) * s.r;
  const tx = Math.min(m.w - 0.5, Math.max(0.5, s.x + Math.cos(a) * d)), ty = Math.min(m.h - 0.5, Math.max(0.5, s.y + Math.sin(a) * d));
  const sx = tx - 0.6, sy = ty - 0.4;
  const z = m.surfaceAt(sx, sy) + 9;
  world.projectiles.push({
    id: world.nextProjectileId++, weapon: CMD_WEAPONS.CmdBarrage, owner: world.players[s.player], shooter: 0, kind: 'bomb',
    x: sx, y: sy, z, prevX: sx, prevY: sy, prevZ: z, sx, sy, sz: z, tx, ty, tz: m.surfaceAt(tx, ty),
    target: null, t: 0, dur: 0.85, arc: 0, speed: 0, vx: 0, vy: 0, alive: true,
  });
}

function stormBolt(world: World, s: Strike) {
  const p = world.players[s.player];
  const cands: Entity[] = [];
  for (const u of world.units) if (u.alive && !u.isAir && p.isEnemy(u.owner) && Math.hypot(u.x - s.x, u.y - s.y) <= s.r) cands.push(u);
  for (const b of world.buildings) if (b.alive && p.isEnemy(b.owner) && !b.bt.wall && !b.bt.mine && b.distTo(s.x, s.y) <= s.r) cands.push(b);
  let x: number, y: number, hit: Entity | null = null;
  if (cands.length) {
    hit = cands[world.rng.int(0, cands.length - 1)];
    x = hit.x; y = hit.y;
  } else {
    const a = world.rng.range(0, Math.PI * 2), d = Math.sqrt(world.rng.next()) * s.r;
    x = s.x + Math.cos(a) * d; y = s.y + Math.sin(a) * d;
  }
  const z = world.map.surfaceAt(x, y);
  world.events.push({ e: 'commander', stage: 'bolt', player: s.player, power: 'storm', x, y });
  world.sfx('tesla_zap', x, y);
  impact(world, CMD_WEAPONS.CmdStorm, null, hit, x, y, z + 0.3);
}

// =====================================================================================================
// Save / load
// =====================================================================================================

export function saveCommander(C: CommanderState) {
  return {
    v: 1,
    players: C.players.map((c) => ({
      doctrine: c.doctrine, points: c.points, earned: c.earned, unlocked: [...c.unlocked], ready: { ...c.ready }, span: { ...c.span }, eliteLeft: c.eliteLeft,
      rally: [...c.rally], aegis: [...c.aegis], offline: [...c.offline], catchup: c.catchup, uses: { ...c.uses }, disabled: c.disabled,
    })),
    strikes: C.strikes.map((s) => ({ ...s })),
  };
}

/**
 * Restore (or clear) the commander state after deserializeWorld restored the entities and projectiles. The save is
 * authoritative: a Classic save leaves no commander behind, whatever the world was constructed with.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function loadCommander(world: World, s: any, savedProjectiles?: { weapon: string }[]) {
  if (!s || !Array.isArray(s.players)) {
    world.commander = null;
    for (const p of world.players) if (p.cmd) attach(p, undefined);
    return;
  }
  const players = world.players.map((p, i) => {
    const ps = s.players[i] ?? {};
    const c = newPlayerCmd(validDoctrine(ps.doctrine, p.faction));
    c.points = +ps.points || 0;
    c.earned = +ps.earned || 0;
    c.unlocked = Array.isArray(ps.unlocked) ? ps.unlocked.filter((id: string) => Object.prototype.hasOwnProperty.call(POWERS, id)) : [];
    c.ready = { ...(ps.ready ?? {}) };
    c.span = { ...(ps.span ?? {}) };
    c.eliteLeft = +ps.eliteLeft || 0;
    c.rally = new Map(ps.rally ?? []);
    c.aegis = new Map(ps.aegis ?? []);
    c.offline = new Map(ps.offline ?? []);
    c.catchup = typeof ps.catchup === 'number' ? ps.catchup : 1;
    c.uses = { ...(ps.uses ?? {}) };
    c.disabled = !!ps.disabled;
    attach(p, c);
    return c;
  });
  world.commander = { players, strikes: (s.strikes ?? []).map((x: Strike) => ({ ...x })) };
  for (const e of world.entities.values()) applyDoctrineToEntity(e);
  if (savedProjectiles) {
    world.projectiles.forEach((pr, i) => {
      const id = savedProjectiles[i]?.weapon;
      if (!id) return;
      pr.weapon = CMD_WEAPONS[id] ?? weaponFor(pr.owner, id) ?? pr.weapon;
    });
  }
  // (power / storage were saved as they were: recomputing them here would change the restored game)
}

/** Doctrine of a player under Commander rules (null: none / Classic). */
export function doctrineOf(p: Player) {
  const id = p.cmd?.doctrine;
  return id ? DOCTRINES[id] : null;
}

