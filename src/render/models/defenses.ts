/**
 * Defensive structures. Centred on footprint, ground y=0, front toward +Z.
 * Turreted defenses (gun, agun, sam) expose `turret` (rotates about Y, barrel along local +X).
 */
import * as THREE from 'three';
import { NB, makeTemplate, type AnimFn, type Ctx, type ModelTemplate } from './builder';
import type { ModelAnimState } from './types';
import { M, G, alliedStar, barrel, foundation, hazard, lathe, prismXY, prismXZ, ringGeo, sandbags, sovietStar, faceRot, pipe, antenna } from './parts';
import { blink, dtOf, healthVariant, recoil } from './anim';

const AO = { h: 0.25, min: 0.52 };

function root(sx: number, sz: number): NB {
  const r = new NB('root');
  r.ao = AO;
  foundation(r, sx, sz, 0.04, 0.05, M.concreteDark);
  return r;
}

function dAnim(extra?: (c: Ctx, s: ModelAnimState) => void): AnimFn {
  return (c, s) => {
    healthVariant(c, s);
    if (c.v.seed === undefined) c.v.seed = Math.random() * 3;
    c.setPowered(s.powered);
    c.setGlow('glow:blink', s.powered ? (blink(s.time + c.v.seed, 1.4, 0.3) ? 1 : 0.06) : 0.04);
    extra?.(c, s);
  };
}

function polygon(n: number, rad: number, rot = 0): [number, number][] {
  const p: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rot;
    p.push([Math.cos(a) * rad, Math.sin(a) * rad]);
  }
  return p;
}

// =============================================================================================
// Pillbox (Allied, 1x1)
// =============================================================================================

function pillbox(): ModelTemplate {
  const r = root(1, 1);
  const y0 = 0.04;
  r.add(prismXZ(polygon(6, 0.4, Math.PI / 6), 0.22, 0.04), M.concrete, { p: [0, y0, 0] });
  r.add(prismXZ(polygon(6, 0.34, Math.PI / 6), 0.06, 0.03), M.concreteLight, { p: [0, y0 + 0.22, 0] });
  r.add(prismXZ(polygon(6, 0.22, Math.PI / 6), 0.03, 0.01), M.team, { p: [0, y0 + 0.28, 0] });
  // gun slits on every face, glowing faintly inside
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const x = Math.cos(a) * 0.335;
    const z = Math.sin(a) * 0.335;
    r.box(M.darker, 0.03, 0.035, 0.16, x, y0 + 0.15, z, { b: 0, r: [0, -a, 0] });
    r.box(G.warm, 0.01, 0.012, 0.12, x * 0.97, y0 + 0.15, z * 0.97, { b: 0, r: [0, -a, 0], slot: 'glow' });
  }
  // MG barrel out of the front-right slit
  r.cyl(M.dark, 0.008, 0.008, 0.16, 0.37, y0 + 0.15, 0.0, { r: [0, 0, -Math.PI / 2], seg: 6 });
  r.cyl(M.dark, 0.012, 0.012, 0.03, 0.44, y0 + 0.15, 0.0, { r: [0, 0, -Math.PI / 2], seg: 6 });
  // sandbags around the back
  sandbags(r, 0.4, 1, [-0.3, y0, -0.36], [0, 0.6, 0]);
  sandbags(r, 0.36, 1, [0.32, y0, -0.36], [0, -0.6, 0]);
  alliedStar(r, 0.06, [0, y0 + 0.31, 0]);
  r.node('m0', [0.3, y0 + 0.15, 0]);

  return makeTemplate({ root: r, height: 0.4, radius: 0.5, muzzles: ['m0'], glow: { glow: 2 }, anim: dAnim() });
}

// =============================================================================================
// Gun turret (Allied, 1x1)
// =============================================================================================

