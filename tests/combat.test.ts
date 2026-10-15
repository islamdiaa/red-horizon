// Combat: target acquisition, teams, projectiles, crushing, walls, retaliation.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { WEAPONS } from '../src/data/rules';
import { impact } from '../src/sim/combat';
import { sandbox, building, unit, run, runUntil, seconds, type GameEvent } from './helpers';

describe('target acquisition', () => {
  test('idle units automatically engage enemies that come into range', () => {
    const { world, p0, p1 } = sandbox();
    const tank = unit(world, '2tnk', p0, 10.5, 10.5);
    const enemy = unit(world, '3tnk', p1, 14.5, 10.5); // 4 cells: inside both 90mm and 105mm range
    const events: GameEvent[] = [];
    run(world, seconds(10), events);
    assert.ok(events.some((e) => e.e === 'fire' && e.shooter === tank.id), 'medium tank opened fire');
    assert.ok(events.some((e) => e.e === 'fire' && e.shooter === enemy.id), 'heavy tank returned fire');
    assert.ok(tank.hp < tank.maxHp && enemy.hp < enemy.maxHp, "tank.hp < tank.maxHp && enemy.hp < enemy.maxHp");
  });

  test('riflemen kill riflemen; nobody shoots their own team', () => {
    const { world, p0, p1 } = sandbox({ teams: [0, 0, 1] , factions: ['allies', 'soviet', 'soviet'] });
    const a = unit(world, 'e1', p0, 10.5, 10.5);
    const ally = unit(world, 'e1', p1, 12.5, 10.5);
    run(world, seconds(10));
    assert.equal(a.hp, a.maxHp, 'allied players do not fight');
    assert.equal(ally.hp, ally.maxHp);
    const enemy = unit(world, 'e1', world.players[2], 13.5, 10.5);
    const t = runUntil(world, () => !enemy.alive, seconds(20));
    assert.ok(t > 0, 'the enemy rifleman is shot down');
    assert.equal(world.players[2].stats.unitsLost, 1);
    assert.equal(p0.stats.unitsKilled + p1.stats.unitsKilled, 1);
  });

  test('units out of range are not engaged, units in sight are chased within the leash', () => {
    const { world, p0, p1 } = sandbox();
    const tank = unit(world, '2tnk', p0, 10.5, 10.5);
    const far = unit(world, 'e1', p1, 30.5, 10.5);
    run(world, seconds(3));
    assert.equal(tank.target, null);
    assert.equal(far.hp, far.maxHp);
    // an enemy at 5.5 cells (sight 5 + 0.5 grid slack: out of reach of the 90mm at 4.75) gets chased a little
    const near = unit(world, 'e1', p1, 15.5, 10.5);
    const t = runUntil(world, () => !near.alive, seconds(30));
    assert.ok(t > 0, 'engaged the infantry that came close');
  });

  test('defensive structures engage the closest enemy and ignore allies', () => {
    const { world, p0, p1 } = sandbox();
    const gun = building(world, 'gun', p0, 20, 20);
    building(world, 'powr', p0, 22, 22);
    const tank = unit(world, '3tnk', p1, 25.5, 20.5, Math.PI);
    tank.hp = tank.maxHp;
    const t = runUntil(world, () => tank.hp < tank.maxHp, seconds(10));
    assert.ok(t > 0, 'turret hit the tank');
    assert.equal(gun.target?.id, tank.id);
  });

  test('projectile weapons travel before hitting and can miss a target that moved away', () => {
    const { world, p0, p1 } = sandbox();
    const arty = unit(world, 'arty', p0, 10.5, 10.5);
    const target = unit(world, '3tnk', p1, 15.5, 10.5);
    world.issue({ c: 'attack', player: p0.id, units: [arty.id], target: target.id });
    const t = runUntil(world, () => world.projectiles.some((p) => p.alive), seconds(10));
    assert.ok(t > 0, 'shell in flight');
    const shell = world.projectiles.find((p) => p.alive)!;
    assert.equal(shell.weapon.id, '155mm');
    assert.ok(shell.z > 0, 'ballistic arc above ground');
    // teleport the target out of the blast
    target.x = target.prevX = 35.5;
    const hp = target.hp;
    runUntil(world, () => !shell.alive, seconds(10));
    assert.equal(target.hp, hp, 'shell landed harmlessly');
  });

  test('artillery respects its minimum range', () => {
    const { world, p0, p1 } = sandbox();
    const arty = unit(world, 'arty', p0, 10.5, 10.5);
    unit(world, '3tnk', p1, 11.5, 10.5);
    const events: GameEvent[] = [];
    // hold position: no auto-attack because the enemy is inside min range 2
    world.issue({ c: 'stop', player: p0.id, units: [arty.id] });
    run(world, seconds(3), events);
    assert.equal(events.filter((e) => e.e === 'fire' && e.shooter === arty.id).length, 0);
  });
});

