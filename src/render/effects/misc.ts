/**
 * Small gameplay effects: heal, dust, construction, chronosphere, iron curtain, ore glints,
 * order markers, ambient motes.
 */
import type { FxContext } from './context';
import { count } from './context';
import { F, R } from './textures';
import { M } from './particles';
import { BM, BS } from './beams';
import { rnd, range, spread, irand } from './rand';
import { dustRing, sparks, groundGlow, flash } from './blocks';
import type { ShellPool } from './shells';

const TAU = Math.PI * 2;
const CORNERS = [-1, -1, 1, -1, 1, 1, -1, 1];

export function healPulse(ctx: FxContext, x: number, y: number, z: number): void {
  const gy = ctx.getHeight(x, z);
  const n = 4;
  for (let i = 0; i < n; i++) {
    const s = ctx.glow.begin();
    s.at(x + spread(0.16), y + range(0.05, 0.2), z + spread(0.16))
      .vel(spread(0.05), range(0.45, 0.7), spread(0.05))
      .motion(range(0.9, 1.2), 0, 0.6)
      .size(0.09, 0.13)
      .color(0.55, 2.3, 0.85, 1)
      .look(F.PLUS, R.WHITE)
      .fade(0.15, 0.55);
    s.push = 0.3;
    s.delay = i * 0.12;
    ctx.glow.emit(s);
  }
  const m = count(ctx, 10, 3);
  for (let i = 0; i < m; i++) {
    const s = ctx.glow.begin();
    s.at(x + spread(0.2), y + rnd() * 0.25, z + spread(0.2))
      .vel(spread(0.1), range(0.3, 0.8), spread(0.1))
      .motion(range(0.6, 1.1), 0, 0.5)
      .size(range(0.025, 0.045), 0.01)
      .color(1.2, 2.6, 1.3, 1)
      .look(F.GLOW, R.WHITE)
      .fade(0.1, 0.5);
    s.push = 0.2;
    s.delay = rnd() * 0.3;
    ctx.glow.emit(s);
  }
  const r = ctx.glow.begin();
  r.at(x, gy + 0.04, z).motion(0.6).size(0.25, 0.9, 2).color(0.4, 1.8, 0.6, 0.7).look(F.RING, R.WHITE, M.FLAT).fade(0, 0.2);
  r.push = 0;
  ctx.glow.emit(r);
}

export function dust(ctx: FxContext, x: number, z: number, amount: number): void {
  const gy = ctx.getHeight(x, z);
  const n = Math.max(1, Math.floor(amount * 1.6 + rnd()));
  const a = Math.min(1, amount) * 0.38;
  for (let i = 0; i < n; i++) {
    const s = ctx.main.begin();
    s.at(x + spread(0.1), gy + 0.06, z + spread(0.1))
      .vel(spread(0.2), range(0.08, 0.3), spread(0.2))
      .motion(range(1.0, 1.7), -0.03, 1.4)
      .size(0.1, range(0.38, 0.55), 1.8)
      .spin(rnd() * TAU, spread(0.6))
      .color(1, 1, 1, a)
      .look(F.DUST, R.DUST, M.LIT)
      .fade(0.08, 0.35);
    s.wind = 0.6;
    s.push = 0.3;
    ctx.main.emit(s);
  }
}

