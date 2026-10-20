// Big-army performance: a long 4-player AI match (build-up time, then war), timing every tick.
//   node --import tsx tools/qa/bigarmy.ts [--size 128] [--players 4] [--diff brutal] [--minutes 60]
//     [--ceasefire 30] [--rules commander|classic] [--seed 7] [--every 5] [--hash 0] [--save 1] [--credits 10000] [--mem <minutes>]
// Prints, per --every game minutes: units, structures, simulation ms per tick (p50 / p95 / max), heap and the
// cost of a save (serialise + JSON). --hash N prints the world hash every N ticks (to compare two builds of the
// simulation for hash-identical optimisations).
import { generateMap } from '../../src/sim/mapgen';
import { World, type PlayerSetup } from '../../src/sim/world';
import { TICK_HZ } from '../../src/sim/types';
import { ceasefireTicks } from '../../src/sim/ceasefire';
import { serializeWorld } from '../../src/sim/save';
import { worldHash } from '../../src/replay/hash';
import type { AIDifficulty } from '../../src/sim/ai';

const arg = (k: string, d: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const size = +arg('size', '128'), nP = +arg('players', '4'), minutes = +arg('minutes', '60');
const diff = arg('diff', 'brutal') as AIDifficulty, cf = arg('ceasefire', '30');
const rules = arg('rules', 'commander') as 'commander' | 'classic', seed = +arg('seed', '7');
const every = +arg('every', '5'), hashEvery = +arg('hash', '0'), doSave = arg('save', '1') !== '0', credits = +arg('credits', '10000');

const map = generateMap({ size, players: nP, seed, water: 0.4, trees: 0.5, ore: 0.6 });
const factions = ['allies', 'soviet', 'soviet', 'allies'] as const;
const players: PlayerSetup[] = Array.from({ length: nP }, (_, i) => ({ name: `P${i}`, faction: factions[i % 4], color: 0, team: i, isHuman: false, ai: diff }));
const world = new World({
  map, players, credits, startUnits: 'mcv', fog: true, seed,
  ceasefireUntil: ceasefireTicks(cf === 'inf' ? -1 : +cf), rules: rules === 'commander' ? 'commander' : undefined,
});

/** Sizes of every array / Map / Set reachable from the world (depth-limited), to spot unbounded growth. */
function collections(root: unknown): Map<string, number> {
  const out = new Map<string, number>();
  const seen = new Set<unknown>();
  const walk = (v: any, path: string, depth: number) => {
    if (!v || typeof v !== 'object' || seen.has(v) || depth > 4 || ArrayBuffer.isView(v)) return;
    seen.add(v);
    if (v instanceof Map || v instanceof Set) { out.set(path, v.size); if (v.size < 2000) for (const [k, x] of (v instanceof Map ? v : new Map([...v].map((x, i) => [i, x])))) if (typeof k !== 'number') walk(x, path + '.' + String(k), depth + 1); return; }
    if (Array.isArray(v)) { out.set(path, v.length); if (path.endsWith('.units') || path.endsWith('.buildings')) return; for (let i = 0; i < Math.min(v.length, 8); i++) walk(v[i], path + '[]', depth + 1); return; }
    if (v.constructor?.name === 'Unit' || v.constructor?.name === 'Building' || v.constructor?.name === 'World' && depth > 0) return;
    for (const k of Object.keys(v)) walk(v[k], path + '.' + k, depth + 1);
  };
  walk(root, 'w', 0);
  return out;
}
const memEvery = +arg('mem', '0');
const memSnaps: Map<string, number>[] = [];
const pct = (a: number[], q: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0; };
let bucket: number[] = [], all: number[] = [];
let aiMs = 0, aiMax = 0;
for (const ai of world.ais) { const f = ai.think.bind(ai); ai.think = () => { const a = performance.now(); f(); const d = performance.now() - a; aiMs += d; aiMax = Math.max(aiMax, d); }; }
const t0 = performance.now();
console.log(`bigarmy size=${size} players=${nP} diff=${diff} rules=${rules} ceasefire=${cf} seed=${seed}`);
console.log('min  units bld proj |  p50   p95    max ms/tick | AI ms/tick max | heapMB | save ms  KB');
const total = minutes * 60 * TICK_HZ;
for (let t = 1; t <= total; t++) {
  const s = performance.now();
  world.step();
  const d = performance.now() - s;
  world.events.length = 0;
  bucket.push(d); all.push(d);
  if (hashEvery && t % hashEvery === 0) console.log(`hash ${t} ${worldHash(world)}`);
  if (t % (every * 60 * TICK_HZ) === 0 || t === total || world.gameOver) {
    let saveMs = 0, kb = 0;
    if (doSave) { const a = performance.now(); const js = JSON.stringify(serializeWorld(world)); saveMs = performance.now() - a; kb = js.length / 1024; }
    const heap = process.memoryUsage().heapUsed / 1048576;
    console.log(`${(t / TICK_HZ / 60).toFixed(0).padStart(3)} ${String(world.units.length).padStart(6)} ${String(world.buildings.length).padStart(3)} ${String(world.projectiles.length).padStart(4)} | ${pct(bucket, 0.5).toFixed(2).padStart(5)} ${pct(bucket, 0.95).toFixed(2).padStart(5)} ${Math.max(...bucket).toFixed(1).padStart(6)}         | ${(aiMs / bucket.length).toFixed(2).padStart(5)} ${aiMax.toFixed(1).padStart(5)} | ${heap.toFixed(0).padStart(6)} | ${saveMs.toFixed(1).padStart(6)} ${kb.toFixed(0)}`);
    bucket = []; aiMs = 0; aiMax = 0;
  }
  if (memEvery && t % (memEvery * 60 * TICK_HZ) === 0) memSnaps.push(collections(world));
  if (world.gameOver) { console.log('game over at', (world.tick / TICK_HZ / 60).toFixed(1), 'min, winner team', world.winnerTeam); break; }
}
const el = performance.now() - t0;
console.log(`total ${world.tick} ticks ${(el / 1000).toFixed(1)} s: mean ${(el / world.tick).toFixed(2)} ms/tick, p50 ${pct(all, 0.5).toFixed(2)} p95 ${pct(all, 0.95).toFixed(2)} p99 ${pct(all, 0.99).toFixed(2)} max ${Math.max(...all).toFixed(1)}`);
console.log(`final hash ${worldHash(world)}`);
if (memSnaps.length > 1) {
  const a = memSnaps[0], b = memSnaps[memSnaps.length - 1];
  const grow = [...b].map(([k, n]) => [k, n, a.get(k) ?? 0] as const).filter(([, n, m]) => n > m + 50 && n > m * 1.5).sort((x, y) => (y[1] - y[2]) - (x[1] - x[2]));
  console.log('collections that grew (first -> last snapshot):', grow.length ? '' : 'none');
  for (const [k, n, m] of grow.slice(0, 20)) console.log(`  ${k}: ${m} -> ${n}   (${memSnaps.map((s) => s.get(k) ?? 0).join(' ')})`);
}
for (const p of world.players) console.log(` ${p.name} ${p.faction} units=${world.units.filter((u) => u.owner === p).length} bld=${world.buildings.filter((b) => b.owner === p).length} $${Math.round(p.cash)} ${p.defeated ? 'DEFEATED' : ''}`);
