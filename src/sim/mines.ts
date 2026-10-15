/**
 * Minelayers and land mines (RA UNIT.CPP UNIT_MINELAYER, Per_Cell_Process mine checks).
 *
 * - The minelayer (`mnly`, Ammo=5) lays the mine type of its side: Soviet houses AP mines (`minp`), everybody
 *   else AT mines (`minv`). 'deploy' lays one under it; the 'mine' command lays a small field (one mine per cell,
 *   nearest cells first, split between the selected minelayers). It re-arms on a Service Depot pad.
 * - Mines are 1x1 structures, cloaked from enemies (stealth.ts) and walkable by everybody. Friendly units
 *   ignore them; an enemy ground unit entering the cell sets one off:
 *     AT mine + vehicle: 1200 HE damage (RA AVMineDamage), infantry walk over AT mines safely;
 *     AP mine + infantry: 1000 HE damage (RA APMineDamage) to every infantryman within 0.75 cells;
 *     AP mine + vehicle: the vehicle clears it, taking 10 damage (RA).
 *   Gunfire and explosions can also destroy mines (force-fire the ground).
 */
import { ARMOR_INDEX, WARHEADS } from '../data/rules';
import { Building, Unit } from './entities';
import { damageEntity, modifyDamage } from './combat';
import type { Player } from './player';
import { DT, type Order } from './types';
import type { World } from './world';
import { T } from './map';

export const AV_MINE_DAMAGE = 1200;
export const AP_MINE_DAMAGE = 1000;
/** RA: AP mine blast hits infantry within 0xC0 leptons. */
const AP_RADIUS = 0.75;
/** Seconds the minelayer spends dropping one mine. */
const LAY_SECONDS = 0.8;
/** Seconds per mine re-armed on a service depot pad. */
const REARM_SECONDS = 1;

export function mineTypeFor(p: Player): 'minp' | 'minv' {
  return p.faction === 'soviet' ? 'minp' : 'minv';
}

/** A mine can go into this cell: open land (or a bridge), nothing built there. */
export function mineable(world: World, cx: number, cy: number): boolean {
  const m = world.map;
  if (!m.inBounds(cx, cy)) return false;
  const i = m.idx(cx, cy);
  if (m.terrain[i] === T.Water || m.terrain[i] === T.Rock || m.tree[i]) return false;
  return m.occupant[i] === 0;
}

/** Put a mine of p's type into cell (cx, cy). */
export function layMine(world: World, p: Player, cx: number, cy: number): Building | null {
  if (!mineable(world, cx, cy)) return null;
  // not under an enemy's wheels (mines go off when a unit drives *into* the cell)
  let blocked = false;
  world.grid.query(cx + 0.5, cy + 0.5, 0.8, (u) => {
    if (u.alive && !u.isAir && u.owner.isEnemy(p) && Math.floor(u.x) === cx && Math.floor(u.y) === cy) blocked = true;
  });
  if (blocked) return null;
  const b = world.addBuilding(mineTypeFor(p), p, cx, cy, true);
  b.cloaked = true;
  world.sfx('deploy', b.x, b.y);
  return b;
}

/** 'deploy' on a minelayer: one mine right here. */
export function deployMinelayer(world: World, u: Unit) {
  world.giveOrder(u, { type: 'layMines', cells: [world.map.idx(Math.floor(u.x), Math.floor(u.y))] });
}

/** The 'mine' command: a small field around (x, y) shared between the minelayers. */
export function orderMinefield(world: World, units: Unit[], x: number, y: number) {
  const layers = units.filter((u) => u.ut.minelayer);
  if (!layers.length) return;
  const total = Math.max(5, layers.reduce((s, u) => s + Math.max(0, u.ammo), 0));
  const m = world.map;
  const cells: number[] = [];
  const fx = Math.floor(x), fy = Math.floor(y);
  // spiral outwards: the target cell, its neighbours, ...
  for (let r = 0; r <= 4 && cells.length < total; r++) {
    const ring: [number, number, number][] = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      if (mineable(world, fx + dx, fy + dy)) ring.push([dx * dx + dy * dy, fx + dx, fy + dy]);
    }
    ring.sort((a, b) => a[0] - b[0] || a[2] - b[2] || a[1] - b[1]);
    for (const [, cx, cy] of ring) if (cells.length < total) cells.push(m.idx(cx, cy));
  }
  if (!cells.length) return;
  layers.forEach((u, k) => {
    const mine: number[] = [];
    for (let j = k; j < cells.length; j += layers.length) mine.push(cells[j]);
    if (!mine.length) return;
    // nearest-first tour from where the minelayer stands
    const tour: number[] = [];
    let px = u.x, py = u.y;
    while (mine.length) {
      let bi = 0, bd = Infinity;
      for (let j = 0; j < mine.length; j++) {
        const cx = mine[j] % m.w + 0.5, cy = Math.floor(mine[j] / m.w) + 0.5;
        const d = (cx - px) ** 2 + (cy - py) ** 2;
        if (d < bd) { bd = d; bi = j; }
      }
      const c = mine.splice(bi, 1)[0];
      tour.push(c);
      px = c % m.w + 0.5;
      py = Math.floor(c / m.w) + 0.5;
    }
    world.giveOrder(u, { type: 'layMines', cells: tour, field: true });
  });
}

