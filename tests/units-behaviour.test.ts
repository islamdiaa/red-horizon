// Unit behaviour a player relies on (from an audit; tools/qa/behave.ts and tools/qa/waves.ts have the scenarios with
// numbers): return fire while busy with a structure, moves that keep trying through a jam, formations that a straggler
// can't hold back for a whole trip, and the Service Depot queue.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sandbox, building, unit, run, runUntil, seconds, paint, T, type Unit } from './helpers';

const ids = (us: Unit[]) => us.map((u) => u.id);

describe('return fire', () => {
  test('units attacking a structure turn on a tank shooting them, then carry on with the structure', () => {
    const { world, p0, p1 } = sandbox({ w: 48, h: 48, fog: true });
    const target = building(world, 'powr', p1, 24, 20);
    const mine = ['2tnk', '2tnk', 'e3', 'e3'].map((t, k) => unit(world, t, p0, 18 + k * 0.9, 21));
    world.issue({ c: 'attack', player: p0.id, units: ids(mine), target: target.id });
    const tank = unit(world, '3tnk', p1, 22.5, 24.5);
    const shot = runUntil(world, () => mine.some((u) => u.lastFireTick === world.tick && u.target === tank), seconds(30));
    assert.ok(shot >= 0 && shot < seconds(6), `they answer within seconds (first shot at the tank after ${(shot / 20).toFixed(1)} s; it used to take ~14 s)`);
    const t = runUntil(world, () => !tank.alive, seconds(40));
    assert.ok(t >= 0 && t < seconds(25), `the shooter is dealt with (killed after ${(t / 20).toFixed(1)} s)`);
    run(world, seconds(1));
    const back = mine.filter((u) => u.alive && u.order.type === 'attack' && u.order.target === target.id).length;
    assert.ok(!target.alive || back >= mine.filter((u) => u.alive).length - 1, `survivors go back to the structure (${back} of ${mine.filter((u) => u.alive).length}: ${mine.map((u) => u.order.type).join(' ')}; structure hp ${Math.round(target.hp)})`);
  });

  test('a forced attack and a unit out of reach of the shooter keep their target', () => {
    const { world, p0, p1 } = sandbox({ w: 48, h: 48, fog: false });
    const target = building(world, 'powr', p1, 24, 20);
    const e1 = unit(world, 'e1', p0, 21.5, 21);
    world.issue({ c: 'attack', player: p0.id, units: [e1.id], target: target.id });
    const arty = unit(world, 'arty', p1, 21.5, 29.5); // out-ranges a rifleman
    arty.stance = 'hold';
    world.setOrder(arty, { type: 'attack', target: e1.id, forced: false });
    run(world, seconds(6));
    assert.ok(!e1.alive || (e1.order.type === 'attack' && e1.order.target === target.id), 'the rifleman can not reach the gun from where it stands: it keeps shooting the structure');
  });
});

describe('moves through a jam', () => {
  test('a unit whose path is dropped by the stuck check keeps going (it used to stop where it stood)', () => {
    const { world, p0 } = sandbox({ w: 64, h: 40 });
    const u = unit(world, '2tnk', p0, 8.5, 20.5);
    world.issue({ c: 'move', player: p0.id, units: [u.id], x: 50.5, y: 20.5 });
    run(world, seconds(5));
    u.path = null; u.hasGoal = false; // (what the stuck check in followPath does after a few seconds without progress)
    run(world, seconds(2));
    assert.equal(u.order.type, 'move', 'still on its way');
    const t = runUntil(world, () => u.order.type === 'idle', seconds(60));
    assert.ok(t >= 0 && Math.hypot(u.x - 50.5, u.y - 20.5) < 0.5, `arrived (${u.x.toFixed(1)}, ${u.y.toFixed(1)})`);
  });

  test('a crowd squeezes through a one-cell gap', () => {
    const { world, p0 } = sandbox({ w: 64, h: 40 });
    paint(world.map, 30, 0, 31, 39, T.Rock);
    paint(world.map, 30, 19, 31, 19, T.Clear); // a one-cell gap
    const us = Array.from({ length: 24 }, (_, k) => unit(world, k % 3 ? 'e1' : '2tnk', p0, 10 + (k % 6), 16 + Math.floor(k / 6)));
    for (const u of us) world.setOrder(u, { type: 'move', x: 50.5, y: 19.5, attackMove: false });
    run(world, seconds(150));
    const there = us.filter((u) => Math.hypot(u.x - 50.5, u.y - 19.5) < 7).length;
    assert.equal(there, us.length, `every unit got through the gap (${there}/${us.length})`);
  });

  test('a unit sent somewhere it can never reach still stops after a few searches', () => {
    const { world, p0 } = sandbox({ w: 48, h: 48 });
    paint(world.map, 30, 0, 47, 47, T.Water);
    const u = unit(world, '2tnk', p0, 10.5, 20.5);
    world.issue({ c: 'move', player: p0.id, units: [u.id], x: 40.5, y: 20.5 });
    const t = runUntil(world, () => u.order.type === 'idle', seconds(30));
    assert.ok(t >= 0, 'the order ends');
    assert.ok(Math.abs(u.x - 29.5) < 1.5, `it waits on the shore (x ${u.x.toFixed(1)})`);
  });
});

