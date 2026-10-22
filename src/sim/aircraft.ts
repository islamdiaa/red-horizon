import { BUILDINGS, mphToCellsPerSecond, rotToRadPerSecond } from '../data/rules';
import { angleDiff, turnTowards } from '../core/util';
import { Building, Entity, Unit, distToEntity } from './entities';
import { findTarget, pickWeapon } from './combat';
import { DT } from './types';
import type { World } from './world';
import { updateSortie } from './powers';
import { updateTransportHeli } from './chinook';

const HELI_ALT = 1.55;
const PLANE_ALT = 2.3;
const RELOAD_TIME = 0.7; // seconds per ammo while landed

/** Pads that can host this aircraft type. */
function padsFor(world: World, u: Unit): Building[] {
  return world.buildings.filter((b) => b.alive && b.active && b.owner === u.owner && b.bt.factory === 'aircraft' &&
    (!b.bt.factoryOnly || b.bt.factoryOnly.includes(u.ut.id)));
}

/** Find (and remember) a home pad, preferring ones nobody else uses. */
function homePad(world: World, u: Unit): Building | null {
  const cur = u.homePad ? world.entities.get(u.homePad) : undefined;
  if (cur instanceof Building && cur.alive && cur.owner === u.owner) return cur;
  const pads = padsFor(world, u);
  if (!pads.length) { u.homePad = 0; return null; }
  let best: Building | null = null, bestScore = Infinity;
  for (const p of pads) {
    const users = world.units.filter((o) => o !== u && o.alive && o.kind === 'aircraft' && o.homePad === p.id).length;
    const score = users * 50 + Math.hypot(p.x - u.x, p.y - u.y);
    if (score < bestScore) { bestScore = score; best = p; }
  }
  u.homePad = best ? best.id : 0;
  return best;
}

export function isLanded(u: Unit) {
  return u.altitude < 0.05;
}

