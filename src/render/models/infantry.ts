/**
 * Infantry + attack dog. Face +X, feet at y=0. Each soldier = 5 meshes (torso, 2 arms, 2 legs),
 * all using the shared per-team body material.
 */
import * as THREE from 'three';
import { NB, makeTemplate, type Ctx, type Mat, type ModelTemplate, type V3 } from './builder';
import { M, G, lathe, shade } from './parts';
import type { ModelAnimState } from './types';
import { BodyVariant } from './materials';
import { approach, dtOf } from './anim';

const HIP_Y = 0.15;
const SHOULDER_Y = 0.105; // relative to torso
const SHOULDER_Z = 0.07;
const LEG_Z = 0.034;

type Headgear = 'helmet' | 'hardhat' | 'medic' | 'tanya' | 'ushanka' | 'fedora' | 'beanie';

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
  fire?: 'rifle' | 'throw' | 'rocket' | 'flame' | 'pistols' | 'heal' | 'none';
  /** Long coat skirt hanging from the waist (spy trench coat). */
  coat?: Mat;
}

// Low-poly primitives shared by all soldiers (each ~10-40 triangles).
const ARM_GEO = new THREE.CylinderGeometry(0.019, 0.016, 0.1, 4, 1, false);
ARM_GEO.translate(0, -0.05, 0);
ARM_GEO.rotateY(Math.PI / 4);
const HAND_GEO = new THREE.OctahedronGeometry(0.017, 0);
const LEG_GEO = new THREE.CylinderGeometry(0.024, 0.019, 0.12, 5, 1, false);
LEG_GEO.translate(0, -0.06, 0);
const HEAD_GEO = new THREE.SphereGeometry(0.04, 6, 4);

const FELT: Mat = { c: 0x2c2a28, m: 0, r: 0.85, d: 2 };
const KNIT: Mat = { c: 0x1e1f22, m: 0, r: 0.95, d: 2, uv: 6 };
const CANOPY: Mat = { c: 0xd8d4c4, m: 0, r: 0.85, d: 2, uv: 4 };
const CANOPY_TEAM: Mat = { c: 0xe8e8e8, m: 0, r: 0.85, t: 0.85, d: 2, uv: 4 };
const CHUTE_H = 0.82;

/** Round parachute (canopy gores + suspension lines) hanging over the soldier; node 'chute' at the feet. */
function parachute(r: NB): void {
  const ch = r.node('chute');
  const prof: [number, number][] = [
    [0.3, 0.0],
    [0.285, 0.05],
    [0.23, 0.1],
    [0.13, 0.135],
    [0.0, 0.145],
  ];
  const gores = 8;
  for (let i = 0; i < gores; i++) {
    const g = lathe(prof, 2, (i / gores) * Math.PI * 2, (Math.PI * 2) / gores);
    ch.add(g, i % 2 ? CANOPY : CANOPY_TEAM, { p: [0, CHUTE_H - 0.07, 0] });
  }
  // vent + skirt hem
  ch.cyl(M.dark, 0.022, 0.022, 0.006, 0, CHUTE_H + 0.078, 0, { seg: 6 });
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
    ch.add(LINE_GEO, M.offwhite, { p: [(ax + bx) / 2, (ay + by) / 2, (az + bz) / 2], r: [e.x, e.y, e.z], s: [1, len, 1] });
  }
  // risers + harness straps
  for (const sd of [-1, 1]) ch.box(M.webbing, 0.008, 0.09, 0.008, 0.0, 0.3, 0.045 * sd, { b: 0 });
}

const LINE_GEO = new THREE.CylinderGeometry(0.0016, 0.0016, 1, 3, 1, true);

function arm(nb: NB, sleeve: Mat, bare = false): void {
  // hangs down from the shoulder pivot (origin)
  nb.add(ARM_GEO, bare ? M.skin : sleeve);
  nb.add(HAND_GEO, M.skin, { p: [0, -0.108, 0] });
}

function leg(nb: NB, trousers: Mat): void {
  nb.add(LEG_GEO, trousers);
  nb.box(M.boot, 0.056, 0.03, 0.04, 0.01, -0.132, 0, { b: 0 });
}

