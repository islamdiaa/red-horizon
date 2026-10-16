// Map & mission editor (src/editor): .rhmap.json round trips, validation, symmetry, brushes, undo /
// redo, and custom maps / missions rebuilding identical, deterministic worlds for saves and replays.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildMap, getMapDef } from '../src/maps';
import { symmetryGroup } from '../src/maps/build';
import { checkMapDef, customMaps, isCustomMapId, playerCount } from '../src/maps/custom';
import type { Feature, MapDef, Symmetry } from '../src/maps/format';
import {
  EditorModel, addStart, bridgeAt, bridgeDefAt, moveStart, newDoc, newMapDef, resizeMap, setSymmetry, startRefs, strokeFeature, DEFAULT_BRUSH,
} from '../src/editor/doc';
import { checkMission, customMissionDef, defaultMission, type CustomMissionSetup, type MissionSpec } from '../src/editor/mission';
import { customMissionDefs, customMissionSetup, docToFile, parseRhMap, resetEditorStore, sanitizeMission, saveDoc } from '../src/editor/store';
import { oreShares, validateMap, validateMission } from '../src/editor/validate';
import { CommandFeeder, CommandRecorder, hookStep } from '../src/replay/core';
import { worldHash } from '../src/replay/hash';
import { MissionRuntime } from '../src/sim/mission';
import { T, WATER_LEVEL, type GameMap } from '../src/sim/map';
import { deserializeWorld, serializeWorld } from '../src/sim/save';
import type { Command } from '../src/sim/types';
import { World, type PlayerSetup } from '../src/sim/world';
import { TICK_HZ, run, seconds } from './helpers';

/** A hand-made river map: a rot2 river with a ford, a bridge, forests, ore and a hill. */
function riverMap(sym: Symmetry = 'rot2'): MapDef {
  const def = newMapDef({ name: 'Test River', size: 80, symmetry: sym, seed: 4242 });
  const b = { ...DEFAULT_BRUSH, radius: 2.5 };
  def.features.push(
    strokeFeature('water', [[0, 30], [20, 34], [40, 40]], b),
    strokeFeature('ford', [[39, 44], [41, 36]], { ...b, radius: 1.6, rough: 0 }),
    strokeFeature('forest', [[6, 50], [12, 46]], { ...b, radius: 3, density: 0.7 }),
    strokeFeature('rock', [[28, 56]], { ...b, radius: 2 }),
    strokeFeature('raise', [[22, 64]], { ...b, radius: 5, amount: 0.9 }),
    strokeFeature('ore', [[30, 50]], { ...b, radius: 3 }),
    strokeFeature('gems', [[40, 40]], { ...b, radius: 1.5 }),
  );
  return def;
}

const players2: PlayerSetup[] = [
  { name: 'A', faction: 'allies', color: 0, team: 0, isHuman: false, ai: 'hard' },
  { name: 'B', faction: 'soviet', color: 0, team: 1, isHuman: false, ai: 'hard' },
];

function exactlySymmetric(def: MapDef, map: GameMap): string | null {
  for (const g of symmetryGroup(def).slice(1)) {
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
      const [fx, fy] = g.f(x + 0.5, y + 0.5);
      const i = map.idx(x, y), j = map.idx(Math.floor(fx), Math.floor(fy));
      if (map.terrain[i] !== map.terrain[j] || map.ore[i] !== map.ore[j] || map.gems[i] !== map.gems[j] || !map.tree[i] !== !map.tree[j]) return `(${x}, ${y}) vs (${Math.floor(fx)}, ${Math.floor(fy)})`;
    }
  }
  return null;
}

