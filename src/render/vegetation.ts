import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hash2, Noise2D } from '../core/rng';
import { GameMap, T } from '../sim/map';
import { flat } from './geomutil';
import { landmarkMask } from '../sim/landmarks';
import { shadowDepthMaterial } from './models/materials';
import { ROAD_HALF, roadDistance, roadsFor } from './roads';
import { applyNatureTextures, loadNature, natureMaterialParams, natureUrls, placeholderGeometry, type NatureTemplate } from './vegetation-hd';
import { classicLook } from './terrain-materials';
import { prefetchOffline } from '../platform/prefetch';
import { hdModelsEnabled } from './models/hd';

type HeightFn = (x: number, y: number) => number;

/** Culling block size in cells. */
const BLOCK = 8;
/** Blocks further than this from the camera use the low-detail geometry (and thinned grass). */
const LOD_DIST = 46;
/**
 * Blocks closer than this draw the HD trees and rocks (vegetation-hd.ts); the rest of the near ring stays procedural.
 * Medium (integrated GPUs) keeps a smaller ring: the HD trees cost several times the procedural ones per pixel.
 */
const HD_DIST = { medium: 19, high: 25 } as const;

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
  /** 0 = culled, 1 = near, 2 = far (LOD), 3 = close (HD) */
  readonly state: Uint8Array;
  private prev: Uint8Array;
  /** Bumped whenever the needed set or its LOD split changes. */
  version = 0;

  constructor(readonly x0: number, readonly y0: number, x1: number, y1: number, private hdDist: number = HD_DIST.high) {
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
        const d2 = cx * cx + cy * cy + cz * cz;
        st[b] = d2 > LOD_DIST * LOD_DIST ? 2 : d2 < this.hdDist * this.hdDist ? 3 : 1;
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
 * Draw calls per geometry: 1 (near) + 1 (far, only when zoomed out) + 1 (HD close-up, medium / high), whatever the map size.
 */
class CulledInstances {
  readonly near: THREE.InstancedMesh;
  readonly far: THREE.InstancedMesh | null;
  /** HD model for the near blocks (vegetation-hd.ts), once its template has arrived; the near mesh then idles. */
  hd: THREE.InstancedMesh | null = null;
  private hdOn = false;
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

    const mk = (g: THREE.BufferGeometry, m: THREE.Material = mat) => {
      const mesh = new THREE.InstancedMesh(g, m, n);
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
    this.mk = mk;
    this.sync();
  }

  private mk: (g: THREE.BufferGeometry, m?: THREE.Material) => THREE.InstancedMesh;

  /**
   * An HD tier with its (placeholder) material, from the start: the loading screen compiles its program and the
   * renderer's weather patch reaches the material. It draws nothing until useHd() gives it the real geometry.
   */
  prepareHd(mat: THREE.Material) {
    if (this.hd) return;
    const hd = this.mk(placeholderGeometry(), mat);
    hd.name = 'vegetation-hd';
    hd.count = 1; // (empty geometry: compiles, never draws)
    hd.visible = this.on;
    this.hd = hd;
  }

  /** Switch the near blocks to the HD geometry. */
  useHd(geo: THREE.BufferGeometry) {
    if (!this.hd) return;
    this.hd.geometry.dispose();
    this.hd.geometry = geo;
    this.hdOn = true;
    this.dirty = true;
  }

  /** The warm-up is over (programs compiled): an HD tier still waiting for its model stops costing a call. */
  endHdWarmUp() {
    if (this.hd && !this.hdOn) { this.hd.count = 0; this.hd.visible = false; }
  }

  /** Show / hide every instance (grass toggle). */
  set enabled(v: boolean) {
    this.on = v;
    this.near.visible = v && this.near.count > 0;
    if (this.far) this.far.visible = v && this.far.count > 0;
    if (this.hd) this.hd.visible = v && this.hd.count > 0;
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
    // close blocks (state 3) draw the HD model once it is there; the rest of the near ring the procedural one
    const hd = this.hdOn ? this.hd : null, near = this.near, far = this.far;
    const src = this.src, col = this.col, alive = this.alive, order = this.order, start = this.start;
    const counts = _counts;
    counts[0] = counts[1] = counts[2] = 0;
    for (let b = 0; b < st.length; b++) {
      const s = st[b];
      if (!s) continue;
      const out = s === 2 && far ? 2 : s === 3 && hd ? 1 : 0;
      const mesh = out === 2 ? far! : out === 1 ? hd! : near;
      const m = mesh.instanceMatrix.array as Float32Array, c = mesh.instanceColor?.array as Float32Array | undefined;
      let n = counts[out];
      for (let i = start[b]; i < start[b + 1]; i++) {
        const k = order[i];
        if (!alive[k]) continue;
        if (s === 2 && this.thinFar && k & 1) continue;
        m.set(src.subarray(k * 16, k * 16 + 16), n * 16);
        if (c && col) { c[n * 3] = col[k * 3]; c[n * 3 + 1] = col[k * 3 + 1]; c[n * 3 + 2] = col[k * 3 + 2]; }
        n++;
      }
      counts[out] = n;
    }
    publish(near, counts[0], this.on);
    if (hd) publish(hd, counts[1], this.on);
    if (far) publish(far, counts[2], this.on);
  }
}

const _white = new THREE.Color(1, 1, 1);
const _counts = [0, 0, 0];

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
function snowCover(g: THREE.BufferGeometry, amount: number, minY = 0.4): THREE.BufferGeometry {
  const n = g.attributes.normal, c = g.attributes.color, p = g.attributes.position;
  for (let i = 0; i < n.count; i++) {
    if (p.getY(i) < minY) continue; // keep trunks dark
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

/**
 * Palm (tropical coasts and jungle, desert oases; MAPS): a slender trunk bending to one side in a few ringed
 * segments, a crown of drooping, feathered fronds (drawn from both sides) and a cluster of coconuts.
 * `lean` 0..1 bends it further (beach palms lean out).
 */
function palmGeometry(seed: number, lod = false, lean = 0.3): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const segs = lod ? 3 : 5;
  const H = 1.15 + hash2(seed, 1, 3) * 0.25;
  const dir = hash2(seed, 2, 3) * Math.PI * 2;
  const bend = 0.12 + lean * 0.3;
  let px = 0, py = 0, pz = 0;
  const pts: [number, number, number][] = [[0, 0, 0]];
  for (let k = 1; k <= segs; k++) {
    const t = k / segs;
    const off = bend * t * t;
    pts.push([Math.cos(dir) * off, H * t, Math.sin(dir) * off]);
  }
  for (let k = 0; k < segs; k++) {
    const a = pts[k], b = pts[k + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const r0 = 0.055 - k * 0.006, r1 = 0.05 - k * 0.006;
    const cyl = new THREE.CylinderGeometry(r1, r0, len, lod ? 4 : 6, 1, true);
    // ringed bark: alternate the segment tones
    colorize(cyl, k % 2 ? new THREE.Color(0.2, 0.14, 0.08) : new THREE.Color(0.25, 0.18, 0.1), 0.15, seed + k);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize());
    cyl.applyQuaternion(q).translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    parts.push(flat(cyl));
  }
  [px, py, pz] = pts[segs];
  const fb = new TriBuilder();
  const fronds = lod ? 6 : 9;
  const fsegs = lod ? 2 : 4;
  for (let f = 0; f < fronds; f++) {
    const a = (f / fronds) * Math.PI * 2 + hash2(seed, f, 5) * 0.5;
    const len = 0.62 + hash2(seed, f, 6) * 0.22;
    const lift = 0.18 + hash2(seed, f, 7) * 0.12;
    const ca = Math.cos(a), sa = Math.sin(a);
    const g = 0.2 + hash2(seed, f, 8) * 0.07;
    let prev: number[] | null = null, prevL: number[] | null = null, prevR: number[] | null = null;
    for (let k = 0; k <= fsegs; k++) {
      const t = k / fsegs;
      // the frond rises a little, then droops: a parabola along its length
      const d = len * t;
      const y = py + lift * t * 2 - (lift + 0.32) * t * t * 1.4;
      const c = [px + ca * d, y, pz + sa * d];
      const wdt = 0.13 * Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.08)) * (1 - t * 0.35);
      const L = [c[0] - sa * wdt, c[1] - 0.03 * t, c[2] + ca * wdt], R = [c[0] + sa * wdt, c[1] - 0.03 * t, c[2] - ca * wdt];
      if (prev && prevL && prevR) {
        const dark = [0.04, g * 0.6, 0.03], lite = [0.07, g, 0.045];
        fb.tri(prev, c, L, lite, lite, dark); fb.tri(prev, L, c, dark);
        fb.tri(prev, R, c, lite, dark, lite); fb.tri(prev, c, R, dark);
        fb.tri(prev, prevL, L, dark, dark, dark); fb.tri(prev, L, prevL, dark);
        fb.tri(prev, R, prevR, dark, dark, dark); fb.tri(prev, prevR, R, dark);
      }
      prev = c; prevL = L; prevR = R;
    }
  }
  parts.push(fb.geometry());
  if (!lod) for (let k = 0; k < 3; k++) {
    const a = k * 2.1 + seed;
    const nut = new THREE.IcosahedronGeometry(0.045, 0).translate(px + Math.cos(a) * 0.05, py - 0.05, pz + Math.sin(a) * 0.05);
    parts.push(flat(colorize(nut, new THREE.Color(0.2, 0.15, 0.05), 0.2, seed + k)));
  }
  return mergeGeometries(parts.map((g) => { g.deleteAttribute('uv'); return g; }))!;
}

