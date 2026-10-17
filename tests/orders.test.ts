// Unit control: formations, patrol, escort / guard, rally to a unit, build plans, focus fire, kiting,
// and determinism / save-load with all of them in flight.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sandbox, building, unit, run, runUntil, seconds, paint, powerUp, stateHash, T, type Unit, type World } from './helpers';
import { layoutShape } from '../src/sim/formation';
import { serializeWorld, deserializeWorld } from '../src/sim/save';
import { spawnProduced } from '../src/sim/production';

const ids = (us: Unit[]) => us.map((u) => u.id);
const spread = (vals: number[]) => Math.max(...vals) - Math.min(...vals);

/** Ticks until every unit's order is idle (-1 on timeout); per-unit arrival ticks in `arrived`. */
function runToArrival(world: World, us: Unit[], max: number, arrived: number[] = []): number {
  const t0 = world.tick;
  return runUntil(world, () => {
    us.forEach((u, k) => { if (arrived[k] === undefined && u.order.type === 'idle') arrived[k] = world.tick - t0; });
    return us.every((u) => u.order.type === 'idle');
  }, max);
}

describe('formations', () => {
  test('a line holds its shape on the move and arrives together at the slowest pace', () => {
    const { world, p0 } = sandbox({ w: 64, h: 64 });
    // two fast light tanks among medium tanks
    const us = ['2tnk', '1tnk', '2tnk', '1tnk', '2tnk', '2tnk'].map((t, k) => unit(world, t, p0, 10.5 + (k % 3), 29.5 + Math.floor(k / 3)));
    world.issue({ c: 'formation', player: p0.id, units: ids(us), shape: 'line' });
    run(world, seconds(5));
    assert.ok(us.every((u) => u.formShape === 'line'), 'shape remembered');
    assert.ok(spread(us.map((u) => u.x)) < 0.8, `formed up in a north-south line facing east (x spread ${spread(us.map((u) => u.x)).toFixed(2)})`);
    world.issue({ c: 'move', player: p0.id, units: ids(us), x: 44.5, y: 30.5 });
    run(world, 1);
    assert.equal(world.ctrl.groups.length, 1, 'one formation group in transit');
    // in transit (after setting off): the line stays a line and nobody runs ahead
    let worstLine = 0, worstGap = 0;
    for (let s = 0; s < 12; s++) {
      run(world, seconds(1));
      if (s < 2 || !world.ctrl.groups.length) continue;
      worstLine = Math.max(worstLine, spread(us.map((u) => u.x)));
      const ys = us.map((u) => u.y).sort((a, b) => a - b);
      for (let k = 1; k < ys.length; k++) worstGap = Math.max(worstGap, Math.abs(ys[k] - ys[k - 1] - 1.3));
    }
    assert.ok(worstLine < 1.0, `line kept straight in transit (worst x spread ${worstLine.toFixed(2)})`);
    assert.ok(worstGap < 0.6, `spacing kept in transit (worst deviation ${worstGap.toFixed(2)})`);
    const arrived: number[] = [];
    assert.ok(runToArrival(world, us, seconds(40), arrived) > 0, 'everybody arrived');
    assert.ok(spread(arrived) <= seconds(2.5), `arrived together (spread ${(spread(arrived) / 20).toFixed(1)} s)`);
    assert.ok(us.every((u) => Math.abs(u.x - 44.5) < 1.2), 'line ends at the destination');
    assert.ok(spread(us.map((u) => u.x)) < 0.8, 'still a line on arrival');
    run(world, 1);
    assert.equal(world.ctrl.groups.length, 0, 'group dissolved on arrival');
  });

  test('a line squeezes through a gap and re-forms behind it', () => {
    const { world, p0, map } = sandbox({ w: 64, h: 64 });
    paint(map, 25, 0, 26, 63, T.Rock);
    paint(map, 25, 30, 26, 31, T.Clear); // a two-cell gap
    const us = ['2tnk', '2tnk', '1tnk', '1tnk', '2tnk', '2tnk'].map((t, k) => unit(world, t, p0, 10.5 + (k % 3), 29.5 + Math.floor(k / 3)));
    world.issue({ c: 'formation', player: p0.id, units: ids(us), shape: 'line' });
    run(world, seconds(4));
    world.issue({ c: 'move', player: p0.id, units: ids(us), x: 42.5, y: 30.5 });
    assert.ok(runToArrival(world, us, seconds(60)) > 0, 'got through the gap (no jam)');
    assert.ok(us.every((u) => u.x > 40), 'all on the far side');
    assert.ok(spread(us.map((u) => u.x)) < 0.8 && spread(us.map((u) => u.y)) > 5, 'back in a line');
  });

  test('box and wedge layouts: rows by role, armour in front, artillery at the back', () => {
    const { world, p0 } = sandbox();
    const us = ['arty', 'e1', 'e3', '2tnk', 'e1', '2tnk', 'e3', 'e1', 'e1'].map((t, k) => unit(world, t, p0, 10.5 + k, 10.5));
    // facing east (h = 0): forward = +x
    const box = layoutShape('box', us, 14.5, 10.5, 0);
    const f = (id: string) => us.map((u, k) => (u.ut.id === id ? box[2 * k] : NaN)).filter((v) => !Number.isNaN(v));
    assert.ok(Math.min(...f('2tnk')) >= Math.max(...f('e3')), 'tanks ahead of rocket soldiers');
    assert.ok(Math.max(...f('arty')) <= Math.min(...f('2tnk'), ...f('e1')), 'artillery at the back');
    const rows = new Set(box.filter((_, i) => i % 2 === 0).map((v) => v.toFixed(2)));
    assert.equal(rows.size, 3, '9 units: a 3x3 box');
    const wedge = layoutShape('wedge', us.slice(0, 6), 14.5, 10.5, 0);
    const front = Math.max(...wedge.filter((_, i) => i % 2 === 0));
    assert.equal(wedge.filter((v, i) => i % 2 === 0 && Math.abs(v - front) < 1e-6).length, 1, 'a single unit at the tip of the wedge');
  });

  test('automatic formation (none): a tight group keeps its relative positions', () => {
    const { world, p0 } = sandbox({ w: 64, h: 64 });
    const us = ['2tnk', 'e1', '2tnk', 'e1', 'e1'].map((t, k) => unit(world, t, p0, 10.5 + (k % 3) * 1.2, 20.5 + Math.floor(k / 3) * 1.4));
    const rel0 = us.map((u) => [u.x - us[0].x, u.y - us[0].y]);
    world.issue({ c: 'move', player: p0.id, units: ids(us), x: 40.5, y: 30.5 });
    assert.ok(runToArrival(world, us, seconds(60)) > 0, 'arrived');
    const rel1 = us.map((u) => [u.x - us[0].x, u.y - us[0].y]);
    const err = Math.max(...rel0.map((r, k) => Math.hypot(r[0] - rel1[k][0], r[1] - rel1[k][1])));
    assert.ok(err < 0.6, `relative positions kept (worst error ${err.toFixed(2)})`);
  });

  test('a new order on the way continues the formation (no re-forming, no compression)', () => {
    const { world, p0 } = sandbox({ w: 64, h: 64 });
    const us = ['2tnk', '2tnk', '2tnk', '2tnk'].map((t, k) => unit(world, t, p0, 10.5 + (k % 2) * 1.3, 30.5 + Math.floor(k / 2) * 1.3));
    const rel0 = us.map((u) => [u.x - us[0].x, u.y - us[0].y]);
    world.issue({ c: 'move', player: p0.id, units: ids(us), x: 40.5, y: 30.5 });
    run(world, seconds(6));
    const g0 = world.ctrl.groups[0];
    assert.ok(g0, 'marching in formation');
    // the player keeps clicking further on (like an autopilot re-issuing every 1.5 s)
    let x = 40.5;
    for (let k = 0; k < 6; k++) { x += 1; world.issue({ c: 'move', player: p0.id, units: ids(us), x, y: 30.5 }); run(world, seconds(1.5)); }
    const g1 = world.ctrl.groups[world.ctrl.groups.length - 1];
    assert.ok(g1 && g1.f > 0.5, `still marching at speed (f ${g1?.f.toFixed(2)})`);
    assert.ok(runToArrival(world, us, seconds(40)) > 0, 'arrived');
    const rel1 = us.map((u) => [u.x - us[0].x, u.y - us[0].y]);
    const err = Math.max(...rel0.map((r, k) => Math.hypot(r[0] - rel1[k][0], r[1] - rel1[k][1])));
    assert.ok(err < 0.6, `shape kept through repeated orders (worst error ${err.toFixed(2)})`);
  });

  test('AI group moves are unchanged unless the AI asks for a shape', () => {
    const { world, p1 } = sandbox({ ai: [undefined, 'easy'] });
    world.ais.length = 0; // scripted
    const us = [unit(world, '3tnk', p1, 10.5, 10.5), unit(world, '3tnk', p1, 11.5, 10.5)];
    world.issue({ c: 'move', player: p1.id, units: ids(us), x: 30.5, y: 10.5 });
    run(world, 2);
    assert.equal(world.ctrl.groups.length, 0, 'no formation group for the AI');
    assert.ok(us.every((u) => u.order.type === 'move' && u.order.formation === undefined), 'plain moves');
  });

  test('attack-move in formation: the group stops to fight, then carries on together', () => {
    const { world, p0, p1 } = sandbox({ w: 64, h: 64 });
    const us = ['2tnk', '2tnk', '2tnk', '2tnk'].map((t, k) => unit(world, t, p0, 10.5 + (k % 2), 30.5 + Math.floor(k / 2)));
    world.issue({ c: 'formation', player: p0.id, units: ids(us), shape: 'line' });
    run(world, seconds(3));
    const foe = unit(world, 'e1', p1, 26.5, 30.5);
    world.issue({ c: 'move', player: p0.id, units: ids(us), x: 44.5, y: 30.5, attackMove: true });
    assert.ok(runUntil(world, () => !foe.alive, seconds(40)) > 0, 'the enemy on the way was shot');
    assert.ok(runToArrival(world, us, seconds(40)) > 0, 'arrived after the fight');
    assert.ok(us.every((u) => u.x > 42), 'all at the destination');
  });
});

