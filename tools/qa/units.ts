// QA: unit movement, orders and abilities. node --import tsx tools/qa/units.ts
import {
  addTrees, building, check, flatMap, info, makeWorld, run, runCollect, setTerrain, summary, T, unit, until, invariants, type World, Unit, Building, remove,
} from './lib';

const inBox = (u: Unit, x: number, y: number, r: number) => Math.hypot(u.x - x, u.y - y) <= r;
const stuckReport = (us: Unit[], x: number, y: number, r: number) => us.filter((u) => u.alive && !inBox(u, x, y, r)).map((u) => `${u.ut.id}@${u.x.toFixed(1)},${u.y.toFixed(1)}`).join(' ');

// ---------------------------------------------------------------------------
console.log('\n### Movement: group move, formation, waypoints');
{
  const w = makeWorld(flatMap(64, 64));
  const p = w.players[0];
  const us: Unit[] = [];
  for (let k = 0; k < 8; k++) us.push(unit(w, p, '2tnk', 10.5 + (k % 4), 50.5 + Math.floor(k / 4)));
  for (let k = 0; k < 12; k++) us.push(unit(w, p, 'e1', 10.3 + (k % 6) * 0.5, 53.3 + Math.floor(k / 6) * 0.5));
  us.push(unit(w, p, 'arty', 15.5, 52.5));
  w.issue({ c: 'move', player: p.id, units: us.map((u) => u.id), x: 50.5, y: 12.5 });
  const t = until(w, 90, () => us.every((u) => u.order.type === 'idle'));
  const far = us.filter((u) => !inBox(u, 50.5, 12.5, 6));
  check('Mixed group (8 tanks, 12 inf, arty) reaches destination 55 cells away', t > 0 && far.length === 0, `done in ${t.toFixed(1)}s; not arrived: ${stuckReport(us, 50.5, 12.5, 6)}`);
  // arrival spread
  const xs = us.map((u) => u.x), ys = us.map((u) => u.y);
  info(`final bbox ${Math.min(...xs).toFixed(1)}..${Math.max(...xs).toFixed(1)} x ${Math.min(...ys).toFixed(1)}..${Math.max(...ys).toFixed(1)}`);
  const inv = invariants(w);
  check('No overlap/invariant problems after group move', inv.length === 0, inv.map((i) => i.detail).join('; '));
}
{
  // group travels at pace of slowest
  const w = makeWorld(flatMap(64, 64));
  const p = w.players[0];
  const fast = unit(w, p, 'jeep', 10.5, 30.5), slow = unit(w, p, '4tnk', 11.5, 30.5);
  void slow;
  w.players[0].faction = 'allies';
  w.issue({ c: 'move', player: p.id, units: [fast.id, slow.id], x: 50.5, y: 30.5 });
  run(w, 6);
  info(`after 6s: jeep x=${fast.x.toFixed(1)} mammoth x=${slow.x.toFixed(1)} (group speed cap)`);
  check('Mixed-speed group moves together', Math.abs(fast.x - slow.x) < 3);
}
{
  // waypoints (queue)
  const w = makeWorld(flatMap(48, 48));
  const p = w.players[0];
  const u = unit(w, p, '2tnk', 5.5, 5.5);
  w.issue({ c: 'move', player: p.id, units: [u.id], x: 30.5, y: 5.5 });
  w.issue({ c: 'move', player: p.id, units: [u.id], x: 30.5, y: 30.5, queue: true });
  w.issue({ c: 'move', player: p.id, units: [u.id], x: 5.5, y: 30.5, queue: true });
  let visitedA = false, visitedB = false;
  run(w, 60, () => { if (inBox(u, 30.5, 5.5, 1)) visitedA = true; if (inBox(u, 30.5, 30.5, 1)) visitedB = true; });
  check('Shift-queued waypoints are visited in order', visitedA && visitedB && inBox(u, 5.5, 30.5, 1), `A=${visitedA} B=${visitedB} end=${u.x.toFixed(1)},${u.y.toFixed(1)}`);
  // queue on an idle unit
  const u2 = unit(w, p, '2tnk', 10.5, 40.5);
  w.issue({ c: 'move', player: p.id, units: [u2.id], x: 20.5, y: 40.5, queue: true });
  run(w, 10);
  check('Shift-move on an idle unit starts moving immediately', inBox(u2, 20.5, 40.5, 1));
  // queued group: formation per waypoint and speed cap kept?
  const a = unit(w, p, 'jeep', 5.5, 44.5), b = unit(w, p, '1tnk', 6.5, 44.5);
  w.issue({ c: 'move', player: p.id, units: [a.id, b.id], x: 20.5, y: 44.5 });
  w.issue({ c: 'move', player: p.id, units: [a.id, b.id], x: 40.5, y: 44.5, queue: true });
  run(w, 4);
  let maxGap = 0;
  run(w, 15, () => { if (a.order.type === 'move' && (a.order as any).x === 40.5) maxGap = Math.max(maxGap, Math.abs(a.x - b.x)); });
  info(`queued leg: max separation jeep vs light tank ${maxGap.toFixed(1)} cells (speed cap is cleared on queued legs)`);
}

