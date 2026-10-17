/**
 * Template builder.
 *
 * Models are described once per type as a tree of nodes (NB). Each node holds geometry grouped by
 * material "slot". At template time:
 *   - ALL 'body' geometry of the whole tree (including animated nodes such as turrets, barrels,
 *     arms, doors, dishes) is merged into ONE skinned geometry; every node that carries body
 *     geometry becomes a bone. A model's body therefore costs a single draw call no matter how
 *     many moving parts it has.
 *   - Steady emissive bits (windows, head/tail lights...) are baked into the body via a per-vertex
 *     emissive term (see materials.ts), switched by the material's powered/unpowered variant.
 *   - Other slots stay separate meshes attached to their node:
 *       'track'        scrolling tread material (tracks, tyres)
 *       'glow:<name>'  independently animated unlit HDR emissive (blinking beacons, charge glows)
 *       'fx:<key>'     transparent fx (rotor blur, additive halos)
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ModelAnimState, ModelInstance } from './types';
import { bodyMaterial, fxMaterial, glowMaterial, setBodyDetail, shadowDepthMaterial, trackMaterial } from './materials';

export type V3 = [number, number, number];

/** Owner faction a template is dressed for (banners, emblems, slogans, lights). */
export type ModelFaction = 'allies' | 'soviet';

/** Surface description for body parts. c = sRGB hex, m = metalness, r = roughness,
 *  t = team mask 0..1, d = detail channel (0 metal, 1 concrete, 2 fabric, 3 none), uv = detail density. */
export interface Mat {
  c: number;
  m: number;
  r: number;
  t?: number;
  d?: number;
  uv?: number;
  /**
   * Weathering controls (see materials.ts, 'wear' attribute):
   *   w    = edge wear on chamfered edges: paint chipped to bare metal / scuffed concrete (default by material)
   *   g    = rust / grime streaks running down vertical faces from the part's top edge (default by material)
   *   snow = how much snow settles on its up-facing faces in winter (0..1, default 1; scaled by NB.snow)
   */
  w?: number;
  g?: number;
  snow?: number;
  /**
   * Material flags (packed into pbr.y above the roughness, read by the body shader):
   *   camo = disruptive camouflage blotches over the team paint (dark shade + sand / winter white)
   *   mud  = mud (winter: grey slush) caked on the lower hull, below ~0.13 model units, with splatter
   *   soot = exhaust scorch: mottled black soot, matte (exhaust plates, gun ports, burner nozzles)
   */
  camo?: boolean;
  mud?: boolean;
  soot?: boolean;
}

/** pbr.y = roughness + MAT_FLAG_STEP * flags (bit 1 camo, 2 mud, 4 soot). */
export const MAT_FLAG_STEP = 2;
export const MAT_CAMO = 1;
export const MAT_MUD = 2;
export const MAT_SOOT = 4;

/** Emissive description: colour hex and relative brightness multiplier. */
export interface Glow {
  glow: number;
  i?: number;
  /**
   * Shader-driven animation of emissive parts baked into the body (free: no extra draw call):
   * 1 = blink (warning lights), 2 = slow pulse, 3 = fire flicker, 4 = fast strobe. The fractional part is a
   * phase offset; every instance also gets its own phase from its world position.
   */
  a?: number;
}

export type Surface = Mat | Glow;

export interface AddOpts {
  p?: V3;
  r?: V3;
  s?: V3 | number;
  /** Material slot override (default 'body'; 'glow' is an alias of 'body' for emissive surfaces) */
  slot?: string;
  /** Keep the geometry's own UVs instead of box projection */
  keepUv?: boolean;
  /**
   * Level of detail: 0 = close-up detail only (dropped from the distant body), 1 = distant body only.
   * Default: automatic (tiny or wire-thin non-emissive parts become close-up detail).
   */
  lod?: 0 | 1;
}

interface MeshT {
  slot: string;
  geo: THREE.BufferGeometry;
}

export interface NodeT {
  name: string;
  pos: V3;
  rot: V3;
  visible: boolean;
  /** Bone index into the skinned body, or -1 if this node is a plain Object3D. */
  bone: number;
  meshes: MeshT[];
  children: NodeT[];
}

const _mat4 = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _pos = new THREE.Vector3();
const _scl = new THREE.Vector3();
const _col = new THREE.Color();
/** Brightness at the bottom of each part relative to its top. */
const PART_GRADIENT = 0.74;
/** pbr.w >= EMISSIVE_BASE marks emissive vertices; intensity = pbr.w - EMISSIVE_BASE. */
export const EMISSIVE_BASE = 4;

export function isGlow(s: Surface): s is Glow {
  return (s as Glow).glow !== undefined;
}

function normSlot(slot: string | undefined): string {
  if (!slot || slot === 'glow') return 'body';
  return slot;
}

