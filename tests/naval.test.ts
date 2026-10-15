// Naval warfare: shipyards on water, naval pathing, torpedo / depth charge rules, submarines (submerge,
// detection, canSee), transports, sea maps, the naval AI, determinism and save / load.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BUILDINGS, UNITS, WEAPONS } from '../src/data/rules';
import { generateMap, floodReach } from '../src/sim/mapgen';
import { PathFinder } from '../src/sim/pathfinding';
import { pickWeapon, impact } from '../src/sim/combat';
import { queueKindOf } from '../src/sim/player';
import { SUBMERGE_DELAY, navalLaunchOk } from '../src/sim/naval';
import { seaInfo } from '../src/sim/ai-naval';
import { serializeWorld, deserializeWorld } from '../src/sim/save';
import { destroyBridge, initBridges } from '../src/sim/bridges';
import {
  T, World, building, checkInvariants, paint, run, runUntil, sandbox, seconds, skirmish, stateHash, unit,
  type GameEvent, type GameMap, type Sandbox,
} from './helpers';

/** 48x48 sandbox: land west of x = 24, sea to the east with a small island at (34..37, 30..33). */
function seaBox(opts: { fog?: boolean } = {}): Sandbox {
  const s = sandbox({ fog: opts.fog });
  paint(s.map, 24, 0, 47, 47, T.Water);
  paint(s.map, 34, 30, 37, 33, T.Clear);
  return s;
}

/** Allied base on the shore: Construction Yard + power, shipyard on the water next to them. */
function alliedHarbour(s: Sandbox) {
  building(s.world, 'fact', s.p0, 16, 8);
  building(s.world, 'powr', s.p0, 20, 8);
  building(s.world, 'apwr', s.p0, 19, 12);
  const yard = building(s.world, 'syrd', s.p0, 24, 9);
  return yard;
}

const onWater = (m: GameMap, x: number, y: number) => m.terrain[m.idx(Math.floor(x), Math.floor(y))] === T.Water;
const onLand = (m: GameMap, x: number, y: number) => m.passable(Math.floor(x), Math.floor(y));

describe('naval rules', () => {
  test('naval types exist with RA stats, prerequisites and their own queue', () => {
    for (const id of ['pt', 'dd', 'ca', 'lst', 'ss']) {
      const t = UNITS[id];
      assert.ok(t, `${id} defined`);
      assert.equal(t.kind, 'naval', `${id} kind`);
      assert.equal(t.category, 'naval', `${id} category`);
      assert.equal(queueKindOf(t), 'naval', `${id} queue`);
    }
    assert.deepEqual([UNITS.pt.cost, UNITS.dd.cost, UNITS.ca.cost, UNITS.lst.cost, UNITS.ss.cost], [500, 1000, 2000, 700, 950]);
    assert.deepEqual([UNITS.pt.strength, UNITS.dd.strength, UNITS.ca.strength, UNITS.lst.strength, UNITS.ss.strength], [200, 400, 700, 350, 120]);
    assert.deepEqual(UNITS.ca.prereq, ['syrd', 'atek']);
    assert.deepEqual(UNITS.ss.owner, ['soviet']);
    assert.deepEqual(UNITS.lst.owner, ['allies', 'soviet']);
    assert.equal(UNITS.lst.passengers, 5);
    assert.ok(UNITS.ss.cloakable, 'submarine cloaks');
    assert.ok((UNITS.dd.sensors ?? 0) >= 2 && (UNITS.pt.sensors ?? 0) >= 2, 'destroyer and gunboat detect subs');
    assert.equal(WEAPONS.TorpTube.projectile, 'torpedo');
    assert.equal(WEAPONS.DepthCharge.projectile, 'depthcharge');
    assert.ok(WEAPONS.Stinger.antiAir && WEAPONS.Stinger.antiGround, 'destroyer missiles hit air and surface');
    assert.equal(WEAPONS['8Inch'].range, 22);
    for (const id of ['syrd', 'spen']) {
      const b = BUILDINGS[id];
      assert.ok(b.water, `${id} stands on water`);
      assert.equal(b.factory, 'naval');
      assert.deepEqual(b.size, [3, 3]);
    }
  });
});

