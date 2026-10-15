// QA: balance part 2 -- aircraft, support units, early-game pacing.
// node --import tsx tools/qa/balance2.ts
import { UNITS, BUILDINGS } from '../../src/data/rules';
import { buildSeconds } from '../../src/sim/production';
import { addOre, building, flatMap, info, makeWorld, run, unit, until, type Unit, type World } from './lib';
import { TICK_HZ } from '../../src/sim/types';

function group(w: World, pid: number, type: string, n: number, x: number, y: number): Unit[] {
  const out: Unit[] = [];
  for (let k = 0; k < n; k++) out.push(unit(w, w.players[pid], type, x + (k % 4) * 0.7 * (pid ? 1 : -1), y + Math.floor(k / 4) * 0.7));
  return out;
}

console.log('\n## Aircraft');
{
  // 2 Longbows vs 3 Heavy Tanks (tanks cannot shoot back)
  const w = makeWorld(flatMap(64, 40), [{ faction: 'allies', human: true }, { faction: 'soviet' }]);
  const pad1 = building(w, w.players[0], 'hpad', 4, 18), pad2 = building(w, w.players[0], 'hpad', 4, 22);
  const hs = [unit(w, w.players[0], 'heli', pad1.x, pad1.y), unit(w, w.players[0], 'heli', pad2.x, pad2.y)];
  hs[0].homePad = pad1.id; hs[1].homePad = pad2.id;
  const ts = group(w, 1, '3tnk', 3, 40.5, 20.5);
  let t = 0;
  for (; t < 300 * TICK_HZ && ts.some((x) => x.alive); t++) {
    if (t % (TICK_HZ * 2) === 0) for (const h of hs) if (h.order.type === 'idle' && h.ammo === 6 && h.altitude === 0) { const tg = ts.find((x) => x.alive); if (tg) w.issue({ c: 'attack', player: 0, units: [h.id], target: tg.id }); }
    w.step(); w.events.length = 0;
  }
  info(`2 Longbows ($2400) vs 3 Heavy Tanks ($2850) with rearming: tanks dead ${ts.filter((x) => !x.alive).length}/3 after ${(t / TICK_HZ).toFixed(0)}s, helis lost ${hs.filter((h) => !h.alive).length} (tanks cannot fire at aircraft)`);
}
{
  // e3 vs Longbow
  const w = makeWorld(flatMap(48, 40), [{ faction: 'allies', human: true }, { faction: 'soviet' }]);
  const h = unit(w, w.players[0], 'heli', 10.5, 20.5); h.altitude = 1.55;
  const rs = group(w, 1, 'e3', 4, 30.5, 20.5);
  w.issue({ c: 'attack', player: 0, units: [h.id], target: rs[0].id });
  run(w, 40);
  info(`1 Longbow ($1200) attacking 4 Rocket Soldiers ($1200): heli ${h.alive ? `alive hp ${h.hp}` : 'shot down'}, rocket soldiers alive ${rs.filter((x) => x.alive).length}/4`);
}
{
  // Hind vs rifle squad
  const w = makeWorld(flatMap(48, 40), [{ faction: 'soviet', human: true }, { faction: 'allies' }]);
  const h = unit(w, w.players[0], 'hind', 10.5, 20.5); h.altitude = 1.55;
  const rs = group(w, 1, 'e1', 12, 30.5, 20.5);
  w.issue({ c: 'attack', player: 0, units: [h.id], target: rs[0].id });
  run(w, 60);
  info(`1 Hind ($1200) vs 12 Riflemen ($1200): riflemen killed ${rs.filter((x) => !x.alive).length}/12, Hind ammo left ${h.ammo}, alive=${h.alive}`);
}
for (const type of ['mig', 'yak']) {
  // sortie value vs a harvester and a refinery
  const w = makeWorld(flatMap(64, 40), [{ faction: 'soviet', human: true }, { faction: 'allies' }]);
  const af = building(w, w.players[0], 'afld', 4, 18);
  const a = unit(w, w.players[0], type, af.x, af.y); a.homePad = af.id;
  const harv = unit(w, w.players[1], 'harv', 45.5, 20.5);
  harv.order = { type: 'idle' }; harv.hstate = 'idle';
  w.issue({ c: 'attack', player: 0, units: [a.id], target: harv.id });
  run(w, 40);
  info(`1 ${UNITS[type].name} ($${UNITS[type].cost}) one sortie vs Ore Truck (600hp heavy): truck hp ${harv.alive ? harv.hp.toFixed(0) : 'destroyed'}`);
}

