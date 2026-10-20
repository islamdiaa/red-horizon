import {
  ARMOR_INDEX, WARHEADS, raTicksToSeconds, rotToRadPerSecond,
  type ExplosionKind, type ProjectileKind, type WarheadDef, type WeaponDef,
} from '../data/rules';
import { angleDiff, turnTowards } from '../core/util';
import { Building, Entity, Unit, WeaponSlot, distToEntity } from './entities';
import type { Player } from './player';
import { DT } from './types';
import type { World } from './world';
import { initNavalProjectile, navalImpactOk, navalReadyToFire, navalSplash, navalWeaponOk, stepTorpedo } from './naval';
import { autoTargetable } from './stealth';
import { ceasefireActive, mayAutoEngage } from './ceasefire';
import { damageBridgeAt, damageBridgesInRadius } from './bridges';
import { focusBias } from './orders';
import { healable } from './aftermath';
import { cmdArmor, cmdOffline, cmdRof } from './doctrine';

export interface Projectile {
  id: number;
  weapon: WeaponDef;
  owner: Player;
  shooter: number;
  kind: ProjectileKind;
  x: number; y: number; z: number;
  prevX: number; prevY: number; prevZ: number;
  sx: number; sy: number; sz: number;
  tx: number; ty: number; tz: number;
  target: Entity | null;
  t: number;
  dur: number;
  arc: number;
  speed: number;
  vx: number; vy: number;
  alive: boolean;
  /** Special payload (nuke). */
  special?: 'nuke';
}


/** Height (world Y offset above ground) shots are aimed at. */
export function aimHeight(e: Entity): number {
  if (e instanceof Building) return Math.min(1.0, 0.35 + e.h * 0.15);
  const u = e as Unit;
  if (u.kind === 'aircraft') return u.altitude + 0.1;
  return u.kind === 'infantry' ? 0.2 : 0.3;
}

export function muzzleHeight(e: Entity): number {
  if (e instanceof Building) {
    if (e.bt.id === 'tsla') return 2.0;
    if (e.bt.id === 'ftur') return 0.9;
    return 0.55;
  }
  const u = e as Unit;
  if (u.kind === 'aircraft') return u.altitude;
  return u.kind === 'infantry' ? 0.24 : 0.38;
}

/** Whether `w` can engage `t` at all (air/ground, special weapons). */
export function weaponCanHit(w: WeaponDef, attacker: Entity, t: Entity): boolean {
  const air = t instanceof Unit && t.isAir;
  if (air ? !w.antiAir : !w.antiGround) return false;
  if (!navalWeaponOk(w, attacker, t)) return false;
  if (w.warhead === 'Organic' && w.damage > 0) {
    // dog jaws: infantry only
    return t instanceof Unit && t.kind === 'infantry';
  }
  if (w.damage < 0) {
    // medic: infantry; mechanic (Mechanical warhead): vehicles (aftermath.ts)
    return t instanceof Unit && healable(w, t) && t.owner.team === attacker.owner.team && t.hp < t.maxHp;
  }
  return true;
}

/**
 * Choose the most effective weapon against a target, or null if none of the attacker's weapons can
 * hurt it at all (armour verses 0, or a wall and no wall-breaching warhead).
 */
