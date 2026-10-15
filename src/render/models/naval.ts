/**
 * Naval units and naval structures.
 *
 * Conventions (in addition to types.ts):
 *   - y = 0 is the WATER SURFACE (the engine places ships and the shipyard / sub pen at the water
 *     level, WATER_LEVEL in sim/map). Hulls reach ~0.05..0.1 below it; the water shader hides that part.
 *   - Ships face +X. All ship geometry hangs under a 'hull' node that bobs / rolls / sinks in anim.
 *   - Weapons follow the engine's muzzle convention: muzzles 0/1 = primary weapon, 2/3 = secondary.
 *     The cruiser alternates m0 = fore turret, m1 = aft turret (both 8-inch).
 *   - anim.dying (0..1) on ships = list and sink (the engine can feed it after death instead of
 *     the generic wreck sink). anim.submerged (sub) and anim.deployed (LST ramp) per types.ts.
 */
import * as THREE from 'three';
import { NB, makeTemplate, type Ctx, type Mat, type ModelTemplate } from './builder';
import type { ModelAnimState } from './types';
import { M, G, alliedStar, antenna, barrel, faceRot, hazard, lamp, lathe, pipe, prismXY, prismXZ, sovietStar, windows, ladder, grille, mergeChild } from './parts';
import { approach, blink, dtOf, healthVariant, recoil } from './anim';
import { BodyVariant } from './materials';

type P2 = [number, number];

// ---------------------------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------------------------

/** Team-tinted haze grey for hull topsides. */
const HULL: Mat = { c: 0x9ca3aa, m: 0.36, r: 0.46, t: 0.58, d: 0 };
const HULL_SUB: Mat = { c: 0x4a4e52, m: 0.3, r: 0.55, t: 0.5, d: 0 };
const GREY: Mat = { c: 0x9aa0a6, m: 0.3, r: 0.5, d: 0 };
const GREY_LIGHT: Mat = { c: 0xb4b8bc, m: 0.25, r: 0.5, d: 0 };
const GREY_DARK: Mat = { c: 0x5a6066, m: 0.38, r: 0.52, d: 0 };
const DECK: Mat = { c: 0x64686a, m: 0.12, r: 0.86, d: 1, uv: 3 };
const TEAK: Mat = { c: 0x86684a, m: 0, r: 0.8, d: 2, uv: 5 };
const ANTIFOUL: Mat = { c: 0x7e2c24, m: 0.12, r: 0.72, d: 0 };
const BOOT: Mat = { c: 0x1c1c1e, m: 0.2, r: 0.6, d: 3 };
const RUST: Mat = { c: 0x6a4a34, m: 0.4, r: 0.8, d: 0 };
const PILING: Mat = { c: 0x4c4136, m: 0, r: 0.9, d: 2 };
const SEAWEED: Mat = { c: 0x2c3a26, m: 0, r: 0.95, d: 2 };

// ---------------------------------------------------------------------------------------------
// Lofted hull
// ---------------------------------------------------------------------------------------------

interface HullSpec {
  /** length overall */
  L: number;
  /** max beam */
  B: number;
  /** freeboard (deck height above the waterline) amidships */
  free: number;
  /** extra deck height at the bow */
  sheer: number;
  /** keel depth below the waterline */
  draft: number;
  /** t in -1..1 where the bow taper starts */
  bow: number;
  /** half-breadth factor at the transom */
  stern: number;
  /** stem rake: how far aft the forefoot sits from the deck tip */
  rake: number;
  /** deck edge flare (>1 = wider than the waterline) */
  flare?: number;
  /** stations along the length */
  n?: number;
  /** rounded submarine-like sections */
  round?: boolean;
}

interface Station {
  x: number[];
  y: number[];
  z: number[];
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function hullStations(h: HullSpec): Station[] {
  const n = h.n ?? 16;
  const fl = h.flare ?? 1.06;
  const out: Station[] = [];
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    // denser stations toward the bow where the shape changes fastest
    const t = -1 + 2 * (1 - Math.pow(1 - u, 1.25));
    let w = 1;
    if (t >= h.bow) {
      const k = (t - h.bow) / (1 - h.bow);
      w = Math.pow(Math.max(0, 1 - Math.pow(k, 1.8)), 0.62);
    } else if (t < -0.55) {
      const k = (t + 1) / 0.45;
      w = h.stern + (1 - h.stern) * (1 - (1 - k) * (1 - k));
    }
    const deck = h.free + h.sheer * smoothstep(0.1, 1, t);
    let keel = -h.draft;
    if (t > 0.5) keel *= 1 - 0.8 * Math.pow((t - 0.5) / 0.5, 1.4);
    if (t < -0.8) keel *= 1 - 0.45 * ((-0.8 - t) / 0.2);
    const half = (h.B / 2) * w;
    const sec: [number, number][] = h.round
      ? [
          [half * 0.55, deck],
          [half * 0.92, deck * 0.55],
          [half, 0.012],
          [half * 0.99, -0.008],
          [half * 0.82, keel * 0.6],
          [0, keel],
        ]
      : [
          [half * fl, deck],
          [half * (1 + (fl - 1) * 0.45), deck * 0.45],
          [half, 0.016],
          [half * 0.99, -0.012],
          [half * 0.76, keel * 0.62],
          [0, keel],
        ];
    const st: Station = { x: [], y: [], z: [] };
    for (let j = 0; j < sec.length; j++) {
      const frac = (deck - sec[j][1]) / Math.max(1e-4, deck - keel);
      const rk = h.rake * frac * Math.pow(Math.max(0, (t - 0.55) / 0.45), 2);
      st.x.push((t * h.L) / 2 - rk);
      st.y.push(sec[j][1]);
      st.z.push(sec[j][0]);
    }
    out.push(st);
  }
  return out;
}

function geoFrom(pos: number[], idx: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** One horizontal band of the hull skin (section rows j0..j1), both sides. */
function hullBand(st: Station[], j0: number, j1: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const rows = j1 - j0 + 1;
  for (const side of [1, -1]) {
    const base = pos.length / 3;
    for (const s of st) for (let j = j0; j <= j1; j++) pos.push(s.x[j], s.y[j], s.z[j] * side);
    for (let i = 0; i < st.length - 1; i++) {
      for (let j = 0; j < rows - 1; j++) {
        const A = base + i * rows + j;
        const B = A + 1;
        const C = A + rows;
        const D = C + 1;
        if (side > 0) idx.push(A, B, C, B, D, C);
        else idx.push(A, C, B, B, C, D);
      }
    }
  }
  return geoFrom(pos, idx);
}

/** Deck surface following the sheer line (row 0 of every station). */
function hullDeck(st: Station[], inset = 0): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (const s of st) {
    const z = Math.max(0, s.z[0] - inset);
    pos.push(s.x[0], s.y[0], -z, s.x[0], s.y[0], z);
  }
  for (let i = 0; i < st.length - 1; i++) {
    const A = i * 2;
    const B = A + 1;
    const C = A + 2;
    const D = A + 3;
    idx.push(A, B, C, B, D, C);
  }
  return geoFrom(pos, idx);
}

/** Flat transom closing the stern section. */
function hullTransom(st: Station[]): THREE.BufferGeometry {
  const s = st[0];
  const pts: [number, number][] = [];
  for (let j = 0; j < s.y.length; j++) pts.push([s.z[j], s.y[j]]);
  for (let j = s.y.length - 2; j >= 1; j--) pts.push([-s.z[j], s.y[j]]);
  const pos: number[] = [];
  const idx: number[] = [];
  for (const [z, y] of pts) pos.push(s.x[0], y, z);
  for (let i = 1; i < pts.length - 1; i++) idx.push(0, i + 1, i);
  const g = geoFrom(pos, idx);
  const n = g.getAttribute('normal');
  if (n.getX(0) > 0) {
    const ia = g.index!.array as Uint32Array | Uint16Array;
    for (let i = 0; i < ia.length; i += 3) {
      const t = ia[i + 1];
      ia[i + 1] = ia[i + 2];
      ia[i + 2] = t;
    }
    g.computeVertexNormals();
  }
  return g;
}

interface HullOut {
  st: Station[];
  /** deck height at x (linear interpolation over the stations) */
  deckAt(x: number): number;
  /** deck half-width at x */
  halfAt(x: number): number;
}

/** Add a complete hull (topsides, boot topping, antifouling bottom, deck, transom) to `nb`. */
function hull(nb: NB, h: HullSpec, top: Mat, deck: Mat = DECK, bottom: Mat = ANTIFOUL): HullOut {
  const st = hullStations(h);
  nb.add(hullBand(st, 0, 2), top);
  nb.add(hullBand(st, 2, 3), BOOT);
  nb.add(hullBand(st, 3, 5), bottom);
  nb.add(hullDeck(st), deck, { p: [0, 0.001, 0] });
  nb.add(hullTransom(st), top);
  const interp = (x: number, f: (s: Station) => number) => {
    if (x <= st[0].x[0]) return f(st[0]);
    for (let i = 0; i < st.length - 1; i++) {
      const a = st[i].x[0];
      const b = st[i + 1].x[0];
      if (x <= b) return f(st[i]) + (f(st[i + 1]) - f(st[i])) * ((x - a) / Math.max(1e-6, b - a));
    }
    return f(st[st.length - 1]);
  };
  return {
    st,
    deckAt: (x) => interp(x, (s) => s.y[0]),
    halfAt: (x) => interp(x, (s) => s.z[0]),
  };
}

// ---------------------------------------------------------------------------------------------
// Ship parts
// ---------------------------------------------------------------------------------------------

