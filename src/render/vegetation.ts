import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hash2, Noise2D } from '../core/rng';
import { GameMap, T } from '../sim/map';
import { flat } from './geomutil';
import { shadowDepthMaterial } from './models/materials';

type HeightFn = (x: number, y: number) => number;

/** Culling block size in cells. */
const BLOCK = 8;
/** Blocks further than this from the camera use the low-detail geometry (and thinned grass). */
const LOD_DIST = 46;

const _frustum = new THREE.Frustum();
const _pm = new THREE.Matrix4();
const _box = new THREE.Box3();

/**
 * World split into square blocks (map plus the scenery margin). Each frame the camera frustum decides which
 * blocks are needed; a block also counts when only the shadow it casts reaches the view. Blocks far from
 * the camera are flagged for the low-detail geometry.
 */
class BlockGrid {
  readonly nx: number;
  readonly ny: number;
  readonly lo: Float32Array;
  readonly hi: Float32Array;
  /** 0 = culled, 1 = near, 2 = far (LOD) */
  readonly state: Uint8Array;
  private prev: Uint8Array;
  /** Bumped whenever the needed set or its LOD split changes. */
  version = 0;

  constructor(readonly x0: number, readonly y0: number, x1: number, y1: number) {
    this.nx = Math.ceil((x1 - x0) / BLOCK);
    this.ny = Math.ceil((y1 - y0) / BLOCK);
    const n = this.nx * this.ny;
    this.lo = new Float32Array(n).fill(Infinity);
    this.hi = new Float32Array(n).fill(-Infinity);
    this.state = new Uint8Array(n).fill(1); // everything until the first cull (shader precompile sees it all)
    this.prev = new Uint8Array(n).fill(1);
  }

  index(x: number, y: number): number {
    const bx = Math.max(0, Math.min(this.nx - 1, Math.floor((x - this.x0) / BLOCK)));
    const by = Math.max(0, Math.min(this.ny - 1, Math.floor((y - this.y0) / BLOCK)));
    return by * this.nx + bx;
  }

  include(b: number, bottom: number, top: number) {
    if (bottom < this.lo[b]) this.lo[b] = bottom;
    if (top > this.hi[b]) this.hi[b] = top;
  }

  cull(camera: THREE.Camera, sunDir: THREE.Vector3) {
    _frustum.setFromProjectionMatrix(_pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    // shadows fall away from the sun: a caster of height h darkens ground up to h * len cells downwind
    const horiz = Math.hypot(sunDir.x, sunDir.z) || 1;
    const len = Math.min(6, horiz / Math.max(0.15, sunDir.y));
    const dx = (-sunDir.x / horiz) * len, dz = (-sunDir.z / horiz) * len;
    const cp = camera.position;
    const st = this.state;
    for (let by = 0, b = 0; by < this.ny; by++) {
      for (let bx = 0; bx < this.nx; bx++, b++) {
        if (this.hi[b] < this.lo[b]) { st[b] = 0; continue; }
        const x0 = this.x0 + bx * BLOCK, z0 = this.y0 + by * BLOCK;
        const h = this.hi[b] - this.lo[b];
        _box.min.set(x0 + Math.min(0, dx * h), this.lo[b], z0 + Math.min(0, dz * h));
        _box.max.set(x0 + BLOCK + Math.max(0, dx * h), this.hi[b], z0 + BLOCK + Math.max(0, dz * h));
        if (!_frustum.intersectsBox(_box)) { st[b] = 0; continue; }
        const cx = x0 + BLOCK / 2 - cp.x, cz = z0 + BLOCK / 2 - cp.z, cy = (this.lo[b] + this.hi[b]) / 2 - cp.y;
        st[b] = cx * cx + cy * cy + cz * cz > LOD_DIST * LOD_DIST ? 2 : 1;
      }
    }
    let changed = false;
    for (let i = 0; i < st.length; i++) if (st[i] !== this.prev[i]) { changed = true; break; }
    if (changed) {
      this.prev.set(st);
      this.version++;
    }
  }
}

interface Item { m: THREE.Matrix4; c?: THREE.Color; x: number; y: number }

/**
 * All instances of one geometry in ONE InstancedMesh (two with a low-detail variant). Instead of letting
 * three cull per chunk mesh (one draw call each, main pass and shadow pass), the instances of the blocks
 * in view are compacted into the front of the instance buffer whenever the visible block set changes.
 * Draw calls per geometry: 1 (near) + 1 (far, only when zoomed out), whatever the map size.
 */
class CulledInstances {
  readonly near: THREE.InstancedMesh;
  readonly far: THREE.InstancedMesh | null;
  private src: Float32Array;
  private col: Float32Array | null;
  private alive: Uint8Array;
  /** instance indices sorted by block, with per-block start offsets */
  private order: Int32Array;
  private start: Int32Array;
  private seen = -1;
  private dirty = true;
  private on = true;

