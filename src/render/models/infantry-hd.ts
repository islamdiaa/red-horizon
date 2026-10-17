/**
 * HD infantry: rigged, baked soldiers (public/models/infantry/*.glb, built by tools/assets) drawn as an instanced
 * crowd animated from a vertex animation texture (VAT).
 *
 *   - One shared rig per species (anim.human.glb, anim.dog.glb): the skeleton and every clip baked into an RGBA16F
 *     texture of skinning matrices (texel (3 * bone + row, frame) = a row of the bone's matrix; clips stacked).
 *   - One GLB per (type, faction): a glTF skinned mesh (two bones per vertex), its far LOD and the usual atlas
 *     (base / ORM / normal / mask: team, emission) of every HD model.
 *   - InfantryCrowd draws all soldiers of a template with ONE instanced draw call per LOD: per instance the root
 *     matrix, two clip rows + a cross-fade weight (or a ragdoll pose slot), the team colour and the damage state.
 *     The vertex shader fetches two bones x two clips (linear filtering interpolates the frames).
 *   - Each soldier is still a ModelInstance (createModel): its root is positioned by the entity renderer as
 *     always, its muzzles follow the weapon bone (CPU-sampled from the same texture), height / radius come from the
 *     GLB, and a ragdoll can take over at the death pose (destruction-ragdoll.ts RagdollRig).
 *   - Low / Standard models, types without a GLB and anything still loading stay procedural (infantry.ts).
 *
 * Lifecycle (lazy loading, texture upload / release, context restore, battle teardown) follows hd.ts through its
 * extension hooks. All URLs go through assetUrl().
 */
import * as THREE from 'three';
import { assetUrl } from '../../platform/paths';
import type { ModelAnimState, ModelInstance, RagdollRig } from './types';
import { lodDistance, type ModelFaction } from './builder';
import { BODY_SHARED_UNIFORMS, BodyVariant, getDamageTexture, getDetailTexture, registerLitMaterial, teamGlossUniform, teamUniform } from './materials';
import { HD_IDLE_MS, HD_SHADOW_NB, hdIsOffscreen, hdModelsEnabled, hdNotifyReady, hdTier, pickSweep, registerHdExtension, type HdTier, type SweepItem } from './hd';
import { ClipLib, InfantryAnimator, TYPE_SET, type ClipInfo, type InfSet } from './infantry-hd-anim';

const TEAM_GREY = 0.7;
const VARIANT_SCORCH = [0, 0.38, 0.62, 1.0, 0.0];
const VARIANT_EMBER = [0, 0.15, 1.0, 0.45, 0.0];
/** Far-LOD distance of HD infantry as a multiple of the procedural LOD distance (HD bodies use HD_LOD_K). */
export const INF_LOD_K = 1.0;
/** Ragdoll pose slots per rig (the destruction system runs at most 24 ragdolls). */
const DYN_SLOTS = 32;
/** The common soldiers loaded on the loading screen. */
const COMMON: Record<ModelFaction, string[]> = { soviet: ['e1', 'e2', 'e3', 'dog'], allies: ['e1', 'e3', 'medi'] };

// ---------------------------------------------------------------------------------------------------------
// GLB parsing (no loaders: plain typed-array views; shared with tests/infantryhd.test.ts)

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface Glb {
  json: any;
  bin: Uint8Array;
}

export function parseGlb(buf: ArrayBuffer | Uint8Array): Glb {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB');
  const jl = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(u8.subarray(20, 20 + jl)));
  const bl = dv.getUint32(20 + jl, true);
  return { json, bin: u8.subarray(28 + jl, 28 + jl + bl) };
}

const COMP: Record<number, [number, (b: ArrayBuffer, o: number, n: number) => ArrayLike<number> & { length: number }]> = {
  5120: [1, (b, o, n) => new Int8Array(b, o, n)],
  5121: [1, (b, o, n) => new Uint8Array(b, o, n)],
  5122: [2, (b, o, n) => new Int16Array(b, o, n)],
  5123: [2, (b, o, n) => new Uint16Array(b, o, n)],
  5125: [4, (b, o, n) => new Uint32Array(b, o, n)],
  5126: [4, (b, o, n) => new Float32Array(b, o, n)],
};
const SIZE: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

/** An accessor as a packed array (de-interleaved; a fresh copy). */
export function readAccessor(g: Glb, index: number): { array: Int8Array | Uint8Array | Int16Array | Uint16Array | Uint32Array | Float32Array; size: number; normalized: boolean; count: number } {
  const a = g.json.accessors[index];
  const bv = g.json.bufferViews[a.bufferView];
  const [bytes, make] = COMP[a.componentType];
  const size = SIZE[a.type];
  const stride = bv.byteStride ?? bytes * size;
  const base = g.bin.byteOffset + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  // copy the view's bytes into an aligned buffer, then pick the components out of each element
  const span = stride * (a.count - 1) + bytes * size;
  const raw = new Uint8Array(span + (stride - ((span % stride) || stride)));
  raw.set(new Uint8Array(g.bin.buffer, base, span));
  const per = stride / bytes;
  const src = make(raw.buffer, 0, Math.floor(raw.byteLength / bytes));
  const out = new ((src as any).constructor)(a.count * size);
  for (let i = 0; i < a.count; i++) for (let k = 0; k < size; k++) out[i * size + k] = src[i * per + k];
  return { array: out, size, normalized: !!a.normalized, count: a.count };
}

/** The anim GLB's VAT as float32 (x = 3 * bone + row, y = frame). */
export function readVat(g: Glb): { data: Float32Array; half: Uint16Array; width: number; height: number; meta: any } {
  const meta = g.json.nodes[g.json.scenes[g.json.scene ?? 0].nodes[0]].extras.rh_anim;
  const bv = g.json.bufferViews[meta.vat.bufferView];
  const n = meta.vat.width * meta.vat.height * 4;
  const half = new Uint16Array(n);
  new Uint8Array(half.buffer).set(g.bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + n * 2));
  const data = new Float32Array(n);
  for (let i = 0; i < n; i++) data[i] = THREE.DataUtils.fromHalfFloat(half[i]);
  return { data, half, width: meta.vat.width, height: meta.vat.height, meta };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------------------------------------
// Rigs (shared skeleton + clips + VAT) and templates (one per GLB)

interface DynPool {
  data: Float32Array;
  tex: THREE.DataTexture;
  free: number[];
  dirty: boolean;
}

export interface Rig {
  name: string;
  bones: string[];
  index: Record<string, number>;
  parents: number[];
  rest: THREE.Vector3[];
  lib: ClipLib;
  vat: Float32Array;
  width: number;
  height: number;
  tex: THREE.DataTexture;
  dyn: DynPool;
  uniforms: Record<string, { value: unknown }>;
  depth: THREE.MeshDepthMaterial;
}

interface Template {
  key: string;
  type: string;
  faction: ModelFaction | null;
  set: InfSet;
  rig: Rig;
  geo: THREE.BufferGeometry;
  geoLo: THREE.BufferGeometry | null;
  maps: { map: THREE.Texture; orm: THREE.Texture; normal: THREE.Texture; mask: THREE.Texture };
  mat: THREE.MeshStandardMaterial;
  height: number;
  radius: number;
  points: { name: string; bone: number; at: THREE.Vector3; kind: string }[];
  released: boolean;
}

interface Entry {
  key: string;
  file: string;
  hash?: string;
  type: string;
  faction: ModelFaction | null;
  kind: string;
  buf: ArrayBuffer | null;
  tpl: Template | null;
  p: Promise<void> | null;
  failed: boolean;
  refs: number;
  lastUsed: number;
  bytes: number;
}

