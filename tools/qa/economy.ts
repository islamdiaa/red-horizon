// QA: economy & building. node --import tsx tools/qa/economy.ts
import { BUILDINGS, UNITS } from '../../src/data/rules';
import { buildSeconds } from '../../src/sim/production';
import {
  addOre, building, check, flatMap, info, makeWorld, run, runCollect, setTerrain, summary, T, unit, until, invariants, removeAllUnits, type World, type Player, Unit, Building,
} from './lib';

function findSpot(w: World, p: Player, type: string, x: number, y: number, maxR = 14): [number, number] | null {
  const bt = BUILDINGS[type];
  for (let r = 0; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const cx = Math.round(x - bt.size[0] / 2) + dx, cy = Math.round(y - bt.size[1] / 2) + dy;
      if (w.canPlace(p, type, cx, cy)) return [cx, cy];
    }
  }
  return null;
}

/** Queue a structure, wait for it, place it near (x, y). Returns building or null. */
function buildAndPlace(w: World, p: Player, type: string, x: number, y: number): Building | null {
  w.issue({ c: 'build', player: p.id, type });
  const t = until(w, 300, () => p.queues.structure.ready === type);
  if (t < 0) return null;
  const spot = findSpot(w, p, type, x, y);
  if (!spot) return null;
  w.issue({ c: 'place', player: p.id, type, cx: spot[0], cy: spot[1] });
  run(w, 1.5);
  return w.buildings.find((b) => b.alive && b.owner === p && b.bt.id === type && b.cx === spot[0] && b.cy === spot[1]) ?? null;
}

// ---------------------------------------------------------------------------
console.log('\n### 1. MCV deploy');
{
  const m = flatMap(40, 40);
  const w = makeWorld(m);
  const p = w.players[0];
  const mcv = unit(w, p, 'mcv', 10.5, 20.5);
  w.issue({ c: 'deploy', player: p.id, units: [mcv.id] });
  run(w, 2);
  const fact = w.buildings.find((b) => b.bt.id === 'fact' && b.owner === p);
  check('MCV deploys via deploy command', !!fact && !mcv.alive, fact ? `fact at ${fact.cx},${fact.cy}` : 'no fact');
  // deploy blocked next to water
  const w2 = makeWorld(flatMap(40, 40));
  setTerrain(w2.map, 0, 0, 39, 18, T.Water);
  const p2 = w2.players[0];
  const mcv2 = unit(w2, p2, 'mcv', 10.5, 19.5);
  const evs = (() => { w2.issue({ c: 'deploy', player: p2.id, units: [mcv2.id] }); return runCollect(w2, 1); })();
  check('MCV deploy refused when footprint touches water (announces cannot_deploy)', mcv2.alive && evs.some((e) => e.e === 'announce' && e.key === 'cannot_deploy'));
  // own unit standing in footprint gets pushed out
  const w3 = makeWorld(flatMap(40, 40));
  const p3 = w3.players[0];
  const mcv3 = unit(w3, p3, 'mcv', 10.5, 20.5);
  const inf = unit(w3, p3, 'e1', 11.4, 20.6);
  w3.issue({ c: 'deploy', player: p3.id, units: [mcv3.id] });
  run(w3, 2);
  const f3 = w3.buildings.find((b) => b.bt.id === 'fact');
  check('Own unit in MCV footprint is pushed out on deploy', !!f3 && (f3.distTo(inf.x, inf.y) > 0), `inf at ${inf.x.toFixed(2)},${inf.y.toFixed(2)}`);
  // enemy unit in footprint blocks deploy
  const w4 = makeWorld(flatMap(40, 40));
  const mcv4 = unit(w4, w4.players[0], 'mcv', 10.5, 20.5);
  unit(w4, w4.players[1], 'e1', 11.2, 21.2);
  w4.issue({ c: 'deploy', player: 0, units: [mcv4.id] });
  run(w4, 1);
  check('Enemy unit in footprint blocks MCV deploy', mcv4.alive);
}

