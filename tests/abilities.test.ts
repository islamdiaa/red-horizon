// Special abilities: engineers, APC transport, aircraft rearming, veterancy, superweapons,
// Tanya's C4, medics, service depot, selling.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ENGINEER_CAPTURE_LEVEL, REFUND_PERCENT, BUILDINGS } from '../src/data/rules';
import { damageEntity, impact } from '../src/sim/combat';
import { sandbox, building, unit, run, runUntil, seconds, powerUp, type GameEvent } from './helpers';
import { STRUCTURE_REPAIR_PERCENT } from '../src/sim/world';

describe('engineers', () => {
  function engineerSetup(hpFrac: number) {
    const s = sandbox();
    const { world, p0, p1 } = s;
    building(world, 'fact', p1, 30, 30);
    const target = building(world, 'weap', p1, 20, 20);
    target.hp = target.maxHp * hpFrac;
    const eng = unit(world, 'e6', p0, 15.5, 21.5);
    world.issue({ c: 'attack', player: p0.id, units: [eng.id], target: target.id });
    return { ...s, target, eng };
  }

  test(`capture an enemy structure at <= ${ENGINEER_CAPTURE_LEVEL * 100}% health`, () => {
    const { world, p0, p1, target, eng } = engineerSetup(0.2);
    run(world, 1); // commands apply on the next tick
    assert.equal(eng.order.type, 'enter', 'attack on a building becomes enter');
    const events: GameEvent[] = [];
    const t = runUntil(world, () => target.owner === p0, seconds(20), events);
    assert.ok(t > 0, 'captured');
    assert.equal(eng.alive, false, 'engineer is consumed');
    assert.ok(events.some((e) => e.e === 'captured' && e.id === target.id && e.from === p1.id && e.to === p0.id), 'captured event');
    assert.ok(p0.has('weap') && !p1.has('weap'), 'ownership counts move over');
    run(world, seconds(1));
    assert.equal(target.owner, p0, 'stays captured');
  });

  test('above the capture level the engineer damages the structure by a third instead', () => {
    const { world, p1, target, eng } = engineerSetup(0.8);
    const hp = target.hp;
    const t = runUntil(world, () => !eng.alive, seconds(20));
    assert.ok(t > 0, 'engineer went in');
    assert.equal(target.owner, p1, 'not captured');
    assert.ok(Math.abs(hp - target.hp - target.maxHp / 3) < 1e-6, `lost a third (${hp} -> ${target.hp})`);
  });

  test('engineers fully repair a friendly structure', () => {
    const { world, p0 } = sandbox();
    const b = building(world, 'weap', p0, 20, 20);
    b.hp = 100;
    const eng = unit(world, 'e6', p0, 15.5, 21.5);
    world.issue({ c: 'enter', player: p0.id, units: [eng.id], target: b.id });
    const t = runUntil(world, () => !eng.alive, seconds(20));
    assert.ok(t > 0, 'entered');
    assert.equal(b.hp, b.maxHp);
  });
});