/** Deck-edge rails: posts + top rail along both sides between x0 and x1. */
function deckRails(nb: NB, H: HullOut, x0: number, x1: number, h = 0.03, step = 0.09): void {
  const n = Math.max(2, Math.round((x1 - x0) / step));
  for (const side of [-1, 1]) {
    let px = 0;
    let py = 0;
    let pz = 0;
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      const y = H.deckAt(x);
      const z = (H.halfAt(x) - 0.008) * side;
      nb.box(GREY_LIGHT, 0.004, h, 0.004, x, y + h / 2, z, { b: 0 });
      if (i > 0) {
        const len = Math.hypot(x - px, y - py, z - pz);
        nb.box(GREY_LIGHT, len, 0.004, 0.004, (x + px) / 2, (y + py) / 2 + h, (z + pz) / 2, {
          b: 0,
          r: [0, -Math.atan2(z - pz, x - px), Math.atan2(y - py, Math.hypot(x - px, z - pz))],
        });
      }
      px = x;
      py = y;
      pz = z;
    }
  }
}

/** Superstructure block with a window band facing forward (+X) and along the sides. */
function house(nb: NB, x: number, y: number, w: number, h: number, d: number, roof: Mat = M.team, win = true, mat: Mat = GREY_LIGHT): void {
  nb.box(mat, w, h, d, x, y + h / 2, 0, { b: 0.008 });
  nb.box(roof, w + 0.012, 0.014, d + 0.012, x, y + h + 0.007, 0, { b: 0.004 });
  if (!win) return;
  const wy = y + h * 0.68;
  nb.box(M.glass, 0.004, h * 0.22, d * 0.8, x + w / 2 + 0.002, wy, 0, { b: 0 });
  for (const s of [-1, 1]) nb.box(M.glass, w * 0.7, h * 0.16, 0.004, x, wy, (d / 2 + 0.002) * s, { b: 0 });
}

/** Navigation bridge: block with a raked window band and bridge wings. */
function navBridge(nb: NB, x: number, y: number, w: number, h: number, d: number, roof: Mat = M.team): void {
  nb.add(
    prismXY(
      [
        [-w / 2, 0],
        [w / 2, 0],
        [w / 2 + h * 0.18, h * 0.62],
        [w / 2 + h * 0.08, h],
        [-w / 2, h],
      ],
      d,
      0.008,
    ),
    GREY_LIGHT,
    { p: [x, y, 0] },
  );
  // raked window band
  nb.box(M.glassBlue, 0.006, h * 0.3, d * 0.86, x + w / 2 + h * 0.14, y + h * 0.8, 0, { b: 0, r: [0, 0, 0.33] });
  for (const s of [-1, 1]) nb.box(M.glass, w * 0.6, h * 0.2, 0.004, x, y + h * 0.78, (d / 2 + 0.002) * s, { b: 0 });
  // bridge wings
  nb.box(GREY_LIGHT, w * 0.35, 0.01, d + 0.1, x + w * 0.25, y + h * 0.62, 0, { b: 0.003 });
  nb.box(roof, w + 0.02, 0.014, d + 0.016, x + 0.005, y + h + 0.007, 0, { b: 0.004 });
}

/** Funnel with team band and soot cap; adds smoke node `name` at the top. */
function funnel(nb: NB, name: string, x: number, y: number, r: number, h: number, rake = 0.18): void {
  const f = new NB('_fn', [x, y, 0], [0, 0, rake]);
  f.cyl(GREY_LIGHT, r * 0.92, r, h, 0, h / 2, 0, { seg: 10, s: [1.25, 1, 1] });
  f.cyl(M.team, r * 0.95, r * 0.95, h * 0.16, 0, h * 0.72, 0, { seg: 10, s: [1.27, 1, 1], open: true });
  f.cyl(M.black, r * 0.94, r * 0.93, h * 0.08, 0, h * 0.96, 0, { seg: 10, s: [1.26, 1, 1], open: true });
  f.cyl(GREY_DARK, r * 0.86, r * 0.86, 0.004, 0, h * 0.92, 0, { seg: 10, s: [1.26, 1, 1] });
  f.box(M.black, r * 1.6, 0.006, 0.006, 0, h * 0.97, 0, { b: 0 });
  mergeChild(nb, f);
  nb.node(name, [x - Math.sin(rake) * h, y + h * Math.cos(rake) + 0.02, 0]);
}

/** Lattice-ish mast: pole, yard, radar platform; returns the top y. */
function mast(nb: NB, x: number, y: number, h: number, yard = 0.16): number {
  nb.cyl(GREY_DARK, 0.007, 0.011, h, x, y + h / 2, 0, { seg: 5 });
  nb.box(GREY_DARK, 0.008, 0.006, yard, x, y + h * 0.72, 0, { b: 0 });
  nb.box(GREY_DARK, 0.04, 0.008, 0.05, x, y + h * 0.55, 0, { b: 0 });
  // stays
  for (const s of [-1, 1]) pipe(nb, [x, y + h * 0.72, (yard / 2) * s], [x - 0.08, y, (yard / 2) * s * 0.8], 0.0018, GREY_DARK, 3);
  return y + h;
}

/** Small rotating radar antenna node on top of a mast. */
function radar(nb: NB, name: string, x: number, y: number, w = 0.09): NB {
  const r = nb.node(name, [x, y, 0]);
  r.cyl(GREY_DARK, 0.006, 0.006, 0.02, 0, 0.01, 0, { seg: 5 });
  r.box(GREY_LIGHT, 0.012, 0.022, w, 0, 0.028, 0, { b: 0.002 });
  r.box(GREY_DARK, 0.016, 0.006, w * 1.04, 0, 0.018, 0, { b: 0 });
  return r;
}

/** Naval gun turret (sloped front gunhouse) with `n` barrels. Barrel nodes b<k>, muzzle nodes per muzzleNames. */
function gunHouse(nb: NB, size: number, n: number, len: number, rad: number, bNames: string[], mNames: string[], roof: Mat = M.team): void {
  const s = size;
  nb.add(
    prismXY(
      [
        [-0.5 * s, 0],
        [0.5 * s, 0],
        [0.56 * s, 0.22 * s],
        [0.36 * s, 0.44 * s],
        [-0.46 * s, 0.44 * s],
        [-0.52 * s, 0.36 * s],
      ],
      0.82 * s,
      0.012,
    ),
    GREY_LIGHT,
  );
  nb.box(roof, 0.8 * s, 0.012, 0.74 * s, -0.05 * s, 0.446 * s, 0, { b: 0.004 });
  // rangefinder ears
  if (s > 0.2) for (const z of [-1, 1]) nb.cyl(GREY_DARK, 0.022, 0.022, 0.05, -0.12 * s, 0.38 * s, z * 0.43 * s, { r: [Math.PI / 2, 0, 0], seg: 6 });
  nb.cyl(GREY_DARK, 0.42 * s, 0.46 * s, 0.05 * s, 0, -0.02 * s, 0, { seg: 12 });
  const gap = n > 1 ? (0.4 * s) / (n - 1) : 0;
  for (let k = 0; k < n; k++) {
    const z = n > 1 ? -0.2 * s + gap * k : 0;
    nb.box(GREY_DARK, 0.06 * s, 0.12 * s, 0.1 * s, 0.53 * s, 0.2 * s, z, { b: 0.004 });
    const b = nb.node(bNames[k], [0.5 * s, 0.2 * s, z]);
    barrel(b, len, rad, { sleeve: true, mat: GREY_DARK });
    nb.node(mNames[k], [0.5 * s + len + 0.01, 0.2 * s, z]);
  }
}

/** Depth-charge rack (rolling rack at the transom): stacked barrels on a frame. */
function dcRack(nb: NB, x: number, y: number, z: number, n = 3): void {
  nb.box(GREY_DARK, 0.12, 0.01, 0.05, x, y + 0.005, z, { b: 0 });
  for (let i = 0; i < n; i++) nb.cyl(M.oliveDark, 0.014, 0.014, 0.034, x - 0.04 + i * 0.04, y + 0.024, z, { r: [Math.PI / 2, 0, 0], seg: 6 });
  nb.box(GREY_DARK, 0.004, 0.035, 0.05, x + 0.062, y + 0.018, z, { b: 0 });
}

/** K-gun depth charge thrower (angled mortar). */
function kGun(nb: NB, x: number, y: number, z: number, side: number): void {
  nb.cyl(GREY_DARK, 0.012, 0.014, 0.02, x, y + 0.01, z, { seg: 6 });
  nb.cyl(GREY_DARK, 0.011, 0.011, 0.05, x, y + 0.035, z + side * 0.012, { r: [-0.6 * side, 0, 0], seg: 6 });
  nb.cyl(M.oliveDark, 0.013, 0.013, 0.03, x, y + 0.062, z + side * 0.03, { r: [-0.6 * side, 0, 0], seg: 6 });
}

/** Lifeboat / raft canister. */
function raft(nb: NB, x: number, y: number, z: number, len = 0.07): void {
  nb.cyl(M.offwhite, 0.012, 0.012, len, x, y + 0.012, z, { r: [0, 0, Math.PI / 2], seg: 6 });
  nb.box(M.red, 0.006, 0.026, 0.026, x, y + 0.012, z, { b: 0 });
}

/** Navigation lights: red port (-Z), green starboard (+Z), white masthead. */
function navLights(nb: NB, x: number, y: number, half: number, mastTop: number, mastX: number): void {
  nb.sph(G.red, 0.008, x, y, -half, { seg: 4, slot: 'glow' });
  nb.sph(G.green, 0.008, x, y, half, { seg: 4, slot: 'glow' });
  nb.sph(G.white, 0.008, mastX, mastTop + 0.01, 0, { seg: 4, slot: 'glow:strobe' });
}

