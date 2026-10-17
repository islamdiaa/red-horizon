/**
 * Commander-rules structures and upgrade modules (procedural): the Low preset's models, the fallback while an HD
 * model loads, and the far LOD of the HD models in tools/assets/models/commander.
 *
 *   purf  Ore Purifier (Allies, 2x2)      smlt  Ore Smelter (Soviet, 2x2)
 *   mout  Mining Outpost (2x2, dock under the right column)
 *   lgst  Logistics Centre (3x2)          rlab  Research Lab (3x2)
 *   bnkr  Bunker (2x2, 4 garrison slots)  gate  Fortress Gate (1x1, opens with ModelAnimState.door)
 *
 * Shared types are faction-dressed (models/index.ts keeps one template per owner faction). Same conventions as
 * structures.ts: centred on the footprint, ground y = 0, fronts toward +Z, a concrete slab from y -0.15 to 0.04.
 *
 * Upgrade modules (MODULE_BUILDERS) are small add-on models built around their own origin; upgrade-modules.ts
 * attaches them to a host structure at per-building anchors. Animation channels used by these models:
 *   - bunker: `load` = garrison fill (0..1, a quarter per soldier: helmets in the slits), muzzles m0..m7 =
 *     two slits per side, south (+Z) first, then east, north, west;
 *   - gate: `door` = how far it is open (0..1);
 *   - research lab: `load` = research running (glow, spinning test rig);
 *   - outpost: `harvesting` / `load` like the refinery.
 */
import * as THREE from 'three';
import { NB, makeTemplate, type AnimFn, type Ctx, type Glow, type Mat, type ModelFaction, type ModelTemplate, type V3 } from './builder';
import type { ModelAnimState } from './types';
import {
  M,
  G,
  S,
  FSTYLE,
  type Fac,
  type FStyle,
  acUnit,
  banner,
  chimney,
  crateStack,
  dish,
  drums,
  emblem,
  faceRot,
  floodlight,
  foundation,
  grille,
  hazard,
  ladder,
  lampPost,
  lathe,
  mergeChild,
  orePile,
  parapet,
  pipe,
  pipeRun,
  prismXY,
  quadGeo,
  radioMast,
  railLine,
  ribs,
  ringGeo,
  roofVent,
  sandbags,
  sloganBoard,
  starGeo,
  stencilNumber,
  stencilText,
  warnLight,
  windows,
  discGeo,
} from './parts';
import { approach, blink, dtOf, healthVariant } from './anim';
import { setBodyTime } from './materials';
import { registerFactionDressed } from './structures';

const Y0 = 0.04;
const STRUCT_AO = { h: 0.32, min: 0.52 };

/** Shared types dressed per owner faction (purf / smlt belong to one side each). */
const DRESSED = ['mout', 'lgst', 'rlab', 'bnkr', 'gate'];

// ---------------------------------------------------------------------------------------------
// building blocks (the structures.ts look)
// ---------------------------------------------------------------------------------------------

function root(sx: number, sz: number, slab: Mat = M.concrete): NB {
  const r = new NB('root');
  r.ao = STRUCT_AO;
  r.snow = 1;
  r.cavity = true;
  foundation(r, sx, sz, Y0, 0.05, slab);
  return r;
}

/** Module root: no slab (it stands on its host's), same weathering. */
function modRoot(): NB {
  const r = new NB('root');
  r.ao = STRUCT_AO;
  r.snow = 1;
  r.cavity = true;
  return r;
}

/** Common structure animation: damage scorch, powered glow, blinking beacons, plus `extra`. */
function sAnim(extra?: (c: Ctx, s: ModelAnimState, pw: number) => void): AnimFn {
  return (c, s) => {
    healthVariant(c, s);
    setBodyTime(s.time);
    if (c.v.seed === undefined) c.v.seed = Math.random() * 3;
    const pw = s.powered ? 1 : 0.1;
    c.setPowered(s.powered);
    extra?.(c, s, pw);
  };
}

interface BlockOpts {
  band?: boolean;
  trim?: boolean;
  roof?: 'flat' | 'none';
  wall?: Mat;
  plinth?: number;
  ribs?: number;
  y0?: number;
}

/** Building block centred at (x, z): plinth, walls, steel band, team cornice, roof + parapet. Returns the roof top y. */
function block(nb: NB, fs: FStyle, x: number, z: number, w: number, d: number, h: number, o: BlockOpts = {}): number {
  const y0 = o.y0 ?? Y0;
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

/** Recessed doorway on a +Z wall plane (after rotY) at (x, zf): frame, dark door, lamp above. */
function doorway(nb: NB, fs: FStyle, x: number, zf: number, w: number, h: number, rotY = 0, y0 = Y0): void {
  const n = new NB('_door', [x, 0, zf], [0, rotY, 0]);
  n.box(fs.wallDark, w + 0.07, h + 0.05, 0.03, 0, y0 + (h + 0.05) / 2, 0.012, { b: 0.008 });
  n.box(M.darker, w, h, 0.02, 0, y0 + h / 2, 0.02, { b: 0 });
  n.box(fs.steel, w * 0.46, h * 0.94, 0.012, -w * 0.25, y0 + h * 0.47, 0.03, { b: 0.003 });
  n.box(fs.steel, w * 0.46, h * 0.94, 0.012, w * 0.25, y0 + h * 0.47, 0.03, { b: 0.003 });
  n.box(M.team, w + 0.1, 0.02, 0.06, 0, y0 + h + 0.06, 0.03, { b: 0.005 });
  n.add(new THREE.OctahedronGeometry(0.014, 0), fs.fac === 'soviet' ? { glow: 0xffb050, i: 2 } : { glow: 0xf4f0ff, i: 2 }, { p: [0, y0 + h + 0.08, 0.06] });
  mergeChild(nb, n);
}

/** Window row with sills on a +Z wall plane (after rotY), centred at x on wall z. */
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

/** Faction slogan board: Soviet red two-line board, Allied navy one-line board. */
function slogan(nb: NB, fac: Fac, sov: [string, string], all: string, w: number, h: number, p: V3, rotY = 0): void {
  if (fac === 'soviet') sloganBoard(nb, fac, '', w, h, p, rotY, true, sov);
  else sloganBoard(nb, fac, all, w, h * 0.6, p, rotY, true);
}

/** Emissive strip (lit band, glow port), baked into the body; `a` = shader animation (2 pulse, 3 flicker). */
function glowStrip(nb: NB, color: number, i: number, a: number, w: number, h: number, p: V3, r: V3 = [0, 0, 0]): void {
  nb.add(quadGeo(w, h), { glow: color, i, a }, { p, r });
}

/** A steel cylinder tank lying along X (Allied white, Soviet dark steel), with saddles and team bands. */
function tankX(nb: NB, fs: FStyle, x: number, y: number, z: number, len: number, rad: number): void {
  const mat = fs.fac === 'soviet' ? S.sovSteelLight : M.white;
  nb.cyl(mat, rad, rad, len, x, y + rad + 0.03, z, { r: [0, 0, Math.PI / 2], seg: 12 });
  for (const s of [-1, 1]) {
    nb.add(lathe([[rad, 0], [rad * 0.6, rad * 0.25], [0, rad * 0.32]], 12), mat, { p: [x + s * len / 2, y + rad + 0.03, z], r: [0, 0, -s * Math.PI / 2] });
    nb.box(fs.wallDark, 0.05, rad + 0.03, rad * 1.6, x + s * len * 0.3, y + (rad + 0.03) / 2, z, { b: 0.006 });
  }
  nb.cyl(M.team, rad + 0.006, rad + 0.006, 0.035, x - len * 0.15, y + rad + 0.03, z, { r: [0, 0, Math.PI / 2], seg: 12 });
}

/** A shipping container (team, olive or blue) on the ground or a stack. */
function container(nb: NB, x: number, y: number, z: number, len: number, mat: Mat, rotY = 0): void {
  const n = new NB('_ct', [x, y, z], [0, rotY, 0]);
  const h = 0.16;
  const w = 0.17;
  n.box(mat, len, h, w, 0, h / 2, 0, { b: 0.008 });
  n.lod = 0;
  for (let i = 0; i < Math.round(len / 0.05); i++) n.box(mat, 0.012, h - 0.03, w + 0.008, -len / 2 + 0.03 + i * 0.05, h / 2, 0, { b: 0 });
  n.box(M.dark, 0.008, h - 0.02, w - 0.02, len / 2 + 0.002, h / 2, 0, { b: 0 });
  mergeChild(nb, n);
}

/** Lattice tower crane: mast at (x, z) of height h, a slewing jib node `name` (jib along +X) with a counter-jib. */
function towerCrane(nb: NB, name: string, x: number, z: number, y0: number, h: number, jib: number, mat: Mat = M.yellow, rotY = 0.8): NB {
  nb.box(M.concreteDark, 0.2, 0.05, 0.2, x, y0 + 0.025, z, { b: 0.01 });
  const s = 0.045;
  for (const [dx, dz] of [[-s, -s], [s, -s], [-s, s], [s, s]]) nb.box(mat, 0.018, h, 0.018, x + dx, y0 + 0.05 + h / 2, z + dz, { b: 0 });
  const n = Math.round(h / 0.1);
  for (let i = 0; i < n; i++) {
    const y = y0 + 0.08 + i * (h / n);
    const a = i % 2 ? 0.7 : -0.7;
    nb.box(mat, s * 2.4, 0.008, 0.008, x, y, z - s, { b: 0, r: [0, 0, a] });
    nb.box(mat, s * 2.4, 0.008, 0.008, x, y, z + s, { b: 0, r: [0, 0, a] });
    nb.box(mat, 0.008, 0.008, s * 2.4, x - s, y, z, { b: 0, r: [a, 0, 0] });
    nb.box(mat, 0.008, 0.008, s * 2.4, x + s, y, z, { b: 0, r: [a, 0, 0] });
  }
  const c = nb.node(name, [x, y0 + 0.05 + h, z], [0, rotY, 0]);
  c.box(mat, 0.13, 0.08, 0.13, 0, 0.04, 0, { b: 0.01 });
  c.box(M.glassBlue, 0.06, 0.05, 0.08, 0.05, 0.05, 0.075, { b: 0.006 });
  c.box(mat, jib, 0.016, 0.016, jib / 2, 0.09, -0.028, { b: 0 });
  c.box(mat, jib, 0.016, 0.016, jib / 2, 0.09, 0.028, { b: 0 });
  c.box(mat, jib, 0.016, 0.016, jib / 2, 0.14, 0, { b: 0 });
  for (let i = 0; i < Math.round(jib / 0.12); i++) {
    const xx = 0.05 + i * 0.12;
    c.box(mat, 0.008, 0.06, 0.008, xx, 0.115, -0.028, { b: 0, r: [0, 0, 0.6] });
    c.box(mat, 0.008, 0.06, 0.008, xx, 0.115, 0.028, { b: 0, r: [0, 0, -0.6] });
  }
  c.box(mat, 0.3, 0.025, 0.05, -0.15, 0.09, 0, { b: 0.005 });
  c.box(M.concreteDark, 0.1, 0.08, 0.08, -0.27, 0.07, 0, { b: 0.01 });
  c.cyl(mat, 0.01, 0.01, 0.15, 0, 0.18, 0, { seg: 5 });
  pipe(c, [0, 0.26, 0], [jib * 0.9, 0.15, 0], 0.003, M.steel, 3);
  pipe(c, [0, 0.26, 0], [-0.25, 0.11, 0], 0.003, M.steel, 3);
  warnLight(c, [0, 0.275, 0], false, 0.013);
  warnLight(c, [jib, 0.12, 0], false, 0.012);
  c.box(M.dark, 0.05, 0.02, 0.07, jib * 0.72, 0.075, 0, { b: 0 });
  c.cyl(M.steel, 0.003, 0.003, 0.36, jib * 0.72, -0.11, 0, { seg: 3 });
  c.box(M.dark, 0.03, 0.035, 0.03, jib * 0.72, -0.3, 0, { b: 0.005 });
  return c;
}

/** Infantry silhouette (helmet + shoulders) for bunker slits and training yards, facing +Z. */
function soldier(nb: NB, mat: Mat, helmet: Mat, x: number, y: number, z: number, rotY = 0): void {
  const n = new NB('_sol', [x, y, z], [0, rotY, 0]);
  n.box(mat, 0.07, 0.05, 0.04, 0, 0.025, 0, { b: 0.01 });
  n.sph(M.skin, 0.017, 0, 0.065, 0.004, { seg: 6 });
  n.add(lathe([[0.03, 0], [0.026, 0.014], [0.012, 0.024], [0, 0.026]], 8), helmet, { p: [0, 0.07, 0] });
  mergeChild(nb, n);
}

// =============================================================================================
// Ore Purifier (Allies, 2x2): distillation columns, a pressure sphere, a purification hall with glowing vats
// =============================================================================================

function orePurifier(): ModelTemplate {
  const fs = FSTYLE.allies;
  const fac: Fac = 'allies';
  const r = root(2, 2);
  // ---- purification hall (front left): white cladding, a glazed roof over the glowing vats
  const hx = -0.24;
  const hz = 0.34;
  const hw = 1.3;
  const hd = 0.7;
  const hh = 0.46;
  block(r, fs, hx, hz, hw, hd, hh, { roof: 'none', ribs: 6 });
  const top = Y0 + hh;
  const fz = hz + hd / 2;
  // sloped glass roof light (lit cyan from the vats below)
  r.box(fs.roof, hw - 0.03, 0.02, hd - 0.03, hx, top + 0.005, hz, { b: 0.004 });
  parapet(r, fs.wallDark, hw + 0.02, hd + 0.02, top - 0.005, hx, hz, 0.05, 0.03);
  for (let i = 0; i < 3; i++) {
    const x = hx - hw / 2 + 0.24 + i * 0.4;
    r.add(prismXY([[-0.16, 0], [0.16, 0], [0.0, 0.16]], hd - 0.14, 0.008), fs.steel, { p: [x, top + 0.015, hz], r: [0, 0, 0] });
    r.add(quadGeo(0.2, hd - 0.18), { glow: 0x5ae0ff, i: 1.3, a: 2 + i * 0.3 }, { p: [x + 0.08, top + 0.1, hz], r: [-Math.PI / 2, 0.79, 0] });
    r.box(M.team, 0.02, 0.02, hd - 0.1, x, top + 0.18, hz, { b: 0.004 });
  }
  slogan(r, fac, ['', ''], 'ORE PURIFICATION', 0.86, 0.24, [hx + 0.02, Y0 + 0.36, fz + 0.012]);
  winRow(r, fs, 4, 0.09, 0.08, 0.06, hx - 0.12, Y0 + 0.18, fz, 0, [0, 1, 3]);
  doorway(r, fs, hx + 0.48, fz, 0.18, 0.24);
  hazard(r, hw - 0.1, 0.045, [hx, Y0 + 0.07, fz + 0.022]);
  cornerLights(r, fs, hx, hz, hw, hd, top);
  floodlight(r, [hx - hw / 2 + 0.06, top + 0.05, fz - 0.03], 0, 0.85);
  // ---- distillation columns (back left): tall white columns with blue bands, catwalk rings, ladders
  const cols: [number, number, number, number][] = [[-0.66, -0.52, 0.15, 1.42], [-0.26, -0.66, 0.12, 1.12]];
  for (const [x, z, rad, h] of cols) {
    r.cyl(fs.wallDark, rad + 0.05, rad + 0.06, 0.08, x, Y0 + 0.04, z, { seg: 14 });
    r.cyl(M.white, rad, rad, h, x, Y0 + 0.08 + h / 2, z, { seg: 14 });
    for (const f of [0.22, 0.5, 0.78]) r.cyl(M.team, rad + 0.01, rad + 0.01, 0.04, x, Y0 + 0.08 + h * f, z, { seg: 14 });
    r.add(ringGeo(rad, rad + 0.07, 0.012, 14), S.grating, { p: [x, Y0 + 0.08 + h * 0.64, z] });
    r.add(new THREE.TorusGeometry(rad + 0.065, 0.004, 3, 14), fs.rail, { p: [x, Y0 + 0.14 + h * 0.64, z], r: [Math.PI / 2, 0, 0] });
    r.add(lathe([[rad, 0], [rad * 0.6, 0.06], [0.03, 0.09]], 14), fs.steelLight, { p: [x, Y0 + 0.08 + h, z] });
    r.cyl(M.gun, 0.025, 0.025, 0.08, x, Y0 + 0.08 + h + 0.12, z, { seg: 6 });
    ladder(r, h, [x + rad * 0.72, Y0 + 0.08, z + rad * 0.72], Math.PI / 4);
    // sight glass glowing cyan
    glowStrip(r, 0x5ae0ff, 1.6, 2.4, 0.04, 0.16, [x, Y0 + 0.08 + h * 0.36, z + rad + 0.004]);
  }
  warnLight(r, [-0.66, Y0 + 0.08 + 1.42 + 0.17, -0.52], false, 0.016);
  // vapour lines from the column tops into the hall roof
  pipeRun(r, [[-0.66, Y0 + 1.25, -0.37], [-0.66, Y0 + 1.25, -0.2], [-0.66, top + 0.06, -0.2]], 0.026, M.steel);
  pipeRun(r, [[-0.26, Y0 + 0.95, -0.54], [-0.26, Y0 + 0.95, -0.2], [-0.26, top + 0.06, -0.2]], 0.022, M.steel);
  // ---- pressure sphere on legs (back right) + feed line, a team band and a roundel
  const sx = 0.46;
  const sz = -0.52;
  const sr = 0.27;
  const sy = Y0 + 0.34;
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    pipe(r, [sx + Math.cos(a) * sr * 0.85, Y0, sz + Math.sin(a) * sr * 0.85], [sx + Math.cos(a) * sr * 0.8, sy, sz + Math.sin(a) * sr * 0.8], 0.016, fs.steel, 5);
  }
  r.sph(M.white, sr, sx, sy + sr * 0.6, sz, { seg: 14 });
  r.cyl(M.team, sr + 0.006, sr + 0.006, 0.05, sx, sy + sr * 0.6, sz, { seg: 14 });
  r.add(ringGeo(sr * 0.98, sr * 1.04, 0.014, 14), fs.steel, { p: [sx, sy + sr * 0.18, sz] });
  emblem(r, fac, 0.07, [sx, sy + sr * 0.92, sz + sr * 0.82], [-0.6, 0, 0], true);
  warnLight(r, [sx, sy + sr * 1.62, sz], false, 0.016, { glow: 0xf0f4ff, i: 2.4 });
  pipeRun(r, [[sx - sr, sy + 0.1, sz], [0.1, sy + 0.1, sz], [0.1, top + 0.06, -0.02]], 0.03, M.steel);
  // ---- ore intake (front right): hopper over a conveyor into the hall
  const ix = 0.68;
  const iz = 0.5;
  r.box(fs.wallDark, 0.36, 0.06, 0.4, ix, Y0 + 0.03, iz, { b: 0.01 });
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) r.box(fs.steel, 0.025, 0.3, 0.025, ix + dx * 0.12, Y0 + 0.15, iz + dz * 0.13, { b: 0 });
  r.add(lathe([[0.06, 0], [0.19, 0.18], [0.2, 0.22]], 4), fs.steelLight, { p: [ix, Y0 + 0.28, iz], r: [0, Math.PI / 4, 0] });
  orePile(r, ix, Y0 + 0.36, iz, 0.13, 0.06, 4);
  r.box(fs.steel, 0.5, 0.06, 0.12, ix - 0.3, Y0 + 0.24, iz - 0.02, { b: 0.008, r: [0, 0, -0.35] });
  hazard(r, 0.3, 0.04, [ix, Y0 + 0.1, iz + 0.21]);
  // purified output: gold-glinting ingot crates by the door
  for (let i = 0; i < 3; i++) r.box({ c: 0xd7b04a, m: 0.85, r: 0.3, d: 3 }, 0.1, 0.03, 0.05, 0.26 + (i % 2) * 0.11, Y0 + 0.015 + Math.floor(i / 2) * 0.03, 0.86, { b: 0.006 });
  lampPost(r, 0.9, Y0, 0.86, 0.38, -Math.PI / 2);
  drums(r, 0.85, Y0, -0.05, 3, { c: 0x2f5f9a, m: 0.4, r: 0.6, d: 0 });

  return makeTemplate({
    root: r,
    height: 1.55,
    radius: 1.05,
    muzzles: [],
    glow: { glow: 1.6 },
    anim: sAnim(),
  });
}

