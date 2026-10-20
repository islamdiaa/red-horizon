/**
 * Baked HD models (public/models/*.glb, built by tools/assets) on top of the procedural library.
 *
 * An HD model never replaces the procedural instance: it is grafted onto it.
 *   - createModel() builds the procedural instance as always; hdWrap() then puts the HD body in place of the
 *     close-up body. Its skeleton reuses the procedural nodes ('turret', 'b0', 'door', 'dish'...), so every
 *     animation channel, muzzle, smoke / steam point and destruction hook keeps working. HD rest transforms
 *     win: procedural nodes the GLB also defines are moved to the GLB's pivots (and points to its positions).
 *   - Far LOD = the procedural distant body (HD costs nothing at a distance); Standard / not-yet-loaded /
 *     failed types are simply procedural.
 *   - Team colour, damage variants (scorch, cracks, burnt-through holes, embers), powered / unpowered and
 *     animated emissives, settled snow, the weather and rim-light patches all live in one shared program
 *     (rh-hd-v1). Damage / power state is mirrored from the procedural body's material, so code that switches
 *     procedural materials (healthVariant, charWreck) drives the HD body too.
 *
 * GLB conventions (tools/assets/kit/export.py): node 'root' carries extras.rh (metadata); parts are nodes with
 * extras.rh_part; '<part>_mesh' carriers hold quantised meshes; points have extras.rh_point. Materials:
 * 'body' (atlas: base / ORM / normal + mask in the emissive slot: R team, G emit / 4, B mode / 4), 'glass',
 * 'track' (scrolling tread, belt UVs), 'glow:<slot>' (separately animated emissive, COLOR_0).
 */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ModelAnimState, ModelInstance } from './types';
import { assetUrl } from '../../platform/paths'; // base-path helper
import { backgroundDownloadsAllowed } from '../../platform/network';
import { lodDistance, type ModelFaction, type ModelTemplate, type NodeT } from './builder';
import {
  BODY_EMISSIVE_OFF, BODY_EMISSIVE_ON, BODY_SHARED_UNIFORMS, BodyVariant, conditionTeamColor, fxMaterial, getDamageTexture, teamGlossUniform, teamUniform, // paint schemes
  getDetailTexture, glowMaterial, registerLitMaterial, shadowDepthMaterial, trackMaterial,
} from './materials';

/** Clean team paint albedo in the bake (tools/assets/kit/materials.py TEAM_GREY). */
const TEAM_GREY = 0.7;
/** HD bodies are drawn up to this multiple of the procedural LOD distance (they are cheaper than close-up procedural bodies). */
export const HD_LOD_K = 1.6;
/**
 * Shadow normal offset of HD bodies as a multiple of the sun's normalBias (0.025, tuned for the flat-shaded
 * procedural bodies). Smooth-shaded curved parts and the many small HD protrusions otherwise self-shadow into soft
 * dark blotches at RTS distances; 2.4x (0.06 world units) removes them without visible peter-panning.
 */
export const HD_SHADOW_NB = 2.4;
let shadowChunk: string | null = null;
function hdShadowChunk(): string {
  if (shadowChunk === null) {
    shadowChunk = THREE.ShaderChunk.shadowmap_vertex.replace(/(directionalLightShadows\[ i \]\.shadowNormalBias|pointLightShadows\[ i \]\.shadowNormalBias|spotLightShadows\[ i \]\.shadowNormalBias)/g, `$1 * ${HD_SHADOW_NB.toFixed(2)}`);
  }
  return shadowChunk;
}
const VARIANT_SCORCH = [0, 0.38, 0.62, 1.0, 0.0];
const VARIANT_EMBER = [0, 0.15, 1.0, 0.45, 0.0];

interface ManifestEntry {
  file: string;
  bytes?: number;
  hash?: string;
  type: string;
  faction?: ModelFaction | null;
  kind?: string;
}
interface Manifest {
  version: number;
  models: Record<string, ManifestEntry>;
}

interface HdPoint {
  name: string;
  part: string;
  kind: string;
  /** Model-space rest matrix. */
  rest: THREE.Matrix4;
}

interface HdExtra {
  part: string;
  slot: string;
  geo: THREE.BufferGeometry;
  /** Part-local matrix of the geometry. */
  local: THREE.Matrix4;
}

interface HdTemplate {
  key: string;
  parts: string[];
  parent: (number | -1)[];
  /** Model-space rest matrix per part. */
  rest: THREE.Matrix4[];
  body: THREE.BufferGeometry | null;
  glass: THREE.BufferGeometry | null;
  extras: HdExtra[];
  points: HdPoint[];
  maps: { map: THREE.Texture; orm: THREE.Texture; normal: THREE.Texture; mask: THREE.Texture };
  meta: { height?: number; radius?: number; keep?: string[]; snow?: number; kind?: string };
  rigid: boolean;
  sphere: THREE.Sphere;
  mats: Map<string, THREE.MeshStandardMaterial>;
  /** The decoded bitmaps were closed after their GPU upload (re-decode from the GLB bytes to upload again). */
  released?: boolean;
}

// ---------------------------------------------------------------------------------------------------------
// State: one registry entry per manifest model. The raw GLB is kept (small, compressed); the template
// (decoded textures + float geometry) is materialised for the current memory tier on demand and dropped
// again when unused (sweep), so GPU / CPU memory follows what the battle actually shows.

/** Texture memory tier: 'high' = base + normal at the atlas size, ORM + mask at half; 'medium' = all at half. */
export type HdTier = 'high' | 'medium';

interface Entry {
  key: string;
  e: ManifestEntry;
  buf: ArrayBuffer | null;
  fetchP: Promise<ArrayBuffer | null> | null;
  tpl: HdTemplate | null;
  tplP: Promise<void> | null;
  failed: boolean;
  /** Live HD instances using the template. */
  refs: number;
  /** Pending refs: views waiting to swap to it (holdHd / releaseHd). They block the sweep like live ones. */
  holds: number;
  /** performance.now() when the template was last used (instance created / released). */
  lastUsed: number;
  /** Estimated texture memory of the materialised template (bytes, with mipmaps). */
  bytes: number;
  /** Last materialisation timings (hdStatus). */
  timing?: string;
}

let enabled = false;
let tier: HdTier = 'high';
let manifest: Manifest | null = null;
let manifestP: Promise<Manifest | null> | null = null;
const entries = new Map<string, Entry>();
/** Bumped whenever a template becomes ready (entities.ts re-checks its waiting views only then). */
let readyVersion = 0;
const readyListeners = new Set<(type: string, key: string) => void>();

/**
 * Other HD model families with their own loaders (rigged infantry: infantry-hd.ts) plug into the same lifecycle:
 * their atlases are uploaded with hdTextures(), released by hdReleaseUploaded(), re-decoded by hdRestoreTextures()
 * and dropped by hdReleaseAll().
 */
export interface HdExtension {
  textures(): THREE.Texture[];
  release(renderer: THREE.WebGLRenderer, max: number): number;
  restore(): Promise<void>;
  releaseAll(): void;
}
const extensions: HdExtension[] = [];
export function registerHdExtension(x: HdExtension): void {
  if (!extensions.includes(x)) extensions.push(x);
}