function gunTurret(): ModelTemplate {
  const r = root(1, 1);
  const y0 = 0.04;
  r.add(prismXZ(polygon(8, 0.42, Math.PI / 8), 0.18, 0.035), M.concrete, { p: [0, y0, 0] });
  r.add(prismXZ(polygon(8, 0.34, Math.PI / 8), 0.06, 0.02), M.gun, { p: [0, y0 + 0.18, 0] });
  hazard(r, 0.3, 0.035, [0, y0 + 0.1, 0.39], [0, 0, 0]);
  r.cyl(M.dark, 0.22, 0.24, 0.03, 0, y0 + 0.255, 0, { seg: 20 });
  const t = r.node('turret', [0, y0 + 0.27, 0]);
  t.add(
    prismXZ(
      [
        [0.2, -0.1],
        [0.2, 0.1],
        [0.08, 0.2],
        [-0.16, 0.2],
        [-0.24, 0.12],
        [-0.24, -0.12],
        [-0.16, -0.2],
        [0.08, -0.2],
      ],
      0.13,
      0.025,
    ),
    M.team,
  );
  t.add(
    prismXZ(
      [
        [0.1, -0.12],
        [0.1, 0.12],
        [-0.14, 0.13],
        [-0.18, 0.08],
        [-0.18, -0.08],
        [-0.14, -0.13],
      ],
      0.03,
      0.01,
    ),
    M.teamDark,
    { p: [0, 0.13, 0] },
  );
  t.box(M.gun, 0.07, 0.08, 0.12, 0.21, 0.065, 0, { b: 0.015 });
  t.cyl(M.dark, 0.035, 0.035, 0.015, -0.08, 0.165, 0.06, { seg: 10 });
  t.box(M.glass, 0.03, 0.02, 0.05, 0.05, 0.155, -0.08, { b: 0.004 });
  alliedStar(t, 0.04, [-0.06, 0.161, -0.04]);
  const b0 = t.node('b0', [0.23, 0.065, 0]);
  barrel(b0, 0.38, 0.02, { brake: true });
  t.node('m0', [0.62, 0.065, 0]);
  r.sph(G.red, 0.015, -0.32, y0 + 0.2, 0.2, { seg: 6, slot: 'glow:blink' });

  return makeTemplate({
    root: r,
    height: 0.5,
    radius: 0.5,
    turret: 'turret',
    muzzles: ['m0'],
    glow: { glow: 2, 'glow:blink': 4 },
    anim: dAnim((c, s) => recoil(c, s, ['b0'], 0.07)),
  });
}

// =============================================================================================
// AA gun (Allied, 1x1) — twin elevated barrels
// =============================================================================================

function aaGun(): ModelTemplate {
  const r = root(1, 1);
  const y0 = 0.04;
  // circular revetment
  r.add(ringGeo(0.32, 0.43, 0.14, 24), M.concrete, { p: [0, y0 + 0.07, 0] });
  r.add(ringGeo(0.415, 0.435, 0.03, 24), M.team, { p: [0, y0 + 0.125, 0] });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    r.box(M.sand, 0.09, 0.035, 0.05, Math.cos(a) * 0.375, y0 + 0.158, Math.sin(a) * 0.375, { b: 0.014, r: [0, -a + Math.PI / 2, 0] });
  }
  r.cyl(M.dark, 0.3, 0.3, 0.02, 0, y0 + 0.01, 0, { seg: 24 });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    r.box(M.olive, 0.08, 0.05, 0.06, Math.cos(a) * 0.22, y0 + 0.045, Math.sin(a) * 0.22, { b: 0.01, r: [0, -a, 0] });
  }
  const t = r.node('turret', [0, y0 + 0.05, 0]);
  t.cyl(M.gun, 0.2, 0.22, 0.06, 0, 0.03, 0, { seg: 16 });
  t.box(M.team, 0.18, 0.15, 0.26, -0.03, 0.135, 0, { b: 0.025 });
  t.box(M.teamDark, 0.03, 0.16, 0.3, 0.07, 0.17, 0, { b: 0.01 });
  // gunner seat + sight
  t.box(M.dark, 0.05, 0.04, 0.05, -0.1, 0.2, 0.14, { b: 0.01 });
  t.box(M.dark, 0.02, 0.06, 0.02, -0.05, 0.25, 0.14, { b: 0.004 });
  const e = t.node('elev', [0.02, 0.18, 0], [0, 0, 0.95]);
  e.box(M.gun, 0.12, 0.06, 0.16, 0.0, 0, 0, { b: 0.015 });
  for (const [i, z] of [
    [0, -0.055],
    [1, 0.055],
  ] as const) {
    const b = e.node(`b${i}`, [0.04, 0.0, z]);
    barrel(b, 0.36, 0.015, { brake: true });
    e.node(`m${i}`, [0.42, 0, z]);
  }
  // ammo feed boxes
  t.box(M.oliveDark, 0.06, 0.06, 0.05, -0.04, 0.09, -0.15, { b: 0.008 });
  t.box(M.oliveDark, 0.06, 0.06, 0.05, -0.04, 0.09, 0.15, { b: 0.008 });
  r.sph(G.red, 0.014, 0.3, y0 + 0.17, -0.3, { seg: 6, slot: 'glow:blink' });

  return makeTemplate({
    root: r,
    height: 0.6,
    radius: 0.5,
    turret: 'turret',
    muzzles: ['m0', 'm1'],
    glow: { 'glow:blink': 4 },
    anim: dAnim((c, s) => recoil(c, s, ['b0', 'b1'], 0.05)),
  });
}

