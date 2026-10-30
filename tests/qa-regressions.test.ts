// Regression tests for the simulation bugs found by the QA harnesses (tools/qa/*): movement and pathing,
// harvester docking, AI air strikes and first waves, superweapon targeting, placement rules, walls,
// production/tech, C4, engineers, selling, attack orders, simultaneous fire, aircraft, debug base.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BUILDINGS, REFUND_PERCENT } from '../src/data/rules';
import type { Command } from '../src/sim/types';
import { generateMap } from '../src/sim/mapgen';
import { setupScenario } from '../src/debug';
import { sandbox, building, unit, paint, ore, run, runUntil, seconds, powerUp, T, World, Building, type Unit, type GameEvent } from './helpers';

const near = (u: { x: number; y: number }, x: number, y: number, r: number) => Math.hypot(u.x - x, u.y - y) <= r;

function recordCommands(world: World): Command[][] {
  const log: Command[][] = world.players.map(() => []);
  const issue = world.issue.bind(world);
  world.issue = (c: Command) => { log[c.player]?.push(c); issue(c); };
  return log;
}

describe('movement: progress is measured along the path', () => {
  test('a move whose only route first leads away from the goal still arrives', () => {
    const { world, map, p0 } = sandbox({ w: 48, h: 48 });
    // a rock wall with a single gap far to the south: the detour first increases the distance to the goal
    paint(map, 24, 0, 24, 47, T.Rock);
    map.terrain[map.idx(24, 42)] = T.Clear;
    const tank = unit(world, '2tnk', p0, 10.5, 8.5);
    const inf = unit(world, 'e1', p0, 11.5, 9.5);
    world.issue({ c: 'move', player: p0.id, units: [tank.id, inf.id], x: 38.5, y: 8.5 });
    const t = runUntil(world, () => tank.x > 30 && inf.x > 30 && tank.order.type === 'idle' && inf.order.type === 'idle', seconds(150));
    assert.ok(t > 0, `both arrived (tank ${tank.x.toFixed(1)},${tank.y.toFixed(1)} ${tank.order.type}; rifleman ${inf.x.toFixed(1)},${inf.y.toFixed(1)} ${inf.order.type})`);
  });

  test('on a 128x128 map a long detour around a big lake is found (search budget scales with the map)', () => {
    const { world, map, p0 } = sandbox({ w: 128, h: 128 });
    paint(map, 20, 20, 107, 25, T.Water);
    paint(map, 20, 20, 25, 120, T.Water);
    paint(map, 102, 20, 107, 120, T.Water);
    const tank = unit(world, '2tnk', p0, 64.5, 60.5);
    world.issue({ c: 'move', player: p0.id, units: [tank.id], x: 64.5, y: 5.5 });
    run(world, 3);
    const path = tank.path;
    assert.ok(path && path.length > 0, 'got a path');
    const last = path![path!.length - 1];
    assert.ok(Math.hypot(last.x - 64.5, last.y - 5.5) < 0.01, `the path reaches the goal (ends at ${last.x},${last.y})`);
  });
});