/** A template of an extension became ready: views waiting for it re-check, portraits refresh. */
export function hdNotifyReady(type: string, key: string): void {
  readyVersion++;
  for (const fn of readyListeners) fn(type, key);
}

/** Unused templates are dropped after this long (ms)... */
export const HD_IDLE_MS = 5 * 60 * 1000;
/** ...on Medium always; on High only while the HD texture memory is above this budget. */
export const HD_HIGH_BUDGET = 192 * 1024 * 1024;
/** The faction's most common units: loaded on the loading screen (the rest when first produced). */
const COMMON_UNITS: Record<ModelFaction, string[]> = {
  soviet: ['mcv', 'harv', '3tnk', '4tnk', 'v2rl', 'hind'],
  allies: ['mcv', 'harv', '1tnk', '2tnk', 'jeep', 'arty'],
};

/**
 * Turn HD models on / off for models created from now on (Settings › Graphics › Model detail), and pick the
 * texture tier (High preset: 'high', otherwise 'medium'). A tier change drops the unused templates.
 */
export function setHdModels(on: boolean, t: HdTier = tier): void {
  enabled = on;
  if (t !== tier) {
    tier = t;
    for (const en of entries.values()) if (en.tpl && en.refs === 0 && en.holds === 0) dropTemplate(en);
  }
}

export function hdModelsEnabled(): boolean {
  return enabled;
}

export function hdTier(): HdTier {
  return tier;
}

/** Debug / test hook: which HD templates are loaded, pending or failed, and their texture memory. */
export function hdStatus(): { enabled: boolean; tier: HdTier; loaded: string[]; pending: string[]; failed: string[]; textureMB: number; perTemplateMB: Record<string, number>; preloads: string[]; timings: Record<string, string>; decodeQueue: number; cpuBitmapMB: number; glbMB: number; restoring: number; toRelease: number } {
  const loaded: string[] = [];
  const pend: string[] = [];
  const fail: string[] = [];
  const per: Record<string, number> = {};
  const timings: Record<string, string> = {};
  let total = 0;
  for (const en of entries.values()) {
    if (en.tpl) { loaded.push(en.key); per[en.key] = Math.round((en.bytes / 1048576) * 10) / 10; total += en.bytes; if (en.timing) timings[en.key] = en.timing; }
    else if (en.tplP || en.fetchP) pend.push(en.key);
    if (en.failed) fail.push(en.key);
  }
  // CPU side: decoded bitmaps still held (width x height x 4) and the compressed GLB bytes kept for re-decoding
  let cpu = 0;
  let glb = 0;
  for (const en of entries.values()) {
    glb += en.buf?.byteLength ?? 0;
    if (!en.tpl) continue;
    for (const tex of new Set([en.tpl.maps.map, en.tpl.maps.orm, en.tpl.maps.normal, en.tpl.maps.mask])) {
      const im = tex.image as { width?: number; height?: number } | null;
      if (im?.width) cpu += im.width * (im.height ?? 0) * 4;
    }
  }
  const mb = (b: number) => Math.round((b / 1048576) * 10) / 10;
  return { enabled, tier, loaded, pending: pend, failed: fail, textureMB: mb(total), perTemplateMB: per, preloads: [...preloadLog], timings, decodeQueue: queue.length + inflight, cpuBitmapMB: mb(cpu), glbMB: mb(glb), restoring, toRelease: releaseQueue.length };
}

/** Bumped each time an HD template becomes ready. */
export function hdReadyVersion(): number {
  return readyVersion;
}

/** Called with (typeId, key) whenever an HD template becomes ready (game.ts refreshes that portrait). */
export function onHdReady(fn: (type: string, key: string) => void): () => void {
  readyListeners.add(fn);
  return () => readyListeners.delete(fn);
}

function baseUrl(): string {
  return assetUrl('models/'); // base-path helper
}

/** Fetch the manifest once (cached for the page); false when there is none. */
export async function loadHdManifest(): Promise<boolean> {
  if (!manifestP) {
    manifestP = fetch(`${baseUrl()}manifest.json`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? (r.json() as Promise<Manifest>) : null))
      .catch(() => null)
      .then((m) => {
        manifest = m && m.models ? m : null;
        for (const [key, e] of Object.entries(manifest?.models ?? {})) {
          if (!entries.has(key)) entries.set(key, { key, e, buf: null, fetchP: null, tpl: null, tplP: null, failed: false, refs: 0, holds: 0, lastUsed: 0, bytes: 0 });
        }
        return manifest;
      });
  }
  return !!(await manifestP);
}

/** The registry entry an owner faction's type renders with (faction-dressed structures: never the other side's). */
function entryFor(typeId: string, fac: ModelFaction, dressed: boolean): Entry | undefined {
  const en = entries.get(`${typeId}.${fac}`) ?? entries.get(typeId);
  if (en || dressed) return en;
  // units: any faction's version (a captured war factory's tanks keep their HD look)
  return entries.get(`${typeId}.${fac === 'soviet' ? 'allies' : 'soviet'}`);
}

/**
 * Ask for a type's HD model (lazy loading): 'ready' = createModel gives HD now; 'pending' = loading started
 * (procedural meanwhile; watch hdReadyVersion()); 'none' = HD off, no HD model, or it failed.
 */
export function requestHd(typeId: string, fac: ModelFaction, dressed: boolean): 'ready' | 'pending' | 'none' {
  if (!enabled || !manifest) return 'none';
  const en = entryFor(typeId, fac, dressed);
  if (!en || en.failed) return 'none';
  en.lastUsed = performance.now(); // the idle clock runs from the last request or use, not from the load
  if (en.tpl) return 'ready';
  void materialise(en);
  return 'pending';
}

/**
 * A pending ref: a view that will swap to the type's HD model (construction in progress, waiting for a hidden
 * moment) holds its template so the sweep can't drop it in between. Returns the key for releaseHd, or null.
 */
export function holdHd(typeId: string, fac: ModelFaction, dressed: boolean): string | null {
  const en = entryFor(typeId, fac, dressed);
  if (!en || en.failed) return null;
  en.holds++;
  en.lastUsed = performance.now();
  return en.key;
}

export function releaseHd(key: string | null | undefined): void {
  const en = key ? entries.get(key) : undefined;
  if (!en) return;
  en.holds = Math.max(0, en.holds - 1);
  en.lastUsed = performance.now();
}

/**
 * Load the HD models of the given types (and the factions' common units) and wait for them; never rejects.
 * The loading screen calls it twice: before the world exists (common units) and right after (everything the
 * battle starts with), so nothing that is on screen in the first frame has to swap later.
 */
export async function preloadHdModels(factions: ModelFaction[], types: Iterable<[string, ModelFaction, boolean]> = [], onProgress?: (done: number, total: number) => void): Promise<void> {
  if (!enabled || !(await loadHdManifest())) return;
  // tests: ?hdlazy=1 skips the loading-screen preload (every type loads lazily, exercising the swaps)
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('hdlazy') === '1') return;
  const want = new Set<Entry>();
  for (const f of factions) for (const u of COMMON_UNITS[f] ?? []) { const en = entryFor(u, f, false); if (en) want.add(en); }
  for (const [t, f, d] of types) { const en = entryFor(t, f, d); if (en) want.add(en); }
  const list = [...want].filter((en) => !en.tpl && !en.failed);
  let done = 0;
  const t0 = performance.now();
  await Promise.all(list.map((en) => materialise(en).then(() => onProgress?.(++done, list.length))));
  if (list.length) preloadLog.push(`${list.map((en) => en.key).join(',')} in ${Math.round(performance.now() - t0)} ms`);
}
/** Preload timings (hdStatus), for tests. */
const preloadLog: string[] = [];

