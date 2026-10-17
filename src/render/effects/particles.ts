/**
 * GPU particle batch: a single preallocated InstancedBufferGeometry rendered with one draw call.
 *
 * Particles are fire-and-forget: the CPU writes a particle once (ring-buffer allocation) and the
 * vertex shader evaluates its whole life analytically from spawn time:
 *   p(t) = p0 + v0 * (1 - e^(-drag t)) / drag + gravity-with-drag term + wind * windFactor * t
 * so per-frame CPU cost is only the upload of the particles spawned this frame.
 *
 * Blending is premultiplied alpha (ONE, ONE_MINUS_SRC_ALPHA). A colour ramp row supplies, over the
 * particle's normalised life, an HDR colour and an "occlusion" factor: occlusion 0 means purely
 * additive (fire, sparks), occlusion 1 means a normal alpha-blended (smoke). Fireball particles fade
 * from additive fire into occluding smoke within one particle.
 */
import * as THREE from 'three';
import { RAMP_ROWS } from './textures';
import { createSmokeLightUniforms, SMOKE_FRAG_DECL, SMOKE_VERT_DECL, smokeFragDyn, smokeFragSoft, smokeVertMain, type SmokeLightUniforms } from './smokelight';

/** Particle orientation modes. */
export const M = {
  /** Camera-facing quad (rotating). */
  BILLBOARD: 0,
  /** Camera-facing quad stretched along the current velocity (sparks, streaks). */
  STREAK: 1,
  /** Flat quad lying in the XZ plane (ground rings, shockwaves, markers). */
  FLAT: 2,
  /** Cylindrical billboard: vertical axis fixed, faces the camera horizontally (light columns). */
  CYLINDER: 3,
  /** Camera-facing, lit with the sun using the normal map of a lit atlas frame (smoke, dust, debris). */
  LIT: 4,
} as const;

const STRIDE = 28;

/** Reusable, chainable particle description (no allocations per spawn). */
export class ParticleSpec {
  px = 0; py = 0; pz = 0;
  vx = 0; vy = 0; vz = 0;
  life = 1; gravity = 0; drag = 0;
  size0 = 1; size1 = 1; sizePow = 1;
  rot = 0; rotVel = 0;
  r = 1; g = 1; b = 1; a = 1;
  frame = 0; ramp = 0; mode = 0; stretch = 0;
  fadeIn = 0.05; fadeOut = 0.6; wind = 0;
  /** Seconds after which motion freezes (debris landing). 0 = never. */
  tStop = 0;
  /** Push toward the camera as a fraction of size (reduces ground clipping). */
  push = 0.35;
  /** Start delay in seconds. */
  delay = 0;

  reset(): this {
    this.px = this.py = this.pz = 0;
    this.vx = this.vy = this.vz = 0;
    this.life = 1; this.gravity = 0; this.drag = 0;
    this.size0 = 1; this.size1 = 1; this.sizePow = 1;
    this.rot = 0; this.rotVel = 0;
    this.r = this.g = this.b = this.a = 1;
    this.frame = 0; this.ramp = 0; this.mode = 0; this.stretch = 0;
    this.fadeIn = 0.05; this.fadeOut = 0.6; this.wind = 0;
    this.tStop = 0; this.push = 0.35; this.delay = 0;
    return this;
  }
  at(x: number, y: number, z: number): this { this.px = x; this.py = y; this.pz = z; return this; }
  vel(x: number, y: number, z: number): this { this.vx = x; this.vy = y; this.vz = z; return this; }
  /** life seconds, gravity (y acceleration, negative falls), linear drag coefficient */
  motion(life: number, gravity = 0, drag = 0): this { this.life = life; this.gravity = gravity; this.drag = drag; return this; }
  size(s0: number, s1 = s0, pow = 1): this { this.size0 = s0; this.size1 = s1; this.sizePow = pow; return this; }
  spin(rot: number, rotVel = 0): this { this.rot = rot; this.rotVel = rotVel; return this; }
  color(r: number, g: number, b: number, a = 1): this { this.r = r; this.g = g; this.b = b; this.a = a; return this; }
  look(frame: number, ramp: number, mode: number = M.BILLBOARD, stretch = 0): this { this.frame = frame; this.ramp = ramp; this.mode = mode; this.stretch = stretch; return this; }
  fade(fadeIn: number, fadeOut: number): this { this.fadeIn = fadeIn; this.fadeOut = fadeOut; return this; }
}

