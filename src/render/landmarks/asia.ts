/**
 * Asian landmarks (front to +z = south, towards the default camera). Silhouette and proportions first; 'high' adds
 * crenellations, colonnades, tile work and ornament.
 */
import * as THREE from 'three';
import type { NB, V3 } from '../models/builder';
import type { LandmarkBuilder, LCtx } from './common';
import { mound } from './common';
import {
  ridged, LAMP, P, Poly, WIN, archWallGeo, colouredLathe, cypress, domeProfile, fbm2, heightField, latheGeo, lin, mixc, noise2, onionProfile,
  put, rng, stepped, sweptRoof, tint, type ArchOpening,
} from './kit';

/** A window / recess quad facing +z at depth z0 (x, y = centre). */
function pane(p: Poly, x: number, y: number, w: number, h: number, z0: number): void {
  p.quad([x - w / 2, y - h / 2, z0], [x + w / 2, y - h / 2, z0], [x + w / 2, y + h / 2, z0], [x - w / 2, y + h / 2, z0]);
}

/** A pointed (Islamic) arch recess facing +z: a rectangle with a pointed head. */
function iwan(p: Poly, x: number, y0: number, w: number, h: number, z0: number): void {
  const spring = y0 + h - w * 0.55;
  p.quad([x - w / 2, y0, z0], [x + w / 2, y0, z0], [x + w / 2, spring, z0], [x - w / 2, spring, z0]);
  p.quad([x - w / 2, spring, z0], [x + w / 2, spring, z0], [x + w * 0.18, y0 + h - w * 0.08, z0], [x - w * 0.18, y0 + h - w * 0.08, z0]);
  p.tri([x - w * 0.18, y0 + h - w * 0.08, z0], [x + w * 0.18, y0 + h - w * 0.08, z0], [x, y0 + h, z0]);
}

/** A matrix placing a facade frame (local +z outward) at (x, y0, z), turned by ry. */
function frame(x: number, y0: number, z: number, ry: number): THREE.Matrix4 {
  return new THREE.Matrix4().makeRotationY(ry).setPosition(x, y0, z);
}

/** Domed kiosk on four posts (chhatri). */
function chhatri(nb: NB, posts: Poly, surf: { c: number; m: number; r: number; d: 0 | 1 | 2 | 3 }, x: number, y0: number, z: number, r0: number, hi: boolean): void {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) posts.box(x + sx * r0 * 0.7, y0, z + sz * r0 * 0.7, r0 * 0.18, r0 * 1.2, r0 * 0.18);
  posts.box(x, y0 + r0 * 1.2, z, r0 * 2.0, r0 * 0.14, r0 * 2.0);
  nb.add(latheGeo(onionProfile(r0 * 0.95, r0 * 1.15, r0 * 0.75, hi ? 6 : 4), hi ? 12 : 6), surf, { p: [x, y0 + r0 * 1.32, z] });
}

// ---------------------------------------------------------------------------------------------------------
// Great Wall (12 x 3, ~1.8 tall): a crenellated wall snaking along a green ridge, square watchtowers
// ---------------------------------------------------------------------------------------------------------

