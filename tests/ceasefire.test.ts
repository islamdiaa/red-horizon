// Skirmish build-up time (src/sim/ceasefire.ts): while the ceasefire holds the AI never strikes first but keeps
// building and always defends; when a timed ceasefire ends it attacks with what it built up. Saves, replays and
// matches without the option are unaffected.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BUILDINGS, type Faction } from '../src/data/rules';
import type { GameSetup } from '../src/game';
import { headlessGame } from '../src/modes/headless';
import { CommandFeeder, CommandRecorder, hookStep } from '../src/replay/core';
import { worldHash } from '../src/replay/hash';
import { BUILDUP, type AIController, type AIDifficulty } from '../src/sim/ai';
import { CEASEFIRE_UNLIMITED, ceasefireActive, ceasefireForSetup, ceasefireTicks, inHomeArea } from '../src/sim/ceasefire';
import { generateMap } from '../src/sim/mapgen';
import { deserializeWorld, serializeWorld } from '../src/sim/save';
import type { Command } from '../src/sim/types';
import { stateHash, seconds, TICK_HZ, World, type Player } from './helpers';

const MIN = 60 * TICK_HZ;

/**
 * Human (Allies) vs AI opponents on a generated 96 map, like a skirmish. The human only deploys its MCV and sets
 * its start squad to passive (it never fires); `fortify` adds a ring of defences that do fire.
 */
function match(opts: { seed: number; ai: AIDifficulty[]; ceasefire?: number; fortify?: boolean; size?: number }) {
  const n = 1 + opts.ai.length;
  const map = generateMap({ size: opts.size ?? 96, players: n, seed: opts.seed, water: 0.5, trees: 0.5, ore: 0.6 });
  if (opts.seed & 2) map.startPositions.reverse();
  const factions: Faction[] = ['soviet', 'allies', 'soviet'];
  const world = new World({
    map, credits: 10000, startUnits: 'light', fog: true, seed: opts.seed, ceasefireUntil: ceasefireTicks(opts.ceasefire),
    players: [
      { name: 'Human', faction: 'allies', color: 0, team: 0, isHuman: true },
      ...opts.ai.map((d, i) => ({ name: `AI${i}`, faction: factions[i], color: 0, team: i + 1, isHuman: false, ai: d })),
    ],
  });
  const human = world.players[0];
  const mcv = world.units.find((u) => u.owner === human && u.ut.deploysInto)!;
  world.issue({ c: 'deploy', player: 0, units: [mcv.id] });
  world.issue({ c: 'stance', player: 0, units: world.units.filter((u) => u.owner === human && u.weapons.length).map((u) => u.id), stance: 'passive' });
  world.step();
  while (!human.has('fact') && world.tick < 200) { world.step(); world.events.length = 0; }
  if (opts.fortify) fortify(world, human);
  return { world, human, ais: world.ais as AIController[] };
}

/** Finished defences (and the power for them) around the human's Construction Yard. */
function fortify(world: World, p: Player) {
  const yard = world.buildings.find((b) => b.owner === p && b.bt.id === 'fact')!;
  const types = ['apwr', 'apwr', 'gun', 'gun', 'pbox', 'gun', 'pbox', 'gun', 'pbox', 'gun', 'pbox', 'gun'];
  for (const t of types) {
    const bt = BUILDINGS[t];
    let done = false;
    for (let r = 3; r < 10 && !done; r++) {
      for (let k = 0; k < 24 && !done; k++) {
        const a = (k / 24) * Math.PI * 2 + r;
        const cx = Math.round(yard.cx + 1 + Math.cos(a) * r - bt.size[0] / 2), cy = Math.round(yard.cy + 1 + Math.sin(a) * r - bt.size[1] / 2);
        if (!world.canPlace(p, t, cx, cy)) continue;
        world.addBuilding(t, p, cx, cy, true);
        done = true;
      }
    }
  }
}

/**
 * Steps the world and watches the human's side: damage taken (entity hit this tick) and losses (deaths that are
 * not sales / deployments). `ignore` = human entities whose hits don't count (e.g. a strike force sent in).
 */
