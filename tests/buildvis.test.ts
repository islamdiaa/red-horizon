// Commander-rules structure models and upgrade modules (render/models/commander-structures.ts, upgrade-modules.ts):
// every new building has a procedural model per owner faction within budget, every upgrade of every host has a
// module, and the module API attaches, builds in, mirrors, removes, scaffolds and breaks off modules correctly.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BUILDINGS } from '../src/data/rules';
import { UPGRADES } from '../src/sim/economy-data';
import { createModel, listModelIds, modelBodyGeometry, modelKey } from '../src/render/models';
import { COMMANDER_BUILDERS, MODULE_BUILDERS, MODULE_MODEL_IDS } from '../src/render/models/commander-structures';
import {
  MODULE_BUILD_TIME, UPGRADE_ANCHORS, applyUpgradeModules, breakUpgradeModules, moduleAnchor, moduleBodyGeometry, setUpgradeScaffold,
  tickUpgradeModules, updateCommanderView, upgradeModulesOf, type UpgradeView,
} from '../src/render/models/upgrade-modules';
import { PhysicsWorld } from '../src/render/destruction-physics';
import type { ModelAnimState } from '../src/render/models/types';

const FACS = ['soviet', 'allies'] as const;
const commanderIds = Object.values(BUILDINGS).filter((b) => b.commander).map((b) => b.id);
const ownersOf = (id: string): ('soviet' | 'allies')[] => {
  const o = BUILDINGS[id].owner as ('soviet' | 'allies')[] | undefined;
  return o && o.length ? o : [...FACS];
};
const tris = (g: THREE.BufferGeometry | null) => (g ? (g.index ? g.index.count : g.getAttribute('position').count) / 3 : 0);

function anim(o: Partial<ModelAnimState> = {}): ModelAnimState {
  return { time: 1, dt: 1 / 30, moving: false, speed: 0, firing: 0, firingMuzzle: 0, powered: true, health: 1, door: 0, load: 0, harvesting: false, charge: 1, dying: 0, ...o };
}

function view(type: string, fac: 'soviet' | 'allies' = 'soviet'): UpgradeView & { model: ReturnType<typeof createModel>; anim: ModelAnimState; chimneys: { dispose(): void }[] } {
  const model = createModel(type, new THREE.Color(fac === 'soviet' ? 0xd23a2c : 0x3d7be0), fac);
  return { model, ptype: type, ent: { owner: { color: fac === 'soviet' ? 0xd23a2c : 0x3d7be0, faction: fac } }, anim: anim(), chimneys: [] };
}

