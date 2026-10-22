// Land / air RA content: spies & thieves, minelayers & mines, gap generators, radar jammers, the Chinook,
// camo pillbox & decoys, support powers (GPS, sonar, spy plane, paratroopers, parabombs), bridges, unit
// stances, AI use of all that, and save/load determinism.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BUILDINGS, UNITS } from '../src/data/rules';
import { Building, Unit } from '../src/sim/entities';
import { serializeWorld, deserializeWorld } from '../src/sim/save';
import { superAvailable, superFull, superReady } from '../src/sim/superweapons';
import { apparentType, sharedRadar } from '../src/sim/infiltration';
import { allMines } from '../src/sim/mines';
import { PARACHUTE_SECONDS, PARATROOPERS, PARABOMBS, SPYPLANE_RADIUS } from '../src/sim/powers';
import { addBridgesToMap, BRIDGE_STRENGTH } from '../src/sim/bridges';
import { generateMap } from '../src/sim/mapgen';
import { GameMap, T } from '../src/sim/map';
import { World } from '../src/sim/world';
import {
  sandbox, building, unit, run, runUntil, seconds, powerUp, paint, stateHash, checkInvariants, skirmish, type GameEvent,
} from './helpers';

const cell = (world: World, x: number, y: number) => world.map.idx(Math.floor(x), Math.floor(y));

// ---------------------------------------------------------------------------
describe('spies', () => {
  test('a spy is disguised as an enemy soldier: riflemen and defences ignore it, dogs do not', () => {
    const { world, p0, p1 } = sandbox();
    const spy = unit(world, 'spy', p0, 20.5, 20.5);
    run(world, seconds(1.1));
    assert.equal(spy.disguise, p1.id, 'disguised as the enemy player');
    const rifle = unit(world, 'e1', p1, 22.5, 20.5);
    const pbox = building(world, 'pbox', p1, 20, 23);
    powerUp(world, p1, 30, 30, 1);
    run(world, seconds(3));
    assert.equal(spy.hp, spy.maxHp, `nobody shoots the disguised spy (hp ${spy.hp})`);
    assert.ok(rifle.target !== spy && pbox.target !== spy, 'not picked as a target');
    const dog = unit(world, 'dog', p1, 24.5, 20.5);
    const events: GameEvent[] = [];
    const t = runUntil(world, () => !spy.alive, seconds(10), events);
    assert.ok(t > 0, 'the dog sniffs the spy out and kills it');
    assert.ok(dog.alive, 'dog alive');
    assert.ok(events.some((e) => e.e === 'announce' && e.player === p1.id && e.key === 'spy_detected'), 'dog owner hears "spy detected"');
  });

  test('infiltrating a radar dome shares that player\'s radar view while it stands', () => {
    const { world, p0, p1 } = sandbox();
    powerUp(world, p1, 30, 30, 1);
    const dome = building(world, 'dome', p1, 22, 20);
    const spy = unit(world, 'spy', p0, 15.5, 21.5);
    world.issue({ c: 'enter', player: p0.id, units: [spy.id], target: dome.id });
    const events: GameEvent[] = [];
    const t = runUntil(world, () => !spy.alive, seconds(20), events);
    assert.ok(t > 0, 'spy went in');
    assert.ok(dome.spiedBy & (1 << p0.id), 'dome remembers the spying player');
    assert.deepEqual(p0.intel.radar, [p1.id], 'radar intel on p1');
    assert.deepEqual(sharedRadar(world, p0).map((p) => p.id), [p1.id], 'sharedRadar helper');
    assert.ok(events.some((e) => e.e === 'infiltrate' && e.kind === 'spy' && e.building === dome.id), 'infiltrate event');
    assert.ok(events.some((e) => e.e === 'announce' && e.player === p0.id && e.key === 'building_infiltrated'), 'announcer');
    world.kill(dome);
    run(world, seconds(1.1));
    assert.deepEqual(p0.intel.radar, [], 'intel lost with the dome');
  });

  test('power plant, refinery and factory infiltration give power, credits and production intel', () => {
    const { world, p0, p1 } = sandbox();
    const powr = building(world, 'powr', p1, 22, 10);
    const proc = building(world, 'proc', p1, 22, 20);
    const weap = building(world, 'weap', p1, 22, 30);
    const spies = [powr, proc, weap].map((b, k) => {
      const s = unit(world, 'spy', p0, 15.5, 11.5 + k * 10);
      world.issue({ c: 'enter', player: p0.id, units: [s.id], target: b.id });
      return s;
    });
    const t = runUntil(world, () => spies.every((s) => !s.alive), seconds(25));
    assert.ok(t > 0, 'all spies went in');
    run(world, seconds(1.1));
    assert.deepEqual(p0.intel.power, [p1.id], 'power intel');
    assert.deepEqual(p0.intel.credits, [p1.id], 'credits intel');
    assert.deepEqual(p0.intel.production, [p1.id], 'production intel');
  });

  test('a spy in an enemy sub pen grants a one-shot sonar pulse', () => {
    const { world, p0, p1 } = sandbox();
    // a sub pen floats: give it some water
    paint(world.map, 24, 18, 32, 26, T.Water);
    const pen = world.addBuilding('spen', p1, 25, 20, true);
    const spy = unit(world, 'spy', p0, 20.5, 21.5);
    assert.ok(!superAvailable(world, p0, 'sonar'), 'no sonar before');
    world.issue({ c: 'enter', player: p0.id, units: [spy.id], target: pen.id });
    const t = runUntil(world, () => !spy.alive, seconds(20));
    assert.ok(t > 0, 'spy went in');
    assert.equal(p0.sonarCharges, 1, 'one sonar pulse');
    assert.ok(superAvailable(world, p0, 'sonar') && superReady(world, p0, 'sonar'), 'sonar ready');
    world.issue({ c: 'superweapon', player: p0.id, kind: 'sonar', x: 0, y: 0 });
    run(world, 2);
    assert.equal(p0.sonarCharges, 0, 'pulse used up');
    assert.ok(!superReady(world, p0, 'sonar'), 'one-shot');
    assert.ok(p0.sonarUntil > world.tick, 'sonar pulse active (naval detection hook)');
  });

  test('enemy tanks do not run over a disguised spy', () => {
    const { world, p0, p1 } = sandbox();
    const spy = unit(world, 'spy', p0, 20.5, 20.5);
    run(world, seconds(1.1));
    const tank = unit(world, '3tnk', p1, 16.5, 20.5);
    world.issue({ c: 'move', player: p1.id, units: [tank.id], x: 25.5, y: 20.5 });
    run(world, seconds(6));
    assert.ok(spy.alive, 'spy survived the tank driving through');
  });

  test('spies and thieves refuse friendly or pointless targets', () => {
    const { world, p0, p1 } = sandbox();
    const own = building(world, 'dome', p0, 10, 10);
    const enemyPower = building(world, 'powr', p1, 30, 30);
    const spy = unit(world, 'spy', p0, 15.5, 15.5);
    const thf = unit(world, 'thf', p0, 16.5, 15.5);
    world.issue({ c: 'enter', player: p0.id, units: [spy.id], target: own.id });
    world.issue({ c: 'enter', player: p0.id, units: [thf.id], target: enemyPower.id });
    run(world, 2);
    assert.equal(spy.order.type, 'idle', 'no spying on yourself');
    assert.equal(thf.order.type, 'idle', 'a thief only raids refineries and silos');
  });
});

