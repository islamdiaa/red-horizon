/**
 * Gap-generator shroud domes (owner's view): a soft, dark, slowly churning hemisphere with a violet
 * shimmering rim over every active gap source (Gap Generator structure, deployed Mobile Gap
 * Generator). One instanced draw call.
 *
 *   const gap = new GapField({ getHeight: (x, z) => map.surfaceAt(x, z) });
 *   scene.add(gap.mesh);
 *   gap.update(sources, time);   // sources: { x, y, radius, strength? }[] in map coords / cells
 */
import * as THREE from 'three';

export interface GapSource {
  /** map x (world X) */
  x: number;
  /** map y (world Z) */
  y: number;
  /** shroud radius in cells */
  radius: number;
  /** 0..1 fade (e.g. power / deploy state); default 1 */
  strength?: number;
}

const VERT = /* glsl */ `
attribute vec2 aParams; // strength, seed
varying vec3 vN;
varying vec3 vV;
varying vec3 vL;
varying vec2 vParams;
void main() {
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vL = position;
  vN = mat3(modelMatrix) * mat3(instanceMatrix) * normal; // normalised per fragment (zero-scale instances)
  vV = normalize(cameraPosition - wp.xyz);
  vParams = aParams;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uRim;
uniform vec3 uCore;
varying vec3 vN;
varying vec3 vV;
varying vec3 vL;
varying vec2 vParams;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  float k = vParams.x;
  if (k < 0.003) discard;
  float t = uTime + vParams.y * 13.0;
  // guarded: normalize(0), pow(<0) and atan(0, 0) are NaN / undefined on real GPUs
  float ndv = abs(dot(vN * inversesqrt(max(dot(vN, vN), 1e-12)), normalize(vV)));
  float fres = pow(max(1.0 - ndv, 0.0), 2.2);
  float ang = atan(vL.z, vL.x + 1e-6);
  // churning smoke over the shell
  float n = n2(vec2(ang * 4.0 + t * 0.25, vL.y * 5.0 - t * 0.4)) * 0.6 + n2(vec2(ang * 11.0 - t * 0.5, vL.y * 13.0 + t * 0.3)) * 0.4;
  // bands of interference climbing the dome
  float bands = 0.5 + 0.5 * sin(vL.y * 26.0 - t * 2.4 + n * 5.0);
  // stronger near the ground line
  float base = smoothstep(0.35, 0.0, vL.y);
  float dark = (0.11 + 0.22 * n) * (0.5 + 0.5 * fres) + base * 0.1;
  vec3 rim = uRim * (fres * (0.3 + 0.8 * n) * (0.55 + 0.45 * bands) + base * 0.22 * (0.5 + n));
  float a = clamp(dark * k, 0.0, 0.85);
  gl_FragColor = vec4(uCore * a + rim * k, a);
}
`;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

export class GapField {
  readonly mesh: THREE.InstancedMesh;
  private params: THREE.InstancedBufferAttribute;
  private mat: THREE.ShaderMaterial;
  private readonly max: number;

  constructor(private opts: { getHeight: (x: number, z: number) => number; max?: number }) {
    this.max = opts.max ?? 32;
    const geo = new THREE.SphereGeometry(1, 40, 14, 0, Math.PI * 2, 0, Math.PI / 2);
    this.params = new THREE.InstancedBufferAttribute(new Float32Array(this.max * 2), 2);
    this.params.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aParams', this.params);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uRim: { value: new THREE.Color(0.27, 0.11, 0.58) },
        uCore: { value: new THREE.Color(0.02, 0.0, 0.05) },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, this.max);
    this.mesh.name = 'gap-field';
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }

  update(sources: readonly GapSource[], time: number): void {
    this.mat.uniforms.uTime.value = time;
    const n = Math.min(sources.length, this.max);
    const P = this.params.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const s = sources[i];
      const r = Math.max(0.3, s.radius);
      const k = Math.min(1, Math.max(0, s.strength ?? 1));
      // breathe slightly so the edge never looks static
      const br = 1 + 0.015 * Math.sin(time * 1.3 + i * 2.1);
      // big fields (structure: 10 cells) stay a low dome instead of a 5-cell-high bubble
      const h = Math.min(r * 0.5, 2.2);
      _m.compose(_p.set(s.x, this.opts.getHeight(s.x, s.y) - 0.05, s.y), _q, _s.set(r * br, h * br, r * br));
      this.mesh.setMatrixAt(i, _m);
      P[i * 2] = k;
      P[i * 2 + 1] = (s.x * 0.37 + s.y * 0.71) % 1;
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (n > 0) {
      this.mesh.instanceMatrix.clearUpdateRanges();
      this.mesh.instanceMatrix.addUpdateRange(0, n * 16);
      this.mesh.instanceMatrix.needsUpdate = true;
      this.params.clearUpdateRanges();
      this.params.addUpdateRange(0, n * 2);
      this.params.needsUpdate = true;
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.mesh.dispose();
    this.mesh.removeFromParent();
  }
}
