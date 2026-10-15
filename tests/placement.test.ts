// Structure placement rules: adjacency, terrain, ore, reserved dock/exit cells, units, walls.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { T } from '../src/sim/map';
import { wallLine } from '../src/sim/world';
import { sandbox, building, unit, paint, ore, run, runUntil, seconds, type GameEvent } from './helpers';

function yard() {
  const s = sandbox();
  const fact = building(s.world, 'fact', s.p0, 10, 10); // occupies 10..12 x 10..12
  return { ...s, fact };
}

describe('canPlace', () => {
  test('must be within 2 cells of an own structure', () => {
    const { world, p0 } = yard();
    assert.ok(world.canPlace(p0, 'powr', 13, 10), 'touching');
    assert.ok(world.canPlace(p0, 'powr', 15, 10), 'gap of 2');
    assert.equal(world.canPlace(p0, 'powr', 16, 10), false, 'gap of 3');
    assert.ok(world.canPlace(p0, 'powr', 6, 6), 'diagonal gap of 2');
    assert.equal(world.canPlace(p0, 'powr', 5, 5), false, 'diagonal gap of 3');
    assert.equal(world.canPlace(p0, 'powr', 30, 30), false, 'far away');
  });

  test('enemy structures do not count for adjacency; allies neither', () => {
    const { world, p0, p1 } = yard();
    building(world, 'fact', p1, 30, 30);
    assert.equal(world.canPlace(p0, 'powr', 33, 30), false);
    assert.ok(world.canPlace(p1, 'powr', 33, 30), "world.canPlace(p1, 'powr', 33, 30)");
  });

  test('cannot overlap structures or leave the map', () => {
    const { world, p0 } = yard();
    assert.equal(world.canPlace(p0, 'powr', 11, 11), false, 'overlaps the yard');
    assert.equal(world.canPlace(p0, 'powr', 12, 10), false, 'one column overlap');
    const edge = sandbox();
    building(edge.world, 'fact', edge.p0, 0, 0);
    assert.equal(edge.world.canPlace(edge.p0, 'powr', -1, 3), false);
    assert.equal(edge.world.canPlace(edge.p0, 'powr', 0, 47), false, 'bottom edge');
  });

  test('water, rock, trees and ore cells are not buildable', () => {
    const { world, map, p0 } = yard();
    paint(map, 14, 10, 14, 10, T.Water);
    assert.equal(world.canPlace(p0, 'powr', 13, 9), false, 'water');
    paint(map, 14, 10, 14, 10, T.Rock);
    assert.equal(world.canPlace(p0, 'powr', 13, 9), false, 'rock');
    paint(map, 14, 10, 14, 10, T.Clear);
    assert.ok(world.canPlace(p0, 'powr', 13, 9), "world.canPlace(p0, 'powr', 13, 9)");
    map.tree[map.idx(14, 10)] = 2;
    assert.equal(world.canPlace(p0, 'powr', 13, 9), false, 'tree');
    map.tree[map.idx(14, 10)] = 0;
    ore(map, 14, 10, 14, 10, 3);
    assert.equal(world.canPlace(p0, 'powr', 13, 9), false, 'ore');
    map.ore[map.idx(14, 10)] = 0;
    assert.ok(world.canPlace(p0, 'powr', 13, 9), 'harvested-out ore field is buildable again');
    // sand and dirt are fine
    paint(map, 13, 9, 14, 10, T.Sand);
    assert.ok(world.canPlace(p0, 'powr', 13, 9), "world.canPlace(p0, 'powr', 13, 9)");
    paint(map, 13, 9, 14, 10, T.Dirt);
    assert.ok(world.canPlace(p0, 'powr', 13, 9), "world.canPlace(p0, 'powr', 13, 9)");
  });

  test("refinery dock and factory exit cells must stay passable and can't be built over", () => {
    const { world, map, p0 } = yard();
    // refinery at (13,10) docks at (14,13)
    paint(map, 14, 13, 14, 13, T.Water);
    assert.equal(world.canPlace(p0, 'proc', 13, 10), false, 'dock in water');
    paint(map, 14, 13, 14, 13, T.Clear);
    assert.ok(world.canPlace(p0, 'proc', 13, 10), "world.canPlace(p0, 'proc', 13, 10)");
    building(world, 'proc', p0, 13, 10);
    assert.equal(map.reserved[map.idx(14, 13)], 1, 'dock reserved');
    assert.equal(world.canPlace(p0, 'silo', 14, 13), false, 'silo on the dock');
    assert.ok(world.canPlace(p0, 'silo', 15, 13), "world.canPlace(p0, 'silo', 15, 13)");
    // the reservation is released when the refinery goes
    const proc = world.buildings.find((b) => b.bt.id === 'proc')!;
    world.kill(proc, 'normal');
    assert.equal(map.reserved[map.idx(14, 13)], 0);
  });

  test('enemy ground units in the footprint block placement; own units are moved away', () => {
    const { world, p0, p1 } = yard();
    const enemy = unit(world, 'e1', p1, 14.5, 10.5);
    run(world, 1); // spatial grid
    assert.equal(world.canPlace(p0, 'powr', 13, 10), false);
    enemy.x = 20.5;
    run(world, 1);
    const own = unit(world, '2tnk', p0, 14.5, 10.5);
    run(world, 1);
    assert.ok(world.canPlace(p0, 'powr', 13, 10), 'own units do not block');
    // place through the queue and check the tank was pushed out
    p0.queues.structure.ready = 'powr';
    world.issue({ c: 'place', player: p0.id, type: 'powr', cx: 13, cy: 10 });
    run(world, 1);
    assert.ok(world.buildings.some((b) => b.bt.id === 'powr'), "world.buildings.some((b) => b.bt.id === 'powr')");
    const inside = own.x >= 13 && own.x < 15 && own.y >= 10 && own.y < 12;
    assert.equal(inside, false, `tank moved out to (${own.x}, ${own.y})`);
  });

  test('placing on an invalid spot keeps the structure ready and announces it', () => {
    const { world, p0 } = yard();
    p0.queues.structure.ready = 'powr';
    const events: GameEvent[] = [];
    world.issue({ c: 'place', player: p0.id, type: 'powr', cx: 30, cy: 30 });
    run(world, 1, events);
    assert.equal(p0.queues.structure.ready, 'powr');
    assert.ok(events.some((e) => e.e === 'announce' && e.key === 'cannot_build_here'), "events.some((e) => e.e === 'announce' && e.key === 'cannot_build_here')");
    // placing a type that isn't ready is ignored
    world.issue({ c: 'place', player: p0.id, type: 'weap', cx: 13, cy: 10 });
    run(world, 1);
    assert.equal(world.buildings.filter((b) => b.bt.id === 'weap').length, 0);
  });

  test('walls may be placed further out (gap 6) and dragged into paid lines', () => {
    const { world, p0 } = yard();
    assert.ok(world.canPlace(p0, 'sbag', 19, 11), 'gap 6');
    assert.equal(world.canPlace(p0, 'sbag', 20, 11), false, 'gap 7');
    p0.queues.structure.ready = 'sbag';
    const cash = p0.cash;
    world.issue({ c: 'place', player: p0.id, type: 'sbag', cx: 14, cy: 14, cx2: 20, cy2: 14 });
    run(world, 1);
    const walls = world.buildings.filter((b) => b.bt.id === 'sbag');
    assert.equal(walls.length, 7, 'a 7-cell line');
    assert.deepEqual(walls.map((w) => w.cx), [14, 15, 16, 17, 18, 19, 20]);
    assert.equal(cash - p0.cash, 6 * 25, 'first segment prepaid by the queue, 6 extra paid');
  });

  test('wall drags snap to straight lines', () => {
    assert.deepEqual(wallLine(2, 2, 6, 3), [[2, 2], [3, 2], [4, 2], [5, 2], [6, 2]], 'mostly horizontal => horizontal');
    assert.deepEqual(wallLine(2, 2, 2, -1), [[2, 2], [2, 1], [2, 0], [2, -1]], 'vertical, upwards');
    assert.deepEqual(wallLine(0, 0, 3, 3), [[0, 0], [1, 1], [2, 2], [3, 3]], 'clean diagonal');
  });

  test('a diagonal wall drag never extends past the cursor', () => {
    const cells = wallLine(0, 0, 5, 3);
    for (const [x, y] of cells) assert.ok(x <= 5 && y <= 3, `(${x},${y}) is inside the dragged box`);
  });

  test('MCV deploys into a construction yard where it stands, but not on bad ground', () => {
    const s = sandbox({ keepMcv: true });
    const { world, map, p0 } = s;
    const mcv = world.units.find((u) => u.owner === p0 && u.ut.id === 'mcv')!;
    assert.ok(world.canDeploy(mcv), "world.canDeploy(mcv)");
    // ore under the footprint blocks deployment
    const [cx, cy] = world.deployCell(mcv);
    ore(map, cx + 2, cy + 2, cx + 2, cy + 2, 2);
    assert.equal(world.canDeploy(mcv), false);
    const events: GameEvent[] = [];
    world.issue({ c: 'deploy', player: p0.id, units: [mcv.id] });
    run(world, 2, events);
    assert.ok(mcv.alive, 'still a vehicle');
    assert.ok(events.some((e) => e.e === 'announce' && e.key === 'cannot_deploy'), "events.some((e) => e.e === 'announce' && e.key === 'cannot_deploy')");
    map.ore[map.idx(cx + 2, cy + 2)] = 0;
    map.oreField[map.idx(cx + 2, cy + 2)] = 0;
    world.issue({ c: 'deploy', player: p0.id, units: [mcv.id] });
    const t = runUntil(world, () => world.buildings.some((b) => b.bt.id === 'fact' && b.owner === p0), 10);
    assert.ok(t > 0, 'deployed');
    assert.equal(mcv.alive, false);
    const fact = world.buildings.find((b) => b.bt.id === 'fact' && b.owner === p0)!;
    assert.deepEqual([fact.cx, fact.cy], [cx, cy]);
    assert.equal(p0.canBuild('powr'), false, 'options unlock only once the yard has finished building up');
    run(world, seconds(2));
    assert.equal(fact.buildAnim, 1);
    assert.ok(p0.canBuild('powr'), 'construction options unlocked');
  });
});
