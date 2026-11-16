// A player who resumes a long match - a reconnect, or a page reloaded mid-match - gets the match's closed orders from
// the relay's log at the pace its connection takes them (server/src/relay.ts: pump). Written at once, a log of many MB
// sat in the connection's buffer past the transport's 4 MB cap, and the relay cut the player off right after the
// resume (#19). The closed ticks arrive in order, the backlog then the live ones, with no gap and nothing twice; an
// interrupted catch-up leaves nothing behind; a short resume is as before.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { Match, VClock, VNet, makeRelay, type Peer } from './net-harness';
import { NetClient } from '../src/net/client';
import { BUILD_FINGERPRINT } from '../src/net/fingerprint';
import { RELAY_ERRORS } from '../src/net/reasons';
import { NET_HASH_EVERY, NET_PROTOCOL, type MatchStart, type ServerMessage } from '../src/net/protocol';
import type { ClientHandle, Relay } from '../server/src/relay';

const MB = 1 << 20;

/** A valid order naming 400 units (about 3.2 KB of JSON): four fit in one message. */
const BIG = { c: 'move', units: Array.from({ length: 400 }, (_, i) => 1_000_000 + i * 17), x: 10.5, y: 20.25 };
/** Rate limits that let the tests' players fill a log of many MB within seconds. */
const FAST = { msgRate: 5000, msgBurst: 5000, cmdByteRate: 64 * MB, cmdByteBurst: 64 * MB };
const hello = (x: Record<string, unknown>) => ({ t: 'hello', proto: NET_PROTOCOL, build: BUILD_FINGERPRINT, mods: '', name: 'P', ...x });
/** `n` messages of four big orders each for the tick after next, committing up to the next one. */
const orders = (closed: number, n: number) => Array.from({ length: n }, () => ({ t: 'in', upTo: closed + 2, cmds: Array.from({ length: 4 }, () => [closed + 3, BIG]) }));

interface Player {
  got: ServerMessage[];
  /** The last closed tick it knows of (a resume's, or a `tick` message's), and the last `tick` message's. */
  closed: number;
  to: number;
  code: string;
  token: string;
  gone: boolean;
  send(m: unknown): void;
}

function track(p: Player, m: ServerMessage) {
  p.got.push(m);
  if (m.t === 'welcome') { p.code = m.code; p.token = m.token; if (m.resume) p.closed = Math.max(p.closed, m.resume.closed); }
  else if (m.t === 'start') p.closed = p.to = -1;
  else if (m.t === 'tick') { p.closed = Math.max(p.closed, m.to); p.to = m.to; }
}

/** Commit `lead` ticks past the last closed one (a page catching up commits ahead: it issues nothing meanwhile). */
const commit = (p: Player, lead = 2) => { if (!p.gone) p.send({ t: 'in', upTo: p.closed + lead, cmds: [] }); };

/** A protocol-level player on the virtual network: answers heartbeats, keeps every message. */
function player(net: VNet, link: string) {
  const sock = net.socket(link)('ws://relay');
  const p: Player & { close(): void } = {
    got: [], closed: -1, to: -1, code: '', token: '', gone: false,
    send: (m) => sock.send(JSON.stringify(m)),
    close: () => sock.close(),
  };
  sock.onmessage = (ev) => {
    const m = JSON.parse(ev.data as string) as ServerMessage;
    track(p, m);
    if (m.t === 'ping') p.send({ t: 'pong', n: m.n });
  };
  sock.onclose = () => { p.gone = true; };
  return p;
}

/**
 * A connection straight to the relay with a transport buffer the test controls, as a slow reader's: what the relay
 * sends waits there until `drain` writes it out, and the transport then tells the relay (as the WebSocket transport
 * does), unless `quiet`. It answers heartbeats.
 */
