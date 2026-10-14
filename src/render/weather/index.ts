/**
 * Dynamic weather for Red Horizon: rain, thunderstorms, snow, ground fog and sandstorms.
 *
 * Draw calls (only layers with a non-zero density are drawn):
 *   precipitation (rain / snow / grit, one each), splashes + ripples, haze puffs, lightning.
 *   A full storm is 4: rain, splashes, mist, lightning (the last only while a flash is visible).
 * All particle motion runs in vertex shaders inside camera-following volumes (see volume.ts);
 * the CPU only integrates a handful of phases and uniforms per frame, with no allocations.
 *
 * The renderer reads the scalar outputs (wetness, snow, flash, haze, hazeColor, overcast, wind)
 * to adapt terrain shading, lights and fog — see the doc comments on each field.
 */
import * as THREE from 'three';
import { buildHeightField, type HeightField } from './heightfield';
import { PrecipLayer } from './precip';
import { SplashLayer } from './splashes';
import { HazeLayer } from './haze';
import { Lightning } from './lightning';
import { Rng } from './rng';
import type { WeatherKind } from './types';
import type { WeatherSurfaceUniforms } from './surface';

export type { WeatherKind, Climate, WeatherStep } from './types';
export { WEATHER_KINDS } from './types';
export { randomWeatherSequence } from './sequence';
export { patchMaterialForWeather, WEATHER_SURFACE_DECL, WEATHER_SURFACE_APPLY, type WeatherSurfaceUniforms } from './surface';

export interface WeatherOptions {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  /** Ground height (world units, 1 unit = 1 map cell). Sampled once at construction. */
  getHeight(x: number, z: number): number;
  mapW: number;
  mapH: number;
  /** World Y of water surfaces (-0.32). */
  waterLevel: number;
  /** Optional particle-count multiplier for weaker GPUs (0.2..1, default 1). */
  quality?: number;
  /** Optional seed for repeatable particle layouts and lightning. */
  seed?: number;
}

type Rgb = readonly [number, number, number];

interface Profile {
  /** precipitation / effect densities */
  rain: number; snow: number; grit: number;
  /** haze-puff contributions */
  fog: number; mist: number; dust: number; snowMist: number;
  haze: number;
  hazeColor: Rgb;
  overcast: number;
  wind: number;
  gust: number;
  storm: number;
}

const ZERO: Omit<Profile, 'haze' | 'hazeColor' | 'overcast' | 'wind' | 'gust'> = { rain: 0, snow: 0, grit: 0, fog: 0, mist: 0, dust: 0, snowMist: 0, storm: 0 };

/** sRGB-ish authoring colours, converted to linear on use. */
const PROFILES: Record<WeatherKind, Profile> = {
  clear: { ...ZERO, haze: 0, hazeColor: [0.62, 0.68, 0.76], overcast: 0, wind: 0.8, gust: 0.2 },
  rain: { ...ZERO, rain: 0.55, mist: 0.45, haze: 0.25, hazeColor: [0.56, 0.61, 0.68], overcast: 0.6, wind: 2.2, gust: 0.35 },
  storm: { ...ZERO, rain: 1, mist: 0.8, storm: 1, haze: 0.42, hazeColor: [0.44, 0.49, 0.57], overcast: 0.85, wind: 4.6, gust: 0.6 },
  snow: { ...ZERO, snow: 1, snowMist: 0.4, haze: 0.32, hazeColor: [0.8, 0.84, 0.9], overcast: 0.55, wind: 1.4, gust: 0.4 },
  fog: { ...ZERO, fog: 1, haze: 0.62, hazeColor: [0.66, 0.7, 0.76], overcast: 0.5, wind: 0.45, gust: 0.15 },
  dust: { ...ZERO, grit: 1, dust: 1, haze: 0.5, hazeColor: [0.8, 0.58, 0.33], overcast: 0.45, wind: 8.5, gust: 0.45 },
};

const KINDS: readonly WeatherKind[] = ['clear', 'rain', 'storm', 'snow', 'fog', 'dust'];