export function pickWeapon(attacker: Entity, t: Entity): WeaponSlot | null {
  let best: WeaponSlot | null = null;
  let bestScore = -1;
  const armor = ARMOR_INDEX[t.type.armor];
  const wall = t instanceof Building && t.bt.wall;
  for (const s of attacker.weapons) {
    if (!weaponCanHit(s.def, attacker, t)) continue;
    const wh = WARHEADS[s.def.warhead];
    const mult = s.def.damage < 0 ? 1 : wall && !wh.wall ? 0 : wh.verses[armor];
    if (mult <= 0) continue;
    const score = (Math.abs(s.def.damage) * mult * s.def.burst) / Math.max(1, s.def.rof);
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return best;
}

export function maxRange(e: Entity): number {
  let r = 0;
  for (const s of e.weapons) r = Math.max(r, s.def.range);
  return r;
}

/** RA Modify_Damage: armour verses + distance falloff (distance in cells). */
export function modifyDamage(damage: number, wh: WarheadDef, armor: number, distCells: number): number {
  if (!damage) return 0;
  let dmg = damage * wh.verses[armor];
  if (dmg > 0) {
    const leptons = distCells * 256;
    // RA integer maths: PIXEL_LEPTON_W (10) / 4 = 2 for spread 0, SpreadFactor * (10 / 2) otherwise
    let div = wh.spread ? leptons / (wh.spread * 5) : leptons / 2;
    div = Math.min(16, Math.max(0, Math.floor(div)));
    if (div) dmg /= div;
    if (div < 4) dmg = Math.max(dmg, 1);
  }
  return Math.min(dmg, 1000);
}

/**
 * Find the best enemy target within `range` of the entity. Structures are only
 * considered within `buildingRange` (defaults to weapon range) so guarding units
 * don't wander off to plink at distant buildings.
 */
export function findTarget(world: World, e: Entity, range: number, buildingRange = maxRange(e)): Entity | null {
  let best: Entity | null = null;
  let bestScore = Infinity;
  const owner = e.owner;
  const truce = !owner.isHuman && ceasefireActive(world); // build-up time: the AI only engages intruders and attackers
  world.grid.query(e.x, e.y, range + 1, (u) => {
    if (!u.alive || u.hp <= 0 || !owner.isEnemy(u.owner)) return;
    const d = Math.hypot(u.x - e.x, u.y - e.y);
    if (d > range) return;
    if (!world.canSee(owner, u) || !autoTargetable(e, u)) return;
    if (truce && !mayAutoEngage(world, e, u)) return;
    const slot = pickWeapon(e, u);
    if (!slot) return;
    let score = d;
    if (u.weapons.length) score -= 2.5; // threats first
    if (u.ut.harvester) score += 1;
    // prefer targets our weapon is good against, and finish off the wounded (natural focus fire)
    score -= WARHEADS[slot.def.warhead].verses[ARMOR_INDEX[u.type.armor]] * 2;
    score -= (1 - u.healthFrac) * 2;
    score += focusBias(world, e, u, slot); // spread fire: avoid overkill, take the finishing shot
    if (score < bestScore) { bestScore = score; best = u; }
  });
  // structures (defences first)
  const ex = e.x, ey = e.y, far = buildingRange + 1e-6;
  for (const b of world.buildings) {
    // cheap reject first: the footprint is at least its larger axis gap away (every scanning unit walks the whole
    // structure list, so this test is most of what a big base costs; the result is the same)
    const size = b.bt.size;
    if (b.cx - ex > far || ex - (b.cx + size[0]) > far || b.cy - ey > far || ey - (b.cy + size[1]) > far) continue;
    if (!b.alive || !owner.isEnemy(b.owner) || b.buildAnim < 0.1 || b.bt.wall || b.bt.mine) continue;
    const d = b.distTo(ex, ey);
    if (d > buildingRange) continue;
    if (!pickWeapon(e, b)) continue;
    if (!world.canSee(owner, b)) continue;
    if (truce && !mayAutoEngage(world, e, b)) continue;
    const score = d + (b.weapons.length ? 0.5 : 4);
    if (score < bestScore) { bestScore = score; best = b; }
  }
  return best;
}

/** Find a wounded friendly infantry for a medic. */
export function findHealTarget(world: World, u: Unit, range: number): Unit | null {
  let best: Unit | null = null, bestD = Infinity;
  const heal = u.weapons[0]?.def;
  if (!heal) return null;
  world.grid.query(u.x, u.y, range + 1, (o) => {
    if (!o.alive || o === u || o.owner.team !== u.owner.team || !healable(heal, o) || o.hp >= o.maxHp || o.transport) return; // mechanics mend vehicles
    const d = Math.hypot(o.x - u.x, o.y - u.y);
    if (d < bestD && d <= range) { bestD = d; best = o; }
  });
  return best;
}

// ---------------------------------------------------------------------------
// Firing
// ---------------------------------------------------------------------------

function targetPoint(t: Entity, fromX: number, fromY: number): [number, number] {
  if (t instanceof Building) {
    // aim at the footprint centre, but not further than the near edge + 0.6
    const [px, py] = t.closestPoint(fromX, fromY);
    const dx = t.x - px, dy = t.y - py;
    const l = Math.hypot(dx, dy);
    if (l < 0.6) return [t.x, t.y];
    return [px + (dx / l) * 0.6, py + (dy / l) * 0.6];
  }
  return [t.x, t.y];
}

export function fire(world: World, shooter: Entity, slot: WeaponSlot, target: Entity | null, gx: number, gy: number) {
  const w = slot.def;
  if (shooter instanceof Unit && shooter.kind === 'aircraft') shooter.ammo = Math.max(0, shooter.ammo - 1);
  const twin = shooter instanceof Unit && shooter.ut.twinShot && shooter.weapons[0] === slot;
  const shots = w.burst * (twin ? 2 : 1);
  let rof = raTicksToSeconds(w.rof) * (1 - 0.1 * shooter.rank);
  if (shooter instanceof Building && shooter.owner.lowPower && !shooter.bt.requiresPower) rof *= 1.5;
  if (shooter.owner.cmd) rof *= cmdRof(shooter); // Rally Cry
  slot.cooldown = rof;
  slot.burstLeft = shots - 1;
  slot.burstTimer = w.projectile === 'missile' ? 0.22 : 0.16;
  doShot(world, shooter, slot, target, gx, gy);
}

function doShot(world: World, shooter: Entity, slot: WeaponSlot, target: Entity | null, gx: number, gy: number) {
  const w = slot.def;
  const map = world.map;
  shooter.lastFireTick = world.tick;
  shooter.lastFireMuzzle = (shooter.lastFireMuzzle + 1) % 2;
  let tx = gx, ty = gy;
  if (target) [tx, ty] = targetPoint(target, shooter.x, shooter.y);
  const fz = map.surfaceAt(shooter.x, shooter.y) + muzzleHeight(shooter);
  const tz = (target ? map.surfaceAt(target.x, target.y) + aimHeight(target) : map.surfaceAt(tx, ty) + 0.05);

  world.events.push({ e: 'fire', shooter: shooter.id, weapon: w, muzzle: shooter.lastFireMuzzle, fx: shooter.x, fy: shooter.y, fz, tx, ty, tz, target: target?.id });

  switch (w.projectile) {
    case 'bullet':
    case 'flak':
    case 'tesla':
    case 'flame':
    case 'melee':
    case 'heal': {
      if (w.projectile === 'melee' && shooter instanceof Unit && target) {
        // dog lunge
        shooter.x = target.x - Math.cos(shooter.heading) * 0.15;
        shooter.y = target.y - Math.sin(shooter.heading) * 0.15;
      }
      if (w.damage < 0) {
        if (target && target.alive) target.hp = Math.min(target.maxHp, target.hp - w.damage);
        return;
      }
      impact(world, w, shooter, target, tx, ty, tz);
      return;
    }
  }

  // physical projectile
  const d = Math.hypot(tx - shooter.x, ty - shooter.y);
  let ax = tx, ay = ty;
  if (w.inaccuracy) {
    const scatter = w.inaccuracy * Math.min(1, d / Math.max(1, w.range)) * Math.sqrt(world.rng.next());
    const a = world.rng.range(0, Math.PI * 2);
    ax += Math.cos(a) * scatter;
    ay += Math.sin(a) * scatter;
  }
  const p: Projectile = {
    id: world.nextProjectileId++, weapon: w, owner: shooter.owner, shooter: shooter.id, kind: w.projectile,
    x: shooter.x, y: shooter.y, z: fz, prevX: shooter.x, prevY: shooter.y, prevZ: fz,
    sx: shooter.x, sy: shooter.y, sz: fz, tx: ax, ty: ay, tz,
    target: w.projectile === 'cannon' || w.projectile === 'missile' || w.projectile === 'fireball' ? target : null,
    t: 0, dur: 1, arc: 0, speed: 0, vx: 0, vy: 0, alive: true,
  };
  switch (w.projectile) {
    case 'cannon': p.speed = 14; break;
    case 'fireball': p.speed = 7; break;
    case 'missile': {
      p.speed = 5;
      const a = shooter instanceof Unit ? (shooter.ut.turret ? shooter.turret : shooter.heading) : Math.atan2(ty - shooter.y, tx - shooter.x);
      const spread = (world.rng.next() - 0.5) * 0.5;
      p.vx = Math.cos(a + spread);
      p.vy = Math.sin(a + spread);
      break;
    }
    case 'ballistic': p.dur = 0.7 + d * 0.11; p.arc = 0.6 + d * 0.3; break;
    case 'lobbed': p.dur = 0.45 + d * 0.1; p.arc = 0.35 + d * 0.22; break;
    case 'scud': p.dur = 1.4 + d * 0.12; p.arc = 2 + d * 0.45; break;
    case 'torpedo': case 'depthcharge': initNavalProjectile(p, target, d); break;
  }
  world.projectiles.push(p);
}

/** Apply weapon impact at a point (direct target gets full damage). */
export function impact(world: World, w: WeaponDef, attacker: Entity | null, direct: Entity | null, x: number, y: number, z: number) {
  const wh = WARHEADS[w.warhead];
  const R = wh.spread ? Math.min(1.8, (wh.spread * 5 * 12) / 256 + 0.4) : 0.3;
  const hitAir = direct instanceof Unit && direct.isAir;

  const victims: [Entity, number][] = [];
  if (direct && direct.alive) victims.push([direct, 0]);
  if (!hitAir) {
    world.grid.query(x, y, R + 0.5, (u) => {
      if (!u.alive || u === direct || u.isAir) return;
      const d = Math.hypot(u.x - x, u.y - y);
      if (d <= R) victims.push([u, d]);
    });
    const cx = Math.floor(x), cy = Math.floor(y);
    const seen = new Set<number>();
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const qx = cx + dx, qy = cy + dy;
      if (!world.map.inBounds(qx, qy)) continue;
      const id = world.map.occupant[world.map.idx(qx, qy)];
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const b = world.entities.get(id);
      if (!b || !b.alive || b === direct) continue;
      const d = (b as Building).distTo(x, y);
      if (d <= R) victims.push([b, d]);
    }
  }
  const firepower = attacker ? 1 + 0.15 * attacker.rank : 1;
  for (const [v, d] of victims) {
    if (v instanceof Building && v.bt.wall && !wh.wall) continue; // only explosives breach walls
    if (!navalImpactOk(w, v)) continue; // torpedoes stay in the water, submerged subs only feel underwater blasts
    const dmg = modifyDamage(w.damage, wh, ARMOR_INDEX[v.type.armor], d) * firepower * (1 - 0.12 * v.rank);
    if (dmg > 0) damageEntity(world, v, dmg, attacker, wh.infDeath);
  }
  // explosives landing on a bridge deck wear it down (bridges.ts)
  if (wh.wall && world.bridges.length && !hitAir) damageBridgeAt(world, x, y, w.damage * firepower, attacker);

  // trees catch fire / get flattened by big explosions
  if (wh.wood && w.damage >= 60) {
    const cx = Math.floor(x), cy = Math.floor(y);
    if (world.map.inBounds(cx, cy)) {
      const i = world.map.idx(cx, cy);
      if (world.map.tree[i] && world.rng.chance(Math.min(0.6, w.damage / 400))) world.map.removeTree(i);
    }
  }

  navalSplash(world, w, direct, x, y);
  let kind: ExplosionKind = wh.explosion;
  let scale = 1;
  if (w.projectile === 'scud') { kind = 'huge'; scale = 1; }
  else if (wh.id === 'HE' && w.damage >= 140) kind = 'large';
  else if (w.projectile === 'bullet' && direct instanceof Building) kind = 'piff';
  if (kind !== 'none') {
    world.events.push({ e: 'impact', x, y, z, kind, scale, owner: attacker?.owner.id ?? -1 });
  }
}

