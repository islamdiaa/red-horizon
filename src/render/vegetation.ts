import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hash2, Noise2D } from '../core/rng';
import { GameMap, T } from '../sim/map';

type HeightFn = (x: number, y: number) => number;

const CHUNK = 24;

/**
 * Splits instances into spatial chunks (one InstancedMesh per chunk) so the camera
 * frustum and shadow camera can cull most of a large map.
 */
class ChunkedInstances {
  meshes: THREE.InstancedMesh[] = [];
  /** global index -> [mesh, local index] */
  private refs: [THREE.InstancedMesh, number][] = [];
  constructor(group: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material, items: { m: THREE.Matrix4; c?: THREE.Color; x: number; y: number }[], cast: boolean) {
    const buckets = new Map<number, number[]>();
    items.forEach((it, k) => {
      const key = Math.floor(it.x / CHUNK) * 1000 + Math.floor(it.y / CHUNK);
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = []));
      b.push(k);
    });
    this.refs = new Array(items.length);
    for (const list of buckets.values()) {
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      list.forEach((k, j) => {
        mesh.setMatrixAt(j, items[k].m);
        if (items[k].c) mesh.setColorAt(j, items[k].c!);
        this.refs[k] = [mesh, j];
      });
      mesh.computeBoundingSphere();
      group.add(mesh);
      this.meshes.push(mesh);
    }
  }
  ref(k: number): [THREE.InstancedMesh, number] {
    return this.refs[k];
  }
}


function colorize(g: THREE.BufferGeometry, c: THREE.Color, jitter = 0, seed = 0): THREE.BufferGeometry {
  g.deleteAttribute('uv');
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = 1 + (hash2(i, seed, 17) - 0.5) * jitter;
    col[i * 3] = c.r * v;
    col[i * 3 + 1] = c.g * v;
    col[i * 3 + 2] = c.b * v;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** Displace vertices radially with noise for organic shapes. */
function lumpy(g: THREE.BufferGeometry, amount: number, seed: number, flattenBottom = false): THREE.BufferGeometry {
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  const m = mergeVertices(g, 1e-4);
  const p = m.attributes.position;
  const noise = new Noise2D(seed);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + (noise.value(x * 4 + y * 2 + 10, z * 4 - y * 3 + 5) - 0.5) * amount;
    let ny = y * k;
    if (flattenBottom && ny < 0) ny *= 0.35;
    p.setXYZ(i, x * k, ny, z * k);
  }
  m.computeVertexNormals();
  return m;
}

/** Whiten upward-facing foliage (snow lying on branches). */
function snowCover(g: THREE.BufferGeometry, amount: number): THREE.BufferGeometry {
  const n = g.attributes.normal, c = g.attributes.color, p = g.attributes.position;
  for (let i = 0; i < n.count; i++) {
    if (p.getY(i) < 0.4) continue; // keep trunks dark
    const up = Math.max(0, Math.min(1, (n.getY(i) - 0.15) / 0.5)) * amount;
    c.setXYZ(i, c.getX(i) + (0.86 - c.getX(i)) * up, c.getY(i) + (0.9 - c.getY(i)) * up, c.getZ(i) + (0.95 - c.getZ(i)) * up);
  }
  return g;
}

/** Recolour broadleaf foliage (desert scrub: dusty olive). */
function tintFoliage(g: THREE.BufferGeometry, r: number, gg: number, b: number): THREE.BufferGeometry {
  const c = g.attributes.color, p = g.attributes.position;
  for (let i = 0; i < c.count; i++) {
    if (p.getY(i) < 0.55) continue;
    c.setXYZ(i, c.getX(i) * r, c.getY(i) * gg, c.getZ(i) * b);
  }
  return g;
}

function pineGeometry(seed: number, tall: number): THREE.BufferGeometry {
  const trunk = colorize(new THREE.CylinderGeometry(0.045, 0.075, 0.5, 6).translate(0, 0.25, 0), new THREE.Color(0.12, 0.07, 0.04), 0.2, seed);
  const parts = [trunk];
  const tiers = 3 + (seed % 2);
  for (let k = 0; k < tiers; k++) {
    const r = 0.42 - k * 0.09;
    const h = 0.62 - k * 0.07;
    const cone = new THREE.ConeGeometry(r, h * tall, 9, 2);
    const g = lumpy(cone, 0.18, seed * 7 + k);
    g.translate(0, 0.45 + k * 0.3 * tall + (h * tall) / 2 - 0.1, 0);
    const shade = 0.8 + k * 0.09;
    parts.push(colorize(g, new THREE.Color(0.05 * shade, 0.14 * shade, 0.065 * shade), 0.25, seed + k));
  }
  return mergeGeometries(parts.map((p) => p.toNonIndexed()))!;
}

