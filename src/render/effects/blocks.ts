/**
 * Reusable effect building blocks (flash, fireball, smoke, sparks, debris, dust, rings...).
 * Every function only writes particles into the GPU batches; nothing is retained on the CPU.
 * Sizes are world units; `delay` postpones the start (handled on the GPU via spawn time).
 */
import type { FxContext } from './context';
import { count } from './context';
import { F, R, D } from './textures';
import { M } from './particles';
import { rnd, range, spread, randDir, randUpDir, irand } from './rand';

const SMOKE_FRAMES = [F.SMOKE_A, F.SMOKE_B, F.SMOKE_C] as const;
export function smokeFrame(): number {
  return SMOKE_FRAMES[irand(3)];
}

const TAU = Math.PI * 2;

/** Time until a ballistic (no drag) trajectory reaches groundY. */
export function landTime(y0: number, vy: number, g: number, groundY: number): number {
  const c = y0 - groundY;
  if (c <= 0) return 0.001;
  const disc = vy * vy - 2 * g * c;
  return (-vy - Math.sqrt(Math.max(0, disc))) / g;
}

/** Blinding flare (glow batch). */
export function flash(ctx: FxContext, x: number, y: number, z: number, size: number, intensity: number, delay = 0, life = 0.14, r = 1, g = 0.82, b = 0.55): void {
  const s = ctx.glow.begin();
  s.at(x, y, z).motion(life).size(size * 0.55, size, 2).spin(rnd() * TAU).color(r * intensity, g * intensity, b * intensity, 1).look(F.FLARE, R.WHITE).fade(0, 0.15);
  s.push = 0.6;
  s.delay = delay;
  ctx.glow.emit(s);
}

/** Star-shaped flash (muzzle / glints). */
export function star(ctx: FxContext, x: number, y: number, z: number, size: number, intensity: number, delay = 0, life = 0.08, r = 1, g = 0.85, b = 0.55): void {
  const s = ctx.glow.begin();
  s.at(x, y, z).motion(life).size(size, size * 0.7).spin(rnd() * TAU).color(r * intensity, g * intensity, b * intensity, 1).look(F.STAR, R.WHITE).fade(0, 0.3);
  s.push = 0.6;
  s.delay = delay;
  ctx.glow.emit(s);
}

/** Short-lived, very bright fire core drawn on top of the fireball (glow batch). */
export function fireCore(ctx: FxContext, x: number, y: number, z: number, rad: number, n: number, delay = 0, life = 0.4): void {
  n = count(ctx, n);
  for (let i = 0; i < n; i++) {
    const d = randDir();
    const s = ctx.glow.begin();
    s.at(x + d.x * rad * 0.25, y + d.y * rad * 0.2, z + d.z * rad * 0.25)
      .vel(d.x * rad * 1.5, d.y * rad * 1.2 + rad * 0.5, d.z * rad * 1.5)
      .motion(life * range(0.7, 1.15), rad * 0.5, 4)
      .size(rad * range(0.45, 0.7), rad * range(1.0, 1.35), 2.5)
      .spin(rnd() * TAU, spread(1.5))
      .color(0.32, 0.3, 0.28, 0.85)
      .look(F.FIREBALL, R.FIRE)
      .fade(0, 0.25);
    s.push = 0.5;
    s.delay = delay + rnd() * 0.03;
    ctx.glow.emit(s);
  }
}

export interface FireballOpts {
  life?: number;
  ramp?: number;
  /** extra upward drift (world units / s, terminal velocity) */
  rise?: number;
  /** horizontal spread multiplier */
  flat?: number;
}

