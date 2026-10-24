/**
 * Ore Truck care for the Classic commander (simulation version 4; AIController.classicPro: Classic rules, skirmish,
 * normal and up), through the same commands a player gives (harvest here, go home):
 *
 *  - a truck under fire, or with enemy fighters in sight next to it, turns back: home to unload when it carries a
 *    fair load, otherwise to the safest field it knows;
 *  - a truck bound for a field far from its refineries and closer to the enemy (or where enemy fighters were seen
 *    lately) is sent to a safer field that still has ore, if there is one;
 *  - (version 7) fields are judged by the ore left in them, never by cells with a trace of it: a truck turned back goes
 *    to a rich field, not to a mined-out one;
 *  - (version 7, care 2 and up) a truck scraping a mined-out field goes on to the safest rich one, not to the enemy's
 *    side of the map;
 *  - (version 7, care 3) an enemy column seen on a truck's way to its field, or next to the field it works, turns it to
 *    a field whose way is clear, or home with what it carries.
 *
 * How much of this a level does: DiffParams.classicTrucks (ai.ts; Normal leaves its trucks to themselves).
 *
 * In self-play the AI lost eight to twelve Ore Trucks a game in mid-map and enemy-side fields (about $14,000), much
 * of the money it was behind the casual stand-in. Version 6 then sent the trucks bound for the middle of the map back
 * to fields at home that were long mined out (a trace of regrowth in most cells): after minute 10 on the 96×96 menu
 * map the AI took in $600-1,000 a minute, the casual stand-in, whose trucks went on to the rich fields in the middle,
 * two to three times that. Commander rules keep the version-3 behaviour (their trucks already avoid ore with enemies
 * in sight, harvest.ts).
 */
import { BAIL_COUNT } from '../data/rules';
import type { Building, Unit } from './entities';
import type { AIController } from './ai';
import type { SeenUnit } from './ai-intel';
import { oreFields } from './ai-ops';
import { TICK_HZ } from './types';

/** A field this close to one of our refineries is home ground. */
const HOME_R = 20;
/** Enemy fighters this close to a truck make it turn back. */
const DANGER_R = 6;
/** Risk (see risk()) of a destination on the enemy side of the map, or where enemy fighters were seen lately. */
const ENEMY_SIDE = 25;
/** (care 2) Ore within 4 cells of a truck's destination under which it is scraping a mined-out field. */
const DRY = 40;
/** Ore within 4 cells of a field's centre that makes it worth the trip (a few truckloads). */
const RICH = 120;
/** (care 3) Enemy ground fighters seen in the last ROUTE_SEC seconds within ROUTE_R cells of a truck's way, worth this much together, are a column to keep clear of. */
const COLUMN = 1200;
const ROUTE_R = 9;
const ROUTE_SEC = 10;

/** Ore left around a field centre (the sum of what its cells within r hold). */
function oreLeft(ai: AIController, x: number, y: number, r: number): number {
  const m = ai.world.map;
  let n = 0;
  const fx = Math.floor(x), fy = Math.floor(y);
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (m.inBounds(fx + dx, fy + dy)) n += m.ore[m.idx(fx + dx, fy + dy)];
  }
  return n;
}

/** How risky a spot is for a truck: far from our refineries, nearer the enemy, enemy fighters seen lately. */
function risk(ai: AIController, x: number, y: number, refs: Building[], enemy: [number, number] | null): number {
  let dRef = Infinity;
  for (const r of refs) dRef = Math.min(dRef, Math.hypot(r.x - x, r.y - y));
  let s = Math.max(0, dRef - HOME_R);
  if (enemy && Math.hypot(enemy[0] - x, enemy[1] - y) < dRef) s += 25;
  s += ai.intel.strengthNear(x, y, 9, 90) / 150;
  return s;
}

/** (care 3) Value of the enemy fighters in `seen` within ROUTE_R cells of the way from (x0, y0) to (x1, y1). */
function onRoute(seen: SeenUnit[], x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy;
  let v = 0;
  for (const s of seen) {
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((s.x - x0) * dx + (s.y - y0) * dy) / l2)) : 0;
    if (Math.hypot(x0 + dx * t - s.x, y0 + dy * t - s.y) < ROUTE_R) v += s.cost;
  }
  return v;
}

