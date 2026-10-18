// Aftermath / Counterstrike units: Tesla Tank, M.A.D. Tank, Chrono Tank, Demolition Truck, Shock Trooper,
// Mechanic, Missile Submarine and Phase Transport — their rules, mechanics, AI use, save / load and determinism.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BUILDINGS, CATEGORIES, UNITS, WARHEADS, WEAPONS } from '../src/data/rules';
import { queueKindOf } from '../src/sim/player';
import { serializeWorld, deserializeWorld } from '../src/sim/save';
import {
  AFTERMATH_AI, DEMO_RADIUS, MAD_ARM_SECONDS, MAD_PULSES, MAD_PULSE_SECONDS, MAD_RADIUS, PHASE_DELAY, UNIT_ROLES, aiManaged, healable,
} from '../src/sim/aftermath';
import {
  T, World, building, checkInvariants, paint, powerUp, run, runUntil, sandbox, seconds, skirmish, stateHash, unit,
  type GameEvent, type Unit,
} from './helpers';

const NEW_UNITS = ['ttnk', 'qtnk', 'ctnk', 'dtrk', 'shok', 'mech', 'msub', 'stnk'];

/** Make a unit harmless (no weapons) so a test measures only the mechanic under test. */
function disarm(u: Unit): Unit {
  u.weapons.length = 0;
  return u;
}

// ---------------------------------------------------------------------------
describe('Aftermath rules', () => {
  test('the eight units exist with their RA side, sidebar category, queue, weapon and prerequisites', () => {
    const side: Record<string, string> = { ttnk: 'soviet', qtnk: 'soviet', dtrk: 'soviet', shok: 'soviet', msub: 'soviet', ctnk: 'allies', mech: 'allies', stnk: 'allies' };
    const cat: Record<string, string> = { ttnk: 'vehicle', qtnk: 'vehicle', dtrk: 'vehicle', ctnk: 'vehicle', stnk: 'vehicle', shok: 'infantry', mech: 'infantry', msub: 'naval' };
    for (const id of NEW_UNITS) {
      const t = UNITS[id];
      assert.ok(t, `${id} defined`);
      assert.ok(t.buildable, `${id} buildable`);
      assert.deepEqual(t.owner, [side[id]], `${id} side`);
      assert.equal(t.category, cat[id], `${id} category`);
      assert.ok(CATEGORIES.includes(t.category), `${id} category is a sidebar tab`);
      assert.equal(queueKindOf(t), cat[id] === 'building' ? 'structure' : cat[id], `${id} queue`);
      for (const req of t.prereq) for (const alt of req.split('|')) assert.ok(BUILDINGS[alt], `${id} requires real structure ${alt}`);
      if (t.primary) {
        assert.ok(WEAPONS[t.primary], `${id} weapon ${t.primary}`);
        assert.ok(WARHEADS[WEAPONS[t.primary].warhead], `${t.primary} warhead`);
      }
      assert.ok(UNIT_ROLES[id]?.length, `${id} has AI role tags`);
    }
    assert.equal(UNITS.qtnk.primary, undefined, 'the M.A.D. tank is unarmed');
    assert.equal(WEAPONS.TTankZap.projectile, 'tesla');
    assert.equal(WEAPONS.PortaTesla.warhead, 'Super');
    assert.equal(WEAPONS.GoodWrench.warhead, 'Mechanical');
    assert.ok(WEAPONS.GoodWrench.damage < 0, 'the wrench repairs');
    assert.equal(WEAPONS.APTusk.warhead, 'AP');
    assert.ok(WEAPONS.SubSCUD.range >= 12, 'missile sub out-ranges shore defences');
    assert.equal(UNITS.stnk.passengers, 5, 'phase transport carries five');
    assert.ok(UNITS.msub.cloakable, 'missile sub submerges');
    assert.ok(UNITS.ctnk.chronoShift && UNITS.ctnk.chronoShift > 0, 'chrono tank recharge');
    assert.ok(UNITS.ttnk.jamRadius, 'tesla tank jams radar (UDATA IsJammer)');
  });

  test('tech gating: each unit unlocks with its prerequisites at its own factory', () => {
    const { world, p0, p1 } = sandbox();
    paint(world.map, 30, 2, 40, 10, T.Water);
    for (const [id, x, y] of [['fact', 2, 30], ['powr', 6, 30], ['barr', 9, 30], ['proc', 2, 34], ['weap', 6, 34]] as const) building(world, id, p1, x, y);
    powerUp(world, p1, 2, 40, 3);
    assert.ok(!p1.canBuild('ttnk') && !p1.canBuild('shok'), 'no tesla tech yet');
    building(world, 'tsla', p1, 12, 30);
    assert.ok(p1.canBuild('ttnk') && p1.canBuild('shok'), 'Tesla Coil unlocks the Tesla Tank and Shock Trooper');
    assert.ok(!p1.canBuild('qtnk'), 'M.A.D. tank needs the tech center');
    building(world, 'dome', p1, 14, 34);
    building(world, 'stek', p1, 17, 30);
    assert.ok(p1.canBuild('qtnk'), 'Soviet Tech Center unlocks the M.A.D. Tank');
    assert.ok(!p1.canBuild('dtrk'), 'demolition truck needs the missile silo');
    building(world, 'mslo', p1, 20, 34);
    assert.ok(p1.canBuild('dtrk'), 'Missile Silo unlocks the Demolition Truck');
    assert.ok(!p1.canBuild('msub'), 'missile sub needs a sub pen');
    building(world, 'spen', p1, 32, 4);
    assert.ok(p1.canBuild('msub'), 'Sub Pen + Tech Center unlock the Missile Sub');
    assert.ok(!p1.canBuild('ctnk') && !p1.canBuild('mech') && !p1.canBuild('stnk'), 'no Allied units for the Soviets');

    for (const [id, x, y] of [['fact', 30, 30], ['powr', 34, 30], ['tent', 37, 30], ['proc', 30, 34], ['weap', 34, 34]] as const) building(world, id, p0, x, y);
    powerUp(world, p0, 30, 40, 3);
    assert.ok(!p0.canBuild('mech'), 'mechanic needs a service depot');
    building(world, 'fix', p0, 38, 34);
    assert.ok(p0.canBuild('mech'), 'Service Depot unlocks the Mechanic');
    assert.ok(!p0.canBuild('ctnk') && !p0.canBuild('stnk'), 'chrono / phase need the tech center');
    building(world, 'dome', p0, 41, 30);
    building(world, 'atek', p0, 44, 30);
    assert.ok(p0.canBuild('ctnk') && p0.canBuild('stnk'), 'Allied Tech Center unlocks the Chrono Tank and Phase Transport');
    assert.ok(!p0.canBuild('ttnk') && !p0.canBuild('qtnk'), 'no Soviet units for the Allies');
  });

  test('built at the war factory, a Tesla Tank rolls out to the rally point', () => {
    const { world, p1 } = sandbox({ credits: 20000 });
    for (const [id, x, y] of [['fact', 2, 30], ['proc', 2, 34], ['weap', 6, 34], ['tsla', 12, 30]] as const) building(world, id, p1, x, y);
    powerUp(world, p1, 2, 40, 3);
    world.issue({ c: 'build', player: p1.id, type: 'ttnk' });
    const t = runUntil(world, () => world.units.some((u) => u.ut.id === 'ttnk'), seconds(60));
    assert.ok(t > 0, 'Tesla Tank produced');
  });
});

