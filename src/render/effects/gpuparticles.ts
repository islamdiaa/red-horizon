/**
 * GPU-simulated particles (WebGL2 render-to-texture ping-pong, MRT), 8k..64k live particles in one draw.
 *
 * State lives in three float textures per buffer (W x H texels, one particle per texel):
 *   T0 = position.xyz, age (s; negative while waiting for its start delay)
 *   T1 = velocity.xyz, life (s; 0 = dead slot)
 *   T2 = size0, size1, kind + 16 * ramp row, alpha
 * Every frame (only while something is alive):
 *   1. sim pass (full-screen quad into the other buffer, MRT): gravity, drag towards the wind, buoyancy,
 *      curl-like turbulence, collisions with the terrain height map / water surface (bounce + friction);
 *   2. spawn pass (GL points, one per new particle, into the same buffer): the CPU only writes particles
 *      it spawns this frame into a small staging buffer (ring allocation, oldest slots recycled);
 *   3. draw: one instanced quad per slot; the vertex shader fetches its texel, dead slots collapse.
 * Looks reuse the effects atlas and colour ramps (lit smoke / dust / debris, additive sparks / embers / fire).
 *
 * Kinds: see GK. API: emit() for one particle, burst() for a spray of them (see GpuParticleApi).
 */
import * as THREE from 'three';
import { F, R, RAMP_ROWS } from './textures';
import { premultipliedMaterialFlags, quadGeometry } from './particles';
import { SMOKE_FRAG_DECL, SMOKE_VERT_DECL, smokeFragDyn, smokeFragSoft, smokeVertMain, type SmokeLightUniforms } from './smokelight';
import { rnd, range, spread } from './rand';

/** GPU particle kinds (behaviour + look). */
export const GK = {
  /** Hot streaks: ballistic, bounce off the ground, cool from white to red. */
  SPARK: 0,
  /** Glowing motes: buoyant, swirling, drift downwind (fires, burning bases, nuke). */
  EMBER: 1,
  /** Lit smoke puffs: buoyant, expanding, turbulent columns. */
  SMOKE: 2,
  /** Lit dust: low, spreading, settling (debris dust, base surge, vehicles). */
  DUST: 3,
  /** Small dark chunks: ballistic, bounce, settle on the ground. */
  DEBRIS: 4,
  /** White water / snow spray: ballistic with strong drag. */
  SPRAY: 5,
  /** Flame tongues: rise fast, short-lived, fire turning into smoke. */
  FIRE: 6,
  /** Grey ash / soot flakes drifting down. */
  ASH: 7,
} as const;
export type GpuKind = (typeof GK)[keyof typeof GK];

/** Default look per kind: atlas frame, ramp row, lit (normal-mapped) flag, streak stretch. */
const LOOK: { frame: number; ramp: number; lit: number; stretch: number }[] = [
  { frame: F.SPARK, ramp: R.SPARK, lit: 0, stretch: 0.03 },
  { frame: F.GLOW, ramp: R.EMBER, lit: 0, stretch: 0.012 },
  { frame: F.SMOKE_A, ramp: R.SMOKE_DARK, lit: 1, stretch: 0 },
  { frame: F.DUST, ramp: R.DUST, lit: 1, stretch: 0 },
  { frame: F.DEBRIS, ramp: R.DEBRIS, lit: 1, stretch: 0 },
  { frame: F.SMOKE_B, ramp: R.SPRAY, lit: 1, stretch: 0.02 },
  { frame: F.FLAME, ramp: R.FIRE, lit: 0, stretch: 0 },
  { frame: F.GLOW, ramp: R.SMOKE, lit: 0, stretch: 0 },
];

