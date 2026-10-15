// QA: miscellaneous headless checks. node --import tsx tools/qa/misc.ts
import { building, check, flatMap, info, invariants, makeWorld, run, summary, unit, type Unit } from './lib';

console.log('\n### Wall drag over own units');
{
  const w = makeWorld(flatMap(48, 48), undefined, { credits: 5000 });
  const p = w.players[0];
  building(w, p, 'fact', 10, 10);
  const inf: Unit[] = [unit(w, p, 'e1', 16.5, 15.5), unit(w, p, '2tnk', 18.5, 15.5)];
  run(w, 0.2);
  p.queues.structure.ready = 'sbag';
  w.issue({ c: 'place', player: p.id, type: 'sbag', cx: 14, cy: 15, cx2: 22, cy2: 15 });
  run(w, 2);
  const inv = invariants(w).filter((i) => i.kind === 'unit-in-building');
  check('Dragging a wall line over own units does not trap them inside wall segments', inv.length === 0, inv.map((i) => i.detail).join('; '));
  // can they get out?
  w.issue({ c: 'move', player: p.id, units: inf.map((u) => u.id), x: 30.5, y: 30.5 });
  run(w, 20);
  info(`after move order: ${inf.map((u) => `${u.ut.id}@${u.x.toFixed(1)},${u.y.toFixed(1)}`).join(' ')}`);
}

console.log('\n### Simultaneous-fire order bias (mirror fights)');
{
  const res: string[] = [];
  for (const swap of [false, true]) {
    let p0wins = 0, p1wins = 0, p0left = 0, p1left = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const w = makeWorld(flatMap(60, 40), undefined, { seed });
      const A: Unit[] = [], B: Unit[] = [];
      for (let k = 0; k < 12; k++) {
        A.push(unit(w, w.players[swap ? 1 : 0], 'e1', 18.5 - (k % 4) * 0.7, 17.5 + Math.floor(k / 4) * 0.7));
        B.push(unit(w, w.players[swap ? 0 : 1], 'e1', 40.5 + (k % 4) * 0.7, 17.5 + Math.floor(k / 4) * 0.7));
      }
      w.issue({ c: 'move', player: swap ? 1 : 0, units: A.map((u) => u.id), x: 45, y: 18.5, attackMove: true });
      w.issue({ c: 'move', player: swap ? 0 : 1, units: B.map((u) => u.id), x: 14, y: 18.5, attackMove: true });
      run(w, 60);
      const a = A.filter((u) => u.alive).length, b = B.filter((u) => u.alive).length;
      const p0 = swap ? b : a, p1 = swap ? a : b;
      p0left += p0; p1left += p1;
      if (p0 > p1) p0wins++; else if (p1 > p0) p1wins++;
    }
    res.push(`${swap ? 'P0 on the right' : 'P0 on the left'}: P0 wins ${p0wins}/6, P1 wins ${p1wins}/6, survivors P0 ${p0left} vs P1 ${p1left}`);
  }
  for (const r of res) info(r);
  check('Identical 12 vs 12 rifle squads: no systematic advantage for the squad whose entities were created first', !res.some((r) => /wins 6\/6/.test(r)), res.join(' | '));
}

console.log('\n### Repair-then-sell');
{
  const w = makeWorld(flatMap(48, 48), undefined, { credits: 10000 });
  const p = w.players[0];
  building(w, p, 'fact', 10, 10);
  const wf = building(w, p, 'weap', 14, 10);
  wf.hp = wf.maxHp * 0.3;
  const c0 = p.credits;
  w.issue({ c: 'repair', player: p.id, building: wf.id });
  run(w, 40);
  const repaired = c0 - p.credits;
  w.issue({ c: 'sell', player: p.id, building: wf.id });
  run(w, 2);
  const net = p.credits - c0;
  info(`War Factory at 30%: sell directly = $${Math.floor(2000 * 0.5 * 0.3)}; repair ($${repaired.toFixed(0)}) then sell = net $${net.toFixed(0)}`);
  check('Repairing before selling is not a money exploit', net <= Math.floor(2000 * 0.5 * 0.3) + 1, `repair+sell nets $${net.toFixed(0)} vs $300 selling as-is`);
}

console.log('\n### Crates');
{
  // distribution of crate rewards (sim RNG) -- value per crate
  const w = makeWorld(flatMap(64, 64), [{ faction: 'soviet', human: true }, { faction: 'allies' }], { credits: 0 });
  w.cratesEnabled = true;
  const p = w.players[0];
  const runner = unit(w, p, 'e1', 32.5, 32.5);
  const counts: Record<string, number> = {};
  let money = 0;
  for (let k = 0; k < 200; k++) {
    w.crates.length = 0;
    w.crates.push({ id: 999999 + k, x: runner.x, y: runner.y });
    w.step();
    for (const ev of w.events) if (ev.e === 'crate') { counts[ev.reward] = (counts[ev.reward] ?? 0) + 1; if (ev.reward === 'money') money += ev.amount; }
    w.events.length = 0;
  }
  const spawned = w.units.filter((u) => u !== runner && u.owner === p).map((u) => u.ut.id);
  const byType: Record<string, number> = {};
  for (const t of spawned) byType[t] = (byType[t] ?? 0) + 1;
  info(`200 crates: ${JSON.stringify(counts)}; avg money crate $${(money / (counts.money ?? 1)).toFixed(0)}; units: ${JSON.stringify(byType)}`);
  info('Crates spawn every 45-80s (max 3 on the map), are always on in skirmish, and the AI never collects them on purpose.');
}
process.exit(summary() ? 1 : 0);