describe('Commander structures: models', () => {
  test('the rules list the seven Commander structures', () => {
    for (const id of ['purf', 'smlt', 'mout', 'lgst', 'bnkr', 'gate', 'rlab']) assert.ok(commanderIds.includes(id), `${id} is a Commander structure in the rules`);
  });

  test('every Commander structure has its own model for each owner faction, within budget, with a distant body', () => {
    const ids = listModelIds();
    for (const id of commanderIds) {
      assert.ok(ids.includes(id) && COMMANDER_BUILDERS[id], `${id}: registered model`);
      for (const fac of ownersOf(id)) {
        const g = modelBodyGeometry(id, false, fac);
        const lo = modelBodyGeometry(id, true, fac);
        assert.ok(g, `${id}.${fac}: builds a body`);
        const n = tris(g);
        assert.ok(n > 400 && n <= 9000, `${id}.${fac}: ${n} triangles (procedural budget 9000)`);
        assert.ok(lo && tris(lo) < n, `${id}.${fac}: lighter distant body (${tris(lo)} < ${n})`);
        // footprint: the body stays on its cells (a little slack for lamps and trims)
        g!.computeBoundingBox();
        const b = g!.boundingBox!;
        const [w, h] = BUILDINGS[id].size;
        assert.ok(b.min.x >= -w / 2 - 0.06 && b.max.x <= w / 2 + 0.06 && b.min.z >= -h / 2 - 0.06 && b.max.z <= h / 2 + 0.06,
          `${id}.${fac}: body within its ${w}x${h} footprint (${b.min.x.toFixed(2)}..${b.max.x.toFixed(2)}, ${b.min.z.toFixed(2)}..${b.max.z.toFixed(2)})`);
      }
    }
  });

  test('shared Commander structures are dressed per owner faction', () => {
    for (const id of commanderIds.filter((i) => ownersOf(i).length === 2)) {
      assert.notEqual(modelKey(id, 'soviet'), modelKey(id, 'allies'), `${id}: one template per faction`);
      assert.notEqual(modelBodyGeometry(id, false, 'soviet'), modelBodyGeometry(id, false, 'allies'), `${id}: different dressing`);
    }
  });

  test('bunker: eight slit muzzles, garrison helmets follow the fill (anim.load)', () => {
    const v = view('bnkr');
    assert.equal(v.model.muzzles.length, 8, 'two firing slits per side');
    for (let i = 0; i < 8; i++) assert.ok(v.model.node?.(`m${i}`), `muzzle m${i}`);
    const shown = () => [0, 1, 2, 3].filter((k) => v.model.node!(`g${k}`)!.scale.x > 0.5).length;
    v.model.update(anim({ load: 0 }));
    assert.equal(shown(), 0, 'empty bunker: no helmets');
    v.model.update(anim({ load: 0.5 }));
    assert.equal(shown(), 2, 'two soldiers inside');
    v.model.update(anim({ load: 1 }));
    assert.equal(shown(), 4, 'full garrison');
    v.model.dispose();
  });

  test('gate: the door rises with anim.door, the gate turns along a north-south wall line', () => {
    const v = view('gate');
    const door = v.model.node!('door')!;
    for (let i = 0; i < 60; i++) v.model.update(anim({ door: 1, time: 1 + i / 30 }));
    assert.ok(door.position.y > 0.6, `open door lifted (${door.position.y.toFixed(2)})`);
    for (let i = 0; i < 60; i++) v.model.update(anim({ door: 0, time: 3 + i / 30 }));
    assert.ok(door.position.y < 0.05, `shut door down (${door.position.y.toFixed(2)})`);
    // walls north and south of the gate's cell
    const occ = new Int32Array(16 * 16);
    const idx = (x: number, y: number) => y * 16 + x;
    occ[idx(5, 4)] = 101;
    occ[idx(5, 6)] = 102;
    const world = {
      map: { inBounds: (x: number, y: number) => x >= 0 && y >= 0 && x < 16 && y < 16, idx, occupant: occ },
      getEntity: (id: number) => (id > 100 ? { bt: { wall: true } } : undefined),
    };
    const b = { cx: 5, cy: 5, bt: { id: 'gate', gate: true } };
    updateCommanderView(v, b, world);
    assert.ok(Math.abs(v.model.node!('gate')!.rotation.y - Math.PI / 2) < 1e-6, 'turned for a north-south wall');
    occ[idx(5, 4)] = 0;
    occ[idx(5, 6)] = 0;
    occ[idx(4, 5)] = 101;
    occ[idx(6, 5)] = 102;
    updateCommanderView(v, b, world);
    assert.equal(v.model.node!('gate')!.rotation.y, 0, 'spans east-west between walls left and right');
    v.model.dispose();
  });

  test('research lab glows while research runs; bunker fill comes from the garrison', () => {
    const lab = view('rlab');
    updateCommanderView(lab, { cx: 0, cy: 0, bt: { id: 'rlab' }, task: { kind: 'research', id: 'x', progress: 0.3 } });
    assert.equal(lab.anim.load, 1, 'research running');
    updateCommanderView(lab, { cx: 0, cy: 0, bt: { id: 'rlab' }, task: null });
    assert.equal(lab.anim.load, 0, 'idle');
    const bk = view('bnkr');
    updateCommanderView(bk, { cx: 0, cy: 0, bt: { id: 'bnkr', garrison: 4 }, garrison: [1, 2, 3] });
    assert.equal(bk.anim.load, 0.75, 'three of four');
    lab.model.dispose();
    bk.model.dispose();
  });
});