/** care: 1 = fields by the ore left and away from fire, 2 = also off mined-out fields, 3 = also off an enemy column's way. */
export function guardHarvesters(ai: AIController, care: number) {
  if (!ai.due(TICK_HZ * 2)) return;
  const w = ai.world, p = ai.p;
  const refs = w.buildings.filter((b) => b.alive && b.owner === p && b.bt.dock && b.active);
  if (!refs.length) return;
  const trucks = w.units.filter((u) => u.alive && u.owner === p && u.ut.harvester && u.order.type === 'harvest');
  if (!trucks.length) return;
  const [bx, by] = ai.baseCenter();
  const enemy = ai.intel.enemyBase(bx, by);
  // (version 7: a field is judged by the ore left in it; a mined-out field at home keeps a trace of regrowth in most of
  // its cells, and the trucks sent back there scraped $600 a minute while the enemy's took the rich fields in the middle)
  // (care 3: the enemy's ground fighters seen in the last few seconds, wherever they are)
  const seen: SeenUnit[] = [];
  if (care >= 3) {
    const since = w.tick - ROUTE_SEC * TICK_HZ;
    for (const s of ai.intel.units.values()) if (s.seen >= since && s.type !== 'harv' && s.type !== 'mcv' && s.cls !== 'air' && s.cls !== 'naval') seen.push(s);
  }
  const blocked = (u: Unit, x: number, y: number) => seen.length > 0 && onRoute(seen, u.x, u.y, x, y) >= COLUMN;
  let fields: { x: number; y: number; risk: number }[] | null = null;
  const safeFields = () => {
    if (fields) return fields;
    fields = [];
    for (const f of oreFields(w.map)) {
      if (oreLeft(ai, f.x, f.y, 4) < RICH) continue;
      fields.push({ x: f.x, y: f.y, risk: risk(ai, f.x, f.y, refs, enemy) });
    }
    return fields;
  };
  const nearestRef = (u: Unit) => {
    let home: Building | null = null, hd = Infinity;
    for (const r of refs) { const d = Math.hypot(r.x - u.x, r.y - u.y); if (d < hd) { hd = d; home = r; } }
    return home;
  };
  for (const u of trucks) {
    // under fire, or enemy fighters right next to it
    let danger = w.tick - u.lastDamagedTick < TICK_HZ * 3;
    if (!danger) {
      w.grid.query(u.x, u.y, DANGER_R, (o) => {
        if (danger || !o.alive || !o.weapons.length || o.ut.harvester || !p.isEnemy(o.owner)) return;
        if (o.kind !== 'aircraft' && Math.hypot(o.x - u.x, o.y - u.y) <= DANGER_R && ai.intel.sees(o)) danger = true;
      });
    }
    const dest: [number, number] | null = u.hstate === 'toOre' ? [u.goalX, u.goalY] : u.hstate === 'harvesting' ? [u.x, u.y] : null;
    // (care 3: an enemy column on its way to the field, or next to the field it works)
    if (!danger && dest && blocked(u, dest[0], dest[1])) danger = true;
    // (care 2: scraping a mined-out field, with a rich one to go to)
    let dry = false;
    if (danger) {
      if (u.hstate === 'toRefinery' || u.hstate === 'waitDock' || u.hstate === 'unloading') continue;
      if (u.cargo >= BAIL_COUNT * 0.4) {
        const home = nearestRef(u);
        if (home && !blocked(u, home.x, home.y)) w.issue({ c: 'enter', player: p.id, units: [u.id], target: home.id });
        if (home) continue;
      }
    } else if (!dest) continue;
    else if (risk(ai, dest[0], dest[1], refs, enemy) < ENEMY_SIDE) {
      if (care < 2 || oreLeft(ai, dest[0], dest[1], 4) >= DRY) continue;
      dry = true;
    }
    // to the safest field with ore left (if it is clearly safer than where it is going); a dry field: to the safest rich one
    const here = dest ? risk(ai, dest[0], dest[1], refs, enemy) : risk(ai, u.x, u.y, refs, enemy);
    let best: { x: number; y: number; risk: number } | null = null;
    for (const f of safeFields()) {
      if (danger && Math.hypot(f.x - u.x, f.y - u.y) < DANGER_R + 4) continue;
      // (a dry field: not to the enemy's side of the map, nor where his fighters were seen)
      if (dry && f.risk >= ENEMY_SIDE * 2) continue;
      if (blocked(u, f.x, f.y)) continue;
      const s = f.risk + Math.hypot(f.x - u.x, f.y - u.y) * 0.05;
      if (!best || s < best.risk + Math.hypot(best.x - u.x, best.y - u.y) * 0.05) best = f;
    }
    if (best && (dry ? Math.hypot(best.x - dest![0], best.y - dest![1]) > 6 : best.risk + 4 < here || (danger && seen.length > 0))) {
      w.issue({ c: 'harvest', player: p.id, units: [u.id], x: best.x, y: best.y });
    } else if (danger && seen.length > 0 && !best && Math.hypot(u.x - bx, u.y - by) > HOME_R / 2) {
      // (care 3: nowhere clear to go: home, if its way is clear)
      const home = nearestRef(u);
      if (home && !blocked(u, home.x, home.y)) w.issue({ c: 'enter', player: p.id, units: [u.id], target: home.id });
    }
  }
}
