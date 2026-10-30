/**
 * Aftermath / Counterstrike units (the RA GPL source's FIXIT_CSII code paths: UNIT.CPP, INFANTRY.CPP, HOUSE.CPP,
 * LOGIC.CPP, VESSEL.CPP; numbers from AFTRMATH.INI as best known, see rules.ts). World / unitlogic / combat call
 * in through one-line hooks; every piece of state lives on the Unit (aftermath fields in entities.ts), so saves
 * need nothing extra and the AI part is stateless.
 *
 * - `ttnk` Tesla Tank: TTankZap (Super warhead) and, as UDATA.CPP says (IsJammer), it jams enemy radar like the
 *   Mobile Radar Jammer (`jamRadius`, stealth.ts). Pure data.
 * - `shok` Shock Trooper: PortaTesla infantry. Pure data.
 * - `mech` Mechanic: the medic for armour. Its GoodWrench (Mechanical warhead) mends vehicles and landed aircraft,
 *   never infantry (OBJECT.CPP / INFANTRY.CPP); it reuses the medic behaviour (`medic`) with `healable` deciding
 *   who a heal weapon works on.
 * - `qtnk` M.A.D. Tank (UNIT.CPP Mission_Unload UNIT_MAD + LOGIC.CPP time quake): 'deploy' locks it in place and a
 *   crewman bails out; after QuakeDelay (120 RA ticks = 8 s, held while under the Iron Curtain) the charge
 *   pumps out MAD_PULSES seismic pulses that together take QuakeUnitDamage (50%) of every vehicle's / ship's /
 *   landed aircraft's and QuakeBuildingDamage (25%) of every structure's full strength within MTankDistance
 *   (7 cells), friend or foe, ignoring armour (forced damage); infantry are unhurt (QuakeInfantryDamage 0). The
 *   tank is destroyed by its own quake.
 * - `ctnk` Chrono Tank: APTusk missiles; the 'chronoJump' command shifts it to any explored open cell, then it
 *   recharges for `chronoShift` seconds (RA ChronoTankDuration 3 min, compressed like the support powers).
 *   Unlike a Chronosphere shift it stays there (HOUSE.CPP clears IsMoebius for the chrono tank).
 * - `dtrk` Demolition Truck: an 'attack' order drives it into the target and it detonates (UNIT.CPP fires
 *   Democharge at the target and deletes the truck): a mini-nuke centred on the target. It also goes off where
 *   it is when destroyed on the way or caught by a Chronosphere shift (HOUSE.CPP), and the Iron Curtain holds
 *   only a moment on it. It starts in the hold-fire stance so a parked truck never drives off on its own
 *   ('hold' turns it into a proximity charge, 'aggressive' hunts); 'deploy' detonates it where it stands.
 * - `msub` Missile Submarine: a `cloakable` vessel, so naval.ts submerges it, surfaces it to fire, lets sonar and
 *   sensor ships find it; SubSCUD missiles hit ships and shore targets, never submarines. Pure data.
 * - `stnk` Phase Transport: an APC (5 infantry) that is `cloaked` whenever it has not fired for PHASE_DELAY
 *   seconds (RA CloakDelay = SubmergeDelay); enemies see it only while it is uncloaked, while one of their
 *   units is right next to it (as with mines / the camo pillbox) or within a sensor ship's range.
 */
import { UNITS, WARHEADS, ARMOR_INDEX, WEAPONS, type Faction, type WeaponDef } from '../data/rules';
import { Building, Unit, distToEntity, type Entity } from './entities';
import { damageEntity } from './combat';
import { damageBridgesInRadius } from './bridges';
import { apparentType } from './infiltration';
import { seaInfo } from './ai-naval';
import type { Player } from './player';
import { DT, TICK_HZ } from './types';
import type { DeathHow, World } from './world';
import { ceasefireActive } from './ceasefire';

// ---------------------------------------------------------------------------
// Tuning (RA values where the source / AFTRMATH.INI give them)
// ---------------------------------------------------------------------------

/** RA [Aftermath] MTankDistance: quake reach in cells (centre to centre). */
export const MAD_RADIUS = 7;
/** RA QuakeDelay: 120 ticks at 15 Hz between deploying and the charge going off. */
export const MAD_ARM_SECONDS = 120 / 15;
/** The charge is released as this many pulses (the piston's strokes), one every MAD_PULSE_SECONDS. */
export const MAD_PULSES = 4;
export const MAD_PULSE_SECONDS = 0.6;
/** RA QuakeUnitDamage 0x80 / QuakeBuildingDamage 0x40: fraction of full strength taken over all pulses. */
export const MAD_UNIT_DAMAGE = 0.5;
export const MAD_BUILDING_DAMAGE = 0.25;
/** Deploy-to-last-pulse time (renderer: madCharge runs 0..1 over this). */
export const MAD_TOTAL_SECONDS = MAD_ARM_SECONDS + MAD_PULSES * MAD_PULSE_SECONDS;

