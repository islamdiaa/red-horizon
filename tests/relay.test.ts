// The multiplayer relay (server/src/relay.ts) on its own: lobby rules and limits, and hostile input - oversize,
// malformed and flooding messages, forged settings, guessed codes, names with markup - plus the real WebSocket
// server (server/src/http.ts) end to end when the server's dependencies are installed.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { Match, VClock, VNet, makeRelay } from './net-harness';
import type { SocketLike } from '../src/net/client';
import { NET_PROTOCOL, MAX_CLIENT_MSG, parseClientMessage, normaliseCode, safeCommandShape, type ServerMessage } from '../src/net/protocol';
import { BUILD_FINGERPRINT } from '../src/net/fingerprint';
import { cleanName, cleanChat } from '../src/net/names';
import { normaliseSettings, startProblem } from '../src/net/settings';
import { sanitizeCommand } from '../src/net/commands';

/** A raw socket on the virtual network (sends any text). */
function raw(net: VNet, name: string) {
  const sock: SocketLike = net.socket(name)('ws://relay');
  const got: ServerMessage[] = [];
  let closed = false;
  sock.onmessage = (ev) => got.push(JSON.parse(ev.data as string));
  sock.onclose = () => { closed = true; };
  return { sock, got, get closed() { return closed; }, send: (t: string) => sock.send(t) };
}
const hello = (extra: Record<string, unknown>, name = 'Raw') => JSON.stringify({ t: 'hello', proto: NET_PROTOCOL, build: BUILD_FINGERPRINT, mods: '', name, ...extra });

