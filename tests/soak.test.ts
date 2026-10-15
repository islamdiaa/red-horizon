// AI-vs-AI soak: full 15-minute games on several seeds must run without exceptions and keep
// the world consistent (finite positions, no units inside buildings, no negative money, bounded entity count).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { AIDifficulty } from '../src/sim/ai';
import { skirmish, checkInvariants, TICK_HZ } from './helpers';

const MINUTES = 15;

const GAMES: { seed: number; size: number; ai: AIDifficulty[] }[] = [
  { seed: 11, size: 64, ai: ['normal', 'normal'] },
  { seed: 222, size: 64, ai: ['hard', 'normal'] },
  { seed: 3333, size: 64, ai: ['brutal', 'easy'] },
  { seed: 44444, size: 96, ai: ['normal', 'hard'] },
  { seed: 5, size: 96, ai: ['hard', 'hard', 'hard', 'hard'] },
  { seed: 6, size: 96, ai: ['normal', 'brutal', 'normal'] },
];

describe(`AI vs AI soak (${MINUTES} sim-minutes)`, () => {
  for (const g of GAMES) {
    test(`seed ${g.seed}, ${g.size}x${g.size}, ${g.ai.join(' vs ')}`, () => {
      const world = skirmish({ seed: g.seed, size: g.size, players: g.ai.length, ai: g.ai });
      const violations = new Map<string, string>();
      let maxEntities = 0;
      const deployedBy: number[] = world.players.map(() => -1);
      for (let t = 1; t <= MINUTES * 60 * TICK_HZ; t++) {
        world.step();
        world.events.length = 0;
        maxEntities = Math.max(maxEntities, world.entities.size);
        if (t % 5 === 0) {
          for (const v of checkInvariants(world, 1500)) {
            // group repeats of the same kind of problem
            const key = v.replace(/#\d+/g, '#').replace(/-?\d+(\.\d+)?/g, 'N');
            if (!violations.has(key)) violations.set(key, `t=${(t / TICK_HZ).toFixed(1)}s ${v}`);
          }
        }
        if (t % TICK_HZ === 0) world.players.forEach((p, i) => { if (deployedBy[i] < 0 && p.has('fact')) deployedBy[i] = t / TICK_HZ; });
        if (world.gameOver) break;
      }
      assert.deepEqual([...violations.values()], [], 'world invariants');
      assert.ok(maxEntities < 1500, `entity count bounded (max ${maxEntities})`);
      world.players.forEach((p, i) => {
        assert.ok(deployedBy[i] >= 0 && deployedBy[i] <= 30, `${p.name} deployed its MCV (${deployedBy[i]} s)`);
        assert.ok(p.stats.harvested > 3000, `${p.name} ran an economy (${Math.round(p.stats.harvested)} harvested)`);
        assert.ok(p.stats.buildingsBuilt >= 4, `${p.name} built a base (${p.stats.buildingsBuilt})`);
        assert.ok(p.stats.unitsBuilt >= 5, `${p.name} trained an army (${p.stats.unitsBuilt})`);
      });
      if (world.gameOver) assert.ok(world.players.some((p) => !p.defeated && p.team === world.winnerTeam), 'a surviving winner');
    });
  }
});
