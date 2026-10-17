import * as THREE from 'three';
import { hash2 } from '../core/rng';
import { BUILDINGS, type BuildingTypeDef } from '../data/rules';
import { T, type GameMap } from '../sim/map';
import { BASE_RES, type Climate } from './terrain';
import { shadowDepthMaterial } from './models/materials';
import { patchMaterialForWeather, type WeatherSurfaceUniforms } from './weather';
import { roadsFor } from './roads';
import type { DynamicLightApi } from './dynlights';

/**
 * Base dressing: render-only set dressing derived from the map and the structures the local player can
 * see (their footprints; sim state is only read).
 *
 * - Ground (no geometry): the terrain shader's base mask (TerrainMesh.baseData, BASE_RES texels per cell) gets
 *   trampled / churned ground around every structure, packed paths between neighbouring structures and out of
 *   the factory exits, concrete aprons and a contact shade ring.
 * - Props: crates, tarp-covered stacks, barrels and fuel drums, sandbag piles, fences, lamp posts (emissive
 *   heads at night) and power-line poles with sagging wires from the power plants to nearby structures. All
 *   of them are merged into one mesh per 32x32-cell chunk (one draw call each, plus its shadow on high),
 *   rebuilt only for the chunks whose structures changed. They are never picked (no raycast).
 *
 * Fog: a structure is dressed while the entity renderer shows it (enemy bases once seen, ghosts included), so
 * the dressing never reveals anything the player has not seen.
 */

/** What the dressing needs from a structure (sim Building satisfies it). */
export interface DressableBuilding {
  readonly id: number;
  readonly bt: BuildingTypeDef;
  readonly cx: number;
  readonly cy: number;
  readonly owner: { readonly id: number; readonly faction: string };
}

/** The terrain surface the dressing writes into (TerrainMesh). */
export interface DressingTerrain {
  readonly baseData: Uint8Array;
  markBase(j0: number, j1: number): void;
  renderHeight(x: number, y: number): number;
}

export interface BaseDressingOptions {
  quality: 'low' | 'medium' | 'high';
  climate: Climate;
  /** Is this structure shown to the local player (EntityRenderer.isShown)? Default: always. */
  shown?: (id: number) => boolean;
  /** Ground clutter (grass, bushes) to clear off aprons and paths (Vegetation.hideCells). */
  hideClutter?: (cells: number[]) => void;
  /** Rain gloss / snow cover on the props. */
  weather?: WeatherSurfaceUniforms | null;
}

interface Site {
  id: number;
  type: string;
  bt: BuildingTypeDef;
  cx: number;
  cy: number;
  w: number;
  h: number;
  owner: number;
  soviet: boolean;
  /** Door: where paths meet the structure (factory exit, refinery dock, or the middle of the front). */
  dx: number;
  dy: number;
  seed: number;
}

/** Prop kinds (prototype index). */
const enum K { Crate, Tarp, Barrel, Sandbag, Lamp, Pole, Fence, Post, Count }

interface Prop { k: K; v: number; x: number; y: number; rot: number; s: number; sy: number }
interface Wire { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number }

const CHUNK = 32;
/** Path half-width encoded in the mask's b channel (cells); keep in sync with the terrain shader. */
export const PATH_W = 0.6;
const _c = new THREE.Color();

// ---------------------------------------------------------------------------------------------
// Prototype geometry (non-indexed, position / normal / color / aGlow)

interface Proto { pos: Float32Array; nrm: Float32Array; col: Float32Array; glow: Float32Array; n: number }

function part(g: THREE.BufferGeometry, color: number | THREE.Color, glow = 0, jitter = 0, seed = 0): THREE.BufferGeometry {
  let ng = g.index ? g.toNonIndexed() : g;
  ng.deleteAttribute('uv');
  ng.deleteAttribute('normal');
  ng.computeVertexNormals();
  const n = ng.attributes.position.count;
  const col = new Float32Array(n * 3), gl = new Float32Array(n);
  const c = color instanceof THREE.Color ? color : _c.set(color);
  for (let i = 0; i < n; i++) {
    const f = 1 + (hash2((i / 3) | 0, seed, 5) - 0.5) * jitter;
    col[i * 3] = c.r * f; col[i * 3 + 1] = c.g * f; col[i * 3 + 2] = c.b * f;
    gl[i] = glow;
  }
  ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
  ng.setAttribute('aGlow', new THREE.BufferAttribute(gl, 1));
  return ng;
}

function proto(parts: THREE.BufferGeometry[], snow: number): Proto {
  let n = 0;
  for (const p of parts) n += p.attributes.position.count;
  const out: Proto = { pos: new Float32Array(n * 3), nrm: new Float32Array(n * 3), col: new Float32Array(n * 3), glow: new Float32Array(n), n };
  let o = 0;
  for (const p of parts) {
    const c = p.attributes.position.count;
    out.pos.set(p.attributes.position.array as Float32Array, o * 3);
    out.nrm.set(p.attributes.normal.array as Float32Array, o * 3);
    out.col.set(p.attributes.color.array as Float32Array, o * 3);
    out.glow.set(p.attributes.aGlow.array as Float32Array, o);
    o += c;
    p.dispose();
  }
  // winter: snow settles on every upward face
  if (snow > 0) {
    for (let i = 0; i < n; i++) {
      if (out.glow[i] > 0) continue;
      const up = Math.max(0, Math.min(1, (out.nrm[i * 3 + 1] - 0.55) / 0.3)) * snow;
      out.col[i * 3] += (0.84 - out.col[i * 3]) * up;
      out.col[i * 3 + 1] += (0.88 - out.col[i * 3 + 1]) * up;
      out.col[i * 3 + 2] += (0.94 - out.col[i * 3 + 2]) * up;
    }
  }
  return out;
}

const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z);
const cyl = (r0: number, r1: number, h: number, seg: number, x = 0, y = 0, z = 0, open = false) => new THREE.CylinderGeometry(r0, r1, h, seg, 1, open).translate(x, y + h / 2, z);
/** A thin bar from (x0, y, z0) along +x, length l: a 3-sided prism (6 triangles). */
const bar = (l: number, r: number, y: number) => new THREE.CylinderGeometry(r, r, l, 3, 1, true).rotateZ(Math.PI / 2).translate(l / 2, y, 0);

/** Sandbag: a squashed, stretched octahedron (a pillow). */
function bag(x: number, y: number, z: number, rot: number, seed: number): THREE.BufferGeometry {
  const g = new THREE.OctahedronGeometry(0.5, 0);
  g.scale(0.15 * (0.9 + hash2(seed, 1) * 0.2), 0.065, 0.085);
  g.rotateY(rot);
  return g.translate(x, y + 0.03, z);
}

