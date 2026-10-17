/**
 * Heat-haze recipes: which effects heat the air, how much and for how long (see heathaze.ts). Strengths are
 * the apparent displacement in world units: a couple of pixels at the default RTS zoom, more in close-ups.
 * Option objects are module-level and reused (no allocations per call).
 */
import type { ExplosionKind } from '../../data/rules';
import type { HeatApi, HeatOptions } from './heathaze';

const O: HeatOptions = {};
function opt(rise: number, grow: number, delay = 0, range?: number): HeatOptions {
  O.rise = rise; O.grow = grow; O.delay = delay; O.range = range;
  return O;
}

/** The heat bubble of an explosion (timed): grows, climbs and cools. Ground fires keep shimmering a while. */
export function explosionHeat(heat: HeatApi, kind: ExplosionKind, x: number, y: number, z: number, gy: number, s: number): void {
  const yc = Math.max(y, gy);
  switch (kind) {
    case 'small':
      heat.add(x, yc, z, 0.35 * s, 1.1 * s, 0.018, 0.6, opt(0.8, 0.5));
      return;
    case 'medium':
      heat.add(x, yc, z, 0.6 * s, 1.9 * s, 0.032, 1.2, opt(1.0, 0.6));
      return;
    case 'large':
      heat.add(x, yc, z, 0.9 * s, 2.7 * s, 0.045, 1.8, opt(1.2, 0.7));
      return;
    case 'huge':
    case 'building': {
      const k = kind === 'building' ? Math.min(2.2, 0.6 + 0.35 * s) : s;
      heat.add(x, yc, z, 1.4 * k, 3.8 * k, 0.06, 3.0, opt(1.4, 0.8));
      // the burning ground under it
      heat.add(x, gy, z, 1.0 * k, 2.4 * k, 0.03, 6.0, opt(0, 0.2, 0.4));
      return;
    }
    case 'fire':
      heat.add(x, gy, z, 0.5 * s, 1.8 * s, 0.035, 2.6, opt(0.15, 0.3));
      return;
    case 'electric':
      // ionised air around the strike
      heat.add(x, yc, z, 0.45 * s, 1.1 * s, 0.03, 0.35, opt(0.6, 0.4));
      return;
    case 'nuke':
      // the fireball's heat climbing with the cap, then the scorched ground zero shimmering long after
      heat.add(x, gy + 0.5 * s, z, 3.2 * s, 9 * s, 0.14, 12, opt(0.7, 0.9));
      heat.add(x, gy, z, 3.0 * s, 3.5 * s, 0.07, 24, opt(0, 0.3, 1.5));
      return;
    default:
      return;
  }
}

/** A burning fire (per frame): emitter intensity `I`, size `sz`. */
export function fireHeat(heat: HeatApi, x: number, y: number, z: number, I: number, sz: number): void {
  const k = Math.min(I, 2);
  heat.add(x, y, z, 0.38 * sz * (0.6 + 0.4 * k), 1.9 * sz * (0.7 + 0.3 * k), 0.026 * (0.5 + 0.5 * Math.min(k, 1.5)), 0);
}

/** A smouldering ruin under its smoke column (per frame): `heat` 0..1, intensity ~ structure size. */
export function emberHeat(heat: HeatApi, x: number, y: number, z: number, I: number, h: number): void {
  if (h <= 0.05) return;
  heat.add(x, y, z, 0.5 + 0.25 * Math.min(I, 3), 2.2 + 0.4 * Math.min(I, 3), 0.022 * h, 0);
}

/** Engine exhaust (per frame), only drawn up close. */
export function exhaustHeat(heat: HeatApi, x: number, y: number, z: number, I: number): void {
  heat.add(x, y, z, 0.12, 0.45, 0.012 * Math.min(1.5, I), 0, opt(0, 0, 0, 16));
}

/** A flamethrower / flame tower stream from (x0, y0, z0) to (x1, y1, z1): hot air along the jet. */
export function flameHeat(heat: HeatApi, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
  for (let i = 1; i <= 3; i++) {
    const t = i / 3;
    heat.add(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z0 + (z1 - z0) * t, 0.22 + 0.18 * t, 0.9 + 0.6 * t, 0.03, 0.55, opt(0.6, 0.5));
  }
}

/** A tesla discharge: the air around the coil tip and the struck point shimmers for a moment. */
export function teslaHeat(heat: HeatApi, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
  heat.add(x0, y0, z0, 0.35, 0.9, 0.025, 0.4, opt(0.8, 0.5));
  heat.add(x1, y1, z1, 0.4, 1.0, 0.03, 0.45, opt(0.8, 0.6));
}

/** A fireball in flight (per frame, flame tower / fire projectiles). */
export function fireballHeat(heat: HeatApi, x: number, y: number, z: number, size: number): void {
  heat.add(x, y, z, 0.22 * size, 0.6 * size, 0.022, 0);
}

/** Rocket exhaust behind a missile / V2 in flight (per frame); seen up close and in the nuke cam. */
export function rocketHeat(heat: HeatApi, x: number, y: number, z: number, size: number): void {
  heat.add(x, y - 0.1 * size, z, 0.14 * size, 0.4 * size, 0.016, 0, opt(0, 0, 0, 45));
}
