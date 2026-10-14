/**
 * Ground vehicles. All face +X, origin at ground centre.
 * Muzzle ordering for twin weapons: index 0 = left barrel (-Z), 1 = right barrel (+Z).
 */
import * as THREE from 'three';
import { NB, makeTemplate, type ModelTemplate, type V3 } from './builder';
import {
  M,
  G,
  alliedStar,
  antenna,
  barrel,
  faceRot,
  grille,
  hazard,
  lamp,
  pipe,
  prismXY,
  prismXZ,
  lathe,
  sovietStar,
  stowage,
  tracks,
  wheel,
  orePile,
} from './parts';
import { animTracks, animWheels, approach, blink, dtOf, healthVariant, recoil } from './anim';

const VEH_AO = { h: 0.12, min: 0.55 };

function root(): NB {
  const r = new NB('root');
  r.ao = VEH_AO;
  return r;
}

function headlights(nb: NB, x: number, y: number, z: number, size = 0.014): void {
  for (const s of [-1, 1]) {
    nb.box(M.dark, 0.016, size * 1.6, size * 1.8, x - 0.004, y, z * s, { b: 0.003 });
    nb.add(new THREE.SphereGeometry(size * 0.75, 8, 6), G.head, { p: [x + 0.003, y, z * s], s: [0.5, 1, 1] });
  }
}

function taillights(nb: NB, x: number, y: number, z: number): void {
  for (const s of [-1, 1]) nb.box(G.red, 0.006, 0.014, 0.022, x, y, z * s, { b: 0, slot: 'glow' });
}

// =============================================================================================
// Light tank (Allied)
// =============================================================================================

function lightTank(): ModelTemplate {
  const r = root();
  tracks(r, { L: 0.7, H: 0.13, W: 0.11, Z: 0.19, wheels: 5 });
  r.box(M.dark, 0.62, 0.07, 0.28, 0, 0.085, 0, { b: 0.01 });
  r.add(
    prismXY(
      [
        [-0.35, 0.11],
        [0.3, 0.11],
        [0.37, 0.155],
        [0.24, 0.205],
        [-0.33, 0.21],
        [-0.36, 0.17],
      ],
      0.32,
      0.012,
    ),
    M.team,
  );
  // fender lips over track ends
  for (const s of [-1, 1]) {
    r.box(M.teamDark, 0.12, 0.012, 0.13, 0.31, 0.155, 0.19 * s, { b: 0.004, r: [0, 0, -0.35] });
    r.box(M.teamDark, 0.08, 0.012, 0.13, -0.33, 0.15, 0.19 * s, { b: 0.004, r: [0, 0, 0.2] });
    stowage(r, 0.1, 0.035, 0.05, -0.12, 0.2, 0.135 * s, M.olive);
  }
  grille(r, 0.13, 0.2, [-0.25, 0.211, 0], 6);
  headlights(r, 0.34, 0.17, 0.11, 0.012);
  taillights(r, -0.36, 0.18, 0.12);
  // tow cable
  r.cyl(M.steel, 0.006, 0.006, 0.26, -0.36, 0.13, 0, { r: [Math.PI / 2, 0, 0] });

  const t = r.node('turret', [-0.03, 0.21, 0]);
  t.add(
    prismXZ(
      [
        [0.13, -0.06],
        [0.13, 0.06],
        [0.06, 0.115],
        [-0.1, 0.12],
        [-0.16, 0.08],
        [-0.16, -0.08],
        [-0.1, -0.12],
        [0.06, -0.115],
      ],
      0.085,
      0.022,
    ),
    M.team,
  );
  t.box(M.gun, 0.05, 0.05, 0.08, 0.13, 0.04, 0, { b: 0.01 });
  t.cyl(M.teamDark, 0.032, 0.035, 0.016, -0.05, 0.083, -0.045, { seg: 12 });
  t.cyl(M.gun, 0.018, 0.018, 0.01, -0.05, 0.094, -0.045, { seg: 10 });
  t.box(M.glass, 0.012, 0.01, 0.022, 0.0, 0.08, 0.06, { b: 0.002 });
  alliedStar(t, 0.026, [-0.06, 0.0755, 0.05]);
  antenna(t, -0.13, 0.075, 0.07, 0.2);
  const b0 = t.node('b0', [0.15, 0.04, 0]);
  barrel(b0, 0.27, 0.014, { brake: true });
  t.node('m0', [0.43, 0.04, 0]);

  return makeTemplate({
    root: r,
    height: 0.32,
    radius: 0.38,
    turret: 'turret',
    muzzles: ['m0'],
    glow: { glow: 2.5 },
    anim: (c, s) => {
      healthVariant(c, s);
      animTracks(c, s);
      recoil(c, s, ['b0'], 0.05);
    },
  });
}

// =============================================================================================
// Medium tank (Allied, Abrams-like)
// =============================================================================================