describe('editor: map format and files', () => {
  test('.rhmap.json round trip rebuilds the identical map', () => {
    const def = riverMap();
    def.bridges = [];
    const doc = newDoc(def, defaultMission(2));
    const text = JSON.stringify(docToFile(doc));
    const { doc: back, errors } = parseRhMap(text);
    assert.deepEqual(errors, [], 'no import errors');
    assert.ok(back, 'parsed');
    assert.notEqual(back!.id, doc.id, 'imports get a fresh id (never overwrite)');
    assert.ok(isCustomMapId(back!.id), 'custom id');
    const a = buildMap(def), b = buildMap(back!.map);
    assert.deepEqual(b.terrain, a.terrain, 'terrain');
    assert.deepEqual(b.ore, a.ore, 'ore');
    assert.deepEqual(b.tree, a.tree, 'trees');
    assert.deepEqual(b.heights, a.heights, 'heights');
    assert.deepEqual(b.startPositions, a.startPositions, 'starts');
    assert.deepEqual(back!.mission, doc.mission, 'mission travels with the map');
  });

  test('a bare MapDef (curated source) imports too, and bad files explain what is wrong', () => {
    const { doc } = parseRhMap(JSON.stringify(getMapDef('bridgewater')));
    assert.ok(doc && doc.map.players === 2 && doc.map.bridges?.length === 1, 'curated def imports');
    assert.match(parseRhMap('{nope').errors[0], /invalid JSON/, 'invalid JSON');
    assert.match(parseRhMap(JSON.stringify({ format: 'rhmap', version: 99, map: {} })).errors[0], /newer/, 'future version');
    const bad = checkMapDef({ name: 'x', size: 7, climate: 'lunar', symmetry: 'rot2', seed: 1, starts: [], features: [] });
    assert.equal(bad.def, null, 'rejected');
    assert.ok(bad.errors.some((e) => e.startsWith('size')) && bad.errors.some((e) => e.startsWith('climate')), `clear errors: ${bad.errors.join('; ')}`);
    const f = checkMapDef({ name: 'x', size: 64, climate: 'winter', symmetry: 'none', seed: 1, starts: [[10.5, 10.5]], features: [{ t: 'lava', circle: [5, 5], r: 2 }, { t: 'ore', circle: [5, 5] }] });
    assert.equal(f.def, null, 'bad features rejected');
    assert.ok(f.errors.some((e) => e.includes('features[0]')) && f.errors.some((e) => e.includes('features[1]')), f.errors.join('; '));
  });

  test('every curated map passes the editor validation (same rules as the curated test suite)', () => {
    for (const id of ['proving-grounds', 'bridgewater', 'archipelago', 'pocket-valley', 'three-kingdoms', 'inland-sea']) {
      const def = getMapDef(id)!;
      const r = validateMap(def, buildMap(def));
      assert.equal(r.errors, 0, `${id}: ${r.checks.filter((c) => c.level === 'error').map((c) => c.title).join('; ')}`);
      assert.ok(r.spread <= 0.03, `${id}: ore spread ${r.spread}`);
    }
  });
});

