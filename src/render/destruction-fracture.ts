/**
 * Procedural fracture of a structure model into chunks, baked once per model type.
 *
 * The model's merged body geometry is split into Voronoi cells (seeded per type, so a type always breaks
 * the same way): triangles inside one cell go to that chunk unchanged, triangles that straddle cells are
 * clipped against the bisector planes with every attribute interpolated. Each chunk becomes one bone of a
 * single SkinnedMesh, so a whole collapsing building is one draw call (+ shadow) using the model's own
 * skinned body material (same shader program as the living model: a collapse never compiles a shader).
 *
 * The models are hollow shells; every chunk triangle gets a reversed, darkened twin so broken-open walls
 * show a sooty interior instead of vanishing when seen from behind.
 *
 * The foundation slab (anything below SLAB_Y) is chunk 0 and never moves.
 */
import * as THREE from 'three';
import { EMISSIVE_BASE } from './models/builder';

export interface FractureChunk {
  /** Rest centroid in model space (bone bind position). */
  c: THREE.Vector3;
  /** Collider half extents (model axes). */
  he: THREE.Vector3;
  /** The static foundation chunk. */
  base: boolean;
  /** Average albedo (linear) of the unpainted parts, for matching rubble. */
  color: THREE.Color;
  /** Share (0..1) of the chunk's surface painted in team colour. */
  team: number;
  /** Highest point (model space). */
  top: number;
  tris: number;
}

export interface FractureData {
  /** Skinned geometry: skinIndex = chunk index. */
  geo: THREE.BufferGeometry;
  chunks: FractureChunk[];
  /** Bone inverse bind matrices (translation by -centroid). */
  inverses: THREE.Matrix4[];
  /** Model-space bounds of the whole structure. */
  box: THREE.Box3;
  /** Roof points (model space) where damage fires and smoke sit, highest first. */
  anchors: THREE.Vector3[];
  /** Bake time (ms), for diagnostics. */
  ms: number;
}

/** Triangles entirely below this height belong to the static foundation. */
const SLAB_Y = 0.065;
/** Floats per clip vertex: pos3 nrm3 uv2 col3 pbr4. */
const VS = 15;
const INTERIOR = [0.045, 0.04, 0.036];

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function rng(seed: number): () => number {
  let s = seed || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) | 0;
    return ((s >>> 8) & 0xffffff) / 16777216;
  };
}

/** Clip a convex polygon (flat array of VS-float vertices) to n·x <= d. */
function clipPoly(poly: Float32Array[], nx: number, ny: number, nz: number, d: number): Float32Array[] {
  const out: Float32Array[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const da = nx * a[0] + ny * a[1] + nz * a[2] - d;
    const db = nx * b[0] + ny * b[1] + nz * b[2] - d;
    if (da <= 0) out.push(a);
    if ((da <= 0) !== (db <= 0)) {
      const t = da / (da - db);
      const v = new Float32Array(VS);
      for (let k = 0; k < VS; k++) v[k] = a[k] + (b[k] - a[k]) * t;
      // re-normalise the interpolated normal
      const l = Math.hypot(v[3], v[4], v[5]) || 1;
      v[3] /= l; v[4] /= l; v[5] /= l;
      // keep categorical channels (team mask, detail channel / emissive flag) from the nearer end
      const src = t < 0.5 ? a : b;
      v[13] = src[13];
      v[14] = src[14];
      out.push(v);
    }
  }
  return out;
}

interface ChunkBuild {
  pos: number[];
  nrm: number[];
  uv: number[];
  col: number[];
  pbr: number[];
  idx: number[];
  /** original vertex index -> local index (unsplit triangles share vertices) */
  remap: Map<number, number>;
}

/**
 * Bake the fracture of a body geometry. `footprint` = structure size in cells (drives the chunk count).
 * Deterministic for a given `key`.
 */
