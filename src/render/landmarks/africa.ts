/**
 * Landmarks of Africa and the Middle East (front to +z = south, towards the default camera).
 */
import type { LandmarkBuilder, LCtx } from './common';
import { cloud, cloudSheet } from './common';
import type { NB, V3 } from '../models/builder';
import { ridged, WIN, LAMP, P, Poly, boulder, column, puff, fbm2, gable, heightField, latheGeo, lin, mixc, noise2, put, rng, tint, tree } from './kit';

// ---------------------------------------------------------------------------------------------------------
// Pyramids of Giza (10 x 8, ~2.2 tall): Khufu (back right), Khafre with its casing cap (middle, on higher rock),
// Menkaure and the queens' pyramids (front left), the Sphinx facing east by its temple and causeway
// ---------------------------------------------------------------------------------------------------------

// no detail texture on the faces (its joints read as planks on a slope): the courses give the texture
const KHUFU = { c: 0xd2b68c, m: 0, r: 0.94, d: 3 as const };
const CASING = { c: 0xeadfc4, m: 0, r: 0.8, d: 3 as const };
const SPHINX = { c: 0xc9a46e, m: 0, r: 0.95, d: 3 as const };

/**
 * A pyramid of weathered limestone: on 'high' many low courses whose ledges are a few centimetres deep and a little
 * uneven (each course's width jitters), so the faces read as stone rather than planks; on 'low' four smooth faces.
 * `cap` = share of the height at the top kept smooth (Khafre's surviving casing stones).
 */
function pyramid(core: Poly, cap: Poly | null, x: number, y0: number, z: number, base: number, h: number, courses: number, seed: number, capFrac = 0): void {
  const r = rng(seed);
  const smoothFrom = cap ? 1 - capFrac : 1;
  if (courses <= 1) {
    const top = cap ? base * capFrac : 0;
    core.frustum(x, y0, z, base, base, top, top, h * smoothFrom, true);
  } else {
    const ledge = Math.min(0.022, base * 0.007);
    for (let i = 0; i < courses; i++) {
      const t0 = i / courses, t1 = (i + 1) / courses;
      if (t0 >= smoothFrom - 1e-6) break;
      const j0 = i ? (r() - 0.5) * ledge * 1.5 : 0;
      const w0 = base * (1 - t0) + j0, w1 = base * (1 - t1);
      const last = i === courses - 1 || t1 >= smoothFrom - 1e-6;
      const wt = last && !cap ? 0 : w1 + ledge * 2;
      core.frustum(x + (r() - 0.5) * ledge, y0 + h * t0, z + (r() - 0.5) * ledge, w0, w0, wt, wt, h * (t1 - t0), true);
    }
  }
  if (cap && capFrac > 0) {
    const w0 = base * capFrac;
    cap.frustum(x, y0 + h * (1 - capFrac), z, w0 + 0.012, w0 + 0.012, 0, 0, h * capFrac);
  }
}

/**
 * The Great Sphinx: a crouching lion about 2.6 long with the pharaoh's head in the striped nemes headdress, facing +x
 * (east). Its head stands well above the back, its forelegs stretch out in front: what tells it from a block.
 */
function sphinx(nb: NB, p: Poly, x: number, y0: number, z: number, hi: boolean): void {
  const sides = hi ? 10 : 7;
  // the body: a long rounded barrel (a lathe lying along x), the haunches a little lower and wider
  const body: [number, number][] = [[0.2, -1.25], [0.3, -1.05], [0.31, -0.5], [0.3, 0.0], [0.33, 0.35], [0.3, 0.55], [0.18, 0.65]];
  nb.add(latheGeo(body, sides), SPHINX, { p: [x - 0.1, y0 + 0.3, z], r: [0, 0, -Math.PI / 2], s: [1, 1, 1.05] });
  p.box(x - 0.9, y0, z, 0.5, 0.28, 0.62); // haunches resting on the ground
  p.box(x - 0.1, y0, z, 1.5, 0.12, 0.55); // belly line
  for (const s of [-1, 1]) {
    p.box(x + 0.82, y0, z + s * 0.17, 0.85, 0.15, 0.15); // forelegs stretched forward
    p.box(x + 1.27, y0, z + s * 0.17, 0.12, 0.11, 0.19); // paws
    p.box(x - 0.95, y0, z + s * 0.3, 0.55, 0.17, 0.1); // hind legs folded along the flanks
  }
  // the head well above the back: the nemes headdress flaring to the shoulders, its lappets, the face
  const hx = x + 0.48, hy = y0 + 0.62;
  p.frustum(hx - 0.04, hy - 0.08, z, 0.34, 0.5, 0.26, 0.28, 0.34); // headdress
  p.frustum(hx - 0.02, hy + 0.26, z, 0.26, 0.28, 0.12, 0.14, 0.12); // its crown
  for (const s of [-1, 1]) p.box(hx + 0.12, hy - 0.22, z + s * 0.17, 0.09, 0.4, 0.09); // lappets
  p.box(hx + 0.18, hy + 0.02, z, 0.12, 0.26, 0.2); // face
  p.box(hx + 0.27, hy + 0.08, z, 0.06, 0.09, 0.06); // nose
  p.box(hx + 0.2, hy - 0.06, z, 0.1, 0.06, 0.12); // chin
}