/** Cyan holographic grid + scan outline, dust ring and golden sparks over a footprint. */
export function constructionBurst(ctx: FxContext, x: number, y: number, z: number, size: number): void {
  const gy = ctx.getHeight(x, z);
  const half = size * 0.5;
  dustRing(ctx, x, gy, z, half * 0.9, count(ctx, 10 + size * 4, 6), 1.4, 0, { size: 0.45, life: 1.5, alpha: 0.5 });
  // golden sparks shooting up from random points of the footprint
  const ns = count(ctx, 6 + size * 3, 4);
  for (let i = 0; i < ns; i++) {
    sparks(ctx, x + spread(half), gy + 0.05, z + spread(half), 2, 2.8, rnd() * 0.35, { up: 2.5, life: 0.8, size: 0.03, gravity: -5, r: 1, g: 0.85, b: 0.45 });
  }
  // holographic grid lines (follow terrain with 4 sub-segments each)
  const b = ctx.beams;
  const lines = Math.max(2, Math.round(size * 2));
  const sub = 4;
  const lift = 0.06;
  for (let axis = 0; axis < 2; axis++) {
    for (let l = 0; l <= lines; l++) {
      const off = -half + (l / lines) * size;
      const border = l === 0 || l === lines;
      for (let k = 0; k < sub; k++) {
        const u0 = -half + (k / sub) * size;
        const u1 = -half + ((k + 1) / sub) * size;
        const ax = axis === 0 ? x + u0 : x + off;
        const az = axis === 0 ? z + off : z + u0;
        const bx = axis === 0 ? x + u1 : x + off;
        const bz = axis === 0 ? z + off : z + u1;
        const s = b.begin();
        s.from(ax, ctx.getHeight(ax, az) + lift, az).to(bx, ctx.getHeight(bx, bz) + lift, bz);
        s.life = border ? 0.9 : 0.7;
        s.mode = BM.BOLT;
        s.style = BS.GLOW;
        s.tA = s.tB = l * 0.02;
        if (border) s.width(0.05).color(0.25, 1.1, 1.5, 0.9);
        else s.width(0.028).color(0.15, 0.7, 1.0, 0.6);
        b.emit(s);
      }
    }
  }
  // scan outline rising over the footprint (ribbon mode drifts both ends upward)
  for (let side = 0; side < 4; side++) {
    const ax = x + CORNERS[side * 2] * half, az = z + CORNERS[side * 2 + 1] * half;
    const n = (side + 1) % 4;
    const bx = x + CORNERS[n * 2] * half, bz = z + CORNERS[n * 2 + 1] * half;
    const s = b.begin();
    s.from(ax, gy + lift, az).to(bx, gy + lift, bz);
    s.life = 0.75;
    s.mode = BM.RIBBON;
    s.style = BS.GLOW;
    s.rise = Math.max(0.8, size * 0.9);
    s.width(0.06, 0.02).color(0.3, 1.2, 1.6, 0.9);
    b.emit(s);
  }
  // ring pulse
  const r = ctx.glow.begin();
  r.at(x, gy + 0.05, z).motion(0.7).size(size * 0.5, size * 1.7, 2).color(0.2, 0.9, 1.25, 0.7).look(F.RING, R.WHITE, M.FLAT).fade(0, 0.1);
  r.push = 0;
  ctx.glow.emit(r);
  // sparkles at intersections
  for (let i = 0; i < 6; i++) {
    const s = ctx.glow.begin();
    const px = x - half + irand(lines + 1) * (size / lines);
    const pz = z - half + irand(lines + 1) * (size / lines);
    s.at(px, ctx.getHeight(px, pz) + 0.08, pz).motion(range(0.3, 0.5)).size(0.22, 0.05).spin(rnd() * TAU, 3)
      .color(1.0, 2.4, 3.0, 1).look(F.STAR, R.WHITE).fade(0.1, 0.4);
    s.delay = rnd() * 0.5;
    s.push = 0.2;
    ctx.glow.emit(s);
  }
  void y;
}

/** Chronosphere: cyan/white light column with ripple rings and rising motes. */
export function chronoFlash(ctx: FxContext, x: number, y: number, z: number): void {
  const gy = ctx.getHeight(x, z);
  const H = 7;
  // wide soft column
  let s = ctx.glow.begin();
  s.at(x, gy + H * 0.5, z).motion(1.0).size(1.2, 0.3, 2).color(0.15, 0.9, 1.3, 0.85).look(F.GLOW, R.WHITE, M.CYLINDER, H / 1.2).fade(0.04, 0.35);
  s.push = 0;
  ctx.glow.emit(s);
  // bright core
  s = ctx.glow.begin();
  s.at(x, gy + H * 0.5, z).motion(0.7).size(0.3, 0.06, 1.5).color(0.6, 2.0, 2.5, 1).look(F.GLOW, R.WHITE, M.CYLINDER, H / 0.32).fade(0.03, 0.3);
  s.push = 0;
  ctx.glow.emit(s);
  flash(ctx, x, gy + 0.6, z, 1.8, 1.6, 0, 0.25, 0.4, 1.0, 1.3);
  // ripple rings
  for (let i = 0; i < 4; i++) {
    const r = ctx.glow.begin();
    r.at(x, gy + 0.05 + i * 0.02, z).motion(0.9).size(0.3, 3.2, 1.8).color(0.3, 1.2, 1.6, 0.9).look(i % 2 === 0 ? F.RING : F.SHOCK, R.WHITE, M.FLAT).fade(0, 0.2);
    r.push = 0;
    r.delay = i * 0.14;
    ctx.glow.emit(r);
  }
  // rising motes
  const n = count(ctx, 28, 8);
  for (let i = 0; i < n; i++) {
    const a = rnd() * TAU;
    const rr = Math.sqrt(rnd()) * 0.6;
    const p = ctx.glow.begin();
    p.at(x + Math.cos(a) * rr, gy + rnd() * 0.6, z + Math.sin(a) * rr)
      .vel(spread(0.2), range(1.5, 4.5), spread(0.2))
      .motion(range(0.8, 1.4), 0, 0.6)
      .size(range(0.04, 0.08), 0.02)
      .color(1.5, 3.2, 4, 1)
      .look(F.GLOW, R.WHITE)
      .fade(0.1, 0.5);
    p.push = 0.2;
    p.delay = rnd() * 0.4;
    ctx.glow.emit(p);
  }
  groundGlow(ctx, x, gy, z, 3.0, 0, 0.9, 0.2, 1.2, 1.7, 0.7);
  ctx.lights.flash(ctx.now, x, gy + 1.8, z, 0x66ddff, 14, 8, 0.9);
  void y;
}