function paced(relay: Relay, clock: VClock, ip: string) {
  const queue: { left: number; sent?: () => void }[] = [];
  let handle: ClientHandle | null = null;
  const p = {
    got: [] as ServerMessage[], closed: -1, to: -1, code: '', token: '', gone: false,
    /** Bytes waiting in the buffer now, and the most ever. */
    held: 0, most: 0,
    /** Messages the relay sent after it closed the connection, or after the client did. */
    late: 0,
    send: (m: unknown) => { if (!p.gone) handle?.message(JSON.stringify(m)); },
    /** Write out up to `bytes` of what waits (a message can go out in parts, as on a socket). */
    drain(bytes = Infinity, quiet = false) {
      const told: (() => void)[] = [];
      while (queue.length && bytes > 0) {
        const q = queue[0], n = Math.min(bytes, q.left);
        q.left -= n;
        bytes -= n;
        p.held -= n;
        if (q.left > 0) break;
        queue.shift();
        if (q.sent && !quiet) told.push(q.sent);
      }
      for (const f of told) f();
    },
    /** The client's end goes (a dropped link, a closed tab). */
    close() { p.gone = true; handle?.close(); },
  };
  handle = relay.connect({
    send: (text, sent) => {
      if (p.gone) { p.late++; return; }
      const m = JSON.parse(text) as ServerMessage;
      track(p, m);
      p.held += text.length;
      p.most = Math.max(p.most, p.held);
      queue.push({ left: text.length, sent });
      if (m.t === 'ping') clock.at(clock.t + 1, () => p.send({ t: 'pong', n: m.n }));
    },
    close: () => { p.gone = true; },
    buffered: () => p.held,
  }, ip);
  return p;
}

/**
 * What a connection's `tick` messages carry, checked to follow on from each other: each covers the ticks after the
 * last one's `to` and up to its own, with the commands and drops of those ticks only (no gap, nothing twice).
 */
function stream(got: ServerMessage[], from = -1) {
  let to = from, bad = 0, bytes = 0;
  const cmds: string[] = [], drops: string[] = [];
  for (const m of got) {
    if (m.t !== 'tick') continue;
    if (m.to <= to) bad++;
    for (const c of m.cmds) { if (c[0] <= to || c[0] > m.to) bad++; const s = JSON.stringify(c); bytes += s.length; cmds.push(s); }
    for (const d of m.drops ?? []) { if (d[0] <= to || d[0] > m.to) bad++; drops.push(String(d)); }
    to = m.to;
  }
  assert.equal(bad, 0, `tick messages follow on from each other (${bad} out of place)`);
  return { text: cmds.join('\n'), n: cmds.length, bytes, drops: drops.join(' '), to };
}
type Stream = ReturnType<typeof stream>;

const sameStream = (got: Stream, want: Stream, what: string) => {
  assert.equal(got.n, want.n, `${what}: as many commands (${got.n} of ${want.n})`);
  assert.ok(got.text === want.text, `${what}: the same commands in the same order`);
  assert.equal(got.drops, want.drops, `${what}: the same takeovers`);
  assert.equal(got.to, want.to, `${what}: up to the same tick`);
};

const ticks = (got: ServerMessage[]) => got.filter((m): m is Extract<ServerMessage, { t: 'tick' }> => m.t === 'tick');
const welcomeOf = (got: ServerMessage[]) => got.find((m): m is Extract<ServerMessage, { t: 'welcome' }> => m.t === 'welcome')!;
const lastRoom = (got: ServerMessage[]) => got.filter((m): m is Extract<ServerMessage, { t: 'room' }> => m.t === 'room').pop()?.room;

/**
 * A free-for-all of three protocol players: the third leaves early (the AI takes over: a takeover in the log), the
 * other two fill the log with `mb` MB of big orders, then the second one's page goes; its seat waits for a resume.
 */