describe('harvesters at a refinery dock', () => {
  function trucks(n: number, opts: { refineries?: number } = {}) {
    const s = sandbox({ credits: 0 });
    const { world, p0 } = s;
    building(world, 'fact', p0, 4, 4);
    building(world, 'powr', p0, 8, 4);
    const ref = building(world, 'proc', p0, 20, 20);
    const ref2 = opts.refineries === 2 ? building(world, 'proc', p0, 30, 20) : null;
    const [dx, dy] = ref.dockCell()!;
    const rel = [[0.5, -0.11], [-0.23, 0.5], [-0.42, -0.41], [0.3, 0.6]];
    const hs: Unit[] = [];
    for (let k = 0; k < n; k++) {
      const h = unit(world, 'harv', p0, dx + 0.5 + rel[k][0], dy + 0.5 + rel[k][1], -Math.PI / 2);
      h.cargo = 28; h.cargoValue = 28 * 25; h.hstate = 'toRefinery'; h.dockAt = ref.id;
      hs.push(h);
    }
    return { ...s, ref, ref2, hs, dock: [dx + 0.5, dy + 0.5] as const };
  }

  test('three full trucks converging on a free dock take turns instead of deadlocking', () => {
    const { world, hs, ref, dock } = trucks(3);
    let maxSlip = 0;
    const t = runUntil(world, () => {
      for (const h of hs) if (h.hstate === 'unloading') maxSlip = Math.max(maxSlip, Math.hypot(h.x - dock[0], h.y - dock[1]));
      return hs.every((h) => h.cargo < 28);
    }, seconds(60));
    assert.ok(t > 0, `all unloaded (cargo ${hs.map((h) => h.cargo)}, states ${hs.map((h) => h.hstate)})`);
    assert.ok(maxSlip < 0.25, `the unloading truck is never shoved off the pad (max ${maxSlip.toFixed(2)})`);
    assert.ok(ref.dockOccupant === 0 || hs.some((h) => h.id === ref.dockOccupant), 'dock reservation is sane');
  });

  test('a truck whose refinery pad is walled in delivers to another refinery', () => {
    const { world, p0, hs, ref, ref2 } = trucks(1, { refineries: 2 });
    const [dx, dy] = ref.dockCell()!;
    // (structures placed by script, bypassing the placement rules that normally prevent this)
    for (const [x, y] of [[dx - 1, dy], [dx + 1, dy], [dx, dy + 1]]) building(world, 'gun', p0, x, y);
    const h = hs[0];
    h.x = dx + 0.5; h.y = dy + 3.5; // outside the sealed pocket
    const t = runUntil(world, () => h.cargo === 0, seconds(60));
    assert.ok(t > 0, `delivered elsewhere (state ${h.hstate}, dockAt ${h.dockAt}, at ${h.x.toFixed(1)},${h.y.toFixed(1)})`);
    assert.equal(h.dockAt === 0 || h.dockAt === ref2!.id, true);
  });

  test('a truck kept waiting too long goes to another refinery with a free dock', () => {
    const { world, p0, hs, ref, ref2 } = trucks(2, { refineries: 2 });
    const [blocker, waiting] = hs;
    // the first truck occupies the dock "forever"
    blocker.x = ref.dockCell()![0] + 0.5; blocker.y = ref.dockCell()![1] + 0.5;
    blocker.hstate = 'unloading'; blocker.harvestTimer = 1e6; ref.dockOccupant = blocker.id;
    const t = runUntil(world, () => waiting.cargo === 0, seconds(45));
    assert.ok(t > 0, `the second truck unloaded elsewhere (state ${waiting.hstate}, dockAt ${waiting.dockAt})`);
    assert.ok(t > seconds(8), `after waiting a while first (${(t / 20).toFixed(1)} s)`);
    assert.ok(p0.stats.harvested > 0, 'credits deposited');
    assert.equal(blocker.cargo, 28);
    void ref2;
  });
});

describe('AI aircraft', () => {
  test('the AI sends idle, fully armed hovering helicopters on strikes and gives air pads no rally point', () => {
    const s = sandbox({ ai: ['hard', undefined], credits: 0 });
    const { world, p0, p1 } = s;
    building(world, 'fact', p0, 4, 4);
    powerUp(world, p0, 4, 8, 3);
    building(world, 'proc', p0, 14, 4);
    building(world, 'dome', p0, 18, 4);
    const pad = building(world, 'hpad', p0, 18, 8);
    const tent = building(world, 'tent', p0, 14, 9);
    building(world, 'fact', p1, 40, 40);
    const target = building(world, 'powr', p1, 36, 40);
    const helis = [unit(world, 'heli', p0, 12.5, 16.5), unit(world, 'heli', p0, 13.5, 16.5)];
    for (const h of helis) h.altitude = 1.55; // hovering at a post, fully armed
    const log = recordCommands(world);
    run(world, seconds(10));
    const strike = log[0].find((c) => c.c === 'attack' && helis.some((h) => (c as any).units.includes(h.id)));
    assert.ok(strike, 'an air strike was ordered');
    assert.ok(helis.every((h) => h.order.type === 'attack' || h.ammo < 6 || target.hp < target.maxHp || !target.alive), 'helicopters are on their way');
    assert.equal(pad.rallyX, -1, 'no ground rally point for the helipad');
    assert.ok(tent.rallyX >= 0, 'ground factories still get one');
  });
});

