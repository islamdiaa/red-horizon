/**
 * Round-4 support structures:
 *   gap Gap Generator, hbox Camo Pillbox, minp / minv mines (structures, 1x1, front +Z)
 *
 * anim.cloak (0..1) shows the owner's cloak shimmer on the camo pillbox and mines.
 */
import * as THREE from 'three';
import { NB, makeTemplate, type Ctx, type Mat, type ModelTemplate } from './builder';
import type { ModelAnimState } from './types';
import { M, G, alliedStar, emblem, faceRot, floodlight, foundation, grille, hazard, lamp, lathe, pipe, prismXZ, ringGeo, sandbags, warnLight } from './parts';
import { approach, blink, dtOf, healthVariant } from './anim';
import { cloakMaterial, fxTime, gapHazeMaterial } from './fxmats';
import { setBodyTime } from './materials';

const DEF_AO = { h: 0.25, min: 0.52 };

/** Replace an fx placeholder mesh's material with a shared animated one. */
function swapFx(c: Ctx, node: string, mat: THREE.Material): void {
  const m = c.n[`fx:${node}`] as THREE.Mesh | undefined;
  if (m) {
    m.material = mat;
    m.renderOrder = 3;
  }
}

// [STRUCT] the minelayer, mobile gap generator and radar jammer vehicles now live in vehicles.ts (UNITS)

const MINE_OLIVE: Mat = { c: 0x4a5236, m: 0.35, r: 0.6, d: 0 };

// =============================================================================================
// Gap Generator (Allied structure, 1x1) — tall lattice tower with a pulsing emitter cage
// =============================================================================================

