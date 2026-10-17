import type * as THREE from 'three';
import type { ExplosionKind, ProjectileKind } from '../../data/rules';

/** Visual for an in-flight projectile. Engine calls update() every frame, then end() on impact. */
export interface ProjectileHandle {
  /** pos = current world position, dir = normalised travel direction. */
  update(pos: THREE.Vector3, dir: THREE.Vector3): void;
  /** Projectile is gone; trails may keep fading on their own. */
  end(): void;
}

/** Continuous emitter (damaged-building smoke, fire, chimney smoke, exhaust). */
export interface EmitterHandle {
  setPosition(pos: THREE.Vector3): void;
  /** 0 = off, 1 = normal, >1 = heavier. */
  setIntensity(v: number): void;
  /** [JUICE] 'column' emitters: 0..1 fire glow at the base (still burning). */
  setHeat?(v: number): void;
  dispose(): void;
}

/** [JUICE] 'column': tall smoke column over a burning structure / wreck (visible from far away). */
export type EmitterKind = 'smoke' | 'fire' | 'chimney' | 'sparks' | 'steam' | 'exhaust' | 'column';

export interface EffectsOptions {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  /** Terrain height at world (x, z) — over water this should be the water surface (map.surfaceAt). */
  getHeight(x: number, z: number): number;
  /** Water surface height (default: WATER_LEVEL from sim/map). */
  waterLevel?: number;
  /** Open water test (default: getHeight(x, z) <= waterLevel). */
  isWater?(x: number, z: number): boolean;
}

/**
 * The public surface of the effects system (implemented in ./index.ts as `class Effects`).
 * All positions are world space (1 unit = 1 map cell, +Y up).
 * Bright cores should use HDR colours (>1) so the bloom pass makes them glow.
 */
export interface EffectsApi {
  update(dt: number, time: number): void;
  /** Accumulated camera shake (engine reads and decays it). */
  shake: number;

  explosion(pos: THREE.Vector3, kind: ExplosionKind, scale?: number): void;
  muzzleFlash(pos: THREE.Vector3, dir: THREE.Vector3, size?: number): void;
  tracer(from: THREE.Vector3, to: THREE.Vector3, color?: number): void;
  teslaBolt(from: THREE.Vector3, to: THREE.Vector3): void;
  flameStream(from: THREE.Vector3, to: THREE.Vector3): void;
  healPulse(pos: THREE.Vector3): void;
  spawnProjectile(kind: ProjectileKind, size?: number): ProjectileHandle;
  createEmitter(kind: EmitterKind, pos: THREE.Vector3): EmitterHandle;
  /** Short burst of dust behind a moving vehicle. */
  dust(pos: THREE.Vector3, amount?: number): void;
  /** Ground scorch decal. */
  scorch(pos: THREE.Vector3, size: number): void;
  /** Infantry death splat / scorch. */
  bloodSplat(pos: THREE.Vector3): void;
  /** Sparks and dust while a structure is being placed / built. */
  constructionBurst(pos: THREE.Vector3, size: number): void;
  /** Green/teal shimmer column (chronosphere) */
  chronoFlash(pos: THREE.Vector3): void;
  /** Red shimmer shell around a point (iron curtain) */
  ironCurtainPulse(pos: THREE.Vector3, radius: number): void;
  /** Glitter puff when ore is harvested. */
  oreSparkle(pos: THREE.Vector3, gems: boolean): void;
  /** Ground ripple ring for move/attack orders. */
  orderMarker(pos: THREE.Vector3, kind: 'move' | 'attack' | 'rally'): void;
  /** Shell / debris landing in open water (pos.y ignored; size 1 = tank shell). */
  waterSplash(pos: THREE.Vector3, size?: number): void;
  /** Depth charge / torpedo detonation under the surface. */
  underwaterBlast(pos: THREE.Vector3, size?: number): void;
  /** Sonar rings over the water. */
  sonarPing(pos: THREE.Vector3, radius?: number): void;
  /** Radar jammer burst. */
  radarJamPulse(pos: THREE.Vector3, radius?: number): void;
  /** Land mine detonation (explosion + dirt fountain + crater). */
  mineBlast(pos: THREE.Vector3, kind: 'ap' | 'at', withExplosion?: boolean): void;
  /** GPS satellite rocket launch from pos. */
  gpsLaunch(pos: THREE.Vector3): void;
}
