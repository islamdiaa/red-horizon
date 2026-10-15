/**
 * Chinook transport helicopter (`tran`, RA AADATA TransportHeli: lands on clear terrain, Passengers=5).
 *
 * It reuses the APC passenger mechanics (Unit.passengers / World.board / World.unload). Behaviour:
 * - a move order flies to the point and lands there (nearest open cell, never on water or structures);
 * - idle Chinooks sit on the ground, so infantry ordered to 'enter' it can board (World.board refuses a
 *   transport that is still in the air);
 * - 'deploy' (D) lands right where it is (if needed) and unloads everybody.
 */
import { mphToCellsPerSecond, rotToRadPerSecond } from '../data/rules';
import { angleDiff, turnTowards } from '../core/util';
import type { Unit } from './entities';
import { DT } from './types';
import type { World } from './world';

const HELI_ALT = 1.55;

/** Nearest cell centre within 3 cells of (x, y) where a helicopter can set down. */
export function landingSpot(world: World, x: number, y: number, self?: Unit): [number, number] | null {
  const m = world.map;
  const fx = Math.floor(x), fy = Math.floor(y);
  for (let r = 0; r <= 3; r++) {
    let best: [number, number] | null = null, bd = Infinity;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const cx = fx + dx, cy = fy + dy;
      if (!m.passable(cx, cy) || m.occupant[m.idx(cx, cy)] !== 0) continue;
      // one helicopter per cell
      if (world.units.some((o) => o !== self && o.alive && o.kind === 'aircraft' && o.ut.passengers && Math.floor(o.guardX) === cx && Math.floor(o.guardY) === cy)) continue;
      const d = (cx + 0.5 - x) ** 2 + (cy + 0.5 - y) ** 2;
      if (d < bd) { bd = d; best = [cx + 0.5, cy + 0.5]; }
    }
    if (best) return best;
  }
  return null;
}

/** Per-tick behaviour of a transport helicopter (aircraft.ts hook). */
export function updateTransportHeli(world: World, u: Unit) {
  const o = u.order;
  // it never needs a pad: don't hold one for the attack helicopters
  u.homePad = 0;
  u.target = null;
  let tx = u.guardX, ty = u.guardY;
  let land = true;
  switch (o.type) {
    case 'move':
    case 'guard': {
      tx = o.x;
      ty = o.y;
      land = false;
      if (Math.hypot(tx - u.x, ty - u.y) < 0.35) {
        // arrived: set down at the nearest open spot
        const spot = landingSpot(world, tx, ty, u);
        world.setOrder(u, { type: 'idle' });
        u.guardX = spot ? spot[0] : tx;
        u.guardY = spot ? spot[1] : ty;
        if (!spot) u.hasGoal = true; // nowhere to land: hover
        if (u.orderQueue.length) world.setOrder(u, u.orderQueue.shift()!);
      }
      break;
    }
    case 'deploy': {
      if (!u.passengers.length) { world.setOrder(u, { type: 'idle' }); break; }
      if (u.altitude < 0.05) {
        world.unload(u);
        world.setOrder(u, { type: 'idle' });
        u.guardX = u.x;
        u.guardY = u.y;
        break;
      }
      if (!u.hasGoal) {
        const spot = landingSpot(world, u.x, u.y, u);
        if (!spot) { world.setOrder(u, { type: 'idle' }); world.announce(u.owner, 'cannot_deploy', 1); break; }
        u.goalX = spot[0];
        u.goalY = spot[1];
        u.hasGoal = true;
      }
      tx = u.goalX;
      ty = u.goalY;
      break;
    }
    case 'idle': {
      // hasGoal on an idle Chinook = no landing spot found, keep hovering
      if (u.hasGoal) { land = false; break; }
      // don't park on a structure (e.g. fresh off the helipad: leave it to the attack helicopters)
      const m = world.map;
      const gx = Math.floor(u.guardX), gy = Math.floor(u.guardY);
      if (m.inBounds(gx, gy) && m.occupant[m.idx(gx, gy)] !== 0) {
        const spot = landingSpot(world, u.guardX, u.guardY + 1.5, u);
        if (spot) { u.guardX = spot[0]; u.guardY = spot[1]; tx = spot[0]; ty = spot[1]; }
      }
      break;
    }
    default:
      // attack / enter / other orders mean nothing to an unarmed transport
      world.setOrder(u, { type: 'idle' });
      u.guardX = u.x;
      u.guardY = u.y;
  }
  fly(world, u, tx, ty, land);
}

function fly(world: World, u: Unit, tx: number, ty: number, land: boolean) {
  const speed = mphToCellsPerSecond(u.ut.speed);
  const rot = rotToRadPerSecond(u.ut.rot) * 1.3;
  const dx = tx - u.x, dy = ty - u.y;
  const dist = Math.hypot(dx, dy);
  let wantAlt = HELI_ALT;
  if (land && dist < 0.25) {
    wantAlt = 0;
    u.x += dx * 0.2;
    u.y += dy * 0.2;
  }
  // take off before moving
  if (dist > 0.3 && wantAlt === 0) wantAlt = HELI_ALT;
  u.altitude += Math.max(-0.9 * DT, Math.min(0.9 * DT, wantAlt - u.altitude));
  if (u.altitude < 0.02 && wantAlt === 0) u.altitude = 0;
  const want = dist > 0.05 ? Math.atan2(dy, dx) : u.heading;
  if (dist > 0.05 && u.altitude > 0.3) u.heading = turnTowards(u.heading, want, rot * DT);
  let v = 0;
  if (u.altitude > HELI_ALT * 0.45) {
    const align = Math.max(0, Math.cos(angleDiff(u.heading, want)));
    v = Math.min(speed, dist * 1.6) * align;
  }
  u.x = Math.max(0.5, Math.min(world.map.w - 0.5, u.x + Math.cos(u.heading) * v * DT));
  u.y = Math.max(0.5, Math.min(world.map.h - 0.5, u.y + Math.sin(u.heading) * v * DT));
  u.moving = v > 0.05;
  u.speedFrac = Math.min(1, v / Math.max(0.01, speed));
  u.path = null;
}
