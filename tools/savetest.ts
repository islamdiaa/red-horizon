// Save/load determinism test: node --import tsx tools/savetest.ts [seed] [ceasefire minutes | inf]
// (with a build-up time the save is taken mid-ceasefire, which ends during the +4 min that follow)
import { generateMap } from '../src/sim/mapgen';
import { World, type PlayerSetup } from '../src/sim/world';
import { serializeWorld, deserializeWorld } from '../src/sim/save';
import { TICK_HZ } from '../src/sim/types';
import { ceasefireTicks } from '../src/sim/ceasefire';

const seed = +(process.argv[2] ?? 77);
const cf = process.argv[3] === 'inf' ? -1 : +(process.argv[3] ?? 0);
const mk = () => {
  const map = generateMap({ size: 64, players: 2, seed, water: 0.5, trees: 0.5, ore: 0.6 });
  const players: PlayerSetup[] = [
    { name: 'A', faction: 'allies', color: 0, team: 0, isHuman: false, ai: 'hard' },
    { name: 'B', faction: 'soviet', color: 0, team: 1, isHuman: false, ai: 'hard' },
  ];
  return new World({ map, players, credits: 8000, startUnits: 'light', fog: true, seed, ceasefireUntil: ceasefireTicks(cf) });
};
const hash = (w: World) => {
  let h = 2166136261;
  const mix = (v: number) => { h ^= Math.round(v * 1000) | 0; h = Math.imul(h, 16777619); };
  mix(w.tick);
  for (const u of w.units) { mix(u.id); mix(u.x); mix(u.y); mix(u.hp); mix(u.heading); }
  for (const b of w.buildings) { mix(b.id); mix(b.hp); }
  for (const p of w.players) { mix(p.cash); mix(p.ore); }
  for (let i = 0; i < w.map.ore.length; i++) mix(w.map.ore[i]);
  return (h >>> 0).toString(16) + ` u=${w.units.length} b=${w.buildings.length}`;
};
const A = mk();
for (let t = 0; t < TICK_HZ * 180; t++) { A.step(); A.events.length = 0; }
const json = JSON.stringify(serializeWorld(A));
console.log('save size', (json.length / 1024).toFixed(1), 'KB at tick', A.tick);
const B = mk();
deserializeWorld(B, JSON.parse(json));
console.log('after load  A', hash(A), ' B', hash(B));
for (let t = 0; t < TICK_HZ * 240; t++) { A.step(); A.events.length = 0; B.step(); B.events.length = 0; }
const ha = hash(A), hb = hash(B);
console.log('after +4min A', ha, ' B', hb, ha === hb ? 'DETERMINISTIC ✓' : 'DIVERGED ✗');