// =============================================================================================
// Flame tower (Soviet, 1x1)
// =============================================================================================

function flameTower(): ModelTemplate {
  const r = root(1, 1);
  const y0 = 0.04;
  r.add(
    lathe(
      [
        [0.36, 0],
        [0.34, 0.12],
        [0.27, 0.36],
        [0.25, 0.44],
        [0.0, 0.44],
      ],
      8,
    ),
    M.concrete,
    { p: [0, y0, 0] },
  );
  r.add(ringGeo(0.25, 0.3, 0.05, 8), M.team, { p: [0, y0 + 0.42, 0] });
  r.add(ringGeo(0.33, 0.37, 0.04, 8), M.team, { p: [0, y0 + 0.08, 0] });
  // fuel tanks strapped to the sides
  for (const [x, z] of [
    [-0.3, -0.12],
    [-0.12, -0.3],
  ]) {
    r.cyl(M.red, 0.07, 0.07, 0.28, x, y0 + 0.16, z, { seg: 12 });
    r.sph(M.red, 0.07, x, y0 + 0.3, z, { seg: 12 });
    r.add(ringGeo(0.07, 0.075, 0.02, 12), M.dark, { p: [x, y0 + 0.1, z] });
    r.add(ringGeo(0.07, 0.075, 0.02, 12), M.dark, { p: [x, y0 + 0.22, z] });
  }
  pipe(r, [-0.3, y0 + 0.36, -0.12], [-0.12, y0 + 0.46, -0.05], 0.015, M.steel);
  pipe(r, [-0.12, y0 + 0.36, -0.3], [-0.05, y0 + 0.46, -0.12], 0.015, M.steel);
  hazard(r, 0.3, 0.04, [0, y0 + 0.2, 0.3], [-0.2, 0, 0]);
  // nozzle head
  r.cyl(M.gun, 0.16, 0.2, 0.08, 0, y0 + 0.48, 0, { seg: 12 });
  r.add(lathe([[0.16, 0], [0.13, 0.08], [0.06, 0.13], [0.0, 0.14]], 12), M.dark, { p: [0, y0 + 0.52, 0] });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const x = Math.cos(a);
    const z = Math.sin(a);
    r.cyl(M.dark, 0.022, 0.03, 0.12, x * 0.17, y0 + 0.56, z * 0.17, { r: [z * 0.9, 0, -x * 0.9], seg: 8 });
    r.sph(G.fire, 0.016, x * 0.22, y0 + 0.6, z * 0.22, { seg: 6, slot: 'glow:pilot' });
  }
  // vent slots glowing
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    r.box(G.fire, 0.05, 0.02, 0.008, Math.cos(a) * 0.2, y0 + 0.48, Math.sin(a) * 0.2, { b: 0, r: [0, -a + Math.PI / 2, 0], slot: 'glow:pilot' });
  }
  sovietStar(r, 0.07, [0, y0 + 0.28, 0.315], [-0.32, 0, 0]);
  r.node('m0', [0, y0 + 0.66, 0]);

  return makeTemplate({
    root: r,
    height: 0.75,
    radius: 0.5,
    muzzles: ['m0'],
    glow: { 'glow:pilot': 3 },
    anim: dAnim((c, s) => {
      const flick = 0.75 + 0.25 * Math.sin(s.time * 13 + c.v.seed) * Math.sin(s.time * 7.3);
      c.setGlow('glow:pilot', (s.health < 0.25 ? 0.4 : 1) * (flick + s.firing * 1.5));
    }),
  });
}