export interface BurstOptions {
  /** Lifetime range in seconds. */
  life?: [number, number];
  /** Start / end size (world units), randomised +-25 %. */
  size0?: number;
  size1?: number;
  alpha?: number;
  /** Colour ramp row override (R.*). */
  ramp?: number;
  /** Seconds before the particles appear (range: staggered). */
  delay?: number | [number, number];
  /** Upward bias of the random directions (0 = sphere, 1 = hemisphere pushed up). */
  up?: number;
  /** Horizontal spawn radius. */
  radius?: number;
  /** Fraction of the speed that is random (default 0.5). */
  jitter?: number;
}

/** What effect recipes (and the destruction code) call. */
export interface GpuParticleApi {
  readonly capacity: number;
  /** 0..1 count multiplier for the quality preset (bursts scale by it; emit() does not). */
  readonly density: number;
  emit(kind: GpuKind, x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size0: number, size1: number, alpha?: number, ramp?: number, delay?: number): void;
  /** n particles from (x, y, z) in random directions at `speed` (scaled by density). */
  burst(kind: GpuKind, x: number, y: number, z: number, n: number, speed: number, opts?: BurstOptions): void;
}

const STAGE_FLOATS = 13; // slot, T0 (4), T1 (4), T2 (4)

const SIM_VS = /* glsl */ `
in vec3 position;
void main() { gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }`;

const SIM_FS = /* glsl */ `
precision highp float;
precision highp sampler2D;
uniform sampler2D t0, t1, t2, tHeight, tNoise;
uniform vec4 uHeightXf;
uniform float uDt, uTime, uWaterLevel, uHasHeight;
uniform vec3 uWind;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
layout(location = 2) out vec4 o2;
float nz(vec2 p) { return texture(tNoise, p * 0.0625).r; }
float groundAt(vec2 xz) {
  float h = uHasHeight > 0.5 ? texture(tHeight, xz * uHeightXf.xy + uHeightXf.zw).r : 0.0;
  return max(h, uWaterLevel);
}
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 a = texelFetch(t0, c, 0), b = texelFetch(t1, c, 0), p = texelFetch(t2, c, 0);
  o2 = p;
  float life = b.w;
  if (life <= 0.0) { o0 = a; o1 = b; return; }
  float age = a.w + uDt;
  if (age < 0.0) { o0 = vec4(a.xyz, age); o1 = b; return; }
  if (age >= life) { o0 = vec4(a.xyz, age); o1 = vec4(0.0); return; }
  float t = age / life;
  int kind = int(mod(p.z, 16.0) + 0.5);
  // per-kind physics: gravity, drag, buoyancy, turbulence, bounce, wind coupling
  float g = 0.0, drag = 1.0, buoy = 0.0, turb = 0.0, bounce = 0.0, windK = 1.0;
  if (kind == 0) { g = 9.8; drag = 0.55; turb = 0.4; bounce = 0.42; windK = 0.1; }
  else if (kind == 1) { g = 0.5; drag = 1.3; buoy = 1.4 * (1.0 - t); turb = 3.2; bounce = 0.1; windK = 1.0; }
  else if (kind == 2) { g = 0.0; drag = 0.85; buoy = 0.9 * (1.0 - t) * (1.0 - t); turb = 1.1; windK = 1.0; }
  else if (kind == 3) { g = 0.35; drag = 1.7; buoy = 0.06; turb = 0.8; windK = 0.7; }
  else if (kind == 4) { g = 9.8; drag = 0.2; turb = 0.05; bounce = 0.3; windK = 0.0; }
  else if (kind == 5) { g = 7.0; drag = 1.4; turb = 0.4; windK = 0.5; }
  else if (kind == 6) { g = -2.2; drag = 2.6; turb = 2.0; windK = 0.5; }
  else { g = 0.25; drag = 2.2; turb = 1.2; windK = 1.2; }
  vec3 pos = a.xyz, vel = b.xyz;
  // swirling turbulence: the rotated gradient of a drifting noise field (divergence-free in xz) plus lift
  vec2 q = pos.xz * 0.55 + vec2(pos.y * 0.37 + uTime * 0.11, -uTime * 0.07);
  float n0 = nz(q), nx = nz(q + vec2(0.08, 0.0)), ny = nz(q + vec2(0.0, 0.08));
  vec3 sw = vec3(ny - n0, 0.0, n0 - nx) * 12.5 + vec3(0.0, nz(q * 1.7 + 9.1) - 0.5, 0.0);
  vec3 acc = vec3(0.0, buoy - g, 0.0) + sw * turb;
  vel += acc * uDt;
  // drag relaxes the velocity towards the (partly felt) wind
  vec3 wv = uWind * windK;
  vel = wv + (vel - wv) * exp(-drag * uDt);
  pos += vel * uDt;
  float gh = groundAt(pos.xz);
  if (pos.y < gh) {
    bool wet = gh <= uWaterLevel + 1e-3;
    if (bounce > 0.0 && !wet) {
      pos.y = gh + 0.005;
      if (vel.y < 0.0) vel.y = -vel.y * bounce;
      vel.xz *= 0.55;
      // settled debris / sparks stop jittering
      if (abs(vel.y) < 0.15) vel.y = 0.0;
    } else {
      pos.y = gh + 0.005;
      vel.y = max(vel.y, 0.0);
      vel.xz *= 0.92;
      // sparks and embers die in water
      if (wet && (kind == 0 || kind == 1)) { o0 = vec4(pos, age); o1 = vec4(0.0); return; }
    }
  }
  o0 = vec4(pos, age);
  o1 = vec4(vel, life);
}`;

