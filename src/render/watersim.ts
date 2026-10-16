import * as THREE from 'three';

const MAX_DROPS = 32;

const SIM_VS = /* glsl */ `
in vec3 position;
void main() { gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }`;

const SIM_FS = /* glsl */ `
precision highp float;
precision highp sampler2D;
uniform sampler2D tPrev;
uniform ivec2 uShift;
uniform vec2 uOrigin;
uniform float uTexel, uAlpha, uDamp;
uniform vec4 uDrops[${MAX_DROPS}];
uniform int uDropN;
uniform ivec2 uRes;
out vec4 o;
float hAt(ivec2 c) {
  if (c.x < 0 || c.y < 0 || c.x >= uRes.x || c.y >= uRes.y) return 0.0;
  return texelFetch(tPrev, c, 0).r;
}
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  ivec2 s = c + uShift;
  vec2 cur = (s.x < 0 || s.y < 0 || s.x >= uRes.x || s.y >= uRes.y) ? vec2(0.0) : texelFetch(tPrev, s, 0).rg;
  float lap = hAt(s + ivec2(1, 0)) + hAt(s - ivec2(1, 0)) + hAt(s + ivec2(0, 1)) + hAt(s - ivec2(0, 1)) - 4.0 * cur.r;
  float h = (2.0 * cur.r - cur.g + uAlpha * lap) * uDamp;
  vec2 wp = uOrigin + (vec2(c) + 0.5) * uTexel;
  for (int i = 0; i < ${MAX_DROPS}; i++) {
    if (i >= uDropN) break;
    vec4 d = uDrops[i];
    vec2 dd = wp - d.xy;
    h += d.z * exp(-dot(dd, dd) / (d.w * d.w));
  }
  // absorb at the borders of the simulated window
  vec2 e = min(vec2(c), vec2(uRes - 1) - vec2(c)) / 10.0;
  h *= clamp(min(e.x, e.y), 0.0, 1.0);
  o = vec4(clamp(h, -2.0, 2.0), cur.r, 0.0, 1.0);
}`;

/**
 * Interactive water surface: a heightfield wave simulation in a window that follows the camera (high
 * quality). Ships push the surface at their bows every frame (Kelvin-like wakes emerge from the wave
 * equation), shells and splashes drop rings in (Water.addRipple). The water shader reads the height field
 * for normals and foam. One small draw per frame, and none once the surface has calmed down.
 */
export class RippleSim {
  readonly size: number;
  readonly res: number;
  /** World x, z of the window's corner (snapped to whole texels). */
  readonly origin = new THREE.Vector2(-1e4, -1e4);
  private rts: THREE.WebGLRenderTarget[];
  private cur = 0;
  private mat: THREE.RawShaderMaterial;
  private quad: THREE.Mesh;
  private scene = new THREE.Scene();
  private cam = new THREE.Camera();
  private drops: THREE.Vector4[] = [];
  private dropN = 0;
  private quietT = 99;
  private cleared = false;
  /** Draw calls of the last update (0 when calm). */
  calls = 0;

  constructor(res = 256, size = 48) {
    this.res = res;
    this.size = size;
    const mk = () => new THREE.WebGLRenderTarget(res, res, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
    });
    this.rts = [mk(), mk()];
    for (let i = 0; i < MAX_DROPS; i++) this.drops.push(new THREE.Vector4());
    this.mat = new THREE.RawShaderMaterial({
      name: 'water-ripples',
      glslVersion: THREE.GLSL3,
      uniforms: {
        tPrev: { value: null },
        uShift: { value: new THREE.Vector2() },
        uOrigin: { value: new THREE.Vector2() },
        uTexel: { value: size / res },
        uAlpha: { value: 0.1 },
        uDamp: { value: 0.99 },
        uDrops: { value: this.drops },
        uDropN: { value: 0 },
        uRes: { value: new THREE.Vector2(res, res) },
      },
      vertexShader: SIM_VS,
      fragmentShader: SIM_FS,
      depthTest: false,
      depthWrite: false,
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 1.5, -0.5, 0, -0.5, 1.5, 0], 3));
    this.quad = new THREE.Mesh(g, this.mat);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  get texture(): THREE.Texture {
    return this.rts[this.cur].texture;
  }

  /** Is anything moving on the surface (should the water read the field)? */
  get active(): boolean {
    return this.quietT < 8;
  }

  /** Push the surface at (x, z): strength > 0 lifts, < 0 depresses; radius in world units. */
  drop(x: number, z: number, strength: number, radius: number) {
    if (this.dropN >= MAX_DROPS) return;
    const s = this.size;
    if (x < this.origin.x - 2 || z < this.origin.y - 2 || x > this.origin.x + s + 2 || z > this.origin.y + s + 2) return;
    this.drops[this.dropN++].set(x, z, strength, Math.max(radius, this.size / this.res));
    this.quietT = 0;
  }

  /** Step the simulation; the window re-centres on (cx, cz) in whole-texel steps. */
  update(renderer: THREE.WebGLRenderer, cx: number, cz: number, dt: number) {
    this.calls = 0;
    const texel = this.size / this.res;
    const ox = Math.round((cx - this.size / 2) / texel) * texel, oz = Math.round((cz - this.size / 2) / texel) * texel;
    const sx = Math.round((ox - this.origin.x) / texel), sz = Math.round((oz - this.origin.y) / texel);
    const moved = sx !== 0 || sz !== 0;
    this.origin.set(ox, oz);
    this.quietT += dt;
    if (!this.active || dt <= 0) {
      this.dropN = 0;
      return;
    }
    const prevTarget = renderer.getRenderTarget();
    const prevAuto = renderer.autoClear;
    renderer.autoClear = false;
    if (!this.cleared) {
      const c = renderer.getClearColor(new THREE.Color()), a = renderer.getClearAlpha();
      renderer.setClearColor(0x000000, 0);
      for (const rt of this.rts) { renderer.setRenderTarget(rt); renderer.clear(true, false, false); }
      renderer.setClearColor(c, a);
      this.cleared = true;
    }
    const u = this.mat.uniforms;
    u.tPrev.value = this.rts[this.cur].texture;
    // a big jump (minimap click) restarts the window
    u.uShift.value.set(moved && Math.abs(sx) + Math.abs(sz) > this.res / 2 ? 1e5 : sx, sz);
    u.uOrigin.value.copy(this.origin);
    // wave speed ~1.6 world units / s, stable for any frame time
    const c = 1.6;
    u.uAlpha.value = Math.min(0.45, Math.pow((c * Math.min(dt, 0.05)) / texel, 2));
    u.uDamp.value = Math.pow(0.55, Math.min(dt, 0.05));
    u.uDropN.value = this.dropN;
    renderer.setRenderTarget(this.rts[1 - this.cur]);
    renderer.render(this.scene, this.cam);
    this.calls = 1;
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAuto;
    this.cur = 1 - this.cur;
    this.dropN = 0;
  }

  /** Compile the program now (shader warm-up). */
  warmUp(renderer: THREE.WebGLRenderer) {
    this.quietT = 0;
    this.update(renderer, 0, 0, 1 / 60);
    this.quietT = 99;
  }

  dispose() {
    for (const rt of this.rts) rt.dispose();
    this.mat.dispose();
    this.quad.geometry.dispose();
  }
}
