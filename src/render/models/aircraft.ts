/**
 * Aircraft. Face +X; modelled with their lowest point (skids/wheels) at y≈0.
 * The engine lifts root.position.y to the flight altitude.
 */
import * as THREE from 'three';
import { NB, makeTemplate, type Ctx, type Mat, type ModelFaction, type ModelTemplate, type V3 } from './builder';
import { M, G, lathe, prismXY, prismXZ, sovietStar, alliedStar, faceRot, grille, stencilNumber } from './parts';
import { P, cbox, far, near, pbox, rotYZ } from './unitkit';

// aircraft paints: team upper surfaces a shade deeper than plastic team colour, pale grey belly
const HULL_TEAM: Mat = { c: 0xbcbcbc, m: 0.32, r: 0.46, t: 1, d: 0 };
const AIR_PALE: Mat = { c: 0xa8adb0, m: 0.3, r: 0.5, d: 0 };
const AIR_GREY: Mat = { c: 0x5c6268, m: 0.35, r: 0.5, d: 0 };
const P_LENS: Mat = { c: 0x9fb8c8, m: 0.6, r: 0.08, d: 3 };
const P_SOOT: Mat = { c: 0x2a2420, m: 0.4, r: 0.8, d: 0 };
const P_SOV: Mat = P.sov;
const P_SOV_D: Mat = P.sovDark;
const P_CREW: Mat = P.crewCloth;
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

/**
 * Articulated rotor head: hub plate, blade grips with pitch links (close up) and a capped mast top.
 * Blades are slightly drooped (static droop reads as weight).
 */
function rotorHead(nb: NB, n: number, R: number, chord: number, hubR: number): void {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const c = Math.cos(a);
    const sn = -Math.sin(a);
    // blade with a slight droop toward the tip
    nb.add(new THREE.BoxGeometry(R, 0.006, chord), M.dark, { p: [c * (R / 2 + hubR), -0.008, sn * (R / 2 + hubR)], r: rotYZ(a, -0.035) });
    nb.add(new THREE.BoxGeometry(0.035, 0.0066, chord * 1.02), M.yellow, { p: [c * (R + hubR - 0.012), -0.016, sn * (R + hubR - 0.012)], r: rotYZ(a, -0.035) });
    // blade grip / cuff and pitch link (close up)
    near(nb, () => {
      nb.box(M.gun, hubR * 1.1, 0.016, chord * 0.9, c * hubR * 0.95, 0, sn * hubR * 0.95, { b: 0, r: [0, a, 0] });
      pbox(nb, M.steel, 0.006, 0.03, 0.006, c * hubR * 0.6 + sn * 0.012, -0.02, sn * hubR * 0.6 - c * 0.012);
    });
  }
  far(nb, () => nb.cyl(M.gun, hubR * 1.1, hubR * 1.1, 0.04, 0, 0.008, 0, { seg: 7 }));
  near(nb, () => {
    nb.cyl(M.gun, hubR, hubR * 1.1, 0.026, 0, 0, 0, { seg: 10 });
    nb.cyl(M.dark, hubR * 0.55, hubR * 0.7, 0.03, 0, 0.026, 0, { seg: 8 });
    nb.cyl(M.gun, hubR * 1.25, hubR * 1.25, 0.008, 0, -0.03, 0, { seg: 10, open: true });
  });
}

function rotorDisc(parent: NB, y: number, R: number): void {
  const d = parent.node('rotorDisc', [0, y, 0]);
  d.add(new THREE.CircleGeometry(R + 0.02, 20), M.dark, { r: [-Math.PI / 2, 0, 0], slot: 'fx:rotor', keepUv: true });
}

/** Landing wheel (axis Z): plain disc pair far away, tyre with a hub close up. */
function wheelZ(nb: NB, r: number, w: number, p: V3): void {
  far(nb, () => nb.cyl(M.rubber, r, r, w, p[0], p[1], p[2], { r: [Math.PI / 2, 0, 0], seg: 6 }));
  near(nb, () => {
    nb.cyl(M.rubber, r, r, w, p[0], p[1], p[2], { r: [Math.PI / 2, 0, 0], seg: 9 });
    for (const s of [-1, 1]) nb.add(new THREE.CircleGeometry(r * 0.55, 6), M.gun, { p: [p[0], p[1], p[2] + s * (w / 2 + 0.001)], r: [0, s > 0 ? 0 : Math.PI, 0] });
  });
}