export function damageEntity(world: World, e: Entity, dmg: number, attacker: Entity | null, how: 'normal' | 'blown' | 'burn' | 'electro' | 'bite' | 'crushed' = 'normal') {
  // hp <= 0 while alive: already lethally hit this tick, removed at the end of the combat phase
  if (!e.alive || e.invulnerable > 0 || e.hp <= 0) return;
  if (e.owner.cmd) dmg *= cmdArmor(e); // doctrine armour, Aegis Shield
  e.hp -= dmg;
  e.lastDamagedTick = world.tick;
  if (attacker) e.lastAttacker = attacker.id;
  const owner = e.owner;
  if (attacker && attacker.owner !== owner) {
    owner.lastAttackX = e.x;
    owner.lastAttackY = e.y;
    if (e instanceof Building) world.announce(owner, 'base_under_attack', 20);
    else if (e instanceof Unit && e.ut.harvester) world.announce(owner, 'harvester_under_attack', 20);
  }
  if (e.hp <= 0) {
    world.lethal(e, e instanceof Unit && e.kind === 'infantry' ? how : 'normal', attacker ?? undefined);
  } else if (e instanceof Building && e.repairing === false && !owner.isHuman && e.healthFrac < 0.6) {
    // AI auto-repair handled in AI
  }
}

