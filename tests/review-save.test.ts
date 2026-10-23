// REVIEW round 4: save / load regressions found by tools/qa/modesave.ts (every mode saved mid-match must continue
// exactly as the uninterrupted game).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { GameSetup } from '../src/game';
import { headlessGame, run } from '../src/modes/headless';
import { serializeWorld } from '../src/sim/save';
import { worldHash } from '../src/replay/hash';
import type { World } from '../src/sim/world';
import { seconds } from './helpers';

// a minimal localStorage (mission progress and the level preference read it)
const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage ??= {
  getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, String(v)); }, removeItem: (k: string) => { mem.delete(k); },
};

const mission = (id: string, level: GameSetup['missionLevel']): GameSetup => ({
  faction: 'allies', color: 0x3d7be0, opponents: [], mapSize: 64, water: 0.5, trees: 0.5, ore: 0.6, credits: 0, startUnits: 'light',
  fog: true, timeOfDay: 'day', quality: 'low', seed: 1, intro: false, mission: id, missionLevel: level,
} as GameSetup);
const resume = (setup: GameSetup, w: World) => headlessGame({ ...setup, load: { version: 1, savedAt: 0, world: JSON.parse(JSON.stringify(serializeWorld(w))), game: {} } }).world;
const aiLevels = (w: World) => w.ais.map((a) => `${a.player.id}:${a.difficulty}/${(a as unknown as { behaviour: string }).behaviour}`).join(' ');

describe('save / load keeps every mission AI as it was', () => {
  test('a mission AI set to a level and a behaviour keeps its level through a save (allied-05: easy, defensive)', () => {
    const setup = mission('allied-05', 'normal');
    const a = headlessGame(setup).world;
    run(a, seconds(30));
    assert.equal(aiLevels(a), '1:easy/defensive', 'the script made the Soviet AI an easy defender');
    const b = resume(setup, a);
    assert.equal(aiLevels(b), aiLevels(a), 'same AI level and behaviour after loading');
    assert.equal(a.players[1].buildSpeed, b.players[1].buildSpeed, 'same build speed');
  });

  test('allied-06 at Easy (an easy, defensive AI) continues identically after a save', () => {
    const setup = mission('allied-06', 'easy');
    const a = headlessGame(setup).world;
    run(a, seconds(90));
    const b = resume(setup, a);
    assert.equal(worldHash(b), worldHash(a), 'same state right after loading');
    for (let k = 0; k < 6; k++) {
      run(a, seconds(20));
      run(b, seconds(20));
      assert.equal(worldHash(b), worldHash(a), `same state ${(k + 1) * 20} s after loading`);
    }
  });
});