function mediumTank(): ModelTemplate {
  const r = root();
  tracks(r, { L: 0.8, H: 0.14, W: 0.125, Z: 0.21, wheels: 6 });
  r.box(M.dark, 0.72, 0.07, 0.3, 0, 0.09, 0, { b: 0.01 });
  r.add(
    prismXY(
      [
        [-0.4, 0.11],
        [0.33, 0.11],
        [0.43, 0.16],
        [0.3, 0.225],
        [-0.38, 0.23],
        [-0.41, 0.19],
      ],
      0.36,
      0.014,
    ),
    M.team,
  );
  // side skirts
  for (const s of [-1, 1]) {
    r.add(
      prismXY(
        [
          [-0.39, 0.085],
          [0.36, 0.085],
          [0.42, 0.15],
          [-0.4, 0.15],
        ],
        0.014,
        0.004,
      ),
      M.teamDark,
      { p: [0, 0, (0.21 + 0.068) * s] },
    );
    r.box(M.teamDark, 0.78, 0.01, 0.06, 0, 0.152, 0.25 * s, { b: 0.003 });
  }
  grille(r, 0.15, 0.24, [-0.3, 0.231, 0], 7);
  headlights(r, 0.4, 0.18, 0.12, 0.012);
  taillights(r, -0.4, 0.19, 0.13);

  const t = r.node('turret', [-0.04, 0.228, 0]);
  t.add(
    prismXZ(
      [
        [0.21, -0.045],
        [0.21, 0.045],
        [0.1, 0.15],
        [-0.15, 0.16],
        [-0.25, 0.125],
        [-0.25, -0.125],
        [-0.15, -0.16],
        [0.1, -0.15],
      ],
      0.09,
      0.028,
    ),
    M.team,
  );
  // bustle rack
  t.box(M.dark, 0.06, 0.008, 0.24, -0.28, 0.05, 0, { b: 0 });
  for (const z of [-0.11, 0, 0.11]) t.box(M.dark, 0.06, 0.04, 0.006, -0.28, 0.03, z, { b: 0 });
  stowage(t, 0.05, 0.03, 0.08, -0.28, 0.0, -0.06, M.khaki);
  stowage(t, 0.05, 0.03, 0.07, -0.28, 0.0, 0.06, M.olive);
  // mantlet
  t.box(M.teamDark, 0.05, 0.06, 0.11, 0.21, 0.04, 0, { b: 0.014 });
  // commander cupola + MG
  t.cyl(M.teamDark, 0.034, 0.038, 0.022, -0.08, 0.1, 0.07, { seg: 14 });
  t.box(M.gun, 0.07, 0.01, 0.01, -0.04, 0.12, 0.07, { b: 0 });
  t.cyl(M.teamDark, 0.03, 0.03, 0.01, -0.06, 0.094, -0.07, { seg: 12 });
  t.box(M.glass, 0.03, 0.016, 0.03, 0.06, 0.094, -0.08, { b: 0.004 });
  alliedStar(t, 0.028, [-0.1, 0.0905, -0.0]);
  antenna(t, -0.22, 0.09, 0.1, 0.22);
  antenna(t, -0.22, 0.09, -0.1, 0.16);
  const b0 = t.node('b0', [0.22, 0.04, 0]);
  barrel(b0, 0.36, 0.0145, { sleeve: true });
  t.node('m0', [0.59, 0.04, 0]);

  return makeTemplate({
    root: r,
    height: 0.34,
    radius: 0.42,
    turret: 'turret',
    muzzles: ['m0'],
    glow: { glow: 2.5 },
    anim: (c, s) => {
      healthVariant(c, s);
      animTracks(c, s);
      recoil(c, s, ['b0'], 0.06);
    },
  });
}

// =============================================================================================
// Heavy tank (Soviet, twin barrels)
// =============================================================================================

function heavyTank(): ModelTemplate {
  const r = root();
  tracks(r, { L: 0.88, H: 0.15, W: 0.14, Z: 0.235, wheels: 6 });
  r.box(M.dark, 0.8, 0.08, 0.34, 0, 0.095, 0, { b: 0.01 });
  r.add(
    prismXY(
      [
        [-0.45, 0.12],
        [0.36, 0.12],
        [0.47, 0.17],
        [0.33, 0.235],
        [-0.42, 0.24],
        [-0.46, 0.2],
      ],
      0.4,
      0.016,
    ),
    M.team,
  );
  // ERA bricks on the glacis
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < 5; i++) {
      const z = -0.16 + i * 0.08;
      const x = 0.37 + row * 0.055;
      const y = 0.217 - row * 0.024;
      r.box(M.teamDark, 0.05, 0.014, 0.072, x, y, z, { b: 0.004, r: [0, 0, -0.41] });
    }
  }
  // fenders with stowage boxes (rear half)
  for (const s of [-1, 1]) {
    r.box(M.teamDark, 0.86, 0.01, 0.07, 0, 0.16, 0.268 * s, { b: 0.003 });
    stowage(r, 0.14, 0.04, 0.05, -0.2, 0.165, 0.27 * s, M.teamDark);
    stowage(r, 0.1, 0.04, 0.05, -0.04, 0.165, 0.27 * s, M.olive);
  }
  // fuel drums at rear
  for (const z of [-0.1, 0.1]) {
    r.cyl(M.oliveDark, 0.035, 0.035, 0.17, -0.475, 0.23, z, { r: [Math.PI / 2, 0, 0], seg: 12 });
    r.cyl(M.steel, 0.037, 0.037, 0.008, -0.475, 0.23, z - 0.06, { r: [Math.PI / 2, 0, 0], seg: 12 });
    r.cyl(M.steel, 0.037, 0.037, 0.008, -0.475, 0.23, z + 0.06, { r: [Math.PI / 2, 0, 0], seg: 12 });
  }
  grille(r, 0.14, 0.26, [-0.33, 0.241, 0], 7);
  headlights(r, 0.43, 0.19, 0.15, 0.012);
  taillights(r, -0.45, 0.2, 0.15);

  const t = r.node('turret', [-0.05, 0.236, 0]);
  t.add(
    lathe(
      [
        [0.0, 0.115],
        [0.1, 0.112],
        [0.17, 0.09],
        [0.205, 0.05],
        [0.215, 0.015],
        [0.205, 0.0],
        [0.0, 0.0],
      ],
      20,
    ),
    M.team,
    { s: [1.08, 1, 1] },
  );
  // mantlet block
  t.box(M.teamDark, 0.08, 0.06, 0.18, 0.2, 0.05, 0, { b: 0.018, seg: 2 });
  // hatch, DShK, IR light
  t.cyl(M.teamDark, 0.035, 0.038, 0.014, -0.06, 0.12, 0.06, { seg: 12 });
  t.cyl(M.teamDark, 0.03, 0.032, 0.012, -0.06, 0.118, -0.07, { seg: 12 });
  t.box(M.gun, 0.11, 0.01, 0.01, 0.0, 0.14, -0.07, { b: 0 });
  t.box(M.gun, 0.02, 0.025, 0.01, -0.04, 0.128, -0.07, { b: 0 });
  t.cyl(M.dark, 0.022, 0.022, 0.03, 0.14, 0.1, 0.11, { r: [0, 0, -Math.PI / 2], seg: 10 });
  t.add(new THREE.CircleGeometry(0.017, 10), G.white, { p: [0.156, 0.1, 0.11], r: [0, Math.PI / 2, 0], slot: 'glow' });
  // smoke dischargers
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      t.cyl(M.dark, 0.008, 0.008, 0.03, 0.14 - i * 0.025, 0.07, 0.17 * s, { r: [0.5 * s, 0, -0.6], seg: 6 });
    }
  }
  sovietStar(t, 0.03, [0.06, 0.1135, 0], [0, 0, -0.05]);
  antenna(t, -0.18, 0.06, -0.12, 0.2);
  for (const [i, z] of [
    [0, -0.048],
    [1, 0.048],
  ] as const) {
    const b = t.node(`b${i}`, [0.23, 0.05, z]);
    barrel(b, 0.4, 0.0145, { sleeve: true });
    t.node(`m${i}`, [0.64, 0.05, z]);
  }

  return makeTemplate({
    root: r,
    height: 0.37,
    radius: 0.46,
    turret: 'turret',
    muzzles: ['m0', 'm1'],
    glow: { glow: 2.5 },
    anim: (c, s) => {
      healthVariant(c, s);
      animTracks(c, s);
      recoil(c, s, ['b0', 'b1'], 0.06);
    },
  });
}

