/**
 * World Conquest civilian buildings, generated in code: a small grammar of walls, storeys, windows (lit at
 * night), doors, shopfronts, balconies, oriels, arcades, porches, stilts and roofs (gable, steep, hip, tiled, flat,
 * mansard, pagoda, thatch, tin, layered) that covers every `Culture` (styles.ts). Kinds: house, apartment, shop,
 * hall, tower, farm, warehouse, at the sim's footprints (src/sim/civilian.ts, cells = world units).
 *
 * `buildCivilian(style, kind, seed, detail)` returns one merged mesh (the body material of every structure, so
 * damage stages, fracture, collapse and rubble work unchanged). In battle the renderer uses `civilianTemplate`
 * through the model registry (src/render/scenery.ts): one template per (style, kind, variant, detail, facing),
 * shared by every building that looks the same.
 */
import * as THREE from 'three';
import type { Culture } from '../../conquest/world/types';
import { CIVILIAN_FOOTPRINTS, type CivilianKind } from '../../sim/civilian';
import { NB, makeTemplate, type Mat, type ModelTemplate, type Surface, type V3 } from '../models/builder';
import { bodyMaterial, BodyVariant, shadowDepthMaterial } from '../models/materials';
import { healthVariant } from '../models/anim';
import { STYLES, type RoofKind, type Style } from './styles';
import { LAMP, P, Poly, WIN, archWallGeo, gable, hip, hashStr, latheGeo, domeProfile, onionProfile, rng, sweptRoof, type ArchOpening, type Detail } from '../landmarks/kit';

export type { CivilianKind } from '../../sim/civilian';
export { STYLES } from './styles';

/** Distinct looks per (style, kind): a building's seed picks one of them. */
export const CIV_VARIANTS = 6;

const SCENERY_HEX = 0x8a8a89;

// ---------------------------------------------------------------------------------------------------------
// build context: one Poly per surface (merged into the body at the end), facade frames
// ---------------------------------------------------------------------------------------------------------

const matCache = new Map<string, Mat>();
function mat(c: number, d: 0 | 1 | 2 | 3 = 1, r = 0.88, m = 0): Mat {
  const k = `${c}|${d}|${r}|${m}`;
  let v = matCache.get(k);
  if (!v) matCache.set(k, (v = { c, m, r, d }));
  return v;
}

class Bag {
  private polys = new Map<Surface, Poly>();
  xf: THREE.Matrix4 | null = null;
  of(s: Surface): Poly {
    let p = this.polys.get(s);
    if (!p) this.polys.set(s, (p = new Poly()));
    p.xf = this.xf;
    return p;
  }
  flush(nb: NB): void {
    for (const [s, p] of this.polys) {
      p.xf = null;
      const g = p.geo();
      if (g) nb.add(g, s);
    }
    this.polys.clear();
  }
}

interface C {
  nb: NB;
  bag: Bag;
  hi: boolean;
  r: () => number;
  st: Style;
  style: Culture;
  wall: Mat;
  roof: Mat;
  trim: Mat;
  plinth: Mat;
}

const pick = <T>(r: () => number, a: readonly T[]): T => a[Math.floor(r() * a.length) % a.length];

/** A facade: origin at the middle of the wall's foot, local x along it (right seen from outside), z outward. */
interface Face { m: THREE.Matrix4; len: number; ry: number; o: V3 }

function faces(x: number, z: number, w: number, d: number): Face[] {
  const mk = (ry: number, o: V3, len: number): Face => ({ m: new THREE.Matrix4().makeRotationY(ry).setPosition(o[0], o[1], o[2]), len, ry, o });
  return [
    mk(0, [x, 0, z + d / 2], w), // front (+z)
    mk(Math.PI / 2, [x + w / 2, 0, z], d), // right (+x)
    mk(Math.PI, [x, 0, z - d / 2], w), // back (-z)
    mk(-Math.PI / 2, [x - w / 2, 0, z], d), // left (-x)
  ];
}

/** Use a facade's frame for the next features (null: world space). */
function at(c: C, f: Face | null): void {
  c.bag.xf = f ? f.m : null;
}

// ---------------------------------------------------------------------------------------------------------
// grammar: walls, windows, doors, balconies, roofs
// ---------------------------------------------------------------------------------------------------------

interface BlockOpts {
  /** wall surface (default the building's) */
  wall?: Mat;
  roof?: RoofKind;
  /** no door on the front */
  noDoor?: boolean;
  /** a shopfront across the ground floor of the front */
  shop?: boolean;
  /** ground floor arcade on the front */
  arcade?: boolean;
  /** raise the whole block (stilts) */
  lift?: number;
  /** windows on the sides and back too (default) */
  allSides?: boolean;
  /** balconies / oriels on upper floors (default from the style) */
  balconies?: boolean;
}

/** One rectangular building block centred on (x, z): returns the height of its wall top. */
function block(c: C, x: number, z: number, w: number, d: number, floors: number, o: BlockOpts = {}): number {
  const { st, hi } = c;
  const lift = o.lift ?? 0;
  const wall = o.wall ?? c.wall;
  const H = lift + 0.05 + floors * st.storey;
  at(c, null);
  if (lift > 0) {
    // stilts: posts and a floor platform
    const posts = c.bag.of(mat(0x4a3826, 2));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) posts.box(x + sx * (w / 2 - 0.05), -0.1, z + sz * (d / 2 - 0.05), 0.05, lift + 0.1, 0.05);
    if (hi) for (const sx of [-1, 1]) posts.box(x + sx * (w / 2 - 0.05), -0.1, z, 0.045, lift + 0.1, 0.045);
    c.bag.of(mat(0x5a4430, 2)).box(x, lift - 0.03, z, w + 0.04, 0.05, d + 0.04);
    // a ladder / steps up to the door
    const steps = c.bag.of(mat(0x5a4430, 2));
    for (let i = 0; i < (hi ? 4 : 2); i++) steps.box(x, (lift * i) / (hi ? 4 : 2), z + d / 2 + 0.1 - i * 0.02, 0.16, 0.025, 0.06);
  } else {
    c.bag.of(c.plinth).box(x, -0.14, z, w + 0.02, 0.19, d + 0.02);
  }
  c.bag.of(wall).box(x, lift + 0.03, z, w, H - lift - 0.03, d);
  if (hi) {
    // storey bands and the cornice
    const tr = c.bag.of(c.trim);
    for (let f = 1; f < floors; f++) tr.box(x, lift + 0.05 + f * st.storey - 0.012, z, w + 0.016, 0.022, d + 0.016);
  }
  if (st.timber !== undefined) {
    // timber framing: corner posts and a beam under the eaves, dark on the whitewash
    const t = c.bag.of(mat(st.timber, 2, 0.8));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) t.box(x + sx * (w / 2 - 0.012), lift, z + sz * (d / 2 - 0.012), 0.04, H - lift, 0.04);
    t.box(x, H - 0.07, z, w + 0.02, 0.05, d + 0.02);
    if (hi) for (const sx of [-1, 1]) t.box(x + sx * w * 0.18, lift, z + d / 2, 0.03, H - lift, 0.02);
  } else c.bag.of(c.trim).box(x, H - 0.035, z, w + 0.028, 0.04, d + 0.028);
  const fs = faces(x, z, w, d);
  for (let i = 0; i < 4; i++) {
    if (i > 0 && o.allSides === false) break;
    facade(c, fs[i], floors, lift, i === 0 ? o : { ...o, shop: false, arcade: false, noDoor: true });
  }
  at(c, null);
  return H;
}

