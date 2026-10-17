/**
 * Particle lighting shared by the CPU particle batches (particles.ts) and the GPU particles (gpuparticles.ts):
 *
 *  - Soft particles (SOFT): smoke, dust and flames fade out where they meet the ground, a wall or a unit
 *    instead of cutting a hard line through it. The renderer copies the scene's linear depth once the opaque
 *    geometry is drawn (renderer.ts, SoftDepthCopy) and the particles compare it with their own depth.
 *  - Fire light (DYNLIT): every lit puff (smoke, dust, debris) gathers the dynamic lights of its screen tile
 *    (render/dynlights.ts) at its centre, in the vertex shader. The side of the puff that faces a fire glows warm
 *    and flickers with it; a share of the light shines through (thin smoke scatters it). Explosions flash the
 *    smoke around them, tesla bolts light it blue.
 *  - Sun and sky (always): the lit / shadowed colours follow the scene's sun and sky light (time of day,
 *    overcast, lightning) instead of a fixed daylight, so smoke darkens at dusk and goes moonlit at night.
 *
 * The renderer offers the depth copy and the light textures through scene.userData (softParticles,
 * dynamicLights); preview pages without them get the plain shaders. Low quality uses neither.
 */
import * as THREE from 'three';
import { DYN_TILES_X, DYN_TILES_Y, type DynamicLights } from '../dynlights';

/** What the renderer shares for soft particles (scene.userData.softParticles). */
export interface SoftDepthSource {
  /** Linear view depth of the opaque scene (R channel, world units), at the scene's render resolution. */
  readonly texture: THREE.Texture;
  /** 1 / render size in pixels (gl_FragCoord to uv). */
  readonly invRes: THREE.Vector2;
}

/** Scene light the particles are lit with, relative to the daylight they were authored for (per channel). */
export interface ParticleSkyLight {
  /** Sun (or moon) irradiance / the day preset's sun. */
  readonly sunK: THREE.Color;
  /** Sky (hemisphere) irradiance / the day preset's sky. */
  readonly skyK: THREE.Color;
}

export interface SmokeLightUniforms {
  tSoftDepth: { value: THREE.Texture | null };
  uSoftInvRes: { value: THREE.Vector2 };
  tDynLights: { value: THREE.Texture | null };
  tDynTiles: { value: THREE.Texture | null };
  /** Scale from dynamic-light irradiance to particle radiance. */
  uDynK: { value: number };
}

/** Authored daylight colours of the lit particles (lit side, shadowed side). */
export const DAY_LIGHT = new THREE.Color(1.0, 0.94, 0.84);
export const DAY_SHADOW = new THREE.Color(0.42, 0.43, 0.48);
/** Dynamic-light irradiance to particle radiance (the smoke's ramp colour is its albedo). */
const DYN_K = 0.22;

export function createSmokeLightUniforms(): SmokeLightUniforms {
  return {
    tSoftDepth: { value: null },
    uSoftInvRes: { value: new THREE.Vector2(1, 1) },
    tDynLights: { value: null },
    tDynTiles: { value: null },
    uDynK: { value: DYN_K },
  };
}

/**
 * Which particle lighting features a quality preset gets (pure; tests). Low keeps the lightweight shaders:
 * no depth fade, no fire light on smoke.
 */
export function particleLighting(quality: 'low' | 'medium' | 'high', hasSoftDepth: boolean, hasDynLights: boolean): { soft: boolean; dyn: boolean } {
  const on = quality !== 'low';
  return { soft: on && hasSoftDepth, dyn: on && hasDynLights };
}

/**
 * Wire the uniforms to the renderer's depth copy / dynamic lights and return the shader defines.
 * `features` comes from particleLighting().
 */
export function bindSmokeLight(u: SmokeLightUniforms, features: { soft: boolean; dyn: boolean }, soft: SoftDepthSource | null, dyn: DynamicLights | null): Record<string, string> {
  const defines: Record<string, string> = {};
  if (features.soft && soft) {
    u.tSoftDepth.value = soft.texture;
    u.uSoftInvRes.value = soft.invRes;
    defines.SOFT = '';
  }
  if (features.dyn && dyn) {
    u.tDynLights.value = dyn.lightTex;
    u.tDynTiles.value = dyn.tileTex;
    defines.DYNLIT = '';
    defines.DYN_TEXELS = String(dyn.defines.DYN_TEXELS);
  }
  return defines;
}

/**
 * The lit / shadowed particle colours for the current scene light (pure; tests): the authored daylight
 * colours scaled per channel by the sun and sky relative to the day preset. At noon on a clear day this is
 * exactly the authored look.
 */
export function particleLightColors(sky: ParticleSkyLight, outLight: THREE.Color, outShadow: THREE.Color): void {
  const s = sky.sunK, k = sky.skyK;
  outShadow.setRGB(DAY_SHADOW.r * k.r, DAY_SHADOW.g * k.g, DAY_SHADOW.b * k.b);
  outLight.setRGB(
    (DAY_LIGHT.r - DAY_SHADOW.r) * s.r + outShadow.r,
    (DAY_LIGHT.g - DAY_SHADOW.g) * s.g + outShadow.g,
    (DAY_LIGHT.b - DAY_SHADOW.b) * s.b + outShadow.b,
  );
}