let manifestP: Promise<boolean> | null = null;
const entries = new Map<string, Entry>();
const rigs = new Map<string, Promise<Rig | null>>();
const rigReady = new Map<string, Rig>();
/** The loaded rigs (flat). */
const rigList: Rig[] = [];
const releaseQueue: Template[] = [];
let tierNow: HdTier = 'high';
let restoring = 0;

function url(file: string, hash?: string): string {
  return assetUrl(`models/infantry/${file}`) + (hash ? `?v=${hash}` : '');
}

function loadManifest(): Promise<boolean> {
  if (!manifestP) {
    manifestP = fetch(url('manifest.json'), { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((m: { models?: Record<string, { file: string; hash?: string; type: string; faction?: string | null; kind?: string }> } | null) => {
        for (const [key, e] of Object.entries(m?.models ?? {})) {
          if (entries.has(key)) continue;
          entries.set(key, {
            key, file: e.file, hash: e.hash, type: e.type, faction: (e.faction === 'soviet' || e.faction === 'allies') ? e.faction : null, kind: e.kind ?? 'infantry',
            buf: null, tpl: null, p: null, failed: false, refs: 0, lastUsed: 0, bytes: 0,
          });
        }
        return !!m?.models;
      });
  }
  return manifestP;
}

/** The entry a (type, owner faction) renders with: the faction's dressing, else any faction's (captured barracks). */
function entryFor(type: string, fac: ModelFaction): Entry | undefined {
  const e = entries.get(`${type}.${fac}`) ?? entries.get(type) ?? entries.get(`${type}.${fac === 'soviet' ? 'allies' : 'soviet'}`);
  return e && e.kind !== 'anim' ? e : undefined;
}

async function fetchBuf(file: string, hash?: string): Promise<ArrayBuffer> {
  const r = await fetch(url(file, hash), { credentials: 'same-origin' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.arrayBuffer();
}

function loadRig(name: string): Promise<Rig | null> {
  let p = rigs.get(name);
  if (!p) {
    const en = entries.get(`anim.${name}`);
    p = (en ? fetchBuf(en.file, en.hash) : Promise.reject(new Error('no clip set')))
      .then((buf) => {
        const rig = buildRig(parseGlb(buf));
        rigReady.set(name, rig);
        rigList.push(rig);
        return rig;
      })
      .catch((e) => {
        console.warn(`[infantry-hd] rig ${name}: ${(e as Error).message ?? e}; using the procedural infantry`);
        return null;
      });
    rigs.set(name, p);
  }
  return p;
}

let shadowChunk: string | null = null;
function infShadowChunk(): string {
  if (shadowChunk === null) {
    shadowChunk = THREE.ShaderChunk.shadowmap_vertex.replace(/(directionalLightShadows\[ i \]\.shadowNormalBias|pointLightShadows\[ i \]\.shadowNormalBias|spotLightShadows\[ i \]\.shadowNormalBias)/g, `$1 * ${HD_SHADOW_NB.toFixed(2)}`);
  }
  return shadowChunk;
}

/** Vertex skinning from the VAT (both the lit and the shadow depth programs). */
const VAT_PARS = /* glsl */ `
uniform highp sampler2D uVat;
uniform highp sampler2D uDyn;
uniform vec2 uVatSize;
uniform vec2 uDynSize;
attribute vec4 aJ;
attribute vec4 aW;
attribute vec4 aClip;
mat4 rhVatM( float row, float bone ) {
  float y = ( row + 0.5 ) / uVatSize.y;
  float x = ( bone * 3.0 + 0.5 ) / uVatSize.x;
  float dx = 1.0 / uVatSize.x;
  vec4 r0 = textureLod( uVat, vec2( x, y ), 0.0 );
  vec4 r1 = textureLod( uVat, vec2( x + dx, y ), 0.0 );
  vec4 r2 = textureLod( uVat, vec2( x + 2.0 * dx, y ), 0.0 );
  return mat4( r0.x, r1.x, r2.x, 0.0, r0.y, r1.y, r2.y, 0.0, r0.z, r1.z, r2.z, 0.0, r0.w, r1.w, r2.w, 1.0 );
}
mat4 rhDynM( float slot, float bone ) {
  ivec2 p = ivec2( int( bone ) * 3, int( slot ) );
  vec4 r0 = texelFetch( uDyn, p, 0 );
  vec4 r1 = texelFetch( uDyn, p + ivec2( 1, 0 ), 0 );
  vec4 r2 = texelFetch( uDyn, p + ivec2( 2, 0 ), 0 );
  return mat4( r0.x, r1.x, r2.x, 0.0, r0.y, r1.y, r2.y, 0.0, r0.z, r1.z, r2.z, 0.0, r0.w, r1.w, r2.w, 1.0 );
}
mat4 rhBone( float bone ) {
  if ( aClip.w >= 0.0 ) return rhDynM( aClip.w, bone );
  mat4 m = rhVatM( aClip.x, bone );
  if ( aClip.z > 0.002 ) m = m * ( 1.0 - aClip.z ) + rhVatM( aClip.y, bone ) * aClip.z;
  return m;
}
`;
const VAT_SKIN = /* glsl */ `
mat4 rhSkin = rhBone( aJ.x ) * aW.x;
if ( aW.y > 0.002 ) rhSkin += rhBone( aJ.y ) * aW.y;
`;

function buildRig(g: Glb): Rig {
  const v = readVat(g);
  const meta = v.meta;
  const bones: string[] = meta.bones;
  const index: Record<string, number> = {};
  bones.forEach((b, i) => (index[b] = i));
  const tex = new THREE.DataTexture(v.half, v.width, v.height, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter; // interpolates the frames (y); x is always sampled at texel centres
  tex.generateMipmaps = false;
  tex.flipY = false;
  tex.needsUpdate = true;
  tex.name = `vat-${meta.rig}`;
  const dynData = new Float32Array(v.width * DYN_SLOTS * 4);
  const dyn = new THREE.DataTexture(dynData, v.width, DYN_SLOTS, THREE.RGBAFormat, THREE.FloatType);
  dyn.minFilter = dyn.magFilter = THREE.NearestFilter;
  dyn.generateMipmaps = false;
  dyn.needsUpdate = true;
  const uniforms = {
    uVat: { value: tex }, uDyn: { value: dyn },
    uVatSize: { value: new THREE.Vector2(v.width, v.height) }, uDynSize: { value: new THREE.Vector2(v.width, DYN_SLOTS) },
  };
  const depth = new THREE.MeshDepthMaterial();
  depth.name = `inf-depth-${meta.rig}`;
  depth.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VAT_PARS}`)
      .replace('#include <skinbase_vertex>', `#include <skinbase_vertex>\n${VAT_SKIN}`)
      .replace('#include <skinning_vertex>', '#include <skinning_vertex>\ntransformed = ( rhSkin * vec4( transformed, 1.0 ) ).xyz;');
  };
  depth.customProgramCacheKey = () => 'rh-inf-depth-v1';
  const rig: Rig = {
    name: meta.rig, bones, index, parents: meta.parents, rest: (meta.rest as number[][]).map((p) => new THREE.Vector3(p[0], p[1], p[2])),
    lib: new ClipLib(meta.clips as ClipInfo[], meta.height ?? 0.39), vat: v.data, width: v.width, height: v.height, tex,
    dyn: { data: dynData, tex: dyn, free: Array.from({ length: DYN_SLOTS }, (_, i) => DYN_SLOTS - 1 - i), dirty: false },
    uniforms, depth,
  };
  return rig;
}

const BITMAP_OPTS: ImageBitmapOptions = { imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' };

async function decodeImage(bytes: Uint8Array, name: string, atlas: number, t: HdTier): Promise<ImageBitmap> {
  let bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/webp' }), BITMAP_OPTS);
  const want = t === 'high' && (name === 'base' || name === 'normal') ? atlas : Math.max(64, atlas >> 1);
  if (bmp.width > want) {
    const small = await createImageBitmap(bmp, { ...BITMAP_OPTS, resizeWidth: want, resizeHeight: Math.max(1, Math.round((bmp.height * want) / bmp.width)), resizeQuality: 'high' });
    bmp.close();
    bmp = small;
  }
  return bmp;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function buildTemplate(en: Entry, buf: ArrayBuffer, rig: Rig, t: HdTier): Promise<Template> {
  const g = parseGlb(buf);
  const j = g.json;
  const root = j.nodes[j.scenes[j.scene ?? 0].nodes[0]];
  const meta = root.extras?.rh ?? {};
  const atlas = Number(meta.atlas) || 512;
  const geos: THREE.BufferGeometry[] = [];
  for (const mesh of j.meshes) {
    const prim = mesh.primitives[0];
    const dq = mesh.extras?.rh_dequant ?? { c: [0, 0, 0], s: 1 };
    const pos = readAccessor(g, prim.attributes.POSITION);
    const P = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) for (let k = 0; k < 3; k++) P[i * 3 + k] = Math.max(-1, pos.array[i * 3 + k] / 32767) * dq.s + dq.c[k];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
    const nrm = readAccessor(g, prim.attributes.NORMAL);
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm.array, 3, true));
    const tan = readAccessor(g, prim.attributes.TANGENT);
    geo.setAttribute('tangent', new THREE.BufferAttribute(tan.array, 4, true));
    const uv = readAccessor(g, prim.attributes.TEXCOORD_0);
    geo.setAttribute('uv', new THREE.BufferAttribute(uv.array, 2, true));
    const jn = readAccessor(g, prim.attributes.JOINTS_0);
    geo.setAttribute('aJ', new THREE.BufferAttribute(jn.array, 4, false));
    const wt = readAccessor(g, prim.attributes.WEIGHTS_0);
    geo.setAttribute('aW', new THREE.BufferAttribute(wt.array, 4, true));
    const idx = readAccessor(g, prim.indices);
    geo.setIndex(new THREE.BufferAttribute(idx.array, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.2, 0), 0.6);
    geo.name = `inf-${en.key}-lod${mesh.extras?.lod ?? 0}`;
    geos[mesh.extras?.lod ?? geos.length] = geo;
  }
  // textures
  const byName: Record<string, THREE.Texture> = {};
  await Promise.all((j.images as any[]).map(async (im) => {
    const v = j.bufferViews[im.bufferView];
    const bytes = g.bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength);
    const bmp = await decodeImage(bytes, im.name, atlas, t);
    const tex = new THREE.Texture(bmp as unknown as HTMLImageElement);
    tex.flipY = false;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.anisotropy = im.name === 'mask' ? 1 : t === 'high' ? 8 : 4;
    tex.colorSpace = im.name === 'base' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.name = `inf-${en.key}-${im.name}`;
    tex.needsUpdate = true;
    byName[im.name] = tex;
  }));
  const maps = { map: byName.base, orm: byName.orm, normal: byName.normal, mask: byName.mask };
  if (!maps.map || !maps.orm || !maps.normal || !maps.mask) throw new Error('missing atlas images');
  // points (muzzles) under their joints: model-space bind positions
  const points: Template['points'] = [];
  const jointOf = new Map<number, number>();
  (j.skins[0].joints as number[]).forEach((n, i) => jointOf.set(n, i));
  for (const [ni, n] of (j.nodes as any[]).entries()) {
    if (!jointOf.has(ni)) continue;
    for (const c of n.children ?? []) {
      const cn = j.nodes[c];
      if (!cn.extras?.rh_point) continue;
      const bone = jointOf.get(ni)!;
      const at = new THREE.Vector3(...(cn.translation ?? [0, 0, 0])).add(rig.rest[bone]);
      points.push({ name: cn.name, bone, at, kind: cn.extras.rh_point });
    }
  }
  points.sort((a, b) => a.name.localeCompare(b.name));
  const set = (meta.set as InfSet) ?? TYPE_SET[en.type] ?? 'rifle';
  const tpl: Template = {
    key: en.key, type: en.type, faction: en.faction, set, rig, geo: geos[0], geoLo: geos[1] ?? null, maps,
    mat: null as unknown as THREE.MeshStandardMaterial, height: Number(meta.height) || 0.39, radius: Number(meta.radius) || 0.16, points, released: false,
  };
  tpl.mat = makeMaterial(tpl);
  return tpl;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function makeMaterial(t: Template): THREE.MeshStandardMaterial {
  const mp = t.maps;
  const m = new THREE.MeshStandardMaterial({
    map: mp.map, roughnessMap: mp.orm, metalnessMap: mp.orm, aoMap: mp.orm, normalMap: mp.normal, roughness: 1, metalness: 1, aoMapIntensity: 1,
  });
  const uniforms = {
    ...t.rig.uniforms,
    uMask: { value: mp.mask },
    uDmg: { value: getDamageTexture() },
    uDet: { value: getDetailTexture() },
    uSnowK: { value: 0.3 },
    ...BODY_SHARED_UNIFORMS,
  };
  m.userData.infUniforms = uniforms;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
${VAT_PARS}
attribute vec4 aTeam;
attribute vec4 aState;
varying vec4 vRhTeam;
varying vec4 vRhState;
varying vec3 vRhN;
varying vec3 vRhP;
varying float vRhPh;`)
      .replace('#include <skinbase_vertex>', `#include <skinbase_vertex>\n${VAT_SKIN}`)
      .replace('#include <skinnormal_vertex>', `#include <skinnormal_vertex>
vRhN = objectNormal;
objectNormal = ( rhSkin * vec4( objectNormal, 0.0 ) ).xyz;
#ifdef USE_TANGENT
objectTangent = ( rhSkin * vec4( objectTangent, 0.0 ) ).xyz;
#endif`)
      .replace('#include <skinning_vertex>', `#include <skinning_vertex>
vRhP = transformed;
transformed = ( rhSkin * vec4( transformed, 1.0 ) ).xyz;
vRhTeam = aTeam;
vRhState = aState;
#ifdef USE_INSTANCING
vRhPh = fract( sin( dot( instanceMatrix[3].xz, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ) * 6.2832;
#else
vRhPh = 0.0;
#endif`)
      .replace('#include <shadowmap_vertex>', infShadowChunk());
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uSnowK;
uniform sampler2D uDmg;
uniform sampler2D uDet;
uniform sampler2D uMask;
uniform float uBodyTime;
uniform float uRhSnow;
varying vec4 vRhTeam;
varying vec4 vRhState;
varying vec3 vRhN;
varying vec3 vRhP;
varying float vRhPh;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
vec4 rhMask = texture2D( uMask, vMapUv );
float rhEmis = rhMask.g * 4.0;
float rhMode = floor( rhMask.b * 4.0 + 0.5 );
vec3 rhLight = diffuseColor.rgb;
float surfK = 1.0 - smoothstep( 0.05, 0.4, rhEmis );
float uScorch = vRhState.x;
diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vRhTeam.rgb, rhMask.r );
diffuseColor.rgb *= mix( 0.3, 1.0, surfK );
vec3 rhNn = normalize( vRhN );
vec3 rhAn = abs( rhNn );
vec2 rhBp = rhAn.x > rhAn.y && rhAn.x > rhAn.z ? vRhP.zy : ( rhAn.y > rhAn.z ? vRhP.xz : vRhP.xy );
vec2 rhUv = rhBp * 6.0;
vec4 dmgT = texture2D( uDmg, rhUv * 0.43 );
float rhUp = clamp( rhNn.y, 0.0, 1.0 );
float scorch = smoothstep( 1.0 - uScorch, 1.25 - uScorch, texture2D( uDet, rhUv ).a ) * min( uScorch * 1.6, 1.0 );
diffuseColor.rgb *= 1.0 - 0.86 * scorch;
float rhSnow = 0.0;
if ( uRhSnow > 0.0 ) {
  float rhAo = texture2D( aoMap, vAoMapUv ).r;
  float rhSn2 = texture2D( uDet, vRhP.xz * 9.0 ).a;
  rhSnow = smoothstep( 0.6, 0.9, rhUp + ( rhSn2 - 0.5 ) * 0.1 ) * uRhSnow * uSnowK * surfK * smoothstep( 0.45, 0.8, rhAo ) * ( 1.0 - scorch );
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.76, 0.8, 0.87 ), clamp( rhSnow, 0.0, 1.0 ) );
}`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
  roughnessFactor *= texture2D( roughnessMap, vRoughnessMapUv ).g;
#endif
roughnessFactor = clamp( roughnessFactor + scorch * 0.35, 0.04, 1.0 );
roughnessFactor = mix( roughnessFactor, 0.8, rhSnow );
roughnessFactor = mix( roughnessFactor, roughnessFactor * 0.35, vRhTeam.a * rhMask.r * surfK );
// #include <roughnessmap_fragment>`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
metalnessFactor *= ( 1.0 - scorch * 0.8 ) * ( 1.0 - rhSnow );`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
float rhEA = 1.0;
if ( rhMode > 0.5 ) {
  float rhPh = vRhPh + dot( vRhP, vec3( 3.1, 1.7, 2.3 ) );
  if ( rhMode < 1.5 ) rhEA = fract( uBodyTime * 0.625 + rhPh * 0.159 ) < 0.3 ? 1.0 : 0.05;
  else if ( rhMode < 2.5 ) rhEA = 0.45 + 0.55 * ( 0.5 + 0.5 * sin( uBodyTime * 2.4 + rhPh ) );
  else if ( rhMode < 3.5 ) rhEA = 0.7 + 0.3 * sin( uBodyTime * 13.0 + rhPh ) * sin( uBodyTime * 7.3 + rhPh * 1.7 );
  else rhEA = fract( uBodyTime * 1.4 + rhPh * 0.159 ) < 0.08 ? 1.6 : 0.03;
}
totalEmissiveRadiance += vec3( 0.9, 1.4, 3.2 ) * vRhState.z + rhLight * rhEmis * vRhState.w * rhEA * ( 1.0 - scorch );
if ( vRhState.y > 0.0 ) {
  float rhFl = 0.55 + 0.45 * sin( uBodyTime * 6.3 + dmgT.a * 31.0 + dmgT.b * 17.0 );
  totalEmissiveRadiance += vec3( 1.7, 0.42, 0.08 ) * smoothstep( 0.55, 0.75, dmgT.g ) * scorch * 0.6 * rhFl * vRhState.y;
}`);
  };
  m.customProgramCacheKey = () => 'rh-inf-v1';
  m.name = `inf-${t.key}`;
  registerLitMaterial(m);
  return m;
}

