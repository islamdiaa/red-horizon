// Verified leaderboards (src/net/boards.ts, src/net/verify.ts, server/src/leaderboard): a recorded run is
// re-simulated by the server and ranked only when its end, hash and score match; tampered runs are rejected;
// the store keeps bounded per-day tops; verification is one at a time with a time limit and turns work away
// when busy. The HTTP end to end part needs the server's dependencies (npm ci --prefix server).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { headlessGame } from '../src/modes/headless';
import { boardInfo, boardOfSetup, boardSetup, listBoards, parseSubmission, type Submission } from '../src/net/boards';
import { verifyRun } from '../src/net/verify';
import { RunRecorder } from '../src/net/runrecord';
import { setDailyDay } from '../src/missions/special';
import { withPortableMath } from '../src/net/dmath';
import { portableMathFor, withPortableFlag } from '../src/net/boards';
import { CommandFeeder, CommandRecorder, hookStep } from '../src/replay/core';
import type { GameSetup } from '../src/game';
import type { Command } from '../src/sim/types';
import { LeaderboardStore } from '../server/src/leaderboard/store';
import { VerifyQueue } from '../server/src/leaderboard/queue';

const PLAYER = 'test-player-0123456789abcdef';

/** Play a board the way the game does (commands through the recorder), with an attack-move script. */
function playRun(kind: 'challenge' | 'daily', id: string, day = '2026-10-19', every = 100): Submission {
  return withPortableMath(() => playRunInner(kind, id, day, every)); // ranked runs use portable math (as the game does)
}
function playRunInner(kind: 'challenge' | 'daily', id: string, day: string, every: number): Submission {
  if (kind === 'daily') setDailyDay(day);
  try {
    const g = headlessGame(boardSetup(kind, id)!);
    const w = g.world, me = g.local;
    const rec = new RunRecorder(w, boardInfo(kind, id)!, day);
    const issue = (c: Command) => { rec.record(c); w.issue(c); };
    while (!w.gameOver && w.tick < 20 * 60 * 15) {
      if (w.tick % every === 1) {
        const army = w.units.filter((u) => u.alive && u.owner === me && (kind === 'daily' || (u.weapons.length && !u.ut.harvester)));
        const foe = (kind === 'daily' ? w.buildings.find((b) => b.alive && me.isEnemy(b.owner)) : undefined) ?? w.units.find((u) => u.alive && me.isEnemy(u.owner)) ?? w.buildings.find((b) => b.alive && me.isEnemy(b.owner));
        if (army.length && foe) issue({ c: 'move', player: me.id, units: army.map((u) => u.id), x: foe.x, y: foe.y, attackMove: true });
      }
      w.step(); w.events.length = 0; if (w.mission) w.mission.events.length = 0;
    }
    const sub = rec.submission('Commander', PLAYER);
    assert.ok(sub, 'the run ended and can be submitted');
    return JSON.parse(JSON.stringify(sub)) as Submission; // as it travels
  } finally {
    setDailyDay(null);
  }
}

