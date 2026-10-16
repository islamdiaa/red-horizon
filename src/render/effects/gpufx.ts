/**
 * GPU particle layers added on top of the classic recipes: thousands of bouncing sparks, swirling embers,
 * dust surges, debris grit and turbulent smoke columns for explosions, burning wrecks and the nuke.
 * Counts scale with the quality preset (GpuParticleApi.density).
 */
import type { ExplosionKind } from '../../data/rules';
import { GK, type GpuParticleApi } from './gpuparticles';
import { R } from './textures';
import { rnd, range, spread } from './rand';

const TAU = Math.PI * 2;

export function gpuExplosion(gpu: GpuParticleApi, kind: ExplosionKind, x: number, y: number, z: number, gy: number, s: number, water: boolean): void {
  const ground = !water && y - gy < 0.7 * s;
  const yc = Math.max(y, gy + 0.1);
  switch (kind) {
    case 'piff':
      gpu.burst(GK.SPARK, x, yc + 0.02, z, 5, 3 * s, { life: [0.15, 0.35], size0: 0.014, up: 0.6 });
      return;
    case 'small':
      gpu.burst(GK.SPARK, x, yc + 0.05, z, 18, 3.2 * s, { life: [0.3, 0.8], size0: 0.018, up: 0.55 });
      gpu.burst(GK.EMBER, x, yc + 0.1, z, 6, 1.2 * s, { life: [0.8, 1.6], size0: 0.03, up: 0.8 });
      if (ground) gpu.burst(GK.DUST, x, gy + 0.05, z, 10, 1.4 * s, { life: [0.8, 1.5], size0: 0.12 * s, size1: 0.5 * s, alpha: 0.5, up: 0.1, radius: 0.15 });
      else if (water) gpu.burst(GK.SPRAY, x, gy + 0.02, z, 14, 2.5 * s, { life: [0.5, 0.9], size0: 0.06, size1: 0.2, alpha: 0.6, up: 0.9 });
      return;
    case 'medium':
    case 'large': {
      const k = kind === 'large' ? 2.2 : 1;
      gpu.burst(GK.SPARK, x, yc + 0.1, z, 36 * k, (3.8 + k) * s, { life: [0.4, 1.2], size0: 0.02, up: 0.55 });
      gpu.burst(GK.EMBER, x, yc + 0.15, z, 16 * k, 1.8 * s, { life: [1.2, 2.6], size0: 0.035, up: 0.85, delay: [0, 0.3] });
      if (ground) {
        gpu.burst(GK.DUST, x, gy + 0.08, z, 36 * k, 2.4 * s, { life: [1.2, 2.6], size0: 0.25 * s, size1: 1.1 * s, alpha: 0.55, up: 0.05, radius: 0.3 * s });
        gpu.burst(GK.DEBRIS, x, yc + 0.1, z, 16 * k, 4.2 * s, { life: [2.5, 4.5], size0: 0.05, up: 0.75 });
      } else if (water) {
        gpu.burst(GK.SPRAY, x, gy + 0.02, z, 40 * k, 3.6 * s, { life: [0.6, 1.3], size0: 0.08, size1: 0.3, alpha: 0.65, up: 0.92 });
      }
      smokeColumn(gpu, x, yc + 0.2, z, 8 * k, 0.35 * s, 0.6 * s, 1.5 * s, [3, 5.5], [0.1, 0.9]);
      return;
    }
    case 'huge':
    case 'building': {
      gpu.burst(GK.SPARK, x, yc + 0.2, z, 160, 6.5 * Math.sqrt(s), { life: [0.6, 1.6], size0: 0.024, up: 0.55 });
      gpu.burst(GK.EMBER, x, yc + 0.3, z, 110, 2.2 * Math.sqrt(s), { life: [2, 4.2], size0: 0.04, up: 0.9, radius: 0.4 * s, delay: [0, 1.2] });
      if (ground) {
        gpu.burst(GK.DUST, x, gy + 0.1, z, 200, 3.6 * Math.sqrt(s), { life: [1.6, 3.4], size0: 0.35 * s, size1: 1.6 * s, alpha: 0.6, up: 0.04, radius: 0.5 * s });
        gpu.burst(GK.DEBRIS, x, yc + 0.2, z, 70, 5.5 * Math.sqrt(s), { life: [3, 5.5], size0: 0.06, up: 0.8 });
      } else if (water) {
        gpu.burst(GK.SPRAY, x, gy + 0.02, z, 120, 5 * Math.sqrt(s), { life: [0.8, 1.6], size0: 0.1, size1: 0.4, alpha: 0.65, up: 0.95 });
      }
      gpu.burst(GK.FIRE, x, yc + 0.2, z, 40, 1.2, { life: [0.5, 1.1], size0: 0.35 * s, size1: 0.12 * s, alpha: 0.8, radius: 0.5 * s, delay: [0, 0.8] });
      smokeColumn(gpu, x, yc + 0.3, z, 60, 0.5 * s, 0.7 * s, 2.4 * s, [5, 8.5], [0.2, 3]);
      return;
    }
    case 'fire':
      gpu.burst(GK.EMBER, x, yc + 0.1, z, 18, 1.4 * s, { life: [0.8, 2], size0: 0.03, up: 0.9, radius: 0.15 });
      gpu.burst(GK.FIRE, x, yc + 0.05, z, 12, 0.6, { life: [0.4, 0.8], size0: 0.25 * s, size1: 0.08, alpha: 0.75, radius: 0.2 * s });
      return;
    case 'electric':
      gpu.burst(GK.SPARK, x, yc + 0.1, z, 50, 6 * s, { life: [0.25, 0.7], size0: 0.02, up: 0.6, ramp: R.TESLA });
      return;
    case 'nuke':
      nuke(gpu, x, z, gy, s, water);
      return;
    default:
      return;
  }
}