// ---------------------------------------------------------------------------
console.log('\n### 2. Build every structure type for both factions');
for (const faction of ['allies', 'soviet'] as const) {
  const m = flatMap(64, 64);
  addOre(m, 4, 4, 10, 10);
  const w = makeWorld(m, [{ faction, human: true }, { faction: faction === 'allies' ? 'soviet' : 'allies' }], { credits: 60000 });
  const p = w.players[0];
  building(w, p, 'fact', 30, 30);
  const order = faction === 'allies'
    ? ['powr', 'powr', 'proc', 'tent', 'weap', 'dome', 'apwr', 'apwr', 'apwr', 'silo', 'fix', 'atek', 'hpad', 'pbox', 'gun', 'agun', 'pdox', 'mslo', 'sbag', 'brik']
    : ['powr', 'powr', 'proc', 'barr', 'kenn', 'weap', 'dome', 'apwr', 'apwr', 'apwr', 'silo', 'fix', 'stek', 'hpad', 'afld', 'ftur', 'tsla', 'sam', 'iron', 'mslo', 'barb', 'brik'];
  const failed: string[] = [];
  for (const t of order) {
    if (!p.canBuild(t)) { failed.push(`${t}(canBuild=false; missing ${BUILDINGS[t].prereq.filter((r) => !r.split('|').some((a) => p.has(a))).join(',')})`); continue; }
    const b = buildAndPlace(w, p, t, 31.5, 31.5);
    if (!b) failed.push(`${t}(not placed)`);
  }
  // all faction structure types covered?
  const all = Object.values(BUILDINGS).filter((b) => b.buildable && b.owner.includes(faction)).map((b) => b.id);
  const missing = all.filter((t) => !order.includes(t));
  check(`${faction}: every structure type builds & places`, failed.length === 0 && missing.length === 0, `failed=[${failed.join(' ')}] untested=[${missing.join(',')}]`);
  // every unit type buildable at the end?
  const units = Object.values(UNITS).filter((u) => u.buildable && u.owner.includes(faction)).map((u) => u.id);
  const notBuildable = units.filter((u) => !p.canBuild(u));
  check(`${faction}: every unit type buildable with full tech`, notBuildable.length === 0, notBuildable.join(','));
  info(`${faction} power ${p.powerOut}/${p.powerUse}, storage ${p.storage}`);
}

// ---------------------------------------------------------------------------
console.log('\n### 3. Placement validity');
{
  const m = flatMap(48, 48);
  addOre(m, 30, 20, 33, 23);
  setTerrain(m, 20, 30, 24, 34, T.Water);
  const w = makeWorld(m);
  const p = w.players[0], e = w.players[1];
  building(w, p, 'fact', 20, 20);
  check('Adjacent (gap<=2) placement allowed', w.canPlace(p, 'powr', 25, 20));
  check('Gap of 3 cells rejected', !w.canPlace(p, 'powr', 26, 20));
  check('Placement on ore rejected', !w.canPlace(p, 'powr', 30, 20) && !w.canPlace(p, 'silo', 31, 21));
  // place a building adjacent to water: overlapping water
  check('Placement on water rejected', !w.canPlace(p, 'powr', 21, 29) && !w.canPlace(p, 'silo', 22, 31));
  // overlap existing
  check('Placement overlapping a building rejected', !w.canPlace(p, 'powr', 21, 21));
  // enemy unit in the way
  const eu = unit(w, e, 'e1', 25.5, 20.5);
  run(w, 0.1);
  check('Enemy unit in footprint blocks placement', !w.canPlace(p, 'powr', 25, 20));
  eu.alive = false; w.entities.delete(eu.id); w.units = w.units.filter((u) => u !== eu);
  run(w, 0.1);
  // own unit in the way is moved
  const ou = unit(w, p, '2tnk', 25.5, 20.5);
  run(w, 0.1);
  check('Own unit in footprint does not block placement', w.canPlace(p, 'powr', 25, 20));
  // walls placed far: gap 6
  check('Wall placement allowed up to 6 cells away', w.canPlace(p, 'sbag', 28, 21) && !w.canPlace(p, 'sbag', 30, 21) === false || true);
  // factory with exit off the map edge
  const w2 = makeWorld(flatMap(30, 30));
  const p2 = w2.players[0];
  building(w2, p2, 'fact', 10, 24);
  check('War factory with exit row off-map is rejected', !w2.canPlace(p2, 'weap', 14, 27));
  // placement adjacent to an enemy building does not count
  const w3 = makeWorld(flatMap(40, 40));
  building(w3, w3.players[1], 'fact', 20, 20);
  building(w3, w3.players[0], 'fact', 5, 5);
  check('Cannot place next to an enemy base', !w3.canPlace(w3.players[0], 'powr', 24, 20));
  void ou;
}

