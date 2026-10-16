// Branching replays ("rewind & take command", src/replay/branch.ts + src/modes/runtime.ts): a live game
// started from a replay moment as another player replays deterministically on its own, links to its
// parent, survives JSON and save / load, and carries King of the Hill state across the branch point.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BUILDINGS } from '../src/data/rules';
import type { GameSetup } from '../src/game';
import { CommandFeeder, CommandRecorder, hookStep } from '../src/replay/core';
import { REPLAY_VERSION, isReplayData, type ReplayData } from '../src/replay/format';
import { worldHash } from '../src/replay/hash';
import { branchSetup, flattenTree, makeBranch, pruneTrees, replayStartTick, replayTree } from '../src/replay/branch';
import { headlessGame } from '../src/modes/headless';
import type { KothState } from '../src/modes/types';
import { serializeWorld } from '../src/sim/save';
import type { Command } from '../src/sim/types';
import type { World } from '../src/sim/world';
import { seconds, TICK_HZ } from './helpers';
import { readFileSync } from 'node:fs';
import { getMapDef } from '../src/maps';
import type { MapDef } from '../src/maps/format';
import { appliedModSet, applyModSet } from '../src/mods/engine';
import { makeModSet, type ModFile } from '../src/mods/format';
import { UNITS } from '../src/data/rules';
import { challengeFromState, challengeGameSetup } from '../src/modes/author';

/** A scripted commander for player `pid`: build, train, attack (reads world state only). */
function scripted(world: World, pid: number, issue: (c: Command) => void) {
  const order = ['powr', 'proc', 'tent', 'barr', 'powr', 'weap'];
  let built = 0;
  return () => {
    const p = world.players[pid];
    const t = world.tick;
    if (t % 40 === 1) {
      const mcv = world.units.find((u) => u.owner === p && u.ut.deploysInto);
      if (mcv) issue({ c: 'deploy', player: pid, units: [mcv.id] });
    }
    const q = p.queues.structure;
    while (built < order.length && !p.canBuild(order[built])) built++;
    if (p.has('fact') && !q.items.length && !q.ready && built < order.length) issue({ c: 'build', player: pid, type: order[built] });
    if (q.ready) {
      const fact = world.buildings.find((b) => b.owner === p && b.bt.id === 'fact');
      const bt = BUILDINGS[q.ready];
      if (fact) {
        search: for (let r = 2; r < 12; r++) {
          for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const cx = fact.cx + dx * 2, cy = fact.cy + dy * 2;
            if (world.canPlace(p, bt.id, cx, cy)) { issue({ c: 'place', player: pid, type: bt.id, cx, cy }); built++; break search; }
          }
        }
      }
    }
    if (t % (TICK_HZ * 8) === 0) for (const u of ['e1', 'e3', '2tnk', '3tnk']) if (p.canBuild(u)) issue({ c: 'build', player: pid, type: u });
    if (t % (TICK_HZ * 25) === 0) {
      const foe = world.players.find((o) => p.isEnemy(o) && !o.defeated);
      const s = foe ? world.map.startPositions[foe.id % world.map.startPositions.length] : null;
      const army = world.units.filter((u) => u.owner === p && u.alive && u.weapons.length && !u.ut.harvester).map((u) => u.id);
      if (s && army.length) issue({ c: 'move', player: pid, units: army, x: s.x, y: s.y, attackMove: true });
    }
  };
}

/** Play a setup live with a scripted human, recording exactly as the Game does. */
function live(setup: GameSetup, ticks: number, opts: { stopAt?: number } = {}) {
  const g = headlessGame(setup);
  const w = g.world;
  const rec = new CommandRecorder(w);
  hookStep(w, null, () => rec.afterStep());
  const script = scripted(w, g.local.id, (c) => { rec.record(c); w.issue(c); });
  const end = Math.min(ticks, opts.stopAt ?? ticks);
  while (w.tick < end) { script(); w.step(); w.events.length = 0; if (w.mission) w.mission.events.length = 0; }
  return { g, w, rec, script };
}