/** Copy only position/normal/uv, force indexed, transform, re-project UVs, add color+pbr. */
function prepGeometry(src: THREE.BufferGeometry, matrix: THREE.Matrix4, surf: Surface, keepUv: boolean, slot: string, lod?: 0 | 1): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  const pos = src.getAttribute('position') as THREE.BufferAttribute;
  out.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos.array as ArrayLike<number>), 3));
  let nrm = src.getAttribute('normal') as THREE.BufferAttribute | undefined;
  if (!nrm) {
    src.computeVertexNormals();
    nrm = src.getAttribute('normal') as THREE.BufferAttribute;
  }
  out.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nrm.array as ArrayLike<number>), 3));
  const n = pos.count;
  const uvSrc = src.getAttribute('uv') as THREE.BufferAttribute | undefined;
  const uv = new Float32Array(n * 2);
  if (keepUv && uvSrc) uv.set(uvSrc.array as ArrayLike<number>);
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (src.index) {
    out.setIndex(new THREE.BufferAttribute(new Uint32Array(src.index.array as ArrayLike<number>), 1));
  } else {
    const idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    out.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  out.applyMatrix4(matrix);
  if (matrix.determinant() < 0) {
    const ia = out.index!.array as Uint32Array;
    for (let i = 0; i < ia.length; i += 3) {
      const t = ia[i + 1];
      ia[i + 1] = ia[i + 2];
      ia[i + 2] = t;
    }
  }

  const P = out.getAttribute('position').array as Float32Array;
  const N = out.getAttribute('normal').array as Float32Array;
  if (!keepUv) {
    const dens = isGlow(surf) ? 1 : surf.uv ?? ((surf.d ?? 0) === 1 ? 0.9 : (surf.d ?? 0) === 2 ? 3 : 2.2);
    for (let i = 0; i < n; i++) {
      const ax = Math.abs(N[i * 3]);
      const ay = Math.abs(N[i * 3 + 1]);
      const az = Math.abs(N[i * 3 + 2]);
      let u: number;
      let v: number;
      if (ax >= ay && ax >= az) {
        u = P[i * 3 + 2];
        v = P[i * 3 + 1];
      } else if (ay >= az) {
        u = P[i * 3];
        v = P[i * 3 + 2];
      } else {
        u = P[i * 3];
        v = P[i * 3 + 1];
      }
      uv[i * 2] = u * dens;
      uv[i * 2 + 1] = v * dens;
    }
  }

  const col = new Float32Array(n * 3);
  const pbr = new Float32Array(n * 4);
  if (isGlow(surf)) {
    _col.setHex(surf.glow);
    const k = surf.i ?? 1;
    // In the body slot the colour is the emissive colour and intensity goes into pbr.w.
    // In separate glow slots (MeshBasicMaterial) the intensity is baked into the colour.
    const inBody = slot === 'body';
    for (let i = 0; i < n; i++) {
      col[i * 3] = _col.r * (inBody ? 1 : k);
      col[i * 3 + 1] = _col.g * (inBody ? 1 : k);
      col[i * 3 + 2] = _col.b * (inBody ? 1 : k);
      pbr[i * 4] = 0;
      pbr[i * 4 + 1] = 0.6;
      pbr[i * 4 + 3] = inBody ? EMISSIVE_BASE + k : 3;
    }
  } else {
    _col.setHex(surf.c);
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      const y = P[i * 3 + 1];
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const span = maxY - minY;
    const gMin = span > 0.02 ? PART_GRADIENT : 1;
    const matFlags = (surf.camo ? MAT_CAMO : 0) | (surf.mud ? MAT_MUD : 0) | (surf.soot ? MAT_SOOT : 0);
    for (let i = 0; i < n; i++) {
      const t = span > 0 ? (P[i * 3 + 1] - minY) / span : 1;
      const k = gMin + (1 - gMin) * Math.sqrt(t);
      col[i * 3] = _col.r * k;
      col[i * 3 + 1] = _col.g * k;
      col[i * 3 + 2] = _col.b * k;
      pbr[i * 4] = surf.m;
      pbr[i * 4 + 1] = surf.r + MAT_FLAG_STEP * matFlags;
      pbr[i * 4 + 2] = surf.t ?? 0;
      pbr[i * 4 + 3] = surf.d ?? 0;
    }
  }
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setAttribute('pbr', new THREE.BufferAttribute(pbr, 4));
  out.setAttribute('wear', new THREE.BufferAttribute(wearAttr(src, P, N, n, surf), 4));
  out.userData.lod = lodClass(out, surf, lod);
  return out;
}

/** Streak length (world units): rust / grime fades out this far below the top edge of a part. */
const STREAK_LEN = 0.32;
let partSeed = 0x2545f491;

/**
 * Per-vertex weathering ('wear', vec4), read by the body material:
 *   surfaces: x = edge wear (chamfer facets), y = streak strength (from the part's top edge down),
 *             z = cavity occlusion (baked later for structures), w = snow steps (0..7) + part seed (0..1)
 *   emissive: x = animation mode + phase (see Glow.a)
 * Geometry without the attribute (fracture chunks) reads (0, 0, 0, 1): plain, no wear, light snow.
 */
function wearAttr(src: THREE.BufferGeometry, P: Float32Array, N: Float32Array, n: number, surf: Surface): Float32Array {
  const out = new Float32Array(n * 4);
  partSeed = Math.imul(partSeed ^ (partSeed >>> 15), 0x2c1b3c6d) + 0x9e3779b9;
  const seed = ((partSeed >>> 8) & 0xffff) / 65536;
  if (isGlow(surf)) {
    const a = surf.a ?? 0;
    for (let i = 0; i < n; i++) {
      out[i * 4] = a;
      out[i * 4 + 3] = 7 + seed * 0.99;
    }
    return out;
  }
  const d = surf.d ?? 0;
  // painted metal chips most, concrete scuffs, glass / chrome / decals (d 3) and fabric barely
  const wAmt = surf.w ?? (d === 0 ? 1 : d === 1 ? 0.7 : d === 2 ? 0.15 : 0.25);
  const gAmt = surf.g ?? (d === 0 ? 1 : d === 1 ? 0.9 : d === 2 ? 0.3 : 0.15);
  const snowQ = Math.round(Math.max(0, Math.min(1, surf.snow ?? 1)) * 7);
  const edge = src.getAttribute('edge') as THREE.BufferAttribute | undefined;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) maxY = Math.max(maxY, P[i * 3 + 1]);
  for (let i = 0; i < n; i++) {
    out[i * 4] = edge ? edge.getX(i) * wAmt : 0;
    // only side faces streak (the shader also masks by the normal)
    const side = 1 - Math.abs(N[i * 3 + 1]);
    out[i * 4 + 1] = gAmt * side * Math.exp(-(maxY - P[i * 3 + 1]) / STREAK_LEN);
    out[i * 4 + 3] = snowQ + seed * 0.99;
  }
  return out;
}

/** Parts smaller than this (largest dimension) only show up close. */
const DETAIL_MAX = 0.028;
/** Wire-thin parts (antennas, rails, cables): middle dimension below this only show up close. */
const DETAIL_THIN = 0.011;

