/**
 * Ground vehicles. All face +X, origin at ground centre.
 * Muzzle ordering for twin weapons: index 0 = left barrel (-Z), 1 = right barrel (+Z).
 */
import * as THREE from 'three';
import { NB, makeTemplate, type Ctx, type Mat, type ModelFaction, type ModelTemplate, type V3 } from './builder';
import { fxTime, gapHazeMaterial } from './fxmats';
import {
  M,
  G,
  alliedStar,
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
  wheel,
  orePile,
  stencilNumber,
  hatch,
} from './parts';
import { animTracks, approach, blink, dtOf, healthVariant, recoil } from './anim';
import {
  P,
  bedroll,
  bolts,
  camoFace,
  camoTop,
  decalRot,
  edgeFrame,
  edgePlate,
  headlights,
  jerryRack,
  muzzleBrake,
  pbox,
  cbox,
  skirt,
  smokeDischargers,
  taillights,
  cupola,
  cylX,
  cylZ,
  evacuator,
  exhaust,
  far,
  fender,
  fuelDrum,
  latheFine,
  liftEyes,
  louvres,
  near,
  periscope,
  pintleMG,
  markerLamp,
  rotYX,
  roundHatch,
  runningGear,
  searchlight,
  seam,
  slopePlate,
  spareTracks,
  stowBox,
  towCable,
  towHooks,
  unditchLog,
  whip,
} from './unitkit';

const VEH_AO = { h: 0.12, min: 0.55 };

function root(): NB {
  const r = new NB('root');
  r.ao = VEH_AO;
  return r;
}

type P2 = [number, number];

const BOLT_HUB = new THREE.OctahedronGeometry(1, 0);
const GUN_WOOD_V: Mat = { c: 0x7a4c2a, m: 0, r: 0.6, d: 2 };

/** Stencilled number centred on edge i of a top-view outline (turret sides). */
function edgeNumber(nb: NB, pts: P2[], i: number, y: number, text: string, h = 0.03, shift = 0): void {
  const f = edgeFrame(pts, i);
  const sx = Math.cos(f.yaw);
  const sz = -Math.sin(f.yaw);
  stencilNumber(nb, text, [f.cx + f.nx * 0.0015 + sx * shift, y, f.cz + f.nz * 0.0015 + sz * shift], [0, f.yaw, 0], h);
}

/** Allied star decal centred on edge i of a top-view outline. */
function edgeStar(nb: NB, pts: P2[], i: number, y: number, size: number, shift = 0): void {
  const f = edgeFrame(pts, i);
  const sx = Math.cos(f.yaw);
  const sz = -Math.sin(f.yaw);
  alliedStar(nb, size, [f.cx + f.nx * 0.0015 + sx * shift, y, f.cz + f.nz * 0.0015 + sz * shift], decalRot(f.yaw));
}

/** Camouflage blotches on edge i of a top-view outline (vertical face from y0 to y1). */
function edgeCamo(nb: NB, pts: P2[], i: number, y0: number, y1: number, n: number, seed: number): void {
  const f = edgeFrame(pts, i);
  camoFace(nb, f.len * 0.9, y1 - y0, [f.cx + f.nx * 0.0015, (y0 + y1) / 2, f.cz + f.nz * 0.0015], f.yaw, n, seed);
}

// =============================================================================================
// Light tank (Allied): M41 Walker Bulldog style
// team paint with dark camouflage, fender stowage, commander with .50 cal, muzzle brake
// =============================================================================================

function lightTank(): ModelTemplate {
  const r = root();
  const team = P.allyTeam;
  runningGear(r, { L: 0.72, H: 0.13, W: 0.11, Z: 0.19, wheels: 5, wheelK: 0.38 });
  r.box(P.allyDark, 0.64, 0.07, 0.28, 0, 0.085, 0, { b: 0.01 });
  r.add(
    prismXY(
      [
        [-0.36, 0.11],
        [0.3, 0.11],
        [0.375, 0.155],
        [0.25, 0.205],
        [-0.34, 0.212],
        [-0.37, 0.17],
      ],
      0.32,
      0.012,
    ),
    team,
  );
  camoTop(r, 0.46, 0.26, [-0.06, 0.2135, 0], 5, 11);
  for (const s of [-1, 1]) {
    fender(r, team, 0.76, 0.13, 0.13, 0.19 * s, 0, 0.07, 0.05);
    stowBox(r, P.allyDark, 0.13, 0.04, 0.075, -0.17, 0.142, 0.205 * s);
    camoFace(r, 0.6, 0.06, [0, 0.165, 0.1605 * s], s > 0 ? 0 : Math.PI, 3, 12 + s);
  }
  jerryRack(r, 2, 0.08, 0.142, 0.205, P.jerry, 0);
  bedroll(r, P.canvasOlive, 0.12, 0.016, 0.08, 0.142, -0.205);
  headlights(r, 0.33, 0.162, 0.2, 0.012);
  taillights(r, -0.372, 0.18, 0.12);
  slopePlate(r, P.allyDark, [0.375, 0.155], [0.25, 0.205], 0.2, 0, 0.008, 0.7);
  spareTracks(r, 4, 0.322, 0.181, 0, -0.38, 0.055);
  louvres(r, 0.12, 0.2, [-0.27, 0.2125, 0], 5);
  for (const s of [-1, 1]) r.node(s < 0 ? 'ex0' : 'ex1', exhaust(r, -0.36, 0.145, 0.085 * s, s));
  towHooks(r, 0.37, 0.12, 0.1, 1);
  towHooks(r, -0.37, 0.12, 0.1, -1);
  towCable(r, -0.3, 0.15, 0.2, 0.161);
  bolts(r, [-0.3, 0.2125, 0.145], [0.2, 0.207, 0.145], 4);
  bolts(r, [-0.3, 0.2125, -0.145], [0.2, 0.207, -0.145], 4);
  alliedStar(r, 0.028, [-0.375, 0.17, 0], decalRot(-Math.PI / 2));

  const t = r.node('turret', [-0.03, 0.21, 0]);
  const tp: P2[] = [
    [0.13, -0.06],
    [0.13, 0.06],
    [0.06, 0.115],
    [-0.1, 0.12],
    [-0.16, 0.08],
    [-0.16, -0.08],
    [-0.1, -0.12],
    [0.06, -0.115],
  ];
  t.add(prismXZ(tp, 0.085, 0.022), team);
  camoTop(t, 0.22, 0.2, [-0.03, 0.0865, 0], 4, 21);
  edgeCamo(t, tp, 2, 0.01, 0.075, 2, 22);
  edgeCamo(t, tp, 6, 0.01, 0.075, 2, 23);
  edgeStar(t, tp, 2, 0.045, 0.022, 0.03);
  edgeStar(t, tp, 6, 0.045, 0.022, -0.03);
  edgeNumber(t, tp, 2, 0.045, '21', 0.026, -0.045);
  edgeNumber(t, tp, 6, 0.045, '21', 0.026, 0.045);
  // mantlet, sight, smoke dischargers
  t.box(P.allyDark, 0.05, 0.056, 0.095, 0.145, 0.04, 0, { b: 0.012 });
  bolts(t, [0.171, 0.06, -0.04], [0.171, 0.06, 0.04], 4, 0.006);
  for (const s of [-1, 1]) smokeDischargers(t, [0.09, 0.06, 0.1 * s], s);
  periscope(t, [0.07, 0.085, -0.06]);
  // commander's cupola (right) with the .50 cal, loader's hatch (left)
  cupola(t, M.teamDark, 0.032, [-0.05, 0.085, 0.05], { lidSide: 1 });
  pintleMG(t, [-0.03, 0.11, 0.05], 0.1);
  roundHatch(t, M.teamDark, 0.028, [-0.05, 0.085, -0.055]);
  // bustle rack: bedroll and jerry cans
  near(t, () => {
    pbox(t, M.dark, 0.06, 0.006, 0.22, -0.19, 0.03, 0);
    for (const z of [-0.1, 0.1]) pbox(t, M.dark, 0.06, 0.03, 0.005, -0.19, 0.045, z);
  });
  bedroll(t, P.canvasOlive, 0.18, 0.017, -0.185, 0.033, 0, Math.PI / 2);
  for (const s of [-1, 1]) whip(t, -0.13, 0.085, 0.085 * s, 0.2, s < 0);
  // gun: bore evacuator and a T-shaped muzzle brake
  const b0 = t.node('b0', [0.165, 0.04, 0]);
  barrel(b0, 0.27, 0.014, {});
  evacuator(b0, 0.17, 0.045, 0.014);
  muzzleBrake(b0, 0.285, 0.014);
  t.node('m0', [0.45, 0.04, 0]);

  return makeTemplate({
    root: r,
    height: 0.32,
    radius: 0.38,
    turret: 'turret',
    muzzles: ['m0'],
    smoke: ['ex0', 'ex1'],
    glow: { glow: 2.5 },
    anim: (c, s) => {
      healthVariant(c, s);
      animTracks(c, s);
      recoil(c, s, ['b0'], 0.05);
    },
  });
}

// =============================================================================================
// Medium tank (Allied): M60 / Abrams style
// armoured skirts in alternating team panels, bustle rack, two crew hatches with MGs
// =============================================================================================