/**
 * Offline play: once a battle runs, quietly download (not decode) the factions' remaining GLBs one at a time,
 * so the service worker has them cached for lazily loaded types even if the network goes away later. Not with
 * Data Saver on or on a slow or metered connection (platform/network.ts): there types load lazily only.
 */
export function prefetchHdFiles(factions: ModelFaction[], delayMs = 20000): void {
  if (!enabled || !manifest || typeof navigator === 'undefined' || !navigator.serviceWorker?.controller || !backgroundDownloadsAllowed()) return;
  const list = [...entries.values()].filter((en) => !en.buf && !en.failed && (!en.e.faction || factions.includes(en.e.faction)));
  setTimeout(async () => {
    if (!backgroundDownloadsAllowed()) return; // Data Saver, a slow or metered connection: lazy loading only
    for (const en of list) {
      if (en.buf || en.failed) continue;
      try {
        const r = await fetch(`${baseUrl()}${en.e.file}${en.e.hash ? `?v=${en.e.hash}` : ''}`, { credentials: 'same-origin' });
        await r.blob(); // the service worker stores its own copy; nothing kept here
      } catch { /* offline already: fine */ }
    }
  }, delayMs);
}

let inflight = 0;
const queue: (() => void)[] = [];
/** At most 2 GLBs decoding at a time (bounded peak memory: each decode briefly holds a full-size bitmap). */
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (inflight >= 2) await new Promise<void>((r) => queue.push(r));
  inflight++;
  try {
    return await fn();
  } finally {
    inflight--;
    queue.shift()?.();
  }
}

let fetching = 0;
const fetchQueue: (() => void)[] = [];
/** At most 4 GLB downloads at a time (a burst of requests must not hold every response in memory at once). */
async function fetchSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (fetching >= 4) await new Promise<void>((r) => fetchQueue.push(r));
  fetching++;
  try {
    return await fn();
  } finally {
    fetching--;
    fetchQueue.shift()?.();
  }
}

function fetchGlb(en: Entry): Promise<ArrayBuffer | null> {
  if (en.buf) return Promise.resolve(en.buf);
  if (!en.fetchP) {
    const url = `${baseUrl()}${en.e.file}${en.e.hash ? `?v=${en.e.hash}` : ''}`;
    en.fetchP = fetchSlot(() => fetch(url, { credentials: 'same-origin' }).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.arrayBuffer();
    }))
      .then((b) => (en.buf = b))
      .catch((err) => {
        en.failed = true;
        console.warn(`[hd] ${en.key}: ${(err as Error).message ?? err}; using the procedural model`);
        return null;
      })
      .finally(() => { en.fetchP = null; });
  }
  return en.fetchP;
}

function materialise(en: Entry): Promise<void> {
  if (en.tpl) return Promise.resolve();
  if (en.tplP) return en.tplP;
  // downloads run in parallel (latency-bound); only the decode is limited to a few at a time
  const t0 = performance.now();
  en.tplP = fetchGlb(en).then((buf) => slot(async () => {
    if (!buf || en.failed) return;
    const at = tier;
    try {
      const t1 = performance.now();
      const gltf = await loaderFor(at).parseAsync(buf, '');
      if (en.tpl) return;
      const t2 = performance.now();
      en.tpl = buildTemplate(en.key, gltf);
      releaseQueue.push(en);
      en.timing = `fetch ${Math.round(t1 - t0)} parse ${Math.round(t2 - t1)} build ${Math.round(performance.now() - t2)} ms`;
      en.bytes = templateBytes(en.tpl);
      en.lastUsed = performance.now();
      readyVersion++;
      for (const fn of readyListeners) fn(en.e.type, en.key);
    } catch (err) {
      en.failed = true;
      console.warn(`[hd] ${en.key}: ${(err as Error).message ?? err}; using the procedural model`);
    }
  })).finally(() => { en.tplP = null; });
  ensureSweep();
  return en.tplP;
}

// ---------------------------------------------------------------------------------------------------------
// Bitmap lifetime: decoded bitmaps live only until their GPU upload. The compressed GLB bytes are the source of
// truth; a new renderer (next match), a tier change or a WebGL context loss re-decodes from them.

/** Templates whose bitmaps are still open (waiting for their upload to the battle renderer). */
const releaseQueue: Entry[] = [];
/** Set while thumbnails render in their own GL context (render/thumbnails.ts). */
let offscreen = false;

/**
 * Upload (renderer.initTexture) the atlases of up to `max` newly ready templates and close their decoded bitmaps
 * (game.ts, once per frame and after the loading-screen warm-up). three keeps no CPU copy: re-uploading needs a
 * re-decode (hdRestoreTextures). One template per frame in play: four atlas uploads are a frame's worth of driver
 * time on an integrated GPU, so a burst of new types swaps in over a few frames instead of in one long one.
 */
export function hdReleaseUploaded(renderer: THREE.WebGLRenderer, max = 1): number {
  let n = 0;
  for (const x of extensions) n += x.release(renderer, max);
  const aniso = hdAnisotropy(renderer);
  while (releaseQueue.length && n < max) {
    const en = releaseQueue.shift()!;
    const t = en.tpl;
    if (!t || t.released) continue;
    for (const tex of new Set([t.maps.map, t.maps.orm, t.maps.normal, t.maps.mask])) {
      // anisotropic filtering: our camera looks at walls and roofs at grazing angles (the mask stays plain)
      const want = tex === t.maps.mask ? 1 : aniso;
      if (tex.anisotropy !== want) {
        tex.anisotropy = want;
        tex.needsUpdate = true; // (re-uploads a texture an earlier warm-up already sent with the old setting)
      }
      renderer.initTexture(tex);
      (tex.image as ImageBitmap | null)?.close?.();
      tex.image = null;
    }
    t.released = true;
    n++;
  }
  return n;
}

/** Anisotropic filtering of HD atlases: up to 8x on High, 2x on Medium (integrated GPUs), within what the GPU offers. */
export const HD_ANISOTROPY = { high: 8, medium: 2 } as const;
function hdAnisotropy(renderer: THREE.WebGLRenderer): number {
  const q = typeof location !== 'undefined' ? Number(new URLSearchParams(location.search).get('hdaniso')) : 0; // tests
  return Math.max(1, Math.min(q > 0 ? q : HD_ANISOTROPY[tier], renderer.capabilities.getMaxAnisotropy()));
}

/**
 * Thumbnails render in their own GL context: while on, templates whose bitmaps are already closed render
 * procedural there (portraits of HD types are taken right when they load, before the release).
 */
export function hdOffscreen(on: boolean): void {
  offscreen = on;
}

/** Thumbnails are rendering in their own GL context right now. */
export function hdIsOffscreen(): boolean {
  return offscreen;
}

