/**
 * Naval warfare (RA VESSEL.CPP / VDATA.CPP): ships move on open water only, shipyards and sub pens stand on
 * water next to the base, submarines submerge (cloak) and surface to fire, gunboats / destroyers detect
 * them, transports (LST) ferry ground units from beach to beach.
 *
 * Targeting rules follow VesselClass::Can_Fire:
 *  - torpedoes (UnderWater bullets) only hit sea targets: ships and naval structures, never submarines;
 *  - depth charges (ASW bullets) only engage submarines (submerged ones too) and naval structures;
 *  - a ship's other guns / missiles never engage submarines; land and air weapons hit surfaced subs only.
 *
 * Everything here is driven by small hooks in world / unitlogic / combat / production / ai.
 */
import type { BuildingTypeDef, WeaponDef } from '../data/rules';
import { Building, Unit, type Entity } from './entities';
import { WATER_LEVEL, type GameMap } from './map';
import type { Projectile } from './combat';
import type { Player } from './player';
import { DT, TICK_HZ } from './types';
import type { World } from './world';

/** Seconds a submarine needs to surface before its first torpedo. */
export const SURFACE_TIME = 0.6;
/** Seconds a submarine stays surfaced after its last shot before it dives again (RA SubmergeDelay). */
export const SUBMERGE_DELAY = 3;
/** Default sonar pulse length (RA forces subs up for 15 s). */
export const SONAR_SECONDS = 15;
/** Largest `sensors` range of any unit type (grid query radius). */
const SENSOR_QUERY = 3.5;
/** Passengers land on (and board from) shore cells within this distance of the transport's centre. */
const LAND_DIST = 2.3;
/** Ground units board a transport from this close (centre to centre: standing on a landing cell). */
const BOARD_DIST = LAND_DIST + 0.15;

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export const isNaval = (e: Entity | null | undefined): e is Unit => e instanceof Unit && e.kind === 'naval';
/** Submarines (RA Cloakable vessels). */
export const isSub = (e: Entity | null | undefined): e is Unit => e instanceof Unit && e.kind === 'naval' && !!e.ut.cloakable;
/** Ships and structures standing on water (RA "sea target": vessels + floating buildings). */
export function isSeaTarget(e: Entity): boolean {
  if (e instanceof Building) return !!e.bt.water;
  return e instanceof Unit && e.kind === 'naval';
}

// ---------------------------------------------------------------------------
// Combat rules
// ---------------------------------------------------------------------------

/** weaponCanHit hook: naval targeting restrictions (see file header). */
export function navalWeaponOk(w: WeaponDef, attacker: Entity, t: Entity): boolean {
  if (w.projectile === 'torpedo') return isSeaTarget(t) && !isSub(t);
  if (w.projectile === 'depthcharge') return isSub(t) || (t instanceof Building && !!t.bt.water);
  if (isSub(t)) {
    if (isNaval(attacker)) return false;
    return !t.submerged;
  }
  return true;
}

/**
 * impact hook: whether a blast of weapon `w` damages `v`. Underwater weapons only hurt things in the water;
 * a submerged submarine is only hurt by underwater weapons.
 */
export function navalImpactOk(w: WeaponDef, v: Entity): boolean {
  if (w.projectile === 'torpedo' || w.projectile === 'depthcharge') return isSeaTarget(v);
  return !(v instanceof Unit && v.submerged);
}

/**
 * Called right before a naval unit fires. Submarines surface first (and dive again SUBMERGE_DELAY seconds
 * after the last shot); vessels without a turret can't fire on the move (RA FIRE_MOVING).
 */
export function navalReadyToFire(u: Unit): boolean {
  if (!u.ut.turret && u.moving) return false;
  if (!u.ut.cloakable) return true;
  if (u.submerged) {
    surface(u);
    return false;
  }
  if (u.surfacing > 0) return false;
  u.diveTimer = SUBMERGE_DELAY;
  return true;
}

function surface(u: Unit) {
  u.submerged = false;
  u.cloaked = false;
  u.surfacing = SURFACE_TIME;
  u.diveTimer = SUBMERGE_DELAY + SURFACE_TIME;
}