describe('superweapon targeting', () => {
  function sw(kind: 'nuke' | 'chrono' | 'ironcurtain') {
    const s = sandbox({ factions: kind === 'ironcurtain' ? ['soviet', 'allies'] : ['allies', 'soviet'] });
    powerUp(s.world, s.p0, 2, 2, 3);
    const type = kind === 'nuke' ? 'mslo' : kind === 'chrono' ? 'pdox' : 'iron';
    building(s.world, type, s.p0, 2, 6);
    s.p0.superCharge[kind] = BUILDINGS[type].superCharge!;
    return s;
  }

  test('the Iron Curtain on empty ground is refused and keeps its charge', () => {
    const { world, p0 } = sw('ironcurtain');
    const tank = unit(world, '3tnk', p0, 20.5, 20.5);
    const events: GameEvent[] = [];
    world.issue({ c: 'superweapon', player: p0.id, kind: 'ironcurtain', x: 40.5, y: 40.5 });
    run(world, 1, events);
    assert.ok(p0.superCharge.ironcurtain >= 239, `charge kept (${p0.superCharge.ironcurtain})`);
    assert.ok(!events.some((e) => e.e === 'ironcurtain'), 'no effect played');
    world.issue({ c: 'superweapon', player: p0.id, kind: 'ironcurtain', x: 20.5, y: 20.5 });
    run(world, 1);
    assert.ok(tank.invulnerable > 20 && p0.superCharge.ironcurtain < 1, 'on a unit it works and is spent');
  });

  test('superweapons aimed off the map are refused and keep their charge', () => {
    const { world, p0 } = sw('nuke');
    world.issue({ c: 'superweapon', player: p0.id, kind: 'nuke', x: -30, y: 90 });
    run(world, 1);
    assert.ok(p0.superCharge.nuke >= 299, `nuke charge kept (${p0.superCharge.nuke})`);
    assert.ok(!world.projectiles.some((p) => p.special === 'nuke'), 'nothing launched');
    const c = sw('chrono');
    const tank = unit(c.world, '2tnk', c.p0, 10.5, 30.5);
    c.world.issue({ c: 'superweapon', player: c.p0.id, kind: 'chrono', x: 60.5, y: 20.5, unit: tank.id });
    run(c.world, 1);
    assert.ok(c.p0.superCharge.chrono >= 239 && Math.abs(tank.x - 10.5) < 0.1, 'chrono off the map refused');
  });
});

