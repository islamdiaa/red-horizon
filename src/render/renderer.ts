import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { GameMap } from '../sim/map';
import { RTSCamera } from './camera';
import { TerrainMesh, TerrainSkirt } from './terrain';
import { Water } from './water';
import { Vegetation } from './vegetation';
import { OreRenderer } from './ore';
import { FogOfWar, FogPass } from './fog';
import { Weather, patchMaterialForWeather } from './weather';
import { WATER_LEVEL } from '../sim/map';
import { shadowDepthMaterial } from './models/materials';

export type Quality = 'low' | 'medium' | 'high';
export type TimeOfDay = 'day' | 'dusk' | 'night';

export interface GraphicsSettings {
  quality: Quality;
  timeOfDay: TimeOfDay;
  climate?: 'temperate' | 'winter' | 'desert';
}

interface LightPreset {
  sunColor: number; sunIntensity: number; elevation: number; azimuth: number;
  hemiSky: number; hemiGround: number; hemiIntensity: number;
  env: number; exposure: number; bg: number;
  bloom: number;
  tint: [number, number, number];
  haze: number;
  /** colour grade: saturation, contrast, shadow tint, highlight tint (linear multipliers) */
  sat: number; con: number;
  lo: [number, number, number]; hi: [number, number, number];
  /** atmosphere: light-shaft strength (high quality) and low-lying mist density */
  shafts: number; mist: number;
}

const PRESETS: Record<TimeOfDay, LightPreset> = {
  day: {
    sunColor: 0xffeedd, sunIntensity: 2.5, elevation: 0.86, azimuth: 2.35, hemiSky: 0xb0c8ef, hemiGround: 0x5a4a32, hemiIntensity: 0.75, env: 0.25, exposure: 0.92, bg: 0x05070b, bloom: 0.45, tint: [1, 1, 1], haze: 0x9db0c2,
    sat: 1.1, con: 1.04, lo: [0.93, 0.98, 1.07], hi: [1.05, 1.0, 0.93], shafts: 0.06, mist: 0.0,
  },
  dusk: {
    sunColor: 0xffa868, sunIntensity: 2.6, elevation: 0.42, azimuth: 2.6, hemiSky: 0x8a98c8, hemiGround: 0x4a3426, hemiIntensity: 0.65, env: 0.22, exposure: 1.0, bg: 0x05070b, bloom: 0.62, tint: [1.04, 0.99, 0.94], haze: 0xb98f78,
    sat: 1.1, con: 1.07, lo: [0.88, 0.92, 1.12], hi: [1.07, 1.0, 0.91], shafts: 0.32, mist: 0.3,
  },
  night: {
    sunColor: 0x86a0ff, sunIntensity: 0.85, elevation: 0.95, azimuth: 2.0, hemiSky: 0x22335c, hemiGround: 0x0a0908, hemiIntensity: 0.42, env: 0.1, exposure: 1.05, bg: 0x020305, bloom: 1.05, tint: [0.72, 0.84, 1.12], haze: 0x0c1322,
    sat: 0.86, con: 1.06, lo: [0.84, 0.93, 1.15], hi: [1.03, 1.0, 0.96], shafts: 0.12, mist: 0.25,
  },
};

/** Dawn: like dusk but cooler and pinker, with morning mist in the low ground. */
const DAWN: LightPreset = {
  sunColor: 0xffc2a0, sunIntensity: 2.3, elevation: 0.3, azimuth: 0, hemiSky: 0x93a3d0, hemiGround: 0x4a3a30, hemiIntensity: 0.6, env: 0.2, exposure: 1.0, bg: 0x05070b, bloom: 0.66, tint: [1.02, 0.97, 1.0], haze: 0xb0a0a8,
  sat: 1.06, con: 1.05, lo: [0.9, 0.94, 1.1], hi: [1.07, 1.0, 0.95], shafts: 0.38, mist: 0.75,
};

/** Keyframes over a 24h day: [hour, preset]. */
const DAY_KEYS: [number, LightPreset][] = [
  [0, PRESETS.night], [5, PRESETS.night], [6.5, DAWN], [8.5, PRESETS.day], [16.5, PRESETS.day],
  [18.6, PRESETS.dusk], [20.2, PRESETS.night], [24, PRESETS.night],
];

/** Per-climate look on top of the time of day: saturation / contrast multipliers and an overall tint. */
const CLIMATE_GRADE: Record<'temperate' | 'winter' | 'desert', { sat: number; con: number; tint: [number, number, number] }> = {
  temperate: { sat: 1.0, con: 1.0, tint: [1, 1, 1] },
  winter: { sat: 0.9, con: 1.05, tint: [0.96, 0.99, 1.06] },
  desert: { sat: 1.06, con: 1.07, tint: [1.06, 1.0, 0.9] },
};

const _ca = new THREE.Color(), _cb = new THREE.Color(), _haze = new THREE.Color();
const _v3 = new THREE.Vector3(), _right = new THREE.Vector3(), _up = new THREE.Vector3(), _fwd = new THREE.Vector3();
const _ndc = new THREE.Vector3();
const _v2 = new THREE.Vector2();
const RECEIVER_HEIGHTS = [-0.7, 3.2];
function mixHex(a: number, b: number, t: number, out: THREE.Color) {
  return out.copy(_ca.setHex(a)).lerp(_cb.setHex(b), t);
}