describe('patrol', () => {
  test('patrol loops between the start and the waypoints', () => {
    const { world, p0 } = sandbox();
    const jeep = unit(world, 'jeep', p0, 8.5, 20.5);
    world.issue({ c: 'patrol', player: p0.id, units: [jeep.id], points: [[24.5, 20.5], [24.5, 30.5]] });
    let visitsA = 0, visitsB = 0, visitsHome = 0, at = '';
    for (let t = 0; t < seconds(90); t++) {
      run(world, 1);
      const near = (x: number, y: number) => Math.hypot(jeep.x - x, jeep.y - y) < 1;
      const now = near(24.5, 20.5) ? 'A' : near(24.5, 30.5) ? 'B' : near(8.5, 20.5) ? 'H' : '';
      if (now && now !== at) { if (now === 'A') visitsA++; else if (now === 'B') visitsB++; else visitsHome++; }
      if (now) at = now;
    }
    assert.equal(jeep.order.type, 'patrol', 'still patrolling');
    assert.ok(visitsA >= 2 && visitsB >= 2 && visitsHome >= 1, `looped (A ${visitsA}, B ${visitsB}, home ${visitsHome})`);
  });

  test('patrols engage enemies on the way and resume the route', () => {
    const { world, p0, p1 } = sandbox();
    const tank = unit(world, '2tnk', p0, 8.5, 20.5);
    world.issue({ c: 'patrol', player: p0.id, units: [tank.id], points: [[30.5, 20.5]] });
    const foe = unit(world, 'e1', p1, 20.5, 22.5);
    assert.ok(runUntil(world, () => !foe.alive, seconds(30)) > 0, 'enemy killed');
    run(world, seconds(1));
    assert.equal(tank.order.type, 'patrol', 'patrol resumed after the fight');
    assert.ok(runUntil(world, () => Math.hypot(tank.x - 30.5, tank.y - 20.5) < 1, seconds(30)) > 0, 'went on to the waypoint');
  });
});