const SPAWN_VS = /* glsl */ `
precision highp float;
in float aSlot;
in vec4 aT0, aT1, aT2;
uniform vec2 uSize;
out vec4 v0; out vec4 v1; out vec4 v2;
void main() {
  float x = mod(aSlot, uSize.x), y = floor(aSlot / uSize.x);
  gl_Position = vec4((x + 0.5) / uSize.x * 2.0 - 1.0, (y + 0.5) / uSize.y * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = 1.0;
  v0 = aT0; v1 = aT1; v2 = aT2;
}`;

const SPAWN_FS = /* glsl */ `
precision highp float;
in vec4 v0; in vec4 v1; in vec4 v2;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
layout(location = 2) out vec4 o2;
void main() { o0 = v0; o1 = v1; o2 = v2; }`;

const DRAW_VS = /* glsl */ `
precision highp float;
precision highp sampler2D;
uniform sampler2D t0, t1, t2;
uniform float uW;
uniform vec3 uSunDir;
uniform vec4 uLook[8];
varying vec2 vUv;
varying vec4 vTint;
varying vec2 vRampUv;
varying vec3 vRot;
varying vec3 vSunV;
const float ATLAS = 4.0;
${SMOKE_VERT_DECL}
void main() {
  int id = gl_InstanceID;
  ivec2 c = ivec2(id % int(uW), id / int(uW));
  vec4 a = texelFetch(t0, c, 0), b = texelFetch(t1, c, 0), p = texelFetch(t2, c, 0);
  if (b.w <= 0.0 || a.w < 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vTint = vec4(0.0); return; }
  float t = clamp(a.w / b.w, 0.0, 1.0);
  float kf = mod(p.z, 16.0);
  int kind = int(kf + 0.5);
  float ramp = floor(p.z / 16.0 + 0.001);
  vec4 look = uLook[kind];
  float seed = fract(sin(float(id) * 12.9898) * 43758.5453);
  float sz = mix(p.x, p.y, 1.0 - pow(1.0 - t, 1.6));
  // frame: smoke picks one of three puffs
  float frame = look.x;
  if (kind == 2) frame += floor(seed * 2.999);
  float rot = seed * 6.2831 + a.w * (seed - 0.5) * (kind == 4 ? 9.0 : 0.8);
  float cr = cos(rot), sr = sin(rot);
  vec2 corner = position.xy;
  vec4 mv = viewMatrix * vec4(a.xyz, 1.0);
  float dist = -mv.z;
  float push = min(0.3 * sz, dist * 0.5);
  mv.z += push;
  float k = (dist - push) / max(dist, 1e-3);
  if (look.w > 0.0) {
    // streak along the screen-space velocity
    vec2 vv = (viewMatrix * vec4(b.xyz, 0.0)).xy;
    float vl = length(vv);
    vec2 ax = vl > 1e-4 ? vv / vl : vec2(cr, sr);
    vec2 pr = vec2(-ax.y, ax.x);
    float len = sz + vl * look.w;
    mv.xy += (ax * (corner.x * len) + pr * (corner.y * sz)) * k;
  } else {
    vec2 rc = vec2(cr * corner.x - sr * corner.y, sr * corner.x + cr * corner.y) * sz;
    mv.xy += rc * k;
  }
  gl_Position = projectionMatrix * mv;
${smokeVertMain('a.xyz', 'mv', 'sz', 'look.z > 0.5')}
  float fi = smoothstep(0.0, 0.06, t);
  float fo = 1.0 - smoothstep(0.55, 1.0, t);
  // embers and sparks twinkle
  float tw = kind == 1 ? 0.65 + 0.35 * sin(a.w * (9.0 + seed * 14.0) + seed * 40.0) : 1.0;
  vTint = vec4(vec3(tw), p.w * fi * fo);
  vec2 cell = vec2(mod(frame, ATLAS), floor(frame / ATLAS + 0.001));
  vUv = (cell + 0.5 + corner * 0.996) / ATLAS;
  vRampUv = vec2((t * 63.0 + 0.5) / 64.0, (ramp + 0.5) / ${RAMP_ROWS.toFixed(1)});
  vRot = vec3(cr, sr, look.z);
  vSunV = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
}`;