function longMatch(mb: number, limits: Record<string, number> = {}) {
  const clock = new VClock();
  const relay = makeRelay(clock, { ...FAST, ...limits });
  const net = new VNet(clock, relay);
  let steps = 0;
  /** Virtual time in 50 ms steps, `step` (the players) first in each; the relay ticks every 250 ms. */
  const run = (ms: number, step: () => void = () => {}) => {
    for (let t = 0; t < ms; t += 50) { step(); clock.advance(50); if (++steps % 5 === 0) relay.tick(); }
  };
  const until = (done: () => boolean, ms: number, step?: () => void) => {
    for (let t = 0; t < ms && !done(); t += 50) run(50, step);
    return done();
  };
  const [a, b, c] = ['a', 'b', 'c'].map((n) => player(net, n));
  run(100);
  a.send(hello({ create: { settings: { mode: 'ffa' } } }));
  run(100);
  for (const p of [b, c]) { p.send(hello({ join: a.code })); run(100); p.send({ t: 'me', ready: true }); }
  run(100);
  a.send({ t: 'start' });
  run(100);
  for (const p of [a, b, c]) p.send({ t: 'loaded' });
  run(1000, () => { for (const p of [a, b, c]) commit(p); });
  c.send({ t: 'bye' });
  run(500, () => { for (const p of [a, b]) commit(p); });
  assert.ok(until(() => relay.heldBytes >= mb * MB, 120_000, () => { for (const p of [a, b]) for (const o of orders(p.closed, 2)) p.send(o); }), `the log grew to ${mb} MB`);
  run(500, () => { for (const p of [a, b]) commit(p); });
  b.close();
  run(500, () => commit(a));
  assert.ok(stream(a.got).drops.length > 0, 'the log holds a takeover');
  return { clock, relay, net, run, until, a, b };
}
type Long = ReturnType<typeof longMatch>;

/** B's seat back on a slow connection (a reloaded page has nothing: `have` -1). */
function resume(L: Long, ip = '10.9.9.9', have = -1) {
  const r = paced(L.relay, L.clock, ip);
  r.send(hello({ resume: { code: L.a.code, token: L.b.token, have } }));
  assert.ok(welcomeOf(r.got)?.resume, 'resumed in the match');
  return r;
}

