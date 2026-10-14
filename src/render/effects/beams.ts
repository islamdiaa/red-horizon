/**
 * Beam / ribbon segment batch (one draw call). Each instance is a camera-facing quad between two
 * points A and B. Like particles, segments are written once (ring buffer) and animated on the GPU:
 *
 *  mode RIBBON: trail segment; each end has its own spawn time, so a chain of segments forms a
 *               continuous ribbon that fades, widens and drifts from tail to head (smoke trails).
 *  mode TRACER: a streak that travels from A to B within its life (bullet tracers).
 *  mode BOLT:   a static segment with a short flickering life (lightning, flame cores).
 *
 * style 0 = glowing line (bright core + halo), style 1 = noisy smoke ribbon.
 */
import * as THREE from 'three';
import { RAMP_ROWS } from './textures';
import { premultipliedMaterialFlags } from './particles';

export const BM = { RIBBON: 0, TRACER: 1, BOLT: 2 } as const;
export const BS = { GLOW: 0, SMOKE: 1 } as const;

const STRIDE = 28;

export class BeamSpec {
  ax = 0; ay = 0; az = 0;
  bx = 0; by = 0; bz = 0;
  /** spawn time offsets (relative to now) of end A and end B */
  tA = 0; tB = 0;
  life = 1; mode = 0;
  w0 = 0.05; w1 = 0.05; rise = 0; wind = 0;
  r = 1; g = 1; b = 1; a = 1;
  ramp = 0; occ = 0; style = 0; extra = 0;
  uA = 0; uB = 0;
  /** Direction of the previous segment of the same ribbon (0 = none); makes joints seamless. */
  px = 0; py = 0; pz = 0;
  reset(): this {
    this.ax = this.ay = this.az = this.bx = this.by = this.bz = 0;
    this.tA = this.tB = 0;
    this.life = 1; this.mode = 0;
    this.w0 = this.w1 = 0.05; this.rise = 0; this.wind = 0;
    this.r = this.g = this.b = this.a = 1;
    this.ramp = 0; this.occ = 0; this.style = 0; this.extra = 0;
    this.uA = this.uB = 0;
    this.px = this.py = this.pz = 0;
    return this;
  }
  from(x: number, y: number, z: number): this { this.ax = x; this.ay = y; this.az = z; return this; }
  to(x: number, y: number, z: number): this { this.bx = x; this.by = y; this.bz = z; return this; }
  color(r: number, g: number, b: number, a = 1): this { this.r = r; this.g = g; this.b = b; this.a = a; return this; }
  width(w0: number, w1 = w0): this { this.w0 = w0; this.w1 = w1; return this; }
}

const VERT = /* glsl */ `
precision highp float;
uniform float uTime;
uniform vec3 uWind;
attribute vec3 aA;
attribute vec3 aB;
attribute vec4 aTime;
attribute vec4 aWidth;
attribute vec4 aColor;
attribute vec4 aParams;
attribute vec2 aUv;
attribute vec3 aPrev;
varying vec4 vColor;
varying vec2 vCoord;
varying vec2 vStyle;
const float RAMP_ROWS = ${RAMP_ROWS.toFixed(1)};
uniform sampler2D uRamp;

void collapse() { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vColor = vec4(0.0); }

void main() {
  float endSel = position.x;
  float mode = aTime.w;
  float life = aTime.z;
  vec3 A = aA;
  vec3 B = aB;
  float alpha = aColor.a;
  float t;
  float ageA = uTime - aTime.x;
  float ageB = uTime - aTime.y;
  if (mode < 0.5) {
    if (ageB < 0.0 || ageA >= life) { collapse(); return; }
    float cA = clamp(ageA, 0.0, life);
    float cB = clamp(ageB, 0.0, life);
    A += vec3(0.0, aWidth.z * cA, 0.0) + uWind * (aWidth.w * cA);
    B += vec3(0.0, aWidth.z * cB, 0.0) + uWind * (aWidth.w * cB);
    t = mix(cA, cB, endSel) / life;
    alpha *= 1.0 - smoothstep(0.35, 1.0, t);
  } else if (mode < 1.5) {
    if (ageA < 0.0 || ageA >= life) { collapse(); return; }
    float streak = aParams.w;
    float travel = life / (1.0 + streak);
    float h = ageA / travel;
    float head = clamp(h, 0.0, 1.0);
    float tail = clamp(h - streak, 0.0, 1.0);
    vec3 a0 = mix(aA, aB, tail);
    vec3 b0 = mix(aA, aB, head);
    A = a0; B = b0;
    t = ageA / life;
    alpha *= mix(0.35, 1.0, endSel);
  } else {
    if (ageA < 0.0 || ageA >= life) { collapse(); return; }
    t = ageA / life;
    alpha *= 1.0 - t * t;
  }
  vec3 E = mix(A, B, endSel);
  vec3 dir = B - A;
  // A end uses the previous segment's direction so both segments share the same edge at the joint
  if (endSel < 0.5 && dot(aPrev, aPrev) > 1e-10) dir = aPrev;
  vec3 toCam = cameraPosition - E;
  vec3 side = cross(dir, toCam);
  float sl = length(side);
  side = sl > 1e-7 ? side / sl : vec3(1.0, 0.0, 0.0);
  float w = mix(aWidth.x, aWidth.y, 1.0 - (1.0 - t) * (1.0 - t));
  E += side * (position.y * w);
  gl_Position = projectionMatrix * viewMatrix * vec4(E, 1.0);
  vec4 ramp = texture2D(uRamp, vec2((t * 63.0 + 0.5) / 64.0, (aParams.x + 0.5) / RAMP_ROWS));
  vColor = vec4(aColor.rgb * ramp.rgb, alpha);
  vCoord = vec2(mix(aUv.x, aUv.y, endSel), position.y * 2.0);
  vStyle = vec2(aParams.z, ramp.a * aParams.y);
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uNoise;
uniform float uTime;
varying vec4 vColor;
varying vec2 vCoord;
varying vec2 vStyle;
void main() {
  float x = abs(vCoord.y);
  float a;
  vec3 col = vColor.rgb;
  if (vStyle.x < 0.5) {
    a = exp(-x * x * 22.0) * 1.4 + 0.45 * exp(-x * x * 4.0) * (1.0 - x);
  } else {
    float n = texture2D(uNoise, vec2(vCoord.x * 0.45 - uTime * 0.03, vCoord.y * 0.35 + 0.5)).r;
    float n2 = texture2D(uNoise, vec2(vCoord.x * 1.3 + 0.3, vCoord.y * 0.6 + uTime * 0.05)).g;
    a = smoothstep(1.0, 0.15, x + (n2 - 0.5) * 0.5) * clamp(0.25 + 1.1 * n, 0.0, 1.0);
    col *= 0.82 + 0.25 * (1.0 - x);
  }
  float cov = a * vColor.a;
  if (cov < 0.002) discard;
  gl_FragColor = vec4(col * cov, min(cov, 1.0) * vStyle.y);
}
`;