// ---------------------------------------------------------------------------
describe('Tesla Tank and Shock Trooper', () => {
  test('a Tesla Tank zaps enemy armour from range with its coil (100 per bolt) and jams radar nearby', () => {
    const { world, p0, p1 } = sandbox();
    const tt = unit(world, 'ttnk', p1, 20.5, 20.5);
    const tank = disarm(unit(world, '2tnk', p0, 26.5, 20.5));
    tank.stance = 'passive';
    const events: GameEvent[] = [];
    run(world, seconds(3), events);
    const zaps = events.filter((e) => e.e === 'fire' && e.shooter === tt.id);
    assert.ok(zaps.length >= 1, 'fired');
    assert.ok(zaps.every((e) => e.e === 'fire' && e.weapon.id === 'TTankZap' && e.weapon.projectile === 'tesla'), 'tesla bolts');
    assert.equal(tank.maxHp - tank.hp, 100 * zaps.length, `100 damage per bolt (hp ${tank.hp})`);
    // radar jamming (RA IsJammer)
    powerUp(world, p0, 2, 2, 2);
    const dome = building(world, 'dome', p0, 26, 26);
    run(world, seconds(1.1));
    assert.ok(dome.jammed, 'enemy radar dome within range is jammed');
  });

  test('a Shock Trooper electrocutes infantry with its PortaTesla', () => {
    const { world, p0, p1 } = sandbox();
    const shok = unit(world, 'shok', p1, 20.5, 20.5);
    const rifle = disarm(unit(world, 'e1', p0, 23.5, 20.5));
    const events: GameEvent[] = [];
    const t = runUntil(world, () => !rifle.alive, seconds(15), events);
    assert.ok(t > 0, 'rifleman killed');
    assert.ok(shok.alive, 'trooper alive');
    assert.ok(events.some((e) => e.e === 'death' && e.id === rifle.id && e.how === 'electro'), 'electrocuted');
    assert.ok(events.some((e) => e.e === 'fire' && e.shooter === shok.id && e.weapon.id === 'PortaTesla'), 'PortaTesla');
  });
});

