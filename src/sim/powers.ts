/**
 * Support powers (RA "special weapons" besides the three superweapons): GPS satellite, sonar pulse,
 * spy plane, paratroopers and parabombs. Charging / readiness lives in superweapons.ts; this module
 * fires them, flies the support aircraft (Badger `badr`, spy plane `u2`) and handles parachutes.
 *
 * RA sources: HOUSE.CPP Place_Special_Blast / Special_Weapon_AI, AIRCRAFT.CPP Fire_At (U2 camera =
 * Sight_From radius 9, Badger paradrops its passengers), RULES.CPP (SonarTime, PulseCountDown 15 s).
 */
import { WEAPONS, mphToCellsPerSecond } from '../data/rules';
import { Building, Unit } from './entities';
import type { Projectile } from './combat';
import type { Player } from './player';
import { DT } from './types';
import { recalcPlayerEconomy } from './production';
import type { World } from './world';
import type { SuperKind } from './superweapons';

type SupportKind = 'gps' | 'sonar' | 'spyplane' | 'paratroopers' | 'parabombs';

/** Seconds a paratrooper hangs under its parachute. */
export const PARACHUTE_SECONDS = 3;
/** Spy plane photo: radius (RA U2 camera Sight_From 9) and how long the area stays visible. */
export const SPYPLANE_RADIUS = 9;
export const SPYPLANE_SECONDS = 15;
/** Sonar pulse: enemy submarines forced up and shown for this long (RA PulseCountDown = 15 s; naval.ts does it). */
export const SONAR_SECONDS = 15;
/** GPS launch: full-map visibility snapshot (records every structure as a fog ghost); the shroud stays off for good. */
export const GPS_SNAPSHOT_SECONDS = 3;
/** Badger payloads: RA Badger Passengers=5 riflemen; a parabomb run drops a line of bombs. */
export const PARATROOPERS = 5;
export const PARABOMBS = 7;
const PLANE_ALT = 2.3;

export function isSupportPower(kind: SuperKind): kind is SupportKind {
  return kind === 'gps' || kind === 'sonar' || kind === 'spyplane' || kind === 'paratroopers' || kind === 'parabombs';
}

/** Discharge and use a ready support power (readiness already checked by fireSuperweapon / auto-launch). */
export function firePower(world: World, p: Player, kind: SupportKind, x: number, y: number) {
  switch (kind) {
    case 'gps': {
      p.superCharge.gps = 0;
      p.superAnnounced.gps = false;
      p.gps = true;
      p.gpsPulse = GPS_SNAPSHOT_SECONDS;
      p.explored.fill(1);
      const src = sourceOf(world, p, 'atek');
      world.events.push({ e: 'power', kind: 'gps', player: p.id, x: src?.x ?? -1, y: src?.y ?? -1 });
      world.sfx('satellite_launch', src?.x ?? -1, src?.y ?? -1);
      world.announce(p, 'gps_launched', 0);
      // radar can't be jammed any more
      recalcPlayerEconomy(world, p);
      break;
    }
    case 'sonar': {
      if (p.sonarCharges <= 0) return;
      p.sonarCharges--;
      p.superCharge.sonar = p.sonarCharges > 0 ? 1 : 0;
      // RA: every enemy submarine is forced to surface (Do_Uncloak) and shown (naval.ts sonarPulse)
      world.revealCloaked(p, SONAR_SECONDS);
      world.events.push({ e: 'power', kind: 'sonar', player: p.id, x: -1, y: -1 });
      world.sfx('sonar_ping', -1, -1);
      break;
    }
    case 'spyplane':
    case 'paratroopers':
    case 'parabombs': {
      p.superCharge[kind] = 0;
      p.superAnnounced[kind] = false;
      launchSortie(world, p, kind, x, y);
      break;
    }
  }
}

function sourceOf(world: World, p: Player, id: string): Building | null {
  for (const b of world.buildings) if (b.alive && b.owner === p && b.bt.id === id) return b;
  return null;
}

/**
 * Send a support aircraft at (tx, ty): it enters at the map edge behind the owner's airfield (so it crosses
 * friendly air space first), flies straight over the target and leaves at the opposite edge.
 */
export function launchSortie(world: World, p: Player, kind: 'spyplane' | 'paratroopers' | 'parabombs', tx: number, ty: number): Unit {
  const { sx, sy, dx, dy, exit } = sortieRoute(world, p, tx, ty);
  const u = world.addUnit(kind === 'spyplane' ? 'u2' : 'badr', p, sx, sy);
  u.altitude = PLANE_ALT;
  u.heading = u.prevHeading = Math.atan2(dy, dx);
  u.ammo = 0;
  u.sortie = { kind, tx, ty, dx, dy, exit, drops: 0, warned: false };
  world.sfx('plane_flyby', sx, sy);
  return u;
}