describe('APC transport', () => {
  test('infantry board, ride along and unload next to the APC', () => {
    const { world, p0 } = sandbox();
    const apc = unit(world, 'apc', p0, 20.5, 20.5);
    const squad = [unit(world, 'e1', p0, 16.5, 20.5), unit(world, 'e3', p0, 16.5, 21.5), unit(world, 'e6', p0, 17.5, 22.5)];
    world.issue({ c: 'enter', player: p0.id, units: squad.map((u) => u.id), target: apc.id });
    const t = runUntil(world, () => apc.passengers.length === 3, seconds(15));
    assert.ok(t > 0, 'all boarded');
    for (const u of squad) {
      assert.equal(u.transport, apc.id);
      assert.ok(!world.units.includes(u), 'passengers leave the unit list');
      assert.ok(world.getEntity(u.id), 'but stay registered');
    }
    world.issue({ c: 'move', player: p0.id, units: [apc.id], x: 30.5, y: 20.5 });
    runUntil(world, () => apc.order.type === 'idle' && !apc.moving, seconds(20));
    assert.ok(apc.x > 29, 'APC drove off');
    world.issue({ c: 'deploy', player: p0.id, units: [apc.id] });
    run(world, 1);
    assert.equal(apc.passengers.length, 0);
    for (const u of squad) {
      assert.equal(u.transport, 0);
      assert.ok(world.units.includes(u), 'back on the map');
      assert.ok(Math.hypot(u.x - apc.x, u.y - apc.y) < 3, 'next to the APC');
      assert.ok(world.map.passable(Math.floor(u.x), Math.floor(u.y)), 'on passable ground');
    }
  });

  test('capacity is five; vehicles cannot board', () => {
    const { world, p0 } = sandbox();
    const apc = unit(world, 'apc', p0, 20.5, 20.5);
    const inf = Array.from({ length: 7 }, (_, k) => unit(world, 'e1', p0, 15.5, 16.5 + k));
    const tank = unit(world, '2tnk', p0, 24.5, 20.5);
    world.issue({ c: 'enter', player: p0.id, units: [...inf, tank].map((u) => u.id), target: apc.id });
    run(world, seconds(15));
    assert.equal(apc.passengers.length, 5);
    assert.equal(tank.transport, 0);
    assert.equal(inf.filter((u) => u.transport === 0).length, 2);
  });

  test('passengers die with the APC', () => {
    const { world, p0, p1 } = sandbox();
    const apc = unit(world, 'apc', p0, 20.5, 20.5);
    const inf = unit(world, 'e1', p0, 20.5, 21.3);
    world.issue({ c: 'enter', player: p0.id, units: [inf.id], target: apc.id });
    runUntil(world, () => inf.transport === apc.id, seconds(5));
    const killer = unit(world, '3tnk', p1, 40.5, 40.5);
    damageEntity(world, apc, 10000, killer);
    run(world, 1);
    assert.equal(apc.alive, false);
    assert.equal(inf.alive, false);
    assert.equal(world.getEntity(inf.id), undefined);
    assert.equal(p0.stats.unitsLost, 2);
  });
});

describe('aircraft', () => {
  test('helicopters return to their pad and stay until fully rearmed (one missile per 0.7 s)', () => {
    const s = sandbox();
    const { world, p0 } = s;
    const pad = building(world, 'hpad', p0, 20, 20);
    const heli = unit(world, 'heli', p0, 28.5, 24.5);
    heli.altitude = 1.55;
    heli.ammo = 0;
    heli.homePad = pad.id;
    const t = runUntil(world, () => heli.altitude === 0, seconds(20));
    assert.ok(t > 0, 'landed');
    assert.ok(Math.hypot(heli.x - pad.x, heli.y - pad.y) < 0.6, 'on the pad');
    const t2 = runUntil(world, () => heli.ammo === 6, seconds(10));
    assert.ok(t2 > 0, 'fully rearmed');
    assert.ok(Math.abs(t2 - seconds(6 * 0.7)) <= 3, `6 x 0.7 s, took ${(t2 / 20).toFixed(2)} s`);
  });

  test('a helicopter lands on its pad and starts reloading', () => {
    const { world, p0 } = sandbox();
    const pad = building(world, 'hpad', p0, 20, 20);
    const heli = unit(world, 'heli', p0, 28.5, 24.5);
    heli.altitude = 1.55;
    heli.ammo = 0;
    heli.homePad = pad.id;
    const t = runUntil(world, () => heli.altitude === 0, seconds(20));
    assert.ok(t > 0, 'landed');
    assert.ok(Math.hypot(heli.x - pad.x, heli.y - pad.y) < 0.6, 'on the pad');
    const t2 = runUntil(world, () => heli.ammo >= 1, seconds(2));
    assert.ok(t2 > 0 && t2 <= seconds(0.7) + 1, `first round after 0.7 s (${t2} ticks)`);
  });

  test('an attack run uses up ammo and the aircraft flies home empty', () => {
    const s = sandbox({ factions: ['soviet', 'allies'] });
    const { world, p0, p1 } = s;
    const field = building(world, 'afld', p0, 6, 6);
    const yak = unit(world, 'yak', p0, field.x, field.y);
    yak.homePad = field.id;
    const target = unit(world, '2tnk', p1, 30.5, 30.5);
    world.issue({ c: 'attack', player: p0.id, units: [yak.id], target: target.id });
    const t = runUntil(world, () => yak.ammo === 0, seconds(60));
    assert.ok(t > 0, 'emptied its guns');
    assert.ok(target.hp < target.maxHp, 'did damage');
    const back = runUntil(world, () => yak.altitude === 0, seconds(60));
    assert.ok(back > 0, 'landed again');
    assert.ok(Math.hypot(yak.x - field.x, yak.y - field.y) < 0.6, 'on its airfield');
    const full = runUntil(world, () => yak.ammo === 15, seconds(15));
    assert.ok(full > 0, `planes stay down until fully rearmed (ammo ${yak.ammo})`);
    assert.equal(yak.altitude, 0, 'still parked');
  });

  test('ground-only weapons cannot hit flying aircraft; AA can', () => {
    const s = sandbox();
    const { world, p0, p1 } = s;
    building(world, 'powr', p0, 4, 4);
    const tank = unit(world, '2tnk', p0, 20.5, 20.5);
    const agun = building(world, 'agun', p0, 22, 18);
    const hind = unit(world, 'hind', p1, 21.5, 20.5);
    hind.altitude = 1.55;
    hind.ammo = 0; // passive
    world.issue({ c: 'move', player: p1.id, units: [hind.id], x: 21.5, y: 20.5 });
    const events: GameEvent[] = [];
    runUntil(world, () => hind.hp < hind.maxHp, seconds(10), events);
    assert.ok(!events.some((e) => e.e === 'fire' && e.shooter === tank.id), 'tank never fires at the helicopter');
    assert.ok(events.some((e) => e.e === 'fire' && e.shooter === agun.id), 'AA gun does');
  });
});

