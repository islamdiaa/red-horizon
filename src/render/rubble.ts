import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hash2 } from '../core/rng';
import type { GameMap } from '../sim/map';
import { shadowDepthMaterial } from './models/materials';

const CAPACITY = 1200;

interface Pile { cx: number; cy: number; w: number; h: number; start: number; count: number; seed: number; pending: boolean }

/** One rubble heap where a collapsed chunk came to rest (map x, y; size in cells; linear albedo). */
export interface RubbleItem { x: number; y: number; size: number; color: THREE.Color }

/**
 * Smouldering rubble left where structures were destroyed (one instanced draw call). A structure that
 * collapses physically (destruction.ts) defers its pile: the heaps are laid where its chunks came to rest.
 */
export class Rubble {
  /** The live instance (the destruction system lays collapse rubble through it). */
  static current: Rubble | null = null;
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
    Rubble.current = this;
  }

  /**
   * A collapse is underway over this footprint: the pile for `seed` (the structure's entity id) waits for
   * fillPile() instead of being scattered at random by add().
   */
  defer(seed: number, cx: number, cy: number, w: number, h: number) {
    if (this.piles.some((p) => p.seed === seed)) return;
    this.piles.push({ cx, cy, w, h, start: 0, count: 0, seed, pending: true });
  }

  /** Lay a deferred pile where the collapse's chunks came to rest (no-op if the footprint was cleared meanwhile). */
  fillPile(seed: number, items: readonly RubbleItem[]) {
    const pile = this.piles.find((p) => p.seed === seed && p.pending);
    if (!pile) return;
    pile.pending = false;
    const d = this.dummy;
    const start = this.next;
    let n = 0;
    for (let k = 0; k < items.length && n < 64; k++) {
      const it = items[k];
      // a main heap per chunk plus a scatter of smaller bits around it
      const bits = it.size > 0.25 ? 4 : it.size > 0.14 ? 3 : 2;
      for (let j = 0; j < bits && n < 64; j++) {
        const s = j === 0 ? it.size : it.size * (0.28 + hash2(k, seed, j + 20) * 0.35);
        const off = j === 0 ? 0 : it.size * (0.6 + hash2(k, seed, j + 21) * 0.6);
        const a = hash2(k, seed, j + 30) * Math.PI * 2;
        const x = it.x + Math.cos(a) * off, y = it.y + Math.sin(a) * off;
        d.position.set(x, this.map.heightAt(x, y) - s * 0.18, y);
        d.rotation.set(hash2(k, seed, j + 4) * 3, hash2(k, seed, j + 5) * 6.28, hash2(k, seed, j + 6) * 3);
        d.scale.set(s * (0.85 + hash2(k, seed, j + 7) * 0.6), s * 0.8, s * (0.85 + hash2(k, seed, j + 8) * 0.6));
        d.updateMatrix();
        const i = this.next;
        this.mesh.setMatrixAt(i, d.matrix);
        // the chunk's own colour, scorched; some pieces burnt black
        const burnt = hash2(k, seed, j + 9) < 0.35;
        this.color.copy(it.color).multiplyScalar(burnt ? 0.22 : 0.5 + hash2(k, seed, j + 10) * 0.25);
        this.mesh.setColorAt(i, this.color);
        this.next = (this.next + 1) % CAPACITY;
        n++;
      }
    }
    pile.start = start;
    pile.count = n;
    this.mesh.count = Math.max(this.mesh.count, Math.min(CAPACITY, start + n));
    if (this.next < start) this.mesh.count = CAPACITY;
    this.mesh.visible = n > 0 || this.mesh.visible;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Scatter debris over a destroyed footprint (cx, cy = top-left cell). */
  add(cx: number, cy: number, w: number, h: number, seed: number) {
    // a collapsing structure lays its own pile when the chunks settle
    if (this.piles.some((p) => p.seed === seed && p.pending)) return;
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
    this.piles.push({ cx, cy, w, h, start, count: n, seed, pending: false });
    this.mesh.visible = true;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Rubble piles laid so far (footprint + seed), for save games (destruction-scars.ts). */
  snapshot(): { cx: number; cy: number; w: number; h: number; seed: number }[] {
    return this.piles.filter((p) => !p.pending && p.count > 0).map((p) => ({ cx: p.cx, cy: p.cy, w: p.w, h: p.h, seed: p.seed }));
  }

  /** Lay saved piles again (scattered by their seed). */
  restore(piles: readonly { cx: number; cy: number; w: number; h: number; seed: number }[]) {
    for (const p of piles) if (!this.piles.some((q) => q.seed === p.seed)) this.add(p.cx, p.cy, p.w, p.h, p.seed);
  }

  /** Remove rubble overlapping a new structure footprint. */
  clear(cx: number, cy: number, w: number, h: number) {
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    let changed = false;
    this.piles = this.piles.filter((p) => {
      const overlap = p.cx < cx + w && cx < p.cx + p.w && p.cy < cy + h && cy < p.cy + p.h;
      if (!overlap) return true;
      for (let k = 0; k < p.count; k++) this.mesh.setMatrixAt((p.start + k) % CAPACITY, zero);
      p.pending = false;
      changed = true;
      return false;
    });
    if (changed) this.mesh.instanceMatrix.needsUpdate = true;
  }
}
