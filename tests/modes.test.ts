// Round-5 modes (src/modes): King of the Hill, challenges (built-ins, goals, scoring, files, bests,
// moments) and co-op survival with AI allies. All headless and deterministic.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { GameSetup } from '../src/game';
import { headlessGame, run } from '../src/modes/headless';
import { findHill, hillRadius } from '../src/modes/koth';
import { BUILTINS, BUILTIN_LIST } from '../src/modes/builtins';
import { challengeResult, goalText } from '../src/modes/challenge';
import { challengeFromMoment, challengeFromState, challengeGameSetup, notableTargets } from '../src/modes/author';
import { MomentTracker } from '../src/modes/moments';
import { decodeChallengeFile, encodeChallengeFile, isChallengeDef, loadBests, recordAttempt } from '../src/modes/store';
import type { ChallengeDef, KothState } from '../src/modes/types';
import { snapshotWorld } from '../src/replay/branch';
import { worldHash } from '../src/replay/hash';
import { getMission } from '../src/missions';
import { coopMissionId, parseCoopId } from '../src/missions/special';
import { floodReach } from '../src/sim/mapgen';
import { AIController } from '../src/sim/ai';
import { serializeWorld } from '../src/sim/save';
import type { World } from '../src/sim/world';
import { seconds, TICK_HZ } from './helpers';

// a minimal localStorage for the personal-best store
const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage ??= {
  getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, String(v)); }, removeItem: (k: string) => { mem.delete(k); },
};

const SKIRMISH: GameSetup = {
  faction: 'allies', color: 0x3d7be0, opponents: [{ faction: 'soviet', difficulty: 'hard' }], mapSize: 64, water: 0.5, trees: 0.5, ore: 0.6,
  credits: 10000, startUnits: 'light', fog: true, timeOfDay: 'day', quality: 'low', seed: 4711,
};
const koth = (w: World) => w.mission!.flags.koth as KothState;
const ticks = (w: World, n: number) => { for (let k = 0; k < n; k++) { w.step(); w.events.length = 0; if (w.mission) w.mission.events.length = 0; } };