const SHIP_BOB = 0.012;

/** Shared ship animation: bob/roll/pitch on 'hull', health scorch, death list & sink, strobe. */
function shipAnim(c: Ctx, s: ModelAnimState, size: number, extra?: (c: Ctx, s: ModelAnimState, dt: number) => void): void {
  const dt = dtOf(s);
  if (c.v.seed === undefined) c.v.seed = Math.random() * 20;
  const h = c.n.hull;
  const t = s.time + c.v.seed;
  const mv = (c.v.mv = approach(c.v.mv ?? 0, s.moving ? s.speed : 0, 1.2, dt));
  const k = 1 / Math.sqrt(size);
  const d = Math.min(1, s.dying);
  if (d > 0) {
    c.setVariant(d > 0.3 ? BodyVariant.Charred : BodyVariant.Wrecked);
    h.position.y = -d * d * 0.5 * size - 0.02;
    h.rotation.x = d * 0.55 * (c.v.seed > 10 ? 1 : -1);
    h.rotation.z = d * 0.3;
    extra?.(c, s, dt);
    return;
  }
  healthVariant(c, s);
  const list = s.health < 0.25 ? 0.06 : 0;
  h.position.y = Math.sin(t * 1.3) * SHIP_BOB * k + Math.sin(t * 2.9) * SHIP_BOB * 0.35 * k + mv * 0.012 * k - (s.health < 0.25 ? 0.015 : 0);
  h.rotation.x = Math.sin(t * 0.9) * 0.035 * k + list;
  h.rotation.z = Math.sin(t * 1.15 + 1.3) * 0.018 * k + mv * 0.025 * k;
  c.setGlow('glow:strobe', blink(t, 1.6, 0.5) ? 1 : 0.15);
  if (c.n.radar) c.n.radar.rotation.y += dt * 2.2;
  if (c.n.radar2) c.n.radar2.rotation.y -= dt * 1.6;
  extra?.(c, s, dt);
}

function shipRoot(): { r: NB; hl: NB } {
  const r = new NB('root');
  const hl = r.node('hull');
  return { r, hl };
}

// =============================================================================================
// Gunboat (Allied) — fast patrol boat: forward gun, bridge, mast, depth charges aft
// =============================================================================================

function gunboat(): ModelTemplate {
  const { r, hl } = shipRoot();
  const H = hull(hl, { L: 0.92, B: 0.25, free: 0.065, sheer: 0.03, draft: 0.05, bow: 0.15, stern: 0.78, rake: 0.08, n: 14 }, HULL);
  const dy = H.deckAt(0);
  // forward gun
  const t = hl.node('turret', [0.24, H.deckAt(0.24), 0]);
  t.cyl(GREY_DARK, 0.04, 0.045, 0.02, 0, 0.01, 0, { seg: 10 });
  t.box(GREY_LIGHT, 0.06, 0.05, 0.07, -0.005, 0.045, 0, { b: 0.008 });
  t.box(M.team, 0.062, 0.008, 0.072, -0.005, 0.072, 0, { b: 0.002 });
  t.box(GREY_DARK, 0.012, 0.045, 0.07, 0.03, 0.045, 0, { b: 0.003, r: [0, 0, -0.25] });
  const b0 = t.node('b0', [0.03, 0.045, 0]);
  barrel(b0, 0.13, 0.008, { mat: GREY_DARK });
  t.node('m0', [0.17, 0.045, 0]);
  t.node('m1', [0.17, 0.045, 0]);
  // bridge + cabin
  navBridge(hl, 0.02, dy, 0.17, 0.085, 0.15);
  house(hl, -0.13, dy, 0.16, 0.05, 0.13, M.team, false, GREY);
  windows(hl, 3, 0.022, 0.016, 0.012, [-0.13, dy + 0.03, 0.0655], [0, 0, 0], G.window, 'glow', [0, 2]);
  alliedStar(hl, 0.026, [-0.13, dy + 0.0655, 0]);
  const top = mast(hl, -0.01, dy + 0.1, 0.17, 0.11);
  radar(hl, 'radar', -0.01, top - 0.06, 0.07);
  lamp(hl, G.amber, [0.04, dy + 0.1, 0.05], 0.01);
  antenna(hl, -0.2, dy + 0.05, 0.05, 0.14);
  // twin MG mounts on the bridge wings
  for (const s of [-1, 1]) hl.box(GREY_DARK, 0.04, 0.008, 0.008, 0.09, dy + 0.06, 0.09 * s, { b: 0 });
  // stern: depth charge rack + K-guns
  dcRack(hl, -0.36, H.deckAt(-0.36), 0.05, 3);
  dcRack(hl, -0.36, H.deckAt(-0.36), -0.05, 3);
  kGun(hl, -0.26, H.deckAt(-0.26), 0.08, 1);
  kGun(hl, -0.26, H.deckAt(-0.26), -0.08, -1);
  hl.node('m2', [-0.26, H.deckAt(-0.26) + 0.07, 0.11]);
  hl.node('m3', [-0.26, H.deckAt(-0.26) + 0.07, -0.11]);
  raft(hl, -0.2, dy + 0.05, 0.0, 0.06);
  deckRails(hl, H, -0.42, 0.3, 0.022, 0.1);
  navLights(hl, 0.08, dy + 0.065, 0.085, top, -0.01);
  hl.node('exhaust', [-0.3, dy + 0.03, 0]);

  return makeTemplate({
    root: r,
    height: 0.32,
    radius: 0.46,
    turret: 'turret',
    muzzles: ['m0', 'm1', 'm2', 'm3'],
    smoke: ['exhaust'],
    glow: { glow: 2.5, 'glow:strobe': 4 },
    anim: (c, s) => shipAnim(c, s, 0.9, (c2, s2) => recoil(c2, s2, ['b0'], 0.025)),
  });
}

// =============================================================================================
// Destroyer (Allied) — fore gun, aft rotating missile launcher (primary, AA capable), depth charges
// =============================================================================================

function destroyer(): ModelTemplate {
  const { r, hl } = shipRoot();
  const H = hull(hl, { L: 1.5, B: 0.34, free: 0.085, sheer: 0.045, draft: 0.07, bow: 0.12, stern: 0.72, rake: 0.14, n: 16 }, HULL);
  const dy = H.deckAt(0);
  // fore gun (follows the launcher's aim)
  const fg = hl.node('fgun', [0.42, H.deckAt(0.42), 0]);
  gunHouse(fg, 0.15, 1, 0.17, 0.011, ['fb0'], ['fm0']);
  // forecastle details
  for (const s of [-1, 1]) hl.cyl(GREY_DARK, 0.012, 0.012, 0.012, 0.6, H.deckAt(0.6) + 0.006, 0.03 * s, { seg: 6 });
  hl.box(GREY_DARK, 0.1, 0.004, 0.006, 0.6, H.deckAt(0.6) + 0.004, 0, { b: 0 });
  // superstructure: bridge, funnels, aft deckhouse
  navBridge(hl, 0.2, dy, 0.2, 0.12, 0.2);
  house(hl, 0.03, dy, 0.2, 0.09, 0.18, M.team, false, GREY);
  windows(hl, 4, 0.022, 0.016, 0.014, [0.03, dy + 0.055, 0.0905], [0, 0, 0], G.window, 'glow', [0, 1, 3]);
  windows(hl, 4, 0.022, 0.016, 0.014, [0.03, dy + 0.055, -0.0905], [0, Math.PI, 0], G.window, 'glow', [1, 2]);
  const top = mast(hl, 0.14, dy + 0.13, 0.25, 0.16);
  radar(hl, 'radar', 0.14, top - 0.09, 0.1);
  hl.box(GREY_DARK, 0.04, 0.03, 0.04, 0.14, top - 0.01, 0, { b: 0.004 });
  funnel(hl, 'smoke0', -0.04, dy + 0.09, 0.04, 0.11);
  funnel(hl, 'smoke1', -0.16, dy + 0.06, 0.036, 0.1);
  house(hl, -0.2, dy, 0.22, 0.06, 0.17, M.team, false, GREY);
  alliedStar(hl, 0.035, [0.03, dy + 0.0955, 0]);
  for (const s of [-1, 1]) {
    raft(hl, -0.09, dy + 0.02, 0.13 * s, 0.08);
    raft(hl, 0.06, dy + 0.02, 0.135 * s, 0.07);
    // torpedo tube mount (decorative)
    hl.cyl(GREY_DARK, 0.012, 0.012, 0.1, -0.04, dy + 0.025, 0.13 * s, { r: [0, 0, Math.PI / 2], seg: 6 });
  }
  // aft missile launcher (the turret)
  const tz = -0.42;
  const t = hl.node('turret', [tz, H.deckAt(tz), 0]);
  t.cyl(GREY_DARK, 0.06, 0.07, 0.03, 0, 0.015, 0, { seg: 12 });
  t.box(GREY_LIGHT, 0.06, 0.06, 0.07, -0.02, 0.06, 0, { b: 0.008 });
  const arm = t.node('arm', [0, 0.08, 0], [0, 0, 0.35]);
  arm.box(GREY_DARK, 0.03, 0.03, 0.15, 0, 0, 0, { b: 0.004 });
  for (const [i, z] of [
    [0, -0.05],
    [1, 0.05],
  ] as const) {
    arm.box(M.team, 0.12, 0.05, 0.045, 0.04, 0, z, { b: 0.006 });
    for (const dy2 of [-0.012, 0.012]) for (const dz of [-0.011, 0.011]) {
      arm.add(new THREE.CircleGeometry(0.008, 5), M.darker, { p: [0.101, dy2, z + dz], r: [0, Math.PI / 2, 0] });
      arm.add(new THREE.CircleGeometry(0.005, 4), M.red, { p: [0.102, dy2, z + dz], r: [0, Math.PI / 2, 0] });
    }
    arm.node(`m${i}`, [0.11, 0, z]);
  }
  // stern: depth charges
  dcRack(hl, -0.66, H.deckAt(-0.66), 0.06, 3);
  dcRack(hl, -0.66, H.deckAt(-0.66), -0.06, 3);
  kGun(hl, -0.56, H.deckAt(-0.56), 0.11, 1);
  kGun(hl, -0.56, H.deckAt(-0.56), -0.11, -1);
  hl.node('m2', [-0.56, H.deckAt(-0.56) + 0.07, 0.14]);
  hl.node('m3', [-0.56, H.deckAt(-0.56) + 0.07, -0.14]);
  deckRails(hl, H, -0.72, 0.55, 0.024, 0.11);
  navLights(hl, 0.28, dy + 0.085, 0.12, top, 0.14);
  hazard(hl, 0.16, 0.012, [-0.42, H.deckAt(-0.42) + 0.002, 0.11], [-Math.PI / 2, 0, 0]);

  return makeTemplate({
    root: r,
    height: 0.5,
    radius: 0.74,
    turret: 'turret',
    muzzles: ['m0', 'm1', 'm2', 'm3'],
    smoke: ['smoke0', 'smoke1'],
    glow: { glow: 2.5, 'glow:strobe': 4 },
    anim: (c, s) =>
      shipAnim(c, s, 1.5, (c2, s2) => {
        const tr = c2.n.turret;
        // fore gun tracks the same bearing (relative to the hull)
        c2.n.fgun.rotation.y = tr.rotation.y;
        recoil(c2, s2, ['fb0'], 0.03);
      }),
  });
}