describe('editor: symmetry and brushes', () => {
  for (const sym of ['mirrorX', 'mirrorY', 'mirrorD', 'rot2', 'rot4', 'mirror4'] as Symmetry[]) {
    test(`${sym}: strokes are mirrored exactly, starts replicated, ore fair`, () => {
      const def = riverMap(sym);
      const map = buildMap(def);
      assert.equal(map.startPositions.length, playerCount(def), 'players = authored starts × group');
      assert.equal(exactlySymmetric(def, map), null, 'exact symmetry');
      const shares = oreShares(map).map((o) => o.total);
      assert.ok(Math.max(...shares) === Math.min(...shares), `equal ore ${shares.join(', ')}`);
    });
  }

  test('a stroke painted "once" ignores the symmetry; "none" keeps every start authored', () => {
    const def = riverMap('rot2');
    def.features.push(strokeFeature('rock', [[12, 12]], { ...DEFAULT_BRUSH, radius: 2, once: true }));
    const map = buildMap(def);
    assert.equal(map.terrain[map.idx(12, 12)], T.Rock, 'painted copy');
    assert.notEqual(map.terrain[map.idx(80 - 13, 80 - 13)], T.Rock, 'no mirrored copy');
    setSymmetry(def, 'none');
    assert.equal(def.starts.length, 2, 'both starts became authored');
    assert.ok(addStart(def, 20.5, 20.5) && addStart(def, 60.5, 60.5), 'add up to 4');
    assert.ok(!addStart(def, 40.5, 40.5), 'no fifth');
    assert.equal(buildMap(def).startPositions.length, 4, '4 players');
    setSymmetry(def, 'rot4');
    assert.equal(playerCount(def), 4, 'rot4 keeps one authored start = 4 players');
  });

  test('moving any symmetric copy of a start moves its authored source', () => {
    const def = newMapDef({ size: 96, symmetry: 'rot2', seed: 1 });
    const copy = startRefs(def).find((r) => r.g === 1)!;
    moveStart(def, copy, 70.2, 30.7);
    const refs = startRefs(def);
    assert.deepEqual([refs[1].x, refs[1].y], [70.5, 30.5], 'copy lands on the clicked cell');
    assert.deepEqual([refs[0].x, refs[0].y], [96 - 70.5, 96 - 30.5], 'source mirrored');
  });

  test('brushes: dab vs path, raise / lower, erasers, and water stays below the waterline', () => {
    const dab = strokeFeature('forest', [[10, 10], [10.1, 10]], DEFAULT_BRUSH);
    assert.ok('circle' in dab && dab.density === DEFAULT_BRUSH.density, 'a click is a circle');
    const path = strokeFeature('water', [[10, 10], [14, 10], [18, 12]], DEFAULT_BRUSH);
    assert.ok('path' in path && path.w === DEFAULT_BRUSH.radius * 2, 'a drag is a path');
    const def = riverMap();
    const base = buildMap(def);
    const hill = base.heightAt(22, 64), opposite = base.heightAt(80 - 22, 80 - 64);
    def.features = def.features.filter((f) => f.t !== 'raise');
    const flat = buildMap(def);
    assert.ok(hill > flat.heightAt(22, 64) + 0.3, `raised (${hill} vs ${flat.heightAt(22, 64)})`);
    assert.ok(Math.abs(hill - opposite) < 1e-4, 'hill mirrored');
    def.features.push({ t: 'lower', circle: [20, 33], r: 6, amount: 3 } as Feature, { t: 'noore', circle: [30, 50], r: 5 } as Feature, { t: 'deforest', circle: [9, 48], r: 8 } as Feature);
    const m2 = buildMap(def);
    let wet = 0, under = 0;
    for (let y = 0; y < m2.h; y++) for (let x = 0; x < m2.w; x++) {
      const i = m2.idx(x, y);
      if (m2.terrain[i] === T.Water) { wet++; if (m2.heightAt(x + 0.5, y + 0.5) < WATER_LEVEL) under++; } else assert.ok(m2.heightAt(x + 0.5, y + 0.5) > WATER_LEVEL - 0.3, `land (${x}, ${y}) not sunk`);
    }
    assert.ok(under / wet > 0.97, `water under the surface (${under}/${wet})`);
    assert.equal(m2.ore[m2.idx(30, 50)], 0, 'ore erased');
    assert.equal(m2.tree[m2.idx(9, 48)], 0, 'trees erased');
  });

  test('bridges: a click on the river picks the short span; the bridge def is found again', () => {
    const def = riverMap();
    const map = buildMap(def);
    let at: [number, number] | null = null;
    for (let x = 14; x < 26 && !at; x++) for (let y = 26; y < 40; y++) if (map.terrain[map.idx(x, y)] === T.Water) { at = [x + 0.5, y + 0.5]; break; }
    const b = bridgeAt(map, at![0], at![1]);
    assert.ok(b && b.axis === 'y', `a north-south bridge across an east-west river (${JSON.stringify(b)})`);
    def.bridges = [b!];
    const built = buildMap(def);
    assert.ok(built.bridges.length >= 2, 'bridge and its mirror copy');
    for (const br of built.bridges) for (const [x, y] of br.cells) assert.equal(built.terrain[built.idx(x, y)], T.Water, 'on water');
    const [x0, y0] = built.bridges[1].cells[0];
    assert.equal(bridgeDefAt(def, built, x0 + 0.5, y0 + 0.5), 0, 'clicking the mirrored copy finds the def');
    assert.equal(bridgeAt(map, 2, 70), null, 'no bridge on dry land');
  });

  test('resize scales content; validation flags broken layouts', () => {
    const def = riverMap();
    resizeMap(def, 120, true);
    assert.equal(def.size, 120);
    assert.deepEqual(startRefs(def).map((r) => [r.x, r.y]), [[Math.floor(10.5 * 1.5) + 0.5, Math.floor(69.5 * 1.5) + 0.5], [120 - Math.floor(10.5 * 1.5) - 0.5, 120 - Math.floor(69.5 * 1.5) - 0.5]], 'starts scaled');
    const bad = newMapDef({ size: 64, symmetry: 'none', seed: 3, starter: false });
    bad.features.push({ t: 'water', rect: [0, 30, 64, 34], wobble: 0 } as Feature, { t: 'ore', circle: [12, 40], r: 4 } as Feature);
    const r = validateMap(bad, buildMap(bad));
    const titles = r.checks.map((c) => `${c.level}: ${c.title}`).join('\n');
    assert.ok(!r.playable, 'not playable');
    assert.match(titles, /error: Starts? 2 cut off by land/, titles);
    assert.match(titles, /error: Ore is uneven/, titles);
    const cramped = newMapDef({ size: 64, symmetry: 'rot2', seed: 3 });
    cramped.features.push({ t: 'rock', circle: [cramped.starts[0][0] + 6, cramped.starts[0][1]], r: 3, wobble: 0 } as Feature);
    cramped.clearRadius = 4;
    assert.match(validateMap(cramped, buildMap(cramped)).checks.map((c) => c.title).join('|'), /cramped base/, 'cramped base flagged');
    for (const sym of ['rot2', 'rot3', 'rot4', 'mirror4', 'mirrorX', 'none'] as Symmetry[]) {
      const fresh = newMapDef({ size: 96, symmetry: sym, seed: 9 });
      const rep = validateMap(fresh, buildMap(fresh));
      assert.equal(rep.errors, 0, `a new ${sym} map is playable out of the box: ${rep.checks.filter((c) => c.level === 'error').map((c) => c.title)}`);
    }
  });
});

