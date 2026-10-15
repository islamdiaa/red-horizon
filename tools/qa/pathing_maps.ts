// QA: how often do long move orders on real generated maps fail to arrive?
// node --import tsx tools/qa/pathing_maps.ts [trials]
import { floodReach } from '../../src/sim/mapgen';
import { check, generateMap, info, makeWorld, summary, unit, until, type Unit } from './lib';
import { Rng } from '../../src/core/rng';

const trials = +(process.argv[2] ?? 40);
let fails = 0, total = 0;
const failures: string[] = [];
for (const [seed, size] of [[11, 64], [22, 96], [33, 96], [44, 128], [55, 96], [66, 64]] as const) {
  const map = generateMap({ size, players: 2, seed, water: 0.5, trees: 0.5, ore: 0.6 });
  const s = map.startPositions[0];
  const reach = floodReach(map, Math.floor(s.x), Math.floor(s.y));
  const cells: number[] = [];
  for (let i = 0; i < map.w * map.h; i++) if (reach[i] && map.passable(i % map.w, (i / map.w) | 0) && !map.ore[i]) cells.push(i);
  const rng = new Rng(seed * 7);
  for (let k = 0; k < trials / 6; k++) {
    const w = makeWorld(map);
    const a = cells[rng.int(0, cells.length - 1)], b = cells[rng.int(0, cells.length - 1)];
    const ax = (a % map.w) + 0.5, ay = ((a / map.w) | 0) + 0.5, bx = (b % map.w) + 0.5, by = ((b / map.w) | 0) + 0.5;
    if (Math.hypot(ax - bx, ay - by) < 20) { k--; continue; }
    const u: Unit = unit(w, w.players[0], '2tnk', ax, ay);
    w.issue({ c: 'move', player: 0, units: [u.id], x: bx, y: by });
    // straight-line ETA x 4 + 20s
    const eta = Math.hypot(ax - bx, ay - by) / 1.4 * 4 + 20;
    until(w, eta, () => u.order.type === 'idle' && !u.path && !u.pathPending);
    const d = Math.hypot(u.x - bx, u.y - by);
    total++;
    if (d > 2) {
      fails++;
      failures.push(`seed ${seed} size ${size}: (${ax},${ay}) -> (${bx},${by}) stopped at (${u.x.toFixed(1)},${u.y.toFixed(1)}), ${d.toFixed(1)} cells short`);
    }
    // restore map state (units only; map unchanged)
  }
}
for (const f of failures) info(f);
check('Long move orders on generated maps arrive (>95%)', fails / total < 0.05, `${fails}/${total} moves (${Math.round(fails / total * 100)}%) stopped >2 cells short of a reachable destination`);
process.exit(summary() ? 1 : 0);
