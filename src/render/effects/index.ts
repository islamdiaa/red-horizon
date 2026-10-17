/**
 * Visual effects system.
 *
 * Draw calls (always): decals 1, main particles 1, beams 1, projectile sprites 1, glow particles 1
 * (+1 per active Iron Curtain shell). Particles/beams are GPU-animated ring buffers: the CPU only
 * writes newly spawned elements; update() advances the clock, runs emitters and uploads new data.
 * GPU-simulated particles (gpuparticles.ts: 8k / 32k / 64k by quality, +1 draw, +1-2 small sim
 * passes while alive) layered on explosions, fires and splashes; light flashes become dynamic lights
 * (render/dynlights.ts, hundreds at once, no THREE.Light); ctx.terrain digs persistent craters / ruts.
 *
 * Game-feel layers on top (spectacle.ts, director in juice.ts): explosion variety and flak air bursts,
 * hit flashes, heavy-vehicle cook-offs, smoke columns ('column' emitters), richer tesla bolts, MG tracer bursts,
 * calibre-scaled muzzle lights, veterancy / milestone bursts. No new draw calls; skipped off-screen (lodAt),
 * scaled by quality (`juice`: Low 0 = no extra layers, Medium 0.65, High 1) and off with ?juice=0. Shake is
 * attenuated by the distance from the camera focus (setFocus) before it reaches `shake`.
 *
 * Usage:
 *   const fx = new Effects({ scene, camera, renderer, getHeight });
 *   // every frame, before rendering:
 *   fx.update(dt, time);
 *   camera shake: read fx.shake (the engine decays it).
 *   fx.dispose() on teardown.
 */
import * as THREE from 'three';
import type { ExplosionKind, ProjectileKind } from '../../data/rules';
import type { EffectsApi, EffectsOptions, EmitterHandle, EmitterKind, ProjectileHandle } from './types';
import type { FxContext } from './context';
import { createEffectTextures, D, R, type EffectTextures } from './textures';
import { ParticleBatch, createParticleUniforms, type ParticleUniforms } from './particles';
import { BeamBatch } from './beams';
import { SpriteBatch } from './sprites';
import { DecalSystem } from './decals';
import { LightPool } from './lights';
import { ShellPool } from './shells';
import { explosion as explode } from './explosions';
import { spawnProjectile } from './projectiles';
import { muzzleFlash, tracer, teslaBolt, flameStream, tracerBurst, setTeslaStyle } from './weapons';
import { explosionExtras, flakField, heavyDeath, hitFlash, milestoneBurst, promotionBurst } from './spectacle';
import { shakeFalloff } from './juicelogic';
import { JUICE } from './juiceflags';
import { healPulse, dust, constructionBurst, chronoFlash, ironCurtainPulse, oreSparkle, orderMarker, AmbientMotes } from './misc';
import { Emitter } from './emitters';
import { rnd, range } from './rand';
import { BodyPool } from './bodies';
import { Flights } from './flights';
import { waterSplash, underwaterBlast, sonarPing, bowSpray, radarJamPulse, mineBlast, bubbles } from './water';
import { TrailVisual, type TrailKind } from './specialproj';
import type { FxCue } from './context';
import { WATER_LEVEL } from '../../sim/map';
import { GpuParticles, gpuParticlesSupported, GK, type GpuParticleApi } from './gpuparticles';
import { gpuExplosion } from './gpufx';
import type { DynamicLightApi, DynamicLightOptions } from '../dynlights';
import type { TerrainDeformApi, TerrainMesh } from '../terrain';
import { getNoiseTexture } from '../terrain';

export type { EffectsApi, EffectsOptions, EmitterHandle, EmitterKind, ProjectileHandle } from './types';
export type { FxCue } from './context';
export type { TrailKind } from './specialproj';
export type { GpuParticleApi, GpuKind, BurstOptions } from './gpuparticles';
export { GK } from './gpuparticles';
export type { DynamicLightApi, DynamicLightOptions } from '../dynlights';
export type { TerrainDeformApi } from '../terrain';

export interface EffectsStats {
  mainAlive: number;
  glowAlive: number;
  spawnedTotal: number;
  emitters: number;
  drawCalls: number;
  /** GPU particle slots (0 when unsupported) and particles spawned on the GPU so far. */
  gpuCapacity?: number;
  gpuSpawned?: number;
}

/** GPU particle buffer (texels across, down) and count multiplier per quality preset. */
const GPU_SIZE: Record<'low' | 'medium' | 'high', [number, number, number]> = { low: [128, 64, 0.3], medium: [256, 128, 0.6], high: [256, 256, 1] };

