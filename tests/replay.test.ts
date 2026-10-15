// Replays (src/replay): a recorded command stream fed back into a fresh World reproduces the match
// hash for hash; tampering is detected; recordings survive JSON and save / load.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BUILDINGS } from '../src/data/rules';
import { CommandFeeder, CommandRecorder, hookStep } from '../src/replay/core';
import { HASH_EVERY, REPLAY_VERSION, isReplayData, type ReplayData } from '../src/replay/format';
import { worldHash } from '../src/replay/hash';
import { buildMap, getMapDef } from '../src/maps';
import { deserializeWorld, serializeWorld } from '../src/sim/save';
import type { Command } from '../src/sim/types';
import { World } from '../src/sim/world';
import { skirmish, seconds, TICK_HZ } from './helpers';

/** A scripted "human" player 0: deploy, build a base, train units, attack (reads world state only). */
function scriptedHuman(world: World, issue: (c: Command) => void) {
  const p = world.players[0];
  const enemy = world.map.startPositions[1];
  const order = ['powr', 'proc', 'tent', 'powr', 'weap'];
  let built = 0;
  return () => {
    const t = world.tick;
    if (t === 1) {
      const mcv = world.units.find((u) => u.owner === p && u.ut.deploysInto);
      if (mcv) issue({ c: 'deploy', player: p.id, units: [mcv.id] });
    }
    const q = p.queues.structure;
    if (p.has('fact') && !q.items.length && !q.ready && built < order.length && p.canBuild(order[built])) issue({ c: 'build', player: p.id, type: order[built] });
    if (q.ready) {
      const fact = world.buildings.find((b) => b.owner === p && b.bt.id === 'fact');
      const bt = BUILDINGS[q.ready];
      if (fact) {
        search: for (let r = 2; r < 12; r++) {
          for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const cx = fact.cx + dx * 2, cy = fact.cy + dy * 2;
            if (world.canPlace(p, bt.id, cx, cy)) { issue({ c: 'place', player: p.id, type: bt.id, cx, cy }); built++; break search; }
          }
        }
      }
    }
    if (t % (TICK_HZ * 8) === 0) {
      if (p.canBuild('e1')) issue({ c: 'build', player: p.id, type: 'e1', count: 2 });
      if (p.canBuild('2tnk') && !p.queues.vehicle.items.length) issue({ c: 'build', player: p.id, type: '2tnk' });
    }
    if (t % (TICK_HZ * 30) === 0 && t >= TICK_HZ * 120) {
      const army = world.units.filter((u) => u.owner === p && u.weapons.length && !u.ut.harvester).map((u) => u.id);
      if (army.length) issue({ c: 'move', player: p.id, units: army, x: enemy.x, y: enemy.y, attackMove: true });
      if (army.length > 2) issue({ c: 'stance', player: p.id, units: army.slice(0, 2), stance: 'aggressive' });
    }
  };
}

/** Play a match with the recorder attached exactly as the Game does (commands via issue, hashes after each step). */
function record(make: () => World, ticks: number) {
  const world = make();
  const rec = new CommandRecorder(world);
  hookStep(world, null, () => rec.afterStep());
  const script = scriptedHuman(world, (c) => { rec.record(c); world.issue(c); });
  for (let t = 0; t < ticks; t++) {
    script();
    world.step();
    world.events.length = 0;
  }
  return { world, cmds: rec.cmds, hashes: rec.hashes, final: worldHash(world) };
}

function play(make: () => World, cmds: [number, Command][], hashes: [number, string][], ticks: number) {
  const world = make();
  const feeder = new CommandFeeder(world, cmds, hashes);
  hookStep(world, () => feeder.beforeStep(), () => feeder.afterStep());
  while (world.tick < ticks) { world.step(); world.events.length = 0; }
  return { world, feeder, final: worldHash(world) };
}

const TICKS = seconds(300);
const makeSkirmish = () => skirmish({ seed: 4711, size: 64, ai: [undefined, 'hard'] });