/** Windows, door, shopfront, balconies of one facade. */
function facade(c: C, f: Face, floors: number, lift: number, o: BlockOpts): void {
  const { st, hi, r } = c;
  const L = f.len;
  const pitch = st.winW + st.winGap;
  const n = Math.max(1, Math.round((L - 0.08) / pitch));
  const doorAt = o.noDoor ? -1 : Math.floor(n / 2);
  const wantBalc = (o.balconies ?? !!(st.balconies || st.oriels)) && floors > 1;
  at(c, f);
  for (let j = 0; j < floors; j++) {
    const y0 = lift + 0.05 + j * st.storey;
    const yc = y0 + st.storey * 0.52;
    if (j === 0 && (o.shop || o.arcade)) {
      if (o.shop) shopfront(c, L, y0);
      continue;
    }
    for (let i = 0; i < n; i++) {
      const xc = -L / 2 + (L * (i + 0.5)) / n;
      if (j === 0 && i === doorAt) {
        door(c, xc, y0);
        continue;
      }
      win(c, xc, yc, st.winW, st.winH * st.storey / 0.36);
      if (j > 0 && wantBalc && hi && r() < 0.5) {
        if (st.oriels && r() < 0.6) oriel(c, xc, yc, st.winW, st.winH * st.storey / 0.36);
        else balcony(c, xc, y0 + 0.02, st.winW + 0.08);
      }
    }
  }
  if (o.arcade) {
    at(c, null);
    arcadeFront(c, f, L, lift + 0.05, st.storey);
  }
}

/** A window (lit at night for most) with its frame, sill, head and shutters. */
function win(c: C, x: number, y: number, w: number, h: number): void {
  const { hi, st, r } = c;
  const lit = r() < 0.66;
  const g = c.bag.of(lit ? WIN : P.glass);
  g.quad([x - w / 2, y - h / 2, 0.006], [x + w / 2, y - h / 2, 0.006], [x + w / 2, y + h / 2, 0.006], [x - w / 2, y + h / 2, 0.006]);
  if (st.arched) g.tri([x - w / 2, y + h / 2, 0.006], [x + w / 2, y + h / 2, 0.006], [x, y + h / 2 + w * 0.45, 0.006]);
  if (!hi) return;
  // sill (top and front faces), lintel and shutters as thin quads: a few triangles per window
  const t = c.bag.of(c.trim);
  const sy = y - h / 2 - 0.004, sx0 = x - w / 2 - 0.02, sx1 = x + w / 2 + 0.02;
  t.quad([sx0, sy, 0.03], [sx1, sy, 0.03], [sx1, sy, 0.002], [sx0, sy, 0.002]);
  t.quad([sx0, sy - 0.022, 0.03], [sx1, sy - 0.022, 0.03], [sx1, sy, 0.03], [sx0, sy, 0.03]);
  if (!st.arched) t.quad([sx0 + 0.006, y + h / 2, 0.008], [sx1 - 0.006, y + h / 2, 0.008], [sx1 - 0.006, y + h / 2 + 0.024, 0.008], [sx0 + 0.006, y + h / 2 + 0.024, 0.008]);
  if (st.shutters.length) {
    const s = c.bag.of(mat(pick(r, st.shutters), 2, 0.8));
    for (const [a, b] of [[x - w / 2 - w * 0.46, x - w / 2 - 0.004], [x + w / 2 + 0.004, x + w / 2 + w * 0.46]]) {
      s.quad([a, y - h / 2, 0.008], [b, y - h / 2, 0.008], [b, y + h / 2, 0.008], [a, y + h / 2, 0.008]);
    }
  }
}

function door(c: C, x: number, y0: number): void {
  const { st, hi } = c;
  const w = 0.13, h = st.storey * 0.72;
  c.bag.of(mat(st.door, 2, 0.7)).box(x, y0, 0.0, w, h, 0.016);
  if (hi) {
    c.bag.of(c.trim).box(x, y0 + h, 0.004, w + 0.05, 0.03, 0.02);
    c.bag.of(LAMP).box(x + w / 2 + 0.03, y0 + h - 0.04, 0.012, 0.022, 0.03, 0.02);
  }
}

/** Shop windows across the ground floor, a door and an awning. */
function shopfront(c: C, L: number, y0: number): void {
  const { st, hi, r } = c;
  const h = st.storey * 0.62;
  const panes = Math.max(2, Math.round(L / 0.42));
  const lit = c.bag.of(WIN);
  for (let i = 0; i < panes; i++) {
    const x0 = -L / 2 + 0.05 + ((L - 0.1) * i) / panes + 0.02, x1 = -L / 2 + 0.05 + ((L - 0.1) * (i + 1)) / panes - 0.02;
    lit.quad([x0, y0 + 0.05, 0.006], [x1, y0 + 0.05, 0.006], [x1, y0 + 0.05 + h, 0.006], [x0, y0 + 0.05 + h, 0.006]);
  }
  // awning: a sloped canvas strip (striped on high)
  const a0 = y0 + h + 0.1, ad = 0.16;
  const col = pick(r, st.awnings);
  const stripes = hi ? Math.max(3, Math.round(L / 0.12)) : 1;
  for (let i = 0; i < stripes; i++) {
    const x0 = -L / 2 + 0.03 + ((L - 0.06) * i) / stripes, x1 = -L / 2 + 0.03 + ((L - 0.06) * (i + 1)) / stripes;
    const s = c.bag.of(mat(i % 2 && hi ? 0xe8e2d4 : col, 2, 0.9));
    s.quad([x0, a0 - 0.1, ad], [x1, a0 - 0.1, ad], [x1, a0, 0.01], [x0, a0, 0.01]);
    s.quad([x1, a0 - 0.1, ad], [x0, a0 - 0.1, ad], [x0, a0 - 0.13, ad], [x1, a0 - 0.13, ad]);
    s.quad([x0, a0 - 0.1, ad], [x0, a0, 0.01], [x1, a0, 0.01], [x1, a0 - 0.1, ad]); // underside (seen from below)
  }
  // the sign board above
  if (hi) c.bag.of(mat(pick(r, st.awnings), 3, 0.6)).box(0, a0 + 0.02, 0.004, Math.min(L * 0.6, 0.9), 0.07, 0.016);
}

