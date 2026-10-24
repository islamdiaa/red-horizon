import * as THREE from 'three';
import { assetUrl } from '../platform/paths';
import { prefetchOffline } from '../platform/prefetch';

/**
 * Scanned terrain materials (CC0 Poly Haven scans baked by tools/assets/terrain/build.mjs into
 * public/textures/terrain/): the per-climate layer sets the terrain shader blends, and their loading into two
 * texture arrays (albedo; normal X/Y + height + roughness).
 *
 * Every climate fills the same ten slots, so the shader logic is climate-independent: "road" is asphalt in the
 * temperate climate, ploughed asphalt under packed snow in winter and packed sand in the desert, and so on.
 * Medium and High quality use the textures; Low keeps the procedural shading (no downloads).
 */

export type Climate = 'temperate' | 'winter' | 'desert' | 'tropical';

/** Layer slots (texture array layers), the same in every climate. */
export const SLOT = {
  /** main ground: grass / snow / sand dunes */
  Ground: 0,
  /** ground variation: meadow / wind-packed snow / cracked earth */
  Ground2: 1,
  /** bare ground, trampled paths, dirt tracks */
  Dirt: 2,
  /** rock and cliffs */
  Rock: 3,
  /** sand (Sand cells, lake beds) */
  Sand: 4,
  /** pebbles: river banks, road shoulders */
  Gravel: 5,
  /** main road surface */
  Road: 6,
  /** wet mud: shorelines, churned craters */
  Mud: 7,
  /** snow cover (weather snow, peaks, ledges) */
  Snow: 8,
  /** concrete aprons around structures */
  Concrete: 9,
} as const;
export type Slot = (typeof SLOT)[keyof typeof SLOT];
export const LAYER_COUNT = 10;

export interface LayerDef {
  /** baked material name (public/textures/terrain/<mat>.*.webp) */
  mat: string;
  /** world units (map cells) per texture repeat */
  tile: number;
  /** sRGB colour the layer is graded towards (the climate's art direction) */
  target: [number, number, number];
  /** 0 = the scan's own colour, 1 = fully graded to `target` (on average) */
  grade: number;
  /** height-blend strength: how far the material's high parts (stones, tufts) poke through its neighbours */
  hb: number;
  /** normal-map strength */
  nstr: number;
}

const L = (mat: string, tile: number, target: [number, number, number], grade: number, hb = 0.4, nstr = 1): LayerDef => ({ mat, tile, target, grade, hb, nstr });

