/**
 * Pooled 3D bodies for effects that need real geometry (falling bombs, tumbling depth charges, the
 * GPS launch rocket). One InstancedMesh per shape (one draw call each, hidden when unused); the art
 * is the projectile model library's geometry + shared body material, so bodies match the models.
 */
import * as THREE from 'three';
import { createProjectileModel } from '../models';
import type { ProjectileModelKind } from '../models/types';

export const BK = { BOMB: 0, BARREL: 1, ROCKET: 2, TORPEDO: 3 } as const;
const KINDS: ProjectileModelKind[] = ['bomb', 'depthcharge', 'satrocket', 'torpedo'];
const CAPACITY = [48, 24, 4, 24];

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _d = new THREE.Vector3();
const X = new THREE.Vector3(1, 0, 0);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

interface Shape {
  mesh: THREE.InstancedMesh;
  free: number[];
  high: number;
  dirty: boolean;
}

export class BodyPool {
  readonly group = new THREE.Group();
  private shapes: Shape[] = [];

  constructor(renderOrder = 0) {
    this.group.name = 'fx-bodies';
    KINDS.forEach((k, i) => {
      const src = createProjectileModel(k);
      let geo: THREE.BufferGeometry | null = null;
      let mat: THREE.Material | null = null;
      src.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!geo && m.isMesh && m.name === 'body') {
          geo = m.geometry;
          mat = m.material as THREE.Material;
        }
      });
      const mesh = new THREE.InstancedMesh(geo ?? new THREE.BoxGeometry(0.1, 0.05, 0.05), mat ?? new THREE.MeshStandardMaterial(), CAPACITY[i]);
      mesh.name = `fx-body-${k}`;
      mesh.count = 0;
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.castShadow = k !== 'torpedo';
      mesh.receiveShadow = false;
      mesh.renderOrder = renderOrder;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let j = 0; j < CAPACITY[i]; j++) mesh.setMatrixAt(j, ZERO);
      this.group.add(mesh);
      const free: number[] = [];
      for (let j = CAPACITY[i] - 1; j >= 0; j--) free.push(j);
      this.shapes.push({ mesh, free, high: 0, dirty: false });
    });
  }

  /** Returns an instance slot or -1 when the pool is exhausted. */
  alloc(kind: number): number {
    const s = this.shapes[kind];
    const i = s.free.pop();
    if (i === undefined) return -1;
    if (i + 1 > s.high) s.high = i + 1;
    s.mesh.setMatrixAt(i, ZERO);
    s.dirty = true;
    return i;
  }

  release(kind: number, i: number): void {
    if (i < 0) return;
    const s = this.shapes[kind];
    s.mesh.setMatrixAt(i, ZERO);
    s.free.push(i);
    s.dirty = true;
  }

  /** Place a body: nose along (dx,dy,dz), extra spin `roll` about the nose axis, uniform scale. */
  set(kind: number, i: number, x: number, y: number, z: number, dx: number, dy: number, dz: number, roll = 0, scale = 1): void {
    if (i < 0) return;
    const s = this.shapes[kind];
    _d.set(dx, dy, dz);
    if (_d.lengthSq() < 1e-10) _d.set(1, 0, 0);
    _d.normalize();
    _q.setFromUnitVectors(X, _d);
    if (roll !== 0) _q.multiply(_q2.setFromAxisAngle(X, roll));
    _m.compose(_p.set(x, y, z), _q, _s.set(scale, scale, scale));
    s.mesh.setMatrixAt(i, _m);
    s.dirty = true;
  }

  /** Place a body with an explicit quaternion (tumbling). */
  setQuat(kind: number, i: number, x: number, y: number, z: number, q: THREE.Quaternion, scale = 1): void {
    if (i < 0) return;
    const s = this.shapes[kind];
    _m.compose(_p.set(x, y, z), q, _s.set(scale, scale, scale));
    s.mesh.setMatrixAt(i, _m);
    s.dirty = true;
  }

  hide(kind: number, i: number): void {
    if (i < 0) return;
    const s = this.shapes[kind];
    s.mesh.setMatrixAt(i, ZERO);
    s.dirty = true;
  }

  flush(): void {
    for (const s of this.shapes) {
      if (!s.dirty) continue;
      s.dirty = false;
      const used = s.mesh.instanceMatrix.count - s.free.length;
      s.mesh.count = used > 0 ? s.high : 0;
      s.mesh.visible = used > 0;
      if (used === 0) s.high = 0;
      s.mesh.instanceMatrix.clearUpdateRanges();
      s.mesh.instanceMatrix.addUpdateRange(0, Math.max(1, s.high) * 16);
      s.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Make every body mesh renderable (one instance far below the map) so renderer.compile() builds the
   * instanced shader variants up front; call again with false afterwards.
   */
  prepareCompile(on: boolean): void {
    for (const s of this.shapes) {
      if (on) {
        s.mesh.visible = true;
        if (s.mesh.count === 0) {
          s.mesh.setMatrixAt(0, _m.makeTranslation(0, -500, 0));
          s.mesh.count = 1;
        }
      } else {
        s.dirty = true;
        if (s.mesh.instanceMatrix.count === s.free.length) s.mesh.setMatrixAt(0, ZERO);
      }
    }
    if (!on) this.flush();
  }

  dispose(): void {
    // geometry and material belong to the shared model library: only drop the instance buffers
    for (const s of this.shapes) s.mesh.dispose();
    this.group.removeFromParent();
  }
}