function greatWall(k: LCtx): void {
  const { nb, hi } = k;
  // the ridge climbs and dips along x; the wall snakes along its crest, its watchtowers on the bends
  const crest = (x: number) => 0.62 + 0.42 * Math.sin(x * 0.52 + 0.5) + 0.22 * Math.sin(x * 1.25 + 1.1);
  const wz = (x: number) => 0.6 * Math.sin(x * 0.75 + 0.6);
  const ends = (x: number) => { const t = Math.min(1, Math.max(0, (6 - Math.abs(x)) / 1.6)); return t * t * (3 - 2 * t); };
  // the ridge's flanks fall all the way to the ground well inside the footprint: no edge, no skirt in sight
  const sides = (z: number) => { const t = Math.min(1, Math.max(0, (1.5 - Math.abs(z)) / 0.55)); return t * t * (3 - 2 * t); };
  const ground = (x: number, z: number) => {
    const dz = (z - wz(x) * 0.85) / 0.8;
    return -0.12 + (crest(x) * Math.exp(-dz * dz) + 0.1 * (fbm2(x * 0.9, z * 0.9, 3, k.seed) - 0.5)) * ends(x) * sides(z);
  };
  const green = lin(0x587236), brown = lin(0x7a6a4a), rock = lin(0x8a8070);
  heightField(nb, 12, 3, hi ? 84 : 32, hi ? 18 : 8, ground, (x, z, y, slope) => mixc(mixc(green, brown, (noise2(x * 2, z * 2, 4) - 0.3) * 0.8), rock, Math.min(1, Math.max(0, slope - 0.9))), P.grass, 0.2);
  const wall = new Poly(), top = new Poly(), towers = new Poly(), dark = new Poly(), roofs = new Poly();
  const step = hi ? 0.2 : 0.45;
  const pts: V3[] = [];
  for (let x = -5.7; x <= 5.71; x += step) pts.push([x, ground(x, wz(x)), wz(x)]);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    wall.beam([a[0], a[1] + 0.06, a[2]], [b[0], b[1] + 0.06, b[2]], 0.42, 0.9);
    const dx = b[0] - a[0], dz = b[2] - a[2], len = Math.hypot(dx, dz);
    const nx = -dz / len, nz = dx / len;
    for (const s of [-1, 1]) {
      const o = 0.19 * s;
      if (hi) {
        for (const t of [0.25, 0.75]) {
          const x = a[0] + dx * t + nx * o, z = a[2] + dz * t + nz * o, y = a[1] + (b[1] - a[1]) * t + 0.5;
          top.boxR(x, y, z, 0.07, 0.1, 0.05, Math.atan2(-dz, dx));
        }
      } else top.beam([a[0] + nx * o, a[1] + 0.55, a[2] + nz * o], [b[0] + nx * o, b[1] + 0.55, b[2] + nz * o], 0.05, 0.1);
    }
  }
  // watchtowers where the wall turns (the crests of its curve) and at both ends
  for (const tx of [-5.45, -2.9, 1.3, 5.45]) {
    const tz = wz(tx), ty = ground(tx, tz);
    towers.box(tx, ty - 0.3, tz, 0.76, 1.35, 0.8);
    for (const [dx, dz] of [[-0.33, -0.36], [0, -0.36], [0.33, -0.36], [-0.33, 0.36], [0, 0.36], [0.33, 0.36], [-0.33, 0], [0.33, 0]]) top.box(tx + dx, ty + 1.05, tz + dz, 0.09, 0.11, 0.09);
    for (const s of [-1, 1]) for (const dx of [-0.17, 0.17]) {
      dark.quad([tx + dx - 0.06 * s, ty + 0.48, tz + s * 0.401], [tx + dx + 0.06 * s, ty + 0.48, tz + s * 0.401], [tx + dx + 0.06 * s, ty + 0.72, tz + s * 0.401], [tx + dx - 0.06 * s, ty + 0.72, tz + s * 0.401]);
    }
    if (tx === 1.3) {
      towers.box(tx, ty + 1.05, tz, 0.4, 0.28, 0.4);
      sweptRoof(roofs, tx, ty + 1.33, tz, 0.42, 0.42, 0.22, 0.1, 0.05, hi);
    }
  }
  put(nb, wall, { c: 0x9c9586, m: 0, r: 0.92, d: 1 });
  put(nb, top, { c: 0x8a8476, m: 0, r: 0.92, d: 1 });
  put(nb, towers, { c: 0xa29a8a, m: 0, r: 0.92, d: 1 });
  put(nb, dark, P.dark);
  put(nb, roofs, { c: 0x4a5058, m: 0.1, r: 0.6, d: 3 });
}

// ---------------------------------------------------------------------------------------------------------
// Forbidden City: the Hall of Supreme Harmony (8 x 6, ~2.6 tall): the three-tier white marble terrace, the red hall
// and its columns, the great double-eaved roof of yellow glazed tiles; the galleries either side
// ---------------------------------------------------------------------------------------------------------

const YELLOW_TILE = { c: 0xe0a92a, m: 0.15, r: 0.38, d: 3 as const };
const RED_WALL = { c: 0xa22a1e, m: 0, r: 0.7, d: 1 as const };

