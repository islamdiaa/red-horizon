// HD infantry readiness and GPU fallbacks (src/render/models/infantry-hd.ts), the parts that run without WebGL:
// the far LODs' zero normals / tangents are repaired before upload (normalize(0) is NaN on real GPUs: black pixels
// that the TAA spreads and the bloom turns into white blobs), broken clip sets are refused, the GPU capability
// verdict picks the full, frame-stepped or procedural path, and soldiers are only created when they can be drawn.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { infantryDrawable, parseGlb, readAccessor, readVat, repairFrames, vatModeFor, vatProblem, VAT_NEEDS, type VatCaps } from '../src/render/models/infantry-hd';

const DIR = join(import.meta.dirname, '..', 'public', 'models', 'infantry');
const soldiers = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith('.glb') && !f.startsWith('anim.')) : [];

const len3 = (a: ArrayLike<number>, i: number, stride: number) => Math.hypot(a[i * stride], a[i * stride + 1], a[i * stride + 2]) / 127;

/** Every vertex has a usable normal, and a tangent that is neither zero nor parallel to it (unit-ish, int8). */
function assertFrames(nrm: Int8Array, tan: Int8Array, what: string): void {
  const n = nrm.length / 3;
  for (let i = 0; i < n; i++) {
    const ln = len3(nrm, i, 3);
    assert.ok(ln > 0.9 && ln < 1.1, `${what}: vertex ${i} normal length ${ln.toFixed(3)}`);
    const lt = len3(tan, i, 4);
    assert.ok(lt > 0.9 && lt < 1.1, `${what}: vertex ${i} tangent length ${lt.toFixed(3)}`);
    const [nx, ny, nz] = [nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]].map((v) => v / 127);
    const [tx, ty, tz] = [tan[i * 4], tan[i * 4 + 1], tan[i * 4 + 2]].map((v) => v / 127);
    const c = Math.hypot(ny * tz - nz * ty, nz * tx - nx * tz, nx * ty - ny * tx);
    assert.ok(c > 0.05, `${what}: vertex ${i} tangent parallel to its normal`);
    assert.ok(tan[i * 4 + 3] !== 0, `${what}: vertex ${i} bitangent sign 0`);
  }
}

describe('HD infantry: normals and tangents are repaired before upload', () => {
  test('zero normals take their faces\' normal, zero / parallel tangents a perpendicular', () => {
    // a quad in the XZ plane (faces up) with every frame broken in a different way, plus one healthy vertex
    const pos = new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1]);
    const index = [0, 2, 1, 0, 3, 2];
    const nrm = new Int8Array([0, 0, 0, 0, 0, 0, 0, 127, 0, 0, 2, 1]);
    const tan = new Int8Array([0, 0, 0, 127, 127, 0, 0, 127, 0, 127, 0, -127, 127, 0, 0, 0]);
    const fixed = repairFrames(nrm, tan, pos, index);
    assert.equal(fixed, 4, 'every vertex had something to fix (three normals, a parallel tangent)');
    assertFrames(nrm, tan, 'quad');
    for (const i of [0, 1, 3]) assert.ok(nrm[i * 3 + 1] > 120, `vertex ${i}: the face normal (up), got ${[...nrm.subarray(i * 3, i * 3 + 3)]}`);
    assert.equal(tan[2 * 4 + 3], -127, 'a valid bitangent sign is kept');
    assert.equal(tan[3 * 4 + 3], 127, 'a zero bitangent sign becomes +1');
  });

  test('healthy frames are left alone', () => {
    const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const nrm = new Int8Array([0, 0, 127, 0, 0, 127, 0, 0, 127]);
    const tan = new Int8Array([127, 0, 0, 127, 127, 0, 0, -127, 0, 127, 0, 127]);
    const before = [...nrm, ...tan];
    assert.equal(repairFrames(nrm, tan, pos, [0, 1, 2]), 0, 'nothing to fix');
    assert.deepEqual([...nrm, ...tan], before, 'bytes unchanged');
  });

  test('a vertex used by no face (or only degenerate ones) still gets a direction', () => {
    const nrm = new Int8Array([0, 0, 0]);
    const tan = new Int8Array([0, 0, 0, 0]);
    repairFrames(nrm, tan, new Float32Array([0, 0, 0]), [0, 0, 0]);
    assertFrames(nrm, tan, 'lonely vertex');
  });

  test('every soldier GLB, both LODs: usable frames after the repair (what the GPU normalises)', () => {
    assert.ok(soldiers.length > 0, 'soldier GLBs in public/models/infantry');
    for (const f of soldiers) {
      const g = parseGlb(readFileSync(join(DIR, f)));
      for (const mesh of g.json.meshes) {
        const prim = mesh.primitives[0];
        const pos = readAccessor(g, prim.attributes.POSITION);
        const nrm = readAccessor(g, prim.attributes.NORMAL);
        const tan = readAccessor(g, prim.attributes.TANGENT);
        const idx = readAccessor(g, prim.indices);
        assert.ok(nrm.array instanceof Int8Array && tan.array instanceof Int8Array, `${f}: int8 normals and tangents (what buildTemplate expects)`);
        const P = Float32Array.from(pos.array as ArrayLike<number>);
        repairFrames(nrm.array as Int8Array, tan.array as Int8Array, P, idx.array);
        assertFrames(nrm.array as Int8Array, tan.array as Int8Array, `${f} lod${mesh.extras?.lod ?? 0}`);
        for (let i = 0; i < idx.array.length; i++) assert.ok(idx.array[i] < pos.count, `${f}: index ${i} in range`);
        const dq = mesh.extras?.rh_dequant;
        assert.ok(dq && dq.s > 0 && Number.isFinite(dq.s) && dq.c.every(Number.isFinite), `${f}: a valid dequantisation`);
      }
    }
  });
});

