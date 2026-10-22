// High-latency play (src/net/protocol.ts delayFor / MAX_DELAY, the relay's input delay, src/net/session.ts frame
// slack): the input delay covers round trips up to about 650 ms so the match keeps real time instead of slowing down,
// low-latency play keeps the short delay it had, a far player does not stall the first seconds, and a machine that
// draws only a few frames a second does not hold the others up.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Match, type Peer } from './net-harness';
import { DEFAULT_DELAY, MAX_COMMIT_AHEAD, MAX_DELAY, MIN_DELAY, delayFor } from '../src/net/protocol';
import { Lockstep } from '../src/net/lockstep';
import type { World } from '../src/sim/world';

/** Ticks per (virtual) second of a peer over a window, after `fn` ran it. */
function pace(m: Match, p: Peer, ms: number): number {
  const t0 = p.world!.tick, c0 = m.clock.t;
  m.until(() => false, ms);
  return ((p.world!.tick - t0) * 1000) / (m.clock.t - c0);
}

/** Issue-to-run latency of a peer's own commands (ticks), measured over a window. */
function cmdLatency(m: Match, p: Peer, ms: number): number[] {
  const issued: number[] = [];
  const ls = p.session!.ls, orig = ls.issue.bind(ls);
  ls.issue = (c) => { issued.push(p.world!.tick); orig(c); };
  const mine = p.executed.length;
  m.until(() => false, ms);
  ls.issue = orig;
  const own = p.executed.slice(mine).filter(([, c]) => c.player === p.world!.players.findIndex((x) => x.isHuman && x.name === p.name));
  return own.slice(0, issued.length).map(([t], i) => t - issued[i]);
}

