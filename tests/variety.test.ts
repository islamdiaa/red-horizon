/**
 * [VARIETY] Mutators, battlefield events, neutral tech structures, dynamic difficulty and Quick Battle:
 * every mutator's effect, deterministic event scheduling, the convoy and derrick reward paths, save / load in the
 * middle of an event, replay-style sync, and Classic rules staying exactly classic.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BUILDINGS, UNITS, WEAPONS } from '../src/data/rules';
import { applyModSet } from '../src/mods/engine';
import { GameMap } from '../src/sim/map';
import { generateMap, mapSymmetry, neutralSites } from '../src/sim/mapgen';
import { World, type PlayerSetup } from '../src/sim/world';
import { serializeWorld, deserializeWorld } from '../src/sim/save';
import { worldHash } from '../src/replay/hash';
import { headlessGame, run as runGame } from '../src/modes/headless';
import type { GameSetup } from '../src/game';
import {
  MUTATORS, MUTATOR_BY_ID, MUTATOR_EFFECTS, mutateSetup, mutatorMod, normaliseMutators, surpriseMutators, toggleMutator, varietyOptions, withMutatorMods,
} from '../src/modes/mutators';
import { EVENT_KINDS, convoyRoute, triggerEvent, type VarietyState } from '../src/sim/events';
import { DERRICK_INCOME } from '../src/sim/neutral';
import { quickSkill, rollQuickBattle } from '../src/modes/quickbattle';
import { Rng } from '../src/core/rng';
import { TICK_HZ, run, runUntil, seconds, unit, building, ore } from './helpers';

const base: GameSetup = {
  faction: 'allies', color: 0x3d7be0, opponents: [{ faction: 'soviet', difficulty: 'normal' }], mapSize: 64, water: 0.3, trees: 0.4, ore: 0.7,
  credits: 10000, startUnits: 'light', fog: true, timeOfDay: 'day', quality: 'low', seed: 4242,
};

/** A flat 64x64 world under Commander rules (neutral structures on, events as asked). */
function flatWorld(o: { events?: boolean; mutators?: string[]; dyn?: boolean; ai?: boolean[]; seed?: number } = {}): World {
  const w = 64, h = 64;
  const map = new GameMap(w, h);
  map.startPositions = [{ x: 8.5, y: h - 8.5 }, { x: w - 8.5, y: 8.5 }];
  // two contested ore fields, point-symmetric like the map
  ore(map, 20, 20, 24, 24, 5);
  ore(map, 39, 39, 43, 43, 5);
  const players: PlayerSetup[] = ['allies', 'soviet'].map((f, i) => ({ name: `P${i}`, faction: f as 'allies' | 'soviet', color: 0xffffff, team: i, isHuman: !o.ai?.[i], ai: o.ai?.[i] ? 'normal' : undefined }));
  const world = new World({ map, players, credits: 10000, startUnits: 'none', fog: false, seed: o.seed ?? 77, rules: 'commander', events: o.events ?? false, mutators: o.mutators, dynamicDifficulty: o.dyn });
  world.cratesEnabled = false;
  // a construction yard each, so nobody is eliminated by an empty field
  world.players.forEach((p, i) => building(world, 'fact', p, Math.round(map.startPositions[i].x - 1.5), Math.round(map.startPositions[i].y - 1.5)));
  return world;
}

function v(w: World): VarietyState {
  assert.ok(w.variety, 'variety state exists');
  return w.variety!;
}