function balcony(c: C, x: number, y0: number, w: number): void {
  const p = c.bag.of(c.trim);
  p.box(x, y0, 0.05, w, 0.025, 0.1);
  const rail = c.bag.of(mat(0x2a2a2c, 0, 0.6, 0.4));
  rail.box(x, y0 + 0.025, 0.098, w, 0.08, 0.008);
  rail.box(x - w / 2 + 0.004, y0 + 0.025, 0.05, 0.008, 0.08, 0.1);
  rail.box(x + w / 2 - 0.004, y0 + 0.025, 0.05, 0.008, 0.08, 0.1);
}

/** Closed timber balcony (jharokha / mashrabiya) round a window. */
function oriel(c: C, x: number, y: number, w: number, h: number): void {
  const wood = c.bag.of(mat(0x6a4a2e, 2, 0.8));
  wood.box(x, y - h / 2 - 0.05, 0.045, w + 0.08, h + 0.12, 0.09);
  wood.frustum(x, y - h / 2 - 0.09, 0.045, w + 0.02, 0.05, w + 0.08, 0.09, 0.04, false); // corbel
  const g = c.bag.of(WIN);
  g.quad([x - w / 2, y - h / 2, 0.092], [x + w / 2, y - h / 2, 0.092], [x + w / 2, y + h / 2, 0.092], [x - w / 2, y + h / 2, 0.092]);
}

/** A ground-floor arcade standing in front of a facade (built in world space from the facade frame). */
function arcadeFront(c: C, f: Face, L: number, y0: number, h: number): void {
  const n = Math.max(2, Math.round(L / 0.36));
  const bay = L / n, ow = bay * 0.66;
  const holes: ArchOpening[] = [];
  for (let i = 0; i < n; i++) holes.push({ x: -L / 2 + bay * (i + 0.5), w: ow, spring: h * 0.88 - ow / 2, top: c.st.arched ? 'pointed' : 'round' });
  const g = archWallGeo(L, h * 0.98, 0.05, holes, c.hi ? 5 : 2);
  // pushed out 0.16 from the wall; its roof slab joins it to the facade
  const m = new THREE.Matrix4().makeTranslation(0, y0, 0.16).premultiply(f.m);
  g.applyMatrix4(m);
  c.nb.add(g, c.trim === c.wall ? c.plinth : c.wall);
  at(c, f);
  c.bag.of(c.trim).box(0, y0 + h * 0.98, 0.09, L, 0.04, 0.2);
  at(c, null);
}

// ---------------------------------------------------------------------------------------------------------
// roofs
// ---------------------------------------------------------------------------------------------------------

/** A sloped slab with thickness under four top corners (counter-clockwise seen from above / outside). */
function slab(p: Poly, a: V3, b: V3, cc: V3, d: V3, t: number): void {
  const dn = (q: V3): V3 => [q[0], q[1] - t, q[2]];
  p.quad(a, b, cc, d);
  p.quad(dn(d), dn(cc), dn(b), dn(a));
  p.quad(dn(a), dn(b), b, a);
  p.quad(dn(b), dn(cc), cc, b);
  p.quad(dn(cc), dn(d), d, cc);
  p.quad(dn(d), dn(a), a, d);
}