const MAIN_CAPACITY = 16384;
const GLOW_CAPACITY = 8192;
const BEAM_CAPACITY = 8192;
const SPRITE_CAPACITY = 768;
const DECAL_CAPACITY = 200;
const LIGHT_COUNT = 6;
/** Spectacle level per quality preset (Low: no extra layers). */
const JUICE_LEVEL: Record<'low' | 'medium' | 'high', number> = { low: 0, medium: 0.65, high: 1 };
// reused light options (no allocation per shot)
const MUZZLE_BIG = { attack: 0.006, flicker: 0, priority: 0.8 };
const MUZZLE_SMALL = { attack: 0.004, flicker: 0.35, priority: 0.45 };
const _lod = new THREE.Vector3();

export class Effects implements EffectsApi {
  /** Accumulated camera shake; the engine reads and decays it. */
  shake = 0;
  /** Root group holding all effect meshes (added to the scene). */
  readonly root = new THREE.Group();

  private tex: EffectTextures;
  private uniforms: ParticleUniforms;
  private main: ParticleBatch;
  private glow: ParticleBatch;
  private beams: BeamBatch;
  private sprites: SpriteBatch;
  private decals: DecalSystem;
  private lights: LightPool;
  private shells: ShellPool;
  private ambient = new AmbientMotes();
  private bodies: BodyPool;
  private flights = new Flights();
  private emitters: Emitter[] = [];
  // delayed audio cues (parallel arrays, no allocations)
  private cueT: number[] = [];
  private cueK: FxCue[] = [];
  private cueP: number[] = [];
  private readonly cuePos = new THREE.Vector3();
  /**
   * Audio hook for effect moments: 'splash' (water splash), 'thump' (underwater blast),
   * 'bomb' (a bomb starts falling — whistle), 'sonar', 'launch' (GPS rocket ignition), 'torpedo'.
   * The position object is reused: copy it if you keep it.
   */
  onCue: ((cue: FxCue, pos: THREE.Vector3) => void) | null = null;
  private ctx: FxContext;
  private now = 0;
  // delayed shake (parallel arrays, no allocations)
  private shakeT: number[] = [];
  private shakeA: number[] = [];
  private gpuP: GpuParticles | null = null;
  /**
   * Opt-in: persistent craters + burn marks for ground explosions when the recipe did not dig one itself.
   * Off in the game: the destruction system (destruction.ts) owns the crater policy (cap + healing).
   */
  autoCraters = false;
  private deformCalls = 0;
  private readonly terrainProxy: TerrainDeformApi = {
    deform: (x, y, r, d) => { this.deformCalls++; (this.scene.userData.terrain as TerrainDeformApi | undefined)?.deform(x, y, r, d); },
    scorch: (x, y, r, a) => { this.deformCalls++; (this.scene.userData.terrain as TerrainDeformApi | undefined)?.scorch(x, y, r, a); },
    rut: (x0, y0, x1, y1, w, d) => (this.scene.userData.terrain as TerrainDeformApi | undefined)?.rut(x0, y0, x1, y1, w, d),
    renderHeight: (x, y) => (this.scene.userData.terrain as TerrainDeformApi | undefined)?.renderHeight(x, y) ?? 0,
  };
  /** The game renderer runs the GPU particle simulation itself (inside its frame, counted in its stats). */
  private simHook = false;
  private scene: THREE.Scene;
  // camera focus (shake falloff), the position of the effect being spawned, spectacle level
  private camera: THREE.PerspectiveCamera;
  private focusX = 0;
  private focusZ = 0;
  private focusR = 0;
  private shX = 0;
  private shZ = 0;
  private shAt = false;
  /** 0 = no spectacle layers (Low preset or ?juice=0), 0.65 medium, 1 high (see setJuice). */
  juice: number;
  private juiceLevel = 1;

