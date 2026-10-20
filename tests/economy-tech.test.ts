// Commander economy and tech evolution (src/sim/economy.ts): tiers, structure upgrades, research, the new
// structures (outpost, purifier, logistics, bunker, gate), the AI, save / load, replays and Classic identity.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BAIL_COUNT, BUILDINGS, GOLD_VALUE, WEAPONS } from '../src/data/rules';
import { GameMap } from '../src/sim/map';
import { World } from '../src/sim/world';
import type { Faction } from '../src/data/rules';
import { buildSeconds } from '../src/sim/production';
import { priceOf } from '../src/sim/doctrine';
import { damageEntity } from '../src/sim/combat';
import { harvestCapacity, RESEARCH, RESEARCH_IDS, UPGRADES } from '../src/sim/economy-data';
import { researchCost, researchIssue, taskSeconds, upgradeCost, upgradeIssue } from '../src/sim/economy';
import { deserializeWorld, serializeWorld } from '../src/sim/save';
import { worldHash } from '../src/replay/hash';
import { CommandFeeder, CommandRecorder, hookStep } from '../src/replay/core';
import { generateMap } from '../src/sim/mapgen';
import type { Command } from '../src/sim/types';
import { factionTypes } from '../src/ui/tech';
import { sandbox, skirmish, building, unit, ore, run, runUntil, seconds, powerUp, TICK_HZ, type Player, type Building, type Unit } from './helpers';
import type { GameSetup } from '../src/game';
import { headlessGame } from '../src/modes/headless';
import { playbackSetup } from '../src/replay/launch';
import { REPLAY_VERSION, type ReplayData, type ReplaySetup } from '../src/replay/format';
import { branchSetup, makeBranch } from '../src/replay/branch';

// ---------------------------------------------------------------------------------------------- helpers

/** An empty flat Commander world (no events, no doctrines, no neutral structures). */
function cmdWorld(opts: { factions?: Faction[]; teams?: number[]; credits?: number; fog?: boolean; doctrines?: (string | null)[]; w?: number; h?: number } = {}) {
  const w = opts.w ?? 48, h = opts.h ?? 48;
  const map = new GameMap(w, h);
  map.startPositions = [{ x: 6.5, y: h - 6.5 }, { x: w - 6.5, y: 6.5 }, { x: 6.5, y: 6.5 }, { x: w - 6.5, y: h - 6.5 }];
  const factions = opts.factions ?? ['allies', 'soviet'];
  const world = new World({
    map, players: factions.map((f, i) => ({ name: `P${i}`, faction: f, color: 0xffffff, team: opts.teams?.[i] ?? i, isHuman: true })),
    credits: opts.credits ?? 30000, startUnits: 'none', fog: opts.fog ?? false, seed: 7, rules: 'commander', events: false,
    doctrines: opts.doctrines ?? factions.map(() => 'none'),
  });
  world.cratesEnabled = false;
  for (const b of [...world.buildings]) if (b.owner.id < 0) world.kill(b, 'sold'); // (neutral tech structures)
  run(world, 1);
  return { world, map, p0: world.players[0], p1: world.players[1] };
}

/** Yard, power, refinery, barracks, war factory and radar for a player at (x, y). */
function base(world: World, p: Player, x: number, y: number) {
  const fact = building(world, 'fact', p, x, y);
  powerUp(world, p, x, y + 4, 3);
  const proc = building(world, 'proc', p, x + 4, y);
  const tent = building(world, p.faction === 'allies' ? 'tent' : 'barr', p, x + 8, y);
  const weap = building(world, 'weap', p, x + 11, y);
  const dome = building(world, 'dome', p, x + 15, y);
  return { fact, proc, tent, weap, dome };
}

/** Run an upgrade to completion through the real command. */
function upgrade(world: World, p: Player, b: Building, id: string) {
  world.issue({ c: 'upgrade', player: p.id, building: b.id, upgrade: id });
  run(world, 1);
  assert.ok(b.task?.id === id, `${id} started (${upgradeIssue(world, p, b, id)})`);
  const t = runUntil(world, () => !b.task, seconds(200));
  assert.ok(t > 0, `${id} finished`);
}

/** Give research levels directly (the effect path is what is tested; the commands are tested separately). */
function grant(world: World, p: Player, id: string, level: number) {
  p.econ!.levels[id] = level;
  run(world, 6); // the compiled modifiers follow within 5 ticks
}

function tier(world: World, p: Player, t: number) {
  p.econ!.tier = t;
  world.checkNewOptions(p);
  run(world, 1);
}

// ---------------------------------------------------------------------------------------------- Classic

describe('economy: Classic rules are untouched', () => {
  test('no economy state, no Commander structures, no upgrade commands', () => {
    const s = sandbox();
    const { world, p0 } = s;
    assert.equal(world.econ, null, 'world.econ');
    assert.equal(p0.econ, undefined, 'player econ');
    building(world, 'fact', p0, 4, 4);
    powerUp(world, p0, 4, 8);
    building(world, 'proc', p0, 8, 4);
    building(world, 'tent', p0, 12, 4);
    const weap = building(world, 'weap', p0, 15, 4);
    building(world, 'dome', p0, 19, 4);
    for (const id of ['bnkr', 'mout', 'rlab', 'lgst', 'purf', 'gate']) assert.equal(p0.canBuild(id), false, `${id} not buildable`);
    assert.ok(p0.canBuild('atek'), 'Classic has no tiers: the Tech Center is open');
    assert.ok(!p0.buildOptions().some((id) => BUILDINGS[id]?.commander), 'no Commander structure in the build options');
    assert.ok(!factionTypes('allies', 'building').some((id) => BUILDINGS[id]?.commander), 'no Commander structure in the Classic sidebar list');
    world.issue({ c: 'upgrade', player: 0, building: weap.id, upgrade: 'weap_assembly' });
    run(world, 5);
    assert.equal(weap.task, undefined, 'upgrade command ignored');
    assert.equal(weap.upgrades, undefined, 'no modules');
    const json = JSON.stringify(serializeWorld(world));
    for (const k of ['"econ"', '"upgrades"', '"task"', '"garrison"', '"hpBoost"']) assert.ok(!json.includes(k), `Classic save has no ${k}`);
  });

  test('a Classic AI battle hashes exactly as before the Commander economy existed', () => {
    // golden hashes from the pre-economy build (git archive HEAD), same seed and setup; the fourth moved deliberately
    // with simulation version 2 (src/sim/version.ts): the Allied skirmish AI's build order changes from minute 3; all four
    // moved deliberately with version 3: the hard AI's build speed and income went from 1.15 to 1.05 (with the old 1.15
    // restored, the version-3 code reproduces the version-2 hashes exactly)
    const w = skirmish({ seed: 2024, size: 64, ai: ['hard', 'brutal'], credits: 6000 });
    const out: string[] = [];
    for (let t = 1; t <= seconds(240); t++) { w.step(); w.events.length = 0; if (t % 1200 === 0) out.push(worldHash(w)); }
    assert.deepEqual(out, ['c56939aae402b14d', '3fe8200cffe40eb9', 'fe758d838ef0e9f3', '12d1d8fea18c3edb'], 'Classic hashes unchanged');
  });

  test('econ: false keeps a Commander world without the economy', () => {
    const map = new GameMap(32, 32);
    map.startPositions = [{ x: 5, y: 5 }, { x: 26, y: 26 }];
    const w = new World({ map, players: [{ name: 'A', faction: 'allies', color: 0, team: 0, isHuman: true }, { name: 'B', faction: 'soviet', color: 0, team: 1, isHuman: true }],
      credits: 1000, startUnits: 'none', fog: false, seed: 1, rules: 'commander', events: false, econ: false });
    assert.ok(w.commander, 'commander rules on');
    assert.equal(w.econ, null, 'economy off');
  });
});