describe('relay: catching up after a resume', () => {
  test('a long match\'s log goes out as fast as the connection takes it, never all at once', () => {
    const L = longMatch(6);
    const all = stream(L.a.got);
    const r = resume(L);
    const W = welcomeOf(r.got).resume!.closed;
    assert.ok(all.bytes > 5 * MB && W === all.to, `a log of ${(all.bytes / MB).toFixed(1)} MB up to tick ${W}`);
    assert.ok(r.held > 0.9 * MB && r.held < 1.5 * MB, `the first chunks fill about 1 MB of its buffer (${(r.held / MB).toFixed(2)} MB)`);
    // it reads nothing (a page still building the match): nothing more, however long
    const n = ticks(r.got).length;
    L.run(5000, () => commit(L.a));
    assert.equal(ticks(r.got).length, n, 'nothing more while it reads nothing');
    assert.equal(r.gone, false, 'and it stays connected');
    // its transport writes the buffer out and says so: the next chunks go at once
    r.drain();
    assert.ok(ticks(r.got).length > n, 'written out: the next chunks follow at once');
    // written out without a word: the relay's next tick sends more
    const n2 = ticks(r.got).length;
    r.drain(Infinity, true);
    L.run(250);
    assert.ok(ticks(r.got).length > n2, 'or with the relay\'s next tick');
    // a slow reader, 256 KB every 50 ms: the rest arrives, never more than about 1 MB waiting
    assert.ok(L.until(() => r.to >= W, 60_000, () => { r.drain(256 << 10); commit(L.a); }), `caught up (${r.to} of ${W})`);
    assert.ok(r.most < 1.5 * MB, `never more than about 1 MB waiting for it (${(r.most / MB).toFixed(2)} MB)`);
    sameStream(stream(r.got), all, 'the whole log, in order');
    assert.equal(r.gone, false, 'still connected');
  });

  test('ticks closed during a catch-up come after the backlog, with no gap and nothing twice', () => {
    const L = longMatch(6);
    const r = resume(L);
    const W = welcomeOf(r.got).resume!.closed;
    // the match goes on meanwhile: B commits ahead (a page catching up issues nothing), A orders
    const t0 = L.clock.t;
    let liveAt = -1, backlogDoneAt = -1;
    L.run(8000, () => {
      r.drain(128 << 10);
      commit(r, 30);
      for (const o of orders(L.a.closed, 1)) L.a.send(o);
      if (liveAt < 0 && L.a.closed > W) liveAt = L.clock.t - t0;
      if (backlogDoneAt < 0 && r.to >= W) backlogDoneAt = L.clock.t - t0;
    });
    assert.ok(liveAt >= 0 && backlogDoneAt > liveAt, `ticks closed while B was still catching up (the first ${liveAt} ms in, its backlog done ${backlogDoneAt} ms in)`);
    assert.ok(L.a.closed > W + 40, `the match went on past the resume (${W} -> ${L.a.closed})`);
    // everyone stops; what is closed reaches both
    L.run(1000, () => { r.drain(); commit(L.a); commit(r); });
    L.run(1000, () => r.drain());
    sameStream(stream(r.got), stream(L.a.got), 'B and A');
    assert.ok(r.most < 1.5 * MB, `never more than about 1 MB waiting for B (${(r.most / MB).toFixed(2)} MB)`);
  });

  test('a match that ends mid catch-up ends it: told why, closed, nothing more sent, nothing held', () => {
    const L = longMatch(6, { maxMatchBytes: 8 * MB });
    const r = resume(L);
    const W = welcomeOf(r.got).resume!.closed;
    // B reads slowly and commits ahead; A's orders fill the match's log meanwhile
    assert.ok(L.until(() => r.gone, 60_000, () => { r.drain(32 << 10); commit(r, 30); for (const o of orders(L.a.closed, 2)) L.a.send(o); }), 'the match ended');
    assert.ok(r.to < W, `while B was still catching up (tick ${r.to} of ${W})`);
    assert.ok(r.got.some((m) => m.t === 'closed' && m.reason === RELAY_ERRORS.logFull), 'B was told why');
    const n = r.got.length;
    r.drain();
    L.run(2000);
    assert.equal(r.got.length, n, 'nothing more for B');
    assert.equal(r.late, 0, 'nothing sent after its connection closed');
    assert.equal(L.relay.heldBytes, 0, 'the match\'s commands were freed');
    assert.equal(L.relay.roomCount, 0, 'with its room');
    stream(r.got); // (what did arrive was in order)
  });

  test('a match that finishes mid catch-up: the rest still comes; back in the lobby it stops, and a rematch is live', () => {
    const L = longMatch(6);
    const r = resume(L);
    const W = welcomeOf(r.got).resume!.closed;
    L.run(250, () => r.drain(64 << 10));
    for (const p of [L.a, r]) p.send({ t: 'over', tick: 0, winner: 0 });
    L.run(250, () => r.drain(64 << 10));
    assert.equal(lastRoom(L.a.got)?.phase, 'over', 'the match is over');
    const atOver = ticks(r.got).length;
    L.run(500, () => r.drain(64 << 10));
    assert.ok(ticks(r.got).length > atOver && r.to < W, `the room keeps the ended match: the rest of its log still comes (${r.to} of ${W})`);
    // the host reopens the lobby
    L.a.send({ t: 'lobby' });
    L.run(250);
    assert.equal(lastRoom(r.got)?.phase, 'lobby', 'B is back in the lobby');
    const n = ticks(r.got).length;
    L.run(2000, () => r.drain());
    assert.equal(ticks(r.got).length, n, 'and gets nothing more of the old match');
    assert.equal(L.relay.heldBytes, 0, 'which is freed');
    // a rematch (an AI in the third seat): B gets its ticks live, like A
    L.a.send({ t: 'slot', slot: 2, kind: 'ai', ai: 'easy' });
    L.run(250, () => r.drain());
    r.send({ t: 'me', ready: true });
    L.run(250, () => r.drain());
    L.a.send({ t: 'start' });
    L.run(250, () => r.drain());
    assert.ok(r.got.some((m) => m.t === 'start'), `the rematch started (${L.a.got.filter((m) => m.t === 'error').map((m) => m.t === 'error' && m.code).join(' ')})`);
    for (const p of [L.a, r]) p.send({ t: 'loaded' });
    L.run(3000, () => { r.drain(); commit(L.a); commit(r); });
    const since = (got: ServerMessage[]) => got.slice(got.map((m) => m.t).lastIndexOf('start'));
    const sa = stream(since(L.a.got));
    assert.ok(sa.to >= 40, `the rematch runs (tick ${sa.to})`);
    sameStream(stream(since(r.got)), sa, 'the rematch, B and A');
  });

  test('a connection that goes mid catch-up gets nothing more; resumed again, it gets the rest from where it was', () => {
    const L = longMatch(6);
    const r = resume(L);
    const W = welcomeOf(r.got).resume!.closed;
    L.run(1000, () => r.drain(128 << 10));
    assert.ok(r.to > -1 && r.to < W, `part way (${r.to} of ${W})`);
    r.close();
    const n = r.got.length;
    L.run(2000, () => { r.drain(); commit(L.a); });
    assert.equal(r.late, 0, 'nothing sent to the closed connection');
    assert.equal(r.got.length, n, 'nothing more for it');
    // the page reconnects with what it has
    const have = r.to;
    const r2 = resume(L, '10.9.9.10', have);
    assert.ok(L.until(() => r2.to >= W, 60_000, () => r2.drain(256 << 10)), `caught up (${r2.to} of ${W})`);
    const first = stream(r.got), rest = stream(r2.got, have), all = stream(L.a.got);
    sameStream({ ...rest, text: first.text + '\n' + rest.text, n: first.n + rest.n, drops: [first.drops, rest.drops].filter(Boolean).join(' ') }, all, 'the two catch-ups together');
  });

  test('a short resume is as before: the whole backlog right after the welcome, then in sync, takeover included', () => {
    const m = new Match();
    const a = m.peer('Alice', 40, 5), b = m.peer('Bob', 40, 5), c = m.peer('Cat', 40, 5);
    m.setupRoom({ mode: 'ffa', size: 64, startUnits: 'light' });
    assert.ok(m.until(() => m.minTick() >= 300, 60_000), 'the match runs');
    c.client.leave(); // Cat leaves: the AI takes over
    c.running = false;
    m.peers.splice(m.peers.indexOf(c), 1);
    assert.ok(m.until(() => a.drops.length > 0 && m.minTick() >= 900, 120_000), `Cat was replaced (${a.drops.join(' ')})`);
    // Bob's tab reloads: a new page resumes the seat (as in net.test.ts)
    const { code, token } = b.client;
    b.running = false;
    b.client.leave = () => {};
    b.client.simulateDrop();
    const b2: Peer = m.peer('Bob', 40, 5);
    b2.client = new NetClient({ url: 'ws://relay', name: 'Bob', build: BUILD_FINGERPRINT, mods: '', socket: m.net.socket('Bob'), timers: m.clock.timers });
    b2.client.on((msg) => { b2.messages.push(msg); if (msg.t === 'welcome' && msg.resume && !b2.session) m.begin(b2, msg.resume.start, true); });
    m.peers.splice(m.peers.indexOf(b), 1);
    b2.client.resume(code, token);
    assert.ok(m.until(() => !!b2.session && b2.world!.tick >= a.world!.tick - 10 && !b2.session.catchingUp, 60_000), `caught up (${b2.world?.tick} / ${a.world!.tick})`);
    const w = b2.messages.findIndex((x) => x.t === 'welcome');
    const W = welcomeOf(b2.messages).resume!.closed;
    const end = b2.messages.findIndex((x) => x.t === 'tick' && x.to >= W);
    assert.ok(w >= 0 && end > w && b2.messages.slice(w + 1, end + 1).every((x) => x.t === 'tick'), `the backlog came whole, right after the welcome (${b2.messages.slice(w, end + 2).map((x) => x.t).join(' ')})`);
    assert.ok(m.until(() => Math.min(a.world!.tick, b2.world!.tick) >= 1500, 120_000), 'they play on together');
    assert.deepEqual(b2.drops, a.drops, 'the reloaded page ran the takeover at the same tick');
    let compared = 0;
    for (let t = NET_HASH_EVERY; t <= 1500; t += NET_HASH_EVERY) {
      const ha = a.session!.ls.hashAt(t), hb = b2.session!.ls.hashAt(t);
      if (!ha || !hb) continue;
      compared++;
      assert.equal(hb, ha, `in sync at tick ${t}`);
    }
    assert.ok(compared >= 5, `hashes compared (${compared})`);
    const upTo = (p: Peer) => p.executed.filter(([t]) => t < 1500);
    assert.deepEqual(upTo(b2), upTo(a), 'the same orders at the same ticks');
  });
});