describe('upgrade modules: coverage', () => {
  test('every upgrade on every host it applies to has a module anchor and a model', () => {
    for (const u of Object.values(UPGRADES)) {
      for (const host of u.hosts) {
        const a = moduleAnchor(host, u.id);
        assert.ok(a, `${host} + ${u.id}: module anchor`);
        assert.ok(MODULE_BUILDERS[a!.model], `${host} + ${u.id}: module model ${a!.model}`);
      }
    }
  });

  test('module models build for both factions within budget', () => {
    for (const id of MODULE_MODEL_IDS) {
      for (const fac of FACS) {
        const g = moduleBodyGeometry(id, fac);
        const n = tris(g);
        assert.ok(g && n > 40 && n <= 5000, `${id}.${fac}: ${n} triangles (module budget 5000)`);
      }
    }
  });

  test('ground modules stay inside their host footprint', () => {
    for (const [host, ups] of Object.entries(UPGRADE_ANCHORS)) {
      const [w, h] = BUILDINGS[host].size;
      for (const [up, a] of Object.entries(ups)) {
        const g = moduleBodyGeometry(a.model, 'soviet')!;
        g.computeBoundingBox();
        const b = g.boundingBox!.clone();
        const rot = new THREE.Matrix4().makeRotationY(a.rotY ?? 0);
        b.applyMatrix4(rot).translate(new THREE.Vector3(a.at[0], 0, a.at[2]));
        const m = 0.12;
        assert.ok(b.min.x >= -w / 2 - m && b.max.x <= w / 2 + m && b.min.z >= -h / 2 - m && b.max.z <= h / 2 + m,
          `${host} + ${up}: module inside the ${w}x${h} footprint (${b.min.x.toFixed(2)}..${b.max.x.toFixed(2)}, ${b.min.z.toFixed(2)}..${b.max.z.toFixed(2)})`);
      }
    }
  });
});

