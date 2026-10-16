/**
 * Aftermath / Counterstrike vehicles (round 5). Face +X, origin at ground centre.
 *   ttnk Tesla Tank       tracked hull, rotating turret carrying a tesla coil (orb glow follows charge / firing)
 *   qtnk M.A.D. Tank      heavy chassis with a seismic hammer rig: anim.deployed lowers the outriggers,
 *                         anim.charge (0..1, deploy -> last pulse) raises the ram while arming, then slams
 *                         it down once per pulse with a ground shock ring
 *   ctnk Chrono Tank      missile pods on a low turret, chrono emitter ring on the rear deck (anim.charge = ready)
 *   dtrk Demolition Truck six-wheel truck hauling a nuclear charge with hazard markings; arming light
 *                         (anim.charge > 0.5 = armed: fast blink)
 *   stnk Phase Transport  angular APC with phase emitters and a missile turret; anim.cloak shows the owner's
 *                         phase shimmer
 * (The Shock Trooper and Mechanic live in infantry.ts, the Missile Submarine in naval.ts.)
 */
import * as THREE from 'three';
import { NB, makeTemplate, type Ctx, type Mat, type ModelFaction, type ModelTemplate } from './builder';
import { SUPPORT_VEHICLE_BUILDERS } from './vehicles';
import type { ModelAnimState } from './types';
import {
  M,
  G,
  alliedStar,
  antenna,
  faceRot,
  grille,
  hazard,
  hatch,
  lamp,
  lathe,
  pipe,
  prismXY,
  prismXZ,
  rivets,
  sovietStar,
  stencilNumber,
  stowage,
  trefoil,
  wheel,
} from './parts';
import { animTracks, approach, blink, dtOf, healthVariant, recoil } from './anim';
import { cloakMaterial, fxTime } from './fxmats';
import { P, camoFace, camoTop, edgePlate, roundHatch, runningGear, skirt as kitSkirt, slopePlate, towHooks, whip } from './unitkit';
import { MAD_ARM_SECONDS, MAD_PULSES, MAD_TOTAL_SECONDS } from '../../sim/aftermath';

const VEH_AO = { h: 0.12, min: 0.55 };

function root(): NB {
  const r = new NB('root');
  r.ao = VEH_AO;
  return r;
}

function headlights(nb: NB, x: number, y: number, z: number, size = 0.013): void {
  for (const s of [-1, 1]) {
    nb.box(M.dark, 0.016, size * 1.6, size * 1.8, x - 0.004, y, z * s, { b: 0.003 });
    nb.add(new THREE.OctahedronGeometry(size * 0.75, 0), G.head, { p: [x + 0.003, y, z * s], s: [0.5, 1, 1] });
  }
}

function taillights(nb: NB, x: number, y: number, z: number): void {
  for (const s of [-1, 1]) nb.box(G.red, 0.006, 0.014, 0.022, x, y, z * s, { b: 0, slot: 'glow' });
}

/** Side skirt plate along X with a bolt row (close-up). */
function skirt(nb: NB, x0: number, x1: number, y: number, z: number, h: number, mat: Mat = M.teamDark): void {
  nb.add(
    prismXY(
      [
        [x0, y - h / 2],
        [x1 - 0.04, y - h / 2],
        [x1, y + h / 2],
        [x0 + 0.02, y + h / 2],
      ],
      0.014,
      0.004,
    ),
    mat,
    { p: [0, 0, z] },
  );
  const s = Math.sign(z);
  rivets(nb, [x0 + 0.04, y + h * 0.3, z + s * 0.008], [x1 - 0.06, y + h * 0.3, z + s * 0.008], 7, 0.005);
}

// =============================================================================================
// Tesla Tank (Soviet)
// =============================================================================================