// =============================================================================================
// Ore Smelter (Soviet, 2x2): blast furnace with a glowing tap hole, skip hoist, casting house, banded stack
// =============================================================================================

function oreSmelter(): ModelTemplate {
  const fs = FSTYLE.soviet;
  const fac: Fac = 'soviet';
  const r = root(2, 2, M.concreteDark);
  const molten: Glow = { glow: 0xff6a18, i: 2.6, a: 3 };
  // ---- blast furnace (back left): tapered riveted shell on a heavy base, bustle ring, top gear, downcomer
  const fx = -0.42;
  const fzz = -0.42;
  r.box(fs.wallDark, 0.78, 0.18, 0.78, fx, Y0 + 0.09, fzz, { b: 0.02 });
  r.add(lathe([[0.33, 0], [0.34, 0.22], [0.3, 0.5], [0.24, 0.86], [0.2, 1.0]], 16), S.sovSteel, { p: [fx, Y0 + 0.18, fzz] });
  for (const [y, rr] of [[0.2, 0.345], [0.46, 0.31], [0.72, 0.27]] as [number, number][]) r.cyl(M.dark, rr, rr, 0.03, fx, Y0 + 0.18 + y, fzz, { seg: 16 });
  r.cyl(M.team, 0.29, 0.31, 0.06, fx, Y0 + 0.18 + 0.58, fzz, { seg: 16 });
  r.add(new THREE.TorusGeometry(0.37, 0.035, 6, 16), S.rust, { p: [fx, Y0 + 0.36, fzz], r: [Math.PI / 2, 0, 0] });
  // top gear: platform, a charging bell house, uptakes
  const ft = Y0 + 1.18;
  r.cyl(fs.steel, 0.24, 0.22, 0.06, fx, ft + 0.03, fzz, { seg: 14 });
  r.box(fs.steel, 0.2, 0.16, 0.2, fx, ft + 0.14, fzz, { b: 0.01 });
  r.box(fs.roof, 0.24, 0.02, 0.24, fx, ft + 0.23, fzz, { b: 0.004 });
  for (const [dx, dz] of [[-0.15, -0.12], [0.15, -0.12]]) pipe(r, [fx + dx, ft, fzz + dz], [fx + dx * 0.4, ft + 0.38, fzz + dz * 0.4], 0.035, S.sovSteelLight, 8);
  pipeRun(r, [[fx - 0.06, ft + 0.36, fzz - 0.05], [fx - 0.06, ft + 0.45, fzz - 0.05], [-0.92, ft + 0.45, fzz - 0.05], [-0.92, Y0 + 0.4, fzz - 0.05]], 0.04, S.rust);
  r.cyl(fs.steel, 0.09, 0.09, 0.32, -0.92, Y0 + 0.24, fzz - 0.05, { seg: 10 });
  railLine(r, [fx - 0.24, ft + 0.06, fzz + 0.24], [fx + 0.24, ft + 0.06, fzz + 0.24], 0.07, fs.rail);
  // tap hole facing the camera: glowing mouth + the molten runner into the casting house
  r.box(M.darker, 0.2, 0.14, 0.06, fx, Y0 + 0.26, fzz + 0.33, { b: 0.01 });
  r.add(quadGeo(0.14, 0.09), molten, { p: [fx, Y0 + 0.26, fzz + 0.364] });
  r.box(M.darker, 0.08, 0.03, 0.42, fx, Y0 + 0.2, fzz + 0.55, { b: 0 });
  r.add(quadGeo(0.05, 0.4), molten, { p: [fx, Y0 + 0.217, fzz + 0.55], r: [-Math.PI / 2, 0, 0] });
  // ---- stack (back right): tall, red banded, crowned with lights
  chimney(r, 'smoke0', 0.55, -0.62, Y0, 1.55, 0.14, 0.1, fac, S.sovSteelLight);
  r.box(fs.wallDark, 0.34, 0.08, 0.34, 0.55, Y0 + 0.04, -0.62, { b: 0.01 });
  pipeRun(r, [[fx + 0.24, ft + 0.3, fzz], [0.4, ft + 0.3, fzz], [0.4, ft + 0.3, -0.62], [0.46, ft + 0.3, -0.62]], 0.04, S.rust);
  // ---- skip hoist: an inclined steel bridge from the ore bin (front right) to the furnace top
  const bx = 0.62;
  const bz = 0.12;
  r.box(fs.wallDark, 0.42, 0.24, 0.4, bx, Y0 + 0.12, bz, { b: 0.015 });
  r.add(lathe([[0.08, 0], [0.18, 0.12], [0.19, 0.16]], 4), fs.steelLight, { p: [bx, Y0 + 0.24, bz], r: [0, Math.PI / 4, 0] });
  orePile(r, bx, Y0 + 0.3, bz, 0.12, 0.05, 5);
  const a = new THREE.Vector3(bx - 0.12, Y0 + 0.3, bz - 0.1);
  const b = new THREE.Vector3(fx + 0.12, ft + 0.18, fzz + 0.02);
  const len = a.distanceTo(b);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const yaw = -Math.atan2(b.z - a.z, b.x - a.x);
  const pitch = Math.atan2(b.y - a.y, Math.hypot(b.x - a.x, b.z - a.z));
  const hoist = new NB('_hoist', [mid.x, mid.y, mid.z], [0, yaw, pitch]);
  hoist.box(fs.steel, len, 0.05, 0.12, 0, 0, 0, { b: 0.006 });
  hoist.box(fs.steel, len, 0.06, 0.012, 0, 0.05, 0.06, { b: 0 });
  hoist.box(fs.steel, len, 0.06, 0.012, 0, 0.05, -0.06, { b: 0 });
  hoist.box(M.team, len * 0.9, 0.012, 0.014, 0, 0.085, 0.062, { b: 0 });
  mergeChild(r, hoist);
  for (const f of [0.3, 0.65]) {
    const p = a.clone().lerp(b, f);
    r.box(fs.steel, 0.03, p.y - Y0 - 0.02, 0.03, p.x, Y0 + (p.y - Y0 - 0.02) / 2, p.z, { b: 0 });
  }
  // ---- casting house (front left): low shed, open bay with the molten glow, ingots outside
  const cx = -0.36;
  const cz = 0.56;
  const ctop = block(r, fs, cx, cz, 0.96, 0.66, 0.38, { ribs: 5 });
  r.box(M.darker, 0.36, 0.22, 0.02, cx + 0.2, Y0 + 0.11, cz + 0.334, { b: 0 });
  r.add(quadGeo(0.3, 0.06), molten, { p: [cx + 0.2, Y0 + 0.05, cz + 0.346] });
  r.add(quadGeo(0.3, 0.14), { glow: 0xff8a30, i: 0.9, a: 3.5 }, { p: [cx + 0.2, Y0 + 0.15, cz + 0.345] });
  slogan(r, fac, ['STEEL FOR', 'VICTORY'], '', 0.4, 0.17, [cx - 0.22, Y0 + 0.24, cz + 0.346]);
  banner(r, fac, 0.16, 0.3, [cx + 0.2, Y0 + 0.37, cz + 0.346], 0);
  roofVent(r, cx - 0.2, ctop, cz - 0.1, 0.04);
  roofVent(r, cx + 0.22, ctop, cz - 0.12, 0.04);
  r.node('steam0', [cx + 0.22, ctop + 0.1, cz - 0.12]);
  cornerLights(r, fs, cx, cz, 0.96, 0.66, ctop - 0.015);
  // ingot stacks (gleaming dark steel) and a ladle on the apron
  for (let k = 0; k < 2; k++) {
    for (let i = 0; i < 3; i++) r.box({ c: 0x7a7f86, m: 0.9, r: 0.3, d: 0 }, 0.12, 0.028, 0.05, 0.34 + k * 0.2, Y0 + 0.014 + i * 0.028, 0.74 + (i % 2) * 0.02, { b: 0.006, r: [0, i % 2 ? Math.PI / 2 : 0, 0] });
  }
  r.add(lathe([[0.0, 0], [0.07, 0.01], [0.09, 0.09], [0.1, 0.1]], 10), M.dark, { p: [0.82, Y0, 0.62] });
  r.add(discGeo(0.08, 0.003, 10), molten, { p: [0.82, Y0 + 0.095, 0.62] });
  lampPost(r, 0.9, Y0, 0.9, 0.38, -Math.PI / 2);
  stencilNumber(r, '07', [cx - 0.36, Y0 + 0.08, cz + 0.334], [0, 0, 0], 0.06);

  return makeTemplate({
    root: r,
    height: 1.6,
    radius: 1.05,
    muzzles: [],
    smoke: ['smoke0'],
    fx: { steam: ['steam0'] },
    glow: { glow: 1.6 },
    anim: sAnim(),
  });
}