/** Torpedo / depth charge flight setup (doShot hook). */
export function initNavalProjectile(p: Projectile, target: Entity | null, dist: number) {
  if (p.kind === 'torpedo') {
    // runs just under the surface, homing on the ship
    p.target = target;
    p.speed = 4;
    p.z = p.sz = p.prevZ = p.tz = WATER_LEVEL - 0.06;
  } else {
    // rolled / thrown over the side, sinks onto the submarine
    p.dur = 0.45 + dist * 0.12;
    p.arc = 0.5 + dist * 0.12;
    p.tz = WATER_LEVEL - 0.25;
  }
}

/** Per-tick torpedo movement (updateProjectiles hook). Torpedoes run aground on land. */
export function stepTorpedo(world: World, p: Projectile) {
  const m = world.map;
  const dx = p.tx - p.x, dy = p.ty - p.y;
  const d = Math.hypot(dx, dy);
  const step = p.speed * DT;
  p.t += DT;
  p.z = WATER_LEVEL - 0.06;
  if (d <= step || p.t > 6) {
    p.x = p.tx;
    p.y = p.ty;
    p.alive = false;
    return;
  }
  const nx = p.x + (dx / d) * step, ny = p.y + (dy / d) * step;
  const cx = Math.floor(nx), cy = Math.floor(ny);
  if (m.inBounds(cx, cy) && !m.navalTerrain(m.idx(cx, cy))) {
    // hit the shore: explode there (harmless to anything on land)
    p.target = null;
    p.alive = false;
  }
  p.x = nx;
  p.y = ny;
}

/** Sound of a shell landing in open water (impact hook). */
export function navalSplash(world: World, w: WeaponDef, direct: Entity | null, x: number, y: number) {
  if (w.projectile === 'bullet' || w.projectile === 'tesla' || w.projectile === 'melee' || w.projectile === 'heal' || w.projectile === 'flame') return;
  if (direct && isSeaTarget(direct)) return;
  const m = world.map;
  const cx = Math.floor(x), cy = Math.floor(y);
  if (!m.inBounds(cx, cy)) return;
  const i = m.idx(cx, cy);
  if (m.navalTerrain(i) && !m.occupant[i]) world.sfx('water_splash', x, y);
}

// ---------------------------------------------------------------------------
// Per-tick updates
// ---------------------------------------------------------------------------

/** Unit pre-update hook (before orders): ramp animation, submarine dive / surface timers. */
export function updateNavalUnit(u: Unit) {
  if (u.rampHold > 0) {
    u.rampHold = Math.max(0, u.rampHold - DT);
    u.ramp = Math.min(1, u.ramp + DT * 1.6);
  } else if (u.ramp > 0) {
    u.ramp = Math.max(0, u.ramp - DT * 1.2);
  }
  if (!u.ut.cloakable) return;
  if (u.surfaceLock > 0) u.surfaceLock = Math.max(0, u.surfaceLock - DT);
  if (u.surfacing > 0) u.surfacing = Math.max(0, u.surfacing - DT);
  if (!u.submerged) {
    if (u.diveTimer > 0) u.diveTimer = Math.max(0, u.diveTimer - DT);
    else if (u.surfaceLock <= 0 && !u.weapons.some((s) => s.burstLeft > 0)) u.submerged = true;
  }
  u.cloaked = u.submerged;
}

/** Bitmask of the player ids in a team. */
function teamMask(world: World, team: number): number {
  let m = 0;
  for (const p of world.players) if (p.team === team) m |= 1 << p.id;
  return m;
}

/**
 * World tick hook (after the unit grid is rebuilt): which players detect each submarine (enemy sensor ships
 * within range, or an active sonar pulse), and shipyards / sub pens repairing ships alongside.
 */
export function updateNaval(world: World) {
  const units = world.units;
  for (let k = 0; k < units.length; k++) {
    const u = units[k];
    if (u.kind === 'naval' && u.ut.cloakable && u.alive) detect(world, u);
  }
  if (world.tick % 10 === 0) {
    const bs = world.buildings;
    for (let k = 0; k < bs.length; k++) {
      const b = bs[k];
      if (b.bt.water && b.bt.factory === 'naval' && b.alive && b.active) repairAlongside(world, b);
    }
  }
}

