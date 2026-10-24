/**
 * Civilian buildings drawn cheaply: every intact, visible civilian building is merged with its neighbours into one
 * mesh per 16 x 16-cell chunk (one draw call, one shadow draw), rebuilt only when a chunk's members change (a
 * building is first seen, damaged below half health, or destroyed). Each building keeps its own entity view and
 * model: while it is merged, its own mesh is hidden; once damaged it shows again (cracks, scorch, fires) and the
 * normal destruction path (fracture, collapse, rubble) takes over when it falls. Windows light chunk by chunk at dusk.
 */
import * as THREE from 'three';
import type { ModelInstance } from '../models/types';
import { bodyMaterial, BodyVariant, shadowDepthMaterial } from '../models/materials';

/** What the chunks need from an entity view (src/render/entities.ts View). */
export interface SceneryViewLike {
  ent: { id: number; x: number; y: number; alive: boolean; scenery?: unknown };
  model: ModelInstance;
  dead: boolean;
  anim: { health: number };
}

const CHUNK = 16;

interface Chunk {
  key: number;
  members: Set<SceneryViewLike>;
  mesh: THREE.Mesh | null;
  dirty: boolean;
  lit: boolean;
  /** dusk threshold of this chunk (lights come on block by block) */
  dusk: number;
}

/** The body geometry a model renders with (the distant level when it has one: no close-up greebles needed). */
function bodyGeometry(m: ModelInstance): THREE.BufferGeometry | null {
  let geo: THREE.BufferGeometry | null = null;
  m.root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || geo) return;
    if (mesh.name === 'body-lo' || mesh.name === 'body') geo = mesh.geometry;
  });
  let lo: THREE.BufferGeometry | null = null;
  m.root.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.name === 'body-lo') lo = (o as THREE.Mesh).geometry; });
  return lo ?? geo;
}

/** Hide / show a model's own body (the merged chunk draws it meanwhile). */
function showOwn(m: ModelInstance, on: boolean): void {
  for (const c of m.root.children) if ((c as THREE.Mesh).isMesh || (c as THREE.LOD).isLOD) c.visible = on;
}

const ATTRS: [string, number][] = [['position', 3], ['normal', 3], ['uv', 2], ['color', 3], ['pbr', 4], ['wear', 4]];

/** Merge member geometries, each translated to its building's position. */
function mergeMembers(members: Iterable<SceneryViewLike>): THREE.BufferGeometry | null {
  const list: { g: THREE.BufferGeometry; p: THREE.Vector3 }[] = [];
  let nv = 0, ni = 0;
  for (const v of members) {
    const g = bodyGeometry(v.model);
    if (!g || !g.index) continue;
    list.push({ g, p: v.model.root.position });
    nv += g.getAttribute('position').count;
    ni += g.index.count;
  }
  if (!list.length) return null;
  const out = new THREE.BufferGeometry();
  const arrays = ATTRS.map(([, n]) => new Float32Array(nv * n));
  const index = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let vo = 0, io = 0;
  for (const { g, p } of list) {
    const count = g.getAttribute('position').count;
    ATTRS.forEach(([name, n], k) => {
      const a = g.getAttribute(name) as THREE.BufferAttribute | undefined;
      if (!a) return;
      const src = a.array as ArrayLike<number>;
      const dst = arrays[k];
      if (name === 'position') {
        for (let i = 0; i < count; i++) {
          dst[(vo + i) * 3] = src[i * 3] + p.x;
          dst[(vo + i) * 3 + 1] = src[i * 3 + 1] + p.y;
          dst[(vo + i) * 3 + 2] = src[i * 3 + 2] + p.z;
        }
      } else dst.set(src as Float32Array, vo * n);
    });
    const idx = g.index!.array as ArrayLike<number>;
    for (let i = 0; i < idx.length; i++) index[io + i] = idx[i] + vo;
    vo += count;
    io += idx.length;
  }
  ATTRS.forEach(([name, n], k) => out.setAttribute(name, new THREE.BufferAttribute(arrays[k], n)));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

/** Merged civilian buildings of one match. */
export class CivilianChunks {
  private chunks = new Map<number, Chunk>();
  private where = new WeakMap<SceneryViewLike, Chunk>();
  private seen = new Set<SceneryViewLike>();

  constructor(private scene: THREE.Scene, private teamHex: number) {}

  /** Per frame: membership (visible, alive, healthy), rebuilds of changed chunks, lights at night. */
  update(views: Iterable<SceneryViewLike>, night: number): void {
    const seen = this.seen;
    seen.clear();
    for (const v of views) {
      if (!v.ent.scenery) continue;
      const want = !v.dead && v.ent.alive && v.model.root.visible && v.anim.health >= 0.5;
      const cur = this.where.get(v);
      if (want) {
        seen.add(v);
        if (!cur) {
          const key = Math.floor(v.ent.x / CHUNK) * 4096 + Math.floor(v.ent.y / CHUNK);
          let c = this.chunks.get(key);
          if (!c) {
            const h = Math.imul(key ^ 0x2c1b3c6d, 0x297a2d39) >>> 0;
            this.chunks.set(key, (c = { key, members: new Set(), mesh: null, dirty: true, lit: false, dusk: 0.3 + ((h >>> 8) & 255) / 255 * 0.4 }));
          }
          c.members.add(v);
          c.dirty = true;
          this.where.set(v, c);
          showOwn(v.model, false);
        }
      } else if (cur) this.release(v, cur);
    }
    // views that went away entirely (removed from the renderer)
    for (const c of this.chunks.values()) {
      for (const v of c.members) if (!seen.has(v)) this.release(v, c);
      const lit = night > c.dusk;
      if (c.dirty) this.rebuild(c, lit);
      else if (c.mesh && lit !== c.lit) { c.lit = lit; c.mesh.material = bodyMaterial(this.teamHex, BodyVariant.Normal, lit); }
    }
  }

  private release(v: SceneryViewLike, c: Chunk): void {
    c.members.delete(v);
    c.dirty = true;
    this.where.delete(v);
    if (!v.dead) showOwn(v.model, true);
  }

  private rebuild(c: Chunk, lit: boolean): void {
    c.dirty = false;
    c.lit = lit;
    if (c.mesh) {
      c.mesh.removeFromParent();
      c.mesh.geometry.dispose();
      c.mesh = null;
    }
    const geo = mergeMembers(c.members);
    if (!geo) return;
    const mesh = new THREE.Mesh(geo, bodyMaterial(this.teamHex, BodyVariant.Normal, lit));
    mesh.name = 'civilian-chunk';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.customDepthMaterial = shadowDepthMaterial(mesh);
    mesh.matrixAutoUpdate = false;
    this.scene.add(mesh);
    c.mesh = mesh;
  }

  /** Draw calls in use (tests, perf notes). */
  get drawCalls(): number {
    let n = 0;
    for (const c of this.chunks.values()) if (c.mesh) n++;
    return n;
  }

  dispose(): void {
    for (const c of this.chunks.values()) {
      for (const v of c.members) showOwn(v.model, true);
      if (c.mesh) { c.mesh.removeFromParent(); c.mesh.geometry.dispose(); }
    }
    this.chunks.clear();
  }
}