const VERT = /* glsl */ `
precision highp float;
uniform float uTime;
uniform vec3 uWind;
uniform vec3 uSunDir;
attribute vec3 aPos;
attribute vec3 aVel;
attribute vec4 aLife;
attribute vec4 aSize;
attribute vec4 aColor;
attribute vec4 aParams;
attribute vec4 aExtra;
attribute vec2 aExtra2;
varying vec2 vUv;
varying vec4 vTint;
varying vec2 vRampUv;
varying vec3 vRot;
varying vec3 vSunV;
const float ATLAS = 4.0;
const float RAMP_ROWS = ${RAMP_ROWS.toFixed(1)};
${SMOKE_VERT_DECL}

void main() {
  float age = uTime - aLife.x;
  if (age < 0.0 || age >= aLife.y) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vTint = vec4(0.0);
    return;
  }
  float t = age / aLife.y;
  float ta = aExtra2.x > 0.0 ? min(age, aExtra2.x) : age;
  float d = aLife.w;
  float fd;
  float gt;
  float e = 1.0;
  if (d > 1e-4) { e = exp(-d * ta); fd = (1.0 - e) / d; gt = (ta - fd) / d; }
  else { fd = ta; gt = 0.5 * ta * ta; }
  vec3 p = aPos + aVel * fd + vec3(0.0, aLife.z * gt, 0.0) + uWind * (aExtra.z * age);
  float sz = mix(aSize.x, aSize.y, 1.0 - pow(1.0 - t, aExtra.w));
  float rot = aSize.z + aSize.w * ta;
  float c = cos(rot);
  float s = sin(rot);
  vec2 corner = position.xy;
  int mode = int(aParams.z + 0.5);
  vec4 mv;
  if (mode == 2) {
    vec2 rc = vec2(c * corner.x - s * corner.y, s * corner.x + c * corner.y) * sz;
    mv = viewMatrix * vec4(p + vec3(rc.x, 0.0, rc.y), 1.0);
    // pull toward the camera along the view ray (same screen position, nearer depth) so ground
    // rings are not cut by undulating terrain
    float l = length(mv.xyz);
    float dp = min(0.25 + 0.05 * sz + aExtra2.y, l * 0.3);
    mv.xyz *= (l - dp) / max(l, 1e-3);
  } else if (mode == 3) {
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    right = normalize(vec3(right.x, 0.0, right.z) + vec3(1e-5, 0.0, 0.0));
    mv = viewMatrix * vec4(p + right * (corner.x * sz) + vec3(0.0, corner.y * sz * max(aParams.w, 1.0), 0.0), 1.0);
  } else {
    mv = viewMatrix * vec4(p, 1.0);
    float dist = -mv.z;
    float push = min(aExtra2.y * sz, dist * 0.5);
    mv.z += push;
    float k = (dist - push) / max(dist, 1e-3);
    if (mode == 1) {
      vec3 vel;
      if (d > 1e-4) vel = aVel * e + vec3(0.0, aLife.z * (1.0 - e) / d, 0.0);
      else vel = aVel + vec3(0.0, aLife.z * ta, 0.0);
      if (aExtra2.x > 0.0 && age >= aExtra2.x) vel = vec3(0.0);
      vel += uWind * aExtra.z;
      vec2 vv = (viewMatrix * vec4(vel, 0.0)).xy;
      float vl = length(vv);
      vec2 ax = vl > 1e-4 ? vv / vl : vec2(c, s);
      vec2 pr = vec2(-ax.y, ax.x);
      float len = sz + vl * aParams.w;
      mv.xy += (ax * (corner.x * len) + pr * (corner.y * sz)) * k;
    } else {
      vec2 rc = vec2(c * corner.x - s * corner.y, s * corner.x + c * corner.y) * sz;
      mv.xy += rc * k;
    }
  }
  gl_Position = projectionMatrix * mv;
${smokeVertMain('p', 'mv', 'sz', 'mode == 4', 'mode == 2 || mode == 3')}
  float fi = aExtra.x > 0.0 ? smoothstep(0.0, aExtra.x, t) : 1.0;
  float fo = 1.0 - smoothstep(aExtra.y, 1.0, t);
  vTint = vec4(aColor.rgb, aColor.a * fi * fo);
  float f = aParams.x;
  vec2 cell = vec2(mod(f, ATLAS), floor(f / ATLAS + 0.001));
  vUv = (cell + 0.5 + corner * 0.996) / ATLAS;
  vRampUv = vec2((t * 63.0 + 0.5) / 64.0, (aParams.y + 0.5) / RAMP_ROWS);
  vRot = vec3(c, s, mode == 4 ? 1.0 : 0.0);
  vSunV = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uAtlas;
uniform sampler2D uRamp;
uniform vec3 uLightCol;
uniform vec3 uShadowCol;
varying vec2 vUv;
varying vec4 vTint;
varying vec2 vRampUv;
varying vec3 vRot;
varying vec3 vSunV;
${SMOKE_FRAG_DECL}
void main() {
  vec4 tex = texture2D(uAtlas, vUv);
  float cov = tex.a * vTint.a;
${smokeFragSoft('cov')}
  if (cov < 0.002) discard;
  vec4 ramp = texture2D(uRamp, vRampUv);
  vec3 base = tex.rgb;
  if (vRot.z > 0.5) {
    vec2 n2 = tex.rg * 2.0 - 1.0;
    n2 = vec2(vRot.x * n2.x - vRot.y * n2.y, vRot.y * n2.x + vRot.x * n2.y);
    vec3 n = normalize(vec3(n2, 0.8));
    float ndl = dot(n, vSunV);
    float w = clamp(ndl * 0.65 + 0.35, 0.0, 1.0);
    vec3 lit = mix(uShadowCol, uLightCol, w) * tex.b;
${smokeFragDyn('lit', 'n', 'tex.b')}
    // self-luminous phase (fireballs): billow centres brighter than crevices
    float fire = tex.b * (0.25 + 1.0 * smoothstep(0.6, 1.0, n.z));
    // black-body-ish: hot centres shift to yellow, cooler crevices to deep red
    vec3 heat = vec3(fire, pow(fire, 1.7), pow(fire, 2.6)) * 1.1;
    base = mix(heat, lit, smoothstep(0.3, 0.85, ramp.a));
  }
  gl_FragColor = vec4(base * ramp.rgb * vTint.rgb * cov, min(cov * ramp.a, 1.0));
}
`;