/** Roof of kind `kind` over a w x d block whose walls top out at y0. Returns the roof's top height. */
function roof(c: C, kind: RoofKind, x: number, y0: number, z: number, w: number, d: number): number {
  const { hi, r } = c;
  at(c, null);
  const rp = c.bag.of(c.roof);
  const span = Math.min(w, d);
  const alongZ = d > w * 1.05;
  const pitched = (h: number, over: number) => {
    // two slabs plus wall-coloured gable ends
    const L = (alongZ ? d : w) / 2 + over, S = span / 2 + over;
    const pt = (u: number, y: number, v: number): V3 => (alongZ ? [x + v, y, z + u] : [x + u, y, z + v]);
    const t = 0.03;
    if (!alongZ) {
      slab(rp, pt(-L, y0 - over * 0.6, S), pt(L, y0 - over * 0.6, S), pt(L, y0 + h, 0), pt(-L, y0 + h, 0), t);
      slab(rp, pt(L, y0 - over * 0.6, -S), pt(-L, y0 - over * 0.6, -S), pt(-L, y0 + h, 0), pt(L, y0 + h, 0), t);
    } else {
      slab(rp, pt(L, y0 - over * 0.6, S), pt(-L, y0 - over * 0.6, S), pt(-L, y0 + h, 0), pt(L, y0 + h, 0), t);
      slab(rp, pt(-L, y0 - over * 0.6, -S), pt(L, y0 - over * 0.6, -S), pt(L, y0 + h, 0), pt(-L, y0 + h, 0), t);
    }
    const gp = c.bag.of(c.wall);
    gable(gp, x, y0 - 0.01, z, w - 0.004, d - 0.004, h - 0.02, 0, alongZ);
    if (c.st.chimneys && r() < 0.8) {
      const cx = (r() - 0.5) * (alongZ ? span * 0.5 : w * 0.6), cz = (r() - 0.5) * (alongZ ? d * 0.6 : span * 0.5);
      c.bag.of(mat(0x7a4030, 1)).box(x + cx, y0 + h * 0.3, z + cz, 0.08, h * 0.85, 0.08);
    }
    return y0 + h;
  };
  switch (kind) {
    case 'gable': return pitched(span * 0.36, 0.05);
    case 'steep': return pitched(span * 0.62, 0.05);
    case 'tin': return pitched(span * 0.2, 0.06);
    case 'thatch': {
      const h = span * 0.55;
      hip(c.bag.of(c.roof), x, y0 - 0.06, z, w, d, h + 0.06, 0.12);
      return y0 + h;
    }
    case 'hip': {
      const h = span * 0.32;
      hip(rp, x, y0, z, w, d, h, 0.06);
      return y0 + h;
    }
    case 'tiled': {
      const h = span * 0.22;
      hip(rp, x, y0, z, w, d, h, 0.06);
      return y0 + h;
    }
    case 'mansard': {
      const h = 0.24;
      rp.frustum(x, y0, z, w + 0.03, d + 0.03, w - 0.2, d - 0.2, h, true);
      if (hi) {
        // dormers on the front and back slopes
        const n = Math.max(1, Math.round(w / 0.36));
        for (let i = 0; i < n; i++) {
          const dx = -w / 2 + (w * (i + 0.5)) / n;
          for (const s of [1, -1]) {
            const dz = s * (d / 2 - 0.07);
            c.bag.of(c.trim).box(x + dx, y0 + 0.05, z + dz, 0.11, 0.13, 0.08);
            c.bag.of(r() < 0.6 ? WIN : P.glass).quad(
              [x + dx - s * 0.035, y0 + 0.07, z + dz + s * 0.041], [x + dx + s * 0.035, y0 + 0.07, z + dz + s * 0.041],
              [x + dx + s * 0.035, y0 + 0.16, z + dz + s * 0.041], [x + dx - s * 0.035, y0 + 0.16, z + dz + s * 0.041]);
          }
        }
      }
      return y0 + h;
    }
    case 'pagoda': {
      const h = span * 0.34 + 0.08;
      sweptRoof(rp, x, y0, z, w, d, h, 0.16, 0.13, hi);
      // the ridge and its upturned end ornaments
      const along = w >= d;
      const rl = Math.max(0.06, Math.abs(w - d) * 0.42);
      if (along) rp.box(x, y0 + h - 0.01, z, rl * 2 + 0.08, 0.05, 0.06); else rp.box(x, y0 + h - 0.01, z, 0.06, 0.05, rl * 2 + 0.08);
      for (const s of [-1, 1]) {
        const ox = along ? s * (rl + 0.04) : 0, oz = along ? 0 : s * (rl + 0.04);
        rp.beam([x + ox, y0 + h, z + oz], [x + ox * 1.25 + (along ? s * 0.03 : 0), y0 + h + 0.11, z + oz * 1.25 + (along ? 0 : s * 0.03)], 0.045, 0.04);
      }
      return y0 + h + 0.08;
    }
    case 'layered': {
      // steep gable with a second, smaller tier above: South-East Asian layered roofs
      const top = pitched(span * 0.7, 0.1);
      const h2 = span * 0.42;
      const L = (alongZ ? d : w) * 0.32;
      const pt = (u: number, y: number, v: number): V3 => (alongZ ? [x + v, y, z + u] : [x + u, y, z + v]);
      const S = span * 0.3;
      const yb = y0 + span * 0.36;
      if (!alongZ) {
        slab(rp, pt(-L, yb, S), pt(L, yb, S), pt(L, yb + h2, 0), pt(-L, yb + h2, 0), 0.03);
        slab(rp, pt(L, yb, -S), pt(-L, yb, -S), pt(-L, yb + h2, 0), pt(L, yb + h2, 0), 0.03);
      } else {
        slab(rp, pt(L, yb, S), pt(-L, yb, S), pt(-L, yb + h2, 0), pt(L, yb + h2, 0), 0.03);
        slab(rp, pt(-L, yb, -S), pt(L, yb, -S), pt(L, yb + h2, 0), pt(-L, yb + h2, 0), 0.03);
      }
      return Math.max(top, yb + h2);
    }
    case 'flat':
    default: {
      // roof deck and a parapet; clutter on top
      c.bag.of(mat(0x5a5650, 1, 0.9)).box(x, y0 - 0.02, z, w - 0.04, 0.03, d - 0.04);
      const pp = c.bag.of(c.trim);
      const t = 0.035, ph = 0.07;
      pp.box(x, y0, z + d / 2 - t / 2, w, ph, t);
      pp.box(x, y0, z - d / 2 + t / 2, w, ph, t);
      pp.box(x + w / 2 - t / 2, y0, z, t, ph, d - 2 * t);
      pp.box(x - w / 2 + t / 2, y0, z, t, ph, d - 2 * t);
      if (hi && r() < 0.7) {
        // a stair hut or a water tank
        if (r() < 0.5) c.bag.of(c.wall).box(x + (r() - 0.5) * w * 0.4, y0, z - d * 0.15, 0.2, 0.16, 0.2);
        else c.bag.of(mat(0x8a8e92, 0, 0.5, 0.5)).ngon(x + (r() - 0.5) * w * 0.4, y0 + 0.02, z + (r() - 0.5) * d * 0.4, 0.07, 0.07, 0.12, 8);
      }
      return y0 + ph;
    }
  }
}

/** Dome (round or onion) with a drum, for civic buildings. */
function domeOn(c: C, x: number, y0: number, z: number, r0: number, onion: boolean, surf: Surface): number {
  c.bag.of(c.wall).ngon(x, y0, z, r0 * 0.9, r0 * 0.9, r0 * 0.5, c.hi ? 12 : 8);
  const h = onion ? r0 * 1.7 : r0 * 0.95;
  const prof = onion ? onionProfile(r0, h, r0 * 0.7, c.hi ? 9 : 5) : domeProfile(r0, h, c.hi ? 6 : 3);
  c.nb.add(latheGeo(prof, c.hi ? 14 : 8), surf, { p: [x, y0 + r0 * 0.5, z] });
  return y0 + r0 * 0.5 + h;
}

// ---------------------------------------------------------------------------------------------------------
// kinds
// ---------------------------------------------------------------------------------------------------------

type KindBuilder = (c: C) => void;

/** How each style bounds a house lot (high detail): picket fence + hedges, a plaster courtyard wall, reeds... */
const LOT: Record<Culture, 'picket' | 'hedge' | 'wall' | 'reed' | 'wood' | 'bamboo'> = {
  western: 'hedge', nordic: 'picket', slavic: 'wood', mediterranean: 'wall', 'middle-eastern': 'wall', african: 'reed',
  'south-asian': 'wall', 'east-asian': 'wall', 'southeast-asian': 'bamboo', 'north-american': 'picket', 'latin-american': 'wall',
  oceanian: 'picket',
};