/** Rocket pod (UB-32 / Hydra) along +X centred at p: tube, nose fairing and the honeycomb front. */
function rocketPod(nb: NB, p: V3, r: number, len: number, mat: Mat): void {
  const [x, y, z] = p;
  far(nb, () => {
    nb.cyl(mat, r, r, len, x, y, z, { r: [0, 0, -Math.PI / 2], seg: 5, open: true });
    nb.add(new THREE.CircleGeometry(r, 5), M.darker, { p: [x + len / 2 + 0.001, y, z], r: [0, Math.PI / 2, 0] });
    nb.add(new THREE.ConeGeometry(r, r * 1.6, 5, 1, true), mat, { p: [x - len / 2 - r * 0.8, y, z], r: [0, 0, Math.PI / 2] });
  });
  near(nb, () => {
    nb.cyl(mat, r, r, len, x, y, z, { r: [0, 0, -Math.PI / 2], seg: 8, open: true });
    nb.add(new THREE.CircleGeometry(r, 8), M.darker, { p: [x + len / 2 + 0.001, y, z], r: [0, Math.PI / 2, 0] });
    nb.add(new THREE.ConeGeometry(r, r * 1.6, 8, 1, true), mat, { p: [x - len / 2 - r * 0.8, y, z], r: [0, 0, Math.PI / 2] });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      nb.add(new THREE.CircleGeometry(r * 0.2, 4), M.gun, { p: [x + len / 2 + 0.002, y + Math.sin(a) * r * 0.58, z + Math.cos(a) * r * 0.58], r: [0, Math.PI / 2, 0] });
    }
    nb.cyl(M.dark, r * 1.04, r * 1.04, 0.008, x + len * 0.3, y, z, { r: [0, 0, -Math.PI / 2], seg: 8, open: true });
  });
}

/** Pylon + anti-tank missile rail with two missiles along +X. */
function missileRail(nb: NB, p: V3, len: number, mat: Mat = M.offwhite): void {
  const [x, y, z] = p;
  nb.box(M.dark, len, 0.012, 0.016, x, y, z, { b: 0 });
  for (const dz of [-0.014, 0.014]) {
    nb.cyl(mat, 0.009, 0.009, len * 0.9, x, y - 0.012, z + dz, { r: [0, 0, -Math.PI / 2], seg: 5, open: true });
    near(nb, () => {
      nb.add(new THREE.ConeGeometry(0.009, 0.02, 5, 1, true), M.red, { p: [x + len * 0.45 + 0.01, y - 0.012, z + dz], r: [0, 0, -Math.PI / 2] });
      for (const s of [-1, 1]) pbox(nb, M.dark, 0.016, 0.014, 0.002, x - len * 0.38, y - 0.012 + s * 0.008, z + dz);
    });
  }
}

// =============================================================================================
// Longbow (Allied attack helicopter): AH-64D Apache Longbow
// team upper fuselage over grey, flat-panel tandem canopy, sponsons, engine nacelles, stub wings
// with Hellfire racks and Hydra pods, chin cannon, mast radar
// =============================================================================================