/** The ten layers of every climate, in SLOT order. */
export const CLIMATE_LAYERS: Record<Climate, LayerDef[]> = {
  temperate: [
    L('grass', 3.2, [0.34, 0.4, 0.19], 0.8, 0.35, 1.0),
    L('meadow', 3.6, [0.4, 0.42, 0.24], 0.65, 0.4, 1.0),
    L('dirt', 3.0, [0.43, 0.35, 0.25], 0.4, 0.55, 1.1),
    L('rock', 4.5, [0.45, 0.42, 0.38], 0.75, 0.6, 1.3),
    L('sand', 3.4, [0.64, 0.57, 0.45], 0.55, 0.3, 0.9),
    L('gravel', 2.2, [0.5, 0.47, 0.43], 0.3, 0.8, 1.2),
    L('asphalt', 3.6, [0.3, 0.3, 0.3], 0.6, 0.25, 0.9),
    L('mud', 3.0, [0.28, 0.24, 0.19], 0.4, 0.35, 1.0),
    L('snow', 4.5, [0.86, 0.9, 0.95], 0.95, 0.2, 0.8),
    L('concrete', 4.0, [0.53, 0.52, 0.5], 0.85, 0.2, 0.7),
  ],
  winter: [
    L('snow', 4.5, [0.83, 0.87, 0.93], 0.95, 0.2, 0.9),
    L('snow_wind', 5.0, [0.76, 0.8, 0.87], 0.9, 0.25, 1.0),
    L('frozen_dirt', 3.4, [0.5, 0.5, 0.51], 0.45, 0.55, 1.1),
    L('rock', 4.5, [0.34, 0.35, 0.38], 0.85, 0.6, 1.3),
    L('shore_grey', 3.2, [0.42, 0.42, 0.42], 0.5, 0.35, 1.0),
    L('gravel', 2.2, [0.5, 0.5, 0.52], 0.45, 0.8, 1.2),
    L('asphalt_snow', 3.4, [0.5, 0.52, 0.56], 0.6, 0.3, 1.0),
    L('frozen_mud', 3.0, [0.34, 0.32, 0.31], 0.45, 0.45, 1.0),
    L('snow_wind', 5.0, [0.88, 0.91, 0.96], 0.95, 0.2, 0.9),
    L('concrete', 4.0, [0.5, 0.51, 0.53], 0.85, 0.2, 0.7),
  ],
  desert: [
    L('dune', 4.0, [0.8, 0.66, 0.45], 0.75, 0.25, 1.0),
    L('cracked_earth', 4.6, [0.74, 0.6, 0.43], 0.45, 0.45, 1.0),
    L('desert_dirt', 3.0, [0.62, 0.47, 0.32], 0.45, 0.55, 1.1),
    L('sandstone', 5.0, [0.64, 0.44, 0.31], 0.45, 0.6, 1.3),
    L('shore_sand', 3.4, [0.86, 0.75, 0.55], 0.6, 0.3, 0.9),
    L('desert_gravel', 2.4, [0.56, 0.46, 0.35], 0.4, 0.7, 1.1),
    L('packed_sand', 3.6, [0.68, 0.55, 0.39], 0.55, 0.3, 0.9),
    L('mud', 3.0, [0.36, 0.29, 0.21], 0.4, 0.35, 1.0),
    L('snow', 4.5, [0.86, 0.9, 0.95], 0.95, 0.2, 0.8),
    L('concrete', 4.0, [0.63, 0.58, 0.51], 0.85, 0.2, 0.7),
  ],
  // World Conquest (MAPS): no new textures, the existing scans recombined and graded: deep jungle grass, dark
  // forest earth, muted laterite roads (ore stays the only orange), mossy rock, pale beach sand, dark wet mud
  tropical: [
    L('grass', 3.0, [0.19, 0.33, 0.1], 0.88, 0.35, 1.05),
    L('meadow', 3.4, [0.26, 0.37, 0.12], 0.78, 0.4, 1.0),
    L('desert_dirt', 3.0, [0.33, 0.24, 0.16], 0.6, 0.55, 1.1),
    L('rock', 4.5, [0.35, 0.37, 0.3], 0.82, 0.6, 1.3),
    L('shore_sand', 3.4, [0.8, 0.72, 0.54], 0.62, 0.3, 0.9),
    L('gravel', 2.2, [0.42, 0.38, 0.32], 0.4, 0.8, 1.2),
    L('packed_sand', 3.6, [0.44, 0.3, 0.21], 0.62, 0.3, 0.9),
    L('mud', 3.0, [0.23, 0.16, 0.1], 0.5, 0.35, 1.0),
    L('snow', 4.5, [0.86, 0.9, 0.95], 0.95, 0.2, 0.8),
    L('concrete', 4.0, [0.55, 0.54, 0.5], 0.85, 0.2, 0.7),
  ],
};

/**
 * Average albedo (sRGB) of each baked material, as written to the manifest by the build: the placeholder colour
 * of a layer until its textures arrive, and the reference the grading is computed from.
 */
export const MATERIAL_AVG: Record<string, [number, number, number]> = {
  asphalt: [0.52, 0.51, 0.49], asphalt_snow: [0.48, 0.46, 0.48], concrete: [0.47, 0.412, 0.344], cracked_earth: [0.762, 0.622, 0.477],
  desert_dirt: [0.498, 0.386, 0.263], desert_gravel: [0.478, 0.378, 0.287], dirt: [0.407, 0.345, 0.264],
  dune: [0.634, 0.574, 0.427], frozen_dirt: [0.472, 0.439, 0.407], frozen_mud: [0.337, 0.295, 0.23],
  grass: [0.563, 0.488, 0.333], gravel: [0.479, 0.442, 0.397], meadow: [0.503, 0.466, 0.33], mud: [0.294, 0.261, 0.211],
  packed_sand: [0.47, 0.342, 0.246], rock: [0.505, 0.405, 0.31], sand: [0.507, 0.448, 0.359], sandstone: [0.49, 0.329, 0.199],
  shore_grey: [0.244, 0.216, 0.168], shore_sand: [0.571, 0.498, 0.386], snow: [0.593, 0.593, 0.6], snow_wind: [0.708, 0.698, 0.693],
};