function gapGenerator(): ModelTemplate {
  const r = new NB('root');
  r.ao = DEF_AO;
  r.snow = 1; // [STRUCT]
  r.cavity = true;
  // RA footprint is 1x2: tower on the back cell, generator annex on the front cell
  foundation(r, 1, 2, 0.04, 0.05, M.concreteDark);
  const y0 = 0.04;
  const t = r.node('tower', [0, 0, -0.42]);
  // base: generator block with team bands and conduit
  t.add(
    prismXZ(
      [
        [0.3, -0.22],
        [0.3, 0.22],
        [0.22, 0.3],
        [-0.22, 0.3],
        [-0.3, 0.22],
        [-0.3, -0.22],
        [-0.22, -0.3],
        [0.22, -0.3],
      ],
      0.2,
      0.02,
    ),
    M.concrete,
    { p: [0, y0, 0] },
  );
  t.add(
    prismXZ(
      [
        [0.24, -0.17],
        [0.24, 0.17],
        [0.17, 0.24],
        [-0.17, 0.24],
        [-0.24, 0.17],
        [-0.24, -0.17],
        [-0.17, -0.24],
        [0.17, -0.24],
      ],
      0.04,
      0.01,
    ),
    M.steel,
    { p: [0, y0 + 0.2, 0] },
  );
  t.add(ringGeo(0.26, 0.31, 0.03, 8), M.team, { p: [0, y0 + 0.205, 0], r: [0, Math.PI / 8, 0] }); // [STRUCT] team trim, not a slab
  t.box(M.darker, 0.14, 0.12, 0.02, 0, y0 + 0.07, 0.301, { b: 0 });
  lamp(t, G.warm, [0, y0 + 0.16, 0.31], 0.012);
  for (const s of [-1, 1]) grille(t, 0.1, 0.08, [0.302 * s, y0 + 0.1, 0], 4, [0, 0, -(Math.PI / 2) * s]);
  alliedStar(t, 0.05, [0, y0 + 0.11, 0.302], faceRot('+z'));
  // lattice tower (4 tapered legs, cross bracing)
  const ty = y0 + 0.24;
  const th = 0.78;
  const b0 = 0.17;
  const b1 = 0.07;
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    pipe(t, [b0 * sx, ty, b0 * sz], [b1 * sx, ty + th, b1 * sz], 0.012, M.gun, 5);
  }
  for (let i = 0; i < 4; i++) {
    const f0 = i / 4;
    const f1 = (i + 1) / 4;
    const w0 = b0 + (b1 - b0) * f0;
    const w1 = b0 + (b1 - b0) * f1;
    const y1 = ty + th * f0;
    const y2 = ty + th * f1;
    for (const s of [-1, 1]) {
      pipe(t, [-w0, y1, w0 * s], [w1, y2, w1 * s], 0.004, M.steel, 3);
      pipe(t, [w0 * s, y1, -w0], [w1 * s, y2, w1], 0.004, M.steel, 3);
    }
    t.add(ringGeo(w1 * 1.35, w1 * 1.45, 0.012, 4), M.team, { p: [0, y2, 0], r: [0, Math.PI / 4, 0] });
  }
  // central conduit glowing up the tower
  t.cyl(M.dark, 0.022, 0.03, th, 0, ty + th / 2, 0, { seg: 6 });
  for (let i = 0; i < 4; i++) r.cyl(G.purple, 0.024, 0.024, 0.03, 0, ty + 0.12 + i * 0.17, 0, { seg: 6, slot: 'glow:gapc' });
  // emitter: cage ring + orb + rotating rings
  const ey = ty + th + 0.12;
  t.cyl(M.gun, 0.06, 0.08, 0.05, 0, ty + th + 0.02, 0, { seg: 10 });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    pipe(t, [Math.cos(a) * 0.07, ty + th + 0.03, Math.sin(a) * 0.07], [Math.cos(a) * 0.12, ey, Math.sin(a) * 0.12], 0.006, M.steel, 3);
  }
  t.sph(G.purple, 0.075, 0, ey, 0, { seg: 10, slot: 'glow:gap' });
  const rA = t.node('ringA', [0, ey, 0], [0.5, 0, 0]);
  rA.add(new THREE.TorusGeometry(0.13, 0.008, 4, 20), M.steel, { r: [Math.PI / 2, 0, 0] });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    rA.box(M.team, 0.03, 0.012, 0.02, Math.cos(a) * 0.13, 0, Math.sin(a) * 0.13, { b: 0, r: [0, -a, 0] });
  }
  const rB = t.node('ringB', [0, ey, 0], [0, 0, 0.9]);
  rB.add(new THREE.TorusGeometry(0.16, 0.006, 4, 20), M.copper, { r: [Math.PI / 2, 0, 0] });
  const haze = t.node('haze', [0, ey, 0]);
  haze.sph(M.dark, 0.13, 0, 0, 0, { seg: 12, slot: 'fx:add:b050ff:1' });
  warnLight(t, [0.16, y0 + 0.26, -0.16], false, 0.013); // [STRUCT] baked blink
  // generator annex on the front cell: transformer housing, cooling fins, cable trench to the tower
  r.box(M.concreteLight, 0.6, 0.22, 0.42, 0, y0 + 0.11, 0.48, { b: 0.02 });
  r.box(M.team, 0.64, 0.03, 0.46, 0, y0 + 0.235, 0.48, { b: 0.008 });
  r.box(M.steel, 0.58, 0.02, 0.4, 0, y0 + 0.25, 0.48, { b: 0.004 }); // [STRUCT] roof inside the trim
  emblem(r, 'allies', 0.06, [-0.18, y0 + 0.12, 0.692], [0, 0, 0], true);
  floodlight(r, [0.26, y0 + 0.26, 0.66], 0, 0.8, 0.035);
  for (let i = 0; i < 6; i++) r.box(M.gun, 0.012, 0.16, 0.44, -0.24 + i * 0.096, y0 + 0.1, 0.48, { b: 0 });
  r.box(M.darker, 0.16, 0.14, 0.02, 0.12, y0 + 0.07, 0.692, { b: 0 });
  hazard(r, 0.4, 0.025, [-0.08, y0 + 0.17, 0.692]);
  for (const x of [-0.18, 0.0, 0.18]) {
    r.cyl(M.offwhite, 0.022, 0.026, 0.07, x, y0 + 0.28, 0.4, { seg: 6 });
    r.cyl(M.copper, 0.008, 0.008, 0.03, x, y0 + 0.325, 0.4, { seg: 4 });
  }
  r.box(M.dark, 0.08, 0.02, 0.36, 0.0, y0 + 0.01, 0.12, { b: 0 });
  r.sph(G.purple, 0.014, 0.22, y0 + 0.25, 0.62, { seg: 4, slot: 'glow:gapc' });

  return makeTemplate({
    root: r,
    height: 1.3,
    radius: 0.8,
    muzzles: [],
    glow: { glow: 2, 'glow:gap': 3.5, 'glow:gapc': 3 },
    init: (c) => swapFx(c, 'haze', gapHazeMaterial()),
    anim: (c, s) => {
      healthVariant(c, s);
      if (c.v.seed === undefined) c.v.seed = Math.random() * 3;
      c.setPowered(s.powered);
      fxTime(s.time);
      const dt = dtOf(s);
      const on = (c.v.on = approach(c.v.on ?? 1, s.powered ? 1 : 0, 1.5, dt));
      const t = s.time + c.v.seed;
      c.n.ringA.rotation.y += dt * 1.9 * on;
      c.n.ringB.rotation.y -= dt * 1.3 * on;
      const pulse = 0.5 + 0.5 * Math.sin(t * 3.2);
      c.setGlow('glow:gap', on > 0.05 ? 0.25 + on * (0.55 + 0.45 * pulse) : 0.05);
      // energy rising up the conduit
      c.setGlow('glow:gapc', on * (0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * 6 - 1))));
      setBodyTime(s.time); // [STRUCT] baked light animation clock
      const hz = c.n['fx:haze'];
      if (hz) {
        hz.visible = on > 0.2;
        hz.scale.setScalar(0.8 + 0.35 * pulse * on);
      }
    },
  });
}