describe('naval yards', () => {
  test('placed on water with the whole footprint, next to the base', () => {
    const s = seaBox();
    const { world, p0, p1 } = s;
    building(world, 'fact', p0, 16, 8);
    building(world, 'powr', p0, 20, 8);
    assert.equal(world.placementIssue(p0, 'syrd', 24, 8), null, 'water next to the power plant');
    assert.equal(world.placementIssue(p0, 'syrd', 23, 8), 'terrain', 'footprint straddles the shore');
    assert.equal(world.placementIssue(p0, 'syrd', 17, 14), 'terrain', 'on land');
    assert.equal(world.placementIssue(p0, 'syrd', 30, 8), 'distance', 'out at sea, far from the base');
    assert.equal(world.placementIssue(p0, 'powr', 24, 8), 'terrain', 'land structures stay off the water');
    assert.equal(p1.canBuild('syrd'), false, 'Soviets have no shipyard');
    building(world, 'fact', p1, 16, 30);
    building(world, 'powr', p1, 20, 30);
    assert.ok(p1.canBuild('spen'), 'Soviets build a sub pen after a power plant');
    assert.equal(world.placementIssue(p1, 'spen', 24, 30), null, 'sub pen on water');
  });

  test('a yard needs open water alongside to launch ships', () => {
    const s = sandbox();
    paint(s.map, 22, 8, 24, 10, T.Water); // a pond exactly the size of the yard
    building(s.world, 'fact', s.p0, 16, 8);
    building(s.world, 'powr', s.p0, 20, 8);
    assert.equal(navalLaunchOk(s.map, BUILDINGS.syrd, 22, 8), false, 'no launch lane');
    assert.equal(s.world.placementIssue(s.p0, 'syrd', 22, 8), 'exit');
  });

  test('ships launch into the water next to the yard and sail to a rally point on the water', () => {
    const s = seaBox();
    const yard = alliedHarbour(s);
    s.world.issue({ c: 'rally', player: 0, building: yard.id, x: 32.5, y: 12.5 });
    s.world.issue({ c: 'build', player: 0, type: 'pt' });
    s.world.issue({ c: 'build', player: 0, type: 'e1' });
    const events: GameEvent[] = [];
    const t = runUntil(s.world, () => s.world.units.some((u) => u.ut.id === 'pt'), seconds(30), events);
    assert.ok(t > 0, 'gunboat produced');
    const pt = s.world.units.find((u) => u.ut.id === 'pt')!;
    assert.ok(onWater(s.map, pt.x, pt.y) && yard.distTo(pt.x, pt.y) < 2, `launched alongside the yard (${pt.x}, ${pt.y})`);
    assert.ok(events.some((e) => e.e === 'sfx' && e.key === 'ship_horn'), 'horn on launch');
    run(s.world, seconds(12));
    assert.ok(Math.hypot(pt.x - 32.5, pt.y - 12.5) < 1, `reached the rally point (${pt.x.toFixed(1)}, ${pt.y.toFixed(1)})`);
    assert.equal(s.p0.queues.naval.items.length, 0, 'naval queue empty');
  });

  test('yards repair ships moored alongside', () => {
    const s = seaBox();
    const yard = alliedHarbour(s);
    const dd = unit(s.world, 'dd', s.p0, 27.5, 10.5);
    dd.hp = 100;
    run(s.world, seconds(6));
    assert.ok(dd.hp > 200, `repaired to ${dd.hp}`);
    void yard;
  });
});

