// Multiplayer modes end to end on the virtual network (tests/net-harness.ts): 2 vs 2, free for all and co-op with AI
// seats at every level, a player leaving mid-match (the AI takes over), a rematch in the same room, and the end of the
// match for every player (who won, who lost, who surrendered), with the players who only watch still in step.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Match, replayExecuted, worldHash, type Peer } from './net-harness';
import { NET_HASH_EVERY } from '../src/net/protocol';
import type { AIDifficulty } from '../src/sim/ai';

const MIN = 20 * 60;

function inSync(peers: Peer[], upTo: number): number {
  let n = 0;
  for (let t = NET_HASH_EVERY; t <= upTo; t += NET_HASH_EVERY) {
    const hs = peers.map((p) => p.session!.ls.hashes.find((h) => h[0] === t)?.[1]).filter((h): h is string => !!h);
    if (hs.length < 2) continue;
    n++;
    assert.ok(hs.every((h) => h === hs[0]), `hashes agree at ${t}`);
  }
  return n;
}
const aiSeat = (slot: number, ai: AIDifficulty) => ({ slot, ai: ai as 'easy' });
/** What the results screen says for a client (game.ts: the team won and the player did not surrender). */
const won = (p: Peer) => { const w = p.world!, me = w.players[p.session!.ls['localPlayer' as never] as number]; return w.winnerTeam === me.team && !me.resigned; };
const structures = (p: Peer, id: number) => p.world!.buildings.filter((b) => b.alive && b.owner.id === id && !b.bt.wall).length;

describe('multiplayer modes with AI seats', () => {
  test('2 vs 2, a human and an AI per team (Recruit and Brutal): in sync, both AIs build and fight', () => {
    const m = new Match();
    const a = m.peer('Ann', 40, 5), b = m.peer('Ben', 80, 15);
    m.setupRoom({ mode: '2v2', size: 80, startUnits: 'light' }, [aiSeat(1, 'recruit'), aiSeat(3, 'brutal')]);
    const w = a.world!;
    assert.deepEqual(w.players.map((p) => [p.team, p.isHuman]), [[0, true], [0, false], [1, true], [1, false]], 'seats and teams');
    // team-mates share a side of the map (src/sim/starts.ts), on every client
    const sp = w.map.startPositions, dist = (i: number, j: number) => Math.hypot(sp[i].x - sp[j].x, sp[i].y - sp[j].y);
    // (not in opposite corners: the team-mate is nearer than the farthest enemy, who sits diagonally across)
    assert.ok(dist(0, 1) < Math.max(dist(0, 2), dist(0, 3)) - 5 && dist(2, 3) < Math.max(dist(2, 0), dist(2, 1)) - 5, `team-mates start side by side (${sp.slice(0, 4).map((p) => `${p.x},${p.y}`).join(' ')})`);
    assert.deepEqual(b.world!.map.startPositions, sp, 'the same starts on both clients');
    assert.ok(m.until(() => m.minTick() >= 4 * MIN, 300_000), 'four minutes');
    assert.ok(inSync([a, b], 4 * MIN) >= 20, 'in sync');
    assert.deepEqual(a.executed, b.executed, 'same stream');
    for (const id of [1, 3]) assert.ok(structures(a, id) >= 3, `AI ${id} built a base (${structures(a, id)})`);
    assert.ok(w.ais.length === 2 && w.ais.map((x) => x.difficulty).join() === 'recruit,brutal', 'the levels picked in the lobby');
  });

  test('free for all with two humans and two AIs (Easy and Hard); one human leaves mid-match and the AI takes over everywhere at once', () => {
    const m = new Match();
    const a = m.peer('Ann', 40, 5), b = m.peer('Ben', 60, 10);
    m.setupRoom({ mode: 'ffa', size: 96, startUnits: 'light' }, [aiSeat(2, 'easy'), aiSeat(3, 'hard')]);
    assert.ok(m.until(() => m.minTick() >= 2 * MIN, 200_000), 'two minutes');
    b.client.leave(); // "Leave match"
    b.running = false;
    assert.ok(m.until(() => a.drops.length > 0, 10_000), 'the relay hands the seat over at once');
    assert.ok(a.world!.ais.some((x) => x.player.id === 1) && !a.world!.players[1].isHuman, 'the AI commands Ben\'s side');
    assert.ok(m.until(() => a.world!.tick >= 4 * MIN, 200_000), 'the match goes on');
    assert.ok(a.session!.stall === null, 'nobody waits for the leaver');
    const t = 4 * MIN - (4 * MIN) % NET_HASH_EVERY;
    assert.equal(replayExecuted(a, t), a.session!.ls.hashes.find((h) => h[0] === t)![1], 'the replay applies the takeover at the same tick');
  });

  test('co-op against Normal, Brutal and Recruit AIs: in sync', () => {
    const m = new Match();
    const a = m.peer('Ann', 40, 5), b = m.peer('Ben', 120, 30);
    m.setupRoom({ mode: 'coop', size: 96, startUnits: 'light' }, [aiSeat(2, 'brutal'), aiSeat(3, 'recruit')]);
    const w = a.world!;
    assert.deepEqual(w.players.map((p) => p.team), [0, 0, 1, 1], 'humans together against the AIs');
    assert.ok(m.until(() => m.minTick() >= 3 * MIN, 300_000), 'three minutes');
    assert.ok(inSync([a, b], 3 * MIN) >= 15, 'in sync');
  });
});