// ---------------------------------------------------------------------------
describe('Mechanic', () => {
  test('repairs damaged friendly vehicles, not infantry; the medic still only heals infantry', () => {
    const { world, p0 } = sandbox();
    const mech = unit(world, 'mech', p0, 20.5, 20.5);
    const tank = unit(world, '2tnk', p0, 22.5, 20.5);
    const rifle = unit(world, 'e1', p0, 20.5, 22.5);
    tank.hp = 100;
    rifle.hp = 10;
    const events: GameEvent[] = [];
    run(world, seconds(12), events);
    assert.ok(tank.hp >= 300, `tank repaired (hp ${tank.hp})`);
    assert.equal(rifle.hp, 10, 'the mechanic leaves infantry to the medic');
    assert.ok(events.some((e) => e.e === 'fire' && e.shooter === mech.id && e.weapon.id === 'GoodWrench'), 'wrench used');
    assert.ok(healable(WEAPONS.GoodWrench, tank) && !healable(WEAPONS.GoodWrench, rifle), 'healable(): wrench on vehicles');
    assert.ok(healable(WEAPONS.Heal, rifle) && !healable(WEAPONS.Heal, tank), 'healable(): medic on infantry');

    const s2 = sandbox();
    unit(s2.world, 'medi', s2.p0, 20.5, 20.5);
    const t2 = unit(s2.world, '2tnk', s2.p0, 21.5, 20.5);
    t2.hp = 100;
    run(s2.world, seconds(8));
    assert.equal(t2.hp, 100, 'a medic does not fix tanks');
  });

  test('a mechanic walks over to a damaged vehicle it sees and repairs it to full', () => {
    const { world, p0 } = sandbox();
    unit(world, 'mech', p0, 20.5, 20.5);
    const tank = unit(world, '1tnk', p0, 22.5, 21.5);
    tank.hp = 50;
    const t = runUntil(world, () => tank.hp >= tank.maxHp, seconds(40));
    assert.ok(t > 0, `fully repaired (hp ${tank.hp})`);
  });
});

// ---------------------------------------------------------------------------
describe('M.A.D. Tank', () => {
  function madScene() {
    const s = sandbox();
    const { world, p0, p1 } = s;
    const mad = unit(world, 'qtnk', p1, 24.5, 24.5);
    const near = disarm(unit(world, '2tnk', p0, 27.5, 24.5));
    const far = disarm(unit(world, '2tnk', p0, 24.5, 24.5 + MAD_RADIUS + 1.5));
    const inf = disarm(unit(world, 'e1', p0, 25.5, 26.5));
    const own = disarm(unit(world, '3tnk', p1, 21.5, 24.5));
    const pow = building(world, 'powr', p0, 27, 20); // centre (28, 21): 4.9 cells away
    for (const u of [near, far, inf, own]) u.stance = 'passive';
    return { ...s, mad, near, far, inf, own, pow };
  }

  test('deploy: the crew bails out, it arms, then pulses wreck vehicles and structures in range (not infantry) and it is gone', () => {
    const sc = madScene();
    const { world, p1, mad, near, far, inf, own, pow } = sc;
    const before = world.units.filter((u) => u.owner === p1 && u.ut.id === 'e1').length;
    world.issue({ c: 'deploy', player: p1.id, units: [mad.id] });
    run(world, 2);
    assert.equal(mad.madStage, 1, 'deployed and arming');
    const crew = world.units.filter((u) => u.owner === p1 && u.ut.id === 'e1');
    assert.equal(crew.length, before + 1, 'a crewman bailed out');
    for (const c of crew) disarm(c); // (it would shoot the test rifleman)
    // it can't be moved any more
    world.issue({ c: 'move', player: p1.id, units: [mad.id], x: 10.5, y: 10.5 });
    const events: GameEvent[] = [];
    run(world, seconds(MAD_ARM_SECONDS - 0.5), events);
    assert.ok(Math.hypot(mad.x - 24.5, mad.y - 24.5) < 0.15, `locked in place (${mad.x.toFixed(2)}, ${mad.y.toFixed(2)})`);
    assert.ok(mad.madCharge > 0.5 && mad.madCharge < 1, `charging (${mad.madCharge.toFixed(2)})`);
    assert.equal(near.hp, near.maxHp, 'nothing before the charge goes off');
    const t = runUntil(world, () => !mad.alive, seconds(MAD_PULSES * MAD_PULSE_SECONDS + 2), events);
    assert.ok(t > 0, 'the M.A.D. tank destroyed itself');
    const pulses = events.filter((e) => e.e === 'quake' && e.id === mad.id);
    assert.equal(pulses.length, MAD_PULSES, 'several seismic pulses');
    assert.ok(events.some((e) => e.e === 'sfx' && e.key === 'mad_pulse'), 'pulse sound');
    // RA QuakeUnitDamage 50% / QuakeBuildingDamage 25% of full strength, no armour modifier
    assert.ok(Math.abs(near.hp - near.maxHp * 0.5) < 1e-6, `enemy tank at half strength (hp ${near.hp})`);
    assert.ok(Math.abs(own.hp - own.maxHp * 0.5) < 1e-6, `own tank hit too: friend or foe (hp ${own.hp})`);
    assert.ok(Math.abs(pow.hp - pow.maxHp * 0.75) < 1e-6, `structure took 25% (hp ${pow.hp})`);
    assert.equal(far.hp, far.maxHp, 'out of range: untouched');
    assert.equal(inf.hp, inf.maxHp, 'infantry are not hurt by the quake');
    assert.deepEqual(checkInvariants(world), [], 'invariants');
  });

  test('a damaged vehicle is wrecked; the Iron Curtain holds the charge', () => {
    const sc = madScene();
    const { world, p1, mad, near } = sc;
    near.hp = near.maxHp * 0.3;
    world.issue({ c: 'deploy', player: p1.id, units: [mad.id] });
    run(world, 2);
    mad.invulnerable = 5;
    run(world, seconds(MAD_ARM_SECONDS + MAD_PULSES * MAD_PULSE_SECONDS + 1));
    assert.ok(mad.alive && near.alive, 'held while invulnerable');
    runUntil(world, () => !mad.alive, seconds(10));
    assert.ok(!mad.alive, 'went off after the curtain lifted');
    assert.ok(!near.alive, 'the damaged tank was wrecked');
  });
});