/** Vertex-shader declarations (after the other uniforms / varyings). */
export const SMOKE_VERT_DECL = /* glsl */ `
#ifdef SOFT
varying float vViewZ;
varying float vSoftK;
#endif
#ifdef DYNLIT
uniform highp sampler2D tDynLights;
uniform sampler2D tDynTiles;
uniform float uDynK;
varying vec3 vDynCol;
varying vec3 vDynDir;
// dynamic lights reaching world point P (its screen tile from the clip position); dirW = light-weighted
// direction towards them (world space)
vec3 fxDynLight(vec3 P, vec4 clip, out vec3 dirW) {
  dirW = vec3(0.0);
  vec3 sum = vec3(0.0);
  if (clip.w <= 0.0) return sum;
  vec2 suv = clip.xy / clip.w * 0.5 + 0.5;
  if (suv.x < 0.0 || suv.y < 0.0 || suv.x > 1.0 || suv.y > 1.0) return sum;
  ivec2 t = ivec2(clamp(suv * vec2(${DYN_TILES_X}.0, ${DYN_TILES_Y}.0), vec2(0.0), vec2(${DYN_TILES_X - 1}.0, ${DYN_TILES_Y - 1}.0)));
  for (int k = 0; k < DYN_TEXELS; k++) {
    vec4 ids = texelFetch(tDynTiles, ivec2(t.x * DYN_TEXELS + k, t.y), 0);
    for (int c = 0; c < 4; c++) {
      int id = int(ids[c] * 255.0 + 0.5) - 1;
      if (id < 0) return sum;
      vec4 col = texelFetch(tDynLights, ivec2(id, 1), 0);
      if (col.w > 0.5) continue; // spot lights (headlights, floodlights) only light surfaces
      vec4 pr = texelFetch(tDynLights, ivec2(id, 0), 0);
      vec3 L = pr.xyz - P;
      float d2 = dot(L, L);
      if (d2 >= pr.w * pr.w) continue;
      float d = sqrt(d2);
      float w = clamp(1.0 - pow(d / pr.w, 4.0), 0.0, 1.0);
      // the same windowed inverse-square falloff as the surfaces (dynlights.ts), softened inside the puff
      vec3 e = col.rgb * (w * w / max(d2, 0.8));
      sum += e;
      dirW += L / max(d, 1e-3) * dot(e, vec3(0.3, 0.5, 0.2));
    }
  }
  return sum;
}
#endif
`;

/**
 * Vertex-shader body (after gl_Position): `P` world position of the particle centre, `MV` its view-space
 * corner position, `SZ` its size, `LIT` true for lit (normal-mapped) particles, `HARD` true for particles
 * that lie on the ground on purpose (shock rings, markers: no depth fade).
 */
export function smokeVertMain(P: string, MV: string, SZ: string, LIT: string, HARD = 'false'): string {
  return /* glsl */ `
#ifdef SOFT
  vViewZ = -${MV}.z;
  // fade over a depth range that grows with the puff: big smoke balls melt into the ground softly, small hard
  // bits (debris, sparks) keep their edges
  vSoftK = (${HARD}) ? 1e4 : 1.0 / (0.02 + max(0.42 * ${SZ} - 0.05, 0.0));
#endif
#ifdef DYNLIT
  vDynCol = vec3(0.0);
  vDynDir = vec3(0.0, 0.0, 1.0);
  if (${LIT}) {
    vec3 dw;
    // (capped: a puff right on top of a big flash glows, it does not turn into a light bulb)
    vDynCol = min(fxDynLight(${P}, projectionMatrix * viewMatrix * vec4(${P}, 1.0), dw) * uDynK, vec3(2.5));
    vDynDir = normalize((viewMatrix * vec4(dw, 0.0)).xyz + vec3(0.0, 0.0, 1e-4));
  }
#endif
`;
}

/** Fragment-shader declarations. */
export const SMOKE_FRAG_DECL = /* glsl */ `
#ifdef SOFT
uniform sampler2D tSoftDepth;
uniform vec2 uSoftInvRes;
varying float vViewZ;
varying float vSoftK;
#endif
#ifdef DYNLIT
varying vec3 vDynCol;
varying vec3 vDynDir;
#endif
`;

/** Fragment: scale the coverage `COV` by the soft depth fade. */
export function smokeFragSoft(COV: string): string {
  return /* glsl */ `
#ifdef SOFT
  ${COV} *= clamp((texture2D(tSoftDepth, gl_FragCoord.xy * uSoftInvRes).r - vViewZ) * vSoftK, 0.0, 1.0);
#endif
`;
}

/**
 * Fragment, inside the lit branch: add the fire light to `LIT` (radiance before the ramp colour) for the view-space
 * puff normal `N` and density `B` (atlas blue channel).
 */
export function smokeFragDyn(LIT: string, N: string, B: string): string {
  return /* glsl */ `
#ifdef DYNLIT
  {
    float wd = clamp(dot(${N}, vDynDir) * 0.5 + 0.5, 0.0, 1.0);
    // the side facing the fire glows; a part of the light scatters through the thin puff
    ${LIT} += vDynCol * (0.25 + 0.75 * wd * wd) * ${B};
  }
#endif
`;
}