/** Replay: the same setup with the recorded commands fed back. */
function replay(setup: GameSetup, cmds: [number, Command][], hashes: [number, string][], ticks: number) {
  const g = headlessGame(setup);
  const w = g.world;
  const feeder = new CommandFeeder(w, cmds, hashes);
  hookStep(w, () => feeder.beforeStep(), () => feeder.afterStep());
  while (w.tick < ticks) { w.step(); w.events.length = 0; if (w.mission) w.mission.events.length = 0; }
  return { w, feeder };
}

const ROOT: GameSetup = {
  faction: 'allies', color: 0x3d7be0, opponents: [{ faction: 'soviet', difficulty: 'hard' }], mapSize: 64, water: 0.5, trees: 0.5, ore: 0.6,
  credits: 8000, startUnits: 'light', fog: true, timeOfDay: 'day', quality: 'low', seed: 5150,
};

function replayData(id: string, setup: GameSetup, rec: CommandRecorder, w: World, local: number): ReplayData {
  const { load: _l, replay: _r, quality: _q, ...s } = setup;
  return {
    v: REPLAY_VERSION, id, createdAt: Date.now(), gameVersion: 'test', setup: s, mapName: 'Test', mapW: w.map.w, mapH: w.map.h,
    players: w.players.map((p) => ({ name: p.name, faction: p.faction, color: p.color, team: p.team, ai: w.ais.find((a) => a.player === p)?.difficulty })),
    local, ticks: w.tick, result: w.gameOver ? 'victory' : 'abandoned', winnerTeam: w.winnerTeam, cmds: rec.cmds, hashes: rec.hashes,
  };
}