describe('veterancy', () => {
  test('kills worth the unit cost promote to veteran, three times that to elite', () => {
    const { world, p0, p1 } = sandbox();
    const tank = unit(world, '2tnk', p0, 10.5, 10.5); // 800
    const events: GameEvent[] = [];
    world.kill(unit(world, '1tnk', p1, 30.5, 30.5), 'normal', tank); // 700
    assert.equal(tank.rank, 0);
    world.kill(unit(world, 'e1', p1, 30.5, 31.5), 'normal', tank); // +100 = 800
    assert.equal(tank.rank, 1, 'veteran');
    events.push(...world.events);
    assert.ok(events.some((e) => e.e === 'promoted' && e.id === tank.id && e.rank === 1), 'promotion event');
    world.kill(unit(world, '4tnk', p1, 30.5, 32.5), 'normal', tank); // 800 + 1700 = 2500 >= 3 x 800
    assert.equal(tank.rank, 2, 'elite');
    // buildings give 60 % of their cost
    const rifle = unit(world, 'e1', p0, 12.5, 10.5); // vet at 300
    world.kill(building(world, 'powr', p1, 40, 40), 'normal', rifle); // 300 * 0.6 = 180
    assert.equal(rifle.rank, 0);
    world.kill(building(world, 'powr', p1, 40, 43), 'normal', rifle); // 360
    assert.equal(rifle.rank, 1);
  });

  test('promotion heals 25 %, ranks shoot faster and harder and take less damage', () => {
    const { world, p0, p1 } = sandbox();
    const tank = unit(world, '2tnk', p0, 10.5, 10.5);
    tank.hp = 100;
    world.grantXp(tank, 800);
    assert.equal(tank.hp, 200);
    // elite takes 24 % less damage and deals 30 % more
    const vet = unit(world, '3tnk', p1, 20.5, 10.5);
    const rookie = unit(world, '3tnk', p1, 20.5, 14.5);
    vet.rank = 2;
    const shooter = unit(world, '2tnk', p0, 16.5, 10.5);
    shooter.rank = 2;
    world.events.length = 0;
    const before = [vet.hp, rookie.hp];
    // direct hits through the normal impact path
    impact(world, shooter.weapons[0].def, shooter, vet, vet.x, vet.y, 0);
    impact(world, shooter.weapons[0].def, null, rookie, rookie.x, rookie.y, 0);
    const dv = before[0] - vet.hp, dr = before[1] - rookie.hp;
    assert.ok(Math.abs(dr - 30) < 1e-6, `rookie took the raw 30 (${dr})`);
    assert.ok(Math.abs(dv - 30 * 1.3 * (1 - 0.24)) < 1e-6, `elite vs elite: ${dv}`);
  });

  test('elite units slowly self-repair out of combat', () => {
    const { world, p0 } = sandbox();
    const tank = unit(world, '2tnk', p0, 10.5, 10.5);
    tank.rank = 2;
    tank.hp = 200;
    run(world, seconds(10));
    assert.ok(tank.hp > 200, `repaired to ${tank.hp}`);
  });
});

