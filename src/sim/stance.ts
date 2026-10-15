/**
 * Unit stances (Unit.stance, set with the 'stance' command):
 * - guard (default): engage what comes into range, chase a little (leash) and return to the post;
 * - aggressive: hunt anything seen (structures included), no leash, and stay where the fight ends;
 * - hold: never move on its own; fire at whatever is in weapon range;
 * - passive: never open fire unless ordered (explicit attack / attack-move), no retaliation, no fire on the move.
 * Guard is unitlogic's normal idle behaviour; the other three are handled here (idle hook).
 */
import { Unit, distToEntity, type Entity } from './entities';
import { findTarget, maxRange, pickWeapon } from './combat';
import { autoTargetable } from './stealth';
import type { World } from './world';

/** Whether a unit may fire at targets of opportunity while moving (passive units hold fire). */
export function firesOnTheMove(u: Unit): boolean {
  return u.stance !== 'passive';
}

function valid(world: World, u: Unit, t: Entity | null): t is Entity {
  return !!t && t.alive && u.owner.isEnemy(t.owner) && world.canSee(u.owner, t) && !!pickWeapon(u, t);
}

function stop(u: Unit) {
  u.path = null;
  u.hasGoal = false;
  u.pathPending = false;
}

/**
 * Idle behaviour for the non-default stances. Returns false when unitlogic's normal idle (guard) applies:
 * guard stance, unarmed units, harvesters, medics and units with queued orders.
 */
export function stanceIdle(world: World, u: Unit): boolean {
  const s = u.stance;
  if (s === 'guard' || !u.weapons.length || u.ut.harvester || u.ut.medic || u.orderQueue.length) return false;
  if (s === 'passive') {
    u.target = null;
    if (u.chasing) {
      u.chasing = false;
      if (Math.hypot(u.x - u.guardX, u.y - u.guardY) > 0.6) world.requestPath(u, u.guardX, u.guardY);
    }
    return true;
  }
  let t: Entity | null = u.target;
  if (t && !valid(world, u, t)) t = u.target = null;
  if (!t && world.tick - u.lastDamagedTick < 10 && u.lastAttacker) {
    const a = world.entities.get(u.lastAttacker) ?? null;
    if (valid(world, u, a) && (s !== 'hold' || inRange(u, a))) t = u.target = a;
  }
  if (!t && --u.scanTimer <= 0) {
    u.scanTimer = 6 + (u.id % 5);
    const r = s === 'hold' ? maxRange(u) : Math.max(u.ut.sight, maxRange(u));
    t = u.target = findTarget(world, u, r, r);
  }
  if (!t) {
    if (u.chasing && s === 'aggressive') {
      // the hunt is over: this is the new post
      u.chasing = false;
      u.guardX = u.x;
      u.guardY = u.y;
    }
    return true;
  }
  if (inRange(u, t)) {
    stop(u);
    return true;
  }
  if (s === 'hold') {
    // out of reach: let it go, never step out of position
    u.target = null;
    return true;
  }
  // aggressive: pursue for as long as it can be seen
  u.chasing = true;
  if (!u.pathPending && (!u.path || world.tick % 15 === 0)) world.requestPath(u, t.x, t.y);
  return true;
}

function inRange(u: Unit, t: Entity): boolean {
  const slot = pickWeapon(u, t);
  return !!slot && distToEntity(u.x, u.y, t) <= slot.def.range && autoTargetable(u, t);
}