function pyramids(k: LCtx): void {
  const { nb, hi } = k;
  const core = new Poly(), cap = new Poly(), stone = new Poly(), sph = new Poly();
  // no ground plate: the map paints the plateau's sand round them
  const C = hi ? 26 : 1;
  pyramid(core, null, 2.5, 0.0, -1.6, 3.4, 2.38, C, 11); // Khufu (height ~0.7 of the base: reads true from above)
  stone.box(-1.1, -0.1, -0.4, 3.45, 0.22, 3.45); // Khafre's bedrock step
  pyramid(core, cap, -1.1, 0.12, -0.4, 3.15, 2.25, C, 12, 0.24); // Khafre with its casing cap
  pyramid(core, null, -3.5, 0.0, 2.1, 1.55, 1.08, hi ? 18 : 1, 13); // Menkaure
  for (const qx of [-4.25, -3.55, -2.85]) pyramid(core, null, qx, 0.0, 3.4, 0.44, 0.3, hi ? 5 : 1, 14 + qx); // queens
  // the Sphinx facing east, its temple in front, the valley temple and the causeway up to Khafre
  sphinx(nb, sph, 2.35, 0.0, 2.7, hi);
  stone.box(4.15, -0.05, 2.7, 0.42, 0.3, 0.95); // Sphinx temple
  stone.box(4.05, -0.05, 3.62, 0.62, 0.32, 0.58); // valley temple
  stone.beam([3.75, 0.08, 3.4], [0.55, 0.16, -0.25], 0.16, 0.1); // causeway
  stone.box(0.25, 0.05, -0.4, 0.6, 0.2, 0.9); // mortuary temple
  if (hi) {
    // a few weathered mastaba tombs (irregular, low) east of Khufu and west of Khafre
    const r = rng(k.seed);
    for (const [mx, mz] of [[1.3, 0.75], [2.1, 0.9], [2.9, 0.7], [1.7, 1.35], [-3.6, -2.4], [-4.2, -1.7]]) {
      stone.boxR(mx + (r() - 0.5) * 0.1, -0.04, mz + (r() - 0.5) * 0.1, 0.32 + r() * 0.2, 0.08 + r() * 0.06, 0.2 + r() * 0.1, (r() - 0.5) * 0.08);
    }
  }
  put(nb, core, KHUFU);
  put(nb, cap, CASING);
  put(nb, stone, tint(P.limestone, 0xc4a87c));
  put(nb, sph, SPHINX);
}

// ---------------------------------------------------------------------------------------------------------
// shared bits
// ---------------------------------------------------------------------------------------------------------


/** Smooth step 0..1 of x between e0 and e1. */
const sstep = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

/** A window / recess quad facing +z (centre x, y) at depth z0. */
function pane(p: Poly, x: number, y: number, w: number, h: number, z0: number): void {
  p.quad([x - w / 2, y - h / 2, z0], [x + w / 2, y - h / 2, z0], [x + w / 2, y + h / 2, z0], [x - w / 2, y + h / 2, z0]);
}

// ---------------------------------------------------------------------------------------------------------
// Petra (6 x 3, ~3.7 tall): the Treasury (Al-Khazneh) carved into a banded rose-red cliff: the columned portico and
// pediment below, the round tholos with its urn between broken pediments above
// ---------------------------------------------------------------------------------------------------------

