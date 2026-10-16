/**
 * Explosion recipes for every ExplosionKind.
 */
import type { ExplosionKind } from '../../data/rules';
import type { FxContext } from './context';
import { count } from './context';
import { F, R, D } from './textures';
import { M } from './particles';
import { BM, BS } from './beams';
import { rnd, range, spread, randDir, irand } from './rand';
import {
  flash, star, fireCore, fireball, smoke, sparks, debris, dustRing, shockRing, groundGlow,
  embers, flames, lightFlash, scorchDecal, smokeFrame,
} from './blocks';
import { underwaterBlast, waterSplash } from './water';
import { chronoFlash } from './misc';

const TAU = Math.PI * 2;

/** Splash size per explosion family when it happens on / in water. */
const WATER_SIZE: Partial<Record<ExplosionKind, number>> = { piff: 0.3, small: 0.65, medium: 1, large: 1.35, huge: 2, building: 1.8, fire: 0.6, electric: 0.55 };

/** Set while a recipe runs over open water: ground-contact layers (dust, shock dust, scorch) are skipped. */
let overWater = false;

/**
 * Extra (round 5) kinds accepted on top of ExplosionKind, so the sim can name them in impact events:
 * 'mad' / 'seismic' (M.A.D. tank pulse) and 'demo' / 'mininuke' (demolition truck).
 */
export type ExtraExplosionKind = 'mad' | 'seismic' | 'demo' | 'mininuke';

export function explosion(ctx: FxContext, kind: ExplosionKind | ExtraExplosionKind, x: number, y: number, z: number, scale: number, delay = 0): void {
  const gy = ctx.getHeight(x, z);
  const k = kind as string;
  if (k === 'mad' || k === 'seismic') {
    madPulse(ctx, x, gy, z, 3.5 * scale, delay);
    return;
  }
  if (k === 'demo' || k === 'mininuke') {
    demoBlast(ctx, x, gy, z, scale, delay);
    return;
  }
  if (kind !== 'nuke' && kind !== 'none' && ctx.isWater(x, z)) {
    const wl = ctx.waterLevel;
    const ws = (WATER_SIZE[kind as ExplosionKind] ?? 1) * scale;
    if (y < wl - 0.03) {
      // under the surface (torpedo / depth charge hits): water column instead of a fireball
      underwaterBlast(ctx, x, wl, z, ws, delay);
      if (kind === 'large' || kind === 'huge' || kind === 'building') flash(ctx, x, wl + 0.2, z, 1.2 * scale, 2, delay, 0.15);
      return;
    }
    overWater = true;
    try {
      explosionOn(ctx, kind, x, y, z, gy, scale, delay);
    } finally {
      overWater = false;
    }
    // near the surface the blast throws up water as well
    if (y - wl < 0.45 * scale) waterSplash(ctx, x, wl, z, ws * 0.8, delay + 0.02);
    return;
  }
  explosionOn(ctx, kind, x, y, z, gy, scale, delay);
}

function explosionOn(ctx: FxContext, kind: ExplosionKind | ExtraExplosionKind, x: number, y: number, z: number, gy: number, scale: number, delay: number): void {
  switch (kind) {
    case 'none': return;
    case 'piff': piff(ctx, x, y, z, gy, scale, delay); return;
    case 'small': small(ctx, x, y, z, gy, scale, delay); return;
    case 'medium': medium(ctx, x, y, z, gy, scale, delay); return;
    case 'large': large(ctx, x, y, z, gy, scale, delay); return;
    case 'huge': huge(ctx, x, y, z, gy, scale, delay); return;
    case 'fire': fireImpact(ctx, x, y, z, gy, scale, delay); return;
    case 'electric': electric(ctx, x, y, z, gy, scale, delay); return;
    case 'building': building(ctx, x, y, z, gy, scale, delay); return;
    case 'nuke': nuke(ctx, x, y, z, gy, scale, delay); return;
    default: return;
  }
}

function onGround(y: number, gy: number, s: number): boolean {
  return !overWater && y - gy < 0.6 * s;
}

// ---------------------------------------------------------------------------------------------

/** Bullet hit: tiny dirt puff + a spark. */
function piff(ctx: FxContext, x: number, y: number, z: number, gy: number, s: number, d: number): void {
  const n = 1 + irand(2);
  for (let i = 0; i < n; i++) {
    const p = ctx.main.begin();
    p.at(x + spread(0.04), Math.max(y, gy) + 0.03, z + spread(0.04))
      .vel(spread(0.25), range(0.25, 0.6), spread(0.25))
      .motion(range(0.45, 0.75), -0.3, 2.5)
      .size(0.05 * s, range(0.16, 0.24) * s, 2)
      .spin(rnd() * TAU, spread(1))
      .color(1, 1, 1, 0.55)
      .look(F.DUST, R.DUST, M.LIT)
      .fade(0.02, 0.3);
    p.push = 0.3;
    p.delay = d;
    ctx.main.emit(p);
  }
  flash(ctx, x, y + 0.02, z, 0.16 * s, 2.5, d, 0.06);
  if (rnd() < 0.7) sparks(ctx, x, y + 0.02, z, 1 + irand(2), 2.2, d, { life: 0.3, size: 0.018 });
}