function watcher(world: World, human: Player, ignore = new Set<number>()) {
  const ids = new Set<number>();
  const log: { tick: number; target: string; by: string }[] = [];
  return {
    log,
    get first(): number { return log.length ? log[0].tick : -1; },
    step() {
      ids.clear();
      for (const e of world.entities.values()) if (e.owner === human && !ignore.has(e.id)) ids.add(e.id);
      world.step();
      for (const ev of world.events) {
        if (ev.e === 'death' && ids.has(ev.id) && ev.how !== 'sold') log.push({ tick: world.tick, target: `#${ev.id}`, by: ev.how });
      }
      world.events.length = 0;
      for (const e of [...world.units, ...world.buildings]) {
        if (e.owner !== human || ignore.has(e.id) || e.lastDamagedTick !== world.tick) continue;
        const a = world.entities.get(e.lastAttacker);
        log.push({ tick: world.tick, target: `${e.type.id}#${e.id}`, by: a ? `${a.owner.name}:${a.type.id}#${a.id}` : 'gone' });
      }
    },
    run(ticks: number) { for (let t = 0; t < ticks; t++) this.step(); },
  };
}

/** A strike force of human tanks at the edge of an AI base, attack-moving into it. */
function strike(world: World, human: Player, ai: AIController, n = 6): Set<number> {
  const [bx, by] = ai.baseCenter();
  const s = world.map.startPositions[0];
  const dx = s.x - bx, dy = s.y - by, l = Math.hypot(dx, dy) || 1;
  const ids = new Set<number>();
  for (let k = 0; k < n; k++) {
    const [x, y] = world.findFreeSpot(bx + (dx / l) * 15 + (k % 3) * 1.2, by + (dy / l) * 15 + Math.floor(k / 3) * 1.2, 6);
    ids.add(world.addUnit('2tnk', human, x, y).id);
  }
  world.issue({ c: 'move', player: human.id, units: [...ids], x: bx, y: by, attackMove: true });
  return ids;
}

/** Damage the AI's units (not its structures) dealt to the given human entities so far: hits counted per tick. */
function unitHitsOn(world: World, ids: Set<number>, ai: AIController, hits: { n: number }) {
  for (const id of ids) {
    const e = world.entities.get(id);
    if (!e || e.lastDamagedTick !== world.tick) continue;
    const a = world.entities.get(e.lastAttacker);
    if (a && a.owner === ai.p && a.kind !== 'building') hits.n++;
  }
}