function petra(k: LCtx): void {
  const { nb, hi } = k;
  const bands = [lin(0xb4644a), lin(0xc98a62), lin(0x9a4e3c), lin(0xd4a07a), lin(0xa85a44)];
  // the Siq: a narrow winding slot through the rock on the east side, opening onto the Treasury's little square
  const siqZ = (x: number) => 0.95 + 0.16 * Math.sin(x * 3.4 + 0.5);
  const siqW = hi ? 0.1 : 0.17;
  heightField(nb, 6, 3, hi ? 72 : 26, hi ? 36 : 13, (x, z) => {
    const recess = Math.abs(x) < 1.45 ? -0.12 : 0;
    const front = 0.3 + recess + 0.3 * (Math.abs(x) / 3) ** 2 + 0.16 * (ridged(x * 1.3, 2.0, k.seed) - 0.5);
    const cliff = 1 - sstep(front, front + 0.14, z);
    const domes = 0.55 * ridged(x * 0.55, z * 0.9, k.seed + 3) + 0.3 * Math.sin(x * 1.7 + 1) * Math.cos(z * 2.1);
    const top = 3.55 + domes - 0.5 * (Math.abs(x) / 3) ** 1.5;
    // the rock walls round the square: the east wing (cut by the Siq) and a lower western spur
    const east = sstep(1.5, 1.8, x) * (1 - sstep(1.35, 1.5, z)) * sstep(0.2, 0.4, z) * (3.0 + 0.4 * (ridged(x, z * 2, k.seed + 5) - 0.5));
    const slot = x > 1.4 && Math.abs(z - siqZ(x)) < siqW ? 0 : 1;
    const west = sstep(-1.75, -2.05, x) * (1 - sstep(1.05, 1.3, z)) * sstep(0.2, 0.4, z) * 1.7;
    const ends = sstep(3.0, 2.4, Math.abs(x) + 0.3 * (noise2(z * 2, 5, k.seed) - 0.5));
    return -0.1 + (Math.max(top * cliff, east * slot, west) + 0.2) * ends;
  }, (x, z, y) => {
    const b = (y * 3.2 + fbm2(x * 0.9, y * 0.9, 3, 5) * 2.2 + x * 0.15) % bands.length;
    const i = Math.floor(b), t = b - i;
    const c = mixc(bands[i], bands[(i + 1) % bands.length], t * t);
    return x > 1.4 && Math.abs(z - siqZ(x)) < siqW + 0.06 ? mixc(c, lin(0x4a2a20), 0.5) : c; // the slot's shadowed walls
  }, P.sandstone, 0.2);
  // the facade (Al-Khazneh), carved into the cliff: two storeys, about 3.6 tall
  const f = new Poly(), dark = new Poly(), shade = new Poly(), lamp = new Poly();
  const fz = 0.3, sides = hi ? 10 : 6;
  shade.box(0, 0.0, fz - 0.24, 2.7, 3.55, 0.06); // the recess behind the columns (in shadow)
  f.box(0, -0.1, fz - 0.1, 2.7, 0.2, 0.55); // podium steps
  for (const x of [-1.08, -0.68, -0.24, 0.24, 0.68, 1.08]) column(f, x, 0.1, fz + 0.05, 0.085, 1.32, sides, true);
  f.box(0, 1.42, fz - 0.06, 2.65, 0.24, 0.34); // entablature
  if (hi) for (let i = 0; i < 12; i++) dark.box(-1.2 + i * 0.218, 1.5, fz + 0.115, 0.08, 0.08, 0.01); // frieze reliefs
  gable(f, 0, 1.66, fz - 0.06, 1.7, 0.34, 0.42, 0.03, true); // the lower pediment
  for (const x of [-0.85, 0, 0.85]) f.ngon(x, x ? 1.66 : 2.08, fz + 0.04, 0.05, 0.03, 0.14, 6); // acroteria
  dark.box(0, 0.1, fz - 0.2, 0.42, 0.9, 0.02); // the doorway
  for (const x of [-0.9, 0.9]) dark.box(x, 0.12, fz - 0.2, 0.26, 0.72, 0.02);
  // the upper storey: the tholos (columns round a drum, a frieze, the tent roof, the urn) between broken pediments
  f.box(0, 2.08, fz - 0.2, 2.65, 0.1, 0.4);
  f.ngon(0, 2.18, fz - 0.12, 0.34, 0.34, 1.1, sides);
  for (let i = 0; i < (hi ? 7 : 4); i++) { const a = Math.PI * (0.12 + (0.76 * i) / ((hi ? 7 : 4) - 1)); column(f, Math.cos(a) * 0.37, 2.18, fz - 0.12 + Math.sin(a) * 0.37, 0.04, 1.05, 6, hi); }
  f.ngon(0, 3.23, fz - 0.12, 0.42, 0.42, 0.1, sides);
  f.ngon(0, 3.33, fz - 0.12, 0.4, 0.0, 0.34, sides);
  f.ngon(0, 3.62, fz - 0.12, 0.06, 0.11, 0.14, 6); // the urn
  f.ngon(0, 3.76, fz - 0.12, 0.11, 0.03, 0.12, 6);
  for (const s of [-1, 1]) {
    f.box(s * 0.98, 2.18, fz - 0.16, 0.58, 1.12, 0.3);
    for (const dx of [-0.2, 0.2]) column(f, s * 0.98 + dx, 2.18, fz - 0.0, 0.045, 1.05, 6, hi);
    f.frustum(s * 0.98, 3.3, fz - 0.16, 0.58, 0.32, 0.24, 0.32, 0.26, true, false, -s * 0.17, 0); // broken pediment
    if (hi) dark.box(s * 0.98, 2.5, fz - 0.005, 0.2, 0.45, 0.01); // the relief panels between the columns
  }
  lamp.box(0, 0.12, fz - 0.19, 0.24, 0.5, 0.02);
  put(nb, f, { c: 0xe6ae86, m: 0, r: 0.9, d: 1 });
  put(nb, shade, { c: 0x9c5a44, m: 0, r: 0.92, d: 1 });
  put(nb, dark, { c: 0x2a1a14, m: 0, r: 0.95, d: 3 });
  put(nb, lamp, LAMP);
}