/**
 * Final full-screen pass: miniature (tilt-shift) lens, colour grade, vignette, grain, flash, then ACES tone
 * mapping and sRGB output — one pass instead of three (tilt-shift, grade, OutputPass).
 */
const FinalShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    toneMappingExposure: { value: 1 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uTilt: { value: 1 },
    uFocus: { value: 0.46 },
    uTime: { value: 0 },
    uVignette: { value: 0.3 },
    uSaturation: { value: 1.1 },
    uContrast: { value: 1.04 },
    uFlash: { value: 0 },
    uTint: { value: new THREE.Vector3(1, 1, 1) },
    uLo: { value: new THREE.Vector3(0.93, 0.98, 1.07) },
    uHi: { value: new THREE.Vector3(1.05, 1.0, 0.93) },
    tBloom: { value: null as THREE.Texture | null },
    uBloom: { value: 0 },
  },
  vertexShader: /* glsl */ `
    precision highp float;
    uniform mat4 modelViewMatrix; uniform mat4 projectionMatrix;
    attribute vec3 position; attribute vec2 uv;
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tDiffuse, tBloom;
    uniform vec2 uRes;
    uniform float uTilt, uFocus, uTime, uVignette, uSaturation, uContrast, uFlash, uBloom;
    uniform vec3 uTint, uLo, uHi;
    #include <tonemapping_pars_fragment>
    #include <colorspace_pars_fragment>
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec3 base = texture2D(tDiffuse, vUv).rgb;
      vec3 c = base;
      float amt = 0.0;
      #ifdef TILT
        // miniature lens: blur grows towards the top and bottom of the screen
        amt = smoothstep(0.16, 0.62, abs(vUv.y - uFocus)) * uTilt;
        if (amt > 0.02) {
          vec3 acc = base;
          float r = amt * 5.5 * (uRes.y / 1080.0);
          for (int i = 0; i < 12; i++) {
            float fi = float(i);
            float a = fi * 2.39996;
            float rr = sqrt((fi + 0.5) / 12.0) * r;
            acc += texture2D(tDiffuse, vUv + vec2(cos(a), sin(a)) * rr / uRes).rgb;
          }
          c = acc / 13.0;
        }
      #endif
      vec2 d = vUv - 0.5;
      float r2 = dot(d, d);
      #ifdef TILT
        // subtle chromatic aberration towards the edges (where the image is in focus)
        vec2 off = d * r2 * 0.006;
        float ca = 1.0 - min(1.0, amt * 3.0);
        c.r += (texture2D(tDiffuse, vUv + off).r - base.r) * ca;
        c.b += (texture2D(tDiffuse, vUv - off).b - base.b) * ca;
      #endif
      #ifdef BLOOM
        c += texture2D(tBloom, vUv).rgb * uBloom;
      #endif
      // grade (linear HDR): saturation, tint, split toning, contrast around mid grey
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = max(mix(vec3(l), c, uSaturation), 0.0);
      c *= uTint;
      float t = smoothstep(0.0, 0.9, l);
      c *= mix(uLo, uHi, t);
      c = 0.18 * pow(max(c / 0.18, 0.0), vec3(uContrast));
      c *= 1.0 - uVignette * smoothstep(0.08, 0.55, r2);
      c += (hash(vUv * uRes + fract(uTime) * 100.0) - 0.5) * 0.012 * (0.3 + l);
      c = mix(c, vec3(4.0, 3.8, 3.4), uFlash);
      gl_FragColor = vec4(max(c, 0.0), 1.0);
      #ifdef ACES_FILMIC_TONE_MAPPING
        gl_FragColor.rgb = ACESFilmicToneMapping(gl_FragColor.rgb);
      #endif
      #ifdef SRGB_TRANSFER
        gl_FragColor = sRGBTransferOETF(gl_FragColor);
      #endif
    }`,
};

