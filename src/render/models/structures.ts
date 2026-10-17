/**
 * Base structures. Centred on their footprint, fronts/doors facing +Z, ground at y=0.
 * Every structure sits on a concrete slab reaching from y=-0.15 to y≈0.04.
 */
import * as THREE from 'three';
import { NB, boxGeo, makeTemplate, type AnimFn, type Ctx, type Mat, type ModelFaction, type ModelTemplate, type V3 } from './builder';
import type { ModelAnimState } from './types';
import {
  M,
  G,
  S,
  FSTYLE,
  type Fac,
  type FStyle,
  acUnit,
  alliedStar,
  antenna,
  banner,
  catwalk,
  chimney,
  corrugated,
  crateStack,
  dish,
  drums,
  eagleGeo,
  emblem,
  faceRot,
  floodlight,
  foundation,
  grille,
  hazard,
  ladder,
  lamp,
  lampPost,
  lathe,
  lightRing,
  parapet,
  pipe,
  pipeRun,
  prismXY,
  prismXZ,
  radioMast,
  railLine,
  ribs,
  ringGeo,
  roofVent,
  sandbags,
  shade,
  sloganBoard,
  sovietStar,
  stairs,
  starGeo,
  stencilText,
  stencilTextGeo,
  stowage,
  warnLight,
  windows,
  discGeo,
  mergeChild,
  orePile,
  rivets,
  stencilNumber,
  trefoil,
} from './parts';
import { approach, blink, dtOf, healthVariant } from './anim';
import { setBodyTime } from './materials';

const STRUCT_AO = { h: 0.32, min: 0.52 };

/**
 * Types shared by both sides that are built once per faction (Soviet / Allied dressing): their
 * builders receive the owner's faction and models/index.ts caches one template per faction. Units join
 * through registerFactionDressed() (or by adding to the set) at module load.
 */
export const FACTION_DRESSED = new Set(['fact', 'powr', 'apwr', 'proc', 'silo', 'weap', 'dome', 'fix', 'hpad', 'mslo']);

/** Mark more type ids as faction-dressed (call at module load, before any model is created). */
export function registerFactionDressed(...ids: string[]): void {
  for (const id of ids) FACTION_DRESSED.add(id);
}

function root(sx: number, sz: number, slab: Mat = M.concrete): NB {
  const r = new NB('root');
  r.ao = STRUCT_AO;
  r.snow = 1; // structures collect the full snow cover in winter
  r.cavity = true;
  foundation(r, sx, sz, 0.04, 0.05, slab);
  return r;
}

/** Common structure animation: damage scorch, powered glow, blinking beacons. */
function sAnim(extra?: (c: Ctx, s: ModelAnimState, pw: number) => void): AnimFn {
  return (c, s) => {
    healthVariant(c, s);
    setBodyTime(s.time); // baked light animation clock (idempotent; previews have no destruction system)
    if (c.v.seed === undefined) c.v.seed = Math.random() * 3;
    const pw = s.powered ? 1 : 0.1;
    c.setPowered(s.powered);
    c.setGlow('glow:blink', s.powered ? (blink(s.time + c.v.seed, 1.6, 0.3) ? 1 : 0.06) : 0.04);
    extra?.(c, s, pw);
  };
}

/** Beacon: small post with a blinking light (baked into the body: no extra draw call). */
function beacon(nb: NB, p: V3, glow: { glow: number } = G.red, h = 0.05): void {
  nb.cyl(M.dark, 0.008, 0.01, h, p[0], p[1] + h / 2, p[2], { seg: 6 });
  warnLight(nb, [p[0], p[1] + h + 0.012, p[2]], false, 0.016, { glow: glow.glow, i: 2.2 });
}

// ---------------------------------------------------------------------------------------------
// building blocks
// ---------------------------------------------------------------------------------------------

interface BlockOpts {
  /** steel panel band below the cornice (Soviet: dark steel, Allied: cladding) */
  band?: boolean;
  /** team-colour cornice trim */
  trim?: boolean;
  /** roof: 'flat' (tar / steel with a parapet), 'none' */
  roof?: 'flat' | 'none';
  /** wall material override */
  wall?: Mat;
  /** plinth height */
  plinth?: number;
  /** vertical ribs on the front face (count) */
  ribs?: number;
}

/**
 * Building block centred at (x, z) on the slab: plinth, walls, steel band, team cornice, roof + parapet.
 * Returns the roof top y.
 */
function block(nb: NB, fs: FStyle, x: number, z: number, w: number, d: number, h: number, o: BlockOpts = {}): number {
  const y0 = 0.04;
  const wall = o.wall ?? fs.wall;
  const ph = o.plinth ?? 0.08;
  nb.box(fs.wallDark, w + 0.035, ph, d + 0.035, x, y0 + ph / 2, z, { b: 0.012 });
  nb.box(wall, w, h, d, x, y0 + h / 2, z, { b: 0.02 });
  if (o.band !== false) {
    const bh = Math.min(0.14, h * 0.2);
    nb.box(fs.steel, w + 0.014, bh, d + 0.014, x, y0 + h - bh / 2 - 0.035, z, { b: 0.008 });
  }
  if (o.trim !== false) nb.box(M.team, w + 0.03, 0.03, d + 0.03, x, y0 + h - 0.02, z, { b: 0.01 });
  if (o.ribs) ribs(nb, fs.wallDark, x - w / 2 + 0.06, x + w / 2 - 0.06, y0 + ph, h - ph - 0.05, z + d / 2, o.ribs, 0.035, 0.02);
  if (o.roof !== 'none') {
    nb.box(fs.roof, w - 0.03, 0.02, d - 0.03, x, y0 + h + 0.005, z, { b: 0.004 });
    parapet(nb, fs.wallDark, w + 0.02, d + 0.02, y0 + h - 0.005, x, z, 0.05, 0.03);
  }
  return y0 + h + 0.015;
}

/** Recessed doorway facing +Z after rotY at (x, z) on the wall plane zf: frame, dark door, lamp above. */
function doorway(nb: NB, fs: FStyle, x: number, zf: number, w: number, h: number, rotY = 0): void {
  const y0 = 0.04;
  const n = new NB('_door', [x, 0, zf], [0, rotY, 0]);
  n.box(fs.wallDark, w + 0.07, h + 0.05, 0.03, 0, y0 + (h + 0.05) / 2, 0.012, { b: 0.008 });
  n.box(M.darker, w, h, 0.02, 0, y0 + h / 2, 0.02, { b: 0 });
  n.box(fs.steel, w * 0.46, h * 0.94, 0.012, -w * 0.25, y0 + h * 0.47, 0.03, { b: 0.003 });
  n.box(fs.steel, w * 0.46, h * 0.94, 0.012, w * 0.25, y0 + h * 0.47, 0.03, { b: 0.003 });
  n.box(M.concreteDark, w + 0.12, 0.02, 0.1, 0, y0 + 0.01, 0.06, { b: 0.004 });
  n.box(M.team, w + 0.1, 0.02, 0.06, 0, y0 + h + 0.06, 0.03, { b: 0.005 });
  n.box(M.dark, 0.05, 0.02, 0.05, 0, y0 + h + 0.095, 0.05, { b: 0 });
  n.add(new THREE.OctahedronGeometry(0.014, 0), fs.fac === 'soviet' ? { glow: 0xffb050, i: 2 } : { glow: 0xf4f0ff, i: 2 }, { p: [0, y0 + h + 0.08, 0.06] });
  mergeChild(nb, n);
}

/** Window row with frames and sills on a +Z wall plane (after rotY), centred at x on wall z. */
function winRow(nb: NB, fs: FStyle, n: number, w: number, h: number, gap: number, x: number, y: number, z: number, rotY = 0, lit: number[] | null = null): void {
  const g = new NB('_wr', [x, y, z], [0, rotY, 0]);
  windows(g, n, w, h, gap, [0, 0, 0.002], [0, 0, 0], fs.win, 'glow', lit);
  const total = n * w + (n - 1) * gap;
  g.box(fs.wallDark, total + 0.04, 0.014, 0.025, 0, -h / 2 - 0.012, 0.01, { b: 0.003 });
  mergeChild(nb, g);
}

/** Corner warning lights on top of a block (Soviet red blinkers, Allied white strobes on two corners). */
function cornerLights(nb: NB, fs: FStyle, x: number, z: number, w: number, d: number, y: number): void {
  const pts: [number, number][] = fs.fac === 'soviet' ? [[-1, -1], [1, -1], [-1, 1], [1, 1]] : [[-1, 1], [1, -1]];
  for (const [sx, sz] of pts) warnLight(nb, [x + sx * (w / 2 - 0.02), y + 0.075, z + sz * (d / 2 - 0.02)], false, 0.016, fs.fac === 'soviet' ? undefined : { glow: 0xf0f4ff, i: 2.4 });
}

/** Electrical transformer with cooling fins and insulators at (x, z). */
function transformer(nb: NB, x: number, z: number, rotY = 0): void {
  const y0 = 0.04;
  const n = new NB('_tr', [x, 0, z], [0, rotY, 0]);
  n.box(M.concreteDark, 0.22, 0.03, 0.26, 0, y0 + 0.015, 0, { b: 0.006 });
  n.box(M.oliveDark, 0.15, 0.2, 0.19, 0, y0 + 0.13, 0, { b: 0.012 });
  for (let k = 0; k < 4; k++) n.box(M.dark, 0.17, 0.15, 0.008, 0, y0 + 0.12, -0.07 + k * 0.047, { b: 0 });
  for (const dz of [-0.05, 0.05]) {
    for (let k = 0; k < 3; k++) n.cyl(M.offwhite, 0.016, 0.016, 0.012, 0, y0 + 0.24 + k * 0.016, dz, { seg: 6 });
    n.cyl(M.copper, 0.004, 0.004, 0.04, 0, y0 + 0.3, dz, { seg: 3 });
  }
  hazard(n, 0.12, 0.03, [0, y0 + 0.1, 0.096]);
  mergeChild(nb, n);
}

/** Small lattice power pylon with crossarms and insulators at (x, z). */
function pylon(nb: NB, x: number, z: number, h: number, rotY = 0): void {
  const y0 = 0.04;
  const n = new NB('_py', [x, 0, z], [0, rotY, 0]);
  const b = 0.07;
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) pipe(n, [b * sx, y0, b * sz], [0.02 * sx, y0 + h, 0.02 * sz], 0.006, M.gun, 4);
  for (let k = 1; k <= 3; k++) {
    const y = y0 + (h * k) / 4;
    const w = b - (b - 0.02) * (k / 4);
    n.box(M.gun, w * 2, 0.006, 0.006, 0, y, w, { b: 0 });
    n.box(M.gun, w * 2, 0.006, 0.006, 0, y, -w, { b: 0 });
  }
  for (const y of [y0 + h * 0.82, y0 + h]) {
    n.box(M.gun, 0.26, 0.012, 0.012, 0, y, 0, { b: 0 });
    for (const s of [-1, 1]) n.cyl(M.offwhite, 0.008, 0.008, 0.04, s * 0.12, y - 0.025, 0, { seg: 5 });
  }
  mergeChild(nb, n);
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

