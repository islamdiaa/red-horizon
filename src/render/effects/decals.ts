/**
 * Ground decals (scorch marks, splats): one draw call, ring buffer of up to `capacity` decals.
 * Each decal is a 5x5 vertex grid whose vertices follow the terrain height (sampled once at spawn),
 * lifted slightly plus polygonOffset to avoid z-fighting. Rendered with multiply blending so they
 * darken whatever ground colour is underneath. Fading is done on the GPU from spawn time.
 */
import * as THREE from 'three';

const GRID = 5; // vertices per side
const VPD = GRID * GRID; // vertices per decal
const LIFT = 0.025;

const VERT = /* glsl */ `
precision highp float;
uniform float uTime;
attribute vec2 aUv;
attribute vec4 aInfo; // spawnTime, life, intensity, frame
varying vec2 vUv;
varying vec2 vCell;
varying float vAlpha;
void main() {
  float age = uTime - aInfo.x;
  if (age < 0.0 || age >= aInfo.y) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vAlpha = 0.0; return; }
  vAlpha = aInfo.z * smoothstep(0.0, 0.12, age) * (1.0 - smoothstep(aInfo.y * 0.45, aInfo.y, age));
  vUv = aUv;
  vCell = vec2(mod(aInfo.w, 2.0), floor(aInfo.w / 2.0 + 0.001));
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uDecals;
varying vec2 vUv;
varying vec2 vCell;
varying float vAlpha;
void main() {
  if (abs(vUv.x) > 0.499 || abs(vUv.y) > 0.499) discard;
  vec4 tex = texture2D(uDecals, (vCell + 0.5 + vUv) / 2.0);
  float a = tex.a * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(mix(vec3(1.0), tex.rgb, a), 1.0);
}
`;

export class DecalSystem {
  /**
   * Height of the rendered (possibly cratered) ground; when set it replaces the sim heightfield for new
   * decals so scorch marks lie inside craters. The destruction system installs it with the terrain.
   */
  static terrainHeight: ((x: number, z: number) => number) | null = null;
  readonly mesh: THREE.Mesh;
  readonly capacity: number;
  private pos: Float32Array;
  private uv: Float32Array;
  private info: Float32Array;
  private posAttr: THREE.BufferAttribute;
  private uvAttr: THREE.BufferAttribute;
  private infoAttr: THREE.BufferAttribute;
  private head = 0;
  private dirtyMin = Infinity;
  private dirtyMax = -1;
  now = 0;

  constructor(capacity: number, tex: THREE.Texture, private getHeight: (x: number, z: number) => number, uniforms: { uTime: { value: number } }, renderOrder: number) {
    this.capacity = capacity;
    const nv = capacity * VPD;
    this.pos = new Float32Array(nv * 3);
    this.uv = new Float32Array(nv * 2);
    this.info = new Float32Array(nv * 4);
    for (let i = 0; i < nv; i++) this.info[i * 4] = -1e6;
    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.uvAttr = new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage);
    this.infoAttr = new THREE.BufferAttribute(this.info, 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('aUv', this.uvAttr);
    g.setAttribute('aInfo', this.infoAttr);
    const idx: number[] = [];
    for (let d = 0; d < capacity; d++) {
      const b = d * VPD;
      for (let j = 0; j < GRID - 1; j++) {
        for (let i = 0; i < GRID - 1; i++) {
          const a = b + j * GRID + i;
          idx.push(a, a + GRID, a + 1, a + 1, a + GRID, a + GRID + 1);
        }
      }
    }
    g.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: uniforms.uTime, uDecals: { value: tex } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.ZeroFactor,
      blendDst: THREE.SrcColorFactor,
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.matrixAutoUpdate = false;
  }

  /**
   * Add a decal centred at (x, z). size = full width in world units.
   * frame: decal atlas frame; intensity: 0..1 darkness; life: seconds; delay: seconds before it appears.
   * Returns its slot (ring buffer: the oldest decal is replaced).
   */
  add(x: number, z: number, size: number, frame: number, intensity: number, life: number, rot: number, delay = 0): number {
    const d = this.head;
    this.head = (this.head + 1) % this.capacity;
    this.write(d, x, z, size, frame, intensity, life, rot, delay);
    return d;
  }

  /** Write a decal into a given slot (persistent layers manage their own slots, see scars.ts). */
  write(d: number, x: number, z: number, size: number, frame: number, intensity: number, life: number, rot: number, delay = 0): void {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const t0 = this.now + delay;
    const hf = DecalSystem.terrainHeight ?? this.getHeight;
    for (let j = 0; j < GRID; j++) {
      const lz = j / (GRID - 1) - 0.5;
      for (let i = 0; i < GRID; i++) {
        const lx = i / (GRID - 1) - 0.5;
        const v = d * VPD + j * GRID + i;
        const wx = x + lx * size;
        const wz = z + lz * size;
        this.pos[v * 3] = wx;
        this.pos[v * 3 + 1] = hf(wx, wz) + LIFT;
        this.pos[v * 3 + 2] = wz;
        this.uv[v * 2] = c * lx - s * lz;
        this.uv[v * 2 + 1] = s * lx + c * lz;
        this.info[v * 4] = t0;
        this.info[v * 4 + 1] = life;
        this.info[v * 4 + 2] = intensity;
        this.info[v * 4 + 3] = frame;
      }
    }
    this.markDirty(d);
  }

  /**
   * Fade a decal out over `fade` seconds from now (its fade-out curve restarted at full strength), e.g. before
   * its slot is reused.
   */
  retire(d: number, fade: number): void {
    if (d < 0 || d >= this.capacity) return;
    const L = Math.max(0.3, fade) / 0.55;
    const t0 = this.now - 0.45 * L;
    for (let v = d * VPD; v < (d + 1) * VPD; v++) {
      this.info[v * 4] = t0;
      this.info[v * 4 + 1] = L;
    }
    this.markDirty(d);
  }

  /** Change a decal's darkness (0..1). */
  setIntensity(d: number, intensity: number): void {
    if (d < 0 || d >= this.capacity) return;
    for (let v = d * VPD; v < (d + 1) * VPD; v++) this.info[v * 4 + 2] = intensity;
    this.markDirty(d);
  }

  private markDirty(d: number): void {
    if (d < this.dirtyMin) this.dirtyMin = d;
    if (d > this.dirtyMax) this.dirtyMax = d;
  }

  flush(): void {
    if (this.dirtyMax < 0) return;
    const v0 = this.dirtyMin * VPD;
    const nv = (this.dirtyMax - this.dirtyMin + 1) * VPD;
    this.posAttr.addUpdateRange(v0 * 3, nv * 3);
    this.uvAttr.addUpdateRange(v0 * 2, nv * 2);
    this.infoAttr.addUpdateRange(v0 * 4, nv * 4);
    this.posAttr.needsUpdate = true;
    this.uvAttr.needsUpdate = true;
    this.infoAttr.needsUpdate = true;
    this.dirtyMin = Infinity;
    this.dirtyMax = -1;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.removeFromParent();
  }
}