function forbiddenCity(k: LCtx): void {
  const { nb, hi } = k;
  const marble = new Poly(), red = new Poly(), roof = new Poly(), dark = new Poly(), gold = new Poly(), win = new Poly(), stone = new Poly();
  // the terrace: three tiers with balustrades, the central ramp in front
  const tiers: [number, number][] = [[6.6, 4.6], [6.1, 4.1], [5.6, 3.6]];
  tiers.forEach(([w, d], i) => {
    marble.box(0, -0.2 + i * 0.25, -0.2, w, i ? 0.25 : 0.45, d);
    const y = 0.05 + i * 0.25;
    if (hi) {
      const n = Math.round(w / 0.22);
      for (let j = 0; j <= n; j++) for (const s of [-1, 1]) marble.box(-w / 2 + (w * j) / n, y, -0.2 + s * (d / 2 - 0.02), 0.035, 0.1, 0.035);
      const m = Math.round(d / 0.22);
      for (let j = 0; j <= m; j++) for (const s of [-1, 1]) marble.box(s * (w / 2 - 0.02), y, -0.2 - d / 2 + (d * j) / m, 0.035, 0.1, 0.035);
    }
    marble.box(0, y + 0.05, -0.2 + d / 2 - 0.02, w, 0.035, 0.03);
  });
  marble.prismZ([[-0.45, 0], [0.45, 0], [0.45, 0.04], [-0.45, 0.04]], 1.6, 2.9);
  marble.prismX([[2.85, 0], [1.6, 0.75], [1.6, 0], [2.85, 0]].slice(0, 3) as [number, number][], -0.35, 0.35);
  // the hall: red walls, a colonnade of red columns at the front, golden doors
  const y0 = 0.75;
  red.box(0, y0, -0.35, 4.2, 0.85, 2.0);
  const cols = hi ? 12 : 6;
  for (let i = 0; i < cols; i++) red.ngon(-2.25 + (4.5 * i) / (cols - 1), y0, 0.78, 0.06, 0.06, 0.82, hi ? 8 : 5);
  for (let i = 0; i < (hi ? 9 : 5); i++) {
    const x = -1.8 + (3.6 * i) / ((hi ? 9 : 5) - 1);
    pane(gold, x, y0 + 0.4, 0.28, 0.58, 0.655);
    if (hi) pane(win, x, y0 + 0.62, 0.22, 0.14, 0.66);
  }
  // the double-eaved roof: a lower skirt roof all round, the upper hip roof with its ridge
  sweptRoof(roof, 0, y0 + 0.86, -0.3, 4.75, 2.55, 0.32, 0.18, 0.1, hi);
  red.box(0, y0 + 1.05, -0.3, 3.7, 0.32, 1.55);
  dark.box(0, y0 + 1.3, -0.3, 3.75, 0.06, 1.6);
  sweptRoof(roof, 0, y0 + 1.36, -0.3, 4.15, 1.95, 0.72, 0.22, 0.12, hi);
  for (const s of [-1, 1]) roof.box(s * 1.05, y0 + 2.0, -0.3, 0.1, 0.18, 0.12); // ridge beasts
  // the galleries either side of the courtyard
  for (const s of [-1, 1]) {
    red.box(s * 3.65, -0.1, 0.0, 0.55, 0.55, 4.4);
    sweptRoof(roof, s * 3.65, 0.45, 0.0, 0.55, 4.4, 0.22, 0.1, 0.05, hi);
  }
  // bronze incense burners and lamps on the terrace
  if (hi) for (const s of [-1, 1]) { stone.ngon(s * 1.6, 0.75, 1.25, 0.08, 0.06, 0.18, 6); gold.box(s * 1.6, 0.93, 1.25, 0.06, 0.05, 0.06); }
  put(nb, marble, P.marble);
  put(nb, red, RED_WALL);
  put(nb, roof, YELLOW_TILE);
  put(nb, dark, P.dark);
  put(nb, gold, { glow: 0xffb050, i: 0.5 });
  put(nb, win, WIN);
  put(nb, stone, P.ironDark);
}

// ---------------------------------------------------------------------------------------------------------
// Mount Fuji (12 x 12, 5.4 tall): the near-perfect concave cone, its crater, the snow cap streaking down the gullies,
// dark volcanic slopes and forest at the foot
// ---------------------------------------------------------------------------------------------------------

function mountFuji(k: LCtx): void {
  const { nb, hi } = k;
  const snow = lin(0xf4f6f8), ash = lin(0x5a5560), ashRed = lin(0x7a5c52), forest = lin(0x5a6c3c), meadow = lin(0x627040);
  heightField(nb, 12, 12, hi ? 80 : 30, hi ? 80 : 30, (x, z) => {
    const a = Math.atan2(z, x);
    const r = Math.hypot(x, z * 1.03) / 5.9 * (1 + 0.025 * Math.sin(a * 3 + 1) + 0.09 * (noise2(Math.cos(a) * 2 + 4, Math.sin(a) * 2 + 4, k.seed) - 0.5) * Math.max(0, 1 - (1 - Math.hypot(x, z) / 5.9) * 3));
    if (r >= 1) return -0.1;
    const cone = 5.45 * Math.pow(1 - r, 1.75);
    const gully = 0.08 * (ridged(a * 4, r * 6, k.seed) - 0.5) * r * (1 - r) * 4;
    let h = Math.min(cone, 5.2) + gully;
    if (r < 0.055) h -= 0.25 * (1 - r / 0.055); // the crater
    return -0.1 + h + 0.1 * (fbm2(x * 0.7, z * 0.7, 3, k.seed) - 0.5) * (1 - r);
  }, (x, z, y) => {
    const a = Math.atan2(z, x);
    const line = 3.4 + 0.4 * Math.sin(a * 9) + 0.15 * Math.sin(a * 17 + 1) + 0.25 * (fbm2(x * 0.9, z * 0.9, 2, 5) - 0.5);
    if (y > line - 0.25) return mixc(lin(0x8a6a5e), snow, Math.min(1, (y - line + 0.25) / 0.35)); // a soft snow line

    if (y < 0.7) return mixc(forest, meadow, noise2(x * 1.4, z * 1.4, 3));
    // the volcanic slopes: dark ash low down, rusty scree higher up, patchy
    const t = Math.min(1, (y - 0.7) / 2.6) + (fbm2(x * 1.3, z * 1.3, 3, 11) - 0.5) * 0.5;
    return mixc(mixc(forest, ash, Math.min(1, (y - 0.7) / 0.5)), ashRed, Math.max(0, Math.min(1, t)));
  }, { c: 0xffffff, m: 0, r: 0.88, d: 1 }, 0.25);
}