export interface ParticleUniforms extends SmokeLightUniforms {
  uTime: { value: number };
  uWind: { value: THREE.Vector3 };
  uSunDir: { value: THREE.Vector3 };
  uLightCol: { value: THREE.Color };
  uShadowCol: { value: THREE.Color };
  uAtlas: { value: THREE.Texture };
  uRamp: { value: THREE.Texture };
}

export function createParticleUniforms(atlas: THREE.Texture, ramp: THREE.Texture): ParticleUniforms {
  return {
    uTime: { value: 0 },
    uWind: { value: new THREE.Vector3(0.35, 0, 0.05) },
    uSunDir: { value: new THREE.Vector3(-0.45, 0.8, 0.4).normalize() },
    uLightCol: { value: new THREE.Color(1.0, 0.94, 0.84) },
    uShadowCol: { value: new THREE.Color(0.42, 0.43, 0.48) },
    uAtlas: { value: atlas },
    uRamp: { value: ramp },
    ...createSmokeLightUniforms(),
  };
}

export function premultipliedMaterialFlags(m: THREE.Material): void {
  m.transparent = true;
  m.depthWrite = false;
  m.depthTest = true;
  m.blending = THREE.CustomBlending;
  m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.blendEquationAlpha = THREE.AddEquation;
  m.blendSrcAlpha = THREE.OneFactor;
  m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
}

export function quadGeometry(): { position: THREE.Float32BufferAttribute; index: number[] } {
  return {
    position: new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3),
    index: [0, 1, 2, 0, 2, 3],
  };
}

export class ParticleBatch {
  readonly mesh: THREE.Mesh;
  readonly capacity: number;
  private geo: THREE.InstancedBufferGeometry;
  private buf: THREE.InstancedInterleavedBuffer;
  private data: Float32Array;
  private head = 0;
  private highWater = 0;
  private rangeStart = -1;
  private rangeCount = 0;
  /** Current effect clock (seconds); spawn time = now + delay. */
  now = 0;
  /** Number of particles spawned since construction (stats). */
  spawned = 0;
  private spawnedThisFrame = 0;
  readonly spec = new ParticleSpec();