// =============================================================================================
// Mining Outpost (2x2, dock under the right column): processing shed, intake hopper over a roller lane,
// conveyor gallery, site cabin, floodlight mast. No silos.
// =============================================================================================

function miningOutpost(fac: Fac = 'soviet'): ModelTemplate {
  const fs = FSTYLE[fac];
  const sov = fac === 'soviet';
  const r = root(2, 2, sov ? M.concreteDark : M.concrete);
  // ---- unloading lane (right column, toward the dock below the footprint): asphalt, hazard edges, guide lights
  const lx = 0.5;
  r.box(M.asphalt, 0.78, 0.024, 1.0, lx, Y0 + 0.01, 0.5, { b: 0.008 });
  hazard(r, 0.98, 0.045, [lx - 0.39, Y0 + 0.024, 0.5], [-Math.PI / 2, 0, Math.PI / 2]);
  hazard(r, 0.98, 0.045, [lx + 0.39, Y0 + 0.024, 0.5], [-Math.PI / 2, 0, Math.PI / 2]);
  for (let i = 0; i < 3; i++) {
    r.box(M.yellow, 0.24, 0.004, 0.035, lx, Y0 + 0.024, 0.55 + i * 0.16, { b: 0 });
    for (const s of [-1, 1]) r.add(new THREE.OctahedronGeometry(0.012, 0), G.green, { p: [lx + s * 0.35, Y0 + 0.045, 0.5 + i * 0.2], slot: 'glow:dock' });
  }
  // intake: a steel hopper house at the head of the lane, its mouth glowing, rollers feeding it
  const iz = -0.12;
  const itop = block(r, fs, lx, iz, 0.7, 0.5, 0.58, { wall: fs.steel, band: false, ribs: 4 });
  r.add(prismXY([[0.0, 0.14], [0.26, 0.32], [0.26, 0.42], [0.0, 0.42]], 0.5, 0.015), fs.steelLight, { p: [lx, Y0, iz + 0.24], r: [0, -Math.PI / 2, 0] });
  r.box(M.darker, 0.42, 0.22, 0.02, lx, Y0 + 0.14, iz + 0.255, { b: 0 });
  r.box(G.fire, 0.36, 0.04, 0.01, lx, Y0 + 0.07, iz + 0.265, { b: 0, slot: 'glow:proc' });
  hazard(r, 0.5, 0.04, [lx, Y0 + 0.3, iz + 0.27]);
  for (let i = 0; i < 4; i++) {
    const roll = r.node(`roll${i}`, [lx, Y0 + 0.045, iz + 0.3 + i * 0.065]);
    roll.cyl(M.steel, 0.018, 0.018, 0.34, 0, 0, 0, { r: [0, 0, Math.PI / 2], seg: 8 });
    roll.box(M.dark, 0.34, 0.006, 0.006, 0, 0.016, 0, { b: 0 });
  }
  cornerLights(r, fs, lx, iz, 0.7, 0.5, itop - 0.015);
  // ---- processing shed (back): long low hall with a monitor roof, the crusher housing
  const sx = -0.36;
  const sz = -0.5;
  const stop = block(r, fs, sx, sz, 1.12, 0.8, 0.5, { ribs: 6 });
  r.box(fs.steel, 0.5, 0.18, 0.4, sx - 0.12, stop + 0.09, sz - 0.08, { b: 0.012 });
  r.box(fs.roof, 0.54, 0.02, 0.44, sx - 0.12, stop + 0.19, sz - 0.08, { b: 0.004 });
  grille(r, 0.3, 0.2, [sx - 0.12, stop + 0.205, sz - 0.08], 4);
  r.node('steam0', [sx - 0.12, stop + 0.25, sz - 0.08]);
  acUnit(r, sx + 0.36, stop, sz + 0.1, 0, 0.9);
  winRow(r, fs, 3, 0.08, 0.07, 0.06, sx - 0.22, Y0 + 0.3, sz + 0.4, 0, [0, 2]);
  if (sov) slogan(r, fac, ['ORE FOR THE', 'FRONT'], '', 0.48, 0.17, [sx - 0.22, Y0 + 0.44, sz + 0.412]);
  else slogan(r, fac, ['', ''], 'FORWARD MINING', 0.5, 0.17, [sx - 0.22, Y0 + 0.44, sz + 0.412]);
  // conveyor gallery from the intake up onto the shed roof
  const g0 = new THREE.Vector3(lx - 0.3, Y0 + 0.5, iz - 0.05);
  const g1 = new THREE.Vector3(sx + 0.2, stop + 0.16, sz + 0.05);
  const gl = g0.distanceTo(g1);
  const gm = g0.clone().add(g1).multiplyScalar(0.5);
  const gal = new NB('_gal', [gm.x, gm.y, gm.z], [0, -Math.atan2(g1.z - g0.z, g1.x - g0.x), Math.atan2(g1.y - g0.y, Math.hypot(g1.x - g0.x, g1.z - g0.z))]);
  gal.box(fs.steel, gl, 0.08, 0.12, 0, 0, 0, { b: 0.008 });
  gal.box(fs.roof, gl, 0.016, 0.14, 0, 0.048, 0, { b: 0 });
  gal.box(M.team, gl * 0.9, 0.014, 0.004, 0, 0.01, 0.062, { b: 0 });
  mergeChild(r, gal);
  // ---- site cabin (front left) with a radio mast; a floodlight mast lights the lane
  const cx = -0.5;
  const cz = 0.42;
  const ctop = block(r, fs, cx, cz, 0.52, 0.4, 0.3, { band: false });
  winRow(r, fs, 2, 0.08, 0.07, 0.08, cx - 0.06, Y0 + 0.18, cz + 0.2, 0, [0]);
  doorway(r, fs, cx + 0.17, cz + 0.2, 0.1, 0.18);
  radioMast(r, cx - 0.16, ctop, cz - 0.08, 0.5);
  if (sov) banner(r, fac, 0.12, 0.22, [cx + 0.17, Y0 + 0.29, cz + 0.212], 0);
  else emblem(r, fac, 0.05, [cx + 0.0, Y0 + 0.24, cz + 0.212], [0, 0, 0], true);
  // floodlight mast
  r.cyl(M.dark, 0.014, 0.02, 1.05, -0.06, Y0 + 0.525, 0.2, { seg: 6 });
  r.box(M.dark, 0.2, 0.014, 0.014, -0.06, Y0 + 1.04, 0.2, { b: 0 });
  floodlight(r, [-0.13, Y0 + 1.06, 0.22], 0.9, 0.7, 0.045);
  floodlight(r, [0.01, Y0 + 1.06, 0.22], 0.5, 0.7, 0.045);
  warnLight(r, [-0.06, Y0 + 1.1, 0.2], false, 0.014);
  // ore spill, fuel tank, crates
  orePile(r, -0.62, Y0, 0.86, 0.14, 0.06, 7);
  tankX(r, fs, -0.82, Y0, -0.02, 0.3, 0.07);
  crateStack(r, -0.18, Y0, 0.84, 0.08, 2, 0.3);

  return makeTemplate({
    root: r,
    height: 1.15,
    radius: 1.05,
    muzzles: [],
    fx: { steam: ['steam0'] },
    glow: { glow: 1.6, 'glow:proc': 4, 'glow:dock': 3 },
    anim: sAnim((c, s) => {
      const active = s.harvesting || s.load > 0.05;
      const flick = 0.6 + 0.4 * Math.sin(s.time * 9 + c.v.seed) * Math.sin(s.time * 3.1);
      c.setGlow('glow:proc', s.powered ? (active ? 0.6 + 0.4 * flick : 0.3) : 0.08);
      c.setGlow('glow:dock', s.powered ? (s.harvesting ? (blink(s.time, 0.5, 0.5) ? 1 : 0.2) : 0.5) : 0.05);
      c.v.roll = ((c.v.roll ?? 0) + (active && s.powered ? dtOf(s) * 7 : 0)) % (Math.PI * 2);
      for (let i = 0; i < 4; i++) c.n[`roll${i}`].rotation.x = c.v.roll;
    }),
  });
}

// =============================================================================================
// Logistics Centre (3x2): warehouse with a roller door, container yard under a travelling gantry crane,
// a repair canopy with a vehicle lift, fuel tanks and a comms mast
// =============================================================================================

