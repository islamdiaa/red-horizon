import * as THREE from 'three';
import { hash2, Noise2D } from '../core/rng';
import { GameMap, T } from '../sim/map';
import { shadowDepthMaterial } from './models/materials';

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

export type Climate = 'temperate' | 'winter' | 'desert';

/** Ground palettes (sRGB) per climate: grassDark, grassLight, grassDry, sand, dirt, rockDark, rockLight. */
const PALETTES: Record<Climate, number[][]> = {
  temperate: [[0.22, 0.31, 0.13], [0.38, 0.46, 0.2], [0.55, 0.5, 0.3], [0.68, 0.6, 0.44], [0.47, 0.36, 0.23], [0.33, 0.31, 0.29], [0.5, 0.47, 0.43]],
  winter: [[0.74, 0.79, 0.85], [0.88, 0.91, 0.95], [0.55, 0.58, 0.58], [0.6, 0.6, 0.6], [0.42, 0.4, 0.39], [0.36, 0.37, 0.4], [0.55, 0.57, 0.6]],
  desert: [[0.66, 0.52, 0.33], [0.78, 0.64, 0.42], [0.5, 0.46, 0.26], [0.86, 0.73, 0.52], [0.6, 0.42, 0.27], [0.5, 0.33, 0.25], [0.68, 0.48, 0.36]],
};

export interface TerrainUniforms {
  uTime: { value: number };
  uGrid: { value: THREE.Vector4 };      // x, z, radius, strength
  uGridColor: { value: THREE.Color };
  uWet: { value: number };
  uSnow: { value: number };
  uPal: { value: THREE.Vector3[] };
}

export class TerrainMesh {
  readonly mesh: THREE.Mesh;
  readonly uniforms: TerrainUniforms;
  private geo: THREE.BufferGeometry;
  private oreAttr: THREE.BufferAttribute;
  private vw: number;
  private vh: number;

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
    geo.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    this.geo = geo;
    this.refreshOre();

