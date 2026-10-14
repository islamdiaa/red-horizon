/** Shared per-frame animation helpers (allocation-free). */
import type { ModelAnimState } from './types';
import type { Ctx } from './builder';
import { BodyVariant } from './materials';

const MAX_DT = 0.1;

export function dtOf(s: ModelAnimState): number {
  return Math.min(Math.max(s.dt, 0), MAX_DT);
}

/** Damage scorch variants for vehicles & structures. */
export function healthVariant(c: Ctx, s: ModelAnimState): void {
  c.setVariant(s.health < 0.25 ? BodyVariant.Wrecked : s.health < 0.5 ? BodyVariant.Damaged : BodyVariant.Normal);
}

/** Scroll track treads while moving. rate = links per second at full speed. */
export function animTracks(c: Ctx, s: ModelAnimState, rate = 11): void {
  if (!s.moving || c.tracks.length === 0) return;
  const sp = Math.max(0.3, s.speed);
  // cap at ~0.3 links/frame to avoid wagon-wheel strobing
  const step = Math.min(dtOf(s) * rate * sp, 0.3);
  c.v.tp = ((c.v.tp ?? 0) + step) % 1000;
  c.setTrackPhase(c.v.tp);
}

/** Spin wheel axles (nodes rotating about local Z) while moving. */
export function animWheels(c: Ctx, s: ModelAnimState, names: readonly string[], radius: number, speedCells = 2.2): void {
  if (!s.moving) return;
  const w = Math.min((dtOf(s) * speedCells * Math.max(0.3, s.speed)) / radius, 0.35);
  for (let i = 0; i < names.length; i++) {
    const n = c.n[names[i]];
    if (n) n.rotation.z -= w;
  }
}

/**
 * Barrel recoil: barrels[i] belongs to muzzle index i. Single-barrel models recoil on any shot.
 * Barrels slide along their parent's local -X.
 */
export function recoil(c: Ctx, s: ModelAnimState, barrels: readonly string[], dist: number): void {
  for (let i = 0; i < barrels.length; i++) {
    const b = c.n[barrels[i]];
    if (!b) continue;
    const key = barrels[i];
    let rest = c.v[key];
    if (rest === undefined) rest = c.v[key] = b.position.x;
    const active = barrels.length === 1 || s.firingMuzzle === i;
    const f = active ? s.firing : 0;
    // sharp kick, eased return
    b.position.x = rest - dist * f * f * (3 - 2 * f);
  }
}

/** Smoothly approach a target value (exponential). */
export function approach(cur: number, target: number, rate: number, dt: number): number {
  return cur + (target - cur) * (1 - Math.exp(-rate * dt));
}

/** Square-wave blink helper; phase offsets in seconds. */
export function blink(t: number, period: number, duty = 0.5, phase = 0): boolean {
  const x = ((t + phase) / period) % 1;
  return x < duty;
}
