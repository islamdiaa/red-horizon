// World Conquest QA: a small slice of the random-policy fuzz and the determinism check (the full batches are
// tools/world/qa-fuzz.ts, 2,000 runs, and tools/world/qa-determinism.ts). Every run must end by its turn cap with no
// softlock and no broken invariant; a run must replay identically, and identically again through save/load.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, fuzzOne, worldHomelandIds } from '../tools/world/qa-fuzz';
import { detOne } from '../tools/world/qa-determinism';

test('world fuzz: random-policy runs end cleanly (no softlock, invariants hold, within the turn cap)', async () => {
  const W = await api();
  const homes = worldHomelandIds(W);
  assert.ok(homes.length >= 30, `homelands: ${homes.length}`);
  const cases = [
    { size: 'blitz', difficulty: 'recruit', skill: 0.97 }, { size: 'blitz', difficulty: 'easy', skill: 0.8 }, { size: 'blitz', difficulty: 'normal', skill: 0 },
    { size: 'blitz', difficulty: 'hard', skill: 0.4 }, { size: 'blitz', difficulty: 'brutal', skill: 0.97 }, { size: 'world', difficulty: 'normal', skill: 0.4 },
  ] as const;
  for (const [i, c] of cases.entries()) {
    const r = await fuzzOne({ home: homes[(i * 13) % homes.length], size: c.size, difficulty: c.difficulty, seed: 9001 + i * 77, policy: 300 + i, fight: 0.1, skill: c.skill });
    assert.ok(!r.error, `${r.home} ${c.size} ${c.difficulty}: error ${r.error}`);
    assert.ok(!r.softlock, `${r.home} ${c.size} ${c.difficulty}: softlock ${r.softlock}`);
    assert.deepEqual(r.violations, [], `${r.home} ${c.size} ${c.difficulty}: invariants`);
    assert.ok(r.status === 'won' || r.status === 'lost', `${r.home} ${c.size} ${c.difficulty}: ended (${r.status} at turn ${r.turns})`);
  }
});

test('world determinism: the same seed and choices replay identically, and through save/load at every turn', async () => {
  const W = await api();
  const homes = worldHomelandIds(W);
  for (const [i, c] of ([['blitz', 'easy'], ['world', 'hard']] as const).entries()) {
    const r = await detOne({ home: homes[(i * 17 + 3) % homes.length], size: c[0], difficulty: c[1], seed: 4242 + i, policy: 77 + i, fight: 0.1, skill: 0.6, saveEvery: 5 });
    assert.ok(!r.error, `${c.join(' ')}: ${r.error}`);
    assert.ok(r.sameAgain, `${c.join(' ')}: a replay differs (${r.firstDiff})`);
    assert.ok(r.sameAfterLoads, `${c.join(' ')}: save/load changes the continuation (${r.firstDiff})`);
  }
});