// ---------------------------------------------------------------------------------------------------------
// the real server: HTTP + WebSocket (needs `npm ci --prefix server`)
// ---------------------------------------------------------------------------------------------------------
const hasWs = existsSync(new URL('../server/node_modules/ws/package.json', import.meta.url));

describe('relay server over WebSockets', { skip: hasWs ? false : 'server dependencies not installed (npm ci --prefix server)' }, () => {
  test('a page reloaded in a long match catches up through the real server and stays connected (#19)', async () => {
    const { createRelayServer } = await import('../server/src/http');
    const { loadConfig } = await import('../server/src/config');
    const { headlessGame } = await import('../src/modes/headless');
    const { MatchSession } = await import('../src/net/session');
    const { matchSetup } = await import('../src/net/roster');
    type Session = InstanceType<typeof MatchSession>;
    const cfg = loadConfig({ RELAY_PORT: '0', RELAY_HOST: '127.0.0.1', LB_ENABLED: '0', RELAY_ALLOW_NO_ORIGIN: '1' });
    cfg.limits = { ...cfg.limits, ...FAST };
    const srv = createRelayServer(cfg, { log: () => {} });
    await new Promise<void>((r) => srv.server.listen(0, '127.0.0.1', () => r()));
    const url = `ws://127.0.0.1:${(srv.server.address() as { port: number }).port}/relay/ws`;
    const wait = (f: () => boolean, ms: number, what: () => string) => new Promise<void>((resolve, reject) => {
      const t0 = Date.now();
      const iv = setInterval(() => { if (f()) { clearInterval(iv); resolve(); } else if (Date.now() - t0 > ms) { clearInterval(iv); reject(new Error(`timeout: ${what()}`)); } }, 10);
    });
    /** A headless game for the match a client starts or resumes, recording every order it runs. */
    const play = (c: NetClient, start: MatchStart, ran: string[]): Session => {
      const g = headlessGame(matchSetup(start, c.seat, 'low', null));
      const s = new MatchSession({ client: c, world: g.world, start, localSeat: c.seat, onExecute: (cmd, t) => { ran.push(`${t} ${JSON.stringify(cmd)}`); } });
      s.loaded();
      return s;
    };
    const frames = (s: Session | null) => { if (s) for (let i = 0; i < 20; i++) s.frame(0.05, () => { s.world.step(); s.world.events.length = 0; }); };
    const sessions: { a: Session | null; b: Session | null } = { a: null, b: null };
    const alice = new NetClient({ url, name: 'Alice', build: BUILD_FINGERPRINT, mods: '' });
    const bob2 = new NetClient({ url, name: 'Bob', build: BUILD_FINGERPRINT, mods: '' });
    const ws = new WebSocket(url);
    try {
      // Alice plays in a headless game; Bob's first page is a bare connection that fills the log with big orders
      const ranA: string[] = [], ranB: string[] = [];
      alice.on((m) => { if (m.t === 'start') sessions.a = play(alice, m.start, ranA); });
      alice.create({ mode: '1v1', size: 64 });
      await wait(() => alice.state === 'open', 5000, () => 'room');
      const bob: Player = { got: [], closed: -1, to: -1, code: '', token: '', gone: false, send: (m) => ws.send(JSON.stringify(m)) };
      ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data as string) as ServerMessage;
        track(bob, m);
        if (m.t === 'ping') bob.send({ t: 'pong', n: m.n });
        if (m.t === 'start') bob.send({ t: 'loaded' });
      };
      ws.onclose = () => { bob.gone = true; };
      await wait(() => ws.readyState === 1, 5000, () => 'Bob connected');
      bob.send(hello({ join: alice.code, name: 'Bob' }));
      await wait(() => !!bob.token, 5000, () => 'Bob joined');
      bob.send({ t: 'me', ready: true });
      await wait(() => !!alice.room?.slots.every((s) => s.kind !== 'human' || s.ready), 5000, () => 'ready');
      alice.send({ t: 'start' });
      let sent = 0, last = -1;
      await wait(() => {
        if (sent < 12 * MB && bob.to >= 0) {
          for (const o of orders(bob.closed, 3)) { bob.send(o); sent += JSON.stringify(o).length; last = bob.closed + 3; }
        } else commit(bob);
        frames(sessions.a);
        return sent >= 12 * MB && !!sessions.a && sessions.a.ls.confirmed >= last;
      }, 120_000, () => `the log filled (${(sent / MB).toFixed(1)} MB sent)`);
      // Bob's tab reloads: the old page is gone, a new one resumes the seat
      ws.close();
      await wait(() => { frames(sessions.a); return bob.gone && alice.room?.slots.find((s) => s.name === 'Bob')?.connected === false; }, 5000, () => 'Bob gone');
      const a = sessions.a!, T0 = a.ls.confirmed;
      const states: string[] = [], got: ServerMessage[] = [];
      bob2.onState((s) => states.push(s));
      bob2.on((m) => { got.push(m); if (m.t === 'welcome' && m.resume && !sessions.b) sessions.b = play(bob2, m.resume.start, ranB); });
      const t0 = Date.now();
      let caughtUpMs = 0;
      bob2.resume(bob.code, bob.token);
      await wait(() => {
        frames(sessions.a);
        frames(sessions.b);
        const b = sessions.b;
        if (!caughtUpMs && b && b.world.tick >= T0 && !b.catchingUp) caughtUpMs = Date.now() - t0;
        return !!b && !!caughtUpMs && Math.min(a.world.tick, b.world.tick) >= Math.max(T0 + 60, 2 * NET_HASH_EVERY);
      }, 90_000, () => `Bob caught up and plays on (states ${states.join(' ')}; ticks ${a.world.tick} ${sessions.b?.world.tick} of ${T0})`);
      const b = sessions.b!;
      const W = welcomeOf(got).resume!.closed;
      const all = stream(got), backlog = stream(got.filter((m) => m.t !== 'tick' || m.to <= W));
      assert.ok(backlog.bytes > 10 * MB, `a backlog well over the transport's 4 MB cap (${(backlog.bytes / MB).toFixed(1)} MB up to tick ${W}, caught up in ${caughtUpMs} ms)`);
      assert.deepEqual(states, ['connecting', 'open'], 'one connection throughout: never cut off, never reconnecting');
      assert.equal(got.filter((m) => m.t === 'welcome').length, 1, 'one welcome');
      assert.ok(all.to > W, `then live ticks (${W} -> ${all.to})`);
      const upTo = Math.min(a.world.tick, b.world.tick);
      const ran = (r: string[]) => r.filter((x) => +x.slice(0, x.indexOf(' ')) < upTo).join('\n');
      assert.ok(ranA.length > 3000 && ran(ranB) === ran(ranA), `the same ${ranA.length} orders run at the same ticks`);
      const h = Math.floor(upTo / NET_HASH_EVERY) * NET_HASH_EVERY;
      assert.ok(b.ls.hashAt(h) !== null && b.ls.hashAt(h) === a.ls.hashAt(h), `in sync at tick ${h} (${b.ls.hashAt(h)} ${a.ls.hashAt(h)})`);
    } finally {
      alice.leave();
      bob2.leave();
      if (ws.readyState < 2) ws.close();
      await srv.close();
    }
  });
});
