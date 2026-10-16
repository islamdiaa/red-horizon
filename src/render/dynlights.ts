import * as THREE from 'three';

/**
 * Hundreds of dynamic point / spot lights without a single THREE.Light ("deferred lighting lite").
 *
 * Lights live in a CPU store (struct of arrays, no allocations per light). Once per frame `prepare()`
 * evaluates their envelopes, culls them against the view, keeps the `cap` most important ones, and bins
 * them into a fixed screen-tile grid (TILES_X x TILES_Y). Two small data textures go to the GPU:
 *   - tDynLights (RGBA32F, cap x 3): position + radius, colour * intensity + spot flag, spot direction + cos;
 *   - tDynTiles  (RGBA8, TILES_X * texelsPerTile x TILES_Y): up to `maxPerTile` light indices per tile.
 * The atmosphere pass (fog.ts) reconstructs position and normal from the scene depth, estimates the
 * albedo from the lit scene colour and the known sun / sky irradiance, and adds every light of the
 * pixel's tile with three.js' physical point-light falloff (so intensities match PointLight candela),
 * plus an analytic in-scattering halo through the air (fog, mist and smoke glow around explosions).
 *
 * Zero extra draw calls; cost scales with the lights that actually touch a pixel. Hard caps per preset,
 * graceful degradation: over the cap the weakest / furthest lights are dropped first.
 */

export const DYN_TILES_X = 32;
export const DYN_TILES_Y = 18;
/** Capacity of the CPU store (persistent + timed + per-frame lights). */
const STORE = 768;

export interface DynamicLightOptions {
  /** Seconds before the light starts (timed lights). */
  delay?: number;
  /** Rise time in seconds (timed lights; default 0.03). */
  attack?: number;
  /** 0..1 random-ish flicker amount (fires 0.35, flashes 0.1). */
  flicker?: number;
  /** Spot light: unit direction and full cone angle in radians (headlights, floodlights). */
  spot?: { x: number; y: number; z: number; angle: number };
  /** Importance multiplier when over the cap (floodlights 0.5, nuke 10). */
  priority?: number;
}

export interface DynamicLightApi {
  /**
   * Add a light. `duration` > 0: a timed flash (attack, then quadratic decay over `duration` s);
   * 0: this frame only (call again every frame — headlights, fires); < 0: persistent until `remove(id)`.
   * Intensity is in three.js PointLight units (candela, inverse-square falloff windowed to `radius`).
   * Returns an id (>= 0) for update/remove, or -1 when the store is full.
   */
  add(x: number, y: number, z: number, color: number | THREE.Color, intensity: number, radius: number, duration: number, opts?: DynamicLightOptions): number;
  /** Move / re-scale a persistent or timed light. Returns false when the id is stale. */
  update(id: number, x: number, y: number, z: number, intensity?: number): boolean;
  remove(id: number): void;
}

const _c = new THREE.Color();

export class DynamicLights implements DynamicLightApi {
  /** Lights drawn per frame at most. */
  readonly cap: number;
  /** Lights per screen tile at most (multiple of 4). */
  readonly maxPerTile: number;
  readonly lightTex: THREE.DataTexture;
  readonly tileTex: THREE.DataTexture;
  /** Global multiplier on every light (tuning hook). */
  intensityScale = 1;
  /** Effect clock (seconds) for timed lights; advanced by the effects system. */
  now = 0;
  /** Stats of the last prepare(): lights in the store, visible, drawn, dropped over the cap. */
  readonly stats = { stored: 0, visible: 0, drawn: 0, dropped: 0, tileOverflow: 0 };