describe('escort / guard', () => {
  test('escorts follow a unit and defend it against its attackers', () => {
    const { world, p0, p1 } = sandbox({ w: 64, h: 64 });
    const vip = unit(world, 'harv', p0, 10.5, 30.5);
    const guards = [unit(world, '2tnk', p0, 8.5, 28.5), unit(world, '2tnk', p0, 8.5, 32.5)];
    world.issue({ c: 'guard', player: p0.id, units: ids(guards), target: vip.id });
    world.issue({ c: 'move', player: p0.id, units: [vip.id], x: 40.5, y: 30.5 });
    run(world, seconds(25));
    assert.ok(Math.hypot(vip.x - 40.5, vip.y - 30.5) < 1.5, 'the harvester drove off');
    for (const g of guards) {
      assert.equal(g.order.type, 'escort', 'still escorting');
      assert.ok(Math.hypot(g.x - vip.x, g.y - vip.y) < 3, `escort stayed close (${Math.hypot(g.x - vip.x, g.y - vip.y).toFixed(1)})`);
    }
    // a rocket soldier ambushes the harvester from out of the escorts' sight
    const foe = unit(world, 'e3', p1, 45.5, 30.5);
    world.issue({ c: 'attack', player: p1.id, units: [foe.id], target: vip.id });
    assert.ok(runUntil(world, () => !foe.alive, seconds(30)) > 0, 'escorts killed the attacker');
    assert.ok(vip.alive, 'harvester survived');
  });

  test('guarding a structure: defend it, but do not chase far from it', () => {
    const { world, p0, p1 } = sandbox({ w: 64, h: 64 });
    const pp = building(world, 'powr', p0, 20, 20);
    const g = unit(world, '2tnk', p0, 15.5, 15.5);
    world.issue({ c: 'guard', player: p0.id, units: [g.id], target: pp.id });
    run(world, seconds(8));
    assert.ok(pp.distTo(g.x, g.y) < 2.5, 'took station next to the power plant');
    const raider = unit(world, 'e1', p1, 25.5, 21.5);
    assert.ok(runUntil(world, () => !raider.alive, seconds(20)) > 0, 'raider near the structure killed');
    const far = unit(world, 'e1', p1, 45.5, 21.5);
    run(world, seconds(10));
    assert.ok(pp.distTo(g.x, g.y) < 6, 'did not wander off after a distant enemy');
    assert.ok(far.alive, 'distant enemy left alone');
  });
});

