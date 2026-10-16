/**
 * Continuous emitters (burning buildings, chimneys, sparks, steam, exhaust). Spawning is
 * rate-based with fractional accumulators so it is frame-rate independent.
 */
import type * as THREE from 'three';
import type { EmitterHandle, EmitterKind } from './types';
import type { FxContext } from './context';
import { F, R } from './textures';
import { M } from './particles';
import { rnd, range, spread } from './rand';
import { smokeFrame, sparks, flash } from './blocks';
import { gpuFire, gpuSmoke } from './gpufx';

const TAU = Math.PI * 2;

export class Emitter implements EmitterHandle {
  x = 0;
  y = 0;
  z = 0;
  intensity = 1;
  alive = true;
  private a0 = rnd();
  private a1 = rnd();
  private a2 = rnd();
  private a3 = rnd();
  private next = range(0.1, 0.6);
  /** GPU particle rate accumulators. */
  private gacc = new Float32Array(2);

  constructor(readonly kind: EmitterKind, pos: THREE.Vector3) {
    this.x = pos.x;
    this.y = pos.y;
    this.z = pos.z;
  }

  setPosition(pos: THREE.Vector3): void {
    this.x = pos.x;
    this.y = pos.y;
    this.z = pos.z;
  }

  setIntensity(v: number): void {
    this.intensity = Math.max(0, v);
  }

  dispose(): void {
    this.alive = false;
  }