/** A house lot (high detail): its boundary (fence / hedge / wall, a gap for the gate), a garden bed and a tree. */
function lot(c: C, half: number, frontGap: number): void {
  const { r, st } = c;
  const kind = LOT[c.style] ?? 'hedge';
  const surf = kind === 'hedge' ? mat(0x3e5a2a, 2, 0.95) : kind === 'wall' ? (c.style === 'east-asian' ? mat(0x8e8a84, 1) : c.wall) : kind === 'picket' ? mat(0xe8e4dc, 2, 0.8)
    : kind === 'reed' ? mat(0x9a8656, 2, 0.95) : kind === 'bamboo' ? mat(0x8a8a4a, 2, 0.9) : mat(0x6a5032, 2, 0.9);
  const hgt = kind === 'wall' ? 0.2 : kind === 'hedge' ? 0.12 : 0.1;
  const t = kind === 'hedge' ? 0.07 : 0.025;
  const p = c.bag.of(surf);
  const h = half;
  // sides and back
  p.wall(-h, -h, h, -h, -0.03, hgt, t);
  p.wall(-h, -h, -h, h, -0.03, hgt, t);
  p.wall(h, -h, h, h, -0.03, hgt, t);
  // front, with the gate gap in the middle
  p.wall(-h, h, -frontGap, h, -0.03, hgt, t);
  p.wall(frontGap, h, h, h, -0.03, hgt, t);
  if (kind === 'wall' && st.courtyard) {
    // a compound: tiled coping on the walls and a roofed gate (siheyuan / riad / hacienda)
    const cap = c.bag.of(c.roof);
    for (const [ax, az, bx, bz] of [[-h, -h, h, -h], [-h, -h, -h, h], [h, -h, h, h], [-h, h, -frontGap, h], [frontGap, h, h, h]]) cap.wall(ax, az, bx, bz, hgt - 0.03, 0.035, t + 0.05);
    cap.box(0, hgt + 0.04, h, frontGap * 2 + 0.12, 0.04, 0.14);
    c.bag.of(c.trim).box(-frontGap - 0.01, -0.03, h, 0.03, hgt + 0.07, 0.03).box(frontGap + 0.01, -0.03, h, 0.03, hgt + 0.07, 0.03);
  }
  if (kind === 'picket') {
    // posts along the front
    for (let i = 0; i <= 6; i++) { const x = -h + (2 * h * i) / 6; if (Math.abs(x) > frontGap) p.box(x, -0.03, h, 0.025, hgt + 0.04, 0.025); }
  }
  // a garden: a dark bed along one side and a small tree in a back corner
  const side = r() < 0.5 ? -1 : 1;
  c.bag.of(mat(r() < 0.5 ? 0x4a5a2a : 0x5a4a32, 2, 0.98)).box(side * (h - 0.09), -0.03, h - 0.12, 0.1, 0.05, 0.16);
  const tr = c.bag.of(mat(st.wallD === 2 ? 0x3e5a2a : 0x46602e, 2, 0.95));
  tr.ngon(side * (h - 0.09), -0.03, -h + 0.09, 0.02, 0.018, 0.16, 4);
  tr.ngon(side * (h - 0.09), 0.12, -h + 0.09, 0.09, 0, 0.26, 6);
}

/** A pavement strip in front of a building (shops, apartment blocks, halls). */
function pavement(c: C, w: number, z0: number, z1: number): void {
  c.bag.of(mat(0x9a968e, 1, 0.92)).box(0, -0.06, (z0 + z1) / 2, w, 0.08, z1 - z0);
}

const floorsIn = (r: () => number, [a, b]: [number, number]) => a + Math.floor(r() * (b - a + 1));

const house: KindBuilder = (c) => {
  const { st, r, hi } = c;
  // round huts (Africa)
  if (st.huts && r() < st.huts) {
    const n = r() < 0.5 ? 1 : 2;
    for (let i = 0; i < n; i++) {
      const R = n === 1 ? 0.34 : 0.22;
      const x = n === 1 ? 0 : (i ? 0.2 : -0.18), z = n === 1 ? 0 : (i ? -0.18 : 0.16);
      c.bag.of(c.wall).ngon(x, -0.1, z, R, R * 0.97, 0.38, hi ? 10 : 7);
      c.bag.of(mat(0x9c8350, 2, 0.98)).ngon(x, 0.24, z, R + 0.1, 0, R * 1.2, hi ? 10 : 7);
      c.bag.of(mat(st.door, 2)).box(x, 0, z + R * 0.96, 0.1, 0.2, 0.02);
    }
    if (hi) c.bag.of(mat(0x6a5032, 2)).box(0, 0, 0.4, 0.8, 0.07, 0.02); // a low fence
    return;
  }
  const floors = floorsIn(r, st.houseFloors);
  const w = 0.62 + r() * 0.1, d = 0.54 + r() * 0.1;
  const lift = st.stilts ? 0.26 : 0;
  const zc = st.porch && !lift ? -0.08 : -0.03;
  if (hi) lot(c, 0.47, 0.09);
  const top = block(c, 0, zc, w, d, floors, { lift });
  roof(c, pick(r, st.roofs), 0, top, zc, w, d);
  if (st.porch) {
    // a verandah across the front on posts
    const y = lift + 0.05 + st.storey * 0.85;
    const pz = zc + d / 2 + 0.11;
    c.bag.of(c.roof).frustum(0, y, pz, w + 0.06, 0.22, w + 0.06, 0.2, 0.025);
    const posts = c.bag.of(c.trim);
    for (const px of hi ? [-1, -0.33, 0.33, 1] : [-1, 1]) posts.box(px * (w / 2), lift, pz + 0.08, 0.025, y - lift, 0.025);
    c.bag.of(mat(0x7a6650, 2)).box(0, lift, pz, w + 0.04, 0.03, 0.22);
  }
};

const apartment: KindBuilder = (c) => {
  const { st, r } = c;
  const floors = floorsIn(r, st.aptFloors);
  const kind = pick(r, st.roofs);
  if (r() < 0.4) {
    // L-shaped: a main wing and a lower back wing
    const top = block(c, -0.1, 0.25, 1.6, 0.85, floors, { balconies: true });
    roof(c, kind, -0.1, top, 0.25, 1.6, 0.85);
    const t2 = block(c, 0.45, -0.45, 0.85, 0.7, Math.max(2, floors - 1), { noDoor: true });
    roof(c, kind, 0.45, t2, -0.45, 0.85, 0.7);
  } else {
    const w = 1.62 + r() * 0.15, d = 1.25 + r() * 0.3;
    if (c.hi) pavement(c, 1.96, d / 2, 0.98);
    const top = block(c, 0, 0, w, d, floors, { balconies: true, shop: r() < 0.35 });
    roof(c, kind === 'steep' || kind === 'thatch' ? 'gable' : kind, 0, top, 0, w, d);
  }
};