const DRAW_FS = /* glsl */ `
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
    float w = clamp(dot(n, vSunV) * 0.65 + 0.35, 0.0, 1.0);
    vec3 lit = mix(uShadowCol, uLightCol, w) * tex.b;
${smokeFragDyn('lit', 'n', 'tex.b')}
    float fire = tex.b * (0.25 + smoothstep(0.6, 1.0, n.z));
    vec3 heat = vec3(fire, pow(fire, 1.7), pow(fire, 2.6)) * 1.1;
    base = mix(heat, lit, smoothstep(0.3, 0.85, ramp.a));
  }
  gl_FragColor = vec4(base * ramp.rgb * vTint.rgb * cov, min(cov * ramp.a, 1.0));
}`;

export interface GpuParticleOptions {
  renderer: THREE.WebGLRenderer;
  /** Texels across / down (capacity = w * h). */
  width: number;
  height: number;
  atlas: THREE.Texture;
  ramp: THREE.Texture;
  /** Shared particle uniforms (uTime, uWind, uSunDir, uLightCol, uShadowCol, soft depth and fire light). */
  shared: { uSunDir: { value: THREE.Vector3 }; uLightCol: { value: THREE.Color }; uShadowCol: { value: THREE.Color }; uWind: { value: THREE.Vector3 } } & Partial<SmokeLightUniforms>;
  /** SOFT / DYNLIT particle lighting (smokelight.ts bindSmokeLight). */
  defines?: Record<string, string>;
  noise: THREE.Texture;
  waterLevel: number;
  density: number;
  renderOrder: number;
}

