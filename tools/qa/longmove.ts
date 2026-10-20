// Long player moves: tanks ordered across a big map (around lakes, over bridges), alone or while three Brutal AIs
// fight on the same map. Reports how long each move takes to start (first path) and to arrive, and the moves
// that never start or stall.
//   node --import tsx tools/qa/longmove.ts [--size 192] [--seed 3] [--water 0.6] [--moves 12] [--ai 0|1] [--warm 32]
import { generateMap } from '../../src/sim/mapgen';
import { World, type PlayerSetup } from '../../src/sim/world';
import { TICK_HZ } from '../../src/sim/types';
import { ceasefireTicks } from '../../src/sim/ceasefire';
import type { Unit } from '../../src/sim/entities';
import { FRng } from './fuzz';

const arg = (k: string, d: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const size = +arg('size', '192'), seed = +arg('seed', '3'), water = +arg('water', '0.6'), moves = +arg('moves', '12');
const withAI = arg('ai', '1') !== '0', warm = +arg('warm', '32');

const map = generateMap({ size, players: 4, seed, water, trees: 0.5, ore: 0.6 });
const factions = ['allies', 'soviet', 'soviet', 'allies'] as const;
const players: PlayerSetup[] = factions.map((f, i) => ({ name: `P${i}`, faction: f, color: 0, team: i, isHuman: i === 0 || !withAI, ai: i === 0 || !withAI ? undefined : 'brutal' }));
const w = new World({ map, players, credits: 10000, startUnits: 'mcv', startUnitsPer: ['none', 'mcv', 'mcv', 'mcv'], fog: false, seed, ceasefireUntil: ceasefireTicks(30), rules: 'commander' });
w.cratesEnabled = false;
const t0 = performance.now();
if (withAI) for (let t = 0; t < warm * 60 * TICK_HZ; t++) { w.step(); w.events.length = 0; }
w.players[0].defeated = false; // (the test player owns nothing until its tanks arrive below)
const m = w.map;

// ground distance from a cell (BFS, 8-connected without corner cutting, as the pathfinder moves)
function bfs(from: number): Int32Array {
  const d = new Int32Array(m.w * m.h).fill(-1), q = new Int32Array(m.w * m.h);
  let h = 0, t = 0;
  d[from] = 0; q[t++] = from;
  while (h < t) {
    const c = q[h++], cx = c % m.w, cy = (c / m.w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (!m.inBounds(nx, ny)) continue;
      const ni = m.idx(nx, ny);
      if (d[ni] >= 0 || !m.passableIdx(ni)) continue;
      if (dx && dy && (!m.passableIdx(m.idx(cx + dx, cy)) || !m.passableIdx(m.idx(cx, cy + dy)))) continue;
      d[ni] = d[c] + 1; q[t++] = ni;
    }
  }
  return d;
}

const r = new FRng(seed * 97 + 5);
interface Trial { u: Unit; gx: number; gy: number; route: number; start: number; firstPath: number; nullTicks: number; arrived: number; limit: number }
const trials: Trial[] = [];
for (let k = 0, tries = 0; k < moves && tries < 4000; tries++) {
  const s = m.idx(r.int(2, m.w - 3), r.int(2, m.h - 3));
  if (!m.passableIdx(s)) continue;
  const d = bfs(s);
  const far: number[] = [];
  for (let i = 0; i < d.length; i++) if (d[i] >= size * 0.6) far.push(i);
  if (!far.length) continue;
  const g = r.pick(far);
  const sx = s % m.w + 0.5, sy = ((s / m.w) | 0) + 0.5;
  const u = w.addUnit('2tnk', w.players[0], sx, sy);
  u.stance = 'passive'; u.invulnerable = 1e9; // (the AIs' war must neither kill nor distract the test tanks)
  const gx = g % m.w + 0.5, gy = ((g / m.w) | 0) + 0.5;
  w.issue({ c: 'move', player: 0, units: [u.id], x: gx, y: gy });
  trials.push({ u, gx, gy, route: d[g], start: w.tick, firstPath: -1, nullTicks: 0, arrived: -1, limit: Math.ceil(d[g] * 1.6 / 1.2 + 60) * TICK_HZ });
  k++;
}
(w as any).dirtyLists = true;
const tickMs: number[] = [];
const maxLimit = Math.max(...trials.map((t) => t.limit));
for (let t = 0; t < maxLimit && trials.some((x) => x.arrived < 0 && w.tick - x.start < x.limit); t++) {
  const a = performance.now();
  w.step(); w.events.length = 0;
  tickMs.push(performance.now() - a);
  for (const x of trials) {
    if (x.arrived >= 0 || !x.u.alive) continue;
    if (x.firstPath < 0 && x.u.path) x.firstPath = w.tick - x.start;
    if (!x.u.path) x.nullTicks++;
    if (Math.hypot(x.u.x - x.gx, x.u.y - x.gy) < 2) x.arrived = w.tick - x.start;
  }
}
const s = [...tickMs].sort((a, b) => a - b), q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
console.log(`longmove size=${size} seed=${seed} water=${water} ai=${withAI ? 'brutal x3 after ' + warm + ' min' : 'none'} units=${w.units.length}: ${trials.length} moves, ${((performance.now() - t0) / 1000).toFixed(0)} s`);
let bad = 0;
for (const x of trials) {
  const ok = x.arrived >= 0 && x.firstPath >= 0 && x.firstPath <= TICK_HZ;
  if (!ok) bad++;
  console.log(`  route ${String(x.route).padStart(3)} cells: first path ${x.firstPath < 0 ? 'NEVER' : (x.firstPath / TICK_HZ).toFixed(2) + ' s'}, ${x.arrived >= 0 ? 'arrived ' + (x.arrived / TICK_HZ).toFixed(0) + ' s' : !x.u.alive ? 'destroyed' : 'NOT ARRIVED (at ' + x.u.x.toFixed(0) + ',' + x.u.y.toFixed(0) + ' ' + Math.hypot(x.u.x - x.gx, x.u.y - x.gy).toFixed(0) + ' cells short)'}, ${(x.nullTicks / TICK_HZ).toFixed(1)} s without a path${ok ? '' : '  <--'}`);
}
console.log(`  ${trials.length - bad}/${trials.length} started within 1 s and arrived; ms/tick p50 ${q(0.5).toFixed(2)} p95 ${q(0.95).toFixed(2)} max ${q(1).toFixed(1)}`);
