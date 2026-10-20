// Save cost breakdown on a big world: node --import tsx tools/qa/saveprof.ts [minutes=28] [size=128]
import { generateMap } from '../../src/sim/mapgen';
import { World, type PlayerSetup } from '../../src/sim/world';
import { TICK_HZ } from '../../src/sim/types';
import { ceasefireTicks } from '../../src/sim/ceasefire';
import { serializeWorld, deserializeWorld } from '../../src/sim/save';
import { worldHash } from '../../src/replay/hash';
const minutes = +(process.argv[2] ?? 28), size = +(process.argv[3] ?? 128), seed = 7;
const mk = () => {
  const map = generateMap({ size, players: 4, seed, water: 0.4, trees: 0.5, ore: 0.6 });
  const f = ['allies', 'soviet', 'soviet', 'allies'] as const;
  const players: PlayerSetup[] = f.map((fa, i) => ({ name: `P${i}`, faction: fa, color: 0, team: i, isHuman: false, ai: 'brutal' }));
  return new World({ map, players, credits: 10000, startUnits: 'mcv', fog: true, seed, ceasefireUntil: ceasefireTicks(30), rules: 'commander' });
};
const w = mk();
for (let t = 0; t < minutes * 60 * TICK_HZ; t++) { w.step(); w.events.length = 0; }
console.log('units', w.units.length, 'buildings', w.buildings.length);
const time = (label: string, fn: () => unknown, n = 10) => { fn(); const a = performance.now(); for (let i = 0; i < n; i++) fn(); console.log(label, ((performance.now() - a) / n).toFixed(2), 'ms'); };
let snap: any;
time('serializeWorld', () => { snap = serializeWorld(w); });
time('JSON.stringify', () => JSON.stringify(snap));
time('both', () => JSON.stringify(serializeWorld(w)));
const sizes: [string, number][] = Object.entries(snap).map(([k, v]) => [k, JSON.stringify(v ?? null).length]);
sizes.sort((a, b) => b[1] - a[1]);
console.log('top-level KB', sizes.slice(0, 10).map(([k, n]) => `${k}=${(n / 1024).toFixed(0)}`).join(' '));
const field = new Map<string, number>();
for (const e of snap.entities) for (const [k, v] of Object.entries(e)) field.set(k, (field.get(k) ?? 0) + JSON.stringify(v ?? null).length);
console.log('entity fields KB', [...field].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, n]) => `${k}=${(n / 1024).toFixed(0)}`).join(' '));
const pf = new Map<string, number>();
for (const p of snap.players) for (const [k, v] of Object.entries(p)) pf.set(k, (pf.get(k) ?? 0) + JSON.stringify(v ?? null).length);
console.log('player fields KB', [...pf].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, n]) => `${k}=${(n / 1024).toFixed(0)}`).join(' '));
const af = new Map<string, number>();
for (const a of snap.ais) for (const [k, v] of Object.entries(a.ext ?? {})) af.set(k, (af.get(k) ?? 0) + JSON.stringify(v ?? null).length);
console.log('ai ext KB', [...af].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, n]) => `${k}=${(n / 1024).toFixed(0)}`).join(' '));
const json = JSON.stringify(serializeWorld(w));
const b = mk();
time('parse+deserialize', () => { const x = mk(); deserializeWorld(x, JSON.parse(json)); }, 2);
deserializeWorld(b, JSON.parse(json));
console.log('hash equal after load', worldHash(w) === worldHash(b));