// ---------------------------------------------------------------------------
describe('thief', () => {
  test('steals half of the victim\'s credits from a refinery and is used up', () => {
    const { world, p0, p1 } = sandbox({ credits: 0 });
    const proc = building(world, 'proc', p1, 22, 20);
    p1.cash = 3000;
    p1.ore = 1000;
    const thf = unit(world, 'thf', p0, 15.5, 21.5);
    world.issue({ c: 'attack', player: p0.id, units: [thf.id], target: proc.id });
    const events: GameEvent[] = [];
    const t = runUntil(world, () => !thf.alive, seconds(20), events);
    assert.ok(t > 0, 'thief went in');
    assert.equal(p0.cash, 2000, `half of 4000 stolen (got ${p0.cash})`);
    assert.equal(Math.round(p1.cash + p1.ore), 2000, 'victim keeps the other half');
    assert.ok(events.some((e) => e.e === 'infiltrate' && e.kind === 'thief' && e.amount === 2000), 'event with amount');
    assert.ok(events.some((e) => e.e === 'announce' && e.player === p1.id && e.key === 'credits_stolen'), 'victim told');
  });
});

// ---------------------------------------------------------------------------
describe('minelayers and mines', () => {
  test('Allied minelayers lay AT mines, Soviet ones AP mines; D lays one under it', () => {
    const { world, p0, p1 } = sandbox();
    const a = unit(world, 'mnly', p0, 10.5, 10.5);
    const s = unit(world, 'mnly', p1, 30.5, 30.5);
    assert.equal(a.ammo, 5, 'five mines aboard');
    world.issue({ c: 'deploy', player: p0.id, units: [a.id] });
    world.issue({ c: 'deploy', player: p1.id, units: [s.id] });
    run(world, seconds(2));
    const mines = allMines(world);
    assert.equal(mines.length, 2, 'two mines');
    const ma = mines.find((m) => m.owner === p0)!, ms = mines.find((m) => m.owner === p1)!;
    assert.equal(ma.bt.id, 'minv', 'Allied: anti-tank');
    assert.equal(ms.bt.id, 'minp', 'Soviet: anti-personnel');
    assert.equal(ma.cx, 10, 'under the minelayer');
    assert.equal(a.ammo, 4, 'one mine used');
  });

  test('the mine command lays a field around the target until the minelayer is empty', () => {
    const { world, p0 } = sandbox();
    const a = unit(world, 'mnly', p0, 10.5, 10.5);
    world.issue({ c: 'mine', player: p0.id, units: [a.id], x: 20.5, y: 20.5 });
    const events: GameEvent[] = [];
    const t = runUntil(world, () => allMines(world).length === 5, seconds(40), events);
    assert.ok(t > 0, `five mines laid (${allMines(world).length})`);
    assert.equal(a.ammo, 0, 'empty');
    run(world, 2, events);
    assert.ok(events.some((e) => e.e === 'announce' && e.player === p0.id && e.key === 'mines_laid'), '"mines laid" when the field is done');
    for (const m of allMines(world)) assert.ok(Math.hypot(m.x - 20.5, m.y - 20.5) < 2.5, 'field around the target');
    assert.ok(allMines(world).some((m) => m.cx === 20 && m.cy === 20), 'one on the target cell');
  });

  test('mines are invisible to enemies unless one of their units is right next to them', () => {
    const { world, p0, p1 } = sandbox({ fog: true });
    const mine = world.addBuilding('minv', p0, 20, 20, true);
    const watcher = unit(world, 'e1', p1, 23.5, 20.5);
    run(world, 8);
    assert.ok(world.isVisible(p1, 20.5, 20.5), 'the cell itself is in sight');
    assert.ok(!world.canSee(p1, mine), 'but the mine is hidden');
    assert.ok(world.canSee(p0, mine), 'owner sees it');
    watcher.x = 21.5;
    const events: GameEvent[] = [];
    run(world, 8, events);
    assert.ok(world.canSee(p1, mine), 'adjacent enemy spots it');
    assert.ok(events.some((e) => e.e === 'announce' && e.player === p1.id && e.key === 'mine_detected'), '"mine detected"');
  });

  test('an AT mine wrecks an enemy tank (1200 HE) and is gone; friendlies and infantry pass safely', () => {
    const { world, p0, p1 } = sandbox();
    building(world, 'powr', p1, 40, 40); // keeps p1 in the game
    const mine = world.addBuilding('minv', p0, 20, 20, true);
    const own = unit(world, '2tnk', p0, 16.5, 20.5);
    world.issue({ c: 'move', player: p0.id, units: [own.id], x: 24.5, y: 20.5 });
    run(world, seconds(6));
    assert.ok(mine.alive && own.hp === own.maxHp && own.x > 23, 'own tank drives over its own mine');
    world.kill(own);
    const inf = unit(world, 'e1', p1, 18.5, 20.5);
    world.issue({ c: 'move', player: p1.id, units: [inf.id], x: 22.5, y: 20.5 });
    run(world, seconds(5));
    assert.ok(mine.alive && inf.alive && inf.x > 21, `infantry does not set off an AT mine (${mine.alive} ${inf.alive} ${inf.x})`);
    const tank = unit(world, '3tnk', p1, 17.5, 20.5);
    world.issue({ c: 'move', player: p1.id, units: [tank.id], x: 23.5, y: 20.5 });
    const events: GameEvent[] = [];
    const t = runUntil(world, () => !mine.alive, seconds(8), events);
    assert.ok(t > 0, 'mine went off');
    assert.equal(tank.maxHp - tank.hp, 300, `1200 HE vs heavy armour = 300 (took ${tank.maxHp - tank.hp})`);
    assert.ok(events.some((e) => e.e === 'impact' && e.kind === 'large'), 'explosion');
    assert.ok(!events.some((e) => e.e === 'announce' && e.key === 'structure_lost'), 'a mine is no "structure lost"');
  });

  test('an AP mine kills enemy infantry around it; a vehicle just clears it', () => {
    const { world, p0, p1 } = sandbox();
    const mine = world.addBuilding('minp', p1, 20, 20, true);
    const a = unit(world, 'e1', p0, 17.5, 20.5);
    const b = unit(world, 'e1', p0, 17.5, 20.9);
    world.issue({ c: 'move', player: p0.id, units: [a.id, b.id], x: 22.5, y: 20.5 });
    const t = runUntil(world, () => !mine.alive, seconds(8));
    assert.ok(t > 0, 'mine went off');
    run(world, 1);
    assert.ok(!a.alive, 'the infantryman who stepped on it is dead');
    const mine2 = world.addBuilding('minp', p1, 25, 25, true);
    const jeep = unit(world, 'jeep', p0, 22.5, 25.5);
    world.issue({ c: 'move', player: p0.id, units: [jeep.id], x: 28.5, y: 25.5 });
    runUntil(world, () => !mine2.alive, seconds(8));
    assert.ok(!mine2.alive && jeep.alive && jeep.maxHp - jeep.hp <= 10, 'vehicle clears an AP mine with a scratch');
  });

  test('an empty minelayer re-arms on a service depot pad', () => {
    const { world, p0 } = sandbox();
    powerUp(world, p0, 30, 30, 1);
    const fix = building(world, 'fix', p0, 20, 20);
    const a = unit(world, 'mnly', p0, 14.5, 21.5);
    a.ammo = 0;
    world.issue({ c: 'enter', player: p0.id, units: [a.id], target: fix.id });
    const t = runUntil(world, () => a.ammo === 5, seconds(30));
    assert.ok(t > 0, `re-armed (ammo ${a.ammo})`);
  });

  test('mines can not be sold (minelayers re-arm for free) and are not laid under enemy units', () => {
    const { world, p0, p1 } = sandbox();
    const mine = world.addBuilding('minv', p0, 20, 20, true);
    world.issue({ c: 'sell', player: p0.id, building: mine.id });
    run(world, seconds(2));
    assert.ok(mine.alive && mine.selling < 0, 'not sold');
    building(world, 'powr', p1, 40, 40);
    const tank = unit(world, '3tnk', p1, 10.3, 10.3);
    tank.stance = 'passive'; // (it would otherwise shell the minelayer point blank)
    const layer = unit(world, 'mnly', p0, 10.7, 10.7); // same cell as the enemy tank
    world.issue({ c: 'deploy', player: p0.id, units: [layer.id] });
    run(world, seconds(2));
    assert.ok(!allMines(world).some((m) => m.cx === 10 && m.cy === 10), 'no mine under the enemy tank');
    assert.equal(tank.hp, tank.maxHp, 'tank unharmed');
  });

  test('mines left behind do not keep a beaten player alive', () => {
    const { world, p0, p1 } = sandbox();
    world.addBuilding('minp', p1, 20, 20, true);
    unit(world, 'e1', p0, 5.5, 5.5);
    building(world, 'powr', p0, 8, 8);
    run(world, seconds(1.2));
    assert.ok(p1.defeated, 'only mines left: defeated');
    assert.ok(world.gameOver, 'game over');
  });
});