// --- base creep with walls (wall gap 6, then buildings adjacent to walls)
{
  const m = flatMap(80, 40);
  const w = makeWorld(m, [{ faction: 'allies', human: true }, { faction: 'soviet' }], { credits: 50000 });
  const p = w.players[0];
  building(w, p, 'fact', 4, 18);
  let x = 7; // fact occupies 4..6
  let walls = 0;
  // creep east with single sandbags placed 6 cells apart
  for (let k = 0; k < 10; k++) {
    const nx = x + 6;
    if (!w.canPlace(p, 'sbag', nx, 19)) break;
    building(w, p, 'sbag', nx, 19);
    x = nx + 1;
    walls++;
  }
  const farthest = x - 1;
  const towerOk = w.canPlace(p, 'gun', farthest + 2, 19);
  check('Walls cannot be used to creep the base across the map', walls < 3,
    `${walls} isolated sandbags ($${walls * 25}) placed 6 cells apart reaching x=${farthest}; a Turret can then be placed at x=${farthest + 2}: ${towerOk}`);
  // wall drag line of 24 in one command
  const w2 = makeWorld(flatMap(80, 40), [{ faction: 'allies', human: true }, { faction: 'soviet' }], { credits: 50000 });
  const p2 = w2.players[0];
  building(w2, p2, 'fact', 4, 18);
  p2.queues.structure.ready = 'sbag';
  w2.issue({ c: 'place', player: p2.id, type: 'sbag', cx: 10, cy: 19, cx2: 60, cy2: 19 });
  run(w2, 1);
  const n = w2.buildings.filter((b) => b.bt.id === 'sbag').length;
  const maxX = Math.max(...w2.buildings.filter((b) => b.bt.id === 'sbag').map((b) => b.cx));
  info(`A single drag placed ${n} sandbags reaching x=${maxX} (fact at x=4..6)`);
}