// ---------------------------------------------------------------------------
console.log('\n### Pathing: walls, forests, fords, tight bases');
{
  // wall line with a 1-cell gap
  const w = makeWorld(flatMap(48, 48));
  const p = w.players[0], e = w.players[1];
  for (let y = 0; y < 48; y++) if (y !== 30) building(w, e, 'sbag', 24, y, false).buildAnim = 1;
  const us = [unit(w, p, '2tnk', 10.5, 10.5), unit(w, p, 'e1', 11.5, 11.5), unit(w, p, 'harv', 12.5, 12.5)];
  us[2].order = { type: 'idle' }; us[2].hstate = 'idle';
  w.issue({ c: 'move', player: p.id, units: us.map((u) => u.id), x: 38.5, y: 10.5 });
  const t = until(w, 60, () => us.every((u) => u.x > 30));
  check('Units path through a 1-cell gap in a wall', t > 0, `t=${t.toFixed(1)}s ${stuckReport(us, 38.5, 10.5, 3)}`);
  // fully closed wall: units should stop near the wall, not jitter forever
  const w2 = makeWorld(flatMap(48, 48));
  for (let y = 0; y < 48; y++) building(w2, w2.players[1], 'sbag', 24, y, false).buildAnim = 1;
  const u = unit(w2, w2.players[0], '2tnk', 10.5, 10.5);
  w2.issue({ c: 'move', player: 0, units: [u.id], x: 38.5, y: 10.5 });
  const t2 = until(w2, 60, () => u.order.type === 'idle');
  check('Move to an unreachable spot ends (unit gives up next to the wall)', t2 > 0, `x=${u.x.toFixed(1)} order=${u.order.type} t=${t2.toFixed(1)}`);
}
{
  // forest band with a gap, and a ford across water
  const w = makeWorld(flatMap(64, 64));
  const p = w.players[0];
  addTrees(w.map, 20, 0, 23, 63);
  for (let y = 40; y <= 41; y++) for (let x = 20; x <= 23; x++) w.map.tree[w.map.idx(x, y)] = 0;
  setTerrain(w.map, 40, 0, 44, 63, T.Water);
  setTerrain(w.map, 40, 10, 44, 11, T.Sand);
  const us = [unit(w, p, '2tnk', 5.5, 5.5), unit(w, p, 'e1', 6.5, 6.5), unit(w, p, 'jeep', 7.5, 5.5)];
  w.issue({ c: 'move', player: p.id, units: us.map((u) => u.id), x: 55.5, y: 55.5 });
  const t = until(w, 180, () => us.every((u) => inBox(u, 55.5, 55.5, 3)));
  check('Units path through forest gap and over a 2-wide ford', t > 0, `t=${t.toFixed(1)}s ${stuckReport(us, 55.5, 55.5, 3)}`);
  const inv = invariants(w);
  check('No unit ended inside trees/water', inv.length === 0, inv.map((i) => i.detail).join('; '));
}
{
  // long detour exceeding A* node budget (9000): big U-shaped lake
  const w = makeWorld(flatMap(128, 128));
  const p = w.players[0];
  setTerrain(w.map, 20, 20, 107, 25, T.Water);
  setTerrain(w.map, 20, 20, 25, 120, T.Water);
  setTerrain(w.map, 102, 20, 107, 120, T.Water);
  const u = unit(w, p, '2tnk', 64.5, 60.5);
  w.issue({ c: 'move', player: p.id, units: [u.id], x: 64.5, y: 5.5 });
  const t = until(w, 240, () => inBox(u, 64.5, 5.5, 2));
  check('Long detour around a large U-shaped lake (A* budget)', t > 0, `t=${t.toFixed(1)}s; unit at ${u.x.toFixed(1)},${u.y.toFixed(1)} order=${u.order.type}`);
}
{
  // tight base: units must leave a base packed with buildings (AI-like 1-cell walkways)
  const w = makeWorld(flatMap(48, 48), undefined, { credits: 50000 });
  const p = w.players[0];
  building(w, p, 'fact', 18, 18);
  const layout: [string, number, number][] = [['powr', 22, 18], ['powr', 25, 18], ['proc', 14, 18], ['weap', 18, 22], ['tent', 22, 21], ['dome', 25, 21], ['powr', 14, 22], ['fix', 22, 24], ['silo', 25, 24], ['silo', 26, 24]];
  for (const [t, x, y] of layout) building(w, p, t, x, y);
  const us: Unit[] = [];
  const spots = [[21.5, 21.5], [24.5, 20.5], [17.5, 21.5], [21.5, 26.5], [27.5, 23.5]];
  for (const [x, y] of spots) if (w.map.passable(Math.floor(x), Math.floor(y))) us.push(unit(w, p, '2tnk', x, y));
  w.issue({ c: 'move', player: p.id, units: us.map((u) => u.id), x: 40.5, y: 40.5 });
  const t = until(w, 60, () => us.every((u) => inBox(u, 40.5, 40.5, 4)));
  check('Tanks get out of a tightly packed base', t > 0, `${us.length} tanks, t=${t.toFixed(1)} stuck: ${stuckReport(us, 40.5, 40.5, 4)}`);
}