// ---------------------------------------------------------------------------------------------------------
// Persepolis (7 x 5, ~1.8 tall): the great terrace and its double stairway, the Gate of All Nations with its winged
// bulls, the slender columns of the Apadana with their bull capitals, the stone door frames of Darius's palace, the
// mountain behind
// ---------------------------------------------------------------------------------------------------------

const PERS = { c: 0xb4a98f, m: 0, r: 0.92, d: 1 as const };

/** The double-bull capital: two kneeling bull foreparts back to back (heads out along x) on an impost. */
function bullCapital(p: Poly, x: number, y: number, z: number, s = 1): void {
  p.box(x, y, z, 0.14 * s, 0.1 * s, 0.14 * s); // impost
  p.box(x, y + 0.1 * s, z, 0.52 * s, 0.14 * s, 0.16 * s); // the two bodies
  for (const d of [-1, 1]) {
    p.box(x + d * 0.3 * s, y + 0.16 * s, z, 0.12 * s, 0.14 * s, 0.12 * s); // heads
    p.box(x + d * 0.22 * s, y + 0.02 * s, z, 0.06 * s, 0.1 * s, 0.14 * s); // folded forelegs
  }
}

/** A lamassu (winged, human-headed bull) on the front of a gate pillar, facing +z. */
function lamassu(p: Poly, beard: Poly, x: number, y0: number, z: number): void {
  p.box(x, y0 + 0.28, z, 0.26, 0.52, 0.5); // body
  for (const s of [-1, 1]) {
    p.box(x + s * 0.08, y0, z + 0.18, 0.07, 0.3, 0.08); // forelegs
    p.box(x + s * 0.08, y0, z - 0.18, 0.07, 0.3, 0.08); // hind legs
    p.beam([x + s * 0.14, y0 + 0.75, z + 0.18], [x + s * 0.14, y0 + 0.6, z - 0.3], 0.03, 0.28); // the folded wings along the flanks
  }
  p.box(x, y0 + 0.72, z + 0.22, 0.2, 0.24, 0.18); // the human head
  p.ngon(x, y0 + 0.96, z + 0.2, 0.09, 0.1, 0.12, 6); // the crown
  beard.box(x, y0 + 0.6, z + 0.31, 0.14, 0.16, 0.04);
}