    this.uniforms = {
      uTime: { value: 0 },
      uGrid: { value: new THREE.Vector4(0, 0, 0, 0) },
      uGridColor: { value: new THREE.Color(0.3, 1.0, 0.6) },
      uWet: { value: 0 },
      uSnow: { value: 0 },
      uPal: { value: PALETTES[climate].map(([r, g, b]) => new THREE.Vector3(r, g, b)) },
    };
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.93, metalness: 0.0 });
    const uni = this.uniforms;
    const tNoise = { value: getNoiseTexture() };
    const low = quality === 'low';
    mat.onBeforeCompile = (shader) => {
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
          vec3 grassDark = srgb(uPal[0]);
          vec3 grassLight = srgb(uPal[1]);
          vec3 grassDry = srgb(uPal[2]);
          vec3 grass = mix(grassDark, grassLight, smoothstep(0.3, 0.7, n1));
          grass = mix(grass, grassDry, smoothstep(0.55, 0.85, n2) * 0.55);
          grass *= 0.86 + 0.28 * n3;
          grass = mix(grass, grass * vec3(0.7, 0.8, 0.6), step(0.82, n4) * 0.5);
          vec3 sand = srgb(uPal[3]) * (0.9 + 0.18 * n2) * (0.94 + 0.12 * n4);
          vec3 dirt = srgb(uPal[4]) * (0.85 + 0.3 * n2) * (0.9 + 0.2 * n3);
          // rock: triplanar so cliff faces are not stretched; horizontal strata
          vec3 tw = nW * nW; tw *= tw; tw /= dot(tw, vec3(1.0));
          ${low ? `float rn = tn_noise(p * 2.6);
          float rnf = n4;` : `vec4 rx = texture2D(tNoise, vWPos.zy * (2.6 / 16.0)), rz = texture2D(tNoise, vWPos.xy * (2.6 / 16.0)), ry = texture2D(tNoise, p * (2.6 / 16.0));
          float rn = rx.r * tw.x + rz.r * tw.z + ry.r * tw.y;
          float rnf = rx.b * tw.x + rz.b * tw.z + ry.b * tw.y;`}
          float strata = sin(vWPos.y * 9.0 + rn * 4.0) * 0.5 + 0.5;
          vec3 rock = mix(srgb(uPal[5]), srgb(uPal[6]), strata * 0.55 + rnf * 0.45) * (0.82 + 0.36 * rn);
          vec4 sp = vSplat / max(0.001, dot(vSplat, vec4(1.0)));
          // noisy blend borders
          sp.y = smoothstep(0.0, 1.0, sp.y + (n3 - 0.5) * 0.35 * sp.y * (1.0 - sp.y) * 4.0);
          vec3 col = grass * sp.x + sand * sp.y + rock * sp.z + dirt * sp.w;
          col /= max(0.001, sp.x + sp.y + sp.z + sp.w);
          // steep slopes show rock
          float slope = 1.0 - clamp(nW.y, 0.0, 1.0);
          float cliff = smoothstep(0.28, 0.55, slope);
          col = mix(col, rock * 0.9, cliff);
          // shoreline: a dark, glossy band of wet sand above the waterline, a silty lake bed below it
          float hw = vWPos.y + 0.32;
          float rhShoreWet = smoothstep(0.16, 0.0, hw + (n3 - 0.5) * 0.05) * (1.0 - cliff);
          float bed = smoothstep(0.0, -0.06, hw);
          col = mix(col, col * vec3(0.58, 0.56, 0.52), rhShoreWet * 0.85);
          vec3 lakeBed = mix(sand * vec3(0.86, 0.84, 0.76), sand * vec3(0.5, 0.56, 0.46), smoothstep(-0.05, -0.45, hw));
          lakeBed *= 0.9 + 0.2 * (sin(dot(p, vec2(0.7, 0.71)) * 13.0 + n2 * 6.0) * 0.5 + 0.5);
          col = mix(col, lakeBed, bed);
          // ore stains the ground rusty (mottled, with bright flecks), gems leave a violet tint
          float ore = clamp(vOre.x * 1.25, 0.0, 1.0);
          float fleck = smoothstep(0.78, 0.97, tn_noise(p * 31.0));
          vec3 oreStain = mix(srgb(vec3(0.52, 0.33, 0.16)), srgb(vec3(0.36, 0.28, 0.42)), vOre.y);
          oreStain *= (0.72 + 0.5 * n3) * (1.0 + fleck * 0.9);
          col = mix(col, oreStain, ore * 0.85);
          // snow-capped peaks (outer mountains) and weather snow cover on flat ground
          float upward = smoothstep(0.55, 0.85, nW.y);
          float peak = smoothstep(3.2, 5.0, vWPos.y + n2 * 0.8) * smoothstep(0.35, 0.7, nW.y);
          float snowCover = max(peak, uSnow * upward * smoothstep(0.25, 0.6, n1 * 0.6 + n3 * 0.4 + uSnow * 0.5)) * (1.0 - bed);
          col = mix(col, srgb(vec3(0.86, 0.9, 0.95)) * (0.92 + 0.08 * n3), snowCover);
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
          roughnessFactor = mix(roughnessFactor, 0.6, snowCover);`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          ${low ? '' : `{
            // detail relief as a screen-space-derivative bump (one height evaluation per pixel)
            float hgt = rh_detail(vWPos.xz, vSplat) * (1.0 - snowCover * 0.7) * (0.4 + 0.6 * (1.0 - puddle));
            vec2 dHdxy = vec2(dFdx(hgt), dFdy(hgt)) * 0.05;
            vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
            vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
            float det = dot(sx, r1) * faceDirection;
            normal = normalize(abs(det) * normal - sign(det) * (dHdxy.x * r1 + dHdxy.y * r2));
          }`}`)
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
          {
            // drifting cloud shadows
            vec2 cp = vWPos.xz * 0.035 + vec2(uTime * 0.012, uTime * 0.006);
            float cloud = smoothstep(0.45, 0.75, tn_fbm(cp));
            float shade = 1.0 - cloud * 0.4;
            reflectedLight.directDiffuse *= shade;
            reflectedLight.directSpecular *= shade;
          }`)
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
    mat.customProgramCacheKey = () => (low ? 'rh-terrain-v2-low' : 'rh-terrain-v2');
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = true;
    this.mesh.customDepthMaterial = shadowDepthMaterial(this.mesh);
    this.mesh.name = 'terrain';
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