// =============================================================================================
// Tesla coil (Soviet, 1x2) — tall coil with glowing orb
// =============================================================================================

function teslaCoil(): ModelTemplate {
  const r = root(1, 2);
  const y0 = 0.04;
  const tz = -0.28;
  // concrete plinth
  r.add(prismXZ(polygon(8, 0.42, Math.PI / 8), 0.12, 0.03), M.concrete, { p: [0, y0, tz] });
  r.add(ringGeo(0.35, 0.4, 0.02, 8), M.team, { p: [0, y0 + 0.12, tz] });
  // lattice legs (pyramid frame)
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const x = Math.cos(a);
    const z = Math.sin(a);
    pipe(r, [x * 0.3, y0 + 0.12, tz + z * 0.3], [x * 0.1, y0 + 0.9, tz + z * 0.1], 0.022, M.dark, 6);
  }
  // central coil column: copper windings as alternating bands
  r.cyl(M.dark, 0.11, 0.13, 0.5, 0, y0 + 0.37, tz, { seg: 8 });
  for (let i = 0; i < 7; i++) {
    r.cyl(i % 2 ? M.dark : M.copper, 0.09, 0.09, 0.15, 0, y0 + 0.66 + i * 0.15, tz, { seg: 8, open: true });
  }
  // stacked coil rings (decreasing radius)
  const rings: [number, number][] = [
    [0.8, 0.3],
    [1.06, 0.26],
    [1.3, 0.22],
    [1.52, 0.185],
    [1.72, 0.15],
  ];
  for (const [h, rad] of rings) {
    r.add(new THREE.TorusGeometry(rad, 0.03, 4, 12), M.gun, { p: [0, y0 + h, tz], r: [Math.PI / 2, 0, Math.PI / 12] });
    r.add(new THREE.RingGeometry(rad - 0.012, rad + 0.012, 12), M.team, { p: [0, y0 + h + 0.031, tz], r: [-Math.PI / 2, 0, 0] });
    r.box(M.dark, rad * 2 - 0.05, 0.012, 0.012, 0, y0 + h, tz, { b: 0, r: [0, Math.PI / 4, 0] });
    r.box(M.dark, rad * 2 - 0.05, 0.012, 0.012, 0, y0 + h, tz, { b: 0, r: [0, -Math.PI / 4, 0] });
    r.add(new THREE.TorusGeometry(rad - 0.004, 0.009, 3, 12), G.tesla, { p: [0, y0 + h - 0.028, tz], r: [Math.PI / 2, 0, Math.PI / 12], slot: 'glow:coil' });
  }
  // top cap + orb
  r.add(lathe([[0.1, 0], [0.13, 0.04], [0.09, 0.09], [0.0, 0.1]], 16), M.gun, { p: [0, y0 + 1.78, tz] });
  r.add(new THREE.IcosahedronGeometry(0.15, 1), G.tesla, { p: [0, y0 + 2.02, tz], slot: 'glow:orb' });
  const halo = r.node('halo', [0, y0 + 2.02, tz]);
  halo.add(new THREE.PlaneGeometry(0.75, 0.75), M.dark, { slot: 'fx:add:5aa2ff:0.9', keepUv: true, r: [-Math.PI / 2, 0, 0] });
  r.node('m0', [0, y0 + 2.02, tz]);
  // generator / capacitor bank at the front
  const gz = 0.52;
  r.box(M.concreteLight, 0.6, 0.24, 0.56, 0, y0 + 0.12, gz, { b: 0.02 });
  r.box(M.team, 0.63, 0.04, 0.59, 0, y0 + 0.25, gz, { b: 0.012 });
  for (let i = 0; i < 3; i++) {
    const x = -0.18 + i * 0.18;
    r.cyl(M.offwhite, 0.04, 0.05, 0.05, x, y0 + 0.29, gz - 0.1, { seg: 10 });
    r.cyl(M.offwhite, 0.03, 0.036, 0.07, x, y0 + 0.35, gz - 0.1, { seg: 6 });
    r.box(G.tesla, 0.1, 0.06, 0.006, x, y0 + 0.14, gz + 0.283, { b: 0, slot: 'glow:coil' });
    r.box(M.dark, 0.12, 0.08, 0.008, x, y0 + 0.14, gz + 0.279, { b: 0 });
  }
  pipe(r, [0, y0 + 0.27, gz - 0.25], [0, y0 + 0.5, tz + 0.1], 0.02, M.dark, 6);
  pipe(r, [-0.18, y0 + 0.4, gz - 0.1], [-0.05, y0 + 0.85, tz + 0.05], 0.006, M.copper, 4);
  pipe(r, [0.18, y0 + 0.4, gz - 0.1], [0.05, y0 + 0.85, tz + 0.05], 0.006, M.copper, 4);
  hazard(r, 0.5, 0.04, [0, y0 + 0.04, gz + 0.283]);
  sovietStar(r, 0.07, [0.0, y0 + 0.271, gz + 0.12]);

  return makeTemplate({
    root: r,
    height: 2.2,
    radius: 0.75,
    muzzles: ['m0'],
    glow: { 'glow:orb': 3.6, 'glow:coil': 3 },
    anim: dAnim((c, s) => {
      const ch = Math.min(1, Math.max(0, s.charge));
      const crackle = 0.85 + 0.15 * Math.sin(s.time * 31 + c.v.seed) * Math.sin(s.time * 17);
      const k = s.powered ? (0.35 + 0.65 * ch + s.firing * 0.8) * crackle : 0.05;
      c.setGlow('glow:orb', k);
      c.setGlow('glow:coil', s.powered ? 0.3 + 0.7 * ch : 0.03);
      const h = c.n.halo;
      h.visible = s.powered;
      h.scale.setScalar(0.45 + 0.4 * ch + s.firing * 0.5);
    }),
  });
}