function broadleafGeometry(seed: number): THREE.BufferGeometry {
  const trunk = colorize(new THREE.CylinderGeometry(0.05, 0.09, 0.62, 6).translate(0, 0.31, 0), new THREE.Color(0.14, 0.09, 0.05), 0.2, seed);
  const parts = [trunk];
  const blobs = 4;
  for (let k = 0; k < blobs; k++) {
    const a = (k / blobs) * Math.PI * 2 + seed;
    const r = k === 0 ? 0 : 0.2;
    const s = k === 0 ? 0.42 : 0.3;
    const ico = lumpy(new THREE.IcosahedronGeometry(s, 1), 0.35, seed * 13 + k);
    ico.translate(Math.cos(a) * r, 0.85 + (k === 0 ? 0.18 : 0) + hash2(k, seed) * 0.12, Math.sin(a) * r);
    const g = 0.36 + hash2(k, seed, 3) * 0.08;
    parts.push(colorize(ico, new THREE.Color(0.08, g * 0.55, 0.045), 0.3, seed + k * 3));
  }
  return mergeGeometries(parts.map((p) => p.toNonIndexed()))!;
}

function boulderGeometry(seed: number, tint: [number, number, number] = [0.2, 0.19, 0.17]): THREE.BufferGeometry {
  const g = lumpy(new THREE.IcosahedronGeometry(0.5, 1), 0.55, seed, true);
  g.scale(1, 0.75, 1);
  return colorize(g, new THREE.Color(...tint), 0.3, seed);
}

function bushGeometry(seed: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 3; k++) {
    const g = lumpy(new THREE.IcosahedronGeometry(0.13 + k * 0.02, 0), 0.35, seed + k);
    g.translate((k - 1) * 0.11, 0.1, (hash2(k, seed) - 0.5) * 0.12);
    parts.push(colorize(g, new THREE.Color(0.08, 0.17 + k * 0.02, 0.05), 0.3, seed + k).toNonIndexed());
  }
  return mergeGeometries(parts)!;
}

function tuftGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const blades = 6;
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2 + hash2(b, 3) * 0.8;
    const lean = 0.03 + hash2(b, 9) * 0.05;
    const h = 0.1 + hash2(b, 5) * 0.09;
    const w = 0.018;
    const bx = Math.cos(a) * 0.03, bz = Math.sin(a) * 0.03;
    const px = -Math.sin(a) * w, pz = Math.cos(a) * w;
    const tx = bx + Math.cos(a) * lean, tz = bz + Math.sin(a) * lean;
    pos.push(bx - px, 0, bz - pz, bx + px, 0, bz + pz, tx, h, tz);
    const base = [0.05, 0.09, 0.025], tip = [0.24, 0.3, 0.1];
    col.push(...base, ...base, ...tip);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  // grass normals point up for soft, even lighting
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return g;
}

