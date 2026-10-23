// Endgames (simulation version 6): a beaten side's last units don't keep a match alive. An AI that knows nothing of
// an enemy still in the game hunts with its whole army in search parties, square by square of open ground (a square
// whose centre cell was a tree or rock used to be skipped, so a unit in a map corner was never found).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap } from '../src/sim/mapgen';
import { World, type PlayerSetup } from '../src/sim/world';
import { AIController, type AIDifficulty } from '../src/sim/ai';
import { TICK_HZ } from '../src/sim/types';
import { serializeWorld, deserializeWorld } from '../src/sim/save';
import { worldHash } from '../src/replay/hash';
import { sandbox, building, unit, powerUp, ore } from './helpers';
import { lanesOpen } from '../src/sim/ai-ops';
import { BUILDINGS } from '../src/data/rules';

const seconds = (s: number) => Math.round(s * TICK_HZ);

function match(levels: (AIDifficulty | undefined)[], o: { seed?: number; size?: number } = {}): World {
  const seed = o.seed ?? 21;
  const map = generateMap({ size: o.size ?? 64, players: levels.length, seed, water: 0.3, trees: 0.5, ore: 0.6 });
  const players: PlayerSetup[] = levels.map((d, i) => ({ name: `P${i}`, faction: i % 2 ? 'soviet' : 'allies', color: 0, team: i, isHuman: !d, ai: d }));
  return new World({ map, players, credits: 10000, startUnits: 'light', fog: true, seed });
}

function run(w: World, ticks: number, until?: (w: World) => boolean) {
  for (let t = 0; t < ticks; t++) { w.step(); w.events.length = 0; if (until?.(w)) return; }
}

const aiOf = (w: World, i: number) => w.ais.find((a) => a.player === w.players[i]) as AIController;

/** The human (slot 0) is reduced to one rifleman, sent to the open cell nearest the map corner farthest from the AI. */
function crush(w: World): { x: number; y: number } {
  const h = w.players[0];
  for (const b of w.buildings) if (b.alive && b.owner === h) w.kill(b, 'sold');
  const keep = w.units.find((u) => u.alive && u.owner === h && u.kind === 'infantry')!;
  for (const u of w.units) if (u.alive && u.owner === h && u !== keep) w.kill(u, 'sold');
  const yard = w.buildings.find((b) => b.alive && b.bt.id === 'fact' && b.owner !== h)!;
  const m = w.map;
  let best: [number, number] = [keep.x, keep.y], bd = -1;
  for (const [cx, cy] of [[1, 1], [m.w - 2, 1], [1, m.h - 2], [m.w - 2, m.h - 2]]) {
    for (let r = 0; r < 10; r++) {
      let hit: [number, number] | null = null;
      for (let dy = -r; dy <= r && !hit; dy++) for (let dx = -r; dx <= r; dx++) if (m.passable(cx + dx, cy + dy)) { hit = [cx + dx + 0.5, cy + dy + 0.5]; break; }
      if (!hit) continue;
      const d = Math.hypot(hit[0] - yard.x, hit[1] - yard.y);
      if (d > bd) { bd = d; best = hit; }
      break;
    }
  }
  w.issue({ c: 'move', player: h.id, units: [keep.id], x: best[0], y: best[1] });
  return { x: best[0], y: best[1] };
}

