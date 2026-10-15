/**
 * Aircraft. Face +X; modelled with their lowest point (skids/wheels) at y≈0.
 * The engine lifts root.position.y to the flight altitude.
 */
import * as THREE from 'three';
import { NB, makeTemplate, type Ctx, type ModelTemplate } from './builder';
import { M, G, lathe, prismXY, prismXZ, sovietStar, alliedStar, antenna, faceRot, grille } from './parts';
import type { ModelAnimState } from './types';
import { approach, blink, dtOf, healthVariant } from './anim';

function airborne(s: ModelAnimState): boolean {
  return (s.altitude ?? 0) > 0.05 || s.moving;
}

/** Spin rotor nodes; `spin` = rad/s at full power. Blur disc fades in with speed. */
function animRotors(c: Ctx, s: ModelAnimState, main: string, tail: string | null, spin: number): void {
  const dt = dtOf(s);
  const target = airborne(s) ? 1 : 0;
  const p = (c.v.rotor = approach(c.v.rotor ?? target, target, 1.2, dt));
  const m = c.n[main];
  // cap visual step to avoid strobing; blur disc carries the motion at full speed
  m.rotation.y += Math.min(dt * spin * p, 0.45);
  if (tail) c.n[tail].rotation.z += Math.min(dt * spin * 1.6 * p, 0.6);
  const disc = c.n['fx:rotorDisc'];
  if (disc) disc.visible = p > 0.35;
}

function rotorBlades(nb: NB, n: number, R: number, chord: number, mat = M.dark): void {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    nb.add(new THREE.BoxGeometry(R, 0.006, chord), mat, {
      p: [Math.cos(a) * (R / 2 + 0.02), 0, -Math.sin(a) * (R / 2 + 0.02)],
      r: [0, a, 0],
    });
    // yellow tip
    nb.add(new THREE.BoxGeometry(0.03, 0.0065, chord * 1.01), M.yellow, {
      p: [Math.cos(a) * (R + 0.005), 0, -Math.sin(a) * (R + 0.005)],
      r: [0, a, 0],
    });
  }
  nb.cyl(M.gun, 0.03, 0.035, 0.03, 0, 0, 0, { seg: 10 });
  nb.cyl(M.steel, 0.012, 0.012, 0.04, 0, 0.02, 0, { seg: 8 });
}

function rotorDisc(parent: NB, y: number, R: number): void {
  const d = parent.node('rotorDisc', [0, y, 0]);
  d.add(new THREE.CircleGeometry(R + 0.02, 20), M.dark, { r: [-Math.PI / 2, 0, 0], slot: 'fx:rotor', keepUv: true });
}

// =============================================================================================
// Longbow (Allied attack helicopter)
// =============================================================================================

function longbow(): ModelTemplate {
  const r = new NB('root');
  // fuselage
  r.add(
    prismXY(
      [
        [0.34, 0.1],
        [0.31, 0.065],
        [0.16, 0.045],
        [-0.12, 0.06],
        [-0.2, 0.1],
        [-0.2, 0.165],
        [-0.02, 0.2],
        [0.1, 0.2],
        [0.26, 0.15],
        [0.34, 0.125],
      ],
      0.12,
      0.024,
    ),
    M.team,
  );
  // tandem canopy
  r.add(
    prismXY(
      [
        [0.29, 0.13],
        [0.17, 0.13],
        [0.17, 0.185],
        [0.23, 0.18],
      ],
      0.09,
      0.012,
    ),
    M.glassBlue,
  );
  r.add(
    prismXY(
      [
        [0.15, 0.17],
        [0.03, 0.17],
        [0.03, 0.225],
        [0.1, 0.22],
      ],
      0.095,
      0.012,
    ),
    M.glassBlue,
  );
  // engine nacelles
  for (const s of [-1, 1]) {
    r.cyl(M.teamDark, 0.034, 0.03, 0.18, -0.04, 0.17, 0.085 * s, { r: [0, 0, -Math.PI / 2], seg: 12 });
    r.cyl(M.dark, 0.026, 0.026, 0.03, -0.14, 0.17, 0.09 * s, { r: [0, 0, -Math.PI / 2], seg: 10 });
    r.box(M.gun, 0.04, 0.03, 0.03, 0.06, 0.17, 0.09 * s, { b: 0.008 });
  }
  // tail boom & empennage
  r.cyl(M.team, 0.018, 0.034, 0.36, -0.36, 0.145, 0, { r: [0, 0, Math.PI / 2], seg: 12 });
  r.add(
    prismXY(
      [
        [-0.47, 0.13],
        [-0.53, 0.13],
        [-0.56, 0.29],
        [-0.52, 0.29],
      ],
      0.016,
      0.005,
    ),
    M.teamDark,
  );
  r.box(M.teamDark, 0.06, 0.008, 0.2, -0.5, 0.15, 0, { b: 0.003 });
  // stub wings + hellfire racks
  for (const s of [-1, 1]) {
    r.box(M.teamDark, 0.08, 0.012, 0.16, 0.0, 0.12, 0.13 * s, { b: 0.004, r: [0.08 * s, 0, 0] });
    for (const z of [0.12, 0.19]) {
      r.box(M.dark, 0.05, 0.02, 0.012, 0.0, 0.1, z * s, { b: 0 });
      for (const dz of [-0.012, 0.012]) {
        r.cyl(M.oliveDark, 0.009, 0.009, 0.09, 0.01, 0.084, z * s + dz, { r: [0, 0, -Math.PI / 2], seg: 4 });
        r.add(new THREE.ConeGeometry(0.009, 0.016, 4), M.gun, { p: [0.063, 0.084, z * s + dz], r: [0, 0, -Math.PI / 2] });
      }
    }
  }
  r.node('m0', [0.08, 0.08, -0.155]);
  r.node('m1', [0.08, 0.08, 0.155]);
  // chin gun
  r.sph(M.gun, 0.022, 0.24, 0.045, 0, { seg: 10 });
  r.cyl(M.dark, 0.005, 0.005, 0.08, 0.29, 0.04, 0, { r: [0, 0, -Math.PI / 2], seg: 6 });
  // landing gear
  for (const s of [-1, 1]) {
    r.box(M.dark, 0.012, 0.05, 0.012, 0.13, 0.04, 0.06 * s, { b: 0.002 });
    r.cyl(M.rubber, 0.022, 0.022, 0.018, 0.13, 0.022, 0.07 * s, { r: [Math.PI / 2, 0, 0], seg: 10 });
  }
  r.cyl(M.rubber, 0.014, 0.014, 0.012, -0.46, 0.11, 0, { r: [Math.PI / 2, 0, 0], seg: 8 });
  alliedStar(r, 0.025, [-0.3, 0.15, 0.036], faceRot('+z'));
  alliedStar(r, 0.025, [-0.3, 0.15, -0.036], faceRot('-z'));
  // nav lights
  r.sph(G.red, 0.008, 0.0, 0.12, -0.215, { seg: 6, slot: 'glow' });
  r.sph(G.green, 0.008, 0.0, 0.12, 0.215, { seg: 6, slot: 'glow' });
  r.sph(G.white, 0.007, -0.555, 0.29, 0, { seg: 6, slot: 'glow:strobe' });
  // mast + Longbow radar dome
  r.cyl(M.gun, 0.018, 0.022, 0.07, 0.02, 0.23, 0, { seg: 10 });
  const rotor = r.node('rotor', [0.02, 0.27, 0]);
  rotorBlades(rotor, 4, 0.44, 0.04);
  rotor.sph(M.offwhite, 0.036, 0, 0.045, 0, { seg: 12, s: [1, 0.7, 1] });
  rotorDisc(r, 0.27, 0.46);
  const tr = r.node('trotor', [-0.535, 0.24, 0.022]);
  for (let i = 0; i < 4; i++) tr.box(M.dark, 0.11, 0.016, 0.004, 0, 0, 0, { r: [0, 0, (i * Math.PI) / 2], b: 0 });

  return makeTemplate({
    root: r,
    height: 0.36,
    radius: 0.45,
    muzzles: ['m0', 'm1'],
    glow: { 'glow:strobe': 5 },
    anim: (c, s) => {
      healthVariant(c, s);
      animRotors(c, s, 'rotor', 'trotor', 28);
      c.setGlow('glow:strobe', blink(s.time, 1.1, 0.12) ? 1 : 0);
    },
  });
}

