// QA: superweapons. node --import tsx tools/qa/superweapons.ts
import { superReady } from '../../src/sim/superweapons';
import { building, check, flatMap, info, makeWorld, run, runCollect, setTerrain, summary, T, unit, until, type World } from './lib';

function base(faction: 'allies' | 'soviet') {
  const w = makeWorld(flatMap(64, 64), [{ faction, human: true }, { faction: faction === 'allies' ? 'soviet' : 'allies' }], { fog: true });
  const p = w.players[0];
  building(w, p, 'fact', 5, 50);
  for (let k = 0; k < 4; k++) building(w, p, 'apwr', 9 + k * 3, 50);
  building(w, p, 'dome', 5, 54);
  return { w, p, e: w.players[1] };
}

console.log('\n### Nuke');
{
  const { w, p, e } = base('soviet');
  const silo = building(w, p, 'mslo', 5, 46);
  check('Nuke not ready immediately', !superReady(w, p, 'nuke'));
  const t = until(w, 400, () => superReady(w, p, 'nuke'));
  check('Nuke charges in 5:00 at full power', Math.abs(t - 300) < 2, `${t.toFixed(1)}s`);
  const fact = building(w, e, 'fact', 45, 10);
  const pw = building(w, e, 'powr', 49, 10);
  const tanks = [unit(w, e, '2tnk', 46.5, 14.5), unit(w, e, 'e1', 47.5, 14.5)];
  // target is in the shroud (never explored)
  info(`target explored by attacker: ${p.explored[w.map.idx(46, 11)] ? 'yes' : 'no'}`);
  w.issue({ c: 'superweapon', player: p.id, kind: 'nuke', x: 46.5, y: 11.5 });
  const evs = runCollect(w, 12);
  check('Nuke launches and impacts', evs.some((ev) => ev.e === 'impact' && ev.kind === 'nuke'));
  info(`after nuke: Construction Yard ${fact.hp.toFixed(0)}/${fact.maxHp}, Power Plant ${pw.alive ? pw.hp.toFixed(0) : 'destroyed'}, Medium Tank ${tanks[0].alive ? tanks[0].hp.toFixed(0) : 'destroyed'}, rifleman ${tanks[1].alive ? 'alive' : 'dead'}`);
  check('Nuke charge reset after launch', p.superCharge.nuke < 20);
  void silo;
  // low power pauses charging
  const { w: w2, p: p2 } = base('soviet');
  building(w2, p2, 'mslo', 5, 46);
  for (const b of w2.buildings.filter((b) => b.bt.id === 'apwr')) w2.kill(b);
  run(w2, 30);
  check('Nuke charge pauses under low power', p2.lowPower && p2.superCharge.nuke === 0, `charge ${p2.superCharge.nuke.toFixed(1)} lowPower=${p2.lowPower}`);
  // nuke aimed outside the map (e.g. clicking the horizon in targeting mode)
  const { w: w3, p: p3 } = base('soviet');
  building(w3, p3, 'mslo', 5, 46);
  p3.superCharge.nuke = 300;
  w3.issue({ c: 'superweapon', player: p3.id, kind: 'nuke', x: -30, y: 90 });
  run(w3, 15);
  check('Superweapon targeted outside the map is rejected (not wasted)', p3.superCharge.nuke >= 299, `charge after off-map launch: ${p3.superCharge.nuke.toFixed(0)}`);
}

console.log('\n### Iron Curtain');
{
  const { w, p, e } = base('soviet');
  building(w, p, 'stek', 15, 54);
  building(w, p, 'iron', 20, 54);
  p.superCharge.ironcurtain = 240;
  run(w, 0.1);
  const t = unit(w, p, '3tnk', 30.5, 30.5);
  const t2 = unit(w, p, '3tnk', 31.5, 30.5);
  w.issue({ c: 'superweapon', player: p.id, kind: 'ironcurtain', x: 30.5, y: 30.5 });
  run(w, 0.2);
  check('Iron Curtain makes units invulnerable', t.invulnerable > 20 && t2.invulnerable > 20);
  const foe = unit(w, e, '2tnk', 33.5, 30.5);
  run(w, 10);
  check('Invulnerable unit takes no damage', t.hp === t.maxHp);
  void foe;
  // fired at empty ground: is the charge wasted?
  p.superCharge.ironcurtain = 240;
  run(w, 0.1);
  const evs = runCollect(w, 0.1);
  void evs;
  w.issue({ c: 'superweapon', player: p.id, kind: 'ironcurtain', x: 50.5, y: 50.5 });
  run(w, 0.2);
  check('Iron Curtain on empty ground does not waste the charge', p.superCharge.ironcurtain > 200, `charge now ${p.superCharge.ironcurtain.toFixed(1)}`);
  // on own building
  p.superCharge.ironcurtain = 240;
  const st = w.buildings.find((b) => b.bt.id === 'stek')!;
  w.issue({ c: 'superweapon', player: p.id, kind: 'ironcurtain', x: st.x, y: st.y });
  run(w, 0.2);
  check('Iron Curtain on the centre of a 3x3 structure protects it', st.invulnerable > 0, `invulnerable=${st.invulnerable}`);
  p.superCharge.ironcurtain = 240;
  const ap = w.buildings.find((b) => b.bt.id === 'apwr')!;
  w.issue({ c: 'superweapon', player: p.id, kind: 'ironcurtain', x: ap.cx + 0.2, y: ap.cy + 0.2 });
  run(w, 0.2);
  info(`Iron Curtain clicked on the corner of a 3x3 power plant: invulnerable=${ap.invulnerable.toFixed(1)}`);
}

