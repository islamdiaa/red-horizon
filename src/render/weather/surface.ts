import * as THREE from 'three';

/**
 * Optional helper: make any MeshStandardMaterial (or Physical) react to `Weather.wetness` /
 * `Weather.snow` — darker, glossier albedo and puddles on flat ground when wet, snow settling on
 * upward-facing surfaces. Chains with an existing onBeforeCompile. Bind `weather.surfaceUniforms`.
 */
export interface WeatherSurfaceUniforms {
  uWxWet: { value: number };
  uWxSnow: { value: number };
}

/** GLSL: declarations for the fragment shader (needs world position + world normal varyings). */
export const WEATHER_SURFACE_DECL = /* glsl */ `
uniform float uWxWet;
uniform float uWxSnow;
float wx_vh(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float wx_vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(wx_vh(i), wx_vh(i + vec2(1.0, 0.0)), u.x), mix(wx_vh(i + vec2(0.0, 1.0)), wx_vh(i + vec2(1.0, 1.0)), u.x), u.y);
}
`;

/**
 * GLSL: apply wetness + snow. Expects `wxPos` (world position) and `wxNrm` (world normal) in scope and
 * modifies `diffuseColor.rgb` and `roughnessFactor` (insert after <roughnessmap_fragment>).
 */
export const WEATHER_SURFACE_APPLY = /* glsl */ `
{
  float wxUp = clamp(wxNrm.y, 0.0, 1.0);
  float wxN = wx_vnoise(wxPos.xz * 1.3) * 0.6 + wx_vnoise(wxPos.xz * 4.1) * 0.4;
  // snow settles on upward-facing surfaces first, patchy while it builds up
  float wxCover = smoothstep(0.45, 0.8, wxUp) * smoothstep(0.0, 0.12, uWxSnow * 1.25 - wxN * 0.9 - 0.15 - (1.0 - wxUp) * 0.5);
  // wet: darker and glossier; flat spots collect puddles
  float wxWet = uWxWet * (1.0 - wxCover);
  float wxPud = wxWet * smoothstep(0.6, 0.66, wx_vnoise(wxPos.xz * 0.45) * 0.72 + wxN * 0.28 + uWxWet * 0.1) * smoothstep(0.93, 0.99, wxUp);
  diffuseColor.rgb *= 1.0 - 0.4 * wxWet - 0.25 * wxPud;
  roughnessFactor = mix(roughnessFactor, min(roughnessFactor, 0.38), wxWet);
  roughnessFactor = mix(roughnessFactor, 0.05, wxPud);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.8, 0.84, 0.9), wxCover);
  roughnessFactor = mix(roughnessFactor, 0.72, wxCover);
}
`;

export function patchMaterialForWeather(mat: THREE.MeshStandardMaterial, uniforms: WeatherSurfaceUniforms): void {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey();
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWxPos;\nvarying vec3 vWxNrm;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec4 wxp = vec4(transformed, 1.0);
          vec3 wxn = objectNormal;
          #ifdef USE_INSTANCING
            wxp = instanceMatrix * wxp;
            wxn = mat3(instanceMatrix) * wxn;
          #endif
          vWxPos = (modelMatrix * wxp).xyz;
          vWxNrm = normalize(mat3(modelMatrix) * wxn);
        }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWxPos;\nvarying vec3 vWxNrm;\n${WEATHER_SURFACE_DECL}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        {
          vec3 wxPos = vWxPos;
          vec3 wxNrm = normalize(vWxNrm);
          ${WEATHER_SURFACE_APPLY}
        }`);
  };
  mat.customProgramCacheKey = () => `${prevKey}|wx-surface`;
  mat.needsUpdate = true;
}