/** Jungle tree (MAPS): a tall pale trunk under a broad, layered, deep-green canopy. */
function jungleTreeGeometry(seed: number, lod = false): THREE.BufferGeometry {
  const trunk = colorize(new THREE.CylinderGeometry(0.05, 0.1, 1.0, lod ? 4 : 6, 1, lod).translate(0, 0.5, 0), new THREE.Color(0.24, 0.2, 0.14), 0.2, seed);
  const parts = [trunk];
  const layers = lod ? 3 : 5;
  for (let k = 0; k < layers; k++) {
    const a = (k / layers) * Math.PI * 2 + seed;
    const r = k === 0 ? 0 : 0.26 + hash2(k, seed, 2) * 0.1;
    const s = k === 0 ? 0.48 : 0.34 + hash2(k, seed, 4) * 0.08;
    const ico = lumpy(new THREE.IcosahedronGeometry(s, lod ? 0 : 1), 0.4, seed * 17 + k);
    ico.scale(1, 0.55, 1);
    ico.translate(Math.cos(a) * r, 1.02 + (k === 0 ? 0.14 : 0) + hash2(k, seed, 6) * 0.12, Math.sin(a) * r);
    const g = 0.3 + hash2(k, seed, 3) * 0.1;
    parts.push(colorize(ico, new THREE.Color(0.05, g * 0.62, 0.035), 0.32, seed + k * 5));
  }
  return mergeGeometries(parts.map((p) => flat(p)))!;
}

