import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import type { Player } from '../sim/player';
import { getDummyShadowTexture, getNoiseTexture, TNOISE_GLSL } from './terrain';

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
    this.upload(true);
  }

  update(p: Player, dt: number) {
    const k = Math.min(1, Math.max(0, dt) * 5);
    const ke = Math.min(1, Math.max(0, dt) * 3);
    const n = this.w * this.h;
    const vis = this.vis, exp = this.exp, pv = p.visible, pe = p.explored, on = this.enabled;
    for (let i = 0; i < n; i++) {
      const tv = on ? (pv[i] ? 1 : 0) : 1;
      const te = on ? (pe[i] ? 1 : 0) : 1;
      vis[i] += (tv - vis[i]) * k;
      exp[i] += (te - exp[i]) * ke;
    }
    this.upload(false);
  }

  /** Re-upload only when a texel actually changed (once settled the fog texture stays put). */
  private upload(force: boolean) {
    const d = this.data;
    const n = this.w * this.h;
    let changed = force;
    for (let i = 0; i < n; i++) {
      const v = (this.vis[i] * 255) | 0, e = (this.exp[i] * 255) | 0;
      const j = i * 4;
      if (d[j] !== v || d[j + 1] !== e) {
        d[j] = v;
        d[j + 1] = e;
        changed = true;
      }
      d[j + 3] = 255;
    }
    if (changed) this.texture.needsUpdate = true;
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

export interface AtmosphereOptions {
  /** Multiply in screen-space ambient occlusion (aoSource). */
  ao?: boolean;
  /** Volumetric sun shafts: march the shadow map through the low air (shadowLight). */
  shafts?: boolean;
  /** Low-lying mist pooling in valleys and over water. */
  mist?: boolean;
}

/**
 * The atmosphere post pass, reading the scene colour and depth:
 *   - fog of war: darkens unexplored (shroud) and not-currently-visible (fog) areas;
 *   - ambient occlusion from the GTAO pass (high);
 *   - low-lying mist that pools in valleys and over water, thicker at dawn and in fog weather (medium+);
 *   - volumetric light shafts: in-scattered sunlight through the lower air, with the shadow volumes of
 *     trees, buildings and units carved out of it (high) — golden god rays at dawn and dusk.
 */
export class FogPass extends Pass {
  private quad: FullScreenQuad;
  readonly material: THREE.ShaderMaterial;

  /** Returns the depth texture of the main scene render (set by the renderer). */
  depthSource: (() => THREE.Texture | null) | null = null;
  /** Scene colour to read instead of the composer's read buffer (the scene target, no copy pass). */
  inputSource: (() => THREE.Texture) | null = null;
  /** Ambient occlusion texture (r channel, 1 = open). */
  aoSource: (() => THREE.Texture | null) | null = null;
  /** Light whose shadow map shapes the light shafts. */
  shadowLight: THREE.DirectionalLight | null = null;

  constructor(private camera: THREE.PerspectiveCamera, fogTex: THREE.Texture, mapW: number, mapH: number, opts: AtmosphereOptions = {}) {
    super();
    const defines: Record<string, string> = {};
    if (opts.ao) defines.USE_AO = '';
    if (opts.shafts) defines.USE_SHAFTS = '';
    if (opts.mist) defines.USE_MIST = '';
    this.material = new THREE.ShaderMaterial({
      defines,
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        tFog: { value: fogTex },
        tNoise: { value: getNoiseTexture() },
        tAO: { value: null },
        tShadow: { value: getDummyShadowTexture() },
        uShadowMatrix: { value: new THREE.Matrix4() },
        uProjInv: { value: new THREE.Matrix4() },
        uCamWorld: { value: new THREE.Matrix4() },
        uMapSize: { value: new THREE.Vector2(mapW, mapH) },
        uTime: { value: 0 },
        uEnabled: { value: 1 },
        uShafts: { value: 0 },
        uMist: { value: 0 },
        uHaze: { value: new THREE.Color(0.6, 0.65, 0.7) },
        uSunColor: { value: new THREE.Color(1, 1, 1) },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse, tDepth, tFog, tNoise, tAO;
        uniform mat4 uProjInv, uCamWorld;
        uniform vec2 uMapSize;
        uniform float uTime, uEnabled, uShafts, uMist;
        uniform vec3 uHaze, uSunColor, uSunDir;
        #ifdef USE_SHAFTS
          uniform sampler2DShadow tShadow;
          uniform mat4 uShadowMatrix;
        #endif
        varying vec2 vUv;
        ${TNOISE_GLSL}
        void main() {
          vec4 col = texture2D(tDiffuse, vUv);
          float depth = texture2D(tDepth, vUv).x;
          if (depth >= 0.99999) { gl_FragColor = col; return; }
          vec4 clip = vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
          vec4 view = uProjInv * clip;
          view /= view.w;
          vec3 world = (uCamWorld * view).xyz;
          vec3 camPos = uCamWorld[3].xyz;
          vec2 p = world.xz;
          vec3 c = col.rgb;

          #ifdef USE_AO
            c *= texture2D(tAO, vUv).r;
          #endif

          vec3 rd = world - camPos;
          float rayLen = length(rd);
          rd /= rayLen;
          // in-scattering phase: mostly isotropic with a forward lobe towards the sun
          float mu = dot(rd, uSunDir);
          float phase = 0.55 + 0.45 * pow(max(mu, 0.0), 6.0) * 3.0;

          #ifdef USE_SHAFTS
          if (uShafts > 0.001) {
            // march the part of the view ray below 7 units through the shadow map: lit air glows,
            // shadow volumes behind trees, buildings and units stay clear
            float t0 = rd.y < -0.01 ? max(0.0, (7.0 - camPos.y) / rd.y) : 0.0;
            float t1 = rayLen;
            if (t1 > t0) {
              float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))) + uTime * 7.31);
              float dt = (t1 - t0) / 10.0;
              float lit = 0.0;
              for (int i = 0; i < 10; i++) {
                vec3 sp = camPos + rd * (t0 + (float(i) + jitter) * dt);
                vec4 sc = uShadowMatrix * vec4(sp, 1.0);
                bool inside = sc.x > 0.0 && sc.x < 1.0 && sc.y > 0.0 && sc.y < 1.0 && sc.z < 1.0;
                lit += inside ? texture(tShadow, vec3(sc.xy, sc.z - 0.0015)) : 1.0;
              }
              // lit air glows, shadowed shafts stay clear (contrast via lit^2)
              float air = (t1 - t0) * 0.012;
              float l = lit / 10.0;
              c += uSunColor * (l * l) * air * uShafts * phase;
            }
          }
          #endif

          #ifdef USE_MIST
          if (uMist > 0.001) {
            // exponential height mist hugging the low ground: integral of exp(-(y - y0) / H) along the ray
            const float H = 0.5;
            const float y0 = -0.6;
            float a = min(rd.y, -0.05);
            float dens = H / -a * (exp(-(world.y - y0) / H) - exp(-(camPos.y - y0) / H));
            float wisps = 0.55 + 0.9 * tn_fbm(p * 0.22 + vec2(uTime * 0.05, uTime * 0.03));
            float m = 1.0 - exp(-max(dens, 0.0) * uMist * wisps * 0.35);
            vec3 mistCol = uHaze * 1.05 + uSunColor * 0.04 * phase;
            c = mix(c, mistCol, clamp(m, 0.0, 0.85));
          }
          #endif

          // ---- fog of war: wobble the fog edge with drifting noise
          vec2 drift = vec2(tn_fbm(p * 0.35 + uTime * 0.04), tn_fbm(p * 0.35 - uTime * 0.03 + 7.0)) - 0.5;
          vec2 uv = (p + drift * 0.9) / uMapSize;
          vec2 f = texture2D(tFog, uv).rg;
          // outside the playable area: scenery, shown dimmed like explored fog
          vec2 ruv = world.xz / uMapSize;
          vec2 o = max(max(-ruv, ruv - 1.0), 0.0) * uMapSize;
          float outsideD = length(o);
          float inside = 1.0 - smoothstep(0.0, 1.5, outsideD);
          float vis = mix(0.5, f.r, inside);
          float exp_ = mix(1.0, f.g, inside);
          // uEnabled blends from no fog (0, e.g. intro recon view) to full fog of war (1)
          vis = mix(mix(0.5, 1.0, inside), vis, uEnabled);
          exp_ = mix(1.0, exp_, uEnabled);
          // fog: desaturated, darker, cool tint
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          vec3 fogged = mix(vec3(l), c, 0.35) * vec3(0.42, 0.46, 0.55);
          c = mix(fogged, c, smoothstep(0.05, 0.95, vis));
          // shroud: deep blue-black with slowly churning clouds
          float cl = tn_fbm(p * 0.18 + vec2(uTime * 0.02, -uTime * 0.015));
          vec3 shroud = mix(vec3(0.004, 0.006, 0.012), vec3(0.03, 0.04, 0.06), cl);
          float edge = smoothstep(0.0, 1.0, exp_);
          // bright rim where the shroud meets explored land
          float rim = exp_ * (1.0 - exp_) * 4.0;
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
    u.tDiffuse.value = this.inputSource?.() ?? readBuffer.texture;
    u.tDepth.value = this.depthSource?.() ?? readBuffer.depthTexture;
    if (this.aoSource) u.tAO.value = this.aoSource();
    const sl = this.shadowLight;
    if (sl && sl.shadow.map) {
      u.tShadow.value = sl.shadow.map.depthTexture;
      u.uShadowMatrix.value.copy(sl.shadow.matrix);
    }
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
