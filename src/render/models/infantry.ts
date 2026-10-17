/**
 * Infantry + attack dog. Face +X, feet at y=0. One skinned body per soldier: bones body / torso / armL / armR /
 * legL / legR (+ the parachute), all on the shared per-team body material.
 *
 * Readable at the ~1.5x render scale: team-colour jacket and helmet, faction trousers, webbing and
 * packs, a distinct weapon silhouette per class. Shared classes (rifle, rocket, engineer) dress by faction
 * (Soviet SSh-40 helmet, AK, canvas sack / Allied M1 helmet, M16, ALICE pack and vest). Close-up detail (pouches,
 * straps, gloves, sights) is dropped from the distant body.
 */
import * as THREE from 'three';
import { NB, makeTemplate, type Ctx, type Mat, type ModelFaction, type ModelTemplate } from './builder';
import { M, G, lathe, pipe, shade } from './parts';
import type { ModelAnimState } from './types';
import { BodyVariant } from './materials';
import { approach, dtOf } from './anim';
import { far, latheFine, near, pbox } from './unitkit';

const HIP_Y = 0.15;
const SHOULDER_Y = 0.105; // relative to torso
const SHOULDER_Z = 0.07;
const LEG_Z = 0.034;

type Headgear = 'helmet' | 'hardhat' | 'medic' | 'tanya' | 'ushanka' | 'fedora' | 'beanie' | 'gasmask' | 'cap';

interface SoldierSpec {
  uniform: Mat;
  trousers: Mat;
  headgear: Headgear;
  /** Arms swing while walking (no two-handed weapon). */
  swingArms: boolean;
  /** Rest pose arm angles (rotation.z, rotation.x) */
  armL: [number, number];
  armR: [number, number];
  build?: (torso: NB, armL: NB, armR: NB) => void;
  /** Custom fire pose */
  fire?: 'rifle' | 'throw' | 'rocket' | 'flame' | 'pistols' | 'heal' | 'wrench' | 'none';
  /** Long coat skirt hanging from the waist (spy trench coat). */
  coat?: Mat;
  /** Parachute rig (paratroopers: only rifle infantry are dropped). */
  chute?: boolean;
  /** Hands: gloves (soldiers) or bare skin. */
  gloves?: boolean;
  /** Bare forearms (Tanya). */
  bareArms?: boolean;
  /** Shoulder pads / epaulettes in this paint (team-coloured shoulders on non-team uniforms). */
  shoulders?: Mat;
  /** Team armband on the left sleeve. */
  armband?: Mat;
}

// palette
const SOV_TROUSERS: Mat = { c: 0x5a5641, m: 0, r: 0.86, d: 2 };
const ALLY_TROUSERS: Mat = { c: 0x474b37, m: 0, r: 0.86, d: 2 };
const VEST: Mat = { c: 0x3f4231, m: 0, r: 0.8, d: 2 };
const WEB: Mat = { c: 0x5a5440, m: 0, r: 0.85, d: 2 };
const PACK_SOV: Mat = { c: 0x7c7052, m: 0, r: 0.9, d: 2 };
const PACK_ALLY: Mat = { c: 0x4d503b, m: 0, r: 0.88, d: 2 };
const BOOT: Mat = { c: 0x1f1c1a, m: 0.05, r: 0.62, d: 2 };
const GLOVE: Mat = { c: 0x2b2723, m: 0, r: 0.8, d: 2 };
const GUN_BLACK: Mat = { c: 0x1f2125, m: 0.5, r: 0.45, d: 0 };
const GUN_WOOD: Mat = { c: 0x7a4c2a, m: 0, r: 0.6, d: 2 };
/** Team-painted steel helmet. */
const HELMET: Mat = { c: 0xd2d2d2, m: 0.3, r: 0.48, t: 1, d: 0 };
/** Team jacket (fabric) and its darker shoulder / collar shade. */
const JACKET: Mat = M.teamCloth;
const JACKET_DARK: Mat = M.teamClothDark;

// Low-poly primitives shared by all soldiers.
const ARM_GEO = new THREE.CylinderGeometry(0.02, 0.017, 0.1, 4, 1, false);
ARM_GEO.translate(0, -0.05, 0);
ARM_GEO.rotateY(Math.PI / 4);
const HAND_GEO = new THREE.OctahedronGeometry(0.018, 0);
const LEG_GEO = new THREE.CylinderGeometry(0.026, 0.02, 0.12, 5, 1, false);
LEG_GEO.translate(0, -0.06, 0);
const HEAD_FAR = new THREE.SphereGeometry(0.04, 5, 3);
const HEAD_NEAR = new THREE.SphereGeometry(0.04, 7, 4);
const CHEST: [number, number][] = [
  [0.05, 0.028],
  [0.063, 0.086],
  [0.053, 0.122],
  [0.0, 0.13],
];

const FELT: Mat = { c: 0x2c2a28, m: 0, r: 0.85, d: 2 };
const KNIT: Mat = { c: 0x1e1f22, m: 0, r: 0.95, d: 2, uv: 6 };
const FUR_HAT: Mat = { c: 0x4a3a2a, m: 0, r: 0.95, d: 2, uv: 6 };
const CANOPY: Mat = { c: 0xd8d4c4, m: 0, r: 0.85, d: 2, uv: 4 };
const CANOPY_TEAM: Mat = { c: 0xe8e8e8, m: 0, r: 0.85, t: 0.85, d: 2, uv: 4 };
const CHUTE_H = 0.82;

/** Round parachute (canopy gores + suspension lines) hanging over the soldier; node 'chute' at the feet. */
function parachute(r: NB): void {
  const ch = r.node('chute');
  const prof: [number, number][] = [
    [0.3, 0.0],
    [0.255, 0.075],
    [0.14, 0.132],
    [0.0, 0.145],
  ];
  const gores = 8;
  for (let i = 0; i < gores; i++) {
    const g = lathe(prof, 2, (i / gores) * Math.PI * 2, (Math.PI * 2) / gores);
    ch.add(g, i % 2 ? CANOPY : CANOPY_TEAM, { p: [0, CHUTE_H - 0.07, 0] });
  }
  // vent + skirt hem
  ch.cyl(M.dark, 0.022, 0.022, 0.006, 0, CHUTE_H + 0.078, 0, { seg: 6, open: true });
  // suspension lines converge on two risers at the shoulders
  for (let i = 0; i < gores; i++) {
    const a = (i / gores) * Math.PI * 2 + Math.PI / gores;
    const side = Math.sin(a) >= 0 ? 1 : -1;
    const ax = Math.cos(a) * 0.29;
    const az = Math.sin(a) * 0.29;
    const bx = 0.0;
    const bz = 0.045 * side;
    const by = 0.34;
    const ay = CHUTE_H - 0.07;
    const len = Math.hypot(ax - bx, ay - by, az - bz);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(ax - bx, ay - by, az - bz).normalize());
    const e = new THREE.Euler().setFromQuaternion(q);
    ch.add(LINE_GEO, M.offwhite, { p: [(ax + bx) / 2, (ay + by) / 2, (az + bz) / 2], r: [e.x, e.y, e.z], s: [1, len, 1], lod: 0 });
  }
  // risers + harness straps
  for (const sd of [-1, 1]) ch.box(M.webbing, 0.008, 0.09, 0.008, 0.0, 0.3, 0.045 * sd, { b: 0 });
}

const LINE_GEO = new THREE.CylinderGeometry(0.0016, 0.0016, 1, 3, 1, true);

function arm(nb: NB, spec: SoldierSpec): void {
  // hangs down from the shoulder pivot (origin)
  nb.add(ARM_GEO, spec.bareArms ? M.skin : spec.uniform);
  const hand = spec.gloves ? GLOVE : M.skin;
  far(nb, () => nb.add(HAND_GEO, hand, { p: [0, -0.108, 0] }));
  near(nb, () => {
    nb.add(HAND_GEO, hand, { p: [0, -0.108, 0], s: [1, 1.1, 0.95] });
    // cuff (sleeve end) and an elbow crease
    if (!spec.bareArms) nb.cyl(spec.uniform, 0.0185, 0.0185, 0.012, 0, -0.094, 0, { seg: 5, open: true });
  });
}