describe('AI endgames (version 6)', () => {
  test('hunting: a beaten player\'s last unit hiding in a far corner is found and finished', () => {
    // (version 5 never found these two in 25 minutes; version 6 takes 4.3 and 2.5)
    for (const [d, seed] of [['brutal', 9], ['easy', 8]] as const) {
      const w = match([undefined, d], { seed, size: 96 });
      run(w, seconds(8 * 60));
      crush(w);
      const t0 = w.tick;
      run(w, seconds(8 * 60), (w) => w.players[0].defeated);
      assert.ok(w.players[0].defeated, `${d}: the last unit is found within 8 minutes (still alive after ${((w.tick - t0) / TICK_HZ / 60).toFixed(1)} min)`);
    }
  });

  test('hunting: with nothing known of the enemy, the army fans out in parties to different squares', () => {
    const w = match([undefined, 'normal'], { seed: 8 });
    run(w, seconds(6 * 60));
    crush(w);
    const ai = aiOf(w, 1);
    let parties = 0;
    run(w, seconds(4 * 60), () => {
      if (!ai.huntNow()) return false;
      const dests = new Set<string>();
      for (const u of ai.army()) if (u.order.type === 'move' && u.order.attackMove) dests.add(`${Math.round(u.order.x)},${Math.round(u.order.y)}`);
      parties = Math.max(parties, dests.size);
      return parties >= 3;
    });
    assert.ok(parties >= 3, `search parties head for at least three different squares (${parties})`);
  });

  test('a square whose centre is a tree or rock is still searched: its open ground decides', () => {
    const w = match([undefined, 'normal'], { seed: 8 });
    run(w, seconds(30));
    const ai = aiOf(w, 1), m = w.map;
    // every square with open ground has a hunt point on open ground (nothing in view yet over most of the map)
    const [bx, by] = ai.baseCenter();
    const h = ai.intel.huntPoint(bx, by);
    assert.ok(h && m.passable(Math.floor(h[0]), Math.floor(h[1])), 'a point on open ground');
    const seen = ai.intel.seenAt!;
    assert.equal(seen.length, Math.ceil(m.w / 4) * Math.ceil(m.h / 4), '4-cell squares');
  });

  test('save / load in the middle of a hunt continues the exact game', () => {
    const w = match([undefined, 'hard'], { seed: 8 });
    run(w, seconds(6 * 60));
    crush(w);
    run(w, seconds(40));
    assert.ok(aiOf(w, 1).huntNow(), 'hunting when saved');
    const copy = match([undefined, 'hard'], { seed: 8 });
    deserializeWorld(copy, JSON.parse(JSON.stringify(serializeWorld(w))));
    run(w, seconds(60));
    run(copy, seconds(60));
    assert.equal(worldHash(copy), worldHash(w), 'same state a minute after the load');
  });

  test('a beaten AI (no yard, MCV or factory) throws its army at the enemy, and concedes once that is gone', () => {
    const w = match([undefined, 'easy'], { seed: 8 });
    run(w, seconds(5 * 60));
    const ai = aiOf(w, 1), p = w.players[1];
    // (a power plant left standing somewhere doesn't keep it in the game)
    const plant = w.buildings.find((b) => b.alive && b.owner === p && (b.bt.id === 'powr' || b.bt.id === 'apwr'))!;
    for (const b of w.buildings) if (b.alive && b.owner === p && b !== plant) w.kill(b, 'sold');
    for (const u of w.units) if (u.alive && u.owner === p && u.ut.deploysInto) w.kill(u, 'sold');
    // an army left: the last stand, not a surrender
    const tanks = [0, 1, 2, 3].map((k) => w.addUnit(p.faction === 'soviet' ? '3tnk' : '2tnk', p, ai.baseCenter()[0] + k, ai.baseCenter()[1]));
    run(w, seconds(5));
    assert.ok(!p.defeated && !p.resigned, 'fights on with four tanks');
    assert.ok(tanks.some((t) => t.order.type === 'move' && t.order.attackMove), 'the tanks go for the enemy');
    // down to an Ore Truck and a helicopter: it concedes, and the human has won
    for (const u of w.units) if (u.alive && u.owner === p && !u.ut.harvester) w.kill(u, 'sold');
    w.addUnit(p.faction === 'soviet' ? 'hind' : 'heli', p, 2, 2);
    run(w, seconds(5));
    assert.ok(p.defeated && p.resigned, 'conceded');
    assert.ok(w.gameOver && w.winnerTeam === 0, 'the human wins');
  });

  test('an AI with a base, or an MCV to build one, never concedes', () => {
    const w = match([undefined, 'recruit'], { seed: 8 });
    run(w, seconds(3 * 60));
    const p = w.players[1];
    for (const u of w.units) if (u.alive && u.owner === p) w.kill(u, 'sold');
    run(w, seconds(10));
    assert.ok(!p.defeated, 'a base and no army: not beaten');
    for (const b of w.buildings) if (b.alive && b.owner === p) w.kill(b, 'sold');
    w.addUnit('mcv', p, 10.5, 10.5);
    run(w, seconds(5));
    assert.ok(!p.defeated, 'an MCV left: not beaten');
  });
});