// =============================================================================================
// Mammoth tank (Soviet, twin big barrels + missile pods, four tracks)
// =============================================================================================

function mammothTank(): ModelTemplate {
  const r = root();
  tracks(r, { L: 1.06, H: 0.17, W: 0.12, Z: 0.2, wheels: 7 });
  tracks(r, { L: 1.1, H: 0.17, W: 0.125, Z: 0.345, wheels: 7 });
  r.box(M.dark, 1.0, 0.09, 0.62, 0, 0.11, 0, { b: 0.012 });
  r.add(
    prismXY(
      [
        [-0.56, 0.13],
        [0.47, 0.13],
        [0.585, 0.2],
        [0.44, 0.275],
        [-0.52, 0.285],
        [-0.575, 0.235],
      ],
      0.46,
      0.02,
    ),
    M.team,
  );
  // armoured track pods between the track pairs
  for (const s of [-1, 1]) {
    r.add(
      prismXY(
        [
          [-0.52, 0.16],
          [0.5, 0.16],
          [0.56, 0.2],
          [0.48, 0.215],
          [-0.5, 0.215],
          [-0.55, 0.19],
        ],
        0.07,
        0.01,
      ),
      M.teamDark,
      { p: [0, 0, 0.272 * s] },
    );
    // exhaust stacks
    r.cyl(M.dark, 0.02, 0.024, 0.08, -0.43, 0.3, 0.17 * s, { seg: 10 });
    r.cyl(M.darker, 0.016, 0.016, 0.005, -0.43, 0.342, 0.17 * s, { seg: 10 });
  }
  grille(r, 0.18, 0.3, [-0.38, 0.286, 0], 8);
  // front armour plate seams
  for (let i = 0; i < 4; i++) r.box(M.teamDark, 0.06, 0.02, 0.1, 0.5, 0.235, -0.165 + i * 0.11, { b: 0.006, r: [0, 0, -0.5] });
  headlights(r, 0.55, 0.22, 0.18, 0.015);
  taillights(r, -0.57, 0.23, 0.18);

  const t = r.node('turret', [-0.05, 0.283, 0]);
  t.add(
    prismXZ(
      [
        [0.27, -0.1],
        [0.27, 0.1],
        [0.17, 0.2],
        [-0.19, 0.21],
        [-0.3, 0.15],
        [-0.3, -0.15],
        [-0.19, -0.21],
        [0.17, -0.2],
      ],
      0.1,
      0.03,
    ),
    M.team,
  );
  t.add(
    prismXZ(
      [
        [0.15, -0.12],
        [0.15, 0.12],
        [-0.15, 0.14],
        [-0.22, 0.1],
        [-0.22, -0.1],
        [-0.15, -0.14],
      ],
      0.03,
      0.01,
    ),
    M.teamDark,
    { p: [0, 0.1, 0] },
  );
  t.box(M.teamDark, 0.08, 0.085, 0.26, 0.27, 0.055, 0, { b: 0.022, seg: 2 });
  t.cyl(M.gun, 0.04, 0.044, 0.02, -0.1, 0.14, 0.07, { seg: 14 });
  t.cyl(M.gun, 0.034, 0.036, 0.018, -0.1, 0.14, -0.07, { seg: 14 });
  sovietStar(t, 0.045, [0.02, 0.1305, 0]);
  antenna(t, -0.26, 0.1, 0.12, 0.24);
  // twin cannons
  for (const [i, z] of [
    [0, -0.075],
    [1, 0.075],
  ] as const) {
    const b = t.node(`b${i}`, [0.3, 0.055, z]);
    barrel(b, 0.47, 0.022, { brake: true, sleeve: true });
    t.node(`m${i}`, [0.79, 0.055, z]);
  }
  // missile pods on turret sides
  for (const [i, s] of [
    [2, -1],
    [3, 1],
  ] as const) {
    const z = 0.27 * s;
    t.box(M.teamDark, 0.26, 0.1, 0.1, -0.02, 0.06, z, { b: 0.016, seg: 1 });
    t.box(M.gun, 0.05, 0.03, 0.06, -0.02, 0.02, 0.215 * s, { b: 0.006 });
    for (const dy of [-0.024, 0.024]) {
      for (const dz of [-0.024, 0.024]) {
        t.cyl(M.darker, 0.017, 0.017, 0.012, 0.106, 0.06 + dy, z + dz, { r: [0, 0, -Math.PI / 2], seg: 10 });
        t.add(new THREE.ConeGeometry(0.013, 0.028, 8), M.red, { p: [0.112, 0.06 + dy, z + dz], r: [0, 0, -Math.PI / 2] });
      }
    }
    sovietStar(t, 0.022, [-0.04, 0.06, z + 0.0505 * s], faceRot(s > 0 ? '+z' : '-z'));
    t.node(`m${i}`, [0.13, 0.06, z]);
  }

  return makeTemplate({
    root: r,
    height: 0.45,
    radius: 0.6,
    turret: 'turret',
    muzzles: ['m0', 'm1', 'm2', 'm3'],
    glow: { glow: 2.5 },
    anim: (c, s) => {
      healthVariant(c, s);
      animTracks(c, s, 9);
      // muzzles 0/1 are cannons; 2/3 missile pods (no recoil)
      recoil(c, s, ['b0', 'b1'], 0.07);
    },
  });
}

