// RA damage model: warhead-vs-armour table and COMBAT.CPP Modify_Damage distance falloff.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ARMOR_INDEX, WARHEADS, WEAPONS, raTicksToSeconds, mphToCellsPerSecond, MOVE_SPEED_SCALE } from '../src/data/rules';
import { modifyDamage, pickWeapon } from '../src/sim/combat';
import { sandbox, unit } from './helpers';

/** Verses from the original 1996 RULES.INI ([SA] .. [Nuke]), armour order none, wood, light, heavy, concrete. */
const RA_VERSES: Record<string, { spread: number; verses: number[] }> = {
  SA: { spread: 3, verses: [100, 50, 60, 25, 25] },
  HE: { spread: 6, verses: [90, 75, 60, 25, 100] },
  AP: { spread: 3, verses: [30, 75, 75, 100, 50] },
  Fire: { spread: 8, verses: [90, 100, 60, 25, 50] },
  HollowPoint: { spread: 1, verses: [100, 5, 5, 5, 5] },
  Super: { spread: 1, verses: [100, 100, 100, 100, 100] },
  Organic: { spread: 0, verses: [100, 0, 0, 0, 0] },
  Nuke: { spread: 6, verses: [90, 100, 60, 25, 50] },
};

/**
 * Bit-exact port of COMBAT.CPP Modify_Damage (integer + `fixed` arithmetic, DEFINES.H constants):
 *   PIXEL_LEPTON_W = ICON_LEPTON_W / ICON_PIXEL_W = 256 / 24 = 10 (integer)
 *   no spread:  distance /= PIXEL_LEPTON_W / 4   (= 2)
 *   spread:     distance /= SpreadFactor * (PIXEL_LEPTON_W / 2)  (= spread * 5)
 *   fixed("NN%").Raw = NN * 256 / 100;  int * fixed = (Raw * int + 128) / 256
 */
function raModifyDamage(damage: number, versesPct: number, spread: number, leptons: number): number {
  if (!damage) return 0;
  const raw = Math.floor((versesPct * 256) / 100);
  let dmg = Math.floor((raw * damage + 128) / 256);
  if (dmg) {
    let d = Math.floor(leptons);
    d = spread ? Math.floor(d / (spread * 5)) : Math.floor(d / 2);
    d = Math.max(0, Math.min(16, d));
    if (d) dmg = Math.floor(dmg / d);
    if (d < 4) dmg = Math.max(dmg, 1);
  }
  return Math.min(dmg, 1000);
}

const ARMORS = ['none', 'wood', 'light', 'heavy', 'concrete'] as const;

describe('warhead table', () => {
  test('verses and spread match RULES.INI', () => {
    for (const [id, ra] of Object.entries(RA_VERSES)) {
      const wh = WARHEADS[id];
      assert.ok(wh, `warhead ${id} exists`);
      assert.equal(wh.spread, ra.spread, `${id} spread`);
      assert.deepEqual(wh.verses.map((v) => Math.round(v * 100)), ra.verses, `${id} verses`);
    }
  });

  test('wall flag: only explosive warheads (HE, AP, Nuke) breach walls', () => {
    const breach = Object.values(WARHEADS).filter((w) => w.wall).map((w) => w.id).sort();
    assert.deepEqual(breach, ['AP', 'HE', 'Nuke']);
  });

  test('every weapon references a known warhead', () => {
    for (const w of Object.values(WEAPONS)) assert.ok(WARHEADS[w.warhead], `${w.id} -> ${w.warhead}`);
  });
});

