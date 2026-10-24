// REVIEW round 5: surrender (src/sim/resign.ts) with the AI that takes a side over. A human who surrendered while a
// teammate played on hands the side to the AI; when the side is later beaten with nobody left on it, that AI concedes
// for it (ai.ts lastStand), which used to be ignored because the player had surrendered already: the side's last Ore
// Trucks or a disguised spy kept a finished 2v2 going for many minutes.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { headlessGame } from '../src/modes/headless';
import { matchSetup } from '../src/net/roster';
import { normaliseSettings } from '../src/net/settings';
import type { MatchStart, SlotView } from '../src/net/protocol';
import type { World } from '../src/sim/world';
import { worldHash } from '../src/replay/hash';
import { TICK_HZ } from '../src/sim/types';

const human = (seat: number, name: string): SlotView => ({ kind: 'human', seat, name, ready: true, connected: true, faction: 'random' });
function world(): World {
  const start: MatchStart = { seed: 4242, room: { code: 'TESTAB', phase: 'match', host: 1, build: '', mods: '', settings: normaliseSettings({ mode: '2v2', size: 64, startUnits: 'light' }), slots: [human(1, 'Ann'), human(2, 'Ben'), human(3, 'Cat'), human(4, 'Dan')] } };
  return headlessGame(matchSetup(start, 1, 'low', null)).world;
}
function run(w: World, ticks: number) {
  for (let i = 0; i < ticks && !w.gameOver; i++) { w.step(); w.events.length = 0; }
}
const owns = (w: World, id: number) => w.units.filter((u) => u.alive && u.owner.id === id).length + w.buildings.filter((b) => b.alive && b.owner.id === id).length;

/** Ann (player 0) surrenders while Ben plays on; later Ben is wiped out and Ann's AI-run side loses its base. */
function beatenTakeover(): World {
  const w = world();
  run(w, 200);
  w.issue({ c: 'resign', player: 0 });
  run(w, 1);
  assert.ok(w.players[0].resigned && !w.players[0].isHuman && !w.players[0].defeated, 'the AI took Ann\'s side over');
  run(w, TICK_HZ * 20);
  for (const e of [...w.buildings, ...w.units]) if (e.alive && e.owner.id === 1) w.kill(e, 'sold');
  for (const b of w.buildings) if (b.alive && b.owner.id === 0) w.kill(b, 'sold');
  // (what is left: a rifleman and the Ore Trucks, too little for a last stand)
  const keep = w.units.find((u) => u.alive && u.owner.id === 0 && u.ut.id === 'e1');
  for (const u of w.units) if (u.alive && u.owner.id === 0 && u !== keep && !u.ut.harvester) w.kill(u, 'sold');
  return w;
}

describe('surrender: the AI that took a side over', () => {
  test('concedes for the side once it is beaten and nobody on it plays (it used to fight on with its last units)', () => {
    const w = beatenTakeover();
    assert.ok(owns(w, 0) > 0, 'units of the side are left on the field');
    run(w, TICK_HZ * 10);
    assert.ok(w.players[0].defeated && owns(w, 0) === 0, `the side conceded (defeated ${w.players[0].defeated}, ${owns(w, 0)} left)`);
    run(w, TICK_HZ * 2);
    assert.ok(w.gameOver && w.winnerTeam === w.players[2].team, 'the other team wins');
  });

  test('the same game twice gives the same state', () => {
    const a = beatenTakeover(), b = beatenTakeover();
    run(a, TICK_HZ * 10); run(b, TICK_HZ * 10);
    assert.equal(worldHash(a), worldHash(b), 'deterministic');
  });

  test('while a teammate still plays, a second surrender of the same player changes nothing', () => {
    const w = world();
    run(w, 200);
    w.issue({ c: 'resign', player: 0 });
    run(w, 1);
    const before = owns(w, 0) + owns(w, 1);
    w.issue({ c: 'resign', player: 0 });
    run(w, 1);
    assert.ok(!w.players[0].defeated && !w.players[1].defeated, 'the side fights on');
    assert.equal(owns(w, 0) + owns(w, 1), before, 'nothing destroyed');
  });
});
