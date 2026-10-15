/**
 * Scripted CPU-driven flights owned by the effects system (no sim entity behind them):
 *   GPS satellite launch — a rocket lifts off from the Allied tech centre on a pillar of smoke,
 *   pitches over slightly and climbs out of view.
 * Updated from Effects.update(); allocation-free per frame (objects are created at launch only).
 */
import type { FxContext } from './context';
import { count } from './context';
import { F, R } from './textures';
import { M } from './particles';
import { BS, BM } from './beams';
import { BK } from './bodies';
import { rnd, range, spread } from './rand';
import { flash, smokeFrame, sparks, lightFlash, groundGlow } from './blocks';

const TAU = Math.PI * 2;
const DURATION = 7;

class RocketLaunch {
  t = 0;
  alive = true;
  private body: number;
  private s0: number;
  private s1: number;
  private s2: number;
  private lx: number;
  private ly: number;
  private lz: number;
  private lt = 0;
  private lu = 0;
  private pdx = 0;
  private pdy = 0;
  private pdz = 0;
  private puffAcc = 0;

  constructor(private ctx: FxContext, private x0: number, private y0: number, private z0: number) {
    this.body = ctx.bodies.alloc(BK.ROCKET);
    this.s0 = ctx.sprites.alloc();
    this.s1 = ctx.sprites.alloc();
    this.s2 = ctx.sprites.alloc();
    this.lx = x0;
    this.ly = y0 + 0.2;
    this.lz = z0;
    this.lt = ctx.now;
    this.ignition();
  }