function constructionYard(fac: Fac = 'soviet'): ModelTemplate {
  const fs = FSTYLE[fac];
  const sov = fac === 'soviet';
  const r = root(3, 3, sov ? M.concreteDark : M.concrete);
  const y0 = 0.04;
  // ---- front yard: apron, hazard lanes, building materials
  r.box(M.asphalt, 2.1, 0.012, 1.15, -0.3, y0 + 0.006, 0.72, { b: 0 });
  for (let i = 0; i < 5; i++) r.box(M.yellow, 0.16, 0.004, 0.035, -1.15 + i * 0.4, y0 + 0.014, 0.18, { b: 0 });
  hazard(r, 2.0, 0.05, [-0.3, y0 + 0.014, 1.3], [-Math.PI / 2, 0, 0]);
  for (let i = 0; i < 3; i++) r.box(M.steel, 0.5, 0.025, 0.04, -0.1, y0 + 0.024 + i * 0.026, 1.0 + (i % 2) * 0.05, { b: 0.004 });
  r.box(M.rubber, 0.52, 0.02, 0.2, -0.1, y0 + 0.01, 1.03, { b: 0 });
  for (let i = 0; i < 3; i++) r.box(fs.wallDark, 0.34, 0.03, 0.22, 0.42, y0 + 0.015 + i * 0.032, 1.02, { b: 0.006, r: [0, i * 0.08, 0] });
  crateStack(r, 0.38, y0, 0.66, 0.11, 3, 0.2);
  drums(r, -0.55, y0, 1.1, 4);
  // a prefab module going up on the apron: steel frame, first wall panels, scaffold planks
  {
    const sx = -0.36;
    const sz = 0.56;
    r.box(fs.wallDark, 0.56, 0.04, 0.5, sx, y0 + 0.02, sz, { b: 0.008 });
    for (const [dx, dz] of [[-0.25, -0.22], [0.25, -0.22], [-0.25, 0.22], [0.25, 0.22]]) r.box(fs.steel, 0.03, 0.46, 0.03, sx + dx, y0 + 0.27, sz + dz, { b: 0.004 });
    for (const y of [0.25, 0.48]) {
      r.box(M.yellow, 0.53, 0.025, 0.025, sx, y0 + y, sz - 0.22, { b: 0.004 });
      r.box(M.yellow, 0.53, 0.025, 0.025, sx, y0 + y, sz + 0.22, { b: 0.004 });
      r.box(M.yellow, 0.025, 0.025, 0.47, sx - 0.25, y0 + y, sz, { b: 0.004 });
      r.box(M.yellow, 0.025, 0.025, 0.47, sx + 0.25, y0 + y, sz, { b: 0.004 });
    }
    r.box(fs.wall, 0.48, 0.21, 0.035, sx, y0 + 0.14, sz - 0.22, { b: 0.006 });
    r.box(fs.wall, 0.035, 0.21, 0.42, sx - 0.25, y0 + 0.14, sz, { b: 0.006 });
    r.box(fs.wall, 0.24, 0.2, 0.035, sx - 0.12, y0 + 0.36, sz - 0.22, { b: 0.006 });
    r.box(M.wood, 0.56, 0.012, 0.09, sx, y0 + 0.265, sz + 0.27, { b: 0 });
    for (const dx of [-0.27, 0.27]) r.box(M.steel, 0.012, 0.28, 0.012, sx + dx, y0 + 0.14, sz + 0.31, { b: 0 });
    ladder(r, 0.27, [sx + 0.2, y0, sz + 0.32], 0);
    warnLight(r, [sx + 0.25, y0 + 0.52, sz + 0.22], false, 0.014, { glow: 0xffa020, i: 2.2 });
  }
  // ---- assembly hall (back left), sawtooth north-light roof
  const hx = -0.48;
  const hz = -0.75;
  const hw = 1.8;
  const hd = 1.26;
  const hh = 0.92;
  block(r, fs, hx, hz, hw, hd, hh, { roof: 'none' });
  const rt = y0 + hh;
  r.box(fs.roof, hw - 0.02, 0.02, hd - 0.02, hx, rt + 0.01, hz, { b: 0.004 });
  for (let i = 0; i < 4; i++) {
    const x = hx - hw / 2 + 0.24 + i * 0.44;
    r.add(prismXY([[-0.22, 0], [0.22, 0], [0.12, 0.2], [0.1, 0.2]], hd - 0.1, 0.012), fs.roof, { p: [x, rt + 0.02, hz] });
    r.box(M.glassBlue, 0.02, 0.17, hd - 0.16, x + 0.17, rt + 0.11, hz, { b: 0, r: [0, 0, 0.78] });
    r.box(M.team, 0.025, 0.025, hd - 0.08, x + 0.11, rt + 0.225, hz, { b: 0.006 });
  }
  parapet(r, fs.wallDark, hw + 0.02, hd + 0.02, rt - 0.01, hx, hz, 0.05, 0.03);
  const fz = hz + hd / 2;
  // big assembly door with a hazard frame
  const dx = -0.78;
  const dw = 0.78;
  const dh = 0.64;
  r.box(M.darker, dw, dh, 0.02, dx, y0 + dh / 2, fz + 0.004, { b: 0 });
  for (let i = 0; i < 10; i++) r.box(fs.steel, dw - 0.02, 0.05, 0.02, dx, y0 + 0.04 + i * 0.062, fz + 0.012, { b: 0.004 });
  r.box(fs.wallDark, dw + 0.12, 0.07, 0.06, dx, y0 + dh + 0.035, fz + 0.02, { b: 0.01 });
  for (const s of [-1, 1]) r.box(fs.wallDark, 0.06, dh, 0.06, dx + s * (dw / 2 + 0.03), y0 + dh / 2, fz + 0.02, { b: 0.01 });
  hazard(r, dw + 0.12, 0.045, [dx, y0 + dh + 0.035, fz + 0.052]);
  for (const s of [-1, 1]) hazard(r, dh, 0.045, [dx + s * (dw / 2 + 0.03), y0 + dh / 2, fz + 0.052], [0, 0, Math.PI / 2]);
  warnLight(r, [dx - dw / 2 - 0.03, y0 + dh + 0.1, fz + 0.04], false, 0.018, { glow: 0xffa020, i: 2.2 });
  warnLight(r, [dx + dw / 2 + 0.03, y0 + dh + 0.1, fz + 0.04], false, 0.018, { glow: 0xffa020, i: 2.2 });
  // facade right of the door: slogan, banners, windows
  if (sov) {
    sloganBoard(r, fac, '', 0.72, 0.28, [0.04, y0 + 0.66, fz + 0.012], 0, true, ['BUILD FOR', 'VICTORY']);
    banner(r, fac, 0.2, 0.5, [-1.3, y0 + hh - 0.06, fz + 0.012], 0);
  } else {
    sloganBoard(r, fac, 'ALLIED ENGINEERS', 0.74, 0.16, [0.04, y0 + 0.72, fz + 0.012], 0, true);
    banner(r, fac, 0.2, 0.48, [-1.3, y0 + hh - 0.06, fz + 0.012], 0);
    hazard(r, 0.8, 0.045, [0.02, y0 + 0.11, fz + 0.02]);
  }
  winRow(r, fs, 4, 0.1, 0.09, 0.06, 0.04, y0 + 0.4, fz, 0, [0, 2, 3]);
  doorway(r, fs, 0.3, fz, 0.16, 0.24);
  // roof clutter on the hall
  acUnit(r, hx + 0.62, rt + 0.02, hz - 0.45, 0, 1);
  roofVent(r, hx - 0.66, rt + 0.02, hz - 0.5, 0.04);
  r.node('steam0', [hx - 0.66, rt + 0.12, hz - 0.5]);
  r.box(fs.steel, 0.24, 0.12, 0.2, hx - 0.18, rt + 0.08, hz - 0.5, { b: 0.012 });
  // ---- command tower (back right): the landmark
  const tx = 1.0;
  const tz = -0.86;
  const tw = 0.66;
  const th = 1.22;
  block(r, fs, tx, tz, tw, tw, th, { roof: 'none', ribs: 3 });
  // control room with a glass band, overhanging roof, mast, dish, lights
  const cy = y0 + th;
  r.box(fs.steel, tw + 0.1, 0.05, tw + 0.1, tx, cy + 0.025, tz, { b: 0.012 });
  r.box(M.glassBlue, tw + 0.02, 0.18, tw + 0.02, tx, cy + 0.14, tz, { b: 0.01 });
  windows(r, 4, 0.12, 0.13, 0.03, [tx, cy + 0.14, tz + tw / 2 + 0.012], [0, 0, 0], fs.win, 'glow', [0, 1, 3]);
  windows(r, 4, 0.12, 0.13, 0.03, [tx - tw / 2 - 0.012, cy + 0.14, tz], [0, -Math.PI / 2, 0], fs.win, 'glow', [1, 2]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) r.box(fs.steel, 0.025, 0.2, 0.025, tx + sx * (tw / 2 + 0.01), cy + 0.14, tz + sz * (tw / 2 + 0.01), { b: 0 });
  r.box(fs.roof, tw + 0.14, 0.04, tw + 0.14, tx, cy + 0.25, tz, { b: 0.012 });
  r.box(M.team, tw + 0.15, 0.022, tw + 0.15, tx, cy + 0.235, tz, { b: 0.006 });
  radioMast(r, tx + 0.18, cy + 0.27, tz - 0.16, 0.42);
  dish(r, tx - 0.15, cy + 0.27, tz - 0.1, 0.1, 0.6, 0.6);
  acUnit(r, tx - 0.12, cy + 0.27, tz + 0.18, 0.4, 0.75);
  cornerLights(r, fs, tx, tz, tw + 0.12, tw + 0.12, cy + 0.2);
  if (sov) {
    emblem(r, fac, 0.15, [tx, y0 + 0.98, tz + tw / 2 + 0.014]);
    banner(r, fac, 0.22, 0.56, [tx, y0 + 0.8, tz + tw / 2 + 0.012], 0);
  } else {
    emblem(r, fac, 0.13, [tx, y0 + 0.96, tz + tw / 2 + 0.014]);
    floodlight(r, [tx - 0.2, cy + 0.27, tz + tw / 2 + 0.04], 0, 0.9);
    floodlight(r, [tx + 0.2, cy + 0.27, tz + tw / 2 + 0.04], 0, 0.9);
  }
  winRow(r, fs, 2, 0.08, 0.09, 0.14, tx, y0 + 0.4, tz + tw / 2, 0, [1]);
  ladder(r, th, [tx + tw / 2 + 0.03, y0, tz + 0.12], Math.PI / 2);
  // ---- vehicle bay annex (right front) with a roller door, catwalk and stair
  const ax = 1.0;
  const az = 0.06;
  const atop = block(r, fs, ax, az, 0.68, 0.62, 0.48);
  r.box(M.darker, 0.36, 0.3, 0.02, ax - 0.08, y0 + 0.15, az + 0.312, { b: 0 });
  for (let i = 0; i < 6; i++) r.box(fs.steel, 0.34, 0.035, 0.02, ax - 0.08, y0 + 0.03 + i * 0.05, az + 0.32, { b: 0 });
  hazard(r, 0.4, 0.035, [ax - 0.08, y0 + 0.33, az + 0.322]);
  stencilNumber(r, '01', [ax + 0.22, y0 + 0.36, az + 0.312], [0, 0, 0], 0.07, S.stencilYellow);
  acUnit(r, ax - 0.12, atop, az - 0.08, 0, 0.9);
  roofVent(r, ax + 0.2, atop, az + 0.14, 0.035);
  crateStack(r, ax + 0.18, atop, az - 0.15, 0.07, 2, 0.5);
  stairs(r, 0.44, y0, az + 0.16, 0.21, 0.46, 0.09, 0, fs.steel);
  catwalk(r, tx, y0 + 0.5, tz + tw / 2 + 0.05, tw - 0.04, 0.09, 0, fs.rail);
  pipeRun(r, [[0.36, y0 + 0.62, hz + 0.3], [0.67, y0 + 0.62, hz + 0.3], [0.67, y0 + 0.62, az - 0.31]], 0.03, fs.steelLight);
  // ---- crane tower (front left) with an animated jib
  const cx = -1.02;
  const cz = 0.6;
  r.box(M.concreteDark, 0.3, 0.06, 0.3, cx, y0 + 0.03, cz, { b: 0.01 });
  const ch = 1.12;
  for (const [ddx, ddz] of [[-0.07, -0.07], [0.07, -0.07], [-0.07, 0.07], [0.07, 0.07]]) {
    r.box(M.yellow, 0.025, ch, 0.025, cx + ddx, y0 + 0.06 + ch / 2, cz + ddz, { b: 0.004 });
  }
  for (let i = 0; i < 9; i++) {
    const y = y0 + 0.1 + i * 0.12;
    const a = i % 2 ? 0.6 : -0.6;
    r.box(M.yellow, 0.14, 0.012, 0.012, cx, y, cz - 0.07, { b: 0, r: [0, 0, a] });
    r.box(M.yellow, 0.14, 0.012, 0.012, cx, y, cz + 0.07, { b: 0, r: [0, 0, a] });
    r.box(M.yellow, 0.012, 0.012, 0.14, cx - 0.07, y, cz, { b: 0, r: [a, 0, 0] });
    r.box(M.yellow, 0.012, 0.012, 0.14, cx + 0.07, y, cz, { b: 0, r: [a, 0, 0] });
  }
  const crane = r.node('crane', [cx, y0 + 0.06 + ch, cz], [0, 0.6, 0]);
  crane.box(M.yellow, 0.18, 0.1, 0.18, 0, 0.05, 0, { b: 0.012 });
  crane.box(M.glassBlue, 0.08, 0.06, 0.1, 0.06, 0.06, 0.1, { b: 0.008 });
  const jl = 1.3;
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
  warnLight(crane, [0, 0.33, 0], false, 0.014);
  warnLight(crane, [jl, 0.14, 0], false, 0.012);
  crane.box(M.dark, 0.05, 0.02, 0.08, 0.95, 0.09, 0, { b: 0.004 });
  crane.cyl(M.steel, 0.003, 0.003, 0.5, 0.95, -0.16, 0, { seg: 4 });
  crane.box(M.dark, 0.03, 0.04, 0.03, 0.95, -0.42, 0, { b: 0.006 });
  crane.box(fs.wallDark, 0.26, 0.05, 0.1, 0.95, -0.47, 0, { b: 0.008 });
  // ---- perimeter: lamp posts, sandbags
  lampPost(r, 1.36, y0, 1.32, 0.42, -Math.PI / 2);
  lampPost(r, -1.38, y0, 1.32, 0.42, Math.PI / 2);
  if (sov) sandbags(r, 0.45, 2, [0.98, y0, 1.25]);
  else floodlight(r, [0.62, y0 + 0.02, 1.3], Math.PI, 0.3, 0.05);
  rivets(r, [hx - hw / 2, y0 + hh - 0.06, fz + 0.012], [hx + hw / 2, y0 + hh - 0.06, fz + 0.012], 20, 0.006);

  return makeTemplate({
    root: r,
    height: 1.7,
    radius: 1.55,
    muzzles: [],
    fx: { steam: ['steam0'] },
    glow: { glow: 1.6 },
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

function powerPlant(fac: Fac = 'soviet'): ModelTemplate {
  const fs = FSTYLE[fac];
  const sov = fac === 'soviet';
  const r = root(2, 2, sov ? M.concreteDark : M.concrete);
  const y0 = 0.04;
  // ---- turbine hall across the front: the slogan facade faces the camera
  const hx = -0.08;
  const hz = 0.3;
  const hw = 1.62;
  const hd = 0.66;
  const hh = 0.64;
  const top = block(r, fs, hx, hz, hw, hd, hh);
  const fz = hz + hd / 2;
  if (sov) {
    banner(r, fac, 0.22, 0.46, [hx - hw / 2 + 0.17, y0 + hh - 0.06, fz + 0.012], 0);
    sloganBoard(r, fac, '', 0.92, 0.3, [hx - 0.06, y0 + 0.43, fz + 0.012], 0, true, ['POWER', 'OUR STRENGTH']);
  } else {
    banner(r, fac, 0.22, 0.44, [hx - hw / 2 + 0.17, y0 + hh - 0.06, fz + 0.012], 0);
    sloganBoard(r, fac, 'POWER STATION', 0.86, 0.18, [hx - 0.06, y0 + 0.47, fz + 0.012], 0, true);
    hazard(r, hw - 0.1, 0.05, [hx, y0 + 0.11, fz + 0.022]);
  }
  winRow(r, fs, 4, 0.09, 0.08, 0.06, hx - 0.06, y0 + 0.18, fz, 0, [0, 1, 3]);
  doorway(r, fs, hx + 0.6, fz, 0.2, 0.26);
  winRow(r, fs, 1, 0.1, 0.08, 0.05, hx + 0.6, y0 + 0.46, fz, 0);
  // side wall: turbine glow vents (pulse in the shader)
  for (let i = 0; i < 3; i++) {
    r.box(M.darker, 0.02, 0.05, 0.13, hx + hw / 2 + 0.006, y0 + 0.2, hz - 0.18 + i * 0.18, { b: 0 });
    r.box({ glow: 0xff6a1a, i: 1.6, a: 2 + i * 0.2 }, 0.012, 0.03, 0.11, hx + hw / 2 + 0.012, y0 + 0.2, hz - 0.18 + i * 0.18, { b: 0 });
  }
  cornerLights(r, fs, hx, hz, hw, hd, top - 0.015);
  // roof: turbine housing, vents, AC, steam relief valves
  r.add(new THREE.CylinderGeometry(0.12, 0.12, 0.62, 12, 1, false, 0, Math.PI), fs.steelLight, { p: [hx - 0.18, top, hz - 0.04], r: [0, 0, Math.PI / 2] });
  for (const dx of [-0.24, -0.08, 0.08, 0.24]) r.box(M.dark, 0.012, 0.125, 0.25, hx - 0.18 + dx, top + 0.06, hz - 0.04, { b: 0 });
  r.box(fs.steel, 0.3, 0.14, 0.24, hx + 0.48, top + 0.07, hz - 0.06, { b: 0.014 });
  grille(r, 0.24, 0.18, [hx + 0.48, top + 0.143, hz - 0.06], 4);
  acUnit(r, hx + 0.2, top, hz + 0.18, 0.1);
  acUnit(r, hx - 0.62, top, hz + 0.16, -0.15, 0.9);
  roofVent(r, hx - 0.62, top, hz - 0.14, 0.035);
  r.cyl(M.steel, 0.012, 0.012, 0.09, hx + 0.05, top + 0.045, hz - 0.2, { seg: 6 });
  r.cyl(M.red, 0.02, 0.02, 0.012, hx + 0.05, top + 0.06, hz - 0.2, { seg: 6 });
  r.node('steam0', [hx + 0.05, top + 0.1, hz - 0.2]);
  r.node('steam1', [hx + 0.48, top + 0.18, hz - 0.06]);
  // ---- boiler house behind the hall (taller, steel clad); the stacks rise from it
  const bx = -0.36;
  const bz = -0.47;
  const bw = 1.04;
  const bd = 0.76;
  const btop = block(r, fs, bx, bz, bw, bd, 0.98, { wall: fs.steel, band: false });
  ribs(r, fs.steelLight, bx - bw / 2 + 0.05, bx + bw / 2 - 0.05, y0 + 0.1, 0.82, bz + bd / 2, 8, 0.02, 0.012);
  winRow(r, fs, 3, 0.07, 0.07, 0.08, bx + 0.22, y0 + 0.86, bz + bd / 2 + 0.005, 0, [1]);
  catwalk(r, bx + 0.05, y0 + 0.72, bz + bd / 2 + 0.05, bw - 0.1, 0.09, 0, fs.rail);
  ladder(r, 0.7, [bx + bw / 2 + 0.03, y0, bz + 0.1], Math.PI / 2);
  // ---- stacks (the landmark: tall, banded, red crowned, smoking)
  const sm: Mat = sov ? S.sovSteelLight : { c: 0xa6a299, m: 0, r: 0.88, d: 1 };
  chimney(r, 'smoke0', bx - 0.27, bz - 0.12, btop - 0.02, 0.86, 0.165, 0.12, fac, sm);
  chimney(r, 'smoke1', bx + 0.25, bz - 0.14, btop - 0.02, 0.7, 0.15, 0.11, fac, sm);
  if (sov) banner(r, fac, 0.2, 0.36, [bx - 0.02, btop - 0.06, bz + bd / 2 + 0.012], 0);
  else emblem(r, fac, 0.13, [bx - 0.02, btop - 0.17, bz + bd / 2 + 0.012], [0, 0, 0], true);
  // ---- transformer yard (back right): transformers, fence, pylon, cables into the hall
  transformer(r, 0.5, -0.66, 0);
  transformer(r, 0.76, -0.66, 0);
  pylon(r, 0.64, -0.3, 0.6);
  for (const x of [0.5, 0.76]) pipe(r, [x, y0 + 0.31, -0.62], [0.64, y0 + 0.6, -0.3], 0.004, M.dark, 3);
  pipe(r, [0.64, y0 + 0.6, -0.3], [0.5, y0 + hh - 0.05, hz - hd / 2], 0.004, M.dark, 3);
  railLine(r, [0.3, y0, -0.9], [0.9, y0, -0.9], 0.1, fs.rail);
  railLine(r, [0.9, y0, -0.9], [0.9, y0, -0.1], 0.1, fs.rail);
  // feed pipes from the boiler into the hall
  pipeRun(r, [[bx + bw / 2, y0 + 0.5, bz + 0.1], [0.3, y0 + 0.5, bz + 0.1], [0.3, y0 + 0.5, hz - hd / 2]], 0.035, sov ? S.rust : M.steel);
  pipeRun(r, [[bx + bw / 2, y0 + 0.36, bz - 0.15], [0.24, y0 + 0.36, bz - 0.15], [0.24, y0 + 0.36, hz - hd / 2]], 0.028, fs.steelLight);
  // ---- yard clutter
  drums(r, 0.8, y0, 0.78, 3);
  crateStack(r, -0.84, y0, 0.82, 0.08, 2, 0.3);
  if (!sov) {
    floodlight(r, [hx + hw / 2 - 0.05, top + 0.04, fz - 0.03], 0, 0.85);
    floodlight(r, [hx - hw / 2 + 0.05, top + 0.04, fz - 0.03], 0, 0.85);
  }
  lampPost(r, 0.36, y0, 0.86, 0.38, 0);
  rivets(r, [hx - hw / 2, top - 0.06, fz + 0.012], [hx + hw / 2, top - 0.06, fz + 0.012], 18, 0.006);
  stencilNumber(r, '1', [hx + 0.6, y0 + 0.58, fz + 0.004], [0, 0, 0], 0.07);

  return makeTemplate({
    root: r,
    height: 1.55,
    radius: 1.05,
    muzzles: [],
    smoke: ['smoke0', 'smoke1'],
    fx: { steam: ['steam0', 'steam1'] },
    glow: { glow: 1.6 },
    anim: sAnim(),
  });
}

// =============================================================================================
// Advanced power plant (3x3)
// =============================================================================================

function coolingTower(nb: NB, fs: FStyle, name: string, x: number, z: number, y0: number, h: number, rb: number): void {
  const mat: Mat = fs.fac === 'soviet' ? { c: 0x98948c, m: 0, r: 0.92, d: 1, uv: 1.4 } : { c: 0xc4c0b6, m: 0, r: 0.9, d: 1, uv: 1.4 };
  // hyperboloid shell
  nb.add(lathe([[rb, 0], [rb * 0.86, h * 0.25], [rb * 0.7, h * 0.6], [rb * 0.68, h * 0.75], [rb * 0.72, h * 0.95], [rb * 0.74, h]], 24), mat, { p: [x, y0, z] });
  // inner wall (visible over the rim), rim, water basin glimpse
  nb.add(new THREE.LatheGeometry([new THREE.Vector2(rb * 0.735, h), new THREE.Vector2(rb * 0.7, h * 0.82)], 20), M.dark, { p: [x, y0, z] });
  nb.add(ringGeo(rb * 0.68, rb * 0.77, 0.03, 24), fs.wallDark, { p: [x, y0 + h, z] });
  nb.add(discGeo(rb * 0.7, 0.01, 24), M.darker, { p: [x, y0 + h - 0.12, z] });
  // painted bands: team colour near the top, a hazard-red/white band for aviation (Soviet red, Allied white)
  nb.add(ringGeo(rb * 0.705, rb * 0.735, 0.07, 24), M.team, { p: [x, y0 + h * 0.86, z] });
  nb.add(ringGeo(rb * 0.69, rb * 0.71, 0.03, 24), fs.fac === 'soviet' ? S.signRed : M.white, { p: [x, y0 + h * 0.74, z] });
  // stilts at the base with dark air inlets between them
  nb.add(new THREE.CylinderGeometry(rb * 0.99, rb * 1.0, 0.1, 24, 1, true), M.darker, { p: [x, y0 + 0.05, z] });
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    nb.box(fs.wallDark, 0.035, 0.11, 0.035, x + Math.cos(a) * rb * 1.0, y0 + 0.055, z + Math.sin(a) * rb * 1.0, { b: 0, r: [0, -a, 0] });
  }
  // service ladder and the rim lights
  ladder(nb, h * 0.95, [x, y0 + 0.1, z + rb * 0.84], 0);
  if (fs.fac === 'soviet') lightRing(nb, x, y0 + h + 0.03, z, rb * 0.76, 8);
  else for (const a of [0.8, 3.9]) warnLight(nb, [x + Math.cos(a) * rb * 0.76, y0 + h + 0.04, z + Math.sin(a) * rb * 0.76], false, 0.018, { glow: 0xff3020, i: 2.2 });
  nb.node(name, [x, y0 + h, z]);
}

function advPowerPlant(fac: Fac = 'soviet'): ModelTemplate {
  const fs = FSTYLE[fac];
  const sov = fac === 'soviet';
  const r = root(3, 3, sov ? M.concreteDark : M.concrete);
  const y0 = 0.04;
  coolingTower(r, fs, 'smoke0', -0.74, -0.7, y0, 1.42, 0.56);
  coolingTower(r, fs, 'smoke1', 0.66, -0.82, y0, 1.18, 0.48);
  stencilText(r, '1', [-0.74, y0 + 0.7, -0.7 + 0.43], [-0.15, 0, 0], 0.16, sov ? S.stencilWhite : M.dark);
  // ---- reactor containment (front left)
  const rx = -0.66;
  const rz = 0.62;
  r.cyl(fs.wallDark, 0.52, 0.54, 0.08, rx, y0 + 0.04, rz, { seg: 28 });
  r.cyl(fs.wall, 0.47, 0.49, 0.38, rx, y0 + 0.27, rz, { seg: 28 });
  r.add(new THREE.SphereGeometry(0.47, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2), sov ? M.offwhite : M.white, { p: [rx, y0 + 0.46, rz] });
  r.add(ringGeo(0.47, 0.5, 0.04, 28), M.team, { p: [rx, y0 + 0.44, rz] });
  r.add(ringGeo(0.0, 0.11, 0.03, 16), M.gun, { p: [rx, y0 + 0.94, rz] });
  r.cyl(M.gun, 0.05, 0.06, 0.1, rx, y0 + 0.99, rz, { seg: 8 });
  warnLight(r, [rx, y0 + 1.06, rz], false, 0.018);
  // ring catwalk around the dome base
  r.add(ringGeo(0.48, 0.56, 0.012, 24), S.grating, { p: [rx, y0 + 0.47, rz] });
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    r.add(boxGeo(0.007, 0.06, 0.007, 0), fs.rail, { p: [rx + Math.cos(a) * 0.555, y0 + 0.5, rz + Math.sin(a) * 0.555], lod: 0 });
  }
  r.add(new THREE.TorusGeometry(0.555, 0.004, 3, 24), fs.rail, { p: [rx, y0 + 0.53, rz], r: [Math.PI / 2, 0, 0], lod: 0 });
  // coolant glow ports (pulse in the shader) and a trefoil
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.3;
    r.box(M.darker, 0.05, 0.12, 0.012, rx + Math.cos(a) * 0.485, y0 + 0.25, rz + Math.sin(a) * 0.485, { r: [0, -a + Math.PI / 2, 0], b: 0 });
    r.box({ glow: 0x4ad8ff, i: 1.8, a: 2 + i * 0.1 }, 0.036, 0.1, 0.008, rx + Math.cos(a) * 0.492, y0 + 0.25, rz + Math.sin(a) * 0.492, { r: [0, -a + Math.PI / 2, 0], b: 0 });
  }
  trefoilSign(r, 0.07, [rx + 0.18, y0 + 0.3, rz + 0.45], [0, 0.4, 0]);
  // ---- turbine / control hall (front right)
  const bx = 0.62;
  const bz = 0.5;
  const top = block(r, fs, bx, bz, 0.98, 0.84, 0.56, { ribs: 4 });
  const fz = bz + 0.42;
  if (sov) sloganBoard(r, fac, '', 0.7, 0.2, [bx - 0.05, y0 + 0.4, fz + 0.012], 0, true, ['ATOMIC', 'POWER']);
  else sloganBoard(r, fac, 'REACTOR 2', 0.64, 0.12, [bx - 0.05, y0 + 0.44, fz + 0.012], 0, true);
  winRow(r, fs, 4, 0.09, 0.08, 0.05, bx - 0.08, y0 + 0.2, fz, 0, [0, 1, 3]);
  doorway(r, fs, bx + 0.36, fz, 0.14, 0.22);
  cornerLights(r, fs, bx, bz, 0.98, 0.84, top - 0.015);
  acUnit(r, bx + 0.25, top, bz - 0.15, 0, 1);
  acUnit(r, bx - 0.05, top, bz - 0.15, 0, 1);
  r.box(fs.steel, 0.24, 0.14, 0.22, bx - 0.3, top + 0.07, bz + 0.1, { b: 0.012 });
  r.node('steam0', [bx - 0.3, top + 0.16, bz + 0.1]);
  r.node('steam1', [rx + 0.15, y0 + 1.0, rz - 0.1]);
  // ---- pipes between reactor, hall and towers; coolant channel
  pipeRun(r, [[rx + 0.48, y0 + 0.24, rz - 0.06], [bx - 0.5, y0 + 0.24, bz - 0.06]], 0.045, sov ? S.rust : M.steel);
  pipeRun(r, [[rx + 0.42, y0 + 0.13, rz - 0.26], [bx - 0.5, y0 + 0.13, bz - 0.26]], 0.035, fs.steelLight);
  pipeRun(r, [[bx, y0 + 0.2, bz - 0.42], [bx, y0 + 0.2, -0.32], [0.66, y0 + 0.2, -0.32]], 0.04, fs.steelLight);
  pipeRun(r, [[rx, y0 + 0.3, rz - 0.5], [rx, y0 + 0.3, -0.12]], 0.04, fs.steelLight);
  r.box(M.darker, 0.12, 0.02, 0.9, 0.0, y0 + 0.01, 0.05, { b: 0 });
  r.box({ glow: 0x4ad8ff, i: 1.6, a: 2 }, 0.08, 0.004, 0.86, 0.0, y0 + 0.021, 0.05, { b: 0 });
  // transformers + pylon along the right edge
  transformer(r, 1.22, -0.2, Math.PI / 2);
  transformer(r, 1.22, 0.16, Math.PI / 2);
  pylon(r, 1.25, 1.18, 0.7);
  if (sov) {
    banner(r, fac, 0.2, 0.42, [bx - 0.42, y0 + 0.54, fz + 0.012], 0);
  } else {
    floodlight(r, [bx + 0.45, top + 0.04, fz - 0.03], 0, 0.9);
    hazard(r, 0.9, 0.04, [bx, y0 + 0.1, fz + 0.022]);
  }
  drums(r, -0.05, y0, 1.18, 3);
  crateStack(r, 0.12, y0, 0.86, 0.08, 2, 0.4);
  lampPost(r, 1.36, y0, 1.36, 0.42, -Math.PI / 2);

  return makeTemplate({
    root: r,
    height: 1.6,
    radius: 1.55,
    muzzles: [],
    smoke: ['smoke0', 'smoke1'],
    fx: { steam: ['steam0', 'steam1'] },
    glow: { glow: 1.6 },
    anim: sAnim(),
  });
}

