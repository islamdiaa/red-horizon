/**
 * Procedural models of the neutral tech structures (sim/neutral.ts) and the supply convoy's truck
 * (sim/events.ts). Team-coloured trim reads neutral grey until a commander captures the structure.
 *
 *   oild  Oil Derrick (2x2): lattice derrick with a rocking pumpjack, storage tanks
 *   hosp  Field Hospital (2x2): white ward block and tent with red crosses, landing cross
 *   rado  Radar Outpost (2x2): bunker with a turning search radar on a mast
 *   comm  Communications Array (2x2): tall antenna mast, three dishes, blinking beacons
 *   truk  Supply Truck (vehicle, faces +X): cab and a canvas-covered cargo bed
 */
import * as THREE from 'three';
import { NB, makeTemplate, type Mat, type ModelFaction, type ModelTemplate } from './builder';
import { M, G, foundation, hazard, lathe, mergeChild, pipe, ringGeo, warnLight, drums, antenna, ladder } from './parts';
import { dtOf, healthVariant } from './anim';
import { setBodyTime } from './materials';
import type { ModelAnimState } from './types';
import type { Ctx } from './builder';

const AO = { h: 0.3, min: 0.52 };
const RUST: Mat = { c: 0x6e4a32, m: 0.55, r: 0.6, d: 0 };
const TANK: Mat = { c: 0x8d8a80, m: 0.5, r: 0.45, d: 0 };
const OIL: Mat = { c: 0x1a1612, m: 0.2, r: 0.3, d: 3 };
const CROSS: Mat = { c: 0xc8202a, m: 0.1, r: 0.5, d: 3 };
const CANVAS: Mat = { c: 0x6f6a4e, m: 0, r: 0.9, d: 2 };

function slab(): NB {
  const r = new NB('root');
  r.ao = AO;
  r.snow = 1;
  r.cavity = true;
  foundation(r, 2, 2, 0.04, 0.05, M.concreteDark);
  return r;
}

function structAnim(extra?: (c: Ctx, s: ModelAnimState) => void) {
  return (c: Ctx, s: ModelAnimState) => {
    healthVariant(c, s);
    setBodyTime(s.time);
    c.setPowered(true);
    if (c.v.seed === undefined) c.v.seed = Math.random() * 3;
    extra?.(c, s);
  };
}

