// Conquest on an Easy run: sea battles land with a harbour, the capital is a smaller fortress (round 4, CAMP).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { runWithBattle } from '../src/conquest/testing';
import { createConquestWorld } from '../tools/conquest-harness';
import type { Building } from '../src/sim/entities';

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

  test('the Easy harbour goes up clear of the landing fleet (none of it boxed in under the yard)', () => {
    for (let seed = 7; seed <= 13; seed++) {
      for (const faction of ['allies', 'soviet'] as const) {
        const { world } = createConquestWorld(runWithBattle(seed, faction, 'naval', 'vanguard', 'easy').setup);
        const yards = world.buildings.filter((b) => b.alive && b.owner.id === 0 && b.bt.water);
        for (const y of yards) {
          const inside = world.units.filter((u) => u.alive && u.x >= y.cx - 0.3 && u.x < y.cx + y.w + 0.3 && u.y >= y.cy - 0.3 && u.y < y.cy + y.h + 0.3);
          assert.equal(inside.length, 0, `seed ${seed} ${faction}: no unit inside the ${y.bt.id} at ${y.cx},${y.cy} (${inside.map((u) => `${u.ut.id}@${u.x.toFixed(1)},${u.y.toFixed(1)}`).join(' ')})`);
        }
        // (and it stands among the landing fleet, not out on its own: the first patrol sank a lone one within a minute)
        if (seed >= 8 && seed <= 12 && yards[0]) {
          for (let t = 0; t < 20 * 60; t++) world.step();
          assert.ok(yards[0].alive, `seed ${seed} ${faction}: the ${yards[0].bt.id} still stands after a minute`);
        }
      }
    }
  });

  test('a capture target cannot be wrecked by accident: a V2 rocket glances off a Tech Center above the lock', () => {
    const { world, rt } = createConquestWorld(runWithBattle(19, 'soviet', 'capture', 'vanguard', 'normal', 3).setup);
    const t = world.getEntity(rt.flags.target) as Building;
    assert.equal(t.bt.id, 'atek', 'the Allied Tech Center (400 hp; a V2 rocket does 600)');
    const v2 = rt.spawnUnit(0, 'v2rl', ...rt.toward(t, rt.start(0), 8));
    for (const u of world.units) if (u.alive && u.owner.id === 1) world.kill(u, 'sold'); // (nobody to shoot the launcher)
    for (const b of world.buildings) if (b.alive && b.owner.id === 1 && b.weapons.length) world.kill(b, 'sold');
    world.issue({ c: 'attack', player: 0, units: [v2.id], target: t.id });
    for (let k = 0; k < 20 * 40; k++) world.step();
    assert.ok(t.alive && t.owner.id === 1, `the target stands (hp ${t.hp}/${t.maxHp})`);
    assert.ok(!rt.ended, `the battle goes on (${rt.endReason})`);
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
    const guard = world.buildings.filter((b) => b.alive && b.owner.id === 2 && b.weapons.length);
    assert.equal(guard.length, 1, `the guard is an outpost behind one gun at Easy (${guard.length})`);
    const nw = createConquestWorld(normal).world;
    assert.ok(nw.buildings.filter((b) => b.alive && b.owner.id === 2 && b.weapons.length).length >= 3, 'a Normal guard keeps its guns');
  });

  test('Easy strength-3 attacks: two guns at most, garrisons near their budget, two more tanks in the landing', () => {
    const tank = (f: string) => (f === 'allies' ? '2tnk' : '3tnk');
    for (const kind of ['assault', 'capture'] as const) {
      for (const faction of ['allies', 'soviet'] as const) {
        const e = createConquestWorld(runWithBattle(11, faction, kind, 'vanguard', 'easy', 3).setup).world;
        const n = createConquestWorld(runWithBattle(11, faction, kind, 'vanguard', 'normal', 3).setup).world;
        const guns = (w: typeof e) => w.buildings.filter((b) => b.alive && b.owner.id === 1 && b.weapons.length).length;
        const tanks = (w: typeof e) => w.units.filter((u) => u.alive && u.owner.id === 0 && u.ut.id === tank(faction)).length;
        const mammoths = (w: typeof e) => w.units.filter((u) => u.alive && u.owner.id === 1 && u.ut.id === '4tnk').length;
        assert.ok(guns(e) <= 2, `${kind} ${faction}: at most two guns at Easy (${guns(e)})`);
        assert.ok(guns(n) >= 3, `${kind} ${faction}: Normal keeps its defences (${guns(n)})`);
        assert.equal(tanks(e), tanks(n) + 2, `${kind} ${faction}: two more ${tank(faction)} land at Easy`);
        assert.equal(mammoths(e), 0, `${kind} ${faction}: no Mammoth Tank in an Easy garrison`);
      }
    }
  });
});