/** Haze puff looks: fog banks, rain mist, sandstorm streams, light snow mist. */
interface PuffLook {
  color: Rgb; shadow: Rgb; opacity: number; size: number; lo: number; hi: number;
  aniso: number; valley: number; shapeLo: number; shapeHi: number; noise: number; stretch: number; tilt: number;
}
const LOOK_FOG: PuffLook = { color: [0.72, 0.76, 0.82], shadow: [0.5, 0.55, 0.62], opacity: 0.6, size: 7.5, lo: 0.25, hi: 1.9, aniso: 0.3, valley: 1, shapeLo: 0.3, shapeHi: 0.85, noise: 0.045, stretch: 0.15, tilt: 0.12 };
const LOOK_MIST: PuffLook = { color: [0.6, 0.65, 0.72], shadow: [0.42, 0.47, 0.55], opacity: 0.32, size: 8.5, lo: 0.4, hi: 2.8, aniso: 0.8, valley: 0.4, shapeLo: 0.36, shapeHi: 0.9, noise: 0.05, stretch: 0.4, tilt: 0.2 };
const LOOK_DUST: PuffLook = { color: [0.86, 0.64, 0.38], shadow: [0.58, 0.4, 0.23], opacity: 0.55, size: 8.5, lo: 0.2, hi: 3.2, aniso: 1.9, valley: 0, shapeLo: 0.28, shapeHi: 0.85, noise: 0.035, stretch: 2.6, tilt: 0.25 };
const LOOK_SNOW: PuffLook = { color: [0.86, 0.89, 0.94], shadow: [0.66, 0.7, 0.78], opacity: 0.25, size: 8, lo: 0.3, hi: 2.2, aniso: 0.3, valley: 0.6, shapeLo: 0.4, shapeHi: 0.9, noise: 0.045, stretch: 0.2, tilt: 0.15 };

const srgb = (c: number) => Math.pow(c, 2.2);
const smooth = (x: number) => x * x * (3 - 2 * x);

export class Weather {
  /** 0..1 how wet the ground is: rain/storm ramps it up over ~20 s, it dries over ~60 s. */
  wetness = 0;
  /** 0..1 accumulated snow cover (~90 s to full); melts over ~70 s (faster in rain) once it stops snowing. */
  snow = 0;
  /** 0..1 current lightning flash brightness (decays within ~0.3 s; flickers with the return strokes). */
  flash = 0;
  /** 0..1 how much distance/height haze to apply (fog 0.62, dust 0.5, storm 0.42, snow 0.32, rain 0.25). */
  haze = 0;
  /** Haze tint in linear RGB (fog = cool grey, dust = ochre). Unlit: multiply by your ambient level, or use hazeColorLit. */
  readonly hazeColor = new THREE.Color().setRGB(0.66, 0.7, 0.76, THREE.SRGBColorSpace);
  /** hazeColor already multiplied by the current scene light (sun + hemisphere) — ready for fog colour. */
  readonly hazeColorLit = new THREE.Color();
  /** 0..1 how much to dim the sun (overcast). */
  overcast = 0;
  /** Wind in world units/s (x, z). Gusts in storms/dust. Drives rain slant, drift and dust. */
  readonly wind = new THREE.Vector2(0.6, 0.2);
  /**
   * Fired on each lightning strike with brightness 0..1 and the strike's world position (on the
   * ground for bolts). Cloud-to-cloud flashes also fire it with `cloud = true`, a lower intensity
   * and a position up in the clouds (play a softer, longer rumble). `pos` is a fresh vector.
   */
  onLightning?: (intensity: number, pos: THREE.Vector3, cloud?: boolean) => void;
  /** Uniforms for patchMaterialForWeather() / custom shaders; updated every frame. */
  readonly surfaceUniforms: WeatherSurfaceUniforms = { uWxWet: { value: 0 }, uWxSnow: { value: 0 } };
  /** Current eased blend weight of each kind (sums to 1). */
  readonly weights: Record<WeatherKind, number> = { clear: 1, rain: 0, storm: 0, snow: 0, fog: 0, dust: 0 };
  /** Effect intensities 0..1, handy for ambience audio (rain loop volume, wind howl, …). */
  readonly levels = { rain: 0, snow: 0, dust: 0, fog: 0, storm: 0, wind: 0 };
  /** Draw calls issued by weather this frame, live particle budget and CPU time of update(). */
  readonly stats = { drawCalls: 0, particles: 0, cpuMs: 0 };