describe('editor: undo / redo', () => {
  test('edits are undoable, drags merge into one step, history is bounded', () => {
    const m = new EditorModel(newDoc(newMapDef({ size: 64, seed: 5 })));
    const s0 = JSON.stringify(m.doc.map);
    m.edit((d) => { d.map.features.push(strokeFeature('water', [[30, 30]], DEFAULT_BRUSH)); });
    m.edit((d) => { d.map.climate = 'winter'; });
    assert.ok(m.canUndo && !m.canRedo && m.dirty, 'history');
    const water = m.map().terrain[m.map().idx(30, 30)];
    assert.equal(water, T.Water, 'built map follows the edit');
    m.undo();
    assert.equal(m.doc.map.climate, 'temperate', 'undo climate');
    m.undo();
    assert.equal(JSON.stringify(m.doc.map), s0, 'back to the start');
    assert.equal(m.map().terrain[m.map().idx(30, 30)], T.Clear, 'map rebuilt');
    m.redo(); m.redo();
    assert.equal(m.doc.map.climate, 'winter', 'redo');
    assert.equal(m.edit(() => false), false, 'a no-op is not recorded');
    m.beginGroup();
    for (let k = 0; k < 10; k++) m.edit((d) => { d.map.starts[0] = [10.5 + k, 50.5]; });
    m.endGroup();
    m.undo();
    assert.equal(m.doc.map.climate, 'winter', 'the drag was one step');
    m.limit = 5;
    for (let k = 0; k < 20; k++) m.edit((d) => { d.map.seed = k; });
    let n = 0;
    while (m.undo()) n++;
    assert.equal(n, 5, 'bounded history');
  });
});