// =============================================================================================
// Hind (Soviet assault helicopter)
// =============================================================================================

function hind(): ModelTemplate {
  const r = new NB('root');
  r.add(
    prismXY(
      [
        [0.38, 0.1],
        [0.33, 0.06],
        [0.15, 0.04],
        [-0.18, 0.06],
        [-0.26, 0.11],
        [-0.26, 0.2],
        [-0.05, 0.25],
        [0.14, 0.24],
        [0.26, 0.18],
        [0.38, 0.13],
      ],
      0.17,
      0.03,
    ),
    M.team,
  );
  // belly darker
  r.add(
    prismXY(
      [
        [0.33, 0.06],
        [0.15, 0.04],
        [-0.18, 0.06],
        [-0.2, 0.09],
        [0.3, 0.09],
      ],
      0.172,
      0.02,
    ),
    M.teamDark,
  );
  // stepped bubble canopies
  r.sph(M.glassBlue, 0.055, 0.31, 0.12, 0, { seg: 12, s: [1.1, 0.85, 0.9] });
  r.sph(M.glassBlue, 0.06, 0.2, 0.17, 0, { seg: 12, s: [1.15, 0.85, 0.85] });
  // engines on top
  for (const s of [-1, 1]) {
    r.cyl(M.teamDark, 0.04, 0.036, 0.26, -0.04, 0.24, 0.06 * s, { r: [0, 0, -Math.PI / 2], seg: 12 });
    r.cyl(M.dark, 0.032, 0.03, 0.04, -0.18, 0.24, 0.07 * s, { r: [0, 0, -Math.PI / 2], seg: 10 });
    r.cyl(M.gun, 0.03, 0.03, 0.01, 0.095, 0.24, 0.06 * s, { r: [0, 0, -Math.PI / 2], seg: 10 });
  }
  // tail boom & fin
  r.cyl(M.team, 0.022, 0.045, 0.42, -0.45, 0.17, 0, { r: [0, 0, Math.PI / 2], seg: 12 });
  r.add(
    prismXY(
      [
        [-0.6, 0.15],
        [-0.67, 0.15],
        [-0.72, 0.33],
        [-0.66, 0.33],
      ],
      0.018,
      0.005,
    ),
    M.teamDark,
  );
  r.box(M.teamDark, 0.07, 0.008, 0.22, -0.58, 0.17, 0, { b: 0.003 });
  // stub wings with rocket pods
  for (const s of [-1, 1]) {
    r.box(M.teamDark, 0.12, 0.012, 0.2, 0.0, 0.13, 0.17 * s, { b: 0.004, r: [-0.18 * s, 0, 0] });
    for (const z of [0.15, 0.23]) {
      r.cyl(M.oliveDark, 0.024, 0.024, 0.11, 0.0, 0.1 - (z - 0.15) * 0.18, z * s, { r: [0, 0, -Math.PI / 2], seg: 10 });
      r.add(new THREE.ConeGeometry(0.024, 0.03, 6), M.gun, { p: [0.07, 0.1 - (z - 0.15) * 0.18, z * s], r: [0, 0, -Math.PI / 2] });
    }
    r.box(M.dark, 0.03, 0.03, 0.01, 0.0, 0.11, 0.265 * s, { b: 0.003 });
  }
  // chin gun turret
  r.sph(M.gun, 0.028, 0.33, 0.05, 0, { seg: 10 });
  r.cyl(M.dark, 0.006, 0.006, 0.09, 0.38, 0.045, 0, { r: [0, 0, -Math.PI / 2], seg: 6 });
  r.node('m0', [0.43, 0.045, 0]);
  r.node('m1', [0.07, 0.1, 0.19]);
  // gear
  for (const s of [-1, 1]) {
    r.box(M.dark, 0.012, 0.05, 0.012, -0.02, 0.04, 0.09 * s, { b: 0.002 });
    r.cyl(M.rubber, 0.024, 0.024, 0.02, -0.02, 0.024, 0.1 * s, { r: [Math.PI / 2, 0, 0], seg: 10 });
  }
  r.cyl(M.rubber, 0.02, 0.02, 0.016, 0.28, 0.02, 0, { r: [Math.PI / 2, 0, 0], seg: 8 });
  sovietStar(r, 0.03, [-0.42, 0.17, 0.04], faceRot('+z'));
  sovietStar(r, 0.03, [-0.42, 0.17, -0.04], faceRot('-z'));
  r.sph(G.red, 0.008, 0.0, 0.11, -0.275, { seg: 6, slot: 'glow' });
  r.sph(G.green, 0.008, 0.0, 0.11, 0.275, { seg: 6, slot: 'glow' });
  r.sph(G.red, 0.009, -0.05, 0.27, 0, { seg: 6, slot: 'glow:strobe' });
  // rotor
  r.cyl(M.gun, 0.024, 0.03, 0.06, 0.0, 0.29, 0, { seg: 10 });
  const rotor = r.node('rotor', [0.0, 0.325, 0]);
  rotorBlades(rotor, 5, 0.5, 0.042);
  rotorDisc(r, 0.325, 0.52);
  const tr = r.node('trotor', [-0.68, 0.28, -0.024]);
  for (let i = 0; i < 3; i++) tr.box(M.dark, 0.13, 0.018, 0.004, 0, 0, 0, { r: [0, 0, (i * Math.PI * 2) / 3], b: 0 });

  return makeTemplate({
    root: r,
    height: 0.4,
    radius: 0.52,
    muzzles: ['m0', 'm1'],
    glow: { 'glow:strobe': 5 },
    anim: (c, s) => {
      healthVariant(c, s);
      animRotors(c, s, 'rotor', 'trotor', 24);
      c.setGlow('glow:strobe', blink(s.time, 1.3, 0.12) ? 1 : 0);
    },
  });
}