// =============================================================================================
// Camo Pillbox (Allied, 1x1) — low bunker buried under camouflage netting and foliage
// =============================================================================================

const NET: Mat = { c: 0x56603a, m: 0, r: 0.95, d: 2, uv: 6 };
const NET_DARK: Mat = { c: 0x3a4228, m: 0, r: 0.95, d: 2, uv: 6 };
const NET_BROWN: Mat = { c: 0x6a5838, m: 0, r: 0.95, d: 2, uv: 6 };
const LEAF: Mat = { c: 0x3f5a26, m: 0, r: 0.9, d: 2 };
const LEAF_LIGHT: Mat = { c: 0x5d7a32, m: 0, r: 0.9, d: 2 };

/** Irregular low dome (displaced lathe) used for camo netting. */
function netDome(rad: number, h: number, seed: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const a = Math.atan2(z, x);
    const n = 1 + 0.12 * Math.sin(a * 5 + seed) + 0.08 * Math.sin(a * 9 + seed * 2.3) + 0.1 * Math.sin(y * 7 + a * 3 + seed);
    // sagging net between poles: pull the mid band down a little
    const sag = 1 - 0.18 * Math.sin(y * Math.PI) * (0.5 + 0.5 * Math.cos(a * 4 + seed));
    p.setXYZ(i, x * rad * n, y * h * sag, z * rad * n);
  }
  g.computeVertexNormals();
  return g;
}