/** -1 = both levels, 0 = close-up only, 1 = distant only. */
function lodClass(g: THREE.BufferGeometry, surf: Surface, lod: 0 | 1 | undefined): number {
  if (lod !== undefined) return lod;
  if (isGlow(surf)) return -1;
  g.computeBoundingBox();
  const b = g.boundingBox!;
  const dx = b.max.x - b.min.x, dy = b.max.y - b.min.y, dz = b.max.z - b.min.z;
  const mx = Math.max(dx, dy, dz);
  const mn = Math.min(dx, dy, dz);
  const mid = dx + dy + dz - mx - mn;
  return mx < DETAIL_MAX || mid < DETAIL_THIN ? 0 : -1;
}

export function composeMatrix(p?: V3, r?: V3, s?: V3 | number): THREE.Matrix4 {
  _pos.set(p?.[0] ?? 0, p?.[1] ?? 0, p?.[2] ?? 0);
  _euler.set(r?.[0] ?? 0, r?.[1] ?? 0, r?.[2] ?? 0);
  _quat.setFromEuler(_euler);
  if (s === undefined) _scl.set(1, 1, 1);
  else if (typeof s === 'number') _scl.set(s, s, s);
  else _scl.set(s[0], s[1], s[2]);
  return _mat4.compose(_pos, _quat, _scl);
}

export interface BoxOpts {
  /** chamfer size; < 0.004 gives a plain 12-triangle box */
  b?: number;
  /** ignored (kept for call-site compatibility) */
  seg?: number;
  r?: V3;
  slot?: string;
}

export interface CylOpts {
  seg?: number;
  r?: V3;
  slot?: string;
  open?: boolean;
  s?: V3 | number;
}

/** Node builder. */
export class NB {
  readonly parts = new Map<string, THREE.BufferGeometry[]>();
  readonly children: NB[] = [];
  visible = true;
  /** Ground-AO parameters (root only; applied to the merged body in model space). */
  ao?: { h: number; min: number };
  /** Root only: snow multiplier for the whole model (default 0.3: units get a light dusting). */
  snow?: number;
  /** Root only: bake cavity occlusion (crevices, under ledges, contact shadows) into the body. */
  cavity?: boolean;
  /** Root only: mud / slush on the lower hull of every part (sets Mat.mud on the whole model). */
  mud?: boolean;
  /** Root only: camouflage on every team-painted part (sets Mat.camo where the team mask >= 0.5). */
  camo?: boolean;
  /**
   * Default level of detail of the non-emissive parts added to this node (AddOpts.lod overrides).
   * Greeble helpers build into a child node with lod 0 (close-up only) and merge it in.
   */
  lod?: 0 | 1;

  constructor(
    public name: string,
    public pos: V3 = [0, 0, 0],
    public rot: V3 = [0, 0, 0],
  ) {}

  add(geo: THREE.BufferGeometry, surf: Surface, o: AddOpts = {}): this {
    const slot = normSlot(o.slot);
    const m = composeMatrix(o.p, o.r, o.s);
    const g = prepGeometry(geo, m, surf, !!o.keepUv, slot, o.lod ?? (isGlow(surf) ? undefined : this.lod));
    let list = this.parts.get(slot);
    if (!list) this.parts.set(slot, (list = []));
    list.push(g);
    return this;
  }

  box(surf: Surface, w: number, h: number, d: number, x: number, y: number, z: number, o: BoxOpts = {}): this {
    const g = boxGeo(w, h, d, o.b ?? 0.012);
    // chamfered boxes (44 triangles) show up close; the distant body gets a plain 12-triangle box
    if (this.lod === undefined && !isGlow(surf) && normSlot(o.slot) === 'body' && g.getAttribute('edge')) {
      this.add(g, surf, { p: [x, y, z], r: o.r, slot: o.slot, lod: 0 });
      return this.add(boxGeo(w, h, d, 0), surf, { p: [x, y, z], r: o.r, slot: o.slot, lod: 1 });
    }
    return this.add(g, surf, { p: [x, y, z], r: o.r, slot: o.slot });
  }

  cyl(surf: Surface, rt: number, rb: number, h: number, x: number, y: number, z: number, o: CylOpts = {}): this {
    const seg = Math.min(o.seg ?? 8, maxSeg(Math.max(rt, rb)));
    // round parts: fewer sides in the distant body
    if (this.lod === undefined && seg > 6 && !isGlow(surf) && normSlot(o.slot) === 'body') {
      this.add(cylGeo(rt, rb, h, seg, !!o.open), surf, { p: [x, y, z], r: o.r, s: o.s, slot: o.slot, lod: 0 });
      return this.add(cylGeo(rt, rb, h, Math.max(6, Math.round(seg * 0.6)), !!o.open), surf, { p: [x, y, z], r: o.r, s: o.s, slot: o.slot, lod: 1 });
    }
    return this.add(cylGeo(rt, rb, h, seg, !!o.open), surf, { p: [x, y, z], r: o.r, s: o.s, slot: o.slot });
  }

  sph(surf: Surface, r: number, x: number, y: number, z: number, o: { s?: V3; seg?: number; slot?: string; r?: V3 } = {}): this {
    const seg = Math.min(o.seg ?? 8, r < 0.025 ? 4 : maxSeg(r));
    return this.add(sphGeo(r, seg), surf, { p: [x, y, z], s: o.s, slot: o.slot, r: o.r });
  }

  node(name: string, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0]): NB {
    const c = new NB(name, pos, rot);
    this.children.push(c);
    return c;
  }

  hasBodyDeep(): boolean {
    if (this.parts.has('body')) return true;
    return this.children.some((c) => c.hasBodyDeep());
  }
}

// ---------------------------------------------------------------------------------------------
// Cheap primitives (cached source geometry)
// ---------------------------------------------------------------------------------------------

/** Radial segment budget by radius (world units): small parts get very few segments. */
export function maxSeg(r: number): number {
  return r < 0.02 ? 5 : r < 0.045 ? 6 : r < 0.1 ? 8 : r < 0.22 ? 10 : r < 0.4 ? 12 : 14;
}