function textureBytes(t: Template): number {
  let b = 0;
  for (const tex of [t.maps.map, t.maps.orm, t.maps.normal, t.maps.mask]) {
    const im = tex.image as { width?: number; height?: number } | null;
    b += (im?.width ?? 0) * (im?.height ?? 0) * 4 * (4 / 3);
  }
  return b;
}

function materialise(en: Entry): Promise<void> {
  if (en.tpl) return Promise.resolve();
  if (en.p) return en.p;
  const t = hdTier();
  en.p = (async () => {
    try {
      const rigName = en.type === 'dog' ? 'dog' : 'human';
      const [rig, buf] = await Promise.all([loadRig(rigName), en.buf ? Promise.resolve(en.buf) : fetchBuf(en.file, en.hash)]);
      en.buf = buf;
      if (!rig) throw new Error(`no ${rigName} clip set`);
      en.tpl = await buildTemplate(en, buf, rig, t);
      tierNow = t;
      en.bytes = textureBytes(en.tpl);
      en.lastUsed = performance.now();
      releaseQueue.push(en.tpl);
      hdNotifyReady(en.type, en.key);
    } catch (e) {
      en.failed = true;
      console.warn(`[infantry-hd] ${en.key}: ${(e as Error).message ?? e}; using the procedural model`);
    } finally {
      en.p = null;
    }
  })();
  ensureSweep();
  return en.p;
}