// =============================================================================================
describe('King of the Hill', () => {
  test('the hill is a fair, open, reachable spot near the centre', () => {
    for (const [seed, players, size] of [[4711, 2, 64], [99, 3, 96], [2024, 4, 96]] as const) {
      const g = headlessGame({ ...SKIRMISH, seed, mapSize: size, opponents: Array.from({ length: players - 1 }, () => ({ faction: 'soviet', difficulty: 'easy' })), koth: true });
      const w = g.world;
      const st = koth(w);
      assert.equal(st.r, hillRadius(size), 'radius scales with the map');
      assert.ok(w.map.passable(Math.floor(st.x), Math.floor(st.y)), `hill centre passable (seed ${seed})`);
      const i = w.map.idx(Math.floor(st.x), Math.floor(st.y));
      const starts = w.map.startPositions.slice(0, players);
      for (const s of starts) assert.ok(floodReach(w.map, Math.floor(s.x), Math.floor(s.y))[i], `reachable from ${s.x},${s.y}`);
      const d = starts.map((s) => Math.hypot(s.x - st.x, s.y - st.y));
      assert.ok(Math.max(...d) - Math.min(...d) < 8, `fair distances ${d.map((x) => x.toFixed(1))} (seed ${seed})`);
      assert.ok(Math.hypot(st.x - size / 2, st.y - size / 2) < size * 0.25, 'near the centre');
      assert.deepEqual(findHill(w), { x: st.x, y: st.y, r: st.r }, 'deterministic');
    }
  });

  test('holding alone accumulates, enemies contest, first to the target wins', () => {
    const g = headlessGame({ ...SKIRMISH, startUnits: 'mcv', koth: true, kothMinutes: 0.5 });
    const w = g.world, st = koth(w);
    assert.equal(st.target, 30 * TICK_HZ, 'target from kothMinutes');
    const mine = [0, 1, 2].map((k) => w.addUnit('e6', w.players[0], st.x - 1 + k, st.y));
    ticks(w, TICK_HZ);
    assert.equal(st.holder, 0, 'team 0 holds');
    assert.ok(st.held[0] >= TICK_HZ - 5 && st.held[0] <= TICK_HZ, `held about a second (${st.held[0]})`);
    const foe = w.addUnit('e6', w.players[1], st.x + 1, st.y + 1);
    ticks(w, TICK_HZ);
    const frozen = st.held[0];
    ticks(w, TICK_HZ);
    assert.ok(st.contested && st.holder === -1, 'contested');
    assert.equal(st.held[0], frozen, 'no time while contested');
    assert.equal(st.held[1] ?? 0, 0, 'nor for the contester');
    w.kill(foe, 'sold');
    ticks(w, 30 * TICK_HZ);
    assert.ok(w.gameOver, 'game over');
    assert.equal(w.winnerTeam, 0, 'the holder wins');
    assert.ok(w.mission!.won && /held the hill/.test(w.mission!.endReason ?? ''), `win reason (${w.mission!.endReason})`);
    void mine;
  });

  test('wiping out the enemy still wins', () => {
    const g = headlessGame({ ...SKIRMISH, startUnits: 'mcv', koth: true });
    const w = g.world;
    for (const e of [...w.units, ...w.buildings]) if (e.owner.id === 1) w.kill(e, 'normal');
    ticks(w, 2 * TICK_HZ + 2);
    assert.ok(w.gameOver && w.winnerTeam === 0, 'elimination victory');
  });

  test('AI players contest the hill with squads', () => {
    const g = headlessGame({ ...SKIRMISH, opponents: [{ faction: 'soviet', difficulty: 'hard' }, { faction: 'allies', difficulty: 'normal' }], koth: true, kothMinutes: 8 });
    const w = g.world, st = koth(w);
    let seen = 0, aiOnHill = 0;
    for (let s = 0; s < 150; s++) {
      ticks(w, TICK_HZ);
      if (st.present.some((t) => t !== 0)) aiOnHill++;
      seen = Math.max(seen, Object.values(st.squads).filter((q) => q.length).length);
    }
    assert.equal(seen, 2, 'both AIs field a hill squad');
    assert.ok(aiOnHill > 30, `AI units on the hill for ${aiOnHill} s of 150`);
    assert.ok((st.held[1] ?? 0) + (st.held[2] ?? 0) > 0, 'an AI scored hill time');
  });

  test('deterministic, and save / load mid-match continues identically', () => {
    const setup = { ...SKIRMISH, seed: 31, opponents: [{ faction: 'soviet' as const, difficulty: 'hard' as const }, { faction: 'allies' as const, difficulty: 'hard' as const }], koth: true, kothMinutes: 3 };
    const a = headlessGame(setup), b = headlessGame(setup);
    ticks(a.world, seconds(120));
    ticks(b.world, seconds(120));
    assert.equal(worldHash(a.world), worldHash(b.world), 'two runs agree');
    const save = JSON.parse(JSON.stringify(serializeWorld(a.world)));
    const c = headlessGame({ ...setup, load: { version: 1, savedAt: 0, world: save, game: {} } });
    assert.deepEqual(koth(c.world), koth(a.world), 'hill state restored');
    ticks(a.world, seconds(90));
    ticks(c.world, seconds(90));
    assert.equal(worldHash(c.world), worldHash(a.world), 'loaded game continues identically');
    assert.deepEqual(koth(c.world).held, koth(a.world).held, 'same hill times');
  });
});