function teslaTank(): ModelTemplate {
  const r = root();
  // [UNITS] olive drab with team panels, road wheels with hubs close up
  runningGear(r, { L: 0.84, H: 0.15, W: 0.13, Z: 0.22, wheels: 6, wheelK: 0.38 });
  r.box(P.sovDark, 0.76, 0.08, 0.32, 0, 0.095, 0, { b: 0.01 });
  r.add(
    prismXY(
      [
        [-0.43, 0.12],
        [0.34, 0.12],
        [0.45, 0.165],
        [0.31, 0.235],
        [-0.4, 0.24],
        [-0.44, 0.2],
      ],
      0.38,
      0.016,
    ),
    P.sov,
  );
  slopePlate(r, M.team, [0.45, 0.165], [0.31, 0.235], 0.3, 0, 0.01, 0.8);
  for (const s of [-1, 1]) kitSkirt(r, 0.84, 0.07, 0.19, 0.288 * s, 4, P.sov, M.team, 0, P.sovDark);
  // engine deck: grille, cooling fins, exhausts
  grille(r, 0.16, 0.26, [-0.3, 0.241, 0], 7);
  for (const s of [-1, 1]) {
    r.cyl(M.dark, 0.018, 0.022, 0.06, -0.42, 0.26, 0.13 * s, { seg: 6 });
    stowage(r, 0.16, 0.035, 0.045, -0.08, 0.24, 0.165 * s, M.oliveDark);
  }
  // capacitor housings on the glacis feeding the coil
  for (const s of [-1, 1]) {
    r.cyl(M.offwhite, 0.022, 0.022, 0.07, 0.24, 0.235, 0.11 * s, { r: [0, 0, Math.PI / 2], seg: 8 });
    r.cyl(M.copper, 0.024, 0.024, 0.012, 0.21, 0.235, 0.11 * s, { r: [0, 0, Math.PI / 2], seg: 8 });
    r.cyl(M.copper, 0.024, 0.024, 0.012, 0.27, 0.235, 0.11 * s, { r: [0, 0, Math.PI / 2], seg: 8 });
  }
  headlights(r, 0.43, 0.185, 0.14);
  taillights(r, -0.44, 0.2, 0.15);
  stencilNumber(r, '407', [-0.2, 0.18, 0.2905], [0, 0, 0], 0.035);
  stencilNumber(r, '407', [-0.2, 0.18, -0.2905], [0, Math.PI, 0], 0.035);

  // turret: squat armoured base carrying the coil
  const t = r.node('turret', [-0.06, 0.238, 0]);
  t.add(
    prismXZ(
      [
        [0.17, -0.07],
        [0.17, 0.07],
        [0.08, 0.15],
        [-0.12, 0.15],
        [-0.19, 0.08],
        [-0.19, -0.08],
        [-0.12, -0.15],
        [0.08, -0.15],
      ],
      0.08,
      0.022,
    ),
    P.sov,
  );
  for (const i of [1, 2, 6, 7]) edgePlate(t, M.team, TESLA_TURRET, i, 0.04, 0.05, 0.7, 0.003, 0.012);
  sovietStar(t, 0.03, [0.08, 0.0805, 0.08]);
  hatch(t, 0.03, [-0.11, 0.08, -0.08]);
  antenna(t, -0.16, 0.08, 0.11, 0.2);
  // coil column: insulator base, copper windings, stacked toroids
  t.cyl(M.offwhite, 0.06, 0.07, 0.03, 0, 0.095, 0, { seg: 10 });
  for (let i = 0; i < 3; i++) t.cyl(M.offwhite, 0.05 - i * 0.004, 0.055 - i * 0.004, 0.016, 0, 0.12 + i * 0.022, 0, { seg: 10 });
  for (let i = 0; i < 6; i++) t.cyl(i % 2 ? M.dark : M.copper, 0.034, 0.034, 0.028, 0, 0.19 + i * 0.028, 0, { seg: 8, open: true });
  const rings: [number, number][] = [
    [0.21, 0.1],
    [0.27, 0.082],
    [0.33, 0.064],
  ];
  for (const [h, rad] of rings) {
    t.add(new THREE.TorusGeometry(rad, 0.014, 3, 10), M.gun, { p: [0, h, 0], r: [Math.PI / 2, 0, 0] });
    t.add(new THREE.RingGeometry(rad - 0.012, rad + 0.006, 10), G.tesla, { p: [0, h - 0.016, 0], r: [Math.PI / 2, 0, 0], slot: 'glow:coil' });
  }
  t.add(lathe([[0.045, 0], [0.055, 0.02], [0.035, 0.04], [0.0, 0.045]], 10), M.gun, { p: [0, 0.36, 0] });
  t.add(new THREE.IcosahedronGeometry(0.05, 1), G.tesla, { p: [0, 0.43, 0], slot: 'glow:orb' });
  const halo = t.node('halo', [0, 0.43, 0]);
  halo.add(new THREE.PlaneGeometry(0.34, 0.34), M.dark, { slot: 'fx:add:5aa2ff:0.9', keepUv: true, r: [-Math.PI / 2, 0, 0] });
  // feed cables from the capacitors
  for (const s of [-1, 1]) pipe(t, [0.12, 0.03, 0.1 * s], [0.03, 0.2, 0.03 * s], 0.008, M.dark, 4);
  t.node('m0', [0, 0.43, 0]);

  return makeTemplate({
    root: r,
    height: 0.72,
    radius: 0.46,
    turret: 'turret',
    muzzles: ['m0'],
    glow: { glow: 2.5, 'glow:orb': 3.4, 'glow:coil': 2.6 },
    anim: (c, s) => {
      healthVariant(c, s);
      animTracks(c, s);
      if (c.v.seed === undefined) c.v.seed = Math.random() * 10;
      const ch = Math.min(1, Math.max(0, s.charge));
      const crackle = 0.8 + 0.2 * Math.sin(s.time * 37 + c.v.seed) * Math.sin(s.time * 13);
      c.setGlow('glow:orb', (0.35 + 0.45 * ch + s.firing * 1.1) * crackle);
      c.setGlow('glow:coil', 0.25 + 0.6 * ch + s.firing * 0.6);
      c.n.halo.scale.setScalar(0.4 + 0.35 * ch + s.firing * 0.9);
    },
  });
}

