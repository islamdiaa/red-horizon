// Terrain look (render only): the procedural road network (deterministic, never touches the simulation, stays
// on passable ground), the scanned material layer sets per climate and the terrain shader variants.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { GameMap, T } from '../src/sim/map';
import { generateMap } from '../src/sim/mapgen';
import { buildRoads, oreFields, roadDistance, roadsFor, ROAD_HALF, ROAD_REACH } from '../src/render/roads';
import { CLIMATE_LAYERS, climateMaterials, LAYER_COUNT, layerTint, layerUniforms, MATERIAL_AVG, SLOT, type Climate } from '../src/render/terrain-materials';
import { TerrainMesh } from '../src/render/terrain';

const CLIMATES: Climate[] = ['temperate', 'winter', 'desert'];
const gen = (seed: number, size = 64, players = 2, water = 0.5) => generateMap({ size, players, seed, water, trees: 0.5, ore: 0.6 });

/** Fingerprint of everything the simulation reads from a map. */
function mapHash(m: GameMap): string {
  let h = 2166136261;
  const mix = (v: number) => { h = Math.imul(h ^ (v | 0), 16777619); };
  for (const a of [m.terrain, m.ore, m.gems, m.oreField, m.tree, m.reserved, m.bridgeAt]) for (let i = 0; i < a.length; i++) mix(a[i]);
  for (let i = 0; i < m.heights.length; i++) mix(Math.round(m.heights[i] * 1e4));
  for (let i = 0; i < m.occupant.length; i++) mix(m.occupant[i]);
  return `${h >>> 0}:${m.startPositions.map((s) => `${s.x},${s.y}`).join(';')}:${m.treeVersion}:${m.oreVersion}`;
}

test('roads: deterministic per map and seed, independent of start order, never touch the simulation', () => {
  for (const [seed, size, players] of [[11, 64, 2], [5, 96, 4], [23, 64, 3]] as const) {
    const a = gen(seed, size, players), b = gen(seed, size, players);
    const before = mapHash(a);
    const ra = buildRoads(a), rb = buildRoads(b);
    assert.equal(mapHash(a), before, `seed ${seed}: building roads leaves the map untouched`);
    assert.equal(ra.hash, rb.hash, `seed ${seed}: the same map gives the same roads`);
    assert.deepEqual(ra.segments, rb.segments, `seed ${seed}: identical centre lines`);
    assert.ok(ra.segments.some((s) => s.kind === 'main'), `seed ${seed}: there is a main road`);
    // game.ts may reverse the start list (who plays where): the network must not change
    b.startPositions.reverse();
    assert.equal(buildRoads(b).hash, ra.hash, `seed ${seed}: start order does not matter`);
    // roadsFor caches per map content
    assert.equal(roadsFor(a), roadsFor(a), 'cached per map');
  }
  const x = buildRoads(gen(11)), y = buildRoads(gen(12));
  assert.notEqual(x.hash, y.hash, 'another seed gives another network');
});

test('roads: main roads link every base, roads stay on passable ground and avoid forests', () => {
  for (const [seed, size, players] of [[11, 64, 2], [5, 96, 4], [8, 80, 2], [31, 64, 4]] as const) {
    const m = gen(seed, size, players);
    const net = buildRoads(m);
    const mains = net.segments.filter((s) => s.kind === 'main');
    for (const s of m.startPositions) {
      const d = Math.min(...mains.flatMap((r) => r.points.map(([x, y]) => Math.hypot(x - s.x, y - s.y))));
      assert.ok(d < 2.5, `seed ${seed}: start (${s.x}, ${s.y}) is on a main road (${d.toFixed(2)} cells away)`);
    }
    const W = m.w * net.res;
    const bridge = new Set<number>();
    for (const b of m.bridges) for (const [x, y] of b.cells) bridge.add(m.idx(x, y));
    let texels = 0, trees = 0, core = 0;
    for (let j = 0; j < m.h * net.res; j++) for (let i = 0; i < W; i++) {
      const o = (j * W + i) * 4;
      if (!net.mask[o + 3]) continue;
      texels++;
      const ci = m.idx(Math.floor(i / net.res), Math.floor(j / net.res));
      const t = m.terrain[ci];
      assert.ok(t !== T.Rock, `seed ${seed}: no road on rock (texel ${i},${j})`);
      assert.ok(t !== T.Water || bridge.has(ci), `seed ${seed}: no road on open water (texel ${i},${j})`);
      if ((1 - net.mask[o] / 255) * ROAD_REACH < ROAD_HALF.main) { core++; if (m.tree[ci]) trees++; }
    }
    assert.ok(texels > 500, `seed ${seed}: the network covers some ground (${texels} texels)`);
    assert.ok(trees / Math.max(1, core) < 0.06, `seed ${seed}: roads keep out of forests (${trees}/${core} core texels under trees)`);
    for (const c of net.cells.keys()) if (net.cells[c]) assert.ok(m.terrain[c] !== T.Rock, 'road cells are never rock');
  }
});