// ---------------------------------------------------------------------------
// Per-tick weapon updates
// ---------------------------------------------------------------------------

function tickSlots(world: World, e: Entity) {
  for (const s of e.weapons) {
    if (s.cooldown > 0) s.cooldown -= DT;
    if (s.burstLeft > 0) {
      s.burstTimer -= DT;
      if (s.burstTimer <= 0) {
        s.burstLeft--;
        s.burstTimer = s.def.projectile === 'missile' ? 0.22 : 0.16;
        const t = e.target && e.target.alive ? e.target : null;
        if (t || e.hasGroundTarget) doShot(world, e, s, t, e.targetX, e.targetY);
      }
    }
  }
}

export function updateUnitWeapons(world: World, u: Unit) {
  if (!u.weapons.length) return;
  tickSlots(world, u);
  const t = u.target && !(u.target instanceof Unit && u.target.transport) ? u.target : null; // (a target that went into a transport or bunker is out of reach)
  let tx: number, ty: number;
  let slot: WeaponSlot | null;
  let dist: number;
  if (t && t.alive) {
    slot = pickWeapon(u, t);
    if (!slot) return;
    [tx, ty] = [t.x, t.y];
    dist = distToEntity(u.x, u.y, t);
  } else if (u.hasGroundTarget) {
    slot = u.weapons.find((s) => s.def.antiGround) ?? null;
    if (!slot) return;
    tx = u.targetX; ty = u.targetY;
    dist = Math.hypot(tx - u.x, ty - u.y);
  } else {
    // relax turret back to body heading
    if (u.ut.turret) u.turret = turnTowards(u.turret, u.heading, rotToRadPerSecond(u.ut.rot + 1) * DT);
    return;
  }
  const w = slot.def;
  const want = Math.atan2(ty - u.y, tx - u.x);
  if (u.ut.turret) {
    u.turret = turnTowards(u.turret, want, rotToRadPerSecond(u.ut.rot + 2) * 1.4 * DT);
  }
  if (dist > w.range + 0.05) return;
  if (w.minRange && dist < w.minRange) return;
  if (u.ut.noMovingFire && u.moving) return;
  let aligned: boolean;
  if (u.kind === 'aircraft') {
    if (u.ammo <= 0 || u.altitude < 0.8) return;
    aligned = Math.abs(angleDiff(u.heading, want)) < 0.4;
  } else if (u.ut.turret) {
    aligned = Math.abs(angleDiff(u.turret, want)) < 0.15;
  } else if (u.kind === 'infantry') {
    if (!u.moving) u.heading = turnTowards(u.heading, want, 12 * DT);
    aligned = Math.abs(angleDiff(u.heading, want)) < 0.3;
  } else {
    if (!u.moving) u.heading = turnTowards(u.heading, want, rotToRadPerSecond(u.ut.rot) * DT);
    aligned = Math.abs(angleDiff(u.heading, want)) < 0.12;
  }
  if (!u.ut.turret && u.kind === 'vehicle' && u.moving) return;
  if (u.kind === 'aircraft' && !u.target && !u.hasGroundTarget) return;
  if (aligned && slot.cooldown <= 0 && slot.burstLeft <= 0) {
    if (u.kind === 'naval' && !navalReadyToFire(u)) return; // subs surface first
    fire(world, u, slot, t && t.alive ? t : null, tx, ty);
  }
}