describe('variety: mutator catalogue', () => {
  it('offers the 16 daily modifiers plus at least 6 new ones, with unique ids', () => {
    assert.equal(MUTATORS.filter((m) => m.daily).length, 16, '16 daily modifiers');
    assert.ok(MUTATORS.filter((m) => !m.daily).length >= 6, 'six or more skirmish additions');
    assert.equal(new Set(MUTATORS.map((m) => m.id)).size, MUTATORS.length, 'ids are unique');
  });

  it('every mutator does something (setup, rules or world)', () => {
    for (const m of MUTATORS) {
      const setup = mutateSetup({ ...base, mutators: [m.id] });
      const changesSetup = setup.credits !== base.credits || setup.fog !== base.fog || setup.weather !== base.weather || setup.timeOfDay !== base.timeOfDay;
      assert.ok(changesSetup || mutatorMod([m.id]) || MUTATOR_EFFECTS[m.id], `${m.id} has an effect`);
    }
  });

  it('normalises lists: unknown ids dropped, exclusive sets keep the last pick, catalogue order', () => {
    assert.deepEqual(normaliseMutators(['nope', 'bounty', 'bounty']), ['bounty']);
    assert.deepEqual(normaliseMutators(['double-ore', 'golden-ore']), ['golden-ore'], 'two ore values: the last wins');
    assert.deepEqual(toggleMutator(['night-ops'], 'storm-front'), ['storm-front'], 'one weather at a time');
    assert.deepEqual(toggleMutator(['bounty', 'mega-crates'], 'bounty'), ['mega-crates'], 'toggling off');
  });

  it('"Surprise me" is deterministic, 2-3 compatible picks, eligible for the climate and side', () => {
    for (let s = 1; s < 60; s++) {
      const ctx = { climate: (['temperate', 'winter', 'desert'] as const)[s % 3], faction: s % 2 ? 'allies' as const : 'soviet' as const };
      const a = surpriseMutators(s, ctx), b = surpriseMutators(s, ctx);
      assert.deepEqual(a, b, 'same seed, same picks');
      assert.ok(a.length >= 2 && a.length <= 3, `2-3 picks (${a.join(',')})`);
      assert.deepEqual(normaliseMutators(a), a, 'compatible (nothing dropped by normalising)');
      assert.equal(new Set(a.map((id) => MUTATOR_BY_ID[id].group)).size, a.length, 'one per group');
      for (const id of a) assert.ok(!MUTATOR_BY_ID[id].when || MUTATOR_BY_ID[id].when!(ctx), `${id} eligible`);
    }
  });

  it('setup layer: Lean Times, Clear Skies and the weathers; idempotent; missions untouched', () => {
    const s = mutateSetup({ ...base, mutators: ['lean-times', 'clear-skies', 'night-ops'] });
    assert.equal(s.credits, 2500, 'Lean Times credits');
    assert.equal(s.fog, false, 'Clear Skies');
    assert.equal(s.timeOfDay, 'night', 'Night Ops');
    assert.deepEqual(mutateSetup(s), s, 'idempotent (a saved setup re-applies to itself)');
    assert.equal(mutateSetup({ ...base, mutators: ['storm-front'] }).weather, 'storm');
    assert.equal(mutateSetup({ ...base, mutators: ['blizzard'] }).weather, 'snow');
    assert.equal(mutateSetup({ ...base, mutators: ['sandstorm'] }).weather, 'dust');
    const m = { ...base, mission: 'allied-1', mutators: ['lean-times'] };
    assert.equal(mutateSetup(m), m, 'missions are never mutated');
  });

  it('rules layer: each rule mutator changes the tables, and the base rules come back', () => {
    const before = { e1: UNITS.e1.strength, t2: UNITS['2tnk'].cost, gun: WEAPONS['90mm'].range, sight: UNITS.e1.sight, fact: BUILDINGS.fact.strength, mam: [...UNITS['4tnk'].owner] };
    try {
      applyModSet(withMutatorMods(undefined, ['glass-cannons', 'tank-rush', 'big-guns', 'fog-plus', 'glass-base', 'heavy-metal']));
      assert.equal(UNITS.e1.strength, Math.round(before.e1 * 0.6), 'Glass Cannons: 60% health');
      assert.equal(UNITS['2tnk'].cost, Math.round(before.t2 * 0.6), 'Tank Rush: 40% cheaper');
      assert.ok(Math.abs(WEAPONS['90mm'].range - before.gun * 1.3) < 1e-9, 'Big Guns: +30% range');
      assert.ok(UNITS.e1.sight < before.sight, 'Fog of War+: shorter sight');
      assert.equal(BUILDINGS.fact.strength, Math.round(before.fact * 0.5), 'Glass Base: half health');
      assert.deepEqual([...UNITS['4tnk'].owner].sort(), ['allies', 'soviet'], 'Heavy Metal: Mammoths for both sides');
      assert.deepEqual(UNITS['4tnk'].prereq, ['weap'], 'Heavy Metal: straight from the War Factory');
      assert.ok(WEAPONS.Nuke.range === 99, 'the nuke is not stretched');
    } finally {
      applyModSet(undefined);
    }
    assert.equal(UNITS.e1.strength, before.e1, 'restored');
    assert.equal(UNITS['2tnk'].cost, before.t2, 'restored');
    assert.equal(WEAPONS['90mm'].range, before.gun, 'restored');
    assert.deepEqual(UNITS['4tnk'].owner, before.mam, 'restored');
  });
});

