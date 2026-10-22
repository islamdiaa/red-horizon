// The lobby while the link is down (src/net/client.ts chat queue, src/ui/lobby.ts): chat typed while reconnecting is
// kept and sent when the seat is resumed, the relay keeps the seat meanwhile, and what cannot be kept is reported as
// not sent instead of vanishing.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Match } from './net-harness';
import { MAX_QUEUED_CHAT } from '../src/net/client';
import { netPlayers } from '../src/net/roster';
import { normaliseSettings } from '../src/net/settings';

function lobby(m: Match) {
  const a = m.peer('Alice', 40, 5), b = m.peer('Bob', 40, 5);
  a.client.create({ mode: '1v1' });
  assert.ok(m.until(() => a.client.state === 'open', 3000), 'room created');
  b.client.join(a.client.code);
  assert.ok(m.until(() => b.client.state === 'open', 3000), 'joined');
  return { a, b };
}
const chats = (p: { messages: { t: string }[] }) => p.messages.filter((x): x is { t: 'chat'; text: string; name: string } => x.t === 'chat').map((x) => x.text);

describe('lobby chat while reconnecting', () => {
  test('typed during a dead link: kept, then sent on resume; the seat was kept', () => {
    const m = new Match();
    const { a, b } = lobby(m);
    const seat = b.client.seat;
    m.net.links.get('Bob')!.silent = true; // a dead Wi-Fi: nobody is told
    assert.ok(m.until(() => b.client.state === 'reconnecting', 15_000), 'the client notices and reconnects');
    assert.equal(b.client.chat('back in a sec'), 'queued', 'kept');
    assert.equal(b.client.chat('router again'), 'queued', 'kept');
    assert.deepEqual(b.client.pendingChat, ['back in a sec', 'router again'], 'waiting to send');
    m.until(() => false, 4000);
    m.net.links.get('Bob')!.silent = false;
    assert.ok(m.until(() => b.client.state === 'open', 20_000), 'resumed');
    assert.equal(b.client.seat, seat, 'the same seat');
    assert.ok(m.until(() => chats(a).includes('router again'), 5000), 'the other player got them');
    assert.deepEqual(chats(a).slice(-2), ['back in a sec', 'router again'], 'in order');
    assert.deepEqual(b.client.pendingChat, [], 'nothing left waiting');
    assert.ok(chats(b).includes('back in a sec'), 'echoed back to the sender like any chat');
  });

  test('at most a few lines wait; a connection that is gone for good keeps them as not sent', () => {
    const m = new Match({ lobbyGraceMs: 5000 });
    const { b } = lobby(m);
    m.net.links.get('Bob')!.up = false;
    b.client.simulateDrop();
    assert.ok(m.until(() => b.client.state === 'reconnecting', 5000), 'reconnecting');
    for (let i = 0; i < MAX_QUEUED_CHAT; i++) assert.equal(b.client.chat(`line ${i}`), 'queued', `line ${i} kept`);
    assert.equal(b.client.chat('one too many'), 'dropped', 'beyond the queue: reported, not kept');
    // the relay gives the lobby seat up after its grace; the resume then finds no room
    m.until(() => false, 8000);
    m.net.links.get('Bob')!.up = true;
    assert.ok(m.until(() => b.client.state === 'closed', 30_000), 'the seat is gone');
    assert.equal(b.client.pendingChat.length, MAX_QUEUED_CHAT, 'what was typed is still known (the lobby reports it as not sent)');
    assert.equal(b.client.chat('hello?'), 'dropped', 'nothing is kept once closed');
  });
});

describe('names', () => {
  test('the AI commanders of a match keep their English names and order (part of the setup every client builds)', () => {
    const slot = (kind: 'human' | 'ai', seat?: number) => ({ kind, seat, name: kind === 'human' ? 'Ann' : undefined, ai: kind === 'ai' ? 'normal' as const : undefined, faction: 'random' as const });
    const names = (seed: number) => netPlayers({ seed, room: { code: 'TESTAB', phase: 'match', host: 1, build: '', mods: '', settings: normaliseSettings({ mode: '2v2' }), slots: [slot('human', 1), slot('ai'), slot('ai'), slot('ai')] } }).map((p) => p.name);
    assert.deepEqual(names(0), ['Ann', 'Gen. Volkov', 'Marshal Krukov', 'Col. Nadia'], 'seed 0');
    assert.deepEqual(names(4), ['Ann', 'Cdr. Bennett', 'Maj. Kane', 'Gen. Volkov'], 'seed 4 wraps the list');
  });
});
