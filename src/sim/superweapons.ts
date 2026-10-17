import { WEAPONS } from '../data/rules';
import { Building, Unit } from './entities';
import type { Projectile } from './combat';
import type { Player } from './player';
import { DT } from './types';
import type { AnnouncerKey } from '../audio/types';
import { firePower, isSupportPower } from './powers';
import type { World } from './world';
import { aftermathChronoshift } from './aftermath';

/** Superweapons and support powers (RA "special weapons"). */
export type SuperKind = 'nuke' | 'ironcurtain' | 'chrono' | 'gps' | 'sonar' | 'spyplane' | 'paratroopers' | 'parabombs';
/** Every kind, in the order the HUD lists them. */
export const SUPER_KINDS: SuperKind[] = ['nuke', 'ironcurtain', 'chrono', 'gps', 'sonar', 'spyplane', 'paratroopers', 'parabombs'];
/** How a power is aimed: a map point, a point plus one of your units (chronoshift), or no target at all. */
export const SUPER_TARGET: Record<SuperKind, 'point' | 'unit-point' | 'none'> = {
  nuke: 'point', ironcurtain: 'point', chrono: 'unit-point', gps: 'none', sonar: 'none', spyplane: 'point', paratroopers: 'point', parabombs: 'point',
};
const KINDS: SuperKind[] = SUPER_KINDS;
/** Announcer line when a power becomes ready (GPS launches itself and announces the launch; sonar on infiltration). */
const READY_KEY: Partial<Record<SuperKind, AnnouncerKey>> = {
  nuke: 'nuke_ready', ironcurtain: 'iron_curtain_ready', chrono: 'chrono_ready',
  spyplane: 'spyplane_ready', paratroopers: 'paratroopers_ready', parabombs: 'parabombs_ready',
};
/**
 * Seconds to charge each power when its structure does not say otherwise. Support powers follow the RA
 * [Recharge] minutes (GPS 8, SpyPlane 3, Paratrooper 7, ParaBomb 14, Nuke 13) compressed like the nuke
 * (13 min -> 300 s). Sonar is a one-shot pulse a spy steals from a sub pen: ready the moment it is granted.
 */
const CHARGE_TIME: Record<SuperKind, number> = {
  nuke: 300, ironcurtain: 240, chrono: 240, gps: 180, sonar: 1, spyplane: 75, paratroopers: 165, parabombs: 320,
};
/** Airfield powers charge without power (RA only suspends the GPS on low power). */
const NEEDS_POWER: Record<SuperKind, boolean> = {
  nuke: true, ironcurtain: true, chrono: true, gps: true, sonar: false, spyplane: false, paratroopers: false, parabombs: false,
};

export function superBuilding(world: World, p: Player, kind: SuperKind): Building | null {
  for (const b of world.buildings) {
    if (!b.alive || b.owner !== p || !b.active) continue;
    if (b.bt.superweapon === kind) return b;
    // support powers: the Airfield / Tech Center providing them (the GPS satellite only launches once)
    if (b.bt.powers && (b.bt.powers as SuperKind[]).includes(kind) && !(kind === 'gps' && p.gps)) return b;
  }
  return null;
}

export function superChargeTime(kind: SuperKind): number {
  return CHARGE_TIME[kind];
}

/** Whether the player has this power at all right now (its structure stands / a sonar pulse was stolen). HUD lists these. */
export function superAvailable(world: World, p: Player, kind: SuperKind): boolean {
  if (kind === 'sonar') return p.sonarCharges > 0;
  return !!superBuilding(world, p, kind);
}

/** Seconds of charge the power needs (compare with p.superCharge[kind] for the HUD progress). */
export function superFull(world: World, p: Player, kind: SuperKind): number {
  if (kind === 'sonar') return CHARGE_TIME.sonar;
  return superBuilding(world, p, kind)?.bt.superCharge ?? CHARGE_TIME[kind];
}

export function superReady(world: World, p: Player, kind: SuperKind): boolean {
  if (kind === 'sonar') return p.sonarCharges > 0;
  const b = superBuilding(world, p, kind);
  return !!b && p.superCharge[kind] >= (b.bt.superCharge ?? superChargeTime(kind));
}

/** Every power's providing structure for p, found in one pass over the buildings (superBuilding semantics). */
function superSources(world: World, p: Player): Partial<Record<SuperKind, Building>> {
  const out: Partial<Record<SuperKind, Building>> = {};
  for (const b of world.buildings) {
    if (!b.alive || b.owner !== p || !b.active) continue;
    const sw = b.bt.superweapon;
    if (sw && !out[sw]) out[sw] = b;
    if (b.bt.powers) for (const k of b.bt.powers as SuperKind[]) if (!out[k] && !(k === 'gps' && p.gps)) out[k] = b;
  }
  return out;
}

