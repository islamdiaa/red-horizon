/**
 * Base structures. Centred on their footprint, fronts/doors facing +Z, ground at y=0.
 * Every structure sits on a concrete slab reaching from y=-0.15 to y≈0.04.
 */
import * as THREE from 'three';
import { NB, makeTemplate, type AnimFn, type Ctx, type Mat, type ModelTemplate, type V3 } from './builder';
import type { ModelAnimState } from './types';
import {
  M,
  G,
  alliedStar,
  antenna,
  faceRot,
  foundation,
  grille,
  hazard,
  ladder,
  lamp,
  lathe,
  pipe,
  prismXY,
  prismXZ,
  ringGeo,
  sandbags,
  shade,
  sovietStar,
  starGeo,
  stowage,
  windows,
  discGeo,
  mergeChild,
  orePile,
} from './parts';
import { approach, blink, dtOf, healthVariant } from './anim';

const STRUCT_AO = { h: 0.32, min: 0.52 };

function root(sx: number, sz: number, slab: Mat = M.concrete): NB {
  const r = new NB('root');
  r.ao = STRUCT_AO;
  foundation(r, sx, sz, 0.04, 0.05, slab);
  return r;
}

/** Common structure animation: damage scorch, powered glow, blinking beacons. */
function sAnim(extra?: (c: Ctx, s: ModelAnimState, pw: number) => void): AnimFn {
  return (c, s) => {
    healthVariant(c, s);
    if (c.v.seed === undefined) c.v.seed = Math.random() * 3;
    const pw = s.powered ? 1 : 0.1;
    c.setGlow('glow', pw);
    c.setGlow('glow:blink', s.powered ? (blink(s.time + c.v.seed, 1.6, 0.3) ? 1 : 0.06) : 0.04);
    extra?.(c, s, pw);
  };
}

/** Beacon: small post with a blinking light. */
function beacon(nb: NB, p: V3, glow = G.red, h = 0.05): void {
  nb.cyl(M.dark, 0.008, 0.01, h, p[0], p[1] + h / 2, p[2], { seg: 6 });
  nb.sph(glow, 0.016, p[0], p[1] + h + 0.01, p[2], { seg: 8, slot: 'glow:blink' });
}

/** Gable roof along X: width w (x), depth d (z), eave height y, ridge rise. */
function gableRoof(nb: NB, w: number, d: number, y: number, rise: number, mat: Mat, x = 0, z = 0, overhang = 0.04, ridgeAlongZ = false): void {
  const across = ridgeAlongZ ? w : d;
  const along = ridgeAlongZ ? d : w;
  const h = across / 2 + overhang;
  nb.add(
    prismXY(
      [
        [-h, 0],
        [h, 0],
        [h, 0.02],
        [0, rise + 0.02],
        [-h, 0.02],
      ],
      along + overhang * 2,
      0.01,
    ),
    mat,
    { p: [x, y, z], r: [0, ridgeAlongZ ? 0 : Math.PI / 2, 0] },
  );
}

/** Corrugated ridges on a flat roof (along X). */
function ridges(nb: NB, w: number, d: number, y: number, x = 0, z = 0, mat: Mat = M.team, step = 0.06): void {
  const n = Math.max(2, Math.floor(d / step));
  for (let i = 0; i < n; i++) {
    const zz = z - d / 2 + (d * (i + 0.5)) / n;
    nb.box(mat, w, 0.012, d / n * 0.45, x, y + 0.006, zz, { b: 0.004 });
  }
}

/** Roof-top AC/vent unit. */
function vent(nb: NB, x: number, y: number, z: number, r = 0.06): void {
  nb.cyl(M.gun, r, r * 1.1, 0.06, x, y + 0.03, z, { seg: 12 });
  nb.cyl(M.darker, r * 0.85, r * 0.85, 0.004, x, y + 0.061, z, { seg: 12 });
  nb.box(M.steel, r * 1.6, 0.006, 0.01, x, y + 0.064, z, { b: 0 });
  nb.box(M.steel, 0.01, 0.006, r * 1.6, x, y + 0.064, z, { b: 0 });
}

function crate(nb: NB, s: number, x: number, y: number, z: number, mat: Mat = M.wood, ry = 0): void {
  nb.box(mat, s, s, s, x, y + s / 2, z, { b: s * 0.08, r: [0, ry, 0] });
  nb.box(M.dark, s * 1.02, s * 0.12, s * 1.02, x, y + s * 0.5, z, { b: 0.002, r: [0, ry, 0] });
}

/** Stack with bands; returns top y. Adds a smoke node `name` at the top. */
function stack(nb: NB, name: string, x: number, z: number, y0: number, h: number, r0: number, r1: number): void {
  nb.cyl(M.concreteLight, r1, r0, h, x, y0 + h / 2, z, { seg: 16 });
  nb.cyl(M.team, r1 * 1.06, r1 * 1.08, 0.06, x, y0 + h - 0.08, z, { seg: 16 });
  nb.cyl(M.team, r1 * 1.1 + (r0 - r1) * 0.35, r1 * 1.1 + (r0 - r1) * 0.35, 0.04, x, y0 + h * 0.62, z, { seg: 16 });
  nb.cyl(M.dark, r1 * 1.08, r1 * 1.08, 0.025, x, y0 + h - 0.0125, z, { seg: 16 });
  nb.cyl(M.darker, r1 * 0.85, r1 * 0.85, 0.004, x, y0 + h + 0.001, z, { seg: 16 });
  nb.node(name, [x, y0 + h + 0.02, z]);
}

// =============================================================================================
// Construction Yard (3x3)
// =============================================================================================

function constructionYard(): ModelTemplate {
  const r = root(3, 3);
  const y0 = 0.04;
  // apron markings (front yard)
  r.box(M.asphalt, 2.0, 0.012, 1.25, -0.35, y0 + 0.006, 0.7, { b: 0 });
  for (let i = 0; i < 5; i++) r.box(M.yellow, 0.16, 0.004, 0.035, -1.15 + i * 0.4, y0 + 0.014, 0.12, { b: 0 });
  r.box(M.yellow, 0.035, 0.004, 1.1, 0.6, y0 + 0.014, 0.72, { b: 0 });
  hazard(r, 1.9, 0.05, [-0.35, y0 + 0.014, 1.32], [-Math.PI / 2, 0, 0]);
  // main hall (back)
  const hx = -0.32;
  const hz = -0.78;
  const hw = 2.1;
  const hd = 1.1;
  const hh = 0.58;
  r.box(M.concreteLight, hw, hh, hd, hx, y0 + hh / 2, hz, { b: 0.03 });
  r.box(M.team, hw + 0.04, 0.07, hd + 0.04, hx, y0 + hh - 0.02, hz, { b: 0.02 });
  // sawtooth roof
  for (let i = 0; i < 4; i++) {
    const x = hx - hw / 2 + 0.27 + i * 0.52;
    r.add(
      prismXY(
        [
          [-0.26, 0],
          [0.26, 0],
          [0.14, 0.2],
          [0.12, 0.2],
        ],
        hd - 0.06,
        0.012,
      ),
      M.team,
      { p: [x, y0 + hh + 0.015, hz] },
    );
    r.box(M.glassBlue, 0.02, 0.17, hd - 0.12, x + 0.2, y0 + hh + 0.1, hz, { b: 0, r: [0, 0, 0.75] });
  }
  // big bay door + windows on front facade
  const fz = hz + hd / 2;
  r.box(M.darker, 0.7, 0.42, 0.02, hx - 0.35, y0 + 0.21, fz + 0.002, { b: 0 });
  for (let i = 0; i < 7; i++) r.box(M.teamDark, 0.68, 0.012, 0.02, hx - 0.35, y0 + 0.03 + i * 0.058, fz + 0.012, { b: 0 });
  hazard(r, 0.78, 0.045, [hx - 0.35, y0 + 0.45, fz + 0.012]);
  windows(r, 4, 0.1, 0.07, 0.05, [hx + 0.55, y0 + 0.36, fz + 0.004]);
  windows(r, 4, 0.1, 0.07, 0.05, [hx + 0.55, y0 + 0.22, fz + 0.004], [0, 0, 0], G.window, 'glow', [0, 2, 3]);
  sovietStarOrAllied(r, 0.11, [hx + 0.55, y0 + 0.5, fz + 0.012]);
  // control tower (right)
  const tx = 1.02;
  const tz = -0.55;
  r.box(M.concrete, 0.6, 0.72, 0.62, tx, y0 + 0.36, tz, { b: 0.025 });
  r.box(M.team, 0.64, 0.05, 0.66, tx, y0 + 0.74, tz, { b: 0.015 });
  r.box(M.glassBlue, 0.52, 0.16, 0.54, tx, y0 + 0.84, tz, { b: 0.01 });
  windows(r, 4, 0.1, 0.12, 0.025, [tx, y0 + 0.84, tz + 0.272]);
  windows(r, 4, 0.1, 0.12, 0.025, [tx + 0.262, y0 + 0.84, tz], [0, Math.PI / 2, 0]);
  r.box(M.teamDark, 0.62, 0.04, 0.64, tx, y0 + 0.94, tz, { b: 0.015 });
  windows(r, 3, 0.1, 0.08, 0.06, [tx, y0 + 0.5, tz + 0.312], [0, 0, 0], G.window, 'glow', [0, 2]);
  antenna(r, tx + 0.2, y0 + 0.96, tz - 0.2, 0.35);
  beacon(r, [tx - 0.2, y0 + 0.96, tz + 0.2]);
  // side annex + stair
  r.box(M.concreteDark, 0.5, 0.3, 0.55, tx, y0 + 0.15, tz + 0.75, { b: 0.02 });
  r.box(M.team, 0.52, 0.03, 0.57, tx, y0 + 0.31, tz + 0.75, { b: 0.01 });
  r.box(M.darker, 0.2, 0.22, 0.02, tx - 0.05, y0 + 0.11, tz + 1.03, { b: 0 });
  lamp(r, G.warm, [tx - 0.05, y0 + 0.25, tz + 1.05], 0.018);
  // materials yard
  for (let i = 0; i < 3; i++) r.box(M.steel, 0.5, 0.025, 0.04, 0.0, y0 + 0.012 + i * 0.026, 0.95 + i * 0.05, { b: 0.004 });
  crate(r, 0.14, 0.42, y0, 0.95, M.wood, 0.3);
  crate(r, 0.12, 0.44, y0 + 0.14, 0.95, M.olive, 0.5);
  crate(r, 0.12, 0.28, y0, 1.1, M.wood, -0.2);
  // crane tower (front-left)
  const cx = -0.95;
  const cz = 0.55;
  r.box(M.concreteDark, 0.3, 0.06, 0.3, cx, y0 + 0.03, cz, { b: 0.01 });
  const th = 0.86;
  for (const [dx, dz] of [
    [-0.07, -0.07],
    [0.07, -0.07],
    [-0.07, 0.07],
    [0.07, 0.07],
  ]) {
    r.box(M.yellow, 0.025, th, 0.025, cx + dx, y0 + 0.06 + th / 2, cz + dz, { b: 0.004 });
  }
  for (let i = 0; i < 7; i++) {
    const y = y0 + 0.1 + i * 0.12;
    r.box(M.yellow, 0.14, 0.012, 0.012, cx, y, cz - 0.07, { b: 0, r: [0, 0, i % 2 ? 0.6 : -0.6] });
    r.box(M.yellow, 0.14, 0.012, 0.012, cx, y, cz + 0.07, { b: 0, r: [0, 0, i % 2 ? 0.6 : -0.6] });
    r.box(M.yellow, 0.012, 0.012, 0.14, cx - 0.07, y, cz, { b: 0, r: [i % 2 ? 0.6 : -0.6, 0, 0] });
    r.box(M.yellow, 0.012, 0.012, 0.14, cx + 0.07, y, cz, { b: 0, r: [i % 2 ? 0.6 : -0.6, 0, 0] });
  }
  const crane = r.node('crane', [cx, y0 + 0.06 + th, cz], [0, 0.6, 0]);
  crane.box(M.yellow, 0.18, 0.1, 0.18, 0, 0.05, 0, { b: 0.012 });
  crane.box(M.glassBlue, 0.08, 0.06, 0.1, 0.06, 0.06, 0.1, { b: 0.008 });
  // jib (lattice) toward +X, counter-jib toward -X
  const jl = 1.25;
  crane.box(M.yellow, jl, 0.02, 0.02, jl / 2, 0.11, -0.035, { b: 0.003 });
  crane.box(M.yellow, jl, 0.02, 0.02, jl / 2, 0.11, 0.035, { b: 0.003 });
  crane.box(M.yellow, jl, 0.02, 0.02, jl / 2, 0.17, 0, { b: 0.003 });
  for (let i = 0; i < 10; i++) {
    const x = 0.06 + i * (jl / 10);
    crane.box(M.yellow, 0.01, 0.07, 0.01, x, 0.14, -0.035, { b: 0, r: [0, 0, 0.6] });
    crane.box(M.yellow, 0.01, 0.07, 0.01, x, 0.14, 0.035, { b: 0, r: [0, 0, -0.6] });
  }
  crane.box(M.yellow, 0.36, 0.03, 0.06, -0.18, 0.11, 0, { b: 0.006 });
  crane.box(M.concreteDark, 0.12, 0.1, 0.1, -0.32, 0.08, 0, { b: 0.012 });
  crane.cyl(M.yellow, 0.012, 0.012, 0.18, 0, 0.22, 0, { seg: 6 });
  pipe(crane, [0, 0.31, 0], [jl * 0.9, 0.18, 0], 0.003, M.steel, 4);
  pipe(crane, [0, 0.31, 0], [-0.3, 0.13, 0], 0.003, M.steel, 4);
  crane.sph(G.red, 0.014, 0, 0.32, 0, { seg: 6, slot: 'glow:blink' });
  // trolley, cable and hook with a load
  crane.box(M.dark, 0.05, 0.02, 0.08, 0.95, 0.09, 0, { b: 0.004 });
  crane.cyl(M.steel, 0.003, 0.003, 0.5, 0.95, -0.16, 0, { seg: 4 });
  crane.box(M.dark, 0.03, 0.04, 0.03, 0.95, -0.42, 0, { b: 0.006 });
  crane.box(M.team, 0.24, 0.05, 0.08, 0.95, -0.47, 0, { b: 0.008 });

  return makeTemplate({
    root: r,
    height: 1.25,
    radius: 1.55,
    muzzles: [],
    glow: { glow: 1.6, 'glow:blink': 5 },
    anim: sAnim((c, s) => {
      if (!s.powered) return;
      c.n.crane.rotation.y = 0.6 + Math.sin(s.time * 0.25 + c.v.seed) * 0.9;
    }),
  });
}

