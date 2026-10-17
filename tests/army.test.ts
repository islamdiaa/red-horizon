// [ARMY] Repeat production (sim/repeat.ts): loops for every unit queue, the low-funds pause and resume, the
// primary factory, power, losing the factory, invalid commands, save / load mid-loop and replay sync.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BUILDINGS, UNITS } from '../src/data/rules';
import { CommandFeeder, CommandRecorder, hookStep } from '../src/replay/core';
import { worldHash } from '../src/replay/hash';
import { QUEUE_LIMIT, buildSeconds } from '../src/sim/production';
import { MAX_LOOPS, isLooping, loopFactory, loopable } from '../src/sim/repeat';
import { deserializeWorld, serializeWorld } from '../src/sim/save';
import type { Command } from '../src/sim/types';
import { IdleWatch, RepairRuns, type ArmyCore } from '../src/ui/army';
import {
  T, World, building, paint, powerUp, run, runUntil, sandbox, seconds, skirmish, unit, TICK_HZ, type GameEvent, type Sandbox,
} from './helpers';

/** Allied base with plenty of power: yard, barracks, refinery, war factory, helipad. */
function base(credits = 10000) {
  const s = sandbox({ credits });
  const { world, p0 } = s;
  const fact = building(world, 'fact', p0, 4, 4);
  powerUp(world, p0, 4, 8, 3);
  const tent = building(world, 'tent', p0, 8, 4);
  const proc = building(world, 'proc', p0, 11, 4);
  const weap = building(world, 'weap', p0, 15, 4);
  building(world, 'dome', p0, 4, 12);
  const hpad = building(world, 'hpad', p0, 19, 4);
  return { ...s, fact, tent, proc, weap, hpad };
}

const own = (s: Sandbox, type: string) => s.world.units.filter((u) => u.alive && u.owner === s.p0 && u.ut.id === type);
const loop = (s: Sandbox, building: number, type: string, on = true): Command => ({ c: 'repeat', player: s.p0.id, building, type, on });
const produced = (evs: GameEvent[]) => evs.filter((e): e is Extract<GameEvent, { e: 'produced' }> => e.e === 'produced');

