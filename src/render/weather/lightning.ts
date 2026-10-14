import * as THREE from 'three';
import { COLLAPSE } from './shaderlib';
import type { Rng } from './rng';

const MAX_QUADS = 1024;
const SPRITES = 3; // 0: bolt air glow, 1: bolt ground glow, 2: cloud flash glow
const MAIN_LEVELS = 7; // 129 points on the main channel
const MAX_PTS = (1 << MAIN_LEVELS) + 1;

const VERT = /* glsl */ `
attribute vec3 aA;
attribute vec3 aB;
attribute vec4 aInfo;     // x: width (world) / radius, y: brightness, z: type, w: progress from the cloud
uniform float uBoltEnv;
uniform float uCloudEnv;
uniform float uReveal;
uniform vec2 uRes;
varying vec2 vUv;
varying float vBright;
varying float vType;
varying float vCore;
void main() {
  float type = aInfo.z;
  float bright = aInfo.y * (type > 2.5 ? uCloudEnv : uBoltEnv);
  if (bright < 0.002 || (type < 0.5 && aInfo.w > uReveal)) { ${COLLAPSE}; return; }
  vType = type;
  vBright = bright;
  vCore = 0.0;
  if (type < 0.5) {
    // jagged channel segment as a screen-space ribbon: thin HDR core + soft halo
    vec4 va = viewMatrix * vec4(aA, 1.0);
    vec4 vb = viewMatrix * vec4(aB, 1.0);
    const float zn = -0.8;
    if (va.z > zn && vb.z > zn) { ${COLLAPSE}; return; }
    if (va.z > zn) va = mix(va, vb, (va.z - zn) / (va.z - vb.z));
    if (vb.z > zn) vb = mix(vb, va, (vb.z - zn) / (vb.z - va.z));
    vec4 c0 = projectionMatrix * va;
    vec4 c1 = projectionMatrix * vb;
    vec2 hr = uRes * 0.5;
    vec2 s0 = c0.xy / c0.w * hr;
    vec2 s1 = c1.xy / c1.w * hr;
    vec2 d = s1 - s0;
    float len = length(d);
    vec2 dir = len > 1e-3 ? d / len : vec2(0.0, 1.0);
    vec2 nrm = vec2(-dir.y, dir.x);
    bool head = position.x < 0.5;
    vec4 c = head ? c0 : c1;
    float corePx = max(0.5 * aInfo.x * projectionMatrix[1][1] * hr.y / c.w, 0.75);
    float hw = corePx * 6.0 + 4.0;
    vCore = corePx / hw;
    vec2 sp = (head ? s0 - dir * corePx : s1 + dir * corePx) + nrm * (position.y * hw);
    gl_Position = vec4(sp / hr * c.w, c.z, c.w);
    vUv = vec2(position.x, position.y);
  } else {
    vec2 q = vec2(position.x * 2.0 - 1.0, position.y);
    vec3 world;
    if (type > 1.5 && type < 2.5) {
      world = aA + vec3(q.x, 0.0, q.y) * aInfo.x;
    } else {
      vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
      vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
      world = aA + (right * q.x + up * q.y) * aInfo.x;
    }
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
    vUv = q;
  }
}
`;

const FRAG = /* glsl */ `
uniform vec3 uCore;
uniform vec3 uGlow;
uniform vec3 uCloud;
varying vec2 vUv;
varying float vBright;
varying float vType;
varying float vCore;
void main() {
  vec3 col;
  if (vType < 0.5) {
    float s = abs(vUv.y);
    float core = 1.0 - smoothstep(vCore * 0.5, vCore * 1.3, s);
    float glow = exp(-s * 5.0) * 0.45 + exp(-s * s * 60.0) * 0.8;
    col = uCore * core + uGlow * glow;
  } else {
    float r = length(vUv);
    float g = max(0.0, 1.0 - r);
    if (vType > 2.5) col = uCloud * g * g;
    else if (vType > 1.5) col = uGlow * (g * g * 0.8 + pow(max(0.0, 1.0 - r * 3.0), 2.0) * 3.0);
    else col = uGlow * g * g * g;
  }
  gl_FragColor = vec4(col * vBright, 0.0);
}
`;

interface Stroke {
  t: number;
  amp: number;
}