function persepolis(k: LCtx): void {
  const { nb, hi } = k;
  // the mountain behind (Kuh-e Rahmat)
  const rockA = lin(0x8a7a64), rockB = lin(0xa69476);
  heightField(nb, 7, 1.4, hi ? 36 : 14, hi ? 8 : 4, (x, z) => -0.1 + (1.3 + 0.5 * ridged(x * 0.6, z, k.seed)) * sstep(0.7, -0.4, z) * sstep(3.5, 2.8, Math.abs(x)),
    (x, z, y) => mixc(rockA, rockB, fbm2(x * 2, y * 2, 2, 3)), P.sandstone, 0.2, );
  const parts = nb.parts.get('body')!;
  parts[parts.length - 1].translate(0, 0, -1.8);
  const t = new Poly(), c = new Poly(), dark = new Poly(), beard = new Poly();
  const y0 = 0.42;
  t.box(0, -0.2, 0.0, 6.6, 0.62, 3.6); // the terrace
  // the grand double staircase: two flights rising away from each other to the terrace, parapets, steps
  for (const s of [-1, 1]) {
    t.prismZ(s < 0 ? [[-1.7, -0.05], [-0.3, -0.05], [-1.7, y0 + 0.02]] : [[0.3, -0.05], [1.7, -0.05], [1.7, y0 + 0.02]], 1.8, 2.45);
    t.beam([s * 0.3, 0.08, 2.47], [s * 1.7, y0 + 0.12, 2.47], 0.05, 0.12); // parapet
    if (hi) for (let i = 0; i < 9; i++) { const f = (i + 0.5) / 9; t.box(s * (0.3 + 1.4 * f), -0.05 + y0 * f, 2.12, 0.05, 0.03, 0.62); }
  }
  t.box(0, -0.05, 2.12, 0.6, 0.18, 0.66); // the landing between the flights
  dark.box(0, 0.05, 1.805, 6.4, 0.22, 0.01); // the relief band of the tribute bearers
  // the Gate of All Nations: two pairs of massive pillars, winged bulls on the front pair, two tall columns between
  const gx = -1.95, gz = 0.6;
  for (const dz of [-0.55, 0.45]) for (const dx of [-0.45, 0.45]) t.box(gx + dx, y0, gz + dz, 0.32, 1.55, 0.62);
  for (const dx of [-0.45, 0.45]) lamassu(t, beard, gx + dx, y0, gz + 0.95);
  for (const dz of [-0.05]) for (const dx of [-0.18, 0.18]) {
    c.ngon(gx + dx, y0, gz + dz, 0.075, 0.068, 1.72, hi ? 12 : 6);
    bullCapital(c, gx + dx, y0 + 1.72, gz + dz, 0.75);
  }
  // the Apadana: two rows of tall fluted columns still standing with their great bull capitals, the bases of the rest
  const ax = 1.35, az = -0.3;
  for (let i = 0; i < 6; i++) for (let j = 0; j < 5; j++) c.box(ax - 1.25 + i * 0.5, y0, az - 1.0 + j * 0.5, 0.16, 0.06, 0.16);
  const standing: [number, number][] = [[-1.25, -0.5], [-0.75, -0.5], [0.25, -0.5], [0.75, -0.5], [-1.25, 0.5], [-0.25, 0.5], [0.25, 0.5], [1.25, 0.5]];
  for (const [dx, dz] of standing) {
    c.ngon(ax + dx, y0 + 0.06, az + dz, 0.085, 0.075, 1.75, hi ? 12 : 6);
    bullCapital(c, ax + dx, y0 + 1.81, az + dz, 0.95);
  }
  for (const [dx, dz, h] of [[-0.25, -0.5, 0.5], [1.25, -0.5, 0.3], [0.75, 0.5, 0.65]] as const) c.ngon(ax + dx, y0 + 0.06, az + dz, 0.085, 0.085, h, 6); // broken columns
  // the palace of Darius: stone door frames
  for (const [x, z] of [[-1.15, -1.25], [-0.55, -1.25], [-1.15, -0.65]]) {
    for (const s of [-1, 1]) t.box(x + s * 0.15, y0, z, 0.1, 0.7, 0.18);
    t.box(x, y0 + 0.7, z, 0.42, 0.1, 0.2);
  }
  put(nb, t, PERS);
  put(nb, c, tint(PERS, 0xa29780));
  put(nb, dark, tint(PERS, 0x8a8068));
  put(nb, beard, tint(PERS, 0x7a705c));
}

// ---------------------------------------------------------------------------------------------------------
// Table Mountain (12 x 6, ~3.9 tall): the flat-topped sandstone massif with sheer cliffs, Devil's Peak to the left,
// Lion's Head to the right, fynbos on the slopes and the "tablecloth" of cloud spilling over its edge
// ---------------------------------------------------------------------------------------------------------

