import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hash2 } from '../core/rng';
import type { World } from '../sim/world';
import type { FogOfWar } from './fog';
import type { Player } from '../sim/player';
import { flat } from './geomutil';

type WallKind = 'sbag' | 'barb' | 'brik';
const KINDS: WallKind[] = ['sbag', 'barb', 'brik'];
const DIRS: [number, number][] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

function bag(seed: number, sx: number, sy: number, sz: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(0.5, 8, 5);
  g.deleteAttribute('uv');
  const m = mergeVertices(g);
  const p = m.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const k = 1 + (hash2(i, seed) - 0.5) * 0.12;
    p.setXYZ(i, p.getX(i) * sx * k, Math.max(p.getY(i), -0.3) * sy * k, p.getZ(i) * sz * k);
  }
  m.computeVertexNormals();
  return flat(m);
}

/** Geometry pieces per wall kind: a post at the cell centre and an arm pointing along +X (length 0.5). */
function pieces(kind: WallKind): { post: THREE.BufferGeometry; arm: THREE.BufferGeometry; mat: THREE.Material } {
  if (kind === 'sbag') {
    const post: THREE.BufferGeometry[] = [];
    for (let l = 0; l < 3; l++) for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + l * 0.6;
      post.push(bag(l * 3 + k, 0.24, 0.12, 0.15).rotateY(a).translate(Math.cos(a) * 0.08, 0.07 + l * 0.1, Math.sin(a) * 0.08));
    }
    const arm: THREE.BufferGeometry[] = [];
    for (let l = 0; l < 3; l++) for (let k = 0; k < 2; k++) {
      arm.push(bag(20 + l * 2 + k, 0.26, 0.12, 0.17).translate(0.13 + k * 0.25 + (l % 2) * 0.06, 0.07 + l * 0.1, 0));
    }
    const mat = new THREE.MeshStandardMaterial({ color: 0xb59a68, roughness: 0.95 });
    return { post: mergeGeometries(post)!, arm: mergeGeometries(arm)!, mat };
  }
  if (kind === 'brik') {
    const post = new THREE.BoxGeometry(0.44, 0.66, 0.44).translate(0, 0.33, 0);
    const cap = new THREE.BoxGeometry(0.5, 0.06, 0.5).translate(0, 0.69, 0);
    const arm = new THREE.BoxGeometry(0.5, 0.56, 0.34).translate(0.25, 0.28, 0);
    const lip = new THREE.BoxGeometry(0.5, 0.05, 0.38).translate(0.25, 0.585, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0x9a978f, roughness: 0.85 });
    return { post: mergeGeometries([flat(post), flat(cap)])!, arm: mergeGeometries([flat(arm), flat(lip)])!, mat };
  }
  // barbed wire: wooden posts with coils
  const pole = new THREE.CylinderGeometry(0.025, 0.03, 0.5, 5).translate(0, 0.25, 0);
  const cross = new THREE.BoxGeometry(0.3, 0.025, 0.025).translate(0, 0.38, 0);
  const coils: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 4; k++) {
    coils.push(new THREE.TorusGeometry(0.13, 0.008, 3, 14).rotateY(Math.PI / 2).translate(0.07 + k * 0.12, 0.15, 0));
  }
  const strip = (g: THREE.BufferGeometry) => { g.deleteAttribute('uv'); return flat(g); };
  const mat = new THREE.MeshStandardMaterial({ color: 0x5a5048, roughness: 0.6, metalness: 0.5 });
  return { post: mergeGeometries([strip(pole), strip(cross)])!, arm: mergeGeometries(coils.map(strip))!, mat };
}

/** Auto-connecting wall segments, rendered with instancing (two draw calls per wall kind). */
export class WallRenderer {
  readonly group = new THREE.Group();
  private meshes = new Map<WallKind, { post: THREE.InstancedMesh; arm: THREE.InstancedMesh }>();
  private signature = '';
  private dummy = new THREE.Object3D();

  constructor(private world: World, private fog: FogOfWar, private local: Player) {
    for (const k of KINDS) {
      const p = pieces(k);
      const post = new THREE.InstancedMesh(p.post, p.mat, 512);
      const arm = new THREE.InstancedMesh(p.arm, p.mat, 2048);
      for (const m of [post, arm]) {
        m.castShadow = true;
        m.receiveShadow = true;
        m.count = 0;
        m.frustumCulled = false;
        this.group.add(m);
      }
      this.meshes.set(k, { post, arm });
    }
  }

  /** Static preview for sidebar thumbnails: a short three-segment wall. */
  static preview(kind: string): THREE.Group {
    const p = pieces(kind as WallKind);
    const g = new THREE.Group();
    for (let i = -1; i <= 1; i++) {
      const post = new THREE.Mesh(p.post, p.mat);
      post.position.x = i;
      g.add(post);
      if (i < 1) { const a = new THREE.Mesh(p.arm, p.mat); a.position.x = i; g.add(a); }
      if (i > -1) { const a = new THREE.Mesh(p.arm, p.mat); a.position.x = i; a.rotation.y = Math.PI; g.add(a); }
    }
    return g;
  }

  update() {
    const w = this.world;
    const walls = w.buildings.filter((b) => b.alive && b.bt.wall);
    // visibility of enemy walls depends on exploration, so include a coarse exploration bit
    let sig = '';
    for (const b of walls) sig += b.id + (b.owner.team === this.local.team || this.fog.exploredAt(b.x, b.y) > 0.5 ? 'v' : 'h') + ',';
    if (sig === this.signature) return;
    this.signature = sig;
    const m = w.map;
    const at = new Map<number, string>();
    for (const b of walls) at.set(m.idx(b.cx, b.cy), b.bt.id);
    const counts = new Map<WallKind, [number, number]>(KINDS.map((k) => [k, [0, 0]]));
    const d = this.dummy;
    for (const b of walls) {
      if (b.owner.team !== this.local.team && this.fog.exploredAt(b.x, b.y) <= 0.5) continue;
      const kind = b.bt.id as WallKind;
      const mm = this.meshes.get(kind);
      if (!mm) continue;
      const c = counts.get(kind)!;
      const h = m.heightAt(b.x, b.y);
      d.position.set(b.x, h - 0.02, b.y);
      d.rotation.set(0, hash2(b.cx, b.cy) * 0.3, 0);
      d.scale.set(1, 1, 1);
      d.updateMatrix();
      mm.post.setMatrixAt(c[0]++, d.matrix);
      for (const [dx, dy] of DIRS) {
        const nx = b.cx + dx, ny = b.cy + dy;
        if (!m.inBounds(nx, ny) || at.get(m.idx(nx, ny)) !== b.bt.id) continue;
        // skip diagonals when an orthogonal connection already covers the corner
        if (dx && dy && (at.get(m.idx(b.cx + dx, b.cy)) === b.bt.id || at.get(m.idx(b.cx, b.cy + dy)) === b.bt.id)) continue;
        const len = Math.hypot(dx, dy);
        d.position.set(b.x, h - 0.02, b.y);
        d.rotation.set(0, -Math.atan2(dy, dx), 0);
        d.scale.set(len, 1, 1);
        d.updateMatrix();
        mm.arm.setMatrixAt(c[1]++, d.matrix);
      }
    }
    for (const [k, mm] of this.meshes) {
      const c = counts.get(k)!;
      mm.post.count = c[0];
      mm.arm.count = c[1];
      mm.post.instanceMatrix.needsUpdate = true;
      mm.arm.instanceMatrix.needsUpdate = true;
    }
  }
}
