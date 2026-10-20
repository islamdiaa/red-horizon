/**
 * The newcomer-friendly difficulty layer around the AI: Recruit everywhere a level is chosen or validated, Quick
 * Battle's starting level and promotion, newcomer-safe mutators, rival caps, dynamic difficulty's default, the
 * Field Manual coaching alerts and the results screen's economy tip.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { AI_DIFFICULTIES } from '../src/sim/ai';
import { capDifficulty, difficultyIndex, dynamicDefault, isDifficulty, isNewcomerLevel, stepDifficulty } from '../src/modes/difficulty';
import { quickRivalLevel, quickSkill, rollQuickBattle } from '../src/modes/quickbattle';
import { MUTATORS, MUTATOR_BY_ID, surpriseMutators } from '../src/modes/mutators';
import { normalizeProfile } from '../src/meta/profile';
import { parseClientMessage } from '../src/net/protocol';
import { parseCoopId } from '../src/missions/special';
import { AI_MODES } from '../src/editor/mission';
import {
  CoachWatch, economyAdvice, economyFacts, firstWaveIncoming, hasDefences, incomeGap, refineryCount, secondRefineryDue, type EconomyFacts,
} from '../src/ui/coach';
import { idleFactories } from '../src/ui/army';
import type { ReportSample } from '../src/meta/report';
import { building, powerUp, run, sandbox, seconds } from './helpers';

const NEWCOMER_SAFE = ['night-ops', 'blizzard', 'sandstorm', 'storm-front', 'credits-rain', 'veteran-start', 'heavy-metal', 'big-guns'];
const stats = (games: Record<string, number>, wins: Record<string, number>, skirmishes = 1) => ({ skirmishes, gamesByDifficulty: games, winsByDifficulty: wins });

describe('difficulty levels', () => {
  test('Recruit is the easiest level, everywhere a level is validated', () => {
    assert.deepEqual([...AI_DIFFICULTIES], ['recruit', 'easy', 'normal', 'hard', 'brutal'], 'five levels, easiest first');
    assert.ok(isDifficulty('recruit') && !isDifficulty('nope') && !isDifficulty(undefined), 'isDifficulty');
    assert.equal(difficultyIndex('recruit'), 0, 'recruit first');
    assert.equal(difficultyIndex('bogus'), difficultyIndex('normal'), 'unknown counts as normal');
    assert.ok(AI_MODES.includes('recruit'), 'editor mission AI modes');
    const slot = (ai: string) => parseClientMessage(JSON.stringify({ t: 'slot', slot: 1, kind: 'ai', ai }));
    assert.ok(slot('recruit'), 'the lobby protocol accepts recruit AI slots');
    assert.equal(slot('godlike'), null, 'and still rejects unknown levels');
    assert.ok(parseCoopId('survival:coop:recruit'), 'stored co-op ids with a recruit ally validate');
  });

  test('helpers: step, cap, newcomer levels, dynamic default', () => {
    assert.equal(stepDifficulty('recruit', 1), 'easy', 'one up');
    assert.equal(stepDifficulty('brutal', 1), 'brutal', 'clamped at the top');
    assert.equal(stepDifficulty('easy', -3), 'recruit', 'clamped at the bottom');
    assert.equal(capDifficulty('hard', 'easy'), 'easy', 'capped');
    assert.equal(capDifficulty('recruit', 'hard'), 'recruit', 'below the cap: unchanged');
    assert.ok(isNewcomerLevel('recruit') && isNewcomerLevel('easy') && !isNewcomerLevel('normal'), 'newcomer levels');
    assert.equal(dynamicDefault(['recruit']), true, 'on against a recruit');
    assert.equal(dynamicDefault(['easy', 'recruit']), true, 'on when every AI is recruit or easy');
    assert.equal(dynamicDefault(['easy', 'normal']), false, 'off as soon as one AI is normal or above');
    assert.equal(dynamicDefault([]), false, 'no opponents: off');
  });

  test('profiles from before Recruit load with a zero recruit record', () => {
    const p = normalizeProfile({ v: 2, stats: { skirmishes: 4, gamesByDifficulty: { easy: 4, normal: 1, hard: 0, brutal: 0 }, winsByDifficulty: { easy: 3, normal: 0, hard: 0, brutal: 0 } } });
    assert.equal(p.stats.gamesByDifficulty.recruit, 0, 'recruit games filled in');
    assert.equal(p.stats.winsByDifficulty.recruit, 0, 'recruit wins filled in');
    assert.equal(p.stats.gamesByDifficulty.easy, 4, 'the rest kept');
    assert.equal(quickSkill(p.stats), 'normal', 'an old record still promotes (three wins of four on easy)');
  });
});

describe('Quick Battle level', () => {
  test('a newcomer starts on Recruit and stays there until they master it', () => {
    assert.equal(quickSkill(null), 'recruit', 'no profile');
    assert.equal(quickSkill(stats({}, {}, 0)), 'recruit', 'no skirmishes yet');
    assert.equal(quickSkill(stats({ recruit: 2 }, { recruit: 2 })), 'recruit', 'two wins: not yet');
    assert.equal(quickSkill(stats({ recruit: 6 }, { recruit: 3 })), 'recruit', 'three wins at 50%: not yet');
    assert.equal(quickSkill(stats({ recruit: 5 }, { recruit: 3 })), 'easy', 'three wins at 60%: up to easy');
    assert.equal(quickSkill(stats({ recruit: 20, easy: 8, normal: 6 }, { recruit: 4, easy: 1, normal: 2 })), 'recruit', 'many games, nothing mastered: recruit');
  });

  test('promotion is one level at a time, from the highest level mastered', () => {
    assert.equal(quickSkill(stats({ recruit: 10 }, { recruit: 10 })), 'easy', 'a perfect recruit record: only easy');
    assert.equal(quickSkill(stats({ recruit: 4, easy: 3 }, { recruit: 4, easy: 2 })), 'easy', 'easy not mastered yet');
    assert.equal(quickSkill(stats({ recruit: 4, easy: 5 }, { recruit: 4, easy: 3 })), 'normal', 'easy mastered: normal');
    assert.equal(quickSkill(stats({ recruit: 3, normal: 5 }, { recruit: 3, normal: 3 })), 'hard', 'the highest mastered level counts');
    assert.equal(quickSkill(stats({ hard: 5 }, { hard: 3 })), 'brutal', 'beat hard in regular skirmishes: straight to brutal');
    assert.equal(quickSkill(stats({ brutal: 4 }, { brutal: 4 })), 'brutal', 'capped at brutal');
    assert.equal(quickSkill(stats({ normal: 6, hard: 4 }, { normal: 5, hard: 2 })), 'hard', 'old records without recruit entries');
  });

  test('Recruit and Easy roll exactly one newcomer-safe mutator, with dynamic difficulty on', () => {
    const flagged = MUTATORS.filter((m) => m.newcomer).map((m) => m.id).sort();
    assert.deepEqual(flagged, [...NEWCOMER_SAFE].sort(), 'the newcomer-safe pool');
    assert.ok(MUTATORS.filter((m) => m.newcomer).every((m) => m.quick), 'all of them are Quick Battle mutators');
    for (const skill of ['recruit', 'easy'] as const) {
      for (let s = 1; s < 60; s++) {
        const a = rollQuickBattle(s, { faction: s % 2 ? 'allies' : 'soviet', color: 0x3d7be0, quality: 'low', skill });
        assert.deepEqual(a, rollQuickBattle(s, { faction: s % 2 ? 'allies' : 'soviet', color: 0x3d7be0, quality: 'low', skill }), 'deterministic per seed');
        assert.equal(a.mutators!.length, 1, `${skill}: exactly one mutator (${a.mutators})`);
        assert.ok(NEWCOMER_SAFE.includes(a.mutators![0]), `${skill}: newcomer-safe (${a.mutators})`);
        assert.equal(a.dynamicDifficulty, true, `${skill}: dynamic difficulty on`);
        assert.equal(a.opponents[0].difficulty, skill, 'at the skill level');
      }
    }
  });

  test('Normal and up keep 1-2 Quick Battle mutators and no dynamic difficulty', () => {
    let two = 0;
    for (let s = 1; s < 60; s++) {
      const a = rollQuickBattle(s, { faction: 'allies', color: 0x3d7be0, quality: 'low', skill: 'normal' });
      assert.ok(a.mutators!.length >= 1 && a.mutators!.length <= 2, `1-2 mutators (${a.mutators})`);
      assert.ok(a.mutators!.every((id) => MUTATOR_BY_ID[id].quick), 'Quick Battle pool');
      assert.equal(a.dynamicDifficulty, false, 'dynamic difficulty off');
      if (a.mutators!.length === 2) two++;
    }
    assert.ok(two > 5, `two mutators still happen (${two})`);
  });

  test('surpriseMutators: the newcomer pool, deterministic per seed', () => {
    for (const climate of ['temperate', 'winter', 'desert'] as const) {
      for (let s = 1; s < 80; s++) {
        const ids = surpriseMutators(s, { climate, faction: 'allies' }, { count: 1, quick: true, newcomer: true });
        assert.equal(ids.length, 1, 'one');
        assert.ok(NEWCOMER_SAFE.includes(ids[0]), `newcomer-safe (${ids})`);
        assert.deepEqual(ids, surpriseMutators(s, { climate, faction: 'allies' }, { count: 1, quick: true, newcomer: true }), 'deterministic');
      }
    }
  });

  test('a rival never plays above the commander\'s Quick Battle level', () => {
    assert.equal(quickRivalLevel('hard', 'recruit'), 'recruit', 'capped at the skill');
    assert.equal(quickRivalLevel('easy', 'normal'), 'easy', 'a weaker rival stays weaker');
    const rival = { name: 'Gen. Test', opponent: { faction: 'soviet' as const, difficulty: 'hard' as const } };
    const a = rollQuickBattle(7, { faction: 'allies', color: 0x3d7be0, quality: 'low', skill: 'recruit', rival });
    assert.equal(a.opponents[0].difficulty, 'recruit', 'the rolled rival is capped');
    assert.equal(a.quick!.difficulty, 'recruit', 'and described at that level');
  });
});

describe('coaching alerts', () => {
  test('income gap: 1.6x and $500 a minute more', () => {
    assert.equal(incomeGap(1000, 1700), true, '1.7x, +700');
    assert.equal(incomeGap(1000, 1500), false, '1.5x');
    assert.equal(incomeGap(200, 600), false, '3x but only +400');
    assert.equal(incomeGap(0, 600), true, 'no income at all');
  });

  test('second refinery: from 6:00, with one refinery and ore to mine', () => {
    assert.equal(secondRefineryDue(370, 1, 500), true, 'due');
    assert.equal(secondRefineryDue(300, 1, 500), false, 'too early');
    assert.equal(secondRefineryDue(370, 2, 500), false, 'has two');
    assert.equal(secondRefineryDue(370, 0, 500), false, 'no refinery at all (other advice applies)');
    assert.equal(secondRefineryDue(370, 1, 20), false, 'nothing left to mine');
  });

  test('CoachWatch: enemy income over the window, idle factories, low power', () => {
    const { world: w, p0, p1 } = sandbox({ w: 64, h: 64, credits: 5000 });
    building(w, 'fact', p0, 10, 50);
    powerUp(w, p0, 4, 40);
    building(w, 'tent', p0, 16, 50);
    building(w, 'proc', p0, 20, 44);
    building(w, 'fact', p1, 50, 10); // (an enemy still in the game)
    assert.equal(refineryCount(w, p0), 1, 'one refinery');
    assert.ok(idleFactories(w, p0, 1000).has('infantry'), 'the barracks is idle with money');
    const c = new CoachWatch();
    for (let t = 0; t < 300; t += 1) {
      run(w, seconds(1));
      p0.stats.harvested += 10; // $600/min
      p1.stats.harvested += 30; // $1,800/min
      c.update(w, p0);
    }
    assert.ok(c.idleFor(w) >= 40, `idle for ${c.idleFor(w)} s`);
    const r = c.incomeRates()!;
    assert.ok(r && Math.abs(r[0] - 600) < 50 && Math.abs(r[1] - 1800) < 120, `rates ${r}`);
    assert.equal(c.enemyOutEarning(w, p0), true, 'the enemy earns far more');
    assert.equal(c.enemyOutEarning(w, p1), false, 'not the other way round');
    assert.equal(c.lowPowerFor(w), 0, 'power fine');
    // no power plant at all
    const dark = sandbox({ w: 48, h: 48 });
    building(dark.world, 'fact', dark.p0, 10, 36);
    building(dark.world, 'tent', dark.p0, 16, 36);
    building(dark.world, 'proc', dark.p0, 20, 30);
    const d = new CoachWatch();
    for (let t = 0; t < 25; t++) { run(dark.world, seconds(1)); d.update(dark.world, dark.p0); }
    assert.ok(dark.p0.lowPower, 'power is low');
    assert.ok(d.lowPowerFor(dark.world) >= 20, `low power for ${d.lowPowerFor(dark.world)} s`);
  });

  test('first wave incoming: only towards the player, only while undefended', () => {
    const { world: w, p0, p1 } = sandbox({ w: 64, h: 64, ai: [undefined, 'easy'] });
    building(w, 'fact', p0, 10, 50);
    const ai = w.ais[0];
    assert.ok(ai && ai.player === p1, 'the AI');
    assert.equal(firstWaveIncoming(w, p0), false, 'building up');
    ai.waves = 1;
    ai.state = 'attack';
    ai.chatter.push({ tick: w.tick, kind: 'attack', x: 55, y: 8 }); // somewhere else
    assert.equal(firstWaveIncoming(w, p0), false, 'heading elsewhere');
    ai.chatter.push({ tick: w.tick, kind: 'attack', x: 12, y: 50 });
    assert.equal(firstWaveIncoming(w, p0), true, 'heading for the base');
    assert.equal(hasDefences(w, p0), false, 'no defences');
    building(w, 'pbox', p0, 14, 46);
    assert.equal(hasDefences(w, p0), true, 'a pillbox counts');
    ai.waves = 2;
    assert.equal(firstWaveIncoming(w, p0), false, 'only the first wave');
  });
});

describe('results economy tip', () => {
  const facts = (o: Partial<EconomyFacts> & { you?: Partial<EconomyFacts['you']>; foe?: Partial<EconomyFacts['foe']> }): EconomyFacts => ({
    won: false, time: 1500, faction: 'allies', ...o,
    you: { harvested: 10000, peakArmy: 6000, peakDefences: 3, ...o.you },
    foe: { harvested: 11000, peakArmy: 7000, ...o.foe },
  });

  test('picks one suggestion by simple rules', () => {
    assert.equal(economyAdvice(facts({ foe: { harvested: 31900, peakArmy: 14500 } }))!.tip, 'income', 'out-earned: refineries and trucks');
    assert.equal(economyAdvice(facts({ time: 500, you: { peakDefences: 0 } }))!.tip, 'defendAllies', 'early loss without defences');
    assert.equal(economyAdvice(facts({ time: 500, faction: 'soviet', you: { peakDefences: 1 } }))!.tip, 'defendSoviet', 'Soviet wording');
    assert.equal(economyAdvice(facts({ time: 500, you: { peakDefences: 4 } }))!.tip, 'close', 'early loss with defences, similar numbers');
    assert.equal(economyAdvice(facts({ foe: { peakArmy: 12000 } }))!.tip, 'army', 'similar income, much bigger army: spend');
    assert.equal(economyAdvice(facts({}))!.tip, 'close', 'a close loss');
    assert.equal(economyAdvice(facts({ won: true }))!.tip, 'won', 'a close win: a positive line');
    assert.equal(economyAdvice(facts({ won: true, foe: { harvested: 3000, peakArmy: 2000 } })), null, 'a decisive win: nothing to say');
    assert.ok(Math.abs(economyAdvice(facts({ foe: { harvested: 26000 } }))!.ratio - 2.6) < 1e-9, 'ratio');
  });

  test('facts: the strongest enemy and the peaks from the report samples', () => {
    const p = (army: number, defences = 0) => ({ army, income: 0, harvested: 0, kills: 0, losses: 0, defences });
    const samples: ReportSample[] = [
      { t: 10, players: [p(1000, 1), p(500), p(3000)] },
      { t: 20, players: [p(4000, 2), p(9000), p(2000)] },
      { t: 30, players: [p(2000, 0), p(1000), p(5000)] },
    ];
    const f = economyFacts({ samples, me: 0, foes: [1, 2], harvested: [8000, 20000, 12000], won: false, time: 30, faction: 'allies' })!;
    assert.equal(f.foe.harvested, 20000, 'the richest enemy');
    assert.equal(f.foe.peakArmy, 9000, 'its peak army');
    assert.equal(f.you.peakArmy, 4000, 'your peak army');
    assert.equal(f.you.peakDefences, 2, 'your most defences');
    assert.equal(economyFacts({ samples, me: 0, foes: [], harvested: [1], won: false, time: 30, faction: 'allies' }), null, 'no enemy: nothing');
  });
});