// =============================================================================================
// MiG (Soviet strike jet)
// =============================================================================================

function mig(): ModelTemplate {
  const r = new NB('root');
  const cy = 0.09;
  // fuselage (lathe along X)
  r.add(
    lathe(
      [
        [0.0, -0.4],
        [0.045, -0.38],
        [0.055, -0.2],
        [0.058, 0.05],
        [0.05, 0.2],
        [0.035, 0.3],
        [0.0, 0.42],
      ],
      14,
    ),
    M.team,
    { p: [0, cy, 0], r: [0, 0, -Math.PI / 2], s: [1, 1, 0.9] },
  );
  // radome
  r.add(lathe([[0.0, 0.0], [0.034, 0.0], [0.024, 0.06], [0.0, 0.1]], 12), M.gun, { p: [0.33, cy, 0], r: [0, 0, -Math.PI / 2] });
  // canopy
  r.sph(M.glassBlue, 0.04, 0.17, cy + 0.04, 0, { seg: 12, s: [2.0, 0.8, 0.8] });
  // intakes
  for (const s of [-1, 1]) {
    r.box(M.teamDark, 0.24, 0.05, 0.05, 0.02, cy - 0.025, 0.055 * s, { b: 0.012 });
    r.box(M.darker, 0.01, 0.04, 0.04, 0.142, cy - 0.025, 0.055 * s, { b: 0 });
  }
  // delta wings
  const wing = prismXZ(
    [
      [0.14, 0.04],
      [-0.2, 0.3],
      [-0.27, 0.3],
      [-0.26, 0.04],
    ],
    0.012,
    0.004,
  );
  r.add(wing, M.team, { p: [0, cy - 0.01, 0] });
  r.add(
    prismXZ(
      [
        [0.14, -0.04],
        [-0.26, -0.04],
        [-0.27, -0.3],
        [-0.2, -0.3],
      ],
      0.012,
      0.004,
    ),
    M.team,
    { p: [0, cy - 0.01, 0] },
  );
  // stabilators
  r.add(
    prismXZ(
      [
        [-0.3, 0.03],
        [-0.42, 0.16],
        [-0.46, 0.16],
        [-0.42, 0.03],
        [-0.42, -0.03],
        [-0.46, -0.16],
        [-0.42, -0.16],
        [-0.3, -0.03],
      ],
      0.008,
      0.003,
    ),
    M.teamDark,
    { p: [0, cy - 0.005, 0] },
  );
  // twin tails
  for (const s of [-1, 1]) {
    r.add(
      prismXY(
        [
          [-0.26, 0.0],
          [-0.4, 0.0],
          [-0.44, 0.15],
          [-0.39, 0.15],
        ],
        0.01,
        0.003,
      ),
      M.teamDark,
      { p: [0, cy + 0.03, 0.05 * s], r: [-0.18 * s, 0, 0] },
    );
    // engine nozzles + afterburner glow
    r.cyl(M.dark, 0.03, 0.034, 0.05, -0.4, cy - 0.005, 0.03 * s, { r: [0, 0, Math.PI / 2], seg: 12 });
    r.add(new THREE.CircleGeometry(0.024, 8), G.fire, { p: [-0.426, cy - 0.005, 0.03 * s], r: [0, -Math.PI / 2, 0], slot: 'glow:ab' });
    // missiles under wings
    r.cyl(M.offwhite, 0.011, 0.011, 0.15, -0.06, cy - 0.04, 0.17 * s, { r: [0, 0, -Math.PI / 2], seg: 8 });
    r.add(new THREE.ConeGeometry(0.011, 0.03, 4), M.red, { p: [0.03, cy - 0.04, 0.17 * s], r: [0, 0, -Math.PI / 2] });
    r.box(M.dark, 0.05, 0.02, 0.006, -0.06, cy - 0.022, 0.17 * s, { b: 0 });
    sovietStar(r, 0.032, [-0.17, cy + 0.0035, 0.21 * s]);
    r.sph(s < 0 ? G.red : G.green, 0.007, -0.235, cy - 0.004, 0.3 * s, { seg: 6, slot: 'glow' });
  }
  r.node('m0', [0.05, cy - 0.04, -0.17]);
  r.node('m1', [0.05, cy - 0.04, 0.17]);
  // gear (short struts so it sits on y=0)
  for (const [x, z] of [
    [0.2, 0],
    [-0.12, 0.07],
    [-0.12, -0.07],
  ]) {
    r.box(M.dark, 0.01, 0.04, 0.01, x, 0.03, z, { b: 0 });
    r.cyl(M.rubber, 0.015, 0.015, 0.012, x, 0.015, z, { r: [Math.PI / 2, 0, 0], seg: 8 });
  }

  return makeTemplate({
    root: r,
    height: 0.24,
    radius: 0.45,
    muzzles: ['m0', 'm1'],
    glow: { 'glow:ab': 4 },
    anim: (c, s) => {
      healthVariant(c, s);
      const fly = airborne(s);
      c.setGlow('glow:ab', fly ? 0.7 + 0.3 * Math.sin(s.time * 40) : 0.1);
    },
  });
}