// ---------------------------------------------------------------------------------------------------------
// Himeji Castle (6 x 6, ~4.8 tall): the White Heron: a battered stone base and five white storeys under swept grey
// roofs with gables, three smaller keeps linked to it
// ---------------------------------------------------------------------------------------------------------

const HIMEJI_WHITE = { c: 0xf0eee8, m: 0, r: 0.7, d: 1 as const };
const HIMEJI_ROOF = { c: 0x5a626c, m: 0.1, r: 0.55, d: 3 as const };

function keep(white: Poly, roof: Poly, dark: Poly, win: Poly, x: number, y0: number, z: number, w: number, d: number, storeys: number, sh: number, hi: boolean): number {
  let y = y0;
  for (let i = 0; i < storeys; i++) {
    const f = 1 - i * 0.13;
    const ww = w * f, dd = d * f;
    white.box(x, y, z, ww, sh, dd);
    for (let j = 0; j < Math.max(1, Math.round(ww / 0.35)); j++) {
      const xx = x - ww / 2 + (ww * (j + 0.5)) / Math.max(1, Math.round(ww / 0.35));
      pane(i === storeys - 1 ? win : dark, xx, y + sh * 0.55, 0.08, 0.1, z + dd / 2 + 0.004);
    }
    const last = i === storeys - 1;
    sweptRoof(roof, x, y + sh, z, ww, dd, last ? 0.42 : 0.2, 0.15, 0.08, hi);
    // a triangular gable on the front slope of alternate roofs
    if (hi && i % 2 === 1 && !last) {
      white.prismZ([[-ww * 0.18, 0], [ww * 0.18, 0], [0, 0.2]], -0.05, 0.12, x, z + dd / 2);
      roof.prismZ([[-ww * 0.22, 0], [ww * 0.22, 0], [0, 0.25]], 0.0, 0.16, x, z + dd / 2 - 0.02 + 0.0);
    }
    y += sh + (last ? 0.42 : 0.12);
  }
  return y;
}

function himeji(k: LCtx): void {
  const { nb, hi } = k;
  mound(k, 6, 6, 0.3, 0x5a7238, 0x6a7a44, k.seed, 0.08, P.grass);
  const stone = new Poly(), white = new Poly(), roof = new Poly(), dark = new Poly(), win = new Poly(), gold = new Poly();
  // the battered stone bases (curving out at the foot)
  stone.frustum(0, 0.1, 0, 2.95, 2.45, 2.35, 1.95, 0.95);
  for (const [x, z, w] of [[-1.55, -1.1, 1.3], [1.5, -1.15, 1.2], [0.1, -1.85, 1.1]] as const) stone.frustum(x, 0.1, z, w + 0.35, w + 0.25, w, w * 0.85, 0.6);
  // the main keep, its three lesser keeps and the linking wings
  const top = keep(white, roof, dark, win, 0, 1.05, 0, 2.2, 1.75, 5, 0.52, hi);
  keep(white, roof, dark, win, -1.55, 0.7, -1.1, 1.0, 0.85, 2, 0.4, hi);
  keep(white, roof, dark, win, 1.5, 0.7, -1.15, 0.95, 0.8, 2, 0.4, hi);
  keep(white, roof, dark, win, 0.1, 0.7, -1.85, 0.85, 0.7, 2, 0.38, hi);
  white.box(-0.85, 0.7, -0.75, 0.9, 0.35, 0.4);
  white.box(0.85, 0.7, -0.8, 0.9, 0.35, 0.4);
  sweptRoof(roof, -0.85, 1.05, -0.75, 0.9, 0.4, 0.12, 0.08, 0.03, false);
  sweptRoof(roof, 0.85, 1.05, -0.8, 0.9, 0.4, 0.12, 0.08, 0.03, false);
  // the shachi (golden fish) on the ridge
  for (const s of [-1, 1]) gold.box(s * 0.36, top - 0.05, 0, 0.06, 0.12, 0.06);
  // the white plastered walls round the bailey
  if (hi) for (const [x0, z0, x1, z1] of [[-2.7, 2.4, 2.7, 2.4], [-2.7, 2.4, -2.7, -0.4], [2.7, 2.4, 2.7, -0.4]]) {
    white.wall(x0, z0, x1, z1, -0.05, 0.3, 0.08);
    roof.wall(x0, z0, x1, z1, 0.25, 0.04, 0.16);
  }
  put(nb, stone, { c: 0x8c8880, m: 0, r: 0.92, d: 1 });
  put(nb, white, HIMEJI_WHITE);
  put(nb, roof, HIMEJI_ROOF);
  put(nb, dark, P.dark);
  put(nb, win, WIN);
  put(nb, gold, P.gold);
}