// ---------------------------------------------------------------------------
describe('gap generators and radar jammers', () => {
  test('a powered gap generator shrouds its radius from enemies; units inside still see around them', () => {
    const { world, p0, p1 } = sandbox({ fog: true });
    powerUp(world, p0, 2, 2, 1);
    const gap = building(world, 'gap', p0, 20, 20);
    // an enemy radar dome nearby would normally see the whole area
    building(world, 'dome', p1, 32, 20);
    run(world, 4);
    const inField = cell(world, 22.5, 21.5);
    assert.equal(p1.visible[inField], 0, 'shrouded');
    assert.equal(p1.explored[inField], 0, 'not even explored');
    assert.equal(p0.visible[inField], 1, 'owner unaffected');
    const scout = unit(world, 'e1', p1, 24.5, 21.5);
    run(world, 4);
    assert.equal(p1.visible[cell(world, 24.5, 22.5)], 1, 'a unit inside the field sees its surroundings');
    assert.equal(p1.visible[cell(world, 18.5, 21.5)], 0, 'beyond its sight stays dark');
    void scout;
    // low power: the field collapses
    for (const b of world.buildings) if (b.owner === p0 && b.bt.id === 'apwr') world.kill(b);
    building(world, 'atek', p0, 4, 30);
    run(world, 12);
    assert.ok(p0.lowPower, 'low power');
    assert.equal(p1.visible[inField], 1, 'without full power the gap stops jamming');
    assert.ok(gap.alive, 'gap alive');
  });

  test('a mobile gap generator shrouds a small area around itself', () => {
    const { world, p0, p1 } = sandbox({ fog: true });
    const mgg = unit(world, 'mgg', p0, 20.5, 20.5);
    building(world, 'dome', p1, 26, 20);
    run(world, 4);
    assert.equal(p1.visible[cell(world, 20.5, 20.5)], 0, 'its own cell is shrouded');
    assert.equal(p1.visible[cell(world, 20.5, 25.5)], 1, 'beyond 3 cells visible');
    assert.equal(UNITS.mgg.gapRadius, 3, 'RA mobile gap radius');
    void mgg;
  });

  test('a mobile radar jammer blinds enemy radar domes and SAM sites in range', () => {
    const { world, p0, p1 } = sandbox();
    powerUp(world, p1, 30, 40, 2);
    const dome = building(world, 'dome', p1, 30, 30);
    const sam = building(world, 'sam', p1, 30, 34);
    run(world, 2);
    assert.ok(p1.radar, 'radar online');
    const mrj = unit(world, 'mrj', p0, 24.5, 31.5);
    const events: GameEvent[] = [];
    run(world, seconds(1.1), events);
    assert.ok(dome.jammed && sam.jammed, 'jammed');
    assert.ok(!p1.radar, 'radar offline');
    const said = events.filter((e) => e.e === 'announce' && e.player === p1.id).map((e) => (e as { key: string }).key);
    assert.ok(said.includes('radar_jammed') && !said.includes('radar_offline'), `"radar jammed" instead of "radar offline" (${said})`);
    const heli = unit(world, 'heli', p0, 31.5, 36.5);
    heli.altitude = 1.5;
    run(world, seconds(2));
    assert.equal(heli.hp, heli.maxHp, 'a jammed SAM does not fire');
    world.kill(mrj);
    run(world, seconds(1.1));
    assert.ok(!dome.jammed && p1.radar, 'radar back once the jammer is gone');
  });
});

