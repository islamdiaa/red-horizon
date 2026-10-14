import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import type { Player } from '../sim/player';
import { NOISE_GLSL } from './terrain';

/** CPU-side smoothed visibility, uploaded as an RG texture (R = visible, G = explored). */
export class FogOfWar {
  readonly texture: THREE.DataTexture;
  private data: Uint8Array;
  private vis: Float32Array;
  private exp: Float32Array;
  enabled = true;

  constructor(private w: number, private h: number) {
    this.data = new Uint8Array(w * h * 4);
    this.vis = new Float32Array(w * h);
    this.exp = new Float32Array(w * h);
    this.texture = new THREE.DataTexture(this.data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.needsUpdate = true;
  }

  /** Snap to the current state immediately (game start). */
  snap(p: Player) {
    for (let i = 0; i < this.w * this.h; i++) {
      this.vis[i] = p.visible[i] ? 1 : 0;
      this.exp[i] = p.explored[i] ? 1 : 0;
    }
    this.upload();
  }

  update(p: Player, dt: number) {
    const k = Math.min(1, dt * 5);
    const ke = Math.min(1, dt * 3);
    const n = this.w * this.h;
    for (let i = 0; i < n; i++) {
      const tv = this.enabled ? (p.visible[i] ? 1 : 0) : 1;
      const te = this.enabled ? (p.explored[i] ? 1 : 0) : 1;
      this.vis[i] += (tv - this.vis[i]) * k;
      this.exp[i] += (te - this.exp[i]) * ke;
    }
    this.upload();
  }

  private upload() {
    const d = this.data;
    const n = this.w * this.h;
    for (let i = 0; i < n; i++) {
      d[i * 4] = (this.vis[i] * 255) | 0;
      d[i * 4 + 1] = (this.exp[i] * 255) | 0;
      d[i * 4 + 3] = 255;
    }
    this.texture.needsUpdate = true;
  }

  /** Smoothed visibility at a map position (0..1) used to fade units in/out. */
  visibilityAt(x: number, y: number): number {
    const cx = Math.floor(x), cy = Math.floor(y);
    if (cx < 0 || cy < 0 || cx >= this.w || cy >= this.h) return 0;
    return this.vis[cy * this.w + cx];
  }
  exploredAt(x: number, y: number): number {
    const cx = Math.floor(x), cy = Math.floor(y);
    if (cx < 0 || cy < 0 || cx >= this.w || cy >= this.h) return 0;
    return this.exp[cy * this.w + cx];
  }
}

/** Post pass: darkens unexplored (shroud) and not-currently-visible (fog) areas using the depth buffer. */
export class FogPass extends Pass {
  private quad: FullScreenQuad;
  readonly material: THREE.ShaderMaterial;

  constructor(private camera: THREE.PerspectiveCamera, fogTex: THREE.Texture, mapW: number, mapH: number) {
    super();
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        tFog: { value: fogTex },
        uProjInv: { value: new THREE.Matrix4() },
        uCamWorld: { value: new THREE.Matrix4() },
        uMapSize: { value: new THREE.Vector2(mapW, mapH) },
        uTime: { value: 0 },
        uEnabled: { value: 1 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse, tDepth, tFog;
        uniform mat4 uProjInv, uCamWorld;
        uniform vec2 uMapSize;
        uniform float uTime, uEnabled;
        varying vec2 vUv;
        ${NOISE_GLSL}
        void main() {
          vec4 col = texture2D(tDiffuse, vUv);
          float depth = texture2D(tDepth, vUv).x;
          vec4 clip = vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
          vec4 view = uProjInv * clip;
          view /= view.w;
          vec3 world = (uCamWorld * view).xyz;
          vec2 p = world.xz;
          // wobble the fog edge with drifting noise
          vec2 drift = vec2(rh_fbm(p * 0.35 + uTime * 0.04), rh_fbm(p * 0.35 - uTime * 0.03 + 7.0)) - 0.5;
          vec2 uv = (p + drift * 0.9) / uMapSize;
          vec2 f = texture2D(tFog, uv).rg;
          float inside = step(0.0, uv.x) * step(0.0, uv.y) * step(uv.x, 1.0) * step(uv.y, 1.0);
          if (depth >= 0.99999) inside = 0.0;
          float vis = f.r * inside;
          float exp = f.g * inside;
          if (uEnabled < 0.5) { vis = inside; exp = inside; }
          // fog: desaturated, darker, cool tint
          float l = dot(col.rgb, vec3(0.2126, 0.7152, 0.0722));
          vec3 fogged = mix(vec3(l), col.rgb, 0.35) * vec3(0.42, 0.46, 0.55);
          vec3 c = mix(fogged, col.rgb, smoothstep(0.05, 0.95, vis));
          // shroud: deep blue-black with slowly churning clouds
          float cl = rh_fbm(p * 0.18 + vec2(uTime * 0.02, -uTime * 0.015));
          vec3 shroud = mix(vec3(0.004, 0.006, 0.012), vec3(0.03, 0.04, 0.06), cl);
          float edge = smoothstep(0.0, 1.0, exp);
          // bright rim where the shroud meets explored land
          float rim = exp * (1.0 - exp) * 4.0;
          c = mix(shroud, c, edge) + vec3(0.015, 0.022, 0.035) * rim * cl;
          gl_FragColor = vec4(c, col.a);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    const u = this.material.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.tDepth.value = readBuffer.depthTexture;
    u.uProjInv.value.copy(this.camera.projectionMatrixInverse);
    u.uCamWorld.value.copy(this.camera.matrixWorld);
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    if (this.clear) renderer.clear();
    this.quad.render(renderer);
  }

  dispose() {
    this.material.dispose();
    this.quad.dispose();
  }
}