function longbow(): ModelTemplate {
  const r = new NB('root');
  const team = HULL_TEAM;
  const grey = AIR_GREY;
  // fuselage: narrow keel with a deep belly
  r.add(
    prismXY(
      [
        [0.36, 0.1],
        [0.33, 0.07],
        [0.16, 0.05],
        [-0.12, 0.065],
        [-0.2, 0.1],
        [-0.2, 0.17],
        [-0.02, 0.205],
        [0.1, 0.205],
        [0.26, 0.15],
        [0.36, 0.125],
      ],
      0.11,
      0.024,
    ),
    team,
  );
  r.add(
    prismXY(
      [
        [0.33, 0.07],
        [0.16, 0.05],
        [-0.12, 0.065],
        [-0.18, 0.095],
        [0.32, 0.095],
      ],
      0.114,
      0.016,
    ),
    grey,
  );
  // avionics sponsons along the lower sides
  for (const s of [-1, 1]) {
    r.add(
      prismXY(
        [
          [0.2, 0.07],
          [-0.12, 0.075],
          [-0.15, 0.1],
          [-0.12, 0.13],
          [0.16, 0.13],
          [0.22, 0.1],
        ],
        0.04,
        0.012,
      ),
      grey,
      { p: [0, 0, 0.068 * s] },
    );
    near(r, () => {
      for (const x of [0.12, 0.0, -0.08]) pbox(r, M.darker, 0.004, 0.035, 0.003, x, 0.1, 0.089 * s);
    });
  }
  // flat-panel tandem canopy (gunner front-low, pilot behind-high) with frames
  r.add(prismXY([[0.32, 0.125], [0.2, 0.125], [0.2, 0.175], [0.25, 0.172]], 0.092, 0.01), M.glassBlue);
  r.add(prismXY([[0.18, 0.15], [0.05, 0.15], [0.05, 0.218], [0.12, 0.214]], 0.098, 0.01), M.glassBlue);
  near(r, () => {
    for (const x of [0.2, 0.05]) pbox(r, M.dark, 0.008, 0.07, 0.1, x, 0.17, 0);
    pbox(r, M.dark, 0.13, 0.006, 0.008, 0.115, 0.218, 0);
    pbox(r, M.dark, 0.11, 0.006, 0.008, 0.26, 0.176, 0);
    for (const s of [-1, 1]) {
      pbox(r, M.dark, 0.12, 0.005, 0.004, 0.25, 0.15, 0.047 * s);
      pbox(r, M.dark, 0.13, 0.005, 0.004, 0.115, 0.185, 0.05 * s);
    }
  });
  // engine nacelles high on the sides, with intakes and exhaust shrouds (black hole IR suppressors)
  for (const s of [-1, 1]) {
    far(r, () => r.cyl(grey, 0.034, 0.03, 0.2, -0.04, 0.175, 0.083 * s, { r: [0, 0, -Math.PI / 2], seg: 7, open: true }));
    near(r, () => r.cyl(grey, 0.034, 0.03, 0.2, -0.04, 0.175, 0.083 * s, { r: [0, 0, -Math.PI / 2], seg: 10, open: true }));
    r.add(new THREE.CircleGeometry(0.028, 7), M.darker, { p: [0.061, 0.175, 0.083 * s], r: [0, Math.PI / 2, 0] });
    cbox(r, M.gun, 0.06, 0.04, 0.03, -0.165, 0.18, 0.088 * s, 0.008);
    near(r, () => {
      r.add(new THREE.CircleGeometry(0.014, 6), M.darker, { p: [-0.196, 0.18, 0.088 * s], r: [0, -Math.PI / 2, 0] });
      pbox(r, M.darker, 0.12, 0.003, 0.068, -0.04, 0.209, 0.083 * s);
      r.cyl(M.dark, 0.035, 0.035, 0.006, 0.02, 0.175, 0.083 * s, { r: [0, 0, -Math.PI / 2], seg: 10, open: true });
    });
    r.node(s < 0 ? 'ex0' : 'ex1', [-0.2, 0.18, 0.088 * s]);
  }
  // tail boom, T-tail stabilator, vertical fin
  far(r, () => r.cyl(team, 0.018, 0.034, 0.36, -0.36, 0.145, 0, { r: [0, 0, Math.PI / 2], seg: 7, open: true }));
  near(r, () => r.cyl(team, 0.018, 0.034, 0.36, -0.36, 0.145, 0, { r: [0, 0, Math.PI / 2], seg: 10 }));
  near(r, () => {
    for (const x of [-0.27, -0.38]) r.cyl(M.dark, 0.0305, 0.0285, 0.006, x, 0.145, 0, { r: [0, 0, Math.PI / 2], seg: 10, open: true });
  });
  r.add(prismXY([[-0.47, 0.13], [-0.53, 0.13], [-0.565, 0.3], [-0.525, 0.3]], 0.016, 0.005), team);
  r.box(team, 0.06, 0.008, 0.2, -0.54, 0.29, 0, { b: 0.003 });
  alliedStar(r, 0.022, [-0.515, 0.215, 0.009], faceRot('+z'));
  alliedStar(r, 0.022, [-0.515, 0.215, -0.009], faceRot('-z'));
  // stub wings: Hellfire racks outboard, Hydra pods inboard
  for (const s of [-1, 1]) {
    r.box(grey, 0.09, 0.012, 0.17, 0.0, 0.122, 0.135 * s, { b: 0.004, r: [0.08 * s, 0, 0] });
    missileRail(r, [0.01, 0.105, 0.195 * s], 0.1);
    rocketPod(r, [0.01, 0.092, 0.12 * s], 0.022, 0.09, M.oliveDark);
    r.box(M.dark, 0.03, 0.02, 0.01, 0.0, 0.11, 0.12 * s, { b: 0 });
    near(r, () => pbox(r, M.dark, 0.03, 0.02, 0.01, 0.0, 0.112, 0.195 * s));
  }
  r.node('m0', [0.08, 0.09, -0.155]);
  r.node('m1', [0.08, 0.09, 0.155]);
  // chin 30 mm cannon and the nose sensor turret (TADS)
  r.sph(M.gun, 0.022, 0.24, 0.045, 0, { seg: 6 });
  r.cyl(M.dark, 0.005, 0.005, 0.09, 0.3, 0.04, 0, { r: [0, 0, -Math.PI / 2], seg: 5, open: true });
  r.sph(M.dark, 0.03, 0.36, 0.1, 0, { seg: 6, s: [0.9, 1, 1] });
  near(r, () => {
    for (const s of [-1, 1]) r.add(new THREE.CircleGeometry(0.012, 6), P_LENS, { p: [0.385, 0.1, 0.012 * s], r: [0, Math.PI / 2, 0] });
    pbox(r, M.dark, 0.012, 0.012, 0.03, 0.27, 0.04, 0);
  });
  // landing gear
  for (const s of [-1, 1]) {
    r.box(M.dark, 0.012, 0.05, 0.012, 0.13, 0.04, 0.06 * s, { b: 0.002 });
    wheelZ(r, 0.022, 0.018, [0.13, 0.022, 0.07 * s]);
    near(r, () => pbox(r, M.dark, 0.06, 0.008, 0.008, 0.16, 0.06, 0.055 * s, [0, 0, -0.5]));
  }
  wheelZ(r, 0.014, 0.012, [-0.46, 0.11, 0]);
  // nav lights + strobe
  r.sph(G.red, 0.008, 0.0, 0.122, -0.21, { seg: 4, slot: 'glow' });
  r.sph(G.green, 0.008, 0.0, 0.122, 0.21, { seg: 4, slot: 'glow' });
  r.sph(G.white, 0.007, -0.565, 0.305, 0, { seg: 6, slot: 'glow:strobe' });
  near(r, () => stencilNumber(r, '07', [0.18, 0.11, 0.0575], [0, 0, 0], 0.03));
  // mast + Longbow radar dome
  r.cyl(M.gun, 0.016, 0.022, 0.07, 0.02, 0.235, 0, { seg: 8 });
  const rotor = r.node('rotor', [0.02, 0.272, 0]);
  rotorHead(rotor, 4, 0.42, 0.04, 0.04);
  rotor.sph(M.offwhite, 0.038, 0, 0.06, 0, { seg: 8, s: [1, 0.68, 1] });
  rotorDisc(r, 0.27, 0.46);
  const tr = r.node('trotor', [-0.535, 0.24, 0.022]);
  for (let i = 0; i < 4; i++) tr.box(M.dark, 0.11, 0.016, 0.004, 0, 0, 0, { r: [0, 0, (i * Math.PI) / 2 + (i % 2) * 0.35], b: 0 });
  tr.cyl(M.gun, 0.01, 0.01, 0.012, 0, 0, 0.002, { r: [Math.PI / 2, 0, 0], seg: 6 });

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
// Hind (Soviet assault helicopter): Mi-24
// stepped double-bubble canopies, team upper / pale belly, twin engines
// with intakes and exhausts, anhedral stub wings with rocket pods and missile rails, chin gun
// =============================================================================================

function hind(): ModelTemplate {
  const r = new NB('root');
  const team = HULL_TEAM;
  const pale = AIR_PALE;
  // cabin + engine section
  r.add(
    prismXY(
      [
        [0.22, 0.06],
        [0.15, 0.045],
        [-0.18, 0.06],
        [-0.26, 0.11],
        [-0.26, 0.2],
        [-0.05, 0.25],
        [0.14, 0.24],
        [0.24, 0.17],
      ],
      0.17,
      0.03,
    ),
    team,
  );
  // pale belly and cheeks
  r.add(
    prismXY(
      [
        [0.22, 0.062],
        [0.15, 0.044],
        [-0.18, 0.058],
        [-0.22, 0.09],
        [-0.2, 0.11],
        [0.24, 0.11],
      ],
      0.174,
      0.02,
    ),
    pale,
  );
  // narrower nose section carrying the gunner's cockpit
  r.add(
    prismXY(
      [
        [0.42, 0.095],
        [0.38, 0.06],
        [0.2, 0.05],
        [0.2, 0.16],
        [0.34, 0.14],
        [0.42, 0.115],
      ],
      0.12,
      0.024,
    ),
    team,
  );
  r.add(prismXY([[0.4, 0.075], [0.37, 0.058], [0.2, 0.052], [0.2, 0.09], [0.41, 0.09]], 0.124, 0.014), pale);
  // stepped bubble canopies (gunner low in front, pilot higher behind) with frames
  far(r, () => {
    r.sph(M.glassBlue, 0.055, 0.33, 0.13, 0, { seg: 7, s: [1.25, 0.85, 0.95] });
    r.sph(M.glassBlue, 0.062, 0.2, 0.18, 0, { seg: 7, s: [1.2, 0.85, 0.9] });
  });
  near(r, () => {
    r.sph(M.glassBlue, 0.055, 0.33, 0.13, 0, { seg: 10, s: [1.25, 0.85, 0.95] });
    r.sph(M.glassBlue, 0.062, 0.2, 0.18, 0, { seg: 10, s: [1.2, 0.85, 0.9] });
  });
  near(r, () => {
    for (const [x, y, rr] of [
      [0.33, 0.13, 0.055],
      [0.2, 0.18, 0.062],
    ] as const) {
      r.cyl(M.dark, rr * 0.97, rr * 0.97, 0.006, x, y + 0.01, 0, { r: [0, 0, Math.PI / 2], seg: 10, open: true, s: [0.95, 1, 0.92] });
      pbox(r, M.dark, rr * 2.2, 0.005, 0.006, x, y + rr * 0.8, 0);
    }
    // troop cabin windows
    for (const s of [-1, 1]) for (const x of [0.06, -0.02, -0.1]) r.add(new THREE.PlaneGeometry(0.03, 0.024), M.glass, { p: [x, 0.165, 0.0855 * s], r: [0, s > 0 ? 0 : Math.PI, 0] });
    for (const s of [-1, 1]) pbox(r, M.darker, 0.07, 0.085, 0.003, 0.0, 0.14, 0.086 * s);
  });
  // twin engines on top with dust-filter intakes and downturned exhausts
  for (const s of [-1, 1]) {
    far(r, () => r.cyl(team, 0.042, 0.038, 0.27, -0.04, 0.245, 0.058 * s, { r: [0, 0, -Math.PI / 2], seg: 7, open: true }));
    near(r, () => r.cyl(team, 0.042, 0.038, 0.27, -0.04, 0.245, 0.058 * s, { r: [0, 0, -Math.PI / 2], seg: 10, open: true }));
    cbox(r, M.gun, 0.06, 0.05, 0.05, 0.12, 0.248, 0.058 * s, 0.012);
    r.add(new THREE.CircleGeometry(0.02, 6), M.darker, { p: [0.151, 0.248, 0.058 * s], r: [0, Math.PI / 2, 0] });
    r.cyl(M.dark, 0.026, 0.03, 0.06, -0.19, 0.236, 0.075 * s, { r: [0.5 * s, 0, Math.PI / 2 + 0.35], seg: 8, open: true });
    near(r, () => {
      for (const x of [0.105, 0.135]) pbox(r, M.darker, 0.004, 0.044, 0.052, x, 0.248, 0.058 * s);
      r.cyl(P_SOOT, 0.03, 0.03, 0.012, -0.21, 0.228, 0.082 * s, { r: [0.5 * s, 0, Math.PI / 2 + 0.35], seg: 8, open: true });
      pbox(r, M.darker, 0.16, 0.003, 0.05, -0.04, 0.289, 0.04 * s);
    });
    r.node(s < 0 ? 'ex0' : 'ex1', [-0.22, 0.228, 0.085 * s]);
  }
  // tail boom (tapering), fin with the tail rotor, stabilisers
  far(r, () => r.cyl(team, 0.022, 0.045, 0.42, -0.45, 0.17, 0, { r: [0, 0, Math.PI / 2], seg: 7, open: true }));
  near(r, () => r.cyl(team, 0.022, 0.045, 0.42, -0.45, 0.17, 0, { r: [0, 0, Math.PI / 2], seg: 10 }));
  near(r, () => {
    for (const x of [-0.34, -0.46, -0.56]) r.cyl(M.dark, 0.041 - (x + 0.34) * -0.05, 0.04 - (x + 0.34) * -0.05, 0.006, x, 0.17, 0, { r: [0, 0, Math.PI / 2], seg: 10, open: true });
  });
  r.add(prismXY([[-0.6, 0.15], [-0.67, 0.15], [-0.72, 0.33], [-0.66, 0.33]], 0.018, 0.005), team);
  r.box(team, 0.07, 0.008, 0.22, -0.58, 0.17, 0, { b: 0.003 });
  sovietStar(r, 0.032, [-0.44, 0.17, 0.034], faceRot('+z'));
  sovietStar(r, 0.032, [-0.44, 0.17, -0.034], faceRot('-z'));
  near(r, () => stencilNumber(r, '24', [0.31, 0.105, 0.061], [0, 0, 0], 0.03));
  // stub wings (anhedral) with rocket pods and wingtip missile rails
  for (const s of [-1, 1]) {
    r.box(M.gun, 0.12, 0.012, 0.21, 0.0, 0.13, 0.18 * s, { b: 0.004, r: [-0.18 * s, 0, 0] });
    for (const z of [0.14, 0.22]) {
      const y = 0.1 - (z - 0.14) * 0.18;
      rocketPod(r, [0.0, y, z * s], 0.025, 0.11, M.oliveDark);
      near(r, () => pbox(r, M.dark, 0.04, 0.02, 0.008, 0.0, y + 0.03, z * s));
    }
    r.box(M.dark, 0.03, 0.05, 0.01, 0.0, 0.1, 0.285 * s, { b: 0 });
    missileRail(r, [0.01, 0.078, 0.285 * s], 0.11, M.olive);
  }
  // chin gun turret (four barrels) and the sensor pod
  r.sph(M.gun, 0.03, 0.34, 0.05, 0, { seg: 6 });
  r.cyl(M.dark, 0.008, 0.008, 0.09, 0.39, 0.045, 0, { r: [0, 0, -Math.PI / 2], seg: 5, open: true });
  near(r, () => {
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      r.cyl(M.dark, 0.003, 0.003, 0.04, 0.445, 0.045 + Math.sin(a) * 0.006, Math.cos(a) * 0.006, { r: [0, 0, -Math.PI / 2], seg: 3, open: true });
    }
    r.box(M.dark, 0.04, 0.025, 0.025, 0.36, 0.06, -0.05, { b: 0.006 });
    r.add(new THREE.CircleGeometry(0.009, 6), P_LENS, { p: [0.381, 0.06, -0.05], r: [0, Math.PI / 2, 0] });
  });
  r.node('m0', [0.47, 0.045, 0]);
  r.node('m1', [0.07, 0.1, 0.19]);
  // landing gear
  for (const s of [-1, 1]) {
    r.box(M.dark, 0.012, 0.05, 0.012, -0.02, 0.04, 0.09 * s, { b: 0.002 });
    wheelZ(r, 0.024, 0.02, [-0.02, 0.024, 0.1 * s]);
    near(r, () => pbox(r, M.dark, 0.008, 0.008, 0.06, -0.02, 0.06, 0.07 * s, [0.6 * s, 0, 0]));
  }
  wheelZ(r, 0.02, 0.016, [0.28, 0.02, 0]);
  r.box(M.dark, 0.01, 0.03, 0.01, 0.28, 0.035, 0, { b: 0 });
  // lights
  r.sph(G.red, 0.008, 0.0, 0.11, -0.29, { seg: 4, slot: 'glow' });
  r.sph(G.green, 0.008, 0.0, 0.11, 0.29, { seg: 4, slot: 'glow' });
  r.sph(G.red, 0.009, -0.05, 0.27, 0, { seg: 6, slot: 'glow:strobe' });
  // rotor mast + head
  r.cyl(M.gun, 0.024, 0.03, 0.06, 0.0, 0.29, 0, { seg: 8 });
  const rotor = r.node('rotor', [0.0, 0.325, 0]);
  rotorHead(rotor, 5, 0.48, 0.042, 0.045);
  rotorDisc(r, 0.325, 0.52);
  const tr = r.node('trotor', [-0.68, 0.28, -0.024]);
  for (let i = 0; i < 3; i++) tr.box(M.dark, 0.13, 0.018, 0.004, 0, 0, 0, { r: [0, 0, (i * Math.PI * 2) / 3], b: 0 });
  tr.cyl(M.gun, 0.012, 0.012, 0.014, 0, 0, -0.002, { r: [Math.PI / 2, 0, 0], seg: 6 });

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
    HULL_TEAM,
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
  r.add(wing, HULL_TEAM, { p: [0, cy - 0.01, 0] });
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
    HULL_TEAM,
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
  // pale belly, dorsal spine, pilot, canopy frame, panel lines, pitot
  r.box(AIR_PALE, 0.5, 0.02, 0.07, -0.02, cy - 0.048, 0, { b: 0.008 });
  r.box(HULL_TEAM, 0.3, 0.02, 0.03, -0.12, cy + 0.048, 0, { b: 0.008 });
  near(r, () => {
    r.sph(M.dark, 0.016, 0.17, cy + 0.05, 0, { seg: 5 });
    pbox(r, M.dark, 0.006, 0.03, 0.068, 0.2, cy + 0.045, 0);
    pbox(r, M.dark, 0.12, 0.004, 0.006, 0.16, cy + 0.072, 0);
    for (const x of [0.08, -0.04, -0.2]) r.cyl(M.dark, 0.0565, 0.0565, 0.003, x, cy, 0, { r: [0, 0, Math.PI / 2], seg: 10, open: true, s: [1, 1, 0.9] });
    r.cyl(M.steel, 0.002, 0.002, 0.06, 0.45, cy, 0, { r: [0, 0, Math.PI / 2], seg: 3 });
    for (const s of [-1, 1]) {
      pbox(r, M.darker, 0.1, 0.003, 0.004, -0.08, cy - 0.004, 0.13 * s);
      pbox(r, M.dark, 0.05, 0.016, 0.003, -0.02, cy + 0.0, 0.11 * s);
    }
  });
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
    HULL_TEAM,
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
    HULL_TEAM,
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
  // pale belly, pilot under the canopy, canopy frame, tail wheel, radiator scoop
  r.box(AIR_PALE, 0.36, 0.018, 0.06, 0.02, cy - 0.045, 0, { b: 0.006 });
  r.box(M.dark, 0.08, 0.024, 0.05, -0.02, cy - 0.055, 0, { b: 0.006 });
  near(r, () => {
    r.sph(M.dark, 0.016, 0.04, cy + 0.05, 0, { seg: 5 });
    for (const x of [0.0, 0.06]) pbox(r, M.dark, 0.004, 0.028, 0.06, x, cy + 0.05, 0);
    r.cyl(M.rubber, 0.012, 0.012, 0.008, -0.3, 0.02, 0, { r: [Math.PI / 2, 0, 0], seg: 6 });
    pbox(r, M.dark, 0.006, 0.05, 0.006, -0.29, 0.045, 0, [0, 0, -0.4]);
    for (const s of [-1, 1]) pbox(r, M.darker, 0.004, 0.003, 0.2, 0.02, cy - 0.015, 0.2 * s);
  });
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

function chinook(fac: ModelFaction = 'allies'): ModelTemplate {
  const r = new NB('root');
  const W = 0.2;
  // dressed per faction: Soviet olive with team panels / Allied team paint over grey
  const hull: Mat = fac === 'soviet' ? P_SOV : HULL_TEAM;
  const dark: Mat = fac === 'soviet' ? P_SOV_D : AIR_GREY;
  const panel: Mat = fac === 'soviet' ? M.team : M.teamDark;
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
    hull,
  );
  // belly + sponsons (fuel pods) along the lower sides
  r.add(prismXY([[0.36, 0.07], [-0.34, 0.07], [-0.36, 0.1], [0.38, 0.1]], W + 0.004, 0.01), dark);
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
      dark,
      { p: [0, 0, (W / 2 + 0.022) * s] },
    );
    // team band along the cabin, round cabin windows
    pbox(r, panel, 0.6, 0.03, 0.003, -0.05, 0.235, (W / 2 + 0.0015) * s);
    for (let i = 0; i < 6; i++) r.add(new THREE.CircleGeometry(0.013, 6), M.glass, { p: [0.18 - i * 0.085, 0.2, (W / 2 + 0.002) * s], r: [0, s > 0 ? 0 : Math.PI, 0] });
    // landing gear
    r.box(M.dark, 0.012, 0.05, 0.012, 0.25, 0.04, (W / 2 + 0.01) * s, { b: 0.002 });
    wheelZ(r, 0.022, 0.018, [0.25, 0.022, (W / 2 + 0.018) * s]);
    r.box(M.dark, 0.012, 0.04, 0.012, -0.24, 0.04, (W / 2 + 0.05) * s, { b: 0.002 });
    wheelZ(r, 0.022, 0.018, [-0.24, 0.022, (W / 2 + 0.058) * s]);
    // engines on the aft pylon with intakes and exhausts
    r.cyl(dark, 0.034, 0.03, 0.2, -0.36, 0.28, (W / 2 + 0.03) * s, { r: [0, 0, -Math.PI / 2], seg: 8 });
    r.cyl(M.dark, 0.026, 0.026, 0.02, -0.465, 0.28, (W / 2 + 0.03) * s, { r: [0, 0, -Math.PI / 2], seg: 7, open: true });
    r.add(new THREE.CircleGeometry(0.026, 7), M.darker, { p: [-0.259, 0.28, (W / 2 + 0.03) * s], r: [0, Math.PI / 2, 0] });
    r.box(M.gun, 0.03, 0.02, 0.02, -0.28, 0.28, (W / 2 + 0.03) * s, { b: 0 });
    // side door (crew door open on the right, with the door gunner)
    r.box(M.darker, 0.06, 0.09, 0.004, 0.25, 0.155, (W / 2 + 0.001) * s, { b: 0 });
    near(r, () => {
      for (const x of [0.06, -0.14, -0.3]) pbox(r, M.darker, 0.003, 0.15, 0.003, x, 0.17, (W / 2 + 0.0015) * s);
      pbox(r, M.darker, 0.66, 0.003, 0.003, -0.05, 0.12, (W / 2 + 0.0015) * s);
    });
  }
  near(r, () => {
    pbox(r, P_CREW, 0.03, 0.04, 0.04, 0.25, 0.165, W / 2 - 0.02);
    r.sph(M.dark, 0.016, 0.255, 0.2, W / 2 - 0.02, { seg: 5 });
    pbox(r, M.dark, 0.08, 0.008, 0.008, 0.29, 0.17, W / 2 + 0.01);
  });
  // cockpit glazing with frames
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
  near(r, () => {
    pbox(r, M.dark, 0.006, 0.07, 0.006, 0.4, 0.2, 0, [0, 0, 0.6]);
    for (const s of [-1, 1]) pbox(r, M.dark, 0.006, 0.07, 0.006, 0.4, 0.2, 0.06 * s, [0, 0, 0.6]);
    // nose pitot / refuelling probe
    r.cyl(M.steel, 0.003, 0.003, 0.08, 0.47, 0.18, 0.06, { r: [0, 0, Math.PI / 2], seg: 3 });
  });
  // forward rotor pylon + aft pylon (tall)
  r.add(prismXY([[0.38, 0.26], [0.2, 0.26], [0.24, 0.3], [0.36, 0.3]], 0.1, 0.01), hull);
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
    hull,
  );
  r.box(M.gun, 0.1, 0.03, 0.06, -0.3, 0.27, 0, { b: 0.008 });
  grille(r, 0.08, 0.05, [-0.3, 0.287, 0], 4);
  if (fac === 'soviet') {
    sovietStar(r, 0.035, [-0.22, 0.18, W / 2 + 0.002], faceRot('+z'));
    sovietStar(r, 0.035, [-0.22, 0.18, -(W / 2 + 0.002)], faceRot('-z'));
  } else alliedOrSovietRoundel(r, -0.22, 0.18, W / 2 + 0.001);
  // nav / anti-collision lights
  r.sph(G.red, 0.008, -0.0, 0.11, -(W / 2 + 0.05), { seg: 4, slot: 'glow' });
  r.sph(G.green, 0.008, -0.0, 0.11, W / 2 + 0.05, { seg: 4, slot: 'glow' });
  r.sph(G.red, 0.009, 0.05, 0.27, 0, { seg: 4, slot: 'glow:strobe' });
  // rear cargo ramp (hinged at the bottom of the tail)
  const ramp = r.node('ramp', [-0.48, 0.085, 0]);
  ramp.box(dark, 0.012, 0.14, W - 0.02, -0.006, 0.07, 0, { b: 0.004 });
  for (let i = 0; i < 4; i++) ramp.box(M.gun, 0.004, 0.006, W - 0.04, 0.002, 0.02 + i * 0.03, 0, { b: 0 });
  r.box(M.darker, 0.004, 0.13, W - 0.04, -0.47, 0.155, 0, { b: 0 });
  // rotors
  const fr = r.node('rotorF', [0.3, 0.305, 0]);
  rotorHead(fr, 3, 0.34, 0.036, 0.034);
  const rr = r.node('rotorR', [-0.43, 0.385, 0]);
  rotorHead(rr, 3, 0.34, 0.036, 0.034);
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
    HULL_TEAM,
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
    r.add(wing(s), HULL_TEAM, { p: [0, cy - 0.01, 0] });
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
  // pale belly line, crew in the nose glazing, panel lines, gun barbettes
  r.box(AIR_PALE, 0.9, 0.022, 0.1, 0.02, cy - 0.072, 0, { b: 0.008 });
  near(r, () => {
    r.sph(M.dark, 0.016, 0.42, cy + 0.07, 0, { seg: 5 });
    r.sph(M.dark, 0.014, 0.6, cy + 0.01, 0, { seg: 5 });
    for (const x of [0.3, 0.1, -0.1, -0.3, -0.5]) r.cyl(M.dark, 0.0905 - Math.abs(x) * 0.02, 0.0905 - Math.abs(x) * 0.02, 0.004, x, cy, 0, { r: [0, 0, Math.PI / 2], seg: 12, open: true, s: [1, 1, 0.92] });
    for (const s of [-1, 1]) pbox(r, M.darker, 0.004, 0.003, 0.6, -0.03, cy + 0.0145, 0.42 * s);
    r.cyl(M.dark, 0.003, 0.003, 0.08, 0.15, cy + 0.11, 0.008, { r: [0, 0, -Math.PI / 2], seg: 3 });
    r.cyl(M.dark, 0.003, 0.003, 0.08, 0.15, cy + 0.11, -0.008, { r: [0, 0, -Math.PI / 2], seg: 3 });
  });

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
  // pilot in a pressure suit, canopy frame, sensor bay hatches, panel lines, pogo outriggers
  near(r, () => {
    r.sph(M.white, 0.014, 0.22, cy + 0.045, 0, { seg: 5 });
    pbox(r, M.dark, 0.004, 0.024, 0.05, 0.25, cy + 0.04, 0);
    for (const x of [0.14, 0.06]) pbox(r, M.darker, 0.05, 0.003, 0.004, x, cy - 0.03, 0.04);
    for (const x of [0.1, -0.05, -0.2]) r.cyl(M.darker, 0.0485, 0.0485, 0.003, x, cy, 0, { r: [0, 0, Math.PI / 2], seg: 10, open: true, s: [1, 1, 0.9] });
    for (const s of [-1, 1]) {
      pbox(r, M.darker, 0.004, 0.003, 0.7, 0.04, cy + 0.0005, 0.5 * s);
      pbox(r, M.dark, 0.006, 0.03, 0.006, 0.0, cy - 0.025, 0.42 * s);
    }
  });
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

export const AIRCRAFT_BUILDERS: Record<string, (fac?: ModelFaction) => ModelTemplate> = {
  heli: longbow,
  hind,
  mig,
  yak,
  tran: chinook,
  badr: badger,
  u2,
};