// ---------------------------------------------------------------------------
describe('Chinook', () => {
  test('infantry board a landed Chinook, it flies off, lands and unloads all five', () => {
    const { world, p0 } = sandbox();
    const tran = unit(world, 'tran', p0, 10.5, 10.5);
    const inf = [0, 1, 2, 3, 4].map((k) => unit(world, 'e1', p0, 8.5 + k * 0.4, 13.5));
    world.issue({ c: 'enter', player: p0.id, units: inf.map((u) => u.id), target: tran.id });
    const t = runUntil(world, () => tran.passengers.length === 5, seconds(20));
    assert.ok(t > 0, `all aboard (${tran.passengers.length})`);
    world.issue({ c: 'move', player: p0.id, units: [tran.id], x: 34.5, y: 30.5 });
    run(world, seconds(1));
    assert.ok(tran.altitude > 0.3, 'took off');
    const t2 = runUntil(world, () => Math.hypot(tran.x - 34.5, tran.y - 30.5) < 0.4 && tran.altitude === 0, seconds(30));
    assert.ok(t2 > 0, 'landed at the destination');
    world.issue({ c: 'deploy', player: p0.id, units: [tran.id] });
    run(world, 3);
    assert.equal(tran.passengers.length, 0, 'unloaded');
    for (const u of inf) assert.ok(u.alive && !u.transport && Math.hypot(u.x - tran.x, u.y - tran.y) < 3, 'passengers next to it');
  });

  test('built at a helipad, a Chinook hops off the pad and lands next to it', () => {
    const { world, p0 } = sandbox();
    powerUp(world, p0, 2, 2, 1);
    building(world, 'dome', p0, 10, 10);
    const pad = building(world, 'hpad', p0, 20, 20);
    assert.ok(p0.canBuild('tran'), 'Chinook buildable at the helipad');
    world.issue({ c: 'build', player: p0.id, type: 'tran' });
    const t = runUntil(world, () => world.units.some((u) => u.ut.id === 'tran'), seconds(60));
    assert.ok(t > 0, 'built');
    const tran = world.units.find((u) => u.ut.id === 'tran')!;
    run(world, seconds(8));
    assert.equal(tran.altitude, 0, 'landed');
    assert.equal(world.map.occupant[cell(world, tran.x, tran.y)], 0, 'not on the pad');
    assert.ok(pad.distTo(tran.x, tran.y) < 3, 'close by');
  });

  test('a Chinook in the air takes nobody aboard; D over open ground lands and unloads', () => {
    const { world, p0 } = sandbox();
    const tran = unit(world, 'tran', p0, 20.5, 20.5);
    tran.altitude = 1.55;
    tran.order = { type: 'move', x: 30.5, y: 20.5, attackMove: false };
    const e = unit(world, 'e1', p0, 20.5, 20.6);
    assert.equal(world.board(e, tran), false, 'no boarding mid-air');
    run(world, seconds(1));
    tran.passengers.push(e);
    e.transport = tran.id;
    world.units = world.units.filter((u) => u !== e);
    world.issue({ c: 'deploy', player: p0.id, units: [tran.id] });
    const t = runUntil(world, () => tran.passengers.length === 0, seconds(10));
    assert.ok(t > 0, 'landed and unloaded');
    assert.ok(tran.altitude < 0.1, `on the ground (${tran.altitude})`);
    assert.ok(world.units.includes(e), 'passenger back on the map');
  });
});