/** Decode the atlas images of a GLB again (same tier sizes) into the template's existing textures. */
async function redecode(en: Entry): Promise<void> {
  const t = en.tpl;
  const buf = en.buf;
  if (!t || !buf || !t.released) return;
  const dv = new DataView(buf);
  const jl = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jl)));
  const bin = 20 + jl + 8;
  const root = json.nodes?.[json.scenes?.[json.scene ?? 0]?.nodes?.[0]];
  const atlas = Number(root?.extras?.rh?.atlas) || 1024;
  const byName: Record<string, THREE.Texture> = { base: t.maps.map, orm: t.maps.orm, normal: t.maps.normal, mask: t.maps.mask };
  for (const im of json.images ?? []) {
    const tex = byName[im.name];
    if (!tex) continue;
    const v = json.bufferViews[im.bufferView];
    tex.image = (await decodeImage(new Blob([new Uint8Array(buf, bin + (v.byteOffset ?? 0), v.byteLength)], { type: im.mimeType ?? 'image/webp' }), im.name, atlas, tier)) as unknown as HTMLImageElement;
    tex.needsUpdate = true;
  }
  t.released = false;
  for (const mat of t.mats.values()) bindMaps(mat, t.maps);
  releaseQueue.push(en);
}

/** Point an HD material at a set of maps (its own atlases, or the neutral stand-ins during a restore). */
function bindMaps(m: THREE.MeshStandardMaterial, mp: HdTemplate['maps']): void {
  m.map = mp.map;
  m.roughnessMap = m.metalnessMap = m.aoMap = mp.orm;
  m.normalMap = mp.normal;
  const u = m.userData.hdUniforms as { uMask: { value: THREE.Texture } } | undefined;
  if (u) u.uMask.value = mp.mask;
}

let standIns: HdTemplate['maps'] | null = null;
/** Neutral 1x1 maps (grey paint, matte, flat normal, no team / emission) shown while atlases re-decode (also infantry-hd.ts). */
export function standInMaps(): HdTemplate['maps'] {
  if (!standIns) {
    const px = (r: number, g: number, b: number, srgb = false) => {
      const t = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1);
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      t.needsUpdate = true;
      return t;
    };
    standIns = { map: px(110, 110, 112, true), orm: px(255, 200, 0), normal: px(128, 128, 255), mask: px(0, 0, 0) };
  }
  return standIns;
}

/**
 * WebGL context restored: every texture must be uploaded again, so re-decode the loaded templates from their GLB
 * bytes (game.ts onRestored); the next frames upload and close them again.
 */
export async function hdRestoreTextures(): Promise<void> {
  for (const x of extensions) void x.restore();
  // the materials show neutral stand-ins right away (the closed atlases can't upload into the new context, and
  // three would warn every frame); the real atlases come back as their re-decodes land, templates in use first
  const list = [...entries.values()].filter((en) => en.tpl?.released).sort((a, b) => (b.refs + b.holds) - (a.refs + a.holds));
  const stand = standInMaps();
  for (const en of list) for (const mat of en.tpl!.mats.values()) bindMaps(mat, stand);
  restoring += list.length;
  await Promise.all(list.map((en) => slot(() => redecode(en)).finally(() => { restoring--; })));
}
let restoring = 0;

/** A battle ends (its renderer goes away): drop every template; the next battle re-decodes what it needs. */
export function hdReleaseAll(): void {
  for (const x of extensions) x.releaseAll();
  for (const en of entries.values()) if (en.tpl) dropTemplate(en);
  releaseQueue.length = 0;
}

/** Texture memory of a template: RGBA8 + a full mip chain (x 4/3). */
function templateBytes(t: HdTemplate): number {
  let b = 0;
  for (const tex of [t.maps.map, t.maps.orm, t.maps.normal, t.maps.mask]) {
    const im = tex.image as { width?: number; height?: number } | undefined;
    b += (im?.width ?? 0) * (im?.height ?? 0) * 4 * (4 / 3);
  }
  return b;
}

/** Release a template's GPU and CPU memory (the GLB bytes stay: a later request re-decodes it quickly). */
function dropTemplate(en: Entry): void {
  const t = en.tpl;
  if (!t) return;
  en.tpl = null;
  en.bytes = 0;
  t.body?.dispose();
  t.glass?.dispose();
  for (const x of t.extras) x.geo.dispose();
  for (const m of t.mats.values()) m.dispose();
  t.mats.clear();
  for (const tex of new Set([t.maps.map, t.maps.orm, t.maps.normal, t.maps.mask])) {
    tex.dispose();
    (tex.image as ImageBitmap | null)?.close?.();
    tex.image = null;
  }
  const qi = releaseQueue.indexOf(en);
  if (qi >= 0) releaseQueue.splice(qi, 1);
}

/**
 * Test hook: drop a loaded template now (as the idle sweep would), so the next request loads it lazily again.
 * force: even while instances use it (they keep the old copy; its memory is left to the garbage collector).
 */
export function hdDebugDrop(key: string, force = false): boolean {
  const en = entries.get(key);
  if (!en?.tpl) return false;
  if (en.refs > 0) {
    if (!force) return false;
    en.tpl = null;
    en.bytes = 0;
    en.refs = 0;
    return true;
  }
  dropTemplate(en);
  return true;
}

let sweepTimer: ReturnType<typeof setInterval> | null = null;
function ensureSweep(): void {
  if (sweepTimer || typeof setInterval === 'undefined') return;
  sweepTimer = setInterval(() => sweepHd(), 30000);
}

/**
 * Drop templates nobody has used for HD_IDLE_MS (Medium: always; High: only while over HD_HIGH_BUDGET, least
 * recently used first). Runs every 30 s; exported for tests.
 */
export function sweepHd(now = performance.now()): string[] {
  const items: SweepItem[] = [];
  for (const en of entries.values()) items.push({ key: en.key, loaded: !!en.tpl, refs: en.refs, holds: en.holds, lastUsed: en.lastUsed, bytes: en.bytes });
  const dropped = pickSweep(items, now, tier);
  for (const k of dropped) dropTemplate(entries.get(k)!);
  return dropped;
}

/**
 * When a view waiting for its HD model may swap (pure; EntityRenderer.hdSwaps): nobody can see the switch.
 * Never shown yet, hidden (fog) or off-screen; a structure under construction (hologram + build-up); a unit still
 * inside the structure it is leaving. Otherwise it keeps waiting (and holding its template).
 */
export function hdSwapMoment(o: { shown: boolean; visible: boolean; inView: boolean; constructing?: boolean; insideStructure?: boolean }): boolean {
  return !o.shown || !o.visible || !o.inView || !!o.constructing || !!o.insideStructure;
}

/** One template's sweep-relevant state (pickSweep is pure: unit-tested in tests/hdmodels.test.ts). */
export interface SweepItem {
  key: string;
  loaded: boolean;
  /** Live instances. */
  refs: number;
  /** Pending refs (views waiting to swap). */
  holds: number;
  /** Last load / request / use (ms). */
  lastUsed: number;
  bytes: number;
}

/**
 * The templates to drop: loaded, no live or pending refs, idle for at least idleMs since their last load /
 * request / use; least recently used first. Medium drops all of them; High only while the loaded total is over
 * `budget` (and never a template in use, even if that leaves it over budget).
 */