describe('crushing', () => {
  /** Get a crusher rolling east, then drop a victim just in front of its hull. */
  function rolling(type: string, victimOwner: 'enemy' | 'friend', victimType = 'e6') {
    const s = sandbox();
    const { world, p0, p1 } = s;
    const tank = unit(world, type, p0, 6.5, 10.5);
    world.issue({ c: 'move', player: p0.id, units: [tank.id], x: 30.5, y: 10.5 });
    run(world, seconds(1.5));
    assert.ok(tank.moving, `${type} is rolling`);
    const inf = unit(world, victimType, victimOwner === 'enemy' ? p1 : p0, tank.x + 0.12, tank.y);
    const events: GameEvent[] = [];
    run(world, 2, events);
    const death = events.find((e) => e.e === 'death' && e.id === inf.id);
    return { ...s, tank, inf, how: death?.e === 'death' ? death.how : null };
  }

  test('a moving crusher kills enemy infantry that is under its hull', () => {
    for (const type of ['mcv', 'harv', '2tnk', '3tnk', '4tnk', 'apc']) {
      const r = rolling(type, 'enemy');
      assert.equal(r.how, 'crushed', `${type} crushed the engineer`);
      assert.equal(r.tank.kills, 1, `${type} credited with the kill`);
      assert.equal(r.p1.stats.unitsLost, 1, 'loss counted');
    }
  });

  test('wheeled Rangers and friendly infantry are never crushed', () => {
    assert.notEqual(rolling('jeep', 'enemy').how, 'crushed', 'Ranger is not a crusher');
    const own = rolling('3tnk', 'friend');
    assert.ok(own.inf.alive, 'own infantry is pushed aside, not crushed');
  });

  test('a crusher driving through stationary enemy infantry crushes it', () => {
    const { world, p0, p1 } = sandbox();
    // the MCV is unarmed, so the only way to kill the engineer is to drive over it
    const mcv = unit(world, 'mcv', p0, 6.5, 10.5);
    const inf = unit(world, 'e6', p1, 10.5, 10.5);
    const events: GameEvent[] = [];
    world.issue({ c: 'move', player: p0.id, units: [mcv.id], x: 14.5, y: 10.5 });
    runUntil(world, () => !inf.alive || (world.tick > 40 && !mcv.moving), seconds(15), events);
    assert.equal(inf.alive, false, `engineer pushed to (${inf.x.toFixed(2)}, ${inf.y.toFixed(2)}), MCV at (${mcv.x.toFixed(2)}, ${mcv.y.toFixed(2)})`);
    assert.ok(events.some((e) => e.e === 'death' && e.id === inf.id && e.how === 'crushed'), 'death by crushing');
  });
});

describe('walls', () => {
  function wallSetup() {
    const s = sandbox();
    building(s.world, 'fact', s.p1, 30, 30);
    const wall = building(s.world, 'sbag', s.p1, 20, 20);
    const brik = building(s.world, 'brik', s.p1, 20, 24);
    return { ...s, wall, brik };
  }

  test('small arms, fire and tesla bolts do not damage walls', () => {
    const { world, wall, brik } = wallSetup();
    for (const w of ['M1Carbine', 'M60mg', 'Vulcan', 'Colt45', 'Flamer', 'TeslaZap']) {
      impact(world, WEAPONS[w], null, wall, wall.x, wall.y, 0);
      impact(world, WEAPONS[w], null, brik, brik.x, brik.y, 0);
    }
    assert.equal(wall.hp, wall.maxHp);
    assert.equal(brik.hp, brik.maxHp);
  });

  test('explosive warheads (AP, HE) breach walls', () => {
    const { world, wall, brik } = wallSetup();
    impact(world, WEAPONS['90mm'], null, wall, wall.x, wall.y, 0);
    assert.ok(wall.hp < wall.maxHp, 'AP vs sandbags');
    impact(world, WEAPONS['155mm'], null, brik, brik.x, brik.y, 0);
    assert.equal(brik.maxHp - brik.hp, 150, 'HE vs concrete is 100 %');
  });

  test('walls block movement and are not auto-targeted; a forced rifle attack is refused', () => {
    const { world, p0, wall } = wallSetup();
    const rifle = unit(world, 'e1', p0, 17.5, 20.5);
    run(world, seconds(5));
    assert.equal(rifle.target, null, 'walls are ignored by auto-targeting');
    world.issue({ c: 'attack', player: p0.id, units: [rifle.id], target: wall.id, forced: true });
    const events: GameEvent[] = [];
    run(world, seconds(6), events);
    assert.equal(rifle.order.type, 'idle', 'small arms cannot hurt a wall: the order is not taken');
    assert.ok(!events.some((e) => e.e === 'fire' && e.shooter === rifle.id), 'no wasted shots');
    assert.equal(wall.hp, wall.maxHp, 'wall untouched');
    assert.equal(world.map.passable(20, 20), false);
    // a tank breaks through
    const tank = unit(world, '2tnk', p0, 16.5, 21.5);
    world.issue({ c: 'attack', player: p0.id, units: [tank.id], target: wall.id, forced: true });
    const t = runUntil(world, () => !wall.alive, seconds(40));
    assert.ok(t > 0, 'wall destroyed by cannon fire');
    assert.ok(world.map.passable(20, 20), 'gap opened');
  });

  test('a player left with only walls is defeated', () => {
    const { world, p0, p1 } = wallSetup();
    building(world, 'powr', p0, 4, 4);
    const fact = world.buildings.find((b) => b.owner === p1 && b.bt.id === 'fact')!;
    world.kill(fact, 'normal');
    for (const u of world.units) if (u.owner === p1) world.kill(u);
    run(world, seconds(1.1));
    assert.ok(p1.defeated, "p1.defeated");
    assert.ok(world.gameOver, "world.gameOver");
    assert.equal(world.winnerTeam, 0);
  });
});
