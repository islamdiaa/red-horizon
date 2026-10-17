/**
 * Heat haze: hot air over flames, burning wrecks, fireballs, flamethrowers, engine exhausts, tesla discharges
 * and superweapon blasts bends the light passing through it.
 *
 *  - HeatSources: a CPU store of hot spots (struct of arrays, no allocations per source), fed by the effect
 *    recipes like the dynamic lights: `add(...)` with a duration (timed: an explosion's heat bubble that grows,
 *    rises and cools) or 0 (this frame only: re-added every frame by fires and exhausts).
 *  - HeatHazePass: once per frame the visible sources (the strongest `cap`) are drawn as rising plumes into a
 *    small half-float buffer (half resolution on High, quarter on Medium) holding a screen-space offset: two
 *    octaves of noise drifting upwards with the hot air, strongest just above the source, fading with height,
 *    scaled by the perspective (a fire far away shimmers less on screen), and hidden behind whatever stands
 *    in front of the source (soft test against the scene depth). One instanced draw; nothing at all when no
 *    source is in view.
 *  - HAZE_GLSL: the final pass looks its colour (and bloom) up through the offset, but never pulls a nearer
 *    surface into the shimmer (a tank in front of a burning refinery stays crisp).
 *
 * Subtle on purpose: a couple of pixels at the default RTS zoom, more in close-ups. Off on Low and with
 * reduced motion (hazeSettings).
 */
import * as THREE from 'three';
import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';

/** Options of a heat source. */
export interface HeatOptions {
  /** Seconds before it starts (timed sources). */
  delay?: number;
  /** Upward drift of a timed source (units / s): the fireball's hot air climbing. */
  rise?: number;
  /** Radius growth of a timed source over its life (0.5 = +50 %). */
  grow?: number;
  /** Farthest camera distance at which the source is drawn (small sources: engine exhausts up close). */
  range?: number;
}

/** What effect recipes call (ctx.heat; null on Low, preview pages and with reduced motion off-switch). */
export interface HeatApi {
  /**
   * A hot spot at world (x, y, z): `radius` of the hot core, plume `height` above it, `strength` = apparent
   * displacement in world units (0.02 a small fire … 0.2 a nuke). `duration` > 0: timed (fast rise, cooling
   * decay); 0: this frame only.
   */
  add(x: number, y: number, z: number, radius: number, height: number, strength: number, duration: number, opts?: HeatOptions): void;
}

/** Haze buffer settings per quality preset (pure; tests): Low and reduced motion get none. */
export function hazeSettings(quality: 'low' | 'medium' | 'high', reduceMotion = false): { enabled: boolean; scale: number; cap: number } {
  if (quality === 'low' || reduceMotion) return { enabled: false, scale: 0, cap: 0 };
  return quality === 'high' ? { enabled: true, scale: 0.5, cap: 96 } : { enabled: true, scale: 0.25, cap: 48 };
}

/** Floats per drawn source (instance buffer). */
export const HEAT_STRIDE = 8;
const STORE = 384;
const DEFAULT_RANGE = 90;

const _m = new THREE.Matrix4();

export class HeatSources implements HeatApi {
  /** Effect clock (seconds) for timed sources; advanced by the effects system. */
  now = 0;
  /** Last prepare(): sources stored, in view, drawn. */
  readonly stats = { stored: 0, visible: 0, drawn: 0 };
  private px = new Float32Array(STORE);
  private py = new Float32Array(STORE);
  private pz = new Float32Array(STORE);
  private rad = new Float32Array(STORE);
  private hgt = new Float32Array(STORE);
  private str = new Float32Array(STORE);
  private start = new Float32Array(STORE);
  private dur = new Float32Array(STORE);
  private rise = new Float32Array(STORE);
  private grow = new Float32Array(STORE);
  private range = new Float32Array(STORE);
  private seed = new Float32Array(STORE);
  /** 0 = free, 1 = timed, 2 = this frame */
  private mode = new Uint8Array(STORE);
  private free: number[] = [];
  private used: number[] = [];
  private seq = 0;
  // per-frame scratch
  private cand = new Int32Array(STORE);
  private score = new Float32Array(STORE);
  private cr = new Float32Array(STORE);
  private cy = new Float32Array(STORE);
  private cs = new Float32Array(STORE);
  private order: number[] = [];

  constructor() {
    for (let i = STORE - 1; i >= 0; i--) this.free.push(i);
  }

