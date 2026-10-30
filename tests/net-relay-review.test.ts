// Relay fixes from a code review (server/src/relay.ts, src/net/session.ts):
// - the input delay follows only the players still playing (a surrendered player who stays to watch on a slow link,
//   or a player whose match is over, no longer sizes it);
// - a page reloaded mid-match does not drive the delay up while it rebuilds the match (heartbeat times count per
//   connection, after that connection's `loaded`; the seat's estimates carry over to the resumed connection), while a
//   plain reconnect keeps its heartbeats counted (the client says `loaded` again after every resume);
// - the host's seat losing its connection mid-match (a host who surrendered and closed the game) hands the host to a
//   connected player, so the room can still go back to its lobby for a rematch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match } from './net-harness';
import { NetClient } from '../src/net/client';
import { BUILD_FINGERPRINT } from '../src/net/fingerprint';

test('a surrendered watcher on a slow link does not size the input delay of the players still playing', () => {
  const m = new Match();
  const ps = [m.peer('Ann', 30, 5), m.peer('Ben', 30, 5), m.peer('Cat', 30, 5), m.peer('Dan', 30, 5)];
  const [ann, ...rest] = ps;
  m.setupRoom({ mode: '2v2', size: 64, startUnits: 'light' });
  m.until(() => m.minTick() >= 300, 60_000);
  const before = rest[0].session!.ls.delay;
  ann.session!.ls.resign();
  assert.ok(m.until(() => ann.session!.ls.watching, 10_000), 'Ann watches after surrendering');
  // Ann (out of the match, only watching) is on a bad mobile link now
  m.net.links.get('Ann')!.latency = 700;
  const t0 = rest[0].world!.tick;
  m.until(() => false, 20_000);
  const after = rest[0].session!.ls.delay;
  const ticks = rest[0].world!.tick - t0;
  assert.ok(after <= 4, `the others' input delay follows a watcher who no longer plays: ${before} -> ${after} ticks`);
  assert.ok(ticks >= 380, `the others keep real time: ${ticks} ticks in 20 s`);
});

test('a page reloaded mid-match that answers heartbeats late while it rebuilds the match does not raise the delay', () => {
  const m = new Match();
  const a = m.peer('Alice', 40, 5), b = m.peer('Bob', 40, 5);
  m.setupRoom({ mode: '1v1', size: 64 });
  m.until(() => m.minTick() >= 600, 60_000);
  const { code, token } = b.client;
  // the old page is gone for good
  b.running = false; b.client.leave = () => {}; (b.client as unknown as { leaving: boolean }).leaving = true; b.client.simulateDrop();
  const b2 = m.peer('Bob', 40, 5);
  b2.client = new NetClient({ url: 'ws://relay', name: 'Bob', build: BUILD_FINGERPRINT, mods: '', socket: m.net.socket('Bob'), timers: m.clock.timers });
  // the new page builds the match (its main thread busy: heartbeats answered 2.5 s late) before its first frame,
  // which is when the browser reports it loaded (src/net/game-link.ts); a heartbeat queued meanwhile is answered
  // just after that
  let building = true;
  b2.noLoad = true;
  const send = b2.client.send.bind(b2.client);
  b2.client.send = (msg) => { if (building && msg.t === 'pong') m.clock.at(m.clock.t + 2500, () => send(msg)); else send(msg); };
  b2.client.on((msg) => { if (msg.t === 'welcome' && msg.resume && !b2.session) m.begin(b2, msg.resume.start, true); });
  m.peers.splice(m.peers.indexOf(b), 1);
  b2.client.resume(code, token);
  const during: number[] = [];
  for (let i = 0; i < 8; i++) { m.until(() => false, 1000); during.push(a.session!.ls.delay); }
  const resumed = [...(m.relay as unknown as { clients: Set<{ seat: { name: string } | null; rtt: number }> }).clients].find((c) => c.seat?.name === 'Bob');
  assert.ok(resumed && resumed.rtt > 0 && resumed.rtt < 200, `the resumed connection starts from the seat's round trip, not from nothing: ${resumed?.rtt}`);
  building = false;
  b2.session!.loaded();
  const after: number[] = [];
  for (let i = 0; i < 30; i++) { m.until(() => false, 1000); after.push(a.session!.ls.delay); }
  assert.ok(Math.max(...during, ...after) <= 4, `a page rebuilding the match after a reload does not drive the delay up: ${during.join(',')} | ${after.join(',')}`);
  assert.ok(m.until(() => b2.world!.tick >= a.world!.tick - 20, 30_000), 'the reloaded page caught up');
});

test('after a plain reconnect the player\'s heartbeats still count: the delay follows a link that gets slow', () => {
  const m = new Match();
  const a = m.peer('Alice', 30, 5), b = m.peer('Bob', 30, 5);
  m.setupRoom({ mode: '1v1', size: 64 });
  m.until(() => m.minTick() >= 300, 60_000);
  b.client.simulateDrop(); // a blip: the same page reconnects and resumes its seat
  assert.ok(m.until(() => b.client.state === 'open' && b.client.seat !== null && b.world!.tick > 400, 30_000), 'Bob resumed');
  m.until(() => false, 5000);
  assert.ok(a.session!.ls.delay <= 4, `short delay on a good link: ${a.session!.ls.delay}`);
  m.net.links.get('Bob')!.latency = 250; // ~500 ms round trip from now on
  m.until(() => false, 20_000);
  assert.ok(a.session!.ls.delay >= 8, `the delay follows the reconnected player's slower link: ${a.session!.ls.delay}`);
});

test('the host surrenders and closes the game mid-match: a remaining player can reopen the lobby', () => {
  const m = new Match();
  const a = m.peer('Alice', 40, 5), b = m.peer('Bob', 40, 5), c = m.peer('Cat', 40, 5);
  m.setupRoom({ mode: 'ffa', size: 64, startUnits: 'light' });
  m.until(() => m.minTick() >= 300, 60_000);
  assert.equal(c.client.room!.host, a.client.seat, 'Alice hosts');
  a.session!.ls.resign();
  assert.ok(m.until(() => a.session!.ls.watching, 10_000), 'Alice watches after surrendering');
  a.client.leave(); a.running = false; // closes the game after surrendering
  assert.ok(m.until(() => c.client.room?.host !== a.client.seat, 10_000), 'the host moved to a connected player mid-match');
  b.session!.ls.resign(); // Bob concedes too: Cat wins
  assert.ok(m.until(() => c.client.room?.phase === 'over', 60_000), 'match over');
  const host = c.client.room!.host;
  const by = [b, c].find((p) => p.client.seat === host);
  assert.ok(by, `the host is a player still in the room (seat ${host})`);
  by!.client.send({ t: 'lobby' });
  m.until(() => false, 2000);
  assert.equal(c.client.room?.phase, 'lobby', 'someone still in the room reopened the lobby');
});