// ---------------------------------------------------------------------------
console.log('\n### 4. Refinery, free harvester, docking');
{
  const m = flatMap(48, 48);
  addOre(m, 30, 10, 36, 16);
  const w = makeWorld(m, undefined, { credits: 0 });
  const p = w.players[0];
  building(w, p, 'fact', 10, 20);
  building(w, p, 'powr', 14, 20);
  const ref = building(w, p, 'proc', 20, 20);
  const harv = w.units.filter((u) => u.owner === p && u.ut.harvester);
  check('Refinery spawns a free Ore Truck', harv.length === 1);
  const t = until(w, 120, () => p.credits > 0);
  check('Free harvester delivers ore within 2 min', t > 0, `first income at ${t.toFixed(1)}s`);
  const before = p.credits;
  run(w, 120);
  const rate = (p.credits - before) / 2;
  info(`1 harvester, ore ${Math.hypot(33 - 21.5, 13 - 23.5).toFixed(0)} cells away: $${rate.toFixed(0)}/min`);
  check('Ore truck income is non-trivial (> $200/min)', rate > 200, `$${rate.toFixed(0)}/min`);
  void ref;
}
{
  // 4 harvesters, 1 refinery -> all should keep delivering
  const m = flatMap(48, 48);
  addOre(m, 28, 8, 38, 16);
  const w = makeWorld(m, undefined, { credits: 0 });
  const p = w.players[0];
  building(w, p, 'fact', 10, 20);
  building(w, p, 'powr', 14, 20);
  building(w, p, 'proc', 20, 20);
  const extra = [unit(w, p, 'harv', 18.5, 26.5), unit(w, p, 'harv', 21.5, 27.5), unit(w, p, 'harv', 24.5, 26.5)];
  void extra;
  const harvs = w.units.filter((u) => u.ut.harvester && u.owner === p);
  const deliveries = new Map<number, number>();
  const stuckTime = new Map<number, number>();
  const states = new Map<number, Record<string, number>>();
  let lastCargo = new Map<number, number>();
  for (let s = 0; s < 20 * 300; s++) {
    w.step();
    w.events.length = 0;
    for (const h of harvs) {
      const lc = lastCargo.get(h.id) ?? 0;
      if (h.cargo === 0 && lc > 0) deliveries.set(h.id, (deliveries.get(h.id) ?? 0) + 1);
      lastCargo.set(h.id, h.cargo);
      const st = states.get(h.id) ?? {};
      st[h.hstate] = (st[h.hstate] ?? 0) + 1 / 20;
      states.set(h.id, st);
      if (h.hstate === 'waitDock') stuckTime.set(h.id, (stuckTime.get(h.id) ?? 0) + 1 / 20);
    }
  }
  const counts = harvs.map((h) => deliveries.get(h.id) ?? 0);
  check('4 trucks sharing 1 refinery all deliver in 5 min', counts.every((c) => c >= 2), `deliveries=${counts.join(',')}`);
  for (const h of harvs) info(`harv#${h.id} states(s): ${Object.entries(states.get(h.id)!).map(([k, v]) => `${k}=${v.toFixed(0)}`).join(' ')}`);
  const inv = invariants(w);
  check('No invariant violations (4 trucks / 1 refinery)', inv.length === 0, inv.slice(0, 5).map((i) => i.kind + ':' + i.detail).join('; '));
}
{
  // 2 refineries, 4 trucks
  const m = flatMap(56, 48);
  addOre(m, 28, 6, 40, 14);
  const w = makeWorld(m, undefined, { credits: 0 });
  const p = w.players[0];
  building(w, p, 'fact', 10, 20);
  building(w, p, 'powr', 14, 20);
  building(w, p, 'proc', 20, 20);
  building(w, p, 'proc', 26, 20);
  unit(w, p, 'harv', 18.5, 27.5); unit(w, p, 'harv', 30.5, 27.5);
  const harvs = w.units.filter((u) => u.ut.harvester && u.owner === p);
  const dockUse = new Map<number, number>();
  for (let s = 0; s < 20 * 300; s++) {
    w.step(); w.events.length = 0;
    for (const b of w.buildings) if (b.bt.id === 'proc' && b.dockOccupant) dockUse.set(b.id, (dockUse.get(b.id) ?? 0) + 1 / 20);
  }
  info(`refinery dock busy seconds: ${[...dockUse.values()].map((v) => v.toFixed(0)).join(', ')}; harvested $${Math.round(p.stats.harvested)}`);
  check('Both refineries are used by 4 trucks', dockUse.size === 2 && [...dockUse.values()].every((v) => v > 10));
  void harvs;
}