/** Cannon hit (AP). */
function small(ctx: FxContext, x: number, y: number, z: number, gy: number, s: number, d: number): void {
  const yc = Math.max(y, gy + 0.08 * s);
  flash(ctx, x, yc + 0.05, z, 0.75 * s, 3, d, 0.1);
  star(ctx, x, yc + 0.05, z, 0.6 * s, 2.5, d, 0.07);
  fireCore(ctx, x, yc + 0.05 * s, z, 0.14 * s, 3, d, 0.3);
  fireball(ctx, x, yc, z, 0.22 * s, 7, d, { life: 1.4 });
  sparks(ctx, x, yc, z, 8, 3.2 * s, d, { life: 0.5 });
  smoke(ctx, x, yc + 0.05, z, 3, d + 0.12, { size0: 0.15 * s, size1: 0.55 * s, life: 1.6, rise: 0.35, alpha: 0.6, ramp: R.SMOKE_DARK, spreadR: 0.08 });
  debris(ctx, x, yc + 0.05, z, gy, 3, 2.2 * s, d, 0, 0.7);
  if (onGround(y, gy, s)) {
    dustRing(ctx, x, gy, z, 0.05, 5, 1.0 * s, d, { size: 0.22 * s, life: 0.9, alpha: 0.4 });
    groundGlow(ctx, x, gy, z, 0.9 * s, d, 0.25);
  }
  lightFlash(ctx, x, yc + 1.0, z, 0xffa040, 2.5 * s, 4 * s, 0.22, d);
  ctx.addShake(0.03 * s, d);
}

/** HE shell. */
function medium(ctx: FxContext, x: number, y: number, z: number, gy: number, s: number, d: number): void {
  const ground = onGround(y, gy, s);
  const yc = Math.max(y, gy + 0.12 * s);
  flash(ctx, x, yc + 0.1, z, 1.15 * s, 3.2, d, 0.13);
  fireCore(ctx, x, yc + 0.1 * s, z, 0.36 * s, 4, d, 0.32);
  fireball(ctx, x, yc, z, 0.4 * s, 15, d, { life: 2.1 });
  sparks(ctx, x, yc, z, 14, 4.2 * s, d, { life: 0.7 });
  smoke(ctx, x, yc + 0.2 * s, z, 6, d + 0.25, { size0: 0.3 * s, size1: 1.0 * s, life: 3.2, rise: 0.55, alpha: 0.75, spreadR: 0.15 * s, stagger: 0.4 });
  debris(ctx, x, yc + 0.05, z, gy, 8, 3.4 * s, d, 0.15, 1);
  if (ground) {
    dustRing(ctx, x, gy, z, 0.1 * s, 10, 2.2 * s, d, { size: 0.42 * s, life: 1.5, alpha: 0.55 });
    groundGlow(ctx, x, gy, z, 1.8 * s, d, 0.45);
    scorchDecal(ctx, x, z, 1.25 * s, d + 0.1);
  }
  lightFlash(ctx, x, yc + 1.5, z, 0xff9a40, 4 * s, 6 * s, 0.45, d);
  ctx.addShake(0.12 * s, d);
}