/** Per-tick behaviour of a minelayer with a 'layMines' order (unitlogic hook). */
export function updateLayMines(world: World, u: Unit, o: Extract<Order, { type: 'layMines' }>) {
  const m = world.map;
  while (o.cells.length) {
    const c = o.cells[0];
    if (mineable(world, c % m.w, Math.floor(c / m.w))) break;
    o.cells.shift();
  }
  if (!o.cells.length) {
    // a minefield ('mine' command) finished
    if (o.field) world.announce(u.owner, 'mines_laid', 4);
    done(world, u);
    return;
  }
  if (u.ammo <= 0) {
    // out of mines with cells left: go and re-arm if there is a depot, otherwise stop
    const depot = nearestDepot(world, u);
    if (depot) world.setOrder(u, { type: 'enter', target: depot.id });
    else done(world, u);
    return;
  }
  const c = o.cells[0];
  const cx = c % m.w, cy = Math.floor(c / m.w);
  const px = cx + 0.5, py = cy + 0.5;
  const d = Math.hypot(px - u.x, py - u.y);
  if (Math.floor(u.x) === cx && Math.floor(u.y) === cy && d < 0.4) {
    u.path = null;
    u.hasGoal = false;
    u.pathPending = false;
    u.waitTimer += DT;
    if (u.waitTimer >= LAY_SECONDS) {
      u.waitTimer = 0;
      if (layMine(world, u.owner, cx, cy)) u.ammo--;
      o.cells.shift();
      o.tries = 0;
    }
    return;
  }
  u.waitTimer = 0;
  if (!u.path && !u.pathPending) {
    // unreachable cells are skipped after a few attempts
    if ((o.tries ?? 0) > 6) { o.cells.shift(); o.tries = 0; return; }
    if (!u.hasGoal || world.tick % 10 === 0) {
      o.tries = (o.tries ?? 0) + 1;
      world.requestPath(u, px, py);
    }
  }
}

function done(world: World, u: Unit) {
  const next = u.orderQueue.shift();
  if (next) world.setOrder(u, next);
  else {
    world.setOrder(u, { type: 'idle' });
    u.guardX = u.x;
    u.guardY = u.y;
  }
}

function nearestDepot(world: World, u: Unit): Building | null {
  let best: Building | null = null, bd = Infinity;
  for (const b of world.buildings) {
    if (!b.alive || b.owner !== u.owner || !b.bt.repairPad || !b.active) continue;
    const d = Math.hypot(b.x - u.x, b.y - u.y);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

/** Minelayers parked on their own Service Depot pad get their mines back (every 10 ticks). */
export function updateRearm(world: World) {
  if (world.tick % 10 !== 0) return;
  for (const u of world.units) {
    if (!u.alive || !u.ut.minelayer || u.moving || u.ammo >= (u.ut.ammo ?? 0)) continue;
    const id = world.map.occupant[world.map.idx(Math.floor(u.x), Math.floor(u.y))];
    if (!id) { u.harvestTimer = 0; continue; }
    const b = world.entities.get(id);
    if (!(b instanceof Building) || !b.bt.repairPad || b.owner !== u.owner || !b.active) continue;
    // (harvestTimer is free on a minelayer: it times the re-arming)
    u.harvestTimer += DT * 10;
    if (u.harvestTimer >= REARM_SECONDS) {
      u.harvestTimer = 0;
      u.ammo++;
      world.sfx('repair', u.x, u.y);
    }
  }
}

/** Enemy ground units entering a mined cell set the mine off (every tick, after movement). */
export function updateMines(world: World) {
  for (const b of world.buildings) {
    if (!b.alive || !b.bt.mine) continue;
    let victim: Unit | null = null;
    world.grid.query(b.x, b.y, 0.8, (u) => {
      if (victim || !u.alive || u.kind === 'aircraft' || u.kind === 'naval' || u.parachute > 0 || u.transport) return;
      if (Math.floor(u.x) !== b.cx || Math.floor(u.y) !== b.cy || !u.owner.isEnemy(b.owner)) return;
      if (u.kind === 'infantry' && b.bt.mine === 'at') return; // AT mines don't go off under a man's weight
      victim = u;
    });
    if (victim) detonate(world, b, victim);
  }
}

function detonate(world: World, mine: Building, victim: Unit) {
  const he = WARHEADS.HE;
  const ap = mine.bt.mine === 'ap';
  world.events.push({ e: 'impact', x: mine.x, y: mine.y, z: world.map.surfaceAt(mine.x, mine.y), kind: ap ? 'medium' : 'large', scale: 1, owner: mine.owner.id });
  if (victim.kind !== 'infantry') {
    // vehicles: full AT blast, or they just crush an AP mine
    const dmg = ap ? 10 : modifyDamage(AV_MINE_DAMAGE, he, ARMOR_INDEX[victim.ut.armor], 0);
    damageEntity(world, victim, dmg, mine, 'blown');
  } else {
    const hits: Unit[] = [];
    world.grid.query(mine.x, mine.y, AP_RADIUS + 0.5, (u) => {
      if (u.alive && u.kind === 'infantry' && u.parachute <= 0 && !u.transport && Math.hypot(u.x - mine.x, u.y - mine.y) <= AP_RADIUS) hits.push(u);
    });
    if (!hits.includes(victim)) hits.push(victim);
    for (const u of hits) damageEntity(world, u, modifyDamage(AP_MINE_DAMAGE, he, ARMOR_INDEX[u.ut.armor], 0), mine, 'blown');
  }
  world.kill(mine, 'sold');
}

/** Every mine on the map (renderer / tests convenience). */
export function allMines(world: World): Building[] {
  return world.buildings.filter((b) => b.alive && !!b.bt.mine);
}