/** Demolition truck blast: radius (cells) of the mini-nuke; damage is the Democharge weapon's (Nuke warhead). */
export const DEMO_RADIUS = 3.5;
/** RA gives a demolition truck the Iron Curtain for IronCurtainDuration seconds instead of minutes (25 s -> 0.42 s). */
export const DEMO_IRON_CURTAIN = 25 / 60;

/** Phase transport: seconds after its last shot before it cloaks again (RA CloakDelay = SubmergeDelay, naval.ts). */
export const PHASE_DELAY = 3;
/** Enemy units this close (cells, centre to centre) see a cloaked phase transport. */
export const PHASE_DETECT = 1.5;

// ---------------------------------------------------------------------------
// Mechanic: who a heal weapon works on
// ---------------------------------------------------------------------------

/**
 * Whether heal weapon `w` (negative damage) mends unit `t`: the medic's Organic warhead heals infantry, the
 * mechanic's Mechanical warhead vehicles and aircraft on the ground (RA OBJECT.CPP / INFANTRY.CPP). combat.ts hook.
 */
export function healable(w: WeaponDef, t: Unit): boolean {
  if (w.warhead === 'Mechanical') return t.kind === 'vehicle' || (t.kind === 'aircraft' && !t.isAir);
  return t.kind === 'infantry';
}

// ---------------------------------------------------------------------------
// Per-unit update (World.stepUnit hook)
// ---------------------------------------------------------------------------

/** World.stepUnit hook, before the normal update: true when the unit was fully handled here (deployed M.A.D. Tank). */
export function aftermathStepUnit(world: World, u: Unit): boolean {
  const t = u.ut;
  if (t.quake) return u.madStage > 0 && updateMad(world, u);
  if (t.demolition) return updateDemo(world, u);
  if (t.chronoShift) {
    if (u.chronoCooldown > 0) {
      u.chronoCooldown = Math.max(0, u.chronoCooldown - DT);
      if (u.chronoCooldown === 0) world.announce(u.owner, 'chrono_tank_charged', 10);
    }
    return false;
  }
  if (t.phasing) updatePhase(world, u);
  return false;
}

/** 'deploy' command hook: true when the unit's deploy is an Aftermath action (handled or deliberately ignored). */
export function aftermathDeploy(world: World, u: Unit): boolean {
  const t = u.ut;
  if (t.quake) {
    deployMad(world, u);
    return true;
  }
  if (t.demolition) {
    if (!u.transport) detonate(world, u);
    return true;
  }
  // the chrono tank aims with the 'chronoJump' command (the UI's deploy key starts targeting)
  return !!t.chronoShift;
}

/** World.kill hook (after the unit is marked dead): a demolition truck goes off however it dies, unless removed. */
export function aftermathKilled(world: World, u: Unit, how: DeathHow) {
  if (u.ut.demolition && how !== 'sold') demolitionBlast(world, u, u.x, u.y);
}

/** Chronosphere hook (superweapons.ts): a demolition truck caught by the shift detonates where it stands (HOUSE.CPP). */
export function aftermathChronoshift(world: World, u: Unit): boolean {
  if (!u.ut.demolition) return false;
  detonate(world, u);
  return true;
}

// ---------------------------------------------------------------------------
// M.A.D. Tank
// ---------------------------------------------------------------------------

export function deployMad(world: World, u: Unit) {
  if (u.madStage !== 0 || u.transport || !u.alive) return;
  u.madStage = 1;
  world.announce(u.owner, 'mad_tank_deployed', 4);
  u.madTimer = MAD_ARM_SECONDS;
  u.madPulses = 0;
  u.madCharge = 0;
  u.orderQueue.length = 0;
  world.setOrder(u, { type: 'idle' });
  u.guardX = u.targetX = u.x;
  u.guardY = u.targetY = u.y;
  world.sfx('deploy', u.x, u.y);
  // the crew bails out and steps away (RA: a technician; quakes don't hurt infantry)
  const a = u.heading + Math.PI;
  const [x, y] = world.findFreeSpot(u.x + Math.cos(a) * 1.2, u.y + Math.sin(a) * 1.2, 3, false);
  if (world.map.passable(Math.floor(x), Math.floor(y))) {
    const crew = world.addUnit('e1', u.owner, x, y);
    crew.heading = crew.prevHeading = a;
  }
}