// =============================================================================================
describe('challenges', () => {
  const builtinSetup = (c: ChallengeDef) => challengeGameSetup(c, 'low');

  test('3–5 built-ins, each a valid challenge that builds its stage', () => {
    assert.ok(BUILTIN_LIST.length >= 3 && BUILTIN_LIST.length <= 5, `${BUILTIN_LIST.length} built-ins`);
    for (const c of BUILTIN_LIST) {
      assert.ok(isChallengeDef(c), `${c.id} is a valid challenge`);
      const g = headlessGame(builtinSetup(c));
      const w = g.world, m = w.mission!;
      assert.ok(m && m.objectives.some((o) => o.id === 'goal'), `${c.id}: goal objective`);
      assert.equal(m.humanId, c.side, `${c.id}: side`);
      const ch = m.flags.ch;
      assert.ok(ch && ch.limit === c.timeLimit * TICK_HZ, `${c.id}: time limit`);
      if (c.goal.kind === 'destroy' || c.goal.kind === 'protect') assert.ok(ch.targets.length && ch.targets.every((id: number) => w.getEntity(id)?.alive), `${c.id}: targets exist`);
      if (c.goal.kind === 'hold') assert.ok(ch.zone && w.map.passable(Math.floor(ch.zone.x), Math.floor(ch.zone.y)), `${c.id}: zone`);
      assert.ok(w.units.some((u) => u.owner.id === 0) && w.units.some((u) => u.owner.id === 1), `${c.id}: both sides have forces`);
      assert.ok(!w.units.some((u) => u.alive && u.ut.deploysInto), `${c.id}: starting MCVs cleared`);
      assert.equal(w.players[0].stats.unitsLost, 0, `${c.id}: clearing the kit is not a loss`);
      ticks(w, seconds(40));
      assert.ok(!w.gameOver || challengeResult(m), `${c.id}: runs`);
    }
  });

  test('built-in challenges are deterministic', () => {
    for (const c of BUILTIN_LIST) {
      const a = headlessGame(builtinSetup(c)), b = headlessGame(builtinSetup(c));
      ticks(a.world, seconds(75));
      ticks(b.world, seconds(75));
      assert.equal(worldHash(a.world), worldHash(b.world), `${c.id} deterministic`);
    }
  });

  test('a challenge is won or lost with a deterministic result and score', () => {
    const c = BUILTINS['b-armoured-clash'].def;
    const play = () => {
      const g = headlessGame(builtinSetup(c));
      const w = g.world;
      run(w, seconds(260), () => {
        if (w.tick % (TICK_HZ * 4) !== 0) return;
        const foe = w.units.find((u) => u.alive && u.owner.id === 1);
        const mine = w.units.filter((u) => u.alive && u.owner.id === 0 && u.order.type === 'idle').map((u) => u.id);
        if (foe && mine.length) w.issue({ c: 'move', player: 0, units: mine, x: foe.x, y: foe.y, attackMove: true });
      });
      return { w, res: challengeResult(w.mission) };
    };
    const a = play(), b = play();
    assert.ok(a.w.gameOver, 'the challenge ended');
    assert.ok(a.res, 'result computed');
    assert.deepEqual(a.res, b.res, 'same result twice');
    if (a.res!.won) {
      assert.ok(a.res!.score >= 1000 && a.res!.stars >= 1, `won: score ${a.res!.score}, ${a.res!.stars} stars`);
      assert.equal(a.w.winnerTeam, 0, 'winner');
    } else assert.equal(a.res!.score, 0, 'a failed attempt scores 0');
    assert.ok(a.res!.kills > 0, 'kills counted');
  });

  test('protect fails when the target falls; survive / time limit succeed', () => {
    const c = BUILTINS['b-last-bastion'].def;
    const g = headlessGame(builtinSetup(c));
    const w = g.world;
    const yard = w.getEntity(w.mission!.flags.ch.targets[0])!;
    w.kill(yard, 'normal');
    ticks(w, 3);
    const res = challengeResult(w.mission)!;
    assert.ok(w.gameOver && res && !res.won && res.score === 0, 'lost when the protected structure falls');
    assert.ok(w.mission!.objectives.find((o) => o.id === 'goal')?.state === 'failed', 'objective failed');
    // survive: a short survive challenge made from a quiet moment
    const base = headlessGame({ ...SKIRMISH, startUnits: 'mcv' });
    ticks(base.world, seconds(5));
    const sc = challengeFromState({ setup: SKIRMISH, state: snapshotWorld(base.world), side: 0, goal: { kind: 'survive' }, timeLimit: 20, title: 'Quick' });
    const s = headlessGame(challengeGameSetup(sc, 'low'));
    ticks(s.world, seconds(21));
    const sr = challengeResult(s.world.mission)!;
    assert.ok(sr && sr.won && s.world.winnerTeam === 0, 'survived until the time limit');
    assert.ok(sr.score >= 1000 && sr.bonusLabel === 'Base intact', `score ${sr.score}`);
  });

  test('hold: sole control of the zone for N seconds', () => {
    const base = headlessGame({ ...SKIRMISH, startUnits: 'mcv' });
    const w0 = base.world;
    const hill = findHill(w0);
    for (let k = 0; k < 3; k++) w0.addUnit('e6', w0.players[0], hill.x - 1 + k, hill.y);
    ticks(w0, 4);
    const c = challengeFromState({ setup: SKIRMISH, state: snapshotWorld(w0), side: 0, goal: { kind: 'hold', seconds: 10, x: hill.x, y: hill.y, r: 4 }, timeLimit: 60, title: 'Hold' });
    assert.match(goalText(c.goal, c.timeLimit), /Hold the zone for 0:10/, 'objective text');
    const g = headlessGame(challengeGameSetup(c, 'low'));
    ticks(g.world, seconds(9));
    assert.ok(!g.world.gameOver, 'not yet');
    ticks(g.world, seconds(2));
    const res = challengeResult(g.world.mission)!;
    assert.ok(g.world.gameOver && res.won, 'zone held');
    assert.ok(res.bonus > 700, `time bonus ${res.bonus}`);
  });

  test('a challenge from a moment can put the challenger on any side', () => {
    const base = headlessGame({ ...SKIRMISH, seed: 77 });
    const mcv = base.world.units.find((u) => u.owner.id === 0 && u.ut.deploysInto)!;
    base.world.issue({ c: 'deploy', player: 0, units: [mcv.id] });
    ticks(base.world, seconds(120));
    const opts = notableTargets(base.world, 1);
    const target = opts.enemy.find((o) => o.key.endsWith(':fact'));
    assert.ok(target, `enemy construction yard offered (${opts.enemy.map((o) => o.label).join(', ')})`);
    assert.ok(opts.own.length > 0, 'own structures offered');
    const c = challengeFromState({ setup: { ...SKIRMISH, seed: 77 }, state: snapshotWorld(base.world), side: 1, ai: 'hard', goal: { kind: 'destroy', targets: target!.ids }, timeLimit: 300, title: 'Reverse' });
    const g = headlessGame(challengeGameSetup(JSON.parse(JSON.stringify(c)), 'low'));
    assert.equal(g.local.id, 1, 'challenger commands player 1');
    assert.equal(g.world.mission!.humanId, 1, 'runtime human');
    assert.ok(g.world.players[1].isHuman && !g.world.players[0].isHuman, 'roster');
    assert.equal(g.world.tick, base.world.tick, 'starts at the moment');
    assert.equal(worldHash(g.world), worldHash(base.world), 'from the exact state');
    for (const id of target!.ids) g.world.kill(g.world.getEntity(id)!, 'normal');
    ticks(g.world, 2);
    assert.ok(challengeResult(g.world.mission)?.won, 'destroying the target wins');
    assert.equal(g.world.winnerTeam, 1, 'for the challenger');
  });

  test('challenge files round-trip (gzip + base64 and plain); bad files are rejected', async () => {
    const base = headlessGame({ ...SKIRMISH, startUnits: 'mcv' });
    const c = challengeFromState({ setup: SKIRMISH, state: snapshotWorld(base.world), side: 0, goal: { kind: 'win' }, timeLimit: 600, title: 'Round trip' });
    const gz = await encodeChallengeFile(c);
    assert.match(gz, /"encoding":"gzip\+base64"/, 'compressed');
    const plain = await encodeChallengeFile(c, false);
    assert.ok(gz.length < plain.length * 0.5, `smaller (${gz.length} vs ${plain.length})`);
    assert.deepEqual(await decodeChallengeFile(gz), JSON.parse(JSON.stringify(c)), 'gzip round trip');
    assert.deepEqual(await decodeChallengeFile(plain), JSON.parse(JSON.stringify(c)), 'plain round trip');
    assert.deepEqual(await decodeChallengeFile(JSON.stringify(c)), JSON.parse(JSON.stringify(c)), 'a bare definition imports too');
    await assert.rejects(decodeChallengeFile('{nope'), /invalid JSON/, 'invalid JSON');
    await assert.rejects(decodeChallengeFile(JSON.stringify({ rhchallenge: 1, challenge: { v: 2 } })), /Not a Red Horizon challenge/, 'wrong shape');
    await assert.rejects(decodeChallengeFile(JSON.stringify({ rhchallenge: 1, encoding: 'gzip+base64', data: 'AAAA' })), /damaged/, 'damaged data');
    const bi = await decodeChallengeFile(await encodeChallengeFile(BUILTIN_LIST[0]));
    assert.equal(bi.builtin, BUILTIN_LIST[0].builtin, 'built-ins export as their id');
  });

  test('personal bests keep the best score, stars and time', () => {
    const r = (won: boolean, score: number, stars: number, time: number) => ({ won, score, stars, time, kills: 0, structuresKilled: 0, losses: 0, structuresLost: 0, bonus: 0, bonusLabel: '' });
    const a = recordAttempt('t1', r(false, 0, 0, 50));
    assert.ok(!a.newBest && a.best.attempts === 1 && a.best.completed === 0, 'failed attempt');
    const b = recordAttempt('t1', r(true, 1500, 2, 120));
    assert.ok(b.newBest && b.best.bestScore === 1500 && b.best.bestStars === 2 && b.best.bestTime === 120, 'first completion');
    const c = recordAttempt('t1', r(true, 1200, 3, 90));
    assert.ok(!c.newBest && c.best.bestScore === 1500 && c.best.bestStars === 3 && c.best.bestTime === 90, 'keeps the bests');
    assert.equal(loadBests().t1.attempts, 3, 'stored');
  });
});