test('roads: tracks lead to ore fields and stop at the field edge', () => {
  const m = gen(11, 96, 2);
  const net = buildRoads(m);
  const fields = oreFields(m);
  assert.ok(fields.length > 0, 'the map has ore fields');
  const tracks = net.segments.filter((s) => s.kind === 'track');
  assert.ok(tracks.length > 0, 'there are dirt tracks');
  for (const s of tracks) {
    const end = s.points[s.points.length - 1], start = s.points[0];
    const near = (p: [number, number]) => Math.min(...fields.map(([x, y]) => Math.hypot(p[0] - x, p[1] - y)));
    assert.ok(Math.min(near(end), near(start)) < 12, `a track ends near an ore field (${near(end).toFixed(1)})`);
    // the track's own end does not plough deep into the field
    const deep = s.points.filter(([x, y]) => m.ore[m.idx(Math.floor(x), Math.floor(y))] && roadDistance(net, m.w, m.h, x, y) < 0.2).length;
    assert.ok(deep <= 3, `a track stops at the field edge (${deep} points in the ore)`);
  }
});

test('roads: maps without starts or land still work', () => {
  const m = new GameMap(32, 32);
  const empty = buildRoads(m);
  assert.equal(empty.segments.length, 0, 'no starts, no ore: no roads');
  m.startPositions = [{ x: 4.5, y: 4.5 }, { x: 27.5, y: 27.5 }];
  const two = buildRoads(m);
  assert.equal(two.segments.filter((s) => s.kind === 'main').length, 1, 'two bases: one main road');
  for (let y = 0; y < 32; y++) m.terrain[m.idx(16, y)] = T.Rock; // a wall of rock with no way through
  assert.equal(buildRoads(m).segments.length, 0, 'unreachable bases: no road');
});

test('terrain materials: every climate fills all slots with baked, budgeted scans', () => {
  const dir = join(process.cwd(), 'public', 'textures', 'terrain');
  const man = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as { size: number; bytes: number; materials: Record<string, { files: Record<string, { file: string; bytes: number }> }> };
  assert.ok(man.size >= 512 && man.size <= 1024, `512-1024 px tiles (${man.size})`);
  assert.ok(man.bytes < 6_000_000, `about 5 MB in total (${(man.bytes / 1e6).toFixed(2)} MB)`);
  for (const c of CLIMATES) {
    const defs = CLIMATE_LAYERS[c];
    assert.equal(defs.length, LAYER_COUNT, `${c}: ${LAYER_COUNT} layers`);
    for (const d of defs) {
      const e = man.materials[d.mat];
      assert.ok(e, `${c}: ${d.mat} is baked`);
      for (const f of Object.values(e.files)) {
        const p = join(dir, f.file);
        assert.ok(existsSync(p), `${f.file} exists`);
        const b = readFileSync(p);
        assert.equal(b.length, f.bytes, `${f.file}: manifest size matches`);
        assert.equal(b.toString('latin1', 0, 4) + b.toString('latin1', 8, 12), 'RIFFWEBP', `${f.file} is a WebP`);
      }
      assert.ok(MATERIAL_AVG[d.mat], `${d.mat} has a placeholder colour`);
      assert.ok(d.tile >= 1.5 && d.tile <= 8, `${d.mat}: sensible tiling (${d.tile})`);
    }
  }
});

test('terrain materials: the climate decides the surface (snow, sand, ploughed or packed roads)', () => {
  const at = (c: Climate, slot: number) => climateMaterials(c)[slot];
  assert.equal(at('temperate', SLOT.Ground), 'grass', 'temperate ground is grass');
  assert.match(at('winter', SLOT.Ground), /^snow/, 'winter ground is snow');
  assert.equal(at('desert', SLOT.Ground), 'dune', 'desert ground is sand');
  assert.equal(at('temperate', SLOT.Road), 'asphalt', 'temperate roads are asphalt');
  assert.equal(at('winter', SLOT.Road), 'asphalt_snow', 'winter roads are ploughed, snow-dusted asphalt (banks and packed snow on top in the shader)');
  assert.equal(at('desert', SLOT.Road), 'packed_sand', 'desert roads are packed sand');
  assert.equal(at('desert', SLOT.Rock), 'sandstone', 'desert cliffs are sandstone');
  for (const c of CLIMATES) assert.match(at(c, SLOT.Snow), /^snow/, `${c}: a snow layer for weather and peaks`);
  // grading: 0 keeps the scan, 1 lands the average on the target colour
  const d = CLIMATE_LAYERS.temperate[SLOT.Ground];
  assert.deepEqual(layerTint({ ...d, grade: 0 }), [1, 1, 1], 'grade 0 = the scan as it is');
  const full = layerTint({ ...d, grade: 1 }, [0.5, 0.5, 0.5]);
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  for (let k = 0; k < 3; k++) assert.ok(Math.abs(full[k] * lin(0.5) - lin(d.target[k])) < 1e-9, 'grade 1 = the target colour on average');
  const u = layerUniforms('winter');
  assert.equal(u.T.length, LAYER_COUNT, 'one uniform per layer');
  assert.ok(u.T.every((v) => v.w > 0 && Number.isFinite(v.x + v.y + v.z)), 'finite tints and tiling');
});