  /** `defines`: SOFT / DYNLIT particle lighting (smokelight.ts bindSmokeLight). */
  constructor(capacity: number, uniforms: ParticleUniforms, renderOrder: number, defines: Record<string, string> = {}) {
    this.capacity = capacity;
    this.data = new Float32Array(capacity * STRIDE);
    // all dead: spawn far in the past with zero life
    for (let i = 0; i < capacity; i++) this.data[i * STRIDE + 6] = -1e6;
    this.buf = new THREE.InstancedInterleavedBuffer(this.data, STRIDE, 1);
    this.buf.setUsage(THREE.DynamicDrawUsage);
    const g = new THREE.InstancedBufferGeometry();
    const q = quadGeometry();
    g.setAttribute('position', q.position);
    g.setIndex(q.index);
    const at = (name: string, size: number, off: number) => g.setAttribute(name, new THREE.InterleavedBufferAttribute(this.buf, size, off));
    at('aPos', 3, 0);
    at('aVel', 3, 3);
    at('aLife', 4, 6);
    at('aSize', 4, 10);
    at('aColor', 4, 14);
    at('aParams', 4, 18);
    at('aExtra', 4, 22);
    at('aExtra2', 2, 26);
    g.instanceCount = 0;
    this.geo = g;
    const mat = new THREE.ShaderMaterial({
      uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
      defines,
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.DoubleSide,
    });
    premultipliedMaterialFlags(mat);
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.matrixAutoUpdate = false;
  }

  /** Reset and return the shared spec. */
  begin(): ParticleSpec {
    return this.spec.reset();
  }

  emit(s: ParticleSpec): void {
    const i = this.head;
    if (this.rangeStart < 0) {
      this.rangeStart = i;
      this.rangeCount = 0;
    }
    this.rangeCount++;
    const d = this.data;
    const o = i * STRIDE;
    d[o] = s.px; d[o + 1] = s.py; d[o + 2] = s.pz;
    d[o + 3] = s.vx; d[o + 4] = s.vy; d[o + 5] = s.vz;
    d[o + 6] = this.now + s.delay; d[o + 7] = s.life; d[o + 8] = s.gravity; d[o + 9] = s.drag;
    d[o + 10] = s.size0; d[o + 11] = s.size1; d[o + 12] = s.rot; d[o + 13] = s.rotVel;
    d[o + 14] = s.r; d[o + 15] = s.g; d[o + 16] = s.b; d[o + 17] = s.a;
    d[o + 18] = s.frame; d[o + 19] = s.ramp; d[o + 20] = s.mode; d[o + 21] = s.stretch;
    d[o + 22] = s.fadeIn; d[o + 23] = s.fadeOut; d[o + 24] = s.wind; d[o + 25] = s.sizePow;
    d[o + 26] = s.tStop; d[o + 27] = s.push;
    this.head++;
    this.spawned++;
    this.spawnedThisFrame++;
    if (this.head > this.highWater) this.highWater = this.head;
    if (this.head >= this.capacity) {
      this.head = 0;
      this.closeRange();
    }
  }

  private closeRange(): void {
    if (this.rangeStart < 0) return;
    // note: ranges accumulate until three.js uploads them (update() may run several times per render)
    this.buf.addUpdateRange(this.rangeStart * STRIDE, this.rangeCount * STRIDE);
    this.rangeStart = -1;
    this.rangeCount = 0;
  }

  /** Mark this frame's new particles for upload. Safe to call several times per rendered frame. */
  flush(): void {
    this.closeRange();
    if (this.spawnedThisFrame >= this.capacity) {
      this.buf.clearUpdateRanges();
      this.buf.addUpdateRange(0, this.capacity * STRIDE);
    }
    if (this.spawnedThisFrame > 0) {
      this.buf.needsUpdate = true;
      this.geo.instanceCount = this.highWater;
    }
    this.spawnedThisFrame = 0;
  }

  /** Approximate number of live particles (scans lifetimes; debug/stats only). */
  countAlive(time: number): number {
    let n = 0;
    const d = this.data;
    for (let i = 0; i < this.highWater; i++) {
      const o = i * STRIDE;
      const age = time - d[o + 6];
      if (age >= 0 && age < d[o + 7]) n++;
    }
    return n;
  }

  dispose(): void {
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.removeFromParent();
  }
}