export function bakeFracture(src: THREE.BufferGeometry, key: string, footprint: [number, number]): FractureData {
  const t0 = performance.now();
  const P = src.getAttribute('position') as THREE.BufferAttribute;
  const N = src.getAttribute('normal') as THREE.BufferAttribute;
  const U = src.getAttribute('uv') as THREE.BufferAttribute;
  const C = src.getAttribute('color') as THREE.BufferAttribute;
  const W = src.getAttribute('pbr') as THREE.BufferAttribute;
  const index = src.index!;
  const nv = P.count;

  // ---- bounds of the breakable part
  const box = new THREE.Box3();
  const upper = new THREE.Box3();
  for (let i = 0; i < nv; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    box.expandByPoint(new THREE.Vector3(x, y, z));
    if (y > SLAB_Y) upper.expandByPoint(new THREE.Vector3(x, y, z));
  }
  if (upper.isEmpty()) upper.copy(box);
  const size = upper.getSize(new THREE.Vector3());

  // ---- Voronoi seeds (best-candidate sampling: evenly spread, never on a grid)
  const rnd = rng(hashStr(key));
  const area = footprint[0] * footprint[1];
  const nSeeds = Math.max(5, Math.min(22, Math.round(3 + area * 1.6 + size.y * 2.2)));
  const seeds: THREE.Vector3[] = [];
  const lo = upper.min, hi = upper.max;
  for (let s = 0; s < nSeeds; s++) {
    let best: THREE.Vector3 | null = null;
    let bestD = -1;
    for (let k = 0; k < 14; k++) {
      const c = new THREE.Vector3(
        lo.x + size.x * (0.08 + 0.84 * rnd()),
        // more seeds low down: bigger pieces fall from the top, finer rubble at the base
        Math.max(SLAB_Y + 0.02, lo.y + size.y * Math.pow(rnd(), 1.25)),
        lo.z + size.z * (0.08 + 0.84 * rnd()),
      );
      let d = Infinity;
      for (const o of seeds) d = Math.min(d, (c.x - o.x) ** 2 + ((c.y - o.y) * 1.3) ** 2 + (c.z - o.z) ** 2);
      if (d > bestD) {
        bestD = d;
        best = c;
      }
    }
    seeds.push(best!);
  }
  const nChunks = seeds.length + 1; // + base
  const seedSq = seeds.map((s) => s.lengthSq());

  const nearest = (x: number, y: number, z: number): number => {
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i < seeds.length; i++) {
      const s = seeds[i];
      const d = (x - s.x) ** 2 + (y - s.y) ** 2 + (z - s.z) ** 2;
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    return bi + 1;
  };

  const builds: ChunkBuild[] = [];
  for (let i = 0; i < nChunks; i++) builds.push({ pos: [], nrm: [], uv: [], col: [], pbr: [], idx: [], remap: new Map() });

  const vertOf = (i: number): Float32Array => {
    const v = new Float32Array(VS);
    v[0] = P.getX(i); v[1] = P.getY(i); v[2] = P.getZ(i);
    v[3] = N.getX(i); v[4] = N.getY(i); v[5] = N.getZ(i);
    v[6] = U.getX(i); v[7] = U.getY(i);
    v[8] = C.getX(i); v[9] = C.getY(i); v[10] = C.getZ(i);
    v[11] = W.getX(i); v[12] = W.getY(i); v[13] = W.getZ(i); v[14] = W.getW(i);
    return v;
  };
  const pushVert = (b: ChunkBuild, v: Float32Array): number => {
    const k = b.pos.length / 3;
    b.pos.push(v[0], v[1], v[2]);
    b.nrm.push(v[3], v[4], v[5]);
    b.uv.push(v[6], v[7]);
    b.col.push(v[8], v[9], v[10]);
    b.pbr.push(v[11], v[12], v[13], v[14]);
    return k;
  };
  const pushOrig = (b: ChunkBuild, i: number): number => {
    let k = b.remap.get(i);
    if (k === undefined) {
      k = pushVert(b, vertOf(i));
      b.remap.set(i, k);
    }
    return k;
  };

  const ia = index.array as ArrayLike<number>;
  for (let t = 0; t < ia.length; t += 3) {
    const a = ia[t], b = ia[t + 1], c = ia[t + 2];
    const ya = P.getY(a), yb = P.getY(b), yc = P.getY(c);
    if (Math.max(ya, yb, yc) <= SLAB_Y) {
      const B = builds[0];
      B.idx.push(pushOrig(B, a), pushOrig(B, b), pushOrig(B, c));
      continue;
    }
    const ca = nearest(P.getX(a), ya, P.getZ(a));
    const cb = nearest(P.getX(b), yb, P.getZ(b));
    const cc = nearest(P.getX(c), yc, P.getZ(c));
    if (ca === cb && cb === cc) {
      const B = builds[ca];
      B.idx.push(pushOrig(B, a), pushOrig(B, b), pushOrig(B, c));
      continue;
    }
    // straddles cells: clip against every cell (cells far from the triangle empty out on the first planes)
    const tri = [vertOf(a), vertOf(b), vertOf(c)];
    for (let ci = 0; ci < seeds.length; ci++) {
      let poly = tri;
      const si = seeds[ci];
      for (let cj = 0; cj < seeds.length && poly.length >= 3; cj++) {
        if (cj === ci) continue;
        const sj = seeds[cj];
        poly = clipPoly(poly, sj.x - si.x, sj.y - si.y, sj.z - si.z, (seedSq[cj] - seedSq[ci]) / 2);
      }
      if (poly.length < 3) continue;
      const B = builds[ci + 1];
      const base = B.pos.length / 3;
      for (const v of poly) pushVert(B, v);
      for (let k = 1; k < poly.length - 1; k++) B.idx.push(base, base + k, base + k + 1);
    }
  }

  // ---- chunk metadata + final skinned geometry (front faces + darkened reversed interior twins)
  const chunks: FractureChunk[] = [];
  const inverses: THREE.Matrix4[] = [];
  let total = 0;
  for (const b of builds) total += b.pos.length / 3;
  const pos = new Float32Array(total * 2 * 3);
  const nrm = new Float32Array(total * 2 * 3);
  const uv = new Float32Array(total * 2 * 2);
  const col = new Float32Array(total * 2 * 3);
  const pbr = new Float32Array(total * 2 * 4);
  const si = new Uint16Array(total * 2 * 4);
  const sw = new Float32Array(total * 2 * 4);
  const idx: number[] = [];
  let vo = 0;
  for (let ci = 0; ci < builds.length; ci++) {
    const b = builds[ci];
    const n = b.pos.length / 3;
    const bb = new THREE.Box3();
    const sum = new THREE.Color(0, 0, 0);
    let wsum = 0;
    let teamSum = 0;
    for (let i = 0; i < n; i++) {
      bb.expandByPoint(new THREE.Vector3(b.pos[i * 3], b.pos[i * 3 + 1], b.pos[i * 3 + 2]));
      if (b.pbr[i * 4 + 3] < EMISSIVE_BASE - 0.5) {
        const t = b.pbr[i * 4 + 2];
        teamSum += t;
        // painted vertices carry a white base colour: count their shade, not their whiteness
        const k = 1 - t * 0.6;
        sum.r += b.col[i * 3] * k;
        sum.g += b.col[i * 3 + 1] * k;
        sum.b += b.col[i * 3 + 2] * k;
        wsum++;
      }
    }
    const c = n ? bb.getCenter(new THREE.Vector3()) : new THREE.Vector3();
    const he = n ? bb.getSize(new THREE.Vector3()).multiplyScalar(0.5) : new THREE.Vector3(0.05, 0.05, 0.05);
    chunks.push({
      c,
      // irregular shells: a slightly shrunken box collider rests more believably
      he: he.clone().multiplyScalar(0.82).max(new THREE.Vector3(0.025, 0.025, 0.025)),
      base: ci === 0,
      color: wsum ? sum.multiplyScalar(1 / wsum) : new THREE.Color(0.3, 0.3, 0.3),
      team: wsum ? teamSum / wsum : 0,
      top: n ? bb.max.y : 0,
      tris: b.idx.length / 3,
    });
    inverses.push(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
    for (let twin = 0; twin < 2; twin++) {
      for (let i = 0; i < n; i++) {
        const o = vo + i;
        pos[o * 3] = b.pos[i * 3];
        pos[o * 3 + 1] = b.pos[i * 3 + 1];
        pos[o * 3 + 2] = b.pos[i * 3 + 2];
        const sgn = twin ? -1 : 1;
        nrm[o * 3] = b.nrm[i * 3] * sgn;
        nrm[o * 3 + 1] = b.nrm[i * 3 + 1] * sgn;
        nrm[o * 3 + 2] = b.nrm[i * 3 + 2] * sgn;
        uv[o * 2] = b.uv[i * 2];
        uv[o * 2 + 1] = b.uv[i * 2 + 1];
        if (twin) {
          // sooty interior: dark, rough, plain concrete detail, never emissive
          col[o * 3] = INTERIOR[0] + b.col[i * 3] * 0.06;
          col[o * 3 + 1] = INTERIOR[1] + b.col[i * 3 + 1] * 0.06;
          col[o * 3 + 2] = INTERIOR[2] + b.col[i * 3 + 2] * 0.06;
          pbr[o * 4] = 0;
          pbr[o * 4 + 1] = 0.95;
          pbr[o * 4 + 2] = 0;
          pbr[o * 4 + 3] = 1;
        } else {
          col[o * 3] = b.col[i * 3];
          col[o * 3 + 1] = b.col[i * 3 + 1];
          col[o * 3 + 2] = b.col[i * 3 + 2];
          pbr[o * 4] = b.pbr[i * 4];
          pbr[o * 4 + 1] = b.pbr[i * 4 + 1];
          pbr[o * 4 + 2] = b.pbr[i * 4 + 2];
          pbr[o * 4 + 3] = b.pbr[i * 4 + 3];
        }
        si[o * 4] = ci;
        sw[o * 4] = 1;
      }
      for (let k = 0; k < b.idx.length; k += 3) {
        if (twin) idx.push(vo + b.idx[k], vo + b.idx[k + 2], vo + b.idx[k + 1]);
        else idx.push(vo + b.idx[k], vo + b.idx[k + 1], vo + b.idx[k + 2]);
      }
      vo += n;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('pbr', new THREE.BufferAttribute(pbr, 4));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  geo.setIndex(vo > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  geo.name = `fracture:${key}`;

  return { geo, chunks, inverses, box, anchors: roofAnchors(src, footprint), ms: performance.now() - t0 };
}

/**
 * Up to four roof points spread over the footprint (highest upward-facing surface per quadrant), highest
 * first: where damage fires and smoke columns sit on a burning structure.
 */
function roofAnchors(src: THREE.BufferGeometry, footprint: [number, number]): THREE.Vector3[] {
  const P = src.getAttribute('position') as THREE.BufferAttribute;
  const N = src.getAttribute('normal') as THREE.BufferAttribute;
  const W = src.getAttribute('pbr') as THREE.BufferAttribute;
  const best: (THREE.Vector3 | null)[] = [null, null, null, null];
  const hx = footprint[0] / 2, hz = footprint[1] / 2;
  for (let i = 0; i < P.count; i++) {
    if (N.getY(i) < 0.6 || W.getW(i) >= EMISSIVE_BASE - 0.5) continue;
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    if (Math.abs(x) > hx * 0.85 || Math.abs(z) > hz * 0.85) continue;
    const q = (x < 0 ? 0 : 1) + (z < 0 ? 0 : 2);
    const b = best[q];
    if (!b || y > b.y) best[q] = new THREE.Vector3(x * 0.85, y, z * 0.85);
  }
  return best.filter((b): b is THREE.Vector3 => !!b && b.y > SLAB_Y + 0.05).sort((a, b) => b.y - a.y);
}