const boxCache = new Map<string, THREE.BufferGeometry>();

/** Chamfered box (44 triangles; flat bevel facets catch highlights) or a plain box (12) for tiny bevels. */
export function boxGeo(w: number, h: number, d: number, bevel = 0.012): THREE.BufferGeometry {
  const b = Math.min(bevel, w * 0.3, h * 0.3, d * 0.3);
  const key = `${w.toFixed(4)},${h.toFixed(4)},${d.toFixed(4)},${b.toFixed(4)}`;
  let g = boxCache.get(key);
  if (!g) {
    g = b >= 0.004 && Math.min(w, h, d) >= 0.03 ? chamferBox(w, h, d, b) : new THREE.BoxGeometry(w, h, d);
    boxCache.set(key, g);
  }
  return g;
}

function chamferBox(w: number, h: number, d: number, b: number): THREE.BufferGeometry {
  const H = [w / 2, h / 2, d / 2];
  const pos: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  const edg: number[] = []; // 1 on bevel facets (edge wear / catch-light)
  let isEdge = 0;
  // vertex of a corner (signs) lying on the face perpendicular to axis a
  const fv = (s: number[], a: number): number[] => [0, 1, 2].map((k) => s[k] * (k === a ? H[k] : H[k] - b));
  const poly = (pts: number[][]) => {
    const c = [0, 0, 0];
    for (const p of pts) for (let k = 0; k < 3; k++) c[k] += p[k] / pts.length;
    const e1 = [0, 1, 2].map((k) => pts[1][k] - pts[0][k]);
    const e2 = [0, 1, 2].map((k) => pts[2][k] - pts[0][k]);
    let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    if (n[0] * c[0] + n[1] * c[1] + n[2] * c[2] < 0) {
      pts = [...pts].reverse();
      n = n.map((v) => -v);
    }
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    const base = pos.length / 3;
    for (const p of pts) {
      pos.push(p[0], p[1], p[2]);
      nrm.push(n[0] / len, n[1] / len, n[2] / len);
      edg.push(isEdge);
    }
    for (let i = 1; i < pts.length - 1; i++) idx.push(base, base + i, base + i + 1);
  };
  const sq = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  for (let a = 0; a < 3; a++) {
    const u = (a + 1) % 3;
    const v = (a + 2) % 3;
    for (const s of [-1, 1]) {
      poly(
        sq.map(([su, sv]) => {
          const sg = [0, 0, 0];
          sg[a] = s;
          sg[u] = su;
          sg[v] = sv;
          return fv(sg, a);
        }),
      );
    }
  }
  isEdge = 1;
  for (let a = 0; a < 3; a++) {
    const bb = (a + 1) % 3;
    const c = (a + 2) % 3;
    for (const sa of [-1, 1]) {
      for (const sb of [-1, 1]) {
        const mk = (sc: number) => {
          const sg = [0, 0, 0];
          sg[a] = sa;
          sg[bb] = sb;
          sg[c] = sc;
          return sg;
        };
        poly([fv(mk(-1), a), fv(mk(1), a), fv(mk(1), bb), fv(mk(-1), bb)]);
      }
    }
  }
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) poly([fv([sx, sy, sz], 0), fv([sx, sy, sz], 1), fv([sx, sy, sz], 2)]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('edge', new THREE.Float32BufferAttribute(edg, 1));
  g.setIndex(idx);
  return g;
}

const cylCache = new Map<string, THREE.BufferGeometry>();
export function cylGeo(rt: number, rb: number, h: number, seg = 8, open = false): THREE.BufferGeometry {
  const key = `${rt.toFixed(4)},${rb.toFixed(4)},${h.toFixed(4)},${seg},${open}`;
  let g = cylCache.get(key);
  if (!g) {
    g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
    cylCache.set(key, g);
  }
  return g;
}

const sphCache = new Map<string, THREE.BufferGeometry>();
/** Low-poly sphere; seg <= 4 gives an octahedron (8 tris). */
export function sphGeo(r: number, seg = 8): THREE.BufferGeometry {
  const key = `${r.toFixed(4)},${seg}`;
  let g = sphCache.get(key);
  if (!g) {
    g = seg <= 4 ? new THREE.OctahedronGeometry(r, 0) : new THREE.SphereGeometry(r, seg, Math.max(3, Math.round(seg * 0.6)));
    sphCache.set(key, g);
  }
  return g;
}

// ---------------------------------------------------------------------------------------------
// Templates & instancing
// ---------------------------------------------------------------------------------------------

export type AnimFn = (c: Ctx, s: ModelAnimState) => void;

interface SkinT {
  geo: THREE.BufferGeometry;
  /** Distant body without the close-up detail parts (null when it would save too little). */
  geoLo: THREE.BufferGeometry | null;
  inverses: THREE.Matrix4[];
  sphere: THREE.Sphere;
  /** Only the root bone carries geometry: render as a plain (non-skinned) Mesh. */
  rigid: boolean;
}

export interface ModelTemplate {
  root: NodeT;
  skin: SkinT | null;
  /** Node name of each bone index of the skinned body. */
  boneNames: string[];
  height: number;
  radius: number;
  turret?: string;
  muzzles: string[];
  smoke?: string[];
  /** Base HDR intensity per separate glow slot. Default 3. */
  glow?: Record<string, number>;
  /** Ambient effect points (node names) per emitter kind: steam vents, welding sparks. */
  fx?: Partial<Record<'steam' | 'sparks', string[]>>;
  anim?: AnimFn;
  init?: (c: Ctx) => void;
}

export interface TemplateSpec {
  root: NB;
  height: number;
  radius: number;
  turret?: string;
  muzzles?: string[];
  smoke?: string[];
  glow?: Record<string, number>;
  fx?: Partial<Record<'steam' | 'sparks', string[]>>;
  anim?: AnimFn;
  init?: (c: Ctx) => void;
}

const DUST = [0.11, 0.085, 0.055];
/** Snow multiplier of templates that do not set NB.snow (units: a light dusting). */
const DEFAULT_SNOW = 0.3;