// ---------------------------------------------------------------------------------------------
// Oil derrick
// ---------------------------------------------------------------------------------------------
function oilDerrick(): ModelTemplate {
  const r = slab();
  const y0 = 0.04;
  // lattice derrick (back left)
  const dx = -0.38, dz = -0.32, h = 1.5, b0 = 0.3, b1 = 0.06;
  r.box(M.concrete, 0.74, 0.06, 0.74, dx, y0 + 0.03, dz, { b: 0.01 });
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) pipe(r, [dx + b0 * sx, y0 + 0.06, dz + b0 * sz], [dx + b1 * sx, y0 + h, dz + b1 * sz], 0.016, RUST, 5);
  for (let i = 1; i <= 5; i++) {
    const f = i / 6, w = b0 + (b1 - b0) * f, y = y0 + 0.06 + (h - 0.06) * f;
    r.add(ringGeo(w * 1.36, w * 1.44, 0.012, 4), i === 3 ? M.team : RUST, { p: [dx, y, dz], r: [0, Math.PI / 4, 0] });
  }
  r.box(M.gun, 0.16, 0.08, 0.16, dx, y0 + h + 0.04, dz, { b: 0.01 });
  r.cyl(M.dark, 0.012, 0.012, h * 0.9, dx, y0 + h * 0.45, dz, { seg: 6 });
  warnLight(r, [dx, y0 + h + 0.1, dz], false, 0.02);
  ladder(r, h * 0.7, [dx + 0.2, y0 + 0.06, dz + 0.22], 0);
  // pumpjack (front): base, samson post, rocking walking beam with horse head
  const px = 0.2, pz = 0.42;
  r.box(M.concrete, 0.9, 0.06, 0.3, px, y0 + 0.03, pz, { b: 0.01 });
  r.box(M.gun, 0.16, 0.12, 0.2, px + 0.32, y0 + 0.12, pz, { b: 0.012 });
  for (const s of [-1, 1]) pipe(r, [px - 0.08, y0 + 0.06, pz + 0.09 * s], [px, y0 + 0.42, pz + 0.02 * s], 0.014, M.team, 5);
  const beam = r.node('beam', [px, y0 + 0.44, pz]);
  beam.box(M.team, 0.78, 0.05, 0.06, 0.02, 0, 0, { b: 0.01 });
  beam.box(M.gun, 0.1, 0.18, 0.08, -0.4, -0.06, 0, { b: 0.012 });
  beam.box(M.gun, 0.08, 0.06, 0.08, 0.36, -0.02, 0, { b: 0.01 });
  r.cyl(M.dark, 0.02, 0.02, 0.24, px - 0.42, y0 + 0.14, pz, { seg: 6 });
  // storage tanks (right)
  for (const [tx, tz] of [[0.52, -0.42], [0.52, 0.02]] as [number, number][]) {
    r.cyl(TANK, 0.2, 0.2, 0.42, tx, y0 + 0.21, tz, { seg: 16 });
    r.cyl(M.team, 0.205, 0.205, 0.05, tx, y0 + 0.33, tz, { seg: 16 });
    r.add(lathe([[0, 0.05], [0.12, 0.035], [0.2, 0]], 16), TANK, { p: [tx, y0 + 0.42, tz] });
  }
  pipe(r, [0.32, y0 + 0.12, -0.42], [dx + 0.3, y0 + 0.12, dz], 0.022, M.steel, 6);
  pipe(r, [0.32, y0 + 0.12, 0.02], [px + 0.2, y0 + 0.12, pz - 0.1], 0.02, M.steel, 6);
  r.cyl(OIL, 0.16, 0.18, 0.012, -0.55, y0 + 0.006, 0.45, { seg: 14 });
  drums(r, -0.15, y0, 0.0, 3);
  hazard(r, 0.4, 0.025, [px, y0 + 0.07, pz + 0.152]);
  return makeTemplate({
    root: r, height: 1.7, radius: 1.05, muzzles: [], glow: { glow: 1.6 },
    anim: structAnim((c, s) => {
      c.n.beam.rotation.z = Math.sin(s.time * 2.1 + (c.v.seed as number)) * 0.26 * (s.health > 0.25 ? 1 : 0.2);
    }),
  });
}

// ---------------------------------------------------------------------------------------------
// Field hospital
// ---------------------------------------------------------------------------------------------
function redCross(nb: NB, size: number, p: [number, number, number], r: [number, number, number] = [0, 0, 0]): void {
  const n = new NB('_x', p, r);
  n.box(CROSS, size, size * 0.32, 0.008, 0, 0, 0, { b: 0.002 });
  n.box(CROSS, size * 0.32, size, 0.008, 0, 0, 0, { b: 0.002 });
  mergeChild(nb, n);
}