  private target: WeatherKind = 'clear';
  private amt = new Float32Array([1, 0, 0, 0, 0, 0]);
  private fadeRate = 0.1;
  private clock = 0;
  private rng: Rng;
  private hf: HeightField;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private getHeight: (x: number, z: number) => number;
  private mapW: number;
  private mapH: number;
  private water: number;
  private res = new THREE.Vector2(1, 1);
  private rain: PrecipLayer;
  private snowFx: PrecipLayer;
  private grit: PrecipLayer;
  private splash: SplashLayer;
  private puffs: HazeLayer;
  private bolt: Lightning;
  private windBase: number;
  private strikeT = 4;
  private cloudT = 2;
  private sunLight: THREE.DirectionalLight | null = null;
  private hemiLight: THREE.HemisphereLight | null = null;
  private lightScan = 0;
  private light = new THREE.Color(1, 1, 1);
  // scratch
  private camPos = new THREE.Vector3();
  private focus = new THREE.Vector3();
  private right = new THREE.Vector3();
  private fwd = new THREE.Vector3();
  private toCam = new THREE.Vector3();
  private vBase = new THREE.Vector3();
  private vA = new THREE.Vector3();
  private vB = new THREE.Vector3();
  private vC = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private tmpC = new THREE.Color();
  private hazeAcc = new THREE.Color();
  private scroll = new THREE.Vector4();
  private lastR = 20;
  private lastD = 26;

  constructor(opts: WeatherOptions) {
    this.scene = opts.scene;
    this.camera = opts.camera;
    this.renderer = opts.renderer;
    this.getHeight = opts.getHeight;
    this.mapW = opts.mapW;
    this.mapH = opts.mapH;
    this.water = opts.waterLevel;
    const seed = opts.seed ?? 1337;
    this.rng = new Rng(seed);
    this.windBase = this.rng.next() * Math.PI * 2;
    const q = Math.max(0.2, Math.min(1, opts.quality ?? 1));
    this.hf = buildHeightField(opts.getHeight, opts.mapW, opts.mapH);
    this.renderer.getDrawingBufferSize(this.res);

    this.rain = new PrecipLayer('rain', Math.round(16000 * q), seed + 1, this.res);
    this.snowFx = new PrecipLayer('snow', Math.round(11000 * q), seed + 2, this.res);
    this.grit = new PrecipLayer('grit', Math.round(7000 * q), seed + 3, this.res);
    this.splash = new SplashLayer(Math.round(3200 * q), seed + 4, this.hf, this.water);
    this.puffs = new HazeLayer(Math.round(120 * Math.max(0.5, q)), seed + 5, this.hf, this.water);
    this.bolt = new Lightning(this.res);

    // fixed per-layer looks
    const ru = this.rain.uniforms;
    ru.uStreak.value = 0.036; ru.uWidth.value = 0.022; ru.uSizeVar.value = 0.25; ru.uMinPx.value = 0.6; ru.uOpacity.value = 0.42; ru.uOccl.value = 0.25;
    const su = this.snowFx.uniforms;
    su.uStreak.value = 0.025; su.uWidth.value = 0.085; su.uSizeVar.value = 0.45; su.uMinPx.value = 0.85; su.uOpacity.value = 0.95; su.uOccl.value = 0.85;
    su.uTurb.value.set(0.35, 0.9, 0, 0);
    const gu = this.grit.uniforms;
    gu.uStreak.value = 0.05; gu.uWidth.value = 0.02; gu.uSizeVar.value = 0.5; gu.uMinPx.value = 0.6; gu.uOpacity.value = 0.6; gu.uOccl.value = 0.6;
    gu.uTurb.value.set(0.9, 2.0, 0.7, 0);

    // draw order among weather layers (after the game's own transparents)
    this.puffs.mesh.renderOrder = 20;
    this.splash.mesh.renderOrder = 21;
    this.grit.mesh.renderOrder = 22;
    this.rain.mesh.renderOrder = 23;
    this.snowFx.mesh.renderOrder = 24;
    this.bolt.mesh.renderOrder = 25;
    for (const m of [this.puffs.mesh, this.splash.mesh, this.grit.mesh, this.rain.mesh, this.snowFx.mesh, this.bolt.mesh]) this.scene.add(m);
    this.findLights();
  }

