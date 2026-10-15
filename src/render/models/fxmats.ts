/**
 * Animated shared FX materials for models (cloak shimmer, gap-generator emitter haze).
 *
 * The builder only knows static fx slots, so templates declare an 'fx:add:...' placeholder and swap
 * in one of these shared materials from their `init` hook. All instances share the material and its
 * uniforms; anim callbacks write the global time (cheap, idempotent). Nothing is created per instance.
 */
import * as THREE from 'three';

const shared = { uTime: { value: 0 } };

/** Advance the shared FX clock (call from any anim callback; repeated calls per frame are harmless). */
export function fxTime(t: number): void {
  shared.uTime.value = t;
}

const VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vP = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

/** Cloak shimmer: refractive-looking bands crawling over a fresnel shell (additive, faint). */
const CLOAK_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  float ndv = abs(dot(normalize(vN), normalize(vV)));
  float fres = pow(1.0 - ndv, 2.0);
  float n = n2(vP.xz * 9.0 + vec2(uTime * 0.7, -uTime * 0.5)) * n2(vP.xy * 7.0 - vec2(uTime * 0.4, uTime * 0.9));
  float bands = 0.5 + 0.5 * sin(vP.y * 60.0 - uTime * 7.0 + n * 8.0);
  float a = (0.015 + fres * 0.55) * (0.25 + 0.95 * n) * (0.5 + 0.5 * bands);
  gl_FragColor = vec4(uColor * a, 1.0);
}
`;

/** Gap emitter haze: dark smoky swirl with a violet rim (premultiplied: darkens what is behind). */
const GAP_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  float ndv = abs(dot(normalize(vN), normalize(vV)));
  float fres = pow(1.0 - ndv, 1.6);
  float ang = atan(vP.z, vP.x);
  float n = n2(vec2(ang * 3.0 + uTime * 1.5, vP.y * 6.0 - uTime * 2.0));
  float a = clamp(0.25 + 0.55 * n, 0.0, 1.0) * (0.45 + 0.55 * fres);
  vec3 rim = uColor * fres * (0.6 + 0.8 * n);
  gl_FragColor = vec4(rim * a, a * 0.7);
}
`;

let cloakMat: THREE.ShaderMaterial | null = null;
let gapMat: THREE.ShaderMaterial | null = null;

export function cloakMaterial(): THREE.ShaderMaterial {
  if (cloakMat) return cloakMat;
  cloakMat = new THREE.ShaderMaterial({
    uniforms: { uTime: shared.uTime, uColor: { value: new THREE.Color(0.4, 0.7, 0.9) } },
    vertexShader: VERT,
    fragmentShader: CLOAK_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  cloakMat.name = 'fx-cloak';
  return cloakMat;
}

export function gapHazeMaterial(): THREE.ShaderMaterial {
  if (gapMat) return gapMat;
  gapMat = new THREE.ShaderMaterial({
    uniforms: { uTime: shared.uTime, uColor: { value: new THREE.Color(1.4, 0.5, 2.6) } },
    vertexShader: VERT,
    fragmentShader: GAP_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  gapMat.name = 'fx-gaphaze';
  return gapMat;
}
