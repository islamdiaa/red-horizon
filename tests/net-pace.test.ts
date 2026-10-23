/**
 * Real-time pace under frame hiccups (src/net/session.ts frame, WAIT_BANK): real browsers stall a frame now and then
 * (garbage collection, the compositor, a busy tab). A client that waits for the relay keeps a few ticks of the time
 * it waited, so the match catches up once the tick arrives instead of losing that time for everybody. Before, every
 * hiccup of any player longer than the delay's margin was lost for good: the net lab's real-browser LAN matches ran at
 * ~18.3 ticks a second instead of 20.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match } from './net-harness';
import { Rng } from '../src/core/rng';

/** Two players at ~60 fps whose frames take `hicMs` with probability `p`; the pace of the match over `secs`. */
function pace(latency: number, p: number, hicMs: number, secs = 90): number {
  const m = new Match();
  const a = m.peer('Alpha', latency, 1);
  m.peer('Bravo', latency, 1);
  m.setupRoom({ mode: '1v1', size: 64, startUnits: 'light' });
  m.until(() => m.minTick() > 100, 20000);
  const rng = new Rng(5);
  const next = new Map<string, number>(), last = new Map<string, number>();
  for (const x of m.peers) { next.set(x.name, m.clock.t); last.set(x.name, m.clock.t); }
  const t0 = m.clock.t, k0 = a.world!.tick;
  while (m.clock.t - t0 < secs * 1000) {
    m.clock.advance(Math.max(0, Math.min(...m.peers.map((x) => next.get(x.name)!)) - m.clock.t));
    for (const x of m.peers) {
      if (next.get(x.name)! > m.clock.t) continue;
      const dt = m.clock.t - last.get(x.name)!;
      last.set(x.name, m.clock.t);
      x.session!.frame(Math.min(dt, 100) / 1000, () => { x.bot?.(); x.world!.step(); x.world!.events.length = 0; });
      next.set(x.name, m.clock.t + (rng.next() < p ? hicMs : 16.7 + rng.next() * 2));
    }
  }
  return (a.world!.tick - k0) / ((m.clock.t - t0) / 1000);
}

test('frame hiccups on both sides do not slow the match below real time', () => {
  const smooth = pace(75, 0, 0);
  assert.ok(smooth > 19.9, `smooth frames keep real time (${smooth.toFixed(2)} ticks/s)`);
  // 2 % of frames take 120 ms on each player (old code: 17.9 ticks/s at this round trip)
  const hiccups = pace(75, 0.02, 120);
  assert.ok(hiccups > 19.5, `occasional 120 ms frames keep real time (${hiccups.toFixed(2)} ticks/s)`);
  // a longer round trip (the delay is larger, so is the margin; old code: 18.9 ticks/s)
  const far = pace(150, 0.02, 120);
  assert.ok(far > 19.7, `the same at a longer round trip (${far.toFixed(2)} ticks/s)`);
});
