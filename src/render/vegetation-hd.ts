import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { assetUrl } from '../platform/paths';

/**
 * HD trees and rocks (tools/assets/models/nature, baked by the Blender factory into public/models/nature/*.glb):
 * one merged geometry + atlas textures per model, instanced by vegetation.ts for the near blocks (the procedural
 * trees stay the far LOD and the Low / Standard look). Decoded CSP-safely (WebP straight from the GLB's buffer
 * view into an ImageBitmap) and cached for the page.
 */

export interface NatureTemplate {
  id: string;
  geometry: THREE.BufferGeometry;
  map: THREE.Texture;
  normalMap: THREE.Texture;
  orm: THREE.Texture;
  tris: number;
}

interface Manifest { version: number; models: Record<string, { file: string; hash: string; tris: number }> }

let manifestP: Promise<Manifest | null> | null = null;
const templates = new Map<string, Promise<NatureTemplate | null>>();

function manifest(): Promise<Manifest | null> {
  manifestP ??= fetch(assetUrl('models/nature/manifest.json'), { credentials: 'same-origin' })
    .then((r) => (r.ok ? (r.json() as Promise<Manifest>) : null))
    .then((m) => (m && m.models ? m : null))
    .catch(() => null);
  return manifestP;
}

/** The ids the manifest lists (empty when there is none). */
export async function natureIds(): Promise<string[]> {
  const m = await manifest();
  return m ? Object.keys(m.models) : [];
}

/** Load one nature model (null when missing or broken: the procedural model stays). */
export function loadNature(id: string): Promise<NatureTemplate | null> {
  let p = templates.get(id);
  if (!p) {
    p = (async () => {
      if (typeof createImageBitmap === 'undefined') return null;
      const m = await manifest();
      const e = m?.models[id];
      if (!e) return null;
      const r = await fetch(assetUrl(`models/nature/${e.file}${e.hash ? `?v=${e.hash}` : ''}`), { credentials: 'same-origin' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return parse(id, await r.arrayBuffer());
    })().catch((err) => {
      console.warn(`[nature] ${id}: ${(err as Error)?.message ?? err}; using the procedural model`);
      return null;
    });
    templates.set(id, p);
  }
  return p;
}

let loader: GLTFLoader | null = null;

async function parse(id: string, buf: ArrayBuffer): Promise<NatureTemplate> {
  loader ??= new GLTFLoader().register((parser) => new WebpBitmapPlugin(parser));
  const gltf = await loader.parseAsync(buf, '');
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  let mat: THREE.MeshStandardMaterial | null = null;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const m = mesh.material as THREE.MeshStandardMaterial;
    if (!m?.map) return; // only the atlas body (no glow / track slots in nature models)
    mat ??= m;
    parts.push(dequantize(mesh.geometry, mesh.matrixWorld));
  });
  if (!parts.length || !mat) throw new Error('no atlas mesh');
  const geometry = parts.length === 1 ? parts[0] : merge(parts);
  if (!geometry.attributes.tangent && geometry.index && geometry.attributes.uv) geometry.computeTangents();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const m = mat as THREE.MeshStandardMaterial;
  const orm = m.roughnessMap ?? m.aoMap ?? m.metalnessMap;
  if (!m.normalMap || !orm) throw new Error('missing atlas maps');
  for (const t of [m.map!, m.normalMap, orm]) {
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.anisotropy = 4;
    t.needsUpdate = true;
  }
  m.map!.colorSpace = THREE.SRGBColorSpace;
  const tris = (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
  return { id, geometry, map: m.map!, normalMap: m.normalMap, orm, tris };
}

/** Float copies of the quantised attributes, transformed into the model's root frame. */
function dequantize(g: THREE.BufferGeometry, M: THREE.Matrix4): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv', 'tangent'] as const) {
    const a = g.attributes[name] as THREE.BufferAttribute | undefined;
    if (!a) continue;
    const n = a.count, k = a.itemSize;
    const f = new Float32Array(n * k);
    for (let i = 0; i < n; i++) for (let c = 0; c < k; c++) f[i * k + c] = a.getComponent(i, c);
    out.setAttribute(name, new THREE.BufferAttribute(f, k));
  }
  if (g.index) out.setIndex(new THREE.BufferAttribute(new Uint32Array(g.index.array as ArrayLike<number>), 1));
  out.applyMatrix4(M);
  return out;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const names = ['position', 'normal', 'uv', 'tangent'].filter((n) => parts.every((p) => p.attributes[n]));
  const out = new THREE.BufferGeometry();
  let verts = 0, idx = 0;
  for (const p of parts) { verts += p.attributes.position.count; idx += p.index ? p.index.count : p.attributes.position.count; }
  for (const n of names) {
    const k = parts[0].attributes[n].itemSize;
    const f = new Float32Array(verts * k);
    let o = 0;
    for (const p of parts) { f.set(p.attributes[n].array as Float32Array, o); o += p.attributes[n].array.length; }
    out.setAttribute(n, new THREE.BufferAttribute(f, k));
  }
  const ind = new Uint32Array(idx);
  let o = 0, base = 0;
  for (const p of parts) {
    const c = p.attributes.position.count;
    if (p.index) for (let i = 0; i < p.index.count; i++) ind[o++] = p.index.getX(i) + base;
    else for (let i = 0; i < c; i++) ind[o++] = i + base;
    base += c;
  }
  out.setIndex(new THREE.BufferAttribute(ind, 1));
  return out;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