/** Neutral emblem for buildings shared by both factions: a team-coloured gear/wrench plate. */
function sovietStarOrAllied(nb: NB, size: number, p: V3): void {
  nb.add(discGeo(size, 0.01, 6), M.dark, { p, r: [Math.PI / 2, 0, 0] });
  nb.add(discGeo(size * 0.82, 0.012, 6), M.team, { p: [p[0], p[1], p[2] + 0.002], r: [Math.PI / 2, 0, 0] });
  nb.add(starGeo(size * 0.6, 0.004), M.white, { p: [p[0], p[1], p[2] + 0.014], r: faceRot('+z') });
}

// =============================================================================================
// Power plant (2x2)
// =============================================================================================

function powerPlant(): ModelTemplate {
  const r = root(2, 2);
  const y0 = 0.04;
  // turbine hall
  const hx = -0.28;
  const hz = -0.3;
  r.box(M.concreteLight, 1.2, 0.48, 1.0, hx, y0 + 0.24, hz, { b: 0.025 });
  r.box(M.team, 1.24, 0.06, 1.04, hx, y0 + 0.47, hz, { b: 0.015 });
  gableRoof(r, 1.16, 0.98, y0 + 0.5, 0.16, M.teamDark, hx, hz, 0.02);
  ridges(r, 0.0, 0.0, 0, hx, hz);
  windows(r, 5, 0.12, 0.1, 0.05, [hx, y0 + 0.31, hz + 0.502]);
  r.box(M.darker, 0.26, 0.22, 0.02, hx - 0.38, y0 + 0.11, hz + 0.505, { b: 0 });
  hazard(r, 0.3, 0.04, [hx - 0.38, y0 + 0.24, hz + 0.51]);
  vent(r, hx - 0.3, y0 + 0.5, hz - 0.2, 0.06);
  // stacks (back right)
  stack(r, 'smoke0', 0.58, -0.58, y0, 1.16, 0.15, 0.1);
  stack(r, 'smoke1', 0.58, -0.08, y0, 1.0, 0.14, 0.095);
  pipe(r, [0.32, y0 + 0.3, -0.58], [0.45, y0 + 0.3, -0.58], 0.04, M.steel);
  pipe(r, [0.32, y0 + 0.3, -0.08], [0.46, y0 + 0.3, -0.08], 0.035, M.steel);
  // generator / reactor core housing (front right) with glowing vents
  const gx = 0.48;
  const gz = 0.5;
  r.cyl(M.teamDark, 0.28, 0.3, 0.12, gx, y0 + 0.06, gz, { seg: 20 });
  r.cyl(M.concreteLight, 0.25, 0.27, 0.22, gx, y0 + 0.23, gz, { seg: 20 });
  r.add(lathe([[0.25, 0], [0.22, 0.08], [0.12, 0.14], [0.0, 0.15]], 20), M.team, { p: [gx, y0 + 0.34, gz] });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    r.box(G.fire, 0.05, 0.12, 0.012, gx + Math.cos(a) * 0.272, y0 + 0.23, gz + Math.sin(a) * 0.272, {
      r: [0, -a + Math.PI / 2, 0],
      b: 0,
      slot: 'glow:core',
    });
  }
  r.sph(G.fire, 0.05, gx, y0 + 0.5, gz, { seg: 10, slot: 'glow:core' });
  r.cyl(M.dark, 0.06, 0.07, 0.04, gx, y0 + 0.48, gz, { seg: 10 });
  // transformers (front left)
  for (let i = 0; i < 3; i++) {
    const x = -0.72 + i * 0.26;
    const z = 0.55;
    r.box(M.gun, 0.16, 0.2, 0.2, x, y0 + 0.1, z, { b: 0.012 });
    for (let k = 0; k < 4; k++) r.box(M.dark, 0.17, 0.16, 0.01, x, y0 + 0.1, z - 0.07 + k * 0.045, { b: 0 });
    for (const dz of [-0.05, 0.05]) {
      for (let k = 0; k < 3; k++) r.cyl(M.offwhite, 0.018, 0.018, 0.014, x, y0 + 0.21 + k * 0.018, z + dz, { seg: 8 });
    }
  }
  pipe(r, [-0.72, y0 + 0.27, 0.5], [0.0, y0 + 0.27, 0.5], 0.006, M.copper, 4);
  pipe(r, [0.0, y0 + 0.27, 0.5], [0.22, y0 + 0.3, 0.5], 0.006, M.copper, 4);
  beacon(r, [0.58, y0 + 1.16, -0.58], G.red, 0.02);

  return makeTemplate({
    root: r,
    height: 1.25,
    radius: 1.05,
    muzzles: [],
    smoke: ['smoke0', 'smoke1'],
    glow: { glow: 1.6, 'glow:core': 4, 'glow:blink': 5 },
    anim: sAnim((c, s) => {
      const k = s.health < 0.25 ? 0.4 : 1;
      c.setGlow('glow:core', s.powered ? k * (0.75 + 0.25 * Math.sin(s.time * 2.2 + c.v.seed)) : 0.15);
    }),
  });
}

// =============================================================================================
// Advanced power plant (3x3)
// =============================================================================================

function coolingTower(nb: NB, name: string, x: number, z: number, y0: number, h: number, rb: number): void {
  nb.add(
    lathe(
      [
        [rb, 0],
        [rb * 0.86, h * 0.25],
        [rb * 0.7, h * 0.6],
        [rb * 0.68, h * 0.75],
        [rb * 0.72, h * 0.95],
        [rb * 0.74, h],
      ],
      24,
    ),
    M.concreteLight,
    { p: [x, y0, z] },
  );
  nb.add(ringGeo(rb * 0.68, rb * 0.75, 0.02, 24), M.concreteDark, { p: [x, y0 + h, z] });
  nb.add(discGeo(rb * 0.7, 0.01, 24), M.darker, { p: [x, y0 + h - 0.08, z] });
  nb.add(ringGeo(rb * 0.69, rb * 0.73, 0.06, 24), M.team, { p: [x, y0 + h * 0.86, z] });
  // support legs at base
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    nb.box(M.concreteDark, 0.03, 0.08, 0.03, x + Math.cos(a) * rb * 0.98, y0 + 0.04, z + Math.sin(a) * rb * 0.98, { b: 0 });
  }
  nb.node(name, [x, y0 + h, z]);
}

function advPowerPlant(): ModelTemplate {
  const r = root(3, 3);
  const y0 = 0.04;
  coolingTower(r, 'smoke0', -0.72, -0.68, y0, 1.15, 0.55);
  coolingTower(r, 'smoke1', 0.62, -0.78, y0, 0.98, 0.48);
  // reactor containment (front left)
  const rx = -0.62;
  const rz = 0.62;
  r.cyl(M.concreteLight, 0.48, 0.5, 0.34, rx, y0 + 0.17, rz, { seg: 28 });
  r.add(new THREE.SphereGeometry(0.48, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.offwhite, { p: [rx, y0 + 0.34, rz] });
  r.add(ringGeo(0.47, 0.51, 0.05, 28), M.team, { p: [rx, y0 + 0.33, rz] });
  r.add(ringGeo(0.0, 0.12, 0.02, 16), M.gun, { p: [rx, y0 + 0.82, rz] });
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.3;
    r.box(G.cyan, 0.04, 0.1, 0.012, rx + Math.cos(a) * 0.495, y0 + 0.17, rz + Math.sin(a) * 0.495, {
      r: [0, -a + Math.PI / 2, 0],
      b: 0,
      slot: 'glow:core',
    });
  }
  // turbine/control building (front right)
  const bx = 0.62;
  const bz = 0.5;
  r.box(M.concrete, 0.95, 0.42, 0.8, bx, y0 + 0.21, bz, { b: 0.025 });
  r.box(M.team, 0.99, 0.05, 0.84, bx, y0 + 0.42, bz, { b: 0.015 });
  ridges(r, 0.9, 0.76, y0 + 0.44, bx, bz, M.teamDark, 0.08);
  windows(r, 5, 0.1, 0.09, 0.06, [bx, y0 + 0.28, bz + 0.402]);
  r.box(M.darker, 0.22, 0.2, 0.02, bx - 0.28, y0 + 0.1, bz + 0.405, { b: 0 });
  vent(r, bx + 0.25, y0 + 0.45, bz - 0.15, 0.07);
  vent(r, bx - 0.05, y0 + 0.45, bz - 0.15, 0.07);
  // pipes between
  pipe(r, [rx + 0.45, y0 + 0.22, rz - 0.05], [bx - 0.48, y0 + 0.22, bz - 0.05], 0.045, M.steel);
  pipe(r, [rx + 0.4, y0 + 0.12, rz - 0.25], [bx - 0.48, y0 + 0.12, bz - 0.25], 0.035, M.steel);
  pipe(r, [bx, y0 + 0.2, bz - 0.4], [bx, y0 + 0.2, -0.35], 0.04, M.steel);
  // glowing coolant channel
  r.box(M.darker, 0.12, 0.02, 0.9, 0.0, y0 + 0.01, 0.05, { b: 0 });
  r.box(G.cyan, 0.08, 0.004, 0.86, 0.0, y0 + 0.021, 0.05, { b: 0, slot: 'glow:core' });
  beacon(r, [bx + 0.4, y0 + 0.44, bz + 0.33]);
  beacon(r, [-0.72, y0 + 1.15, -0.68 - 0.38], G.red, 0.02);

  return makeTemplate({
    root: r,
    height: 1.25,
    radius: 1.55,
    muzzles: [],
    smoke: ['smoke0', 'smoke1'],
    glow: { glow: 1.6, 'glow:core': 3.5, 'glow:blink': 5 },
    anim: sAnim((c, s) => {
      c.setGlow('glow:core', s.powered ? 0.8 + 0.2 * Math.sin(s.time * 1.7 + c.v.seed) : 0.15);
    }),
  });
}

