/**
 * Small, fast, seedable PRNG shared by the effects system (mulberry32).
 * Seedable so the preview page can produce repeatable screenshots.
 */
let state = (Math.random() * 0xffffffff) >>> 0;

export function seedRandom(seed: number): void {
  state = seed >>> 0;
}

/** Uniform [0, 1). */
export function rnd(): number {
  let t = (state = (state + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Uniform [a, b). */
export function range(a: number, b: number): number {
  return a + (b - a) * rnd();
}

/** Uniform [-r, r). */
export function spread(r: number): number {
  return (rnd() * 2 - 1) * r;
}

/** Integer in [0, n). */
export function irand(n: number): number {
  return Math.floor(rnd() * n);
}

/** Approximately normal (sum of 3 uniforms), mean 0, roughly unit spread. */
export function gauss(): number {
  return (rnd() + rnd() + rnd() - 1.5) * 1.15;
}

export function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(rnd() * arr.length)];
}

/** Scratch output for unit vector helpers (avoids allocations). */
export const out3 = { x: 0, y: 0, z: 0 };

/** Random direction on the unit sphere, written to out3. */
export function randDir(): typeof out3 {
  const u = rnd() * 2 - 1;
  const th = rnd() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  out3.x = s * Math.cos(th);
  out3.y = u;
  out3.z = s * Math.sin(th);
  return out3;
}

/** Random direction on the upper hemisphere biased upward by `up` (0 = uniform hemisphere, 1+ = more vertical). */
export function randUpDir(up: number): typeof out3 {
  randDir();
  out3.y = Math.abs(out3.y) + up;
  const l = Math.hypot(out3.x, out3.y, out3.z) || 1;
  out3.x /= l;
  out3.y /= l;
  out3.z /= l;
  return out3;
}
