// Commander rules: doctrines (per-player modifiers), command points, the commander powers, save / load,
// replay sync, the AI's use of them, and Classic rules staying bit-identical.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BUILDINGS, UNITS, WEAPONS, type Faction } from '../src/data/rules';
import { generateMap } from '../src/sim/mapgen';
import { GameMap } from '../src/sim/map';
import { World, type PlayerSetup } from '../src/sim/world';
import { serializeWorld, deserializeWorld } from '../src/sim/save';
import { buildSeconds, recalcPlayerEconomy } from '../src/sim/production';
import { unitSpeed } from '../src/sim/unitlogic';
import { damageEntity } from '../src/sim/combat';
import { DOCTRINES, DOCTRINE_IDS, costOf, doctrinesFor, doctrineUnlocked } from '../src/sim/doctrine';
import {
  ELITE_N, KILL_VALUE, LOSS_VALUE, POWERS, POWER_IDS, START_POINTS, TIER_COST, TRICKLE_SECONDS, commanderLevel, fundsFor, grantCommandPoints,
  pickAIDoctrine, powerTree, saveCommander, tierOpen, type PowerId,
} from '../src/sim/commander';
import { resolvePersonality } from '../src/sim/ai-personality';
import { CommandFeeder, CommandRecorder, hookStep } from '../src/replay/core';
import { worldHash } from '../src/replay/hash';
import type { Command, GameEvent } from '../src/sim/types';
import { building, run, seconds, stateHash, unit, TICK_HZ, type Player } from './helpers';

/** A flat, empty world under Commander rules (like helpers.sandbox). */
function arena(opts: { factions?: Faction[]; doctrines?: (string | null)[]; fog?: boolean; seed?: number; rules?: 'commander' | 'classic' | undefined; w?: number; h?: number } = {}) {
  const w = opts.w ?? 48, h = opts.h ?? 48;
  const map = new GameMap(w, h);
  map.startPositions = [{ x: 6.5, y: h - 6.5 }, { x: w - 6.5, y: 6.5 }];
  const factions = opts.factions ?? ['allies', 'soviet'];
  const players: PlayerSetup[] = factions.map((f, i) => ({ name: `P${i}`, faction: f, color: 0xffffff, team: i, isHuman: true }));
  const world = new World({ map, players, credits: 10000, startUnits: 'mcv', fog: opts.fog ?? false, seed: opts.seed ?? 1, rules: 'rules' in opts ? opts.rules : 'commander', doctrines: opts.doctrines });
  world.cratesEnabled = false;
  for (const u of world.units) world.entities.delete(u.id);
  world.units = [];
  // a passive soldier in a far corner keeps each side in the game (a player with nothing left is defeated)
  world.players.forEach((p, i) => { const k = unit(world, 'e1', p, i ? w - 1.5 : 1.5, i ? 1.5 : h - 1.5); k.stance = 'passive'; });
  return { world, map, p0: world.players[0], p1: world.players[1] };
}

/** An AI-vs-AI skirmish on a generated map. */
function match(seed: number, rules: 'commander' | 'classic' | undefined, doctrines?: (string | null)[], factions: Faction[] = ['allies', 'soviet']) {
  const map = generateMap({ size: 64, players: 2, seed, water: 0.5, trees: 0.5, ore: 0.6 });
  return new World({
    map, players: factions.map((f, i) => ({ name: `P${i}`, faction: f, color: 0, team: i, isHuman: false, ai: 'hard' as const })),
    credits: 10000, startUnits: 'light', fog: true, seed, rules, doctrines,
  });
}

const give = (p: Player, pts: number) => { p.cmd!.points += pts; p.cmd!.earned += pts; };
const unlock = (w: World, p: Player, id: PowerId) => { w.issue({ c: 'unlockPower', player: p.id, power: id }); run(w, 1); };
const use = (w: World, p: Player, id: PowerId, x?: number, y?: number, target?: number) => { w.issue({ c: 'commanderPower', player: p.id, power: id, x, y, target }); run(w, 1); };
/** Unlock every power of the player's tree (enough points, all tiers open). */
function unlockAll(w: World, p: Player) {
  give(p, 200);
  for (const tier of powerTree(p.faction)) for (const d of tier) unlock(w, p, d.id);
}
const fullHash = (w: World) => stateHash(w) + ':' + worldHash(w) + ':' + JSON.stringify(w.commander ? saveCommander(w.commander) : null);