function leg(nb: NB, trousers: Mat): void {
  nb.add(LEG_GEO, trousers);
  nb.box(BOOT, 0.06, 0.034, 0.042, 0.01, -0.13, 0, { b: 0 });
  near(nb, () => {
    // boot shaft, sole, knee pad / cargo pocket
    nb.cyl(BOOT, 0.021, 0.022, 0.03, 0, -0.106, 0, { seg: 5, open: true });
    pbox(nb, M.darker, 0.064, 0.008, 0.044, 0.011, -0.146, 0);
    pbox(nb, trousers, 0.012, 0.026, 0.03, 0.022, -0.055, 0);
  });
}

/** Faction steel helmet: Allied M1 (round dome, even brim) or Soviet SSh-40 (taller dome, flared skirt). */
function steelHelmet(t: NB, hy: number, fac: ModelFaction, mat: Mat = HELMET): void {
  const prof: [number, number][] =
    fac === 'soviet'
      ? [
          [0.0, 0.062],
          [0.04, 0.054],
          [0.055, 0.026],
          [0.058, -0.004],
          [0.063, -0.016],
        ]
      : [
          [0.0, 0.054],
          [0.042, 0.047],
          [0.056, 0.02],
          [0.058, 0.004],
          [0.068, -0.002],
        ];
  far(t, () => t.add(lathe(prof, 6), mat, { p: [0, hy + 0.012, 0], r: [0, Math.PI / 6, 0] }));
  near(t, () => {
    t.add(latheFine(prof, 9), mat, { p: [0, hy + 0.012, 0] });
    // chin strap and (Allied) the camouflage net band / (Soviet) a star badge
    pbox(t, M.darker, 0.004, 0.05, 0.088, 0.008, hy - 0.014, 0);
    if (fac === 'soviet') {
      pbox(t, M.red, 0.004, 0.012, 0.012, 0.058, hy + 0.03, 0);
    } else {
      t.cyl(WEB, 0.0565, 0.0565, 0.008, 0, hy + 0.026, 0, { seg: 9, open: true });
    }
  });
}

function headgear(t: NB, kind: Headgear, headY: number, fac: ModelFaction): void {
  const hy = headY;
  switch (kind) {
    case 'helmet':
      steelHelmet(t, hy, fac);
      break;
    case 'ushanka':
      // fur hat with the flaps tied up, team cockade
      t.add(lathe([[0.0, 0.05], [0.047, 0.042], [0.055, 0.006], [0.05, -0.006]], 7), FUR_HAT, { p: [0, hy + 0.012, 0] });
      for (const s of [-1, 1]) t.box(FUR_HAT, 0.04, 0.03, 0.012, -0.004, hy + 0.014, 0.052 * s, { b: 0 });
      near(t, () => pbox(t, M.team, 0.006, 0.016, 0.016, 0.054, hy + 0.04, 0));
      break;
    case 'hardhat':
      t.add(lathe([[0.0, 0.048], [0.042, 0.034], [0.048, 0.004], [0.064, -0.002]], 7), M.yellow, { p: [0, hy + 0.014, 0] });
      near(t, () => pbox(t, M.yellow, 0.07, 0.008, 0.012, 0.0, hy + 0.06, 0));
      break;
    case 'medic':
      t.add(lathe([[0.0, 0.054], [0.042, 0.047], [0.056, 0.02], [0.058, 0.004], [0.066, -0.002]], 7), M.white, { p: [0, hy + 0.012, 0] });
      t.box(M.red, 0.004, 0.022, 0.024, 0.055, hy + 0.034, 0, { b: 0 });
      t.box(M.red, 0.024, 0.004, 0.024, 0.0, hy + 0.067, 0, { b: 0 });
      near(t, () => {
        pbox(t, M.red, 0.004, 0.008, 0.024, 0.0555, hy + 0.034, 0);
        pbox(t, M.red, 0.024, 0.0045, 0.008, 0.0, hy + 0.067, 0);
      });
      break;
    case 'tanya':
      t.add(lathe([[0.0, 0.046], [0.036, 0.034], [0.045, 0.0]], 6), M.hair, { p: [-0.006, hy, 0] });
      t.add(new THREE.ConeGeometry(0.016, 0.08, 5), M.hair, { p: [-0.062, hy - 0.024, 0], r: [0, 0, -0.5] });
      near(t, () => pbox(t, M.red, 0.012, 0.012, 0.03, -0.042, hy + 0.01, 0));
      break;
    case 'fedora':
      // wide brim, pinched crown, team-coloured hat band
      t.add(new THREE.CylinderGeometry(0.068, 0.068, 0.006, 8), FELT, { p: [0, hy + 0.024, 0], r: [0, 0, 0.08] });
      t.add(lathe([[0.04, 0.0], [0.039, 0.03], [0.03, 0.045], [0.0, 0.04]], 8), FELT, { p: [0, hy + 0.026, 0] });
      t.cyl(M.team, 0.0405, 0.0405, 0.012, 0, hy + 0.033, 0, { seg: 8, open: true });
      break;
    case 'gasmask':
      // steel helmet, goggles and a respirator snout (shock troopers)
      t.add(lathe([[0.0, 0.056], [0.044, 0.04], [0.058, -0.006], [0.062, -0.014]], 7), HELMET, { p: [0, hy + 0.012, 0] });
      t.box(M.darker, 0.02, 0.03, 0.074, 0.03, hy + 0.0, 0, { b: 0 });
      for (const z of [-0.016, 0.016]) t.cyl(G.tesla, 0.011, 0.011, 0.008, 0.041, hy + 0.008, z, { r: [0, 0, Math.PI / 2], seg: 6 });
      t.cyl(M.dark, 0.013, 0.017, 0.03, 0.05, hy - 0.022, 0, { r: [0, 0, Math.PI / 2 + 0.4], seg: 6 });
      near(t, () => {
        for (const s of [-1, 1]) t.cyl(M.dark, 0.009, 0.009, 0.012, 0.042, hy - 0.026, 0.02 * s, { r: [0.6 * s, 0, Math.PI / 2], seg: 5 });
      });
      break;
    case 'cap':
      // field cap with a stiff peak and goggles pushed up
      t.add(lathe([[0.0, 0.04], [0.038, 0.036], [0.046, 0.004]], 7), M.teamClothDark, { p: [0, hy + 0.016, 0] });
      t.box(M.teamClothDark, 0.042, 0.005, 0.072, 0.046, hy + 0.02, 0, { b: 0, r: [0, 0, -0.15] });
      t.box(M.dark, 0.012, 0.01, 0.07, 0.025, hy + 0.045, 0, { b: 0 });
      near(t, () => {
        for (const z of [-0.016, 0.016]) t.cyl(M.glassBlue, 0.009, 0.009, 0.008, 0.03, hy + 0.047, z, { r: [0, 0, Math.PI / 2], seg: 6 });
      });
      break;
    case 'beanie':
      t.add(lathe([[0.0, 0.05], [0.032, 0.042], [0.045, 0.012], [0.046, -0.004]], 6), KNIT, { p: [-0.003, hy + 0.008, 0] });
      t.cyl(KNIT, 0.047, 0.047, 0.012, -0.003, hy + 0.006, 0, { seg: 6 });
      break;
  }
}