  add(x: number, y: number, z: number, radius: number, height: number, strength: number, duration: number, opts?: HeatOptions): void {
    if (!(radius > 0) || !(strength > 0) || !Number.isFinite(x + y + z)) return;
    let i = this.free.pop();
    if (i === undefined) {
      // full: replace the weakest source if the new one is stronger
      let best = -1, bestS = strength * radius;
      for (const j of this.used) {
        const s = this.str[j] * this.rad[j];
        if (s < bestS) { bestS = s; best = j; }
      }
      if (best < 0) return;
      this.release(best);
      i = this.free.pop()!;
    }
    this.used.push(i);
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.rad[i] = radius;
    this.hgt[i] = Math.max(radius, height);
    this.str[i] = strength;
    this.start[i] = this.now + (opts?.delay ?? 0);
    this.dur[i] = duration;
    this.rise[i] = opts?.rise ?? 0;
    this.grow[i] = opts?.grow ?? 0;
    this.range[i] = opts?.range ?? DEFAULT_RANGE;
    // per-frame sources keep their noise phase from their position; timed ones get a fresh one
    this.seed[i] = duration > 0 ? ((this.seq++ * 0.6180339) % 1) : ((x * 0.137 + z * 0.291) % 1 + 1) % 1;
    this.mode[i] = duration > 0 ? 1 : 2;
  }

  private release(i: number): void {
    this.mode[i] = 0;
    const k = this.used.indexOf(i);
    if (k >= 0) { this.used[k] = this.used[this.used.length - 1]; this.used.pop(); }
    this.free.push(i);
  }

  /** Drop everything (match teardown). */
  clear(): void {
    for (const i of this.used) { this.mode[i] = 0; this.free.push(i); }
    this.used.length = 0;
  }

  /** Sources currently stored (timed + this frame's). */
  get size(): number {
    return this.used.length;
  }

  /**
   * Evaluate envelopes, cull against the camera, keep the `cap` strongest and write them into `out`
   * (HEAT_STRIDE floats each: x, y, z, radius, height, strength, seed, 0). Per-frame sources are consumed.
   * Returns how many were written.
   */
  prepare(camera: THREE.PerspectiveCamera, out: Float32Array, cap: number): number {
    const now = this.now;
    const used = this.used;
    _m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const e = _m.elements;
    const cp = camera.position;
    let n = 0;
    for (let k = used.length - 1; k >= 0; k--) {
      const i = used[k];
      let S = this.str[i], r = this.rad[i], y = this.py[i];
      if (this.mode[i] === 1) {
        const age = now - this.start[i];
        if (age < 0) continue;
        const d = this.dur[i];
        if (age >= d) { this.mode[i] = 0; used[k] = used[used.length - 1]; used.pop(); this.free.push(i); continue; }
        const t = age / d;
        // fast attack, then the air cools; the bubble grows and climbs
        S *= Math.min(1, 0.3 + age / 0.08) * (1 - t) * (1 - t);
        r *= 1 + this.grow[i] * Math.sqrt(t);
        y += this.rise[i] * age;
      } else {
        // consumed this frame
        this.mode[i] = 0; used[k] = used[used.length - 1]; used.pop(); this.free.push(i);
      }
      if (S < 1e-4) continue;
      const x = this.px[i], z = this.pz[i], h = this.hgt[i];
      const dist = Math.hypot(cp.x - x, cp.y - y, cp.z - z);
      if (dist > this.range[i]) continue;
      // bounding sphere of the plume against the view
      const my = y + h * 0.4, br = Math.max(r * 1.7, h * 0.7);
      const w = e[3] * x + e[7] * my + e[11] * z + e[15];
      if (w < -br) continue;
      if (w > 0.05) {
        const sx = (e[0] * x + e[4] * my + e[8] * z + e[12]) / w, sy = (e[1] * x + e[5] * my + e[9] * z + e[13]) / w;
        const m = 1 + (br * Math.max(e[0], e[5])) / w;
        if (sx < -m || sx > m || sy < -m || sy > m) continue;
      }
      this.cr[i] = r;
      this.cy[i] = y;
      this.cs[i] = S;
      // importance: apparent strength over the screen area it covers
      this.score[i] = (S * r * h) / Math.max(1, dist);
      this.cand[n++] = i;
    }
    this.stats.stored = used.length;
    this.stats.visible = n;
    const order = this.order;
    order.length = 0;
    for (let k = 0; k < n; k++) order.push(this.cand[k]);
    if (n > cap) {
      const sc = this.score;
      order.sort((a, b) => sc[b] - sc[a]);
      order.length = cap;
    }
    for (let k = 0; k < order.length; k++) {
      const i = order[k];
      const o = k * HEAT_STRIDE;
      out[o] = this.px[i]; out[o + 1] = this.cy[i]; out[o + 2] = this.pz[i]; out[o + 3] = this.cr[i];
      out[o + 4] = this.hgt[i]; out[o + 5] = this.cs[i]; out[o + 6] = this.seed[i]; out[o + 7] = 0;
    }
    this.stats.drawn = order.length;
    return order.length;
  }
}