// ---------------------------------------------------------------------------------------------- tiers

describe('economy: tech tiers', () => {
  test('Tier 2 opens the Research Lab, Tech Center and friends; Tier 3 the superweapons', () => {
    const { world, p0 } = cmdWorld();
    const b = base(world, p0, 3, 3);
    assert.equal(p0.econ!.tier, 1);
    assert.ok(p0.canBuild('bnkr') && p0.canBuild('mout'), 'Tier 1: bunker and outpost');
    for (const id of ['atek', 'rlab', 'lgst', 'purf', 'gate', 'mslo', 'pdox']) assert.equal(p0.canBuild(id), false, `${id} locked at Tier 1`);
    assert.equal(upgradeIssue(world, p0, b.fact, 'cy_t3'), 'tier', 'Tier 3 needs Tier 2 first');
    const c0 = p0.credits;
    upgrade(world, p0, b.fact, 'cy_t2');
    assert.equal(p0.econ!.tier, 2);
    assert.ok(Math.abs(c0 - p0.credits - UPGRADES.cy_t2.cost) <= 2, `paid $1000 (${c0 - p0.credits})`);
    assert.deepEqual(b.fact.upgrades, ['cy_t2'], 'the yard shows the module');
    for (const id of ['atek', 'rlab', 'lgst', 'purf', 'gate']) assert.ok(p0.canBuild(id), `${id} open at Tier 2`);
    assert.equal(p0.canBuild('smlt'), false, 'the Soviet smelter stays Soviet');
    assert.equal(p0.canBuild('mslo'), false, 'superweapons need Tier 3');
    upgrade(world, p0, b.fact, 'cy_t3');
    assert.equal(p0.econ!.tier, 3);
    assert.deepEqual(b.fact.upgrades, ['cy_t2', 'cy_t3']);
    assert.ok(building(world, 'atek', p0, 3, 12) && p0.canBuild('mslo') && p0.canBuild('pdox'), 'superweapons open at Tier 3');
  });

  test('Tier 2 needs a refinery and barracks; a new yard shows the tier at once', () => {
    const { world, p0 } = cmdWorld();
    const fact = building(world, 'fact', p0, 3, 3);
    powerUp(world, p0, 3, 7);
    assert.equal(upgradeIssue(world, p0, fact, 'cy_t2'), 'prereq', 'no refinery / barracks yet');
    building(world, 'proc', p0, 7, 3);
    building(world, 'tent', p0, 11, 3);
    assert.equal(upgradeIssue(world, p0, fact, 'cy_t2'), null);
    tier(world, p0, 2);
    const yard2 = building(world, 'fact', p0, 20, 20);
    run(world, 12);
    assert.deepEqual(yard2.upgrades, ['cy_t2'], 'second yard dressed for Tier 2');
    assert.equal(upgradeIssue(world, p0, fact, 'cy_t2'), 'owned');
  });

  test('upgrades are paid while they build, stall without money and refund when cancelled or lost', () => {
    const { world, p0, p1 } = cmdWorld({ credits: 400 });
    const fact = building(world, 'fact', p0, 3, 3);
    powerUp(world, p0, 3, 7);
    building(world, 'proc', p0, 7, 3);
    building(world, 'tent', p0, 11, 3);
    p0.cash = 400; p0.ore = 0;
    world.issue({ c: 'upgrade', player: 0, building: fact.id, upgrade: 'cy_t2' });
    run(world, seconds(40));
    assert.ok(fact.task, 'still running');
    assert.ok(fact.task!.progress > 0.35 && fact.task!.progress < 0.41, `stalled at ~40% (${fact.task!.progress.toFixed(3)})`);
    assert.ok(p0.credits < 2, `spent everything (${p0.credits})`);
    const paid = fact.task!.paid;
    world.issue({ c: 'upgrade', player: 0, building: fact.id, upgrade: 'cy_t2', cancel: true });
    run(world, 1);
    assert.equal(fact.task, undefined, 'cancelled');
    assert.ok(Math.abs(p0.cash + p0.ore - 400) < 1, `refunded ${paid.toFixed(0)}`);
    // lost mid-upgrade: refunded to the payer; captured mid-upgrade: the old owner gets the money back
    p0.cash = 5000;
    world.issue({ c: 'upgrade', player: 0, building: fact.id, upgrade: 'cy_t2' });
    run(world, seconds(5));
    const before = p0.cash + p0.ore + fact.task!.paid;
    fact.owner = p1; // (as an engineer capture does)
    run(world, 2);
    assert.equal(fact.task, undefined, 'capture cancels the project');
    assert.ok(Math.abs(p0.cash + p0.ore - before) < 1, 'old owner refunded');
  });
});

// ---------------------------------------------------------------------------------------------- upgrades