/** Billowing fireball that cools into smoke (main batch, lit). */
export function fireball(ctx: FxContext, x: number, y: number, z: number, rad: number, n: number, delay = 0, o: FireballOpts = {}): void {
  n = count(ctx, n, 2);
  const life = o.life ?? 1.6;
  const ramp = o.ramp ?? R.FIREBALL;
  const rise = o.rise ?? rad * 1.2;
  const flat = o.flat ?? 1;
  for (let i = 0; i < n; i++) {
    const d = randDir();
    const f = Math.cbrt(rnd());
    const r0 = rad * 0.55 * f;
    const sp = rad * range(1.6, 3.2);
    // outer particles cool down sooner -> dark smoky rim around a hot core
    const lifeK = 1.25 - 0.55 * f;
    const s = ctx.main.begin();
    s.at(x + d.x * r0 * flat, y + Math.abs(d.y) * r0 * 0.8, z + d.z * r0 * flat)
      .vel(d.x * sp * flat, d.y * sp * 0.7 + rad * 1.3, d.z * sp * flat)
      .motion(life * lifeK * range(0.85, 1.15), rise * 3.5, 3.5)
      .size(rad * range(0.75, 1.05), rad * range(1.9, 2.7), 2.2)
      .spin(rnd() * TAU, spread(0.7))
      .color(1, 1, 1, 1)
      .look(smokeFrame(), ramp, M.LIT)
      .fade(0, 0.55);
    s.wind = 0.35;
    s.delay = delay + rnd() * 0.04;
    ctx.main.emit(s);
  }
}

export interface SmokeOpts {
  ramp?: number;
  life?: number;
  rise?: number;
  alpha?: number;
  size0?: number;
  size1?: number;
  spreadR?: number;
  /** stagger spawn over this many seconds */
  stagger?: number;
  wind?: number;
}

/** Rising smoke puffs (main batch, lit). */
export function smoke(ctx: FxContext, x: number, y: number, z: number, n: number, delay = 0, o: SmokeOpts = {}): void {
  n = count(ctx, n, 1);
  const life = o.life ?? 3;
  const rise = o.rise ?? 0.6;
  const s0 = o.size0 ?? 0.3;
  const s1 = o.size1 ?? 1.0;
  const sr = o.spreadR ?? 0.2;
  const stagger = o.stagger ?? 0.3;
  for (let i = 0; i < n; i++) {
    const s = ctx.main.begin();
    s.at(x + spread(sr), y + rnd() * sr * 0.5, z + spread(sr))
      .vel(spread(rise * 0.3), rise * range(0.7, 1.3), spread(rise * 0.3))
      .motion(life * range(0.75, 1.25), 0, 0.25)
      .size(s0 * range(0.8, 1.2), s1 * range(0.8, 1.25), 1.6)
      .spin(rnd() * TAU, spread(0.35))
      .color(1, 1, 1, o.alpha ?? 0.85)
      .look(smokeFrame(), o.ramp ?? R.SMOKE_DARK, M.LIT)
      .fade(0.12, 0.45);
    s.wind = o.wind ?? 0.8;
    s.delay = delay + (i / n) * stagger + rnd() * 0.05;
    ctx.main.emit(s);
  }
}

export interface SparkOpts {
  life?: number;
  up?: number;
  size?: number;
  ramp?: number;
  r?: number;
  g?: number;
  b?: number;
  gravity?: number;
  stretch?: number;
}

/** Hot sparks flying out (glow batch, velocity-stretched). */
export function sparks(ctx: FxContext, x: number, y: number, z: number, n: number, speed: number, delay = 0, o: SparkOpts = {}): void {
  n = count(ctx, n, 1);
  const life = o.life ?? 0.7;
  const sz = o.size ?? 0.035;
  for (let i = 0; i < n; i++) {
    const d = randUpDir(o.up ?? 0.35);
    const sp = speed * range(0.45, 1.15);
    const s = ctx.glow.begin();
    s.at(x, y, z)
      .vel(d.x * sp, d.y * sp, d.z * sp)
      .motion(life * range(0.5, 1.2), o.gravity ?? -6, 1.3)
      .size(sz * range(0.7, 1.3), sz * 0.5)
      .color(o.r ?? 1, o.g ?? 1, o.b ?? 1, 1)
      .look(F.SPARK, o.ramp ?? R.SPARK, M.STREAK, o.stretch ?? 0.055)
      .fade(0, 0.5);
    s.push = 0.2;
    s.delay = delay;
    ctx.glow.emit(s);
  }
}