class WebpBitmapPlugin {
  readonly name = 'EXT_texture_webp';
  constructor(private parser: any) {}
  loadTexture(index: number): Promise<THREE.Texture> | null {
    const json = this.parser.json;
    const ext = json.textures[index]?.extensions?.EXT_texture_webp;
    if (!ext) return null;
    const src = json.images[ext.source];
    const cache: Map<number, Promise<THREE.Texture>> = (this.parser.rhTex ??= new Map());
    let p = cache.get(ext.source);
    if (!p) {
      // the team / emissive mask is never used by nature models: a 1x1 stand-in instead of a decode
      if (src.name === 'mask') p = Promise.resolve(new THREE.DataTexture(new Uint8Array(4), 1, 1));
      else p = this.parser.getDependency('bufferView', src.bufferView).then(async (buf: ArrayBuffer) => {
        const bmp = await createImageBitmap(new Blob([buf], { type: src.mimeType ?? 'image/webp' }), { imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
        const tex = new THREE.Texture(bmp as unknown as HTMLImageElement);
        tex.flipY = false;
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
// Placeholders: the HD materials exist from the start (so the loading screen compiles their program and the
// renderer's weather patch reaches them); their textures and geometry are swapped in when a model arrives.

let placeholderTex: { map: THREE.DataTexture; normal: THREE.DataTexture; orm: THREE.DataTexture } | null = null;

export function natureMaterialParams(): THREE.MeshStandardMaterialParameters {
  if (!placeholderTex) {
    const mk = (r: number, g: number, b: number, srgb: boolean) => {
      const t = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1);
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.needsUpdate = true;
      return t;
    };
    placeholderTex = { map: mk(110, 120, 90, true), normal: mk(128, 128, 255, false), orm: mk(255, 235, 0, false) };
  }
  return { map: placeholderTex.map, normalMap: placeholderTex.normal, roughnessMap: placeholderTex.orm, aoMap: placeholderTex.orm, roughness: 1, metalness: 0 };
}

/** An empty geometry with the attribute set of an HD model (same shader program before and after the swap). */
export function placeholderGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(0), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(0), 2));
  g.setAttribute('tangent', new THREE.BufferAttribute(new Float32Array(0), 4));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(0), 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
  return g;
}

/** Point a placeholder material at a loaded model's textures (no program change: same texture kinds). */
export function applyNatureTextures(mat: THREE.MeshStandardMaterial, t: NatureTemplate) {
  mat.map = t.map;
  mat.normalMap = t.normalMap;
  mat.roughnessMap = t.orm;
  mat.aoMap = t.orm;
}

/** Every nature model URL (offline prefetch). */
export async function natureUrls(): Promise<string[]> {
  const m = await manifest();
  if (!m) return [];
  return [assetUrl('models/nature/manifest.json'), ...Object.values(m.models).map((e) => assetUrl(`models/nature/${e.file}${e.hash ? `?v=${e.hash}` : ''}`))];
}