describe('replays', () => {
  const live = record(makeSkirmish, TICKS);

  test('the recording has commands and a hash every 10 s', () => {
    assert.ok(live.cmds.length > 15, `commands recorded (${live.cmds.length})`);
    assert.equal(live.hashes.length, Math.floor(TICKS / HASH_EVERY), 'hash count');
    assert.ok(live.world.buildings.filter((b) => b.owner.id === 0).length >= 4, 'the scripted player built a base');
  });

  test('a recorded match replays to identical hashes', () => {
    const r = play(makeSkirmish, live.cmds, live.hashes, TICKS);
    assert.equal(r.feeder.checked, live.hashes.length, 'every hash compared');
    assert.equal(r.feeder.desyncTick, -1, 'no desync');
    assert.equal(r.final, live.final, 'identical final state');
    assert.equal(r.feeder.pendingCommands, 0, 'every command fed');
  });

  test('the hash is read-only: hashing every tick does not change the game', () => {
    const r = play(() => { const w = makeSkirmish(); hookStep(w, null, () => void worldHash(w)); return w; }, live.cmds, live.hashes, TICKS);
    assert.equal(r.feeder.desyncTick, -1, 'no desync');
  });

  test('a tampered or truncated recording is detected as a desync', () => {
    const k = live.cmds.findIndex(([, c]) => c.c === 'place');
    const tampered = live.cmds.filter((_, i) => i !== k);
    const r = play(makeSkirmish, tampered, live.hashes, TICKS);
    assert.ok(r.feeder.desyncTick > 0, 'dropping a command desyncs');
    assert.ok(r.feeder.desyncTick >= live.cmds[k][0], 'not before the dropped command');
    const shifted = live.cmds.map(([t, c], i): [number, Command] => [i === 3 ? t + 1 : t, c]);
    assert.ok(play(makeSkirmish, shifted, live.hashes, TICKS).feeder.desyncTick > 0, 'a command one tick late desyncs');
  });

  test('replays survive the JSON round trip of the replay file', () => {
    const data: ReplayData = {
      v: REPLAY_VERSION, id: 'rtest', createdAt: 1, gameVersion: 'test', setup: {
        faction: 'allies', color: 0, opponents: [{ faction: 'soviet', difficulty: 'hard' }], mapSize: 64, water: 0.5, trees: 0.5, ore: 0.6,
        credits: 5000, startUnits: 'mcv', fog: true, timeOfDay: 'day', seed: 4711,
      },
      mapName: 'Random 64×64', mapW: 64, mapH: 64, players: [], local: 0, ticks: TICKS, result: 'abandoned', winnerTeam: -1,
      cmds: live.cmds, hashes: live.hashes,
    };
    const back = JSON.parse(JSON.stringify(data));
    assert.ok(isReplayData(back), 'valid replay file');
    assert.ok(!isReplayData({ ...back, v: 99 }), 'other versions rejected');
    assert.ok(!isReplayData({ ...back, cmds: [[1, 'x']] }), 'malformed commands rejected');
    const r = play(makeSkirmish, back.cmds, back.hashes, TICKS);
    assert.equal(r.feeder.desyncTick, -1, 'no desync after JSON');
    const size = JSON.stringify(data).length;
    assert.ok(size < 200_000, `compact (${(size / 1024).toFixed(1)} KB for ${data.cmds.length} commands)`);
  });

  test('recording continues across save / load and still replays from the start', () => {
    const half = seconds(150);
    // first session: play half, "save" (world + recorder state)
    const a = makeSkirmish();
    const recA = new CommandRecorder(a);
    hookStep(a, null, () => recA.afterStep());
    const scriptA = scriptedHuman(a, (c) => { recA.record(c); a.issue(c); });
    for (let t = 0; t < half; t++) { scriptA(); a.step(); a.events.length = 0; }
    const save = JSON.parse(JSON.stringify({ world: serializeWorld(a), replay: { cmds: recA.cmds, hashes: recA.hashes } }));
    // second session: load and keep playing (the script resumes from the restored state)
    const b = makeSkirmish();
    deserializeWorld(b, save.world, null);
    const recB = new CommandRecorder(b, save.replay);
    hookStep(b, null, () => recB.afterStep());
    const scriptB = scriptedHuman(b, (c) => { recB.record(c); b.issue(c); });
    for (let t = half; t < TICKS; t++) { scriptB(); b.step(); b.events.length = 0; }
    const r = play(makeSkirmish, recB.cmds, recB.hashes, TICKS);
    assert.equal(r.feeder.desyncTick, -1, `no desync (desync at ${r.feeder.desyncTick})`);
    assert.equal(r.final, worldHash(b), 'same final state as the resumed match');
  });

  test('replays on a curated map', () => {
    const def = getMapDef('pocket-valley')!;
    const make = () => new World({
      map: buildMap(def), credits: 8000, startUnits: 'light', fog: true, seed: 99,
      players: [
        { name: 'You', faction: 'soviet', color: 0, team: 0, isHuman: true },
        { name: 'AI', faction: 'allies', color: 1, team: 1, isHuman: false, ai: 'normal' },
      ],
    });
    const ticks = seconds(180);
    const rec = record(make, ticks);
    const r = play(make, rec.cmds, rec.hashes, ticks);
    assert.ok(rec.cmds.length > 5, 'commands recorded');
    assert.equal(r.feeder.desyncTick, -1, 'no desync');
    assert.equal(r.final, rec.final, 'identical final state');
  });
});
