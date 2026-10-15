import { WEAPONS } from '../data/rules';
import { Building, Unit } from './entities';
import type { Projectile } from './combat';
import type { Player } from './player';
import { DT } from './types';
import type { World } from './world';

/** Superweapons and support powers (RA "special weapons"). */
export type SuperKind = 'nuke' | 'ironcurtain' | 'chrono' | 'gps' | 'sonar' | 'spyplane' | 'paratroopers' | 'parabombs';
/** Every kind, in the order the HUD lists them. */
export const SUPER_KINDS: SuperKind[] = ['nuke', 'ironcurtain', 'chrono', 'gps', 'sonar', 'spyplane', 'paratroopers', 'parabombs'];
/** How a power is aimed: a map point, a point plus one of your units (chronoshift), or no target at all. */
export const SUPER_TARGET: Record<SuperKind, 'point' | 'unit-point' | 'none'> = {
  nuke: 'point', ironcurtain: 'point', chrono: 'unit-point', gps: 'none', sonar: 'none', spyplane: 'point', paratroopers: 'point', parabombs: 'point',
};
const KINDS: SuperKind[] = SUPER_KINDS;
/** Announcer line when a power becomes ready (support powers without their own line stay quiet). */
const READY_KEY: Partial<Record<SuperKind, 'nuke_ready' | 'iron_curtain_ready' | 'chrono_ready'>> = { nuke: 'nuke_ready', ironcurtain: 'iron_curtain_ready', chrono: 'chrono_ready' };

export function superBuilding(world: World, p: Player, kind: SuperKind): Building | null {
  for (const b of world.buildings) {
    if (b.alive && b.owner === p && b.active && b.bt.superweapon === kind) return b;
  }
  return null;
}

export function superChargeTime(kind: SuperKind): number {
  return kind === 'nuke' ? 300 : 240;
}

export function superReady(world: World, p: Player, kind: SuperKind): boolean {
  const b = superBuilding(world, p, kind);
  return !!b && p.superCharge[kind] >= (b.bt.superCharge ?? superChargeTime(kind));
}

export function updateSuperweapons(world: World, p: Player) {
  for (const kind of KINDS) {
    const b = superBuilding(world, p, kind);
    if (!b) {
      p.superCharge[kind] = 0;
      p.superAnnounced[kind] = false;
      continue;
    }
    const full = b.bt.superCharge ?? superChargeTime(kind);
    if (p.lowPower) continue; // charging pauses without power
    if (p.superCharge[kind] < full) {
      p.superCharge[kind] = Math.min(full, p.superCharge[kind] + DT);
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
  if (!(x >= 0 && y >= 0 && x < world.map.w && y < world.map.h)) {
    world.announce(p, 'select_target', 0);
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
