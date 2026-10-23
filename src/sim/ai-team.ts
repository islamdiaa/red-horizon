/**
 * Team play with human teammates (simulation version 5; skirmishes: the 2v2 and team lobbies with AI seats, and a
 * skirmish with an AI ally. King of the Hill, challenges and scripted missions, co-op included, script their AIs' roles
 * themselves and don't use this). An AI commander with a human on its team:
 *
 *  - comes to the human's base when it is attacked (after the level's reaction delay; from Normal up with enough of
 *    its free army to outweigh the attackers, as it would for its own base; Recruit and Easy with half of it);
 *  - joins the human's pushes: when the human's army is at an enemy base, its own idle army goes for the same base
 *    (the level's wave cap still applies);
 *  - leaves the human's ore alone: its Ore Trucks don't mine the fields around the human's refineries while another
 *    field has ore.
 *
 * Nothing here runs without a human teammate (1v1, free-for-all and AI-only teams play exactly as before). Built from
 * the shared team vision only: no map-hack, no extra money.
 */
import type { AIController } from './ai';
import type { Building, Unit } from './entities';
import type { Player } from './player';
import { oreFields } from './ai-ops';
import { TICK_HZ } from './types';

/** Enemy force (credits) at a teammate's base that counts as an attack worth answering. */
const ATTACK_VALUE = 600;
/** Cells around a teammate's base (yard) that are its base. */
const BASE_R = 14;
/** A teammate's army this close to a known enemy structure is pushing there. */
const PUSH_R = 22;
const PUSH_UNITS = 4;
/** Fields this close to a teammate's refinery are his. */
const MATE_ORE_R = 12;

/** Human teammates still in the game. */
export function humanMates(ai: AIController): Player[] {
  const p = ai.p;
  return ai.world.players.filter((o) => o !== p && o.isHuman && !o.defeated && o.team === p.team);
}

function baseOf(ai: AIController, o: Player): [number, number] | null {
  let any: Building | null = null;
  for (const b of ai.world.buildings) {
    if (!b.alive || b.owner !== o || b.bt.wall || b.bt.mine) continue;
    if (b.bt.id === 'fact') return [b.x, b.y];
    any ??= b;
  }
  return any ? [any.x, any.y] : null;
}

const fighter = (u: Unit) => u.alive && u.weapons.length > 0 && !u.ut.harvester && !u.ut.deploysInto && !u.ut.supportPlane && u.kind !== 'naval';

/** A human teammate's base under attack: send help. Call from AIController.military() once its own base is safe. */
export function helpMates(ai: AIController, mates: Player[]) {
  const w = ai.world, p = ai.p;
  if (!ai.due(TICK_HZ * 2)) return;
  let spot: [number, number] | null = null, value = 0;
  for (const m of mates) {
    const home = baseOf(ai, m);
    if (!home) continue;
    let v = 0, sx = 0, sy = 0, n = 0;
    for (const u of w.units) {
      if (!fighter(u) || !p.isEnemy(u.owner) || u.owner.id < 0 || (u.ut.spy && u.disguise >= 0)) continue;
      if (Math.hypot(u.x - home[0], u.y - home[1]) > BASE_R || !ai.intel.sees(u)) continue;
      v += u.ut.cost * u.healthFrac; sx += u.x; sy += u.y; n++;
    }
    if (n && v > value) { value = v; spot = [sx / n, sy / n]; }
  }
  if (!spot || value < ATTACK_VALUE) { ai.mateThreat = -1; return; }
  if (ai.mateThreat < 0) ai.mateThreat = w.tick;
  if (w.tick - ai.mateThreat < ai.d.defendDelay * TICK_HZ || w.tick - ai.lastMateHelp < TICK_HZ * 8) return;
  const [sx, sy] = spot;
  const free = ai.available().filter((u) => (!ai.wave.has(u.id) || ai.state !== 'attack') && u.order.type !== 'attack')
    .sort((a, b) => Math.hypot(a.x - sx, a.y - sy) - Math.hypot(b.x - sx, b.y - sy) || a.id - b.id);
  // (at least half the free army, or the level's reaction share if higher; from Normal up also enough to outweigh the
  // attackers, version 6: a cap at `most` units used to stop it short of that whatever they were worth. Recruit and
  // Easy stay modest helpers: half their free army)
  const most = Math.ceil(free.length * Math.max(0.5, Math.min(1, ai.d.reaction * ai.tune.reactionMul)));
  const modest = ai.d.skill < 0.5;
  const ids: number[] = [];
  let v = 0;
  for (const u of free) {
    if (ids.length >= most && (modest || v >= value * 1.5)) break;
    ids.push(u.id);
    v += u.ut.cost * u.healthFrac;
  }
  if (!ids.length) return;
  ai.lastMateHelp = w.tick;
  w.issue({ c: 'move', player: p.id, units: ids, x: sx, y: sy, attackMove: true });
}

/** Where a human teammate's army is pushing (a known enemy structure with his units around it), or null. */
export function matePush(ai: AIController, mates: Player[]): [number, number] | null {
  const w = ai.world;
  let best: [number, number] | null = null, bestN = PUSH_UNITS - 1;
  for (const s of ai.intel.structures.values()) {
    if (w.players[s.owner]?.defeated) continue;
    let n = 0;
    for (const u of w.units) if (fighter(u) && mates.includes(u.owner) && u.kind !== 'aircraft' && Math.hypot(u.x - s.x, u.y - s.y) < PUSH_R) n++;
    if (n > bestN) { bestN = n; best = [s.x, s.y + s.h / 2 + 0.5]; }
  }
  return best;
}

/** Ore Trucks stay off a human teammate's fields while another field has ore. */
export function spareMatesOre(ai: AIController, mates: Player[]) {
  const w = ai.world, p = ai.p, m = w.map;
  if (!ai.due(TICK_HZ * 4)) return;
  const theirs = w.buildings.filter((b) => b.alive && b.bt.dock && mates.includes(b.owner));
  if (!theirs.length) return;
  const near = (x: number, y: number) => theirs.some((r) => Math.hypot(r.x - x, r.y - y) < MATE_ORE_R);
  const trucks = w.units.filter((u) => u.alive && u.owner === p && u.ut.harvester && u.order.type === 'harvest' &&
    ((u.hstate === 'harvesting' && near(u.x, u.y)) || (u.hstate === 'toOre' && near(u.goalX, u.goalY))));
  if (!trucks.length) return;
  const mine = w.buildings.filter((b) => b.alive && b.owner === p && b.bt.dock);
  const ore = (fx: number, fy: number) => {
    let n = 0;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = Math.floor(fx) + dx, y = Math.floor(fy) + dy;
      if (m.inBounds(x, y) && m.ore[m.idx(x, y)] > 0) n++;
    }
    return n;
  };
  let best: { x: number; y: number } | null = null, bd = Infinity;
  for (const f of oreFields(m)) {
    if (near(f.x, f.y) || ore(f.x, f.y) < 6) continue;
    let d = Infinity;
    for (const r of mine) d = Math.min(d, Math.hypot(r.x - f.x, r.y - f.y));
    if (!mine.length) d = 0;
    if (d < bd) { bd = d; best = f; }
  }
  if (best) w.issue({ c: 'harvest', player: p.id, units: trucks.map((u) => u.id), x: best.x, y: best.y });
}
