// Path-search profile of a long AI match: where the simulation's time goes as armies grow.
//   node --import tsx tools/qa/pathprof.ts [--size 128] [--players 4] [--diff brutal] [--minutes 40] [--ceasefire 20]
//     [--rules commander|classic] [--seed 7] [--every 5]
// Per interval: units, simulation ms per tick (p50 / p95), path-search ms per tick, searches per tick, nodes per
// search, the share of searches whose goal cell is blocked (a structure, water: these explore the whole reachable
// map unless the search stops at the nearest cell), path requests waiting (queue length) and how long they wait.
import { generateMap } from '../../src/sim/mapgen';
import { World, type PlayerSetup } from '../../src/sim/world';
import { TICK_HZ } from '../../src/sim/types';
import { ceasefireTicks } from '../../src/sim/ceasefire';
import type { AIDifficulty } from '../../src/sim/ai';
import { worldHash } from '../../src/replay/hash';

const arg = (k: string, d: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const size = +arg('size', '128'), nP = +arg('players', '4'), minutes = +arg('minutes', '40');
const diff = arg('diff', 'brutal') as AIDifficulty, cf = +arg('ceasefire', '20');
const rules = arg('rules', 'commander'), seed = +arg('seed', '7'), every = +arg('every', '5');

const map = generateMap({ size, players: nP, seed, water: 0.4, trees: 0.5, ore: 0.6 });
const factions = ['allies', 'soviet', 'soviet', 'allies'] as const;
const players: PlayerSetup[] = Array.from({ length: nP }, (_, i) => ({ name: `P${i}`, faction: factions[i % 4], color: 0, team: i, isHuman: false, ai: diff }));
const world = new World({ map, players, credits: 10000, startUnits: 'mcv', fog: true, seed, ceasefireUntil: ceasefireTicks(cf), rules: rules === 'commander' ? 'commander' : undefined });

const pf = world.pathfinder as any;
const find0 = pf.find.bind(pf);
let pMs = 0, pN = 0, pNodes = 0, pBlocked = 0, pFail = 0;
pf.find = (sx: number, sy: number, tx: number, ty: number, maxNodes: number, ign: number, loco: string, team: number) => {
  const a = performance.now();
  const r = find0(sx, sy, tx, ty, maxNodes, ign, loco, team);
  pMs += performance.now() - a;
  pN++;
  pNodes += pf.expandedLastSearch;
  const m = world.map;
  if (loco !== 'naval' && m.inBounds(tx, ty) && !m.passableIdx(m.idx(tx, ty))) pBlocked++;
  const last = r && r.length ? r[r.length - 1] : null;
  if (!last || Math.floor(last.x) !== tx || Math.floor(last.y) !== ty) pFail++;
  return r;
};
const q: any[] = (world as any).pathQueue;
let qMax = 0, qSum = 0;
const pct = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0; };
let ticks: number[] = [];
const all: number[] = [];
const start = performance.now();
console.log(`pathprof ${size} ${nP}p ${diff} ${rules} seed ${seed} ceasefire ${cf} min`);
for (let t = 1; t <= minutes * 60 * TICK_HZ && !world.gameOver; t++) {
  const a = performance.now();
  world.step();
  const d = performance.now() - a;
  world.events.length = 0;
  ticks.push(d); all.push(d);
  qMax = Math.max(qMax, q.length); qSum += q.length;
  if (t % (every * 60 * TICK_HZ) === 0) {
    const n = ticks.length;
    const units = world.units.filter((u) => u.alive).length;
    console.log(`  ${String(t / TICK_HZ / 60).padStart(3)} min  units ${String(units).padStart(4)}  tick p50 ${pct(ticks, 0.5).toFixed(2)} p95 ${pct(ticks, 0.95).toFixed(2)} max ${Math.max(...ticks).toFixed(1)} ms`
      + ` | path ${(pMs / n).toFixed(2)} ms/tick, ${(pN / n).toFixed(2)} searches/tick, ${(pNodes / Math.max(1, pN)).toFixed(0)} nodes/search, blocked goal ${(100 * pBlocked / Math.max(1, pN)).toFixed(0)}%, not reached ${(100 * pFail / Math.max(1, pN)).toFixed(0)}%`
      + ` | queue avg ${(qSum / n).toFixed(1)} max ${qMax}`);
    ticks = []; pMs = 0; pN = 0; pNodes = 0; pBlocked = 0; pFail = 0; qMax = 0; qSum = 0;
  }
}
console.log(`  total ${((performance.now() - start) / 1000).toFixed(1)} s, tick p50 ${pct(all, 0.5).toFixed(2)} p95 ${pct(all, 0.95).toFixed(2)} ms; hash ${worldHash(world)}; winner ${world.gameOver ? world.winnerTeam : '-'}`);
