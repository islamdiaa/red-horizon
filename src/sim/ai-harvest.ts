/**
 * Ore Truck care for the Classic commander (simulation version 4; AIController.classicPro: Classic rules, skirmish,
 * normal and up), through the same commands a player gives (harvest here, go home):
 *
 *  - a truck under fire, or with enemy fighters in sight next to it, turns back: home to unload when it carries a
 *    fair load, otherwise to the safest field it knows;
 *  - a truck bound for a field far from its refineries and closer to the enemy (or where enemy fighters were seen
 *    lately) is sent to a safer field that still has ore, if there is one.
 *
 * In self-play the AI lost eight to twelve Ore Trucks a game in mid-map and enemy-side fields (about $14,000), much
 * of the money it was behind the casual stand-in. Commander rules keep the version-3 behaviour (their trucks already avoid
 * ore with enemies in sight, harvest.ts).
 */
import { BAIL_COUNT } from '../data/rules';
import type { Building } from './entities';
import type { AIController } from './ai';
import { oreFields } from './ai-ops';
import { TICK_HZ } from './types';

/** A field this close to one of our refineries is home ground. */
const HOME_R = 20;
/** Enemy fighters this close to a truck make it turn back. */
const DANGER_R = 6;
/** Risk (see risk()) of a destination on the enemy side of the map, or where enemy fighters were seen lately. */
const ENEMY_SIDE = 25;

/** Ore left around a field centre (cells with ore within r). */
function oreAround(ai: AIController, x: number, y: number, r: number): number {
  const m = ai.world.map;
  let n = 0;
  const fx = Math.floor(x), fy = Math.floor(y);
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (m.inBounds(fx + dx, fy + dy) && m.ore[m.idx(fx + dx, fy + dy)] > 0) n++;
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

export function guardHarvesters(ai: AIController) {
  if (!ai.due(TICK_HZ * 2)) return;
  const w = ai.world, p = ai.p;
  const refs = w.buildings.filter((b) => b.alive && b.owner === p && b.bt.dock && b.active);
  if (!refs.length) return;
  const trucks = w.units.filter((u) => u.alive && u.owner === p && u.ut.harvester && u.order.type === 'harvest');
  if (!trucks.length) return;
  const [bx, by] = ai.baseCenter();
  const enemy = ai.intel.enemyBase(bx, by);
  let fields: { x: number; y: number; risk: number }[] | null = null;
  const safeFields = () => {
    if (fields) return fields;
    fields = [];
    for (const f of oreFields(w.map)) {
      if (oreAround(ai, f.x, f.y, 4) < 6) continue;
      fields.push({ x: f.x, y: f.y, risk: risk(ai, f.x, f.y, refs, enemy) });
    }
    return fields;
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
    if (danger) {
      if (u.hstate === 'toRefinery' || u.hstate === 'waitDock' || u.hstate === 'unloading') continue;
      if (u.cargo >= BAIL_COUNT * 0.4) {
        let home: Building | null = null, hd = Infinity;
        for (const r of refs) { const d = Math.hypot(r.x - u.x, r.y - u.y); if (d < hd) { hd = d; home = r; } }
        if (home) w.issue({ c: 'enter', player: p.id, units: [u.id], target: home.id });
        continue;
      }
    } else if (!dest || risk(ai, dest[0], dest[1], refs, enemy) < ENEMY_SIDE) continue;
    // to the safest field with ore left (if it is clearly safer than where it is going)
    const here = dest ? risk(ai, dest[0], dest[1], refs, enemy) : risk(ai, u.x, u.y, refs, enemy);
    let best: { x: number; y: number; risk: number } | null = null;
    for (const f of safeFields()) {
      if (danger && Math.hypot(f.x - u.x, f.y - u.y) < DANGER_R + 4) continue;
      const s = f.risk + Math.hypot(f.x - u.x, f.y - u.y) * 0.05;
      if (!best || s < best.risk + Math.hypot(best.x - u.x, best.y - u.y) * 0.05) best = f;
    }
    if (best && best.risk + 4 < here) w.issue({ c: 'harvest', player: p.id, units: [u.id], x: best.x, y: best.y });
  }
}