/** Update `revealedTo` of a submarine; announce fresh detections of a submerged one. */
function detect(world: World, u: Unit) {
  let mask = 0;
  for (const p of world.players) if (p.sonarUntil > world.tick && p.isEnemy(u.owner)) mask |= teamMask(world, p.team);
  world.grid.query(u.x, u.y, SENSOR_QUERY, (o) => {
    const r = o.ut.sensors;
    if (!r || !o.alive || !o.owner.isEnemy(u.owner)) return;
    if (Math.hypot(o.x - u.x, o.y - u.y) <= r) mask |= teamMask(world, o.owner.team);
  });
  const fresh = mask & ~u.revealedTo;
  if (fresh && u.cloaked) {
    for (const p of world.players) if (fresh & (1 << p.id)) world.announce(p, 'sub_detected', 12);
  }
  u.revealedTo = mask;
}

/** Naval yards repair idle own ships moored next to them (like the service depot, 20% of cost for a full repair). */
function repairAlongside(world: World, b: Building) {
  world.grid.query(b.x, b.y, 3.2, (u) => {
    if (!u.alive || u.owner !== b.owner || u.kind !== 'naval' || u.moving || u.hp >= u.maxHp) return;
    if (b.distTo(u.x, u.y) > 1.3) return;
    const step = Math.max(1, Math.round(u.maxHp * 0.05));
    const cost = (u.ut.cost * 0.2 * step) / u.maxHp;
    if (b.owner.spend(cost)) {
      u.hp = Math.min(u.maxHp, u.hp + step);
      world.sfx('repair', u.x, u.y);
    }
  });
}

/**
 * Sonar pulse (A2's support power calls this through World.revealCloaked): every enemy submarine is forced to
 * surface for `seconds` (RA PulseCountDown) and is visible to the pulsing player's team even through fog.
 */
export function sonarPulse(world: World, p: Player, seconds = SONAR_SECONDS) {
  p.sonarUntil = Math.max(p.sonarUntil, world.tick + Math.round(seconds * TICK_HZ));
  for (const u of world.units) {
    if (!u.alive || !u.ut.cloakable || !p.isEnemy(u.owner)) continue;
    u.surfaceLock = Math.max(u.surfaceLock, seconds);
    if (u.submerged) surface(u);
  }
}

// ---------------------------------------------------------------------------
// Spawning & production
// ---------------------------------------------------------------------------

/** addUnit hook: ships always start on water (missions / crates may ask for a land spot), subs submerged. */
export function placeNaval(world: World, u: Unit) {
  if (u.ut.cloakable) {
    u.submerged = true;
    u.cloaked = true;
  }
  if (world.map.navalPassable(Math.floor(u.x), Math.floor(u.y))) return;
  const [x, y] = world.findFreeSpot(u.x, u.y, 16, true, true);
  u.x = u.prevX = u.guardX = x;
  u.y = u.prevY = u.guardY = y;
}

/** Placement hook: a naval yard needs open water alongside (at least 3 cells) to launch its ships. */
export function navalLaunchOk(m: GameMap, bt: BuildingTypeDef, cx: number, cy: number): boolean {
  let n = 0;
  for (let y = cy - 1; y <= cy + bt.size[1]; y++) for (let x = cx - 1; x <= cx + bt.size[0]; x++) {
    if (x >= cx && x < cx + bt.size[0] && y >= cy && y < cy + bt.size[1]) continue;
    if (m.navalPassable(x, y)) n++;
  }
  return n >= 3;
}

/** A free water cell next to a naval yard to launch a new ship into (closest to the rally point). */
export function launchCell(world: World, f: Building): [number, number] | null {
  const m = world.map;
  const tx = f.rallyX >= 0 ? f.rallyX : f.x, ty = f.rallyX >= 0 ? f.rallyY : f.cy + f.h + 1;
  let best: [number, number] | null = null, bestScore = Infinity;
  for (let ring = 1; ring <= 3 && !best; ring++) {
    for (let y = f.cy - ring; y < f.cy + f.h + ring; y++) for (let x = f.cx - ring; x < f.cx + f.w + ring; x++) {
      const gx = Math.max(f.cx - x, 0, x - (f.cx + f.w - 1)), gy = Math.max(f.cy - y, 0, y - (f.cy + f.h - 1));
      if (Math.max(gx, gy) !== ring || !m.navalPassable(x, y)) continue;
      let crowd = 0;
      world.grid.query(x + 0.5, y + 0.5, 0.8, (u) => { if (u.alive && Math.floor(u.x) === x && Math.floor(u.y) === y) crowd++; });
      if (crowd) continue;
      // open water around the cell keeps the launch lane clear
      let open = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (m.navalPassable(x + dx, y + dy)) open++;
      const score = Math.hypot(x + 0.5 - tx, y + 0.5 - ty) - open * 0.4;
      if (score < bestScore) { bestScore = score; best = [x + 0.5, y + 0.5]; }
    }
  }
  return best;
}