export function updateBuildingWeapons(world: World, b: Building) {
  if (!b.weapons.length || !b.active) return;
  tickSlots(world, b);
  const slot = b.weapons[0];
  const w = slot.def;
  if ((b.bt.requiresPower && b.owner.lowPower) || b.jammed || (b.owner.cmd && cmdOffline(b))) { // sabotaged
    b.charge = Math.max(0, b.charge - DT);
    b.target = null;
    return;
  }
  let t = b.target;
  if (t && (!t.alive || b.distTo(t.x, t.y) > w.range + 0.3 || !world.canSee(b.owner, t) || !b.owner.isEnemy(t.owner))) t = b.target = null;
  if (!t) {
    b.scanTimer -= 1;
    if (b.scanTimer <= 0) {
      b.scanTimer = 5;
      t = b.target = findTargetForBuilding(world, b, w.range);
    }
  }
  if (!t) {
    b.charge = Math.max(0, b.charge - DT * 0.5);
    b.charging = false;
    return;
  }
  const want = Math.atan2(t.y - b.y, t.x - b.x);
  let aligned = true;
  if (b.bt.turret) {
    b.turret = turnTowards(b.turret, want, 4 * DT);
    aligned = Math.abs(angleDiff(b.turret, want)) < 0.12;
  } else {
    b.turret = want;
  }
  if (w.charge) {
    if (slot.cooldown <= 0) {
      b.charging = true;
      b.charge += DT;
      if (b.charge >= raTicksToSeconds(w.charge)) {
        b.charge = 0;
        b.charging = false;
        fire(world, b, slot, t, t.x, t.y);
      }
    }
    return;
  }
  if (aligned && slot.cooldown <= 0 && slot.burstLeft <= 0) fire(world, b, slot, t, t.x, t.y);
}

