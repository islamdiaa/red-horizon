// What matches hold on the relay (server/src/relay.ts) is bounded in bytes: every command a match keeps - its log for
// reconnects and catch-up, and the commands waiting for their tick - counts at its JSON text plus its entry (cmdBytes).
// A match at its budget ends ("The match log is full."); at the budget of all rooms the match holding the most ends
// ("The server is full. Try again later."); command bytes per connection are rate-limited like messages. A normal
// match is unaffected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match, VClock, VNet, makeRelay, replayExecuted, worldHash } from './net-harness';
import { NET_HASH_EVERY, NET_PROTOCOL, type ServerMessage } from '../src/net/protocol';
import { RELAY_ERRORS } from '../src/net/reasons';
import { BUILD_FINGERPRINT } from '../src/net/fingerprint';
import { DEFAULT_LIMITS, cmdBytes, type Relay } from '../server/src/relay';
import { loadConfig } from '../server/src/config';

const MB = 1 << 20;

/** A protocol-level player on the virtual network: answers heartbeats, follows the closed tick, sends what it is told. */
function player(net: VNet, link: string) {
  const sock = net.socket(link)('ws://relay');
  const p = {
    code: '', started: false, closed: -1, reason: '', gone: false, errors: [] as string[],
    /** cmdBytes of the closed commands received (what the relay logged). */
    logged: 0,
    send: (m: unknown) => sock.send(JSON.stringify(m)),
  };
  sock.onmessage = (ev) => {
    const m = JSON.parse(ev.data as string) as ServerMessage;
    if (m.t === 'welcome') p.code = m.code;
    else if (m.t === 'start') p.started = true;
    else if (m.t === 'ping') p.send({ t: 'pong', n: m.n });
    else if (m.t === 'tick') { p.closed = Math.max(p.closed, m.to); for (const c of m.cmds) p.logged += cmdBytes(JSON.stringify(c[2])); }
    else if (m.t === 'closed') p.reason = m.reason;
    else if (m.t === 'error') p.errors.push(m.code);
  };
  sock.onclose = () => { p.gone = true; };
  return p;
}
type Player = ReturnType<typeof player>;

const hello = (x: Record<string, unknown>) => ({ t: 'hello', proto: NET_PROTOCOL, build: BUILD_FINGERPRINT, mods: '', name: 'P', ...x });

/** A 1v1 match between two players on one link (one address). */
function startMatch(clock: VClock, relay: Relay, net: VNet, link: string): [Player, Player] {
  const a = player(net, link), b = player(net, link);
  clock.advance(100);
  a.send(hello({ create: { settings: { mode: '1v1' } } }));
  clock.advance(100);
  b.send(hello({ join: a.code }));
  clock.advance(100);
  b.send({ t: 'me', ready: true });
  clock.advance(100);
  a.send({ t: 'start' });
  clock.advance(100);
  for (const p of [a, b]) p.send({ t: 'loaded' });
  assert.ok(a.started && b.started, `the match started (${a.errors} ${b.errors})`);
  return [a, b];
}

/** A valid order naming 400 units (about 3.3 KB of JSON). */
const BIG = { c: 'move', units: Array.from({ length: 400 }, (_, i) => 1_000_000 + i * 17), x: 10.5, y: 20.25 };
/** Commit a little ahead and send a big order for the tick after. */
const bigFrame = (p: Player) => ({ t: 'in', upTo: p.closed + 2, cmds: [[p.closed + 3, BIG]] });

/**
 * Run `ms` of virtual time: each player in `send` sends `perSec` frames a second (`frame`), the others only keep
 * committing; the relay ticks every 250 ms. Calls `sample` after every relay tick.
 */
function run(clock: VClock, relay: Relay, ms: number, send: Player[], perSec: number, idle: Player[], sample: () => void, frame = bigFrame) {
  const end = clock.t + ms, every = 1000 / perSec;
  let next = clock.t, tick = clock.t + 250;
  while (clock.t < end) {
    const at = Math.min(next, tick);
    clock.advance(at - clock.t);
    if (at === tick) { relay.tick(); tick += 250; sample(); }
    if (at === next) {
      for (const p of send) if (!p.gone) p.send(frame(p));
      for (const p of idle) if (!p.gone) p.send({ t: 'in', upTo: p.closed + 2, cmds: [] });
      next += every;
    }
  }
}

