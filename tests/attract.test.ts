// Attract mode / trailer staging (src/share/attract.ts): the naval clash needs the largest open sea, the
// battlefield picker must prefer maps that have one, and the directed program covers every set piece.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { GameMap, T } from '../src/sim/map';
import { battleProgram, fireNuke, largestSea, pickBattlefield, stageNaval, stageReinforcements, stageTeslaRaid } from '../src/share/attract';
import { setupScenario } from '../src/debug';
import { skirmish } from './helpers';
import { trailerProgram } from '../src/share/trailer';
import { clipProgram, clipStartTick, CLIP_LEAD } from '../src/ui/clips';
import { canRecordVideo, pickFormat, videoFileName } from '../src/share/recorder';

function lakeMap(): GameMap {
  const m = new GameMap(40, 40);
  // a 20×12 lake and a 3×3 pond
  for (let y = 5; y < 17; y++) for (let x = 10; x < 30; x++) m.terrain[y * 40 + x] = T.Water;
  for (let y = 30; y < 33; y++) for (let x = 2; x < 5; x++) m.terrain[y * 40 + x] = T.Water;
  return m;
}

describe('attract staging', () => {
  test('finds the largest sea and two far ends in open water', () => {
    const sea = largestSea(lakeMap(), 50);
    assert.ok(sea, 'the lake is found');
    assert.equal(sea!.cells, 240, 'the lake, not the pond');
    const d = Math.hypot(sea!.a[0] - sea!.b[0], sea!.a[1] - sea!.b[1]);
    assert.ok(d > 14, `the fleets start far apart (${d.toFixed(1)} cells)`);
    for (const [x, y] of [sea!.a, sea!.b]) assert.ok(x > 10 && x < 30 && y > 5 && y < 17, `inside the lake, off the shore (${x}, ${y})`);
  });
  test('no naval clash without a sea', () => {
    assert.equal(largestSea(new GameMap(32, 32)), null, 'dry map');
    assert.equal(largestSea(lakeMap(), 1000), null, 'too small');
  });
  test('the battlefield picker is deterministic for a given random source', () => {
    let s = 7;
    const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const a = pickBattlefield(rand);
    s = 7;
    const b = pickBattlefield(rand);
    assert.equal(a.seed, b.seed, 'same seed');
    assert.ok(Number.isInteger(a.seed), 'integer seed');
  });
  test('the program films every set piece', () => {
    const names = battleProgram({ sea: null }).map((s) => s.name);
    for (const n of ['establish', 'soviet-base', 'tesla', 'clash', 'naval', 'allied-base', 'nuke-launch', 'nuke-impact']) assert.ok(names.includes(n), `${n} shot`);
    assert.ok(battleProgram({ sea: null }).every((s) => s.dur > 2 && typeof s.pose === 'function'), 'every shot has a duration and a camera');
  });
});

describe('attract staging on a live world', () => {
  test('the set pieces stage: reinforcements, a Tesla raid, fleets, a nuke', () => {
    const { seed, sea } = pickBattlefield(() => 0.37);
    const world = skirmish({ seed, size: 64, ai: ['hard', 'hard'], startUnits: 'heavy', map: { water: 0.62, ore: 0.8, trees: 0.6 } });
    setupScenario(world, 'battle');
    for (let i = 0; i < 20; i++) world.step();
    const army = (i: number) => world.units.filter((u) => u.alive && u.owner === world.players[i] && u.weapons.length && !u.ut.harvester && u.kind !== 'naval').length;
    // a thinned-out side gets fresh armour; a side already above the cap does not
    for (const u of world.units) if (u.owner === world.players[0] && u.kind !== 'naval') u.alive = false;
    (world as unknown as { dirtyLists: boolean }).dirtyLists = true;
    world.step();
    const before = [army(0), army(1)];
    stageReinforcements(world);
    assert.ok(army(0) > before[0], `the thinned side is reinforced (${before[0]} -> ${army(0)})`);
    assert.ok(before[1] <= 26 ? army(1) > before[1] : army(1) === before[1], `the strong side only below the cap (${before[1]} -> ${army(1)})`);
    const coil = stageTeslaRaid(world);
    assert.ok(coil && coil.bt.id === 'tsla', 'a Soviet Tesla Coil is the raid target');
    if (sea) {
      assert.ok(stageNaval(world, sea), 'fleets staged on the sea');
      const ships = world.units.filter((u) => u.alive && u.kind === 'naval');
      assert.ok(ships.length >= 6 && ships.every((u) => world.map.terrain[world.map.idx(Math.floor(u.x), Math.floor(u.y))] === T.Water), `ships afloat (${ships.length})`);
    }
    for (let i = 0; i < 40; i++) world.step(); // silos power up
    const shot = fireNuke(world);
    assert.ok(shot, 'the silo fires');
    assert.ok(world.projectiles.some((q) => q.alive && q.special === 'nuke'), 'a nuke is in flight');
    for (let i = 0; i < 20 * 12 && world.projectiles.some((q) => q.alive && q.special === 'nuke'); i++) world.step();
    assert.ok(!world.projectiles.some((q) => q.alive && q.special === 'nuke'), 'and lands');
  });
});

describe('trailer and clips', () => {
  test('the trailer cut runs 60–90 s with an opening and a closing title', () => {
    const p = trailerProgram(null);
    const total = p.reduce((s, x) => s + x.dur, 0);
    assert.ok(total >= 60 && total <= 90, `length ${total.toFixed(1)} s`);
    assert.equal(p[0].card?.title, 'Red Horizon', 'opening title');
    assert.equal(p[p.length - 1].card?.title, 'Red Horizon', 'closing title');
  });
  test('a clip spans its length and opens a few seconds before the moment', () => {
    const p = clipProgram('Biggest clash', 'Map · 4:00', 18, () => null);
    assert.ok(Math.abs(p.reduce((s, x) => s + x.dur, 0) - 18) < 1e-9, 'clip length');
    assert.equal(clipStartTick(20 * 60), 20 * (60 - CLIP_LEAD), 'lead-in');
    assert.equal(clipStartTick(10), 0, 'never before the start');
  });
  test('recordings get a safe file name; no recorder outside a browser', () => {
    assert.equal(videoFileName('Biggest clash: 12 lost in 10 s!', 'webm', new Date(2026, 9, 17, 9, 5)), 'red-horizon-biggest-clash-12-lost-in-10-s-20261017-0905.webm', 'slug + timestamp');
    assert.equal(videoFileName('<script>', 'mp4', new Date(2026, 0, 2, 3, 4)), 'red-horizon-script-20260102-0304.mp4', 'markup never reaches the name');
    assert.equal(pickFormat(), null, 'no MediaRecorder in node');
    assert.equal(canRecordVideo(), false, 'clips are offered only where they can be recorded');
  });
});
