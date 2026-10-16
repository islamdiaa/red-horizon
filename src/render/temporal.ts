import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

/** Halton(2, 3) sub-pixel offsets in [-0.5, 0.5), 8 phases. */
const JITTER: [number, number][] = [];
for (let i = 1; i <= 8; i++) {
  const h = (b: number) => { let f = 1, r = 0, k = i; while (k > 0) { f /= b; r += f * (k % b); k = Math.floor(k / b); } return r; };
  JITTER.push([h(2) - 0.5, h(3) - 0.5]);
}

/**
 * Temporal anti-aliasing with optional upscaling (high quality).
 *
 * The scene is rendered with a sub-pixel jittered projection (8-phase Halton) at the render resolution,
 * which may be lower than the display (dynamic resolution). This pass resolves at display resolution:
 * every pixel reprojects its world position (scene depth) into last frame's view, fetches the history with a
 * Catmull-Rom filter, clips it against the current neighbourhood's colour distribution (YCoCg variance
 * clipping: no ghosting on moving units, particles or camera cuts) and blends in the new jittered sample.
 * The final pass then sharpens (contrast-adaptive) to win back what the resolve softened.
 *
 * Usage per frame: `jitter(camera)` before the scene renders, the pass inside the composer, then
 * `unjitter(camera)` once the frame is done (picking / overlays see the clean projection).
 */
export class TemporalPass extends Pass {
  readonly material: THREE.ShaderMaterial;
  private quad: FullScreenQuad;
  private hist: THREE.WebGLRenderTarget[];
  private cur = 0;
  private phase = 0;
  private prevViewProj = new THREE.Matrix4();
  private savedProj = new THREE.Matrix4();
  private savedProjInv = new THREE.Matrix4();
  private jittered = false;
  private valid = false;
  private lastCam = new THREE.Vector3();
  /** Current colour (render resolution) and scene depth. */
  inputSource: (() => THREE.Texture | null) | null = null;
  depthSource: (() => THREE.Texture | null) | null = null;
  /** Render resolution in pixels (set by the renderer). */
  readonly renderSize = new THREE.Vector2(1, 1);
  /** Force a history reset on the next frame (camera cut, resize). */
  reset = true;
  enabled = true;