// =============================================================================================
// SAM site (Soviet, 2x1)
// =============================================================================================

function samMissile(nb: NB, z: number): void {
  nb.cyl(M.offwhite, 0.028, 0.028, 0.42, 0.21, 0.0, z, { r: [0, 0, -Math.PI / 2], seg: 10 });
  nb.add(lathe([[0.028, 0], [0.022, 0.05], [0.0, 0.1]], 10), M.red, { p: [0.42, 0, z], r: [0, 0, -Math.PI / 2] });
  nb.add(new THREE.CylinderGeometry(0.0285, 0.0285, 0.03, 10), M.team, { p: [0.3, 0, z], r: [0, 0, -Math.PI / 2] });
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    nb.add(
      prismXY(
        [
          [0.0, 0.0],
          [0.07, 0.0],
          [0.02, 0.05],
          [0.0, 0.05],
        ],
        0.004,
        0,
      ),
      M.dark,
      { p: [0.0, 0, z], r: [a, 0, 0] },
    );
    nb.add(
      prismXY(
        [
          [0.3, 0.0],
          [0.34, 0.0],
          [0.32, 0.03],
          [0.3, 0.03],
        ],
        0.004,
        0,
      ),
      M.dark,
      { p: [0.0, 0, z], r: [a, 0, 0] },
    );
  }
}