/** Is this type drawn by the HD crowd when ready (has a GLB in the manifest)? Synchronous: false before the manifest. */
export function isHdInfantryType(type: string): boolean {
  return INF_ON && type in TYPE_SET;
}
/** Tests / A-B comparisons: ?infhd=0 keeps the procedural infantry while the other HD models stay on. */
const INF_ON = typeof location === 'undefined' || new URLSearchParams(location.search).get('infhd') !== '0';

/** Lazy loading: 'ready' (createModel gives HD now), 'pending' (loading; hd.ts readyVersion bumps when done), 'none'. */
export function requestInfantryHd(type: string, fac: ModelFaction): 'ready' | 'pending' | 'none' {
  if (!hdModelsEnabled() || !isHdInfantryType(type)) return 'none';
  if (!manifestP) {
    void loadManifest().then((ok) => { if (ok) { const en = entryFor(type, fac); if (en) void materialise(en); } });
    return 'pending';
  }
  const en = entryFor(type, fac);
  if (!en) return entries.size ? 'none' : 'pending';
  if (en.failed) return 'none';
  en.lastUsed = performance.now();
  if (en.tpl) return 'ready';
  void materialise(en);
  return 'pending';
}

/** Loading screen: the factions' common soldiers + the given (type, faction) pairs. Never rejects. */
export async function preloadInfantryHd(factions: ModelFaction[], types: Iterable<[string, ModelFaction]> = []): Promise<void> {
  if (!hdModelsEnabled() || !INF_ON || !(await loadManifest())) return;
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('hdlazy') === '1') return;
  const want = new Set<Entry>();
  for (const f of factions) for (const u of COMMON[f] ?? []) { const en = entryFor(u, f); if (en) want.add(en); }
  for (const [t, f] of types) { if (!isHdInfantryType(t)) continue; const en = entryFor(t, f); if (en) want.add(en); }
  await Promise.all([...want].filter((en) => !en.tpl && !en.failed).map((en) => materialise(en)));
}

export function infantryHdStatus(): { loaded: string[]; pending: string[]; failed: string[]; rigs: string[]; textureMB: number; dynSlots: Record<string, number> } {
  const loaded: string[] = [];
  const pending: string[] = [];
  const failed: string[] = [];
  let b = 0;
  for (const en of entries.values()) {
    if (en.tpl) { loaded.push(en.key); b += en.bytes; } else if (en.p) pending.push(en.key);
    if (en.failed) failed.push(en.key);
  }
  const dynSlots: Record<string, number> = {};
  for (const [n, r] of rigReady) dynSlots[n] = DYN_SLOTS - r.dyn.free.length;
  return { loaded, pending, failed, rigs: [...rigReady.keys()], textureMB: Math.round((b / 1048576) * 10) / 10, dynSlots };
}

// ---------------------------------------------------------------------------------------------------------
// hd.ts lifecycle hooks