/** Radiation warning sign (trefoil) standing on a vertical face facing +Z after r. */
function trefoilSign(nb: NB, size: number, p: V3, r: V3): void {
  const n = new NB('_trs', p, r);
  n.box(M.dark, size * 2.3, size * 2.3, 0.01, 0, 0, 0, { b: 0 });
  const t = new NB('_trf', [0, 0, 0.006], [Math.PI / 2, 0, 0]);
  trefoil(t, size, [0, 0, 0]);
  mergeChild(n, t);
  mergeChild(nb, n);
}

// =============================================================================================
// Ore refinery (3x3) — dock at front centre (+Z)
// =============================================================================================

/** Tall storage silo with a ribbed shell, conical cap, team band, ring catwalk and ladder. */
function storageSilo(nb: NB, fs: FStyle, x: number, z: number, rad: number, h: number, y0 = 0.04): number {
  nb.cyl(fs.wallDark, rad + 0.04, rad + 0.05, 0.08, x, y0 + 0.04, z, { seg: 16 });
  nb.cyl(fs.fac === 'soviet' ? S.sovSteelLight : M.offwhite, rad, rad, h, x, y0 + h / 2 + 0.06, z, { seg: 16 });
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + 0.2;
    nb.box(fs.steel, 0.02, h - 0.06, 0.02, x + Math.cos(a) * (rad + 0.006), y0 + h / 2 + 0.06, z + Math.sin(a) * (rad + 0.006), { b: 0, r: [0, -a, 0] });
  }
  for (const f of [0.3, 0.62]) nb.cyl(M.dark, rad + 0.012, rad + 0.012, 0.02, x, y0 + 0.06 + h * f, z, { seg: 16 });
  nb.cyl(M.team, rad + 0.014, rad + 0.014, 0.07, x, y0 + 0.06 + h * 0.82, z, { seg: 16 });
  const top = y0 + 0.06 + h;
  nb.add(lathe([[rad + 0.02, 0], [rad * 0.8, 0.07], [rad * 0.3, 0.15], [0.0, 0.17]], 16), fs.steel, { p: [x, top, z] });
  nb.cyl(M.gun, 0.05, 0.05, 0.06, x, top + 0.18, z, { seg: 8 });
  // ring catwalk + railing just under the cap
  nb.add(ringGeo(rad, rad + 0.08, 0.012, 16), S.grating, { p: [x, top - 0.03, z] });
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    nb.box(fs.rail, 0.007, 0.07, 0.007, x + Math.cos(a) * (rad + 0.075), top + 0.005, z + Math.sin(a) * (rad + 0.075), { b: 0 });
  }
  nb.add(new THREE.TorusGeometry(rad + 0.075, 0.004, 3, 16), fs.rail, { p: [x, top + 0.04, z], r: [Math.PI / 2, 0, 0] });
  ladder(nb, h, [x + rad * 0.72, y0 + 0.06, z + rad * 0.72], Math.PI / 4);
  return top;
}

