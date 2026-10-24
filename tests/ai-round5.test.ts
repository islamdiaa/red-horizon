// Skirmish AI, simulation version 7: Ore Truck field choice for the Classic commander, beaten teams that concede
// together, and an MCV that gives up on a deploy spot it can't reach.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap } from '../src/sim/mapgen';
import { World, type PlayerSetup } from '../src/sim/world';
import { TICK_HZ } from '../src/sim/types';
import { sandbox, building, unit, powerUp, ore } from './helpers';
import type { AIController } from '../src/sim/ai';
import { lanesOpen } from '../src/sim/ai-ops';
import { BUILDINGS } from '../src/data/rules';

const seconds = (s: number) => Math.round(s * TICK_HZ);

function run(w: World, ticks: number, until?: (w: World) => boolean) {
  for (let t = 0; t < ticks; t++) { w.step(); w.events.length = 0; if (until?.(w)) return; }
}

describe('beaten AI teams (version 7)', () => {
  test('two beaten AIs on one team concede together instead of waiting for each other', () => {
    const map = generateMap({ size: 64, players: 4, seed: 21, water: 0.2, trees: 0.4, ore: 0.6 });
    const players: PlayerSetup[] = [0, 1, 2, 3].map((i) => ({ name: `P${i}`, faction: i % 2 ? 'soviet' : 'allies', color: 0, team: i % 2, isHuman: false, ai: 'normal' }));
    const w = new World({ map, players, credits: 10000, startUnits: 'light', fog: true, seed: 21 });
    run(w, seconds(5 * 60), (x) => x.gameOver);
    assert.ok(!w.gameOver, 'still playing at 5:00');
    const losers = w.players.filter((p) => p.team === 1);
    for (const b of w.buildings) if (b.alive && losers.includes(b.owner)) w.kill(b, 'sold');
    // (a couple of fighters each, and their Ore Trucks)
    for (const p of losers) for (const u of w.units.filter((x) => x.alive && x.owner === p && !x.ut.harvester && x.weapons.length).slice(2)) w.kill(u, 'sold');
    const t0 = w.tick;
    run(w, seconds(3 * 60), (x) => x.gameOver);
    assert.ok(w.gameOver && w.winnerTeam === 0, `the beaten side conceded (game over: ${w.gameOver}, after ${((w.tick - t0) / TICK_HZ).toFixed(0)} s)`);
    assert.ok(w.tick - t0 < seconds(150), `within 150 s (${((w.tick - t0) / TICK_HZ).toFixed(0)} s)`);
  });
});

describe('AI MCV deployment (version 7)', () => {
  test('a deploy spot it cannot get to (fenced off) is given up for the next one', () => {
    const { world: w, p1 } = sandbox({ w: 64, h: 64, ai: [undefined, 'normal'], credits: 5000 });
    // ore everywhere round the MCV but a 5x5 pocket fenced in by sandbags
    for (let y = 14; y < 44; y++) for (let x = 14; x < 44; x++) if (!(x >= 33 && x <= 37 && y >= 23 && y <= 27)) w.map.ore[w.map.idx(x, y)] = 1;
    for (let x = 32; x <= 38; x++) { building(w, 'sbag', p1, x, 22); building(w, 'sbag', p1, x, 28); }
    for (let y = 23; y <= 27; y++) { building(w, 'sbag', p1, 32, y); building(w, 'sbag', p1, 38, y); }
    const mcv = unit(w, 'mcv', p1, 26, 26);
    let moves = 0;
    const issue = w.issue.bind(w);
    w.issue = (c) => { if (c.player === p1.id && c.c === 'move' && c.units.includes(mcv.id)) moves++; issue(c); };
    run(w, seconds(180), () => p1.has('fact'));
    assert.ok(p1.has('fact'), `deployed somewhere (${moves} move orders)`);
    assert.ok(moves < 100, `without driving at the fence all match (${moves} move orders)`);
  });
});

