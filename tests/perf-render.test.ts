// Render performance changes that must not change the picture (or only the Low preset's, by design): the baked
// environment table that replaces three's textureCubeUV lookups on the ground, the baked Low ground, the fog-of-war
// "clear" mask the atmosphere pass skips its work with, and the ground drawn after the other opaque objects.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { envLutChunk, envLutChunkApplies } from '../src/render/envlut';
import { bakedLowGlsl, bakeRes } from '../src/render/terrain-low';
import { FogOfWar } from '../src/render/fog';
import { TerrainMesh, TERRAIN_RENDER_ORDER } from '../src/render/terrain';
import { generateMap } from '../src/sim/mapgen';
import type { Player } from '../src/sim/player';

const gen = (seed: number, size = 64) => generateMap({ size, players: 2, seed, water: 0.5, trees: 0.5, ore: 0.6 });
const count = (s: string, sub: string) => s.split(sub).length - 1;

test('env table: replaces exactly three\'s irradiance (and on Low the radiance) lookups, once each', () => {
  assert.ok(envLutChunkApplies(), 'three.js still defines getIBLIrradiance / getIBLRadiance in envmap_physical_pars_fragment');
  for (const low of [false, true]) {
    const c = envLutChunk(low);
    assert.equal(count(c, 'vec3 getIBLIrradiance('), 1, `low=${low}: one irradiance function`);
    assert.equal(count(c, 'vec3 getIBLRadiance('), 1, `low=${low}: one radiance function`);
    assert.ok(c.includes('tEnvLut'), `low=${low}: reads the table`);
    // Medium / High keep three's exact (textureCubeUV) radiance; only Low takes the baked one
    const radiance = c.slice(c.indexOf('vec3 getIBLRadiance('));
    assert.equal(radiance.slice(0, 600).includes('tEnvLut'), low, `low=${low}: radiance source`);
  }
});

test('terrain: every preset takes the env table when given one, with its own program key', () => {
  const m = gen(5);
  const lut = new THREE.Texture();
  for (const q of ['low', 'medium', 'high'] as const) {
    const t = new TerrainMesh(m, 'temperate', q, lut);
    const lib = THREE.ShaderLib.standard;
    const shader = { uniforms: THREE.UniformsUtils.clone(lib.uniforms), vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader } as unknown as THREE.WebGLProgramParametersWithUniforms;
    (t.mesh.material as THREE.MeshStandardMaterial).onBeforeCompile(shader, null as unknown as THREE.WebGLRenderer);
    assert.ok(!shader.fragmentShader.includes('#include <envmap_physical_pars_fragment>') && 'tEnvLut' in shader.uniforms, `${q}: table in place`);
    assert.match(String((t.mesh.material as THREE.Material).customProgramCacheKey()), /-lutr?$/, `${q}: distinct program key`);
    assert.equal(t.mesh.renderOrder, TERRAIN_RENDER_ORDER, `${q}: ground drawn after the models`);
    assert.ok(TERRAIN_RENDER_ORDER > 0 && TERRAIN_RENDER_ORDER < 1, 'between the models (0) and the ground decals (1)');
    t.dispose();
  }
});

test('low ground: few lookups per pixel; the bake stays within 2048 texels a side', () => {
  for (const c of ['temperate', 'winter', 'desert'] as const) {
    const g = bakedLowGlsl(c);
    // unconditional: the bake, the grain noise and the damage map (ore flecks, rock strata, peaks, snow and wet
    // concrete only where they show); the old procedural Low shading took a dozen
    const always = g.map.replace(/if \(.*\) \{\n[\s\S]*?\n    \}/g, '').replace(/if \(.*?\) [a-z]\w* = [^\n]*;/g, '');
    assert.ok(count(always, 'texture2D(') + count(always, 'tn_') <= 3, `${c}: ${count(always, 'texture2D(') + count(always, 'tn_')} unconditional lookups`);
  }
  for (const [w, h] of [[64, 64], [96, 96], [128, 128], [200, 150], [400, 400]]) {
    const r = bakeRes(w, h);
    assert.ok(r >= 2 && r <= 8 && Math.max(w, h) * r <= Math.max(2048, Math.max(w, h) * 2), `${w}x${h}: ${r} texels per cell`);
  }
});

