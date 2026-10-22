// Multiplayer lockstep (src/net + server/src/relay.ts): headless clients on a virtual network play through an
// in-process relay and must stay in sync - with latency and jitter, induced delay, dropped connections, a page
// reload that re-simulates the match, stalled players handed to the AI, and a deliberate desync.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Match, replayExecuted, worldHash, type Peer } from './net-harness';
import { MAX_DELAY, NET_HASH_EVERY } from '../src/net/protocol';
import { NetClient } from '../src/net/client';
import { BUILD_FINGERPRINT } from '../src/net/fingerprint';
import { dsin, dcos, datan2, dpow, dlog2, dhypot, dexp, dlog, withPortableMath, portableMathOn, exitPortableMath, enterPortableMath } from '../src/net/dmath';

const MIN5 = 20 * 60 * 5;

/** The hashes every peer reported, by tick, must agree. Returns how many ticks were compared. */
function assertInSync(peers: Peer[], upTo: number): number {
  let compared = 0;
  for (let t = NET_HASH_EVERY; t <= upTo; t += NET_HASH_EVERY) {
    const hs = peers.filter((p) => p.session && !p.session.ls.watching).map((p) => p.session!.ls.hashes.find((h) => h[0] === t)?.[1]).filter((h): h is string => !!h);
    if (hs.length < 2) continue;
    compared++;
    assert.ok(hs.every((h) => h === hs[0]), `hashes agree at tick ${t}: ${hs.join(' ')}`);
  }
  return compared;
}