describe('editor: custom maps in skirmish, saves and replays', () => {
  const mkWorld = (def: MapDef, seed: number) => new World({ map: buildMap(def), players: players2, credits: 10000, startUnits: 'mcv', fog: true, seed });

  test('custom map -> GameMap -> deterministic world; a save restored on a map rebuilt from the content continues identically', () => {
    const def = riverMap();
    def.bridges = [bridgeAt(buildMap(def), 20.5, 34.5) ?? bridgeAt(buildMap(def), 18.5, 33.5)!].filter(Boolean);
    // what a GameSetup carries: the map content (JSON), not a reference
    const setupMap = JSON.parse(JSON.stringify(def)) as MapDef;
    const A = mkWorld(def, 77), B = mkWorld(setupMap, 77);
    run(A, seconds(120));
    run(B, seconds(120));
    assert.equal(worldHash(A), worldHash(B), 'same content, same match');
    const save = JSON.parse(JSON.stringify(serializeWorld(A)));
    const C = mkWorld(JSON.parse(JSON.stringify(setupMap)), 77);
    deserializeWorld(C, save);
    run(A, seconds(90));
    run(C, seconds(90));
    assert.equal(worldHash(C), worldHash(A), 'save / load on the rebuilt custom map stays in sync');
    assert.ok(A.players.every((p) => p.has('fact') || A.buildings.some((b) => b.owner === p)), 'AIs deployed and built on the custom map');
  });

  test('a replay of a custom-map match plays back hash for hash from the embedded map', () => {
    const def = riverMap('mirrorX');
    const make = (d: MapDef) => new World({ map: buildMap(d), players: [{ ...players2[0], ai: undefined, isHuman: true }, players2[1]], credits: 10000, startUnits: 'light', fog: true, seed: 99 });
    const live = make(def);
    const rec = new CommandRecorder(live);
    hookStep(live, null, () => rec.afterStep());
    const p0 = live.players[0];
    for (let t = 0; t < seconds(150); t++) {
      if (t === 2) { const mcv = live.units.find((u) => u.owner === p0 && u.ut.deploysInto); if (mcv) { const c: Command = { c: 'deploy', player: 0, units: [mcv.id] }; rec.record(c); live.issue(c); } }
      if (t === seconds(40)) { const army = live.units.filter((u) => u.owner === p0 && u.weapons.length).map((u) => u.id); const c: Command = { c: 'move', player: 0, units: army, x: 60, y: 40, attackMove: true }; rec.record(c); live.issue(c); }
      live.step();
      live.events.length = 0;
    }
    // the replay file stores setup.customMap: rebuild from a JSON copy of it
    const replaySetup = JSON.parse(JSON.stringify({ customMap: def, mapId: def.id }));
    const again = make(replaySetup.customMap);
    const feeder = new CommandFeeder(again, rec.cmds, rec.hashes);
    hookStep(again, () => feeder.beforeStep(), () => feeder.afterStep());
    while (again.tick < live.tick) { again.step(); again.events.length = 0; }
    assert.ok(feeder.checked >= 3, `hashes compared (${feeder.checked})`);
    assert.equal(feeder.desyncTick, -1, 'no desync');
    assert.equal(worldHash(again), worldHash(live), 'identical final state');
  });

  test('saved maps with 2+ starts are offered in skirmish (getMapDef finds them); missions in Special operations', async () => {
    resetEditorStore();
    const def = riverMap();
    const doc = newDoc(def, null);
    await saveDoc(doc);
    assert.ok(customMaps().some((m) => m.id === doc.id), 'listed for the map picker');
    assert.equal(getMapDef(doc.id)?.name, 'Test River', 'getMapDef resolves custom ids');
    const solo = newDoc(newMapDef({ size: 64, symmetry: 'none', seed: 1 }), null);
    solo.map.starts = [[20.5, 20.5]];
    await saveDoc(solo);
    assert.ok(!customMaps().some((m) => m.id === solo.id), 'one-start maps are not skirmish maps');
    const withMission = newDoc(riverMap(), defaultMission(2));
    await saveDoc(withMission);
    assert.ok(customMissionDefs().some((m) => m.id === withMission.id && m.campaign === 'special'), 'custom mission listed');
    const setup = customMissionSetup(withMission.id)!;
    assert.equal(setup.customMission.id, withMission.id, 'deploy setup carries the mission');
    assert.equal(setup.customMap.name, 'Test River', 'and its map');
    resetEditorStore();
  });
});