// =============================================================================================
// M.A.D. Tank (Soviet)
// =============================================================================================

const MAD_A = MAD_ARM_SECONDS / MAD_TOTAL_SECONDS;

const TESLA_TURRET: [number, number][] = [
  [0.17, -0.07],
  [0.17, 0.07],
  [0.08, 0.15],
  [-0.12, 0.15],
  [-0.19, 0.08],
  [-0.19, -0.08],
  [-0.12, -0.15],
  [0.08, -0.15],
];

function madTank(): ModelTemplate {
  const r = root();
  runningGear(r, { L: 0.98, H: 0.16, W: 0.15, Z: 0.27, wheels: 6, wheelK: 0.38 });
  r.box(P.sovDark, 0.9, 0.09, 0.42, 0, 0.1, 0, { b: 0.012 });
  r.add(
    prismXY(
      [
        [-0.5, 0.13],
        [0.4, 0.13],
        [0.51, 0.18],
        [0.4, 0.245],
        [-0.47, 0.25],
        [-0.51, 0.21],
      ],
      0.46,
      0.018,
    ),
    P.sov,
  );
  for (const s of [-1, 1]) skirt(r, -0.48, 0.48, 0.165, 0.345 * s, 0.075, M.team);
  hazard(r, 0.4, 0.04, [0.46, 0.2, 0], [0, Math.PI / 2, -0.42]);
  headlights(r, 0.49, 0.19, 0.17);
  taillights(r, -0.51, 0.21, 0.18);
  sovietStar(r, 0.035, [0.3, 0.237, 0.15], [0, 0, -0.1]);
  stencilNumber(r, '13', [-0.3, 0.19, 0.3505], [0, 0, 0], 0.04, M.yellow);
  stencilNumber(r, '13', [-0.3, 0.19, -0.3505], [0, Math.PI, 0], 0.04, M.yellow);
  // the rig: four posts and a crown around the ram
  const y0 = 0.25;
  const H = 0.4;
  for (const [x, z] of [
    [0.1, 0.12],
    [0.1, -0.12],
    [-0.14, 0.12],
    [-0.14, -0.12],
  ]) {
    r.box(M.gun, 0.03, H, 0.03, x, y0 + H / 2, z, { b: 0.005 });
  }
  for (const z of [-0.12, 0.12]) {
    r.box(M.gun, 0.24, 0.02, 0.02, -0.02, y0 + 0.12, z, { b: 0 });
    pipe(r, [0.1, y0 + 0.02, z], [-0.14, y0 + H - 0.04, z], 0.007, M.dark, 4);
  }
  r.box(P.sovDark, 0.3, 0.05, 0.3, -0.02, y0 + H, 0, { b: 0.012 });
  r.box(M.team, 0.304, 0.016, 0.304, -0.02, y0 + H + 0.012, 0, { b: 0.004 });
  hazard(r, 0.28, 0.03, [-0.02, y0 + H, 0.151]);
  hazard(r, 0.28, 0.03, [-0.02, y0 + H, -0.151], [0, Math.PI, 0]);
  // anvil plate on the deck under the ram
  r.cyl(M.steel, 0.09, 0.1, 0.03, -0.02, y0 + 0.015, 0, { seg: 12 });
  rivets(r, [-0.09, y0 + 0.032, -0.06], [0.05, y0 + 0.032, 0.06], 4, 0.006);
  // hydraulic cylinders beside the ram
  for (const z of [-0.075, 0.075]) r.cyl(M.dark, 0.022, 0.022, 0.22, -0.02, y0 + H - 0.13, z, { seg: 8 });
  // the ram (moves)
  const ram = r.node('ram', [-0.02, y0 + 0.24, 0]);
  ram.cyl(M.steel, 0.022, 0.022, 0.26, 0, 0.1, 0, { seg: 8 });
  ram.cyl(M.dark, 0.075, 0.08, 0.1, 0, -0.04, 0, { seg: 12 });
  ram.cyl(M.yellow, 0.081, 0.081, 0.02, 0, -0.01, 0, { seg: 12 });
  ram.cyl(M.gun, 0.085, 0.085, 0.015, 0, -0.085, 0, { seg: 12 });
  // capacitor drums at the rear with charge bands
  for (const z of [-0.1, 0.1]) {
    r.cyl(M.gun, 0.06, 0.06, 0.16, -0.36, 0.33, z, { seg: 10 });
    r.cyl(M.dark, 0.064, 0.064, 0.02, -0.36, 0.41, z, { seg: 10 });
    for (let i = 0; i < 3; i++) r.cyl(G.amber, 0.062, 0.062, 0.012, -0.36, 0.28 + i * 0.045, z, { seg: 10, slot: 'glow:charge' });
  }
  pipe(r, [-0.3, 0.38, 0.1], [-0.1, y0 + H - 0.05, 0.1], 0.01, M.dark, 4);
  pipe(r, [-0.3, 0.38, -0.1], [-0.1, y0 + H - 0.05, -0.1], 0.01, M.dark, 4);
  // warning beacons on the crown
  lamp(r, G.red, [0.1, y0 + H + 0.04, 0.12], 0.016, 'glow:warn');
  lamp(r, G.red, [-0.14, y0 + H + 0.04, -0.12], 0.016, 'glow:warn');
  whip(r, -0.45, 0.25, 0.15, 0.22, true);
  // outriggers: fold up along the sides, swing down to the ground when deployed
  const legs: [number, number][] = [
    [0.36, 1],
    [0.36, -1],
    [-0.38, 1],
    [-0.38, -1],
  ];
  legs.forEach(([x, s], i) => {
    const leg = r.node(`leg${i}`, [x, 0.22, 0.24 * s]);
    leg.box(P.sovDark, 0.05, 0.03, 0.2, 0, 0, 0.1 * s, { b: 0.006 });
    leg.box(M.dark, 0.06, 0.02, 0.07, 0, -0.012, 0.21 * s, { b: 0.004 });
    hazard(leg, 0.16, 0.02, [0, 0.016, 0.1 * s], [-Math.PI / 2, 0, Math.PI / 2]);
  });
  // ground shock ring under the tank (local fx, the big rings come from the effects system)
  const shock = r.node('shock', [0, 0.02, 0]);
  shock.add(new THREE.RingGeometry(0.5, 0.62, 28), M.dark, { r: [-Math.PI / 2, 0, 0], slot: 'fx:add:ffb070:1.4', keepUv: true });

  return makeTemplate({
    root: r,
    height: 0.75,
    radius: 0.56,
    muzzles: [],
    glow: { glow: 2.5, 'glow:charge': 3, 'glow:warn': 4 },
    init: (c) => c.show('fx:shock', false),
    anim: (c, s) => madAnim(c, s),
  });
}