function mediumTank(): ModelTemplate {
  const r = root();
  const team = P.allyTeam;
  runningGear(r, { L: 0.82, H: 0.14, W: 0.125, Z: 0.21, wheels: 6, wheelK: 0.36 });
  r.box(P.allyDark, 0.72, 0.07, 0.3, 0, 0.09, 0, { b: 0.01 });
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
    team,
  );
  camoTop(r, 0.5, 0.3, [-0.07, 0.2315, 0], 5, 31);
  for (const s of [-1, 1]) {
    fender(r, team, 0.84, 0.14, 0.142, 0.21 * s, 0, 0.07, 0.05);
    skirt(r, 0.78, 0.075, 0.152, 0.279 * s, 4, team, M.teamDark, 0.01);
    camoFace(r, 0.7, 0.06, [0.01, 0.115, 0.2875 * s], s > 0 ? 0 : Math.PI, 4, 32 + s);
    stowBox(r, P.allyDark, 0.14, 0.04, 0.08, -0.2, 0.154, 0.215 * s);
  }
  headlights(r, 0.39, 0.18, 0.14, 0.012);
  taillights(r, -0.405, 0.2, 0.13);
  slopePlate(r, P.allyDark, [0.43, 0.16], [0.3, 0.225], 0.24, 0, 0.008, 0.6);
  spareTracks(r, 3, 0.372, 0.194, 0, -0.45, 0.06);
  louvres(r, 0.14, 0.24, [-0.3, 0.2315, 0], 4);
  r.box(M.darker, 0.012, 0.05, 0.22, -0.41, 0.17, 0, { b: 0 });
  r.node('exhaust', [-0.42, 0.17, 0]);
  jerryRack(r, 3, -0.385, 0.232, 0, P.jerry, Math.PI / 2);
  towHooks(r, 0.43, 0.12, 0.11, 1);
  towHooks(r, -0.41, 0.12, 0.11, -1);
  bolts(r, [-0.34, 0.2315, 0.165], [0.26, 0.226, 0.165], 5);
  bolts(r, [-0.34, 0.2315, -0.165], [0.26, 0.226, -0.165], 5);

  const t = r.node('turret', [-0.04, 0.228, 0]);
  const tp: P2[] = [
    [0.21, -0.045],
    [0.21, 0.045],
    [0.1, 0.15],
    [-0.15, 0.16],
    [-0.25, 0.125],
    [-0.25, -0.125],
    [-0.15, -0.16],
    [0.1, -0.15],
  ];
  t.add(prismXZ(tp, 0.09, 0.028), team);
  camoTop(t, 0.3, 0.26, [-0.04, 0.0915, 0], 5, 41);
  edgeCamo(t, tp, 2, 0.01, 0.08, 3, 42);
  edgeCamo(t, tp, 6, 0.01, 0.08, 3, 43);
  edgeStar(t, tp, 2, 0.048, 0.024, 0.05);
  edgeStar(t, tp, 6, 0.048, 0.024, -0.05);
  edgeNumber(t, tp, 2, 0.048, '114', 0.026, -0.05);
  edgeNumber(t, tp, 6, 0.048, '114', 0.026, 0.05);
  // mantlet + gunner's sight + smoke dischargers
  t.box(M.teamDark, 0.05, 0.062, 0.12, 0.215, 0.04, 0, { b: 0.014 });
  t.box(P.allyDark, 0.05, 0.03, 0.045, 0.1, 0.105, -0.085, { b: 0.006 });
  near(t, () => pbox(t, P.lens, 0.004, 0.018, 0.034, 0.126, 0.106, -0.085));
  for (const s of [-1, 1]) smokeDischargers(t, [0.12, 0.068, 0.135 * s], s, 3);
  // commander (right) with the M2, loader (left) with a shielded MG
  cupola(t, M.teamDark, 0.036, [-0.08, 0.09, 0.075], { lidSide: 1 });
  pintleMG(t, [-0.055, 0.116, 0.075], 0.11);
  roundHatch(t, M.teamDark, 0.03, [-0.06, 0.09, -0.075]);
  pintleMG(t, [-0.03, 0.09, -0.075], 0.09, true, M.teamDark);
  // bustle rack with stowage
  t.box(M.dark, 0.08, 0.008, 0.26, -0.29, 0.03, 0, { b: 0 });
  near(t, () => {
    for (const z of [-0.12, 0, 0.12]) pbox(t, M.dark, 0.08, 0.04, 0.006, -0.29, 0.05, z);
    pbox(t, M.dark, 0.006, 0.04, 0.26, -0.33, 0.05, 0);
  });
  stowBox(t, P.canvasOlive, 0.06, 0.035, 0.09, -0.29, 0.034, -0.065);
  bedroll(t, P.canvasTan, 0.1, 0.018, -0.29, 0.034, 0.07, Math.PI / 2);
  for (const s of [-1, 1]) whip(t, -0.22, 0.09, 0.1 * s, 0.22, s > 0);
  // wind sensor mast (close up)
  near(t, () => {
    t.cyl(M.dark, 0.003, 0.003, 0.05, -0.2, 0.115, 0.0, { seg: 3 });
    pbox(t, M.dark, 0.012, 0.006, 0.012, -0.2, 0.14, 0);
  });
  const b0 = t.node('b0', [0.22, 0.04, 0]);
  barrel(b0, 0.38, 0.0145, {});
  evacuator(b0, 0.24, 0.06, 0.0145);
  near(b0, () => {
    for (const x of [0.06, 0.14]) cylX(b0, M.gun, 0.0175, 0.01, [x, 0, 0], 8, true);
    pbox(b0, M.dark, 0.02, 0.012, 0.016, 0.37, 0.018, 0);
  });
  t.node('m0', [0.61, 0.04, 0]);

  return makeTemplate({
    root: r,
    height: 0.34,
    radius: 0.42,
    turret: 'turret',
    muzzles: ['m0'],
    smoke: ['exhaust'],
    glow: { glow: 2.5 },
    anim: (c, s) => {
      healthVariant(c, s);
      animTracks(c, s);
      recoil(c, s, ['b0'], 0.06);
    },
  });
}

// =============================================================================================
// Heavy tank (Soviet, twin barrels): T-55 style dome turret, big road wheels, fender fuel tanks
// olive drab with team-colour appliqué plates; close-up crew, stowage and fittings
// =============================================================================================

function heavyTank(): ModelTemplate {
  const r = root();
  const sov = P.sov;
  const sovD = P.sovDark;
  const team = M.team;
  runningGear(r, { L: 0.9, H: 0.16, W: 0.14, Z: 0.235, wheels: 5, wheelK: 0.41 });
  // lower hull between the tracks
  r.box(sovD, 0.8, 0.08, 0.34, 0, 0.1, 0, { b: 0.01 });
  // upper hull: lower + upper glacis, flat deck, sloped rear
  const hullPts: [number, number][] = [
    [-0.45, 0.12],
    [0.36, 0.12],
    [0.47, 0.168],
    [0.33, 0.236],
    [-0.42, 0.242],
    [-0.46, 0.2],
  ];
  r.add(prismXY(hullPts, 0.4, 0.016), sov);
  // team-colour glacis plate with a weld seam, bolts close up
  slopePlate(r, team, [0.47, 0.168], [0.33, 0.236], 0.3, 0, 0.012, 0.86);
  bolts(r, [0.455, 0.183, -0.13], [0.455, 0.183, 0.13], 6, 0.007);
  spareTracks(r, 4, 0.44, 0.15, 0, -1.15, 0.06);
  // fenders over the tracks, front stowage bins in team colour
  for (const s of [-1, 1]) {
    fender(r, sov, 0.94, 0.15, 0.16, 0.235 * s, 0, 0.08, 0.05);
    stowBox(r, team, 0.11, 0.045, 0.1, 0.25, 0.172, 0.24 * s);
  }
  // right fender: external fuel tanks; left fender: stowage, tool box and the exhaust
  for (let i = 0; i < 3; i++) fuelDrum(r, 0.1, 0.034, 0.1 - i * 0.12, 0.172, 0.245, sovD);
  stowBox(r, sovD, 0.16, 0.05, 0.1, 0.03, 0.172, -0.24);
  stowBox(r, P.sovLight, 0.1, 0.04, 0.09, -0.14, 0.172, -0.24);
  const ex = exhaust(r, -0.33, 0.19, -0.265, -1);
  r.node('exhaust', ex);
  // engine deck: louvres, rear fuel drums and the unditching log
  louvres(r, 0.15, 0.26, [-0.3, 0.244, 0], 7);
  unditchLog(r, 0.42, 0.024, -0.405, 0.242);
  for (const z of [-0.085, 0.085]) {
    far(r, () => cylZ(r, sovD, 0.033, 0.15, [-0.485, 0.205, z], 5));
    near(r, () => {
      cylZ(r, sovD, 0.033, 0.15, [-0.485, 0.205, z], 8);
      cylZ(r, M.dark, 0.035, 0.008, [-0.485, 0.205, z], 8, true);
    });
  }
  r.box(sovD, 0.03, 0.05, 0.36, -0.47, 0.16, 0, { b: 0.006 });
  headlights(r, 0.44, 0.205, 0.15, 0.013);
  taillights(r, -0.462, 0.205, 0.15);
  towHooks(r, 0.47, 0.13, 0.12, 1);
  towHooks(r, -0.47, 0.13, 0.12, -1);
  towCable(r, -0.3, 0.2, 0.226, 0.201);
  seam(r, 0.003, 0.08, 0.36, 0.12, 0.244, 0);
  bolts(r, [-0.4, 0.2445, 0.17], [0.3, 0.2445, 0.17], 9, 0.006);
  bolts(r, [-0.4, 0.2445, -0.17], [0.3, 0.2445, -0.17], 9, 0.006);
  stencilNumber(r, '305', [-0.47, 0.215, 0.12], [0, -Math.PI / 2, 0], 0.03);

  // turret: cast dome (smoother close up), team cheek plates and a team band at the ring
  const t = r.node('turret', [-0.05, 0.236, 0]);
  const dome: [number, number][] = [
    [0.0, 0.122],
    [0.1, 0.118],
    [0.17, 0.095],
    [0.207, 0.055],
    [0.218, 0.018],
    [0.21, 0.0],
    [0.0, 0.0],
  ];
  far(t, () =>
    t.add(
      lathe(
        [
          [0.0, 0.122],
          [0.15, 0.105],
          [0.207, 0.055],
          [0.218, 0.018],
          [0.21, 0.0],
        ],
        10,
      ),
      sov,
      { s: [1.1, 1, 1] },
    ),
  );
  near(t, () => t.add(latheFine(dome, 14), sov, { s: [1.1, 1, 1] }));
  t.cyl(team, 0.232, 0.236, 0.016, 0, 0.008, 0, { seg: 12, open: true, s: [1.1, 1, 1] });
  // cheek plates tangent to the dome, leaning in with it
  for (const s of [-1, 1]) {
    for (const [a, w] of [
      [0.85, 0.12],
      [1.5, 0.12],
    ] as const) {
      const ang = a * s;
      t.box(team, w, 0.06, 0.014, Math.cos(ang) * 0.226, 0.045, Math.sin(ang) * 0.208, { b: 0.004, r: rotYX(Math.PI / 2 - ang, -0.42) });
    }
  }
  sovietStar(t, 0.032, [-0.02, 0.123, 0.0]);
  // mantlet with the twin gun ports
  t.box(sovD, 0.09, 0.072, 0.2, 0.205, 0.05, 0, { b: 0.022 });
  near(t, () => {
    for (const z of [-0.05, 0.05]) cylX(t, M.dark, 0.022, 0.03, [0.252, 0.05, z], 8);
  });
  // commander's cupola (left) with the commander, loader's hatch with DShK (right), IR searchlight
  cupola(t, sovD, 0.04, [-0.06, 0.112, -0.07], { lidSide: -1 });
  roundHatch(t, sovD, 0.034, [-0.05, 0.114, 0.075]);
  pintleMG(t, [-0.02, 0.122, 0.075], 0.13);
  searchlight(t, [0.16, 0.112, 0.115], 0.024);
  periscope(t, [0.07, 0.112, -0.03]);
  periscope(t, [0.07, 0.112, 0.04]);
  // turret rear: stowage bin, snorkel tube, whip antenna with a team pennant
  stowBox(t, sovD, 0.06, 0.05, 0.18, -0.235, 0.02, 0);
  cylZ(t, M.gun, 0.016, 0.2, [-0.2, 0.09, 0.0], 7);
  whip(t, -0.17, 0.08, -0.13, 0.24, true);
  markerLamp(t, [-0.19, 0.088, 0.07], 0.15);
  liftEyes(t, [
    [0.1, 0.112, -0.12],
    [0.1, 0.112, 0.12],
    [-0.15, 0.1, 0.0],
  ]);
  stencilNumber(t, '305', [-0.1, 0.06, 0.226], [0, 0.35, 0], 0.03, M.white);
  stencilNumber(t, '305', [-0.1, 0.06, -0.226], [0, Math.PI - 0.35, 0], 0.03, M.white);
  // twin guns with bore evacuators
  for (const [i, z] of [
    [0, -0.05],
    [1, 0.05],
  ] as const) {
    const b = t.node(`b${i}`, [0.24, 0.05, z]);
    barrel(b, 0.42, 0.0145, {});
    evacuator(b, 0.27, 0.06, 0.0145);
    near(b, () => cylX(b, M.dark, 0.0175, 0.018, [0.41, 0, 0], 8, true));
    t.node(`m${i}`, [0.66, 0.05, z]);
  }

  return makeTemplate({
    root: r,
    height: 0.37,
    radius: 0.46,
    turret: 'turret',
    muzzles: ['m0', 'm1'],
    smoke: ['exhaust'],
    glow: { glow: 2.5 },
    anim: (c, s) => {
      healthVariant(c, s);
      animTracks(c, s);
      recoil(c, s, ['b0', 'b1'], 0.06);
    },
  });
}

