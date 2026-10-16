// Mod loader (src/mods): validation against the rule types, safe apply / restore of the module-level
// rule tables, determinism with mods, and mods recorded in saves and replays.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BUILDINGS, UNITS, WARHEADS, WEAPONS } from '../src/data/rules';
import { appliedModSet, applyModSet, checkMods, pristineTables, restoreRules, typeModInfo } from '../src/mods/engine';
import { canonicalJson, makeModSet, modSetHash, type ModFile, type ModSet } from '../src/mods/format';
import { activeModSet, installMod, moveMod, resetModStore, setModEnabled } from '../src/mods/store';
import { CommandFeeder, CommandRecorder, hookStep } from '../src/replay/core';
import { worldHash } from '../src/replay/hash';
import { deserializeWorld, serializeWorld } from '../src/sim/save';
import type { Command } from '../src/sim/types';
import type { World } from '../src/sim/world';
import { run, seconds, skirmish } from './helpers';

const read = (f: string) => JSON.parse(readFileSync(new URL(`../public/mods/${f}`, import.meta.url), 'utf8')) as ModFile;
const TANK_RUSH = read('tank-rush.rhmod.json');
const GLASS = read('glass-cannon.rhmod.json');

const snapshot = () => JSON.stringify({ u: UNITS, b: BUILDINGS, w: WEAPONS, h: WARHEADS });
const BASE = snapshot();

after(() => restoreRules());