// ---------------------------------------------------------------------------
console.log('\n### Orders: attack-move, force fire, scatter, stop');
{
  const w = makeWorld(flatMap(64, 32));
  const p = w.players[0], e = w.players[1];
  const tanks = [unit(w, p, '2tnk', 5.5, 15.5), unit(w, p, '2tnk', 5.5, 17.5)];
  const foes = [unit(w, e, 'e1', 30.5, 16.5), unit(w, e, 'e1', 31.5, 16.5)];
  w.issue({ c: 'move', player: p.id, units: tanks.map((u) => u.id), x: 58.5, y: 16.5, attackMove: true });
  const t = until(w, 60, () => tanks.every((u) => inBox(u, 58.5, 16.5, 3)));
  check('Attack-move engages enemies en route and continues', foes.every((f) => !f.alive) && t > 0, `foes alive=${foes.filter((f) => f.alive).length}, arrived t=${t.toFixed(1)}`);
  // normal move ignores enemies (non-turret units don't stop)
  const w2 = makeWorld(flatMap(64, 32));
  const inf = unit(w2, w2.players[0], 'e1', 5.5, 15.5);
  const foe = unit(w2, w2.players[1], 'e1', 30.5, 15.5);
  w2.issue({ c: 'move', player: 0, units: [inf.id], x: 58.5, y: 15.5 });
  run(w2, 45);
  info(`plain move past an enemy rifleman: mover hp ${inf.hp}/${inf.maxHp} at x=${inf.x.toFixed(1)}, enemy hp ${foe.hp}`);
}
{
  // force-fire on own building & ground
  const w = makeWorld(flatMap(48, 48));
  const p = w.players[0];
  const pw = building(w, p, 'powr', 20, 20);
  const t = unit(w, p, '2tnk', 16.5, 21.5);
  w.issue({ c: 'attack', player: p.id, units: [t.id], target: pw.id, forced: true });
  run(w, 5);
  check('Force-fire damages own structure', pw.hp < pw.maxHp, `hp ${pw.hp}/${pw.maxHp}`);
  const t2 = unit(w, p, 'e3', 30.5, 30.5);
  w.issue({ c: 'attackGround', player: p.id, units: [t2.id], x: 33.5, y: 30.5 });
  const evs = runCollect(w, 6);
  check('Fire-at-ground shoots the ground', evs.some((e) => e.e === 'fire' && e.shooter === t2.id));
  w.issue({ c: 'stop', player: p.id, units: [t.id, t2.id] });
  const evs2 = runCollect(w, 5);
  check('Stop cancels force-fire', !evs2.some((e) => e.e === 'fire' && (e.shooter === t.id || e.shooter === t2.id)));
}
{
  // scatter
  const w = makeWorld(flatMap(48, 48));
  const p = w.players[0];
  const us: Unit[] = [];
  for (let k = 0; k < 6; k++) us.push(unit(w, p, 'e1', 20.3 + (k % 3) * 0.4, 20.3 + Math.floor(k / 3) * 0.4));
  const before = us.map((u) => [u.x, u.y]);
  w.issue({ c: 'scatter', player: p.id, units: us.map((u) => u.id) });
  run(w, 4);
  const moved = us.filter((u, k) => Math.hypot(u.x - before[k][0], u.y - before[k][1]) > 0.8).length;
  check('Scatter spreads units', moved >= 5, `${moved}/6 moved >0.8 cells`);
}
{
  // stop clears waypoint queue
  const w = makeWorld(flatMap(48, 48));
  const p = w.players[0];
  const u = unit(w, p, '2tnk', 5.5, 5.5);
  w.issue({ c: 'move', player: p.id, units: [u.id], x: 30.5, y: 5.5 });
  w.issue({ c: 'move', player: p.id, units: [u.id], x: 30.5, y: 30.5, queue: true });
  run(w, 2);
  w.issue({ c: 'stop', player: p.id, units: [u.id] });
  run(w, 3);
  const x = u.x;
  run(w, 5);
  check('Stop halts and clears queued waypoints', Math.abs(u.x - x) < 0.3 && u.orderQueue.length === 0);
}