function madAnim(c: Ctx, s: ModelAnimState): void {
  healthVariant(c, s);
  animTracks(c, s, 9);
  const dt = dtOf(s);
  const dep = (c.v.dep = approach(c.v.dep ?? 0, (s.deployed ?? 0) > 0.5 ? 1 : 0, 3, dt));
  // outriggers swing down
  for (let i = 0; i < 4; i++) {
    const leg = c.n[`leg${i}`];
    const side = i % 2 === 0 ? 1 : -1;
    leg.rotation.x = side * (-1.25 + 2.25 * dep);
  }
  const ram = c.n.ram;
  const sh = c.n['fx:shock'];
  const ch = dep > 0.5 ? Math.min(1, Math.max(0, s.charge)) : 0;
  let ramY = 0.49;
  let glow = 0.08;
  let shockK = 0;
  if (dep > 0.5) {
    if (ch < MAD_A) {
      // arming: the ram is winched up as the charge builds
      const a = ch / MAD_A;
      ramY = 0.49 + 0.1 * a;
      glow = 0.2 + 0.8 * a;
    } else {
      // pulses: slam down at the start of each stroke, then winch back up
      const p = Math.min(MAD_PULSES - 1e-4, ((ch - MAD_A) / (1 - MAD_A)) * MAD_PULSES);
      const f = p - Math.floor(p);
      ramY = f < 0.12 ? 0.59 - (f / 0.12) * 0.19 : 0.4 + Math.min(1, (f - 0.12) / 0.7) * 0.19;
      glow = 1;
      shockK = f < 0.5 ? f / 0.5 : 0;
    }
  }
  ram.position.y = ramY;
  c.setGlow('glow:charge', glow * (0.85 + 0.15 * Math.sin(s.time * 20)));
  const rate = dep > 0.5 ? 0.9 - 0.75 * ch : 1.6;
  c.setGlow('glow:warn', dep > 0.5 || s.moving ? (blink(s.time, rate, 0.5) ? 1 : 0.1) : 0.1);
  if (sh) {
    sh.visible = shockK > 0;
    if (shockK > 0) sh.scale.setScalar(0.6 + shockK * 2.2);
  }
}