describe('variety: mutators in the world', () => {
  it('every mutator runs in a real skirmish (setup, rules and world layers together)', () => {
    for (const m of MUTATORS) {
      const climate = m.id === 'blizzard' ? 'winter' : m.id === 'sandstorm' ? 'desert' : 'temperate';
      const g = headlessGame({ ...base, climate, faction: m.id === 'tesla-only' ? 'soviet' : 'allies', rules: 'commander', events: false, mutators: [m.id] });
      assert.deepEqual(g.world.variety?.mutators, [m.id], `${m.id} is active`);
      runGame(g.world, seconds(45));
      assert.ok(g.world.tick >= seconds(45) || g.world.gameOver, `${m.id} runs`);
      applyModSet(undefined);
    }
  });

  it('economy multipliers and bans apply per player (Fanatics only to the AI)', () => {
    const plain = headlessGame({ ...base });
    const g = headlessGame({ ...base, rules: 'commander', events: false, mutators: ['golden-ore', 'lightning-war', 'fanatics', 'no-radar'] });
    const [h0, a0] = plain.world.players, [h1, a1] = g.world.players;
    assert.ok(Math.abs(h1.incomeBias / h0.incomeBias - 3) < 1e-9, 'Golden Ore: x3 income (human)');
    assert.ok(Math.abs(h1.buildSpeed / h0.buildSpeed - 2) < 1e-9, 'Lightning War: x2 build (human)');
    assert.ok(Math.abs(a1.incomeBias / a0.incomeBias - 3 * 1.2) < 1e-9, 'AI: Golden Ore x Fanatics');
    assert.ok(Math.abs(a1.buildSpeed / a0.buildSpeed - 2 * 1.35) < 1e-9, 'AI: Lightning War x Fanatics');
    assert.ok(h1.allowedTypes && !h1.allowedTypes.has('dome') && h1.allowedTypes.has('powr'), 'Radar Blackout bans the dome only');
    assert.ok(!a1.allowedTypes!.has('dome'), 'for everybody');
    applyModSet(undefined);
  });

  it('Lightning War also charges superweapons twice as fast', () => {
    const w = flatWorld({ mutators: ['lightning-war'] });
    const p = w.players[1];
    building(w, 'fact', p, 40, 10);
    for (let k = 0; k < 4; k++) building(w, 'apwr', p, 30 + k * 3, 14);
    building(w, 'iron', p, 44, 14);
    run(w, seconds(10));
    assert.ok(p.superCharge.ironcurtain > 19 && p.superCharge.ironcurtain < 21, `charged ~20 s in 10 s (${p.superCharge.ironcurtain.toFixed(2)})`);
  });

  it('Veteran Corps, Credits Rain, Bounty Hunter and Mega Crates run in the tick', () => {
    const w = flatWorld({ mutators: ['veteran-start', 'credits-rain', 'bounty', 'mega-crates'] });
    const [p0, p1] = w.players;
    const tank = unit(w, '2tnk', p0, 20.5, 40.5);
    run(w, 5);
    assert.equal(tank.rank, 1, 'Veteran Corps: arrives as a Veteran');
    const cash0 = p0.cash;
    runUntil(w, () => w.tick % (30 * TICK_HZ) === 1, seconds(31));
    assert.ok(p0.cash >= cash0 + 400, 'Credits Rain: +$400 every 30 s');
    assert.ok(w.crates.length > 0, 'crates fall (rain / mega crates)');
    // bounty: p0 kills a p1 rifleman
    const victim = unit(w, 'e1', p1, 21.5, 40.5);
    const before = p0.cash;
    w.kill(victim, 'normal', tank);
    run(w, 12);
    assert.ok(p0.cash >= before + 100, `Bounty Hunter pays $100 per unit (+${p0.cash - before})`);
  });

  it('Mega Crates doubles money crates', () => {
    const w = flatWorld({ mutators: ['mega-crates'] });
    const p0 = w.players[0];
    w.crates.length = 0;
    w.cratesEnabled = true;
    // a crate under a unit; force the money reward by trying seeds until one pays money
    let paid = 0;
    for (let k = 0; k < 20 && !paid; k++) {
      const u = unit(w, 'jeep', p0, 30.5 + k, 30.5);
      w.crates.push({ id: 9_000_000 + k, x: u.x, y: u.y });
      const cash = p0.cash;
      const evs: { e: string; reward?: string; amount?: number }[] = [];
      for (let t = 0; t < 4; t++) { w.step(); evs.push(...(w.events as never[])); w.events.length = 0; }
      const money = evs.find((e) => e.e === 'crate' && e.reward === 'money');
      if (money) { paid = p0.cash - cash; assert.equal(paid, money.amount, 'the event shows the doubled amount'); }
    }
    assert.ok(paid >= 2000, `doubled money crate (${paid})`);
  });
});

