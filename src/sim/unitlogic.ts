import {
  BUILDINGS, ENGINEER_CAPTURE_LEVEL, ENGINEER_DAMAGE, mphToCellsPerSecond, rotToRadPerSecond,
} from '../data/rules';
import { angleDiff, turnTowards } from '../core/util';
import { Building, Entity, Unit, distToEntity } from './entities';
import { findHealTarget, findTarget, maxRange, pickWeapon } from './combat';
import { updateHarvester } from './harvest';
import { updateAircraft } from './aircraft';
import { recalcPlayerEconomy } from './production';
import { DT, TICK_HZ, type Order } from './types';
import type { World } from './world';

const LEASH = 5;

export function unitSpeed(u: Unit): number {
  return mphToCellsPerSecond(u.ut.speed);
}

/** Main per-tick behaviour for a unit. */
export function updateUnit(world: World, u: Unit) {
  if (u.invulnerable > 0) u.invulnerable = Math.max(0, u.invulnerable - DT);
  if (u.ut.selfHealing && u.hp < u.maxHp * 0.5 && world.tick % TICK_HZ === 0) u.hp = Math.min(u.maxHp * 0.5, u.hp + u.maxHp * 0.01);
  // elite units field-repair
  if (u.rank >= 2 && u.hp < u.maxHp && world.tick % TICK_HZ === 0 && world.tick - u.lastDamagedTick > TICK_HZ * 3) u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.02);
  if (u.c4Timer > 0) {
    u.c4Timer -= DT;
    if (u.c4Timer <= 0) {
      const b = world.entities.get(u.c4Target);
      if (b && b.alive) world.kill(b, 'blown', u);
    }
  }

  if (u.kind === 'aircraft') {
    updateAircraft(world, u);
    return;
  }
  const o = u.order;
  switch (o.type) {
    case 'idle':
    case 'guard':
      idle(world, u);
      break;
    case 'move':
      move(world, u, o);
      break;
    case 'attack':
      attack(world, u, o);
      break;
    case 'attackGround':
      attackGround(world, u, o);
      break;
    case 'harvest':
      updateHarvester(world, u);
      break;
    case 'enter':
      enter(world, u, o);
      break;
    case 'deploy':
      if (world.deploy(u)) return;
      world.announce(u.owner, 'cannot_deploy', 1);
      world.setOrder(u, { type: 'idle' });
      break;
  }

  followPath(world, u);
  if (u.exitBuilding) {
    const b = world.entities.get(u.exitBuilding) as Building | undefined;
    if (!b || !b.alive || b.distTo(u.x, u.y) > 0.25) u.exitBuilding = 0;
  }
}

function finishOrder(world: World, u: Unit) {
  const next = u.orderQueue.shift();
  if (next) world.setOrder(u, next);
  else {
    world.setOrder(u, { type: 'idle' });
    u.guardX = u.x;
    u.guardY = u.y;
  }
}

