/**
 * Ship wakes: foam trails on the water behind every moving ship (one draw call).
 *
 *   const wakes = new ShipWakes({ waterLevel: WATER_LEVEL, effects });
 *   scene.add(wakes.mesh);
 *   // every frame:
 *   wakes.update(ships, dt);   // ships: { x, y, heading, speed, size, id? }[] (map coords, like units)
 *
 * Each ship leaves a history of bow positions; the strip widens from the bow along the hull into a
 * spreading V (bright Kelvin-arm edges + churned propwash in the middle) and fades with age.
 * If `effects` is given, fast ships also throw bow spray particles.
 * Per frame cost: a few thousand floats written into a preallocated buffer, no allocations.
 */
import * as THREE from 'three';
import { WATER_LEVEL } from '../sim/map';

export interface WakeShip {
  /** map x (world X) */
  x: number;
  /** map y (world Z) */
  y: number;
  /** radians; the ship faces (cos heading, sin heading) in map space, like Unit.heading */
  heading: number;
  /** 0..1 fraction of max speed (Unit.speedFrac); 0 = stopped (trail fades out) */
  speed: number;
  /** hull length in cells (pt 0.9, dd 1.5, ca 2.35, lst 1.4, ss 1.3); submerged subs: pass a small size */
  size: number;
  /** stable id (Unit.id); without it ships are matched to trails by proximity */
  id?: number;
}

/** Anything that can throw bow spray (Effects implements this). */
export interface BowSprayFx {
  bowSpray(pos: THREE.Vector3, dirX: number, dirZ: number, amount: number, size?: number): void;
}

const N = 44; // points per trail
const SPACING = 0.09;
const LIFE = 4.2;

interface Slot {
  id: number;
  used: boolean;
  seen: boolean;
  /** ring buffer of points: x, z, spawn time, intensity */
  px: Float32Array;
  pz: Float32Array;
  pt: Float32Array;
  pi: Float32Array;
  head: number;
  n: number;
  // live ship (front point)
  x: number;
  z: number;
  fx: number;
  fz: number;
  size: number;
  speed: number;
  lastX: number;
  lastZ: number;
  sprayT: number;
}

const VERT = /* glsl */ `
attribute vec3 aInfo; // u (distance from bow), v (-1..1 across), alpha
varying vec3 vInfo;
varying vec2 vW;
void main() {
  vInfo = aInfo;
  vW = position.xz;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uTint;
varying vec3 vInfo;
varying vec2 vW;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  float u = vInfo.x;
  float v = abs(vInfo.y);
  float a = vInfo.z;
  if (a < 0.003) discard;
  float n = n2(vW * 6.0 + vec2(uTime * 0.3, -uTime * 0.22));
  float n3 = n2(vW * 14.0 - vec2(uTime * 0.5, uTime * 0.15));
  // Kelvin arms: crisp bright edges
  float edge = smoothstep(0.5, 0.86, v) * (1.0 - smoothstep(0.9, 1.0, v));
  // churned propwash right behind the hull, decaying down the trail
  float core = exp(-v * v * 5.0) * exp(-u * 0.55);
  // streaky foam lines between the arms
  float streak = 0.5 + 0.5 * sin(v * 17.0 + n * 3.5 + u * 0.7);
  float body = (1.0 - smoothstep(0.7, 1.0, v)) * 0.32 * streak;
  float foam = edge * (0.55 + 0.5 * n) + core * (0.55 + 0.7 * n3) + body * (0.35 + 0.65 * n3);
  foam *= 0.55 + 0.55 * n;
  // fade in over the first part under the hull
  foam *= smoothstep(0.0, 0.12, u);
  float cov = clamp(foam * a, 0.0, 1.0);
  if (cov < 0.004) discard;
  vec3 col = uTint * (0.85 + 0.15 * n3);
  gl_FragColor = vec4(col * cov, cov);
}
`;

export class ShipWakes {
  readonly mesh: THREE.Mesh;
  private geo: THREE.BufferGeometry;
  private pos: Float32Array;
  private info: Float32Array;
  private posAttr: THREE.BufferAttribute;
  private infoAttr: THREE.BufferAttribute;
  private mat: THREE.ShaderMaterial;
  private slots: Slot[] = [];
  private byId = new Map<number, Slot>();
  private time = 0;
  private readonly wl: number;
  private readonly fx: BowSprayFx | null;
  private readonly _v = new THREE.Vector3();