describe('placement', () => {
  function yard() {
    const s = sandbox();
    const fact = building(s.world, 'fact', s.p0, 10, 10); // 10..12 x 10..12
    return { ...s, fact };
  }

  test('walls cannot creep the base across the map, and do not count as base for other structures', () => {
    const { world, p0 } = yard();
    // a sandbag chain eastwards from the yard
    for (let x = 13; x <= 22; x++) building(world, 'sbag', p0, x, 11);
    assert.ok(world.canPlace(p0, 'sbag', 23, 11), 'a wall 10 cells from the yard is fine');
    assert.equal(world.placementIssue(p0, 'sbag', 24, 11), 'distance', 'but not 11 cells away, even next to a wall');
    assert.equal(world.placementIssue(p0, 'gun', 22, 12), 'distance', 'a turret next to the far end of the wall line');
    assert.equal(world.placementIssue(p0, 'powr', 20, 12), 'distance', 'walls are not base for structures');
    assert.ok(world.canPlace(p0, 'gun', 14, 12), 'near the yard is fine');
  });

  test('placementIssue explains why a spot is refused', () => {
    const { world, map, p0, p1 } = yard();
    paint(map, 16, 10, 17, 11, T.Water);
    assert.equal(world.placementIssue(p0, 'powr', 15, 10), 'terrain', 'water');
    ore(map, 13, 14, 13, 14, 3);
    assert.equal(world.placementIssue(p0, 'powr', 13, 13), 'terrain', 'ore');
    assert.equal(world.placementIssue(p0, 'powr', -1, 10), 'terrain', 'off the map');
    assert.equal(world.placementIssue(p0, 'powr', 11, 11), 'occupied', 'overlaps the yard');
    unit(world, 'e1', p1, 13.5, 8.5);
    run(world, 1);
    assert.equal(world.placementIssue(p0, 'powr', 13, 7), 'occupied', 'enemy unit in the way');
    const proc = building(world, 'proc', p0, 13, 15); // dock at (14, 18)
    assert.equal(world.placementIssue(p0, 'powr', 14, 18), 'exit', "on another structure's dock");
    building(world, 'gun', p0, 13, 18);
    building(world, 'gun', p0, 15, 18);
    assert.equal(world.placementIssue(p0, 'gun', 14, 19), 'exit', 'would wall the refinery pad in');
    paint(map, 6, 13, 9, 13, T.Rock);
    assert.equal(world.placementIssue(p0, 'weap', 6, 10), 'exit', 'own factory exit blocked');
    assert.equal(world.placementIssue(p0, 'powr', 30, 30), 'distance', 'too far');
    assert.equal(world.placementIssue(p1, 'powr', 30, 30), 'no-yard', 'no Construction Yard');
    assert.equal(world.placementIssue(p0, 'powr', 13, 10), null, 'fine');
    void proc;
  });

  test('dragging a wall line over own units moves every one of them out', () => {
    const { world, map, p0 } = yard();
    const us = [unit(world, 'e1', p0, 16.5, 14.5), unit(world, '2tnk', p0, 18.5, 14.5), unit(world, 'e1', p0, 20.3, 14.4)];
    run(world, 1);
    p0.queues.structure.ready = 'sbag';
    world.issue({ c: 'place', player: p0.id, type: 'sbag', cx: 14, cy: 14, cx2: 22, cy2: 14 });
    run(world, 2);
    assert.equal(world.buildings.filter((b) => b.bt.id === 'sbag').length, 9, 'the whole line was built');
    for (const u of us) {
      const occ = map.occupant[map.idx(Math.floor(u.x), Math.floor(u.y))];
      assert.equal(occ, 0, `${u.ut.id} at ${u.x.toFixed(2)},${u.y.toFixed(2)} is not inside a wall`);
    }
  });
});

