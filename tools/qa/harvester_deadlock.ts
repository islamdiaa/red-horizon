// QA repro: full harvesters converging on a FREE refinery dock deadlock each other when the dock
// sits in a pocket (refinery above, trees beside it) -- seen in AI game seed 12 at 10:40.
// node --import tsx tools/qa/harvester_deadlock.ts
import { building, check, flatMap, info, makeWorld, run, summary, unit, removeAllUnits } from './lib';

let anyFail = false;
for (const variant of ['open', 'pocket']) for (const n of [2, 3]) {
  const w = makeWorld(flatMap(48, 48), undefined, { credits: 0 });
  const p = w.players[0];
  building(w, p, 'fact', 10, 10);
  building(w, p, 'powr', 14, 10);
  const ref = building(w, p, 'proc', 20, 20); // dock cell (21, 23)
  const ref2 = building(w, p, 'proc', 30, 20); // a second, free refinery
  removeAllUnits(w);
  const [dx, dy] = ref.dockCell()!;
  if (variant === 'pocket') { w.map.tree[w.map.idx(dx + 1, dy)] = 1; w.map.tree[w.map.idx(dx + 1, dy + 1)] = 1; }
  const hs = [];
  // same relative positions as the seed-12 deadlock (dock centre 14.5,17.5)
  const rel = [[0.50, -0.11], [-0.23, 0.50], [-0.42, -0.41]];
  for (let k = 0; k < n; k++) {
    const h = unit(w, p, 'harv', dx + 0.5 + rel[k][0], dy + 0.5 + rel[k][1], -Math.PI / 2);
    h.cargo = 28; h.cargoValue = 28 * 25; h.hstate = 'toRefinery'; h.dockAt = ref.id;
    hs.push(h);
  }
  const ore0 = p.ore;
  run(w, 90);
  const delivered = hs.filter((h) => h.cargo < 28).length;
  info(`${variant}, ${n} trucks: after 90s cargo=[${hs.map((h) => h.cargo).join(',')}] states=[${hs.map((h) => h.hstate).join(',')}] pos=[${hs.map((h) => `${h.x.toFixed(2)},${h.y.toFixed(2)}`).join(' ')}] dock occupant=${ref.dockOccupant} income=$${(p.ore - ore0).toFixed(0)} 2nd refinery used=${hs.some((h) => h.dockAt === ref2.id)}`);
  if (!check(`${variant}: ${n} full harvesters converging on a free dock all unload within 90s`, delivered === n, `${delivered}/${n} unloaded`)) anyFail = true;
}
void anyFail;
process.exit(summary() ? 1 : 0);