/** Run a terrain material's shader patch over three's standard shader source. */
function patched(t: TerrainMesh): { vs: string; fs: string; uniforms: Record<string, unknown> } {
  const lib = THREE.ShaderLib.standard;
  const shader = { uniforms: THREE.UniformsUtils.clone(lib.uniforms), vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader } as unknown as THREE.WebGLProgramParametersWithUniforms;
  (t.mesh.material as THREE.MeshStandardMaterial).onBeforeCompile(shader, null as unknown as THREE.WebGLRenderer);
  return { vs: shader.vertexShader, fs: shader.fragmentShader, uniforms: shader.uniforms };
}

test('terrain shader: textured layers on medium / high, the procedural look on low, every chunk patched', () => {
  const m = gen(11);
  for (const c of CLIMATES) for (const q of ['low', 'medium', 'high'] as const) {
    const t = new TerrainMesh(m, c, q);
    const { fs, vs, uniforms } = patched(t);
    assert.ok(!fs.includes('#include <map_fragment>'), `${c}/${q}: the albedo chunk is replaced`);
    assert.ok(vs.includes('vWPos'), `${c}/${q}: world position varying`);
    assert.ok(fs.includes('tRoad'), `${c}/${q}: roads drawn`);
    assert.ok('tRoad' in uniforms && 'tBase' in uniforms && 'tDeform' in uniforms, `${c}/${q}: dressing, road and damage maps bound`);
    if (q === 'low') {
      assert.equal(t.textures, null, `${c}/low: no texture downloads`);
      assert.ok(!fs.includes('sampler2DArray'), `${c}/low: procedural shading only`);
    } else {
      assert.ok(t.textures, `${c}/${q}: scanned materials`);
      assert.ok(fs.includes('uniform sampler2DArray tTerA') && 'tTerA' in uniforms && 'uLayT' in uniforms, `${c}/${q}: layer arrays bound`);
      assert.equal(fs.includes('ia + 1.0'), q === 'high', `${c}/${q}: anti-tiling only on high`);
      assert.equal(fs.includes('plough'), c === 'winter', `${c}/${q}: ploughed snow roads only in winter`);
      assert.ok(fs.includes('terTri('), `${c}/${q}: triplanar cliffs`);
    }
    assert.match(String((t.mesh.material as THREE.Material).customProgramCacheKey()), new RegExp(`${c}$`), 'one program per climate');
    t.dispose();
  }
});

test('terrain: the low preset keeps its old cost, textures are shared and released per climate', () => {
  const m = gen(11);
  const a = new TerrainMesh(m, 'winter', 'high'), b = new TerrainMesh(m, 'winter', 'medium');
  assert.equal(a.textures, b.textures, 'one texture set per climate (editor rebuilds reuse it)');
  assert.equal(a.textures!.refs, 2, 'reference counted');
  a.dispose();
  assert.equal(b.textures!.refs, 1, 'released by the first terrain');
  b.dispose();
  const c = new TerrainMesh(m, 'winter', 'high');
  assert.notEqual(c.textures, a.textures, 'a new set after the last release');
  assert.equal(c.textureStatus().roads, c.roads.segments.length, 'status reports the roads');
  c.dispose();
});

test('vegetation: felled trees report their ground position and scale; no clutter on the road cores', async () => {
  const { Vegetation } = await import('../src/render/vegetation');
  const m = gen(11);
  const veg = new Vegetation(m, (x, y) => m.heightAt(x, y), 'high', 'temperate');
  const i = m.tree.findIndex((t) => t > 0);
  assert.ok(i >= 0, 'the map has trees');
  m.removeTree(i);
  const felled = veg.syncTrees();
  assert.equal(felled.length, 1, 'one tree down');
  const t = felled[0];
  assert.ok(Math.abs(t.x - ((i % m.w) + 0.5)) < 0.5 && Math.abs(t.z - (Math.floor(i / m.w) + 0.5)) < 0.5, 'at its cell');
  assert.ok(Math.abs(t.y - m.heightAt(t.x, t.z)) < 0.1, 'on the ground');
  assert.ok(t.s > 0.4 && t.s < 1.5, `with its scale (${t.s})`);
  assert.equal(veg.syncTrees().length, 0, 'reported once');
  const roads = roadsFor(m);
  let onRoad = 0;
  veg.group.traverse((o) => {
    const im = o as THREE.InstancedMesh;
    if (!im.isInstancedMesh || im.castShadow) return; // grass tufts (the only clutter without shadows)
    const e = new THREE.Matrix4();
    for (let k = 0; k < im.count; k++) {
      im.getMatrixAt(k, e);
      const x = e.elements[12], y = e.elements[14];
      if (roadDistance(roads, m.w, m.h, x, y) < ROAD_HALF.main) onRoad++;
    }
  });
  assert.equal(onRoad, 0, 'no grass tufts on the road surface');
});