  constructor(opts: EffectsOptions) {
    this.tex = createEffectTextures();
    this.uniforms = createParticleUniforms(this.tex.atlas, this.tex.ramp);
    const u = this.uniforms;
    this.decals = new DecalSystem(DECAL_CAPACITY, this.tex.decals, opts.getHeight, u, 1);
    this.main = new ParticleBatch(MAIN_CAPACITY, u, 20);
    this.beams = new BeamBatch(
      BEAM_CAPACITY,
      { uTime: u.uTime, uWind: u.uWind, uRamp: u.uRamp, uNoise: { value: this.tex.noise } } as unknown as Record<string, THREE.IUniform>,
      21,
    );
    this.sprites = new SpriteBatch(SPRITE_CAPACITY, this.tex.atlas, 22);
    this.glow = new ParticleBatch(GLOW_CAPACITY, u, 23);
    this.shells = new ShellPool(4, this.tex.noise, 24);
    this.lights = new LightPool(opts.scene, LIGHT_COUNT);
    this.bodies = new BodyPool(0);
    this.scene = opts.scene;
    this.camera = opts.camera;
    // GPU particles (float MRT) and the renderer's terrain for collisions and craters
    const ud = opts.scene.userData;
    const terrain = (ud.terrain as TerrainMesh | undefined) ?? null;
    const quality = (ud.fxQuality as 'low' | 'medium' | 'high' | undefined) ?? 'high';
    this.juiceLevel = JUICE_LEVEL[quality] ?? 1;
    this.juice = JUICE.on ? this.juiceLevel : 0;
    setTeslaStyle(this.juice > 0 ? 1.5 : 1);
    if (gpuParticlesSupported(opts.renderer)) {
      try {
        const [w, h, dens] = GPU_SIZE[quality] ?? GPU_SIZE.high;
        this.gpuP = new GpuParticles({
          renderer: opts.renderer, width: w, height: h, atlas: this.tex.atlas, ramp: this.tex.ramp, shared: u,
          noise: getNoiseTexture(), waterLevel: opts.waterLevel ?? WATER_LEVEL, density: dens, renderOrder: 22.5,
        });
        if (terrain) this.gpuP.setHeightField(terrain.heightTexture, terrain.heightUvXf);
        this.simHook = !!ud.fxSimHook;
        if (this.simHook) ud.gpuParticles = this.gpuP;
      } catch (e) {
        console.warn('GPU particles unavailable', e);
        this.gpuP = null;
      }
    }

    this.root.name = 'effects';
    this.root.add(this.decals.mesh, this.main.mesh, this.beams.mesh, this.sprites.mesh, this.glow.mesh, this.shells.group, this.bodies.group);
    if (this.gpuP) this.root.add(this.gpuP.mesh);
    opts.scene.add(this.root);

    // make sure freshly spawned data is uploaded even if spawns happen after update()
    this.main.mesh.onBeforeRender = () => this.main.flush();
    this.glow.mesh.onBeforeRender = () => this.glow.flush();
    this.beams.mesh.onBeforeRender = () => this.beams.flush();
    this.sprites.mesh.onBeforeRender = () => this.sprites.flush();
    this.decals.mesh.onBeforeRender = () => this.decals.flush();

    const self = this;
    this.ctx = {
      main: this.main,
      glow: this.glow,
      beams: this.beams,
      sprites: this.sprites,
      decals: this.decals,
      lights: this.lights,
      getHeight: opts.getHeight,
      now: 0,
      density: 1,
      waterLevel: opts.waterLevel ?? WATER_LEVEL,
      isWater:
        opts.isWater ??
        ((x: number, z: number) => opts.getHeight(x, z) <= (opts.waterLevel ?? WATER_LEVEL) + 1e-4),
      bodies: this.bodies,
      dyn: this.lights.api,
      gpu: this.gpuP,
      // looked up every time (the renderer may rebuild its terrain for the map editor); counted, so the
      // automatic craters stand back when a recipe digs its own
      get terrain(): TerrainDeformApi | null {
        return self.scene.userData.terrain ? self.terrainProxy : null;
      },
      cue(kind: FxCue, x: number, y: number, z: number, delay: number) {
        if (!self.onCue) return;
        self.cueT.push(self.now + Math.max(0, delay));
        self.cueK.push(kind);
        self.cueP.push(x, y, z);
      },
      addShake(amount: number, delay = 0) {
        // scaled by how close to the view centre the effect is (off-screen blasts don't rock the view)
        if (self.shAt && self.focusR > 0 && JUICE.on) amount *= shakeFalloff(self.shX - self.focusX, self.shZ - self.focusZ, self.focusR);
        if (!(amount > 0)) return;
        if (delay <= 0) self.shake += amount;
        else {
          self.shakeT.push(self.now + delay);
          self.shakeA.push(amount);
        }
      },
    };
  }

  // -------------------------------------------------------------------------------------------
  // Frame update