function headgear(t: NB, kind: Headgear, headY: number): void {
  const hy = headY;
  switch (kind) {
    case 'helmet':
      t.add(lathe([[0.0, 0.05], [0.04, 0.035], [0.053, -0.004]], 6), M.teamDark, { p: [0, hy + 0.012, 0], r: [0, Math.PI / 6, 0] });
      break;
    case 'ushanka':
      t.add(lathe([[0.0, 0.045], [0.045, 0.035], [0.05, 0.0]], 6), shade(M.khaki, 0x5a4a3a), { p: [0, hy + 0.012, 0] });
      break;
    case 'hardhat':
      t.add(lathe([[0.0, 0.045], [0.04, 0.032], [0.046, 0.004], [0.06, -0.002]], 6), M.yellow, { p: [0, hy + 0.014, 0] });
      break;
    case 'medic':
      t.add(lathe([[0.0, 0.05], [0.04, 0.035], [0.053, -0.004]], 6), M.white, { p: [0, hy + 0.012, 0], r: [0, Math.PI / 6, 0] });
      t.box(M.red, 0.004, 0.02, 0.022, 0.047, hy + 0.024, 0, { b: 0 });
      t.box(M.red, 0.022, 0.004, 0.022, 0.0, hy + 0.062, 0, { b: 0 });
      break;
    case 'tanya':
      t.add(lathe([[0.0, 0.046], [0.036, 0.034], [0.045, 0.0]], 6), M.hair, { p: [-0.006, hy, 0] });
      t.add(new THREE.ConeGeometry(0.016, 0.075, 4), M.hair, { p: [-0.06, hy - 0.022, 0], r: [0, 0, -0.5] });
      break;
    case 'fedora':
      // wide brim, pinched crown, team-coloured hat band
      t.add(new THREE.CylinderGeometry(0.066, 0.066, 0.006, 8), FELT, { p: [0, hy + 0.024, 0], r: [0, 0, 0.08] });
      t.add(lathe([[0.04, 0.0], [0.039, 0.03], [0.03, 0.045], [0.0, 0.04]], 8), FELT, { p: [0, hy + 0.026, 0] });
      t.cyl(M.team, 0.0405, 0.0405, 0.01, 0, hy + 0.033, 0, { seg: 8, open: true });
      break;
    case 'beanie':
      t.add(lathe([[0.0, 0.05], [0.032, 0.042], [0.045, 0.012], [0.046, -0.004]], 6), KNIT, { p: [-0.003, hy + 0.008, 0] });
      t.cyl(KNIT, 0.047, 0.047, 0.012, -0.003, hy + 0.006, 0, { seg: 6 });
      break;
  }
}