// =============================================================================================
// Chrono Tank (Allied)
// =============================================================================================

function chronoTank(): ModelTemplate {
  const r = root();
  // [UNITS] Allied team paint with camouflage
  runningGear(r, { L: 0.8, H: 0.13, W: 0.12, Z: 0.205, wheels: 5, wheelK: 0.38 });
  r.box(P.allyDark, 0.72, 0.07, 0.3, 0, 0.085, 0, { b: 0.01 });
  r.add(
    prismXY(
      [
        [-0.41, 0.11],
        [0.3, 0.11],
        [0.44, 0.15],
        [0.28, 0.215],
        [-0.38, 0.22],
        [-0.42, 0.18],
      ],
      0.36,
      0.014,
    ),
    P.allyTeam,
  );
  camoTop(r, 0.3, 0.3, [0.08, 0.2235, 0], 3, 81);
  for (const s of [-1, 1]) {
    skirt(r, -0.4, 0.4, 0.145, 0.262 * s, 0.06, M.teamDark);
    camoFace(r, 0.7, 0.05, [0, 0.145, 0.27 * s], s > 0 ? 0 : Math.PI, 3, 82 + s);
  }
  towHooks(r, 0.44, 0.12, 0.1, 1);
  headlights(r, 0.42, 0.165, 0.12, 0.012);
  taillights(r, -0.42, 0.18, 0.13);
  alliedStar(r, 0.03, [0.22, 0.2225, 0.1], [0, 0, -0.12]);
  stencilNumber(r, '62', [0.0, 0.17, 0.2705], [0, 0, 0], 0.035);
  stencilNumber(r, '62', [0.0, 0.17, -0.2705], [0, Math.PI, 0], 0.035);
  // chrono emitter on the rear deck: coil housing + a gyro ring hovering flat over a glowing core
  r.box(M.gun, 0.16, 0.05, 0.22, -0.3, 0.245, 0, { b: 0.012 });
  for (const z of [-0.08, 0.08]) {
    r.cyl(M.copper, 0.016, 0.016, 0.09, -0.3, 0.31, z, { seg: 8 });
    r.sph(M.chrome, 0.018, -0.3, 0.36, z, { seg: 6 });
  }
  r.cyl(M.dark, 0.05, 0.06, 0.02, -0.3, 0.28, 0, { seg: 10 });
  r.add(new THREE.CircleGeometry(0.045, 10), G.cyan, { p: [-0.3, 0.291, 0], r: [-Math.PI / 2, 0, 0], slot: 'glow:chrono' });
  const em = r.node('emitter', [-0.3, 0.35, 0]);
  em.add(new THREE.TorusGeometry(0.1, 0.013, 4, 16), M.chrome, { r: [Math.PI / 2, 0, 0] });
  em.add(new THREE.RingGeometry(0.07, 0.09, 16), G.cyan, { r: [-Math.PI / 2, 0, 0], p: [0, 0.001, 0], slot: 'glow:chrono' });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    em.box(M.steel, 0.03, 0.01, 0.01, Math.cos(a) * 0.1, 0, Math.sin(a) * 0.1, { b: 0, r: [0, -a, 0] });
  }
  const halo = em.node('chalo');
  halo.add(new THREE.PlaneGeometry(0.46, 0.46), M.dark, { slot: 'fx:add:5ae0ff:0.7', keepUv: true, r: [-Math.PI / 2, 0, 0] });
  // turret with twin missile pods
  const t = r.node('turret', [0.02, 0.218, 0]);
  t.add(
    prismXZ(
      [
        [0.15, -0.06],
        [0.15, 0.06],
        [0.08, 0.1],
        [-0.12, 0.1],
        [-0.16, 0.06],
        [-0.16, -0.06],
        [-0.12, -0.1],
        [0.08, -0.1],
      ],
      0.07,
      0.02,
    ),
    P.allyTeam,
  );
  camoTop(t, 0.2, 0.16, [-0.02, 0.0715, 0], 2, 84);
  roundHatch(t, M.teamDark, 0.026, [-0.06, 0.07, 0.04]);
  t.box(M.glass, 0.02, 0.016, 0.05, 0.12, 0.05, 0, { b: 0.004 });
  antenna(t, -0.13, 0.07, -0.07, 0.18);
  for (const [i, s] of [
    [0, -1],
    [1, 1],
  ] as const) {
    const z = 0.15 * s;
    const pod = t.node(`pod${i}`, [0.0, 0.06, z]);
    pod.box(M.teamDark, 0.24, 0.085, 0.085, 0, 0, 0, { b: 0.014 });
    pod.box(M.dark, 0.02, 0.07, 0.07, 0.115, 0, 0, { b: 0 });
    for (const dy of [-0.02, 0.02]) {
      for (const dz of [-0.02, 0.02]) {
        pod.add(new THREE.CircleGeometry(0.014, 6), M.darker, { p: [0.126, dy, dz], r: [0, Math.PI / 2, 0] });
        pod.add(new THREE.CircleGeometry(0.008, 4), M.red, { p: [0.127, dy, dz], r: [0, Math.PI / 2, 0] });
      }
    }
    rivets(pod, [-0.1, 0.043, -0.03], [0.08, 0.043, -0.03], 5, 0.004);
    t.box(M.gun, 0.05, 0.03, 0.04, 0.0, 0.03, 0.105 * s, { b: 0.005 });
    t.node(`m${i}`, [0.14, 0.06, z]);
  }

  return makeTemplate({
    root: r,
    height: 0.48,
    radius: 0.44,
    turret: 'turret',
    muzzles: ['m0', 'm1'],
    glow: { glow: 2.5, 'glow:chrono': 3.2 },
    anim: (c, s) => {
      healthVariant(c, s);
      animTracks(c, s);
      recoil(c, s, ['pod0', 'pod1'], 0.02);
      const dt = dtOf(s);
      const ready = Math.min(1, Math.max(0, s.charge));
      const em = c.n.emitter;
      em.rotation.y += dt * (0.6 + ready * 5);
      em.position.y = 0.35 + Math.sin(s.time * 2.1) * 0.008 * ready;
      const pulse = 0.75 + 0.25 * Math.sin(s.time * (2 + ready * 6));
      c.setGlow('glow:chrono', (0.25 + 0.75 * ready) * pulse);
      c.n.chalo.scale.setScalar(0.3 + 0.7 * ready * pulse);
    },
  });
}

