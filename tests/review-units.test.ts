// REVIEW round 4: unit behaviour fixes (src/sim/combat.ts findTarget, src/sim/unitlogic.ts).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sandbox, building, unit, run, runUntil, seconds, paint, T } from './helpers';

describe('invulnerable structures without weapons are not auto-targeted', () => {
  // (soviet-03's locked power station, allied-03's lab, Conquest capture objectives: units on attack-move plinked at
  // them while the enemy picked them off from just out of range)
  test('an idle rifleman ignores a locked power plant in range', () => {
    const { world, p0, p1 } = sandbox({ w: 48, h: 48, fog: false });
    const plant = building(world, 'powr', p1, 22, 20);
    const e1 = unit(world, 'e1', p0, 20.5, 21.5);
    plant.invulnerable = 1e9;
    run(world, seconds(3));
    assert.equal(e1.target, null, `no target while only the locked plant is near (target ${e1.target?.type.id})`);
    assert.ok(e1.lastFireTick < 0 || plant.hp === plant.maxHp, 'the plant was never shot');
    plant.invulnerable = 0;
    run(world, seconds(2));
    assert.equal(e1.target, plant, 'once it can be damaged it is a target again');
  });

  test('an attack-move walks past a locked structure instead of stopping to shoot it', () => {
    const { world, p0, p1 } = sandbox({ w: 64, h: 48, fog: false });
    const plant = building(world, 'powr', p1, 30, 20);
    plant.invulnerable = 1e9;
    const squad = [0, 1, 2].map((k) => unit(world, 'e1', p0, 20.5, 19.5 + k));
    const foe = unit(world, 'e3', p1, 44.5, 21.5);
    world.issue({ c: 'move', player: p0.id, units: squad.map((u) => u.id), x: 46, y: 21, attackMove: true });
    const at = runUntil(world, () => squad.some((u) => u.alive && u.order.type === 'attack' && u.order.target === plant.id), seconds(12));
    assert.equal(at, -1, 'nobody stops to attack the locked plant');
    const hit = runUntil(world, () => !foe.alive, seconds(40));
    assert.ok(hit >= 0, 'the squad reaches and kills the rocket soldier beyond it');
  });

  test('an order to attack a locked structure is still obeyed', () => {
    const { world, p0, p1 } = sandbox({ w: 48, h: 48, fog: false });
    const plant = building(world, 'powr', p1, 22, 20);
    plant.invulnerable = 1e9;
    const e1 = unit(world, 'e1', p0, 18.5, 21.5);
    world.issue({ c: 'attack', player: p0.id, units: [e1.id], target: plant.id });
    const fired = runUntil(world, () => e1.lastFireTick === world.tick && e1.target === plant, seconds(10));
    assert.ok(fired >= 0, 'the rifleman shoots the plant it was told to attack');
    run(world, seconds(3));
    assert.ok(e1.order.type === 'attack' && e1.order.target === plant.id, `still on the order (${e1.order.type})`);
  });

  test('a structure picked up on an attack-move that locks (Conquest capture at low health) is dropped, the attack-move goes on', () => {
    const { world, p0, p1 } = sandbox({ w: 64, h: 48, fog: false });
    const post = building(world, 'powr', p1, 26, 20);
    const e1 = unit(world, 'e1', p0, 22.5, 21.5);
    world.issue({ c: 'move', player: p0.id, units: [e1.id], x: 44, y: 21, attackMove: true });
    const on = runUntil(world, () => e1.order.type === 'attack' && e1.order.target === post.id, seconds(6));
    assert.ok(on >= 0, 'the attack-move picks the plant up');
    post.invulnerable = 1e9;
    run(world, seconds(1));
    assert.ok(e1.order.type === 'move' && e1.order.attackMove, `back on the attack-move (${e1.order.type})`);
  });

  test('an armed invulnerable structure (Iron Curtain on a pillbox) is still a target', () => {
    const { world, p0, p1 } = sandbox({ w: 48, h: 48, fog: false });
    const pbox = building(world, 'pbox', p1, 22, 20);
    pbox.invulnerable = 1e9;
    const tank = unit(world, '2tnk', p0, 18.5, 20.5);
    run(world, seconds(3));
    assert.equal(tank.target, pbox, 'the tank answers the pillbox');
  });
});

describe('enter orders find a way in', () => {
  // (an AI squad sent into its own bunker on a ledge stood beside the cliff for the rest of the match: the point of the
  // bunker nearest to it was rock, and the order searched for it again every 2 s, for ever)
  test('an engineer whose side of the target is a cliff goes round to another side', () => {
    const { world, p0, p1 } = sandbox({ w: 48, h: 48, fog: false });
    const plant = building(world, 'powr', p1, 24, 20);
    // a cliff along the plant's east and south sides, the engineer beyond its south-east corner: the nearest cell it can
    // reach to the corner is on its own side of the cliff, so the search there never gets any further
    paint(world.map, 26, 12, 27, 24, T.Rock);
    paint(world.map, 24, 22, 27, 24, T.Rock);
    const eng = unit(world, 'e6', p0, 29.5, 23.5);
    world.issue({ c: 'enter', player: p0.id, units: [eng.id], target: plant.id });
    const t = runUntil(world, () => !eng.alive, seconds(60));
    assert.ok(t >= 0, `the engineer gets in (order ${eng.order.type} at ${eng.x.toFixed(1)},${eng.y.toFixed(1)})`);
    assert.ok(plant.owner === p0 || plant.hp < plant.maxHp, 'and does its work on the plant');
  });

  test('a structure with no way in at all: the order is given up, not kept for ever', () => {
    const { world, p0, p1 } = sandbox({ w: 48, h: 48, fog: false });
    const plant = building(world, 'powr', p1, 24, 20);
    paint(world.map, 22, 18, 27, 18, T.Rock); paint(world.map, 22, 23, 27, 23, T.Rock);
    paint(world.map, 22, 18, 23, 23, T.Rock); paint(world.map, 26, 18, 27, 23, T.Rock); // walled in by rock
    const eng = unit(world, 'e6', p0, 30.5, 21.5);
    world.issue({ c: 'enter', player: p0.id, units: [eng.id], target: plant.id });
    const t = runUntil(world, () => eng.order.type !== 'enter', seconds(60));
    assert.ok(t >= 0 && t < seconds(30), `gave up after ${(t / 20).toFixed(1)} s`);
    assert.ok(eng.alive && plant.owner === p1, 'nothing happened to either');
  });
});

describe('dead targets are let go on the move', () => {
  // (fuzz seed 240: a passive Heavy Tank on a plain move kept a dead rifleman as its target for the whole drive)
  test('a tank switched to passive while it had a target drops it when the target dies', () => {
    const { world, p0, p1 } = sandbox({ w: 64, h: 48, fog: false });
    const tank = unit(world, '3tnk', p0, 10.5, 20.5);
    const foe = unit(world, 'e1', p1, 16.5, 22.5);
    foe.stance = 'passive';
    world.issue({ c: 'move', player: p0.id, units: [tank.id], x: 50, y: 20.5, attackMove: false });
    const got = runUntil(world, () => tank.target === foe, seconds(5));
    assert.ok(got >= 0, 'the tank picks the rifleman up on the move');
    world.issue({ c: 'stance', player: p0.id, units: [tank.id], stance: 'passive' });
    run(world, 2);
    world.kill(foe, 'normal');
    run(world, seconds(1));
    assert.equal(tank.order.type, 'move', 'still driving');
    assert.equal(tank.target, null, `the dead rifleman is let go (target ${tank.target?.type.id})`);
  });
});
