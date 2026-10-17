/**
 * Burnt trees: where a tree is destroyed (vegetation hides it), a charred stump stays, and often its trunk lies
 * fallen beside it, blown away from the blast. Two instanced meshes (stumps, trunks): no draw call until the
 * first tree burns (instance count 0), compiled with the scene on the loading screen.
 *
 * The vegetation keeps owning the living trees (vegetation.ts): it hides the tree and reports where it stood
 * (syncTrees); this layer only adds the remains, so an HD tree set can come and go without touching it.
 */
import * as THREE from 'three';
import { hash2 } from '../core/rng';
import { shadowDepthMaterial } from './models/materials';
import type { BurntTree } from './destruction-scars';

const _o = new THREE.Object3D();
const _c = new THREE.Color();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

/** Charred stump: a tapered trunk with a splintered top and a few root flares (unit = scale 1 tree). */
function stumpGeometry(): THREE.BufferGeometry {
  const seg = 7;
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const rb = 0.1, rt = 0.07, h = 0.44;
  // rings: base, mid, splintered top
  const ring = (y: number, r: number, jag: number, k: number) => {
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const yy = y + (jag ? (hash2(i, k, 3) - 0.3) * jag : 0);
      pos.push(Math.cos(a) * r, yy, Math.sin(a) * r);
      // charcoal, a little browner where the bark survived low down
      const c = y < 0.05 ? 0.09 : 0.045 + 0.03 * hash2(i, k, 5);
      col.push(c * 1.15, c, c * 0.9);
    }
  };
  ring(-0.04, rb * 1.15, 0, 0);
  ring(h * 0.55, (rb + rt) / 2, 0, 1);
  ring(h, rt, 0.18, 2);
  for (let r = 0; r < 2; r++) {
    for (let i = 0; i < seg; i++) {
      const a = r * seg + i, b = r * seg + ((i + 1) % seg);
      idx.push(a, b + seg, b, a, a + seg, b + seg);
    }
  }
  // splintered top: a fan to a sunken centre
  const top = pos.length / 3;
  pos.push(0, h - 0.03, 0);
  col.push(0.03, 0.025, 0.02);
  for (let i = 0; i < seg; i++) idx.push(2 * seg + i, top, 2 * seg + ((i + 1) % seg));
  // root flares
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.4;
    const b0 = pos.length / 3;
    const ca = Math.cos(a), sa = Math.sin(a);
    pos.push(ca * rb * 0.6 - sa * 0.03, 0.05, sa * rb * 0.6 + ca * 0.03, ca * rb * 0.6 + sa * 0.03, 0.05, sa * rb * 0.6 - ca * 0.03, ca * rb * 2.3, -0.03, sa * rb * 2.3);
    col.push(0.08, 0.07, 0.06, 0.08, 0.07, 0.06, 0.07, 0.06, 0.05);
    idx.push(b0, b0 + 2, b0 + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Fallen charred trunk along +X from the origin (length 1 at scale 1), with snapped branch stubs. */
function trunkGeometry(): THREE.BufferGeometry {
  const seg = 6, rings = 5;
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const len = 1.3;
  for (let j = 0; j < rings; j++) {
    const t = j / (rings - 1);
    const r = 0.075 * (1 - t * 0.6);
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      pos.push(t * len, Math.sin(a) * r + r, Math.cos(a) * r);
      const c = 0.04 + 0.035 * hash2(i, j, 9);
      col.push(c * 1.1, c, c * 0.9);
    }
  }
  for (let j = 0; j < rings - 1; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * seg + i, b = j * seg + ((i + 1) % seg);
      idx.push(a, b, b + seg, a, b + seg, a + seg);
    }
  }
  // broken branch stubs
  for (let k = 0; k < 3; k++) {
    const t = 0.35 + k * 0.2, side = k % 2 ? 1 : -1;
    const b0 = pos.length / 3;
    const y = 0.06 + 0.02 * k;
    pos.push(t * len, y, -0.012, t * len + 0.03, y, 0.012, t * len + 0.08, y + 0.04, side * 0.13);
    col.push(0.05, 0.045, 0.04, 0.05, 0.045, 0.04, 0.04, 0.035, 0.03);
    idx.push(b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export class BurntTrees {
  readonly group = new THREE.Group();
  readonly stumps: THREE.InstancedMesh;
  readonly trunks: THREE.InstancedMesh;
  private nStumps = 0;
  private nTrunks = 0;
  /** Slot of each tree's stump / trunk (-1 none), in insertion order (eviction drops the oldest). */
  private slots: { t: BurntTree; stump: number; trunk: number }[] = [];
  private freeStumps: number[] = [];
  private freeTrunks: number[] = [];
  private dirty = false;

  constructor(readonly capacity: number) {
    this.group.name = 'burnt-trees';
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
    mat.name = 'burnt-tree';
    this.stumps = new THREE.InstancedMesh(stumpGeometry(), mat, capacity);
    this.trunks = new THREE.InstancedMesh(trunkGeometry(), mat, capacity);
    for (const m of [this.stumps, this.trunks]) {
      m.count = 0;
      m.castShadow = true;
      m.receiveShadow = true;
      m.matrixAutoUpdate = false;
      m.matrixWorldAutoUpdate = false;
      m.customDepthMaterial = shadowDepthMaterial(m);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // per-instance tint (char depth varies)
      m.setColorAt(0, _c.setRGB(1, 1, 1));
      this.group.add(m);
    }
    this.group.matrixAutoUpdate = false;
  }

  /** Burnt remains of one tree (returns false when full: the caller evicts first). */
  add(t: BurntTree): void {
    const stump = this.freeStumps.pop() ?? (this.nStumps < this.capacity ? this.nStumps++ : -1);
    if (stump < 0) return;
    const sc = t.s;
    _o.position.set(t.x, t.z - 0.02, t.y);
    _o.rotation.set(0, t.yaw, 0);
    _o.scale.set(sc, sc * (0.85 + 0.4 * hash2(Math.floor(t.x * 7), Math.floor(t.y * 7), 1)), sc);
    _o.updateMatrix();
    this.stumps.setMatrixAt(stump, _o.matrix);
    const tint = 0.85 + 0.3 * hash2(Math.floor(t.x * 5), Math.floor(t.y * 5), 2);
    this.stumps.setColorAt(stump, _c.setRGB(tint, tint, tint));
    let trunk = -1;
    if (!Number.isNaN(t.fall)) {
      trunk = this.freeTrunks.pop() ?? (this.nTrunks < this.capacity ? this.nTrunks++ : -1);
      if (trunk >= 0) {
        // lying from beside the stump, away from the blast, slightly downhill-agnostic (rests on the ground)
        _o.position.set(t.x + Math.cos(t.fall) * 0.06 * sc, t.z - 0.015, t.y + Math.sin(t.fall) * 0.06 * sc);
        _o.rotation.set(0, -t.fall, (hash2(Math.floor(t.x * 3), Math.floor(t.y * 3), 4) - 0.5) * 0.08);
        _o.scale.set(sc * (0.95 + 0.4 * hash2(Math.floor(t.x * 11), Math.floor(t.y * 11), 6)), sc, sc);
        _o.updateMatrix();
        this.trunks.setMatrixAt(trunk, _o.matrix);
        this.trunks.setColorAt(trunk, _c.setRGB(tint, tint, tint));
      }
    }
    this.slots.push({ t, stump, trunk });
    this.dirty = true;
  }

  /** Drop the remains of a tree (budget eviction). */
  remove(t: BurntTree): void {
    const k = this.slots.findIndex((s) => s.t === t);
    if (k < 0) return;
    const s = this.slots[k];
    this.slots.splice(k, 1);
    if (s.stump >= 0) { this.stumps.setMatrixAt(s.stump, ZERO); this.freeStumps.push(s.stump); }
    if (s.trunk >= 0) { this.trunks.setMatrixAt(s.trunk, ZERO); this.freeTrunks.push(s.trunk); }
    this.dirty = true;
  }

  /** Upload changes (once per frame at most). */
  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    for (const [m, n] of [[this.stumps, this.nStumps], [this.trunks, this.nTrunks]] as const) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      if (n > 0) m.computeBoundingSphere();
    }
  }

  get count(): number {
    return this.slots.length;
  }

  dispose(): void {
    this.stumps.geometry.dispose();
    this.trunks.geometry.dispose();
    (this.stumps.material as THREE.Material).dispose();
    this.stumps.dispose();
    this.trunks.dispose();
    this.group.removeFromParent();
  }
}
