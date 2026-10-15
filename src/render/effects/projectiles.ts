/**
 * In-flight projectile visuals. The engine drives position every frame via handle.update(pos, dir)
 * and calls end() on impact. Bodies are dynamic sprites; trails are ribbon segments and particles
 * emitted by travelled distance (frame-rate independent) which keep fading after end().
 */
import type * as THREE from 'three';
import type { ProjectileKind } from '../../data/rules';
import type { ProjectileHandle } from './types';
import type { FxContext } from './context';
import { F, R } from './textures';
import { M } from './particles';
import { BM, BS } from './beams';
import { rnd, range, spread } from './rand';
import { smokeFrame } from './blocks';
import { BombVisual, DepthChargeVisual, TorpedoVisual } from './specialproj';

const TAU = Math.PI * 2;

interface TrailCfg {
  spacing: number;
  life: number;
  w0: number;
  w1: number;
  r: number; g: number; b: number; a: number;
  ramp: number;
  occ: number;
  style: number;
  rise: number;
  wind: number;
}

interface KindCfg {
  trail?: TrailCfg;
  /** Hot glow core ribbon right behind the projectile. */
  core?: TrailCfg;
  /** Distance between smoke puffs (0 = none). */
  puffEvery: number;
  puffSize0: number;
  puffSize1: number;
  puffLife: number;
  puffAlpha: number;
  puffRamp: number;
  sprites: number;
}

const NOOP: ProjectileHandle = { update() {}, end() {} };

const CFG: Partial<Record<ProjectileKind, KindCfg>> = {
  cannon: {
    core: { spacing: 0.07, life: 0.22, w0: 0.055, w1: 0.012, r: 2.6, g: 1.35, b: 0.5, a: 0.85, ramp: R.WHITE, occ: 0, style: BS.GLOW, rise: 0, wind: 0 },
    puffEvery: 0, puffSize0: 0, puffSize1: 0, puffLife: 0, puffAlpha: 0, puffRamp: 0,
    sprites: 2,
  },
  ballistic: {
    trail: { spacing: 0.12, life: 1.2, w0: 0.035, w1: 0.2, r: 1, g: 1, b: 1, a: 0.38, ramp: R.SMOKE, occ: 1, style: BS.SMOKE, rise: 0.1, wind: 0.4 },
    core: { spacing: 0.12, life: 0.12, w0: 0.04, w1: 0.01, r: 2.2, g: 1.1, b: 0.4, a: 0.7, ramp: R.WHITE, occ: 0, style: BS.GLOW, rise: 0, wind: 0 },
    puffEvery: 0, puffSize0: 0, puffSize1: 0, puffLife: 0, puffAlpha: 0, puffRamp: 0,
    sprites: 2,
  },
  lobbed: {
    trail: { spacing: 0.1, life: 0.45, w0: 0.02, w1: 0.07, r: 1, g: 1, b: 1, a: 0.25, ramp: R.SMOKE, occ: 1, style: BS.SMOKE, rise: 0.05, wind: 0.3 },
    puffEvery: 0, puffSize0: 0, puffSize1: 0, puffLife: 0, puffAlpha: 0, puffRamp: 0,
    sprites: 2,
  },
  missile: {
    trail: { spacing: 0.09, life: 1.8, w0: 0.05, w1: 0.38, r: 1, g: 1, b: 1, a: 0.62, ramp: R.TRAIL, occ: 1, style: BS.SMOKE, rise: 0.14, wind: 0.5 },
    core: { spacing: 0.09, life: 0.11, w0: 0.07, w1: 0.02, r: 4.5, g: 2.2, b: 0.7, a: 0.9, ramp: R.WHITE, occ: 0, style: BS.GLOW, rise: 0, wind: 0 },
    puffEvery: 0.3, puffSize0: 0.08, puffSize1: 0.5, puffLife: 1.6, puffAlpha: 0.22, puffRamp: R.SMOKE,
    sprites: 3,
  },
  scud: {
    trail: { spacing: 0.13, life: 3.6, w0: 0.14, w1: 0.9, r: 1, g: 1, b: 1, a: 0.72, ramp: R.TRAIL, occ: 1, style: BS.SMOKE, rise: 0.12, wind: 0.45 },
    core: { spacing: 0.13, life: 0.22, w0: 0.22, w1: 0.05, r: 5, g: 2.5, b: 0.8, a: 0.9, ramp: R.WHITE, occ: 0, style: BS.GLOW, rise: 0, wind: 0 },
    puffEvery: 0.22, puffSize0: 0.2, puffSize1: 1.05, puffLife: 3.0, puffAlpha: 0.5, puffRamp: R.SMOKE,
    sprites: 3,
  },
  fireball: {
    puffEvery: 0, puffSize0: 0, puffSize1: 0, puffLife: 0, puffAlpha: 0, puffRamp: 0,
    sprites: 3,
  },
};