/** Vehicle death. */
function large(ctx: FxContext, x: number, y: number, z: number, gy: number, s: number, d: number): void {
  const ground = onGround(y, gy, s);
  const yc = Math.max(y, gy + 0.18 * s);
  flash(ctx, x, yc + 0.15, z, 1.7 * s, 3.2, d, 0.15);
  star(ctx, x, yc + 0.15, z, 1.6 * s, 2.5, d, 0.1);
  fireCore(ctx, x, yc + 0.15 * s, z, 0.55 * s, 5, d, 0.38);
  fireball(ctx, x, yc, z, 0.6 * s, 24, d, { life: 2.5 });
  // secondary pops
  const pops = 2 + irand(2);
  for (let i = 0; i < pops; i++) {
    const dd = d + range(0.12, 0.5);
    const a = rnd() * TAU;
    const r = range(0.25, 0.5) * s;
    const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r, py = yc + range(0.1, 0.45) * s;
    flash(ctx, px, py, pz, 0.9 * s, 4, dd, 0.1);
    fireCore(ctx, px, py, pz, 0.16 * s, 2, dd, 0.3);
    fireball(ctx, px, py, pz, 0.18 * s, 5, dd, { life: 1.3 });
    sparks(ctx, px, py, pz, 6, 3 * s, dd, { life: 0.5 });
  }
  sparks(ctx, x, yc, z, 22, 5.5 * s, d, { life: 0.9 });
  smoke(ctx, x, yc + 0.35 * s, z, 10, d + 0.35, { size0: 0.45 * s, size1: 1.5 * s, life: 4.2, rise: 0.7, alpha: 0.8, spreadR: 0.25 * s, stagger: 0.9 });
  debris(ctx, x, yc + 0.1, z, gy, 10, 4.2 * s, d, 0.5, 1.2);
  embers(ctx, x, yc + 0.2, z, 10, 0.4 * s, d + 0.2, 1.2);
  if (ground) {
    dustRing(ctx, x, gy, z, 0.15 * s, 14, 3.2 * s, d, { size: 0.6 * s, life: 1.9, alpha: 0.6 });
    shockRing(ctx, x, gy, z, 4.2 * s, d, 0.42, 1.5);
    groundGlow(ctx, x, gy, z, 3.2 * s, d, 0.7);
    scorchDecal(ctx, x, z, 1.9 * s, d + 0.1);
  }
  lightFlash(ctx, x, yc + 2.0, z, 0xff9038, 5 * s, 8 * s, 0.55, d);
  ctx.addShake(0.28 * s, d);
}

/** V2 rocket / building collapse. */
function huge(ctx: FxContext, x: number, y: number, z: number, gy: number, s: number, d: number): void {
  const ground = onGround(y, gy, s);
  const yc = Math.max(y, gy + 0.25 * s);
  flash(ctx, x, yc + 0.3, z, 2.8 * s, 3, d, 0.18);
  star(ctx, x, yc + 0.3, z, 3.2 * s, 3, d, 0.12);
  const balls = 5;
  for (let i = 0; i < balls; i++) {
    const dd = d + i * range(0.07, 0.13);
    const a = rnd() * TAU;
    const r = i === 0 ? 0 : range(0.3, 0.75) * s;
    const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r, py = yc + (i === 0 ? 0 : range(0.1, 0.6) * s);
    const rad = (i === 0 ? 0.8 : range(0.42, 0.6)) * s;
    fireCore(ctx, px, py + rad * 0.3, pz, rad * 0.8, i === 0 ? 4 : 2, dd, 0.25);
    fireball(ctx, px, py, pz, rad, i === 0 ? 26 : 10, dd, { life: i === 0 ? 3.0 : 2.6 });
    if (i > 0) flash(ctx, px, py, pz, 1.4 * s, 2.5, dd, 0.1);
  }
  sparks(ctx, x, yc, z, 34, 7 * s, d, { life: 1.1 });
  // tall smoke plume
  smoke(ctx, x, yc + 0.6 * s, z, 22, d + 0.4, { size0: 0.7 * s, size1: 2.4 * s, life: 6, rise: 1.15, alpha: 0.85, spreadR: 0.4 * s, stagger: 2.2 });
  debris(ctx, x, yc + 0.15, z, gy, 18, 5.8 * s, d, 0.5, 1.5);
  embers(ctx, x, yc + 0.3, z, 18, 0.7 * s, d + 0.3, 2.0, 1.8);
  if (ground) {
    dustRing(ctx, x, gy, z, 0.3 * s, 20, 4.5 * s, d, { size: 0.9 * s, life: 2.6, alpha: 0.65 });
    shockRing(ctx, x, gy, z, 7 * s, d, 0.55, 1.8);
    groundGlow(ctx, x, gy, z, 5.5 * s, d, 1.1);
    scorchDecal(ctx, x, z, 3.2 * s, d + 0.1, D.CRATER, 0.9, 60);
  }
  lightFlash(ctx, x, yc + 2.6, z, 0xff8a30, 10 * s, 12 * s, 1.1, d);
  ctx.addShake(0.6 * s, d);
  ctx.addShake(0.2 * s, d + 0.3);
}