/**
 * Cavity occlusion baked into wear.z: the parts are splatted into a coarse voxel grid and every
 * vertex marches a few short rays over its hemisphere. Darkens crevices, the feet of roof clutter, pipes
 * against walls and the undersides of ledges (and keeps snow out of them). Costs a few ms per structure.
 */
function bakeCavity(parts: THREE.BufferGeometry[]): void {
  const C = 0.055;
  const box = new THREE.Box3();
  for (const g of parts) {
    g.computeBoundingBox();
    box.union(g.boundingBox!);
  }
  const R = 0.26;
  const ox = box.min.x - R, oy = box.min.y - R, oz = box.min.z - R;
  const nx = Math.ceil((box.max.x - box.min.x + 2 * R) / C) + 1;
  const ny = Math.ceil((box.max.y - box.min.y + 2 * R) / C) + 1;
  const nz = Math.ceil((box.max.z - box.min.z + 2 * R) / C) + 1;
  if (nx * ny * nz > 4e6) return;
  const occ = new Uint8Array(nx * ny * nz);
  const mark = (x: number, y: number, z: number) => {
    const i = ((x - ox) / C) | 0, j = ((y - oy) / C) | 0, k = ((z - oz) / C) | 0;
    occ[(j * nz + k) * nx + i] = 1;
  };
  // the ground (slab top and below) is solid: fill those layers directly instead of splatting the slab
  const FLOOR = 0.035;
  const jFloor = Math.max(0, Math.min(ny, Math.floor((FLOOR - oy) / C) + 1));
  occ.fill(1, 0, jFloor * nz * nx);
  for (const g of parts) {
    // the distant body's shapes are enough for occupancy (close-up twins and greebles add nothing)
    if (g.userData.lod === 0) continue;
    const W = g.getAttribute('pbr').array as Float32Array;
    const P = g.getAttribute('position').array as Float32Array;
    const I = g.index!.array as ArrayLike<number>;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      if (W[I[t] * 4 + 3] >= EMISSIVE_BASE - 0.5) continue;
      if (P[a + 1] < FLOOR && P[b + 1] < FLOOR && P[c + 1] < FLOOR + 0.012) continue;
      // scan lines parallel to the longest edge, stepping toward the opposite vertex (skinny bevel strips
      // and rails cost a handful of samples instead of a square grid)
      const lab = Math.hypot(P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]);
      const lbc = Math.hypot(P[c] - P[b], P[c + 1] - P[b + 1], P[c + 2] - P[b + 2]);
      const lca = Math.hypot(P[a] - P[c], P[a + 1] - P[c + 1], P[a + 2] - P[c + 2]);
      let p0 = a, p1 = b, p2 = c, L = lab;
      if (lbc >= lab && lbc >= lca) { p0 = b; p1 = c; p2 = a; L = lbc; }
      else if (lca >= lab && lca >= lbc) { p0 = c; p1 = a; p2 = b; L = lca; }
      const area2 = Math.hypot(
        (P[p1 + 1] - P[p0 + 1]) * (P[p2 + 2] - P[p0 + 2]) - (P[p1 + 2] - P[p0 + 2]) * (P[p2 + 1] - P[p0 + 1]),
        (P[p1 + 2] - P[p0 + 2]) * (P[p2] - P[p0]) - (P[p1] - P[p0]) * (P[p2 + 2] - P[p0 + 2]),
        (P[p1] - P[p0]) * (P[p2 + 1] - P[p0 + 1]) - (P[p1 + 1] - P[p0 + 1]) * (P[p2] - P[p0]),
      );
      const hgt = L > 1e-6 ? area2 / L : 0;
      const nv = Math.max(1, Math.ceil(hgt / (C * 0.8)));
      for (let i = 0; i <= nv; i++) {
        const t = i / nv;
        const ax = P[p0] + (P[p2] - P[p0]) * t, ay = P[p0 + 1] + (P[p2 + 1] - P[p0 + 1]) * t, az = P[p0 + 2] + (P[p2 + 2] - P[p0 + 2]) * t;
        const bx = P[p1] + (P[p2] - P[p1]) * t, by = P[p1 + 1] + (P[p2 + 1] - P[p1 + 1]) * t, bz = P[p1 + 2] + (P[p2 + 2] - P[p1 + 2]) * t;
        const k = Math.max(1, Math.ceil(((1 - t) * L) / (C * 0.8)));
        for (let j = 0; j <= k; j++) {
          const f = j / k;
          mark(ax + (bx - ax) * f, ay + (by - ay) * f, az + (bz - az) * f);
        }
      }
    }
  }
  // fixed hemisphere directions (z-up), rotated onto each normal
  const DIRS: number[][] = [];
  for (let k = 0; k < 8; k++) {
    const th = Math.acos(Math.sqrt(1 - (k + 0.5) / 8));
    const ph = k * 2.39996;
    DIRS.push([Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)]);
  }
  const steps = Math.ceil(R / C);
  const t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), nv = new THREE.Vector3();
  // vertices starting in the same voxel with the same dominant normal share one result (chamfer corners,
  // close-up / distant twins of the same part)
  const cache = new Map<number, number>();
  for (const g of parts) {
    const P = g.getAttribute('position').array as Float32Array;
    const N = g.getAttribute('normal').array as Float32Array;
    const W = g.getAttribute('pbr').array as Float32Array;
    const wear = g.getAttribute('wear').array as Float32Array;
    const n = P.length / 3;
    for (let i = 0; i < n; i++) {
      if (W[i * 4 + 3] >= EMISSIVE_BASE - 0.5) continue;
      nv.set(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]);
      if (nv.lengthSq() < 0.5) continue;
      const sx = P[i * 3] + nv.x * C * 1.6, sy = P[i * 3 + 1] + nv.y * C * 1.6, sz = P[i * 3 + 2] + nv.z * C * 1.6;
      const ax = Math.abs(nv.x), ay = Math.abs(nv.y), az = Math.abs(nv.z);
      const axis = ax >= ay && ax >= az ? (nv.x > 0 ? 0 : 1) : ay >= az ? (nv.y > 0 ? 2 : 3) : nv.z > 0 ? 4 : 5;
      const key = ((((sy - oy) / C) | 0) * nz + (((sz - oz) / C) | 0)) * nx + (((sx - ox) / C) | 0);
      const hit = cache.get(key * 6 + axis);
      if (hit !== undefined) {
        wear[i * 4 + 2] = hit;
        continue;
      }
      t1.set(ax < 0.9 ? 1 : 0, ax < 0.9 ? 0 : 1, 0).cross(nv).normalize();
      t2.crossVectors(nv, t1);
      let occl = 0;
      for (const [dx, dy, dz] of DIRS) {
        const rx = t1.x * dx + t2.x * dy + nv.x * dz;
        const ry = t1.y * dx + t2.y * dy + nv.y * dz;
        const rz = t1.z * dx + t2.z * dy + nv.z * dz;
        for (let s = 1; s <= steps; s++) {
          const d = s * C;
          const ci = ((sx + rx * d - ox) / C) | 0, cj = ((sy + ry * d - oy) / C) | 0, ck = ((sz + rz * d - oz) / C) | 0;
          if (ci < 0 || cj < 0 || ck < 0 || ci >= nx || cj >= ny || ck >= nz) break;
          if (occ[(cj * nz + ck) * nx + ci]) {
            occl += 1 - (s - 1) / steps;
            break;
          }
        }
      }
      const v = Math.min(1, (occl / DIRS.length) * 1.35);
      cache.set(key * 6 + axis, v);
      wear[i * 4 + 2] = v;
    }
  }
}
/** The distant body is used only if it has fewer than this share of the close-up body's triangles. */
const LOD_MIN_SAVING = 0.9;
/** Camera distance (world units) beyond which models switch to their distant body (Medium preset). */
export const LOD_DISTANCE = 17;
/** High preset: the default camera sits about 20 away, so close-up bodies reach a little further. */
export const LOD_DISTANCE_HIGH = 21.5;

