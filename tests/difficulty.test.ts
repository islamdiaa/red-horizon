// AI difficulty levels (simulation version 3): the scaled-down skirmish levels, the mission levels kept for the
// campaigns, assist-only dynamic difficulty against Recruit and Easy, and save / load of the new AI state.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap } from '../src/sim/mapgen';
import { World, type PlayerSetup } from '../src/sim/world';
import { serializeWorld, deserializeWorld } from '../src/sim/save';
import { AI_DIFFICULTIES, difficultyParams, type AIDifficulty } from '../src/sim/ai';
import { TICK_HZ } from '../src/sim/types';
import { worldHash } from '../src/replay/hash';

const seconds = (s: number) => Math.round(s * TICK_HZ);

function commanderMatch(ai: [AIDifficulty | undefined, AIDifficulty | undefined], seed = 21, dynamic = false): World {
  const map = generateMap({ size: 64, players: 2, seed, water: 0.3, trees: 0.5, ore: 0.6 });
  const players: PlayerSetup[] = ai.map((d, i) => ({ name: `P${i}`, faction: i ? 'soviet' : 'allies', color: 0, team: i, isHuman: !d, ai: d }));
  return new World({ map, players, credits: 10000, startUnits: 'light', fog: true, seed, rules: 'commander', econ: true, dynamicDifficulty: dynamic });
}

function run(w: World, ticks: number) {
  for (let t = 0; t < ticks; t++) { w.step(); w.events.length = 0; }
}

describe('AI difficulty levels', () => {
  test('five levels, easiest first, each a step up in economy and speed', () => {
    assert.deepEqual([...AI_DIFFICULTIES], ['recruit', 'easy', 'normal', 'hard', 'brutal'], 'level order');
    for (let i = 1; i < AI_DIFFICULTIES.length; i++) {
      const lo = difficultyParams(AI_DIFFICULTIES[i - 1]), hi = difficultyParams(AI_DIFFICULTIES[i]);
      assert.ok(hi.buildSpeed > lo.buildSpeed && hi.income >= lo.income, `${AI_DIFFICULTIES[i]} builds and earns at least as fast`);
      assert.ok(hi.firstAttack < lo.firstAttack && hi.skill > lo.skill, `${AI_DIFFICULTIES[i]} attacks sooner and plays smarter`);
      assert.ok(hi.maxRefs >= lo.maxRefs && hi.maxHarv >= lo.maxHarv && hi.waveCap >= lo.waveCap, `${AI_DIFFICULTIES[i]} is capped no harder`);
    }
  });

  test('recruit and easy: no doctrine, derricks, events, agents, raids, superweapons or offensive powers', () => {
    for (const d of ['recruit', 'easy'] as const) {
      const p = difficultyParams(d);
      assert.ok(!p.doctrine && !p.neutral && p.events === 0 && !p.agents && !p.raids && !p.siege && !p.superweapons && !p.offensivePowers, `${d} plays it straight`);
      assert.ok(p.maxRefs <= 2 && p.expansions === 0 && p.outposts === 0 && !p.econPlus && p.processors === 0, `${d}: a small economy`);
      assert.ok(p.maxTier <= 2 && p.research <= 1, `${d}: no Tier 3, no Level II research`);
    }
    assert.deepEqual(difficultyParams('recruit').powers, [], 'recruit uses no commander power');
  });

  test('scripted missions keep the version-2 levels', () => {
    const e = difficultyParams('easy', true);
    assert.deepEqual([e.buildSpeed, e.income, e.firstAttack, e.waveValue, e.waveGrowth], [0.65, 0.9, 600, 3200, 1200], 'mission easy as before');
    const h = difficultyParams('hard', true);
    assert.deepEqual([h.buildSpeed, h.income], [1.15, 1.15], 'mission hard as before');
    assert.ok(e.maxRefs > 100 && e.waveCap > 1e6 && e.rebuildDelay === 0, 'no skirmish caps in missions');
  });

  test('a recruit AI under Commander rules stays small: one refinery, two trucks, Tier 1, no doctrine or powers', () => {
    const w = commanderMatch(['recruit', 'recruit']);
    assert.equal(w.players[0].cmd?.doctrine, null, 'no doctrine below normal');
    run(w, seconds(600));
    for (const p of w.players) {
      const procs = w.buildings.filter((b) => b.alive && b.owner === p && b.bt.id === 'proc').length;
      const trucks = w.units.filter((u) => u.alive && u.owner === p && u.ut.harvester).length;
      assert.ok(procs <= 1, `${p.name}: ${procs} refineries`);
      assert.ok(trucks <= 2, `${p.name}: ${trucks} trucks`);
      assert.equal(p.econ?.tier, 1, `${p.name}: Tier 1`);
      assert.equal(Object.values(p.cmd?.uses ?? {}).reduce((s, n) => s + n, 0), 0, `${p.name}: no commander powers`);
    }
  });

  test('a normal AI still picks a doctrine', () => {
    const w = commanderMatch(['normal', 'normal']);
    assert.ok(w.players[0].cmd?.doctrine, 'doctrine from normal up');
  });

  test('dynamic difficulty only eases off against recruit and easy, both ways from normal up', () => {
    for (const [d, up] of [['easy', false], ['normal', true]] as const) {
      const w = commanderMatch([undefined, d], 33, true);
      const human = w.players[0];
      // a human far ahead: a big army out of the AI's way
      for (let k = 0; k < 30; k++) w.addUnit('2tnk', human, 3 + (k % 6), 3 + Math.floor(k / 6));
      run(w, seconds(300));
      const lvl = w.variety!.dd.level;
      if (up) assert.ok(lvl > 0, `against ${d} the AI pushes harder (level ${lvl})`);
      else assert.ok(lvl <= 0, `against ${d} it never pushes harder (level ${lvl})`);
    }
  });

  test('save / load mid-match continues identically with the new AI state (recruit vs easy, Commander rules)', () => {
    const a = commanderMatch(['recruit', 'easy'], 9, true);
    run(a, seconds(240));
    const b = commanderMatch(['recruit', 'easy'], 9, true);
    deserializeWorld(b, JSON.parse(JSON.stringify(serializeWorld(a))));
    run(a, seconds(120));
    run(b, seconds(120));
    assert.equal(worldHash(b), worldHash(a), 'loaded game continues identically');
  });
});