describe('repeat production', () => {
  test('a looped infantry type keeps training, one queued copy at a time, and stops when switched off', () => {
    const s = base();
    const { world, p0, tent } = s;
    world.issue(loop(s, tent.id, 'e1'));
    let maxQueued = 0;
    for (let t = 0; t < seconds(16); t++) { run(world, 1); maxQueued = Math.max(maxQueued, p0.queues.infantry.count('e1')); }
    assert.ok(isLooping(p0, 'e1'), 'loop on');
    const n = own(s, 'e1').length;
    // 1.6 s per rifleman: 16 s -> 9-10 of them
    assert.ok(n >= 9 && n <= 10, `riflemen trained back to back (${n})`);
    assert.equal(maxQueued, 1, 'the loop keeps exactly one copy queued');
    world.issue(loop(s, tent.id, 'e1', false));
    run(world, seconds(6));
    assert.ok(!isLooping(p0, 'e1'), 'loop off');
    assert.ok(own(s, 'e1').length <= n + 1, 'only the copy in progress is finished');
    assert.equal(p0.queues.infantry.items.length, 0, 'queue drained');
  });

  test('the loop waits quietly on low funds and resumes when money comes in', () => {
    const s = base();
    const { world, p0, weap } = s;
    p0.cash = 1500; p0.ore = 0; // no harvesters on the sandbox: no income
    world.issue(loop(s, weap.id, '1tnk'));
    const evs: GameEvent[] = [];
    run(world, seconds(40), evs);
    assert.equal(own(s, '1tnk').length, 2, 'two light tanks for $1500');
    assert.ok(p0.credits >= 0 && p0.credits < UNITS['1tnk'].cost, `money spent down to ${p0.credits}`);
    assert.equal(p0.queues.vehicle.items.length, 0, 'nothing queued (no partial payment) while it cannot pay');
    assert.ok(isLooping(p0, '1tnk'), 'the loop stays on while it waits');
    assert.ok(!evs.some((e) => e.e === 'announce' && e.key === 'insufficient_funds'), 'no "insufficient funds" nagging');
    const before = p0.credits;
    run(world, seconds(20));
    assert.equal(p0.credits, before, 'nothing spent while waiting');
    p0.cash += 1400; // e.g. a harvester unloads
    run(world, seconds(25));
    assert.equal(own(s, '1tnk').length, 4, 'resumed: two more tanks');
  });

  test('vehicles, aircraft and ships loop too, and every unit reports the factory it left', () => {
    const s = base(40000);
    const { world, p0, weap, hpad } = s;
    paint(s.map, 30, 0, 47, 47, T.Water);
    const yard = building(world, 'syrd', p0, 31, 6);
    const evs: GameEvent[] = [];
    world.issue(loop(s, weap.id, '1tnk'));
    world.issue(loop(s, hpad.id, 'heli'));
    world.issue(loop(s, yard.id, 'pt'));
    run(world, seconds(45), evs);
    const tnk = own(s, '1tnk').length, heli = own(s, 'heli').length, pt = own(s, 'pt').length;
    assert.ok(tnk >= 3, `light tanks (${tnk})`);
    assert.ok(heli >= 2, `Longbows (${heli})`);
    assert.ok(pt >= 4, `gunboats (${pt})`);
    const prod = produced(evs);
    assert.equal(prod.length, tnk + heli + pt, 'a produced event per unit');
    for (const e of prod) {
      const u = world.getEntity(e.id)!;
      const from = u.type.id === '1tnk' ? weap : u.type.id === 'heli' ? hpad : yard;
      assert.equal(e.building, from.id, `${u.type.id} came out of its factory`);
      assert.equal(e.player, p0.id, 'owner');
    }
  });

  test('units come out of the primary factory, and loops share their queue in turns', () => {
    const s = base();
    const { world, p0, tent } = s;
    const tent2 = building(world, 'tent', p0, 8, 16);
    world.issue({ c: 'primary', player: p0.id, building: tent2.id });
    world.issue(loop(s, tent.id, 'e1'));
    world.issue(loop(s, tent.id, 'e3'));
    const evs: GameEvent[] = [];
    run(world, seconds(30), evs);
    const prod = produced(evs);
    assert.ok(prod.length >= 6, `trained (${prod.length})`);
    assert.ok(prod.every((e) => e.building === tent2.id), 'every unit from the primary barracks');
    const types = prod.map((e) => world.getEntity(e.id)!.type.id);
    for (let k = 1; k < types.length; k++) assert.notEqual(types[k], types[k - 1], `riflemen and rocket soldiers alternate (${types.join(',')})`);
  });

  test('low power slows a loop down like any production', () => {
    const fast = base();
    fast.world.issue(loop(fast, fast.weap.id, '1tnk'));
    const tFast = runUntil(fast.world, () => own(fast, '1tnk').length > 0, seconds(60));
    const slow = sandbox({ credits: 10000 });
    building(slow.world, 'fact', slow.p0, 4, 4);
    building(slow.world, 'powr', slow.p0, 4, 8);
    const weap = building(slow.world, 'weap', slow.p0, 15, 4);
    building(slow.world, 'tsla', slow.p0, 20, 10);
    building(slow.world, 'tsla', slow.p0, 22, 10);
    assert.ok(slow.p0.lowPower, 'low power');
    assert.ok(buildSeconds(slow.world, slow.p0, '1tnk') > buildSeconds(fast.world, fast.p0, '1tnk'), 'slower build time');
    slow.world.issue({ c: 'repeat', player: slow.p0.id, building: weap.id, type: '1tnk', on: true });
    const tSlow = runUntil(slow.world, () => own(slow, '1tnk').length > 0, seconds(90));
    assert.ok(tFast > 0 && tSlow > tFast, `low power: first tank after ${tSlow} ticks vs ${tFast}`);
  });

  test('a loop ends with its factory (and its queued copy is refunded)', () => {
    const s = base();
    const { world, p0, tent } = s;
    world.issue(loop(s, tent.id, 'e1'));
    run(world, seconds(0.5));
    assert.equal(p0.queues.infantry.count('e1'), 1, 'copy in production');
    const cash = p0.credits;
    world.issue({ c: 'sell', player: p0.id, building: tent.id });
    runUntil(world, () => !tent.alive, seconds(10));
    run(world, 2);
    assert.ok(!isLooping(p0, 'e1'), 'loop dropped with the last barracks');
    assert.equal(p0.queues.infantry.items.length, 0, 'queue emptied');
    assert.ok(p0.credits >= cash, 'the partly paid copy refunded (and the sale paid)');
  });

  test('invalid loop commands are ignored', () => {
    const s = base();
    const { world, p0, p1, tent, weap, fact } = s;
    const foe = building(world, 'barr', p1, 30, 30);
    world.issue(loop(s, foe.id, 'e1')); // someone else's barracks
    world.issue(loop(s, tent.id, '1tnk')); // barracks can't build tanks
    world.issue(loop(s, fact.id, 'powr')); // structures don't loop
    world.issue(loop(s, weap.id, 'nope')); // unknown type
    world.issue(loop(s, weap.id, '3tnk')); // Soviet tank
    world.issue({ c: 'repeat', player: p1.id, building: tent.id, type: 'e1', on: true }); // the enemy names our barracks
    run(world, 2);
    assert.deepEqual(p0.repeat, [], 'no loops');
    assert.deepEqual(p1.repeat, [], 'no enemy loops');
    assert.ok(!loopable('powr') && loopable('e1'), 'only units loop');
    world.issue(loop(s, tent.id, 'e1'));
    world.issue(loop(s, tent.id, 'e1'));
    run(world, 1);
    assert.deepEqual(p0.repeat, ['e1'], 'switching on twice keeps one loop');
    assert.equal(loopFactory(world, p0, 'e1'), tent, 'the UI names the barracks');
    assert.ok(MAX_LOOPS >= 5 && QUEUE_LIMIT === 25, 'limits');
  });

  test('a full queue is not overfilled by loops', () => {
    const s = base(1e6);
    const { world, p0, tent } = s;
    world.issue({ c: 'build', player: p0.id, type: 'e3', count: 30 });
    world.issue(loop(s, tent.id, 'e1'));
    run(world, 2);
    assert.equal(p0.queues.infantry.items.length, QUEUE_LIMIT, `capped at ${QUEUE_LIMIT}`);
    assert.equal(p0.queues.infantry.count('e1'), 0, 'the loop waits for room');
    run(world, seconds(5)); // the first rocket soldier (4.8 s) leaves the queue
    assert.equal(p0.queues.infantry.count('e1'), 1, 'and joins once a slot frees up');
    assert.equal(p0.queues.infantry.items.length, QUEUE_LIMIT, 'still capped');
  });

  test('save / load mid-loop continues identically', () => {
    const make = () => base(6000);
    const a = make();
    a.world.issue(loop(a, a.tent.id, 'e1'));
    a.world.issue(loop(a, a.weap.id, '1tnk'));
    a.world.issue(loop(a, a.hpad.id, 'heli'));
    run(a.world, seconds(7.3));
    assert.ok(a.p0.queues.vehicle.items[0]?.progress > 0.3, 'a tank half built');
    const json = JSON.parse(JSON.stringify(serializeWorld(a.world)));
    const b = make();
    deserializeWorld(b.world, json);
    assert.deepEqual(b.p0.repeat, ['e1', '1tnk', 'heli'], 'loops restored');
    assert.equal(worldHash(b.world), worldHash(a.world), 'same state after loading');
    for (let t = 0; t < seconds(60); t++) { run(a.world, 1); run(b.world, 1); }
    assert.equal(worldHash(b.world), worldHash(a.world), 'identical after a minute of looping');
    assert.ok(own(b, '1tnk').length >= 2 && own(b, 'heli').length >= 1, 'kept building after the load');
    assert.ok(b.p0.credits < 900, `ran low on money (${b.p0.credits}): the low-funds wait is part of the run`);
  });

  test('older saves without loops load with none', () => {
    const a = base();
    const json = JSON.parse(JSON.stringify(serializeWorld(a.world)));
    for (const p of json.players) delete p.repeat;
    // a field missing from the save keeps the constructor default of the fresh world it loads into
    const b = base();
    deserializeWorld(b.world, json);
    assert.deepEqual(b.p0.repeat, [], 'no loops');
    run(b.world, seconds(5));
    assert.equal(b.p0.queues.infantry.items.length, 0, 'nothing trains by itself');
  });
});

