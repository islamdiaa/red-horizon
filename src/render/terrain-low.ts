import * as THREE from 'three';
import type { GameMap } from '../sim/map';
import { TNOISE_GLSL } from './noise';
import { ROAD_HALF, ROAD_REACH } from './roads';
import type { Climate } from './terrain-materials';

/**
 * The Low preset's ground, for integrated GPUs. The procedural Low shading (grass / sand / dirt / rock palettes,
 * noise, shoreline, base dressing, roads, concrete) evaluated a dozen noise and mask lookups and a few hundred
 * instructions for every pixel of a full-screen terrain, every frame: on an Intel UHD 770 at 1080p it was most of
 * the frame. Almost all of it depends only on the map, so it is baked once into a map-space colour texture
 * (TerrainBake: the terrain mesh rendered from above into BAKE texels per cell), and re-baked in strips when the base
 * dressing changes. Per pixel the shader keeps what moves or needs pixel detail: the fine grain (one noise lookup),
 * slab seams, rock strata on steep ground, ore, craters / scorch / ruts, snow, rain and cloud shadows.
 */

/** Ground palettes (sRGB) per climate: grassDark, grassLight, grassDry, sand, dirt, rockDark, rockLight. */
export const PALETTES: Record<Climate, number[][]> = {
  temperate: [[0.22, 0.31, 0.13], [0.38, 0.46, 0.2], [0.55, 0.5, 0.3], [0.68, 0.6, 0.44], [0.47, 0.36, 0.23], [0.33, 0.31, 0.29], [0.5, 0.47, 0.43]],
  winter: [[0.74, 0.79, 0.85], [0.88, 0.91, 0.95], [0.55, 0.58, 0.58], [0.6, 0.6, 0.6], [0.42, 0.4, 0.39], [0.36, 0.37, 0.4], [0.55, 0.57, 0.6]],
  desert: [[0.66, 0.52, 0.33], [0.78, 0.64, 0.42], [0.5, 0.46, 0.26], [0.86, 0.73, 0.52], [0.6, 0.42, 0.27], [0.5, 0.33, 0.25], [0.68, 0.48, 0.36]],
  // lush jungle greens, a pale beach sand, dark forest earth, dark mossy rock
  tropical: [[0.12, 0.26, 0.07], [0.26, 0.41, 0.11], [0.4, 0.41, 0.17], [0.76, 0.68, 0.5], [0.35, 0.25, 0.17], [0.26, 0.28, 0.23], [0.43, 0.45, 0.37]],
};

/** Base-dressing colours (sRGB) per climate: trampled ground, bare / churned, packed path, concrete. */
export const DRESS: Record<Climate, { worn: number[]; bare: number[]; path: number[]; rut: number[]; conc: number[] }> = {
  temperate: { worn: [0.43, 0.4, 0.25], bare: [0.37, 0.29, 0.2], path: [0.38, 0.31, 0.22], rut: [0.25, 0.2, 0.15], conc: [0.52, 0.51, 0.49] },
  winter: { worn: [0.73, 0.76, 0.81], bare: [0.5, 0.48, 0.47], path: [0.52, 0.49, 0.47], rut: [0.38, 0.35, 0.33], conc: [0.5, 0.51, 0.53] },
  desert: { worn: [0.64, 0.51, 0.35], bare: [0.53, 0.4, 0.28], path: [0.54, 0.42, 0.3], rut: [0.42, 0.32, 0.23], conc: [0.63, 0.58, 0.51] },
  tropical: { worn: [0.34, 0.32, 0.17], bare: [0.37, 0.26, 0.17], path: [0.42, 0.29, 0.2], rut: [0.27, 0.18, 0.12], conc: [0.55, 0.54, 0.5] },
};

/** Road colour (sRGB) of the low-quality procedural shading: asphalt, ploughed snow, packed sand. */
export const ROAD_LOW: Record<Climate, number[]> = { temperate: [0.3, 0.3, 0.3], winter: [0.56, 0.58, 0.62], desert: [0.66, 0.53, 0.38], tropical: [0.44, 0.3, 0.21] };