export function pickSweep(items: SweepItem[], now: number, t: HdTier, idleMs = HD_IDLE_MS, budget = HD_HIGH_BUDGET): string[] {
  let total = 0;
  for (const i of items) if (i.loaded) total += i.bytes;
  const idle = items.filter((i) => i.loaded && i.refs === 0 && i.holds === 0 && now - i.lastUsed >= idleMs).sort((a, b) => a.lastUsed - b.lastUsed);
  const out: string[] = [];
  for (const i of idle) {
    if (t === 'high' && total <= budget) break;
    total -= i.bytes;
    out.push(i.key);
  }
  return out;
}

const loaders = new Map<HdTier, GLTFLoader>();
function loaderFor(t: HdTier): GLTFLoader {
  let l = loaders.get(t);
  if (!l) {
    l = new GLTFLoader();
    // CSP-safe WebP decoding: straight from the GLB's buffer view into an ImageBitmap (no blob: URL fetch,
    // which connect-src 'self' would block), downscaled once for the tier. Named like the built-in handler so
    // it replaces it.
    l.register((parser) => new WebpBitmapPlugin(parser, t));
    loaders.set(t, l);
  }
  return l;
}

/** Decoded size of an atlas map for a tier: High keeps base colour and normals at the atlas size. */
function tierSize(name: string, atlas: number, t: HdTier): number {
  if (t === 'high' && (name === 'base' || name === 'normal')) return atlas;
  return Math.max(64, atlas >> 1);
}

const BITMAP_OPTS: ImageBitmapOptions = { imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' };

/** Decode one atlas image at its tier size (the full-size bitmap is closed right after the resize). */
async function decodeImage(blob: Blob, name: string, atlas: number, t: HdTier): Promise<ImageBitmap> {
  let bmp = await createImageBitmap(blob, BITMAP_OPTS);
  const want = tierSize(name, atlas, t);
  if (bmp.width > want) {
    const small = await createImageBitmap(bmp, { ...BITMAP_OPTS, resizeWidth: want, resizeHeight: Math.max(1, Math.round((bmp.height * want) / bmp.width)), resizeQuality: 'high' });
    bmp.close();
    bmp = small;
  }
  return bmp;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
class WebpBitmapPlugin {
  readonly name = 'EXT_texture_webp';
  constructor(private parser: any, private t: HdTier) {}
  loadTexture(index: number): Promise<THREE.Texture> | null {
    const json = this.parser.json;
    const def = json.textures[index];
    const ext = def.extensions?.EXT_texture_webp;
    if (!ext) return null;
    const src = json.images[ext.source];
    const cache: Map<number, Promise<THREE.Texture>> = (this.parser.rhTex ??= new Map());
    let p = cache.get(ext.source);
    if (!p) {
      const root = json.nodes?.[json.scenes?.[json.scene ?? 0]?.nodes?.[0]];
      const atlas = Number(root?.extras?.rh?.atlas) || 1024;
      p = this.parser.getDependency('bufferView', src.bufferView).then(async (buf: ArrayBuffer) => {
        const bmp = await decodeImage(new Blob([buf], { type: src.mimeType ?? 'image/webp' }), src.name ?? '', atlas, this.t);
        const tex = new THREE.Texture(bmp as unknown as HTMLImageElement);
        tex.flipY = false;
        tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.magFilter = THREE.LinearFilter;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.anisotropy = 4;
        tex.name = src.name ?? '';
        tex.needsUpdate = true;
        return tex;
      });
      cache.set(ext.source, p!);
    }
    return p!;
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
// ---------------------------------------------------------------------------------------------------------
// GLB -> template

const _m = new THREE.Matrix4();
const _n3 = new THREE.Matrix3();
const _v = new THREE.Vector3();
const _v4 = new THREE.Vector4();

function buildTemplate(key: string, gltf: GLTF): HdTemplate {
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const root = scene.getObjectByName('root') ?? scene.children[0];
  const rootInv = root.matrixWorld.clone().invert();
  const meta = ((root.userData as { rh?: HdTemplate['meta'] }).rh ?? {}) as HdTemplate['meta'];
  // parts (root first, parents before children)
  const parts: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (o === root || (o.userData as { rh_part?: boolean }).rh_part) parts.push(o);
  });
  const partIndex = new Map<THREE.Object3D, number>(parts.map((p, i) => [p, i]));
  const partOf = (o: THREE.Object3D): number => {
    for (let p: THREE.Object3D | null = o; p; p = p.parent) {
      const i = partIndex.get(p);
      if (i !== undefined) return i;
    }
    return 0;
  };
  const rest = parts.map((p) => new THREE.Matrix4().multiplyMatrices(rootInv, p.matrixWorld));
  const parent = parts.map((p) => (p === root ? -1 : partOf(p.parent!)));
  const multi = parts.length > 1;
  const bodies: THREE.BufferGeometry[] = [];
  const glasses: THREE.BufferGeometry[] = [];
  const extras: HdExtra[] = [];
  let maps: HdTemplate['maps'] | null = null;
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    const name = mat.name || 'body';
    const pi = partOf(mesh);
    if (name === 'body' || name === 'glass') {
      if (!maps && mat.map && mat.normalMap && mat.roughnessMap && mat.emissiveMap) {
        maps = { map: mat.map, orm: mat.roughnessMap, normal: mat.normalMap, mask: mat.emissiveMap };
      }
      _m.multiplyMatrices(rootInv, mesh.matrixWorld);
      const g = toFloat(mesh.geometry, _m, true);
      if (multi) skinTo(g, pi);
      (name === 'glass' ? glasses : bodies).push(g);
    } else {
      // part-local: inverse(part model rest) * mesh model matrix
      const local = new THREE.Matrix4().copy(rest[pi]).invert().multiply(_m.multiplyMatrices(rootInv, mesh.matrixWorld));
      extras.push({ part: parts[pi].name, slot: name, geo: toFloat(mesh.geometry, local, false), local: new THREE.Matrix4() });
    }
  });
  if (!maps) throw new Error('no body textures');
  const m = maps as HdTemplate['maps'];
  m.map.colorSpace = THREE.SRGBColorSpace;
  m.orm.colorSpace = THREE.NoColorSpace;
  m.normal.colorSpace = THREE.NoColorSpace;
  m.mask.colorSpace = THREE.NoColorSpace;
  m.mask.anisotropy = 1;
  const body = bodies.length > 1 ? mergeGeometries(bodies, false) : bodies[0] ?? null;
  const glass = glasses.length > 1 ? mergeGeometries(glasses, false) : glasses[0] ?? null;
  for (const g of [body, glass]) {
    if (!g) continue;
    g.computeBoundingBox();
    g.computeBoundingSphere();
  }
  const points: HdPoint[] = [];
  root.traverse((o) => {
    const kind = (o.userData as { rh_point?: string }).rh_point;
    if (kind) points.push({ name: o.name, part: parts[partOf(o.parent!)].name, kind, rest: new THREE.Matrix4().multiplyMatrices(rootInv, o.matrixWorld) });
  });
  const sphere = (body?.boundingSphere ?? new THREE.Sphere(new THREE.Vector3(), 1)).clone();
  sphere.radius *= 1.15;
  return {
    key, parts: parts.map((p) => p.name), parent, rest, body, glass, extras, points, maps: m, meta,
    rigid: !multi, sphere, mats: new Map(),
  };
}

