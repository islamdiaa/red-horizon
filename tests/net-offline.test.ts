/**
 * Playing on without the relay (src/net/lockstep.ts goOffline, src/net/game-link.ts playOffline): when the relay
 * restarts or shuts down mid-match, a player still in command can finish the battle on their own machine. The AI
 * takes over every other human at the current tick (recorded as drops), and the match replay reproduces the whole
 * battle, the online part and the offline rest.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match, replayExecuted, scriptedPlayer, worldHash, type Peer } from './net-harness';
import type { Command } from '../src/sim/types';

/** What GameLink.issue does once offline: the order runs directly and goes into the replay at the tick it runs. */
function playOn(p: Peer, ticks: number) {
  const w = p.world!;
  const local = (p.session!.ls as unknown as { localPlayer: number }).localPlayer;
  const issue = (c: Command) => { const cmd = { ...c, player: local } as Command; p.executed.push([w.tick, cmd]); w.issue(cmd); };
  const bot = scriptedPlayer(w, local, issue, 99);
  const end = w.tick + ticks;
  while (w.tick < end && !w.gameOver) { bot(); w.step(); w.events.length = 0; }
}

test('relay gone mid-match: a player plays on against the AI, and the replay reproduces it', () => {
  const m = new Match();
  const a = m.peer('Alpha'), b = m.peer('Bravo', 60, 10), c = m.peer('Charlie', 90, 20);
  m.setupRoom({ mode: '2v2', size: 64, startUnits: 'light', credits: 5000 }, [{ slot: 3, ai: 'normal' }]);
  assert.ok(m.until(() => m.minTick() > 1200, 120_000), `the match runs (ticks ${m.peers.map((p) => p.world?.tick)})`);
  for (const p of m.peers) assert.equal(p.session!.ls.status, 'live', `${p.name} is live before the relay goes`);

  m.relay.close(); // (SIGTERM: the relay closes every room with "server shutting down")
  m.until(() => false, 3000);
  for (const p of m.peers) {
    assert.equal(p.client.state, 'closed', `${p.name}'s connection ended`);
    assert.equal(p.client.endReason, 'server shutting down', `${p.name} was told why (${p.client.endReason})`);
    assert.equal(p.session!.ls.status, 'live', `${p.name}'s match is frozen, not over`);
  }

  const w = a.world!, t0 = w.tick;
  const local = (a.session!.ls as unknown as { localPlayer: number }).localPlayer;
  const humans = w.players.filter((p) => p.isHuman).map((p) => p.id);
  const handed = a.session!.ls.goOffline();
  assert.ok(handed, 'Alpha can play on');
  assert.deepEqual([...handed!].sort(), humans.filter((id) => id !== local).sort(), 'every other human is handed to the AI');
  for (const id of handed!) {
    assert.ok(!w.players[id].isHuman && w.ais.some((x) => x.player === w.players[id]), `player ${id} is now an AI`);
    a.drops.push([t0, id]); // (GameLink records them in setup.net.drops)
  }
  assert.equal(a.session!.ls.status, 'offline', 'the lockstep no longer paces the match');
  assert.equal(a.session!.ls.goOffline(), null, 'only once');
  assert.equal(a.session!.ls.canStep(), false, 'the lockstep steps nothing more');

  // the battle goes on here: our orders run directly, the AIs fight
  const unitsBefore = w.units.filter((u) => u.alive && u.owner.id !== local).length;
  playOn(a, 2400);
  assert.ok(w.tick >= t0 + 2400 || w.gameOver, `the world keeps stepping (tick ${w.tick})`);
  const offOrders = a.executed.filter(([t]) => t >= t0).length;
  assert.ok(offOrders > 0, `orders given offline run (${offOrders})`);
  assert.ok(unitsBefore > 0, 'there was an enemy to fight');

  // the replay (online commands + offline commands + the drops) reproduces the battle exactly
  assert.equal(replayExecuted(a, w.tick), worldHash(w), 'the replay reproduces the offline continuation');

  // Bravo, who watched nothing and still commands too, can also play on, independently
  assert.ok(b.session!.ls.goOffline(), 'Bravo can play on as well');
  void c;
});

test('relay gone: a player who surrendered cannot "play on"', () => {
  const m = new Match();
  const a = m.peer('Alpha'), b = m.peer('Bravo'), c = m.peer('Charlie');
  m.setupRoom({ mode: '2v2', size: 64, startUnits: 'light' }, [{ slot: 3, ai: 'normal' }]);
  assert.ok(m.until(() => m.minTick() > 300, 60_000), 'the match runs');
  // Bravo surrenders (their team-mate plays on, so Bravo watches)
  assert.ok(b.session!.ls.resign(), 'Bravo surrenders');
  assert.ok(m.until(() => b.world!.players.some((p) => p.resigned) && b.session!.ls.watching, 30_000), 'the surrender runs');
  m.relay.close();
  m.until(() => false, 2000);
  assert.equal(b.session!.ls.goOffline(), null, 'a player who surrendered only watched: nothing to play on');
  assert.ok(a.session!.ls.goOffline(), 'Alpha still commands, so can play on');
  void c;
});