  constructor(private camera: THREE.PerspectiveCamera) {
    super();
    this.needsSwap = false;
    const mk = () => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
    this.hist = [mk(), mk()];
    this.material = new THREE.ShaderMaterial({
      name: 'taa',
      uniforms: {
        tCurrent: { value: null },
        tDepth: { value: null },
        tHistory: { value: null },
        uPrevViewProj: { value: new THREE.Matrix4() },
        uProjInv: { value: new THREE.Matrix4() },
        uCamWorld: { value: new THREE.Matrix4() },
        uJitterUv: { value: new THREE.Vector2() },
        uSrcTexel: { value: new THREE.Vector2(1, 1) },
        uDstTexel: { value: new THREE.Vector2(1, 1) },
        uReset: { value: 1 },
        uUpscale: { value: 1 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tCurrent, tDepth, tHistory;
        uniform mat4 uPrevViewProj, uProjInv, uCamWorld;
        uniform vec2 uJitterUv, uSrcTexel, uDstTexel;
        uniform float uReset, uUpscale;
        varying vec2 vUv;
        vec3 toYC(vec3 c) { return vec3(dot(c, vec3(0.25, 0.5, 0.25)), dot(c, vec3(0.5, 0.0, -0.5)), dot(c, vec3(-0.25, 0.5, -0.25))); }
        vec3 fromYC(vec3 c) { return vec3(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z); }
        // compress HDR so a few very bright pixels do not dominate the neighbourhood statistics
        vec3 tm(vec3 c) { return c / (1.0 + max(c.r, max(c.g, c.b))); }
        vec3 itm(vec3 c) { return c / max(1.0 - max(c.r, max(c.g, c.b)), 1e-3); }
        // 5-tap Catmull-Rom history fetch (sharp, no extra blur from repeated bilinear resampling)
        vec3 historyAt(vec2 uv) {
          vec2 tex = 1.0 / uDstTexel;
          vec2 sp = uv * tex;
          vec2 tp = floor(sp - 0.5) + 0.5;
          vec2 f = sp - tp;
          vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
          vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
          vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
          vec2 w3 = f * f * (-0.5 + 0.5 * f);
          vec2 w12 = w1 + w2;
          vec2 tc12 = (tp + w2 / w12) * uDstTexel;
          vec2 tc0 = (tp - 1.0) * uDstTexel;
          vec2 tc3 = (tp + 2.0) * uDstTexel;
          vec3 r = texture2D(tHistory, vec2(tc12.x, tc0.y)).rgb * (w12.x * w0.y)
                 + texture2D(tHistory, vec2(tc0.x, tc12.y)).rgb * (w0.x * w12.y)
                 + texture2D(tHistory, vec2(tc12.x, tc12.y)).rgb * (w12.x * w12.y)
                 + texture2D(tHistory, vec2(tc3.x, tc12.y)).rgb * (w3.x * w12.y)
                 + texture2D(tHistory, vec2(tc12.x, tc3.y)).rgb * (w12.x * w3.y);
          float ws = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
          return max(r / ws, 0.0);
        }
        void main() {
          vec2 cuv = vUv + uJitterUv;
          vec3 cur = texture2D(tCurrent, cuv).rgb;
          // neighbourhood moments (render-resolution texels) and the closest depth (silhouettes reproject
          // with the foreground)
          vec3 m1 = vec3(0.0), m2 = vec3(0.0);
          float dmin = 1.0;
          for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
            vec2 o = vec2(float(x), float(y)) * uSrcTexel;
            vec3 s = toYC(tm(texture2D(tCurrent, cuv + o).rgb));
            m1 += s; m2 += s * s;
            if (x == 0 || y == 0) dmin = min(dmin, texture2D(tDepth, cuv + o).x);
          }
          m1 /= 9.0; m2 /= 9.0;
          if (uReset > 0.5) { gl_FragColor = vec4(cur, 1.0); return; }
          vec4 v = uProjInv * vec4(cuv * 2.0 - 1.0, dmin * 2.0 - 1.0, 1.0);
          vec3 world = (uCamWorld * vec4(v.xyz / v.w, 1.0)).xyz;
          vec4 pc = uPrevViewProj * vec4(world, 1.0);
          vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
          if (puv.x < 0.0 || puv.y < 0.0 || puv.x > 1.0 || puv.y > 1.0) { gl_FragColor = vec4(cur, 1.0); return; }
          vec3 hist = toYC(tm(historyAt(puv)));
          // variance clipping: clip the history towards the mean, inside mean +- gamma * sigma
          vec3 sig = sqrt(max(m2 - m1 * m1, 0.0));
          float gamma = mix(1.0, 1.5, uUpscale - 1.0);
          vec3 lo = m1 - gamma * sig, hi = m1 + gamma * sig;
          vec3 cc = 0.5 * (hi + lo), ee = 0.5 * (hi - lo) + 1e-4;
          vec3 dv = hist - cc;
          vec3 au = abs(dv / ee);
          float ma = max(au.x, max(au.y, au.z));
          if (ma > 1.0) hist = cc + dv / ma;
          vec3 curY = toYC(tm(cur));
          // more history when upscaling (fewer real samples per output pixel); less when it moved a lot
          vec2 vel = (vUv - puv) / uDstTexel;
          float alpha = mix(0.08, 0.05, clamp(uUpscale - 1.0, 0.0, 1.0)) + clamp(length(vel) * 0.01, 0.0, 0.2);
          // luminance weighting (anti-flicker)
          float wc = alpha / (1.0 + curY.x), wh = (1.0 - alpha) / (1.0 + hist.x);
          vec3 res = (curY * wc + hist * wh) / (wc + wh);
          gl_FragColor = vec4(itm(fromYC(res)), 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  /** The resolved (anti-aliased) image of this frame. */
  get texture(): THREE.Texture {
    return this.hist[this.cur].texture;
  }

  setSize(w: number, h: number) {
    for (const t of this.hist) t.setSize(w, h);
    this.material.uniforms.uDstTexel.value.set(1 / w, 1 / h);
    this.reset = true;
  }

  /** Offset the camera projection by this frame's sub-pixel jitter (render resolution). */
  jitter(camera: THREE.PerspectiveCamera) {
    if (!this.enabled) return;
    this.savedProj.copy(camera.projectionMatrix);
    this.savedProjInv.copy(camera.projectionMatrixInverse);
    this.phase = (this.phase + 1) % JITTER.length;
    const [jx, jy] = JITTER[this.phase];
    const nx = (2 * jx) / this.renderSize.x, ny = (2 * jy) / this.renderSize.y;
    const e = camera.projectionMatrix.elements;
    e[8] -= nx;
    e[9] -= ny;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    this.material.uniforms.uJitterUv.value.set(nx * 0.5, ny * 0.5);
    this.jittered = true;
  }

  unjitter(camera: THREE.PerspectiveCamera) {
    if (!this.jittered) return;
    camera.projectionMatrix.copy(this.savedProj);
    camera.projectionMatrixInverse.copy(this.savedProjInv);
    this.jittered = false;
    // remember this frame's clean view-projection for next frame's reprojection
    this.prevViewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  }

  render(renderer: THREE.WebGLRenderer) {
    const u = this.material.uniforms;
    const cam = this.camera;
    // a jump of the camera (minimap click, cinematic cut) invalidates the history
    if (cam.position.distanceToSquared(this.lastCam) > 36) this.reset = true;
    this.lastCam.copy(cam.position);
    u.tCurrent.value = this.inputSource?.() ?? null;
    u.tDepth.value = this.depthSource?.() ?? null;
    u.uSrcTexel.value.set(1 / this.renderSize.x, 1 / this.renderSize.y);
    const dst = this.hist[1 - this.cur];
    u.uUpscale.value = Math.max(1, Math.min(2, dst.width / Math.max(1, this.renderSize.x)));
    u.tHistory.value = this.hist[this.cur].texture;
    u.uPrevViewProj.value.copy(this.prevViewProj);
    u.uProjInv.value.copy(cam.projectionMatrixInverse);
    u.uCamWorld.value.copy(cam.matrixWorld);
    u.uReset.value = this.reset || !this.valid ? 1 : 0;
    renderer.setRenderTarget(dst);
    this.quad.render(renderer);
    this.cur = 1 - this.cur;
    this.reset = false;
    this.valid = true;
  }

  dispose() {
    for (const t of this.hist) t.dispose();
    this.material.dispose();
    this.quad.dispose();
  }
}