// =============================================================================================
// Yak (Soviet prop ground-attack plane)
// =============================================================================================

function yak(): ModelTemplate {
  const r = new NB('root');
  const cy = 0.1;
  r.add(
    lathe(
      [
        [0.0, -0.33],
        [0.02, -0.32],
        [0.035, -0.15],
        [0.05, 0.05],
        [0.052, 0.2],
        [0.045, 0.27],
        [0.0, 0.28],
      ],
      14,
    ),
    M.team,
    { p: [0, cy, 0], r: [0, 0, -Math.PI / 2], s: [1, 1, 0.9] },
  );
  // engine cowling + exhaust stubs
  r.cyl(M.teamDark, 0.054, 0.05, 0.1, 0.22, cy, 0, { r: [0, 0, -Math.PI / 2], seg: 14 });
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) r.box(M.dark, 0.012, 0.01, 0.01, 0.17 + i * 0.022, cy + 0.02, 0.05 * s, { b: 0 });
  }
  // canopy
  r.sph(M.glassBlue, 0.035, 0.04, cy + 0.045, 0, { seg: 12, s: [2.2, 0.9, 0.85] });
  r.box(M.teamDark, 0.12, 0.02, 0.02, -0.06, cy + 0.045, 0, { b: 0.008 });
  // wings
  r.add(
    prismXZ(
      [
        [0.12, -0.04],
        [0.12, 0.04],
        [0.08, 0.38],
        [0.0, 0.38],
        [-0.04, 0.04],
        [-0.04, -0.04],
        [0.0, -0.38],
        [0.08, -0.38],
      ],
      0.014,
      0.005,
    ),
    M.team,
    { p: [0, cy - 0.03, 0] },
  );
  // tail
  r.add(
    prismXZ(
      [
        [-0.23, 0.0],
        [-0.27, 0.12],
        [-0.31, 0.12],
        [-0.31, -0.12],
        [-0.27, -0.12],
      ],
      0.008,
      0.003,
    ),
    M.teamDark,
    { p: [0, cy + 0.0, 0] },
  );
  r.add(
    prismXY(
      [
        [-0.22, 0.0],
        [-0.32, 0.0],
        [-0.33, 0.1],
        [-0.28, 0.1],
      ],
      0.01,
      0.003,
    ),
    M.teamDark,
    { p: [0, cy + 0.01, 0] },
  );
  for (const s of [-1, 1]) {
    sovietStar(r, 0.04, [0.04, cy - 0.015, 0.25 * s]);
    // wing cannons
    r.cyl(M.dark, 0.005, 0.005, 0.07, 0.15, cy - 0.025, 0.12 * s, { r: [0, 0, -Math.PI / 2], seg: 6 });
    r.sph(s < 0 ? G.red : G.green, 0.007, 0.04, cy - 0.02, 0.38 * s, { seg: 6, slot: 'glow' });
    // gear
    r.box(M.dark, 0.01, 0.06, 0.01, 0.09, 0.04, 0.1 * s, { b: 0 });
    r.cyl(M.rubber, 0.022, 0.022, 0.014, 0.09, 0.022, 0.1 * s, { r: [Math.PI / 2, 0, 0], seg: 10 });
  }
  sovietStar(r, 0.03, [-0.2, cy + 0.0, 0.03], faceRot('+z'));
  sovietStar(r, 0.03, [-0.2, cy + 0.0, -0.03], faceRot('-z'));
  r.node('m0', [0.19, cy - 0.025, -0.12]);
  r.node('m1', [0.19, cy - 0.025, 0.12]);
  // propeller
  const prop = r.node('prop', [0.28, cy, 0]);
  prop.add(lathe([[0.0, 0.0], [0.03, 0.0], [0.022, 0.035], [0.0, 0.06]], 12), M.red, { r: [0, 0, -Math.PI / 2] });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    prop.add(new THREE.BoxGeometry(0.008, 0.15, 0.024), M.dark, {
      p: [0.01, Math.cos(a) * 0.08, Math.sin(a) * 0.08],
      r: [a, 0.25, 0],
    });
  }
  const disc = r.node('rotorDisc', [0.292, cy, 0]);
  disc.add(new THREE.CircleGeometry(0.16, 14), M.dark, { r: [0, Math.PI / 2, 0], slot: 'fx:rotor', keepUv: true });

  return makeTemplate({
    root: r,
    height: 0.22,
    radius: 0.4,
    muzzles: ['m0', 'm1'],
    glow: {},
    anim: (c, s) => {
      healthVariant(c, s);
      const dt = dtOf(s);
      const target = airborne(s) ? 1 : 0;
      const p = (c.v.rotor = approach(c.v.rotor ?? target, target, 1.5, dt));
      c.n.prop.rotation.x += Math.min(dt * 40 * p, 0.5);
      c.n['fx:rotorDisc'].visible = p > 0.35;
    },
  });
}