export function updateSuperweapons(world: World, p: Player) {
  const sources = superSources(world, p);
  for (const kind of KINDS) {
    if (kind === 'sonar') {
      // one-shot pulses granted by spies: full while any is held
      p.superCharge.sonar = p.sonarCharges > 0 ? CHARGE_TIME.sonar : 0;
      continue;
    }
    const b = sources[kind];
    if (!b) {
      p.superCharge[kind] = 0;
      p.superAnnounced[kind] = false;
      continue;
    }
    const full = b.bt.superCharge ?? superChargeTime(kind);
    if (p.lowPower && NEEDS_POWER[kind]) continue; // charging pauses without power
    if (p.superCharge[kind] < full) {
      p.superCharge[kind] = Math.min(full, p.superCharge[kind] + DT);
    } else if (kind === 'gps') {
      // RA: the GPS satellite launches by itself as soon as it is charged
      firePower(world, p, 'gps', 0, 0);
    } else if (!p.superAnnounced[kind]) {
      p.superAnnounced[kind] = true;
      const key = READY_KEY[kind];
      if (key) world.announce(p, key, 0);
    }
  }
}

export function fireSuperweapon(world: World, p: Player, kind: SuperKind, x: number, y: number, unitId?: number) {
  if (!superReady(world, p, kind)) return;
  // a target off the map (e.g. clicking the horizon) is refused; the charge is kept
  if (SUPER_TARGET[kind] !== 'none' && !(x >= 0 && y >= 0 && x < world.map.w && y < world.map.h)) {
    world.announce(p, 'select_target', 0);
    return;
  }
  if (isSupportPower(kind)) {
    firePower(world, p, kind, x, y);
    return;
  }
  const b = superBuilding(world, p, kind)!;
  switch (kind) {
    case 'nuke': {
      p.superCharge.nuke = 0;
      p.superAnnounced.nuke = false;
      const sz = world.map.heightAt(b.x, b.y) + 0.5;
      const dist = Math.hypot(x - b.x, y - b.y);
      const proj: Projectile = {
        id: world.nextProjectileId++, weapon: WEAPONS.Nuke, owner: p, shooter: b.id, kind: 'scud',
        x: b.x, y: b.y, z: sz, prevX: b.x, prevY: b.y, prevZ: sz, sx: b.x, sy: b.y, sz,
        tx: x, ty: y, tz: world.map.heightAt(x, y), target: null,
        t: 0, dur: 4.5 + dist * 0.04, arc: 14 + dist * 0.25, speed: 0, vx: 0, vy: 0, alive: true, special: 'nuke',
      };
      world.projectiles.push(proj);
      b.doorHold = 4;
      world.events.push({ e: 'nuke', x: b.x, y: b.y, stage: 'launch' });
      world.events.push({ e: 'sfx', key: 'nuke_launch', x: b.x, y: b.y });
      world.announce(p, 'nuke_launched', 0);
      for (const o of world.players) if (o !== p) world.announce(o, 'nuke_warning', 0);
      break;
    }
    case 'ironcurtain': {
      const units = world.units.filter((u) => u.alive && u.owner === p && Math.hypot(u.x - x, u.y - y) < 1.8);
      const blds = world.buildings.filter((o) => o.alive && o.owner === p && o.distTo(x, y) < 0.8);
      if (!units.length && !blds.length) {
        // nothing of ours there: refuse instead of wasting the charge
        world.announce(p, 'select_target', 0);
        return;
      }
      p.superCharge.ironcurtain = 0;
      p.superAnnounced.ironcurtain = false;
      for (const u of units) u.invulnerable = 25;
      for (const o of blds) o.invulnerable = 25;
      world.events.push({ e: 'ironcurtain', x, y });
      world.events.push({ e: 'sfx', key: 'iron_curtain', x, y });
      break;
    }
    case 'chrono': {
      const u = unitId ? world.entities.get(unitId) : undefined;
      if (!(u instanceof Unit) || !u.alive || u.owner !== p || u.kind !== 'vehicle') {
        world.announce(p, 'select_target', 0);
        return;
      }
      const cx = Math.floor(x), cy = Math.floor(y);
      if (!world.map.passable(cx, cy)) {
        world.announce(p, 'cannot_deploy', 0);
        return;
      }
      p.superCharge.chrono = 0;
      p.superAnnounced.chrono = false;
      if (aftermathChronoshift(world, u)) break; // a shifted demolition truck detonates on the spot (RA)
      const fx = u.x, fy = u.y;
      u.x = u.prevX = cx + 0.5;
      u.y = u.prevY = cy + 0.5;
      world.setOrder(u, { type: 'idle' });
      u.guardX = u.x;
      u.guardY = u.y;
      world.events.push({ e: 'teleport', id: u.id, fromX: fx, fromY: fy, x: u.x, y: u.y });
      world.events.push({ e: 'sfx', key: 'chrono', x: u.x, y: u.y });
      break;
    }
  }
}