// =============================================================================================
// Mammoth tank (Soviet): twin big guns, missile pods, four tracks
// olive drab with team-colour cheek plates, skirts and pods; exhaust stacks, crew, stowage
// =============================================================================================

function mammothTank(): ModelTemplate {
  const r = root();
  const sov = P.sov;
  const sovD = P.sovDark;
  const team = M.team;
  runningGear(r, { L: 1.06, H: 0.17, W: 0.12, Z: 0.2, wheels: 6, faces: false });
  runningGear(r, { L: 1.1, H: 0.17, W: 0.125, Z: 0.345, wheels: 5, wheelK: 0.4 });
  pbox(r, sovD, 1.0, 0.09, 0.62, 0, 0.11, 0);
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
    sov,
  );
  slopePlate(r, team, [0.585, 0.2], [0.44, 0.275], 0.4, 0, 0.014, 0.84);
  bolts(r, [0.565, 0.217, -0.17], [0.565, 0.217, 0.17], 5, 0.008);
  spareTracks(r, 4, 0.53, 0.165, 0, -1.0, 0.08);
  // track pods between the track pairs, outer fenders with alternating team skirt panels
  for (const s of [-1, 1]) {
    pbox(r, sov, 1.04, 0.05, 0.07, -0.01, 0.19, 0.272 * s);
    fender(r, sov, 1.14, 0.135, 0.172, 0.345 * s, 0, 0.09, 0.05);
    skirt(r, 1.02, 0.09, 0.182, 0.415 * s, 4, sov, team, 0.0, sovD);
    stowBox(r, team, 0.14, 0.05, 0.1, 0.3, 0.184, 0.35 * s);
    jerryRack(r, 2, -0.2, 0.184, 0.35 * s, P.jerry, 0);
    // tall exhaust stacks with heat shields
    r.cyl(M.dark, 0.024, 0.028, 0.12, -0.44, 0.33, 0.17 * s, { seg: 7, open: true });
    near(r, () => {
      r.cyl(P.rust, 0.026, 0.026, 0.014, -0.44, 0.385, 0.17 * s, { seg: 7, open: true });
      pbox(r, sovD, 0.06, 0.08, 0.008, -0.44, 0.32, (0.17 + 0.032) * s);
    });
    r.node(s < 0 ? 'ex0' : 'ex1', [-0.44, 0.395, 0.17 * s]);
  }
  louvres(r, 0.16, 0.3, [-0.34, 0.2865, 0], 7);
  unditchLog(r, 0.5, 0.028, -0.5, 0.268);
  headlights(r, 0.55, 0.23, 0.18, 0.015);
  taillights(r, -0.572, 0.24, 0.18);
  towHooks(r, 0.58, 0.15, 0.15, 1);
  towHooks(r, -0.575, 0.15, 0.15, -1);
  for (const s of [-1, 1]) bolts(r, [-0.5, 0.287, 0.215 * s], [0.4, 0.277, 0.215 * s], 4, 0.008);
  stencilNumber(r, '01', [-0.578, 0.25, 0.12], [0, -Math.PI / 2, 0], 0.035);

  const t = r.node('turret', [-0.05, 0.283, 0]);
  const tp: P2[] = [
    [0.27, -0.1],
    [0.27, 0.1],
    [0.17, 0.2],
    [-0.19, 0.21],
    [-0.3, 0.15],
    [-0.3, -0.15],
    [-0.19, -0.21],
    [0.17, -0.2],
  ];
  t.add(prismXZ(tp, 0.1, 0.03), sov);
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
    sovD,
    { p: [0, 0.1, 0] },
  );
  // team appliqué on the cheeks and sides
  for (const i of [1, 2, 6, 7]) edgePlate(t, team, tp, i, 0.05, 0.07, 0.78, 0.004, 0.014);
  sovietStar(t, 0.045, [0.0, 0.1305, 0]);
  edgeNumber(t, tp, 2, 0.05, '01', 0.034, -0.1);
  edgeNumber(t, tp, 6, 0.05, '01', 0.034, 0.1);
  // mantlet with bolts, twin searchlights between the guns
  t.box(sovD, 0.08, 0.085, 0.26, 0.27, 0.055, 0, { b: 0.022 });
  bolts(t, [0.312, 0.09, -0.11], [0.312, 0.09, 0.11], 6, 0.008);
  searchlight(t, [0.25, 0.14, 0.0], 0.026);
  // commander with the DShK, loader hatch, periscopes, stowage
  cupola(t, sovD, 0.045, [-0.1, 0.13, 0.07], { lidSide: 1 });
  pintleMG(t, [-0.07, 0.157, 0.07], 0.14);
  roundHatch(t, sovD, 0.036, [-0.1, 0.13, -0.075]);
  for (const z of [-0.04, 0.03]) periscope(t, [0.1, 0.13, z]);
  for (const s of [-1, 1]) smokeDischargers(t, [0.2, 0.09, 0.17 * s], s, 3);
  stowBox(t, sovD, 0.07, 0.06, 0.26, -0.33, 0.015, 0);
  whip(t, -0.26, 0.1, 0.12, 0.26, true);
  whip(t, -0.26, 0.1, -0.12, 0.2);
  for (const s of [-1, 1]) markerLamp(t, [-0.27, 0.112, 0.06 * s], 0.4 + s * 0.25);
  // twin cannons with muzzle brakes
  for (const [i, z] of [
    [0, -0.075],
    [1, 0.075],
  ] as const) {
    const b = t.node(`b${i}`, [0.3, 0.055, z]);
    barrel(b, 0.47, 0.022, {});
    evacuator(b, 0.28, 0.07, 0.02);
    muzzleBrake(b, 0.49, 0.021);
    t.node(`m${i}`, [0.79, 0.055, z]);
  }
  // missile pods on the turret sides (team cover band, red-tipped missiles)
  for (const [i, s] of [
    [2, -1],
    [3, 1],
  ] as const) {
    const z = 0.27 * s;
    cbox(t, sovD, 0.26, 0.1, 0.1, -0.02, 0.06, z, 0.016);
    pbox(t, team, 0.07, 0.104, 0.104, -0.08, 0.06, z);
    far(t, () => t.add(new THREE.PlaneGeometry(0.09, 0.09), M.darker, { p: [0.111, 0.06, z], r: [0, Math.PI / 2, 0] }));
    near(t, () => {
      for (const dy of [-0.024, 0.024]) {
        for (const dz of [-0.024, 0.024]) {
          t.add(new THREE.CircleGeometry(0.018, 6), M.darker, { p: [0.111, 0.06 + dy, z + dz], r: [0, Math.PI / 2, 0] });
          t.add(new THREE.CircleGeometry(0.01, 4), M.red, { p: [0.112, 0.06 + dy, z + dz], r: [0, Math.PI / 2, 0] });
        }
      }
    });
    pbox(t, M.dark, 0.05, 0.03, 0.02, -0.02, 0.06, z - s * 0.06);
    t.node(`m${i}`, [0.13, 0.06, z]);
  }

  return makeTemplate({
    root: r,
    height: 0.45,
    radius: 0.6,
    turret: 'turret',
    muzzles: ['m0', 'm1', 'm2', 'm3'],
    smoke: ['ex0', 'ex1'],
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
// Ranger jeep (Allied): team paint with camo, crew (driver + gunner on the pintle MG), stowage
// =============================================================================================

/** Seated crewman (helmeted head over shoulders), facing +X at p (seat height). */
function crewman(nb: NB, p: V3, helmet: Mat = M.teamDark, cloth: Mat = P.crewCloth): void {
  const [x, y, z] = p;
  pbox(nb, cloth, 0.04, 0.05, 0.06, x, y + 0.025, z);
  far(nb, () => nb.sph(helmet, 0.022, x + 0.004, y + 0.072, z, { seg: 4 }));
  near(nb, () => {
    nb.sph(M.skin, 0.017, x + 0.006, y + 0.066, z, { seg: 6 });
    nb.add(lathe([[0.0, 0.026], [0.02, 0.022], [0.026, 0.004], [0.03, 0.0]], 7), helmet, { p: [x + 0.004, y + 0.068, z] });
    for (const s of [-1, 1]) pbox(nb, cloth, 0.05, 0.016, 0.016, x + 0.03, y + 0.04, z + s * 0.03, [0, 0, -0.5]);
  });
}

function jeep(): ModelTemplate {
  const r = root();
  const team = P.allyTeam;
  const wr = 0.064;
  const axles: [string, number][] = [
    ['w0', 0.175],
    ['w1', -0.17],
  ];
  for (const [, x] of axles) {
    for (const s of [-1, 1]) wheel(r, wr, 0.052, [x, wr, 0.145 * s]);
  }
  near(r, () => {
    for (const [, x] of axles) for (const s of [-1, 1]) r.add(BOLT_HUB, M.steel, { p: [x, wr, 0.145 * s + s * 0.03], s: [0.012, 0.012, 0.008] });
  });
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
    team,
  );
  for (const s of [-1, 1]) camoFace(r, 0.5, 0.06, [0, 0.125, 0.1305 * s], s > 0 ? 0 : Math.PI, 3, 51 + s);
  camoTop(r, 0.18, 0.2, [0.18, 0.163, 0], 2, 53, undefined, -0.06);
  // wheel arches / fenders
  for (const [, x] of axles) {
    for (const s of [-1, 1]) {
      r.box(M.teamDark, 0.15, 0.014, 0.068, x, 0.15, 0.148 * s, { b: 0.006 });
    }
  }
  // seats & interior
  r.box(M.darker, 0.24, 0.01, 0.22, -0.12, 0.166, 0, { b: 0 });
  for (const z of [-0.06, 0.06]) {
    r.box(M.webbing, 0.06, 0.03, 0.07, -0.0, 0.18, z, { b: 0 });
    r.box(M.webbing, 0.015, 0.06, 0.07, -0.035, 0.205, z, { b: 0 });
  }
  crewman(r, [0.0, 0.185, -0.06]);
  near(r, () => {
    // steering wheel and column
    r.cyl(M.dark, 0.022, 0.022, 0.004, 0.045, 0.235, -0.06, { r: [0, 0, 1.0], seg: 8, open: true });
    pbox(r, M.dark, 0.04, 0.006, 0.006, 0.065, 0.215, -0.06, [0, 0, 0.9]);
  });
  // windscreen (frame + glass)
  r.box(M.dark, 0.012, 0.08, 0.25, 0.07, 0.21, 0, { b: 0.003, r: [0, 0, 0.35] });
  r.box(M.glassBlue, 0.006, 0.064, 0.23, 0.073, 0.21, 0, { b: 0, r: [0, 0, 0.35] });
  // roll bar
  pipe(r, [-0.06, 0.165, -0.12], [-0.06, 0.29, -0.1], 0.008, M.dark, 5);
  pipe(r, [-0.06, 0.165, 0.12], [-0.06, 0.29, 0.1], 0.008, M.dark, 5);
  pipe(r, [-0.06, 0.29, -0.1], [-0.06, 0.29, 0.1], 0.008, M.dark, 5);
  // grille, bumper with a winch, lights
  r.box(M.dark, 0.008, 0.035, 0.12, 0.304, 0.135, 0, { b: 0 });
  near(r, () => {
    for (let k = 0; k < 4; k++) pbox(r, M.gun, 0.004, 0.03, 0.006, 0.309, 0.135, -0.045 + k * 0.03);
    r.cyl(M.dark, 0.014, 0.014, 0.07, 0.32, 0.1, 0, { r: [Math.PI / 2, 0, 0], seg: 6 });
  });
  pbox(r, M.gun, 0.02, 0.02, 0.27, 0.31, 0.098, 0);
  headlights(r, 0.3, 0.14, 0.09, 0.011);
  taillights(r, -0.292, 0.14, 0.11);
  // spare tyre, jerry cans, shovel
  r.cyl(M.rubber, 0.05, 0.05, 0.03, -0.3, 0.16, 0, { r: [0, 0, Math.PI / 2], seg: 10 });
  near(r, () => r.add(new THREE.CircleGeometry(0.028, 6), M.gun, { p: [-0.316, 0.16, 0], r: [0, -Math.PI / 2, 0] }));
  jerryRack(r, 2, -0.25, 0.165, -0.095, P.jerry, 0);
  near(r, () => {
    pbox(r, GUN_WOOD_V, 0.16, 0.008, 0.008, 0.0, 0.14, 0.132);
    pbox(r, M.gun, 0.04, 0.004, 0.024, 0.09, 0.14, 0.132);
  });
  alliedStar(r, 0.03, [0.18, 0.163, 0], [0, 0, -0.05]);
  whip(r, -0.27, 0.165, 0.11, 0.22, true);

  // pintle MG turret with its gunner
  const t = r.node('turret', [-0.15, 0.18, 0]);
  t.cyl(M.dark, 0.012, 0.016, 0.08, 0, 0.04, 0, { seg: 6 });
  t.box(M.gun, 0.1, 0.028, 0.03, 0.02, 0.09, 0, { b: 0.006 });
  t.box(M.teamDark, 0.012, 0.06, 0.09, 0.07, 0.095, 0, { b: 0.004 });
  t.box(M.gun, 0.03, 0.03, 0.012, 0.0, 0.085, 0.022, { b: 0 });
  near(t, () => pbox(t, M.olive, 0.03, 0.02, 0.018, -0.005, 0.075, -0.024));
  crewman(t, [-0.06, 0.0, 0.0]);
  const b0 = t.node('b0', [0.07, 0.09, 0]);
  barrel(b0, 0.13, 0.006, { mat: M.dark });
  near(b0, () => cylX(b0, M.dark, 0.009, 0.05, [0.03, 0, 0], 6, true));
  t.node('m0', [0.205, 0.09, 0]);

  return makeTemplate({
    root: r,
    height: 0.3,
    radius: 0.32,
    turret: 'turret',
    muzzles: ['m0'],
    glow: { glow: 2.5 },
    anim: (c, s) => {
      healthVariant(c, s);
      animTracks(c, s, 14);
      recoil(c, s, ['b0'], 0.012);
    },
  });
}

// =============================================================================================
// APC (Allied, M113-like): team paint with camo, commander behind a gun shield, ramp door, stowage
// =============================================================================================

function apc(): ModelTemplate {
  const r = root();
  const team = P.allyTeam;
  runningGear(r, { L: 0.7, H: 0.12, W: 0.11, Z: 0.2, wheels: 5, wheelK: 0.38 });
  r.box(P.allyDark, 0.64, 0.06, 0.3, 0, 0.08, 0, { b: 0.008 });
  for (const s of [-1, 1]) fender(r, team, 0.72, 0.12, 0.122, 0.2 * s, 0, 0.05, 0.04);
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
    team,
  );
  for (const s of [-1, 1]) camoFace(r, 0.6, 0.11, [-0.03, 0.2, 0.1865 * s], s > 0 ? 0 : Math.PI, 4, 61 + s);
  camoTop(r, 0.52, 0.32, [-0.05, 0.2665, 0], 4, 63);
  // trim vane on the glacis
  r.box(M.teamDark, 0.012, 0.09, 0.3, 0.335, 0.2, 0, { b: 0.004, r: [0, 0, 0.83] });
  near(r, () => {
    for (const z of [-0.12, 0.12]) pbox(r, M.dark, 0.04, 0.008, 0.008, 0.335, 0.235, z, [0, 0, -0.6]);
  });
  // top cargo hatch, driver's hatch, engine grille
  r.box(M.teamDark, 0.22, 0.012, 0.2, -0.17, 0.27, 0, { b: 0.006 });
  near(r, () => {
    pbox(r, M.dark, 0.2, 0.004, 0.004, -0.17, 0.277, 0);
    for (const z of [-0.07, 0.07]) pbox(r, M.steel, 0.014, 0.008, 0.014, -0.075, 0.278, z);
  });
  roundHatch(r, M.teamDark, 0.034, [0.08, 0.265, 0.09]);
  louvres(r, 0.08, 0.12, [0.17, 0.267, 0.1], 4);
  // rear ramp with a door, stowage, jerry cans
  r.box(M.teamDark, 0.012, 0.15, 0.3, -0.36, 0.175, 0, { b: 0.004 });
  near(r, () => {
    pbox(r, M.dark, 0.004, 0.11, 0.07, -0.367, 0.18, 0.06);
    pbox(r, M.steel, 0.006, 0.006, 0.03, -0.368, 0.19, 0.04);
    for (const z of [-0.12, 0.12]) pbox(r, M.dark, 0.008, 0.03, 0.012, -0.366, 0.11, z);
  });
  jerryRack(r, 2, -0.37, 0.185, -0.08, P.jerry, Math.PI / 2);
  for (const s of [-1, 1]) stowBox(r, P.allyDark, 0.16, 0.035, 0.03, -0.12, 0.2, 0.2 * s);
  bedroll(r, P.canvasOlive, 0.18, 0.017, -0.16, 0.277, -0.13, Math.PI / 2);
  headlights(r, 0.36, 0.19, 0.13, 0.012);
  taillights(r, -0.368, 0.23, 0.15);
  towHooks(r, 0.37, 0.11, 0.1, 1);
  alliedStar(r, 0.032, [-0.17, 0.2765, 0.0]);
  whip(r, -0.33, 0.265, 0.16, 0.24, true);
  whip(r, -0.33, 0.265, -0.16, 0.18);
  // commander MG with shield and its gunner
  const mg = r.node('mg', [0.05, 0.265, -0.07]);
  mg.cyl(M.gun, 0.035, 0.04, 0.025, 0, 0.012, 0, { seg: 10 });
  mg.box(M.teamDark, 0.012, 0.06, 0.1, 0.05, 0.05, 0, { b: 0.004 });
  for (const s of [-1, 1]) mg.box(M.teamDark, 0.05, 0.05, 0.01, 0.03, 0.045, 0.05 * s, { b: 0, r: [0, -s * 0.5, 0] });
  mg.box(M.gun, 0.08, 0.025, 0.025, 0.01, 0.045, 0, { b: 0.005 });
  crewman(mg, [-0.03, 0.0, 0.0]);
  const b0 = mg.node('b0', [0.05, 0.045, 0]);
  barrel(b0, 0.12, 0.006, { mat: M.dark });
  mg.node('m0', [0.18, 0.045, 0]);
  stencilNumber(r, '33', [0.1, 0.19, 0.1855], [0, 0, 0], 0.035);
  stencilNumber(r, '33', [0.1, 0.19, -0.1855], [0, Math.PI, 0], 0.035);
  bolts(r, [-0.33, 0.25, 0.186], [0.24, 0.25, 0.186], 6);
  bolts(r, [-0.33, 0.25, -0.186], [0.24, 0.25, -0.186], 6);

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
// Artillery (Allied): open casemate with a crew, ready rounds, spades, camo
// =============================================================================================

function artillery(): ModelTemplate {
  const r = root();
  const team = P.allyTeam;
  runningGear(r, { L: 0.64, H: 0.12, W: 0.11, Z: 0.18, wheels: 5, x: -0.04, wheelK: 0.38 });
  r.box(P.allyDark, 0.58, 0.06, 0.27, -0.04, 0.08, 0, { b: 0.008 });
  for (const s of [-1, 1]) fender(r, team, 0.66, 0.12, 0.122, 0.18 * s, -0.04, 0.05, 0.04);
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
    team,
  );
  for (const s of [-1, 1]) camoFace(r, 0.5, 0.06, [-0.06, 0.135, 0.1705 * s], s > 0 ? 0 : Math.PI, 3, 71 + s);
  headlights(r, 0.28, 0.15, 0.1, 0.011);
  taillights(r, -0.372, 0.15, 0.13);
  towHooks(r, 0.3, 0.11, 0.08, 1);
  // gun house (open-top casemate)
  const h = r.node('house', [-0.1, 0.175, 0]);
  const hp: [number, number][] = [
    [-0.24, 0],
    [0.1, 0],
    [0.17, 0.06],
    [0.12, 0.115],
    [-0.22, 0.115],
  ];
  h.add(prismXY(hp, 0.3, 0.014), team);
  for (const s of [-1, 1]) camoFace(h, 0.3, 0.09, [-0.04, 0.06, 0.1505 * s], s > 0 ? 0 : Math.PI, 2, 73 + s);
  h.box(M.darker, 0.24, 0.01, 0.24, -0.06, 0.112, 0, { b: 0 });
  h.box(M.teamDark, 0.34, 0.012, 0.03, -0.05, 0.12, 0.135, { b: 0.004 });
  h.box(M.teamDark, 0.34, 0.012, 0.03, -0.05, 0.12, -0.135, { b: 0.004 });
  // ready rounds, ammo crates and the gun crew
  for (let i = 0; i < 4; i++) h.cyl(M.brass, 0.012, 0.012, 0.06, -0.18 + i * 0.03, 0.14, 0.09, { seg: 6 });
  near(h, () => {
    for (let i = 0; i < 4; i++) h.cyl(M.dark, 0.0125, 0.0125, 0.008, -0.18 + i * 0.03, 0.172, 0.09, { seg: 6 });
  });
  stowBox(h, M.olive, 0.08, 0.04, 0.06, -0.15, 0.11, -0.07);
  crewman(h, [-0.1, 0.112, -0.02]);
  crewman(h, [-0.19, 0.112, 0.04]);
  alliedStar(h, 0.028, [-0.04, 0.05, 0.151], faceRot('+z'));
  whip(h, -0.22, 0.115, -0.12, 0.2, true);
  // elevated gun
  const gun = r.node('gun', [0.04, 0.27, 0], [0, 0, 0.2]);
  gun.box(M.teamDark, 0.08, 0.06, 0.1, -0.02, 0, 0, { b: 0.014 });
  gun.cyl(M.steel, 0.009, 0.009, 0.16, 0.08, -0.03, 0.03, { r: [0, 0, -Math.PI / 2], seg: 6 });
  gun.cyl(M.steel, 0.009, 0.009, 0.16, 0.08, -0.03, -0.03, { r: [0, 0, -Math.PI / 2], seg: 6 });
  const b0 = gun.node('b0', [0.02, 0, 0]);
  barrel(b0, 0.52, 0.017, {});
  evacuator(b0, 0.3, 0.06, 0.017);
  muzzleBrake(b0, 0.54, 0.017);
  gun.node('m0', [0.56, 0, 0]);
  hatch(r, 0.025, [0.12, 0.175, 0.07]);
  bolts(r, [-0.33, 0.165, 0.171], [0.2, 0.165, 0.171], 5);
  bolts(r, [-0.33, 0.165, -0.171], [0.2, 0.165, -0.171], 5);
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
  const sov = P.sov;
  const sovD = P.sovDark;
  const wr = 0.07;
  const axles: [string, number][] = [
    ['w0', 0.32],
    ['w1', -0.14],
    ['w2', -0.31],
  ];
  for (const [, x] of axles) {
    for (const s of [-1, 1]) wheel(r, wr, 0.058, [x, wr, 0.165 * s]);
  }
  near(r, () => {
    for (const [, x] of axles) for (const s of [-1, 1]) r.add(BOLT_HUB, M.steel, { p: [x, wr, 0.165 * s + s * 0.032], s: [0.014, 0.014, 0.008] });
  });
  r.box(M.dark, 0.9, 0.05, 0.22, -0.01, 0.09, 0, { b: 0.008 });
  // cab: olive with team doors, crew behind the glass, roof hatch and beacon
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
    sov,
  );
  for (const s of [-1, 1]) pbox(r, M.team, 0.12, 0.07, 0.004, 0.33, 0.165, 0.161 * s);
  r.box(M.glassBlue, 0.07, 0.07, 0.27, 0.452, 0.235, 0, { b: 0.004, r: [0, 0, 0.98] });
  for (const s of [-1, 1]) r.box(M.glassBlue, 0.1, 0.05, 0.004, 0.33, 0.235, 0.162 * s, { b: 0 });
  crewman(r, [0.37, 0.16, -0.07], P.tanker);
  near(r, () => {
    crewman(r, [0.37, 0.16, 0.07], P.tanker);
    pbox(r, M.dark, 0.008, 0.07, 0.006, 0.452, 0.235, 0, [0, 0, 0.98]);
    for (const s of [-1, 1]) {
      pbox(r, M.dark, 0.006, 0.04, 0.03, 0.48, 0.25, 0.17 * s);
      pbox(r, M.steel, 0.02, 0.004, 0.004, 0.47, 0.235, 0.165 * s);
    }
  });
  r.box(M.dark, 0.012, 0.04, 0.2, 0.488, 0.14, 0, { b: 0 });
  pbox(r, M.gun, 0.02, 0.022, 0.3, 0.5, 0.11, 0);
  headlights(r, 0.49, 0.15, 0.115, 0.012);
  towHooks(r, 0.5, 0.1, 0.08, 1);
  r.box(sovD, 0.14, 0.012, 0.2, 0.32, 0.29, 0, { b: 0.004 });
  lamp(r, G.amber, [0.3, 0.305, 0.07], 0.016, 'glow:beacon');
  sovietStar(r, 0.03, [0.33, 0.235, 0.163], faceRot('+z'));
  sovietStar(r, 0.03, [0.33, 0.235, -0.163], faceRot('-z'));
  // exhaust stack behind the cab
  r.cyl(M.dark, 0.012, 0.014, 0.16, 0.2, 0.26, 0.13, { seg: 6, open: true });
  // flatbed with fenders, stowage and a crane-arm stowage box
  r.box(sovD, 0.66, 0.035, 0.32, -0.15, 0.13, 0, { b: 0.008 });
  for (const [, x] of axles.slice(1)) {
    for (const s of [-1, 1]) r.box(sov, 0.15, 0.012, 0.07, x, 0.158, 0.16 * s, { b: 0.004 });
  }
  r.box(M.gun, 0.12, 0.07, 0.24, 0.13, 0.18, 0, { b: 0.01 });
  for (const s of [-1, 1]) stowBox(r, s > 0 ? M.team : sovD, 0.14, 0.04, 0.035, -0.12, 0.148, 0.135 * s);
  jerryRack(r, 2, 0.08, 0.148, -0.12, P.jerry, 0);
  taillights(r, -0.48, 0.13, 0.13);
  hazard(r, 0.3, 0.025, [-0.482, 0.13, 0], [0, -Math.PI / 2, 0]);
  // stabiliser jacks at the rear corners
  for (const s of [-1, 1]) {
    r.box(M.gun, 0.03, 0.08, 0.03, -0.44, 0.08, 0.15 * s, { b: 0 });
    near(r, () => pbox(r, M.dark, 0.05, 0.008, 0.05, -0.44, 0.004, 0.15 * s));
  }
  whip(r, 0.24, 0.285, -0.12, 0.22, true);
  // erector rail (pivot at rear)
  const rail = r.node('rail', [-0.42, 0.18, 0], [0, 0, 0.42]);
  rail.box(M.gun, 0.74, 0.024, 0.07, 0.37, 0.0, 0, { b: 0.006 });
  rail.box(M.steel, 0.74, 0.008, 0.016, 0.37, 0.016, -0.026, { b: 0 });
  rail.box(M.steel, 0.74, 0.008, 0.016, 0.37, 0.016, 0.026, { b: 0 });
  rail.cyl(M.dark, 0.025, 0.025, 0.12, 0, 0, 0, { r: [Math.PI / 2, 0, 0], seg: 8 });
  for (const x of [0.15, 0.4, 0.62]) {
    rail.box(M.gun, 0.02, 0.05, 0.11, x, 0.03, 0, { b: 0 });
  }
  near(rail, () => {
    for (const x of [0.15, 0.4, 0.62]) for (const s of [-1, 1]) pbox(rail, M.steel, 0.024, 0.008, 0.008, x, 0.056, 0.05 * s);
    rail.cyl(M.dark, 0.004, 0.004, 0.7, 0.37, -0.016, 0.03, { r: [0, 0, Math.PI / 2], seg: 3 });
  });
  // hydraulic ram (rides with rail, reaching down)
  rail.cyl(M.steel, 0.012, 0.012, 0.16, 0.3, -0.06, 0, { r: [0, 0, 0.6], seg: 6 });
  rail.cyl(sovD, 0.018, 0.018, 0.08, 0.27, -0.09, 0, { r: [0, 0, 0.6], seg: 6 });
  const rocket = rail.node('rocket', [0.38, 0.062, 0]);
  v2Rocket(rocket);
  rail.node('m0', [0.68, 0.062, 0]);

  return makeTemplate({
    root: r,
    height: 0.5,
    radius: 0.46,
    muzzles: ['m0'],
    glow: { glow: 2.5, 'glow:beacon': 3.5 },
    anim: (c, s) => {
      healthVariant(c, s);
      animTracks(c, s, 12);
      const dt = dtOf(s);
      const ready = s.charge >= 1;
      c.show('rocket', ready);
      // raise the erector when stationary & loaded, lower while driving / reloading
      const target = s.moving ? 0.1 : ready ? 0.52 : 0.22;
      const rl = c.n.rail;
      rl.rotation.z = approach(rl.rotation.z, target, 2.5, dt);
      c.setGlow('glow:beacon', ready ? 0 : blink(s.time, 0.8, 0.5) ? 1 : 0.15);
    },
  });
}