// =============================================================================================
// Ore refinery (3x3) — dock at front centre (+Z)
// =============================================================================================

function refinery(): ModelTemplate {
  const r = root(3, 3);
  const y0 = 0.04;
  // dock pad (front centre, spills slightly beyond the footprint towards the dock cell)
  r.box(M.asphalt, 0.95, 0.03, 1.2, 0, y0 + 0.012, 0.85, { b: 0.01 });
  hazard(r, 1.2, 0.05, [-0.475, y0 + 0.03, 0.85], [-Math.PI / 2, 0, Math.PI / 2]);
  hazard(r, 1.2, 0.05, [0.475, y0 + 0.03, 0.85], [-Math.PI / 2, 0, Math.PI / 2]);
  for (let i = 0; i < 4; i++) {
    r.box(M.yellow, 0.3, 0.004, 0.04, 0, y0 + 0.03, 0.45 + i * 0.25, { b: 0 });
    lamp(r, G.green, [-0.43, y0 + 0.05, 0.4 + i * 0.3], 0.014, 'glow:dock');
    lamp(r, G.green, [0.43, y0 + 0.05, 0.4 + i * 0.3], 0.014, 'glow:dock');
  }
  // main processing hall
  const hz = -0.55;
  r.box(M.concreteLight, 1.25, 0.72, 1.4, 0, y0 + 0.36, hz, { b: 0.03 });
  r.box(M.team, 1.29, 0.07, 1.44, 0, y0 + 0.71, hz, { b: 0.02 });
  ridges(r, 1.2, 1.3, y0 + 0.74, 0, hz, M.teamDark, 0.1);
  windows(r, 4, 0.1, 0.08, 0.06, [0.0, y0 + 0.58, hz + 0.703]);
  // intake chute over the dock
  r.add(
    prismXY(
      [
        [0.0, 0.18],
        [0.38, 0.38],
        [0.38, 0.5],
        [0.0, 0.5],
      ],
      0.6,
      0.02,
    ),
    M.team,
    { p: [0, y0, hz + 0.68], r: [0, -Math.PI / 2, 0] },
  );
  r.box(M.darker, 0.5, 0.26, 0.02, 0, y0 + 0.2, hz + 0.705, { b: 0 });
  r.box(G.fire, 0.42, 0.04, 0.01, 0, y0 + 0.1, hz + 0.715, { b: 0, slot: 'glow:proc' });
  hazard(r, 0.62, 0.05, [0, y0 + 0.36, hz + 0.72]);
  // conveyor rollers
  for (let i = 0; i < 5; i++) r.cyl(M.steel, 0.02, 0.02, 0.4, 0, y0 + 0.05, hz + 0.75 + i * 0.07, { r: [0, 0, Math.PI / 2], seg: 8 });
  // silos (left)
  for (const [i, z] of [
    [0, -0.95],
    [1, -0.28],
  ] as const) {
    const x = -1.05;
    r.cyl(M.offwhite, 0.28, 0.28, 1.05, x, y0 + 0.55, z, { seg: 20 });
    r.add(lathe([[0.28, 0], [0.24, 0.1], [0.12, 0.17], [0.0, 0.18]], 20), M.team, { p: [x, y0 + 1.07, z] });
    r.add(ringGeo(0.28, 0.3, 0.05, 20), M.team, { p: [x, y0 + 0.35 + i * 0.1, z] });
    r.add(ringGeo(0.28, 0.295, 0.025, 20), M.dark, { p: [x, y0 + 0.8, z] });
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.4;
      r.box(M.dark, 0.035, 0.06, 0.035, x + Math.cos(a) * 0.27, y0 + 0.03, z + Math.sin(a) * 0.27, { b: 0 });
    }
    ladder(r, 1.0, [x + 0.25, y0, z + 0.13], 1.0);
    pipe(r, [x + 0.25, y0 + 0.95, z], [-0.62, y0 + 0.62, z * 0.6 - 0.2], 0.03, M.steel);
  }
  // processing tower + stack (right back)
  r.box(M.concrete, 0.55, 0.95, 0.6, 1.0, y0 + 0.475, -0.85, { b: 0.02 });
  r.box(M.team, 0.58, 0.05, 0.63, 1.0, y0 + 0.95, -0.85, { b: 0.012 });
  stack(r, 'smoke0', 1.12, -0.95, y0 + 0.95, 0.32, 0.08, 0.06);
  r.box(G.fire, 0.3, 0.05, 0.01, 1.0, y0 + 0.6, -0.546, { b: 0, slot: 'glow:proc' });
  r.box(G.fire, 0.3, 0.05, 0.01, 1.0, y0 + 0.45, -0.546, { b: 0, slot: 'glow:proc' });
  // control room (right front)
  r.box(M.concreteLight, 0.55, 0.36, 0.6, 1.0, y0 + 0.18, 0.35, { b: 0.02 });
  r.box(M.team, 0.58, 0.04, 0.63, 1.0, y0 + 0.37, 0.35, { b: 0.012 });
  windows(r, 3, 0.1, 0.08, 0.05, [1.0, y0 + 0.24, 0.652]);
  r.box(M.darker, 0.14, 0.18, 0.02, 0.8, y0 + 0.09, 0.652, { b: 0 });
  vent(r, 1.05, y0 + 0.39, 0.28, 0.06);
  // ore storage pile (left front)
  orePile(r, -0.95, y0, 0.75, 0.32, 0.14, 11);
  r.box(M.concreteDark, 0.75, 0.08, 0.04, -0.95, y0 + 0.04, 1.1, { b: 0.01 });
  beacon(r, [-1.05, y0 + 1.25, -0.95]);
  beacon(r, [0.82, y0 + 0.97, -0.62]);

  return makeTemplate({
    root: r,
    height: 1.3,
    radius: 1.55,
    muzzles: [],
    smoke: ['smoke0'],
    glow: { glow: 1.6, 'glow:proc': 4, 'glow:dock': 3, 'glow:blink': 5 },
    anim: sAnim((c, s, pw) => {
      const active = s.harvesting || s.load > 0.05;
      const flick = 0.6 + 0.4 * Math.sin(s.time * 9 + c.v.seed) * Math.sin(s.time * 3.1);
      c.setGlow('glow:proc', s.powered ? (active ? 0.6 + 0.4 * flick : 0.3) : 0.08);
      // dock guide lights chase while receiving
      c.setGlow('glow:dock', s.powered ? (s.harvesting ? (blink(s.time, 0.5, 0.5) ? 1 : 0.2) : 0.5) : 0.05);
    }),
  });
}

// =============================================================================================
// Ore silo (1x1)
// =============================================================================================

function oreSilo(): ModelTemplate {
  const r = root(1, 1);
  const y0 = 0.04;
  r.cyl(M.concreteDark, 0.38, 0.4, 0.06, 0, y0 + 0.03, 0, { seg: 20 });
  r.cyl(M.offwhite, 0.32, 0.32, 0.46, 0, y0 + 0.29, 0, { seg: 20 });
  r.add(lathe([[0.32, 0], [0.28, 0.09], [0.16, 0.16], [0.0, 0.18]], 20), M.team, { p: [0, y0 + 0.52, 0] });
  r.add(ringGeo(0.32, 0.34, 0.05, 20), M.team, { p: [0, y0 + 0.2, 0] });
  r.add(ringGeo(0.32, 0.335, 0.025, 20), M.dark, { p: [0, y0 + 0.42, 0] });
  // ore level gauge on the front
  r.box(M.dark, 0.06, 0.32, 0.03, 0, y0 + 0.31, 0.32, { b: 0.006 });
  const gauge = r.node('gauge', [0, y0 + 0.16, 0.336]);
  gauge.box(G.amber, 0.035, 0.3, 0.006, 0, 0.15, 0, { b: 0, slot: 'glow:gauge' });
  ladder(r, 0.6, [0.23, y0, -0.23], -Math.PI * 0.75);
  pipe(r, [0, y0 + 0.69, 0], [0, y0 + 0.75, 0], 0.03, M.steel);
  r.cyl(M.gun, 0.05, 0.05, 0.03, 0, y0 + 0.77, 0, { seg: 10 });
  pipe(r, [-0.3, y0 + 0.12, 0.12], [-0.45, y0 + 0.12, 0.12], 0.03, M.steel);

  return makeTemplate({
    root: r,
    height: 0.82,
    radius: 0.5,
    muzzles: [],
    glow: { glow: 1.6, 'glow:gauge': 2.5 },
    anim: sAnim((c, s) => {
      const l = Math.min(1, Math.max(0, s.load));
      c.n.gauge.scale.y = Math.max(0.02, l);
      c.setGlow('glow:gauge', s.powered ? 1 : 0.2);
    }),
  });
}

// =============================================================================================
// Allied barracks (2x2) — quonset hut
// =============================================================================================