/** Triangles (non-indexed) with one colour per triangle corner set, for hand-built shapes. */
class TriBuilder {
  pos: number[] = [];
  col: number[] = [];
  tri(a: number[], b: number[], c: number[], ca: number[], cb = ca, cc = ca) {
    this.pos.push(...a, ...b, ...c);
    this.col.push(...ca, ...cb, ...cc);
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    return g;
  }
}

/**
 * Conifer of drooping, jagged tiers (branch tips stick out, the rim sags). `snow` 0..1: a white mantle
 * lies on the upper part of every tier, leaving the dark undersides and branch tips showing (snow-laden).
 */
function tieredPineGeometry(seed: number, tall: number, snow: number, lod = false, green: [number, number, number] = [0.045, 0.13, 0.065]): THREE.BufferGeometry {
  const trunk = colorize(new THREE.CylinderGeometry(0.04, 0.07, 0.42, lod ? 4 : 5, 1, true).translate(0, 0.21, 0), new THREE.Color(0.13, 0.08, 0.05), 0.2, seed);
  const b = new TriBuilder();
  const tiers = lod ? 3 : 4;
  const m = lod ? 6 : 10;
  const SNOW = [0.84, 0.88, 0.94];
  for (let k = 0; k < tiers; k++) {
    const t = k / (tiers - 1);
    const r = (0.47 - t * 0.33) * (0.92 + hash2(k, seed, 1) * 0.16);
    const h = (0.46 - t * 0.12) * tall;
    const yb = 0.3 + t * 0.74 * tall;
    const apex = [0, yb + h, 0];
    const shade = 0.75 + t * 0.35;
    const g0 = [green[0] * shade, green[1] * shade, green[2] * shade];
    const gTip = [green[0] * shade * 1.25, green[1] * shade * 1.2, green[2] * shade * 1.1];
    const gUnder = [green[0] * 0.55, green[1] * 0.55, green[2] * 0.55];
    const rim: number[][] = [];
    const ph = hash2(seed, k, 2) * 6.28;
    for (let i = 0; i < m; i++) {
      const a = (i / m) * Math.PI * 2 + ph;
      const tip = i % 2 === 0;
      const rr = r * (tip ? 1 : 0.7) * (0.9 + hash2(i, seed + k, 3) * 0.2);
      rim.push([Math.cos(a) * rr, yb - (tip ? 0.05 : 0) * tall, Math.sin(a) * rr]);
    }
    const under = [0, yb + 0.06 * tall, 0];
    for (let i = 0; i < m; i++) {
      const p = rim[i], q = rim[(i + 1) % m];
      b.tri(apex, q, p, g0, i % 2 ? g0 : gTip, i % 2 ? gTip : g0);
      if (k === 0) b.tri(under, p, q, gUnder); // (the upper tiers' undersides are hidden by the tier below)
    }
    if (snow > 0) {
      // the mantle: a lumpy white cone over the upper part of the tier, its hem between the branch tips
      const hem = 0.3 + (1 - snow) * 0.4;
      const sApex = [0, yb + h + 0.012, 0];
      const sr: number[][] = [];
      for (let i = 0; i < m; i++) {
        const a = (i / m) * Math.PI * 2 + ph + Math.PI / m;
        const rr = r * (1 - hem) * 1.06 * (0.98 + hash2(i, seed + k, 5) * 0.14) * (i % 2 ? 1.12 : 0.98);
        sr.push([Math.cos(a) * rr, yb + h * hem + 0.015 - (i % 2 ? 0.02 : 0), Math.sin(a) * rr]);
      }
      const sTop = SNOW, sHem = [SNOW[0] * 0.86, SNOW[1] * 0.88, SNOW[2] * 0.92];
      for (let i = 0; i < m; i++) b.tri(sApex, sr[(i + 1) % m], sr[i], sTop, sHem, sHem);
    }
  }
  return mergeGeometries([flat(trunk), b.geometry()])!;
}

/**
 * Stratified rock: irregular slabs stacked like sedimentary layers, each its own tone, flat tops (snow in
 * winter), the upper layers stepped back. `elong` stretches it into a wall for cliff edges.
 */