console.log('\n## Support units');
{
  // medic support: 10 e1 + 1 medic ($1800) vs 18 e1 ($1800)
  for (const withMedic of [true, false]) {
    const w = makeWorld(flatMap(60, 40));
    const A = group(w, 0, 'e1', withMedic ? 10 : 18, 18.5, 18.5);
    if (withMedic) A.push(unit(w, w.players[0], 'medi', 16.5, 19.5));
    const B = group(w, 1, 'e1', 18, 40.5, 18.5);
    w.issue({ c: 'move', player: 0, units: A.map((u) => u.id), x: 45, y: 20, attackMove: true });
    w.issue({ c: 'move', player: 1, units: B.map((u) => u.id), x: 15, y: 20, attackMove: true });
    run(w, 90);
    info(`${withMedic ? '10 e1 + 1 Medic' : '18 e1'} ($1800) vs 18 e1 ($1800): survivors ${A.filter((u) => u.alive).length} vs ${B.filter((u) => u.alive).length}`);
  }
}
{
  // tank crushing vs shooting: 3 Heavy Tanks vs 15 riflemen, attack-move vs direct move-through
  for (const mode of ['attack-move', 'drive-through']) {
    const w = makeWorld(flatMap(60, 40), [{ faction: 'soviet', human: true }, { faction: 'allies' }]);
    const T = group(w, 0, '3tnk', 3, 18.5, 19.5);
    const I = group(w, 1, 'e1', 15, 32.5, 18.5);
    w.issue({ c: 'move', player: 0, units: T.map((u) => u.id), x: 45, y: 20, attackMove: mode === 'attack-move' });
    w.issue({ c: 'move', player: 1, units: I.map((u) => u.id), x: 15, y: 20, attackMove: true });
    run(w, 60);
    info(`3 Heavy Tanks ($2850) ${mode} vs 15 riflemen ($1500): tanks alive ${T.filter((u) => u.alive).length}/3, riflemen alive ${I.filter((u) => u.alive).length}/15`);
  }
}

console.log('\n## Early-game pacing');
{
  // theoretical fastest first tank for a human: deploy -> powr -> proc -> weap -> 2tnk (sequential, $10000 start)
  for (const faction of ['allies', 'soviet'] as const) {
    const m = flatMap(64, 64);
    addOre(m, 30, 40, 36, 46);
    const w = makeWorld(m, [{ faction, human: true }, { faction: faction === 'allies' ? 'soviet' : 'allies' }], { credits: 10000 });
    const p = w.players[0];
    const mcv = unit(w, p, 'mcv', 20.5, 50.5);
    w.issue({ c: 'deploy', player: 0, units: [mcv.id] });
    const marks: string[] = [];
    let t0 = 0;
    const place = (type: string, cx: number, cy: number) => {
      w.issue({ c: 'build', player: 0, type });
      const d = until(w, 200, () => p.queues.structure.ready === type);
      t0 += d;
      w.issue({ c: 'place', player: 0, type, cx, cy });
      t0 += until(w, 5, () => p.has(type) && w.buildings.some((b) => b.bt.id === type && b.buildAnim >= 1));
      marks.push(`${type} ${t0.toFixed(0)}s`);
    };
    t0 += until(w, 10, () => p.has('fact'));
    place('powr', 23, 49);
    place('proc', 23, 45);
    place('weap', 16, 45);
    const tank = faction === 'allies' ? '2tnk' : '3tnk';
    w.issue({ c: 'build', player: 0, type: tank });
    t0 += until(w, 100, () => w.units.some((u) => u.ut.id === tank));
    marks.push(`first ${tank} ${t0.toFixed(0)}s`);
    info(`${faction}: fastest path ${marks.join(' -> ')}; credits left $${p.credits}`);
  }
  // build-time table
  const w = makeWorld(flatMap(32, 32), undefined, { credits: 10000 });
  const p = w.players[0];
  building(w, p, 'fact', 2, 2); building(w, p, 'apwr', 6, 2); building(w, p, 'tent', 10, 2); building(w, p, 'weap', 2, 6); building(w, p, 'hpad', 6, 6);
  run(w, 0.2);
  const ids = ['powr', 'proc', 'weap', 'tent', 'gun', 'e1', 'e3', '2tnk', 'harv', 'heli', 'mcv'];
  info('build seconds (1 factory, full power): ' + ids.map((id) => `${id} ${buildSeconds(w, p, id).toFixed(1)}`).join(', '));
}