function refinery(fac: Fac = 'soviet'): ModelTemplate {
  const fs = FSTYLE[fac];
  const sov = fac === 'soviet';
  const r = root(3, 3, sov ? M.concreteDark : M.concrete);
  const y0 = 0.04;
  // ---- dock pad (front centre lane, spills toward the dock cell)
  r.box(M.asphalt, 0.95, 0.03, 1.22, 0, y0 + 0.012, 0.86, { b: 0.01 });
  hazard(r, 1.2, 0.05, [-0.475, y0 + 0.03, 0.86], [-Math.PI / 2, 0, Math.PI / 2]);
  hazard(r, 1.2, 0.05, [0.475, y0 + 0.03, 0.86], [-Math.PI / 2, 0, Math.PI / 2]);
  for (let i = 0; i < 4; i++) {
    r.box(M.yellow, 0.3, 0.004, 0.04, 0, y0 + 0.03, 0.45 + i * 0.25, { b: 0 });
    lamp(r, G.green, [-0.43, y0 + 0.05, 0.4 + i * 0.3], 0.014, 'glow:dock');
    lamp(r, G.green, [0.43, y0 + 0.05, 0.4 + i * 0.3], 0.014, 'glow:dock');
  }
  // ---- processing hall (back centre), its intake faces the dock
  const hz = -0.66;
  const hw = 1.26;
  const hd = 1.42;
  const hh = 1.02;
  const top = block(r, fs, 0, hz, hw, hd, hh, { ribs: 0 });
  const fz = hz + hd / 2;
  r.add(prismXY([[0.0, 0.18], [0.36, 0.4], [0.36, 0.52], [0.0, 0.52]], 0.62, 0.02), fs.steel, { p: [0, y0, fz - 0.02], r: [0, -Math.PI / 2, 0] });
  r.box(M.darker, 0.5, 0.3, 0.02, 0, y0 + 0.2, fz + 0.005, { b: 0 });
  r.box(G.fire, 0.42, 0.05, 0.01, 0, y0 + 0.1, fz + 0.016, { b: 0, slot: 'glow:proc' });
  hazard(r, 0.62, 0.05, [0, y0 + 0.37, fz + 0.022]);
  for (let i = 0; i < 5; i++) {
    const roll = r.node(`roll${i}`, [0, y0 + 0.05, fz + 0.05 + i * 0.07]);
    roll.cyl(M.steel, 0.02, 0.02, 0.4, 0, 0, 0, { r: [0, 0, Math.PI / 2], seg: 8 });
    roll.box(M.dark, 0.4, 0.008, 0.006, 0, 0.018, 0, { b: 0 });
  }
  if (sov) {
    sloganBoard(r, fac, '', 0.82, 0.26, [0, y0 + 0.78, fz + 0.012], 0, true, ['ORE FOR THE', 'MOTHERLAND']);
    banner(r, fac, 0.16, 0.5, [-0.52, y0 + hh - 0.06, fz + 0.012], 0);
    banner(r, fac, 0.16, 0.5, [0.52, y0 + hh - 0.06, fz + 0.012], 0);
  } else {
    sloganBoard(r, fac, 'ORE PROCESSING', 0.84, 0.15, [0, y0 + 0.8, fz + 0.012], 0, true);
    winRow(r, fs, 2, 0.08, 0.1, 0.72, 0, y0 + 0.66, fz, 0);
    floodlight(r, [-0.5, y0 + hh + 0.03, fz - 0.02], 0, 0.95);
    floodlight(r, [0.5, y0 + hh + 0.03, fz - 0.02], 0, 0.95);
  }
  cornerLights(r, fs, 0, hz, hw, hd, top - 0.015);
  // roof: crusher house, vents, steam
  r.box(fs.steel, 0.5, 0.22, 0.44, -0.2, top + 0.11, hz - 0.25, { b: 0.015 });
  r.box(fs.roof, 0.54, 0.02, 0.48, -0.2, top + 0.23, hz - 0.25, { b: 0.004 });
  grille(r, 0.3, 0.2, [-0.2, top + 0.245, hz - 0.25], 4);
  acUnit(r, 0.32, top, hz + 0.35, 0, 1);
  roofVent(r, 0.36, top, hz - 0.45, 0.04);
  roofVent(r, 0.2, top, hz - 0.1, 0.035);
  r.node('steam1', [-0.2, top + 0.27, hz - 0.25]);
  // ---- silos (left) with a conveyor gallery onto the hall roof
  const sx = -1.06;
  const st1 = storageSilo(r, fs, sx, -1.0, 0.27, 1.22);
  storageSilo(r, fs, sx, -0.36, 0.25, 1.05);
  r.box(fs.steel, 0.62, 0.09, 0.12, (sx + 0.27 - 0.63) / 2 - 0.01, st1 - 0.12, -0.84, { b: 0.01, r: [0, 0, -0.18] });
  for (const z of [-1.0, -0.36]) pipeRun(r, [[sx + 0.25, y0 + 0.24, z], [-0.63, y0 + 0.24, z]], 0.035, sov ? S.rust : M.steel);
  if (sov) emblem(r, fac, 0.09, [sx, y0 + 0.5, -0.36 + 0.256], [0, 0, 0]);
  else stencilText(r, 'ORE', [sx, y0 + 0.5, -0.36 + 0.256], [0, 0, 0], 0.07, S.stencilYellow);
  // ---- processing tower + stack (right back) with furnace glow
  const tx = 1.0;
  const tz = -0.88;
  const ttop = block(r, fs, tx, tz, 0.56, 0.6, 1.2, { wall: fs.steel, band: false });
  ribs(r, fs.steelLight, tx - 0.22, tx + 0.22, y0 + 0.1, 1.05, tz + 0.3, 4, 0.02, 0.012);
  chimney(r, 'smoke0', tx + 0.1, tz - 0.08, ttop - 0.02, 0.5, 0.085, 0.065, fac, sov ? S.sovSteelLight : M.steel);
  r.box(G.fire, 0.3, 0.05, 0.01, tx, y0 + 0.62, tz + 0.306, { b: 0, slot: 'glow:proc' });
  r.box(G.fire, 0.3, 0.05, 0.01, tx, y0 + 0.47, tz + 0.306, { b: 0, slot: 'glow:proc' });
  catwalk(r, tx, y0 + 0.82, tz + 0.35, 0.5, 0.09, 0, fs.rail);
  pipeRun(r, [[tx - 0.28, y0 + 0.75, tz - 0.1], [0.63, y0 + 0.75, tz - 0.1]], 0.04, fs.steelLight);
  // ---- control room (right front)
  const cx = 1.0;
  const cz = 0.3;
  const ctop = block(r, fs, cx, cz, 0.56, 0.6, 0.44);
  winRow(r, fs, 3, 0.1, 0.08, 0.05, cx, y0 + 0.28, cz + 0.3, 0, [0, 1]);
  doorway(r, fs, cx - 0.16, cz + 0.3, 0.13, 0.2);
  acUnit(r, cx + 0.05, ctop, cz - 0.08, 0.3, 0.9);
  radioMast(r, cx + 0.2, ctop, cz + 0.18, 0.4);
  r.node('steam0', [cx + 0.05, ctop + 0.12, cz - 0.08]);
  // ---- ore stockpile (left front) behind a low wall, with a hopper
  orePile(r, -0.98, y0, 0.74, 0.34, 0.16, 11);
  r.box(fs.wallDark, 0.78, 0.1, 0.05, -0.98, y0 + 0.05, 1.12, { b: 0.01 });
  r.box(fs.wallDark, 0.05, 0.1, 0.62, -0.6, y0 + 0.05, 0.8, { b: 0.01 });
  drums(r, 0.8, y0, 0.86, 3);
  lampPost(r, 0.62, y0, 1.32, 0.4, 0);
  lampPost(r, -0.62, y0, 1.32, 0.4, 0);
  rivets(r, [-hw / 2, top - 0.08, fz + 0.012], [hw / 2, top - 0.08, fz + 0.012], 14, 0.007);
  stencilNumber(r, '04', [cx + 0.18, y0 + 0.12, cz + 0.302], [0, 0, 0], 0.07);

  return makeTemplate({
    root: r,
    height: 1.45,
    radius: 1.55,
    muzzles: [],
    smoke: ['smoke0'],
    fx: { steam: ['steam0', 'steam1'] },
    glow: { glow: 1.6, 'glow:proc': 4, 'glow:dock': 3 },
    anim: sAnim((c, s) => {
      const active = s.harvesting || s.load > 0.05;
      const flick = 0.6 + 0.4 * Math.sin(s.time * 9 + c.v.seed) * Math.sin(s.time * 3.1);
      c.setGlow('glow:proc', s.powered ? (active ? 0.6 + 0.4 * flick : 0.3) : 0.08);
      // dock guide lights chase while receiving
      c.setGlow('glow:dock', s.powered ? (s.harvesting ? (blink(s.time, 0.5, 0.5) ? 1 : 0.2) : 0.5) : 0.05);
      c.v.roll = ((c.v.roll ?? 0) + (active && s.powered ? dtOf(s) * 7 : 0)) % (Math.PI * 2);
      for (let i = 0; i < 5; i++) c.n[`roll${i}`].rotation.x = c.v.roll;
    }),
  });
}

// =============================================================================================
// Ore silo (1x1)
// =============================================================================================

function oreSilo(fac: Fac = 'soviet'): ModelTemplate {
  const fs = FSTYLE[fac];
  const r = root(1, 1, M.concreteDark);
  const y0 = 0.04;
  const top = storageSilo(r, fs, 0, -0.04, 0.29, 0.86);
  // ore level gauge on the front
  r.box(M.dark, 0.07, 0.42, 0.03, 0, y0 + 0.4, 0.255, { b: 0.006 });
  const gauge = r.node('gauge', [0, y0 + 0.2, 0.272]);
  gauge.box(G.amber, 0.04, 0.4, 0.006, 0, 0.2, 0, { b: 0, slot: 'glow:gauge' });
  if (fac === 'soviet') emblem(r, fac, 0.07, [0.17, y0 + 0.52, 0.2], [0, 0.6, 0]);
  else stencilText(r, 'ORE', [0.17, y0 + 0.52, 0.2], [0, 0.6, 0], 0.06, S.stencilYellow);
  pipeRun(r, [[-0.27, y0 + 0.14, 0.08], [-0.44, y0 + 0.14, 0.08], [-0.44, y0 + 0.02, 0.08]], 0.03, fs.steelLight);
  warnLight(r, [0, top + 0.23, -0.04], false, 0.016);
  drums(r, 0.3, y0, 0.3, 2);

  return makeTemplate({
    root: r,
    height: 1.15,
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
  const fs = FSTYLE.allies;
  const r = root(2, 2);
  const y0 = 0.04;
  const R = 0.52;
  const L = 1.2;
  const hz = -0.18;
  // corrugated quonset hut along Z on a concrete footing
  r.box(fs.wallDark, R * 2 + 0.06, 0.06, L + 0.06, 0, y0 + 0.03, hz, { b: 0.01 });
  const hutMat: Mat = { c: 0x5f6847, m: 0.35, r: 0.62, d: 0 };
  r.add(new THREE.CylinderGeometry(R, R, L, 14, 1, true, -Math.PI / 2, Math.PI), hutMat, { p: [0, y0 + 0.06, hz], r: [-Math.PI / 2, 0, 0] });
  for (let i = 0; i < 7; i++) {
    const z = hz - L / 2 + 0.04 + i * ((L - 0.08) / 6);
    r.add(new THREE.CylinderGeometry(R + 0.01, R + 0.01, 0.025, 14, 1, true, -Math.PI / 2, Math.PI), M.oliveDark, { p: [0, y0 + 0.06, z], r: [-Math.PI / 2, 0, 0] });
  }
  // team stripe along the crown, roof vents, a white star on the roof
  r.add(new THREE.CylinderGeometry(R + 0.014, R + 0.014, L * 0.98, 3, 1, true, -0.18, 0.36), M.team, { p: [0, y0 + 0.06, hz], r: [-Math.PI / 2, 0, 0] });
  alliedStar(r, 0.14, [0, y0 + 0.06 + R + 0.016, hz - 0.2]);
  for (const z of [hz - 0.45, hz + 0.25]) roofVent(r, 0.26, y0 + 0.06 + R * 0.86, z, 0.032);
  // concrete end walls; the front one is a proper facade
  for (const s of [-1, 1]) r.add(new THREE.CircleGeometry(R, 14, 0, Math.PI), fs.wall, { p: [0, y0 + 0.06, hz + (L / 2) * s], r: [0, s > 0 ? 0 : Math.PI, 0] });
  const fz = hz + L / 2;
  r.box(fs.wall, 0.56, 0.5, 0.08, 0, y0 + 0.31, fz + 0.03, { b: 0.012 });
  r.box(M.team, 0.6, 0.03, 0.1, 0, y0 + 0.56, fz + 0.03, { b: 0.006 });
  doorway(r, fs, 0, fz + 0.07, 0.2, 0.28);
  sloganBoard(r, 'allies', 'BARRACKS', 0.44, 0.1, [0, y0 + 0.46, fz + 0.072], 0, false);
  emblem(r, 'allies', 0.1, [0, y0 + 0.66, fz + 0.005]);
  windows(r, 2, 0.08, 0.07, 0.44, [0, y0 + 0.25, fz + 0.004], [0, 0, 0], fs.win, 'glow');
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const z = hz - 0.38 + i * 0.36;
      r.box(fs.win, 0.012, 0.07, 0.1, 0.44 * s, y0 + 0.3, z, { b: 0, slot: 'glow' });
      r.box(M.dark, 0.016, 0.08, 0.11, 0.435 * s, y0 + 0.3, z, { b: 0 });
    }
  }
  floodlight(r, [0.3, y0 + 0.62, fz + 0.06], 0, 0.9);
  floodlight(r, [-0.3, y0 + 0.62, fz + 0.06], 0, 0.9);
  // sandbag emplacements, barrier, flag, gear
  sandbags(r, 0.5, 3, [-0.64, y0, 0.8]);
  sandbags(r, 0.5, 3, [0.64, y0, 0.8]);
  sandbags(r, 0.42, 3, [-0.87, y0, 0.48], [0, Math.PI / 2, 0]);
  r.box(M.white, 0.04, 0.05, 0.04, 0.4, y0 + 0.025, 0.72, { b: 0 });
  r.box(M.red, 0.38, 0.025, 0.02, 0.22, y0 + 0.07, 0.72, { b: 0, r: [0, 0, 0.0] });
  r.cyl(M.steel, 0.012, 0.015, 1.05, 0.78, y0 + 0.52, -0.78, { seg: 6 });
  r.sph(M.brass, 0.018, 0.78, y0 + 1.06, -0.78, { seg: 6 });
  const flag = r.node('flag', [0.78, y0 + 1.0, -0.78]);
  flag.box(M.team, 0.28, 0.17, 0.006, 0.14, -0.085, 0, { b: 0 });
  flag.add(eagleGeoRef(), M.white, { p: [0.14, -0.085, 0.004], s: [0.06, 0.06, 1] });
  flag.add(eagleGeoRef(), M.white, { p: [0.14, -0.085, -0.004], s: [0.06, 0.06, 1], r: [0, Math.PI, 0] });
  crateStack(r, 0.78, y0, 0.18, 0.11, 3, 0.2);
  stowage(r, 0.2, 0.08, 0.1, -0.8, y0, -0.2, M.khaki);
  drums(r, -0.78, y0, 0.1, 3, M.oliveDark);
  // side annex: a small radio shack with an antenna
  r.box(fs.wall, 0.26, 0.24, 0.3, -0.72, y0 + 0.12, -0.7, { b: 0.01 });
  r.box(fs.roof, 0.3, 0.02, 0.34, -0.72, y0 + 0.25, -0.7, { b: 0.004 });
  antenna(r, -0.78, y0 + 0.26, -0.76, 0.55);
  lampPost(r, -0.86, y0, 0.12, 0.38, 0);

  return makeTemplate({
    root: r,
    height: 1.0,
    radius: 1.05,
    muzzles: [],
    glow: { glow: 1.6 },
    anim: sAnim((c, s) => {
      c.n.flag.rotation.y = Math.sin(s.time * 1.3 + c.v.seed) * 0.25 - 0.3;
    }),
  });
}