function strataRockGeometry(seed: number, tint: [number, number, number], lod: boolean, snow: number, layers = 4, taper = 0.13, elong = 1): THREE.BufferGeometry {
  const b = new TriBuilder();
  const n = lod ? 5 : 8;
  const L = lod ? Math.min(2, layers) : layers;
  const radii: number[] = [], angs: number[] = [];
  for (let i = 0; i < n; i++) {
    angs.push((i / n) * Math.PI * 2 + (hash2(i, seed, 1) - 0.5) * 0.5);
    radii.push(0.5 * (0.66 + hash2(i, seed, 2) * 0.56));
  }
  let y = -0.18;
  const totalH = 0.72;
  let ox = 0, oz = 0;
  const SNOW = [0.84, 0.88, 0.94];
  for (let l = 0; l < L; l++) {
    const hl = (totalH / L) * (0.7 + hash2(l, seed, 3) * 0.6);
    const sc = 1 - l * taper * (0.7 + hash2(l, seed, 4) * 0.6);
    ox += (hash2(l, seed, 5) - 0.5) * 0.1;
    oz += (hash2(l, seed, 6) - 0.5) * 0.1;
    const tone = 0.6 + hash2(l, seed, 7) * 0.55;
    const side = [tint[0] * tone, tint[1] * tone, tint[2] * tone];
    const sideLo = [side[0] * 0.78, side[1] * 0.78, side[2] * 0.78];
    // snow lies thick on the top, thinly on the ledges below
    const sn = snow * (l === L - 1 ? 0.95 : 0.3);
    const topC = sn > 0 ? [side[0] + (SNOW[0] - side[0]) * sn, side[1] + (SNOW[1] - side[1]) * sn, side[2] + (SNOW[2] - side[2]) * sn] : [side[0] * 1.15, side[1] * 1.15, side[2] * 1.12];
    const ring = (yy: number, k: number) => angs.map((a, i) => {
      const r = radii[i] * sc * k * (0.86 + hash2(i, seed + l * 7, 8) * 0.28);
      return [ox + Math.cos(a) * r * elong, yy, oz + Math.sin(a) * r];
    });
    const lo = ring(y, 1), hi = ring(y + hl, 0.93);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      b.tri(lo[i], hi[i], hi[j], sideLo, side, side);
      b.tri(lo[i], hi[j], lo[j], sideLo, side, sideLo);
    }
    // flat (slightly raised in the middle) top; the top layer's snow cap stops short of its rim
    const c = [ox, y + hl + 0.02, oz];
    if (l === L - 1 && sn > 0) {
      const inner = hi.map(([x, yy, z]) => [ox + (x - ox) * 0.78, yy + 0.012, oz + (z - oz) * 0.78]);
      const rim = [side[0] * 1.1 + (SNOW[0] - side[0]) * sn * 0.35, side[1] * 1.1 + (SNOW[1] - side[1]) * sn * 0.35, side[2] * 1.1 + (SNOW[2] - side[2]) * sn * 0.35];
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        // patchy: wind scours some of the cap down to a dusting
        const f = 0.6 + hash2(i, seed, 9) * 0.4;
        const cap = [side[0] + (topC[0] - side[0]) * f, side[1] + (topC[1] - side[1]) * f, side[2] + (topC[2] - side[2]) * f];
        b.tri(c, inner[j], inner[i], topC, cap, cap);
        b.tri(hi[i], inner[i], inner[j], rim, cap, cap);
        b.tri(hi[i], inner[j], hi[j], rim, cap, rim);
      }
    } else {
      for (let i = 0; i < n; i++) b.tri(c, hi[(i + 1) % n], hi[i], topC);
    }
    y += hl * 0.97;
  }
  return b.geometry();
}

/** Chunky boulder: few big facets, banded like the cliffs, snow cap in winter. */
function chunkyBoulderGeometry(seed: number, tint: [number, number, number], lod: boolean, snow: number): THREE.BufferGeometry {
  const g = lumpy(new THREE.DodecahedronGeometry(0.5, 0), 0.32, seed, true);
  g.scale(1.15, 0.72, 0.95);
  const f = flat(g);
  f.computeVertexNormals();
  const p = f.attributes.position, nrm = f.attributes.normal;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i += 3) {
    const yc = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
    const band = 0.78 + hash2(Math.floor((yc + 1) * 6), seed, 9) * 0.4;
    const up = Math.max(0, Math.min(1, (nrm.getY(i) - 0.55) / 0.3)) * snow;
    for (let k = 0; k < 3; k++) {
      col[(i + k) * 3] = tint[0] * band + (0.84 - tint[0] * band) * up;
      col[(i + k) * 3 + 1] = tint[1] * band + (0.88 - tint[1] * band) * up;
      col[(i + k) * 3 + 2] = tint[2] * band + (0.94 - tint[2] * band) * up;
    }
  }
  f.setAttribute('color', new THREE.BufferAttribute(col, 3));
  void lod;
  return f;
}

/** A second shrub shape: a spray of upright fronds / twigs (fern, dry scrub or snowy shrub). */
function shrubGeometry(seed: number, color: [number, number, number], snow: number): THREE.BufferGeometry {
  const b = new TriBuilder();
  const n = 7;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + hash2(k, seed, 1) * 0.6;
    const len = 0.2 + hash2(k, seed, 2) * 0.1;
    const lean = 0.5 + hash2(k, seed, 3) * 0.35;
    const w = 0.045;
    const dx = Math.cos(a), dz = Math.sin(a);
    const base = [dx * 0.02, 0, dz * 0.02];
    const mid = [dx * len * lean * 0.6, len * 0.75, dz * len * lean * 0.6];
    const tip = [dx * len * lean, len * (0.85 + hash2(k, seed, 4) * 0.3), dz * len * lean];
    const px = -dz * w, pz = dx * w;
    const c0 = [color[0] * 0.6, color[1] * 0.6, color[2] * 0.6];
    const c1 = snow > 0 ? [color[0] + (0.84 - color[0]) * snow, color[1] + (0.88 - color[1]) * snow, color[2] + (0.94 - color[2]) * snow] : [color[0] * 1.15, color[1] * 1.15, color[2] * 1.1];
    // snow clings along the upper twigs too
    const cm = snow > 0 ? [color[0] + (0.84 - color[0]) * snow * 0.6, color[1] + (0.88 - color[1]) * snow * 0.6, color[2] + (0.94 - color[2]) * snow * 0.6] : color;
    b.tri(base, [mid[0] - px, mid[1], mid[2] - pz], [mid[0] + px, mid[1], mid[2] + pz], c0, cm, cm);
    b.tri([mid[0] - px, mid[1], mid[2] - pz], tip, [mid[0] + px, mid[1], mid[2] + pz], cm, c1, cm);
  }
  const g = b.geometry();
  const nn = g.attributes.normal;
  for (let i = 0; i < nn.count; i++) nn.setXYZ(i, nn.getX(i) * 0.4, 0.9, nn.getZ(i) * 0.4);
  return g;
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

interface TreeRef { inst: CulledInstances; index: number; x: number; y: number; z: number; s: number; companion?: boolean }

/** A felled tree (syncTrees): world position (x, ground height, z) and `s`, its scale (1 = a 1.5-unit pine). */
export type FelledTree = THREE.Vector3 & { s: number };