  update(ctx: FxContext, dt: number): void {
    const I = this.intensity;
    if (I <= 0) return;
    const k = ctx.density;
    const sz = 0.7 + 0.3 * Math.min(I, 2.5);
    switch (this.kind) {
      case 'smoke': {
        this.a0 += dt * 5 * I * k;
        while (this.a0 >= 1) {
          this.a0 -= 1;
          this.smokePuff(ctx, R.SMOKE_DARK, 0.3 * sz, 1.6 * sz, range(3.4, 4.6), 0.7, 0.6, 0.12);
        }
        if (ctx.gpu) gpuSmoke(ctx.gpu, this.x, this.y, this.z, I, sz, this.gacc, dt);
        break;
      }
      case 'fire': {
        this.a0 += dt * 20 * I * k;
        while (this.a0 >= 1) {
          this.a0 -= 1;
          const s = ctx.glow.begin();
          const fs = 0.5 * sz;
          s.at(this.x + spread(0.3 * sz), this.y + fs * 0.25, this.z + spread(0.3 * sz))
            .vel(spread(0.08), range(0.5, 0.9) * sz, spread(0.08))
            .motion(range(0.45, 0.75), 0.8, 1.6)
            .size(fs * range(0.8, 1.2), fs * 0.35)
            .spin(spread(0.25), spread(0.5))
            .color(0.5, 0.48, 0.45, 0.9)
            .look(F.FLAME, R.FIRE)
            .fade(0.15, 0.45);
          s.wind = 0.35;
          s.push = 0.45;
          ctx.glow.emit(s);
        }
        this.a1 += dt * 3.5 * I * k;
        while (this.a1 >= 1) {
          this.a1 -= 1;
          const e = ctx.glow.begin();
          e.at(this.x + spread(0.15), this.y + 0.2, this.z + spread(0.15))
            .vel(spread(0.3), range(0.6, 1.3), spread(0.3))
            .motion(range(1.0, 1.8), 0.3, 1.0)
            .size(range(0.025, 0.045), 0.01)
            .color(1, 1, 1, 1)
            .look(F.GLOW, R.EMBER)
            .fade(0.05, 0.5);
          e.wind = 1.0;
          e.push = 0.1;
          ctx.glow.emit(e);
        }
        this.a2 += dt * 4 * I * k;
        while (this.a2 >= 1) {
          this.a2 -= 1;
          this.smokePuff(ctx, R.SMOKE_FIRE, 0.35 * sz, 1.6 * sz, range(3.2, 4.2), 0.75, 0.65, 0.4);
        }
        this.a3 += dt * 5 * k;
        while (this.a3 >= 1) {
          this.a3 -= 1;
          const g = ctx.glow.begin();
          g.at(this.x + spread(0.05), this.y + 0.15, this.z + spread(0.05)).motion(range(0.25, 0.4)).size(1.0 * sz, 1.2 * sz)
            .spin(rnd() * TAU).color(1.6, 0.6, 0.15, 0.3 * Math.min(1.5, I)).look(F.GLOW, R.WHITE).fade(0.3, 0.5);
          g.push = 0.6;
          ctx.glow.emit(g);
        }
        // [FX] GPU embers and a turbulent smoke column; the fire lights its surroundings
        if (ctx.gpu) gpuFire(ctx.gpu, this.x, this.y, this.z, I, sz, this.gacc, dt);
        if (ctx.dyn) {
          const k = Math.min(I, 2);
          ctx.dyn.add(this.x, this.y + 0.45 * sz, this.z, 0xff7a2e, 2.4 * k, 3.4 + 1.3 * k, 0, { flicker: 0.4, priority: 0.8 });
        }
        break;
      }
      case 'chimney': {
        this.a0 += dt * 7 * I * k;
        while (this.a0 >= 1) {
          this.a0 -= 1;
          const s = ctx.main.begin();
          s.at(this.x + spread(0.03), this.y, this.z + spread(0.03))
            .vel(spread(0.05), range(0.6, 0.9), spread(0.05))
            .motion(range(2.8, 3.8), 0.05, 0.45)
            .size(0.12 * sz, range(0.9, 1.2) * sz, 1.3)
            .spin(rnd() * TAU, spread(0.4))
            .color(0.75, 0.75, 0.77, 0.3)
            .look(smokeFrame(), R.STEAM, M.LIT)
            .fade(0.08, 0.35);
          s.wind = 1.1;
          s.push = 0.3;
          ctx.main.emit(s);
        }
        break;
      }
      case 'sparks': {
        this.next -= dt * I;
        if (this.next <= 0) {
          this.next = range(0.25, 1.1);
          const n = 3 + Math.floor(rnd() * 5 * Math.min(2, I));
          const blue = rnd() < 0.3;
          sparks(ctx, this.x, this.y, this.z, n, 2.4, 0, blue
            ? { life: 0.45, size: 0.025, ramp: R.TESLA, up: 0.6 }
            : { life: 0.6, size: 0.028, up: 0.6 });
          flash(ctx, this.x, this.y, this.z, 0.3, 3, 0, 0.06, blue ? 0.6 : 1, blue ? 0.8 : 0.8, blue ? 1.4 : 0.5);
          ctx.dyn?.add(this.x, this.y + 0.1, this.z, blue ? 0x88aaff : 0xffb060, 1.6, 2.6, 0.14, { flicker: 0.3 });
        }
        break;
      }
      case 'steam': {
        this.a0 += dt * 3 * I * k;
        while (this.a0 >= 1) {
          this.a0 -= 1;
          const s = ctx.main.begin();
          s.at(this.x + spread(0.04), this.y, this.z + spread(0.04))
            .vel(spread(0.1), range(0.4, 0.7), spread(0.1))
            .motion(range(1.3, 1.9), 0.05, 0.8)
            .size(0.08 * sz, range(0.42, 0.58) * sz, 1.6)
            .spin(rnd() * TAU, spread(0.6))
            .color(1, 1, 1, 0.42)
            .look(smokeFrame(), R.STEAM, M.LIT)
            .fade(0.1, 0.3);
          s.wind = 0.9;
          s.push = 0.3;
          ctx.main.emit(s);
        }
        break;
      }
      case 'exhaust': {
        this.a0 += dt * 7 * I * k;
        while (this.a0 >= 1) {
          this.a0 -= 1;
          const s = ctx.main.begin();
          s.at(this.x + spread(0.02), this.y, this.z + spread(0.02))
            .vel(spread(0.08), range(0.2, 0.35), spread(0.08))
            .motion(range(0.7, 1.1), 0.05, 1.2)
            .size(0.05, range(0.2, 0.3), 1.6)
            .spin(rnd() * TAU, spread(0.8))
            .color(1, 1, 1, 0.32)
            .look(smokeFrame(), R.SMOKE_DARK, M.LIT)
            .fade(0.08, 0.35);
          s.wind = 0.4;
          s.push = 0.3;
          ctx.main.emit(s);
        }
        break;
      }
    }
  }

  private smokePuff(ctx: FxContext, ramp: number, s0: number, s1: number, life: number, rise: number, alpha: number, yOff: number): void {
    const s = ctx.main.begin();
    s.at(this.x + spread(0.12), this.y + yOff, this.z + spread(0.12))
      .vel(spread(0.08), rise * range(0.75, 1.25), spread(0.08))
      .motion(life, 0.02, 0.18)
      .size(s0 * range(0.8, 1.2), s1 * range(0.85, 1.2), 1.4)
      .spin(rnd() * TAU, spread(0.3))
      .color(1, 1, 1, alpha)
      .look(smokeFrame(), ramp, M.LIT)
      .fade(0.12, 0.4);
    s.wind = 1.0;
    s.push = 0.35;
    ctx.main.emit(s);
  }
}
