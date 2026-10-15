import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hash2 } from '../core/rng';
import type { GameMap } from '../sim/map';
import { shadowDepthMaterial } from './models/materials';

const CAPACITY = 1200;

interface Pile { cx: number; cy: number; w: number; h: number; start: number; count: number }

/** Smouldering rubble left where structures were destroyed (one instanced draw call). */
export class Rubble {
  readonly mesh: THREE.InstancedMesh;
  private piles: Pile[] = [];
  private next = 0;
  private dummy = new THREE.Object3D();
  private color = new THREE.Color();

  constructor(private map: GameMap) {
    const g = new THREE.IcosahedronGeometry(0.5, 0);
    g.deleteAttribute('normal');
    g.deleteAttribute('uv');
    const m = mergeVertices(g);
    const p = m.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const k = 0.75 + hash2(i, 7) * 0.5;
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.6, p.getZ(i) * k);
    }
    m.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true });
    this.mesh = new THREE.InstancedMesh(m, mat, CAPACITY);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false; // static, identity transform (instances carry the placement)
    this.mesh.matrixWorldAutoUpdate = false;
    this.mesh.count = 0;
    this.mesh.visible = false; // until the first pile (no empty draw calls)
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < CAPACITY; i++) this.mesh.setMatrixAt(i, zero);
    this.mesh.setColorAt(0, this.color.set(0x555555));
    this.mesh.customDepthMaterial = shadowDepthMaterial(this.mesh);
  }

  /** Scatter debris over a destroyed footprint (cx, cy = top-left cell). */
  add(cx: number, cy: number, w: number, h: number, seed: number) {
    const n = Math.min(40, Math.round(w * h * 3.5 + 4));
    const start = this.next;
    const d = this.dummy;
    for (let k = 0; k < n; k++) {
      const x = cx + 0.15 + hash2(k, seed, 1) * (w - 0.3);
      const y = cy + 0.15 + hash2(k, seed, 2) * (h - 0.3);
      const s = 0.12 + Math.pow(hash2(k, seed, 3), 2) * 0.42;
      d.position.set(x, this.map.heightAt(x, y) - s * 0.15, y);
      d.rotation.set(hash2(k, seed, 4) * 3, hash2(k, seed, 5) * 6.28, hash2(k, seed, 6) * 3);
      d.scale.set(s * (0.8 + hash2(k, seed, 7) * 0.8), s, s * (0.8 + hash2(k, seed, 8) * 0.8));
      d.updateMatrix();
      const i = this.next;
      this.mesh.setMatrixAt(i, d.matrix);
      // concrete grey, some charred, a few rusty metal bits
      const r = hash2(k, seed, 9);
      if (r < 0.25) this.color.setRGB(0.12, 0.11, 0.1);
      else if (r < 0.35) this.color.setRGB(0.42, 0.24, 0.14);
      else { const v = 0.45 + hash2(k, seed, 10) * 0.25; this.color.setRGB(v, v * 0.97, v * 0.92); }
      this.mesh.setColorAt(i, this.color);
      this.next = (this.next + 1) % CAPACITY;
    }
    this.mesh.count = Math.max(this.mesh.count, Math.min(CAPACITY, start + n));
    if (this.next < start) this.mesh.count = CAPACITY;
    this.piles.push({ cx, cy, w, h, start, count: n });
    this.mesh.visible = true;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Remove rubble overlapping a new structure footprint. */
  clear(cx: number, cy: number, w: number, h: number) {
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    let changed = false;
    this.piles = this.piles.filter((p) => {
      const overlap = p.cx < cx + w && cx < p.cx + p.w && p.cy < cy + h && cy < p.cy + p.h;
      if (!overlap) return true;
      for (let k = 0; k < p.count; k++) this.mesh.setMatrixAt((p.start + k) % CAPACITY, zero);
      changed = true;
      return false;
    });
    if (changed) this.mesh.instanceMatrix.needsUpdate = true;
  }
}