/** Lightning bolts (sky to ground, branching) and cloud-to-cloud flashes. */
export class Lightning {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  readonly geometry: THREE.BufferGeometry;
  private aA: THREE.BufferAttribute;
  private aB: THREE.BufferAttribute;
  private aI: THREE.BufferAttribute;
  private quads = SPRITES;
  private pa = new Float32Array(MAX_PTS * 3);
  private pb = new Float32Array(MAX_PTS * 3);
  private main = new Float32Array(MAX_PTS * 3);
  private branch = new Float32Array(MAX_PTS * 3);
  private branchTmp = new Float32Array(MAX_PTS * 3);
  private strokes: Stroke[] = [{ t: 0, amp: 0 }, { t: 0, amp: 0 }, { t: 0, amp: 0 }, { t: 0, amp: 0 }];
  private nStrokes = 0;
  private cloudStrokes: Stroke[] = [{ t: 0, amp: 0 }, { t: 0, amp: 0 }, { t: 0, amp: 0 }];
  private nCloud = 0;
  boltAge = 99;
  cloudAge = 99;
  boltIntensity = 0;
  cloudIntensity = 0;
  readonly uniforms: {
    uBoltEnv: { value: number };
    uCloudEnv: { value: number };
    uReveal: { value: number };
    uRes: { value: THREE.Vector2 };
    uCore: { value: THREE.Color };
    uGlow: { value: THREE.Color };
    uCloud: { value: THREE.Color };
  };