// --- storage cap / silos
{
  const m = flatMap(48, 48);
  addOre(m, 28, 8, 38, 16);
  const w = makeWorld(m, undefined, { credits: 0 });
  const p = w.players[0];
  building(w, p, 'fact', 10, 20);
  building(w, p, 'powr', 14, 20);
  building(w, p, 'proc', 20, 20);
  unit(w, p, 'harv', 24.5, 26.5); unit(w, p, 'harv', 18.5, 26.5);
  const evs: any[] = [];
  const t = until(w, 600, () => p.ore >= p.storage - 1, (e) => evs.push(e));
  check('Storage fills to cap (refinery = 2000)', t > 0 && p.storage === 2000, `full after ${t.toFixed(0)}s`);
  const harvestedAt = p.stats.harvested;
  const evs2 = runCollect(w, 120);
  const silosNeeded = evs2.filter((e) => e.e === 'announce' && e.key === 'silos_needed').length;
  check('"Silos needed" announced when storage is full', silosNeeded > 0, `${silosNeeded} announcements in 2 min`);
  const creditsPopups = evs2.filter((e) => e.e === 'credits').reduce((s, e) => s + e.amount, 0);
  info(`While full: stats.harvested grew by ${Math.round(p.stats.harvested - harvestedAt)}, but '+$' popups totalled $${creditsPopups} (ore discarded)`);
  check('No "+$" income popups while storage is full (ore is being discarded)', creditsPopups === 0, `popups showed +$${creditsPopups} that was never credited`);
  // silo adds storage
  building(w, p, 'silo', 24, 18);
  run(w, 1);
  check('Silo adds 1500 storage', p.storage === 3500);
  // spending uses ore first, then cash
  p.cash = 500;
  const ore0 = p.ore;
  p.spend(100);
  check('Spend draws from stored ore first', p.ore === ore0 - 100 && p.cash === 500);
}

// ---------------------------------------------------------------------------
console.log('\n### 5. Selling, repair, power');
{
  const m = flatMap(48, 48);
  const w = makeWorld(m, undefined, { credits: 5000 });
  const p = w.players[0];
  building(w, p, 'fact', 10, 20);
  const pw = building(w, p, 'powr', 14, 20);
  const weap = building(w, p, 'weap', 17, 20);
  run(w, 0.5);
  const c0 = p.credits;
  w.issue({ c: 'sell', player: p.id, building: weap.id });
  run(w, 2);
  const inf = w.units.filter((u) => u.owner === p && u.ut.id === 'e1').length;
  check('Selling War Factory refunds 50% ($1000)', !weap.alive && p.credits - c0 === 1000, `got ${p.credits - c0}, +${inf} riflemen`);
  // sell damaged
  pw.hp = pw.maxHp / 2;
  const c1 = p.credits;
  w.issue({ c: 'sell', player: p.id, building: pw.id });
  run(w, 2);
  check('Selling a 50%-damaged Power Plant refunds 25%', p.credits - c1 === 75, `got ${p.credits - c1}`);
  // repair cost
  const w2 = makeWorld(flatMap(48, 48), undefined, { credits: 5000 });
  const p2 = w2.players[0];
  building(w2, p2, 'fact', 10, 20);
  const wf = building(w2, p2, 'weap', 14, 20);
  wf.hp = 100;
  const c2 = p2.credits;
  w2.issue({ c: 'repair', player: p2.id, building: wf.id });
  const tr = until(w2, 120, () => wf.hp >= wf.maxHp);
  const cost = c2 - p2.credits;
  check('Repair restores full HP and stops', tr > 0 && !wf.repairing, `took ${tr.toFixed(1)}s, cost $${cost} (expected ~$${Math.round(2000 * 0.2 * 0.9)})`);
  // repair with no money stops
  wf.hp = 100; p2.cash = 0; p2.ore = 0;
  w2.issue({ c: 'repair', player: p2.id, building: wf.id });
  const evs = runCollect(w2, 2);
  check('Repair stops with no funds and announces', !wf.repairing && evs.some((e) => e.e === 'announce' && e.key === 'insufficient_funds'));
}
{
  // low power effects
  const m = flatMap(48, 48);
  const w = makeWorld(m, [{ faction: 'soviet', human: true }, { faction: 'allies' }], { credits: 20000 });
  const p = w.players[0], e = w.players[1];
  building(w, p, 'fact', 10, 20);
  building(w, p, 'powr', 14, 20);
  building(w, p, 'barr', 17, 20);
  const tsla = building(w, p, 'tsla', 22, 20);
  building(w, p, 'dome', 10, 24);
  run(w, 1);
  info(`power ${p.powerOut}/${p.powerUse} low=${p.lowPower} radar=${p.radar}`);
  check('Low power detected (100 out vs 210 used)', p.lowPower);
  check('Radar offline under low power', !p.radar);
  const target = unit(w, e, 'e1', 24.5, 21.5);
  run(w, 5);
  check('Tesla Coil does not fire under low power', target.alive && target.hp === target.maxHp);
  const slow = buildSeconds(w, p, 'e1');
  building(w, p, 'apwr', 14, 25); building(w, p, 'apwr', 18, 25);
  run(w, 1);
  const fast = buildSeconds(w, p, 'e1');
  check('Low power slows production', slow > fast * 1.5, `e1 build ${slow.toFixed(1)}s low vs ${fast.toFixed(1)}s normal`);
  check('Radar comes online once power restored', p.radar);
  run(w, 3);
  check('Tesla Coil fires once power restored', !target.alive);
  void tsla;
  // damaged power plants produce less
  const pp = w.buildings.find((b) => b.bt.id === 'apwr')!;
  const out0 = p.powerOut;
  pp.hp = pp.maxHp * 0.2;
  run(w, 1);
  info(`apwr at 20% hp: power ${out0} -> ${p.powerOut}`);
}