  // store (struct of arrays)
  private px = new Float32Array(STORE);
  private py = new Float32Array(STORE);
  private pz = new Float32Array(STORE);
  private rad = new Float32Array(STORE);
  private cr = new Float32Array(STORE);
  private cg = new Float32Array(STORE);
  private cb = new Float32Array(STORE);
  private peak = new Float32Array(STORE);
  private start = new Float32Array(STORE);
  private dur = new Float32Array(STORE);
  private att = new Float32Array(STORE);
  private flick = new Float32Array(STORE);
  private prio = new Float32Array(STORE);
  private sdx = new Float32Array(STORE);
  private sdy = new Float32Array(STORE);
  private sdz = new Float32Array(STORE);
  private scos = new Float32Array(STORE);
  /** 0 = free, 1 = timed, 2 = this frame, 3 = persistent */
  private mode = new Uint8Array(STORE);
  private gen = new Uint16Array(STORE);
  private free: number[] = [];
  private used: number[] = [];
  // per-frame scratch
  private curI = new Float32Array(STORE);
  private score = new Float32Array(STORE);
  private cand = new Int32Array(STORE);
  private rect = new Int16Array(STORE * 4);
  private order: number[] = [];
  private tileCount: Uint8Array;
  private lightData: Float32Array;
  private tileData: Uint8Array;
  private texelsPerTile: number;