describe('economy', () => {
  test('"+$" pop-ups show only what was actually credited; full silos show none but ask for silos', () => {
    const { world, p0 } = sandbox({ credits: 0 });
    const proc = building(world, 'proc', p0, 10, 10);
    const [dx, dy] = proc.dockCell()!;
    p0.ore = p0.storage; // silos full
    const h = unit(world, 'harv', p0, dx + 0.5, dy + 0.5, -Math.PI / 2);
    h.cargo = 28; h.cargoValue = 28 * 25; h.hstate = 'toRefinery'; h.dockAt = proc.id;
    const events: GameEvent[] = [];
    let t = runUntil(world, () => h.cargo === 0, seconds(20), events);
    assert.ok(t > 0, 'unloaded');
    assert.ok(!events.some((e) => e.e === 'credits'), 'no "+$" while everything is discarded');
    assert.ok(events.some((e) => e.e === 'announce' && e.key === 'silos_needed'), 'silos needed announced');
    // room for exactly $100
    p0.ore = p0.storage - 100;
    h.cargo = 28; h.cargoValue = 28 * 25; h.hstate = 'toRefinery'; h.dockAt = proc.id;
    events.length = 0;
    t = runUntil(world, () => h.cargo === 0, seconds(20), events);
    assert.ok(t > 0, 'unloaded again');
    const shown = events.filter((e) => e.e === 'credits').reduce((s, e) => s + (e as any).amount, 0);
    assert.equal(shown, 100, 'pop-ups add up to the $100 that fitted');
  });

  test('repairing a structure before selling it never pays off', () => {
    const { world, p0 } = sandbox({ credits: 10000 });
    const a = building(world, 'weap', p0, 10, 10), b = building(world, 'weap', p0, 20, 10);
    a.hp = b.hp = a.maxHp * 0.3;
    const c0 = p0.credits;
    world.issue({ c: 'sell', player: p0.id, building: a.id });
    run(world, seconds(2));
    const sellAsIs = p0.credits - c0;
    assert.equal(sellAsIs, Math.floor(2000 * REFUND_PERCENT), 'flat refund, as in RA');
    const c1 = p0.credits;
    world.issue({ c: 'repair', player: p0.id, building: b.id });
    runUntil(world, () => !b.repairing, seconds(60));
    assert.equal(b.hp, b.maxHp, 'repaired');
    world.issue({ c: 'sell', player: p0.id, building: b.id });
    run(world, seconds(2));
    const repairThenSell = p0.credits - c1;
    assert.ok(repairThenSell <= sellAsIs + 1, `repair + sell nets $${repairThenSell}, selling as-is $${sellAsIs}`);
  });
});

describe('production and tech', () => {
  function base() {
    const s = sandbox({ credits: 10000 });
    const { world, p0 } = s;
    const fact = building(world, 'fact', p0, 4, 4);
    powerUp(world, p0, 4, 8, 3);
    building(world, 'proc', p0, 8, 4);
    const weap = building(world, 'weap', p0, 12, 4);
    return { ...s, fact, weap };
  }

  test('a ready structure is lost (refunded) with the last Construction Yard, kept while another yard stands', () => {
    const { world, p0, fact } = base();
    const yard2 = building(world, 'fact', p0, 20, 4);
    const q = p0.queues.structure;
    q.ready = 'powr';
    world.kill(yard2);
    run(world, 2);
    assert.equal(q.ready, 'powr', 'another yard: still ready');
    const cash = p0.cash;
    world.kill(fact);
    world.issue({ c: 'place', player: p0.id, type: 'powr', cx: 7, cy: 12 });
    run(world, 2);
    assert.equal(q.ready, null, 'gone with the yard');
    assert.ok(!world.buildings.some((b) => b.alive && b.bt.id === 'powr' && b.cx === 7 && b.cy === 12), 'could not be placed');
    assert.equal(p0.cash - cash, BUILDINGS.powr.cost, 'refunded');
  });

  test('losing a tech building only drops the queue items that needed it', () => {
    const { world, p0 } = base();
    const dome = building(world, 'dome', p0, 16, 8);
    world.issue({ c: 'build', player: p0.id, type: 'arty' });
    world.issue({ c: 'build', player: p0.id, type: '2tnk', count: 2 });
    run(world, seconds(3));
    const q = p0.queues.vehicle;
    assert.deepEqual(q.items.map((i) => i.type), ['arty', '2tnk', '2tnk']);
    const total = p0.cash + p0.ore + q.items.reduce((s, i) => s + i.paid, 0);
    world.kill(dome);
    run(world, 1);
    assert.deepEqual(q.items.map((i) => i.type), ['2tnk', '2tnk'], 'medium tanks stay queued');
    const after = p0.cash + p0.ore + q.items.reduce((s, i) => s + i.paid, 0);
    assert.ok(Math.abs(after - total) < 1e-6, `artillery refunded (${total} vs ${after})`);
  });

  test('prerequisites are granted when construction completes, not when the structure is placed', () => {
    const { world, p0 } = base();
    p0.queues.structure.ready = 'dome';
    world.issue({ c: 'place', player: p0.id, type: 'dome', cx: 16, cy: 4 });
    run(world, 2);
    const dome = world.buildings.find((b) => b.bt.id === 'dome')!;
    assert.ok(dome && dome.buildAnim < 1, 'building up');
    assert.equal(p0.canBuild('arty'), false, 'no artillery during the build-up');
    world.issue({ c: 'build', player: p0.id, type: 'arty' });
    run(world, 1);
    assert.equal(p0.queues.vehicle.items.length, 0, 'cannot queue it yet');
    run(world, seconds(1.5));
    assert.equal(dome.buildAnim, 1);
    assert.ok(p0.canBuild('arty'), 'unlocked once complete');
    world.kill(dome);
    assert.equal(p0.has('dome'), false, 'and taken away again with it');
  });
});