function soldier(spec: SoldierSpec, fac: ModelFaction = 'allies'): ModelTemplate {
  const r = new NB('root');
  const body = r.node('body');
  const torso = body.node('torso', [0, HIP_Y, 0]);
  // pelvis + belt with buckle
  torso.box(spec.trousers, 0.07, 0.044, 0.1, 0, 0.0, 0, { b: 0 });
  torso.box(WEB, 0.074, 0.016, 0.104, 0, 0.024, 0, { b: 0 });
  near(torso, () => pbox(torso, M.brass, 0.004, 0.012, 0.016, 0.038, 0.024, 0));
  // chest (6-sided, barrel shaped), collar and shoulder yoke
  far(torso, () => torso.add(lathe(CHEST, 6), spec.uniform, { s: [0.8, 1, 1.1], r: [0, Math.PI / 6, 0] }));
  near(torso, () => {
    torso.add(latheFine(CHEST, 8), spec.uniform, { s: [0.8, 1, 1.1], r: [0, Math.PI / 8, 0] });
    torso.cyl(spec.shoulders ?? JACKET_DARK, 0.024, 0.03, 0.016, 0.0, 0.132, 0, { seg: 6, open: true });
  });
  // shoulder pads (team), visible from above
  for (const s of [-1, 1]) torso.box(spec.shoulders ?? spec.uniform, 0.05, 0.016, 0.03, -0.002, 0.118, 0.056 * s, { b: 0, r: [s * 0.3, 0, 0] });
  // head
  const headY = 0.163;
  far(torso, () => torso.add(HEAD_FAR, M.skin, { p: [0.003, headY, 0], s: [0.95, 1.05, 0.95] }));
  near(torso, () => {
    torso.add(HEAD_NEAR, M.skin, { p: [0.003, headY, 0], s: [0.95, 1.05, 0.95] });
    pbox(torso, M.darker, 0.004, 0.006, 0.03, 0.04, headY + 0.006, 0);
    torso.cyl(M.skin, 0.016, 0.018, 0.02, 0.0, 0.136, 0, { seg: 5, open: true });
  });
  headgear(torso, spec.headgear, headY, fac);
  const armL = torso.node('armL', [0, SHOULDER_Y, -SHOULDER_Z], [spec.armL[1], 0, spec.armL[0]]);
  const armR = torso.node('armR', [0, SHOULDER_Y, SHOULDER_Z], [spec.armR[1], 0, spec.armR[0]]);
  arm(armL, spec);
  arm(armR, spec);
  if (spec.armband) armL.cyl(spec.armband, 0.021, 0.02, 0.018, 0, -0.03, 0, { seg: 5, open: true });
  const legL = body.node('legL', [0, HIP_Y, -LEG_Z]);
  const legR = body.node('legR', [0, HIP_Y, LEG_Z]);
  leg(legL, spec.trousers);
  leg(legR, spec.trousers);
  if (spec.coat) {
    // trench coat skirt to the knees, belt and lapels
    torso.add(lathe([[0.056, 0.03], [0.06, -0.02], [0.07, -0.085]], 6), spec.coat, { s: [0.85, 1, 1.08], r: [0, Math.PI / 6, 0] });
    torso.box(spec.coat, 0.072, 0.012, 0.104, 0, 0.032, 0, { b: 0 });
    torso.box(M.boot, 0.004, 0.05, 0.03, 0.05, 0.1, 0, { b: 0, r: [0, 0, 0.12] });
  }
  spec.build?.(torso, armL, armR);
  torso.node('m0', [0.2, 0.06, 0.03]);
  // only paratroopers (rifle infantry) carry the hidden parachute rig: ~180 triangles saved elsewhere
  if (spec.chute) parachute(r);

  const fire = spec.fire ?? 'rifle';
  return makeTemplate({
    root: r,
    height: 0.38,
    radius: 0.16,
    muzzles: ['m0'],
    glow: { glow: 3 },
    init: (c) => c.show('chute', false),
    anim: (c, s) => animSoldier(c, s, spec, fire),
  });
}

function easeOut(t: number) {
  return 1 - (1 - t) * (1 - t);
}

function animSoldier(c: Ctx, s: ModelAnimState, spec: SoldierSpec, fire: NonNullable<SoldierSpec['fire']>): void {
  const body = c.n.body;
  const torso = c.n.torso;
  const armL = c.n.armL;
  const armR = c.n.armR;
  const legL = c.n.legL;
  const legR = c.n.legR;
  const t = s.time;

  if (s.dying > 0) {
    deathPose(c, s, body);
    return;
  }
  if (c.variant !== BodyVariant.Normal) {
    c.setVariant(BodyVariant.Normal);
    body.rotation.set(0, 0, 0);
    body.position.set(0, 0, 0);
    body.scale.set(1, 1, 1);
  }

  if (paraPose(c, s)) return;

  // walk cycle: legs swing, the stepping leg lifts, hips sway and the shoulders counter-rotate
  const dt = dtOf(s);
  if (c.v.seed === undefined) c.v.seed = Math.random() * 10;
  const walkAmt = (c.v.walk = (c.v.walk ?? 0) + ((s.moving ? 1 : 0) - (c.v.walk ?? 0)) * Math.min(1, dt * 10));
  c.v.ph = (c.v.ph ?? 0) + dt * (7 + 4 * s.speed) * (s.moving ? 1 : 0);
  const ph = c.v.ph;
  const swing = Math.sin(ph) * 0.65 * walkAmt;
  legL.rotation.z = swing;
  legR.rotation.z = -swing;
  legL.position.y = HIP_Y + Math.max(0, Math.sin(ph)) * 0.01 * walkAmt;
  legR.position.y = HIP_Y + Math.max(0, -Math.sin(ph)) * 0.01 * walkAmt;
  const breathe = Math.sin(t * 2.4 + c.v.seed) * 0.004;
  torso.position.y = HIP_Y + Math.abs(Math.cos(ph)) * 0.012 * walkAmt + breathe;
  torso.position.z = Math.sin(ph) * 0.006 * walkAmt;
  torso.rotation.z = -0.1 * walkAmt; // lean forward
  torso.rotation.x = Math.sin(ph) * 0.05 * walkAmt;
  torso.position.x = 0;
  // idle fidgets: look around, shift weight, check the weapon (per-soldier timing)
  let look = 0;
  let shift = 0;
  let check = 0;
  if (!s.moving && s.firing <= 0) {
    const tt = t + c.v.seed * 3.7;
    const cyc = 5 + (c.v.seed % 3);
    const k = tt % cyc;
    const which = Math.floor(tt / cyc + c.v.seed) % 3;
    const env = k < 1.6 ? Math.sin((k / 1.6) * Math.PI) : 0;
    if (which === 0) look = env * (Math.sin(Math.floor(tt / cyc) * 2.3) > 0 ? 0.45 : -0.45);
    else if (which === 1) shift = env;
    else check = env;
  }
  torso.rotation.y = look * (1 - walkAmt);
  torso.rotation.x += shift * 0.06;
  torso.position.z += shift * 0.006;

  // arms rest pose
  let lz = spec.armL[0];
  let rz = spec.armR[0];
  let lx = spec.armL[1];
  let rx = spec.armR[1];
  if (spec.swingArms) {
    lz += -swing * 0.8;
    rz += swing * 0.8;
  } else {
    lz += Math.sin(ph) * 0.06 * walkAmt;
    rz += Math.sin(ph) * 0.06 * walkAmt;
  }
  // checking the weapon: hands come up a little
  lz += check * 0.25;
  rz += check * 0.18;
  const f = s.firing;
  if (f > 0) {
    switch (fire) {
      case 'rifle':
      case 'flame':
        // recoil: the shoulder takes the kick, the muzzle climbs
        torso.position.x = -0.016 * f;
        torso.rotation.z += 0.1 * f;
        lz += 0.18 * f;
        rz += 0.12 * f;
        break;
      case 'wrench': {
        // hammering away at the vehicle
        const k = 1 - f;
        rz = 0.6 + Math.sin(k * Math.PI) * 1.5;
        rx = 0.1;
        torso.rotation.z += 0.12 * Math.sin(k * Math.PI);
        break;
      }
      case 'rocket':
        torso.position.x = -0.02 * f;
        torso.rotation.z += 0.12 * f;
        break;
      case 'throw': {
        // wind-up behind the head then release forward as f decays 1 -> 0
        const k = 1 - f;
        rz = -2.6 + easeOut(k) * 3.6;
        rx = 0.15;
        torso.rotation.z += -0.25 + k * 0.4;
        break;
      }
      case 'pistols':
        lz = 1.45 + 0.25 * f;
        rz = 1.45 + 0.25 * f;
        lx = 0.12;
        rx = -0.12;
        if (s.firingMuzzle % 2 === 0) rz += 0.3 * f;
        else lz += 0.3 * f;
        break;
      case 'heal':
        lz = 1.1;
        rz = 1.1;
        break;
    }
  } else if (fire === 'pistols' && !s.moving) {
    // ready stance
    lz = 1.2;
    rz = 1.2;
    lx = 0.12;
    rx = -0.12;
  }
  armL.rotation.set(lx, 0, lz);
  armR.rotation.set(rx, 0, rz);
  const flame = c.glows.get('glow:pilot');
  if (flame) c.setGlow('glow:pilot', 0.6 + f * 1.4);
  // shock trooper: the backpack coil hums and flares when firing
  if (c.glows.has('glow:pack')) c.setGlow('glow:pack', (0.55 + 0.25 * Math.sin(t * 9 + c.v.seed) * Math.sin(t * 5.3)) + f * 1.6);
}