// ---------------------------------------------------------------------------
describe('Chrono Tank', () => {
  test('chronoJump shifts it anywhere explored, then it must recharge', () => {
    const { world, p0 } = sandbox();
    const ct = unit(world, 'ctnk', p0, 8.5, 8.5);
    const events: GameEvent[] = [];
    world.issue({ c: 'chronoJump', player: p0.id, unit: ct.id, x: 36.5, y: 30.5 });
    run(world, 1, events);
    assert.ok(Math.hypot(ct.x - 36.5, ct.y - 30.5) < 0.01, `shifted (${ct.x}, ${ct.y})`);
    assert.ok(events.some((e) => e.e === 'teleport' && e.id === ct.id && Math.abs(e.fromX - 8.5) < 0.01), 'teleport event for the renderer');
    assert.ok(events.some((e) => e.e === 'sfx' && e.key === 'chrono'), 'chrono sound');
    assert.ok(ct.chronoCooldown > UNITS.ctnk.chronoShift! - 0.1, `recharging (${ct.chronoCooldown})`);
    world.issue({ c: 'chronoJump', player: p0.id, unit: ct.id, x: 10.5, y: 10.5 });
    run(world, 2);
    assert.ok(Math.hypot(ct.x - 36.5, ct.y - 30.5) < 0.01, 'refused while recharging');
    run(world, seconds(UNITS.ctnk.chronoShift!));
    assert.equal(ct.chronoCooldown, 0, 'charged again');
    world.issue({ c: 'chronoJump', player: p0.id, unit: ct.id, x: 10.5, y: 10.5 });
    run(world, 1);
    assert.ok(Math.hypot(ct.x - 10.5, ct.y - 10.5) < 0.01, 'second jump');
  });

  test('no jumps into the shroud, onto water, by other units or for another player', () => {
    const { world, p0, p1 } = sandbox({ fog: true });
    paint(world.map, 30, 30, 40, 40, T.Water);
    const ct = unit(world, 'ctnk', p0, 8.5, 8.5);
    const tank = unit(world, '2tnk', p0, 9.5, 9.5);
    run(world, 4);
    world.issue({ c: 'chronoJump', player: p0.id, unit: ct.id, x: 44.5, y: 4.5 }); // unexplored
    run(world, 1);
    assert.ok(Math.hypot(ct.x - 8.5, ct.y - 8.5) < 0.3, 'not into the shroud');
    for (let i = 0; i < p0.explored.length; i++) p0.explored[i] = 1;
    world.issue({ c: 'chronoJump', player: p0.id, unit: ct.id, x: 35.5, y: 35.5 }); // water
    world.issue({ c: 'chronoJump', player: p0.id, unit: tank.id, x: 20.5, y: 20.5 }); // not a chrono tank
    world.issue({ c: 'chronoJump', player: p1.id, unit: ct.id, x: 20.5, y: 20.5 }); // not theirs
    run(world, 1);
    assert.ok(Math.hypot(ct.x - 8.5, ct.y - 8.5) < 0.3, 'not onto water, not by the enemy');
    assert.ok(Math.hypot(tank.x - 9.5, tank.y - 9.5) < 0.3, 'a medium tank cannot shift itself');
    assert.equal(ct.chronoCooldown, 0, 'charge kept');
  });

  test('its APTusk missiles kill armour', () => {
    const { world, p0, p1 } = sandbox();
    unit(world, 'ctnk', p0, 20.5, 20.5);
    const tank = disarm(unit(world, '3tnk', p1, 25.5, 20.5));
    const t = runUntil(world, () => !tank.alive, seconds(30));
    assert.ok(t > 0 && t < seconds(15), `heavy tank destroyed in ${(t / 20).toFixed(1)} s`);
  });
});