// =============================================================================================
// Ore truck / harvester, dressed per faction: Soviet olive with team panels / Allied team paint
// =============================================================================================

/** Hull paint, secondary paint and contrasting panel paint of a faction-dressed vehicle. */
function dress(fac: ModelFaction): { hull: Mat; dark: Mat; panel: Mat } {
  return fac === 'soviet' ? { hull: P.sov, dark: P.sovDark, panel: M.team } : { hull: P.allyTeam, dark: M.teamDark, panel: P.allyDark };
}

function harvester(fac: ModelFaction = 'soviet'): ModelTemplate {
  const r = root();
  const d = dress(fac);
  runningGear(r, { L: 0.92, H: 0.15, W: 0.13, Z: 0.215, wheels: 6, x: -0.04, wheelK: 0.36 });
  for (const s of [-1, 1]) fender(r, d.hull, 0.94, 0.14, 0.152, 0.215 * s, -0.04, 0.06, 0.04);
  // chassis frame
  r.box(M.gun, 0.86, 0.08, 0.36, -0.04, 0.15, 0, { b: 0.012 });
  near(r, () => {
    for (const s of [-1, 1]) pbox(r, M.dark, 0.8, 0.02, 0.012, -0.04, 0.13, 0.184 * s);
  });
  // cab (front-left): glazed on three sides, roof rack with work lights, beacon, mirror
  const cab = r.node('cab', [0.27, 0.19, -0.13]);
  cab.add(
    prismXY(
      [
        [-0.1, 0],
        [0.12, 0],
        [0.13, 0.08],
        [0.1, 0.155],
        [-0.1, 0.155],
      ],
      0.18,
      0.014,
    ),
    d.hull,
  );
  cab.box(M.glassBlue, 0.05, 0.062, 0.15, 0.115, 0.112, 0, { b: 0.004, r: [0, 0, 0.6] });
  cab.box(M.glassBlue, 0.14, 0.052, 0.004, 0.0, 0.105, 0.091, { b: 0 });
  cab.box(M.glassBlue, 0.14, 0.052, 0.004, 0.0, 0.105, -0.091, { b: 0 });
  cab.box(d.dark, 0.21, 0.014, 0.195, 0.0, 0.162, 0, { b: 0.004 });
  lamp(cab, G.amber, [-0.03, 0.178, 0.0], 0.018, 'glow:beacon');
  near(cab, () => {
    for (const x of [0.04, -0.06]) pbox(cab, M.dark, 0.006, 0.054, 0.006, x, 0.105, 0.092);
    pbox(cab, M.dark, 0.01, 0.01, 0.17, 0.09, 0.172, 0);
    for (const z of [-0.05, 0.05]) {
      pbox(cab, M.dark, 0.016, 0.016, 0.022, 0.09, 0.184, z);
      cab.add(new THREE.CircleGeometry(0.007, 5), G.head, { p: [0.099, 0.184, z], r: [0, Math.PI / 2, 0] });
    }
    pbox(cab, M.dark, 0.004, 0.03, 0.02, 0.12, 0.12, -0.105);
    pbox(cab, M.dark, 0.04, 0.004, 0.004, 0.1, 0.12, -0.098);
    for (const y of [0.0, 0.035]) pbox(cab, M.steel, 0.04, 0.004, 0.012, 0.0, y - 0.03, -0.098);
  });
  headlights(r, 0.4, 0.27, 0.06, 0.011);
  // exhaust stack with a rain cap
  r.cyl(M.dark, 0.016, 0.018, 0.2, 0.16, 0.29, 0.07, { seg: 7, open: true });
  r.cyl(M.steel, 0.02, 0.02, 0.02, 0.16, 0.39, 0.07, { seg: 7, open: true });
  near(r, () => pbox(r, M.dark, 0.034, 0.004, 0.034, 0.165, 0.404, 0.07, [0, 0, 0.4]));
  r.node('exhaust', [0.16, 0.4, 0.07]);
  // front intake housing + rotating drum (teeth close up)
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
    d.dark,
  );
  hazard(r, 0.46, 0.03, [0.46, 0.2, 0], [0, Math.PI / 2, 0.0]);
  for (const s of [-1, 1]) cbox(r, M.gun, 0.14, 0.12, 0.016, 0.47, 0.09, 0.255 * s, 0.006);
  const drum = r.node('drum', [0.53, 0.075, 0]);
  drum.cyl(M.gun, 0.062, 0.062, 0.46, 0, 0, 0, { r: [Math.PI / 2, 0, 0], seg: 10 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    for (let k = 0; k < 2; k++) {
      const z = -0.12 + k * 0.24 + (i % 2) * 0.06;
      drum.box(M.steel, 0.026, 0.03, 0.08, Math.cos(a) * 0.066, Math.sin(a) * 0.066, z, { r: [0, 0, a], b: 0 });
    }
  }
  near(drum, () => {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.5;
      pbox(drum, M.dark, 0.012, 0.02, 0.42, Math.cos(a) * 0.06, Math.sin(a) * 0.06, 0, [0, 0, a]);
    }
  });
  // ore bin: ribbed hopper with team panels and hazard banding
  const bx = -0.17;
  const bw = 0.55;
  const bd = 0.46;
  const by = 0.19;
  const bh = 0.17;
  r.box(M.dark, bw, 0.02, bd, bx, by + 0.01, 0, { b: 0.004 });
  for (const s of [-1, 1]) {
    cbox(r, d.hull, bw, bh, 0.03, bx, by + bh / 2, (bd / 2 - 0.015) * s, 0.01);
    pbox(r, d.panel, bw * 0.62, bh * 0.5, 0.004, bx - 0.03, by + bh * 0.48, (bd / 2 + 0.001) * s);
  }
  cbox(r, d.hull, 0.03, bh, bd, bx - bw / 2 + 0.015, by + bh / 2, 0, 0.01);
  cbox(r, d.hull, 0.03, bh * 0.8, bd, bx + bw / 2 - 0.015, by + bh * 0.4, 0, 0.01);
  // ribs and the top rim
  for (let i = 0; i < 4; i++) {
    const x = bx - bw / 2 + 0.06 + i * 0.145;
    for (const s of [-1, 1]) pbox(r, d.dark, 0.022, bh + 0.012, 0.012, x, by + bh / 2, (bd / 2 + 0.002) * s);
  }
  near(r, () => {
    for (const s of [-1, 1]) pbox(r, M.gun, bw + 0.01, 0.012, 0.04, bx, by + bh + 0.006, (bd / 2 - 0.015) * s);
    for (let i = 0; i < 6; i++) {
      for (const s of [-1, 1]) r.add(new THREE.CircleGeometry(0.005, 4), M.gun, { p: [bx - bw / 2 + 0.03 + i * 0.1, by + bh - 0.02, (bd / 2 + 0.0015) * s], r: [0, s > 0 ? 0 : Math.PI, 0] });
    }
    // ladder up the rear of the bin
    for (const z of [-0.12, -0.08]) pbox(r, M.steel, 0.006, 0.2, 0.006, bx - bw / 2 - 0.006, by + 0.07, z);
    for (let k = 0; k < 5; k++) pbox(r, M.steel, 0.006, 0.005, 0.045, bx - bw / 2 - 0.006, by - 0.02 + k * 0.04, -0.1);
  });
  hazard(r, bd - 0.04, 0.03, [bx - bw / 2 - 0.003, by + bh - 0.03, 0], [0, -Math.PI / 2, 0]);
  if (fac === 'soviet') sovietStar(r, 0.04, [bx + 0.12, by + bh * 0.48, bd / 2 + 0.003], faceRot('+z'));
  else alliedStar(r, 0.036, [bx + 0.12, by + bh * 0.48, bd / 2 + 0.003], faceRot('+z'));
  taillights(r, -0.48, 0.21, 0.15);
  stowBox(r, d.dark, 0.08, 0.04, 0.06, 0.1, 0.19, 0.13);
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
      if (load <= 0.02) ore.scale.setScalar(1e-4);
      else ore.scale.set(0.6 + 0.4 * load, Math.max(0.05, load), 0.6 + 0.4 * load);
      c.setGlow('glow:beacon', s.harvesting || s.moving ? (blink(s.time, 0.6, 0.5) ? 1 : 0.1) : 0.1);
    },
  });
}