describe('mods: files and validation', () => {
  test('the bundled example mods are listed and valid', () => {
    const idx = read('index.json') as unknown as { mods: string[] };
    assert.deepEqual(idx.mods.sort(), ['glass-cannon.rhmod.json', 'tank-rush.rhmod.json'], 'index lists both');
    for (const m of [TANK_RUSH, GLASS]) {
      const r = checkMods([m]);
      assert.ok(r.ok, `${m.id}: ${r.errors.map((e) => e.path + ' ' + e.message).join('; ')}`);
      assert.equal(r.warnings.length, 0, `${m.id} warnings: ${r.warnings.map((w) => w.message)}`);
      assert.ok(r.changes.length > 0, 'changes something');
    }
    const both = checkMods([TANK_RUSH, GLASS]);
    assert.ok(both.ok, 'they combine');
    assert.equal(snapshot(), BASE, 'checking never touches the live rules');
  });

  test('clear errors: types, ranges, unknown fields / ids with suggestions, read-only fields, references, clones', () => {
    const r = checkMods([{
      id: 'Bad Id', name: '',
      units: {
        '2tnk': { cost: 'cheap', speeed: 3, kind: 'naval', strength: -5, owner: ['allies', 'martians'] },
        tank: { cost: 1 },
        e1: { clone: 'e1' },
        newinf: { clone: 'nope' },
        '3tnk': { primary: '106mm' },
      },
      weapons: { '90mm': { warhead: 'APP', rof: 0.5 }, Dragon: { projectile: 'laser' } },
      warheads: { HE: { verses: [1, 1, 1] } },
      buildings: { powr: { size: [3, 3] }, tsla: { prereq: ['weap', 'teslalab'] } },
      scale: [{ table: 'units', fields: { name: 2 } }, { table: 'tanks', fields: { cost: 1 } }],
    } as unknown as ModFile]);
    assert.ok(!r.ok, 'rejected');
    const msg = (path: string) => r.errors.find((e) => e.path === path)?.message ?? `(no error at ${path}: ${r.errors.map((e) => e.path).join(', ')})`;
    assert.match(msg('id'), /lower-case/);
    assert.match(msg('name'), /required/);
    assert.match(msg('units.2tnk.cost'), /expected a number, got "cheap"/);
    assert.match(msg('units.2tnk.speeed'), /did you mean "speed"/);
    assert.match(msg('units.2tnk.kind'), /can't be modded/);
    assert.match(msg('units.2tnk.strength'), /at least 1/);
    assert.match(msg('units.2tnk.owner'), /allies/);
    assert.match(msg('units.tank'), /unknown unit "tank".*clone/);
    assert.match(msg('units.e1.clone'), /already exists/);
    assert.match(msg('units.newinf.clone'), /unknown unit "nope"/);
    assert.match(msg('units.3tnk.primary'), /unknown weapon "106mm".*did you mean "105mm"/);
    assert.match(msg('weapons.90mm.warhead'), /unknown warhead "APP".*did you mean "AP"/);
    assert.match(msg('weapons.90mm.rof'), /whole number/);
    assert.match(msg('weapons.Dragon.projectile'), /one of/);
    assert.match(msg('warheads.HE.verses'), /5 multipliers/);
    assert.match(msg('buildings.powr.size'), /footprint/);
    assert.match(msg('buildings.tsla.prereq'), /unknown structure "teslalab"/);
    assert.match(msg('scale[0].fields.name'), /numeric/);
    assert.match(msg('scale[1].table'), /one of/);
  });

  test('canonical hash ignores key order; the set hash changes with content and order', () => {
    const a = { id: 'x', name: 'X', units: { e1: { cost: 90, strength: 40 } } } as ModFile;
    const b = { units: { e1: { strength: 40, cost: 90 } }, name: 'X', id: 'x' } as ModFile;
    assert.equal(canonicalJson(a), canonicalJson(b), 'canonical');
    assert.equal(modSetHash([a]), modSetHash([b]), 'same hash');
    assert.notEqual(modSetHash([a, GLASS]), modSetHash([GLASS, a]), 'order matters (later mods win)');
    assert.notEqual(modSetHash([a]), modSetHash([{ ...a, units: { e1: { cost: 91 } } }]), 'content matters');
  });
});

describe('mods: apply and restore', () => {
  test('applying changes the live rules in place; restoring puts back exactly the base rules', () => {
    const tank = UNITS['2tnk'], gun = WEAPONS['90mm'];
    const r = applyModSet(makeModSet([TANK_RUSH, GLASS]))!;
    assert.ok(r.ok, 'applied');
    assert.equal(UNITS['2tnk'], tank, 'same object (entities and modules keep their references)');
    assert.equal(UNITS['2tnk'].cost, 600, 'Tank Rush: 800 * 0.75');
    assert.equal(UNITS['2tnk'].speed, 10, 'Tank Rush: 8 * 1.25');
    assert.equal(UNITS['2tnk'].strength, 240, 'Glass Cannon: 400 * 0.6');
    assert.equal(UNITS.e1.strength, 30, 'Glass Cannon: every unit');
    assert.equal(BUILDINGS.fact.strength, 1000, 'structures keep their strength');
    assert.equal(gun.damage, 39, 'Glass Cannon: 30 * 1.3');
    assert.equal(BUILDINGS.weap.cost, 1500, 'Tank Rush: cheaper war factory');
    const rhino = UNITS.rhino;
    assert.ok(rhino && rhino.id === 'rhino' && rhino.kind === 'vehicle' && rhino.owner.includes('soviet'), 'cloned variant');
    assert.equal(rhino.primary, '105mm', 'inherits the base weapons');
    assert.equal(rhino.strength, Math.round(330 * 0.6), 'later scale rules apply to the variant too');
    assert.notEqual(rhino.owner, UNITS['3tnk'].owner, 'deep copy (no shared arrays)');
    assert.equal(appliedModSet()?.mods.length, 2, 'applied set');
    const info = typeModInfo('2tnk')!;
    assert.deepEqual(info.mods.sort(), ['Glass Cannon', 'Tank Rush'], 'marker names both mods');
    assert.ok(info.lines.some((l) => l.startsWith('cost: 800 → 600')), info.lines.join('; '));
    assert.equal(typeModInfo('rhino')?.variant, '3tnk', 'variant marker');
    assert.equal(applyModSet(makeModSet([TANK_RUSH, GLASS])), r, 'same set: no-op');
    restoreRules();
    assert.equal(snapshot(), BASE, 'base rules restored exactly');
    assert.equal(UNITS['2tnk'], tank, 'identity kept');
    assert.equal(UNITS.rhino, undefined, 'variant removed');
    assert.equal(typeModInfo('2tnk'), null, 'no marker');
    applyModSet(makeModSet([GLASS]));
    assert.equal(UNITS['2tnk'].strength, 240, 'switching sets starts from the base rules (no compounding)');
    assert.equal(UNITS['2tnk'].cost, 800, 'previous set fully reverted');
    applyModSet(null);
    assert.equal(snapshot(), BASE, 'null = base rules');
  });

  test('an invalid set throws with every problem listed and leaves the base rules', () => {
    applyModSet(makeModSet([GLASS]));
    assert.throws(() => applyModSet(makeModSet([TANK_RUSH, { id: 'broken', name: 'Broken', units: { '2tnk': { cost: -1 } } }])), /broken.*units\.2tnk\.cost/s);
    assert.equal(snapshot(), BASE, 'nothing half-applied');
    assert.equal(appliedModSet(), null, 'nothing applied');
  });

  test('the store builds the active set from enabled mods in order; conflicts disable it', () => {
    resetModStore();
    installMod(TANK_RUSH);
    installMod(GLASS);
    assert.equal(activeModSet(), null, 'nothing enabled');
    setModEnabled('glass-cannon', true);
    setModEnabled('tank-rush', true);
    assert.deepEqual(activeModSet()!.mods.map((m) => m.id), ['glass-cannon', 'tank-rush'], 'enable order');
    moveMod('tank-rush', -1);
    const set = activeModSet()!;
    assert.deepEqual(set.mods.map((m) => m.id), ['tank-rush', 'glass-cannon'], 'reordered');
    assert.equal(set.hash, modSetHash([TANK_RUSH, GLASS]), 'hash of the content');
    installMod({ id: 'tank-rush', name: 'Tank Rush', units: { '2tnk': { cost: 'x' } } } as unknown as ModFile);
    assert.equal(activeModSet(), null, 'an invalid enabled mod disables the set (the Mods screen explains why)');
    resetModStore();
  });

  test('pristine tables are a deep copy of the base rules', () => {
    applyModSet(makeModSet([GLASS]));
    const p = pristineTables();
    assert.equal((p.units['2tnk'] as { strength: number }).strength, 400, 'unmodded values');
    (p.units['2tnk'] as { strength: number }).strength = 1;
    assert.equal(pristineTables().units['2tnk'].strength, 400, 'copies are independent');
    restoreRules();
  });
});

describe('mods: determinism, saves and replays', () => {
  const make = () => skirmish({ seed: 31337, size: 64, ai: ['hard', 'hard'], startUnits: 'light' });

  test('a modded match is deterministic and differs from the unmodded one', () => {
    const set = makeModSet([TANK_RUSH, GLASS]);
    applyModSet(set);
    const a = make();
    run(a, seconds(150));
    applyModSet(null);
    const base = make();
    run(base, seconds(150));
    applyModSet(JSON.parse(JSON.stringify(set)) as ModSet);
    const b = make();
    run(b, seconds(150));
    assert.equal(worldHash(b), worldHash(a), 'same mods, same match');
    assert.notEqual(worldHash(base), worldHash(a), 'the mods matter');
    restoreRules();
  });

  test('saves carry the mod set: a save with modded units (incl. a variant) restores and continues in sync', () => {
    const set = makeModSet([TANK_RUSH, GLASS]);
    applyModSet(set);
    const A = make();
    A.addUnit('rhino', A.players[1], 40, 20);
    run(A, seconds(60));
    // what Game.save writes: the world plus the setup (which holds `mods`)
    const file = JSON.parse(JSON.stringify({ world: serializeWorld(A), setup: { mods: set } }));
    applyModSet(null); // back at the menu: base rules
    assert.equal(UNITS.rhino, undefined, 'variant gone between matches');
    applyModSet(file.setup.mods); // Game constructor: mods first, then the world
    const B = make();
    deserializeWorld(B, file.world);
    assert.ok(B.units.some((u) => u.ut.id === 'rhino'), 'variant restored from the save');
    run(A, seconds(60));
    run(B, seconds(60));
    assert.equal(worldHash(B), worldHash(A), 'save / load with mods stays in sync');
    restoreRules();
  });

  test('replays carry the mod set: playback with it matches hash for hash; without it the desync is detected', () => {
    const set = makeModSet([GLASS]);
    applyModSet(set);
    const live = skirmish({ seed: 4711, size: 64, ai: [undefined, 'hard'], startUnits: 'light' });
    const rec = new CommandRecorder(live);
    hookStep(live, null, () => rec.afterStep());
    const p0 = live.players[0];
    const issue = (c: Command) => { rec.record(c); live.issue(c); };
    for (let t = 0; t < seconds(120); t++) {
      if (t === 1) { const mcv = live.units.find((u) => u.owner === p0 && u.ut.deploysInto); if (mcv) issue({ c: 'deploy', player: 0, units: [mcv.id] }); }
      if (t === seconds(30)) issue({ c: 'move', player: 0, units: live.units.filter((u) => u.owner === p0 && u.weapons.length).map((u) => u.id), x: 40, y: 24, attackMove: true });
      live.step();
      live.events.length = 0;
    }
    const replay = JSON.parse(JSON.stringify({ setup: { seed: 4711, mods: set }, cmds: rec.cmds, hashes: rec.hashes }));
    const play = (mods: ModSet | null) => {
      applyModSet(mods);
      const w: World = skirmish({ seed: replay.setup.seed, size: 64, ai: [undefined, 'hard'], startUnits: 'light' });
      const feeder = new CommandFeeder(w, replay.cmds, replay.hashes);
      hookStep(w, () => feeder.beforeStep(), () => feeder.afterStep());
      while (w.tick < live.tick) { w.step(); w.events.length = 0; }
      return { feeder, hash: worldHash(w) };
    };
    const ok = play(replay.setup.mods);
    assert.equal(ok.feeder.desyncTick, -1, 'in sync with the recorded mods');
    assert.equal(ok.hash, worldHash(live), 'identical final state');
    const wrong = play(null);
    assert.ok(wrong.feeder.desyncTick > 0, 'base rules desync (and the hash check catches it)');
    restoreRules();
  });
});