// =============================================================================================
describe('moments: "make this a challenge"', () => {
  test('a siege is detected from snapshots and becomes a playable challenge', () => {
    const g = headlessGame({ ...SKIRMISH, seed: 808 });
    const w = g.world;
    const tr = new MomentTracker(w, () => g.local, () => ({ cam: { x: 1, y: 2, dist: 20 } }));
    const step = (n: number) => { for (let k = 0; k < n; k++) { w.step(); w.events.length = 0; tr.afterStep(); } };
    w.issue({ c: 'deploy', player: 0, units: [w.units.find((u) => u.owner.id === 0 && u.ut.deploysInto)!.id] });
    step(seconds(200));
    const yard = w.buildings.find((b) => b.owner.id === 0 && b.bt.id === 'fact');
    assert.ok(yard, 'the human deployed');
    for (let k = 0; k < 10; k++) w.addUnit('4tnk', w.players[1], yard!.x + 3 + (k % 3), yard!.y + 2 + Math.floor(k / 3));
    step(seconds(4));
    const m = tr.moments.siege;
    assert.ok(m, 'siege detected');
    assert.ok(m!.tick < m!.at && m!.tick % (20 * TICK_HZ) === 0, 'starts from an earlier snapshot');
    const offers = tr.offers(false);
    assert.ok(offers.some((o) => o.kind === 'siege'), 'offered');
    const c = challengeFromMoment(m!, SKIRMISH, 0, 'Test');
    assert.ok(isChallengeDef(c), 'valid challenge');
    assert.equal(c.goal.kind, 'protect', 'protect the yard');
    const p = headlessGame(challengeGameSetup(c, 'low'));
    assert.equal(p.world.tick, m!.tick, 'starts at the snapshot');
    assert.ok(c.goal.targets!.every((id) => p.world.getEntity(id)?.alive), 'target exists in the state');
    assert.ok(p.world.mission?.objectives.some((o) => o.id === 'goal'), 'goal objective');
  });

  test('a lost battle is a turning point (production alone is not)', () => {
    const g = headlessGame({ ...SKIRMISH, seed: 1212, startUnits: 'mcv' });
    const w = g.world;
    const tr = new MomentTracker(w, () => g.local, () => ({}));
    const step = (n: number) => { for (let k = 0; k < n; k++) { w.step(); w.events.length = 0; tr.afterStep(); } };
    step(seconds(100));
    const enemyBase = w.map.startPositions[1];
    for (let k = 0; k < 6; k++) w.addUnit('4tnk', w.players[1], enemyBase.x + (k % 3), enemyBase.y + 3 + Math.floor(k / 3));
    step(seconds(70));
    assert.equal(tr.moments.swing, undefined, 'an enemy army appearing is not a swing');
    const at = w.map.startPositions[0];
    const fightAt = w.tick;
    // an ambush: our tanks hold fire (a one-sided loss), the mammoths roll over them
    const mine = Array.from({ length: 8 }, (_, k) => w.addUnit('2tnk', w.players[0], at.x + 3 + (k % 4), at.y - 3 - Math.floor(k / 4)));
    for (const u of mine) u.stance = 'passive';
    const foes = Array.from({ length: 10 }, (_, k) => w.addUnit('4tnk', w.players[1], at.x + 5 + (k % 4), at.y - 7 - Math.floor(k / 4)));
    w.issue({ c: 'move', player: 1, units: foes.map((u) => u.id), x: at.x + 4, y: at.y - 4, attackMove: true });
    step(seconds(80));
    const m = tr.moments.swing;
    assert.ok(m && m.info.drop >= 2000, `swing pinned (${m?.info.drop}, army left ${mine.filter((u) => u.alive).length})`);
    assert.ok(m!.tick <= fightAt && m!.tick % (20 * TICK_HZ) === 0, `starts from a snapshot before the losses (${m!.tick} <= ${fightAt})`);
  });

  test('moment tracking only reads the world (same game with and without it)', () => {
    const a = headlessGame({ ...SKIRMISH, seed: 4545 }), b = headlessGame({ ...SKIRMISH, seed: 4545 });
    const tr = new MomentTracker(a.world, () => a.local, () => ({}));
    for (let k = 0; k < seconds(150); k++) { a.world.step(); a.world.events.length = 0; tr.afterStep(); b.world.step(); b.world.events.length = 0; }
    assert.equal(worldHash(a.world), worldHash(b.world), 'identical');
  });

  test('an incoming enemy nuke is a moment', () => {
    const g = headlessGame({ ...SKIRMISH, seed: 909 });
    const w = g.world;
    const tr = new MomentTracker(w, () => g.local, () => ({}));
    const step = (n: number) => { for (let k = 0; k < n; k++) { w.step(); w.events.length = 0; tr.afterStep(); } };
    step(seconds(45));
    while (w.tick % 10 !== 4) step(1);
    w.tick++; // (a step's worth: checkNuke runs at tick % 10 === 5)
    const s0 = w.map.startPositions[0];
    w.projectiles.push({ id: 99999, weapon: { id: 'Nuke' } as never, owner: w.players[1], shooter: 0, kind: 'scud', x: 1, y: 1, z: 1, prevX: 1, prevY: 1, prevZ: 1, sx: 1, sy: 1, sz: 1, tx: s0.x, ty: s0.y, tz: 0, target: null, t: 0, dur: 99, arc: 1, speed: 0, vx: 0, vy: 0, alive: true, special: 'nuke' } as never);
    tr.afterStep();
    w.projectiles.length = 0;
    w.tick--;
    assert.ok(tr.moments.nuke, 'nuke moment pinned');
    assert.ok(tr.offers(true)[0].kind === 'nuke', 'offered first');
  });
});

