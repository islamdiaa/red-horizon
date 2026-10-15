/**
 * Water & support-power effect recipes: splashes, underwater blasts (depth charges / torpedo hits),
 * bow spray, sonar ping, radar-jam pulse, mine detonation dirt fountain.
 * Like blocks.ts these only write fire-and-forget particles / beams into the GPU batches.
 */
import type { FxContext } from './context';
import { count } from './context';
import { F, R, D } from './textures';
import { M } from './particles';
import { BM, BS } from './beams';
import { rnd, range, spread, irand } from './rand';
import { flash, smokeFrame, shockRing, sparks, debris, scorchDecal, lightFlash, groundGlow } from './blocks';
import { Water } from '../water';

const TAU = Math.PI * 2;

/** Rising column of lit spray (main batch). height in world units. */
function sprayColumn(ctx: FxContext, x: number, y: number, z: number, n: number, height: number, width: number, size: number, delay: number, ramp: number = R.SPRAY): void {
  n = count(ctx, n, 3);
  const g = -7;
  for (let i = 0; i < n; i++) {
    const h = height * range(0.55, 1.05);
    const vy = Math.sqrt(2 * -g * h) * 1.08;
    const a = rnd() * TAU;
    const r = Math.sqrt(rnd()) * width;
    const p = ctx.main.begin();
    p.at(x + Math.cos(a) * r * 0.5, y + 0.02, z + Math.sin(a) * r * 0.5)
      .vel(Math.cos(a) * r * range(0.8, 1.8), vy, Math.sin(a) * r * range(0.8, 1.8))
      .motion((2 * vy) / -g * range(0.85, 1.15), g, 0.25)
      .size(size * range(0.45, 0.7), size * range(1.3, 1.9), 1.5)
      .spin(rnd() * TAU, spread(0.8))
      .color(1, 1, 1, range(0.7, 0.95))
      .look(smokeFrame(), ramp, M.LIT)
      .fade(0.02, 0.55);
    p.wind = 0.4;
    p.push = 0.3;
    p.delay = delay + rnd() * 0.06;
    ctx.main.emit(p);
  }
}

/** Droplet streaks thrown out in a crown (main batch, alpha-blended white streaks). */
function droplets(ctx: FxContext, x: number, y: number, z: number, n: number, speed: number, up: number, size: number, delay: number): void {
  n = count(ctx, n, 2);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + spread(0.4);
    const sp = speed * range(0.5, 1.2);
    const p = ctx.main.begin();
    p.at(x + Math.cos(a) * 0.04, y + 0.03, z + Math.sin(a) * 0.04)
      .vel(Math.cos(a) * sp, up * range(0.7, 1.3), Math.sin(a) * sp)
      .motion(range(0.5, 0.9), -9, 0.4)
      .size(size * range(0.7, 1.3), size * 0.6)
      .color(1, 1, 1, 0.9)
      .look(F.SPARK, R.SPRAY, M.STREAK, 0.07)
      .fade(0, 0.4);
    p.push = 0.15;
    p.delay = delay;
    ctx.main.emit(p);
  }
}

/** Flat foam on the water surface: expanding ring + lingering patch + ripples. `ak` scales ring opacity. */
function foam(ctx: FxContext, x: number, y: number, z: number, size: number, delay: number, linger = 3.2, ak = 1): void {
  let p = ctx.main.begin();
  p.at(x, y + 0.012, z).motion(1.3).size(size * 0.25, size * 1.25, 2).spin(rnd() * TAU)
    .color(1, 1, 1, 0.5 * ak).look(F.SHOCK, R.FOAM, M.FLAT).fade(0, 0.35);
  p.push = 0;
  p.delay = delay;
  ctx.main.emit(p);
  p = ctx.main.begin();
  p.at(x + spread(0.05), y + 0.01, z + spread(0.05)).motion(linger).size(size * 0.45, size * 0.95, 0.6).spin(rnd() * TAU, spread(0.1))
    .color(1, 1, 1, 0.36).look(F.FIREBALL, R.FOAM, M.FLAT).fade(0.03, 0.45);
  p.push = 0;
  p.delay = delay + 0.05;
  ctx.main.emit(p);
  for (let i = 0; i < 2; i++) {
    p = ctx.main.begin();
    p.at(x, y + 0.008, z).motion(1.8).size(size * 0.4, size * (1.9 + i * 0.6), 1.6).spin(rnd() * TAU)
      .color(1, 1, 1, 0.16 * ak).look(F.RING, R.FOAM, M.FLAT).fade(0.05, 0.3);
    p.push = 0;
    p.delay = delay + 0.18 + i * 0.3;
    ctx.main.emit(p);
  }
}