// ---------------------------------------------------------------------------
describe('camo pillbox and decoys', () => {
  test('a camo pillbox is invisible until it fires or an enemy is adjacent', () => {
    const { world, p0, p1 } = sandbox({ fog: true });
    powerUp(world, p0, 2, 2, 1);
    const hbox = building(world, 'hbox', p0, 20, 20);
    const dome = building(world, 'dome', p1, 26, 20);
    run(world, 8);
    assert.ok(world.isVisible(p1, 20.5, 20.5), 'in the enemy dome\'s sight');
    assert.ok(!world.canSee(p1, hbox), 'camouflaged');
    void dome;
    const victim = unit(world, 'e1', p1, 23.5, 20.5);
    const t = runUntil(world, () => world.tick - hbox.lastFireTick < 2, seconds(5));
    assert.ok(t > 0, 'it opens fire');
    run(world, 4);
    assert.ok(world.canSee(p1, hbox), 'revealed by firing');
    void victim;
  });

  test('decoys look like the real structure to enemies, cost 50 and give no tech', () => {
    const { world, p0, p1 } = sandbox();
    const f = building(world, 'facf', p0, 20, 20);
    assert.equal(BUILDINGS.facf.cost, 50, 'cheap');
    assert.equal(apparentType(f, p1).id, 'fact', 'enemy sees a Construction Yard');
    assert.equal(apparentType(f, p0).id, 'facf', 'owner knows');
    assert.equal(f.bt.fakeOf, 'fact', 'renderer draws the real model');
    assert.ok(!p0.has('fact') && !p0.canBuild('powr'), 'no construction from a decoy');
    f.spiedBy |= 1 << p1.id;
    assert.equal(apparentType(f, p1).id, 'facf', 'a spy sees through it');
    assert.ok(BUILDINGS.weaf.fakeOf === 'weap' && BUILDINGS.syrf.water && BUILDINGS.spef.owner.includes('soviet'), 'other decoys per RA');
  });
});