/**
 * Parachute: canopy shown while anim.parachute > 0. 1 = open, descending (arms up on the risers,
 * legs dangling, the whole rig swinging under the canopy); below ~0.4 the canopy deflates and
 * topples behind the soldier as it reaches 0 (landed). Returns true while the descent pose owns
 * the skeleton.
 */
function paraPose(c: Ctx, s: ModelAnimState): boolean {
  const ch = c.n.chute;
  if (!ch) return false;
  // eased internally: opens fast, deflates over ~1.5 s after landing (the engine may feed raw 0/1)
  const target = Math.min(1, Math.max(0, s.parachute ?? 0));
  // landing: drop straight into the deflating phase (p < 0.4), which then takes ~1.2 s
  const cur = target < 0.4 ? Math.min(c.v.pe ?? 0, 0.4) : c.v.pe ?? 0;
  const p = (c.v.pe = target > cur ? approach(cur, target, 9, dtOf(s)) : Math.max(target, cur - dtOf(s) * 0.33));
  if (p <= 0.005) {
    if (c.v.para) {
      c.v.para = 0;
      c.show('chute', false);
      ch.rotation.set(0, 0, 0);
      ch.position.set(0, 0, 0);
      c.n.body.rotation.set(0, 0, 0);
      c.n.body.position.set(0, 0, 0);
    }
    return false;
  }
  if (!c.v.para) {
    c.v.para = 1;
    c.show('chute', true);
  }
  const t = s.time + (c.v.seed ?? (c.v.seed = Math.random() * 10));
  const open = p >= 0.4 ? 1 : p / 0.4;
  const body = c.n.body;
  if (p >= 0.4) {
    // pendulum swing about the canopy
    const a = Math.sin(t * 1.6) * 0.09;
    const b = Math.sin(t * 1.1 + 1) * 0.05;
    const h = CHUTE_H;
    body.rotation.set(a, 0, b);
    body.position.set(-h * Math.sin(b) * 0, h * (1 - Math.cos(a)), -h * Math.sin(a));
    ch.rotation.set(a, 0, b);
    ch.position.copy(body.position);
    // breathing canopy
    ch.scale.set(1 + Math.sin(t * 2.3) * 0.03, 1 - Math.sin(t * 2.3) * 0.04, 1 + Math.sin(t * 2.3) * 0.03);
    c.n.armL.rotation.set(0.3, 0, 2.75);
    c.n.armR.rotation.set(-0.3, 0, 2.75);
    c.n.legL.rotation.z = 0.18 + Math.sin(t * 2.1) * 0.08;
    c.n.legR.rotation.z = 0.05 - Math.sin(t * 2.1) * 0.08;
    c.n.torso.rotation.set(0, 0, 0);
    c.n.torso.position.set(0, HIP_Y, 0);
    return true;
  }
  // landed: canopy deflates and folds down behind the soldier
  const k = 1 - open;
  ch.position.set(-0.05 * k, 0, 0);
  ch.rotation.set(0, 0, k * 1.45);
  ch.scale.set(1 - 0.25 * k, Math.max(0.15, 1 - 0.8 * k), 1 + 0.15 * k);
  body.rotation.set(0, 0, 0);
  body.position.set(0, 0, 0);
  return false;
}

function deathPose(c: Ctx, s: ModelAnimState, body: THREE.Object3D): void {
  const d = Math.min(1, s.dying);
  const kind = s.deathKind ?? 'normal';
  const fall = easeOut(Math.min(1, d * 1.6));
  const sink = Math.max(0, d - 0.7) / 0.3;
  body.rotation.set(0, 0, 0);
  body.scale.set(1, 1, 1);
  body.position.set(0, 0, 0);
  c.n.legL.rotation.z = 0.25 * fall;
  c.n.legR.rotation.z = -0.15 * fall;
  switch (kind) {
    case 'burn': {
      c.setVariant(d > 0.15 ? BodyVariant.Charred : BodyVariant.Damaged);
      body.rotation.z = -fall * 1.45; // collapse forward
      body.scale.set(1, 1 - 0.25 * fall, 1);
      body.position.y = Math.sin(fall * 1.45) * 0.035;
      c.n.armL.rotation.z = 2.4 * fall;
      c.n.armR.rotation.z = 2.2 * fall;
      break;
    }
    case 'electro': {
      const flash = d < 0.55 && Math.floor(s.time * 22) % 2 === 0;
      c.setVariant(flash ? BodyVariant.Electro : d < 0.55 ? BodyVariant.Damaged : BodyVariant.Charred);
      const jit = d < 0.55 ? Math.sin(s.time * 80) * 0.08 : 0;
      body.rotation.z = Math.max(0, d - 0.45) / 0.55 * 1.5 + jit;
      body.position.y = Math.sin(body.rotation.z) * 0.035;
      c.n.armL.rotation.z = 2.8 * (1 - fall * 0.5);
      c.n.armR.rotation.z = 2.8 * (1 - fall * 0.5);
      break;
    }
    case 'blown': {
      c.setVariant(BodyVariant.Damaged);
      const air = Math.sin(Math.min(1, d * 1.4) * Math.PI);
      body.position.y = air * 0.16 + Math.sin(fall * 1.5) * 0.035;
      body.position.x = -0.12 * fall;
      body.rotation.z = fall * (1.5 + Math.PI * 2 * 0.0) + air * 0.8;
      c.n.armL.rotation.z = -2.2 * fall;
      c.n.armR.rotation.z = 2.4 * fall;
      break;
    }
    case 'bite': {
      body.rotation.x = fall * 1.45;
      body.position.y = Math.sin(fall * 1.45) * 0.035;
      c.n.armR.rotation.z = 1.6 * fall;
      break;
    }
    case 'crushed': {
      c.setVariant(BodyVariant.Damaged);
      body.scale.set(1 + 0.3 * fall, Math.max(0.12, 1 - fall), 1 + 0.3 * fall);
      break;
    }
    default: {
      body.rotation.z = fall * 1.5; // fall backward
      body.position.y = Math.sin(fall * 1.5) * 0.035;
      c.n.armL.rotation.z = -1.0 * fall;
      c.n.armR.rotation.z = 2.6 * fall;
    }
  }
  body.position.y -= sink * 0.04;
}

// ---------------------------------------------------------------------------------------------
// Weapons and kit
// ---------------------------------------------------------------------------------------------

const ROTX: [number, number, number] = [0, 0, -Math.PI / 2];

/** Soviet AK: wooden stock and handguard, curved magazine. Held across the chest, pointing +X. */
function ak(t: NB, z = 0.035, y = 0.075): void {
  far(t, () => {
    pbox(t, GUN_WOOD, 0.08, 0.022, 0.014, -0.004, y - 0.006, z);
    pbox(t, GUN_BLACK, 0.17, 0.016, 0.012, 0.115, y + 0.002, z);
    pbox(t, GUN_BLACK, 0.016, 0.036, 0.01, 0.076, y - 0.024, z, [0, 0, 0.4]);
  });
  near(t, () => {
    pbox(t, GUN_WOOD, 0.072, 0.022, 0.013, -0.006, y - 0.008, z, [0, 0, 0.12]);
    pbox(t, GUN_BLACK, 0.07, 0.02, 0.014, 0.064, y, z);
    pbox(t, GUN_WOOD, 0.042, 0.017, 0.016, 0.118, y + 0.001, z);
    t.cyl(GUN_BLACK, 0.0045, 0.0045, 0.075, 0.172, y + 0.004, z, { r: ROTX, seg: 5, open: true });
    pbox(t, GUN_BLACK, 0.004, 0.012, 0.004, 0.198, y + 0.012, z);
    pbox(t, GUN_BLACK, 0.016, 0.022, 0.01, 0.078, y - 0.018, z, [0, 0, 0.22]);
    pbox(t, GUN_BLACK, 0.015, 0.02, 0.0095, 0.086, y - 0.035, z, [0, 0, 0.55]);
    pbox(t, GUN_WOOD, 0.01, 0.022, 0.009, 0.038, y - 0.016, z, [0, 0, 0.35]);
  });
}