describe('verified leaderboards', () => {
  const run = playRun('challenge', 'b-armoured-clash');

  test('boards: fixed setups, ranked modes only', () => {
    assert.ok(listBoards().length >= 8, 'daily, three survival fronts, the built-in challenges');
    assert.equal(boardInfo('survival', 'survival:coop:hard+hard')?.kind, 'survival', 'co-op survival board');
    assert.equal(boardInfo('survival', 'survival:coop:hard+easy'), null, 'mixed allies are not a board');
    assert.equal(boardInfo('challenge', 'toString'), null, 'no prototype keys');
    assert.equal(boardInfo('daily', 'other'), null, 'unknown daily id');
    const s = boardSetup('challenge', 'b-armoured-clash')!;
    assert.equal(boardOfSetup(s)?.id, 'b-armoured-clash', 'a fresh built-in challenge is ranked');
    assert.equal(boardOfSetup({ ...s, mods: { hash: 'x', mods: [{} as never] } }), null, 'modded runs are not');
    assert.equal(boardOfSetup({ ...s, challenge: { ...s.challenge!, timeLimit: 9999 } }), null, 'an edited challenge is not');
    assert.equal(boardOfSetup({ ...boardSetup('daily', 'daily')!, load: {} as never }), null, 'a resumed run is not');
  });

  test('a recorded run verifies: same end, hash and score', () => {
    assert.ok(run.score > 0, `the run scored (${run.score})`);
    assert.ok(run.won, 'and won');
    const r = verifyRun(run, { maxTicks: 100_000 });
    assert.deepEqual(r, { ok: true, score: run.score, ticks: run.ticks, won: true }, 'verified');
  });

  test('a Daily Challenge run verifies for its day (and only for it)', () => {
    const d = playRun('daily', 'daily', '2026-10-19', 200);
    assert.ok(d.score > 0, `scored (${d.score})`);
    assert.equal(verifyRun(d, { maxTicks: 100_000 }).ok, true, 'verified for its day');
    const other = verifyRun({ ...d, day: '2026-10-20' }, { maxTicks: 100_000 });
    assert.equal(other.ok, false, 'the same commands on another day\'s battlefield do not match');
  });

  test('tampered runs are rejected', () => {
    const bad = (s: Submission) => verifyRun(s, { maxTicks: 100_000 });
    assert.match((bad({ ...run, score: run.score + 1000 }) as { reason: string }).reason, /score does not match/, 'inflated score');
    const k = Math.floor(run.cmds.length / 2);
    const moved = run.cmds.map(([t, c], i): [number, Command] => [t, i === k ? { ...c, x: 2, y: 2 } as Command : c]);
    assert.equal(bad({ ...run, cmds: moved }).ok, false, 'an edited command changes the outcome');
    assert.equal(bad({ ...run, cmds: run.cmds.slice(0, 2) }).ok, false, 'dropped commands');
    assert.equal(bad({ ...run, hash: '0123456789abcdef' }).ok, false, 'wrong final hash');
    assert.equal(bad({ ...run, ticks: run.ticks + 50 }).ok, false, 'claims to end later');
    assert.equal(bad({ ...run, ticks: run.ticks - 50 }).ok, false, 'claims to end earlier');
    assert.equal(bad({ ...run, cmds: [[1, { c: 'build', player: 0, type: 'no-such-unit' } as Command], ...run.cmds] }).ok, false, 'invalid command');
    assert.match((bad({ ...run, won: !run.won }) as { reason: string }).reason, /result does not match/, 'a claimed result the run does not earn');
    assert.equal(bad(run).ok, true, 'the original still verifies');
    assert.equal(typeof parseSubmission({ ...run, kind: 'challenge', id: '__proto__' }), 'string', 'unknown board');
    assert.equal(typeof parseSubmission({ ...run, cmds: [[5, { c: 'stop' }], [1, { c: 'stop' }]] }), 'string', 'commands out of order');
    assert.equal(typeof parseSubmission({ ...run, player: 'x' }), 'string', 'bad player id');
    assert.equal(typeof parseSubmission({ ...run, cmds: 'all' }), 'string', 'bad command list');
  });

  test('portable maths is recorded with the game; older recordings without the flag replay with the engine\'s maths', () => {
    const fresh = boardSetup('challenge', 'b-armoured-clash')!;
    assert.equal(portableMathFor(withPortableFlag(fresh)), true, 'a new ranked run uses portable maths');
    assert.equal(withPortableFlag(fresh).dmath, true, 'and records it');
    assert.equal(portableMathFor(withPortableFlag({ ...fresh, challenge: undefined, mission: undefined } as GameSetup)), false, 'a skirmish keeps the engine\'s maths');
    // a built-in challenge recorded before the flag existed: engine maths, no field
    const g = headlessGame(fresh), w = g.world, me = g.local;
    const rec = new CommandRecorder(w);
    hookStep(w, null, () => rec.afterStep());
    let first = true;
    while (!w.gameOver && w.tick < 2400) {
      if (first || w.tick % 100 === 1) {
        first = false;
        const army = w.units.filter((u) => u.alive && u.owner === me && u.weapons.length).map((u) => u.id);
        const foe = w.units.find((u) => u.alive && me.isEnemy(u.owner));
        if (army.length && foe) { const c: Command = { c: 'move', player: me.id, units: army, x: foe.x, y: foe.y, attackMove: true }; rec.record(c); w.issue(c); }
      }
      w.step(); w.events.length = 0; w.mission!.events.length = 0;
    }
    const replaySetup = { ...fresh, replay: { data: {} as never } } as GameSetup; // (as the replay screen starts it)
    const replay = (portable: boolean) => {
      const run = () => {
        const p = headlessGame({ ...fresh }), pw = p.world;
        const feeder = new CommandFeeder(pw, rec.cmds, rec.hashes);
        hookStep(pw, () => feeder.beforeStep(), () => feeder.afterStep());
        while (pw.tick < w.tick) { pw.step(); pw.events.length = 0; pw.mission!.events.length = 0; }
        return feeder;
      };
      return portable ? withPortableMath(run) : run();
    };
    const asLoaded = withPortableFlag(replaySetup);
    assert.equal(asLoaded.dmath, undefined, 'a replay is not given the flag');
    const ok = replay(portableMathFor(asLoaded));
    assert.ok(ok.checked >= 2, `hashes compared (${ok.checked})`);
    assert.equal(ok.desyncTick, -1, 'the old recording replays without a desync');
    assert.ok(replay(true).desyncTick > 0, 'with portable maths it would have desynced (so the flag matters)');
  });

  test('the store keeps one best entry per player, bounded per-day tops, and prunes old days', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rh-lb-'));
    try {
      const file = join(dir, 'lb.json');
      // days relative to today: flush() prunes against the real clock
      const day = new Date().toISOString().slice(0, 10);
      const old = new Date(Date.now() - 45 * 86400_000).toISOString().slice(0, 10);
      const st = new LeaderboardStore({ file, top: 5, keepDays: 7, writeDelayMs: 1 });
      const add = (p: string, s: number, day0 = day, t = 1000) => st.add('daily', day0, { n: `P${p}`, s, t, w: true, a: Date.parse(day0), player: `player-${p}-0123456789abcdef` });
      assert.equal(add('a', 100).rank, 1, 'first entry');
      assert.equal(add('a', 50).improved, false, 'a worse run does not replace the best');
      assert.equal(add('a', 300).rank, 1, 'a better one does');
      for (let i = 0; i < 8; i++) add(String(i), 10 + i);
      const top = st.list('daily', day, 'player-a-0123456789abcdef');
      assert.equal(top.length, 5, 'capped');
      assert.equal(top[0].score, 300, 'best first');
      assert.equal(top[0].you, true, 'your own entry is marked');
      assert.equal(top.filter((e) => e.name === 'Pa').length, 1, 'one entry per player');
      assert.ok(!JSON.stringify(top).includes('player-'), 'player ids are never returned');
      add('z', 999, old);
      st.flush();
      const saved = JSON.parse(readFileSync(file, 'utf8'));
      assert.ok(!JSON.stringify(saved).includes('player-a'), 'the file keeps salted keys, not the ids');
      st.prune(day);
      assert.deepEqual(st.days('daily'), [day], 'days older than keepDays pruned');
      const again = new LeaderboardStore({ file, top: 5 });
      assert.equal(again.list('daily', day)[0].score, 300, 'reloads from disk');
      const tiny = new LeaderboardStore({ file: null, maxBytes: 600 });
      for (let d = 1; d <= 9; d++) tiny.add('daily', `2026-10-0${d}`, { n: 'x', s: d, t: 1, w: true, a: 0, player: 'player-x-0123456789abcdef' });
      tiny.prune('2026-10-09');
      assert.ok(tiny.size <= 600, `size capped (${tiny.size})`);
      assert.equal(tiny.days('daily')[0], '2026-10-09', 'newest days kept');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('verification runs one at a time and turns work away when busy', async () => {
    let running = 0, max = 0;
    const q = new VerifyQueue({
      maxQueue: 2, timeoutMs: 5000, maxTicks: 100_000,
      inline: (s, maxTicks) => { running++; max = Math.max(max, running); const r = verifyRun(s, { maxTicks }); running--; return r; },
    });
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => q.submit(run)));
    assert.equal(max, 1, 'never two at once');
    assert.equal(results.filter((r) => r.ok).length, 3, 'the running one and two waiting verified');
    assert.equal(results.filter((r) => !r.ok && 'busy' in r).length, 2, 'the rest turned away');
  });

  test('a run that takes too long is stopped (worker thread time limit)', async () => {
    const q = new VerifyQueue({ maxQueue: 1, timeoutMs: 400, maxTicks: 200_000 });
    const long: Submission = { ...run, kind: 'survival', id: 'survival', ticks: 150_000, cmds: [] }; // survival waves for two hours
    const t0 = Date.now();
    const r = await q.submit(long);
    assert.equal(r.ok, false, 'rejected');
    assert.match((r as { reason: string }).reason, /too long/, 'for the time limit');
    assert.ok(Date.now() - t0 < 8000, `promptly (${Date.now() - t0} ms)`);
    const ok = await new VerifyQueue({ maxQueue: 1, timeoutMs: 60_000, maxTicks: 100_000 }).submit(run);
    assert.deepEqual(ok, { ok: true, score: run.score, ticks: run.ticks, won: true }, 'the worker path verifies real runs');
  });
});

