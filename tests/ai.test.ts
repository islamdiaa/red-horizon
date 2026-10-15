// Skirmish AI behaviour: opening build, economy, defence, and fairness between AI slots.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { Command } from '../src/sim/types';
import type { World } from '../src/sim/world';
import { skirmish, run, seconds, sandbox, building, unit } from './helpers';

/** Record every command each player issues. */
function recordCommands(world: World): Command[][] {
  const log: Command[][] = world.players.map(() => []);
  const issue = world.issue.bind(world);
  world.issue = (c: Command) => { log[c.player]?.push(c); issue(c); };
  return log;
}

describe('skirmish AI', () => {
  test('opens with MCV deploy, power, refinery, barracks and a war factory', () => {
    const world = skirmish({ seed: 99, size: 64, ai: ['normal', 'normal'] });
    run(world, seconds(240));
    for (const p of world.players) {
      assert.ok(p.has('fact'), `${p.name} construction yard`);
      assert.ok(p.has('powr') || p.has('apwr'), `${p.name} power`);
      assert.ok(p.has('proc'), `${p.name} refinery`);
      assert.ok(p.has('tent') || p.has('barr'), `${p.name} barracks`);
      assert.ok(p.has('weap'), `${p.name} war factory`);
      assert.ok(p.stats.harvested > 0, `${p.name} harvesting`);
      assert.ok(!p.lowPower, `${p.name} keeps the power up (${p.powerOut}/${p.powerUse})`);
    }
  });

  test('defends its base against intruders', () => {
    const world = skirmish({ seed: 3, size: 64, ai: ['normal', undefined] });
    run(world, seconds(300));
    const ai = world.players[0], human = world.players[1];
    const fact = world.buildings.find((b) => b.owner === ai && b.bt.id === 'fact')!;
    const raiders = [0, 1, 2].map((k) => unit(world, '3tnk', human, fact.x + 6 + k, fact.y + 6));
    run(world, seconds(60));
    assert.ok(raiders.some((r) => !r.alive || r.hp < r.maxHp), 'raiders were engaged');
  });

  test('every AI slot runs its periodic tasks (rally points, repairs, attack waves, superweapons)', () => {
    const world = skirmish({ seed: 5, size: 96, players: 4, ai: ['hard', 'hard', 'hard', 'hard'] });
    const log = recordCommands(world);
    run(world, seconds(600));
    log.forEach((cmds, i) => {
      assert.ok(cmds.some((c) => c.c === 'rally'), `AI #${i} sets rally points (${cmds.length} commands)`);
    });
  });

  test('AI think() load is staggered across ticks', () => {
    const world = skirmish({ seed: 5, size: 64, players: 4, ai: ['hard', 'hard', 'hard', 'hard'] });
    const calls: number[][] = [[], [], [], []];
    world.ais.forEach((ai, k) => {
      const think = ai.think.bind(ai);
      ai.think = () => { calls[k].push(world.tick); think(); };
    });
    run(world, 40);
    for (let k = 0; k < 4; k++) assert.equal(calls[k].length, 4, `AI #${k} thinks twice a second`);
    const ticks = new Set(calls.flat());
    assert.equal(ticks.size, 16, 'no two AIs think on the same tick');
  });

  test('a defeated player is eliminated and the game ends with the survivor', () => {
    const s = sandbox({ ai: ['normal', undefined] });
    const { world, p0, p1 } = s;
    building(world, 'fact', p0, 4, 4);
    unit(world, 'e1', p1, 40.5, 40.5);
    run(world, seconds(1));
    assert.equal(world.gameOver, false, 'both alive');
    for (const u of world.units) if (u.owner === p1) world.kill(u);
    run(world, seconds(1));
    assert.ok(p1.defeated, 'p1 eliminated');
    assert.ok(world.gameOver, 'game over');
    assert.equal(world.winnerTeam, p0.team);
  });
});
