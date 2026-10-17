// Destruction & physics visuals: fracture baking, the rigid-body solver, ragdolls, crater policy,
// model LODs and the Aftermath unit models. Pure render-side code exercised without a WebGL context.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PhysicsWorld } from '../src/render/destruction-physics';
import { bakeFracture } from '../src/render/destruction-fracture';
import { Ragdoll } from '../src/render/destruction-ragdoll';
import { Destruction } from '../src/render/destruction';
import { listModelIds, modelBodyGeometry } from '../src/render/models';
import { STRUCTURE_BUILDERS } from '../src/render/models/structures';
import { VEHICLE_BUILDERS } from '../src/render/models/vehicles';
import { INFANTRY_BUILDERS } from '../src/render/models/infantry';
import { instantiate } from '../src/render/models/builder';
import type { Effects } from '../src/render/effects';
import type { GameMap } from '../src/sim/map';

const flat = () => 0;

describe('destruction: rigid-body solver', () => {
  test('a tumbling box lands on flat ground, comes to rest on it and sleeps', () => {
    const w = new PhysicsWorld(flat, 4);
    const b = w.alloc()!;
    b.setBox(0.2, 0.08, 0.15);
    b.p.set(0, 1, 0);
    b.v.set(0.5, 1, 0.2);
    b.w.set(2, 1, 3);
    let t = 0;
    let lowest = Infinity;
    const c = new THREE.Vector3();
    while (t < 6 && !b.sleeping) {
      w.update(1 / 60);
      t += 1 / 60;
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
        c.set(sx * b.he.x, sy * b.he.y, sz * b.he.z).applyQuaternion(b.q).add(b.p);
        lowest = Math.min(lowest, c.y);
      }
    }
    assert.ok(b.sleeping, `asleep within 6 s (t=${t.toFixed(2)})`);
    assert.ok(lowest > -0.12, `never sinks deep into the ground (lowest corner ${lowest.toFixed(3)})`);
    assert.ok(b.p.y > 0.05 && b.p.y < 0.25, `rests on the ground (y=${b.p.y.toFixed(3)})`);
  });

  test('a wreck slides / tumbles down a steep slope before settling', () => {
    const slope = (x: number) => -x * 0.6;
    const w = new PhysicsWorld(slope, 2);
    const b = w.alloc()!;
    b.setBox(0.3, 0.1, 0.2);
    b.p.set(0, 0.4, 0);
    b.v.set(0, 0.5, 0);
    let t = 0;
    while (t < 10 && !b.sleeping) {
      w.update(1 / 60);
      t += 1 / 60;
    }
    assert.ok(b.p.x > 0.3, `moved downhill (x=${b.p.x.toFixed(2)})`);
    assert.ok(b.sleeping, 'eventually sleeps');
  });

  test('the body pool is bounded and reusable', () => {
    const w = new PhysicsWorld(flat, 3);
    const a = [w.alloc(), w.alloc(), w.alloc()];
    assert.ok(a.every(Boolean), 'three bodies');
    assert.equal(w.alloc(), null, 'pool exhausted');
    w.release(a[1]!);
    assert.ok(w.alloc(), 'a released body is reused');
  });
});

describe('destruction: fracture bake', () => {
  test('structures split into chunks that keep every triangle (plus interior twins), deterministically', () => {
    for (const id of ['powr', 'weap', 'tsla', 'fact']) {
      const t = STRUCTURE_BUILDERS[id]?.() ?? null;
      const geo = t?.skin?.geo ?? modelBodyGeometry(id)!;
      const fp: [number, number] = id === 'tsla' ? [1, 2] : id === 'powr' ? [2, 2] : [3, 3];
      const f = bakeFracture(geo, id, fp);
      const src = geo.index!.count / 3;
      const out = f.geo.index!.count / 3;
      assert.ok(f.chunks.length >= 6 && f.chunks.length <= 23, `${id}: ${f.chunks.length} chunks`);
      assert.ok(f.chunks[0].base, `${id}: chunk 0 is the static foundation`);
      assert.equal(f.inverses.length, f.chunks.length, `${id}: one bone per chunk`);
      assert.ok(out >= src * 2, `${id}: ${out} tris >= 2 x ${src} (front faces + interior twins, clipped)`);
      assert.ok(out <= src * 2 * 2.2, `${id}: clipping stays cheap (${out} tris for ${src})`);
      const si = f.geo.getAttribute('skinIndex') as THREE.BufferAttribute;
      let maxBone = 0;
      for (let i = 0; i < si.count; i++) maxBone = Math.max(maxBone, si.getX(i));
      assert.ok(maxBone < f.chunks.length, `${id}: skin indices in range`);
      assert.ok(f.anchors.length >= 1, `${id}: roof anchors for damage fires`);
      const again = bakeFracture(geo, id, fp);
      assert.equal(again.geo.index!.count, f.geo.index!.count, `${id}: same type breaks the same way`);
    }
  });
});