  /** Target weather kind (the one being faded to). */
  get kind(): WeatherKind {
    return this.target;
  }

  /** Cross-fade to a new weather type over `seconds` (0 = instant). */
  set(kind: WeatherKind, seconds = 10): void {
    this.target = kind;
    if (seconds <= 0) {
      for (let i = 0; i < KINDS.length; i++) this.amt[i] = KINDS[i] === kind ? 1 : 0;
    }
    this.fadeRate = 1 / Math.max(0.001, seconds);
  }

  /** Force a lightning strike now (at a world position, or somewhere in view). */
  strike(x?: number, z?: number, intensity = 1): void {
    this.doStrike(x, z, intensity);
  }

  /** Force a cloud-to-cloud flash now. */
  cloudFlash(intensity = 0.5): void {
    this.doCloud(intensity);
  }

  private findLights(): void {
    this.sunLight = null;
    this.hemiLight = null;
    const ch = this.scene.children;
    for (let i = 0; i < ch.length; i++) {
      const o = ch[i] as THREE.Object3D & { isDirectionalLight?: boolean; isHemisphereLight?: boolean };
      if (o.isDirectionalLight && !this.sunLight) this.sunLight = o as THREE.DirectionalLight;
      else if (o.isHemisphereLight && !this.hemiLight) this.hemiLight = o as THREE.HemisphereLight;
    }
  }

  /** Approximate light falling on a floating particle (linear RGB), from the scene's sun + sky lights. */
  private readLights(): void {
    if ((!this.sunLight || !this.hemiLight) && --this.lightScan <= 0) {
      this.lightScan = 120;
      this.findLights();
    }
    const L = this.light;
    const h = this.hemiLight, s = this.sunLight;
    if (h) {
      L.copy(h.color).multiplyScalar(0.75 * h.intensity);
      this.tmpC.copy(h.groundColor).multiplyScalar(0.25 * h.intensity);
      L.add(this.tmpC);
    } else L.setRGB(0.4, 0.45, 0.55);
    L.multiplyScalar(0.9);
    if (s) {
      this.tmpC.copy(s.color).multiplyScalar(0.22 * s.intensity);
      L.add(this.tmpC);
    } else L.add(this.tmpC.setRGB(0.5, 0.48, 0.45));
  }