function updateMad(world: World, u: Unit): boolean {
  // locked down where it deployed (targetX / targetY: an unarmed tank has no ground target): no orders, no movement
  if (u.order.type !== 'idle' || u.orderQueue.length) {
    u.orderQueue.length = 0;
    world.setOrder(u, { type: 'idle' });
    u.guardX = u.targetX;
    u.guardY = u.targetY;
  }
  u.path = null;
  u.hasGoal = false;
  u.pathPending = false;
  u.moving = false;
  u.speedFrac = 0;
  u.target = null;
  // dug in (other units bump off it)
  u.x = u.targetX;
  u.y = u.targetY;
  // RA: the charge holds while the Iron Curtain is on
  if (u.invulnerable > 0) {
    u.invulnerable = Math.max(0, u.invulnerable - DT);
    return true;
  }
  u.madTimer -= DT;
  if (u.madStage === 1) {
    if (u.madTimer <= 0) {
      u.madStage = 2;
      u.madTimer += MAD_PULSE_SECONDS;
      world.sfx('tesla_charge', u.x, u.y);
    }
  } else if (u.madTimer <= 0) {
    madPulse(world, u);
    u.madPulses++;
    u.madTimer += MAD_PULSE_SECONDS;
    if (u.madPulses >= MAD_PULSES) {
      u.madCharge = 1;
      world.events.push({ e: 'impact', x: u.x, y: u.y, z: world.map.surfaceAt(u.x, u.y) + 0.3, kind: 'huge', scale: 1, owner: u.owner.id });
      u.hp = 0;
      world.lethal(u, 'blown');
      return true;
    }
  }
  const done = u.madStage === 1 ? MAD_ARM_SECONDS - u.madTimer : MAD_ARM_SECONDS + u.madPulses * MAD_PULSE_SECONDS + (MAD_PULSE_SECONDS - u.madTimer);
  u.madCharge = Math.min(1, Math.max(0, done / MAD_TOTAL_SECONDS));
  return true;
}

/** One seismic pulse (LOGIC.CPP time quake): forced damage to everything but infantry within MAD_RADIUS. */
function madPulse(world: World, u: Unit) {
  const R = MAD_RADIUS, x = u.x, y = u.y;
  world.events.push({ e: 'quake', id: u.id, x, y, radius: R, pulse: u.madPulses + 1, pulses: MAD_PULSES });
  world.sfx('mad_pulse', x, y);
  const fu = MAD_UNIT_DAMAGE / MAD_PULSES, fb = MAD_BUILDING_DAMAGE / MAD_PULSES;
  const victims: [Entity, number][] = [];
  world.grid.query(x, y, R + 0.5, (o) => {
    if (o === u || !o.alive || o.hp <= 0 || o.transport || o.kind === 'infantry' || o.isAir) return;
    if (Math.hypot(o.x - x, o.y - y) < R) victims.push([o, o.maxHp * fu]);
  });
  // (walls are map overlays in RA, not objects the quake shakes)
  for (const b of world.buildings) {
    if (b.alive && !b.bt.wall && Math.hypot(b.x - x, b.y - y) < R) victims.push([b, b.maxHp * fb]);
  }
  for (const [v, dmg] of victims) damageEntity(world, v, dmg, u, 'blown');
}

// ---------------------------------------------------------------------------
// Demolition truck
// ---------------------------------------------------------------------------

/** Where a demolition truck's charge would go off (its target) and whether it is within reach, or null if it has none. */
function demoGoal(world: World, u: Unit, reach: number): { x: number; y: number; inRange: boolean } | null {
  const o = u.order;
  let t: Entity | null | undefined = null;
  if (o.type === 'attack') t = world.entities.get(o.target);
  else if (o.type === 'attackGround') return { x: o.x, y: o.y, inRange: Math.hypot(o.x - u.x, o.y - u.y) <= reach };
  // hold / aggressive / guard stance: an enemy it picked up by itself
  else if ((o.type === 'idle' || o.type === 'guard') && u.target && u.owner.isEnemy(u.target.owner)) t = u.target;
  if (!t || !t.alive) return null;
  return { x: t.x, y: t.y, inRange: distToEntity(u.x, u.y, t) <= reach };
}

function updateDemo(world: World, u: Unit): boolean {
  if (u.invulnerable > DEMO_IRON_CURTAIN) u.invulnerable = DEMO_IRON_CURTAIN;
  const slot = u.weapons[0];
  if (!slot) return false;
  // it never "fires" its charge through combat.ts: it detonates itself once in reach (below)
  slot.cooldown = 1;
  const goal = demoGoal(world, u, slot.def.range);
  const armed = !!goal;
  if (armed && !u.armed) world.sfx('demo_arm', u.x, u.y);
  u.armed = armed;
  if (goal?.inRange) {
    detonateOn(world, u, goal.x, goal.y);
    return true;
  }
  return false;
}

