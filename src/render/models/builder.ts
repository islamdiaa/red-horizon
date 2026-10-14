/**
 * Template builder: models are described once per type as a tree of nodes, each holding
 * geometry grouped by material "slot". At finalize time all geometry of a node+slot is merged
 * into a single BufferGeometry, so instancing a model is just creating a handful of Meshes that
 * share geometry and materials.
 *
 * Slots:
 *   'body'          -> uber body material (per team colour, damage variants)
 *   'glow' | 'glow:<name>' -> unlit HDR emissive (vertex colour * intensity), switchable per instance
 *   'track'         -> scrolling tread material (phase-swapped per instance)
 *   'fx:<key>'      -> transparent fx material (see fxMaterial)
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ModelAnimState, ModelInstance } from './types';
import { bodyMaterial, fxMaterial, glowMaterial, trackMaterial } from './materials';

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
  /** Position */
  p?: V3;
  /** Euler rotation (XYZ) */
  r?: V3;
  /** Scale */
  s?: V3 | number;
  /** Material slot override (default: 'body' for Mat, 'glow' for Glow) */
  slot?: string;
  /** Keep the geometry's own UVs instead of box projection */
  keepUv?: boolean;
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

function isGlow(s: Surface): s is Glow {
  return (s as Glow).glow !== undefined;
}

/** Copy only position/normal/uv, force indexed, transform, re-project UVs, add color+pbr. */
function prepGeometry(src: THREE.BufferGeometry, matrix: THREE.Matrix4, surf: Surface, keepUv: boolean): THREE.BufferGeometry {
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

  // Box-projected UVs for consistent detail density.
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

  // colour + pbr
  const col = new Float32Array(n * 3);
  const pbr = new Float32Array(n * 4);
  if (isGlow(surf)) {
    _col.setHex(surf.glow);
    const k = surf.i ?? 1;
    for (let i = 0; i < n; i++) {
      col[i * 3] = _col.r * k;
      col[i * 3 + 1] = _col.g * k;
      col[i * 3 + 2] = _col.b * k;
      pbr[i * 4 + 3] = 3;
    }
  } else {
    _col.setHex(surf.c);
    // per-part vertical gradient (cheap self-occlusion): darker toward the part's base
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
  return out;
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
  /** bevel radius (0 = sharp) */
  b?: number;
  /** bevel segments */
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
  /** Ground-AO parameters inherited by descendants unless overridden. */
  ao?: { h: number; min: number };

  constructor(
    public name: string,
    public pos: V3 = [0, 0, 0],
    public rot: V3 = [0, 0, 0],
  ) {}

  add(geo: THREE.BufferGeometry, surf: Surface, o: AddOpts = {}): this {
    const slot = o.slot ?? (isGlow(surf) ? 'glow' : 'body');
    const m = composeMatrix(o.p, o.r, o.s);
    const g = prepGeometry(geo, m, surf, !!o.keepUv);
    let list = this.parts.get(slot);
    if (!list) this.parts.set(slot, (list = []));
    list.push(g);
    return this;
  }

  /** Add a pre-transformed geometry (already in node space). */
  addRaw(geo: THREE.BufferGeometry, surf: Surface, slot?: string, keepUv = false): this {
    return this.add(geo, surf, { slot, keepUv });
  }

  box(surf: Surface, w: number, h: number, d: number, x: number, y: number, z: number, o: BoxOpts = {}): this {
    return this.add(boxGeo(w, h, d, o.b ?? 0.012, o.seg ?? 1), surf, { p: [x, y, z], r: o.r, slot: o.slot });
  }

  cyl(surf: Surface, rt: number, rb: number, h: number, x: number, y: number, z: number, o: CylOpts = {}): this {
    return this.add(new THREE.CylinderGeometry(rt, rb, h, o.seg ?? 12, 1, !!o.open), surf, {
      p: [x, y, z],
      r: o.r,
      s: o.s,
      slot: o.slot,
    });
  }

  sph(surf: Surface, r: number, x: number, y: number, z: number, o: { s?: V3; seg?: number; slot?: string; r?: V3 } = {}): this {
    const seg = o.seg ?? 12;
    return this.add(new THREE.SphereGeometry(r, seg, Math.max(4, Math.round(seg * 0.6))), surf, {
      p: [x, y, z],
      s: o.s,
      slot: o.slot,
      r: o.r,
    });
  }

  node(name: string, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0]): NB {
    const c = new NB(name, pos, rot);
    this.children.push(c);
    return c;
  }

  finalize(aoBaseY = 0, inheritedAo?: { h: number; min: number }): NodeT {
    const ao = this.ao ?? inheritedAo;
    const baseY = aoBaseY + this.pos[1];
    const meshes: MeshT[] = [];
    for (const [slot, list] of this.parts) {
      const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (!merged) throw new Error(`merge failed for ${this.name}/${slot}`);
      if (ao && (slot === 'body' || slot === 'track')) applyGroundAO(merged, baseY, ao.h, ao.min);
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      meshes.push({ slot, geo: merged });
    }
    return {
      name: this.name,
      pos: this.pos,
      rot: this.rot,
      visible: this.visible,
      meshes,
      children: this.children.map((c) => c.finalize(baseY, ao)),
    };
  }
}

const DUST = [0.11, 0.085, 0.055];

