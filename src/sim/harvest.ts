import { BAIL_COUNT, GEM_VALUE, GOLD_VALUE } from '../data/rules';
import { angleDiff, turnTowards } from '../core/util';
import { Building, Unit } from './entities';
import { DT, TICK_HZ } from './types';
import type { World } from './world';
import { PROCESSOR_UNLOAD, harvestCapacity, oreValueMul } from './economy-data';

/** Ore Truck capacity in bails (Commander rules: Improved Harvesters research). */
const capOf = (u: Unit) => (u.owner.econ ? harvestCapacity(u.owner) : BAIL_COUNT);

const HARVEST_TIME = 0.34;  // seconds per bail
const UNLOAD_TIME = 0.08;   // seconds per bail
/** A truck this close to a free dock reserves it; others then keep clear until it has unloaded. */
const RESERVE_DIST = 2.5;
/** Trucks closer than this to a dock reserved by someone else stop and wait. */
const WAIT_DIST = 3.2;
/** Waiting trucks closer than this back off so the approach stays clear. */
const CLEAR_DIST = 2.6;
/** Seconds of waiting before trying another refinery. */
const WAIT_SWITCH = 10;

/**
 * The truck holding a refinery's dock (approaching it after reserving, or unloading), or null.
 * Clears stale reservations (holder gone, re-tasked or pushed far away).
 */
export function dockHolder(world: World, r: Building): Unit | null {
  if (!r.dockOccupant) return null;
  const h = world.entities.get(r.dockOccupant);
  if (h instanceof Unit && h.alive && h.ut.harvester && h.order.type === 'harvest' && h.dockAt === r.id) {
    if (h.hstate === 'unloading') return h;
    if (h.hstate === 'toRefinery') {
      const [dx, dy] = r.dockCell()!;
      if (Math.hypot(dx + 0.5 - h.x, dy + 0.5 - h.y) < WAIT_DIST + 1) return h;
    }
  }
  r.dockOccupant = 0;
  return null;
}

/**
 * Unloading, or pulling onto the dock it has reserved: collisions must not push it off the pad or back
 * out of the approach (other units, e.g. idle infantry loitering at the refinery, make way instead).
 */
export function isDocking(world: World, u: Unit): boolean {
  if (u.order.type !== 'harvest' || !u.dockAt) return false;
  if (u.hstate === 'unloading') return true;
  if (u.hstate !== 'toRefinery') return false;
  const r = world.entities.get(u.dockAt);
  if (!(r instanceof Building) || r.dockOccupant !== u.id) return false;
  const [dx, dy] = r.dockCell()!;
  return Math.hypot(dx + 0.5 - u.x, dy + 0.5 - u.y) < RESERVE_DIST + 0.5;
}

/** The last path search (within 2 s) towards dock cell (dx, dy) could not reach it. */
function dockUnreachable(world: World, u: Unit, dx: number, dy: number): boolean {
  if (u.pathFailKey < 0 || world.tick - u.pathFailTick >= TICK_HZ * 2) return false;
  const W = world.map.w, H = world.map.h;
  return u.pathFailKey % W === dx && Math.floor(u.pathFailKey / W) % H === dy;
}

/** The unit's last path search that failed was for goal cell (gx, gy) (any time: a truck heading for ore keeps its
 *  goal until it gets there or gives up). */
function failedTowards(world: World, u: Unit, gx: number, gy: number): boolean {
  if (u.pathFailKey < 0) return false;
  const W = world.map.w, H = world.map.h;
  return u.pathFailKey % W === gx && Math.floor(u.pathFailKey / W) % H === gy;
}