  constructor(opts: { waterLevel?: number; effects?: BowSprayFx | null; maxShips?: number } = {}) {
    this.wl = opts.waterLevel ?? WATER_LEVEL;
    this.fx = opts.effects ?? null;
    const max = opts.maxShips ?? 64;
    for (let i = 0; i < max; i++) {
      this.slots.push({
        id: -1, used: false, seen: false,
        px: new Float32Array(N), pz: new Float32Array(N), pt: new Float32Array(N), pi: new Float32Array(N),
        head: 0, n: 0, x: 0, z: 0, fx: 1, fz: 0, size: 1, speed: 0, lastX: 0, lastZ: 0, sprayT: 0,
      });
    }
    const verts = max * (N + 1) * 2;
    this.pos = new Float32Array(verts * 3);
    this.info = new Float32Array(verts * 3);
    const idx = new Uint32Array(max * N * 6);
    let k = 0;
    for (let s = 0; s < max; s++) {
      const b = s * (N + 1) * 2;
      for (let i = 0; i < N; i++) {
        const a0 = b + i * 2;
        idx[k++] = a0;
        idx[k++] = a0 + 2;
        idx[k++] = a0 + 1;
        idx[k++] = a0 + 1;
        idx[k++] = a0 + 2;
        idx[k++] = a0 + 3;
      }
    }
    this.geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.infoAttr = new THREE.BufferAttribute(this.info, 3);
    this.infoAttr.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.posAttr);
    this.geo.setAttribute('aInfo', this.infoAttr);
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geo.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uTint: { value: new THREE.Color(0.9, 0.94, 0.96) } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.name = 'ship-wakes';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.matrixAutoUpdate = false;
  }

  /** Foam colour / brightness (dim it at night, e.g. setTint(0.25, 0.3, 0.38)). */
  setTint(r: number, g: number, b: number): void {
    this.mat.uniforms.uTint.value.setRGB(r, g, b);
  }

  private slotFor(ship: WakeShip, index: number): Slot | null {
    if (ship.id !== undefined) {
      const s = this.byId.get(ship.id);
      if (s) return s;
    } else {
      // proximity match among unseen trails
      let best: Slot | null = null;
      let bd = 0.6 * 0.6;
      for (const s of this.slots) {
        if (!s.used || s.seen || s.id >= 0) continue;
        const d = (s.x - ship.x) ** 2 + (s.z - ship.y) ** 2;
        if (d < bd) {
          bd = d;
          best = s;
        }
      }
      if (best) return best;
    }
    for (const s of this.slots) {
      if (s.used) continue;
      s.used = true;
      s.id = ship.id ?? -1;
      s.n = 0;
      s.head = 0;
      s.lastX = ship.x;
      s.lastZ = ship.y;
      s.sprayT = 0;
      if (ship.id !== undefined) this.byId.set(ship.id, s);
      void index;
      return s;
    }
    return null;
  }

  update(ships: readonly WakeShip[], dt: number): void {
    if (!(dt > 0)) dt = 0;
    this.time += dt;
    const now = this.time;
    this.mat.uniforms.uTime.value = now;
    for (const s of this.slots) s.seen = false;
    for (let i = 0; i < ships.length; i++) {
      const sh = ships[i];
      const s = this.slotFor(sh, i);
      if (!s) continue;
      s.seen = true;
      const fx = Math.cos(sh.heading);
      const fz = Math.sin(sh.heading);
      const half = sh.size * 0.5;
      s.fx = fx;
      s.fz = fz;
      s.size = sh.size;
      // measured speed (cells/s) keeps trails right even if `speed` is coarse
      const mv = dt > 0 ? Math.hypot(sh.x - s.lastX, sh.y - s.lastZ) / dt : 0;
      s.lastX = sh.x;
      s.lastZ = sh.y;
      const sp = Math.max(Math.min(1, sh.speed), Math.min(1, mv / 1.2));
      s.speed = sp;
      // front point = bow
      s.x = sh.x + fx * half;
      s.z = sh.y + fz * half;
      const last = s.n > 0 ? (s.head - 1 + N) % N : -1;
      const far = last < 0 || Math.hypot(s.x - s.px[last], s.z - s.pz[last]) >= SPACING;
      if (sp > 0.05 && far) {
        s.px[s.head] = s.x;
        s.pz[s.head] = s.z;
        s.pt[s.head] = now;
        s.pi[s.head] = Math.min(1, 0.25 + sp);
        s.head = (s.head + 1) % N;
        if (s.n < N) s.n++;
      }
      // bow spray
      if (this.fx && sp > 0.35) {
        s.sprayT -= dt;
        if (s.sprayT <= 0) {
          s.sprayT = 0.09;
          this.fx.bowSpray(this._v.set(s.x - fx * 0.06 * sh.size, this.wl, s.z - fz * 0.06 * sh.size), fx, fz, (sp - 0.3) * 1.4, Math.min(1.6, 0.6 + sh.size * 0.4));
        }
      }
    }
    // release trails that are gone and fully faded
    for (const s of this.slots) {
      if (!s.used || s.seen) continue;
      const newest = s.n > 0 ? s.pt[(s.head - 1 + N) % N] : -1e9;
      if (now - newest > LIFE) {
        s.used = false;
        if (s.id >= 0) this.byId.delete(s.id);
        s.id = -1;
        s.n = 0;
      }
    }
    this.rebuild(now);
  }

  private rebuild(now: number): void {
    const P = this.pos;
    const I = this.info;
    const y = this.wl + 0.006;
    let block = 0;
    for (const s of this.slots) {
      if (!s.used || s.n === 0) continue;
      const base = block * (N + 1) * 2;
      // point 0 = live bow (only while the ship exists), then history newest -> oldest
      let cnt = 0;
      let px = 0;
      let pz = 0;
      let dist = 0;
      const halfBeam = 0.11 * Math.max(0.6, s.size);
      const total = s.seen ? s.n + 1 : s.n;
      for (let k = 0; k < N + 1; k++) {
        let x: number;
        let z: number;
        let alpha: number;
        if (k < total) {
          if (s.seen && k === 0) {
            x = s.x;
            z = s.z;
            alpha = Math.min(1, 0.25 + s.speed);
          } else {
            const j = (s.head - 1 - (s.seen ? k - 1 : k) + N * 2) % N;
            x = s.px[j];
            z = s.pz[j];
            const age = (now - s.pt[j]) / LIFE;
            // fade with age and over the last few points so the tail never ends in a hard edge
            alpha = s.pi[j] * Math.max(0, 1 - age) ** 1.6 * Math.min(1, (total - 1 - k) / 8);
          }
          if (cnt > 0) dist += Math.hypot(x - px, z - pz);
          cnt++;
        } else {
          // pad with the last point (zero-area quads)
          x = px;
          z = pz;
          alpha = 0;
        }
        // direction along the trail (toward older points)
        let dx: number;
        let dz: number;
        if (k + 1 < total) {
          const jn = (s.head - 1 - (s.seen ? k : k + 1) + N * 2) % N;
          dx = s.px[jn] - x;
          dz = s.pz[jn] - z;
        } else {
          dx = x - px;
          dz = z - pz;
        }
        const dl = Math.hypot(dx, dz);
        if (dl > 1e-5) {
          dx /= dl;
          dz /= dl;
        } else {
          dx = -s.fx;
          dz = -s.fz;
        }
        // width: hugs the hull from the bow, then spreads behind the stern
        const hullT = Math.min(1, dist / Math.max(0.2, s.size * 0.85));
        const w = halfBeam * (0.25 + 0.75 * Math.sqrt(hullT)) + Math.max(0, dist - s.size) * 0.17;
        const nx = -dz * w;
        const nz = dx * w;
        const o = (base + k * 2) * 3;
        P[o] = x + nx;
        P[o + 1] = y;
        P[o + 2] = z + nz;
        P[o + 3] = x - nx;
        P[o + 4] = y;
        P[o + 5] = z - nz;
        I[o] = dist;
        I[o + 1] = 1;
        I[o + 2] = alpha;
        I[o + 3] = dist;
        I[o + 4] = -1;
        I[o + 5] = alpha;
        if (k < total) {
          px = x;
          pz = z;
        }
      }
      block++;
    }
    const verts = block * (N + 1) * 2;
    this.geo.setDrawRange(0, block * N * 6);
    if (verts > 0) {
      this.posAttr.clearUpdateRanges();
      this.posAttr.addUpdateRange(0, verts * 3);
      this.posAttr.needsUpdate = true;
      this.infoAttr.clearUpdateRanges();
      this.infoAttr.addUpdateRange(0, verts * 3);
      this.infoAttr.needsUpdate = true;
    }
    this.mesh.visible = block > 0;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
    this.mesh.removeFromParent();
    this.byId.clear();
  }
}
