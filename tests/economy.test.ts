// Ore economy: harvesting, refinery docking, gems, silo storage caps.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BAIL_COUNT, GEM_VALUE, GOLD_VALUE } from '../src/data/rules';
import { sandbox, building, unit, ore, runUntil, run, seconds, totalOre, type GameEvent } from './helpers';

function refinerySetup(opts: { gems?: boolean; credits?: number } = {}) {
  const s = sandbox({ credits: opts.credits ?? 0 });
  const { world, map, p0 } = s;
  const proc = building(world, 'proc', p0, 10, 10); // dock at (11, 13)
  ore(map, 18, 10, 21, 13, 9, opts.gems);
  const [dx, dy] = proc.dockCell()!;
  const harv = unit(world, 'harv', p0, dx + 0.5, dy + 0.5);
  return { ...s, proc, harv };
}

describe('harvesting', () => {
  test('a harvester fills up, docks and converts a full load into credits', () => {
    const { world, map, p0, harv } = refinerySetup();
    assert.equal(p0.storage, 2000, 'refinery storage');
    const ore0 = totalOre(map);
    const credits0 = p0.credits;
    const events: GameEvent[] = [];
    const t = runUntil(world, () => p0.stats.harvested >= BAIL_COUNT * GOLD_VALUE, seconds(90), events);
    assert.ok(t > 0, `delivered a load (state ${harv.hstate}, cargo ${harv.cargo})`);
    assert.equal(p0.credits - credits0, BAIL_COUNT * GOLD_VALUE, 'one load = 28 bails x 25');
    // (the field regrows meanwhile, so count the harvest events rather than diffing the map)
    assert.equal(events.filter((e) => e.e === 'harvest').length, BAIL_COUNT, '28 bails taken from the field');
    assert.ok(totalOre(map) < ore0 + 5, "totalOre(map) < ore0 + 5");
    assert.ok(events.some((e) => e.e === 'credits' && e.player === p0.id), 'credits floater events');
    // and it goes back for more
    run(world, seconds(3));
    assert.ok(['seek', 'toOre', 'harvesting'].includes(harv.hstate), `back to work: ${harv.hstate}`);
  });

  test('a full load takes a sensible time (RA: ~28 bails, harvesting + round trip)', () => {
    const { world, p0 } = refinerySetup();
    const t = runUntil(world, () => p0.stats.harvested >= BAIL_COUNT * GOLD_VALUE, seconds(90));
    // 28 bails * 0.34 s harvesting + unload 0.5 + 28 * 0.08 s + two ~8-cell drives at 1.2 cells/s
    assert.ok(t > seconds(15) && t < seconds(45), `took ${(t / 20).toFixed(1)} s`);
  });

  test('gems are worth twice as much as ore', () => {
    const { world, p0, harv } = refinerySetup({ gems: true });
    // first complete unload: cargo back to zero after something was deposited
    const t = runUntil(world, () => p0.stats.harvested > 0 && harv.cargo === 0, seconds(90));
    assert.ok(t > 0, "t > 0");
    assert.equal(p0.stats.harvested, BAIL_COUNT * GEM_VALUE);
  });

  test('two harvesters share one refinery dock without deadlocking', () => {
    const { world, p0, proc } = refinerySetup();
    unit(world, 'harv', p0, 15.5, 15.5);
    const t = runUntil(world, () => p0.stats.harvested >= 2 * BAIL_COUNT * GOLD_VALUE, seconds(150));
    assert.ok(t > 0, `both loads delivered (harvested ${p0.stats.harvested})`);
    assert.ok(proc.dockOccupant === 0 || world.getEntity(proc.dockOccupant)?.alive, "proc.dockOccupant === 0 || world.getEntity(proc.dockOccupant)?.alive");
  });

  test('harvesters with no ore anywhere idle without errors and resume when ore appears', () => {
    const { world, map, p0, harv } = refinerySetup();
    for (let i = 0; i < map.ore.length; i++) { map.ore[i] = 0; map.oreField[i] = 0; }
    map.oreFieldCells.length = 0;
    run(world, seconds(10));
    assert.equal(p0.stats.harvested, 0);
    assert.equal(harv.cargo, 0);
    ore(map, 18, 10, 21, 13, 9);
    const t = runUntil(world, () => harv.cargo > 0, seconds(20));
    assert.ok(t > 0, 'found the new ore');
  });

  test('destroying the refinery mid-unload sends the harvester to another one', () => {
    const { world, p0, proc, harv } = refinerySetup();
    const proc2 = building(world, 'proc', p0, 26, 20);
    runUntil(world, () => harv.hstate === 'unloading', seconds(60));
    world.kill(proc, 'normal');
    const before = p0.stats.harvested;
    const t = runUntil(world, () => p0.stats.harvested > before && harv.dockAt === 0, seconds(60));
    assert.ok(t > 0, `delivered to the second refinery (state ${harv.hstate})`);
    assert.ok(proc2.alive, "proc2.alive");
  });
});

describe('storage', () => {
  test('processed ore is capped by refinery + silo storage', () => {
    const { world, p0 } = refinerySetup();
    p0.ore = 1800;
    const events: GameEvent[] = [];
    runUntil(world, () => world.units[0].hstate === 'seek' && p0.ore >= 2000, seconds(90), events);
    assert.equal(p0.ore, 2000, 'capped at the refinery capacity');
    assert.equal(p0.stats.harvested, 200, 'only what fitted counts as harvested');
    assert.ok(events.some((e) => e.e === 'announce' && e.key === 'silos_needed'), 'silos needed warning');
  });

  test('silos add 1500 storage each; losing one discards the excess', () => {
    const { world, p0 } = refinerySetup();
    const silo = building(world, 'silo', p0, 14, 10);
    building(world, 'silo', p0, 14, 11);
    assert.equal(p0.storage, 2000 + 2 * 1500);
    p0.ore = 4500;
    world.kill(silo, 'normal');
    assert.equal(p0.storage, 3500);
    assert.equal(p0.ore, 3500, 'excess ore lost with the silo');
  });

  test('spending uses stored ore first, then cash; never goes negative', () => {
    const { p0 } = refinerySetup({ credits: 100 });
    p0.ore = 50;
    assert.equal(p0.credits, 150);
    assert.ok(p0.spend(80), "p0.spend(80)");
    assert.equal(p0.ore, 0);
    assert.equal(p0.cash, 70);
    assert.equal(p0.spend(71), false, 'refused when short');
    assert.equal(p0.cash, 70, 'nothing spent on refusal');
  });
});

describe('ore regrowth', () => {
  test('depleted ore fields regrow over time but never exceed the cap', () => {
    const { world, map } = sandbox();
    ore(map, 10, 10, 19, 19, 1);
    run(world, seconds(120));
    let max = 0, sum = 0;
    for (let y = 10; y <= 19; y++) for (let x = 10; x <= 19; x++) { const v = map.ore[map.idx(x, y)]; max = Math.max(max, v); sum += v; }
    assert.ok(sum > 100, `regrew to ${sum} bails`);
    assert.ok(max <= 9, "max <= 9");
  });
});