describe('superweapons', () => {
  function sw(kind: 'nuke' | 'chrono' | 'ironcurtain') {
    const s = sandbox({ factions: kind === 'ironcurtain' ? ['soviet', 'allies'] : ['allies', 'soviet'] });
    const { world, p0 } = s;
    powerUp(world, p0, 2, 2, 3);
    const type = kind === 'nuke' ? 'mslo' : kind === 'chrono' ? 'pdox' : 'iron';
    const b = building(world, type, p0, 2, 6);
    p0.superCharge[kind] = BUILDINGS[type].superCharge!;
    return { ...s, b };
  }

  test('a ready nuke launches, flies and devastates the target area', () => {
    const { world, p0, p1 } = sw('nuke');
    const victims = [unit(world, 'e1', p1, 30.5, 30.5), unit(world, '3tnk', p1, 31.5, 30.5), unit(world, 'e1', p1, 33.5, 32.5)];
    const bld = building(world, 'powr', p1, 29, 28);
    const far = unit(world, 'e1', p1, 40.5, 40.5);
    const events: GameEvent[] = [];
    world.issue({ c: 'superweapon', player: p0.id, kind: 'nuke', x: 30.5, y: 30.5 });
    run(world, 1, events);
    assert.ok(p0.superCharge.nuke < 0.1, `charge spent (${p0.superCharge.nuke})`);
    assert.ok(events.some((e) => e.e === 'nuke' && e.stage === 'launch'), 'launch event');
    assert.ok(world.projectiles.some((p) => p.special === 'nuke'), 'missile in flight');
    const t = runUntil(world, () => !world.projectiles.some((p) => p.alive && p.special === 'nuke'), seconds(20), events);
    assert.ok(t > seconds(4), `flight time ${t / 20}s`);
    assert.ok(events.some((e) => e.e === 'impact' && e.kind === 'nuke'), 'nuclear impact event');
    // infantry is vaporised; heavy armour (Nuke warhead 25 % vs heavy, as in RA) survives badly mauled
    for (const v of victims) {
      if (v.kind === 'infantry') assert.equal(v.alive, false, `${v.ut.id} at ground zero vaporised`);
      else assert.ok(!v.alive || v.hp < v.maxHp * 0.25, `${v.ut.id} wrecked (${v.hp} hp left)`);
    }
    assert.ok(bld.hp < bld.maxHp * 0.2, `structure wrecked (${bld.hp})`);
    assert.equal(far.hp, far.maxHp, 'outside the 4.5-cell radius unharmed');
  });

  test('superweapons cannot fire before they are charged', () => {
    const { world, p0 } = sw('nuke');
    p0.superCharge.nuke = 100;
    world.issue({ c: 'superweapon', player: p0.id, kind: 'nuke', x: 30.5, y: 30.5 });
    run(world, 1);
    assert.ok(!world.projectiles.some((p) => p.special === 'nuke'), 'nothing launched');
  });

  test('the Chronosphere teleports one of our vehicles to passable ground', () => {
    const { world, p0, map } = sw('chrono');
    const tank = unit(world, '2tnk', p0, 10.5, 30.5);
    const events: GameEvent[] = [];
    // water target is refused (charge kept)
    map.terrain[map.idx(40, 10)] = 1;
    world.issue({ c: 'superweapon', player: p0.id, kind: 'chrono', x: 40.5, y: 10.5, unit: tank.id });
    run(world, 1, events);
    assert.ok(Math.abs(tank.x - 10.5) < 0.1, 'not moved onto water');
    assert.ok(p0.superCharge.chrono > 0, 'charge kept');
    world.issue({ c: 'superweapon', player: p0.id, kind: 'chrono', x: 38.2, y: 12.7, unit: tank.id });
    run(world, 1, events);
    assert.deepEqual([tank.x, tank.y], [38.5, 12.5], 'teleported to the cell centre');
    assert.ok(p0.superCharge.chrono < 0.1, 'charge spent');
    assert.ok(events.some((e) => e.e === 'teleport' && e.id === tank.id), 'teleport event');
    // infantry cannot be chronoshifted
    p0.superCharge.chrono = 240;
    const inf = unit(world, 'e1', p0, 10.5, 32.5);
    world.issue({ c: 'superweapon', player: p0.id, kind: 'chrono', x: 20.5, y: 20.5, unit: inf.id });
    run(world, 1);
    assert.ok(Math.abs(inf.x - 10.5) < 0.5 && p0.superCharge.chrono >= 240, 'infantry refused');
  });

  test('the Iron Curtain makes units invulnerable for a while', () => {
    const { world, p0, p1 } = sw('ironcurtain');
    const tank = unit(world, '3tnk', p0, 20.5, 20.5);
    const other = unit(world, '3tnk', p0, 30.5, 20.5);
    world.issue({ c: 'superweapon', player: p0.id, kind: 'ironcurtain', x: 20.5, y: 20.5 });
    run(world, 1);
    assert.ok(tank.invulnerable > 20, 'protected');
    assert.equal(other.invulnerable, 0, 'only units near the target');
    const attacker = unit(world, '2tnk', p1, 40.5, 40.5);
    damageEntity(world, tank, 10000, attacker);
    assert.ok(tank.alive && tank.hp === tank.maxHp, 'ignores damage');
    run(world, seconds(26));
    assert.equal(tank.invulnerable, 0, 'wears off after 25 s');
    damageEntity(world, tank, 50, attacker);
    assert.equal(tank.hp, tank.maxHp - 50);
  });
});