class ProjectileVisual implements ProjectileHandle {
  private alive = true;
  private started = false;
  private lx = 0; private ly = 0; private lz = 0;
  private lt = 0;
  private lu = 0;
  private pdx = 0; private pdy = 0; private pdz = 0;
  private puffAcc = 0;
  private emberAcc = 0;
  private x = 0; private y = 0; private z = 0;
  private s0 = -1; private s1 = -1; private s2 = -1;
  private seed = rnd() * 100;

  constructor(private ctx: FxContext, private kind: ProjectileKind, private cfg: KindCfg, private k = 1) {
    const sp = ctx.sprites;
    this.s0 = sp.alloc();
    if (cfg.sprites > 1) this.s1 = sp.alloc();
    if (cfg.sprites > 2) this.s2 = sp.alloc();
  }

  update(pos: THREE.Vector3, dir: THREE.Vector3): void {
    if (!this.alive) return;
    const ctx = this.ctx;
    const x = pos.x, y = pos.y, z = pos.z;
    if (!this.started) {
      this.started = true;
      this.lx = x; this.ly = y; this.lz = z;
      this.lt = ctx.now;
    }
    this.x = x; this.y = y; this.z = z;
    this.updateSprites(x, y, z, dir.x, dir.y, dir.z);
    // trail by distance
    const dx = x - this.lx, dy = y - this.ly, dz = z - this.lz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const cfg = this.cfg;
    const spacing = cfg.trail?.spacing ?? cfg.core?.spacing ?? 0;
    if (spacing > 0 && dist >= spacing) this.emitSegment(x, y, z, dist);
    if (this.kind === 'fireball') this.fireballTrail(x, y, z, dir);
    if (spacing === 0) {
      this.lx = x; this.ly = y; this.lz = z;
    }
  }

  private emitSegment(x: number, y: number, z: number, dist: number): void {
    const ctx = this.ctx;
    const cfg = this.cfg;
    const tA = this.lt - ctx.now;
    if (cfg.trail) this.ribbon(cfg.trail, x, y, z, dist, tA);
    if (cfg.core) this.ribbon(cfg.core, x, y, z, dist, tA);
    // smoke puffs along the segment for volume
    if (cfg.puffEvery > 0) {
      this.puffAcc += dist;
      while (this.puffAcc >= cfg.puffEvery) {
        this.puffAcc -= cfg.puffEvery * range(0.6, 1.4);
        const f = rnd();
        const p = ctx.main.begin();
        p.at(this.lx + (x - this.lx) * f, this.ly + (y - this.ly) * f, this.lz + (z - this.lz) * f)
          .vel(spread(0.08), range(0.05, 0.2), spread(0.08))
          .motion(cfg.puffLife * range(0.7, 1.2), 0.05, 0.6)
          .size(cfg.puffSize0 * this.k, cfg.puffSize1 * this.k * range(0.8, 1.2), 1.6)
          .spin(rnd() * TAU, spread(0.4))
          .color(1, 1, 1, cfg.puffAlpha)
          .look(smokeFrame(), cfg.puffRamp, M.LIT)
          .fade(0.1, 0.4);
        p.wind = 0.5;
        p.push = 0.3;
        ctx.main.emit(p);
      }
    }
    this.pdx = x - this.lx; this.pdy = y - this.ly; this.pdz = z - this.lz;
    this.lx = x; this.ly = y; this.lz = z;
    this.lt = ctx.now;
    this.lu += dist;
  }

