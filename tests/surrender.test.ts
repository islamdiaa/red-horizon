// Surrender (src/sim/resign.ts, the relay's handling in server/src/relay.ts, the lockstep in src/net/lockstep.ts): the
// side concedes when nobody else on it plays (1v1, free for all, a team left without humans), a team with another
// human fights on with the AI, a ranked run ends as a loss the server re-simulates, and in a networked match every
// client applies it at the same tick, the relay stops waiting for that seat, and the replay reproduces it.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { headlessGame } from '../src/modes/headless';
import { matchSetup } from '../src/net/roster';
import { normaliseSettings } from '../src/net/settings';
import type { MatchStart, SlotView } from '../src/net/protocol';
import type { World } from '../src/sim/world';
import { SURRENDERED, canResign } from '../src/sim/resign';
import { RESIGN_TEXT } from '../src/i18n/en/net';
import { sanitizeCommand } from '../src/net/commands';
import { boardInfo, boardSetup, listBoards } from '../src/net/boards';
import { RunRecorder } from '../src/net/runrecord';
import { verifyRun } from '../src/net/verify';
import { withPortableMath } from '../src/net/dmath';
import { Match, replayExecuted, worldHash, type Peer } from './net-harness';

const human = (seat: number, name: string): SlotView => ({ kind: 'human', seat, name, ready: true, connected: true, faction: 'random' });
const ai = (): SlotView => ({ kind: 'ai', ai: 'normal', faction: 'random' });
function start(mode: string, slots: SlotView[], seed = 4242): MatchStart {
  return { seed, room: { code: 'TESTAB', phase: 'match', host: 1, build: '', mods: '', settings: normaliseSettings({ mode, size: 64, startUnits: 'light' }), slots } };
}
function world(mode: string, slots: SlotView[]): World {
  return headlessGame(matchSetup(start(mode, slots), 1, 'low', null)).world;
}
function run(w: World, ticks: number) {
  for (let i = 0; i < ticks && !w.gameOver; i++) { w.step(); w.events.length = 0; }
}
const owns = (w: World, id: number) => w.units.filter((u) => u.alive && u.owner.id === id).length + w.buildings.filter((b) => b.alive && b.owner.id === id).length;