  update(dt: number, _time: number): void {
    if (!(dt > 0)) dt = 0;
    if (dt > 0.25) dt = 0.25;
    this.now += dt;
    this.syncClock();
    const ctx = this.ctx;

    // emitters
    const em = this.emitters;
    for (let i = em.length - 1; i >= 0; i--) {
      const e = em[i];
      if (!e.alive) {
        em[i] = em[em.length - 1];
        em.pop();
        continue;
      }
      e.update(ctx, dt);
    }
    this.ambient.update(ctx, dt);

    // delayed shake
    for (let i = this.shakeT.length - 1; i >= 0; i--) {
      if (this.shakeT[i] <= this.now) {
        this.shake += this.shakeA[i];
        this.shakeT[i] = this.shakeT[this.shakeT.length - 1];
        this.shakeA[i] = this.shakeA[this.shakeA.length - 1];
        this.shakeT.pop();
        this.shakeA.pop();
      }
    }

    // delayed audio cues
    for (let i = this.cueT.length - 1; i >= 0; i--) {
      if (this.cueT[i] > this.now) continue;
      const cb = this.onCue;
      if (cb) cb(this.cueK[i], this.cuePos.set(this.cueP[i * 3], this.cueP[i * 3 + 1], this.cueP[i * 3 + 2]));
      const last = this.cueT.length - 1;
      this.cueT[i] = this.cueT[last];
      this.cueK[i] = this.cueK[last];
      this.cueP[i * 3] = this.cueP[last * 3];
      this.cueP[i * 3 + 1] = this.cueP[last * 3 + 1];
      this.cueP[i * 3 + 2] = this.cueP[last * 3 + 2];
      this.cueT.pop();
      this.cueK.pop();
      this.cueP.length -= 3;
    }

    this.flights.update(dt);
    this.lights.update(this.now);
    this.shells.update(this.now);
    this.bodies.flush();

    this.main.flush();
    this.glow.flush();
    this.beams.flush();
    this.sprites.flush();
    this.decals.flush();
    // GPU particles: the game renderer simulates them inside its frame; standalone pages do it here
    if (this.gpuP) {
      this.gpuP.advance(dt);
      if (!this.simHook) this.gpuP.simulate(this.now);
    }
  }

  private syncClock(): void {
    const n = this.now;
    this.ctx.now = n;
    this.main.now = n;
    this.glow.now = n;
    this.beams.now = n;
    this.decals.now = n;
    this.uniforms.uTime.value = n;
  }

  // -------------------------------------------------------------------------------------------
  // API

  explosion(pos: THREE.Vector3, kind: ExplosionKind, scale = 1): void {
    const s = scale > 0 ? scale : 1;
    const dug = this.deformCalls;
    this.shakeAt(pos.x, pos.z);
    explode(this.ctx, kind, pos.x, pos.y, pos.z, s);
    if (this.juice > 0 && kind !== 'none' && kind !== 'nuke') {
      const lod = this.lodAt(pos.x, pos.y, pos.z);
      if (lod > 0) explosionExtras(this.ctx, kind, pos.x, pos.y, pos.z, this.ctx.getHeight(pos.x, pos.z), s, lod * this.juice);
    }
    this.shAt = false;
    if (this.autoCraters && this.deformCalls === dug) this.autoCrater(kind, pos, s);
    const gpu = this.gpuP;
    if (gpu && kind !== 'none') {
      const ctx = this.ctx;
      const water = kind !== 'nuke' && ctx.isWater(pos.x, pos.z);
      if (water && pos.y < ctx.waterLevel - 0.03) gpu.burst(GK.SPRAY, pos.x, ctx.waterLevel, pos.z, 40 * s, 3.2 * s, { life: [0.6, 1.3], size0: 0.08, size1: 0.3, alpha: 0.6, up: 0.95 });
      else gpuExplosion(gpu, kind, pos.x, pos.y, pos.z, ctx.getHeight(pos.x, pos.z), s, water);
    }
  }

  private autoCrater(kind: ExplosionKind, pos: THREE.Vector3, s: number): void {
    const t = this.ctx.terrain;
    if (!t || this.ctx.isWater(pos.x, pos.z)) return;
    const gy = this.ctx.getHeight(pos.x, pos.z);
    if (pos.y - gy > 0.7 * s && kind !== 'nuke') return; // air bursts leave the ground alone
    switch (kind) {
      case 'medium': t.deform(pos.x, pos.z, 0.55 * s, 0.1 * s); break;
      case 'large': t.deform(pos.x, pos.z, 0.85 * s, 0.18 * s); t.scorch(pos.x, pos.z, 1.2 * s, 0.35); break;
      case 'huge': t.deform(pos.x, pos.z, 1.4 * s, 0.32 * s); t.scorch(pos.x, pos.z, 2.2 * s, 0.5); break;
      case 'building': t.deform(pos.x, pos.z, Math.min(3, 0.8 + 0.5 * s), 0.16); t.scorch(pos.x, pos.z, 1.5 + s, 0.5); break;
      case 'nuke': t.deform(pos.x, pos.z, 4.5 * s, 0.9); t.scorch(pos.x, pos.z, 9 * s, 0.9); break;
      case 'fire': t.scorch(pos.x, pos.z, 0.6 * s, 0.25); break;
      default: break;
    }
  }

