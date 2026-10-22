import { BUILD_SECONDS_PER_1000, UNITS, getType } from '../data/rules';
import { Building } from './entities';
import { placeOnPad } from './aircraft';
import type { Player } from './player';
import { DT, type QueueKind } from './types';
import type { World } from './world';
import { spawnNaval } from './naval';
import { rallyNewUnit } from './orders';
import { updateRepeat } from './repeat';
import { cmdPower, cmdTimeMul, costOf } from './doctrine';
import { econTrained } from './economy';

const KINDS: QueueKind[] = ['structure', 'infantry', 'vehicle', 'aircraft', 'naval'];

/**
 * Items per production queue (World 'build'; loops respect it too). Red Alert builds one item per strip at a
 * time; here a queue holds up to 25 of any mix of types (Shift-click queues 5), and loops (repeat.ts) cover
 * longer runs. Kept at 25 so recorded replays that hit the cap still replay identically.
 */
export const QUEUE_LIMIT = 25;

/** Recompute power, storage and radar for a player (cheap; called often). */
export function recalcPlayerEconomy(world: World, p: Player) {
  let out = 0, use = 0, storage = 0, radarBld = false, jammedBld = false;
  for (const b of world.buildings) {
    if (!b.alive || b.owner !== p || b.buildAnim < 1) continue;
    const pw = p.cmd ? cmdPower(b) : b.bt.power; // doctrine power drain, sabotaged power plants
    if (pw > 0) out += pw * (0.5 + 0.5 * b.healthFrac);
    else use -= pw;
    storage += b.bt.storage ?? 0;
    if (b.bt.radar && (!b.jammed || p.gps)) radarBld = true; // an enemy radar jammer in range blinds it (GPS: never)
    else if (b.bt.radar) jammedBld = true;
  }
  const wasLow = p.lowPower;
  p.powerOut = Math.round(out);
  p.powerUse = use;
  p.storage = storage;
  if (p.ore > storage) p.ore = storage;
  if (!wasLow && p.lowPower && use > 0) world.announce(p, 'low_power', 8);
  const radar = radarBld && !p.lowPower;
  if (radar !== p.radar) {
    p.radar = radar;
    // (jammed: stealth.ts already announced radar_jammed)
    if (world.tick > 1 && (radar || !jammedBld || p.lowPower)) world.announce(p, radar ? 'radar_online' : 'radar_offline', 2);
    if (radar) world.events.push({ e: 'sfx', key: 'radar_on', x: -1, y: -1 });
  }
}

export function factoriesFor(world: World, p: Player, typeId: string): Building[] {
  const t = getType(typeId);
  const out: Building[] = [];
  for (const b of world.buildings) {
    if (!b.alive || b.owner !== p || !b.active || !b.bt.factory) continue;
    if (t.kind === 'building') {
      if (b.bt.factory === 'building') out.push(b);
      continue;
    }
    if (b.bt.factory !== t.kind) continue;
    if (b.bt.factoryOnly && !b.bt.factoryOnly.includes(typeId)) continue;
    if (!b.bt.factoryOnly && typeId === 'dog') continue;
    out.push(b);
  }
  return out;
}

/**
 * factoriesFor(...).length for updateProduction, remembered for the tick (every producing queue asks every tick, and
 * each ask walked the whole structure list). Only for the production pass: structures can't appear, finish or go
 * during it (later in the tick they can, so the AI and the HUD still count afresh).
 */
const facMemo = new WeakMap<World, { tick: number; len: number; src: Building[]; n: Map<string, number> }>();
function factoryCount(world: World, p: Player, typeId: string): number {
  let m = facMemo.get(world);
  if (!m || m.tick !== world.tick || m.src !== world.buildings || m.len !== world.buildings.length) facMemo.set(world, (m = { tick: world.tick, len: world.buildings.length, src: world.buildings, n: new Map() }));
  const key = p.id + ':' + typeId;
  let n = m.n.get(key);
  if (n === undefined) m.n.set(key, (n = factoriesFor(world, p, typeId).length));
  return n;
}

export function buildSeconds(world: World, p: Player, typeId: string, factories?: number): number {
  const t = getType(typeId);
  let secs = (costOf(p, t) / 1000) * BUILD_SECONDS_PER_1000; // doctrine price (= t.cost under Classic rules)
  const n = Math.min(4, Math.max(1, factories ?? factoriesFor(world, p, typeId).length));
  secs /= 1 + 0.5 * (n - 1);
  if (p.lowPower) secs *= 1 + (1 - p.powerRatio) * 2;
  if (p.cmd) secs *= cmdTimeMul(p, t); // doctrine build time
  return Math.max(1.2, secs / p.buildSpeed);
}

