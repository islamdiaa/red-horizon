// Stuck detection in long AI-vs-AI matches.
//   node --import tsx tools/qa/stuck.ts [--size 128] [--players 4] [--diff hard] [--minutes 45] [--ceasefire 10]
//     [--rules commander|classic] [--seed 11] [--water 0.4] [-v]
// Reports, with positions:
//  - units with a move-type order (move, attack-move, patrol, attack, enter, harvest travel) that make no progress
//    for 20 s or more (no cell gained towards anything: the same 1.5-cell neighbourhood);
//  - harvesters idle (or seeking without a path) for 30 s while ore remains;
//  - an AI with money (>= 1500) that builds nothing (no structure placed, no unit produced) for 3 minutes;
//  - aircraft airborne without ammo for 120 s while their pad stands (never land / rearm);
//  - transports holding passengers for 3 minutes with an unload order pending (never unload).
import { generateMap } from '../../src/sim/mapgen';
import { World, type PlayerSetup } from '../../src/sim/world';
import { TICK_HZ } from '../../src/sim/types';
import { ceasefireTicks } from '../../src/sim/ceasefire';
import type { AIDifficulty } from '../../src/sim/ai';
import type { Unit } from '../../src/sim/entities';

const arg = (k: string, d: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const size = +arg('size', '128'), nP = +arg('players', '4'), minutes = +arg('minutes', '45'), seed = +arg('seed', '11');
const diff = arg('diff', 'hard') as AIDifficulty, rules = arg('rules', 'commander'), cf = +arg('ceasefire', '10'), water = +arg('water', '0.4');
const VERBOSE = process.argv.includes('-v');

export interface StuckReport { kind: string; detail: string; t: number }

export function watchStuck(world: World) {
  const reports: StuckReport[] = [];
  const seen = new Set<string>();
  const report = (kind: string, key: string, detail: string) => { if (seen.has(kind + key)) return; seen.add(kind + key); reports.push({ kind, detail, t: world.tick / TICK_HZ }); };
  const anchor = new Map<number, { x: number; y: number; t: number; order: string }>();
  const idleH = new Map<number, number>();
  const dry = new Map<number, number>();
  const carry = new Map<number, number>();
  const last = world.players.map(() => ({ t: 0, built: 0, units: 0 }));
  const travelling = (u: Unit) => {
    const o = u.order.type;
    if (o === 'move' || o === 'patrol' || o === 'enter' || o === 'repairBridge' || o === 'layMines') return true;
    if (o === 'attack') return !!u.path || u.pathPending || u.hasGoal;
    if (o === 'harvest') return u.hstate === 'toOre' || u.hstate === 'seek' || (u.hstate === 'toRefinery' && world.buildings.some((b) => b.alive && b.owner === u.owner && b.bt.dock && b.active)); // (no refinery left: waiting is right)
    return false;
  };
  const m = world.map;
  return {
    reports,
    /** Call once per second. */
    check() {
      const t = world.tick;
      for (const u of world.units) {
        if (!u.alive) continue;
        if (u.kind !== 'aircraft' && travelling(u)) {
          const a = anchor.get(u.id);
          if (!a || Math.hypot(u.x - a.x, u.y - a.y) > 1.5 || a.order !== u.order.type) anchor.set(u.id, { x: u.x, y: u.y, t, order: u.order.type });
          else if (t - a.t >= 20 * TICK_HZ) {
            const i = m.idx(Math.floor(u.x), Math.floor(u.y));
            const goal = u.order.type === 'move' ? `(${u.order.x.toFixed(1)}, ${u.order.y.toFixed(1)})` : u.hasGoal ? `(${u.goalX.toFixed(1)}, ${u.goalY.toFixed(1)})` : '-';
            // the nearest ground unit touching it, and whether that one is stuck too (a mutual jam)
            let near: Unit | null = null, nd = 1.3;
            for (const o of world.units) { if (o === u || !o.alive || o.kind === 'aircraft') continue; const d = Math.hypot(o.x - u.x, o.y - u.y); if (d < nd) { nd = d; near = o; } }
            const na = near ? anchor.get(near.id) : undefined;
            const blk = near ? ` next to ${near.ut.id}#${near.id} ${near.order.type} d=${nd.toFixed(2)}${na && t - na.t >= 10 * TICK_HZ ? ' (stuck too)' : ''}` : '';
            report('no-progress', String(u.id), `${u.owner.name} ${u.ut.id}#${u.id} ${u.order.type}${u.ut.harvester ? '/' + u.hstate : ''} at (${u.x.toFixed(1)}, ${u.y.toFixed(1)}) goal ${goal} for ${((t - a.t) / TICK_HZ).toFixed(0)} s, path=${u.path ? u.path.length - u.pathIdx : 'none'} pending=${u.pathPending} terrain=${m.terrain[i]} bridge=${m.bridgeAt[i]}${blk}`);
          }
        } else anchor.delete(u.id);
        if (u.ut.harvester) {
          const idleNow = (u.order.type === 'idle' || (u.order.type === 'harvest' && u.hstate === 'seek' && !u.path && !u.pathPending));
          if (idleNow && m.oreFieldCells.some((c) => m.ore[c] > 0)) {
            const s = idleH.get(u.id) ?? t; idleH.set(u.id, s);
            if (t - s >= 30 * TICK_HZ) report('idle-harvester', String(u.id), `${u.owner.name} harv#${u.id} ${u.order.type}/${u.hstate} at (${u.x.toFixed(1)}, ${u.y.toFixed(1)}) for ${((t - s) / TICK_HZ).toFixed(0)} s, cargo ${u.cargo}`);
          } else idleH.delete(u.id);
        }
        if (u.kind === 'aircraft' && (u.ut.ammo ?? 0) > 0) {
          if (u.altitude > 0.3 && u.ammo <= 0 && u.homePad && world.entities.get(u.homePad)?.alive) { // (no pad left: hovering is RA behaviour)
            const s = dry.get(u.id) ?? t; dry.set(u.id, s);
            if (t - s >= 120 * TICK_HZ) report('aircraft-no-rearm', String(u.id), `${u.owner.name} ${u.ut.id}#${u.id} airborne without ammo for ${((t - s) / TICK_HZ).toFixed(0)} s at (${u.x.toFixed(1)}, ${u.y.toFixed(1)}) order=${u.order.type} pad=${u.homePad}`);
          } else dry.delete(u.id);
        }
        if (u.ut.passengers && u.passengers.length && (u.order.type === 'move' || u.order.type === 'deploy')) {
          const s = carry.get(u.id) ?? t; carry.set(u.id, s);
          if (t - s >= 180 * TICK_HZ) report('transport-never-unloads', String(u.id), `${u.owner.name} ${u.ut.id}#${u.id} carrying ${u.passengers.length} for ${((t - s) / TICK_HZ).toFixed(0)} s order=${u.order.type}`);
        } else carry.delete(u.id);
      }
      world.players.forEach((p, i) => {
        if (p.isHuman || p.defeated) return;
        const L = last[i];
        if (p.stats.buildingsBuilt !== L.built || p.stats.unitsBuilt !== L.units || p.cash < 1500 || !p.buildOptions().length) { L.t = t; L.built = p.stats.buildingsBuilt; L.units = p.stats.unitsBuilt; return; } // (no yard or factory left: nothing to build)
        if (t - L.t >= 180 * TICK_HZ) report('ai-idle-with-money', `${i}@${Math.floor(L.t / (180 * TICK_HZ))}`, `${p.name} has $${Math.round(p.cash)} and built nothing for ${((t - L.t) / TICK_HZ).toFixed(0)} s (structures ${world.buildings.filter((b) => b.owner === p).length}, units ${world.units.filter((u) => u.owner === p).length}, queues ${Object.values(p.queues).map((q) => q.items.length + (q.ready ? '+' + q.ready : '')).join('/')})`);
      });
    },
  };
}

if (process.argv[1]?.endsWith('stuck.ts')) {
  const map = generateMap({ size, players: nP, seed, water, trees: 0.5, ore: 0.6 });
  const factions = ['allies', 'soviet', 'soviet', 'allies'] as const;
  const players: PlayerSetup[] = Array.from({ length: nP }, (_, i) => ({ name: `P${i}`, faction: factions[i % 4], color: 0, team: i, isHuman: false, ai: diff }));
  const world = new World({ map, players, credits: 10000, startUnits: 'mcv', fog: true, seed, ceasefireUntil: ceasefireTicks(cf), rules: rules === 'commander' ? 'commander' : undefined });
  const w = watchStuck(world);
  const t0 = performance.now();
  for (let t = 1; t <= minutes * 60 * TICK_HZ && !world.gameOver; t++) {
    world.step();
    world.events.length = 0;
    if (t % TICK_HZ === 0) w.check();
  }
  const by = new Map<string, StuckReport[]>();
  for (const r of w.reports) { const a = by.get(r.kind) ?? []; a.push(r); by.set(r.kind, a); }
  console.log(`stuck size=${size} players=${nP} diff=${diff} rules=${rules} seed=${seed} water=${water}: ${(world.tick / TICK_HZ / 60).toFixed(1)} min in ${((performance.now() - t0) / 1000).toFixed(0)} s${world.gameOver ? ', game over' : ''}`);
  for (const [k, list] of by) {
    console.log(`  ${k}: ${list.length}`);
    for (const r of list.slice(0, VERBOSE ? 50 : 6)) console.log(`    t=${(r.t / 60).toFixed(1)}m ${r.detail}`);
  }
  if (!w.reports.length) console.log('  nothing stuck');
}