/** Set a demolition truck off where it stands (the blast comes from its death: aftermathKilled). */
export function detonate(world: World, u: Unit) {
  if (!u.alive || u.hp <= 0) return;
  u.hp = 0;
  world.lethal(u, 'blown');
}

/** Drive-in detonation: RA fires Democharge at the target and deletes the truck, so the blast is centred on the target. */
function detonateOn(world: World, u: Unit, x: number, y: number) {
  if (!u.alive || u.hp <= 0) return;
  u.hp = 0;
  u.armed = false;
  demolitionBlast(world, u, x, y);
  world.lethal(u, 'sold'); // (gone into its own blast: no second explosion, no wreck)
}

/** The demolition truck's mini-nuke (like combat.ts nukeImpact, smaller): Nuke warhead, falling off with distance. */
function demolitionBlast(world: World, u: Unit, x: number, y: number) {
  const w = u.weapons[0]?.def ?? WEAPONS.Democharge;
  const wh = WARHEADS[w.warhead];
  const R = DEMO_RADIUS;
  world.events.push({ e: 'impact', x, y, z: world.map.heightAt(x, y), kind: 'nuke', scale: 0.5, owner: u.owner.id });
  // (a plain scan, not the unit grid: a blast can come from a command, before this tick's grid rebuild)
  const victims: Entity[] = [];
  for (const o of world.units) if (o.alive && o !== u && !o.transport && !o.isAir && Math.abs(o.x - x) <= R && Math.abs(o.y - y) <= R) victims.push(o);
  for (const b of world.buildings) if (b.alive && b.distTo(x, y) < R) victims.push(b);
  for (const v of victims) {
    const d = distToEntity(x, y, v);
    if (d > R) continue;
    const fall = 1 - (d / R) * 0.75;
    const dmg = w.damage * wh.verses[ARMOR_INDEX[v.type.armor]] * fall + (v instanceof Building ? 0 : w.damage * 0.2 * fall);
    damageEntity(world, v, dmg, u, 'burn');
  }
  if (world.bridges.length) damageBridgesInRadius(world, x, y, R * 0.6, w.damage);
  const m = world.map;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const cx = Math.floor(x) + dx, cy = Math.floor(y) + dy;
    if (m.inBounds(cx, cy) && dx * dx + dy * dy <= 5) m.removeTree(m.idx(cx, cy));
  }
}

// ---------------------------------------------------------------------------
// Chrono Tank
// ---------------------------------------------------------------------------

/** Where a chrono tank of player p would land for a jump aimed at (x, y), or null if it can't go there. */
export function chronoTarget(world: World, p: Player, x: number, y: number): [number, number] | null {
  const m = world.map;
  const cx = Math.floor(x), cy = Math.floor(y);
  // RA: any cell you can see on the map (no shifting into the shroud), open ground only
  if (!m.inBounds(cx, cy) || !p.explored[m.idx(cx, cy)] || !m.passable(cx, cy)) return null;
  const [sx, sy] = world.findFreeSpot(cx + 0.5, cy + 0.5, 2, true);
  const fx = Math.floor(sx), fy = Math.floor(sy);
  if (!m.passable(fx, fy) || !p.explored[m.idx(fx, fy)]) return null;
  return [sx, sy];
}

/** The 'chronoJump' command. Returns whether the tank shifted. */
export function chronoJump(world: World, p: Player, unitId: number, x: number, y: number): boolean {
  const u = world.entities.get(unitId);
  if (!(u instanceof Unit) || !u.alive || u.owner !== p || !u.ut.chronoShift || u.transport) return false;
  if (u.chronoCooldown > 0) return false;
  const spot = chronoTarget(world, p, x, y);
  if (!spot) {
    world.announce(p, 'cannot_deploy', 1);
    return false;
  }
  const fx = u.x, fy = u.y;
  u.x = u.prevX = spot[0];
  u.y = u.prevY = spot[1];
  u.orderQueue.length = 0;
  world.setOrder(u, { type: 'idle' });
  u.guardX = u.x;
  u.guardY = u.y;
  u.chronoCooldown = u.ut.chronoShift!;
  world.events.push({ e: 'teleport', id: u.id, fromX: fx, fromY: fy, x: u.x, y: u.y });
  world.sfx('chrono', u.x, u.y);
  return true;
}

// ---------------------------------------------------------------------------
// Phase Transport
// ---------------------------------------------------------------------------

function teamMask(world: World, p: Player): number {
  let m = 0;
  for (const o of world.players) if (o.team === p.team) m |= 1 << o.id;
  return m;
}