/** Flame weapon impact: lingering flames + embers. */
function fireImpact(ctx: FxContext, x: number, y: number, z: number, gy: number, s: number, d: number): void {
  const yc = Math.max(y, gy);
  flash(ctx, x, yc + 0.15, z, 0.9 * s, 2.2, d, 0.12, 1, 0.7, 0.35);
  fireCore(ctx, x, yc + 0.15 * s, z, 0.22 * s, 3, d, 0.3);
  fireball(ctx, x, gy + 0.12 * s, z, 0.2 * s, 6, d, { life: 1.4, flat: 1.5 });
  flames(ctx, x, gy, z, 22, 0.42 * s, 0.3 * s, d, 1.4, 0.85);
  embers(ctx, x, gy + 0.1, z, 14, 0.3 * s, d, 1.4, 1.5);
  smoke(ctx, x, gy + 0.3 * s, z, 5, d + 0.3, { size0: 0.3 * s, size1: 1.0 * s, life: 2.6, rise: 0.6, alpha: 0.55, ramp: R.SMOKE_FIRE, spreadR: 0.18 * s, stagger: 1.2 });
  groundGlow(ctx, x, gy, z, 1.6 * s, d, 1.6, 2.0, 0.7, 0.2, 0.6);
  scorchDecal(ctx, x, z, 0.9 * s, d + 0.2, D.SCORCH_B, 0.6, 35);
  lightFlash(ctx, x, yc + 1.0, z, 0xff7a28, 4 * s, 4 * s, 1.2, d);
}

/** Tesla impact: blue-white crackle burst, arcs, sparks. */
function electric(ctx: FxContext, x: number, y: number, z: number, gy: number, s: number, d: number): void {
  const yc = Math.max(y, gy + 0.1);
  flash(ctx, x, yc, z, 1.1 * s, 2.6, d, 0.14, 0.55, 0.75, 1.4);
  for (let i = 0; i < 3; i++) {
    const p = ctx.glow.begin();
    p.at(x, yc, z).motion(range(0.12, 0.22)).size(range(0.7, 1.0) * s, range(0.9, 1.3) * s)
      .spin(rnd() * TAU, spread(6)).color(1, 1, 1, 1).look(F.CRACKLE, R.TESLA).fade(0, 0.2);
    p.push = 0.5;
    p.delay = d + i * 0.06;
    ctx.glow.emit(p);
  }
  sparks(ctx, x, yc, z, 16, 4 * s, d, { life: 0.45, ramp: R.TESLA, size: 0.03, gravity: -3 });
  // short jagged arcs radiating out
  const arcs = count(ctx, 6, 3);
  const b = ctx.beams;
  for (let i = 0; i < arcs; i++) {
    const dir = randDir();
    let px = x, py = yc, pz = z;
    const len = range(0.25, 0.55) * s;
    const segs = 4;
    const flick = d + rnd() * 0.15;
    for (let k = 0; k < segs; k++) {
      const nx = px + (dir.x + spread(0.7)) * len / segs;
      const ny = py + (Math.abs(dir.y) * 0.6 + spread(0.6)) * len / segs;
      const nz = pz + (dir.z + spread(0.7)) * len / segs;
      for (let layer = 0; layer < 2; layer++) {
        const sp = b.begin();
        sp.from(px, py, pz).to(nx, ny, nz);
        sp.tA = sp.tB = flick;
        sp.life = range(0.06, 0.12);
        sp.mode = BM.BOLT;
        sp.style = BS.GLOW;
        if (layer === 0) sp.width(0.02 * s).color(5, 6, 9, 1);
        else sp.width(0.1 * s).color(0.6, 0.9, 2.4, 0.7);
        b.emit(sp);
      }
      px = nx; py = ny; pz = nz;
    }
  }
  groundGlow(ctx, x, gy, z, 1.4 * s, d, 0.35, 0.7, 1.1, 2.6, 0.6);
  lightFlash(ctx, x, yc + 1.0, z, 0x88aaff, 8 * s, 5 * s, 0.3, d);
  ctx.addShake(0.04 * s, d);
}

