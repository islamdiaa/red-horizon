import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrangeStarts } from '../src/sim/starts';
import { generateMap } from '../src/sim/mapgen';

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

test('2v2: teammates share a side of a generated four-player map', () => {
  const starts = generateMap({ size: 96, players: 4, seed: 9001, water: 0.4, trees: 0.5, ore: 0.6 }).startPositions;
  const before = dist(starts[0], starts[1]);
  const s = arrangeStarts(starts, [0, 0, 1, 1]);
  assert.ok(dist(s[0], s[1]) < before * 0.8, `teammates 0+1 were ${before.toFixed(0)} cells apart, now ${dist(s[0], s[1]).toFixed(0)}`);
  assert.ok(dist(s[2], s[3]) < before * 0.8, 'the other team shares a side too');
  assert.equal(new Set(s.map((p) => `${p.x},${p.y}`)).size, 4, 'every start used once');
  assert.deepEqual(s[0], starts[0], 'player 0 keeps its start (the given order wins ties)');
});

test('starts are unchanged without teams to group', () => {
  const starts = [{ x: 1, y: 1 }, { x: 9, y: 9 }, { x: 1, y: 9 }, { x: 9, y: 1 }];
  assert.deepEqual(arrangeStarts(starts, [0, 1, 2, 3]), starts, 'free-for-all');
  assert.deepEqual(arrangeStarts(starts, [0, 1]), starts, '1v1');
  assert.deepEqual(arrangeStarts(starts, [0, 0, 1]), [starts[0], starts[2], starts[1], starts[3]], 'a player and an AI ally against one: the ally takes a near corner, the enemy the far one');
});