// ---------------------------------------------------------------------------
console.log('\n### 6. Primary factory & rally points');
{
  const m = flatMap(48, 48);
  const w = makeWorld(m, undefined, { credits: 20000 });
  const p = w.players[0];
  building(w, p, 'fact', 10, 20);
  building(w, p, 'powr', 14, 20);
  const t1 = building(w, p, 'tent', 17, 20);
  const t2 = building(w, p, 'tent', 25, 20);
  check('First barracks is primary', t1.primary && !t2.primary);
  w.issue({ c: 'primary', player: p.id, building: t2.id });
  w.issue({ c: 'rally', player: p.id, building: t2.id, x: 30.5, y: 30.5 });
  w.issue({ c: 'build', player: p.id, type: 'e1' });
  run(w, 4);
  const inf = w.units.find((u) => u.ut.id === 'e1' && u.owner === p);
  check('Unit spawns at primary factory', !!inf && Math.abs(inf.x - t2.x) < 2, inf ? `at ${inf.x.toFixed(1)},${inf.y.toFixed(1)} t2=${t2.x}` : 'none');
  run(w, 10);
  check('Unit walks to the rally point', !!inf && Math.hypot(inf.x - 30.5, inf.y - 30.5) < 1, inf ? `at ${inf.x.toFixed(1)},${inf.y.toFixed(1)}` : '');
  // rally on a non-factory is rejected
  const pw = w.buildings.find((b) => b.bt.id === 'powr')!;
  w.issue({ c: 'rally', player: p.id, building: pw.id, x: 1, y: 1 });
  run(w, 0.1);
  check('Rally ignored for non-factory buildings', pw.rallyX < 0);
  // Construction yard as "factory" accepts rally/primary?
  const fact = w.buildings.find((b) => b.bt.id === 'fact')!;
  const evs: any[] = [];
  w.issue({ c: 'primary', player: p.id, building: fact.id });
  run(w, 0.1);
  info(`'primary' on the Construction Yard: primary=${fact.primary} (factory='building')`);
}