// ---------------------------------------------------------------------------
describe('Demolition Truck', () => {
  test('ordered to attack, it drives in and detonates a mini-nuke on the target', () => {
    const { world, p0, p1 } = sandbox();
    const truck = unit(world, 'dtrk', p1, 8.5, 24.5);
    const pow = building(world, 'powr', p0, 30, 24);
    const silo = building(world, 'silo', p0, 32, 24);
    const far = building(world, 'powr', p0, 40, 10);
    const events: GameEvent[] = [];
    world.issue({ c: 'attack', player: p1.id, units: [truck.id], target: pow.id });
    run(world, 2, events);
    assert.ok(truck.armed, 'armed');
    assert.ok(events.some((e) => e.e === 'sfx' && e.key === 'demo_arm'), 'arming sound');
    const t = runUntil(world, () => !truck.alive, seconds(40), events);
    assert.ok(t > 0, 'truck went off');
    assert.ok(!pow.alive, 'target destroyed');
    assert.ok(!silo.alive, 'neighbouring structure destroyed');
    assert.equal(far.hp, far.maxHp, 'far structure untouched');
    assert.ok(events.some((e) => e.e === 'impact' && e.kind === 'nuke'), 'nuke-like blast');
  });

  test('destroyed on the way, it explodes where it is; a parked truck never sets off on its own', () => {
    const { world, p0, p1 } = sandbox();
    const truck = unit(world, 'dtrk', p1, 20.5, 20.5);
    const own = disarm(unit(world, '3tnk', p1, 22.5, 20.5));
    const rifle = unit(world, 'e1', p0, 20.5, 23.5);
    rifle.weapons.length = 0;
    run(world, seconds(5));
    assert.ok(truck.alive && rifle.alive, 'parked truck holds (default hold-fire stance)');
    assert.equal(truck.stance, 'passive', 'starts in hold-fire');
    const events: GameEvent[] = [];
    world.kill(truck, 'normal');
    events.push(...world.events);
    assert.ok(events.some((e) => e.e === 'impact' && e.kind === 'nuke'), 'blast on death');
    assert.ok(3 < DEMO_RADIUS && !rifle.alive, 'enemy rifleman 3 cells away killed');
    assert.ok(own.hp < own.maxHp, 'own tank caught in the blast');
  });

  test('Chronosphere-shifting a demolition truck sets it off on the spot (RA)', () => {
    const { world, p0, p1 } = sandbox();
    powerUp(world, p1, 2, 2, 3);
    building(world, 'pdox', p1, 10, 2); // (the Chronosphere is Allied; give it to p1 for the test)
    p1.superCharge.chrono = 1000;
    const truck = unit(world, 'dtrk', p1, 20.5, 20.5);
    const rifle = disarm(unit(world, 'e1', p0, 21.5, 20.5));
    world.issue({ c: 'superweapon', player: p1.id, kind: 'chrono', x: 40.5, y: 40.5, unit: truck.id });
    run(world, 2);
    assert.ok(!truck.alive, 'detonated');
    assert.ok(!rifle.alive, 'blast where it stood');
    assert.ok(p1.superCharge.chrono < 1, `charge used (${p1.superCharge.chrono})`);
  });

  test('hold stance makes it a proximity charge', () => {
    const { world, p0, p1 } = sandbox();
    const truck = unit(world, 'dtrk', p1, 20.5, 20.5);
    world.issue({ c: 'stance', player: p1.id, units: [truck.id], stance: 'hold' });
    const tank = disarm(unit(world, '2tnk', p0, 30.5, 20.5));
    world.issue({ c: 'move', player: p0.id, units: [tank.id], x: 10.5, y: 20.5 });
    const t = runUntil(world, () => !truck.alive, seconds(20));
    assert.ok(t > 0, 'went off as the tank drove past');
    assert.ok(tank.hp < tank.maxHp * 0.5, `tank badly hurt (hp ${tank.hp})`);
  });
});