// =============================================================================================
// Ranger jeep (Allied)
// =============================================================================================

function jeep(): ModelTemplate {
  const r = root();
  const wr = 0.062;
  const axles: [string, number][] = [
    ['w0', 0.175],
    ['w1', -0.17],
  ];
  for (const [name, x] of axles) {
    const a = r.node(name, [x, wr, 0]);
    for (const s of [-1, 1]) wheel(a, wr, 0.05, [0, 0, 0.145 * s]);
    a.cyl(M.dark, 0.012, 0.012, 0.26, 0, 0, 0, { r: [Math.PI / 2, 0, 0], seg: 6 });
  }
  r.box(M.dark, 0.52, 0.04, 0.2, 0, 0.075, 0, { b: 0.008 });
  // body tub
  r.add(
    prismXY(
      [
        [-0.29, 0.085],
        [0.27, 0.085],
        [0.305, 0.12],
        [0.3, 0.155],
        [0.08, 0.17],
        [0.04, 0.165],
        [-0.29, 0.165],
      ],
      0.26,
      0.012,
    ),
    M.team,
  );
  // wheel arches / fenders
  for (const [, x] of axles) {
    for (const s of [-1, 1]) {
      r.box(M.teamDark, 0.15, 0.014, 0.065, x, 0.15, 0.148 * s, { b: 0.006 });
    }
  }
  // seats & interior
  r.box(M.darker, 0.24, 0.01, 0.22, -0.12, 0.166, 0, { b: 0 });
  for (const z of [-0.06, 0.06]) {
    r.box(M.webbing, 0.06, 0.03, 0.07, -0.0, 0.18, z, { b: 0.008 });
    r.box(M.webbing, 0.015, 0.06, 0.07, -0.035, 0.205, z, { b: 0.005 });
  }
  // windscreen
  r.box(M.dark, 0.012, 0.08, 0.25, 0.07, 0.21, 0, { b: 0.003, r: [0, 0, 0.35] });
  r.box(M.glassBlue, 0.006, 0.064, 0.23, 0.073, 0.21, 0, { b: 0, r: [0, 0, 0.35] });
  // roll bar
  pipe(r, [-0.06, 0.165, -0.12], [-0.06, 0.29, -0.1], 0.008, M.dark);
  pipe(r, [-0.06, 0.165, 0.12], [-0.06, 0.29, 0.1], 0.008, M.dark);
  pipe(r, [-0.06, 0.29, -0.1], [-0.06, 0.29, 0.1], 0.008, M.dark);
  // grille and lights
  r.box(M.dark, 0.008, 0.035, 0.12, 0.304, 0.135, 0, { b: 0 });
  headlights(r, 0.3, 0.14, 0.09, 0.011);
  taillights(r, -0.292, 0.14, 0.11);
  // spare tyre & jerry cans
  r.cyl(M.rubber, 0.05, 0.05, 0.03, -0.3, 0.16, 0, { r: [0, 0, Math.PI / 2], seg: 14 });
  stowage(r, 0.04, 0.05, 0.03, -0.25, 0.165, -0.09, M.olive);
  alliedStar(r, 0.03, [0.18, 0.163, 0], [0, 0, -0.05]);
  antenna(r, -0.27, 0.165, 0.11, 0.22);

  // pintle MG turret
  const t = r.node('turret', [-0.15, 0.18, 0]);
  t.cyl(M.dark, 0.012, 0.016, 0.08, 0, 0.04, 0, { seg: 8 });
  t.box(M.gun, 0.1, 0.028, 0.03, 0.02, 0.09, 0, { b: 0.006 });
  t.box(M.teamDark, 0.012, 0.06, 0.09, 0.07, 0.095, 0, { b: 0.004 });
  t.box(M.gun, 0.03, 0.03, 0.012, 0.0, 0.085, 0.022, { b: 0.004 });
  const b0 = t.node('b0', [0.07, 0.09, 0]);
  barrel(b0, 0.13, 0.006, { mat: M.dark });
  t.node('m0', [0.205, 0.09, 0]);

  const wheels = ['w0', 'w1'] as const;
  return makeTemplate({
    root: r,
    height: 0.3,
    radius: 0.32,
    turret: 'turret',
    muzzles: ['m0'],
    glow: { glow: 2.5 },
    anim: (c, s) => {
      healthVariant(c, s);
      animWheels(c, s, wheels, wr, 3);
      recoil(c, s, ['b0'], 0.012);
    },
  });
}

// =============================================================================================
// APC (Allied, M113-like)
// =============================================================================================