describe('destruction: ragdoll', () => {
  test('an infantry ragdoll falls, stays above the ground and goes to sleep', () => {
    for (const kind of ['normal', 'blown', 'burn', 'electro'] as const) {
      const m = instantiate(INFANTRY_BUILDERS.e1(), new THREE.Color(0x3d7be0), 'e1');
      m.root.position.set(0, 0, 0);
      m.root.updateMatrixWorld(true);
      assert.ok(Ragdoll.fits(m), 'soldier skeleton is supported');
      const r = new Ragdoll();
      r.start(m, kind, 1, 0);
      const headY0 = r.p[2 * 3 + 1];
      let t = 0;
      let minY = Infinity;
      while (t < 5 && !r.asleep) {
        r.update(1 / 60, flat);
        t += 1 / 60;
        for (let i = 0; i < 11; i++) minY = Math.min(minY, r.p[i * 3 + 1]);
      }
      assert.ok(r.asleep, `${kind}: asleep by ${t.toFixed(2)} s`);
      assert.ok(minY > -0.01, `${kind}: never below the ground (${minY.toFixed(3)})`);
      assert.ok(r.p[2 * 3 + 1] < headY0 - 0.15, `${kind}: the head ends up near the ground`);
      const torso = m.node!('torso')!;
      assert.ok(Number.isFinite(torso.quaternion.x) && Number.isFinite(torso.position.y), `${kind}: bones posed with finite values`);
      m.dispose();
    }
  });
});

describe('destruction: crater policy', () => {
  test('craters are pressed through the terrain with a per-frame and stacking cap', () => {
    const calls: number[][] = [];
    const map = { heightAt: () => 0, surfaceAt: () => 0, w: 64, h: 64 } as unknown as GameMap;
    const noop = () => {};
    const effects = { dust: noop, explosion: noop, scorch: noop, waterSplash: noop, chronoFlash: noop, createEmitter: () => ({ setPosition: noop, setIntensity: noop, dispose: noop }), shake: 0 } as unknown as Effects;
    const d = new Destruction(new THREE.Scene(), effects, map);
    d.setTerrain({ renderHeight: () => 0, deform: (x, y, r, dep) => calls.push([x, y, r, dep]) });
    d.update(0.016, 1);
    for (let i = 0; i < 6; i++) d.onImpact(10 + i * 3, 10, 0.1, 'huge', 1);
    assert.equal(calls.length, 3, 'at most 3 craters per frame');
    d.update(0.016, 1.1);
    for (let i = 0; i < 6; i++) d.crater(30, 30, 1, 0.1);
    assert.ok(calls.length <= 3 + 3, 'repeated hits on one spot stop deepening');
    d.update(0.016, 1.2);
    d.onImpact(40, 40, 3, 'huge', 1);
    assert.ok(calls.every((c) => c[3] > 0), 'only digging (positive depth) so far');
    const before = calls.length;
    d.onImpact(40, 40, 5, 'huge', 1);
    assert.equal(calls.length, before, 'an air burst leaves no crater');
    d.dispose();
  });
});

describe('models: LODs and the Aftermath units', () => {
  test('tanks carry close-up detail that the distant body drops', () => {
    for (const id of ['1tnk', '2tnk', '3tnk', '4tnk']) {
      const t = VEHICLE_BUILDERS[id]();
      assert.ok(t.skin?.geoLo, `${id}: has a distant body`);
      const hi = t.skin!.geo.index!.count / 3, lo = t.skin!.geoLo!.index!.count / 3;
      assert.ok(lo < hi * 0.9, `${id}: distant body is lighter (${lo} < ${hi})`);
      assert.ok(lo <= 1000, `${id}: distant body within budget (${lo})`);
    }
  });

  test('every Aftermath / Counterstrike unit id has its own model within budget', () => {
    const ids = listModelIds();
    const budget: Record<string, number> = { ttnk: 1800, qtnk: 1900, ctnk: 1600, dtrk: 1500, stnk: 1200, shok: 900, mech: 900, msub: 2200 };
    for (const [id, max] of Object.entries(budget)) {
      assert.ok(ids.includes(id), `${id} registered`);
      const g = modelBodyGeometry(id);
      assert.ok(g, `${id} builds a body`);
      const tris = g!.index!.count / 3;
      assert.ok(tris > 300 && tris <= max, `${id}: ${tris} triangles (budget ${max})`);
    }
  });
});