function dropTemplate(en: Entry): void {
  const t = en.tpl;
  if (!t) return;
  en.tpl = null;
  en.bytes = 0;
  for (const g of [t.geo, t.geoLo]) g?.dispose();
  t.mat.dispose();
  for (const tex of [t.maps.map, t.maps.orm, t.maps.normal, t.maps.mask]) {
    tex.dispose();
    (tex.image as ImageBitmap | null)?.close?.();
    tex.image = null;
  }
  const qi = releaseQueue.indexOf(t);
  if (qi >= 0) releaseQueue.splice(qi, 1);
}

registerHdExtension({
  textures() {
    const out: THREE.Texture[] = [];
    for (const en of entries.values()) if (en.tpl) out.push(en.tpl.maps.map, en.tpl.maps.orm, en.tpl.maps.normal, en.tpl.maps.mask);
    for (const r of rigReady.values()) out.push(r.tex, r.dyn.tex);
    return out;
  },
  release(renderer, max) {
    let n = 0;
    while (releaseQueue.length && n < max) {
      const t = releaseQueue.shift()!;
      if (t.released) continue;
      for (const tex of [t.maps.map, t.maps.orm, t.maps.normal, t.maps.mask]) {
        const aniso = tex === t.maps.mask ? 1 : Math.min(tex.anisotropy, renderer.capabilities.getMaxAnisotropy());
        if (tex.anisotropy !== aniso) tex.anisotropy = aniso;
        renderer.initTexture(tex);
        (tex.image as ImageBitmap | null)?.close?.();
        tex.image = null;
      }
      t.released = true;
      n++;
    }
    return n;
  },
  async restore() {
    // a new GL context: re-decode the closed atlases from the GLB bytes (procedural stand-ins meanwhile: new
    // instances render procedural until then; existing ones keep drawing once the textures are back)
    const list = [...entries.values()].filter((en) => en.tpl?.released && en.buf);
    restoring += list.length;
    await Promise.all(list.map(async (en) => {
      try {
        const t = en.tpl!;
        const g = parseGlb(en.buf!);
        const atlas = Number(g.json.nodes[g.json.scenes[0].nodes[0]].extras?.rh?.atlas) || 512;
        const byName: Record<string, THREE.Texture> = { base: t.maps.map, orm: t.maps.orm, normal: t.maps.normal, mask: t.maps.mask };
        for (const im of g.json.images) {
          const v = g.json.bufferViews[im.bufferView];
          const tex = byName[im.name];
          if (!tex) continue;
          tex.image = (await decodeImage(g.bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength), im.name, atlas, tierNow)) as unknown as HTMLImageElement;
          tex.needsUpdate = true;
        }
        t.released = false;
        releaseQueue.push(t);
      } catch {
        en.failed = true;
      } finally {
        restoring--;
      }
    }));
    for (const r of rigReady.values()) { r.tex.needsUpdate = true; r.dyn.tex.needsUpdate = true; }
  },
  releaseAll() {
    for (const en of entries.values()) if (en.tpl && en.refs === 0) dropTemplate(en);
  },
});

let sweepTimer: ReturnType<typeof setInterval> | null = null;
function ensureSweep(): void {
  if (sweepTimer || typeof setInterval === 'undefined') return;
  sweepTimer = setInterval(() => {
    const items: SweepItem[] = [];
    for (const en of entries.values()) items.push({ key: en.key, loaded: !!en.tpl, refs: en.refs, holds: 0, lastUsed: en.lastUsed, bytes: en.bytes });
    for (const k of pickSweep(items, performance.now(), hdTier(), HD_IDLE_MS)) dropTemplate(entries.get(k)!);
  }, 30000);
}

// ---------------------------------------------------------------------------------------------------------
// Crowd

/** Instanced attributes of one draw (a template's LOD). */
class Batch {
  readonly mesh: THREE.InstancedMesh;
  readonly geo: THREE.BufferGeometry;
  readonly clip: THREE.InstancedBufferAttribute;
  readonly team: THREE.InstancedBufferAttribute;
  readonly state: THREE.InstancedBufferAttribute;
  n = 0;
  private shared: string[];

  constructor(readonly tpl: Template, base: THREE.BufferGeometry, readonly cap: number, name: string) {
    // a wrapper geometry: the template's (shared) attributes + this batch's instanced ones
    const g = new THREE.BufferGeometry();
    this.shared = Object.keys(base.attributes);
    for (const k of this.shared) g.setAttribute(k, base.getAttribute(k));
    g.setIndex(base.getIndex());
    g.boundingSphere = base.boundingSphere;
    this.clip = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.team = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.state = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aClip', this.clip);
    g.setAttribute('aTeam', this.team);
    g.setAttribute('aState', this.state);
    this.geo = g;
    const m = new THREE.InstancedMesh(g, tpl.mat, cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.count = 0;
    m.frustumCulled = false;
    m.castShadow = true;
    m.receiveShadow = true;
    m.customDepthMaterial = tpl.rig.depth;
    m.name = name;
    m.userData.hd = true;
    this.mesh = m;
  }

  /** Upload only the instances in use this frame. */
  commit(): void {
    const n = this.n;
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (n === 0) return;
    for (const a of [this.clip, this.team, this.state] as THREE.InstancedBufferAttribute[]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, n * 4);
      a.needsUpdate = true;
    }
    const im = this.mesh.instanceMatrix;
    im.clearUpdateRanges();
    im.addUpdateRange(0, n * 16);
    im.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    // free only this batch's own buffers (the template's attributes are shared with other batches)
    for (const k of this.shared) this.geo.deleteAttribute(k);
    this.geo.setIndex(null);
    this.geo.dispose();
    this.mesh.dispose();
  }
}

const _m4 = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _cam = new THREE.Vector3();

/** One per battle (EntityRenderer): every HD soldier of the scene, drawn in a few instanced batches. */
export class InfantryCrowd {
  readonly group = new THREE.Group();
  private batches = new Map<Template, [Batch | null, Batch | null]>();
  /** Every batch (flat, for allocation-free per-frame loops). */
  private list: Batch[] = [];
  readonly members: HdInfantry[] = [];
  /** Draw calls this crowd issued in the last prepare (main pass; tests / perf). */
  stats = { batches: 0, instances: 0, far: 0 };

  constructor(scene: THREE.Scene) {
    this.group.name = 'infantry-crowd';
    scene.add(this.group);
  }

  add(m: HdInfantry): void {
    m.slotInCrowd = this.members.length;
    this.members.push(m);
    this.batchFor(m.tpl, 0);
  }

  remove(m: HdInfantry): void {
    const i = m.slotInCrowd;
    if (i < 0 || this.members[i] !== m) return;
    const last = this.members.pop()!;
    if (last !== m) {
      this.members[i] = last;
      last.slotInCrowd = i;
    }
    m.slotInCrowd = -1;
  }

  private batchFor(t: Template, lod: 0 | 1): Batch | null {
    let pair = this.batches.get(t);
    if (!pair) this.batches.set(t, (pair = [null, null]));
    if (!pair[lod]) {
      const base = lod === 0 ? t.geo : t.geoLo;
      if (!base) return null;
      const b = new Batch(t, base, 64, `inf-${t.key}-lod${lod}`);
      this.group.add(b.mesh);
      pair[lod] = b;
      this.list.push(b);
    }
    return pair[lod];
  }

  private grow(t: Template, lod: 0 | 1): Batch {
    const pair = this.batches.get(t)!;
    const old = pair[lod]!;
    const b = new Batch(t, lod === 0 ? t.geo : t.geoLo!, old.cap * 2, old.mesh.name);
    b.n = old.n;
    (b.mesh.instanceMatrix.array as Float32Array).set(old.mesh.instanceMatrix.array as Float32Array);
    (b.clip.array as Float32Array).set(old.clip.array as Float32Array);
    (b.team.array as Float32Array).set(old.team.array as Float32Array);
    (b.state.array as Float32Array).set(old.state.array as Float32Array);
    old.dispose();
    this.group.add(b.mesh);
    pair[lod] = b;
    this.list[this.list.indexOf(old)] = b;
    return b;
  }