/** Flight line of a support aircraft sent at (tx, ty): entry point, direction and exit distance past the target. */
export function sortieRoute(world: World, p: Player, tx: number, ty: number) {
  const m = world.map;
  const src = sourceOf(world, p, 'afld');
  let ox = src ? src.x : m.w / 2, oy = src ? src.y : m.h / 2;
  if (Math.hypot(tx - ox, ty - oy) < 1) { ox = m.w / 2; oy = m.h / 2; }
  let dx = tx - ox, dy = ty - oy;
  let l = Math.hypot(dx, dy);
  if (l < 1e-3) { dx = 1; dy = 0; l = 1; }
  dx /= l; dy /= l;
  const back = rayToEdge(m.w, m.h, tx, ty, -dx, -dy);
  const exit = rayToEdge(m.w, m.h, tx, ty, dx, dy);
  return { sx: tx - dx * back, sy: ty - dy * back, dx, dy, exit };
}

/** Distance from (x, y) along (dx, dy) to just inside the map edge. */
function rayToEdge(w: number, h: number, x: number, y: number, dx: number, dy: number): number {
  const M = 0.55;
  let t = Infinity;
  if (dx > 1e-6) t = Math.min(t, (w - M - x) / dx);
  if (dx < -1e-6) t = Math.min(t, (M - x) / dx);
  if (dy > 1e-6) t = Math.min(t, (h - M - y) / dy);
  if (dy < -1e-6) t = Math.min(t, (M - y) / dy);
  return Number.isFinite(t) ? Math.max(0, t) : 0;
}

/** Scripted flight of a Badger / spy plane. Returns true when it handled the unit (aircraft.ts hook). */
export function updateSortie(world: World, u: Unit): boolean {
  const s = u.sortie;
  if (!s) return false;
  const speed = mphToCellsPerSecond(u.ut.speed);
  u.altitude = PLANE_ALT;
  u.heading = Math.atan2(s.dy, s.dx);
  u.x += s.dx * speed * DT;
  u.y += s.dy * speed * DT;
  u.moving = true;
  u.speedFrac = 1;
  u.path = null;
  // signed distance travelled past the target
  const along = (u.x - s.tx) * s.dx + (u.y - s.ty) * s.dy;
  if (!s.warned && along > -10) {
    s.warned = true;
    world.sfx('plane_flyby', u.x, u.y);
    // the players being overflown get a warning
    for (const o of world.players) {
      if (o.defeated || !u.owner.isEnemy(o)) continue;
      if (world.buildings.some((b) => b.alive && b.owner === o && b.distTo(s.tx, s.ty) < 10) ||
        world.units.some((x) => x.alive && x.owner === o && Math.hypot(x.x - s.tx, x.y - s.ty) < 8)) world.announce(o, s.kind === 'paratroopers' ? 'paratroopers_inbound' : 'enemy_aircraft', 6);
    }
  }
  switch (s.kind) {
    case 'spyplane':
      if (s.drops === 0 && along >= 0) {
        s.drops = 1;
        // RA U2 camera: snapshot of the area, kept visible for a while
        u.owner.reveals.push({ x: s.tx, y: s.ty, r: SPYPLANE_RADIUS, t: SPYPLANE_SECONDS });
        world.events.push({ e: 'power', kind: 'spyplane', player: u.owner.id, x: s.tx, y: s.ty });
      }
      break;
    case 'paratroopers':
      while (s.drops < PARATROOPERS && along >= -1 + s.drops * 0.5) {
        dropTrooper(world, u, s.tx, s.ty);
        s.drops++;
        if (s.drops === 1) world.events.push({ e: 'power', kind: 'paratroopers', player: u.owner.id, x: s.tx, y: s.ty });
      }
      break;
    case 'parabombs':
      while (s.drops < PARABOMBS && along >= -1.8 + s.drops * 0.6) {
        dropBomb(world, u);
        s.drops++;
        if (s.drops === 1) world.events.push({ e: 'power', kind: 'parabombs', player: u.owner.id, x: s.tx, y: s.ty });
      }
      break;
  }
  if (along >= s.exit || u.x < 0.3 || u.y < 0.3 || u.x > world.map.w - 0.3 || u.y > world.map.h - 0.3) {
    // flown off the map: gone (not a loss)
    u.x = Math.max(0.3, Math.min(world.map.w - 0.3, u.x));
    u.y = Math.max(0.3, Math.min(world.map.h - 0.3, u.y));
    world.despawn(u);
  }
  return true;
}