describe('variety: neutral tech structures', () => {
  it('are placed symmetrically on generated maps (2 and 4 players) and nowhere near a base', () => {
    for (const players of [2, 4]) {
      for (const seed of [11, 222, 3333]) {
        const map = generateMap({ size: 96, players, seed, water: 0.4, trees: 0.5, ore: 0.6 });
        assert.ok(mapSymmetry(map, players), `symmetry detected (${players}p, ${seed})`);
        const sites = neutralSites(map, players, seed);
        assert.ok(sites.some((s) => s.type === 'oild'), `derricks placed (${players}p, ${seed})`);
        const derricks = sites.filter((s) => s.type === 'oild');
        assert.equal(derricks.length % players === 0 || players === 4, true, 'one derrick per side');
        // every base has the same distance to its nearest derrick
        const near = map.startPositions.map((s) => Math.min(...derricks.map((d) => Math.hypot(d.cx + 1 - s.x, d.cy + 1 - s.y))));
        assert.ok(Math.max(...near) - Math.min(...near) < 0.01, `fair derricks (${near.map((x) => x.toFixed(1)).join(' / ')})`);
        for (const s of sites) for (const st of map.startPositions) assert.ok(Math.hypot(s.cx + 1 - st.x, s.cy + 1 - st.y) >= 13, 'away from the bases');
      }
    }
  });

  it('a derrick is captured by any engineer that reaches it, pays its owner, and the engineer goes in', () => {
    const w = flatWorld();
    const p0 = w.players[0];
    const der = w.buildings.find((b) => b.bt.id === 'oild')!;
    assert.ok(der && der.owner.id === -1, 'a neutral derrick stands');
    const eng = unit(w, 'e6', p0, der.cx - 0.5, der.cy + 0.5);
    run(w, 10);
    assert.equal(der.owner, p0, 'captured');
    assert.ok(!eng.alive, 'the engineer is used up');
    const cash = p0.cash;
    run(w, seconds(8.1));
    assert.ok(p0.cash >= cash + DERRICK_INCOME * 2, `income (+${p0.cash - cash})`);
    assert.ok(v(w).news.some((n) => n.kind === 'site'), 'announced');
  });

  it('an enemy engineer seizes it back; a destroyed one is rebuilt neutral; tech never keeps a player alive', () => {
    const w = flatWorld();
    const [p0, p1] = w.players;
    const der = w.buildings.find((b) => b.bt.id === 'oild')!;
    unit(w, 'e6', p0, der.cx - 0.5, der.cy + 0.5);
    run(w, 10);
    assert.equal(der.owner, p0);
    unit(w, 'e6', p1, der.cx + 2.5, der.cy + 0.5);
    run(w, 10);
    assert.equal(der.owner, p1, 'seized by the enemy engineer');
    w.kill(der, 'normal');
    run(w, seconds(92));
    const again = w.buildings.find((b) => b.alive && b.bt.id === 'oild' && b.cx === der.cx && b.cy === der.cy);
    assert.ok(again && again.owner.id === -1, 'rebuilt as neutral');
    // p1 has nothing but tech structures: defeated
    for (const b of w.buildings) if (b.owner === p1 && b.bt.id === 'fact') w.kill(b, 'normal');
    const rado = w.buildings.find((b) => b.bt.tech === 'radar' || b.bt.tech === 'comms')!;
    unit(w, 'e6', p1, rado.cx - 0.5, rado.cy + 0.5);
    run(w, 10);
    assert.equal(rado.owner, p1);
    run(w, seconds(2));
    assert.ok(p1.defeated, 'a commander holding only tech structures is defeated');
    run(w, seconds(2));
    assert.equal(rado.owner.id, -1, "the defeated commander's tech structure reverts to neutral");
  });

  it('nobody targets neutral structures on their own, and they are not enemies', () => {
    const w = flatWorld();
    const p0 = w.players[0];
    const der = w.buildings.find((b) => b.bt.id === 'oild')!;
    assert.ok(!p0.isEnemy(der.owner) && !der.owner.isEnemy(p0), 'neutral is nobody\'s enemy');
    unit(w, '2tnk', p0, der.cx - 1.5, der.cy + 0.5);
    run(w, seconds(5));
    assert.equal(der.hp, der.maxHp, 'a passing tank leaves it alone');
  });

  it('AI commanders send engineers to take tech structures', () => {
    const w = flatWorld({ ai: [false, true] });
    const p1 = w.players[1];
    // give the AI a working base so it can train engineers
    building(w, 'fact', p1, 50, 8);
    for (let k = 0; k < 3; k++) building(w, 'apwr', p1, 42 + k * 3, 4);
    building(w, 'barr', p1, 54, 12);
    building(w, 'proc', p1, 46, 12);
    p1.cash = 20000;
    const n = runUntil(w, () => w.buildings.some((b) => b.alive && b.bt.tech && b.owner === p1), seconds(240));
    assert.ok(n < seconds(240), 'the AI captured a tech structure');
  });
});