describe('economy: structure upgrades', () => {
  test('Turbine: +50% power from the plant', () => {
    const { world, p0 } = cmdWorld();
    building(world, 'fact', p0, 3, 3);
    const pw = building(world, 'powr', p0, 7, 3);
    run(world, 10);
    assert.equal(p0.powerOut, 100);
    upgrade(world, p0, pw, 'powr_turbine');
    run(world, 10);
    assert.equal(p0.powerOut, 150, 'turbine output');
    assert.equal(upgradeIssue(world, p0, pw, 'powr_turbine'), 'owned');
  });

  test('Ore Processor and Purifier: more money per load, faster unloading; no purifier bonus on low power', () => {
    const load = (opts: { processor?: boolean; purifier?: boolean; lowPower?: boolean }) => {
      const { world, map, p0 } = cmdWorld({ credits: 0 });
      building(world, 'fact', p0, 2, 2);
      if (!opts.lowPower) powerUp(world, p0, 2, 6, 2);
      else building(world, 'powr', p0, 2, 6);
      const proc = building(world, 'proc', p0, 10, 10);
      if (opts.processor) { proc.upgrades = ['proc_processor']; }
      if (opts.purifier) building(world, 'purf', p0, 15, 2);
      if (opts.lowPower) building(world, 'tsla', p0, 20, 2); // (drains more than one plant makes)
      ore(map, 18, 10, 21, 13, 9);
      for (const u of world.units) if (u.ut.harvester) { world.entities.delete(u.id); }
      world.units = world.units.filter((u) => !u.ut.harvester);
      const [dx, dy] = proc.dockCell()!;
      const harv = unit(world, 'harv', p0, dx + 0.5, dy + 0.5);
      let unloadTicks = 0;
      const t = runUntil(world, () => { if (harv.hstate === 'unloading') unloadTicks++; return p0.stats.harvested > 0 && harv.cargo === 0; }, seconds(120));
      assert.ok(t > 0, 'a load delivered');
      return { value: p0.stats.harvested, unloadTicks, low: p0.lowPower };
    };
    const plain = load({});
    assert.equal(plain.value, BAIL_COUNT * GOLD_VALUE, 'plain load');
    const proc = load({ processor: true });
    assert.ok(Math.abs(proc.value - plain.value * 1.2) < 1, `processor +20% (${proc.value})`);
    assert.ok(proc.unloadTicks < plain.unloadTicks * 0.75, `unloads faster (${proc.unloadTicks} vs ${plain.unloadTicks} ticks)`);
    const pur = load({ processor: true, purifier: true });
    assert.ok(Math.abs(pur.value - plain.value * 1.5) < 1, `processor + purifier = x1.5 (${pur.value})`);
    const low = load({ purifier: true, lowPower: true });
    assert.ok(low.low, 'low power');
    assert.equal(low.value, plain.value, 'a purifier without power adds nothing');
  });

  test('Training Ground: infantry from that barracks arrive as Veterans', () => {
    const { world, p0 } = cmdWorld();
    const b = base(world, p0, 3, 3);
    tier(world, p0, 2);
    world.issue({ c: 'build', player: 0, type: 'e1' });
    runUntil(world, () => world.units.some((u) => u.ut.id === 'e1'), seconds(30));
    assert.equal(world.units.find((u) => u.ut.id === 'e1')!.rank, 0, 'rookie before');
    upgrade(world, p0, b.tent, 'barr_training');
    world.issue({ c: 'build', player: 0, type: 'e3' });
    runUntil(world, () => world.units.some((u) => u.ut.id === 'e3'), seconds(30));
    assert.equal(world.units.find((u) => u.ut.id === 'e3')!.rank, 1, 'veteran after');
  });

  test('Assembly Line: vehicles 25% faster, one per commander; Armour Shop: +10% vehicle health while it stands', () => {
    const { world, p0 } = cmdWorld();
    const b = base(world, p0, 3, 3);
    const weap2 = building(world, 'weap', p0, 3, 14);
    tier(world, p0, 2);
    const s0 = buildSeconds(world, p0, '2tnk');
    upgrade(world, p0, b.weap, 'weap_assembly');
    run(world, 6);
    assert.ok(Math.abs(buildSeconds(world, p0, '2tnk') / s0 - 0.8) < 1e-6, 'x0.8 build time');
    assert.equal(upgradeIssue(world, p0, weap2, 'weap_assembly'), 'unique', 'one per commander');
    assert.equal(upgradeIssue(world, p0, weap2, 'weap_armor'), 'tier', 'Armour Shop needs Tier 3');
    tier(world, p0, 3);
    const tank = unit(world, '2tnk', p0, 30, 30);
    tank.hp = 200;
    upgrade(world, p0, weap2, 'weap_armor');
    run(world, 6);
    assert.ok(Math.abs(tank.maxHp - 440) < 1e-6, 'vehicle health +10%');
    assert.ok(Math.abs(tank.hp - 220) < 1e-6, `health fraction kept (${tank.hp})`);
    world.kill(weap2, 'blown');
    run(world, 6);
    assert.ok(Math.abs(tank.maxHp - 400) < 1e-6, 'gone with the factory');
    assert.ok(Math.abs(tank.hp - 200) < 1e-6, 'fraction kept again');
  });

  test('Reinforced defences: +30% health for 40% of the price; doctrine synergy 25% off', () => {
    const { world, p0, p1 } = cmdWorld({ factions: ['allies', 'allies'], teams: [0, 1], doctrines: ['none', 'fortress'] });
    for (const p of [p0, p1]) { base(world, p, 3, p.id ? 24 : 3); tier(world, p, 2); }
    const gun = building(world, 'gun', p0, 3, 18);
    const gun1 = building(world, 'gun', p1, 30, 40);
    assert.equal(upgradeCost(p0, gun.bt, 'def_reinforced'), 250, '40% of $600, rounded to $50');
    assert.equal(upgradeCost(p1, gun1.bt, 'def_reinforced'), Math.round(250 * 0.75), 'Fortress Europe pays 25% less');
    gun.hp = 250;
    upgrade(world, p0, gun, 'def_reinforced');
    assert.equal(gun.maxHp, 650, '+30%');
    assert.ok(Math.abs(gun.hp - 325) < 1e-6, 'fraction kept');
    assert.equal(upgradeIssue(world, p0, gun, 'def_reinforced'), 'owned');
  });

  test('Satellite Uplink: the dome sees 6 cells further; support powers charge 25% faster', () => {
    const { world, p0, p1 } = cmdWorld({ factions: ['allies', 'allies'], teams: [0, 1], fog: true, w: 64, h: 64 });
    const b0 = base(world, p0, 3, 3);
    base(world, p1, 3, 40);
    for (const p of [p0, p1]) tier(world, p, 2);
    building(world, 'atek', p0, 22, 3);
    building(world, 'atek', p1, 22, 40);
    run(world, 5);
    const seen = () => p0.visible.reduce((s, v) => s + (v ? 1 : 0), 0);
    const v0 = seen();
    upgrade(world, p0, b0.dome, 'dome_uplink');
    run(world, 5);
    assert.ok(seen() > v0 + 50, `sees more (${v0} -> ${seen()})`);
    p0.superCharge.gps = 0; p1.superCharge.gps = 0;
    run(world, seconds(20));
    assert.ok(p0.superCharge.gps > p1.superCharge.gps * 1.2, `GPS charges faster (${p0.superCharge.gps.toFixed(1)} vs ${p1.superCharge.gps.toFixed(1)})`);
  });
});

// ---------------------------------------------------------------------------------------------- research