/** Float copy of a (quantised) glTF primitive with `M` applied; tangents and UVs carried over. */
function toFloat(src: THREE.BufferGeometry, M: THREE.Matrix4, withTangent: boolean): THREE.BufferGeometry {
  const pos = src.getAttribute('position') as THREE.BufferAttribute;
  const nrm = src.getAttribute('normal') as THREE.BufferAttribute | undefined;
  const tan = src.getAttribute('tangent') as THREE.BufferAttribute | undefined;
  const uv = src.getAttribute('uv') as THREE.BufferAttribute | undefined;
  const col = src.getAttribute('color') as THREE.BufferAttribute | undefined;
  const n = pos.count;
  _n3.getNormalMatrix(M);
  const P = new Float32Array(n * 3);
  const N = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    _v.fromBufferAttribute(pos, i).applyMatrix4(M);
    P[i * 3] = _v.x; P[i * 3 + 1] = _v.y; P[i * 3 + 2] = _v.z;
    if (nrm) {
      _v.fromBufferAttribute(nrm, i).applyMatrix3(_n3).normalize();
      N[i * 3] = _v.x; N[i * 3 + 1] = _v.y; N[i * 3 + 2] = _v.z;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  if (uv) {
    const U = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { U[i * 2] = uv.getX(i); U[i * 2 + 1] = uv.getY(i); }
    g.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  }
  if (withTangent && tan) {
    const T = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      _v4.fromBufferAttribute(tan, i);
      _v.set(_v4.x, _v4.y, _v4.z).transformDirection(M);
      T[i * 4] = _v.x; T[i * 4 + 1] = _v.y; T[i * 4 + 2] = _v.z; T[i * 4 + 3] = _v4.w < 0 ? -1 : 1;
    }
    g.setAttribute('tangent', new THREE.BufferAttribute(T, 4));
  }
  if (col) {
    const C = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { C[i * 3] = col.getX(i); C[i * 3 + 1] = col.getY(i); C[i * 3 + 2] = col.getZ(i); }
    g.setAttribute('color', new THREE.BufferAttribute(C, 3));
  }
  const idx = src.getIndex();
  if (idx) g.setIndex(new THREE.BufferAttribute(idx.count > 65535 ? new Uint32Array(idx.array) : new Uint16Array(idx.array), 1));
  return g;
}

function skinTo(g: THREE.BufferGeometry, bone: number): void {
  const n = g.getAttribute('position').count;
  const si = new Uint16Array(n * 4);
  const sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { si[i * 4] = bone; sw[i * 4] = 1; }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
}

// ---------------------------------------------------------------------------------------------------------
// Material: one program for every HD body (rh-hd-v1); per template / team / variant / power / skinning objects

function hdMaterial(t: HdTemplate, team: number, variant: number, powered: boolean, skinned: boolean, glass: boolean): THREE.MeshStandardMaterial {
  const key = `${team}|${variant}|${powered ? 1 : 0}|${skinned ? 1 : 0}|${glass ? 1 : 0}`;
  let m = t.mats.get(key);
  if (m) return m;
  const mp = t.maps;
  m = new THREE.MeshStandardMaterial({
    map: mp.map, roughnessMap: mp.orm, metalnessMap: mp.orm, aoMap: mp.orm, normalMap: mp.normal,
    roughness: glass ? 0.3 : 1, metalness: 1, aoMapIntensity: 1,
  });
  m.normalScale.set(1, 1);
  const uniforms = {
    uTeam: teamUniform(team, 1 / TEAM_GREY), // shared per team colour (paint schemes)
    uRhGloss: teamGlossUniform(team),
    uScorch: { value: VARIANT_SCORCH[variant] ?? 0 },
    uEmber: { value: VARIANT_EMBER[variant] ?? 0 },
    uFlash: { value: variant === BodyVariant.Electro ? new THREE.Color(0.9, 1.4, 3.2) : new THREE.Color(0, 0, 0) },
    uEmissive: { value: powered && variant < BodyVariant.Charred ? BODY_EMISSIVE_ON : BODY_EMISSIVE_OFF },
    uSnowK: { value: t.meta.snow ?? (t.meta.kind === 'structure' || t.meta.kind === 'defense' ? 1 : 0.3) },
    uDmg: { value: getDamageTexture() },
    uDet: { value: getDetailTexture() },
    uMask: { value: mp.mask },
    ...BODY_SHARED_UNIFORMS,
  };
  m.userData.hdUniforms = uniforms; // (tests / A-B checks tweak these)
  if (t.released && restoring > 0) bindMaps(m, standInMaps()); // (created mid-restore)
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRhN;\nvarying vec3 vRhP;\nvarying float vRhPh;')
      .replace('#include <defaultnormal_vertex>', '#include <defaultnormal_vertex>\nvRhN = objectNormal;')
      .replace('#include <shadowmap_vertex>', hdShadowChunk())
      .replace(
        '#include <project_vertex>',
        `vRhP = transformed;
{
  vec2 rhO = modelMatrix[3].xz;
  vRhPh = fract( sin( dot( rhO, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ) * 6.2832;
}
#include <project_vertex>`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uTeam;
uniform float uRhGloss;
uniform float uScorch;
uniform float uEmber;
uniform vec3 uFlash;
uniform float uEmissive;
uniform float uSnowK;
uniform sampler2D uDmg;
uniform sampler2D uDet;
uniform sampler2D uMask;
uniform float uBodyTime;
uniform float uRhSnow;
varying vec3 vRhN;
varying vec3 vRhP;
varying float vRhPh;`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
vec4 rhMask = texture2D( uMask, vMapUv );
float rhEmis = rhMask.g * 4.0;
float rhMode = floor( rhMask.b * 4.0 + 0.5 );
vec3 rhLight = diffuseColor.rgb;
float surfK = 1.0 - smoothstep( 0.05, 0.4, rhEmis );
diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * uTeam, rhMask.r );
diffuseColor.rgb *= mix( 0.3, 1.0, surfK );
// damage: the procedural damage maps, box-projected in model space (same density as the procedural bodies)
vec3 rhNn = vRhN * inversesqrt( max( dot( vRhN, vRhN ), 1e-12 ) ); // (a zero normal must not give NaN)
vec3 rhAn = abs( rhNn );
vec2 rhBp = rhAn.x > rhAn.y && rhAn.x > rhAn.z ? vRhP.zy : ( rhAn.y > rhAn.z ? vRhP.xz : vRhP.xy );
vec2 rhUv = rhBp * 2.2;
vec4 dmgT = texture2D( uDmg, rhUv * 0.43 );
float rhUp = clamp( rhNn.y, 0.0, 1.0 );
float scorch = smoothstep( 1.0 - uScorch, 1.25 - uScorch, texture2D( uDet, rhUv ).a ) * min( uScorch * 1.6, 1.0 );
diffuseColor.rgb *= 1.0 - 0.86 * scorch;
float rhCrack = smoothstep( 0.42, 0.9, dmgT.r ) * smoothstep( 0.25, 0.4, uScorch ) * surfK;
float rhHoleK = smoothstep( 0.5, 0.62, uScorch ) * surfK;
float rhHole = smoothstep( 0.665, 0.7, dmgT.g ) * rhHoleK;
float rhRim = clamp( smoothstep( 0.6, 0.665, dmgT.g ) * rhHoleK - rhHole, 0.0, 1.0 );
diffuseColor.rgb *= 1.0 - 0.82 * rhCrack;
diffuseColor.rgb = mix( diffuseColor.rgb * ( 1.0 - 0.65 * rhRim ), vec3( 0.012, 0.01, 0.009 ), rhHole );
// settled snow (winter): up-facing, out of the baked crevices
float rhSnow = 0.0;
if ( uRhSnow > 0.0 ) {
  float rhAo = texture2D( aoMap, vAoMapUv ).r;
  float rhSn = texture2D( uDmg, vRhP.xz * 0.9 + 0.13 ).a;
  float rhSn2 = texture2D( uDet, vRhP.xz * 3.7 ).a;
  rhSnow = smoothstep( 0.55, 0.85, rhUp + ( rhSn2 - 0.5 ) * 0.08 );
  rhSnow *= uRhSnow * uSnowK * surfK * smoothstep( 0.45, 0.8, rhAo ) * ( 1.0 - rhHole ) * ( 1.0 - scorch * 0.7 );
  rhSnow = clamp( rhSnow * ( 0.74 + 0.26 * smoothstep( 0.0, 0.6, rhSn ) ), 0.0, 1.0 );
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.76, 0.8, 0.87 ) * ( 0.93 + 0.1 * rhSn2 ), rhSnow );
}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        // the commented include is the hook chained patches (weather gloss / snow cover) insert after
        `float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
  roughnessFactor *= texture2D( roughnessMap, vRoughnessMapUv ).g;
#endif
roughnessFactor = clamp( roughnessFactor + scorch * 0.35 + rhHole + rhCrack * 0.3, 0.04, 1.0 );
roughnessFactor = mix( roughnessFactor, 0.8, rhSnow );
roughnessFactor = mix( roughnessFactor, roughnessFactor * 0.35, uRhGloss * rhMask.r * surfK ); // parade gloss
// #include <roughnessmap_fragment>`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
metalnessFactor *= ( 1.0 - scorch * 0.8 ) * ( 1.0 - rhHole ) * ( 1.0 - rhSnow );`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
float rhEA = 1.0;
if ( rhMode > 0.5 ) {
  float rhPh = vRhPh + dot( vRhP, vec3( 3.1, 1.7, 2.3 ) );
  if ( rhMode < 1.5 ) rhEA = fract( uBodyTime * 0.625 + rhPh * 0.159 ) < 0.3 ? 1.0 : 0.05;
  else if ( rhMode < 2.5 ) rhEA = 0.45 + 0.55 * ( 0.5 + 0.5 * sin( uBodyTime * 2.4 + rhPh ) );
  else if ( rhMode < 3.5 ) rhEA = 0.7 + 0.3 * sin( uBodyTime * 13.0 + rhPh ) * sin( uBodyTime * 7.3 + rhPh * 1.7 );
  else rhEA = fract( uBodyTime * 1.4 + rhPh * 0.159 ) < 0.08 ? 1.6 : 0.03;
}
totalEmissiveRadiance += uFlash + rhLight * rhEmis * uEmissive * rhEA * ( 1.0 - scorch );
if ( uEmber > 0.0 ) {
  float rhFl = 0.55 + 0.45 * sin( uBodyTime * 6.3 + dmgT.a * 31.0 + dmgT.b * 17.0 );
  totalEmissiveRadiance += vec3( 1.7, 0.42, 0.08 ) * ( rhRim * rhRim * 0.9 + rhCrack * 0.15 * rhHoleK ) * rhFl * uEmber;
}`,
      );
  };
  m.customProgramCacheKey = () => 'rh-hd-v2';
  m.name = `hd-${t.key}-${key}`;
  registerLitMaterial(m);
  t.mats.set(key, m);
  return m;
}

