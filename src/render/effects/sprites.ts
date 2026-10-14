/**
 * Small dynamic sprite batch (one draw call) for things that follow a CPU-driven position every
 * frame: projectile bodies, exhaust flames, glows. Slots are allocated from a free list and the
 * used range is re-uploaded every frame (a few hundred sprites at most).
 *
 * A sprite is either a rotating billboard (axis = 0) or a quad stretched along a world axis
 * (texture +v points along the axis), e.g. a cannon slug streak or an exhaust flame.
 */
import * as THREE from 'three';
import { premultipliedMaterialFlags, quadGeometry } from './particles';

const STRIDE = 14;

const VERT = /* glsl */ `
precision highp float;
attribute vec3 aPos;
attribute vec3 aAxis;
attribute vec4 aData;   // size, frame, occlusion, rotation
attribute vec4 aColor;
varying vec2 vUv;
varying vec4 vColor;
varying float vOcc;
const float ATLAS = 4.0;
void main() {
  if (aData.x <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vColor = vec4(0.0); return; }
  vec4 mv = viewMatrix * vec4(aPos, 1.0);
  vec2 corner = position.xy;
  vec2 ax2 = (viewMatrix * vec4(aAxis, 0.0)).xy;
  float L = length(ax2);
  vec2 off;
  if (L > 1e-5) {
    vec2 ax = ax2 / L;
    vec2 pr = vec2(ax.y, -ax.x);
    off = pr * (corner.x * aData.x) + ax * (corner.y * (aData.x + 2.0 * L));
  } else {
    float c = cos(aData.w);
    float s = sin(aData.w);
    off = vec2(c * corner.x - s * corner.y, s * corner.x + c * corner.y) * aData.x;
  }
  mv.xy += off;
  gl_Position = projectionMatrix * mv;
  float f = aData.y;
  vec2 cell = vec2(mod(f, ATLAS), floor(f / ATLAS + 0.001));
  vUv = (cell + 0.5 + corner * 0.996) / ATLAS;
  vColor = aColor;
  vOcc = aData.z;
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uAtlas;
varying vec2 vUv;
varying vec4 vColor;
varying float vOcc;
void main() {
  vec4 tex = texture2D(uAtlas, vUv);
  float cov = tex.a * vColor.a;
  if (cov < 0.002) discard;
  gl_FragColor = vec4(tex.rgb * vColor.rgb * cov, cov * vOcc);
}
`;

export class SpriteBatch {
  readonly mesh: THREE.Mesh;
  readonly capacity: number;
  private geo: THREE.InstancedBufferGeometry;
  private buf: THREE.InstancedInterleavedBuffer;
  private data: Float32Array;
  private free: number[] = [];
  private highWater = 0;
  private dirty = false;

  constructor(capacity: number, atlas: THREE.Texture, renderOrder: number) {
    this.capacity = capacity;
    this.data = new Float32Array(capacity * STRIDE);
    for (let i = capacity - 1; i >= 0; i--) this.free.push(i);
    this.buf = new THREE.InstancedInterleavedBuffer(this.data, STRIDE, 1);
    this.buf.setUsage(THREE.DynamicDrawUsage);
    const g = new THREE.InstancedBufferGeometry();
    const q = quadGeometry();
    g.setAttribute('position', q.position);
    g.setIndex(q.index);
    const at = (name: string, size: number, off: number) => g.setAttribute(name, new THREE.InterleavedBufferAttribute(this.buf, size, off));
    at('aPos', 3, 0);
    at('aAxis', 3, 3);
    at('aData', 4, 6);
    at('aColor', 4, 10);
    g.instanceCount = 0;
    this.geo = g;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uAtlas: { value: atlas } },
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

  /** Returns a slot index or -1 if full. */
  alloc(): number {
    const i = this.free.pop();
    if (i === undefined) return -1;
    if (i + 1 > this.highWater) this.highWater = i + 1;
    this.data[i * STRIDE + 6] = 0;
    return i;
  }

  release(i: number): void {
    if (i < 0) return;
    this.data[i * STRIDE + 6] = 0;
    this.free.push(i);
    this.dirty = true;
  }

  set(
    i: number,
    x: number, y: number, z: number,
    axX: number, axY: number, axZ: number,
    size: number, frame: number, occ: number, rot: number,
    r: number, g: number, b: number, a: number,
  ): void {
    if (i < 0) return;
    const d = this.data;
    const o = i * STRIDE;
    d[o] = x; d[o + 1] = y; d[o + 2] = z;
    d[o + 3] = axX; d[o + 4] = axY; d[o + 5] = axZ;
    d[o + 6] = size; d[o + 7] = frame; d[o + 8] = occ; d[o + 9] = rot;
    d[o + 10] = r; d[o + 11] = g; d[o + 12] = b; d[o + 13] = a;
    this.dirty = true;
  }

  hide(i: number): void {
    if (i < 0) return;
    this.data[i * STRIDE + 6] = 0;
    this.dirty = true;
  }

  flush(): void {
    if (!this.dirty) return;
    this.buf.clearUpdateRanges();
    this.buf.addUpdateRange(0, this.highWater * STRIDE);
    this.buf.needsUpdate = true;
    this.geo.instanceCount = this.highWater;
    this.dirty = false;
  }

  dispose(): void {
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.removeFromParent();
  }
}