describe('the end of a match, and the next one', () => {
  test('four humans: every player gets the right result, the players who surrendered keep watching in step', () => {
    const m = new Match();
    const ps = [m.peer('Ann', 30, 5), m.peer('Ben', 60, 10), m.peer('Cat', 50, 10), m.peer('Dan', 40, 5)];
    m.setupRoom({ mode: '2v2', size: 64, startUnits: 'light' });
    m.until(() => m.minTick() >= 600, 60_000);
    ps[0].session!.ls.resign(); // Ann: her side fights on under the AI
    m.until(() => ps.every((p) => p.world!.players[0].resigned), 10_000);
    m.until(() => false, 10_000);
    ps[1].session!.ls.resign(); // Ben, the last human of team 0: the team concedes
    assert.ok(m.until(() => ps.every((p) => p.world!.gameOver), 30_000), 'the match ended for everyone');
    const end = ps.map((p) => [p.world!.tick, p.world!.winnerTeam, worldHash(p.world!)].join());
    assert.ok(end.every((e) => e === end[0]), `same end everywhere: ${end[0]}`);
    assert.deepEqual(ps.map(won), [false, false, true, true], 'results: team 1 won, both who surrendered lost');
    assert.ok(m.until(() => ps[0].client.room?.phase === 'over', 10_000), 'the relay closed the match');
  });

  test('a rematch in the same room: back to the lobby, ready, a new match with a new seed, in sync', () => {
    const m = new Match();
    const a = m.peer('Ann', 40, 5), b = m.peer('Ben', 40, 5);
    m.setupRoom({ mode: '1v1', size: 64, startUnits: 'light' });
    const seed1 = a.start!.seed;
    m.until(() => m.minTick() >= 300, 60_000);
    b.session!.ls.resign();
    assert.ok(m.until(() => a.client.room?.phase === 'over', 30_000), 'over');
    a.client.send({ t: 'lobby' }); // the host reopens the lobby (the results screen's "Play again")
    assert.ok(m.until(() => a.client.room?.phase === 'lobby' && b.client.room?.phase === 'lobby', 5000), 'both back in the lobby');
    assert.ok(b.client.room!.slots.every((s) => s.kind !== 'human' || !s.ready || s.seat === a.client.seat), 'everyone confirms again');
    b.client.send({ t: 'me', ready: true });
    m.until(() => !!a.client.room?.slots.every((s) => s.kind !== 'human' || s.ready), 5000);
    a.client.send({ t: 'start' });
    assert.ok(m.until(() => a.start!.seed !== seed1 && b.start!.seed === a.start!.seed && m.minTick() >= 600, 60_000), 'the next match runs');
    assert.ok(!a.world!.players[1].resigned && !b.session!.ls.watching, 'a fresh match: nobody surrendered');
    assert.ok(inSync([a, b], 600) >= 5, 'in sync');
  });

  test('a client that is catching up when the match ends (a tab back from the background) ends too, and leaves catch-up', () => {
    const m = new Match();
    const a = m.peer('Ann', 40, 5), b = m.peer('Ben', 40, 5);
    m.setupRoom({ mode: '1v1', size: 64, startUnits: 'light' });
    m.until(() => m.minTick() >= 300, 60_000);
    b.hidden = true; // Ben's tab in the background: it keeps committing, the match goes on
    a.session!.ls.resign();
    assert.ok(m.until(() => a.world!.gameOver, 30_000), 'over for Ann');
    m.until(() => false, 5000);
    b.hidden = false;
    let caughtUpMode = false;
    assert.ok(m.until(() => { caughtUpMode ||= b.session!.catchingUp; return b.world!.gameOver; }, 30_000), 'Ben reaches the end');
    assert.ok(caughtUpMode, 'through catch-up mode');
    m.frame();
    assert.equal(b.session!.catchingUp, false, 'not left "catching up" (the banner) once it is over');
    assert.equal(worldHash(b.world!), worldHash(a.world!), 'the same end');
  });
});