// =============================================================================================
// Demolition Truck (Soviet)
// =============================================================================================

const BOMB_YELLOW: Mat = { c: 0xd8a418, m: 0.25, r: 0.5, d: 0 };

function demoTruck(): ModelTemplate {
  const r = root();
  const wr = 0.066;
  for (const x of [0.3, -0.12, -0.3]) for (const s of [-1, 1]) wheel(r, wr, 0.055, [x, wr, 0.165 * s]);
  r.box(M.dark, 0.86, 0.05, 0.22, -0.01, 0.09, 0, { b: 0.008 });
  // cab
  r.add(
    prismXY(
      [
        [0.18, 0.1],
        [0.45, 0.1],
        [0.46, 0.175],
        [0.4, 0.27],
        [0.2, 0.28],
      ],
      0.32,
      0.016,
    ),
    P.sov,
  );
  for (const s of [-1, 1]) r.box(M.team, 0.11, 0.07, 0.004, 0.3, 0.165, 0.161 * s, { b: 0 });
  r.box(P.tanker, 0.04, 0.05, 0.06, 0.34, 0.17, -0.07, { b: 0 });
  r.sph(P.sovDark, 0.02, 0.344, 0.23, -0.07, { seg: 4 });
  r.box(M.glassBlue, 0.07, 0.07, 0.27, 0.42, 0.23, 0, { b: 0.004, r: [0, 0, 0.98] });
  for (const s of [-1, 1]) r.box(M.glassBlue, 0.1, 0.05, 0.004, 0.3, 0.23, 0.161 * s, { b: 0 });
  r.box(M.dark, 0.012, 0.04, 0.2, 0.458, 0.14, 0, { b: 0 });
  headlights(r, 0.46, 0.15, 0.115, 0.012);
  r.box(P.sovDark, 0.15, 0.012, 0.2, 0.3, 0.285, 0, { b: 0.004 });
  towHooks(r, 0.46, 0.1, 0.08, 1);
  sovietStar(r, 0.03, [0.3, 0.23, 0.161], faceRot('+z'));
  sovietStar(r, 0.03, [0.3, 0.23, -0.161], faceRot('-z'));
  for (const s of [-1, 1]) r.box(P.sov, 0.15, 0.012, 0.07, 0.3, 0.155, 0.16 * s, { b: 0.004 });
  // flatbed with side rails
  r.box(P.sovDark, 0.6, 0.035, 0.32, -0.17, 0.13, 0, { b: 0.008 });
  for (const s of [-1, 1]) {
    r.box(M.gun, 0.6, 0.04, 0.012, -0.17, 0.165, 0.155 * s, { b: 0.003 });
    for (const x of [-0.11, -0.3]) r.box(P.sov, 0.15, 0.012, 0.07, x, 0.158, 0.16 * s, { b: 0.004 });
  }
  hazard(r, 0.3, 0.03, [-0.472, 0.13, 0], [0, -Math.PI / 2, 0]);
  taillights(r, -0.472, 0.15, 0.13);
  // the device: a fat yellow cylinder with black hazard bands, end caps, straps, trefoils
  const dev = r.node('device', [-0.18, 0.245, 0]);
  dev.cyl(BOMB_YELLOW, 0.1, 0.1, 0.42, 0, 0, 0, { r: [0, 0, Math.PI / 2], seg: 14 });
  for (const x of [-0.17, -0.07, 0.07, 0.17]) dev.cyl(M.black, 0.102, 0.102, 0.03, x, 0, 0, { r: [0, 0, Math.PI / 2], seg: 14 });
  for (const sx of [-1, 1]) {
    dev.add(lathe([[0.1, 0], [0.085, 0.04], [0.04, 0.065], [0.0, 0.07]], 14), M.gun, { p: [0.21 * sx, 0, 0], r: [0, 0, -Math.PI / 2 * sx] });
    rivets(dev, [0.215 * sx, 0.06, -0.04], [0.215 * sx, 0.06, 0.04], 3, 0.005);
  }
  trefoil(dev, 0.045, [0, 0, 0.101], [Math.PI / 2, 0, 0]);
  trefoil(dev, 0.045, [0, 0, -0.101], [-Math.PI / 2, 0, 0]);
  trefoil(dev, 0.045, [0, 0.101, 0]);
  for (const x of [-0.12, 0.12]) dev.box(M.webbing, 0.025, 0.21, 0.215, x, -0.01, 0, { b: 0.004 });
  // arming panel + light
  dev.box(M.dark, 0.06, 0.03, 0.05, 0.09, 0.1, 0.0, { b: 0.006 });
  dev.sph(G.red, 0.016, 0.09, 0.125, 0, { seg: 6, slot: 'glow:arm' });
  dev.box(G.green, 0.02, 0.006, 0.012, 0.075, 0.116, 0.018, { b: 0, slot: 'glow:arm2' });
  pipe(r, [0.15, 0.2, 0.08], [-0.08, 0.32, 0.06], 0.006, M.red, 4);
  stowage(r, 0.06, 0.05, 0.06, 0.1, 0.15, -0.1, M.olive);
  antenna(r, 0.22, 0.29, -0.12, 0.2);

  return makeTemplate({
    root: r,
    height: 0.42,
    radius: 0.44,
    muzzles: [],
    glow: { glow: 2.5, 'glow:arm': 4, 'glow:arm2': 3 },
    anim: (c, s) => {
      healthVariant(c, s);
      animTracks(c, s, 12);
      const armed = s.charge > 0.5 && s.charge < 0.999 ? true : s.moving;
      c.setGlow('glow:arm', blink(s.time, armed ? 0.35 : 1.6, armed ? 0.5 : 0.2) ? 1 : 0.08);
      c.setGlow('glow:arm2', armed ? 0.2 : 1);
    },
  });
}