  /** Call every frame. focus = camera ground focus point (x, z), viewRadius ≈ half the visible width (10..45). */
  update(dt: number, time: number, focusX: number, focusZ: number, viewRadius: number): void {
    const t0 = performance.now();
    dt = Math.min(Math.max(dt, 0), 0.1);
    this.clock += dt;
    const clock = this.clock;

    // --- cross-fade weights ---------------------------------------------------------------
    let sum = 0;
    const step = this.fadeRate * dt;
    for (let i = 0; i < KINDS.length; i++) {
      const goal = KINDS[i] === this.target ? 1 : 0;
      const a = this.amt[i];
      this.amt[i] = a < goal ? Math.min(goal, a + step) : Math.max(goal, a - step);
      sum += smooth(this.amt[i]);
    }
    const w = this.weights;
    for (let i = 0; i < KINDS.length; i++) w[KINDS[i]] = sum > 0 ? smooth(this.amt[i]) / sum : 0;

    // --- blended scalars ------------------------------------------------------------------
    let rainD = 0, snowD = 0, gritD = 0, storm = 0, haze = 0, overcast = 0, windS = 0, gust = 0;
    this.hazeAcc.setRGB(0, 0, 0);
    for (let i = 0; i < KINDS.length; i++) {
      const k = w[KINDS[i]];
      if (k <= 0) continue;
      const p = PROFILES[KINDS[i]];
      rainD += k * p.rain; snowD += k * p.snow; gritD += k * p.grit; storm += k * p.storm;
      haze += k * p.haze; overcast += k * p.overcast; windS += k * p.wind; gust += k * p.gust;
      this.tmpC.setRGB(srgb(p.hazeColor[0]), srgb(p.hazeColor[1]), srgb(p.hazeColor[2])).multiplyScalar(k * p.haze);
      this.hazeAcc.add(this.tmpC);
    }
    this.haze = haze;
    this.overcast = overcast;
    if (haze > 1e-4) this.hazeColor.copy(this.hazeAcc).multiplyScalar(1 / haze);

    // --- wind -----------------------------------------------------------------------------
    const ang = this.windBase + 0.45 * Math.sin(clock * 0.011) + 0.22 * Math.sin(clock * 0.029 + 1.3);
    const g = 0.55 * Math.sin(clock * 0.63) + 0.3 * Math.sin(clock * 1.71 + 0.7) + 0.15 * Math.sin(clock * 3.9 + 2.1);
    const gf = g > 0 ? g * 1.5 : g * 0.6;
    const ws = windS * Math.max(0.15, 1 + gust * gf);
    const kw = 1 - Math.exp(-dt * 1.6);
    this.wind.x += (Math.cos(ang) * ws - this.wind.x) * kw;
    this.wind.y += (Math.sin(ang) * ws - this.wind.y) * kw;
    const wlen = this.wind.length();

    // --- ground state ---------------------------------------------------------------------
    const raining = w.rain + w.storm;
    if (raining > 0.05) this.wetness = Math.min(1, this.wetness + (dt / 20) * (0.55 + 0.45 * rainD) * Math.min(1, raining * 1.25));
    else this.wetness = Math.max(0, this.wetness - (dt / 60) * (1 + 1.5 * w.dust));
    if (w.snow > 0.05) this.snow = Math.min(1, this.snow + (dt / 90) * w.snow);
    else if (this.snow > 0) {
      this.snow = Math.max(0, this.snow - dt / (raining > 0.05 ? 35 : 70) * (1 + w.dust));
      this.wetness = Math.max(this.wetness, Math.min(0.75, this.snow * 2.5)); // meltwater
    }
    this.surfaceUniforms.uWxWet.value = this.wetness;
    this.surfaceUniforms.uWxSnow.value = this.snow;

    // --- lighting -------------------------------------------------------------------------
    this.readLights();
    const L = this.light;
    this.hazeColorLit.copy(this.hazeColor).multiply(L);
    this.renderer.getDrawingBufferSize(this.res);

    // --- camera frame ---------------------------------------------------------------------
    const e = this.camera.matrixWorld.elements;
    this.camPos.set(e[12], e[13], e[14]);
    this.right.set(e[0], 0, e[2]);
    if (this.right.lengthSq() < 1e-8) this.right.set(1, 0, 0);
    this.right.normalize();
    this.fwd.set(this.right.z, 0, -this.right.x); // up × right: horizontal "into the screen"
    const gy = Math.max(this.getHeight(focusX, focusZ), this.water);
    this.focus.set(focusX, gy, focusZ);
    this.toCam.subVectors(this.camPos, this.focus);
    let D = this.toCam.length();
    if (D < 1e-3) { D = 1; this.toCam.set(0, 1, 0); } else this.toCam.multiplyScalar(1 / D);
    const R = Math.max(4, viewRadius);
    this.lastR = R;
    this.lastD = D;
    const camH = Math.max(2, this.camPos.y - gy);
    const flash = this.flash;
    let draws = 0, parts = 0;

    // --- rain -----------------------------------------------------------------------------
    this.rain.setDensity(rainD);
    if (this.rain.mesh.visible) {
      this.precipFrame(this.rain, R, D, 0.8, -1.5);
      this.vel.set(this.wind.x, -17, this.wind.y);
      this.rain.volume.drift(this.vel, dt, this.rain.lanes);
      const u = this.rain.uniforms;
      u.uVel.value.copy(this.vel);
      u.uNear.value.set(D * 0.26, D * 0.5);
      u.uTime.value = clock;
      u.uColor.value.copy(L).multiplyScalar(0.55).add(this.tmpC.setRGB(0.035, 0.045, 0.065)).add(this.tmpC.setRGB(1.6, 1.7, 2.0).multiplyScalar(flash));
      draws++; parts += this.rain.geometry.instanceCount;
    }
    // --- splashes -------------------------------------------------------------------------
    this.splash.setDensity(rainD);
    if (this.splash.mesh.visible) {
      this.vBase.copy(this.focus).addScaledVector(this.fwd, R * 0.28);
      this.vA.copy(this.right).multiplyScalar(R * 2.3 + 4);
      this.vB.copy(this.fwd).multiplyScalar(R * 1.5 + 4);
      this.splash.setFrame(this.vBase, this.vA, this.vB);
      const u = this.splash.uniforms;
      u.uTime.value = clock;
      u.uColor.value.copy(L).multiplyScalar(0.7).add(this.tmpC.setRGB(0.04, 0.05, 0.07)).add(this.tmpC.setRGB(1.2, 1.3, 1.6).multiplyScalar(flash));
      draws++; parts += this.splash.geometry.instanceCount;
    }
    // --- snow -----------------------------------------------------------------------------
    this.snowFx.setDensity(snowD);
    if (this.snowFx.mesh.visible) {
      this.precipFrame(this.snowFx, R, D, 0.72, -1.0);
      this.vel.set(this.wind.x * 0.85, -1.25, this.wind.y * 0.85);
      this.snowFx.volume.drift(this.vel, dt, this.snowFx.lanes);
      const u = this.snowFx.uniforms;
      u.uVel.value.copy(this.vel);
      u.uNear.value.set(D * 0.2, D * 0.42);
      u.uTime.value = clock;
      u.uColor.value.copy(L).multiplyScalar(0.95).add(this.tmpC.setRGB(0.06, 0.065, 0.085)).add(this.tmpC.setRGB(1.0, 1.05, 1.2).multiplyScalar(flash));
      draws++; parts += this.snowFx.geometry.instanceCount;
    }
    // --- grit -----------------------------------------------------------------------------
    this.grit.setDensity(gritD);
    if (this.grit.mesh.visible) {
      this.precipFrame(this.grit, R, D, 0.42, -0.6);
      this.vel.set(this.wind.x * 1.3, -0.5, this.wind.y * 1.3);
      this.grit.volume.drift(this.vel, dt, this.grit.lanes);
      const u = this.grit.uniforms;
      u.uVel.value.copy(this.vel);
      u.uNear.value.set(D * 0.3, D * 0.55);
      u.uTime.value = clock;
      u.uColor.value.setRGB(srgb(0.86), srgb(0.66), srgb(0.42)).multiply(L).multiplyScalar(0.9).add(this.tmpC.setRGB(0.03, 0.022, 0.012));
      draws++; parts += this.grit.geometry.instanceCount;
    }
    // --- haze puffs -----------------------------------------------------------------------
    draws += this.updatePuffs(dt, R, w, L, wlen) ? 1 : 0;
    parts += this.puffs.geometry.instanceCount;

    // --- lightning ------------------------------------------------------------------------
    if (storm > 0.3) {
      this.strikeT -= dt * storm;
      this.cloudT -= dt * storm;
      if (this.strikeT <= 0) {
        this.doStrike(undefined, undefined, this.rng.range(0.75, 1));
        this.strikeT = this.rng.range(6, 20);
      }
      if (this.cloudT <= 0) {
        this.doCloud(this.rng.range(0.25, 0.55));
        this.cloudT = this.rng.range(3.5, 11);
      }
    } else {
      this.strikeT = Math.max(this.strikeT, 4);
      this.cloudT = Math.max(this.cloudT, 2);
    }
    this.flash = this.bolt.update(dt);
    if (this.bolt.mesh.visible) draws++;
    void camH;

    this.levels.rain = rainD;
    this.levels.snow = snowD;
    this.levels.dust = gritD;
    this.levels.fog = w.fog;
    this.levels.storm = storm;
    this.levels.wind = Math.min(1, wlen / 9);
    this.stats.drawCalls = draws;
    this.stats.particles = parts;
    this.stats.cpuMs = this.stats.cpuMs * 0.95 + (performance.now() - t0) * 0.05;
    void time;
  }