function buildProtos(climate: Climate): Proto[][] {
  const snow = climate === 'winter' ? 0.55 : 0;
  const sand = climate === 'desert';
  const P: Proto[][] = [];
  // crates: wood, olive military, grey steel (a lid frame on top)
  P[K.Crate] = [0x9a7444, 0x56633a, 0x6a7078].map((c, i) => proto([
    part(box(0.26, 0.21, 0.26), c, 0, 0.18, i),
    part(box(0.28, 0.035, 0.28, 0, 0.19), _c.set(c).multiplyScalar(0.7), 0, 0.1, i + 7),
  ], snow * 0.6));
  // tarp-covered stack: crates under a sagging sheet, tied down
  P[K.Tarp] = [0x3f4a33, 0x3a4652, 0x6b5d45].map((c, i) => {
    const sheet = new THREE.BoxGeometry(0.5, 0.26, 0.36, 3, 1, 2);
    const p = sheet.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
      // rounded shoulders, sagging in the middle
      const sag = y > 0 ? 0.035 * (1 - Math.abs(x) / 0.25) * (1 - Math.abs(z) / 0.18) : 0;
      p.setXYZ(k, x * (y > 0 ? 0.93 : 1.02), y - sag + 0.13, z * (y > 0 ? 0.9 : 1.03));
    }
    return proto([part(sheet, c, 0, 0.22, 20 + i), part(box(0.52, 0.03, 0.02, 0, 0.12, 0), 0x2a2622)], snow * 0.45);
  });
  // barrels / fuel drums: red, olive, blue-grey, rust, yellow hazard (lid lighter, a rim band)
  P[K.Barrel] = [0x8e231b, 0x4e5733, 0x3d5268, 0x6e4128, 0xb08a22].map((c, i) => {
    const body = cyl(0.075, 0.075, 0.21, 7, 0, 0, 0, true);
    const lid = new THREE.CircleGeometry(0.075, 7).rotateX(-Math.PI / 2).translate(0, 0.21, 0);
    return proto([
      part(body, c, 0, 0.12, 30 + i),
      part(cyl(0.078, 0.078, 0.025, 7, 0, 0.1, 0, true), _c.set(c).multiplyScalar(0.6), 0, 0, 31),
      part(lid, _c.set(c).lerp(_c.clone().set(0x9a9a9a), 0.5), 0, 0, 33),
    ], snow);
  });
  // sandbag pile: an arc of two rows
  {
    const parts: THREE.BufferGeometry[] = [];
    const col = sand ? 0xa08a62 : 0x8a7a58;
    for (let k = 0; k < 5; k++) {
      const a = (k - 2) * 0.32;
      parts.push(part(bag(Math.sin(a) * 0.42, 0, 0.42 - Math.cos(a) * 0.42, -a, k), col, 0, 0.25, k));
    }
    for (let k = 0; k < 4; k++) {
      const a = (k - 1.5) * 0.32;
      parts.push(part(bag(Math.sin(a) * 0.42, 0.065, 0.42 - Math.cos(a) * 0.42, -a + 0.05, k + 9), col, 0, 0.25, k + 9));
    }
    P[K.Sandbag] = [proto(parts, snow * 0.8)];
  }
  // lamp post: base, pole, arm, hooded lamp (glowing underside)
  P[K.Lamp] = [proto([
    part(cyl(0.016, 0.026, 1.1, 5, 0, 0, 0, true), 0x34373c),
    part(bar(0.2, 0.014, 1.08), 0x34373c),
    part(box(0.15, 0.045, 0.11, 0.2, 1.03), 0x2b2d30),
    part(box(0.13, 0.034, 0.095, 0.2, 1.0), 0xffffff, 1),
  ], snow * 0.6)];
  // power-line pole: wooden pole, crossarm, three insulators (wires hang at x = ±0.18, y = 1.43)
  P[K.Pole] = [proto([
    part(cyl(0.022, 0.032, 1.48, 5, 0, 0, 0, true), 0x4a3524, 0, 0.15, 3),
    part(box(0.44, 0.04, 0.045, 0, 1.36), 0x3e2c1e),
    part(cyl(0.012, 0.012, 0.05, 4, -0.18, 1.4, 0, true), 0x7d8a8e),
    part(cyl(0.012, 0.012, 0.05, 4, 0.18, 1.4, 0, true), 0x7d8a8e),
  ], snow * 0.5)];
  // fence segment, 1 cell along +x from a post at x = 0: soviet concrete posts + barbed strands, allied steel
  // posts + mesh rails (the run's last post is a separate Post prop)
  const fence = (post: number, rail: number, n: number, postW: number) => proto([
    part(box(postW, 0.42, postW), post),
    ...Array.from({ length: n }, (_, k) => part(bar(1, 0.008, 0.1 + (k * 0.3) / Math.max(1, n - 1)), rail)),
  ], snow * 0.7);
  P[K.Fence] = [fence(0x8a8a86, 0x2a2826, 3, 0.06), fence(0x4c5258, 0x5d6268, 3, 0.04)];
  P[K.Post] = [proto([part(box(0.06, 0.42, 0.06), 0x8a8a86)], snow * 0.7), proto([part(box(0.04, 0.42, 0.04), 0x4c5258)], snow * 0.7)];
  return P;
}

// ---------------------------------------------------------------------------------------------

export class BaseDressing {
  readonly group = new THREE.Group();
  /** Lamp glow 0..1 (night). */
  private uLamp = { value: 0 };
  private material: THREE.MeshStandardMaterial;
  private protos: Proto[][] | null = null;
  private sites = new Map<number, Site>();
  private seen = new Set<number>();
  private chunks = new Map<number, { mesh: THREE.Mesh; key: string }>();
  private timer = 0;
  private cellMark: Uint8Array;
  /** Dressed structures, props per kind (crate, tarp, barrel, sandbag, lamp, pole, fence, post), wires, chunks. */
  readonly stats = { sites: 0, kinds: [0, 0, 0, 0, 0, 0, 0, 0], wires: 0, chunks: 0, triangles: 0 };
  /** Lamp heads (world x, y, z) and their persistent dynamic lights (medium / high, lit at night). */
  private lampPos: number[] = [];
  private lampIds: number[] = [];
  private lampLit = -1;
  private dyn: DynamicLightApi | null = null;
  private readonly W: number;
  private readonly H: number;
  private readonly props: boolean;
  private readonly density: number;