  muzzleFlash(pos: THREE.Vector3, dir: THREE.Vector3, size = 1): void {
    muzzleFlash(this.ctx, pos.x, pos.y, pos.z, dir.x, dir.y, dir.z, size);
    const dyn = this.ctx.dyn;
    if (!dyn) return;
    if (this.juice > 0) {
      // guns light their surroundings by calibre: cannons throw a warm, punchy flash; small arms flicker
      if (this.lodAt(pos.x, pos.y, pos.z) <= 0) return;
      if (size >= 0.95) dyn.add(pos.x + dir.x * 0.3, pos.y + 0.15, pos.z + dir.z * 0.3, 0xffb066, 4.2 * size, 3 + 2.2 * size, 0.12, MUZZLE_BIG);
      else dyn.add(pos.x + dir.x * 0.2, pos.y + 0.1, pos.z + dir.z * 0.2, 0xffd08a, 1.7 * size, 1.6 + 1.4 * size, 0.06, MUZZLE_SMALL);
      return;
    }
    dyn.add(pos.x + dir.x * 0.25, pos.y + 0.12, pos.z + dir.z * 0.25, 0xffc27a, 2.4 * size, 2.4 + 1.6 * size, 0.09, MUZZLE_BIG);
  }

  /** `burst`: extra machine-gun rounds drawn a few tens of ms apart (visual only). */
  tracer(from: THREE.Vector3, to: THREE.Vector3, color?: number, burst = 0): void {
    tracer(this.ctx, from.x, from.y, from.z, to.x, to.y, to.z, color);
    if (burst > 0 && this.juice > 0) {
      const lod = this.lodAt(to.x, to.y, to.z);
      const n = Math.round(burst * Math.min(1, lod * this.juice + 0.2));
      if (lod > 0 && n > 0) tracerBurst(this.ctx, from.x, from.y, from.z, to.x, to.y, to.z, n, color);
    }
  }

  teslaBolt(from: THREE.Vector3, to: THREE.Vector3): void {
    this.shakeAt(to.x, to.z);
    teslaBolt(this.ctx, from.x, from.y, from.z, to.x, to.y, to.z);
    this.shAt = false;
    this.ctx.dyn?.add(from.x, from.y + 0.2, from.z, 0x8fb4ff, 10, 6.5, 0.35, { attack: 0.01, flicker: 0.5 });
    this.gpuP?.burst(GK.SPARK, to.x, to.y + 0.05, to.z, 24, 4, { life: [0.2, 0.6], size0: 0.02, up: 0.6, ramp: R.TESLA });
  }

  flameStream(from: THREE.Vector3, to: THREE.Vector3): void {
    flameStream(this.ctx, from.x, from.y, from.z, to.x, to.y, to.z);
  }

  healPulse(pos: THREE.Vector3): void {
    healPulse(this.ctx, pos.x, pos.y, pos.z);
  }

  /**
   * Visual for an in-flight projectile. `size` scales cannon / ballistic shells (1.8 for the cruiser's
   * 8-inch guns) and bombs. 'torpedo' | 'depthcharge' | 'bomb' get dedicated visuals.
   */
  spawnProjectile(kind: ProjectileKind, size = 1): ProjectileHandle {
    const h = spawnProjectile(this.ctx, kind, size);
    const dyn = this.ctx.dyn;
    if (!dyn || !(kind === 'missile' || kind === 'scud' || kind === 'fireball')) return h;
    // rocket exhaust / fireballs light the ground they fly over
    const col = kind === 'fireball' ? 0xff7a28 : 0xffad5c;
    const I = (kind === 'scud' ? 4 : kind === 'fireball' ? 3 : 1.6) * size;
    return {
      update(p: THREE.Vector3, d: THREE.Vector3) {
        h.update(p, d);
        dyn.add(p.x - d.x * 0.3, p.y - d.y * 0.3, p.z - d.z * 0.3, col, I, 2.8 + I * 0.5, 0, { flicker: 0.3 });
      },
      end() {
        h.end();
      },
    };
  }

  createEmitter(kind: EmitterKind, pos: THREE.Vector3): EmitterHandle {
    const e = new Emitter(kind, pos);
    this.emitters.push(e);
    return e;
  }

  dust(pos: THREE.Vector3, amount = 1): void {
    dust(this.ctx, pos.x, pos.z, amount);
    this.gpuP?.burst(GK.DUST, pos.x, this.ctx.getHeight(pos.x, pos.z) + 0.05, pos.z, 3 * amount, 0.7, { life: [0.9, 1.8], size0: 0.12, size1: 0.55, alpha: 0.3, up: 0.2, radius: 0.15 });
  }

  scorch(pos: THREE.Vector3, size: number): void {
    if (this.ctx.isWater(pos.x, pos.z)) return;
    this.decals.add(pos.x, pos.z, size, rnd() < 0.5 ? D.SCORCH_A : D.SCORCH_B, 0.85, range(42, 58), rnd() * Math.PI * 2);
  }

