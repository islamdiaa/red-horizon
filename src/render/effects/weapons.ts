/**
 * Instant weapon visuals: muzzle flash, tracer, tesla bolt, flame stream.
 */
import * as THREE from 'three';
import type { FxContext } from './context';
import { count } from './context';
import { F, R } from './textures';
import { M } from './particles';
import { BM, BS } from './beams';
import { rnd, range, spread, randDir, irand } from './rand';
import { flash, star, sparks, smoke, embers, smokeFrame } from './blocks';

const TAU = Math.PI * 2;
const tmpColor = new THREE.Color();

export function muzzleFlash(ctx: FxContext, px: number, py: number, pz: number, dx: number, dy: number, dz: number, size: number): void {
  const l = Math.hypot(dx, dy, dz) || 1;
  dx /= l; dy /= l; dz /= l;
  // flash sits slightly ahead of the muzzle
  const fx = px + dx * 0.05 * size, fy = py + dy * 0.05 * size, fz = pz + dz * 0.05 * size;
  star(ctx, fx, fy, fz, 0.32 * size, 4.5, 0, 0.06);
  flash(ctx, fx, fy, fz, 0.45 * size, 2.2, 0, 0.07);
  const n = 3;
  for (let i = 0; i < n; i++) {
    const sp = range(2.0, 4.5) * size;
    const s = ctx.glow.begin();
    s.at(fx, fy, fz)
      .vel((dx + spread(0.12)) * sp, (dy + spread(0.12)) * sp, (dz + spread(0.12)) * sp)
      .motion(range(0.06, 0.1), 0, 14)
      .size(0.11 * size, 0.06 * size)
      .color(6, 3.8, 1.5, 1)
      .look(F.FLARE, R.WHITE, M.STREAK, 0.09)
      .fade(0, 0.3);
    s.push = 0.3;
    ctx.glow.emit(s);
  }
  // little puff of smoke
  const m = ctx.main.begin();
  m.at(fx + dx * 0.05, fy + dy * 0.05, fz + dz * 0.05)
    .vel(dx * 0.6 * size, 0.15 + dy * 0.6 * size, dz * 0.6 * size)
    .motion(range(0.7, 1.1), 0.1, 2.5)
    .size(0.07 * size, 0.32 * size, 1.8)
    .spin(rnd() * TAU, spread(0.8))
    .color(1, 1, 1, 0.35)
    .look(smokeFrame(), R.SMOKE, M.LIT)
    .fade(0.05, 0.35);
  m.wind = 0.5;
  m.push = 0.3;
  ctx.main.emit(m);
}

export function tracer(ctx: FxContext, ax: number, ay: number, az: number, bx: number, by: number, bz: number, color?: number): void {
  const L = Math.hypot(bx - ax, by - ay, bz - az);
  if (L < 0.02) return;
  const streak = Math.min(0.7, Math.max(0.12, 0.9 / L));
  const travel = Math.min(0.12, Math.max(0.07, L / 45));
  const life = travel * (1 + streak);
  let r = 1, g = 0.82, b = 0.48;
  if (color !== undefined) {
    tmpColor.setHex(color);
    r = tmpColor.r; g = tmpColor.g; b = tmpColor.b;
  }
  const bb = ctx.beams;
  for (let layer = 0; layer < 2; layer++) {
    const s = bb.begin();
    s.from(ax, ay, az).to(bx, by, bz);
    s.life = life;
    s.mode = BM.TRACER;
    s.style = BS.GLOW;
    s.extra = streak;
    s.ramp = R.WHITE;
    if (layer === 0) s.width(0.022).color(r * 7, g * 7, b * 7, 1);
    else s.width(0.11).color(r * 1.1, g * 1.1, b * 1.1, 0.55);
    bb.emit(s);
  }
}

// ---------------------------------------------------------------------------------------------
// Tesla bolt: jagged branching lightning, re-randomised several times (pre-scheduled with delays).

const BOLT_N = 16;
const pts = new Float32Array((BOLT_N + 1) * 3);
const bpts = new Float32Array(6 * 3);

