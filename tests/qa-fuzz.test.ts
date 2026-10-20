// Regressions found by the command fuzzer (tools/qa/fuzz.ts): saves that did not continue exactly, rules that
// depended on the previous match, a dug-in M.A.D. Tank inside a new structure. Plus a short fuzz smoke run.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sandbox, unit, building, run as runTicks, seconds } from './helpers';
import { serializeWorld, deserializeWorld } from '../src/sim/save';
import { worldHash } from '../src/replay/hash';
import { T } from '../src/sim/map';
import { World } from '../src/sim/world';
import { generateMap } from '../src/sim/mapgen';
import { applyModSet } from '../src/mods/engine';
import { withMutatorMods } from '../src/modes/mutators';
import { FRng, makeCase, runCase } from '../tools/qa/fuzz';
import { sanitizeCommand } from '../src/net/commands';
import type { Unit } from '../src/sim/entities';

/** Save `a`, load it into a world built by `make`, and return the copy. */
function reload(a: World, make: () => World): World {
  const b = make();
  deserializeWorld(b, JSON.parse(JSON.stringify(serializeWorld(a))));
  return b;
}

const flat = (fog = false) => sandbox({ fog, seed: 3 }).world;
const run = (w: World, s: number) => runTicks(w, seconds(s));

describe('saves continue exactly (fuzzer regressions)', () => {
  test('a target that died this tick is kept by the save', () => {
    const a = flat();
    const [p0, p1] = a.players;
    const t = unit(a, '2tnk', p0, 10.5, 10.5), v = unit(a, 'e1', p1, 12.5, 10.5);
    run(a, 0.1);
    t.target = v; // v dies and leaves the lists in the same tick: t still points at it until its next update
    v.alive = false;
    a.entities.delete(v.id);
    a.units = a.units.filter((u) => u !== v);
    const b = reload(a, flat);
    assert.equal(worldHash(b), worldHash(a), 'same hash right after loading');
    const tb = b.entities.get(t.id) as Unit;
    assert.ok(tb.target && !tb.target.alive && tb.target.id === v.id, 'the restored tank points at the same dead rifleman');
    assert.ok(!b.entities.has(v.id), 'the dead rifleman is not back in the world');
    run(a, 2); run(b, 2);
    assert.equal(worldHash(b), worldHash(a), 'same hash two seconds later');
  });

  test('spent projectiles still in the list are saved', () => {
    const a = flat();
    const [p0, p1] = a.players;
    unit(a, '2tnk', p0, 10.5, 10.5); unit(a, '2tnk', p1, 14.5, 10.5);
    let n = 0;
    while (!a.projectiles.length && n++ < 200) { a.step(); a.events.length = 0; }
    assert.ok(a.projectiles.length > 0, 'a shell is in flight');
    a.projectiles[0].alive = false; // landed this tick (the list is pruned every 20 ticks)
    const b = reload(a, flat);
    assert.equal(b.projectiles.length, a.projectiles.length, 'the same projectile list');
    assert.equal(worldHash(b), worldHash(a), 'same hash right after loading');
  });

  test('fog of war is restored as it was, not recomputed', () => {
    const a = flat(true);
    const [p0] = a.players;
    const s = unit(a, 'jeep', p0, 10.5, 10.5);
    run(a, 1);
    s.x += 6; // moved since the last refresh (every 4 ticks)
    const vis = [...a.players[0].visible];
    const b = reload(a, () => flat(true));
    assert.deepEqual([...b.players[0].visible], vis, 'visible cells as saved');
    run(a, 3); run(b, 3);
    assert.equal(worldHash(b), worldHash(a), 'same hash three seconds later');
  });

  test('the first commands after loading see the units where they are', () => {
    const a = flat();
    const [p0] = a.players;
    const crowd: Unit[] = [];
    for (let k = 0; k < 9; k++) crowd.push(unit(a, '2tnk', p0, 20.5 + (k % 3), 20.5 + Math.floor(k / 3)));
    a.issue({ c: 'move', player: 0, units: crowd.map((u) => u.id), x: 30, y: 30 });
    run(a, 2);
    const b = reload(a, flat);
    const cmd = { c: 'scatter' as const, player: 0, units: crowd.map((u) => u.id) };
    a.issue(cmd); b.issue(JSON.parse(JSON.stringify(cmd)));
    run(a, 1); run(b, 1);
    assert.equal(worldHash(b), worldHash(a), 'same hash after a scatter issued right after loading');
  });

  test('the path queue comes back exactly (a unit that gave up its goal keeps it given up)', () => {
    const a = flat();
    const [p0] = a.players;
    const t = unit(a, '2tnk', p0, 10.5, 10.5), q = unit(a, '2tnk', p0, 12.5, 10.5);
    a.requestPath(t, 30.5, 30.5);
    t.hasGoal = false; // (gave up while the request still waits in the queue, as a stuck unit does)
    a.requestPath(q, 20.5, 30.5);
    q.pathPending = false; // (a request it no longer wants: the queue skips it)
    const b = reload(a, flat);
    const tb = b.entities.get(t.id) as Unit, qb = b.entities.get(q.id) as Unit;
    assert.equal(tb.hasGoal, false, 'still no goal');
    assert.equal(qb.pathPending, false, 'the dropped request stays dropped');
    run(a, 1); run(b, 1);
    assert.equal(worldHash(b), worldHash(a), 'same hash a second later');
    assert.equal(tb.hasGoal, t.hasGoal, 'same goal state');
  });

  test('Commander research levels keep their order through a save', () => {
    const mk = () => new World({ map: generateMap({ size: 48, players: 2, seed: 5, water: 0.2, trees: 0.3, ore: 0.6 }), players: [
      { name: 'A', faction: 'allies', color: 0, team: 0, isHuman: true }, { name: 'B', faction: 'soviet', color: 0, team: 1, isHuman: false, ai: 'normal' },
    ], credits: 5000, startUnits: 'mcv', fog: true, seed: 5, rules: 'commander' });
    const a = mk();
    run(a, 1);
    assert.ok(a.econ, 'Commander economy on');
    const e = a.econ!.players[0];
    e.levels.precision_optics = 1; // finished in this order, not the table's
    e.levels.composite_armor = 2;
    const b = reload(a, mk);
    assert.deepEqual(Object.keys(b.econ!.players[0].levels), Object.keys(e.levels), 'same key order');
    assert.equal(worldHash(b), worldHash(a), 'same hash right after loading');
  });
});

