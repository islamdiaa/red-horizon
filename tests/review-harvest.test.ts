// Ore Truck robustness (src/sim/harvest.ts), found by tools/qa/longrun.ts.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sandbox, building, unit, run, seconds, ore } from './helpers';

describe('an Ore Truck whose ore is walled off finds other ore', () => {
  // (longrun "classic 4p ffa naval 96 s2": an AI built a Tesla Coil, a helipad and a power plant round a two-cell ore
  // pocket next to its refinery; its truck stood beside the pocket with 13 bales for the rest of the match, 15 minutes,
  // re-searching a path to the same cell every 2 s: the ore search started from that cell, inside the pocket)
  test('a truck beside an enclosed ore pocket goes to the open field instead', () => {
    const { world, map, p0 } = sandbox({ w: 40, h: 40, fog: false, credits: 0 });
    building(world, 'fact', p0, 2, 2);
    building(world, 'proc', p0, 6, 2);
    // the pocket: cells (18,12) and (19,12), structures on every side; (17,13) and (20,13) only touch it diagonally
    building(world, 'powr', p0, 15, 10); building(world, 'tsla', p0, 17, 11); building(world, 'powr', p0, 18, 10);
    building(world, 'powr', p0, 20, 11); building(world, 'powr', p0, 18, 13); building(world, 'powr', p0, 15, 12);
    ore(map, 18, 12, 19, 12, 9);
    ore(map, 6, 20, 9, 23, 9); // the open field
    const truck = unit(world, 'harv', p0, 17.5, 13.5);
    truck.cargo = 13;
    truck.cargoValue = 13 * 25;
    truck.lastOreX = 18; truck.lastOreY = 12; // (it was working the pocket when the last wall went up)
    truck.hstate = 'seek';
    const pocket = map.ore[map.idx(18, 12)] + map.ore[map.idx(19, 12)];
    run(world, seconds(60));
    assert.ok(truck.cargo !== 13 || Math.hypot(truck.x - 17.5, truck.y - 13.5) > 4, `the truck got going (cargo ${truck.cargo}, at ${truck.x.toFixed(1)},${truck.y.toFixed(1)}, state ${truck.hstate})`);
    assert.equal(map.ore[map.idx(18, 12)] + map.ore[map.idx(19, 12)], pocket, 'nobody mined the walled-off pocket');
    run(world, seconds(120));
    assert.ok(p0.credits + p0.ore > 0, `ore was delivered (credits ${p0.credits}, stored ore ${p0.ore})`);
  });
});