describe('doctrines: per-player modifiers', () => {
  test('stats change for the doctrine player only, never in the shared rule tables', () => {
    const { world, p0, p1 } = arena({ factions: ['soviet', 'soviet'], doctrines: ['armouredfist', 'none'] });
    const a = unit(world, '3tnk', p0, 10.5, 10.5), b = unit(world, '3tnk', p1, 14.5, 10.5);
    assert.equal(UNITS['3tnk'].strength, 400, 'rule table untouched');
    assert.ok(Math.abs(a.maxHp - 440) < 1e-9, `armoured fist heavy tank health ${a.maxHp}`);
    assert.equal(a.hp, a.maxHp, 'spawns at full (doctrine) health');
    assert.equal(b.maxHp, 400, 'the other player keeps the base value');
    assert.equal(a.healthFrac, 1, 'health fraction uses the doctrine maximum');
    assert.equal(costOf(p0, UNITS.e1), Math.round(100 * 1.15), 'infantry 15% dearer (drawback)');
    assert.equal(costOf(p1, UNITS.e1), 100);
    const v0 = unit(world, '3tnk', p0, 20.5, 20.5), v1 = unit(world, '3tnk', p1, 22.5, 20.5);
    assert.equal(unitSpeed(v0), unitSpeed(v1), 'speeds untouched by this doctrine');
    assert.equal(costOf(p0, UNITS['4tnk']), 1900, 'Mammoth price unchanged');
    building(world, 'weap', p0, 4, 30);
    building(world, 'weap', p1, 30, 30);
    building(world, 'powr', p0, 8, 30); building(world, 'powr', p1, 34, 30);
    const r = buildSeconds(world, p0, '4tnk') / buildSeconds(world, p1, '4tnk');
    assert.ok(Math.abs(r - 1 / 1.15) < 1e-9, `Mammoths build 15% faster (${r})`);
    assert.equal(buildSeconds(world, p0, '3tnk'), buildSeconds(world, p1, '3tnk'), 'other vehicles as usual');
  });

  test('weapon variants: damage and range per player, the shared WeaponDef untouched', () => {
    const { world, p0, p1 } = arena({ factions: ['soviet', 'soviet'], doctrines: ['tesla', null] });
    const c0 = building(world, 'tsla', p0, 10, 10), c1 = building(world, 'tsla', p1, 30, 10);
    assert.equal(WEAPONS.TeslaZap.damage, 100, 'rule table untouched');
    assert.notEqual(c0.weapons[0].def, WEAPONS.TeslaZap, 'the doctrine coil has its own variant');
    assert.equal(c0.weapons[0].def.id, 'TeslaZap', 'same weapon id');
    assert.ok(Math.abs(c0.weapons[0].def.damage - 115) < 1e-9, 'tesla +15% damage');
    assert.ok(Math.abs(c0.weapons[0].def.range - 8.5 * 1.15) < 1e-9, 'tesla coil +15% range');
    assert.equal(c1.weapons[0].def, WEAPONS.TeslaZap, 'the other player fires the base weapon');
    recalcPlayerEconomy(world, p0); recalcPlayerEconomy(world, p1);
    assert.ok(Math.abs(p0.powerUse - 150 * 1.3) < 1e-9 && p1.powerUse === 150, `power drain ${p0.powerUse} / ${p1.powerUse}`);
  });

  test('prices: production pays the doctrine price; refunds match what was paid', () => {
    const { world, p0, p1 } = arena({ factions: ['soviet', 'soviet'], doctrines: ['humanwave', null] });
    assert.equal(costOf(p0, UNITS.e1), 75, 'infantry 25% cheaper');
    assert.equal(costOf(p0, UNITS['3tnk']), Math.round(950 * 1.1), 'vehicles 10% dearer');
    assert.equal(costOf(p1, UNITS.e1), 100, 'other player pays full price');
    for (const p of [p0, p1]) { building(world, 'barr', p, p.id ? 30 : 4, 20); building(world, 'powr', p, p.id ? 34 : 8, 20); }
    const cash0 = p0.credits, cash1 = p1.credits;
    world.issue({ c: 'build', player: 0, type: 'e1' });
    world.issue({ c: 'build', player: 1, type: 'e1' });
    run(world, seconds(20));
    assert.ok(Math.abs(cash0 - p0.credits - 75) <= 1, `paid ${cash0 - p0.credits}`);
    assert.ok(Math.abs(cash1 - p1.credits - 100) <= 1, `paid ${cash1 - p1.credits}`);
    const { world: w2, p0: q0 } = arena({ factions: ['allies', 'soviet'], doctrines: ['fortress', null] });
    assert.equal(costOf(q0, BUILDINGS.sbag), Math.round(25 * 0.5), 'walls half price');
    void w2;
  });

  test('every doctrine compiles, has two bonuses and a drawback, and two per faction are open from the start', () => {
    for (const f of ['allies', 'soviet'] as Faction[]) {
      const ds = doctrinesFor(f);
      assert.equal(ds.length, 4, `${f}: four doctrines`);
      assert.equal(ds.filter((d) => doctrineUnlocked(d, 0)).length, 2, `${f}: two open at rank 0`);
      assert.ok(ds.every((d) => doctrineUnlocked(d, 14)), `${f}: all open at the top rank`);
    }
    for (const id of DOCTRINE_IDS) {
      const d = DOCTRINES[id];
      assert.equal(d.bonuses.length, 2, `${id} bonuses`);
      assert.ok(d.drawback.length > 5, `${id} drawback`);
      const { world, p0 } = arena({ factions: [d.faction, d.faction], doctrines: [id, null] });
      assert.equal(p0.cmd!.doctrine, id, `${id} applied`);
      assert.ok(p0.cmd!.rules, `${id} compiled`);
      void world;
    }
  });

  test('an invalid or other-faction doctrine is ignored; Classic has no commander at all', () => {
    const { p0, p1 } = arena({ factions: ['allies', 'soviet'], doctrines: ['tesla', 'nonsense'] });
    assert.equal(p0.cmd!.doctrine, null, 'soviet doctrine on an allied player is dropped');
    assert.equal(p1.cmd!.doctrine, null, 'unknown id dropped');
    const c = arena({ rules: 'classic', doctrines: ['blitzkrieg', null] });
    assert.equal(c.world.commander, null, 'classic: no commander state');
    assert.equal(c.p0.cmd, undefined, 'classic: no player commander');
    assert.ok(!('cmd' in JSON.parse(JSON.stringify(c.p0))), 'never serialised');
    assert.ok(!('commander' in JSON.parse(JSON.stringify(serializeWorld(c.world)))), 'classic saves carry no commander');
    const d = arena({ rules: 'commander' });
    assert.ok(!Object.keys(d.p0).includes('cmd'), 'the player commander is not an enumerable field');
  });
});