describe('Classic Ore Truck field choice (version 7)', () => {
  /** A Classic Hard AI in the top-right corner; its home field mined out to a trace of ore, a rich field mid-map. */
  function fields(care: number) {
    const { world: w, map, p1 } = sandbox({ w: 64, h: 64, ai: [undefined, 'hard'], credits: 0 });
    const ai = w.ais.find((a) => a.player === p1) as AIController;
    ai.tune.proTrucks = care;
    ai.tune.endConcede = 0; // (no human base in the sandbox: no surrender either)
    building(w, 'fact', p1, 54, 4);
    powerUp(w, p1, 54, 10, 2);
    building(w, 'proc', p1, 47, 6);
    for (let y = 13; y <= 21; y++) for (let x = 42; x <= 50; x++) if ((x + y) % 3 === 0) ore(map, x, y, x, y, 1);
    ore(map, 28, 30, 34, 36, 9);
    const truck = unit(w, 'harv', p1, 46, 15);
    w.issue({ c: 'harvest', player: p1.id, units: [truck.id], x: 46, y: 17 });
    const rich = () => { let n = 0; for (let y = 30; y <= 36; y++) for (let x = 28; x <= 34; x++) n += map.ore[map.idx(x, y)]; return n; };
    const before = rich();
    run(w, seconds(120));
    return { mined: before - rich(), truck };
  }

  test('a truck scraping a mined-out field at home goes on to a rich field (Ore Truck care 2 and up)', () => {
    const { mined } = fields(2);
    assert.ok(mined >= 20, `the rich field was worked (${mined} bails taken)`);
  });

  test('(trucks left to themselves, as Classic Normal plays: it stays on the mined-out field next door)', () => {
    const { mined } = fields(0);
    assert.equal(mined, 0, 'nothing taken from the rich field');
  });
});

describe('a broke AI pays for its Ore Truck first (version 7)', () => {
  test('trucks and money gone with a refinery in the structure queue: the queue is cleared and a truck rolls out', async () => {
    // (tools/qa/modesave.ts "broke AI sells for an Ore Truck": a Hard Allied AI's trucks die and its bank is emptied at
    // 4:00; version 6 split the money from its sales between the truck and a third refinery, both stalled at 96%)
    const { scenarios } = await import('../tools/qa/modesave');
    const sc = scenarios().find((x) => /broke AI sells/.test(x.name))!;
    const w = sc.make();
    const drive = sc.driver?.(w, (c) => w.issue(c));
    const p = w.players[1];
    const trucks = () => w.units.some((u) => u.alive && u.owner === p && u.ut.harvester);
    const end = sc.saveAt + seconds(150);
    while (w.tick < end && !w.gameOver) { drive?.(); w.step(); w.events.length = 0; }
    assert.ok(trucks(), `an Ore Truck rolls again (queues: ${p.queues.structure.items.map((i) => i.type)} / ${p.queues.vehicle.items.map((i) => `${i.type} $${Math.round(i.paid)}`)}, bank $${p.credits})`);
  });
});

describe('AI refinery placement (version 7)', () => {
  test('a refinery whose dock opens onto a corner closed off by trees and the map edge is not placed there', () => {
    const { world: w, map, p1 } = sandbox({ w: 32, h: 32, ai: [undefined, 'normal'] });
    building(w, 'fact', p1, 20, 20);
    // the dock of a refinery at (26, 26) is (27, 29); below it 15 cells between trees and the map edge
    assert.ok(lanesOpen(w, p1, BUILDINGS.proc, 26, 26), 'open ground: fine');
    for (let y = 29; y <= 31; y++) for (const x of [24, 30]) map.tree[map.idx(x, y)] = 1;
    for (let x = 24; x <= 30; x++) if (x < 26 || x > 28) map.tree[map.idx(x, 29)] = 1;
    assert.ok(!lanesOpen(w, p1, BUILDINGS.proc, 26, 26), 'its truck could never leave the corner');
  });
});