describe('variety: battlefield events', () => {
  it('scheduling is deterministic and independent of the battle', () => {
    const a = flatWorld({ events: true, seed: 5 }), b = flatWorld({ events: true, seed: 5 });
    assert.equal(v(a).next, v(b).next, 'same first event tick');
    assert.ok(v(a).next >= 180 * TICK_HZ && v(a).next <= 240 * TICK_HZ, 'first event after 3-4 minutes');
    // b fights, a does not: the schedule is the same
    unit(b, '2tnk', b.players[0], 30.5, 30.5);
    unit(b, '3tnk', b.players[1], 33.5, 30.5);
    const kinds = (w: World) => v(w).news.filter((n) => n.phase === 'warn' || n.phase === 'offer').map((n) => `${n.tick}:${n.title}`);
    run(a, seconds(16 * 60));
    run(b, seconds(16 * 60));
    assert.ok(v(a).count >= 3, `several events in 16 minutes (${v(a).count})`);
    assert.deepEqual(kinds(a), kinds(b), 'same events at the same ticks');
    const ticks = kinds(a).map((s) => +s.split(':')[0]);
    for (let k = 1; k < ticks.length; k++) assert.ok(ticks[k] - ticks[k - 1] >= 175 * TICK_HZ, 'every 3-6 minutes');
    // a different seed gives a different schedule
    const c = flatWorld({ events: true, seed: 6 });
    assert.notEqual(v(c).next + v(c).rng, v(a).next + v(a).rng, 'seeded');
  });

  it('every event kind can be planned and runs to its end', () => {
    for (const kind of EVENT_KINDS) {
      const w = flatWorld({ events: true });
      unit(w, 'e1', w.players[0], 12.5, 50.5);
      unit(w, 'e1', w.players[1], 50.5, 12.5);
      const ev = triggerEvent(w, kind);
      assert.ok(ev, `${kind} planned`);
      run(w, seconds(330));
      assert.ok(!v(w).active.some((e) => e.id === ev!.id), `${kind} is over after 5.5 minutes`);
    }
  });

  it('convoy route crosses the map on the line fair to both bases', () => {
    const w = flatWorld({ events: true });
    const r = convoyRoute(w, new Rng(3))!;
    assert.ok(r && r.length === 3, 'route found');
    const [s0, s1] = w.map.startPositions;
    for (const [x, y] of [r[0], r[2]]) {
      const d0 = Math.hypot(x - s0.x, y - s0.y), d1 = Math.hypot(x - s1.x, y - s1.y);
      assert.ok(Math.abs(d0 - d1) < 3, `fair ends (${d0.toFixed(1)} vs ${d1.toFixed(1)})`);
    }
  });

  it('convoy: destroying a truck pays its cargo to whoever destroyed it', () => {
    const w = flatWorld({ events: true });
    const [p0, p1] = w.players;
    triggerEvent(w, 'convoy');
    runUntil(w, () => w.units.some((u) => u.alive && u.ut.id === 'truk'), seconds(30));
    const truck = w.units.find((u) => u.alive && u.ut.id === 'truk')!;
    assert.equal(truck.owner.id, -1, 'neutral truck');
    // waiting on its road, a little ahead
    const ev = v(w).active.find((e) => e.kind === 'convoy')!;
    const [mx, my] = ev.route![1];
    const d = Math.hypot(mx - truck.x, my - truck.y) || 1;
    const ax = truck.x + ((mx - truck.x) / d) * 5, ay = truck.y + ((my - truck.y) / d) * 5;
    const tanks = [0, 1, 2].map((k) => unit(w, '3tnk', p1, ax + (k - 1) * 0.9, ay + 1.2));
    w.issue({ c: 'attack', player: p1.id, units: tanks.map((t) => t.id), target: truck.id, forced: true });
    const cash = p1.cash, cash0 = p0.cash;
    runUntil(w, () => !truck.alive, seconds(40));
    run(w, 5);
    assert.ok(!truck.alive, 'the truck is destroyed');
    assert.ok(p1.cash >= cash + 700, `cargo seized (+${p1.cash - cash})`);
    assert.equal(p0.cash, cash0, 'nothing for the bystander');
  });

  it('convoy: escorting it through pays the escort for every truck delivered', () => {
    const w = flatWorld({ events: true });
    const p0 = w.players[0];
    const ev = triggerEvent(w, 'convoy')!;
    run(w, ev.at - w.tick + 1);
    const [sx, sy] = ev.route![0];
    const escorts = [0, 1, 2, 3].map((k) => unit(w, '2tnk', p0, sx + 1.5 + k, sy + 2.5));
    runUntil(w, () => w.units.some((u) => u.alive && u.ut.id === 'truk'), seconds(5));
    const lead = w.units.find((u) => u.alive && u.ut.id === 'truk')!;
    w.issue({ c: 'guard', player: p0.id, units: escorts.map((u) => u.id), target: lead.id });
    const cash = p0.cash;
    runUntil(w, () => !v(w).active.some((e) => e.id === ev.id), seconds(300));
    assert.ok(ev.delivered! >= 1, `trucks delivered (${ev.delivered})`);
    assert.ok(p0.cash >= cash + 900 * ev.delivered!, `escort paid (+${p0.cash - cash} for ${ev.delivered})`);
    assert.ok(v(w).news.some((n) => n.phase === 'reward' && n.player === p0.id), 'reward announced');
  });

  it('downed pilot: the first infantry to reach him is rewarded and he joins', () => {
    const w = flatWorld({ events: true });
    const p1 = w.players[1];
    const ev = triggerEvent(w, 'pilot')!;
    run(w, ev.at - w.tick + 2);
    const pilot = w.entities.get(ev.pilot!)!;
    assert.ok(pilot.alive && pilot.owner.id === -1, 'neutral pilot on the ground');
    const inf = unit(w, 'e1', p1, pilot.x + 3, pilot.y);
    w.issue({ c: 'move', player: p1.id, units: [inf.id], x: pilot.x, y: pilot.y });
    const cash = p1.cash, n = w.units.filter((u) => u.owner === p1).length;
    runUntil(w, () => !pilot.alive, seconds(30));
    run(w, 2);
    assert.ok(!pilot.alive, 'rescued');
    assert.ok(p1.cash >= cash + 800, 'rewarded');
    assert.equal(w.units.filter((u) => u.alive && u.owner === p1).length, n + 1, 'the pilot joins');
  });

  it('mercenaries: the hire command buys the squad once, at the price', () => {
    const w = flatWorld({ events: true });
    const p0 = w.players[0];
    const ev = triggerEvent(w, 'mercs')!;
    const cash = p0.cash, units = w.units.length;
    w.issue({ c: 'battleEvent', player: p0.id, event: ev.id, act: 'hire' });
    w.issue({ c: 'battleEvent', player: p0.id, event: ev.id, act: 'hire' });
    run(w, 2);
    assert.equal(p0.cash, cash - ev.price!, 'paid once');
    assert.equal(w.units.length, units + ev.squad!.length, 'squad arrived');
    assert.ok(w.units.slice(-ev.squad!.length).every((u) => u.owner === p0), 'owned by the hirer');
  });

  it('storm front grounds aircraft; ore surge floods the contested field', () => {
    const w = flatWorld({ events: true });
    const p0 = w.players[0];
    building(w, 'hpad', p0, 10, 50);
    const heli = unit(w, 'heli', p0, 30.5, 30.5);
    heli.altitude = 1.5;
    w.issue({ c: 'move', player: p0.id, units: [heli.id], x: 40, y: 20 });
    const ev = triggerEvent(w, 'storm')!;
    run(w, ev.at - w.tick + 12);
    assert.equal(heli.order.type, 'deploy', 'sent back to its pad');
    w.issue({ c: 'move', player: p0.id, units: [heli.id], x: 40, y: 20 });
    run(w, 12);
    assert.equal(heli.order.type, 'deploy', 'stays grounded while the storm lasts');
    // ore surge on a skirmish map
    const g = headlessGame({ ...base, mapSize: 96, rules: 'commander', events: true });
    const before = g.world.map.oreFieldCells.length;
    const s = triggerEvent(g.world, 'surge')!;
    assert.ok(s, 'surge planned');
    runGame(g.world, s.at - g.world.tick + 2);
    assert.ok(g.world.map.oreFieldCells.length > before, 'the field spread');
    applyModSet(undefined);
  });
});

