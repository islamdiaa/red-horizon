import * as THREE from 'three';
import { hash2, Noise2D } from '../core/rng';
import { GameMap, T } from '../sim/map';
import { shadowDepthMaterial } from './models/materials';
import { gpuCaps } from './gpucaps';
import { ROAD_HALF, ROAD_REACH, roadsFor, type RoadNetwork } from './roads';
import { acquireTerrainTextures, classicLook, layerUniforms, LAYER_COUNT, releaseTerrainTextures, SLOT, type Climate, type TerrainTextureSet } from './terrain-materials';

/** Shared GLSL helpers (value noise / fbm). */
export const NOISE_GLSL = /* glsl */ `
float rh_hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float rh_noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = rh_hash(i), b = rh_hash(i + vec2(1.0, 0.0));
  float c = rh_hash(i + vec2(0.0, 1.0)), d = rh_hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float rh_fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * rh_noise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
  return s;
}
`;

let noiseTex: THREE.DataTexture | null = null;

/**
 * Tileable value-noise texture (256², repeat, mipmapped). Channel k holds noise with a lattice of
 * 16·2^k cells across the texture, so with uv = p / 16:
 *   r            ≈ rh_noise(p)          (one tap instead of four hashes)
 *   dot(t, W4)   ≈ rh_fbm(p)            (four octaves in one tap, W4 = vec4(.533,.267,.133,.067))
 * Shared by the terrain, water and atmosphere shaders.
 */