describe("Tanya's C4", () => {
  function setup() {
    const s = sandbox();
    building(s.world, 'fact', s.p1, 40, 40);
    return s;
  }

  test('charges live on the buildings: several go off, even after Tanya moves on or dies', () => {
    const { world, p0, p1 } = setup();
    const a = building(world, 'powr', p1, 20, 10), b = building(world, 'powr', p1, 23, 10);
    const tanya = unit(world, 'e7', p0, 22.5, 12.5);
    world.issue({ c: 'attack', player: p0.id, units: [tanya.id], target: a.id });
    assert.ok(runUntil(world, () => a.c4Timer > 0, seconds(5)) > 0, 'planted on A');
    world.issue({ c: 'attack', player: p0.id, units: [tanya.id], target: b.id });
    assert.ok(runUntil(world, () => !a.alive && !b.alive, seconds(8)) > 0, `both destroyed (A ${a.alive}, B ${b.alive})`);
    const c = building(world, 'powr', p1, 5, 25);
    const tanya2 = unit(world, 'e7', p0, 4.5, 28.5);
    world.issue({ c: 'attack', player: p0.id, units: [tanya2.id], target: c.id });
    assert.ok(runUntil(world, () => c.c4Timer > 0, seconds(5)) > 0, 'planted on C');
    const killed0 = p0.stats.buildingsKilled;
    world.kill(tanya2);
    assert.ok(runUntil(world, () => !c.alive, seconds(3)) > 0, 'C still blows up after Tanya died');
    assert.equal(p0.stats.buildingsKilled, killed0 + 1, 'credited to her side');
  });

  test('planting again on an armed building does not restart its fuse', () => {
    const { world, p0, p1 } = setup();
    const d = building(world, 'powr', p1, 20, 20);
    const tanya = unit(world, 'e7', p0, 19.2, 22.5);
    world.issue({ c: 'attack', player: p0.id, units: [tanya.id], target: d.id });
    const planted = runUntil(world, () => d.c4Timer > 0, seconds(5));
    assert.ok(planted > 0, 'planted');
    let ticks = 0;
    const t = runUntil(world, () => {
      if (++ticks % 4 === 0) world.issue({ c: 'attack', player: p0.id, units: [tanya.id], target: d.id });
      return !d.alive;
    }, seconds(5));
    assert.ok(t > 0 && t <= seconds(1.7), `detonated on schedule despite re-orders (${(t / 20).toFixed(2)} s)`);
  });
});