/** Fine mist drifting off a splash. */
function mist(ctx: FxContext, x: number, y: number, z: number, n: number, size: number, delay: number): void {
  n = count(ctx, n, 1);
  for (let i = 0; i < n; i++) {
    const p = ctx.main.begin();
    p.at(x + spread(size * 0.3), y + range(0.1, 0.4) * size, z + spread(size * 0.3))
      .vel(spread(0.15), range(0.05, 0.2), spread(0.15))
      .motion(range(1.8, 2.8), 0, 0.4)
      .size(size * 0.4, size * range(1.0, 1.4), 1.4)
      .spin(rnd() * TAU, spread(0.3))
      .color(1, 1, 1, 0.22)
      .look(smokeFrame(), R.SPRAY, M.LIT)
      .fade(0.1, 0.4);
    p.wind = 0.9;
    p.delay = delay + rnd() * 0.2;
    ctx.main.emit(p);
  }
}

/**
 * Shell / debris landing in water. y = water surface. size 1 = tank shell (column ~0.7 high),
 * 2 = heavy naval shell, 0.4 = bullets.
 */
export function waterSplash(ctx: FxContext, x: number, y: number, z: number, size: number, delay = 0): void {
  const s = Math.max(0.2, size);
  const k = Math.sqrt(s);
  sprayColumn(ctx, x, y, z, 7 + 5 * s, 0.75 * s, 0.12 * k, 0.16 * k, delay);
  droplets(ctx, x, y, z, 6 + 6 * k, 1.1 * k, 2.6 * k, 0.03 * k, delay);
  foam(ctx, x, y, z, 0.8 * k + 0.2 * s, delay, 3.2, Math.min(1, s));
  mist(ctx, x, y, z, 2 + Math.round(s), 0.45 * k, delay + 0.35);
  if (s >= 1.5) ctx.addShake(0.02 * s, delay);
  Water.current?.addRipple(x, z, Math.min(2.5, 0.4 + 0.8 * s));
  ctx.cue('splash', x, y, z, delay);
}

/**
 * Underwater detonation (depth charge, torpedo hit, mine under water): dull flash under the surface,
 * a doming bulge, then a tall white column collapsing into mist and a big foam slick.
 */
export function underwaterBlast(ctx: FxContext, x: number, y: number, z: number, size: number, delay = 0): void {
  const s = Math.max(0.3, size);
  const k = Math.sqrt(s);
  // light under the surface + the dome of water lifting
  let p = ctx.glow.begin();
  p.at(x, y + 0.01, z).motion(0.28).size(0.6 * s, 1.5 * s, 2).spin(rnd() * TAU).color(1.6, 1.1, 0.6, 0.45).look(F.GLOW, R.WHITE, M.FLAT).fade(0, 0.3);
  p.push = 0;
  p.delay = delay;
  ctx.glow.emit(p);
  p = ctx.main.begin();
  p.at(x, y + 0.015, z).motion(0.75).size(0.25 * s, 1.3 * s, 2.2).spin(rnd() * TAU).color(1, 1, 1, 0.8).look(F.FIREBALL, R.FOAM, M.FLAT).fade(0, 0.4);
  p.push = 0;
  p.delay = delay;
  ctx.main.emit(p);
  shockRing(ctx, x, y - 0.06, z, 3.2 * s, delay, 0.45, 1.1, 0.8, 0.95, 1.0);
  lightFlash(ctx, x, y + 0.6, z, 0xbfe0ff, 1.5 * s, 3 * s, 0.25, delay);
  // the column (narrow, tall) + crown
  const d2 = delay + 0.12;
  sprayColumn(ctx, x, y, z, 14 + 8 * s, 1.7 * s, 0.1 * k, 0.24 * k, d2);
  sprayColumn(ctx, x, y, z, 8 + 4 * s, 0.7 * s, 0.32 * k, 0.3 * k, d2 + 0.05);
  droplets(ctx, x, y, z, 10 + 6 * k, 1.6 * k, 4.2 * k, 0.04 * k, d2);
  foam(ctx, x, y, z, 1.4 * k + 0.4 * s, d2, 5);
  mist(ctx, x, y, z, 4 + 2 * Math.round(s), 0.8 * k, d2 + 0.7);
  ctx.addShake(0.07 * s, delay);
  Water.current?.addRipple(x, z, Math.min(2.5, 1.2 + s));
  ctx.cue('thump', x, y, z, delay);
}