// ---------------------------------------------------------------------------
describe('support powers', () => {
  test('GPS: the Allied Tech Center launches the satellite by itself when charged; the map stays charted', () => {
    const { world, p0 } = sandbox({ fog: true });
    powerUp(world, p0, 2, 2, 3);
    building(world, 'atek', p0, 10, 10);
    assert.ok(superAvailable(world, p0, 'gps'), 'GPS available with the tech center');
    assert.equal(superFull(world, p0, 'gps'), 180, 'charge time');
    p0.superCharge.gps = superFull(world, p0, 'gps') - 0.01;
    const events: GameEvent[] = [];
    run(world, 2, events);
    assert.ok(p0.gps, 'launched');
    assert.ok(events.some((e) => e.e === 'announce' && e.key === 'gps_launched'), 'announced');
    assert.ok(events.some((e) => e.e === 'power' && e.kind === 'gps'), 'power event');
    run(world, seconds(5));
    assert.ok(p0.explored.every((v) => v === 1), 'whole map explored for good');
    assert.ok(!superAvailable(world, p0, 'gps'), 'one shot');
  });

  test('spy plane: a U2 flies in from the edge and photographs the target area', () => {
    const { world, p0, p1 } = sandbox({ fog: true, factions: ['soviet', 'allies'] });
    powerUp(world, p0, 2, 40, 1);
    building(world, 'afld', p0, 6, 36);
    assert.ok(superAvailable(world, p0, 'spyplane') && superAvailable(world, p0, 'paratroopers') && superAvailable(world, p0, 'parabombs'), 'airfield powers');
    p0.superCharge.spyplane = superFull(world, p0, 'spyplane');
    building(world, 'powr', p1, 38, 8);
    assert.ok(!world.isVisible(p0, 39, 9), 'target unseen');
    world.issue({ c: 'superweapon', player: p0.id, kind: 'spyplane', x: 39, y: 9 });
    run(world, 1);
    const u2 = world.units.find((u) => u.ut.id === 'u2')!;
    assert.ok(u2 && u2.isAir, 'spy plane airborne');
    const nearEdge = Math.min(u2.x, u2.y, world.map.w - u2.x, world.map.h - u2.y);
    assert.ok(nearEdge < 1.2, `enters at the map edge (${u2.x.toFixed(1)}, ${u2.y.toFixed(1)})`);
    const t = runUntil(world, () => world.isVisible(p0, 39, 9), seconds(20));
    assert.ok(t > 0, 'target revealed');
    assert.ok(world.isVisible(p0, 39 - SPYPLANE_RADIUS + 1, 9), 'radius 9 around it');
    runUntil(world, () => !u2.alive, seconds(20));
    assert.ok(!u2.alive, 'flew off the map');
    assert.equal(p0.stats.unitsLost, 0, 'leaving is not a loss');
    run(world, seconds(16));
    assert.ok(!world.isVisible(p0, 39, 9), 'photo fades after a while');
  });

  test('paratroopers: a Badger drops five riflemen who float down and fight', () => {
    const { world, p0, p1 } = sandbox({ factions: ['soviet', 'allies'] });
    building(world, 'afld', p0, 6, 36);
    building(world, 'powr', p1, 32, 8);
    p0.superCharge.paratroopers = superFull(world, p0, 'paratroopers');
    world.issue({ c: 'superweapon', player: p0.id, kind: 'paratroopers', x: 30.5, y: 12.5 });
    const events: GameEvent[] = [];
    const t = runUntil(world, () => world.units.filter((u) => u.ut.id === 'e1' && u.owner === p0).length === PARATROOPERS, seconds(30), events);
    assert.ok(t > 0, 'five dropped');
    assert.ok(events.some((e) => e.e === 'announce' && e.player === p1.id && e.key === 'paratroopers_inbound'), 'target owner warned');
    const troops = world.units.filter((u) => u.ut.id === 'e1' && u.owner === p0);
    assert.ok(troops.every((u) => u.parachute > 0 && u.parachute <= PARACHUTE_SECONDS), 'under parachutes');
    assert.ok(troops.every((u) => Math.hypot(u.x - 30.5, u.y - 12.5) < 3.5), 'over the drop zone');
    run(world, seconds(PARACHUTE_SECONDS + 0.2));
    assert.ok(troops.every((u) => u.parachute === 0 && u.alive), 'landed');
    assert.ok(troops.every((u) => u.order.type !== 'idle' || Math.hypot(u.x - 30.5, u.y - 12.5) < 3.5), 'moving to / at the drop zone');
  });

  test('parabombs: a line of bombs falls on the target', () => {
    const { world, p0, p1 } = sandbox({ factions: ['soviet', 'allies'] });
    building(world, 'afld', p0, 6, 36);
    const target = building(world, 'weap', p1, 30, 10);
    p0.superCharge.parabombs = superFull(world, p0, 'parabombs');
    world.issue({ c: 'superweapon', player: p0.id, kind: 'parabombs', x: target.x, y: target.y });
    let bombs = 0;
    const seen = new Set<number>();
    for (let k = 0; k < seconds(25); k++) {
      run(world, 1);
      for (const pr of world.projectiles) if (pr.kind === 'bomb' && !seen.has(pr.id)) { seen.add(pr.id); bombs++; }
    }
    assert.equal(bombs, PARABOMBS, 'seven bombs');
    assert.ok(target.hp < target.maxHp * 0.85, `target hit (${target.hp}/${target.maxHp})`);
  });

  test('AA defences can shoot the Badger down before it drops', () => {
    const { world, p0, p1 } = sandbox({ factions: ['soviet', 'allies'] });
    building(world, 'afld', p0, 6, 36);
    powerUp(world, p1, 40, 40, 1);
    // three AA guns right on the flight line, short of the target
    for (let k = 0; k < 3; k++) building(world, 'agun', p1, 18 + k, 23 - k);
    p0.superCharge.paratroopers = superFull(world, p0, 'paratroopers');
    world.issue({ c: 'superweapon', player: p0.id, kind: 'paratroopers', x: 34.5, y: 8.5 });
    run(world, 2);
    const badr = world.units.find((u) => u.ut.id === 'badr')!;
    assert.ok(badr, 'badger in the air');
    runUntil(world, () => !badr.alive, seconds(30));
    assert.ok(!badr.alive, 'gone');
    assert.ok(badr.sortie!.drops < PARATROOPERS, `shot down before finishing its drop (${badr.sortie!.drops})`);
    assert.equal(p0.stats.unitsLost, 1, 'counted as a loss');
  });
});

// ---------------------------------------------------------------------------
function riverWorld() {
  // a 48x48 map split by a 4-wide north-south river, one 2-lane bridge over it
  const map = new GameMap(48, 48);
  map.startPositions = [{ x: 6.5, y: 41.5 }, { x: 41.5, y: 6.5 }];
  for (let y = 0; y < 48; y++) for (let x = 22; x <= 25; x++) map.terrain[map.idx(x, y)] = T.Water;
  map.bridges.push({ axis: 'x', cells: [[22, 20], [23, 20], [24, 20], [25, 20], [22, 21], [23, 21], [24, 21], [25, 21]] });
  const world = new World({ map, players: [
    { name: 'P0', faction: 'allies', color: 0, team: 0, isHuman: true },
    { name: 'P1', faction: 'soviet', color: 0, team: 1, isHuman: true },
  ], credits: 10000, startUnits: 'none', fog: false, seed: 3 });
  world.cratesEnabled = false;
  return { world, map, p0: world.players[0], p1: world.players[1] };
}

