import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
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
}

const PRESETS: Record<TimeOfDay, LightPreset> = {
  day:   { sunColor: 0xffeedd, sunIntensity: 2.5, elevation: 0.86, azimuth: 2.35, hemiSky: 0xb0c8ef, hemiGround: 0x5a4a32, hemiIntensity: 0.75, env: 0.25, exposure: 0.92, bg: 0x05070b, bloom: 0.5, tint: [1, 1, 1], haze: 0x9db0c2 },
  dusk:  { sunColor: 0xffa868, sunIntensity: 2.6, elevation: 0.42, azimuth: 2.6, hemiSky: 0x8a98c8, hemiGround: 0x4a3426, hemiIntensity: 0.65, env: 0.22, exposure: 1.0, bg: 0x05070b, bloom: 0.65, tint: [1.06, 0.99, 0.92], haze: 0xb98f78 },
  night: { sunColor: 0x86a0ff, sunIntensity: 0.85, elevation: 0.95, azimuth: 2.0, hemiSky: 0x22335c, hemiGround: 0x0a0908, hemiIntensity: 0.42, env: 0.1, exposure: 1.05, bg: 0x020305, bloom: 1.15, tint: [0.72, 0.84, 1.12], haze: 0x0c1322 },
};

/** Dawn: like dusk but cooler and pinker. */
const DAWN: LightPreset = { sunColor: 0xffc2a0, sunIntensity: 2.3, elevation: 0.3, azimuth: 0, hemiSky: 0x93a3d0, hemiGround: 0x4a3a30, hemiIntensity: 0.6, env: 0.2, exposure: 1.0, bg: 0x05070b, bloom: 0.7, tint: [1.02, 0.97, 1.0], haze: 0xb0a0a8 };

/** Keyframes over a 24h day: [hour, preset]. */
const DAY_KEYS: [number, LightPreset][] = [
  [0, PRESETS.night], [5, PRESETS.night], [6.5, DAWN], [8.5, PRESETS.day], [16.5, PRESETS.day],
  [18.6, PRESETS.dusk], [20.2, PRESETS.night], [24, PRESETS.night],
];

const _ca = new THREE.Color(), _cb = new THREE.Color();
function mixHex(a: number, b: number, t: number, out: THREE.Color) {
  return out.copy(_ca.setHex(a)).lerp(_cb.setHex(b), t);
}

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uVignette: { value: 0.32 },
    uSaturation: { value: 1.1 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uFlash: { value: 0 },
    uTint: { value: new THREE.Vector3(1, 1, 1) },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uSaturation, uFlash;
    uniform vec3 uTint;
    uniform vec2 uRes;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 d = vUv - 0.5;
      float r2 = dot(d, d);
      // subtle chromatic aberration towards the edges
      vec2 off = d * r2 * 0.006;
      vec3 c;
      c.r = texture2D(tDiffuse, vUv + off).r;
      c.g = texture2D(tDiffuse, vUv).g;
      c.b = texture2D(tDiffuse, vUv - off).b;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSaturation);
      c *= uTint;
      // split toning: cool shadows, warm highlights
      float t = smoothstep(0.0, 0.9, l);
      c *= mix(vec3(0.93, 0.98, 1.07), vec3(1.05, 1.0, 0.93), t);
      // vignette
      c *= 1.0 - uVignette * smoothstep(0.08, 0.55, r2);
      // film grain
      c += (hash(vUv * uRes + fract(uTime) * 100.0) - 0.5) * 0.012 * (0.3 + l);
      // white flash (nukes)
      c = mix(c, vec3(4.0, 3.8, 3.4), uFlash);
      gl_FragColor = vec4(max(c, 0.0), 1.0);
    }`,
};

/**
 * Renders the scene into its own target (colour + depth texture) and copies the colour into the
 * post chain. Later passes can sample the scene depth without ever drawing into it (no feedback loops).
 */
class SceneRenderPass extends Pass {
  readonly target: THREE.WebGLRenderTarget;
  private copy: FullScreenQuad;
  private copyMat: THREE.ShaderMaterial;
  constructor(private scene: THREE.Scene, private camera: THREE.Camera, w: number, h: number) {
    super();
    this.target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType });
    this.target.depthTexture = new THREE.DepthTexture(w, h);
    this.target.depthTexture.type = THREE.UnsignedIntType;
    this.copyMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tDiffuse, vUv); }`,
      depthTest: false, depthWrite: false,
    });
    this.copy = new FullScreenQuad(this.copyMat);
  }
  get depth(): THREE.Texture {
    return this.target.depthTexture!;
  }
  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget) {
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    this.copyMat.uniforms.tDiffuse.value = this.target.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.copy.render(renderer);
  }
  setSize(w: number, h: number) {
    this.target.setSize(w, h);
  }
}