export const glsl3 = (c: number[]) => `vec3(${c.map((v) => v.toFixed(3)).join(', ')})`;

/** Baked texels per map cell (fewer on very large maps: the texture stays within 2048 texels a side). */
export function bakeRes(w: number, h: number): number {
  return Math.max(2, Math.min(8, Math.floor(2048 / Math.max(w, h))));
}

/**
 * The natural ground of the Low shading (the procedural Low terrain of terrain.ts without base dressing, roads, ore,
 * damage or weather): fragment body over vWPos / vWNormal / vSplat, writing `col` (linear). The fine noise (n3, n4:
 * several cycles per baked texel) is taken at its mean; the per-pixel grain adds it back. Steep ground gets its rock
 * strata per pixel.
 */
function bakeBody(climate: Climate): string {
  return /* glsl */ `
    vec2 p = vWPos.xz;
    vec3 nW = normalize(vWNormal);
    float n1 = tn_fbm(p * 0.11);
    float n2 = tn_fbm(p * 0.9 + 3.7);
    const float n3 = 0.5;
    const float n4 = 0.5;
    vec3 grass = mix(uPal[0], uPal[1], smoothstep(0.3, 0.7, n1));
    grass = mix(grass, uPal[2], smoothstep(0.55, 0.85, n2) * 0.55);
    vec3 sand = uPal[3] * (0.9 + 0.18 * n2);
    vec3 dirt = uPal[4] * (0.85 + 0.3 * n2);
    // rock seen from above (rock cells)
    float rn = tn_noise(p * 2.6);
    float rsy = vWPos.y * 3.4 + rn * 1.1 + n4 * 0.45;
    float rTone = fract(sin(floor(rsy) * 12.9898 + 4.1) * 43758.5453), rLf = fract(rsy);
    vec3 rock = mix(uPal[5], uPal[6], 0.2 + 0.5 * rTone + 0.3 * n4) * (0.84 + 0.3 * rn);
    rock *= (0.7 + 0.3 * smoothstep(0.0, 0.14, rLf)) * (1.0 + 0.14 * smoothstep(0.78, 0.98, rLf));
    vec4 sp = vSplat / max(0.001, dot(vSplat, vec4(1.0)));
    sp.y = smoothstep(0.0, 1.0, sp.y);
    vec3 col = grass * sp.x + sand * sp.y + rock * sp.z + dirt * sp.w;
    col /= max(0.001, sp.x + sp.y + sp.z + sp.w);
    float cliff = smoothstep(0.28, 0.55, 1.0 - clamp(nW.y, 0.0, 1.0));
    ${climate === 'winter' ? `col = mix(col, srgb(vec3(0.84, 0.88, 0.94)) * (0.9 + 0.1 * n3), sp.z * smoothstep(0.8, 0.95, nW.y) * 0.85);` : ''}
    float hw = vWPos.y + 0.32;
    float shoreWet = smoothstep(0.16, 0.0, hw) * (1.0 - cliff);
    float bed = smoothstep(0.0, -0.06, hw);
    col = mix(col, col * vec3(0.58, 0.56, 0.52), shoreWet * 0.85);
    vec3 lakeBed = mix(sand * vec3(0.86, 0.84, 0.76), sand * vec3(0.5, 0.56, 0.46), smoothstep(-0.05, -0.45, hw));
    lakeBed *= 0.9 + 0.2 * (sin(dot(p, vec2(0.7, 0.71)) * 13.0 + n2 * 6.0) * 0.5 + 0.5);
    col = mix(col, lakeBed, bed);
    // base dressing or a road at this texel: the shader draws them per pixel there (sharp, noisy edges)
    vec2 duv = vWPos.xz / uMapSize;
    vec4 bm = texture2D(tBase, duv), rm = texture2D(tRoad, duv);
    float dressed = step(0.0001, bm.r + bm.g + bm.b + bm.a + rm.a);`;
}