describe('AI fixes from the round-4 code review (version 6)', () => {
  function helpScene(level: AIDifficulty) {
    const { world: w } = sandbox({ w: 64, h: 64, factions: ['allies', 'allies', 'soviet'], teams: [0, 0, 1], ai: [undefined, level, 'normal'], credits: 0 });
    const [hum, ally, foe] = w.players;
    building(w, 'fact', hum, 6, 50); powerUp(w, hum, 6, 56, 2); building(w, 'proc', hum, 11, 50);
    building(w, 'fact', ally, 6, 8); powerUp(w, ally, 6, 14, 2); building(w, 'weap', ally, 11, 8);
    building(w, 'fact', foe, 52, 8); powerUp(w, foe, 52, 14, 2);
    for (let k = 0; k < 10; k++) unit(w, '2tnk', ally, 10 + (k % 5), 16 + Math.floor(k / 5));
    for (let k = 0; k < 8; k++) unit(w, '3tnk', foe, 14 + (k % 4), 44 + Math.floor(k / 4));
    let sent = 0;
    const issue = w.issue.bind(w);
    w.issue = (c) => { if (c.player === 1 && c.c === 'move' && c.attackMove && Math.hypot(c.x - 15, c.y - 45) < 10) sent = Math.max(sent, c.units.length); issue(c); };
    for (let t = 0; t < seconds(15); t++) { w.step(); w.events.length = 0; }
    return sent;
  }

  test('a teammate\'s base under attack: Normal sends enough to outweigh the attackers, Easy half its army', () => {
    // (8 heavy tanks, $9,200: ten medium tanks are worth $8,000, so Normal sends them all; it used to stop at half)
    assert.equal(helpScene('normal'), 10, 'Normal: the whole free army');
    assert.equal(helpScene('easy'), 5, 'Easy: a modest helper, half of it');
  });

  test('no structure goes next to the side\'s own refinery dock or war-factory exit', () => {
    const { world: w, p1 } = sandbox({ w: 40, h: 40, ai: [undefined, 'normal'] });
    building(w, 'fact', p1, 15, 10);
    powerUp(w, p1, 15, 4, 2);
    const ref = building(w, 'proc', p1, 10, 10); // dock cell (11, 13)
    const [dx, dy] = ref.dockCell()!;
    const gun = BUILDINGS.gun, powr = BUILDINGS.powr;
    assert.ok(!lanesOpen(w, p1, gun, dx - 1, dy), 'no turret beside the dock');
    assert.ok(!lanesOpen(w, p1, gun, dx + 1, dy + 1), 'no turret diagonally below it');
    assert.ok(!lanesOpen(w, p1, powr, dx - 1, dy + 1), 'no power plant below it');
    assert.ok(lanesOpen(w, p1, gun, dx + 3, dy), 'two cells to the side is fine');
    // a refinery whose own dock would open onto structures is not placed there
    building(w, 'powr', p1, 21, 14);
    assert.ok(!lanesOpen(w, p1, BUILDINGS.proc, 20, 11), 'its dock would face a power plant');
    // and the AI's own placement search keeps to it
    const ai = aiOf(w, 1);
    for (const t of ['gun', 'powr', 'pbox']) {
      const spot = ai.findPlacement(BUILDINGS[t], [dx, dy + 1]);
      assert.ok(spot && lanesOpen(w, p1, BUILDINGS[t], spot[0], spot[1]), `${t} placed clear of the dock (${spot})`);
    }
  });

  test('an MCV that cannot deploy where it stands drives to the nearest spot where the yard fits', () => {
    const { world: w, map, p1 } = sandbox({ w: 40, h: 40, ai: [undefined, 'normal'] });
    ore(map, 14, 14, 22, 22); // the start is an ore field: no yard there
    const mcv = unit(w, 'mcv', p1, 18.5, 18.5);
    assert.ok(!w.canDeploy(mcv), 'cannot deploy on the ore');
    let t = 0;
    for (; t < seconds(60) && !p1.has('fact'); t++) { w.step(); w.events.length = 0; }
    assert.ok(p1.has('fact'), `deployed (${(t / TICK_HZ).toFixed(0)} s)`);
    assert.ok(t < seconds(30), `within 30 s (${(t / TICK_HZ).toFixed(0)} s)`);
  });
});