function logisticsCentre(fac: Fac = 'soviet'): ModelTemplate {
  const fs = FSTYLE[fac];
  const sov = fac === 'soviet';
  const r = root(3, 2, sov ? M.concreteDark : M.concrete);
  // ---- warehouse (back left): long hall with a gable roof, roller doors facing the camera
  const wx = -0.6;
  const wz = -0.42;
  const ww = 1.66;
  const wd = 0.92;
  const wh = 0.56;
  block(r, fs, wx, wz, ww, wd, wh, { roof: 'none' });
  const top = Y0 + wh;
  const roofMat: Mat = sov ? S.roofTar : S.roofSteel;
  r.add(prismXY([[-wd / 2 - 0.04, 0], [wd / 2 + 0.04, 0], [wd / 2 + 0.04, 0.02], [0, 0.24], [-wd / 2 - 0.04, 0.02]], ww + 0.06, 0.01), roofMat, { p: [wx, top - 0.01, wz], r: [0, Math.PI / 2, 0] });
  r.box(M.team, ww + 0.08, 0.025, 0.04, wx, top + 0.225, wz, { b: 0.006 });
  const fz = wz + wd / 2;
  for (const dx of [-0.48, 0.0, 0.48]) {
    r.box(M.darker, 0.34, 0.34, 0.02, wx + dx, Y0 + 0.17, fz + 0.004, { b: 0 });
    for (let i = 0; i < 7; i++) r.box(fs.steel, 0.32, 0.035, 0.02, wx + dx, Y0 + 0.2 + i * 0.045, fz + 0.012, { b: 0 });
    hazard(r, 0.4, 0.035, [wx + dx, Y0 + 0.37, fz + 0.016]);
    r.add(new THREE.OctahedronGeometry(0.013, 0), { glow: 0xffa020, i: 2.2, a: 1.3 + dx }, { p: [wx + dx + 0.19, Y0 + 0.41, fz + 0.03] });
  }
  stencilNumber(r, sov ? '12' : 'L-3', [wx - 0.72, Y0 + 0.44, fz + 0.004], [0, 0, 0], 0.07, S.stencilYellow);
  slogan(r, fac, ['SUPPLY THE', 'FRONT'], 'LOGISTICS', 0.6, 0.18, [wx + 0.24, Y0 + 0.47, fz + 0.016]);
  cornerLights(r, fs, wx, wz, ww, wd, top - 0.015);
  // ---- container yard (right) under a travelling gantry crane
  const yx = 0.92;
  r.box(M.asphalt, 1.06, 0.012, 1.8, yx, Y0 + 0.006, 0, { b: 0 });
  const conts: [number, number, number, Mat][] = [
    [yx - 0.18, 0, -0.62, M.team], [yx + 0.18, 0, -0.62, M.olive], [yx - 0.18, 0.16, -0.62, M.navy],
    [yx - 0.18, 0, -0.2, { c: 0x8a3a24, m: 0.3, r: 0.6, d: 0 }], [yx + 0.18, 0, -0.2, M.team], [yx + 0.18, 0.16, -0.2, M.oliveDark],
    [yx - 0.18, 0, 0.22, M.olive], [yx + 0.18, 0, 0.22, M.navy],
  ];
  for (const [x, y, z, mat] of conts) container(r, x, Y0 + y, z, 0.38, mat, Math.PI / 2);
  for (const s of [-1, 1]) railLine(r, [yx + s * 0.47, Y0 + 0.012, -0.88], [yx + s * 0.47, Y0 + 0.012, 0.88], 0.01, M.dark);
  const gantry = r.node('gantry', [yx, Y0, -0.1]);
  for (const s of [-1, 1]) {
    gantry.box(sov ? M.yellow : M.team, 0.05, 0.84, 0.05, s * 0.47, 0.44, -0.12, { b: 0.006 });
    gantry.box(sov ? M.yellow : M.team, 0.05, 0.84, 0.05, s * 0.47, 0.44, 0.12, { b: 0.006 });
    gantry.box(M.dark, 0.08, 0.05, 0.34, s * 0.47, 0.03, 0, { b: 0.006 });
    gantry.box(sov ? M.yellow : M.team, 0.04, 0.04, 0.24, s * 0.47, 0.6, 0, { b: 0 });
  }
  gantry.box(sov ? M.yellow : M.team, 1.04, 0.08, 0.08, 0, 0.88, -0.1, { b: 0.008 });
  gantry.box(sov ? M.yellow : M.team, 1.04, 0.08, 0.08, 0, 0.88, 0.1, { b: 0.008 });
  hazard(gantry, 0.9, 0.04, [0, 0.88, 0.142]);
  warnLight(gantry, [-0.5, 0.94, 0], false, 0.014, { glow: 0xffa020, i: 2.2 });
  warnLight(gantry, [0.5, 0.94, 0], false, 0.014, { glow: 0xffa020, i: 2.2 });
  const trolley = gantry.node('trolley', [0, 0.9, 0]);
  trolley.box(M.dark, 0.14, 0.07, 0.26, 0, 0.06, 0, { b: 0.008 });
  trolley.box(M.glassBlue, 0.08, 0.05, 0.02, 0, 0.06, 0.135, { b: 0 });
  trolley.cyl(M.steel, 0.003, 0.003, 0.4, -0.04, -0.2, 0, { seg: 3 });
  trolley.cyl(M.steel, 0.003, 0.003, 0.4, 0.04, -0.2, 0, { seg: 3 });
  trolley.box(M.yellow, 0.16, 0.025, 0.06, 0, -0.41, 0, { b: 0.004 });
  container(trolley, 0, -0.6, 0, 0.36, M.team, Math.PI / 2);
  // ---- repair canopy (front left) with a vehicle lift, amber beacons, a wrench sign
  const px = -0.62;
  const pz = 0.5;
  for (const [dx, dz] of [[-0.42, -0.2], [0.42, -0.2], [-0.42, 0.34], [0.42, 0.34]]) r.box(fs.steel, 0.04, 0.42, 0.04, px + dx, Y0 + 0.21, pz + dz, { b: 0.006 });
  r.box(roofMat, 0.96, 0.03, 0.66, px, Y0 + 0.43, pz + 0.07, { b: 0.006, r: [0.08, 0, 0] });
  r.box(M.team, 0.98, 0.04, 0.03, px, Y0 + 0.43, pz + 0.41, { b: 0.006 });
  r.box(M.yellow, 0.52, 0.03, 0.3, px, Y0 + 0.08, pz + 0.04, { b: 0.006 });
  for (const s of [-1, 1]) r.box(M.dark, 0.03, 0.06, 0.26, px + s * 0.2, Y0 + 0.04, pz + 0.04, { b: 0 });
  hazard(r, 0.86, 0.04, [px, Y0 + 0.013, pz + 0.36], [-Math.PI / 2, 0, 0]);
  r.add(new THREE.OctahedronGeometry(0.016, 0), { glow: 0xffa020, i: 2.4, a: 1.2 }, { p: [px - 0.4, Y0 + 0.47, pz + 0.4] });
  r.add(new THREE.OctahedronGeometry(0.016, 0), { glow: 0xffa020, i: 2.4, a: 1.7 }, { p: [px + 0.4, Y0 + 0.47, pz + 0.4] });
  // wrench sign on the canopy fascia
  const ws = new NB('_wr', [px, Y0 + 0.5, pz + 0.43]);
  ws.box(M.dark, 0.2, 0.12, 0.012, 0, 0.02, 0, { b: 0 });
  ws.box(S.stencilYellow, 0.12, 0.022, 0.004, 0, 0.02, 0.008, { b: 0, r: [0, 0, 0.6] });
  ws.add(new THREE.TorusGeometry(0.022, 0.009, 3, 8, Math.PI * 1.5), S.stencilYellow, { p: [0.045, 0.055, 0.008], r: [0, 0, 1.2] });
  mergeChild(r, ws);
  // fuel tanks + comms mast between the canopy and the yard
  tankX(r, fs, 0.06, Y0, 0.3, 0.36, 0.08);
  tankX(r, fs, 0.06, Y0, 0.6, 0.36, 0.08);
  radioMast(r, 0.12, Y0, 0.86, 0.9);
  dish(r, wx + 0.5, top + 0.1, wz - 0.1, 0.09, 0.3, 0.6);
  lampPost(r, -1.4, Y0, 0.88, 0.38, Math.PI / 2);
  crateStack(r, -1.3, Y0, 0.2, 0.08, 3, 0.2);

  return makeTemplate({
    root: r,
    height: 1.05,
    radius: 1.6,
    muzzles: [],
    glow: { glow: 1.6 },
    anim: sAnim((c, s) => {
      if (!s.powered) return;
      const t = s.time * 0.18 + c.v.seed;
      c.n.gantry.position.z = -0.1 + Math.sin(t) * 0.5;
      c.n.trolley.position.x = Math.sin(t * 2.3 + 1) * 0.3;
    }),
  });
}

// =============================================================================================
// Research Lab (3x2): Soviet brutalist institute with an observatory and a glowing test chamber; Allied glass
// lab with a geodesic observatory. Glows (and the test rig spins) while research runs (`load`).
// =============================================================================================

function researchLab(fac: Fac = 'soviet'): ModelTemplate {
  const fs = FSTYLE[fac];
  const sov = fac === 'soviet';
  const r = root(3, 2, sov ? M.concreteDark : M.concrete);
  const lab: Glow = sov ? { glow: 0x6cff9a, i: 1.4 } : { glow: 0x7ad8ff, i: 1.4 };
  // ---- main block (left two thirds): two storeys, glazing band, team cornice
  const mx = -0.42;
  const mz = -0.12;
  const mw = 1.9;
  const md = 1.1;
  const mh = 0.62;
  const top = block(r, fs, mx, mz, mw, md, mh, { ribs: sov ? 9 : 0 });
  const fz = mz + md / 2;
  if (sov) {
    for (const y of [0.24, 0.46]) winRow(r, fs, 8, 0.1, 0.08, 0.1, mx, Y0 + y, fz + 0.02, 0, y < 0.3 ? [0, 2, 3, 5, 7] : [1, 2, 4, 6]);
    slogan(r, fac, ['SCIENCE', 'FOR THE PEOPLE'], '', 0.62, 0.2, [mx + 0.5, Y0 + 0.6, fz + 0.032]);
    banner(r, fac, 0.18, 0.4, [mx - 0.66, Y0 + mh - 0.04, fz + 0.03], 0);
  } else {
    // curtain wall: a long glazed band (lab blue) with mullions
    r.box(M.glassBlue, mw - 0.2, 0.3, 0.02, mx, Y0 + 0.36, fz + 0.006, { b: 0 });
    windows(r, 9, 0.16, 0.12, 0.03, [mx, Y0 + 0.43, fz + 0.018], [0, 0, 0], fs.win, 'glow', [0, 1, 3, 4, 5, 7, 8]);
    windows(r, 9, 0.16, 0.12, 0.03, [mx, Y0 + 0.28, fz + 0.018], [0, 0, 0], lab, 'glow', [1, 2, 4, 6, 7]);
    slogan(r, fac, ['', ''], 'RESEARCH DIVISION', 0.72, 0.18, [mx + 0.3, Y0 + 0.62, fz + 0.03]);
    emblem(r, fac, 0.1, [mx - 0.66, Y0 + 0.62, fz + 0.03], [0, 0, 0], true);
  }
  doorway(r, fs, mx - 0.24, fz, 0.2, 0.2);
  cornerLights(r, fs, mx, mz, mw, md, top - 0.015);
  // roof: the observatory (dome with a slit, node 'scope' turns), a lab hood stack, AC
  const ox = mx - 0.42;
  const oz = mz - 0.12;
  r.cyl(fs.wallDark, 0.32, 0.34, 0.16, ox, top + 0.08, oz, { seg: 16 });
  r.cyl(M.team, 0.325, 0.325, 0.03, ox, top + 0.15, oz, { seg: 16 });
  const scope = r.node('scope', [ox, top + 0.16, oz]);
  if (sov) {
    scope.add(new THREE.SphereGeometry(0.3, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.offwhite);
    scope.box(M.darker, 0.1, 0.3, 0.2, 0, 0.17, 0.2, { b: 0, r: [-0.6, 0, 0] });
  } else {
    const geo = new THREE.IcosahedronGeometry(0.3, 1);
    scope.add(geo, M.white, { s: [1, 0.82, 1] });
    scope.box(M.darker, 0.1, 0.28, 0.2, 0, 0.14, 0.2, { b: 0, r: [-0.6, 0, 0] });
  }
  scope.cyl(M.gun, 0.03, 0.04, 0.26, 0, 0.22, 0.12, { r: [0.6, 0, 0], seg: 8 });
  chimney(r, 'smoke0', mx + 0.36, mz - 0.3, top - 0.01, 0.42, 0.07, 0.055, fac, sov ? S.sovSteelLight : M.steel);
  acUnit(r, mx + 0.1, top, mz + 0.22, 0, 1);
  acUnit(r, mx + 0.64, top, mz + 0.2, 0.2, 0.9);
  radioMast(r, mx + 0.78, top, mz - 0.32, 0.5);
  // ---- test chamber (right): reinforced drum with glowing ports and a spinning test rig on top
  const tx = 1.0;
  const tz = -0.1;
  r.box(fs.wallDark, 0.86, 0.1, 0.9, tx, Y0 + 0.05, tz, { b: 0.015 });
  r.cyl(sov ? S.sovWall : S.allWall, 0.36, 0.4, 0.5, tx, Y0 + 0.35, tz, { seg: 16 });
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + 0.3;
    r.box(fs.wallDark, 0.06, 0.5, 0.08, tx + Math.cos(a) * 0.39, Y0 + 0.35, tz + Math.sin(a) * 0.39, { b: 0.008, r: [0, -a, 0] });
  }
  r.cyl(M.team, 0.37, 0.37, 0.04, tx, Y0 + 0.56, tz, { seg: 16 });
  r.cyl(fs.steel, 0.3, 0.37, 0.06, tx, Y0 + 0.63, tz, { seg: 16 });
  // glowing ports facing the camera (separately animated: research running)
  for (const a of [Math.PI / 2 - 0.5, Math.PI / 2, Math.PI / 2 + 0.5]) {
    const x = tx + Math.cos(a) * 0.395;
    const z = tz + Math.sin(a) * 0.395;
    r.box(M.darker, 0.1, 0.12, 0.02, x, Y0 + 0.36, z, { b: 0, r: [0, -a + Math.PI / 2, 0] });
    r.box(lab, 0.08, 0.1, 0.01, x + Math.cos(a) * 0.012, Y0 + 0.36, z + Math.sin(a) * 0.012, { b: 0, r: [0, -a + Math.PI / 2, 0], slot: 'glow:lab' });
  }
  const rig = r.node('rig', [tx, Y0 + 0.66, tz]);
  rig.cyl(M.gun, 0.05, 0.07, 0.12, 0, 0.06, 0, { seg: 10 });
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    rig.box(fs.steelLight, 0.26, 0.03, 0.03, Math.cos(a) * 0.13, 0.12, Math.sin(a) * 0.13, { b: 0, r: [0, -a, 0] });
    rig.sph(M.copper, 0.04, Math.cos(a) * 0.26, 0.12, Math.sin(a) * 0.26, { seg: 8 });
  }
  rig.cyl(M.copper, 0.02, 0.03, 0.22, 0, 0.23, 0, { seg: 8 });
  rig.add(new THREE.OctahedronGeometry(0.04, 0), lab, { p: [0, 0.37, 0], slot: 'glow:lab' });
  // conduits from the main block into the chamber
  pipeRun(r, [[mx + mw / 2, Y0 + 0.44, tz - 0.25], [tx - 0.3, Y0 + 0.44, tz - 0.25]], 0.03, fs.steelLight);
  pipeRun(r, [[mx + mw / 2, Y0 + 0.3, tz + 0.1], [tx - 0.37, Y0 + 0.3, tz + 0.1]], 0.024, M.dark);
  hazard(r, 0.7, 0.04, [tx, Y0 + 0.013, tz + 0.52], [-Math.PI / 2, 0, 0]);
  // yard: a lamp post, a crate stack, a specimen cart
  lampPost(r, 1.36, Y0, 0.86, 0.38, -Math.PI / 2);
  crateStack(r, 0.62, Y0, 0.78, 0.08, 2, 0.2);
  if (!sov) floodlight(r, [mx + mw / 2 - 0.06, top + 0.04, fz - 0.03], 0, 0.85);

  return makeTemplate({
    root: r,
    height: 1.25,
    radius: 1.6,
    muzzles: [],
    smoke: ['smoke0'],
    glow: { glow: 1.6, 'glow:lab': 3 },
    anim: sAnim((c, s) => {
      const busy = s.load > 0.5;
      const dt = dtOf(s);
      c.v.busy = approach(c.v.busy ?? 0, busy && s.powered ? 1 : 0, 2, dt);
      const pulse = 0.75 + 0.25 * Math.sin(s.time * 5 + c.v.seed);
      c.setGlow('glow:lab', s.powered ? 0.25 + c.v.busy * 0.75 * pulse : 0.05);
      c.n.rig.rotation.y += dt * (0.3 + c.v.busy * 4);
      c.n.scope.rotation.y = Math.sin(s.time * 0.12 + c.v.seed) * 0.9;
    }),
  });
}

// =============================================================================================
// Bunker (2x2): heavy concrete blockhouse, two firing slits per side, garrison helmets in the slits
// =============================================================================================

/** Slit positions (centre on the wall face, outward yaw) for a w x d box: two per side, S, E, N, W. */
function slits(w: number, d: number): { x: number; z: number; yaw: number }[] {
  const out: { x: number; z: number; yaw: number }[] = [];
  for (const k of [-1, 1]) out.push({ x: k * w * 0.22, z: d / 2, yaw: 0 });
  for (const k of [1, -1]) out.push({ x: w / 2, z: k * d * 0.22, yaw: Math.PI / 2 });
  for (const k of [1, -1]) out.push({ x: k * w * 0.22, z: -d / 2, yaw: Math.PI });
  for (const k of [-1, 1]) out.push({ x: -w / 2, z: k * d * 0.22, yaw: -Math.PI / 2 });
  return out;
}