function updatePhase(world: World, u: Unit) {
  const hidden = world.tick - u.lastFireTick > PHASE_DELAY * TICK_HZ;
  if (hidden !== u.cloaked) {
    u.cloaked = hidden;
    world.sfx('phase_shift', u.x, u.y);
    if (hidden) u.revealedTo = phaseDetect(world, u);
  }
  if (!u.cloaked) u.revealedTo = 0;
  else if ((world.tick + u.id) % 4 === 0) u.revealedTo = phaseDetect(world, u);
}

/** Teams that currently see a cloaked phase transport: an enemy unit right next to it, or a sensor ship in range. */
function phaseDetect(world: World, u: Unit): number {
  let mask = 0;
  world.grid.query(u.x, u.y, 3.5, (o) => {
    if (!o.alive || o.isAir || o.transport || o.parachute > 0 || !o.owner.isEnemy(u.owner)) return;
    if (mask & (1 << o.owner.id)) return;
    const d = Math.hypot(o.x - u.x, o.y - u.y);
    if (d <= PHASE_DETECT || (o.ut.sensors !== undefined && d <= o.ut.sensors)) mask |= teamMask(world, o.owner);
  });
  return mask;
}

// ---------------------------------------------------------------------------
// AI-facing data and AI use (AIController.think hook)
// ---------------------------------------------------------------------------

/** Role tags for AI army composition (the AI may use them for any unit). */
export type AIRole = 'antiArmor' | 'antiInfantry' | 'antiAir' | 'siege' | 'suicide' | 'transport' | 'stealth' | 'naval' | 'support' | 'mobility' | 'jammer';

export interface AftermathAIEntry {
  id: string;
  faction: Faction;
  queue: 'infantry' | 'vehicle' | 'naval';
  roles: AIRole[];
  /** Relative pick weight among the entries of the same faction and queue. */
  weight: number;
  /** At most this many alive (and queued) at once. */
  max: number;
  /** Driven by aftermathAI instead of joining the AI's attack waves (see aiManaged). */
  managed: boolean;
}

// weights tuned from self-play exchange ratios (phase transports and missile subs earn their keep; shock troopers and mechanics less so)
export const AFTERMATH_AI: AftermathAIEntry[] = [
  { id: 'ttnk', faction: 'soviet', queue: 'vehicle', roles: ['antiArmor', 'antiInfantry', 'jammer'], weight: 12, max: 6, managed: false },
  { id: 'qtnk', faction: 'soviet', queue: 'vehicle', roles: ['siege'], weight: 3, max: 1, managed: true },
  { id: 'dtrk', faction: 'soviet', queue: 'vehicle', roles: ['siege', 'suicide'], weight: 3, max: 1, managed: true },
  { id: 'shok', faction: 'soviet', queue: 'infantry', roles: ['antiInfantry', 'antiArmor'], weight: 5, max: 4, managed: false },
  { id: 'msub', faction: 'soviet', queue: 'naval', roles: ['naval', 'siege', 'stealth'], weight: 3, max: 3, managed: true },
  { id: 'ctnk', faction: 'allies', queue: 'vehicle', roles: ['antiArmor', 'mobility'], weight: 10, max: 4, managed: false },
  { id: 'stnk', faction: 'allies', queue: 'vehicle', roles: ['transport', 'stealth', 'antiArmor'], weight: 8, max: 3, managed: false },
  { id: 'mech', faction: 'allies', queue: 'infantry', roles: ['support'], weight: 3, max: 2, managed: true },
];

/** Role tags by unit id. */
export const UNIT_ROLES: Record<string, AIRole[]> = Object.fromEntries(AFTERMATH_AI.map((e) => [e.id, e.roles]));

/** Units aftermathAI drives itself: keep them out of the AI's generic attack waves (ai.ts army()). */
export function aiManaged(u: Unit): boolean {
  return !!(u.ut.quake || u.ut.demolition);
}

/** AI chrono tanks hop onto structures at most this far away. */
const CHRONO_HOP = 14;
/** The AI builds its first siege unit (M.A.D. tank / demolition truck) after this many seconds. */
const SIEGE_AFTER = 780;
/** Aftermath units are late-game tech for the AI: none before this many seconds. */
const AM_AFTER = 600;
/** Of the AI's land production, about this share goes to Aftermath units once they are available. */
const AI_SHARE = 0.25;

/** The parts of AIController used here (members are private to TypeScript only; anything may be missing). */
interface AIView {
  world: World;
  p: Player;
  thinks: number;
  state?: string;
  stage?: string;
  wave?: Set<number>;
  /** Difficulty (ai.ts): the easier levels field no siege specials. */
  d?: { siege?: boolean; noUnits?: readonly string[] };
  baseCenter(): [number, number];
  /** Build-up time: the army is as big as it gets until the ceasefire ends (ai.ts). */
  atBuildupCap?(): boolean;
  /** The level's army cap is reached (ai.ts; recruit, easy and normal). */
  atArmyCap?(): boolean;
}