// ---------------------------------------------------------------------------
describe('Missile Submarine', () => {
  function seaScene() {
    const s = sandbox({ fog: true });
    paint(s.map, 0, 0, 47, 22, T.Water); // sea in the north, land in the south
    return s;
  }

  test('submerged and hidden; surfaces to fire missiles at shore structures from long range', () => {
    const { world, p0, p1 } = seaScene();
    const sub = unit(world, 'msub', p1, 24.5, 12.5);
    const pow = building(world, 'powr', p0, 24, 24); // 11 cells inland of the sub... in SubSCUD range
    unit(world, 'e1', p0, 22.5, 27.5).weapons.length = 0; // eyes on the shore
    run(world, 4);
    assert.ok(sub.submerged && sub.cloaked, 'submerged');
    assert.ok(!world.canSee(p0, sub), 'invisible to the enemy');
    world.issue({ c: 'attack', player: p1.id, units: [sub.id], target: pow.id });
    const events: GameEvent[] = [];
    const t = runUntil(world, () => pow.hp < pow.maxHp, seconds(20), events);
    assert.ok(t > 0, 'shore structure hit');
    assert.ok(events.some((e) => e.e === 'fire' && e.shooter === sub.id && e.weapon.id === 'SubSCUD'), 'SubSCUD missiles');
    assert.ok(Math.hypot(sub.x - 24.5, sub.y - 12.5) < 1, 'fired from where it lay');
  });

  test('hits ships, never submarines', () => {
    const { world, p0, p1 } = seaScene();
    paint(world.map, 0, 0, 47, 47, T.Water);
    const sub = unit(world, 'msub', p1, 10.5, 10.5);
    const dd = disarm(unit(world, 'dd', p0, 18.5, 10.5));
    const ss = unit(world, 'ss', p0, 10.5, 18.5);
    ss.weapons.length = 0;
    world.fog = false;
    world.issue({ c: 'attack', player: p1.id, units: [sub.id], target: ss.id });
    run(world, seconds(1));
    assert.notEqual(sub.order.type === 'attack' && (sub.order as { target: number }).target, ss.id, 'refuses to target a submarine');
    world.issue({ c: 'attack', player: p1.id, units: [sub.id], target: dd.id });
    const t = runUntil(world, () => dd.hp < dd.maxHp, seconds(20));
    assert.ok(t > 0, 'hits the destroyer');
  });
});

// ---------------------------------------------------------------------------
describe('Phase Transport', () => {
  test('cloaked while not firing: enemies cannot see or target it; firing reveals it for a few seconds', () => {
    const { world, p0, p1 } = sandbox({ fog: true });
    const st = unit(world, 'stnk', p0, 20.5, 20.5);
    st.stance = 'passive';
    const watcher = disarm(unit(world, 'e1', p1, 24.5, 20.5));
    const gun = unit(world, '3tnk', p1, 23.5, 22.5);
    run(world, 8);
    assert.ok(st.cloaked, 'cloaked');
    assert.ok(!world.canSee(p1, st), 'hidden from the enemy');
    assert.ok(world.canSee(p0, st), 'its owner sees it');
    run(world, seconds(3));
    assert.equal(st.hp, st.maxHp, 'nobody shoots what it cannot see');
    void watcher;
    // open fire on the heavy tank
    world.issue({ c: 'attack', player: p0.id, units: [st.id], target: gun.id });
    runUntil(world, () => st.lastFireTick > 0, seconds(10));
    run(world, 2);
    assert.ok(!st.cloaked && world.canSee(p1, st), 'revealed while firing');
    world.issue({ c: 'stop', player: p0.id, units: [st.id] });
    gun.weapons.length = 0;
    run(world, seconds(PHASE_DELAY + 1));
    assert.ok(st.cloaked && !world.canSee(p1, st), 'cloaks again after the delay');
  });

  test('an enemy right next to it sees it; it carries five infantry', () => {
    const { world, p0, p1 } = sandbox({ fog: true });
    const st = unit(world, 'stnk', p0, 20.5, 20.5);
    st.stance = 'passive';
    const spotter = disarm(unit(world, 'e1', p1, 21.5, 20.5));
    run(world, 8);
    assert.ok(st.cloaked && world.canSee(p1, st), 'detected from an adjacent cell');
    void spotter;
    const inf = [0, 1, 2, 3, 4, 5].map((k) => unit(world, 'e1', p0, 17.5 + (k % 3) * 0.5, 18.5 + Math.floor(k / 3)));
    world.issue({ c: 'enter', player: p0.id, units: inf.map((u) => u.id), target: st.id });
    run(world, seconds(8));
    assert.equal(st.passengers.length, 5, 'five aboard, the sixth stays out');
    world.issue({ c: 'deploy', player: p0.id, units: [st.id] });
    run(world, 2);
    assert.equal(st.passengers.length, 0, 'unloaded');
  });
});