// ---------------------------------------------------------------------------------------------------------
// Taj Mahal (7 x 7, ~3.7 tall): the white marble tomb on its plinth (chamfered block, great iwans, the onion dome
// on its drum, four chhatris), the four minarets, the reflecting pool and its cypresses, the red sandstone mosque and
// its twin either side
// ---------------------------------------------------------------------------------------------------------

const TAJ_WHITE = { c: 0xf4f1ea, m: 0, r: 0.68, d: 3 as const };
const TAJ_SHADE = { c: 0xe8e3d8, m: 0, r: 0.7, d: 3 as const };
const RED_SANDSTONE = { c: 0xa65640, m: 0, r: 0.85, d: 1 as const };

function tajMahal(k: LCtx): void {
  const { nb, hi } = k;
  const cz = -0.75;
  const w = new Poly(), shade = new Poly(), dark = new Poly(), red = new Poly(), gold = new Poly(), water = new Poly(), trees = new Poly(), win = new Poly();
  w.box(0, -0.2, cz, 4.3, 0.55, 4.3); // the plinth
  shade.box(0, 0.3, cz, 4.36, 0.05, 4.36);
  // the tomb: a square with chamfered corners
  const S = 1.1, C = 0.38, H = 1.4, y0 = 0.35;
  const oct = (r: number, y: number): V3[] => {
    const pts: [number, number][] = [[-r + C, r], [r - C, r], [r, r - C], [r, -r + C], [r - C, -r], [-r + C, -r], [-r, -r + C], [-r, r - C]];
    // (already counter-clockwise seen from above: the walls face out)
    return pts.map(([x, z]) => [x, y, cz + z] as V3);
  };
  const lo = oct(S, y0), up = oct(S, y0 + H);
  w.loft(lo, up).cap(up, true);
  // the great iwans on the four faces (with their pishtaq frames rising above the roof line) and the small ones
  for (let f = 0; f < 4; f++) {
    const ry = [0, Math.PI / 2, Math.PI, -Math.PI / 2][f];
    const m = frame(0, y0, cz, ry).multiply(new THREE.Matrix4().makeTranslation(0, 0, S));
    for (const p of [shade, dark, win]) p.xf = m;
    shade.box(0, 0, 0.01, 0.92, H + 0.18, 0.06);
    iwan(dark, 0, 0.12, 0.56, 1.0, 0.045);
    pane(win, 0, 0.35, 0.16, 0.24, 0.05);
    for (const s of [-1, 1]) for (const yy of [0.12, 0.72]) iwan(dark, s * 0.68, yy, 0.18, 0.48, 0.005);
    for (const p of [shade, dark, win]) p.xf = null;
  }
  // the drum and the onion dome, its gilded finial; the four chhatris round it
  const dy = y0 + H;
  w.ngon(0, dy, cz, 0.6, 0.6, 0.45, hi ? 20 : 10); // the tall drum
  nb.add(latheGeo(onionProfile(0.86, 1.7, 0.6, hi ? 14 : 7), hi ? 24 : 12), TAJ_WHITE, { p: [0, dy + 0.45, cz] }); // the onion bulb
  gold.ngon(0, dy + 2.13, cz, 0.04, 0, 0.34, 6);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) chhatri(nb, w, TAJ_WHITE, sx * 0.75, dy, cz + sz * 0.75, 0.2, hi);
  // the minarets at the plinth's corners, three balconies each, a chhatri on top
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * 1.92, z = cz + sz * 1.92;
    w.ngon(x, 0.35, z, 0.14, 0.1, 2.55, hi ? 10 : 6);
    for (const yy of [1.0, 1.75, 2.5]) shade.ngon(x, 0.35 + yy - 0.04, z, 0.19, 0.19, 0.06, hi ? 10 : 6);
    chhatri(nb, w, TAJ_WHITE, x, 2.9, z, 0.13, hi);
  }
  // the reflecting pool down the garden axis, cypresses beside it
  water.box(0, -0.06, 2.55, 0.5, 0.09, 2.5);
  shade.box(0, -0.08, 2.55, 0.66, 0.09, 2.62);
  for (let i = 0; i < (hi ? 7 : 4); i++) for (const s of [-1, 1]) cypress(trees, s * 0.62, -0.05, 1.5 + i * (hi ? 0.32 : 0.56), 0.55, 0.11, hi ? 6 : 4);
  // the red sandstone mosque and its twin (the jawab) either side, white domes
  for (const s of [-1, 1]) {
    red.box(s * 3.05, -0.1, cz, 0.72, 0.7, 1.75);
    for (const dz of [-0.55, 0, 0.55]) nb.add(latheGeo(domeProfile(0.16, 0.2, hi ? 4 : 3), hi ? 10 : 6), TAJ_WHITE, { p: [s * 3.05, 0.6, cz + dz] });
    red.box(s * 3.05, -0.1, cz + 0.95, 0.1, 1.05, 0.1).box(s * 3.05, -0.1, cz - 0.95, 0.1, 1.05, 0.1);
  }
  put(nb, w, TAJ_WHITE);
  put(nb, shade, TAJ_SHADE);
  put(nb, dark, { c: 0xc2bbae, m: 0, r: 0.8, d: 3 }); // the iwans: shaded marble recesses, not dark holes
  put(nb, red, RED_SANDSTONE);
  put(nb, gold, P.gold);
  put(nb, water, { c: 0x5a9ccc, m: 0.1, r: 0.3, d: 3, snow: 0 });
  put(nb, trees, { c: 0x3c7034, m: 0, r: 0.9, d: 2 });
  put(nb, win, WIN);
}