  private ribbon(c: TrailCfg, x: number, y: number, z: number, dist: number, tA: number): void {
    const b = this.ctx.beams.begin();
    b.from(this.lx, this.ly, this.lz).to(x, y, z);
    b.tA = tA;
    b.tB = 0;
    b.life = c.life;
    b.mode = BM.RIBBON;
    b.w0 = c.w0 * this.k;
    b.w1 = c.w1 * this.k;
    b.rise = c.rise;
    b.wind = c.wind;
    b.color(c.r, c.g, c.b, c.a);
    b.ramp = c.ramp;
    b.occ = c.occ;
    b.style = c.style;
    b.uA = this.lu + this.seed;
    b.uB = this.lu + dist + this.seed;
    b.px = this.pdx; b.py = this.pdy; b.pz = this.pdz;
    this.ctx.beams.emit(b);
  }

  private fireballTrail(x: number, y: number, z: number, dir: THREE.Vector3): void {
    const ctx = this.ctx;
    const dx = x - this.lx, dy = y - this.ly, dz = z - this.lz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    this.emberAcc += dist;
    let guard = 0;
    while (this.emberAcc >= 0.05 && guard++ < 12) {
      this.emberAcc -= 0.05;
      const f = rnd();
      const px = this.lx + dx * f, py = this.ly + dy * f, pz = this.lz + dz * f;
      const g = ctx.glow.begin();
      g.at(px + spread(0.04), py + spread(0.04), pz + spread(0.04))
        .vel(spread(0.3) - dir.x * 0.3, spread(0.3) + 0.2, spread(0.3) - dir.z * 0.3)
        .motion(range(0.22, 0.36), 0.5, 2)
        .size(range(0.22, 0.3), 0.06, 1)
        .spin(rnd() * TAU, spread(3))
        .color(1, 1, 1, 0.85)
        .look(F.FIREBALL, R.FIRE)
        .fade(0, 0.3);
      g.push = 0.2;
      ctx.glow.emit(g);
      if (rnd() < 0.5) {
        const e = ctx.glow.begin();
        e.at(px, py, pz).vel(spread(0.8), range(0.0, 0.8), spread(0.8)).motion(range(0.4, 0.8), -1.5, 1)
          .size(range(0.03, 0.05), 0.01).color(1, 1, 1, 1).look(F.GLOW, R.EMBER).fade(0, 0.5);
        e.push = 0.1;
        ctx.glow.emit(e);
      }
      if (rnd() < 0.18) {
        const m = ctx.main.begin();
        m.at(px, py + 0.05, pz).vel(spread(0.1), 0.35, spread(0.1)).motion(range(0.8, 1.2), 0.1, 0.5)
          .size(0.1, 0.42, 1.5).spin(rnd() * TAU, spread(0.5)).color(1, 1, 1, 0.4)
          .look(smokeFrame(), R.SMOKE_FIRE, M.LIT).fade(0.15, 0.4);
        m.wind = 0.6;
        ctx.main.emit(m);
      }
    }
    this.lx = x; this.ly = y; this.lz = z;
  }