describe('editor: custom missions', () => {
  /** Build the world exactly like Game does for a mission (players from the def, kit for player 0). */
  function missionWorld(cm: CustomMissionSetup, map: MapDef) {
    const def = customMissionDef(cm, map);
    const world = new World({
      map: buildMap(map), seed: def.map.seed, fog: def.fog ?? true, credits: def.credits ?? 5000, startUnits: 'none',
      startUnitsPer: def.players.map((_, i) => (i === 0 ? def.startUnits ?? 'none' : 'none')),
      creditsPer: def.players.map((ps, i) => (i === 0 ? def.credits : ps.credits ?? 5000)),
      players: def.players.map((ps, i) => ({ name: ps.name, faction: ps.faction, color: 0, team: ps.team ?? i, isHuman: i === 0, ai: i === 0 ? undefined : ps.ai === 'passive' || ps.ai === 'defensive' || !ps.ai ? 'normal' : ps.ai })),
    });
    const rt = new MissionRuntime(world, def);
    world.mission = rt;
    def.players.forEach((ps, i) => { if (i > 0 && ps.ai) rt.setAI(i, ps.ai); });
    def.setup(rt);
    return { world, rt, def };
  }

  const baseSpec = (): CustomMissionSetup => ({
    ...defaultMission(2), id: 'custom-test', title: 'Radar Raid',
    players: [
      { name: 'You', faction: 'allies', team: 0, ai: 'normal', credits: 0, startUnits: 'none' },
      { name: 'Enemy', faction: 'soviet', team: 1, ai: 'passive', credits: 0, startUnits: 'none' },
    ],
    placements: [
      { kind: 'unit', type: '2tnk', player: 0, x: 20.5, y: 60.5 },
      { kind: 'unit', type: '2tnk', player: 0, x: 21.5, y: 60.5, tag: 'escort' },
      { kind: 'structure', type: 'dome', player: 1, x: 56, y: 16, tag: 'radar', health: 0.3 },
      { kind: 'unit', type: 'e1', player: 1, x: 62.5, y: 12.5 },
    ],
    objectives: [{ id: 'o1', kind: 'destroy', text: 'Destroy the radar', primary: true, tag: 'radar' }, { id: 'o2', kind: 'protect', text: 'Keep the escort alive', primary: true, tag: 'escort' }],
    triggers: [
      { id: 't1', when: 'time', seconds: 5, actions: [{ kind: 'message', speaker: 'HQ', portrait: 'commander', text: 'Go!' }, { kind: 'reinforce', player: 0, units: ['e1', 'e1'], x: 2, y: 70, tx: 15, ty: 62 }] },
      { id: 't2', when: 'destroyed', tag: 'radar', actions: [{ kind: 'credits', player: 0, amount: 1000 }] },
    ],
  });

  test('validation catches broken missions', () => {
    const map = buildMap(riverMap());
    assert.deepEqual(checkMission(baseSpec(), 2).filter((i) => i.level === 'error'), [], 'valid spec');
    const bad = baseSpec();
    bad.objectives.push({ id: 'o1', kind: 'destroy', text: 'x', primary: true, tag: 'nope' });
    bad.triggers.push({ id: 't3', when: 'objectiveDone', objective: 'zz', actions: [] });
    bad.players.push({ name: 'C', faction: 'soviet', team: 1, ai: 'hard', credits: 0, startUnits: 'mcv' });
    bad.placements.push({ kind: 'structure', type: 'powr', player: 1, x: 56, y: 16 });
    const errs = [...checkMission(bad, 2), ...validateMission(bad, map)].filter((i) => i.level === 'error').map((i) => ('text' in i ? i.text : i.title)).join('\n');
    assert.match(errs, /used twice/, errs);
    assert.match(errs, /choose a tagged/, errs);
    assert.match(errs, /unknown objective/, errs);
    assert.match(errs, /3 players but the map has only 2/, errs);
    assert.match(errs, /overlaps another structure/, errs);
    const none = baseSpec();
    none.placements = none.placements.filter((p) => p.player !== 0);
    none.objectives = [{ id: 'o1', kind: 'destroy', text: 'x', primary: true, tag: 'radar' }];
    assert.ok(checkMission(none, 2).some((i) => i.level === 'error' && /no units/.test(i.text)), 'a human with nothing loses at once');
  });

  test('placements, tags, triggers and "destroy" / "protect" objectives play out; a save mid-mission continues identically', () => {
    const spec = baseSpec();
    const map = riverMap();
    const { world, rt } = missionWorld(spec, map);
    assert.equal(world.buildings.filter((b) => b.bt.id === 'dome').length, 1, 'radar placed');
    const radar = world.buildings.find((b) => b.bt.id === 'dome')!;
    assert.equal(radar.hp, Math.round(radar.maxHp * 0.3), 'pre-damaged');
    assert.deepEqual(rt.objectives.map((o) => o.id), ['o1', 'o2'], 'objectives shown');
    run(world, seconds(6));
    assert.ok(rt.events.some((e) => e.e === 'message' && e.text === 'Go!'), 'trigger message');
    assert.equal(world.units.filter((u) => u.owner.id === 0 && u.ut.id === 'e1').length, 2, 'reinforcements arrived');
    // save now, restore into a fresh world + runtime (no setup), as Game does
    const save = JSON.parse(JSON.stringify(serializeWorld(world)));
    const def2 = customMissionDef(JSON.parse(JSON.stringify(spec)), JSON.parse(JSON.stringify(map)));
    const w2 = new World({ map: buildMap(map), seed: def2.map.seed, fog: true, credits: 0, startUnits: 'none', players: world.players.map((p, i) => ({ name: p.name, faction: p.faction, color: 0, team: p.team, isHuman: i === 0, ai: i === 0 ? undefined : 'normal' })) });
    const rt2 = new MissionRuntime(w2, def2);
    w2.mission = rt2;
    rt2.setAI(1, 'passive');
    deserializeWorld(w2, save, rt2);
    // the player's tanks kill the radar
    for (const w of [world, w2]) {
      const tanks = w.units.filter((u) => u.owner.id === 0 && u.ut.id === '2tnk').map((u) => u.id);
      const target = w.buildings.find((b) => b.bt.id === 'dome')!;
      w.issue({ c: 'attack', player: 0, units: tanks, target: target.id });
    }
    for (let t = 0; t < seconds(120) && !rt.ended; t++) { world.step(); world.events.length = 0; w2.step(); w2.events.length = 0; }
    assert.ok(rt.ended && rt.won, `won (${rt.objectives.map((o) => o.id + ':' + o.state).join(', ')})`);
    assert.equal(rt.state('o2'), 'done', 'protect completes with the victory');
    assert.ok(rt2.ended && rt2.won, 'the restored mission wins too');
    assert.equal(worldHash(w2), worldHash(world), 'restored mission in sync');
    assert.ok(world.players[0].cash >= 1000, 'destroyed-tag trigger paid out');
  });

  test('survive, reach, build and hidden objectives; losing a protected unit fails the mission', () => {
    const map = riverMap();
    const survive: CustomMissionSetup = { ...baseSpec(), objectives: [{ id: 's', kind: 'survive', text: 'Hold', primary: true, seconds: 20 }], triggers: [] };
    const a = missionWorld(survive, map);
    run(a.world, seconds(10));
    assert.ok(!a.rt.ended, 'still running');
    run(a.world, seconds(12));
    assert.ok(a.rt.ended && a.rt.won, 'survived');

    const reach: CustomMissionSetup = {
      ...baseSpec(),
      objectives: [{ id: 'r', kind: 'reach', text: 'Reach the hill', primary: true, x: 30, y: 60, r: 3 }, { id: 'h', kind: 'destroyAll', text: 'Then clear the area', primary: true, hidden: true, player: 1 }],
      triggers: [{ id: 'reveal', when: 'objectiveDone', objective: 'r', actions: [{ kind: 'objective', objective: 'h' }] }],
    };
    const b = missionWorld(reach, map);
    assert.deepEqual(b.rt.objectives.map((o) => o.id), ['r'], 'hidden objective not shown yet');
    const tanks = b.world.units.filter((u) => u.owner.id === 0).map((u) => u.id);
    b.world.issue({ c: 'move', player: 0, units: tanks, x: 30, y: 60, attackMove: false });
    for (let t = 0; t < seconds(60) && b.rt.state('r') !== 'done'; t++) { b.world.step(); b.world.events.length = 0; }
    assert.equal(b.rt.state('r'), 'done', 'reached');
    run(b.world, 3);
    assert.ok(b.rt.objectives.some((o) => o.id === 'h'), 'hidden objective revealed by the trigger');
    assert.ok(!b.rt.ended, 'not won before the revealed objective is done');

    const protect = baseSpec();
    const c = missionWorld(protect, map);
    const escortId = (c.rt.flags['cm.tags'] as Record<string, number>).escort;
    const escort = c.world.getEntity(escortId)!;
    c.world.kill(escort);
    run(c.world, 3);
    assert.ok(c.rt.ended && !c.rt.won, 'protected unit lost: defeat');
    assert.match(c.rt.endReason ?? '', /Keep the escort alive/, 'reason names the objective');
  });

  test('mission files are sanitised (garbage never reaches the runtime)', () => {
    const r = sanitizeMission({ players: [{ name: 5, faction: 'martian', ai: 'godlike', credits: 'lots' }], placements: 'x', objectives: [{ kind: 'win-now' }], triggers: [{ when: 'never', actions: [{ kind: 'eval', text: 'alert(1)' }] }] });
    assert.ok(Array.isArray(r) && r.some((e) => e.startsWith('placements')), 'structural errors reported');
    const ok = sanitizeMission({ title: 'T', players: [{ name: 'P', faction: 'martian', ai: 'godlike', credits: 'lots' }], objectives: [{ kind: 'win-now' }], triggers: [{ when: 'never', actions: [{ kind: 'eval' }] }] }) as MissionSpec;
    assert.ok(!Array.isArray(ok), 'coerced');
    assert.equal(ok.players[0].faction, 'allies', 'faction coerced');
    assert.equal(ok.players[0].ai, 'normal', 'AI coerced');
    assert.equal(ok.objectives[0].kind, 'destroyAll', 'objective kind coerced');
    assert.equal(ok.triggers[0].when, 'start', 'trigger coerced');
    assert.equal(ok.triggers[0].actions[0].kind, 'message', 'no unknown actions');
    void TICK_HZ;
  });
});