/** Allied M16: black with a carry handle and a straight magazine. */
function m16(t: NB, z = 0.035, y = 0.075): void {
  far(t, () => {
    pbox(t, GUN_BLACK, 0.08, 0.022, 0.014, -0.004, y - 0.004, z);
    pbox(t, GUN_BLACK, 0.17, 0.016, 0.012, 0.115, y + 0.003, z);
    pbox(t, GUN_BLACK, 0.014, 0.034, 0.01, 0.07, y - 0.024, z, [0, 0, 0.12]);
  });
  near(t, () => {
    pbox(t, GUN_BLACK, 0.07, 0.024, 0.013, -0.008, y - 0.004, z);
    pbox(t, GUN_BLACK, 0.07, 0.022, 0.014, 0.062, y + 0.001, z);
    pbox(t, GUN_BLACK, 0.05, 0.008, 0.006, 0.06, y + 0.018, z);
    pbox(t, M.gun, 0.048, 0.019, 0.017, 0.12, y + 0.002, z);
    t.cyl(GUN_BLACK, 0.004, 0.004, 0.07, 0.178, y + 0.003, z, { r: ROTX, seg: 5, open: true });
    pbox(t, GUN_BLACK, 0.004, 0.018, 0.004, 0.142, y + 0.016, z);
    pbox(t, GUN_BLACK, 0.014, 0.036, 0.01, 0.072, y - 0.024, z, [0, 0, 0.12]);
    pbox(t, GUN_BLACK, 0.01, 0.022, 0.009, 0.036, y - 0.016, z, [0, 0, 0.35]);
  });
}

function rifleFor(fac: ModelFaction): (t: NB) => void {
  return fac === 'soviet' ? (t) => ak(t) : (t) => m16(t);
}

/** Allied load-bearing kit: vest, ALICE pack with a bedroll, canteen and pouches. */
function alliedKit(t: NB, pack = true): void {
  t.box(VEST, 0.026, 0.062, 0.104, 0.034, 0.078, 0, { b: 0 });
  t.box(VEST, 0.024, 0.06, 0.1, -0.036, 0.078, 0, { b: 0 });
  if (pack) t.box(PACK_ALLY, 0.04, 0.066, 0.08, -0.07, 0.082, 0, { b: 0 });
  near(t, () => {
    for (const z of [-0.03, 0.0, 0.03]) pbox(t, WEB, 0.012, 0.022, 0.024, 0.05, 0.07, z);
    t.cyl(WEB, 0.012, 0.012, 0.03, -0.02, 0.012, 0.055, { seg: 5 });
    if (pack) {
      pbox(t, PACK_ALLY, 0.044, 0.014, 0.084, -0.07, 0.118, 0);
      t.cyl(M.canvas, 0.014, 0.014, 0.09, -0.068, 0.134, 0, { r: [Math.PI / 2, 0, 0], seg: 5 });
      for (const s of [-1, 1]) pbox(t, WEB, 0.016, 0.03, 0.012, -0.07, 0.07, 0.046 * s);
    }
  });
}

/** Soviet kit: magazine chest rig, canvas sack (veshmeshok), entrenching spade on the hip. */
function sovietKit(t: NB, pack = true): void {
  t.box(WEB, 0.022, 0.042, 0.092, 0.045, 0.068, 0, { b: 0 });
  if (pack) {
    far(t, () => t.sph(PACK_SOV, 0.045, -0.07, 0.078, 0, { seg: 4, s: [0.72, 1.05, 1] }));
    near(t, () => t.sph(PACK_SOV, 0.045, -0.07, 0.078, 0, { seg: 6, s: [0.72, 1.05, 1] }));
  }
  near(t, () => {
    for (const z of [-0.026, 0.0, 0.026]) pbox(t, WEB, 0.01, 0.026, 0.022, 0.058, 0.066, z);
    for (const s of [-1, 1]) pbox(t, WEB, 0.008, 0.07, 0.012, 0.0, 0.09, 0.04 * s, [s * 0.22, 0, 0]);
    pbox(t, GUN_WOOD, 0.008, 0.05, 0.006, -0.03, 0.0, -0.055, [0.1, 0, 0.3]);
    pbox(t, M.gun, 0.022, 0.024, 0.004, -0.04, -0.025, -0.057, [0.1, 0, 0.3]);
    t.cyl(M.oliveDark, 0.012, 0.012, 0.028, -0.02, 0.012, 0.055, { seg: 5 });
  });
}

function kitFor(fac: ModelFaction): (t: NB, pack?: boolean) => void {
  return fac === 'soviet' ? sovietKit : alliedKit;
}

const trousersFor = (fac: ModelFaction): Mat => (fac === 'soviet' ? SOV_TROUSERS : ALLY_TROUSERS);

const E1 = (fac: ModelFaction): SoldierSpec => ({
  uniform: JACKET,
  chute: true,
  trousers: trousersFor(fac),
  headgear: 'helmet',
  gloves: true,
  swingArms: false,
  armL: [1.25, -0.55],
  armR: [0.75, 0.15],
  fire: 'rifle',
  build: (t) => {
    rifleFor(fac)(t);
    kitFor(fac)(t);
  },
});

const E2 = (fac: ModelFaction): SoldierSpec => ({
  uniform: JACKET,
  trousers: trousersFor(fac),
  headgear: 'ushanka',
  gloves: true,
  swingArms: true,
  armL: [0.15, -0.1],
  armR: [0.25, 0.1],
  fire: 'throw',
  build: (t, _l, armR) => {
    // grenade bandolier across the chest, grenade satchel on the hip, a grenade in hand
    t.box(WEB, 0.08, 0.018, 0.116, 0, 0.075, 0, { b: 0, r: [0.5, 0, 0] });
    for (const z of [-0.035, 0, 0.035]) t.sph(M.oliveDark, 0.014, 0.047, 0.04 + z * 0.25, z, { seg: 5 });
    t.box(PACK_SOV, 0.05, 0.05, 0.03, -0.01, 0.0, 0.062, { b: 0 });
    near(t, () => {
      pbox(t, WEB, 0.052, 0.012, 0.032, -0.01, 0.022, 0.062);
      for (const z of [-0.035, 0, 0.035]) pbox(t, M.gun, 0.006, 0.01, 0.006, 0.056, 0.054 + z * 0.25, z);
    });
    t.sph(M.canvas, 0.04, -0.066, 0.08, 0, { seg: 4, s: [0.75, 1.05, 1] });
    armR.sph(M.oliveDark, 0.018, 0.008, -0.126, 0, { seg: 5 });
    near(armR, () => pbox(armR, M.gun, 0.006, 0.012, 0.006, 0.008, -0.1, 0));
  },
});