describe('rally to a unit', () => {
  test("a factory's new units join and escort the rally unit", () => {
    const { world, p0 } = sandbox({ w: 64, h: 64 });
    powerUp(world, p0, 2, 2);
    building(world, 'fact', p0, 4, 8);
    const weap = building(world, 'weap', p0, 10, 8);
    const leader = unit(world, '2tnk', p0, 30.5, 30.5);
    world.issue({ c: 'rallyUnit', player: p0.id, building: weap.id, target: leader.id });
    run(world, 1);
    assert.equal(weap.rallyUnit, leader.id, 'rally unit set');
    assert.ok(spawnProduced(world, p0, '1tnk'), 'tank rolled out');
    const fresh = world.units[world.units.length - 1];
    assert.equal(fresh.order.type, 'escort', 'new unit escorts the leader');
    assert.ok(runUntil(world, () => Math.hypot(fresh.x - leader.x, fresh.y - leader.y) < 2.5, seconds(30)) > 0, 'joined the leader');
    // a normal rally point replaces it
    world.issue({ c: 'rally', player: p0.id, building: weap.id, x: 20.5, y: 20.5 });
    run(world, 1);
    assert.equal(weap.rallyUnit, 0, 'rally point clears the rally unit');
  });
});

describe('build plan', () => {
  test('planned structures are built in order when affordable and placed on their cells', () => {
    const { world, p0 } = sandbox({ w: 64, h: 64, credits: 2000 });
    building(world, 'fact', p0, 10, 10);
    world.issue({ c: 'queuePlan', player: p0.id, items: [{ type: 'powr', cx: 14, cy: 10 }, { type: 'tent', cx: 10, cy: 14 }, { type: 'powr', cx: 17, cy: 10 }] });
    run(world, 1);
    assert.equal(p0.buildPlan.length, 3, 'plan stored');
    const placedAt = new Map<string, number>();
    runUntil(world, () => {
      for (const b of world.buildings) if (b.owner === p0 && b.bt.id !== 'fact' && !placedAt.has(`${b.bt.id}@${b.cx},${b.cy}`)) placedAt.set(`${b.bt.id}@${b.cx},${b.cy}`, world.tick);
      return p0.buildPlan.length === 0;
    }, seconds(200));
    assert.deepEqual([...placedAt.keys()], ['powr@14,10', 'tent@10,14', 'powr@17,10'], 'built and placed in plan order on the planned cells');
    assert.ok(p0.credits >= 0, 'never overspent');
  });

  test('the plan waits until the next item is affordable, and can be edited', () => {
    const { world, p0 } = sandbox({ w: 64, h: 64, credits: 100 });
    building(world, 'fact', p0, 10, 10);
    world.issue({ c: 'queuePlan', player: p0.id, items: [{ type: 'powr', cx: 14, cy: 10 }, { type: 'barr', cx: 10, cy: 14 }] });
    run(world, seconds(5));
    assert.equal(p0.queues.structure.items.length, 0, 'not started while unaffordable');
    world.issue({ c: 'queuePlan', player: p0.id, items: [{ type: 'barr', cx: 10, cy: 14 }], mode: 'remove' });
    run(world, 1);
    assert.deepEqual(p0.buildPlan.map((x) => x.type), ['powr'], 'item removed');
    p0.cash += 2000;
    assert.ok(runUntil(world, () => world.buildings.some((b) => b.bt.id === 'powr' && b.cx === 14 && b.cy === 10), seconds(60)) > 0, 'built once affordable');
    world.issue({ c: 'queuePlan', player: p0.id, items: [{ type: 'powr', cx: 30, cy: 30 }], mode: 'replace' });
    world.issue({ c: 'queuePlan', player: p0.id, items: [], mode: 'replace' });
    run(world, 2);
    assert.equal(p0.buildPlan.length, 0, 'plan cleared');
  });
});