const shop: KindBuilder = (c) => {
  const { st, r } = c;
  const two = r() < 0.5;
  if (c.hi) pavement(c, 1.96, 0.36, 0.49);
  if (two) {
    // two shops side by side, different colours and heights
    for (const s of [-1, 1]) {
      const wall = mat(pick(r, st.walls), st.wallD);
      const floors = 1 + Math.floor(r() * 2);
      const top = block(c, s * 0.45, 0, 0.86, 0.72, floors, { wall, shop: true, allSides: true });
      roof(c, pick(r, st.roofs), s * 0.45, top, 0, 0.86, 0.72);
    }
  } else {
    const floors = 1 + Math.floor(r() * 2);
    const top = block(c, 0, 0, 1.78, 0.74, floors, { shop: true, arcade: !!st.arcades && r() < 0.4 && floors > 1 });
    roof(c, pick(r, st.roofs), 0, top, 0, 1.78, 0.74);
  }
};

const hall: KindBuilder = (c) => {
  const { st, r, hi } = c;
  const floors = 2 + (r() < 0.4 ? 1 : 0);
  const w = 2.5, d = 1.45;
  const top = block(c, 0, -0.1, w, d, floors, { arcade: !!st.arcades && r() < 0.6, noDoor: false });
  const rt = roof(c, st.hallRoof, 0, top, -0.1, w, d);
  // a portico with columns and a pediment on the classical styles
  if (!st.arcades && st.hallRoof !== 'pagoda' && st.hallRoof !== 'layered') {
    const cols = c.bag.of(c.trim);
    const n = hi ? 6 : 4;
    const ph = top - 0.06;
    for (let i = 0; i < n; i++) cols.ngon(-0.5 + i / (n - 1), 0.04, 0.72, 0.035, 0.032, ph, hi ? 8 : 5);
    cols.box(0, ph, 0.68, 1.16, 0.06, 0.18);
    gable(c.bag.of(c.trim), 0, ph + 0.06, 0.68, 1.16, 0.18, 0.18, 0.02, true);
    c.bag.of(c.plinth).box(0, -0.1, 0.68, 1.22, 0.14, 0.22);
  }
  if (st.dome) domeOn(c, 0, rt - 0.02, -0.1, 0.32, st.dome === 'onion', st.dome === 'onion' ? P.gold : mat(0x6f8c8a, 3, 0.5));
  if (st.chhatris) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) chhatri(c, sx * (w / 2 - 0.12), top, -0.1 + sz * (d / 2 - 0.12), 0.11);
  }
  // a clock / flag turret on the pitched roofs of the north
  if (st.hallRoof === 'steep' || st.hallRoof === 'mansard') {
    c.bag.of(c.wall).box(0, rt - 0.1, -0.1, 0.24, 0.32, 0.24);
    c.bag.of(c.roof).frustum(0, rt + 0.22, -0.1, 0.3, 0.3, 0, 0, 0.36);
    c.bag.of(WIN).quad([-0.06, rt + 0.03, 0.021], [0.06, rt + 0.03, 0.021], [0.06, rt + 0.15, 0.021], [-0.06, rt + 0.15, 0.021]);
  }
};

/** A domed kiosk on four posts (chhatri). */
function chhatri(c: C, x: number, y0: number, z: number, r0: number): void {
  const p = c.bag.of(c.trim);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.box(x + sx * r0 * 0.7, y0, z + sz * r0 * 0.7, 0.02, r0 * 1.3, 0.02);
  p.box(x, y0 + r0 * 1.3, z, r0 * 1.9, 0.025, r0 * 1.9);
  c.nb.add(latheGeo(domeProfile(r0 * 0.85, r0 * 0.8, c.hi ? 4 : 2), c.hi ? 10 : 6), c.trim, { p: [x, y0 + r0 * 1.32, z] });
}

