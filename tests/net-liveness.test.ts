// The multiplayer client notices a dead link by itself (src/net/client.ts silentMs / connectTimeoutMs).
// Regression from the net lab (real browsers, real TCP, tools/net-lab): during a link outage with no RST and no FIN
// the disconnected player saw a frozen game with no explanation for the whole outage, and only reconnected when TCP
// finally surfaced the dead socket, seconds after the link was back (never, for a 10 s outage). The relay pings every
// 2 s, so a client that hears nothing for a few seconds knows the link is gone.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Match, VClock, type Peer } from './net-harness';
import { NetClient, type ClientState, type SocketLike } from '../src/net/client';

function inSync(peers: Peer[], upTo: number): number {
  const maps = peers.map((p) => new Map(p.session!.ls.hashes));
  let compared = 0;
  for (const [t, h] of maps[0]) {
    if (t > upTo) continue;
    for (const m of maps.slice(1)) if (m.has(t)) { compared++; assert.equal(m.get(t), h, `hash at tick ${t}`); }
  }
  return compared;
}

/** A socket the test drives by hand (opens when told, delivers what the test injects). */
function handSockets() {
  const made: (SocketLike & { open(): void; deliver(m: object): void; sent: string[] })[] = [];
  const factory = () => {
    let state = 0;
    const s = {
      sent: [] as string[],
      get readyState() { return state; },
      onopen: null as SocketLike['onopen'], onmessage: null as SocketLike['onmessage'], onclose: null as SocketLike['onclose'], onerror: null as SocketLike['onerror'],
      send(d: string) { s.sent.push(d); },
      close() { state = 3; },
      open() { state = 1; s.onopen?.(); },
      deliver(m: object) { s.onmessage?.({ data: JSON.stringify(m) }); },
    };
    made.push(s);
    return s;
  };
  return { made, factory };
}
const WELCOME = { t: 'welcome', code: 'ABCDEF', seat: 1, token: 'tok', room: { code: 'ABCDEF', phase: 'lobby', host: 1, build: 'b', mods: '', settings: {}, slots: [] } };

describe('the client notices a dead link by itself', () => {
  test('a silent outage shows "reconnecting" within seconds, and the match resumes in sync once the link is back', () => {
    const m = new Match();
    const a = m.peer('Alice', 40, 5), b = m.peer('Bob', 40, 5);
    m.setupRoom({ mode: '1v1', size: 64 });
    assert.ok(m.until(() => m.minTick() >= 600, 60_000), 'match running');
    const link = m.net.links.get('Bob')!;
    link.silent = true;
    const t0 = m.clock.t;
    assert.ok(m.until(() => b.client.state === 'reconnecting', 15_000), 'Bob noticed the dead link while it was still dead');
    const noticed = m.clock.t - t0;
    assert.ok(noticed <= 9000, `noticed within about 8 s (took ${noticed} ms)`);
    m.until(() => false, 20_000 - noticed); // dead for 20 s in all
    link.silent = false;
    assert.ok(m.until(() => b.client.state === 'open', 20_000), 'reconnected (resumed the seat) once the link was back');
    assert.ok(m.until(() => m.minTick() >= 1600, 120_000), 'the match goes on');
    assert.equal(a.drops.length + b.drops.length, 0, 'nobody was replaced by the AI');
    assert.ok(inSync([a, b], 1600) >= 10, 'in sync after the outage');
  });

  test('a healthy connection is never taken for a dead one', () => {
    const m = new Match();
    m.peer('Alice', 60, 20);
    const b = m.peer('Bob', 120, 40);
    const states: ClientState[] = [];
    b.client.onState((s) => states.push(s));
    m.setupRoom({ mode: '1v1', size: 64 });
    assert.ok(m.until(() => m.minTick() >= 1400, 120_000), 'a minute of play');
    assert.ok(!states.includes('reconnecting'), `no reconnect on a live link (states ${states.join(',')})`);
  });

  test('a late check (a busy main thread or a throttled tab) is not taken for a dead link', () => {
    const clock = new VClock();
    const hs = handSockets();
    const c = new NetClient({ url: 'ws://x', name: 'n', build: 'b', mods: '', socket: hs.factory, timers: clock.timers });
    c.resume('ABCDEF', 'tok');
    hs.made[0].open();
    hs.made[0].deliver(WELCOME);
    assert.equal(c.state, 'open', 'welcomed');
    clock.advance(2000);
    clock.t += 20_000; // the page was busy: no timer ran, no message was handled
    clock.advance(500);
    assert.equal(c.state, 'open', 'a check that ran 20 s late does not call the link dead');
    clock.advance(6000);
    assert.equal(c.state, 'open', 'still within the silence limit since then');
    clock.advance(2500);
    assert.equal(c.state, 'reconnecting', 'real silence afterwards is noticed');
    assert.equal(hs.made.length, 2, 'and a fresh connection is tried after a short backoff');
    assert.equal(hs.made[1].sent.length, 0, 'nothing is sent on it before it opens');
  });

  test('a connection attempt that is never answered is abandoned and retried', () => {
    const clock = new VClock();
    const hs = handSockets();
    const c = new NetClient({ url: 'ws://x', name: 'n', build: 'b', mods: '', socket: hs.factory, timers: clock.timers });
    c.resume('ABCDEF', 'tok'); // a seat to take back: the client keeps trying
    clock.advance(9000);
    assert.equal(hs.made.length, 1, 'still waiting on the first attempt');
    clock.advance(3000);
    assert.ok(hs.made.length >= 2, `a hanging attempt is replaced by a new one (${hs.made.length} sockets)`);
    hs.made[hs.made.length - 1].open();
    hs.made[hs.made.length - 1].deliver(WELCOME);
    assert.equal(c.state, 'open', 'the fresh attempt connects');
    const hello = JSON.parse(hs.made[hs.made.length - 1].sent[0]) as { resume?: { token: string } };
    assert.equal(hello.resume?.token, 'tok', 'and resumes the seat with its token');
  });
});