/** Eagle silhouette geometry (re-exported for flags). */
function eagleGeoRef(): THREE.BufferGeometry {
  return eagleGeo();
}

// =============================================================================================
// Soviet barracks (2x2) — two-storey concrete barracks with a guarded entrance
// =============================================================================================

function sovietBarracks(): ModelTemplate {
  const fs = FSTYLE.soviet;
  const r = root(2, 2, M.concreteDark);
  const y0 = 0.04;
  const bz = -0.24;
  const bw = 1.56;
  const bd = 0.92;
  const bh = 0.74;
  const top = block(r, fs, 0, bz, bw, bd, bh, { ribs: 6 });
  const fz = bz + bd / 2;
  // two storeys of windows between the ribs, slogan board above
  for (const s of [-1, 1]) {
    winRow(r, fs, 2, 0.09, 0.09, 0.14, s * 0.48, y0 + 0.24, fz + 0.02, 0, s < 0 ? [0] : [0, 1]);
    winRow(r, fs, 2, 0.09, 0.09, 0.14, s * 0.48, y0 + 0.47, fz + 0.02, 0, s < 0 ? [1] : [0]);
  }
  sloganBoard(r, 'soviet', 'СЛАВА СССР', 0.62, 0.13, [0, y0 + 0.66, fz + 0.022], 0, false);
  // entrance portal with a heavy door, star and banners
  const pz = fz + 0.1;
  r.box(fs.wall, 0.46, 0.56, 0.2, 0, y0 + 0.28, pz - 0.02, { b: 0.015 });
  r.box(M.team, 0.5, 0.03, 0.24, 0, y0 + 0.57, pz - 0.02, { b: 0.006 });
  r.box(fs.roof, 0.44, 0.02, 0.18, 0, y0 + 0.59, pz - 0.02, { b: 0.004 });
  doorway(r, fs, 0, pz + 0.08, 0.2, 0.3);
  emblem(r, 'soviet', 0.075, [0, y0 + 0.47, pz + 0.085]);
  banner(r, 'soviet', 0.17, 0.42, [-0.36, y0 + 0.6, fz + 0.04], 0);
  banner(r, 'soviet', 0.17, 0.42, [0.36, y0 + 0.6, fz + 0.04], 0);
  cornerLights(r, fs, 0, bz, bw, bd, top - 0.015);
  // roof: guard post with a searchlight, water tank, antenna, AC unit
  r.box(fs.wallDark, 0.26, 0.2, 0.26, -0.56, top + 0.1, bz - 0.22, { b: 0.012 });
  r.box(M.darker, 0.2, 0.05, 0.27, -0.56, top + 0.15, bz - 0.22, { b: 0 });
  r.box(fs.roof, 0.3, 0.025, 0.3, -0.56, top + 0.21, bz - 0.22, { b: 0.004 });
  floodlight(r, [-0.56, top + 0.245, bz - 0.13], 0.3, 0.7, 0.045, { glow: 0xfff2d6, i: 2.4 });
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) r.box(M.dark, 0.014, 0.18, 0.014, 0.42 + dx * 0.07, top + 0.09, bz - 0.24 + dz * 0.07, { b: 0 });
  r.cyl(fs.steel, 0.11, 0.11, 0.16, 0.42, top + 0.26, bz - 0.24, { seg: 12 });
  r.add(lathe([[0.11, 0], [0.08, 0.04], [0.0, 0.06]], 12), fs.steelLight, { p: [0.42, top + 0.34, bz - 0.24] });
  r.cyl(M.team, 0.113, 0.113, 0.03, 0.42, top + 0.24, bz - 0.24, { seg: 12 });
  radioMast(r, 0.66, top, bz + 0.2, 0.5);
  acUnit(r, 0.05, top, bz - 0.2, 0, 1);
  roofVent(r, -0.2, top, bz + 0.18, 0.035);
  roofVent(r, 0.25, top, bz + 0.2, 0.035);
  // front yard: sandbag walls, oil drums, flagpole with a Soviet flag
  sandbags(r, 0.46, 3, [-0.62, y0, 0.78]);
  sandbags(r, 0.46, 3, [0.62, y0, 0.78]);
  drums(r, 0.8, y0, 0.52, 3, M.oliveDark);
  crateStack(r, -0.82, y0, 0.48, 0.09, 2, 0.4);
  r.cyl(M.steel, 0.012, 0.015, 1.15, -0.84, y0 + 0.575, -0.84, { seg: 6 });
  r.sph(M.brass, 0.018, -0.84, y0 + 1.16, -0.84, { seg: 6 });
  const flag = r.node('flag', [-0.84, y0 + 1.1, -0.84]);
  flag.box(M.team, 0.3, 0.18, 0.006, 0.15, -0.09, 0, { b: 0 });
  flag.add(starGeo(0.035, 0.004), S.stencilYellow, { p: [0.07, -0.05, 0.004], r: faceRot('+z') });
  flag.add(starGeo(0.035, 0.004), S.stencilYellow, { p: [0.07, -0.05, -0.004], r: faceRot('-z') });
  lampPost(r, 0.86, y0, 0.86, 0.4, -Math.PI / 2);
  rivets(r, [-bw / 2, top - 0.07, fz + 0.012], [bw / 2, top - 0.07, fz + 0.012], 16, 0.006);

  return makeTemplate({
    root: r,
    height: 1.15,
    radius: 1.05,
    muzzles: [],
    glow: { glow: 1.8 },
    anim: sAnim((c, s) => {
      c.n.flag.rotation.y = Math.sin(s.time * 1.2 + c.v.seed) * 0.22 + 0.4;
    }),
  });
}

// =============================================================================================
// Kennel (1x1)
// =============================================================================================

function kennel(): ModelTemplate {
  const fs = FSTYLE.soviet;
  const r = root(1, 1, M.concreteDark);
  const y0 = 0.04;
  const kz = -0.14;
  const kw = 0.7;
  const kd = 0.42;
  const kh = 0.3;
  // concrete kennel block with a gable roof (dark steel, team ridge)
  r.box(fs.wallDark, kw + 0.03, 0.05, kd + 0.03, 0, y0 + 0.025, kz, { b: 0.008 });
  r.box(fs.wall, kw, kh, kd, 0, y0 + kh / 2, kz, { b: 0.015 });
  r.add(prismXY([[-kd / 2, 0], [kd / 2, 0], [0, 0.14]], kw, 0), fs.wall, { p: [0, y0 + kh, kz], r: [0, Math.PI / 2, 0] });
  gableRoof(r, kw, kd, y0 + kh - 0.005, 0.15, fs.roof, 0, kz, 0.04, false);
  r.box(M.team, kw + 0.1, 0.025, 0.03, 0, y0 + kh + 0.165, kz, { b: 0.006 });
  // three arched dog doors with numbers
  for (let i = 0; i < 3; i++) {
    const x = -0.22 + i * 0.22;
    r.box(M.darker, 0.11, 0.11, 0.02, x, y0 + 0.07, kz + kd / 2 + 0.002, { b: 0 });
    r.add(new THREE.CircleGeometry(0.055, 6, 0, Math.PI), M.darker, { p: [x, y0 + 0.125, kz + kd / 2 + 0.003] });
    r.box(M.team, 0.15, 0.018, 0.02, x, y0 + 0.21, kz + kd / 2 + 0.01, { b: 0.003 });
    stencilText(r, String(i + 1), [x, y0 + 0.25, kz + kd / 2 + 0.004], [0, 0, 0], 0.035, S.stencilWhite);
  }
  emblem(r, 'soviet', 0.05, [0, y0 + kh + 0.06, kz + kd / 2 + 0.004]);
  warnLight(r, [kw / 2 - 0.03, y0 + kh + 0.03, kz + kd / 2 - 0.02], false, 0.014);
  floodlight(r, [-kw / 2 + 0.06, y0 + kh + 0.02, kz + kd / 2 + 0.02], 0.2, 0.9, 0.035);
  // fenced dog run in front: posts, rails, chain-link panels (dark mesh)
  r.box(M.sand, 0.84, 0.01, 0.34, 0, y0 + 0.005, 0.26, { b: 0 });
  const fence: Mat = { c: 0x4a4d52, m: 0.5, r: 0.6, d: 2, uv: 14 };
  for (let i = 0; i < 6; i++) r.box(M.gun, 0.016, 0.16, 0.016, -0.42 + i * 0.168, y0 + 0.08, 0.43, { b: 0 });
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) r.box(M.gun, 0.016, 0.16, 0.016, s * 0.42, y0 + 0.08, 0.1 + i * 0.165, { b: 0 });
  r.box(fence, 0.84, 0.13, 0.004, 0, y0 + 0.08, 0.43, { b: 0 });
  r.box(fence, 0.004, 0.13, 0.34, -0.42, y0 + 0.08, 0.26, { b: 0 });
  r.box(fence, 0.004, 0.13, 0.34, 0.42, y0 + 0.08, 0.26, { b: 0 });
  r.box(M.gun, 0.84, 0.01, 0.01, 0, y0 + 0.16, 0.43, { b: 0 });
  // bowls, bone, kennel crates, food sacks
  r.cyl(M.steel, 0.035, 0.026, 0.022, 0.24, y0 + 0.011, 0.28, { seg: 10 });
  r.cyl(M.red, 0.028, 0.028, 0.004, 0.24, y0 + 0.021, 0.28, { seg: 10 });
  r.box(M.offwhite, 0.07, 0.013, 0.013, -0.22, y0 + 0.007, 0.3, { b: 0.005, r: [0, 0.5, 0] });
  r.box(M.khaki, 0.09, 0.08, 0.11, 0.38, y0 + 0.04, kz - 0.08, { b: 0.025 });
  r.box(M.khaki, 0.09, 0.07, 0.11, 0.38, y0 + 0.115, kz - 0.06, { b: 0.025, r: [0, 0.3, 0] });
  r.box(M.wood, 0.12, 0.09, 0.09, -0.38, y0 + 0.045, kz + 0.06, { b: 0.008 });

  return makeTemplate({ root: r, height: 0.62, radius: 0.5, muzzles: [], glow: { glow: 1.6 }, anim: sAnim() });
}

// =============================================================================================
// War factory (3x3) — big door on +Z animated by state.door
// =============================================================================================

