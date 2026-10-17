import * as THREE from 'three';
import { GameMap, WATER_LEVEL } from '../sim/map';
import { hash2, Noise2D } from '../core/rng';
import { getDummyShadowTexture, getNoiseTexture, TNOISE_GLSL } from './terrain';
import type { Weather } from './weather';
import { RippleSim } from './watersim';

/**
 * World Y of every water surface. Identical to the simulation's WATER_LEVEL (-0.32). The mean surface stays
 * there (gameplay height never changes); on open sea the rendered surface rolls with Gerstner waves around it
 * (see Water.surfaceOffset for pitching ships with the swell).
 */
export const WATER_SURFACE_Y = WATER_LEVEL;

const MAX_RIPPLES = 24;
const _floeTint = new THREE.Color();
/** Gerstner wave trains (open sea). */
const NWAVES = 5;

/** Wave surface sample (see Water.surfaceOffset). */
export interface WaterSurfaceSample {
  /** Height offset from WATER_SURFACE_Y (world units). */
  y: number;
  /** Surface normal. */
  nx: number;
  ny: number;
  nz: number;
}

/** Tileable wave normal map (256²): derivatives of a sum of travelling-wave-like sines plus fine noise. */
function makeWaveNormals(): THREE.DataTexture {
  const S = 256;
  const h = new Float32Array(S * S);
  // integer wave vectors keep the pattern tileable
  const waves: [number, number, number, number][] = [];
  for (let i = 0; i < 22; i++) {
    const a = hash2(i, 3, 41) * Math.PI * 2;
    const f = 2 + Math.floor(hash2(i, 5, 41) * (i < 8 ? 5 : 14));
    const kx = Math.round(Math.cos(a) * f), ky = Math.round(Math.sin(a) * f);
    if (!kx && !ky) continue;
    waves.push([kx, ky, 1 / Math.pow(Math.hypot(kx, ky), 1.25), hash2(i, 9, 41) * Math.PI * 2]);
  }
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x / S) * Math.PI * 2, v = (y / S) * Math.PI * 2;
      let s = 0;
      for (const [kx, ky, amp, ph] of waves) {
        // sharpened crests (choppy look)
        const w = Math.sin(kx * u + ky * v + ph) * 0.5 + 0.5;
        s += amp * (w * w * 2 - 0.5);
      }
      h[y * S + x] = s;
    }
  }
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const xp = (x + 1) % S, xm = (x + S - 1) % S, yp = (y + 1) % S, ym = (y + S - 1) % S;
      const dx = (h[y * S + xp] - h[y * S + xm]) * 2.2;
      const dy = (h[yp * S + x] - h[ym * S + x]) * 2.2;
      const i = (y * S + x) * 4;
      data[i] = Math.max(0, Math.min(255, Math.round(128 + dx * 127)));
      data[i + 1] = Math.max(0, Math.min(255, Math.round(128 + dy * 127)));
      // crest mask for foam / whitecaps
      data[i + 2] = Math.max(0, Math.min(255, Math.round((h[y * S + x] + 0.6) * 160)));
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Water: an opaque surface at WATER_SURFACE_Y drawn last among the opaque objects. On open sea (medium / high)
 * it is a vertex grid rolling with Gerstner swell (foam on the breaking crests, faded out towards every shore and
 * on small lakes; `surfaceOffset` gives ships the same motion), and on high an interactive heightfield
 * (watersim.ts) carries ship wakes and shell rings. Right before it
 * draws, the opaque scene colour and depth are copied (one GPU blit), so the shader can:
 *   - refract and tint what lies under the surface by the real thickness of water along the view ray
 *     (clear turquoise shallows, deep blue-green depths), with animated caustics on the bottom;
 *   - reflect the sky with fresnel, and (high) the units, ships and buildings above it by screen-space
 *     ray marching;
 *   - add sun / moon glints (shadowed by the sun's shadow map), shoreline foam with waves lapping up the
 *     beach, foam where hulls and rocks cut the surface, whitecaps in storms and rain ripples.
 * Low quality skips the copy and alpha-blends a simpler surface.
 *
 * Disturb it with `Water.current?.addRipple(x, z, strength)` (expanding rings: splashes, impacts, wakes).
 */
export class Water {
  /** The water of the running match (for addRipple from anywhere in the renderer). */
  static current: Water | null = null;

  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  /** Light whose shadow map darkens glints and reflections (set when shadows are on). */
  sun: THREE.DirectionalLight | null = null;
  private copy: THREE.WebGLRenderTarget | null = null;
  private ripples: THREE.Vector4[] = [];
  private nextRipple = 0;
  private time = 0;
  private heightTex: THREE.DataTexture;
  private normalTex: THREE.DataTexture;
  private hasWater: boolean;
  /** Open-sea factor per height texel (0 near shore / on lakes .. 1 open sea) and its texture. */
  private sea: Float32Array;
  private seaW: number;
  private seaH: number;
  private seaTex: THREE.DataTexture;
  /** Gerstner waves on this map (medium / high, open water). */
  readonly waves: boolean;
  private waveA: THREE.Vector4[] = [];
  private waveB: THREE.Vector4[] = [];
  private waveAmp = 0.7;
  private nWaves = NWAVES;
  /** Interactive heightfield ripples (high). */
  private ripples3: RippleSim | null = null;
  /** Ice floes drifting on open winter water (one instanced draw call; medium / high). */
  private floes: THREE.InstancedMesh | null = null;

  constructor(map: GameMap, heightAt: (x: number, y: number) => number, sunDir: THREE.Vector3, frozen = false, quality: 'low' | 'medium' | 'high' = 'high') {
    // height texture (one texel per 0.5 cell) used for shoreline foam and the low-quality depth tint
    const res = 2;
    const tw = map.w * res + 1, th = map.h * res + 1;
    const data = new Float32Array(tw * th);
    let minX = map.w, minY = map.h, maxX = 0, maxY = 0;
    for (let j = 0; j < th; j++) for (let i = 0; i < tw; i++) {
      const h = heightAt(i / res, j / res);
      data[j * tw + i] = h;
      if (h < WATER_LEVEL + 0.05) {
        minX = Math.min(minX, i / res); maxX = Math.max(maxX, i / res);
        minY = Math.min(minY, j / res); maxY = Math.max(maxY, j / res);
      }
    }
    const tex = new THREE.DataTexture(data, tw, th, THREE.RedFormat, THREE.FloatType);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    this.heightTex = tex;
    this.normalTex = makeWaveNormals();
    // open-sea mask: distance to the nearest shore, damped on small bodies (lakes stay calm)
    this.seaW = tw;
    this.seaH = th;
    this.sea = buildSeaMask(data, tw, th, res);
    const seaBytes = new Uint8Array(tw * th);
    for (let i = 0; i < tw * th; i++) seaBytes[i] = Math.round(this.sea[i] * 255);
    this.seaTex = new THREE.DataTexture(seaBytes, tw, th, THREE.RedFormat, THREE.UnsignedByteType);
    this.seaTex.magFilter = this.seaTex.minFilter = THREE.LinearFilter;
    this.seaTex.generateMipmaps = false;
    this.seaTex.needsUpdate = true;

    this.hasWater = maxX >= minX;
    this.nWaves = quality === 'high' ? NWAVES : 3;
    if (!this.hasWater) { minX = 0; maxX = 1; minY = 0; maxY = 1; }
    minX = Math.max(0, minX - 1); minY = Math.max(0, minY - 1);
    maxX = Math.min(map.w, maxX + 1); maxY = Math.min(map.h, maxY + 1);
    // waves need vertices: a grid on medium / high where there is open sea, one quad otherwise
    let seaMax = 0;
    for (let i = 0; i < this.sea.length; i++) seaMax = Math.max(seaMax, this.sea[i]);
    this.waves = quality !== 'low' && !frozen && this.hasWater && seaMax > 0.05;
    const cell = quality === 'high' ? 0.5 : 1;
    const segX = this.waves ? Math.max(1, Math.ceil((maxX - minX) / cell)) : 1;
    const segY = this.waves ? Math.max(1, Math.ceil((maxY - minY) / cell)) : 1;
    const geo = new THREE.PlaneGeometry(maxX - minX, maxY - minY, segX, segY);
    geo.rotateX(-Math.PI / 2);
    geo.translate((minX + maxX) / 2, WATER_LEVEL, (minY + maxY) / 2);
    for (let i = 0; i < NWAVES; i++) { this.waveA.push(new THREE.Vector4()); this.waveB.push(new THREE.Vector4()); }
    this.buildWaves(0.6, 0.2);
    if (this.waves && quality === 'high') this.ripples3 = new RippleSim(256, 48);

    for (let i = 0; i < MAX_RIPPLES; i++) this.ripples.push(new THREE.Vector4(0, 0, -100, 0));

    const refract = quality !== 'low' && !frozen;
    const defines: Record<string, string> = {};
    if (refract) defines.REFRACT = '';
    if (refract && quality === 'high') defines.SSR = '';
    if (quality !== 'low') defines.SHADOWS = '';
    if (frozen) defines.ICE = '';
    // open winter water (a sea, so not frozen): shelf ice along the banks and drifting floes
    const winterOpen = !frozen && map.climate === 'winter';
    if (winterOpen) defines.WINTER = '';
    if (quality === 'low') defines.LOW = '';
    if (this.waves) { defines.WAVES = ''; defines.NWAVES = String(quality === 'high' ? NWAVES : 3); }
    if (this.ripples3) defines.RIPPLE_SIM = '';
    if (refract) {
      this.copy = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter });
      this.copy.depthTexture = new THREE.DepthTexture(1, 1);
      this.copy.depthTexture.type = THREE.UnsignedIntType;
    }

    this.material = new THREE.ShaderMaterial({
      name: 'water',
      defines,
      transparent: !refract,
      depthWrite: true,
      uniforms: {
        uTime: { value: 0 },
        uHeight: { value: tex },
        tNormal: { value: this.normalTex },
        tNoise: { value: getNoiseTexture() },
        tScene: { value: this.copy?.texture ?? null },
        tSceneDepth: { value: this.copy?.depthTexture ?? null },
        tShadow: { value: getDummyShadowTexture() },
        uShadowMatrix: { value: new THREE.Matrix4() },
        uShadowOn: { value: 0 },
        uRes: { value: new THREE.Vector2(1, 1) },
        uNearFar: { value: new THREE.Vector2(0.5, 400) },
        uViewInv: { value: new THREE.Matrix4() },
        uProj: { value: new THREE.Matrix4() },
        uMapSize: { value: new THREE.Vector2(map.w, map.h) },
        uSunDir: { value: sunDir.clone().normalize() },
        uSunColor: { value: new THREE.Color(1.0, 0.86, 0.66) },
        uSky: { value: new THREE.Color(0.22, 0.38, 0.58) },
        uHorizon: { value: new THREE.Color(0.5, 0.56, 0.6) },
        uDeep: { value: new THREE.Color(0.006, 0.045, 0.075) },
        uShallow: { value: new THREE.Color(0.035, 0.2, 0.21) },
        uWaterLevel: { value: WATER_LEVEL },
        uWind: { value: new THREE.Vector2(0.6, 0.2) },
        uChop: { value: 0.3 },
        uRain: { value: 0 },
        uNight: { value: 0 },
        uOvercast: { value: 0 },
        uRipples: { value: this.ripples },
        tSea: { value: this.seaTex },
        uWaveA: { value: this.waveA },
        uWaveB: { value: this.waveB },
        uWaveAmp: { value: 0.7 },
        tRipple: { value: null },
        uRippleXf: { value: new THREE.Vector4(0, 0, 1, 0) },
      },
      vertexShader: /* glsl */ `
        uniform float uTime, uWaveAmp;
        uniform vec2 uMapSize;
        varying vec3 vWPos;
        varying vec3 vVPos;
        varying vec3 vGN;
        varying float vCrest;
        varying float vSea;
        varying float vWaveH;
        #ifdef WAVES
          uniform sampler2D tSea;
          uniform vec4 uWaveA[NWAVES];
          uniform vec4 uWaveB[NWAVES];
        #endif
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vGN = vec3(0.0, 1.0, 0.0);
          vCrest = 1.0;
          vSea = 0.0;
          vWaveH = 0.0;
          #ifdef WAVES
          {
            // Gerstner swell, faded out towards every shore (and on small lakes)
            float sea = texture2D(tSea, wp.xz / uMapSize).r;
            vSea = sea;
            float amp = sea * uWaveAmp;
            vec3 d = vec3(0.0);
            vec3 n = vec3(0.0, 1.0, 0.0);
            float jac = 1.0;
            for (int i = 0; i < NWAVES; i++) {
              vec4 a = uWaveA[i], b = uWaveB[i];
              float th = a.z * dot(a.xy, wp.xz) - b.x * uTime + b.y;
              float A = a.w * amp, s = sin(th), c = cos(th);
              d.xz += b.z * A * a.xy * c;
              d.y += A * s;
              n.xz -= a.xy * (a.z * A * c);
              n.y -= b.z * a.z * A * s;
              jac -= b.z * a.z * A * s;
            }
            wp.xyz += d;
            vGN = normalize(n);
            vCrest = jac;
            vWaveH = d.y;
          }
          #endif
          vWPos = wp.xyz;
          vec4 vp = viewMatrix * wp;
          vVPos = vp.xyz;
          gl_Position = projectionMatrix * vp;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform sampler2D uHeight, tNormal, tNoise, tScene, tSceneDepth;
        uniform vec2 uMapSize, uRes, uNearFar, uWind;
        uniform vec3 uSunDir, uSunColor, uSky, uHorizon, uDeep, uShallow;
        uniform float uWaterLevel, uChop, uRain, uNight, uShadowOn, uOvercast;
        uniform vec4 uRipples[${MAX_RIPPLES}];
        uniform mat4 uViewInv, uProj;
        varying vec3 vGN;
        varying float vCrest;
        varying float vSea;
        varying float vWaveH;
        #ifdef RIPPLE_SIM
          uniform sampler2D tRipple;
          uniform vec4 uRippleXf;
        #endif
        #ifdef SHADOWS
          uniform sampler2DShadow tShadow;
          uniform mat4 uShadowMatrix;
        #endif
        varying vec3 vWPos;
        varying vec3 vVPos;
        ${TNOISE_GLSL}

        float viewZ(float d) { return (uNearFar.x * uNearFar.y) / ((uNearFar.y - uNearFar.x) * d - uNearFar.y); }
        vec3 viewPosAt(vec2 uv, float d) {
          float z = viewZ(d);
          return vec3((uv * 2.0 - 1.0) * vec2(1.0 / uProj[0][0], 1.0 / uProj[1][1]) * -z, z);
        }
        float rh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

        // expanding rings: splashes, shell impacts, wakes (Water.addRipple)
        vec2 ripples(vec2 p) {
          vec2 g = vec2(0.0);
          for (int i = 0; i < ${MAX_RIPPLES}; i++) {
            vec4 r = uRipples[i];
            float age = uTime - r.z;
            if (age < 0.0 || age > 4.0) continue;
            vec2 d = p - r.xy;
            float dist = length(d);
            float rad = age * 1.5;
            float x = dist - rad;
            float env = exp(-x * x * 18.0) * exp(-age * 1.1) * r.w;
            g += d / max(dist, 1e-3) * cos(x * 22.0) * env;
          }
          return g;
        }
        // rain drops: a random ring per small cell, two layers
        vec2 rainRipples(vec2 p) {
          vec2 g = vec2(0.0);
          for (int l = 0; l < 2; l++) {
            vec2 q = p * (3.2 + float(l) * 1.9) + float(l) * 17.3;
            vec2 id = floor(q);
            vec2 f = fract(q) - 0.5;
            float h = rh(id);
            vec2 c = (vec2(rh(id + 3.1), rh(id + 7.7)) - 0.5) * 0.5;
            float ph = fract(uTime * (0.8 + h * 0.5) + h);
            vec2 d = f - c;
            float dist = length(d);
            float x = dist - ph * 0.45;
            g += d / max(dist, 1e-3) * sin(x * 48.0) * exp(-x * x * 400.0) * (1.0 - ph);
          }
          return g;
        }

        void main() {
          vec2 p = vWPos.xz;
          vec3 V = normalize(cameraPosition - vWPos);
          float camDist = length(cameraPosition - vWPos);
          vec2 hm = vWPos.xz / uMapSize;
          float ground = texture2D(uHeight, hm).r;
          float depthV = uWaterLevel - ground;

          #ifdef ICE
          {
            // frozen lake / river: a mosaic of ice plates (jittered cells) welded by dark refrozen leads,
            // clear blue-green ice in the middle, wind-blown snow drifts, a snow-covered shelf along the banks
            if (depthV < -0.02) discard;
            float d = clamp(depthV / 0.5, 0.0, 1.0);
            vec2 q = p * 0.85 + vec2(tn_noise(p * 1.3), tn_noise(p * 1.3 + 9.0)) * 0.35;
            vec2 ip = floor(q), fp = fract(q);
            float d1 = 8.0, d2 = 8.0;
            vec2 cid = vec2(0.0);
            for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
              vec2 g = vec2(float(i), float(j));
              vec2 o = vec2(rh(ip + g), rh(ip + g + 17.3)) * 0.8 + 0.1;
              vec2 r = g + o - fp;
              float dd = dot(r, r);
              if (dd < d1) { d2 = d1; d1 = dd; cid = ip + g; } else if (dd < d2) d2 = dd;
            }
            float seamD = sqrt(d2) - sqrt(d1);
            float seam = smoothstep(0.09, 0.015, seamD);
            float plate = rh(cid);
            float drift = smoothstep(0.42, 0.72, tn_fbm(p * 0.55 + 3.0) * 0.8 + plate * 0.35 - d * 0.25);
            vec3 clearIce = mix(vec3(0.2, 0.42, 0.5), vec3(0.42, 0.6, 0.68), plate * 0.6 + tn_noise(p * 3.0) * 0.4);
            vec3 frost = vec3(0.78, 0.85, 0.9) * (0.94 + 0.06 * tn_noise(p * 5.0));
            vec3 ice = mix(clearIce, frost, max(drift, 0.35 * (1.0 - d)));
            // fine cracks inside the plates
            float cr = abs(tn_noise(p * 2.6 + cid * 3.1) - 0.5);
            ice *= 1.0 - smoothstep(0.02, 0.0, cr) * 0.3 * (1.0 - drift);
            // leads between the plates: dark, refrozen; snow fills some of them
            ice = mix(ice, vec3(0.05, 0.12, 0.17), seam * (1.0 - drift * 0.8) * 0.85);
            ice = mix(ice, vec3(0.88, 0.92, 0.96), seam * drift * 0.5);
            // the bank shelf: snow piled on the ice
            float shelf = smoothstep(0.14, 0.02, depthV + (tn_noise(p * 2.0) - 0.5) * 0.08);
            ice = mix(ice, vec3(0.86, 0.9, 0.95), shelf * 0.85);
            vec3 H = normalize(uSunDir + V);
            float dif = max(uSunDir.y, 0.0);
            float gloss = (1.0 - drift) * (1.0 - shelf) * (1.0 - seam * 0.5);
            vec3 col = ice * (0.45 + 0.55 * dif) * (0.35 + 0.65 * uSunColor);
            // sky reflection and a sharp glint on the clear ice
            vec3 Ri = reflect(-V, vec3(0.0, 1.0, 0.0));
            col = mix(col, mix(uHorizon, uSky, smoothstep(0.0, 0.8, Ri.y)) * 1.1, gloss * 0.22 * (0.04 + 0.96 * pow(1.0 - max(dot(V, vec3(0.0, 1.0, 0.0)), 0.0), 5.0)) + gloss * 0.08);
            col += uSunColor * pow(max(H.y, 0.0), 160.0) * 1.6 * gloss;
            float a = smoothstep(-0.02, 0.04, depthV);
            gl_FragColor = vec4(col, a);
            return;
          }
          #endif

          // ---- surface normal: two scrolling wave layers, faded with distance, plus ripples
          vec2 wdir = normalize(uWind + vec2(0.001));
          vec2 n1 = texture2D(tNormal, p * 0.11 + wdir * uTime * 0.035).rg * 2.0 - 1.0;
          float fade = 1.0 / (1.0 + camDist * 0.012);
          #ifdef LOW
            // the finer layer alone (the broad one would make glints into large blobs)
            vec2 nf = texture2D(tNormal, p * 0.29 * mat2(0.8, -0.6, 0.6, 0.8) - wdir.yx * uTime * 0.05).rg * 2.0 - 1.0;
            vec2 slope = nf * (0.16 + uChop * 0.2) * fade;
          #else
            vec2 n2 = texture2D(tNormal, p * 0.29 * mat2(0.8, -0.6, 0.6, 0.8) - wdir.yx * uTime * 0.05).rg * 2.0 - 1.0;
            vec2 slope = (n1 * 0.55 + n2 * 0.45) * (0.16 + uChop * 0.2) * fade;
            #ifdef RIPPLE_SIM
              // interactive surface (ship wakes, shell rings) from the heightfield simulation
              vec2 rpUv = (p - uRippleXf.xy) * uRippleXf.z;
              float rpK = uRippleXf.w * step(0.0, rpUv.x) * step(0.0, rpUv.y) * step(rpUv.x, 1.0) * step(rpUv.y, 1.0);
              float rpT = 1.0 / 256.0;
              float rp0 = texture2D(tRipple, rpUv).r;
              vec2 rpG = vec2(texture2D(tRipple, rpUv + vec2(rpT, 0.0)).r - rp0, texture2D(tRipple, rpUv + vec2(0.0, rpT)).r - rp0);
              slope += rpG * 1.3 * rpK;
              float rippleFoam = smoothstep(0.2, 0.6, abs(rp0)) * rpK;
            #else
              slope += ripples(p) * 0.35;
              float rippleFoam = 0.0;
            #endif
            if (uRain > 0.01) slope += rainRipples(p) * 0.22 * uRain;
          #endif
          #ifdef LOW
            float rippleFoam = 0.0;
          #endif
          // swell normal (Gerstner) tilted by the detail waves
          vec3 N = normalize(vGN + vec3(-slope.x, 0.0, -slope.y));

          // ---- lighting terms
          float NdotV = max(dot(N, V), 0.0);
          float fres = 0.04 + 0.96 * pow(1.0 - NdotV, 5.0);
          vec3 R = reflect(-V, N);
          float shadow = 1.0;
          #ifdef SHADOWS
            if (uShadowOn > 0.5) {
              vec4 sc = uShadowMatrix * vec4(vWPos, 1.0);
              if (sc.x > 0.0 && sc.x < 1.0 && sc.y > 0.0 && sc.y < 1.0 && sc.z < 1.0) shadow = texture(tShadow, vec3(sc.xy, sc.z - 0.001));
            }
          #endif
          // sky: zenith to horizon gradient, a little brighter towards the sun
          vec3 sky = mix(uHorizon, uSky, smoothstep(0.0, 0.8, R.y));
          sky += uSunColor * 0.08 * pow(max(dot(R, uSunDir), 0.0), 8.0);
          // Glitter: the sun (moon at night) sits behind the camera to throw shadows away from it, so a true
          // mirror highlight would never be on screen. The glints use the same light swung to the far side.
          vec3 Lg = normalize(vec3(uSunDir.x * 0.5, max(uSunDir.y, 0.3) * 0.8, -abs(uSunDir.z) - 0.35));
          vec3 H = normalize(Lg + V);
          float glint = pow(max(dot(N, H), 0.0), mix(1600.0, 500.0, uChop)) * mix(8.0, 4.0, uChop);
          #ifdef LOW
            // one broad wave layer only: keep its glints small
            glint = pow(max(dot(N, H), 0.0), 3000.0) * 3.0;
          #endif
          // overcast skies have no glitter
          vec3 spec = uSunColor * glint * shadow * (1.0 + uNight * 1.5) * (1.0 - 0.95 * uOvercast);
          // light reaching the surface: sky plus direct sun / moon (dark at night, so is the water)
          vec3 light = uSky * 0.8 + uSunColor * max(uSunDir.y, 0.0) * 0.32 * (0.35 + 0.65 * shadow);
          light = max(light, vec3(0.012, 0.022, 0.04));

          vec3 col;
          float foamMask = 0.0;
          #ifdef REFRACT
            vec2 suv = gl_FragCoord.xy / uRes;
            float d0 = texture2D(tSceneDepth, suv).x;
            vec3 behind = viewPosAt(suv, d0);
            float thick = max(length(behind - vVPos), 0.0);
            // refraction: offset by the surface slope, more in deep water; reject samples above the surface
            vec2 ruv = suv + slope * 0.06 * clamp(thick, 0.0, 1.0);
            float d1 = texture2D(tSceneDepth, ruv).x;
            if (viewZ(d1) > vVPos.z) { ruv = suv; d1 = d0; }
            vec3 behindR = viewPosAt(ruv, d1);
            float thickR = max(length(behindR - vVPos), 0.0);
            vec3 under = texture2D(tScene, ruv).rgb;
            // world position of the bottom (for caustics and the vertical depth)
            vec3 bottomW = (uViewInv * vec4(behindR, 1.0)).xyz;
            float vdepth = max(uWaterLevel - bottomW.y, 0.0);
            // caustics: the ridge where two drifting noise fields cross, brightest in the shallows
            vec2 cp = bottomW.xz * 1.7;
            float c1 = tn_noise(cp + vec2(uTime * 0.31, uTime * 0.17));
            float c2 = tn_noise(cp * 1.31 + vec2(-uTime * 0.23, uTime * 0.29) + 5.7);
            float caus = pow(1.0 - min(1.0, abs(c1 - c2) * 3.2), 5.0);
            float sunUnder = exp(-vdepth * 3.0) * shadow;
            float causBreak = 0.35 + 0.65 * tn_noise(bottomW.xz * 0.45 + uTime * 0.03);
            under += uSunColor * caus * 0.16 * causBreak * sunUnder * smoothstep(0.0, 0.08, vdepth) * fade;
            // absorption along the path through the water, red first
            vec3 trans = exp(-vec3(6.5, 2.4, 1.6) * thickR);
            // light scattered back out of the water body; the wave facets catch it unevenly (visible swell)
            float facet = 0.72 + 0.56 * clamp(dot(N, normalize(uSunDir + vec3(0.0, 1.5, 0.0))) * 1.6 - 0.6, 0.0, 1.0);
            vec3 scatter = mix(uShallow, uDeep, 1.0 - exp(-thickR * 2.2)) * light * facet;
            vec3 body = under * trans + scatter * (1.0 - trans);
            // reflection: sky, replaced by what the ray hits on screen (high)
            vec3 refl = sky;
            #ifdef SSR
            {
              vec3 Nv = normalize((viewMatrix * vec4(N, 0.0)).xyz);
              vec3 rv = normalize(reflect(normalize(vVPos), Nv));
              vec3 pos = vVPos;
              float stepLen = 0.18;
              float hit = 0.0;
              vec2 huv = suv;
              for (int i = 0; i < 20; i++) {
                pos += rv * stepLen;
                stepLen *= 1.18;
                vec4 pc = uProj * vec4(pos, 1.0);
                vec2 q = pc.xy / pc.w * 0.5 + 0.5;
                if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) break;
                float sz = viewZ(texture2D(tSceneDepth, q).x);
                float dz = sz - pos.z;
                if (dz > 0.0 && dz < 1.2 + stepLen) {
                  // refine between the last two samples
                  vec3 a = pos - rv * stepLen / 1.18, b = pos;
                  for (int k = 0; k < 4; k++) {
                    vec3 m = (a + b) * 0.5;
                    vec4 mc = uProj * vec4(m, 1.0);
                    vec2 mq = mc.xy / mc.w * 0.5 + 0.5;
                    if (viewZ(texture2D(tSceneDepth, mq).x) > m.z) b = m; else a = m;
                  }
                  vec4 bc = uProj * vec4(b, 1.0);
                  huv = bc.xy / bc.w * 0.5 + 0.5;
                  vec2 edge = smoothstep(0.0, 0.08, huv) * smoothstep(1.0, 0.92, huv);
                  hit = edge.x * edge.y * (1.0 - float(i) / 20.0);
                  break;
                }
              }
              if (hit > 0.0) refl = mix(refl, texture2D(tScene, huv).rgb, hit);
            }
            #endif
            float rk = clamp(fres * 1.6 + 0.1, 0.0, 1.0);
            col = mix(body, refl, rk);
            // foam where anything cuts the surface (shore, hulls, rocks): vertical gap from the depth buffer
            vec3 behindW = (uViewInv * vec4(behind, 1.0)).xyz;
            float gap = max(vWPos.y - behindW.y, 0.0);
            foamMask = smoothstep(0.035, 0.0, min(gap, max(depthV, 0.0)));
          #else
            if (depthV < -0.02) discard;
            float d = clamp(depthV / 0.5, 0.0, 1.0);
            vec3 body = mix(uShallow, uDeep, smoothstep(0.0, 1.0, d)) * (0.55 + 0.45 * max(dot(N, uSunDir), 0.0)) * light;
            float caus = pow(tn_noise(p * 4.0 + vec2(uTime * 0.5, uTime * 0.3)) * tn_noise(p * 4.7 - vec2(uTime * 0.4, -uTime * 0.2)), 2.0);
            body += vec3(0.25, 0.4, 0.35) * caus * (1.0 - d) * 0.5 * light;
            col = mix(body, sky * 0.85, clamp(fres * 1.2 + 0.06, 0.0, 1.0));
            foamMask = smoothstep(0.035, 0.0, depthV);
          #endif
          col += spec;
          // light through the thin crests of the swell (turquoise), deeper troughs
          col += uShallow * light * clamp(vWaveH * 2.6, -0.4, 1.0) * 0.8;

          // ---- foam: waves lapping up the beach (bands travelling shorewards), the waterline, whitecaps
          float shoreD = max(depthV, 0.0);
          float bandPhase = shoreD * 55.0 - uTime * 1.6 + tn_noise(p * 1.1) * 6.0;
          float band = smoothstep(0.8, 0.99, sin(bandPhase) * 0.5 + 0.5) * smoothstep(0.26, 0.03, shoreD) * smoothstep(0.35, 0.65, tn_noise(p * 0.9 + vec2(0.0, uTime * 0.1)));
          float breakup = smoothstep(0.35, 0.8, tn_fbm(p * 3.1 + vec2(uTime * 0.12, -uTime * 0.09)));
          // whitecaps: small streaks on the sharpest crests of the finer wave layer, only in strong wind
          float crest = texture2D(tNormal, p * 0.29 * mat2(0.8, -0.6, 0.6, 0.8) - wdir.yx * uTime * 0.05).b;
          float streak = smoothstep(0.55, 0.85, tn_noise(p * vec2(6.0, 1.5) + wdir * uTime * 0.4));
          // (the crest mask saturates on the tallest crests: a wide ramp plus fine froth noise keeps the caps from
          // reading as flat, hard-edged polygons)
          float froth = smoothstep(0.35, 0.75, tn_noise(p * 14.0 + wdir * uTime * 0.6) * 0.65 + tn_noise(p * 27.0 - wdir * uTime * 0.9) * 0.35);
          float whitecap = smoothstep(0.72, 1.0, crest) * smoothstep(0.55, 1.0, uChop) * streak * froth * 0.5 * (0.3 + 0.7 * smoothstep(0.2, 0.8, tn_noise(p * 4.3 - wdir * uTime * 0.3)));
          float lace = smoothstep(0.25, 0.7, tn_noise(p * 9.0 + vec2(uTime * 0.2, 0.0)) * 0.6 + breakup * 0.6);
          // breaking crests of the swell (Gerstner compression) and churned water in wakes
          float crestFoam = smoothstep(0.9, 0.6, vCrest) * smoothstep(0.35, 1.0, uChop) * (0.35 + 0.65 * tn_fbm(p * 1.7 + wdir * uTime * 0.5)) * lace;
          float foam = clamp(foamMask * (0.25 + 0.6 * lace) + band * lace * 0.45 + whitecap * 0.7 + crestFoam * 0.55 + rippleFoam * lace * 0.45, 0.0, 0.92);
          vec3 foamCol = vec3(0.82, 0.86, 0.88) * mix(light, vec3(dot(light, vec3(0.33))), 0.5) * 0.9;
          col = mix(col, foamCol, foam);

          #ifdef WINTER
          {
            // shelf ice: shallow water along the banks freezes (further out in calm water), ragged edge,
            // snow on it and a bright broken rim
            float shelfLine = 0.14 + 0.16 * (1.0 - vSea);
            float ragged = (tn_noise(p * 1.7) - 0.5) * 0.12 + (tn_noise(p * 6.0) - 0.5) * 0.04;
            float sd = depthV + ragged - shelfLine;
            float shelf = smoothstep(0.012, -0.012, sd);
            // snow-covered further in, bare blue-grey ice towards the open water, cracks and pressure lines
            float snowy = smoothstep(0.38, 0.8, tn_fbm(p * 0.9) * 0.65 + (-sd) * 1.4 + 0.08);
            vec3 sCol = mix(mix(vec3(0.24, 0.42, 0.5), vec3(0.5, 0.64, 0.7), tn_noise(p * 2.4)), vec3(0.8, 0.85, 0.9), snowy);
            // cracks and pressure ridges (darker, bluish)
            float crk = smoothstep(0.03, 0.0, abs(tn_noise(p * 3.3) - 0.5)) + 0.6 * smoothstep(0.02, 0.0, abs(tn_noise(p * 1.4 + 7.0) - 0.5));
            sCol = mix(sCol, vec3(0.2, 0.34, 0.42), clamp(crk, 0.0, 1.0) * 0.45 * (1.0 - snowy * 0.5));
            sCol *= (0.45 + 0.55 * max(uSunDir.y, 0.0)) * (0.35 + 0.65 * uSunColor);
            sCol = max(sCol, light * 0.5);
            // a lighter broken rim where the shelf meets the water
            sCol *= 1.0 + smoothstep(-0.03, 0.0, sd) * 0.2;
            col = mix(col, sCol, shelf);
            // slush and broken ice just beyond the edge
            col = mix(col, vec3(0.72, 0.8, 0.84) * light * 1.4, smoothstep(0.06, 0.0, sd) * (1.0 - shelf) * 0.55 * smoothstep(0.3, 0.7, tn_noise(p * 8.0)));
            #ifndef REFRACT
              foam = max(foam, shelf);
            #endif
          }
          #endif
          #ifdef REFRACT
            gl_FragColor = vec4(col, 1.0);
          #else
            float a = clamp(0.72 + clamp(depthV / 0.5, 0.0, 1.0) * 0.28 + fres * 0.3 + foam, 0.0, 0.98);
            a *= smoothstep(-0.02, 0.03, depthV);
            gl_FragColor = vec4(col, a);
          #endif
        }`,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    if (winterOpen && quality !== 'low') this.floes = this.buildFloes(map, data, tw, res, quality, defines);
    // opaque water is drawn after every other opaque object (it copies them first); the low-quality
    // transparent version keeps its place among the transparent objects
    this.mesh.renderOrder = refract ? 1000 : 1;
    this.mesh.name = 'water';
    this.mesh.visible = this.hasWater;
    if (this.copy) {
      const copy = this.copy;
      this.mesh.onBeforeRender = (renderer, _scene, camera) => {
        const src = renderer.getRenderTarget();
        if (!src || src === copy) return;
        const u = this.material.uniforms;
        const pc = camera as THREE.PerspectiveCamera;
        if (pc.isPerspectiveCamera) u.uNearFar.value.set(pc.near, pc.far);
        u.uViewInv.value.copy(camera.matrixWorld);
        u.uProj.value.copy(camera.projectionMatrix);
        this.grab(renderer, src as THREE.WebGLRenderTarget);
      };
    }
    Water.current = this;
  }

  /**
   * Ice floes on open winter water: irregular slabs scattered in drifting clusters beyond the shelf ice.
   * They ride the same Gerstner swell as the surface (shared uniforms) and drift slowly around their spot.
   */
  private buildFloes(map: GameMap, h: Float32Array, tw: number, res: number, quality: 'medium' | 'high', defines: Record<string, string>): THREE.InstancedMesh | null {
    const noise = new Noise2D(map.seed + 4242);
    const spots: [number, number, number, number][] = [];
    const cap = quality === 'high' ? 520 : 260;
    for (let cy = 0; cy < map.h && spots.length < cap; cy++) {
      for (let cx = 0; cx < map.w && spots.length < cap; cx++) {
        const x = cx + 0.25 + hash2(cx, cy, 61) * 0.5, y = cy + 0.25 + hash2(cx, cy, 62) * 0.5;
        const depth = WATER_LEVEL - h[Math.round(y * res) * tw + Math.round(x * res)];
        if (!(depth > 0.36)) continue;
        const sea = this.seaFactor(x, y);
        const cluster = noise.fbm(cx * 0.14, cy * 0.14, 3);
        const p = cluster > 0.5 ? 0.6 : cluster > 0.4 ? 0.22 : 0.05;
        if (hash2(cx, cy, 63) > p * (1 - sea * 0.5)) continue;
        spots.push([x, y, 0.14 + Math.pow(hash2(cx, cy, 64), 2) * 0.4 + (cluster > 0.58 ? 0.12 : 0), hash2(cx, cy, 65)]);
        // brash: a couple of small chunks around the bigger floes
        if (cluster > 0.5 && hash2(cx, cy, 68) < 0.5 && spots.length < cap) spots.push([x + (hash2(cx, cy, 69) - 0.5) * 0.9, y + (hash2(cx, cy, 70) - 0.5) * 0.9, 0.06 + hash2(cx, cy, 71) * 0.06, hash2(cx, cy, 72)]);
      }
    }
    if (!spots.length) return null;
    // slab: a jagged polygon, snowy top, blue-green flanks (mostly under water)
    const n = 9, pos: number[] = [], col: number[] = [];
    const ring: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (hash2(i, 3, 66) - 0.5) * 0.45;
      const r = 0.5 * (0.55 + hash2(i, 4, 66) * 0.6) * (i % 3 === 1 ? 0.8 : 1);
      ring.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    const top = 0.03, bot = -0.06;
    const snow = [0.78, 0.84, 0.88], snowEdge = [0.5, 0.66, 0.74], flank = [0.3, 0.5, 0.58], deep = [0.1, 0.26, 0.32];
    for (let i = 0; i < n; i++) {
      const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % n];
      pos.push(0, top + 0.012, 0, bx, top, bz, ax, top, az);
      col.push(...snow, ...snowEdge, ...snowEdge);
      pos.push(ax, top, az, bx, top, bz, bx, bot, bz, ax, top, az, bx, bot, bz, ax * 0.9, bot, az * 0.9);
      col.push(...flank, ...flank, ...deep, ...flank, ...deep, ...deep);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0 });
    const u = this.material.uniforms;
    const waves = 'WAVES' in defines;
    mat.defines = waves ? { RH_FLOE_WAVES: '', NWAVES: defines.NWAVES } : {};
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, { uTime: u.uTime, uWaveAmp: u.uWaveAmp, tSea: u.tSea, uWaveA: u.uWaveA, uWaveB: u.uWaveB, uMapSize: u.uMapSize });
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          uniform float uTime, uWaveAmp;
          uniform vec2 uMapSize;
          #ifdef RH_FLOE_WAVES
            uniform sampler2D tSea;
            uniform vec4 uWaveA[NWAVES];
            uniform vec4 uWaveB[NWAVES];
          #endif`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vec3 floeOff = vec3(0.0);
          {
            vec2 ip = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
            float ph = fract(sin(dot(ip, vec2(12.9898, 78.233))) * 43758.5453) * 6.283;
            vec2 drift = vec2(sin(uTime * 0.07 + ph), cos(uTime * 0.05 + ph * 1.3)) * 0.16;
            floeOff.xz = drift;
            #ifdef RH_FLOE_WAVES
              vec2 wp = ip + drift;
              float amp = texture2D(tSea, wp / uMapSize).r * uWaveAmp;
              for (int i = 0; i < NWAVES; i++) {
                vec4 a = uWaveA[i], b = uWaveB[i];
                float th = a.z * dot(a.xy, wp) - b.x * uTime + b.y;
                float A = a.w * amp;
                floeOff.xz += b.z * A * a.xy * cos(th);
                floeOff.y += A * sin(th);
              }
            #endif
          }`)
        .replace('#include <project_vertex>', `
          vec4 mvPosition = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            mvPosition = instanceMatrix * mvPosition;
          #endif
          mvPosition.xyz += floeOff;
          mvPosition = modelViewMatrix * mvPosition;
          gl_Position = projectionMatrix * mvPosition;`);
    };
    mat.customProgramCacheKey = () => 'rh-floe' + (waves ? '-w' + defines.NWAVES : '');
    const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
    const d = new THREE.Object3D();
    spots.forEach(([x, y, r, k], i) => {
      d.position.set(x, WATER_LEVEL, y);
      d.rotation.set(0, k * 6.283, 0);
      d.scale.set(r * (0.75 + hash2(i, 1, 67) * 0.5) * 2, 1, r * (0.75 + hash2(i, 2, 67) * 0.5) * 2);
      d.updateMatrix();
      mesh.setMatrixAt(i, d.matrix);
      // some floes are bare, glassy ice, most carry snow
      const t = hash2(i, 3, 67);
      mesh.setColorAt(i, _floeTint.setRGB(0.75 + t * 0.25, 0.8 + t * 0.2, 0.86 + t * 0.14));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.name = 'ice-floes';
    mesh.raycast = () => {};
    this.mesh.add(mesh);
    return mesh;
  }

  /** Copy the opaque scene (colour + depth) the water refracts and reflects. One blit, no draw call. */
  private grab(renderer: THREE.WebGLRenderer, src: THREE.WebGLRenderTarget) {
    const dst = this.copy!;
    if (dst.width !== src.width || dst.height !== src.height) dst.setSize(src.width, src.height);
    const props = renderer.properties as unknown as { get(o: object): { __webglFramebuffer?: WebGLFramebuffer } };
    if (!props.get(dst).__webglFramebuffer) renderer.initRenderTarget(dst);
    const srcFb = props.get(src).__webglFramebuffer, dstFb = props.get(dst).__webglFramebuffer;
    if (!srcFb || !dstFb || !src.depthTexture) return;
    const gl = renderer.getContext() as WebGL2RenderingContext;
    const state = renderer.state as unknown as { bindFramebuffer(target: number, fb: WebGLFramebuffer | null): boolean };
    state.bindFramebuffer(gl.READ_FRAMEBUFFER, srcFb);
    state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dstFb);
    gl.blitFramebuffer(0, 0, src.width, src.height, 0, 0, dst.width, dst.height, gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT, gl.NEAREST);
    state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, srcFb);
    this.material.uniforms.uRes.value.set(src.width, src.height);
  }

  setSize(w: number, h: number) {
    this.material.uniforms.uRes.value.set(w, h);
  }

  /** Fixed wave trains (directions around the prevailing wind): changing them later would slide the crests. */
  private buildWaves(wx: number, wz: number) {
    const base = Math.atan2(wz, wx);
    const spec: [number, number, number, number][] = [
      // wavelength, angle offset, Gerstner steepness, slope (k * amplitude) at scale 1
      [18, 0.3, 0.3, 0.035], [9.5, -0.45, 0.5, 0.05], [5.6, 0.8, 0.6, 0.09], [3.5, -1.1, 0.65, 0.08], [2.2, 0.25, 0.7, 0.07],
    ];
    for (let i = 0; i < NWAVES; i++) {
      const [L, off, Q, slope] = spec[i];
      const k = (Math.PI * 2) / L;
      const a = base + off;
      this.waveA[i].set(Math.cos(a), Math.sin(a), k, i < this.nWaves ? slope / k : 0);
      this.waveB[i].set(Math.sqrt(9.8 * k) * 0.42, hash2(i, 7, 13) * Math.PI * 2, Q, 0);
    }
  }

  /** Open-sea factor at world (x, z) (0 near shore and on small lakes, 1 out at sea). */
  seaFactor(x: number, z: number): number {
    const fx = Math.max(0, Math.min(this.seaW - 1.001, x * 2)), fz = Math.max(0, Math.min(this.seaH - 1.001, z * 2));
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    const S = this.sea, w = this.seaW, k = j * w + i;
    return (S[k] * (1 - tx) + S[k + 1] * tx) * (1 - tz) + (S[k + w] * (1 - tx) + S[k + w + 1] * tx) * tz;
  }

  /**
   * The rolling surface at world (x, z) (default: now): height offset from WATER_SURFACE_Y and normal, so
   * ships can pitch and roll with the swell. Calm (0, up) on lakes, near shores, on low quality and on ice.
   * Gameplay heights never change. Pass `out` to avoid an allocation.
   */
  surfaceOffset(x: number, z: number, time = this.time, out: WaterSurfaceSample = { y: 0, nx: 0, ny: 1, nz: 0 }): WaterSurfaceSample {
    out.y = 0; out.nx = 0; out.ny = 1; out.nz = 0;
    if (!this.waves) return out;
    const amp = this.seaFactor(x, z) * this.waveAmp;
    if (amp <= 1e-4) return out;
    let y = 0, nx = 0, ny = 1, nz = 0;
    for (let i = 0; i < this.nWaves; i++) {
      const a = this.waveA[i], b = this.waveB[i];
      const th = a.z * (a.x * x + a.y * z) - b.x * time + b.y;
      const A = a.w * amp, s = Math.sin(th), c = Math.cos(th);
      y += A * s;
      nx -= a.x * a.z * A * c;
      nz -= a.y * a.z * A * c;
      ny -= b.z * a.z * A * s;
    }
    const l = Math.hypot(nx, ny, nz) || 1;
    out.y = y; out.nx = nx / l; out.ny = ny / l; out.nz = nz / l;
    return out;
  }

  /**
   * Moving ships push the interactive surface at their bows every frame (wakes). Call once per frame with
   * the visible ships (map coordinates, heading in radians, speed 0..1, size ~ hull length).
   */
  driveShips(ships: readonly { x: number; y: number; heading: number; speed: number; size: number }[]) {
    const sim = this.ripples3;
    if (!sim) return;
    for (const sh of ships) {
      if (sh.speed <= 0.02) continue;
      const r = sh.size * 0.45;
      sim.drop(sh.x + Math.cos(sh.heading) * r, sh.y + Math.sin(sh.heading) * r, -0.02 * sh.speed, 0.16 + 0.12 * sh.size);
    }
  }

  /** Step the interactive ripples around the camera (once per rendered frame). Returns its draw calls. */
  simulate(renderer: THREE.WebGLRenderer, cx: number, cz: number, dt: number): number {
    const sim = this.ripples3;
    if (!sim || !this.mesh.visible) return 0;
    sim.update(renderer, cx, cz, dt);
    const u = this.material.uniforms;
    u.tRipple.value = sim.texture;
    u.uRippleXf.value.set(sim.origin.x, sim.origin.y, 1 / sim.size, sim.active ? 1 : 0);
    return sim.calls;
  }

  /** Shader warm-up for the ripple simulation program. */
  warmUp(renderer: THREE.WebGLRenderer) {
    if (this.ripples3) {
      this.ripples3.warmUp(renderer);
      this.material.uniforms.tRipple.value = this.ripples3.texture;
    }
  }

  /**
   * Per-frame light: sun (or moon at night) direction / colour / intensity, sky and haze colours, and the
   * weather (wind chop, rain ripples, storm whitecaps).
   */
  setLighting(sunDir: THREE.Vector3, sunColor: THREE.Color, sunIntensity: number, sky: THREE.Color, haze: THREE.Color, night: number, wx?: Weather) {
    const u = this.material.uniforms;
    u.uSunDir.value.copy(sunDir);
    u.uSunColor.value.copy(sunColor).multiplyScalar(sunIntensity * (0.45 + 0.25 * (1 - night)));
    // the sky seen in the water: hemisphere sky colour warmed towards the haze (sunset glow at dusk)
    u.uSky.value.copy(sky).multiplyScalar(0.6 + 0.25 * (1 - night)).lerp(haze, 0.35);
    u.uHorizon.value.copy(haze).multiplyScalar(0.75);
    u.uNight.value = night;
    if (wx) {
      u.uWind.value.copy(wx.wind);
      const wind = Math.hypot(wx.wind.x, wx.wind.y);
      u.uChop.value = Math.min(1, 0.15 + wind * 0.09 + wx.levels.storm * 0.4);
      // swell height follows the weather (eased: no sudden jumps)
      const target = 0.55 + 0.65 * u.uChop.value;
      this.waveAmp += (target - this.waveAmp) * 0.02;
      u.uWaveAmp.value = this.waveAmp;
      u.uRain.value = Math.max(wx.levels.rain, wx.levels.storm);
      u.uOvercast.value = wx.overcast;
    }
    const sun = this.sun;
    if (sun && sun.castShadow && sun.shadow.map) {
      u.tShadow.value = sun.shadow.map.depthTexture;
      u.uShadowMatrix.value.copy(sun.shadow.matrix);
      u.uShadowOn.value = 1;
    }
  }

  update(time: number) {
    this.time = time;
    this.material.uniforms.uTime.value = time;
  }

  /**
   * Disturb the surface: expanding rings at world (x, z) — splashes, shell impacts, wakes. `strength`
   * ~0.3 (a bow wave) .. 1 (a shell) .. 2 (a big explosion). Old rings are recycled (24 at a time).
   */
  addRipple(x: number, z: number, strength = 1) {
    const r = this.ripples[this.nextRipple];
    r.set(x, z, this.time, Math.min(2.5, strength));
    this.nextRipple = (this.nextRipple + 1) % MAX_RIPPLES;
    // the interactive surface gets a real disturbance (high)
    this.ripples3?.drop(x, z, 0.3 * Math.min(2.5, strength), 0.2 + 0.12 * Math.min(2.5, strength));
  }

  /** Is (x, z) over water (ground below the surface)? */
  isWater(x: number, z: number): boolean {
    const t = this.heightTex.image as unknown as { data: Float32Array; width: number; height: number };
    const i = Math.round(x * 2), j = Math.round(z * 2);
    if (i < 0 || j < 0 || i >= t.width || j >= t.height) return false;
    return t.data[j * t.width + i] < WATER_LEVEL - 0.02;
  }

  dispose() {
    if (Water.current === this) Water.current = null;
    this.copy?.dispose();
    this.heightTex.dispose();
    this.normalTex.dispose();
    this.seaTex.dispose();
    this.ripples3?.dispose();
    if (this.floes) { this.floes.geometry.dispose(); (this.floes.material as THREE.Material).dispose(); this.floes.dispose(); }
    this.material.dispose();
    this.mesh.geometry.dispose();
  }
}

/**
 * Open-sea factor per height texel: distance to the nearest dry texel (multi-source BFS, in cells) mapped to
 * 0..1, damped on small water bodies so lakes stay calm while seas roll.
 */
function buildSeaMask(h: Float32Array, w: number, hgt: number, res: number): Float32Array {
  const n = w * hgt;
  const wet = new Uint8Array(n);
  for (let i = 0; i < n; i++) wet[i] = h[i] < WATER_LEVEL - 0.02 ? 1 : 0;
  // connected water bodies and their areas (texels)
  const comp = new Int32Array(n).fill(-1);
  const area: number[] = [];
  const stack: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!wet[i] || comp[i] >= 0) continue;
    const id = area.length;
    let a = 0;
    comp[i] = id;
    stack.push(i);
    while (stack.length) {
      const k = stack.pop()!;
      a++;
      const x = k % w, y = (k / w) | 0;
      if (x > 0 && wet[k - 1] && comp[k - 1] < 0) { comp[k - 1] = id; stack.push(k - 1); }
      if (x < w - 1 && wet[k + 1] && comp[k + 1] < 0) { comp[k + 1] = id; stack.push(k + 1); }
      if (y > 0 && wet[k - w] && comp[k - w] < 0) { comp[k - w] = id; stack.push(k - w); }
      if (y < hgt - 1 && wet[k + w] && comp[k + w] < 0) { comp[k + w] = id; stack.push(k + w); }
    }
    area.push(a);
  }
  // distance to land (texels), 4-neighbour BFS from every dry texel
  const dist = new Float32Array(n).fill(1e9);
  const q = new Int32Array(n);
  let qh = 0, qt = 0;
  for (let i = 0; i < n; i++) if (!wet[i]) { dist[i] = 0; q[qt++] = i; }
  while (qh < qt) {
    const k = q[qh++];
    const x = k % w, y = (k / w) | 0, d = dist[k] + 1;
    if (x > 0 && dist[k - 1] > d) { dist[k - 1] = d; q[qt++] = k - 1; }
    if (x < w - 1 && dist[k + 1] > d) { dist[k + 1] = d; q[qt++] = k + 1; }
    if (y > 0 && dist[k - w] > d) { dist[k - w] = d; q[qt++] = k - w; }
    if (y < hgt - 1 && dist[k + w] > d) { dist[k + w] = d; q[qt++] = k + w; }
  }
  const out = new Float32Array(n);
  const sm = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  for (let i = 0; i < n; i++) {
    if (!wet[i]) continue;
    const cells = dist[i] / res;
    // bodies under ~150 cells are lakes: a gentle ripple at most
    const body = sm(150, 600, area[comp[i]] / (res * res));
    out[i] = sm(1.2, 7, cells) * (0.25 + 0.75 * body);
  }
  // soften the BFS diamond pattern
  const tmp = new Float32Array(n);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) {
      const k = y * w + x;
      let s = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= hgt) continue;
        s += out[yy * w + xx];
        c++;
      }
      tmp[k] = wet[k] ? s / c : 0;
    }
    out.set(tmp);
  }
  return out;
}