/** Tileable two-channel value noise (64², smooth), procedural: the turbulence the hot air carries. */
function hazeNoise(): THREE.DataTexture {
  const S = 64, P = 8;
  const data = new Uint8Array(S * S * 4);
  const lat = new Float32Array(P * P * 2);
  // integer hash (deterministic, no Math.random)
  let h = 0x9e3779b9;
  for (let i = 0; i < lat.length; i++) {
    h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
    lat[i] = ((h >>> 0) % 10007) / 10007;
  }
  const at = (ix: number, iy: number, c: number) => lat[(((iy % P) + P) % P * P + ((ix % P) + P) % P) * 2 + c];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const fx = (x / S) * P, fy = (y / S) * P;
      const ix = Math.floor(fx), iy = Math.floor(fy);
      let tx = fx - ix, ty = fy - iy;
      tx = tx * tx * (3 - 2 * tx);
      ty = ty * ty * (3 - 2 * ty);
      for (let c = 0; c < 2; c++) {
        const a = at(ix, iy, c), b = at(ix + 1, iy, c), cc = at(ix, iy + 1, c), d = at(ix + 1, iy + 1, c);
        const v = a + (b - a) * tx + (cc - a) * ty + (a - b - cc + d) * tx * ty;
        data[(y * S + x) * 4 + c] = Math.round(v * 255);
      }
      data[(y * S + x) * 4 + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

const HAZE_VS = /* glsl */ `
attribute vec4 aA; // x, y, z, radius
attribute vec4 aB; // height, strength, seed, -
uniform vec2 uProjScale;
varying vec2 vLocal;
varying vec3 vWorld;
varying vec2 vAmp;
varying float vViewZ;
varying float vSeed;
void main() {
  vec3 base = aA.xyz;
  float r = aA.w, h = aB.x;
  // cylindrical billboard: upright (the hot air rises), turned towards the camera
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  right = normalize(vec3(right.x, 0.0, right.z) + vec3(1e-5, 0.0, 0.0));
  float u = position.x, v = position.y;
  // from a little below the source (hot air wraps the flames) up the plume, widening as it climbs
  vec3 wp = base + right * (u * r * (1.0 + 0.7 * v)) + vec3(0.0, mix(-r * 0.6, h, v), 0.0);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mv;
  vLocal = vec2(u, v);
  vWorld = wp;
  vViewZ = -mv.z;
  vSeed = aB.z;
  // world-space displacement to screen uv: perspective shrinks a distant shimmer
  float z = max(-(viewMatrix * vec4(base, 1.0)).z, 0.5);
  vAmp = aB.y * uProjScale / z;
}`;

const HAZE_FS = /* glsl */ `
uniform sampler2D tNoise, tDepth;
uniform float uTime;
uniform vec2 uInvRes, uNearFar;
varying vec2 vLocal;
varying vec3 vWorld;
varying vec2 vAmp;
varying float vViewZ;
varying float vSeed;
void main() {
  float u = vLocal.x, v = vLocal.y;
  // strongest just above the source, fading towards the top and the sides of the plume
  float env = (1.0 - u * u) * smoothstep(0.0, 0.22, v) * pow(1.0 - v, 1.3);
  if (env <= 0.002) discard;
  // turbulence carried up by the hot air: two octaves of noise drifting upwards at different speeds
  vec2 q = vec2(vWorld.x * 0.83 + vWorld.z * 0.56, vWorld.y) + vSeed * 9.7;
  vec2 n1 = texture2D(tNoise, q * vec2(0.36, 0.3) + vec2(0.0, -uTime * 0.5)).rg - 0.5;
  vec2 n2 = texture2D(tNoise, q * vec2(0.95, 0.8) + vec2(0.37, -uTime * 1.25)).rg - 0.5;
  vec2 off = (n1 + 0.55 * n2) * 2.0 * env;
  // hidden behind whatever stands in front of the source (soft, half a unit)
  float d = texture2D(tDepth, gl_FragCoord.xy * uInvRes).x;
  float sceneZ = uNearFar.x * uNearFar.y / (uNearFar.y - d * (uNearFar.y - uNearFar.x));
  float occ = clamp((sceneZ - vViewZ) * 2.0 + 0.7, 0.0, 1.0);
  gl_FragColor = vec4(off * vAmp * occ, 0.0, 0.0);
}`;

/**
 * Final-pass GLSL (renderer.ts FinalShader, DISTORT): `hazeOffset(uv)` = the screen offset at uv, zero where it
 * would pull a nearer surface into the shimmer.
 */
export const HAZE_GLSL = /* glsl */ `
uniform sampler2D tHaze, tHazeDepth;
uniform float uHaze;
uniform vec2 uHazeNF;
float hz_viewZ(float d) { return uHazeNF.x * uHazeNF.y / (uHazeNF.y - d * (uHazeNF.y - uHazeNF.x)); }
vec2 hazeOffset(vec2 uv) {
  vec2 off = texture2D(tHaze, uv).rg * uHaze;
  if (dot(off, off) < 1e-10) return vec2(0.0);
  float zc = hz_viewZ(texture2D(tHazeDepth, uv).x), zo = hz_viewZ(texture2D(tHazeDepth, uv + off).x);
  return zo < zc - 0.4 ? vec2(0.0) : off;
}
`;

export class HeatHazePass extends Pass {
  readonly target: THREE.WebGLRenderTarget;
  readonly material: THREE.ShaderMaterial;
  /** Something was drawn this frame (the final pass reads the buffer only then). */
  active = false;
  /** Off with reduced motion (the renderer sets it every frame). */
  allowed = true;
  /** Scene depth (render resolution). */
  depthSource: (() => THREE.Texture | null) | null = null;
  private mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private inst: Float32Array;
  private buf: THREE.InstancedInterleavedBuffer;
  private scene = new THREE.Scene();
  private noise: THREE.DataTexture;
  private clearCol = new THREE.Color();
  private time = 0;

  constructor(private camera: THREE.PerspectiveCamera, readonly sources: HeatSources, private scale: number, private cap: number) {
    super();
    this.needsSwap = false;
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
    this.target.texture.name = 'heat-haze';
    this.noise = hazeNoise();
    this.inst = new Float32Array(cap * HEAT_STRIDE);
    this.buf = new THREE.InstancedInterleavedBuffer(this.inst, HEAT_STRIDE, 1);
    this.buf.setUsage(THREE.DynamicDrawUsage);
    const g = new THREE.InstancedBufferGeometry();
    // a strip of quads up the plume (u -1..1 across, v 0..1 up): 2 x 4 cells
    const pos: number[] = [], idx: number[] = [];
    for (let j = 0; j <= 4; j++) for (let i = 0; i <= 2; i++) pos.push(i - 1, j / 4, 0);
    for (let j = 0; j < 4; j++) for (let i = 0; i < 2; i++) { const a = j * 3 + i; idx.push(a, a + 1, a + 4, a, a + 4, a + 3); }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.setAttribute('aA', new THREE.InterleavedBufferAttribute(this.buf, 4, 0));
    g.setAttribute('aB', new THREE.InterleavedBufferAttribute(this.buf, 4, 4));
    g.instanceCount = 0;
    this.geo = g;
    this.material = new THREE.ShaderMaterial({
      name: 'heat-haze',
      uniforms: {
        tNoise: { value: this.noise },
        tDepth: { value: null },
        uTime: { value: 0 },
        uInvRes: { value: new THREE.Vector2(1, 1) },
        uNearFar: { value: new THREE.Vector2(0.5, 400) },
        uProjScale: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: HAZE_VS,
      fragmentShader: HAZE_FS,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.scene.add(this.mesh);
    this.scene.matrixWorldAutoUpdate = false;
  }

  get texture(): THREE.Texture {
    return this.target.texture;
  }

  setSize(w: number, h: number) {
    this.target.setSize(Math.max(1, Math.round(w * this.scale)), Math.max(1, Math.round(h * this.scale)));
    this.material.uniforms.uInvRes.value.set(1 / this.target.width, 1 / this.target.height);
  }

  render(renderer: THREE.WebGLRenderer, _w?: THREE.WebGLRenderTarget, _r?: THREE.WebGLRenderTarget, deltaTime = 0) {
    this.active = false;
    this.time += Math.min(0.1, Math.max(0, deltaTime));
    if (!this.allowed) {
      // keep the store from piling up while the pass is off
      this.sources.prepare(this.camera, this.inst, 0);
      return;
    }
    const n = this.sources.prepare(this.camera, this.inst, this.cap);
    if (n === 0) return;
    this.buf.clearUpdateRanges();
    this.buf.addUpdateRange(0, n * HEAT_STRIDE);
    this.buf.needsUpdate = true;
    this.geo.instanceCount = n;
    const u = this.material.uniforms;
    const cam = this.camera;
    u.tDepth.value = this.depthSource?.() ?? null;
    u.uTime.value = this.time;
    u.uNearFar.value.set(cam.near, cam.far);
    const pe = cam.projectionMatrix.elements;
    u.uProjScale.value.set(pe[0] * 0.5, pe[5] * 0.5);
    renderer.getClearColor(this.clearCol);
    const alpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(this.target);
    // (render() clears the target to the zero offset first)
    const auto = renderer.autoClear;
    renderer.autoClear = true;
    renderer.render(this.scene, cam);
    renderer.autoClear = auto;
    renderer.setClearColor(this.clearCol, alpha);
    this.active = true;
  }

  dispose() {
    this.target.dispose();
    this.material.dispose();
    this.geo.dispose();
    this.noise.dispose();
  }
}