function warFactory(fac: Fac = 'soviet'): ModelTemplate {
  const fs = FSTYLE[fac];
  const sov = fac === 'soviet';
  const r = root(3, 3, sov ? M.concreteDark : M.concrete);
  const y0 = 0.04;
  const hz = -0.36;
  const hd = 1.98;
  const hw = 2.56;
  const hh = 0.94;
  const fz = hz + hd / 2;
  // apron + chevrons in front of the door
  r.box(M.asphalt, 1.2, 0.012, 0.8, 0, y0 + 0.006, fz + 0.42, { b: 0 });
  for (let i = 0; i < 3; i++) {
    r.add(prismXZ([[-0.25, 0.0], [0.0, -0.1], [0.25, 0.0], [0.25, 0.05], [0.0, -0.05], [-0.25, 0.05]], 0.004, 0), M.yellow, { p: [0, y0 + 0.012, fz + 0.25 + i * 0.16] });
  }
  for (const s of [-1, 1]) r.cyl(M.yellow, 0.025, 0.025, 0.1, s * 0.62, y0 + 0.05, fz + 0.62, { seg: 8 });
  // hall: rear block + front section around a recessed vehicle bay
  const bayD = 0.5;
  const dw = 1.14;
  const dh = 0.72;
  const rearD = hd - bayD;
  r.box(fs.wallDark, hw + 0.035, 0.08, hd + 0.035, 0, y0 + 0.04, hz, { b: 0.012 });
  r.box(fs.wall, hw, hh, rearD, 0, y0 + hh / 2, hz - hd / 2 + rearD / 2, { b: 0.03 });
  const sideW = (hw - dw) / 2;
  for (const sx of [-1, 1]) r.box(fs.wall, sideW, hh, bayD + 0.02, sx * (dw / 2 + sideW / 2), y0 + hh / 2, fz - bayD / 2, { b: 0.025 });
  r.box(fs.wall, dw + 0.02, hh - dh, bayD + 0.02, 0, y0 + dh + (hh - dh) / 2, fz - bayD / 2, { b: 0.02 });
  r.box(fs.steel, hw + 0.014, 0.12, hd + 0.014, 0, y0 + hh - 0.095, hz, { b: 0.008 });
  r.box(M.team, hw + 0.03, 0.03, hd + 0.03, 0, y0 + hh - 0.02, hz, { b: 0.01 });
  // barrel-vault roof: dark steel arches, a thin team stripe on each crown, skylights, ribs
  for (let i = 0; i < 3; i++) {
    const x = -hw / 2 + hw / 6 + (i * hw) / 3;
    r.add(new THREE.CylinderGeometry(0.42, 0.42, hd - 0.06, 12, 1, false, -Math.PI / 2, Math.PI), fs.roof, { p: [x, y0 + hh - 0.02, hz], r: [-Math.PI / 2, 0, 0], s: [1, 1, 0.55] });
    r.box(M.team, 0.05, 0.012, hd - 0.04, x, y0 + hh + 0.212, hz, { b: 0.003 });
    r.box(M.glassBlue, 0.1, 0.012, hd - 0.5, x - 0.15, y0 + hh + 0.18, hz, { b: 0.003, r: [0, 0, 0.35] });
    for (let k = 0; k < 7; k++) {
      r.add(new THREE.TorusGeometry(0.425, 0.011, 3, 10, Math.PI), fs.steel, { p: [x, y0 + hh - 0.02, hz - hd / 2 + 0.12 + k * ((hd - 0.24) / 6)], s: [1, 0.55, 1], lod: 0 });
    }
    for (let k = 0; k < 3; k++) roofVent(r, x + 0.05, y0 + hh + 0.2, hz - 0.6 + k * 0.6, 0.03);
    if (i < 2) r.box(fs.steel, 0.05, 0.22, hd - 0.02, x + hw / 6, y0 + hh + 0.06, hz, { b: 0.008 });
  }
  // roof plant: stack, vents, AC units, catwalk along the front parapet
  chimney(r, 'smoke0', 1.0, hz - 0.62, y0 + hh + 0.1, 0.62, 0.085, 0.065, fac, sov ? S.sovSteelLight : M.steel);
  r.box(fs.steel, 0.26, 0.2, 0.26, 1.0, y0 + hh + 0.06, hz - 0.62, { b: 0.012 });
  acUnit(r, -0.86, y0 + hh + 0.15, hz - 0.62, 0.0, 1.0);
  acUnit(r, -0.05, y0 + hh + 0.16, hz - 0.7, 0.0, 0.9);
  roofVent(r, 0.4, y0 + hh + 0.14, hz - 0.3, 0.04);
  roofVent(r, -0.42, y0 + hh + 0.14, hz + 0.1, 0.04);
  // flanking towers either side of the door: banners, lights
  const tw = 0.34;
  const th = 1.42;
  for (const sx of [-1, 1]) {
    const tx = sx * (dw / 2 + tw / 2 + 0.02);
    r.box(fs.wallDark, tw + 0.03, 0.08, 0.36, tx, y0 + 0.04, fz + 0.03, { b: 0.01 });
    r.box(fs.wall, tw, th, 0.32, tx, y0 + th / 2, fz + 0.02, { b: 0.02 });
    r.box(fs.steel, tw + 0.014, 0.1, 0.334, tx, y0 + th - 0.08, fz + 0.02, { b: 0.008 });
    r.box(M.team, tw + 0.03, 0.028, 0.35, tx, y0 + th - 0.018, fz + 0.02, { b: 0.008 });
    r.box(fs.roof, tw - 0.02, 0.02, 0.3, tx, y0 + th + 0.004, fz + 0.02, { b: 0.004 });
    parapet(r, fs.wallDark, tw + 0.02, 0.34, y0 + th - 0.01, tx, fz + 0.02, 0.045, 0.025);
    banner(r, fac, 0.24, 0.7, [tx, y0 + th - 0.14, fz + 0.19], 0);
    if (sov) emblem(r, fac, 0.07, [tx, y0 + 0.36, fz + 0.185]);
    else stencilText(r, sx < 0 ? 'A' : 'B', [tx, y0 + 0.36, fz + 0.185], [0, 0, 0], 0.09, S.stencilYellow);
    warnLight(r, [tx + sx * 0.12, y0 + th + 0.06, fz + 0.14], false, 0.02);
    if (!sov) floodlight(r, [tx - sx * 0.08, y0 + th + 0.04, fz + 0.17], 0, 0.75);
  }
  // door frame, hazard stripes, slogan above the door
  r.box(fs.wallDark, dw + 0.06, 0.1, 0.06, 0, y0 + dh + 0.05, fz + 0.03, { b: 0.012 });
  hazard(r, dw + 0.04, 0.04, [0, y0 + dh + 0.03, fz + 0.062]);
  if (sov) sloganBoard(r, fac, '', dw - 0.04, 0.18, [0, y0 + dh + 0.15, fz + 0.012], 0, false, ['TANKS FOR', 'THE FRONT']);
  else sloganBoard(r, fac, 'MOTOR POOL', dw - 0.24, 0.13, [0, y0 + dh + 0.15, fz + 0.012], 0, true);
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
  door.box(fs.steel, dw, dh, 0.025, 0, -dh / 2, 0, { b: 0.004 });
  for (let i = 0; i < 9; i++) door.box(M.gun, dw - 0.02, 0.012, 0.03, 0, -0.04 - i * 0.075, 0, { b: 0 });
  door.box(M.yellow, dw, 0.03, 0.03, 0, -dh + 0.015, 0, { b: 0 });
  door.add(stencilTextGeo(sov ? '02' : 'B2', 0.16, 0.18), S.stencilWhite, { p: [0.3, -dh * 0.45, 0.014] });
  // office wings with windows + doors
  for (const sx of [-1, 1]) {
    const wx = sx * 1.04;
    winRow(r, fs, 2, 0.1, 0.09, 0.06, wx, y0 + 0.6, fz, 0, sx < 0 ? [0, 1] : [1]);
    winRow(r, fs, 2, 0.1, 0.09, 0.06, wx, y0 + 0.38, fz, 0, sx < 0 ? [1] : [0, 1]);
  }
  doorway(r, fs, 1.04, fz, 0.16, 0.24);
  r.box(M.darker, 0.3, 0.24, 0.02, -1.04, y0 + 0.12, fz + 0.005, { b: 0 });
  for (let i = 0; i < 4; i++) r.box(fs.steel, 0.28, 0.04, 0.02, -1.04, y0 + 0.03 + i * 0.055, fz + 0.012, { b: 0 });
  // door beacons (rotating amber while the door moves)
  lamp(r, G.amber, [-dw / 2 - 0.05, y0 + dh + 0.14, fz + 0.07], 0.022, 'glow:door');
  lamp(r, G.amber, [dw / 2 + 0.05, y0 + dh + 0.14, fz + 0.07], 0.022, 'glow:door');
  // side buttresses + pipes along the walls
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) r.box(fs.wallDark, 0.06, hh - 0.1, 0.1, (hw / 2 + 0.02) * s, y0 + (hh - 0.1) / 2, hz - 0.8 + i * 0.5, { b: 0.01 });
  }
  pipeRun(r, [[hw / 2 + 0.05, y0 + 0.6, hz + 0.6], [hw / 2 + 0.05, y0 + 0.6, hz - 0.9], [hw / 2 + 0.05, y0 + hh + 0.15, hz - 0.9]], 0.025, fs.steelLight);
  // yard clutter
  crateStack(r, -1.3, y0, fz + 0.3, 0.1, 3, 0.2);
  drums(r, 1.26, y0, fz + 0.32, 3);
  lampPost(r, 1.36, y0, 1.34, 0.42, -Math.PI / 2);
  lampPost(r, -1.36, y0, 1.34, 0.42, Math.PI / 2);
  // close-up detail: frame rivets, roof edge bolts
  for (const sx of [-1, 1]) rivets(r, [sx * (dw / 2 + 0.01), y0 + 0.05, fz + 0.052], [sx * (dw / 2 + 0.01), y0 + dh - 0.05, fz + 0.052], 8, 0.007);
  rivets(r, [-hw / 2, y0 + hh - 0.06, fz + 0.012], [hw / 2, y0 + hh - 0.06, fz + 0.012], 20, 0.007);
  r.node('weld', [0.1, y0 + 0.18, fz - bayD + 0.2]);
  r.node('steam0', [0.4, y0 + hh + 0.26, hz - 0.3]);

  return makeTemplate({
    root: r,
    height: 1.4,
    radius: 1.55,
    muzzles: [],
    smoke: ['smoke0'],
    fx: { sparks: ['weld'], steam: ['steam0'] },
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

function radarDome(fac: Fac = 'soviet'): ModelTemplate {
  const fs = FSTYLE[fac];
  const sov = fac === 'soviet';
  const r = root(2, 2, sov ? M.concreteDark : M.concrete);
  const y0 = 0.04;
  // ---- operations block across the front
  const bx = -0.12;
  const bz = 0.42;
  const bw = 1.56;
  const bd = 0.84;
  const top = block(r, fs, bx, bz, bw, bd, 0.5, { ribs: 5 });
  const fz = bz + bd / 2;
  winRow(r, fs, 5, 0.09, 0.08, 0.07, bx - 0.12, y0 + 0.28, fz + 0.02, 0, [0, 1, 3, 4]);
  doorway(r, fs, bx + 0.56, fz, 0.16, 0.24);
  if (sov) {
    sloganBoard(r, fac, 'VIGILANCE', 0.56, 0.1, [bx - 0.12, y0 + 0.42, fz + 0.022], 0, false);
    banner(r, fac, 0.16, 0.36, [bx - 0.7, y0 + 0.47, fz + 0.022], 0);
  } else {
    sloganBoard(r, fac, 'RADAR CONTROL', 0.62, 0.1, [bx - 0.12, y0 + 0.42, fz + 0.022], 0, false);
    emblem(r, fac, 0.07, [bx - 0.7, y0 + 0.3, fz + 0.022], [0, 0, 0], true);
  }
  cornerLights(r, fs, bx, bz, bw, bd, top - 0.015);
  acUnit(r, bx - 0.5, top, bz + 0.1, 0, 1);
  acUnit(r, bx - 0.2, top, bz + 0.12, 0, 0.9);
  dish(r, bx + 0.3, top, bz + 0.15, 0.09, -0.4, 0.5);
  antenna(r, bx + 0.62, top, bz - 0.25, 0.42);
  antenna(r, bx + 0.52, top, bz - 0.28, 0.3);
  // ---- lattice tower carrying the geodesic radome (back right)
  const tx = 0.32;
  const tz = -0.5;
  const th = 1.06;
  const b0 = 0.3;
  const b1 = 0.12;
  r.box(fs.wallDark, 0.7, 0.06, 0.7, tx, y0 + 0.03, tz, { b: 0.01 });
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    pipe(r, [tx + b0 * sx, y0 + 0.06, tz + b0 * sz], [tx + b1 * sx, y0 + th, tz + b1 * sz], 0.018, fs.steel, 5);
    r.box(fs.wallDark, 0.08, 0.05, 0.08, tx + b0 * sx, y0 + 0.08, tz + b0 * sz, { b: 0.008 });
  }
  for (let i = 0; i < 4; i++) {
    const f0 = i / 4;
    const f1 = (i + 1) / 4;
    const w0 = b0 + (b1 - b0) * f0;
    const w1 = b0 + (b1 - b0) * f1;
    const y1 = y0 + 0.06 + (th - 0.06) * f0;
    const y2 = y0 + 0.06 + (th - 0.06) * f1;
    for (const s of [-1, 1]) {
      pipe(r, [tx - w0, y1, tz + w0 * s], [tx + w1, y2, tz + w1 * s], 0.006, fs.steelLight, 3);
      pipe(r, [tx + w0 * s, y1, tz - w0], [tx + w1 * s, y2, tz + w1], 0.006, fs.steelLight, 3);
    }
    r.add(ringGeo(w1 * 1.38, w1 * 1.46, 0.014, 4), i === 1 ? M.team : fs.steel, { p: [tx, y2, tz], r: [0, Math.PI / 4, 0] });
  }
  ladder(r, th, [tx, y0 + 0.06, tz + 0.2], 0);
  // platform with railing + radome
  r.cyl(fs.steel, 0.3, 0.26, 0.06, tx, y0 + th + 0.03, tz, { seg: 16 });
  r.add(new THREE.TorusGeometry(0.3, 0.005, 3, 16), fs.rail, { p: [tx, y0 + th + 0.12, tz], r: [Math.PI / 2, 0, 0] });
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    r.box(fs.rail, 0.007, 0.07, 0.007, tx + Math.cos(a) * 0.3, y0 + th + 0.09, tz + Math.sin(a) * 0.3, { b: 0 });
  }
  const dome = new THREE.IcosahedronGeometry(0.31, 2);
  dome.computeVertexNormals();
  r.add(dome, M.white, { p: [tx, y0 + th + 0.33, tz] });
  r.add(ringGeo(0.25, 0.27, 0.05, 16), M.team, { p: [tx, y0 + th + 0.1, tz] });
  warnLight(r, [tx, y0 + th + 0.66, tz], false, 0.018);
  // ---- rotating search dish on a pedestal (back left)
  const px = -0.56;
  const pz = -0.48;
  r.box(fs.wallDark, 0.44, 0.12, 0.44, px, y0 + 0.06, pz, { b: 0.012 });
  r.cyl(fs.steel, 0.07, 0.1, 0.34, px, y0 + 0.29, pz, { seg: 10 });
  r.box(fs.steel, 0.2, 0.16, 0.18, px + 0.12, y0 + 0.2, pz + 0.12, { b: 0.012 });
  grille(r, 0.16, 0.14, [px + 0.12, y0 + 0.282, pz + 0.12], 4);
  const dsh = r.node('dish', [px, y0 + 0.48, pz]);
  dsh.cyl(M.gun, 0.03, 0.04, 0.08, 0, 0.0, 0, { seg: 10 });
  const d2 = new NB('_d', [0.02, 0.12, 0], [0, 0, 1.15]);
  d2.add(lathe([[0.0, 0.0], [0.1, 0.014], [0.18, 0.05], [0.23, 0.09]], 16), M.offwhite);
  d2.cyl(M.dark, 0.006, 0.006, 0.16, 0, 0.08, 0, { seg: 6 });
  d2.sph(M.gun, 0.018, 0, 0.16, 0, { seg: 8 });
  dsh.box(M.gun, 0.07, 0.035, 0.035, 0.0, 0.05, 0, { b: 0.006 });
  mergeChild(dsh, d2);
  warnLight(dsh, [-0.07, 0.07, 0], false, 0.013);
  pipeRun(r, [[px + 0.22, y0 + 0.1, pz], [bx - 0.3, y0 + 0.1, pz], [bx - 0.3, y0 + 0.1, bz - bd / 2]], 0.02, M.dark);
  lampPost(r, 0.86, y0, 0.0, 0.4, -Math.PI / 2);
  rivets(r, [bx - bw / 2, top - 0.07, fz + 0.012], [bx + bw / 2, top - 0.07, fz + 0.012], 14, 0.006);

  return makeTemplate({
    root: r,
    height: 1.75,
    radius: 1.05,
    muzzles: [],
    glow: { glow: 1.6 },
    anim: sAnim((c, s) => {
      if (s.powered) c.n.dish.rotation.y += dtOf(s) * 1.1;
    }),
  });
}

// =============================================================================================
// Service depot (3x3) — pad in the centre cell
// =============================================================================================