function alliedBarracks(): ModelTemplate {
  const r = root(2, 2);
  const y0 = 0.04;
  const R = 0.5;
  const L = 1.25;
  const hz = -0.15;
  // corrugated half-cylinder along Z
  const hut = new THREE.CylinderGeometry(R, R, L, 20, 1, true, -Math.PI / 2, Math.PI);
  r.add(hut, M.oliveDark, { p: [0, y0, hz], r: [-Math.PI / 2, 0, 0] });
  for (let i = 0; i < 9; i++) {
    const z = hz - L / 2 + 0.06 + i * ((L - 0.12) / 8);
    r.add(new THREE.CylinderGeometry(R + 0.008, R + 0.008, 0.025, 20, 1, true, -Math.PI / 2, Math.PI), M.olive, {
      p: [0, y0, z],
      r: [-Math.PI / 2, 0, 0],
    });
  }
  // team stripe along the ridge
  r.add(new THREE.CylinderGeometry(R + 0.012, R + 0.012, L * 0.98, 12, 1, true, -0.25, 0.5), M.team, {
    p: [0, y0, hz],
    r: [-Math.PI / 2, 0, 0],
  });
  alliedStar(r, 0.13, [0, y0 + R + 0.014, hz - 0.15]);
  // end walls
  for (const s of [-1, 1]) {
    r.add(new THREE.CircleGeometry(R, 20, 0, Math.PI), M.concreteLight, {
      p: [0, y0, hz + (L / 2) * s],
      r: [0, s > 0 ? 0 : Math.PI, 0],
    });
  }
  const fz = hz + L / 2;
  // door + porch
  r.box(M.team, 0.3, 0.32, 0.03, 0, y0 + 0.16, fz + 0.012, { b: 0.008 });
  r.box(M.darker, 0.22, 0.28, 0.02, 0, y0 + 0.14, fz + 0.022, { b: 0 });
  r.box(M.concreteDark, 0.42, 0.04, 0.16, 0, y0 + 0.02, fz + 0.08, { b: 0.01 });
  r.box(M.teamDark, 0.44, 0.02, 0.18, 0, y0 + 0.36, fz + 0.08, { b: 0.006, r: [0.2, 0, 0] });
  lamp(r, G.warm, [0, y0 + 0.4, fz + 0.03], 0.016);
  windows(r, 2, 0.08, 0.07, 0.36, [0, y0 + 0.24, fz + 0.004]);
  // side windows
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const z = hz - 0.35 + i * 0.35;
      r.box(G.window, 0.012, 0.06, 0.1, 0.43 * s, y0 + 0.25, z, { b: 0, slot: 'glow' });
      r.box(M.dark, 0.016, 0.07, 0.11, 0.425 * s, y0 + 0.25, z, { b: 0 });
    }
  }
  // sandbags + flagpole + crates
  sandbags(r, 0.5, 2, [-0.62, y0, 0.78]);
  sandbags(r, 0.5, 2, [0.62, y0, 0.78]);
  sandbags(r, 0.5, 2, [-0.85, y0, 0.45], [0, Math.PI / 2, 0]);
  r.cyl(M.steel, 0.012, 0.014, 0.9, 0.75, y0 + 0.45, -0.75, { seg: 8 });
  r.sph(M.brass, 0.018, 0.75, y0 + 0.91, -0.75, { seg: 8 });
  const flag = r.node('flag', [0.75, y0 + 0.86, -0.75]);
  flag.box(M.team, 0.24, 0.14, 0.006, 0.12, -0.07, 0, { b: 0 });
  flag.add(starGeo(0.035, 0.004), M.white, { p: [0.08, -0.05, 0.004], r: faceRot('+z') });
  crate(r, 0.12, 0.8, y0, 0.2, M.olive, 0.2);
  crate(r, 0.1, 0.8, y0 + 0.12, 0.2, M.wood, 0.5);
  stowage(r, 0.18, 0.08, 0.1, -0.78, y0, -0.2, M.khaki);

  return makeTemplate({
    root: r,
    height: 0.95,
    radius: 1.05,
    muzzles: [],
    glow: { glow: 1.6 },
    anim: sAnim((c, s) => {
      const f = c.n.flag;
      f.rotation.y = Math.sin(s.time * 1.3 + c.v.seed) * 0.25 - 0.3;
    }),
  });
}

// =============================================================================================
// Soviet barracks (2x2) — concrete bunker
// =============================================================================================

function sovietBarracks(): ModelTemplate {
  const r = root(2, 2);
  const y0 = 0.04;
  // sloped bunker body
  r.add(
    prismXZ(
      [
        [-0.72, -0.62],
        [0.72, -0.62],
        [0.8, -0.5],
        [0.8, 0.42],
        [0.68, 0.55],
        [-0.68, 0.55],
        [-0.8, 0.42],
        [-0.8, -0.5],
      ],
      0.42,
      0.04,
    ),
    M.concrete,
    { p: [0, y0, -0.05] },
  );
  r.add(
    prismXZ(
      [
        [-0.62, -0.52],
        [0.62, -0.52],
        [0.7, -0.42],
        [0.7, 0.34],
        [0.6, 0.45],
        [-0.6, 0.45],
        [-0.7, 0.34],
        [-0.7, -0.42],
      ],
      0.08,
      0.02,
    ),
    M.team,
    { p: [0, y0 + 0.42, -0.05] },
  );
  r.box(M.concreteDark, 1.2, 0.02, 0.8, 0, y0 + 0.5, -0.07, { b: 0.006 });
  sovietStar(r, 0.22, [0.05, y0 + 0.51, -0.04]);
  // roof details
  r.box(M.concreteDark, 0.26, 0.12, 0.22, -0.52, y0 + 0.56, -0.38, { b: 0.02 });
  r.box(M.darker, 0.22, 0.025, 0.01, -0.52, y0 + 0.59, -0.265, { b: 0 });
  vent(r, 0.55, y0 + 0.5, -0.38, 0.06);
  antenna(r, 0.6, y0 + 0.5, 0.25, 0.4);
  // front facade: heavy door + big red star
  const fz = 0.5;
  r.box(M.concreteDark, 0.42, 0.36, 0.08, 0, y0 + 0.18, fz + 0.02, { b: 0.02 });
  r.box(M.teamDark, 0.28, 0.3, 0.03, 0, y0 + 0.15, fz + 0.065, { b: 0.008 });
  for (let i = 0; i < 4; i++) r.box(M.dark, 0.012, 0.28, 0.01, -0.09 + i * 0.06, y0 + 0.15, fz + 0.082, { b: 0 });
  lamp(r, G.warm, [0, y0 + 0.36, fz + 0.075], 0.016);
  // gun slits glowing
  for (const x of [-0.5, -0.28, 0.28, 0.5]) {
    r.box(M.darker, 0.14, 0.035, 0.02, x, y0 + 0.3, fz + 0.01, { b: 0 });
    r.box(G.window, 0.12, 0.02, 0.01, x, y0 + 0.3, fz + 0.018, { b: 0, slot: 'glow' });
  }
  for (const s of [-1, 1]) {
    r.box(M.darker, 0.02, 0.035, 0.14, 0.79 * s, y0 + 0.3, 0.0, { b: 0 });
    r.box(G.window, 0.01, 0.02, 0.12, 0.8 * s, y0 + 0.3, 0.0, { b: 0, slot: 'glow' });
  }
  sandbags(r, 0.45, 2, [-0.6, y0, 0.78]);
  sandbags(r, 0.45, 2, [0.6, y0, 0.78]);
  r.cyl(M.oliveDark, 0.05, 0.05, 0.12, 0.75, y0 + 0.06, 0.72, { seg: 12 });
  r.cyl(M.oliveDark, 0.05, 0.05, 0.12, 0.86, y0 + 0.06, 0.62, { seg: 12 });
  beacon(r, [-0.62, y0 + 0.5, -0.5]);

  return makeTemplate({
    root: r,
    height: 0.75,
    radius: 1.05,
    muzzles: [],
    glow: { glow: 1.8, 'glow:blink': 5 },
    anim: sAnim(),
  });
}

// =============================================================================================
// Kennel (1x1)
// =============================================================================================

function kennel(): ModelTemplate {
  const r = root(1, 1, M.concreteDark);
  const y0 = 0.04;
  const kz = -0.06;
  // fenced run (front)
  r.box(M.sand, 0.84, 0.012, 0.32, 0, y0 + 0.006, 0.26, { b: 0 });
  for (let i = 0; i < 6; i++) r.box(M.wood, 0.022, 0.12, 0.022, -0.4 + i * 0.16, y0 + 0.06, 0.42, { b: 0.005 });
  r.box(M.wood, 0.84, 0.018, 0.014, 0, y0 + 0.1, 0.42, { b: 0.003 });
  r.box(M.wood, 0.84, 0.018, 0.014, 0, y0 + 0.05, 0.42, { b: 0.003 });
  // doghouse: plank walls, gable facing +Z
  r.box(M.wood, 0.5, 0.26, 0.5, 0, y0 + 0.13, kz, { b: 0.012 });
  for (let i = 0; i < 6; i++) r.box(shade(M.wood, 0x6a4628), 0.505, 0.006, 0.505, 0, y0 + 0.03 + i * 0.04, kz, { b: 0 });
  // front gable triangle
  r.add(
    prismXY(
      [
        [-0.25, 0],
        [0.25, 0],
        [0, 0.18],
      ],
      0.5,
      0,
    ),
    M.wood,
    { p: [0, y0 + 0.26, kz] },
  );
  gableRoof(r, 0.5, 0.5, y0 + 0.255, 0.19, M.team, 0, kz, 0.06, true);
  r.box(M.teamDark, 0.03, 0.03, 0.64, 0, y0 + 0.47, kz, { b: 0.008 });
  // arched door
  r.box(M.darker, 0.17, 0.13, 0.02, 0, y0 + 0.065, kz + 0.251, { b: 0 });
  r.add(new THREE.CircleGeometry(0.085, 12, 0, Math.PI), M.darker, { p: [0, y0 + 0.13, kz + 0.262] });
  r.box(M.teamDark, 0.22, 0.02, 0.025, 0, y0 + 0.24, kz + 0.26, { b: 0.004 });
  sovietStar(r, 0.045, [0, y0 + 0.33, kz + 0.256], faceRot('+z'));
  // bowl, bone, chain stake
  r.cyl(M.steel, 0.04, 0.03, 0.025, 0.24, y0 + 0.012, 0.28, { seg: 12 });
  r.cyl(M.red, 0.032, 0.032, 0.004, 0.24, y0 + 0.024, 0.28, { seg: 12 });
  r.box(M.offwhite, 0.08, 0.015, 0.015, -0.22, y0 + 0.008, 0.3, { b: 0.006, r: [0, 0.5, 0] });
  r.sph(M.offwhite, 0.012, -0.255, y0 + 0.01, 0.32, { seg: 6 });
  r.sph(M.offwhite, 0.012, -0.185, y0 + 0.01, 0.28, { seg: 6 });
  lamp(r, G.warm, [0.2, y0 + 0.22, kz + 0.26], 0.014);
  // food sacks at the side
  r.box(M.khaki, 0.1, 0.1, 0.12, 0.36, y0 + 0.05, kz - 0.1, { b: 0.03 });

  return makeTemplate({ root: r, height: 0.55, radius: 0.5, muzzles: [], glow: { glow: 1.6 }, anim: sAnim() });
}

// =============================================================================================
// War factory (3x3) — big door on +Z animated by state.door
// =============================================================================================