describe('modifyDamage (COMBAT.CPP Modify_Damage)', () => {
  test('direct hit applies the warhead multiplier only', () => {
    // 90mm (30 AP): full vs heavy armour, 30 % vs infantry
    assert.equal(modifyDamage(30, WARHEADS.AP, ARMOR_INDEX.heavy, 0), 30);
    assert.equal(modifyDamage(30, WARHEADS.AP, ARMOR_INDEX.none, 0), 9);
    // 155mm (150 HE) vs concrete is 100 %, vs heavy 25 %
    assert.equal(modifyDamage(150, WARHEADS.HE, ARMOR_INDEX.concrete, 0), 150);
    assert.equal(modifyDamage(150, WARHEADS.HE, ARMOR_INDEX.heavy, 0), 37.5);
    // Tesla (Super) ignores armour
    for (let a = 0; a < 5; a++) assert.equal(modifyDamage(100, WARHEADS.Super, a, 0), 100);
    // Tanya's Colt45 (HollowPoint) barely scratches armour
    assert.equal(modifyDamage(50, WARHEADS.HollowPoint, ARMOR_INDEX.heavy, 0), 2.5);
  });

  test('zero damage and zero multiplier produce zero', () => {
    assert.equal(modifyDamage(0, WARHEADS.HE, ARMOR_INDEX.none, 0), 0);
    // dog jaws vs a tank
    assert.equal(modifyDamage(100, WARHEADS.Organic, ARMOR_INDEX.heavy, 0), 0);
    assert.equal(modifyDamage(100, WARHEADS.Organic, ARMOR_INDEX.wood, 0.5), 0);
  });

  test('MaxDamage caps a single hit at 1000', () => {
    assert.equal(modifyDamage(5000, WARHEADS.Super, ARMOR_INDEX.none, 0), 1000);
    assert.equal(modifyDamage(1000, WARHEADS.Nuke, ARMOR_INDEX.wood, 0), 1000);
  });

  test('distance falloff divides by distance / (spread * 5 leptons), clamped to 16', () => {
    // HE spread 6 => one divisor step per 30 leptons; 1 cell = 256 leptons => /8
    assert.equal(modifyDamage(150, WARHEADS.HE, ARMOR_INDEX.none, 1), (150 * 0.9) / 8);
    // half a cell => 128 / 30 = 4.27 => /4
    assert.equal(modifyDamage(150, WARHEADS.HE, ARMOR_INDEX.none, 0.5), (150 * 0.9) / 4);
    // AP spread 3 => 15 leptons per step; 1 cell => 17 -> clamped to 16
    assert.equal(modifyDamage(40, WARHEADS.AP, ARMOR_INDEX.heavy, 1), 40 / 16);
    assert.equal(modifyDamage(40, WARHEADS.AP, ARMOR_INDEX.heavy, 5), 40 / 16);
    // damage never grows with distance
    for (const wh of Object.values(WARHEADS)) {
      let prev = Infinity;
      for (let d = 0; d <= 3; d += 0.05) {
        const v = modifyDamage(100, wh, ARMOR_INDEX.none, d);
        assert.ok(v <= prev + 1e-9, `${wh.id} monotonic at ${d}`);
        prev = v;
      }
    }
  });

  test('MinDamage: at least 1 point within the first 4 falloff steps, may drop to 0 beyond', () => {
    // SA 15 vs heavy = 3.75; at 3 steps (45 leptons) => 1.25 ; at 2 steps => 1.875
    assert.ok(modifyDamage(1, WARHEADS.SA, ARMOR_INDEX.heavy, 40 / 256) >= 1, "modifyDamage(1, WARHEADS.SA, ARMOR_INDEX.heavy, 40 / 256) >= 1");
    assert.equal(modifyDamage(1, WARHEADS.SA, ARMOR_INDEX.heavy, 40 / 256), 1);
    // far away (16 steps) the tiny remainder is allowed below 1
    assert.ok(modifyDamage(1, WARHEADS.SA, ARMOR_INDEX.heavy, 2) < 1, "modifyDamage(1, WARHEADS.SA, ARMOR_INDEX.heavy, 2) < 1");
  });

  test('matches the integer RA implementation within rounding for all spread warheads', () => {
    let checked = 0;
    for (const [id, ra] of Object.entries(RA_VERSES)) {
      if (!ra.spread) continue;
      for (const dmg of [1, 15, 25, 30, 40, 50, 75, 100, 125, 150, 600, 1000]) {
        for (let a = 0; a < 5; a++) {
          for (let lep = 0; lep <= 640; lep += 4) {
            const ours = modifyDamage(dmg, WARHEADS[id], a, lep / 256);
            const orig = raModifyDamage(dmg, ra.verses[a], ra.spread, lep);
            // RA truncates twice (8.8 fixed-point multiplier, then the integer divisor): allow 1 point
            // plus the fixed-point error of the multiplier (< 1/256 of the raw damage).
            const tol = 1.5 + dmg / 256;
            assert.ok(Math.abs(ours - orig) <= tol, `${id} dmg=${dmg} armor=${ARMORS[a]} lep=${lep}: ours=${ours} RA=${orig}`);
            checked++;
          }
        }
      }
    }
    assert.ok(checked > 10000, "checked > 10000");
  });

  test('no-spread warheads (Organic) use the RA divisor PIXEL_LEPTON_W/4 = 2 leptons', () => {
    for (let lep = 0; lep <= 64; lep++) {
      const ours = modifyDamage(100, WARHEADS.Organic, ARMOR_INDEX.none, lep / 256);
      const orig = raModifyDamage(100, 100, 0, lep);
      assert.ok(Math.abs(ours - orig) <= 1, `lep=${lep}: ours=${ours} RA=${orig}`);
    }
  });
});

describe('weapon choice & unit conversions', () => {
  test('Mammoth picks the 120mm vs armour and the Tusk missiles vs infantry', () => {
    const { world, p0, p1 } = sandbox({ factions: ['soviet', 'allies'] });
    const mammoth = unit(world, '4tnk', p0, 10.5, 10.5);
    const tank = unit(world, '2tnk', p1, 14.5, 10.5);
    const inf = unit(world, 'e1', p1, 14.5, 12.5);
    assert.equal(pickWeapon(mammoth, tank)?.def.id, '120mm');
    assert.equal(pickWeapon(mammoth, inf)?.def.id, 'MammothTusk');
  });

  test('rocket soldiers use Dragon on the ground and RedEye against aircraft', () => {
    const { world, p0, p1 } = sandbox();
    const e3 = unit(world, 'e3', p0, 10.5, 10.5);
    const tank = unit(world, '3tnk', p1, 13.5, 10.5);
    const hind = unit(world, 'hind', p1, 13.5, 12.5);
    hind.altitude = 1.5;
    assert.equal(pickWeapon(e3, tank)?.def.id, 'Dragon');
    assert.equal(pickWeapon(e3, hind)?.def.id, 'RedEye');
    // a rifleman cannot shoot aircraft at all, dogs only bite infantry
    const e1 = unit(world, 'e1', p0, 11.5, 10.5);
    assert.equal(pickWeapon(e1, hind), null);
    const dog = unit(world, 'dog', p1, 12.5, 12.5);
    assert.equal(pickWeapon(dog, unit(world, '1tnk', p0, 12.5, 14.5)), null);
    assert.equal(pickWeapon(dog, e1)?.def.id, 'DogJaw');
  });

  test('RA unit conversions (15 ticks/s, 256 leptons/cell)', () => {
    assert.equal(raTicksToSeconds(15), 1);
    assert.equal(raTicksToSeconds(45), 3);
    // MPH 10 => 10*256/100 leptons/tick => 1.5 cells/s, times the global pace knob
    assert.ok(Math.abs(mphToCellsPerSecond(10) - 1.5 * MOVE_SPEED_SCALE) < 1e-9, "Math.abs(mphToCellsPerSecond(10) - 1.5 * MOVE_SPEED_SCALE) < 1e-9");
  });
});
