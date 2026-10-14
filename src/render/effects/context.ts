/**
 * Shared state handed to every effect recipe.
 */
import type { ParticleBatch } from './particles';
import type { BeamBatch } from './beams';
import type { SpriteBatch } from './sprites';
import type { DecalSystem } from './decals';
import type { LightPool } from './lights';

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
}

/** Scale a nominal particle count by quality, keeping at least `min`. */
export function count(ctx: FxContext, n: number, min = 1): number {
  return Math.max(min, Math.round(n * ctx.density));
}