function apc(): ModelTemplate {
  const r = root();
  tracks(r, { L: 0.7, H: 0.12, W: 0.11, Z: 0.2, wheels: 5 });
  r.box(M.dark, 0.64, 0.06, 0.3, 0, 0.08, 0, { b: 0.008 });
  r.add(
    prismXY(
      [
        [-0.36, 0.09],
        [0.3, 0.09],
        [0.375, 0.15],
        [0.27, 0.265],
        [-0.355, 0.265],
      ],
      0.37,
      0.016,
    ),
    M.team,
  );
  // trim vane on glacis
  r.box(M.teamDark, 0.012, 0.09, 0.3, 0.335, 0.2, 0, { b: 0.004, r: [0, 0, 0.83] });
  // top hatches
  r.box(M.teamDark, 0.22, 0.012, 0.2, -0.17, 0.27, 0, { b: 0.006 });
  r.box(M.dark, 0.2, 0.002, 0.004, -0.17, 0.277, 0, { b: 0 });
  r.cyl(M.teamDark, 0.035, 0.035, 0.012, 0.08, 0.27, 0.09, { seg: 12 });
  grille(r, 0.08, 0.12, [0.17, 0.267, 0.1], 4);
  // rear ramp outline
  r.box(M.teamDark, 0.01, 0.15, 0.3, -0.36, 0.175, 0, { b: 0.004 });
  // side storage
  for (const s of [-1, 1]) stowage(r, 0.16, 0.04, 0.03, -0.12, 0.2, 0.2 * s, M.olive);
  headlights(r, 0.36, 0.19, 0.13, 0.012);
  taillights(r, -0.368, 0.23, 0.15);
  alliedStar(r, 0.032, [-0.17, 0.2765, 0.0]);
  antenna(r, -0.33, 0.265, 0.16, 0.24);
  antenna(r, -0.33, 0.265, -0.16, 0.18);
  // commander MG with shield
  const mg = r.node('mg', [0.05, 0.265, -0.07]);
  mg.cyl(M.gun, 0.035, 0.04, 0.025, 0, 0.012, 0, { seg: 12 });
  mg.box(M.teamDark, 0.012, 0.06, 0.1, 0.05, 0.05, 0, { b: 0.004 });
  mg.box(M.gun, 0.08, 0.025, 0.025, 0.01, 0.045, 0, { b: 0.005 });
  const b0 = mg.node('b0', [0.05, 0.045, 0]);
  barrel(b0, 0.12, 0.006, { mat: M.dark });
  mg.node('m0', [0.18, 0.045, 0]);

  return makeTemplate({
    root: r,
    height: 0.34,
    radius: 0.38,
    muzzles: ['m0'],
    glow: { glow: 2.5 },
    anim: (c, s) => {
      healthVariant(c, s);
      animTracks(c, s);
      recoil(c, s, ['b0'], 0.012);
    },
  });
}

// =============================================================================================
// Artillery (Allied)
// =============================================================================================

function artillery(): ModelTemplate {
  const r = root();
  tracks(r, { L: 0.64, H: 0.12, W: 0.11, Z: 0.18, wheels: 5, x: -0.04 });
  r.box(M.dark, 0.58, 0.06, 0.27, -0.04, 0.08, 0, { b: 0.008 });
  r.add(
    prismXY(
      [
        [-0.37, 0.09],
        [0.22, 0.09],
        [0.3, 0.13],
        [0.24, 0.175],
        [-0.36, 0.175],
      ],
      0.34,
      0.012,
    ),
    M.team,
  );
  headlights(r, 0.28, 0.15, 0.1, 0.011);
  taillights(r, -0.372, 0.15, 0.13);
  // gun house (open-top casemate)
  const h = r.node('house', [-0.1, 0.175, 0]);
  h.add(
    prismXY(
      [
        [-0.24, 0],
        [0.1, 0],
        [0.17, 0.06],
        [0.12, 0.115],
        [-0.22, 0.115],
      ],
      0.3,
      0.014,
    ),
    M.team,
  );
  h.box(M.darker, 0.24, 0.01, 0.24, -0.06, 0.112, 0, { b: 0 });
  h.box(M.teamDark, 0.34, 0.012, 0.03, -0.05, 0.12, 0.135, { b: 0.004 });
  h.box(M.teamDark, 0.34, 0.012, 0.03, -0.05, 0.12, -0.135, { b: 0.004 });
  for (let i = 0; i < 4; i++) h.cyl(M.brass, 0.012, 0.012, 0.06, -0.18 + i * 0.03, 0.14, 0.09, { seg: 8 });
  stowage(h, 0.08, 0.04, 0.06, -0.15, 0.11, -0.07, M.olive);
  alliedStar(h, 0.028, [-0.04, 0.05, 0.151], faceRot('+z'));
  antenna(h, -0.22, 0.115, -0.12, 0.2);
  // elevated gun
  const gun = r.node('gun', [0.04, 0.27, 0], [0, 0, 0.2]);
  gun.box(M.teamDark, 0.08, 0.06, 0.1, -0.02, 0, 0, { b: 0.014 });
  gun.cyl(M.steel, 0.009, 0.009, 0.16, 0.08, -0.03, 0.03, { r: [0, 0, -Math.PI / 2], seg: 8 });
  gun.cyl(M.steel, 0.009, 0.009, 0.16, 0.08, -0.03, -0.03, { r: [0, 0, -Math.PI / 2], seg: 8 });
  const b0 = gun.node('b0', [0.02, 0, 0]);
  barrel(b0, 0.52, 0.017, { brake: true });
  gun.node('m0', [0.56, 0, 0]);
  // rear spades
  for (const s of [-1, 1]) r.box(M.dark, 0.03, 0.08, 0.06, -0.39, 0.12, 0.1 * s, { b: 0.006, r: [0, 0, 0.5] });

  return makeTemplate({
    root: r,
    height: 0.4,
    radius: 0.42,
    muzzles: ['m0'],
    glow: { glow: 2.5 },
    anim: (c, s) => {
      healthVariant(c, s);
      animTracks(c, s);
      recoil(c, s, ['b0'], 0.09);
    },
  });
}

// =============================================================================================
// V2 rocket launcher (Soviet)
// =============================================================================================

