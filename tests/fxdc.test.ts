/**
 * Effects director's cut, without a GPU: the heat-haze source store and its quality / reduced-motion gating,
 * lens-rain gating (cinematics and photo mode only, never in play, never on Low), particle lighting by preset,
 * and the persistent battlefield damage: the scorch-mark LRU budget, the crater / burn / burnt-tree ledger
 * (merge, LRU eviction, budgets), its save-game snapshot (round trip and hostile input) and the destruction
 * system's crater policy on top of it.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { HeatSources, hazeSettings, HEAT_STRIDE, type HeatApi } from '../src/render/effects/heathaze';
import { explosionHeat, exhaustHeat, fireHeat } from '../src/render/effects/heatfx';
import { lensRainTarget, stepLensRain } from '../src/render/cinematicfx';
import { particleLighting, particleLightColors, DAY_LIGHT, DAY_SHADOW } from '../src/render/effects/smokelight';
import { LruSlots, ScarDecals, SCAR_CAPACITY } from '../src/render/effects/scars';
import { DecalSystem } from '../src/render/effects/decals';
import { ScarLedger, SCAR_BUDGET, CRATER_MAX_DEPTH } from '../src/render/destruction-scars';
import { Destruction } from '../src/render/destruction';
import type { Effects } from '../src/render/effects';
import type { GameMap } from '../src/sim/map';

function camera(): THREE.PerspectiveCamera {
  const c = new THREE.PerspectiveCamera(40, 16 / 9, 0.5, 400);
  c.position.set(32, 20, 46);
  c.lookAt(32, 0, 32);
  c.updateMatrixWorld(true);
  return c;
}

describe('heat haze', () => {
  test('gating: off on Low and with reduced motion; half resolution on High, quarter on Medium', () => {
    assert.equal(hazeSettings('low').enabled, false, 'no haze buffer on Low');
    assert.equal(hazeSettings('high', true).enabled, false, 'reduced motion switches the shimmer off');
    assert.equal(hazeSettings('medium', true).enabled, false, 'reduced motion on Medium too');
    const hi = hazeSettings('high'), med = hazeSettings('medium');
    assert.ok(hi.enabled && hi.scale === 0.5, 'High: half-resolution buffer');
    assert.ok(med.enabled && med.scale === 0.25, 'Medium: quarter-resolution buffer');
    assert.ok(med.cap < hi.cap && med.cap > 0, 'fewer sources drawn on Medium');
  });

  test('sources: per-frame ones are consumed, timed ones cool and expire, nothing behind the camera', () => {
    const h = new HeatSources();
    const cam = camera();
    const out = new Float32Array(64 * HEAT_STRIDE);
    h.add(32, 0, 32, 0.5, 2, 0.03, 0); // a fire, this frame
    h.add(32, 0, 30, 1, 3, 0.05, 2); // an explosion's heat bubble
    h.add(32, 0, 200, 1, 3, 0.05, 2); // far behind the camera
    assert.equal(h.prepare(cam, out, 64), 2, 'the fire and the bubble are drawn, the one behind is culled');
    assert.ok(out[5] > 0 && out[HEAT_STRIDE + 5] > 0, 'positive strengths');
    h.now = 1;
    assert.equal(h.prepare(cam, out, 64), 1, 'the fire was consumed; the bubble is still cooling');
    const s1 = out[5];
    h.now = 1.6;
    h.prepare(cam, out, 64);
    assert.ok(out[5] < s1, 'the bubble cools down');
    h.now = 2.5;
    assert.equal(h.prepare(cam, out, 64), 0, 'and expires');
    assert.ok(h.size <= 1, 'expired sources are released (only the culled far one may remain)');
  });

  test('sources: over the cap the strongest are drawn; small exhausts only up close', () => {
    const h = new HeatSources();
    const cam = camera();
    const out = new Float32Array(8 * HEAT_STRIDE);
    for (let i = 0; i < 20; i++) h.add(26 + i * 0.6, 0, 32, 0.4, 1.5, 0.01 + (i === 7 ? 0.2 : 0), 0);
    assert.equal(h.prepare(cam, out, 4), 4, 'capped');
    let found = false;
    for (let k = 0; k < 4; k++) if (out[k * HEAT_STRIDE + 5] > 0.15) found = true;
    assert.ok(found, 'the strongest source is among the drawn ones');
    h.add(32, 0, 32, 0.12, 0.45, 0.012, 0, { range: 16 }); // an exhaust 26 units away
    assert.equal(h.prepare(cam, out, 4), 0, 'an engine exhaust is not drawn from the RTS camera');
  });
});

describe('heat recipes', () => {
  const rec = () => {
    const calls: { r: number; s: number; d: number; range?: number }[] = [];
    const api: HeatApi = { add: (_x, _y, _z, r, _h, s, d, o) => { calls.push({ r, s, d, range: o?.range }); } };
    return { calls, api };
  };
  test('bigger blasts heat more air for longer; bullets and splashes none', () => {
    const peak = (k: Parameters<typeof explosionHeat>[1]) => {
      const { calls, api } = rec();
      explosionHeat(api, k, 10, 0.5, 10, 0, 1);
      return calls.reduce((m, c) => Math.max(m, c.s * c.r * c.d), 0);
    };
    assert.equal(peak('piff'), 0, 'a bullet hit makes no haze');
    assert.equal(peak('none'), 0, 'nothing for none');
    assert.ok(peak('small') < peak('medium') && peak('medium') < peak('large') && peak('large') < peak('huge') && peak('huge') < peak('nuke'), 'ordered by size');
  });
  test('fires shimmer every frame; engine exhausts only up close; everything subtle', () => {
    const { calls, api } = rec();
    fireHeat(api, 0, 0, 0, 1, 1);
    exhaustHeat(api, 0, 0, 0, 1);
    assert.equal(calls[0].d, 0, 'a fire is a per-frame source');
    assert.ok(calls[1].range !== undefined && calls[1].range < 20, 'exhaust haze has a short draw range');
    assert.ok(calls.every((c) => c.s < 0.05), 'a few pixels at most from the RTS camera');
  });
});

describe('lens rain', () => {
  test('only in cinematic moments and photo mode in the rain, never in normal play, never on Low', () => {
    assert.equal(lensRainTarget({ quality: 'high', moment: false, rain: 1 }), 0, 'normal play in a storm: no drops');
    assert.equal(lensRainTarget({ quality: 'low', moment: true, rain: 1 }), 0, 'Low: no lens rain');
    assert.equal(lensRainTarget({ quality: 'high', moment: true, rain: 0 }), 0, 'a dry cinematic: no drops');
    assert.ok(lensRainTarget({ quality: 'medium', moment: true, rain: 0.8 }) > 0.7, 'a storm intro on Medium: drops');
  });

  test('drops gather over a second or two and are gone fast when the moment ends', () => {
    let v = 0;
    for (let i = 0; i < 30; i++) v = stepLensRain(v, 1, 1 / 30, true);
    assert.ok(v > 0.4 && v < 0.9, `gathering (${v.toFixed(2)})`);
    for (let i = 0; i < 60; i++) v = stepLensRain(v, 1, 1 / 30, true);
    assert.equal(v, 1, 'full');
    for (let i = 0; i < 15; i++) v = stepLensRain(v, 0, 1 / 30, false);
    assert.equal(v, 0, 'dry within half a second of returning to play');
  });
});

describe('particle lighting', () => {
  test('Low keeps the lightweight shaders; medium / high get soft depth and fire light', () => {
    assert.deepEqual(particleLighting('low', true, true), { soft: false, dyn: false }, 'Low: none');
    assert.deepEqual(particleLighting('medium', true, true), { soft: true, dyn: true }, 'Medium: both');
    assert.deepEqual(particleLighting('high', false, true), { soft: false, dyn: true }, 'no depth copy on preview pages');
  });

  test('smoke follows the sun and sky: daylight is the authored look, night is dark and blue', () => {
    const L = new THREE.Color(), S = new THREE.Color();
    particleLightColors({ sunK: new THREE.Color(1, 1, 1), skyK: new THREE.Color(1, 1, 1) }, L, S);
    assert.ok(Math.abs(L.r - DAY_LIGHT.r) < 1e-6 && Math.abs(S.b - DAY_SHADOW.b) < 1e-6, 'noon = authored colours');
    particleLightColors({ sunK: new THREE.Color(0.05, 0.08, 0.17), skyK: new THREE.Color(0.06, 0.08, 0.13) }, L, S);
    assert.ok(L.r < 0.1 && L.b > L.r, `moonlit smoke is dark and cool (${L.r.toFixed(3)}, ${L.b.toFixed(3)})`);
  });
});

describe('persistent scorch marks', () => {
  test('LRU slots: the live count stays within budget, the least recently touched go first, fades finish before reuse', () => {
    const s = new LruSlots(10, 2);
    const ret: number[] = [];
    const order: number[] = [];
    let t = 0;
    for (let i = 0; i < 8; i++) order.push(s.alloc(t++, 3, ret));
    assert.equal(s.liveCount, 8, 'fills up to cap - reserve');
    s.touch(order[0], t++); // the first mark was hit again
    const k = s.alloc(t++, 3, ret);
    assert.ok(k >= 0, 'still a free slot');
    assert.deepEqual(ret, [order[1]], 'the least recently touched mark is retired, not the refreshed first one');
    assert.ok(s.liveCount <= 8, 'live within budget');
    for (let i = 0; i < 30; i++) {
      s.alloc(t, 3, ret);
      t += 0.5;
      assert.ok(s.liveCount <= 8, 'live count never exceeds the budget');
    }
    // a retired slot is not handed out while it fades
    const s2 = new LruSlots(3, 1);
    s2.alloc(0, 5, ret); s2.alloc(1, 5, ret);
    const third = s2.alloc(2, 5, ret);
    assert.equal(ret.length, 1, 'one retired');
    const r0 = ret[0];
    assert.notEqual(third, r0, 'the fading slot is not reused at once');
    assert.equal(s2.alloc(3, 5, ret), -1, 'all slots live or fading: the mark is skipped');
    assert.ok(s2.alloc(7.5, 5, ret) >= 0, 'after the fade the slot is free again');
  });

  test('scar decals merge onto the same spot and bake retired marks into the burn map', () => {
    const tex = new THREE.Texture();
    const layer = new DecalSystem(SCAR_CAPACITY.low, tex, () => 0, { uTime: { value: 0 } }, 1);
    const scars = new ScarDecals(layer);
    const baked: number[][] = [];
    scars.onBake = (x, z, r, a) => baked.push([x, z, r, a]);
    scars.add(10, 10, 1.2, 0, 0.8, 0);
    scars.add(10.1, 10.05, 1.1, 0, 0.8, 0);
    assert.equal(scars.stats.added, 1, 'a second blast on the same spot merges');
    assert.equal(scars.stats.merged, 1, 'merged');
    for (let i = 0; i < 200; i++) { scars.now = i; scars.add((i % 40) * 3, Math.floor(i / 40) * 3 + 20, 1, 0, 0.8, 0); }
    assert.ok(scars.slots.liveCount <= SCAR_CAPACITY.low, 'within the Low budget');
    assert.ok(baked.length > 0 && baked.length === scars.stats.retired, 'every retired mark is baked into the ground');
    assert.ok(scars.snapshot().length === scars.slots.liveCount, 'snapshot lists the live marks');
    layer.dispose();
  });
});

describe('battlefield ledger', () => {
  test('craters merge nearby hits (capped depth) and evict the least recently hit over budget', () => {
    const L = new ScarLedger(64, 64, 3, 4);
    L.addCrater(10, 10, 1, 0.1, 0);
    const m = L.addCrater(10.3, 10, 1, 0.1, 1);
    assert.ok(m.merged && !m.added, 'a hit inside the crater merges');
    for (let i = 0; i < 10; i++) L.addCrater(10, 10.2, 1, 0.1, 2 + i);
    assert.ok(L.craters[0].d <= CRATER_MAX_DEPTH + 1e-9, 'depth is capped');
    L.addCrater(30, 30, 1, 0.1, 20);
    L.addCrater(40, 40, 1, 0.1, 21);
    L.addCrater(10, 10, 1, 0.05, 22); // the first crater is hit again: freshest now
    const r = L.addCrater(50, 50, 1, 0.1, 23);
    assert.equal(L.craters.length, 3, 'live budget');
    assert.equal(r.evicted.length, 1, 'one evicted');
    assert.equal(r.evicted[0].x, 30, 'the least recently hit crater goes, not the oldest-placed one');
  });

  test('burnt trees: the oldest go over budget; burn is recorded per cell', () => {
    const L = new ScarLedger(32, 32, 8, 3);
    const t = (x: number) => ({ x, y: 5, z: 0, s: 1, yaw: 0, fall: NaN });
    for (let i = 0; i < 3; i++) assert.equal(L.addTree(t(i)), null, 'within budget');
    const ev = L.addTree(t(9));
    assert.ok(ev && ev.x === 0, 'the first burnt tree is dropped');
    L.burnAt(10, 10, 1.5, 0.5);
    assert.ok(L.burn[10 * 32 + 10] > 100, 'scorched cell');
    assert.equal(L.burn[0], 0, 'far cells untouched');
  });

  test('snapshot round trip, and hostile save data is rejected or sanitised', () => {
    const L = new ScarLedger(48, 40, 16, 16);
    L.addCrater(5, 6, 1.2, 0.2, 0);
    L.addCrater(20, 21, 0.8, 0.1, 1);
    L.addTree({ x: 3, y: 4, z: 0.2, s: 0.9, yaw: 1, fall: 2 });
    L.addTree({ x: 7, y: 8, z: 0.1, s: 1.1, yaw: 0, fall: NaN });
    L.burnAt(12, 12, 2, 0.6);
    const snap = JSON.parse(JSON.stringify(L.snapshot([[5, 6, 1.5, 0.8]], [{ cx: 2, cy: 3, w: 2, h: 2, seed: 77 }])));
    const r = ScarLedger.restore(snap, 48, 40);
    assert.ok(r, 'restores');
    assert.equal(r!.ledger.craters.length, 2, 'craters');
    assert.equal(r!.ledger.trees.length, 2, 'trees');
    assert.ok(Number.isNaN(r!.ledger.trees[1].fall), 'stump-only tree keeps no trunk');
    assert.deepEqual(Array.from(r!.ledger.burn), Array.from(L.burn), 'burn grid identical');
    assert.equal(r!.marks.length, 1, 'scorch marks');
    assert.deepEqual(r!.ruins, [{ cx: 2, cy: 3, w: 2, h: 2, seed: 77 }], 'rubble piles');
    assert.equal(ScarLedger.restore(snap, 64, 64), null, 'another map size: ignored');
    assert.equal(ScarLedger.restore({ v: 99 }, 48, 40), null, 'unknown version: ignored');
    assert.equal(ScarLedger.restore('x', 48, 40), null, 'not an object');
    const evil = {
      ...snap,
      craters: [[1e9, 2, 1, 0.1], [3, 3, 'x', 0.1], [4, 4, 99, 0.1], [5, 5, 1, 5]],
      trees: Array.from({ length: 5000 }, () => [1, 1, 0, 1, 0, -9]),
      burn: [255, 1e9],
      marks: [[1, 1, 1e6, 0.5], [NaN, 1, 1, 1]],
      ruins: [[1, 1, 100, 2, 3], [1.5, 1, 2, 2, 3]],
    };
    const e = ScarLedger.restore(evil, 48, 40, 16, 16);
    assert.ok(e, 'still a snapshot');
    assert.equal(e!.ledger.craters.length, 1, 'off-map, malformed and oversized craters dropped');
    assert.ok(e!.ledger.craters[0].d <= CRATER_MAX_DEPTH, 'depth clamped');
    assert.equal(e!.ledger.trees.length, 16, 'tree list capped to the budget');
    assert.ok(e!.ledger.burn.every((v) => v === 0), 'a burn grid that does not add up is discarded');
    assert.equal(e!.marks.length, 0, 'bad marks dropped');
    assert.equal(e!.ruins.length, 0, 'bad ruins dropped');
  });

  test('budgets grow with the quality preset', () => {
    assert.ok(SCAR_BUDGET.low.craters < SCAR_BUDGET.medium.craters && SCAR_BUDGET.medium.craters < SCAR_BUDGET.high.craters, 'craters');
    assert.ok(SCAR_CAPACITY.low < SCAR_CAPACITY.high, 'scorch marks');
  });
});

describe('destruction: lasting craters', () => {
  const mk = (q: 'low' | 'high' = 'high') => {
    const calls: number[][] = [];
    const scorches: number[][] = [];
    const map = { heightAt: () => 0, surfaceAt: () => 0, w: 64, h: 64 } as unknown as GameMap;
    const noop = () => {};
    const effects = { dust: noop, explosion: noop, scorch: noop, waterSplash: noop, chronoFlash: noop, createEmitter: () => ({ setPosition: noop, setIntensity: noop, dispose: noop }), shake: 0 } as unknown as Effects;
    const scene = new THREE.Scene();
    scene.userData.fxQuality = q;
    const d = new Destruction(scene, effects, map);
    d.setTerrain({ renderHeight: () => 0, deform: (x, y, r, dep) => calls.push([x, y, r, dep]), scorch: (x, y, r, a) => scorches.push([x, y, r, a ?? 0]) });
    return { d, calls, scorches };
  };

  test('craters stay for the match; over budget the least recently hit heals back and leaves burnt ground', () => {
    const { d, calls, scorches } = mk('low');
    const B = SCAR_BUDGET.low.craters;
    const n = B + 4;
    let t = 1;
    const at = (i: number) => d.crater(4 + (i % 12) * 5, 4 + Math.floor(i / 12) * 5, 0.8, 0.08);
    for (let i = 0; i < B; i++) { d.update(0.016, t); t += 0.5; at(i); }
    // ten minutes later: nothing healed by time alone
    for (let i = 0; i < 600; i++) { d.update(0.1, t); t += 1; }
    assert.ok(calls.every((c) => c[3] > 0), 'craters do not heal with time');
    for (let i = B; i < n; i++) { d.update(0.016, t); t += 0.5; at(i); }
    assert.equal(calls.filter((c) => c[3] > 0).length, n, 'every crater pressed (no per-match cap any more)');
    assert.equal(d.scars.craters.length, B, 'live craters within the Low budget');
    for (let i = 0; i < 40; i++) { d.update(0.1, t); t += 0.5; }
    const heals = calls.filter((c) => c[3] < 0);
    assert.equal(heals.length, 4 * 5, 'the 4 evicted craters healed in 5 steps each');
    assert.ok(heals.every((c) => c[0] === 4 || c[0] < 25), 'the evicted ones are the first (least recently hit) craters');
    assert.ok(scorches.filter((s) => s[3] > 0.2).length >= 4, 'their ground stays burnt');
    d.dispose();
  });

  test('a saved battlefield paints again: craters, burnt trees, burn', () => {
    const a = mk();
    a.d.update(0.016, 1);
    a.d.crater(10, 10, 1, 0.1);
    a.d.treeDown(20, 0.1, 22);
    a.d.onImpact(30, 30, 0.1, 'medium', 1);
    const snap = JSON.parse(JSON.stringify(a.d.saveScars()));
    const b = mk();
    assert.ok(b.d.loadScars(snap), 'loads');
    assert.equal(b.d.scars.craters.length, 1, 'the crater is back');
    assert.ok(b.calls.some((c) => c[0] === 10 && c[3] > 0), 'and pressed into the terrain');
    assert.equal(b.d.burntTreeCount, 1, 'the burnt tree is back');
    assert.ok(b.scorches.length > 0, 'burnt ground painted');
    assert.equal(b.d.loadScars({ v: 1, w: 9, h: 9 }), false, 'another map: ignored');
    a.d.dispose();
    b.d.dispose();
  });
});