describe('build-up time (ceasefire)', () => {
  test('setup: skirmish only, minutes to ticks, unlimited', () => {
    const base = { ceasefire: 10 };
    assert.equal(ceasefireForSetup(base, false), 10 * MIN, '10 minutes');
    assert.equal(ceasefireForSetup({ ceasefire: -1 }, false), CEASEFIRE_UNLIMITED, 'unlimited');
    assert.equal(ceasefireForSetup({}, false), 0, 'off by default');
    for (const other of [{ koth: true }, { challenge: {} }, { mission: 'survival' }, { conquest: {} }, { demo: true }]) {
      assert.equal(ceasefireForSetup({ ...base, ...other }, false), 0, `not with ${JSON.stringify(other)}`);
    }
    assert.equal(ceasefireForSetup(base, true), 0, 'never in missions');
    const w = { ceasefireUntil: 100, tick: 99 };
    assert.ok(ceasefireActive(w), 'holds before its tick');
    assert.ok(!ceasefireActive({ ...w, tick: 100 }), 'over at its tick');
    assert.ok(ceasefireActive({ ceasefireUntil: CEASEFIRE_UNLIMITED, tick: 1e7 }), 'unlimited never ends');
    assert.ok(!ceasefireActive({ ceasefireUntil: 0, tick: 0 }), 'off');
  });

  test('10 minutes vs a passive human: no AI fire before the end, the built-up army attacks right after it', () => {
    const { world, human, ais } = match({ seed: 11, ai: ['normal', 'hard'], ceasefire: 10 });
    const end = world.ceasefireUntil;
    assert.equal(end, 10 * MIN, 'ceasefire end tick');
    const watch = watcher(world, human);
    const news: string[] = [];
    let scouted = 0;
    while (world.tick < end - 1) {
      watch.step();
      if (world.tick % (TICK_HZ * 5) === 0) for (const ai of ais) if (ai.scout) scouted++;
    }
    assert.deepEqual(watch.log.slice(0, 3), [], `no AI hit on the human before the end (${watch.log.length} hits)`);
    for (const ai of ais) assert.equal(ai.waves, 0, `${ai.p.name}: no attack wave during the ceasefire`);
    assert.ok(scouted > 0, 'the AIs still scout');
    const army = ais.map((ai) => ai.armyValue());
    // the end: announcements, then the first wave goes out with the bulk of the army
    world.events.length = 0;
    world.step();
    for (const ev of world.events) if (ev.e === 'announce' && ev.player === 0) news.push(ev.key);
    world.events.length = 0;
    assert.ok(news.includes('ceasefire_over'), `announced (${news})`);
    assert.ok(!ceasefireActive(world), 'over');
    let launched = -1;
    const waveValue = [0, 0];
    for (let t = 0; t < seconds(180) && watch.first < 0; t++) {
      watch.step();
      ais.forEach((ai, i) => { if (ai.waves && !waveValue[i]) waveValue[i] = ai.waveUnits().reduce((s, u) => s + u.ut.cost, 0); });
      if (launched < 0 && ais.every((ai) => ai.waves > 0)) launched = world.tick - end;
    }
    console.log(`    army at the end ${army.join(' / ')}, first waves ${waveValue.join(' / ')}, launched +${(launched / TICK_HZ).toFixed(1)} s, first hit +${((watch.first - end) / TICK_HZ).toFixed(1)} s`);
    assert.ok(launched >= 0 && launched < seconds(15), `both AIs launch at once (${launched} ticks)`);
    ais.forEach((ai, i) => assert.ok(waveValue[i] >= army[i] * BUILDUP[ai.difficulty].commit * 0.6, `${ai.p.name}: a big first wave (${waveValue[i]} of ${army[i]})`));
    assert.ok(watch.first > 0 && watch.first - end < seconds(150), `first hit ${((watch.first - end) / TICK_HZ).toFixed(0)} s after the end`);
  });

  test('the one-minute warning', () => {
    const { world } = match({ seed: 12, ai: ['easy'], ceasefire: 5, size: 64 });
    const keys: [number, string][] = [];
    while (world.tick < 5 * MIN + 5) {
      world.step();
      for (const ev of world.events) if (ev.e === 'announce' && ev.player === 0 && ev.key.startsWith('ceasefire')) keys.push([world.tick, ev.key]);
      world.events.length = 0;
    }
    assert.deepEqual(keys, [[4 * MIN, 'ceasefire_warning'], [5 * MIN, 'ceasefire_over']], 'warning a minute before, then the end');
  });

  test('the AI fields a far bigger army when the ceasefire ends than it has at that time without one', () => {
    // a passive human behind a ring of defences: without a ceasefire the AI spends its first waves on them
    const sum = { 0: 0, 10: 0 } as Record<number, number>;
    const rows: string[] = [];
    for (const seed of [11, 12, 13, 21]) {
      const v: Record<number, number> = {};
      for (const cf of [0, 10]) {
        const { world, ais } = match({ seed, ai: ['normal'], ceasefire: cf, fortify: true });
        while (world.tick < 10 * MIN) { world.step(); world.events.length = 0; }
        v[cf] = ais[0].armyValue();
        sum[cf] += v[cf];
        if (!cf) assert.ok(ais[0].waves > 0 && ais[0].p.stats.unitsLost > 8, `seed ${seed}: without a ceasefire it has been attacking (${ais[0].waves} waves, ${ais[0].p.stats.unitsLost} lost)`);
        else assert.ok(ais[0].p.stats.unitsLost <= 6, `seed ${seed}: only scouts lost during the ceasefire (${ais[0].p.stats.unitsLost})`);
      }
      rows.push(`${v[10]} vs ${v[0]}`);
      assert.ok(v[10] > v[0], `seed ${seed}: bigger with the ceasefire (${v[10]} vs ${v[0]})`);
      assert.ok(v[10] >= 10000, `seed ${seed}: a sizeable army after 10 minutes (${v[10]})`);
    }
    console.log(`    army value at 10:00 with / without the ceasefire: ${rows.join(', ')} (x${(sum[10] / sum[0]).toFixed(2)})`);
    assert.ok(sum[10] >= sum[0] * 1.35, `well above overall (${sum[10]} vs ${sum[0]})`);
  });

  test('unlimited: no attack in 40 minutes, the army stops at its cap, and the AI defends its base', () => {
    const { world, human, ais } = match({ seed: 12, ai: ['hard'], ceasefire: -1 });
    const ai = ais[0];
    assert.equal(world.ceasefireUntil, CEASEFIRE_UNLIMITED);
    const force = new Set<number>();
    const watch = watcher(world, human, force);
    watch.run(12 * MIN);
    // a strike on the AI base: it fights back with its army, and the ceasefire still holds afterwards
    for (const id of strike(world, human, ai)) force.add(id);
    const hits = { n: 0 };
    for (let t = 0; t < seconds(60); t++) { watch.step(); unitHitsOn(world, force, ai, hits); }
    const left = [...force].filter((id) => world.entities.get(id)?.alive).length;
    assert.ok(hits.n > 20, `the AI's units defend (${hits.n} hits on the strike force)`);
    assert.ok(left <= 2, `the strike force is beaten (${left} of 6 left)`);
    watch.run(40 * MIN - world.tick);
    console.log(`    unlimited: army ${ai.armyValue()} (cap ${BUILDUP.hard.cap}), bank $${Math.round(ai.p.credits)}, ${watch.log.length} hits on the human base in 40 min`);
    assert.deepEqual(watch.log.slice(0, 3), [], 'never a shot at the human base');
    assert.equal(ai.waves, 0, 'no wave in 40 minutes');
    assert.ok(ceasefireActive(world), 'still holding');
    assert.ok(ai.armyValue() >= BUILDUP.hard.cap * 0.8 && ai.armyValue() < BUILDUP.hard.cap + 4000, `army grew to about its cap (${ai.armyValue()})`);
  });

  test('timed: attacking the AI does not end the ceasefire early', () => {
    const { world, human, ais } = match({ seed: 11, ai: ['normal'], ceasefire: 10 });
    const ai = ais[0];
    const force = new Set<number>();
    const watch = watcher(world, human, force);
    watch.run(4 * MIN);
    for (const id of strike(world, human, ai, 4)) force.add(id);
    const hits = { n: 0 };
    for (let t = 0; t < seconds(45); t++) { watch.step(); unitHitsOn(world, force, ai, hits); }
    assert.ok(hits.n > 10, `the AI defends (${hits.n} hits)`);
    // the survivors pull back home; nobody chases them out of the base
    const s = world.map.startPositions[0];
    const back = [...force].filter((id) => world.entities.get(id)?.alive);
    if (back.length) world.issue({ c: 'move', player: 0, units: back, x: s.x, y: s.y });
    watch.run(10 * MIN - 1 - world.tick);
    assert.equal(world.ceasefireUntil, 10 * MIN, 'the timer is the timer');
    assert.ok(ceasefireActive(world), 'still holding just before the end');
    assert.equal(ai.waves, 0, 'no wave before the end');
    const outside = watch.log.filter((h) => !h.target.startsWith('2tnk'));
    assert.deepEqual(outside.slice(0, 3), [], 'no shot at the human base');
    // escaped tanks back home were not hunted down either
    for (const id of back) {
      const u = world.entities.get(id);
      if (u?.alive) assert.ok(!inHomeArea(world, ai.p, u.x, u.y), 'escaped tank is out of the AI base');
    }
    watch.run(seconds(60));
    assert.ok(ai.waves > 0, 'the wave goes out when the timer runs out');
  });

  test('off: as before (no option = 0), and the AI attacks on its usual schedule', () => {
    const a = match({ seed: 11, ai: ['normal'] });
    const b = match({ seed: 11, ai: ['normal'], ceasefire: 0 });
    assert.equal(a.world.ceasefireUntil, 0, 'off');
    const wa = watcher(a.world, a.human), wb = watcher(b.world, b.human);
    for (let t = 0; t < 10 * MIN && wa.first < 0; t++) { wa.step(); wb.step(); }
    assert.equal(worldHash(a.world), worldHash(b.world), 'identical worlds');
    assert.ok(wa.first > 0 && wa.first < 10 * MIN, `the AI strikes before 10:00 without a ceasefire (${(wa.first / TICK_HZ).toFixed(0)} s)`);
  });

  test('save / load mid-ceasefire continues identically; old saves load without one', () => {
    const A = match({ seed: 7, ai: ['hard'], ceasefire: 5, size: 64 }).world;
    while (A.tick < 3 * MIN) { A.step(); A.events.length = 0; }
    const json = JSON.parse(JSON.stringify(serializeWorld(A)));
    assert.equal(json.ceasefireUntil, 5 * MIN, 'saved');
    // restored into a world built without the option: the save brings it
    const B = match({ seed: 7, ai: ['hard'], size: 64 }).world;
    deserializeWorld(B, json);
    assert.equal(B.ceasefireUntil, 5 * MIN, 'restored');
    for (const until of [5 * MIN - 2, 5 * MIN + 1, 8 * MIN]) {
      while (A.tick < until) { A.step(); A.events.length = 0; B.step(); B.events.length = 0; }
      assert.equal(stateHash(B), stateHash(A), `in step at tick ${until}`);
    }
    assert.ok(A.ais[0].waves > 0, 'the ceasefire ended after the load and the AI attacked');
    const old = JSON.parse(JSON.stringify(json));
    delete old.ceasefireUntil;
    const C = match({ seed: 7, ai: ['hard'], ceasefire: 5, size: 64 }).world;
    deserializeWorld(C, old);
    assert.equal(C.ceasefireUntil, 0, 'a save from before the option has no ceasefire');
  });

  test('a recorded match with a ceasefire replays in sync from its setup', () => {
    const setup: GameSetup = {
      faction: 'allies', color: 0x3d7be0, opponents: [{ faction: 'soviet', difficulty: 'hard' }], mapSize: 64, water: 0.5, trees: 0.5, ore: 0.6,
      credits: 10000, startUnits: 'light', fog: true, timeOfDay: 'day', quality: 'low', seed: 4711, ceasefire: 5,
    };
    const ticks = 7 * MIN;
    const live = headlessGame(setup).world;
    assert.equal(live.ceasefireUntil, 5 * MIN, 'the setup sets the ceasefire');
    const rec = new CommandRecorder(live);
    hookStep(live, null, () => rec.afterStep());
    const issue = (c: Command) => { rec.record(c); live.issue(c); };
    const me = live.players[0];
    for (let t = 0; t < ticks; t++) {
      if (t === 1) issue({ c: 'deploy', player: 0, units: live.units.filter((u) => u.owner === me && u.ut.deploysInto).map((u) => u.id) });
      // a raid during the ceasefire (the AI defends, the ceasefire holds), then everybody back home
      if (t === 2 * MIN) issue({ c: 'move', player: 0, units: live.units.filter((u) => u.owner === me && u.weapons.length).map((u) => u.id), x: live.map.startPositions[1].x, y: live.map.startPositions[1].y, attackMove: true });
      if (t === 3 * MIN) issue({ c: 'move', player: 0, units: live.units.filter((u) => u.owner === me && u.weapons.length).map((u) => u.id), x: live.map.startPositions[0].x, y: live.map.startPositions[0].y });
      live.step();
      live.events.length = 0;
    }
    // the replay file's setup (JSON) rebuilds the same world
    const { quality: _q, ...replaySetup } = JSON.parse(JSON.stringify(setup)) as GameSetup;
    assert.equal(replaySetup.ceasefire, 5, 'the replay setup carries the ceasefire');
    const play = headlessGame({ ...replaySetup, quality: 'low' }).world;
    const feeder = new CommandFeeder(play, rec.cmds, rec.hashes);
    for (let t = 0; t < ticks; t++) { feeder.beforeStep(); play.step(); feeder.afterStep(); play.events.length = 0; }
    assert.ok(feeder.checked >= ticks / 200 - 1, `hashes compared (${feeder.checked})`);
    assert.equal(feeder.desyncTick, -1, `in sync (desync at ${feeder.desyncTick})`);
    assert.equal(worldHash(play), worldHash(live), 'identical final state');
    // a replay recorded before the option existed (no field) replays without a ceasefire
    const { ceasefire: _c, ...oldSetup } = replaySetup;
    assert.equal(headlessGame({ ...oldSetup, quality: 'low' }).world.ceasefireUntil, 0, 'old replays: no ceasefire');
  });
});