// =============================================================================================
// MCV, dressed per faction; folded crane, structure frames, generator and comms dish
// =============================================================================================

function mcv(fac: ModelFaction = 'soviet'): ModelTemplate {
  const r = root();
  const d = dress(fac);
  runningGear(r, { L: 1.02, H: 0.15, W: 0.13, Z: 0.235, wheels: 5, wheelK: 0.38 });
  for (const s of [-1, 1]) {
    fender(r, d.hull, 1.04, 0.14, 0.152, 0.235 * s, 0, 0.06, 0.04);
    skirt(r, 0.9, 0.06, 0.15, 0.306 * s, 4, d.dark, d.dark, -0.04);
  }
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
    d.hull,
  );
  r.box(M.glassBlue, 0.07, 0.065, 0.4, 0.533, 0.29, 0, { b: 0.005, r: [0, 0, 0.98] });
  for (const s of [-1, 1]) r.box(M.glassBlue, 0.12, 0.05, 0.004, 0.42, 0.29, 0.231 * s, { b: 0 });
  near(r, () => {
    for (const z of [-0.07, 0.07]) pbox(r, M.dark, 0.075, 0.006, 0.006, 0.535, 0.29, z, [0, 0, 0.98]);
    pbox(r, M.dark, 0.012, 0.012, 0.42, 0.51, 0.345, 0);
    for (const z of [-0.12, 0.12]) {
      pbox(r, M.dark, 0.016, 0.016, 0.024, 0.515, 0.358, z);
      r.add(new THREE.CircleGeometry(0.0075, 5), G.head, { p: [0.524, 0.358, z], r: [0, Math.PI / 2, 0] });
    }
  });
  headlights(r, 0.555, 0.22, 0.17, 0.013);
  r.box(M.dark, 0.008, 0.035, 0.18, 0.558, 0.22, 0, { b: 0 });
  towHooks(r, 0.56, 0.17, 0.12, 1);
  lamp(r, G.amber, [0.42, 0.355, 0.15], 0.016, 'glow:beacon');
  lamp(r, G.amber, [0.42, 0.355, -0.15], 0.016, 'glow:beacon');
  // main module: neutral walls, faction / team roof panels and stripes
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
  r.box(d.hull, 0.8, 0.03, 0.46, -0.115, 0.415, 0, { b: 0.008 });
  for (const s of [-1, 1]) {
    r.box(M.team, 0.84, 0.05, 0.012, -0.115, 0.36, 0.252 * s, { b: 0.004 });
    for (let i = 0; i < 3; i++) r.box(M.gun, 0.016, 0.14, 0.012, -0.4 + i * 0.28, 0.27, 0.252 * s, { b: 0 });
    hazard(r, 0.8, 0.03, [-0.115, 0.2, 0.257 * s], [0, s > 0 ? 0 : Math.PI, 0]);
    near(r, () => {
      // side hatches and vents
      pbox(r, M.gun, 0.12, 0.09, 0.004, -0.26, 0.28, 0.2525 * s);
      for (let k = 0; k < 3; k++) pbox(r, M.darker, 0.08, 0.006, 0.004, 0.0, 0.25 + k * 0.02, 0.2525 * s);
    });
  }
  // folded crane boom on the roof
  r.box(M.yellow, 0.66, 0.045, 0.06, -0.12, 0.455, -0.13, { b: 0.01 });
  for (let i = 0; i < 3; i++) r.box(M.dark, 0.012, 0.047, 0.062, -0.36 + i * 0.2, 0.455, -0.13, { b: 0 });
  r.box(M.yellow, 0.09, 0.09, 0.11, 0.21, 0.47, -0.13, { b: 0.014 });
  r.cyl(M.dark, 0.032, 0.032, 0.13, 0.21, 0.47, -0.13, { r: [Math.PI / 2, 0, 0], seg: 8 });
  r.box(M.steel, 0.025, 0.035, 0.025, -0.46, 0.425, -0.13, { b: 0.004 });
  near(r, () => {
    for (let i = 0; i < 6; i++) pbox(r, M.dark, 0.004, 0.04, 0.064, -0.42 + i * 0.1, 0.455, -0.13, [0, 0, 0.6]);
    r.cyl(M.steel, 0.003, 0.003, 0.5, -0.12, 0.482, -0.13, { r: [0, 0, Math.PI / 2], seg: 3 });
  });
  // folded structure frames (lattice) + generator
  for (const x of [-0.42, -0.28, -0.14]) {
    r.box(M.gun, 0.02, 0.05, 0.2, x, 0.455, 0.1, { b: 0.004 });
  }
  r.box(M.gun, 0.32, 0.016, 0.02, -0.28, 0.485, 0.02, { b: 0.003 });
  r.box(M.gun, 0.32, 0.016, 0.02, -0.28, 0.485, 0.18, { b: 0.003 });
  r.box(d.dark, 0.16, 0.07, 0.16, 0.03, 0.465, 0.12, { b: 0.012 });
  grille(r, 0.12, 0.12, [0.03, 0.502, 0.12], 5);
  const dish = r.node('dish', [0.2, 0.43, 0.15]);
  dish.cyl(M.dark, 0.01, 0.01, 0.06, 0, 0.03, 0, { seg: 6 });
  dish.add(lathe([[0.0, 0.0], [0.04, 0.012], [0.07, 0.035]], 14), M.white, { p: [0, 0.06, 0], r: [0, 0, 0.9] });
  whip(r, -0.5, 0.42, 0.2, 0.25, true);
  if (fac === 'soviet') sovietStar(r, 0.05, [-0.3, 0.4305, 0.12]);
  else alliedStar(r, 0.045, [-0.3, 0.4305, 0.12]);
  // rear
  hazard(r, 0.44, 0.04, [-0.535, 0.24, 0], [0, -Math.PI / 2, 0]);
  taillights(r, -0.535, 0.32, 0.2);
  r.box(M.dark, 0.02, 0.12, 0.2, -0.535, 0.3, 0, { b: 0.004 });
  jerryRack(r, 2, -0.545, 0.18, 0.16, P.jerry, Math.PI / 2);

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