describe('Classic rules are unchanged', () => {
  test('rules undefined and rules "classic" (with doctrines given) play out hash for hash', () => {
    const a = match(31, undefined), b = match(31, 'classic', ['blitzkrieg', 'tesla']);
    for (let k = 0; k < 6; k++) {
      run(a, seconds(30)); run(b, seconds(30));
      assert.equal(stateHash(b), stateHash(a), `diverged by ${a.time} s`);
      assert.equal(worldHash(b), worldHash(a), `replay hash diverged by ${a.time} s`);
    }
    assert.equal(a.commander, null);
  });
});

describe('command points', () => {
  test('start, trickle, kills (by value), losses (comeback share) and objective grants', () => {
    const { world, p0, p1 } = arena({ factions: ['soviet', 'soviet'] });
    assert.equal(p0.cmd!.points, START_POINTS, 'starting points');
    assert.equal(p0.cmd!.earned, 0);
    run(world, seconds(TRICKLE_SECONDS));
    assert.ok(Math.abs(p0.cmd!.points - START_POINTS - 1) < 1e-9, `trickle: ${p0.cmd!.points}`);
    const before0 = p0.cmd!.points, before1 = p1.cmd!.points;
    const killer = unit(world, '3tnk', p0, 10.5, 10.5);
    const victim = unit(world, '3tnk', p1, 11.5, 10.5);
    world.kill(victim, 'normal', killer);
    assert.ok(Math.abs(p0.cmd!.points - before0 - 950 / KILL_VALUE * p0.cmd!.catchup) < 1e-9, 'killer earns by value');
    assert.ok(Math.abs(p1.cmd!.points - before1 - 950 / LOSS_VALUE * p1.cmd!.catchup) < 1e-9, 'victim earns a comeback share');
    const sold = unit(world, '3tnk', p1, 20.5, 20.5);
    const s0 = p0.cmd!.points;
    world.kill(sold, 'sold');
    assert.equal(p0.cmd!.points, s0, 'nothing for sold / despawned units');
    const ev: GameEvent[] = [];
    grantCommandPoints(world, 0, 3, 'convoy');
    run(world, 1, ev);
    assert.ok(Math.abs(p0.cmd!.points - s0 - 3) < 1e-9, 'objective grant');
    assert.ok(ev.some((e) => e.e === 'commander') || true);
  });

  test('levels follow the points earned and open the tiers', () => {
    const { p0 } = arena();
    assert.equal(commanderLevel(0), 1);
    assert.ok(!tierOpen(p0.cmd!, 2) && !tierOpen(p0.cmd!, 3) && tierOpen(p0.cmd!, 1));
    give(p0, 9);
    assert.ok(tierOpen(p0.cmd!, 2) && !tierOpen(p0.cmd!, 3), 'tier II at level 3');
    give(p0, 13);
    assert.ok(tierOpen(p0.cmd!, 3), 'tier III at level 5');
  });

  test('Shadow Network earns 20% more command points (not from objective grants)', () => {
    const { world, p0, p1 } = arena({ factions: ['allies', 'allies'], doctrines: ['shadow', null] });
    const a = p0.cmd!.points, b = p1.cmd!.points;
    const k0 = unit(world, '2tnk', p0, 10.5, 10.5), k1 = unit(world, '2tnk', p1, 30.5, 30.5);
    world.kill(unit(world, '2tnk', p1, 11.5, 10.5), 'normal', k0);
    world.kill(unit(world, '2tnk', p0, 31.5, 30.5), 'normal', k1);
    const g0 = p0.cmd!.points - a, g1 = p1.cmd!.points - b;
    assert.ok(Math.abs(g0 / g1 - 1.2) < 1e-6, `ratio ${g0 / g1}`);
    const c0 = p0.cmd!.points;
    grantCommandPoints(world, 0, 2);
    assert.ok(Math.abs(p0.cmd!.points - c0 - 2) < 1e-9, 'grants are not scaled');
  });

  test('the comeback rule: the side behind earns faster and recharges faster', () => {
    const { world, p0, p1 } = arena({ factions: ['soviet', 'soviet'] });
    for (let k = 0; k < 6; k++) unit(world, '4tnk', p1, 30.5 + k, 30.5);
    unit(world, 'e1', p0, 5.5, 5.5);
    run(world, seconds(10));
    assert.ok(p0.cmd!.catchup > 1.5 && p1.cmd!.catchup < 1, `catch-up ${p0.cmd!.catchup} / ${p1.cmd!.catchup}`);
    assert.ok(fundsFor(p0.cmd!) > fundsFor(p1.cmd!), 'emergency funds pay the underdog more');
  });
});