// ---------------------------------------------------------------------------
console.log('\n### Abilities');
{
  // crushing
  const w = makeWorld(flatMap(48, 24));
  const p = w.players[0], e = w.players[1];
  const tank = unit(w, p, '3tnk', 5.5, 12.5);
  w.players[0].faction = 'soviet';
  const inf = [unit(w, e, 'e1', 15.5, 12.5), unit(w, e, 'e1', 20.5, 12.5)];
  inf.forEach((i) => { i.weapons.length = 0; });
  w.issue({ c: 'move', player: p.id, units: [tank.id], x: 30.5, y: 12.5 });
  const evs = runCollect(w, 12);
  const crushed = evs.filter((ev) => ev.e === 'death' && ev.how === 'crushed').length;
  check('Tanks crush infantry in their path', crushed >= 1, `${crushed}/2 crushed (infantry not scattering)`);
  // infantry doesn't flee; real case with armed infantry being attacked
}
{
  // dogs vs infantry
  const w = makeWorld(flatMap(32, 32));
  const p = w.players[0], e = w.players[1];
  const dogs = [unit(w, p, 'dog', 5.5, 15.5), unit(w, p, 'dog', 5.5, 16.5)];
  const inf = [unit(w, e, 'e1', 12.5, 15.5), unit(w, e, 'e1', 12.5, 16.5), unit(w, e, 'e1', 13.5, 16.5)];
  for (const d of dogs) w.issue({ c: 'attack', player: p.id, units: [d.id], target: inf[0].id });
  run(w, 10);
  const deadInf = inf.filter((i) => !i.alive).length;
  check('Two dogs kill a squad of 3 riflemen', deadInf >= 2, `infantry dead ${deadInf}/3, dogs alive ${dogs.filter((d) => d.alive).length}/2`);
  // dog vs tank: no attack
  const t = unit(w, e, '2tnk', 20.5, 20.5);
  w.issue({ c: 'attack', player: p.id, units: [dogs.find((d) => d.alive)?.id ?? 0], target: t.id });
  run(w, 3);
  check('Dogs ignore attack orders on vehicles', t.hp === t.maxHp);
  // dog lunge position: never inside a building
  const w2 = makeWorld(flatMap(32, 32));
  building(w2, w2.players[1], 'powr', 14, 14);
  const d2 = unit(w2, w2.players[0], 'dog', 10.5, 15.5);
  const victim = unit(w2, w2.players[1], 'e6', 13.6, 15.5);
  w2.issue({ c: 'attack', player: 0, units: [d2.id], target: victim.id });
  run(w2, 4);
  const inv = invariants(w2);
  check('Dog lunge never lands inside a structure', inv.length === 0, inv.map((i) => i.detail).join('; '));
}
{
  // medic heals
  const w = makeWorld(flatMap(32, 32));
  const p = w.players[0];
  const med = unit(w, p, 'medi', 10.5, 10.5);
  const hurt = unit(w, p, 'e1', 13.5, 10.5);
  hurt.hp = 10;
  run(w, 8);
  check('Medic auto-heals nearby wounded infantry', hurt.hp >= hurt.maxHp, `hp ${hurt.hp}/${hurt.maxHp}`);
  const tank = unit(w, p, '2tnk', 11.5, 12.5);
  tank.hp = 100;
  run(w, 5);
  check('Medic does not heal vehicles', tank.hp === 100);
  void med;
}
{
  // engineer capture & repair
  const w = makeWorld(flatMap(32, 32));
  const p = w.players[0], e = w.players[1];
  building(w, p, 'fact', 2, 2);
  const eb = building(w, e, 'weap', 15, 15);
  eb.hp = eb.maxHp * 0.2;
  const eng = unit(w, p, 'e6', 12.5, 16.5);
  w.issue({ c: 'attack', player: p.id, units: [eng.id], target: eb.id });
  run(w, 6);
  check('Engineer captures a red-health enemy structure', eb.owner === p && !eng.alive);
  check('Captured War Factory unlocks vehicle production', p.canBuild('2tnk'), `canBuild 2tnk=${p.canBuild('2tnk')}`);
  const eb2 = building(w, e, 'powr', 20, 20);
  const eng2 = unit(w, p, 'e6', 18.5, 21.5);
  w.issue({ c: 'attack', player: p.id, units: [eng2.id], target: eb2.id });
  run(w, 6);
  check('Engineer damages (does not capture) a healthy enemy structure', eb2.owner === e && eb2.hp < eb2.maxHp && !eng2.alive, `hp ${eb2.hp}/${eb2.maxHp}`);
  const own = building(w, p, 'powr', 5, 10);
  own.hp = 50;
  const eng3 = unit(w, p, 'e6', 4.5, 13.5);
  w.issue({ c: 'enter', player: p.id, units: [eng3.id], target: own.id });
  run(w, 5);
  check('Engineer fully repairs own structure', own.hp === own.maxHp && !eng3.alive);
  // engineer on an allied (same team, other player) structure is wasted
  const w2 = makeWorld(flatMap(32, 32), [{ faction: 'allies', human: true, team: 0 }, { faction: 'allies', team: 0 }, { faction: 'soviet', team: 1 }]);
  const ally = building(w2, w2.players[1], 'powr', 10, 10);
  ally.hp = 50;
  const eng4 = unit(w2, w2.players[0], 'e6', 9.5, 13.5);
  w2.issue({ c: 'enter', player: 0, units: [eng4.id], target: ally.id });
  run(w2, 5);
  check('Engineer entering an ALLIED structure repairs it (not wasted)', ally.hp > 50 || eng4.alive, `ally hp ${ally.hp}, engineer alive=${eng4.alive}`);
}
{
  // Tanya C4
  const w = makeWorld(flatMap(32, 32));
  const p = w.players[0], e = w.players[1];
  const fact = building(w, e, 'fact', 15, 15);
  const tanya = unit(w, p, 'e7', 10.5, 16.5);
  w.issue({ c: 'attack', player: p.id, units: [tanya.id], target: fact.id });
  run(w, 8);
  check('Tanya C4 destroys a Construction Yard', !fact.alive);
  // two adjacent buildings: plant on A then immediately order B
  const a = building(w, e, 'powr', 20, 10), b = building(w, e, 'powr', 23, 10);
  tanya.x = 22.5; tanya.y = 12.5;
  w.issue({ c: 'attack', player: p.id, units: [tanya.id], target: a.id });
  until(w, 5, () => tanya.c4Timer > 0);
  w.issue({ c: 'attack', player: p.id, units: [tanya.id], target: b.id });
  run(w, 6);
  check('C4 on the first building still detonates after Tanya moves to a second one', !a.alive && !b.alive, `A alive=${a.alive} B alive=${b.alive}`);
  // Tanya dies after planting
  const c = building(w, e, 'powr', 5, 25);
  const tanya2 = unit(w, p, 'e7', 4.5, 28.5);
  w.issue({ c: 'attack', player: p.id, units: [tanya2.id], target: c.id });
  until(w, 5, () => tanya2.c4Timer > 0);
  w.kill(tanya2);
  run(w, 3);
  check('Planted C4 detonates even if Tanya is killed', !c.alive, `building alive=${c.alive}`);
}
{
  // APC board/unload
  const w = makeWorld(flatMap(48, 48));
  const p = w.players[0];
  const apc = unit(w, p, 'apc', 10.5, 10.5);
  const inf: Unit[] = [];
  for (let k = 0; k < 6; k++) inf.push(unit(w, p, k === 5 ? 'e6' : 'e1', 14.5 + (k % 3) * 0.5, 13.5 + Math.floor(k / 3) * 0.5));
  w.issue({ c: 'enter', player: p.id, units: inf.map((u) => u.id), target: apc.id });
  run(w, 8);
  check('APC takes exactly 5 passengers', apc.passengers.length === 5, `${apc.passengers.length} aboard`);
  const left = inf.filter((u) => !u.transport);
  check('6th infantry stays outside (idle)', left.length === 1 && left[0].order.type === 'idle');
  w.issue({ c: 'move', player: p.id, units: [apc.id], x: 35.5, y: 35.5 });
  run(w, 25);
  w.issue({ c: 'deploy', player: p.id, units: [apc.id] });
  run(w, 1);
  const boarded = inf.filter((u) => u !== left[0]);
  const out = boarded.filter((u) => w.units.includes(u));
  check('Unload drops all passengers near the APC', apc.passengers.length === 0 && out.length === 5 && out.every((u) => Math.hypot(u.x - apc.x, u.y - apc.y) < 3), `${out.length} unloaded`);
  // passengers die with APC
  w.issue({ c: 'enter', player: p.id, units: out.slice(0, 3).map((u) => u.id), target: apc.id });
  run(w, 6);
  info(`re-boarded ${apc.passengers.length}`);
  const lost0 = p.stats.unitsLost;
  w.kill(apc);
  run(w, 1);
  check('Passengers die with a destroyed APC', p.stats.unitsLost - lost0 === 1 + apc.passengers.length || (apc.passengers.length === 0 && p.stats.unitsLost - lost0 === 4), `lost ${p.stats.unitsLost - lost0}`);
  const inv = invariants(w);
  check('APC invariants', inv.length === 0, inv.map((i) => i.detail).join('; '));
}