  constructor(res: THREE.Vector2) {
    const g = new THREE.BufferGeometry();
    const nv = MAX_QUADS * 4;
    const corner = new Float32Array(nv * 3);
    const idx = new Uint16Array(MAX_QUADS * 6);
    for (let q = 0; q < MAX_QUADS; q++) {
      const v = q * 4;
      corner.set([0, -1, 0, 0, 1, 0, 1, -1, 0, 1, 1, 0], v * 3);
      idx.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], q * 6);
    }
    g.setAttribute('position', new THREE.BufferAttribute(corner, 3));
    this.aA = new THREE.BufferAttribute(new Float32Array(nv * 3), 3);
    this.aB = new THREE.BufferAttribute(new Float32Array(nv * 3), 3);
    this.aI = new THREE.BufferAttribute(new Float32Array(nv * 4), 4);
    this.aA.setUsage(THREE.DynamicDrawUsage);
    this.aB.setUsage(THREE.DynamicDrawUsage);
    this.aI.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aA', this.aA);
    g.setAttribute('aB', this.aB);
    g.setAttribute('aInfo', this.aI);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.setDrawRange(0, SPRITES * 6);
    this.geometry = g;
    this.uniforms = {
      uBoltEnv: { value: 0 },
      uCloudEnv: { value: 0 },
      uReveal: { value: 2 },
      uRes: { value: res },
      uCore: { value: new THREE.Color(9.0, 9.5, 12.0) },
      uGlow: { value: new THREE.Color(0.55, 0.62, 1.35) },
      uCloud: { value: new THREE.Color(0.45, 0.5, 0.78) },
    };
    this.material = new THREE.ShaderMaterial({
      name: 'weather-lightning',
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      premultipliedAlpha: true,
      blending: THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.visible = false;
    this.mesh.name = 'weather-lightning';
  }

  private writeQuad(q: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, w: number, bright: number, type: number, prog: number): void {
    const A = this.aA.array as Float32Array, B = this.aB.array as Float32Array, I = this.aI.array as Float32Array;
    for (let c = 0; c < 4; c++) {
      const v = q * 4 + c;
      A[v * 3] = ax; A[v * 3 + 1] = ay; A[v * 3 + 2] = az;
      B[v * 3] = bx; B[v * 3 + 1] = by; B[v * 3 + 2] = bz;
      I[v * 4] = w; I[v * 4 + 1] = bright; I[v * 4 + 2] = type; I[v * 4 + 3] = prog;
    }
  }

  /** Midpoint-displacement path from p0 to p1 written into `out`; returns the number of points. */
  private path(out: Float32Array, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, levels: number, rough: number, rng: Rng): number {
    let src = this.pa, dst = this.pb;
    src[0] = x0; src[1] = y0; src[2] = z0;
    src[3] = x1; src[4] = y1; src[5] = z1;
    let n = 2;
    for (let l = 0; l < levels; l++) {
      let m = 0;
      for (let i = 0; i < n - 1; i++) {
        const ax = src[i * 3], ay = src[i * 3 + 1], az = src[i * 3 + 2];
        const bx = src[i * 3 + 3], by = src[i * 3 + 4], bz = src[i * 3 + 5];
        dst[m * 3] = ax; dst[m * 3 + 1] = ay; dst[m * 3 + 2] = az;
        m++;
        let dx = bx - ax, dy = by - ay, dz = bz - az;
        const len = Math.hypot(dx, dy, dz) || 1;
        dx /= len; dy /= len; dz /= len;
        // random vector perpendicular to the segment
        let rx = rng.spread(1), ry = rng.spread(1), rz = rng.spread(1);
        const dot = rx * dx + ry * dy + rz * dz;
        rx -= dot * dx; ry -= dot * dy; rz -= dot * dz;
        const s = len * (l < 2 ? rough * 0.35 : rough);
        dst[m * 3] = (ax + bx) * 0.5 + rx * s;
        dst[m * 3 + 1] = (ay + by) * 0.5 + ry * s;
        dst[m * 3 + 2] = (az + bz) * 0.5 + rz * s;
        m++;
      }
      dst[m * 3] = src[(n - 1) * 3]; dst[m * 3 + 1] = src[(n - 1) * 3 + 1]; dst[m * 3 + 2] = src[(n - 1) * 3 + 2];
      m++;
      const t = src; src = dst; dst = t;
      n = m;
    }
    out.set(src.subarray(0, n * 3));
    return n;
  }

  private emitPath(pts: Float32Array, n: number, width: number, bright: number, fade: number, prog0: number, prog1: number): void {
    for (let i = 0; i < n - 1 && this.quads < MAX_QUADS; i++) {
      const t = i / (n - 1);
      this.writeQuad(this.quads++, pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2], pts[i * 3 + 3], pts[i * 3 + 4], pts[i * 3 + 5],
        width * (1 - 0.5 * fade * t), bright * (1 - fade * t * 0.75), 0, prog0 + (prog1 - prog0) * t);
    }
  }

  /** Build a new bolt from (tx,ty,tz) in the sky down to the ground point (gx,gy,gz). */
  strike(tx: number, ty: number, tz: number, gx: number, gy: number, gz: number, intensity: number, rng: Rng): void {
    this.quads = SPRITES;
    const n = this.path(this.main, tx, ty, tz, gx, gy, gz, MAIN_LEVELS, 0.3, rng);
    this.emitPath(this.main, n, 0.085, 1, 0, 0, 1);
    // forks: thinner, dimmer channels that die out in mid-air
    const nb = 4 + Math.floor(rng.next() * 6);
    for (let b = 0; b < nb; b++) {
      const i = Math.floor((0.05 + rng.next() * 0.72) * (n - 8));
      const px = this.main[i * 3], py = this.main[i * 3 + 1], pz = this.main[i * 3 + 2];
      let dx = this.main[(i + 6) * 3] - px, dy = this.main[(i + 6) * 3 + 1] - py, dz = this.main[(i + 6) * 3 + 2] - pz;
      const dl = Math.hypot(dx, dy, dz) || 1;
      dx = dx / dl + rng.spread(1.0); dy = dy / dl - 0.25 + rng.spread(0.3); dz = dz / dl + rng.spread(1.0);
      const l2 = Math.hypot(dx, dy, dz) || 1;
      const len = Math.max(2, (py - gy) * rng.range(0.18, 0.5));
      const ex = px + (dx / l2) * len, ey = Math.max(gy + 1, py + (dy / l2) * len), ez = pz + (dz / l2) * len;
      const prog0 = i / (n - 1);
      const m = this.path(this.branch, px, py, pz, ex, ey, ez, 5, 0.32, rng);
      const bright = rng.range(0.35, 0.65);
      this.emitPath(this.branch, m, 0.045, bright, 1, prog0, prog0 + len / Math.max(1, ty - gy));
      // a sub-fork now and then
      if (rng.next() < 0.6) {
        const j = Math.floor(rng.range(0.2, 0.6) * (m - 1));
        const qx = this.branch[j * 3], qy = this.branch[j * 3 + 1], qz = this.branch[j * 3 + 2];
        const l3 = len * rng.range(0.3, 0.55);
        const fx = qx + rng.spread(l3 * 0.8), fy = Math.max(gy + 0.8, qy - l3 * rng.range(0.3, 0.8)), fz = qz + rng.spread(l3 * 0.8);
        const k = this.path(this.branchTmp, qx, qy, qz, fx, fy, fz, 4, 0.33, rng);
        const p0 = prog0 + (j / (m - 1)) * (len / Math.max(1, ty - gy));
        this.emitPath(this.branchTmp, k, 0.03, bright * 0.55, 1, p0, p0 + l3 / Math.max(1, ty - gy));
      }
    }
    // glow sprites: a soft halo in the air around the lower channel and a hot spot on the ground
    const k = Math.floor((n - 1) * 0.72);
    const glowR = Math.max(3, Math.min(6, Math.hypot(tx - gx, ty - gy, tz - gz) * 0.2));
    this.writeQuad(0, this.main[k * 3], this.main[k * 3 + 1], this.main[k * 3 + 2], 0, 0, 0, glowR, 0.32, 1, 0);
    this.writeQuad(1, gx, gy + 0.06, gz, 0, 0, 0, 3.2, 1.0, 2, 0);
    this.upload();
    this.boltAge = 0;
    this.boltIntensity = intensity;
    // return strokes along the same channel: the classic flicker
    const s = this.strokes;
    s[0].t = 0.035; s[0].amp = 1;
    s[1].t = s[0].t + rng.range(0.05, 0.09); s[1].amp = rng.range(0.45, 0.8);
    s[2].t = s[1].t + rng.range(0.05, 0.1); s[2].amp = rng.range(0.5, 0.95);
    s[3].t = s[2].t + rng.range(0.06, 0.12); s[3].amp = rng.range(0.2, 0.5);
    this.nStrokes = rng.next() < 0.3 ? 2 : rng.next() < 0.7 ? 3 : 4;
  }

  /** A flash inside the clouds (no bolt): a large soft glow at (x,y,z). */
  cloudFlash(x: number, y: number, z: number, radius: number, intensity: number, rng: Rng): void {
    this.writeQuad(2, x, y, z, 0, 0, 0, radius, 1, 3, 0);
    this.upload(true);
    this.cloudAge = 0;
    this.cloudIntensity = intensity;
    const s = this.cloudStrokes;
    s[0].t = 0; s[0].amp = rng.range(0.6, 1);
    s[1].t = rng.range(0.08, 0.18); s[1].amp = rng.range(0.4, 1);
    s[2].t = s[1].t + rng.range(0.1, 0.25); s[2].amp = rng.range(0.2, 0.6);
    this.nCloud = 1 + Math.floor(rng.next() * 3);
  }

  private upload(spritesOnly = false): void {
    const nq = spritesOnly ? SPRITES : this.quads;
    Lightning.mark(this.aA, nq);
    Lightning.mark(this.aB, nq);
    Lightning.mark(this.aI, nq);
    if (!spritesOnly) this.geometry.setDrawRange(0, this.quads * 6);
  }

  private static mark(a: THREE.BufferAttribute, quads: number): void {
    a.addUpdateRange(0, quads * 4 * a.itemSize); // three clears the ranges after uploading
    a.needsUpdate = true;
  }

  private static env(strokes: Stroke[], n: number, age: number, decay: number): number {
    let e = 0;
    for (let i = 0; i < n; i++) {
      const dt = age - strokes[i].t;
      if (dt >= 0) e += strokes[i].amp * Math.exp(-dt * decay);
    }
    return e;
  }

  /** Advance envelopes; returns the scene flash value (0..1). */
  update(dt: number): number {
    this.boltAge += dt;
    this.cloudAge += dt;
    let boltEnv = 0, flash = 0;
    if (this.boltAge < 1.2) {
      const a = this.boltAge;
      // stepped leader: a dim channel races to the ground before the first return stroke
      const lead = Math.min(1, a / this.strokes[0].t);
      boltEnv = Math.min(1.6, Lightning.env(this.strokes, this.nStrokes, a, 24)) + (a < this.strokes[0].t ? 0.18 * lead : 0);
      this.uniforms.uReveal.value = a < this.strokes[0].t ? lead : 2;
      flash = Math.min(1, Lightning.env(this.strokes, this.nStrokes, a, 7.5)) * this.boltIntensity;
      boltEnv *= this.boltIntensity;
    }
    let cloudEnv = 0;
    if (this.cloudAge < 1.5) {
      cloudEnv = Math.min(1.3, Lightning.env(this.cloudStrokes, this.nCloud, this.cloudAge, 11)) * this.cloudIntensity;
      flash = Math.max(flash, Math.min(1, Lightning.env(this.cloudStrokes, this.nCloud, this.cloudAge, 6)) * this.cloudIntensity);
    }
    this.uniforms.uBoltEnv.value = boltEnv;
    this.uniforms.uCloudEnv.value = cloudEnv;
    this.mesh.visible = boltEnv > 0.004 || cloudEnv > 0.004;
    if (boltEnv <= 0.004) this.geometry.setDrawRange(0, SPRITES * 6);
    return Math.min(1, flash);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