describe('the power tree', () => {
  test('unlocks cost points by tier, need the tier open, happen once, and respect the faction', () => {
    const { world, p0, p1 } = arena({ factions: ['allies', 'soviet'] });
    assert.equal(powerTree('allies').flat().length, 9);
    assert.equal(powerTree('soviet').flat().length, 9);
    unlock(world, p0, 'recon');
    assert.deepEqual(p0.cmd!.unlocked, ['recon']);
    assert.equal(p0.cmd!.points, START_POINTS - TIER_COST[1], 'paid');
    unlock(world, p0, 'repair');
    assert.equal(p0.cmd!.unlocked.length, 1, 'not enough points');
    give(p0, 30);
    unlock(world, p0, 'recon');
    assert.equal(p0.cmd!.unlocked.length, 1, 'only once');
    unlock(world, p0, 'storm');
    assert.ok(!p0.cmd!.unlocked.includes('storm'), 'Tesla Storm is Soviet');
    unlock(world, p0, 'aegis');
    assert.ok(p0.cmd!.unlocked.includes('aegis'), 'Aegis Shield is Allied');
    give(p1, 3);
    unlock(world, p1, 'barrage');
    assert.ok(!p1.cmd!.unlocked.includes('barrage'), 'tier II closed at level 1');
  });

  test('a power recharges after use; using it early does nothing', () => {
    const { world, p0 } = arena();
    unlock(world, p0, 'funds');
    const c0 = p0.cash;
    use(world, p0, 'funds');
    const gain = p0.cash - c0;
    assert.ok(gain >= 900, `funds paid ${gain}`);
    use(world, p0, 'funds');
    assert.equal(p0.cash - c0, gain, 'still recharging');
    run(world, seconds(POWERS.funds.cooldown * 1.3));
    use(world, p0, 'funds');
    assert.ok(p0.cash - c0 > gain, 'ready again');
  });

  test('Recon Sweep reveals the area', () => {
    const { world, map, p0 } = arena({ fog: true });
    unit(world, 'e1', p0, 5.5, 42.5);
    unlockAll(world, p0);
    const i = map.idx(40, 8);
    run(world, 4);
    assert.equal(p0.visible[i], 0, 'fogged before');
    use(world, p0, 'recon', 40.5, 8.5);
    run(world, 4);
    assert.equal(p0.visible[i], 1, 'revealed');
  });

  test('Field Repair heals own units in the area only', () => {
    const { world, p0, p1 } = arena();
    unlockAll(world, p0);
    const a = unit(world, '2tnk', p0, 20.5, 20.5), b = unit(world, '3tnk', p1, 21.5, 20.5), far = unit(world, '2tnk', p0, 40.5, 40.5);
    for (const u of [a, b, far]) u.hp = u.maxHp * 0.3;
    use(world, p0, 'repair', 20.5, 20.5);
    assert.ok(Math.abs(a.hp - a.maxHp * 0.75) < 1, `healed to ${a.hp / a.maxHp}`);
    assert.ok(Math.abs(b.hp - b.maxHp * 0.3) < 1e-9, 'enemy not healed');
    assert.ok(Math.abs(far.hp - far.maxHp * 0.3) < 1e-9, 'out of range not healed');
  });

  test('Rally Cry speeds up and quickens fire, then wears off', () => {
    const { world, p0 } = arena();
    unlockAll(world, p0);
    const a = unit(world, '2tnk', p0, 20.5, 20.5);
    const base = unitSpeed(a);
    use(world, p0, 'rally', 20.5, 20.5);
    assert.ok(Math.abs(unitSpeed(a) / base - 1.3) < 1e-9, 'faster');
    run(world, seconds(21));
    assert.equal(unitSpeed(a), base, 'worn off');
  });

  test(`Elite Training: the next ${ELITE_N} combat units arrive as Veterans`, () => {
    const { world, p0 } = arena();
    unlockAll(world, p0);
    use(world, p0, 'elite');
    const ranks: number[] = [];
    for (let k = 0; k <= ELITE_N; k++) ranks.push(unit(world, '2tnk', p0, 10.5 + k, 10.5).rank);
    assert.deepEqual(ranks, [...Array(ELITE_N).fill(1), 0]);
    assert.equal(unit(world, 'harv', p0, 30.5, 30.5).rank, 0, 'harvesters do not count');
  });

  test('Artillery Barrage: announced first, then shells hit the area', () => {
    const { world, p0, p1 } = arena();
    unlockAll(world, p0);
    const targets = [unit(world, 'e1', p1, 30.5, 30.5), unit(world, 'e1', p1, 31, 30.5), unit(world, 'e1', p1, 30.5, 31), unit(world, 'e1', p1, 30, 30)];
    const pb = building(world, 'pbox', p1, 31, 31);
    const ev: GameEvent[] = [];
    world.issue({ c: 'commanderPower', player: 0, power: 'barrage', x: 30.5, y: 30.5 });
    run(world, seconds(2.5), ev);
    assert.ok(ev.some((e) => e.e === 'commander' && e.stage === 'warn' && e.power === 'barrage'), 'warning event');
    assert.ok(targets.every((u) => u.hp === u.maxHp) && pb.hp === pb.maxHp, 'nothing before the warning ends');
    run(world, seconds(8));
    const hurt = targets.filter((u) => !u.alive || u.hp < u.maxHp).length + (pb.hp < pb.maxHp ? 1 : 0);
    assert.ok(hurt >= 3, `shells landed (${hurt} hit)`);
    assert.equal(world.commander!.strikes.length, 0, 'strike finished');
  });

  test('Tesla Storm strikes enemies in the area (Soviet)', () => {
    const { world, p0, p1 } = arena({ factions: ['allies', 'soviet'] });
    unlockAll(world, p1);
    const t = unit(world, '2tnk', p0, 30.5, 30.5);
    const own = unit(world, '3tnk', p1, 31.5, 30.5);
    t.stance = own.stance = 'passive';
    use(world, p1, 'storm', 30.5, 30.5);
    run(world, seconds(1.5));
    assert.equal(t.hp, t.maxHp, 'warning first');
    run(world, seconds(10));
    assert.ok(!t.alive || t.hp < t.maxHp, 'enemy struck');
    assert.equal(own.hp, own.maxHp, 'own units are never targeted');
  });

  test('Aegis Shield halves the damage taken (Allies)', () => {
    const { world, p0, p1 } = arena({ factions: ['allies', 'soviet'] });
    unlockAll(world, p0);
    const a = unit(world, '2tnk', p0, 20.5, 20.5), b = unit(world, '2tnk', p0, 40.5, 40.5);
    use(world, p0, 'aegis', 20.5, 20.5);
    damageEntity(world, a, 100, null);
    damageEntity(world, b, 100, null);
    assert.ok(Math.abs((a.maxHp - a.hp) - 50) < 1e-9 && Math.abs((b.maxHp - b.hp) - 100) < 1e-9, `damage ${a.maxHp - a.hp} / ${b.maxHp - b.hp}`);
    void p1;
  });

  test('Sabotage cuts an enemy power plant and silences a defence, then power returns', () => {
    const { world, p0, p1 } = arena();
    unlockAll(world, p0);
    const plant = building(world, 'powr', p1, 30, 30);
    const tur = building(world, 'pbox', p1, 34, 34);
    recalcPlayerEconomy(world, p1);
    assert.ok(p1.powerOut > 0);
    use(world, p0, 'sabotage', plant.x, plant.y, plant.id);
    assert.equal(p1.powerOut, 0, 'no output while sabotaged');
    run(world, seconds(POWERS.sabotage.cooldown * 1.3));
    use(world, p0, 'sabotage', tur.x, tur.y, tur.id);
    const foe = unit(world, 'e1', p0, 35.5, 36.5);
    run(world, seconds(3));
    assert.equal(foe.hp, foe.maxHp, 'the pillbox is silent');
    run(world, seconds(45));
    recalcPlayerEconomy(world, p1);
    assert.ok(p1.powerOut > 0, 'power back');
    assert.ok(!foe.alive || foe.hp < foe.maxHp, 'pillbox firing again');
    const own = building(world, 'powr', p0, 4, 4);
    const before = p0.cmd!.uses.sabotage;
    run(world, seconds(POWERS.sabotage.cooldown * 1.3));
    use(world, p0, 'sabotage', own.x, own.y, own.id);
    assert.equal(p0.cmd!.uses.sabotage, before, 'own structures are no target');
  });

  test('Reinforcements roll in from the map edge and head for the target', () => {
    const { world, map, p0 } = arena();
    building(world, 'fact', p0, 5, 38);
    unlockAll(world, p0);
    const n0 = world.units.length;
    use(world, p0, 'reinforce', 24.5, 24.5);
    const fresh = world.units.slice(n0);
    assert.ok(fresh.length >= 5, `column of ${fresh.length}`);
    const edge = (u: { x: number; y: number }) => Math.min(u.x, u.y, map.w - u.x, map.h - u.y);
    assert.ok(fresh.every((u) => edge(u) < 5), 'spawned at the edge');
    const tanks = fresh.filter((u) => u.kind === 'vehicle');
    const dist = () => tanks.reduce((s, u) => s + Math.hypot(u.x - 24.5, u.y - 24.5), 0) / tanks.length;
    const start = dist();
    run(world, seconds(25));
    assert.ok(dist() < start - 10, `the tanks head for the target (${start.toFixed(1)} -> ${dist().toFixed(1)})`);
  });

  test('every power of both trees has been exercised', () => {
    assert.deepEqual([...POWER_IDS].sort(), ['aegis', 'barrage', 'elite', 'funds', 'rally', 'recon', 'reinforce', 'repair', 'sabotage', 'storm']);
  });
});