describe('lockstep through the relay', () => {
  test('two players, five simulated minutes: in sync, and the executed stream replays to the same state', () => {
    const m = new Match();
    const a = m.peer('Alice', 40, 10), b = m.peer('Bob', 90, 25);
    m.setupRoom({ mode: '1v1', rules: 'commander', size: 64, startUnits: 'mcv' });
    assert.ok(m.until(() => m.minTick() >= MIN5, 400_000), `reached five minutes (at ${m.minTick()})`);
    assert.equal(a.world!.tick >= MIN5 && b.world!.tick >= MIN5, true, 'both simulated five minutes');
    assert.equal(worldHash(a.world!) === worldHash(b.world!) || a.world!.tick !== b.world!.tick, true, 'same state at the same tick');
    const compared = assertInSync(m.peers, MIN5);
    assert.ok(compared >= 10, `hash reports compared (${compared})`);
    assert.equal(a.session!.desync, null, 'no desync');
    assert.equal(m.relay.stats.desyncs, 0, 'relay saw no desync');
    assert.ok(a.executed.length > 40, `commands executed (${a.executed.length})`);
    assert.deepEqual(a.executed, b.executed, 'both executed the same commands at the same ticks');
    assert.ok(a.executed.some(([, c]) => c.player === 0) && a.executed.some(([, c]) => c.player === 1), 'both players issued commands');
    assert.ok(a.world!.buildings.filter((x) => x.owner.id === 0).length >= 3 && a.world!.buildings.filter((x) => x.owner.id === 1).length >= 3, 'both built a base');
    // the recorded stream is a replay of the match
    const hashA = a.session!.ls.hashes.find((h) => h[0] === MIN5)![1];
    assert.equal(replayExecuted(a, MIN5), hashA, 'replaying the executed commands reproduces the match');
    // real-time pace: about 20 ticks a second of (virtual) time
    const secs = (m.clock.t - 1_000_000) / 1000;
    assert.ok(secs > MIN5 / 20 && secs < MIN5 / 20 + 20, `paced in real time (${secs.toFixed(1)} s for ${MIN5} ticks)`);
    const d = a.session!.ls.delay;
    assert.ok(d >= 2 && d <= 5, `input delay within 100-250 ms (${d * 50} ms)`);
  });

  test('four players (2 vs 2), five simulated minutes: in sync', () => {
    const m = new Match();
    const ps = [m.peer('Ann', 30, 5), m.peer('Ben', 70, 20), m.peer('Cat', 120, 30), m.peer('Dan', 50, 10)];
    m.setupRoom({ mode: '2v2', rules: 'classic', size: 80, startUnits: 'light' });
    const w = ps[0].world!;
    assert.deepEqual(w.players.map((p) => p.team), [0, 0, 1, 1], 'teams of two');
    assert.ok(w.players.every((p) => p.isHuman), 'four humans');
    assert.ok(m.until(() => m.minTick() >= MIN5, 400_000), `reached five minutes (at ${m.minTick()})`);
    assert.ok(assertInSync(ps, MIN5) >= 10, 'hashes compared');
    assert.equal(m.relay.stats.desyncs, 0, 'no desync');
    for (const p of ps.slice(1)) assert.deepEqual(p.executed, ps[0].executed, `${p.name} executed the same stream`);
    assert.ok(new Set(ps[0].executed.map(([, c]) => c.player)).size === 4, 'all four players issued commands');
  });

  test('co-op against an AI: the AI runs on every client and stays in sync', () => {
    const m = new Match();
    const ps = [m.peer('Ann', 30, 5), m.peer('Ben', 60, 10)];
    m.setupRoom({ mode: 'coop', rules: 'commander', size: 80, startUnits: 'mcv' }, [{ slot: 3, ai: 'hard' }]);
    const w = ps[0].world!;
    assert.equal(w.players.length, 3, 'two players and an AI');
    assert.deepEqual(w.players.map((p) => p.team), [0, 0, 1], 'players together against the AI');
    assert.equal(w.ais.length, 1, 'one AI controller');
    assert.ok(m.until(() => m.minTick() >= 20 * 150, 300_000), 'played 2.5 minutes');
    assert.ok(assertInSync(ps, 20 * 150) >= 5, 'in sync');
    assert.equal(worldHash(ps[0].world!) === worldHash(ps[1].world!) || ps[0].world!.tick !== ps[1].world!.tick, true, 'same state');
  });

  test('induced packet delay: the input delay adapts, the match stays in sync', () => {
    const m = new Match();
    const a = m.peer('Alice', 30, 5), b = m.peer('Bob', 30, 5);
    m.setupRoom({ mode: '1v1', size: 64 });
    m.until(() => m.minTick() >= 600, 60_000);
    const before = a.session!.ls.delay;
    m.net.links.get('Bob')!.extra = 160; // +160 ms each way
    m.net.links.get('Bob')!.jitter = 60;
    m.until(() => m.minTick() >= 1400, 120_000);
    const during = a.session!.ls.delay;
    m.net.links.get('Bob')!.extra = 0;
    m.net.links.get('Bob')!.jitter = 5;
    assert.ok(m.until(() => m.minTick() >= 2600, 120_000), 'kept playing');
    const after = a.session!.ls.delay;
    assert.ok(during > before, `delay grew under lag (${before} -> ${during} ticks)`);
    assert.ok(during >= 8 && during <= MAX_DELAY, `covers the ~400 ms round trip (${during * 50} ms), within the cap`);
    assert.ok(after < during, `and came back down (${after})`);
    assert.ok(assertInSync(m.peers, 2600) >= 20, 'in sync throughout');
    assert.deepEqual(a.executed, b.executed, 'same command stream');
  });

  test('a dropped connection reconnects and resumes at the last confirmed tick', () => {
    const m = new Match({ reconnectGraceMs: 60_000 });
    const a = m.peer('Alice', 40, 5), b = m.peer('Bob', 40, 5);
    m.setupRoom({ mode: '1v1', size: 64 });
    m.until(() => m.minTick() >= 1200, 120_000);
    const lostAt = b.world!.tick;
    m.net.links.get('Bob')!.up = false;
    b.client.simulateDrop();
    m.until(() => b.client.state === 'reconnecting', 2000);
    assert.equal(b.client.state, 'reconnecting', 'client noticed and is reconnecting');
    m.until(() => false, 4000); // 4 s offline: everybody waits (the relay holds the tick)
    assert.ok(a.world!.tick <= lostAt + 40, `the match waited for Bob (${a.world!.tick} vs ${lostAt})`);
    assert.ok(a.session!.stall && a.session!.stall.gone, 'the others are told who they wait for');
    m.net.links.get('Bob')!.up = true;
    assert.ok(m.until(() => b.client.state === 'open', 15_000), 'reconnected');
    assert.ok(m.until(() => m.minTick() >= 2400, 120_000), 'match continued');
    assert.equal(a.session!.stall, null, 'stall cleared');
    assert.equal(b.drops.length, 0, 'nobody was replaced by the AI');
    assert.ok(assertInSync(m.peers, 2400) >= 20, 'in sync after the reconnect');
    assert.deepEqual(a.executed, b.executed, 'same command stream');
  });

  test('a reloaded page re-simulates the match from the relay\'s buffer and catches up', () => {
    const m = new Match();
    const a = m.peer('Alice', 40, 5), b = m.peer('Bob', 40, 5);
    m.setupRoom({ mode: '1v1', size: 64 });
    m.until(() => m.minTick() >= 1500, 150_000);
    // Bob's tab reloads: the old page is gone, a new one resumes the seat with the saved code and token
    const { code, token } = b.client;
    b.running = false;
    b.client.leave = () => {}; // (the old page just vanishes)
    b.client.simulateDrop();
    const b2 = m.peer('Bob', 40, 5);
    b2.client = new NetClient({ url: 'ws://relay', name: 'Bob', build: BUILD_FINGERPRINT, mods: '', socket: m.net.socket('Bob'), timers: m.clock.timers });
    b2.client.on((msg) => { if (msg.t === 'welcome' && msg.resume && !b2.session) m.begin(b2, msg.resume.start, true); });
    m.peers.splice(m.peers.indexOf(b), 1);
    b2.client.resume(code, token);
    assert.ok(m.until(() => !!b2.session && b2.world!.tick >= a.world!.tick - 10 && !b2.session.catchingUp, 60_000), `caught up (${b2.world?.tick} / ${a.world!.tick})`);
    assert.ok(m.until(() => m.minTick() >= 2600, 120_000), 'kept playing together');
    assert.ok(assertInSync([a, b2], 2600) >= 20, 'in sync after the reload');
  });

  test('a player who does not come back is replaced by the AI on every client at the same tick', () => {
    const m = new Match({ reconnectGraceMs: 10_000 });
    const a = m.peer('Alice', 40, 5), b = m.peer('Bob', 40, 5), c = m.peer('Cat', 40, 5);
    m.setupRoom({ mode: 'ffa', size: 80 });
    m.until(() => m.minTick() >= 800, 100_000);
    m.net.links.get('Cat')!.up = false;
    c.client.simulateDrop();
    c.running = false;
    assert.ok(m.until(() => a.drops.length > 0 && b.drops.length > 0, 30_000), 'dropped after the grace period');
    assert.deepEqual(a.drops, b.drops, 'same takeover tick and player on both clients');
    assert.equal(a.drops[0][1], 2, 'the third player');
    assert.ok(a.world!.ais.some((ai) => ai.player.id === 2), 'an AI plays the dropped side');
    assert.ok(!a.world!.players[2].isHuman, 'no longer human');
    assert.ok(m.until(() => Math.min(a.world!.tick, b.world!.tick) >= 2400, 150_000), 'the match goes on');
    assert.ok(assertInSync([a, b], 2400) >= 20, 'in sync');
    const h = a.session!.ls.hashes.find((x) => x[0] === 2400)![1];
    assert.equal(replayExecuted(a, 2400), h, 'the replay applies the takeover too');
  });

  test('a stalled (frozen) player can be dropped by the others', () => {
    const m = new Match({ dropVoteMs: 5000, autoDropMs: 600_000 });
    const a = m.peer('Alice', 40, 5), b = m.peer('Bob', 40, 5);
    m.setupRoom({ mode: '1v1', size: 64 });
    m.until(() => m.minTick() >= 600, 60_000);
    b.running = false; // connected (heartbeats answered) but the game is frozen
    assert.ok(m.until(() => !!a.session!.stall, 10_000), 'stall noticed');
    assert.equal(a.session!.stall!.name, 'Bob', 'names who everyone waits for');
    assert.equal(a.session!.stall!.gone, false, 'still connected');
    m.until(() => !!a.session!.stall?.canDrop, 10_000);
    assert.ok(a.session!.stall?.canDrop, 'the drop becomes available');
    a.session!.dropStalled();
    assert.ok(m.until(() => a.drops.length > 0 && a.world!.tick > 900, 60_000), 'replaced by the AI and the match went on');
    assert.ok(a.world!.ais.some((ai) => ai.player.id === 1), 'AI plays Bob');
  });

  test('a desync is detected, both clients stop and get the tick and both hashes', () => {
    const m = new Match();
    const a = m.peer('Alice', 40, 5), b = m.peer('Bob', 40, 5);
    m.setupRoom({ mode: '1v1', size: 64 });
    m.until(() => a.world!.tick >= 1050, 100_000);
    a.world!.players[0].cash += 1; // a bug or a tampered client: Alice's world differs from now on
    assert.ok(m.until(() => !!a.session!.desync && !!b.session!.desync, 30_000), 'desync reported to both');
    const d = a.session!.desync!;
    assert.equal(d.tick % NET_HASH_EVERY, 0, 'at a hash report');
    assert.ok(d.tick > 1050 && d.tick <= 1200, `the first report after the change (${d.tick})`);
    assert.equal(d.hashes.length, 2, 'both hashes');
    assert.notEqual(d.hashes[0][1], d.hashes[1][1], 'and they differ');
    assert.equal(d.mine, a.session!.ls.hashAt(d.tick), 'the client knows its own hash');
    const ta = a.world!.tick, tb = b.world!.tick;
    m.until(() => false, 3000);
    assert.equal(a.world!.tick, ta, 'Alice stopped');
    assert.equal(b.world!.tick, tb, 'Bob stopped');
    assert.equal(a.session!.ls.status, 'desync', 'session state');
    assert.equal(m.relay.stats.desyncs, 1, 'counted once');
  });

  test('commands that claim another player run as the sender, malformed ones are dropped on every client', () => {
    const m = new Match();
    const a = m.peer('Alice', 30, 5, false), b = m.peer('Bob', 30, 5, false);
    m.setupRoom({ mode: '1v1', size: 64, startUnits: 'light' });
    m.until(() => m.minTick() >= 20, 10_000);
    const w = a.world!;
    const alice = w.units.filter((u) => u.owner.id === 0).map((u) => u.id);
    const bob = w.units.filter((u) => u.owner.id === 1).map((u) => u.id);
    // Bob's client tries to move Alice's units (player: 0), and sends junk
    const t = b.world!.tick + 5;
    b.client.send({ t: 'in', upTo: t, cmds: [
      [t, { c: 'move', player: 0, units: alice, x: 1, y: 1 }],
      [t, { c: 'move', player: 1, units: bob, x: 'x' }],
      [t, { c: 'build', player: 1, type: 'nonexistent' }],
      [t, { c: 'cancel', player: 1, type: 'powr', all: 'yes' }],
      [t, { c: 'move', player: 1, units: bob, x: 20.5, y: 20.5 }],
    ] });
    m.until(() => m.minTick() >= t + 30, 10_000);
    assert.ok(alice.every((id) => { const u = a.world!.getEntity(id); return !!u && u.order.type !== 'move'; }), 'Alice\'s units ignored the forged order');
    assert.ok(bob.some((id) => a.world!.getEntity(id)?.order.type === 'move' || Math.hypot(a.world!.getEntity(id)!.x - 20.5, a.world!.getEntity(id)!.y - 20.5) < 3), 'Bob\'s valid order ran');
    assert.equal(a.session!.ls.rejected, 3, 'three malformed commands dropped');
    assert.equal(b.session!.ls.rejected, 3, 'the same on the other client');
    assert.equal(worldHash(a.world!) === worldHash(b.world!) || a.world!.tick !== b.world!.tick, true, 'still in sync');
  });
});