function displace(i0: number, i1: number, mag: number, dx: number, dy: number, dz: number): void {
  if (i1 - i0 < 2) return;
  const mid = (i0 + i1) >> 1;
  const d = randDir();
  // remove the component along the bolt so the offset is perpendicular
  const k = d.x * dx + d.y * dy + d.z * dz;
  const ox = d.x - dx * k, oy = d.y - dy * k, oz = d.z - dz * k;
  const m = mag * range(0.3, 1.0);
  pts[mid * 3] = (pts[i0 * 3] + pts[i1 * 3]) * 0.5 + ox * m;
  pts[mid * 3 + 1] = (pts[i0 * 3 + 1] + pts[i1 * 3 + 1]) * 0.5 + oy * m;
  pts[mid * 3 + 2] = (pts[i0 * 3 + 2] + pts[i1 * 3 + 2]) * 0.5 + oz * m;
  displace(i0, mid, mag * 0.55, dx, dy, dz);
  displace(mid, i1, mag * 0.55, dx, dy, dz);
}

function boltSeg(ctx: FxContext, ax: number, ay: number, az: number, bx: number, by: number, bz: number, t0: number, life: number, thin: number): void {
  const b = ctx.beams;
  // core
  let s = b.begin();
  s.from(ax, ay, az).to(bx, by, bz);
  s.tA = s.tB = t0;
  s.life = life;
  s.mode = BM.BOLT;
  s.style = BS.GLOW;
  s.width(0.032 * thin).color(6, 7.5, 11, 1);
  b.emit(s);
  // glow
  s = b.begin();
  s.from(ax, ay, az).to(bx, by, bz);
  s.tA = s.tB = t0;
  s.life = life;
  s.mode = BM.BOLT;
  s.style = BS.GLOW;
  s.width(0.17 * thin).color(0.45, 0.7, 2.2, 0.7);
  b.emit(s);
}

export function teslaBolt(ctx: FxContext, ax: number, ay: number, az: number, bx: number, by: number, bz: number): void {
  const L = Math.hypot(bx - ax, by - ay, bz - az);
  if (L < 0.02) return;
  const dx = (bx - ax) / L, dy = (by - ay) / L, dz = (bz - az) / L;
  const flickers = 5;
  for (let f = 0; f < flickers; f++) {
    const t0 = f * 0.055;
    const life = f === flickers - 1 ? 0.14 : 0.075;
    pts[0] = ax; pts[1] = ay; pts[2] = az;
    pts[BOLT_N * 3] = bx; pts[BOLT_N * 3 + 1] = by; pts[BOLT_N * 3 + 2] = bz;
    displace(0, BOLT_N, L * 0.22, dx, dy, dz);
    for (let i = 0; i < BOLT_N; i++) {
      const o = i * 3;
      boltSeg(ctx, pts[o], pts[o + 1], pts[o + 2], pts[o + 3], pts[o + 4], pts[o + 5], t0, life, 1);
    }
    // branches
    const nb = 1 + irand(3);
    for (let k = 0; k < nb; k++) {
      const i = 2 + irand(BOLT_N - 5);
      let px = pts[i * 3], py = pts[i * 3 + 1], pz = pts[i * 3 + 2];
      const d = randDir();
      let bdx = dx + d.x * 0.9, bdy = dy + d.y * 0.9, bdz = dz + d.z * 0.9;
      const bl = Math.hypot(bdx, bdy, bdz) || 1;
      bdx /= bl; bdy /= bl; bdz /= bl;
      const len = L * range(0.12, 0.28);
      const segs = 4;
      bpts[0] = px; bpts[1] = py; bpts[2] = pz;
      for (let j = 1; j <= segs; j++) {
        const step = len / segs;
        px += bdx * step + spread(step * 0.6);
        py += bdy * step + spread(step * 0.6);
        pz += bdz * step + spread(step * 0.6);
        boltSeg(ctx, bpts[0], bpts[1], bpts[2], px, py, pz, t0, life, 0.6 - j * 0.08);
        bpts[0] = px; bpts[1] = py; bpts[2] = pz;
      }
    }
  }
  // glow at source and target + sparks at target
  const g = ctx.glow.begin();
  g.at(ax, ay, az).motion(0.34).size(0.55, 0.8).color(1.4, 2.0, 4.2, 1).look(F.GLOW, R.WHITE).fade(0, 0.4);
  g.push = 0.4;
  ctx.glow.emit(g);
  flash(ctx, bx, by, bz, 1.1, 4, 0, 0.3, 0.6, 0.8, 1.5);
  sparks(ctx, bx, by, bz, count(ctx, 12, 4), 3.5, 0, { life: 0.45, ramp: R.TESLA, size: 0.028, gravity: -3 });
  sparks(ctx, bx, by, bz, count(ctx, 6, 2), 2.5, 0.15, { life: 0.35, ramp: R.TESLA, size: 0.022, gravity: -3 });
  const c = ctx.glow.begin();
  c.at(bx, by, bz).motion(0.3).size(0.6, 0.9).spin(rnd() * TAU, 8).color(1, 1, 1, 1).look(F.CRACKLE, R.TESLA).fade(0, 0.3);
  c.push = 0.5;
  ctx.glow.emit(c);
  ctx.lights.flash(ctx.now, bx, by + 1.0, bz, 0x99bbff, 5, 5, 0.3);
}

