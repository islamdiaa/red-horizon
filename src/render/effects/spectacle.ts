/**
 * [JUICE] Battle spectacle recipes layered on top of the base effects: hit flashes, flak air bursts, heavy
 * vehicle cook-offs, explosion variety (dirt geysers, spark showers, shock rings), veterancy chevron bursts,
 * milestone light pillars and the tall smoke columns rising from burning structures and wrecks.
 *
 * Everything writes into the existing particle / beam batches and dynamic lights (no new draw calls, no
 * per-call allocations: option objects are module-level and reused). Callers scale counts by `lod`
 * (0 = off-screen / skip, 1 = full detail near the camera) and ctx.density (quality preset).
 */
import type { FxContext } from './context';
import { count } from './context';
import { F, R } from './textures';
import { M } from './particles';
import { rnd, range, spread, irand } from './rand';
import {
  flash, star, fireCore, fireball, sparks, debris, dustRing, shockRing, groundGlow, embers, lightFlash, smokeFrame,
  type SparkOpts, type DustOpts, type FireballOpts,
} from './blocks';
import type { DynamicLightOptions } from '../dynlights';

const TAU = Math.PI * 2;

// reused option objects (the blocks read them synchronously)
const SPK: SparkOpts = {};
const DST: DustOpts = {};
const FBL: FireballOpts = {};
const DL: DynamicLightOptions = {};

function spk(life: number, size: number, up: number, gravity: number, ramp: number = R.SPARK, stretch = 0.055, r = 1, g = 1, b = 1): SparkOpts {
  SPK.life = life; SPK.size = size; SPK.up = up; SPK.gravity = gravity; SPK.ramp = ramp; SPK.stretch = stretch; SPK.r = r; SPK.g = g; SPK.b = b;
  return SPK;
}
function dl(attack: number, flicker: number, priority: number, delay = 0): DynamicLightOptions {
  DL.attack = attack; DL.flicker = flicker; DL.priority = priority; DL.delay = delay; DL.spot = undefined;
  return DL;
}

// ---------------------------------------------------------------------------------------------
// Impact feedback

/**
 * Hit flash on a unit taking a heavy blow: a short white-hot flare on the hull, a brief dynamic light that
 * lights the model itself, and sparks (vehicles) or a dust puff (infantry). `k` 0..1 = blow strength.
 */
export function hitFlash(ctx: FxContext, x: number, y: number, z: number, rad: number, k: number, metal: boolean, lod: number): void {
  const kk = Math.min(1, Math.max(0.2, k));
  flash(ctx, x, y, z, rad * (1.6 + 1.4 * kk), 2.6 + 2 * kk, 0, 0.085, 1, 0.92, 0.8);
  if (metal) star(ctx, x, y, z, rad * (1.2 + kk), 2.2, 0, 0.06, 1, 0.95, 0.85);
  ctx.dyn?.add(x, y + rad * 0.9 + 0.15, z, 0xffe0b8, 5 + 9 * kk, 1.4 + rad * 2.2, 0.09, dl(0.004, 0, 1.2));
  if (lod < 0.35) return;
  if (metal) sparks(ctx, x, y, z, Math.round((4 + 8 * kk) * lod), 2.6 + 1.6 * kk, 0, spk(0.45, 0.026, 0.55, -6));
  else {
    const p = ctx.main.begin();
    p.at(x, y, z).vel(spread(0.2), range(0.2, 0.4), spread(0.2)).motion(range(0.5, 0.8), -0.2, 2.5)
      .size(0.06, 0.26, 2).spin(rnd() * TAU, spread(1)).color(1, 1, 1, 0.5).look(F.DUST, R.DUST, M.LIT).fade(0.02, 0.3);
    p.push = 0.3;
    ctx.main.emit(p);
  }
}

// ---------------------------------------------------------------------------------------------
// Anti-aircraft fire