export function updateAircraft(world: World, u: Unit) {
  // support aircraft flying a power's run, transport helicopters (land/air content modules)
  if (u.sortie) { updateSortie(world, u); return; }
  if (u.ut.passengers) { updateTransportHeli(world, u); return; }
  const vtol = !!u.ut.vtol;
  const cruise = vtol ? HELI_ALT : PLANE_ALT;
  const speed = mphToCellsPerSecond(u.ut.speed) * (u.owner.hc?.air ?? 1); // (campaign difficulty: RA's Airspeed handicap, sim/handicap.ts)
  const rot = rotToRadPerSecond(u.ut.rot) * (vtol ? 1.3 : 0.9);
  const maxAmmo = u.ut.ammo ?? 0;
  const o = u.order;

  let tx = u.x, ty = u.y;
  let wantAlt = cruise;
  let hover = vtol;
  let face: number | null = null;
  let goHome = false;

  // drop invalid targets
  if (u.target && (!u.target.alive || !u.owner.isEnemy(u.target.owner))) u.target = null;

  switch (o.type) {
    case 'attack': {
      const t = world.entities.get(o.target);
      if (!t || !t.alive || (t instanceof Unit && t.transport) || u.ammo <= 0) {
        world.setOrder(u, { type: 'idle' });
        goHome = u.ammo <= 0 || !vtol;
        break;
      }
      u.target = t;
      const slot = pickWeapon(u, t);
      const range = slot ? slot.def.range : 3;
      const d = distToEntity(u.x, u.y, t);
      if (vtol) {
        if (d > range * 0.85) { tx = t.x; ty = t.y; }
        else face = Math.atan2(t.y - u.y, t.x - u.x);
      } else {
        // strafing run: aim past the target
        const a = Math.atan2(t.y - u.y, t.x - u.x);
        tx = t.x + Math.cos(a) * 2;
        ty = t.y + Math.sin(a) * 2;
        hover = false;
      }
      break;
    }
    case 'move':
    case 'guard': {
      tx = o.x;
      ty = o.y;
      if (Math.hypot(tx - u.x, ty - u.y) < 0.4) {
        if (!vtol) goHome = true;
        world.setOrder(u, { type: 'idle' });
        u.guardX = tx;
        u.guardY = ty;
      }
      break;
    }
    case 'deploy': {
      // Return to base: home becomes the post, so the aircraft stays there once rearmed
      goHome = true;
      const pad = homePad(world, u);
      if (pad) { u.guardX = pad.x; u.guardY = pad.y; }
      break;
    }
    default: {
      // idle: helicopters hold position and engage nearby enemies; planes go home
      if (!vtol || u.ammo <= 0) { goHome = true; break; }
      // a helicopter that has landed to rearm stays on the pad until fully loaded
      if (isLanded(u) && u.ammo < maxAmmo) { goHome = true; break; }
      if (u.ammo > 0 && !isLanded(u) && u.stance !== 'passive') {
        if (--u.scanTimer <= 0) {
          u.scanTimer = 10;
          const t = findTarget(world, u, u.ut.sight, u.ut.sight);
          if (t) { world.setOrder(u, { type: 'attack', target: t.id, forced: false }); u.target = t; }
        }
      }
      if (isLanded(u)) wantAlt = 0;
      tx = u.guardX; ty = u.guardY;
    }
  }

  if (goHome) {
    const pad = homePad(world, u);
    if (pad) {
      tx = pad.x; ty = pad.y;
      const d = Math.hypot(tx - u.x, ty - u.y);
      if (d < 0.25) {
        hover = true;
        wantAlt = 0;
        u.x += (tx - u.x) * 0.2;
        u.y += (ty - u.y) * 0.2;
        if (o.type !== 'idle') world.setOrder(u, { type: 'idle' });
      } else if (d < 2.5) hover = true;
    } else if (!vtol) {
      // no airfield: circle where we are
      tx = u.x + Math.cos(u.heading + 0.6) * 3;
      ty = u.y + Math.sin(u.heading + 0.6) * 3;
    }
  }

  // reload on the pad
  if (isLanded(u)) {
    const pad = homePad(world, u);
    if (pad && Math.hypot(pad.x - u.x, pad.y - u.y) < 0.6 && u.ammo < maxAmmo) {
      u.waitTimer += DT;
      if (u.waitTimer >= RELOAD_TIME) { u.waitTimer = 0; u.ammo++; }
    }
  }

  // altitude: take off before moving
  const needMove = Math.hypot(tx - u.x, ty - u.y) > 0.3;
  if (needMove && wantAlt === 0) wantAlt = cruise;
  u.altitude += Math.max(-0.9 * DT, Math.min(0.9 * DT, wantAlt - u.altitude));
  if (u.altitude < 0.02 && wantAlt === 0) u.altitude = 0;

  // movement
  const dx = tx - u.x, dy = ty - u.y;
  const dist = Math.hypot(dx, dy);
  const want = dist > 0.05 ? Math.atan2(dy, dx) : u.heading;
  if (face !== null) u.heading = turnTowards(u.heading, face, rot * DT);
  else if (dist > 0.05) u.heading = turnTowards(u.heading, want, rot * DT);
  let v = 0;
  if (u.altitude > cruise * 0.45) {
    if (hover) {
      const align = Math.max(0, Math.cos(angleDiff(u.heading, want)));
      v = Math.min(speed, dist * 1.6) * (face !== null ? 0 : align);
    } else {
      v = speed; // planes keep flying
    }
  }
  u.x += Math.cos(u.heading) * v * DT;
  u.y += Math.sin(u.heading) * v * DT;
  u.x = Math.max(0.5, Math.min(world.map.w - 0.5, u.x));
  u.y = Math.max(0.5, Math.min(world.map.h - 0.5, u.y));
  u.moving = v > 0.05;
  u.speedFrac = Math.min(1, v / Math.max(0.01, speed));
  u.path = null;
}

/** Spawn helper: aircraft appear landed on their pad. */
export function placeOnPad(u: Unit, pad: Building) {
  u.x = u.prevX = pad.x;
  u.y = u.prevY = pad.y;
  u.altitude = 0;
  u.homePad = pad.id;
  u.heading = u.prevHeading = -Math.PI / 2;
}

export { BUILDINGS, Entity };