function bunker(fac: Fac = 'soviet'): ModelTemplate {
  const fs = FSTYLE[fac];
  const sov = fac === 'soviet';
  const r = root(2, 2, M.concreteDark);
  const conc: Mat = sov ? S.sovWall : S.allWall;
  const concDark: Mat = sov ? S.sovWallDark : S.allWallDark;
  const earth: Mat = { c: 0x6b6250, m: 0, r: 0.95, d: 2 };
  const w = 1.36;
  const d = 1.24;
  const h = 0.44;
  // earth berms banked against the east and west walls (the bunker is dug in)
  for (const s of [-1, 1]) {
    r.add(prismXY([[0, 0], [0.26, 0], [0.04, h * 0.72], [0, h * 0.72]], d + 0.1, 0.02), earth, { p: [s * (w / 2 - 0.02), Y0, 0], r: [0, s > 0 ? 0 : Math.PI, 0] });
  }
  // battered (sloped) concrete body: a frustum from the footing to the roof line
  const body = new NB('_bd');
  const loft = (y0: number, y1: number, i0: number, i1: number, mat: Mat) => {
    const g = new THREE.BufferGeometry();
    const P: number[] = [];
    const ring = (y: number, i: number) => [[-w / 2 + i, y, -d / 2 + i], [w / 2 - i, y, -d / 2 + i], [w / 2 - i, y, d / 2 - i], [-w / 2 + i, y, d / 2 - i]];
    const a = ring(y0, i0);
    const b = ring(y1, i1);
    for (let k = 0; k < 4; k++) {
      const k2 = (k + 1) % 4;
      P.push(...a[k], ...b[k2], ...a[k2], ...a[k], ...b[k], ...b[k2]);
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.computeVertexNormals();
    body.add(g, mat);
  };
  loft(Y0, Y0 + 0.06, -0.03, -0.03, concDark);
  loft(Y0 + 0.06, Y0 + h, 0, 0.12, conc);
  mergeChild(r, body);
  // thick roof slab with a deep overhang over the slits, team band, a second raised slab
  const rt = Y0 + h;
  r.box(conc, w - 0.1, 0.12, d - 0.1, 0, rt + 0.06, 0, { b: 0.035 });
  r.box(M.team, w - 0.08, 0.03, d - 0.08, 0, rt + 0.015, 0, { b: 0.006 });
  r.box(concDark, w - 0.42, 0.06, d - 0.42, 0, rt + 0.15, 0, { b: 0.02 });
  // firing slits: dark recess under a concrete hood, a warm glow inside
  const ss = slits(w - 0.16, d - 0.16);
  const muzzles: string[] = [];
  const sy = Y0 + 0.27;
  ss.forEach((sl, i) => {
    const n = new NB('_sl', [sl.x, 0, sl.z], [0, sl.yaw, 0]);
    n.box(M.darker, 0.28, 0.08, 0.05, 0, sy, -0.01, { b: 0 });
    n.box(conc, 0.36, 0.03, 0.1, 0, sy + 0.058, 0.03, { b: 0.008 });
    n.add(quadGeo(0.24, 0.05), { glow: 0xffc27a, i: 0.9, a: 3 + i * 0.13 }, { p: [0, sy - 0.006, 0.019] });
    mergeChild(r, n);
    r.node(`m${i}`, [sl.x + Math.sin(sl.yaw) * 0.07, sy, sl.z + Math.cos(sl.yaw) * 0.07], [0, sl.yaw - Math.PI / 2, 0]);
    muzzles.push(`m${i}`);
  });
  // garrison: a soldier per slot at the camera-facing slits (south pair, east and west front slits)
  // (heads and helmets in the slit, silhouetted against the warm glow inside)
  [0, 1, 2, 7].forEach((si, k) => {
    const sl = ss[si];
    const g = r.node(`g${k}`, [sl.x + Math.sin(sl.yaw) * 0.03, sy - 0.03, sl.z + Math.cos(sl.yaw) * 0.03], [0, sl.yaw, 0]);
    g.sph(M.skin, 0.017, 0, 0.012, 0, { seg: 6 });
    g.add(lathe([[0.03, 0], [0.026, 0.014], [0.012, 0.024], [0, 0.026]], 8), sov ? M.oliveDark : M.olive, { p: [0, 0.018, 0] });
    g.cyl(M.gun, 0.004, 0.004, 0.09, 0.03, 0.0, 0.03, { r: [Math.PI / 2, 0, 0], seg: 4 });
  });
  // roof: an observation cupola (the landmark) with a glowing vision band, a hatch, sandbag parapets, a mast
  const cx = -0.18;
  const cz = -0.12;
  const ct = rt + 0.18;
  r.cyl(concDark, 0.24, 0.27, 0.16, cx, ct + 0.08, cz, { seg: 8 });
  r.cyl(M.darker, 0.22, 0.22, 0.035, cx, ct + 0.17, cz, { seg: 8 });
  r.add(ringGeo(0.205, 0.215, 0.02, 8), { glow: 0xffc27a, i: 1.1, a: 3.7 }, { p: [cx, ct + 0.163, cz] });
  r.cyl(conc, 0.27, 0.2, 0.08, cx, ct + 0.225, cz, { seg: 8 });
  r.cyl(M.team, 0.205, 0.205, 0.02, cx, ct + 0.27, cz, { seg: 8 });
  r.cyl(M.gun, 0.012, 0.012, 0.16, cx + 0.08, ct + 0.34, cz - 0.04, { seg: 5 });
  if (sov) {
    const st = new NB('_cst', [cx, ct + 0.085, cz + 0.255], [-0.12, 0, 0]);
    st.add(starGeo(0.075), S.stencilYellow, { r: faceRot('+z') });
    st.add(starGeo(0.062), M.red, { p: [0, 0, 0.003], r: faceRot('+z') });
    mergeChild(r, st);
  } else emblem(r, fac, 0.055, [cx, ct + 0.085, cz + 0.262], [-0.12, 0, 0], true);
  r.cyl(M.gun, 0.08, 0.085, 0.04, 0.32, rt + 0.2, -0.18, { seg: 12 });
  r.box(M.dark, 0.1, 0.02, 0.02, 0.32, rt + 0.23, -0.18, { b: 0 });
  sandbags(r, 0.5, 2, [0.2, rt + 0.12, d / 2 - 0.12]);
  sandbags(r, 0.3, 2, [w / 2 - 0.12, rt + 0.12, 0.1], [0, Math.PI / 2, 0]);
  antenna(r, 0.5, rt + 0.12, -0.4, 0.42);
  warnLight(r, [-0.56, rt + 0.14, 0.46], false, 0.016);
  // front face: the faction crest and the bunker number
  if (sov) {
    const st = new NB('_st', [0.3, Y0 + 0.16, d / 2 - 0.04], [-0.27, 0, 0]);
    st.add(starGeo(0.08), S.stencilYellow, { r: faceRot('+z') });
    st.add(starGeo(0.066), M.red, { p: [0, 0, 0.003], r: faceRot('+z') });
    mergeChild(r, st);
  }
  stencilText(r, sov ? 'ДОТ-4' : 'B-4', [-0.3, Y0 + 0.14, d / 2 - 0.035], [-0.27, 0, 0], 0.05, S.stencilWhite);
  // ammo crates and a sandbag wall out front, an entry trench stair at the back
  crateStack(r, 0.8, Y0, 0.8, 0.07, 2, 0.4);
  sandbags(r, 0.44, 3, [-0.6, Y0, 0.88]);
  r.box(M.darker, 0.22, 0.03, 0.2, 0.36, Y0 + 0.015, -d / 2 - 0.12, { b: 0 });

  return makeTemplate({
    root: r,
    height: 0.8,
    radius: 1.0,
    muzzles,
    glow: { glow: 1.8 },
    anim: sAnim((c, s) => {
      const n = Math.round(Math.max(0, Math.min(1, s.load)) * 4);
      if (c.v.gar !== n) {
        c.v.gar = n;
        for (let k = 0; k < 4; k++) c.show(`g${k}`, k < n);
      }
    }),
  });
}

/** A small antenna (thin mast with a ball). */
function antenna(nb: NB, x: number, y: number, z: number, h: number): void {
  nb.cyl(M.dark, 0.004, 0.007, h, x, y + h / 2, z, { seg: 4 });
  nb.sph(M.gun, 0.01, x, y + h, z, { seg: 4 });
}

// =============================================================================================
// Fortress Gate (1x1): two heavy pillars matching the concrete wall's towers, a lintel and a portcullis that
// rises with `door`. Spans along X (walls east and west); upgrade-modules.ts turns it for north-south walls.
// =============================================================================================

function fortressGate(fac: Fac = 'soviet'): ModelTemplate {
  const fs = FSTYLE[fac];
  const sov = fac === 'soviet';
  const r = root(1, 1, M.concreteDark);
  const wall: Mat = sov ? S.sovWall : S.allWall;
  const dark = fs.wallDark;
  const g = r.node('gate'); // the whole gate turns with the wall line (upgrade-modules.ts sets its yaw)
  // pillars: wider than the wall (0.3 thick), with buttresses, team bands, lamps
  for (const s of [-1, 1]) {
    const x = s * 0.4;
    g.box(dark, 0.24, 0.08, 0.5, x, Y0 + 0.04, 0, { b: 0.015 });
    g.box(wall, 0.2, 1.02, 0.42, x, Y0 + 0.51, 0, { b: 0.025 });
    for (const zz of [-1, 1]) g.box(dark, 0.06, 0.9, 0.06, x + s * 0.07, Y0 + 0.45, zz * 0.2, { b: 0.01 });
    g.box(dark, 0.24, 0.06, 0.46, x, Y0 + 1.05, 0, { b: 0.012 });
    g.box(M.team, 0.21, 0.025, 0.43, x, Y0 + 0.95, 0, { b: 0.006 });
    if (sov) warnLight(g, [x, Y0 + 1.11, 0.12], false, 0.02);
    else floodlight(g, [x, Y0 + 1.1, 0.16], 0, 0.6, 0.045);
  }
  // lintel (gatehouse beam) with the faction crest, a hazard strip and the portcullis housing
  g.box(wall, 0.98, 0.2, 0.36, 0, Y0 + 0.96, 0, { b: 0.02 });
  g.box(dark, 1.0, 0.04, 0.4, 0, Y0 + 1.08, 0, { b: 0.01 });
  for (const zz of [-1, 1]) hazard(g, 0.56, 0.05, [0, Y0 + 0.88, zz * 0.182], [0, zz > 0 ? 0 : Math.PI, 0]);
  if (sov) {
    for (const zz of [-1, 1]) {
      const st = new NB('_gst', [0, Y0 + 0.98, zz * 0.185], [0, zz > 0 ? 0 : Math.PI, 0]);
      st.add(starGeo(0.075), S.stencilYellow, { r: faceRot('+z') });
      st.add(starGeo(0.062), M.red, { p: [0, 0, 0.003], r: faceRot('+z') });
      mergeChild(g, st);
    }
  } else {
    for (const zz of [-1, 1]) emblem(g, fac, 0.06, [0, Y0 + 0.98, zz * 0.183], [0, zz > 0 ? 0 : Math.PI, 0], true);
  }
  // the portcullis: a team-trimmed steel door with ribs, slides up into the lintel
  const door = g.node('door', [0, 0, 0]);
  door.box(fs.steel, 0.58, 0.78, 0.06, 0, Y0 + 0.4, 0, { b: 0.01 });
  for (let i = 0; i < 4; i++) door.box(dark, 0.6, 0.035, 0.08, 0, Y0 + 0.1 + i * 0.2, 0, { b: 0.006 });
  for (const x of [-0.18, 0, 0.18]) door.box(fs.steelLight, 0.04, 0.76, 0.075, x, Y0 + 0.4, 0, { b: 0.006 });
  door.box(M.team, 0.58, 0.04, 0.085, 0, Y0 + 0.72, 0, { b: 0.006 });
  hazard(door, 0.56, 0.04, [0, Y0 + 0.04, 0.042]);
  hazard(door, 0.56, 0.04, [0, Y0 + 0.04, -0.042], [0, Math.PI, 0]);
  // amber "gate moving" beacons on the lintel
  for (const zz of [-1, 1]) g.add(new THREE.OctahedronGeometry(0.016, 0), { glow: 0xffa020, i: 2.2 }, { p: [0.3, Y0 + 1.12, zz * 0.12], slot: 'glow:gate' });
  // road plate through the gate
  g.box(M.asphalt, 0.6, 0.012, 0.98, 0, Y0 + 0.006, 0, { b: 0 });

  return makeTemplate({
    root: r,
    height: 1.15,
    radius: 0.55,
    muzzles: [],
    glow: { glow: 1.8, 'glow:gate': 3 },
    anim: sAnim((c, s) => {
      const dt = dtOf(s);
      const want = Math.max(0, Math.min(1, s.door));
      const prev = c.v.door ?? want;
      c.v.door = approach(prev, want, 6, dt);
      c.n.door.position.y = c.v.door * 0.74;
      const moving = Math.abs(c.v.door - want) > 0.02 || (want > 0.02 && want < 0.98);
      c.setGlow('glow:gate', s.powered && moving ? (blink(s.time, 0.4, 0.5) ? 1 : 0.1) : 0);
    }),
  });
}

// =============================================================================================
// Upgrade modules (built around their own origin; anchors in upgrade-modules.ts)
// =============================================================================================

/** cy_t2: an extra prefab bay with a lit door and a second tower crane (footprint ~1.05 x 0.9). */
function modYardBay(fac: Fac = 'soviet'): ModelTemplate {
  const fs = FSTYLE[fac];
  const sov = fac === 'soviet';
  const r = modRoot();
  // slab and the bay: a portal-frame shed with a gable roof, open front with a lit interior
  r.box(M.concreteDark, 1.04, 0.03, 0.9, 0, 0.015, 0, { b: 0.01 });
  const bx = -0.2;
  const bz = 0.06;
  const bw = 0.62;
  const bd = 0.66;
  const bh = 0.4;
  for (const s of [-1, 1]) r.box(fs.wall, 0.04, bh, bd, bx + s * (bw / 2 - 0.02), 0.03 + bh / 2, bz, { b: 0.01 });
  r.box(fs.wall, bw, bh, 0.04, bx, 0.03 + bh / 2, bz - bd / 2 + 0.02, { b: 0.01 });
  r.add(prismXY([[-bw / 2 - 0.04, 0], [bw / 2 + 0.04, 0], [bw / 2 + 0.04, 0.02], [0, 0.17], [-bw / 2 - 0.04, 0.02]], bd + 0.06, 0.01), sov ? S.roofTar : S.roofSteel, { p: [bx, 0.03 + bh, bz] });
  r.box(M.team, bw + 0.06, 0.03, 0.03, bx, 0.03 + bh - 0.01, bz + bd / 2 + 0.02, { b: 0.006 });
  r.box(M.darker, bw - 0.08, bh - 0.04, 0.02, bx, 0.03 + (bh - 0.04) / 2, bz - bd / 2 + 0.05, { b: 0 });
  glowStrip(r, 0xffd49a, 1.2, 0, bw - 0.12, 0.03, [bx, 0.03 + bh - 0.07, bz - bd / 2 + 0.062]);
  // half-built prefab inside, a portal frame truss over the opening, hazard sill
  r.box(fs.wallDark, 0.3, 0.18, 0.26, bx, 0.03 + 0.09, bz - 0.08, { b: 0.01 });
  r.box(M.yellow, 0.34, 0.02, 0.02, bx, 0.03 + 0.2, bz - 0.08 + 0.13, { b: 0 });
  hazard(r, bw - 0.06, 0.04, [bx, 0.035, bz + bd / 2], [-Math.PI / 2, 0, 0]);
  sloganBoard(r, fac, 'BAY 2', 0.3, 0.08, [bx, 0.03 + bh + 0.06, bz + bd / 2 + 0.04], 0, false);
  // second tower crane (back right of the bay), its jib turning ('jib')
  towerCrane(r, 'jib', 0.36, -0.22, 0.03, 1.38, 0.95, sov ? M.yellow : M.team, 2.4);
  // panels waiting to be lifted
  for (let i = 0; i < 3; i++) r.box(fs.wall, 0.26, 0.02, 0.2, 0.32, 0.04 + i * 0.022, 0.26, { b: 0.004, r: [0, i * 0.06, 0] });
  r.box(M.dark, 0.3, 0.012, 0.03, 0.32, 0.03, 0.26, { b: 0 });
  warnLight(r, [bx + bw / 2, 0.03 + bh + 0.04, bz + bd / 2], false, 0.015, { glow: 0xffa020, i: 2.2 });
  return makeTemplate({
    root: r,
    height: 1.6,
    radius: 0.6,
    muzzles: [],
    glow: { glow: 1.6 },
    anim: sAnim((c, s) => {
      if (s.powered) c.n.jib.rotation.y = 2.4 + Math.sin(s.time * 0.21 + c.v.seed) * 1.1;
    }),
  });
}

/** cy_t3: a command deck on the yard's tower: lit glass deck, a turning radar bar, a tall comms mast. */
function modCommandTower(fac: Fac = 'soviet'): ModelTemplate {
  const fs = FSTYLE[fac];
  const sov = fac === 'soviet';
  const r = modRoot();
  const w = 0.56;
  const h = 0.44;
  // deck: plinth, walls, a lit glazing band on every face, overhanging roof with a team fascia
  r.box(fs.wallDark, w + 0.04, 0.06, w + 0.04, 0, 0.03, 0, { b: 0.012 });
  r.box(fs.wall, w, h - 0.06, w, 0, 0.06 + (h - 0.06) / 2, 0, { b: 0.02 });
  for (const [x, z, ry] of [[0, w / 2, 0], [w / 2, 0, Math.PI / 2], [-w / 2, 0, -Math.PI / 2], [0, -w / 2, Math.PI]] as [number, number, number][]) {
    windows(r, 4, 0.1, 0.1, 0.025, [x * 1.01, 0.3, z * 1.01], [0, ry, 0], fs.win, 'glow', ry === 0 ? [0, 1, 3] : [0, 2]);
  }
  r.box(fs.steel, w + 0.12, 0.05, w + 0.12, 0, h + 0.02, 0, { b: 0.012 });
  r.box(M.team, w + 0.13, 0.025, w + 0.13, 0, h - 0.005, 0, { b: 0.006 });
  r.box(fs.roof, w + 0.06, 0.02, w + 0.06, 0, h + 0.05, 0, { b: 0.004 });
  if (sov) {
    const st = new NB('_cst', [0, 0.16, w / 2 + 0.012]);
    st.add(starGeo(0.08), S.stencilYellow, { r: faceRot('+z') });
    st.add(starGeo(0.066), M.red, { p: [0, 0, 0.003], r: faceRot('+z') });
    mergeChild(r, st);
  } else emblem(r, fac, 0.07, [0, 0.16, w / 2 + 0.012], [0, 0, 0], true);
  // radar bar on a pedestal (turns), comms mast with bands and lights, a dish
  r.cyl(M.gun, 0.04, 0.05, 0.12, -0.12, h + 0.11, 0.1, { seg: 8 });
  const radar = r.node('radar', [-0.12, h + 0.18, 0.1]);
  radar.box(fs.steelLight, 0.42, 0.06, 0.03, 0, 0.03, 0, { b: 0.006 });
  radar.box(M.dark, 0.42, 0.02, 0.02, 0, 0.0, -0.02, { b: 0 });
  const mx = 0.14;
  const mz = -0.12;
  const mh = 0.95;
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) pipe(r, [mx + dx * 0.07, h + 0.06, mz + dz * 0.07], [mx + dx * 0.015, h + 0.06 + mh, mz + dz * 0.015], 0.007, M.dark, 4);
  for (let k = 1; k <= 4; k++) {
    const y = h + 0.06 + (mh * k) / 5;
    const ww = 0.14 - (0.11 * k) / 5;
    r.box(k % 2 ? M.team : M.white, ww, 0.04, ww, mx, y, mz, { b: 0 });
  }
  r.cyl(M.dark, 0.004, 0.004, 0.3, mx, h + 0.06 + mh + 0.15, mz, { seg: 3 });
  warnLight(r, [mx, h + 0.06 + mh + 0.31, mz], false, 0.016);
  warnLight(r, [mx, h + 0.06 + mh * 0.6, mz + 0.05], false, 0.012);
  dish(r, 0.15, h + 0.06, 0.16, 0.08, 0.6, 0.5);
  if (!sov) floodlight(r, [-0.22, h + 0.06, 0.24], 0, 0.8, 0.04);
  banner(r, fac, 0.14, 0.26, [0.2, h - 0.03, w / 2 + 0.012], 0);
  return makeTemplate({
    root: r,
    height: 1.9,
    radius: 0.45,
    muzzles: [],
    glow: { glow: 1.8 },
    anim: sAnim((c, s) => {
      if (s.powered) c.n.radar.rotation.y += dtOf(s) * 1.6;
    }),
  });
}