describe('bridges', () => {
  test('an intact bridge carries ground units over the river', () => {
    const { world, map, p0 } = riverWorld();
    assert.equal(world.bridges.length, 1, 'one bridge');
    assert.equal(world.bridges[0].hp, BRIDGE_STRENGTH, 'RA BridgeStrength');
    assert.ok(map.passable(23, 20) && !map.passable(23, 30), 'deck passable, river not');
    const tank = unit(world, '2tnk', p0, 15.5, 30.5);
    world.issue({ c: 'move', player: p0.id, units: [tank.id], x: 32.5, y: 30.5 });
    const t = runUntil(world, () => tank.x > 31, seconds(40));
    assert.ok(t > 0, 'crossed by the bridge');
  });

  test('explosives bring it down (force-fire), units on it are lost; an engineer rebuilds it', () => {
    const { world, map, p0, p1 } = riverWorld();
    const b = world.bridges[0];
    const onDeck = unit(world, 'e1', p1, 23.5, 21.5);
    const artillery = [0, 1, 2].map((k) => unit(world, 'arty', p0, 18.5, 17.5 + k));
    world.issue({ c: 'attackGround', player: p0.id, units: artillery.map((u) => u.id), x: 23.5, y: 20.5 });
    const events: GameEvent[] = [];
    const t = runUntil(world, () => !b.alive, seconds(120), events);
    assert.ok(t > 0, 'bridge destroyed');
    run(world, 1);
    assert.ok(!map.passable(23, 20), 'deck is water again');
    assert.ok(!onDeck.alive, 'the rifleman on it fell in');
    assert.ok(events.some((e) => e.e === 'bridge' && e.id === b.id && !e.alive), 'bridge event');
    assert.ok(events.some((e) => e.e === 'announce' && e.key === 'bridge_destroyed'), 'announced');
    world.issue({ c: 'stop', player: p0.id, units: artillery.map((u) => u.id) });
    const eng = unit(world, 'e6', p0, 15.5, 25.5);
    world.issue({ c: 'repairBridge', player: p0.id, units: [eng.id], bridge: b.id });
    const t2 = runUntil(world, () => b.alive, seconds(30));
    assert.ok(t2 > 0, 'rebuilt');
    assert.ok(!eng.alive, 'engineer used up');
    assert.ok(map.passable(23, 20) && b.hp === b.maxHp, 'passable again at full strength');
  });

  test('bullets do not hurt a bridge', () => {
    const { world, p0 } = riverWorld();
    const b = world.bridges[0];
    const rifles = [0, 1, 2].map((k) => unit(world, 'e1', p0, 20.5, 19.5 + k));
    world.issue({ c: 'attackGround', player: p0.id, units: rifles.map((u) => u.id), x: 23.5, y: 20.5 });
    run(world, seconds(10));
    assert.equal(b.hp, b.maxHp, 'small arms do nothing');
  });

  test('addBridgesToMap spans a river where it saves a long detour, symmetrically', () => {
    const map = new GameMap(64, 64);
    map.startPositions = [{ x: 8.5, y: 55.5 }, { x: 55.5, y: 8.5 }];
    // a diagonal-symmetric river from the north-west to the south-east with a ford in the middle
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      if (Math.abs(x - y) <= 2 && Math.abs(x - 31.5) > 4) map.terrain[map.idx(x, y)] = T.Water;
    }
    const n = addBridgesToMap(map, 1);
    assert.equal(n, 1, 'one bridge (and its mirror image)');
    assert.equal(map.bridges.length, 2, 'symmetric pair');
    const [a, b] = map.bridges;
    const mirrored = a.cells.every(([x, y]) => b.cells.some(([u, v]) => u === 63 - x && v === 63 - y));
    assert.ok(mirrored, '180° images of each other');
    for (const br of map.bridges) for (const [x, y] of br.cells) assert.equal(map.terrain[map.idx(x, y)], T.Water, 'decks over water');
  });

  test('generated maps get bridges only where useful, and stay deterministic', () => {
    const a = generateMap({ size: 128, players: 3, seed: 9, water: 0.5, trees: 0.5, ore: 0.6 });
    const b = generateMap({ size: 128, players: 3, seed: 9, water: 0.5, trees: 0.5, ore: 0.6 });
    assert.deepEqual(a.bridges, b.bridges, 'same seed, same bridges');
    const none = generateMap({ size: 128, players: 3, seed: 9, water: 0.5, trees: 0.5, ore: 0.6, bridges: false });
    assert.equal(none.bridges.length, 0, 'can be switched off');
  });
});