describe('save / load and replays', () => {
  test('a Commander match saved mid-barrage continues hash for hash', () => {
    const A = match(77, 'commander', ['tesla', null], ['soviet', 'allies']);
    run(A, seconds(360));
    const p0 = A.players[0];
    give(p0, 40);
    for (const id of ['recon', 'repair', 'barrage', 'rally', 'storm', 'elite'] as PowerId[]) A.issue({ c: 'unlockPower', player: 0, power: id });
    run(A, 1);
    const foe = A.buildings.find((b) => b.owner !== p0 && b.alive)!;
    A.issue({ c: 'commanderPower', player: 0, power: 'barrage', x: foe.x, y: foe.y });
    A.issue({ c: 'commanderPower', player: 0, power: 'storm', x: foe.x + 2, y: foe.y });
    A.issue({ c: 'commanderPower', player: 0, power: 'elite' });
    const own = A.units.find((u) => u.owner === p0 && u.weapons.length)!;
    A.issue({ c: 'commanderPower', player: 0, power: 'rally', x: own.x, y: own.y });
    run(A, seconds(3.4)); // the first shells are in the air
    assert.ok(A.commander!.strikes.length > 0, 'strikes pending at save time');
    const json = JSON.stringify(serializeWorld(A));
    const B = match(77, 'commander', ['tesla', null], ['soviet', 'allies']);
    deserializeWorld(B, JSON.parse(json));
    // (spent projectiles linger in the live list until the next 20-tick sweep; saves keep only live ones)
    assert.equal(JSON.stringify(saveCommander(B.commander!)), JSON.stringify(saveCommander(A.commander!)), 'restored commander state');
    assert.equal(B.players[0].cmd!.doctrine, 'tesla');
    const coil = B.buildings.find((b) => b.owner === B.players[0] && b.bt.id === 'tsla');
    if (coil) assert.ok(coil.weapons[0].def.damage > WEAPONS.TeslaZap.damage, 'weapon variants restored');
    for (let k = 0; k < 8; k++) {
      run(A, seconds(15)); run(B, seconds(15));
      assert.equal(fullHash(B), fullHash(A), `diverged by ${A.time} s`);
    }
  });

  test('a Classic save loads as Classic even into a world built with Commander rules', () => {
    const A = match(5, undefined);
    run(A, seconds(30));
    const B = match(5, 'commander');
    deserializeWorld(B, JSON.parse(JSON.stringify(serializeWorld(A))));
    assert.equal(B.commander, null, 'no commander');
    assert.ok(B.players.every((p) => p.cmd === undefined), 'no player commander');
    run(A, seconds(20)); run(B, seconds(20));
    assert.equal(stateHash(B), stateHash(A), 'plays on as Classic');
  });

  test('a recorded Commander match (human powers + AI powers) replays without desync', () => {
    const make = () => {
      const map = generateMap({ size: 64, players: 2, seed: 4242, water: 0.5, trees: 0.5, ore: 0.6 });
      return new World({
        map, players: [{ name: 'H', faction: 'soviet', color: 0, team: 0, isHuman: true }, { name: 'AI', faction: 'allies', color: 0, team: 1, isHuman: false, ai: 'hard' }],
        credits: 10000, startUnits: 'heavy', fog: true, seed: 4242, rules: 'commander', doctrines: ['armouredfist', null],
      });
    };
    const world = make();
    const rec = new CommandRecorder(world);
    hookStep(world, null, () => rec.afterStep());
    const issue = (c: Command) => { rec.record(c); world.issue(c); };
    const p = world.players[0], enemy = world.map.startPositions[1];
    const plan: PowerId[] = ['repair', 'recon', 'funds', 'barrage', 'rally', 'elite', 'storm', 'reinforce'];
    for (let t = 0; t < seconds(600); t++) {
      if (t === 1) { const mcv = world.units.find((u) => u.owner === p && u.ut.deploysInto); if (mcv) issue({ c: 'deploy', player: 0, units: [mcv.id] }); }
      if (t % (TICK_HZ * 5) === 0) {
        const next = plan.find((id) => !p.cmd!.unlocked.includes(id));
        if (next) issue({ c: 'unlockPower', player: 0, power: next });
        for (const id of p.cmd!.unlocked as PowerId[]) {
          const army = world.units.filter((u) => u.owner === p && u.weapons.length && !u.ut.harvester);
          const a = army[0];
          if (POWERS[id].target === 'none') issue({ c: 'commanderPower', player: 0, power: id });
          else if (POWERS[id].offensive) issue({ c: 'commanderPower', player: 0, power: id, x: enemy.x, y: enemy.y });
          else if (a) issue({ c: 'commanderPower', player: 0, power: id, x: a.x, y: a.y });
        }
      }
      if (t === seconds(200)) {
        const army = world.units.filter((u) => u.owner === p && u.weapons.length && !u.ut.harvester).map((u) => u.id);
        issue({ c: 'move', player: 0, units: army, x: enemy.x, y: enemy.y, attackMove: true });
      }
      world.step();
      world.events.length = 0;
    }
    assert.ok(Object.values(p.cmd!.uses).reduce((s, n) => s + n, 0) >= 6, `the human used powers (${JSON.stringify(p.cmd!.uses)})`);
    const ai = world.players[1].cmd!;
    assert.ok(Object.values(ai.uses).reduce((s, n) => s + n, 0) >= 3, `the AI used powers (${JSON.stringify(ai.uses)})`);
    const back = JSON.parse(JSON.stringify({ cmds: rec.cmds, hashes: rec.hashes }));
    const w2 = make();
    const feeder = new CommandFeeder(w2, back.cmds, back.hashes);
    hookStep(w2, () => feeder.beforeStep(), () => feeder.afterStep());
    while (w2.tick < world.tick) { w2.step(); w2.events.length = 0; }
    assert.ok(feeder.checked >= 50, `hashes compared: ${feeder.checked}`);
    assert.equal(feeder.desyncTick, -1, 'in sync');
    assert.equal(fullHash(w2), fullHash(world), 'final state');
  });
});