  private ignition(): void {
    const ctx = this.ctx;
    const { x0: x, y0: y, z0: z } = this;
    flash(ctx, x, y + 0.2, z, 2.2, 3, 0, 0.3, 1, 0.85, 0.6);
    lightFlash(ctx, x, y + 1.2, z, 0xffc070, 8, 7, 2.6, 0);
    sparks(ctx, x, y + 0.1, z, 20, 3.5, 0, { up: 0.1, life: 0.9 });
    groundGlow(ctx, x, y, z, 3, 0, 2.2, 2.4, 1.2, 0.4, 0.6);
    // exhaust billowing out sideways from the pad over the first two seconds
    const n = count(ctx, 46, 14);
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU;
      const sp = range(0.8, 2.4);
      const p = ctx.main.begin();
      p.at(x + Math.cos(a) * 0.15, y + 0.1, z + Math.sin(a) * 0.15)
        .vel(Math.cos(a) * sp, range(0.05, 0.4), Math.sin(a) * sp)
        .motion(range(3.5, 5.5), 0.06, 0.9)
        .size(range(0.25, 0.4), range(1.1, 1.7), 1.6)
        .spin(rnd() * TAU, spread(0.4))
        .color(1, 1, 1, 0.75)
        .look(smokeFrame(), i % 3 === 0 ? R.SMOKE_FIRE : R.STEAM, M.LIT)
        .fade(0.04, 0.5);
      p.wind = 0.5;
      p.delay = (i / n) * 1.8;
      ctx.main.emit(p);
    }
    ctx.cue('launch', x, y, z, 0);
  }

  private px = 0;
  private py = 0;
  private pz = 0;

  /** Height and sideways drift along the ascent (written to px/py/pz). */
  private pos(t: number): void {
    const lift = Math.max(0, t - 0.5);
    const turn = Math.max(0, t - 2);
    this.px = this.x0 + 0.05 * turn * turn * turn;
    this.py = this.y0 + 0.25 + 0.45 * lift * lift + 0.38 * lift * lift * lift;
    this.pz = this.z0 - 0.02 * turn * turn * turn;
  }

  update(dt: number): void {
    const ctx = this.ctx;
    this.t += dt;
    const t = this.t;
    if (t >= DURATION) {
      this.release();
      return;
    }
    this.pos(t + 0.05);
    const x2 = this.px;
    const y2 = this.py;
    const z2 = this.pz;
    this.pos(t);
    const x = this.px;
    const y = this.py;
    const z = this.pz;
    let dx = x2 - x;
    let dy = y2 - y;
    let dz = z2 - z;
    const l = Math.hypot(dx, dy, dz);
    if (l < 1e-5) {
      dx = 0;
      dy = 1;
      dz = 0;
    } else {
      dx /= l;
      dy /= l;
      dz /= l;
    }
    ctx.bodies.set(BK.ROCKET, this.body, x, y, z, dx, dy, dz, 0, 1.6);
    const fl = 0.85 + 0.3 * rnd();
    const thrust = Math.min(1, t / 0.4);
    const back = 0.62;
    const L = 0.35 * fl * thrust;
    ctx.sprites.set(this.s0, x - dx * (back + L), y - dy * (back + L), z - dz * (back + L), -dx * L, -dy * L, -dz * L, 0.2, F.FLAME, 0, 0, 8, 4.4, 1.6, thrust);
    ctx.sprites.set(this.s1, x - dx * back, y - dy * back, z - dz * back, 0, 0, 0, 0.9 * fl * thrust, F.FLARE, 0, t * 5, 3.2, 2.0, 0.8, 1);
    ctx.sprites.set(this.s2, x - dx * back, y - dy * back, z - dz * back, 0, 0, 0, 2.2 * thrust, F.GLOW, 0, 0, 1.2, 0.6, 0.2, 0.5);
    // exhaust plume ribbon + puffs by distance
    const ex = x - dx * back;
    const ey = y - dy * back;
    const ez = z - dz * back;
    const sx = ex - this.lx;
    const sy = ey - this.ly;
    const sz = ez - this.lz;
    const dist = Math.sqrt(sx * sx + sy * sy + sz * sz);
    if (thrust > 0.5 && dist >= 0.3) {
      const b = ctx.beams.begin();
      b.from(this.lx, this.ly, this.lz).to(ex, ey, ez);
      b.tA = this.lt - ctx.now;
      b.tB = 0;
      b.life = 8;
      b.mode = BM.RIBBON;
      b.w0 = 0.16;
      b.w1 = 1.3;
      b.rise = 0;
      b.wind = 0.12;
      b.color(1, 1, 1, 0.8);
      b.ramp = R.CONTRAIL;
      b.occ = 1;
      b.style = BS.SMOKE;
      b.uA = this.lu;
      b.uB = this.lu + dist;
      b.px = this.pdx;
      b.py = this.pdy;
      b.pz = this.pdz;
      ctx.beams.emit(b);
      this.puffAcc += dist;
      while (this.puffAcc > 0.6 && y < this.y0 + 12) {
        this.puffAcc -= 0.6;
        const p = ctx.main.begin();
        p.at(ex + spread(0.1), ey, ez + spread(0.1))
          .vel(spread(0.2), range(-0.2, 0.1), spread(0.2))
          .motion(range(4, 6), 0.03, 0.4)
          .size(0.3, range(1.2, 1.8), 1.5)
          .spin(rnd() * TAU, spread(0.3))
          .color(1, 1, 1, 0.55)
          .look(smokeFrame(), R.STEAM, M.LIT)
          .fade(0.06, 0.5);
        p.wind = 0.7;
        ctx.main.emit(p);
      }
      this.pdx = sx;
      this.pdy = sy;
      this.pdz = sz;
      this.lx = ex;
      this.ly = ey;
      this.lz = ez;
      this.lt = ctx.now;
      this.lu += dist;
    }
  }

  release(): void {
    if (!this.alive) return;
    this.alive = false;
    const ctx = this.ctx;
    ctx.bodies.release(BK.ROCKET, this.body);
    ctx.sprites.release(this.s0);
    ctx.sprites.release(this.s1);
    ctx.sprites.release(this.s2);
  }
}

export class Flights {
  private list: RocketLaunch[] = [];

  gpsLaunch(ctx: FxContext, x: number, y: number, z: number): void {
    this.list.push(new RocketLaunch(ctx, x, y, z));
  }

  update(dt: number): void {
    const l = this.list;
    for (let i = l.length - 1; i >= 0; i--) {
      const f = l[i];
      f.update(dt);
      if (!f.alive) {
        l[i] = l[l.length - 1];
        l.pop();
      }
    }
  }

  dispose(): void {
    for (const f of this.list) f.release();
    this.list.length = 0;
  }
}