/**
 * Model detail: 2 = High (close-up bodies within LOD_DISTANCE_HIGH), 1 = Medium (LOD_DISTANCE),
 * 0 = Low (distant body only, cheaper body shader).
 */
let modelDetail: 0 | 1 | 2 = 1;

/**
 * Select the model detail level by quality preset (call before models are created, e.g. when a
 * match starts): 0 Low, 1 Medium, 2 High.
 */
export function setModelDetail(level: 0 | 1 | 2): void {
  modelDetail = level;
  setBodyDetail(level);
}

/** Camera distance at which models switch to their distant body for the current detail level. */
export function lodDistance(): number {
  return modelDetail >= 2 ? LOD_DISTANCE_HIGH : LOD_DISTANCE;
}

function applyGroundAO(g: THREE.BufferGeometry, h: number, min: number) {
  const P = g.getAttribute('position').array as Float32Array;
  const C = g.getAttribute('color') as THREE.BufferAttribute;
  const W = g.getAttribute('pbr').array as Float32Array;
  const ca = C.array as Float32Array;
  for (let i = 0; i < C.count; i++) {
    if (W[i * 4 + 3] >= EMISSIVE_BASE - 0.5) continue;
    let t = Math.min(1, Math.max(0, P[i * 3 + 1] / h));
    t = t * t * (3 - 2 * t);
    const k = min + (1 - min) * t;
    ca[i * 3] = ca[i * 3] * k + DUST[0] * (1 - k);
    ca[i * 3 + 1] = ca[i * 3 + 1] * k + DUST[1] * (1 - k);
    ca[i * 3 + 2] = ca[i * 3 + 2] * k + DUST[2] * (1 - k);
  }
}