type Climate = 'temperate' | 'winter' | 'desert' | 'tropical';
/** HD model of each procedural tree variant (index = the climate's treeSet order). */
const HD_TREES: Record<Climate, string[]> = {
  temperate: ['pine', 'pine_tall', 'oak', 'linden'],
  winter: ['pine_snow', 'pine_snow_tall', 'pine_snow', 'pine_snow_light'],
  desert: ['acacia', 'scrub', 'scrub', 'acacia'],
  tropical: ['oak', '', 'linden', ''], // (palms: procedural only)
};
/** HD model of each procedural rock (outcrop, cliff wall, boulder). */
const HD_ROCKS: Record<Climate, string[]> = {
  temperate: ['rock_outcrop', 'rock_wall', 'boulder'],
  winter: ['rock_outcrop_snow', 'rock_wall_snow', 'boulder_snow'],
  desert: ['rock_outcrop', 'rock_wall', 'boulder'],
  tropical: ['rock_outcrop', 'rock_wall', 'boulder'],
};
/** Linear stone colour per climate over the neutral baked rock albedo (matches the procedural rock tints). */
const ROCK_HD_TINT: Record<Climate, [number, number, number]> = { temperate: [1.08, 1.0, 0.88], winter: [0.78, 0.8, 0.88], desert: [1.68, 1.12, 0.76], tropical: [0.92, 1.0, 0.82] };

/** Margin of the culling grid around the map (covers the scenery forest on the skirt). */
const MARGIN = 48;

export class Vegetation {
  readonly group = new THREE.Group();
  readonly uTime = { value: 0 };
  private grid: BlockGrid;
  private all: CulledInstances[] = [];
  private treeRefs = new Map<number, TreeRef[]>();
  private clutterByCell = new Map<number, [CulledInstances, number][]>();
  private grass: CulledInstances | null = null;
  private lastTreeVersion: number;
  private treeState: Uint8Array;

