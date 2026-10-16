/**
 * FX engine logic that runs without a GPU: dynamic light bookkeeping (envelopes, culling, caps, tile
 * binning), persistent terrain damage (craters dig and heal, the simulation's heights never change) and the
 * open-sea mask / wave sampling the ships use.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DynamicLights, DYN_TILES_X } from '../src/render/dynlights';
import { TerrainMesh } from '../src/render/terrain';
import { Water } from '../src/render/water';
import { GameMap, T, WATER_LEVEL } from '../src/sim/map';

function camera(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(38, 16 / 9, 0.5, 400);
  cam.position.set(32, 20, 46);
  cam.lookAt(32, 0, 32);
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  return cam;
}

/** Index of the first light listed in any tile (or -1). */
function anyTileLight(d: DynamicLights): number {
  const data = d.tileTex.image.data as Uint8Array;
  for (let i = 0; i < data.length; i++) if (data[i]) return data[i] - 1;
  return -1;
}

test('dynamic lights: timed flashes decay and expire, per-frame lights are consumed', () => {
  const d = new DynamicLights(16, 8);
  const cam = camera();
  d.now = 0;
  const id = d.add(32, 1, 32, 0xffaa55, 5, 4, 0.5);
  assert.ok(id >= 0, 'light accepted');
  d.add(30, 1, 30, 0xffffff, 2, 3, 0);
  d.now = 0.1;
  d.prepare(cam);
  assert.equal(d.stats.drawn, 2, 'both lights drawn');
  assert.ok(anyTileLight(d) >= 0, 'lights binned into screen tiles');
  d.now = 0.2;
  d.prepare(cam);
  assert.equal(d.stats.drawn, 1, 'the per-frame light is gone after one frame');
  d.now = 0.6;
  d.prepare(cam);
  assert.equal(d.stats.drawn, 0, 'the flash expired');
  assert.equal(d.update(id, 1, 1, 1), false, 'expired ids are stale');
  d.dispose();
});

test('dynamic lights: persistent lights, culling behind the camera, cap keeps the brightest', () => {
  const d = new DynamicLights(4, 4);
  const cam = camera();
  const keep = d.add(32, 1, 32, 0xffffff, 1, 3, -1);
  d.prepare(cam);
  assert.equal(d.stats.drawn, 1, 'persistent light drawn');
  assert.ok(d.update(keep, 33, 1, 33, 2), 'persistent light can move');
  d.remove(keep);
  d.prepare(cam);
  assert.equal(d.stats.drawn, 0, 'removed');
  d.add(32, 30, 90, 0xffffff, 50, 3, 0); // far behind the camera
  d.prepare(cam);
  assert.equal(d.stats.drawn, 0, 'culled behind the camera');
  for (let i = 0; i < 10; i++) d.add(28 + i, 1, 32, 0xffffff, 1 + i, 3, 0);
  d.prepare(cam);
  assert.equal(d.stats.drawn, 4, 'capped');
  assert.equal(d.stats.dropped, 6, 'over the cap counted as dropped');
  // the brightest (intensity 10) made it: light slot 0 carries colour * intensity
  const L = d.lightTex.image.data as Float32Array;
  assert.ok(L[4 * 4] >= 9.9 || L[4 * 4 + 1] >= 9.9 || L[4 * 4 + 2] >= 9.9, 'brightest light first');
  assert.ok(DYN_TILES_X > 0, 'tile grid');
  d.dispose();
});

function testMap(): GameMap {
  const m = new GameMap(48, 48);
  // a 30x30 sea in the middle, a 3x3 pond in a corner, flat ground elsewhere
  for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) {
    const sea = x >= 9 && x < 39 && y >= 9 && y < 39;
    const pond = x >= 2 && x < 5 && y >= 2 && y < 5;
    if (sea || pond) m.terrain[m.idx(x, y)] = T.Water;
  }
  for (let y = 0; y <= 48; y++) for (let x = 0; x <= 48; x++) {
    const sea = x >= 10 && x <= 38 && y >= 10 && y <= 38;
    const pond = x >= 3 && x <= 4 && y >= 3 && y <= 4;
    m.heights[y * 49 + x] = sea ? -1.2 : pond ? -0.8 : 0.2;
  }
  return m;
}

test('terrain damage: craters dig (capped), heal back to the original ground, never touch the sim', () => {
  const m = testMap();
  const t = new TerrainMesh(m, 'temperate', 'high');
  const x = 6, y = 40;
  const sim0 = m.heightAt(x, y);
  const h0 = t.renderHeight(x, y);
  t.deform(x, y, 1.5, 0.5);
  const h1 = t.renderHeight(x, y);
  assert.ok(h1 < h0 - 0.3, `crater dug (${h0} -> ${h1})`);
  for (let i = 0; i < 10; i++) t.deform(x, y, 1.5, 1.5);
  assert.ok(t.renderHeight(x, y) >= h0 - 1.11, 'digging is capped');
  for (let i = 0; i < 40; i++) t.deform(x, y, 1.5, -0.2);
  const h2 = t.renderHeight(x, y);
  assert.ok(Math.abs(h2 - h0) < 1e-4, `healed back to the original ground (${h0} vs ${h2})`);
  t.deform(x, y, 1.5, -1);
  assert.ok(t.renderHeight(x, y) <= h0 + 1e-6, 'healing never raises above the original ground');
  t.scorch(x, y, 2, 0.8);
  t.rut(x - 2, y, x + 2, y, 0.7);
  assert.equal(m.heightAt(x, y), sim0, 'simulation height unchanged');
  t.dispose();
});

test('ocean: open sea rolls, shores and ponds stay calm, wave samples are deterministic', () => {
  const m = testMap();
  const w = new Water(m, (x, y) => m.heightAt(x, y), new THREE.Vector3(0.5, 0.8, 0.3).normalize(), false, 'high');
  assert.ok(w.waves, 'waves on a map with a sea');
  assert.ok(w.seaFactor(24, 24) > 0.6, 'open sea in the middle');
  assert.ok(w.seaFactor(3.5, 3.5) < 0.3, 'the pond stays calm');
  assert.equal(w.seaFactor(45, 45), 0, 'dry land');
  const a = w.surfaceOffset(24, 24, 3.7), b = w.surfaceOffset(24, 24, 3.7);
  assert.deepEqual(a, b, 'deterministic for a given time');
  let maxY = 0;
  for (let t = 0; t < 20; t += 0.37) maxY = Math.max(maxY, Math.abs(w.surfaceOffset(24, 24, t).y));
  assert.ok(maxY > 0.02 && maxY < 0.6, `swell height plausible (${maxY})`);
  assert.equal(w.surfaceOffset(45, 45, 3).y, 0, 'no waves on land');
  const n = w.surfaceOffset(20, 26, 5.1);
  assert.ok(Math.abs(Math.hypot(n.nx, n.ny, n.nz) - 1) < 1e-6 && n.ny > 0.8, 'unit normal, mostly up');
  assert.equal(WATER_LEVEL, -0.32, 'gameplay water level unchanged');
  w.dispose();
});