// =============================================================================================
// Chinook (transport helicopter, both sides) — tandem rotors, rear ramp (anim.deployed)
// =============================================================================================

function chinook(): ModelTemplate {
  const r = new NB('root');
  const W = 0.2;
  // fuselage: long box with a rounded roof, upswept aft pylon
  r.add(
    prismXY(
      [
        [0.42, 0.1],
        [0.38, 0.07],
        [-0.36, 0.07],
        [-0.48, 0.12],
        [-0.5, 0.2],
        [-0.48, 0.26],
        [0.3, 0.26],
        [0.4, 0.22],
        [0.45, 0.16],
      ],
      W,
      0.03,
    ),
    M.team,
  );
  // belly + sponsons (fuel pods) along the lower sides
  r.add(prismXY([[0.36, 0.07], [-0.34, 0.07], [-0.36, 0.1], [0.38, 0.1]], W + 0.004, 0.01), M.teamDark);
  for (const s of [-1, 1]) {
    r.add(
      prismXY(
        [
          [0.16, 0.065],
          [-0.3, 0.065],
          [-0.33, 0.1],
          [-0.3, 0.14],
          [0.12, 0.14],
          [0.2, 0.1],
        ],
        0.05,
        0.012,
      ),
      M.teamDark,
      { p: [0, 0, (W / 2 + 0.022) * s] },
    );
    // round cabin windows
    for (let i = 0; i < 6; i++) r.add(new THREE.CircleGeometry(0.012, 6), M.glass, { p: [0.18 - i * 0.085, 0.2, (W / 2 + 0.001) * s], r: [0, s > 0 ? 0 : Math.PI, 0] });
    // landing gear
    r.box(M.dark, 0.012, 0.05, 0.012, 0.25, 0.04, (W / 2 + 0.01) * s, { b: 0.002 });
    r.cyl(M.rubber, 0.022, 0.022, 0.018, 0.25, 0.022, (W / 2 + 0.018) * s, { r: [Math.PI / 2, 0, 0], seg: 8 });
    r.box(M.dark, 0.012, 0.04, 0.012, -0.24, 0.04, (W / 2 + 0.05) * s, { b: 0.002 });
    r.cyl(M.rubber, 0.022, 0.022, 0.018, -0.24, 0.022, (W / 2 + 0.058) * s, { r: [Math.PI / 2, 0, 0], seg: 8 });
    // engines on the aft pylon
    r.cyl(M.teamDark, 0.034, 0.03, 0.2, -0.36, 0.28, (W / 2 + 0.03) * s, { r: [0, 0, -Math.PI / 2], seg: 10 });
    r.cyl(M.dark, 0.026, 0.026, 0.02, -0.465, 0.28, (W / 2 + 0.03) * s, { r: [0, 0, -Math.PI / 2], seg: 8 });
    r.box(M.gun, 0.03, 0.02, 0.02, -0.28, 0.28, (W / 2 + 0.03) * s, { b: 0.004 });
    // side door
    r.box(M.darker, 0.06, 0.09, 0.004, 0.25, 0.155, (W / 2 + 0.001) * s, { b: 0 });
  }
  // cockpit glazing
  r.add(
    prismXY(
      [
        [0.44, 0.17],
        [0.36, 0.17],
        [0.33, 0.235],
        [0.4, 0.22],
      ],
      W - 0.02,
      0.012,
    ),
    M.glassBlue,
  );
  r.box(M.glassBlue, 0.03, 0.03, 0.004, 0.37, 0.15, 0.101, { b: 0 });
  r.box(M.glassBlue, 0.03, 0.03, 0.004, 0.37, 0.15, -0.101, { b: 0 });
  // forward rotor pylon + aft pylon (tall)
  r.add(prismXY([[0.38, 0.26], [0.2, 0.26], [0.24, 0.3], [0.36, 0.3]], 0.1, 0.01), M.team);
  r.add(
    prismXY(
      [
        [-0.24, 0.26],
        [-0.5, 0.26],
        [-0.52, 0.38],
        [-0.36, 0.38],
      ],
      0.12,
      0.012,
    ),
    M.team,
  );
  r.box(M.gun, 0.1, 0.03, 0.06, -0.3, 0.27, 0, { b: 0.008 });
  grille(r, 0.08, 0.05, [-0.3, 0.287, 0], 4);
  alliedOrSovietRoundel(r, -0.22, 0.18, W / 2 + 0.001);
  // nav / anti-collision lights
  r.sph(G.red, 0.008, -0.0, 0.11, -(W / 2 + 0.05), { seg: 4, slot: 'glow' });
  r.sph(G.green, 0.008, -0.0, 0.11, W / 2 + 0.05, { seg: 4, slot: 'glow' });
  r.sph(G.red, 0.009, 0.05, 0.27, 0, { seg: 4, slot: 'glow:strobe' });
  // rear cargo ramp (hinged at the bottom of the tail)
  const ramp = r.node('ramp', [-0.48, 0.085, 0]);
  ramp.box(M.teamDark, 0.012, 0.14, W - 0.02, -0.006, 0.07, 0, { b: 0.004 });
  for (let i = 0; i < 4; i++) ramp.box(M.gun, 0.004, 0.006, W - 0.04, 0.002, 0.02 + i * 0.03, 0, { b: 0 });
  r.box(M.darker, 0.004, 0.13, W - 0.04, -0.47, 0.155, 0, { b: 0 });
  // rotors
  const fr = r.node('rotorF', [0.3, 0.305, 0]);
  rotorBlades(fr, 3, 0.36, 0.035);
  const rr = r.node('rotorR', [-0.43, 0.385, 0]);
  rotorBlades(rr, 3, 0.36, 0.035);
  const df = r.node('discF', [0.3, 0.305, 0]);
  df.add(new THREE.CircleGeometry(0.38, 20), M.dark, { r: [-Math.PI / 2, 0, 0], slot: 'fx:rotor', keepUv: true });
  const dr = r.node('discR', [-0.43, 0.385, 0]);
  dr.add(new THREE.CircleGeometry(0.38, 20), M.dark, { r: [-Math.PI / 2, 0, 0], slot: 'fx:rotor', keepUv: true });

  return makeTemplate({
    root: r,
    height: 0.42,
    radius: 0.55,
    muzzles: [],
    glow: { 'glow:strobe': 5 },
    anim: (c, s) => {
      healthVariant(c, s);
      const dt = dtOf(s);
      const target = airborne(s) ? 1 : 0;
      const p = (c.v.rotor = approach(c.v.rotor ?? target, target, 1.2, dt));
      c.n.rotorF.rotation.y += Math.min(dt * 24 * p, 0.45);
      c.n.rotorR.rotation.y -= Math.min(dt * 24 * p, 0.45);
      c.n['fx:discF'].visible = p > 0.35;
      c.n['fx:discR'].visible = p > 0.35;
      const d = (c.v.ramp = approach(c.v.ramp ?? 0, Math.min(1, Math.max(0, s.deployed ?? 0)), 4, dt));
      c.n.ramp.rotation.z = d * 1.25;
      c.setGlow('glow:strobe', blink(s.time, 1.2, 0.12) ? 1 : 0);
    },
  });
}