// ---------------------------------------------------------------------------
describe('AI use of the Aftermath units', () => {
  test('role data covers every unit and the M.A.D. tank / demolition truck stay out of attack waves', () => {
    for (const e of AFTERMATH_AI) {
      assert.ok(UNITS[e.id], `${e.id} exists`);
      assert.ok(UNITS[e.id].owner.includes(e.faction), `${e.id} faction`);
    }
    assert.deepEqual(AFTERMATH_AI.map((e) => e.id).sort(), [...NEW_UNITS].sort(), 'every new unit has AI data');
    const { world, p1 } = sandbox();
    assert.ok(aiManaged(unit(world, 'dtrk', p1, 5.5, 5.5)) && aiManaged(unit(world, 'qtnk', p1, 7.5, 5.5)), 'managed');
    assert.ok(!aiManaged(unit(world, 'ttnk', p1, 9.5, 5.5)), 'tesla tanks fight in waves');
  });

  test('a Soviet AI with the tech builds Tesla Tanks, Shock Troopers and a siege unit', () => {
    const { world, p0, p1 } = sandbox({ w: 64, h: 64, ai: [undefined, 'hard'], credits: 30000 });
    for (const [id, x, y] of [['fact', 50, 50], ['proc', 46, 50], ['barr', 54, 46], ['weap', 50, 45], ['tsla', 46, 46], ['dome', 54, 50], ['stek', 54, 54], ['mslo', 46, 55]] as const) building(world, id, p1, x, y);
    powerUp(world, p1, 44, 58, 4);
    // an (indestructible) Allied base to aim at
    for (const [id, x, y] of [['fact', 8, 8], ['powr', 12, 8], ['proc', 8, 12], ['weap', 12, 12]] as const) building(world, id, p0, x, y).invulnerable = 1e9;
    world.tick = seconds(800); // the AI fields Aftermath units mid-game (siege units after 13 min)
    const seen = new Set<string>();
    for (let t = 0; t < seconds(150); t++) {
      world.step();
      world.events.length = 0;
      for (const u of world.units) if (u.owner === p1) seen.add(u.ut.id);
      if (seen.has('ttnk') && seen.has('shok') && (seen.has('qtnk') || seen.has('dtrk'))) break;
    }
    assert.ok(seen.has('ttnk'), `built a Tesla Tank (${[...seen].join(',')})`);
    assert.ok(seen.has('shok'), 'trained a Shock Trooper');
    assert.ok(seen.has('qtnk') || seen.has('dtrk'), `built a siege unit (${[...seen].join(',')})`);
    assert.deepEqual(checkInvariants(world), [], 'invariants hold');
  });

  test('the AI drives a M.A.D. tank into the enemy base and deploys it, and sends a demolition truck at a rich target', () => {
    const { world, p0, p1 } = sandbox({ w: 64, h: 64, ai: [undefined, 'hard'], credits: 0 });
    building(world, 'fact', p1, 50, 50);
    const base = [['fact', 8, 8], ['powr', 12, 8], ['proc', 8, 12], ['weap', 12, 12], ['powr', 16, 8]] as const;
    const blds = base.map(([id, x, y]) => building(world, id, p0, x, y));
    const mad = unit(world, 'qtnk', p1, 40.5, 40.5);
    const truck = unit(world, 'dtrk', p1, 44.5, 40.5);
    let deployed = false, armed = false;
    for (let t = 0; t < seconds(120) && !(deployed && armed); t++) {
      world.step();
      world.events.length = 0;
      if (mad.alive && mad.madStage > 0) deployed = true;
      if (truck.alive && truck.armed) armed = true;
    }
    assert.ok(deployed, `M.A.D. tank deployed (at ${mad.x.toFixed(1)}, ${mad.y.toFixed(1)})`);
    assert.ok(Math.hypot(mad.x - 12, mad.y - 11) < MAD_RADIUS, `inside the enemy base (${mad.x.toFixed(1)}, ${mad.y.toFixed(1)})`);
    assert.ok(armed, 'demolition truck sent in');
    run(world, seconds(30));
    assert.ok(blds.some((b) => !b.alive || b.hp < b.maxHp), 'the enemy base got hurt');
  });

  test('an Allied AI with the tech builds Chrono Tanks and Mechanics', () => {
    // (no ore in this sandbox: the bank has to cover the Allied build order, radar spy and helipads, then the Aftermath units)
    const { world, p0, p1 } = sandbox({ w: 64, h: 64, ai: ['hard', undefined], credits: 60000 });
    for (const [id, x, y] of [['fact', 8, 8], ['proc', 12, 8], ['tent', 8, 13], ['weap', 12, 13], ['dome', 16, 8], ['atek', 16, 12], ['fix', 16, 16]] as const) building(world, id, p0, x, y);
    powerUp(world, p0, 2, 20, 4);
    building(world, 'fact', p1, 50, 50);
    world.tick = seconds(610); // (the AI fields Aftermath units after 10 min)
    const seen = new Set<string>();
    for (let t = 0; t < seconds(60 * 6); t++) {
      world.step();
      world.events.length = 0;
      for (const u of world.units) if (u.owner === p0) seen.add(u.ut.id);
      if (seen.has('ctnk') && seen.has('mech')) break;
    }
    assert.ok(seen.has('ctnk'), `built a Chrono Tank (${[...seen].join(',')})`);
    assert.ok(seen.has('mech'), 'trained a Mechanic');
  });
});