/** Inject a wind sway into a standard material used by instanced meshes. */
function windMaterial(base: THREE.MeshStandardMaterialParameters, uTime: { value: number }, strength: number, pivot: number, key: string) {
  const mat = new THREE.MeshStandardMaterial(base);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec3 ip = vec3(instanceMatrix[3][0], 0.0, instanceMatrix[3][2]);
          float ph = ip.x * 0.63 + ip.z * 0.81;
          float h = max(0.0, transformed.y - ${pivot.toFixed(3)});
          float gust = 0.6 + 0.4 * sin(uTime * 0.37 + ip.x * 0.05);
          transformed.x += sin(uTime * 1.7 + ph) * ${strength.toFixed(3)} * h * h * gust;
          transformed.z += cos(uTime * 1.3 + ph * 1.3) * ${(strength * 0.6).toFixed(3)} * h * h * gust;
        }`);
  };
  mat.customProgramCacheKey = () => 'wind-' + key;
  return mat;
}

interface TreeRef { mesh: THREE.InstancedMesh; index: number; x: number; y: number; z: number }
type Item = { m: THREE.Matrix4; c?: THREE.Color; x: number; y: number };

export class Vegetation {
  readonly group = new THREE.Group();
  readonly uTime = { value: 0 };
  private treeRefs = new Map<number, TreeRef>();
  private grassByCell = new Map<number, [THREE.InstancedMesh, number][]>();
  private grassMeshes: THREE.InstancedMesh[] = [];
  private lastTreeVersion: number;
  private treeState: Uint8Array;
  private treeGeos: THREE.BufferGeometry[] = [];
  private treeMat!: THREE.Material;

  constructor(private map: GameMap, heightAt: HeightFn, quality: 'low' | 'high', readonly climate: 'temperate' | 'winter' | 'desert' = 'temperate') {
    this.lastTreeVersion = map.treeVersion;
    this.treeState = map.tree.slice();
    const m = map;
    const dummy = new THREE.Object3D();
    const mat4 = () => { dummy.updateMatrix(); return dummy.matrix.clone(); };

    // ---- trees -------------------------------------------------------------
    let treeGeos = [pineGeometry(1, 1.0), pineGeometry(2, 1.25), broadleafGeometry(3), broadleafGeometry(4)];
    if (climate === 'winter') treeGeos = [snowCover(pineGeometry(1, 1.0), 0.85), snowCover(pineGeometry(2, 1.25), 0.8), snowCover(pineGeometry(5, 1.1), 0.9), snowCover(pineGeometry(6, 0.9), 0.75)];
    else if (climate === 'desert') treeGeos = [tintFoliage(broadleafGeometry(3), 3.4, 1.35, 0.75), tintFoliage(broadleafGeometry(4), 3.8, 1.4, 0.7), tintFoliage(pineGeometry(7, 0.8), 2.6, 1.2, 0.7), tintFoliage(broadleafGeometry(8), 4.2, 1.45, 0.65)];
    const treeMat = windMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 }, this.uTime, 0.04, 0.35, 'tree');
    this.treeGeos = treeGeos;
    this.treeMat = treeMat;
    const treeCells: number[][] = [[], [], [], []];
    for (let i = 0; i < m.w * m.h; i++) if (m.tree[i]) treeCells[(m.tree[i] - 1) % 4].push(i);
    treeGeos.forEach((g, v) => {
      const cells = treeCells[v];
      if (!cells.length) return;
      const items: Item[] = [];
      const pos: [number, number, number][] = [];
      for (const ci of cells) {
        const cx = ci % m.w, cy = (ci / m.w) | 0;
        const x = cx + 0.5 + (hash2(cx, cy, 1) - 0.5) * 0.4;
        const y = cy + 0.5 + (hash2(cx, cy, 2) - 0.5) * 0.4;
        const z = heightAt(x, y) - 0.03;
        const sc = (0.85 + hash2(cx, cy, 3) * 0.5) * 0.8;
        dummy.position.set(x, z, y);
        dummy.rotation.set((hash2(cx, cy, 6) - 0.5) * 0.12, hash2(cx, cy, 4) * Math.PI * 2, (hash2(cx, cy, 7) - 0.5) * 0.12);
        dummy.scale.set(sc, sc * (0.9 + hash2(cx, cy, 5) * 0.25), sc);
        const tint = 0.85 + hash2(cx, cy, 8) * 0.3;
        items.push({ m: mat4(), c: new THREE.Color(tint * (0.95 + hash2(cx, cy, 9) * 0.1), tint, tint * 0.95), x, y });
        pos.push([x, z, y]);
      }
      const ch = new ChunkedInstances(this.group, g, treeMat, items, true);
      cells.forEach((ci, k) => {
        const [mesh, index] = ch.ref(k);
        this.treeRefs.set(ci, { mesh, index, x: pos[k][0], y: pos[k][1], z: pos[k][2] });
      });
    });

    // ---- boulders on rocky ground ------------------------------------------
    const rockTint: [number, number, number] = climate === 'winter' ? [0.19, 0.2, 0.23] : climate === 'desert' ? [0.3, 0.19, 0.13] : [0.2, 0.19, 0.17];
    let rockGeos = [boulderGeometry(11, rockTint), boulderGeometry(12, rockTint), boulderGeometry(13, rockTint)];
    if (climate === 'winter') rockGeos = rockGeos.map((g) => snowCover(g, 0.75));
    const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
    const rockItems: Item[][] = [[], [], []];
    const addRock = (v: number, x: number, y: number, sc: number, r: number) => {
      dummy.position.set(x, heightAt(x, y) - sc * 0.12, y);
      dummy.rotation.set((r - 0.5) * 0.5, r * 6.28, (r - 0.3) * 0.4);
      dummy.scale.set(sc, sc * (0.7 + r * 0.6), sc * (0.8 + r * 0.4));
      const tint = 0.8 + r * 0.35;
      rockItems[v].push({ m: mat4(), c: new THREE.Color(tint, tint * 0.97, tint * 0.92), x, y });
    };
    for (let cy = 0; cy < m.h; cy++) for (let cx = 0; cx < m.w; cx++) {
      const i = m.idx(cx, cy);
      const t = m.terrain[i];
      if (t === T.Rock) {
        const n = 1 + (hash2(cx, cy, 21) < 0.45 ? 1 : 0);
        for (let k = 0; k < n; k++) {
          addRock((cx + cy + k) % 3, cx + 0.2 + hash2(cx, cy, 23 + k) * 0.6, cy + 0.2 + hash2(cx, cy, 25 + k) * 0.6, 0.55 + hash2(cx, cy, 22 + k) * 0.75, hash2(cx, cy, 27 + k));
        }
      } else if ((t === T.Clear || t === T.Dirt || t === T.Sand) && !m.ore[i] && !m.tree[i] && hash2(cx, cy, 31) < 0.018) {
        // scattered small stones (decorative)
        addRock((cx * 3 + cy) % 3, cx + hash2(cx, cy, 32), cy + hash2(cx, cy, 33), 0.12 + hash2(cx, cy, 34) * 0.12, hash2(cx, cy, 35));
      }
    }
    rockGeos.forEach((g, v) => { if (rockItems[v].length) new ChunkedInstances(this.group, g, rockMat, rockItems[v], true); });

    // ---- bushes near forests ------------------------------------------------
    const bushItems: Item[] = [];
    for (let cy = 0; cy < m.h; cy++) for (let cx = 0; cx < m.w; cx++) {
      const i = m.idx(cx, cy);
      if (m.terrain[i] !== T.Clear || m.tree[i] || m.ore[i]) continue;
      let nearTree = false;
      for (let dy = -1; dy <= 1 && !nearTree; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (m.inBounds(cx + dx, cy + dy) && m.tree[m.idx(cx + dx, cy + dy)]) { nearTree = true; break; }
      }
      if (hash2(cx, cy, 41) < (nearTree ? 0.35 : 0.015)) {
        const x = cx + 0.15 + hash2(cx, cy, 42) * 0.7, y = cy + 0.15 + hash2(cx, cy, 43) * 0.7, r = hash2(cx, cy, 44);
        dummy.position.set(x, heightAt(x, y), y);
        dummy.rotation.set(0, r * 6.28, 0);
        const sc = 0.8 + r * 0.6;
        dummy.scale.set(sc, sc, sc);
        bushItems.push({ m: mat4(), x, y });
      }
    }
    if (bushItems.length) {
      let bushGeo = bushGeometry(5);
      if (climate === 'winter') bushGeo = snowCover(bushGeo, 0.7);
      else if (climate === 'desert') bushGeo = tintFoliage(bushGeo, 3.2, 1.3, 0.7);
      const ch = new ChunkedInstances(this.group, bushGeo, windMaterial({ vertexColors: true, roughness: 0.9 }, this.uTime, 0.12, 0.0, 'bush'), bushItems, true);
      bushItems.forEach((it, k) => this.addCellRef(m.idx(Math.floor(it.x), Math.floor(it.y)), ...ch.ref(k)));
    }

    // ---- grass tufts ----------------------------------------------------------
    const density = (quality === 'high' ? 2.2 : 0.9) * (climate === 'winter' ? 0.25 : climate === 'desert' ? 0.45 : 1);
    const grassTint = climate === 'winter' ? [1.6, 1.35, 1.6] : climate === 'desert' ? [2.0, 1.45, 0.75] : [1, 1, 1];
    const grassItems: Item[] = [];
    const gn = new Noise2D(m.seed + 77);
    for (let cy = 0; cy < m.h; cy++) for (let cx = 0; cx < m.w; cx++) {
      const i = m.idx(cx, cy);
      const t = m.terrain[i];
      if ((t !== T.Clear && t !== T.Dirt) || m.tree[i] || m.ore[i]) continue;
      const lush = gn.fbm(cx * 0.12, cy * 0.12, 3);
      const count = Math.floor(density * (lush * 1.8 - 0.1) * (t === T.Dirt ? 0.4 : 1) + hash2(cx, cy, 51));
      for (let k = 0; k < count; k++) {
        const x = cx + hash2(cx, cy, 52 + k), y = cy + hash2(cx, cy, 62 + k), r = hash2(cx, cy, 72 + k);
        dummy.position.set(x, heightAt(x, y) - 0.01, y);
        dummy.rotation.set(0, r * 6.28, 0);
        const sc = 0.8 + r * 0.9;
        dummy.scale.set(sc, sc * (0.8 + hash2(cx * 7 + k, cy, 7) * 0.6), sc);
        const l2 = gn.fbm(x * 0.12, y * 0.12, 3);
        grassItems.push({ m: mat4(), c: new THREE.Color((0.85 + l2 * 0.3 + r * 0.2) * grassTint[0], (0.9 + l2 * 0.2) * grassTint[1], (0.75 + r * 0.1) * grassTint[2]), x, y });
      }
    }
    if (grassItems.length) {
      const mat = windMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }, this.uTime, 1.6, 0.0, 'grass');
      const ch = new ChunkedInstances(this.group, tuftGeometry(), mat, grassItems, false);
      grassItems.forEach((it, k) => this.addCellRef(m.idx(Math.floor(it.x), Math.floor(it.y)), ...ch.ref(k)));
      this.grassMeshes = ch.meshes;
    }
  }

  /** Scenery trees outside the playable area (no gameplay, no shadows cast). */
  addSceneryTrees(spots: [number, number, number][]) {
    const lists: Item[][] = [[], [], [], []];
    const dummy = new THREE.Object3D();
    spots.forEach(([x, h, y], k) => {
      const v = Math.floor(hash2(Math.floor(x * 3), Math.floor(y * 3), 5) * 4);
      const sc = (0.8 + hash2(k, 3, 9) * 0.6) * 0.85;
      dummy.position.set(x, h, y);
      dummy.rotation.set(0, hash2(k, 4, 9) * 6.28, 0);
      dummy.scale.set(sc, sc * (0.9 + hash2(k, 5, 9) * 0.3), sc);
      dummy.updateMatrix();
      const tint = 0.8 + hash2(k, 6, 9) * 0.3;
      lists[v].push({ m: dummy.matrix.clone(), c: new THREE.Color(tint, tint, tint * 0.95), x, y });
    });
    lists.forEach((items, v) => { if (items.length) new ChunkedInstances(this.group, this.treeGeos[v], this.treeMat, items, false); });
  }

  private addCellRef(cell: number, mesh: THREE.InstancedMesh, index: number) {
    let list = this.grassByCell.get(cell);
    if (!list) this.grassByCell.set(cell, (list = []));
    list.push([mesh, index]);
  }

  /** Hide ground clutter on cells (e.g. under a new building). */
  hideCells(cells: number[]) {
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const touched = new Set<THREE.InstancedMesh>();
    for (const c of cells) {
      const list = this.grassByCell.get(c);
      if (!list) continue;
      for (const [mesh, k] of list) { mesh.setMatrixAt(k, zero); touched.add(mesh); }
      this.grassByCell.delete(c);
    }
    for (const m of touched) m.instanceMatrix.needsUpdate = true;
  }

  /** Returns positions of trees removed since the last call. */
  syncTrees(): THREE.Vector3[] {
    const out: THREE.Vector3[] = [];
    if (this.map.treeVersion === this.lastTreeVersion) return out;
    this.lastTreeVersion = this.map.treeVersion;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.treeState.length; i++) {
      if (this.treeState[i] && !this.map.tree[i]) {
        this.treeState[i] = 0;
        const ref = this.treeRefs.get(i);
        if (ref) {
          ref.mesh.setMatrixAt(ref.index, zero);
          ref.mesh.instanceMatrix.needsUpdate = true;
          out.push(new THREE.Vector3(ref.x, ref.y, ref.z));
        }
      }
    }
    return out;
  }

  update(time: number) {
    this.uTime.value = time;
  }

  setGrassVisible(v: boolean) {
    for (const g of this.grassMeshes) g.visible = v;
  }
}