/** Spray thrown off a ship's bow (call every ~0.1 s while moving; amount ~ speed 0..1). */
export function bowSpray(ctx: FxContext, x: number, y: number, z: number, dx: number, dz: number, amount: number, size = 1): void {
  if (amount <= 0.05) return;
  const n = rnd() < amount ? 2 : 1;
  for (let i = 0; i < n; i++) {
    const side = rnd() < 0.5 ? -1 : 1;
    // sideways (perpendicular) and slightly forward
    const sx = -dz * side;
    const sz = dx * side;
    const sp = range(0.4, 0.9) * amount * size;
    const p = ctx.main.begin();
    p.at(x + sx * 0.04 * size, y + 0.03, z + sz * 0.04 * size)
      .vel(sx * sp + dx * sp * 0.6, range(0.4, 0.8) * amount * size, sz * sp + dz * sp * 0.6)
      .motion(range(0.45, 0.7), -3.5, 1.2)
      .size(0.04 * size, range(0.14, 0.22) * size, 1.5)
      .spin(rnd() * TAU, spread(1))
      .color(1, 1, 1, 0.55 * Math.min(1, amount + 0.3))
      .look(smokeFrame(), R.SPRAY, M.LIT)
      .fade(0.05, 0.45);
    p.wind = 0.3;
    p.push = 0.2;
    ctx.main.emit(p);
  }
}

/** Bubbles rising from below the surface (torpedo wake, sinking wreck). */
export function bubbles(ctx: FxContext, x: number, y: number, z: number, n: number, spreadR: number, delay = 0): void {
  n = count(ctx, n, 1);
  for (let i = 0; i < n; i++) {
    const p = ctx.glow.begin();
    p.at(x + spread(spreadR), y - range(0.0, 0.03), z + spread(spreadR))
      .vel(spread(0.04), range(0.04, 0.1), spread(0.04))
      .motion(range(0.5, 1.0), 0, 1)
      .size(range(0.025, 0.045), range(0.035, 0.06))
      .color(1, 1, 1, 0.75)
      .look(F.RING, R.BUBBLE)
      .fade(0.1, 0.6);
    p.push = 0.05;
    p.delay = delay + rnd() * 0.1;
    ctx.glow.emit(p);
  }
}

/** Sonar pulse: concentric cyan rings racing over the water + a bright centre blip. */
export function sonarPing(ctx: FxContext, x: number, y: number, z: number, radius: number): void {
  for (let i = 0; i < 3; i++) {
    const p = ctx.glow.begin();
    p.at(x, y + 0.02, z).motion(1.8 + i * 0.2).size(0.3, radius * 2.3, 1.25).spin(rnd() * TAU)
      .color(1, 1, 1, 0.9 - i * 0.2).look(F.RING, R.SONAR, M.FLAT).fade(0, 0.15);
    p.push = 0;
    p.delay = i * 0.38;
    ctx.glow.emit(p);
    const q = ctx.glow.begin();
    q.at(x, y + 0.015, z).motion(1.4 + i * 0.2).size(0.2, radius * 2.05, 1.3).spin(rnd() * TAU)
      .color(0.5, 0.5, 0.5, 0.45).look(F.SHOCK, R.SONAR, M.FLAT).fade(0, 0.1);
    q.push = 0;
    q.delay = i * 0.38 + 0.04;
    ctx.glow.emit(q);
  }
  const c = ctx.glow.begin();
  c.at(x, y + 0.03, z).motion(0.9).size(0.7, 0.25, 1.5).color(0.25, 1.2, 1.4, 0.7).look(F.GLOW, R.WHITE, M.FLAT).fade(0, 0.4);
  c.push = 0;
  ctx.glow.emit(c);
  flash(ctx, x, y + 0.25, z, 0.5, 0.8, 0, 0.2, 0.3, 1.0, 1.2);
  ctx.cue('sonar', x, y, z, 0);
}