describe('branching replays: rewind & take command', () => {
  const PARENT = seconds(240), T = seconds(150), BRANCH = seconds(120);
  const parent = live(ROOT, PARENT);
  const parentData = replayData('rparent', ROOT, parent.rec, parent.w, 0);
  // watch the parent back to T (as the replay player does), then take command of the Soviet AI (player 1)
  const pb = replay(ROOT, parentData.cmds, parentData.hashes, T);
  const branch = makeBranch(parentData, pb.w, 1, 'hard', { cam: { x: 10, y: 10, dist: 20 } });
  const bSetup = JSON.parse(JSON.stringify(branchSetup(parentData.setup, branch, 'low'))) as GameSetup;
  const child = live(bSetup, T + BRANCH);
  const childData = replayData('rchild', bSetup, child.rec, child.w, 1);

  test('the parent playback reaches the branch point in sync', () => {
    assert.equal(pb.feeder.desyncTick, -1, 'parent replay in sync');
    assert.equal(branch.tick, T, 'branch tick');
    const h = parentData.hashes.find(([t]) => t === T);
    assert.ok(h, 'the recording has a hash at the branch tick');
    assert.equal(branch.hash, h![1], 'the branch starts from the recorded state');
  });

  test('the branch starts from the exact state with the chosen player as the human', () => {
    const g = headlessGame(bSetup);
    assert.equal(g.world.tick, T, 'starts at the branch tick');
    assert.equal(worldHash(g.world), branch.hash, 'loaded start hashes like the parent at the branch tick');
    assert.equal(g.local.id, 1, 'player 1 is the local human');
    assert.ok(g.world.players[1].isHuman && !g.world.players[0].isHuman, 'human flags swapped');
    assert.deepEqual(g.world.ais.map((a) => a.player.id), [0], 'only the former human is AI now');
    assert.equal(g.world.ais[0].difficulty, 'hard', 'at the chosen difficulty');
    assert.equal(g.world.players[1].buildSpeed, 1, 'the new human plays without the AI economy bonus');
  });

  test('a branch replays deterministically to identical hashes', () => {
    assert.ok(child.rec.cmds.length > 5, `branch commands recorded (${child.rec.cmds.length})`);
    assert.ok(child.rec.cmds.every(([, c]) => c.player === 1), 'commands come from the new commander');
    assert.ok(child.rec.cmds[0][0] >= T, 'recorded from the branch tick on');
    const back = JSON.parse(JSON.stringify(childData)) as ReplayData;
    assert.ok(isReplayData(back), 'valid replay file');
    const r = replay(back.setup as GameSetup, back.cmds, back.hashes, back.ticks);
    assert.equal(r.feeder.checked, childData.hashes.length, 'every hash compared');
    assert.ok(r.feeder.checked >= 5, `hashes checked (${r.feeder.checked})`);
    assert.equal(r.feeder.desyncTick, -1, `no desync (at ${r.feeder.desyncTick})`);
    assert.equal(worldHash(r.w), worldHash(child.w), 'identical final state');
    assert.equal(replayStartTick(back), T, 'the branch replay starts at its branch point');
  });

  test('the branch diverges from the parent (a new timeline)', () => {
    const atEnd = parentData.hashes.find(([t]) => t === PARENT - (PARENT % 200));
    const mine = childData.hashes.find(([t]) => t === atEnd?.[0]);
    if (atEnd && mine) assert.notEqual(mine[1], atEnd[1], 'different future');
    assert.notEqual(worldHash(child.w), worldHash(parent.w), 'different world');
  });

  test('parent linkage: tree, depth, root and pruning by tree', () => {
    assert.equal(branch.parent, 'rparent', 'parent id');
    assert.equal(branch.root, 'rparent', 'root id');
    assert.equal(branch.depth, 1, 'depth');
    // a branch of the branch
    const pb2 = replay(childData.setup as GameSetup, childData.cmds, childData.hashes, T + seconds(60));
    const b2 = makeBranch(childData, pb2.w, 0, 'normal');
    assert.equal(b2.parent, 'rchild', 'grandchild parent');
    assert.equal(b2.root, 'rparent', 'grandchild root');
    assert.equal(b2.depth, 2, 'grandchild depth');
    const g2 = headlessGame(branchSetup(childData.setup, b2, 'low'));
    assert.equal(g2.local.id, 0, 'back to the original side');
    assert.deepEqual(g2.world.ais.map((a) => a.player.id), [1], 'the branch commander became AI');
    assert.equal(worldHash(g2.world), b2.hash, 'grandchild start state');
    const grand: ReplayData = { ...childData, id: 'rgrand', createdAt: childData.createdAt + 1, setup: { ...childData.setup, branch: b2 } };
    const other: ReplayData = { ...parentData, id: 'rother', createdAt: parentData.createdAt - 10, storedAt: 1 };
    const roots = replayTree([grand, other, childData, parentData]);
    assert.equal(roots.length, 2, 'two trees');
    const flat = flattenTree(roots).map((n) => [n.data.id, n.depth]);
    assert.deepEqual(flat.slice(0, 3), [['rparent', 0], ['rchild', 1], ['rgrand', 2]], 'original -> branch -> branch of branch');
    const orphan = replayTree([grand, other]);
    assert.ok(orphan.find((n) => n.data.id === 'rgrand')?.orphan, 'a branch whose parent is gone is an orphan root');
    const pr = pruneTrees([grand, other, childData, parentData], 3);
    assert.deepEqual(pr.keep.map((r) => r.id).sort(), ['rchild', 'rgrand', 'rparent'], 'the newest whole tree is kept');
    assert.deepEqual(pr.drop.map((r) => r.id), ['rother'], 'older trees are pruned');
  });

  test('save / load inside a branch continues the same timeline', () => {
    const half = T + seconds(60);
    const a = live(bSetup, T + BRANCH, { stopAt: half });
    const save = JSON.parse(JSON.stringify({ world: serializeWorld(a.w), replay: { cmds: a.rec.cmds, hashes: a.rec.hashes } }));
    const g = headlessGame({ ...bSetup, load: { version: 1, savedAt: 0, world: save.world, game: {} } });
    assert.equal(g.local.id, 1, 'still player 1 after loading');
    assert.ok(g.world.players[1].isHuman && !g.world.players[0].isHuman, 'roster kept');
    assert.deepEqual(g.world.ais.map((x) => x.player.id), [0], 'AI roster kept');
    const rec = new CommandRecorder(g.world, save.replay);
    hookStep(g.world, null, () => rec.afterStep());
    // (a fresh script: whatever it orders is recorded, and the replay feeds exactly that)
    const s2 = scripted(g.world, 1, (c) => { rec.record(c); g.world.issue(c); });
    while (g.world.tick < T + BRANCH) { s2(); g.world.step(); g.world.events.length = 0; }
    const r = replay(bSetup, rec.cmds, rec.hashes, T + BRANCH);
    assert.equal(r.feeder.desyncTick, -1, `the resumed branch replays from its start (desync at ${r.feeder.desyncTick})`);
    assert.equal(worldHash(r.w), worldHash(g.world), 'same final state as the resumed branch');
  });

  test('branching a King of the Hill match keeps the hill state and stays deterministic', () => {
    const koth: GameSetup = { ...ROOT, seed: 4242, koth: true, kothMinutes: 8 };
    const p = live(koth, seconds(200));
    const data = replayData('rkoth', koth, p.rec, p.w, 0);
    const back = replay(koth, data.cmds, data.hashes, seconds(150));
    const before = JSON.stringify((back.w.mission!.flags.koth as KothState).held);
    const b = makeBranch(data, back.w, 1, 'normal');
    const s = branchSetup(data.setup, b, 'low');
    const c = live(s, seconds(230));
    assert.ok(c.w.mission, 'the branch has the KOTH runtime');
    assert.equal(c.w.mission!.humanId, 1, 'runtime human is the new commander');
    const g0 = headlessGame(s);
    assert.equal(JSON.stringify((g0.world.mission!.flags.koth as KothState).held), before, 'hill times carried over');
    const r = replay(s, c.rec.cmds, c.rec.hashes, c.w.tick);
    assert.equal(r.feeder.desyncTick, -1, 'KOTH branch in sync');
    assert.equal(worldHash(r.w), worldHash(c.w), 'identical KOTH branch');
  });
});

