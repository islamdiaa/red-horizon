// Conquest on an Easy run: sea battles land with a harbour, the capital is a smaller fortress (round 4, CAMP).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { runWithBattle } from '../src/conquest/testing';
import { createConquestWorld } from '../tools/conquest-harness';

describe('Conquest at Easy: naval and capital battles a newcomer can take', () => {
  test('an Easy naval battle lands with its own shipyard or sub pen; a Normal one does not', () => {
    for (const faction of ['allies', 'soviet'] as const) {
      const yard = faction === 'allies' ? 'syrd' : 'spen';
      const easy = createConquestWorld(runWithBattle(7, faction, 'naval', 'vanguard', 'easy').setup);
      assert.equal(easy.def.players.length, 2, 'two sides');
      const mine = easy.world.buildings.filter((b) => b.alive && b.owner.id === 0 && b.bt.id === yard);
      assert.equal(mine.length, 1, `${faction}: one ${yard} at Easy (found ${mine.length})`);
      const normal = createConquestWorld(runWithBattle(7, faction, 'naval', 'vanguard', 'normal').setup);
      assert.equal(normal.world.buildings.filter((b) => b.alive && b.owner.id === 0 && b.bt.id === yard).length, 0, `${faction}: none at Normal`);
    }
  });

  test('an Easy capital: Recruit commanders, a smaller base, three guns, no superweapon', () => {
    const { setup } = runWithBattle(7, 'soviet', 'boss', 'vanguard', 'easy');
    assert.equal(setup.battle.difficulty, 'easy', 'the spec records the run difficulty');
    assert.equal(setup.battle.ai, 'recruit', 'the capital commander plays at Recruit');
    assert.equal(setup.battle.superweapon, null, 'no superweapon in the preview');
    const { world, def } = createConquestWorld(setup);
    assert.equal(def.players[2].ai, 'recruit', 'the guard plays at Recruit');
    const guns = world.buildings.filter((b) => b.alive && b.owner.id === 1 && b.weapons.length);
    assert.ok(guns.length <= 3, `at most three guns at the capital (${guns.length})`);
    assert.ok(!world.buildings.some((b) => b.alive && b.owner.id === 1 && b.bt.superweapon), 'no superweapon structure');
    const normal = runWithBattle(7, 'soviet', 'boss', 'vanguard', 'normal').setup;
    assert.notEqual(normal.battle.superweapon, null, 'a Normal capital keeps its superweapon');
    assert.ok(normal.battle.enemyCredits > setup.battle.enemyCredits, 'and more money');
  });
});
