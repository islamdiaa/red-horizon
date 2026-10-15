// QA diagnostic: why don't dominant AIs finish the game? node --import tsx tools/qa/stalemate_diag.ts <seed> <size> <minutes> [diffs]
import { generateMap } from '../../src/sim/mapgen';
import { World } from '../../src/sim/world';
import { TICK_HZ } from '../../src/sim/types';
const seed = +(process.argv[2] ?? 2), size = +(process.argv[3] ?? 96), minutes = +(process.argv[4] ?? 60);
const diffs = (process.argv[5] ?? 'normal,normal').split(',') as any[];
const map = generateMap({ size, players: diffs.length, seed, water: 0.5, trees: 0.5, ore: 0.6 });
const factions = ['allies', 'soviet', 'allies', 'soviet'] as const;
const w = new World({ map, credits: 10000, startUnits: 'mcv', fog: true, seed, players: diffs.map((d, i) => ({ name: `P${i}`, faction: factions[i], color: 0xffffff, team: i, isHuman: false, ai: d })) });
for (let t = 0; t < minutes * 60 * TICK_HZ && !w.gameOver; t++) { w.step(); w.events.length = 0; }
console.log(`t=${(w.time / 60).toFixed(1)}min gameOver=${w.gameOver}`);
for (const p of w.players) {
  const ai = (w.ais as any[]).find((a) => a.p === p);
  const bs = w.buildings.filter((b) => b.alive && b.owner === p);
  const us = w.units.filter((u) => u.alive && u.owner === p);
  console.log(`P${p.id} ${p.faction} $${p.credits} defeated=${p.defeated} AI state=${ai.state} stage=${ai.stage} wave=${ai.wave.size} waveStart=${ai.waveStart} nextWaveValue=${ai.nextWaveValue}`);
  console.log(`  buildings: ${bs.map((b) => `${b.bt.id}@${b.cx},${b.cy}`).join(' ')}`);
  const orders: Record<string, number> = {};
  for (const u of us) { const k = `${u.ut.id}:${u.order.type}`; orders[k] = (orders[k] ?? 0) + 1; }
  console.log(`  units by type:order: ${Object.entries(orders).map(([k, v]) => `${k}x${v}`).join(' ')}`);
  const army = us.filter((u) => u.weapons.length && !u.ut.harvester && u.kind !== 'aircraft' && !u.ut.medic);
  const idleVal = army.filter((u) => u.order.type === 'idle').reduce((s, u) => s + u.ut.cost, 0);
  console.log(`  army ${army.length} (idle value $${idleVal}); sample positions: ${army.slice(0, 12).map((u) => `${u.ut.id}(${u.x.toFixed(0)},${u.y.toFixed(0)},${u.order.type}${u.order.type === 'move' ? '->' + (u.order as any).x.toFixed(0) + ',' + (u.order as any).y.toFixed(0) : ''})`).join(' ')}`);
  const nonArmy = us.filter((u) => !army.includes(u));
  console.log(`  non-army: ${nonArmy.map((u) => `${u.ut.id}(${u.x.toFixed(0)},${u.y.toFixed(0)},${u.ut.harvester ? u.hstate : u.order.type})`).join(' ')}`);
}
