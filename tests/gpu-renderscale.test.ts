// Auto render scale (GameRenderer.adaptResolution): a capable GPU stays at full resolution, a slow one steps down
// to the floor without oscillating, and the scale climbs back once there is headroom.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepRenderScale } from '../src/render/renderer.ts';

const run = (s: number, windows: number[], floor = 0.5) => {
  const w = { badWindows: 0, goodWindows: 0 };
  const out: number[] = [];
  for (const avg of windows) out.push((s = stepRenderScale(s, avg, floor, w)));
  return out;
};

test('a capable GPU (60 or 30 Hz display) never leaves full resolution', () => {
  assert.deepEqual(run(1, Array(30).fill(16.7)), Array(30).fill(1), '60 Hz');
  assert.deepEqual(run(1, Array(30).fill(33.3)), Array(30).fill(1), '30 Hz display, frames on time');
  assert.deepEqual(run(1, [16, 40, 16, 40, 16, 40]), Array(6).fill(1), 'isolated slow windows are ignored');
});

test('a slow GPU steps down to the floor, and stays there while it is still slow', () => {
  const s = run(1, Array(12).fill(60));
  assert.equal(s[0], 0.85, `far too slow: one window per step (${s})`);
  assert.equal(s.at(-1), 0.5, `reaches the floor (${s})`);
  assert.ok(s.every((v, i) => i === 0 || v <= s[i - 1]), `never steps up while slow (${s})`);
  assert.equal(run(1, Array(12).fill(60), 0.6).at(-1), 0.6, 'the TAA floor');
  const m = run(1, [40, 40, 40, 40]);
  assert.deepEqual(m, [1, 0.9, 0.9, 0.8], `moderately slow: two windows per step (${m})`);
});

test('headroom brings the scale back up in small steps, with no oscillation in between', () => {
  const up = run(0.5, Array(24).fill(14));
  assert.equal(up.at(-1), 1, `climbs back (${up})`);
  assert.ok(up.every((v, i) => i === 0 || v - up[i - 1] <= 0.05 + 1e-9), `small steps (${up})`);
  // inside the band (20..34 ms) nothing moves
  assert.deepEqual(run(0.7, Array(10).fill(27)), Array(10).fill(0.7), 'hysteresis band');
});
