/**
 * PLAY (round 3): the Field Manual's new coaching alerts (src/ui/coach.ts: losses that teach, no Ore Truck left, a
 * damaged structure) and which replays are kept when a battle is left early (src/replay/recorder.ts).
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CoachWatch, DEFENCE_LOSSES, MOVE_LOSSES, PIECEMEAL_LOSSES, defenceNear, economyAdvice, infantryKiller, movingLosses, piecemeal, type EconomyFacts, type Loss,
} from '../src/ui/coach';
import { MIN_BRANCH_TICKS, MIN_TICKS, keepsRecording } from '../src/replay/recorder';
import { attackCommands, attackMoveCommands } from '../src/ui/attack-orders';
import { building, powerUp, run, sandbox, seconds, unit } from './helpers';

const loss = (o: Partial<Loss>): Loss => ({ t: 100, infantry: true, defence: null, moving: false, away: true, ...o });

describe('coaching from losses', () => {
  test('infantryKiller: five soldiers lost next to the same kind of defence within the window', () => {
    const four = Array.from({ length: DEFENCE_LOSSES - 1 }, () => loss({ defence: 'ftur' }));
    assert.equal(infantryKiller(four, 120), null, 'four is not yet a pattern');
    const five = [...four, loss({ defence: 'pbox' })];
    assert.equal(infantryKiller(five, 120), 'ftur', 'the defence that killed most');
    assert.equal(infantryKiller(five, 100 + 151), null, 'old losses no longer count');
    assert.equal(infantryKiller(five.map((l) => ({ ...l, infantry: false })), 120), null, 'tanks lost to defences are another story');
  });

  test('movingLosses and piecemeal', () => {
    const moving = Array.from({ length: MOVE_LOSSES }, () => loss({ moving: true }));
    assert.equal(movingLosses(moving, 150), MOVE_LOSSES, 'units lost on a plain move order away from home');
    assert.equal(movingLosses(moving.map((l) => ({ ...l, away: false })), 150), 0, 'not at home (a raid on the base)');
    const many = Array.from({ length: PIECEMEAL_LOSSES }, () => loss({}));
    assert.equal(piecemeal(many, 150, 2), true, 'ten lost for two kills');
    assert.equal(piecemeal(many, 150, 6), false, 'a fair trade');
    assert.equal(piecemeal(many.slice(1), 150, 0), false, 'not enough losses yet');
  });

  test('CoachWatch records infantry killed by a Flame Tower, and units killed on a plain move order', () => {
    const { world: w, p0, p1 } = sandbox({ w: 64, h: 64, credits: 5000 });
    building(w, 'fact', p0, 6, 54);
    building(w, 'fact', p1, 50, 8);
    powerUp(w, p1, 54, 14);
    const tower = building(w, 'ftur', p1, 40, 30);
    assert.equal(defenceNear(w, p0, 41, 31), 'ftur', 'the flame tower is next to that point');
    const c = new CoachWatch();
    const soldiers = Array.from({ length: 6 }, (_, i) => unit(w, 'e1', p0, 38 + (i % 3) * 0.6, 32 + Math.floor(i / 3) * 0.6));
    w.issue({ c: 'move', player: p0.id, units: soldiers.map((s) => s.id), x: 50, y: 10 });
    for (let i = 0; i < 60 && soldiers.some((s) => s.alive); i++) { run(w, seconds(0.5)); c.update(w, p0); }
    assert.ok(tower.alive, 'the tower survives six riflemen walking past');
    const dead = soldiers.filter((s) => !s.alive).length;
    assert.ok(dead >= DEFENCE_LOSSES, `the tower killed ${dead} riflemen`);
    assert.equal(infantryKiller(c.losses, w.time), 'ftur', `losses: ${JSON.stringify(c.losses.slice(0, 3))}`);
    assert.ok(movingLosses(c.losses, w.time) >= MOVE_LOSSES, 'they died on a plain move order');
    const l = c.lessons();
    assert.ok(l.armedLost >= DEFENCE_LOSSES && l.infantryToDefences === l.armedLost && l.defence === 'ftur' && l.movingLost === l.armedLost, `the match's lessons: ${JSON.stringify(l)} (${dead} dead)`);
  });

  test('the results advice: tanks against defences, attack-move, only after the economy and early-defence advice', () => {
    const f: EconomyFacts = { won: false, time: 1500, faction: 'allies', you: { harvested: 20000, peakArmy: 9000, peakDefences: 3 }, foe: { harvested: 21000, peakArmy: 9500 } };
    assert.equal(economyAdvice(f)?.tip, 'close', 'without lessons: as before');
    assert.equal(economyAdvice(f, { armedLost: 30, movingLost: 2, infantryToDefences: 12, defence: 'ftur' })?.tip, 'tanks', 'soldiers thrown at defences');
    assert.equal(economyAdvice(f, { armedLost: 60, movingLost: 2, infantryToDefences: 12, defence: 'ftur' })?.tip, 'close', 'defences were a small part of the losses');
    assert.equal(economyAdvice(f, { armedLost: 30, movingLost: 9, infantryToDefences: 2, defence: null })?.tip, 'attackMove', 'units walked past the enemy');
    assert.equal(economyAdvice({ ...f, foe: { ...f.foe, harvested: 40000 } }, { armedLost: 30, movingLost: 9, infantryToDefences: 12, defence: 'ftur' })?.tip, 'income', 'the economy first');
  });

  test('CoachWatch: no Ore Truck left, and a damaged structure out of the fight', () => {
    const { world: w, p0, p1 } = sandbox({ w: 64, h: 64, credits: 5000 });
    building(w, 'fact', p0, 6, 54);
    powerUp(w, p0, 2, 46);
    building(w, 'fact', p1, 50, 8);
    building(w, 'proc', p0, 12, 50);
    const truck = unit(w, 'harv', p0, 16, 48); // (the refinery's free Ore Truck: placing it by hand doesn't add one)
    const c = new CoachWatch();
    for (let i = 0; i < 10; i++) { run(w, seconds(1)); c.update(w, p0); }
    assert.equal(c.noTruckFor(w), 0, 'the refinery has its truck');
    w.kill(truck);
    for (let i = 0; i < 20; i++) { run(w, seconds(1)); c.update(w, p0); }
    assert.ok(c.noTruckFor(w) >= 15, `no truck for ${c.noTruckFor(w)} s`);
    const powr = w.buildings.find((b) => b.owner === p0 && b.bt.id === 'apwr')!;
    powr.hp = powr.maxHp * 0.3;
    for (let i = 0; i < 30; i++) { run(w, seconds(1)); c.update(w, p0); }
    assert.ok(c.damagedFor(w) >= 25, `a damaged structure for ${c.damagedFor(w)} s`);
    powr.hp = powr.maxHp;
    run(w, seconds(1)); c.update(w, p0);
    assert.equal(c.damagedFor(w), 0, 'repaired: the alert condition clears');
  });
});

describe('attack orders from the mouse (src/ui/attack-orders.ts)', () => {
  test('an attack-move click on an enemy structure is an attack-move there for the whole selection', () => {
    const { world: w, p0, p1 } = sandbox({ w: 64, h: 64 });
    building(w, 'fact', p1, 50, 8);
    const plant = building(w, 'powr', p1, 44, 30);
    const dog = unit(w, 'dog', p0, 10, 30), tank = unit(w, '2tnk', p0, 11, 31), medic = unit(w, 'medi', p0, 10, 32);
    const am = attackMoveCommands(p0.id, [dog, tank, medic], plant, 3, 3);
    assert.deepEqual(am.cmds, [{ c: 'move', player: p0.id, units: [dog.id, tank.id, medic.id], x: plant.x, y: plant.y, attackMove: true, queue: false }], 'one attack-move to the structure, nobody left out');
    assert.deepEqual([am.x, am.y], [plant.x, plant.y], 'the marker goes on the structure');
    const ground = attackMoveCommands(p0.id, [tank], null, 20, 21, true);
    assert.deepEqual(ground.cmds[0], { c: 'move', player: p0.id, units: [tank.id], x: 20, y: 21, attackMove: true, queue: true }, 'on the ground: that point (Shift queues)');
    // right-click: the dog and the medic can't hurt a structure, so they attack-move there instead of getting no order
    const rc = attackCommands(p0.id, [dog, tank, medic], plant);
    assert.deepEqual(rc.map((c) => [c.c, (c as { units: number[] }).units]), [['attack', [tank.id]], ['move', [dog.id, medic.id]]], JSON.stringify(rc));
  });

  test('tanks attack-moving at a structure behind a Flame Tower fight the tower on the way', () => {
    const { world: w, p0, p1 } = sandbox({ w: 64, h: 64, credits: 5000 });
    building(w, 'fact', p0, 4, 56);
    building(w, 'fact', p1, 54, 4);
    powerUp(w, p1, 50, 14);
    const tower = building(w, 'ftur', p1, 30, 30);
    const plant = building(w, 'powr', p1, 40, 29);
    const tanks = [unit(w, '2tnk', p0, 14, 30), unit(w, '2tnk', p0, 14, 32), unit(w, '2tnk', p0, 15, 31)];
    for (const c of attackMoveCommands(p0.id, tanks, plant, 0, 0).cmds) w.issue(c);
    run(w, seconds(60));
    assert.ok(!tower.alive || tower.hp < tower.maxHp * 0.5, `the tower was fought on the way (hp ${Math.round(tower.hp)}/${tower.maxHp}, alive ${tower.alive})`);
    assert.ok(tanks.some((t) => t.alive), 'the tanks won that fight');
  });
});

describe('replays kept when a battle is left early', () => {
  test('keepsRecording: 30 s for a battle, an order and 5 s for a branch', () => {
    assert.equal(keepsRecording({ gameOver: false, ticks: MIN_TICKS - 1, branch: false, commands: 9 }), false, 'a battle left before 30 s');
    assert.equal(keepsRecording({ gameOver: false, ticks: MIN_TICKS, branch: false, commands: 0 }), true, '30 s');
    assert.equal(keepsRecording({ gameOver: true, ticks: 40, branch: false, commands: 0 }), true, 'finished, however short');
    assert.equal(keepsRecording({ gameOver: false, ticks: 300, branch: true, commands: 1 }), true, 'a 15 s branch with an order');
    assert.equal(keepsRecording({ gameOver: false, ticks: 300, branch: true, commands: 0 }), false, 'a branch nobody played');
    assert.equal(keepsRecording({ gameOver: false, ticks: MIN_BRANCH_TICKS - 1, branch: true, commands: 3 }), false, 'under 5 s');
  });
});

describe('the Field Manual alert queue (src/ui/coach.ts AlertQueue)', () => {
  test('an alert goes after ALERT_SHOW seconds even while its condition holds, and the next one can come', async () => {
    const { ALERT_GAP, ALERT_SHOW, ALERTS, AlertQueue, CoachWatch } = await import('../src/ui/coach');
    const { world: w, p0, p1 } = sandbox({ w: 64, h: 64, credits: 5000 });
    building(w, 'fact', p0, 6, 54);
    building(w, 'fact', p1, 50, 8);
    building(w, 'proc', p0, 12, 50); // a refinery, no truck and no defence: two lasting conditions
    const c = new CoachWatch(), q = new AlertQueue();
    const raised: { key: string; t: number }[] = [];
    let longest = 0, since = -1, cur = -1;
    for (let i = 0; i < 9 * 60; i++) {
      run(w, seconds(1));
      c.update(w, p0);
      const r = q.update(w, p0, c, true);
      if (r.fresh) { const a = ALERTS[r.idx]; raised.push({ key: typeof a.text === 'function' ? a.text(p0, c, w) : a.text, t: Math.round(w.time) }); since = w.time; cur = r.idx; }
      if (r.idx >= 0 && r.idx === cur) longest = Math.max(longest, w.time - since);
    }
    const keys = raised.map((r) => r.key);
    assert.ok(keys.includes('alerts.noTrucksFactory') && keys.includes('alerts.defences'), `both lasting conditions got their alert: ${JSON.stringify(raised)}`);
    assert.ok(longest <= ALERT_SHOW + 1, `no alert stays up over ${ALERT_SHOW} s (longest ${longest})`);
    for (let i = 1; i < raised.length; i++) assert.ok(raised[i].t - raised[i - 1].t >= ALERT_GAP, `one alert a minute at most: ${JSON.stringify(raised)}`);
    assert.equal(new Set(keys).size, keys.length, 'each alert once a match');
  });
});

describe('branches from a multiplayer replay after a surrender (src/replay/branch.ts)', () => {
  test('the AI that took over a surrendered side keeps playing it; taking command of that side starts fresh', async () => {
    const { headlessGame } = await import('../src/modes/headless');
    const { matchSetup } = await import('../src/net/roster');
    const { normaliseSettings } = await import('../src/net/settings');
    const { makeBranch, branchSetup } = await import('../src/replay/branch');
    const { canResign } = await import('../src/sim/resign');
    const human = (seat: number, name: string) => ({ kind: 'human' as const, seat, name, ready: true, connected: true, faction: 'random' as const });
    const start = { seed: 4242, room: { code: 'TESTAB', phase: 'match', host: 1, build: '', mods: '', settings: normaliseSettings({ mode: '2v2', size: 64, startUnits: 'light' }), slots: [human(1, 'Ann'), human(2, 'Ben'), human(3, 'Cat'), human(4, 'Dan')] } };
    const g = headlessGame(matchSetup(start as Parameters<typeof matchSetup>[0], 1, 'low', null));
    const w = g.world;
    for (let i = 0; i < 300; i++) { w.step(); w.events.length = 0; }
    w.issue({ c: 'resign', player: 0 }); // Ann surrenders; Ben fights on, the AI takes Ann's forces
    for (let i = 0; i < 200; i++) { w.step(); w.events.length = 0; }
    assert.ok(w.players[0].resigned && w.ais.some((a) => a.player.id === 0), 'the AI took over the surrendered side');
    const data = { id: 'mp-replay', setup: g.setup, players: [], local: 0 } as unknown as Parameters<typeof makeBranch>[0];
    // take command of an opponent: the takeover AI still plays the surrendered side
    const b2 = headlessGame(branchSetup(g.setup, makeBranch(data, w, 2, 'normal'), 'low'));
    assert.ok(b2.local.id === 2 && b2.world.ais.some((a) => a.player.id === 0), `player 0 is AI-controlled in the branch: ${b2.world.ais.map((a) => a.player.id)}`);
    // take command of the surrendered side itself: a fresh commander, who can win or surrender
    const b0 = headlessGame(branchSetup(g.setup, makeBranch(data, w, 0, 'normal'), 'low'));
    assert.ok(b0.local.id === 0 && !b0.local.resigned && canResign(b0.world, b0.local), `the side taken over is free again (resigned ${b0.local.resigned})`);
    assert.ok(!b0.world.ais.some((a) => a.player.id === 0), 'and no AI plays it');
  });
});