/** Flak air burst: sharp orange flash, a black puff that hangs in the sky, shrapnel streaks. */
export function airBurst(ctx: FxContext, x: number, y: number, z: number, s: number, delay: number, lod: number): void {
  star(ctx, x, y, z, 0.85 * s, 4.2, delay, 0.07, 1, 0.78, 0.45);
  flash(ctx, x, y, z, 1.05 * s, 3.2, delay, 0.11, 1, 0.75, 0.42);
  // hot core that chars into the black puff
  const c = ctx.main.begin();
  c.at(x, y, z).vel(0, 0.05, 0).motion(range(1.4, 1.9), 0.02, 3)
    .size(0.3 * s, 1.05 * s, 3).spin(rnd() * TAU, spread(0.5)).color(1, 1, 1, 1)
    .look(smokeFrame(), R.FIREBALL, M.LIT).fade(0, 0.55);
  c.wind = 0.5;
  c.push = 0.35;
  c.delay = delay;
  ctx.main.emit(c);
  const n = Math.max(2, Math.round(count(ctx, 4, 2) * Math.max(0.5, lod)));
  for (let i = 0; i < n; i++) {
    const p = ctx.main.begin();
    p.at(x + spread(0.14 * s), y + spread(0.1 * s), z + spread(0.14 * s))
      .vel(spread(0.4) * s, spread(0.22) * s + 0.05, spread(0.4) * s)
      .motion(range(3.2, 4.6), 0.04, 3.2)
      .size(0.22 * s, range(1.0, 1.3) * s, 3.5) // bursts open at once, then hang
      .spin(rnd() * TAU, spread(0.4))
      .color(0.8, 0.8, 0.8, 0.9)
      .look(smokeFrame(), R.SMOKE_DARK, M.LIT)
      .fade(0.01, 0.55);
    p.wind = 0.6;
    p.push = 0.3;
    p.delay = delay + 0.04 + rnd() * 0.04;
    ctx.main.emit(p);
  }
  if (lod >= 0.35) sparks(ctx, x, y, z, Math.round(count(ctx, 9, 3) * lod), 4.2 * s, delay, spk(0.32, 0.022, 0, -2.5, R.SPARK, 0.07));
  ctx.dyn?.add(x, y, z, 0xffa850, 7 * s, 3.2 * s, 0.12, dl(0.005, 0, 0.8, delay));
}

/** A flak salvo: a few near-miss air bursts scattered around the aim point (plus the sim's own hit). */
export function flakField(ctx: FxContext, x: number, y: number, z: number, n: number, lod: number): void {
  for (let i = 0; i < n; i++) {
    const a = rnd() * TAU, r = range(0.35, 0.95);
    airBurst(ctx, x + Math.cos(a) * r, y + range(-0.15, 0.55), z + Math.sin(a) * r, range(0.65, 0.9), range(0.04, 0.22), lod);
  }
}

// ---------------------------------------------------------------------------------------------
// Explosion variety

/** Dirt geyser: a dark fountain of earth and clods thrown straight up. */
export function dirtGeyser(ctx: FxContext, x: number, gy: number, z: number, s: number, delay: number, lod: number): void {
  const n = Math.max(3, Math.round(count(ctx, 12, 4) * lod));
  for (let i = 0; i < n; i++) {
    const p = ctx.main.begin();
    const up = range(2.4, 4.6) * s;
    p.at(x + spread(0.12 * s), gy + 0.05, z + spread(0.12 * s))
      .vel(spread(0.7) * s, up, spread(0.7) * s)
      .motion(range(1.1, 1.7), -5.5, 1.1)
      .size(0.12 * s, range(0.45, 0.7) * s, 1.4)
      .spin(rnd() * TAU, spread(1.2))
      .color(0.75, 0.68, 0.6, 0.72)
      .look(F.DUST, R.MUDDY, M.LIT)
      .fade(0.02, 0.45);
    p.wind = 0.35;
    p.delay = delay + rnd() * 0.06;
    ctx.main.emit(p);
  }
  debris(ctx, x, gy + 0.1, z, gy, Math.round(6 * lod) + 1, 4.2 * s, delay, 0, 1.3);
}