// ---------------------------------------------------------------------------
describe('stances', () => {
  function duel(stance: 'aggressive' | 'guard' | 'hold' | 'passive', enemyAt: number, enemy = 'e1') {
    const { world, p0, p1 } = sandbox();
    const u = unit(world, '2tnk', p0, 20.5, 20.5);
    world.issue({ c: 'stance', player: p0.id, units: [u.id], stance });
    const e = unit(world, enemy, p1, 20.5 + enemyAt, 20.5);
    return { world, u, e, p1 };
  }

  test('hold: never moves on its own, fires at what is in range', () => {
    const far = duel('hold', 6); // in sight (5) + range (4.75)? out of weapon range
    far.e.ut = { ...far.e.ut, primary: undefined } as never; // the rifleman stays harmless
    run(far.world, seconds(5));
    assert.ok(Math.hypot(far.u.x - 20.5, far.u.y - 20.5) < 0.2, 'held position');
    const near = duel('hold', 4);
    run(near.world, seconds(5));
    assert.ok(Math.hypot(near.u.x - 20.5, near.u.y - 20.5) < 0.2, 'still in place');
    assert.ok(near.e.hp < near.e.maxHp, 'fired at the target in range');
  });

  test('guard chases a little; aggressive hunts down whatever it sees', () => {
    const g = duel('guard', 4.2, 'jeep');
    const a = duel('aggressive', 4.2, 'jeep');
    for (const d of [g, a]) {
      run(d.world, 12); // spotted
      // the target drives off
      d.world.issue({ c: 'move', player: d.p1.id, units: [d.e.id], x: 44.5, y: 20.5 });
    }
    run(g.world, seconds(15));
    run(a.world, seconds(15));
    assert.ok(g.u.x < 30, `guard returns to its post (x ${g.u.x.toFixed(1)})`);
    assert.ok(!a.e.alive || a.u.x > 30, `aggressive pursued (x ${a.u.x.toFixed(1)}, target alive ${a.e.alive})`);
  });

  test('passive: never opens fire unprompted, not even when shot at; an explicit order still works', () => {
    const d = duel('passive', 3);
    run(d.world, seconds(4));
    assert.equal(d.e.hp, d.e.maxHp, 'held fire');
    assert.ok(d.u.hp < d.u.maxHp, 'was shot at');
    d.world.issue({ c: 'attack', player: 0, units: [d.u.id], target: d.e.id });
    runUntil(d.world, () => !d.e.alive, seconds(40));
    assert.ok(!d.e.alive, 'attacks when ordered');
  });
});

// ---------------------------------------------------------------------------
describe('AI use of the new content and determinism', () => {
  test('Allied AI sends spies and minelayers, Soviet AI calls in air support', () => {
    const world = skirmish({ seed: 77, size: 96, ai: ['hard', 'hard'] });
    const types = new Map<number, string>();
    const counts: Record<string, number> = {};
    // (32 minutes: since version 5 the Classic AI's tech centre waits for money or an army edge in the first 15
    // minutes, so the Allied GPS goes up later: at 30.7 minutes on this seed)
    for (let t = 0; t < seconds(60 * 32); t++) {
      world.step();
      for (const ev of world.events) {
        if (ev.e === 'infiltrate') counts.infiltrate = (counts.infiltrate ?? 0) + 1;
        if (ev.e === 'power') counts[ev.kind] = (counts[ev.kind] ?? 0) + 1;
      }
      world.events.length = 0;
      for (const e of world.entities.values()) if (!types.has(e.id)) types.set(e.id, e.type.id);
      if (world.gameOver) break;
    }
    const made = (id: string) => [...types.values()].filter((t) => t === id).length;
    assert.ok(made('spy') > 0, 'Allied AI trained a spy');
    assert.ok(made('mnly') > 0 && made('minv') > 0, `Allied AI laid mines (${made('minv')})`);
    assert.ok((counts.spyplane ?? 0) > 0, 'Soviet AI used the spy plane');
    assert.ok((counts.gps ?? 0) > 0, 'Allied GPS launched');
    assert.deepEqual(checkInvariants(world), [], 'invariants hold');
  });

  test('save / load mid-game with spies, mines, bridges, planes and parachutes stays deterministic', () => {
    const make = () => {
      const r = riverWorld();
      const { world, p0, p1 } = r;
      p1.faction = 'soviet';
      building(world, 'afld', p1, 36, 36);
      powerUp(world, p0, 2, 2, 2);
      building(world, 'gap', p0, 8, 8);
      building(world, 'dome', p1, 36, 30);
      world.addBuilding('minv', p0, 14, 30, true);
      const tank = unit(world, '3tnk', p1, 30.5, 30.5);
      world.issue({ c: 'move', player: p1.id, units: [tank.id], x: 10.5, y: 30.5 });
      const spy = unit(world, 'spy', p0, 15.5, 33.5);
      world.issue({ c: 'move', player: p0.id, units: [spy.id], x: 30.5, y: 33.5 });
      unit(world, 'mnly', p0, 12.5, 12.5);
      p1.superCharge.paratroopers = 165;
      world.issue({ c: 'superweapon', player: p1.id, kind: 'paratroopers', x: 10.5, y: 25.5 });
      world.fog = true;
      return world;
    };
    const A = make();
    run(A, seconds(13)); // Badger in flight, chutes in the air
    assert.ok(A.units.some((u) => u.parachute > 0) || A.units.some((u) => u.sortie), 'something airborne at save time');
    const json = JSON.stringify(serializeWorld(A));
    const B = make();
    deserializeWorld(B, JSON.parse(json));
    assert.equal(stateHash(A), stateHash(B), 'identical right after load');
    for (let k = 0; k < seconds(30); k++) {
      A.step(); A.events.length = 0;
      B.step(); B.events.length = 0;
    }
    assert.equal(stateHash(A), stateHash(B), 'identical 30 s later');
    const extra = (w: World) => JSON.stringify([w.bridges, w.players.map((p) => [p.intel, p.gps, p.sonarCharges, p.reveals]),
      w.units.map((u) => [u.id, u.disguise, u.parachute, u.sortie, u.ammo]), w.buildings.map((b) => [b.id, b.cloaked, b.revealedTo, b.spiedBy, b.jammed])]);
    assert.equal(extra(A), extra(B), 'content state identical');
  });

  test('two runs of the same content-heavy skirmish are identical', () => {
    const run2 = () => {
      const w = skirmish({ seed: 31, size: 64, ai: ['hard', 'hard'] });
      for (let t = 0; t < seconds(60 * 12); t++) { w.step(); w.events.length = 0; }
      return stateHash(w);
    };
    assert.equal(run2(), run2(), 'deterministic');
  });
});

void Building; void Unit;
