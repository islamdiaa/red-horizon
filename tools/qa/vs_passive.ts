// QA: how quickly does each AI difficulty finish a passive human (deployed yard + 5 starting units, no actions)?
// Also compares AI #1 vs AI #2 in a 1-human-vs-2-AI game. node --import tsx tools/qa/vs_passive.ts
import { generateMap } from '../../src/sim/mapgen';
import { World } from '../../src/sim/world';
import { TICK_HZ } from '../../src/sim/types';
import { fmtTime } from './lib';

function game(seed: number, diffs: string[], minutes = 45) {
  const map = generateMap({ size: 96, players: 1 + diffs.length, seed, water: 0.5, trees: 0.5, ore: 0.6 });
  const fac = ['allies', 'soviet', 'soviet', 'allies'] as const;
  const w = new World({
    map, credits: 10000, startUnits: 'light', fog: true, seed,
    players: [{ name: 'Human', faction: 'allies', color: 0, team: 0, isHuman: true }, ...diffs.map((d, i) => ({ name: `AI${i}`, faction: fac[i + 1], color: 0, team: i + 1, isHuman: false, ai: d as any }))],
  });
  const h = w.players[0];
  const mcv = w.units.find((u) => u.owner === h && u.ut.deploysInto)!;
  w.issue({ c: 'deploy', player: 0, units: [mcv.id] });
  let firstHit = -1, firstBldLost = -1;
  const killsBy: number[] = diffs.map(() => 0);
  for (let t = 0; t < minutes * 60 * TICK_HZ; t++) {
    w.step();
    for (const ev of w.events) {
      if (ev.e === 'announce' && ev.player === 0 && (ev.key === 'base_under_attack' || ev.key === 'unit_lost') && firstHit < 0) firstHit = w.time;
      if (ev.e === 'announce' && ev.player === 0 && ev.key === 'structure_lost' && firstBldLost < 0) firstBldLost = w.time;
    }
    w.events.length = 0;
    if (h.defeated) break;
  }
  for (let i = 0; i < diffs.length; i++) killsBy[i] = w.players[i + 1].stats.unitsKilled + w.players[i + 1].stats.buildingsKilled;
  return { firstHit, firstBldLost, defeated: h.defeated ? w.time : -1, killsBy, waves: (w.ais as any[]).map((a) => a.nextWaveValue) };
}

console.log('## Passive human (yard + squad) vs one AI, 96 map');
for (const d of ['easy', 'normal', 'hard', 'brutal']) {
  const rs = [11, 12, 13].map((s) => game(s, [d]));
  console.log(`  ${d.padEnd(6)} first contact ${rs.map((r) => fmtTime(r.firstHit)).join(' / ')} | first structure lost ${rs.map((r) => fmtTime(r.firstBldLost)).join(' / ')} | human eliminated ${rs.map((r) => fmtTime(r.defeated)).join(' / ')}`);
}
console.log('\n## Passive human vs TWO normal AIs (AI#1 = world.ais[0], AI#2 = world.ais[1])');
for (const s of [21, 22, 23]) {
  const r = game(s, ['normal', 'normal']);
  console.log(`  seed ${s}: human eliminated ${fmtTime(r.defeated)}; kills on human by AI#1 ${r.killsBy[0]}, by AI#2 ${r.killsBy[1]}`);
}