describe('a beaten AI with an AI teammate (version 6)', () => {
  test('it fights on and never concedes for its teammate', () => {
    const map = generateMap({ size: 64, players: 4, seed: 5, water: 0.3, trees: 0.5, ore: 0.6 });
    const players: PlayerSetup[] = [0, 1, 2, 3].map((i) => ({ name: `P${i}`, faction: i % 2 ? 'soviet' : 'allies', color: 0, team: i < 2 ? 0 : 1, isHuman: i === 0, ai: i === 0 ? undefined : 'normal' }));
    const w = new World({ map, players, credits: 10000, startUnits: 'light', fog: true, seed: 5 });
    run(w, seconds(4 * 60));
    const p = w.players[2];
    for (const b of w.buildings) if (b.alive && b.owner === p) w.kill(b, 'sold');
    for (const u of w.units) if (u.alive && u.owner === p && !u.ut.harvester) w.kill(u, 'sold');
    run(w, seconds(10));
    assert.ok(!p.resigned, 'no surrender while its teammate plays');
    assert.ok(!w.players[3].defeated, 'the teammate is still in the game');
  });
});

describe('Recruit and Easy with a human teammate play his support (version 6)', () => {
  test('no waves of their own: the army waits between the two bases', () => {
    for (const d of ['recruit', 'easy'] as const) {
      const map = generateMap({ size: 96, players: 4, seed: 9, water: 0.3, trees: 0.5, ore: 0.6 });
      const players: PlayerSetup[] = [0, 1, 2, 3].map((i) => ({ name: `P${i}`, faction: i % 2 ? 'soviet' : 'allies', color: 0, team: i < 2 ? 0 : 1, isHuman: i === 0, ai: i === 0 ? undefined : i === 1 ? d : 'recruit' }));
      const w = new World({ map, players, credits: 10000, startUnits: 'light', fog: true, seed: 9 });
      const ai = aiOf(w, 1);
      const mcv = w.units.find((u) => u.owner === w.players[0] && u.ut.deploysInto)!;
      w.issue({ c: 'deploy', player: 0, units: [mcv.id] });
      // (past its first wave's time; the idle human's base still stands)
      run(w, seconds(12 * 60));
      assert.ok(w.buildings.some((b) => b.alive && b.owner === w.players[0]), 'the human still has a base');
      assert.equal(ai.waves, 0, `${d}: no waves of its own`);
      const sp = ai.supportPoint();
      assert.ok(sp, `${d}: a support point`);
      const army = ai.army();
      const near = army.filter((u) => Math.hypot(u.x - sp![0], u.y - sp![1]) < 10).length;
      assert.ok(army.length > 0 && near >= army.length * 0.6, `${d}: the army waits there (${near} of ${army.length})`);
    }
  });

  test('without a human teammate a Recruit AI still attacks', () => {
    const w = match([undefined, 'recruit'], { seed: 12, size: 96 });
    run(w, seconds(14 * 60));
    assert.ok(aiOf(w, 1).supportPoint() === null && aiOf(w, 1).waves > 0, 'its own waves');
  });
});

describe('a broke AI recovers its economy (version 6)', () => {
  test('no Ore Truck and an empty bank: it sells what it can spare until a truck is paid for', () => {
    const { world: w, map, p1 } = sandbox({ w: 48, h: 48, ai: [undefined, 'hard'], credits: 0 });
    building(w, 'fact', p1, 20, 20);
    powerUp(w, p1, 26, 20, 3);
    building(w, 'proc', p1, 20, 26);
    building(w, 'weap', p1, 14, 20);
    const gap = building(w, 'gap', p1, 14, 26);
    building(w, 'dome', p1, 8, 20);
    building(w, 'fix', p1, 8, 26);
    building(w, 'gun', p1, 26, 14);
    ore(map, 28, 28, 34, 34);
    for (let t = 0; t < seconds(180) && !w.units.some((u) => u.alive && u.owner === p1 && u.ut.harvester); t++) { w.step(); w.events.length = 0; }
    assert.ok(!gap.alive, 'the gap generator went first');
    assert.ok(w.units.some((u) => u.alive && u.owner === p1 && u.ut.harvester), 'an Ore Truck rolls again');
    assert.ok(w.buildings.some((b) => b.alive && b.owner === p1 && b.bt.id === 'proc') && p1.has('fact') && p1.has('weap'), 'the yard, the refinery and the war factory stay');
  });
});