function tableMountain(k: LCtx): void {
  const { nb, hi } = k;
  const cliff = lin(0x8a7e6a), cliffDark = lin(0x6e6454), plateau = lin(0x737a5c), fynbos = lin(0x5f7040), forest = lin(0x3c5a30);
  heightField(nb, 12, 6, hi ? 84 : 32, hi ? 42 : 16, (x, z) => {
    // the table: a rounded rectangle with near-vertical cliffs
    // a long superellipse with gullies cut into its cliffs, not a box
    const xx = Math.abs(x + 0.2) / 3.45, zz = Math.abs(z + 0.5 - 0.15 * Math.sin(x * 0.7)) / 1.3;
    const d = Math.pow(xx ** 4 + zz ** 4, 0.25) - 1 + 0.16 * (ridged(x * 1.7, z * 1.7, k.seed + 9) - 0.5);
    const table = 3.5 * (1 - sstep(-0.04, 0.16, d)) + 0.12 * (fbm2(x * 0.8, z * 0.8, 3, k.seed) - 0.5);
    // talus slopes round its foot
    const ell = Math.hypot((x + 0.2) / 5.6, (z + 0.3) / 2.9);
    const tt = Math.max(0, 1 - ell);
    const talus = 1.8 * tt * tt * (3 - 2 * tt) ** 1.0 * Math.min(1, tt * 2.5) + 0.25 * (ridged(x * 0.8, z * 0.8, k.seed + 3) - 0.5) * tt * tt;
    const devil = 3.25 * Math.pow(Math.max(0, 1 - Math.hypot((x + 4.6) / 1.35, (z + 0.6) / 1.4)), 1.3);
    const lion = 2.5 * Math.pow(Math.max(0, 1 - Math.hypot((x - 4.75) / 1.0, (z - 0.7) / 0.95)), 1.25);
    const edge = sstep(6.0, 5.4, Math.abs(x)) * sstep(3.0, 2.5, Math.abs(z));
    return -0.1 + Math.max(table, talus, devil, lion) * edge;
  }, (x, z, y, slope) => {
    // the "tablecloth": cloud lying on the table and pouring a little way down the front cliffs
    const cloth = Math.max(0, Math.min(1, (y - 3.25) / 0.3 + (fbm2(x * 1.2, z * 1.2 + y, 3, 31) - 0.6) * 1.2)) * sstep(-1.0, -0.1, z) * (Math.abs(x + 0.2) < 3.0 ? 1 : 0);
    let c3: [number, number, number];
    if (slope > 2.2) c3 = mixc(cliff, cliffDark, (Math.sin(y * 9 + noise2(x, y, 3) * 2) * 0.5 + 0.5) * 0.7); // banded sandstone cliffs
    else if (y > 3.3) c3 = plateau;
    else if (y < 0.6) c3 = mixc(forest, fynbos, y / 0.6);
    else c3 = mixc(fynbos, cliff, Math.min(1, slope * 0.35));
    return mixc(c3, lin(0xdfe4e8), cloth * 0.5);
  }, { c: 0xffffff, m: 0, r: 0.9, d: 1 }, 0.25);
  // the tablecloth: a thin, patchy sheet of cloud hugging the flat top, pouring over the front edge in tongues
  cloudSheet(k, k.hi ? 30 : 16, k.hi ? 12 : 6, (u, v) => {
    const x = -3.2 + 6.1 * u, z = -1.55 + 2.05 * v;
    return [x, 3.56 + 0.1 * noise2(x * 1.3, z * 1.3, k.seed + 7), z];
  }, (u, v) => {
    const x = -3.2 + 6.1 * u, z = -1.55 + 2.05 * v;
    const edge = Math.min(1, u * 5, (1 - u) * 5, v * 3, (1 - v) * 8);
    return edge * (0.25 + 0.75 * sstep(0.3, 0.7, fbm2(x * 0.9, z * 0.9, 3, k.seed + 11))) * (0.55 + 0.45 * v);
  });
  const r = rng(k.seed + 3);
  for (const tx of [-2.2, -0.6, 1.0, 2.3]) {
    const x0 = tx + (r() - 0.5) * 0.4, w = 0.9 + r() * 0.5, drop = 0.5 + r() * 0.5;
    cloudSheet(k, 4, 6, (u, v) => {
      // a tongue: from the brink down the cliff face, widening a little as it falls
      const x = x0 + (u - 0.5) * w * (1 + 0.3 * v), y = 3.58 - drop * v, z = 0.42 + 0.14 * v + 0.05 * Math.sin(u * Math.PI);
      return [x, y, z];
    }, (u, v) => Math.sin(u * Math.PI) ** 1.5 * sstep(0, 0.3, v) * (1 - v) ** 1.3 * 0.8); // fading in over the brink and out below
  }
}