function v2Rocket(nb: NB): void {
  // V2 lying along +X, centred on origin. Black/white quartered paint.
  const L = 0.5;
  const R = 0.05;
  const segs: [number, number, boolean][] = [
    [-0.25, -0.07, false],
    [-0.07, 0.1, true],
  ];
  for (const [x0, x1, inv] of segs) {
    for (let q = 0; q < 4; q++) {
      const black = (q % 2 === 0) !== inv;
      const g = new THREE.CylinderGeometry(R, R * (x0 < -0.2 ? 0.9 : 1), x1 - x0, 6, 1, true, (q * Math.PI) / 2 + Math.PI / 4, Math.PI / 2);
      nb.add(g, black ? M.black : M.white, { p: [(x0 + x1) / 2, 0, 0], r: [0, 0, -Math.PI / 2] });
    }
  }
  // ogive nose
  nb.add(
    lathe(
      [
        [R, 0],
        [R * 0.95, 0.04],
        [R * 0.75, 0.09],
        [R * 0.4, 0.13],
        [0.004, 0.155],
      ],
      14,
    ),
    M.team,
    { p: [0.1, 0, 0], r: [0, 0, -Math.PI / 2] },
  );
  nb.cyl(M.red, R * 1.01, R * 1.01, 0.012, 0.105, 0, 0, { r: [0, 0, -Math.PI / 2], seg: 14 });
  // tail cone + nozzle
  nb.cyl(M.dark, R * 0.9, R * 0.55, 0.04, -L / 2 - 0.02, 0, 0, { r: [0, 0, -Math.PI / 2], seg: 12 });
  // fins
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    nb.add(
      prismXY(
        [
          [-0.27, 0],
          [-0.16, 0],
          [-0.24, 0.075],
          [-0.28, 0.075],
        ],
        0.006,
        0,
      ),
      i % 2 ? M.black : M.white,
      { r: [a, 0, 0] },
    );
  }
}

function v2Launcher(): ModelTemplate {
  const r = root();
  const wr = 0.068;
  const axles: [string, number][] = [
    ['w0', 0.32],
    ['w1', -0.14],
    ['w2', -0.31],
  ];
  for (const [name, x] of axles) {
    const a = r.node(name, [x, wr, 0]);
    for (const s of [-1, 1]) wheel(a, wr, 0.055, [0, 0, 0.165 * s]);
    a.cyl(M.dark, 0.012, 0.012, 0.28, 0, 0, 0, { r: [Math.PI / 2, 0, 0], seg: 6 });
  }
  r.box(M.dark, 0.9, 0.05, 0.22, -0.01, 0.09, 0, { b: 0.008 });
  // cab
  r.add(
    prismXY(
      [
        [0.21, 0.1],
        [0.48, 0.1],
        [0.49, 0.175],
        [0.43, 0.275],
        [0.23, 0.285],
      ],
      0.32,
      0.016,
    ),
    M.team,
  );
  r.box(M.glassBlue, 0.07, 0.07, 0.27, 0.452, 0.235, 0, { b: 0.004, r: [0, 0, 0.98] });
  for (const s of [-1, 1]) r.box(M.glassBlue, 0.1, 0.05, 0.004, 0.33, 0.235, 0.161 * s, { b: 0 });
  r.box(M.dark, 0.012, 0.04, 0.2, 0.488, 0.14, 0, { b: 0 });
  headlights(r, 0.49, 0.15, 0.115, 0.012);
  r.box(M.teamDark, 0.14, 0.012, 0.2, 0.32, 0.29, 0, { b: 0.004 });
  lamp(r, G.amber, [0.3, 0.305, 0.07], 0.016, 'glow:beacon');
  sovietStar(r, 0.03, [0.33, 0.235, 0.161], faceRot('+z'));
  sovietStar(r, 0.03, [0.33, 0.235, -0.161], faceRot('-z'));
  // flatbed
  r.box(M.teamDark, 0.66, 0.035, 0.32, -0.15, 0.13, 0, { b: 0.008 });
  for (const [, x] of axles.slice(1)) {
    for (const s of [-1, 1]) r.box(M.teamDark, 0.15, 0.012, 0.07, x, 0.158, 0.16 * s, { b: 0.004 });
  }
  r.box(M.gun, 0.12, 0.07, 0.24, 0.13, 0.18, 0, { b: 0.01 });
  for (const s of [-1, 1]) stowage(r, 0.14, 0.04, 0.035, -0.12, 0.148, 0.135 * s, M.olive);
  taillights(r, -0.48, 0.13, 0.13);
  hazard(r, 0.3, 0.025, [-0.482, 0.13, 0], [0, -Math.PI / 2, 0]);
  // erector rail (pivot at rear)
  const rail = r.node('rail', [-0.42, 0.18, 0], [0, 0, 0.42]);
  rail.box(M.gun, 0.74, 0.024, 0.07, 0.37, 0.0, 0, { b: 0.006 });
  rail.box(M.steel, 0.74, 0.008, 0.016, 0.37, 0.016, -0.026, { b: 0 });
  rail.box(M.steel, 0.74, 0.008, 0.016, 0.37, 0.016, 0.026, { b: 0 });
  rail.cyl(M.dark, 0.025, 0.025, 0.12, 0, 0, 0, { r: [Math.PI / 2, 0, 0], seg: 10 });
  for (const x of [0.15, 0.4, 0.62]) {
    rail.box(M.gun, 0.02, 0.05, 0.11, x, 0.03, 0, { b: 0.004 });
  }
  // hydraulic ram (rides with rail, reaching down)
  rail.cyl(M.steel, 0.012, 0.012, 0.16, 0.3, -0.06, 0, { r: [0, 0, 0.6], seg: 8 });
  const rocket = rail.node('rocket', [0.38, 0.062, 0]);
  v2Rocket(rocket);
  rail.node('m0', [0.68, 0.062, 0]);

  const wheels = ['w0', 'w1', 'w2'] as const;
  return makeTemplate({
    root: r,
    height: 0.5,
    radius: 0.46,
    muzzles: ['m0'],
    glow: { glow: 2.5, 'glow:beacon': 3.5 },
    anim: (c, s) => {
      healthVariant(c, s);
      animWheels(c, s, wheels, wr, 2.4);
      const dt = dtOf(s);
      const ready = s.charge >= 1;
      c.n.rocket.visible = ready;
      // raise the erector when stationary & loaded, lower while driving / reloading
      const target = s.moving ? 0.1 : ready ? 0.52 : 0.22;
      const rl = c.n.rail;
      rl.rotation.z = approach(rl.rotation.z, target, 2.5, dt);
      c.setGlow('glow:beacon', ready ? 0 : blink(s.time, 0.8, 0.5) ? 1 : 0.15);
    },
  });
}