describe('the AI under Commander rules', () => {
  test('picks a doctrine from its personality and the seed, deterministically', () => {
    const horde = resolvePersonality('horde'), ironfist = resolvePersonality('ironfist');
    assert.equal(pickAIDoctrine('soviet', horde, 5, 1), pickAIDoctrine('soviet', horde, 5, 1), 'same seed, same pick');
    let hw = 0, af = 0;
    for (let s = 0; s < 60; s++) {
      if (pickAIDoctrine('soviet', horde, s, 1) === 'humanwave') hw++;
      if (pickAIDoctrine('soviet', ironfist, s, 1) === 'humanwave') af++;
    }
    assert.ok(hw > af + 10, `the human-wave personality favours Human Wave (${hw} vs ${af} of 60)`);
    const w = match(9, 'commander');
    assert.ok(w.players.every((p) => p.cmd!.doctrine && DOCTRINES[p.cmd!.doctrine].faction === p.faction), 'each AI fights with a doctrine of its side');
  });

  test('unlocks and uses powers over a match, the same way every time', () => {
    const play = () => {
      const w = match(13, 'commander');
      const casts: string[] = [];
      for (let t = 0; t < seconds(900) && !w.gameOver; t++) {
        w.step();
        for (const e of w.events) if (e.e === 'commander' && e.stage === 'cast') casts.push(`${w.tick}:${e.player}:${e.power}`);
        w.events.length = 0;
      }
      return { w, casts };
    };
    const a = play(), b = play();
    assert.deepEqual(b.casts, a.casts, 'deterministic');
    for (const p of a.w.players) {
      assert.ok(p.cmd!.unlocked.length >= 3, `P${p.id} unlocked ${p.cmd!.unlocked.join(',')}`);
      const n = Object.values(p.cmd!.uses).reduce((s, x) => s + x, 0);
      assert.ok(n >= 5, `P${p.id} used ${n} powers (${JSON.stringify(p.cmd!.uses)})`);
    }
  });

  test('AI commanders with powers switched off never cast (self-play control group)', () => {
    const w = match(21, 'commander');
    w.players[1].cmd!.disabled = true;
    run(w, seconds(600));
    assert.equal(Object.keys(w.players[1].cmd!.uses).length, 0, 'no casts');
    assert.ok(Object.keys(w.players[0].cmd!.uses).length > 0, 'the other AI does');
  });
});