describe('economy: research', () => {
  test('labs: one project each, Level II needs Tier 3, the same research never runs twice', () => {
    const { world, p0 } = cmdWorld();
    base(world, p0, 3, 3);
    tier(world, p0, 2);
    const lab = building(world, 'rlab', p0, 3, 14);
    const lab2 = building(world, 'rlab', p0, 8, 14);
    assert.equal(researchIssue(world, p0, lab, 'conscription'), 'faction', 'Soviet research for the Allies: no');
    assert.equal(researchIssue(world, p0, lab, 'composite_armor'), null);
    world.issue({ c: 'research', player: 0, building: lab.id, tech: 'composite_armor' });
    run(world, 2);
    assert.equal(lab.task?.id, 'composite_armor');
    assert.equal(researchIssue(world, p0, lab, 'precision_optics'), 'busy');
    assert.equal(researchIssue(world, p0, lab2, 'composite_armor'), 'researching');
    const t = runUntil(world, () => !lab.task, seconds(60));
    assert.ok(t > seconds(30) && t < seconds(45), `about 40 s (${(t / 20).toFixed(1)} s)`);
    assert.equal(p0.econ!.levels.composite_armor, 1);
    assert.equal(researchIssue(world, p0, lab, 'composite_armor'), 'tier', 'Level II needs Tier 3');
    tier(world, p0, 3);
    assert.equal(researchIssue(world, p0, lab, 'composite_armor'), null);
    grant(world, p0, 'composite_armor', 2);
    assert.equal(researchIssue(world, p0, lab, 'composite_armor'), 'max');
    // cancel refunds
    const c = p0.credits;
    world.issue({ c: 'research', player: 0, building: lab2.id, tech: 'field_medicine' });
    run(world, seconds(5));
    world.issue({ c: 'research', player: 0, building: lab2.id, tech: 'field_medicine', cancel: true });
    run(world, 1);
    assert.equal(lab2.task, undefined);
    assert.ok(Math.abs(p0.credits - c) <= 1, 'refunded');
  });

  test('every research line has two levels with prices and effects', () => {
    for (const id of RESEARCH_IDS) {
      const r = RESEARCH[id];
      assert.equal(r.levels.length, 2, id);
      assert.ok(r.levels[0].cost > 0 && r.levels[1].cost > r.levels[0].cost, `${id} prices`);
      assert.ok(r.levels.every((l) => l.effect.length > 10), `${id} effect text`);
    }
  });

  test('Allied research: Composite Armour, Precision Optics, Rapid Deployment, Chrono Logistics', () => {
    const { world, map, p0, p1 } = cmdWorld({ factions: ['allies', 'soviet'] });
    building(world, 'fact', p0, 3, 3);
    powerUp(world, p0, 3, 7);
    const tank = unit(world, '2tnk', p0, 30, 30);
    const gun = building(world, 'gun', p0, 20, 20);
    const hit = (u: Unit) => { const h0 = u.hp; damageEntity(world, u, 100, null); const d = h0 - u.hp; u.hp = u.maxHp; return d; };
    assert.equal(hit(tank), 100);
    grant(world, p0, 'composite_armor', 1);
    assert.ok(Math.abs(hit(tank) - 92) < 1e-6, 'L1 -8%');
    grant(world, p0, 'composite_armor', 2);
    assert.ok(Math.abs(hit(tank) - 85) < 1e-6, 'L2 -15%');
    assert.equal(tank.weapons[0].def.range, WEAPONS['90mm'].range);
    grant(world, p0, 'precision_optics', 1);
    assert.ok(Math.abs(tank.weapons[0].def.range - WEAPONS['90mm'].range * 1.06) < 1e-9, 'tank range +6%');
    assert.ok(Math.abs(gun.weapons[0].def.range - WEAPONS.TurretGun.range * 1.06) < 1e-9, 'defence range +6%');
    grant(world, p0, 'precision_optics', 2);
    assert.ok(Math.abs(tank.weapons[0].def.range - WEAPONS['90mm'].range * 1.12) < 1e-9, 'L2 +12%');
    building(world, 'tent', p0, 10, 3);
    const e1 = buildSeconds(world, p0, 'e1'), pw = buildSeconds(world, p0, 'apwr'), task = taskSeconds(p0, 40);
    grant(world, p0, 'rapid_deployment', 1);
    assert.ok(Math.abs(buildSeconds(world, p0, 'e1') - Math.max(1.2, e1 / 1.15)) < 1e-6, 'units 15% faster');
    assert.ok(Math.abs(buildSeconds(world, p0, 'apwr') - pw) < 1e-6, 'structures unchanged at L1');
    grant(world, p0, 'rapid_deployment', 2);
    assert.ok(Math.abs(buildSeconds(world, p0, 'apwr') - pw / 1.25) < 1e-6, 'structures 25% faster at L2');
    assert.ok(Math.abs(taskSeconds(p0, 40) - task / 1.25) < 1e-6, 'upgrades and research too');
    // Chrono Logistics I: a full truck far from its refinery jumps next to it
    const proc = building(world, 'proc', p0, 4, 20);
    ore(map, 40, 40, 44, 44, 9);
    for (const u of world.units.filter((x) => x.ut.harvester)) { u.alive = false; world.entities.delete(u.id); }
    world.units = world.units.filter((x) => x.alive);
    const harv = unit(world, 'harv', p0, 42.5, 42.5);
    harv.cargo = harvestCapacity(p0) - 1;
    harv.cargoValue = harv.cargo * GOLD_VALUE;
    grant(world, p0, 'chrono_logistics', 1);
    const t = runUntil(world, () => Math.hypot(harv.x - proc.x, harv.y - proc.y) < 8, seconds(15));
    assert.ok(t > 0 && t < seconds(8), `chronoshifted home (${t} ticks)`);
    assert.ok(harv.chronoCooldown > 30, 'and recharges');
    // Chrono Logistics II: chrono tanks recharge 30% faster
    const ct = unit(world, 'ctnk', p0, 30, 10);
    ct.chronoCooldown = 60;
    grant(world, p0, 'chrono_logistics', 2);
    const c0 = ct.chronoCooldown;
    run(world, seconds(10));
    assert.ok(c0 - ct.chronoCooldown > 12.5, `recharged ${(c0 - ct.chronoCooldown).toFixed(1)} s in 10 s`);
    void p1;
  });

  test('Soviet research: Reactive Armour, Tesla Amplifiers, Conscription, Heavy Industry; synergy discount', () => {
    const { world, p0 } = cmdWorld({ factions: ['soviet', 'allies'], doctrines: ['humanwave', 'none'] });
    building(world, 'fact', p0, 3, 3);
    powerUp(world, p0, 3, 7, 4);
    building(world, 'barr', p0, 10, 3);
    building(world, 'proc', p0, 13, 3);
    building(world, 'weap', p0, 17, 3);
    const tank = unit(world, '3tnk', p0, 30, 30);
    tank.hp = 200;
    grant(world, p0, 'reactive_armor', 1);
    assert.ok(Math.abs(tank.maxHp - 460) < 1e-6 && Math.abs(tank.hp - 230) < 1e-6, `L1 +15% (${tank.maxHp}, ${tank.hp})`);
    grant(world, p0, 'reactive_armor', 2);
    assert.ok(Math.abs(tank.maxHp - 520) < 1e-6, 'L2 +30%');
    const fresh = unit(world, '4tnk', p0, 33, 30);
    assert.ok(Math.abs(fresh.hp - 780) < 1e-6, 'new tanks arrive at full (boosted) health');
    const coil = building(world, 'tsla', p0, 25, 20);
    run(world, 10);
    const use0 = p0.powerUse;
    grant(world, p0, 'tesla_amplifiers', 1);
    assert.ok(Math.abs(coil.weapons[0].def.damage - 115) < 1e-9, 'tesla +15% damage');
    grant(world, p0, 'tesla_amplifiers', 2);
    run(world, 10);
    assert.ok(Math.abs(coil.weapons[0].def.range - WEAPONS.TeslaZap.range * 1.15) < 1e-9, 'coil range +15%');
    assert.ok(Math.abs(use0 - p0.powerUse - 60) < 1e-6, `coil drain -40% (${use0} -> ${p0.powerUse})`);
    // Human Wave: infantry 25% off; Conscription stacks, and costs 25% less to research
    assert.equal(priceOf(p0, 'e1'), 75);
    assert.equal(researchCost(p0, 'conscription', 1), 750, 'doctrine synergy');
    const e3 = buildSeconds(world, p0, 'e3');
    grant(world, p0, 'conscription', 1);
    assert.equal(priceOf(p0, 'e3'), Math.round(300 * 0.75 * 0.85), 'L1 -15%');
    grant(world, p0, 'conscription', 2);
    assert.equal(priceOf(p0, 'e3'), Math.round(300 * 0.75 * 0.75), 'L2 -25%');
    assert.ok(buildSeconds(world, p0, 'e3') < e3 * 0.8, 'and trains faster');
    assert.equal(priceOf(p0, '3tnk'), Math.round(950 * 1.1), 'Human Wave vehicles +10%');
    grant(world, p0, 'heavy_industry', 1);
    assert.equal(priceOf(p0, '3tnk'), Math.round(950 * 1.1 * 0.9), 'heavy industry -10%');
    assert.equal(priceOf(p0, 'mcv'), 2500, 'not the MCV');
    grant(world, p0, 'heavy_industry', 2);
    assert.equal(priceOf(p0, '3tnk'), Math.round(950 * 1.1 * 0.85), 'L2 -15%');
  });

  test('shared research: Improved Harvesters and Field Medicine', () => {
    const { world, p0 } = cmdWorld();
    building(world, 'fact', p0, 3, 3);
    const harv = unit(world, 'harv', p0, 30, 30);
    assert.equal(harvestCapacity(p0), BAIL_COUNT);
    grant(world, p0, 'improved_harvesters', 1);
    assert.equal(harvestCapacity(p0), 35, '+25% capacity');
    const h0 = harv.hp;
    damageEntity(world, harv, 100, null);
    assert.ok(Math.abs(h0 - harv.hp - 75) < 1e-6, 'takes 25% less damage');
    grant(world, p0, 'improved_harvesters', 2);
    assert.equal(harvestCapacity(p0), 42, '+50% capacity');
    const inf = unit(world, 'e1', p0, 20, 20), tank = unit(world, '2tnk', p0, 24, 20);
    inf.hp = 20; tank.hp = 200;
    inf.lastDamagedTick = tank.lastDamagedTick = world.tick - seconds(20);
    grant(world, p0, 'field_medicine', 1);
    run(world, seconds(4));
    assert.ok(inf.hp > 22, `infantry heal (${inf.hp})`);
    assert.equal(tank.hp, 200, 'vehicles not at L1');
    damageEntity(world, inf, 1, null);
    const hurt = inf.hp;
    run(world, seconds(4));
    assert.equal(inf.hp, hurt, 'not while in combat');
    grant(world, p0, 'field_medicine', 2);
    run(world, seconds(4));
    assert.ok(tank.hp > 205, `vehicles heal at L2 (${tank.hp})`);
  });
});