/** Scripted human for the replay test: deploy, build power + barracks + refinery + war factory, then loop units. */
function loopingHuman(world: World, issue: (c: Command) => void) {
  const p = world.players[0];
  const order = ['powr', 'tent', 'proc', 'powr', 'weap'];
  let built = 0;
  return () => {
    const t = world.tick;
    if (t === 1) {
      const mcv = world.units.find((u) => u.owner === p && u.ut.deploysInto);
      if (mcv) issue({ c: 'deploy', player: p.id, units: [mcv.id] });
    }
    const q = p.queues.structure;
    if (p.has('fact') && !q.items.length && !q.ready && built < order.length && p.canBuild(order[built])) issue({ c: 'build', player: p.id, type: order[built] });
    if (q.ready) {
      const fact = world.buildings.find((b) => b.owner === p && b.bt.id === 'fact');
      const bt = BUILDINGS[q.ready];
      if (fact) {
        search: for (let r = 2; r < 12; r++) {
          for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const cx = fact.cx + dx * 2, cy = fact.cy + dy * 2;
            if (world.canPlace(p, bt.id, cx, cy)) { issue({ c: 'place', player: p.id, type: bt.id, cx, cy }); built++; break search; }
          }
        }
      }
    }
    const fac = (id: string) => world.buildings.find((b) => b.alive && b.owner === p && b.bt.id === id && b.buildAnim >= 1);
    const tent = fac('tent'), weap = fac('weap');
    if (tent && t % (TICK_HZ * 5) === 0 && !p.repeat.includes('e1')) issue({ c: 'repeat', player: p.id, building: tent.id, type: 'e1', on: true });
    if (weap && t % (TICK_HZ * 5) === 0 && !p.repeat.includes('2tnk')) issue({ c: 'repeat', player: p.id, building: weap.id, type: '2tnk', on: true });
    // the player pauses the infantry loop for a while every minute
    if (tent && t % (TICK_HZ * 60) === TICK_HZ * 30) issue({ c: 'repeat', player: p.id, building: tent.id, type: 'e1', on: false });
  };
}