/** Debris chunks arcing with gravity and landing; optionally burning with smoke trails. */
export function debris(ctx: FxContext, x: number, y: number, z: number, groundY: number, n: number, speed: number, delay = 0, burning = 0, sizeScale = 1): void {
  n = count(ctx, n, 1);
  const g = -7;
  for (let i = 0; i < n; i++) {
    const d = randUpDir(0.9);
    const sp = speed * range(0.45, 1.1);
    const vx = d.x * sp, vy = d.y * sp + speed * 0.25, vz = d.z * sp;
    const tStop = landTime(y, vy, g, groundY + 0.02);
    const burn = rnd() < burning;
    const life = tStop + range(1.0, 2.5);
    const sz = range(0.035, 0.08) * sizeScale;
    const s = ctx.main.begin();
    s.at(x, y, z).vel(vx, vy, vz).motion(life, g, 0)
      .size(sz, sz)
      .spin(rnd() * TAU, spread(14))
      .color(1, 1, 1, 1)
      .look(F.DEBRIS, burn ? R.DEBRIS_BURN : R.DEBRIS, M.LIT)
      .fade(0, 0.75);
    s.tStop = tStop;
    s.push = 0.1;
    s.delay = delay;
    ctx.main.emit(s);
    if (!burn) continue;
    // glowing core following the same path
    const e = ctx.glow.begin();
    e.at(x, y, z).vel(vx, vy, vz).motion(tStop + range(0.2, 0.8), g, 0)
      .size(sz * 3.5, sz * 2)
      .color(1, 0.9, 0.8, 0.9)
      .look(F.GLOW, R.EMBER)
      .fade(0, 0.6);
    e.tStop = tStop;
    e.push = 0.15;
    e.delay = delay;
    ctx.glow.emit(e);
    // smoke trail along the analytic trajectory
    const steps = Math.min(10, Math.ceil(tStop / 0.07));
    for (let k = 1; k <= steps; k++) {
      const tau = Math.min(tStop, k * 0.07);
      const px = x + vx * tau;
      const py = y + vy * tau + 0.5 * g * tau * tau;
      const pz = z + vz * tau;
      const m = ctx.main.begin();
      m.at(px, py, pz).vel(spread(0.05), 0.25, spread(0.05)).motion(range(0.9, 1.5), 0.1, 0.5)
        .size(sz * 1.6, sz * range(5, 7), 1.5)
        .spin(rnd() * TAU, spread(0.5))
        .color(1, 1, 1, 0.55)
        .look(smokeFrame(), R.SMOKE_FIRE, M.LIT)
        .fade(0.05, 0.35);
      m.wind = 0.5;
      m.delay = delay + tau;
      ctx.main.emit(m);
    }
  }
}

export interface DustOpts {
  size?: number;
  life?: number;
  alpha?: number;
  ramp?: number;
}

/** Ring of ground dust rolling outward (main batch, lit). */
export function dustRing(ctx: FxContext, x: number, gy: number, z: number, radius: number, n: number, speed: number, delay = 0, o: DustOpts = {}): void {
  n = count(ctx, Math.round(n * 1.6), 3);
  const size = o.size ?? 0.5;
  const life = o.life ?? 1.6;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + spread(0.3);
    const ca = Math.cos(a), sa = Math.sin(a);
    const sp = speed * range(0.35, 1.3);
    const s = ctx.main.begin();
    const r0 = radius * range(0.3, 1.0);
    s.at(x + ca * r0, gy + size * 0.2, z + sa * r0)
      .vel(ca * sp, range(0.05, 0.25) * speed * 0.3, sa * sp)
      .motion(life * range(0.75, 1.25), 0.15, 2.4)
      .size(size * 0.5, size * range(1.3, 1.8), 2)
      .spin(rnd() * TAU, spread(0.6))
      .color(1, 1, 1, (o.alpha ?? 0.6) * 0.42)
      .look(F.DUST, o.ramp ?? R.DUST, M.LIT)
      .fade(0.04, 0.35);
    s.wind = 0.4;
    s.delay = delay + rnd() * 0.05;
    ctx.main.emit(s);
  }
}