const tower: KindBuilder = (c) => {
  const { st, r, hi } = c;
  const seg = hi ? 12 : 8;
  switch (st.tower) {
    case 'water-tower':
    case 'tank-stand': {
      // a tank on a braced stand
      const steel = st.tower === 'water-tower' ? mat(0x9aa0a6, 0, 0.5, 0.55) : mat(0x6a5a46, 2, 0.85);
      const legH = st.tower === 'water-tower' ? 1.25 : 0.7;
      const p = c.bag.of(steel);
      const a = 0.28;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.beam([sx * a, -0.05, sz * a], [sx * a * 0.75, legH, sz * a * 0.75], 0.04);
      const levels = hi ? 3 : 1;
      for (let l = 0; l < levels; l++) {
        const y = 0.15 + ((legH - 0.2) * l) / levels, y1 = 0.15 + ((legH - 0.2) * (l + 1)) / levels;
        const k0 = a * (1 - (0.25 * y) / legH), k1 = a * (1 - (0.25 * y1) / legH);
        for (const [x0, z0, x1, z1] of [[-k0, k0, k1, k1], [k0, k0, -k1, k1], [-k0, -k0, k1, -k1], [k0, -k0, -k1, -k1]]) p.beam([x0, y, z0], [x1, y1, z1], 0.015);
      }
      const tank = st.tower === 'water-tower' ? mat(0xb8bcc0, 0, 0.45, 0.6) : P.tin;
      const tr = st.tower === 'water-tower' ? 0.34 : 0.3;
      const th = st.tower === 'water-tower' ? 0.42 : 0.36;
      c.bag.of(tank).ngon(0, legH, 0, tr, tr, th, seg);
      c.bag.of(st.tower === 'water-tower' ? mat(0x6a6e72, 0, 0.5, 0.5) : P.tinRust).ngon(0, legH + th, 0, tr + 0.02, 0, 0.18, seg);
      if (hi) c.bag.of(LAMP).box(0, legH + th + 0.18, 0, 0.03, 0.03, 0.03);
      break;
    }
    case 'clock-tower': {
      const h = 1.55 + r() * 0.3, s = 0.46;
      c.bag.of(c.plinth).box(0, -0.12, 0, s + 0.08, 0.2, s + 0.08);
      c.bag.of(c.wall).box(0, 0.05, 0, s, h, s);
      c.bag.of(c.trim).box(0, h - 0.02, 0, s + 0.06, 0.06, s + 0.06);
      // clock faces (lit at night) and a belfry stage
      for (const f of faces(0, 0, s, s)) {
        c.bag.xf = f.m;
        const q = c.bag.of(WIN);
        q.quad([-0.11, h - 0.36, 0.007], [0.11, h - 0.36, 0.007], [0.11, h - 0.14, 0.007], [-0.11, h - 0.14, 0.007]);
        if (hi) for (let i = 0; i < 3; i++) win(c, -0.12 + i * 0.12, h * 0.45 - (i % 2) * 0.1, 0.06, 0.12);
      }
      c.bag.xf = null;
      if (st.chhatris) chhatri(c, 0, h + 0.04, 0, 0.2);
      else {
        c.bag.of(c.trim).box(0, h + 0.04, 0, s - 0.06, 0.26, s - 0.06);
        c.bag.of(c.roof).frustum(0, h + 0.3, 0, s + 0.04, s + 0.04, 0, 0, st.roofs.includes('tiled') ? 0.28 : 0.6);
      }
      break;
    }
    case 'fire-tower': {
      const h = 1.5;
      c.bag.of(c.plinth).box(0, -0.12, 0, 0.62, 0.2, 0.62);
      c.bag.of(c.wall).ngon(0, 0.05, 0, 0.27, 0.22, h, 8, Math.PI / 8);
      // lookout gallery with a railing, and the cap
      c.bag.of(c.trim).ngon(0, h, 0, 0.32, 0.32, 0.04, 8, Math.PI / 8);
      c.bag.of(mat(0x5a4a3a, 2)).ngon(0, h + 0.04, 0, 0.18, 0.18, 0.2, 8, Math.PI / 8);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        c.bag.of(WIN).quad(
          [Math.cos(a - 0.3) * 0.185, h + 0.08, -Math.sin(a - 0.3) * 0.185], [Math.cos(a + 0.3) * 0.185, h + 0.08, -Math.sin(a + 0.3) * 0.185],
          [Math.cos(a + 0.3) * 0.185, h + 0.2, -Math.sin(a + 0.3) * 0.185], [Math.cos(a - 0.3) * 0.185, h + 0.2, -Math.sin(a - 0.3) * 0.185]);
      }
      if (st.dome === 'onion') c.nb.add(latheGeo(onionProfile(0.15, 0.32, 0.1, hi ? 8 : 5), hi ? 12 : 7), P.gold, { p: [0, h + 0.24, 0] });
      else c.bag.of(c.roof).ngon(0, h + 0.24, 0, 0.26, 0, 0.42, 8, Math.PI / 8);
      c.bag.of(mat(c.st.door, 2)).box(0, 0.05, 0.25, 0.1, 0.22, 0.03);
      break;
    }
    case 'wind-tower': {
      // a house block with a tall wind catcher (badgir): vertical vents near the top
      const top = block(c, 0, 0.1, 0.78, 0.64, 1);
      roof(c, 'flat', 0, top, 0.1, 0.78, 0.64);
      const tw = 0.3, th = 1.35;
      c.bag.of(c.wall).box(0.12, 0.05, -0.18, tw, th, tw);
      c.bag.of(c.trim).box(0.12, th + 0.05, -0.18, tw + 0.05, 0.05, tw + 0.05);
      for (const f of faces(0.12, -0.18, tw, tw)) {
        c.bag.xf = f.m;
        const v = c.bag.of(P.dark);
        for (let i = 0; i < 3; i++) v.quad([-0.1 + i * 0.075, th - 0.4, 0.006], [-0.06 + i * 0.075, th - 0.4, 0.006], [-0.06 + i * 0.075, th, 0.006], [-0.1 + i * 0.075, th, 0.006]);
      }
      c.bag.xf = null;
      break;
    }
    case 'drum-tower': {
      // a stone base with an arched gate and a two-tier pavilion
      c.bag.of(mat(0x8a8478, 1)).frustum(0, -0.1, 0, 0.86, 0.86, 0.78, 0.78, 0.55);
      c.bag.of(P.dark).box(0, 0, 0.395, 0.2, 0.28, 0.02);
      c.bag.of(mat(0x9a2a20, 3, 0.55)).box(0, 0.45, 0, 0.56, 0.36, 0.56);
      const rf = mat(0x4a5058, 3, 0.6);
      const p = c.bag.of(rf);
      sweptRoof(p, 0, 0.78, 0, 0.62, 0.62, 0.2, 0.12, 0.06, hi);
      c.bag.of(mat(0x9a2a20, 3, 0.55)).box(0, 0.98, 0, 0.36, 0.2, 0.36);
      sweptRoof(c.bag.of(rf), 0, 1.16, 0, 0.42, 0.42, 0.24, 0.1, 0.05, hi);
      c.bag.of(WIN).quad([-0.16, 0.52, 0.282], [0.16, 0.52, 0.282], [0.16, 0.72, 0.282], [-0.16, 0.72, 0.282]);
      break;
    }
    case 'stilt-tower': {
      const top = block(c, 0, 0, 0.5, 0.5, 2, { lift: 0.55, noDoor: true });
      roof(c, 'layered', 0, top, 0, 0.5, 0.5);
      break;
    }
    case 'silo':
    default: {
      c.bag.of(mat(0xb8b4aa, 1)).ngon(0, -0.1, 0, 0.34, 0.34, 1.6, seg);
      c.nb.add(latheGeo(domeProfile(0.34, 0.26, hi ? 5 : 3), seg), P.tin, { p: [0, 1.5, 0] });
    }
  }
};