// ---------------------------------------------------------------------------------------------

export function flameStream(ctx: FxContext, ax: number, ay: number, az: number, bx: number, by: number, bz: number): void {
  const L = Math.hypot(bx - ax, by - ay, bz - az);
  if (L < 0.02) return;
  const dx = (bx - ax) / L, dy = (by - ay) / L, dz = (bz - az) / L;
  const T = 0.3;
  const drag = 1.6;
  const v0 = (L * drag) / (1 - Math.exp(-drag * T));
  const n = count(ctx, 90, 20);
  const dur = 0.5;
  for (let i = 0; i < n; i++) {
    const del = (i / n) * dur;
    const vs = v0 * range(0.85, 1.06);
    const sp = 0.1;
    const s = ctx.main.begin();
    s.at(ax + dx * 0.05, ay + dy * 0.05, az + dz * 0.05)
      .vel((dx + spread(sp)) * vs, (dy + spread(sp)) * vs + 0.2, (dz + spread(sp)) * vs)
      .motion(T * range(1.7, 2.5), 1.0, drag)
      .size(range(0.16, 0.22), range(0.65, 0.9), 1.4)
      .spin(rnd() * TAU, spread(3))
      .color(1, 1, 1, 0.6)
      .look(rnd() < 0.6 ? F.FIREBALL : F.FLAME, R.FLAME_JET)
      .fade(0.04, 0.5);
    s.push = 0.35;
    s.delay = del;
    ctx.main.emit(s);
  }
  // bright tongues near the nozzle (additive)
  const m = count(ctx, 16, 4);
  for (let i = 0; i < m; i++) {
    const vs = v0 * range(0.5, 0.8);
    const s = ctx.glow.begin();
    s.at(ax, ay, az)
      .vel((dx + spread(0.05)) * vs, (dy + spread(0.05)) * vs, (dz + spread(0.05)) * vs)
      .motion(range(0.1, 0.16), 0, drag * 2)
      .size(0.12, 0.2)
      .spin(rnd() * TAU, spread(4))
      .color(1.6, 1.0, 0.45, 0.8)
      .look(F.FIREBALL, R.WHITE, M.STREAK, 0.05)
      .fade(0.1, 0.4);
    s.push = 0.3;
    s.delay = (i / m) * dur;
    ctx.glow.emit(s);
  }
  // hot core along the jet
  const b = ctx.beams;
  for (let layer = 0; layer < 2; layer++) {
    const s = b.begin();
    s.from(ax, ay, az).to(bx, by, bz);
    s.life = dur + 0.1;
    s.mode = BM.TRACER;
    s.style = BS.GLOW;
    s.extra = 1.4;
    if (layer === 0) s.width(0.04, 0.025).color(2.2, 1.2, 0.4, 0.6);
    else s.width(0.2, 0.14).color(0.8, 0.3, 0.08, 0.45);
    b.emit(s);
  }
  // nozzle glow
  const g = ctx.glow.begin();
  g.at(ax, ay, az).motion(dur).size(0.22, 0.3).spin(rnd() * TAU, 6).color(5, 3, 1.1, 1).look(F.FLARE, R.WHITE).fade(0, 0.7);
  g.push = 0.3;
  ctx.glow.emit(g);
  // smoke and embers where it lands
  smoke(ctx, bx, by + 0.1, bz, 3, T + 0.1, { size0: 0.2, size1: 0.75, life: 1.8, rise: 0.6, alpha: 0.45, ramp: R.SMOKE_FIRE, spreadR: 0.15, stagger: 0.4 });
  embers(ctx, bx, by + 0.05, bz, 6, 0.2, T, 0.5, 1.0);
  ctx.lights.flash(ctx.now, bx, by + 0.6, bz, 0xff8030, 6, 4, dur + 0.25, 0.05, 0.1);
}