function camoPillbox(): ModelTemplate {
  const r = new NB('root');
  r.ao = DEF_AO;
  r.snow = 0.8; // [STRUCT]
  const y0 = 0.0;
  // dug-in concrete box (mostly hidden), embrasure facing +X like the regular pillbox
  r.add(prismXZ(hexPts(0.3), 0.13, 0.03), M.concreteDark, { p: [0, y0, 0] });
  // embrasure lip poking out through the netting
  r.box(M.concreteDark, 0.12, 0.09, 0.26, 0.33, y0 + 0.065, 0, { b: 0.015 });
  r.box(M.concrete, 0.13, 0.025, 0.28, 0.335, y0 + 0.12, 0, { b: 0.008 });
  r.box(M.darker, 0.012, 0.03, 0.18, 0.392, y0 + 0.085, 0, { b: 0 });
  r.box(G.warm, 0.006, 0.01, 0.13, 0.388, y0 + 0.085, 0, { b: 0, slot: 'glow' });
  r.cyl(M.dark, 0.008, 0.008, 0.1, 0.42, y0 + 0.085, 0.03, { r: [0, 0, -Math.PI / 2], seg: 6 });
  // earth berm
  r.add(lathe([[0.44, 0], [0.36, 0.06], [0.24, 0.1], [0.0, 0.11]], 12), { c: 0x5a4a32, m: 0, r: 1, d: 1 }, { p: [0, y0 - 0.02, 0], s: [1, 1, 0.92] });
  // camo netting layers draped over everything
  r.add(netDome(0.42, 0.24, 1.3), NET, { p: [0, y0, 0] });
  r.add(netDome(0.3, 0.27, 4.1), NET_DARK, { p: [-0.06, y0, 0.05], r: [0, 0.7, 0] });
  r.add(netDome(0.22, 0.25, 7.7), NET_BROWN, { p: [0.08, y0, -0.1], r: [0, 2.1, 0] });
  // net poles poking the canopy up + tie-down stakes
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    r.cyl(M.wood, 0.006, 0.006, 0.05, Math.cos(a) * 0.43, y0 + 0.02, Math.sin(a) * 0.43, { seg: 3 });
  }
  // foliage clumps
  const leaves: [number, number, number, number][] = [
    [0.26, 0.24, 0.09, 0],
    [-0.3, 0.18, 0.08, 1],
    [-0.1, -0.33, 0.07, 0],
    [0.05, 0.3, 0.06, 1],
    [-0.02, 0.0, 0.08, 1],
    [0.28, -0.25, 0.07, 0],
    [-0.36, -0.12, 0.06, 1],
    [0.12, -0.12, 0.07, 0],
    [-0.16, 0.12, 0.07, 0],
    [0.16, 0.1, 0.06, 1],
    [-0.22, -0.2, 0.06, 1],
  ];
  for (const [x, z, s, k] of leaves) {
    const yy = y0 + 0.26 * Math.sqrt(Math.max(0, 1 - (Math.hypot(x, z) / 0.44) ** 2)) + 0.005;
    r.add(new THREE.IcosahedronGeometry(s, 0), k ? LEAF_LIGHT : LEAF, { p: [x, yy, z], s: [1.3, 0.75, 1.1], r: [x * 5, z * 4, 0] });
    r.add(new THREE.IcosahedronGeometry(s * 0.7, 0), k ? LEAF : LEAF_LIGHT, { p: [x + s * 0.6, yy + s * 0.25, z - s * 0.4], s: [1.2, 0.8, 1.2] });
  }
  sandbags(r, 0.26, 2, [0.36, y0, 0.24], [0, -0.5, 0]);
  sandbags(r, 0.26, 2, [0.36, y0, -0.24], [0, 0.5, 0]);
  // cloak shimmer shell (owner only)
  const cl = r.node('cloak', [0, y0, 0]);
  cl.add(new THREE.SphereGeometry(0.47, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2), M.dark, { s: [1, 0.72, 1], slot: 'fx:add:66ccff:0.4' });
  r.node('m0', [0.47, y0 + 0.085, 0.03]);

  return makeTemplate({
    root: r,
    height: 0.32,
    radius: 0.5,
    muzzles: ['m0'],
    glow: { glow: 2 },
    init: (c) => swapFx(c, 'cloak', cloakMaterial()),
    anim: (c, s) => {
      healthVariant(c, s);
      c.setPowered(s.powered);
      cloakAnim(c, s, 1);
    },
  });
}

function hexPts(rad: number): [number, number][] {
  const p: [number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    p.push([Math.cos(a) * rad, Math.sin(a) * rad]);
  }
  return p;
}

function cloakAnim(c: Ctx, s: ModelAnimState, size: number): void {
  fxTime(s.time);
  const k = Math.min(1, Math.max(0, s.cloak ?? 0));
  const cl = c.n['fx:cloak'];
  if (!cl) return;
  cl.visible = k > 0.02;
  if (cl.visible) {
    const b = 1 + 0.03 * Math.sin(s.time * 2.3) * size;
    cl.scale.set(b * (0.85 + 0.15 * k), (0.85 + 0.15 * k) * (2 - b), b * (0.85 + 0.15 * k));
  }
}