describe('surrender in the simulation', () => {
  test('1v1: the side concedes - everything destroyed, defeated, the other player wins', () => {
    const w = world('1v1', [human(1, 'Ann'), human(2, 'Ben')]);
    run(w, 200);
    assert.ok(owns(w, 0) > 0 && owns(w, 1) > 0, 'both sides on the field');
    w.issue({ c: 'resign', player: 0 });
    w.step();
    const ev = w.events.filter((e) => e.e === 'eliminated').map((e) => (e as { player: number }).player);
    w.events.length = 0;
    assert.equal(w.players[0].resigned, true, 'marked as surrendered');
    assert.equal(w.players[0].defeated, true, 'defeated at once');
    assert.equal(owns(w, 0), 0, 'nothing of theirs is left');
    assert.deepEqual(ev, [0], 'the elimination is announced');
    assert.ok(owns(w, 1) > 0 && !w.players[1].defeated, 'the other side untouched');
    run(w, 25);
    assert.ok(w.gameOver, 'the match ends at the next victory check');
    assert.equal(w.winnerTeam, w.players[1].team, 'the other player wins');
    assert.equal(canResign(w, w.players[1]), false, 'no surrender after the end');
  });

  test('2v2 with four humans: the side fights on under the AI; when the last human of the side gives up, it concedes', () => {
    const w = world('2v2', [human(1, 'Ann'), human(2, 'Ben'), human(3, 'Cat'), human(4, 'Dan')]);
    run(w, 200);
    const before = owns(w, 0);
    w.issue({ c: 'resign', player: 0 });
    run(w, 1);
    const p0 = w.players[0];
    assert.equal(p0.resigned, true, 'surrendered');
    assert.equal(p0.defeated, false, 'the side is not beaten');
    assert.equal(p0.isHuman, false, 'no longer commanded by a human');
    assert.ok(w.ais.some((a) => a.player === p0), 'the AI commands the side');
    assert.equal(owns(w, 0), before, 'their forces stay on the field');
    run(w, 400);
    assert.ok(!w.gameOver && owns(w, 0) > 0, 'the team fights on');
    w.issue({ c: 'resign', player: 1 }); // the last human of team 0
    run(w, 1);
    assert.ok(w.players[0].defeated && w.players[1].defeated, 'the whole side concedes');
    assert.equal(owns(w, 0) + owns(w, 1), 0, 'both bases gone');
    assert.equal(w.players[1].resigned, true, 'the second one surrendered too');
    run(w, 25);
    assert.ok(w.gameOver && w.winnerTeam === 1, 'team 1 wins');
  });

  test('2v2 human and AI against human and AI: a human who surrenders concedes for the side (no human left on it)', () => {
    const w = world('2v2', [human(1, 'Ann'), ai(), human(2, 'Ben'), ai()]);
    run(w, 200);
    assert.ok(!w.players[1].isHuman, 'slot 1 is an AI');
    w.issue({ c: 'resign', player: 0 });
    run(w, 1);
    assert.ok(w.players[0].defeated && w.players[1].defeated, 'the human and the AI ally are out');
    assert.equal(w.players[1].resigned, undefined, 'only the human surrendered');
    run(w, 25);
    assert.ok(w.gameOver && w.winnerTeam === w.players[2].team, 'the other team wins');
  });

  test('free for all: only the surrendering player leaves; the others fight on', () => {
    const w = world('ffa', [human(1, 'Ann'), human(2, 'Ben'), human(3, 'Cat')]);
    run(w, 200);
    w.issue({ c: 'resign', player: 1 });
    run(w, 30);
    assert.ok(w.players[1].defeated && owns(w, 1) === 0, 'removed');
    assert.ok(!w.gameOver, 'the match goes on');
    assert.ok(!w.players[0].defeated && !w.players[2].defeated && owns(w, 0) > 0 && owns(w, 2) > 0, 'the others untouched');
  });

  test('a surrender is ignored once a player is out, and twice is the same as once; the same game twice gives the same state', () => {
    const play = () => {
      const w = world('ffa', [human(1, 'Ann'), human(2, 'Ben'), human(3, 'Cat')]);
      run(w, 150);
      w.issue({ c: 'resign', player: 2 });
      w.issue({ c: 'resign', player: 2 });
      run(w, 60);
      w.issue({ c: 'resign', player: 2 }); // defeated already
      run(w, 60);
      return w;
    };
    const a = play(), b = play();
    assert.ok(a.players[2].defeated && !a.gameOver, 'one surrender');
    assert.equal(worldHash(a), worldHash(b), 'deterministic');
  });

  test('commands: a resign is rebuilt as the sender\'s, extra fields dropped; the mission reason is a translated source string', () => {
    assert.deepEqual(sanitizeCommand({ c: 'resign', player: 3, units: [1, 2], x: 4 }, 1), { c: 'resign', player: 1 }, 'only the sender');
    assert.equal(RESIGN_TEXT.surrendered, SURRENDERED, 'the reason the simulation writes is registered for translation');
  });

  test('a ranked run (Survival) ends as a loss on surrender, and the server\'s re-simulation agrees', () => {
    const board = listBoards().find((b) => b.kind === 'survival')!;
    const sub = withPortableMath(() => {
      const g = headlessGame(boardSetup(board.kind, board.id)!);
      const w = g.world, me = g.local;
      const rec = new RunRecorder(w, boardInfo(board.kind, board.id)!, '2026-10-19');
      while (!w.gameOver && w.tick < 20 * 60 * 10) {
        if (w.tick === 20 * 150) { const c = { c: 'resign' as const, player: me.id }; rec.record(c); w.issue(c); }
        w.step(); w.events.length = 0; if (w.mission) w.mission.events.length = 0;
      }
      assert.equal(w.tick, 20 * 150 + 1, 'the run ends at the surrender');
      assert.equal(w.mission?.endReason, SURRENDERED, 'ended by the surrender');
      return JSON.parse(JSON.stringify(rec.submission('Commander', 'test-player-0123456789abcdef')));
    });
    assert.ok(sub && sub.won === false && sub.score > 0, `a scored loss (${sub?.score})`);
    const v = verifyRun(sub, { maxTicks: 108000 });
    assert.ok(v.ok && !v.won && v.score === sub.score, `verified as a loss: ${JSON.stringify(v)}`);
    assert.equal(verifyRun({ ...sub, won: true }, { maxTicks: 108000 }).ok, false, 'claiming a win is rejected');
  });
});