/** Structure destroyed: chain of explosions over the footprint, plume, lots of debris. */
function building(ctx: FxContext, x: number, _y: number, z: number, gy: number, scale: number, d: number): void {
  const fp = Math.max(1, scale);
  const half = fp * 0.45;
  const n = Math.round(3 + fp * 2.2);
  const s = 1;
  for (let i = 0; i < n; i++) {
    const dd = d + (i / n) * 1.25 + rnd() * 0.08;
    const px = x + spread(half), pz = z + spread(half);
    const pgy = ctx.getHeight(px, pz);
    const py = pgy + 0.3 + range(0.5, 1.2) * Math.min(fp, 2.5) * 0.5;
    const rad = range(0.32, 0.5) * s;
    flash(ctx, px, py, pz, 1.3, 3, dd, 0.12);
    fireCore(ctx, px, py + 0.1, pz, rad, 3, dd, 0.4);
    fireball(ctx, px, py, pz, rad, 9, dd, { life: 1.9 });
    sparks(ctx, px, py, pz, 8, 4, dd, { life: 0.7 });
    debris(ctx, px, py, pz, pgy, 5, 3.8, dd, 0.3, 1.2);
    if (i % 2 === 0) lightFlash(ctx, px, py + 1.4, pz, 0xff9038, 12, 6, 0.45, dd);
    ctx.addShake(0.12, dd);
  }
  // final big blast
  const fd = d + 1.3;
  const yc = gy + 0.45 * Math.min(fp, 3);
  const R0 = 0.45 + 0.25 * fp;
  flash(ctx, x, yc + 0.3, z, 2.0 + fp, 3.5, fd, 0.2);
  fireCore(ctx, x, yc + 0.2, z, R0, 6, fd, 0.4);
  fireball(ctx, x, yc, z, R0, Math.round(14 + fp * 7), fd, { life: 2.6, flat: 1.3 });
  for (let k = 0; k < 3; k++) {
    const a = rnd() * TAU;
    fireball(ctx, x + Math.cos(a) * half * 0.6, yc + R0 * 0.5, z + Math.sin(a) * half * 0.6, R0 * 0.6, 6, fd + 0.1 + k * 0.08, { life: 2.2 });
  }
  sparks(ctx, x, yc, z, 30, 6.5, fd, { life: 1.0 });
  debris(ctx, x, yc, z, gy, Math.round(10 + fp * 6), 5.5, fd, 0.45, 1.6);
  embers(ctx, x, yc, z, 20, half, fd, 2.5, 1.8);
  if (!overWater) {
    dustRing(ctx, x, gy, z, half, Math.round(14 + fp * 4), 3.2, fd, { size: 0.8, life: 2.6, alpha: 0.7 });
    dustRing(ctx, x, gy, z, half * 0.5, 10, 1.2, d + 0.2, { size: 0.6, life: 2.2, alpha: 0.5 });
  } else waterSplash(ctx, x, gy, z, 1 + fp * 0.4, fd);
  shockRing(ctx, x, gy, z, 3 + fp * 2, fd, 0.5, 1.5);
  groundGlow(ctx, x, gy, z, 2.5 + fp * 1.5, fd, 1.0);
  // smoke plume rising from the ruins for several seconds
  smoke(ctx, x, gy + 0.3, z, Math.round(16 + fp * 6), d + 0.3, {
    size0: 0.5, size1: 1.6 + fp * 0.4, life: 5.5, rise: 1.0, alpha: 0.85, spreadR: half * 0.8, stagger: 3.5,
  });
  smoke(ctx, x, gy + 0.2, z, 8, d + 1.6, { size0: 0.4, size1: 1.4, life: 4, rise: 0.6, alpha: 0.6, ramp: R.SMOKE_FIRE, spreadR: half, stagger: 2 });
  scorchDecal(ctx, x, z, fp * 1.6 + 0.6, d + 0.4, D.CRATER, 0.9, 60);
  lightFlash(ctx, x, yc + 2.4, z, 0xff8a30, 40, 10 + fp * 2, 1.0, fd);
  ctx.addShake(0.45, fd);
}

// ---------------------------------------------------------------------------------------------