// =============================================================================================
// Mines (structures, 1x1, no slab): AT = wide pressure disc, AP = small canister with prongs
// =============================================================================================

const DIRT: Mat = { c: 0x4a3b28, m: 0, r: 1, d: 1 };

function mine(at: boolean): ModelTemplate {
  const r = new NB('root');
  // disturbed earth patch where it was buried
  r.add(lathe([[at ? 0.2 : 0.13, 0], [at ? 0.15 : 0.1, 0.01], [0, 0.014]], 10), DIRT, { s: [1, 1, 0.85] });
  if (at) {
    r.cyl(MINE_OLIVE, 0.11, 0.12, 0.035, 0, 0.022, 0, { seg: 14 });
    r.cyl(M.oliveDark, 0.095, 0.1, 0.01, 0, 0.044, 0, { seg: 14 });
    r.cyl(M.dark, 0.035, 0.04, 0.012, 0, 0.052, 0, { seg: 10 });
    r.cyl(M.steel, 0.012, 0.012, 0.008, 0, 0.061, 0, { seg: 6 });
    r.add(new THREE.TorusGeometry(0.03, 0.005, 4, 8, Math.PI), M.dark, { p: [0.11, 0.035, 0], r: [0, Math.PI / 2, 0] });
    r.box(M.yellow, 0.05, 0.003, 0.012, -0.05, 0.05, 0.05, { b: 0, r: [0, 0.6, 0] });
    r.sph(G.red, 0.008, 0.06, 0.05, -0.05, { seg: 4, slot: 'glow:arm' });
    // dirt half-covering one side
    r.add(new THREE.IcosahedronGeometry(0.05, 0), DIRT, { p: [-0.1, 0.012, 0.06], s: [1.4, 0.4, 1] });
  } else {
    r.cyl(M.oliveDark, 0.04, 0.045, 0.05, 0, 0.022, 0, { seg: 10 });
    r.cyl(MINE_OLIVE, 0.042, 0.042, 0.012, 0, 0.04, 0, { seg: 10 });
    r.cyl(M.dark, 0.012, 0.014, 0.02, 0, 0.055, 0, { seg: 6 });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      pipe(r, [Math.cos(a) * 0.006, 0.06, Math.sin(a) * 0.006], [Math.cos(a) * 0.022, 0.1, Math.sin(a) * 0.022], 0.0025, M.steel, 3);
    }
    // tripwire stakes
    for (const a of [0.4, 2.6]) {
      const x = Math.cos(a) * 0.22;
      const z = Math.sin(a) * 0.22;
      r.cyl(M.wood, 0.004, 0.004, 0.05, x, 0.025, z, { seg: 3 });
      pipe(r, [0, 0.07, 0], [x, 0.04, z], 0.0012, M.steel, 3);
    }
    r.sph(G.red, 0.006, 0.03, 0.048, 0.03, { seg: 4, slot: 'glow:arm' });
  }
  const cl = r.node('cloak', [0, 0, 0]);
  cl.add(new THREE.SphereGeometry(at ? 0.17 : 0.12, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), M.dark, { s: [1, 0.5, 1], slot: 'fx:add:66ccff:0.4' });

  return makeTemplate({
    root: r,
    height: 0.12,
    radius: at ? 0.2 : 0.16,
    muzzles: [],
    glow: { glow: 2, 'glow:arm': 3 },
    init: (c) => swapFx(c, 'cloak', cloakMaterial()),
    anim: (c, s) => {
      if (c.v.seed === undefined) c.v.seed = Math.random() * 3;
      c.setGlow('glow:arm', blink(s.time + c.v.seed, 2.4, 0.1) ? 1 : 0.05);
      cloakAnim(c, s, 0.6);
    },
  });
}

export const SUPPORT_BUILDERS: Record<string, () => ModelTemplate> = {
  gap: gapGenerator,
  hbox: camoPillbox,
  minv: () => mine(true),
  minp: () => mine(false),
};