const E3 = (fac: ModelFaction): SoldierSpec => ({
  uniform: JACKET,
  trousers: trousersFor(fac),
  headgear: 'helmet',
  gloves: true,
  swingArms: false,
  armL: [1.3, -0.35],
  armR: [1.55, -0.6],
  fire: 'rocket',
  build: (t) => {
    const y = 0.135;
    const z = 0.062;
    if (fac === 'soviet') {
      // RPG-7: slim tube, flared venturi, big warhead
      t.cyl(M.olive, 0.016, 0.016, 0.24, 0.03, y, z, { r: ROTX, seg: 7 });
      t.cyl(M.oliveDark, 0.015, 0.028, 0.05, -0.1, y, z, { r: ROTX, seg: 7, open: true });
      t.add(new THREE.ConeGeometry(0.03, 0.07, 7), M.oliveDark, { p: [0.2, y, z], r: [0, 0, -Math.PI / 2] });
      t.cyl(M.oliveDark, 0.03, 0.022, 0.03, 0.155, y, z, { r: ROTX, seg: 7 });
      near(t, () => {
        pbox(t, GUN_WOOD, 0.04, 0.02, 0.022, 0.0, y, z);
        pbox(t, GUN_BLACK, 0.012, 0.03, 0.01, 0.03, y - 0.026, z, [0, 0, 0.3]);
        pbox(t, GUN_BLACK, 0.02, 0.016, 0.008, 0.03, y + 0.024, z - 0.012);
      });
      // spare rockets in the back sack
      t.sph(PACK_SOV, 0.044, -0.07, 0.078, 0, { seg: 4, s: [0.72, 1.05, 1] });
      for (const dz of [-0.02, 0.02]) t.add(new THREE.ConeGeometry(0.02, 0.05, 5), M.oliveDark, { p: [-0.07, 0.15, dz], r: [0, 0, 0.15] });
      t.box(WEB, 0.022, 0.042, 0.092, 0.045, 0.068, 0, { b: 0 });
    } else {
      // Dragon-style launcher: fat tube with shock-absorber end caps and a tracker sight
      t.cyl(M.olive, 0.022, 0.022, 0.27, 0.03, y, z, { r: ROTX, seg: 8 });
      for (const x of [0.155, -0.095]) t.cyl(M.oliveDark, 0.027, 0.027, 0.032, x, y, z, { r: ROTX, seg: 8 });
      t.add(new THREE.ConeGeometry(0.019, 0.04, 6), M.red, { p: [0.19, y, z], r: [0, 0, -Math.PI / 2] });
      t.box(M.dark, 0.05, 0.026, 0.02, 0.03, y + 0.03, z - 0.016, { b: 0 });
      near(t, () => {
        pbox(t, P_LENS, 0.004, 0.014, 0.014, 0.056, y + 0.03, z - 0.016);
        pbox(t, GUN_BLACK, 0.012, 0.035, 0.012, 0.04, y - 0.03, z);
        pbox(t, GUN_BLACK, 0.008, 0.03, 0.008, -0.03, y - 0.026, z, [0, 0, -0.3]);
      });
      alliedKit(t);
    }
  },
});

const P_LENS: Mat = { c: 0x9fb8c8, m: 0.6, r: 0.08, d: 3 };

const E4 = (fac: ModelFaction): SoldierSpec => ({
  uniform: JACKET,
  trousers: trousersFor(fac),
  headgear: 'gasmask',
  gloves: true,
  swingArms: false,
  armL: [0.95, -0.45],
  armR: [0.55, 0.12],
  fire: 'flame',
  build: (t) => {
    // fireproof apron, twin fuel tanks and a pressure bottle on the back
    t.box(M.khaki, 0.026, 0.07, 0.096, 0.036, 0.062, 0, { b: 0 });
    for (const z of [-0.027, 0.027]) t.cyl(M.red, 0.023, 0.025, 0.125, -0.068, 0.072, z, { seg: 7 });
    t.cyl(M.steel, 0.013, 0.013, 0.1, -0.09, 0.07, 0, { seg: 6 });
    near(t, () => {
      for (const z of [-0.027, 0.027]) {
        t.cyl(M.dark, 0.01, 0.012, 0.012, -0.068, 0.14, z, { seg: 5 });
        t.cyl(M.dark, 0.0255, 0.0255, 0.008, -0.068, 0.1, z, { seg: 7, open: true });
      }
      pbox(t, M.yellow, 0.004, 0.02, 0.072, -0.093, 0.072, 0);
      t.cyl(M.steel, 0.008, 0.008, 0.06, -0.068, 0.132, 0, { r: [Math.PI / 2, 0, 0], seg: 5 });
    });
    // hose + wand with the igniter and pilot flame
    t.cyl(M.dark, 0.006, 0.006, 0.12, -0.02, 0.03, 0.045, { r: [0, 0, -1.2], seg: 5 });
    t.box(M.gun, 0.15, 0.018, 0.018, 0.09, 0.05, 0.035, { b: 0 });
    t.cyl(M.dark, 0.013, 0.009, 0.034, 0.175, 0.05, 0.035, { r: ROTX, seg: 7 });
    near(t, () => {
      pbox(t, GUN_BLACK, 0.012, 0.03, 0.01, 0.05, 0.03, 0.035, [0, 0, 0.3]);
      pbox(t, GUN_BLACK, 0.012, 0.03, 0.01, 0.12, 0.03, 0.035, [0, 0, 0.2]);
    });
    t.sph(G.fire, 0.008, 0.195, 0.05, 0.035, { seg: 6, slot: 'glow:pilot' });
  },
});

const E6 = (fac: ModelFaction): SoldierSpec => ({
  uniform: JACKET,
  trousers: fac === 'soviet' ? SOV_TROUSERS : shade(M.khaki, 0x6a6048),
  headgear: 'hardhat',
  gloves: true,
  swingArms: true,
  armL: [0.08, -0.12],
  armR: [0.15, 0.1],
  fire: 'none',
  build: (t, armL) => {
    // hi-vis vest bands, tool belt, toolbox in the left hand, wrench + coiled cable on the back
    t.box(M.yellow, 0.086, 0.009, 0.116, 0, 0.07, 0, { b: 0 });
    t.box(M.yellow, 0.086, 0.009, 0.12, 0, 0.1, 0, { b: 0 });
    t.box(M.wood, 0.03, 0.026, 0.024, 0.03, 0.01, 0.054, { b: 0 });
    armL.box(M.red, 0.075, 0.042, 0.032, 0.0, -0.142, 0, { b: 0 });
    near(armL, () => {
      pbox(armL, M.dark, 0.036, 0.006, 0.006, 0.0, -0.118, 0);
      pbox(armL, M.darker, 0.076, 0.004, 0.033, 0.0, -0.132, 0);
    });
    t.box(PACK_ALLY, 0.036, 0.06, 0.07, -0.066, 0.08, 0, { b: 0 });
    near(t, () => {
      pbox(t, M.steel, 0.012, 0.09, 0.008, -0.088, 0.09, -0.02, [0.4, 0, 0]);
      t.cyl(M.dark, 0.03, 0.03, 0.012, -0.088, 0.08, 0.02, { r: [0, 0, Math.PI / 2], seg: 7, open: true });
      for (const z of [-0.03, 0.03]) pbox(t, M.gun, 0.01, 0.03, 0.008, 0.032, -0.005, z);
    });
  },
});

const MEDI = (): SoldierSpec => ({
  uniform: JACKET,
  trousers: ALLY_TROUSERS,
  headgear: 'medic',
  gloves: true,
  swingArms: true,
  armL: [0.1, -0.12],
  armR: [0.12, 0.1],
  fire: 'heal',
  armband: M.white,
  build: (t, armL, armR) => {
    // white tabard with red crosses front and back
    t.box(M.white, 0.024, 0.07, 0.096, 0.036, 0.074, 0, { b: 0 });
    t.box(M.white, 0.022, 0.07, 0.096, -0.036, 0.074, 0, { b: 0 });
    for (const x of [0.049, -0.048]) {
      t.box(M.red, 0.004, 0.036, 0.012, x, 0.08, 0, { b: 0 });
      t.box(M.red, 0.004, 0.012, 0.036, x, 0.08, 0, { b: 0 });
    }
    // red-cross armband, medkit bag, pack
    near(armL, () => pbox(armL, M.red, 0.006, 0.008, 0.014, 0.021, -0.03, 0));
    armL.box(M.white, 0.064, 0.048, 0.032, 0.0, -0.142, 0, { b: 0 });
    armL.box(M.red, 0.004, 0.028, 0.008, 0.0, -0.142, 0.017, { b: 0 });
    armL.box(M.red, 0.028, 0.008, 0.004, 0.0, -0.142, 0.017, { b: 0 });
    near(armR, () => pbox(armR, M.steel, 0.006, 0.03, 0.006, 0.01, -0.12, 0));
    t.box(PACK_ALLY, 0.036, 0.06, 0.07, -0.066, 0.08, 0, { b: 0 });
  },
});