describe('variety: saves, replays and Classic rules', () => {
  it('save / load in the middle of a convoy continues identically', () => {
    const setup: GameSetup = { ...base, mapSize: 96, rules: 'commander', mutators: ['mega-crates', 'veteran-start'], dynamicDifficulty: true };
    const a = headlessGame(setup);
    runGame(a.world, seconds(40));
    triggerEvent(a.world, 'convoy');
    runGame(a.world, seconds(40));
    assert.ok(a.world.units.some((u) => u.alive && u.ut.id === 'truk'), 'trucks on the road');
    const save = JSON.parse(JSON.stringify(serializeWorld(a.world)));
    assert.ok(save.variety, 'the variety state is saved');
    const b = headlessGame({ ...setup, load: { version: 1, savedAt: 0, world: save } });
    assert.equal(worldHash(b.world), worldHash(a.world), 'identical right after loading');
    runGame(a.world, seconds(90));
    runGame(b.world, seconds(90));
    assert.equal(worldHash(b.world), worldHash(a.world), 'identical 90 s later');
    assert.deepEqual(b.world.variety!.news.map((n) => n.text), a.world.variety!.news.map((n) => n.text), 'same news');
    assert.deepEqual(b.world.players.map((p) => [p.incomeBias, p.buildSpeed]), a.world.players.map((p) => [p.incomeBias, p.buildSpeed]), 'economy multipliers survive the load');
    applyModSet(undefined);
  });

  it('replays stay in sync: the same setup and commands give the same world', () => {
    const setup: GameSetup = { ...base, rules: 'commander', mutators: ['golden-ore', 'big-guns'], dynamicDifficulty: true };
    const play = () => {
      const g = headlessGame(setup);
      const ev = triggerEvent(g.world, 'mercs')!;
      const hashes: string[] = [];
      for (let k = 0; k < 6; k++) {
        if (k === 1) g.world.issue({ c: 'battleEvent', player: 0, event: ev.id, act: 'hire' });
        runGame(g.world, seconds(30));
        hashes.push(worldHash(g.world));
      }
      applyModSet(undefined);
      return hashes;
    };
    assert.deepEqual(play(), play(), 'identical hashes every 30 s');
  });

  it('Classic rules without mutators: no variety state, nothing saved, identical worlds', () => {
    const plain = headlessGame({ ...base });
    const classic = headlessGame({ ...base, rules: 'classic', mutators: [], events: true, dynamicDifficulty: false });
    assert.equal(plain.world.variety, null, 'no state');
    assert.equal(classic.world.variety, null, 'Classic ignores the events flag');
    runGame(plain.world, seconds(120));
    runGame(classic.world, seconds(120));
    assert.equal(worldHash(classic.world), worldHash(plain.world), 'bit-identical');
    assert.ok(!('variety' in JSON.parse(JSON.stringify(serializeWorld(plain.world)))), 'nothing in the save');
    assert.ok(!plain.world.buildings.some((b) => b.bt.tech), 'no tech structures');
    assert.deepEqual(varietyOptions({ mission: 'allied-1', rules: 'commander', mutators: ['bounty'] }, true), {}, 'missions are always Classic');
  });

  it('an old save without variety loads into a Classic world', () => {
    const a = headlessGame({ ...base });
    runGame(a.world, seconds(30));
    const save = JSON.parse(JSON.stringify(serializeWorld(a.world)));
    const b = headlessGame({ ...base, load: { version: 1, savedAt: 0, world: save } });
    assert.equal(b.world.variety, null);
    assert.equal(worldHash(b.world), worldHash(a.world));
  });
});