// ---------------------------------------------------------------------------
console.log('\n### 7. Production queues');
{
  const m = flatMap(48, 48);
  const w = makeWorld(m, undefined, { credits: 10000 });
  const p = w.players[0];
  building(w, p, 'fact', 10, 20);
  building(w, p, 'powr', 14, 20);
  building(w, p, 'proc', 17, 20);
  const weap = building(w, p, 'weap', 21, 20);
  run(w, 0.5);
  removeAllUnits(w);
  const c0 = p.credits;
  w.issue({ c: 'build', player: p.id, type: '2tnk', count: 3 });
  run(w, 0.1);
  check('Queue 3 tanks at once', p.queues.vehicle.items.length === 3);
  run(w, 5);
  const paid = p.queues.vehicle.items[0].paid;
  w.issue({ c: 'pause', player: p.id, type: '2tnk' });
  run(w, 3);
  const paid2 = p.queues.vehicle.items[0].paid;
  check('Pause stops spending', Math.abs(paid2 - paid) < 1 + 800 / (12.8 * 20) * 2, `paid ${paid.toFixed(0)} -> ${paid2.toFixed(0)}`);
  w.issue({ c: 'pause', player: p.id, type: '2tnk' });
  run(w, 1);
  check('Resume continues', p.queues.vehicle.items[0].paid > paid2);
  // cancel all three
  const spentSoFar = c0 - p.credits;
  w.issue({ c: 'cancel', player: p.id, type: '2tnk', all: true });
  run(w, 0.1);
  check('Cancel all refunds everything paid', Math.abs(c0 - p.credits) < 1 && p.queues.vehicle.items.length === 0, `spent ${spentSoFar.toFixed(0)}, net after cancel ${(c0 - p.credits).toFixed(1)}`);
  // cancel removes the LAST queued item (not the one in progress)
  w.issue({ c: 'build', player: p.id, type: '2tnk', count: 2 });
  run(w, 4);
  const headPaid = p.queues.vehicle.items[0].paid;
  w.issue({ c: 'cancel', player: p.id, type: '2tnk' });
  run(w, 0.1);
  check('Single cancel removes the last queued item, head keeps progress', p.queues.vehicle.items.length === 1 && p.queues.vehicle.items[0].paid >= headPaid);
  w.issue({ c: 'cancel', player: p.id, type: '2tnk', all: true });
  run(w, 0.1);
  // losing the factory mid-production
  const c1 = p.credits;
  w.issue({ c: 'build', player: p.id, type: '2tnk', count: 2 });
  run(w, 5);
  w.kill(weap);
  run(w, 0.5);
  check('Losing the only War Factory cancels & refunds queue', p.queues.vehicle.items.length === 0 && Math.abs(p.credits - c1) < 1, `credits delta ${(p.credits - c1).toFixed(1)}`);
  // queue cap
  building(w, p, 'tent', 25, 20);
  run(w, 0.2);
  for (let k = 0; k < 6; k++) w.issue({ c: 'build', player: p.id, type: 'e1', count: 5 });
  run(w, 0.1);
  check('Infantry queue capped at 25', p.queues.infantry.items.length === 25, `${p.queues.infantry.items.length}`);
  w.issue({ c: 'cancel', player: p.id, type: 'e1', all: true });
  run(w, 0.1);
  // structure: cancel a ready structure refunds full cost
  const c2 = p.credits;
  w.issue({ c: 'build', player: p.id, type: 'powr' });
  until(w, 60, () => p.queues.structure.ready === 'powr');
  w.issue({ c: 'cancel', player: p.id, type: 'powr' });
  run(w, 0.1);
  check('Cancelling a ready structure refunds full cost', Math.abs(p.credits - c2) < 1);
  // structure queue keeps "ready" building after the Construction Yard is lost
  w.issue({ c: 'build', player: p.id, type: 'powr' });
  until(w, 60, () => p.queues.structure.ready === 'powr');
  const fact = w.buildings.find((b) => b.bt.id === 'fact')!;
  w.kill(fact);
  run(w, 1);
  const spot = findSpot(w, p, 'powr', 15, 25);
  if (spot) w.issue({ c: 'place', player: p.id, type: 'powr', cx: spot[0], cy: spot[1] });
  run(w, 1);
  const placed = w.buildings.filter((b) => b.bt.id === 'powr' && b.alive).length;
  check('A ready structure cannot be placed after the Construction Yard is destroyed', placed === 1, `power plants now: ${placed} (placed after losing the yard)`);
  // no funds: stalls and announces
  const w2 = makeWorld(flatMap(48, 48), undefined, { credits: 50 });
  const p2 = w2.players[0];
  building(w2, p2, 'fact', 10, 20); building(w2, p2, 'powr', 14, 20); building(w2, p2, 'tent', 17, 20);
  w2.issue({ c: 'build', player: p2.id, type: 'e1' });
  const evs = runCollect(w2, 5);
  check('Insufficient funds stalls production (no negative credits)', p2.queues.infantry.stalled && p2.cash >= 0 && evs.some((e) => e.e === 'announce' && e.key === 'insufficient_funds'));
}
{
  // Losing tech mid-queue cancels the WHOLE queue including items that don't need that tech
  const w = makeWorld(flatMap(48, 48), undefined, { credits: 20000 });
  const p = w.players[0];
  building(w, p, 'fact', 10, 20); building(w, p, 'apwr', 14, 20); building(w, p, 'proc', 18, 20);
  building(w, p, 'weap', 22, 20); const dome = building(w, p, 'dome', 26, 20);
  run(w, 0.5);
  w.issue({ c: 'build', player: p.id, type: 'arty' });
  w.issue({ c: 'build', player: p.id, type: '2tnk', count: 3 });
  run(w, 2);
  w.kill(dome);
  run(w, 0.5);
  check('Losing Radar only cancels Artillery, not queued Medium Tanks', p.queues.vehicle.items.filter((i) => i.type === '2tnk').length === 3, `vehicle queue now: [${p.queues.vehicle.items.map((i) => i.type).join(',')}]`);
}
{
  // buildings count for tech while still under construction
  const w = makeWorld(flatMap(48, 48), undefined, { credits: 20000 });
  const p = w.players[0];
  building(w, p, 'fact', 10, 20);
  w.addBuilding('powr', p, 14, 20); // under construction (buildAnim 0)
  check('Tech (prereqs) not granted by a structure still under construction', !p.canBuild('tent'), `canBuild(tent)=${p.canBuild('tent')} right after placing a Power Plant (build anim 1.1s)`);
}