describe('HD infantry: clip sets are validated before use', () => {
  for (const rig of ['human', 'dog']) {
    const file = join(DIR, `anim.${rig}.glb`);
    if (!existsSync(file)) continue;
    test(`anim.${rig}.glb is usable`, () => {
      assert.equal(vatProblem(readVat(parseGlb(readFileSync(file)))), null, 'no problem found');
    });
  }

  test('NaN / Inf texels, clips outside the texture, a texture too big for the GPU and a bad layout are refused', () => {
    const v = readVat(parseGlb(readFileSync(join(DIR, 'anim.human.glb'))));
    const nan = { ...v, half: v.half.slice() };
    nan.half[123] = 0x7e00;
    assert.match(vatProblem(nan) ?? '', /NaN/, 'a NaN texel');
    const inf = { ...v, half: v.half.slice() };
    inf.half[7] = 0x7c00;
    assert.match(vatProblem(inf) ?? '', /NaN \/ Inf/, 'an Inf texel');
    const clips = v.meta.clips.map((c: { row: number }, i: number) => (i === 0 ? { ...c, row: v.height } : c));
    assert.match(vatProblem({ ...v, meta: { ...v.meta, clips } }) ?? '', /outside/, 'a clip past the last row');
    assert.match(vatProblem(v, 512) ?? '', /exceeds/, `${v.width} x ${v.height} on a GPU with 512 texels`);
    assert.match(vatProblem({ ...v, width: 3 }) ?? '', /layout/, 'fewer than 3 texels per bone');
  });
});

describe('HD infantry: GPU capabilities pick the path', () => {
  const base: VatCaps = { vertexTextures: 16, vertexAttribs: 16, textureSize: 4096, probe: 'linear' };
  test('the WebGL 2 baseline gets the full VAT path', () => {
    assert.equal(vatModeFor(base).mode, 'linear', 'linear');
    assert.equal(vatModeFor({ ...base, probe: null }).mode, 'linear', 'a probe that could not run gives no verdict');
    assert.equal(vatModeFor({ ...base, vertexTextures: VAT_NEEDS.vertexTextures, vertexAttribs: VAT_NEEDS.vertexAttribs }).mode, 'linear', 'the minimum it needs');
  });
  test('no vertex textures, too few attributes or a fetch that reads nothing: procedural infantry, with a reason', () => {
    for (const c of [{ ...base, vertexTextures: 0 }, { ...base, vertexTextures: 1 }, { ...base, vertexAttribs: 12 }, { ...base, probe: 'none' as const }]) {
      const r = vatModeFor(c);
      assert.equal(r.mode, 'off', `off for ${JSON.stringify(c)}`);
      assert.ok(r.why.length > 0, 'a reason for the console warning');
    }
  });
  test('half floats read but not filtered: frames step (nearest)', () => {
    const r = vatModeFor({ ...base, probe: 'nearest' });
    assert.equal(r.mode, 'nearest', 'nearest');
    assert.ok(r.why.length > 0, 'a reason');
  });
});

describe('HD infantry: soldiers are only created when they can be drawn', () => {
  const ok = { mode: 'linear' as const, restoring: 0, offscreen: false, released: true };
  test('a loaded template on a capable GPU', () => {
    assert.equal(infantryDrawable(ok), true, 'drawable');
    assert.equal(infantryDrawable({ ...ok, mode: 'nearest' }), true, 'frame-stepped is drawable');
    assert.equal(infantryDrawable({ ...ok, offscreen: true, released: false }), true, 'thumbnails before the atlases close');
  });
  test('not on a GPU without the VAT path, not mid-restore, not in another context once the atlases are closed', () => {
    assert.equal(infantryDrawable({ ...ok, mode: 'off' }), false, 'off: procedural');
    assert.equal(infantryDrawable({ ...ok, restoring: 2 }), false, 'context restore re-decoding');
    assert.equal(infantryDrawable({ ...ok, offscreen: true }), false, 'thumbnail context, closed atlases');
  });
});