describe('naval movement', () => {
  test('the naval path search stays on water and ground searches are unchanged', () => {
    const s = seaBox();
    const pf = new PathFinder(s.map);
    const path = pf.find(30, 31, 40, 31, 1e5, 0, 'naval')!;
    const last = path[path.length - 1];
    assert.deepEqual([Math.floor(last.x), Math.floor(last.y)], [40, 31], 'reaches the far side of the island');
    let px = 30.5, py = 31.5;
    for (const p of path) {
      // every point along every (string-pulled) segment is open water
      const n = Math.ceil(Math.hypot(p.x - px, p.y - py) * 4);
      for (let k = 0; k <= n; k++) {
        const x = px + ((p.x - px) * k) / n, y = py + ((p.y - py) * k) / n;
        assert.ok(s.map.navalPassable(Math.floor(x), Math.floor(y)), `path point (${x.toFixed(2)}, ${y.toFixed(2)}) on water`);
      }
      px = p.x; py = p.y;
    }
    // ground search: never into the sea
    const g = pf.find(10, 10, 40, 10, 1e5)!;
    const gl = g[g.length - 1];
    assert.ok(gl.x < 24, `ground path ends on the shore (${gl.x})`);
    assert.equal(pf.find(10, 10, 40, 10, 1e5, 0, 'ground')![0].x, g[0].x, 'explicit ground locomotor = default');
  });

  test('ships sail around islands without touching land; ground units never enter water', () => {
    const s = seaBox();
    const { world, map, p0 } = s;
    const dd = unit(world, 'dd', p0, 30.5, 31.5);
    const tank = unit(world, '2tnk', p0, 20.5, 31.5);
    world.issue({ c: 'move', player: 0, units: [dd.id], x: 41.5, y: 31.5 });
    world.issue({ c: 'move', player: 0, units: [tank.id], x: 30.5, y: 20.5 });
    for (let t = 0; t < seconds(25); t++) {
      run(world, 1);
      assert.ok(map.navalPassable(Math.floor(dd.x), Math.floor(dd.y)), `ship on water at tick ${t} (${dd.x.toFixed(2)}, ${dd.y.toFixed(2)})`);
      assert.ok(onLand(map, tank.x, tank.y), `tank on land at tick ${t}`);
    }
    assert.ok(Math.hypot(dd.x - 41.5, dd.y - 31.5) < 1, `ship arrived (${dd.x.toFixed(1)}, ${dd.y.toFixed(1)})`);
    assert.ok(tank.x < 24 && tank.x > 22, `tank waits on the shore (${tank.x.toFixed(1)})`);
    assert.deepEqual(checkInvariants(world), []);
  });

  test('a ship ordered onto land goes to the nearest water; group moves give ships water slots', () => {
    const s = seaBox();
    const { world, map, p0 } = s;
    const ships = [unit(world, 'pt', p0, 30.5, 20.5), unit(world, 'pt', p0, 31.5, 20.5), unit(world, 'dd', p0, 30.5, 21.5)];
    world.issue({ c: 'move', player: 0, units: ships.map((u) => u.id), x: 20.5, y: 20.5 });
    run(world, seconds(15));
    for (const u of ships) {
      assert.ok(map.navalPassable(Math.floor(u.x), Math.floor(u.y)), `${u.ut.id} on water`);
      assert.ok(u.x < 28.5, `${u.ut.id} came to the coast (${u.x.toFixed(1)})`);
    }
    // a lone ship clicked onto the shore gets the nearest water cell as its destination
    const lone = unit(world, 'ca', p0, 40.5, 40.5);
    world.issue({ c: 'move', player: 0, units: [lone.id], x: 21.5, y: 40.5 });
    run(world, 1);
    assert.ok(lone.order.type === 'move' && map.navalPassable(Math.floor(lone.order.x), Math.floor(lone.order.y)), 'destination snapped to water');
  });

  test('an intact bridge deck blocks ships and naval yards; once it collapses the channel opens', () => {
    const s = sandbox();
    const { world, map, p0 } = s;
    paint(map, 20, 0, 27, 47, T.Water); // a north-south channel with a bridge across it at y = 20..21
    const cells: [number, number][] = [];
    for (let x = 20; x <= 27; x++) for (const y of [20, 21]) cells.push([x, y]);
    map.bridges.push({ cells, axis: 'x' });
    initBridges(world);
    assert.equal(map.navalPassable(23, 20), false, 'deck cell closed to ships');
    const north = (i: number) => seaInfo(map).label[i];
    assert.notEqual(north(map.idx(23, 10)), north(map.idx(23, 32)), 'the bridge splits the channel');
    // no shipyards (or decoys) under the deck
    building(world, 'fact', p0, 13, 18);
    building(world, 'powr', p0, 17, 18);
    building(world, 'powr', p0, 17, 22);
    assert.equal(world.placementIssue(p0, 'syrd', 20, 19), 'terrain', 'shipyard footprint under the deck');
    assert.equal(world.placementIssue(p0, 'syrf', 20, 19), 'terrain', 'decoy shipyard under the deck');
    assert.equal(world.placementIssue(p0, 'syrd', 20, 23), null, 'clear of the deck');
    // a gunboat can't sail through...
    const pt = unit(world, 'pt', p0, 23.5, 10.5);
    world.issue({ c: 'move', player: 0, units: [pt.id], x: 23.5, y: 32.5 });
    run(world, seconds(15));
    assert.ok(pt.y < 20, `stopped north of the bridge (${pt.y.toFixed(1)})`);
    // ...until the bridge is brought down
    destroyBridge(world, world.bridges[0], null);
    assert.ok(map.navalPassable(23, 20), 'channel open');
    assert.equal(north(map.idx(23, 10)), north(map.idx(23, 32)), 'one channel again');
    world.issue({ c: 'move', player: 0, units: [pt.id], x: 23.5, y: 32.5 });
    run(world, seconds(15));
    assert.ok(Math.hypot(pt.x - 23.5, pt.y - 32.5) < 1, `sailed through (${pt.x.toFixed(1)}, ${pt.y.toFixed(1)})`);
  });

  test('ships spawned on land (scripts, crates) are moved onto the nearest water', () => {
    const s = seaBox();
    const ss = unit(s.world, 'ss', s.p1, 20.5, 20.5);
    assert.ok(onWater(s.map, ss.x, ss.y) && ss.x < 26, `submarine placed at the shore (${ss.x}, ${ss.y})`);
    assert.ok(ss.submerged && ss.cloaked, 'subs start submerged');
  });
});