/** Nuclear detonation: flash, fireball rising into a mushroom cloud, shockwave, dust wall. */
function nuke(ctx: FxContext, x: number, _y: number, z: number, gy: number, s: number, d: number): void {
  const main = ctx.main;
  const glow = ctx.glow;
  // blinding flash
  flash(ctx, x, gy + 1.5 * s, z, 18 * s, 10, d, 0.24, 1, 0.95, 0.85);
  flash(ctx, x, gy + 1.0 * s, z, 34 * s, 1.6, d, 1.0, 1, 0.8, 0.5);
  star(ctx, x, gy + 1.5 * s, z, 12 * s, 4, d, 0.25, 1, 0.9, 0.7);
  lightFlash(ctx, x, gy + 5 * s, z, 0xffd8b0, 600 * s, 45 * s, 2.5, d);
  lightFlash(ctx, x, gy + 6 * s, z, 0xff8a40, 160 * s, 25 * s, 8.0, d + 1.2);
  ctx.addShake(2.2 * s, d);
  ctx.addShake(0.8 * s, d + 0.35);
  ctx.addShake(0.5 * s, d + 0.9);
  ctx.addShake(0.35 * s, d + 1.8);
  ctx.addShake(0.2 * s, d + 3.0);

  // ground ignition glow
  groundGlow(ctx, x, gy, z, 14 * s, d, 3.5, 3.5, 1.4, 0.4, 0.8);

  // mushroom cap: particles share one drag so the whole shape scales as it rises
  const H = 8 * s; // final cap height
  const drag = 0.42;
  const capR = 2.8 * s; // torus major radius at the end
  const tubeR = 1.4 * s;
  const capN = count(ctx, 210, 50);
  for (let i = 0; i < capN; i++) {
    const phi = rnd() * TAU;
    const th = rnd() * TAU;
    let ox: number, oy: number, oz: number;
    if (i % 4 === 3) {
      // dome filling the top
      const rr = Math.sqrt(rnd()) * capR;
      ox = Math.cos(phi) * rr;
      oz = Math.sin(phi) * rr;
      oy = tubeR * 0.55 + (1 - rr / capR) * tubeR * 0.5;
    } else {
      const ring = capR + Math.cos(th) * tubeR;
      ox = Math.cos(phi) * ring;
      oz = Math.sin(phi) * ring;
      oy = Math.sin(th) * tubeR * 0.7;
    }
    const p = main.begin();
    p.at(x + spread(0.3), gy + 0.4 * s, z + spread(0.3))
      .vel(ox * drag, (H + oy) * drag, oz * drag)
      .motion(range(8, 10.5), 0, drag)
      .size(range(0.7, 1.1) * s, range(2.2, 3.1) * s, 1.4)
      .spin(rnd() * TAU, spread(0.25))
      .color(1, 1, 1, 1)
      .look(smokeFrame(), R.NUKE, M.LIT)
      .fade(0, 0.78);
    p.wind = 0.15;
    p.push = 0.25;
    p.delay = d + rnd() * 0.08;
    main.emit(p);
  }
  // boiling waves that keep the cap alive and glowing from inside
  for (let wave = 1; wave <= 5; wave++) {
    const tau = wave * 0.55;
    const k = 1 - Math.exp(-drag * tau);
    const ek = Math.exp(-drag * tau);
    const n = count(ctx, 26, 8);
    for (let i = 0; i < n; i++) {
      const phi = rnd() * TAU;
      const th = rnd() * TAU;
      const ring = capR * range(0.2, 1.0) + Math.cos(th) * tubeR * 0.6;
      const ox = Math.cos(phi) * ring, oz = Math.sin(phi) * ring, oy = Math.sin(th) * tubeR * 0.5;
      const p = main.begin();
      p.at(x + ox * k, gy + 0.4 * s + (H + oy) * k, z + oz * k)
        .vel(ox * drag * ek, (H + oy) * drag * ek, oz * drag * ek)
        .motion(range(5.5, 7.5), 0, drag)
        .size(range(1.3, 1.9) * s, range(2.3, 3.2) * s, 1.5)
        .spin(rnd() * TAU, spread(0.3))
        .color(1, 1, 1, 0.9)
        .look(smokeFrame(), wave < 3 ? R.FIREBALL : R.SMOKE_FIRE, M.LIT)
        .fade(0.08, 0.7);
      p.wind = 0.15;
      p.push = 0.25;
      p.delay = d + tau;
      main.emit(p);
    }
  }
  // inner glow inside the rising fireball (follows the cap centre)
  for (let i = 0; i < 6; i++) {
    const g = glow.begin();
    g.at(x, gy + 0.4 * s, z).vel(spread(0.2), H * drag * range(0.9, 1.0), spread(0.2))
      .motion(range(2.6, 3.6), 0, drag)
      .size(3.5 * s, 6 * s, 1)
      .spin(rnd() * TAU, spread(0.3))
      .color(1.0, 0.42, 0.12, 0.45)
      .look(F.FIREBALL, R.WHITE)
      .fade(0.02, 0.2);
    g.push = 0.4;
    g.delay = d + i * 0.15;
    glow.emit(g);
  }
  // stem: column of smoke rising into the cap
  const stemN = count(ctx, 130, 30);
  for (let i = 0; i < stemN; i++) {
    const tau = 0.25 + (i / stemN) * 3.6;
    const capY = (H) * (1 - Math.exp(-drag * tau));
    const h = rnd() * capY * 0.85;
    const w = (0.45 + 0.4 * (h / H)) * s;
    const a = rnd() * TAU;
    const p = main.begin();
    p.at(x + Math.cos(a) * w * rnd(), gy + h, z + Math.sin(a) * w * rnd())
      .vel(spread(0.1), range(0.6, 1.2) * s, spread(0.1))
      .motion(range(5, 7), 0, 0.3)
      .size(range(0.8, 1.1) * s, range(1.4, 2.0) * s, 1.5)
      .spin(rnd() * TAU, spread(0.4))
      .color(1, 1, 1, 0.85)
      .look(smokeFrame(), tau < 1.2 ? R.FIREBALL : R.SMOKE_FIRE, M.LIT)
      .fade(0.1, 0.65);
    p.wind = 0.15;
    p.delay = d + tau;
    main.emit(p);
  }
  // base fireball hugging the ground early on
  fireCore(ctx, x, gy + 0.8 * s, z, 1.6 * s, 10, d, 0.9);
  fireball(ctx, x, gy + 0.3 * s, z, 1.3 * s, 26, d, { life: 3.2, flat: 1.6, rise: 0.4 });
  // shockwave + dust wall racing outward
  shockRing(ctx, x, gy, z, 34 * s, d + 0.02, 1.4, 3.2, 1, 0.9, 0.75);
  shockRing(ctx, x, gy, z, 22 * s, d + 0.15, 1.6, 1.4, 1, 0.75, 0.5);
  const dustN = count(ctx, 170, 40);
  for (let i = 0; i < dustN; i++) {
    const a = (i / dustN) * TAU + spread(0.08);
    const ca = Math.cos(a), sa = Math.sin(a);
    const sp = range(6.5, 12.5) * s;
    const p = main.begin();
    p.at(x + ca * 0.8 * s, gy + 0.4 * s, z + sa * 0.8 * s)
      .vel(ca * sp, range(0.3, 1.0), sa * sp)
      .motion(range(4.5, 6.5), 0.1, 0.85)
      .size(range(1.0, 1.4) * s, range(3.0, 4.2) * s, 1.8)
      .spin(rnd() * TAU, spread(0.5))
      .color(1, 1, 1, 0.42)
      .look(F.DUST, R.DUST, M.LIT)
      .fade(0.03, 0.55);
    p.wind = 0.3;
    p.delay = d + 0.05 + rnd() * 0.1;
    main.emit(p);
  }
  dustRing(ctx, x, gy, z, 1.5 * s, 30, 4.5 * s, d + 0.4, { size: 1.6 * s, life: 5, alpha: 0.65 });
  // heavy debris
  debris(ctx, x, gy + 0.5, z, gy, 30, 9 * s, d, 0.55, 2.2);
  sparks(ctx, x, gy + 0.5, z, 50, 11 * s, d, { life: 1.6, size: 0.06 });
  embers(ctx, x, gy + 1.5 * s, z, 40, 2.5 * s, d + 0.5, 4, 2.5);
  scorchDecal(ctx, x, z, 11 * s, d + 0.3, D.CRATER, 0.95, 120);
}