/** Radar jamming burst: glitchy violet/green static ring, crackle and broken scan lines. */
export function radarJamPulse(ctx: FxContext, x: number, y: number, z: number, radius: number): void {
  for (let i = 0; i < 2; i++) {
    const p = ctx.glow.begin();
    p.at(x, y + 0.05, z).motion(0.9).size(0.4, radius * 2.2, 1.1).spin(rnd() * TAU)
      .color(1, 1, 1, 0.55).look(F.RING, R.JAM, M.FLAT).fade(0, 0.2);
    p.push = 0;
    p.delay = i * 0.22;
    ctx.glow.emit(p);
  }
  const cr = ctx.glow.begin();
  cr.at(x, y + 0.06, z).motion(0.35).size(radius * 0.8, radius * 1.6, 1).spin(rnd() * TAU, spread(4))
    .color(0.8, 0.8, 0.8, 0.8).look(F.CRACKLE, R.JAM, M.FLAT).fade(0, 0.3);
  cr.push = 0;
  ctx.glow.emit(cr);
  // broken scan lines flickering around the perimeter
  const b = ctx.beams;
  const n = count(ctx, 10, 4);
  for (let i = 0; i < n; i++) {
    const a = rnd() * TAU;
    const r0 = radius * range(0.35, 1.0);
    const len = range(0.2, 0.6);
    const ax = x + Math.cos(a) * r0;
    const az = z + Math.sin(a) * r0;
    const s = b.begin();
    s.from(ax, y + range(0.05, 0.4), az).to(ax - Math.sin(a) * len, y + range(0.05, 0.4), az + Math.cos(a) * len);
    s.life = range(0.08, 0.2);
    s.mode = BM.BOLT;
    s.style = BS.GLOW;
    s.tA = s.tB = rnd() * 0.6;
    const green = rnd() < 0.5;
    s.width(range(0.015, 0.035)).color(green ? 0.4 : 2.0, green ? 2.4 : 0.5, green ? 0.6 : 2.8, 0.9);
    b.emit(s);
  }
  // static sparkles
  const m = count(ctx, 14, 5);
  for (let i = 0; i < m; i++) {
    const a = rnd() * TAU;
    const r0 = Math.sqrt(rnd()) * radius;
    const p = ctx.glow.begin();
    p.at(x + Math.cos(a) * r0, y + range(0.05, 0.5), z + Math.sin(a) * r0).motion(range(0.06, 0.14)).size(range(0.06, 0.12), 0.03)
      .spin(rnd() * TAU).color(1, 1, 1, 1).look(F.STAR, R.JAM).fade(0, 0.3);
    p.push = 0.2;
    p.delay = rnd() * 0.8;
    ctx.glow.emit(p);
  }
}

/** Dirt fountain + crater for a land mine (the regular impact explosion supplies the fireball). */
export function mineBlast(ctx: FxContext, x: number, gy: number, z: number, at: boolean): void {
  const s = at ? 1.3 : 0.8;
  const n = count(ctx, at ? 18 : 11, 5);
  for (let i = 0; i < n; i++) {
    const a = rnd() * TAU;
    const r = Math.sqrt(rnd()) * 0.12 * s;
    const vy = range(2.2, 4.2) * Math.sqrt(s);
    const p = ctx.main.begin();
    p.at(x + Math.cos(a) * r, gy + 0.03, z + Math.sin(a) * r)
      .vel(Math.cos(a) * r * 6, vy, Math.sin(a) * r * 6)
      .motion(range(1.1, 1.8), -5.5, 0.6)
      .size(0.12 * s, range(0.5, 0.8) * s, 1.6)
      .spin(rnd() * TAU, spread(0.6))
      .color(1, 1, 1, 0.8)
      .look(F.DUST, R.DUST, M.LIT)
      .fade(0.02, 0.45);
    p.wind = 0.5;
    p.delay = rnd() * 0.05;
    ctx.main.emit(p);
  }
  debris(ctx, x, gy + 0.05, z, gy, at ? 8 : 5, 3.2 * s, 0, 0.2, 0.9);
  sparks(ctx, x, gy + 0.05, z, at ? 12 : 8, 4 * s, 0, { life: 0.5, up: 1.2 });
  scorchDecal(ctx, x, z, (at ? 1.1 : 0.7), 0.05, D.CRATER, 0.8, 55);
  groundGlow(ctx, x, gy, z, 1.4 * s, 0, 0.35);
  ctx.addShake(0.05 * s);
}

/** Small flat foam puff on water (wake helper for things without a ribbon). */
export function foamPuff(ctx: FxContext, x: number, y: number, z: number, size: number, life = 1.6): void {
  const p = ctx.main.begin();
  p.at(x + spread(0.03), y + 0.01, z + spread(0.03)).motion(life * range(0.8, 1.2)).size(size * 0.5, size * 1.4, 0.7).spin(rnd() * TAU, spread(0.3))
    .color(1, 1, 1, 0.45).look(irand(2) ? F.FIREBALL : F.GLOW, R.FOAM, M.FLAT).fade(0.05, 0.5);
  p.push = 0;
  ctx.main.emit(p);
}