  private updateSprites(x: number, y: number, z: number, dx: number, dy: number, dz: number): void {
    const sp = this.ctx.sprites;
    // scaled shells (heavy naval guns) also stretch their streak along the travel direction
    const k = this.k;
    const t = this.ctx.now;
    const fl = 0.8 + 0.4 * rnd();
    switch (this.kind) {
      case 'cannon':
        sp.set(this.s0, x, y, z, dx * 0.1 * k, dy * 0.1 * k, dz * 0.1 * k, 0.075 * k, F.GLOW, 0, 0, 7, 3.6, 1.3, 1);
        sp.set(this.s1, x, y, z, 0, 0, 0, 0.32 * k, F.GLOW, 0, 0, 1.6, 0.75, 0.25, 0.55);
        break;
      case 'ballistic':
        sp.set(this.s0, x, y, z, dx * 0.04 * k, dy * 0.04 * k, dz * 0.04 * k, 0.1 * k, F.GLOW, 1, 0, 0.05, 0.05, 0.045, 1);
        sp.set(this.s1, x, y, z, 0, 0, 0, 0.17 * k, F.GLOW, 0, 0, 2.6, 1.3, 0.45, 0.8);
        break;
      case 'lobbed':
        sp.set(this.s0, x, y, z, 0, 0, 0, 0.085, F.GLOW, 1, 0, 0.05, 0.06, 0.04, 1);
        sp.set(this.s1, x, y + 0.01, z, 0, 0, 0, 0.07, F.FLARE, 0, t * 9, 1.4, 1.2, 0.9, 0.6);
        break;
      case 'missile': {
        sp.set(this.s0, x, y, z, dx * 0.07, dy * 0.07, dz * 0.07, 0.045, F.GLOW, 1, 0, 0.42, 0.42, 0.4, 1);
        const L = 0.07 * fl;
        const bx = x - dx * (0.08 + L + 0.04), by = y - dy * (0.08 + L + 0.04), bz = z - dz * (0.08 + L + 0.04);
        sp.set(this.s1, bx, by, bz, -dx * L, -dy * L, -dz * L, 0.085, F.FLAME, 0, 0, 7, 3.4, 1.1, 1);
        sp.set(this.s2, x - dx * 0.09, y - dy * 0.09, z - dz * 0.09, 0, 0, 0, 0.24 * fl, F.FLARE, 0, t * 7, 3.0, 1.7, 0.6, 1);
        break;
      }
      case 'scud': {
        sp.set(this.s0, x, y, z, dx * 0.22, dy * 0.22, dz * 0.22, 0.12, F.GLOW, 1, 0, 0.2, 0.22, 0.17, 1);
        const L = 0.2 * fl;
        const back = 0.24 + L + 0.11;
        sp.set(this.s1, x - dx * back, y - dy * back, z - dz * back, -dx * L, -dy * L, -dz * L, 0.24, F.FLAME, 0, 0, 8, 4.4, 1.5, 1);
        sp.set(this.s2, x - dx * 0.26, y - dy * 0.26, z - dz * 0.26, 0, 0, 0, 0.55 * fl, F.FLARE, 0, t * 5, 3.0, 1.8, 0.7, 1);
        break;
      }
      case 'fireball':
        sp.set(this.s0, x, y, z, 0, 0, 0, 0.3 * fl, F.FLARE, 0, t * 6, 9, 5.5, 2.2, 1);
        sp.set(this.s1, x, y, z, 0, 0, 0, 0.8, F.GLOW, 0, 0, 3.2, 1.3, 0.35, 0.75);
        sp.set(this.s2, x, y, z, 0, 0, 0, 0.42, F.FIREBALL, 0, t * 9, 4.5, 2.1, 0.6, 0.95);
        break;
    }
  }

  end(): void {
    if (!this.alive) return;
    this.alive = false;
    if (this.started && (this.cfg.trail || this.cfg.core)) {
      const dx = this.x - this.lx, dy = this.y - this.ly, dz = this.z - this.lz;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > 0.01) this.emitSegment(this.x, this.y, this.z, dist);
    }
    const sp = this.ctx.sprites;
    sp.release(this.s0);
    sp.release(this.s1);
    sp.release(this.s2);
    this.s0 = this.s1 = this.s2 = -1;
  }
}

export function spawnProjectile(ctx: FxContext, kind: ProjectileKind, size = 1): ProjectileHandle {
  switch (kind) {
    case 'torpedo':
      return new TorpedoVisual(ctx);
    case 'depthcharge':
      return new DepthChargeVisual(ctx);
    case 'bomb':
      return new BombVisual(ctx, size);
  }
  const cfg = CFG[kind];
  if (!cfg) return NOOP;
  return new ProjectileVisual(ctx, kind, cfg, size > 0 ? size : 1);
}
