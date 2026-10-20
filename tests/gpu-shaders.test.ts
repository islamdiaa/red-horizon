// Static checks of the GLSL in src/render for patterns that are harmless under SwiftShader (the test browser)
// but NaN or imprecise on real GPUs. One NaN pixel in an HDR target is enough: the temporal filter spreads it
// into black dots and the bloom into white blobs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..', 'src', 'render');

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (f.endsWith('.ts')) out.push(p);
  }
  return out;
}

const files = tsFiles(ROOT).map((p) => ({ name: relative(ROOT, p), src: readFileSync(p, 'utf8') }));
/** Template literals (the shader sources and onBeforeCompile patches). */
const literals = (src: string) => [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);
const lineOf = (src: string, at: number) => src.slice(0, at).split('\n').length;

function findAll(re: RegExp, where: (f: { name: string; src: string }) => boolean = () => true): string[] {
  const hits: string[] = [];
  for (const f of files) {
    if (!where(f)) continue;
    for (const m of f.src.matchAll(re)) hits.push(`${f.name}:${lineOf(f.src, m.index ?? 0)}: ${m[0].trim().slice(0, 100)}`);
  }
  return hits;
}

test('GLSL: Fresnel-style pow(1.0 - dot) is clamped (|dot| of unit vectors can round above 1; pow(<0) is NaN)', () => {
  const hits = findAll(/pow\(\s*1\.0\s*-\s*(abs\(\s*)?(dot\(|ndv\b|NdotV\b|max\(\s*dot\()/g);
  assert.deepEqual(hits, [], `use pow(max(1.0 - x, 0.0), k):\n${hits.join('\n')}`);
});

test('GLSL: vertex normals are not normalised through the model matrix (a zero-scale axis gives normalize(0) = NaN)', () => {
  const hits = findAll(/normalize\(\s*mat3\(\s*modelMatrix\s*\)/g);
  assert.deepEqual(hits, [], `pass the unnormalised normal and normalise it per fragment with a length guard:\n${hits.join('\n')}`);
});

test('GLSL: raw shaders that sample textures declare highp samplers (the default is lowp: phones cut HDR and depth)', () => {
  const bad: string[] = [];
  for (const f of files) {
    if (!f.src.includes('RawShaderMaterial(')) continue;
    for (const lit of literals(f.src)) {
      // a raw fragment / vertex shader declares its own float precision; three adds nothing to it
      if (!/precision\s+highp\s+float/.test(lit) || !/\bsampler2D\b/.test(lit)) continue;
      if (!/precision\s+highp\s+sampler2D/.test(lit)) bad.push(`${f.name}: ${lit.trim().split('\n')[0].slice(0, 80)}`);
    }
  }
  assert.deepEqual(bad, [], `add 'precision highp sampler2D;':\n${bad.join('\n')}`);
});

test('GLSL: three.js normal chunks are patched NaN-safe before any shader compiles', async () => {
  const THREE = await import('three');
  const { installGlslSafety } = await import('../src/render/glsl-safety.ts');
  installGlslSafety();
  const C = THREE.ShaderChunk as unknown as Record<string, string>;
  assert.ok(C.common.includes('rhSafeNormalize'), 'common chunk defines rhSafeNormalize');
  for (const [chunk, text] of [['normal_vertex', 'normalize( transformedNormal )'], ['normal_fragment_begin', 'normalize( vNormal )']]) {
    assert.ok(!C[chunk].includes(text), `${chunk} still has the unguarded ${text}`);
    assert.ok(C[chunk].includes('rhSafeNormalize'), `${chunk} uses rhSafeNormalize`);
  }
  const renderer = readFileSync(join(ROOT, 'renderer.ts'), 'utf8');
  assert.ok(/installGlslSafety\(\)/.test(renderer), 'renderer.ts installs the patch at module load');
});