function fieldHospital(): ModelTemplate {
  const r = slab();
  const y0 = 0.04;
  // ward block (back)
  const bz = -0.42;
  r.box(M.white, 1.5, 0.44, 0.66, -0.12, y0 + 0.22, bz, { b: 0.02 });
  r.box(M.team, 1.53, 0.03, 0.69, -0.12, y0 + 0.43, bz, { b: 0.008 });
  r.box(M.concreteLight, 1.46, 0.02, 0.62, -0.12, y0 + 0.455, bz, { b: 0.004 });
  for (let k = 0; k < 5; k++) r.box(G.window, 0.12, 0.08, 0.01, -0.7 + k * 0.26, y0 + 0.26, bz + 0.335, { b: 0 });
  redCross(r, 0.2, [0.45, y0 + 0.3, bz + 0.336]);
  // roof cross (seen from above) and a vent
  r.box(M.white, 0.42, 0.012, 0.42, -0.4, y0 + 0.47, bz, { b: 0.002 });
  r.box(CROSS, 0.34, 0.014, 0.1, -0.4, y0 + 0.474, bz, { b: 0.002 });
  r.box(CROSS, 0.1, 0.014, 0.34, -0.4, y0 + 0.474, bz, { b: 0.002 });
  r.cyl(M.gun, 0.05, 0.055, 0.08, 0.3, y0 + 0.5, bz - 0.1, { seg: 10 });
  // tent (front left): canvas ridge tent
  const tx = -0.45, tz = 0.4;
  r.add(new THREE.CylinderGeometry(0.32, 0.32, 0.8, 3, 1), M.canvas, { p: [tx, y0 + 0.16, tz], r: [0, 0, Math.PI / 2], s: [1, 1, 0.9] });
  r.box(CROSS, 0.18, 0.05, 0.01, tx, y0 + 0.2, tz + 0.29, { b: 0.002 });
  r.box(CROSS, 0.05, 0.18, 0.01, tx, y0 + 0.2, tz + 0.29, { b: 0.002 });
  // helipad cross on the slab (front right) and an ambulance-style crate stack
  r.box(M.white, 0.5, 0.008, 0.5, 0.45, y0 + 0.005, 0.42, { b: 0 });
  r.box(CROSS, 0.38, 0.01, 0.11, 0.45, y0 + 0.008, 0.42, { b: 0 });
  r.box(CROSS, 0.11, 0.01, 0.38, 0.45, y0 + 0.008, 0.42, { b: 0 });
  for (const [cx, cz] of [[0.05, 0.62], [0.05, 0.47], [-0.07, 0.55]] as [number, number][]) r.box(M.olive, 0.1, 0.1, 0.12, cx, y0 + 0.05, cz, { b: 0.01 });
  warnLight(r, [0.5, y0 + 0.47, bz - 0.25], false, 0.02, { glow: 0xff3030, i: 2 });
  return makeTemplate({ root: r, height: 0.75, radius: 1.05, muzzles: [], glow: { glow: 1.6 }, anim: structAnim() });
}