// ---------------------------------------------------------------------------------------------------------
// Gateway of India (4 x 2, ~2.5 tall): the yellow basalt triumphal arch on the Bombay waterfront: the great central
// arch, its four corner turrets, the side halls with their smaller arches
// ---------------------------------------------------------------------------------------------------------

const BASALT_Y = { c: 0xc9ac7c, m: 0, r: 0.88, d: 1 as const };

function gatewayOfIndia(k: LCtx): void {
  const { nb, hi } = k;
  const st = new Poly(), shade = new Poly(), dark = new Poly(), lamps = new Poly();
  st.box(0, -0.3, 0, 3.95, 0.4, 1.9); // the quay platform
  const y0 = 0.1, W = 1.95, H = 2.45;
  // the central block: arched front and back walls, solid sides, the cornice
  const arch: ArchOpening = { x: 0, w: 1.0, spring: 1.5, top: 'round' };
  for (const z of [-0.45, 0.45]) nb.add(archWallGeo(W, H, 0.18, [arch], hi ? 10 : 5), BASALT_Y, { p: [0, y0, z] });
  for (const s of [-1, 1]) st.box(s * (W / 2 - 0.09), y0, 0, 0.18, H, 0.72);
  shade.box(0, y0 + H, 0, W + 0.1, 0.12, 1.1);
  // four tall corner turrets with jali and domes, the central dome behind the parapet
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * (W / 2 - 0.02), z = sz * 0.47;
    st.ngon(x, y0 + 1.9, z, 0.17, 0.15, 0.85, 8, Math.PI / 8);
    shade.ngon(x, y0 + 2.75, z, 0.2, 0.2, 0.06, 8, Math.PI / 8);
    nb.add(latheGeo(domeProfile(0.17, 0.22, hi ? 5 : 3), hi ? 10 : 6), BASALT_Y, { p: [x, y0 + 2.81, z] });
    if (hi) for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + Math.PI / 4; dark.box(x + Math.cos(a) * 0.165, y0 + 2.15, z - Math.sin(a) * 0.165, 0.05, 0.3, 0.05); }
  }
  nb.add(latheGeo(domeProfile(0.45, 0.38, hi ? 6 : 3), hi ? 16 : 8), BASALT_Y, { p: [0, y0 + H + 0.1, 0] });
  // the side halls, lower, each with its own pointed arch and small domed turrets
  for (const s of [-1, 1]) {
    const sa: ArchOpening = { x: 0, w: 0.4, spring: 0.72, top: 'pointed' };
    nb.add(archWallGeo(0.9, 1.45, 0.12, [sa], hi ? 6 : 3), BASALT_Y, { p: [s * 1.42, y0, 0.38] });
    st.box(s * 1.42, y0, -0.1, 0.9, 1.45, 0.85);
    shade.box(s * 1.42, y0 + 1.45, 0, 0.96, 0.08, 0.95);
    for (const dx of [-0.38, 0.38]) {
      st.ngon(s * 1.42 + dx, y0 + 1.35, 0.38, 0.09, 0.08, 0.45, 8);
      nb.add(latheGeo(domeProfile(0.1, 0.12, 2), 6), BASALT_Y, { p: [s * 1.42 + dx, y0 + 1.8, 0.38] });
    }
  }
  // jali panels flanking the great arch, the inscription band, lamps along the quay
  if (hi) for (const s of [-1, 1]) for (let i = 0; i < 3; i++) pane(dark, s * 0.68, y0 + 0.45 + i * 0.45, 0.14, 0.3, 0.545);
  shade.box(0, y0 + 2.05, 0.545, 1.2, 0.16, 0.02);
  for (let i = 0; i < 6; i++) lamps.box(-1.75 + i * 0.7, 0.1, 0.88, 0.05, 0.08, 0.05);
  put(nb, st, BASALT_Y);
  put(nb, shade, tint(BASALT_Y, 0xb09468));
  put(nb, dark, P.dark);
  put(nb, lamps, LAMP);
}