  constructor(private map: GameMap, private terrain: DressingTerrain, private opts: BaseDressingOptions) {
    this.group.name = 'base-dressing';
    this.group.matrixAutoUpdate = false;
    this.W = map.w * BASE_RES;
    this.H = map.h * BASE_RES;
    this.cellMark = new Uint8Array(map.w * map.h);
    // low: the ground mask only (free); medium: fewer props, no shadows; high: everything
    this.props = opts.quality !== 'low';
    this.density = opts.quality === 'high' ? 1 : 0.6;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.08 });
    const uLamp = this.uLamp;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uLamp = uLamp;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uLamp;\nvarying float vGlow;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          // lamp heads: dim glass by day, warm sodium light at night
          totalEmissiveRadiance += vec3(1.0, 0.68, 0.36) * vGlow * (0.08 + uLamp * 9.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.82, 0.6), vGlow * 0.6);`);
    };
    mat.customProgramCacheKey = () => 'rh-props';
    if (opts.weather) patchMaterialForWeather(mat, opts.weather);
    this.material = mat;
  }

  /**
   * Per frame (cheap): lamp glow from the night factor; every ~0.35 s the visible structures are compared with
   * the dressed set, and the mask / chunks rebuilt where they changed.
   */
  update(buildings: Iterable<DressableBuilding>, night: number, dt: number) {
    const lamp = Math.min(1, Math.max(0, (night - 0.25) / 0.45));
    this.uLamp.value = lamp;
    if (Math.abs(lamp - this.lampLit) > 0.02) this.lightLamps(lamp);
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.35;
    const shown = this.opts.shown;
    const seen = this.seen;
    seen.clear();
    let added: Site[] | null = null;
    for (const b of buildings) {
      const bt = b.bt;
      if (bt.wall || bt.mine || bt.water) continue;
      if (shown && !shown(b.id)) continue;
      seen.add(b.id);
      if (!this.sites.has(b.id)) {
        const s = this.site(b);
        this.sites.set(b.id, s);
        (added ??= []).push(s);
      }
    }
    let removed: Site[] | null = null;
    for (const s of this.sites.values()) {
      // gone from the world: kept while its (ghost) model is still shown
      if (!seen.has(s.id) && !(shown && shown(s.id))) (removed ??= []).push(s);
    }
    if (removed) for (const s of removed) this.sites.delete(s.id);
    if (added || removed) this.rebuild(added, removed);
  }

  /** Dress a fixed set of structures now (tests, previews). */
  syncNow(buildings: Iterable<DressableBuilding>) {
    this.timer = 0;
    this.update(buildings, 0, 0);
  }

  private site(b: DressableBuilding): Site {
    // decoys dress like the real thing
    const bt = (b.bt.fakeOf && BUILDINGS[b.bt.fakeOf]) || b.bt;
    const w = b.bt.size[0], h = b.bt.size[1];
    let dx = b.cx + w / 2, dy = b.cy + h + 0.45;
    const door = bt.exit ?? bt.dock;
    if (door) { dx = b.cx + door[0] + 0.5; dy = b.cy + Math.min(door[1], h) + 0.45; }
    return { id: b.id, type: bt.id, bt, cx: b.cx, cy: b.cy, w, h, owner: b.owner.id, soviet: b.owner.faction === 'soviet', dx, dy, seed: (hash2(b.cx, b.cy, 4049) * 1e6) | 0 };
  }

  // -------------------------------------------------------------------------------------------
  // Ground mask

  private rebuild(added: Site[] | null, removed: Site[] | null) {
    // dirty region (cells): changed structures plus the reach of their paths
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const reach = 16; // paths reach ~6 cells out of a factory and up to 9 more to a road
    for (const list of [added, removed]) if (list) for (const s of list) {
      x0 = Math.min(x0, s.cx - reach); y0 = Math.min(y0, s.cy - reach);
      x1 = Math.max(x1, s.cx + s.w + reach); y1 = Math.max(y1, s.cy + s.h + reach);
    }
    const m = this.map;
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
    x1 = Math.min(m.w, Math.ceil(x1)); y1 = Math.min(m.h, Math.ceil(y1));
    if (x1 <= x0 || y1 <= y0) return;
    const R = BASE_RES;
    const ti0 = x0 * R, ti1 = x1 * R - 1, tj0 = y0 * R, tj1 = y1 * R - 1;
    const D = this.terrain.baseData, W = this.W;
    for (let j = tj0; j <= tj1; j++) D.fill(0, (j * W + ti0) * 4, (j * W + ti1 + 1) * 4);
    const clip = { i0: ti0, i1: ti1, j0: tj0, j1: tj1 };
    const sites = [...this.sites.values()];
    const touches = (s: Site, pad: number) => s.cx + s.w + pad > x0 && s.cx - pad < x1 && s.cy + s.h + pad > y0 && s.cy - pad < y1;
    const hide: number[] = [];
    for (const s of sites) if (touches(s, 4)) this.stampSite(s, clip, hide);
    for (const [a, b] of this.paths(sites)) {
      if (Math.max(a.x, b.x) + 2 < x0 || Math.min(a.x, b.x) - 2 > x1 || Math.max(a.y, b.y) + 2 < y0 || Math.min(a.y, b.y) - 2 > y1) continue;
      this.stampPath(a.x, a.y, b.x, b.y, a.seed + b.seed, clip, hide);
    }
    this.terrain.markBase(tj0, tj1);
    if (hide.length) this.opts.hideClutter?.(hide);
    if (this.props) this.rebuildProps(sites);
  }

  /** The lamps really light their surroundings at night (the renderer's dynamic lights: no draw calls). */
  private lightLamps(lamp: number) {
    const dyn = (this.group.parent?.userData.dynamicLights as (DynamicLightApi & { cap: number }) | undefined) ?? null;
    if (dyn !== this.dyn) { this.dyn = dyn; this.lampIds.length = 0; }
    if (!dyn) return; // not in the scene yet: try again next frame
    this.lampLit = lamp;
    if (dyn.cap < 100) return; // low: no dynamic lights
    const P = this.lampPos, ids = this.lampIds;
    for (let k = 0; k * 3 < P.length; k++) {
      if (ids[k] === undefined || ids[k] < 0) ids[k] = dyn.add(P[k * 3], P[k * 3 + 1], P[k * 3 + 2], 0xffb066, 0, 2.6, -1, { priority: 0.3 });
      if (ids[k] >= 0) dyn.update(ids[k], P[k * 3], P[k * 3 + 1], P[k * 3 + 2], lamp * 1.5);
    }
  }

  /** Concrete apron, contact shade and trampled ground around one structure. */
  private stampSite(s: Site, c: { i0: number; i1: number; j0: number; j1: number }, hide: number[]) {
    const R = BASE_RES, D = this.terrain.baseData, W = this.W, m = this.map;
    const bt = s.bt;
    const defense = bt.category === 'defense';
    const big = s.w * s.h >= 6;
    const mg = defense ? 0.22 : big ? 0.55 : s.w * s.h === 1 ? 0.3 : 0.45;
    // apron rectangles: around the footprint, plus a driveway / dock pad in front of a door
    const rects: [number, number, number, number][] = [[s.cx - mg, s.cy - mg, s.cx + s.w + mg, s.cy + s.h + mg + (defense ? 0 : 0.2)]];
    const door = bt.exit ?? bt.dock;
    if (door && !defense) {
      const lane = bt.factory === 'vehicle' || bt.dock ? 1.15 : 0.7;
      rects.push([s.cx + door[0] + 0.5 - lane, s.cy + s.h, s.cx + door[0] + 0.5 + lane, s.cy + s.h + (bt.factory === 'vehicle' || bt.dock ? 1.7 : 1.05)]);
    }
    const worn = defense ? 1.4 : big ? 2.8 : 2.2;
    // concrete never reaches further than this from the footprint (driveways included)
    const apronReach = mg + (door && !defense ? 2.3 : 0.5);
    const fx0 = s.cx, fy0 = s.cy, fx1 = s.cx + s.w, fy1 = s.cy + s.h;
    const i0 = Math.max(c.i0, Math.floor((fx0 - worn - 1) * R)), i1 = Math.min(c.i1, Math.ceil((fx1 + worn + 1) * R));
    const j0 = Math.max(c.j0, Math.floor((fy0 - worn - 1) * R)), j1 = Math.min(c.j1, Math.ceil((fy1 + worn + 2) * R));
    for (let j = j0; j <= j1; j++) {
      const py = (j + 0.5) / R;
      for (let i = i0; i <= i1; i++) {
        const px = (i + 0.5) / R;
        const cell = m.idx(Math.min(m.w - 1, px | 0), Math.min(m.h - 1, py | 0));
        const t = m.terrain[cell];
        if (t === T.Water || t === T.Rock) continue;
        const o = (j * W + i) * 4;
        // distance to the footprint
        const ddx = Math.max(fx0 - px, 0, px - fx1), ddy = Math.max(fy0 - py, 0, py - fy1);
        const d = Math.sqrt(ddx * ddx + ddy * ddy);
        // trampled: strongest at the walls and in front of the door
        const front = py > fy1 ? Math.max(0, 1 - Math.abs(px - s.dx) / (s.w * 0.5 + 1)) * 0.6 : 0;
        const wv = Math.max(0, 1 - d / (worn * (1 + front))) ;
        const wr = Math.round(255 * Math.min(1, wv * wv * (3 - 2 * wv) * 1.1));
        if (wr > D[o]) D[o] = wr;
        // contact shade
        const sh = Math.round(255 * Math.max(0, 1 - d / 0.5));
        if (sh > D[o + 3]) D[o + 3] = sh;
        // concrete: signed distance to the nearest apron rectangle (rounded corners); 0.5 at the edge
        let g = 0;
        if (d < apronReach) {
          for (let q = 0; q < rects.length; q++) {
            const rc = rects[q];
            const cr = 0.22;
            const qx = Math.max(rc[0] + cr - px, 0, px - (rc[2] - cr)), qy = Math.max(rc[1] + cr - py, 0, py - (rc[3] - cr));
            const out = Math.sqrt(qx * qx + qy * qy) - cr;
            const inside = Math.min(px - rc[0], rc[2] - px, py - rc[1], rc[3] - py);
            const v = out > 0 ? 0.5 - out * 2.2 : 0.5 + Math.min(1, inside) * 0.5;
            if (v > g) g = v;
          }
        }
        const gv = Math.round(255 * Math.max(0, Math.min(1, g)));
        if (gv > D[o + 1]) D[o + 1] = gv;
        if (g > 0.5 && !this.cellMark[cell]) { this.cellMark[cell] = 1; hide.push(cell); }
      }
    }
  }

  /**
   * Paths: every structure's door to the doors of its two nearest neighbours (same owner, within 10 cells),
   * plus a lane out of each factory, pointing away from the base. Deterministic for a set of structures.
   */
  private paths(sites: Site[]): [{ x: number; y: number; seed: number }, { x: number; y: number; seed: number }][] {
    const out: [{ x: number; y: number; seed: number }, { x: number; y: number; seed: number }][] = [];
    const done = new Set<string>();
    const byOwner = new Map<number, Site[]>();
    for (const s of sites) { let l = byOwner.get(s.owner); if (!l) byOwner.set(s.owner, (l = [])); l.push(s); }
    for (const list of byOwner.values()) {
      list.sort((a, b) => a.cy - b.cy || a.cx - b.cx);
      let mx = 0, my = 0;
      for (const s of list) { mx += s.cx + s.w / 2; my += s.cy + s.h / 2; }
      mx /= list.length; my /= list.length;
      for (const a of list) {
        const near = list.filter((b) => b !== a && b.bt.category !== 'defense')
          .map((b) => ({ b, d: Math.hypot(b.dx - a.dx, b.dy - a.dy) }))
          .filter((e) => e.d < 10)
          .sort((p, q) => p.d - q.d || p.b.cx - q.b.cx || p.b.cy - q.b.cy)
          .slice(0, a.bt.category === 'defense' ? 1 : 2);
        for (const { b } of near) {
          const key = a.cx < b.cx || (a.cx === b.cx && a.cy < b.cy) ? `${a.cx},${a.cy},${b.cx},${b.cy}` : `${b.cx},${b.cy},${a.cx},${a.cy}`;
          if (done.has(key)) continue;
          done.add(key);
          out.push([{ x: a.dx, y: a.dy, seed: a.seed }, { x: b.dx, y: b.dy, seed: b.seed }]);
        }
        if (a.bt.factory && a.bt.factory !== 'building' && a.bt.factory !== 'aircraft') {
          // the lane units leave by: south, bent away from the middle of the base
          let vx = a.dx - mx, vy = Math.max(0.5, a.dy - my);
          const l = Math.hypot(vx, vy) || 1;
          vx = vx / l * 0.5; vy = vy / l * 0.5 + 0.8;
          const L = a.bt.factory === 'vehicle' ? 6 : 4;
          const ex = a.dx + vx * L, ey = a.dy + vy * L;
          out.push([{ x: a.dx, y: a.dy, seed: a.seed }, { x: ex, y: ey, seed: a.seed + 1 }]);
          // ... and on to the road network when a road passes close by (roads.ts)
          const r = this.nearestRoad(ex, ey, 9);
          if (r && Math.hypot(r[0] - ex, r[1] - ey) > 0.8) out.push([{ x: ex, y: ey, seed: a.seed + 1 }, { x: r[0], y: r[1], seed: a.seed + 2 }]);
        }
      }
    }
    return out;
  }

  /** The nearest point of a main road's centre line within `reach` cells of (x, y), or null. */
  private nearestRoad(x: number, y: number, reach: number): [number, number] | null {
    let best: [number, number] | null = null, bd = reach;
    for (const s of roadsFor(this.map).segments) {
      if (s.kind !== 'main') continue;
      for (const p of s.points) {
        const d = Math.hypot(p[0] - x, p[1] - y);
        if (d < bd) { bd = d; best = p; }
      }
    }
    return best;
  }

  private stampPath(ax: number, ay: number, bx: number, by: number, seed: number, c: { i0: number; i1: number; j0: number; j1: number }, hide: number[]) {
    const R = BASE_RES, D = this.terrain.baseData, W = this.W, m = this.map;
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 0.5) return;
    // a gentle bend
    const bend = (hash2(seed, 3, 77) - 0.5) * 0.3 * len;
    const mx = (ax + bx) / 2 + (-(by - ay) / len) * bend, my = (ay + by) / 2 + ((bx - ax) / len) * bend;
    const steps = Math.ceil(len * 3);
    const core = 0.32, shoulder = 1.05;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps, u = 1 - t;
      const px = u * u * ax + 2 * u * t * mx + t * t * bx;
      const py = u * u * ay + 2 * u * t * my + t * t * by;
      const wob = 1 + (hash2(seed, k >> 2, 9) - 0.5) * 0.3;

      const i0 = Math.max(c.i0, Math.floor((px - shoulder) * R)), i1 = Math.min(c.i1, Math.ceil((px + shoulder) * R));
      const j0 = Math.max(c.j0, Math.floor((py - shoulder) * R)), j1 = Math.min(c.j1, Math.ceil((py + shoulder) * R));
      for (let j = j0; j <= j1; j++) {
        const qy = (j + 0.5) / R;
        for (let i = i0; i <= i1; i++) {
          const qx = (i + 0.5) / R;
          const cx = Math.min(m.w - 1, qx | 0), cy = Math.min(m.h - 1, qy | 0);
          const cell = m.idx(cx, cy);
          const tt = m.terrain[cell];
          if (tt === T.Water || tt === T.Rock || m.oreField[cell]) continue;
          const ex = qx - px, ey = qy - py;
          const d2 = ex * ex + ey * ey;
          if (d2 > shoulder * shoulder) continue;
          const d = Math.sqrt(d2);
          const o = (j * W + i) * 4;
          // r: worn shoulder; b: closeness to the centre line (1 - d / PATH_W), the shader draws the packed
          // track and its twin wheel ruts from it
          const sv = Math.round(255 * (1 - d / shoulder) * 0.85 * wob);
          if (sv > D[o]) D[o] = sv;
          const cv = Math.round(255 * Math.max(0, 1 - d / PATH_W));
          if (cv > D[o + 2]) D[o + 2] = cv;
          if (d < core && !this.cellMark[cell] && !m.occupant[cell]) { this.cellMark[cell] = 1; hide.push(cell); }
        }
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // Props

  private rebuildProps(sites: Site[]) {
    this.protos ??= buildProtos(this.opts.climate);
    const props: Prop[] = [];
    const wires: Wire[] = [];
    const occupiedBy = new Map<number, number>();
    for (const s of sites) for (let y = s.cy; y < s.cy + s.h; y++) for (let x = s.cx; x < s.cx + s.w; x++) occupiedBy.set(this.map.idx(x, y), s.id);
    // each owner's base centre (fences go on the sides facing away from it)
    const centres = new Map<number, [number, number, number]>();
    for (const s of sites) {
      const c = centres.get(s.owner) ?? [0, 0, 0];
      c[0] += s.cx + s.w / 2; c[1] += s.cy + s.h / 2; c[2]++;
      centres.set(s.owner, c);
    }
    for (const c of centres.values()) { c[0] /= c[2]; c[1] /= c[2]; }
    for (const s of sites) { const c = centres.get(s.owner)!; this.dressSite(s, props, occupiedBy, [c[0], c[1]]); }
    this.powerLines(sites, props, wires, occupiedBy);
    // group by chunk; a chunk is rebuilt only if its contents changed
    const nx = Math.ceil(this.map.w / CHUNK);
    const groups = new Map<number, { props: Prop[]; wires: Wire[] }>();
    const g = (x: number, y: number) => {
      const k = Math.floor(Math.max(0, y) / CHUNK) * nx + Math.floor(Math.max(0, x) / CHUNK);
      let e = groups.get(k);
      if (!e) groups.set(k, (e = { props: [], wires: [] }));
      return e;
    };
    for (const p of props) g(p.x, p.y).props.push(p);
    const st = this.stats;
    st.sites = sites.length;
    st.kinds.fill(0);
    for (const p of props) st.kinds[p.k]++;
    st.wires = wires.length;
    // lamp lights follow the lamp set
    if (this.dyn) for (const id of this.lampIds) if (id >= 0) this.dyn.remove(id);
    this.lampIds.length = 0;
    this.lampPos.length = 0;
    for (const p of props) {
      if (p.k !== K.Lamp) continue;
      this.lampPos.push(p.x + Math.cos(p.rot) * 0.2, this.terrain.renderHeight(p.x, p.y) + 0.95, p.y - Math.sin(p.rot) * 0.2);
    }
    this.lampLit = -1;
    for (const w of wires) g((w.x0 + w.x1) / 2, (w.z0 + w.z1) / 2).wires.push(w);
    for (const [k, ch] of this.chunks) {
      if (!groups.has(k)) { this.group.remove(ch.mesh); ch.mesh.geometry.dispose(); this.chunks.delete(k); }
    }
    for (const [k, e] of groups) {
      let key = '';
      for (const p of e.props) key += `${p.k}${p.v}${p.x.toFixed(2)}${p.y.toFixed(2)};`;
      for (const w of e.wires) key += `w${w.x0.toFixed(2)}${w.z0.toFixed(2)}${w.x1.toFixed(2)}${w.z1.toFixed(2)};`;
      const old = this.chunks.get(k);
      if (old && old.key === key) continue;
      const geo = this.buildGeometry(e.props, e.wires);
      if (old) {
        old.mesh.geometry.dispose();
        old.mesh.geometry = geo;
        old.key = key;
      } else {
        const mesh = new THREE.Mesh(geo, this.material);
        mesh.name = 'base-dressing-chunk';
        mesh.castShadow = this.opts.quality === 'high';
        mesh.receiveShadow = true;
        if (mesh.castShadow) mesh.customDepthMaterial = shadowDepthMaterial(mesh);
        mesh.matrixAutoUpdate = false;
        mesh.matrixWorldAutoUpdate = false;
        mesh.raycast = () => {}; // never picked
        this.group.add(mesh);
        mesh.updateMatrixWorld(true);
        this.chunks.set(k, { mesh, key });
      }
    }
    st.chunks = this.chunks.size;
    st.triangles = 0;
    for (const ch of this.chunks.values()) st.triangles += ch.mesh.geometry.attributes.position.count / 3;
  }

  /** Can a prop stand at (x, y)? Not on water / rock / trees / ore / paths / docks, nor in another footprint. */
  private free(x: number, y: number, own: number, occupiedBy: Map<number, number>, pathOk = false): boolean {
    const m = this.map;
    const cx = Math.floor(x), cy = Math.floor(y);
    if (cx < 0 || cy < 0 || cx >= m.w || cy >= m.h) return false;
    const i = m.idx(cx, cy);
    const t = m.terrain[i];
    if (t === T.Water || t === T.Rock || m.tree[i] || m.oreField[i] || m.reserved[i]) return false;
    const occ = occupiedBy.get(i);
    if (occ !== undefined && occ !== own) return false;
    if (m.occupant[i] && occ === undefined) return false; // walls etc.
    if (!pathOk) {
      const R = BASE_RES;
      const ti = Math.min(this.W - 1, Math.floor(x * R)), tj = Math.min(this.H - 1, Math.floor(y * R));
      if (this.terrain.baseData[(tj * this.W + ti) * 4 + 2] > 255 * (1 - 0.42 / PATH_W)) return false;
    }
    return true;
  }

  private dressSite(s: Site, out: Prop[], occupiedBy: Map<number, number>, centre: [number, number]) {
    const bt = s.bt;
    const r = (k: number) => hash2(s.seed, k, 991);
    const dens = this.density;
    const put = (k: K, v: number, x: number, y: number, rot: number, sc = 1, sy = 1, pathOk = false) => {
      if (!this.free(x, y, s.id, occupiedBy, pathOk)) return false;
      out.push({ k, v, x, y, rot, s: sc, sy });
      return true;
    };
    const fx0 = s.cx, fy0 = s.cy, fx1 = s.cx + s.w, fy1 = s.cy + s.h;
    const defense = bt.category === 'defense';
    const fac = s.soviet ? 0 : 1;
    if (defense) {
      // sandbag piles hugging the front corners
      if (r(1) < 0.85 * dens + 0.15) put(K.Sandbag, 0, fx0 - 0.05, fy1 + 0.12, -0.6 + r(2) * 0.3, 0.9, 1);
      if (r(3) < 0.6 * dens) put(K.Sandbag, 0, fx1 + 0.05, fy1 + 0.12, 0.6 - r(4) * 0.3, 0.9, 1);
      if (r(5) < 0.4 * dens) put(K.Barrel, 1 + (r(6) * 3 | 0), fx1 + 0.12, fy0 + 0.15, r(7) * 6.28);
      return;
    }
    // a cluster of clutter at an anchor: crates, a tarp stack, barrels
    const cluster = (ax: number, ay: number, kind: number, seed: number) => {
      const q = (k: number) => hash2(s.seed + seed, k, 313);
      const rot = q(0) * 6.28;
      if (kind === 0) {
        // crate stack: two or three, maybe one on top
        const v = (q(1) * 3) | 0;
        put(K.Crate, v, ax, ay, rot);
        if (put(K.Crate, (v + (q(2) < 0.5 ? 0 : 1)) % 3, ax + Math.cos(rot) * 0.29, ay + Math.sin(rot) * 0.29, rot + (q(3) - 0.5) * 0.4) && q(4) < 0.45) {
          // one more on top (sy < 0: stacked, lifted by a crate height in buildGeometry)
          out.push({ k: K.Crate, v, x: ax + Math.cos(rot) * 0.14 + 0.01, y: ay + Math.sin(rot) * 0.14, rot: rot + 0.3, s: 0.92, sy: -1 });
        }
      } else if (kind === 1) {
        put(K.Tarp, (q(1) * 3) | 0, ax, ay, rot + (q(2) < 0.5 ? 0 : Math.PI / 2));
      } else {
        // barrels / fuel drums: a tight group of 2-5 of one colour (sometimes a stray of another)
        const v = s.soviet ? (q(1) < 0.6 ? 0 : 3) : (q(1) < 0.5 ? 2 : 1);
        const n = 2 + ((q(2) * 4) | 0);
        for (let k = 0; k < n; k++) {
          const a = k * 2.4 + q(3) * 6, rr = k === 0 ? 0 : 0.15 + (k > 3 ? 0.13 : 0);
          put(K.Barrel, q(10 + k) < 0.15 ? 4 : v, ax + Math.cos(a) * rr, ay + Math.sin(a) * rr, q(20 + k) * 6.28, 1, 0.92 + q(30 + k) * 0.16);
        }
      }
    };
    // anchor points just outside the walls (never the door side's middle)
    const anchors: [number, number][] = [
      [fx0 - 0.2, fy0 + 0.35], [fx1 + 0.2, fy0 + 0.35], [fx0 + 0.4, fy0 - 0.2], [fx1 - 0.4, fy0 - 0.2],
      [fx0 - 0.2, fy1 - 0.35], [fx1 + 0.2, fy1 - 0.35], [fx0 + 0.3, fy1 + 0.22], [fx1 - 0.3, fy1 + 0.22],
    ];
    const big = s.w * s.h >= 6;
    let want = Math.round((big ? 3 : s.w * s.h > 1 ? 2 : 1) * dens + r(8) * 0.8);
    if (s.type === 'proc' || s.type === 'weap' || s.type === 'fix' || s.type === 'hpad' || s.type === 'afld') want += 1;
    for (let k = 0; k < 8 && want > 0; k++) {
      const a = anchors[(k * 3 + ((r(9) * 8) | 0)) % 8];
      // keep the door clear
      if (Math.abs(a[0] - s.dx) < 0.9 && a[1] > fy1 - 0.4) continue;
      const kind = s.type === 'powr' || s.type === 'apwr' || s.type === 'hpad' || s.type === 'afld' ? (r(10 + k) < 0.7 ? 2 : 0)
        : r(10 + k) < 0.45 ? 0 : r(10 + k) < 0.7 ? 1 : 2;
      const before = out.length;
      cluster(a[0], a[1], kind, k * 17);
      if (out.length > before) want--;
    }
    // lamp posts at the front corners of the apron (factories: flanking the door)
    const lampN = big ? 2 : r(11) < 0.5 * dens ? 1 : 0;
    const lampXs = bt.factory === 'vehicle' || bt.dock ? [s.dx - 1.35, s.dx + 1.35] : [fx0 - 0.3, fx1 + 0.3];
    for (let k = 0; k < lampN; k++) {
      const lx = lampXs[(k + ((r(12) * 2) | 0)) % 2];
      put(K.Lamp, 0, lx, fy1 + 0.35, lx < s.dx ? 0 : Math.PI, 1, 1, true);
    }
    // barracks: sandbags flanking the door
    if (bt.factory === 'infantry' && s.w > 1) {
      put(K.Sandbag, 0, s.dx - 0.95, fy1 + 0.18, -0.25, 0.85);
      if (r(13) < 0.7) put(K.Sandbag, 0, s.dx + 0.95, fy1 + 0.18, 0.25, 0.85);
    }
    // fences on the sides that face out of the base (the compound's perimeter), where open ground lies beyond;
    // gaps where paths cross and at the door
    if (s.w * s.h >= 4 && r(14) < 0.75 * dens + 0.15) {
      const vx = s.cx + s.w / 2 - centre[0], vy = s.cy + s.h / 2 - centre[1];
      const vl = Math.hypot(vx, vy) || 1;
      const off = (big ? 0.55 : 0.45) + 0.14;
      const sides: [number, number][] = [[0, -1], [-1, 0], [1, 0], [0, 1]];
      for (const [nx, ny] of sides) {
        if ((nx * vx + ny * vy) / vl < 0.3 && vl > 1.5) continue;
        // open ground beyond: no other structure within two cells of this side
        let open = true;
        const horiz = ny !== 0;
        const lineC = horiz ? (ny < 0 ? fy0 - off : fy1 + off + 0.2) : (nx < 0 ? fx0 - off : fx1 + off);
        const a0 = horiz ? fx0 - off : fy0 - off, a1 = horiz ? fx1 + off : fy1 + off;
        for (let t = a0 + 0.5; t < a1 && open; t += 1) {
          for (const d of [0.6, 1.6]) {
            const px = horiz ? t : lineC + nx * d, py = horiz ? lineC + ny * d : t;
            const cx = Math.floor(px), cy = Math.floor(py);
            if (!this.map.inBounds(cx, cy)) { open = false; break; }
            const o = occupiedBy.get(this.map.idx(cx, cy));
            if (o !== undefined && o !== s.id) { open = false; break; }
          }
        }
        if (!open) continue;
        const n = Math.max(1, Math.round(a1 - a0));
        const step = (a1 - a0) / n;
        let run = false;
        for (let k = 0; k <= n; k++) {
          const t0 = a0 + k * step, tm = t0 + step / 2;
          const mx = horiz ? tm : lineC, my = horiz ? lineC : tm;
          const door = ny > 0 && Math.abs(tm - s.dx) < 1.3;
          const ok = k < n && !door && this.free(mx, my, s.id, occupiedBy);
          const px = horiz ? t0 : lineC, py = horiz ? lineC : t0;
          if (ok) {
            out.push({ k: K.Fence, v: fac, x: px, y: py, rot: horiz ? 0 : -Math.PI / 2, s: step, sy: 1 });
            run = true;
          } else if (run) {
            out.push({ k: K.Post, v: fac, x: px, y: py, rot: 0, s: 1, sy: 1 });
            run = false;
          }
        }
      }
    }
  }

  /** Poles at a structure's corners and wires from each power plant to its nearest consumers. */
  private powerLines(sites: Site[], out: Prop[], wires: Wire[], occupiedBy: Map<number, number>) {
    const plants = sites.filter((s) => s.bt.power > 0 && (s.type === 'powr' || s.type === 'apwr'));
    if (!plants.length) return;
    const poles: { x: number; y: number; dir: number; site: number }[] = [];
    const poleNear = (x: number, y: number) => poles.find((p) => Math.hypot(p.x - x, p.y - y) < 0.7);
    const corner = (s: Site, tx: number, ty: number) => {
      // the footprint corner facing the target, pushed out diagonally into the walkway
      const cx = tx < s.cx + s.w / 2 ? s.cx - 0.28 : s.cx + s.w + 0.28;
      const cy = ty < s.cy + s.h / 2 ? s.cy - 0.28 : s.cy + s.h + 0.28;
      return [cx, cy] as const;
    };
    const addPole = (x: number, y: number, dir: number, site: number) => {
      const near = poleNear(x, y);
      if (near) return near;
      if (!this.free(x, y, site, occupiedBy, true)) return null;
      const p = { x, y, dir, site };
      poles.push(p);
      return p;
    };
    const done = new Set<string>();
    for (const p of plants) {
      const targets = sites
        .filter((s) => s !== p && s.owner === p.owner && s.bt.category !== 'defense' || (s !== p && s.owner === p.owner && (s.type === 'tsla' || s.type === 'gap')))
        .map((s) => ({ s, d: Math.hypot(s.cx + s.w / 2 - p.cx - p.w / 2, s.cy + s.h / 2 - p.cy - p.h / 2) }))
        .filter((e) => e.d < 11)
        .sort((a, b) => a.d - b.d || a.s.cx - b.s.cx || a.s.cy - b.s.cy)
        .slice(0, this.opts.quality === 'high' ? 2 : 1);
      for (const { s } of targets) {
        const key = p.id < s.id ? `${p.id}-${s.id}` : `${s.id}-${p.id}`;
        if (done.has(key)) continue;
        done.add(key);
        const tx = s.cx + s.w / 2, ty = s.cy + s.h / 2, px = p.cx + p.w / 2, py = p.cy + p.h / 2;
        const [ax, ay] = corner(p, tx, ty);
        const [bx, by] = corner(s, px, py);
        const dir = Math.atan2(by - ay, bx - ax);
        const A = addPole(ax, ay, dir, p.id);
        const B = addPole(bx, by, dir, s.id);
        if (!A || !B) continue;
        // a line through another structure would clip it: skip those
        const len = Math.hypot(B.x - A.x, B.y - A.y);
        if (len < 1.2 || len > 13) continue;
        let blocked = false;
        for (let t = 0.12; t < 0.9 && !blocked; t += 0.08) {
          const o = occupiedBy.get(this.map.idx(Math.floor(A.x + (B.x - A.x) * t), Math.floor(A.y + (B.y - A.y) * t)));
          if (o !== undefined && o !== p.id && o !== s.id) blocked = true;
        }
        if (blocked) continue;
        // long spans get a pole in the middle
        let chain = [A, B];
        if (len > 6.5) {
          const M = addPole((A.x + B.x) / 2, (A.y + B.y) / 2, dir, -1);
          if (M) chain = [A, M, B];
        }
        for (let k = 0; k + 1 < chain.length; k++) this.wire(chain[k], chain[k + 1], wires);
      }
    }
    for (const p of poles) out.push({ k: K.Pole, v: 0, x: p.x, y: p.y, rot: -p.dir + Math.PI / 2, s: 1, sy: 1 });
  }

  private wire(a: { x: number; y: number; dir: number }, b: { x: number; y: number; dir: number }, wires: Wire[]) {
    const ha = this.terrain.renderHeight(a.x, a.y), hb = this.terrain.renderHeight(b.x, b.y);
    // the crossarm runs across the pole's own span direction: attach at its ends and middle
    const offs = [-0.18, 0.18];
    const pa = -a.dir + Math.PI / 2, pb = -b.dir + Math.PI / 2;
    for (const o of offs) {
      wires.push({
        x0: a.x + Math.cos(pa) * o, y0: ha + 1.43, z0: a.y - Math.sin(pa) * o,
        x1: b.x + Math.cos(pb) * o, y1: hb + 1.43, z1: b.y - Math.sin(pb) * o,
      });
    }
  }

  private buildGeometry(props: Prop[], wires: Wire[]): THREE.BufferGeometry {
    const P = this.protos!;
    const SEG = 6;
    let n = 0;
    for (const p of props) n += P[p.k][p.v % P[p.k].length].n;
    n += wires.length * SEG * 12;
    const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), col = new Float32Array(n * 3), glow = new Float32Array(n);
    let o = 0;
    for (const p of props) {
      const pr = P[p.k][p.v % P[p.k].length];
      const c = Math.cos(p.rot), s = Math.sin(p.rot);
      const stacked = p.sy < 0;
      const sx = p.s, sy = stacked ? 1 : p.sy, sz = p.k === K.Fence ? 1 : p.s;
      const base = this.terrain.renderHeight(p.x, p.y) - 0.01 + (stacked ? 0.22 : 0);
      const tint = 0.9 + hash2(Math.round(p.x * 13), Math.round(p.y * 13), 5) * 0.2;
      for (let i = 0; i < pr.n; i++, o++) {
        const lx = pr.pos[i * 3] * sx, ly = pr.pos[i * 3 + 1] * sy, lz = pr.pos[i * 3 + 2] * sz;
        pos[o * 3] = p.x + lx * c + lz * s;
        pos[o * 3 + 1] = base + ly;
        pos[o * 3 + 2] = p.y - lx * s + lz * c;
        let nx = pr.nrm[i * 3] / sx, ny = pr.nrm[i * 3 + 1] / sy, nz = pr.nrm[i * 3 + 2] / sz;
        const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        nx /= l; ny /= l; nz /= l;
        nrm[o * 3] = nx * c + nz * s;
        nrm[o * 3 + 1] = ny;
        nrm[o * 3 + 2] = -nx * s + nz * c;
        col[o * 3] = pr.col[i * 3] * tint;
        col[o * 3 + 1] = pr.col[i * 3 + 1] * tint;
        col[o * 3 + 2] = pr.col[i * 3 + 2] * tint;
        glow[o] = pr.glow[i];
      }
    }
    // wires: sagging ribbons (a flat and an upright strip, so they read from any angle)
    const ww = 0.014;
    const put = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => {
      pos[o * 3] = x; pos[o * 3 + 1] = y; pos[o * 3 + 2] = z;
      nrm[o * 3] = nx; nrm[o * 3 + 1] = ny; nrm[o * 3 + 2] = nz;
      col[o * 3] = 0.05; col[o * 3 + 1] = 0.05; col[o * 3 + 2] = 0.055;
      glow[o] = 0;
      o++;
    };
    for (const w of wires) {
      const dx = w.x1 - w.x0, dz = w.z1 - w.z0;
      const L = Math.hypot(dx, dz) || 1;
      const px = -dz / L * ww, pz = dx / L * ww;
      const sag = 0.1 + L * 0.025;
      const at = (t: number, out: number[]) => {
        out[0] = w.x0 + dx * t; out[1] = w.y0 + (w.y1 - w.y0) * t - sag * 4 * t * (1 - t); out[2] = w.z0 + dz * t;
      };
      const a = [0, 0, 0], b = [0, 0, 0];
      for (let k = 0; k < SEG; k++) {
        at(k / SEG, a); at((k + 1) / SEG, b);
        // flat strip
        put(a[0] - px, a[1], a[2] - pz, 0, 1, 0); put(b[0] - px, b[1], b[2] - pz, 0, 1, 0); put(b[0] + px, b[1], b[2] + pz, 0, 1, 0);
        put(a[0] - px, a[1], a[2] - pz, 0, 1, 0); put(b[0] + px, b[1], b[2] + pz, 0, 1, 0); put(a[0] + px, a[1], a[2] + pz, 0, 1, 0);
        // upright strip
        const nx = -dz / L, nz = dx / L;
        put(a[0], a[1] - ww, a[2], nx, 0, nz); put(b[0], b[1] - ww, b[2], nx, 0, nz); put(b[0], b[1] + ww, b[2], nx, 0, nz);
        put(a[0], a[1] - ww, a[2], nx, 0, nz); put(b[0], b[1] + ww, b[2], nx, 0, nz); put(a[0], a[1] + ww, a[2], nx, 0, nz);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aGlow', new THREE.BufferAttribute(glow, 1));
    geo.computeBoundingSphere();
    return geo;
  }

  dispose() {
    if (this.dyn) for (const id of this.lampIds) if (id >= 0) this.dyn.remove(id);
    this.lampIds.length = 0;
    for (const ch of this.chunks.values()) ch.mesh.geometry.dispose();
    this.chunks.clear();
    this.material.dispose();
    this.group.removeFromParent();
  }
}