/** AIController.think hook (full AI behaviour only): build the Aftermath units and use the special ones. */
export function aftermathAI(ai: unknown) {
  const v = ai as AIView;
  const p = v.p;
  if (!p || p.defeated) return;
  const due = (sec: number) => v.thinks % Math.max(1, Math.round((sec * TICK_HZ) / 10)) === 0;
  const w = v.world;
  let mine: Unit[] | null = null;
  const own = () => (mine ??= w.units.filter((u) => u.alive && u.owner === p));
  if (due(5) && !w.mission && w.time > AM_AFTER && !v.atBuildupCap?.() && !v.atArmyCap?.()) production(v, own()); // (difficulty: and not past the level's army cap)
  if (!due(1)) return;
  const units = own();
  // build-up time: siege units, chrono hops and missile subs hold (escape jumps and mechanics carry on)
  const truce = ceasefireActive(w);
  for (const u of units) {
    if (truce && (u.ut.quake || u.ut.demolition)) continue;
    if (u.ut.quake) aiMad(v, u);
    else if (u.ut.demolition) aiDemo(v, u);
    else if (u.ut.chronoShift && due(2)) aiChrono(v, u);
    else if (u.ut.medic && u.ut.primary === 'GoodWrench' && due(3)) aiMechanic(v, u, units);
  }
  if (due(3) && !truce) aiMissileSubs(v, units);
}

function queuedCount(p: Player, type: string): number {
  let n = 0;
  for (const q of Object.values(p.queues)) for (const it of q.items) if (it.type === type) n++;
  return n;
}

function production(v: AIView, units: Unit[]) {
  const w = v.world, p = v.p;
  const have = (id: string) => units.filter((u) => u.ut.id === id).length + queuedCount(p, id);
  for (const queue of ['vehicle', 'infantry', 'naval'] as const) {
    const q = p.queues[queue];
    if (q.items.length > 1) continue;
    const entries = AFTERMATH_AI.filter((e) => e.queue === queue && e.faction === p.faction);
    if (!entries.length) continue;
    let opts = entries.filter((e) => p.canBuild(e.id) && have(e.id) < e.max && aiWants(v, e.id) && !v.d?.noUnits?.includes(e.id)); // (difficulty: types the level never builds)
    if (!opts.length) continue;
    // siege units (M.A.D. tank / demolition truck): one at a time, on top of the army share
    if (v.d?.siege === false) opts = opts.filter((e) => !(e.managed && e.roles.includes('siege')));
    if (!opts.length) continue;
    const siege = opts.filter((e) => e.managed && e.roles.includes('siege') && queue !== 'naval');
    if (siege.length && !entries.some((e) => e.managed && e.roles.includes('siege') && have(e.id) > 0)) opts = siege;
    else if (queue !== 'naval') {
      opts = opts.filter((e) => !siege.includes(e));
      // keep the other Aftermath units to about AI_SHARE of the army of that kind
      const kind = queue === 'infantry' ? 'infantry' : 'vehicle';
      const ids = new Set(entries.map((e) => e.id));
      let all = 0, am = 0;
      for (const u of units) {
        if (u.kind !== kind || u.ut.harvester || u.ut.deploysInto) continue;
        all++;
        if (ids.has(u.ut.id)) am++;
      }
      for (const it of q.items) if (ids.has(it.type)) am++;
      if (!opts.length || am >= 1 + all * AI_SHARE) continue;
    }
    const total = opts.reduce((s, e) => s + e.weight, 0);
    let r = w.rng.next() * total;
    let pick = opts[0];
    for (const e of opts) { r -= e.weight; if (r <= 0) { pick = e; break; } }
    // spare money only: the AI's own build order, harvesters and defences come first
    if (p.credits < Math.min(1000, UNITS[pick.id].cost)) continue;
    w.issue({ c: 'build', player: p.id, type: pick.id });
  }
}

/** Extra conditions before the AI builds a unit. */
function aiWants(v: AIView, id: string): boolean {
  const w = v.world;
  if (id === 'qtnk' || id === 'dtrk') return w.time > SIEGE_AFTER && enemyStructures(v).length > 0;
  if (id === 'msub') return coastalTargets(v, null).length > 0;
  return true;
}

function enemyStructures(v: AIView): Building[] {
  return v.world.buildings.filter((b) => b.alive && v.p.isEnemy(b.owner) && !b.bt.wall && !b.bt.mine);
}