// ---------------------------------------------------------------------------------------------------------
// Angkor Wat (9 x 9, ~3.3 tall): the moat, the causeway and the outer gateway, the stepped galleries and the five
// lotus-bud towers of the quincunx
// ---------------------------------------------------------------------------------------------------------

const KHMER = { c: 0x8c8270, m: 0, r: 0.92, d: 1 as const };
const KHMER_MOSS = { c: 0x77755f, m: 0, r: 0.95, d: 1 as const };

/** A lotus-bud tower (prang) profile scaled by s: tiers swelling and narrowing to a point. */
function prang(s: number): [number, number][] {
  const p: [number, number][] = [[0.34, 0], [0.34, 0.28], [0.37, 0.32], [0.31, 0.36], [0.33, 0.56], [0.27, 0.62], [0.28, 0.8], [0.22, 0.86], [0.22, 1.02], [0.16, 1.1], [0.15, 1.26], [0.08, 1.38], [0.0, 1.55]];
  return p.map(([r, y]) => [r * s, y * s]);
}

function angkorWat(k: LCtx): void {
  const { nb, hi } = k;
  const st = new Poly(), moss = new Poly(), water = new Poly(), dark = new Poly(), roofs = new Poly();
  // the moat (a square ring of water) and the causeway across it
  for (const [x, z, w, d] of [[0, 4.1, 9, 0.8], [0, -4.1, 9, 0.8], [4.1, 0, 0.8, 7.4], [-4.1, 0, 0.8, 7.4]] as const) water.box(x, -0.12, z, w, 0.1, d);
  st.box(0, -0.1, 4.1, 0.45, 0.16, 0.9);
  // the outer enclosure wall and its gateway (three small towers)
  for (const [x0, z0, x1, z1] of [[-3.6, 3.6, -0.5, 3.6], [0.5, 3.6, 3.6, 3.6], [-3.6, -3.6, 3.6, -3.6], [-3.6, -3.6, -3.6, 3.6], [3.6, -3.6, 3.6, 3.6]]) moss.wall(x0, z0, x1, z1, -0.05, 0.32, 0.1);
  st.box(0, -0.05, 3.6, 1.3, 0.55, 0.36);
  for (const dx of [-0.42, 0, 0.42]) nb.add(latheGeo(prang(dx ? 0.42 : 0.55), hi ? 8 : 6), KHMER, { p: [dx, 0.5, 3.6] });
  // the causeway across the inner court to the temple
  st.box(0, -0.05, 2.2, 0.38, 0.12, 2.6);
  // the temple: three stepped gallery levels, galleries with dark colonnades, stairs on each side
  const levels: [number, number, number, number][] = [[4.6, 4.2, 0, 0.45], [3.4, 3.1, 0.45, 0.5], [2.2, 2.2, 0.95, 0.7]];
  for (const [w, d, y, h] of levels) {
    st.frustum(0, y - (y ? 0 : 0.1), -0.3, w, d, w - 0.12, d - 0.12, h + (y ? 0 : 0.1), true);
    roofs.box(0, y + h - 0.02, -0.3 + d / 2 - 0.12, w - 0.2, 0.1, 0.22);
    if (hi) for (let i = 0; i < Math.round(w / 0.2); i++) pane(dark, -w / 2 + 0.15 + i * 0.2, y + h * 0.55, 0.07, h * 0.45, -0.3 + d / 2 + 0.002);
  }
  for (let f = 0; f < 4; f++) {
    const ry = [0, Math.PI / 2, Math.PI, -Math.PI / 2][f];
    const m = frame(0, 0, -0.3, ry);
    st.xf = m;
    st.prismX([[2.4, 0], [1.08, 1.65], [1.08, 0]], -0.18, 0.18);
    st.xf = null;
  }
  // the five towers: the tall central one and four at the corners of the top level
  nb.add(latheGeo(prang(1.15), hi ? 12 : 8), KHMER, { p: [0, 1.65, -0.3] });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) nb.add(latheGeo(prang(0.78), hi ? 10 : 6), KHMER, { p: [sx * 0.88, 1.65, -0.3 + sz * 0.88] });
  put(nb, st, KHMER);
  put(nb, moss, KHMER_MOSS);
  put(nb, water, P.water);
  put(nb, dark, P.dark);
  put(nb, roofs, tint(KHMER, 0x6e665a));
}

// ---------------------------------------------------------------------------------------------------------
// Registan (9 x 7, ~2.7 tall): three madrasas framing a square: Ulugh Beg (west) and Sher-Dor (east) facing each
// other across it with their great tiled portals and minarets, Tilya-Kori (north) with its turquoise dome
// ---------------------------------------------------------------------------------------------------------

const BRICK_OCHRE = { c: 0xc8a26c, m: 0, r: 0.9, d: 1 as const };