/** proc_processor: a second unloading line: a hopper by the dock lane, an inclined conveyor and a crusher tower. */
function modProcessor(fac: Fac = 'soviet'): ModelTemplate {
  const fs = FSTYLE[fac];
  const sov = fac === 'soviet';
  const r = modRoot();
  // raised platform over the stockpile corner (0.84 x 0.8)
  r.box(fs.wallDark, 0.84, 0.18, 0.8, 0, 0.09, 0, { b: 0.015 });
  r.box(M.concreteDark, 0.8, 0.02, 0.76, 0, 0.19, 0, { b: 0.004 });
  hazard(r, 0.8, 0.04, [0, 0.12, 0.402]);
  // processing tower (back of the platform): a boxy steel head house on a braced frame, glowing crusher windows
  const tx = -0.12;
  const tz = -0.12;
  const th = 1.02;
  const tw = 0.4;
  const clad = sov ? S.sovSteel : M.offwhite;
  r.box(clad, tw, th * 0.62, tw, tx, 0.2 + th * 0.31, tz, { b: 0.015 });
  ribs(r, fs.wallDark, tx - tw / 2 + 0.05, tx + tw / 2 - 0.05, 0.22, th * 0.6 - 0.04, tz + tw / 2, 4, 0.025, 0.015);
  r.box(M.team, tw + 0.02, 0.05, tw + 0.02, tx, 0.2 + th * 0.62, tz, { b: 0.008 });
  // head house: wider, overhanging, with a sloped roof and a lit window band
  const hy = 0.2 + th * 0.64;
  r.box(sov ? S.sovSteelLight : M.white, tw + 0.14, th * 0.3, tw + 0.1, tx, hy + th * 0.15, tz, { b: 0.015 });
  r.add(prismXY([[-(tw + 0.18) / 2, 0], [(tw + 0.18) / 2, 0], [(tw + 0.18) / 2, 0.02], [0, 0.12], [-(tw + 0.18) / 2, 0.02]], tw + 0.14, 0.008), sov ? S.roofTar : S.roofSteel, { p: [tx, hy + th * 0.3, tz] });
  windows(r, 3, 0.08, 0.06, 0.03, [tx, hy + th * 0.17, tz + (tw + 0.1) / 2 + 0.002], [0, 0, 0], { glow: 0xff8a30, i: 1.4, a: 3.3 }, 'glow');
  windows(r, 2, 0.07, 0.06, 0.04, [tx + (tw + 0.14) / 2 + 0.002, hy + th * 0.17, tz], [0, Math.PI / 2, 0], { glow: 0xff8a30, i: 1.4, a: 3.6 }, 'glow');
  r.cyl(M.gun, 0.05, 0.05, 0.12, tx + 0.1, hy + th * 0.3 + 0.1, tz - 0.06, { seg: 8 });
  r.node('smoke0', [tx + 0.1, hy + th * 0.3 + 0.18, tz - 0.06]);
  // crusher glow at the foot, a hazard band, a ladder, the crest
  r.box(M.darker, 0.22, 0.12, 0.02, tx, 0.32, tz + tw / 2 + 0.004, { b: 0 });
  r.add(quadGeo(0.18, 0.08), { glow: 0xff7a20, i: 2.2, a: 3.3 }, { p: [tx, 0.32, tz + tw / 2 + 0.016] });
  hazard(r, tw, 0.04, [tx, 0.42, tz + tw / 2 + 0.012]);
  ladder(r, th * 0.62, [tx - tw / 2 - 0.02, 0.2, tz + 0.08], -Math.PI / 2);
  if (sov) {
    const st = new NB('_pst', [tx, 0.2 + th * 0.48, tz + tw / 2 + 0.012]);
    st.add(starGeo(0.07), S.stencilYellow, { r: faceRot('+z') });
    st.add(starGeo(0.058), M.red, { p: [0, 0, 0.003], r: faceRot('+z') });
    mergeChild(r, st);
  } else stencilText(r, 'LINE 2', [tx, 0.2 + th * 0.48, tz + tw / 2 + 0.012], [0, 0, 0], 0.05, S.stencilYellow);
  warnLight(r, [tx - 0.1, hy + th * 0.3 + 0.12, tz], false, 0.014);
  // the second hopper by the dock lane (front right) with its intake glow
  const hx = 0.24;
  const hz = 0.2;
  r.box(fs.steel, 0.3, 0.16, 0.3, hx, 0.2 + 0.08, hz, { b: 0.01 });
  r.add(lathe([[0.07, 0], [0.2, 0.16], [0.21, 0.2]], 4), fs.steelLight, { p: [hx, 0.36, hz], r: [0, Math.PI / 4, 0] });
  orePile(r, hx, 0.44, hz, 0.13, 0.05, 9);
  r.add(quadGeo(0.2, 0.04), { glow: 0xff7a20, i: 1.8, a: 3.6 }, { p: [hx, 0.25, hz + 0.152] });
  // inclined conveyor gallery from the hopper up into the tower
  const a = new THREE.Vector3(hx, 0.4, hz - 0.08);
  const b = new THREE.Vector3(tx + 0.18, hy + th * 0.1, tz + 0.12);
  const len = a.distanceTo(b);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const gal = new NB('_cg', [mid.x, mid.y, mid.z], [0, -Math.atan2(b.z - a.z, b.x - a.x), Math.atan2(b.y - a.y, Math.hypot(b.x - a.x, b.z - a.z))]);
  gal.box(fs.steel, len, 0.08, 0.11, 0, 0, 0, { b: 0.008 });
  gal.box(sov ? S.roofTar : S.roofSteel, len, 0.016, 0.13, 0, 0.048, 0, { b: 0 });
  gal.box(M.team, len * 0.9, 0.014, 0.004, 0, 0.01, 0.057, { b: 0 });
  mergeChild(r, gal);
  const p = a.clone().lerp(b, 0.45);
  r.box(fs.steel, 0.03, p.y - 0.2, 0.03, p.x, 0.2 + (p.y - 0.2) / 2, p.z, { b: 0 });
  return makeTemplate({ root: r, height: 1.45, radius: 0.55, muzzles: [], smoke: ['smoke0'], glow: { glow: 1.6 }, anim: sAnim() });
}