/** Neutral roundel for aircraft used by both sides: team disc with a white ring. */
function alliedOrSovietRoundel(nb: NB, x: number, y: number, z: number): void {
  for (const s of [-1, 1]) {
    nb.add(new THREE.CircleGeometry(0.03, 10), M.white, { p: [x, y, z * s], r: [0, s > 0 ? 0 : Math.PI, 0] });
    nb.add(new THREE.CircleGeometry(0.022, 10), M.team, { p: [x, y, (z + 0.001) * s], r: [0, s > 0 ? 0 : Math.PI, 0] });
  }
}

// =============================================================================================
// Badger (Soviet bomber; paratroopers / parabombs power) — twin turboprops, glazed nose, bomb bay
// =============================================================================================

function badger(): ModelTemplate {
  const r = new NB('root');
  const cy = 0.13;
  // fuselage
  r.add(
    lathe(
      [
        [0.0, -0.74],
        [0.03, -0.7],
        [0.06, -0.5],
        [0.085, -0.2],
        [0.09, 0.2],
        [0.085, 0.42],
        [0.07, 0.56],
        [0.04, 0.64],
        [0.0, 0.68],
      ],
      14,
    ),
    M.team,
    { p: [0, cy, 0], r: [0, 0, -Math.PI / 2], s: [1, 1, 0.92] },
  );
  // glazed nose + cockpit canopy
  r.add(lathe([[0.0, 0.0], [0.05, 0.02], [0.058, 0.06], [0.04, 0.11], [0.0, 0.14]], 12), M.glassBlue, { p: [0.56, cy, 0], r: [0, 0, -Math.PI / 2] });
  for (let i = 0; i < 4; i++) r.add(new THREE.TorusGeometry(0.052 - i * 0.008, 0.003, 3, 10), M.dark, { p: [0.6 + i * 0.025, cy, 0], r: [0, Math.PI / 2, 0] });
  r.sph(M.glassBlue, 0.055, 0.42, cy + 0.06, 0, { seg: 10, s: [1.8, 0.75, 0.9] });
  // belly (darker) + bomb bay
  r.box(M.teamDark, 0.5, 0.03, 0.12, 0.0, cy - 0.075, 0, { b: 0.012 });
  r.box(M.darker, 0.34, 0.02, 0.1, 0.0, cy - 0.07, 0, { b: 0 });
  for (let i = 0; i < 3; i++) r.cyl(M.oliveDark, 0.018, 0.018, 0.09, -0.1 + i * 0.1, cy - 0.06, 0, { r: [0, 0, Math.PI / 2], seg: 6 });
  for (const s of [-1, 1]) {
    const bay = r.node(s > 0 ? 'bayL' : 'bayR', [0, cy - 0.085, 0.05 * s]);
    bay.box(M.teamDark, 0.34, 0.008, 0.05, 0, 0, -0.025 * s, { b: 0.002 });
  }
  // wings (mild sweep) with nacelles
  const wing = (s: number) =>
    prismXZ(
      [
        [0.18, 0.06 * s],
        [0.02, 0.9 * s],
        [-0.08, 0.9 * s],
        [-0.12, 0.06 * s],
      ],
      0.026,
      0.006,
    );
  for (const s of [-1, 1]) {
    r.add(wing(s), M.team, { p: [0, cy - 0.01, 0] });
    sovietStar(r, 0.07, [-0.02, cy + 0.0175, 0.65 * s]);
    r.sph(s < 0 ? G.red : G.green, 0.009, -0.05, cy + 0.005, 0.9 * s, { seg: 4, slot: 'glow' });
    // engine nacelle + prop
    const nz = 0.32 * s;
    r.add(lathe([[0.0, -0.22], [0.035, -0.18], [0.055, -0.05], [0.055, 0.1], [0.045, 0.18], [0.03, 0.2]], 10), M.teamDark, { p: [0.05, cy - 0.005, nz], r: [0, 0, -Math.PI / 2] });
    r.cyl(M.dark, 0.035, 0.04, 0.012, 0.255, cy - 0.005, nz, { r: [0, 0, -Math.PI / 2], seg: 8 });
    r.add(lathe([[0.0, 0.0], [0.024, 0.0], [0.016, 0.03], [0.0, 0.05]], 8), M.red, { p: [0.26, cy - 0.005, nz], r: [0, 0, -Math.PI / 2] });
    const prop = r.node(s > 0 ? 'propL' : 'propR', [0.275, cy - 0.005, nz]);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      prop.add(new THREE.BoxGeometry(0.008, 0.2, 0.024), M.dark, { p: [0, Math.cos(a) * 0.1, Math.sin(a) * 0.1], r: [a, 0.3, 0] });
    }
    const disc = r.node(s > 0 ? 'pdiscL' : 'pdiscR', [0.28, cy - 0.005, nz]);
    disc.add(new THREE.CircleGeometry(0.21, 16), M.dark, { r: [0, Math.PI / 2, 0], slot: 'fx:rotor', keepUv: true });
    r.node(s > 0 ? 'exL' : 'exR', [-0.18, cy - 0.005, nz]);
    // main gear (stowed in nacelles; struts only when landed)
    r.box(M.dark, 0.014, 0.07, 0.014, 0.02, cy - 0.08, nz, { b: 0.002 });
    r.cyl(M.rubber, 0.03, 0.03, 0.022, 0.02, 0.03, nz, { r: [Math.PI / 2, 0, 0], seg: 8 });
  }
  r.cyl(M.rubber, 0.022, 0.022, 0.016, 0.45, 0.022, 0, { r: [Math.PI / 2, 0, 0], seg: 8 });
  r.box(M.dark, 0.012, 0.08, 0.012, 0.45, 0.06, 0, { b: 0.002 });
  // tail: fin + stabilisers + tail gunner
  r.add(
    prismXY(
      [
        [-0.5, 0.0],
        [-0.7, 0.0],
        [-0.74, 0.24],
        [-0.64, 0.24],
      ],
      0.02,
      0.006,
    ),
    M.teamDark,
    { p: [0, cy + 0.05, 0] },
  );
  sovietStar(r, 0.04, [-0.66, cy + 0.17, 0.0105], faceRot('+z'));
  sovietStar(r, 0.04, [-0.66, cy + 0.17, -0.0105], faceRot('-z'));
  r.add(
    prismXZ(
      [
        [-0.58, 0.04],
        [-0.68, 0.3],
        [-0.74, 0.3],
        [-0.72, 0.04],
        [-0.72, -0.04],
        [-0.74, -0.3],
        [-0.68, -0.3],
        [-0.58, -0.04],
      ],
      0.014,
      0.004,
    ),
    M.teamDark,
    { p: [0, cy + 0.01, 0] },
  );
  r.sph(M.glassBlue, 0.028, -0.75, cy + 0.0, 0, { seg: 8 });
  for (const s of [-1, 1]) r.cyl(M.dark, 0.004, 0.004, 0.06, -0.8, cy, 0.01 * s, { r: [0, 0, Math.PI / 2], seg: 4 });
  // dorsal turret
  r.sph(M.glassBlue, 0.03, 0.15, cy + 0.085, 0, { seg: 8, s: [1, 0.7, 1] });
  r.sph(G.red, 0.009, -0.3, cy + 0.09, 0, { seg: 4, slot: 'glow:strobe' });
  r.node('m0', [0.0, cy - 0.1, 0]);
  r.node('m1', [0.05, cy - 0.1, 0]);

  return makeTemplate({
    root: r,
    height: 0.36,
    radius: 0.85,
    muzzles: ['m0', 'm1'],
    smoke: ['exL', 'exR'],
    glow: { 'glow:strobe': 5 },
    anim: (c, s) => {
      healthVariant(c, s);
      const dt = dtOf(s);
      const target = airborne(s) ? 1 : 0;
      const p = (c.v.rotor = approach(c.v.rotor ?? target, target, 1.5, dt));
      c.n.propL.rotation.x += Math.min(dt * 40 * p, 0.5);
      c.n.propR.rotation.x -= Math.min(dt * 40 * p, 0.5);
      c.n['fx:pdiscL'].visible = p > 0.35;
      c.n['fx:pdiscR'].visible = p > 0.35;
      const d = (c.v.bay = approach(c.v.bay ?? 0, Math.min(1, Math.max(0, s.deployed ?? 0)), 5, dt));
      c.n.bayL.rotation.x = -d * 1.3;
      c.n.bayR.rotation.x = d * 1.3;
      c.setGlow('glow:strobe', blink(s.time, 1.4, 0.12) ? 1 : 0);
    },
  });
}

