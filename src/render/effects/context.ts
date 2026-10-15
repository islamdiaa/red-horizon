/**
 * Shared state handed to every effect recipe.
 */
import type { ParticleBatch } from './particles';
import type { BeamBatch } from './beams';
import type { SpriteBatch } from './sprites';
import type { DecalSystem } from './decals';
import type { LightPool } from './lights';
import type { BodyPool } from './bodies';

/** Audio-facing moments raised by effects (see Effects.onCue). */
export type FxCue = 'splash' | 'thump' | 'bomb' | 'sonar' | 'launch' | 'torpedo';

export interface FxContext {
  /** Smoke, fireballs, dust, debris (premultiplied; fire fades into smoke). Drawn first. */
  main: ParticleBatch;
  /** Bright additive stuff drawn on top of smoke: sparks, flashes, embers, glints, rings. */
  glow: ParticleBatch;
  /** Ribbons / tracers / lightning. */
  beams: BeamBatch;
  /** CPU-driven sprites (projectile bodies). */
  sprites: SpriteBatch;
  decals: DecalSystem;
  lights: LightPool;
  getHeight(x: number, z: number): number;
  /** Effect clock in seconds. */
  now: number;
  /** Add camera shake now or after `delay` seconds. */
  addShake(amount: number, delay?: number): void;
  /** 0..1 global particle count multiplier (quality setting). */
  density: number;
  /** Water surface height (world y). */
  waterLevel: number;
  /** True when (x, z) is open water (the surface height there is the water level). */
  isWater(x: number, z: number): boolean;
  /** Pooled 3D bodies (bombs, depth charges, rockets). */
  bodies: BodyPool;
  /** Raise an audio cue (forwarded to Effects.onCue after `delay` seconds). */
  cue(kind: FxCue, x: number, y: number, z: number, delay: number): void;
}

/** Scale a nominal particle count by quality, keeping at least `min`. */
export function count(ctx: FxContext, n: number, min = 1): number {
  return Math.max(min, Math.round(n * ctx.density));
}
