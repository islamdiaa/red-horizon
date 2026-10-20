// The Classic commander's judgement (simulation version 4, AIController.classicPro): who gets it, the enemy army
// estimate, the engagement check, tank-first production, the Classic build order, and save / load of the new state.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap } from '../src/sim/mapgen';
import { World, type PlayerSetup } from '../src/sim/world';
import { serializeWorld, deserializeWorld } from '../src/sim/save';
import type { AIController, AIDifficulty } from '../src/sim/ai';
import { trackEnemy, waveNeeds, defenceAt } from '../src/sim/ai-engage';
import { TICK_HZ } from '../src/sim/types';
import { worldHash } from '../src/replay/hash';

function match(ai: [AIDifficulty | undefined, AIDifficulty | undefined], rules?: 'commander', seed = 31): World {
  const map = generateMap({ size: 64, players: 2, seed, water: 0.3, trees: 0.5, ore: 0.6 });
  const players: PlayerSetup[] = ai.map((d, i) => ({ name: `P${i}`, faction: i ? 'soviet' : 'allies', color: 0, team: i, isHuman: !d, ai: d }));
  return new World({ map, players, credits: 10000, startUnits: 'light', fog: true, seed, rules, econ: rules ? true : undefined });
}
const aiOf = (w: World, i: number) => w.ais.find((a) => a.player === w.players[i]) as AIController;
function run(w: World, ticks: number) {
  for (let t = 0; t < ticks; t++) { w.step(); w.events.length = 0; }
}

describe('Classic AI judgement', () => {
  test('only Classic skirmishes at normal and up play it; Commander rules and the easier levels keep version 3', () => {
    const c = match(['normal', 'easy']);
    assert.equal(aiOf(c, 0).classicPro, true, 'Classic normal');
    assert.equal(aiOf(c, 1).classicPro, false, 'Classic easy');
    const h = match(['hard', 'brutal']);
    assert.ok(aiOf(h, 0).classicPro && aiOf(h, 1).classicPro, 'Classic hard and brutal');
    const k = match(['hard', 'brutal'], 'commander');
    assert.ok(!aiOf(k, 0).classicPro && !aiOf(k, 1).classicPro, 'Commander rules');
  });

  test('the enemy estimate keeps what it saw, less what it saw destroyed, plus a modest allowance', () => {
    const w = match(['hard', undefined]);
    const ai = aiOf(w, 0);
    ai.enemyEst = 0;
    ai.estTick = w.tick;
    w.tick += TICK_HZ * 60; // a minute without sightings
    trackEnemy(ai);
    assert.ok(ai.enemyEst > 200 && ai.enemyEst < 400, `allowance after a minute: ${ai.enemyEst}`);
    ai.enemyEst = 5000;
    ai.intel.deaths.push({ tick: w.tick + 1, x: 10, y: 10, value: 2000 });
    w.tick += 2;
    trackEnemy(ai);
    assert.ok(ai.enemyEst > 2900 && ai.enemyEst < 3100, `destroyed units come off the estimate: ${ai.enemyEst}`);
  });

  test('a wave needs more than the army it expects and the defences it knows at the target', () => {
    const w = match(['hard', undefined]);
    const ai = aiOf(w, 0);
    ai.enemyEst = 4000;
    const bare = waveNeeds(ai, [40, 40], 1);
    assert.ok(bare > 4000, `beats the army it expects: ${bare}`);
    ai.intel.structures.set(999999, { id: 999999, type: 'tsla', owner: 1, x: 41, y: 41, cx: 41, cy: 41, w: 1, h: 1, cost: 1500, armed: true, aa: false, range: 6, seen: w.tick });
    assert.ok(defenceAt(ai, 40, 40) >= 1500, 'a known Tesla Coil counts');
    assert.ok(waveNeeds(ai, [40, 40], 1) > bare + 1500, 'and the wave needs more for it');
    assert.equal(defenceAt(ai, 5, 5) < 1, true, 'defences far from the target do not count');
  });

  test('Classic normal: tanks first, a lean build, and the state survives save and load', () => {
    const w = match(['normal', 'normal'], undefined, 33);
    run(w, Math.round(TICK_HZ * 600));
    for (let i = 0; i < 2; i++) {
      const p = w.players[i];
      const units = w.units.filter((u) => u.alive && u.owner === p);
      const tanks = units.filter((u) => u.kind === 'vehicle' && !u.ut.harvester && !u.ut.deploysInto).length;
      const inf = units.filter((u) => u.kind === 'infantry').length;
      assert.ok(tanks >= 3, `${p.name}: ${tanks} combat vehicles at 10 minutes`);
      assert.ok(inf <= tanks * 0.6 + 12, `${p.name}: infantry kept to an escort (${inf} for ${tanks} vehicles)`);
      const decoys = w.buildings.filter((b) => b.alive && b.owner === p && (b.bt.id === 'weaf' || b.bt.id === 'facf')).length;
      assert.equal(decoys, 0, `${p.name}: no decoys in the Classic build`);
    }
    const back = match(['normal', 'normal'], undefined, 33);
    deserializeWorld(back, JSON.parse(JSON.stringify(serializeWorld(w))));
    assert.equal(aiOf(back, 0).enemyEst, aiOf(w, 0).enemyEst, 'estimate saved');
    assert.equal(aiOf(back, 1).estTick, aiOf(w, 1).estTick, 'estimate tick saved');
    assert.equal(aiOf(back, 0).lastAssault, aiOf(w, 0).lastAssault, 'last real attack on the base saved');
    run(w, Math.round(TICK_HZ * 120));
    run(back, Math.round(TICK_HZ * 120));
    assert.equal(worldHash(back), worldHash(w), 'loaded game continues identically');
  });
});
