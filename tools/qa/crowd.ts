// Crowd pathing: a human-style group order for a big army across a bridge (or any chokepoint) and back.
//   node --import tsx tools/qa/crowd.ts [--units 300] [--seed 4] [--size 128] [--mix tanks|mixed] [--seconds 150] [--flat] [--two-way]
// Reports how many units arrive, how long the last one took and the units that made no progress for 20 s.
import { generateMap } from '../../src/sim/mapgen';
import { GameMap } from '../../src/sim/map';
import { World } from '../../src/sim/world';
import { TICK_HZ } from '../../src/sim/types';
import { watchStuck } from './stuck';

const arg = (k: string, d: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const N = +arg('units', '300'), seed = +arg('seed', '4'), size = +arg('size', '128'), mix = arg('mix', 'mixed'), secs = +arg('seconds', '150');

const flat = process.argv.includes('--flat'); // open ground: crowd dynamics only, no chokepoint
const map = flat ? Object.assign(new GameMap(size, size), { startPositions: [{ x: 10.5, y: 10.5 }, { x: size - 10.5, y: size - 10.5 }] }) : generateMap({ size, players: 2, seed, water: 0.7, trees: 0.4, ore: 0.5 });
const w = new World({ map, players: [
  { name: 'A', faction: 'soviet', color: 0, team: 0, isHuman: true }, { name: 'B', faction: 'allies', color: 0, team: 1, isHuman: true },
], credits: 0, startUnits: 'none', fog: false, seed });
w.cratesEnabled = false;
const p = w.players[0];
// the bridge nearest the map centre: the army starts on one side, the goal is on the other
const br = flat ? { id: 0, cells: [[size / 2, size / 2]] as [number, number][], axis: 'x' as const } : [...w.bridges].sort((a, b) => Math.hypot(a.cells[0][0] - size / 2, a.cells[0][1] - size / 2) - Math.hypot(b.cells[0][0] - size / 2, b.cells[0][1] - size / 2))[0];
if (!br) { console.log('no bridge on this map'); process.exit(0); }
const [bx, by] = br.cells[Math.floor(br.cells.length / 2)];
const along = br.axis === 'x' ? [1, 0] : [0, 1];
const reach = br.cells.length / 2 + 14;
const from = [bx - along[0] * reach, by - along[1] * reach], to = [bx + along[0] * reach, by + along[1] * reach];
const types = mix === 'tanks' ? ['3tnk'] : ['3tnk', 'e1', 'e1', 'v2rl', '4tnk', 'e3', 'harv', '3tnk'];
const twoWay = process.argv.includes('--two-way'); // half the army starts on the far side: both halves cross at once
const ids: number[] = [], far: number[] = [];
for (let k = 0; k < N; k++) {
  const side = twoWay && k % 2 ? to : from;
  const [x, y] = w.findFreeSpot(side[0] + (k % 17) - 8, side[1] + Math.floor(k / 17) % 17 - 8, 14, true);
  (side === to ? far : ids).push(w.addUnit(types[k % types.length], p, x, y).id);
}
if (twoWay) {
  w.issue({ c: 'move', player: 0, units: far, x: from[0], y: from[1] });
  w.issue({ c: 'move', player: 0, units: ids, x: to[0], y: to[1] });
  const watch2 = watchStuck(w);
  let done = -1;
  for (let t = 1; t <= secs * TICK_HZ; t++) {
    w.step(); w.events.length = 0;
    if (t % TICK_HZ) continue;
    watch2.check();
    const ok = (list: number[], g: number[]) => list.map((id) => w.entities.get(id)).filter((u) => u && u.alive && Math.hypot(u.x - g[0], u.y - g[1]) < 14).length;
    const a = ok(ids, to), b = ok(far, from);
    if (a + b === N) { done = t / TICK_HZ; break; }
    if (t === secs * TICK_HZ) console.log(`  two-way: ${a}/${ids.length} and ${b}/${far.length} across after ${secs} s`);
  }
  if (done >= 0) console.log(`  two-way: all ${N} across after ${done.toFixed(0)} s`);
  console.log(`  no progress for 20 s: ${watch2.reports.filter((r) => r.kind === 'no-progress').length} units`);
  process.exit(0);
}
const watch = watchStuck(w);
console.log(`crowd ${N} ${mix} units, bridge ${br.id} (${br.cells.length} cells, axis ${br.axis}) from (${from.map((v) => v.toFixed(0))}) to (${to.map((v) => v.toFixed(0))})`);
for (const [leg, goal] of [['out', to], ['back', from]] as const) {
  w.issue({ c: 'move', player: 0, units: ids, x: goal[0], y: goal[1] });
  let last = -1;
  const t0 = w.tick;
  for (let t = 1; t <= secs * TICK_HZ; t++) {
    w.step(); w.events.length = 0;
    if (t % TICK_HZ === 0) {
      watch.check();
      const alive = ids.map((id) => w.entities.get(id)).filter((u) => u && u.alive);
      const there = alive.filter((u) => Math.hypot(u!.x - goal[0], u!.y - goal[1]) < 14).length;
      if (there === alive.length) { last = (w.tick - t0) / TICK_HZ; break; }
      if (t === secs * TICK_HZ) console.log(`  ${leg}: ${there}/${alive.length} within 14 cells after ${secs} s`);
    }
  }
  if (last >= 0) console.log(`  ${leg}: all ${ids.length} within 14 cells of the goal after ${last.toFixed(0)} s`);
}
const stuck = watch.reports.filter((r) => r.kind === 'no-progress');
console.log(`  no progress for 20 s: ${stuck.length} units`);
for (const r of stuck.slice(0, 8)) console.log(`    t=${r.t.toFixed(0)}s ${r.detail}`);