describe('relay: lobby and limits', () => {
  test('a 1v1 room takes two players; the third is turned away', () => {
    const m = new Match();
    const [a, b, c] = [m.peer('A'), m.peer('B'), m.peer('C')];
    a.client.create({ mode: '1v1' });
    m.until(() => a.client.state === 'open', 2000);
    b.client.join(a.client.code);
    m.until(() => b.client.state === 'open', 2000);
    c.client.join(a.client.code);
    m.until(() => c.client.state === 'closed', 3000);
    assert.equal(c.client.lastError?.code, 'full', 'room full');
    assert.equal(a.client.room!.slots.filter((s) => s.kind === 'human').length, 2, 'two seats taken');
  });

  test('a 2v2 room takes four; settings and AI seats are host-only; start needs everyone ready', () => {
    const m = new Match();
    const ps = ['A', 'B', 'C', 'D', 'E'].map((n) => m.peer(n));
    ps[0].client.create({ mode: '2v2' });
    m.until(() => ps[0].client.state === 'open', 2000);
    for (const p of ps.slice(1)) { p.client.join(ps[0].client.code); m.until(() => p.client.state !== 'connecting' && p.client.state !== 'idle', 3000); }
    assert.equal(ps[4].client.lastError?.code, 'full', 'fifth player turned away');
    // a guest tries to change the settings and to start
    ps[1].client.send({ t: 'settings', settings: { mode: 'ffa', credits: 20000 } });
    ps[1].client.send({ t: 'start' });
    m.until(() => false, 500);
    assert.equal(ps[0].client.room!.settings.mode, '2v2', 'guest cannot change settings');
    assert.equal(ps[0].client.room!.phase, 'lobby', 'guest cannot start');
    ps[0].client.send({ t: 'start' });
    m.until(() => false, 500);
    assert.equal(ps[0].client.lastError?.code, 'not-ready', 'host cannot start before everyone is ready');
    assert.equal(startProblem(ps[0].client.room!), 'Waiting for everyone to be ready');
    // host settings reach everyone, normalised
    ps[0].client.send({ t: 'settings', settings: { mode: '2v2', credits: 123456789, size: 9999, mutators: ['golden-ore', 'nope'], map: '../../etc/passwd' } });
    m.until(() => false, 500);
    const s = ps[3].client.room!.settings;
    assert.equal(s.credits, 10000, 'unknown credits fall back');
    assert.equal(s.size, 96, 'unknown size falls back');
    assert.deepEqual(s.mutators, ['golden-ore'], 'unknown mutators dropped');
    assert.equal(s.map, 'gen', 'unknown map falls back');
  });

  test('names and chat are cleaned and capped; chat is rate-limited', () => {
    const m = new Match();
    const a = m.peer('<img src=x onerror=alert(1)>‮evil'), b = m.peer('B');
    a.client.create({});
    m.until(() => a.client.state === 'open', 2000);
    b.client.join(a.client.code);
    m.until(() => b.client.state === 'open', 2000);
    const name = b.client.room!.slots.find((s) => s.seat === a.client.seat)!.name!;
    assert.ok(!/[<>"'‮]/.test(name), `name cleaned (${name})`);
    assert.ok([...name].length <= 20, 'name capped');
    for (let i = 0; i < 10; i++) a.client.send({ t: 'chat', text: `<b>hi</b> ${'x'.repeat(400)}` });
    m.until(() => false, 1000);
    const chats = b.messages.filter((x) => x.t === 'chat') as Extract<ServerMessage, { t: 'chat' }>[];
    assert.ok(chats.length >= 1 && chats.length <= 5, `chat rate-limited (${chats.length} of 10 delivered)`);
    assert.ok(chats.every((c) => !/[<>]/.test(c.text) && [...c.text].length <= 160), 'chat cleaned and capped');
    assert.equal(cleanName('   '), 'Commander', 'empty names fall back');
    assert.equal(cleanChat('a\u0000b\nc'), 'ab c', 'control characters removed');
  });

  test('versions and mods must match to join; wrong codes and kicked players are refused', () => {
    const m = new Match();
    const a = m.peer('A');
    a.client.create({});
    m.until(() => a.client.state === 'open', 2000);
    const r1 = raw(m.net, 'old');
    m.until(() => r1.sock.readyState === 1, 1000);
    r1.send(hello({ join: a.client.code, build: '0.0.1/1/deadbeef' }));
    m.until(() => r1.closed, 2000);
    assert.equal((r1.got.find((x) => x.t === 'error') as { code: string }).code, 'build', 'other build refused');
    const r2 = raw(m.net, 'modded');
    m.until(() => r2.sock.readyState === 1, 1000);
    r2.send(hello({ join: a.client.code, mods: 'abc123' }));
    m.until(() => r2.closed, 2000);
    assert.equal((r2.got.find((x) => x.t === 'error') as { code: string }).code, 'mods', 'other mods refused');
    const r3 = raw(m.net, 'guess');
    m.until(() => r3.sock.readyState === 1, 1000);
    r3.send(hello({ join: 'ZZZZZZ' }));
    m.until(() => r3.closed, 2000);
    assert.equal((r3.got.find((x) => x.t === 'error') as { code: string }).code, 'no-room', 'unknown code refused');
    const r4 = raw(m.net, 'resume');
    m.until(() => r4.sock.readyState === 1, 1000);
    r4.send(hello({ resume: { code: a.client.code, token: 'forged-token', have: -1 } }));
    m.until(() => r4.closed, 2000);
    assert.equal((r4.got.find((x) => x.t === 'error') as { code: string }).code, 'no-room', 'forged resume token refused');
    // kick
    const b = m.peer('B');
    b.client.join(a.client.code);
    m.until(() => b.client.state === 'open', 2000);
    a.client.send({ t: 'kick', seat: b.client.seat });
    m.until(() => b.client.state === 'closed', 3000);
    assert.equal(b.client.endReason, 'kicked', 'kicked');
    const b2 = m.peer('B'); // same link name = same address
    b2.client.join(a.client.code);
    m.until(() => b2.client.state === 'closed', 3000);
    assert.equal(b2.client.lastError?.code, 'kicked', 'and cannot come back');
  });

  test('a dropped connection in the lobby reconnects to the same seat', () => {
    const m = new Match();
    const a = m.peer('A', 20, 0, false), b = m.peer('B', 20, 0, false);
    a.client.create({ mode: '1v1' });
    m.until(() => a.client.state === 'open', 2000);
    b.client.join(a.client.code);
    m.until(() => b.client.state === 'open', 2000);
    b.client.send({ t: 'me', ready: true, faction: 'soviet' });
    m.until(() => !!a.client.room?.slots.find((s) => s.seat === b.client.seat)?.ready, 2000);
    const seat = b.client.seat;
    b.client.simulateDrop();
    m.until(() => a.client.room?.slots.find((s) => s.seat === seat)?.connected === false, 3000);
    assert.equal(a.client.room!.slots.find((s) => s.seat === seat)?.connected, false, 'shown as reconnecting');
    assert.ok(m.until(() => b.client.state === 'open' && !!a.client.room?.slots.find((s) => s.seat === seat)?.connected, 15_000), 'back');
    const sl = a.client.room!.slots.find((s) => s.seat === seat)!;
    assert.equal(sl.faction, 'soviet', 'same seat, same choices');
    assert.equal(b.client.seat, seat, 'same seat id');
  });

  test('a player still loading the match gets longer to answer and to come back', () => {
    const m = new Match({ pongTimeoutMs: 5000, reconnectGraceMs: 10_000 });
    const a = m.peer('A', 20, 0, false), b = m.peer('B', 20, 0, false);
    b.noLoad = true;
    m.setupRoom({ mode: '1v1', size: 64 });
    b.running = false; // still building the world: no frames, no 'loaded'
    const ws = (b.client as unknown as { ws: { onmessage: unknown } | null }).ws;
    if (ws) ws.onmessage = () => {}; // and its page is too busy to answer heartbeats or to reconnect
    m.net.links.get('B')!.up = false;
    m.until(() => false, 20_000);
    assert.equal(m.relay.stats.drops, 0, 'not dropped after the normal timeouts');
    assert.equal(a.drops.length, 0, 'nobody was replaced');
  });

  test('guessing codes is rate-limited per address', () => {
    const clock = new VClock();
    const relay = makeRelay(clock, { joinPerMin: 5 });
    const net = new VNet(clock, relay);
    net.link('g', 10, 0);
    let refused = 0;
    for (let i = 0; i < 12; i++) {
      const r = raw(net, 'g');
      clock.advance(50);
      r.send(hello({ join: `AAAA${'23456789'[i % 8]}${'BCDEFGHJ'[i % 8]}` }));
      clock.advance(100);
      if (r.got.some((x) => x.t === 'error' && (x as { code: string }).code === 'slow-down')) refused++;
    }
    assert.ok(refused >= 6, `most guesses refused (${refused} of 12)`);
  });

  test('oversize, malformed and unknown messages are rejected; a flood closes the connection', () => {
    const clock = new VClock();
    const relay = makeRelay(clock, { maxViolations: 10 });
    const net = new VNet(clock, relay);
    net.link('x', 10, 0);
    const r = raw(net, 'x');
    clock.advance(50);
    r.send('x'.repeat(MAX_CLIENT_MSG + 1));
    r.send('{not json');
    r.send(JSON.stringify({ t: 'nope' }));
    r.send(JSON.stringify({ t: 'in', upTo: 5, cmds: [[1, { c: 'move', units: [[[[1]]]] }]] }));
    r.send(JSON.stringify([1, 2, 3]));
    clock.advance(100);
    const errors = r.got.filter((x) => x.t === 'error' && (x as { code: string }).code === 'bad-message').length;
    assert.equal(errors, 5, 'each rejected with an error');
    assert.equal(r.closed, false, 'a few mistakes are tolerated');
    for (let i = 0; i < 400; i++) r.send('{}');
    clock.advance(100);
    assert.equal(r.closed, true, 'a flood closes the connection');
    assert.equal(relay.connCount, 0, 'and frees it');
  });

  test('connections per address and rooms are capped', () => {
    const clock = new VClock();
    const relay = makeRelay(clock, { maxConnsPerIp: 3, maxRooms: 2 });
    const net = new VNet(clock, relay);
    net.link('one', 10, 0);
    const socks = Array.from({ length: 5 }, () => raw(net, 'one'));
    clock.advance(50);
    assert.equal(socks.filter((s) => s.closed).length, 2, 'two over the per-address cap refused');
    net.link('h1', 10, 0); net.link('h2', 10, 0); net.link('h3', 10, 0);
    const hs = ['h1', 'h2', 'h3'].map((n) => raw(net, n));
    clock.advance(50);
    for (const h of hs) h.send(hello({ create: {} }));
    clock.advance(100);
    assert.equal(relay.roomCount, 2, 'room cap');
    assert.ok(hs[2].got.some((x) => x.t === 'error' && (x as { code: string }).code === 'busy'), 'third room refused');
  });

  test('silent connections time out; empty and idle rooms are removed', () => {
    const clock = new VClock();
    const relay = makeRelay(clock, { pongTimeoutMs: 5000, lobbyIdleMs: 60_000, lobbyGraceMs: 3000 });
    const net = new VNet(clock, relay);
    net.link('s', 10, 0);
    const r = raw(net, 's');
    clock.advance(50);
    r.sock.onmessage = () => {}; // never answers pings
    r.send(hello({ create: {} }));
    clock.advance(100);
    assert.equal(relay.roomCount, 1, 'room created');
    for (let i = 0; i < 28; i++) { clock.advance(250); relay.tick(); }
    assert.equal(r.closed, true, 'closed after the heartbeat timeout');
    assert.equal(relay.roomCount, 1, 'the seat waits a moment for a reconnect');
    for (let i = 0; i < 16; i++) { clock.advance(250); relay.tick(); }
    assert.equal(relay.roomCount, 0, 'then its lobby goes');
  });

  test('late or far-future commands and over-eager commits are refused by the relay', () => {
    const m = new Match({ maxViolations: 1000 });
    const a = m.peer('A', 20, 0, false), b = m.peer('B', 20, 0, false);
    m.setupRoom({ mode: '1v1', size: 64 });
    m.until(() => m.minTick() >= 100, 20_000);
    const before = a.executed.length;
    b.client.send({ t: 'in', upTo: 0, cmds: [[5, { c: 'stop', units: [1] }]] }); // a tick long closed
    b.client.send({ t: 'in', upTo: 1_000_000, cmds: [[999_999, { c: 'stop', units: [1] }]] }); // far future
    m.until(() => m.minTick() >= 300, 20_000);
    assert.equal(a.executed.length, before, 'neither ran');
    assert.ok(m.minTick() >= 300, 'and the match was not pushed ahead by the commit');
  });
});

describe('relay: after a match', () => {
  test('the room goes back to the lobby for a rematch, and survives the host leaving', () => {
    const m = new Match();
    const a = m.peer('A', 20, 0, false), b = m.peer('B', 20, 0, false), c = m.peer('C', 20, 0, false);
    m.setupRoom({ mode: 'ffa', size: 64 });
    m.until(() => m.minTick() >= 50, 10_000);
    const seed1 = a.start!.seed;
    for (const p of [a, b, c]) p.client.send({ t: 'over', tick: p.world!.tick, winner: 0 });
    m.until(() => a.client.room?.phase === 'over', 2000);
    assert.equal(a.client.room?.phase, 'over', 'match over once everybody finished');
    a.client.leave(); // the host goes home
    m.until(() => b.client.room?.host !== a.client.seat, 2000);
    const newHost = b.client.room!.host;
    assert.ok(newHost === b.client.seat || newHost === c.client.seat, 'hosting passed on');
    const h = newHost === b.client.seat ? b : c, g = h === b ? c : b;
    for (const p of [b, c]) { p.session?.dispose(); p.session = null; }
    h.client.send({ t: 'lobby' });
    m.until(() => g.client.room?.phase === 'lobby', 2000);
    assert.equal(g.client.room?.phase, 'lobby', 'back in the lobby');
    assert.equal(g.client.room!.slots.filter((s) => s.kind === 'human').length, 2, 'two players left');
    const free = g.client.room!.slots.findIndex((s) => s.kind === 'open');
    h.client.send({ t: 'slot', slot: free, kind: 'ai', ai: 'easy' }); // (free for all needs three: the host's old seat)
    m.until(() => g.client.room?.slots.some((s) => s.kind === 'ai') ?? false, 2000);
    g.client.send({ t: 'me', ready: true });
    m.until(() => !!h.client.room?.slots.every((s) => s.kind !== 'human' || s.ready), 2000);
    h.client.send({ t: 'start' });
    assert.ok(m.until(() => !!b.session && !!c.session, 3000), `rematch started (${h.errors.join(',')})`);
    assert.notEqual(b.start!.seed, seed1, 'with a new seed');
    assert.ok(m.until(() => Math.min(b.world!.tick, c.world!.tick) >= 200, 30_000), 'and runs');
  });
});

describe('protocol checks', () => {
  test('message parsing rejects wrong shapes', () => {
    assert.equal(parseClientMessage('{"t":"hello","proto":1,"build":"x","mods":"","name":"a"}'), null, 'hello needs create, join or resume');
    assert.equal(parseClientMessage('{"t":"hello","proto":1,"build":"x","mods":"","name":"a","join":"abc"}'), null, 'bad code');
    assert.ok(parseClientMessage('{"t":"hello","proto":1,"build":"x","mods":"","name":"a","join":"ABCDEF"}'), 'valid join');
    assert.equal(parseClientMessage('{"t":"in","upTo":1,"cmds":[[1,{"c":"move","units":[1e400]}]]}'), null, 'non-finite numbers');
    assert.equal(parseClientMessage(JSON.stringify({ t: 'in', upTo: 1, cmds: Array.from({ length: 40 }, () => [1, { c: 'stop' }]) })), null, 'too many commands');
    assert.equal(parseClientMessage('{"t":"hash","tick":100,"h":"<script>"}'), null, 'bad hash');
    assert.equal(safeCommandShape({ c: 'x', a: { b: { c: { d: 1 } } } }), null, 'too deep');
    assert.equal(safeCommandShape({ c: 'move', units: Array.from({ length: 500 }, (_, i) => i) }), null, 'too many units');
    assert.equal(normaliseCode('https://x.example/#join=abc234'), 'ABC234', 'codes from invite links');
    assert.equal(normaliseCode('abc'), null, 'short codes rejected');
    assert.equal(normaliseSettings({ mode: 'battle-royale' }).mode, '1v1', 'unknown mode');
  });

  test('a commit always covers exactly the commands sent with it (exact resends after a reconnect)', async () => {
    const { Lockstep } = await import('../src/net/lockstep');
    const sent: { upTo: number; cmds: [number, unknown][] }[] = [];
    const world = { tick: 10 } as unknown as import('../src/sim/world').World;
    const ls = new Lockstep({ world, seatPlayer: new Map([[1, 0]]), localSeat: 1, delay: 3, send: (m) => { if (m.t === 'in') sent.push(m); } });
    for (let i = 0; i < 40; i++) ls.issue({ c: 'stop', player: 0, units: [i + 1] }); // 40 orders in one tick
    (world as { tick: number }).tick = 11;
    for (let i = 0; i < 5; i++) ls.issue({ c: 'stop', player: 0, units: [100 + i] });
    ls.commit(14);
    ls.flush();
    assert.equal(sent.length, 2, 'split into messages');
    let prev = -1;
    for (const m of sent) {
      assert.ok(m.cmds.every(([t]) => t > prev && t <= m.upTo), 'each message holds only ticks above the previous commit and up to its own');
      prev = m.upTo;
    }
    assert.deepEqual(sent.map((m) => m.upTo), [13, 14], 'the first commits the tick it completes, the last the full commit');
    assert.equal(sent[0].cmds.length, 32, 'a tick keeps at most a message worth of orders');
    // the relay only got the first message: exactly what is above its commit is sent again
    ls.resume({ start: {} as never, committed: 13, closed: 0, dropped: false, delay: 3 });
    sent.length = 0;
    ls.flush();
    assert.deepEqual(sent.flatMap((m) => m.cmds).map(([t]) => t), [14, 14, 14, 14, 14], 'the five orders of tick 14 again, nothing the relay has');
    assert.equal(sent.at(-1)!.upTo, 14, 'with the commit');
  });

  test('command checks rebuild commands field by field', () => {
    const c = sanitizeCommand({ c: 'move', player: 3, units: [5, 6], x: 1.5, y: 2, attackMove: true, extra: 'x' }, 1)!;
    assert.deepEqual(c, { c: 'move', player: 1, units: [5, 6], x: 1.5, y: 2, attackMove: true }, 'player is the sender, extra fields dropped');
    assert.equal(sanitizeCommand({ c: 'build', type: '__proto__' }, 0), null, 'unknown type');
    assert.equal(sanitizeCommand({ c: 'superweapon', kind: 'laser', x: 1, y: 1 }, 0), null, 'unknown power');
    assert.equal(sanitizeCommand({ c: 'place', type: 'powr', cx: 1.5, cy: 2 }, 0), null, 'non-integer cell');
    assert.equal(sanitizeCommand({ c: 'patrol', units: [1], points: [[1, 2], [3]] }, 0), null, 'bad patrol point');
    assert.deepEqual(sanitizeCommand({ c: 'futureThing', building: 4, id: 'abc', on: true }, 2), { c: 'futureThing', player: 2, building: 4, id: 'abc', on: true }, 'new kinds keep flat fields');
    assert.equal(sanitizeCommand({ c: 'futureThing', nested: { a: 1 } }, 2), null, 'but nothing nested');
  });
});

// ---------------------------------------------------------------------------------------------------------
// the real server: HTTP + WebSocket (needs `npm ci --prefix server`)
// ---------------------------------------------------------------------------------------------------------
const hasWs = existsSync(new URL('../server/node_modules/ws/package.json', import.meta.url));

describe('relay server over WebSockets', { skip: hasWs ? false : 'server dependencies not installed (npm ci --prefix server)' }, () => {
  test('two clients play through the real server; origins are checked', async () => {
    const { createRelayServer } = await import('../server/src/http');
    const { loadConfig } = await import('../server/src/config');
    const { NetClient } = await import('../src/net/client');
    const { headlessGame } = await import('../src/modes/headless');
    const { MatchSession } = await import('../src/net/session');
    const { matchSetup } = await import('../src/net/roster');
    const cfg = loadConfig({ RELAY_PORT: '0', RELAY_HOST: '127.0.0.1', LB_ENABLED: '0', RELAY_ALLOW_NO_ORIGIN: '1' });
    const srv = createRelayServer(cfg, { log: () => {} });
    await new Promise<void>((r) => srv.server.listen(0, '127.0.0.1', () => r()));
    const port = (srv.server.address() as { port: number }).port;
    try {
      const health = await (await fetch(`http://127.0.0.1:${port}/relay/healthz`)).json() as { ok: boolean; build: string };
      assert.equal(health.ok, true, 'healthz');
      assert.equal(health.build, BUILD_FINGERPRINT, 'reports the build');
      // a foreign origin is refused at the upgrade
      const bad = await new Promise<string>((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/relay/ws`, { headers: { origin: 'https://evil.example' } } as never);
        ws.onopen = () => resolve('open');
        ws.onerror = () => resolve('refused');
      });
      assert.equal(bad, 'refused', 'foreign origin refused');
      const mk = (name: string) => new NetClient({ url: `ws://127.0.0.1:${port}/relay/ws`, name, build: BUILD_FINGERPRINT, mods: '' });
      const a = mk('Alice'), b = mk('Bob');
      const wait = (f: () => boolean, ms = 5000) => new Promise<void>((resolve, reject) => {
        const t0 = Date.now();
        const iv = setInterval(() => { if (f()) { clearInterval(iv); resolve(); } else if (Date.now() - t0 > ms) { clearInterval(iv); reject(new Error('timeout')); } }, 10);
      });
      a.create({ mode: '1v1', size: 64 });
      await wait(() => a.state === 'open');
      b.join(a.code);
      await wait(() => b.state === 'open');
      b.send({ t: 'me', ready: true });
      await wait(() => !!a.room?.slots.every((s) => s.kind !== 'human' || s.ready));
      const sessions: InstanceType<typeof MatchSession>[] = [];
      for (const c of [a, b]) c.on((m) => {
        if (m.t !== 'start') return;
        const g = headlessGame(matchSetup(m.start, c.seat, 'low', null));
        sessions.push(new MatchSession({ client: c, world: g.world, start: m.start, localSeat: c.seat }));
      });
      a.send({ t: 'start' });
      await wait(() => sessions.length === 2);
      // run both as fast as the round trips allow (real time would take minutes)
      const step = (s: InstanceType<typeof MatchSession>) => () => { s.world.step(); s.world.events.length = 0; };
      await wait(() => {
        for (const s of sessions) { for (let i = 0; i < 20; i++) s.frame(0.05, step(s)); }
        return sessions.every((s) => s.world.tick >= 300);
      }, 120_000);
      const h = sessions.map((s) => s.ls.hashAt(300));
      assert.ok(h[0] && h[0] === h[1], `same hash at tick 300 (${h.join(' ')})`);
      a.leave(); b.leave();
    } finally {
      await srv.close();
    }
  });
});