  /** Camera-aligned prism: footprint covers the visible ground, columns lean towards the camera. */
  private precipFrame(layer: PrecipLayer, R: number, D: number, height: number, sink: number): void {
    this.vBase.copy(this.focus).addScaledVector(this.fwd, R * 0.3);
    this.vBase.y += sink;
    this.vA.copy(this.right).multiplyScalar(R * 2.6 + 8);
    this.vB.copy(this.fwd).multiplyScalar(R * 1.8 + 8);
    this.vC.copy(this.toCam).multiplyScalar(D * height);
    layer.volume.setFrame(this.vBase, this.vA, this.vB, this.vC);
  }

  private updatePuffs(dt: number, R: number, w: Record<WeatherKind, number>, L: THREE.Color, wlen: number): boolean {
    const P = PROFILES;
    const cFog = w.fog * P.fog.fog;
    const cMist = w.rain * P.rain.mist + w.storm * P.storm.mist;
    const cDust = w.dust * P.dust.dust;
    const cSnow = w.snow * P.snow.snowMist;
    const total = cFog + cMist + cDust + cSnow;
    const density = Math.min(1, cFog + cDust + cMist * 0.85 + cSnow);
    this.puffs.setDensity(density);
    if (!this.puffs.mesh.visible || total <= 1e-5) return false;
    const u = this.puffs.uniforms;
    // blend the looks
    const b = this.look;
    b.opacity = b.size = b.lo = b.hi = b.aniso = b.valley = b.shapeLo = b.shapeHi = b.noise = b.stretch = b.tilt = 0;
    u.uColor.value.setRGB(0, 0, 0);
    u.uShadow.value.setRGB(0, 0, 0);
    this.addLook(LOOK_FOG, cFog / total);
    this.addLook(LOOK_MIST, cMist / total);
    this.addLook(LOOK_DUST, cDust / total);
    this.addLook(LOOK_SNOW, cSnow / total);
    const op = b.opacity, size = b.size, lo = b.lo, hi = b.hi, an = b.aniso, va = b.valley;
    const sl = b.shapeLo, sh = b.shapeHi, ns = b.noise, st = b.stretch, ti = b.tilt;
    const flashBoost = 1 + this.flash * 1.5;
    u.uColor.value.multiply(L).multiplyScalar(flashBoost);
    u.uShadow.value.multiply(L).multiplyScalar(flashBoost);
    u.uOpacity.value = op;
    const zoom = Math.min(2.3, Math.max(0.6, R / 19.5));
    const s = size * zoom;
    u.uSize.value = s;
    u.uLayer.value.set(lo, hi);
    u.uAniso.value = an;
    u.uValley.value = va;
    u.uTilt.value = ti;
    u.uShape.value.set(sl, sh);
    u.uTime.value = this.clock;
    if (wlen > 1e-3) u.uWindDir.value.set(this.wind.x / wlen, this.wind.y / wlen);
    // noise: world xz -> uv, stretched along the (slowly varying) prevailing wind
    const ca = Math.cos(this.windBase), sa = Math.sin(this.windBase);
    const sAlong = ns / (1 + st), sAcross = ns;
    u.uNoiseM.value.set(sAlong * ca, sAlong * sa, -sAcross * sa, sAcross * ca);
    // noise advects a bit slower / faster than the puffs so banks morph as they drift
    const sc = this.scroll;
    const wx = this.wind.x, wz = this.wind.y;
    const ax = sAlong * ca * wx + sAlong * sa * wz, az = -sAcross * sa * wx + sAcross * ca * wz;
    sc.x = (sc.x - ax * dt * 0.75) % 1; sc.y = (sc.y - az * dt * 0.75) % 1;
    sc.z = (sc.z - ax * dt * 2.3 * 1.25) % 1; sc.w = (sc.w - az * dt * 2.3 * 1.25) % 1;
    u.uScroll.value.copy(sc);
    // footprint
    this.vBase.copy(this.focus).addScaledVector(this.fwd, R * 0.25);
    this.vA.copy(this.right).multiplyScalar(R * 2.4 + 6 + 2 * s);
    this.vB.copy(this.fwd).multiplyScalar(R * 1.55 + 6 + 2 * s);
    this.puffs.setFrame(this.vBase, this.vA, this.vB);
    this.vel.set(this.wind.x, 0, this.wind.y);
    this.puffs.drift(this.vel, dt, PUFF_LANES);
    return true;
  }