describe('naval combat', () => {
  test('torpedoes only engage ships and naval structures, never subs or land targets', () => {
    const s = seaBox();
    const { world, p0, p1 } = s;
    const yard = alliedHarbour(s);
    const ss = unit(world, 'ss', p1, 32.5, 20.5);
    const pt = unit(world, 'pt', p0, 34.5, 20.5);
    const lst = unit(world, 'lst', p0, 30.5, 22.5);
    const tank = unit(world, '2tnk', p0, 22.5, 20.5);
    const ss2 = unit(world, 'ss', p0, 34.5, 24.5);
    assert.equal(pickWeapon(ss, pt)?.def.id, 'TorpTube', 'gunboat');
    assert.equal(pickWeapon(ss, lst)?.def.id, 'TorpTube', 'transport');
    assert.equal(pickWeapon(ss, yard)?.def.id, 'TorpTube', 'shipyard');
    assert.equal(pickWeapon(ss, tank), null, 'tank on land');
    assert.equal(pickWeapon(ss, world.buildings.find((b) => b.bt.id === 'powr')!), null, 'land structure');
    assert.equal(pickWeapon(ss, ss2), null, 'subs never torpedo subs');
  });

  test('depth charges only engage submarines; ship guns never do; land weapons hit surfaced subs only', () => {
    const s = seaBox();
    const { world, p0, p1 } = s;
    const ss = unit(world, 'ss', p1, 26.5, 20.5);
    const dd = unit(world, 'dd', p0, 30.5, 20.5);
    const ca = unit(world, 'ca', p0, 30.5, 24.5);
    const pt = unit(world, 'pt', p1, 30.5, 28.5);
    const tank = unit(world, '2tnk', p0, 22.5, 20.5);
    const heli = unit(world, 'heli', p1, 20.5, 26.5);
    heli.altitude = 1.5;
    assert.equal(pickWeapon(dd, ss)?.def.id, 'DepthCharge', 'destroyer vs sub');
    assert.equal(pickWeapon(dd, pt)?.def.id, 'Stinger', 'destroyer vs ship');
    assert.equal(pickWeapon(dd, heli)?.def.id, 'Stinger', 'destroyer vs aircraft');
    assert.equal(pickWeapon(dd, world.addUnit('e1', p1, 21.5, 21.5))?.def.id, 'Stinger', 'destroyer vs shore');
    assert.equal(pickWeapon(ca, ss), null, 'cruisers cannot engage submarines');
    assert.equal(pickWeapon(ca, pt)?.def.id, '8Inch', 'cruiser vs ship');
    assert.equal(pickWeapon(tank, ss), null, 'submerged: out of reach of land weapons');
    ss.submerged = false;
    ss.cloaked = false;
    assert.equal(pickWeapon(tank, ss)?.def.id, '90mm', 'surfaced: tanks on the shore can shoot it');
    assert.equal(pickWeapon(ca, ss), null, 'still no cruiser guns on a surfaced sub');
  });

  test('a submerged submarine is invisible to enemies until a sensor ship comes close', () => {
    const s = seaBox();
    const { world, p0, p1 } = s;
    const ss = unit(world, 'ss', p1, 30.5, 20.5);
    const dd = unit(world, 'dd', p0, 40.5, 20.5);
    run(world, 1);
    assert.equal(world.canSee(p0, ss), false, 'hidden');
    assert.equal(world.canSee(p1, ss), true, 'owner always sees it');
    world.issue({ c: 'attack', player: 0, units: [dd.id], target: ss.id });
    run(world, 1);
    assert.equal(dd.order.type, 'idle', 'cannot be ordered to attack an undetected sub');
    dd.x = dd.prevX = 32.5;
    const events: GameEvent[] = [];
    run(world, 1, events);
    assert.ok(world.canSee(p0, ss), 'detected by the destroyer 2 cells away');
    assert.ok(ss.cloaked, 'still submerged');
    assert.ok(events.some((e) => e.e === 'announce' && e.player === p0.id && e.key === 'sub_detected'), 'announced');
    dd.x = dd.prevX = 40.5;
    run(world, 1);
    assert.equal(world.canSee(p0, ss), false, 'lost again');
  });

  test('a destroyer hunts down a detected submarine with depth charges', () => {
    const s = seaBox();
    const { world, p0, p1 } = s;
    const ss = unit(world, 'ss', p1, 30.5, 20.5);
    const dd = unit(world, 'dd', p0, 32.5, 22.5);
    const events: GameEvent[] = [];
    const t = runUntil(world, () => !ss.alive, seconds(40), events);
    assert.ok(t > 0, 'sub sunk');
    assert.ok(dd.alive, 'destroyer survives');
    const fired = events.filter((e) => e.e === 'fire' && e.shooter === dd.id).map((e) => (e as any).weapon.id);
    assert.ok(fired.length && fired.every((id) => id === 'DepthCharge'), `depth charges only: ${fired}`);
    assert.ok(events.some((e) => e.e === 'announce' && e.player === p1.id && e.key === 'naval_unit_lost'), 'naval loss announced');
  });

  test('submarines surface to fire and dive again a few seconds after the last shot', () => {
    const s = seaBox();
    const { world, p0, p1 } = s;
    const ss = unit(world, 'ss', p1, 30.5, 14.5, 0);
    const lst = unit(world, 'lst', p0, 36.5, 14.5);
    assert.ok(ss.submerged, 'starts submerged');
    let surfacedAt = -1, firedAt = -1;
    const events: GameEvent[] = [];
    for (let t = 0; t < seconds(20) && lst.alive; t++) {
      run(world, 1, events);
      if (surfacedAt < 0 && !ss.submerged) surfacedAt = t;
      if (firedAt < 0 && events.some((e) => e.e === 'fire' && e.shooter === ss.id)) firedAt = t;
    }
    assert.ok(surfacedAt >= 0 && firedAt > surfacedAt, `surfaced (${surfacedAt}) before the first torpedo (${firedAt})`);
    assert.equal(lst.alive, false, 'transport sunk by torpedoes');
    assert.ok(events.some((e) => e.e === 'projectile' || (e.e === 'fire' && (e as any).weapon.projectile === 'torpedo')), 'torpedo fired');
    assert.ok(!ss.submerged, 'still on the surface right after the kill');
    run(world, seconds(SUBMERGE_DELAY + 1));
    assert.ok(ss.submerged && ss.cloaked, 'dived again');
    assert.equal(world.canSee(p0, ss), false, 'hidden again');
  });

  test('underwater blasts stay in the water; submerged subs ignore surface explosions', () => {
    const s = seaBox();
    const { world, p0, p1 } = s;
    const sub = unit(world, 'ss', p1, 25.2, 20.5);
    const pt = unit(world, 'pt', p0, 24.6, 21.3);
    const tank = unit(world, '2tnk', p0, 23.4, 20.5);
    const subHp = sub.hp, ptHp = pt.hp, tankHp = tank.hp;
    world.grid.rebuild(world.units);
    impact(world, WEAPONS.TorpTube, null, null, 24.2, 20.8, 0);
    assert.equal(tank.hp, tankHp, 'tank on the shore untouched by the torpedo');
    assert.ok(pt.hp < ptHp, 'gunboat hit');
    const subAfterTorpedo = sub.hp;
    impact(world, WEAPONS['155mm'], null, null, 25.2, 20.5, 0);
    assert.equal(sub.hp, subAfterTorpedo, 'submerged sub ignores an artillery shell');
    impact(world, WEAPONS.DepthCharge, null, null, 25.2, 20.5, 0);
    assert.ok(sub.hp < subAfterTorpedo && sub.hp < subHp, 'depth charge hurts it');
  });

  test('cruisers bombard shore targets far inland; ships can be hit from land and air', () => {
    const s = seaBox();
    const { world, p0, p1 } = s;
    const ca = unit(world, 'ca', p0, 34.5, 10.5);
    const plant = building(world, 'powr', p1, 15, 10);
    world.issue({ c: 'attack', player: 0, units: [ca.id], target: plant.id });
    const t = runUntil(world, () => !plant.alive, seconds(60));
    assert.ok(t > 0, 'power plant destroyed by the cruiser');
    assert.ok(Math.hypot(ca.x - 34.5, ca.y - 10.5) < 3, 'fired from range without closing in');
    const pt = unit(world, 'pt', p1, 25.5, 30.5);
    const tank = unit(world, '2tnk', p0, 21.5, 30.5);
    const hp = pt.hp;
    run(world, seconds(8));
    assert.ok(pt.hp < hp || !pt.alive, 'tank on the shore shoots the gunboat');
    void tank;
  });

  test('a sonar pulse forces enemy subs up and reveals them through the fog', () => {
    const s = seaBox({ fog: true });
    const { world, p0, p1 } = s;
    building(world, 'fact', p0, 4, 4);
    const ss = unit(world, 'ss', p1, 40.5, 40.5);
    run(world, 4);
    assert.equal(world.canSee(p0, ss), false, 'hidden under fog and water');
    world.revealCloaked(p0, 10);
    run(world, 1);
    assert.ok(!ss.submerged && world.canSee(p0, ss), 'surfaced and revealed');
    run(world, seconds(12));
    assert.ok(ss.submerged && !world.canSee(p0, ss), 'gone again after the pulse');
  });
});