/** Iron Curtain: red shimmering shell + sparkles. */
export function ironCurtainPulse(ctx: FxContext, shells: ShellPool, x: number, y: number, z: number, radius: number): void {
  const gy = ctx.getHeight(x, z);
  shells.spawn(ctx.now, x, Math.max(y, gy + radius * 0.35), z, radius, 1.7);
  const n = count(ctx, 22, 6);
  for (let i = 0; i < n; i++) {
    const a = rnd() * TAU;
    const el = rnd() * Math.PI * 0.5;
    const p = ctx.glow.begin();
    const px = x + Math.cos(a) * Math.cos(el) * radius;
    const py = Math.max(y, gy + radius * 0.35) + Math.sin(el) * radius * 0.9;
    const pz = z + Math.sin(a) * Math.cos(el) * radius;
    p.at(px, py, pz).vel(spread(0.1), range(0.1, 0.5), spread(0.1)).motion(range(0.5, 1.0), 0, 1)
      .size(range(0.08, 0.16), 0.02).spin(rnd() * TAU, spread(4))
      .color(3.5, 0.5, 0.35, 1).look(F.STAR, R.WHITE).fade(0.15, 0.4);
    p.delay = rnd() * 0.8;
    p.push = 0.2;
    ctx.glow.emit(p);
  }
  const r = ctx.glow.begin();
  r.at(x, gy + 0.05, z).motion(0.8).size(radius * 0.8, radius * 2.4, 2).color(2.2, 0.25, 0.15, 0.8).look(F.RING, R.WHITE, M.FLAT).fade(0, 0.2);
  r.push = 0;
  ctx.glow.emit(r);
  groundGlow(ctx, x, gy, z, radius * 2.2, 0, 1.2, 1.6, 0.15, 0.1, 0.5);
  ctx.lights.flash(ctx.now, x, gy + radius, z, 0xff3322, 20, radius * 3 + 2, 1.0);
}

const GEM_COLS = [
  [1.3, 0.55, 3.2],
  [0.4, 2.4, 3.0],
  [2.4, 0.6, 2.6],
];

export function oreSparkle(ctx: FxContext, x: number, y: number, z: number, gems: boolean): void {
  const n = 4 + irand(3);
  for (let i = 0; i < n; i++) {
    const c = gems ? GEM_COLS[irand(3)] : [3.2, 2.2, 0.55];
    const p = ctx.glow.begin();
    p.at(x + spread(0.25), y + range(0.02, 0.15), z + spread(0.25))
      .vel(spread(0.12), range(0.35, 0.8), spread(0.12))
      .motion(range(0.55, 0.95), -0.2, 0.8)
      .size(range(0.1, 0.17), 0.02)
      .spin(rnd() * TAU, spread(5))
      .color(c[0], c[1], c[2], 1)
      .look(F.STAR, R.WHITE)
      .fade(0.15, 0.45);
    p.push = 0.25;
    p.delay = rnd() * 0.3;
    ctx.glow.emit(p);
  }
  for (let i = 0; i < 5; i++) {
    const c = gems ? GEM_COLS[irand(3)] : [2.2, 1.6, 0.45];
    const p = ctx.glow.begin();
    p.at(x + spread(0.2), y + 0.05, z + spread(0.2)).vel(spread(0.2), range(0.2, 0.6), spread(0.2)).motion(range(0.5, 0.9), 0, 1)
      .size(0.03, 0.01).color(c[0], c[1], c[2], 1).look(F.GLOW, R.WHITE).fade(0.1, 0.4);
    p.push = 0.2;
    p.delay = rnd() * 0.2;
    ctx.glow.emit(p);
  }
}

