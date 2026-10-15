import * as THREE from 'three';
import { GameMap, WATER_LEVEL } from '../sim/map';
import { hash2 } from '../core/rng';
import { getDummyShadowTexture, getNoiseTexture, TNOISE_GLSL } from './terrain';
import type { Weather } from './weather';

/**
 * World Y of every water surface. Identical to the simulation's WATER_LEVEL (-0.32). The surface mesh is
 * perfectly flat (the waves are in the shading only), so ships placed at this height float exactly on it.
 */
export const WATER_SURFACE_Y = WATER_LEVEL;

const MAX_RIPPLES = 24;

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
 * Water: an opaque, flat surface at WATER_SURFACE_Y drawn last among the opaque objects. Right before it
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

    this.hasWater = maxX >= minX;
    if (!this.hasWater) { minX = 0; maxX = 1; minY = 0; maxY = 1; }
    minX = Math.max(0, minX - 1); minY = Math.max(0, minY - 1);
    maxX = Math.min(map.w, maxX + 1); maxY = Math.min(map.h, maxY + 1);
    const geo = new THREE.PlaneGeometry(maxX - minX, maxY - minY, 1, 1);
    geo.rotateX(-Math.PI / 2);
    geo.translate((minX + maxX) / 2, WATER_LEVEL, (minY + maxY) / 2);

    for (let i = 0; i < MAX_RIPPLES; i++) this.ripples.push(new THREE.Vector4(0, 0, -100, 0));

    const refract = quality !== 'low' && !frozen;
    const defines: Record<string, string> = {};
    if (refract) defines.REFRACT = '';
    if (refract && quality === 'high') defines.SSR = '';
    if (quality !== 'low') defines.SHADOWS = '';
    if (frozen) defines.ICE = '';
    if (quality === 'low') defines.LOW = '';
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
      },
      vertexShader: /* glsl */ `
        varying vec3 vWPos;
        varying vec3 vVPos;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
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
            // frozen lake: pale blue ice with cracks, snow drifts and a glossy glint
            if (depthV < -0.02) discard;
            float d = clamp(depthV / 0.5, 0.0, 1.0);
            float cr = abs(tn_noise(p * 2.2) - 0.5);
            float crack = smoothstep(0.03, 0.0, cr) * 0.6 + smoothstep(0.02, 0.0, abs(tn_noise(p * 5.0 + 3.0) - 0.5)) * 0.3;
            vec3 ice = mix(vec3(0.42, 0.58, 0.68), vec3(0.72, 0.82, 0.88), smoothstep(0.0, 0.6, d) * 0.4 + tn_fbm(p * 0.8) * 0.6);
            ice = mix(ice, vec3(0.92, 0.95, 0.98), smoothstep(0.55, 0.8, tn_fbm(p * 1.4 + 7.0)));
            ice *= 1.0 - crack * 0.45;
            vec3 H = normalize(uSunDir + V);
            float dif = max(uSunDir.y, 0.0);
            vec3 col = ice * (0.45 + 0.55 * dif) * (0.35 + 0.65 * uSunColor) + uSunColor * pow(max(dot(vec3(0.0, 1.0, 0.0), H), 0.0), 120.0) * 1.5;
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
            slope += ripples(p) * 0.35;
            if (uRain > 0.01) slope += rainRipples(p) * 0.22 * uRain;
          #endif
          vec3 N = normalize(vec3(-slope.x, 1.0, -slope.y));

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
            float gap = max(uWaterLevel - behindW.y, 0.0);
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

          // ---- foam: waves lapping up the beach (bands travelling shorewards), the waterline, whitecaps
          float shoreD = max(depthV, 0.0);
          float bandPhase = shoreD * 55.0 - uTime * 1.6 + tn_noise(p * 1.1) * 6.0;
          float band = smoothstep(0.8, 0.99, sin(bandPhase) * 0.5 + 0.5) * smoothstep(0.26, 0.03, shoreD) * smoothstep(0.35, 0.65, tn_noise(p * 0.9 + vec2(0.0, uTime * 0.1)));
          float breakup = smoothstep(0.35, 0.8, tn_fbm(p * 3.1 + vec2(uTime * 0.12, -uTime * 0.09)));
          // whitecaps: small streaks on the sharpest crests of the finer wave layer, only in strong wind
          float crest = texture2D(tNormal, p * 0.29 * mat2(0.8, -0.6, 0.6, 0.8) - wdir.yx * uTime * 0.05).b;
          float streak = smoothstep(0.55, 0.85, tn_noise(p * vec2(6.0, 1.5) + wdir * uTime * 0.4));
          float whitecap = smoothstep(0.9, 0.99, crest) * smoothstep(0.55, 1.0, uChop) * streak * 0.6;
          float lace = smoothstep(0.25, 0.7, tn_noise(p * 9.0 + vec2(uTime * 0.2, 0.0)) * 0.6 + breakup * 0.6);
          float foam = clamp(foamMask * (0.25 + 0.6 * lace) + band * lace * 0.45 + whitecap * 0.7, 0.0, 0.92);
          vec3 foamCol = vec3(0.82, 0.86, 0.88) * mix(light, vec3(dot(light, vec3(0.33))), 0.5) * 0.9;
          col = mix(col, foamCol, foam);

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
    this.material.dispose();
    this.mesh.geometry.dispose();
  }
}