describe('transport (LST)', () => {
  test('loads infantry and vehicles from the beach, crosses the water and unloads with deploy', () => {
    const s = sandbox();
    const { world, map, p0 } = s;
    paint(map, 16, 0, 31, 47, T.Water);
    const lst = unit(world, 'lst', p0, 16.5, 10.5);
    const riders = [unit(world, 'e1', p0, 10.5, 10.5), unit(world, 'e1', p0, 10.5, 11.5), unit(world, '2tnk', p0, 9.5, 12.5), unit(world, 'e3', p0, 9.5, 9.5), unit(world, 'harv', p0, 8.5, 14.5)];
    const extra = unit(world, 'e1', p0, 11.5, 8.5);
    world.issue({ c: 'enter', player: 0, units: riders.map((u) => u.id), target: lst.id });
    run(world, seconds(15));
    world.issue({ c: 'enter', player: 0, units: [extra.id], target: lst.id });
    run(world, seconds(3));
    assert.equal(lst.passengers.length, 5, 'full load');
    assert.ok(riders.every((u) => u.transport === lst.id), 'every rider aboard');
    assert.equal(extra.transport, 0, 'the sixth stays ashore');
    assert.ok(!world.units.includes(riders[0]), 'passengers leave the unit list');
    world.issue({ c: 'move', player: 0, units: [lst.id], x: 30.5, y: 30.5 });
    run(world, seconds(15));
    world.issue({ c: 'deploy', player: 0, units: [lst.id] });
    run(world, 2);
    assert.ok(lst.ramp > 0, 'ramp lowering');
    run(world, seconds(3));
    assert.equal(lst.passengers.length, 0, 'everybody off');
    for (const u of riders) {
      assert.ok(world.units.includes(u) && u.transport === 0, `${u.ut.id} back in the world`);
      assert.ok(onLand(map, u.x, u.y) && u.x >= 32, `${u.ut.id} on the far shore (${u.x.toFixed(1)}, ${u.y.toFixed(1)})`);
    }
    assert.deepEqual(checkInvariants(world), []);
  });

  test('deploy at sea sails to the nearest beach first; ships and aircraft cannot board', () => {
    const s = sandbox();
    const { world, map, p0 } = s;
    paint(map, 16, 0, 47, 47, T.Water);
    const lst = unit(world, 'lst', p0, 30.5, 20.5);
    const inf = unit(world, 'e1', p0, 10.5, 20.5);
    world.board(inf, lst);
    run(world, 1);
    assert.equal(lst.passengers.length, 1);
    const pt = unit(world, 'pt', p0, 30.5, 24.5);
    assert.equal(world.board(pt, lst), false, 'no ships inside ships');
    world.issue({ c: 'deploy', player: 0, units: [lst.id] });
    const t = runUntil(world, () => lst.passengers.length === 0, seconds(20));
    assert.ok(t > 0, 'unloaded after sailing to the beach');
    assert.ok(onLand(map, inf.x, inf.y), 'rifleman ashore');
    assert.ok(lst.x < 18, `transport beached (${lst.x.toFixed(1)})`);
  });

  test('passengers go down with the transport', () => {
    const s = seaBox();
    const lst = unit(s.world, 'lst', s.p0, 30.5, 20.5);
    const inf = unit(s.world, 'e1', s.p0, 20.5, 20.5);
    s.world.board(inf, lst);
    s.world.kill(lst);
    assert.equal(inf.alive, false, 'drowned');
  });
});