class FinalPass extends Pass {
  readonly material: THREE.RawShaderMaterial;
  readonly uniforms: typeof FinalShader.uniforms;
  private quad: FullScreenQuad;
  constructor(tilt: boolean, bloom: boolean) {
    super();
    this.uniforms = THREE.UniformsUtils.clone(FinalShader.uniforms) as typeof FinalShader.uniforms;
    this.material = new THREE.RawShaderMaterial({
      name: 'FinalShader', uniforms: this.uniforms, vertexShader: FinalShader.vertexShader, fragmentShader: FinalShader.fragmentShader,
      defines: { ...(tilt ? { TILT: '' } : {}), ...(bloom ? { BLOOM: '' } : {}), ACES_FILMIC_TONE_MAPPING: '', SRGB_TRANSFER: '' },
      depthTest: false, depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
  }
  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    this.uniforms.tDiffuse.value = readBuffer.texture;
    this.uniforms.toneMappingExposure.value = renderer.toneMappingExposure;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
  dispose() {
    this.material.dispose();
    this.quad.dispose();
  }
}

const QUAD_VS = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

/**
 * Bloom as a dual-filter mip chain: a soft-threshold downsample, 4-tap downsamples to 1/32 resolution, then
 * tent upsamples accumulated back up. 9 small passes on high (UnrealBloomPass: 13 plus a full-resolution
 * blend); the final pass adds the result, so nothing else is drawn at full resolution.
 */
class BloomPass extends Pass {
  private mips: THREE.WebGLRenderTarget[] = [];
  private down: THREE.ShaderMaterial;
  private up: THREE.ShaderMaterial;
  private quad: FullScreenQuad;
  constructor(private scale: number, levels: number) {
    super();
    this.needsSwap = false;
    for (let i = 0; i < levels; i++) {
      this.mips.push(new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false }));
    }
    this.down = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uPrefilter: { value: 0 }, uThreshold: { value: 1.15 } },
      vertexShader: QUAD_VS,
      fragmentShader: /* glsl */ `
        uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uPrefilter, uThreshold;
        varying vec2 vUv;
        vec3 pre(vec3 c) {
          // soft knee threshold on brightness; clamp single hot pixels so they don't flicker
          float br = max(c.r, max(c.g, c.b));
          float soft = clamp(br - uThreshold + 0.25, 0.0, 0.5);
          soft = soft * soft / 2.0;
          float k = max(soft, br - uThreshold) / max(br, 1e-4);
          return min(c * k, vec3(24.0));
        }
        void main() {
          vec3 s = texture2D(tSrc, vUv).rgb * 4.0;
          s += texture2D(tSrc, vUv + vec2(-1.0, -1.0) * uTexel).rgb;
          s += texture2D(tSrc, vUv + vec2(1.0, -1.0) * uTexel).rgb;
          s += texture2D(tSrc, vUv + vec2(-1.0, 1.0) * uTexel).rgb;
          s += texture2D(tSrc, vUv + vec2(1.0, 1.0) * uTexel).rgb;
          s /= 8.0;
          if (uPrefilter > 0.5) s = pre(s);
          gl_FragColor = vec4(s, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.up = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } },
      vertexShader: QUAD_VS,
      fragmentShader: /* glsl */ `
        uniform sampler2D tSrc; uniform vec2 uTexel;
        varying vec2 vUv;
        void main() {
          vec2 h = uTexel;
          vec3 s = texture2D(tSrc, vUv + vec2(-2.0, 0.0) * h).rgb + texture2D(tSrc, vUv + vec2(2.0, 0.0) * h).rgb
                 + texture2D(tSrc, vUv + vec2(0.0, -2.0) * h).rgb + texture2D(tSrc, vUv + vec2(0.0, 2.0) * h).rgb;
          s += (texture2D(tSrc, vUv + vec2(-1.0, -1.0) * h).rgb + texture2D(tSrc, vUv + vec2(1.0, -1.0) * h).rgb
              + texture2D(tSrc, vUv + vec2(-1.0, 1.0) * h).rgb + texture2D(tSrc, vUv + vec2(1.0, 1.0) * h).rgb) * 2.0;
          gl_FragColor = vec4(s / 12.0, 1.0);
        }`,
      depthTest: false, depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.quad = new FullScreenQuad(this.down);
  }
  /** Accumulated bloom at the first mip level. */
  get texture(): THREE.Texture {
    return this.mips[0].texture;
  }
  setSize(w: number, h: number) {
    let mw = w, mh = h;
    for (let i = 0; i < this.mips.length; i++) {
      const s = i === 0 ? this.scale : 2;
      mw = Math.max(1, Math.round(mw / s));
      mh = Math.max(1, Math.round(mh / s));
      this.mips[i].setSize(mw, mh);
    }
  }
  render(renderer: THREE.WebGLRenderer, _w: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    const d = this.down.uniforms, u = this.up.uniforms;
    this.quad.material = this.down;
    let src: THREE.Texture = readBuffer.texture;
    let sw = readBuffer.width, sh = readBuffer.height;
    for (let i = 0; i < this.mips.length; i++) {
      d.tSrc.value = src;
      // sample between source texels: at the first level the step covers the whole scale factor
      const k = i === 0 ? this.scale * 0.5 : 1;
      d.uTexel.value.set(k / sw, k / sh);
      d.uPrefilter.value = i === 0 ? 1 : 0;
      renderer.setRenderTarget(this.mips[i]);
      this.quad.render(renderer);
      src = this.mips[i].texture;
      sw = this.mips[i].width;
      sh = this.mips[i].height;
    }
    this.quad.material = this.up;
    for (let i = this.mips.length - 1; i > 0; i--) {
      const m = this.mips[i];
      u.tSrc.value = m.texture;
      u.uTexel.value.set(0.5 / m.width, 0.5 / m.height);
      renderer.setRenderTarget(this.mips[i - 1]);
      this.quad.render(renderer);
    }
  }
  dispose() {
    for (const m of this.mips) m.dispose();
    this.down.dispose();
    this.up.dispose();
    this.quad.dispose();
  }
}

/**
 * Renders the scene into its own target (colour + depth texture). Later passes read this target directly
 * (no copy into the composer's buffers) and sample the scene depth without ever drawing into it.
 */
class SceneRenderPass extends Pass {
  readonly target: THREE.WebGLRenderTarget;
  constructor(private scene: THREE.Scene, private camera: THREE.Camera, w: number, h: number) {
    super();
    this.needsSwap = false;
    this.target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType });
    this.target.depthTexture = new THREE.DepthTexture(w, h);
    this.target.depthTexture.type = THREE.UnsignedIntType;
  }
  get depth(): THREE.Texture {
    return this.target.depthTexture!;
  }
  render(renderer: THREE.WebGLRenderer) {
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(this.scene, this.camera);
  }
  setSize(w: number, h: number) {
    this.target.setSize(w, h);
  }
  dispose() {
    this.target.dispose();
  }
}

/** GTAO computed at half resolution from the scene depth; the atmosphere pass applies it (no extra full-res passes). */
class SceneAOPass extends Pass {
  constructor(readonly gtao: GTAOPass, private depth: () => THREE.Texture | null, private input: () => THREE.WebGLRenderTarget) {
    super();
    this.needsSwap = false;
    gtao.output = GTAOPass.OUTPUT.Off;
  }
  get aoTexture(): THREE.Texture {
    return (this.gtao as unknown as { pdRenderTarget: THREE.WebGLRenderTarget }).pdRenderTarget.texture;
  }
  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, _readBuffer: THREE.WebGLRenderTarget, deltaTime: number, maskActive: boolean) {
    const d = this.depth();
    if (d) {
      (this.gtao as any).gtaoMaterial.uniforms.tDepth.value = d;
      (this.gtao as any).pdMaterial.uniforms.tDepth.value = d;
    }
    this.gtao.render(renderer, writeBuffer, this.input(), deltaTime, maskActive);
  }
  setSize(w: number, h: number) {
    this.gtao.setSize(Math.round(w / 2), Math.round(h / 2));
  }
  dispose() {
    this.gtao.dispose();
  }
}

/** Owns the WebGL renderer, scene, environment layers and post-processing chain. */
export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly cam: RTSCamera;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly terrain: TerrainMesh;
  readonly skirt: TerrainSkirt;
  readonly water: Water;
  readonly vegetation: Vegetation;
  readonly ore: OreRenderer;
  readonly fog: FogOfWar;
  readonly fogPass: FogPass;
  readonly weather: Weather;
  private baseFogDensity = 0.0042;
  private composer: EffectComposer;
  private scenePass: SceneRenderPass;
  private bloom: BloomPass | null = null;
  private final: FinalPass;
  private fxaa: ShaderPass | null = null;
  private aoPass: SceneAOPass | null = null;
  private readonly climateGrade: (typeof CLIMATE_GRADE)['temperate'];
  /** 0..1 user preference for the miniature lens. */
  tiltShiftAmount = 1;
  private preset: LightPreset;
  /** Current time of day in hours (0..24) and how dark it is (0 = day, 1 = night). */
  hours = 12;
  night = 0;
  readonly sunDir = new THREE.Vector3();
  flash = 0;
  /** Per-frame totals across all passes. */
  stats = { calls: 0, tris: 0 };
  private basePixelRatio = 1;
  private scale = 1;
  private frameAcc = 0;
  private frameN = 0;
  private goodWindows = 0;
  private frameNo = 0;
  /** Shadow map refresh period in frames (medium refreshes every other frame). */
  private shadowEvery: number;
  private bloomBase = 0.5;
  private shaftBase = 0;
  private mistBase = 0;

  constructor(readonly canvas: HTMLCanvasElement, readonly map: GameMap, readonly settings: GraphicsSettings) {
    const q = settings.quality;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    // synchronous shader-error checks stall the main thread on every first-use compile
    this.renderer.debug.checkShaderErrors = !!import.meta.env.DEV;
    // weaker presets render fewer pixels: high up to 2x on HiDPI, medium 1.25x, low 1x
    this.basePixelRatio = Math.min(window.devicePixelRatio, q === 'high' ? 2 : q === 'medium' ? 1.25 : 1);
    this.renderer.setPixelRatio(this.basePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = q !== 'low';
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // the shadow map is refreshed explicitly (every frame on high, every other frame on medium)
    this.renderer.shadowMap.autoUpdate = false;
    this.shadowEvery = q === 'high' ? 1 : 2;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.preset = PRESETS[settings.timeOfDay];
    this.renderer.toneMappingExposure = this.preset.exposure;
    this.renderer.info.autoReset = false;

    this.cam = new RTSCamera(map.w, map.h, window.innerWidth / window.innerHeight);
    this.scene.background = new THREE.Color(this.preset.haze);
    this.scene.fog = new THREE.FogExp2(this.preset.haze, 0.0042);
    // the main camera, for renderers that cull against it (see EntityRenderer.preRender)
    this.scene.userData.mainCamera = this.cam.camera;
    this.scene.userData.sunDir = this.sunDir;

    // environment reflections for PBR metals
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = this.preset.env;
    pmrem.dispose();

    // lights
    const p = this.preset;
    this.hemi = new THREE.HemisphereLight(p.hemiSky, p.hemiGround, p.hemiIntensity);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(p.sunColor, p.sunIntensity);
    // sun from the south-east-ish so shadows fall up-left, away from the camera
    this.sunDir.set(0.55, Math.tan(p.elevation) * 0.9, 0.62).normalize();
    this.sun.castShadow = q !== 'low';
    // the shadow camera is fitted to the visible ground every frame, so 2048 on medium is already sharp
    const sm = q === 'high' ? 4096 : 2048;
    this.sun.shadow.mapSize.set(sm, sm);
    this.sun.shadow.bias = -0.00035;
    this.sun.shadow.normalBias = 0.025;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // world layers
    const climate = settings.climate ?? 'temperate';
    this.climateGrade = CLIMATE_GRADE[climate];
    this.terrain = new TerrainMesh(map, climate, q);
    this.scene.add(this.terrain.mesh);
    this.skirt = new TerrainSkirt(map, this.terrain.mesh.material as THREE.Material);
    this.scene.add(this.skirt.mesh);
    const hFn = (x: number, y: number) => this.terrain.renderHeight(x, y);
    this.water = new Water(map, (x, y) => map.heightAt(x, y), this.sunDir, climate === 'winter', q);
    if (q !== 'low') this.water.sun = this.sun;
    this.scene.add(this.water.mesh);
    this.vegetation = new Vegetation(map, hFn, q === 'low' ? 'low' : 'high', climate, this.skirt.treeSpots);
    this.scene.add(this.vegetation.group);
    this.ore = new OreRenderer(map, hFn);
    this.scene.add(this.ore.group);
    // static world layers: no per-frame matrix composition for them or their children
    for (const o of [this.terrain.mesh, this.skirt.mesh, this.water.mesh, this.ore.group]) {
      o.updateMatrix();
      o.matrixAutoUpdate = false;
      o.updateMatrixWorld(true);
      o.matrixWorldAutoUpdate = false;
    }
    this.cam.heightAt = (x, y) => map.heightAt(x, y);
    this.weather = new Weather({
      scene: this.scene, camera: this.cam.camera, renderer: this.renderer,
      getHeight: (x, z) => this.terrain.renderHeight(x, z), mapW: map.w, mapH: map.h, waterLevel: WATER_LEVEL,
      quality: q === 'high' ? 1 : q === 'medium' ? 0.6 : 0.3, seed: map.seed,
    });
    // vegetation and rocks get wet / snow-covered too
    const patched = new Set<THREE.Material>();
    this.vegetation.group.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && m.isMeshStandardMaterial && !patched.has(m)) { patched.add(m); patchMaterialForWeather(m, this.weather.surfaceUniforms); }
    });

    // post-processing: scene -> [AO] -> atmosphere (fog of war, AO, height mist, light shafts) -> [bloom] -> final -> [AA]
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType });
    this.composer = new EffectComposer(this.renderer, rt);
    const scenePass = new SceneRenderPass(this.scene, this.cam.camera, size.x, size.y);
    this.scenePass = scenePass;
    this.composer.addPass(scenePass);
    const sceneDepth = () => scenePass.depth;
    if (q === 'high') {
      const gtao = new GTAOPass(this.scene, this.cam.camera, Math.round(size.x / 2), Math.round(size.y / 2));
      // reuse the scene depth (normals reconstructed from depth): no extra geometry pass
      gtao.setGBuffer(scenePass.depth as THREE.DepthTexture, undefined);
      gtao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.6, thickness: 2.0, scale: 2.0, samples: 12, distanceFallOff: 1, screenSpaceRadius: false });
      gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      this.aoPass = new SceneAOPass(gtao, sceneDepth, () => scenePass.target);
      this.composer.addPass(this.aoPass);
    }
    this.fog = new FogOfWar(map.w, map.h);
    this.fogPass = new FogPass(this.cam.camera, this.fog.texture, map.w, map.h, { ao: !!this.aoPass, shafts: q === 'high', mist: q !== 'low' });
    this.fogPass.depthSource = sceneDepth;
    this.fogPass.inputSource = () => scenePass.target.texture;
    if (this.aoPass) {
      const ao = this.aoPass;
      this.fogPass.aoSource = () => ao.aoTexture;
    }
    if (q === 'high') this.fogPass.shadowLight = this.sun;
    this.composer.addPass(this.fogPass);
    // bloom mip chain from half resolution on high, quarter on medium; none on low. The final pass adds it.
    if (q !== 'low') {
      this.bloom = new BloomPass(q === 'high' ? 2 : 4, q === 'high' ? 5 : 4);
      this.composer.addPass(this.bloom);
    }
    this.final = new FinalPass(q !== 'low', !!this.bloom);
    if (this.bloom) this.final.uniforms.tBloom.value = this.bloom.texture;
    this.composer.addPass(this.final);
    if (q === 'high') this.composer.addPass(new SMAAPass());
    else if (q === 'medium') {
      this.fxaa = new ShaderPass(FXAAShader);
      this.composer.addPass(this.fxaa);
    }

    // Game.precompileShaders compiles the scene on the loading screen; extend that to the post chain and
    // every shadow-depth variant, so nothing compiles once the battle runs.
    const r = this.renderer;
    const compile = r.compile.bind(r);
    r.compile = ((scene: THREE.Object3D, camera: THREE.Camera, target?: THREE.Scene | null) => {
      // programs depend on the render target (tone mapping, output colour space): compile them for the
      // scene target they will really draw into, not for the screen
      const prev = r.getRenderTarget();
      if (scene === this.scene) r.setRenderTarget(scenePass.target);
      const out = compile(scene, camera, target ?? null);
      r.setRenderTarget(prev);
      if (scene === this.scene) this.warmUp();
      return out;
    }) as typeof r.compile;

    window.addEventListener('resize', this.onResize);
    this.onResize();
  }

  private onResize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.cam.camera.aspect = w / h;
    this.cam.camera.updateProjectionMatrix();
    const size = this.renderer.getDrawingBufferSize(_v2);
    this.final.uniforms.uRes.value.set(size.x, size.y);
    this.fxaa?.uniforms.resolution.value.set(1 / size.x, 1 / size.y);
    this.water.setSize(size.x, size.y);
  };

  resize() {
    this.onResize();
  }

  /**
   * Dynamic resolution: drop the render scale when frames take too long, restore it when frames are
   * comfortably at the display rate. Keeps big battles smooth on weaker GPUs.
   */
  dynamicResolution = true;
  adaptResolution(frameMs: number) {
    if (!this.dynamicResolution) return;
    this.frameAcc += frameMs;
    this.frameN++;
    if (this.frameAcc < 2000) return;
    const avg = this.frameAcc / this.frameN;
    this.frameAcc = 0;
    this.frameN = 0;
    let s = this.scale;
    // below ~33 fps: render fewer pixels; back up only after two windows at (nearly) the display rate
    if (avg > 30) { s = Math.max(0.55, s - 0.12); this.goodWindows = 0; }
    else if (avg < 19 && s < 1) { if (++this.goodWindows >= 2) { s = Math.min(1, s + 0.08); this.goodWindows = 0; } }
    else this.goodWindows = 0;
    if (s !== this.scale) {
      this.scale = s;
      this.renderer.setPixelRatio(this.basePixelRatio * s);
      this.composer.setPixelRatio(this.basePixelRatio * s);
      this.onResize();
    }
  }

  /** Blend lighting, sun position, haze and grading for a time of day (hours 0..24). */
  private todFresh = false;
  setTimeOfDay(hours: number) {
    this.todFresh = true;
    hours = ((hours % 24) + 24) % 24;
    this.hours = hours;
    let i = 0;
    while (i < DAY_KEYS.length - 2 && hours >= DAY_KEYS[i + 1][0]) i++;
    const [h0, a] = DAY_KEYS[i], [h1, b] = DAY_KEYS[i + 1];
    const t0 = Math.min(1, Math.max(0, (hours - h0) / Math.max(0.001, h1 - h0)));
    const t = t0 * t0 * (3 - 2 * t0);
    const L = (x: number, y: number) => x + (y - x) * t;
    mixHex(a.sunColor, b.sunColor, t, this.sun.color);
    mixHex(a.hemiSky, b.hemiSky, t, this.hemi.color);
    mixHex(a.hemiGround, b.hemiGround, t, this.hemi.groundColor);
    this.hemi.intensity = L(a.hemiIntensity, b.hemiIntensity);
    this.scene.environmentIntensity = L(a.env, b.env);
    this.renderer.toneMappingExposure = L(a.exposure, b.exposure);
    this.bloomBase = L(a.bloom, b.bloom);
    const cg = this.climateGrade;
    const u = this.final.uniforms;
    u.uTint.value.set(L(a.tint[0], b.tint[0]) * cg.tint[0], L(a.tint[1], b.tint[1]) * cg.tint[1], L(a.tint[2], b.tint[2]) * cg.tint[2]);
    u.uLo.value.set(L(a.lo[0], b.lo[0]), L(a.lo[1], b.lo[1]), L(a.lo[2], b.lo[2]));
    u.uHi.value.set(L(a.hi[0], b.hi[0]), L(a.hi[1], b.hi[1]), L(a.hi[2], b.hi[2]));
    u.uSaturation.value = L(a.sat, b.sat) * cg.sat;
    u.uContrast.value = L(a.con, b.con) * cg.con;
    this.shaftBase = L(a.shafts, b.shafts);
    this.mistBase = L(a.mist, b.mist);
    const haze = mixHex(a.haze, b.haze, t, _haze);
    (this.scene.background as THREE.Color).copy(haze);
    (this.scene.fog as THREE.FogExp2).color.copy(haze);
    // night factor from the keyframes (night preset weight)
    const nightW = (p: LightPreset) => (p === PRESETS.night ? 1 : p === PRESETS.dusk || p === DAWN ? 0.35 : 0);
    this.night = L(nightW(a), nightW(b));
    // sun path: rises in the east (+X), passes south (+Z, behind the camera) and sets in the west.
    // At night the moon takes over from the opposite side of the sky.
    const dayT = (hours - 6) / 12; // 0 at sunrise, 1 at sunset
    let az: number, elev: number;
    if (dayT >= 0 && dayT <= 1) {
      az = dayT * Math.PI;
      elev = 0.18 + Math.sin(dayT * Math.PI) * 0.85;
      this.sun.intensity = L(a.sunIntensity, b.sunIntensity) * Math.min(1, 0.35 + Math.sin(dayT * Math.PI) * 1.4);
    } else {
      const nt = ((hours + 6) % 24) / 12; // moon arc
      az = nt * Math.PI;
      elev = 0.35 + Math.sin(nt * Math.PI) * 0.6;
      this.sun.intensity = L(a.sunIntensity, b.sunIntensity);
    }
    // dim through the sun/moon hand-off so shadows don't visibly flip direction
    const tw = (h: number) => { const d = Math.min(1, Math.abs(hours - h) / 0.45); return d * d * (3 - 2 * d); };
    this.sun.intensity *= 0.08 + 0.92 * Math.min(tw(6), tw(18));
    // keep shadows pointing away from the camera a little: bias the azimuth towards the south
    const ax = Math.cos(az), az2 = 0.35 + Math.sin(az) * 0.65;
    this.sunDir.set(ax * Math.cos(elev), Math.sin(elev) + 0.15, az2 * Math.cos(elev)).normalize();
  }

  /** Weather on top of the time-of-day lighting (call after setTimeOfDay each frame). */
  private applyWeather(dt: number, time: number) {
    const w = this.weather;
    w.update(dt, time, this.cam.x, this.cam.y, this.cam.viewRadius);
    const oc = w.overcast;
    this.sun.intensity *= 1 - 0.72 * oc;
    this.hemi.color.lerp(_ca.setRGB(0.42, 0.45, 0.5), oc * 0.45);
    this.hemi.intensity = this.hemi.intensity * (1 - 0.25 * oc) + w.flash * 1.6;
    this.scene.environmentIntensity = this.scene.environmentIntensity * (1 - 0.3 * oc) + w.flash * 0.2;
    this.terrain.uniforms.uWet.value = w.wetness;
    this.terrain.uniforms.uSnow.value = w.snow;
    // distance haze: time-of-day haze blended towards the weather's lit haze colour
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.lerp(w.hazeColorLit, Math.min(1, w.haze * 1.2));
    (this.scene.background as THREE.Color).copy(fog.color);
    fog.density = this.baseFogDensity + w.haze * 0.016;
    this.final.uniforms.uBloom.value = this.bloomBase * (1 - 0.25 * oc) * 0.6;
    // atmosphere: light shafts need sun and some haze; overcast skies kill them, fog banks thicken the mist
    const fu = this.fogPass.material.uniforms;
    fu.uShafts.value = this.shaftBase * (1 - 0.85 * oc) * (1 + w.haze * 1.5);
    fu.uMist.value = Math.min(1.5, this.mistBase + w.haze * 0.6);
    fu.uHaze.value.copy(fog.color);
    fu.uSunColor.value.copy(this.sun.color).multiplyScalar(this.sun.intensity);
    fu.uSunDir.value.copy(this.sunDir);
    this.water.setLighting(this.sunDir, this.sun.color, this.sun.intensity, this.hemi.color, fog.color, this.night, w);
  }

  /**
   * Fit the sun's shadow camera to the ground the camera actually sees (its footprint between the lowest
   * and highest receiver heights, in light space), snapped to whole texels so shadows don't shimmer.
   */
  private updateShadowFrustum() {
    const cam = this.cam.camera;
    const d = this.sunDir;
    _fwd.copy(d).negate();
    _right.crossVectors(_fwd, _v3.set(0, 1, 0));
    if (_right.lengthSq() < 1e-6) _right.set(1, 0, 0);
    _right.normalize();
    _up.crossVectors(_right, _fwd).normalize();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minD = Infinity, maxD = -Infinity;
    const camPos = cam.position;
    // the four screen corners (slightly beyond, for the shadow filter) at the lowest / highest receiver height
    for (let k = 0; k < 4; k++) {
      _ndc.set(k & 1 ? 1.06 : -1.06, k & 2 ? 1.06 : -1.06, 0.5).unproject(cam).sub(camPos).normalize();
      for (const h of RECEIVER_HEIGHTS) {
        let tt = _ndc.y < -1e-3 ? (h - camPos.y) / _ndc.y : 140;
        if (tt < 0 || tt > 140) tt = 140;
        _v3.copy(camPos).addScaledVector(_ndc, tt);
        const x = _v3.dot(_right), y = _v3.dot(_up), z = _v3.dot(d);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (z < minD) minD = z;
        if (z > maxD) maxD = z;
      }
    }
    const sc = this.sun.shadow.camera as THREE.OrthographicCamera;
    // square extents quantised to 2 units (stable texel size while panning); snapped centre
    const ext = Math.ceil((Math.max(maxX - minX, maxY - minY) / 2 + 1.5) / 2) * 2;
    const texel = (2 * ext) / this.sun.shadow.mapSize.x;
    const cx = Math.round((minX + maxX) / 2 / texel) * texel, cy = Math.round((minY + maxY) / 2 / texel) * texel;
    // casters can stand up to ~8 units above the highest receiver (aircraft, tall structures, hills)
    const top = maxD + 8;
    sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext;
    sc.near = 0.5; sc.far = top - minD + 4;
    sc.updateProjectionMatrix();
    // light position: centre of the fitted rectangle, `top` units along the sun direction
    _v3.copy(_right).multiplyScalar(cx).addScaledVector(_up, cy).addScaledVector(d, top);
    this.sun.position.copy(_v3);
    this.sun.target.position.copy(_v3).sub(d);
    this.sun.updateMatrixWorld();
    this.sun.target.updateMatrixWorld();
  }

  render(dt: number, time: number) {
    this.frameNo++;
    this.cam.update(dt);
    // weather modulates the time-of-day lighting, so start from fresh base values every frame
    if (!this.todFresh) this.setTimeOfDay(this.hours);
    this.todFresh = false;
    this.applyWeather(dt, time);
    // medium refreshes the shadow map every other frame; the fit only moves with a refresh, so the
    // shadow matrix always matches the map that was rendered with it
    if (this.sun.castShadow && this.frameNo % this.shadowEvery === 0) {
      this.updateShadowFrustum();
      this.renderer.shadowMap.needsUpdate = true;
    }
    this.terrain.uniforms.uTime.value = time;
    this.water.update(time);
    this.vegetation.update(time, this.cam.camera, this.sunDir);
    this.ore.update(dt, time);
    // per-view culling of models etc. with this frame's camera (see EntityRenderer)
    (this.scene.userData.preRender as ((c: THREE.Camera) => void) | undefined)?.(this.cam.camera);
    this.fogPass.material.uniforms.uTime.value = time;
    const u = this.final.uniforms;
    u.uTime.value = time;
    this.flash = Math.max(0, this.flash - dt * 1.4);
    u.uFlash.value = Math.min(1, this.flash);
    // stronger miniature look when zoomed in, subtle when zoomed out
    const z = (this.cam.dist - this.cam.minDist) / (this.cam.maxDist - this.cam.minDist);
    u.uTilt.value = this.tiltShiftAmount * (1.0 - Math.min(1, Math.max(0, z)) * 0.65);
    this.renderer.info.reset();
    this.composer.render(dt);
    (this.scene.userData.postRender as (() => void) | undefined)?.();
    this.stats.calls = this.renderer.info.render.calls;
    this.stats.tris = this.renderer.info.render.triangles;
  }

  /**
   * One full frame with a set of tiny stand-ins (plain, skinned and instanced meshes, front and double
   * sided) in view, so every post-processing and shadow-depth program exists before the battle starts.
   */
  private warmUp() {
    const g = new THREE.Group();
    const geo = new THREE.BoxGeometry(0.01, 0.01, 0.01);
    const mats = [new THREE.MeshStandardMaterial(), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide })];
    const skeletons: THREE.Skeleton[] = [];
    for (const m of mats) {
      const plain = new THREE.Mesh(geo, m);
      const bone = new THREE.Bone();
      const skinGeo = geo.clone();
      const n = skinGeo.attributes.position.count;
      skinGeo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(n * 4), 4));
      skinGeo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Float32Array(n * 4).fill(0.25), 4));
      const skinned = new THREE.SkinnedMesh(skinGeo, m);
      skinned.add(bone);
      const sk = new THREE.Skeleton([bone]);
      skeletons.push(sk);
      skinned.bind(sk);
      const inst = new THREE.InstancedMesh(geo, m, 1);
      const instC = new THREE.InstancedMesh(geo, m, 1);
      instC.setColorAt(0, _ca.setRGB(1, 1, 1));
      for (const o of [plain, skinned, inst, instC]) {
        o.castShadow = true;
        o.frustumCulled = false;
        g.add(o);
        // twice: once with three's own depth material, once with the shared per-kind one (models, terrain…)
        const twin = o.clone();
        twin.customDepthMaterial = shadowDepthMaterial(twin);
        g.add(twin);
      }
    }
    g.position.set(this.cam.x, -0.5, this.cam.y);
    this.scene.add(g);
    try {
      this.cam.update(0);
      this.updateShadowFrustum();
      this.renderer.shadowMap.needsUpdate = true;
      this.renderer.info.reset();
      this.composer.render(0);
    } catch (e) {
      console.warn('post warm-up failed', e);
    }
    this.scene.remove(g);
    // Finish every program now (link status, uniform and attribute locations): drivers that compile lazily
    // (and parallel compiles still in flight) would otherwise stall the first frame that uses each one.
    for (const prog of this.renderer.info.programs ?? []) {
      const p = prog as unknown as { getUniforms?: () => unknown; getAttributes?: () => unknown };
      try {
        p.getUniforms?.();
        p.getAttributes?.();
      } catch { /* a broken program reports itself when drawn */ }
    }
    for (const sk of skeletons) sk.dispose();
    geo.dispose();
    for (const m of mats) m.dispose();
  }

  /** After a lost WebGL context comes back: three re-uploads buffers itself, but the baked environment map is gone. */
  restoreAfterContextLoss() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment?.dispose();
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.renderer.shadowMap.needsUpdate = true;
    this.onResize();
  }

  dispose() {
    window.removeEventListener('resize', this.onResize);
    this.weather.dispose();
    this.water.dispose();
    // EffectComposer.dispose() only frees its own buffers: release every pass's targets and materials
    for (const p of this.composer.passes) p.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }
}