function warFactory(): ModelTemplate {
  const r = root(3, 3);
  const y0 = 0.04;
  const hz = -0.32;
  const hd = 2.1;
  const hw = 2.7;
  const hh = 0.82;
  const fz = hz + hd / 2;
  // apron in front of the door
  r.box(M.asphalt, 1.1, 0.012, 0.65, 0, y0 + 0.006, fz + 0.33, { b: 0 });
  for (let i = 0; i < 3; i++) {
    r.add(
      prismXZ(
        [
          [-0.25, 0.0],
          [0.0, -0.1],
          [0.25, 0.0],
          [0.25, 0.05],
          [0.0, -0.05],
          [-0.25, 0.05],
        ],
        0.004,
        0,
      ),
      M.yellow,
      { p: [0, y0 + 0.012, fz + 0.2 + i * 0.15] },
    );
  }
  // hall walls: rear block + front section with a recessed vehicle bay
  const bayD = 0.55;
  const dw0 = 1.15;
  const dh0 = 0.68;
  const rearD = hd - bayD;
  r.box(M.concreteLight, hw, hh, rearD, 0, y0 + hh / 2, hz - hd / 2 + rearD / 2, { b: 0.03 });
  const sideW = (hw - dw0) / 2;
  for (const sx of [-1, 1]) {
    r.box(M.concreteLight, sideW, hh, bayD + 0.02, sx * (dw0 / 2 + sideW / 2), y0 + hh / 2, fz - bayD / 2, { b: 0.025 });
  }
  r.box(M.concreteLight, dw0 + 0.02, hh - dh0, bayD + 0.02, 0, y0 + dh0 + (hh - dh0) / 2, fz - bayD / 2, { b: 0.02 });
  r.box(M.team, hw + 0.04, 0.08, hd + 0.04, 0, y0 + hh - 0.02, hz, { b: 0.02 });
  // arched roof segments
  for (let i = 0; i < 3; i++) {
    const x = -hw / 2 + hw / 6 + (i * hw) / 3;
    r.add(new THREE.CylinderGeometry(0.44, 0.44, hd - 0.04, 16, 1, false, -Math.PI / 2, Math.PI), M.team, {
      p: [x, y0 + hh - 0.02, hz],
      r: [-Math.PI / 2, 0, 0],
      s: [1, 1, 0.5],
    });
    r.box(M.teamDark, 0.03, 0.2, hd - 0.02, x + hw / 6, y0 + hh + 0.05, hz, { b: 0.008 });
    // skylight strip along the crown + ribs
    r.box(M.glassBlue, 0.16, 0.02, hd - 0.3, x, y0 + hh + 0.205, hz, { b: 0.006 });
    for (let k = 0; k < 6; k++) r.box(M.gun, 0.18, 0.025, 0.02, x, y0 + hh + 0.205, hz - hd / 2 + 0.25 + k * ((hd - 0.5) / 5), { b: 0.004 });
  }
  // roof vents & stack
  vent(r, -0.9, y0 + hh + 0.16, hz - 0.5, 0.08);
  vent(r, 0.9, y0 + hh + 0.16, hz - 0.5, 0.08);
  stack(r, 'smoke0', 1.05, hz - 0.8, y0 + hh, 0.4, 0.07, 0.055);
  // facade frame around the door
  const dw = 1.15;
  const dh = 0.68;
  r.box(M.teamDark, dw + 0.16, 0.12, 0.08, 0, y0 + dh + 0.06, fz + 0.03, { b: 0.015 });
  r.box(M.teamDark, 0.08, dh, 0.08, -dw / 2 - 0.04, y0 + dh / 2, fz + 0.03, { b: 0.015 });
  r.box(M.teamDark, 0.08, dh, 0.08, dw / 2 + 0.04, y0 + dh / 2, fz + 0.03, { b: 0.015 });
  hazard(r, dw + 0.16, 0.04, [0, y0 + dh + 0.06, fz + 0.072]);
  hazard(r, dh, 0.05, [-dw / 2 - 0.04, y0 + dh / 2, fz + 0.072], [0, 0, Math.PI / 2]);
  hazard(r, dh, 0.05, [dw / 2 + 0.04, y0 + dh / 2, fz + 0.072], [0, 0, Math.PI / 2]);
  // interior (dark bay with lights, gantry and a work light)
  const bz = fz - bayD;
  r.box(M.darker, dw, dh, 0.02, 0, y0 + dh / 2, bz + 0.011, { b: 0 });
  r.box(M.dark, dw, 0.012, bayD, 0, y0 + 0.006, fz - bayD / 2, { b: 0 });
  for (let i = 0; i < 2; i++) r.box(M.yellow, 0.03, 0.004, bayD - 0.05, -0.2 + i * 0.4, y0 + 0.014, fz - bayD / 2, { b: 0 });
  r.box(M.gun, 0.012, dh, bayD, -dw / 2 + 0.006, y0 + dh / 2, fz - bayD / 2, { b: 0 });
  r.box(M.gun, 0.012, dh, bayD, dw / 2 - 0.006, y0 + dh / 2, fz - bayD / 2, { b: 0 });
  r.box(M.yellow, dw - 0.04, 0.04, 0.05, 0, y0 + dh - 0.07, fz - bayD + 0.12, { b: 0.006 });
  r.box(M.dark, 0.06, 0.08, 0.06, 0.15, y0 + dh - 0.12, fz - bayD + 0.12, { b: 0.006 });
  for (const x of [-0.35, 0, 0.35]) r.box(G.warm, 0.16, 0.008, 0.05, x, y0 + dh - 0.008, fz - bayD / 2, { b: 0, slot: 'glow' });
  r.box(G.warm, 0.6, 0.05, 0.004, 0, y0 + dh - 0.12, bz + 0.023, { b: 0, slot: 'glow' });
  // the door (rolls up into the lintel)
  const door = r.node('door', [0, y0 + dh, fz + 0.01]);
  door.box(M.teamDark, dw, dh, 0.025, 0, -dh / 2, 0, { b: 0.004 });
  for (let i = 0; i < 9; i++) door.box(M.gun, dw - 0.02, 0.012, 0.03, 0, -0.04 - i * 0.075, 0, { b: 0 });
  door.box(M.yellow, dw, 0.03, 0.03, 0, -dh + 0.015, 0, { b: 0 });
  // office wings with windows
  windows(r, 3, 0.1, 0.08, 0.05, [-1.0, y0 + 0.55, fz + 0.016]);
  windows(r, 3, 0.1, 0.08, 0.05, [-1.0, y0 + 0.38, fz + 0.016], [0, 0, 0], G.window, 'glow', [1]);
  windows(r, 3, 0.1, 0.08, 0.05, [1.0, y0 + 0.55, fz + 0.016], [0, 0, 0], G.window, 'glow', [0, 2]);
  r.box(M.darker, 0.16, 0.26, 0.02, 1.0, y0 + 0.13, fz + 0.017, { b: 0 });
  lamp(r, G.warm, [1.0, y0 + 0.3, fz + 0.04], 0.016);
  sovietStarOrAllied(r, 0.13, [-1.0, y0 + 0.2, fz + 0.024]);
  // door beacons
  lamp(r, G.amber, [-dw / 2 - 0.04, y0 + dh + 0.15, fz + 0.06], 0.022, 'glow:door');
  lamp(r, G.amber, [dw / 2 + 0.04, y0 + dh + 0.15, fz + 0.06], 0.022, 'glow:door');
  // side buttresses
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) r.box(M.concrete, 0.06, hh - 0.1, 0.1, (hw / 2 + 0.02) * s, y0 + (hh - 0.1) / 2, hz - 0.8 + i * 0.5, { b: 0.01 });
  }

  return makeTemplate({
    root: r,
    height: 1.25,
    radius: 1.55,
    muzzles: [],
    smoke: ['smoke0'],
    glow: { glow: 1.6, 'glow:door': 4 },
    anim: sAnim((c, s) => {
      const d = Math.min(1, Math.max(0, s.door));
      c.n.door.scale.y = Math.max(0.04, 1 - d * 0.96);
      const moving = d > 0.02 && d < 0.98;
      c.setGlow('glow:door', s.powered ? (moving || d > 0.5 ? (blink(s.time, 0.5, 0.5) ? 1 : 0.15) : 0.15) : 0.05);
    }),
  });
}

// =============================================================================================
// Radar dome (2x2)
// =============================================================================================

function radarDome(): ModelTemplate {
  const r = root(2, 2);
  const y0 = 0.04;
  // base building
  r.add(
    prismXZ(
      [
        [-0.7, -0.7],
        [0.7, -0.7],
        [0.75, -0.6],
        [0.75, 0.62],
        [0.65, 0.72],
        [-0.65, 0.72],
        [-0.75, 0.62],
        [-0.75, -0.6],
      ],
      0.36,
      0.03,
    ),
    M.concrete,
    { p: [0, y0, -0.02] },
  );
  r.box(M.team, 1.46, 0.05, 1.4, 0, y0 + 0.36, -0.02, { b: 0.015 });
  windows(r, 5, 0.1, 0.08, 0.06, [0, y0 + 0.2, 0.705]);
  r.box(M.darker, 0.18, 0.24, 0.02, 0.5, y0 + 0.12, 0.705, { b: 0 });
  // dome ring + geodesic radome
  r.cyl(M.concreteLight, 0.52, 0.56, 0.12, -0.05, y0 + 0.44, -0.08, { seg: 24 });
  const dome = new THREE.IcosahedronGeometry(0.5, 2);
  dome.computeVertexNormals(); // non-indexed -> flat facets (geodesic look)
  r.add(dome, M.white, { p: [-0.05, y0 + 0.6, -0.08] });
  r.add(ringGeo(0.5, 0.53, 0.035, 24), M.team, { p: [-0.05, y0 + 0.62, -0.08] });
  ladder(r, 0.36, [0.76, y0, 0.2], Math.PI / 2);
  // side equipment
  r.box(M.gun, 0.2, 0.14, 0.24, 0.55, y0 + 0.43, 0.42, { b: 0.012 });
  grille(r, 0.16, 0.2, [0.55, y0 + 0.502, 0.42], 5);
  antenna(r, -0.6, y0 + 0.38, 0.5, 0.35);
  antenna(r, 0.62, y0 + 0.38, -0.55, 0.45);
  // rotating dish on top of the dome
  const dish = r.node('dish', [-0.05, y0 + 1.1, -0.08]);
  dish.cyl(M.gun, 0.03, 0.04, 0.08, 0, 0.0, 0, { seg: 10 });
  const d2 = new NB('_d', [0.02, 0.1, 0], [0, 0, 1.15]);
  d2.add(lathe([[0.0, 0.0], [0.08, 0.012], [0.15, 0.04], [0.19, 0.075]], 18), M.offwhite);
  d2.cyl(M.dark, 0.006, 0.006, 0.14, 0, 0.07, 0, { seg: 6 });
  d2.sph(M.gun, 0.016, 0, 0.14, 0, { seg: 8 });
  dish.box(M.gun, 0.06, 0.03, 0.03, 0.0, 0.05, 0, { b: 0.006 });
  mergeChild(dish, d2);
  dish.sph(G.red, 0.014, -0.06, 0.06, 0, { seg: 6, slot: 'glow:blink' });

  return makeTemplate({
    root: r,
    height: 1.35,
    radius: 1.05,
    muzzles: [],
    glow: { glow: 1.6, 'glow:blink': 5 },
    anim: sAnim((c, s) => {
      if (s.powered) c.n.dish.rotation.y += dtOf(s) * 1.1;
    }),
  });
}

// =============================================================================================
// Service depot (3x3) — pad in the centre cell
// =============================================================================================