  /**
   * Fill the instance buffers for this frame's camera (EntityRenderer.preRender, after its culling: culled and
   * hidden soldiers have root.visible = false).
   */
  prepare(camera: THREE.Camera, castShadow: boolean): void {
    const list = this.list;
    for (let i = 0; i < list.length; i++) list[i].n = 0;
    _cam.setFromMatrixPosition(camera.matrixWorld);
    // soldiers are small: the far body (~30 % of the triangles, same animation) from the procedural LOD distance on
    const lodD = lodDistance() * INF_LOD_K;
    const lodD2 = lodD * lodD;
    let inst = 0;
    let far = 0;
    const members = this.members;
    for (let mi = 0; mi < members.length; mi++) {
      const m = members[mi];
      const r = m.root;
      if (!r.visible || !r.parent) continue;
      const lo = m.tpl.geoLo && _v.copy(r.position).distanceToSquared(_cam) > lodD2 ? 1 : 0;
      let b = this.batchFor(m.tpl, lo)!;
      if (b.n >= b.cap) b = this.grow(m.tpl, lo);
      const i = b.n++;
      _m4.compose(r.position, r.quaternion, r.scale);
      _m4.toArray(b.mesh.instanceMatrix.array as Float32Array, i * 16);
      m.write(b.clip.array as Float32Array, b.team.array as Float32Array, b.state.array as Float32Array, i * 4);
      inst++;
      if (lo) far++;
    }
    let nb = 0;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      b.commit();
      b.mesh.castShadow = castShadow;
      if (b.n) nb++;
    }
    for (let i = 0; i < rigList.length; i++) {
      const r = rigList[i];
      if (r.dyn.dirty) { r.dyn.tex.needsUpdate = true; r.dyn.dirty = false; }
    }
    this.stats.batches = nb;
    this.stats.instances = inst;
    this.stats.far = far;
  }

  dispose(): void {
    for (const b of this.list) b.dispose();
    this.list.length = 0;
    this.batches.clear();
    this.members.length = 0;
    this.group.removeFromParent();
    if (activeCrowd === this) activeCrowd = null;
  }
}

let activeCrowd: InfantryCrowd | null = null;
/** The battle's crowd (EntityRenderer sets it): HD soldiers created while it is set are drawn by it. */
export function setInfantryCrowd(c: InfantryCrowd | null): void {
  activeCrowd = c;
}

// ---------------------------------------------------------------------------------------------------------
// Instances

const _rows = { a: 0, b: 0, w: 0 };
const _S = new Float32Array(12);
const _S2 = new Float32Array(12);
const _mA = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qa = new THREE.Quaternion();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _x = new THREE.Vector3();
const _m3 = new THREE.Matrix4();
const _pv = new THREE.Vector3();

/** Sample bone `b`'s skinning matrix (3 x 4 rows) at a fractional row into out (the linear filter's twin). */
export function sampleBone(vat: Float32Array, width: number, height: number, row: number, b: number, out: Float32Array): Float32Array {
  const r0 = Math.max(0, Math.min(height - 1, Math.floor(row)));
  const r1 = Math.min(height - 1, r0 + 1);
  const f = Math.min(1, Math.max(0, row - r0));
  const i0 = (r0 * width + b * 3) * 4;
  const i1 = (r1 * width + b * 3) * 4;
  for (let k = 0; k < 12; k++) out[k] = vat[i0 + k] + (vat[i1 + k] - vat[i0 + k]) * f;
  return out;
}

function rowsToMatrix(s: Float32Array, out: THREE.Matrix4): THREE.Matrix4 {
  return out.set(s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7], s[8], s[9], s[10], s[11], 0, 0, 0, 1);
}

/** Ragdoll particle order (destruction-ragdoll.ts). */
const PARTICLES = 11;

class HdInfantry implements ModelInstance {
  readonly root = new THREE.Group();
  readonly muzzles: THREE.Object3D[] = [];
  height: number;
  radius: number;
  readonly typeId: string;
  readonly hd = true;
  readonly anim: InfantryAnimator;
  private variant = 0;
  private slot = -1;
  private last = new THREE.Vector3(NaN, 0, 0);
  private teamCol: THREE.Color;
  private gloss: { value: number };
  private own: Batch | null = null;
  private crowd: InfantryCrowd | null;
  private disposed = false;
  private rel: { w: THREE.Matrix4; p: THREE.Matrix4 } | null = null;
  readonly ragdoll: RagdollRig;
  /** Index in the crowd's member list (-1: not in a crowd). */
  slotInCrowd = -1;

  constructor(readonly tpl: Template, readonly en: Entry, readonly proc: ModelInstance, teamHex: number, standalone: boolean) {
    this.typeId = proc.typeId ?? tpl.type;
    this.root.name = `model:${this.typeId}`;
    this.height = tpl.height;
    this.radius = tpl.radius;
    this.teamCol = teamUniform(teamHex, 1 / TEAM_GREY).value;
    this.gloss = teamGlossUniform(teamHex);
    this.anim = new InfantryAnimator(tpl.rig.lib, tpl.set, tpl.type, Math.random());
    for (const p of tpl.points) {
      if (p.kind !== 'muzzle') continue;
      this.muzzlePts.push(p);
      const o = new THREE.Object3D();
      o.name = p.name;
      o.position.copy(p.at);
      this.root.add(o);
      this.muzzles.push(o);
    }
    // the procedural parachute rides along (paratroopers): its canopy node is drawn by the procedural body
    const chute = proc.node?.('chute');
    if (chute && proc.root.children.length) {
      this.chuteModel = proc;
      proc.root.position.set(0, 0, 0);
      this.root.add(proc.root);
      proc.root.visible = false;
    }
    this.crowd = standalone ? null : activeCrowd;
    if (this.crowd) this.crowd.add(this);
    else {
      // standalone (thumbnails, previews): its own one-instance draw under the root (identity instance matrix)
      this.own = new Batch(tpl, tpl.geo, 1, `inf-${tpl.key}-solo`);
      this.own.n = 1;
      this.root.add(this.own.mesh);
    }
    this.ragdoll = {
      accepts: (kind: string) => kind === 'blown' && this.slot < 0 && tpl.rig.dyn.free.length > 0 && tpl.rig.name === 'human',
      joints: (out: Float32Array) => this.joints(out),
      pose: (p: Float32Array) => this.ragdollPose(p),
    };
    this.update({ time: 0, dt: 0, moving: false, speed: 0, firing: 0, firingMuzzle: 0, powered: true, health: 1, door: 0, load: 0, harvesting: false, charge: 1, dying: 0 });
  }

  private chuteModel: ModelInstance | null = null;
  private muzzlePts: Template['points'] = [];