function validEnemyTarget(world: World, u: Unit, t: Entity | null): boolean {
  if (!t || !t.alive) return false;
  if (!u.owner.isEnemy(t.owner)) return false;
  if (!world.canSee(u.owner, t)) return false;
  return !!pickWeapon(u, t);
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

function idle(world: World, u: Unit) {
  if (u.orderQueue.length) {
    finishOrder(world, u);
    return;
  }
  if (u.ut.harvester) {
    // idle harvesters go back to work after a while (players get a longer grace period)
    u.waitTimer += DT;
    if (u.waitTimer > (u.owner.isHuman ? 8 : 4) && !u.moving && !u.path) {
      u.waitTimer = 0;
      u.hstate = u.cargo >= 28 ? 'toRefinery' : 'seek';
      world.setOrder(u, { type: 'harvest' });
    }
    return;
  }
  if (u.ut.medic) {
    medic(world, u);
    return;
  }
  if (!u.weapons.length) {
    // unarmed: return to guard position when pushed away
    return;
  }
  let t = u.target;
  if (t && !validEnemyTarget(world, u, t)) t = u.target = null;

  if (!t) {
    // retaliate against recent attackers
    if (world.tick - u.lastDamagedTick < 10 && u.lastAttacker) {
      const a = world.entities.get(u.lastAttacker) ?? null;
      if (validEnemyTarget(world, u, a)) t = u.target = a;
    }
  }
  if (!t) {
    u.scanTimer--;
    if (u.scanTimer <= 0) {
      u.scanTimer = 6 + (u.id % 5);
      const r = Math.max(u.ut.sight, maxRange(u));
      t = u.target = findTarget(world, u, r);
    }
  }
  if (t) {
    const slot = pickWeapon(u, t);
    const range = slot ? slot.def.range : 0;
    const d = distToEntity(u.x, u.y, t);
    if (d > range) {
      const leashD = Math.hypot(t.x - u.guardX, t.y - u.guardY);
      if (leashD > range + LEASH || t.kind === 'building') {
        u.target = null;
        if (u.chasing) returnToGuard(world, u);
        return;
      }
      u.chasing = true;
      if (!u.pathPending && (!u.path || world.tick % 15 === 0)) world.requestPath(u, t.x, t.y);
    } else {
      stopMoving(u);
    }
  } else if (u.chasing) {
    returnToGuard(world, u);
  }
}

function returnToGuard(world: World, u: Unit) {
  u.chasing = false;
  if (Math.hypot(u.x - u.guardX, u.y - u.guardY) > 0.6) world.requestPath(u, u.guardX, u.guardY);
}

function stopMoving(u: Unit) {
  u.path = null;
  u.hasGoal = false;
  u.pathPending = false;
}

function medic(world: World, u: Unit) {
  let t = u.target as Unit | null;
  if (t && (!t.alive || t.hp >= t.maxHp)) t = u.target = null;
  if (!t && --u.scanTimer <= 0) {
    u.scanTimer = 10;
    t = u.target = findHealTarget(world, u, u.ut.sight);
  }
  if (t) {
    const d = Math.hypot(t.x - u.x, t.y - u.y);
    if (d > 1.6) {
      if (!u.pathPending && (!u.path || world.tick % 15 === 0)) world.requestPath(u, t.x, t.y);
    } else stopMoving(u);
  }
}

function move(world: World, u: Unit, o: Extract<Order, { type: 'move' }>) {
  if (!u.hasGoal && !u.pathPending && !u.path) {
    if (Math.hypot(o.x - u.x, o.y - u.y) < 0.15 || o.started) {
      finishOrder(world, u);
      return;
    }
    o.started = true;
    world.requestPath(u, o.x, o.y);
    return;
  }
  if (o.attackMove && u.weapons.length) {
    if (--u.scanTimer <= 0) {
      u.scanTimer = 6;
      const sight = Math.max(u.ut.sight, maxRange(u));
      const t = findTarget(world, u, sight, sight);
      if (t) {
        world.setOrder(u, { type: 'attack', target: t.id, forced: false, resume: { type: 'move', x: o.x, y: o.y, attackMove: true } });
        u.target = t;
        return;
      }
    }
  }
  // opportunistic fire on the move (turreted units)
  if (u.ut.turret && u.weapons.length && !o.attackMove) {
    if (u.target && !validEnemyTarget(world, u, u.target)) u.target = null;
    if (!u.target && --u.scanTimer <= 0) {
      u.scanTimer = 8;
      u.target = findTarget(world, u, maxRange(u));
    }
  }
}

function attack(world: World, u: Unit, o: Extract<Order, { type: 'attack' }>) {
  const t = world.entities.get(o.target);
  if (!t || !t.alive || (!o.forced && !u.owner.isEnemy(t.owner))) {
    u.target = null;
    if (o.resume) world.setOrder(u, o.resume);
    else finishOrder(world, u);
    return;
  }
  // dogs only bite infantry; anything else -> move there
  const slot = pickWeapon(u, t);
  if (!slot) {
    finishOrder(world, u);
    return;
  }
  u.target = t;
  const range = slot.def.range;
  const d = distToEntity(u.x, u.y, t);
  if (d <= range - 0.05 && (!slot.def.minRange || d >= slot.def.minRange)) {
    stopMoving(u);
    // attack-move units give up chasing once the target leaves sight
  } else {
    if (o.resume && !world.canSee(u.owner, t)) {
      world.setOrder(u, o.resume);
      return;
    }
    const moved = Math.hypot(t.x - u.goalX, t.y - u.goalY) > 1.0;
    if (!u.pathPending && (!u.hasGoal || moved || (!u.path && world.tick % 10 === 0))) {
      let gx = t.x, gy = t.y;
      if (slot.def.minRange && d < slot.def.minRange) {
        // back off for minimum range weapons
        const a = Math.atan2(u.y - t.y, u.x - t.x);
        gx = t.x + Math.cos(a) * (slot.def.minRange + 1);
        gy = t.y + Math.sin(a) * (slot.def.minRange + 1);
      }
      world.requestPath(u, gx, gy);
    }
  }
}

function attackGround(world: World, u: Unit, o: Extract<Order, { type: 'attackGround' }>) {
  u.hasGroundTarget = true;
  u.targetX = o.x;
  u.targetY = o.y;
  u.target = null;
  const slot = u.weapons.find((s) => s.def.antiGround);
  if (!slot) return finishOrder(world, u);
  const d = Math.hypot(o.x - u.x, o.y - u.y);
  if (d <= slot.def.range - 0.05) stopMoving(u);
  else if (!u.hasGoal && !u.pathPending) world.requestPath(u, o.x, o.y);
}

function enter(world: World, u: Unit, o: Extract<Order, { type: 'enter' }>) {
  const t = world.entities.get(o.target);
  if (!t || !t.alive) return finishOrder(world, u);
  if (t instanceof Unit) {
    // board a friendly transport
    if (t.owner !== u.owner || !t.ut.passengers || u.kind !== 'infantry' || t.passengers.length >= t.ut.passengers) return finishOrder(world, u);
    if (Math.hypot(t.x - u.x, t.y - u.y) < 0.9) { world.board(u, t); return; }
    if (!u.pathPending && (!u.hasGoal || Math.hypot(t.x - u.goalX, t.y - u.goalY) > 1 || world.tick % 20 === 0)) world.requestPath(u, t.x, t.y);
    return;
  }
  if (!(t instanceof Building)) return finishOrder(world, u);
  const d = t.distTo(u.x, u.y);
  if (t.bt.repairPad && t.owner === u.owner && u.kind === 'vehicle') {
    // drive onto the depot pad
    const pad = t.bt.passable?.[0] ?? [1, 1];
    const px = t.cx + pad[0] + 0.5, py = t.cy + pad[1] + 0.5;
    if (Math.hypot(px - u.x, py - u.y) < 0.2) { stopMoving(u); finishOrder(world, u); return; }
    if (!u.hasGoal && !u.pathPending) world.requestPath(u, px, py);
    return;
  }
  if (d > 0.7) {
    if (!u.hasGoal && !u.pathPending) {
      const [px, py] = t.closestPoint(u.x, u.y);
      world.requestPath(u, px, py);
    }
    return;
  }
  stopMoving(u);
  if (u.ut.engineer) {
    if (u.owner.isEnemy(t.owner) && t.bt.wall) {
      finishOrder(world, u);
      return;
    }
    if (u.owner.isEnemy(t.owner)) {
      if (t.healthFrac <= ENGINEER_CAPTURE_LEVEL) {
        captureBuilding(world, t, u);
      } else {
        t.hp = Math.max(1, t.hp - t.maxHp * ENGINEER_DAMAGE);
        world.sfx('repair', t.x, t.y);
      }
    } else if (t.owner === u.owner) {
      t.hp = t.maxHp;
      world.sfx('repair', t.x, t.y);
    }
    // engineer is consumed (enters the building)
    world.kill(u, 'sold');
    return;
  }
  if (u.ut.c4 && u.owner.isEnemy(t.owner)) {
    u.c4Target = t.id;
    u.c4Timer = 1.6;
    world.sfx('door', t.x, t.y);
    finishOrder(world, u);
    return;
  }
  finishOrder(world, u);
}

export function captureBuilding(world: World, b: Building, by: Unit) {
  const old = b.owner;
  const now = by.owner;
  old.owned.set(b.bt.id, Math.max(0, (old.owned.get(b.bt.id) ?? 1) - 1));
  now.owned.set(b.bt.id, (now.owned.get(b.bt.id) ?? 0) + 1);
  b.owner = now;
  b.repairing = false;
  b.target = null;
  b.primary = false;
  world.events.push({ e: 'captured', id: b.id, from: old.id, to: now.id });
  world.announce(now, 'building_captured', 0);
  world.announce(old, 'structure_lost', 2);
  recalcPlayerEconomy(world, old);
  recalcPlayerEconomy(world, now);
  world.checkNewOptions(now);
}

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

function cellOk(world: World, u: Unit, x: number, y: number): boolean {
  const m = world.map;
  const cx = Math.floor(x), cy = Math.floor(y);
  if (cx < 0 || cy < 0 || cx >= m.w || cy >= m.h) return false;
  const i = cy * m.w + cx;
  if (m.passableIdx(i)) return true;
  return u.exitBuilding !== 0 && m.occupant[i] === u.exitBuilding && m.terrainPassable(i);
}

function posOk(world: World, u: Unit, x: number, y: number, dx: number, dy: number): boolean {
  if (!cellOk(world, u, x, y)) return false;
  if (u.kind === 'vehicle') {
    const l = Math.hypot(dx, dy);
    if (l > 0) {
      const r = u.ut.radius * 0.7;
      if (!cellOk(world, u, x + (dx / l) * r, y + (dy / l) * r)) return false;
    }
  }
  return true;
}

/** Moving diagonally into a new cell needs at least one open orthogonal neighbour (no corner squeezing). */
function cornerOk(world: World, u: Unit, nx: number, ny: number): boolean {
  const ox = Math.floor(u.x), oy = Math.floor(u.y), cx = Math.floor(nx), cy = Math.floor(ny);
  if (ox === cx || oy === cy) return true;
  return cellOk(world, u, cx + 0.5, oy + 0.5) || cellOk(world, u, ox + 0.5, cy + 0.5);
}

function tryMove(world: World, u: Unit, mx: number, my: number): boolean {
  const nx = u.x + mx, ny = u.y + my;
  if (posOk(world, u, nx, ny, mx, my) && cornerOk(world, u, nx, ny)) { u.x = nx; u.y = ny; return true; }
  if (Math.abs(mx) > 1e-4 && posOk(world, u, nx, u.y, mx, 0)) { u.x = nx; return true; }
  if (Math.abs(my) > 1e-4 && posOk(world, u, u.x, ny, 0, my)) { u.y = ny; return true; }
  return false;
}

function followPath(world: World, u: Unit) {
  if (!u.path) {
    u.moving = false;
    u.speedFrac = Math.max(0, u.speedFrac - DT * 4);
    return;
  }
  let wp = u.path[u.pathIdx];
  let dx = wp.x - u.x, dy = wp.y - u.y;
  let d = Math.hypot(dx, dy);
  const isLast = () => u.pathIdx === u.path!.length - 1;
  const reach = isLast() ? 0.08 : u.kind === 'infantry' ? 0.3 : 0.45;
  if (d < reach) {
    u.pathIdx++;
    if (u.pathIdx >= u.path.length) {
      u.path = null;
      u.hasGoal = false;
      u.moving = false;
      return;
    }
    wp = u.path[u.pathIdx];
    dx = wp.x - u.x; dy = wp.y - u.y; d = Math.hypot(dx, dy);
  }
  const desired = Math.atan2(dy, dx);
  const speed = u.speedCap > 0 ? Math.min(unitSpeed(u), u.speedCap) : unitSpeed(u);
  let step: number;
  let dirX: number, dirY: number;
  if (u.kind === 'infantry') {
    u.heading = turnTowards(u.heading, desired, 14 * DT);
    dirX = dx / d; dirY = dy / d;
    step = speed * DT;
  } else {
    u.heading = turnTowards(u.heading, desired, rotToRadPerSecond(u.ut.rot) * DT);
    const diff = Math.abs(angleDiff(u.heading, desired));
    let f: number;
    if (u.ut.tracked) f = diff > 0.8 ? 0 : Math.cos(diff);
    else f = diff > 1.3 ? 0.15 : Math.max(0.3, Math.cos(diff));
    // ease in/out of speed for weight
    const target = f;
    u.speedFrac += Math.max(-DT * 5, Math.min(DT * 3, target - u.speedFrac));
    step = speed * Math.max(0, u.speedFrac) * DT;
    dirX = Math.cos(u.heading); dirY = Math.sin(u.heading);
  }
  if (isLast()) step = Math.min(step, d);
  const ok = step > 0 ? tryMove(world, u, dirX * step, dirY * step) : true;
  u.moving = step > 1e-4 && ok;
  if (u.kind === 'infantry') u.speedFrac = u.moving ? 1 : 0;

  if (u.moving && u.ut.crusher) crush(world, u);

  // progress / stuck detection
  u.progressTimer += DT;
  if (u.progressTimer >= 1) {
    u.progressTimer = 0;
    const gd = Math.hypot(u.goalX - u.x, u.goalY - u.y);
    if (gd > u.progressDist - 0.2) {
      u.stuckCount++;
      if (u.stuckCount >= 5 || (u.stuckCount >= 3 && gd < 2.5)) {
        u.path = null;
        u.hasGoal = false;
        u.stuckCount = 0;
        return;
      }
      if (u.stuckCount >= 2) world.requestPath(u, u.goalX, u.goalY);
    } else {
      u.stuckCount = 0;
    }
    u.progressDist = gd;
  }
}

function crush(world: World, u: Unit) {
  world.grid.query(u.x, u.y, 0.6, (o) => {
    if (!o.alive || !o.ut.crushable || !u.owner.isEnemy(o.owner)) return;
    if (Math.hypot(o.x - u.x, o.y - u.y) < u.ut.radius * 0.75) {
      world.sfx('crush', o.x, o.y);
      world.kill(o, 'crushed', u);
    }
  });
}

/** Push overlapping ground units apart. Idle units make way for moving ones. */
export function resolveCollisions(world: World) {
  const units = world.units;
  for (const u of units) {
    if (!u.alive || u.kind === 'aircraft') continue;
    world.grid.query(u.x, u.y, 0.9, (o) => {
      if (o.id <= u.id || !o.alive || o.kind === 'aircraft') return;
      const minD = (u.ut.radius + o.ut.radius) * 0.92;
      let dx = o.x - u.x, dy = o.y - u.y;
      let d2 = dx * dx + dy * dy;
      if (d2 >= minD * minD) return;
      if (d2 < 1e-6) { dx = ((u.id * 7) % 11) / 11 - 0.5; dy = ((o.id * 5) % 13) / 13 - 0.5; d2 = dx * dx + dy * dy; }
      const d = Math.sqrt(d2);
      const overlap = minD - d;
      const nx = dx / d, ny = dy / d;
      let wu = 0.5, wo = 0.5;
      if (u.moving !== o.moving) { wu = u.moving ? 0.2 : 0.8; wo = 1 - wu; }
      if (u.kind === 'infantry' && o.kind !== 'infantry') { wu = 0.85; wo = 0.15; }
      else if (o.kind === 'infantry' && u.kind !== 'infantry') { wu = 0.15; wo = 0.85; }
      const push = Math.min(overlap, 0.08) * 0.6;
      pushUnit(world, u, -nx * push * wu * 2, -ny * push * wu * 2);
      pushUnit(world, o, nx * push * wo * 2, ny * push * wo * 2);
    });
  }
}

function pushUnit(world: World, u: Unit, mx: number, my: number) {
  if (u.order.type === 'harvest' && u.hstate === 'unloading') return;
  const nx = u.x + mx, ny = u.y + my;
  if (cellOk(world, u, nx, ny) && cornerOk(world, u, nx, ny)) { u.x = nx; u.y = ny; }
  else if (cellOk(world, u, nx, u.y)) u.x = nx;
  else if (cellOk(world, u, u.x, ny)) u.y = ny;
}

export { BUILDINGS };