export function makeTemplate(spec: TemplateSpec): ModelTemplate {
  const bodyParts: THREE.BufferGeometry[] = [];
  const nodeNames: string[] = [];
  const inverses: THREE.Matrix4[] = [];
  let boneCount = 0;

  const walk = (nb: NB, parentWorld: THREE.Matrix4): NodeT => {
    const local = new THREE.Matrix4().compose(
      new THREE.Vector3(...nb.pos),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...nb.rot)),
      new THREE.Vector3(1, 1, 1),
    );
    const world = parentWorld.clone().multiply(local);
    const bone = nb.hasBodyDeep() ? boneCount++ : -1;
    if (bone >= 0) {
      inverses[bone] = world.clone().invert();
      nodeNames[bone] = nb.name;
    }
    const meshes: MeshT[] = [];
    for (const [slot, list] of nb.parts) {
      if (slot === 'body') {
        for (const g of list) {
          g.applyMatrix4(world);
          const n = g.getAttribute('position').count;
          const si = new Uint16Array(n * 4);
          const sw = new Float32Array(n * 4);
          for (let i = 0; i < n; i++) {
            si[i * 4] = bone;
            sw[i * 4] = 1;
          }
          g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
          g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
          bodyParts.push(g);
        }
        continue;
      }
      const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (!merged) throw new Error(`merge failed for ${nb.name}/${slot}`);
      merged.computeBoundingSphere();
      meshes.push({ slot, geo: merged });
    }
    return {
      name: nb.name,
      pos: nb.pos,
      rot: nb.rot,
      visible: nb.visible,
      bone,
      meshes,
      children: nb.children.map((c) => walk(c, world)),
    };
  };
  const root = walk(spec.root, new THREE.Matrix4());

  // model-wide snow multiplier and baked cavity occlusion (both shared by the hi and lo bodies)
  const snowMul = spec.root.snow ?? DEFAULT_SNOW;
  if (snowMul !== 1) {
    for (const g of bodyParts) {
      const w = g.getAttribute('wear').array as Float32Array;
      for (let i = 3; i < w.length; i += 4) {
        const q = Math.floor(w[i] + 1e-4);
        w[i] = Math.min(7, Math.round(q * snowMul)) + (w[i] - q);
      }
    }
  }
  if (spec.root.cavity && bodyParts.length) bakeCavity(bodyParts);
  if (spec.root.mud || spec.root.camo) {
    for (const g of bodyParts) {
      const W = g.getAttribute('pbr').array as Float32Array;
      for (let i = 0; i < W.length; i += 4) {
        if (W[i + 3] >= EMISSIVE_BASE - 0.5) continue;
        const f = Math.floor(W[i + 1] / MAT_FLAG_STEP + 1e-4);
        const r = W[i + 1] - f * MAT_FLAG_STEP;
        const nf = f | (spec.root.mud ? MAT_MUD : 0) | (spec.root.camo && W[i + 2] >= 0.5 ? MAT_CAMO : 0);
        W[i + 1] = r + MAT_FLAG_STEP * nf;
      }
    }
  }

  let skin: SkinT | null = null;
  if (bodyParts.length) {
    const hiParts = bodyParts.filter((g) => g.userData.lod !== 1);
    const loParts = bodyParts.filter((g) => g.userData.lod !== 0);
    const merge = (list: THREE.BufferGeometry[]) => (list.length === 1 ? list[0] : mergeGeometries(list, false));
    const geo = merge(hiParts);
    if (!geo) throw new Error('body merge failed');
    const tris = (list: THREE.BufferGeometry[]) => list.reduce((a, g) => a + g.index!.count / 3, 0);
    // a distant body only pays off when the close-up detail is a real share of the triangles
    let geoLo = loParts.length && tris(loParts) < tris(hiParts) * LOD_MIN_SAVING ? merge(loParts) : null;
    if (geoLo === geo) geoLo = null;
    const rigid = boneCount === 1;
    for (const g of geoLo ? [geo, geoLo] : [geo]) {
      if (spec.root.ao) applyGroundAO(g, spec.root.ao.h, spec.root.ao.min);
      g.computeBoundingSphere();
      g.computeBoundingBox();
      if (rigid) {
        g.deleteAttribute('skinIndex');
        g.deleteAttribute('skinWeight');
      }
    }
    const sphere = geo.boundingSphere!.clone();
    sphere.radius *= 1.15;
    skin = { geo, geoLo, inverses, sphere, rigid };
  }

  return {
    root,
    skin,
    boneNames: nodeNames,
    height: spec.height,
    radius: spec.radius,
    turret: spec.turret,
    muzzles: spec.muzzles ?? [],
    smoke: spec.smoke,
    glow: spec.glow,
    fx: spec.fx,
    anim: spec.anim,
    init: spec.init,
  };
}

/** Per-instance animation context. */
export class Ctx {
  readonly n: Record<string, THREE.Object3D> = {};
  readonly bodies: THREE.Mesh[] = [];
  readonly glows = new Map<string, THREE.Mesh[]>();
  readonly tracks: THREE.Mesh[] = [];
  /** Per-instance scratch values. */
  readonly v: Record<string, number> = {};
  root!: THREE.Group;
  /** Damage/death variant (see BodyVariant). */
  variant = 0;
  powered = true;
  private glowQ = new Map<string, number>();
  private trackMat: THREE.Material | null = null;

  constructor(
    readonly tpl: ModelTemplate,
    readonly team: number,
  ) {}

  private applyBody() {
    for (const b of this.bodies) b.material = bodyMaterial(this.team, this.variant, this.powered, (b as THREE.SkinnedMesh).isSkinnedMesh === true);
  }

  setVariant(v: number) {
    if (v === this.variant) return;
    this.variant = v;
    this.applyBody();
  }

  /** Steady emissive parts baked into the body dim when unpowered. */
  setPowered(p: boolean) {
    if (p === this.powered) return;
    this.powered = p;
    this.applyBody();
  }

  /** Show/hide a node. Bones (skinned body parts) are collapsed via scale. */
  show(name: string, on: boolean) {
    const o = this.n[name];
    if (!o) return;
    if ((o as THREE.Bone).isBone) o.scale.setScalar(on ? 1 : 1e-4);
    else o.visible = on;
  }

  /** Set a separate glow slot's brightness as a multiple of its base intensity (0 hides it). */
  setGlow(slot: string, k: number) {
    const meshes = this.glows.get(slot);
    if (!meshes) return;
    const base = this.tpl.glow?.[slot] ?? 3;
    const q = Math.round(base * k * 16);
    if (this.glowQ.get(slot) === q) return;
    this.glowQ.set(slot, q);
    const mat = glowMaterial(q / 16);
    for (const m of meshes) {
      m.material = mat;
      m.visible = q > 0;
    }
  }

  setTrackPhase(p: number) {
    const mat = trackMaterial(p);
    if (mat === this.trackMat) return;
    this.trackMat = mat;
    for (const t of this.tracks) t.material = mat;
  }
}

const IDENTITY = new THREE.Matrix4();

function buildNode(t: NodeT, ctx: Ctx, bones: THREE.Bone[]): THREE.Object3D {
  const obj: THREE.Object3D = t.bone >= 0 ? new THREE.Bone() : new THREE.Object3D();
  if (t.bone >= 0) bones[t.bone] = obj as THREE.Bone;
  obj.name = t.name;
  obj.position.set(t.pos[0], t.pos[1], t.pos[2]);
  obj.rotation.set(t.rot[0], t.rot[1], t.rot[2]);
  obj.visible = t.visible;
  ctx.n[t.name] = obj;
  for (const m of t.meshes) {
    let mat: THREE.Material;
    let shadow = true;
    if (m.slot === 'track') mat = trackMaterial(0);
    else if (m.slot.startsWith('glow')) {
      mat = glowMaterial(ctx.tpl.glow?.[m.slot] ?? 3);
      shadow = false;
    } else if (m.slot.startsWith('fx:')) {
      mat = fxMaterial(m.slot.slice(3));
      shadow = false;
    } else mat = bodyMaterial(ctx.team, 0, true);
    const mesh = new THREE.Mesh(m.geo, mat);
    // treads sit inside the hull's shadow silhouette: casting them only costs a shadow-pass draw call
    mesh.castShadow = shadow && m.slot !== 'track';
    mesh.receiveShadow = shadow;
    if (mesh.castShadow) mesh.customDepthMaterial = shadowDepthMaterial(mesh);
    if (m.slot === 'track') ctx.tracks.push(mesh);
    else if (m.slot.startsWith('glow')) {
      let l = ctx.glows.get(m.slot);
      if (!l) ctx.glows.set(m.slot, (l = []));
      l.push(mesh);
    } else if (m.slot.startsWith('fx:')) {
      mesh.renderOrder = 2;
      ctx.n[`fx:${t.name}`] = mesh;
    }
    obj.add(mesh);
  }
  for (const c of t.children) obj.add(buildNode(c, ctx, bones));
  return obj;
}