/** Flat expanding shock ring on the ground (glow batch). */
export function shockRing(ctx: FxContext, x: number, gy: number, z: number, size: number, delay = 0, life = 0.45, intensity = 1.6, r = 1, g = 0.86, b = 0.68): void {
  intensity *= 0.035;
  const s = ctx.glow.begin();
  s.at(x, gy + 0.08, z).motion(life).size(size * 0.12, size, 2.2).spin(rnd() * TAU)
    .color(r * intensity, g * intensity, b * intensity, 1)
    .look(F.SHOCK, R.WHITE, M.FLAT)
    .fade(0, 0.05);
  s.push = 0;
  s.delay = delay;
  ctx.glow.emit(s);
}

/** Flat soft glow on the ground (fake bounce light). */
export function groundGlow(ctx: FxContext, x: number, gy: number, z: number, size: number, delay = 0, life = 0.5, r = 2.2, g = 0.9, b = 0.3, alpha = 0.6): void {
  alpha *= 0.5;
  const s = ctx.glow.begin();
  s.at(x, gy + 0.05, z).motion(life).size(size * 0.7, size, 2).spin(rnd() * TAU)
    .color(r, g, b, alpha)
    .look(F.GLOW, R.WHITE, M.FLAT)
    .fade(0.03, 0.15);
  s.push = 0;
  s.delay = delay;
  ctx.glow.emit(s);
}

/** Lingering embers floating upward (glow batch). */
export function embers(ctx: FxContext, x: number, y: number, z: number, n: number, spreadR: number, delay = 0, stagger = 0.5, life = 1.4): void {
  n = count(ctx, n, 1);
  for (let i = 0; i < n; i++) {
    const s = ctx.glow.begin();
    s.at(x + spread(spreadR), y + rnd() * spreadR * 0.5, z + spread(spreadR))
      .vel(spread(0.4), range(0.4, 1.2), spread(0.4))
      .motion(life * range(0.6, 1.3), 0.4, 1.2)
      .size(range(0.025, 0.05), 0.012)
      .color(1, 1, 1, 1)
      .look(F.GLOW, R.EMBER)
      .fade(0.05, 0.5);
    s.wind = 0.9;
    s.push = 0.1;
    s.delay = delay + rnd() * stagger;
    ctx.glow.emit(s);
  }
}

/** Flames licking upward from a point (main batch, additive phase then wisps of smoke). */
export function flames(ctx: FxContext, x: number, y: number, z: number, n: number, size: number, spreadR: number, delay = 0, stagger = 0.6, life = 0.7): void {
  n = count(ctx, n, 1);
  for (let i = 0; i < n; i++) {
    const s = ctx.glow.begin();
    s.at(x + spread(spreadR), y + size * 0.3, z + spread(spreadR))
      .vel(spread(0.15), range(0.5, 1.0) * size * 2.5, spread(0.15))
      .motion(life * range(0.7, 1.3), size * 1.5, 2)
      .size(size * range(0.8, 1.2), size * 0.45, 1)
      .spin(spread(0.25), spread(0.4))
      .color(0.5, 0.48, 0.45, 0.9)
      .look(F.FLAME, R.FIRE)
      .fade(0.12, 0.4);
    s.wind = 0.3;
    s.push = 0.4;
    s.delay = delay + rnd() * stagger;
    ctx.glow.emit(s);
  }
}

export function lightFlash(ctx: FxContext, x: number, y: number, z: number, color: number, intensity: number, radius: number, duration: number, delay = 0): void {
  ctx.lights.flash(ctx.now, x, y, z, color, intensity, radius, duration, delay);
}

export function scorchDecal(ctx: FxContext, x: number, z: number, size: number, delay = 0, frame = -1, intensity = 0.85, life = 50): void {
  if (ctx.isWater(x, z)) return;
  const f = frame >= 0 ? frame : rnd() < 0.5 ? D.SCORCH_A : D.SCORCH_B;
  ctx.decals.add(x, z, size, f, intensity, life * range(0.85, 1.15), rnd() * TAU, delay);
}

/** Random point offset helper (writes into out). */
export function jitter(out: { x: number; y: number; z: number }, x: number, y: number, z: number, r: number): void {
  const d = randDir();
  const k = r * Math.cbrt(rnd());
  out.x = x + d.x * k;
  out.y = y + Math.abs(d.y) * k;
  out.z = z + d.z * k;
}