/** Uniforms the bake shares with the terrain material (the same objects). */
export interface BakeUniforms {
  uPal: { value: THREE.Vector3[] };
  tNoise: { value: THREE.Texture };
  tBase: { value: THREE.Texture };
  tRoad: { value: THREE.Texture };
  uMapSize: { value: THREE.Vector2 };
}

/**
 * The map-space colour texture of the Low ground: rgb = sqrt(linear colour of the natural ground), a = 1 where base
 * dressing or a road starts (the shader shades those per pixel). The terrain geometry is rendered from above (map x, y
 * -> texel) once; update() re-bakes the rows whose dressing changed since (structures built and destroyed).
 */
export class TerrainBake {
  readonly target: THREE.WebGLRenderTarget;
  readonly res: number;
  private scene = new THREE.Scene();
  private mesh: THREE.Mesh;
  private geometry: THREE.BufferGeometry;
  /** The bake's shader (map-space ground colour). */
  readonly material: THREE.ShaderMaterial;
  /** Dirty map rows [y0, y1] (cells), or null when the bake is current. */
  private dirty: [number, number] | null;

  constructor(geometry: THREE.BufferGeometry, private map: GameMap, climate: Climate, uniforms: BakeUniforms) {
    this.res = bakeRes(map.w, map.h);
    this.target = new THREE.WebGLRenderTarget(map.w * this.res, map.h * this.res, {
      depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false,
      wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
    });
    this.target.texture.name = 'terrain-bake';
    this.material = new THREE.ShaderMaterial({
      name: 'terrain-bake',
      uniforms: { ...uniforms },
      vertexShader: /* glsl */ `
        attribute vec4 aSplat;
        varying vec4 vSplat;
        varying vec3 vWPos;
        varying vec3 vWNormal;
        uniform vec2 uMapSize;
        void main() {
          vSplat = aSplat;
          vWPos = position;
          vWNormal = normal;
          // map (x, z) -> the whole target; texel rows follow map rows like the mask textures (v = z / h)
          gl_Position = vec4(position.x / uMapSize.x * 2.0 - 1.0, position.z / uMapSize.y * 2.0 - 1.0, 0.0, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uPal[7];
        uniform sampler2D tNoise;
        uniform sampler2D tBase;
        uniform sampler2D tRoad;
        uniform vec2 uMapSize;
        varying vec4 vSplat;
        varying vec3 vWPos;
        varying vec3 vWNormal;
        ${TNOISE_GLSL}
        vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }
        void main() {
          ${bakeBody(climate)}
          gl_FragColor = vec4(sqrt(max(col, vec3(0.0))), dressed);
        }`,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    // the undeformed ground (its own copy of positions and normals: craters, which reshape the terrain mesh, show as
    // churned soil per pixel; a strip re-baked later must match the first bake)
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', geometry.getAttribute('position').clone());
    geo.setAttribute('normal', geometry.getAttribute('normal').clone());
    geo.setAttribute('aSplat', geometry.getAttribute('aSplat'));
    geo.setIndex(geometry.getIndex());
    this.geometry = geo;
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    this.dirty = [0, map.h - 1];
  }

  get texture(): THREE.Texture {
    return this.target.texture;
  }

  /** Map rows y0..y1 (cells) changed: re-bake them (with a cell of margin for the bilinear mask lookups) on the next update. */
  markRows(y0: number, y1: number) {
    const a = Math.max(0, Math.floor(y0) - 1), b = Math.min(this.map.h - 1, Math.ceil(y1) + 1);
    if (b < a) return;
    this.dirty = this.dirty ? [Math.min(this.dirty[0], a), Math.max(this.dirty[1], b)] : [a, b];
  }

  /** Everything again (after a lost WebGL context). */
  invalidate() {
    this.dirty = [0, this.map.h - 1];
  }

  /** Render the dirty rows into the texture, if any. */
  update(renderer: THREE.WebGLRenderer) {
    const d = this.dirty;
    if (!d) return;
    this.dirty = null;
    const t = this.target, r = this.res;
    t.scissor.set(0, d[0] * r, t.width, (d[1] - d[0] + 1) * r);
    t.scissorTest = d[0] > 0 || d[1] < this.map.h - 1;
    const prev = renderer.getRenderTarget();
    const prevAuto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(t);
    renderer.render(this.scene, _cam);
    renderer.setRenderTarget(prev);
    renderer.autoClear = prevAuto;
  }

  dispose() {
    this.target.dispose();
    this.material.dispose();
    this.geometry.dispose(); // (also releases the index and splat buffers it shares with the terrain mesh, disposed with it)
  }
}

const _cam = new THREE.Camera();

/**
 * onBeforeCompile parts (MeshStandardMaterial) of the baked Low ground: `common` declarations, the `map` fragment
 * (replaces map_fragment), `rough` (after roughnessmap_fragment), `emissive` and `lightsEnd` (cloud shadows).
 */
export function bakedLowGlsl(climate: Climate) {
  const winter = climate === 'winter';
  const dress = DRESS[climate];
  const common = /* glsl */ `
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
    uniform sampler2D tBake;
    uniform vec2 uMapSize;
    varying vec4 vSplat;
    varying vec2 vOre;
    varying vec3 vWPos;
    varying vec3 vWNormal;
    ${TNOISE_GLSL}
    vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }`;
  const map = /* glsl */ `
    vec2 p = vWPos.xz;
    vec3 nW = normalize(vWNormal);
    vec2 duv = p / uMapSize;
    vec4 bk = texture2D(tBake, duv);
    vec3 col = bk.rgb * bk.rgb;
    vec4 n34 = texture2D(tNoise, p * (7.0 / 16.0));
    float n3 = n34.r;
    float n4 = n34.b;
    // the fine grain the bake leaves out
    col *= (0.86 + 0.28 * n3) * (0.94 + 0.12 * n4);
    vec4 sp = vSplat / max(0.001, dot(vSplat, vec4(1.0)));
    float cliff = smoothstep(0.28, 0.55, 1.0 - clamp(nW.y, 0.0, 1.0));
    float hw = vWPos.y + 0.32;
    float bed = smoothstep(0.0, -0.06, hw);
    float rhShoreWet = smoothstep(0.16, 0.0, hw + (n3 - 0.5) * 0.05) * (1.0 - cliff);
    // steep ground: layered rock strata (vertical detail a top-down bake cannot hold)
    if (cliff * (1.0 - bed) > 0.004) {
      float rn = tn_noise(p * 2.6);
      float rsy = vWPos.y * 3.4 + rn * 1.1 + n4 * 0.45;
      float rTone = fract(sin(floor(rsy) * 12.9898 + 4.1) * 43758.5453), rLf = fract(rsy);
      vec3 rock = mix(uPal[5], uPal[6], 0.2 + 0.5 * rTone + 0.3 * n4) * (0.84 + 0.3 * rn);
      rock *= (0.7 + 0.3 * smoothstep(0.0, 0.14, rLf)) * (1.0 + 0.14 * smoothstep(0.78, 0.98, rLf));
      col = mix(col, rock * 0.9, cliff * (1.0 - bed));
    }
    // ore stains the ground rusty (mottled, with bright flecks), gems leave a violet tint
    // (the noise alone reaches past the threshold: faint rusty specks off the fields too, as the procedural shading has)
    float ore = 0.0, fleck = 0.0;
    float oreArg = vOre.x * 1.25 + (n3 - 0.5) * 0.45 + (n4 - 0.5) * 0.2;
    if (oreArg > 0.08) {
      ore = smoothstep(0.08, 0.62, oreArg);
      fleck = smoothstep(0.78, 0.97, tn_noise(p * 31.0));
      vec3 oreStain = mix(srgb(vec3(0.52, 0.33, 0.16)), srgb(vec3(0.36, 0.28, 0.42)), vOre.y);
      oreStain *= (0.72 + 0.5 * n3) * (1.0 + fleck * 0.9);
      col = mix(col, oreStain, ore * 0.85);
    }
    // base dressing (props.ts) and roads, per pixel where the bake flags them: trampled ground and packed paths
    // between structures, concrete aprons, contact shade under the walls
    float concK = 0.0, concStain = 0.0;
    if (bk.a > 0.0) {
      vec4 bm = texture2D(tBase, duv), rm = texture2D(tRoad, duv);
      float n1 = tn_fbm(p * 0.11);
      float n2 = tn_fbm(p * 0.9 + 3.7);
      float bGround = (1.0 - cliff) * (1.0 - bed) * (1.0 - sp.z * 0.8);
      float wornK = smoothstep(0.0, 0.85, bm.r * (0.8 + 0.4 * n2) + (n3 - 0.5) * 0.18) * bGround;
      float bareK = smoothstep(0.55, 1.15, bm.r * (0.7 + 0.5 * n1) + bm.b * 0.3 + (n3 - 0.5) * 0.25) * bGround;
      col = mix(col, srgb(${glsl3(dress.worn)}) * (0.86 + 0.28 * n2) * (0.92 + 0.16 * n4), wornK * 0.9);
      col = mix(col, srgb(${glsl3(dress.bare)}) * (0.78 + 0.44 * n3), bareK * 0.8);
      float pathD = (1.0 - bm.b) * 0.6 + (n4 - 0.5) * 0.05;
      float onPath = step(0.02, bm.b) * bGround;
      float pathK = smoothstep(0.46, 0.22, pathD + (n3 - 0.5) * 0.14) * onPath;
      float ruts = smoothstep(0.06, 0.02, abs(pathD - 0.14)) * onPath * smoothstep(0.3, 0.6, n2 + n4 * 0.3);
      col = mix(col, srgb(${glsl3(dress.path)}) * (0.84 + 0.32 * n3), pathK * 0.85);
      col = mix(col, srgb(${glsl3(dress.rut)}) * (0.85 + 0.3 * n4), ruts * pathK * 0.4);
      float roadCore = smoothstep(${(ROAD_HALF.main + 0.1).toFixed(3)}, ${(ROAD_HALF.main - 0.12).toFixed(3)}, (1.0 - rm.r) * ${ROAD_REACH.toFixed(3)} + (n3 - 0.5) * 0.2) * step(0.004, rm.a) * bGround;
      col = mix(col, mix(srgb(${glsl3(dress.path)}), srgb(${glsl3(ROAD_LOW[climate])}), smoothstep(0.55, 0.85, rm.g)) * (0.84 + 0.32 * n3), roadCore * 0.85);
      // concrete: cast slabs (one per cell) with seams, stains and cracks
      concK = smoothstep(0.46, 0.54, bm.g + (n4 - 0.5) * 0.05) * (1.0 - cliff) * (1.0 - bed);
      if (concK > 0.0) {
        vec2 slabF = abs(fract(p) - 0.5);
        float seam = smoothstep(0.475, 0.492, max(slabF.x, slabF.y));
        concStain = smoothstep(0.52, 0.8, tn_fbm(p * 0.8 + 11.0));
        float crack = smoothstep(0.022, 0.0, abs(tn_noise(p * 2.7 + 5.0) - 0.5)) * step(0.55, tn_noise(p * 0.7 + 2.0));
        vec3 conc = srgb(${glsl3(dress.conc)}) * (0.88 + 0.1 * n3 + 0.12 * fract(sin(dot(floor(p), vec2(12.99, 78.23))) * 437.58));
        conc *= 1.0 - seam * 0.38 - crack * 0.32 - concStain * 0.24;
        float concEdge = 1.0 - smoothstep(0.5, 0.85, bm.g);
        ${climate === 'winter' ? `conc = mix(conc, srgb(vec3(0.8, 0.84, 0.9)) * (0.9 + 0.1 * n3), smoothstep(0.5, 0.85, concEdge * 0.4 + n1 * 0.45 + n3 * 0.4 - 0.1) * 0.75);`
          : climate === 'desert' ? `conc = mix(conc, uPal[3] * (0.9 + 0.18 * n2) * (0.94 + 0.12 * n4), smoothstep(0.5, 0.8, concEdge * 0.7 + n3 * 0.4) * 0.8);`
            : `conc = mix(conc, uPal[4] * (0.85 + 0.3 * n2) * (0.9 + 0.2 * n3), smoothstep(0.55, 0.85, concEdge * 0.65 + n3 * 0.4) * 0.6);`}
        col = mix(col, conc, concK);
      }
      col *= 1.0 - smoothstep(0.0, 1.0, bm.a) * 0.32 * (1.0 - cliff);
    }
    // persistent damage (terrain.deform / scorch / rut): churned soil in craters, burnt ground
    vec4 dmg = texture2D(tDeform, duv);
    vec3 soil = uPal[4] * vec3(0.85, 0.8, 0.74) * (0.7 + 0.55 * n3) * (1.0 - smoothstep(0.55, 1.0, dmg.a) * 0.35);
    col = mix(col, soil, smoothstep(0.05, 0.6, dmg.a) * 0.88);
    float burn = smoothstep(0.02, 0.9, dmg.g) * (0.7 + 0.3 * n4);
    col = mix(col, col * vec3(0.2, 0.18, 0.16) + vec3(0.01, 0.008, 0.006), burn * 0.85);
    // snow-capped peaks and weather snow cover on flat ground
    float peak = 0.0;
    if (vWPos.y > 2.4) peak = smoothstep(${climate === 'tropical' ? '6.0, 8.0' : climate === 'desert' ? '4.6, 6.4' : '3.2, 5.0'}, vWPos.y + tn_fbm(p * 0.9 + 3.7) * 0.8) * smoothstep(0.35, 0.7, nW.y);
    float snowCover = peak;
    if (uSnow > 0.0) snowCover = max(peak, uSnow * smoothstep(0.55, 0.85, nW.y) * smoothstep(0.25, 0.6, tn_fbm(p * 0.11) * 0.6 + n3 * 0.4 + uSnow * 0.5));
    snowCover *= 1.0 - bed;
    col = mix(col, srgb(vec3(0.86, 0.9, 0.95)) * (0.92 + 0.08 * n3), snowCover);
    // tread ruts show in snow (packed, blue-grey), sand and mud; barely on grass
    float snowy = ${winter ? 'max(snowCover, sp.x * (1.0 - cliff))' : 'snowCover'};
    float rutK = dmg.b * max(max(snowy, sp.y * 0.8), max(sp.w * 0.6, 0.15));
    col = mix(col, col * mix(vec3(0.62, 0.58, 0.52), vec3(0.7, 0.77, 0.88), snowy), clamp(rutK * 1.4, 0.0, 0.85));
    col = mix(col, soil, smoothstep(0.3, 0.9, dmg.a) * snowCover * 0.6);
    // rain-soaked ground is darker
    col *= 1.0 - uWet * 0.38 * (1.0 - snowCover);
    diffuseColor.rgb = col;`;
  const rough = /* glsl */ `#include <roughnessmap_fragment>
    roughnessFactor = mix(roughnessFactor, 0.32, uWet * 0.55);
    roughnessFactor = mix(roughnessFactor, 0.28, rhShoreWet * (1.0 - bed));
    roughnessFactor = mix(roughnessFactor, 0.6, snowCover);
    roughnessFactor = mix(roughnessFactor, mix(0.78, 0.22, uWet * concStain), concK);`;
  const lightsEnd = /* glsl */ `#include <lights_fragment_end>
    {
      // drifting cloud shadows (medium / high: the atmosphere pass shades them on everything)
      vec2 cp = vWPos.xz * 0.035 + vec2(uTime * 0.012, uTime * 0.006);
      float shade = 1.0 - smoothstep(0.45, 0.75, tn_fbm(cp)) * 0.4;
      reflectedLight.directDiffuse *= shade;
      reflectedLight.directSpecular *= shade;
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
  return { common, map, rough, lightsEnd, emissive };
}