describe('upgrade modules: API', () => {
  test('first application shows finished modules at their anchors; later upgrades build in', () => {
    const v = view('fact');
    applyUpgradeModules(v, ['cy_t2']);
    let mods = upgradeModulesOf(v.model);
    assert.equal(mods.length, 1, 'one module');
    assert.equal(mods[0].model, 'mcy2', 'the yard bay');
    assert.equal(mods[0].t, 1, 'shown finished at once (a new view)');
    assert.equal(mods[0].root.parent, v.model.root, 'attached to the host root');
    const a = UPGRADE_ANCHORS.fact.cy_t2.at;
    assert.ok(mods[0].root.position.distanceTo(new THREE.Vector3(...a)) < 1e-6, 'at the anchor');
    // no change: no work
    applyUpgradeModules(v, ['cy_t2']);
    assert.equal(upgradeModulesOf(v.model).length, 1, 'unchanged');
    applyUpgradeModules(v, ['cy_t2', 'cy_t3', 'research_only_id']);
    mods = upgradeModulesOf(v.model);
    assert.equal(mods.length, 2, 'ids without a module are ignored');
    const t3 = mods.find((m) => m.upgrade === 'cy_t3')!;
    assert.ok(t3.t < 1, 'the new module builds in');
    assert.ok(t3.root.scale.y < 0.2, `starts low (${t3.root.scale.y.toFixed(2)})`);
    for (let t = 0; t < MODULE_BUILD_TIME + 0.2; t += 0.1) tickUpgradeModules(10 + t, 0.1);
    const done = upgradeModulesOf(v.model).find((m) => m.upgrade === 'cy_t3')!;
    assert.equal(done.t, 1, 'finished');
    assert.equal(done.root.scale.y, 1, 'full height');
    // removal
    applyUpgradeModules(v, ['cy_t3']);
    assert.deepEqual(upgradeModulesOf(v.model).map((m) => m.upgrade), ['cy_t3'], 'cy_t2 removed');
    v.model.dispose();
    assert.equal(upgradeModulesOf(v.model).length, 0, 'disposed with the host');
  });

  test('modules mirror the host animation (damage variant) and add their stacks to the host smoke', () => {
    const v = view('powr');
    const before = v.model.smokePoints?.length ?? 0;
    v.chimneys.push({ dispose() {} });
    applyUpgradeModules(v, ['powr_turbine']);
    const mod = upgradeModulesOf(v.model)[0];
    assert.equal(v.model.smokePoints!.length, before + 2, 'turbine stacks smoke');
    assert.equal(v.chimneys.length, 0, 'chimney emitters re-made by the renderer');
    v.model.update(anim({ health: 0.2 }));
    let mat = '';
    mod.root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !mat && m.material) mat = (m.material as THREE.Material).name; });
    assert.ok(/^body-[0-9a-f]+-2/.test(mat), `module wrecked with its host (${mat})`);
    v.model.dispose();
  });

  test('an upgrade in progress shows a scaffold that completes into the module', () => {
    const v = view('dome');
    applyUpgradeModules(v, []);
    setUpgradeScaffold(v, 'dome_uplink', 0.5);
    let m = upgradeModulesOf(v.model);
    assert.equal(m.length, 1, 'scaffold');
    assert.ok(m[0].scaffold && Math.abs(m[0].root.scale.y - 0.46) < 0.01, `half built (${m[0].root.scale.y.toFixed(2)})`);
    // the sim completes it
    updateCommanderView(v, { cx: 0, cy: 0, bt: { id: 'dome' }, upgrades: ['dome_uplink'], task: null });
    m = upgradeModulesOf(v.model);
    assert.ok(!m[0].scaffold && m[0].t < 1, 'completing');
    for (let t = 0; t < 2; t += 0.1) tickUpgradeModules(20 + t, 0.1);
    assert.equal(upgradeModulesOf(v.model)[0].t, 1, 'complete');
    // a cancelled scaffold goes away
    const w = view('weap');
    updateCommanderView(w, { cx: 0, cy: 0, bt: { id: 'weap' }, task: { kind: 'upgrade', id: 'weap_armor', progress: 0.2 } });
    assert.equal(upgradeModulesOf(w.model).length, 1, 'armour shop scaffold');
    updateCommanderView(w, { cx: 0, cy: 0, bt: { id: 'weap' }, upgrades: [], task: null });
    assert.equal(upgradeModulesOf(w.model).length, 0, 'cancelled: gone');
    v.model.dispose();
    w.model.dispose();
  });

  test('a collapsing host throws its modules off as rigid bodies that settle and go', () => {
    const scene = new THREE.Scene();
    const v = view('weap');
    scene.add(v.model.root);
    applyUpgradeModules(v, ['weap_assembly', 'weap_armor']);
    const physics = new PhysicsWorld(() => 0, 8);
    breakUpgradeModules(v.model, physics);
    assert.equal(upgradeModulesOf(v.model).length, 0, 'detached from the host');
    assert.equal(physics.used, 2, 'two debris bodies');
    const pieces = scene.children.filter((o) => o.name.startsWith('module:'));
    assert.equal(pieces.length, 2, 'the modules now live in the scene');
    const y0 = pieces[0].position.y;
    for (let t = 0; t < 7; t += 1 / 30) {
      physics.update(1 / 30);
      tickUpgradeModules(30 + t, 1 / 30);
    }
    assert.ok(pieces[0].position.y < y0, 'fell');
    assert.equal(physics.used, 0, 'bodies released');
    assert.equal(scene.children.filter((o) => o.name.startsWith('module:')).length, 0, 'debris removed');
    v.model.dispose();
  });
});