  bloodSplat(pos: THREE.Vector3): void {
    if (this.ctx.isWater(pos.x, pos.z)) return;
    this.decals.add(pos.x, pos.z, range(0.3, 0.42), D.SPLAT, 0.62, range(35, 45), rnd() * Math.PI * 2);
  }

  constructionBurst(pos: THREE.Vector3, size: number): void {
    constructionBurst(this.ctx, pos.x, pos.y, pos.z, Math.max(0.5, size));
  }

  chronoFlash(pos: THREE.Vector3): void {
    chronoFlash(this.ctx, pos.x, pos.y, pos.z);
  }

  ironCurtainPulse(pos: THREE.Vector3, radius: number): void {
    ironCurtainPulse(this.ctx, this.shells, pos.x, pos.y, pos.z, Math.max(0.3, radius));
  }

  oreSparkle(pos: THREE.Vector3, gems: boolean): void {
    oreSparkle(this.ctx, pos.x, pos.y, pos.z, gems);
  }

  orderMarker(pos: THREE.Vector3, kind: 'move' | 'attack' | 'rally'): void {
    orderMarker(this.ctx, pos.x, pos.z, kind);
  }

  // -------------------------------------------------------------------------------------------
  // game feel: hit flashes, flak, heavy deaths, progress moments, LOD and shake focus

  /**
   * Where the camera looks (map x / z in world units) and half the visible width: explosion shake fades with
   * the distance from here. Call every frame (the director does).
   */
  setFocus(x: number, z: number, viewRadius: number): void {
    this.focusX = x;
    this.focusZ = z;
    this.focusR = viewRadius;
  }

  /**
   * Level of detail for an optional effect layer at a point: 0 = off-screen (skip it), else 0.35..1 falling
   * with the camera distance. Uses last frame's camera matrices.
   */
  lodAt(x: number, y: number, z: number): number {
    const v = _lod.set(x, y, z).project(this.camera);
    if (v.z > 1 || v.x < -1.15 || v.x > 1.15 || v.y < -1.2 || v.y > 1.2) return 0;
    const c = this.camera.position;
    const d = Math.hypot(c.x - x, c.y - y, c.z - z);
    return Math.max(0.35, Math.min(1, 1.3 - d / 80));
  }

  /** A unit takes a heavy blow: flare on the hull, a light that catches the model, sparks / dust. `k` 0..1. */
  hitFlash(pos: THREE.Vector3, radius: number, k: number, metal: boolean): void {
    if (this.juice <= 0) return;
    const lod = this.lodAt(pos.x, pos.y, pos.z);
    if (lod > 0) hitFlash(this.ctx, pos.x, pos.y, pos.z, radius, k, metal, lod * this.juice);
  }

  /** Flak salvo around an aim point in the sky: `n` near-miss air bursts (the sim's hit adds its own). */
  flakBurst(pos: THREE.Vector3, n = 2): void {
    if (this.juice <= 0) return;
    const lod = this.lodAt(pos.x, pos.y, pos.z);
    if (lod > 0) flakField(this.ctx, pos.x, pos.y, pos.z, Math.max(1, Math.round(n * Math.min(1, lod * this.juice + 0.25))), lod * this.juice);
  }

  /** Big vehicle destroyed: ammo cook-off, hatch fire jet, fuel fireball, chunky debris. `size` ≈ 0.8 … 1.6. */
  heavyDeath(pos: THREE.Vector3, size: number): void {
    if (this.juice <= 0) return;
    const lod = this.lodAt(pos.x, pos.y, pos.z);
    if (lod <= 0) return;
    this.shakeAt(pos.x, pos.z);
    heavyDeath(this.ctx, pos.x, this.ctx.getHeight(pos.x, pos.z), pos.z, size, lod * this.juice);
    this.shAt = false;
  }

  /** Veterancy promotion burst over a unit (`height` = model height, `rank` 1 veteran, 2 elite). */
  promotionBurst(pos: THREE.Vector3, height: number, rank: number): void {
    if (this.juice <= 0) return;
    if (this.lodAt(pos.x, pos.y, pos.z) > 0) promotionBurst(this.ctx, pos.x, this.ctx.getHeight(pos.x, pos.z), pos.z, height, rank);
  }

  /** A big build is finished (superweapon online, first Mammoth): golden pillar, rings, sparks. */
  milestoneBurst(pos: THREE.Vector3, size: number): void {
    if (this.juice <= 0) return;
    milestoneBurst(this.ctx, pos.x, this.ctx.getHeight(pos.x, pos.z), pos.z, size);
  }