  private look = { opacity: 0, size: 0, lo: 0, hi: 0, aniso: 0, valley: 0, shapeLo: 0, shapeHi: 0, noise: 0, stretch: 0, tilt: 0 };

  private addLook(look: PuffLook, k: number): void {
    if (k <= 0) return;
    const b = this.look, u = this.puffs.uniforms;
    b.opacity += look.opacity * k; b.size += look.size * k; b.lo += look.lo * k; b.hi += look.hi * k; b.aniso += look.aniso * k;
    b.valley += look.valley * k; b.shapeLo += look.shapeLo * k; b.shapeHi += look.shapeHi * k; b.noise += look.noise * k;
    b.stretch += look.stretch * k; b.tilt += look.tilt * k;
    const c = u.uColor.value, d = u.uShadow.value;
    c.r += srgb(look.color[0]) * k; c.g += srgb(look.color[1]) * k; c.b += srgb(look.color[2]) * k;
    d.r += srgb(look.shadow[0]) * k; d.g += srgb(look.shadow[1]) * k; d.b += srgb(look.shadow[2]) * k;
  }

  private doStrike(x: number | undefined, z: number | undefined, intensity: number): void {
    const R = this.lastR, rng = this.rng;
    const gx = Math.min(this.mapW - 0.5, Math.max(0.5, x ?? this.focus.x + rng.spread(R * 0.9)));
    const gz = Math.min(this.mapH - 0.5, Math.max(0.5, z ?? this.focus.z - R * 0.8 + rng.next() * R * 1.1));
    const gy = Math.max(this.getHeight(gx, gz), this.water);
    const top = gy + rng.range(40, 54);
    this.bolt.strike(gx + rng.spread(10), top, gz - rng.range(8, 22), gx, gy, gz, intensity, rng);
    this.onLightning?.(intensity, new THREE.Vector3(gx, gy, gz), false);
  }

  private doCloud(intensity: number): void {
    const R = this.lastR, rng = this.rng;
    const camH = Math.max(2, this.camPos.y - this.focus.y);
    const x = this.focus.x + rng.spread(R * 1.1);
    const z = this.focus.z - R * rng.range(0.1, 0.9);
    const y = this.focus.y + camH * rng.range(0.35, 0.6);
    this.bolt.cloudFlash(x, y, z, R * rng.range(0.6, 1.0), intensity, rng);
    this.onLightning?.(intensity * 0.6, new THREE.Vector3(x, y + 20, z), true);
  }

  dispose(): void {
    for (const m of [this.puffs.mesh, this.splash.mesh, this.grit.mesh, this.rain.mesh, this.snowFx.mesh, this.bolt.mesh]) this.scene.remove(m);
    this.rain.dispose();
    this.snowFx.dispose();
    this.grit.dispose();
    this.splash.dispose();
    this.puffs.dispose();
    this.bolt.dispose();
    this.hf.texture.dispose();
  }
}

const PUFF_LANES = [0.7, 1.0, 1.0, 1.0];