describe('surrender in a networked match', () => {
  const hashesAgree = (peers: Peer[], upTo: number) => {
    let n = 0;
    for (let t = 100; t <= upTo; t += 100) {
      const hs = peers.map((p) => p.session!.ls.hashes.find((h) => h[0] === t)?.[1]).filter((h): h is string => !!h);
      if (hs.length < 2) continue;
      n++;
      assert.ok(hs.every((h) => h === hs[0]), `hashes agree at ${t}`);
    }
    return n;
  };

  test('1v1: the same tick everywhere, the other player wins, the relay ends the match, the replay reproduces it', () => {
    const m = new Match();
    const a = m.peer('Alice', 60, 10), b = m.peer('Bob', 90, 20);
    m.setupRoom({ mode: '1v1', size: 64, startUnits: 'light' });
    m.until(() => m.minTick() >= 600, 60_000);
    assert.equal(a.session!.ls.resign(), true, 'surrender sent');
    assert.equal(a.session!.ls.resign(), false, 'only once');
    assert.ok(m.until(() => a.world!.gameOver && b.world!.gameOver, 30_000), 'the match ended on both');
    const ra = a.executed.find(([, c]) => c.c === 'resign'), rb = b.executed.find(([, c]) => c.c === 'resign');
    assert.ok(ra && rb && ra[0] === rb[0], `the surrender ran at the same tick (${ra?.[0]} / ${rb?.[0]})`);
    assert.equal(a.world!.tick, b.world!.tick, 'ended at the same tick');
    assert.equal(worldHash(a.world!), worldHash(b.world!), 'same final state');
    assert.equal(a.world!.winnerTeam, a.world!.players[1].team, 'Bob won');
    assert.ok(a.session!.ls.watching, 'Alice watches');
    assert.ok(m.until(() => b.client.room?.phase === 'over', 10_000), 'the relay closed the match');
    assert.equal(replayExecuted(a, a.world!.tick), worldHash(a.world!), 'the replay reproduces the surrender');
    hashesAgree([a, b], a.world!.tick);
  });

  test('2v2 with four humans: the AI takes the side at the same tick, and the match never waits for the player who left after it', () => {
    const m = new Match({ reconnectGraceMs: 5000 });
    const ps = [m.peer('Ann', 30, 5), m.peer('Ben', 70, 20), m.peer('Cat', 50, 10), m.peer('Dan', 40, 5)];
    const [ann, ...rest] = ps;
    m.setupRoom({ mode: '2v2', size: 64, startUnits: 'light' });
    m.until(() => m.minTick() >= 400, 60_000);
    ann.session!.ls.resign();
    assert.ok(m.until(() => ps.every((p) => p.world!.players[0].resigned), 10_000), 'everyone applied it');
    const at = ps.map((p) => p.executed.find(([, c]) => c.c === 'resign')![0]);
    assert.ok(at.every((t) => t === at[0]), `same tick everywhere (${at.join(',')})`);
    for (const p of ps) assert.ok(p.world!.ais.some((x) => x.player.id === 0) && !p.world!.players[0].defeated, `${p.name}: the AI commands Ann's side`);
    // Ann closes the game: nobody waits for her, and her later disconnect schedules no takeover
    m.until(() => ann.session!.ls.watching, 5000);
    ann.running = false;
    m.net.links.get('Ann')!.up = false;
    ann.client.simulateDrop();
    const t0 = Math.min(...rest.map((p) => p.world!.tick));
    let stalled = false;
    assert.ok(m.until(() => { stalled ||= rest.some((p) => !!p.session!.stall); return Math.min(...rest.map((p) => p.world!.tick)) >= t0 + 1200; }, 120_000), 'the match went on');
    assert.ok(!stalled, 'never stalled for her');
    assert.ok(rest.every((p) => p.drops.length === 0), 'no drop scheduled for a seat that surrendered');
    for (const p of rest.slice(1)) assert.deepEqual(p.executed, rest[0].executed, `${p.name} executed the same stream`);
    assert.ok(hashesAgree(rest, t0 + 1200) >= 15, 'in sync');
    const end = rest[0].world!.tick - (rest[0].world!.tick % 100);
    assert.equal(replayExecuted(rest[0], end), rest[0].session!.ls.hashes.find((h) => h[0] === end)![1], 'the replay reproduces the takeover');
    assert.equal(m.relay.stats.desyncs, 0, 'no desync');
  });

  test('both players of a 1v1 surrender at once: the match still ends (the relay runs it on for the watchers)', () => {
    const m = new Match();
    const a = m.peer('Alice', 40, 5), b = m.peer('Bob', 40, 5);
    m.setupRoom({ mode: '1v1', size: 64, startUnits: 'light' });
    m.until(() => m.minTick() >= 300, 60_000);
    a.session!.ls.resign();
    b.session!.ls.resign();
    assert.ok(m.until(() => a.world!.gameOver && b.world!.gameOver, 30_000), 'ended on both');
    assert.equal(a.world!.winnerTeam, b.world!.winnerTeam, 'same result');
    assert.equal(worldHash(a.world!), worldHash(b.world!), 'same state');
  });
});