  constructor(cap: number, maxPerTile: number) {
    this.cap = Math.min(255, Math.max(1, cap));
    this.maxPerTile = Math.max(4, Math.ceil(maxPerTile / 4) * 4);
    this.texelsPerTile = this.maxPerTile / 4;
    for (let i = STORE - 1; i >= 0; i--) this.free.push(i);
    this.lightData = new Float32Array(this.cap * 3 * 4);
    this.lightTex = new THREE.DataTexture(this.lightData, this.cap, 3, THREE.RGBAFormat, THREE.FloatType);
    this.lightTex.minFilter = this.lightTex.magFilter = THREE.NearestFilter;
    this.lightTex.generateMipmaps = false;
    this.lightTex.needsUpdate = true;
    this.tileData = new Uint8Array(DYN_TILES_X * this.texelsPerTile * DYN_TILES_Y * 4);
    this.tileCount = new Uint8Array(DYN_TILES_X * DYN_TILES_Y);
    this.tileTex = new THREE.DataTexture(this.tileData, DYN_TILES_X * this.texelsPerTile, DYN_TILES_Y, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.tileTex.minFilter = this.tileTex.magFilter = THREE.NearestFilter;
    this.tileTex.generateMipmaps = false;
    this.tileTex.needsUpdate = true;
  }

  /** GLSL defines for shaders that read the light textures (see DYN_LIGHTS_GLSL). */
  get defines(): Record<string, string> {
    return { DYN_LIGHTS: '', DYN_TEXELS: String(this.texelsPerTile) };
  }

  add(x: number, y: number, z: number, color: number | THREE.Color, intensity: number, radius: number, duration: number, opts?: DynamicLightOptions): number {
    if (!(intensity > 0) || !(radius > 0)) return -1;
    let i = this.free.pop();
    if (i === undefined) {
      // full: recycle the weakest timed / per-frame light if the new one is brighter
      let best = -1, bestS = intensity * radius * (opts?.priority ?? 1);
      for (const j of this.used) {
        if (this.mode[j] === 3) continue;
        const s = this.peak[j] * this.rad[j] * this.prio[j];
        if (s < bestS) { bestS = s; best = j; }
      }
      if (best < 0) return -1;
      this.release(best);
      i = this.free.pop()!;
    }
    this.used.push(i);
    if (typeof color === 'number') _c.setHex(color); else _c.copy(color);
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.rad[i] = radius;
    this.cr[i] = _c.r; this.cg[i] = _c.g; this.cb[i] = _c.b;
    this.peak[i] = intensity;
    this.start[i] = this.now + (opts?.delay ?? 0);
    this.dur[i] = duration;
    this.att[i] = Math.max(1e-3, opts?.attack ?? 0.03);
    this.flick[i] = opts?.flicker ?? (duration > 0 ? 0.1 : 0);
    this.prio[i] = opts?.priority ?? 1;
    const sp = opts?.spot;
    if (sp) {
      const l = Math.hypot(sp.x, sp.y, sp.z) || 1;
      this.sdx[i] = sp.x / l; this.sdy[i] = sp.y / l; this.sdz[i] = sp.z / l;
      this.scos[i] = Math.cos(Math.min(Math.PI * 0.95, sp.angle) / 2);
    } else this.scos[i] = -2;
    this.mode[i] = duration > 0 ? 1 : duration === 0 ? 2 : 3;
    this.gen[i] = (this.gen[i] + 1) & 0x3fff;
    return i | (this.gen[i] << 10);
  }

  private slot(id: number): number {
    if (id < 0) return -1;
    const i = id & 1023;
    if (i >= STORE || this.mode[i] === 0 || this.gen[i] !== id >>> 10) return -1;
    return i;
  }

  update(id: number, x: number, y: number, z: number, intensity?: number): boolean {
    const i = this.slot(id);
    if (i < 0) return false;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    if (intensity !== undefined) this.peak[i] = intensity;
    return true;
  }

  remove(id: number): void {
    const i = this.slot(id);
    if (i >= 0) this.release(i);
  }

  private release(i: number) {
    this.mode[i] = 0;
    const k = this.used.indexOf(i);
    if (k >= 0) { this.used[k] = this.used[this.used.length - 1]; this.used.pop(); }
    this.free.push(i);
  }

  /** Drop every light (match teardown). */
  clear(): void {
    for (const i of this.used) { this.mode[i] = 0; this.free.push(i); }
    this.used.length = 0;
  }

  /**
   * Evaluate envelopes, cull, select and bin the lights for this camera. Call once per rendered frame,
   * before the atmosphere pass runs. Per-frame lights (duration 0) are consumed.
   */
  prepare(camera: THREE.Camera): void {
    const now = this.now;
    let n = 0;
    const v = camera.matrixWorldInverse.elements;
    const pe = camera.projectionMatrix.elements;
    const p0 = pe[0], p5 = pe[5];
    const near = (camera as THREE.PerspectiveCamera).near ?? 0.1;
    const cand = this.cand;
    const used = this.used;
    // drop slot k of `used` (iterating backwards, so the swapped-in entry was already visited)
    const drop = (k: number, i: number) => {
      this.mode[i] = 0;
      used[k] = used[used.length - 1];
      used.pop();
      this.free.push(i);
    };
    for (let k = used.length - 1; k >= 0; k--) {
      const i = used[k];
      const mode = this.mode[i];
      let I = this.peak[i];
      if (mode === 1) {
        const age = now - this.start[i];
        if (age < 0) continue;
        if (age >= this.dur[i]) { drop(k, i); continue; }
        const a = this.att[i];
        if (age < a) I *= age / a;
        else { const q = 1 - (age - a) / Math.max(1e-3, this.dur[i] - a); I *= q * q; }
      }
      const f = this.flick[i];
      if (f > 0) {
        // phase from the position: a fire re-added every frame keeps a steady flicker
        const ph = now * 23 + this.px[i] * 1.31 + this.pz[i] * 0.77;
        I *= 1 - f * (0.5 + 0.3 * Math.sin(ph) + 0.2 * Math.sin(ph * 2.37 + 1.3));
      }
      if (mode === 2) drop(k, i); // consumed (its data stays valid until the next add())
      I *= this.intensityScale;
      if (I < 1e-3) continue;
      // screen rect: the light's bounding sphere (spots: the sphere around their cone) as a view-space box
      let r = this.rad[i], x = this.px[i], y = this.py[i], z = this.pz[i];
      const sc = this.scos[i];
      if (sc > -1.5 && sc > 0.5) {
        const t = Math.sqrt(1 - sc * sc) / sc;
        const br = r * Math.sqrt(0.25 + t * t);
        if (br < r) { x += this.sdx[i] * r * 0.5; y += this.sdy[i] * r * 0.5; z += this.sdz[i] * r * 0.5; r = br; }
      }
      const vx = v[0] * x + v[4] * y + v[8] * z + v[12];
      const vy = v[1] * x + v[5] * y + v[9] * z + v[13];
      const vd = -(v[2] * x + v[6] * y + v[10] * z + v[14]);
      if (vd + r < near) continue;
      let minX: number, maxX: number, minY: number, maxY: number;
      if (vd - r < near) {
        minX = minY = -1; maxX = maxY = 1;
      } else {
        const d0 = vd - r, d1 = vd + r;
        minX = Math.min((vx - r) / d0, (vx - r) / d1) * p0;
        maxX = Math.max((vx + r) / d0, (vx + r) / d1) * p0;
        minY = Math.min((vy - r) / d0, (vy - r) / d1) * p5;
        maxY = Math.max((vy + r) / d0, (vy + r) / d1) * p5;
      }
      if (maxX < -1 || maxY < -1 || minX > 1 || minY > 1) continue;
      const tx0 = Math.max(0, Math.floor((minX * 0.5 + 0.5) * DYN_TILES_X));
      const tx1 = Math.min(DYN_TILES_X - 1, Math.floor((maxX * 0.5 + 0.5) * DYN_TILES_X));
      const ty0 = Math.max(0, Math.floor((minY * 0.5 + 0.5) * DYN_TILES_Y));
      const ty1 = Math.min(DYN_TILES_Y - 1, Math.floor((maxY * 0.5 + 0.5) * DYN_TILES_Y));
      this.rect[i * 4] = tx0; this.rect[i * 4 + 1] = tx1; this.rect[i * 4 + 2] = ty0; this.rect[i * 4 + 3] = ty1;
      this.curI[i] = I;
      // importance: brightness over the area it lights, and the share of the screen it covers
      const area = (tx1 - tx0 + 1) * (ty1 - ty0 + 1);
      this.score[i] = I * this.prio[i] * Math.min(this.rad[i], 12) * (1 + Math.min(area, 64) / 16);
      cand[n++] = i;
    }
    this.stats.stored = this.used.length;
    this.stats.visible = n;
    const order = this.order;
    order.length = 0;
    for (let k = 0; k < n; k++) order.push(cand[k]);
    // most important first: over the cap, and in crowded tiles, the weakest lights are the ones dropped
    const sc = this.score;
    order.sort((a, b) => sc[b] - sc[a]);
    if (n > this.cap) order.length = this.cap;
    this.stats.drawn = order.length;
    this.stats.dropped = n - order.length;
    // light data + tiles
    const L = this.lightData, cap = this.cap;
    const T = this.tileData, tc = this.tileCount, tpt = this.texelsPerTile, mpt = this.maxPerTile;
    T.fill(0);
    tc.fill(0);
    let overflow = 0;
    const rowW = DYN_TILES_X * tpt * 4;
    for (let k = 0; k < order.length; k++) {
      const i = order[k];
      const I = this.curI[i];
      let o = k * 4;
      L[o] = this.px[i]; L[o + 1] = this.py[i]; L[o + 2] = this.pz[i]; L[o + 3] = this.rad[i];
      o += cap * 4;
      const spot = this.scos[i] > -1.5;
      L[o] = this.cr[i] * I; L[o + 1] = this.cg[i] * I; L[o + 2] = this.cb[i] * I; L[o + 3] = spot ? 1 : 0;
      o += cap * 4;
      L[o] = this.sdx[i]; L[o + 1] = this.sdy[i]; L[o + 2] = this.sdz[i]; L[o + 3] = this.scos[i];
      const tx0 = this.rect[i * 4], tx1 = this.rect[i * 4 + 1], ty0 = this.rect[i * 4 + 2], ty1 = this.rect[i * 4 + 3];
      for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          const t = ty * DYN_TILES_X + tx;
          const c = tc[t];
          if (c >= mpt) { overflow++; continue; }
          tc[t] = c + 1;
          T[ty * rowW + tx * tpt * 4 + c] = k + 1;
        }
      }
    }
    this.stats.tileOverflow = overflow;
    this.lightTex.needsUpdate = true;
    this.tileTex.needsUpdate = true;
  }

  dispose(): void {
    this.lightTex.dispose();
    this.tileTex.dispose();
    this.clear();
  }
}