// =============================================================================================
// Support vehicles: minelayer, mobile gap generator, radar jammer (registered through AFTERMATH_BUILDERS)
// =============================================================================================

const MINE_OLIVE: Mat = { c: 0x4a5236, m: 0.35, r: 0.6, d: 0 };

/** Concave (inner) face of a dish: lathe with the profile running top -> bottom so normals face in/up. */
function dishInner(pts: [number, number][], seg: number): THREE.BufferGeometry {
  return new THREE.LatheGeometry(
    [...pts].reverse().map(([rr, y]) => new THREE.Vector2(Math.max(rr, 0.0001), y)),
    seg,
  );
}

/** Replace an fx placeholder mesh's material with a shared animated one. */
function swapFx(c: Ctx, node: string, mat: THREE.Material): void {
  const m = c.n[`fx:${node}`] as THREE.Mesh | undefined;
  if (m) {
    m.material = mat;
    m.renderOrder = 3;
  }
}

/** Minelayer (both sides): tracked carrier, mine hopper (Allied AT / Soviet AP mines), rear chute. */
function minelayer(fac: ModelFaction = 'soviet'): ModelTemplate {
  const r = root();
  const d = dress(fac);
  runningGear(r, { L: 0.74, H: 0.13, W: 0.11, Z: 0.2, wheels: 5, wheelK: 0.38 });
  for (const s of [-1, 1]) fender(r, d.hull, 0.76, 0.12, 0.132, 0.2 * s, 0, 0.06, 0.04);
  r.box(M.dark, 0.66, 0.06, 0.3, 0, 0.085, 0, { b: 0.01 });
  r.add(
    prismXY(
      [
        [-0.37, 0.1],
        [0.31, 0.1],
        [0.385, 0.15],
        [0.33, 0.21],
        [0.08, 0.215],
        [-0.37, 0.215],
      ],
      0.37,
      0.014,
    ),
    d.hull,
  );
  if (fac !== 'soviet') {
    for (const s of [-1, 1]) camoFace(r, 0.6, 0.08, [0, 0.16, 0.1865 * s], s > 0 ? 0 : Math.PI, 3, 101 + s);
  }
  slopePlate(r, d.panel, [0.385, 0.15], [0.33, 0.21], 0.28, 0, 0.008, 0.8);
  // armoured cab (front) with vision blocks and the commander
  r.add(
    prismXY(
      [
        [0.05, 0],
        [0.24, 0],
        [0.2, 0.08],
        [0.06, 0.085],
      ],
      0.26,
      0.012,
    ),
    d.dark,
    { p: [0, 0.215, 0] },
  );
  r.box(M.glass, 0.006, 0.02, 0.2, 0.215, 0.255, 0, { b: 0, r: [0, 0, 0.45] });
  cupola(r, d.dark, 0.03, [0.11, 0.3, -0.06], { lidSide: -1 });
  headlights(r, 0.37, 0.18, 0.12);
  taillights(r, -0.372, 0.19, 0.15);
  towHooks(r, 0.38, 0.12, 0.1, 1);
  // hopper: open box full of stacked mines
  const hx = -0.16;
  const hy = 0.215;
  const hw = 0.36;
  const hd = 0.32;
  const hh = 0.09;
  for (const s of [-1, 1]) cbox(r, d.dark, hw, hh, 0.02, hx, hy + hh / 2, (hd / 2) * s, 0.005);
  cbox(r, d.dark, 0.02, hh, hd, hx + hw / 2, hy + hh / 2, 0, 0.005);
  cbox(r, d.dark, 0.02, hh * 0.7, hd, hx - hw / 2, hy + hh * 0.35, 0, 0.005);
  r.box(M.darker, hw - 0.03, 0.01, hd - 0.03, hx, hy + 0.012, 0, { b: 0 });
  const at = fac !== 'soviet';
  const mr = at ? 0.04 : 0.03;
  for (let i = 0; i < 3; i++) {
    for (let k = 0; k < 3; k++) {
      const mx = hx - 0.11 + i * 0.11;
      const mz = -0.09 + k * 0.09;
      far(r, () => r.cyl(MINE_OLIVE, mr, mr, 0.04, mx, hy + 0.04, mz, { seg: 5, open: true }));
      near(r, () => {
        r.cyl(MINE_OLIVE, mr, mr * 1.05, 0.046, mx, hy + 0.042, mz, { seg: 8 });
        r.cyl(M.dark, mr * 0.4, mr * 0.4, 0.008, mx, hy + 0.068, mz, { seg: 5, open: true });
      });
    }
  }
  hazard(r, hd, 0.025, [hx - hw / 2 - 0.011, hy + 0.045, 0], [0, -Math.PI / 2, 0]);
  // rear dispensing chute
  r.add(new THREE.BoxGeometry(0.2, 0.012, 0.11), M.gun, { p: [-0.45, 0.12, 0], r: [0, 0, 0.55] });
  for (const s of [-1, 1]) r.box(M.dark, 0.2, 0.025, 0.008, -0.45, 0.13, 0.058 * s, { b: 0, r: [0, 0, 0.55] });
  // a mine riding down the chute when firing
  const drop = r.node('drop', [-0.37, 0.17, 0]);
  drop.cyl(MINE_OLIVE, mr, mr * 1.05, 0.022, 0, 0.012, 0, { seg: 8 });
  drop.cyl(M.dark, mr * 0.4, mr * 0.4, 0.006, 0, 0.026, 0, { seg: 6 });
  // stowage, beacon, antenna, mine-warning plate
  for (const s of [-1, 1]) stowBox(r, P.canvasOlive, 0.14, 0.035, 0.05, 0.12, 0.144, 0.205 * s);
  lamp(r, G.amber, [0.14, 0.31, 0.09], 0.015, 'glow:beacon');
  whip(r, 0.06, 0.29, -0.1, 0.2, true);
  r.box(M.yellow, 0.06, 0.06, 0.004, 0.2, 0.17, 0.188, { b: 0, r: [0, 0, Math.PI / 4] });
  r.box(M.red, 0.03, 0.03, 0.004, 0.2, 0.17, 0.19, { b: 0, r: [0, 0, Math.PI / 4] });
  if (fac === 'soviet') sovietStar(r, 0.028, [0.0, 0.17, -0.1865], faceRot('-z'));
  else alliedStar(r, 0.026, [0.0, 0.17, -0.1865], faceRot('-z'));
  r.node('m0', [-0.5, 0.06, 0]);

  return makeTemplate({
    root: r,
    height: 0.36,
    radius: 0.4,
    muzzles: ['m0'],
    glow: { glow: 2.5, 'glow:beacon': 4 },
    anim: (c, s) => {
      healthVariant(c, s);
      animTracks(c, s);
      const dr = c.n.drop;
      if (s.firing > 0.02) {
        // slide down the chute (local -X and down) as the pulse decays 1 -> 0
        const k = 1 - s.firing;
        dr.scale.setScalar(1);
        dr.position.set(-0.37 - k * 0.16, 0.17 - k * 0.15, 0);
        dr.rotation.z = 0.55 * Math.min(1, k * 2);
      } else dr.scale.setScalar(1e-4);
      c.setGlow('glow:beacon', s.moving || s.firing > 0 ? (blink(s.time, 0.7, 0.5) ? 1 : 0.12) : 0.12);
    },
  });
}

