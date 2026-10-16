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
import { bodyMaterial, fxMaterial, glowMaterial, shadowDepthMaterial, trackMaterial } from './materials';

export type V3 = [number, number, number];

/** Surface description for body parts. c = sRGB hex, m = metalness, r = roughness,
 *  t = team mask 0..1, d = detail channel (0 metal, 1 concrete, 2 fabric, 3 none), uv = detail density. */
export interface Mat {
  c: number;
  m: number;
  r: number;
  t?: number;
  d?: number;
  uv?: number;
}

/** Emissive description: colour hex and relative brightness multiplier. */
export interface Glow {
  glow: number;
  i?: number;
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
    for (let i = 0; i < n; i++) {
      const t = span > 0 ? (P[i * 3 + 1] - minY) / span : 1;
      const k = gMin + (1 - gMin) * Math.sqrt(t);
      col[i * 3] = _col.r * k;
      col[i * 3 + 1] = _col.g * k;
      col[i * 3 + 2] = _col.b * k;
      pbr[i * 4] = surf.m;
      pbr[i * 4 + 1] = surf.r;
      pbr[i * 4 + 2] = surf.t ?? 0;
      pbr[i * 4 + 3] = surf.d ?? 0;
    }
  }
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setAttribute('pbr', new THREE.BufferAttribute(pbr, 4));
  out.userData.lod = lodClass(out, surf, lod);
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

  constructor(
    public name: string,
    public pos: V3 = [0, 0, 0],
    public rot: V3 = [0, 0, 0],
  ) {}

  add(geo: THREE.BufferGeometry, surf: Surface, o: AddOpts = {}): this {
    const slot = normSlot(o.slot);
    const m = composeMatrix(o.p, o.r, o.s);
    const g = prepGeometry(geo, m, surf, !!o.keepUv, slot, o.lod);
    let list = this.parts.get(slot);
    if (!list) this.parts.set(slot, (list = []));
    list.push(g);
    return this;
  }

  box(surf: Surface, w: number, h: number, d: number, x: number, y: number, z: number, o: BoxOpts = {}): this {
    return this.add(boxGeo(w, h, d, o.b ?? 0.012), surf, { p: [x, y, z], r: o.r, slot: o.slot });
  }

  cyl(surf: Surface, rt: number, rb: number, h: number, x: number, y: number, z: number, o: CylOpts = {}): this {
    const seg = Math.min(o.seg ?? 8, maxSeg(Math.max(rt, rb)));
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
/** The distant body is used only if it has fewer than this share of the close-up body's triangles. */
const LOD_MIN_SAVING = 0.9;
/** Camera distance (world units) beyond which models switch to their distant body. */
export const LOD_DISTANCE = 17;

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
    const hi = mk(skin.geo, 'body');
    if (skin.geoLo) {
      // close-up detail near the camera, the lighter body further out: still one draw call either way
      const lod = new THREE.LOD();
      lod.name = 'lod';
      lod.addLevel(hi, 0, 0.08);
      lod.addLevel(mk(skin.geoLo, 'body-lo'), LOD_DISTANCE, 0.08);
      root.add(lod);
    } else root.add(hi);
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