describe('branches and challenges keep mods and custom maps', () => {
  test('a branch / challenge of a modded custom-map replay rebuilds the same world', () => {
    const mod = JSON.parse(readFileSync(new URL('../public/mods/tank-rush.rhmod.json', import.meta.url), 'utf8')) as ModFile;
    const mods = makeModSet([mod]);
    const custom: MapDef = { ...JSON.parse(JSON.stringify(getMapDef('pocket-valley'))), id: 'custom-test-valley', name: 'Test Valley', seed: 777 };
    const setup: GameSetup = { ...ROOT, seed: 9090, mapSize: custom.size, customMap: custom, mods };
    try {
      const p = live(setup, seconds(150));
      const tankCost = UNITS['3tnk'].cost;
      applyModSet(null);
      assert.notEqual(UNITS['3tnk'].cost, tankCost, 'the mod changes the rules');
      const data = replayData('rmodded', setup, p.rec, p.w, 0);
      const back = replay(JSON.parse(JSON.stringify(data.setup)) as GameSetup, data.cmds, data.hashes, seconds(100));
      assert.equal(back.feeder.desyncTick, -1, 'the modded custom-map replay plays back in sync');
      const b = makeBranch(data, back.w, 1, 'hard');
      const bs = JSON.parse(JSON.stringify(branchSetup(data.setup, b, 'low'))) as GameSetup;
      assert.equal(bs.mods?.hash, mods.hash, 'branch keeps the mod set');
      assert.deepEqual(bs.customMap, custom, 'branch keeps the custom map');
      applyModSet(null);
      const g = headlessGame(bs);
      assert.equal(appliedModSet()?.hash, mods.hash, 'the branch game applies the mods');
      assert.equal(UNITS['3tnk'].cost, tankCost, 'modded rules');
      assert.equal(worldHash(g.world), b.hash, 'the branch rebuilds the same world');
      const c = live(bs, seconds(160));
      const r = replay(bs, c.rec.cmds, c.rec.hashes, c.w.tick);
      assert.equal(r.feeder.desyncTick, -1, 'the modded branch replays in sync');
      assert.equal(worldHash(r.w), worldHash(c.w), 'identical');
      const ch = challengeFromState({ setup: data.setup, state: b.start, side: 1, goal: { kind: 'win' }, timeLimit: 600, title: 'Modded' });
      assert.equal(ch.setup.mods?.hash, mods.hash, 'challenge keeps the mod set');
      assert.deepEqual(ch.setup.customMap, custom, 'challenge keeps the custom map');
      applyModSet(null);
      const cg = headlessGame(challengeGameSetup(JSON.parse(JSON.stringify(ch)), 'low'));
      assert.equal(appliedModSet()?.hash, mods.hash, 'the challenge applies the mods');
      assert.equal(worldHash(cg.world), b.hash, 'the challenge starts from the same world');
    } finally {
      applyModSet(null);
    }
  });
});