// =============================================================================================
// Phase Transport (Allied)
// =============================================================================================

function phaseTransport(): ModelTemplate {
  const r = root();
  runningGear(r, { L: 0.74, H: 0.12, W: 0.11, Z: 0.205, wheels: 5, wheelK: 0.38 });
  r.box(P.allyDark, 0.68, 0.06, 0.3, 0, 0.08, 0, { b: 0.008 });
  // faceted hull
  r.add(
    prismXY(
      [
        [-0.38, 0.09],
        [0.31, 0.09],
        [0.4, 0.14],
        [0.3, 0.235],
        [0.12, 0.27],
        [-0.34, 0.27],
        [-0.39, 0.22],
      ],
      0.38,
      0.018,
    ),
    P.allyTeam,
  );
  camoTop(r, 0.3, 0.3, [-0.2, 0.2715, 0], 3, 91);
  for (const s of [-1, 1]) {
    r.add(
      prismXY(
        [
          [-0.36, 0.1],
          [0.3, 0.1],
          [0.36, 0.16],
          [-0.37, 0.18],
        ],
        0.02,
        0.005,
      ),
      M.teamDark,
      { p: [0, 0, 0.2 * s] },
    );
    camoFace(r, 0.55, 0.05, [-0.02, 0.14, 0.2105 * s], s > 0 ? 0 : Math.PI, 3, 92 + s);
    rivets(r, [-0.3, 0.15, 0.211 * s], [0.25, 0.15, 0.211 * s], 6, 0.004);
  }
  // rear doors
  r.box(M.teamDark, 0.012, 0.13, 0.26, -0.39, 0.17, 0, { b: 0.004 });
  r.box(M.dark, 0.014, 0.12, 0.004, -0.392, 0.17, 0, { b: 0 });
  headlights(r, 0.38, 0.17, 0.12, 0.011);
  taillights(r, -0.395, 0.22, 0.14);
  alliedStar(r, 0.028, [-0.2, 0.2705, 0.08]);
  stencilNumber(r, '5', [-0.15, 0.2, 0.2205], [0, 0, 0], 0.04);
  // phase emitters: pylons at the hull corners and a domed projector
  const pyl: [number, number][] = [
    [0.18, 0.15],
    [0.18, -0.15],
    [-0.3, 0.15],
    [-0.3, -0.15],
  ];
  for (const [x, z] of pyl) {
    r.cyl(M.gun, 0.012, 0.016, 0.07, x, 0.3, z, { seg: 6 });
    r.cyl(M.steel, 0.02, 0.02, 0.01, x, 0.33, z, { seg: 8 });
    r.sph(G.purple, 0.014, x, 0.345, z, { seg: 6, slot: 'glow:phase' });
  }
  r.add(new THREE.SphereGeometry(0.06, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), M.glassBlue, { p: [-0.08, 0.27, 0] });
  r.add(new THREE.OctahedronGeometry(0.026, 0), G.purple, { p: [-0.08, 0.3, 0], slot: 'glow:phase' });
  // small missile turret
  const t = r.node('turret', [0.12, 0.27, 0]);
  t.cyl(M.teamDark, 0.05, 0.055, 0.03, 0, 0.015, 0, { seg: 10 });
  const b0 = t.node('b0', [0.0, 0.05, 0]);
  b0.box(M.teamDark, 0.12, 0.04, 0.07, 0.03, 0, 0, { b: 0.008 });
  for (const z of [-0.016, 0.016]) {
    b0.add(new THREE.CircleGeometry(0.012, 6), M.darker, { p: [0.091, 0, z], r: [0, Math.PI / 2, 0] });
    b0.add(new THREE.CircleGeometry(0.007, 4), M.red, { p: [0.092, 0, z], r: [0, Math.PI / 2, 0] });
  }
  t.node('m0', [0.1, 0.05, -0.016]);
  t.node('m1', [0.1, 0.05, 0.016]);
  antenna(r, -0.34, 0.27, 0.12, 0.2);
  // owner-only phase shimmer shell
  const cl = r.node('cloak', [0, 0.17, 0]);
  cl.add(new THREE.SphereGeometry(0.5, 14, 8), M.dark, { s: [1, 0.42, 0.62], slot: 'fx:add:9a7aff:0.4' });

  return makeTemplate({
    root: r,
    height: 0.4,
    radius: 0.42,
    turret: 'turret',
    muzzles: ['m0', 'm1'],
    glow: { glow: 2.5, 'glow:phase': 3.2 },
    init: (c) => {
      const m = c.n['fx:cloak'] as THREE.Mesh | undefined;
      if (m) {
        m.material = cloakMaterial();
        m.renderOrder = 3;
      }
    },
    anim: (c, s) => {
      healthVariant(c, s);
      animTracks(c, s);
      recoil(c, s, ['b0'], 0.015);
      fxTime(s.time);
      const k = Math.min(1, Math.max(0, s.cloak ?? 0));
      if (c.v.seed === undefined) c.v.seed = Math.random() * 5;
      const flick = 0.7 + 0.3 * Math.sin(s.time * (k > 0 ? 14 : 3) + c.v.seed);
      c.setGlow('glow:phase', (0.35 + 0.65 * k) * flick);
      const cl = c.n['fx:cloak'];
      if (cl) {
        cl.visible = k > 0.02;
        if (cl.visible) {
          const b = 1 + 0.03 * Math.sin(s.time * 2.3);
          cl.scale.set(b * (0.85 + 0.15 * k), (0.85 + 0.15 * k) * (2 - b), b * (0.85 + 0.15 * k));
        }
      }
    },
  });
}

/**
 * [UNITS] The minelayer / mobile gap generator / radar jammer rebuilt in vehicles.ts ride along here: index.ts
 * spreads AFTERMATH_BUILDERS after SUPPORT_BUILDERS, so these supersede the support.ts versions.
 */
export const AFTERMATH_BUILDERS: Record<string, (fac?: ModelFaction) => ModelTemplate> = {
  ...SUPPORT_VEHICLE_BUILDERS,
  ttnk: teslaTank,
  qtnk: madTank,
  ctnk: chronoTank,
  dtrk: demoTruck,
  stnk: phaseTransport,
};