/** A spot near (but clear of) a refinery dock where a truck can wait its turn. */
function waitSpot(world: World, u: Unit, r: Building): [number, number] {
  const [dx, dy] = r.dockCell()!;
  const px = dx + 0.5, py = dy + 0.5;
  let a = Math.atan2(u.y - py, u.x - px);
  if (Math.hypot(u.x - px, u.y - py) < 0.3) a = Math.PI / 2 + (u.id % 2 ? 1 : -1);
  // keep out of the lane straight below the dock (the way in) and out of the refinery above it
  const side = Math.cos(a) !== 0 ? Math.sign(Math.cos(a)) : (u.id % 2 ? 1 : -1);
  if (Math.abs(angleDiff(a, Math.PI / 2)) < 0.7) a = Math.PI / 2 - side * 1.0;
  else if (Math.sin(a) < 0.2) a = Math.PI / 2 - side * 1.6;
  return world.findFreeSpot(px + Math.cos(a) * 3.4, py + Math.sin(a) * 3.4, 3);
}

/** Count harvesters already heading for / working a cell, to spread them out. */
function claimCount(world: World, cx: number, cy: number, self: Unit): number {
  let n = 0;
  for (const u of world.units) {
    if (u === self || !u.alive || !u.ut.harvester) continue;
    if ((u.hstate === 'toOre' || u.hstate === 'harvesting') && Math.floor(u.goalX) === cx && Math.floor(u.goalY) === cy) n++;
  }
  return n;
}

/** BFS outward over passable cells for the nearest ore cell. */
function findOre(world: World, u: Unit, fromX: number, fromY: number, maxR = 200): [number, number] | null {
  const m = world.map;
  const sx = Math.max(0, Math.min(m.w - 1, Math.floor(fromX))), sy = Math.max(0, Math.min(m.h - 1, Math.floor(fromY)));
  const seen = new Uint8Array(m.w * m.h);
  const q: number[] = [m.idx(sx, sy)];
  seen[q[0]] = 1;
  let head = 0;
  let fallback: [number, number] | null = null;
  const gates = world.pathfinder.gates;
  // Commander rules: skip ore where enemy fighters are in sight (checked per 4x4 block, a few blocks per search)
  let wary = u.owner.econ ? 16 : 0;
  const blocks = wary ? new Map<number, boolean>() : null;
  while (head < q.length) {
    const i = q[head++];
    const x = i % m.w, y = (i / m.w) | 0;
    if (Math.abs(x - sx) > maxR || Math.abs(y - sy) > maxR) continue;
    if (m.ore[i] > 0) {
      let danger = false;
      if (blocks) {
        const key = (y >> 2) * 4096 + (x >> 2);
        const known = blocks.get(key);
        if (known !== undefined) danger = known;
        else if (wary > 0) { wary--; danger = dangerAt(world, u, (x & ~3) + 1.5, (y & ~3) + 1.5); blocks.set(key, danger); }
      }
      if (!danger && claimCount(world, x, y, u) === 0) return [x, y];
      if (!fallback && !danger) fallback = [x, y];
    }
    for (let k = 0; k < 4; k++) {
      const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue;
      const j = ny * m.w + nx;
      if (seen[j]) continue;
      seen[j] = 1;
      // start cell may be inside a building (factory exit); own fortress gates open for the truck
      if (!m.passableIdx(j) && !(m.occupant[j] === u.exitBuilding && u.exitBuilding) && !(gates.size && gates.get(j) === u.owner.team)) continue;
      q.push(j);
    }
  }
  return fallback;
}

/** An enemy combat unit the truck's owner can see within 6 cells of the point (x, y) (the middle of a 4x4 block). */
function dangerAt(world: World, u: Unit, x: number, y: number): boolean {
  let hit = false;
  world.grid.query(x, y, 6, (o) => {
    if (hit || !o.alive || !o.weapons.length || o.ut.harvester || !u.owner.isEnemy(o.owner)) return;
    if (Math.hypot(o.x - x, o.y - y) <= 6 && world.canSee(u.owner, o)) hit = true;
  });
  return hit;
}

function nearestRefinery(world: World, u: Unit, except?: Building): Building | null {
  let best: Building | null = null, bestD = Infinity;
  for (const b of world.buildings) {
    if (!b.alive || b.owner !== u.owner || !b.bt.dock || !b.active || b === except) continue;
    const d = Math.hypot(b.x - u.x, b.y - u.y) + (b.dockOccupant && b.dockOccupant !== u.id ? 6 : 0);
    if (d < bestD) { bestD = d; best = b; }
  }
  return best;
}