// =============================================================================================
describe('co-op survival', () => {
  const COOP: GameSetup = { ...SKIRMISH, opponents: [], mission: 'survival', allies: [{ difficulty: 'hard' }] };

  test('co-op ids round-trip and resolve to missions with AI teammates', () => {
    const id = coopMissionId('survival-winter', [{ difficulty: 'hard' }, { faction: 'allies', difficulty: 'normal' }]);
    assert.equal(id, 'survival-winter:coop:hard+allies.normal', 'id');
    assert.deepEqual(parseCoopId(id)?.allies, [{ faction: undefined, difficulty: 'hard' }, { faction: 'allies', difficulty: 'normal' }], 'parsed');
    assert.equal(parseCoopId('survival:coop:godlike'), null, 'bad difficulty rejected');
    assert.equal(parseCoopId('allied-01:coop:hard'), null, 'only survival variants');
    const def = getMission('survival:coop:hard')!;
    assert.ok(def && def.players.length === 3 && def.players[2].team === 0 && def.players[2].ai === 'hard', 'teammate on the human team');
    assert.equal(getMission('survival:coop:hard'), def, 'cached definition');
    assert.equal(getMission('survival')!.players.length, 2, 'solo survival unchanged');
  });

  test('allies share the team with separate bases, and waves go for every base', () => {
    const g = headlessGame({ ...COOP, allies: [{ difficulty: 'hard' }, { difficulty: 'normal' }] });
    const w = g.world;
    assert.equal(w.mission!.def.id, 'survival:coop:hard+normal', 'co-op mission');
    const [human, horde, a1, a2] = w.players;
    assert.ok(a1.team === human.team && a2.team === human.team && horde.team !== human.team, 'same team');
    assert.ok(!a1.isEnemy(human) && a1.isEnemy(horde), 'allied, against the horde');
    assert.deepEqual(w.ais.map((a) => a.player.id).sort(), [1, 2, 3], 'teammates run the AIController');
    w.ais.push(new AIController(w, human, 'hard')); // autopilot for the human
    ticks(w, seconds(330));
    const centre = (pid: number) => { const bs = w.buildings.filter((b) => b.alive && b.owner.id === pid); return bs.length ? [bs[0].x, bs[0].y] : null; };
    const c0 = centre(0), c2 = centre(2), c3 = centre(3);
    assert.ok(c0 && c2 && c3, 'every defender built a base');
    assert.ok(Math.hypot(c0![0] - c2![0], c0![1] - c2![1]) > 15 && Math.hypot(c0![0] - c3![0], c0![1] - c3![1]) > 15, 'separate bases');
    const targets = w.mission!.flags.waveTargets as number[];
    assert.ok(targets.length >= 3, `waves launched (${targets})`);
    assert.ok(targets.includes(0) && targets.includes(2) && targets.includes(3), `waves target every base (${targets})`);
  });

  test('co-op survival is deterministic and survives save / load', () => {
    const a = headlessGame(COOP), b = headlessGame(COOP);
    ticks(a.world, seconds(150));
    ticks(b.world, seconds(150));
    assert.equal(worldHash(a.world), worldHash(b.world), 'two runs agree');
    assert.ok(a.world.mission!.flags.wave >= 1, 'waves are coming');
    const save = JSON.parse(JSON.stringify(serializeWorld(a.world)));
    const c = headlessGame({ ...COOP, load: { version: 1, savedAt: 0, world: save, game: {} } });
    assert.equal(c.world.mission!.flags.allies, 1, 'co-op flags restored');
    ticks(a.world, seconds(60));
    ticks(c.world, seconds(60));
    assert.equal(worldHash(c.world), worldHash(a.world), 'loaded game continues identically');
    assert.equal(c.world.mission!.score, a.world.mission!.score, 'same score');
  });
});
