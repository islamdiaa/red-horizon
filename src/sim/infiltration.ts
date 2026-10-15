/**
 * Spies and thieves (RA INFANTRY.CPP Per_Cell_Process, MISSION_CAPTURE for INFANTRY_SPY / INFANTRY_THIEF).
 *
 * A spy walks into an enemy structure through the normal 'enter' order and is consumed; the structure
 * remembers the spying player (`Building.spiedBy`) and as long as it stands that player gets intel:
 * - Radar Dome: the owner's radar view (RA RadarSpied)            -> player.intel.radar
 * - Power Plant / Advanced Power Plant: its power figures (RA)    -> player.intel.power
 * - Refinery / Silo: the owner's credits (RA)                     -> player.intel.credits
 * - Construction Yard and factories: what they are producing (RA) -> player.intel.production
 * - Sub Pen: a sonar pulse (RA SPC_SONAR_PULSE)                   -> player.sonarCharges
 * Anything else (and decoys) yields nothing except that the spy's side now knows the building (`spiedBy`).
 *
 * A thief entering an enemy refinery or silo steals half of that player's money (RA: Available_Money / 2).
 * Spies look like a soldier of an enemy player (`Unit.disguise`) and are never auto-targeted except by dogs.
 */
import { BUILDINGS, type BuildingTypeDef } from '../data/rules';
import { Building, Unit } from './entities';
import type { Player } from './player';
import type { World } from './world';

/** Whether infantry `u` (spy or thief) may infiltrate structure `b`. */
export function canInfiltrate(u: Unit, b: Building): boolean {
  if (!b.alive || b.bt.wall || b.bt.mine || !u.owner.isEnemy(b.owner)) return false;
  if (u.ut.thief) return !!b.bt.storage;
  return !!u.ut.spy;
}

/** The spy / thief has reached `b` (enter order): apply the effect and consume the infiltrator. */
export function infiltrate(world: World, u: Unit, b: Building): boolean {
  if (!(u.ut.spy || u.ut.thief) || !canInfiltrate(u, b)) return false;
  const p = u.owner, victim = b.owner;
  let amount = 0;
  if (u.ut.spy) {
    b.spiedBy |= 1 << p.id;
    if (b.bt.id === 'spen') {
      p.sonarCharges++;
      p.superCharge.sonar = 1;
      world.announce(p, 'sonar_ready', 0);
    }
    world.announce(p, 'building_infiltrated', 0);
  } else {
    amount = Math.floor((victim.cash + victim.ore) / 2);
    // take stored ore first, then cash
    const fromOre = Math.min(victim.ore, amount);
    victim.ore -= fromOre;
    victim.cash = Math.max(0, victim.cash - (amount - fromOre));
    p.cash += amount;
    world.announce(p, 'credits_stolen', 0);
    world.announce(victim, 'credits_stolen', 0);
    if (amount > 0) world.events.push({ e: 'credits', player: p.id, amount, x: b.x, y: b.y });
  }
  world.events.push({ e: 'infiltrate', building: b.id, player: p.id, victim: victim.id, kind: u.ut.spy ? 'spy' : 'thief', amount, x: b.x, y: b.y });
  world.sfx('infiltrate', b.x, b.y);
  world.kill(u, 'sold');
  updateIntel(world);
  return true;
}

/** Rebuild every player's intel from the infiltrated structures still standing (every second). */
export function updateIntel(world: World) {
  for (const p of world.players) {
    const it = p.intel;
    if (it.radar.length) it.radar = [];
    if (it.power.length) it.power = [];
    if (it.credits.length) it.credits = [];
    if (it.production.length) it.production = [];
  }
  for (const b of world.buildings) {
    if (!b.spiedBy || !b.alive || !b.active) continue;
    for (const p of world.players) {
      if (!(b.spiedBy & (1 << p.id)) || !p.isEnemy(b.owner)) continue;
      const o = b.owner.id, it = p.intel;
      if (b.bt.radar) add(it.radar, o);
      if (b.bt.power > 0) add(it.power, o);
      if (b.bt.storage) add(it.credits, o);
      if (b.bt.factory) add(it.production, o);
    }
  }
}

function add(list: number[], id: number) {
  if (!list.includes(id)) list.push(id);
}

/** Players whose radar view `p` shares through a spied radar dome (minimap overlay). */
export function sharedRadar(world: World, p: Player): Player[] {
  return p.intel.radar.map((id) => world.players[id]).filter((o) => !!o && !o.defeated);
}

/**
 * Keep every spy disguised as a soldier of the nearest enemy player (RA: the spy looks like one of the
 * viewer's own men; with several opponents we pick the side it is mingling with). Every second.
 */
export function updateDisguises(world: World) {
  for (const u of world.units) {
    if (!u.alive || !u.ut.spy) continue;
    let best: Player | null = null, bestD = 12;
    world.grid.query(u.x, u.y, 12, (o) => {
      if (!o.alive || !u.owner.isEnemy(o.owner)) return;
      const d = Math.hypot(o.x - u.x, o.y - u.y);
      if (d < bestD) { bestD = d; best = o.owner; }
    });
    for (const b of world.buildings) {
      if (!b.alive || !u.owner.isEnemy(b.owner) || b.bt.mine) continue;
      const d = b.distTo(u.x, u.y);
      if (d < bestD) { bestD = d; best = b.owner; }
    }
    const cur = u.disguise >= 0 ? world.players[u.disguise] : null;
    if (best) u.disguise = (best as Player).id;
    else if (!cur || cur.defeated || !u.owner.isEnemy(cur)) {
      const e = world.players.find((o) => !o.defeated && u.owner.isEnemy(o));
      u.disguise = e ? e.id : -1;
    }
  }
}

/**
 * What a structure looks like to someone who isn't in on it: decoys (`fakeOf`) pass for the real building
 * (renderer model, enemy tooltips, AI target choice), unless one of the viewer's spies has been inside.
 */
export function apparentType(b: Building, viewer?: Player): BuildingTypeDef {
  const real = b.bt.fakeOf;
  if (!real || !BUILDINGS[real]) return b.bt;
  if (viewer && (viewer.team === b.owner.team || (b.spiedBy & (1 << viewer.id)))) return b.bt;
  return BUILDINGS[real];
}

/**
 * How a spy should be drawn for `viewer` (renderer / tooltips): enemies see a rifleman (`e1`) of the player in
 * `Unit.disguise` (RA draws E1 in the viewer's own colours; in a 1v1 that is the same player). Null = draw as is.
 */
export function disguisedAs(world: World, u: Unit, viewer: Player): { type: string; owner: Player } | null {
  if (!u.ut.spy || u.disguise < 0 || viewer.team === u.owner.team) return null;
  const o = world.players[u.disguise];
  return o ? { type: 'e1', owner: o } : null;
}