// =============================================================================================
// U2 spy plane (Allied power) — long glider wings, slim black fuselage
// =============================================================================================

function u2(): ModelTemplate {
  const r = new NB('root');
  const cy = 0.09;
  const BLACK = { c: 0x26282c, m: 0.4, r: 0.38, d: 0 };
  r.add(
    lathe(
      [
        [0.0, -0.5],
        [0.022, -0.46],
        [0.038, -0.25],
        [0.048, 0.0],
        [0.046, 0.2],
        [0.035, 0.34],
        [0.0, 0.44],
      ],
      12,
    ),
    BLACK,
    { p: [0, cy, 0], r: [0, 0, -Math.PI / 2], s: [1, 1, 0.9] },
  );
  r.sph(M.glassBlue, 0.03, 0.22, cy + 0.035, 0, { seg: 10, s: [2.2, 0.8, 0.85] });
  // intakes at the wing roots
  for (const s of [-1, 1]) {
    r.cyl(BLACK, 0.024, 0.02, 0.1, 0.05, cy + 0.01, 0.045 * s, { r: [0, 0, -Math.PI / 2], seg: 8 });
    r.add(new THREE.CircleGeometry(0.018, 6), M.darker, { p: [0.101, cy + 0.01, 0.045 * s], r: [0, Math.PI / 2, 0] });
  }
  // long straight glider wings (slight taper), wingtip skids
  r.add(
    prismXZ(
      [
        [0.08, 0.04],
        [0.03, 0.95],
        [-0.02, 0.95],
        [-0.06, 0.04],
        [-0.06, -0.04],
        [-0.02, -0.95],
        [0.03, -0.95],
        [0.08, -0.04],
      ],
      0.012,
      0.004,
    ),
    BLACK,
    { p: [0, cy - 0.005, 0] },
  );
  for (const s of [-1, 1]) {
    r.box(M.team, 0.05, 0.004, 0.14, 0.005, cy + 0.008, 0.78 * s, { b: 0 });
    r.box(M.dark, 0.06, 0.02, 0.006, 0.0, cy - 0.01, 0.95 * s, { b: 0 });
    r.sph(s < 0 ? G.red : G.green, 0.008, 0.0, cy, 0.955 * s, { seg: 4, slot: 'glow' });
  }
  // tail
  r.add(
    prismXY(
      [
        [-0.32, 0.0],
        [-0.46, 0.0],
        [-0.5, 0.16],
        [-0.43, 0.16],
      ],
      0.012,
      0.004,
    ),
    BLACK,
    { p: [0, cy + 0.02, 0] },
  );
  r.box(M.team, 0.06, 0.03, 0.014, -0.45, cy + 0.15, 0, { b: 0.003 });
  r.add(
    prismXZ(
      [
        [-0.38, 0.02],
        [-0.45, 0.17],
        [-0.49, 0.17],
        [-0.47, 0.02],
        [-0.47, -0.02],
        [-0.49, -0.17],
        [-0.45, -0.17],
        [-0.38, -0.02],
      ],
      0.008,
      0.003,
    ),
    BLACK,
    { p: [0, cy + 0.01, 0] },
  );
  alliedStar(r, 0.03, [-0.1, cy + 0.0065, 0.55]);
  alliedStar(r, 0.03, [-0.1, cy + 0.0065, -0.55]);
  r.cyl(M.darker, 0.018, 0.022, 0.03, -0.51, cy, 0, { r: [0, 0, Math.PI / 2], seg: 8 });
  r.node('ex', [-0.53, cy, 0]);
  // camera bay under the nose (glints)
  r.sph(M.glass, 0.015, 0.28, cy - 0.04, 0, { seg: 6 });
  r.sph(G.white, 0.007, -0.48, cy + 0.17, 0, { seg: 4, slot: 'glow:strobe' });
  // bicycle gear
  r.cyl(M.rubber, 0.018, 0.018, 0.014, 0.12, 0.018, 0, { r: [Math.PI / 2, 0, 0], seg: 8 });
  r.cyl(M.rubber, 0.014, 0.014, 0.012, -0.3, 0.018, 0, { r: [Math.PI / 2, 0, 0], seg: 8 });
  r.box(M.dark, 0.01, 0.05, 0.01, 0.12, 0.05, 0, { b: 0 });

  return makeTemplate({
    root: r,
    height: 0.26,
    radius: 0.9,
    muzzles: [],
    smoke: ['ex'],
    glow: { 'glow:strobe': 5 },
    anim: (c, s) => {
      healthVariant(c, s);
      c.setGlow('glow:strobe', blink(s.time, 1.5, 0.1) ? 1 : 0);
    },
  });
}

export const AIRCRAFT_BUILDERS: Record<string, () => ModelTemplate> = {
  heli: longbow,
  hind,
  mig,
  yak,
  tran: chinook,
  badr: badger,
  u2,
};