function serviceDepot(): ModelTemplate {
  const r = root(3, 3);
  const y0 = 0.04;
  // central octagonal pad (drivable, low)
  const oct: [number, number][] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    oct.push([Math.cos(a) * 0.62, Math.sin(a) * 0.62]);
  }
  r.add(prismXZ(oct, 0.05, 0.015), M.gun, { p: [0, y0, 0] });
  const oct2 = oct.map(([x, z]) => [x * 0.86, z * 0.86] as [number, number]);
  r.add(prismXZ(oct2, 0.008, 0), M.dark, { p: [0, y0 + 0.05, 0] });
  // pad markings: wrench cross
  r.box(M.yellow, 0.5, 0.004, 0.06, 0, y0 + 0.06, 0, { b: 0, r: [0, Math.PI / 4, 0] });
  r.box(M.yellow, 0.5, 0.004, 0.06, 0, y0 + 0.06, 0, { b: 0, r: [0, -Math.PI / 4, 0] });
  r.add(ringGeo(0.4, 0.45, 0.004, 24), M.yellow, { p: [0, y0 + 0.06, 0] });
  // pad edge lights
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    r.sph(G.green, 0.016, Math.cos(a) * 0.58, y0 + 0.058, Math.sin(a) * 0.58, { seg: 6, slot: 'glow:pad' });
  }
  // back wall/workshop
  r.box(M.concreteLight, 2.6, 0.42, 0.45, 0, y0 + 0.21, -1.12, { b: 0.025 });
  r.box(M.team, 2.64, 0.05, 0.49, 0, y0 + 0.42, -1.12, { b: 0.015 });
  windows(r, 6, 0.1, 0.08, 0.12, [0, y0 + 0.28, -0.893]);
  ridges(r, 2.55, 0.42, y0 + 0.44, 0, -1.12, M.teamDark, 0.1);
  // side bays
  for (const s of [-1, 1]) {
    r.box(M.concrete, 0.4, 0.3, 1.1, 1.1 * s, y0 + 0.15, -0.35, { b: 0.02 });
    r.box(M.team, 0.43, 0.04, 1.13, 1.1 * s, y0 + 0.31, -0.35, { b: 0.012 });
    hazard(r, 1.0, 0.04, [(1.1 - 0.2) * s - 0.006 * s, y0 + 0.24, -0.35], [0, (Math.PI / 2) * -s, 0]);
    r.box(M.darker, 0.02, 0.2, 0.3, (1.1 - 0.2) * s - 0.003 * s, y0 + 0.1, -0.1, { b: 0 });
  }
  // repair arms on 4 posts around the pad
  const posts: [number, number][] = [
    [-0.78, -0.62],
    [0.78, -0.62],
    [-0.78, 0.7],
    [0.78, 0.7],
  ];
  posts.forEach(([x, z]) => {
    r.cyl(M.gun, 0.06, 0.07, 0.08, x, y0 + 0.04, z, { seg: 10 });
    r.cyl(M.yellow, 0.03, 0.035, 0.42, x, y0 + 0.29, z, { seg: 10 });
    const a = new NB('_arm', [x, y0 + 0.5, z], [0, Math.atan2(-z, x) + Math.PI, 0]);
    a.box(M.yellow, 0.06, 0.06, 0.06, 0, 0, 0, { b: 0.012 });
    a.box(M.yellow, 0.42, 0.035, 0.035, 0.21, 0.02, 0, { b: 0.008, r: [0, 0, -0.35] });
    a.box(M.yellow, 0.2, 0.03, 0.03, 0.43, -0.07, 0, { b: 0.008, r: [0, 0, -1.0] });
    a.box(M.dark, 0.04, 0.05, 0.04, 0.5, -0.17, 0, { b: 0.008 });
    a.cyl(M.dark, 0.008, 0.008, 0.2, 0.2, -0.05, 0.03, { r: [0, 0, 1.2], seg: 5 });
    a.sph(G.cyan, 0.014, 0.5, -0.2, 0, { seg: 6, slot: 'glow:weld' });
    mergeChild(r, a);
  });
  // tools / barrels
  r.cyl(M.red, 0.05, 0.05, 0.13, -1.2, y0 + 0.065, 0.95, { seg: 12 });
  r.cyl(M.yellow, 0.05, 0.05, 0.13, -1.08, y0 + 0.065, 1.05, { seg: 12 });
  crate(r, 0.14, 1.15, y0, 1.0, M.olive, 0.3);
  beacon(r, [1.2, y0 + 0.44, -1.2], G.amber);
  beacon(r, [-1.2, y0 + 0.44, -1.2], G.amber);

  return makeTemplate({
    root: r,
    height: 0.75,
    radius: 1.55,
    muzzles: [],
    glow: { glow: 1.6, 'glow:pad': 3, 'glow:weld': 6, 'glow:blink': 5 },
    anim: sAnim((c, s) => {
      const t = s.time;
      const busy = s.load > 0.05 || s.harvesting;
      c.setGlow('glow:pad', s.powered ? (busy ? (blink(t, 0.6, 0.5) ? 1 : 0.3) : 0.7) : 0.05);
      c.setGlow('glow:weld', s.powered && busy ? (Math.sin(t * 37) > 0.2 ? 1 : 0.1) : 0);
    }),
  });
}

// =============================================================================================
// Allied tech center (2x2)
// =============================================================================================

