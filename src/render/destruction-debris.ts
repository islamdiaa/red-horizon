/**
 * Instanced, physics-driven debris pieces thrown off destroyed vehicles: road wheels, track runs, armour
 * plates, chunks and gun barrels. One InstancedMesh per shape (one draw call each, hidden while unused),
 * built with the model builder so the pieces share the models' look (detail map, scorch, embers) through
 * the 'wrecked' debris body material, tinted per instance (team colour on plates).
 */
import * as THREE from 'three';
import { NB, makeTemplate } from './models/builder';
import { M } from './models/parts';
import { debrisMaterial, shadowDepthMaterial } from './models/materials';

export const DS = { WHEEL: 0, TRACK: 1, PLATE: 2, CHUNK: 3, BARREL: 4 } as const;
export type DebrisShape = (typeof DS)[keyof typeof DS];
/** Collider half extents per shape (local axes). */
export const DEBRIS_HE: [number, number, number][] = [
  [0.05, 0.05, 0.02],
  [0.11, 0.011, 0.055],
  [0.07, 0.008, 0.05],
  [0.04, 0.035, 0.04],
  [0.13, 0.014, 0.014],
];
const CAPACITY = [48, 32, 64, 64, 16];

const PLATE: { c: number; m: number; r: number; d: number } = { c: 0xc8c8c8, m: 0.3, r: 0.5, d: 0 };

function shapeGeometry(shape: number): THREE.BufferGeometry {
  const r = new NB('root');
  switch (shape) {
    case DS.WHEEL:
      r.cyl(M.rubber, 0.05, 0.05, 0.034, 0, 0, 0, { r: [Math.PI / 2, 0, 0], seg: 10 });
      r.cyl(M.gun, 0.032, 0.032, 0.04, 0, 0, 0, { r: [Math.PI / 2, 0, 0], seg: 8 });
      r.cyl(M.steel, 0.011, 0.011, 0.046, 0, 0, 0, { r: [Math.PI / 2, 0, 0], seg: 6 });
      break;
    case DS.TRACK:
      r.box(M.dark, 0.22, 0.012, 0.11, 0, 0, 0, { b: 0.003 });
      for (let i = 0; i < 6; i++) r.box(M.gun, 0.014, 0.01, 0.11, -0.095 + i * 0.038, 0.009, 0, { b: 0 });
      break;
    case DS.PLATE:
      r.box(PLATE, 0.14, 0.012, 0.1, 0, 0, 0, { b: 0.004 });
      r.box(M.dark, 0.1, 0.004, 0.06, 0.005, -0.008, 0, { b: 0 });
      break;
    case DS.CHUNK:
      r.box(M.gun, 0.08, 0.06, 0.07, 0, 0, 0, { b: 0.012, r: [0.2, 0.3, 0.1] });
      r.box(M.dark, 0.05, 0.05, 0.05, 0.02, 0.015, -0.01, { b: 0.008, r: [0.5, 0.1, 0.4] });
      break;
    default:
      r.cyl(M.gun, 0.013, 0.015, 0.26, 0, 0, 0, { r: [0, 0, Math.PI / 2], seg: 7 });
      r.box(M.dark, 0.03, 0.03, 0.04, 0.12, 0, 0, { b: 0 });
  }
  const t = makeTemplate({ root: r, height: 0.1, radius: 0.1 });
  return t.skin!.geo;
}

const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

interface Shape {
  mesh: THREE.InstancedMesh;
  free: number[];
  high: number;
  dirty: boolean;
}

export class DebrisPool {
  readonly group = new THREE.Group();
  private shapes: Shape[] = [];

  constructor() {
    this.group.name = 'debris';
    const mat = debrisMaterial();
    for (let k = 0; k < CAPACITY.length; k++) {
      const mesh = new THREE.InstancedMesh(shapeGeometry(k), mat, CAPACITY[k]);
      mesh.name = `debris-${k}`;
      mesh.count = 0;
      mesh.visible = false;
      // culled against a sphere around the live pieces (setBounds), so far-off debris costs no draw calls
      mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, new THREE.Color(1, 1, 1));
      mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
      mesh.customDepthMaterial = shadowDepthMaterial(mesh);
      for (let j = 0; j < CAPACITY[k]; j++) mesh.setMatrixAt(j, ZERO);
      this.group.add(mesh);
      const free: number[] = [];
      for (let j = CAPACITY[k] - 1; j >= 0; j--) free.push(j);
      this.shapes.push({ mesh, free, high: 0, dirty: false });
    }
  }

  /** An instance slot of `shape`, or -1 when that pool is exhausted. */
  alloc(shape: number, color: THREE.Color): number {
    const s = this.shapes[shape];
    const i = s.free.pop();
    if (i === undefined) return -1;
    if (i + 1 > s.high) s.high = i + 1;
    s.mesh.setMatrixAt(i, ZERO);
    s.mesh.setColorAt(i, color);
    s.mesh.instanceColor!.needsUpdate = true;
    s.dirty = true;
    return i;
  }

  release(shape: number, i: number): void {
    if (i < 0) return;
    const s = this.shapes[shape];
    s.mesh.setMatrixAt(i, ZERO);
    s.free.push(i);
    s.dirty = true;
  }

  set(shape: number, i: number, p: THREE.Vector3, q: THREE.Quaternion, scale = 1): void {
    if (i < 0) return;
    const s = this.shapes[shape];
    _m.compose(p, q, _s.set(scale, scale, scale));
    s.mesh.setMatrixAt(i, _m);
    s.dirty = true;
  }

  /** Bounds of the live pieces of `shape` (world space) for frustum culling. */
  setBounds(shape: number, box: THREE.Box3): void {
    const s = this.shapes[shape];
    if (box.isEmpty()) return;
    box.getBoundingSphere(s.mesh.boundingSphere!);
    s.mesh.boundingSphere!.radius += 0.3;
  }

  flush(): void {
    for (const s of this.shapes) {
      if (!s.dirty) continue;
      s.dirty = false;
      const used = s.mesh.instanceMatrix.count - s.free.length;
      if (used === 0) s.high = 0;
      s.mesh.count = used > 0 ? s.high : 0;
      s.mesh.visible = used > 0;
      s.mesh.instanceMatrix.clearUpdateRanges();
      s.mesh.instanceMatrix.addUpdateRange(0, Math.max(1, s.high) * 16);
      s.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Show every shape (one instance far below the map) so renderer.compile() builds its program. */
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
    for (const s of this.shapes) {
      s.mesh.geometry.dispose();
      s.mesh.dispose();
    }
    this.group.removeFromParent();
  }
}