describe('other abilities', () => {
  test("Tanya's C4 destroys a structure after a short fuse", () => {
    const { world, p0, p1 } = sandbox();
    building(world, 'fact', p1, 30, 30);
    const target = building(world, 'powr', p1, 20, 20);
    const tanya = unit(world, 'e7', p0, 16.5, 20.5);
    world.issue({ c: 'attack', player: p0.id, units: [tanya.id], target: target.id });
    const t = runUntil(world, () => !target.alive, seconds(20));
    assert.ok(t > 0, 'demolished');
    assert.ok(tanya.alive, 'Tanya survives');
  });

  test('medics heal wounded friendly infantry', () => {
    const { world, p0 } = sandbox();
    unit(world, 'medi', p0, 10.5, 10.5);
    const hurt = unit(world, 'e1', p0, 12.5, 10.5);
    hurt.hp = 10;
    const t = runUntil(world, () => hurt.hp === hurt.maxHp, seconds(20));
    assert.ok(t > 0, 'healed to full');
  });

  test('the service depot repairs a vehicle parked on its pad, for money', () => {
    const { world, p0 } = sandbox({ credits: 1000 });
    const depot = building(world, 'fix', p0, 20, 20);
    const tank = unit(world, '2tnk', p0, 15.5, 21.5);
    tank.hp = 100;
    world.issue({ c: 'enter', player: p0.id, units: [tank.id], target: depot.id });
    const t = runUntil(world, () => tank.hp === tank.maxHp, seconds(60));
    assert.ok(t > 0, 'fully repaired');
    assert.ok(p0.credits < 1000, 'cost money');
    assert.ok(1000 - p0.credits <= 800 * 0.2 + 1, `cost at most 20 % of the unit price (${1000 - p0.credits})`);
  });

  test('selling refunds half the price whatever the damage and leaves survivors', () => {
    const { world, p0 } = sandbox({ credits: 0 });
    const weap = building(world, 'weap', p0, 20, 20);
    weap.hp = weap.maxHp / 2;
    world.issue({ c: 'sell', player: p0.id, building: weap.id });
    const events: GameEvent[] = [];
    const t = runUntil(world, () => !weap.alive, seconds(3), events);
    assert.ok(t > 0, 'sold');
    assert.equal(p0.cash, Math.floor(2000 * REFUND_PERCENT));
    assert.ok(events.some((e) => e.e === 'death' && e.id === weap.id && e.how === 'sold'), 'sold death event');
    assert.ok(world.units.filter((u) => u.ut.id === 'e1').length >= 1, 'crew walks out');
    assert.ok(world.map.passable(21, 21), 'footprint cleared');
  });

  test('structure repair costs money (20% of the price for a full repair) and stops at full health', () => {
    const { world, p0 } = sandbox({ credits: 500 });
    const b = building(world, 'powr', p0, 20, 20);
    b.hp = 200;
    world.issue({ c: 'repair', player: p0.id, building: b.id });
    const t = runUntil(world, () => !b.repairing, seconds(30));
    assert.ok(t > 0, 'repair finished');
    assert.equal(b.hp, b.maxHp);
    const cost = 500 - p0.credits;
    assert.ok(Math.abs(cost - 300 * STRUCTURE_REPAIR_PERCENT * (200 / 400)) <= 1, `paid ~${cost}`);
  });
});
