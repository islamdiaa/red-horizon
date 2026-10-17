// [JUICE] CPU cost of the effect recipes, base vs. with the JUICE layers, on the real particle / beam batches
// and dynamic-light store (no GPU needed: batches only fill typed arrays). Prints µs per call.
//   node --import tsx tools/qa/juice_cpu.ts
import * as THREE from 'three';
import { ParticleBatch, createParticleUniforms } from '../../src/render/effects/particles';
import { BeamBatch } from '../../src/render/effects/beams';
import { DynamicLights } from '../../src/render/dynlights';
import type { FxContext } from '../../src/render/effects/context';
import { explosion } from '../../src/render/effects/explosions';
import { muzzleFlash, setTeslaStyle, teslaBolt, tracer, tracerBurst } from '../../src/render/effects/weapons';
import { airBurst, columnPuff, explosionExtras, heavyDeath, hitFlash, promotionBurst } from '../../src/render/effects/spectacle';
import { ClashMeter, ShakeModel } from '../../src/render/effects/juicelogic';

const u = createParticleUniforms(new THREE.Texture(), new THREE.Texture());
const main = new ParticleBatch(16384, u, 20);
const glow = new ParticleBatch(8192, u, 23);
const beams = new BeamBatch(8192, { uTime: u.uTime, uWind: u.uWind, uRamp: u.uRamp, uNoise: { value: null } } as unknown as Record<string, THREE.IUniform>, 21);
const dyn = new DynamicLights(255, 32);
const ctx = {
  main, glow, beams, sprites: {}, decals: { add: () => {} },
  lights: { flash: (now: number, x: number, y: number, z: number, c: number, i: number, r: number, d: number) => { dyn.add(x, y, z, c, i, r, d); } },
  getHeight: () => 0, now: 0, addShake: () => {}, density: 1, waterLevel: -5, isWater: () => false,
  bodies: {}, cue: () => {}, dyn, gpu: null, terrain: null,
} as unknown as FxContext;

function bench(name: string, n: number, fn: (i: number) => void): number {
  for (let i = 0; i < Math.min(200, n); i++) fn(i); // warm up
  const t0 = performance.now();
  for (let i = 0; i < n; i++) { fn(i); if (i % 64 === 0) { main.flush?.(); glow.flush?.(); beams.flush?.(); dyn.prepare?.(new THREE.PerspectiveCamera()); } }
  const us = ((performance.now() - t0) * 1000) / n;
  console.log(`${name.padEnd(34)} ${us.toFixed(2).padStart(8)} µs/call`);
  return us;
}

const N = 4000;
const r: Record<string, number> = {};
r.large = bench('explosion large (base)', N, (i) => explosion(ctx, 'large', i % 50, 0.3, 7, 1));
r.largeX = bench('explosion large + extras', N, (i) => { explosion(ctx, 'large', i % 50, 0.3, 7, 1); explosionExtras(ctx, 'large', i % 50, 0.3, 7, 0, 1, 1); });
r.medium = bench('explosion medium (base)', N, (i) => explosion(ctx, 'medium', i % 50, 0.3, 7, 1));
r.mediumX = bench('explosion medium + extras', N, (i) => { explosion(ctx, 'medium', i % 50, 0.3, 7, 1); explosionExtras(ctx, 'medium', i % 50, 0.3, 7, 0, 1, 1); });
r.muzzle = bench('muzzle flash', N, (i) => muzzleFlash(ctx, i % 50, 0.5, 7, 1, 0, 0, 1));
r.tracer = bench('tracer', N, (i) => tracer(ctx, i % 50, 0.5, 7, i % 50 + 5, 0.3, 9));
r.tracerB = bench('tracer + 2-round burst', N, (i) => { tracer(ctx, i % 50, 0.5, 7, i % 50 + 5, 0.3, 9); tracerBurst(ctx, i % 50, 0.5, 7, i % 50 + 5, 0.3, 9, 2); });
setTeslaStyle(1);
r.tesla = bench('tesla bolt (original)', 1000, (i) => teslaBolt(ctx, i % 50, 2, 7, i % 50 + 4, 0.3, 9));
setTeslaStyle(1.5);
r.teslaX = bench('tesla bolt (JUICE)', 1000, (i) => teslaBolt(ctx, i % 50, 2, 7, i % 50 + 4, 0.3, 9));
setTeslaStyle(1);
r.hit = bench('hit flash', N, (i) => hitFlash(ctx, i % 50, 0.4, 7, 0.3, 0.8, true, 1));
r.air = bench('flak air burst', N, (i) => airBurst(ctx, i % 50, 2.5, 7, 1, 0, 1));
r.heavy = bench('heavy death (Mammoth)', 1000, (i) => heavyDeath(ctx, i % 50, 0, 7, 1.4, 1));
r.promo = bench('promotion burst', 1000, (i) => promotionBurst(ctx, i % 50, 0, 7, 0.7, 2));
r.column = bench('smoke column puff', N, (i) => columnPuff(ctx, i % 50, 1, 7, 1.5, 1));
const shake = new ShakeModel();
const o = { x: 0, y: 0, z: 0 };
r.shake = bench('shake update', N, () => { shake.kick(0.05); shake.update(1 / 60, o, 26, 1); });
const clash = new ClashMeter();
let t = 0;
r.clash = bench('clash meter (120 shooters / frame)', 2000, () => { t += 1 / 60; for (let id = 0; id < 120; id++) clash.onFire(id, t, true); clash.update(1 / 60, t); });
console.log(JSON.stringify(r));