export function getNoiseTexture(): THREE.DataTexture {
  if (noiseTex) return noiseTex;
  const S = 256;
  const data = new Uint8Array(S * S * 4);
  const lat = (period: number, seed: number) => {
    const v = new Float32Array(period * period);
    for (let i = 0; i < v.length; i++) v[i] = hash2(i % period, (i / period) | 0, seed);
    return v;
  };
  for (let c = 0; c < 4; c++) {
    const period = 16 << c;
    const v = lat(period, 977 + c * 31);
    const cell = S / period;
    for (let y = 0; y < S; y++) {
      const fy = y / cell, iy = Math.floor(fy), ty = fy - iy, sy = ty * ty * (3 - 2 * ty);
      const y0 = (iy % period) * period, y1 = ((iy + 1) % period) * period;
      for (let x = 0; x < S; x++) {
        const fx = x / cell, ix = Math.floor(fx), tx = fx - ix, sx = tx * tx * (3 - 2 * tx);
        const x0 = ix % period, x1 = (ix + 1) % period;
        const a = v[y0 + x0], b = v[y0 + x1], cc = v[y1 + x0], d = v[y1 + x1];
        const n = a + (b - a) * sx + (cc - a) * sy + (a - b - cc + d) * sx * sy;
        data[(y * S + x) * 4 + c] = Math.round(n * 255);
      }
    }
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  noiseTex = tex;
  return tex;
}

let dummyShadow: THREE.DepthTexture | null = null;

/**
 * A 1x1 depth texture in shadow-compare mode: the default for custom `sampler2DShadow` uniforms until a
 * real shadow map exists (WebGL refuses a draw whose shadow sampler has a non-compare texture bound).
 */
export function getDummyShadowTexture(): THREE.DepthTexture {
  if (!dummyShadow) {
    dummyShadow = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    dummyShadow.compareFunction = THREE.LessEqualCompare;
    dummyShadow.minFilter = dummyShadow.magFilter = THREE.LinearFilter;
    dummyShadow.needsUpdate = true; // allocate it (an unuploaded texture would bind as a plain RGBA one)
  }
  return dummyShadow;
}

/** GLSL helpers over getNoiseTexture() (declare `uniform sampler2D tNoise;` first). */
export const TNOISE_GLSL = /* glsl */ `
float tn_noise(vec2 p) { return texture2D(tNoise, p * 0.0625).r; }
float tn_fbm(vec2 p) { return dot(texture2D(tNoise, p * 0.0625), vec4(0.5333, 0.2667, 0.1333, 0.0667)); }
`;

const SUB = 2; // vertices per cell edge

export type { Climate } from './terrain-materials';

/** Ground palettes (sRGB) per climate: grassDark, grassLight, grassDry, sand, dirt, rockDark, rockLight. */
const PALETTES: Record<Climate, number[][]> = {
  temperate: [[0.22, 0.31, 0.13], [0.38, 0.46, 0.2], [0.55, 0.5, 0.3], [0.68, 0.6, 0.44], [0.47, 0.36, 0.23], [0.33, 0.31, 0.29], [0.5, 0.47, 0.43]],
  winter: [[0.74, 0.79, 0.85], [0.88, 0.91, 0.95], [0.55, 0.58, 0.58], [0.6, 0.6, 0.6], [0.42, 0.4, 0.39], [0.36, 0.37, 0.4], [0.55, 0.57, 0.6]],
  desert: [[0.66, 0.52, 0.33], [0.78, 0.64, 0.42], [0.5, 0.46, 0.26], [0.86, 0.73, 0.52], [0.6, 0.42, 0.27], [0.5, 0.33, 0.25], [0.68, 0.48, 0.36]],
};

/** Base-dressing colours (sRGB) per climate: trampled ground, bare / churned, packed path, concrete. */
const DRESS: Record<Climate, { worn: number[]; bare: number[]; path: number[]; rut: number[]; conc: number[] }> = {
  temperate: { worn: [0.43, 0.4, 0.25], bare: [0.37, 0.29, 0.2], path: [0.38, 0.31, 0.22], rut: [0.25, 0.2, 0.15], conc: [0.52, 0.51, 0.49] },
  winter: { worn: [0.73, 0.76, 0.81], bare: [0.5, 0.48, 0.47], path: [0.52, 0.49, 0.47], rut: [0.38, 0.35, 0.33], conc: [0.5, 0.51, 0.53] },
  desert: { worn: [0.64, 0.51, 0.35], bare: [0.53, 0.4, 0.28], path: [0.54, 0.42, 0.3], rut: [0.42, 0.32, 0.23], conc: [0.63, 0.58, 0.51] },
};
const glsl3 = (c: number[]) => `vec3(${c.map((v) => v.toFixed(3)).join(', ')})`;

/** Texels of the deformation map per map cell. */
const DRES = 4;
/** Texels of the base-dressing mask (props.ts: worn ground, concrete aprons, paths) per map cell. */
export const BASE_RES = 4;
/** Fine crater height range encoded in the deformation map's red channel (world units, +-). */
const DEFORM_RANGE = 0.6;
/** Deepest a crater can dig below the original ground (world units). */
const MAX_DIG = 1.1;

/**
 * Persistent, purely visual terrain damage (the simulation's heightAt never changes):
 * craters, burn marks and tread ruts. Coordinates are map cells (x, y) = world (x, z).
 */
export interface TerrainDeformApi {
  /**
   * Blast crater: a bowl `depth` deep with a raised, churned rim; repeated hits dig deeper (capped).
   * A negative depth heals: the ground within the radius moves back toward its original height by up to
   * |depth| (never past it) and the churned soil / burn fade in proportion (craters fading out over time).
   */
  deform(x: number, y: number, radius: number, depth: number): void;
  /** Persistent scorch / burn on the ground (0..1 amount, accumulates). */
  scorch(x: number, y: number, radius: number, amount?: number): void;
  /** Tread ruts from (x0, y0) to (x1, y1): two grooves `width` apart, pressed into snow, sand and mud. */
  rut(x0: number, y0: number, x1: number, y1: number, width: number, depth?: number): void;
  /** Visual ground height including craters (renderHeight). */
  renderHeight(x: number, y: number): number;
}

export interface TerrainUniforms {
  uTime: { value: number };
  uGrid: { value: THREE.Vector4 };      // x, z, radius, strength
  uGridColor: { value: THREE.Color };
  uWet: { value: number };
  uSnow: { value: number };
  uPal: { value: THREE.Vector3[] };
  tDeform: { value: THREE.Texture };
  /** Base dressing mask (BASE_RES texels per cell): r worn ground, g concrete apron, b packed path, a apron edge kerb. */
  tBase: { value: THREE.Texture };
  /** Road network mask (roads.ts: ROAD_RES texels per cell): r closeness to the centre line, g main / track, b wear. */
  tRoad: { value: THREE.Texture };
  uMapSize: { value: THREE.Vector2 };
}

/**
 * Per terrain vertex: closeness to open water, 1 at the water's edge to 0 three cells inland (chamfer distance over
 * the cells). The textured shading puts its shoreline bands (wet mud, pebbles) only where water really is near.
 */
function waterProximity(map: GameMap, vw: number, vh: number): Float32Array {
  const W = map.w, H = map.h;
  const d = new Float32Array(W * H).fill(1e9);
  for (let i = 0; i < W * H; i++) if (map.terrain[i] === T.Water) d[i] = 0;
  // two chamfer passes (1 / 1.414)
  for (let pass = 0; pass < 2; pass++) {
    const fwd = pass === 0;
    for (let k = 0; k < W * H; k++) {
      const i = fwd ? k : W * H - 1 - k;
      const x = i % W, y = (i / W) | 0;
      let v = d[i];
      for (const [dx, dy, c] of fwd ? CHAMFER_FWD : CHAMFER_BWD) {
        const qx = x + dx, qy = y + dy;
        if (qx < 0 || qy < 0 || qx >= W || qy >= H) continue;
        const q = d[qy * W + qx] + c;
        if (q < v) v = q;
      }
      d[i] = v;
    }
  }
  const out = new Float32Array(vw * vh);
  for (let j = 0; j < vh; j++) for (let i = 0; i < vw; i++) {
    const x = i / SUB, y = j / SUB;
    let m = 1e9;
    for (let dy = -1; dy <= 0; dy++) for (let dx = -1; dx <= 0; dx++) {
      const cx = Math.floor(x + dx * 0.5 + 0.25), cy = Math.floor(y + dy * 0.5 + 0.25);
      if (cx >= 0 && cy >= 0 && cx < W && cy < H) m = Math.min(m, d[cy * W + cx]);
    }
    out[j * vw + i] = Math.max(0, Math.min(1, 1 - (m - 0.5) / 3));
  }
  return out;
}
const CHAMFER_FWD = [[-1, 0, 1], [0, -1, 1], [-1, -1, 1.414], [1, -1, 1.414]] as const;
const CHAMFER_BWD = [[1, 0, 1], [0, 1, 1], [1, 1, 1.414], [-1, 1, 1.414]] as const;

/** Road colour (sRGB) of the low-quality procedural shading: asphalt, ploughed snow, packed sand. */
const ROAD_LOW: Record<Climate, number[]> = { temperate: [0.3, 0.3, 0.3], winter: [0.56, 0.58, 0.62], desert: [0.66, 0.53, 0.38] };

/**
 * Fragment shader parts of the textured terrain (medium / high): per-pixel layer weights from the terrain types,
 * slope, shoreline, base dressing, roads and craters; the strongest layers sampled from the texture arrays
 * (top-down, or triplanar on steep ground) and height-blended; then ore, burn, snow, ruts and wetness on top.
 * `high` samples the three strongest layers and adds the anti-tiling (two offset copies of the dominant layer
 * blended by a low-frequency noise); medium (integrated GPUs) samples the two strongest: the dominant one in full,
 * the second one's colour only, from above, where it shows.
 */
function texturedGlsl(climate: Climate, high: boolean) {
  const winter = climate === 'winter', desert = climate === 'desert';
  const HALF = ROAD_HALF.main.toFixed(3);
  // how much of the open ground is the variation layer (meadow / wind-packed snow / cracked earth)
  const G2: Record<Climate, [string, string]> = { temperate: ['0.40', '0.64'], winter: ['0.42', '0.66'], desert: ['0.52', '0.72'] };
  // trampled ground: packed snow in winter, bare earth elsewhere; churned crater soil: dry earth in the desert
  const TRAMPLE = winter ? SLOT.Ground2 : SLOT.Dirt;
  const CHURN = desert ? SLOT.Dirt : SLOT.Mud;
  const common = /* glsl */ `
    uniform float uTime;
    uniform vec4 uGrid;
    uniform vec3 uGridColor;
    uniform float uWet;
    uniform float uSnow;
    uniform sampler2D tNoise;
    uniform sampler2D tDeform;
    uniform sampler2D tBase;
    uniform sampler2D tRoad;
    uniform vec2 uMapSize;
    uniform sampler2DArray tTerA;
    uniform sampler2DArray tTerN;
    uniform vec4 uLayT[${LAYER_COUNT}];
    uniform vec4 uLayP[${LAYER_COUNT}];
    varying vec4 vSplat;
    varying vec2 vOre;
    varying vec3 vWPos;
    varying vec3 vWNormal;
    varying float vWater;
    ${TNOISE_GLSL}
    vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }
    // one layer projected from above; \`anti\` (high, the dominant layer only): two offset copies blended by a slow
    // noise k, which hides the tiling
    void terPlanar(int i, vec2 wp, vec2 dx, vec2 dy, float k, bool anti, out vec4 a, out vec4 n) {
      float s = uLayT[i].w, L = float(i);
      vec2 uv = wp * s, gx = dx * s, gy = dy * s;
      ${high ? `if (anti) {
        float l = k * 6.0, ia = floor(l), f = fract(l);
        vec2 oa = fract(sin(vec2(3.1, 7.7) * ia) * 43.17), ob = fract(sin(vec2(3.1, 7.7) * (ia + 1.0)) * 43.17);
        vec4 a0 = textureGrad(tTerA, vec3(uv + oa, L), gx, gy), a1 = textureGrad(tTerA, vec3(uv + ob, L), gx, gy);
        vec4 n0 = textureGrad(tTerN, vec3(uv + oa, L), gx, gy), n1 = textureGrad(tTerN, vec3(uv + ob, L), gx, gy);
        // the copy with the higher texel wins the cross-fade (no ghosting)
        float b = smoothstep(0.25, 0.75, f + (n1.b - n0.b) * 0.4);
        a = mix(a0, a1, b);
        n = mix(n0, n1, b);
        return;
      }` : ''}
      a = textureGrad(tTerA, vec3(uv, L), gx, gy);
      n = textureGrad(tTerN, vec3(uv, L), gx, gy);
    }
    // one layer projected along the three axes (cliffs: no stretching); pert = world-space normal offset. The top
    // projection is the planar sample (same anti-tiling), so there is no seam where the shading switches over.
    void terTri(int i, vec3 wp, vec3 bw, vec2 dx, vec2 dy, vec3 dpx, vec3 dpy, float k, bool anti, out vec4 a, out vec4 n, out vec3 pert) {
      float s = uLayT[i].w, L = float(i);
      vec2 gxx = vec2(dpx.z, -dpx.y) * s, gyx = vec2(dpy.z, -dpy.y) * s;
      vec2 gxz = vec2(dpx.x, -dpx.y) * s, gyz = vec2(dpy.x, -dpy.y) * s;
      vec4 ax = textureGrad(tTerA, vec3(vec2(wp.z, -wp.y) * s, L), gxx, gyx);
      vec4 nx = textureGrad(tTerN, vec3(vec2(wp.z, -wp.y) * s, L), gxx, gyx);
      vec4 ay, ny;
      terPlanar(i, wp.xz, dx, dy, k, anti, ay, ny);
      vec4 az = textureGrad(tTerA, vec3(vec2(wp.x, -wp.y) * s, L), gxz, gyz);
      vec4 nz = textureGrad(tTerN, vec3(vec2(wp.x, -wp.y) * s, L), gxz, gyz);
      a = ax * bw.x + ay * bw.y + az * bw.z;
      n = nx * bw.x + ny * bw.y + nz * bw.z;
      vec2 tX = nx.rg * 2.0 - 1.0, tY = ny.rg * 2.0 - 1.0, tZ = nz.rg * 2.0 - 1.0;
      pert = bw.x * vec3(0.0, tX.y, tX.x) + bw.y * vec3(tY.x, 0.0, -tY.y) + bw.z * vec3(tZ.x, tZ.y, 0.0);
    }
    // a layer's graded albedo (linear), height, roughness and normal offset
    void terLayer(int i, vec3 wp, vec2 dx, vec2 dy, vec3 dpx, vec3 dpy, vec3 bw, bool tri, float k, bool anti, out vec3 alb, out float hgt, out float rough, out vec3 pert) {
      vec4 a, n;
      if (tri) terTri(i, wp, bw, dx, dy, dpx, dpy, k, anti, a, n, pert);
      else {
        terPlanar(i, wp.xz, dx, dy, k, anti, a, n);
        vec2 t = n.rg * 2.0 - 1.0;
        pert = vec3(t.x, 0.0, -t.y);
      }
      pert *= uLayP[i].y;
      alb = a.rgb * uLayT[i].rgb;
      hgt = n.b;
      rough = clamp((n.a * 255.0 - 128.0) / 127.0, 0.04, 1.0);
    }`;
  const map = /* glsl */ `
    vec2 p = vWPos.xz;
    vec3 nW = normalize(vWNormal);
    float n1 = tn_fbm(p * 0.11);
    float n2 = tn_fbm(p * 0.9 + 3.7);
    vec4 n34 = texture2D(tNoise, p * (7.0 / 16.0));
    float n3 = n34.r;
    float n4 = n34.b;
    vec4 sp = vSplat / max(0.001, dot(vSplat, vec4(1.0)));
    // ---- layer weights
    float W[${LAYER_COUNT}];
    for (int i = 0; i < ${LAYER_COUNT}; i++) W[i] = 0.0;
    float g2 = smoothstep(${G2[climate][0]}, ${G2[climate][1]}, n1 + (n2 - 0.5) * 0.3);
    W[${SLOT.Ground}] = sp.x * (1.0 - g2);
    W[${SLOT.Ground2}] = sp.x * g2;
    W[${SLOT.Dirt}] = sp.w + sp.x * smoothstep(0.72, 0.88, n2 + (n4 - 0.5) * 0.12) * 0.7;
    W[${SLOT.Rock}] = sp.z;
    W[${SLOT.Sand}] = sp.y;
    float slope = 1.0 - clamp(nW.y, 0.0, 1.0);
    float cliff = smoothstep(0.26, 0.5, slope + (n3 - 0.5) * 0.1);
    // shoreline: wet mud at the waterline, pebbles a little above it, sand on the lake bed
    float hw = vWPos.y + 0.32;
    float nearWater = smoothstep(0.0, 0.35, vWater);
    float rhShoreWet = smoothstep(0.16, 0.0, hw + (n3 - 0.5) * 0.05) * (1.0 - cliff) * nearWater;
    float bed = smoothstep(0.0, -0.06, hw);
    float bankK = smoothstep(0.35, 0.8, vWater + (n2 - 0.5) * 0.25) * smoothstep(-0.1, 0.02, hw) * smoothstep(0.7, 0.3, hw) * (1.0 - cliff);
    W[${SLOT.Gravel}] += bankK * smoothstep(0.4, 0.65, n3 + n4 * 0.25) * 1.6;
    W[${SLOT.Sand}] += bankK * 0.5 * (1.0 - sp.z);
    W[${SLOT.Mud}] += rhShoreWet * (1.0 - bed) * 1.2;
    W[${SLOT.Sand}] += bed * 2.5;
    // base dressing (props.ts): trampled ground and packed paths between structures, concrete aprons
    vec2 duv = vWPos.xz / uMapSize;
    float dIn = step(0.0, duv.x) * step(0.0, duv.y) * step(duv.x, 1.0) * step(duv.y, 1.0);
    vec4 bm = texture2D(tBase, duv) * dIn;
    float bGround = (1.0 - cliff) * (1.0 - bed) * (1.0 - sp.z * 0.8);
    float wornK = smoothstep(0.0, 0.85, bm.r * (0.8 + 0.4 * n2) + (n3 - 0.5) * 0.18) * bGround;
    float bareK = smoothstep(0.55, 1.15, bm.r * (0.7 + 0.5 * n1) + bm.b * 0.3 + (n3 - 0.5) * 0.25) * bGround;
    float pathD = (1.0 - bm.b) * 0.6 + (n4 - 0.5) * 0.05;
    float onPath = step(0.02, bm.b) * bGround;
    float pathK = smoothstep(0.46, 0.22, pathD + (n3 - 0.5) * 0.14) * onPath;
    float ruts = smoothstep(0.06, 0.02, abs(pathD - 0.14)) * onPath * smoothstep(0.3, 0.6, n2 + n4 * 0.3);
    float concK = smoothstep(0.46, 0.54, bm.g + (n4 - 0.5) * 0.05) * (1.0 - cliff) * (1.0 - bed);
    W[${TRAMPLE}] += wornK * 0.9;
    W[${SLOT.Dirt}] += bareK * 1.3 + pathK * 1.8;
    // roads (roads.ts): the surface in the core, dirt and gravel shoulders, twin wheel ruts
    vec4 rm = texture2D(tRoad, duv) * dIn;
    float roadD = (1.0 - rm.r) * ${ROAD_REACH.toFixed(3)};
    float roadMain = smoothstep(0.55, 0.85, rm.g);
    float rEdge = roadD + (n3 - 0.5) * 0.2 + (n2 - 0.5) * 0.12;
    float roadOn = step(0.004, rm.a) * (1.0 - cliff) * (1.0 - bed);
    float roadCore = smoothstep(${HALF} + 0.12, ${HALF} - 0.1, rEdge) * roadOn;
    float roadShoulder = smoothstep(${HALF} + 0.8, ${HALF} + 0.08, rEdge) * roadOn * (1.0 - roadCore);
    float roadRuts = smoothstep(0.075, 0.025, abs(roadD - ${HALF} * 0.5)) * roadCore * (0.6 + 0.4 * smoothstep(0.3, 0.7, n2));
    W[${SLOT.Road}] += roadCore * roadMain * 3.0;
    W[${SLOT.Dirt}] += roadCore * (1.0 - roadMain) * 2.4 + roadShoulder * (0.7 + 0.3 * n3);
    W[${SLOT.Gravel}] += roadShoulder * roadMain * smoothstep(0.45, 0.7, n4) * 0.9;${desert ? `
    // wind-blown sand drifts across the desert roads
    W[${SLOT.Ground}] += (roadCore + roadShoulder) * smoothstep(0.6, 0.78, n1 + (n2 - 0.5) * 0.45) * 3.2;` : ''}
    // ore fields: stony, rust-stained ground
    float ore = smoothstep(0.08, 0.62, vOre.x * 1.25 + (n3 - 0.5) * 0.45 + (n4 - 0.5) * 0.2);
    W[${SLOT.Dirt}] += ore * 1.6;
    W[${SLOT.Gravel}] += ore * smoothstep(0.5, 0.8, n2) * 0.8;
    // craters: churned soil
    vec4 dmg = mix(vec4(0.5, 0.0, 0.0, 0.0), texture2D(tDeform, duv), dIn);
    W[${CHURN}] += smoothstep(0.05, 0.6, dmg.a) * 3.0;
    // cliffs and concrete aprons take over
    for (int i = 0; i < ${LAYER_COUNT}; i++) W[i] *= (1.0 - cliff) * (1.0 - concK);
    W[${SLOT.Rock}] += cliff * 1.5;
    W[${SLOT.Concrete}] += concK * 3.0;
    // ---- the strongest layers (three on high, two on medium)
    int i0 = 0, i1 = 1, i2 = 2;
    float w0 = -1.0, w1 = -1.0, w2 = -1.0;
    for (int i = 0; i < ${LAYER_COUNT}; i++) {
      float w = W[i];
      if (w > w0) { w2 = w1; i2 = i1; w1 = w0; i1 = i0; w0 = w; i0 = i; }
      else if (w > w1) { w2 = w1; i2 = i1; w1 = w; i1 = i; }
      else if (w > w2) { w2 = w; i2 = i; }
    }
    w1 = max(w1, 0.0);
    w2 = ${high ? 'max(w2, 0.0)' : '0.0'};
    float ws = max(1e-4, w0 + w1 + w2);
    w0 /= ws; w1 /= ws; w2 /= ws;
    vec3 dpx = dFdx(vWPos), dpy = dFdy(vWPos);
    vec2 tdx = dpx.xz, tdy = dpy.xz;
    float tk = n1; // (the anti-tiling's slow variation: the large-patch noise)
    // triplanar on steep ground only; the side projections fade in from nothing, so the switch is seamless
    bool tri = abs(nW.y) < 0.86;
    vec3 bw = pow(abs(nW), vec3(4.0));
    bw.xz *= smoothstep(0.88, 0.7, abs(nW.y));
    bw /= dot(bw, vec3(1.0));
    vec3 al0, al1, al2, pe0, pe1, pe2;
    float h0, h1, h2, r0, r1, r2;
    terLayer(i0, vWPos, tdx, tdy, dpx, dpy, bw, tri, tk, true, al0, h0, r0, pe0);
    ${high ? `terLayer(i1, vWPos, tdx, tdy, dpx, dpy, bw, tri, tk, false, al1, h1, r1, pe1);
    if (w2 > 0.08) terLayer(i2, vWPos, tdx, tdy, dpx, dpy, bw, tri, tk, false, al2, h2, r2, pe2);
    else { al2 = al1; h2 = 0.0; r2 = r1; pe2 = vec3(0.0); w2 = 0.0; }` : `// medium: the second layer is its colour only, projected from above, where it shows (one texture fetch instead of
    // two, or six on cliffs); it settles in the dominant layer's low spots and takes its roughness and relief
    al1 = al0; h1 = 1.0 - h0; r1 = r0; pe1 = pe0;
    if (w1 > 0.03) al1 = textureGrad(tTerA, vec3(vWPos.xz * uLayT[i1].w, float(i1)), tdx * uLayT[i1].w, tdy * uLayT[i1].w).rgb * uLayT[i1].rgb;
    else w1 = 0.0;
    al2 = al1; h2 = 0.0; r2 = r1; pe2 = vec3(0.0);`}
    // height blend: where weights are close, the material whose texel stands higher (stones, tufts) wins
    // (a layer's height only counts in proportion to its weight: no speckles from faint layers)
    float a0 = w0 + h0 * uLayP[i0].x * min(1.0, w0 * 3.0);
    float a1 = w1 > 0.0 ? w1 + h1 * uLayP[i1].x * min(1.0, w1 * 3.0) : -1.0;
    float a2 = w2 > 0.0 ? w2 + h2 * uLayP[i2].x * min(1.0, w2 * 3.0) : -1.0;
    float ma = max(a0, max(a1, a2)) - 0.2;
    float b0 = max(a0 - ma, 0.0), b1 = max(a1 - ma, 0.0), b2 = max(a2 - ma, 0.0);
    float bs = max(1e-4, b0 + b1 + b2);
    b0 /= bs; b1 /= bs; b2 /= bs;
    vec3 col = al0 * b0 + al1 * b1 + al2 * b2;
    float terH = h0 * b0 + h1 * b1 + h2 * b2;
    float terR = r0 * b0 + r1 * b1 + r2 * b2;
    vec3 terPert = pe0 * b0 + pe1 * b1 + pe2 * b2;
    // large, soft tone variation (breaks up what tiling is left at long zoom); a touch of cavity shade
    col *= (0.9 + 0.2 * n1) * (0.9 + 0.2 * terH);
    // ---- on top of the materials
    // concrete aprons: cast slabs, one per cell, each its own tone, with seams
    vec2 slabF = abs(fract(p) - 0.5);
    float seam = smoothstep(0.475, 0.492, max(slabF.x, slabF.y));
    float slabTone = 0.9 + 0.16 * fract(sin(dot(floor(p), vec2(12.99, 78.23))) * 437.58);
    col *= mix(1.0, slabTone * (1.0 - seam * 0.42), concK);
    float concStain = uWet * concK > 0.001 ? smoothstep(0.52, 0.8, tn_fbm(p * 0.8 + 11.0)) : 0.0;
    float concEdge = 1.0 - smoothstep(0.5, 0.85, bm.g);
    // contact shade under the walls; wheel ruts on paths and roads
    col *= 1.0 - smoothstep(0.0, 1.0, bm.a) * 0.32 * (1.0 - cliff);
    col *= 1.0 - ruts * pathK * 0.35 - roadRuts * 0.32;
    // ore stains the ground rusty (mottled, with bright flecks), gems leave a violet tint; the stain follows the
    // material underneath (stones keep their shape)
    float fleck = ore > 0.001 ? smoothstep(0.78, 0.97, tn_noise(p * 31.0)) : 0.0;
    vec3 oreTint = mix(vec3(1.55, 0.92, 0.5), vec3(1.0, 0.85, 1.35), vOre.y) * (0.8 + 0.4 * n3) * (1.0 + fleck * 0.8);
    col = mix(col, col * oreTint * (0.85 + 0.3 * terH), ore * 0.9);
    // burnt ground
    float burn = smoothstep(0.02, 0.9, dmg.g) * (0.7 + 0.3 * n4);
    col = mix(col, col * vec3(0.2, 0.18, 0.16) + vec3(0.01, 0.008, 0.006), burn * 0.85);
    // snow: peaks, weather snow cover${winter ? ', ledges, plough banks and packed snow on the roads' : ''}
    float upward = smoothstep(0.55, 0.85, nW.y);
    float peak = smoothstep(3.2, 5.0, vWPos.y + n2 * 0.8) * smoothstep(0.35, 0.7, nW.y);
    float snowCover = max(peak, uSnow * upward * smoothstep(0.25, 0.6, n1 * 0.6 + n3 * 0.4 + uSnow * 0.5)) * (1.0 - bed);
    ${winter ? `snowCover = max(snowCover, sp.z * smoothstep(0.8, 0.95, nW.y + (n3 - 0.5) * 0.25) * 0.85 * (1.0 - bed));
    snowCover = max(snowCover, concK * smoothstep(0.5, 0.85, concEdge * 0.4 + n1 * 0.45 + n3 * 0.4 - 0.1) * 0.75);
    float plough = roadOn * smoothstep(${HALF} + 0.75, ${HALF} + 0.1, rEdge + (n4 - 0.5) * 0.3) * smoothstep(${HALF} - 0.35, ${HALF} + 0.1, rEdge) * smoothstep(0.25, 0.6, n2 + n3 * 0.4);
    float packed = roadCore * (1.0 - smoothstep(0.18, 0.07, abs(roadD - ${HALF} * 0.5))) * smoothstep(0.2, 0.75, n1 + (n3 - 0.5) * 0.4) * 0.7;
    snowCover = max(snowCover, max(plough * 0.95, packed));` : ''}
    // snow settles in the low parts first
    float snowK = smoothstep(0.0, 1.0, clamp(snowCover * 1.35 - (terH - 0.5) * 0.6 * (1.0 - snowCover), 0.0, 1.0));
    snowK *= 1.0 - smoothstep(0.3, 0.9, dmg.a) * 0.6;
    if (snowK > 0.004) {
      vec3 sa, spe;
      float sh, sr;
      terLayer(${SLOT.Snow}, vWPos, tdx, tdy, dpx, dpy, bw, false, tk, false, sa, sh, sr, spe);
      col = mix(col, sa, snowK);
      terPert = mix(terPert, spe, snowK);
      terR = mix(terR, sr, snowK);
      terH = mix(terH, sh, snowK);
    }
    // tread ruts show in snow (packed, blue-grey), sand and mud; barely on grass
    float snowy = ${winter ? 'max(snowK, sp.x * (1.0 - cliff))' : 'snowK'};
    float rutK = dmg.b * max(max(snowy, sp.y * 0.8), max(sp.w * 0.6, 0.15));
    col = mix(col, col * mix(vec3(0.62, 0.58, 0.52), vec3(0.7, 0.77, 0.88), snowy), clamp(rutK * 1.4, 0.0, 0.85));
    // rain: darker ground, puddles in the low spots
    float wetK = uWet * (1.0 - snowK);
    col *= 1.0 - wetK * 0.32;
    float puddle = wetK > 0.001 ? wetK * smoothstep(0.42, 0.2, terH + (tn_fbm(p * 0.6) - 0.5) * 0.45) * (1.0 - cliff) : 0.0;
    col *= 1.0 - puddle * 0.3;
    terPert *= 1.0 - puddle * 0.9;
    diffuseColor.rgb = col;`;
  const rough = /* glsl */ `#include <roughnessmap_fragment>
    roughnessFactor = terR;
    roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.45, wetK);
    roughnessFactor = mix(roughnessFactor, 0.28, rhShoreWet * (1.0 - bed));
    roughnessFactor = mix(roughnessFactor, 0.05, puddle);
    roughnessFactor = mix(roughnessFactor, 0.22, uWet * concStain * concK);`;
  const normal = /* glsl */ `#include <normal_fragment_maps>
    {
      // material normals (world space) -> view space
      vec3 nWorld = normalize(nW + terPert);
      normal = normalize((viewMatrix * vec4(nWorld, 0.0)).xyz);
      // crater rims, tread ruts and road ruts as a screen-space derivative bump (world units); the slab seams are
      // only shaded (a pixel-thin groove glints like a wire at RTS zoom)
      float dh = (dmg.r - 0.5) * ${(DEFORM_RANGE * 2).toFixed(2)} - dmg.b * 0.09 * (0.4 + snowy) - roadRuts * 0.02;
      vec2 dHdxy = vec2(dFdx(dh), dFdy(dh)) * 1.6;
      vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
      vec3 rr1 = cross(sy, normal), rr2 = cross(normal, sx);
      float det = dot(sx, rr1) * faceDirection;
      vec3 bn = abs(det) * normal - sign(det) * (dHdxy.x * rr1 + dHdxy.y * rr2);
      normal = dot(bn, bn) > 1e-24 ? normalize(bn) : normal; // (det = 0 on degenerate pixels: normalize(0) is NaN)
    }`;
  const emissive = /* glsl */ `#include <emissivemap_fragment>
    if (uGrid.w > 0.0) {
      vec2 gd = abs(fract(vWPos.xz) - 0.5);
      float line = smoothstep(0.47, 0.5, max(gd.x, gd.y));
      float fall = 1.0 - smoothstep(uGrid.z * 0.4, uGrid.z, distance(vWPos.xz, uGrid.xy));
      totalEmissiveRadiance += uGridColor * line * fall * uGrid.w * 0.6;
    }
    // gem fields glimmer faintly in their flecks
    totalEmissiveRadiance += srgb(vec3(0.6, 0.35, 0.9)) * vOre.y * ore * fleck * 0.08;`;
  return { common, map, rough, normal, emissive };
}

export class TerrainMesh implements TerrainDeformApi {
  readonly mesh: THREE.Mesh;
  readonly uniforms: TerrainUniforms;
  /**
   * Rendered ground height per vertex (2 per cell, includes craters) as a float texture, for GPU particle
   * collisions: uv = (x, z) * heightUvXf.xy + heightUvXf.zw.
   */
  readonly heightTexture: THREE.DataTexture;
  readonly heightUvXf: THREE.Vector4;
  /** Fine deformation map (DRES texels per cell): r crater relief, g scorch, b ruts, a churned soil. */
  readonly deformTexture: THREE.DataTexture;
  /** Base-dressing mask (see TerrainUniforms.tBase); written by props.ts, uploaded with markBase(). */
  readonly baseTexture: THREE.DataTexture;
  readonly baseData: Uint8Array;
  /** The map's road network (roads.ts) and its mask texture. */
  readonly roads: RoadNetwork;
  readonly roadTexture: THREE.DataTexture;
  /** Scanned material layers (medium / high; null on low). */
  readonly textures: TerrainTextureSet | null;
  private geo: THREE.BufferGeometry;
  private oreAttr: THREE.BufferAttribute;
  private vw: number;
  private vh: number;
  private baseH: Float32Array;
  private heightData: Float32Array;
  private deformData: Uint8Array;
  private heightDirty = false;
  private heightUploadT = 0;
  /** deform / scorch calls so far (lets the effects system see that someone else owns craters). */
  deformCalls = 0;

  constructor(private map: GameMap, readonly climate: Climate = 'temperate', quality: 'low' | 'medium' | 'high' = 'high') {
    const vw = map.w * SUB + 1, vh = map.h * SUB + 1;
    this.vw = vw;
    this.vh = vh;
    const n = vw * vh;
    const pos = new Float32Array(n * 3);
    const splat = new Float32Array(n * 4);
    const ore = new Float32Array(n * 2);
    const detail = new Noise2D(map.seed + 31);

    // per-cell terrain weights, sampled at sub-vertices from the 4 surrounding cells
    const cellWeights = (cx: number, cy: number): [number, number, number, number] => {
      cx = Math.max(0, Math.min(map.w - 1, cx));
      cy = Math.max(0, Math.min(map.h - 1, cy));
      const t = map.terrain[map.idx(cx, cy)];
      switch (t) {
        case T.Sand: return [0, 1, 0, 0];
        case T.Rock: return [0, 0, 1, 0];
        case T.Dirt: return [0.25, 0, 0, 0.75];
        case T.Water: return [0, 0.55, 0, 0.45];
        default: return [1, 0, 0, 0];
      }
    };

    for (let j = 0; j < vh; j++) {
      for (let i = 0; i < vw; i++) {
        const k = j * vw + i;
        const x = i / SUB, y = j / SUB;
        let h = map.heightAt(x, y);
        // extra relief on rocky ground (impassable, so units never stand there)
        const cx = Math.floor(Math.min(map.w - 1, x)), cy = Math.floor(Math.min(map.h - 1, y));
        let rockiness = 0;
        for (let dy = -1; dy <= 0; dy++) for (let dx = -1; dx <= 0; dx++) {
          const qx = Math.floor(x + dx * 0.5 + 0.25), qy = Math.floor(y + dy * 0.5 + 0.25);
          if (map.inBounds(qx, qy) && map.terrain[map.idx(qx, qy)] === T.Rock) rockiness += 0.25;
        }
        if (rockiness > 0) h += (detail.fbm(x * 0.9, y * 0.9, 3) - 0.35) * 0.9 * rockiness;
        else h += (detail.value(x * 2.3, y * 2.3) - 0.5) * 0.025;
        pos[k * 3] = x;
        pos[k * 3 + 1] = h;
        pos[k * 3 + 2] = y;

        // blend weights from neighbouring cells (smooth borders)
        const w = [0, 0, 0, 0];
        let tot = 0;
        for (let dy = -1; dy <= 0; dy++) for (let dx = -1; dx <= 0; dx++) {
          const sx = x + dx * 0.9 + 0.45, sy = y + dy * 0.9 + 0.45;
          const c = cellWeights(Math.floor(sx), Math.floor(sy));
          for (let q = 0; q < 4; q++) w[q] += c[q];
          tot++;
        }
        for (let q = 0; q < 4; q++) splat[k * 4 + q] = w[q] / tot;
        void cx; void cy;
      }
    }

    const idx: number[] = [];
    for (let j = 0; j < vh - 1; j++) {
      for (let i = 0; i < vw - 1; i++) {
        const a = j * vw + i, b = a + 1, c = a + vw, d = c + 1;
        // alternate diagonals for a less regular look
        if ((i + j) & 1) idx.push(a, c, b, b, c, d);
        else idx.push(a, c, d, a, d, b);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSplat', new THREE.BufferAttribute(splat, 4));
    this.oreAttr = new THREE.BufferAttribute(ore, 2);
    this.oreAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aOre', this.oreAttr);
    if (quality !== 'low' && !classicLook('terrain')) geo.setAttribute('aWater', new THREE.BufferAttribute(waterProximity(map, vw, vh), 1));
    geo.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    this.geo = geo;
    this.refreshOre();
    // deformation support: original heights, a height texture for particle collisions, the fine map
    (geo.attributes.position as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
    (geo.attributes.normal as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
    this.baseH = new Float32Array(n);
    this.heightData = new Float32Array(n);
    for (let k = 0; k < n; k++) this.baseH[k] = this.heightData[k] = pos[k * 3 + 1];
    this.heightTexture = new THREE.DataTexture(this.heightData, vw, vh, THREE.RedFormat, THREE.FloatType);
    // (32-bit float filters only with OES_texture_float_linear, otherwise it would sample as zero)
    this.heightTexture.minFilter = this.heightTexture.magFilter = gpuCaps.floatLinear ? THREE.LinearFilter : THREE.NearestFilter;
    this.heightTexture.generateMipmaps = false;
    this.heightTexture.needsUpdate = true;
    this.heightUvXf = new THREE.Vector4(SUB / vw, SUB / vh, 0.5 / vw, 0.5 / vh);
    const dw = map.w * DRES, dh = map.h * DRES;
    this.deformData = new Uint8Array(dw * dh * 4);
    for (let i = 0; i < dw * dh; i++) this.deformData[i * 4] = 128;
    this.deformTexture = new THREE.DataTexture(this.deformData, dw, dh, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.deformTexture.minFilter = this.deformTexture.magFilter = THREE.LinearFilter;
    this.deformTexture.generateMipmaps = false;
    this.deformTexture.needsUpdate = true;
    this.baseData = new Uint8Array(map.w * BASE_RES * map.h * BASE_RES * 4);
    this.baseTexture = new THREE.DataTexture(this.baseData, map.w * BASE_RES, map.h * BASE_RES, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.baseTexture.minFilter = this.baseTexture.magFilter = THREE.LinearFilter;
    this.baseTexture.generateMipmaps = false;
    this.baseTexture.needsUpdate = true;

    // road network (render only, deterministic from the map): a distance-field mask the shaders read
    this.roads = roadsFor(map);
    this.roadTexture = new THREE.DataTexture(this.roads.mask, map.w * this.roads.res, map.h * this.roads.res, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.roadTexture.minFilter = this.roadTexture.magFilter = THREE.LinearFilter;
    this.roadTexture.generateMipmaps = false;
    this.roadTexture.needsUpdate = true;

    this.uniforms = {
      uTime: { value: 0 },
      uGrid: { value: new THREE.Vector4(0, 0, 0, 0) },
      uGridColor: { value: new THREE.Color(0.3, 1.0, 0.6) },
      uWet: { value: 0 },
      uSnow: { value: 0 },
      // linear: decoded once here instead of nine vec3 pow() calls in every pixel of the Low shading
      uPal: { value: PALETTES[climate].map(([r, g, b]) => new THREE.Vector3(r ** 2.2, g ** 2.2, b ** 2.2)) },
      tDeform: { value: this.deformTexture },
      tBase: { value: this.baseTexture },
      tRoad: { value: this.roadTexture },
      uMapSize: { value: new THREE.Vector2(map.w, map.h) },
    };
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.93, metalness: 0.0 });
    const uni = this.uniforms;
    const tNoise = { value: getNoiseTexture() };
    const low = quality === 'low' || classicLook('terrain');
    const dress = DRESS[climate];
    // medium / high: scanned material layers (loaded in the background; flat placeholder colours until then)
    this.textures = low ? null : acquireTerrainTextures(climate, quality === 'high' ? 4 : 2);
    const lowCompile = (shader: THREE.WebGLProgramParametersWithUniforms) => {
      Object.assign(shader.uniforms, uni, { tNoise });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          attribute vec4 aSplat;
          attribute vec2 aOre;
          varying vec4 vSplat;
          varying vec2 vOre;
          varying vec3 vWPos;
          varying vec3 vWNormal;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vSplat = aSplat;
          vOre = aOre;
          vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vWNormal = normal;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform float uTime;
          uniform vec4 uGrid;
          uniform vec3 uGridColor;
          uniform float uWet;
          uniform float uSnow;
          uniform vec3 uPal[7];
          uniform sampler2D tNoise;
          uniform sampler2D tDeform;
          uniform sampler2D tBase;
          uniform sampler2D tRoad;
          uniform vec2 uMapSize;
          varying vec4 vSplat;
          varying vec2 vOre;
          varying vec3 vWPos;
          varying vec3 vWNormal;
          ${TNOISE_GLSL}
          vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }
          // detail relief per ground type: grass clumps, wind ripples in sand, craggy rock, pebbly dirt
          float rh_detail(vec2 q, vec4 sp) {
            float g = tn_noise(q * 3.0) + 0.5 * tn_noise(q * 9.0);
            float s = sin(dot(q, vec2(0.8, 0.6)) * 10.0 + tn_noise(q * 1.3) * 7.0) * 0.5 + 0.5;
            float r = tn_noise(q * 2.2) + 0.6 * tn_noise(q * 6.5) + 0.35 * tn_noise(q * 17.0);
            return g * (sp.x + sp.w) * 0.55 + s * sp.y * 0.4 + r * sp.z * 1.25;
          }`)
        .replace('#include <map_fragment>', `
          vec2 p = vWPos.xz;
          vec3 nW = normalize(vWNormal);
          float n1 = tn_fbm(p * 0.11);
          float n2 = tn_fbm(p * 0.9 + 3.7);
          // one tap, two octaves: the texture's b channel runs at 4x the r frequency
          vec4 n34 = texture2D(tNoise, p * (7.0 / 16.0));
          float n3 = n34.r;
          float n4 = n34.b;
          vec3 grassDark = uPal[0];
          vec3 grassLight = uPal[1];
          vec3 grassDry = uPal[2];
          vec3 grass = mix(grassDark, grassLight, smoothstep(0.3, 0.7, n1));
          grass = mix(grass, grassDry, smoothstep(0.55, 0.85, n2) * 0.55);
          grass *= 0.86 + 0.28 * n3;
          grass = mix(grass, grass * vec3(0.7, 0.8, 0.6), step(0.82, n4) * 0.5);
          vec3 sand = uPal[3] * (0.9 + 0.18 * n2) * (0.94 + 0.12 * n4);
          vec3 dirt = uPal[4] * (0.85 + 0.3 * n2) * (0.9 + 0.2 * n3);
          // rock: triplanar so cliff faces are not stretched; horizontal strata
          vec3 tw = nW * nW; tw *= tw; tw /= dot(tw, vec3(1.0));
          ${low ? `float rn = tn_noise(p * 2.6);
          float rnf = n4;` : `vec4 rx = texture2D(tNoise, vWPos.zy * (2.6 / 16.0)), rz = texture2D(tNoise, vWPos.xy * (2.6 / 16.0)), ry = texture2D(tNoise, p * (2.6 / 16.0));
          float rn = rx.r * tw.x + rz.r * tw.z + ry.r * tw.y;
          float rnf = rx.b * tw.x + rz.b * tw.z + ry.b * tw.y;`}
          // layered strata: each band its own tone, a dark seam under every ledge, a lit lip on top
          float rsy = vWPos.y * 3.4 + rn * 1.1 + rnf * 0.45;
          float rLayer = floor(rsy), rLf = fract(rsy);
          float rTone = fract(sin(rLayer * 12.9898 + 4.1) * 43758.5453);
          vec3 rock = mix(uPal[5], uPal[6], 0.2 + 0.5 * rTone + 0.3 * rnf) * (0.84 + 0.3 * rn);
          rock *= (0.7 + 0.3 * smoothstep(0.0, 0.14, rLf)) * (1.0 + 0.14 * smoothstep(0.78, 0.98, rLf));
          vec4 sp = vSplat / max(0.001, dot(vSplat, vec4(1.0)));
          // noisy blend borders
          sp.y = smoothstep(0.0, 1.0, sp.y + (n3 - 0.5) * 0.35 * sp.y * (1.0 - sp.y) * 4.0);
          vec3 col = grass * sp.x + sand * sp.y + rock * sp.z + dirt * sp.w;
          col /= max(0.001, sp.x + sp.y + sp.z + sp.w);
          // steep slopes show rock
          float slope = 1.0 - clamp(nW.y, 0.0, 1.0);
          float cliff = smoothstep(0.28, 0.55, slope);
          col = mix(col, rock * 0.9, cliff);
          ${climate === 'winter' ? `// snow lies on the flatter rock ledges and tops
          col = mix(col, srgb(vec3(0.84, 0.88, 0.94)) * (0.9 + 0.1 * n3), sp.z * smoothstep(0.8, 0.95, nW.y + (n3 - 0.5) * 0.25) * 0.85);` : ''}
          // shoreline: a dark, glossy band of wet sand above the waterline, a silty lake bed below it
          float hw = vWPos.y + 0.32;
          float rhShoreWet = smoothstep(0.16, 0.0, hw + (n3 - 0.5) * 0.05) * (1.0 - cliff);
          float bed = smoothstep(0.0, -0.06, hw);
          col = mix(col, col * vec3(0.58, 0.56, 0.52), rhShoreWet * 0.85);
          ${low ? '' : `// riverbank gravel: speckled pebbles in a band along the waterline
          float bankK = smoothstep(0.32, 0.12, hw + (n2 - 0.5) * 0.12) * smoothstep(-0.08, 0.02, hw) * (1.0 - cliff);
          float pebble = smoothstep(0.62, 0.78, texture2D(tNoise, p * (13.0 / 16.0)).a);
          col = mix(col, mix(col * 0.55, uPal[6] * (0.8 + 0.4 * n4), step(0.5, n3)), pebble * bankK * 0.75);`}
          vec3 lakeBed = mix(sand * vec3(0.86, 0.84, 0.76), sand * vec3(0.5, 0.56, 0.46), smoothstep(-0.05, -0.45, hw));
          lakeBed *= 0.9 + 0.2 * (sin(dot(p, vec2(0.7, 0.71)) * 13.0 + n2 * 6.0) * 0.5 + 0.5);
          col = mix(col, lakeBed, bed);
          // ore stains the ground rusty (mottled, with bright flecks), gems leave a violet tint
          // noisy, soft field edges (the per-vertex density alone shows the half-cell grid)
          float ore = smoothstep(0.08, 0.62, vOre.x * 1.25 + (n3 - 0.5) * 0.45 + (n4 - 0.5) * 0.2);
          float fleck = smoothstep(0.78, 0.97, tn_noise(p * 31.0));
          vec3 oreStain = mix(srgb(vec3(0.52, 0.33, 0.16)), srgb(vec3(0.36, 0.28, 0.42)), vOre.y);
          oreStain *= (0.72 + 0.5 * n3) * (1.0 + fleck * 0.9);
          col = mix(col, oreStain, ore * 0.85);
          vec2 duv = vWPos.xz / uMapSize;
          float dIn = step(0.0, duv.x) * step(0.0, duv.y) * step(duv.x, 1.0) * step(duv.y, 1.0);
          // base dressing (props.ts): trampled ground and packed paths between structures, concrete aprons
          vec4 bm = texture2D(tBase, duv) * dIn;
          float bGround = (1.0 - cliff) * (1.0 - bed) * (1.0 - sp.z * 0.8);
          // soft: a smooth falloff gently broken up (hard noise thresholds read as camouflage blotches)
          float wornK = smoothstep(0.0, 0.85, bm.r * (0.8 + 0.4 * n2) + (n3 - 0.5) * 0.18) * bGround;
          float bareK = smoothstep(0.55, 1.15, bm.r * (0.7 + 0.5 * n1) + bm.b * 0.3 + (n3 - 0.5) * 0.25) * bGround;
          col = mix(col, srgb(${glsl3(dress.worn)}) * (0.86 + 0.28 * n2) * (0.92 + 0.16 * n4), wornK * 0.9);
          col = mix(col, srgb(${glsl3(dress.bare)}) * (0.78 + 0.44 * n3), bareK * 0.8);
          // packed track: b = 1 - distance to the centre line / 0.6, twin wheel ruts either side of the middle
          float pathD = (1.0 - bm.b) * 0.6 + (n4 - 0.5) * 0.05;
          float onPath = step(0.02, bm.b) * bGround;
          float pathK = smoothstep(0.46, 0.22, pathD + (n3 - 0.5) * 0.14) * onPath;
          float ruts = smoothstep(0.06, 0.02, abs(pathD - 0.14)) * onPath * smoothstep(0.3, 0.6, n2 + n4 * 0.3);
          col = mix(col, srgb(${glsl3(dress.path)}) * (0.84 + 0.32 * n3), pathK * 0.85);
          col = mix(col, srgb(${glsl3(dress.rut)}) * (0.85 + 0.3 * n4), ruts * pathK * 0.4);
          // roads (roads.ts): main roads in the climate's road colour, tracks like the packed paths
          vec4 rm = texture2D(tRoad, duv) * dIn;
          float roadCore = smoothstep(${(ROAD_HALF.main + 0.1).toFixed(3)}, ${(ROAD_HALF.main - 0.12).toFixed(3)}, (1.0 - rm.r) * ${ROAD_REACH.toFixed(3)} + (n3 - 0.5) * 0.2) * step(0.004, rm.a) * bGround;
          col = mix(col, mix(srgb(${glsl3(dress.path)}), srgb(${glsl3(ROAD_LOW[climate])}), smoothstep(0.55, 0.85, rm.g)) * (0.84 + 0.32 * n3), roadCore * 0.85);
          // concrete: cast slabs (one per cell) with seams, stains and cracks; the a channel is contact shade
          float concK = smoothstep(0.46, 0.54, bm.g + (n4 - 0.5) * 0.05) * (1.0 - cliff) * (1.0 - bed);
          // (the relief fades over a wider band: a hard step in the bump would light up as a bright outline)
          float concB = smoothstep(0.5, 0.8, bm.g) * (1.0 - cliff) * (1.0 - bed);
          vec2 slabF = abs(fract(p) - 0.5);
          float seam = smoothstep(0.475, 0.492, max(slabF.x, slabF.y));
          float concStain = smoothstep(0.52, 0.8, tn_fbm(p * 0.8 + 11.0));
          float crack = smoothstep(0.022, 0.0, abs(tn_noise(p * 2.7 + 5.0) - 0.5)) * step(0.55, tn_noise(p * 0.7 + 2.0));
          vec3 conc = srgb(${glsl3(dress.conc)}) * (0.88 + 0.1 * n3 + 0.12 * fract(sin(dot(floor(p), vec2(12.99, 78.23))) * 437.58));
          conc *= 1.0 - seam * 0.38 - crack * 0.32 - concStain * 0.24;
          float concEdge = 1.0 - smoothstep(0.5, 0.85, bm.g);
          ${climate === 'winter' ? `// plowed: snow banks along the edges and in patches
          conc = mix(conc, srgb(vec3(0.8, 0.84, 0.9)) * (0.9 + 0.1 * n3), smoothstep(0.5, 0.85, concEdge * 0.4 + n1 * 0.45 + n3 * 0.4 - 0.1) * 0.75);`
            : climate === 'desert' ? `// drifted sand along the edges
          conc = mix(conc, sand, smoothstep(0.5, 0.8, concEdge * 0.7 + n3 * 0.4) * 0.8);` : `// dirt washed onto the edges
          conc = mix(conc, dirt, smoothstep(0.55, 0.85, concEdge * 0.65 + n3 * 0.4) * 0.6);`}
          col = mix(col, conc, concK);
          col *= 1.0 - smoothstep(0.0, 1.0, bm.a) * 0.32 * (1.0 - cliff);
          // persistent damage (terrain.deform / scorch / rut): churned soil in craters, burnt ground
          vec4 dmg = mix(vec4(0.5, 0.0, 0.0, 0.0), texture2D(tDeform, duv), dIn);
          // churned soil: freshly thrown earth, darker towards the bottom of the bowl
          vec3 soil = uPal[4] * vec3(0.85, 0.8, 0.74) * (0.7 + 0.55 * n3) * (1.0 - smoothstep(0.55, 1.0, dmg.a) * 0.35);
          col = mix(col, soil, smoothstep(0.05, 0.6, dmg.a) * 0.88);
          float burn = smoothstep(0.02, 0.9, dmg.g) * (0.7 + 0.3 * n4);
          col = mix(col, col * vec3(0.2, 0.18, 0.16) + vec3(0.01, 0.008, 0.006), burn * 0.85);
          // snow-capped peaks (outer mountains) and weather snow cover on flat ground
          float upward = smoothstep(0.55, 0.85, nW.y);
          float peak = smoothstep(3.2, 5.0, vWPos.y + n2 * 0.8) * smoothstep(0.35, 0.7, nW.y);
          float snowCover = max(peak, uSnow * upward * smoothstep(0.25, 0.6, n1 * 0.6 + n3 * 0.4 + uSnow * 0.5)) * (1.0 - bed);
          col = mix(col, srgb(vec3(0.86, 0.9, 0.95)) * (0.92 + 0.08 * n3), snowCover);
          // tread ruts show in snow (packed, blue-grey), sand and mud; barely on grass
          float snowy = ${climate === 'winter' ? 'max(snowCover, sp.x * (1.0 - cliff))' : 'snowCover'};
          float rutK = dmg.b * max(max(snowy, sp.y * 0.8), max(sp.w * 0.6, 0.15));
          col = mix(col, col * mix(vec3(0.62, 0.58, 0.52), vec3(0.7, 0.77, 0.88), snowy), clamp(rutK * 1.4, 0.0, 0.85));
          // churned craters have no snow on their walls
          col = mix(col, soil, smoothstep(0.3, 0.9, dmg.a) * snowCover * 0.6);
          // rain-soaked ground is darker
          col *= 1.0 - uWet * 0.38 * (1.0 - snowCover);
          diffuseColor.rgb = col;
        `)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          // wet ground turns glossy (puddles in low spots); the wet sand at the waterline too
          ${low ? 'float puddle = 0.0;' : 'float puddle = smoothstep(0.55, 0.75, tn_fbm(vWPos.xz * 0.6)) * uWet;'}
          roughnessFactor = mix(roughnessFactor, 0.32, uWet * 0.55);
          roughnessFactor = mix(roughnessFactor, 0.28, rhShoreWet * (1.0 - bed));
          roughnessFactor = mix(roughnessFactor, 0.06, puddle);
          roughnessFactor = mix(roughnessFactor, 0.6, snowCover);
          roughnessFactor = mix(roughnessFactor, mix(0.78, 0.22, uWet * concStain), concK);`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          ${low ? '' : `{
            // detail relief as a screen-space-derivative bump (one height evaluation per pixel)
            float hgt = rh_detail(vWPos.xz, vSplat) * (1.0 - snowCover * 0.7) * (0.4 + 0.6 * (1.0 - puddle)) * (1.0 - concB * 0.85 - pathK * 0.4) - seam * concB * 0.5 - ruts * pathK * 0.25;
            // crater rims and tread ruts from the deformation map (world units)
            float dh = (dmg.r - 0.5) * ${(DEFORM_RANGE * 2).toFixed(2)} - dmg.b * 0.09 * (0.4 + snowy);
            vec2 dHdxy = vec2(dFdx(hgt), dFdy(hgt)) * 0.05 + vec2(dFdx(dh), dFdy(dh)) * 1.6;
            vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
            vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
            float det = dot(sx, r1) * faceDirection;
            vec3 bn = abs(det) * normal - sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);
            normal = dot(bn, bn) > 1e-24 ? normalize(bn) : normal; // (det = 0 on degenerate pixels: normalize(0) is NaN)
          }`}`)
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
          ${low ? `{
            // drifting cloud shadows (medium / high: the atmosphere pass shades them on everything)
            vec2 cp = vWPos.xz * 0.035 + vec2(uTime * 0.012, uTime * 0.006);
            float cloud = smoothstep(0.45, 0.75, tn_fbm(cp));
            float shade = 1.0 - cloud * 0.4;
            reflectedLight.directDiffuse *= shade;
            reflectedLight.directSpecular *= shade;
          }` : ''}`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          if (uGrid.w > 0.0) {
            vec2 gd = abs(fract(vWPos.xz) - 0.5);
            float line = smoothstep(0.47, 0.5, max(gd.x, gd.y));
            float fall = 1.0 - smoothstep(uGrid.z * 0.4, uGrid.z, distance(vWPos.xz, uGrid.xy));
            totalEmissiveRadiance += uGridColor * line * fall * uGrid.w * 0.6;
          }
          // gem fields glimmer faintly in their flecks
          totalEmissiveRadiance += srgb(vec3(0.6, 0.35, 0.9)) * vOre.y * ore * fleck * 0.08;`);
    };
    const tex = this.textures;
    const texCompile = (shader: THREE.WebGLProgramParametersWithUniforms) => {
      const lay = layerUniforms(climate);
      Object.assign(shader.uniforms, uni, { tNoise, tTerA: tex!.albedo, tTerN: tex!.nrm, uLayT: { value: lay.T }, uLayP: { value: lay.P } });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          attribute vec4 aSplat;
          attribute vec2 aOre;
          varying vec4 vSplat;
          varying vec2 vOre;
          varying vec3 vWPos;
          varying vec3 vWNormal;
          attribute float aWater;
          varying float vWater;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vSplat = aSplat;
          vOre = aOre;
          vWater = aWater;
          vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vWNormal = normal;`);
      const g = texturedGlsl(climate, quality === 'high');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${g.common}`)
        .replace('#include <map_fragment>', g.map)
        .replace('#include <roughnessmap_fragment>', g.rough)
        .replace('#include <normal_fragment_maps>', g.normal)
        .replace('#include <emissivemap_fragment>', g.emissive);
    };
    mat.onBeforeCompile = low ? lowCompile : texCompile;
    mat.customProgramCacheKey = () => (low ? 'rh-terrain-v5-low-' : `rh-terrain-v5-${quality}-`) + climate;
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = true;
    this.mesh.customDepthMaterial = shadowDepthMaterial(this.mesh);
    this.mesh.name = 'terrain';
  }

  dispose() {
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.heightTexture.dispose();
    this.deformTexture.dispose();
    this.baseTexture.dispose();
    this.roadTexture.dispose();
    if (this.textures) releaseTerrainTextures(this.textures);
  }

  /** Resolves when the scanned materials are on the GPU-side textures (immediately on low). */
  get texturesReady(): Promise<void> {
    return this.textures ? this.textures.ready : Promise.resolve();
  }

  /** Scanned material status (screenshot tools / debugging). */
  textureStatus(): { state: string; climate: string; bytes: number; roads: number } {
    return { state: this.textures?.state ?? 'procedural', climate: this.climate, bytes: Math.round(this.textures?.bytes ?? 0), roads: this.roads.segments.length };
  }

  /** Upload rows j0..j1 (texel rows, inclusive) of the base-dressing mask after editing baseData. */
  markBase(j0: number, j1: number) {
    const W = this.map.w * BASE_RES, H = this.map.h * BASE_RES;
    j0 = Math.max(0, j0); j1 = Math.min(H - 1, j1);
    if (j1 < j0) return;
    const t = this.baseTexture;
    // three uploads each range as a single texel row: one range per row, or the whole texture for big edits
    if ((j1 - j0 + 1) * 3 > H) t.clearUpdateRanges();
    else for (let j = j0; j <= j1; j++) t.addUpdateRange(j * W * 4, W * 4);
    t.needsUpdate = true;
  }

  // -------------------------------------------------------------------------------------------
  // Persistent deformation (visual only; the simulation's heights never change)

  deform(x: number, y: number, radius: number, depth: number): void {
    if (!(radius > 0) || !depth || !Number.isFinite(x + y + depth)) return;
    this.deformCalls++;
    radius = Math.min(radius, 12);
    if (depth < 0) {
      this.heal(x, y, radius, Math.min(-depth, 1.5));
      return;
    }
    depth = Math.min(depth, 1.5);
    const vw = this.vw, vh = this.vh;
    const pos = this.geo.attributes.position as THREE.BufferAttribute;
    const P = pos.array as Float32Array;
    const reach = radius * 1.45;
    const i0 = Math.max(0, Math.floor((x - reach) * SUB)), i1 = Math.min(vw - 1, Math.ceil((x + reach) * SUB));
    const j0 = Math.max(0, Math.floor((y - reach) * SUB)), j1 = Math.min(vh - 1, Math.ceil((y + reach) * SUB));
    if (i1 < i0 || j1 < j0) return;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const r = Math.hypot(i / SUB - x, j / SUB - y) / radius;
        if (r >= 1.45) continue;
        const k = j * vw + i;
        // bowl inside, raised lip around the edge
        let dh = r < 1 ? -depth * (1 - r * r) * (1 - r * r * 0.35) : 0;
        dh += depth * 0.32 * Math.exp(-((r - 1.0) * (r - 1.0)) / 0.045);
        const h = Math.max(this.baseH[k] - MAX_DIG, Math.min(this.baseH[k] + 0.5, P[k * 3 + 1] + dh));
        P[k * 3 + 1] = h;
        this.heightData[k] = h;
      }
    }
    this.refreshNormals(i0 - 1, i1 + 1, j0 - 1, j1 + 1);
    pos.addUpdateRange((j0 * vw) * 3, ((j1 - j0 + 1) * vw) * 3);
    pos.needsUpdate = true;
    this.heightDirty = true;
    // fine relief, churned soil and a scorched halo in the deformation map
    this.stamp(x, y, radius * 1.5, (d, n) => {
      const r = d / radius;
      const o = n * 4;
      const D = this.deformData;
      if (r < 1.25) {
        const relief = (r < 1 ? -0.25 * (1 - r) : 0) + 0.18 * Math.exp(-((r - 1) * (r - 1)) / 0.02);
        const enc = D[o] + Math.round((relief * depth * 0.6 / DEFORM_RANGE) * 127);
        D[o] = Math.max(0, Math.min(255, enc));
        D[o + 3] = Math.max(D[o + 3], Math.round(255 * Math.min(1, 1.15 - r * 0.85)));
      }
      const burn = Math.max(0, 1 - d / (radius * 1.5));
      D[o + 1] = Math.min(255, D[o + 1] + Math.round(burn * burn * 90));
    });
  }

  /** Undo up to `amount` of crater relief around (x, y) (see deform with a negative depth). */
  private heal(x: number, y: number, radius: number, amount: number) {
    const vw = this.vw, vh = this.vh;
    const pos = this.geo.attributes.position as THREE.BufferAttribute;
    const P = pos.array as Float32Array;
    const reach = radius * 1.45;
    const i0 = Math.max(0, Math.floor((x - reach) * SUB)), i1 = Math.min(vw - 1, Math.ceil((x + reach) * SUB));
    const j0 = Math.max(0, Math.floor((y - reach) * SUB)), j1 = Math.min(vh - 1, Math.ceil((y + reach) * SUB));
    if (i1 < i0 || j1 < j0) return;
    // how much of the dip at the centre is left afterwards decides how much soil / burn fades
    const ci = Math.min(vw - 1, Math.max(0, Math.round(x * SUB))), cj = Math.min(vh - 1, Math.max(0, Math.round(y * SUB)));
    const ck = cj * vw + ci;
    const before = Math.max(0, this.baseH[ck] - P[ck * 3 + 1]);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const r = Math.hypot(i / SUB - x, j / SUB - y) / reach;
        if (r >= 1) continue;
        const k = j * vw + i;
        const step = amount * (1 - r * r);
        const h = P[k * 3 + 1], d = this.baseH[k] - h;
        const nh = h + Math.max(-step, Math.min(step, d));
        P[k * 3 + 1] = nh;
        this.heightData[k] = nh;
      }
    }
    this.refreshNormals(i0 - 1, i1 + 1, j0 - 1, j1 + 1);
    pos.addUpdateRange((j0 * vw) * 3, ((j1 - j0 + 1) * vw) * 3);
    pos.needsUpdate = true;
    this.heightDirty = true;
    const after = Math.max(0, this.baseH[ck] - P[ck * 3 + 1]);
    const fade = before > 1e-4 ? 1 - Math.min(1, after / before) : 1;
    const D = this.deformData;
    this.stamp(x, y, radius * 1.5, (d, n) => {
      const w = fade * Math.min(1, 1.25 - d / (radius * 1.5));
      if (w <= 0) return;
      const o = n * 4;
      D[o] = Math.round(128 + (D[o] - 128) * (1 - w));
      D[o + 1] = Math.round(D[o + 1] * (1 - w * 0.6));
      D[o + 3] = Math.round(D[o + 3] * (1 - w));
    });
  }

  scorch(x: number, y: number, radius: number, amount = 0.6): void {
    if (!(radius > 0) || !Number.isFinite(x + y)) return;
    this.deformCalls++;
    this.stamp(x, y, Math.min(radius, 12), (d, n) => {
      const w = 1 - d / radius;
      const o = n * 4 + 1;
      this.deformData[o] = Math.min(255, this.deformData[o] + Math.round(w * w * amount * 255));
    });
  }

  rut(x0: number, y0: number, x1: number, y1: number, width: number, depth = 0.6): void {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (!(len > 1e-4) || len > 4 || !Number.isFinite(x0 + y0 + x1 + y1)) return;
    const nx = -dy / len, ny = dx / len;
    const half = width / 2;
    const groove = 0.07 * Math.max(0.6, width);
    const v = Math.round(Math.min(1, depth) * 200);
    // one stamp per texel along the segment, for both treads
    const steps = Math.ceil(len * DRES);
    const W = this.map.w * DRES, H = this.map.h * DRES;
    const D = this.deformData;
    let minI = W, maxI = -1, minJ = H, maxJ = -1;
    for (let side = -1; side <= 1; side += 2) {
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const px = (x0 + dx * t + nx * half * side) * DRES, py = (y0 + dy * t + ny * half * side) * DRES;
        const gr = groove * DRES;
        for (let j = Math.floor(py - gr); j <= Math.ceil(py + gr); j++) {
          if (j < 0 || j >= H) continue;
          for (let i = Math.floor(px - gr); i <= Math.ceil(px + gr); i++) {
            if (i < 0 || i >= W) continue;
            const d = Math.hypot(i + 0.5 - px, j + 0.5 - py) / Math.max(gr, 0.5);
            if (d >= 1) continue;
            const o = (j * W + i) * 4 + 2;
            D[o] = Math.max(D[o], Math.round(v * (1 - d * d)));
            if (i < minI) minI = i;
            if (i > maxI) maxI = i;
            if (j < minJ) minJ = j;
            if (j > maxJ) maxJ = j;
          }
        }
      }
    }
    if (maxI >= minI) this.markDeform(minI, maxI, minJ, maxJ);
  }

  /** Apply fn(distance in cells, texel index) to every deformation texel within radius of (x, y). */
  private stamp(x: number, y: number, radius: number, fn: (d: number, n: number) => void) {
    const W = this.map.w * DRES, H = this.map.h * DRES;
    const i0 = Math.max(0, Math.floor((x - radius) * DRES)), i1 = Math.min(W - 1, Math.ceil((x + radius) * DRES));
    const j0 = Math.max(0, Math.floor((y - radius) * DRES)), j1 = Math.min(H - 1, Math.ceil((y + radius) * DRES));
    if (i1 < i0 || j1 < j0) return;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const d = Math.hypot((i + 0.5) / DRES - x, (j + 0.5) / DRES - y);
        if (d < radius) fn(d, j * W + i);
      }
    }
    this.markDeform(i0, i1, j0, j1);
  }

  private markDeform(i0: number, i1: number, j0: number, j1: number) {
    const W = this.map.w * DRES;
    for (let j = j0; j <= j1; j++) this.deformTexture.addUpdateRange((j * W + i0) * 4, (i1 - i0 + 1) * 4);
    this.deformTexture.needsUpdate = true;
  }

  /** Central-difference normals for the vertex block (regular grid). */
  private refreshNormals(i0: number, i1: number, j0: number, j1: number) {
    const vw = this.vw, vh = this.vh;
    i0 = Math.max(0, i0); j0 = Math.max(0, j0); i1 = Math.min(vw - 1, i1); j1 = Math.min(vh - 1, j1);
    const P = this.geo.attributes.position.array as Float32Array;
    const nAttr = this.geo.attributes.normal as THREE.BufferAttribute;
    const N = nAttr.array as Float32Array;
    const h = (i: number, j: number) => P[(Math.min(vh - 1, Math.max(0, j)) * vw + Math.min(vw - 1, Math.max(0, i))) * 3 + 1];
    const step = 2 / SUB;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const nx = -(h(i + 1, j) - h(i - 1, j)) / step, nz = -(h(i, j + 1) - h(i, j - 1)) / step;
        const l = Math.hypot(nx, 1, nz);
        const k = (j * vw + i) * 3;
        N[k] = nx / l; N[k + 1] = 1 / l; N[k + 2] = nz / l;
      }
    }
    nAttr.addUpdateRange(j0 * vw * 3, (j1 - j0 + 1) * vw * 3);
    nAttr.needsUpdate = true;
  }

  /** Upload the collision height texture after deformations (throttled: a full re-upload). */
  flush(dt: number) {
    this.heightUploadT -= dt;
    if (this.heightDirty && this.heightUploadT <= 0) {
      this.heightTexture.needsUpdate = true;
      this.heightDirty = false;
      this.heightUploadT = 0.25;
    }
  }

  /** Visual (rendered) terrain height including the extra rock relief. */
  renderHeight(x: number, y: number): number {
    const fx = Math.max(0, Math.min(this.vw - 1.001, x * SUB)), fy = Math.max(0, Math.min(this.vh - 1.001, y * SUB));
    const i = Math.floor(fx), j = Math.floor(fy);
    const tx = fx - i, ty = fy - j;
    // (no closures: called per bird / per instance in per-frame loops)
    const p = this.geo.attributes.position.array as Float32Array;
    const k0 = (j * this.vw + i) * 3 + 1, k1 = k0 + this.vw * 3;
    return (p[k0] * (1 - tx) + p[k0 + 3] * tx) * (1 - ty) + (p[k1] * (1 - tx) + p[k1 + 3] * tx) * ty;
  }

  /** Recompute per-vertex ore density (call when map.oreVersion changes). */
  refreshOre(cells?: Iterable<number>) {
    const m = this.map;
    const arr = this.oreAttr.array as Float32Array;
    const vw = this.vw;
    const updateVertex = (i: number, j: number) => {
      const x = i / SUB, y = j / SUB;
      let o = 0, g = 0, c = 0;
      for (let dy = -1; dy <= 0; dy++) for (let dx = -1; dx <= 0; dx++) {
        const qx = Math.floor(x + dx * 0.5 + 0.25), qy = Math.floor(y + dy * 0.5 + 0.25);
        if (!m.inBounds(qx, qy)) continue;
        const ci = m.idx(qx, qy);
        o += Math.min(1, m.ore[ci] / 5 + (m.oreField[ci] ? 0.15 : 0));
        g += m.gems[ci] || m.oreField[ci] === 2 ? 1 : 0;
        c++;
      }
      const k = j * vw + i;
      arr[k * 2] = c ? o / c : 0;
      arr[k * 2 + 1] = c ? g / c : 0;
    };
    if (!cells) {
      for (let j = 0; j < this.vh; j++) for (let i = 0; i < vw; i++) updateVertex(i, j);
    } else {
      for (const ci of cells) {
        const cx = ci % m.w, cy = (ci / m.w) | 0;
        for (let j = cy * SUB - 1; j <= (cy + 1) * SUB + 1; j++) for (let i = cx * SUB - 1; i <= (cx + 1) * SUB + 1; i++) {
          if (i >= 0 && j >= 0 && i < vw && j < this.vh) updateVertex(i, j);
        }
      }
    }
    this.oreAttr.needsUpdate = true;
  }
}

/**
 * Landscape beyond the playable area: forested foothills rising into snow-capped mountains,
 * so the battlefield sits in a world instead of a black void. Shares the terrain material.
 */
export class TerrainSkirt {
  readonly mesh: THREE.Mesh;
  /** Candidate tree spots on gentle outer slopes: [x, y(height), z] */
  readonly treeSpots: [number, number, number][] = [];
  private noise: Noise2D;

  constructor(private map: GameMap, material: THREE.Material, readonly margin = 44) {
    this.noise = new Noise2D(map.seed + 911);
    const M = margin, W = map.w, H = map.h;
    const vw = W + 2 * M + 1, vh = H + 2 * M + 1;
    const pos = new Float32Array(vw * vh * 3);
    const splat = new Float32Array(vw * vh * 4);
    const ore = new Float32Array(vw * vh * 2);
    for (let j = 0; j < vh; j++) {
      for (let i = 0; i < vw; i++) {
        const x = i - M, y = j - M;
        const k = j * vw + i;
        const h = this.heightAt(x, y);
        pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = y;
        const rock = Math.min(1, Math.max(0, (h - 1.6) / 2.5));
        splat[k * 4] = 1 - rock; splat[k * 4 + 2] = rock;
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < vh - 1; j++) {
      for (let i = 0; i < vw - 1; i++) {
        const x = i - M, y = j - M;
        // skip cells well inside the playable map (a one-cell overlap hides seams)
        if (x >= 1 && y >= 1 && x + 1 <= W - 1 && y + 1 <= H - 1) continue;
        const a = j * vw + i, b = a + 1, c = a + vw, d = c + 1;
        if ((i + j) & 1) idx.push(a, c, b, b, c, d); else idx.push(a, c, d, a, d, b);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSplat', new THREE.BufferAttribute(splat, 4));
    geo.setAttribute('aOre', new THREE.BufferAttribute(ore, 2));
    geo.setIndex(new THREE.Uint32BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.name = 'terrain-skirt';

    // forest band on the foothills
    for (let y = -M + 1; y < H + M - 1; y += 1) {
      for (let x = -M + 1; x < W + M - 1; x += 1) {
        const d = this.outside(x + 0.5, y + 0.5);
        if (d < 1.5 || d > 26) continue;
        const f = this.noise.fbm(x * 0.09 + 50, y * 0.09 - 20, 3);
        if (f < 0.47 + d * 0.004) continue;
        if (hash2(x, y, 77) > 0.75) continue;
        const px = x + 0.2 + hash2(x, y, 78) * 0.6, py = y + 0.2 + hash2(x, y, 79) * 0.6;
        const hh = this.heightAt(px, py);
        const slope = Math.abs(this.heightAt(px + 0.5, py) - this.heightAt(px - 0.5, py)) + Math.abs(this.heightAt(px, py + 0.5) - this.heightAt(px, py - 0.5));
        if (hh > 2.6 || slope > 1.1 || hh < -0.1) continue;
        this.treeSpots.push([px, hh - 0.05, py]);
      }
    }
  }

  /** Distance of a point outside the map rectangle (0 inside). */
  private outside(x: number, y: number): number {
    const dx = Math.max(0 - x, 0, x - this.map.w);
    const dy = Math.max(0 - y, 0, y - this.map.h);
    return Math.hypot(dx, dy);
  }

  heightAt(x: number, y: number): number {
    const m = this.map;
    const cx = Math.min(m.w, Math.max(0, x)), cy = Math.min(m.h, Math.max(0, y));
    const edge = Math.max(m.heightAt(cx, cy), -0.05);
    const d = this.outside(x, y);
    if (d <= 0) return m.heightAt(cx, cy) - (x >= 0 && y >= 0 && x <= m.w && y <= m.h ? 0.04 : 0);
    const n = this.noise;
    const hills = (n.fbm(x * 0.06, y * 0.06, 4) - 0.35) * 2.2;
    const r = n.fbm(x * 0.028 + 7, y * 0.028 - 3, 4);
    const ridge = 1 - Math.abs(2 * r - 1);
    const mountains = ridge * ridge * ridge * 9 + n.fbm(x * 0.15, y * 0.15, 2) * 0.8;
    const t1 = Math.min(1, Math.max(0, (d - 1) / 10));
    const t2 = Math.min(1, Math.max(0, (d - 8) / 22));
    const s1 = t1 * t1 * (3 - 2 * t1), s2 = t2 * t2 * (3 - 2 * t2);
    return edge * (1 - s1) + hills * s1 * (1 - s2) + (hills * 0.5 + mountains) * s2;
  }
}

export { hash2 };