/** Damage value (credits) a quake at (x, y) would deal to enemies and to our own side. */
export function quakeValue(world: World, p: Player, x: number, y: number, self?: Unit): { enemy: number; own: number } {
  let enemy = 0, own = 0;
  world.grid.query(x, y, MAD_RADIUS + 0.5, (o) => {
    if (o === self || !o.alive || o.transport || o.kind === 'infantry' || o.isAir || Math.hypot(o.x - x, o.y - y) >= MAD_RADIUS) return;
    const value = o.ut.cost * Math.min(1, MAD_UNIT_DAMAGE / Math.max(0.05, o.healthFrac));
    if (o.owner.team === p.team) own += value;
    else if (world.canSee(p, o)) enemy += value;
  });
  for (const b of world.buildings) {
    if (!b.alive || b.bt.wall || Math.hypot(b.x - x, b.y - y) >= MAD_RADIUS) continue;
    const value = apparentType(b, p).cost * Math.min(1, MAD_BUILDING_DAMAGE / Math.max(0.05, b.healthFrac));
    if (b.owner.team === p.team) own += value;
    else if (!b.bt.mine) enemy += value;
  }
  return { enemy, own };
}

/** The enemy structure with the most value around it (within r), weighed against the distance from (x, y). */
function richestCluster(v: AIView, x: number, y: number, r: number): Building | null {
  const list = enemyStructures(v);
  let best: Building | null = null, bestScore = -Infinity;
  for (const b of list) {
    let value = 0;
    for (const o of list) if (o.owner.team === b.owner.team && Math.hypot(o.x - b.x, o.y - b.y) < r) value += apparentType(o, v.p).cost;
    const score = value - Math.hypot(b.x - x, b.y - y) * 25;
    if (score > bestScore) { bestScore = score; best = b; }
  }
  return best;
}

/** M.A.D. Tank: drive to the richest enemy cluster and deploy where the quake pays off. */
function aiMad(v: AIView, u: Unit) {
  if (u.madStage > 0 || u.transport) return;
  const w = v.world, p = v.p;
  const q = quakeValue(w, p, u.x, u.y, u);
  const b = richestCluster(v, u.x, u.y, MAD_RADIUS - 1);
  const best = b ? quakeValue(w, p, b.x, b.y, u) : q;
  const stopped = (u.order.type === 'idle' || u.order.type === 'guard') && !u.path && !u.pathPending;
  const safe = q.own * 2 <= q.enemy;
  const underFire = w.tick - u.lastDamagedTick < TICK_HZ * 2;
  // as good as it gets (near the cluster's best spot, or it can't get any closer), under fire (it has to
  // survive QuakeDelay deployed), or about to die anyway
  const near = !!b && Math.hypot(b.x - u.x, b.y - u.y) < MAD_RADIUS;
  const worth = safe && q.enemy >= 1200 && (q.enemy >= best.enemy * 0.85 || underFire || (stopped && near));
  const lastChance = u.healthFrac < 0.3 && q.enemy >= 600 && q.own <= q.enemy;
  if (worth || lastChance) {
    w.issue({ c: 'deploy', player: p.id, units: [u.id] });
    return;
  }
  // set off together with an assault (the defences are busy with the wave), or when nothing guards the target
  if (!b || !(assaulting(v) || defencesNear(w, b.owner, b.x, b.y, 8) === 0)) return;
  if (stopped || (u.order.type === 'move' && Math.hypot(u.order.x - b.x, u.order.y - b.y) > 3)) {
    w.issue({ c: 'move', player: p.id, units: [u.id], x: b.x, y: b.y });
  }
}

/** Whether the AI's attack wave is on its way in (unknown AI state: always). */
function assaulting(v: AIView): boolean {
  if (v.state === undefined) return true;
  return v.state === 'attack' && (v.stage === undefined || v.stage === 'assault');
}

/** Demolition truck: drive into the most valuable enemy structure cluster. */
function aiDemo(v: AIView, u: Unit) {
  if (u.transport || u.order.type === 'attack' || u.order.type === 'attackGround') return;
  const b = richestCluster(v, u.x, u.y, DEMO_RADIUS);
  // (with an assault, or when nothing guards the target: a lone truck dies to the first defence)
  if (b && (assaulting(v) || defencesNear(v.world, b.owner, b.x, b.y, 8) === 0)) v.world.issue({ c: 'attack', player: v.p.id, units: [u.id], target: b.id });
}

/** Defensive structures of `owner` within r of (x, y). */
function defencesNear(world: World, owner: Player, x: number, y: number, r: number): number {
  let n = 0;
  for (const b of world.buildings) if (b.alive && b.owner === owner && b.weapons.length && Math.hypot(b.x - x, b.y - y) < r) n++;
  return n;
}