/** spawnProduced hook: a finished vessel is launched next to the yard and sails to the rally point. */
export function spawnNaval(world: World, p: Player, f: Building, typeId: string): Unit | null {
  const cell = launchCell(world, f);
  if (!cell) return null;
  const u = world.addUnit(typeId, p, cell[0], cell[1]);
  const away = Math.atan2(cell[1] - f.y, cell[0] - f.x);
  u.heading = u.prevHeading = u.turret = u.prevTurret = away;
  world.sfx('ship_horn', u.x, u.y);
  let rx = f.rallyX, ry = f.rallyY;
  if (rx < 0) [rx, ry] = world.findFreeSpot(cell[0] + Math.cos(away) * 2, cell[1] + Math.sin(away) * 2, 4, true, true);
  world.setOrder(u, { type: 'move', x: rx, y: ry, attackMove: false });
  return u;
}

// ---------------------------------------------------------------------------
// Transport (LST)
// ---------------------------------------------------------------------------

function finishOrder(world: World, u: Unit) {
  const next = u.orderQueue.shift();
  if (next) world.setOrder(u, next);
  else {
    world.setOrder(u, { type: 'idle' });
    u.guardX = u.x;
    u.guardY = u.y;
  }
}

/** Whether a ground unit may ride in this transport (LST: infantry and vehicles; APC / helicopters: infantry). */
export function canCarry(t: Unit, u: Unit): boolean {
  if (!t.ut.passengers || t.passengers.length >= t.ut.passengers || u === t) return false;
  if (u.kind === 'infantry') return true;
  return t.kind === 'naval' && u.kind === 'vehicle';
}

/** Ground cells the transport can land passengers on: passable land within LAND_DIST, nearest first. */
function landingCells(world: World, t: Unit): [number, number][] {
  const m = world.map;
  const fx = Math.floor(t.x), fy = Math.floor(t.y);
  const out: [number, number, number][] = [];
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const x = fx + dx, y = fy + dy;
    if (!m.passable(x, y)) continue;
    const d = Math.hypot(x + 0.5 - t.x, y + 0.5 - t.y);
    if (d <= LAND_DIST) out.push([x, y, d]);
  }
  out.sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0]);
  return out.map(([x, y]) => [x, y]);
}

/** Whether the transport is beached: next to land it can unload onto. */
export function atBeach(world: World, t: Unit): boolean {
  return landingCells(world, t).length > 0;
}

/** Land every passenger that fits next to the transport. Returns false if nobody could get off. */
export function unloadTransport(world: World, t: Unit): boolean {
  if (!t.passengers.length) return false;
  const cells = landingCells(world, t);
  if (!cells.length) return false;
  const m = world.map;
  const used = new Map<number, number>();
  const count = (x: number, y: number) => {
    const k = m.idx(x, y);
    let n = used.get(k);
    if (n === undefined) {
      n = 0;
      world.grid.query(x + 0.5, y + 0.5, 0.8, (u) => { if (u.alive && Math.floor(u.x) === x && Math.floor(u.y) === y) n!++; });
      used.set(k, n);
    }
    return n;
  };
  const left: Unit[] = [];
  let landed = 0;
  for (const p of t.passengers) {
    const inf = p.kind === 'infantry';
    const cell = cells.find(([x, y]) => (inf ? count(x, y) < 3 : count(x, y) === 0));
    if (!cell) { left.push(p); continue; }
    const [x, y] = cell;
    const n = count(x, y);
    used.set(m.idx(x, y), inf ? n + 1 : 9);
    const ox = inf ? [0.3, 0.7, 0.5][n] : 0.5, oy = inf ? [0.3, 0.3, 0.7][n] : 0.5;
    p.x = p.prevX = p.guardX = x + ox;
    p.y = p.prevY = p.guardY = y + oy;
    p.transport = 0;
    p.heading = p.prevHeading = p.turret = p.prevTurret = Math.atan2(p.y - t.y, p.x - t.x);
    world.setOrder(p, { type: 'idle' });
    world.units.push(p);
    landed++;
  }
  if (!landed) return false;
  t.passengers = left;
  t.rampHold = Math.max(t.rampHold, 2);
  world.sfx('door', t.x, t.y);
  return true;
}

