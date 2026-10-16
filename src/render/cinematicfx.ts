import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

/**
 * Cinematic lens: camera motion blur and depth of field in one full-resolution pass, active only while a
 * cinematic or photo mode asks for it (zero cost otherwise: the pass is skipped).
 *
 *  - Motion blur: every pixel's world position (scene depth) is reprojected into last frame's view; the
 *    screen-space velocity, scaled by the shutter, smears the image along the camera motion.
 *  - Depth of field: a 40-tap golden-angle gather whose disc follows the circle of confusion of each pixel
 *    (thin-lens CoC from view depth). Samples only count when their own CoC reaches the centre (sharp
 *    foreground never bleeds into the blurred background; blurred foreground does spill over the subject),
 *    and bright samples weigh more, so highlights open into bokeh discs.
 *
 * `focus` is a world-space distance from the camera; `autoFocus` 1 focuses on whatever is at the screen centre.
 */
export class CinematicPass extends Pass {
  readonly material: THREE.ShaderMaterial;
  private quad: FullScreenQuad;
  private prevViewProj = new THREE.Matrix4();
  private hasPrev = false;
  inputSource: (() => THREE.Texture | null) | null = null;
  depthSource: (() => THREE.Texture | null) | null = null;
  /** 0..1 lens opening (0 = no depth of field). */
  aperture = 0;
  /** Focus distance (world units) when autoFocus is 0. */
  focus = 25;
  /** 0..1: focus on the screen centre instead of `focus`. */
  autoFocus = 1;
  /** 0..1 shutter (fraction of the frame's motion that is smeared). */
  shutter = 0;
  /** Set while warming up shaders: render even when nothing is active. */
  force = false;

  constructor(private camera: THREE.PerspectiveCamera) {
    super();
    this.material = new THREE.ShaderMaterial({
      name: 'cinematic-lens',
      uniforms: {
        tColor: { value: null },
        tDepth: { value: null },
        uProjInv: { value: new THREE.Matrix4() },
        uCamWorld: { value: new THREE.Matrix4() },
        uPrevViewProj: { value: new THREE.Matrix4() },
        uTexel: { value: new THREE.Vector2(1, 1) },
        uAperture: { value: 0 },
        uFocus: { value: 25 },
        uAutoFocus: { value: 1 },
        uShutter: { value: 0 },
        uMaxCoC: { value: 14 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tColor, tDepth;
        uniform mat4 uProjInv, uCamWorld, uPrevViewProj;
        uniform vec2 uTexel;
        uniform float uAperture, uFocus, uAutoFocus, uShutter, uMaxCoC;
        varying vec2 vUv;
        float viewDist(vec2 uv) {
          vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, texture2D(tDepth, uv).x * 2.0 - 1.0, 1.0);
          return length(v.xyz / v.w);
        }
        void main() {
          vec3 base = texture2D(tColor, vUv).rgb;
          // camera motion: reproject into last frame
          vec2 vel = vec2(0.0);
          if (uShutter > 0.0) {
            float d = texture2D(tDepth, vUv).x;
            vec4 v = uProjInv * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
            vec3 w = (uCamWorld * vec4(v.xyz / v.w, 1.0)).xyz;
            vec4 pc = uPrevViewProj * vec4(w, 1.0);
            vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
            vel = (vUv - puv) * uShutter;
            float vl = length(vel);
            if (vl > 0.06) vel *= 0.06 / vl;
          }
          if (uAperture <= 0.0) {
            if (uShutter <= 0.0) { gl_FragColor = vec4(base, 1.0); return; }
            // 16 taps along the motion, offset per pixel (noise instead of discrete copies; TAA smooths it)
            float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
            vec3 acc = vec3(0.0);
            for (int i = 0; i < 16; i++) acc += texture2D(tColor, vUv - vel * ((float(i) + jit) / 16.0 - 0.5)).rgb;
            gl_FragColor = vec4(acc / 16.0, 1.0);
            return;
          }
          float focus = mix(uFocus, viewDist(vec2(0.5)), uAutoFocus);
          // circle of confusion in pixels (thin lens, scaled to the screen height)
          float z0 = viewDist(vUv);
          float scale = uAperture * uMaxCoC;
          float c0 = clamp(abs(z0 - focus) / max(z0, 0.5) * scale * 5.0, 0.0, uMaxCoC);
          vec3 acc = base;
          float wsum = 1.0;
          const int N = 40;
          for (int i = 0; i < N; i++) {
            float fi = float(i) + 0.5;
            float r = sqrt(fi / float(N)) * uMaxCoC;
            float a = fi * 2.39996323;
            vec2 o = vec2(cos(a), sin(a)) * r;
            vec2 suv = vUv + o * uTexel - vel * (fi / float(N) - 0.5);
            vec3 col = texture2D(tColor, suv).rgb;
            float zi = viewDist(suv);
            float ci = clamp(abs(zi - focus) / max(zi, 0.5) * scale * 5.0, 0.0, uMaxCoC);
            // a sample reaches the centre if its own disc covers the distance; behind the subject it is
            // limited by the centre's CoC (sharp subject edges stay sharp)
            float reach = zi < z0 ? ci : min(ci, c0);
            float w = smoothstep(r - 1.5, r + 0.5, reach);
            float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
            w *= 1.0 + min(l * l, 8.0) * 0.4;
            acc += col * w;
            wsum += w;
          }
          gl_FragColor = vec4(acc / wsum, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  get active(): boolean {
    return this.aperture > 0.001 || this.shutter > 0.001;
  }

  setSize(w: number, h: number) {
    this.material.uniforms.uTexel.value.set(1 / w, 1 / h);
    this.material.uniforms.uMaxCoC.value = Math.max(6, Math.round(20 * (h / 1080)));
  }

  /** Remember the camera of this frame (call after rendering every frame, active or not). */
  endFrame() {
    this.prevViewProj.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.hasPrev = true;
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    const u = this.material.uniforms;
    u.tColor.value = this.inputSource?.() ?? readBuffer.texture;
    u.tDepth.value = this.depthSource?.() ?? null;
    u.uProjInv.value.copy(this.camera.projectionMatrixInverse);
    u.uCamWorld.value.copy(this.camera.matrixWorld);
    u.uPrevViewProj.value.copy(this.prevViewProj);
    u.uAperture.value = this.force ? Math.max(this.aperture, 0.5) : this.aperture;
    u.uFocus.value = this.focus;
    u.uAutoFocus.value = this.autoFocus;
    u.uShutter.value = this.hasPrev ? this.shutter : 0;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  dispose() {
    this.material.dispose();
    this.quad.dispose();
  }
}