describe('input delay for high latency', () => {
  test('the delay table: unchanged up to 200 ms, then up to 15 ticks; never outside the bounds', () => {
    const old = (rtt: number, j: number) => Math.max(2, Math.min(5, Math.ceil((rtt + 2 * j + 30) / 50)));
    for (const rtt of [0, 20, 50, 80, 120, 150, 200]) assert.equal(delayFor(rtt, 5), old(rtt, 5), `as before at ${rtt} ms`);
    assert.deepEqual([300, 450, 600, 650].map((r) => delayFor(r, 0)), [7, 10, 13, 14], 'up to 650 ms round trip');
    assert.equal(delayFor(5000, 500), MAX_DELAY, 'capped');
    assert.equal(delayFor(0, 0), MIN_DELAY, 'floor');
    assert.ok(MAX_DELAY >= 12 && MAX_DELAY <= 15 && MAX_DELAY + 9 < MAX_COMMIT_AHEAD, 'the relay accepts commits that far ahead (and the frame slack)');
    // the client clamps what the relay says to the same bounds (protocol.ts is shared): one table on both sides
    const ls = new Lockstep({ world: { tick: 0 } as unknown as World, seatPlayer: new Map([[1, 0]]), localSeat: 1, send: () => {} });
    ls.setDelay(13); assert.equal(ls.delay, 13, 'takes a high delay');
    ls.setDelay(99); assert.equal(ls.delay, MAX_DELAY, 'clamps above');
    ls.setDelay(0); assert.equal(ls.delay, MIN_DELAY, 'clamps below');
  });

  test('600 ms round trip: the match keeps real time (it used to slow to about 40 %), orders run about 650 ms after they are given', () => {
    const m = new Match();
    const a = m.peer('Alice', 600, 10), b = m.peer('Bob', 600, 10);
    m.setupRoom({ mode: '1v1', size: 64, startUnits: 'light' }, [], 6000);
    m.until(() => m.minTick() >= 200, 60_000);
    const start = a.messages.find((x) => x.t === 'start') as { delay: number } | undefined;
    assert.ok(start && start.delay >= 12, `the first delay already covers the lobby's round trips (${start?.delay})`);
    m.until(() => false, 10_000); // (settled)
    const d = a.session!.ls.delay;
    assert.ok(d >= 12 && d <= MAX_DELAY, `delay ${d} ticks (${d * 50} ms)`);
    const p = pace(m, a, 30_000);
    assert.ok(p > 19, `real time: ${p.toFixed(1)} ticks/s`);
    const lat = cmdLatency(m, a, 40_000);
    assert.ok(lat.length >= 3 && lat.every((t) => t >= 12 && t <= MAX_DELAY + 1), `orders run after the delay, 600-800 ms (${[...new Set(lat)].join(',')} ticks; delay ${d})`);
    assert.deepEqual(a.executed, b.executed, 'same stream');
  });

  test('low latency stays snappy: 40 ms round trip -> 2 ticks (100 ms)', () => {
    const m = new Match();
    const a = m.peer('Alice', 40, 5); m.peer('Bob', 40, 5);
    m.setupRoom({ mode: '1v1', size: 64, startUnits: 'light' });
    m.until(() => m.minTick() >= 400, 60_000);
    m.until(() => false, 8000);
    assert.equal(a.session!.ls.delay, MIN_DELAY, 'the shortest delay');
    const start = a.messages.find((x) => x.t === 'start') as { delay: number };
    assert.equal(start.delay, DEFAULT_DELAY, 'starts at the default while everyone loads');
    assert.ok(pace(m, a, 20_000) > 19.5, 'real time');
  });

  test('a machine that draws 3 frames a second commits further ahead: the other player does not wait for it', () => {
    const m = new Match();
    const fast = m.peer('Fast', 40, 5), slow = m.peer('Slow', 40, 5);
    m.setupRoom({ mode: '1v1', size: 64, startUnits: 'light' });
    m.until(() => m.minTick() >= 200, 60_000);
    slow.frameEveryMs = 330;
    m.until(() => false, 5000);
    assert.ok(slow.session!.frameSlack >= 5, `slack ${slow.session!.frameSlack} ticks`);
    assert.equal(fast.session!.frameSlack, 0, 'none at 60 frames a second');
    let catchUps = 0;
    const t0 = slow.world!.tick;
    const p = pace(m, fast, 30_000);
    assert.ok(p > 19, `the fast player keeps real time (${p.toFixed(1)} ticks/s)`);
    const ps = (slow.world!.tick - t0) / 30;
    assert.ok(ps > 19, `so does the slow one, in step with its frames rather than in catch-up bursts (${ps.toFixed(1)} ticks/s)`);
    for (let i = 0; i < 60; i++) { m.until(() => false, 330); if (slow.session!.catchingUp) catchUps++; }
    assert.equal(catchUps, 0, 'never in catch-up mode (which skips the effects)');
    assert.deepEqual(fast.executed.slice(0, 50), slow.executed.slice(0, 50), 'same stream');
  });

  test('a page that draws slowly, or freezes once, does not drive the delay up for everyone', () => {
    const m = new Match();
    const a = m.peer('Alice', 80, 5), b = m.peer('Bob', 80, 5);
    m.setupRoom({ mode: '1v1', size: 64, startUnits: 'light' });
    m.until(() => m.minTick() >= 200, 60_000);
    // Bob's page draws 2 frames a second: his answers to the heartbeats wait for his next frame (on average half of one)
    b.client.frameMs = () => 500;
    m.net.links.get('Bob')!.extra = 125;
    m.until(() => false, 20_000);
    assert.ok(a.session!.ls.delay <= 3, `the network's round trip counts, not his frame time (${a.session!.ls.delay} ticks)`);
    // one freeze of a few seconds (a heartbeat answered 3 s late)
    m.net.links.get('Bob')!.extra = 1500;
    m.until(() => false, 2100);
    m.net.links.get('Bob')!.extra = 125;
    let worst = 0;
    for (let i = 0; i < 20; i++) { m.until(() => false, 1000); worst = Math.max(worst, a.session!.ls.delay); }
    assert.ok(worst <= 4, `one late heartbeat does not move the delay (${worst} ticks; 15 when every sample counted in full)`);
  });

  test('a page that stalls while it builds the match does not leave everyone with a long delay', () => {
    const m = new Match();
    const a = m.peer('Alice', 40, 5), b = m.peer('Bob', 40, 5);
    b.noLoad = true;
    m.setupRoom({ mode: '1v1', size: 64, startUnits: 'light' }, [], 4000);
    m.net.links.get('Bob')!.extra = 1500; // Bob's page is still building the match: it answers heartbeats seconds late
    m.until(() => false, 12_000);
    m.net.links.get('Bob')!.extra = 0;
    b.session!.loaded(); // first frame
    m.until(() => m.minTick() >= 200, 60_000);
    m.until(() => false, 10_000);
    assert.ok(a.session!.ls.delay <= 3, `back to a short delay within seconds of the start (${a.session!.ls.delay} ticks)`);
  });
});