console.log('\n### Chronosphere');
{
  const { w, p, e } = base('allies');
  building(w, p, 'atek', 15, 54);
  building(w, p, 'pdox', 20, 54);
  p.superCharge.chrono = 240;
  run(w, 0.1);
  const tank = unit(w, p, '2tnk', 30.5, 50.5);
  const inf = unit(w, p, 'e1', 31.5, 50.5);
  // no unit
  w.issue({ c: 'superweapon', player: p.id, kind: 'chrono', x: 40.5, y: 20.5 });
  run(w, 0.1);
  check('Chrono with no unit does not consume charge', p.superCharge.chrono >= 239);
  w.issue({ c: 'superweapon', player: p.id, kind: 'chrono', x: 40.5, y: 20.5, unit: inf.id });
  run(w, 0.1);
  check('Chrono refuses infantry', Math.abs(inf.x - 31.5) < 0.5 && p.superCharge.chrono >= 239);
  setTerrain(w.map, 50, 50, 55, 55, T.Water);
  w.issue({ c: 'superweapon', player: p.id, kind: 'chrono', x: 52.5, y: 52.5, unit: tank.id });
  run(w, 0.1);
  check('Chrono refuses water target', Math.abs(tank.x - 30.5) < 0.5 && p.superCharge.chrono >= 239);
  const eb = building(w, e, 'fact', 40, 10);
  w.issue({ c: 'superweapon', player: p.id, kind: 'chrono', x: 41.5, y: 11.5, unit: tank.id });
  run(w, 0.1);
  check('Chrono refuses a target inside a building', Math.abs(tank.x - 30.5) < 0.5);
  info(`chrono target in shroud: explored=${p.explored[w.map.idx(45, 20)]}`);
  w.issue({ c: 'superweapon', player: p.id, kind: 'chrono', x: 45.5, y: 20.5, unit: tank.id });
  run(w, 0.1);
  info(`tank after chrono into unexplored shroud: ${tank.x.toFixed(1)},${tank.y.toFixed(1)}, charge ${p.superCharge.chrono.toFixed(0)}`);
  check('Chrono teleports a vehicle', Math.abs(tank.x - 45.5) < 0.1 && p.superCharge.chrono < 1);
  void eb;
  // Chrono an enemy vehicle?
  p.superCharge.chrono = 240;
  const et = unit(w, e, '3tnk', 20.5, 20.5);
  w.issue({ c: 'superweapon', player: p.id, kind: 'chrono', x: 2.5, y: 2.5, unit: et.id });
  run(w, 0.1);
  check('Chrono cannot move enemy vehicles', Math.abs(et.x - 20.5) < 0.5);
  // chrono onto a cell occupied by another vehicle
  p.superCharge.chrono = 240;
  const occ = unit(w, p, '2tnk', 10.5, 40.5);
  const t2 = unit(w, p, '2tnk', 30.5, 40.5);
  w.issue({ c: 'superweapon', player: p.id, kind: 'chrono', x: 10.5, y: 40.5, unit: t2.id });
  run(w, 0.05);
  info(`chrono onto an occupied cell: distance between the two tanks right after = ${Math.hypot(occ.x - t2.x, occ.y - t2.y).toFixed(2)} (0 = stacked)`);
  // chrono harvester / MCV allowed?
  p.superCharge.chrono = 240;
  const h = unit(w, p, 'harv', 30.5, 45.5);
  w.issue({ c: 'superweapon', player: p.id, kind: 'chrono', x: 45.5, y: 25.5, unit: h.id });
  run(w, 0.1);
  info(`chrono on Ore Truck allowed: ${Math.abs(h.x - 45.5) < 0.1}`);
}

process.exit(summary() ? 1 : 0);
