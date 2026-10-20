// Balance pass (wave 2): simulation version stamps, bunker firing slits, the Allied AI's own tools.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SIM_VERSION, LEGACY_SIM_VERSION, otherSimVersion, simVersionOf } from '../src/sim/version';
import { BUILD_FINGERPRINT } from '../src/net/fingerprint';
import { isReplayData, type ReplayData } from '../src/replay/format';
import { makeBranch } from '../src/replay/branch';
import { challengeFromState } from '../src/modes/author';
import { ReplayRecorder } from '../src/replay/recorder';
import { quickSkill } from '../src/modes/quickbattle';
import { World, GameMap, building, run, seconds, skirmish, unit, type GameEvent, type Player } from './helpers';

/** An empty flat Commander world (no events, no doctrines, no neutral structures). */
function cmdWorld() {
  const map = new GameMap(48, 48);
  map.startPositions = [{ x: 6.5, y: 41.5 }, { x: 41.5, y: 6.5 }];
  const world = new World({
    map, players: [{ name: 'P0', faction: 'allies', color: 0, team: 0, isHuman: true }, { name: 'P1', faction: 'soviet', color: 0, team: 1, isHuman: true }],
    credits: 30000, startUnits: 'none', fog: false, seed: 7, rules: 'commander', events: false, doctrines: ['none', 'none'],
  });
  world.cratesEnabled = false;
  for (const b of [...world.buildings]) if (b.owner.id < 0) world.kill(b, 'sold');
  run(world, 1);
  return { world, p0: world.players[0] as Player, p1: world.players[1] as Player };
}

describe('simulation version stamp', () => {
  test('records without a stamp are version 1; the current build is newer', () => {
    assert.equal(LEGACY_SIM_VERSION, 1);
    assert.ok(SIM_VERSION > LEGACY_SIM_VERSION, 'bumped past the unstamped records');
    assert.equal(simVersionOf({}), 1, 'no field: legacy');
    assert.equal(simVersionOf({ sim: 'x' }), 1, 'garbage: legacy');
    assert.equal(simVersionOf({ sim: -3 }), 1, 'negative: legacy');
    assert.equal(simVersionOf({ sim: SIM_VERSION }), SIM_VERSION);
    assert.equal(otherSimVersion({}), true, 'an old replay is from another version');
    assert.equal(otherSimVersion({ sim: SIM_VERSION }), false);
  });

  test('the multiplayer / leaderboard build fingerprint carries the simulation version', () => {
    assert.ok(BUILD_FINGERPRINT.includes(`/s${SIM_VERSION}/`), BUILD_FINGERPRINT);
  });

  test('replays, branches and challenges record the version; an unstamped replay still loads', () => {
    const w = skirmish({ seed: 5, size: 48, ai: ['normal', 'normal'] });
    run(w, seconds(40));
    const game = { world: w, setup: { seed: 5, mapSize: 48, faction: 'allies', opponents: [] }, local: w.players[0] } as never;
    const rec = new ReplayRecorder(game);
    run(w, seconds(11));
    const data = rec.toData();
    rec.discard();
    assert.equal(data.sim, SIM_VERSION, 'replay stamped');
    assert.equal(rec.snapshot().sim, SIM_VERSION, 'in-progress recording (save games) stamped');
    // a recording resumed from an older save keeps the older stamp: its start was simulated by the old rules
    const resumed = new ReplayRecorder(game, { id: 'r1', createdAt: 1, cmds: [], hashes: [] });
    assert.equal(resumed.sim, LEGACY_SIM_VERSION, 'resumed from an unstamped save: legacy');
    resumed.discard();
    const legacy = JSON.parse(JSON.stringify(data)) as ReplayData;
    delete legacy.sim;
    assert.ok(isReplayData(legacy), 'an unstamped replay is still a valid replay file');
    assert.ok(otherSimVersion(legacy), 'and is flagged as recorded with another version');
    const br = makeBranch(data, w, 0, 'normal');
    assert.equal(br.sim, SIM_VERSION, 'branch stamped');
    const ch = challengeFromState({ setup: { seed: 5 }, state: {}, side: 0, goal: { kind: 'win' }, timeLimit: 600, title: 't' });
    assert.equal(ch.sim, SIM_VERSION, 'challenge stamped');
  });
});

describe('bunker firing slits', () => {
  function fireFrom(dx: number, dy: number) {
    const { world, p0, p1 } = cmdWorld();
    building(world, 'fact', p0, 3, 3);
    const bk = building(world, 'bnkr', p0, 20, 20);
    const sq = [0, 1, 2, 3].map((k) => unit(world, 'e1', p0, 17 + k * 0.6, 24.5));
    world.issue({ c: 'enter', player: 0, units: sq.map((u) => u.id), target: bk.id });
    run(world, seconds(8));
    assert.equal(bk.garrison?.length, 4, 'manned');
    const foe = unit(world, 'e1', p1, bk.x + dx, bk.y + dy);
    foe.stance = 'hold';
    const events: GameEvent[] = [];
    run(world, seconds(3), events);
    const shots = events.filter((e): e is Extract<GameEvent, { e: 'fire' }> => e.e === 'fire' && sq.some((u) => u.id === e.shooter));
    assert.ok(shots.length > 0, 'the garrison fired');
    return { bk, shots };
  }

  test('shots leave through the slit facing the target (S, E, N, W pairs) and start at that wall', () => {
    const sides: [number, number, number[], (b: { x: number; y: number }, fx: number, fy: number) => boolean][] = [
      [0, 4, [0, 1], (b, _x, y) => y > b.y + 0.5], // south (+y)
      [4, 0, [2, 3], (b, x) => x > b.x + 0.5], // east
      [0, -4, [4, 5], (b, _x, y) => y < b.y - 0.5], // north
      [-4, 0, [6, 7], (b, x) => x < b.x - 0.5], // west
    ];
    for (const [dx, dy, slits, side] of sides) {
      const { bk, shots } = fireFrom(dx, dy);
      for (const s of shots) {
        assert.equal(s.via, bk.id, 'the shot is the bunker\'s');
        assert.ok(slits.includes(s.muzzle), `slit ${s.muzzle} faces (${dx}, ${dy})`);
        assert.ok(side(bk, s.fx, s.fy), `projectile origin on the facing wall (${s.fx.toFixed(2)}, ${s.fy.toFixed(2)})`);
      }
    }
  });
});

describe('difficulty curve', () => {
  test('Quick Battle keeps a struggling newcomer on recruit until they master a level', () => {
    assert.equal(quickSkill({ skirmishes: 10, gamesByDifficulty: { easy: 10 }, winsByDifficulty: { easy: 1 } }), 'recruit', 'one lucky win in ten: still recruit');
    assert.equal(quickSkill({ skirmishes: 2, gamesByDifficulty: { easy: 2 }, winsByDifficulty: { easy: 1 } }), 'recruit', 'half of two games: not yet');
    assert.equal(quickSkill({ skirmishes: 4, gamesByDifficulty: { easy: 4 }, winsByDifficulty: { easy: 3 } }), 'normal', 'three wins of four on easy: up to normal');
    assert.equal(quickSkill({ skirmishes: 5, gamesByDifficulty: { normal: 5 }, winsByDifficulty: {} }), 'recruit', 'never won: recruit');
  });
});
