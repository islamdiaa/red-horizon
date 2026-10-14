import { BAIL_COUNT, GEM_VALUE, GOLD_VALUE } from '../data/rules';
import { angleDiff, turnTowards } from '../core/util';
import { Building, Unit } from './entities';
import { DT } from './types';
import type { World } from './world';

const HARVEST_TIME = 0.34;  // seconds per bail
const UNLOAD_TIME = 0.08;   // seconds per bail

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
  while (head < q.length) {
    const i = q[head++];
    const x = i % m.w, y = (i / m.w) | 0;
    if (Math.abs(x - sx) > maxR || Math.abs(y - sy) > maxR) continue;
    if (m.ore[i] > 0) {
      if (claimCount(world, x, y, u) === 0) return [x, y];
      if (!fallback) fallback = [x, y];
    }
    for (let k = 0; k < 4; k++) {
      const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue;
      const j = ny * m.w + nx;
      if (seen[j]) continue;
      seen[j] = 1;
      // start cell may be inside a building (factory exit)
      if (!m.passableIdx(j) && !(m.occupant[j] === u.exitBuilding && u.exitBuilding)) continue;
      q.push(j);
    }
  }
  return fallback;
}

function nearestRefinery(world: World, u: Unit): Building | null {
  let best: Building | null = null, bestD = Infinity;
  for (const b of world.buildings) {
    if (!b.alive || b.owner !== u.owner || !b.bt.dock || !b.active) continue;
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
      if (u.cargo >= BAIL_COUNT) { u.hstate = 'toRefinery'; u.dockAt = 0; break; }
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
        u.hstate = u.cargo >= BAIL_COUNT ? 'toRefinery' : 'seek';
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
        if (u.cargo >= BAIL_COUNT) { u.hstate = 'toRefinery'; u.dockAt = 0; }
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
      if (d < 0.2) {
        if (!r.dockOccupant || r.dockOccupant === u.id) {
          r.dockOccupant = u.id;
          u.hstate = 'unloading';
          u.harvestTimer = 0.5;
        } else {
          u.hstate = 'waitDock';
        }
        break;
      }
      // wait nearby if the dock is busy
      if (r.dockOccupant && r.dockOccupant !== u.id && d < 2.5) {
        const occ = world.entities.get(r.dockOccupant);
        if (occ && occ.alive) { u.hstate = 'waitDock'; u.path = null; u.hasGoal = false; break; }
        r.dockOccupant = 0;
      }
      if (!u.hasGoal && !u.pathPending) world.requestPath(u, px, py);
      break;
    }

    case 'waitDock': {
      const r = world.entities.get(u.dockAt) as Building | undefined;
      if (!r || !r.alive) { u.hstate = 'toRefinery'; u.dockAt = 0; break; }
      const occ = r.dockOccupant ? world.entities.get(r.dockOccupant) : undefined;
      if (!occ || !occ.alive) { r.dockOccupant = 0; u.hstate = 'toRefinery'; break; }
      u.waitTimer += DT;
      if (u.waitTimer > 12) {
        // try another refinery
        u.waitTimer = 0;
        const alt = nearestRefinery(world, u);
        if (alt && alt !== r && !alt.dockOccupant) { u.dockAt = alt.id; u.hstate = 'toRefinery'; }
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
        u.harvestTimer = UNLOAD_TIME;
        if (u.cargo > 0) {
          const value = (u.cargoValue / u.cargo) * u.owner.incomeBias;
          u.cargoValue -= u.cargoValue / u.cargo;
          u.cargo--;
          const took = u.owner.depositOre(value);
          if (took < value - 0.01) world.announce(u.owner, 'silos_needed', 12);
          if (u.cargo % 7 === 0) world.events.push({ e: 'credits', player: u.owner.id, amount: Math.round(value * 7), x: r.x, y: r.y });
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