/** powr_turbine: a turbine annex (0.62 x 0.82): generator drum on the roof, glowing vents, two exhaust stacks. */
function modTurbine(fac: Fac = 'soviet'): ModelTemplate {
  const fs = FSTYLE[fac];
  const sov = fac === 'soviet';
  const r = modRoot();
  const w = 0.62;
  const d = 0.82;
  const h = 0.72;
  const top = block(r, fs, 0, 0, w, d, h, { y0: 0, wall: sov ? fs.steel : fs.wall, ribs: 4, band: !sov });
  // glowing turbine vents on the camera side
  for (let i = 0; i < 3; i++) {
    r.box(M.darker, 0.13, 0.05, 0.02, -0.16 + i * 0.16, 0.24, d / 2 + 0.005, { b: 0 });
    r.add(quadGeo(0.11, 0.03), { glow: 0xff6a1a, i: 1.6, a: 2 + i * 0.2 }, { p: [-0.16 + i * 0.16, 0.24, d / 2 + 0.016] });
  }
  if (sov) {
    const st = new NB('_tst', [0, 0.5, d / 2 + 0.012]);
    st.add(starGeo(0.08), S.stencilYellow, { r: faceRot('+z') });
    st.add(starGeo(0.066), M.red, { p: [0, 0, 0.003], r: faceRot('+z') });
    mergeChild(r, st);
  } else emblem(r, fac, 0.065, [0, 0.5, d / 2 + 0.012], [0, 0, 0], true);
  stencilNumber(r, '2', [0.22, 0.5, d / 2 + 0.004], [0, 0, 0], 0.08, S.stencilYellow);
  // generator drum along Z on saddles, team end rings, an exciter box
  const gy = top + 0.17;
  for (const z of [-0.22, 0.2]) r.box(fs.wallDark, 0.3, 0.12, 0.06, -0.05, top + 0.06, z, { b: 0.008 });
  r.cyl(fs.steelLight, 0.16, 0.16, 0.62, -0.05, gy, 0, { r: [Math.PI / 2, 0, 0], seg: 14 });
  for (const z of [-0.3, 0.3]) r.cyl(M.team, 0.17, 0.17, 0.04, -0.05, gy, z, { r: [Math.PI / 2, 0, 0], seg: 14 });
  for (let k = 0; k < 4; k++) r.box(M.dark, 0.012, 0.33, 0.02, -0.05, gy, -0.18 + k * 0.12, { b: 0 });
  r.box(fs.steel, 0.14, 0.12, 0.18, 0.2, top + 0.06, 0.18, { b: 0.01 });
  grille(r, 0.1, 0.14, [0.2, top + 0.125, 0.18], 3);
  r.node('steam0', [0.2, top + 0.16, 0.18]);
  // exhaust stacks at the back
  chimney(r, 'smoke0', -0.17, -0.3, top - 0.02, 0.62, 0.075, 0.06, fac, sov ? S.sovSteelLight : M.steel);
  chimney(r, 'smoke1', 0.17, -0.3, top - 0.02, 0.5, 0.07, 0.055, fac, sov ? S.sovSteelLight : M.steel);
  cornerLights(r, fs, 0, 0, w, d, top - 0.015);
  return makeTemplate({ root: r, height: 1.45, radius: 0.55, muzzles: [], smoke: ['smoke0', 'smoke1'], fx: { steam: ['steam0'] }, glow: { glow: 1.6 }, anim: sAnim() });
}

/** weap_assembly: an assembly-line hall on the factory roof (sawtooth, lit glazing) and a conveyor ramp. */
function modAssembly(fac: Fac = 'soviet'): ModelTemplate {
  const fs = FSTYLE[fac];
  const sov = fac === 'soviet';
  const r = modRoot();
  // rooftop hall over the left vault (0.86 x 1.5), its walls reach down to hide the seam
  const w = 0.86;
  const d = 1.5;
  const h = 0.36;
  r.box(fs.wallDark, w + 0.03, 0.06, d + 0.03, 0, -0.02, 0, { b: 0.01 });
  r.box(fs.wall, w, h, d, 0, h / 2, 0, { b: 0.02 });
  r.box(M.team, w + 0.03, 0.03, d + 0.03, 0, h - 0.02, 0, { b: 0.008 });
  // sawtooth roof: four teeth with lit glazing facing the camera
  for (let i = 0; i < 4; i++) {
    const z = -d / 2 + 0.19 + i * 0.375;
    r.add(prismXY([[-0.17, 0], [0.17, 0], [0.17, 0.02], [-0.15, 0.17]], w - 0.04, 0.008), sov ? S.roofTar : S.roofSteel, { p: [0, h, z], r: [0, -Math.PI / 2, 0] });
    r.add(quadGeo(w - 0.1, 0.15), { glow: sov ? 0xffb35c : 0xcfe6ff, i: 0.9 }, { p: [0, h + 0.09, z + 0.163], r: [-0.08, 0, 0] });
    r.box(M.team, w - 0.02, 0.02, 0.02, 0, h + 0.17, z - 0.16, { b: 0 });
  }
  winRow(r, fs, 5, 0.1, 0.07, 0.05, 0, 0.2, d / 2, 0, [0, 1, 3, 4]);
  slogan(r, fac, ['', ''], 'ASSEMBLY 2', 0.5, 0.14, [0, 0.31, d / 2 + 0.012]);
  if (sov) sloganBoard(r, fac, 'ЦЕХ СБОРКИ', 0.5, 0.08, [0, 0.31, d / 2 + 0.012], 0, false);
  // robot arm gantry on the roof edge
  r.box(M.yellow, 0.05, 0.3, 0.05, w / 2 - 0.06, h + 0.15, d / 2 - 0.12, { b: 0.006 });
  r.box(M.yellow, 0.32, 0.04, 0.04, w / 2 - 0.2, h + 0.3, d / 2 - 0.12, { b: 0.004, r: [0, 0, 0.25] });
  warnLight(r, [w / 2 - 0.06, h + 0.32, d / 2 - 0.12], false, 0.013, { glow: 0xffa020, i: 2.2 });
  // conveyor ramp down to the front-left yard, parts crates riding it
  const a = new THREE.Vector3(-0.12, 0.12, d / 2);
  const b = new THREE.Vector3(-0.2, -0.92, d / 2 + 0.72);
  const len = a.distanceTo(b);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const ramp = new NB('_rmp', [mid.x, mid.y, mid.z], [Math.atan2(a.y - b.y, b.z - a.z), Math.atan2(b.x - a.x, b.z - a.z), 0]);
  ramp.box(fs.steel, 0.16, 0.05, len, 0, 0, 0, { b: 0.006 });
  ramp.box(M.dark, 0.13, 0.012, len, 0, 0.03, 0, { b: 0 });
  for (const s of [-1, 1]) ramp.box(M.yellow, 0.012, 0.04, len, s * 0.08, 0.04, 0, { b: 0 });
  for (let i = 0; i < 3; i++) ramp.box(i % 2 ? M.olive : M.wood, 0.08, 0.06, 0.08, 0, 0.065, -len / 2 + 0.25 + i * (len / 3.2), { b: 0.006 });
  mergeChild(r, ramp);
  for (const f of [0.35, 0.7]) {
    const p = a.clone().lerp(b, f);
    r.box(fs.steel, 0.03, p.y + 0.92, 0.03, p.x, (p.y - 0.92) / 2, p.z, { b: 0 });
  }
  return makeTemplate({ root: r, height: 0.6, radius: 0.85, muzzles: [], glow: { glow: 1.6 }, anim: sAnim() });
}

/** weap_armor: an armour shop on the factory roof: a plate press (the ram works), plate racks, a jib crane. */
function modArmorShop(fac: Fac = 'soviet'): ModelTemplate {
  const fs = FSTYLE[fac];
  const sov = fac === 'soviet';
  const r = modRoot();
  // deck spanning the right vault
  const w = 0.86;
  const d = 0.92;
  r.box(fs.wallDark, w + 0.03, 0.06, d + 0.03, 0, -0.02, 0, { b: 0.01 });
  r.box(fs.wall, w, 0.24, d, 0, 0.12, 0, { b: 0.02 });
  r.box(M.team, w + 0.03, 0.03, d + 0.03, 0, 0.22, 0, { b: 0.008 });
  r.box(S.grating, w - 0.04, 0.012, d - 0.04, 0, 0.246, 0, { b: 0 });
  const y = 0.25;
  // the press: two columns, a crown, the ram (node 'ram' moves), a glowing hot plate on the bolster
  const px = -0.14;
  const pz = 0.06;
  r.box(fs.steel, 0.42, 0.1, 0.3, px, y + 0.05, pz, { b: 0.012 });
  for (const s of [-1, 1]) r.box(sov ? S.sovSteelLight : M.offwhite, 0.08, 0.66, 0.2, px + s * 0.18, y + 0.33, pz, { b: 0.012 });
  r.box(sov ? S.sovSteelLight : M.offwhite, 0.5, 0.16, 0.26, px, y + 0.72, pz, { b: 0.014 });
  r.box(M.team, 0.51, 0.04, 0.27, px, y + 0.68, pz, { b: 0.006 });
  for (const s of [-1, 1]) r.cyl(M.gun, 0.03, 0.03, 0.12, px + s * 0.1, y + 0.86, pz, { seg: 8 });
  const ram = r.node('ram', [px, y + 0.5, pz]);
  ram.box(M.gun, 0.26, 0.1, 0.18, 0, 0, 0, { b: 0.01 });
  ram.cyl(M.steel, 0.035, 0.035, 0.2, 0, 0.13, 0, { seg: 8 });
  r.box(M.team, 0.24, 0.025, 0.16, px, y + 0.115, pz, { b: 0.004 });
  r.add(quadGeo(0.2, 0.12), { glow: 0xff7a20, i: 1.2, a: 2.5 }, { p: [px, y + 0.13, pz], r: [-Math.PI / 2, 0, 0] });
  hazard(r, 0.42, 0.04, [px, y + 0.05, pz + 0.152]);
  // plate racks (team-painted armour plates) and a jib crane holding one
  for (let i = 0; i < 4; i++) r.box(i % 2 ? M.team : M.teamDark, 0.03, 0.26, 0.3, 0.24 + i * 0.045, y + 0.13, -0.24, { b: 0.004, r: [0, 0, -0.18] });
  r.box(M.dark, 0.24, 0.03, 0.34, 0.3, y + 0.015, -0.24, { b: 0 });
  r.cyl(M.yellow, 0.02, 0.025, 0.62, 0.3, y + 0.31, 0.26, { seg: 8 });
  r.box(M.yellow, 0.42, 0.03, 0.03, 0.12, y + 0.6, 0.26, { b: 0 });
  r.cyl(M.steel, 0.003, 0.003, 0.28, -0.04, y + 0.45, 0.26, { seg: 3 });
  r.box(M.team, 0.24, 0.02, 0.18, -0.04, y + 0.3, 0.26, { b: 0.004, r: [0, 0.4, 0] });
  warnLight(r, [0.3, y + 0.63, 0.26], false, 0.013, { glow: 0xffa020, i: 2.2 });
  sloganBoard(r, fac, sov ? 'БРОНЯ' : 'ARMOUR SHOP', 0.42, 0.08, [0, 0.12, d / 2 + 0.012], 0, false);
  return makeTemplate({
    root: r,
    height: 1.0,
    radius: 0.6,
    muzzles: [],
    glow: { glow: 1.6 },
    anim: sAnim((c, s) => {
      if (!s.powered) return;
      // slow lift, a fast stroke down, a short dwell
      const t = (s.time * 0.5 + c.v.seed) % 1;
      const k = t < 0.7 ? t / 0.7 : t < 0.8 ? 1 - (t - 0.7) / 0.1 : 0;
      c.n.ram.position.y = 0.25 + 0.17 + k * 0.18;
    }),
  });
}

/** barr_training (Soviet barracks): rappel tower, wall obstacles, tyre run, a target range with red bullseyes. */
function modTrainingSov(fac: Fac = 'soviet'): ModelTemplate {
  return trainingYard(fac, 'barr');
}

/** barr_training (Allied barracks): obstacle lane along the hut's right side, a rappel tower, targets. */
function modTrainingAll(fac: Fac = 'allies'): ModelTemplate {
  return trainingYard(fac, 'tent');
}