describe('variety: dynamic difficulty and Quick Battle', () => {
  it('dynamic difficulty pushes a crushed AI harder within its band, deterministically', () => {
    const w = flatWorld({ dyn: true, ai: [false, true] });
    const [p0, p1] = w.players;
    building(w, 'fact', p1, 50, 8);
    const inc = p1.incomeBias;
    for (let k = 0; k < 20; k++) unit(w, '2tnk', p0, 8.5 + (k % 5), 50.5 + Math.floor(k / 5));
    run(w, seconds(4 * 60 + 5));
    const lv = v(w).dd.level;
    assert.ok(lv > 0 && lv <= 4, `level rose (${lv})`);
    assert.ok(p1.incomeBias > inc && p1.incomeBias <= inc * 1.25, 'AI income up, within the band');
    assert.equal(p0.incomeBias, 1, "the human's economy is untouched");
    assert.ok(v(w).news.some((n) => n.kind === 'dyn'), 'shown');
  });

  it('Quick Battle rolls a deterministic Commander skirmish with 1-2 mutators at the commander\'s level', () => {
    const o = { faction: 'soviet' as const, color: 0xd23a2c, quality: 'low' as const, skill: 'hard' as const };
    for (let s = 1; s < 40; s++) {
      const a = rollQuickBattle(s, o), b = rollQuickBattle(s, o);
      assert.deepEqual(a, b, 'deterministic');
      assert.equal(a.rules, 'commander');
      assert.equal(a.events, true);
      assert.ok(a.mutators!.length >= 1 && a.mutators!.length <= 2, `1-2 mutators (${a.mutators})`);
      assert.ok(a.mutators!.every((id) => MUTATOR_BY_ID[id].quick), 'Quick Battle friendly');
      assert.equal(a.opponents[0].difficulty, 'hard', 'at the skill level');
      assert.ok(a.quick && a.quick.map && a.quick.opponent, 'the roll is described');
    }
    assert.equal(quickSkill(null), 'easy', 'a newcomer starts on easy');
    assert.equal(quickSkill({ skirmishes: 10, gamesByDifficulty: { normal: 6, hard: 4 }, winsByDifficulty: { normal: 5, hard: 2 } }), 'hard', 'beats hard half the time');
    assert.equal(quickSkill({ skirmishes: 6, gamesByDifficulty: { hard: 5 }, winsByDifficulty: { hard: 4 } }), 'brutal', 'comfortable on hard: one up');
  });

  it('a Quick Battle setup builds and runs', () => {
    const s = rollQuickBattle(12345, { faction: 'allies', color: 0x3d7be0, quality: 'low', skill: 'normal' });
    const g = headlessGame(s);
    assert.ok(g.world.variety && g.world.variety.rules === 'commander', 'Commander rules');
    runGame(g.world, seconds(60));
    assert.ok(!g.world.gameOver, 'running');
    applyModSet(undefined);
  });
});
