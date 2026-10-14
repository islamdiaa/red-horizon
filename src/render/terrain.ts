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
  uWet: { value: number };
  uSnow: { value: number };
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
      uWet: { value: 0 },
      uSnow: { value: 0 },
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
          uniform float uWet;
          uniform float uSnow;
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
          // snow-capped peaks (outer mountains) and weather snow cover on flat ground
          float upward = smoothstep(0.55, 0.85, normalize(vWNormal).y);
          float peak = smoothstep(3.2, 5.0, vWPos.y + n2 * 0.8) * smoothstep(0.35, 0.7, normalize(vWNormal).y);
          float snowCover = max(peak, uSnow * upward * smoothstep(0.25, 0.6, n1 * 0.6 + n3 * 0.4 + uSnow * 0.5));
          col = mix(col, srgb(vec3(0.86, 0.9, 0.95)) * (0.92 + 0.08 * n3), snowCover);
          // rain-soaked ground is darker
          col *= 1.0 - uWet * 0.38 * (1.0 - snowCover);
          diffuseColor.rgb = col;
        `)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          // wet ground turns glossy (puddles in low spots)
          float puddle = smoothstep(0.55, 0.75, rh_fbm(vWPos.xz * 0.6)) * uWet;
          roughnessFactor = mix(roughnessFactor, 0.32, uWet * 0.55);
          roughnessFactor = mix(roughnessFactor, 0.06, puddle);`)
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