function trainingYard(fac: Fac, host: 'barr' | 'tent'): ModelTemplate {
  const fs = FSTYLE[fac];
  const sov = fac === 'soviet';
  const r = modRoot();
  const sand: Mat = { c: 0xc2a874, m: 0, r: 0.96, d: 2 };
  const wood = M.wood;
  const target = (x: number, z: number, ry: number) => {
    const n = new NB('_tg', [x, 0, z], [0, ry, 0]);
    n.box(wood, 0.02, 0.3, 0.02, -0.09, 0.15, 0, { b: 0 });
    n.box(wood, 0.02, 0.3, 0.02, 0.09, 0.15, 0, { b: 0 });
    n.add(discGeo(0.115, 0.01, 14), M.white, { p: [0, 0.27, 0.004], r: [Math.PI / 2, 0, 0] });
    n.add(discGeo(0.085, 0.01, 14), sov ? M.red : M.navy, { p: [0, 0.27, 0.009], r: [Math.PI / 2, 0, 0] });
    n.add(discGeo(0.05, 0.01, 12), M.white, { p: [0, 0.27, 0.014], r: [Math.PI / 2, 0, 0] });
    n.add(discGeo(0.022, 0.01, 8), sov ? M.red : M.navy, { p: [0, 0.27, 0.019], r: [Math.PI / 2, 0, 0] });
    mergeChild(r, n);
  };
  const tower = (x: number, z: number, h: number) => {
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) r.box(wood, 0.03, h, 0.03, x + dx * 0.1, h / 2, z + dz * 0.1, { b: 0 });
    for (let k = 1; k < 4; k++) {
      const y = (h * k) / 4;
      r.box(wood, 0.22, 0.016, 0.016, x, y, z - 0.1, { b: 0, r: [0, 0, k % 2 ? 0.5 : -0.5] });
      r.box(wood, 0.016, 0.016, 0.22, x - 0.1, y, z, { b: 0, r: [k % 2 ? 0.5 : -0.5, 0, 0] });
    }
    r.box(wood, 0.3, 0.025, 0.3, x, h, z, { b: 0.004 });
    for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1]]) r.box(wood, dx ? 0.016 : 0.3, 0.1, dx ? 0.3 : 0.016, x + dx * 0.14, h + 0.06, z + dz * 0.14, { b: 0 });
    r.box(M.team, 0.3, 0.04, 0.012, x, h + 0.08, z - 0.145, { b: 0 });
    banner(r, fac, 0.2, 0.3, [x, h - 0.01, z + 0.12], 0, true);
    // rope net down the front
    for (let i = 0; i < 4; i++) r.box(M.khaki, 0.006, h, 0.006, x - 0.09 + i * 0.06, h / 2, z + 0.16 + (h / 2) * 0.0, { b: 0, r: [-0.18, 0, 0] });
    // flag
    r.cyl(M.steel, 0.008, 0.008, 0.36, x + 0.12, h + 0.18, z - 0.12, { seg: 4 });
    r.box(M.team, 0.16, 0.1, 0.006, x + 0.2, h + 0.31, z - 0.12, { b: 0 });
    if (sov) r.add(starGeo(0.025, 0.004), S.stencilYellow, { p: [x + 0.16, h + 0.32, z - 0.115], r: faceRot('+z') });
    else r.add(starGeo(0.025, 0.004), M.white, { p: [x + 0.16, h + 0.32, z - 0.115], r: faceRot('+z') });
  };
  const wallObstacle = (x: number, z: number, w: number, h: number, ry = 0) => {
    const n = new NB('_wo', [x, 0, z], [0, ry, 0]);
    n.box(wood, w, h, 0.03, 0, h / 2, 0, { b: 0.004 });
    n.box(M.dark, w + 0.02, 0.015, 0.035, 0, h, 0, { b: 0 });
    mergeChild(r, n);
  };
  const tyres = (x: number, z: number, n: number, ry = 0) => {
    const g = new NB('_ty', [x, 0, z], [0, ry, 0]);
    for (let i = 0; i < n; i++) for (const s of [-1, 1]) g.add(new THREE.TorusGeometry(0.035, 0.014, 4, 8), M.rubber, { p: [i * 0.08, 0.014, s * 0.045], r: [Math.PI / 2, 0, 0] });
    mergeChild(r, g);
  };
  if (host === 'barr') {
    // the barracks' front yard: local origin at the yard centre (world z ~ 0.66); exit lane kept clear at x ~ 0.5
    r.box(sand, 0.62, 0.012, 0.56, -0.62, 0.006, 0.0, { b: 0 });
    tower(-0.66, -0.06, 0.86);
    tyres(-0.86, 0.22, 4);
    wallObstacle(-0.36, 0.2, 0.2, 0.16);
    wallObstacle(-0.36, -0.14, 0.2, 0.12);
    // target range along the right edge, firing point with a sandbag rest
    r.box(sand, 0.22, 0.012, 0.58, 0.82, 0.006, 0.0, { b: 0 });
    for (let i = 0; i < 3; i++) target(0.86, -0.2 + i * 0.18, -Math.PI / 2);
    sandbags(r, 0.22, 2, [0.3, 0, 0.24], [0, Math.PI / 2, 0]);
    soldier(r, sov ? M.oliveDark : M.olive, sov ? M.oliveDark : M.olive, 0.36, 0.0, 0.1, -Math.PI / 2);
    // instructor's stand with a megaphone pole and a lamp
    r.box(wood, 0.16, 0.12, 0.14, -0.18, 0.06, 0.24, { b: 0.006 });
    r.cyl(M.dark, 0.008, 0.008, 0.4, -0.24, 0.2, 0.2, { seg: 4 });
    r.cyl(M.gun, 0.02, 0.04, 0.06, -0.22, 0.38, 0.22, { seg: 6, r: [0, 0, -1.2] });
  } else {
    // the Allied hut's right side lane (local origin at x 0.72, z -0.06) + targets at the front
    r.box(sand, 0.42, 0.012, 1.1, 0.0, 0.006, 0.0, { b: 0 });
    tower(0.02, -0.4, 0.86);
    wallObstacle(0.0, 0.0, 0.26, 0.16);
    tyres(-0.12, 0.2, 4, 0);
    wallObstacle(0.0, 0.42, 0.26, 0.12);
    r.box(wood, 0.3, 0.02, 0.02, 0.0, 0.1, 0.3, { b: 0 });
    target(0.12, 0.56, 0);
    soldier(r, M.olive, M.olive, -0.1, 0.0, 0.38, 0.2);
  }
  warnLight(r, [host === 'barr' ? -0.76 : -0.08, 0.9, host === 'barr' ? -0.16 : -0.5], false, 0.014);
  return makeTemplate({ root: r, height: 0.9, radius: 0.9, muzzles: [], glow: { glow: 1.6 }, anim: sAnim() });
}

/** dome_uplink: a rooftop uplink station: an equipment house and a big tracking dish ('dish' turns). */
function modUplink(fac: Fac = 'soviet'): ModelTemplate {
  const fs = FSTYLE[fac];
  const sov = fac === 'soviet';
  const r = modRoot();
  // equipment house (0.6 x 0.5) over the roof clutter
  const top = block(r, fs, 0, 0, 0.6, 0.5, 0.2, { y0: 0, band: false, plinth: 0.04 });
  winRow(r, fs, 3, 0.07, 0.05, 0.05, -0.08, 0.11, 0.25, 0, [0, 2]);
  r.add(quadGeo(0.08, 0.025), { glow: sov ? 0xff2414 : 0x7ad8ff, i: 2, a: 2.4 }, { p: [0.2, 0.12, 0.255] });
  // pedestal + turntable + the dish
  r.cyl(fs.steel, 0.1, 0.13, 0.18, 0.02, top + 0.09, -0.02, { seg: 12 });
  const d = r.node('dish', [0.02, top + 0.2, -0.02]);
  d.cyl(M.gun, 0.12, 0.12, 0.05, 0, 0.0, 0, { seg: 12 });
  d.box(fs.steel, 0.16, 0.16, 0.08, 0, 0.1, 0, { b: 0.01 });
  const dd = new NB('_ud', [0, 0.22, 0.02], [-0.72, 0, 0]);
  dd.add(lathe([[0.0, 0.0], [0.14, 0.012], [0.26, 0.05], [0.36, 0.1], [0.38, 0.12]], 18), M.offwhite);
  dd.add(new THREE.TorusGeometry(0.375, 0.012, 4, 18), M.team, { p: [0, 0.12, 0], r: [Math.PI / 2, 0, 0] });
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    pipe(dd, [Math.cos(a) * 0.3, 0.09, Math.sin(a) * 0.3], [0, 0.32, 0], 0.006, M.dark, 3);
  }
  dd.cyl(M.gun, 0.03, 0.02, 0.07, 0, 0.34, 0, { seg: 8 });
  dd.add(new THREE.OctahedronGeometry(0.014, 0), { glow: sov ? 0xff2414 : 0x7ad8ff, i: 2.4, a: 1.5 }, { p: [0, 0.38, 0] });
  mergeChild(d, dd);
  if (sov) {
    const st = new NB('_ust', [0.18, 0.1, 0.255]);
    st.add(starGeo(0.045), S.stencilYellow, { r: faceRot('+z') });
    st.add(starGeo(0.037), M.red, { p: [0, 0, 0.003], r: faceRot('+z') });
    mergeChild(r, st);
  }
  warnLight(r, [-0.26, top + 0.05, -0.2], false, 0.013);
  return makeTemplate({
    root: r,
    height: 0.95,
    radius: 0.45,
    muzzles: [],
    glow: { glow: 1.6 },
    anim: sAnim((c, s) => {
      if (!s.powered) return;
      c.n.dish.rotation.y = Math.sin(s.time * 0.09 + c.v.seed) * 0.9 + Math.sin(s.time * 0.31) * 0.15;
    }),
  });
}

/**
 * def_reinforced: a concrete and armour collar for a defence of footprint (fw, fh) cells: sandbag walls along
 * the edges, concrete corner blocks, team-painted armour plates leaning on them. `gate` keeps the passage clear
 * (the walls run east-west through the gate: only the gate's pillars get plates).
 */
function modReinforced(fac: Fac, fw: number, fh: number, gate = false): ModelTemplate {
  const fs = FSTYLE[fac];
  const r = modRoot();
  const hx = fw / 2 - 0.06;
  const hz = fh / 2 - 0.06;
  const conc = fac === 'soviet' ? S.sovWall : S.allWall;
  const plate = (x: number, z: number, yaw: number, w: number, h: number) => {
    const n = new NB('_ap', [x, 0, z], [0, yaw, 0]);
    n.box(M.team, w, h, 0.03, 0, h / 2 - 0.01, 0, { b: 0.006, r: [-0.18, 0, 0] });
    n.box(M.teamDark, w + 0.01, 0.03, 0.035, 0, h * 0.7, -0.02, { b: 0, r: [-0.18, 0, 0] });
    for (const s of [-1, 1]) n.box(M.gun, 0.02, 0.02, 0.02, s * (w / 2 - 0.03), h * 0.85, 0.01, { b: 0 });
    mergeChild(r, n);
  };
  if (gate) {
    // armour plates bolted over both pillars' faces, sandbags banked against their feet
    for (const s of [-1, 1]) {
      for (const zz of [-1, 1]) {
        r.box(M.team, 0.2, 0.62, 0.025, s * 0.4, 0.42, zz * 0.225, { b: 0.006 });
        for (let k = 0; k < 3; k++) r.box(M.teamDark, 0.21, 0.02, 0.03, s * 0.4, 0.2 + k * 0.2, zz * 0.225, { b: 0 });
        sandbags(r, 0.22, 2, [s * 0.4, 0, zz * 0.3]);
      }
      r.box(conc, 0.28, 0.1, 0.5, s * 0.4, 0.05, 0, { b: 0.02 });
    }
    return makeTemplate({ root: r, height: 1.2, radius: 0.55, muzzles: [], glow: { glow: 1.6 }, anim: sAnim() });
  }
  // sandbag walls along each edge (two staggered rows of plain bags: light enough for a ring on every defence),
  // leaving the corners for the concrete blocks
  const bags = (ax: number, az: number, bx: number, bz: number) => {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.12) return;
    const n = new NB('_bw', [(ax + bx) / 2, 0, (az + bz) / 2], [0, -Math.atan2(bz - az, bx - ax), 0]);
    const k = Math.max(1, Math.round(len / 0.12));
    const bw = len / k;
    for (let row = 0; row < 2; row++) {
      const cnt = row ? k - 1 : k;
      for (let i = 0; i < cnt; i++) n.box(i % 2 ? M.sand : M.khaki, bw * 0.94, 0.045, 0.08 - row * 0.012, -len / 2 + bw * (i + 0.5 + row * 0.5), 0.0225 + row * 0.042, 0, { b: 0 });
    }
    mergeChild(r, n);
  };
  const c = 0.12;
  bags(-hx + c, hz, hx - c, hz);
  bags(-hx + c, -hz, hx - c, -hz);
  bags(-hx, -hz + c, -hx, hz - c);
  bags(hx, -hz + c, hx, hz - c);
  // concrete corner blocks with a team-painted armour plate leaning on the outer faces
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const x = sx * hx;
    const z = sz * hz;
    r.box(fs.wallDark, 0.17, 0.08, 0.17, x, 0.04, z, { b: 0.012 });
    r.box(conc, 0.14, 0.13, 0.14, x, 0.13, z, { b: 0.02 });
    r.box(M.team, 0.15, 0.025, 0.15, x, 0.2, z, { b: 0.006 });
    plate(x + sx * 0.1, z + sz * 0.02, sz > 0 ? 0 : Math.PI, 0.14, 0.2);
  }
  // larger footprints: armour plates mid-way along the long edges
  if (fw >= 2) for (const sz of [-1, 1]) plate(0, sz * (hz + 0.04), sz > 0 ? 0 : Math.PI, 0.22, 0.24);
  if (fh >= 2) for (const sx of [-1, 1]) plate(sx * (hx + 0.04), 0, sx > 0 ? Math.PI / 2 : -Math.PI / 2, 0.22, 0.24);
  return makeTemplate({ root: r, height: 0.3, radius: Math.max(fw, fh) * 0.55, muzzles: [], glow: { glow: 1.6 }, anim: sAnim() });
}

// =============================================================================================
// registry
// =============================================================================================

/** The Commander-rules structures: purf / smlt are single-faction, the others are dressed per owner faction. */
export const COMMANDER_BUILDERS: Record<string, (fac: ModelFaction) => ModelTemplate> = {
  purf: () => orePurifier(),
  smlt: () => oreSmelter(),
  mout: miningOutpost,
  lgst: logisticsCentre,
  rlab: researchLab,
  bnkr: bunker,
  gate: fortressGate,
};

/**
 * Upgrade-module models (all dressed per owner faction): upgrade-modules.ts maps (host type, upgrade id) to one of
 * these and its anchor. Their HD versions are '<id>.<faction>' entries of the HD manifest like any structure's.
 */
export const MODULE_BUILDERS: Record<string, (fac: ModelFaction) => ModelTemplate> = {
  mcy2: modYardBay,
  mcy3: modCommandTower,
  mprc: modProcessor,
  mtrb: modTurbine,
  mwas: modAssembly,
  mwar: modArmorShop,
  mtrs: modTrainingSov,
  mtra: modTrainingAll,
  mupl: modUplink,
  mdf1: (f) => modReinforced(f, 1, 1),
  mdf12: (f) => modReinforced(f, 1, 2),
  mdf21: (f) => modReinforced(f, 2, 1),
  mdf22: (f) => modReinforced(f, 2, 2),
  mdfg: (f) => modReinforced(f, 1, 1, true),
};

/** Ids of the upgrade-module models (not game types: the HD manifest test accepts them as module models). */
export const MODULE_MODEL_IDS: readonly string[] = Object.keys(MODULE_BUILDERS);

registerFactionDressed(...DRESSED);