describe('repeat production in replays', () => {
  const TICKS = seconds(240);
  const make = () => skirmish({ seed: 4711, size: 64, ai: [undefined, 'hard'] });

  function record(ticks: number) {
    const world = make();
    const rec = new CommandRecorder(world);
    hookStep(world, null, () => rec.afterStep());
    const script = loopingHuman(world, (c) => { rec.record(c); world.issue(c); });
    for (let t = 0; t < ticks; t++) { script(); world.step(); world.events.length = 0; }
    return { world, rec };
  }

  test('a match with loops replays in sync, also when the recording spans a save / load', () => {
    const live = record(TICKS);
    const loops = live.rec.cmds.filter(([, c]) => c.c === 'repeat').length;
    assert.ok(loops >= 3, `repeat commands recorded (${loops})`);
    assert.ok(live.world.units.filter((u) => u.owner.id === 0 && u.ut.id === 'e1').length >= 5, 'the loops trained an army');
    const play = (cmds: [number, Command][], hashes: [number, string][]) => {
      const world = make();
      const feeder = new CommandFeeder(world, cmds, hashes);
      hookStep(world, () => feeder.beforeStep(), () => feeder.afterStep());
      while (world.tick < TICKS) { world.step(); world.events.length = 0; }
      return { world, feeder };
    };
    const r = play(live.rec.cmds, live.rec.hashes);
    assert.equal(r.feeder.desyncTick, -1, `no desync (at ${r.feeder.desyncTick})`);
    assert.equal(worldHash(r.world), worldHash(live.world), 'identical final state');
    assert.deepEqual(r.world.players[0].repeat, live.world.players[0].repeat, 'same loops at the end');

    // save half way through, load into a new world and finish the match there
    const half = seconds(120);
    const a = make();
    const recA = new CommandRecorder(a);
    hookStep(a, null, () => recA.afterStep());
    const sa = loopingHuman(a, (c) => { recA.record(c); a.issue(c); });
    for (let t = 0; t < half; t++) { sa(); a.step(); a.events.length = 0; }
    const save = JSON.parse(JSON.stringify({ world: serializeWorld(a), replay: { cmds: recA.cmds, hashes: recA.hashes } }));
    const b = make();
    deserializeWorld(b, save.world, null);
    const recB = new CommandRecorder(b, save.replay);
    hookStep(b, null, () => recB.afterStep());
    const sb = loopingHuman(b, (c) => { recB.record(c); b.issue(c); });
    for (let t = half; t < TICKS; t++) { sb(); b.step(); b.events.length = 0; }
    const r2 = play(recB.cmds, recB.hashes);
    assert.equal(r2.feeder.desyncTick, -1, `resumed recording replays in sync (desync at ${r2.feeder.desyncTick})`);
    assert.equal(worldHash(r2.world), worldHash(b), 'same final state as the resumed match');
  });
});