  /** Switch the spectacle layers on (at this quality's level) or off at runtime (A/B benches). */
  setJuice(on: boolean): void {
    this.juice = on ? this.juiceLevel : 0;
    setTeslaStyle(this.juice > 0 ? 1.5 : 1);
  }

  private shakeAt(x: number, z: number): void {
    this.shX = x;
    this.shZ = z;
    this.shAt = true;
  }

  // -------------------------------------------------------------------------------------------
  // naval, support powers

  /** Something lands in open water. pos.y is ignored (the water surface is used). size 1 = tank shell, 2 = 8-inch shell, 0.3 = bullets. */
  waterSplash(pos: THREE.Vector3, size = 1): void {
    this.shakeAt(pos.x, pos.z);
    waterSplash(this.ctx, pos.x, this.ctx.waterLevel, pos.z, size);
    this.shAt = false;
    this.gpuP?.burst(GK.SPRAY, pos.x, this.ctx.waterLevel + 0.02, pos.z, 26 * size, 2.6 * Math.sqrt(size), { life: [0.5, 1.1], size0: 0.06 * size, size1: 0.22 * size, alpha: 0.6, up: 0.95, radius: 0.1 * size });
  }

  /** Underwater detonation (depth charge, torpedo hit): flash under the surface, bulge, tall water column, foam slick. */
  underwaterBlast(pos: THREE.Vector3, size = 1): void {
    this.shakeAt(pos.x, pos.z);
    underwaterBlast(this.ctx, pos.x, this.ctx.waterLevel, pos.z, size);
    this.shAt = false;
  }

  /** Sonar pulse rings racing over the water from pos (radius in cells). */
  sonarPing(pos: THREE.Vector3, radius = 6): void {
    const y = this.ctx.isWater(pos.x, pos.z) ? this.ctx.waterLevel : this.ctx.getHeight(pos.x, pos.z);
    sonarPing(this.ctx, pos.x, y, pos.z, Math.max(0.5, radius));
  }

  /** Radar jammer burst around pos. */
  radarJamPulse(pos: THREE.Vector3, radius = 4): void {
    radarJamPulse(this.ctx, pos.x, this.ctx.getHeight(pos.x, pos.z), pos.z, Math.max(0.5, radius));
  }

  /**
   * Mine detonation: dirt fountain, debris and crater (AT bigger than AP). With `withExplosion`
   * (default) it also plays the fireball; pass false when the sim's impact event already does.
   */
  mineBlast(pos: THREE.Vector3, kind: 'ap' | 'at', withExplosion = true): void {
    const gy = this.ctx.getHeight(pos.x, pos.z);
    this.shakeAt(pos.x, pos.z);
    if (withExplosion) explode(this.ctx, kind === 'at' ? 'medium' : 'small', pos.x, gy + 0.08, pos.z, kind === 'at' ? 1.2 : 0.9);
    if (!this.ctx.isWater(pos.x, pos.z)) mineBlast(this.ctx, pos.x, gy, pos.z, kind === 'at');
    this.shAt = false;
  }

  /** Bow spray for a moving ship (Wakes calls this). dir = heading (unit, XZ), amount 0..1 ~ speed. */
  bowSpray(pos: THREE.Vector3, dirX: number, dirZ: number, amount: number, size = 1): void {
    bowSpray(this.ctx, pos.x, this.ctx.waterLevel, pos.z, dirX, dirZ, amount, size);
  }

  /** Bubbles rising to the surface at pos (sinking wrecks, submarine diving). */
  bubbles(pos: THREE.Vector3, n = 6, radius = 0.15): void {
    bubbles(this.ctx, pos.x, this.ctx.waterLevel, pos.z, n, radius);
  }

  /** GPS satellite launch: rocket lifting off from pos (the tech centre) into the sky (~7 s). */
  gpsLaunch(pos: THREE.Vector3): void {
    this.flights.gpsLaunch(this.ctx, pos.x, Math.max(pos.y, this.ctx.getHeight(pos.x, pos.z)), pos.z);
  }

  /**
   * Free-standing trail driven like a projectile handle: 'contrail' (white condensation from bomber /
   * spy-plane engines — feed it the model's smokePoints world positions) or 'smoke' (burning aircraft).
   */
  spawnTrail(kind: TrailKind, width = 1): ProjectileHandle {
    return new TrailVisual(this.ctx, kind, width);
  }

  /**
   * Shader warm-up: show the pooled 3D bodies (bombs, depth charges, GPS rocket) while
   * renderer.compile() runs, then call again with false.
   */
  prepareCompile(on: boolean): void {
    this.bodies.prepareCompile(on);
    // GPU particle sim / spawn programs compile here; the draw mesh joins the scene compile
    if (on) this.gpuP?.warmUp(this.now);
  }

