// Every committed HD model (public/models/**.glb) has unit-length normals and tangents and finite positions.
// A zero normal or tangent is invisible under SwiftShader but normalize(0) is NaN on real GPUs: the temporal
// filter smears it into black dots and the bloom into white blobs (the HD infantry far LOD, October 2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', 'public', 'models');

function glbFiles(dir: string): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...glbFiles(p));
    else if (f.endsWith('.glb')) out.push(p);
  }
  return out;
}

interface Accessor { bufferView?: number; byteOffset?: number; componentType: number; normalized?: boolean; count: number; type: string }
interface View { byteOffset?: number; byteStride?: number; byteLength: number }

function parse(path: string) {
  const b = readFileSync(path);
  assert.equal(b.readUInt32LE(0), 0x46546c67, `${path}: not a GLB`);
  const jsonLen = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + jsonLen).toString('utf8'));
  const binStart = 20 + jsonLen + 8;
  return { json, bin: b.subarray(binStart) };
}

const SIZE: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5126: 4 };
const COMPS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

/** Read accessor `i` as float vectors (dequantised when normalized). */
function read(json: { accessors: Accessor[]; bufferViews: View[] }, bin: Buffer, i: number): number[][] {
  const a = json.accessors[i];
  if (a.bufferView === undefined) return [];
  const v = json.bufferViews[a.bufferView];
  const n = COMPS[a.type], sz = SIZE[a.componentType];
  const stride = v.byteStride ?? n * sz;
  const base = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const out: number[][] = [];
  for (let k = 0; k < a.count; k++) {
    const row: number[] = [];
    for (let c = 0; c < n; c++) {
      const o = base + k * stride + c * sz;
      let x: number;
      switch (a.componentType) {
        case 5120: x = bin.readInt8(o); if (a.normalized) x = Math.max(x / 127, -1); break;
        case 5121: x = bin.readUInt8(o); if (a.normalized) x /= 255; break;
        case 5122: x = bin.readInt16LE(o); if (a.normalized) x = Math.max(x / 32767, -1); break;
        case 5123: x = bin.readUInt16LE(o); if (a.normalized) x /= 65535; break;
        default: x = bin.readFloatLE(o);
      }
      row.push(x);
    }
    out.push(row);
  }
  return out;
}

const files = glbFiles(ROOT);

test('HD models: normals and tangents are unit length, positions finite', () => {
  assert.ok(files.length > 20, `expected the committed HD models under public/models, found ${files.length}`);
  const bad: string[] = [];
  for (const f of files) {
    const { json, bin } = parse(f);
    for (const [mi, mesh] of (json.meshes ?? []).entries()) {
      for (const [pi, prim] of mesh.primitives.entries()) {
        const at = prim.attributes as Record<string, number>;
        const where = `${f.slice(ROOT.length + 1)} mesh ${mesh.name ?? mi} prim ${pi}`;
        if (at.POSITION !== undefined && read(json, bin, at.POSITION).some((p) => p.some((x) => !Number.isFinite(x)))) bad.push(`${where}: non-finite position`);
        for (const key of ['NORMAL', 'TANGENT']) {
          if (at[key] === undefined) continue;
          const vs = read(json, bin, at[key]);
          const zero = vs.filter((p) => Math.hypot(p[0], p[1], p[2]) < 0.5).length;
          if (zero) bad.push(`${where}: ${zero}/${vs.length} ${key.toLowerCase()}s of near-zero length`);
          if (key === 'TANGENT' && vs.some((p) => p[3] !== 1 && p[3] !== -1)) bad.push(`${where}: tangent w not +-1`);
        }
      }
    }
  }
  assert.deepEqual(bad, [], `degenerate vertex frames (NaN on real GPUs):\n${bad.slice(0, 30).join('\n')}`);
});