function madrasa(nb: NB, ps: { brick: Poly; tile: Poly; dark: Poly; tq: Poly; win: Poly }, x: number, z: number, ry: number, w: number, d: number, hi: boolean, minarets: boolean): void {
  const m = frame(x, 0, z, ry);
  for (const p of Object.values(ps)) p.xf = m;
  const { brick, tile, dark, tq, win } = ps;
  // the courtyard building behind the portal (its front at local z = 0)
  brick.box(0, -0.15, -d / 2, w, 0.95, d);
  tile.box(0, 0.74, 0.004, w, 0.06, 0.02);
  for (let i = 0; i < Math.round(w / 0.42); i++) {
    const xx = -w / 2 + 0.25 + i * 0.42;
    if (Math.abs(xx) < 0.85) continue;
    for (const yy of [0.12, 0.45]) { iwan(dark, xx, yy, 0.18, 0.28, 0.006); if (yy > 0.2) pane(win, xx, yy + 0.1, 0.06, 0.1, 0.008); }
  }
  // the portal (pishtaq): a tall slab with a deep pointed arch, framed in blue tiles
  brick.box(0, -0.15, 0.1, 1.5, 1.95, 0.24);
  tile.box(0, 0.1, 0.225, 1.3, 1.5, 0.012);
  dark.box(0, 0.1, 0.235, 0.82, 1.15, 0.012);
  iwan(dark, 0, 0.1, 0.72, 1.15, 0.243);
  tile.box(0, 1.7, 0.23, 1.5, 0.08, 0.02);
  // minarets at the facade's corners
  if (minarets) for (const s of [-1, 1]) {
    brick.ngon(s * (w / 2 - 0.1), -0.15, 0.1, 0.16, 0.12, 2.8, hi ? 10 : 6);
    for (const yy of [0.5, 1.1, 1.7, 2.3]) tile.ngon(s * (w / 2 - 0.1), yy, 0.1, 0.15, 0.14, 0.12, hi ? 10 : 6);
    tq.ngon(s * (w / 2 - 0.1), 2.62, 0.1, 0.19, 0.19, 0.06, hi ? 10 : 6);
  }
  for (const p of Object.values(ps)) p.xf = null;
  void nb;
}

function registan(k: LCtx): void {
  const { nb, hi } = k;
  const ps = { brick: new Poly(), tile: new Poly(), dark: new Poly(), tq: new Poly(), win: new Poly() };
  // Tilya-Kori (north, facing the camera), Ulugh Beg (west, facing east), Sher-Dor (east, facing west)
  madrasa(nb, ps, 0, -2.15, 0, 5.8, 1.3, hi, false);
  madrasa(nb, ps, -3.3, 0.3, Math.PI / 2, 4.3, 1.1, hi, true);
  madrasa(nb, ps, 3.3, 0.3, -Math.PI / 2, 4.3, 1.1, hi, true);
  // the ribbed turquoise domes: Tilya-Kori's mosque, Sher-Dor's two
  const tq = lin(0x2aa8b4), tqDark = lin(0x1c7a86), blue = lin(0x2f6ab0);
  const ribbed = (u: number) => (Math.floor(u * 28) % 2 ? tq : tqDark);
  const dome = (x: number, z: number, y0: number, r0: number) => {
    ps.brick.ngon(x, y0, z, r0 * 0.85, r0 * 0.85, r0 * 0.55, hi ? 16 : 8);
    ps.tile.ngon(x, y0 + r0 * 0.4, z, r0 * 0.87, r0 * 0.87, r0 * 0.12, hi ? 16 : 8);
    colouredLathe(nb, onionProfile(r0, r0 * 1.25, r0 * 0.82, hi ? 9 : 5), hi ? 28 : 14, { c: 0xffffff, m: 0.1, r: 0.35, d: 3 }, ribbed, [x, y0 + r0 * 0.55, z]);
  };
  dome(-1.85, -2.85, 0.8, 0.62);
  dome(3.85, -1.15, 0.8, 0.42);
  dome(3.85, 1.75, 0.8, 0.42);
  // the square's paving (the map paints round it) and its lamps
  if (hi) for (const [x, z] of [[-1.2, 1.6], [1.2, 1.6], [-1.2, -0.6], [1.2, -0.6]]) { ps.dark.ngon(x, 0, z, 0.03, 0.03, 0.35, 4); }
  void blue;
  put(nb, ps.brick, BRICK_OCHRE);
  put(nb, ps.tile, P.tileBlue);
  put(nb, ps.dark, { c: 0x1e3a5a, m: 0.1, r: 0.4, d: 3 });
  put(nb, ps.tq, P.tileTurquoise);
  put(nb, ps.win, WIN);
}

export const ASIA: Partial<Record<string, LandmarkBuilder>> = {
  'great-wall': greatWall,
  'forbidden-city': forbiddenCity,
  'mount-fuji': mountFuji,
  'himeji-castle': himeji,
  'taj-mahal': tajMahal,
  'gateway-of-india': gatewayOfIndia,
  'angkor-wat': angkorWat,
  registan,
};

void stepped;
void rng;