/**
 * Test hook: `?terrain=classic` keeps the procedural ground shading on every preset, `?nature=classic` the
 * procedural trees and rocks (A/B screenshots and benchmarks).
 */
export function classicLook(what: 'terrain' | 'nature'): boolean {
  try {
    return typeof location !== 'undefined' && new URLSearchParams(location.search).get(what) === 'classic';
  } catch {
    return false;
  }
}

const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/**
 * Linear-space multiplier that grades a layer: `grade` of the way (geometrically) from the scan's average
 * colour to the climate's target colour.
 */
export function layerTint(def: LayerDef, avg: [number, number, number] = MATERIAL_AVG[def.mat] ?? [0.5, 0.5, 0.5]): [number, number, number] {
  return [0, 1, 2].map((k) => Math.pow(lin(def.target[k]) / Math.max(1e-4, lin(avg[k])), def.grade)) as [number, number, number];
}

/** Which material each slot uses in a climate (tests, tools). */
export function climateMaterials(climate: Climate): string[] {
  return CLIMATE_LAYERS[climate].map((l) => l.mat);
}

/** Per-layer shader uniforms: uLayT[i] = (tint rgb, 1 / tile), uLayP[i] = (height blend, normal strength, 0, 0). */
export function layerUniforms(climate: Climate): { T: THREE.Vector4[]; P: THREE.Vector4[] } {
  const defs = CLIMATE_LAYERS[climate];
  return {
    T: defs.map((d) => { const t = layerTint(d); return new THREE.Vector4(t[0], t[1], t[2], 1 / d.tile); }),
    P: defs.map((d) => new THREE.Vector4(d.hb, d.nstr, 0, 0)),
  };
}

// ---------------------------------------------------------------------------------------------------------
// Loading: texture arrays shared by every terrain of a climate (the editor rebuilds terrains in place)

interface Manifest {
  version: number;
  size: number;
  materials: Record<string, { avg: [number, number, number]; files: { albedo: { file: string; hash: string }; nrm: { file: string; hash: string } } }>;
}

export type TerrainTextureState = 'loading' | 'ready' | 'failed';
const NO_BROWSER = 'no image decoder';

/** The two texture arrays of a climate: albedo (sRGB) and normal / height / roughness. */
export class TerrainTextureSet {
  /** Swapped from the 4x4 placeholders to the real arrays once loaded (shader uniforms hold these objects). */
  readonly albedo = { value: null as unknown as THREE.DataArrayTexture };
  readonly nrm = { value: null as unknown as THREE.DataArrayTexture };
  state: TerrainTextureState = 'loading';
  /** Resolves when the real textures are in place (or failed: the placeholders stay). */
  readonly ready: Promise<void>;
  bytes = 0;
  refs = 0;
  private placeholders: THREE.DataArrayTexture[];

  constructor(readonly climate: Climate, anisotropy: number) {
    const defs = CLIMATE_LAYERS[climate];
    // placeholders: each layer's average colour, a flat normal, mid height, rough
    const S = 4, n = S * S;
    const a = new Uint8Array(n * 4 * LAYER_COUNT), b = new Uint8Array(n * 4 * LAYER_COUNT);
    defs.forEach((d, li) => {
      const avg = MATERIAL_AVG[d.mat] ?? [0.5, 0.5, 0.5];
      for (let k = 0; k < n; k++) {
        const o = (li * n + k) * 4;
        a[o] = Math.round(avg[0] * 255); a[o + 1] = Math.round(avg[1] * 255); a[o + 2] = Math.round(avg[2] * 255); a[o + 3] = 255;
        b[o] = 128; b[o + 1] = 128; b[o + 2] = 128; b[o + 3] = 236;
      }
    });
    this.albedo.value = makeArray(a, S, LAYER_COUNT, true, 1);
    this.nrm.value = makeArray(b, S, LAYER_COUNT, false, 1);
    this.placeholders = [this.albedo.value, this.nrm.value];
    this.ready = this.load(anisotropy).then(
      () => { this.state = 'ready'; prefetchOffline(terrainTextureUrls); },
      (e) => {
        this.state = 'failed';
        if ((e as Error)?.message !== NO_BROWSER) console.warn('[terrain] scanned materials unavailable, using flat colours:', (e as Error)?.message ?? e);
      },
    );
  }

