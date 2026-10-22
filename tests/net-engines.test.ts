// Cross-engine details of the lockstep (Chrome / Firefox / Safari play one match): what the world hash sees must not
// depend on the engine. The portable maths itself is checked in tests/net.test.ts and, in the bundle, in
// tests/build-pow.test.ts; real cross-engine matches run in the net lab (tools/net-lab/vm-match.sh).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { headlessGame } from '../src/modes/headless';
import { worldHash } from '../src/replay/hash';
import type { GameSetup } from '../src/game';

const SETUP: GameSetup = {
  faction: 'allies', color: 0x3d7be0, opponents: [{ faction: 'soviet', difficulty: 'normal' }], mapSize: 64, water: 0.5, trees: 0.5, ore: 0.6,
  credits: 10000, startUnits: 'light', fog: true, timeOfDay: 'day', quality: 'low', seed: 777,
};

describe('the world hash is the same on every engine', () => {
  test('a NaN hashes the same whatever its bits (V8 on x86 makes 0xfff8... NaNs, Firefox and Safari 0x7ff8...)', () => {
    const w = headlessGame(SETUP).world;
    for (let i = 0; i < 40; i++) { w.step(); w.events.length = 0; }
    const u = w.units[0];
    const dv = new DataView(new ArrayBuffer(8));
    dv.setUint32(0, 0xfff80000); dv.setUint32(4, 0);
    const negNaN = dv.getFloat64(0);
    const bits = new Uint32Array(new Float64Array([negNaN]).buffer);
    u.hp = NaN;
    const canonical = worldHash(w);
    u.hp = negNaN;
    assert.equal(worldHash(w), canonical, `NaN with bits ${bits[1].toString(16)}:${bits[0].toString(16)} hashes as the canonical NaN`);
    u.hp = Infinity - Infinity;
    assert.equal(worldHash(w), canonical, 'an arithmetic NaN too');
    u.hp = 10;
    assert.notEqual(worldHash(w), canonical, 'a number still counts');
  });
});