export function orderMarker(ctx: FxContext, x: number, z: number, kind: 'move' | 'attack' | 'rally'): void {
  const gy = ctx.getHeight(x, z) + 0.05;
  let r = 0.35, g = 1.7, b = 0.5;
  if (kind === 'attack') { r = 2.3; g = 0.3; b = 0.2; }
  else if (kind === 'rally') { r = 2.0; g = 1.6; b = 0.35; }
  const life = 0.6;
  // contracting ring
  let s = ctx.glow.begin();
  s.at(x, gy, z).motion(life).size(1.05, 0.32, 2).color(r, g, b, 1).look(F.RING, R.WHITE, M.FLAT).fade(0, 0.45);
  s.push = 0;
  ctx.glow.emit(s);
  // faint outward ripple
  s = ctx.glow.begin();
  s.at(x, gy, z).motion(life * 0.8).size(0.25, 1.3, 2).color(r * 0.6, g * 0.6, b * 0.6, 0.6).look(F.RING, R.WHITE, M.FLAT).fade(0, 0.1);
  s.push = 0;
  ctx.glow.emit(s);
  // chevrons converging on the point
  const offA = kind === 'attack' ? Math.PI / 4 : 0;
  for (let i = 0; i < 4; i++) {
    const phi = offA + (i / 4) * TAU;
    const ca = Math.cos(phi), sa = Math.sin(phi);
    s = ctx.glow.begin();
    s.at(x + ca * 0.6, gy + 0.005, z + sa * 0.6)
      .vel(-ca * 1.6, 0, -sa * 1.6)
      .motion(life * 0.9, 0, 4.5)
      .size(0.26, 0.2)
      .spin(phi + Math.PI / 2)
      .color(r, g, b, 1)
      .look(F.CHEVRON, R.WHITE, M.FLAT)
      .fade(0.05, 0.5);
    s.push = 0;
    ctx.glow.emit(s);
  }
  // centre dot
  s = ctx.glow.begin();
  s.at(x, gy, z).motion(life).size(0.3, 0.15).color(r, g, b, 0.8).look(F.GLOW, R.WHITE, M.FLAT).fade(0.05, 0.5);
  s.push = 0;
  ctx.glow.emit(s);
  if (kind === 'rally') {
    s = ctx.glow.begin();
    s.at(x, gy + 0.5, z).motion(life).size(0.12, 0.06).color(r, g, b, 0.8).look(F.GLOW, R.WHITE, M.CYLINDER, 8).fade(0.05, 0.4);
    s.push = 0;
    ctx.glow.emit(s);
  }
}

/** Ambient floating dust / pollen motes around the camera target. */
export class AmbientMotes {
  cx = 0;
  cz = 0;
  enabled = true;
  rate = 9;
  private acc = 0;
  update(ctx: FxContext, dt: number): void {
    if (!this.enabled) return;
    this.acc += dt * this.rate * ctx.density;
    let guard = 0;
    while (this.acc >= 1 && guard++ < 20) {
      this.acc -= 1;
      const x = this.cx + spread(17);
      const z = this.cz + spread(12);
      const p = ctx.glow.begin();
      const warm = rnd() < 0.7;
      const k = range(0.25, 0.5);
      p.at(x, ctx.getHeight(x, z) + range(0.15, 2.4), z)
        .vel(spread(0.08), spread(0.05), spread(0.08))
        .motion(range(5, 9), 0.01, 0.1)
        .size(range(0.022, 0.045), range(0.02, 0.04))
        .color(warm ? k : k * 0.85, warm ? k * 0.93 : k * 0.95, warm ? k * 0.7 : k, 0.8)
        .look(F.GLOW, R.WHITE)
        .fade(0.25, 0.7);
      p.wind = 0.6;
      p.push = 0;
      ctx.glow.emit(p);
    }
  }
}