/** Chrono Tank: jump out when nearly dead; during an assault jump onto a weakly defended valuable structure. */
function aiChrono(v: AIView, u: Unit) {
  if (u.chronoCooldown > 0 || u.transport) return;
  const w = v.world, p = v.p;
  const [bx, by] = v.baseCenter();
  if (u.healthFrac < 0.35 && w.tick - u.lastDamagedTick < TICK_HZ * 3 && Math.hypot(u.x - bx, u.y - by) > 15) {
    const [x, y] = w.findFreeSpot(bx, by + 3, 6);
    if (chronoTarget(w, p, x, y)) w.issue({ c: 'chronoJump', player: p.id, unit: u.id, x, y });
    return;
  }
  if (!assaulting(v) || u.healthFrac < 0.6 || ceasefireActive(w)) return;
  // a flanking hop onto a weakly defended valuable structure near the fight (not a lone dive across the map)
  let best: Building | null = null, bestScore = 0;
  for (const b of enemyStructures(v)) {
    if (Math.hypot(b.x - u.x, b.y - u.y) > CHRONO_HOP) continue;
    const t = apparentType(b, p);
    const score = Math.min(t.cost, 2500) + (t.id === 'proc' || t.power > 0 || t.superweapon ? 800 : 0) - 900 * defencesNear(w, b.owner, b.x, b.y, 7);
    if (score > bestScore) { bestScore = score; best = b; }
  }
  if (!best || bestScore < 800) return;
  // land on the side facing home, out of the footprint
  const a = Math.atan2(by - best.y, bx - best.x);
  const x = best.x + Math.cos(a) * (best.w / 2 + 2.5), y = best.y + Math.sin(a) * (best.h / 2 + 2.5);
  if (!chronoTarget(w, p, x, y)) return;
  w.issue({ c: 'chronoJump', player: p.id, unit: u.id, x, y });
  w.issue({ c: 'attack', player: p.id, units: [u.id], target: best.id });
}

/** Mechanic: walk over to the most damaged own vehicle nearby (the medic behaviour repairs it from there). */
function aiMechanic(v: AIView, u: Unit, units: Unit[]) {
  if (u.order.type !== 'idle' || (u.target && u.target.alive)) return;
  let best: Unit | null = null, bestScore = Infinity;
  for (const o of units) {
    if (o.kind !== 'vehicle' || o.healthFrac > 0.75 || o.transport) continue;
    const d = Math.hypot(o.x - u.x, o.y - u.y);
    if (d > 25) continue;
    const score = d + o.healthFrac * 10;
    if (score < bestScore) { bestScore = score; best = o; }
  }
  if (best && Math.hypot(best.x - u.x, best.y - u.y) > 1.5) {
    const [x, y] = v.world.findFreeSpot(best.x, best.y, 2, false);
    v.world.issue({ c: 'move', player: v.p.id, units: [u.id], x, y });
  }
}

/** Enemy structures a missile sub on water body `label` (null: any body) can reach from the sea. */
function coastalTargets(v: AIView, label: number | null): Building[] {
  const w = v.world, m = w.map;
  const info = seaInfo(m);
  const reach = (WEAPONS.SubSCUD.range - 1.5);
  const out: Building[] = [];
  for (const b of enemyStructures(v)) {
    const R = Math.ceil(reach);
    const fx = Math.floor(b.x), fy = Math.floor(b.y);
    let ok = false;
    for (let dy = -R; dy <= R && !ok; dy += 2) for (let dx = -R; dx <= R && !ok; dx += 2) {
      const cx = fx + dx, cy = fy + dy;
      if (!m.inBounds(cx, cy) || dx * dx + dy * dy > reach * reach) continue;
      const id = info.label[m.idx(cx, cy)];
      if (id >= 0 && (label === null ? info.size[id] >= 30 : id === label)) ok = true;
    }
    if (ok) out.push(b);
  }
  return out;
}

/** Missile subs: bombard the nearest reachable enemy structure (defences and factories first). */
function aiMissileSubs(v: AIView, units: Unit[]) {
  const subs = units.filter((u) => u.ut.id === 'msub' && (u.order.type === 'idle' || u.order.type === 'guard') && !u.target && u.healthFrac >= 0.45);
  if (!subs.length) return;
  const info = seaInfo(v.world.map);
  const m = v.world.map;
  for (const u of subs) {
    const label = info.label[m.idx(Math.floor(u.x), Math.floor(u.y))];
    if (label < 0) continue;
    let best: Building | null = null, bestScore = Infinity;
    for (const b of coastalTargets(v, label)) {
      let score = Math.hypot(b.x - u.x, b.y - u.y) * 0.2;
      if (b.weapons.length) score -= 5;
      if (b.bt.factory || b.bt.id === 'proc') score -= 3;
      if (score < bestScore) { bestScore = score; best = b; }
    }
    if (best) v.world.issue({ c: 'attack', player: v.p.id, units: [u.id], target: best.id });
  }
}