// ---------------------------------------------------------------------------
console.log('\n### Aircraft');
for (const type of ['heli', 'hind', 'mig', 'yak']) {
  const w = makeWorld(flatMap(64, 64), [{ faction: type === 'heli' ? 'allies' : 'soviet', human: true }, { faction: 'allies' }]);
  const p = w.players[0], e = w.players[1];
  const padType = type === 'heli' || type === 'hind' ? 'hpad' : 'afld';
  const pad = building(w, p, padType, 8, 50);
  const ac = unit(w, p, type, pad.x, pad.y);
  ac.homePad = pad.id;
  const target = building(w, e, 'weap', 40, 15);
  const fired: number[] = [];
  w.issue({ c: 'attack', player: p.id, units: [ac.id], target: target.id });
  let landedBack = -1, maxAlt = 0;
  for (let s = 0; s < 20 * 120; s++) {
    w.step();
    for (const ev of w.events) if (ev.e === 'fire' && ev.shooter === ac.id) fired.push(w.time);
    w.events.length = 0;
    maxAlt = Math.max(maxAlt, ac.altitude);
    if (fired.length && ac.altitude === 0 && Math.hypot(ac.x - pad.x, ac.y - pad.y) < 0.6 && landedBack < 0) landedBack = w.time;
  }
  const dmg = target.maxHp - target.hp;
  check(`${type}: flies to target, spends ammo, returns to pad`, fired.length > 0 && ac.ammo === (ac.ut.ammo ?? 0) && landedBack > 0,
    `shots=${fired.length} dmg=${dmg.toFixed(0)} on War Factory, landed back at ${landedBack.toFixed(1)}s, ammo now ${ac.ammo}/${ac.ut.ammo}`);
}
{
  // AA: SAM vs Longbow, AA gun vs MiG, rocket soldiers vs helis
  const w = makeWorld(flatMap(48, 48), [{ faction: 'soviet', human: true }, { faction: 'allies' }]);
  const p = w.players[0], e = w.players[1];
  building(w, p, 'apwr', 2, 2);
  const sam = building(w, p, 'sam', 20, 20);
  const heli = unit(w, e, 'heli', 40.5, 21.5);
  heli.altitude = 1.55;
  w.issue({ c: 'move', player: e.id, units: [heli.id], x: 21.5, y: 22.5 });
  run(w, 20);
  check('SAM site shoots down a Longbow flying over it', !heli.alive, `heli hp ${heli.hp}/${heli.maxHp}`);
  void sam;
  const w2 = makeWorld(flatMap(48, 48), [{ faction: 'allies', human: true }, { faction: 'soviet' }]);
  building(w2, w2.players[0], 'apwr', 2, 2);
  building(w2, w2.players[0], 'agun', 20, 20);
  const mig = unit(w2, w2.players[1], 'mig', 40.5, 21.5);
  mig.altitude = 2.3;
  w2.issue({ c: 'move', player: 1, units: [mig.id], x: 18.5, y: 21.5 });
  run(w2, 15);
  check('AA gun damages a MiG passing over', mig.hp < mig.maxHp || !mig.alive, `mig hp ${mig.hp}`);
  // tanks cannot shoot aircraft; helicopter attacking tanks wins
  const w3 = makeWorld(flatMap(48, 48), [{ faction: 'allies', human: true }, { faction: 'soviet' }]);
  const t3 = unit(w3, w3.players[1], '3tnk', 20.5, 20.5);
  const h3 = unit(w3, w3.players[0], 'heli', 30.5, 20.5); h3.altitude = 1.55;
  w3.issue({ c: 'attack', player: 0, units: [h3.id], target: t3.id });
  run(w3, 20);
  info(`Longbow vs Heavy Tank after 20s: tank hp ${t3.hp.toFixed(0)}/${t3.maxHp}, heli hp ${h3.hp}, ammo ${h3.ammo}`);
  // aircraft with no pad
  const w4 = makeWorld(flatMap(48, 48), [{ faction: 'soviet', human: true }, { faction: 'allies' }]);
  const m4 = unit(w4, w4.players[0], 'mig', 20.5, 20.5); m4.altitude = 2.3; m4.ammo = 0;
  w4.issue({ c: 'deploy', player: 0, units: [m4.id] });
  run(w4, 30);
  const inv = invariants(w4);
  info(`MiG with no airfield after 30s: at ${m4.x.toFixed(1)},${m4.y.toFixed(1)} alt ${m4.altitude.toFixed(2)} (circles forever)`);
  check('Padless aircraft stays in bounds', inv.length === 0);
  // two helicopters, one pad: do they stack on the same spot?
  const w5 = makeWorld(flatMap(48, 48), [{ faction: 'allies', human: true }, { faction: 'soviet' }]);
  const pad5 = building(w5, w5.players[0], 'hpad', 20, 20);
  const hs = [unit(w5, w5.players[0], 'heli', 30.5, 30.5), unit(w5, w5.players[0], 'heli', 31.5, 30.5), unit(w5, w5.players[0], 'heli', 32.5, 30.5)];
  hs.forEach((h) => { h.altitude = 1.55; h.ammo = 0; });
  w5.issue({ c: 'deploy', player: 0, units: hs.map((h) => h.id) });
  run(w5, 25);
  info(`3 Longbows, 1 helipad: positions ${hs.map((h) => `${h.x.toFixed(2)},${h.y.toFixed(2)} alt=${h.altitude.toFixed(2)} ammo=${h.ammo}`).join(' | ')}`);
  check('Helicopters sent home with D (Return to base) stay landed on the pad', hs.every((h) => h.altitude === 0 && h.ammo === 6), 'they fly back to their previous guard position once rearmed');
  void pad5;
  // realistic: heli moved forward, attacks, returns to rearm
  const w6 = makeWorld(flatMap(64, 64), [{ faction: 'allies', human: true }, { faction: 'soviet' }]);
  const pad6 = building(w6, w6.players[0], 'hpad', 8, 50);
  const h6 = unit(w6, w6.players[0], 'heli', pad6.x, pad6.y); h6.homePad = pad6.id;
  w6.issue({ c: 'move', player: 0, units: [h6.id], x: 30.5, y: 30.5 });
  run(w6, 20);
  const tgt = building(w6, w6.players[1], 'weap', 40, 15);
  w6.issue({ c: 'attack', player: 0, units: [h6.id], target: tgt.id });
  const sorties: string[] = [];
  let lastAlt = h6.altitude;
  run(w6, 120, () => { if (lastAlt === 0 && h6.altitude > 0) sorties.push(`take-off with ammo ${h6.ammo} at t=${w6.time.toFixed(0)}`); lastAlt = h6.altitude; });
  info(`Longbow after attack: ${sorties.slice(0, 6).join('; ')}`);
  check('Helicopter fully rearms before relaunching', sorties.every((s) => s.includes('ammo 6')), sorties.slice(0, 3).join('; '));
}