/** The DOM-free army helpers driven like the HUD drives them (a few times a second). */
function core(s: Sandbox, msgs: string[]): ArmyCore {
  return { world: s.world, local: s.p0, issue: (c) => s.world.issue(c), message: (t) => { msgs.push(t); } };
}

describe('idle watch', () => {
  test('a factory idle for 20 s with money pulses; toasts are throttled; a loop or the hints setting silences it', () => {
    const s = base();
    building(s.world, 'powr', s.p1, 40, 40); // (an opponent still standing: the match isn't over)
    const msgs: string[] = [];
    const iw = new IdleWatch(core(s, msgs));
    const tick = (secs: number) => { for (let t = 0; t < seconds(secs); t += 10) { run(s.world, 10); iw.update(); } };
    tick(15);
    assert.ok(!iw.nagging('infantry'), 'not after 15 s');
    tick(7);
    assert.ok(iw.nagging('infantry') && iw.nagging('vehicle') && iw.nagging('aircraft'), 'barracks, war factory and helipad idle after 20 s');
    assert.ok(!iw.nagging('naval'), 'no shipyard: nothing to nag about');
    assert.ok(iw.idleFor('vehicle') >= 20, `idle for ${iw.idleFor('vehicle')} s`);
    // (the refinery without a harvester is reported too: all these share one toast every 30 s)
    assert.equal(msgs.length, 1, `one toast, not four (${msgs.join(' | ')})`);
    tick(60);
    assert.ok(msgs.some((m) => / idle · \$/.test(m)), `an idle factory reported (${msgs.join(' | ')})`);
    assert.ok(msgs.length <= 3, `at most one toast per 30 s (${msgs.length})`);
    // a loop keeps the barracks busy (and a loop saving up for its next unit is not idle either)
    s.world.issue({ c: 'repeat', player: s.p0.id, building: s.tent.id, type: 'e1', on: true });
    tick(1);
    assert.ok(!iw.nagging('infantry'), 'looping barracks is busy');
    s.p0.cash = 50; s.p0.ore = 0;
    tick(30);
    assert.ok(!iw.nagging('infantry'), 'saving up for the loop is not idle');
    assert.ok(!iw.nagging('vehicle'), 'no money: no nagging about the war factory');
    s.p0.cash = 5000;
    tick(25);
    assert.ok(iw.nagging('vehicle'), 'money again: the idle war factory pulses');
    iw.enabled = false; // "Field manual hints" off
    const before = msgs.length;
    tick(60);
    assert.ok(!iw.nagging('vehicle') && msgs.length === before, 'silent with hints off');
  });

  test('a refinery without a harvester is reported once in a while', () => {
    const s = base();
    building(s.world, 'powr', s.p1, 40, 40);
    for (const u of [...s.world.units]) if (u.ut.harvester) { u.alive = false; s.world.entities.delete(u.id); }
    s.world.units = s.world.units.filter((u) => u.alive);
    const msgs: string[] = [];
    const iw = new IdleWatch(core(s, msgs));
    for (let t = 0; t < seconds(200); t += 10) { run(s.world, 10); iw.update(); }
    const n = msgs.filter((m) => /refinery has no harvester/.test(m)).length;
    assert.ok(n >= 1 && n <= 2, `reported ${n} times in 200 s`);
  });
});