  update(s: ModelAnimState): void {
    const r = this.root;
    const dt = Math.min(Math.max(s.dt, 0), 0.1);
    // ground speed from the root's motion (the entity renderer moves it before calling update)
    let sp = 0;
    if (Number.isFinite(this.last.x) && dt > 0) {
      const d = Math.hypot(r.position.x - this.last.x, r.position.z - this.last.z);
      sp = d > 1.5 ? 0 : d / dt;
    }
    this.last.copy(r.position);
    this.anim.scale = r.scale.x || 1;
    this.anim.update(s, sp, dt);
    // death looks (the procedural model's): burning chars, the electro shock flashes, explosions scorch
    if (s.dying > 0 && this.slot < 0) {
      const d = Math.min(1, s.dying);
      const k = s.deathKind ?? 'normal';
      if (k === 'burn') this.setVariant(d > 0.15 ? BodyVariant.Charred : BodyVariant.Damaged);
      else if (k === 'electro') this.setVariant(d < 0.55 && Math.floor(s.time * 22) % 2 === 0 ? BodyVariant.Electro : d < 0.55 ? BodyVariant.Damaged : BodyVariant.Charred);
      else if (k === 'blown' || k === 'crushed') this.setVariant(BodyVariant.Damaged);
    } else if (s.dying <= 0 && this.variant !== 0) this.setVariant(0);
    // the paratrooper's canopy (procedural): shown and animated while descending / deflating
    if (this.chuteModel) {
      const cm = this.chuteModel;
      if ((s.parachute ?? 0) > 0 || cm.root.visible) {
        cm.update(s);
        cm.node?.('body')?.scale.setScalar(1e-4); // only the canopy: the soldier is the HD body
        const ch = cm.node?.('chute');
        cm.root.visible = (s.parachute ?? 0) > 0 || (!!ch && ch.scale.x > 0.01);
      }
    }
    this.anim.rows(_rows);
    // muzzles follow their bones
    for (let i = 0; i < this.muzzles.length; i++) {
      const p = this.muzzlePts[i];
      this.boneMatrix(p.bone, _mA);
      this.muzzles[i].position.copy(p.at).applyMatrix4(_mA);
    }
    if (this.own) {
      this.write(this.own.clip.array as Float32Array, this.own.team.array as Float32Array, this.own.state.array as Float32Array, 0);
      this.own.commit();
    }
  }

  /** The current (cross-faded) skinning matrix of a bone, model space. */
  private boneMatrix(b: number, out: THREE.Matrix4): THREE.Matrix4 {
    const rig = this.tpl.rig;
    if (this.slot >= 0) {
      const o = (this.slot * rig.width + b * 3) * 4;
      for (let k = 0; k < 12; k++) _S[k] = rig.dyn.data[o + k];
      return rowsToMatrix(_S, out);
    }
    sampleBone(rig.vat, rig.width, rig.height, _rows.a, b, _S);
    if (_rows.w > 0.002) {
      sampleBone(rig.vat, rig.width, rig.height, _rows.b, b, _S2);
      for (let k = 0; k < 12; k++) _S[k] += (_S2[k] - _S[k]) * _rows.w;
    }
    return rowsToMatrix(_S, out);
  }

  /** Instance attributes (crowd.prepare / standalone update). */
  write(clip: Float32Array, team: Float32Array, state: Float32Array, o: number): void {
    this.anim.rows(_rows);
    clip[o] = _rows.a;
    clip[o + 1] = _rows.b;
    clip[o + 2] = _rows.w;
    clip[o + 3] = this.slot;
    const c = this.teamCol;
    team[o] = c.r;
    team[o + 1] = c.g;
    team[o + 2] = c.b;
    team[o + 3] = this.gloss.value;
    const v = this.variant;
    state[o] = VARIANT_SCORCH[v] ?? 0;
    state[o + 1] = VARIANT_EMBER[v] ?? 0;
    state[o + 2] = v === BodyVariant.Electro ? 1 : 0;
    state[o + 3] = v >= BodyVariant.Charred ? 0.12 : 2.6;
  }

  setVariant(v: number): void {
    this.variant = v;
  }

  node(name: string): THREE.Object3D | undefined {
    return this.root.getObjectByName(name);
  }

  // ---- ragdoll (blown deaths): the destruction system's verlet particles drive the rig through a pose slot

  private jointModel(name: string, offset: THREE.Vector3 | null, out: THREE.Vector3): THREE.Vector3 {
    const rig = this.tpl.rig;
    const b = rig.index[name];
    out.copy(rig.rest[b]);
    if (offset) out.add(offset);
    return out.applyMatrix4(this.boneMatrix(b, _m3));
  }

  private joints(out: Float32Array): void {
    this.root.updateMatrixWorld(true);
    const W = this.root.matrixWorld;
    const set = (i: number, name: string, off: THREE.Vector3 | null) => {
      this.jointModel(name, off, _pv).applyMatrix4(W);
      out[i * 3] = _pv.x;
      out[i * 3 + 1] = _pv.y;
      out[i * 3 + 2] = _pv.z;
    };
    set(0, 'hips', null);
    set(1, 'chest', OFF_CHEST);
    set(2, 'head', OFF_HEAD);
    set(3, 'upperarm_l', null);
    set(4, 'upperarm_r', null);
    set(5, 'hand_l', OFF_HAND_L);
    set(6, 'hand_r', OFF_HAND_R);
    set(7, 'thigh_l', null);
    set(8, 'thigh_r', null);
    set(9, 'foot_l', null);
    set(10, 'foot_r', null);
    // take a pose slot now (the ragdoll writes it from its first step) and remember the props in the hands
    const rig = this.tpl.rig;
    if (this.slot < 0 && rig.dyn.free.length) {
      const W0 = (n: string) => this.boneMatrix(rig.index[n], new THREE.Matrix4()).multiply(new THREE.Matrix4().makeTranslation(rig.rest[rig.index[n]]));
      const hr = W0('hand_r');
      const hl = W0('hand_l');
      this.rel = { w: hr.clone().invert().multiply(W0('weapon')), p: hl.clone().invert().multiply(W0('prop')) };
      // copy the current pose into the slot (so the first frame matches)
      const slot = rig.dyn.free.pop()!;
      for (let b = 0; b < rig.bones.length; b++) {
        this.boneMatrix(b, _mA);
        writeRows(rig.dyn.data, (slot * rig.width + b * 3) * 4, _mA);
      }
      this.slot = slot;
      rig.dyn.dirty = true;
    }
  }