test('commands over the per-connection byte rate are refused, and a connection that keeps sending them is closed', () => {
  const clock = new VClock();
  const relay = makeRelay(clock);
  const net = new VNet(clock, relay);
  const [a, b] = startMatch(clock, relay, net, 'one');
  const t0 = clock.t;
  let most = 0, closedAt = 0;
  // large orders at the message rate (59 a second, about 200 KB/s per connection)
  run(clock, relay, 20_000, [a, b], 59, [], () => { most = Math.max(most, relay.heldBytes); if (a.gone && b.gone && !closedAt) closedAt = clock.t; });
  assert.ok(a.gone && b.gone && closedAt - t0 <= 10_000, `both connections were closed within seconds (${(closedAt - t0) / 1000} s)`);
  assert.ok(most <= 2 * (DEFAULT_LIMITS.cmdByteBurst + 10 * DEFAULT_LIMITS.cmdByteRate), `the match held at most the bursts and those seconds of the rate (${(most / MB).toFixed(2)} MB)`);
});

test('a match that keeps sending large orders ends at its byte budget: everyone is told why, and its commands are freed', () => {
  const clock = new VClock();
  const relay = makeRelay(clock);
  const net = new VNet(clock, relay);
  const [a, b] = startMatch(clock, relay, net, 'one');
  const budget = DEFAULT_LIMITS.maxMatchBytes;
  let most = 0, samples = 0;
  // within the byte rate (19 orders of about 3.4 KB a second each): nothing is refused, the match only grows
  run(clock, relay, 15 * 60_000, [a, b], 19, [], () => { most = Math.max(most, relay.heldBytes); samples++; });
  assert.equal(a.reason, RELAY_ERRORS.logFull, `the host was told the match log is full (${a.reason})`);
  assert.equal(b.reason, RELAY_ERRORS.logFull, `the guest too (${b.reason})`);
  assert.ok(a.gone && b.gone, 'and their connections closed');
  assert.ok(most <= budget, `never more than the budget held (${(most / MB).toFixed(1)} of ${budget / MB} MB)`);
  assert.ok(most > budget * 0.95 && a.logged > budget * 0.9, `it ended full, not early (${(most / MB).toFixed(1)} MB held, ${(a.logged / MB).toFixed(1)} MB closed)`);
  assert.ok(samples > 1000, `sampled throughout (${samples})`);
  assert.equal(relay.heldBytes, 0, 'the match\'s commands were freed');
  assert.equal(relay.roomCount, 0, 'with its room');
  // the relay goes on: a new match starts on it
  const [c] = startMatch(clock, relay, net, 'two');
  assert.ok(c.started && !c.gone, 'a new match starts afterwards');
});

test('at the budget of all rooms the match holding the most ends; the others play on', () => {
  const clock = new VClock();
  const relay = makeRelay(clock, { maxMatchBytes: 3 * MB, maxTotalBytes: 4 * MB });
  const net = new VNet(clock, relay);
  const [a1, a2] = startMatch(clock, relay, net, 'a');
  const [b1, b2] = startMatch(clock, relay, net, 'b');
  let most = 0;
  const sample = () => { most = Math.max(most, relay.heldBytes); };
  // the first match grows to about 2.5 MB, then only commits
  run(clock, relay, 28_000, [a1, a2], 14, [b1, b2], sample);
  const big = relay.heldBytes;
  assert.ok(big > 2.4 * MB && big < 3 * MB, `the first match holds ${(big / MB).toFixed(2)} MB`);
  // the second grows past what is left
  run(clock, relay, 20_000, [b1, b2], 14, [a1, a2], sample);
  assert.equal(a1.reason, RELAY_ERRORS.busy, `the match holding the most ended (${a1.reason})`);
  assert.equal(a2.reason, RELAY_ERRORS.busy, `for both its players (${a2.reason})`);
  assert.ok(!b1.gone && !b2.gone && b1.reason === '' && b2.errors.length === 0, `the other match plays on (${b1.reason} ${b2.errors})`);
  assert.ok(most <= 4 * MB, `never more than the relay's budget held (${(most / MB).toFixed(2)} MB)`);
  assert.equal(relay.roomCount, 1, 'one room left');
  assert.ok(relay.heldBytes >= b1.logged && relay.heldBytes < 3 * MB, `what is held is the second match's (${relay.heldBytes} vs ${b1.logged} closed)`);
});

