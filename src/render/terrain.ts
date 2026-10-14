import * as THREE from 'three';
import { hash2, Noise2D } from '../core/rng';
import { GameMap, T } from '../sim/map';

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

const SUB = 2; // vertices per cell edge

export interface TerrainUniforms {
  uTime: { value: number };
  uGrid: { value: THREE.Vector4 };      // x, z, radius, strength
  uGridColor: { value: THREE.Color };
}

export class TerrainMesh {
  readonly mesh: THREE.Mesh;
  readonly uniforms: TerrainUniforms;
  private geo: THREE.BufferGeometry;
  private oreAttr: THREE.BufferAttribute;
  private vw: number;
  private vh: number;

  constructor(private map: GameMap) {
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
    };
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.93, metalness: 0.0 });
    const uni = this.uniforms;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uni);
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
          varying vec4 vSplat;
          varying vec2 vOre;
          varying vec3 vWPos;
          varying vec3 vWNormal;
          ${NOISE_GLSL}
          vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }`)
        .replace('#include <map_fragment>', `
          vec2 p = vWPos.xz;
          float n1 = rh_fbm(p * 0.11);
          float n2 = rh_fbm(p * 0.9 + 3.7);
          float n3 = rh_noise(p * 7.0);
          float n4 = rh_noise(p * 23.0);
          vec3 grassDark = srgb(vec3(0.22, 0.31, 0.13));
          vec3 grassLight = srgb(vec3(0.38, 0.46, 0.2));
          vec3 grassDry = srgb(vec3(0.55, 0.5, 0.3));
          vec3 grass = mix(grassDark, grassLight, smoothstep(0.3, 0.7, n1));
          grass = mix(grass, grassDry, smoothstep(0.55, 0.85, n2) * 0.55);
          grass *= 0.86 + 0.28 * n3;
          grass = mix(grass, grass * vec3(0.7, 0.8, 0.6), step(0.82, n4) * 0.5);
          vec3 sand = srgb(vec3(0.68, 0.6, 0.44)) * (0.9 + 0.18 * n2) * (0.94 + 0.12 * n4);
          vec3 dirt = srgb(vec3(0.47, 0.36, 0.23)) * (0.85 + 0.3 * n2) * (0.9 + 0.2 * n3);
          float strata = sin(vWPos.y * 9.0 + n2 * 4.0) * 0.5 + 0.5;
          vec3 rock = mix(srgb(vec3(0.33, 0.31, 0.29)), srgb(vec3(0.5, 0.47, 0.43)), strata * 0.6 + n3 * 0.4);
          vec4 sp = vSplat / max(0.001, dot(vSplat, vec4(1.0)));
          // noisy blend borders
          sp.y = smoothstep(0.0, 1.0, sp.y + (n3 - 0.5) * 0.35 * sp.y * (1.0 - sp.y) * 4.0);
          vec3 col = grass * sp.x + sand * sp.y + rock * sp.z + dirt * sp.w;
          col /= max(0.001, sp.x + sp.y + sp.z + sp.w);
          // steep slopes show rock
          float slope = 1.0 - clamp(normalize(vWNormal).y, 0.0, 1.0);
          col = mix(col, rock * 0.9, smoothstep(0.28, 0.55, slope));
          // wet, darker ground near / under water
          float wet = smoothstep(-0.12, -0.36, vWPos.y);
          col = mix(col, col * vec3(0.55, 0.6, 0.55), wet);
          // ore stains the ground rusty, gems leave a violet tint
          float ore = clamp(vOre.x * 1.25, 0.0, 1.0);
          vec3 oreStain = mix(srgb(vec3(0.52, 0.33, 0.16)), srgb(vec3(0.36, 0.28, 0.42)), vOre.y);
          col = mix(col, oreStain * (0.8 + 0.4 * n3), ore * 0.85);
          diffuseColor.rgb = col;
        `)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          {
            // cheap procedural bump for ground detail
            float e = 0.06;
            float h0 = rh_noise(vWPos.xz * 3.0) + 0.5 * rh_noise(vWPos.xz * 9.0);
            float hx = rh_noise((vWPos.xz + vec2(e, 0.0)) * 3.0) + 0.5 * rh_noise((vWPos.xz + vec2(e, 0.0)) * 9.0);
            float hz = rh_noise((vWPos.xz + vec2(0.0, e)) * 3.0) + 0.5 * rh_noise((vWPos.xz + vec2(0.0, e)) * 9.0);
            float strength = 0.35 + vSplat.z * 0.8;
            vec3 bumpW = normalize(vec3(-(hx - h0) / e * 0.06 * strength, 1.0, -(hz - h0) / e * 0.06 * strength));
            vec3 bumpV = normalize((viewMatrix * vec4(bumpW, 0.0)).xyz);
            normal = normalize(normal + (bumpV - (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz));
          }`)
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
          {
            // drifting cloud shadows
            vec2 cp = vWPos.xz * 0.035 + vec2(uTime * 0.012, uTime * 0.006);
            float cloud = smoothstep(0.45, 0.75, rh_fbm(cp));
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
          }`);
    };
    mat.customProgramCacheKey = () => 'rh-terrain';
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = true;
    this.mesh.name = 'terrain';
  }

  /** Visual (rendered) terrain height including the extra rock relief. */
  renderHeight(x: number, y: number): number {
    const fx = Math.max(0, Math.min(this.vw - 1.001, x * SUB)), fy = Math.max(0, Math.min(this.vh - 1.001, y * SUB));
    const i = Math.floor(fx), j = Math.floor(fy);
    const tx = fx - i, ty = fy - j;
    const p = this.geo.attributes.position.array as Float32Array;
    const h = (ii: number, jj: number) => p[(jj * this.vw + ii) * 3 + 1];
    return (h(i, j) * (1 - tx) + h(i + 1, j) * tx) * (1 - ty) + (h(i, j + 1) * (1 - tx) + h(i + 1, j + 1) * tx) * ty;
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

export { hash2 };
