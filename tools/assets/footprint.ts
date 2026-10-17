// Top-view height map of a structure: where its roofs, yards and clutter are, for placing upgrade-module anchors
// (src/render/models/upgrade-modules.ts) so a module sits on a roof or encloses the yard clutter it covers on both
// the procedural and the HD body.
//
//   node --import tsx tools/assets/footprint.ts powr soviet            # procedural and HD side by side
//   node --import tsx tools/assets/footprint.ts fact allies --res 0.1  # coarser grid
//   node --import tsx tools/assets/footprint.ts powr soviet --at 0.6,-0.6,0.3   # max height inside a box (x, z, half size)
//
// Characters by height above the ground: ' ' slab (< 0.07), '.' < 0.15, ':' < 0.3, '-' < 0.5, '=' < 0.7, '+' < 0.9,
// '*' < 1.1, '%' < 1.3, '#' < 1.6, '@' above. Rows run north (-z, top) to south (+z, the camera side).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import type { ModelFaction } from '../../src/render/models';

const ctx2d = new Proxy({}, {
  get: (_t, k) => (k === 'getImageData' ? (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) })
    : k === 'createRadialGradient' || k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}),
  set: () => true,
});
(globalThis as unknown as { document: unknown }).document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) };
const { BUILDINGS } = await import('../../src/data/rules');
const { modelBodyGeometry } = await import('../../src/render/models');

const args = process.argv.slice(2);
const id = args[0];
const fac = (args[1] === 'allies' ? 'allies' : 'soviet') as ModelFaction;
const opt = (f: string, d: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const res = Number(opt('--res', '0.05'));
const atArg = opt('--at', '');
if (!id) {
  console.error('usage: node --import tsx tools/assets/footprint.ts <typeId> [soviet|allies] [--res 0.05] [--at x,z,half]');
  process.exit(1);
}
const size = (BUILDINGS[id] as { size?: [number, number] } | undefined)?.size ?? [2, 2];
const W = Math.round(size[0] / res), H = Math.round(size[1] / res);

type Tri = (cb: (ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number) => void) => void;

function raster(tris: Tri): Float32Array {
  const hm = new Float32Array(W * H).fill(-1);
  const x0 = -size[0] / 2, z0 = -size[1] / 2;
  const put = (x: number, z: number, y: number) => {
    const i = Math.floor((x - x0) / res), j = Math.floor((z - z0) / res);
    if (i < 0 || j < 0 || i >= W || j >= H) return;
    if (y > hm[j * W + i]) hm[j * W + i] = y;
  };
  tris((ax, ay, az, bx, by, bz, cx, cy, cz) => {
    // edges (vertical faces project to lines)
    for (const [px, py, pz, qx, qy, qz] of [[ax, ay, az, bx, by, bz], [bx, by, bz, cx, cy, cz], [cx, cy, cz, ax, ay, az]]) {
      const n = Math.max(1, Math.ceil(Math.hypot(qx - px, qz - pz) / (res * 0.5)));
      for (let k = 0; k <= n; k++) { const t = k / n; put(px + (qx - px) * t, pz + (qz - pz) * t, py + (qy - py) * t); }
    }
    // interior
    const minx = Math.min(ax, bx, cx), maxx = Math.max(ax, bx, cx), minz = Math.min(az, bz, cz), maxz = Math.max(az, bz, cz);
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(d) < 1e-9) return;
    for (let z = Math.floor((minz - z0) / res) * res + z0 + res / 2; z <= maxz; z += res) {
      for (let x = Math.floor((minx - x0) / res) * res + x0 + res / 2; x <= maxx; x += res) {
        const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
        const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
        const l3 = 1 - l1 - l2;
        if (l1 < -1e-4 || l2 < -1e-4 || l3 < -1e-4) continue;
        put(x, z, l1 * ay + l2 * by + l3 * cy);
      }
    }
  });
  return hm;
}

function procTris(): Tri | null {
  const g = modelBodyGeometry(id, false, fac);
  if (!g) return null;
  const p = g.getAttribute('position');
  const ix = g.index!;
  return (cb) => {
    for (let t = 0; t < ix.count; t += 3) {
      const a = ix.getX(t), b = ix.getX(t + 1), c = ix.getX(t + 2);
      cb(p.getX(a), p.getY(a), p.getZ(a), p.getX(b), p.getY(b), p.getZ(b), p.getX(c), p.getY(c), p.getZ(c));
    }
  };
}