describe('engineers and friendly structures', () => {
  test('an engineer fully repairs a damaged allied structure; an undamaged friendly one is refused', () => {
    const s = sandbox({ factions: ['allies', 'allies', 'soviet'], teams: [0, 0, 1] });
    const { world, p0, p1 } = s;
    const ally = building(world, 'powr', p1, 10, 10);
    ally.hp = 50;
    const eng = unit(world, 'e6', p0, 9.5, 13.5);
    world.issue({ c: 'enter', player: p0.id, units: [eng.id], target: ally.id });
    assert.ok(runUntil(world, () => !eng.alive, seconds(10)) > 0, 'went in');
    assert.equal(ally.hp, ally.maxHp, 'allied structure repaired');
    const own = building(world, 'powr', p0, 20, 10);
    const eng2 = unit(world, 'e6', p0, 19.5, 13.5);
    world.issue({ c: 'enter', player: p0.id, units: [eng2.id], target: own.id });
    world.issue({ c: 'attack', player: p0.id, units: [eng2.id], target: own.id });
    run(world, seconds(5));
    assert.ok(eng2.alive, 'engineer not wasted on an undamaged structure');
    assert.equal(eng2.order.type, 'idle');
  });

  test('an engineer standing next to a structure but beyond reach of its edge still gets in', () => {
    const { world, p0, p1 } = sandbox();
    building(world, 'fact', p1, 40, 40);
    const b = building(world, 'powr', p1, 20, 20); // 20..21 x 20..21
    const eng = unit(world, 'e6', p0, 19.1, 20.5); // adjacent cell, 0.9 from the wall
    world.issue({ c: 'attack', player: p0.id, units: [eng.id], target: b.id });
    const t = runUntil(world, () => !eng.alive, seconds(5));
    assert.ok(t > 0, `entered (engineer at ${eng.x.toFixed(2)},${eng.y.toFixed(2)})`);
    assert.ok(b.hp < b.maxHp, 'sabotaged');
  });
});

describe('attack orders and simultaneous fire', () => {
  test('attack orders on targets none of the weapons can hurt are refused', () => {
    const { world, p0, p1 } = sandbox();
    building(world, 'fact', p1, 40, 40);
    const wall = building(world, 'sbag', p1, 20, 20);
    const rifle = unit(world, 'e1', p0, 17.5, 20.5);
    const tank = unit(world, '2tnk', p0, 17.5, 22.5);
    world.issue({ c: 'attack', player: p0.id, units: [rifle.id, tank.id], target: wall.id });
    run(world, 2);
    assert.equal(rifle.order.type, 'idle', 'rifleman refuses (small arms cannot breach walls)');
    assert.equal(tank.order.type, 'attack', 'the tank takes the order');
  });

  test('two identical riflemen firing on the same tick kill each other (deaths resolve at the end of the tick)', () => {
    const { world, p0, p1 } = sandbox();
    const a = unit(world, 'e1', p0, 20.5, 20.5, 0);
    const b = unit(world, 'e1', p1, 23.5, 20.5, Math.PI);
    a.hp = b.hp = 1;
    a.target = b; b.target = a;
    run(world, 2);
    assert.equal(a.alive, false, 'first-created rifleman died');
    assert.equal(b.alive, false, 'and so did the second one: both shots went off');
  });

  test('mirror squad fights show no advantage for the squad created first', () => {
    const tally = [0, 0]; // wins for the squad created first / second
    for (const swap of [false, true]) {
      for (let seed = 1; seed <= 3; seed++) {
        const { world } = sandbox({ w: 60, h: 40, seed });
        const A: Unit[] = [], B: Unit[] = [];
        const pa = world.players[swap ? 1 : 0], pb = world.players[swap ? 0 : 1];
        for (let k = 0; k < 12; k++) A.push(unit(world, 'e1', pa, 18.5 - (k % 4) * 0.7, 17.5 + Math.floor(k / 4) * 0.7));
        for (let k = 0; k < 12; k++) B.push(unit(world, 'e1', pb, 40.5 + (k % 4) * 0.7, 17.5 + Math.floor(k / 4) * 0.7));
        world.issue({ c: 'move', player: pa.id, units: A.map((u) => u.id), x: 45, y: 18.5, attackMove: true });
        world.issue({ c: 'move', player: pb.id, units: B.map((u) => u.id), x: 14, y: 18.5, attackMove: true });
        run(world, seconds(60));
        const a = A.filter((u) => u.alive).length, b = B.filter((u) => u.alive).length;
        if (a > b) tally[0]++; else if (b > a) tally[1]++;
      }
    }
    assert.ok(tally[0] < 6, `the first-created squad does not win every mirror fight (first ${tally[0]} / second ${tally[1]} of 6)`);
  });
});