export class BeamBatch {
  readonly mesh: THREE.Mesh;
  readonly capacity: number;
  private geo: THREE.InstancedBufferGeometry;
  private buf: THREE.InstancedInterleavedBuffer;
  private data: Float32Array;
  private head = 0;
  private highWater = 0;
  private dirtyMin = Infinity;
  private dirtyMax = -1;
  private wrapped = false;
  now = 0;
  readonly spec = new BeamSpec();

  constructor(capacity: number, uniforms: Record<string, THREE.IUniform>, renderOrder: number) {
    this.capacity = capacity;
    this.data = new Float32Array(capacity * STRIDE);
    for (let i = 0; i < capacity; i++) {
      this.data[i * STRIDE + 6] = -1e6;
      this.data[i * STRIDE + 7] = -1e6;
    }
    this.buf = new THREE.InstancedInterleavedBuffer(this.data, STRIDE, 1);
    this.buf.setUsage(THREE.DynamicDrawUsage);
    const g = new THREE.InstancedBufferGeometry();
    // x = end selector (0 = A, 1 = B), y = across (-0.5..0.5)
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, -0.5, 0, 1, -0.5, 0, 1, 0.5, 0, 0, 0.5, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const at = (name: string, size: number, off: number) => g.setAttribute(name, new THREE.InterleavedBufferAttribute(this.buf, size, off));
    at('aA', 3, 0);
    at('aB', 3, 3);
    at('aTime', 4, 6);
    at('aWidth', 4, 10);
    at('aColor', 4, 14);
    at('aParams', 4, 18);
    at('aUv', 2, 22);
    at('aPrev', 3, 24);
    g.instanceCount = 0;
    this.geo = g;
    const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide });
    premultipliedMaterialFlags(mat);
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.matrixAutoUpdate = false;
  }

  begin(): BeamSpec {
    return this.spec.reset();
  }

  emit(s: BeamSpec): void {
    const i = this.head;
    const d = this.data;
    const o = i * STRIDE;
    d[o] = s.ax; d[o + 1] = s.ay; d[o + 2] = s.az;
    d[o + 3] = s.bx; d[o + 4] = s.by; d[o + 5] = s.bz;
    d[o + 6] = this.now + s.tA; d[o + 7] = this.now + s.tB; d[o + 8] = s.life; d[o + 9] = s.mode;
    d[o + 10] = s.w0; d[o + 11] = s.w1; d[o + 12] = s.rise; d[o + 13] = s.wind;
    d[o + 14] = s.r; d[o + 15] = s.g; d[o + 16] = s.b; d[o + 17] = s.a;
    d[o + 18] = s.ramp; d[o + 19] = s.occ; d[o + 20] = s.style; d[o + 21] = s.extra;
    d[o + 22] = s.uA; d[o + 23] = s.uB;
    d[o + 24] = s.px; d[o + 25] = s.py; d[o + 26] = s.pz;
    if (i < this.dirtyMin) this.dirtyMin = i;
    if (i > this.dirtyMax) this.dirtyMax = i;
    this.head++;
    if (this.head > this.highWater) this.highWater = this.head;
    if (this.head >= this.capacity) {
      this.head = 0;
      this.wrapped = true;
    }
  }

  /** Mark new segments for upload. Safe to call several times per rendered frame. */
  flush(): void {
    if (this.dirtyMax >= 0) {
      if (this.wrapped) {
        this.buf.clearUpdateRanges();
        this.buf.addUpdateRange(0, this.capacity * STRIDE);
      } else {
        this.buf.addUpdateRange(this.dirtyMin * STRIDE, (this.dirtyMax - this.dirtyMin + 1) * STRIDE);
      }
      this.buf.needsUpdate = true;
      this.geo.instanceCount = this.highWater;
    }
    this.dirtyMin = Infinity;
    this.dirtyMax = -1;
    this.wrapped = false;
  }

  dispose(): void {
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.removeFromParent();
  }
}