// ---------------------------------------------------------------------------------------------- structures

describe('economy: new structures', () => {
  test('Ore Trucks skip ore where they can see enemy fighters', () => {
    const { world, map, p0, p1 } = cmdWorld();
    building(world, 'fact', p0, 2, 2);
    powerUp(world, p0, 2, 6, 2);
    const proc = building(world, 'proc', p0, 14, 14);
    ore(map, 20, 14, 23, 17, 9); // near, but an enemy tank sits by it
    ore(map, 8, 26, 11, 29, 9); // further away, quiet
    const tank = unit(world, '3tnk', p1, 25.5, 15.5);
    tank.stance = 'passive';
    for (const u of world.units.filter((x) => x.ut.harvester)) { u.alive = false; world.entities.delete(u.id); }
    world.units = world.units.filter((x) => x.alive);
    const [dx, dy] = proc.dockCell()!;
    const harv = unit(world, 'harv', p0, dx + 0.5, dy + 0.5);
    run(world, seconds(12));
    assert.ok(harv.y > 22, `went to the quiet field (${harv.x.toFixed(1)}, ${harv.y.toFixed(1)})`);
    world.kill(tank, 'normal');
    harv.lastOreX = 21; harv.lastOreY = 15; harv.hstate = 'seek'; harv.cargo = 0; harv.path = null;
    run(world, seconds(10));
    assert.ok(harv.x > 18 && harv.y < 19, `back to the near field once it is clear (${harv.x.toFixed(1)}, ${harv.y.toFixed(1)})`);
  });

  test('Logistics Centre: units 10% cheaper, free repairs within 6 cells', () => {
    const { world, p0 } = cmdWorld();
    base(world, p0, 3, 3);
    tier(world, p0, 2);
    assert.equal(priceOf(p0, '2tnk'), 800);
    const lg = building(world, 'lgst', p0, 3, 14);
    run(world, 6);
    assert.equal(priceOf(p0, '2tnk'), 720, '-10% units');
    assert.equal(priceOf(p0, 'powr'), 300, 'structures unchanged');
    const near = unit(world, '2tnk', p0, lg.x + 1, lg.y + 3), far = unit(world, '2tnk', p0, 40, 40);
    near.hp = far.hp = 200;
    const c = p0.credits;
    run(world, seconds(5));
    assert.ok(near.hp >= 230, `repaired nearby (${near.hp})`);
    assert.equal(far.hp, 200, 'not far away');
    assert.ok(Math.abs(p0.credits - c) <= 1, 'for free');
  });

  test('Mining Outpost: placed by any ore field in view away from the base; trucks unload at the nearest dock', () => {
    const { world, map, p0, p1 } = cmdWorld({ fog: true, w: 64, h: 64 });
    building(world, 'fact', p0, 2, 2);
    powerUp(world, p0, 2, 6, 2);
    const proc = building(world, 'proc', p0, 7, 2);
    ore(map, 44, 30, 48, 34, 9);
    assert.ok(!world.canPlace(p0, 'mout', 40, 30), 'not in the fog');
    const scout = unit(world, 'jeep', p0, 44, 28);
    run(world, 5);
    assert.ok(world.canPlace(p0, 'mout', 40, 30), 'by the field in view');
    assert.equal(world.placementIssue(p0, 'mout', 30, 50), 'distance', 'not away from ore');
    building(world, 'powr', p1, 52, 30);
    run(world, 2);
    assert.ok(!world.canPlace(p0, 'mout', 46, 26), 'not next to an enemy structure');
    const out = building(world, 'mout', p0, 40, 30);
    run(world, 5);
    assert.ok(world.canPlace(p0, 'gun', 39, 28) || world.canPlace(p0, 'gun', 43, 28), 'defences may go next to it');
    assert.equal(world.placementIssue(p0, 'powr', 37, 30), 'distance', 'other structures may not');
    for (const u of world.units.filter((x) => x.ut.harvester)) { u.alive = false; world.entities.delete(u.id); }
    world.units = world.units.filter((x) => x.alive);
    const harv = unit(world, 'harv', p0, 45.5, 33.5);
    const t = runUntil(world, () => p0.stats.harvested > 0, seconds(90));
    assert.ok(t > 0, 'delivered');
    assert.ok(Math.hypot(harv.x - out.x, harv.y - out.y) < Math.hypot(harv.x - proc.x, harv.y - proc.y), 'at the outpost, not the far refinery');
    void scout;
  });

  test('Bunker: four infantry go in, fire from inside, are safe, and come out on evacuate, sale or destruction', () => {
    const { world, p0, p1 } = cmdWorld();
    building(world, 'fact', p0, 3, 3);
    const bk = building(world, 'bnkr', p0, 20, 20);
    const sq = [0, 1, 2, 3, 4].map((k) => unit(world, 'e3', p0, 17 + k * 0.6, 24.5));
    const eng = unit(world, 'e6', p0, 16, 25);
    world.issue({ c: 'enter', player: 0, units: [...sq, eng].map((u) => u.id), target: bk.id });
    run(world, seconds(8));
    assert.equal(bk.garrison?.length, 4, 'four inside');
    const inside = sq.filter((u) => u.transport === bk.id);
    assert.equal(inside.length, 4);
    assert.ok(inside.every((u) => !world.units.includes(u)), 'off the field');
    assert.ok(!eng.transport, 'no engineers');
    // an enemy tank rolls up: the garrison fires, the bunker soaks the damage
    const tank = unit(world, '3tnk', p1, 26.5, 21);
    tank.stance = 'hold';
    const hp0 = inside.map((u) => u.hp);
    run(world, seconds(6));
    assert.ok(tank.hp < tank.maxHp, `the garrison hit the tank (${tank.hp})`);
    assert.ok(inside.every((u, i) => u.hp === hp0[i]), 'nobody inside was hurt');
    world.kill(tank, 'normal');
    world.issue({ c: 'evacuate', player: 0, building: bk.id });
    run(world, 2);
    assert.equal(bk.garrison, undefined, 'empty');
    assert.ok(inside.every((u) => world.units.includes(u) && !u.transport), 'back on the field');
    // in again, then the bunker is destroyed: out, shaken
    world.issue({ c: 'enter', player: 0, units: inside.map((u) => u.id), target: bk.id });
    run(world, seconds(6));
    assert.equal(bk.garrison?.length, 4);
    world.kill(bk, 'blown');
    run(world, 1);
    assert.ok(inside.every((u) => u.alive && world.units.includes(u) && u.hp <= u.maxHp * 0.71), 'out and hurt');
  });

  test('Fortress Gate: own units path through it, enemies are kept out, it opens and closes', () => {
    const { world, map, p0, p1 } = cmdWorld();
    building(world, 'fact', p0, 3, 3);
    for (let y = 0; y < 48; y++) if (y !== 24) building(world, 'brik', p0, 24, y);
    const gate = building(world, 'gate', p0, 24, 24);
    run(world, 12);
    const i = map.idx(24, 24);
    assert.equal(map.passableOverride[i], 0, 'shut');
    const mine = unit(world, '2tnk', p0, 18.5, 30.5);
    world.issue({ c: 'move', player: 0, units: [mine.id], x: 30.5, y: 30.5 });
    let opened = false, door = 0;
    const t = runUntil(world, () => { if (map.passableOverride[i]) opened = true; door = Math.max(door, gate.door); return mine.x > 29; }, seconds(40));
    assert.ok(t > 0, `own tank went through (${mine.x.toFixed(1)}, ${mine.y.toFixed(1)})`);
    assert.ok(opened && door > 0.5, `the gate opened (door ${door.toFixed(2)})`);
    run(world, seconds(4));
    assert.equal(map.passableOverride[i], 0, 'and closed behind it');
    const foe = unit(world, '3tnk', p1, 30.5, 14.5);
    foe.stance = 'passive';
    world.issue({ c: 'move', player: 1, units: [foe.id], x: 18.5, y: 14.5 });
    run(world, seconds(30));
    assert.ok(foe.x > 24.5, `the enemy stays out (${foe.x.toFixed(1)})`);
  });
});