describe('aircraft', () => {
  test('helicopters sent home with Return to base stay on the pad once rearmed', () => {
    const { world, p0 } = sandbox();
    const pad = building(world, 'hpad', p0, 20, 20);
    const heli = unit(world, 'heli', p0, 30.5, 30.5);
    heli.altitude = 1.55;
    heli.ammo = 0;
    world.issue({ c: 'deploy', player: p0.id, units: [heli.id] });
    const t = runUntil(world, () => heli.altitude === 0 && heli.ammo === 6, seconds(30));
    assert.ok(t > 0, 'landed and rearmed');
    run(world, seconds(10));
    assert.ok(heli.altitude === 0 && near(heli, pad.x, pad.y, 0.3), `still home (${heli.x.toFixed(1)},${heli.y.toFixed(1)} alt ${heli.altitude})`);
  });
});

describe('skirmish AI first wave', () => {
  test('the first wave waits for its difficulty timer, and in Classic goes in whole once it outweighs what it knows', () => {
    const s = sandbox({ ai: ['hard', undefined], credits: 0, w: 64, h: 64 });
    const { world, p0, p1 } = s;
    building(world, 'fact', p0, 6, 6);
    building(world, 'fact', p1, 54, 54);
    const army: Unit[] = [];
    for (let k = 0; k < 12; k++) army.push(unit(world, '2tnk', p0, 12.5 + (k % 4), 12.5 + Math.floor(k / 4)));
    const ai = world.ais[0] as any;
    // (version 6: Classic Hard masses until 13:00 before its first wave, DiffParams.classicFirst; its timer says 5:00)
    world.tick = seconds(770);
    run(world, seconds(5));
    assert.equal(ai.state, 'build', 'no attack before 13:00 on Classic hard');
    run(world, seconds(10));
    assert.equal(ai.state, 'attack', 'attacks after 13:00');
    const value = [...ai.wave].reduce((s: number, id: number) => s + (world.getEntity(id) as Unit).ut.cost, 0);
    // (version 4, Classic normal and up: no capped first wave; the wave was weighed against the enemy, ai-engage.ts.
    // Commander rules keep the ~1.3x wave-value cap.)
    assert.equal(value, 12 * 800, `first wave worth $${value}: the whole idle army`);
  });
});

describe('debug scenario', () => {
  test("scenario=base gives both factions enough power for everything", () => {
    for (const size of [64, 96]) {
      const map = generateMap({ size, players: 2, seed: 3, water: 0.5, trees: 0.5, ore: 0.6 });
      const world = new World({
        map, credits: 10000, startUnits: 'mcv', fog: true, seed: 3,
        players: [{ name: 'A', faction: 'allies', color: 0, team: 0, isHuman: true }, { name: 'S', faction: 'soviet', color: 0, team: 1, isHuman: false }],
      });
      setupScenario(world, 'base');
      run(world, 1);
      for (const p of world.players) {
        assert.ok(!p.lowPower, `${p.faction} power ${p.powerOut}/${p.powerUse} on ${size}x${size}`);
        assert.ok(world.buildings.some((b) => b.owner === p && b.bt.superweapon), `${p.faction} has its superweapon`);
      }
    }
  });
});

void Building;