  /**
   * @param scenery tree spots on the landscape outside the playable area ([x, height, y]); they share the
   *   map trees' instanced meshes, so they cost no extra draw calls.
   */
  constructor(private map: GameMap, heightAt: HeightFn, quality: 'low' | 'medium' | 'high', readonly climate: Climate = 'temperate', scenery: [number, number, number][] = []) {
    this.lastTreeVersion = map.treeVersion;
    this.treeState = map.tree.slice();
    this.group.name = 'vegetation';
    this.group.matrixAutoUpdate = false;
    const m = map;
    this.grid = new BlockGrid(-MARGIN, -MARGIN, m.w + MARGIN, m.h + MARGIN, quality === 'medium' ? HD_DIST.medium : HD_DIST.high);
    const grid = this.grid;
    const dummy = new THREE.Object3D();
    const mat4 = () => { dummy.updateMatrix(); return dummy.matrix.clone(); };
    const lodOn = quality !== 'low';
    // HD trees and rocks up close (the procedural ones stay the far LOD; Low and Standard detail keep them all)
    const hdOn = lodOn && hdModelsEnabled() && !classicLook('nature');

    // ---- trees -------------------------------------------------------------
    const treeSet = (lod: boolean): THREE.BufferGeometry[] => {
      // winter: snow-laden firs of drooping tiers (one lightly dusted); temperate: tiered firs and broadleaves
      if (climate === 'winter') return [tieredPineGeometry(1, 1.0, 0.9, lod), tieredPineGeometry(2, 1.3, 0.85, lod, [0.04, 0.115, 0.07]), tieredPineGeometry(5, 1.12, 1, lod), tieredPineGeometry(6, 0.9, 0.55, lod, [0.05, 0.12, 0.06])];
      if (climate === 'desert') return [tintFoliage(broadleafGeometry(3, lod), 0.17, 0.17, 0.08), tintFoliage(broadleafGeometry(4, lod), 0.2, 0.18, 0.09), tintFoliage(pineGeometry(7, 0.8, lod), 0.12, 0.14, 0.07, 0.4), tintFoliage(broadleafGeometry(8, lod), 0.23, 0.2, 0.1)];
      // tropical (World Conquest): jungle giants and palms, one of them leaning out
      if (climate === 'tropical') return [jungleTreeGeometry(3, lod), palmGeometry(5, lod, 0.2), jungleTreeGeometry(9, lod), palmGeometry(11, lod, 0.75)];
      return [tieredPineGeometry(1, 1.0, 0, lod), tieredPineGeometry(2, 1.28, 0, lod, [0.05, 0.15, 0.06]), broadleafGeometry(3, lod), broadleafGeometry(4, lod)];
    };
    // desert trees by the water are date palms (oases, the Nile's banks): a fifth set
    const palmV = climate === 'desert' ? 4 : -1;
    const treeGeos = treeSet(false);
    const treeLods = lodOn ? treeSet(true) : null;
    if (palmV >= 0) { treeGeos.push(palmGeometry(13, false, 0.35)); treeLods?.push(palmGeometry(13, true, 0.35)); }
    const treeMat = windMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 }, this.uTime, 0.04, 0.35, 'tree');
    const treeItems: Item[][] = [[], [], [], [], []];
    const treeCells: number[][] = [[], [], [], [], []];
    const treePos: [number, number, number, number][][] = [[], [], [], [], []];
    const wetNear = (cx: number, cy: number) => {
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const x = cx + dx, y = cy + dy;
        if (m.inBounds(x, y) && m.terrain[m.idx(x, y)] === T.Water) return true;
      }
      return false;
    };
    for (let i = 0; i < m.w * m.h; i++) {
      if (!m.tree[i]) continue;
      const v = palmV >= 0 && wetNear(i % m.w, (i / m.w) | 0) ? palmV : (m.tree[i] - 1) % 4;
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
      treePos[v].push([x, z, y, sc]);
      // denser forest: a smaller companion tree in many forest cells (not on low)
      if (lodOn && hash2(cx, cy, 11) < (climate === 'desert' ? 0.25 : 0.6)) {
        const v2 = (v + 1 + Math.floor(hash2(cx, cy, 12) * 3)) % 4;
        const a = hash2(cx, cy, 13) * Math.PI * 2;
        const x2 = cx + 0.5 + Math.cos(a) * 0.32, y2 = cy + 0.5 + Math.sin(a) * 0.32;
        const z2 = heightAt(x2, y2) - 0.03;
        const sc2 = sc * (0.55 + hash2(cx, cy, 14) * 0.25);
        dummy.position.set(x2, z2, y2);
        dummy.rotation.set(0, hash2(cx, cy, 15) * Math.PI * 2, 0);
        dummy.scale.set(sc2, sc2 * (0.95 + hash2(cx, cy, 16) * 0.2), sc2);
        const t2 = 0.8 + hash2(cx, cy, 17) * 0.3;
        treeItems[v2].push({ m: mat4(), c: new THREE.Color(t2, t2, t2 * 0.95), x: x2, y: y2 });
        treeCells[v2].push(-1 - i);
        treePos[v2].push([x2, z2, y2, sc2]);
      }
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
      if (hdOn && HD_TREES[climate][v]) this.hdSlot(HD_TREES[climate][v], inst, 'tree'); // (no HD palms: index 4 is undefined)
      treeCells[v].forEach((ci, k) => {
        // companions (negative cell ids) go after their cell's main tree, which reports the fall
        const cell = ci < 0 ? -1 - ci : ci;
        let list = this.treeRefs.get(cell);
        if (!list) this.treeRefs.set(cell, (list = []));
        list.push({ inst, index: k, x: treePos[v][k][0], y: treePos[v][k][1], z: treePos[v][k][2], s: treePos[v][k][3], companion: ci < 0 });
      });
    });

    // ---- rock: layered outcrops, cliff walls along the edges of rocky ground, chunky boulders -------------
    // three geometries: outcrop, cliff wall, boulder (+ their LODs)
    const rockTint: [number, number, number] = climate === 'winter' ? [0.17, 0.172, 0.19] : climate === 'desert' ? [0.42, 0.28, 0.19] : [0.27, 0.25, 0.22];
    const rockSnow = climate === 'winter' ? 0.92 : 0;
    const rockSet = (lod: boolean) => [
      strataRockGeometry(11, rockTint, lod, rockSnow, 4, 0.17),
      strataRockGeometry(12, rockTint, lod, rockSnow, 4, 0.07, 1.4),
      chunkyBoulderGeometry(13, rockTint, lod, rockSnow * 0.85),
    ];
    const rockGeos = rockSet(false);
    const rockLods = lodOn ? rockSet(true) : null;
    const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
    const rockItems: Item[][] = [[], [], []];
    const addRock = (v: number, x: number, y: number, rot: number, sx: number, sy: number, sz: number, r: number, sink = 0.12) => {
      dummy.position.set(x, heightAt(x, y) - sy * sink, y);
      dummy.rotation.set((r - 0.5) * (v === 2 ? 0.5 : 0.1), rot, (r - 0.3) * (v === 2 ? 0.4 : 0.08));
      dummy.scale.set(sx, sy, sz);
      const tint = 0.82 + r * 0.3;
      rockItems[v].push({ m: mat4(), c: new THREE.Color(tint, tint * 0.98, tint * 0.95), x, y });
    };
    // no clutter on the roads (roads.ts; the same network the terrain draws)
    const roads = roadsFor(m);
    const road = roads.cells;
    const offRoad = (x: number, y: number) => roadDistance(roads, m.w, m.h, x, y) > ROAD_HALF.main + 0.25;
    // (a landmark's footprint is rock to the sim but carries its model: no outcrops or cliff walls there)
    const lmk = m.landmarks.length ? landmarkMask(m) : null;
    const isRock = (x: number, y: number) => m.inBounds(x, y) && m.terrain[m.idx(x, y)] === T.Rock && !lmk?.[m.idx(x, y)];
    const isWater = (x: number, y: number) => m.inBounds(x, y) && m.terrain[m.idx(x, y)] === T.Water;
    for (let cy = 0; cy < m.h; cy++) for (let cx = 0; cx < m.w; cx++) {
      const i = m.idx(cx, cy);
      if (lmk?.[i]) continue;
      const t = m.terrain[i];
      const r = hash2(cx, cy, 27);
      if (t === T.Rock) {
        let nx = 0, ny = 0;
        if (!isRock(cx - 1, cy)) nx -= 1;
        if (!isRock(cx + 1, cy)) nx += 1;
        if (!isRock(cx, cy - 1)) ny -= 1;
        if (!isRock(cx, cy + 1)) ny += 1;
        if (nx || ny) {
          // a stratified wall facing the open ground, its long side along the edge
          const l = Math.hypot(nx, ny);
          const ux = nx / l, uy = ny / l;
          addRock(1, cx + 0.5 + ux * 0.12 + (hash2(cx, cy, 23) - 0.5) * 0.2, cy + 0.5 + uy * 0.12 + (hash2(cx, cy, 25) - 0.5) * 0.2,
            Math.atan2(-ux, -uy) + (r - 0.5) * 0.35, 0.95 + hash2(cx, cy, 22) * 0.4, 0.75 + hash2(cx, cy, 24) * 0.6, 0.75 + r * 0.25, r, 0.25);
          if (hash2(cx, cy, 21) < 0.35) addRock(2, cx + 0.5 - ux * 0.3, cy + 0.5 - uy * 0.3, r * 6.28, 0.5 + r * 0.4, 0.5 + r * 0.4, 0.5 + r * 0.3, r);
        } else if (hash2(cx, cy, 21) < 0.42) {
          // inner rock: low stepped outcrops (the terrain's own banded rock shows between them)
          const sc = 0.95 + hash2(cx, cy, 22) * 0.6;
          addRock(0, cx + 0.3 + hash2(cx, cy, 23) * 0.4, cy + 0.3 + hash2(cx, cy, 25) * 0.4, r * 6.28, sc, sc * (0.5 + hash2(cx, cy, 24) * 0.45), sc * (0.85 + r * 0.3), r, 0.25);
        } else if (hash2(cx, cy, 21) < 0.58) {
          const sc = 0.7 + hash2(cx, cy, 22) * 0.5;
          addRock(2, cx + 0.5, cy + 0.5, r * 6.28, sc, sc, sc, r);
        }
      } else if (t === T.Clear || t === T.Dirt || t === T.Sand) {
        if (m.ore[i] || m.tree[i] || road[i]) continue;
        const bank = isWater(cx - 1, cy) || isWater(cx + 1, cy) || isWater(cx, cy - 1) || isWater(cx, cy + 1);
        // scattered stones (decorative); pebbles and stones line the river banks (big snowy rocks in winter)
        if (hash2(cx, cy, 31) < (bank ? 0.32 : 0.018)) {
          const big = bank && climate === 'winter' && hash2(cx, cy, 36) < 0.45;
          const sc = big ? 0.28 + hash2(cx, cy, 34) * 0.3 : bank ? 0.1 + hash2(cx, cy, 34) * 0.16 : 0.12 + hash2(cx, cy, 34) * 0.12;
          if (offRoad(cx + hash2(cx, cy, 32), cy + hash2(cx, cy, 33))) addRock(2, cx + hash2(cx, cy, 32), cy + hash2(cx, cy, 33), r * 6.28, sc, sc * 0.8, sc, hash2(cx, cy, 35));
        }
      }
    }
    rockGeos.forEach((g, v) => {
      if (!rockItems[v].length) return;
      const inst = this.add(new CulledInstances(grid, this.group, g, rockMat, rockItems[v], true, rockLods?.[v] ?? null));
      if (hdOn) this.hdSlot(HD_ROCKS[climate][v], inst, 'rock');
    });
    if (hdOn) this.loadHd();

    // ---- bushes near forests ------------------------------------------------
    const bushItems: Item[] = [];
    for (let cy = 0; cy < m.h; cy++) for (let cx = 0; cx < m.w; cx++) {
      const i = m.idx(cx, cy);
      if (m.terrain[i] !== T.Clear || m.tree[i] || m.ore[i] || road[i]) continue;
      let nearTree = false;
      for (let dy = -1; dy <= 1 && !nearTree; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (m.inBounds(cx + dx, cy + dy) && m.tree[m.idx(cx + dx, cy + dy)]) { nearTree = true; break; }
      }
      if (hash2(cx, cy, 41) < (nearTree ? 0.35 : 0.015)) {
        const x = cx + 0.15 + hash2(cx, cy, 42) * 0.7, y = cy + 0.15 + hash2(cx, cy, 43) * 0.7, r = hash2(cx, cy, 44);
        if (!offRoad(x, y)) continue;
        dummy.position.set(x, heightAt(x, y), y);
        dummy.rotation.set(0, r * 6.28, 0);
        const sc = 0.8 + r * 0.6;
        dummy.scale.set(sc, sc, sc);
        bushItems.push({ m: mat4(), x, y });
      }
    }
    // variety: about a third of them are a second shrub shape (ferns / dry scrub / snowy twigs; not on low)
    const shrubItems: Item[] = [];
    if (lodOn) {
      for (let k = bushItems.length - 1; k >= 0; k--) {
        const it = bushItems[k];
        if (hash2(Math.floor(it.x * 7), Math.floor(it.y * 7), 46) < 0.38) { shrubItems.push(it); bushItems.splice(k, 1); }
      }
    }
    if (bushItems.length) {
      let bushGeo = bushGeometry(5);
      // winter: dark evergreen shrubs under a snow cap (the whole bush is below the trunk cut-off of the trees)
      if (climate === 'winter') bushGeo = snowCover(tintFoliage(bushGeo, 0.05, 0.1, 0.06, -1), 0.85, -1);
      else if (climate === 'desert') bushGeo = tintFoliage(bushGeo, 0.2, 0.18, 0.09, -1);
      const inst = this.add(new CulledInstances(grid, this.group, bushGeo, windMaterial({ vertexColors: true, roughness: 0.9 }, this.uTime, 0.12, 0.0, 'bush'), bushItems, true, null, true));
      bushItems.forEach((it, k) => this.addCellRef(m.idx(Math.floor(it.x), Math.floor(it.y)), inst, k));
    }
    if (shrubItems.length) {
      const col: [number, number, number] = climate === 'winter' ? [0.34, 0.27, 0.2] : climate === 'desert' ? [0.3, 0.24, 0.12] : [0.12, 0.26, 0.07];
      const geo = shrubGeometry(7, col, climate === 'winter' ? 0.9 : 0);
      const inst = this.add(new CulledInstances(grid, this.group, geo, windMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }, this.uTime, 0.3, 0.0, 'shrub'), shrubItems, true, null, true));
      shrubItems.forEach((it, k) => this.addCellRef(m.idx(Math.floor(it.x), Math.floor(it.y)), inst, k));
    }

    // ---- grass tufts ----------------------------------------------------------
    const density = (quality === 'low' ? 0.9 : 2.2) * (climate === 'winter' ? 0.25 : climate === 'desert' ? 0.45 : climate === 'tropical' ? 1.3 : 1);
    const grassTint = climate === 'winter' ? [1.6, 1.35, 1.6] : climate === 'desert' ? [2.0, 1.45, 0.75] : climate === 'tropical' ? [0.8, 1.12, 0.72] : [1, 1, 1];
    const grassItems: Item[] = [];
    const gn = new Noise2D(m.seed + 77);
    for (let cy = 0; cy < m.h; cy++) for (let cx = 0; cx < m.w; cx++) {
      const i = m.idx(cx, cy);
      const t = m.terrain[i];
      // reeds: tall, lush tufts crowd the banks (temperate; sand banks too)
      const bank = (climate === 'temperate' || climate === 'tropical') && lodOn && (isWater(cx - 1, cy) || isWater(cx + 1, cy) || isWater(cx, cy - 1) || isWater(cx, cy + 1));
      if (((t !== T.Clear && t !== T.Dirt) && !(bank && t === T.Sand)) || m.tree[i] || m.ore[i] || road[i]) continue;
      const lush = gn.fbm(cx * 0.12, cy * 0.12, 3);
      const count = Math.floor(density * (lush * 1.8 - 0.1) * (t === T.Dirt ? 0.4 : 1) + hash2(cx, cy, 51)) + (bank ? 4 : 0);
      for (let k = 0; k < count; k++) {
        const x = cx + hash2(cx, cy, 52 + k), y = cy + hash2(cx, cy, 62 + k), r = hash2(cx, cy, 72 + k);
        if (bank && heightAt(x, y) < -0.3) continue; // not in the water
        if (!offRoad(x, y)) continue;
        dummy.position.set(x, heightAt(x, y) - 0.01, y);
        dummy.rotation.set(0, r * 6.28, 0);
        const sc = (0.8 + r * 0.9) * (bank ? 1.15 : 1);
        dummy.scale.set(sc, sc * (0.8 + hash2(cx * 7 + k, cy, 7) * 0.6) * (bank ? 2.2 : 1), sc);
        const l2 = gn.fbm(x * 0.12, y * 0.12, 3);
        grassItems.push({ m: mat4(), c: bank ? new THREE.Color(0.75 + r * 0.25, 1.05 + l2 * 0.2, 0.6) : new THREE.Color((0.85 + l2 * 0.3 + r * 0.2) * grassTint[0], (0.9 + l2 * 0.2) * grassTint[1], (0.75 + r * 0.1) * grassTint[2]), x, y });
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

  /** HD nature model per id: its material (one per model) and the instance sets that use it. */
  private hd = new Map<string, { mat: THREE.MeshStandardMaterial; insts: CulledInstances[]; tpl: NatureTemplate | null }>();

  private hdSlot(id: string, inst: CulledInstances, kind: 'tree' | 'rock') {
    let e = this.hd.get(id);
    if (!e) {
      const params = natureMaterialParams();
      const mat = kind === 'tree'
        ? windMaterial(params, this.uTime, 0.04, 0.35, 'tree-hd')
        : new THREE.MeshStandardMaterial(params);
      // rocks are baked neutral grey: the climate's stone colour comes from the material (instance colours vary it)
      if (kind === 'rock') mat.color.setRGB(...ROCK_HD_TINT[this.climate]);
      mat.name = `nature-${id}`;
      e = { mat, insts: [], tpl: null };
      this.hd.set(id, e);
    }
    inst.prepareHd(e.mat);
    e.insts.push(inst);
  }

  private loadHd() {
    prefetchOffline(natureUrls);
    this.hdReady = Promise.all([...this.hd].map(([id, e]) => loadNature(id).then((t) => {
      if (!t) return;
      e.tpl = t;
      applyNatureTextures(e.mat, t);
      for (const inst of e.insts) inst.useHd(t.geometry);
    }))).then(() => {});
  }

  /** Settles when every HD nature model has arrived (or failed); immediately without HD. */
  hdReady: Promise<void> = Promise.resolve();
  private frames = 0;

  /** HD nature status (screenshot tools / debugging): models in use and their triangles. */
  hdStatus(): { wanted: number; ready: string[]; tris: Record<string, number> } {
    const ready: string[] = [], tris: Record<string, number> = {};
    for (const [id, e] of this.hd) if (e.tpl) { ready.push(id); tris[id] = e.tpl.tris; }
    return { wanted: this.hd.size, ready, tris };
  }

  private add(c: CulledInstances): CulledInstances {
    this.all.push(c);
    return c;
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
  syncTrees(): FelledTree[] {
    if (this.map.treeVersion === this.lastTreeVersion) return NO_TREES;
    const out: FelledTree[] = [];
    this.lastTreeVersion = this.map.treeVersion;
    for (let i = 0; i < this.treeState.length; i++) {
      if (this.treeState[i] && !this.map.tree[i]) {
        this.treeState[i] = 0;
        const refs = this.treeRefs.get(i);
        if (refs) {
          for (const ref of refs) {
            ref.inst.hide(ref.index);
            if (!ref.companion) out.push(Object.assign(new THREE.Vector3(ref.x, ref.y, ref.z), { s: ref.s }));
          }
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
    if (this.frames < 30 && ++this.frames === 30) for (const c of this.all) c.endHdWarmUp();
    if (camera && sunDir) this.grid.cull(camera, sunDir);
    for (const c of this.all) c.sync();
  }

  setGrassVisible(v: boolean) {
    if (this.grass) this.grass.enabled = v;
  }
}

const NO_TREES: FelledTree[] = [];