function serviceDepot(fac: Fac = 'soviet'): ModelTemplate {
  const fs = FSTYLE[fac];
  const sov = fac === 'soviet';
  const r = root(3, 3, sov ? M.concreteDark : M.concrete);
  const y0 = 0.04;
  // ---- central octagonal pad (drivable, low)
  const oct: [number, number][] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    oct.push([Math.cos(a) * 0.62, Math.sin(a) * 0.62]);
  }
  r.add(prismXZ(oct, 0.05, 0.015), M.gun, { p: [0, y0, 0] });
  r.add(prismXZ(oct.map(([x, z]) => [x * 0.86, z * 0.86] as [number, number]), 0.008, 0), M.dark, { p: [0, y0 + 0.05, 0] });
  r.box(M.yellow, 0.5, 0.004, 0.06, 0, y0 + 0.06, 0, { b: 0, r: [0, Math.PI / 4, 0] });
  r.box(M.yellow, 0.5, 0.004, 0.06, 0, y0 + 0.06, 0, { b: 0, r: [0, -Math.PI / 4, 0] });
  r.add(ringGeo(0.4, 0.45, 0.004, 24), M.yellow, { p: [0, y0 + 0.06, 0] });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    r.sph(G.green, 0.016, Math.cos(a) * 0.58, y0 + 0.058, Math.sin(a) * 0.58, { seg: 6, slot: 'glow:pad' });
  }
  // ---- back workshop: two bays, slogan, windows
  const wz = -1.02;
  const wd = 0.8;
  const top = block(r, fs, 0, wz, 2.8, wd, 0.66, { ribs: 0 });
  const fz = wz + wd / 2;
  for (const x of [-0.75, 0.75]) {
    r.box(M.darker, 0.6, 0.4, 0.02, x, y0 + 0.2, fz + 0.004, { b: 0 });
    for (let i = 0; i < 7; i++) r.box(fs.steel, 0.58, 0.04, 0.02, x, y0 + 0.03 + i * 0.054, fz + 0.012, { b: 0 });
    hazard(r, 0.66, 0.04, [x, y0 + 0.43, fz + 0.016]);
    warnLight(r, [x - 0.36, y0 + 0.46, fz + 0.03], false, 0.016, { glow: 0xffa020, i: 2.2 });
  }
  if (sov) {
    sloganBoard(r, fac, 'РЕМОНТ', 0.46, 0.18, [0, y0 + 0.44, fz + 0.012], 0, true);
    banner(r, fac, 0.18, 0.4, [-1.24, y0 + 0.62, fz + 0.012], 0);
    banner(r, fac, 0.18, 0.4, [1.24, y0 + 0.62, fz + 0.012], 0);
  } else {
    sloganBoard(r, fac, 'SERVICE', 0.46, 0.13, [0, y0 + 0.47, fz + 0.012], 0, true);
    emblem(r, fac, 0.1, [-1.24, y0 + 0.4, fz + 0.012]);
    emblem(r, fac, 0.1, [1.24, y0 + 0.4, fz + 0.012]);
  }
  winRow(r, fs, 2, 0.08, 0.08, 0.06, 0, y0 + 0.2, fz, 0, [0, 1]);
  cornerLights(r, fs, 0, wz, 2.8, wd, top - 0.015);
  acUnit(r, -0.9, top, wz - 0.1, 0, 1);
  acUnit(r, 0.3, top, wz - 0.12, 0, 1);
  roofVent(r, 1.0, top, wz + 0.1, 0.04);
  roofVent(r, -0.3, top, wz + 0.15, 0.035);
  radioMast(r, 1.25, top, wz - 0.25, 0.42);
  // ---- side tool sheds open toward the pad, with racks and gear
  for (const s of [-1, 1]) {
    const sx = 1.12 * s;
    const stop = block(r, fs, sx, -0.12, 0.46, 0.82, 0.42);
    r.box(M.darker, 0.02, 0.28, 0.6, sx - 0.232 * s, y0 + 0.14, -0.12, { b: 0 });
    for (let k = 0; k < 3; k++) r.box(M.yellow, 0.012, 0.012, 0.56, sx - 0.24 * s, y0 + 0.06 + k * 0.09, -0.12, { b: 0 });
    hazard(r, 0.64, 0.035, [sx - 0.236 * s, y0 + 0.33, -0.12], [0, (Math.PI / 2) * -s, 0]);
    acUnit(r, sx, stop, -0.3, Math.PI / 2, 0.8);
    drums(r, sx - 0.05 * s, y0, 0.5, 3, s > 0 ? M.red : { c: 0x3e4a2e, m: 0.4, r: 0.6, d: 0 });
  }
  // ---- repair arms on four posts around the pad + overhead gantry with a hoist
  const posts: [number, number][] = [[-0.78, -0.56], [0.78, -0.56], [-0.78, 0.7], [0.78, 0.7]];
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
  for (const s of [-1, 1]) {
    r.box(M.yellow, 0.05, 0.86, 0.05, s * 0.84, y0 + 0.43, -0.48, { b: 0.008 });
    hazard(r, 0.3, 0.05, [s * 0.84, y0 + 0.2, -0.448], [0, 0, Math.PI / 2], 0.04);
  }
  r.box(M.yellow, 1.74, 0.07, 0.06, 0, y0 + 0.86, -0.48, { b: 0.01 });
  r.box(M.dark, 0.1, 0.06, 0.1, 0.2, y0 + 0.8, -0.48, { b: 0.008 });
  r.cyl(M.steel, 0.003, 0.003, 0.3, 0.2, y0 + 0.62, -0.48, { seg: 3 });
  r.box(M.dark, 0.04, 0.05, 0.04, 0.2, y0 + 0.46, -0.48, { b: 0.006 });
  warnLight(r, [-0.84, y0 + 0.9, -0.48], false, 0.016, { glow: 0xffa020, i: 2.2 });
  warnLight(r, [0.84, y0 + 0.9, -0.48], false, 0.016, { glow: 0xffa020, i: 2.2 });
  // front corner floodlight poles
  for (const s of [-1, 1]) {
    r.cyl(M.dark, 0.012, 0.016, 0.62, s * 1.32, y0 + 0.31, 1.3, { seg: 6 });
    floodlight(r, [s * 1.32, y0 + 0.62, 1.28], s > 0 ? -2.4 : 2.4, 0.6, 0.045);
  }
  crateStack(r, -1.22, y0, 1.0, 0.1, 3, 0.3);

  return makeTemplate({
    root: r,
    height: 0.95,
    radius: 1.55,
    muzzles: [],
    glow: { glow: 1.6, 'glow:pad': 3, 'glow:weld': 6 },
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
  const fs = FSTYLE.allies;
  const r = root(2, 2);
  const y0 = 0.04;
  // stepped modern block with a glass curtain wall
  const top = block(r, fs, 0, -0.12, 1.66, 1.2, 0.44, { band: false });
  r.box(M.glassBlue, 1.46, 0.28, 0.02, 0, y0 + 0.22, 0.482, { b: 0 });
  for (let i = 0; i < 9; i++) r.box(M.steel, 0.014, 0.3, 0.03, -0.73 + i * 0.1825, y0 + 0.22, 0.49, { b: 0 });
  r.box(M.steel, 1.48, 0.016, 0.03, 0, y0 + 0.3, 0.49, { b: 0 });
  windows(r, 8, 0.15, 0.05, 0.032, [0, y0 + 0.17, 0.495], [0, 0, 0], { glow: 0x9fe2ff, i: 0.9 }, 'glow', [0, 1, 3, 4, 6]);
  doorway(r, fs, 0.56, 0.48, 0.18, 0.24);
  // upper floor (set back), labs with lit windows
  const ux = -0.22;
  const uz = -0.3;
  r.box(M.offwhite, 1.0, 0.34, 0.74, ux, top + 0.17, uz, { b: 0.02 });
  r.box(M.team, 1.04, 0.03, 0.78, ux, top + 0.33, uz, { b: 0.008 });
  r.box(fs.roof, 0.98, 0.02, 0.72, ux, top + 0.35, uz, { b: 0.004 });
  windows(r, 4, 0.18, 0.12, 0.05, [ux, top + 0.17, uz + 0.372], [0, 0, 0], { glow: 0x9fe2ff, i: 0.9 }, 'glow', [0, 2, 3]);
  sloganBoard(r, 'allies', 'RESEARCH', 0.5, 0.1, [ux, top + 0.04, 0.47], 0, false);
  banner(r, 'allies', 0.2, 0.42, [-0.68, top - 0.04, 0.5], 0);
  hazard(r, 1.5, 0.04, [0, y0 + 0.06, 0.5]);
  // observatory dome (right back) with a slit
  r.cyl(M.offwhite, 0.26, 0.26, 0.1, 0.52, top + 0.05, -0.42, { seg: 20 });
  r.add(new THREE.SphereGeometry(0.26, 14, 5, 0, Math.PI * 2, 0, Math.PI / 2), M.white, { p: [0.52, top + 0.1, -0.42] });
  r.box(M.dark, 0.07, 0.02, 0.3, 0.52, top + 0.3, -0.42, { b: 0.004, r: [0.7, 0, 0] });
  r.add(ringGeo(0.255, 0.27, 0.03, 20), M.team, { p: [0.52, top + 0.1, -0.42] });
  // rotating satellite dish + antenna array on the upper roof
  const dsh = r.node('dish', [ux - 0.3, top + 0.36, uz - 0.1]);
  dsh.cyl(M.gun, 0.02, 0.03, 0.12, 0, 0.06, 0, { seg: 8 });
  dsh.add(lathe([[0.0, 0.0], [0.08, 0.012], [0.15, 0.04], [0.19, 0.07]], 16), M.white, { p: [0.03, 0.15, 0], r: [0, 0, 1.0] });
  dsh.cyl(M.dark, 0.005, 0.005, 0.14, 0.07, 0.2, 0, { r: [0, 0, 1.0], seg: 5 });
  for (let i = 0; i < 3; i++) antenna(r, ux + 0.12 + i * 0.12, top + 0.36, uz + 0.1, 0.25 + i * 0.07);
  dish(r, ux + 0.3, top + 0.36, uz - 0.18, 0.08, -0.6, 0.6);
  warnLight(r, [ux + 0.46, top + 0.4, uz - 0.33], false, 0.016, { glow: 0xff3020, i: 2.2 });
  floodlight(r, [0.75, top + 0.02, 0.44], 0, 0.9);
  floodlight(r, [-0.75, top + 0.02, 0.44], 0, 0.9);
  acUnit(r, 0.5, top, 0.14, 0, 1);
  // yard: gas cylinders, crates
  for (const x of [-0.85, -0.74]) {
    r.cyl(M.offwhite, 0.045, 0.045, 0.2, x, y0 + 0.1, 0.78, { seg: 10 });
    r.sph(M.offwhite, 0.045, x, y0 + 0.2, 0.78, { seg: 8 });
    r.add(ringGeo(0.045, 0.05, 0.02, 10), M.team, { p: [x, y0 + 0.14, 0.78] });
  }
  crateStack(r, 0.8, y0, 0.78, 0.09, 2, 0.3);

  return makeTemplate({
    root: r,
    height: 1.15,
    radius: 1.05,
    muzzles: [],
    glow: { glow: 1.8 },
    anim: sAnim((c, s) => {
      if (s.powered) c.n.dish.rotation.y = Math.sin(s.time * 0.3 + c.v.seed) * 1.6;
    }),
  });
}

// =============================================================================================
// Soviet tech center (3x3)
// =============================================================================================

function sovietTech(): ModelTemplate {
  const r = root(3, 3, M.concreteDark);
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
  r.add(prismXZ(oct(1.35, 0.85, 0.12), 0.46, 0.04), S.sovWall, { p: [0, y0, -0.35] });
  r.add(prismXZ(oct(1.3, 0.8, 0.1), 0.05, 0.015), M.team, { p: [0, y0 + 0.44, -0.35] });
  r.add(prismXZ(oct(1.22, 0.72, 0.08), 0.02, 0.006), M.concreteDark, { p: [0, y0 + 0.48, -0.35] });
  // stepped central tower with spire and glowing star
  const tz = -0.5;
  r.add(prismXZ(oct(0.42, 0.36, 0.08), 0.42, 0.03), S.sovWall, { p: [0, y0 + 0.48, tz] });
  r.add(prismXZ(oct(0.45, 0.39, 0.09), 0.05, 0.015), M.team, { p: [0, y0 + 0.88, tz] });
  r.add(prismXZ(oct(0.41, 0.35, 0.08), 0.012, 0), S.roofTar, { p: [0, y0 + 0.93, tz] }); // roof inside the trim
  r.add(prismXZ(oct(0.3, 0.26, 0.06), 0.24, 0.02), S.sovWall, { p: [0, y0 + 0.93, tz] });
  r.add(prismXZ(oct(0.33, 0.29, 0.07), 0.04, 0.012), M.team, { p: [0, y0 + 1.15, tz] });
  r.add(prismXZ(oct(0.29, 0.25, 0.06), 0.012, 0), S.roofTar, { p: [0, y0 + 1.19, tz] });
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
  r.add(new THREE.SphereGeometry(0.33, 14, 5, 0, Math.PI * 2, 0, Math.PI / 2), shade(M.glassBlue, 0x3a7a6a), { p: [dx, y0 + 0.56, dz] });
  for (let i = 0; i < 3; i++) {
    r.add(new THREE.TorusGeometry(0.332, 0.008, 3, 12, Math.PI), M.gun, { p: [dx, y0 + 0.56, dz], r: [0, (i * Math.PI) / 3, 0] });
  }
  // radio masts (right)
  radioMast(r, 0.98, y0 + 0.5, -0.8, 0.8);
  radioMast(r, 0.72, y0 + 0.5, -0.25, 0.55);
  // dressing: banners, slogan, red lights, roof plant
  banner(r, 'soviet', 0.22, 0.38, [-0.3, y0 + 0.44, 0.508], 0);
  banner(r, 'soviet', 0.22, 0.38, [0.3, y0 + 0.44, 0.508], 0);
  sloganBoard(r, 'soviet', 'НАУКА СИЛА', 0.62, 0.11, [0, y0 + 0.82, tz + 0.37], 0, false);
  for (const [x, z] of [[-1.3, -1.12], [1.3, -1.12], [-1.3, 0.42], [1.3, 0.42]]) warnLight(r, [x, y0 + 0.53, z], false, 0.018);
  lightRing(r, 0, y0 + 1.2, tz, 0.3, 6);
  acUnit(r, -0.25, y0 + 0.5, -0.95, 0, 1);
  acUnit(r, 0.25, y0 + 0.5, -1.0, 0, 1);
  pipeRun(r, [[-0.55, y0 + 0.62, 0.2], [-0.55, y0 + 0.62, -0.2], [-0.42, y0 + 0.62, -0.2]], 0.03, S.rust);
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
    glow: { glow: 2, 'glow:star': 3.5, 'glow:core': 3.5 },
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

function helipad(fac: Fac = 'allies'): ModelTemplate {
  const fs = FSTYLE[fac];
  const sov = fac === 'soviet';
  const r = root(2, 2, M.concreteDark);
  const y0 = 0.04;
  const ph = 0.07;
  // raised pad with an edge kerb, the H and a ring
  r.box(fs.wallDark, 1.66, ph, 1.66, -0.04, y0 + ph / 2, 0.04, { b: 0.02 });
  r.box(M.asphalt, 1.56, 0.01, 1.56, -0.04, y0 + ph + 0.002, 0.04, { b: 0 });
  r.add(ringGeo(0.58, 0.64, 0.006, 32), M.yellow, { p: [-0.04, y0 + ph + 0.008, 0.04] });
  r.box(M.white, 0.08, 0.006, 0.5, -0.21, y0 + ph + 0.009, 0.04, { b: 0 });
  r.box(M.white, 0.08, 0.006, 0.5, 0.13, y0 + ph + 0.009, 0.04, { b: 0 });
  r.box(M.white, 0.3, 0.006, 0.08, -0.04, y0 + ph + 0.009, 0.04, { b: 0 });
  for (const s of [-1, 1]) hazard(r, 1.5, 0.06, [-0.04, y0 + ph + 0.009, 0.04 + 0.74 * s], [-Math.PI / 2, 0, 0]);
  // edge lights (chase ring) and corner beacons
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    r.sph(G.white, 0.011, -0.04 + Math.cos(a) * 0.7, y0 + ph + 0.012, 0.04 + Math.sin(a) * 0.7, { seg: 6, slot: 'glow:ring' });
  }
  for (const [x, z] of [[-0.8, -0.72], [0.72, -0.72], [-0.8, 0.8], [0.72, 0.8]]) {
    r.cyl(M.dark, 0.026, 0.03, 0.04, x, y0 + ph + 0.02, z, { seg: 8 });
    warnLight(r, [x, y0 + ph + 0.06, z], false, 0.018, sov ? undefined : { glow: 0x40c8ff, i: 2.2 });
  }
  // control hut (back right corner) with a radio mast, fuel pump, windsock
  const cx = 0.78;
  const cz = -0.76;
  r.box(fs.wall, 0.34, 0.3, 0.3, cx, y0 + 0.15, cz, { b: 0.012 });
  r.box(M.team, 0.37, 0.025, 0.33, cx, y0 + 0.31, cz, { b: 0.006 });
  r.box(fs.roof, 0.33, 0.02, 0.29, cx, y0 + 0.325, cz, { b: 0.004 });
  windows(r, 2, 0.08, 0.08, 0.05, [cx, y0 + 0.2, cz + 0.152], [0, 0, 0], fs.win, 'glow', [0]);
  radioMast(r, cx + 0.08, y0 + 0.335, cz - 0.06, 0.4);
  // fuel tanks on a cradle (left back)
  for (const z of [-0.66, -0.48]) {
    r.cyl(sov ? S.sovSteelLight : M.offwhite, 0.07, 0.07, 0.36, -0.86, y0 + 0.1, z, { r: [0, 0, Math.PI / 2], seg: 12 });
    r.add(ringGeo(0.07, 0.075, 0.02, 12), M.team, { p: [-0.86, y0 + 0.1, z], r: [0, 0, Math.PI / 2] });
  }
  r.box(M.dark, 0.38, 0.03, 0.28, -0.86, y0 + 0.02, -0.57, { b: 0 });
  pipeRun(r, [[-0.68, y0 + 0.1, -0.57], [-0.6, y0 + 0.1, -0.57], [-0.6, y0 + 0.02, -0.4]], 0.015, M.steel);
  r.cyl(M.steel, 0.008, 0.01, 0.42, 0.86, y0 + 0.21, 0.86, { seg: 6 });
  const sock = r.node('sock', [0.86, y0 + 0.4, 0.86]);
  sock.add(new THREE.CylinderGeometry(0.018, 0.035, 0.14, 5, 1, true), M.red, { p: [0.07, 0, 0], r: [0, 0, Math.PI / 2] });
  sock.add(new THREE.CylinderGeometry(0.0181, 0.0251, 0.05, 5, 1, true), M.white, { p: [0.11, 0, 0], r: [0, 0, Math.PI / 2] });
  // faction marking on the pad, gear by the hut
  if (sov) emblem(r, fac, 0.07, [-0.04, y0 + ph + 0.012, 0.52], [-Math.PI / 2, 0, 0]);
  else emblem(r, fac, 0.06, [-0.04, y0 + ph + 0.012, 0.52], [-Math.PI / 2, 0, 0], true);
  crateStack(r, 0.5, y0, -0.82, 0.08, 2, 0.2);
  drums(r, 0.84, y0, -0.36, 3);
  floodlight(r, [cx - 0.12, y0 + 0.34, cz + 0.13], -0.6, 0.9);

  return makeTemplate({
    root: r,
    height: 0.5,
    radius: 1.05,
    muzzles: [],
    glow: { glow: 2, 'glow:ring': 3 },
    anim: sAnim((c, s) => {
      c.n.sock.rotation.y = Math.sin(s.time * 0.7 + c.v.seed) * 0.4 + 0.6;
      c.setGlow('glow:ring', s.powered ? (blink(s.time, 1.0, 0.5, c.v.seed) ? 1 : 0.4) : 0.05);
    }),
  });
}

// =============================================================================================
// Airfield (3x2) — runway strip + hangar + control tower (Soviet)
// =============================================================================================

function airfield(): ModelTemplate {
  const fs = FSTYLE.soviet;
  const r = root(3, 2, M.concreteDark);
  const y0 = 0.04;
  // runway
  r.box(M.asphalt, 2.8, 0.03, 1.08, 0, y0 + 0.015, 0.28, { b: 0.01 });
  for (let i = 0; i < 7; i++) r.box(M.white, 0.22, 0.004, 0.035, -1.2 + i * 0.4, y0 + 0.032, 0.28, { b: 0 });
  for (const z of [-0.22, 0.78]) r.box(M.white, 2.7, 0.004, 0.025, 0, y0 + 0.032, z, { b: 0 });
  for (let i = 0; i < 6; i++) r.box(M.white, 0.06, 0.004, 0.18, -1.3 + i * 0.12, y0 + 0.032, 0.28, { b: 0 });
  stencilText(r, '27', [1.18, y0 + 0.033, 0.28], [-Math.PI / 2, 0, Math.PI / 2], 0.16, M.white);
  for (let i = 0; i < 8; i++) {
    const x = -1.3 + i * 0.37;
    for (const z of [-0.27, 0.83]) r.sph(G.amber, 0.014, x, y0 + 0.04, z, { seg: 6, slot: `glow:run${i % 4}` });
  }
  // hangar (back left): concrete base, dark arched roof with a team stripe, big doors
  const hx = -0.5;
  const hz = -0.62;
  r.box(fs.wallDark, 1.68, 0.06, 0.6, hx, y0 + 0.03, hz, { b: 0.01 });
  r.box(fs.wall, 1.62, 0.34, 0.54, hx, y0 + 0.17, hz, { b: 0.02 });
  r.add(new THREE.CylinderGeometry(0.29, 0.29, 1.66, 12, 1, false, -Math.PI / 2, Math.PI), fs.roof, { p: [hx, y0 + 0.33, hz], r: [-Math.PI / 2, 0, -Math.PI / 2] });
  r.add(new THREE.CylinderGeometry(0.295, 0.295, 1.66, 3, 1, true, -0.09, 0.18), M.team, { p: [hx, y0 + 0.33, hz], r: [-Math.PI / 2, 0, -Math.PI / 2] });
  for (let k = 0; k < 6; k++) r.add(new THREE.TorusGeometry(0.295, 0.009, 3, 10, Math.PI), fs.steel, { p: [hx - 0.75 + k * 0.3, y0 + 0.33, hz], r: [0, Math.PI / 2, 0], lod: 0 });
  r.box(M.darker, 1.24, 0.3, 0.02, hx, y0 + 0.15, hz + 0.276, { b: 0 });
  for (let i = 0; i < 6; i++) r.box(fs.steel, 0.2, 0.3, 0.014, hx - 0.5 + i * 0.2, y0 + 0.15, hz + 0.288, { b: 0.002 });
  hazard(r, 1.3, 0.04, [hx, y0 + 0.32, hz + 0.29]);
  banner(r, 'soviet', 0.16, 0.26, [hx - 0.72, y0 + 0.31, hz + 0.29], 0);
  emblem(r, 'soviet', 0.1, [hx, y0 + 0.47, hz + 0.24], [-0.6, 0, 0]);
  // control tower (back right)
  const tx = 1.02;
  const tz = -0.62;
  block(r, fs, tx, tz, 0.34, 0.34, 0.58, { band: false, roof: 'none' });
  r.add(prismXZ([[-0.21, -0.21], [0.21, -0.21], [0.25, -0.1], [0.25, 0.1], [0.21, 0.21], [-0.21, 0.21], [-0.25, 0.1], [-0.25, -0.1]], 0.15, 0.01), M.glassBlue, { p: [tx, y0 + 0.58, tz] });
  windows(r, 3, 0.1, 0.1, 0.03, [tx, y0 + 0.655, tz + 0.212], [0, 0, 0], fs.win, 'glow', [0, 2]);
  r.box(fs.roof, 0.54, 0.035, 0.48, tx, y0 + 0.75, tz, { b: 0.01 });
  r.box(M.team, 0.55, 0.02, 0.49, tx, y0 + 0.735, tz, { b: 0.005 });
  const radar = r.node('radar', [tx, y0 + 0.77, tz]);
  radar.cyl(M.dark, 0.01, 0.012, 0.08, 0, 0.04, 0, { seg: 6 });
  radar.box(M.gun, 0.03, 0.06, 0.24, 0, 0.1, 0, { b: 0.006 });
  warnLight(r, [tx + 0.22, y0 + 0.79, tz - 0.18], false, 0.016);
  warnLight(r, [tx - 0.22, y0 + 0.79, tz + 0.18], false, 0.016);
  sloganBoard(r, 'soviet', 'АЭРО', 0.3, 0.09, [tx, y0 + 0.44, tz + 0.172], 0, false);
  // fuel bowser tanks + pipes, crates, a lamp post
  for (const z of [-0.22, 0.0]) {
    r.cyl(S.sovSteelLight, 0.07, 0.07, 0.32, 1.22, y0 + 0.1, z - 0.06, { r: [0, 0, Math.PI / 2], seg: 12 });
    r.add(ringGeo(0.07, 0.075, 0.02, 12), M.team, { p: [1.22, y0 + 0.1, z - 0.06], r: [0, 0, Math.PI / 2] });
  }
  crateStack(r, 0.38, y0, -0.82, 0.08, 3, 0.4);
  lampPost(r, 0.3, y0, -0.36, 0.38, 0);

  return makeTemplate({
    root: r,
    height: 0.9,
    radius: 1.4,
    muzzles: [],
    glow: { glow: 2, 'glow:run0': 3.5, 'glow:run1': 3.5, 'glow:run2': 3.5, 'glow:run3': 3.5 },
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

function missileSilo(fac: Fac = 'soviet'): ModelTemplate {
  const fs = FSTYLE[fac];
  const r = root(2, 1, M.concreteDark);
  const y0 = 0.04;
  r.box(fs.wallDark, 1.42, 0.14, 0.84, -0.2, y0 + 0.07, 0, { b: 0.03 });
  // shaft
  r.box(M.darker, 0.5, 0.01, 0.5, -0.2, y0 + 0.141, 0, { b: 0 });
  r.cyl(M.dark, 0.2, 0.2, 0.3, -0.2, y0 - 0.02, 0, { seg: 16, open: true });
  hazard(r, 0.62, 0.05, [-0.2, y0 + 0.145, 0.3], [-Math.PI / 2, 0, 0]);
  hazard(r, 0.62, 0.05, [-0.2, y0 + 0.145, -0.3], [-Math.PI / 2, 0, 0]);
  trefoil(r, 0.06, [-0.72, y0 + 0.145, 0.24]);
  trefoil(r, 0.06, [0.32, y0 + 0.145, -0.26]);
  // missile (rises with door)
  const mis = r.node('missile', [-0.2, y0 - 0.45, 0]);
  mis.cyl(M.white, 0.1, 0.1, 0.5, 0, 0.25, 0, { seg: 14 });
  mis.add(lathe([[0.1, 0], [0.09, 0.08], [0.06, 0.16], [0.0, 0.24]], 14), M.red, { p: [0, 0.5, 0] });
  mis.add(ringGeo(0.1, 0.104, 0.04, 14), M.team, { p: [0, 0.35, 0] });
  // doors slide apart along X
  const dl = r.node('doorL', [-0.2, y0 + 0.15, 0]);
  dl.box(fs.steel, 0.27, 0.04, 0.56, -0.135, 0.02, 0, { b: 0.01 });
  for (let i = 0; i < 4; i++) dl.box(M.dark, 0.012, 0.042, 0.5, -0.04 - i * 0.06, 0.02, 0, { b: 0 });
  dl.box(M.team, 0.02, 0.043, 0.56, -0.012, 0.02, 0, { b: 0 });
  const dr = r.node('doorR', [-0.2, y0 + 0.15, 0]);
  dr.box(fs.steel, 0.27, 0.04, 0.56, 0.135, 0.02, 0, { b: 0.01 });
  for (let i = 0; i < 4; i++) dr.box(M.dark, 0.012, 0.042, 0.5, 0.04 + i * 0.06, 0.02, 0, { b: 0 });
  dr.box(M.team, 0.02, 0.043, 0.56, 0.012, 0.02, 0, { b: 0 });
  // control bunker (right)
  const top = block(r, fs, 0.68, -0.05, 0.42, 0.6, 0.34);
  windows(r, 2, 0.1, 0.06, 0.06, [0.68, y0 + 0.22, 0.252], [0, 0, 0], { glow: 0xff3a20, i: 1.2 });
  emblem(r, fac, 0.05, [0.68, y0 + 0.11, 0.252], [0, 0, 0], true);
  radioMast(r, 0.78, top, -0.2, 0.36);
  for (const [x, z] of [[0.55, 0.15], [-0.88, 0.36], [0.48, -0.36]]) lamp(r, G.red, [x, z === 0.15 ? top + 0.04 : y0 + 0.16, z], 0.02, 'glow:warn');
  pipeRun(r, [[0.47, y0 + 0.1, -0.2], [0.1, y0 + 0.1, -0.2]], 0.02, M.dark);

  return makeTemplate({
    root: r,
    height: 0.55,
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
  r.add(prismXZ(oct(0.66), 0.08, 0.02), S.sovSteel, { p: [0, y0 + 0.1, 0] }); // steel step, team edge band
  r.add(ringGeo(0.6, 0.64, 0.02, 8), M.team, { p: [0, y0 + 0.17, 0], r: [0, Math.PI / 8, 0] });
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
  // dressing: hazard edge, warning lights at the octagon corners, cable runs, banner posts
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    warnLight(r, [Math.cos(a) * 0.82, y0 + 0.125, Math.sin(a) * 0.82], i % 2 === 0, 0.016);
  }
  hazard(r, 0.5, 0.035, [0, y0 + 0.05, 0.8], [0, 0, 0]);
  for (const s of [-1, 1]) {
    r.cyl(M.dark, 0.012, 0.015, 0.7, s * 0.86, y0 + 0.35, 0.86, { seg: 6 });
    banner(r, 'soviet', 0.16, 0.34, [s * 0.86, y0 + 0.66, 0.875], 0);
    pipeRun(r, [[s * 0.15, y0 + 0.1, 0.78], [s * 0.4, y0 + 0.1, 0.5], [s * 0.42, y0 + 0.2, 0.42]], 0.012, M.dark);
  }

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
  r.cyl(S.allSteel, 0.7, 0.75, 0.06, 0, y0 + 0.13, 0, { seg: 32 }); // steel deck, team edge band
  r.add(ringGeo(0.66, 0.71, 0.02, 32), M.team, { p: [0, y0 + 0.155, 0] });
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
  ringA.add(new THREE.TorusGeometry(0.42, 0.03, 5, 22), M.steel);
  ringA.add(new THREE.TorusGeometry(0.42, 0.034, 4, 6, Math.PI * 0.3), M.team, { r: [0, 0, 0.3] });
  ringA.add(new THREE.TorusGeometry(0.42, 0.034, 4, 6, Math.PI * 0.3), M.team, { r: [0, 0, 0.3 + Math.PI] });
  const ringB = ringA.node('ringB', [0, 0, 0], [0, 0, 0]);
  ringB.add(new THREE.TorusGeometry(0.34, 0.025, 5, 20), M.offwhite, { r: [Math.PI / 2, 0, 0] });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    ringB.sph(G.cyan, 0.016, Math.cos(a) * 0.34, 0, Math.sin(a) * 0.34, { seg: 6, slot: 'glow:core' });
  }
  const ringC = ringB.node('ringC', [0, 0, 0]);
  ringC.add(new THREE.TorusGeometry(0.28, 0.018, 4, 16), M.team, { r: [0, Math.PI / 2, 0] });
  const halo = r.node('halo', [0, cy, 0]);
  halo.add(new THREE.PlaneGeometry(1.1, 1.1), M.dark, { slot: 'fx:add:3a8cff:0.9', keepUv: true, r: [-Math.PI / 2, 0, 0] });
  // consoles
  r.box(M.gun, 0.28, 0.12, 0.1, 0, y0 + 0.16, 0.8, { b: 0.01, r: [-0.3, 0, 0] });
  r.box(G.cyan, 0.22, 0.05, 0.005, 0, y0 + 0.18, 0.85, { b: 0, r: [-0.3, 0, 0], slot: 'glow' });
  alliedStar(r, 0.07, [0, y0 + 0.161, 0.6]);
  // dressing: floodlight masts, capacitor cabinets, hazard edge, cable runs
  for (const [x, z] of [[-0.86, -0.86], [0.86, -0.86]]) {
    r.cyl(M.dark, 0.012, 0.016, 0.62, x, y0 + 0.31, z, { seg: 6 });
    floodlight(r, [x, y0 + 0.62, z + 0.02], Math.atan2(-x, -z) + Math.PI, 0.7, 0.045);
  }
  for (const s of [-1, 1]) {
    r.box(M.offwhite, 0.18, 0.22, 0.14, s * 0.78, y0 + 0.11, 0.7, { b: 0.012 });
    r.box(M.team, 0.19, 0.02, 0.15, s * 0.78, y0 + 0.2, 0.7, { b: 0.004 });
    r.box({ glow: 0x4ad8ff, i: 1.6, a: 2 + (s > 0 ? 0.5 : 0) }, 0.1, 0.05, 0.004, s * 0.78, y0 + 0.12, 0.772, { b: 0 });
    pipeRun(r, [[s * 0.7, y0 + 0.04, 0.62], [s * 0.45, y0 + 0.04, 0.45]], 0.012, M.dark);
  }
  hazard(r, 0.8, 0.035, [0, y0 + 0.101, 0.86], [-Math.PI / 2, 0, 0]);
  emblem(r, 'allies', 0.06, [0, y0 + 0.055, 0.885], [0, 0, 0]);

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

export const STRUCTURE_BUILDERS: Record<string, (fac: ModelFaction) => ModelTemplate> = {
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

