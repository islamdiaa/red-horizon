// Production queues: progressive payment, build times, cancel/refund, stalls, tech tree.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BUILD_SECONDS_PER_1000, UNITS, BUILDINGS } from '../src/data/rules';
import { buildSeconds } from '../src/sim/production';
import { DT } from '../src/sim/types';
import { sandbox, building, run, runUntil, seconds, powerUp, type GameEvent } from './helpers';

/** Allied base with plenty of power: fact, tent, proc, weap. */
function base(credits = 10000) {
  const s = sandbox({ credits });
  const { world, p0 } = s;
  const fact = building(world, 'fact', p0, 4, 4);
  powerUp(world, p0, 4, 8, 2);
  const tent = building(world, 'tent', p0, 8, 4);
  const proc = building(world, 'proc', p0, 11, 4);
  const weap = building(world, 'weap', p0, 15, 4);
  return { ...s, fact, tent, proc, weap, credits0: p0.credits };
}

const unitsOf = (s: ReturnType<typeof base>, type: string) => s.world.units.filter((u) => u.alive && u.owner === s.p0 && u.ut.id === type);

describe('production', () => {
  test('build time is cost / 1000 * 16 s per factory, at least 1.2 s', () => {
    const s = base();
    assert.equal(BUILD_SECONDS_PER_1000, 16);
    assert.equal(buildSeconds(s.world, s.p0, '2tnk'), (UNITS['2tnk'].cost / 1000) * 16);
    assert.equal(buildSeconds(s.world, s.p0, 'e1'), 1.6);
    assert.equal(buildSeconds(s.world, s.p0, 'sbag'), 1.2, 'minimum');
    // a second war factory speeds vehicles up by 1.5x (up to 4 factories)
    building(s.world, 'weap', s.p0, 19, 4);
    assert.ok(Math.abs(buildSeconds(s.world, s.p0, '2tnk') - 12.8 / 1.5) < 1e-9, "Math.abs(buildSeconds(s.world, s.p0, '2tnk') - 12.8 / 1.5) < 1e-9");
    assert.equal(buildSeconds(s.world, s.p0, 'e1'), 1.6, 'infantry unaffected');
  });

  test('cost is deducted progressively while building and the unit appears on time', () => {
    const s = base();
    const { world, p0 } = s;
    world.issue({ c: 'build', player: p0.id, type: '2tnk' });
    run(world, 1);
    const perTick = (UNITS['2tnk'].cost * DT) / 12.8;
    assert.ok(Math.abs(s.credits0 - p0.credits - perTick) <= 1, `first tick charged ~${perTick.toFixed(2)}`);
    run(world, seconds(6.4) - 1);
    const it = p0.queues.vehicle.items[0];
    assert.ok(Math.abs(it.progress - 0.5) < 1e-6, `half done after half the time (${it.progress})`);
    assert.ok(Math.abs(it.paid - 400) < 1e-6, `half paid (${it.paid})`);
    assert.ok(Math.abs(p0.cash - (s.credits0 - 400)) < 1e-6, "Math.abs(p0.cash - (s.credits0 - 400)) < 1e-6");
    assert.equal(unitsOf(s, '2tnk').length, 0);
    const t = runUntil(world, () => unitsOf(s, '2tnk').length > 0, seconds(10));
    assert.ok(Math.abs(t - seconds(6.4)) <= 1, `finished at 12.8 s (+${t} ticks)`);
    assert.ok(Math.abs(p0.cash - (s.credits0 - 800)) < 1e-6, 'exactly the unit cost in total');
    assert.equal(p0.stats.unitsBuilt, 1);
  });

  test('queued infantry are trained one after another', () => {
    const s = base();
    s.world.issue({ c: 'build', player: s.p0.id, type: 'e1', count: 5 });
    run(s.world, 1);
    assert.equal(s.p0.queues.infantry.items.length, 5);
    const t = runUntil(s.world, () => unitsOf(s, 'e1').length === 5, seconds(20));
    assert.ok(Math.abs(t - 5 * seconds(1.6)) <= 5, `5 x 1.6 s, took ${t} ticks`);
    assert.ok(Math.abs(s.p0.cash - (s.credits0 - 500)) < 1e-6, "Math.abs(s.p0.cash - (s.credits0 - 500)) < 1e-6");
    // they leave the barracks through the exit and walk to a free spot below it
    for (const u of unitsOf(s, 'e1')) assert.ok(u.y > s.tent.cy + s.tent.h - 0.01, 'outside the barracks');
  });

  test('cancelling refunds exactly what was paid so far', () => {
    const s = base();
    s.world.issue({ c: 'build', player: s.p0.id, type: '2tnk' });
    run(s.world, 77);
    assert.ok(s.p0.cash < s.credits0 - 100, "s.p0.cash < s.credits0 - 100");
    s.world.issue({ c: 'cancel', player: s.p0.id, type: '2tnk' });
    run(s.world, 1);
    assert.equal(s.p0.queues.vehicle.items.length, 0);
    assert.ok(Math.abs(s.p0.cash - s.credits0) < 1e-6, `refunded to ${s.p0.cash}`);
  });

  test('a finished structure waits for placement; cancelling it refunds the full price', () => {
    const s = base();
    const events: GameEvent[] = [];
    s.world.issue({ c: 'build', player: s.p0.id, type: 'powr' });
    const t = runUntil(s.world, () => s.p0.queues.structure.ready === 'powr', seconds(10), events);
    assert.ok(Math.abs(t - seconds((300 / 1000) * 16)) <= 1, "Math.abs(t - seconds((300 / 1000) * 16)) <= 1");
    assert.ok(events.some((e) => e.e === 'announce' && e.key === 'construction_complete'), "events.some((e) => e.e === 'announce' && e.key === 'construction_complete')");
    // queue is blocked while ready
    s.world.issue({ c: 'build', player: s.p0.id, type: 'tent' });
    run(s.world, 5);
    assert.equal(s.p0.queues.structure.items.length, 0);
    s.world.issue({ c: 'cancel', player: s.p0.id, type: 'powr' });
    run(s.world, 1);
    assert.equal(s.p0.queues.structure.ready, null);
    assert.ok(Math.abs(s.p0.cash - s.credits0) < 1e-6, "Math.abs(s.p0.cash - s.credits0) < 1e-6");
  });

  test('placing a ready structure builds it and frees the queue', () => {
    const s = base();
    s.world.issue({ c: 'build', player: s.p0.id, type: 'powr' });
    runUntil(s.world, () => s.p0.queues.structure.ready === 'powr', seconds(10));
    const before = s.world.buildings.length;
    s.world.issue({ c: 'place', player: s.p0.id, type: 'powr', cx: 4, cy: 11 });
    run(s.world, 1);
    assert.equal(s.world.buildings.length, before + 1);
    assert.equal(s.p0.queues.structure.ready, null);
    const b = s.world.buildings[s.world.buildings.length - 1];
    assert.equal(b.bt.id, 'powr');
    assert.ok(b.buildAnim < 1, 'plays the construction animation');
    run(s.world, seconds(1.2));
    assert.equal(b.buildAnim, 1);
  });

  test('running out of money stalls production without going negative, then resumes', () => {
    const s = base(100);
    s.p0.cash = 100;
    s.world.issue({ c: 'build', player: s.p0.id, type: '2tnk' });
    run(s.world, seconds(8));
    const q = s.p0.queues.vehicle;
    assert.ok(q.stalled, 'stalled');
    assert.ok(s.p0.cash >= 0 && s.p0.cash < 2, `cash ${s.p0.cash}`);
    assert.ok(Math.abs(q.items[0].paid + s.p0.cash - 100) < 1e-6, 'paid what it had');
    s.p0.cash += 1000;
    const t = runUntil(s.world, () => unitsOf(s, '2tnk').length === 1, seconds(20));
    assert.ok(t > 0, 'resumed and finished');
    assert.ok(Math.abs(s.p0.cash - 300) < 1e-6, 'total cost 800');
  });

  test('pause holds progress and payment', () => {
    const s = base();
    s.world.issue({ c: 'build', player: s.p0.id, type: '2tnk' });
    run(s.world, 20);
    s.world.issue({ c: 'pause', player: s.p0.id, type: '2tnk' });
    run(s.world, 1);
    const it = s.p0.queues.vehicle.items[0];
    const p = it.progress, cash = s.p0.cash;
    run(s.world, 100);
    assert.equal(it.progress, p);
    assert.equal(s.p0.cash, cash);
    // building the same type again resumes it
    s.world.issue({ c: 'build', player: s.p0.id, type: '2tnk' });
    run(s.world, 2);
    assert.ok(it.progress > p, "it.progress > p");
  });

  test('losing the factory cancels the queue with a refund', () => {
    const s = base();
    s.world.issue({ c: 'build', player: s.p0.id, type: 'e3', count: 3 });
    run(s.world, 30);
    s.world.kill(s.tent, 'normal');
    run(s.world, 2);
    assert.equal(s.p0.queues.infantry.items.length, 0);
    // survivors may have spawned (free e1s) but no money is lost
    assert.ok(Math.abs(s.p0.cash - s.credits0) < 1e-6, `cash ${s.p0.cash} vs ${s.credits0}`);
  });

  test('tech tree: prerequisites and faction rosters gate the build list', () => {
    const s = sandbox({ credits: 10000 });
    const { world, p0, p1 } = s;
    assert.equal(p0.canBuild('powr'), false, 'nothing without a construction yard');
    building(world, 'fact', p0, 4, 4);
    assert.ok(p0.canBuild('powr'), "p0.canBuild('powr')");
    assert.equal(p0.canBuild('proc'), false, 'refinery needs power plant');
    assert.equal(p0.canBuild('tsla'), false, 'Soviet only');
    building(world, 'powr', p0, 8, 4);
    assert.ok(p0.canBuild('proc') && p0.canBuild('tent'), "p0.canBuild('proc') && p0.canBuild('tent')");
    assert.equal(p0.canBuild('barr'), false, 'Allies use tent');
    assert.equal(p0.canBuild('e1'), false, 'no barracks yet');
    building(world, 'tent', p0, 11, 4);
    assert.ok(p0.canBuild('e1') && p0.canBuild('e3') && p0.canBuild('medi'), "p0.canBuild('e1') && p0.canBuild('e3') && p0.canBuild('medi')");
    assert.equal(p0.canBuild('e7'), false, 'Tanya needs the tech centre');
    assert.equal(p0.canBuild('dog'), false, 'no dogs for the Allies');
    // build commands for unavailable types are ignored
    world.issue({ c: 'build', player: p0.id, type: 'e7' });
    run(world, 1);
    assert.equal(p0.queues.infantry.items.length, 0);
    // soviet kennel only trains dogs, barracks never train dogs
    building(world, 'fact', p1, 30, 30);
    building(world, 'powr', p1, 34, 30);
    building(world, 'barr', p1, 36, 30);
    assert.equal(p1.canBuild('dog'), false);
    building(world, 'kenn', p1, 39, 30);
    assert.ok(p1.canBuild('dog'), "p1.canBuild('dog')");
    // every buildable type's prerequisites refer to real structures
    for (const t of [...Object.values(UNITS), ...Object.values(BUILDINGS)]) {
      for (const req of t.prereq) for (const alt of req.split('|')) assert.ok(BUILDINGS[alt], `${t.id} requires unknown ${alt}`);
    }
  });

  test('aircraft are delivered landed on their pad', () => {
    const s = base();
    building(s.world, 'dome', s.p0, 19, 8);
    const pad = building(s.world, 'hpad', s.p0, 22, 4);
    s.world.issue({ c: 'build', player: s.p0.id, type: 'heli' });
    const t = runUntil(s.world, () => unitsOf(s, 'heli').length === 1, seconds(30));
    assert.ok(t > 0, "t > 0");
    const heli = unitsOf(s, 'heli')[0];
    assert.equal(heli.altitude, 0);
    assert.equal(heli.homePad, pad.id);
    assert.ok(Math.hypot(heli.x - pad.x, heli.y - pad.y) < 0.01, "Math.hypot(heli.x - pad.x, heli.y - pad.y) < 0.01");
  });
});
