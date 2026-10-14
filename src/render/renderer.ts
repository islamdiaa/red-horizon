import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { GameMap } from '../sim/map';
import { RTSCamera } from './camera';
import { TerrainMesh } from './terrain';
import { Water } from './water';
import { Vegetation } from './vegetation';
import { OreRenderer } from './ore';
import { FogOfWar, FogPass } from './fog';

export type Quality = 'low' | 'medium' | 'high';
export type TimeOfDay = 'day' | 'dusk' | 'night';

export interface GraphicsSettings {
  quality: Quality;
  timeOfDay: TimeOfDay;
}

interface LightPreset {
  sunColor: number; sunIntensity: number; elevation: number; azimuth: number;
  hemiSky: number; hemiGround: number; hemiIntensity: number;
  env: number; exposure: number; bg: number;
  bloom: number;
  tint: [number, number, number];
}

const PRESETS: Record<TimeOfDay, LightPreset> = {
  day:   { sunColor: 0xffeedd, sunIntensity: 2.5, elevation: 0.86, azimuth: 2.35, hemiSky: 0xb0c8ef, hemiGround: 0x5a4a32, hemiIntensity: 0.75, env: 0.25, exposure: 0.92, bg: 0x05070b, bloom: 0.5, tint: [1, 1, 1] },
  dusk:  { sunColor: 0xffa868, sunIntensity: 2.6, elevation: 0.42, azimuth: 2.6, hemiSky: 0x8a98c8, hemiGround: 0x4a3426, hemiIntensity: 0.65, env: 0.22, exposure: 1.0, bg: 0x05070b, bloom: 0.65, tint: [1.06, 0.99, 0.92] },
  night: { sunColor: 0x86a0ff, sunIntensity: 0.85, elevation: 0.95, azimuth: 2.0, hemiSky: 0x22335c, hemiGround: 0x0a0908, hemiIntensity: 0.42, env: 0.1, exposure: 1.05, bg: 0x020305, bloom: 1.15, tint: [0.72, 0.84, 1.12] },
};

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

/** Owns the WebGL renderer, scene, environment layers and post-processing chain. */
export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly cam: RTSCamera;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly terrain: TerrainMesh;
  readonly water: Water;
  readonly vegetation: Vegetation;
  readonly ore: OreRenderer;
  readonly fog: FogOfWar;
  readonly fogPass: FogPass;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private grade: ShaderPass;
  private smaa: SMAAPass | null = null;
  private preset: LightPreset;
  readonly sunDir = new THREE.Vector3();
  flash = 0;
  /** Per-frame totals across all passes. */
  stats = { calls: 0, tris: 0 };

  constructor(readonly canvas: HTMLCanvasElement, readonly map: GameMap, readonly settings: GraphicsSettings) {
    const q = settings.quality;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q === 'high' ? 2 : q === 'medium' ? 1.5 : 1));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = q !== 'low';
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.preset = PRESETS[settings.timeOfDay];
    this.renderer.toneMappingExposure = this.preset.exposure;
    this.renderer.info.autoReset = false;

    this.cam = new RTSCamera(map.w, map.h, window.innerWidth / window.innerHeight);
    this.scene.background = new THREE.Color(this.preset.bg);

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
    this.terrain = new TerrainMesh(map);
    this.scene.add(this.terrain.mesh);
    const hFn = (x: number, y: number) => this.terrain.renderHeight(x, y);
    this.water = new Water(map, (x, y) => map.heightAt(x, y), this.sunDir);
    this.scene.add(this.water.mesh);
    this.vegetation = new Vegetation(map, hFn, q === 'low' ? 'low' : 'high');
    this.scene.add(this.vegetation.group);
    this.ore = new OreRenderer(map, hFn);
    this.scene.add(this.ore.group);
    this.cam.heightAt = (x, y) => map.heightAt(x, y);

    // post-processing
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType });
    rt.depthTexture = new THREE.DepthTexture(size.x, size.y);
    rt.depthTexture.type = THREE.UnsignedIntType;
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.cam.camera));
    this.fog = new FogOfWar(map.w, map.h);
    this.fogPass = new FogPass(this.cam.camera, this.fog.texture, map.w, map.h);
    this.composer.addPass(this.fogPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), p.bloom, 0.5, 1.15);
    if (q !== 'low') this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    (this.grade.uniforms.uTint.value as THREE.Vector3).set(...p.tint);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    if (q !== 'low') {
      this.smaa = new SMAAPass();
      this.composer.addPass(this.smaa);
    }

    window.addEventListener('resize', this.onResize);
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
  };

  resize() {
    this.onResize();
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
    this.updateShadowFrustum();
    this.terrain.uniforms.uTime.value = time;
    this.water.update(time);
    this.vegetation.update(time);
    this.ore.update(dt, time);
    this.fogPass.material.uniforms.uTime.value = time;
    this.grade.uniforms.uTime.value = time;
    this.flash = Math.max(0, this.flash - dt * 1.4);
    this.grade.uniforms.uFlash.value = Math.min(1, this.flash);
    this.renderer.info.reset();
    this.composer.render(dt);
    this.stats.calls = this.renderer.info.render.calls;
    this.stats.tris = this.renderer.info.render.triangles;
  }

  dispose() {
    window.removeEventListener('resize', this.onResize);
    this.composer.dispose();
    this.renderer.dispose();
  }
}