/** Mobile Gap Generator (Allied): tracked chassis with generator housings and a big spinning emitter dish. */
function mobileGap(): ModelTemplate {
  const r = root();
  const team = P.allyTeam;
  runningGear(r, { L: 0.72, H: 0.12, W: 0.11, Z: 0.2, wheels: 5, wheelK: 0.38 });
  for (const s of [-1, 1]) fender(r, team, 0.74, 0.12, 0.122, 0.2 * s, 0, 0.05, 0.04);
  r.box(P.allyDark, 0.64, 0.06, 0.3, 0, 0.08, 0, { b: 0.008 });
  r.add(
    prismXY(
      [
        [-0.36, 0.09],
        [0.3, 0.09],
        [0.375, 0.14],
        [0.3, 0.235],
        [-0.355, 0.235],
      ],
      0.37,
      0.016,
    ),
    team,
  );
  for (const s of [-1, 1]) camoFace(r, 0.58, 0.1, [-0.03, 0.17, 0.1865 * s], s > 0 ? 0 : Math.PI, 3, 111 + s);
  headlights(r, 0.36, 0.17, 0.13);
  taillights(r, -0.362, 0.2, 0.15);
  towHooks(r, 0.37, 0.11, 0.1, 1);
  louvres(r, 0.12, 0.2, [-0.27, 0.237, 0], 5);
  // generator housings with cooling fins and copper feeds
  for (const s of [-1, 1]) {
    cbox(r, M.teamDark, 0.22, 0.07, 0.07, -0.1, 0.27, 0.13 * s, 0.01);
    near(r, () => {
      for (let i = 0; i < 5; i++) pbox(r, M.gun, 0.008, 0.06, 0.075, -0.18 + i * 0.04, 0.27, 0.13 * s);
    });
    pipe(r, [0.0, 0.29, 0.13 * s], [0.07, 0.3, 0.04 * s], 0.009, M.copper, 5);
    lamp(r, G.amber, [-0.2, 0.31, 0.13 * s], 0.012);
  }
  alliedStar(r, 0.03, [0.18, 0.236, 0.0]);
  whip(r, -0.33, 0.235, 0.16, 0.2, true);
  cupola(r, M.teamDark, 0.026, [0.24, 0.205, -0.1], { lidSide: -1 });
  // turntable + dish (spins with anim.deployed)
  r.cyl(M.gun, 0.07, 0.08, 0.04, 0.08, 0.255, 0, { seg: 10 });
  const dish = r.node('dish', [0.08, 0.28, 0]);
  dish.cyl(M.dark, 0.016, 0.02, 0.12, 0, 0.06, 0, { seg: 7 });
  const d2 = new NB('_d', [0, 0.16, 0], [0, 0, 0.5]);
  d2.add(lathe([[0.0, 0.0], [0.07, 0.01], [0.13, 0.035], [0.17, 0.07]], 14), M.offwhite);
  d2.add(dishInner([[0.0, 0.004], [0.069, 0.014], [0.128, 0.039], [0.166, 0.072]], 12), M.team);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    pipe(d2, [Math.cos(a) * 0.15, 0.06, Math.sin(a) * 0.15], [0, 0.17, 0], 0.003, M.dark, 3);
  }
  d2.cyl(M.dark, 0.016, 0.012, 0.03, 0, 0.18, 0, { seg: 8 });
  d2.sph(G.purple, 0.02, 0, 0.2, 0, { seg: 6, slot: 'glow:gap' });
  near(d2, () => {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      pbox(d2, M.gun, 0.01, 0.008, 0.012, Math.cos(a) * 0.168, 0.071, Math.sin(a) * 0.168, [0, -a, 0]);
    }
  });
  const haze = d2.node('haze', [0, 0.2, 0]);
  haze.sph(M.dark, 0.06, 0, 0, 0, { seg: 10, slot: 'fx:add:b050ff:1' });
  dish.children.push(d2);
  dish.box(M.gun, 0.05, 0.03, 0.04, -0.03, 0.06, 0, { b: 0.006 });

  return makeTemplate({
    root: r,
    height: 0.6,
    radius: 0.4,
    muzzles: [],
    glow: { glow: 2.5, 'glow:gap': 4 },
    init: (c) => swapFx(c, 'haze', gapHazeMaterial()),
    anim: (c, s) => {
      healthVariant(c, s);
      animTracks(c, s);
      fxTime(s.time);
      const dt = dtOf(s);
      const dep = (c.v.dep = approach(c.v.dep ?? 0, Math.min(1, Math.max(0, s.deployed ?? 0)), 1.5, dt));
      c.n.dish.rotation.y += Math.min(dt * dep * 3.2, 0.4);
      const pulse = 0.5 + 0.5 * Math.sin(s.time * 5);
      c.setGlow('glow:gap', dep > 0.05 ? 0.3 + dep * (0.5 + 0.5 * pulse) : 0.1);
      const hz = c.n['fx:haze'];
      if (hz) {
        hz.visible = dep > 0.15;
        hz.scale.setScalar(0.6 + dep * (0.8 + 0.25 * pulse));
      }
    },
  });
}

