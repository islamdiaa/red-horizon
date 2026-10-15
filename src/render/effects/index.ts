/**
 * Visual effects system.
 *
 * Draw calls (always): decals 1, main particles 1, beams 1, projectile sprites 1, glow particles 1
 * (+1 per active Iron Curtain shell). Particles/beams are GPU-animated ring buffers: the CPU only
 * writes newly spawned elements; update() advances the clock, runs emitters and uploads new data.
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
import { createEffectTextures, D, type EffectTextures } from './textures';
import { ParticleBatch, createParticleUniforms, type ParticleUniforms } from './particles';
import { BeamBatch } from './beams';
import { SpriteBatch } from './sprites';
import { DecalSystem } from './decals';
import { LightPool } from './lights';
import { ShellPool } from './shells';
import { explosion as explode } from './explosions';
import { spawnProjectile } from './projectiles';
import { muzzleFlash, tracer, teslaBolt, flameStream } from './weapons';
import { healPulse, dust, constructionBurst, chronoFlash, ironCurtainPulse, oreSparkle, orderMarker, AmbientMotes } from './misc';
import { Emitter } from './emitters';
import { rnd, range } from './rand';
import { BodyPool } from './bodies';
import { Flights } from './flights';
import { waterSplash, underwaterBlast, sonarPing, bowSpray, radarJamPulse, mineBlast, bubbles } from './water';
import { TrailVisual, type TrailKind } from './specialproj';
import type { FxCue } from './context';
import { WATER_LEVEL } from '../../sim/map';

export type { EffectsApi, EffectsOptions, EmitterHandle, EmitterKind, ProjectileHandle } from './types';
export type { FxCue } from './context';
export type { TrailKind } from './specialproj';

export interface EffectsStats {
  mainAlive: number;
  glowAlive: number;
  spawnedTotal: number;
  emitters: number;
  drawCalls: number;
}

const MAIN_CAPACITY = 16384;
const GLOW_CAPACITY = 8192;
const BEAM_CAPACITY = 8192;
const SPRITE_CAPACITY = 768;
const DECAL_CAPACITY = 200;
const LIGHT_COUNT = 6;

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

    this.root.name = 'effects';
    this.root.add(this.decals.mesh, this.main.mesh, this.beams.mesh, this.sprites.mesh, this.glow.mesh, this.shells.group, this.bodies.group);
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
      cue(kind: FxCue, x: number, y: number, z: number, delay: number) {
        if (!self.onCue) return;
        self.cueT.push(self.now + Math.max(0, delay));
        self.cueK.push(kind);
        self.cueP.push(x, y, z);
      },
      addShake(amount: number, delay = 0) {
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
    explode(this.ctx, kind, pos.x, pos.y, pos.z, scale > 0 ? scale : 1);
  }

  muzzleFlash(pos: THREE.Vector3, dir: THREE.Vector3, size = 1): void {
    muzzleFlash(this.ctx, pos.x, pos.y, pos.z, dir.x, dir.y, dir.z, size);
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3, color?: number): void {
    tracer(this.ctx, from.x, from.y, from.z, to.x, to.y, to.z, color);
  }

  teslaBolt(from: THREE.Vector3, to: THREE.Vector3): void {
    teslaBolt(this.ctx, from.x, from.y, from.z, to.x, to.y, to.z);
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
    return spawnProjectile(this.ctx, kind, size);
  }

  createEmitter(kind: EmitterKind, pos: THREE.Vector3): EmitterHandle {
    const e = new Emitter(kind, pos);
    this.emitters.push(e);
    return e;
  }

  dust(pos: THREE.Vector3, amount = 1): void {
    dust(this.ctx, pos.x, pos.z, amount);
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
  // Round 4: naval, support powers

  /** Something lands in open water. pos.y is ignored (the water surface is used). size 1 = tank shell, 2 = 8-inch shell, 0.3 = bullets. */
  waterSplash(pos: THREE.Vector3, size = 1): void {
    waterSplash(this.ctx, pos.x, this.ctx.waterLevel, pos.z, size);
  }

  /** Underwater detonation (depth charge, torpedo hit): flash under the surface, bulge, tall water column, foam slick. */
  underwaterBlast(pos: THREE.Vector3, size = 1): void {
    underwaterBlast(this.ctx, pos.x, this.ctx.waterLevel, pos.z, size);
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
    if (withExplosion) explode(this.ctx, kind === 'at' ? 'medium' : 'small', pos.x, gy + 0.08, pos.z, kind === 'at' ? 1.2 : 0.9);
    if (!this.ctx.isWater(pos.x, pos.z)) mineBlast(this.ctx, pos.x, gy, pos.z, kind === 'at');
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
      drawCalls: 5,
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
    this.tex.dispose();
    this.emitters.length = 0;
    this.root.removeFromParent();
  }
}