  constructor(private grid: BlockGrid, group: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material, items: Item[], cast: boolean,
    lodGeo: THREE.BufferGeometry | null = null, private thinFar = false) {
    const n = items.length;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const geoTop = geo.boundingBox!.max.y;
    this.src = new Float32Array(n * 16);
    const colored = items.some((it) => it.c);
    this.col = colored ? new Float32Array(n * 3) : null;
    this.alive = new Uint8Array(n).fill(1);
    const blockOf = new Int32Array(n);
    const nb = grid.nx * grid.ny;
    const counts = new Int32Array(nb + 1);
    items.forEach((it, k) => {
      it.m.toArray(this.src, k * 16);
      if (this.col) {
        const c = it.c ?? _white;
        this.col[k * 3] = c.r; this.col[k * 3 + 1] = c.g; this.col[k * 3 + 2] = c.b;
      }
      const b = grid.index(it.x, it.y);
      blockOf[k] = b;
      counts[b + 1]++;
      const e = it.m.elements;
      const base = e[13];
      grid.include(b, base - 0.1, base + geoTop * Math.hypot(e[4], e[5], e[6]));
    });
    for (let b = 0; b < nb; b++) counts[b + 1] += counts[b];
    this.start = counts;
    this.order = new Int32Array(n);
    const fill = counts.slice(0, nb);
    for (let k = 0; k < n; k++) this.order[fill[blockOf[k]]++] = k;

    const mk = (g: THREE.BufferGeometry) => {
      const mesh = new THREE.InstancedMesh(g, mat, n);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (this.col) {
        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
        mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      }
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      if (cast) mesh.customDepthMaterial = shadowDepthMaterial(mesh);
      mesh.frustumCulled = false; // culled per block here
      mesh.matrixAutoUpdate = false;
      mesh.matrixWorldAutoUpdate = false;
      mesh.count = 0;
      group.add(mesh);
      return mesh;
    };
    this.near = mk(geo);
    this.far = lodGeo ? mk(lodGeo) : null;
    this.sync();
  }

  /** Show / hide every instance (grass toggle). */
  set enabled(v: boolean) {
    this.on = v;
    this.near.visible = v && this.near.count > 0;
    if (this.far) this.far.visible = v && this.far.count > 0;
  }

  hide(k: number) {
    if (this.alive[k]) {
      this.alive[k] = 0;
      this.dirty = true;
    }
  }