/** Mobile Radar Jammer (Allied): 6x6 truck with an electronics shelter and a telescoping, spinning array. */
function radarJammer(): ModelTemplate {
  const r = root();
  const team = P.allyTeam;
  const wr = 0.064;
  const axles = [0.27, -0.08, -0.26];
  for (const x of axles) for (const s of [-1, 1]) wheel(r, wr, 0.052, [x, wr, 0.16 * s]);
  near(r, () => {
    for (const x of axles) for (const s of [-1, 1]) r.add(BOLT_HUB, M.steel, { p: [x, wr, 0.16 * s + s * 0.03], s: [0.012, 0.012, 0.008] });
  });
  r.box(M.dark, 0.84, 0.05, 0.22, -0.02, 0.085, 0, { b: 0.008 });
  // cab with crew
  r.add(
    prismXY(
      [
        [0.18, 0.09],
        [0.42, 0.09],
        [0.43, 0.16],
        [0.38, 0.25],
        [0.2, 0.26],
      ],
      0.3,
      0.014,
    ),
    team,
  );
  r.box(M.glassBlue, 0.06, 0.06, 0.25, 0.405, 0.215, 0, { b: 0.004, r: [0, 0, 0.98] });
  for (const s of [-1, 1]) r.box(M.glassBlue, 0.09, 0.045, 0.004, 0.3, 0.215, 0.151 * s, { b: 0 });
  crewman(r, [0.33, 0.15, -0.06], M.teamDark);
  near(r, () => {
    for (const s of [-1, 1]) {
      pbox(r, M.dark, 0.006, 0.035, 0.024, 0.41, 0.23, 0.165 * s);
      pbox(r, M.steel, 0.018, 0.004, 0.004, 0.4, 0.215, 0.158 * s);
    }
    pbox(r, M.dark, 0.008, 0.06, 0.006, 0.405, 0.215, 0, [0, 0, 0.98]);
  });
  headlights(r, 0.43, 0.14, 0.11);
  pbox(r, M.gun, 0.02, 0.02, 0.26, 0.44, 0.1, 0);
  for (const x of axles) for (const s of [-1, 1]) r.box(M.teamDark, 0.14, 0.012, 0.065, x, 0.135, 0.16 * s, { b: 0.004 });
  // electronics shelter: door, vents, AC unit, ladder
  r.box(M.offwhite, 0.46, 0.2, 0.3, -0.12, 0.215, 0, { b: 0.012 });
  r.box(team, 0.48, 0.02, 0.32, -0.12, 0.325, 0, { b: 0.006 });
  for (const s of [-1, 1]) {
    r.box(team, 0.46, 0.035, 0.004, -0.12, 0.27, 0.152 * s, { b: 0 });
    grille(r, 0.08, 0.1, [-0.28, 0.2, 0.153 * s], 4, [Math.PI / 2 * s, 0, 0]);
    r.box(M.darker, 0.09, 0.14, 0.004, -0.04, 0.19, 0.152 * s, { b: 0 });
    near(r, () => {
      pbox(r, M.steel, 0.006, 0.012, 0.006, -0.005, 0.19, 0.156 * s);
      pbox(r, M.gun, 0.07, 0.06, 0.04, 0.05, 0.25, 0.17 * s);
      r.add(new THREE.CircleGeometry(0.022, 8), M.darker, { p: [0.05, 0.25, 0.1905 * s], r: [0, s > 0 ? 0 : Math.PI, 0] });
    });
  }
  near(r, () => {
    for (const z of [0.07, 0.11]) pbox(r, M.steel, 0.006, 0.2, 0.006, -0.355, 0.22, z);
    for (let k = 0; k < 5; k++) pbox(r, M.steel, 0.006, 0.005, 0.04, -0.355, 0.14 + k * 0.04, 0.09);
  });
  taillights(r, -0.352, 0.15, 0.12);
  hazard(r, 0.28, 0.025, [-0.354, 0.12, 0], [0, -Math.PI / 2, 0]);
  alliedStar(r, 0.03, [0.3, 0.215, 0.152], faceRot('+z'));
  // generator on the back + exhaust
  r.box(M.gun, 0.06, 0.07, 0.1, -0.36, 0.16, 0.06, { b: 0.008 });
  r.node('exhaust', [-0.36, 0.22, 0.06]);
  // mast + rotating array
  r.cyl(M.gun, 0.03, 0.035, 0.04, -0.12, 0.345, 0, { seg: 8 });
  const mastN = r.node('mast', [-0.12, 0.36, 0]);
  mastN.cyl(M.steel, 0.012, 0.016, 0.2, 0, 0.1, 0, { seg: 6 });
  near(mastN, () => {
    for (let k = 0; k < 3; k++) mastN.cyl(M.dark, 0.017, 0.017, 0.006, 0, 0.04 + k * 0.06, 0, { seg: 6, open: true });
  });
  const arr = mastN.node('array', [0, 0.2, 0]);
  arr.box(M.gun, 0.3, 0.016, 0.03, 0, 0, 0, { b: 0.004 });
  arr.box(M.gun, 0.03, 0.016, 0.3, 0, 0, 0, { b: 0.004 });
  for (const [x, z] of [
    [0.14, 0],
    [-0.14, 0],
    [0, 0.14],
    [0, -0.14],
  ]) {
    arr.cyl(M.offwhite, 0.005, 0.005, 0.16, x, 0.07, z, { seg: 4 });
    for (let k = 0; k < 3; k++) arr.box(M.offwhite, 0.05, 0.004, 0.004, x, 0.02 + k * 0.05, z, { b: 0, r: [0, Math.atan2(z, x) + Math.PI / 2, 0] });
    arr.sph(G.green, 0.008, x, 0.155, z, { seg: 4, slot: 'glow:jam' });
  }
  arr.cyl(M.dark, 0.02, 0.02, 0.03, 0, 0.015, 0, { seg: 8 });

  return makeTemplate({
    root: r,
    height: 0.62,
    radius: 0.44,
    muzzles: [],
    smoke: ['exhaust'],
    glow: { glow: 2.5, 'glow:jam': 4 },
    anim: (c, s) => {
      healthVariant(c, s);
      animTracks(c, s, 14);
      const dt = dtOf(s);
      const dep = (c.v.dep = approach(c.v.dep ?? 0, Math.min(1, Math.max(0, s.deployed ?? 0)), 2, dt));
      // mast telescopes up and the array spins while jamming
      c.n.mast.scale.set(1, 0.45 + 0.55 * dep, 1);
      c.n.array.rotation.y += Math.min(dt * (0.2 + dep * 2.6), 0.4);
      c.setGlow('glow:jam', dep > 0.3 ? (blink(s.time, 0.18, 0.5) ? 1 : 0.2) : 0.08);
    },
  });
}

/** Support vehicles (spread into AFTERMATH_BUILDERS). */
export const SUPPORT_VEHICLE_BUILDERS: Record<string, (fac?: ModelFaction) => ModelTemplate> = {
  mnly: minelayer,
  mgg: mobileGap,
  mrj: radarJammer,
};

export const VEHICLE_BUILDERS: Record<string, (fac?: ModelFaction) => ModelTemplate> = {
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