function hdTris(): Tri | null {
  const dir = join(import.meta.dirname, '..', '..', 'public', 'models');
  const file = [join(dir, `${id}.${fac}.glb`), join(dir, `${id}.glb`)].find((f) => existsSync(f));
  if (!file) return null;
  const b = readFileSync(file);
  const jl = b.readUInt32LE(12);
  const j = JSON.parse(b.subarray(20, 20 + jl).toString('utf8'));
  const bin = b.subarray(28 + jl);
  const read = (ai: number): { n: number; c: number; get: (i: number, k: number) => number } => {
    const a = j.accessors[ai];
    const bv = j.bufferViews[a.bufferView];
    const comps = a.type === 'SCALAR' ? 1 : a.type === 'VEC2' ? 2 : a.type === 'VEC3' ? 3 : 4;
    const bytes = a.componentType === 5126 || a.componentType === 5125 ? 4 : a.componentType === 5122 || a.componentType === 5123 ? 2 : 1;
    const stride = bv.byteStride ?? comps * bytes;
    const off = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const get = (i: number, k: number) => {
      const o = off + i * stride + k * bytes;
      switch (a.componentType) {
        case 5126: return bin.readFloatLE(o);
        case 5125: return bin.readUInt32LE(o);
        case 5123: return a.normalized ? bin.readUInt16LE(o) / 65535 : bin.readUInt16LE(o);
        case 5122: return a.normalized ? Math.max(-1, bin.readInt16LE(o) / 32767) : bin.readInt16LE(o);
        case 5121: return a.normalized ? bin.readUInt8(o) / 255 : bin.readUInt8(o);
        default: return a.normalized ? Math.max(-1, bin.readInt8(o) / 127) : bin.readInt8(o);
      }
    };
    return { n: a.count, c: comps, get };
  };
  const meshes: { m: THREE.Matrix4; mesh: number }[] = [];
  const walk = (ni: number, parent: THREE.Matrix4) => {
    const n = j.nodes[ni];
    const l = new THREE.Matrix4();
    if (n.matrix) l.fromArray(n.matrix);
    else l.compose(new THREE.Vector3(...(n.translation ?? [0, 0, 0])), new THREE.Quaternion(...(n.rotation ?? [0, 0, 0, 1])), new THREE.Vector3(...(n.scale ?? [1, 1, 1])));
    const w = parent.clone().multiply(l);
    if (n.mesh !== undefined) meshes.push({ m: w, mesh: n.mesh });
    for (const c of n.children ?? []) walk(c, w);
  };
  for (const r of j.scenes[j.scene ?? 0].nodes) walk(r, new THREE.Matrix4());
  const v = new THREE.Vector3();
  return (cb) => {
    for (const { m, mesh } of meshes) {
      for (const pr of j.meshes[mesh].primitives) {
        const P = read(pr.attributes.POSITION);
        const pts = new Float32Array(P.n * 3);
        for (let i = 0; i < P.n; i++) {
          v.set(P.get(i, 0), P.get(i, 1), P.get(i, 2)).applyMatrix4(m);
          pts[i * 3] = v.x; pts[i * 3 + 1] = v.y; pts[i * 3 + 2] = v.z;
        }
        const I = pr.indices !== undefined ? read(pr.indices) : null;
        const cnt = I ? I.n : P.n;
        for (let t = 0; t < cnt; t += 3) {
          const a = I ? I.get(t, 0) : t, bb = I ? I.get(t + 1, 0) : t + 1, c = I ? I.get(t + 2, 0) : t + 2;
          cb(pts[a * 3], pts[a * 3 + 1], pts[a * 3 + 2], pts[bb * 3], pts[bb * 3 + 1], pts[bb * 3 + 2], pts[c * 3], pts[c * 3 + 1], pts[c * 3 + 2]);
        }
      }
    }
  };
}

const CH = [[0.07, ' '], [0.15, '.'], [0.3, ':'], [0.5, '-'], [0.7, '='], [0.9, '+'], [1.1, '*'], [1.3, '%'], [1.6, '#'], [99, '@']] as const;
const ch = (y: number) => (y < 0 ? ' ' : CH.find(([t]) => y < t)![1]);
const p = procTris();
const h = hdTris();
const maps = [p ? raster(p) : null, h ? raster(h) : null];
if (atArg) {
  const [x, z, half] = atArg.split(',').map(Number);
  for (const [k, hm] of maps.entries()) {
    if (!hm) continue;
    let mx = -1;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const cx = -size[0] / 2 + (i + 0.5) * res, cz = -size[1] / 2 + (j + 0.5) * res;
      if (Math.abs(cx - x) <= half && Math.abs(cz - z) <= half) mx = Math.max(mx, hm[j * W + i]);
    }
    console.log(`${k ? 'HD' : 'procedural'}: max height in [${x - half}..${x + half}] x [${z - half}..${z + half}] = ${mx.toFixed(3)}`);
  }
} else {
  console.log(`${id} (${fac}) ${size[0]}x${size[1]}, ${res} per char; left: procedural${h ? ', right: HD' : ' (no HD model)'}; x from ${-size[0] / 2} to ${size[0] / 2}`);
  const ruler = Array.from({ length: W }, (_, i) => { const x = -size[0] / 2 + (i + 0.5) * res; return Math.abs(x - Math.round(x * 2) / 2) < res / 2 ? '|' : ' '; }).join('');
  console.log(`       ${ruler}   ${h ? ruler : ''}`);
  for (let j = 0; j < H; j++) {
    const z = -size[1] / 2 + (j + 0.5) * res;
    const row = (hm: Float32Array | null) => (hm ? Array.from({ length: W }, (_, i) => ch(hm[j * W + i])).join('') : '');
    console.log(`${z.toFixed(2).padStart(6)} ${row(maps[0])}   ${row(maps[1])}`);
  }
}