const E7 = (): SoldierSpec => ({
  uniform: M.teamLight,
  trousers: shade(M.khaki, 0x7a6a4c),
  headgear: 'tanya',
  swingArms: true,
  bareArms: true,
  armL: [0.12, -0.12],
  armR: [0.12, 0.12],
  fire: 'pistols',
  build: (t, armL, armR) => {
    // crossed bandoliers, thigh holsters, C4 pack
    t.box(M.webbing, 0.086, 0.012, 0.13, 0, 0.075, 0, { b: 0, r: [0.6, 0, 0] });
    t.box(M.webbing, 0.086, 0.012, 0.13, 0, 0.075, 0, { b: 0, r: [-0.6, 0, 0] });
    t.box(M.boot, 0.03, 0.035, 0.015, 0.0, -0.01, 0.058, { b: 0 });
    t.box(M.boot, 0.03, 0.035, 0.015, 0.0, -0.01, -0.058, { b: 0 });
    t.box(M.dark, 0.03, 0.05, 0.07, -0.058, 0.08, 0, { b: 0 });
    near(t, () => {
      pbox(t, M.red, 0.004, 0.016, 0.03, -0.074, 0.088, 0);
      for (const z of [-0.02, 0.02]) pbox(t, M.brass, 0.008, 0.008, 0.006, 0.05, 0.075, z);
    });
    // pistols in both hands (pointing along arm -> forward when raised)
    for (const a of [armL, armR]) {
      a.box(M.dark, 0.016, 0.052, 0.012, 0.004, -0.142, 0, { b: 0 });
      a.box(M.dark, 0.022, 0.014, 0.012, 0.016, -0.12, 0, { b: 0 });
    }
  },
});

const SPY_CLOTH: Mat = { c: 0x8a8068, m: 0, r: 0.82, d: 2 };

const SPY = (): SoldierSpec => ({
  uniform: SPY_CLOTH,
  trousers: { c: 0x3a3a3e, m: 0, r: 0.85, d: 2 },
  coat: SPY_CLOTH,
  headgear: 'fedora',
  gloves: true,
  swingArms: true,
  armL: [0.06, -0.12],
  armR: [0.1, 0.1],
  fire: 'none',
  build: (t, armL, armR) => {
    // turned-up collar, tie, briefcase, sunglasses
    t.box(SPY_CLOTH, 0.03, 0.03, 0.11, -0.02, 0.128, 0, { b: 0, r: [0, 0, 0.3] });
    t.box(M.team, 0.004, 0.05, 0.012, 0.049, 0.1, 0, { b: 0 });
    t.box(M.black, 0.006, 0.008, 0.05, 0.04, 0.17, 0, { b: 0 });
    armL.box(M.black, 0.08, 0.055, 0.022, 0.0, -0.15, 0, { b: 0.004 });
    armL.box(M.brass, 0.012, 0.006, 0.024, 0.0, -0.12, 0, { b: 0 });
    armR.box(M.team, 0.004, 0.012, 0.04, 0.019, -0.03, 0, { b: 0 });
    near(t, () => {
      for (const z of [-0.03, 0.03]) pbox(t, M.dark, 0.006, 0.006, 0.006, 0.05, 0.06, z);
      pbox(t, SPY_CLOTH, 0.004, 0.012, 0.03, 0.052, 0.03, 0.025);
    });
  },
});

const THF = (): SoldierSpec => ({
  uniform: { c: 0x2a2c30, m: 0, r: 0.9, d: 2 },
  trousers: { c: 0x232427, m: 0, r: 0.9, d: 2 },
  headgear: 'beanie',
  gloves: true,
  swingArms: true,
  armL: [0.2, -0.15],
  armR: [0.25, 0.15],
  fire: 'none',
  armband: M.teamCloth,
  build: (t, armL) => {
    // bandana mask over the lower face (team colour), loot sack on the back, crowbar
    t.box(M.teamCloth, 0.02, 0.026, 0.07, 0.03, 0.15, 0, { b: 0 });
    t.add(new THREE.ConeGeometry(0.014, 0.03, 4), M.teamCloth, { p: [-0.035, 0.15, 0], r: [0, 0, 1.6] });
    t.sph(M.canvas, 0.058, -0.072, 0.086, 0, { seg: 6, s: [0.85, 1.05, 1] });
    t.box(M.webbing, 0.008, 0.012, 0.03, -0.07, 0.15, 0, { b: 0 });
    t.box(M.yellow, 0.002, 0.03, 0.018, -0.12, 0.085, 0, { b: 0 });
    t.box(M.webbing, 0.086, 0.012, 0.12, 0, 0.08, 0, { b: 0, r: [0.7, 0, 0] });
    armL.box(M.red, 0.012, 0.11, 0.012, 0.0, -0.13, 0, { b: 0, r: [0, 0, 0.2] });
    armL.box(M.red, 0.03, 0.012, 0.012, 0.015, -0.19, 0, { b: 0 });
    near(t, () => {
      pbox(t, M.dark, 0.03, 0.02, 0.02, 0.02, 0.005, -0.055);
      pbox(t, M.yellow, 0.004, 0.008, 0.008, -0.12, 0.1, 0.012);
    });
  },
});

const SHOK = (): SoldierSpec => ({
  uniform: JACKET,
  trousers: SOV_TROUSERS,
  headgear: 'gasmask',
  gloves: true,
  swingArms: false,
  armL: [1.2, -0.5],
  armR: [0.7, 0.15],
  fire: 'rifle',
  shoulders: M.gun,
  build: (t) => {
    // armoured vest and pauldrons
    t.box(M.gun, 0.072, 0.072, 0.114, 0.006, 0.075, 0, { b: 0.008 });
    near(t, () => {
      for (const y of [0.055, 0.09]) pbox(t, M.dark, 0.074, 0.004, 0.116, 0.006, y, 0);
    });
    // tesla backpack: generator box, copper coils, glowing core
    t.box(M.gun, 0.05, 0.1, 0.09, -0.07, 0.08, 0, { b: 0.008 });
    for (const z of [-0.026, 0.026]) {
      t.cyl(M.copper, 0.014, 0.014, 0.07, -0.085, 0.135, z, { seg: 6 });
      t.cyl(M.offwhite, 0.016, 0.016, 0.012, -0.085, 0.175, z, { seg: 6 });
    }
    near(t, () => {
      for (const z of [-0.026, 0.026]) for (const y of [0.12, 0.14]) t.cyl(M.offwhite, 0.0155, 0.0155, 0.005, -0.085, y, z, { seg: 6, open: true });
    });
    t.sph(G.tesla, 0.016, -0.098, 0.08, 0, { seg: 6, slot: 'glow:pack' });
    // tesla gun: short body, two coils near the muzzle, emitter tip; cable to the pack
    t.box(M.gun, 0.11, 0.026, 0.022, 0.06, 0.07, 0.035, { b: 0.004 });
    for (const x of [0.11, 0.14]) t.cyl(M.copper, 0.016, 0.016, 0.01, x, 0.072, 0.035, { r: [0, 0, Math.PI / 2], seg: 6 });
    t.cyl(M.dark, 0.006, 0.006, 0.06, 0.15, 0.072, 0.035, { r: [0, 0, -Math.PI / 2], seg: 5 });
    t.sph(G.tesla, 0.009, 0.185, 0.072, 0.035, { seg: 4, slot: 'glow:pack' });
    t.box(M.dark, 0.012, 0.03, 0.01, 0.04, 0.045, 0.035, { b: 0, r: [0, 0, 0.3] });
    pipe(t, [-0.06, 0.05, 0.03], [0.03, 0.06, 0.04], 0.005, M.dark, 4);
  },
});