/** Turbulent smoke column: puffs rising from (x, y, z), staggered over `delay`. */
function smokeColumn(gpu: GpuParticleApi, x: number, y: number, z: number, n: number, r: number, s0: number, s1: number, life: [number, number], delay: [number, number], ramp: number = R.SMOKE_DARK, alpha = 0.6) {
  n = Math.round(n * gpu.density);
  for (let i = 0; i < n; i++) {
    const a = rnd() * TAU, rr = r * Math.sqrt(rnd());
    const k = range(0.8, 1.2);
    gpu.emit(GK.SMOKE, x + Math.cos(a) * rr, y + rnd() * 0.2, z + Math.sin(a) * rr, spread(0.2), range(0.6, 1.3), spread(0.2), range(life[0], life[1]), s0 * k, s1 * k, alpha, ramp, range(delay[0], delay[1]));
  }
}

/** The nuke: radial spark storm, base surge, embers swirling in the rising cap, a smoke stem and falling ash. */
function nuke(gpu: GpuParticleApi, x: number, z: number, gy: number, s: number, water: boolean) {
  const d = gpu.density;
  const H = 8 * s, drag = 0.42, capR = 2.8 * s;
  // white-hot fragments flung out across the blast zone
  gpu.burst(GK.SPARK, x, gy + 0.6 * s, z, 1200, 14 * s, { life: [0.8, 2.2], size0: 0.04 * s, up: 0.45, jitter: 0.7 });
  // base surge: a dust wall rolling outwards (spray over water)
  const surge = Math.round(1600 * d);
  for (let i = 0; i < surge; i++) {
    const a = rnd() * TAU, ca = Math.cos(a), sa = Math.sin(a);
    const sp = range(5, 13) * s;
    gpu.emit(water ? GK.SPRAY : GK.DUST, x + ca * 0.8 * s, gy + range(0.1, 0.6) * s, z + sa * 0.8 * s, ca * sp, range(0.2, 1.4), sa * sp, range(3, 6.5),
      range(0.5, 0.9) * s, range(2, 3.2) * s, water ? 0.45 : 0.36, water ? R.SPRAY : R.DUST, range(0.05, 0.6));
  }
  // embers boiling inside the cap as it climbs (placed on the cap's path, then left to swirl and fall)
  const emb = Math.round(3200 * d);
  for (let i = 0; i < emb; i++) {
    const tau = range(0.3, 5.5);
    const capY = H * (1 - Math.exp(-drag * tau));
    const a = rnd() * TAU, rr = capR * Math.sqrt(rnd()) * Math.min(1, 0.3 + tau / 3);
    gpu.emit(GK.EMBER, x + Math.cos(a) * rr, gy + 0.5 * s + capY * range(0.75, 1.05), z + Math.sin(a) * rr, spread(1.2), range(-0.2, 1.2), spread(1.2),
      range(2.5, 6), range(0.05, 0.11) * s, 0.02, 1, R.EMBER, tau);
  }
  // stem: turbulent smoke rising into the cap
  smokeColumn(gpu, x, gy + 0.3, z, 340, 0.9 * s, 0.8 * s, 2.8 * s, [6, 10], [0.6, 6], R.SMOKE, 0.5);
  // fire licking the ground zero
  gpu.burst(GK.FIRE, x, gy + 0.2, z, 140, 1.4, { life: [0.5, 1.2], size0: 0.6 * s, size1: 0.2 * s, alpha: 0.6, radius: 2.2 * s, delay: [0, 4] });
  // ash and soot drifting down from the cap afterwards
  const ash = Math.round(1600 * d);
  for (let i = 0; i < ash; i++) {
    const a = rnd() * TAU, rr = capR * 2.2 * Math.sqrt(rnd());
    gpu.emit(GK.ASH, x + Math.cos(a) * rr, gy + H * range(0.8, 1.15), z + Math.sin(a) * rr, spread(0.3), range(-0.4, 0), spread(0.3), range(7, 12),
      range(0.03, 0.06), 0.03, 0.8, R.SMOKE, range(3, 9));
  }
}