function soldier(spec: SoldierSpec): ModelTemplate {
  const r = new NB('root');
  const body = r.node('body');
  const torso = body.node('torso', [0, HIP_Y, 0]);
  // pelvis + belt
  torso.box(spec.trousers, 0.066, 0.04, 0.096, 0, 0.0, 0, { b: 0 });
  torso.box(M.webbing, 0.07, 0.014, 0.1, 0, 0.022, 0, { b: 0 });
  // chest (6-sided, slightly barrel shaped)
  torso.add(lathe([[0.048, 0.028], [0.06, 0.08], [0.05, 0.122], [0.0, 0.13]], 6), spec.uniform, { s: [0.78, 1, 1.05], r: [0, Math.PI / 6, 0] });
  // head
  const headY = 0.163;
  torso.add(HEAD_GEO, M.skin, { p: [0.003, headY, 0], s: [0.95, 1.05, 0.95] });
  torso.box(M.darker, 0.004, 0.006, 0.03, 0.039, headY + 0.006, 0, { b: 0 });
  headgear(torso, spec.headgear, headY);
  const armL = torso.node('armL', [0, SHOULDER_Y, -SHOULDER_Z], [spec.armL[1], 0, spec.armL[0]]);
  const armR = torso.node('armR', [0, SHOULDER_Y, SHOULDER_Z], [spec.armR[1], 0, spec.armR[0]]);
  const bare = spec.headgear === 'tanya';
  arm(armL, spec.uniform, bare);
  arm(armR, spec.uniform, bare);
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
  parachute(r);

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

  // walk cycle
  const dt = dtOf(s);
  const walkAmt = (c.v.walk = (c.v.walk ?? 0) + ((s.moving ? 1 : 0) - (c.v.walk ?? 0)) * Math.min(1, dt * 10));
  c.v.ph = (c.v.ph ?? 0) + dt * (7 + 4 * s.speed) * (s.moving ? 1 : 0);
  const ph = c.v.ph;
  const swing = Math.sin(ph) * 0.65 * walkAmt;
  legL.rotation.z = swing;
  legR.rotation.z = -swing;
  const breathe = Math.sin(t * 2.4) * 0.004;
  torso.position.y = HIP_Y + Math.abs(Math.cos(ph)) * 0.012 * walkAmt + breathe;
  torso.rotation.z = -0.1 * walkAmt; // lean forward
  torso.position.x = 0;

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
  const f = s.firing;
  if (f > 0) {
    switch (fire) {
      case 'rifle':
      case 'flame':
        torso.position.x = -0.014 * f;
        torso.rotation.z += 0.08 * f;
        break;
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
    c.n.torso.rotation.z = 0;
    c.n.torso.position.y = HIP_Y;
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
// Weapons
// ---------------------------------------------------------------------------------------------

function rifle(t: NB, z = 0.035, y = 0.075): void {
  // held across the chest, pointing +X
  t.box(M.wood, 0.07, 0.022, 0.016, -0.0, y - 0.006, z, { b: 0 });
  t.box(M.gun, 0.08, 0.02, 0.014, 0.07, y, z, { b: 0 });
  t.cyl(M.dark, 0.0045, 0.0045, 0.09, 0.15, y + 0.004, z, { r: [0, 0, -Math.PI / 2], seg: 6 });
  t.box(M.dark, 0.014, 0.03, 0.01, 0.07, y - 0.022, z, { b: 0, r: [0, 0, 0.3] });
}

const E1: SoldierSpec = {
  uniform: M.teamCloth,
  trousers: M.teamClothDark,
  headgear: 'helmet',
  swingArms: false,
  armL: [1.25, -0.55],
  armR: [0.75, 0.15],
  fire: 'rifle',
  build: (t) => {
    rifle(t);
    // canteen + pouches
    t.box(M.webbing, 0.03, 0.03, 0.024, -0.03, 0.03, 0.05, { b: 0 });
    t.box(M.webbing, 0.026, 0.03, 0.03, 0.036, 0.035, -0.035, { b: 0 });
    t.box(M.webbing, 0.03, 0.05, 0.06, -0.052, 0.085, 0, { b: 0 });
  },
};

const E2: SoldierSpec = {
  uniform: M.teamCloth,
  trousers: M.teamClothDark,
  headgear: 'ushanka',
  swingArms: true,
  armL: [0.15, -0.1],
  armR: [0.25, 0.1],
  fire: 'throw',
  build: (t, _l, armR) => {
    // grenade bandolier + pouches
    t.box(M.webbing, 0.075, 0.018, 0.11, 0, 0.075, 0, { b: 0, r: [0.5, 0, 0] });
    for (const z of [-0.035, 0, 0.035]) t.sph(M.oliveDark, 0.013, 0.045, 0.04, z, { seg: 8 });
    t.box(M.webbing, 0.04, 0.05, 0.07, -0.05, 0.08, 0, { b: 0 });
    armR.sph(M.oliveDark, 0.017, 0.008, -0.125, 0, { seg: 8 });
  },
};

const E3: SoldierSpec = {
  uniform: M.teamCloth,
  trousers: M.teamClothDark,
  headgear: 'helmet',
  swingArms: false,
  armL: [1.3, -0.35],
  armR: [1.55, -0.6],
  fire: 'rocket',
  build: (t) => {
    // launcher tube on right shoulder
    const y = 0.13;
    const z = 0.06;
    t.cyl(M.olive, 0.021, 0.021, 0.27, 0.03, y, z, { r: [0, 0, -Math.PI / 2], seg: 10 });
    t.cyl(M.oliveDark, 0.025, 0.025, 0.03, 0.15, y, z, { r: [0, 0, -Math.PI / 2], seg: 10 });
    t.cyl(M.oliveDark, 0.025, 0.022, 0.03, -0.09, y, z, { r: [0, 0, -Math.PI / 2], seg: 10 });
    t.add(new THREE.ConeGeometry(0.019, 0.04, 8), M.red, { p: [0.18, y, z], r: [0, 0, -Math.PI / 2] });
    t.box(M.dark, 0.03, 0.02, 0.01, 0.04, y + 0.025, z - 0.01, { b: 0 });
    t.box(M.dark, 0.012, 0.035, 0.012, 0.04, y - 0.03, z, { b: 0 });
    t.box(M.webbing, 0.03, 0.06, 0.06, -0.052, 0.08, -0.005, { b: 0 });
  },
};

const E4: SoldierSpec = {
  uniform: M.teamCloth,
  trousers: M.teamClothDark,
  headgear: 'helmet',
  swingArms: false,
  armL: [0.95, -0.45],
  armR: [0.55, 0.12],
  fire: 'flame',
  build: (t) => {
    // twin fuel tanks on back
    for (const z of [-0.026, 0.026]) {
      t.cyl(M.red, 0.022, 0.024, 0.12, -0.065, 0.07, z, { seg: 6 });
    }
    t.cyl(M.steel, 0.008, 0.008, 0.06, -0.065, 0.13, 0, { r: [Math.PI / 2, 0, 0], seg: 6 });
    t.box(M.yellow, 0.004, 0.02, 0.07, -0.09, 0.07, 0, { b: 0 });
    // hose + wand
    t.cyl(M.dark, 0.006, 0.006, 0.12, -0.02, 0.03, 0.045, { r: [0, 0, -1.2], seg: 6 });
    t.box(M.gun, 0.14, 0.018, 0.018, 0.09, 0.05, 0.035, { b: 0 });
    t.cyl(M.dark, 0.012, 0.009, 0.03, 0.17, 0.05, 0.035, { r: [0, 0, -Math.PI / 2], seg: 8 });
    t.sph(G.fire, 0.008, 0.19, 0.05, 0.035, { seg: 6, slot: 'glow:pilot' });
  },
};

const E6: SoldierSpec = {
  uniform: M.teamCloth,
  trousers: shade(M.khaki, 0x6a6048),
  headgear: 'hardhat',
  swingArms: true,
  armL: [0.08, -0.12],
  armR: [0.15, 0.1],
  fire: 'none',
  build: (t, armL) => {
    // hi-vis stripes on vest
    t.box(M.yellow, 0.084, 0.008, 0.114, 0, 0.07, 0, { b: 0 });
    t.box(M.yellow, 0.084, 0.008, 0.118, 0, 0.1, 0, { b: 0 });
    // tool belt
    t.box(M.wood, 0.03, 0.025, 0.02, 0.03, 0.01, 0.05, { b: 0 });
    // toolbox in left hand
    armL.box(M.red, 0.07, 0.04, 0.03, 0.0, -0.14, 0, { b: 0 });
    armL.box(M.dark, 0.035, 0.006, 0.006, 0.0, -0.118, 0, { b: 0 });
    // wrench on back
    t.box(M.steel, 0.012, 0.09, 0.008, -0.05, 0.08, -0.02, { b: 0, r: [0.4, 0, 0] });
  },
};

const MEDI: SoldierSpec = {
  uniform: M.white,
  trousers: M.teamClothDark,
  headgear: 'medic',
  swingArms: true,
  armL: [0.1, -0.12],
  armR: [0.12, 0.1],
  fire: 'heal',
  build: (t, armL, armR) => {
    // red cross on chest and back
    t.box(M.red, 0.004, 0.034, 0.012, 0.047, 0.08, 0, { b: 0 });
    t.box(M.red, 0.004, 0.012, 0.034, 0.047, 0.08, 0, { b: 0 });
    // armband
    armR.cyl(M.red, 0.021, 0.021, 0.014, 0, -0.03, 0, { seg: 8 });
    armR.box(M.white, 0.006, 0.008, 0.012, 0.02, -0.03, 0, { b: 0 });
    // medkit bag
    armL.box(M.white, 0.06, 0.045, 0.03, 0.0, -0.14, 0, { b: 0 });
    armL.box(M.red, 0.004, 0.026, 0.008, 0.0, -0.14, 0.016, { b: 0 });
    armL.box(M.red, 0.026, 0.008, 0.004, 0.0, -0.14, 0.016, { b: 0 });
    t.box(M.webbing, 0.03, 0.05, 0.06, -0.052, 0.08, 0, { b: 0 });
  },
};

const E7: SoldierSpec = {
  uniform: M.teamLight,
  trousers: shade(M.khaki, 0x7a6a4c),
  headgear: 'tanya',
  swingArms: true,
  armL: [0.12, -0.12],
  armR: [0.12, 0.12],
  fire: 'pistols',
  build: (t, armL, armR) => {
    // crossed bandoliers
    t.box(M.webbing, 0.084, 0.012, 0.13, 0, 0.075, 0, { b: 0, r: [0.6, 0, 0] });
    t.box(M.webbing, 0.084, 0.012, 0.13, 0, 0.075, 0, { b: 0, r: [-0.6, 0, 0] });
    // holsters
    t.box(M.boot, 0.03, 0.035, 0.015, 0.0, -0.01, 0.058, { b: 0 });
    t.box(M.boot, 0.03, 0.035, 0.015, 0.0, -0.01, -0.058, { b: 0 });
    // pistols in both hands (pointing along arm -> forward when raised)
    for (const a of [armL, armR]) {
      a.box(M.dark, 0.016, 0.05, 0.012, 0.004, -0.14, 0, { b: 0 });
      a.box(M.dark, 0.022, 0.014, 0.012, 0.016, -0.118, 0, { b: 0 });
    }
  },
};

const SPY: SoldierSpec = {
  uniform: { c: 0x8a8068, m: 0, r: 0.82, d: 2 },
  trousers: { c: 0x3a3a3e, m: 0, r: 0.85, d: 2 },
  coat: { c: 0x8a8068, m: 0, r: 0.82, d: 2 },
  headgear: 'fedora',
  swingArms: true,
  armL: [0.06, -0.12],
  armR: [0.1, 0.1],
  fire: 'none',
  build: (t, armL, armR) => {
    // turned-up collar, tie, briefcase, sunglasses
    t.box({ c: 0x8a8068, m: 0, r: 0.82, d: 2 }, 0.03, 0.03, 0.11, -0.02, 0.128, 0, { b: 0, r: [0, 0, 0.3] });
    t.box(M.team, 0.004, 0.05, 0.012, 0.049, 0.1, 0, { b: 0 });
    t.box(M.black, 0.006, 0.008, 0.05, 0.04, 0.17, 0, { b: 0 });
    armL.box(M.black, 0.08, 0.055, 0.022, 0.0, -0.15, 0, { b: 0.004 });
    armL.box(M.brass, 0.012, 0.006, 0.024, 0.0, -0.12, 0, { b: 0 });
    armR.box(M.team, 0.004, 0.012, 0.04, 0.019, -0.03, 0, { b: 0 });
  },
};

const THF: SoldierSpec = {
  uniform: { c: 0x2a2c30, m: 0, r: 0.9, d: 2 },
  trousers: { c: 0x232427, m: 0, r: 0.9, d: 2 },
  headgear: 'beanie',
  swingArms: true,
  armL: [0.2, -0.15],
  armR: [0.25, 0.15],
  fire: 'none',
  build: (t, armL) => {
    // bandana mask over the lower face (team colour), loot sack on the back, crowbar
    t.box(M.teamCloth, 0.02, 0.026, 0.07, 0.03, 0.15, 0, { b: 0 });
    t.add(new THREE.ConeGeometry(0.014, 0.03, 4), M.teamCloth, { p: [-0.035, 0.15, 0], r: [0, 0, 1.6] });
    t.sph(M.canvas, 0.055, -0.07, 0.085, 0, { seg: 8, s: [0.85, 1.05, 1] });
    t.box(M.webbing, 0.008, 0.012, 0.03, -0.07, 0.15, 0, { b: 0 });
    t.box(M.yellow, 0.002, 0.03, 0.018, -0.118, 0.085, 0, { b: 0 });
    t.box(M.webbing, 0.084, 0.012, 0.12, 0, 0.08, 0, { b: 0, r: [0.7, 0, 0] });
    armL.box(M.red, 0.012, 0.11, 0.012, 0.0, -0.13, 0, { b: 0, r: [0, 0, 0.2] });
    armL.box(M.red, 0.03, 0.012, 0.012, 0.015, -0.19, 0, { b: 0 });
  },
};

// ---------------------------------------------------------------------------------------------
// Attack dog
// ---------------------------------------------------------------------------------------------

const FUR = { c: 0x5a4030, m: 0, r: 0.85, d: 2 };
const FUR_DARK = { c: 0x231a15, m: 0, r: 0.85, d: 2 };
const FUR_TAN = { c: 0xa47a4c, m: 0, r: 0.85, d: 2 };

function dog(): ModelTemplate {
  const r = new NB('root');
  const body = r.node('body', [0, 0.115, 0]);
  // torso
  body.add(lathe([[0.0, -0.11], [0.03, -0.1], [0.038, -0.05], [0.042, 0.03], [0.036, 0.09], [0.0, 0.1]], 10), FUR_TAN, {
    r: [0, 0, -Math.PI / 2],
    s: [1, 1, 0.85],
  });
  body.box(FUR_DARK, 0.15, 0.03, 0.06, -0.01, 0.03, 0, { b: 0 }); // saddle
  body.cyl(M.teamCloth, 0.032, 0.034, 0.016, 0.085, 0.025, 0, { r: [0, 0, -0.9], seg: 10 }); // collar
  body.box(M.brass, 0.008, 0.012, 0.008, 0.1, 0.0, 0, { b: 0 });
  // head (part of the body mesh; lunges with the body)
  const hx = 0.1;
  const hy = 0.045;
  body.box(FUR_TAN, 0.06, 0.05, 0.05, hx + 0.02, hy + 0.02, 0, { b: 0 });
  body.box(FUR_DARK, 0.05, 0.028, 0.032, hx + 0.065, hy + 0.008, 0, { b: 0 }); // muzzle
  body.sph(M.darker, 0.008, hx + 0.09, hy + 0.016, 0, { seg: 6 }); // nose
  for (const s of [-1, 1]) {
    body.add(new THREE.ConeGeometry(0.012, 0.035, 6), FUR_DARK, { p: [hx + 0.005, hy + 0.058, 0.016 * s], r: [0.25 * s, 0, 0] });
    body.sph(M.darker, 0.0045, hx + 0.045, hy + 0.03, 0.019 * s, { seg: 6 });
  }
  // tail
  body.add(new THREE.ConeGeometry(0.012, 0.09, 6), FUR, { p: [-0.135, 0.03, 0], r: [0, 0, 2.1] });
  // legs
  const legs: [string, number, number][] = [
    ['lf', 0.07, -0.024],
    ['rf', 0.07, 0.024],
    ['lb', -0.075, -0.026],
    ['rb', -0.075, 0.026],
  ];
  for (const [name, x, z] of legs) {
    const l = r.node(name, [x, 0.11, z]);
    l.cyl(name.endsWith('b') ? FUR : FUR_TAN, 0.015, 0.009, 0.1, 0, -0.05, 0, { seg: 4 });
    l.box(FUR_DARK, 0.024, 0.012, 0.02, 0.006, -0.105, 0, { b: 0 });
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

export const INFANTRY_BUILDERS: Record<string, () => ModelTemplate> = {
  e1: () => soldier(E1),
  e2: () => soldier(E2),
  e3: () => soldier(E3),
  e4: () => soldier(E4),
  e6: () => soldier(E6),
  medi: () => soldier(MEDI),
  e7: () => soldier(E7),
  spy: () => soldier(SPY),
  thf: () => soldier(THF),
  dog,
};