function applyGroundAO(g: THREE.BufferGeometry, baseY: number, h: number, min: number) {
  const P = g.getAttribute('position').array as Float32Array;
  const C = g.getAttribute('color') as THREE.BufferAttribute;
  const ca = C.array as Float32Array;
  for (let i = 0; i < C.count; i++) {
    const y = baseY + P[i * 3 + 1];
    let t = Math.min(1, Math.max(0, y / h));
    t = t * t * (3 - 2 * t);
    const k = min + (1 - min) * t;
    // blend toward a dark dusty earth tone near the ground
    ca[i * 3] = ca[i * 3] * k + DUST[0] * (1 - k);
    ca[i * 3 + 1] = ca[i * 3 + 1] * k + DUST[1] * (1 - k);
    ca[i * 3 + 2] = ca[i * 3 + 2] * k + DUST[2] * (1 - k);
  }
}

// ---------------------------------------------------------------------------------------------
// Geometry primitive cache (source geometries reused across templates)
// ---------------------------------------------------------------------------------------------

import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const boxCache = new Map<string, THREE.BufferGeometry>();
export function boxGeo(w: number, h: number, d: number, bevel = 0.012, seg = 1): THREE.BufferGeometry {
  const key = `${w.toFixed(4)},${h.toFixed(4)},${d.toFixed(4)},${bevel.toFixed(4)},${seg}`;
  let g = boxCache.get(key);
  if (!g) {
    const b = Math.min(bevel, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
    g = b > 0.0015 ? new RoundedBoxGeometry(w, h, d, seg, b) : new THREE.BoxGeometry(w, h, d);
    boxCache.set(key, g);
  }
  return g;
}

// ---------------------------------------------------------------------------------------------
// Templates & instancing
// ---------------------------------------------------------------------------------------------

export type AnimFn = (c: Ctx, s: ModelAnimState) => void;

export interface ModelTemplate {
  root: NodeT;
  height: number;
  radius: number;
  turret?: string;
  muzzles: string[];
  smoke?: string[];
  /** Base HDR intensity per glow slot. Default 3. */
  glow?: Record<string, number>;
  anim?: AnimFn;
  /** Called once per instance after construction. */
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
  anim?: AnimFn;
  init?: (c: Ctx) => void;
}

export function makeTemplate(spec: TemplateSpec): ModelTemplate {
  return {
    root: spec.root.finalize(),
    height: spec.height,
    radius: spec.radius,
    turret: spec.turret,
    muzzles: spec.muzzles ?? [],
    smoke: spec.smoke,
    glow: spec.glow,
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
  variant = 0;
  private glowQ = new Map<string, number>();
  private trackMat: THREE.Material | null = null;

  constructor(
    readonly tpl: ModelTemplate,
    readonly team: number,
  ) {}

  setVariant(v: number) {
    if (v === this.variant) return;
    this.variant = v;
    const m = bodyMaterial(this.team, v);
    for (const b of this.bodies) b.material = m;
  }

  /** Set a glow slot's brightness as a multiple of its base intensity (0 hides it). */
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

function buildNode(t: NodeT, ctx: Ctx, isRoot: boolean): THREE.Object3D {
  let obj: THREE.Object3D;
  const makeMesh = (m: MeshT): THREE.Mesh => {
    let mat: THREE.Material;
    let shadow = true;
    if (m.slot === 'body') mat = bodyMaterial(ctx.team, 0);
    else if (m.slot === 'track') mat = trackMaterial(0);
    else if (m.slot.startsWith('glow')) {
      mat = glowMaterial(ctx.tpl.glow?.[m.slot] ?? 3);
      shadow = false;
    } else if (m.slot.startsWith('fx:')) {
      mat = fxMaterial(m.slot.slice(3));
      shadow = false;
    } else mat = bodyMaterial(ctx.team, 0);
    const mesh = new THREE.Mesh(m.geo, mat);
    mesh.castShadow = shadow;
    mesh.receiveShadow = shadow;
    if (m.slot === 'body') ctx.bodies.push(mesh);
    else if (m.slot === 'track') ctx.tracks.push(mesh);
    else if (m.slot.startsWith('glow')) {
      let l = ctx.glows.get(m.slot);
      if (!l) ctx.glows.set(m.slot, (l = []));
      l.push(mesh);
    } else if (m.slot.startsWith('fx:')) {
      mesh.renderOrder = 2;
      const key = `fx:${t.name}`;
      ctx.n[key] = mesh;
    }
    return mesh;
  };

  if (!isRoot && t.meshes.length === 1) {
    obj = makeMesh(t.meshes[0]);
  } else {
    obj = new THREE.Group();
    for (const m of t.meshes) obj.add(makeMesh(m));
  }
  obj.name = t.name;
  obj.position.set(t.pos[0], t.pos[1], t.pos[2]);
  obj.rotation.set(t.rot[0], t.rot[1], t.rot[2]);
  obj.visible = t.visible;
  ctx.n[t.name] = obj;
  for (const c of t.children) obj.add(buildNode(c, ctx, false));
  return obj;
}

export function instantiate(tpl: ModelTemplate, teamColor: THREE.Color, typeId: string): ModelInstance {
  const ctx = new Ctx(tpl, teamColor.getHex());
  const root = buildNode(tpl.root, ctx, true) as THREE.Group;
  root.name = `model:${typeId}`;
  ctx.root = root;
  tpl.init?.(ctx);
  const anim = tpl.anim;
  return {
    root,
    turret: tpl.turret ? ctx.n[tpl.turret] : undefined,
    muzzles: tpl.muzzles.map((m) => ctx.n[m]).filter((m): m is THREE.Object3D => !!m),
    smokePoints: tpl.smoke ? tpl.smoke.map((m) => ctx.n[m]).filter((m): m is THREE.Object3D => !!m) : undefined,
    height: tpl.height,
    radius: tpl.radius,
    update(state: ModelAnimState) {
      if (anim) anim(ctx, state);
    },
    dispose() {
      root.removeFromParent();
    },
  };
}