describe('focus fire', () => {
  test('a group spreads its fire instead of all shooting the same target', () => {
    const { world, p0, p1 } = sandbox({ w: 64, h: 64 });
    const shooters = Array.from({ length: 8 }, (_, k) => unit(world, 'e1', p0, 20.5 + (k % 4) * 0.6, 20.5 + Math.floor(k / 4) * 0.6));
    const foes = Array.from({ length: 4 }, (_, k) => unit(world, 'e1', p1, 23.5, 19.5 + k));
    // wounded: two rifle volleys (15 each) kill one; everybody starts on the first (weapons held a moment)
    for (const f of foes) { f.stance = 'passive'; f.hp = 20; }
    for (const s of shooters) { s.target = foes[0]; s.weapons[0].cooldown = 5; }
    run(world, 4);
    const per = foes.map((f) => shooters.filter((s) => s.target === f).length);
    assert.ok(per[0] >= 2 && per[0] <= 3, `just enough stay on the first target (${per.join(',')})`);
    assert.ok(per.filter((n) => n > 0).length >= 3, `fire spread over the others (${per.join(',')})`);
    assert.ok(Math.max(...per) <= 3, `nobody piles on (${per.join(',')})`);
  });

  test('units prefer to finish a wounded enemy', () => {
    const { world, p0, p1 } = sandbox({ w: 64, h: 64 });
    const shooter = unit(world, '2tnk', p0, 20.5, 20.5);
    const healthy = unit(world, '3tnk', p1, 24.5, 19.5);
    const hurt = unit(world, '3tnk', p1, 24.5, 21.5);
    hurt.hp = 40;
    healthy.stance = hurt.stance = 'passive';
    run(world, seconds(1));
    assert.equal(shooter.target?.id, hurt.id, 'aimed at the wounded tank');
    assert.ok(runUntil(world, () => !hurt.alive, seconds(10)) > 0, 'finished it');
    assert.ok(healthy.alive, 'the healthy one is next');
  });
});