// ---------------------------------------------------------------------------------------------- AI, saves, replays

describe('economy: AI, saves and replays', () => {
  test('the AI climbs tiers, upgrades, researches and builds the new structures', () => {
    const map = generateMap({ size: 80, players: 2, seed: 3, water: 0.3, trees: 0.5, ore: 0.6 });
    const w = new World({ map, players: [
      { name: 'A', faction: 'allies', color: 0, team: 0, isHuman: false, ai: 'hard', personality: 'tycoon' },
      { name: 'B', faction: 'soviet', color: 0, team: 1, isHuman: false, ai: 'hard', personality: 'turtle' }],
    credits: 10000, startUnits: 'mcv', fog: true, seed: 3, rules: 'commander' });
    const done: string[] = [];
    for (let t = 0; t < seconds(720) && !w.gameOver; t++) {
      w.step();
      for (const e of w.events) if (e.e === 'econ' && e.stage === 'done') done.push(`${e.player}:${e.id}`);
      w.events.length = 0;
    }
    for (const p of w.players) {
      assert.ok(p.econ!.tier >= 2, `P${p.id} reached Tier 2`);
      assert.ok(done.filter((d) => d.startsWith(`${p.id}:`)).length >= 4, `P${p.id} finished several projects: ${done.filter((d) => d.startsWith(`${p.id}:`)).join(' ')}`);
    }
    const levels = w.players.reduce((s, p) => s + Object.keys(p.econ!.levels).length, 0);
    assert.ok(levels >= 2, `research done (${levels})`);
    const tycoon = w.buildings.filter((b) => b.alive && b.owner.id === 0);
    assert.ok(tycoon.some((b) => b.upgrades?.includes('proc_processor')), 'the tycoon processes its ore');
  });

  test('save / load mid-upgrade and mid-research continues identically', () => {
    const mk = () => {
      const s = cmdWorld();
      const b = base(s.world, s.p0, 3, 3);
      tier(s.world, s.p0, 2);
      const lab = building(s.world, 'rlab', s.p0, 3, 14);
      building(s.world, 'gun', s.p0, 20, 14);
      // a wall with a gate a tank drives through, and a bunker filling up, both mid-way at the save
      for (let y = 20; y < 34; y++) if (y !== 27) building(s.world, 'brik', s.p0, 30, y);
      building(s.world, 'gate', s.p0, 30, 27);
      const bk = building(s.world, 'bnkr', s.p0, 20, 30);
      const tank = unit(s.world, '2tnk', s.p0, 25.5, 27.5);
      const inf = [0, 1, 2].map((k) => unit(s.world, 'e1', s.p0, 16 + k, 34.5));
      return { ...s, b, lab, bk, tank, inf };
    };
    const A = mk();
    A.world.issue({ c: 'upgrade', player: 0, building: A.b.weap.id, upgrade: 'weap_assembly' });
    A.world.issue({ c: 'research', player: 0, building: A.lab.id, tech: 'precision_optics' });
    A.world.issue({ c: 'build', player: 0, type: '2tnk' });
    run(A.world, seconds(9));
    A.world.issue({ c: 'move', player: 0, units: [A.tank.id], x: 36.5, y: 27.5 });
    A.world.issue({ c: 'enter', player: 0, units: A.inf.map((u) => u.id), target: A.bk.id });
    run(A.world, seconds(3));
    assert.ok(A.b.weap.task && A.lab.task, 'both running');
    const json = JSON.stringify(serializeWorld(A.world));
    const B = mk();
    deserializeWorld(B.world, JSON.parse(json));
    assert.equal(worldHash(A.world), worldHash(B.world), 'same right after loading');
    for (let t = 0; t < seconds(60); t++) { A.world.step(); B.world.step(); A.world.events.length = 0; B.world.events.length = 0; }
    assert.equal(worldHash(A.world), worldHash(B.world), 'same a minute later');
    assert.equal(B.world.players[0].econ!.levels.precision_optics, 1, 'research finished after loading');
    const bw = B.world.entities.get(A.b.weap.id) as Building;
    assert.ok(bw.upgrades?.includes('weap_assembly'), 'upgrade finished after loading');
    assert.ok((B.world.entities.get(A.tank.id) as Unit).x > 33, 'the tank got through the gate after loading');
    assert.equal((B.world.entities.get(A.bk.id) as Building).garrison?.length, 3, 'the bunker filled up after loading');
  });

  test('a Commander AI battle survives save / load deterministically', () => {
    const mk = () => skirmishCmd(91);
    const A = mk();
    run(A, seconds(420));
    const json = JSON.stringify(serializeWorld(A));
    const B = mk();
    deserializeWorld(B, JSON.parse(json));
    for (let t = 0; t < seconds(120); t++) { A.step(); B.step(); A.events.length = 0; B.events.length = 0; }
    assert.equal(worldHash(A), worldHash(B), 'deterministic after load');
  });

  test('a replay with economy commands stays in sync', () => {
    const make = () => skirmishCmd(4242, [undefined, 'hard']);
    const rec = (() => {
      const world = make();
      const r = new CommandRecorder(world);
      hookStep(world, null, () => r.afterStep());
      const p = world.players[0];
      const issue = (c: Command) => { r.record(c); world.issue(c); };
      for (let t = 0; t < seconds(360); t++) {
        if (world.tick === 1) { const mcv = world.units.find((u) => u.owner === p && u.ut.deploysInto); if (mcv) issue({ c: 'deploy', player: 0, units: [mcv.id] }); }
        const q = p.queues.structure;
        const order = ['powr', 'proc', 'tent', 'powr', 'bnkr'];
        const want = order.find((id) => !p.has(id) || (id === 'powr' && (p.owned.get('powr') ?? 0) < 2));
        if (want && p.has('fact') && !q.items.length && !q.ready && p.canBuild(want)) issue({ c: 'build', player: 0, type: want });
        if (q.ready) {
          const fact = world.buildings.find((b) => b.owner === p && b.bt.id === 'fact');
          if (fact) {
            search: for (let rr = 3; rr < 12; rr++) for (let dy = -rr; dy <= rr; dy++) for (let dx = -rr; dx <= rr; dx++) {
              if (world.canPlace(p, q.ready, fact.cx + dx, fact.cy + dy)) { issue({ c: 'place', player: 0, type: q.ready, cx: fact.cx + dx, cy: fact.cy + dy }); break search; }
            }
          }
        }
        if (world.tick % 40 === 0) {
          const fact = world.buildings.find((b) => b.owner === p && b.bt.id === 'fact');
          if (fact && !upgradeIssue(world, p, fact, 'cy_t2')) issue({ c: 'upgrade', player: 0, building: fact.id, upgrade: 'cy_t2' });
          const plant = world.buildings.find((b) => b.owner === p && b.bt.id === 'powr' && !upgradeIssue(world, p, b, 'powr_turbine'));
          if (plant) issue({ c: 'upgrade', player: 0, building: plant.id, upgrade: 'powr_turbine' });
          if (p.canBuild('e1')) issue({ c: 'build', player: 0, type: 'e1', count: 2 });
          const bk = world.buildings.find((b) => b.owner === p && b.bt.id === 'bnkr' && b.active);
          const idle = world.units.filter((u) => u.owner === p && u.ut.id === 'e1' && u.order.type === 'idle').slice(0, 2);
          if (bk && idle.length) issue({ c: 'enter', player: 0, units: idle.map((u) => u.id), target: bk.id });
        }
        world.step();
        world.events.length = 0;
      }
      return { cmds: r.cmds, hashes: r.hashes, final: worldHash(world), tier: p.econ!.tier };
    })();
    assert.ok(rec.cmds.some(([, c]) => c.c === 'upgrade'), 'economy commands recorded');
    const world = make();
    const feeder = new CommandFeeder(world, rec.cmds, rec.hashes);
    hookStep(world, () => feeder.beforeStep(), () => feeder.afterStep());
    while (world.tick < seconds(360)) { world.step(); world.events.length = 0; }
    assert.equal(feeder.desyncTick, -1, 'in sync at every checkpoint');
    assert.ok(feeder.checked >= 3, `checked ${feeder.checked} hashes`);
    assert.equal(worldHash(world), rec.final, 'same final state');
  });
});