// ---------------------------------------------------------------------------
console.log('\n### Veterancy');
{
  const w = makeWorld(flatMap(48, 48));
  const p = w.players[0], e = w.players[1];
  const t = unit(w, p, '2tnk', 10.5, 10.5);
  for (let k = 0; k < 3; k++) {
    const v = unit(w, e, '1tnk', 13.5, 10.5 + k);
    v.weapons.length = 0;
  }
  run(w, 120);
  check('Medium tank becomes veteran after killing its cost in units', t.rank >= 1, `xp=${t.xp} rank=${t.rank}`);
}

// ---------------------------------------------------------------------------
console.log('\n### Misc combat behaviour');
{
  // rifle infantry ordered to attack a wall: damage impossible, keeps shooting forever
  const w = makeWorld(flatMap(32, 32));
  const wall = building(w, w.players[1], 'sbag', 15, 15);
  const e1 = unit(w, w.players[0], 'e1', 12.5, 15.5);
  w.issue({ c: 'attack', player: 0, units: [e1.id], target: wall.id });
  const evs = runCollect(w, 10);
  const shots = evs.filter((ev) => ev.e === 'fire' && ev.shooter === e1.id).length;
  info(`Rifleman ordered to attack sandbags: ${shots} shots in 10s, wall hp ${wall.hp}/${wall.maxHp}`);
  check('Units refuse attack orders against walls they cannot damage', shots === 0, `${shots} wasted shots, attack cursor shown`);
}
{
  // artillery min range: enemy inside min range
  const w = makeWorld(flatMap(32, 32));
  const a = unit(w, w.players[0], 'arty', 10.5, 10.5);
  const inf = unit(w, w.players[1], 'e1', 11.5, 10.5);
  run(w, 15);
  info(`Artillery vs adjacent rifleman (min range 2): arty hp ${a.hp}/${a.maxHp} alive=${a.alive}, rifleman hp ${inf.hp}`);
}
{
  // unit idle next to enemy building does not attack it (only within weapon range)
  const w = makeWorld(flatMap(32, 32));
  const b = building(w, w.players[1], 'powr', 15, 15);
  const t = unit(w, w.players[0], '2tnk', 12.5, 15.5);
  run(w, 5);
  check('Idle tank auto-attacks an enemy structure within range', b.hp < b.maxHp, `hp ${b.hp}`);
  void t;
}

process.exit(summary() ? 1 : 0);