  private ragdollPose(p: Float32Array): void {
    const rig = this.tpl.rig;
    if (this.slot < 0) return;
    const inv = _rootInv.copy(this.root.matrixWorld).invert();
    for (let i = 0; i < PARTICLES; i++) _pp[i].set(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]).applyMatrix4(inv);
    const R = rigFrames(rig);
    const ix = rig.index;
    // torso frame from the particles (pelvis -> chest, left -> right shoulder), relative to the rest frame
    _y.subVectors(_pp[1], _pp[0]).normalize();
    _z.subVectors(_pp[4], _pp[3]);
    _z.addScaledVector(_y, -_z.dot(_y)).normalize();
    _x.crossVectors(_y, _z).normalize();
    _mA.makeBasis(_x, _y, _z);
    _qT.setFromRotationMatrix(_mA).multiply(R.torsoInv);
    const base = this.slot * rig.width;
    const hips = rig.rest[ix.hips];
    // trunk: hips / spine / chest / neck rigid with the torso frame
    for (let k = 0; k < TRUNK.length; k++) {
      const b = ix[TRUNK[k]];
      _pv.subVectors(rig.rest[b], hips).applyQuaternion(_qT).add(_pp[0]);
      this.putBone(b, _pv, _qT, base);
    }
    // head: turned towards the head particle
    const nb = ix.neck;
    _v2.subVectors(rig.rest[nb], hips).applyQuaternion(_qT).add(_pp[0]);
    _qA.setFromUnitVectors(_dirA.copy(R.headDir).applyQuaternion(_qT), _dirB.subVectors(_pp[2], _v2).normalize()).multiply(_qT);
    _pv.subVectors(rig.rest[ix.head], rig.rest[nb]).applyQuaternion(_qA).add(_v2);
    this.putBone(ix.head, _pv, _qA, base);
    // limbs: straight from the root joint towards the end particle
    this.limb(ix.upperarm_l, ix.forearm_l, ix.hand_l, _pp[3], _pp[5], R.upper_l, R.fore_l, base);
    this.limb(ix.upperarm_r, ix.forearm_r, ix.hand_r, _pp[4], _pp[6], R.upper_r, R.fore_r, base);
    this.limb(ix.thigh_l, ix.shin_l, ix.foot_l, _pp[7], _pp[9], R.thigh_l, R.shin_l, base);
    this.limb(ix.thigh_r, ix.shin_r, ix.foot_r, _pp[8], _pp[10], R.thigh_r, R.shin_r, base);
    // props stay in the hands
    if (this.rel) {
      this.propBone(ix.weapon, ix.hand_r, this.rel.w, base);
      this.propBone(ix.prop, ix.hand_l, this.rel.p, base);
    }
    rig.dyn.dirty = true;
  }

  /** Write bone b's world transform (model space) into the pose slot as its skinning matrix. */
  private putBone(b: number | undefined, pos: THREE.Vector3, rot: THREE.Quaternion, base: number): void {
    if (b === undefined) return;
    const rig = this.tpl.rig;
    const w = _world[b].compose(pos, rot, _one);
    _m3.copy(w).multiply(_tr.makeTranslation(-rig.rest[b].x, -rig.rest[b].y, -rig.rest[b].z));
    writeRows(rig.dyn.data, (base + b * 3) * 4, _m3);
  }

  private limb(a: number, m: number, e: number, from: THREE.Vector3, to: THREE.Vector3, restA: THREE.Vector3, restM: THREE.Vector3, base: number): void {
    const rig = this.tpl.rig;
    const d = _dirB.subVectors(to, from);
    if (d.lengthSq() < 1e-10) d.set(0, -1, 0);
    d.normalize();
    const l1 = rig.rest[m].distanceTo(rig.rest[a]);
    const l2 = rig.rest[e].distanceTo(rig.rest[m]);
    _qA.setFromUnitVectors(_dirA.copy(restA).applyQuaternion(_qT), d).multiply(_qT);
    _qM.setFromUnitVectors(_dirA.copy(restM).applyQuaternion(_qT), d).multiply(_qT);
    this.putBone(a, from, _qA, base);
    _v2.copy(from).addScaledVector(d, l1);
    this.putBone(m, _v2, _qM, base);
    _v2.addScaledVector(d, l2);
    this.putBone(e, _v2, _qM, base);
  }

  private propBone(b: number | undefined, hand: number, rel: THREE.Matrix4, base: number): void {
    if (b === undefined) return;
    const rig = this.tpl.rig;
    _m3.copy(_world[hand]).multiply(rel).multiply(_tr.makeTranslation(-rig.rest[b].x, -rig.rest[b].y, -rig.rest[b].z));
    writeRows(rig.dyn.data, (base + b * 3) * 4, _m3);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    this.crowd?.remove(this);
    if (this.own) this.own.dispose();
    if (this.slot >= 0) {
      this.tpl.rig.dyn.free.push(this.slot);
      this.slot = -1;
    }
    this.proc.dispose();
    this.en.refs = Math.max(0, this.en.refs - 1);
    this.en.lastUsed = performance.now();
  }
}

const OFF_CHEST = new THREE.Vector3(0, 0.045, 0);
const OFF_HEAD = new THREE.Vector3(0.004, 0.021, 0);
const OFF_HAND_L = new THREE.Vector3(0.006, -0.014, -0.006);
const OFF_HAND_R = new THREE.Vector3(0.006, -0.014, 0.006);
const _rootInv = new THREE.Matrix4();
const _qT = new THREE.Quaternion();
const _qA = new THREE.Quaternion();
const _qM = new THREE.Quaternion();
const TRUNK = ['hips', 'spine', 'chest', 'neck'];
const _pp = Array.from({ length: PARTICLES }, () => new THREE.Vector3());
const _v2 = new THREE.Vector3();
const _dirA = new THREE.Vector3();
const _dirB = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);
const _tr = new THREE.Matrix4();
const _world = Array.from({ length: 64 }, () => new THREE.Matrix4());

function writeRows(data: Float32Array, o: number, m: THREE.Matrix4): void {
  const e = m.elements; // column-major
  data[o] = e[0]; data[o + 1] = e[4]; data[o + 2] = e[8]; data[o + 3] = e[12];
  data[o + 4] = e[1]; data[o + 5] = e[5]; data[o + 6] = e[9]; data[o + 7] = e[13];
  data[o + 8] = e[2]; data[o + 9] = e[6]; data[o + 10] = e[10]; data[o + 11] = e[14];
}

interface RigFrames {
  torsoInv: THREE.Quaternion;
  headDir: THREE.Vector3;
  upper_l: THREE.Vector3; fore_l: THREE.Vector3; upper_r: THREE.Vector3; fore_r: THREE.Vector3;
  thigh_l: THREE.Vector3; shin_l: THREE.Vector3; thigh_r: THREE.Vector3; shin_r: THREE.Vector3;
}
const frames = new WeakMap<Rig, RigFrames>();
/** Rest directions of the rig's segments (the bind pose, model space) for the ragdoll solve. */
function rigFrames(rig: Rig): RigFrames {
  let f = frames.get(rig);
  if (!f) {
    const P = (n: string) => rig.rest[rig.index[n]];
    const dir = (a: string, b: string) => new THREE.Vector3().subVectors(P(b), P(a)).normalize();
    const chestP = P('chest').clone().add(OFF_CHEST);
    const y = new THREE.Vector3().subVectors(chestP, P('hips')).normalize();
    const z = new THREE.Vector3().subVectors(P('upperarm_r'), P('upperarm_l'));
    z.addScaledVector(y, -z.dot(y)).normalize();
    const x = new THREE.Vector3().crossVectors(y, z).normalize();
    const torsoInv = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z)).invert();
    f = {
      torsoInv,
      headDir: new THREE.Vector3().subVectors(P('head').clone().add(OFF_HEAD), P('neck')).normalize(),
      upper_l: dir('upperarm_l', 'forearm_l'), fore_l: dir('forearm_l', 'hand_l'),
      upper_r: dir('upperarm_r', 'forearm_r'), fore_r: dir('forearm_r', 'hand_r'),
      thigh_l: dir('thigh_l', 'shin_l'), shin_l: dir('shin_l', 'foot_l'),
      thigh_r: dir('thigh_r', 'shin_r'), shin_r: dir('shin_r', 'foot_r'),
    };
    frames.set(rig, f);
  }
  return f;
}

/**
 * Wrap a freshly created procedural infantry instance (index.ts createModel) into its HD crowd instance, or return
 * null (HD off, not loaded, failed, or thumbnails while the atlases are already closed).
 */
export function createInfantryHd(proc: ModelInstance, type: string, fac: ModelFaction, teamHex: number): ModelInstance | null {
  if (!hdModelsEnabled() || !isHdInfantryType(type) || restoring > 0) return null;
  const en = entryFor(type, fac);
  const t = en?.tpl;
  if (!en || !t) return null;
  const offscreen = hdIsOffscreen();
  if (offscreen && t.released) return null;
  try {
    const m = new HdInfantry(t, en, proc, teamHex, offscreen || !activeCrowd);
    en.refs++;
    en.lastUsed = performance.now();
    return m;
  } catch (e) {
    console.warn(`[infantry-hd] ${t.key}: instance failed`, e);
    return null;
  }
}

/** Test hook: the animator of an HD instance (or null). */
export function infantryAnimatorOf(m: ModelInstance): InfantryAnimator | null {
  return m instanceof HdInfantry ? m.anim : null;
}