function dropTrooper(world: World, plane: Unit, tx: number, ty: number) {
  const m = world.map;
  let x = plane.x, y = plane.y;
  // chutes drift onto open ground (never into water, rock or a building)
  if (!m.passable(Math.floor(x), Math.floor(y))) [x, y] = world.findFreeSpot(x, y, 4, false);
  if (!m.passable(Math.floor(x), Math.floor(y))) [x, y] = world.findFreeSpot(tx, ty, 6, false);
  const t = world.addUnit('e1', plane.owner, x, y);
  t.heading = t.prevHeading = plane.heading;
  t.parachute = PARACHUTE_SECONDS;
  t.guardX = tx;
  t.guardY = ty;
  world.sfx('door', x, y);
}

function dropBomb(world: World, plane: Unit) {
  const w = WEAPONS.ParaBomb;
  const z = world.map.surfaceAt(plane.x, plane.y) + PLANE_ALT - 0.15;
  const tx = plane.x + Math.cos(plane.heading) * 0.35, ty = plane.y + Math.sin(plane.heading) * 0.35;
  const proj: Projectile = {
    id: world.nextProjectileId++, weapon: w, owner: plane.owner, shooter: plane.id, kind: 'bomb',
    x: plane.x, y: plane.y, z, prevX: plane.x, prevY: plane.y, prevZ: z, sx: plane.x, sy: plane.y, sz: z,
    tx, ty, tz: world.map.surfaceAt(tx, ty), target: null,
    t: 0, dur: 1.2, arc: 0, speed: 0, vx: 0, vy: 0, alive: true,
  };
  world.projectiles.push(proj);
  world.sfx('bomb_whistle', plane.x, plane.y);
}

/** A paratrooper hanging under its chute: drifts down, lands, then guards the drop zone (World.stepUnit hook). */
export function updateParachute(world: World, u: Unit) {
  u.parachute = Math.max(0, u.parachute - DT);
  if (u.parachute > 0) return;
  const m = world.map;
  if (!m.passable(Math.floor(u.x), Math.floor(u.y))) {
    const [x, y] = world.findFreeSpot(u.x, u.y, 4, false);
    u.x = u.prevX = x;
    u.y = u.prevY = y;
  }
  // fan out over the drop zone ready to fight (unless the owner already gave it orders on the way down)
  if (u.order.type === 'idle' && !u.orderQueue.length) {
    const gx = u.guardX, gy = u.guardY;
    world.setOrder(u, { type: 'move', x: u.x + (gx - u.x) * 0.3, y: u.y + (gy - u.y) * 0.3, attackMove: true });
  }
}

/** Per-tick countdowns of power effects. */
export function updatePowerTimers(world: World) {
  for (const p of world.players) {
    if (p.gpsPulse > 0) p.gpsPulse = Math.max(0, p.gpsPulse - DT);
    if (p.reveals.length) {
      for (const r of p.reveals) r.t -= DT;
      if (p.reveals.some((r) => r.t <= 0)) p.reveals = p.reveals.filter((r) => r.t > 0);
    }
  }
}

/** Visibility contributions of powers (World.updateVisibility hook, after the normal sight stamp). */
export function powerVisibility(world: World, p: Player) {
  const m = world.map;
  if (p.gpsPulse > 0) {
    p.visible.fill(1);
    p.explored.fill(1);
    return;
  }
  for (const r of p.reveals) stampCircle(world, p, r.x, r.y, r.r);
  void m;
}

/** Mark the cells within r of (x, y) visible and explored for p. */
export function stampCircle(world: World, p: Player, x: number, y: number, r: number) {
  const m = world.map;
  const fx = Math.floor(x), fy = Math.floor(y), R = Math.ceil(r);
  const r2 = r * r + 0.5;
  for (let dy = -R; dy <= R; dy++) {
    const cy = fy + dy;
    if (cy < 0 || cy >= m.h) continue;
    for (let dx = -R; dx <= R; dx++) {
      const cx = fx + dx;
      if (cx < 0 || cx >= m.w || dx * dx + dy * dy > r2) continue;
      const i = cy * m.w + cx;
      p.visible[i] = 1;
      p.explored[i] = 1;
    }
  }
}