/** A procedural Commander skirmish, AI vs AI by default. */
function skirmishCmd(seed: number, ai: ('hard' | 'normal' | undefined)[] = ['hard', 'normal']): World {
  const map = generateMap({ size: 64, players: 2, seed, water: 0.5, trees: 0.5, ore: 0.6 });
  return new World({
    map, players: [
      { name: 'A', faction: 'soviet', color: 0, team: 0, isHuman: !ai[0], ai: ai[0] },
      { name: 'B', faction: 'allies', color: 0, team: 1, isHuman: !ai[1], ai: ai[1] }],
    credits: 8000, startUnits: 'mcv', fog: true, seed, rules: 'commander',
  });
}

// ---------------------------------------------------------------------------------------------- old recordings

describe('economy: recordings made before the economy existed', () => {
  const OLD: GameSetup = {
    faction: 'soviet', color: 0xd23a2c, opponents: [{ faction: 'allies', difficulty: 'hard' }], mapSize: 64, water: 0.5, trees: 0.5, ore: 0.6,
    credits: 8000, startUnits: 'light', fog: true, timeOfDay: 'day', quality: 'low', seed: 6262, rules: 'commander', events: true,
  };
  const TICKS = seconds(240);
  // as the previous build played a Commander match: no economy (here forced with econ: false)
  const live = headlessGame({ ...OLD, econ: false });
  const rec = new CommandRecorder(live.world);
  hookStep(live.world, null, () => rec.afterStep());
  const me = live.world.players[0];
  const issue = (c: Command) => { rec.record(c); live.world.issue(c); };
  for (let t = 0; t < TICKS; t++) {
    const w = live.world;
    if (t % (TICK_HZ * 10) === 0) {
      const mcv = w.units.find((u) => u.owner === me && u.ut.deploysInto);
      if (mcv) issue({ c: 'deploy', player: 0, units: [mcv.id] });
      if (me.canBuild('e1')) issue({ c: 'build', player: 0, type: 'e1', count: 2 });
    }
    if (t % (TICK_HZ * 45) === 0 && t > 0) {
      const army = w.units.filter((u) => u.owner === me && u.weapons.length && !u.ut.harvester).map((u) => u.id);
      const foe = w.map.startPositions[1];
      if (army.length) issue({ c: 'move', player: 0, units: army, x: foe.x, y: foe.y, attackMove: true });
    }
    w.step();
    w.events.length = 0;
  }
  // the recording as the previous build wrote it: no `econ` field in its setup
  const { econ: _e, load: _l, replay: _r, quality: _q, ...oldSetup } = live.setup;
  const data: ReplayData = {
    v: REPLAY_VERSION, id: 'rold', createdAt: 0, gameVersion: 'old', setup: oldSetup as ReplaySetup, mapName: 'Old', mapW: live.world.map.w, mapH: live.world.map.h,
    players: live.world.players.map((p) => ({ name: p.name, faction: p.faction, color: p.color, team: p.team })), local: 0, ticks: TICKS,
    result: 'abandoned', winnerTeam: -1, cmds: rec.cmds, hashes: rec.hashes,
  };

  test('an old Commander replay (no econ field) plays back without the economy, in sync', () => {
    assert.equal(live.world.econ, null, 'recorded without the economy');
    assert.ok(!('econ' in data.setup), 'the old recording has no econ field');
    assert.ok(rec.hashes.length >= 10 && rec.cmds.length >= 3, `something to check (${rec.hashes.length} hashes, ${rec.cmds.length} commands)`);
    const pb = headlessGame(playbackSetup(data, 'low'));
    assert.equal(pb.setup.econ, false, 'treated as recorded without the economy');
    assert.equal(pb.world.econ, null, 'built without it');
    const feeder = new CommandFeeder(pb.world, data.cmds, data.hashes);
    hookStep(pb.world, () => feeder.beforeStep(), () => feeder.afterStep());
    while (pb.world.tick < TICKS) { pb.world.step(); pb.world.events.length = 0; }
    assert.equal(feeder.desyncTick, -1, 'no desync');
    assert.equal(feeder.checked, data.hashes.length, 'every checkpoint compared');
    assert.equal(worldHash(pb.world), worldHash(live.world), 'same final state');
  });

  test('old saves, branches and challenges load without it; fresh setups get it and record it', () => {
    // an old save: Commander setup without the field, world state without economy
    const save = headlessGame({ ...(oldSetup as GameSetup), quality: 'low', load: { version: 1, savedAt: 0, world: serializeWorld(live.world) } });
    assert.equal(save.world.econ, null, 'old save: no economy');
    assert.equal(worldHash(save.world), worldHash(live.world), 'old save restores exactly');
    // a branch of the old replay
    const pb = headlessGame(playbackSetup(data, 'low'));
    const feeder = new CommandFeeder(pb.world, data.cmds, data.hashes);
    hookStep(pb.world, () => feeder.beforeStep(), () => feeder.afterStep());
    while (pb.world.tick < seconds(120)) { pb.world.step(); pb.world.events.length = 0; }
    const branch = makeBranch(data, pb.world, 1, 'hard', { cam: { x: 10, y: 10, dist: 20 } });
    const bg = headlessGame(JSON.parse(JSON.stringify(branchSetup(data.setup, branch, 'low'))) as GameSetup);
    assert.equal(bg.world.econ, null, 'old branch: no economy');
    assert.equal(worldHash(bg.world), branch.hash, 'old branch starts from the recorded state');
    // fresh setups (menu, Quick Battle, autostart) get the economy, and say so for the recording
    const fresh = headlessGame({ ...OLD });
    assert.equal(fresh.setup.econ, true, 'flag made explicit');
    assert.ok(fresh.world.econ, 'economy on');
    const { load: _l2, replay: _r2, quality: _q2, ...newSetup } = fresh.setup;
    assert.equal((newSetup as ReplaySetup).econ, true, 'a new recording carries econ: true');
    const again = headlessGame(playbackSetup({ ...data, setup: newSetup as ReplaySetup, cmds: [], hashes: [] }, 'low'));
    assert.ok(again.world.econ, 'and plays back with the economy');
    // Classic setups are untouched
    const classic = headlessGame({ ...OLD, rules: 'classic' });
    assert.equal(classic.setup.econ, undefined, 'no flag under Classic rules');
    assert.equal(classic.world.econ, null);
  });
});