  // -------------------------------------------------------------------------------------------
  // dynamic lights, GPU particles, terrain damage

  /**
   * A dynamic light (hundreds at once, lit in the atmosphere pass). `duration` > 0: timed flash (fast
   * attack, quadratic decay); 0: this frame only (re-add every frame for moving lights); < 0: persistent
   * until removeDynamicLight(id). Intensity in PointLight candela (inverse-square falloff windowed to
   * `radius`). Returns an id, or -1 (dropped, or no dynamic lights on this page).
   */
  addDynamicLight(x: number, y: number, z: number, color: number | THREE.Color, intensity: number, radius: number, duration: number, opts?: DynamicLightOptions): number {
    const dyn = this.ctx.dyn;
    if (dyn) return dyn.add(x, y, z, color, intensity, radius, duration, opts);
    if (duration > 0) this.lights.flash(this.now, x, y, z, typeof color === 'number' ? color : color.getHex(), intensity, radius, duration, opts?.delay ?? 0, opts?.attack ?? 0.03);
    return -1;
  }

  /** Move / re-scale a persistent or timed light; false when it has expired. */
  updateDynamicLight(id: number, x: number, y: number, z: number, intensity?: number): boolean {
    return this.ctx.dyn?.update(id, x, y, z, intensity) ?? false;
  }

  removeDynamicLight(id: number): void {
    this.ctx.dyn?.remove(id);
  }

  /** The shared recipe context (read-only use: destruction recipes run on the same batches, lights and terrain). */
  get context(): FxContext {
    return this.ctx;
  }

  /** The dynamic light system (null without the game renderer). */
  get dynamicLights(): DynamicLightApi | null {
    return this.ctx.dyn;
  }

  /** GPU particles (null when unsupported): `gpu.burst(GK.DUST, x, y, z, n, speed, opts)`. */
  get gpu(): GpuParticleApi | null {
    return this.gpuP;
  }

  /** Persistent terrain damage: `terrain.deform(x, y, radius, depth)`, `scorch`, `rut` (null without the game renderer). */
  get terrain(): TerrainDeformApi | null {
    return this.ctx.terrain;
  }

  /** Water surface height used by water effects. */
  get waterLevel(): number {
    return this.ctx.waterLevel;
  }

  // -------------------------------------------------------------------------------------------
  // Extras (not part of EffectsApi)

  /** Centre of the ambient floating-mote field (call with the camera target each frame or so). */
  setAmbientCenter(x: number, z: number): void {
    this.ambient.cx = x;
    this.ambient.cz = z;
  }

  /** Enable/disable ambient motes. */
  setAmbientEnabled(on: boolean): void {
    this.ambient.enabled = on;
  }

  /** Direction TOWARD the sun (world space), used to light smoke/dust/debris sprites. */
  setSunDirection(dir: THREE.Vector3): void {
    this.uniforms.uSunDir.value.copy(dir).normalize();
  }

  /** Wind vector (world units / s) that drifts smoke. Default (0.35, 0, 0.05). */
  setWind(x: number, z: number): void {
    this.uniforms.uWind.value.set(x, 0, z);
  }

  /** 0..1 particle count multiplier for low-end devices. */
  setDensity(d: number): void {
    this.ctx.density = Math.min(1, Math.max(0.1, d));
  }

  /** Light flash intensity multiplier (tune to the scene's exposure). */
  setLightIntensityScale(k: number): void {
    this.lights.intensityScale = k;
  }

  /** Procedural textures (debug / preview use). */
  get textures(): EffectTextures {
    return this.tex;
  }

  /** Effect clock in seconds. */
  get time(): number {
    return this.now;
  }

  stats(): EffectsStats {
    return {
      mainAlive: this.main.countAlive(this.now),
      glowAlive: this.glow.countAlive(this.now),
      spawnedTotal: this.main.spawned + this.glow.spawned,
      emitters: this.emitters.length,
      drawCalls: 5 + (this.gpuP ? 1 : 0),
      gpuCapacity: this.gpuP?.capacity ?? 0,
      gpuSpawned: this.gpuP?.stats.spawnedTotal ?? 0,
    };
  }

  dispose(): void {
    this.main.dispose();
    this.glow.dispose();
    this.beams.dispose();
    this.sprites.dispose();
    this.decals.dispose();
    this.shells.dispose();
    this.flights.dispose();
    this.bodies.dispose();
    this.lights.dispose();
    if (this.gpuP) {
      if (this.scene.userData.gpuParticles === this.gpuP) delete this.scene.userData.gpuParticles;
      this.gpuP.dispose();
      this.gpuP = null;
    }
    this.tex.dispose();
    this.emitters.length = 0;
    this.root.removeFromParent();
  }
}