test('fog of war: the clear mask marks exactly the cells whose 3x3 neighbourhood is fully visible and explored', () => {
  const w = 12, h = 9;
  const fog = new FogOfWar(w, h);
  const vis = new Uint8Array(w * h).fill(1), exp = new Uint8Array(w * h).fill(1);
  vis[4 * w + 6] = 0; // one fogged cell
  exp[0] = 0; // one unexplored corner cell
  fog.snap({ visible: vis, explored: exp } as unknown as Player);
  const d = fog.texture.image.data as Uint8Array;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let clear = true;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const qx = Math.min(w - 1, Math.max(0, x + dx)), qy = Math.min(h - 1, Math.max(0, y + dy));
      if (!vis[qy * w + qx] || !exp[qy * w + qx]) clear = false;
    }
    assert.equal(d[(y * w + x) * 4 + 2], clear ? 255 : 0, `cell ${x},${y}`);
  }
  // fog of war off: everything clear (the atmosphere pass skips the fog-of-war work everywhere)
  fog.enabled = false;
  fog.update({ visible: vis, explored: exp } as unknown as Player, 10);
  assert.ok([...Array(w * h).keys()].every((i) => d[i * 4 + 2] === 255), 'all clear without fog of war');
});

test('low: the landscape beyond the map uses the procedural shading without the masks that read zero there', () => {
  const t = new TerrainMesh(gen(3), 'winter', 'low', new THREE.Texture());
  const lib = THREE.ShaderLib.standard;
  const shader = { uniforms: THREE.UniformsUtils.clone(lib.uniforms), vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader } as unknown as THREE.WebGLProgramParametersWithUniforms;
  (t.skirtMaterial as THREE.MeshStandardMaterial).onBeforeCompile(shader, null as unknown as THREE.WebGLRenderer);
  const fs = shader.fragmentShader;
  assert.ok(!fs.includes('texture2D(tBase') && !fs.includes('texture2D(tRoad') && !fs.includes('texture2D(tDeform'), 'no mask lookups');
  assert.ok(fs.includes('float concK = 0.0;') && fs.includes('ore > 0.0 ?'), 'concrete folded, flecks only under ore');
  assert.match(String(t.skirtMaterial.customProgramCacheKey()), /-skirt$/, 'its own program');
  t.dispose();
});

test('env table on model materials: chained onto the rim / weather patches, only once a table exists', async () => {
  const { patchModelRim } = await import('../src/render/scale');
  const { SCENE_ENV_LUT } = await import('../src/render/envlut');
  const compile = (m: THREE.MeshStandardMaterial) => {
    const lib = THREE.ShaderLib.standard;
    const shader = { uniforms: THREE.UniformsUtils.clone(lib.uniforms), vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader } as unknown as THREE.WebGLProgramParametersWithUniforms;
    m.onBeforeCompile(shader, null as unknown as THREE.WebGLRenderer);
    return shader;
  };
  const prev = SCENE_ENV_LUT.tEnvLut.value;
  try {
    SCENE_ENV_LUT.tEnvLut.value = null;
    const a = new THREE.MeshStandardMaterial();
    patchModelRim(a);
    const sa = compile(a);
    assert.ok(sa.fragmentShader.includes('#include <envmap_physical_pars_fragment>') && sa.fragmentShader.includes('uRimColor'), 'no table: three\'s lookups, rim still on');
    assert.match(a.customProgramCacheKey(), /\|rim\|lut0$/, 'key without the table');
    SCENE_ENV_LUT.tEnvLut.value = new THREE.Texture();
    const sb = compile(a);
    assert.ok(!sb.fragmentShader.includes('#include <envmap_physical_pars_fragment>') && 'tEnvLut' in sb.uniforms && sb.fragmentShader.includes('uRimColor'), 'with the table: irradiance from it, rim kept');
    assert.ok(sb.fragmentShader.includes('rhIBLIrradianceCube') && !sb.fragmentShader.includes('rhIBLRadianceCube'), 'models keep three\'s exact radiance');
    assert.match(a.customProgramCacheKey(), /\|lut1$/, 'its own program key');
  } finally {
    SCENE_ENV_LUT.tEnvLut.value = prev;
  }
});