/** Wraps GTAOPass so it reuses the main scene depth (no extra geometry pass). */
class SceneAOPass extends Pass {
  constructor(private gtao: GTAOPass, private depth: () => THREE.Texture | null) {
    super();
  }
  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget, deltaTime: number, maskActive: boolean) {
    const d = this.depth();
    if (d) {
      (this.gtao as any).gtaoMaterial.uniforms.tDepth.value = d;
      (this.gtao as any).pdMaterial.uniforms.tDepth.value = d;
    }
    this.gtao.renderToScreen = this.renderToScreen;
    this.gtao.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
  }
  setSize(w: number, h: number) {
    this.gtao.setSize(Math.round(w / 2), Math.round(h / 2));
  }
}

/** Miniature / diorama lens: blur grows towards the top and bottom of the screen. */
const TiltShiftShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uRes: { value: new THREE.Vector2(1, 1) },
    uStrength: { value: 1 },
    uFocus: { value: 0.46 },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uStrength, uFocus;
    varying vec2 vUv;
    void main() {
      float d = abs(vUv.y - uFocus);
      float amt = smoothstep(0.16, 0.62, d) * uStrength;
      vec4 base = texture2D(tDiffuse, vUv);
      if (amt < 0.02) { gl_FragColor = base; return; }
      vec3 acc = base.rgb; float w = 1.0;
      float r = amt * 5.5 * (uRes.y / 1080.0);
      for (int i = 0; i < 12; i++) {
        float fi = float(i);
        float a = fi * 2.39996;
        float rr = sqrt((fi + 0.5) / 12.0) * r;
        vec2 o = vec2(cos(a), sin(a)) * rr / uRes;
        acc += texture2D(tDiffuse, vUv + o).rgb;
        w += 1.0;
      }
      gl_FragColor = vec4(acc / w, base.a);
    }`,
};

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
  private hazeBase = new THREE.Color();
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private grade: ShaderPass;
  private smaa: SMAAPass | null = null;
  private aoPass: SceneAOPass | null = null;
  private tiltShift: ShaderPass | null = null;
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

  constructor(readonly canvas: HTMLCanvasElement, readonly map: GameMap, readonly settings: GraphicsSettings) {
    const q = settings.quality;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.basePixelRatio = Math.min(window.devicePixelRatio, q === 'high' ? 2 : q === 'medium' ? 1.5 : 1);
    this.renderer.setPixelRatio(this.basePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = q !== 'low';
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.preset = PRESETS[settings.timeOfDay];
    this.renderer.toneMappingExposure = this.preset.exposure;
    this.renderer.info.autoReset = false;

    this.cam = new RTSCamera(map.w, map.h, window.innerWidth / window.innerHeight);
    this.scene.background = new THREE.Color(this.preset.haze);
    this.scene.fog = new THREE.FogExp2(this.preset.haze, 0.0042);

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
    const sm = q === 'high' ? 4096 : 2048;
    this.sun.shadow.mapSize.set(sm, sm);
    this.sun.shadow.bias = -0.00035;
    this.sun.shadow.normalBias = 0.025;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // world layers
    const climate = settings.climate ?? 'temperate';
    this.terrain = new TerrainMesh(map, climate);
    this.scene.add(this.terrain.mesh);
    this.skirt = new TerrainSkirt(map, this.terrain.mesh.material as THREE.Material);
    this.scene.add(this.skirt.mesh);
    const hFn = (x: number, y: number) => this.terrain.renderHeight(x, y);
    this.water = new Water(map, (x, y) => map.heightAt(x, y), this.sunDir, climate === 'winter');
    this.scene.add(this.water.mesh);
    this.vegetation = new Vegetation(map, hFn, q === 'low' ? 'low' : 'high', climate);
    this.vegetation.addSceneryTrees(this.skirt.treeSpots);
    this.scene.add(this.vegetation.group);
    this.ore = new OreRenderer(map, hFn);
    this.scene.add(this.ore.group);
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

    // post-processing
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType });
    this.composer = new EffectComposer(this.renderer, rt);
    const scenePass = new SceneRenderPass(this.scene, this.cam.camera, size.x, size.y);
    this.composer.addPass(scenePass);
    const sceneDepth = () => scenePass.depth;
    if (q === 'high') {
      const gtao = new GTAOPass(this.scene, this.cam.camera, Math.round(size.x / 2), Math.round(size.y / 2));
      // reuse the scene depth (normals reconstructed from depth): no extra geometry pass
      gtao.setGBuffer(scenePass.depth as THREE.DepthTexture, undefined);
      gtao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.6, thickness: 2.0, scale: 2.0, samples: 12, distanceFallOff: 1, screenSpaceRadius: false });
      gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      gtao.blendIntensity = 1.0;
      this.aoPass = new SceneAOPass(gtao, sceneDepth);
      this.composer.addPass(this.aoPass);
    }
    this.fog = new FogOfWar(map.w, map.h);
    this.fogPass = new FogPass(this.cam.camera, this.fog.texture, map.w, map.h);
    this.fogPass.depthSource = sceneDepth;
    this.composer.addPass(this.fogPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), p.bloom, 0.5, 1.15);
    if (q !== 'low') this.composer.addPass(this.bloom);
    if (q !== 'low') {
      this.tiltShift = new ShaderPass(TiltShiftShader);
      this.composer.addPass(this.tiltShift);
    }
    this.grade = new ShaderPass(GradeShader);
    (this.grade.uniforms.uTint.value as THREE.Vector3).set(...p.tint);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    if (q !== 'low') {
      this.smaa = new SMAAPass();
      this.composer.addPass(this.smaa);
    }

    window.addEventListener('resize', this.onResize);
    this.onResize();
  }

  private onResize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.cam.camera.aspect = w / h;
    this.cam.camera.updateProjectionMatrix();
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.bloom.resolution.set(size.x / 2, size.y / 2);
    (this.grade.uniforms.uRes.value as THREE.Vector2).set(size.x, size.y);
    if (this.tiltShift) (this.tiltShift.uniforms.uRes.value as THREE.Vector2).set(size.x, size.y);
  };

  resize() {
    this.onResize();
  }

  /**
   * Dynamic resolution: drop the render scale when frames take too long, restore it when
   * there is headroom. Keeps big battles smooth on weaker GPUs.
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
    if (avg > 38) s = Math.max(0.55, s - 0.12);
    else if (avg < 22 && s < 1) s = Math.min(1, s + 0.08);
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
    this.bloom.strength = L(a.bloom, b.bloom);
    (this.grade.uniforms.uTint.value as THREE.Vector3).set(L(a.tint[0], b.tint[0]), L(a.tint[1], b.tint[1]), L(a.tint[2], b.tint[2]));
    const haze = mixHex(a.haze, b.haze, t, new THREE.Color());
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
    this.water.material.uniforms.uSunDir.value.copy(this.sunDir);
    this.water.material.uniforms.uSunColor.value.copy(this.sun.color).multiplyScalar(0.6 + 0.4 * (1 - this.night));
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
    this.hazeBase.copy(fog.color);
    fog.color.lerp(w.hazeColorLit, Math.min(1, w.haze * 1.2));
    (this.scene.background as THREE.Color).copy(fog.color);
    fog.density = this.baseFogDensity + w.haze * 0.016;
  }

  /** Keep the sun's shadow frustum tight around what the camera sees. */
  private updateShadowFrustum() {
    const c = this.cam;
    const S = c.dist * 0.95 + 6;
    const sc = this.sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = -S; sc.right = S; sc.top = S; sc.bottom = -S;
    sc.near = 1; sc.far = 220;
    sc.updateProjectionMatrix();
    // focus a little "above" the camera target since the view extends further up-screen
    const texel = (2 * S) / this.sun.shadow.mapSize.x;
    const fx = Math.round(c.x / texel) * texel;
    const fz = Math.round((c.y - c.dist * 0.18) / texel) * texel;
    this.sun.target.position.set(fx, 0, fz);
    this.sun.position.set(fx + this.sunDir.x * 90, this.sunDir.y * 90, fz + this.sunDir.z * 90);
    this.sun.target.updateMatrixWorld();
  }

  render(dt: number, time: number) {
    this.cam.update(dt);
    // weather modulates the time-of-day lighting, so start from fresh base values every frame
    if (!this.todFresh) this.setTimeOfDay(this.hours);
    this.todFresh = false;
    this.applyWeather(dt, time);
    this.updateShadowFrustum();
    this.terrain.uniforms.uTime.value = time;
    this.water.update(time);
    this.vegetation.update(time);
    this.ore.update(dt, time);
    this.fogPass.material.uniforms.uTime.value = time;
    this.grade.uniforms.uTime.value = time;
    this.flash = Math.max(0, this.flash - dt * 1.4);
    this.grade.uniforms.uFlash.value = Math.min(1, this.flash);
    if (this.tiltShift) {
      // stronger miniature look when zoomed in, subtle when zoomed out
      const z = (this.cam.dist - this.cam.minDist) / (this.cam.maxDist - this.cam.minDist);
      this.tiltShift.uniforms.uStrength.value = this.tiltShiftAmount * (1.0 - Math.min(1, Math.max(0, z)) * 0.65);
    }
    this.renderer.info.reset();
    this.composer.render(dt);
    this.stats.calls = this.renderer.info.render.calls;
    this.stats.tris = this.renderer.info.render.triangles;
  }

  dispose() {
    window.removeEventListener('resize', this.onResize);
    this.weather.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }
}