/** Continuous layers for a burning wreck / building (Emitter 'fire'), per second rates scaled by intensity. */
export function gpuFire(gpu: GpuParticleApi, x: number, y: number, z: number, I: number, sz: number, acc: Float32Array, dt: number): void {
  const d = gpu.density;
  acc[0] += dt * 11 * I * d;
  while (acc[0] >= 1) {
    acc[0] -= 1;
    gpu.emit(GK.EMBER, x + spread(0.25 * sz), y + 0.2, z + spread(0.25 * sz), spread(0.4), range(0.9, 1.8), spread(0.4), range(1.6, 3.4), range(0.025, 0.045), 0.012, 1);
  }
  acc[1] += dt * 1.6 * I * d;
  while (acc[1] >= 1) {
    acc[1] -= 1;
    gpu.emit(GK.SMOKE, x + spread(0.2 * sz), y + 0.5 * sz, z + spread(0.2 * sz), spread(0.15), range(0.8, 1.3), spread(0.15), range(5, 8), 0.45 * sz, 2.0 * sz, 0.5, R.SMOKE_FIRE);
  }
}

/** Damaged-building smoke: an occasional tall turbulent puff. */
export function gpuSmoke(gpu: GpuParticleApi, x: number, y: number, z: number, I: number, sz: number, acc: Float32Array, dt: number): void {
  acc[1] += dt * 1.1 * I * gpu.density;
  while (acc[1] >= 1) {
    acc[1] -= 1;
    gpu.emit(GK.SMOKE, x + spread(0.15), y + 0.3, z + spread(0.15), spread(0.1), range(0.6, 1.0), spread(0.1), range(5, 7.5), 0.4 * sz, 1.8 * sz, 0.45, R.SMOKE_DARK);
  }
}