const farm: KindBuilder = (c) => {
  const { st, r, hi } = c;
  // a barn (or a farmhouse) with a silo / granary and a fenced yard with crop rows
  const barnWall = st.wallD === 2 && r() < 0.6 ? mat(0x8e2a20, 2, 0.85) : c.wall;
  const top = block(c, -0.25, -0.35, 1.2, 0.8, 1, { wall: barnWall, noDoor: true, allSides: false });
  const kind = pick(r, st.roofs);
  roof(c, kind === 'flat' ? 'tin' : kind, -0.25, top, -0.35, 1.2, 0.8);
  c.bag.of(mat(0x4a3a2a, 2)).box(-0.25, 0.05, 0.06, 0.34, 0.3, 0.02); // barn doors
  if (st.huts) {
    for (const [x, z] of [[0.6, -0.5], [0.72, -0.1]]) {
      c.bag.of(c.wall).ngon(x, 0.05, z, 0.14, 0.14, 0.22, hi ? 8 : 6);
      c.bag.of(P.thatch).ngon(x, 0.27, z, 0.2, 0, 0.2, hi ? 8 : 6);
    }
  } else {
    c.bag.of(mat(0xa8a49a, 1)).ngon(0.62, -0.1, -0.45, 0.2, 0.2, 1.05, hi ? 10 : 7);
    c.nb.add(latheGeo(domeProfile(0.2, 0.15, hi ? 4 : 2), hi ? 10 : 7), P.tin, { p: [0.62, 0.95, -0.45] });
  }
  // fenced field with crop rows (front)
  const crop = c.bag.of(mat(r() < 0.5 ? 0x6a7a3a : 0x9a8a4a, 2, 0.95));
  const rows = hi ? 6 : 3;
  for (let i = 0; i < rows; i++) crop.box(0.15, 0.0, 0.25 + (0.6 * i) / rows, 1.5, 0.05, 0.05);
  if (hi) {
    const f = c.bag.of(mat(0x6a5032, 2));
    f.box(0.15, 0.02, 0.92, 1.62, 0.03, 0.02);
    f.box(0.15, 0.1, 0.92, 1.62, 0.02, 0.02);
    for (let i = 0; i <= 6; i++) f.box(-0.66 + i * 0.27, 0, 0.92, 0.025, 0.14, 0.025);
  }
};

const warehouse: KindBuilder = (c) => {
  const { r, hi, st } = c;
  const w = 2.75, d = 1.55;
  const wall = r() < 0.5 ? mat(0x9a4a32, 1) : mat(0x8c8a84, 1);
  const top = block(c, 0, -0.08, w, d, 2, { wall, noDoor: true, allSides: true, balconies: false });
  roof(c, st.roofs.includes('flat') && r() < 0.5 ? 'flat' : 'tin', 0, top, -0.08, w, d);
  // big loading doors and a dock
  const door = c.bag.of(mat(0x4a5a5a, 0, 0.6, 0.5));
  for (const dx of [-0.8, 0, 0.8]) door.box(dx, 0.03, d / 2 - 0.08 + 0.006, 0.42, 0.42, 0.02);
  c.bag.of(mat(0x7c7870, 1)).box(0, -0.1, d / 2 + 0.04, w * 0.9, 0.18, 0.24);
  if (hi) for (let i = 0; i < 4; i++) c.bag.of(mat(0x8a6a44, 2)).box(-1.1 + i * 0.3, 0.08, d / 2 + 0.06, 0.16, 0.14, 0.14);
};

const KINDS: Record<CivilianKind, KindBuilder> = { house, apartment, shop, hall, tower, farm, warehouse };

// ---------------------------------------------------------------------------------------------------------
// building, caching, templates
// ---------------------------------------------------------------------------------------------------------

function buildNB(style: Culture, kind: CivilianKind, variant: number, detail: Detail, facing: number): NB {
  const st = STYLES[style] ?? STYLES.western;
  const r = rng(hashStr(`${style}|${kind}|${variant}`));
  const nb = new NB('root', [0, 0, 0], [0, (-(facing & 3) * Math.PI) / 2, 0]);
  nb.ao = { h: 0.28, min: 0.6 };
  nb.snow = 1;
  nb.cavity = detail === 'high';
  const c: C = {
    nb, bag: new Bag(), hi: detail === 'high', r, st, style,
    wall: mat(pick(r, st.walls), st.wallD),
    roof: mat(pick(r, st.roofCols), 3, 0.75),
    trim: mat(st.trim, 1, 0.8),
    plinth: mat(st.plinth, 1, 0.92),
  };
  (KINDS[kind] ?? house)(c);
  c.bag.flush(nb);
  return nb;
}

const tplCache = new Map<string, ModelTemplate>();

/** The model template of a civilian building (cached; the renderer instantiates it per building). */
export function civilianTemplate(style: Culture, kind: CivilianKind, variant: number, detail: Detail, facing: number, fresh = false): ModelTemplate {
  const key = `${style}|${kind}|${variant % CIV_VARIANTS}|${detail}|${facing & 3}`;
  let t = fresh ? undefined : tplCache.get(key);
  if (t) return t;
  const nb = buildNB(style, kind, variant % CIV_VARIANTS, detail, facing);
  const fp = CIVILIAN_FOOTPRINTS[kind] ?? { w: 1, h: 1 };
  t = makeTemplate({
    root: nb,
    height: kind === 'tower' ? 1.8 : 0.9,
    radius: Math.hypot(fp.w, fp.h) / 2,
    anim: (cx, s) => {
      healthVariant(cx, s);
      cx.setPowered(s.powered); // windows: lit at night (the renderer's hook drives `powered`)
    },
  });
  const g = t.skin?.geo;
  if (g) {
    g.computeBoundingBox();
    t.height = g.boundingBox!.max.y;
  }
  if (!fresh) tplCache.set(key, t);
  return t;
}

/** Forget cached templates (a new battle in another style: keeps memory flat over a long campaign). */
export function dropCivilianTemplates(keep?: Culture): void {
  for (const k of [...tplCache.keys()]) if (!keep || !k.startsWith(`${keep}|`)) tplCache.delete(k);
}

/** One civilian building as a single mesh (facing +z), e.g. for previews and contact sheets. */
export function buildCivilian(style: Culture, kind: CivilianKind, seed: number, detail: Detail): THREE.Mesh {
  const t = civilianTemplate(style, kind, Math.abs(seed | 0) % CIV_VARIANTS, detail, 0);
  const skin = t.skin!;
  const geo = detail === 'low' ? skin.geoLo ?? skin.geo : skin.geo;
  const mesh = new THREE.Mesh(geo, bodyMaterial(SCENERY_HEX, BodyVariant.Normal, false));
  mesh.name = `civilian:${style}:${kind}`;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.customDepthMaterial = shadowDepthMaterial(mesh);
  return mesh;
}

/** Triangles of a civilian building at a detail (tests). */
export function civilianTris(style: Culture, kind: CivilianKind, seed: number, detail: Detail): number {
  const t = civilianTemplate(style, kind, Math.abs(seed | 0) % CIV_VARIANTS, detail, 0);
  const g = detail === 'low' ? t.skin!.geoLo ?? t.skin!.geo : t.skin!.geo;
  return g.index!.count / 3;
}