describe('repair runs', () => {
  test('damaged vehicles take turns on the service depot pad, most damaged first, and drive back', () => {
    const s = base(20000);
    const { world, p0 } = s;
    const fix = building(world, 'fix', p0, 22, 12);
    const homes: [number, number][] = [[33.5, 30.5], [35.5, 30.5], [37.5, 30.5]];
    const tanks = homes.map(([x, y], k) => { const u = unit(world, '2tnk', p0, x, y); u.hp = u.maxHp * [0.8, 0.4, 0.6][k]; return u; });
    const apc = unit(world, 'apc', p0, 39.5, 30.5); // undamaged: not sent
    const msgs: string[] = [];
    const runs = new RepairRuns(core(s, msgs));
    assert.equal(runs.send([...tanks, apc].map((u) => u.id)), 3, 'three damaged tanks sent');
    let maxOnPad = 0;
    const firstOnPad: number[] = [];
    for (let t = 0; t < seconds(300) && runs.active; t++) {
      run(world, 1);
      if (t % 6 === 0) runs.update();
      const on = tanks.filter((u) => Math.hypot(u.x - fix.x, u.y - fix.y) < 0.8 && !u.moving);
      maxOnPad = Math.max(maxOnPad, on.length);
      for (const u of on) if (!firstOnPad.includes(u.id)) firstOnPad.push(u.id);
    }
    assert.equal(runs.active, 0, 'the run finished');
    for (const u of tanks) assert.equal(u.hp, u.maxHp, `tank #${u.id} repaired`);
    assert.equal(maxOnPad, 1, 'one vehicle on the pad at a time');
    assert.deepEqual(firstOnPad, [tanks[1].id, tanks[2].id, tanks[0].id], 'most damaged first');
    run(world, seconds(40));
    tanks.forEach((u, k) => assert.ok(Math.hypot(u.x - homes[k][0], u.y - homes[k][1]) < 2.5, `tank #${u.id} drove back (${u.x.toFixed(1)}, ${u.y.toFixed(1)})`));
    assert.ok(msgs.some((m) => /Repairs complete: 3 vehicles/.test(m)), `completion reported (${msgs.join(' | ')})`);
  });

  test('a unit the player orders elsewhere leaves the queue; no depot, no run', () => {
    const s = base(20000);
    const { world, p0 } = s;
    const msgs: string[] = [];
    const runs = new RepairRuns(core(s, msgs));
    const a = unit(world, '2tnk', p0, 33.5, 30.5), b = unit(world, '2tnk', p0, 35.5, 30.5);
    a.hp = b.hp = a.maxHp / 2;
    assert.equal(runs.send([a.id, b.id]), 0, 'no service depot');
    assert.ok(msgs.some((m) => /Build a Service Depot/.test(m)), 'told to build one');
    building(world, 'fix', p0, 22, 12);
    assert.equal(runs.send([a.id, b.id]), 2, 'sent once there is a depot');
    run(world, 2); runs.update();
    const waiting = runs.has(a.id) && runs.has(b.id);
    assert.ok(waiting, 'both in the run');
    // the player sends the second one elsewhere
    const queued = [a, b].find((u) => u.order.type === 'move')!;
    world.issue({ c: 'move', player: p0.id, units: [queued.id], x: 5.5, y: 40.5 });
    run(world, 2); runs.update();
    assert.ok(!runs.has(queued.id), 'overridden unit left the run');
  });
});