// ---------------------------------------------------------------------------------------------------------
// Kilimanjaro (12 x 12, ~5.6 tall): Kibo's broad cone with its flat crater rim and glaciers, jagged Mawenzi to the
// east, the Shira shoulder to the west; the climate bands down its flanks (ice, alpine desert, heath, rainforest,
// savanna)
// ---------------------------------------------------------------------------------------------------------

function kilimanjaro(k: LCtx): void {
  const { nb, hi } = k;
  const ice = lin(0xf2f5f8), desert = lin(0x8a7e6c), heath = lin(0x7e7a4c), forest = lin(0x2f5a2c), savanna = lin(0xa09a58), rock = lin(0x5e554c);
  heightField(nb, 12, 12, hi ? 80 : 30, hi ? 80 : 30, (x, z) => {
    const r = Math.hypot(x + 0.8, z + 0.3) / 5.7;
    let kibo = 5.6 * Math.pow(Math.max(0, 1 - r), 1.15);
    kibo = Math.min(kibo, 5.15 + 0.1 * noise2(x * 3, z * 3, k.seed));
    if (r < 0.07) kibo -= 0.18 * (1 - r / 0.07);
    const mr = Math.hypot(x - 3.3, z + 1.6) / 1.9;
    const mawenzi = 4.0 * Math.pow(Math.max(0, 1 - mr), 1.5) * (0.75 + 0.5 * ridged(x * 1.4, z * 1.4, k.seed + 7));
    const shira = 2.3 * Math.pow(Math.max(0, 1 - Math.hypot(x + 4.0, z - 0.8) / 2.4), 1.2);
    const edge = sstep(6.0, 5.2, Math.max(Math.abs(x), Math.abs(z)));
    return -0.1 + (Math.max(kibo, mawenzi, shira) + 0.12 * (fbm2(x * 0.6, z * 0.6, 3, k.seed) - 0.5)) * edge;
  }, (x, z, y, slope) => {
    const a = Math.atan2(z + 0.3, x + 0.8);
    if (y > 4.75 + 0.22 * Math.sin(a * 7) && Math.hypot(x + 0.8, z + 0.3) < 1.6) return ice; // Kibo's glaciers
    if (y > 3.6 && slope > 1.6) return mixc(rock, ice, 0.2); // Mawenzi's crags
    if (y > 2.7) return mixc(desert, rock, Math.min(1, slope * 0.4));
    if (y > 1.6) return mixc(heath, desert, (y - 1.6) / 1.1);
    if (y > 0.55) return mixc(forest, heath, Math.max(0, (y - 1.2) / 0.4));
    return mixc(savanna, forest, y / 0.55);
  }, { c: 0xffffff, m: 0, r: 0.9, d: 1 }, 0.25);
}

// ---------------------------------------------------------------------------------------------------------
// Victoria Falls (10 x 4, ~2.6 tall): the Zambezi pouring off a mile-wide basalt lip into the chasm, the white curtain
// broken by rock buttresses and islands, the mist cloud rising, rainforest on the far wall
// ---------------------------------------------------------------------------------------------------------