// ---------------------------------------------------------------------------------------------
// Radar outpost
// ---------------------------------------------------------------------------------------------
function radarOutpost(): ModelTemplate {
  const r = slab();
  const y0 = 0.04;
  // sandbagged bunker (front)
  r.box(M.concreteDark, 1.2, 0.3, 0.6, -0.2, y0 + 0.15, 0.36, { b: 0.03 });
  r.box(M.team, 1.22, 0.03, 0.62, -0.2, y0 + 0.31, 0.36, { b: 0.008 });
  r.box(M.darker, 0.5, 0.06, 0.01, -0.2, y0 + 0.2, 0.665, { b: 0 });
  r.box(G.green, 0.36, 0.03, 0.006, -0.2, y0 + 0.2, 0.67, { b: 0 });
  antenna(r, 0.25, y0 + 0.32, 0.3, 0.4);
  // mast with a turning radar (back right)
  const mx = 0.4, mz = -0.38, mh = 1.1;
  r.box(M.concrete, 0.4, 0.08, 0.4, mx, y0 + 0.04, mz, { b: 0.01 });
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) pipe(r, [mx + 0.16 * sx, y0 + 0.08, mz + 0.16 * sz], [mx + 0.05 * sx, y0 + mh, mz + 0.05 * sz], 0.012, M.steel, 5);
  for (let i = 1; i <= 3; i++) {
    const f = i / 4, w = 0.16 + (0.05 - 0.16) * f;
    r.add(ringGeo(w * 1.38, w * 1.46, 0.012, 4), i === 2 ? M.team : M.steel, { p: [mx, y0 + 0.08 + (mh - 0.08) * f, mz], r: [0, Math.PI / 4, 0] });
  }
  r.cyl(M.gun, 0.08, 0.08, 0.05, mx, y0 + mh + 0.02, mz, { seg: 12 });
  const rad = r.node('radar', [mx, y0 + mh + 0.05, mz]);
  rad.cyl(M.gun, 0.03, 0.04, 0.08, 0, 0.04, 0, { seg: 8 });
  rad.box(M.offwhite, 0.6, 0.18, 0.03, 0, 0.17, 0.02, { b: 0.006 });
  for (let k = -2; k <= 2; k++) rad.box(M.steel, 0.008, 0.16, 0.035, k * 0.12, 0.17, 0.0, { b: 0 });
  rad.box(M.dark, 0.05, 0.05, 0.12, 0, 0.12, -0.05, { b: 0.006 });
  warnLight(r, [mx, y0 + mh + 0.32, mz], false, 0.018);
  // generator and fuel drums
  r.box(M.olive, 0.26, 0.16, 0.2, -0.55, y0 + 0.08, -0.45, { b: 0.012 });
  drums(r, -0.2, y0, -0.5, 2);
  return makeTemplate({
    root: r, height: 1.45, radius: 1.0, muzzles: [], glow: { glow: 1.8 },
    anim: structAnim((c, s) => { if (s.health > 0.25) c.n.radar.rotation.y += dtOf(s) * 1.6; }),
  });
}

// ---------------------------------------------------------------------------------------------
// Communications array
// ---------------------------------------------------------------------------------------------
function commsArray(): ModelTemplate {
  const r = slab();
  const y0 = 0.04;
  // equipment shelter
  r.box(M.offwhite, 0.8, 0.34, 0.5, 0.3, y0 + 0.17, 0.42, { b: 0.02 });
  r.box(M.team, 0.82, 0.03, 0.52, 0.3, y0 + 0.33, 0.42, { b: 0.008 });
  for (let k = 0; k < 3; k++) r.box(G.cyan, 0.08, 0.04, 0.008, 0.08 + k * 0.16, y0 + 0.24, 0.672, { b: 0 });
  // tall guyed mast (centre back)
  const mx = -0.25, mz = -0.2, mh = 2.0;
  r.cyl(M.concrete, 0.12, 0.14, 0.06, mx, y0 + 0.03, mz, { seg: 10 });
  for (const [sx, sz] of [[-1, 0], [0.5, 0.87], [0.5, -0.87]] as [number, number][]) {
    pipe(r, [mx + sx * 0.07, y0 + 0.06, mz + sz * 0.07], [mx + sx * 0.025, y0 + mh, mz + sz * 0.025], 0.01, M.red, 4);
    pipe(r, [mx + sx * 0.72, y0 + 0.01, mz + sz * 0.72], [mx, y0 + mh * 0.75, mz], 0.003, M.dark, 3);
    r.box(M.concreteDark, 0.06, 0.03, 0.06, mx + sx * 0.72, y0 + 0.015, mz + sz * 0.72, { b: 0.006 });
  }
  for (let i = 1; i <= 6; i++) r.add(ringGeo(0.06, 0.075, 0.01, 6), i % 2 ? M.white : M.red, { p: [mx, y0 + (mh * i) / 7, mz] });
  warnLight(r, [mx, y0 + mh + 0.03, mz], false, 0.022);
  // three dishes at different heights
  const dishes: [number, number, number][] = [[0.9, 0.0, 0.5], [1.3, 2.1, 0.35], [0.6, 4.2, 0.6]];
  for (const [h, yaw, tilt] of dishes) {
    const d = new NB('_dm', [mx, y0 + h, mz], [0, yaw, 0]);
    d.box(M.gun, 0.12, 0.02, 0.02, 0.06, 0, 0, { b: 0 });
    const inner = new NB('_d', [0.16, 0, 0], [0, 0, -Math.PI / 2 + tilt]);
    inner.add(lathe([[0, 0], [0.08, 0.012], [0.15, 0.045], [0.19, 0.075]], 16), M.white);
    inner.cyl(M.dark, 0.005, 0.005, 0.13, 0, 0.065, 0, { seg: 5 });
    mergeChild(d, inner);
    mergeChild(r, d);
  }
  r.box(M.olive, 0.22, 0.14, 0.18, -0.65, y0 + 0.07, 0.5, { b: 0.012 });
  hazard(r, 0.5, 0.03, [0.3, y0 + 0.05, 0.672]);
  return makeTemplate({ root: r, height: 2.2, radius: 1.1, muzzles: [], glow: { glow: 1.8 }, anim: structAnim() });
}