// ---------------------------------------------------------------------------------------------
// Round 5: Aftermath units

/**
 * M.A.D. tank seismic pulse: thudding ground rings racing out to `radius`, a rolling dust wave, dirt
 * clods thrown up as the wave passes, glowing fault lines and a deep shake. (x, gy, z) on the ground.
 */
export function madPulse(ctx: FxContext, x: number, gy: number, z: number, radius: number, d = 0): void {
  const R0 = Math.max(1, radius);
  // the thump at the piston
  flash(ctx, x, gy + 0.15, z, 1.1, 1.6, d, 0.12, 1, 0.75, 0.45);
  groundGlow(ctx, x, gy, z, 1.6, d, 0.5, 1.6, 0.7, 0.25, 0.6);
  // three rings, each a little later and wider
  for (let i = 0; i < 3; i++) {
    shockRing(ctx, x, gy, z, R0 * (1.5 + i * 0.35), d + i * 0.14, 0.75 + i * 0.15, 2.2 - i * 0.5, 1, 0.82, 0.6);
    const r = ctx.glow.begin();
    r.at(x, gy + 0.05, z).motion(0.8 + i * 0.2).size(0.4, R0 * (2.2 + i * 0.5), 1.6)
      .color(0.9, 0.55, 0.25, 0.55 - i * 0.12).look(F.RING, R.WHITE, M.FLAT).fade(0, 0.25);
    r.push = 0;
    r.delay = d + i * 0.14;
    ctx.glow.emit(r);
  }
  // dust wave rolling outward
  dustRing(ctx, x, gy, z, 0.35, 26, R0 * 1.25, d + 0.02, { size: 0.6, life: 1.6, alpha: 0.75 });
  dustRing(ctx, x, gy, z, R0 * 0.5, 16, R0 * 0.6, d + 0.25, { size: 0.45, life: 1.4, alpha: 0.5 });
  // clods kicked up as the wave front passes (delay grows with distance)
  const n = count(ctx, 14, 6);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + spread(0.25);
    const rr = R0 * range(0.35, 0.95);
    const px = x + Math.cos(a) * rr, pz = z + Math.sin(a) * rr;
    const py = ctx.getHeight(px, pz);
    const dd = d + rr / (R0 * 1.25) * 0.8;
    debris(ctx, px, py + 0.03, pz, py, 2, 1.6, dd, 0, 0.8);
    const p = ctx.main.begin();
    p.at(px, py + 0.05, pz).vel(spread(0.2), range(0.5, 1.1), spread(0.2)).motion(range(0.9, 1.4), 0.1, 2)
      .size(0.12, range(0.4, 0.6), 2).spin(rnd() * TAU, spread(0.6)).color(1, 1, 1, 0.5).look(F.DUST, R.DUST, M.LIT).fade(0.03, 0.4);
    p.wind = 0.4;
    p.delay = dd;
    ctx.main.emit(p);
  }
  // glowing fault lines splitting outward from the tank
  const b = ctx.beams;
  const cracks = count(ctx, 7, 4);
  for (let i = 0; i < cracks; i++) {
    const a = rnd() * TAU;
    let px = x, pz = z;
    const segs = 5;
    const len = R0 * range(0.35, 0.6);
    for (let k = 0; k < segs; k++) {
      const aa = a + spread(0.6);
      const nx = px + Math.cos(aa) * len / segs, nz = pz + Math.sin(aa) * len / segs;
      const sp = b.begin();
      sp.from(px, ctx.getHeight(px, pz) + 0.03, pz).to(nx, ctx.getHeight(nx, nz) + 0.03, nz);
      sp.tA = sp.tB = d + k * 0.03;
      sp.life = range(0.35, 0.55);
      sp.mode = BM.BOLT;
      sp.style = BS.GLOW;
      sp.width(0.035).color(2.2, 0.8, 0.25, 0.8);
      b.emit(sp);
      px = nx;
      pz = nz;
    }
  }
  lightFlash(ctx, x, gy + 1.0, z, 0xffa060, 3, R0 * 1.6, 0.35, d);
  ctx.addShake(0.3, d);
  ctx.addShake(0.15, d + 0.25);
}