function findTargetForBuilding(world: World, b: Building, range: number): Entity | null {
  let best: Entity | null = null, bestD = Infinity;
  world.grid.query(b.x, b.y, range + 2, (u) => {
    if (!u.alive || !b.owner.isEnemy(u.owner)) return;
    const d = b.distTo(u.x, u.y);
    if (d > range || d >= bestD) return;
    if (!pickWeapon(b, u) || !world.canSee(b.owner, u) || !autoTargetable(b, u)) return;
    bestD = d;
    best = u;
  });
  return best;
}

// ---------------------------------------------------------------------------
// Projectiles
// ---------------------------------------------------------------------------

export function updateProjectiles(world: World) {
  const map = world.map;
  for (const p of world.projectiles) {
    if (!p.alive) continue;
    p.prevX = p.x; p.prevY = p.y; p.prevZ = p.z;
    // track live targets
    if (p.target && p.target.alive) {
      const tp = targetPoint(p.target, p.sx, p.sy);
      p.tx = tp[0];
      p.ty = tp[1];
      p.tz = map.surfaceAt(p.target.x, p.target.y) + aimHeight(p.target);
    }
    switch (p.kind) {
      case 'torpedo':
        stepTorpedo(world, p);
        break;
      case 'cannon':
      case 'fireball': {
        const dx = p.tx - p.x, dy = p.ty - p.y, dz = p.tz - p.z;
        const d = Math.hypot(dx, dy, dz);
        const step = p.speed * DT;
        if (d <= step) { p.x = p.tx; p.y = p.ty; p.z = p.tz; p.alive = false; }
        else { p.x += (dx / d) * step; p.y += (dy / d) * step; p.z += (dz / d) * step; }
        break;
      }
      case 'missile': {
        p.speed = Math.min(13, p.speed + 22 * DT);
        const want = Math.atan2(p.ty - p.y, p.tx - p.x);
        const cur = Math.atan2(p.vy, p.vx);
        const a = turnTowards(cur, want, 7 * DT);
        p.vx = Math.cos(a); p.vy = Math.sin(a);
        p.x += p.vx * p.speed * DT;
        p.y += p.vy * p.speed * DT;
        const remain = Math.hypot(p.tx - p.x, p.ty - p.y);
        p.z += (p.tz + Math.min(0.6, remain * 0.15) - p.z) * Math.min(1, 6 * DT);
        p.t += DT;
        if (remain < 0.25 || p.t > 4) { p.alive = false; p.x = p.tx; p.y = p.ty; p.z = p.tz; }
        break;
      }
      default: {
        // ballistic arcs
        p.t += DT / p.dur;
        const t = Math.min(1, p.t);
        p.x = p.sx + (p.tx - p.sx) * t;
        p.y = p.sy + (p.ty - p.sy) * t;
        p.z = p.sz + (p.tz - p.sz) * t + p.arc * 4 * t * (1 - t);
        if (t >= 1) p.alive = false;
      }
    }
    if (!p.alive) {
      const shooter = world.entities.get(p.shooter) ?? null;
      if (p.special === 'nuke') {
        nukeImpact(world, p.owner, p.x, p.y);
        continue;
      }
      // a direct hit only counts if the tracked target is still where we landed
      let direct: Entity | null = null;
      if (p.target && p.target.alive && !(p.target instanceof Unit && p.target.transport) && distToEntity(p.x, p.y, p.target) < 0.5) direct = p.target; // (not one that got into a transport meanwhile)
      impact(world, p.weapon, shooter && shooter.alive ? shooter : null, direct, p.x, p.y, p.z);
    }
  }
  if (world.tick % 20 === 0 || world.projectiles.length > 300) {
    world.projectiles = world.projectiles.filter((p) => p.alive);
  }
}