// ---------------------------------------------------------------------------------------------------------
// Instances

const IDENTITY = new THREE.Matrix4();
const BODY_RE = /^body-[0-9a-f]+-(\d)(-off)?/;
/** Procedural body material -> (variant << 1 | unpowered), -1 = not a body material (hologram, ...). */
const matState = new WeakMap<THREE.Material, number>();
function stateOf(m: THREE.Material): number {
  let s = matState.get(m);
  if (s === undefined) {
    const r = BODY_RE.exec(m.name);
    s = r ? (Number(r[1]) << 1) | (r[2] ? 1 : 0) : -1;
    matState.set(m, s);
  }
  return s;
}


/**
 * Graft the HD body onto a freshly created procedural instance (index.ts createModel). Returns `inst` itself
 * when HD is off or the type has no loaded HD model.
 */
export function hdWrap(inst: ModelInstance, tpl: ModelTemplate, typeId: string, fac: ModelFaction, teamHex: number, dressed: boolean): ModelInstance {
  if (!enabled) return inst;
  const en = entryFor(typeId, fac, dressed);
  const t = en?.tpl;
  if (!en || !t || !t.body) return inst;
  if (offscreen && t.released) return inst; // another GL context can't upload closed bitmaps
  try {
    const out = graft(inst, tpl, t, teamHex, en);
    en.refs++;
    en.lastUsed = performance.now();
    return out;
  } catch (e) {
    console.warn(`[hd] ${t.key}: graft failed`, e);
    return inst;
  }
}

const _w = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