describe('portable math (the same results on every engine)', () => {
  test('within about an ulp of the engine on the simulation\'s ranges', () => {
    let seed = 7;
    const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
    exitPortableMath(); // (the harness keeps it on: compare with the engine's own)
    try {
      const rel = (a: number, b: number) => (a === b ? 0 : Math.abs(a - b) / Math.max(Math.abs(b), 1e-300));
      let worst = 0;
      for (let i = 0; i < 20000; i++) {
        const a = (rnd() - 0.5) * 2000, b = (rnd() - 0.5) * 300, c = rnd() * 3;
        worst = Math.max(worst, rel(dsin(a), Math.sin(a)), rel(dcos(a), Math.cos(a)), rel(datan2(a, b), Math.atan2(a, b)), rel(dhypot(a, b), Math.hypot(a, b)),
          rel(dexp(b / 10), Math.exp(b / 10)), rel(dlog(c + 1e-9), Math.log(c + 1e-9)), rel(dlog2(c + 1e-9), Math.log2(c + 1e-9)) / 4, rel(dpow(c, b / 100), Math.pow(c, b / 100)) / 10);
      }
      assert.ok(worst < 5e-16, `close to the engine (worst relative difference ${worst.toExponential(2)})`);
      assert.equal(datan2(0, -1), Math.PI, 'atan2 edge cases');
      assert.equal(datan2(-0, -1), -Math.PI, 'atan2 signed zero');
      assert.ok(Object.is(dsin(-0), -0), 'sin(-0)');
      assert.equal(dpow(2, 10), 1024, 'exact integer powers');
      assert.equal(dpow(9, 0.5), 3, 'square roots');
      assert.ok(Number.isNaN(dpow(-8, 1 / 3)), 'negative base, fractional power');
      assert.equal(dlog2(1024), 10, 'exact log2 of powers of two');
    } finally {
      enterPortableMath();
    }
  });

  test('swapped into Math only while asked, and nested safely', () => {
    exitPortableMath();
    try {
      const nativeSin = Math.sin;
      assert.equal(portableMathOn(), false, 'off');
      withPortableMath(() => {
        assert.equal(Math.sin, dsin, 'on inside');
        withPortableMath(() => assert.equal(Math.atan2, datan2, 'nested'));
        assert.equal(Math.sin, dsin, 'still on after the nested call');
      });
      assert.equal(Math.sin, nativeSin, 'restored');
    } finally {
      enterPortableMath();
    }
  });
});