// ---------------------------------------------------------------------------
describe('Aftermath save / load and determinism', () => {
  function scene() {
    const { world, p0, p1 } = sandbox({ fog: true, seed: 5 });
    paint(world.map, 0, 0, 47, 8, T.Water);
    powerUp(world, p0, 2, 40, 2);
    building(world, 'powr', p0, 30, 30);
    building(world, 'proc', p0, 36, 34);
    const mad = unit(world, 'qtnk', p1, 33.5, 26.5);
    const truck = unit(world, 'dtrk', p1, 8.5, 20.5);
    const ct = unit(world, 'ctnk', p0, 10.5, 30.5);
    const st = unit(world, 'stnk', p0, 14.5, 26.5);
    st.stance = 'passive';
    unit(world, 'mech', p0, 12.5, 31.5);
    unit(world, 'ttnk', p1, 20.5, 14.5);
    unit(world, 'shok', p1, 21.5, 15.5);
    unit(world, 'msub', p1, 24.5, 4.5);
    const tank = unit(world, '2tnk', p0, 11.5, 30.5);
    tank.hp = 150;
    world.issue({ c: 'deploy', player: p1.id, units: [mad.id] });
    world.issue({ c: 'attack', player: p1.id, units: [truck.id], target: world.buildings.find((b) => b.bt.id === 'proc')!.id });
    world.issue({ c: 'chronoJump', player: p0.id, unit: ct.id, x: 4.5, y: 34.5 });
    void st;
    for (let i = 0; i < p0.explored.length; i++) p0.explored[i] = 1;
    return world;
  }

  test('save mid-charge / mid-run / mid-recharge and load: identical from then on', () => {
    const A = scene();
    run(A, seconds(5));
    const mad = A.units.find((u) => u.ut.id === 'qtnk')!;
    assert.ok(mad.madStage === 1, 'saved while the M.A.D. tank arms');
    assert.ok(A.units.some((u) => u.ut.id === 'ctnk' && u.chronoCooldown > 0), 'chrono tank recharging');
    assert.ok(A.units.some((u) => u.ut.id === 'stnk' && u.cloaked), 'phase transport cloaked');
    const json = JSON.stringify(serializeWorld(A));
    const B = scene();
    deserializeWorld(B, JSON.parse(json));
    assert.equal(stateHash(A), stateHash(B), 'identical right after load');
    const extra = (w: World) => JSON.stringify(w.units.map((u) => [u.id, u.madStage, u.madTimer, u.madCharge, u.madPulses, u.chronoCooldown, u.armed, u.cloaked, u.revealedTo, u.stance]));
    assert.equal(extra(A), extra(B), 'aftermath state identical');
    for (let k = 0; k < seconds(30); k++) {
      A.step(); A.events.length = 0;
      B.step(); B.events.length = 0;
    }
    assert.ok(!A.units.some((u) => u.ut.id === 'qtnk'), 'the quake happened');
    assert.equal(stateHash(A), stateHash(B), 'identical 30 s later');
    assert.equal(extra(A), extra(B), 'aftermath state identical later');
  });

  test('two runs of the same scene and of an AI skirmish are identical', () => {
    const runScene = () => { const w = scene(); run(w, seconds(40)); return stateHash(w); };
    assert.equal(runScene(), runScene(), 'scene deterministic');
    const runSk = () => {
      const w = skirmish({ seed: 9, size: 64, ai: ['hard', 'hard'], credits: 12000 });
      for (let t = 0; t < seconds(60 * 8); t++) { w.step(); w.events.length = 0; }
      return stateHash(w);
    };
    assert.equal(runSk(), runSk(), 'skirmish deterministic');
  });
});