// =============================================================================================
// Ore truck / harvester
// =============================================================================================

function harvester(): ModelTemplate {
  const r = root();
  tracks(r, { L: 0.92, H: 0.15, W: 0.13, Z: 0.215, wheels: 6, x: -0.04 });
  r.box(M.gun, 0.86, 0.08, 0.36, -0.04, 0.15, 0, { b: 0.012 });
  // cab (front-left)
  const cab = r.node('cab', [0.27, 0.19, -0.13]);
  cab.add(
    prismXY(
      [
        [-0.1, 0],
        [0.12, 0],
        [0.13, 0.08],
        [0.1, 0.15],
        [-0.1, 0.15],
      ],
      0.18,
      0.014,
    ),
    M.team,
  );
  cab.box(M.glassBlue, 0.05, 0.06, 0.15, 0.115, 0.11, 0, { b: 0.004, r: [0, 0, 0.6] });
  cab.box(M.glassBlue, 0.14, 0.05, 0.004, 0.0, 0.1, 0.091, { b: 0 });
  cab.box(M.glassBlue, 0.14, 0.05, 0.004, 0.0, 0.1, -0.091, { b: 0 });
  cab.box(M.teamDark, 0.2, 0.012, 0.19, 0.0, 0.156, 0, { b: 0.004 });
  lamp(cab, G.amber, [-0.03, 0.172, 0.0], 0.018, 'glow:beacon');
  headlights(r, 0.4, 0.27, 0.06, 0.011);
  // exhaust stack
  r.cyl(M.dark, 0.016, 0.018, 0.2, 0.16, 0.29, 0.07, { seg: 10 });
  r.cyl(M.steel, 0.02, 0.02, 0.02, 0.16, 0.39, 0.07, { seg: 10 });
  r.node('exhaust', [0.16, 0.4, 0.07]);
  // front intake housing + drum
  r.add(
    prismXY(
      [
        [0.4, 0.06],
        [0.5, 0.08],
        [0.52, 0.17],
        [0.44, 0.22],
        [0.38, 0.2],
      ],
      0.5,
      0.012,
    ),
    M.teamDark,
  );
  hazard(r, 0.46, 0.03, [0.46, 0.2, 0], [0, Math.PI / 2, 0.0]);
  const drum = r.node('drum', [0.53, 0.075, 0]);
  drum.cyl(M.gun, 0.062, 0.062, 0.46, 0, 0, 0, { r: [Math.PI / 2, 0, 0], seg: 14 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    for (let k = 0; k < 4; k++) {
      const z = -0.18 + k * 0.12 + (i % 2) * 0.06;
      drum.box(M.steel, 0.026, 0.03, 0.04, Math.cos(a) * 0.066, Math.sin(a) * 0.066, z, { r: [0, 0, a], b: 0.004 });
    }
  }
  drum.cyl(M.dark, 0.03, 0.03, 0.48, 0, 0, 0, { r: [Math.PI / 2, 0, 0], seg: 8 });
  // ore bin
  const bx = -0.17;
  const bw = 0.55;
  const bd = 0.46;
  const by = 0.19;
  const bh = 0.17;
  r.box(M.dark, bw, 0.02, bd, bx, by + 0.01, 0, { b: 0.004 });
  r.box(M.team, bw, bh, 0.03, bx, by + bh / 2, bd / 2 - 0.015, { b: 0.01 });
  r.box(M.team, bw, bh, 0.03, bx, by + bh / 2, -bd / 2 + 0.015, { b: 0.01 });
  r.box(M.team, 0.03, bh, bd, bx - bw / 2 + 0.015, by + bh / 2, 0, { b: 0.01 });
  r.box(M.team, 0.03, bh * 0.8, bd, bx + bw / 2 - 0.015, by + bh * 0.4, 0, { b: 0.01 });
  // ribs
  for (let i = 0; i < 4; i++) {
    const x = bx - bw / 2 + 0.07 + i * 0.14;
    for (const s of [-1, 1]) r.box(M.teamDark, 0.025, bh + 0.01, 0.012, x, by + bh / 2, (bd / 2 + 0.002) * s, { b: 0.003 });
  }
  hazard(r, bd - 0.04, 0.03, [bx - bw / 2 - 0.003, by + bh - 0.03, 0], [0, -Math.PI / 2, 0]);
  // ore pile (scaled with load)
  const ore = r.node('ore', [bx, by + 0.02, 0]);
  orePile(ore, 0, 0, 0, 0.25, 0.14, 7);

  return makeTemplate({
    root: r,
    height: 0.42,
    radius: 0.5,
    muzzles: [],
    smoke: ['exhaust'],
    glow: { glow: 2.5, 'glow:beacon': 4 },
    anim: (c, s) => {
      healthVariant(c, s);
      animTracks(c, s, 9);
      const dt = dtOf(s);
      if (s.harvesting) c.n.drum.rotation.z -= dt * 9;
      const load = Math.min(1, Math.max(0, s.load));
      const ore = c.n.ore;
      ore.visible = load > 0.02;
      ore.scale.set(0.6 + 0.4 * load, Math.max(0.05, load), 0.6 + 0.4 * load);
      c.setGlow('glow:beacon', s.harvesting || s.moving ? (blink(s.time, 0.6, 0.5) ? 1 : 0.1) : 0.1);
    },
  });
}

// =============================================================================================
// MCV
// =============================================================================================

function mcv(): ModelTemplate {
  const r = root();
  tracks(r, { L: 1.02, H: 0.15, W: 0.13, Z: 0.235, wheels: 7 });
  r.box(M.gun, 0.98, 0.08, 0.4, 0, 0.15, 0, { b: 0.012 });
  // cab
  r.add(
    prismXY(
      [
        [0.32, 0.18],
        [0.53, 0.18],
        [0.56, 0.24],
        [0.5, 0.33],
        [0.34, 0.34],
      ],
      0.46,
      0.018,
    ),
    M.team,
  );
  r.box(M.glassBlue, 0.07, 0.065, 0.4, 0.533, 0.29, 0, { b: 0.005, r: [0, 0, 0.98] });
  for (const s of [-1, 1]) r.box(M.glassBlue, 0.12, 0.05, 0.004, 0.42, 0.29, 0.231 * s, { b: 0 });
  headlights(r, 0.555, 0.22, 0.17, 0.013);
  r.box(M.dark, 0.008, 0.035, 0.18, 0.558, 0.22, 0, { b: 0 });
  lamp(r, G.amber, [0.42, 0.355, 0.15], 0.016, 'glow:beacon');
  lamp(r, G.amber, [0.42, 0.355, -0.15], 0.016, 'glow:beacon');
  // main module: neutral walls, team roof panels & stripes
  r.add(
    prismXY(
      [
        [-0.53, 0.18],
        [0.3, 0.18],
        [0.3, 0.38],
        [0.26, 0.41],
        [-0.5, 0.41],
        [-0.53, 0.38],
      ],
      0.5,
      0.02,
    ),
    M.offwhite,
  );
  r.box(M.team, 0.8, 0.03, 0.46, -0.115, 0.415, 0, { b: 0.008 });
  for (const s of [-1, 1]) {
    r.box(M.team, 0.84, 0.05, 0.012, -0.115, 0.36, 0.252 * s, { b: 0.004 });
    for (let i = 0; i < 4; i++) r.box(M.gun, 0.016, 0.14, 0.012, -0.44 + i * 0.22, 0.27, 0.252 * s, { b: 0.003 });
    hazard(r, 0.8, 0.03, [-0.115, 0.2, 0.257 * s], [0, s > 0 ? 0 : Math.PI, 0]);
    grille(r, 0.14, 0.08, [-0.33, 0.28, 0.254 * s], 5, [Math.PI / 2 * s, 0, 0]);
  }
  // folded crane boom on the roof
  r.box(M.yellow, 0.66, 0.045, 0.06, -0.12, 0.455, -0.13, { b: 0.01 });
  for (let i = 0; i < 6; i++) r.box(M.dark, 0.012, 0.047, 0.062, -0.42 + i * 0.12, 0.455, -0.13, { b: 0 });
  r.box(M.yellow, 0.09, 0.09, 0.11, 0.21, 0.47, -0.13, { b: 0.014 });
  r.cyl(M.dark, 0.032, 0.032, 0.13, 0.21, 0.47, -0.13, { r: [Math.PI / 2, 0, 0], seg: 10 });
  r.box(M.steel, 0.025, 0.035, 0.025, -0.46, 0.425, -0.13, { b: 0.004 });
  // folded structure frames (lattice) + generator
  for (const x of [-0.42, -0.28, -0.14]) {
    r.box(M.gun, 0.02, 0.05, 0.2, x, 0.455, 0.1, { b: 0.004 });
  }
  r.box(M.gun, 0.32, 0.016, 0.02, -0.28, 0.485, 0.02, { b: 0.003 });
  r.box(M.gun, 0.32, 0.016, 0.02, -0.28, 0.485, 0.18, { b: 0.003 });
  r.box(M.teamDark, 0.16, 0.07, 0.16, 0.03, 0.465, 0.12, { b: 0.012 });
  grille(r, 0.12, 0.12, [0.03, 0.502, 0.12], 5);
  const dish = r.node('dish', [0.2, 0.43, 0.15]);
  dish.cyl(M.dark, 0.01, 0.01, 0.06, 0, 0.03, 0, { seg: 6 });
  dish.add(lathe([[0.0, 0.0], [0.04, 0.012], [0.07, 0.035]], 14), M.white, { p: [0, 0.06, 0], r: [0, 0, 0.9] });
  antenna(r, -0.5, 0.42, 0.2, 0.25);
  // rear
  hazard(r, 0.44, 0.04, [-0.535, 0.24, 0], [0, -Math.PI / 2, 0]);
  taillights(r, -0.535, 0.32, 0.2);
  r.box(M.dark, 0.02, 0.12, 0.2, -0.535, 0.3, 0, { b: 0.004 });

  return makeTemplate({
    root: r,
    height: 0.5,
    radius: 0.55,
    muzzles: [],
    glow: { glow: 2.5, 'glow:beacon': 4 },
    anim: (c, s) => {
      healthVariant(c, s);
      animTracks(c, s, 9);
      c.n.dish.rotation.y += dtOf(s) * 1.2;
      c.setGlow('glow:beacon', blink(s.time, 0.9, 0.45) ? 1 : 0.12);
    },
  });
}

export const VEHICLE_BUILDERS: Record<string, () => ModelTemplate> = {
  '1tnk': lightTank,
  '2tnk': mediumTank,
  '3tnk': heavyTank,
  '4tnk': mammothTank,
  jeep,
  apc,
  arty: artillery,
  v2rl: v2Launcher,
  harv: harvester,
  mcv,
};