function samSite(): ModelTemplate {
  const r = root(2, 1);
  const y0 = 0.04;
  // revetment walls
  r.box(M.concrete, 1.7, 0.12, 0.08, 0, y0 + 0.06, -0.36, { b: 0.02 });
  r.box(M.concrete, 0.08, 0.12, 0.72, -0.86, y0 + 0.06, 0, { b: 0.02 });
  r.box(M.concrete, 0.08, 0.12, 0.72, 0.86, y0 + 0.06, 0, { b: 0.02 });
  r.box(M.concrete, 0.5, 0.12, 0.08, -0.6, y0 + 0.06, 0.36, { b: 0.02 });
  r.box(M.concrete, 0.5, 0.12, 0.08, 0.6, y0 + 0.06, 0.36, { b: 0.02 });
  hazard(r, 0.5, 0.04, [-0.6, y0 + 0.08, 0.402]);
  hazard(r, 0.5, 0.04, [0.6, y0 + 0.08, 0.402]);
  // radar van (right)
  r.box(M.teamDark, 0.28, 0.18, 0.36, 0.6, y0 + 0.09, -0.12, { b: 0.015 });
  const radar = r.node('radar', [0.6, y0 + 0.18, -0.12]);
  radar.cyl(M.dark, 0.01, 0.01, 0.06, 0, 0.03, 0, { seg: 6 });
  radar.box(M.gun, 0.03, 0.12, 0.2, 0.0, 0.1, 0, { b: 0.006, r: [0, 0, 0.3] });
  antenna(r, 0.7, y0 + 0.18, -0.25, 0.22);
  // spare missiles crate (left)
  r.box(M.olive, 0.42, 0.08, 0.2, -0.55, y0 + 0.04, -0.15, { b: 0.012 });
  sovietStar(r, 0.05, [-0.55, y0 + 0.082, -0.15]);
  // launcher turret
  r.cyl(M.dark, 0.2, 0.22, 0.04, 0, y0 + 0.02, 0, { seg: 18 });
  const t = r.node('turret', [0, y0 + 0.04, 0]);
  t.cyl(M.gun, 0.16, 0.18, 0.08, 0, 0.04, 0, { seg: 16 });
  t.box(M.team, 0.22, 0.12, 0.2, -0.04, 0.13, 0, { b: 0.02 });
  t.box(M.teamDark, 0.06, 0.18, 0.04, 0.0, 0.2, -0.12, { b: 0.01 });
  t.box(M.teamDark, 0.06, 0.18, 0.04, 0.0, 0.2, 0.12, { b: 0.01 });
  const e = t.node('elev', [0.0, 0.26, 0], [0, 0, 0.55]);
  e.box(M.gun, 0.46, 0.02, 0.24, 0.12, -0.03, 0, { b: 0.006 });
  e.box(M.dark, 0.06, 0.06, 0.26, -0.02, 0, 0, { b: 0.01 });
  for (const [i, z] of [
    [0, -0.075],
    [1, 0.075],
  ] as const) {
    const ms = e.node(`ms${i}`, [-0.06, 0.012, 0]);
    samMissile(ms, z);
    e.node(`m${i}`, [0.46, 0.012, z]);
  }
  r.sph(G.red, 0.014, -0.86, y0 + 0.14, -0.36, { seg: 6, slot: 'glow:blink' });

  return makeTemplate({
    root: r,
    height: 0.6,
    radius: 1.0,
    turret: 'turret',
    muzzles: ['m0', 'm1'],
    glow: { 'glow:blink': 4 },
    anim: dAnim((c, s) => {
      if (s.powered) c.n.radar.rotation.y += dtOf(s) * 2;
      // fired missile disappears briefly (reload)
      for (let i = 0; i < 2; i++) {
        const key = `hide${i}`;
        if (s.firing > 0.6 && s.firingMuzzle % 2 === i) c.v[key] = 1.2;
        c.v[key] = Math.max(0, (c.v[key] ?? 0) - dtOf(s));
        c.show(`ms${i}`, c.v[key] <= 0);
      }
    }),
  });
}

export const DEFENSE_BUILDERS: Record<string, () => ModelTemplate> = {
  pbox: pillbox,
  gun: gunTurret,
  agun: aaGun,
  ftur: flameTower,
  tsla: teslaCoil,
  sam: samSite,
};

void faceRot;