describe('placement and rules (fuzzer regressions)', () => {
  test('a structure placed on a deployed M.A.D. Tank moves it out for good', () => {
    const { world: w } = sandbox({ seed: 4 });
    const p = w.players[0];
    building(w, 'fact', p, 8, 30);
    const mad = unit(w, 'qtnk', p, 13.5, 31.5);
    w.issue({ c: 'deploy', player: 0, units: [mad.id] });
    run(w, 0.5);
    assert.ok(mad.madStage > 0, 'the M.A.D. Tank is deployed');
    p.queues.structure.ready = 'powr';
    w.issue({ c: 'place', player: 0, type: 'powr', cx: 13, cy: 31 });
    run(w, 1);
    const inside = mad.x >= 13 && mad.x < 15 && mad.y >= 31 && mad.y < 33;
    assert.ok(w.buildings.some((b) => b.bt.id === 'powr'), 'the power plant was placed');
    assert.ok(!inside, `the tank stays outside the footprint (${mad.x.toFixed(2)}, ${mad.y.toFixed(2)})`);
  });

  test('a passenger that boards and gets out in the same tick is listed once', () => {
    const { world: w } = sandbox({ seed: 6 });
    const p = w.players[0];
    const apc = unit(w, 'apc', p, 20.5, 20.5), rifle = unit(w, 'e1', p, 21.3, 20.5);
    assert.ok(w.board(rifle, apc), 'boarded');
    w.unload(apc); // (the bunker's evacuation and the LST's beach landing take the same path)
    run(w, 0.5);
    assert.equal(w.units.filter((u) => u === rifle).length, 1, 'listed once');
    assert.equal(new Set(w.units.map((u) => u.id)).size, w.units.length, 'unique ids');
  });

  test('infantry that got into a transport or a bunker under fire is not shot inside it', () => {
    const { world: w } = sandbox({ seed: 7 });
    const [p0, p1] = w.players;
    const apc = unit(w, 'apc', p1, 24.5, 20.5), rifle = unit(w, 'e1', p1, 24.5, 21.3);
    const tanks = [unit(w, '2tnk', p0, 20.5, 20.5), unit(w, '2tnk', p0, 20.5, 22.5)];
    rifle.hp = rifle.maxHp; apc.hp = apc.maxHp * 10; // (the transport itself must not die in this test)
    w.issue({ c: 'attack', player: 0, units: tanks.map((t) => t.id), target: rifle.id, forced: true });
    run(w, 0.3);
    assert.ok(w.board(rifle, apc), 'the rifleman boards');
    run(w, 4);
    assert.ok(rifle.alive, `the passenger survives (hp ${rifle.hp})`);
    assert.ok(tanks.every((t) => t.order.type !== 'attack'), 'the tanks dropped the attack');
  });

  for (const swap of [false, true]) {
    test(`two tanks meeting at a one-lane corner pass each other (${swap ? 'the corridor tank is older' : 'the corridor tank is newer'})`, () => {
      const { world: w } = sandbox({ seed: 2 });
      const m = w.map;
      for (let y = 15; y <= 31; y++) for (let x = 8; x <= 30; x++) m.terrain[m.idx(x, y)] = T.Rock;
      const open = (x: number, y: number) => { m.terrain[m.idx(x, y)] = T.Clear; };
      for (let x = 9; x <= 20; x++) open(x, 20); // a lane west to east along y = 20,
      for (let y = 20; y <= 30; y++) open(20, y); // turning south along x = 20,
      open(21, 20); open(21, 19); // with room for one tank at the corner
      const p = w.players[0];
      const mkA = () => unit(w, '3tnk', p, 15.5, 20.5, 0), mkB = () => unit(w, '3tnk', p, 20.5, 25.5, -Math.PI / 2);
      let a: Unit, b: Unit;
      if (swap) { b = mkB(); a = mkA(); } else { a = mkA(); b = mkB(); }
      w.issue({ c: 'move', player: 0, units: [a.id], x: 20.5, y: 29.5 });
      w.issue({ c: 'move', player: 0, units: [b.id], x: 10.5, y: 20.5 });
      let t = 0;
      while (t++ < seconds(30) && !(a.y > 28.5 && b.x < 11.5)) { w.step(); w.events.length = 0; }
      assert.ok(a.y > 28.5 && b.x < 11.5, `both through within 30 s (a at ${a.x.toFixed(1)}, ${a.y.toFixed(1)}; b at ${b.x.toFixed(1)}, ${b.y.toFixed(1)})`);
    });
  }

  test('a tank its own base was built all round gets out and goes where it is sent', () => {
    const { world: w } = sandbox({ seed: 3 });
    const p = w.players[0];
    building(w, 'fact', p, 30, 30);
    const tank = unit(w, '2tnk', p, 20.5, 20.5);
    for (const [cx, cy] of [[19, 20], [21, 20], [20, 19], [20, 21]]) w.addBuilding('pbox', p, cx, cy, true); // (no way out, not even diagonally)
    w.issue({ c: 'move', player: 0, units: [tank.id], x: 8.5, y: 8.5 });
    run(w, 1);
    assert.ok(!(Math.floor(tank.x) === 20 && Math.floor(tank.y) === 20), `out of the enclosure (${tank.x.toFixed(1)}, ${tank.y.toFixed(1)})`);
    assert.ok(tank.path, 'it has a path');
    run(w, 25);
    assert.ok(Math.hypot(tank.x - 8.5, tank.y - 8.5) < 1.5, `arrived (${tank.x.toFixed(1)}, ${tank.y.toFixed(1)})`);
  });

  test('Big Guns builds the same rules whatever the previous match applied', () => {
    const first = withMutatorMods(undefined, ['big-guns'])!;
    applyModSet(first); // the previous match (its ranges are now 30% longer)
    const second = withMutatorMods(undefined, ['big-guns'])!;
    applyModSet(null);
    assert.equal(second.hash, first.hash, 'same mod set');
  });
});