  private async load(anisotropy: number) {
    // outside a browser (node tests, headless tools) there is nothing to decode with: keep the placeholders
    if (typeof createImageBitmap === 'undefined' || typeof fetch === 'undefined') throw new Error(NO_BROWSER);
    const r = await fetch(assetUrl('textures/terrain/manifest.json'), { credentials: 'same-origin' });
    if (!r.ok) throw new Error(`manifest HTTP ${r.status}`);
    const man = (await r.json()) as Manifest;
    const S = man.size;
    if (!(S >= 16 && S <= 2048)) throw new Error('bad manifest');
    const defs = CLIMATE_LAYERS[this.climate];
    const n = S * S * 4;
    const A = new Uint8Array(n * LAYER_COUNT), N = new Uint8Array(n * LAYER_COUNT);
    const mats = [...new Set(defs.map((d) => d.mat))];
    await Promise.all(mats.map(async (mat) => {
      const e = man.materials[mat];
      if (!e) throw new Error(`no material ${mat}`);
      const [alb, nrm] = await Promise.all([decode(e.files.albedo, S), decode(e.files.nrm, S)]);
      defs.forEach((d, li) => {
        if (d.mat !== mat) return;
        A.set(alb, li * n);
        N.set(nrm, li * n);
      });
    }));
    if (this.refs <= 0) return; // released while loading
    this.albedo.value = makeArray(A, S, LAYER_COUNT, true, anisotropy);
    this.nrm.value = makeArray(N, S, LAYER_COUNT, false, anisotropy);
    this.bytes = A.length * 2 * 4 / 3; // both arrays, with mips
    for (const t of this.placeholders) t.dispose();
    this.placeholders.length = 0;
  }

  dispose() {
    this.albedo.value?.dispose();
    this.nrm.value?.dispose();
    for (const t of this.placeholders) t.dispose();
  }
}

function makeArray(data: Uint8Array, size: number, depth: number, srgb: boolean, anisotropy: number): THREE.DataArrayTexture {
  const t = new THREE.DataArrayTexture(data, size, size, depth);
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = size > 4 ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.generateMipmaps = size > 4;
  t.anisotropy = anisotropy;
  t.unpackAlignment = 4;
  t.needsUpdate = true;
  return t;
}

let canvas: OffscreenCanvas | HTMLCanvasElement | null = null;

/** WebP -> RGBA bytes (S x S, top row first). Alpha (roughness) is >= 128, so a premultiplying canvas keeps RGB. */
async function decode(f: { file: string; hash: string }, S: number): Promise<Uint8ClampedArray> {
  const r = await fetch(assetUrl(`textures/terrain/${f.file}?v=${f.hash}`), { credentials: 'same-origin' });
  if (!r.ok) throw new Error(`${f.file}: HTTP ${r.status}`);
  const bmp = await createImageBitmap(await r.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  try {
    if (!canvas) canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(S, S) : Object.assign(document.createElement('canvas'), { width: S, height: S });
    if (canvas.width !== S || canvas.height !== S) { canvas.width = S; canvas.height = S; }
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) throw new Error('no 2d canvas');
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(bmp, 0, 0, S, S);
    return ctx.getImageData(0, 0, S, S).data;
  } finally {
    bmp.close();
  }
}

const sets = new Map<Climate, TerrainTextureSet>();

/** The climate's texture set (shared, loaded once); pair every call with releaseTerrainTextures. */
export function acquireTerrainTextures(climate: Climate, anisotropy = 4): TerrainTextureSet {
  let s = sets.get(climate);
  if (!s) {
    s = new TerrainTextureSet(climate, anisotropy);
    sets.set(climate, s);
  }
  s.refs++;
  return s;
}

export function releaseTerrainTextures(s: TerrainTextureSet) {
  if (--s.refs > 0) return;
  if (sets.get(s.climate) === s) sets.delete(s.climate);
  s.dispose();
}

/** Every baked file (offline prefetch). */
export async function terrainTextureUrls(): Promise<string[]> {
  const r = await fetch(assetUrl('textures/terrain/manifest.json'), { credentials: 'same-origin' });
  if (!r.ok) return [];
  const man = (await r.json()) as Manifest;
  const out = [assetUrl('textures/terrain/manifest.json')];
  for (const e of Object.values(man.materials)) for (const f of [e.files.albedo, e.files.nrm]) out.push(assetUrl(`textures/terrain/${f.file}?v=${f.hash}`));
  return out;
}