export function updateProduction(world: World, p: Player) {
  for (const kind of KINDS) {
    const q = p.queues[kind];
    if (kind === 'structure' && q.ready) {
      // a finished structure is lost with the last Construction Yard (refunded, as RA abandons production)
      if (!p.hasFactoryFor(q.ready)) {
        p.refund(costOf(p, getType(q.ready))); // doctrine price (= cost under Classic rules)
        q.ready = null;
        world.announce(p, 'cancelled', 2);
      }
      continue;
    }
    if (!q.items.length) { q.stalled = false; continue; }
    // lost a factory or a tech building: drop (and refund) only the items that can't be built any more
    let dropped = false, lastType = '', lastOk = true;
    for (let k = q.items.length - 1; k >= 0; k--) {
      const x = q.items[k];
      if (x.type !== lastType) {
        lastType = x.type;
        lastOk = p.hasFactoryFor(x.type) && p.prereqsMet(getType(x.type));
      }
      if (lastOk) continue;
      p.refund(x.paid);
      q.items.splice(k, 1);
      dropped = true;
    }
    if (dropped) world.announce(p, 'cancelled', 2);
    if (!q.items.length) { q.stalled = false; continue; }
    const it = q.items[0];
    const t = getType(it.type);
    if (it.paused) continue;
    const inc = DT / buildSeconds(world, p, it.type, factoryCount(world, p, it.type));
    const step = Math.min(inc, 1 - it.progress);
    const pay = costOf(p, t) * step; // doctrine price (= t.cost under Classic rules)
    if (p.spend(pay)) {
      it.progress += step;
      it.paid += pay;
      q.stalled = false;
    } else {
      q.stalled = true;
      world.announce(p, 'insufficient_funds', 10);
      continue;
    }
    if (it.progress >= 1 - 1e-6) {
      q.items.shift();
      if (kind === 'structure') {
        q.ready = it.type;
        world.announce(p, 'construction_complete', 0);
      } else if (spawnProduced(world, p, it.type)) {
        p.stats.unitsBuilt++;
        world.announce(p, 'unit_ready', 0);
      } else {
        p.refund(it.paid);
      }
    }
  }
  // loops queue their next unit (at the end of the tick, so a looping queue is never seen empty while it can pay)
  updateRepeat(world, p);
}

/** Create a finished unit at its factory and send it to the rally point. */
export function spawnProduced(world: World, p: Player, typeId: string): boolean {
  const ut = UNITS[typeId];
  const facs = factoriesFor(world, p, typeId);
  if (!facs.length) return false;
  const f = facs.find((b) => b.primary) ?? facs[0];
  if (ut.kind === 'naval') {
    const ship = spawnNaval(world, p, f, typeId);
    if (ship) world.events.push({ e: 'produced', id: ship.id, building: f.id, player: p.id });
    return !!ship;
  }
  const [ex, ey] = f.exitCell();
  let u;
  if (ut.kind === 'aircraft') {
    u = world.addUnit(typeId, p, f.x, f.y);
    placeOnPad(u, f);
    if (f.rallyX >= 0) world.setOrder(u, { type: 'move', x: f.rallyX, y: f.rallyY, attackMove: false });
    world.events.push({ e: 'produced', id: u.id, building: f.id, player: p.id });
    return true;
  } else if (ut.kind === 'infantry') {
    u = world.addUnit(typeId, p, ex + 0.5 + (world.rng.next() - 0.5) * 0.3, ey + 0.35);
    u.heading = u.prevHeading = Math.PI / 2;
  } else {
    // vehicles roll out of the factory door
    u = world.addUnit(typeId, p, f.x, f.y + 0.2);
    u.heading = u.prevHeading = u.turret = u.prevTurret = Math.PI / 2;
    u.exitBuilding = f.id;
    f.doorHold = 2.2;
  }
  if (f.upgrades) econTrained(world, f, u); // Training Ground: veteran infantry (Commander economy)
  world.events.push({ e: 'sfx', key: ut.kind === 'infantry' ? 'door' : 'door', x: f.x, y: f.y });
  world.events.push({ e: 'produced', id: u.id, building: f.id, player: p.id }); // auto-groups, idle-factory watch
  if (ut.harvester) {
    // harvest order already set by addUnit; path out via the exit
    return true;
  }
  let rx = f.rallyX, ry = f.rallyY;
  if (rx < 0) {
    const spot = world.findFreeSpot(ex + 0.5, ey + 1.8, 4, ut.kind !== 'infantry');
    rx = spot[0];
    ry = spot[1];
  }
  world.setOrder(u, { type: 'move', x: rx, y: ry, attackMove: false });
  rallyNewUnit(world, f, u); // rally to a unit
  return true;
}