export class GpuParticles implements GpuParticleApi {
  readonly capacity: number;
  readonly density: number;
  readonly mesh: THREE.Mesh;
  /** Draw calls of the last simulate() (sim + spawn) and particles spawned. */
  readonly stats = { capacity: 0, simCalls: 0, spawnedFrame: 0, spawnedTotal: 0, live: false };
  private w: number;
  private h: number;
  private rts: THREE.WebGLRenderTarget[];
  private cur = 0;
  private simMat: THREE.RawShaderMaterial;
  private spawnMat: THREE.RawShaderMaterial;
  private drawMat: THREE.ShaderMaterial;
  private simQuad: THREE.Mesh;
  private spawnPts: THREE.Points;
  private stage: Float32Array;
  private stageBuf: THREE.InterleavedBuffer;
  private stageN = 0;
  private stageCap: number;
  private head = 0;
  private used = 0;
  private lastDeath = -1;
  private clock = 0;
  private pendingDt = 0;
  private cleared = false;
  private orthoCam = new THREE.Camera();
  private scene = new THREE.Scene();
  private renderer: THREE.WebGLRenderer;
  private geo: THREE.InstancedBufferGeometry;

  constructor(o: GpuParticleOptions) {
    this.renderer = o.renderer;
    this.w = o.width;
    this.h = o.height;
    this.capacity = o.width * o.height;
    this.density = o.density;
    this.stats.capacity = this.capacity;
    const mk = () => {
      const rt = new THREE.WebGLRenderTarget(o.width, o.height, {
        count: 3, type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
        depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
      });
      for (const t of rt.textures) t.name = 'gpu-particles';
      return rt;
    };
    this.rts = [mk(), mk()];
    this.simMat = new THREE.RawShaderMaterial({
      name: 'gpu-particles-sim',
      glslVersion: THREE.GLSL3,
      uniforms: {
        t0: { value: null }, t1: { value: null }, t2: { value: null },
        tHeight: { value: null }, tNoise: { value: o.noise },
        uHeightXf: { value: new THREE.Vector4(0, 0, 0, 0) }, uHasHeight: { value: 0 },
        uDt: { value: 0 }, uTime: { value: 0 }, uWaterLevel: { value: o.waterLevel },
        uWind: { value: o.shared.uWind.value },
      },
      vertexShader: SIM_VS,
      fragmentShader: SIM_FS,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.BufferGeometry();
    quad.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 1.5, -0.5, 0, -0.5, 1.5, 0], 3));
    this.simQuad = new THREE.Mesh(quad, this.simMat);
    this.simQuad.frustumCulled = false;
    // staging buffer for this frame's spawns (drawn as points into their texels)
    this.stageCap = Math.min(16384, this.capacity);
    this.stage = new Float32Array(this.stageCap * STAGE_FLOATS);
    this.stageBuf = new THREE.InterleavedBuffer(this.stage, STAGE_FLOATS);
    this.stageBuf.setUsage(THREE.DynamicDrawUsage);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('aSlot', new THREE.InterleavedBufferAttribute(this.stageBuf, 1, 0));
    sg.setAttribute('aT0', new THREE.InterleavedBufferAttribute(this.stageBuf, 4, 1));
    sg.setAttribute('aT1', new THREE.InterleavedBufferAttribute(this.stageBuf, 4, 5));
    sg.setAttribute('aT2', new THREE.InterleavedBufferAttribute(this.stageBuf, 4, 9));
    sg.setDrawRange(0, 0);
    this.spawnMat = new THREE.RawShaderMaterial({
      name: 'gpu-particles-spawn',
      glslVersion: THREE.GLSL3,
      uniforms: { uSize: { value: new THREE.Vector2(o.width, o.height) } },
      vertexShader: SPAWN_VS,
      fragmentShader: SPAWN_FS,
      depthTest: false,
      depthWrite: false,
    });
    this.spawnPts = new THREE.Points(sg, this.spawnMat);
    this.spawnPts.frustumCulled = false;
    this.scene.add(this.simQuad, this.spawnPts);