function graft(inst: ModelInstance, ptpl: ModelTemplate, t: HdTemplate, teamHex: number, en: Entry): ModelInstance {
  const root = inst.root;
  root.updateMatrixWorld(true);
  const rootNode = inst.node?.('root') ?? root.children[0];
  // procedural meshes by slot (NodeT.meshes order = mesh children order, see builder.buildNode)
  const slotMeshes = new Map<string, THREE.Mesh[]>();
  const walk = (nt: NodeT) => {
    const o = inst.node?.(nt.name);
    if (o) {
      const ms = o.children.filter((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh[];
      nt.meshes.forEach((mt, i) => {
        const mesh = ms[i];
        if (!mesh) return;
        let l = slotMeshes.get(mt.slot);
        if (!l) slotMeshes.set(mt.slot, (l = []));
        l.push(mesh);
      });
    }
    nt.children.forEach(walk);
  };
  walk(ptpl.root);
  // the procedural bodies: the close-up one is replaced, the distant one stays as the far LOD
  let lod: THREE.LOD | null = null;
  let hi: THREE.Mesh | null = null;
  let lo: THREE.Mesh | null = null;
  for (const c of root.children) {
    if ((c as THREE.LOD).isLOD) lod = c as THREE.LOD;
    else if ((c as THREE.Mesh).isMesh && c.name === 'body') hi = c as THREE.Mesh;
    else if ((c as THREE.Mesh).isMesh && c.name === 'body-lo') lo = c as THREE.Mesh;
  }
  if (lod) {
    hi = lod.levels[0]?.object as THREE.Mesh;
    lo = lod.levels[1]?.object as THREE.Mesh;
  }
  const far = lo ?? hi;
  if (!far) return inst;

  // ---- skeleton: procedural nodes at the HD rest pose
  const nodeOf: THREE.Object3D[] = [];
  for (let i = 0; i < t.parts.length; i++) {
    const name = t.parts[i];
    let o = i === 0 ? rootNode : inst.node?.(name);
    if (!o) o = nodeOf[t.parent[i]] ?? rootNode;
    else if (i > 0) setRest(o, t.rest[i]);
    nodeOf.push(o);
  }
  const extraPoints: Record<string, THREE.Object3D[]> = {};
  for (const p of t.points) {
    const o = inst.node?.(p.name);
    if (o) setRest(o, p.rest);
    else {
      const holder = nodeOf[t.parts.indexOf(p.part)] ?? rootNode;
      const n = new THREE.Object3D();
      n.name = p.name;
      holder.add(n);
      setRest(n, p.rest);
      (extraPoints[p.kind] ??= []).push(n);
    }
  }
  root.updateMatrixWorld(true);

  // ---- HD meshes
  const skinned = !t.rigid;
  let skeleton: THREE.Skeleton | null = null;
  if (skinned) {
    const inverses = nodeOf.map((o) => _w.copy(root.matrixWorld).invert().multiply(o.matrixWorld).clone().invert());
    skeleton = new THREE.Skeleton(nodeOf as THREE.Bone[], inverses);
  }
  const mkBody = (geo: THREE.BufferGeometry, glass: boolean): THREE.Mesh => {
    const mat = hdMaterial(t, teamHex, 0, true, skinned, glass);
    let mesh: THREE.Mesh;
    if (skeleton) {
      const sk = new THREE.SkinnedMesh(geo, mat);
      sk.boundingSphere = t.sphere;
      sk.bind(skeleton, IDENTITY);
      mesh = sk;
    } else mesh = new THREE.Mesh(geo, mat);
    mesh.name = glass ? 'hd-glass' : 'hd-body';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.customDepthMaterial = shadowDepthMaterial(mesh);
    mesh.userData.hd = true;
    return mesh;
  };
  const body = mkBody(t.body!, false);
  const glassMesh = t.glass ? mkBody(t.glass, true) : null;
  let near: THREE.Object3D = body;
  if (glassMesh) {
    const g = new THREE.Group();
    g.name = 'hd';
    g.add(body, glassMesh);
    near = g;
  }
  const dist = lodDistance() * HD_LOD_K;
  if (lod) {
    for (const l of lod.levels) lod.remove(l.object);
    lod.levels.length = 0;
    lod.addLevel(near, 0, 0.08);
    lod.addLevel(far, dist, 0.08);
  } else {
    far.removeFromParent();
    lod = new THREE.LOD();
    lod.name = 'lod';
    lod.addLevel(near, 0, 0.08);
    lod.addLevel(far, dist, 0.08);
    root.add(lod);
  }

  // ---- procedural extras: dropped unless the GLB keeps them; HD extras mirror their animated state
  const keep = new Set(t.meta.keep ?? []);
  const srcGlow = new Map<string, THREE.Mesh>();
  let srcTrack: THREE.Mesh | null = null;
  for (const [slot, list] of slotMeshes) {
    if (slot === 'body') continue;
    if (slot === 'track') srcTrack = list[0];
    else if (slot.startsWith('glow')) srcGlow.set(slot, list[0]);
    if (!keep.has(slot)) for (const ms of list) ms.removeFromParent();
  }
  const hdTracks: THREE.Mesh[] = [];
  const hdGlows: { mesh: THREE.Mesh; src: THREE.Mesh | undefined }[] = [];
  for (const x of t.extras) {
    const holder = nodeOf[t.parts.indexOf(x.part)] ?? rootNode;
    let mat: THREE.Material;
    if (x.slot === 'track') mat = srcTrack ? (srcTrack.material as THREE.Material) : trackMaterial(0);
    else if (x.slot.startsWith('fx:')) mat = fxMaterial(x.slot.slice(3));
    else mat = (srcGlow.get(x.slot)?.material as THREE.Material | undefined) ?? glowMaterial(ptpl.glow?.[x.slot] ?? 3);
    const mesh = new THREE.Mesh(x.geo, mat);
    mesh.name = `hd-${x.slot}`;
    mesh.castShadow = false;
    mesh.receiveShadow = x.slot === 'track';
    holder.add(mesh);
    if (x.slot === 'track') hdTracks.push(mesh);
    else if (x.slot.startsWith('glow')) hdGlows.push({ mesh, src: srcGlow.get(x.slot) });
    else mesh.renderOrder = 2;
  }

  // ---- state mirroring (allocation-free)
  let lastMat: THREE.Material | null = null;
  const sync = () => {
    const pm = far.material as THREE.Material;
    if (pm !== lastMat) {
      lastMat = pm;
      const s = stateOf(pm);
      if (s >= 0) {
        body.material = hdMaterial(t, teamHex, s >> 1, (s & 1) === 0, skinned, false);
        if (glassMesh) glassMesh.material = hdMaterial(t, teamHex, s >> 1, (s & 1) === 0, skinned, true);
      }
    }
    if (srcTrack) for (const m of hdTracks) m.material = srcTrack.material;
    for (const g of hdGlows) if (g.src) { g.mesh.material = g.src.material; g.mesh.visible = g.src.visible; }
  };

  const merge = (base: THREE.Object3D[] | undefined, kind: string): THREE.Object3D[] | undefined => {
    const add = extraPoints[kind];
    return add ? [...(base ?? []), ...add] : base;
  };
  const fxPoints = inst.fxPoints ? [...inst.fxPoints] : [];
  for (const kind of ['steam', 'sparks'] as const) for (const n of extraPoints[kind] ?? []) fxPoints.push({ kind, node: n });
  let disposed = false;
  const out: ModelInstance & { hd: true; hdSync: () => void } = {
    root,
    turret: inst.turret,
    muzzles: merge(inst.muzzles, 'muzzle') ?? [],
    smokePoints: merge(inst.smokePoints, 'smoke'),
    fxPoints: fxPoints.length ? fxPoints : inst.fxPoints,
    height: t.meta.height ?? inst.height,
    radius: t.meta.radius ?? inst.radius,
    typeId: inst.typeId,
    hd: true,
    hdSync: sync,
    update(state: ModelAnimState) {
      inst.update(state);
      sync();
    },
    setVariant(v: number) {
      inst.setVariant?.(v);
      sync();
    },
    node: inst.node,
    nodeBounds: inst.nodeBounds,
    dispose() {
      inst.dispose();
      skeleton?.dispose();
      if (!disposed) {
        disposed = true;
        en.refs = Math.max(0, en.refs - 1);
        en.lastUsed = performance.now();
      }
    },
  };
  return out;
}

/** Put node `o` at model-space rest matrix `M` (its parent's current world = model space at rest). */
function setRest(o: THREE.Object3D, M: THREE.Matrix4): void {
  const p = o.parent;
  if (p) p.updateWorldMatrix(true, false);
  _w.copy(p ? p.matrixWorld : IDENTITY).invert().multiply(M);
  _w.decompose(o.position, _q, _s);
  o.quaternion.copy(_q);
  o.updateMatrix();
}

/** Every loaded HD texture (game.ts uploads them on the loading screen). */
export function hdTextures(): THREE.Texture[] {
  const out: THREE.Texture[] = [];
  for (const x of extensions) out.push(...x.textures());
  for (const en of entries.values()) if (en.tpl) out.push(en.tpl.maps.map, en.tpl.maps.orm, en.tpl.maps.normal, en.tpl.maps.mask);
  return out;
}