describe('formations', () => {
  test('a member that can not keep up holds the group back for seconds, not for the whole trip', () => {
    const { world, p0 } = sandbox({ w: 90, h: 40 });
    const us = ['e1', 'e1', 'e1', 'e1', 'e1', 'e1', '2tnk', '2tnk'].map((t, k) => unit(world, t, p0, 8 + (k % 4) * 0.9, 18 + Math.floor(k / 4) * 0.9));
    world.issue({ c: 'move', player: p0.id, units: ids(us), x: 80.5, y: 18.5 });
    run(world, seconds(4));
    assert.equal(world.ctrl.groups.length, 1, 'marching in formation');
    const lag = us[7], px = lag.x, py = lag.y;
    const front = () => us.slice(0, 6).reduce((s, u) => s + u.x, 0) / 6;
    const x0 = front();
    for (let t = 0; t < seconds(20); t++) { lag.x = lag.prevX = px; lag.y = lag.prevY = py; run(world, 1); } // (a tank stuck behind something)
    // the riflemen march at 0.73 cells/s in formation: 14.6 cells in 20 s; held at 35 % they made 6.7
    assert.ok(front() - x0 > 10, `the rest of the group got on (${(front() - x0).toFixed(1)} cells in 20 s)`);
  });
});

describe('service depot', () => {
  test('damaged tanks queue for the pad and all leave fully repaired', () => {
    const { world, p0 } = sandbox({ w: 64, h: 64, credits: 10000 });
    building(world, 'powr', p0, 4, 4);
    const fix = building(world, 'fix', p0, 20, 20);
    const tanks = Array.from({ length: 6 }, (_, k) => { const u = unit(world, '2tnk', p0, 30 + (k % 3) * 1.2, 30 + Math.floor(k / 3) * 1.2); u.hp = u.maxHp * 0.3; return u; });
    world.issue({ c: 'enter', player: p0.id, units: ids(tanks), target: fix.id });
    const t = runUntil(world, () => tanks.every((u) => u.hp >= u.maxHp), seconds(200));
    assert.ok(t >= 0, `all six repaired (${tanks.map((u) => Math.round(100 * u.hp / u.maxHp) + '%').join(' ')})`);
    run(world, seconds(10));
    const pad = fix.bt.passable![0];
    const onPad = tanks.filter((u) => Math.hypot(u.x - (fix.cx + pad[0] + 0.5), u.y - (fix.cy + pad[1] + 0.5)) < 0.6).length;
    assert.equal(onPad, 0, 'nobody is left parked on the pad');
  });

  test('a tank that is already whole does not take the pad', () => {
    const { world, p0 } = sandbox({ w: 48, h: 48, credits: 10000 });
    building(world, 'powr', p0, 4, 4);
    const fix = building(world, 'fix', p0, 20, 20);
    const u = unit(world, '2tnk', p0, 30.5, 30.5);
    world.issue({ c: 'enter', player: p0.id, units: [u.id], target: fix.id });
    run(world, 2);
    assert.equal(u.order.type, 'idle', 'nothing to repair: the order ends at once');
    assert.equal(fix.dockOccupant, 0, 'the pad stays free');
  });
});