describe('kiting', () => {
  function duel(stance: 'guard' | 'hold') {
    const { world, p0, p1 } = sandbox({ w: 64, h: 64 });
    const tanya = unit(world, 'e7', p0, 30.5, 30.5);
    tanya.stance = stance;
    const flamers = [unit(world, 'e4', p1, 36.5, 30.5), unit(world, 'e4', p1, 36.5, 31.5)];
    // (Tanya would drop them before they got close: give them 8 s of Iron Curtain to make her work for it)
    for (const f of flamers) f.invulnerable = 8;
    world.issue({ c: 'attack', player: p1.id, units: ids(flamers), target: tanya.id });
    let closest = Infinity, moved = 0;
    const x0 = tanya.x, y0 = tanya.y;
    for (let t = 0; t < seconds(25) && tanya.alive && flamers.some((f) => f.alive); t++) {
      run(world, 1);
      if (world.tick < seconds(8)) for (const f of flamers) closest = Math.min(closest, Math.hypot(f.x - tanya.x, f.y - tanya.y));
      moved = Math.max(moved, Math.hypot(tanya.x - x0, tanya.y - y0));
    }
    return { tanya, flamers, closest, moved };
  }

  test('a ranged unit keeps its distance from short-range attackers', () => {
    const { tanya, flamers, closest, moved } = duel('guard');
    assert.ok(moved > 1, `Tanya backed off (${moved.toFixed(1)} cells)`);
    assert.ok(closest > 3.6, `flamethrowers (range 3.5) kept at bay (closest ${closest.toFixed(2)})`);
    assert.ok(tanya.alive && flamers.every((f) => !f.alive), 'Tanya won the duel');
  });

  test('hold position never kites', () => {
    const { moved, closest } = duel('hold');
    assert.ok(moved < 0.3, `stood her ground (${moved.toFixed(2)})`);
    assert.ok(closest < 3.6, 'and let them close in');
  });
});

describe('determinism with the new orders', () => {
  function scene() {
    const s = sandbox({ w: 64, h: 64, credits: 3000, seed: 9 });
    const { world, p0, p1 } = s;
    building(world, 'fact', p0, 4, 40);
    const army = ['2tnk', '1tnk', 'e1', 'e1', 'e3', '2tnk'].map((t, k) => unit(world, t, p0, 10.5 + (k % 3), 30.5 + Math.floor(k / 3)));
    const pat = unit(world, 'jeep', p0, 8.5, 20.5);
    const esc = unit(world, 'e1', p0, 8.5, 22.5);
    const foes = [unit(world, 'e1', p1, 40.5, 31.5), unit(world, 'e4', p1, 44.5, 29.5), unit(world, '3tnk', p1, 50.5, 30.5)];
    world.issue({ c: 'formation', player: p0.id, units: ids(army), shape: 'wedge' });
    world.issue({ c: 'move', player: p0.id, units: ids(army), x: 52.5, y: 30.5, attackMove: true });
    world.issue({ c: 'patrol', player: p0.id, units: [pat.id], points: [[30.5, 20.5], [30.5, 10.5]] });
    world.issue({ c: 'guard', player: p0.id, units: [esc.id], target: pat.id });
    world.issue({ c: 'queuePlan', player: p0.id, items: [{ type: 'powr', cx: 8, cy: 40 }, { type: 'tent', cx: 4, cy: 44 }] });
    return { ...s, foes };
  }

  test('same commands, same result', () => {
    const a = scene(), b = scene();
    for (let k = 0; k < 6; k++) {
      run(a.world, seconds(10));
      run(b.world, seconds(10));
      assert.equal(stateHash(a.world), stateHash(b.world), `in step at ${k * 10 + 10} s`);
    }
  });

  test('save and load mid-formation / patrol / plan continues identically', () => {
    const a = scene();
    run(a.world, seconds(12));
    assert.ok(a.world.ctrl.groups.length > 0 || a.world.units.some((u) => u.order.type === 'patrol'), 'orders in flight at save time');
    const json = JSON.stringify(serializeWorld(a.world));
    const b = scene();
    deserializeWorld(b.world, JSON.parse(json));
    assert.equal(stateHash(b.world), stateHash(a.world), 'identical right after loading');
    assert.deepEqual(b.world.ctrl, a.world.ctrl, 'formation state restored');
    assert.deepEqual(b.p0.buildPlan, a.p0.buildPlan, 'build plan restored');
    for (let k = 0; k < 4; k++) {
      run(a.world, seconds(15));
      run(b.world, seconds(15));
      assert.equal(stateHash(b.world), stateHash(a.world), `still identical ${(k + 1) * 15} s after loading`);
    }
  });
});