export function updateHarvester(world: World, u: Unit) {
  const m = world.map;
  u.harvesting = false;
  switch (u.hstate) {
    case 'idle':
      u.hstate = 'seek';
      break;

    case 'seek': {
      if (u.cargo >= capOf(u)) { u.hstate = 'toRefinery'; u.dockAt = 0; break; }
      if (u.waitTimer > 0) { u.waitTimer -= DT; break; }
      const from = u.lastOreX >= 0 ? [u.lastOreX, u.lastOreY] : [u.x, u.y];
      const cell = findOre(world, u, from[0], from[1]);
      if (!cell) {
        if (u.cargo > 0) { u.hstate = 'toRefinery'; u.dockAt = 0; break; }
        // nothing nearby: search the whole reachable map next time, after a pause
        u.waitTimer = 2.5;
        u.lastOreX = -1;
        break;
      }
      // spread harvesters inside the cell a little
      world.requestPath(u, cell[0] + 0.5, cell[1] + 0.5);
      u.hstate = 'toOre';
      break;
    }

    case 'toOre': {
      if (u.path || u.pathPending) break;
      const cx = Math.floor(u.x), cy = Math.floor(u.y);
      if (m.inBounds(cx, cy) && m.ore[m.idx(cx, cy)] > 0) {
        u.hstate = 'harvesting';
        u.harvestTimer = HARVEST_TIME;
      } else if (failedTowards(world, u, Math.floor(u.goalX), Math.floor(u.goalY))) {
        // that ore can't be reached from here (structures went up round it): look again from the truck itself, which
        // only finds ore it can drive to (the search from the old spot found the same walled-off cell for ever, version 7)
        u.lastOreX = -1;
        u.hstate = 'seek';
      } else if (Math.hypot(u.goalX - u.x, u.goalY - u.y) < 1.5) {
        // goal depleted or slightly off – look around
        u.lastOreX = Math.floor(u.goalX);
        u.lastOreY = Math.floor(u.goalY);
        u.hstate = 'seek';
      } else {
        u.hstate = 'seek';
      }
      break;
    }

    case 'harvesting': {
      const cx = Math.floor(u.x), cy = Math.floor(u.y);
      const i = m.idx(cx, cy);
      if (m.ore[i] <= 0) {
        u.lastOreX = cx; u.lastOreY = cy;
        u.hstate = u.cargo >= capOf(u) ? 'toRefinery' : 'seek';
        break;
      }
      u.harvesting = true;
      u.harvestTimer -= DT;
      if (u.harvestTimer <= 0) {
        u.harvestTimer = HARVEST_TIME;
        const gems = m.gems[i] === 1;
        m.setOre(i, m.ore[i] - 1);
        u.cargo++;
        u.cargoValue += gems ? GEM_VALUE : GOLD_VALUE;
        u.lastOreX = cx; u.lastOreY = cy;
        world.events.push({ e: 'harvest', x: u.x, y: u.y, gems });
        if (u.cargo >= capOf(u)) { u.hstate = 'toRefinery'; u.dockAt = 0; }
      }
      break;
    }

    case 'toRefinery': {
      let r = u.dockAt ? (world.entities.get(u.dockAt) as Building | undefined) : undefined;
      if (!r || !r.alive || r.owner !== u.owner) {
        r = nearestRefinery(world, u) ?? undefined;
        if (!r) { u.waitTimer += DT; break; }
        u.dockAt = r.id;
        u.path = null; u.hasGoal = false;
      }
      const [dx, dy] = r.dockCell()!;
      const px = dx + 0.5, py = dy + 0.5;
      const d = Math.hypot(px - u.x, py - u.y);
      // one truck at a time: the first to get close reserves the dock, the others wait clear of it
      const holder = dockHolder(world, r);
      if (holder && holder !== u) {
        if (d < WAIT_DIST) { u.hstate = 'waitDock'; u.waitTimer = 0; u.path = null; u.hasGoal = false; break; }
      } else if (!holder && d < RESERVE_DIST) {
        r.dockOccupant = u.id;
      }
      if (d < 0.2 && r.dockOccupant === u.id) {
        u.hstate = 'unloading';
        u.harvestTimer = 0.5;
        u.unloadCredit = 0;
        break;
      }
      if (!u.hasGoal && !u.pathPending) {
        if (dockUnreachable(world, u, dx, dy)) {
          // walled in (structures around the pad): give the dock up and use another refinery if any
          if (r.dockOccupant === u.id) r.dockOccupant = 0;
          const alt = nearestRefinery(world, u, r);
          if (alt) { u.dockAt = alt.id; break; }
        }
        world.requestPath(u, px, py);
      }
      break;
    }

    case 'waitDock': {
      const r = world.entities.get(u.dockAt) as Building | undefined;
      if (!r || !r.alive || r.owner !== u.owner) { u.hstate = 'toRefinery'; u.dockAt = 0; u.waitTimer = 0; break; }
      const holder = dockHolder(world, r);
      if (!holder || holder === u) {
        // our turn (whoever gets close first reserves it)
        u.hstate = 'toRefinery';
        u.waitTimer = 0;
        u.path = null; u.hasGoal = false;
        break;
      }
      u.waitTimer += DT;
      // don't block the way in: back off to a waiting spot
      const [dx, dy] = r.dockCell()!;
      if (Math.hypot(dx + 0.5 - u.x, dy + 0.5 - u.y) < CLEAR_DIST && !u.path && !u.pathPending && (u.waitTimer < DT * 1.5 || world.tick % 10 === 0)) {
        const [wx, wy] = waitSpot(world, u, r);
        world.requestPath(u, wx, wy);
      }
      if (u.waitTimer > WAIT_SWITCH) {
        // a long queue here: use another refinery with a free dock if there is one
        u.waitTimer = 0;
        const alt = nearestRefinery(world, u, r);
        if (alt && !dockHolder(world, alt)) {
          u.dockAt = alt.id;
          u.hstate = 'toRefinery';
          u.path = null; u.hasGoal = false;
        }
      }
      break;
    }

    case 'unloading': {
      const r = world.entities.get(u.dockAt) as Building | undefined;
      if (!r || !r.alive) { u.hstate = 'toRefinery'; u.dockAt = 0; break; }
      // face north into the refinery
      const want = -Math.PI / 2;
      u.heading = turnTowards(u.heading, want, 3 * DT);
      if (Math.abs(angleDiff(u.heading, want)) > 0.05) break;
      u.harvestTimer -= DT;
      r.load = 1;
      if (u.harvestTimer <= 0) {
        u.harvestTimer = r.upgrades ? UNLOAD_TIME * (r.upgrades.includes('proc_processor') ? PROCESSOR_UNLOAD : 1) : UNLOAD_TIME; // (Ore Processor)
        if (u.cargo > 0) {
          let value = (u.cargoValue / u.cargo) * u.owner.incomeBias;
          if (u.owner.econ) value *= oreValueMul(u.owner, r); // Commander: Ore Processor, Purifier / Smelter
          u.cargoValue -= u.cargoValue / u.cargo;
          u.cargo--;
          const took = u.owner.depositOre(value);
          const discarded = took < value - 0.01;
          if (discarded) world.announce(u.owner, 'silos_needed', 12);
          // "+$" pop-up every 7 bails, showing only what was actually credited (full silos discard ore;
          // whatever still fitted is shown the moment storage fills up)
          u.unloadCredit += took;
          if (u.cargo % 7 === 0 || discarded || u.owner.ore >= u.owner.storage - 1) {
            const amount = Math.round(u.unloadCredit);
            u.unloadCredit = 0;
            if (amount > 0) world.events.push({ e: 'credits', player: u.owner.id, amount, x: r.x, y: r.y });
          }
        }
        if (u.cargo <= 0) {
          u.cargo = 0;
          u.cargoValue = 0;
          r.dockOccupant = 0;
          u.dockAt = 0;
          u.hstate = 'seek';
          // pull away from the dock so the next truck can enter
          u.y += 0.05;
        }
      }
      break;
    }
  }
}