describe('sea maps', () => {
  /** Every start has a valid 3x3 shipyard spot on water within 14 cells; all those waters are connected. */
  function checkSeaMap(m: GameMap, label: string) {
    const info = seaInfo(m);
    const bodies = new Set<number>();
    for (const st of m.startPositions) {
      let best = Infinity, body = -1;
      for (let cy = Math.floor(st.y) - 16; cy <= st.y + 16; cy++) for (let cx = Math.floor(st.x) - 16; cx <= st.x + 16; cx++) {
        if (!m.inBounds(cx, cy) || !m.inBounds(cx + 2, cy + 2)) continue;
        let ok = true;
        for (let dy = 0; dy < 3 && ok; dy++) for (let dx = 0; dx < 3; dx++) if (!m.navalTerrain(m.idx(cx + dx, cy + dy))) { ok = false; break; }
        if (!ok || !navalLaunchOk(m, BUILDINGS.syrd, cx, cy)) continue;
        const d = Math.hypot(cx + 1.5 - st.x, cy + 1.5 - st.y);
        if (d < best) { best = d; body = info.label[m.idx(cx, cy)]; }
      }
      assert.ok(best <= 14, `${label}: start (${st.x}, ${st.y}) nearest shipyard spot ${best.toFixed(1)} cells`);
      bodies.add(body);
    }
    assert.equal(bodies.size, 1, `${label}: every bay joins one sea`);
    // ground routes around the sea
    const st = m.startPositions.map((p) => [Math.floor(p.x), Math.floor(p.y)] as const);
    const reach = floodReach(m, st[0][0], st[0][1]);
    for (const [x, y] of st) assert.ok(reach[m.idx(x, y)], `${label}: start (${x}, ${y}) reachable by land`);
    for (let i = 0; i < m.w * m.h; i++) if (m.ore[i]) assert.ok(reach[i], `${label}: ore cell reachable`);
  }

  for (const players of [2, 3, 4]) {
    test(`${players} players: a wet map is a sea map (bays at every start, one sea, land routes, symmetric)`, () => {
      for (const size of [64, 96, 128]) for (const seed of [1, 2, 77, 1234]) {
        const m = generateMap({ size, players, seed, water: 1, trees: 0.5, ore: 0.6 });
        checkSeaMap(m, `size ${size} seed ${seed}`);
        // symmetric like every skirmish map (2 players: exactly)
        let diff = 0;
        const N = m.w;
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
          const i = m.idx(x, y);
          const mates: [number, number][] = players > 2 ? [[N - 1 - x, y], [x, N - 1 - y]] : [[N - 1 - x, N - 1 - y]];
          for (const [mx, my] of mates) if (m.terrain[i] !== m.terrain[m.idx(mx, my)]) diff++;
        }
        assert.ok(players === 2 ? diff === 0 : diff <= 3 * N, `size ${size} seed ${seed}: ${diff} asymmetric cells`);
        // home ore stays fair and plentiful
        const home = m.startPositions.map((st) => {
          let v = 0;
          for (let i = 0; i < m.w * m.h; i++) if (m.ore[i] && Math.hypot((i % m.w) + 0.5 - st.x, ((i / m.w) | 0) + 0.5 - st.y) < 18) v += m.ore[i] * (m.gems[i] ? 50 : 25);
          return v;
        });
        assert.ok(Math.min(...home) > 5000 && (Math.max(...home) - Math.min(...home)) / Math.max(...home) < 0.01, `size ${size} seed ${seed}: home ore ${home}`);
      }
    });
  }

  test('the default skirmish (lakes) is not a sea map', () => {
    const a = generateMap({ size: 96, players: 2, seed: 5, water: 0.5, trees: 0.5, ore: 0.6 });
    const b = generateMap({ size: 96, players: 2, seed: 5, water: 0.5, trees: 0.5, ore: 0.6, sea: false });
    assert.deepEqual(a.terrain, b.terrain);
    assert.deepEqual(a.ore, b.ore);
    const sea = generateMap({ size: 96, players: 2, seed: 5, water: 0.5, trees: 0.5, ore: 0.6, sea: true });
    const water = (m: GameMap) => m.terrain.reduce((n, t) => n + (t === T.Water ? 1 : 0), 0);
    assert.ok(water(sea) > water(a) * 1.5, `the sea flag adds a sea (${water(sea)} vs ${water(a)})`);
  });
});

