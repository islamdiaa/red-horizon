// Headless AI-vs-AI simulation smoke test: node --import tsx tools/simtest.ts [seed] [minutes] [size] [players]
import { generateMap } from '../src/sim/mapgen';
import { World } from '../src/sim/world';
import { TICK_HZ } from '../src/sim/types';

const seed = +(process.argv[2] ?? 1234);
const minutes = +(process.argv[3] ?? 20);
const size = +(process.argv[4] ?? 96);
const nPlayers = +(process.argv[5] ?? 2);
const map = generateMap({ size, players: nPlayers, seed, water: 0.5, trees: 0.5, ore: 0.6 });

// ascii preview
const ch = (i: number) => map.ore[i] ? (map.gems[i] ? '*' : '$') : map.tree[i] ? 'T' : ['.', '~', '^', ':', ','][map.terrain[i]];
if (process.env.MAP) for (let y = 0; y < map.h; y += 2) {
  let row = '';
  for (let x = 0; x < map.w; x++) row += ch(map.idx(x, y));
  console.log(row);
}

const factions = ['allies', 'soviet', 'allies', 'soviet'] as const;
const diffs = (process.env.DIFF ?? 'normal,normal,normal,normal').split(',') as any[];
const world = new World({
  map,
  players: Array.from({ length: nPlayers }, (_, i) => ({ name: `P${i}`, faction: factions[i], color: 0xffffff, team: i, isHuman: false, ai: diffs[i] })),
  credits: 5000, startUnits: 'mcv', fog: true, seed,
});
const t0 = performance.now();
let maxTick = 0;
const report = () => {
  console.log(`--- t=${(world.time / 60).toFixed(1)}min units=${world.units.length} bld=${world.buildings.length} proj=${world.projectiles.length}`);
  for (const p of world.players) {
    const bs = world.buildings.filter((b) => b.owner === p).map((b) => b.bt.id);
    const us = world.units.filter((u) => u.owner === p);
    const ucount: Record<string, number> = {};
    for (const u of us) ucount[u.ut.id] = (ucount[u.ut.id] ?? 0) + 1;
    console.log(` ${p.name} ${p.faction} $${p.credits} pow ${p.powerOut}/${p.powerUse} harvested=${Math.round(p.stats.harvested)} kills=${p.stats.unitsKilled}/${p.stats.buildingsKilled} lost=${p.stats.unitsLost}/${p.stats.buildingsLost} ${p.defeated ? 'DEFEATED' : ''}`);
    console.log(`   bld: ${bs.join(',')}`);
    console.log(`   units: ${Object.entries(ucount).map(([k, v]) => k + 'x' + v).join(' ')}`);
  }
};
for (let t = 1; t <= minutes * 60 * TICK_HZ; t++) {
  const s = performance.now();
  world.step();
  maxTick = Math.max(maxTick, performance.now() - s);
  world.events.length = 0;
  if (t % (TICK_HZ * 120) === 0) report();
  if (world.gameOver) { report(); console.log('GAME OVER winner team', world.winnerTeam, 'at', (world.time / 60).toFixed(1), 'min'); break; }
}
for (const ai of world.ais as any[]) console.log('AI', ai.p.name, 'state', ai.state, 'wave', ai.wave.size, 'nextWave', ai.nextWaveValue);
const el = performance.now() - t0;
console.log(`sim ${world.tick} ticks in ${el.toFixed(0)}ms (${(el / world.tick).toFixed(3)} ms/tick, worst ${maxTick.toFixed(1)}ms)`);
