// Power grid: supply/demand, damaged plants, low-power production, Tesla Coils, radar, superweapons.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildSeconds } from '../src/sim/production';
import { recalcPlayerEconomy } from '../src/sim/production';
import { sandbox, building, unit, run, runUntil, seconds, type GameEvent } from './helpers';

describe('power grid', () => {
  test('plants supply, structures drain', () => {
    const { world, p0 } = sandbox();
    building(world, 'fact', p0, 4, 4);
    building(world, 'powr', p0, 8, 4);
    building(world, 'apwr', p0, 10, 4);
    building(world, 'tent', p0, 13, 4);
    building(world, 'proc', p0, 4, 8);
    assert.equal(p0.powerOut, 300);
    assert.equal(p0.powerUse, 20 + 30);
    assert.equal(p0.lowPower, false);
    assert.equal(p0.powerRatio, 1);
  });

  test('a damaged power plant produces proportionally less (50% at 0 hp)', () => {
    const { world, p0 } = sandbox();
    const plant = building(world, 'powr', p0, 8, 4);
    plant.hp = plant.maxHp / 2;
    recalcPlayerEconomy(world, p0);
    assert.equal(p0.powerOut, 75);
  });

  test('structures under construction neither supply nor drain', () => {
    const { world, p0 } = sandbox();
    building(world, 'powr', p0, 8, 4);
    const b = world.addBuilding('dome', p0, 11, 4, false);
    recalcPlayerEconomy(world, p0);
    assert.equal(p0.powerUse, 0);
    run(world, seconds(1.5));
    assert.equal(b.buildAnim, 1);
    assert.equal(p0.powerUse, 40);
  });

  test('low power slows production in proportion to the shortfall', () => {
    const { world, p0 } = sandbox();
    building(world, 'fact', p0, 4, 4);
    building(world, 'powr', p0, 8, 4);
    building(world, 'tent', p0, 10, 4);
    const full = buildSeconds(world, p0, 'e3');
    // 100 out, 220 in => ratio 0.4545 => x(1 + 0.5454 * 2)
    building(world, 'atek', p0, 13, 4);
    assert.ok(p0.lowPower, "p0.lowPower");
    const slow = buildSeconds(world, p0, 'e3');
    const ratio = 100 / 220;
    assert.ok(Math.abs(slow / full - (1 + (1 - ratio) * 2)) < 1e-9, `x${(slow / full).toFixed(3)}`);
    // and in the running simulation
    world.issue({ c: 'build', player: p0.id, type: 'e3' });
    const t = runUntil(world, () => world.units.some((u) => u.ut.id === 'e3'), seconds(60));
    assert.ok(Math.abs(t - seconds(slow)) <= 2, `trained in ${t / 20}s, expected ${slow.toFixed(2)}s`);
  });

  test('low power announces once and shuts the radar off', () => {
    const { world, p0 } = sandbox();
    building(world, 'powr', p0, 8, 4);
    building(world, 'dome', p0, 10, 4);
    assert.ok(p0.radar, "p0.radar");
    const events: GameEvent[] = [];
    const drain = building(world, 'atek', p0, 13, 4);
    run(world, 2, events);
    assert.ok(p0.lowPower, "p0.lowPower");
    assert.equal(p0.radar, false);
    assert.ok(events.some((e) => e.e === 'announce' && e.key === 'low_power'), "events.some((e) => e.e === 'announce' && e.key === 'low_power')");
    world.kill(drain, 'sold');
    run(world, 1);
    assert.ok(p0.radar, 'back online');
  });
});

describe('Tesla Coil', () => {
  function teslaSetup(powered: boolean) {
    const s = sandbox({ factions: ['allies', 'soviet'] });
    const { world, p0, p1 } = s;
    if (powered) { building(world, 'apwr', p1, 30, 20); building(world, 'apwr', p1, 33, 20); }
    const coil = building(world, 'tsla', p1, 24, 20);
    const victim = unit(world, '2tnk', p0, 19.5, 20.5, 0);
    victim.hp = victim.maxHp;
    return { ...s, coil, victim };
  }

  test('a powered coil charges up and zaps an enemy in range', () => {
    const { world, coil, victim, p1 } = teslaSetup(true);
    assert.equal(p1.lowPower, false);
    const events: GameEvent[] = [];
    const t = runUntil(world, () => victim.hp < victim.maxHp, seconds(5), events);
    assert.ok(t > 0, 'zapped');
    // TeslaZap: 100 Super damage, armour ignored
    assert.equal(victim.maxHp - victim.hp, 100);
    assert.ok(events.some((e) => e.e === 'fire' && e.shooter === coil.id && e.weapon.id === 'TeslaZap'), "events.some((e) => e.e === 'fire' && e.shooter === coil.id && e.weapon.id === 'TeslaZap')");
    // charge time 10 ticks @15 Hz = 0.67 s before the first bolt
    assert.ok(t >= seconds(0.6), `fired after ${t} ticks`);
  });

  test('without power the coil stays dark', () => {
    const { world, coil, victim, p1 } = teslaSetup(false);
    assert.ok(p1.lowPower, "p1.lowPower");
    run(world, seconds(8));
    assert.equal(victim.hp, victim.maxHp);
    assert.equal(coil.charge, 0);
    assert.equal(coil.target, null);
    // restoring power brings it back
    building(world, 'apwr', p1, 30, 20);
    building(world, 'apwr', p1, 33, 20);
    const t = runUntil(world, () => victim.hp < victim.maxHp, seconds(5));
    assert.ok(t > 0, 'fires once powered');
  });

  test('defences that do not need power keep firing (slower) during low power', () => {
    const s = sandbox();
    const { world, p0, p1 } = s;
    const pbox = building(world, 'pbox', p0, 20, 20);
    building(world, 'atek', p0, 22, 22); // -200 with no plants
    assert.ok(p0.lowPower, "p0.lowPower");
    const inf = unit(world, 'e1', p1, 23.5, 20.5);
    const events: GameEvent[] = [];
    const t = runUntil(world, () => !inf.alive, seconds(10), events);
    assert.ok(t > 0, 'pillbox still kills infantry');
    assert.ok(events.some((e) => e.e === 'fire' && e.shooter === pbox.id), "events.some((e) => e.e === 'fire' && e.shooter === pbox.id)");
  });
});

describe('superweapon charge', () => {
  test('charges only while powered', () => {
    const { world, p0 } = sandbox();
    building(world, 'apwr', p0, 4, 4);
    building(world, 'mslo', p0, 8, 4);
    run(world, seconds(10));
    assert.ok(Math.abs(p0.superCharge.nuke - 10) < 0.06, `charged ${p0.superCharge.nuke}`);
    building(world, 'atek', p0, 11, 4); // overload the grid
    assert.ok(p0.lowPower, "p0.lowPower");
    const c = p0.superCharge.nuke;
    run(world, seconds(10));
    assert.equal(p0.superCharge.nuke, c, 'paused');
  });
});