describe('naval AI', () => {
  test('builds a shipyard and a fleet on a sea map', () => {
    const w = skirmish({ seed: 2, size: 64, players: 2, ai: ['hard', 'hard'], map: { water: 1 } });
    let yard = false, ships = 0;
    const seen = new Set<number>();
    for (let t = 0; t < seconds(16 * 60) && !(yard && ships >= 2); t++) {
      w.step();
      for (const e of w.events) {
        if (e.e === 'placed') {
          const b = w.entities.get(e.id);
          if (b && (b.type.id === 'syrd' || b.type.id === 'spen')) yard = true;
        }
      }
      w.events.length = 0;
      for (const u of w.units) if (u.kind === 'naval' && !seen.has(u.id)) { seen.add(u.id); ships++; }
    }
    assert.ok(yard, 'a naval yard was placed');
    assert.ok(ships >= 2, `ships built: ${ships}`);
    for (const u of w.units) if (u.kind === 'naval') assert.ok(w.map.navalPassable(Math.floor(u.x), Math.floor(u.y)), `${u.ut.id} on water`);
    assert.deepEqual(checkInvariants(w), []);
  });

  test('cruisers bombard enemy structures near the coast; the fleet turns on intruders in home waters', () => {
    const s = sandbox({ ai: ['hard', undefined] });
    const { world, map, p0, p1 } = s;
    paint(map, 24, 0, 47, 47, T.Water);
    building(world, 'fact', p0, 16, 4);
    building(world, 'powr', p0, 20, 4);
    building(world, 'syrd', p0, 24, 4);
    const ca = unit(world, 'ca', p0, 45.5, 46.5); // out of its own gun range: the AI must send it
    const dd = unit(world, 'dd', p0, 28.5, 8.5);
    const target = building(world, 'proc', p1, 10, 34);
    const t = runUntil(world, () => ca.order.type === 'attack', seconds(10));
    assert.ok(t > 0 && (ca.order as any).target === target.id, 'cruiser ordered to shell the refinery');
    run(world, seconds(30));
    assert.ok(target.hp < target.maxHp, `refinery shelled (${target.hp})`);
    // an enemy gunboat sails into the harbour
    const raider = unit(world, 'pt', p1, 34.5, 8.5);
    run(world, seconds(4));
    assert.ok(dd.target === raider || (dd.order.type === 'move' && (dd.order as any).attackMove) || !raider.alive, 'destroyer engages the intruder');
  });

  test('does not waste money on a navy on a land map, even with a lake touching every base', () => {
    // (default "Lakes" map whose central lake reaches all three bases)
    const w = skirmish({ seed: 24, size: 64, players: 3, ai: ['hard', 'hard', 'hard'] });
    const lake = Math.max(...seaInfo(w.map).size);
    assert.ok(lake > 150, `there is a sizeable lake (${lake} cells)`);
    run(w, seconds(14 * 60));
    assert.ok(!w.buildings.some((b) => b.bt.water), 'no naval yard');
    assert.ok(!w.units.some((u) => u.kind === 'naval'), 'no ships');
  });
});

describe('naval determinism', () => {
  test('a naval battle replays identically and survives save / load', () => {
    const mk = () => skirmish({ seed: 2, size: 64, players: 2, ai: ['hard', 'hard'], map: { water: 1 }, fog: true });
    const a = mk(), b = mk();
    run(a, seconds(12 * 60));
    run(b, seconds(12 * 60));
    assert.equal(stateHash(a), stateHash(b), 'same seed, same game');
    assert.ok(a.units.some((u) => u.kind === 'naval') || a.buildings.some((x) => x.bt.water), 'navy in play');
    const c = mk();
    deserializeWorld(c, JSON.parse(JSON.stringify(serializeWorld(a))));
    for (let t = 0; t < seconds(90); t++) {
      a.step(); a.events.length = 0;
      c.step(); c.events.length = 0;
    }
    assert.equal(stateHash(c), stateHash(a), 'restored game continues identically');
    const subs = a.units.filter((u) => u.ut.cloakable);
    const subsC = c.units.filter((u) => u.ut.cloakable);
    assert.deepEqual(subsC.map((u) => [u.submerged, u.revealedTo]), subs.map((u) => [u.submerged, u.revealedTo]), 'sub state restored');
  });
});

void World;