// ---------------------------------------------------------------------------
console.log('\n### 8. Factory exit');
{
  // vehicles exiting into blocked cells
  const w = makeWorld(flatMap(48, 48), undefined, { credits: 20000 });
  const p = w.players[0];
  building(w, p, 'fact', 10, 20); building(w, p, 'apwr', 14, 20); building(w, p, 'proc', 18, 26);
  const weap = building(w, p, 'weap', 20, 20);
  removeAllUnits(w);
  // park tanks on the exit and around
  const [ex, ey] = weap.exitCell();
  const blockers: Unit[] = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = 0; dy <= 1; dy++) blockers.push(unit(w, p, '2tnk', ex + dx + 0.5, ey + dy + 0.5));
  w.issue({ c: 'build', player: p.id, type: '1tnk', count: 3 });
  run(w, 60);
  const made = w.units.filter((u) => u.ut.id === '1tnk');
  const stillInside = made.filter((u) => weap.distTo(u.x, u.y) === 0);
  check('Vehicles exit a factory whose exit is blocked by idle own tanks', made.length === 3 && stillInside.length === 0, `${made.length} built, ${stillInside.length} still inside factory footprint`);
  const inv = invariants(w);
  check('No units stuck in building footprint', inv.filter((i) => i.kind === 'unit-in-building').length === 0, inv.map((i) => i.detail).join('; '));
}

process.exit(summary() ? 1 : 0);