function alliedTech(): ModelTemplate {
  const r = root(2, 2);
  const y0 = 0.04;
  // stepped modern block
  r.box(M.concreteLight, 1.6, 0.4, 1.3, 0, y0 + 0.2, -0.15, { b: 0.025 });
  r.box(M.team, 1.64, 0.05, 1.34, 0, y0 + 0.4, -0.15, { b: 0.015 });
  r.box(M.offwhite, 1.0, 0.32, 0.8, -0.2, y0 + 0.58, -0.3, { b: 0.025 });
  r.box(M.team, 1.04, 0.04, 0.84, -0.2, y0 + 0.75, -0.3, { b: 0.012 });
  // glass curtain walls
  r.box(M.glassBlue, 1.4, 0.24, 0.02, 0, y0 + 0.2, 0.502, { b: 0 });
  for (let i = 0; i < 8; i++) r.box(M.steel, 0.012, 0.26, 0.03, -0.7 + i * 0.2, y0 + 0.2, 0.505, { b: 0 });
  windows(r, 7, 0.16, 0.05, 0.04, [0, y0 + 0.24, 0.515], [0, 0, 0], G.cyan, 'glow', [0, 1, 3, 4, 6]);
  windows(r, 4, 0.18, 0.12, 0.05, [-0.2, y0 + 0.6, 0.102], [0, 0, 0], G.cyan, 'glow', [0, 2, 3]);
  r.box(M.darker, 0.24, 0.22, 0.02, 0.55, y0 + 0.11, 0.525, { b: 0 });
  // observatory dome
  r.cyl(M.offwhite, 0.25, 0.25, 0.08, 0.5, y0 + 0.44, -0.45, { seg: 20 });
  r.add(new THREE.SphereGeometry(0.25, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.white, { p: [0.5, y0 + 0.48, -0.45] });
  r.box(M.dark, 0.06, 0.02, 0.3, 0.5, y0 + 0.66, -0.45, { b: 0.004, r: [0.7, 0, 0] });
  // rotating satellite dish
  const dish = r.node('dish', [-0.5, y0 + 0.77, -0.45]);
  dish.cyl(M.gun, 0.02, 0.03, 0.12, 0, 0.06, 0, { seg: 8 });
  dish.add(lathe([[0.0, 0.0], [0.07, 0.01], [0.13, 0.035], [0.16, 0.06]], 16), M.white, { p: [0.03, 0.14, 0], r: [0, 0, 1.0] });
  dish.cyl(M.dark, 0.005, 0.005, 0.12, 0.06, 0.18, 0, { r: [0, 0, 1.0], seg: 5 });
  // antenna array
  for (let i = 0; i < 3; i++) antenna(r, 0.1 + i * 0.12, y0 + 0.77, -0.1, 0.25 + i * 0.07);
  alliedStar(r, 0.12, [-0.2, y0 + 0.772, -0.3]);
  beacon(r, [0.3, y0 + 0.77, -0.65]);

  return makeTemplate({
    root: r,
    height: 1.05,
    radius: 1.05,
    muzzles: [],
    glow: { glow: 1.8, 'glow:blink': 5 },
    anim: sAnim((c, s) => {
      if (s.powered) c.n.dish.rotation.y = Math.sin(s.time * 0.3 + c.v.seed) * 1.6;
    }),
  });
}

// =============================================================================================
// Soviet tech center (3x3)
// =============================================================================================

function sovietTech(): ModelTemplate {
  const r = root(3, 3);
  const y0 = 0.04;
  const oct = (w: number, d: number, c: number): [number, number][] => [
    [-w + c, -d],
    [w - c, -d],
    [w, -d + c],
    [w, d - c],
    [w - c, d],
    [-w + c, d],
    [-w, d - c],
    [-w, -d + c],
  ];
  // main brutalist block (concrete) with team trim and a dark roof
  r.add(prismXZ(oct(1.35, 0.85, 0.12), 0.46, 0.04), M.concrete, { p: [0, y0, -0.35] });
  r.add(prismXZ(oct(1.3, 0.8, 0.1), 0.05, 0.015), M.team, { p: [0, y0 + 0.44, -0.35] });
  r.add(prismXZ(oct(1.22, 0.72, 0.08), 0.02, 0.006), M.concreteDark, { p: [0, y0 + 0.48, -0.35] });
  // stepped central tower with spire and glowing star
  const tz = -0.5;
  r.add(prismXZ(oct(0.42, 0.36, 0.08), 0.42, 0.03), M.concreteLight, { p: [0, y0 + 0.48, tz] });
  r.add(prismXZ(oct(0.45, 0.39, 0.09), 0.05, 0.015), M.team, { p: [0, y0 + 0.88, tz] });
  r.add(prismXZ(oct(0.3, 0.26, 0.06), 0.24, 0.02), M.concreteLight, { p: [0, y0 + 0.93, tz] });
  r.add(prismXZ(oct(0.33, 0.29, 0.07), 0.04, 0.012), M.team, { p: [0, y0 + 1.15, tz] });
  r.add(new THREE.ConeGeometry(0.1, 0.32, 8), M.teamDark, { p: [0, y0 + 1.35, tz] });
  r.cyl(M.brass, 0.012, 0.016, 0.12, 0, y0 + 1.55, tz, { seg: 6 });
  const star = r.node('star', [0, y0 + 1.68, tz]);
  star.add(starGeo(0.085, 0.025, 0.45), G.red, { r: faceRot('+z'), slot: 'glow:star' });
  star.add(starGeo(0.1, 0.02, 0.45), M.brass, { p: [0, 0, -0.008], r: faceRot('+z') });
  windows(r, 4, 0.1, 0.1, 0.06, [0, y0 + 0.78, tz + 0.362], [0, 0, 0], G.green, 'glow', [0, 1, 3]);
  windows(r, 4, 0.1, 0.1, 0.06, [0, y0 + 0.6, tz + 0.362], [0, 0, 0], G.green, 'glow', [1, 2]);
  windows(r, 3, 0.09, 0.08, 0.05, [0, y0 + 1.04, tz + 0.262], [0, 0, 0], G.window, 'glow', [0, 2]);
  sovietStar(r, 0.13, [0, y0 + 0.3, 0.505], faceRot('+z'));
  // glass lab dome with glowing core (left)
  const dx = -0.85;
  const dz = -0.45;
  r.cyl(M.concreteDark, 0.36, 0.38, 0.06, dx, y0 + 0.51, dz, { seg: 24 });
  r.add(ringGeo(0.34, 0.37, 0.05, 24), M.team, { p: [dx, y0 + 0.56, dz] });
  r.sph(G.green, 0.13, dx, y0 + 0.66, dz, { seg: 14, slot: 'glow:core' });
  r.cyl(M.dark, 0.05, 0.08, 0.1, dx, y0 + 0.57, dz, { seg: 10 });
  r.add(new THREE.SphereGeometry(0.33, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), shade(M.glassBlue, 0x3a7a6a), { p: [dx, y0 + 0.56, dz] });
  for (let i = 0; i < 6; i++) {
    r.add(new THREE.TorusGeometry(0.332, 0.008, 4, 24, Math.PI), M.gun, { p: [dx, y0 + 0.56, dz], r: [0, (i * Math.PI) / 6, 0] });
  }
  // radio masts (right)
  for (const [x, z, h] of [
    [0.98, -0.8, 0.75],
    [0.72, -0.25, 0.5],
  ]) {
    r.cyl(M.dark, 0.012, 0.025, h, x, y0 + 0.5 + h / 2, z, { seg: 6 });
    for (let k = 1; k < 4; k++) r.box(M.dark, 0.12 - k * 0.025, 0.008, 0.008, x, y0 + 0.5 + (h * k) / 4, z, { b: 0 });
    r.sph(G.red, 0.016, x, y0 + 0.5 + h + 0.01, z, { seg: 6, slot: 'glow:blink' });
  }
  // roof hardware
  vent(r, 0.5, y0 + 0.5, -0.9, 0.08);
  grille(r, 0.36, 0.22, [0.62, y0 + 0.505, 0.1], 7);
  r.box(M.gun, 0.3, 0.1, 0.18, -0.55, y0 + 0.55, 0.2, { b: 0.015 });
  pipe(r, [-0.4, y0 + 0.56, 0.2], [-0.2, y0 + 0.56, 0.2], 0.03, M.steel);
  // front: laboratory windows + entrance
  windows(r, 5, 0.12, 0.08, 0.08, [-0.72, y0 + 0.32, 0.506], [0, 0, 0], G.window, 'glow', [0, 2, 3]);
  windows(r, 5, 0.12, 0.08, 0.08, [0.72, y0 + 0.32, 0.506], [0, 0, 0], G.green, 'glow', [0, 1, 3, 4]);
  r.box(M.teamDark, 0.36, 0.2, 0.06, 0.0, y0 + 0.1, 0.53, { b: 0.01 });
  r.box(M.darker, 0.26, 0.17, 0.02, 0.0, y0 + 0.085, 0.555, { b: 0 });
  lamp(r, G.warm, [0, y0 + 0.215, 0.565], 0.014);
  // front yard: gas tanks
  for (const x of [-1.0, -0.72]) {
    r.cyl(M.offwhite, 0.1, 0.1, 0.32, x, y0 + 0.16, 0.95, { seg: 14 });
    r.sph(M.offwhite, 0.1, x, y0 + 0.32, 0.95, { seg: 14 });
    r.add(ringGeo(0.1, 0.11, 0.03, 14), M.team, { p: [x, y0 + 0.2, 0.95] });
  }
  pipe(r, [-1.0, y0 + 0.3, 0.86], [-1.0, y0 + 0.3, 0.52], 0.025, M.steel);
  pipe(r, [-0.72, y0 + 0.3, 0.86], [-0.72, y0 + 0.3, 0.52], 0.025, M.steel);
  sandbags(r, 0.6, 2, [0.9, y0, 0.9]);
  crate(r, 0.12, 0.55, y0, 0.95, M.olive, 0.4);

  return makeTemplate({
    root: r,
    height: 1.8,
    radius: 1.55,
    muzzles: [],
    glow: { glow: 2, 'glow:blink': 5, 'glow:star': 3.5, 'glow:core': 3.5 },
    anim: sAnim((c, s) => {
      c.setGlow('glow:star', s.powered ? 0.85 + 0.15 * Math.sin(s.time * 2 + c.v.seed) : 0.12);
      c.setGlow('glow:core', s.powered ? 0.75 + 0.25 * Math.sin(s.time * 3.1) : 0.08);
      c.n.star.rotation.y = s.powered ? Math.sin(s.time * 0.5) * 0.4 : 0;
    }),
  });
}

// =============================================================================================
// Helipad (2x2)
// =============================================================================================

function helipad(): ModelTemplate {
  const r = root(2, 2, M.concreteDark);
  const y0 = 0.04;
  const ph = 0.06;
  r.box(M.asphalt, 1.62, ph, 1.62, 0.0, y0 + ph / 2, 0.0, { b: 0.02 });
  r.add(ringGeo(0.6, 0.66, 0.006, 32), M.yellow, { p: [0, y0 + ph + 0.002, 0] });
  // H
  r.box(M.white, 0.08, 0.006, 0.5, -0.17, y0 + ph + 0.003, 0, { b: 0 });
  r.box(M.white, 0.08, 0.006, 0.5, 0.17, y0 + ph + 0.003, 0, { b: 0 });
  r.box(M.white, 0.3, 0.006, 0.08, 0, y0 + ph + 0.003, 0, { b: 0 });
  // edge stripes
  for (const s of [-1, 1]) {
    hazard(r, 1.5, 0.06, [0, y0 + ph + 0.004, 0.77 * s], [-Math.PI / 2, 0, 0]);
  }
  // corner lights
  for (const [x, z] of [
    [-0.75, -0.75],
    [0.75, -0.75],
    [-0.75, 0.75],
    [0.75, 0.75],
  ]) {
    r.cyl(M.dark, 0.03, 0.035, 0.03, x, y0 + ph + 0.015, z, { seg: 8 });
    r.sph(G.cyan, 0.022, x, y0 + ph + 0.04, z, { seg: 8, slot: 'glow:blink' });
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    r.sph(G.white, 0.01, Math.cos(a) * 0.72, y0 + ph + 0.006, Math.sin(a) * 0.72, { seg: 6, slot: 'glow:ring' });
  }
  // fuel pump / control box at back-right
  r.box(M.team, 0.18, 0.2, 0.12, 0.72, y0 + ph + 0.1, -0.92 + 0.02, { b: 0.015 });
  r.box(G.green, 0.1, 0.04, 0.005, 0.72, y0 + ph + 0.15, -0.92 + 0.083, { b: 0, slot: 'glow' });
  // windsock
  r.cyl(M.steel, 0.008, 0.01, 0.42, -0.85, y0 + 0.21, -0.85, { seg: 6 });
  const sock = r.node('sock', [-0.85, y0 + 0.4, -0.85]);
  sock.add(new THREE.CylinderGeometry(0.018, 0.035, 0.14, 8, 1, true), M.red, { p: [0.07, 0, 0], r: [0, 0, Math.PI / 2] });
  sock.add(new THREE.CylinderGeometry(0.0181, 0.0251, 0.05, 8, 1, true), M.white, { p: [0.11, 0, 0], r: [0, 0, Math.PI / 2] });

  return makeTemplate({
    root: r,
    height: 0.45,
    radius: 1.05,
    muzzles: [],
    glow: { glow: 2, 'glow:blink': 4, 'glow:ring': 3 },
    anim: sAnim((c, s) => {
      c.n.sock.rotation.y = Math.sin(s.time * 0.7 + c.v.seed) * 0.4 + 0.6;
      c.setGlow('glow:ring', s.powered ? (blink(s.time, 1.0, 0.5, c.v.seed) ? 1 : 0.4) : 0.05);
    }),
  });
}

// =============================================================================================
// Airfield (3x2) — runway strip + control tower
// =============================================================================================

function airfield(): ModelTemplate {
  const r = root(3, 2, M.concreteDark);
  const y0 = 0.04;
  // runway
  r.box(M.asphalt, 2.8, 0.03, 1.1, 0, y0 + 0.015, 0.25, { b: 0.01 });
  for (let i = 0; i < 7; i++) r.box(M.white, 0.22, 0.004, 0.035, -1.2 + i * 0.4, y0 + 0.032, 0.25, { b: 0 });
  for (const z of [-0.26, 0.76]) r.box(M.white, 2.7, 0.004, 0.025, 0, y0 + 0.032, z, { b: 0 });
  for (let i = 0; i < 6; i++) r.box(M.white, 0.06, 0.004, 0.18, -1.3 + i * 0.012 * 10, y0 + 0.032, 0.25, { b: 0, r: [0, 0, 0] });
  // landing lights (chasing)
  for (let i = 0; i < 8; i++) {
    const x = -1.3 + i * 0.37;
    for (const z of [-0.3, 0.8]) {
      r.sph(G.amber, 0.014, x, y0 + 0.04, z, { seg: 6, slot: `glow:run${i % 4}` });
    }
  }
  // apron + hangar at back
  r.box(M.concrete, 1.6, 0.36, 0.55, -0.55, y0 + 0.18, -0.62, { b: 0.02 });
  r.add(new THREE.CylinderGeometry(0.28, 0.28, 1.6, 16, 1, false, -Math.PI / 2, Math.PI), M.team, {
    p: [-0.55, y0 + 0.34, -0.62],
    r: [-Math.PI / 2, 0, -Math.PI / 2],
    s: [1, 1, 1],
  });
  r.box(M.darker, 1.2, 0.28, 0.02, -0.55, y0 + 0.14, -0.342, { b: 0 });
  for (let i = 0; i < 6; i++) r.box(M.teamDark, 0.2, 0.28, 0.012, -1.05 + i * 0.2, y0 + 0.14, -0.33, { b: 0.002 });
  // control tower (back right)
  const tx = 1.0;
  const tz = -0.6;
  r.box(M.concrete, 0.3, 0.5, 0.3, tx, y0 + 0.25, tz, { b: 0.015 });
  r.add(
    prismXZ(
      [
        [-0.2, -0.2],
        [0.2, -0.2],
        [0.24, -0.1],
        [0.24, 0.1],
        [0.2, 0.2],
        [-0.2, 0.2],
        [-0.24, 0.1],
        [-0.24, -0.1],
      ],
      0.14,
      0.01,
    ),
    M.glassBlue,
    { p: [tx, y0 + 0.5, tz] },
  );
  r.box(G.green, 0.36, 0.03, 0.005, tx, y0 + 0.57, tz + 0.2, { b: 0, slot: 'glow' });
  r.box(M.team, 0.52, 0.04, 0.46, tx, y0 + 0.66, tz, { b: 0.012 });
  const radar = r.node('radar', [tx, y0 + 0.68, tz]);
  radar.cyl(M.dark, 0.01, 0.012, 0.08, 0, 0.04, 0, { seg: 6 });
  radar.box(M.gun, 0.03, 0.05, 0.22, 0, 0.09, 0, { b: 0.006 });
  beacon(r, [tx + 0.2, y0 + 0.68, tz - 0.18]);
  sovietStar(r, 0.09, [tx, y0 + 0.28, tz + 0.152], faceRot('+z'));
  // fuel tanks
  r.cyl(M.offwhite, 0.08, 0.08, 0.3, 1.15, y0 + 0.1, -0.08, { r: [Math.PI / 2, 0, 0], seg: 12 });

  return makeTemplate({
    root: r,
    height: 0.8,
    radius: 1.4,
    muzzles: [],
    glow: { glow: 2, 'glow:blink': 5, 'glow:run0': 3.5, 'glow:run1': 3.5, 'glow:run2': 3.5, 'glow:run3': 3.5 },
    anim: sAnim((c, s) => {
      if (s.powered) c.n.radar.rotation.y += dtOf(s) * 1.5;
      const k = Math.floor(s.time * 6) % 4;
      for (let i = 0; i < 4; i++) c.setGlow(`glow:run${i}`, s.powered ? (i === k ? 1 : 0.2) : 0.04);
    }),
  });
}

// =============================================================================================
// Missile silo (2x1)
// =============================================================================================

function missileSilo(): ModelTemplate {
  const r = root(2, 1);
  const y0 = 0.04;
  r.box(M.concreteLight, 1.4, 0.12, 0.82, -0.2, y0 + 0.06, 0, { b: 0.03 });
  // shaft
  r.box(M.darker, 0.5, 0.01, 0.5, -0.2, y0 + 0.121, 0, { b: 0 });
  r.cyl(M.dark, 0.2, 0.2, 0.3, -0.2, y0 - 0.02, 0, { seg: 16, open: true });
  hazard(r, 0.62, 0.05, [-0.2, y0 + 0.125, 0.3], [-Math.PI / 2, 0, 0]);
  hazard(r, 0.62, 0.05, [-0.2, y0 + 0.125, -0.3], [-Math.PI / 2, 0, 0]);
  // missile (rises with door)
  const mis = r.node('missile', [-0.2, y0 - 0.45, 0]);
  mis.cyl(M.white, 0.1, 0.1, 0.5, 0, 0.25, 0, { seg: 14 });
  mis.add(lathe([[0.1, 0], [0.09, 0.08], [0.06, 0.16], [0.0, 0.24]], 14), M.red, { p: [0, 0.5, 0] });
  mis.add(ringGeo(0.1, 0.104, 0.04, 14), M.team, { p: [0, 0.35, 0] });
  // doors slide apart along X
  const dl = r.node('doorL', [-0.2, y0 + 0.13, 0]);
  dl.box(M.teamDark, 0.27, 0.04, 0.56, -0.135, 0.02, 0, { b: 0.01 });
  for (let i = 0; i < 4; i++) dl.box(M.dark, 0.012, 0.042, 0.5, -0.04 - i * 0.06, 0.02, 0, { b: 0 });
  const dr = r.node('doorR', [-0.2, y0 + 0.13, 0]);
  dr.box(M.teamDark, 0.27, 0.04, 0.56, 0.135, 0.02, 0, { b: 0.01 });
  for (let i = 0; i < 4; i++) dr.box(M.dark, 0.012, 0.042, 0.5, 0.04 + i * 0.06, 0.02, 0, { b: 0 });
  sovietStarOrAllied(r, 0.06, [-0.2, y0 + 0.08, 0.413]);
  // control bunker (right)
  r.box(M.concrete, 0.42, 0.3, 0.6, 0.68, y0 + 0.15, -0.05, { b: 0.02 });
  r.box(M.team, 0.45, 0.04, 0.63, 0.68, y0 + 0.31, -0.05, { b: 0.012 });
  windows(r, 2, 0.1, 0.06, 0.06, [0.68, y0 + 0.2, 0.252], [0, 0, 0], G.red);
  antenna(r, 0.78, y0 + 0.33, -0.2, 0.3);
  lamp(r, G.red, [0.55, y0 + 0.36, 0.15], 0.02, 'glow:warn');
  lamp(r, G.red, [-0.88, y0 + 0.14, 0.36], 0.02, 'glow:warn');
  lamp(r, G.red, [0.48, y0 + 0.14, -0.36], 0.02, 'glow:warn');

  return makeTemplate({
    root: r,
    height: 0.5,
    radius: 1.05,
    muzzles: ['m0'],
    glow: { glow: 2.2, 'glow:warn': 5 },
    init: (c) => {
      // muzzle at the top of the shaft, pointing up
      const m = new THREE.Object3D();
      m.name = 'm0';
      m.position.set(-0.2, 0.5, 0);
      m.rotation.z = Math.PI / 2;
      c.root.add(m);
      c.n.m0 = m;
    },
    anim: sAnim((c, s) => {
      const d = Math.min(1, Math.max(0, s.door));
      c.n.doorL.position.x = -0.2 - d * 0.3;
      c.n.doorR.position.x = -0.2 + d * 0.3;
      c.n.missile.position.y = 0.04 - 0.45 + d * 0.42;
      const ready = s.charge >= 1;
      c.setGlow('glow:warn', s.powered ? (ready || d > 0.02 ? (blink(s.time, 0.5, 0.5) ? 1 : 0.1) : 0.2) : 0.04);
    }),
  });
}

// =============================================================================================
// Iron Curtain (2x2)
// =============================================================================================

function ironCurtain(): ModelTemplate {
  const r = root(2, 2, M.concreteDark);
  const y0 = 0.04;
  // stepped octagonal platform
  const oct = (rad: number) => {
    const p: [number, number][] = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      p.push([Math.cos(a) * rad, Math.sin(a) * rad]);
    }
    return p;
  };
  r.add(prismXZ(oct(0.86), 0.1, 0.02), M.dark, { p: [0, y0, 0] });
  r.add(prismXZ(oct(0.66), 0.08, 0.02), M.teamDark, { p: [0, y0 + 0.1, 0] });
  r.add(prismXZ(oct(0.4), 0.06, 0.02), M.gun, { p: [0, y0 + 0.18, 0] });
  // energy ring in the floor
  r.add(ringGeo(0.42, 0.48, 0.01, 24), G.red, { p: [0, y0 + 0.185, 0], slot: 'glow:core' });
  // four angular pylons leaning inward
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const x = Math.cos(a) * 0.62;
    const z = Math.sin(a) * 0.62;
    const pyl = new NB('_p', [x, y0 + 0.1, z], [0, -a, 0]);
    pyl.add(
      prismXY(
        [
          [-0.12, 0],
          [0.12, 0],
          [0.02, 1.05],
          [-0.06, 1.1],
          [-0.1, 0.5],
        ],
        0.14,
        0.02,
      ),
      M.dark,
      { r: [0, 0, 0.12] },
    );
    pyl.add(
      prismXY(
        [
          [-0.05, 0.2],
          [0.06, 0.2],
          [0.0, 0.95],
          [-0.04, 0.95],
        ],
        0.15,
        0.01,
      ),
      M.team,
      { r: [0, 0, 0.12] },
    );
    pyl.box(G.red, 0.012, 0.5, 0.155, 0.04, 0.55, 0, { b: 0, r: [0, 0, 0.17], slot: 'glow:core' });
    mergeChild(r, pyl);
  }
  // suspended core
  const core = r.node('core', [0, y0 + 0.75, 0]);
  core.add(new THREE.OctahedronGeometry(0.16, 0), G.red, { slot: 'glow:core', s: [1, 1.5, 1] });
  core.add(new THREE.OctahedronGeometry(0.2, 0), M.dark, { s: [0.55, 1.7, 0.55], r: [0, Math.PI / 4, 0] });
  const halo = r.node('halo', [0, y0 + 0.75, 0]);
  halo.add(new THREE.PlaneGeometry(1.2, 1.2), M.dark, { slot: 'fx:add:ff2018:1.0', keepUv: true, r: [-Math.PI / 2, 0, 0] });
  // emitter rings
  const ring = r.node('ring', [0, y0 + 0.75, 0]);
  ring.add(ringGeo(0.3, 0.34, 0.03, 24), M.teamDark, { r: [Math.PI / 2, 0, 0] });
  ring.add(ringGeo(0.3, 0.34, 0.03, 24), M.gun, { r: [0, 0, Math.PI / 2] });
  // control consoles on the front
  r.box(M.gun, 0.3, 0.12, 0.1, 0, y0 + 0.06, 0.82, { b: 0.01 });
  r.box(G.red, 0.24, 0.03, 0.005, 0, y0 + 0.09, 0.872, { b: 0, slot: 'glow' });
  sovietStar(r, 0.08, [0, y0 + 0.103, 0.7]);

  return makeTemplate({
    root: r,
    height: 1.3,
    radius: 1.05,
    muzzles: [],
    glow: { glow: 2.5, 'glow:core': 5 },
    anim: sAnim((c, s) => {
      const dt = dtOf(s);
      const ch = Math.min(1, Math.max(0, s.charge));
      const pulse = 0.85 + 0.15 * Math.sin(s.time * (2 + ch * 6));
      const k = s.powered ? (0.25 + 0.75 * ch) * pulse : 0.06;
      c.setGlow('glow:core', k);
      c.n.core.rotation.y += dt * (s.powered ? 0.6 + ch * 2.5 : 0);
      c.n.core.position.y = 0.79 + Math.sin(s.time * 1.3) * 0.03;
      c.n.ring.rotation.y += dt * (s.powered ? 0.4 + ch * 1.5 : 0);
      c.n.ring.rotation.x = Math.sin(s.time * 0.7) * 0.3;
      const h = c.n.halo;
      h.visible = s.powered && ch > 0.05;
      h.scale.setScalar(0.5 + ch * 0.6 * pulse);
    }),
  });
}

