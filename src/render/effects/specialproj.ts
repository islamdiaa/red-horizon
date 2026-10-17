/**
 * Projectile visuals that need more than a sprite + ribbon:
 *   torpedo     – dark shape gliding just under the surface, foam wake line and bubbles
 *   depthcharge – tumbling barrel (3D body) that splashes into the water
 *   bomb        – falling bomb (3D body) with a faint air streak; raises the 'bomb' cue (whistle)
 * plus free-standing trails (contrails / smoke) driven like a projectile handle.
 */
import * as THREE from 'three';
import type { ProjectileHandle } from './types';
import type { FxContext } from './context';
import { F, R } from './textures';
import { BM, BS } from './beams';
import { BK } from './bodies';
import { rnd, range } from './rand';
import { bubbles, waterSplash } from './water';

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _ax = new THREE.Vector3();
const _dir = new THREE.Vector3();
const X = new THREE.Vector3(1, 0, 0);

/** Shared ribbon emitter state (continuous trail by distance). */
class Ribbon {
  lx = 0;
  ly = 0;
  lz = 0;
  lt = 0;
  lu = 0;
  pdx = 0;
  pdy = 0;
  pdz = 0;
  started = false;
  seed = rnd() * 100;

  reset(ctx: FxContext, x: number, y: number, z: number): void {
    this.lx = x;
    this.ly = y;
    this.lz = z;
    this.lt = ctx.now;
    this.started = true;
  }

  /** Emit one segment from the last point to (x,y,z); returns its length. */
  emit(ctx: FxContext, x: number, y: number, z: number, life: number, w0: number, w1: number, r: number, g: number, b: number, a: number, ramp: number, style: number, occ: number, rise: number, wind: number): number {
    const dx = x - this.lx;
    const dy = y - this.ly;
    const dz = z - this.lz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const s = ctx.beams.begin();
    s.from(this.lx, this.ly, this.lz).to(x, y, z);
    s.tA = this.lt - ctx.now;
    s.tB = 0;
    s.life = life;
    s.mode = BM.RIBBON;
    s.w0 = w0;
    s.w1 = w1;
    s.rise = rise;
    s.wind = wind;
    s.color(r, g, b, a);
    s.ramp = ramp;
    s.occ = occ;
    s.style = style;
    s.uA = this.lu + this.seed;
    s.uB = this.lu + dist + this.seed;
    s.px = this.pdx;
    s.py = this.pdy;
    s.pz = this.pdz;
    ctx.beams.emit(s);
    this.pdx = dx;
    this.pdy = dy;
    this.pdz = dz;
    this.lx = x;
    this.ly = y;
    this.lz = z;
    this.lt = ctx.now;
    this.lu += dist;
    return dist;
  }

  dist(x: number, y: number, z: number): number {
    const dx = x - this.lx;
    const dy = y - this.ly;
    const dz = z - this.lz;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
}

// ---------------------------------------------------------------------------------------------

export class TorpedoVisual implements ProjectileHandle {
  private alive = true;
  private s0: number;
  private s1: number;
  private rib = new Ribbon();
  private bubAcc = 0;
  private x = 0;
  private z = 0;

  constructor(private ctx: FxContext) {
    this.s0 = ctx.sprites.alloc();
    this.s1 = ctx.sprites.alloc();
  }

  update(pos: THREE.Vector3, dir: THREE.Vector3): void {
    if (!this.alive) return;
    const ctx = this.ctx;
    const wl = ctx.waterLevel;
    const x = pos.x;
    const z = pos.z;
    const ys = wl + 0.012;
    if (!this.rib.started) {
      this.rib.reset(ctx, x, ys, z);
      ctx.cue('torpedo', x, wl, z, 0);
    }
    this.x = x;
    this.z = z;
    let hx = dir.x;
    let hz = dir.z;
    const hl = Math.hypot(hx, hz) || 1;
    hx /= hl;
    hz /= hl;
    // dark body just under the surface + a little foam at the nose
    ctx.sprites.set(this.s0, x - hx * 0.05, wl + 0.004, z - hz * 0.05, hx * 0.09, 0, hz * 0.09, 0.05, F.GLOW, 1, 0, 0.01, 0.03, 0.04, 0.7);
    ctx.sprites.set(this.s1, x + hx * 0.06, wl + 0.01, z + hz * 0.06, 0, 0, 0, 0.09, F.GLOW, 1, 0, 0.85, 0.9, 0.92, 0.55);
    const d = this.rib.dist(x, ys, z);
    if (d >= 0.09) {
      this.rib.emit(ctx, x, ys, z, 2.2, 0.035, 0.16, 1, 1, 1, 0.6, R.FOAM, BS.SMOKE, 1, 0, 0);
      this.bubAcc += d;
      if (this.bubAcc > 0.12) {
        this.bubAcc = 0;
        bubbles(ctx, x - hx * 0.08, wl, z - hz * 0.08, 2, 0.03);
      }
    }
  }