export function instantiate(tpl: ModelTemplate, teamColor: THREE.Color, typeId: string): ModelInstance {
  const ctx = new Ctx(tpl, teamColor.getHex());
  const root = new THREE.Group();
  root.name = `model:${typeId}`;
  ctx.root = root;
  const bones: THREE.Bone[] = [];
  const top = buildNode(tpl.root, ctx, bones);
  root.add(top);
  if (tpl.skin) {
    const skin = tpl.skin;
    const mat = bodyMaterial(ctx.team, 0, true, !skin.rigid);
    // both levels of detail share one skeleton (one bone texture per instance)
    const skeleton = skin.rigid ? null : new THREE.Skeleton(bones, skin.inverses);
    const mk = (geo: THREE.BufferGeometry, name: string): THREE.Mesh => {
      let mesh: THREE.Mesh;
      if (!skeleton) {
        mesh = new THREE.Mesh(geo, mat);
      } else {
        const sk = new THREE.SkinnedMesh(geo, mat);
        sk.boundingSphere = skin.sphere;
        sk.bind(skeleton, IDENTITY);
        mesh = sk;
      }
      mesh.name = name;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.customDepthMaterial = shadowDepthMaterial(mesh);
      ctx.bodies.push(mesh);
      return mesh;
    };
    if (skin.geoLo && modelDetail === 0) {
      // Low preset: the lighter body everywhere (no close-up greebles)
      root.add(mk(skin.geoLo, 'body-lo'));
    } else if (skin.geoLo) {
      // close-up detail near the camera, the lighter body further out: still one draw call either way
      const lod = new THREE.LOD();
      lod.name = 'lod';
      lod.addLevel(mk(skin.geo, 'body'), 0, 0.08);
      lod.addLevel(mk(skin.geoLo, 'body-lo'), lodDistance(), 0.08);
      root.add(lod);
    } else root.add(mk(skin.geo, 'body'));
  }
  tpl.init?.(ctx);
  const anim = tpl.anim;
  return {
    root,
    turret: tpl.turret ? ctx.n[tpl.turret] : undefined,
    muzzles: tpl.muzzles.map((m) => ctx.n[m]).filter((m): m is THREE.Object3D => !!m),
    smokePoints: tpl.smoke ? tpl.smoke.map((m) => ctx.n[m]).filter((m): m is THREE.Object3D => !!m) : undefined,
    fxPoints: tpl.fx ? fxPointsOf(tpl, ctx) : undefined,
    height: tpl.height,
    radius: tpl.radius,
    typeId,
    update(state: ModelAnimState) {
      if (anim) anim(ctx, state);
    },
    setVariant(v: number) {
      ctx.setVariant(v);
    },
    node(name: string) {
      return ctx.n[name];
    },
    nodeBounds(name: string, deep = true) {
      return nodeBounds(tpl, name, deep);
    },
    dispose() {
      root.removeFromParent();
      // The skeleton's bone texture is the only per-instance GPU resource.
      for (const b of ctx.bodies) (b as THREE.SkinnedMesh).skeleton?.dispose();
    },
  };
}

function fxPointsOf(tpl: ModelTemplate, ctx: Ctx): { kind: 'steam' | 'sparks'; node: THREE.Object3D }[] {
  const out: { kind: 'steam' | 'sparks'; node: THREE.Object3D }[] = [];
  for (const kind of ['steam', 'sparks'] as const) for (const n of tpl.fx?.[kind] ?? []) if (ctx.n[n]) out.push({ kind, node: ctx.n[n] });
  return out;
}

const boundsCache = new WeakMap<ModelTemplate, Map<string, THREE.Box3 | null>>();
const _bv = new THREE.Vector3();

/**
 * Bounds of the body geometry skinned to node `name` (and, if deep, to its descendants), in that node's
 * local (bind) frame. Null when the node carries no body geometry. Cached per template.
 */
export function nodeBounds(tpl: ModelTemplate, name: string, deep = true): THREE.Box3 | null {
  let cache = boundsCache.get(tpl);
  if (!cache) boundsCache.set(tpl, (cache = new Map()));
  const key = `${name}|${deep ? 1 : 0}`;
  if (cache.has(key)) return cache.get(key)!;
  let result: THREE.Box3 | null = null;
  const skin = tpl.skin;
  const bone = tpl.boneNames.indexOf(name);
  if (skin && bone >= 0) {
    // bones of the subtree
    const want = new Set<number>([bone]);
    if (deep) {
      const find = (n: NodeT): NodeT | null => (n.name === name ? n : n.children.map(find).find((x) => x) ?? null);
      const start = find(tpl.root);
      const walk = (n: NodeT) => {
        if (n.bone >= 0) want.add(n.bone);
        n.children.forEach(walk);
      };
      if (start) walk(start);
    }
    const pos = skin.geo.getAttribute('position') as THREE.BufferAttribute;
    const si = skin.geo.getAttribute('skinIndex') as THREE.BufferAttribute | undefined;
    const inv = skin.inverses[bone];
    const box = new THREE.Box3();
    for (let i = 0; i < pos.count; i++) {
      const b = si ? si.getX(i) : 0;
      if (!want.has(b)) continue;
      box.expandByPoint(_bv.fromBufferAttribute(pos, i).applyMatrix4(inv));
    }
    if (!box.isEmpty()) result = box;
  }
  cache.set(key, result);
  return result;
}