/**
 * GLSL: dynamic light accumulation for a reconstructed surface point, plus the in-scattering of the
 * same lights along the view ray. Needs `#define DYN_LIGHTS` / `DYN_TEXELS` (DynamicLights.defines) and the
 * uniforms tDynLights, tDynTiles. `uv` is the screen uv (0..1).
 */
export const DYN_LIGHTS_GLSL = /* glsl */ `
#ifdef DYN_LIGHTS
uniform highp sampler2D tDynLights;
uniform sampler2D tDynTiles;
// any light in this pixel's tile?
bool dynAny(vec2 uv) {
  ivec2 t = ivec2(clamp(uv * vec2(${DYN_TILES_X}.0, ${DYN_TILES_Y}.0), vec2(0.0), vec2(${DYN_TILES_X - 1}.0, ${DYN_TILES_Y - 1}.0)));
  return texelFetch(tDynTiles, ivec2(t.x * DYN_TEXELS, t.y), 0).r > 0.0;
}
// Sum of light reaching surface point P (world) with normal N: colour * intensity * falloff * N.L.
// scatter accumulates the windowed in-scattering integral along the ray o + t rd, t in [0, T].
vec3 dynLight(vec2 uv, vec3 P, vec3 N, vec3 o, vec3 rd, float T, inout vec3 scatter) {
  ivec2 t = ivec2(clamp(uv * vec2(${DYN_TILES_X}.0, ${DYN_TILES_Y}.0), vec2(0.0), vec2(${DYN_TILES_X - 1}.0, ${DYN_TILES_Y - 1}.0)));
  vec3 sum = vec3(0.0);
  for (int k = 0; k < DYN_TEXELS; k++) {
    vec4 ids = texelFetch(tDynTiles, ivec2(t.x * DYN_TEXELS + k, t.y), 0);
    for (int c = 0; c < 4; c++) {
      int id = int(ids[c] * 255.0 + 0.5) - 1;
      if (id < 0) return sum;
      vec4 pr = texelFetch(tDynLights, ivec2(id, 0), 0);
      vec4 col = texelFetch(tDynLights, ivec2(id, 1), 0);
      float r = pr.w;
      vec3 Lv = pr.xyz - P;
      float d2 = dot(Lv, Lv);
      float spot = 1.0;
      if (col.w > 0.5) {
        vec4 sp = texelFetch(tDynLights, ivec2(id, 2), 0);
        spot = smoothstep(sp.w, mix(sp.w, 1.0, 0.35), dot(-Lv * inversesqrt(max(d2, 1e-6)), sp.xyz));
      }
      if (d2 < r * r && spot > 0.0) {
        float d = sqrt(d2);
        float w = clamp(1.0 - pow(d / r, 4.0), 0.0, 1.0);
        float fall = w * w / max(d2, 0.04);
        // wrapped N.L hides normal-reconstruction errors
        float ndl = clamp((dot(N, Lv / max(d, 1e-4)) + 0.2) / 1.2, 0.0, 1.0);
        sum += col.rgb * (fall * ndl * spot);
      }
      // in-scattering through the air in front of the surface (omni lights only)
      if (col.w < 0.5) {
        vec3 op = pr.xyz - o;
        float tc = dot(op, rd);
        float h2 = max(dot(op, op) - tc * tc, 0.0);
        if (h2 < r * r) {
          float hw = sqrt(r * r - h2);
          float ta = clamp(tc - hw, 0.0, T), tb = clamp(tc + hw, 0.0, T);
          if (tb > ta) {
            float h = sqrt(h2 + 0.09);
            float I = (atan((tb - tc) / h) - atan((ta - tc) / h)) / h - (tb - ta) / (r * r);
            scatter += col.rgb * max(I, 0.0);
          }
        }
      }
    }
  }
  return sum;
}
#endif
`;