// =============================================================================================
// Chronosphere (2x2)
// =============================================================================================

function chronosphere(): ModelTemplate {
  const r = root(2, 2, M.concreteLight);
  const y0 = 0.04;
  r.cyl(M.offwhite, 0.85, 0.88, 0.1, 0, y0 + 0.05, 0, { seg: 32 });
  r.cyl(M.team, 0.7, 0.75, 0.06, 0, y0 + 0.13, 0, { seg: 32 });
  r.add(ringGeo(0.76, 0.8, 0.012, 32), G.blue, { p: [0, y0 + 0.105, 0], slot: 'glow:core' });
  // pedestal + support arms
  r.cyl(M.steel, 0.16, 0.24, 0.3, 0, y0 + 0.31, 0, { seg: 16 });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const x = Math.cos(a);
    const z = Math.sin(a);
    pipe(r, [x * 0.68, y0 + 0.16, z * 0.68], [x * 0.5, y0 + 0.7, z * 0.5], 0.035, M.offwhite, 10);
    r.box(M.team, 0.12, 0.08, 0.12, x * 0.68, y0 + 0.2, z * 0.68, { b: 0.015, r: [0, -a, 0] });
    r.sph(G.blue, 0.02, x * 0.5, y0 + 0.72, z * 0.5, { seg: 6, slot: 'glow:core' });
  }
  const cy = y0 + 0.78;
  // core sphere
  r.sph(G.blue, 0.2, 0, cy, 0, { seg: 16, slot: 'glow:core' });
  r.sph(M.glassBlue, 0.24, 0, cy, 0, { seg: 18 });
  // gyroscopic rings
  const ringA = r.node('ringA', [0, cy, 0]);
  ringA.add(new THREE.TorusGeometry(0.42, 0.03, 8, 40), M.steel);
  ringA.add(new THREE.TorusGeometry(0.42, 0.034, 6, 40, Math.PI * 0.3), M.team, { r: [0, 0, 0.3] });
  ringA.add(new THREE.TorusGeometry(0.42, 0.034, 6, 40, Math.PI * 0.3), M.team, { r: [0, 0, 0.3 + Math.PI] });
  const ringB = ringA.node('ringB', [0, 0, 0], [0, 0, 0]);
  ringB.add(new THREE.TorusGeometry(0.34, 0.025, 8, 36), M.offwhite, { r: [Math.PI / 2, 0, 0] });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    ringB.sph(G.cyan, 0.016, Math.cos(a) * 0.34, 0, Math.sin(a) * 0.34, { seg: 6, slot: 'glow:core' });
  }
  const ringC = ringB.node('ringC', [0, 0, 0]);
  ringC.add(new THREE.TorusGeometry(0.28, 0.018, 8, 32), M.team, { r: [0, Math.PI / 2, 0] });
  const halo = r.node('halo', [0, cy, 0]);
  halo.add(new THREE.PlaneGeometry(1.1, 1.1), M.dark, { slot: 'fx:add:3a8cff:0.9', keepUv: true, r: [-Math.PI / 2, 0, 0] });
  // consoles
  r.box(M.gun, 0.28, 0.12, 0.1, 0, y0 + 0.16, 0.8, { b: 0.01, r: [-0.3, 0, 0] });
  r.box(G.cyan, 0.22, 0.05, 0.005, 0, y0 + 0.18, 0.85, { b: 0, r: [-0.3, 0, 0], slot: 'glow' });
  alliedStar(r, 0.07, [0, y0 + 0.161, 0.6]);

  return makeTemplate({
    root: r,
    height: 1.3,
    radius: 1.05,
    muzzles: [],
    glow: { glow: 2.5, 'glow:core': 4.5 },
    anim: sAnim((c, s) => {
      const dt = dtOf(s);
      const ch = Math.min(1, Math.max(0, s.charge));
      const sp = s.powered ? 0.4 + ch * 2.2 : 0;
      c.n.ringA.rotation.y += dt * sp;
      c.n.ringA.rotation.x = 0.35;
      c.n.ringB.rotation.z += dt * sp * 1.3;
      c.n.ringC.rotation.x += dt * sp * 1.7;
      const k = s.powered ? (0.3 + 0.7 * ch) * (0.88 + 0.12 * Math.sin(s.time * 5)) : 0.06;
      c.setGlow('glow:core', k);
      const h = c.n.halo;
      h.visible = s.powered && ch > 0.05;
      h.scale.setScalar(0.5 + ch * 0.6);
    }),
  });
}

export const STRUCTURE_BUILDERS: Record<string, () => ModelTemplate> = {
  fact: constructionYard,
  powr: powerPlant,
  apwr: advPowerPlant,
  proc: refinery,
  silo: oreSilo,
  tent: alliedBarracks,
  barr: sovietBarracks,
  kenn: kennel,
  weap: warFactory,
  dome: radarDome,
  fix: serviceDepot,
  atek: alliedTech,
  stek: sovietTech,
  hpad: helipad,
  afld: airfield,
  mslo: missileSilo,
  iron: ironCurtain,
  pdox: chronosphere,
};