test('a normal four-player match is unaffected, and what it holds is exactly what it logged', () => {
  const m = new Match();
  const ps = [m.peer('Ann', 30, 5), m.peer('Ben', 60, 10), m.peer('Cat', 40, 5), m.peer('Dan', 90, 20)];
  m.setupRoom({ mode: '2v2', size: 64, startUnits: 'light', credits: 5000 });
  assert.ok(m.until(() => m.minTick() >= 2400, 240_000), `two minutes played (${m.minTick()})`);
  // a reconnect: its catch-up comes from the log
  ps[1].client.simulateDrop();
  assert.ok(m.until(() => ps[1].client.state === 'reconnecting', 5000), 'Ben reconnects');
  assert.ok(m.until(() => ps[1].client.state === 'open' && m.minTick() >= 4800, 240_000), `Ben is back and the match goes on (${m.minTick()})`);
  for (const p of ps) {
    assert.equal(p.client.endReason, '', `${p.name} still connected`);
    assert.equal(p.session!.ls.status, 'live', `${p.name}'s match is live`);
  }
  const t = Math.floor(m.minTick() / NET_HASH_EVERY) * NET_HASH_EVERY;
  const hs = ps.map((p) => p.session!.ls.hashAt(t));
  assert.ok(hs[0] && hs.every((h) => h === hs[0]), `in sync at tick ${t}: ${hs.join(' ')}`);
  // held = the log (what Ann received) + the few commands waiting for their tick
  let logged = 0;
  for (const msg of ps[0].messages) if (msg.t === 'tick') for (const c of msg.cmds) logged += cmdBytes(JSON.stringify(c[2]));
  const held = m.relay.heldBytes;
  assert.ok(logged > 0 && held >= logged && held - logged < 64 << 10, `held ${held} bytes for ${logged} logged`);
  assert.ok(held < DEFAULT_LIMITS.maxMatchBytes / 500, `far below the budget (${(held / MB).toFixed(3)} MB)`);
  // a surrender frees that player's waiting commands; the room going back to its lobby frees the rest
  ps[3].session!.ls.resign();
  assert.ok(m.until(() => ps[3].session!.ls.watching, 10_000), 'Dan surrendered');
  for (const p of ps) p.client.send({ t: 'over', tick: p.world!.tick, winner: 0 });
  assert.ok(m.until(() => ps[0].client.room?.phase === 'over', 5000), 'the match is over');
  ps[0].client.send({ t: 'lobby' });
  assert.ok(m.until(() => ps[0].client.room?.phase === 'lobby', 5000), 'back in the lobby');
  assert.equal(m.relay.heldBytes, 0, 'nothing held once the match is gone');
});

test('a match ended for its log: the players are told why, can play on against the AI, and their replays hold every order that ran', () => {
  const m = new Match({ maxMatchBytes: 24 << 10 }); // (about four minutes of these players)
  const a = m.peer('Alice', 40, 5), b = m.peer('Bob', 60, 10);
  m.setupRoom({ mode: '1v1', size: 64, startUnits: 'light' });
  assert.ok(m.until(() => a.client.state === 'closed' && b.client.state === 'closed', 600_000), `the match ended (tick ${m.minTick()})`);
  for (const p of [a, b]) {
    assert.equal(p.client.endReason, RELAY_ERRORS.logFull, `${p.name} was told why (${p.client.endReason})`);
    assert.equal(p.session!.ls.status, 'live', `${p.name}'s match is frozen, not over: it can go on offline`);
  }
  assert.equal(m.relay.heldBytes, 0, 'the relay freed its commands');
  assert.ok(a.executed.length > 0, `orders ran before the end (${a.executed.length})`);
  const t = Math.min(a.world!.tick, b.world!.tick);
  assert.deepEqual(a.executed.filter(([x]) => x < t), b.executed.filter(([x]) => x < t), 'both ran the same orders');
  assert.equal(replayExecuted(a, a.world!.tick), worldHash(a.world!), 'the replay reproduces the match up to the end');
  assert.ok(a.session!.ls.goOffline(), 'Alice can play on against the AI');
});

test('the budgets are set in MB by environment variables, within bounds; the defaults are the relay\'s', () => {
  const d = loadConfig({}).limits;
  assert.equal(d.maxMatchBytes, DEFAULT_LIMITS.maxMatchBytes, 'per-match default');
  assert.equal(d.maxTotalBytes, DEFAULT_LIMITS.maxTotalBytes, 'all-rooms default');
  const c = loadConfig({ RELAY_MAX_MATCH_LOG_MB: '8', RELAY_MAX_TOTAL_LOG_MB: '0' }).limits;
  assert.equal(c.maxMatchBytes, 8 * MB, 'RELAY_MAX_MATCH_LOG_MB');
  assert.equal(c.maxTotalBytes, 1 * MB, 'RELAY_MAX_TOTAL_LOG_MB is at least 1 MB');
});