const MECH = (): SoldierSpec => ({
  uniform: { c: 0x6f7480, m: 0, r: 0.85, d: 2, t: 0.35 },
  trousers: { c: 0x5c616c, m: 0, r: 0.86, d: 2, t: 0.35 },
  headgear: 'cap',
  gloves: true,
  swingArms: true,
  armL: [0.1, -0.12],
  armR: [0.2, 0.12],
  fire: 'wrench',
  shoulders: M.teamCloth,
  build: (t, armL, armR) => {
    // overall bib with team patch and a tool belt
    t.box(M.teamCloth, 0.004, 0.022, 0.03, 0.047, 0.09, 0.02, { b: 0 });
    t.box(M.boot, 0.07, 0.016, 0.104, 0, 0.018, 0, { b: 0 });
    t.box(M.webbing, 0.022, 0.03, 0.022, 0.03, 0.005, 0.05, { b: 0 });
    t.box(M.webbing, 0.022, 0.026, 0.02, -0.03, 0.005, 0.05, { b: 0 });
    t.box(M.red, 0.02, 0.04, 0.012, 0.0, 0.0, -0.056, { b: 0 });
    t.box(M.steel, 0.006, 0.05, 0.006, -0.02, 0.02, 0.058, { b: 0, r: [0, 0, 0.3] });
    // big adjustable wrench in the right hand
    armR.box(M.steel, 0.01, 0.12, 0.008, 0.012, -0.16, 0, { b: 0, r: [0, 0, 0.15] });
    armR.box(M.steel, 0.03, 0.022, 0.01, 0.02, -0.225, 0, { b: 0 });
    armR.box(M.dark, 0.012, 0.02, 0.012, 0.03, -0.215, 0, { b: 0 });
    // oil can in the left hand
    armL.cyl(M.red, 0.014, 0.016, 0.035, 0.0, -0.14, 0, { seg: 6 });
    armL.cyl(M.brass, 0.003, 0.004, 0.04, 0.014, -0.11, 0, { r: [0, 0, -0.6], seg: 4 });
    // toolbag on the back
    t.box(M.canvas, 0.034, 0.05, 0.07, -0.064, 0.07, 0, { b: 0 });
    near(t, () => pbox(t, M.dark, 0.036, 0.006, 0.072, -0.064, 0.09, 0));
  },
});

// ---------------------------------------------------------------------------------------------
// Attack dog
// ---------------------------------------------------------------------------------------------

const FUR = { c: 0x5a4030, m: 0, r: 0.85, d: 2 };
const FUR_DARK = { c: 0x231a15, m: 0, r: 0.85, d: 2 };
const FUR_TAN = { c: 0xa47a4c, m: 0, r: 0.85, d: 2 };

function dog(): ModelTemplate {
  const r = new NB('root');
  const body = r.node('body', [0, 0.115, 0]);
  // torso: deep chest, tucked waist
  body.add(lathe([[0.0, -0.11], [0.03, -0.1], [0.036, -0.05], [0.044, 0.03], [0.038, 0.09], [0.0, 0.1]], 10), FUR_TAN, {
    r: [0, 0, -Math.PI / 2],
    s: [1, 1, 0.85],
  });
  body.box(FUR_DARK, 0.15, 0.032, 0.062, -0.01, 0.031, 0, { b: 0 }); // saddle
  // team collar (studded) and a tag
  body.cyl(M.teamCloth, 0.033, 0.035, 0.018, 0.085, 0.025, 0, { r: [0, 0, -0.9], seg: 8 });
  body.box(M.brass, 0.008, 0.012, 0.008, 0.1, 0.0, 0, { b: 0 });
  // head (part of the body mesh; lunges with the body)
  const hx = 0.1;
  const hy = 0.045;
  body.box(FUR_TAN, 0.062, 0.052, 0.052, hx + 0.02, hy + 0.02, 0, { b: 0 });
  body.box(FUR_DARK, 0.052, 0.03, 0.034, hx + 0.066, hy + 0.008, 0, { b: 0 }); // muzzle
  body.sph(M.darker, 0.008, hx + 0.092, hy + 0.017, 0, { seg: 5 }); // nose
  for (const s of [-1, 1]) {
    body.add(new THREE.ConeGeometry(0.013, 0.038, 5), FUR_DARK, { p: [hx + 0.005, hy + 0.06, 0.017 * s], r: [0.25 * s, 0, 0] });
  }
  near(body, () => {
    for (const s of [-1, 1]) body.sph(M.darker, 0.0045, hx + 0.047, hy + 0.031, 0.02 * s, { seg: 4 });
    pbox(body, M.red, 0.03, 0.004, 0.02, hx + 0.07, hy - 0.006, 0); // tongue
    pbox(body, M.white, 0.026, 0.004, 0.026, hx + 0.07, hy - 0.002, 0); // teeth
    for (const z of [-0.022, 0, 0.022]) pbox(body, M.steel, 0.005, 0.005, 0.005, 0.09, 0.04, z);
  });
  // tail
  body.add(new THREE.ConeGeometry(0.012, 0.09, 5), FUR, { p: [-0.135, 0.03, 0], r: [0, 0, 2.1] });
  // legs
  const legs: [string, number, number][] = [
    ['lf', 0.07, -0.024],
    ['rf', 0.07, 0.024],
    ['lb', -0.075, -0.026],
    ['rb', -0.075, 0.026],
  ];
  for (const [name, x, z] of legs) {
    const l = r.node(name, [x, 0.11, z]);
    l.cyl(name.endsWith('b') ? FUR : FUR_TAN, 0.016, 0.009, 0.1, 0, -0.05, 0, { seg: 4 });
    l.box(FUR_DARK, 0.026, 0.012, 0.02, 0.006, -0.105, 0, { b: 0 });
  }

  r.node('m0', [0.17, 0.15, 0]);

  return makeTemplate({
    root: r,
    height: 0.2,
    radius: 0.14,
    muzzles: ['m0'],
    glow: {},
    anim: (c, s) => {
      const b = c.n.body;
      const d = Math.min(1, s.dying);
      if (d > 0) {
        const fall = easeOut(Math.min(1, d * 1.6));
        if (s.deathKind === 'burn' || s.deathKind === 'electro') c.setVariant(BodyVariant.Charred);
        b.rotation.set(fall * 1.4, 0, 0);
        b.position.y = 0.115 - fall * 0.07;
        for (const n of ['lf', 'rf', 'lb', 'rb']) {
          c.n[n].rotation.set(fall * 1.4, 0, 0);
          c.n[n].position.y = 0.11 - fall * 0.07;
        }
        return;
      }
      if (c.variant) c.setVariant(0);
      const dt = dtOf(s);
      const run = (c.v.run = (c.v.run ?? 0) + ((s.moving ? 1 : 0) - (c.v.run ?? 0)) * Math.min(1, dt * 10));
      c.v.ph = (c.v.ph ?? 0) + dt * 16 * (s.moving ? 1 : 0);
      const ph = c.v.ph;
      const a = Math.sin(ph) * 0.75 * run;
      c.n.lf.rotation.z = a;
      c.n.rf.rotation.z = a * 0.8;
      c.n.lb.rotation.z = -a;
      c.n.rb.rotation.z = -a * 0.8;
      b.position.y = 0.115 + Math.abs(Math.cos(ph)) * 0.015 * run + Math.sin(s.time * 3) * 0.002;
      b.rotation.set(0, 0, Math.sin(ph) * 0.08 * run + s.firing * 0.25);
      b.position.x = s.firing * 0.04;
    },
  });
}

/** Builders take the owner's faction; e1 / e3 / e6 are dressed per faction (see FACTION_DRESSED_UNITS). */
export const INFANTRY_BUILDERS: Record<string, (fac?: ModelFaction) => ModelTemplate> = {
  e1: (fac = 'allies') => soldier(E1(fac), fac),
  e2: () => soldier(E2('soviet'), 'soviet'),
  e3: (fac = 'allies') => soldier(E3(fac), fac),
  e4: () => soldier(E4('soviet'), 'soviet'),
  e6: (fac = 'allies') => soldier(E6(fac), fac),
  medi: () => soldier(MEDI(), 'allies'),
  e7: () => soldier(E7(), 'allies'),
  spy: () => soldier(SPY(), 'allies'),
  thf: () => soldier(THF(), 'allies'),
  shok: () => soldier(SHOK(), 'soviet'),
  mech: () => soldier(MECH(), 'allies'),
  dog,
};