function victoriaFalls(k: LCtx): void {
  const { nb, hi } = k;
  const lipY = 1.95, floorY = 0.08;
  const lip = (x: number) => 0.1 + 0.13 * Math.sin(x * 1.25 + 0.4) + 0.05 * Math.sin(x * 3.1);
  const basalt = lin(0x4a3e36), basaltLt = lin(0x6a5a4e), forest = lin(0x2f5a2a), forest2 = lin(0x3e6e32), spray = lin(0xe8f0f2);
  // the land: the river plateau behind the lip, the chasm in front (its floor a little above the ground), the far wall
  const ground = (x: number, z: number) => {
    const sides = Math.min(1, Math.max(0, (5 - Math.abs(x)) / 0.9));
    const l = lip(x);
    let h: number;
    if (z < l) h = lipY * Math.min(1, Math.max(0, (z + 2.0) / 0.5) + 0.0); // the plateau (falling away at the back)
    else if (z < 1.35) h = floorY; // the chasm floor
    else if (z < 1.75) h = 0.62 * Math.min(1, (z - 1.35) / 0.12); // the far wall
    else h = 0.62 * Math.max(0, 1 - (z - 1.75) / 0.25);
    return -0.1 + h * sides + 0.06 * (fbm2(x * 1.5, z * 1.5, 3, k.seed) - 0.5) * sides;
  };
  heightField(nb, 10, 4, hi ? 100 : 30, hi ? 64 : 16, ground, (x, z, y, slope) => {
    if (slope > 1.6) return mixc(basalt, basaltLt, fbm2(x * 2, y * 3, 2, 4) * 0.6);
    if (z > lip(x) && z < 1.35) return mixc(lin(0x7aa6b0), spray, 0.6); // the foaming pool
    return mixc(forest, forest2, noise2(x * 2.4, z * 2.4, 7));
  }, { c: 0xffffff, m: 0, r: 0.9, d: 1 }, 0.25);
  // the Zambezi on the plateau, islands breaking it up along the lip
  const water = new Poly(), foam = new Poly(), foam2 = new Poly(), green = new Poly(), rockP = new Poly();
  const rr = rng(k.seed + 5);
  // the river on the plateau
  const nw = hi ? 40 : 14;
  for (let i = 0; i < nw; i++) {
    const x0 = -4.6 + (9.2 * i) / nw, x1 = -4.6 + (9.2 * (i + 1)) / nw;
    water.quad([x0, lipY - 0.02, lip(x0)], [x1, lipY - 0.02, lip(x1)], [x1, lipY - 0.02, -1.6], [x0, lipY - 0.02, -1.6]);
  }
  // the curtain: bright columns of falling water of uneven width, dark basalt showing between them
  let x = -4.6;
  while (x < 4.6) {
    const fall = 0.25 + rr() * (hi ? 0.55 : 0.75);
    const x1 = Math.min(4.6, x + fall);
    const z0 = lip(x), z1 = lip(x1), out = 0.22 + rr() * 0.2;
    const p = rr() < 0.65 ? foam : foam2;
    p.quad([x, floorY - 0.02, z0 + out], [x1, floorY - 0.02, z1 + out], [x1, lipY, z1 + 0.02], [x, lipY, z0 + 0.02]);
    foam.quad([x, lipY, z0 + 0.02], [x1, lipY, z1 + 0.02], [x1, lipY - 0.005, z1 - 0.22], [x, lipY - 0.005, z0 - 0.22]); // white water at the brink
    x = x1;
    if (x >= 4.6) break;
    const gap = 0.06 + rr() * 0.16; // dark rock between the falls
    const g1 = Math.min(4.6, x + gap);
    rockP.quad([x, floorY, lip(x) + 0.12], [g1, floorY, lip(g1) + 0.12], [g1, lipY + 0.01, lip(g1) + 0.03], [x, lipY + 0.01, lip(x) + 0.03]);
    x = g1;
  }
  const r = rng(k.seed);
  for (const x of [-3.1, -0.6, 2.4]) { // islands on the lip (Livingstone Island), with trees
    green.box(x, lipY - 0.06, lip(x) - 0.25, 0.7, 0.12, 0.55);
    tree(green, x, lipY + 0.06, lip(x) - 0.3, 0.42, 0.2);
  }
  for (let i = 0; i < (hi ? 30 : 8); i++) tree(green, -4.6 + r() * 9.2, 0.55, 1.62 + r() * 0.15, 0.38 + r() * 0.2, 0.16 + r() * 0.06); // rainforest on the far wall
  for (let i = 0; i < (hi ? 16 : 6); i++) tree(green, (r() < 0.5 ? -1 : 1) * (4.0 + r() * 0.6), lipY - 0.1, -1.5 + r() * 1.3, 0.4, 0.18);
  // the spray boiling up out of the chasm: a few flat, soft, see-through banks along it, a faint plume at the main falls
  for (const [mx, w] of [[-3.0, 2.2], [0.0, 2.6], [3.0, 2.2]] as const) cloud(k, 0.5, mx + (r() - 0.5) * 0.4, 0.6 + r() * 0.2, 0.85, 0.65, w, 0.42);
  cloud(k, 0.55, -0.5, 1.4, 0.85, 0.7, 1.8, 0.28);
  put(nb, water, { c: 0x3e6f82, m: 0.3, r: 0.1, d: 3, snow: 0 });
  put(nb, rockP, { c: 0x3a302a, m: 0, r: 0.9, d: 1 });
  put(nb, foam, { c: 0xf4f8fa, m: 0, r: 0.45, d: 3, snow: 0 });
  put(nb, foam2, { c: 0xd6e6ec, m: 0, r: 0.4, d: 3, snow: 0 });
  put(nb, green, { c: 0x2f5a2a, m: 0, r: 0.95, d: 2 });
}

export const AFRICA: Partial<Record<string, LandmarkBuilder>> = {
  pyramids,
  petra,
  persepolis,
  'table-mountain': tableMountain,
  kilimanjaro,
  'victoria-falls': victoriaFalls,
};

void WIN;