// ---------------------------------------------------------------------------------------------
// Supply truck (faces +X)
// ---------------------------------------------------------------------------------------------
function supplyTruck(): ModelTemplate {
  const r = new NB('root');
  r.ao = { h: 0.12, min: 0.55 };
  // chassis and wheels
  r.box(M.dark, 0.78, 0.05, 0.26, 0, 0.09, 0, { b: 0.01 });
  for (const wx of [0.25, -0.12, -0.27]) for (const s of [-1, 1]) {
    r.cyl(M.rubber, 0.075, 0.075, 0.06, wx, 0.075, 0.15 * s, { seg: 12, r: [Math.PI / 2, 0, 0] });
    r.cyl(M.gun, 0.04, 0.04, 0.064, wx, 0.075, 0.15 * s, { seg: 8, r: [Math.PI / 2, 0, 0] });
  }
  // cab
  r.box(M.team, 0.22, 0.2, 0.3, 0.27, 0.22, 0, { b: 0.025 });
  r.box(M.teamDark, 0.12, 0.08, 0.28, 0.4, 0.15, 0, { b: 0.015 });
  r.box(M.glass, 0.006, 0.08, 0.24, 0.382, 0.27, 0, { b: 0, r: [0, 0, -0.25] });
  for (const s of [-1, 1]) r.box(G.head, 0.008, 0.03, 0.04, 0.462, 0.15, 0.09 * s, { b: 0 });
  // cargo bed with a canvas tilt and crates sticking out the back
  r.box(M.teamDark, 0.5, 0.05, 0.32, -0.12, 0.14, 0, { b: 0.01 });
  r.add(new THREE.CylinderGeometry(0.17, 0.17, 0.48, 12, 1, false, 0, Math.PI), CANVAS, { p: [-0.12, 0.25, 0], r: [0, 0, Math.PI / 2], s: [1, 1, 0.95] });
  r.box(CANVAS, 0.48, 0.11, 0.33, -0.12, 0.215, 0, { b: 0.01 });
  r.box(M.wood, 0.12, 0.1, 0.12, -0.33, 0.21, 0.06, { b: 0.01 });
  r.box(M.wood, 0.1, 0.08, 0.1, -0.33, 0.2, -0.07, { b: 0.01 });
  for (const s of [-1, 1]) r.box(G.red, 0.006, 0.02, 0.03, -0.39, 0.13, 0.11 * s, { b: 0 });
  r.box(M.yellow, 0.06, 0.01, 0.28, 0.27, 0.325, 0, { b: 0.002 });
  return makeTemplate({ root: r, height: 0.45, radius: 0.42, muzzles: [], glow: { glow: 1.4 }, anim: (c, s) => healthVariant(c, s) });
}

export const NEUTRAL_BUILDERS: Record<string, (fac?: ModelFaction) => ModelTemplate> = {
  oild: oilDerrick,
  hosp: fieldHospital,
  rado: radarOutpost,
  comm: commsArray,
  truk: supplyTruck,
};