/** Spark shower: hot metal fanning up and raining down. */
export function sparkShower(ctx: FxContext, x: number, y: number, z: number, s: number, delay: number, lod: number): void {
  sparks(ctx, x, y, z, Math.round(count(ctx, 14, 4) * lod), 4.6 * s, delay, spk(0.9, 0.026, 0.9, -8, R.SPARK, 0.05));
  sparks(ctx, x, y, z, Math.round(count(ctx, 8, 2) * lod), 3.0 * s, delay + 0.05, spk(1.4, 0.035, 1.2, -5, R.EMBER, 0.035));
}

/**
 * Extra layers for an explosion (called after the base recipe): air bursts for anything detonating well
 * above the ground (AA hits), and a random variant on the ground so repeated hits never look the same.
 */
export function explosionExtras(ctx: FxContext, kind: string, x: number, y: number, z: number, gy: number, s: number, lod: number): void {
  if (lod <= 0) return;
  const high = y - gy > 1.25 * Math.max(0.8, s); // aircraft fly at 1.5+; building hits aim at most 1.0 up
  if (high && (kind === 'small' || kind === 'medium' || kind === 'large')) {
    // AA shells and missiles bursting in the sky (bullet hits on aircraft stay small 'piff' sparks)
    airBurst(ctx, x, y, z, (kind === 'small' ? 0.85 : 1.2) * s, 0, lod);
    return;
  }
  if (high) return;
  const r = rnd();
  switch (kind) {
    case 'medium':
      if (r < 0.32) dirtGeyser(ctx, x, gy, z, 0.75 * s, 0, lod);
      else if (r < 0.55) sparkShower(ctx, x, y + 0.1, z, 0.7 * s, 0, lod);
      break;
    case 'large':
      shockRing(ctx, x, gy, z, 5.2 * s, 0.02, 0.32, 3.2, 1, 0.9, 0.75);
      if (r < 0.5) dirtGeyser(ctx, x, gy, z, 1.05 * s, 0.03, lod);
      else sparkShower(ctx, x, y + 0.15, z, 1.0 * s, 0, lod);
      break;
    case 'huge':
      shockRing(ctx, x, gy, z, 9 * s, 0.03, 0.4, 3.6, 1, 0.9, 0.75);
      dirtGeyser(ctx, x, gy, z, 1.5 * s, 0.05, lod);
      sparkShower(ctx, x, y + 0.2, z, 1.4 * s, 0, lod);
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------------------------
// Bigger, chunkier deaths of large vehicles

/**
 * Heavy vehicle destroyed (`size` ≈ 0.8 medium tank … 1.5 Mammoth): ammunition cooks off in a chain of
 * pops, a fire jet blasts out of the hatch, a fuel fireball rolls up, chunky burning debris and a shock ring.
 */
export function heavyDeath(ctx: FxContext, x: number, gy: number, z: number, size: number, lod: number): void {
  const s = Math.max(0.6, Math.min(1.8, size));
  const pops = Math.max(2, Math.round((2 + 3 * s) * Math.max(0.5, lod)));
  let t = 0.22;
  for (let i = 0; i < pops; i++) {
    t += range(0.12, 0.32);
    const px = x + spread(0.35 * s), pz = z + spread(0.35 * s), py = gy + range(0.25, 0.6) * s;
    flash(ctx, px, py, pz, 0.8 * s, 3.4, t, 0.1);
    fireCore(ctx, px, py, pz, 0.14 * s, 2, t, 0.28);
    sparks(ctx, px, py, pz, Math.round(7 * lod) + 1, 3.6 * s, t, spk(0.55, 0.03, 0.8, -6));
    if (i % 2 === 0) lightFlash(ctx, px, py + 0.6, pz, 0xffa048, 3.2 * s, 3.6 * s, 0.16, t);
  }
  // fire jet out of the hatch
  const jet = Math.round(count(ctx, 14, 5) * Math.max(0.5, lod));
  for (let i = 0; i < jet; i++) {
    const p = ctx.glow.begin();
    p.at(x + spread(0.08), gy + 0.45 * s, z + spread(0.08))
      .vel(spread(0.35), range(2.6, 4.4) * s, spread(0.35))
      .motion(range(0.4, 0.7), -1.5, 1.6)
      .size(0.22 * s, range(0.42, 0.6) * s, 1)
      .spin(spread(0.3), spread(0.6))
      .color(0.55, 0.5, 0.45, 0.95)
      .look(F.FLAME, R.FIRE)
      .fade(0.04, 0.45);
    p.push = 0.4;
    p.delay = 0.38 + (i / jet) * 0.55;
    ctx.glow.emit(p);
  }
  // fuel fireball rolling up
  FBL.life = 2.8; FBL.rise = 1.0 * s; FBL.ramp = undefined; FBL.flat = 1.2;
  fireball(ctx, x, gy + 0.45 * s, z, 0.62 * s, Math.round(14 * Math.max(0.5, lod)), 0.55, FBL);
  // chunky burning debris and hull plates
  debris(ctx, x, gy + 0.4 * s, z, gy, Math.round(count(ctx, 9, 3) * Math.max(0.5, lod)), 4.6 * s, 0.05, 0.5, 1.6 * s);
  embers(ctx, x, gy + 0.3, z, Math.round(12 * lod) + 2, 0.45 * s, 0.4, 1.6, 2.2);
  shockRing(ctx, x, gy, z, 4.8 * s, 0, 0.42, 2.6);
  DST.size = 0.65 * s; DST.life = 1.9; DST.alpha = 0.65; DST.ramp = undefined;
  dustRing(ctx, x, gy, z, 0.2 * s, Math.round(10 * Math.max(0.5, lod)), 3.4 * s, 0.02, DST);
  groundGlow(ctx, x, gy, z, 3.4 * s, 0.5, 1.6, 2.2, 0.8, 0.25, 0.6);
  lightFlash(ctx, x, gy + 1.6, z, 0xff8a34, 9 * s, 7 * s, 1.0, 0.55);
  ctx.addShake(0.16 * s, 0.55);
}

// ---------------------------------------------------------------------------------------------
// Progress moments

/** Veterancy promotion: golden chevrons rising over the unit, a spark fountain, rings and a light pillar. */
export function promotionBurst(ctx: FxContext, x: number, gy: number, z: number, h: number, rank: number): void {
  const elite = rank >= 2;
  const cr = elite ? 2.7 : 2.3, cg = elite ? 1.75 : 1.95, cb = elite ? 0.45 : 0.85;
  const n = elite ? 3 : 2;
  for (let i = 0; i < n; i++) {
    const p = ctx.glow.begin();
    p.at(x, gy + h + 0.25 + i * 0.2, z).vel(0, 0.42, 0).motion(1.6, 0, 0.5).size(0.34, 0.42).color(cr, cg, cb, 1)
      .look(F.CHEVRON, R.WHITE).fade(0.06, 0.35);
    p.push = 0.6;
    p.delay = i * 0.09;
    ctx.glow.emit(p);
  }
  // a crown of small chevrons bursting outward
  const m = count(ctx, 10, 6);
  for (let i = 0; i < m; i++) {
    const a = (i / m) * TAU;
    const p = ctx.glow.begin();
    p.at(x, gy + h * 0.7 + 0.15, z).vel(Math.cos(a) * 1.5, range(0.9, 1.5), Math.sin(a) * 1.5).motion(range(0.7, 1.0), -1.2, 2.2)
      .size(0.13, 0.08).color(cr, cg, cb, 1).look(F.CHEVRON, R.WHITE).fade(0.02, 0.4);
    p.push = 0.5;
    p.delay = 0.05;
    ctx.glow.emit(p);
  }
  sparks(ctx, x, gy + h * 0.6, z, count(ctx, 18, 6), 3.2, 0.02, spk(0.9, 0.028, 1.4, -4, R.WHITE, 0.05, cr * 0.8, cg * 0.8, cb * 0.8));
  // pillar of light and two expanding rings
  const pl = ctx.glow.begin();
  pl.at(x, gy + 1.2, z).motion(0.9).size(0.32, 0.12).color(cr * 0.55, cg * 0.55, cb * 0.55, 0.9).look(F.GLOW, R.WHITE, M.CYLINDER, 9).fade(0.05, 0.6);
  pl.push = 0;
  ctx.glow.emit(pl);
  for (let k = 0; k < 2; k++) {
    const r = ctx.glow.begin();
    r.at(x, gy + 0.05, z).motion(0.75).size(0.2, 1.5 + k * 0.7, 2).color(cr * 0.7, cg * 0.7, cb * 0.7, 0.9).look(F.RING, R.WHITE, M.FLAT).fade(0, 0.35);
    r.push = 0;
    r.delay = k * 0.14;
    ctx.glow.emit(r);
  }
  star(ctx, x, gy + h + 0.2, z, 0.9, 3, 0, 0.12, 1, 0.85, 0.5);
  ctx.dyn?.add(x, gy + h + 0.6, z, 0xffd27a, 6, 3.4, 0.9, dl(0.03, 0.05, 1.5));
}

/** A big build is finished (superweapon online, first Mammoth): tall golden pillar, rings, sparks, light. */
export function milestoneBurst(ctx: FxContext, x: number, gy: number, z: number, size: number): void {
  const s = Math.max(0.6, size);
  const pl = ctx.glow.begin();
  pl.at(x, gy + 2.5 * s, z).motion(1.6).size(0.8 * s, 0.3 * s).color(1.6, 1.25, 0.5, 0.9).look(F.GLOW, R.WHITE, M.CYLINDER, 12).fade(0.06, 0.55);
  pl.push = 0;
  ctx.glow.emit(pl);
  for (let k = 0; k < 3; k++) {
    const r = ctx.glow.begin();
    r.at(x, gy + 0.06, z).motion(1.0).size(0.4 * s, (2.4 + k * 1.2) * s, 2).color(1.8, 1.4, 0.55, 0.85).look(F.RING, R.WHITE, M.FLAT).fade(0, 0.4);
    r.push = 0;
    r.delay = k * 0.18;
    ctx.glow.emit(r);
  }
  sparks(ctx, x, gy + 0.6 * s, z, count(ctx, 34, 10), 5 * s, 0.05, spk(1.4, 0.035, 1.6, -4, R.WHITE, 0.05, 2.2, 1.7, 0.6));
  embers(ctx, x, gy + 0.4, z, count(ctx, 16, 6), 0.8 * s, 0.1, 1.2, 2.4);
  flash(ctx, x, gy + 1.0 * s, z, 2.2 * s, 2.6, 0, 0.22, 1, 0.85, 0.5);
  ctx.dyn?.add(x, gy + 2 * s, z, 0xffd080, 14 * s, 6 * s, 1.4, dl(0.08, 0.05, 2));
}

// ---------------------------------------------------------------------------------------------
// Smoke columns

/**
 * One puff of a tall smoke column (burning structure / wreck). Puffs climb ~8–10 units over ~11 s,
 * swell to several units across and lean with the wind as they age, so a column reads from far away.
 * `heat` 0..1 adds a fire-lit, darker base.
 */
export function columnPuff(ctx: FxContext, x: number, y: number, z: number, sz: number, heat: number): void {
  const p = ctx.main.begin();
  const big = rnd() < 0.35;
  p.at(x + spread(0.22 * sz), y + rnd() * 0.2, z + spread(0.22 * sz))
    .vel(spread(0.12), range(1.45, 1.9) * (0.8 + 0.2 * sz), spread(0.12))
    .motion(range(10, 13), 0.05, 0.11)
    .size(range(0.5, 0.65) * sz, (big ? range(3.0, 3.8) : range(2.2, 3.0)) * sz, 1.25)
    .spin(rnd() * TAU, spread(0.18))
    .color(1, 1, 1, range(0.65, 0.85))
    .look(smokeFrame(), heat > 0.5 && rnd() < 0.3 ? R.SMOKE_FIRE : R.SMOKE_DARK, M.LIT)
    .fade(0.05, 0.45);
  // only a gentle lean with the wind: the weather can blow 1–8 units/s, which would flatten the column
  p.wind = 0.35;
  p.push = 0.25;
  ctx.main.emit(p);
}

/** Pick a random index in [0, n) (re-exported for the director's variety rolls). */
export const rollIndex = irand;