export function nukeImpact(world: World, owner: Player, x: number, y: number) {
  world.events.push({ e: 'impact', x, y, z: world.map.heightAt(x, y), kind: 'nuke', scale: 1, owner: owner.id });
  const R = 4.5;
  const victims: Entity[] = [];
  world.grid.query(x, y, R + 1, (u) => { if (u.alive) victims.push(u); });
  for (const b of world.buildings) if (b.alive && b.distTo(x, y) < R) victims.push(b);
  for (const v of victims) {
    const d = distToEntity(x, y, v);
    if (d > R) continue;
    const fall = 1 - (d / R) * 0.75;
    const wh = WARHEADS.Nuke;
    const dmg = 1000 * wh.verses[ARMOR_INDEX[v.type.armor]] * fall + (v instanceof Building ? 0 : 200 * fall);
    damageEntity(world, v, dmg, null, 'burn');
  }
  if (world.bridges.length) damageBridgesInRadius(world, x, y, R, 1000);
  const m = world.map;
  for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
    const cx = Math.floor(x) + dx, cy = Math.floor(y) + dy;
    if (!m.inBounds(cx, cy) || dx * dx + dy * dy > 16) continue;
    const i = m.idx(cx, cy);
    m.removeTree(i);
    if (m.ore[i] > 0) m.setOre(i, Math.floor(m.ore[i] / 3));
  }
}