  /** Rebuild the instance buffers if the visible blocks (or the instances) changed. */
  sync() {
    if (!this.dirty && this.seen === this.grid.version) return;
    this.dirty = false;
    this.seen = this.grid.version;
    const st = this.grid.state;
    const near = this.near, far = this.far;
    const nm = near.instanceMatrix.array as Float32Array, nc = near.instanceColor?.array as Float32Array | undefined;
    const fm = far?.instanceMatrix.array as Float32Array | undefined, fc = far?.instanceColor?.array as Float32Array | undefined;
    const src = this.src, col = this.col, alive = this.alive, order = this.order, start = this.start;
    let nn = 0, nf = 0;
    for (let b = 0; b < st.length; b++) {
      const s = st[b];
      if (!s) continue;
      const toFar = s === 2 && !!far;
      for (let i = start[b]; i < start[b + 1]; i++) {
        const k = order[i];
        if (!alive[k]) continue;
        if (s === 2 && this.thinFar && k & 1) continue;
        if (toFar) {
          fm!.set(src.subarray(k * 16, k * 16 + 16), nf * 16);
          if (fc && col) { fc[nf * 3] = col[k * 3]; fc[nf * 3 + 1] = col[k * 3 + 1]; fc[nf * 3 + 2] = col[k * 3 + 2]; }
          nf++;
        } else {
          nm.set(src.subarray(k * 16, k * 16 + 16), nn * 16);
          if (nc && col) { nc[nn * 3] = col[k * 3]; nc[nn * 3 + 1] = col[k * 3 + 1]; nc[nn * 3 + 2] = col[k * 3 + 2]; }
          nn++;
        }
      }
    }
    publish(near, nn, this.on);
    if (far) publish(far, nf, this.on);
  }
}

const _white = new THREE.Color(1, 1, 1);

function publish(mesh: THREE.InstancedMesh, n: number, on: boolean) {
  mesh.count = n;
  mesh.visible = on && n > 0;
  if (!n) return;
  const im = mesh.instanceMatrix;
  im.clearUpdateRanges();
  im.addUpdateRange(0, n * 16);
  im.needsUpdate = true;
  const ic = mesh.instanceColor;
  if (ic) {
    ic.clearUpdateRanges();
    ic.addUpdateRange(0, n * 3);
    ic.needsUpdate = true;
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

/** Recolour foliage towards a target colour, keeping some of the original shading variation. */
function tintFoliage(g: THREE.BufferGeometry, r: number, gg: number, b: number, minY = 0.55): THREE.BufferGeometry {
  const c = g.attributes.color, p = g.attributes.position;
  for (let i = 0; i < c.count; i++) {
    if (p.getY(i) < minY) continue;
    const v = 0.75 + (c.getY(i) / 0.25) * 0.25;
    c.setXYZ(i, r * v, gg * v, b * v);
  }
  return g;
}

/** `lod`: low-detail version for distant blocks (same silhouette and colours, about a third of the triangles). */
function pineGeometry(seed: number, tall: number, lod = false): THREE.BufferGeometry {
  const trunk = colorize(new THREE.CylinderGeometry(0.045, 0.075, 0.5, lod ? 4 : 6, 1, lod).translate(0, 0.25, 0), new THREE.Color(0.12, 0.07, 0.04), 0.2, seed);
  const parts = [trunk];
  const tiers = 3 + (seed % 2);
  for (let k = 0; k < tiers; k++) {
    const r = 0.42 - k * 0.09;
    const h = 0.62 - k * 0.07;
    const cone = new THREE.ConeGeometry(r, h * tall, lod ? 6 : 9, lod ? 1 : 2, lod);
    const g = lumpy(cone, 0.18, seed * 7 + k);
    g.translate(0, 0.45 + k * 0.3 * tall + (h * tall) / 2 - 0.1, 0);
    const shade = 0.8 + k * 0.09;
    parts.push(colorize(g, new THREE.Color(0.05 * shade, 0.14 * shade, 0.065 * shade), 0.25, seed + k));
  }
  return mergeGeometries(parts.map((p) => flat(p)))!;
}

function broadleafGeometry(seed: number, lod = false): THREE.BufferGeometry {
  const trunk = colorize(new THREE.CylinderGeometry(0.05, 0.09, 0.62, lod ? 4 : 6, 1, lod).translate(0, 0.31, 0), new THREE.Color(0.14, 0.09, 0.05), 0.2, seed);
  const parts = [trunk];
  const blobs = 4;
  for (let k = 0; k < blobs; k++) {
    const a = (k / blobs) * Math.PI * 2 + seed;
    const r = k === 0 ? 0 : 0.2;
    const s = k === 0 ? 0.42 : 0.3;
    const ico = lumpy(new THREE.IcosahedronGeometry(s, lod ? 0 : 1), 0.35, seed * 13 + k);
    ico.translate(Math.cos(a) * r, 0.85 + (k === 0 ? 0.18 : 0) + hash2(k, seed) * 0.12, Math.sin(a) * r);
    const g = 0.36 + hash2(k, seed, 3) * 0.08;
    parts.push(colorize(ico, new THREE.Color(0.08, g * 0.55, 0.045), 0.3, seed + k * 3));
  }
  return mergeGeometries(parts.map((p) => flat(p)))!;
}

function boulderGeometry(seed: number, tint: [number, number, number] = [0.2, 0.19, 0.17], lod = false): THREE.BufferGeometry {
  const g = lumpy(new THREE.IcosahedronGeometry(0.5, lod ? 0 : 1), 0.55, seed, true);
  g.scale(1, 0.75, 1);
  return colorize(g, new THREE.Color(...tint), 0.3, seed);
}

function bushGeometry(seed: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 3; k++) {
    const g = lumpy(new THREE.IcosahedronGeometry(0.13 + k * 0.02, 0), 0.35, seed + k);
    g.translate((k - 1) * 0.11, 0.1, (hash2(k, seed) - 0.5) * 0.12);
    parts.push(flat(colorize(g, new THREE.Color(0.08, 0.17 + k * 0.02, 0.05), 0.3, seed + k)));
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

interface TreeRef { inst: CulledInstances; index: number; x: number; y: number; z: number }

/** Margin of the culling grid around the map (covers the scenery forest on the skirt). */
const MARGIN = 48;

export class Vegetation {
  readonly group = new THREE.Group();
  readonly uTime = { value: 0 };
  private grid: BlockGrid;
  private all: CulledInstances[] = [];
  private treeRefs = new Map<number, TreeRef>();
  private clutterByCell = new Map<number, [CulledInstances, number][]>();
  private grass: CulledInstances | null = null;
  private lastTreeVersion: number;
  private treeState: Uint8Array;

  /**
   * @param scenery tree spots on the landscape outside the playable area ([x, height, y]); they share the
   *   map trees' instanced meshes, so they cost no extra draw calls.
   */
  constructor(private map: GameMap, heightAt: HeightFn, quality: 'low' | 'high', readonly climate: 'temperate' | 'winter' | 'desert' = 'temperate', scenery: [number, number, number][] = []) {
    this.lastTreeVersion = map.treeVersion;
    this.treeState = map.tree.slice();
    this.group.name = 'vegetation';
    this.group.matrixAutoUpdate = false;
    const m = map;
    this.grid = new BlockGrid(-MARGIN, -MARGIN, m.w + MARGIN, m.h + MARGIN);
    const grid = this.grid;
    const dummy = new THREE.Object3D();
    const mat4 = () => { dummy.updateMatrix(); return dummy.matrix.clone(); };
    const lodOn = quality !== 'low';

    // ---- trees -------------------------------------------------------------
    const treeSet = (lod: boolean): THREE.BufferGeometry[] => {
      if (climate === 'winter') return [snowCover(pineGeometry(1, 1.0, lod), 0.85), snowCover(pineGeometry(2, 1.25, lod), 0.8), snowCover(pineGeometry(5, 1.1, lod), 0.9), snowCover(pineGeometry(6, 0.9, lod), 0.75)];
      if (climate === 'desert') return [tintFoliage(broadleafGeometry(3, lod), 0.17, 0.17, 0.08), tintFoliage(broadleafGeometry(4, lod), 0.2, 0.18, 0.09), tintFoliage(pineGeometry(7, 0.8, lod), 0.12, 0.14, 0.07, 0.4), tintFoliage(broadleafGeometry(8, lod), 0.23, 0.2, 0.1)];
      return [pineGeometry(1, 1.0, lod), pineGeometry(2, 1.25, lod), broadleafGeometry(3, lod), broadleafGeometry(4, lod)];
    };
    const treeGeos = treeSet(false);
    const treeLods = lodOn ? treeSet(true) : null;
    const treeMat = windMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 }, this.uTime, 0.04, 0.35, 'tree');
    const treeItems: Item[][] = [[], [], [], []];
    const treeCells: number[][] = [[], [], [], []];
    const treePos: [number, number, number][][] = [[], [], [], []];
    for (let i = 0; i < m.w * m.h; i++) {
      if (!m.tree[i]) continue;
      const v = (m.tree[i] - 1) % 4;
      const cx = i % m.w, cy = (i / m.w) | 0;
      const x = cx + 0.5 + (hash2(cx, cy, 1) - 0.5) * 0.4;
      const y = cy + 0.5 + (hash2(cx, cy, 2) - 0.5) * 0.4;
      const z = heightAt(x, y) - 0.03;
      const sc = (0.85 + hash2(cx, cy, 3) * 0.5) * 0.8;
      dummy.position.set(x, z, y);
      dummy.rotation.set((hash2(cx, cy, 6) - 0.5) * 0.12, hash2(cx, cy, 4) * Math.PI * 2, (hash2(cx, cy, 7) - 0.5) * 0.12);
      dummy.scale.set(sc, sc * (0.9 + hash2(cx, cy, 5) * 0.25), sc);
      const tint = 0.85 + hash2(cx, cy, 8) * 0.3;
      treeItems[v].push({ m: mat4(), c: new THREE.Color(tint * (0.95 + hash2(cx, cy, 9) * 0.1), tint, tint * 0.95), x, y });
      treeCells[v].push(i);
      treePos[v].push([x, z, y]);
    }
    // scenery forest beyond the map edge: appended after the map trees (their indices are not tracked)
    scenery.forEach(([x, h, y], k) => {
      const v = Math.floor(hash2(Math.floor(x * 3), Math.floor(y * 3), 5) * 4);
      const sc = (0.8 + hash2(k, 3, 9) * 0.6) * 0.85;
      dummy.position.set(x, h, y);
      dummy.rotation.set(0, hash2(k, 4, 9) * 6.28, 0);
      dummy.scale.set(sc, sc * (0.9 + hash2(k, 5, 9) * 0.3), sc);
      const tint = 0.8 + hash2(k, 6, 9) * 0.3;
      treeItems[v].push({ m: mat4(), c: new THREE.Color(tint, tint, tint * 0.95), x, y });
    });
    treeGeos.forEach((g, v) => {
      if (!treeItems[v].length) return;
      const inst = this.add(new CulledInstances(grid, this.group, g, treeMat, treeItems[v], true, treeLods?.[v] ?? null));
      treeCells[v].forEach((ci, k) => this.treeRefs.set(ci, { inst, index: k, x: treePos[v][k][0], y: treePos[v][k][1], z: treePos[v][k][2] }));
    });

    // ---- boulders on rocky ground ------------------------------------------
    const rockTint: [number, number, number] = climate === 'winter' ? [0.19, 0.2, 0.23] : climate === 'desert' ? [0.3, 0.19, 0.13] : [0.2, 0.19, 0.17];
    const rockSet = (lod: boolean) => {
      const geos = [boulderGeometry(11, rockTint, lod), boulderGeometry(12, rockTint, lod), boulderGeometry(13, rockTint, lod)];
      return climate === 'winter' ? geos.map((g) => snowCover(g, 0.75)) : geos;
    };
    const rockGeos = rockSet(false);
    const rockLods = lodOn ? rockSet(true) : null;
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
    rockGeos.forEach((g, v) => { if (rockItems[v].length) this.add(new CulledInstances(grid, this.group, g, rockMat, rockItems[v], true, rockLods?.[v] ?? null)); });

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
      else if (climate === 'desert') bushGeo = tintFoliage(bushGeo, 0.2, 0.18, 0.09, -1);
      const inst = this.add(new CulledInstances(grid, this.group, bushGeo, windMaterial({ vertexColors: true, roughness: 0.9 }, this.uTime, 0.12, 0.0, 'bush'), bushItems, true, null, true));
      bushItems.forEach((it, k) => this.addCellRef(m.idx(Math.floor(it.x), Math.floor(it.y)), inst, k));
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
      // distant grass is thinned to every other tuft: at that zoom a tuft is a couple of pixels
      const inst = this.add(new CulledInstances(grid, this.group, tuftGeometry(), mat, grassItems, false, null, true));
      grassItems.forEach((it, k) => this.addCellRef(m.idx(Math.floor(it.x), Math.floor(it.y)), inst, k));
      this.grass = inst;
    }
  }

  private add(c: CulledInstances): CulledInstances {
    this.all.push(c);
    return c;
  }

  /** @deprecated scenery trees are passed to the constructor now (shared draw calls); kept for API compatibility. */
  addSceneryTrees(spots: [number, number, number][]) {
    void spots;
  }

  private addCellRef(cell: number, inst: CulledInstances, index: number) {
    let list = this.clutterByCell.get(cell);
    if (!list) this.clutterByCell.set(cell, (list = []));
    list.push([inst, index]);
  }

  /** Hide ground clutter on cells (e.g. under a new building). */
  hideCells(cells: number[]) {
    for (const c of cells) {
      const list = this.clutterByCell.get(c);
      if (!list) continue;
      for (const [inst, k] of list) inst.hide(k);
      this.clutterByCell.delete(c);
    }
  }

  /** Returns positions of trees removed since the last call. */
  syncTrees(): THREE.Vector3[] {
    if (this.map.treeVersion === this.lastTreeVersion) return NO_TREES;
    const out: THREE.Vector3[] = [];
    this.lastTreeVersion = this.map.treeVersion;
    for (let i = 0; i < this.treeState.length; i++) {
      if (this.treeState[i] && !this.map.tree[i]) {
        this.treeState[i] = 0;
        const ref = this.treeRefs.get(i);
        if (ref) {
          ref.inst.hide(ref.index);
          out.push(new THREE.Vector3(ref.x, ref.y, ref.z));
        }
      }
    }
    return out;
  }

  /**
   * Per frame: wind time, and (with a camera) block culling + LOD selection. Instance buffers are only
   * rewritten when the set of visible blocks changes.
   */
  update(time: number, camera?: THREE.Camera, sunDir?: THREE.Vector3) {
    this.uTime.value = time;
    if (camera && sunDir) this.grid.cull(camera, sunDir);
    for (const c of this.all) c.sync();
  }

  setGrassVisible(v: boolean) {
    if (this.grass) this.grass.enabled = v;
  }
}

const NO_TREES: THREE.Vector3[] = [];