    // the draw: one instanced quad per texel
    const g = new THREE.InstancedBufferGeometry();
    const q = quadGeometry();
    g.setAttribute('position', q.position);
    g.setIndex(q.index);
    g.instanceCount = 0;
    this.geo = g;
    const looks = LOOK.map((l) => new THREE.Vector4(l.frame, l.ramp, l.lit, l.stretch));
    this.drawMat = new THREE.ShaderMaterial({
      name: 'gpu-particles',
      uniforms: {
        t0: { value: null }, t1: { value: null }, t2: { value: null },
        uW: { value: o.width },
        uLook: { value: looks },
        uSunDir: o.shared.uSunDir,
        uLightCol: o.shared.uLightCol,
        uShadowCol: o.shared.uShadowCol,
        uAtlas: { value: o.atlas },
        uRamp: { value: o.ramp },
        ...(o.shared.tSoftDepth ? { tSoftDepth: o.shared.tSoftDepth, uSoftInvRes: o.shared.uSoftInvRes } : {}),
        ...(o.shared.tDynLights ? { tDynLights: o.shared.tDynLights, tDynTiles: o.shared.tDynTiles, uDynK: o.shared.uDynK } : {}),
      },
      defines: o.defines ?? {},
      vertexShader: DRAW_VS,
      fragmentShader: DRAW_FS,
      side: THREE.DoubleSide,
    });
    premultipliedMaterialFlags(this.drawMat);
    this.mesh = new THREE.Mesh(g, this.drawMat);
    this.mesh.name = 'gpu-particles';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = o.renderOrder;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.visible = false;
    this.bindState();
  }

  /** Ground collisions: terrain height texture and world (x, z) -> uv transform (uv = xz * xf.xy + xf.zw). */
  setHeightField(tex: THREE.Texture | null, xf?: THREE.Vector4) {
    const u = this.simMat.uniforms;
    u.tHeight.value = tex;
    u.uHasHeight.value = tex ? 1 : 0;
    if (xf) u.uHeightXf.value.copy(xf);
  }

  emit(kind: GpuKind, x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size0: number, size1: number, alpha = 1, ramp = -1, delay = 0): void {
    if (this.stageN >= this.stageCap || !(life > 0)) return;
    const slot = this.head;
    this.head = (this.head + 1) % this.capacity;
    if (this.used < this.capacity) this.used++;
    const s = this.stage, o = this.stageN * STAGE_FLOATS;
    s[o] = slot;
    s[o + 1] = x; s[o + 2] = y; s[o + 3] = z; s[o + 4] = -Math.max(0, delay);
    s[o + 5] = vx; s[o + 6] = vy; s[o + 7] = vz; s[o + 8] = life;
    s[o + 9] = size0; s[o + 10] = size1; s[o + 11] = kind + 16 * (ramp >= 0 ? ramp : LOOK[kind].ramp); s[o + 12] = alpha;
    this.stageN++;
    const end = this.clock + delay + life;
    if (end > this.lastDeath) this.lastDeath = end;
  }

  burst(kind: GpuKind, x: number, y: number, z: number, n: number, speed: number, opts: BurstOptions = {}): void {
    n = Math.round(n * this.density);
    const life = opts.life ?? [0.6, 1.2];
    const s0 = opts.size0 ?? 0.05, s1 = opts.size1 ?? s0;
    const up = opts.up ?? 0.5, rad = opts.radius ?? 0, jit = opts.jitter ?? 0.5;
    const d = opts.delay ?? 0;
    for (let i = 0; i < n; i++) {
      // random direction, biased upwards
      let dx = spread(1), dy = spread(1), dz = spread(1);
      const l = Math.hypot(dx, dy, dz) || 1;
      dx /= l; dy /= l; dz /= l;
      dy = dy * (1 - up) + Math.abs(dy) * up + up * 0.5;
      const sp = speed * (1 - jit + jit * rnd());
      const a = rnd() * Math.PI * 2, r = rad * Math.sqrt(rnd());
      const k = range(0.75, 1.25);
      this.emit(kind, x + Math.cos(a) * r, y, z + Math.sin(a) * r, dx * sp, dy * sp, dz * sp, range(life[0], life[1]), s0 * k, s1 * k, opts.alpha ?? 1, opts.ramp ?? -1,
        typeof d === 'number' ? d : range(d[0], d[1]));
    }
  }

  /** Advance the effect clock (Effects.update). The GPU work happens in simulate(). */
  advance(dt: number) {
    this.clock += dt;
    this.pendingDt += dt;
  }

  private bindState() {
    const rt = this.rts[this.cur];
    const u = this.drawMat.uniforms;
    u.t0.value = rt.textures[0];
    u.t1.value = rt.textures[1];
    u.t2.value = rt.textures[2];
  }

  /** Run the sim and spawn passes (once per rendered frame, before the scene renders). */
  simulate(time: number) {
    const r = this.renderer;
    this.stats.simCalls = 0;
    this.stats.spawnedFrame = this.stageN;
    this.stats.spawnedTotal += this.stageN;
    const live = this.clock <= this.lastDeath + 0.05;
    this.stats.live = live;
    const dt = Math.min(0.1, this.pendingDt);
    this.pendingDt = 0;
    if (!live && this.stageN === 0) {
      this.mesh.visible = false;
      return;
    }
    const prevTarget = r.getRenderTarget();
    const prevAuto = r.autoClear;
    r.autoClear = false;
    if (!this.cleared) {
      const prevColor = r.getClearColor(new THREE.Color());
      const prevAlpha = r.getClearAlpha();
      r.setClearColor(0x000000, 0);
      for (const rt of this.rts) { r.setRenderTarget(rt); r.clear(true, false, false); }
      r.setClearColor(prevColor, prevAlpha);
      this.cleared = true;
    }
    const src = this.rts[this.cur], dst = this.rts[1 - this.cur];
    const su = this.simMat.uniforms;
    su.t0.value = src.textures[0];
    su.t1.value = src.textures[1];
    su.t2.value = src.textures[2];
    su.uDt.value = dt;
    su.uTime.value = time;
    r.setRenderTarget(dst);
    this.simQuad.visible = true;
    this.spawnPts.visible = false;
    r.render(this.scene, this.orthoCam);
    this.stats.simCalls++;
    if (this.stageN > 0) {
      const geo = this.spawnPts.geometry;
      geo.setDrawRange(0, this.stageN);
      this.stageBuf.clearUpdateRanges();
      this.stageBuf.addUpdateRange(0, this.stageN * STAGE_FLOATS);
      this.stageBuf.needsUpdate = true;
      this.simQuad.visible = false;
      this.spawnPts.visible = true;
      r.render(this.scene, this.orthoCam);
      this.stats.simCalls++;
      this.stageN = 0;
    }
    r.setRenderTarget(prevTarget);
    r.autoClear = prevAuto;
    this.cur = 1 - this.cur;
    this.bindState();
    this.geo.instanceCount = this.used;
    this.mesh.visible = this.used > 0;
  }

  /** Shader warm-up: compile the sim, spawn and draw programs now (one dead particle). */
  warmUp(time: number) {
    this.emit(GK.EMBER, 0, -100, 0, 0, 0, 0, 0.01, 0, 0, 0);
    this.simulate(time);
    this.mesh.visible = true;
  }

  dispose() {
    for (const rt of this.rts) rt.dispose();
    this.simMat.dispose();
    this.spawnMat.dispose();
    this.drawMat.dispose();
    this.simQuad.geometry.dispose();
    this.spawnPts.geometry.dispose();
    this.geo.dispose();
    this.mesh.removeFromParent();
  }
}

/** Is float render-target MRT available (WebGL2 + EXT_color_buffer_float)? */
export function gpuParticlesSupported(renderer: THREE.WebGLRenderer): boolean {
  try {
    return renderer.capabilities.isWebGL2 !== false && renderer.extensions.has('EXT_color_buffer_float');
  } catch {
    return false;
  }
}