/**
 * Demolition truck detonation: a small nuclear blast (scaled-down mushroom cloud) with a burning ring of
 * secondary fireballs and a broad crater scorch.
 */
export function demoBlast(ctx: FxContext, x: number, gy: number, z: number, scale = 1, d = 0): void {
  const s = Math.max(0.5, scale);
  nuke(ctx, x, gy, z, gy, 0.3 * s, d);
  huge(ctx, x, gy + 0.3, z, gy, 1.2 * s, d);
  demoRing(ctx, x, gy, z, s, d);
}

/** The demolition charge's ring of secondary fireballs and burning ground (on top of its small nuke). */
export function demoRing(ctx: FxContext, x: number, gy: number, z: number, scale = 1, d = 0): void {
  const s = Math.max(0.5, scale);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + spread(0.3);
    const r = range(0.8, 1.5) * s;
    const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
    const py = ctx.getHeight(px, pz);
    fireball(ctx, px, py + 0.2, pz, 0.35 * s, 6, d + 0.15 + rnd() * 0.25, { life: 1.8 });
    flames(ctx, px, py, pz, 6, 0.25 * s, 0.2, d + 0.3, 1.5, 1.2);
  }
  shockRing(ctx, x, gy, z, 9 * s, d + 0.05, 0.6, 2.4, 1, 0.8, 0.55);
  scorchDecal(ctx, x, z, 4.2 * s, d + 0.2, D.CRATER, 0.95, 150);
  ctx.addShake(0.9 * s, d);
}

/** Chrono tank jump: the chronosphere shimmer at both ends and a crackling rift between them. */
export function chronoShift(ctx: FxContext, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
  chronoFlash(ctx, x0, y0, z0);
  chronoFlash(ctx, x1, y1, z1);
  const b = ctx.beams;
  const dist = Math.hypot(x1 - x0, z1 - z0);
  const segs = Math.max(4, Math.min(16, Math.round(dist * 1.5)));
  for (let layer = 0; layer < 2; layer++) {
    let px = x0, py = y0 + 0.4, pz = z0;
    for (let k = 1; k <= segs; k++) {
      const t = k / segs;
      const arc = Math.sin(t * Math.PI) * Math.min(1.5, dist * 0.18);
      const nx = x0 + (x1 - x0) * t + (k < segs ? spread(0.18) : 0);
      const ny = y0 + (y1 - y0) * t + 0.4 + arc + (k < segs ? spread(0.12) : 0);
      const nz = z0 + (z1 - z0) * t + (k < segs ? spread(0.18) : 0);
      const sp = b.begin();
      sp.from(px, py, pz).to(nx, ny, nz);
      sp.tA = sp.tB = t * 0.12;
      sp.life = 0.35;
      sp.mode = BM.BOLT;
      sp.style = BS.GLOW;
      if (layer === 0) sp.width(0.03).color(2.5, 6, 7, 1);
      else sp.width(0.16).color(0.2, 1.1, 1.6, 0.6);
      b.emit(sp);
      px = nx;
      py = ny;
      pz = nz;
    }
  }
}