describe('hostile peers (multiplayer input)', () => {
  test('garbage commands are dropped or rebuilt, never throw, and the world survives them', () => {
    const r = new FRng(99);
    const kinds = ['move', 'attack', 'attackGround', 'stop', 'scatter', 'deploy', 'harvest', 'enter', 'build', 'cancel', 'pause', 'place', 'sell', 'repair',
      'rally', 'primary', 'superweapon', 'stance', 'mine', 'repairBridge', 'chronoJump', 'patrol', 'guard', 'formation', 'rallyUnit', 'queuePlan', 'repeat',
      'commanderPower', 'unlockPower', 'battleEvent', 'upgrade', 'research', 'evacuate', 'bogus', '__proto__'];
    const junk = (): unknown => {
      switch (r.int(0, 11)) {
        case 0: return r.int(-5, 400);
        case 1: return (r.next() - 0.5) * 1e6;
        case 2: return r.pick([NaN, Infinity, -Infinity, -0, 1e308, 2 ** 53]);
        case 3: return r.pick(['', 'e1', 'powr', 'nuke', 'x'.repeat(50), '__proto__', 'constructor', 'iron', 'ironcurtain', 'line', 'aggressive']);
        case 4: return null;
        case 5: return r.chance(0.5);
        case 6: return Array.from({ length: r.int(0, 6) }, () => r.int(-2, 300));
        case 7: return Array.from({ length: r.int(0, 4) }, () => [r.next() * 80, r.next() * 80]);
        case 8: return { type: r.pick(['powr', 'gun', 1]), cx: r.int(-3, 60), cy: r.int(-3, 60) };
        case 9: return Array.from({ length: r.int(0, 3) }, () => ({ type: 'powr', cx: r.int(0, 50), cy: r.int(0, 50) }));
        case 10: return undefined;
        default: return { nested: [1, 2, { deep: 'x' }] };
      }
    };
    const fields = ['units', 'x', 'y', 'target', 'type', 'count', 'cx', 'cy', 'cx2', 'cy2', 'building', 'kind', 'unit', 'stance', 'points', 'queue', 'attackMove',
      'forced', 'all', 'shape', 'items', 'mode', 'on', 'power', 'event', 'act', 'upgrade', 'tech', 'cancel', 'bridge', 'player'];
    const w = sandbox({ seed: 9, credits: 50000 }).world;
    const [p0, p1] = w.players;
    building(w, 'fact', p0, 6, 36); building(w, 'weap', p0, 10, 36); building(w, 'fact', p1, 36, 6);
    for (let k = 0; k < 12; k++) { unit(w, k % 2 ? 'e1' : '2tnk', p0, 14.5 + k, 30.5); unit(w, '3tnk', p1, 30.5 + (k % 4), 12.5 + Math.floor(k / 4)); }
    let kept = 0;
    for (let n = 0; n < 4000; n++) {
      const raw: Record<string, unknown> = { c: r.pick(kinds) };
      for (const f of r.sub(fields, 8)) raw[f] = junk();
      let cmd: ReturnType<typeof sanitizeCommand> = null;
      assert.doesNotThrow(() => { cmd = sanitizeCommand(JSON.parse(JSON.stringify(raw) ?? 'null'), r.int(0, 1)); }, 'sanitiser never throws');
      if (cmd) { kept++; w.issue(cmd); }
      if (n % 4 === 0) { w.step(); w.events.length = 0; }
    }
    assert.ok(kept > 10, `some commands kept (${kept})`);
    for (const u of w.units) assert.ok(Number.isFinite(u.x) && Number.isFinite(u.y) && Number.isFinite(u.hp), `unit ${u.ut.id} finite`);
    for (const p of w.players) assert.ok(Number.isFinite(p.cash) && p.cash >= 0, `${p.name} credits finite and not negative (${p.cash})`);
  });
});

describe('command fuzzer smoke', () => {
  for (const seed of [2, 5]) {
    test(`fuzz case ${seed}: no exception, invariants hold, save / load and replay match`, () => {
      const res = runCase(makeCase(seed, 1.5, 48));
      assert.deepEqual([...res.issues.values()], [], `fuzz issues (${res.desc})`);
      assert.ok(res.cmds > 300, `commands issued (${res.cmds})`);
    });
  }
});