/** Nearest beach (a water cell next to passable land) the transport can reach, by water BFS. */
function findBeach(world: World, t: Unit, maxNodes = 4000): [number, number] | null {
  const m = world.map;
  const start = m.idx(Math.floor(t.x), Math.floor(t.y));
  const seen = new Set<number>([start]);
  const q = [start];
  for (let h = 0; h < q.length && h < maxNodes; h++) {
    const i = q[h];
    const x = i % m.w, y = (i / m.w) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      if (m.passable(x + dx, y + dy) && i !== start) return [x + 0.5, y + 0.5];
    }
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if ((!dx && !dy) || !m.navalPassable(nx, ny)) continue;
      const j = m.idx(nx, ny);
      if (seen.has(j)) continue;
      seen.add(j);
      q.push(j);
    }
  }
  return null;
}

/** Deploy command on a vessel: a transport unloads now if beached, otherwise sails to the nearest beach first. */
export function navalDeploy(world: World, u: Unit) {
  if (!u.ut.passengers || !u.passengers.length) return;
  if (unloadTransport(world, u) && !u.passengers.length) return;
  world.setOrder(u, { type: 'deploy' });
}

/** 'deploy' order of a transport: head for the closest beach, unload there (gives up after one trip). */
export function navalDeployOrder(world: World, u: Unit) {
  if (!u.ut.passengers || !u.passengers.length) return finishOrder(world, u);
  if (u.path || u.pathPending) return;
  if (unloadTransport(world, u) && !u.passengers.length) return finishOrder(world, u);
  if (u.waitTimer > 0) {
    // already sailed to a beach and still can't land everybody
    world.announce(u.owner, 'cannot_deploy', 1);
    return finishOrder(world, u);
  }
  u.waitTimer = 1;
  const beach = findBeach(world, u);
  if (!beach) return;
  world.requestPath(u, beach[0], beach[1]);
}

/** The land cell next to transport `t` a passenger at (x, y) should walk to. */
function boardingCell(world: World, t: Unit, x: number, y: number): [number, number] | null {
  let best: [number, number] | null = null, bestScore = Infinity;
  for (const [cx, cy] of landingCells(world, t)) {
    const score = Math.hypot(cx + 0.5 - t.x, cy + 0.5 - t.y) * 2 + Math.hypot(cx + 0.5 - x, cy + 0.5 - y) * 0.15;
    if (score < bestScore) { bestScore = score; best = [cx + 0.5, cy + 0.5]; }
  }
  return best;
}

/** 'enter' order of a ground unit whose target is a vessel: walk to the shore next to the transport and board. */
export function enterVessel(world: World, u: Unit, t: Unit) {
  if (t.owner !== u.owner || !canCarry(t, u)) return finishOrder(world, u);
  if (Math.hypot(t.x - u.x, t.y - u.y) < BOARD_DIST) {
    if (world.board(u, t)) t.rampHold = Math.max(t.rampHold, 1.5);
    return;
  }
  if (u.pathPending) return;
  const goal = boardingCell(world, t, u.x, u.y);
  if (!goal) {
    // transport not at a beach yet: wait on the shore nearest to it
    if (!u.hasGoal && !u.path && world.tick % 40 === u.id % 40) world.requestPath(u, t.x, t.y);
    return;
  }
  if (!u.hasGoal || Math.hypot(goal[0] - u.goalX, goal[1] - u.goalY) > 0.6 || (!u.path && world.tick % 20 === u.id % 20)) {
    world.requestPath(u, goal[0], goal[1]);
  }
}