  end(): void {
    if (!this.alive) return;
    this.alive = false;
    const ctx = this.ctx;
    if (this.rib.started) bubbles(ctx, this.x, ctx.waterLevel, this.z, 6, 0.08);
    ctx.sprites.release(this.s0);
    ctx.sprites.release(this.s1);
    this.s0 = this.s1 = -1;
  }
}

// ---------------------------------------------------------------------------------------------

export class DepthChargeVisual implements ProjectileHandle {
  private alive = true;
  private body: number;
  private t = 0;
  private lastNow = -1;
  private wet = false;
  private spin = range(7, 11) * (rnd() < 0.5 ? -1 : 1);

  constructor(private ctx: FxContext) {
    this.body = ctx.bodies.alloc(BK.BARREL);
  }

  update(pos: THREE.Vector3, dir: THREE.Vector3): void {
    if (!this.alive) return;
    const ctx = this.ctx;
    if (this.lastNow >= 0) this.t += Math.max(0, ctx.now - this.lastNow);
    this.lastNow = ctx.now;
    const wl = ctx.waterLevel;
    if (pos.y > wl) {
      // tumble end over end about the horizontal axis perpendicular to travel
      _ax.set(-dir.z, 0, dir.x);
      if (_ax.lengthSq() < 1e-6) _ax.set(0, 0, 1);
      _ax.normalize();
      _dir.set(dir.x, 0, dir.z);
      if (_dir.lengthSq() < 1e-6) _dir.set(1, 0, 0);
      _q.setFromUnitVectors(X, _dir.normalize());
      _q2.setFromAxisAngle(_ax, this.t * this.spin);
      _q.premultiply(_q2);
      ctx.bodies.setQuat(BK.BARREL, this.body, pos.x, pos.y, pos.z, _q, 1.2);
    } else if (!this.wet) {
      this.wet = true;
      ctx.bodies.hide(BK.BARREL, this.body);
      waterSplash(ctx, pos.x, wl, pos.z, 0.45);
    }
  }

  end(): void {
    if (!this.alive) return;
    this.alive = false;
    this.ctx.bodies.release(BK.BARREL, this.body);
    this.body = -1;
  }
}

// ---------------------------------------------------------------------------------------------

export class BombVisual implements ProjectileHandle {
  private alive = true;
  private body: number;
  private rib = new Ribbon();
  private wob = rnd() * 6;

  constructor(private ctx: FxContext, private size = 1) {
    this.body = ctx.bodies.alloc(BK.BOMB);
  }

  update(pos: THREE.Vector3, dir: THREE.Vector3): void {
    if (!this.alive) return;
    const ctx = this.ctx;
    if (!this.rib.started) {
      this.rib.reset(ctx, pos.x, pos.y, pos.z);
      ctx.cue('bomb', pos.x, pos.y, pos.z, 0);
    }
    const w = Math.sin(ctx.now * 9 + this.wob) * 0.05;
    ctx.bodies.set(BK.BOMB, this.body, pos.x, pos.y, pos.z, dir.x + w, dir.y, dir.z - w, ctx.now * 2 + this.wob, this.size);
    if (this.rib.dist(pos.x, pos.y, pos.z) >= 0.25) {
      this.rib.emit(ctx, pos.x, pos.y, pos.z, 0.35, 0.02 * this.size, 0.05 * this.size, 1, 1, 1, 0.22, R.CONTRAIL, BS.SMOKE, 1, 0, 0.2);
    }
  }

  end(): void {
    if (!this.alive) return;
    this.alive = false;
    this.ctx.bodies.release(BK.BOMB, this.body);
    this.body = -1;
  }
}

// ---------------------------------------------------------------------------------------------

export type TrailKind = 'contrail' | 'smoke';

/** Free-standing trail (aircraft contrails, burning-aircraft smoke). Same handle protocol as projectiles. */
export class TrailVisual implements ProjectileHandle {
  private alive = true;
  private rib = new Ribbon();

  constructor(private ctx: FxContext, private kind: TrailKind, private width = 1) {}

  update(pos: THREE.Vector3, _dir: THREE.Vector3): void {
    if (!this.alive) return;
    const ctx = this.ctx;
    if (!this.rib.started) {
      this.rib.reset(ctx, pos.x, pos.y, pos.z);
      return;
    }
    const k = this.width;
    if (this.kind === 'contrail') {
      if (this.rib.dist(pos.x, pos.y, pos.z) >= 0.16) {
        this.rib.emit(ctx, pos.x, pos.y, pos.z, 3.6, 0.025 * k, 0.32 * k, 1, 1, 1, 0.42, R.CONTRAIL, BS.SMOKE, 1, 0.02, 0.6);
      }
    } else if (this.rib.dist(pos.x, pos.y, pos.z) >= 0.12) {
      this.rib.emit(ctx, pos.x, pos.y, pos.z, 2.6, 0.06 * k, 0.55 * k, 1, 1, 1, 0.65, R.SMOKE_DARK, BS.SMOKE, 1, 0.15, 0.8);
    }
  }

  end(): void {
    this.alive = false;
  }
}