// =============================================================================================
// Cruiser (Allied) — two twin 8-inch turrets (fore = m0/m2, aft = m1/m3), heavy superstructure
// =============================================================================================

function cruiser(): ModelTemplate {
  const { r, hl } = shipRoot();
  const H = hull(hl, { L: 2.35, B: 0.5, free: 0.1, sheer: 0.05, draft: 0.1, bow: 0.15, stern: 0.7, rake: 0.2, n: 18 }, HULL, TEAK);
  const dy = H.deckAt(0);
  // armoured citadel deck plating
  hl.box(DECK, 1.1, 0.012, 0.36, -0.05, dy + 0.006, 0, { b: 0.004 });
  // fore turret = engine turret; aft turret copies its bearing
  const fx = 0.6;
  const t = hl.node('turret', [fx, H.deckAt(fx) + 0.02, 0]);
  gunHouse(t, 0.26, 2, 0.36, 0.014, ['b0', 'b2'], ['m0', 'm2']);
  hl.cyl(GREY, 0.13, 0.14, 0.03, fx, H.deckAt(fx) + 0.005, 0, { seg: 14 });
  // superfiring B turret ahead of the bridge (decorative, follows)
  const bx = 0.36;
  hl.cyl(GREY, 0.11, 0.12, 0.07, bx, H.deckAt(bx) + 0.035, 0, { seg: 12 });
  const tb = hl.node('turretB', [bx, H.deckAt(bx) + 0.07, 0]);
  gunHouse(tb, 0.21, 2, 0.28, 0.012, ['bb0', 'bb1'], ['mb0', 'mb1']);
  // aft turret
  const ax = -0.68;
  hl.cyl(GREY, 0.13, 0.14, 0.03, ax, H.deckAt(ax) + 0.005, 0, { seg: 14 });
  const ta = hl.node('turretA', [ax, H.deckAt(ax) + 0.02, 0], [0, Math.PI, 0]);
  gunHouse(ta, 0.26, 2, 0.36, 0.014, ['b1', 'b3'], ['m1', 'm3']);
  // superstructure stack: citadel, bridge tower, funnels, aft control
  house(hl, 0.0, dy, 0.5, 0.08, 0.3, M.team, false, GREY);
  windows(hl, 6, 0.024, 0.016, 0.03, [0.0, dy + 0.05, 0.1505], [0, 0, 0], G.window, 'glow', [0, 2, 3, 5]);
  windows(hl, 6, 0.024, 0.016, 0.03, [0.0, dy + 0.05, -0.1505], [0, Math.PI, 0], G.window, 'glow', [1, 2, 4]);
  navBridge(hl, 0.16, dy + 0.08, 0.2, 0.12, 0.24);
  house(hl, 0.12, dy + 0.2, 0.12, 0.08, 0.14, M.team, true);
  // director tower + rangefinder
  hl.cyl(GREY_DARK, 0.035, 0.04, 0.1, 0.12, dy + 0.33, 0, { seg: 8 });
  hl.box(GREY_LIGHT, 0.07, 0.04, 0.06, 0.12, dy + 0.4, 0, { b: 0.006 });
  hl.box(GREY_DARK, 0.016, 0.016, 0.22, 0.12, dy + 0.39, 0, { b: 0.003 });
  const top = mast(hl, 0.06, dy + 0.42, 0.28, 0.22);
  radar(hl, 'radar', 0.06, top - 0.1, 0.13);
  funnel(hl, 'smoke0', -0.08, dy + 0.08, 0.055, 0.17);
  funnel(hl, 'smoke1', -0.25, dy + 0.08, 0.055, 0.16);
  house(hl, -0.42, dy, 0.18, 0.1, 0.22, M.team, true);
  const top2 = mast(hl, -0.42, dy + 0.1, 0.2, 0.16);
  radar(hl, 'radar2', -0.42, top2 - 0.06, 0.09);
  alliedStar(hl, 0.045, [0.0, dy + 0.0955, 0]);
  // secondary battery: twin 5-inch mounts on the sides
  for (const s of [-1, 1]) {
    for (const x of [0.08, -0.16]) {
      hl.cyl(GREY_DARK, 0.03, 0.034, 0.014, x, dy + 0.087, 0.12 * s, { seg: 8 });
      hl.box(GREY_LIGHT, 0.06, 0.035, 0.05, x, dy + 0.1, 0.12 * s, { b: 0.006 });
      for (const dz of [-0.01, 0.01]) hl.cyl(GREY_DARK, 0.004, 0.004, 0.07, x + 0.06, dy + 0.105, 0.12 * s + dz, { r: [0, 0, -Math.PI / 2 + 0.1], seg: 5 });
    }
    // AA guns & rafts along the deck edge
    for (const x of [0.28, -0.3, -0.52]) hl.cyl(GREY_DARK, 0.016, 0.018, 0.02, x, H.deckAt(x) + 0.01, (H.halfAt(x) - 0.04) * s, { seg: 6 });
    raft(hl, -0.16, dy + 0.087, 0.2 * s, 0.09);
    // catapult crane
  }
  // aircraft crane + boats aft of the funnels
  hl.cyl(GREY_DARK, 0.012, 0.014, 0.16, -0.34, dy + 0.18, 0.12, { seg: 6 });
  pipe(hl, [-0.34, dy + 0.26, 0.12], [-0.22, dy + 0.2, 0.15], 0.006, GREY_DARK, 4);
  hl.cyl(M.offwhite, 0.022, 0.022, 0.12, -0.32, dy + 0.11, -0.07, { r: [0, 0, Math.PI / 2], seg: 8, s: [1, 1, 0.7] });
  // anchors, bow details
  for (const s of [-1, 1]) {
    hl.cyl(GREY_DARK, 0.016, 0.016, 0.014, 0.9, H.deckAt(0.9) + 0.007, 0.04 * s, { seg: 6 });
    hl.box(GREY_DARK, 0.03, 0.03, 0.01, 1.0, H.deckAt(1.0) - 0.03, (H.halfAt(1.0) + 0.002) * s, { b: 0.003 });
  }
  hl.box(GREY_DARK, 0.18, 0.004, 0.008, 0.95, H.deckAt(0.95) + 0.003, 0, { b: 0 });
  deckRails(hl, H, -1.1, 0.95, 0.026, 0.13);
  navLights(hl, 0.24, dy + 0.18, 0.16, top, 0.06);
  // flag staff aft
  hl.cyl(GREY_DARK, 0.003, 0.003, 0.12, -1.13, H.deckAt(-1.13) + 0.06, 0, { seg: 3 });
  hl.box(M.team, 0.05, 0.03, 0.002, -1.105, H.deckAt(-1.13) + 0.1, 0, { b: 0 });

  return makeTemplate({
    root: r,
    height: 0.7,
    radius: 1.15,
    turret: 'turret',
    muzzles: ['m0', 'm1', 'm2', 'm3'],
    smoke: ['smoke0', 'smoke1'],
    glow: { glow: 2.5, 'glow:strobe': 4 },
    anim: (c, s) =>
      shipAnim(c, s, 2.4, (c2, s2) => {
        const yaw = c2.n.turret.rotation.y;
        c2.n.turretB.rotation.y = yaw;
        // the aft turret rests facing aft and swings onto the fore turret's bearing while engaged
        const dt = dtOf(s2);
        c2.v.eng = s2.firing > 0.5 ? 4 : Math.max(0, (c2.v.eng ?? 0) - dt);
        const ta = c2.n.turretA;
        const want = c2.v.eng > 0 ? yaw : Math.PI;
        const diff = ((((want - ta.rotation.y + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
        ta.rotation.y += diff * Math.min(1, dt * 2.5);
        recoil(c2, s2, ['b0', 'b1', 'b2', 'b3'], 0.06);
        // twin barrels fire together: mirror the left barrel's recoil onto the right one
        if (s2.firing > 0) {
          const m = s2.firingMuzzle % 2;
          const kick = 0.06 * s2.firing * s2.firing * (3 - 2 * s2.firing);
          const twin = m === 0 ? 'b2' : 'b3';
          const rest = c2.v[twin];
          if (rest !== undefined) c2.n[twin].position.x = rest - kick;
        }
      }),
  });
}

// =============================================================================================
// Transport (LST) — open vehicle deck, bow ramp (anim.deployed), aft bridge
// =============================================================================================

function transport(): ModelTemplate {
  const { r, hl } = shipRoot();
  const H = hull(hl, { L: 1.4, B: 0.48, free: 0.09, sheer: 0.03, draft: 0.06, bow: 0.55, stern: 0.88, rake: 0.0, flare: 1.0, n: 14 }, HULL);
  const dy = H.deckAt(0);
  // well deck (recessed vehicle bay) with side walls
  hl.box(DECK, 0.86, 0.01, 0.34, 0.12, dy + 0.002, 0, { b: 0 });
  for (const s of [-1, 1]) {
    hl.box(HULL, 0.95, 0.07, 0.03, 0.1, dy + 0.035, 0.2 * s, { b: 0.006 });
    hl.box(M.team, 0.95, 0.01, 0.034, 0.1, dy + 0.074, 0.2 * s, { b: 0.003 });
    for (let i = 0; i < 6; i++) hl.box(GREY_DARK, 0.008, 0.06, 0.006, -0.3 + i * 0.16, dy + 0.035, 0.217 * s, { b: 0 });
  }
  // deck tie-down lines
  for (let i = 0; i < 3; i++) hl.box(M.yellow, 0.8, 0.003, 0.008, 0.12, dy + 0.008, -0.1 + i * 0.1, { b: 0 });
  hazard(hl, 0.3, 0.02, [0.55, dy + 0.008, 0], [-Math.PI / 2, 0, Math.PI / 2]);
  // cargo: a couple of crates & a jeep-sized tarp
  hl.box(M.olive, 0.12, 0.05, 0.08, -0.12, dy + 0.03, 0.08, { b: 0.01 });
  hl.box(M.canvas, 0.16, 0.06, 0.1, 0.1, dy + 0.035, -0.07, { b: 0.02 });
  // bow doors (clamshell, open with the ramp) + ramp
  const bx = 0.6;
  const by = dy + 0.005;
  for (const s of [-1, 1]) {
    const door = hl.node(s > 0 ? 'doorL' : 'doorR', [bx, by, 0.19 * s]);
    door.add(
      prismXY(
        [
          [0, 0],
          [0.1, 0.0],
          [0.13, 0.05],
          [0.12, 0.08],
          [0, 0.085],
        ],
        0.03,
        0.006,
      ),
      HULL,
      { p: [0, 0, -0.06 * s] },
    );
  }
  const ramp = hl.node('ramp', [bx, by, 0]);
  ramp.box(GREY, 0.02, 0.17, 0.3, 0.01, 0.085, 0, { b: 0.006 });
  for (let i = 0; i < 5; i++) ramp.box(GREY_DARK, 0.006, 0.006, 0.28, 0.022, 0.02 + i * 0.033, 0, { b: 0 });
  hazard(ramp, 0.3, 0.018, [0.021, 0.16, 0], [0, Math.PI / 2, 0]);
  // aft superstructure / bridge
  navBridge(hl, -0.5, dy, 0.24, 0.13, 0.36);
  house(hl, -0.52, dy + 0.13, 0.12, 0.07, 0.2, M.team, true);
  windows(hl, 4, 0.024, 0.018, 0.02, [-0.5, dy + 0.06, 0.1805], [0, 0, 0], G.window, 'glow', [0, 3]);
  const top = mast(hl, -0.52, dy + 0.2, 0.2, 0.18);
  radar(hl, 'radar', -0.52, top - 0.07, 0.08);
  funnel(hl, 'smoke0', -0.62, dy + 0.05, 0.035, 0.13, 0.1);
  for (const s of [-1, 1]) {
    raft(hl, -0.42, dy + 0.13, 0.16 * s, 0.07);
    lamp(hl, G.amber, [0.55, dy + 0.09, 0.2 * s], 0.012, 'glow:ramp');
  }
  // stern anchor winch
  hl.cyl(GREY_DARK, 0.03, 0.03, 0.12, -0.66, dy + 0.03, 0, { r: [Math.PI / 2, 0, 0], seg: 8 });
  navLights(hl, -0.4, dy + 0.1, 0.19, top, -0.52);

  return makeTemplate({
    root: r,
    height: 0.45,
    radius: 0.72,
    muzzles: [],
    smoke: ['smoke0'],
    glow: { glow: 2.5, 'glow:strobe': 4, 'glow:ramp': 4 },
    anim: (c, s) =>
      shipAnim(c, s, 1.4, (c2, s2, dt) => {
        const d = (c2.v.ramp = approach(c2.v.ramp ?? 0, Math.min(1, Math.max(0, s2.deployed ?? 0)), 6, dt));
        // ramp hinges at its foot and drops forward onto the beach
        c2.n.ramp.rotation.z = -d * 1.45;
        c2.n.doorL.rotation.y = -d * 1.2;
        c2.n.doorR.rotation.y = d * 1.2;
        const moving = d > 0.02 && d < 0.98;
        c2.setGlow('glow:ramp', moving || d > 0.5 ? (blink(s2.time, 0.5, 0.5) ? 1 : 0.15) : 0.1);
      }),
  });
}

// =============================================================================================
// Submarine (Soviet) — round hull, conning tower (sail), periscopes; anim.submerged dives
// =============================================================================================

function submarine(): ModelTemplate {
  const { r, hl } = shipRoot();
  // hull: low cigar shape riding with most of its body below the surface
  const H = hull(hl, { L: 1.3, B: 0.2, free: 0.04, sheer: 0.01, draft: 0.09, bow: 0.3, stern: 0.15, rake: 0.0, round: true, n: 14 }, HULL_SUB, shadeDeck(), HULL_SUB);
  const dy = H.deckAt(0);
  // deck casing with limber holes
  hl.box(HULL_SUB, 0.9, 0.018, 0.07, 0.02, dy + 0.006, 0, { b: 0.006 });
  for (let i = 0; i < 10; i++) for (const s of [-1, 1]) hl.box(M.darker, 0.03, 0.006, 0.002, -0.38 + i * 0.09, dy - 0.012, (H.halfAt(-0.38 + i * 0.09) * 0.55 + 0.001) * s, { b: 0 });
  // sail
  const sx = 0.08;
  hl.add(
    prismXZ(
      [
        [0.11, 0],
        [0.07, 0.035],
        [-0.08, 0.035],
        [-0.12, 0.02],
        [-0.12, -0.02],
        [-0.08, -0.035],
        [0.07, -0.035],
      ],
      0.13,
      0.012,
    ),
    HULL_SUB,
    { p: [sx, dy + 0.01, 0] },
  );
  hl.box(M.team, 0.17, 0.02, 0.072, sx - 0.01, dy + 0.105, 0, { b: 0.004 });
  hl.box(M.darker, 0.1, 0.008, 0.05, sx - 0.02, dy + 0.141, 0, { b: 0.002 });
  // fairwater planes
  for (const s of [-1, 1]) hl.box(HULL_SUB, 0.05, 0.006, 0.06, sx + 0.02, dy + 0.08, 0.06 * s, { b: 0.002 });
  sovietStar(hl, 0.022, [sx - 0.01, dy + 0.07, 0.0365], faceRot('+z'));
  sovietStar(hl, 0.022, [sx - 0.01, dy + 0.07, -0.0365], faceRot('-z'));
  // masts: periscopes + snorkel (stay above the surface at periscope depth)
  const masts = hl.node('masts', [sx, dy + 0.14, 0]);
  masts.cyl(GREY_DARK, 0.005, 0.006, 0.14, 0.02, 0.07, 0, { seg: 5 });
  masts.cyl(GREY_DARK, 0.004, 0.005, 0.12, -0.01, 0.06, 0.012, { seg: 5 });
  masts.box(GREY_DARK, 0.016, 0.01, 0.01, 0.025, 0.14, 0, { b: 0 });
  masts.cyl(GREY_DARK, 0.008, 0.009, 0.1, -0.05, 0.05, 0, { seg: 5 });
  masts.sph(G.red, 0.006, -0.01, 0.125, 0.012, { seg: 4, slot: 'glow:strobe' });
  // bow planes, stern planes, rudder, propeller
  for (const s of [-1, 1]) {
    hl.box(HULL_SUB, 0.06, 0.006, 0.07, 0.48, -0.02, 0.1 * s, { b: 0.002 });
    hl.box(HULL_SUB, 0.07, 0.006, 0.08, -0.6, -0.03, 0.06 * s, { b: 0.002 });
  }
  hl.box(HULL_SUB, 0.07, 0.12, 0.006, -0.61, -0.02, 0, { b: 0.002 });
  const prop = hl.node('prop', [-0.66, -0.035, 0]);
  for (let i = 0; i < 5; i++) prop.box(M.brass, 0.008, 0.07, 0.016, 0, 0, 0, { b: 0, r: [(i / 5) * Math.PI * 2, 0, 0.3] });
  prop.cyl(M.brass, 0.012, 0.008, 0.02, 0, 0, 0, { r: [0, 0, Math.PI / 2], seg: 6 });
  // torpedo tube doors (muzzles just under the bow waterline)
  for (const s of [-1, 1]) hl.add(new THREE.CircleGeometry(0.012, 6), M.darker, { p: [0.6, -0.025, 0.035 * s], r: [0, Math.PI / 2 - 0.5 * s, 0] });
  hl.node('m0', [0.66, -0.03, -0.03]);
  hl.node('m1', [0.66, -0.03, 0.03]);
  hl.node('m2', [0.66, -0.03, -0.03]);
  hl.node('m3', [0.66, -0.03, 0.03]);
  // deck hatch + capstan
  hl.cyl(M.darker, 0.015, 0.015, 0.006, -0.25, dy + 0.017, 0, { seg: 8 });
  hl.cyl(GREY_DARK, 0.01, 0.01, 0.012, 0.36, dy + 0.017, 0, { seg: 6 });
  // owner-only "ghost" outline on the surface while submerged (additive, fades in with submerged)
  const ghost = r.node('ghost', [0, 0.012, 0]);
  ghost.add(new THREE.CircleGeometry(0.5, 20), M.dark, { r: [-Math.PI / 2, 0, 0], s: [1.35, 1, 0.26], slot: 'fx:add:3fa8ff:0.32', keepUv: true });
  r.node('exhaust', [sx - 0.05, dy + 0.2, 0]);

  return makeTemplate({
    root: r,
    height: 0.3,
    radius: 0.62,
    muzzles: ['m0', 'm1', 'm2', 'm3'],
    smoke: ['exhaust'],
    glow: { glow: 2.5, 'glow:strobe': 4 },
    anim: (c, s) => {
      const dt = dtOf(s);
      const sub = (c.v.sub = approach(c.v.sub ?? 0, Math.min(1, Math.max(0, s.submerged ?? 0)), 2.2, dt));
      shipAnim(c, s, 1.3 * (1 + sub * 2), (c2, s2) => {
        if (s2.dying > 0) return;
        const h = c2.n.hull;
        // dive: hull and sail go under, periscopes stay up (periscope depth)
        h.position.y = h.position.y * (1 - sub) - sub * 0.235;
        h.rotation.z += Math.sin(Math.min(1, sub) * Math.PI) * 0.06 * (s2.submerged ? -1 : 1);
        c2.n.prop.rotation.x += Math.min(dt * 18 * (s2.moving ? 1 : 0.15), 0.6);
        c2.setGlow('glow:strobe', sub > 0.5 ? 0 : blink(s2.time, 1.8, 0.4) ? 1 : 0.1);
      });
      const gh = c.n['fx:ghost'];
      if (gh) {
        gh.visible = sub > 0.35;
        const k = 0.75 + 0.25 * sub + 0.04 * Math.sin(s.time * 3);
        gh.scale.set(k, 1, k);
      }
    },
  });
}

function shadeDeck(): Mat {
  return { c: 0x3a3e42, m: 0.2, r: 0.75, d: 1, uv: 3 };
}

// =============================================================================================
// Naval structures: Shipyard (Allied) and Sub Pen (Soviet). 3x3, sit on the water (y = 0).
// =============================================================================================

/** Concrete platform on pilings reaching into the seabed. */
function platform(nb: NB, x: number, z: number, w: number, d: number, top = 0.1, mat: Mat = M.concrete): void {
  nb.box(mat, w, 0.08, d, x, top - 0.04, z, { b: 0.012 });
  nb.box(M.concreteDark, w + 0.01, 0.025, d + 0.01, x, top - 0.085, z, { b: 0.006 });
  // pilings: only their tops show above the water, so keep them cheap (4-sided, open ends)
  const nx = Math.max(2, Math.round(w / 0.45));
  const nz = Math.max(2, Math.round(d / 0.45));
  for (let i = 0; i < nx; i++) {
    for (let k = 0; k < nz; k++) {
      if (i > 0 && i < nx - 1 && k > 0 && k < nz - 1) continue;
      const px = x - w / 2 + 0.05 + ((w - 0.1) * i) / (nx - 1);
      const pz = z - d / 2 + 0.05 + ((d - 0.1) * k) / (nz - 1);
      nb.cyl(PILING, 0.03, 0.034, 0.6, px, top - 0.08 - 0.3, pz, { seg: 4, open: true });
      nb.cyl(SEAWEED, 0.036, 0.036, 0.04, px, -0.005, pz, { seg: 4, open: true });
    }
  }
}

/** Gantry crane straddling a slipway: legs at x = ±span/2, beam along X; the engine animates its z. */
function gantryCrane(nb: NB, name: string, x: number, z: number, y0: number, span: number, h: number): void {
  const c = nb.node(name, [x, y0, z]);
  for (const s of [-1, 1]) {
    const lx = (span / 2) * s;
    for (const dz of [-0.07, 0.07]) c.box(M.yellow, 0.028, h, 0.028, lx, h / 2, dz, { b: 0.004 });
    c.box(M.yellow, 0.035, 0.03, 0.2, lx, 0.015, 0, { b: 0.005 });
    for (const dz of [-0.08, 0.08]) c.box(GREY_DARK, 0.045, 0.025, 0.045, lx, 0.012, dz, { b: 0.003 });
    for (let i = 1; i < 4; i++) c.box(M.yellow, 0.012, 0.012, 0.17, lx, (h * i) / 4, 0, { b: 0, r: [i % 2 ? 0.75 : -0.75, 0, 0] });
  }
  // twin box girders + walkway
  for (const dz of [-0.05, 0.05]) c.box(M.yellow, span + 0.1, 0.06, 0.035, 0, h + 0.03, dz, { b: 0.006 });
  c.box(GREY_DARK, span + 0.1, 0.006, 0.07, 0, h + 0.063, 0, { b: 0 });
  hazard(c, span * 0.6, 0.025, [0, h + 0.02, 0.0685]);
  // operator cab hanging under one end
  c.box(M.yellow, 0.08, 0.06, 0.07, (span / 2 - 0.08), h - 0.05, 0.09, { b: 0.008 });
  c.box(M.glassBlue, 0.07, 0.03, 0.004, (span / 2 - 0.08), h - 0.045, 0.126, { b: 0 });
  c.sph(G.amber, 0.012, -span / 2, h + 0.08, 0, { seg: 4, slot: 'glow:blink' });
  // trolley travels along the beam (x)
  const trol = c.node(name + 'T', [0, h + 0.005, 0]);
  trol.box(GREY_DARK, 0.1, 0.035, 0.14, 0, 0, 0, { b: 0.006 });
  for (const dz of [-0.02, 0.02]) trol.cyl(M.steel, 0.002, 0.002, 0.28, 0, -0.15, dz, { seg: 3 });
  trol.box(M.dark, 0.04, 0.025, 0.06, 0, -0.3, 0, { b: 0.004 });
  trol.box(M.team, 0.16, 0.04, 0.12, 0, -0.335, 0, { b: 0.006 });
}

/** Partly plated hull under construction on the slipway (bow toward +Z), with scaffolding. */
function hullUnderConstruction(nb: NB, z: number, y: number): void {
  const hb = new NB('_hb', [0, y, z], [0, -Math.PI / 2, 0.06]);
  const st = hullStations({ L: 1.25, B: 0.34, free: 0.1, sheer: 0.04, draft: 0.08, bow: 0.15, stern: 0.72, rake: 0.14, n: 14 });
  // plated forward part (stations 4..), ribs exposed aft
  const fwd = st.slice(5);
  hb.add(hullBand(fwd, 0, 5), HULL);
  hb.add(hullBand(st.slice(0, 6), 3, 5), ANTIFOUL);
  hb.add(hullDeck(fwd), DECK, { p: [0, 0.001, 0] });
  for (let i = 0; i < 6; i += 2) {
    const s = st[i];
    const x = s.x[0];
    for (const side of [-1, 1]) {
      for (let j = 0; j < 5; j++) {
        const y0 = s.y[j];
        const y1 = s.y[j + 1];
        const z0 = s.z[j] * side;
        const z1 = s.z[j + 1] * side;
        const len = Math.hypot(y1 - y0, z1 - z0);
        hb.box(RUST, 0.012, len, 0.012, x, (y0 + y1) / 2, (z0 + z1) / 2, { b: 0, r: [Math.atan2(z1 - z0, y1 - y0), 0, 0] });
      }
    }
    hb.box(RUST, 0.012, 0.012, s.z[0] * 2, x, s.y[0], 0, { b: 0 });
  }
  // keel blocks + scaffolding towers along the sides
  for (let i = 0; i < 6; i++) hb.box(PILING, 0.05, 0.08, 0.1, -0.5 + i * 0.2, -0.09, 0, { b: 0.006 });
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const sx = -0.45 + i * 0.4;
      hb.box(M.steel, 0.008, 0.2, 0.008, sx, 0.02, 0.22 * side, { b: 0 });
      hb.box(M.steel, 0.008, 0.2, 0.008, sx + 0.12, 0.02, 0.22 * side, { b: 0 });
      for (const yy of [-0.04, 0.05, 0.11]) hb.box(M.wood, 0.14, 0.006, 0.04, sx + 0.06, yy, 0.22 * side, { b: 0 });
    }
  }
  hb.sph(G.cyan, 0.016, -0.32, 0.06, 0.14, { seg: 4, slot: 'glow:weld' });
  hb.sph(G.cyan, 0.014, 0.1, 0.11, -0.15, { seg: 4, slot: 'glow:weld' });
  mergeChild(nb, hb);
}

function shipyard(): ModelTemplate {
  const r = new NB('root');
  const top = 0.1;
  // U-shaped dock around a central slipway basin open to +Z (ships exit toward +Z)
  platform(r, -1.12, -0.05, 0.66, 2.8, top);
  platform(r, 1.12, -0.05, 0.66, 2.8, top);
  platform(r, 0, -1.2, 1.58, 0.5, top);
  // slipway: inclined concrete ramp running into the water, rails and keel track
  const sw = new NB('_slip', [0, 0.02, -0.3], [-0.065, 0, 0]);
  sw.box(M.concreteDark, 0.92, 0.05, 1.6, 0, 0, 0, { b: 0.01 });
  for (let i = 0; i < 8; i++) sw.box(M.steel, 0.88, 0.01, 0.022, 0, 0.03, -0.72 + i * 0.205, { b: 0 });
  for (const s of [-1, 1]) sw.box(M.dark, 0.03, 0.02, 1.6, 0.34 * s, 0.035, 0, { b: 0 });
  sw.box(M.yellow, 0.05, 0.012, 1.6, 0, 0.032, 0, { b: 0 });
  mergeChild(r, sw);
  hullUnderConstruction(r, -0.35, 0.2);
  // fabrication hall at the head of the slip (team roof, big doors facing the slip)
  const hz = -1.2;
  r.box(M.concreteLight, 1.5, 0.42, 0.46, 0, top + 0.21, hz, { b: 0.02 });
  for (let i = 0; i < 3; i++) {
    const x = -0.5 + i * 0.5;
    r.add(new THREE.CylinderGeometry(0.25, 0.25, 0.5, 8, 1, false, -Math.PI / 2, Math.PI), M.team, {
      p: [x, top + 0.42, hz],
      r: [-Math.PI / 2, 0, 0],
      s: [1, 1, 0.42],
    });
    r.box(M.glassBlue, 0.08, 0.012, 0.42, x, top + 0.53, hz, { b: 0.003 });
  }
  r.box(M.darker, 0.7, 0.32, 0.02, 0, top + 0.16, hz + 0.232, { b: 0 });
  for (let i = 0; i < 6; i++) r.box(M.teamDark, 0.68, 0.01, 0.022, 0, top + 0.3 - i * 0.05, hz + 0.24, { b: 0 });
  hazard(r, 0.76, 0.035, [0, top + 0.35, hz + 0.236]);
  windows(r, 2, 0.08, 0.06, 0.05, [-0.58, top + 0.28, hz + 0.232]);
  windows(r, 2, 0.08, 0.06, 0.05, [0.58, top + 0.28, hz + 0.232], [0, 0, 0], G.window, 'glow', [1]);
  alliedStar(r, 0.07, [-0.58, top + 0.13, hz + 0.236], faceRot('+z'));
  // offices & control tower on the left pier
  r.box(M.concreteLight, 0.48, 0.3, 0.62, -1.12, top + 0.15, -0.55, { b: 0.02 });
  r.box(M.team, 0.52, 0.035, 0.66, -1.12, top + 0.3, -0.55, { b: 0.012 });
  windows(r, 3, 0.09, 0.07, 0.05, [-1.12, top + 0.2, -0.237]);
  windows(r, 4, 0.09, 0.07, 0.05, [-0.877, top + 0.2, -0.55], [0, Math.PI / 2, 0], G.window, 'glow', [0, 2, 3]);
  r.box(M.darker, 0.14, 0.18, 0.02, -1.24, top + 0.09, -0.235, { b: 0 });
  lamp(r, G.warm, [-1.24, top + 0.21, -0.22], 0.014);
  r.box(M.concrete, 0.22, 0.32, 0.22, -1.2, top + 0.46, -0.7, { b: 0.012 });
  r.box(M.glassBlue, 0.24, 0.08, 0.24, -1.2, top + 0.64, -0.7, { b: 0.006 });
  windows(r, 2, 0.08, 0.06, 0.03, [-1.2, top + 0.64, -0.578]);
  r.box(M.team, 0.26, 0.025, 0.26, -1.2, top + 0.693, -0.7, { b: 0.006 });
  antenna(r, -1.25, top + 0.7, -0.75, 0.32);
  r.sph(G.red, 0.014, -1.12, top + 0.72, -0.62, { seg: 4, slot: 'glow:blink' });
  // pier rails for the gantry
  for (const s of [-1, 1]) {
    platform(r, 0.6 * s, -0.3, 0.14, 1.4, top, M.concreteDark);
    r.box(M.dark, 0.025, 0.012, 1.4, 0.6 * s, top + 0.004, -0.3, { b: 0 });
  }
  gantryCrane(r, 'gantry', 0, -0.25, top, 1.2, 0.62);
  // crane tower on the right pier (rotating jib)
  const cx = 1.12;
  const cz = 0.1;
  r.box(M.concreteDark, 0.2, 0.05, 0.2, cx, top + 0.025, cz, { b: 0.01 });
  for (const [dx, dz] of [[-0.05, -0.05], [0.05, -0.05], [-0.05, 0.05], [0.05, 0.05]]) r.box(M.yellow, 0.02, 0.62, 0.02, cx + dx, top + 0.36, cz + dz, { b: 0.003 });
  for (let i = 0; i < 5; i++) for (const s of [-1, 1]) r.box(M.yellow, 0.1, 0.008, 0.008, cx, top + 0.1 + i * 0.12, cz + 0.05 * s, { b: 0, r: [0, 0, i % 2 ? 0.7 : -0.7] });
  const jib = r.node('jib', [cx, top + 0.68, cz], [0, 2.2, 0]);
  jib.box(M.yellow, 0.13, 0.08, 0.13, 0, 0.0, 0, { b: 0.01 });
  jib.box(M.glassBlue, 0.05, 0.04, 0.06, 0.05, 0.0, 0.05, { b: 0.005 });
  jib.box(M.yellow, 0.85, 0.035, 0.035, 0.42, 0.06, 0, { b: 0.005 });
  for (let i = 0; i < 7; i++) jib.box(M.yellow, 0.008, 0.05, 0.008, 0.1 + i * 0.11, 0.035, 0, { b: 0, r: [0, 0, i % 2 ? 0.6 : -0.6] });
  jib.box(M.concreteDark, 0.12, 0.09, 0.09, -0.15, 0.02, 0, { b: 0.01 });
  jib.cyl(M.steel, 0.002, 0.002, 0.4, 0.76, -0.16, 0, { seg: 3 });
  jib.box(M.olive, 0.12, 0.07, 0.07, 0.76, -0.38, 0, { b: 0.01 });
  jib.sph(G.red, 0.012, 0.85, 0.09, 0, { seg: 4, slot: 'glow:blink' });
  // containers, fuel tanks, steel plate stacks
  r.box(M.team, 0.24, 0.1, 0.1, 1.12, top + 0.05, 0.75, { b: 0.008 });
  r.box(M.olive, 0.24, 0.1, 0.1, 1.12, top + 0.15, 0.75, { b: 0.008 });
  r.box(M.red, 0.24, 0.1, 0.1, 1.12, top + 0.05, 0.62, { b: 0.008 });
  for (const z of [-0.55, -0.8]) {
    r.cyl(M.offwhite, 0.09, 0.09, 0.22, 1.15, top + 0.11, z, { seg: 10 });
    r.cyl(M.team, 0.092, 0.092, 0.03, 1.15, top + 0.16, z, { seg: 10, open: true });
  }
  for (let i = 0; i < 3; i++) r.box(M.steel, 0.3, 0.02, 0.2, -1.1, top + 0.01 + i * 0.021, 0.45 + i * 0.01, { b: 0.003 });
  r.box(M.wood, 0.16, 0.06, 0.16, -1.05, top + 0.03, 0.85, { b: 0.008 });
  hazard(r, 0.6, 0.03, [1.12, top + 0.004, 1.15], [-Math.PI / 2, 0, 0]);
  hazard(r, 0.6, 0.03, [-1.12, top + 0.004, 1.15], [-Math.PI / 2, 0, 0]);
  // dock edges: bollards + fenders, harbour lights at the pier heads
  for (const s of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const zz = -0.85 + i * 0.5;
      r.cyl(GREY_DARK, 0.012, 0.015, 0.025, 0.82 * s, top + 0.012, zz, { seg: 6 });
      r.box(M.rubber, 0.03, 0.06, 0.05, 0.8 * s, top - 0.05, zz + 0.12, { b: 0 });
    }
    const lx = 1.3 * s;
    r.cyl(M.white, 0.03, 0.035, 0.3, lx, top + 0.15, 1.2, { seg: 8 });
    r.cyl(M.red, 0.036, 0.036, 0.05, lx, top + 0.22, 1.2, { seg: 8, open: true });
    r.cyl(M.dark, 0.04, 0.04, 0.01, lx, top + 0.3, 1.2, { seg: 8 });
    r.sph(s > 0 ? G.green : G.red, 0.022, lx, top + 0.33, 1.2, { seg: 6, slot: 'glow:harbour' });
  }
  // floodlight masts
  for (const [x, z] of [
    [-0.8, -0.85],
    [0.8, -0.85],
  ]) {
    r.cyl(M.gun, 0.012, 0.016, 0.62, x, top + 0.31, z, { seg: 6 });
    r.box(M.dark, 0.08, 0.03, 0.03, x, top + 0.62, z + 0.02, { b: 0.005 });
    r.box(G.warm, 0.06, 0.012, 0.004, x, top + 0.62, z + 0.036, { b: 0, slot: 'glow' });
  }
  r.cyl(M.concreteLight, 0.045, 0.055, 0.2, 0.55, top + 0.52, -1.3, { seg: 8 });
  r.cyl(M.team, 0.058, 0.058, 0.03, 0.55, top + 0.58, -1.3, { seg: 8, open: true });
  r.node('smoke0', [0.55, top + 0.64, -1.3]);

  return makeTemplate({
    root: r,
    height: 1.0,
    radius: 1.55,
    muzzles: [],
    smoke: ['smoke0'],
    glow: { glow: 1.6, 'glow:blink': 5, 'glow:weld': 6, 'glow:harbour': 4 },
    anim: navalStructAnim((c, s) => {
      const busy = s.door > 0.02 || s.load > 0.05;
      const t = s.time + c.v.seed;
      c.n.gantry.position.z = -0.3 + Math.sin(t * 0.21) * 0.5;
      c.n.gantryT.position.x = Math.sin(t * 0.37 + 1) * 0.42;
      c.n.jib.rotation.y = 2.2 + Math.sin(t * 0.17) * 0.9;
      c.setGlow('glow:weld', s.powered ? (Math.sin(s.time * (busy ? 41 : 23)) > (busy ? 0.25 : 0.7) ? 1 : 0.1) : 0);
      c.setGlow('glow:harbour', s.powered ? (blink(t, 2.2, 0.6) ? 1 : 0.2) : 0.05);
    }),
  });
}

function subPen(): ModelTemplate {
  const r = new NB('root');
  const top = 0.1;
  const roofY = 0.5;
  const zb = -0.75; // back of the bays
  const zf = 1.3; // front face
  const bayD = zf - zb;
  const bays: [number, number][] = [
    [-0.64, 0.98],
    [0.64, 0.98],
  ];
  // walls between / beside the bays (concrete on pilings)
  for (const [x, w] of [
    [-1.27, 0.26],
    [0, 0.3],
    [1.27, 0.26],
  ] as [number, number][]) {
    platform(r, x, (zb + zf) / 2, w, bayD, top, M.concreteDark);
    r.box(M.concrete, w, roofY - top, bayD, x, top + (roofY - top) / 2, (zb + zf) / 2, { b: 0.02 });
  }
  // back block with the command tower
  platform(r, 0, -1.12, 2.8, 0.72, top, M.concreteDark);
  r.box(M.concrete, 2.8, roofY - top, 0.72, 0, top + (roofY - top) / 2, -1.12, { b: 0.02 });
  // roof: thick slab + "Fangrost" beam grid
  r.box(M.concreteLight, 2.86, 0.09, bayD + 0.74, 0, roofY + 0.045, (zb + zf) / 2 - 0.37, { b: 0.03 });
  for (let i = 0; i < 6; i++) r.box(M.concrete, 2.8, 0.07, 0.11, 0, roofY + 0.125, -1.3 + i * 0.5, { b: 0.015 });
  for (const x of [-1.27, 0, 1.27]) r.box(M.concrete, 0.13, 0.07, 2.6, x, roofY + 0.125, -0.07, { b: 0.015 });
  r.box(M.team, 2.9, 0.035, 0.06, 0, roofY + 0.03, zf + 0.01, { b: 0.008 });
  // painted star on the roof (Soviet)
  sovietStar(r, 0.36, [0.64, roofY + 0.161, 0.2]);
  r.add(discGeoFlat(0.5), M.concreteDark, { p: [0.64, roofY + 0.159, 0.2] });
  // command tower (back left) with windows and an observation deck
  const tx = -0.9;
  const tz = -1.1;
  r.box(M.concrete, 0.5, 0.36, 0.42, tx, roofY + 0.27, tz, { b: 0.02 });
  r.box(M.team, 0.54, 0.035, 0.46, tx, roofY + 0.46, tz, { b: 0.01 });
  windows(r, 3, 0.08, 0.05, 0.05, [tx, roofY + 0.36, tz + 0.212]);
  windows(r, 3, 0.08, 0.05, 0.05, [tx + 0.252, roofY + 0.36, tz], [0, Math.PI / 2, 0], G.window, 'glow', [0, 2]);
  r.box(M.gun, 0.16, 0.08, 0.16, tx - 0.08, roofY + 0.52, tz - 0.05, { b: 0.01 });
  antenna(r, tx + 0.15, roofY + 0.48, tz - 0.12, 0.42);
  antenna(r, tx - 0.15, roofY + 0.48, tz + 0.12, 0.3);
  r.sph(G.red, 0.014, tx - 0.08, roofY + 0.58, tz - 0.05, { seg: 4, slot: 'glow:blink' });
  // AA positions with sandbag rings on the roof
  for (const [ax, az] of [
    [0.95, -1.1],
    [-0.2, 0.9],
  ]) {
    r.add(ringGeoFlat(0.13, 0.17, 0.05), M.sand, { p: [ax, roofY + 0.18, az] });
    r.cyl(M.gun, 0.05, 0.06, 0.04, ax, roofY + 0.18, az, { seg: 8 });
    for (const s of [-1, 1]) r.cyl(M.dark, 0.005, 0.005, 0.15, ax + 0.05, roofY + 0.25, az + 0.012 * s, { r: [0, 0, -1.1], seg: 4 });
  }
  // vent shafts
  for (const [vx, vz] of [
    [0.3, -1.1],
    [0.55, -1.1],
    [-0.4, -0.2],
  ]) {
    r.cyl(M.gun, 0.045, 0.05, 0.07, vx, roofY + 0.195, vz, { seg: 8 });
    r.cyl(M.darker, 0.04, 0.04, 0.004, vx, roofY + 0.232, vz, { seg: 8 });
  }
  // bay entrances: lintels, hazard stripes, shutter doors, interior
  for (const [i, [bx, bw]] of bays.entries()) {
    r.box(M.concreteDark, bw + 0.04, 0.08, 0.06, bx, roofY - 0.04, zf, { b: 0.01 });
    hazard(r, bw, 0.03, [bx, roofY - 0.05, zf + 0.032]);
    // dark interior, ceiling lamps, catwalk
    r.box(M.darker, bw, roofY - top, 0.02, bx, top + (roofY - top) / 2, zb + 0.01, { b: 0 });
    r.box(M.darker, bw, 0.01, bayD, bx, roofY - 0.005, (zb + zf) / 2, { b: 0 });
    for (const zz of [-0.3, 0.4]) r.box(G.warm, 0.4, 0.01, 0.035, bx, roofY - 0.012, zz, { b: 0, slot: 'glow' });
    r.box(M.concreteLight, 0.1, 0.02, bayD - 0.1, bx + (bw / 2 - 0.05) * (i ? 1 : -1), top + 0.01, (zb + zf) / 2, { b: 0.004 });
    const door = r.node(`door${i}`, [bx, roofY - 0.08, zf - 0.03]);
    const dh = roofY - top - 0.1;
    door.box(GREY_DARK, bw - 0.04, dh, 0.03, 0, -dh / 2, 0, { b: 0.004 });
    for (let k = 0; k < 6; k++) door.box(M.gun, bw - 0.06, 0.012, 0.036, 0, -0.035 - k * 0.055, 0, { b: 0 });
    door.box(M.team, bw - 0.04, 0.025, 0.04, 0, -dh + 0.012, 0, { b: 0 });
  }
  // docked sub in the right bay
  r.add(lathe([[0, -0.55], [0.06, -0.48], [0.085, -0.2], [0.085, 0.3], [0.06, 0.5], [0, 0.58]], 10), HULL_SUB, { p: [0.64, -0.01, 0.15], r: [Math.PI / 2, 0, 0], s: [1, 1, 0.72] });
  r.box(HULL_SUB, 0.05, 0.11, 0.17, 0.64, 0.09, 0.1, { b: 0.01 });
  // pier extensions toward +Z with bollards & lights
  for (const s of [-1, 1]) {
    platform(r, 1.27 * s, zf + 0.12, 0.26, 0.26, top, M.concreteDark);
    r.cyl(GREY_DARK, 0.016, 0.02, 0.03, 1.27 * s, top + 0.015, zf + 0.15, { seg: 6 });
    lamp(r, G.red, [1.36 * s, top + 0.03, zf + 0.2], 0.016, 'glow:blink');
    sovietStar(r, 0.12, [1.402 * s, top + 0.2, 0.3], faceRot(s > 0 ? '+x' : '-x'));
  }
  ladder(r, roofY - top, [-1.402, top, -0.4], -Math.PI / 2);
  r.node('smoke0', [-0.4, roofY + 0.25, -0.2]);

  return makeTemplate({
    root: r,
    height: 1.05,
    radius: 1.55,
    muzzles: [],
    smoke: ['smoke0'],
    glow: { glow: 1.6, 'glow:blink': 5 },
    anim: navalStructAnim((c, s) => {
      const d2 = Math.min(1, Math.max(0, s.door));
      // both shutters roll up together (the unit leaves through either bay)
      const k = Math.max(0.05, 1 - d2 * 0.95);
      c.n.door0.scale.y = k;
      c.n.door1.scale.y = k;
    }),
  });
}

/** Thin flat disc (paint backdrop) lying in XZ. */
function discGeoFlat(r: number): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(r, 16);
  g.rotateX(-Math.PI / 2);
  return g;
}

/** Low ring (sandbag wall) around Y. */
function ringGeoFlat(rIn: number, rOut: number, h: number): THREE.BufferGeometry {
  return lathe(
    [
      [rIn, 0],
      [rOut, 0],
      [rOut * 0.96, h],
      [rIn * 1.04, h],
      [rIn, 0],
    ],
    12,
  );
}


function navalStructAnim(extra: (c: Ctx, s: ModelAnimState, dt: number) => void) {
  return (c: Ctx, s: ModelAnimState) => {
    healthVariant(c, s);
    if (c.v.seed === undefined) c.v.seed = Math.random() * 3;
    c.setPowered(s.powered);
    c.setGlow('glow:blink', s.powered ? (blink(s.time + c.v.seed, 1.6, 0.3) ? 1 : 0.06) : 0.04);
    extra(c, s, dtOf(s));
  };
}

export const NAVAL_BUILDERS: Record<string, () => ModelTemplate> = {
  syrd: shipyard,
  spen: subPen,
  pt: gunboat,
  dd: destroyer,
  ca: cruiser,
  lst: transport,
  ss: submarine,
};