const hasWs = existsSync(new URL('../server/node_modules/ws/package.json', import.meta.url));

describe('leaderboard over HTTP', { skip: hasWs ? false : 'server dependencies not installed (npm ci --prefix server)' }, () => {
  test('submit, rank, read back; tampered, oversize, foreign and flooding requests are refused', async () => {
    const { createRelayServer } = await import('../server/src/http');
    const { loadConfig } = await import('../server/src/config');
    const run = playRun('challenge', 'b-armoured-clash');
    const cfg = loadConfig({ RELAY_PORT: '0', LB_FILE: '', LB_SUBMITS_PER_HOUR: '5', RELAY_ALLOWED_ORIGINS: 'https://game.example' });
    const srv = createRelayServer(cfg, { log: () => {}, queue: new VerifyQueue({ maxQueue: 2, timeoutMs: 20_000, maxTicks: 100_000, inline: (s, maxTicks) => verifyRun(s, { maxTicks }) }) });
    await new Promise<void>((r) => srv.server.listen(0, '127.0.0.1', () => r()));
    const base = `http://127.0.0.1:${(srv.server.address() as { port: number }).port}/relay`;
    const post = (path: string, body: unknown, headers: Record<string, string> = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
    try {
      const ok = await post('/lb/submit', run);
      const j = await ok.json() as { ok: boolean; rank: number; score: number };
      assert.equal(ok.status, 200, 'accepted');
      assert.equal(j.rank, 1, 'ranked first');
      assert.equal(j.score, run.score, 'with the verified score');
      const top = await (await post('/lb/top', { kind: 'challenge', id: 'b-armoured-clash', player: PLAYER })).json() as { entries: { name: string; score: number; you?: boolean }[] };
      assert.equal(top.entries.length, 1, 'listed');
      assert.equal(top.entries[0].score, run.score, 'score');
      assert.equal(top.entries[0].you, true, 'marked as yours');
      const tampered = await post('/lb/submit', { ...run, score: run.score * 2, player: 'other-player-0123456789ab' });
      assert.equal(tampered.status, 422, 'tampered run rejected');
      assert.equal((await post('/lb/submit', { ...run, build: 'old' })).status, 409, 'other build');
      assert.equal((await post('/lb/submit', { ...run, kind: 'daily', id: 'daily', day: '2020-01-01' })).status, 422, 'closed daily');
      assert.equal((await post('/lb/submit', 'x'.repeat(1_100_000))).status, 413, 'oversize');
      assert.equal((await post('/lb/top', { kind: 'daily', id: 'daily' }, { origin: 'https://evil.example' })).status, 403, 'foreign origin');
      const cors = await post('/lb/top', { kind: 'daily', id: 'daily' }, { origin: 'https://game.example' });
      assert.equal(cors.headers.get('access-control-allow-origin'), 'https://game.example', 'allowed origin gets CORS');
      assert.equal(cors.headers.get('x-content-type-options'), 'nosniff', 'strict headers');
      let limited = 0;
      for (let i = 0; i < 8; i++) if ((await post('/lb/submit', { ...run, score: 1 })).status === 429) limited++;
      assert.ok(limited >= 3, `submissions rate-limited (${limited})`);
    } finally {
      await srv.close();
    }
  });
});
