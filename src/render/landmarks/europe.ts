/**
 * European landmarks. Each builder models its landmark at the agreed footprint (src/sim/landmarks.ts), front to +z
 * (south, towards the default camera). Silhouette and proportions first; the 'high' detail adds lattice, windows,
 * ornament.
 */
import * as THREE from 'three';
import type { Mat, NB, V3 } from '../models/builder';
import type { LandmarkBuilder, LCtx } from './common';
import { mound, scaledInto } from './common';
import {
  LAMP, P, Poly, WIN, archWallGeo, arcade, colouredLathe, column, cypress, ellipse, fbm2, gable, heightField, hip, lattice, latheGeo, lin,
  mixc, noise2, onionProfile, put, rng, robedFigure, spire, tint, tree, windowGrid, type ArchOpening,
} from './kit';

// ---------------------------------------------------------------------------------------------------------
// Eiffel Tower (4 x 4, 10 tall): four curved lattice legs joined by the great arches, three platforms, the shaft
// ---------------------------------------------------------------------------------------------------------

const EIFFEL_IRON = { c: 0x84684a, m: 0.3, r: 0.62, d: 0 };

/** Built at full size (4-cell base, 10.3 tall) and scaled to 0.7: the top stays on screen at the default zoom. */
function eiffel(k: LCtx): void {
  scaledInto(k.nb, 0.7, (nb) => eiffelFull(nb, k.hi));
}

/** Golden light strings: the tower's night outline (by day they read as gilded edges). */
const EIFFEL_LIGHTS = { glow: 0xffc468, i: 1.1 };

function eiffelFull(nb: NB, hi: boolean): void {
  const H = 10.1;
  // half-width of the tower's outline at height y (the famous exponential curve)
  const hw = (y: number) => 0.17 + 1.78 * Math.exp(-y / 2.15) - 0.006 * y;
  // width of each leg (square section) below the second platform, where the legs merge
  const lw = (y: number) => 0.62 - 0.07 * y;
  const p1 = 1.85, p2 = 3.75, p3 = 8.85;
  const iron = new Poly();
  const chord = hi ? 0.05 : 0.07;
  const brace = hi ? 0.022 : 0.035;
  // legs: one lattice column per corner, in segments following the curve
  const legCuts = hi ? [0.12, 0.95, p1, 2.8, p2] : [0.12, p1, p2];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    for (let s = 0; s < legCuts.length - 1; s++) {
      const loop = (y: number): V3[] => {
        const o = hw(y), i = o - lw(y);
        // corners of the leg square, counter-clockwise from above
        const pts: [number, number][] = [[i, i], [o, i], [o, o], [i, o]].map(([a, b]) => [a * sx, b * sz]);
        return pts.map(([x, z]) => [x, y, z] as V3);
      };
      lattice(iron, loop(legCuts[s]), loop(legCuts[s + 1]), hi ? 5 : 1, chord, brace, true);
    }
    // masonry pier under each leg
    iron.box(sx * (hw(0) - lw(0) / 2), -0.05, sz * (hw(0) - lw(0) / 2), lw(0) + 0.1, 0.2, lw(0) + 0.1);
  }
  // the shaft above the second platform: one lattice column
  const shaftCuts = hi ? [p2, 5.0, 6.3, 7.6, p3] : [p2, 6.2, p3];
  const sq = (y: number, f = 1): V3[] => {
    const o = hw(y) * f;
    return [[-o, y, o], [o, y, o], [o, y, -o], [-o, y, -o]];
  };
  for (let s = 0; s < shaftCuts.length - 1; s++) lattice(iron, sq(shaftCuts[s]), sq(shaftCuts[s + 1]), hi ? 4 : 1, chord * 0.9, brace, true);
  // the great arches between the legs under the first platform, on all four faces: a girder of two arcs and a web
  const archN = hi ? 12 : 6;
  for (let f = 0; f < 4; f++) {
    const arc = (lift: number, inset: number): V3[] => {
      const pts: V3[] = [];
      for (let i = 0; i <= archN; i++) {
        const t = i / archN;
        const x = -1.3 + 2.6 * t;
        const y = 0.5 + lift + (1.0 - lift * 0.6) * Math.sin(t * Math.PI) ** 0.75;
        const z = hw(y) - 0.06 - inset;
        pts.push(f === 0 ? [x, y, z] : f === 1 ? [z, y, -x] : f === 2 ? [-x, y, -z] : [-z, y, x]);
      }
      return pts;
    };
    const lo = arc(0, 0), up = arc(0.22, 0.02);
    for (let i = 0; i < archN; i++) {
      iron.beam(lo[i], lo[i + 1], hi ? 0.1 : 0.12, 0.08);
      iron.beam(up[i], up[i + 1], hi ? 0.07 : 0.09, 0.06);
      iron.beam(lo[i], up[i + 1], hi ? 0.035 : 0.05);
      if (hi) iron.beam(up[i], lo[i + 1], 0.035);
    }
  }
  // platforms: first (a gallery all round), second, and the small top platform with the lantern
  const deck = (y: number, w: number, h: number) => iron.box(0, y, 0, w, h, w);
  deck(p1 - 0.08, 2 * hw(p1) + 0.16, 0.2);
  deck(p1 + 0.12, 2 * hw(p1) + 0.06, 0.12);
  deck(p2 - 0.05, 2 * hw(p2) + 0.12, 0.14);
  deck(p3 - 0.04, 2 * hw(p3) + 0.18, 0.12);
  // campanile: the top lantern, the beacon housing and the antenna mast
  iron.box(0, p3 + 0.08, 0, 0.22, 0.45, 0.22);
  iron.frustum(0, p3 + 0.53, 0, 0.26, 0.26, 0.08, 0.08, 0.2);
  iron.beam([0, p3 + 0.7, 0], [0, H + 0.25, 0], 0.035);
  put(nb, iron, EIFFEL_IRON);
  // night lights: platform windows (restaurants) and the beacon
  if (hi) {
    for (let r = 0; r < 4; r++) {
      const ry = (r * Math.PI) / 2;
      windowGrid(nb, 9, 1, 0.12, 0.06, -hw(p1) + 0.18, hw(p1) - 0.18, p1 + 0.18, p1 + 0.18, hw(p1) + 0.031, ry, WIN);
      windowGrid(nb, 5, 1, 0.09, 0.05, -hw(p2) + 0.1, hw(p2) - 0.1, p2 + 0.03, p2 + 0.03, hw(p2) + 0.061, ry, WIN);
    }
  }
  // light strings along the four corner edges and round the platforms
  const lights = new Poly();
  const n = hi ? 24 : 10;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    for (let i = 0; i < n; i++) {
      const y0 = 0.2 + ((p3 - 0.2) * i) / n, y1 = 0.2 + ((p3 - 0.2) * (i + 1)) / n;
      lights.beam([sx * (hw(y0) + 0.03), y0, sz * (hw(y0) + 0.03)], [sx * (hw(y1) + 0.03), y1, sz * (hw(y1) + 0.03)], 0.04);
    }
  }
  for (const [y, w] of [[p1 + 0.13, hw(p1) + 0.09], [p2 + 0.1, hw(p2) + 0.07]] as const) {
    lights.box(0, y, w, 2 * w, 0.04, 0.04).box(0, y, -w, 2 * w, 0.04, 0.04).box(w, y, 0, 0.04, 0.04, 2 * w).box(-w, y, 0, 0.04, 0.04, 2 * w);
  }
  put(nb, lights, EIFFEL_LIGHTS);
  const beacon = new Poly();
  beacon.box(0, p3 + 0.3, 0, 0.24, 0.12, 0.24);
  put(nb, beacon, LAMP);
}


// ---------------------------------------------------------------------------------------------------------
// shared bits
// ---------------------------------------------------------------------------------------------------------

/** A window-pane quad facing +z in a facade's frame (x, y = centre, w x h), at depth z0. */
function pane(p: Poly, x: number, y: number, w: number, h: number, z0: number): void {
  p.quad([x - w / 2, y - h / 2, z0], [x + w / 2, y - h / 2, z0], [x + w / 2, y + h / 2, z0], [x - w / 2, y + h / 2, z0]);
}

/** Pointed (Gothic) window pane: a rectangle with a triangle head. */
function gothicPane(p: Poly, x: number, y: number, w: number, h: number, z0: number): void {
  pane(p, x, y, w, h, z0);
  p.tri([x - w / 2, y + h / 2, z0], [x + w / 2, y + h / 2, z0], [x, y + h / 2 + w * 0.8, z0]);
}

/** Run `fn` once per side of a square / rectangle: the soups are built in each face's frame (local +z outward). */
function perFace(polys: Poly[], hx: number, hz: number, fn: (face: number, half: number) => void, cx = 0, cz = 0, y0 = 0): void {
  for (let f = 0; f < 4; f++) {
    const ry = [0, Math.PI / 2, Math.PI, -Math.PI / 2][f];
    const d = f % 2 === 0 ? hz : hx;
    const m = new THREE.Matrix4().makeRotationY(ry);
    const off = new THREE.Vector3(0, 0, d).applyMatrix4(m);
    m.setPosition(cx + off.x, y0, cz + off.z);
    for (const p of polys) p.xf = m;
    fn(f, f % 2 === 0 ? hx : hz);
  }
  for (const p of polys) p.xf = null;
}

// ---------------------------------------------------------------------------------------------------------
// Big Ben (5 x 3, 7 tall): the Elizabeth Tower (front right) with its four great dials, belfry and iron spire,
// beside the Gothic north wing of the Palace of Westminster with its central spire and a corner tower
// ---------------------------------------------------------------------------------------------------------

const ANSTON = { c: 0xcdb98c, m: 0, r: 0.88, d: 1 as const };
const ANSTON_DARK = { c: 0xa8946a, m: 0, r: 0.9, d: 1 as const };
const IRON_ROOF = { c: 0x3c4850, m: 0.45, r: 0.55, d: 0 as const };

function bigBen(k: LCtx): void {
  const { nb, hi } = k;
  const st = new Poly(), dk = new Poly(), roof = new Poly(), gold = new Poly(), win = new Poly(), black = new Poly();
  // the Palace of Westminster's river front: a long Gothic facade of slim buttresses, each crowned by a pinnacle,
  // three tiers of windows, a steep roof with turrets, the central lantern spire behind
  const px = -0.05, pz = -0.15, pw = 2.75, pd = 1.9, ph = 1.3;
  st.box(px, -0.25, pz, pw, ph + 0.25, pd);
  hip(roof, px, ph, pz, pw - 0.1, pd - 0.12, 0.55, 0.0);
  const fz = pz + pd / 2;
  const bays = hi ? 18 : 9;
  for (let i = 0; i <= bays; i++) {
    const x = px - pw / 2 + (pw * i) / bays;
    dk.box(x, -0.1, fz + 0.025, 0.05, ph + 0.18, 0.06);
    if (hi) spire(nb, ANSTON, 0.032, 0.26, x, ph + 0.08, fz + 0.025, 4, Math.PI / 4);
    else dk.frustum(x, ph + 0.08, fz + 0.025, 0.06, 0.06, 0, 0, 0.2);
    if (i < bays) {
      const xc = x + pw / bays / 2;
      for (const y of [0.35, 0.72, 1.07]) gothicPane(win, xc, y, pw / bays * 0.45, 0.2, fz + 0.005);
    }
  }
  for (const x of [px - 1.0, px - 0.2, px + 0.6]) { // turrets along the roof
    st.ngon(x, ph, fz - 0.05, 0.07, 0.07, 0.42, 8);
    roof.ngon(x, ph + 0.42, fz - 0.05, 0.08, 0, 0.28, 8);
  }
  st.ngon(px + 0.2, ph + 0.25, pz - 0.15, 0.24, 0.22, 0.65, 8, Math.PI / 8); // the central lantern
  roof.ngon(px + 0.2, ph + 0.9, pz - 0.15, 0.25, 0, 1.0, 8, Math.PI / 8);
  // the Victoria Tower at the far end: tall and massive, with corner turrets and the flagstaff
  const vx = -1.95, vz = -0.3, vw = 1.0, vh = 4.35;
  st.box(vx, -0.25, vz, vw, vh + 0.25, vw);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    st.ngon(vx + sx * vw / 2, 0, vz + sz * vw / 2, 0.11, 0.1, vh + 0.4, 8, Math.PI / 8);
    roof.ngon(vx + sx * vw / 2, vh + 0.4, vz + sz * vw / 2, 0.12, 0, 0.3, 8, Math.PI / 8);
  }
  for (let i = 0; i < 5; i++) for (const s of [-1, 1]) dk.box(vx - 0.36 + i * 0.18, vh, vz + s * (vw / 2), 0.07, 0.1, 0.05);
  dk.beam([vx, vh, vz], [vx, vh + 0.65, vz], 0.025);
  for (let j = 0; j < 4; j++) for (const s of [-1, 1]) gothicPane(win, vx + s * 0.18, 0.9 + j * 0.85, 0.14, 0.5, vz + vw / 2 + 0.005);
  for (let j = 0; j < 3; j++) dk.box(vx, 1.2 + j * 1.0, vz + vw / 2 + 0.01, vw - 0.1, 0.05, 0.02);
  // the Elizabeth Tower
  const tx = 1.82, tz = 0.4, tw = 0.8;
  const shaftTop = 4.0;
  st.box(tx, -0.25, tz, tw, shaftTop + 0.25, tw);
  st.box(tx, -0.25, tz, tw + 0.14, 0.6, tw + 0.14); // plinth
  const clock0 = shaftTop, clockH = 0.86;
  st.box(tx, clock0, tz, tw + 0.14, clockH, tw + 0.14); // clock stage
  dk.box(tx, clock0 + clockH, tz, tw + 0.2, 0.08, tw + 0.2); // its cornice
  const bel0 = clock0 + clockH + 0.08;
  st.box(tx, bel0, tz, tw + 0.02, 0.45, tw + 0.02); // belfry
  // the iron spire: a steep pyramid with corner pinnacles, a lantern and the finial
  roof.frustum(tx, bel0 + 0.45, tz, tw + 0.08, tw + 0.08, 0.16, 0.16, 1.15);
  roof.box(tx, bel0 + 1.6, tz, 0.16, 0.18, 0.16);
  roof.frustum(tx, bel0 + 1.78, tz, 0.16, 0.16, 0, 0, 0.35);
  gold.box(tx, bel0 + 2.13, tz, 0.03, 0.12, 0.03);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    st.ngon(tx + sx * (tw / 2 + 0.06), clock0 + clockH, tz + sz * (tw / 2 + 0.06), 0.06, 0.06, 0.3, 6);
    roof.ngon(tx + sx * (tw / 2 + 0.06), clock0 + clockH + 0.3, tz + sz * (tw / 2 + 0.06), 0.07, 0, 0.35, 6);
  }
  // the four dials (white faces, gilded frames that glow at night, black hands), belfry openings, shaft panels
  // dials as discs facing out of each face (cylinders rotated to the face normal)
  for (let f = 0; f < 4; f++) {
    const ry = [0, Math.PI / 2, Math.PI, -Math.PI / 2][f];
    const n = new THREE.Vector3(0, 0, tw / 2 + 0.075).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry);
    const cy = clock0 + clockH * 0.5;
    nb.add(new THREE.CylinderGeometry(0.31, 0.31, 0.02, hi ? 24 : 12).rotateX(Math.PI / 2), { c: 0xf2efe4, m: 0, r: 0.5, d: 3 }, { p: [tx + n.x, cy, tz + n.z], r: [0, ry, 0] });
    nb.add(new THREE.TorusGeometry(0.33, 0.035, 4, hi ? 24 : 12), { glow: 0xffd890, i: 0.8 }, { p: [tx + n.x * 1.02, cy, tz + n.z * 1.02], r: [0, ry, 0] });
  }
  perFace([black, win, dk], tw / 2 + 0.08, tw / 2 + 0.08, () => {
    const cy = clock0 + clockH * 0.5;
    black.beam([0, cy, 0.01], [0.06, cy + 0.22, 0.01], 0.035, 0.01); // hour hand
    black.beam([0, cy, 0.012], [-0.17, cy + 0.12, 0.012], 0.025, 0.01); // minute hand
  }, tx, tz);
  perFace([dk, win], tw / 2 + 0.012, tw / 2 + 0.012, () => {
    for (let i = -1; i <= 1; i++) gothicPane(dk, i * 0.22, bel0 + 0.2, 0.12, 0.2, 0); // belfry openings
    for (let j = 0; j < (hi ? 6 : 3); j++) for (const i of [-1, 1]) gothicPane(win, i * 0.17, 0.6 + j * (hi ? 0.55 : 1.1), 0.08, 0.22, 0);
    if (hi) for (const i of [-1, 0, 1]) dk.box(i * 0.32, 0.3, 0.01, 0.035, shaftTop - 0.4, 0.03); // panel ribs
  }, tx, tz);
  put(nb, st, ANSTON);
  put(nb, dk, ANSTON_DARK);
  put(nb, roof, IRON_ROOF);
  put(nb, gold, P.gold);
  put(nb, black, P.black);
  put(nb, win, WIN);
}

// ---------------------------------------------------------------------------------------------------------
// Tower Bridge (10 x 3, a river under its middle 6 cells): two Gothic towers in the river with corner turrets and
// steep roofs, the high-level walkways between them, the bascule deck, the side spans hung from curved chains
// ---------------------------------------------------------------------------------------------------------

const TB_STONE = { c: 0xcfc6aa, m: 0, r: 0.88, d: 1 as const };
const TB_BLUE = { c: 0x4d86bb, m: 0.35, r: 0.5, d: 0 as const };
const TB_WHITE = { c: 0xe6eaee, m: 0.2, r: 0.5, d: 0 as const };

function towerBridge(k: LCtx): void {
  const { nb, hi } = k;
  const st = new Poly(), roof = new Poly(), blue = new Poly(), white = new Poly(), deck = new Poly(), win = new Poly(), gran = new Poly();
  const deckY = 0.62;
  for (const sx of [-1, 1]) {
    const x = sx * 1.85;
    gran.box(x, -1.0, 0, 1.35, 1.0 + deckY - 0.1, 1.95); // pier in the river
    // the tower: two masses either side of the roadway, joined above it
    for (const sz of [-1, 1]) st.box(x, deckY - 0.1, sz * 0.52, 0.95, 3.0, 0.42);
    st.box(x, deckY + 0.75, 0, 0.95, 2.15, 0.62);
    // corner turrets with spires, the steep central roof and its fleche
    for (const tx of [-1, 1]) for (const tz of [-1, 1]) {
      st.ngon(x + tx * 0.46, deckY - 0.1, tz * 0.72, 0.13, 0.12, 3.5, 8, Math.PI / 8);
      roof.ngon(x + tx * 0.46, deckY + 3.4, tz * 0.72, 0.15, 0, 0.55, 8, Math.PI / 8);
    }
    hip(roof, x, deckY + 2.9, 0, 0.95, 1.46, 0.75, 0.04);
    roof.ngon(x, deckY + 3.6, 0, 0.06, 0, 0.5, 6);
    // Gothic windows in tiers on the river faces (+z / -z) and the arch of the roadway
    for (const sz of [-1, 1]) {
      const zf = sz * 0.735;
      for (let j = 0; j < 3; j++) for (const ix of [-1, 1]) {
        const xx = x + ix * 0.2, yy = deckY + 0.8 + j * 0.7;
        if (sz > 0) gothicPane(win, xx, yy, 0.12, 0.3, zf);
        else win.quad([xx + 0.06, yy - 0.15, zf], [xx - 0.06, yy - 0.15, zf], [xx - 0.06, yy + 0.15, zf], [xx + 0.06, yy + 0.15, zf]);
      }
    }
  }
  // the high-level walkways (blue lattice girders with white bracing) at the top of the towers
  for (const sz of [-1, 1]) {
    const z = sz * 0.42, y0 = deckY + 2.45, y1 = deckY + 2.85;
    blue.beam([-1.4, y0, z], [1.4, y0, z], 0.08, 0.06);
    blue.beam([-1.4, y1, z], [1.4, y1, z], 0.08, 0.06);
    const n = hi ? 10 : 4;
    for (let i = 0; i < n; i++) {
      const xa = -1.4 + (2.8 * i) / n, xb = -1.4 + (2.8 * (i + 1)) / n;
      white.beam([xa, y0, z], [xb, y1, z], 0.035);
      if (hi) white.beam([xa, y1, z], [xb, y0, z], 0.03);
    }
  }
  blue.box(0, deckY + 2.43, 0, 2.8, 0.04, 0.9); // walkway floors
  // the bascule deck between the towers and the side spans to the shore abutments
  deck.box(0, deckY - 0.12, 0, 10.0, 0.14, 1.0);
  blue.box(0, deckY - 0.3, 0, 2.8, 0.18, 0.9); // bascule girders
  white.box(0, deckY + 0.02, 0.49, 10, 0.07, 0.03).box(0, deckY + 0.02, -0.49, 10, 0.07, 0.03); // parapets
  for (const sx of [-1, 1]) {
    // shore abutment towers (small, stone) and the curved suspension chains of the side spans
    st.box(sx * 4.35, -0.2, 0, 0.6, deckY + 1.15, 1.2);
    for (const tz of [-1, 1]) roof.ngon(sx * 4.35 + 0.2 * sx, deckY + 0.95, tz * 0.5, 0.1, 0, 0.35, 6);
    for (const sz of [-1, 1]) {
      const z = sz * 0.52;
      const pts: V3[] = [];
      const n = hi ? 12 : 6;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const x = sx * (2.35 + (4.1 - 2.35) * t);
        const y = deckY + 2.3 - 2.0 * t + 1.6 * t * t - 0.9 * Math.sin(t * Math.PI) * 0.55;
        pts.push([x, y, z]);
      }
      for (let i = 0; i < n; i++) {
        blue.beam(pts[i], pts[i + 1], 0.09, 0.07);
        if (hi && i > 0) white.beam(pts[i], [pts[i][0], deckY, z], 0.02);
      }
    }
    for (const sz of [-1, 1]) gran.box(sx * 3.2, -1.0, sz * 0.4, 0.3, 1.0 + deckY - 0.2, 0.3); // side-span piers
  }
  put(nb, st, TB_STONE);
  put(nb, gran, tint(P.granite, 0x9e978a));
  put(nb, roof, { c: 0x46525c, m: 0.3, r: 0.6, d: 3 });
  put(nb, blue, TB_BLUE);
  put(nb, white, TB_WHITE);
  put(nb, deck, P.dark);
  put(nb, win, WIN);
}

// ---------------------------------------------------------------------------------------------------------
// Colosseum (7 x 6, 2.2 tall): the elliptical outer wall of three arcades and the attic, broken away on the side
// facing the camera so the inner ring, the stepped cavea and the arena's exposed hypogeum show
// ---------------------------------------------------------------------------------------------------------

const TRAV = { c: 0xd2bd96, m: 0, r: 0.92, d: 1 as const };
const TRAV_DARK = { c: 0xa8926e, m: 0, r: 0.94, d: 1 as const };

function colosseum(k: LCtx): void {
  const { nb, hi } = k;
  const a = 3.3, b = 2.72, a2 = 2.72, b2 = 2.18, a3 = 1.45, b3 = 0.88;
  const N = hi ? 44 : 24;
  const tierH = [0.55, 0.5, 0.5], attic = 0.5;
  const wall = new Poly(), dark = new Poly(), seat = new Poly(), arena = new Poly(), hyp = new Poly();
  const P2 = (aa: number, bb: number, t: number): [number, number] => [aa * Math.cos(t), bb * Math.sin(t)];
  const angDiff = (x: number, y: number) => Math.abs(Math.atan2(Math.sin(x - y), Math.cos(x - y)));
  const r = rng(k.seed);
  // how much of the outer wall stands at an angle: the south arc (towards the camera) is gone, its ends stepped
  const tiersAt = (t: number) => {
    const d = angDiff(t, Math.PI / 2);
    return d < 0.55 ? 0 : d < 0.72 ? 1 : d < 0.88 ? 2 : 4;
  };
  const panel = (aa: number, bb: number, t0: number, t1: number, y0: number, h: number, th: number, arches: boolean) => {
    const [x0, z0] = P2(aa, bb, t0), [x1, z1] = P2(aa, bb, t1);
    const len = Math.hypot(x1 - x0, z1 - z0);
    const ry = Math.atan2(-(z0 - z1), x0 - x1); // local +z outward
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    if (arches && hi) {
      const hole: ArchOpening = { x: 0, w: len * 0.6, spring: h * 0.8 - len * 0.3, top: 'round' };
      nb.add(archWallGeo(len + 0.012, h, th, [hole], 4), TRAV, { p: [cx, y0, cz], r: [0, ry, 0] });
    } else {
      wall.boxR(cx, y0, cz, len + 0.012, h, th, ry);
      if (arches) {
        // the arch as a dark recess on the outside (low detail)
        const ox = Math.sin(ry) * (th / 2 + 0.004), oz = Math.cos(ry) * (th / 2 + 0.004);
        const ux = Math.cos(ry), uz = -Math.sin(ry), hw = len * 0.3;
        dark.quad([cx + ox - ux * hw, y0 + 0.02, cz + oz - uz * hw], [cx + ox + ux * hw, y0 + 0.02, cz + oz + uz * hw],
          [cx + ox + ux * hw, y0 + h * 0.82, cz + oz + uz * hw], [cx + ox - ux * hw, y0 + h * 0.82, cz + oz - uz * hw]);
      }
    }
  };
  for (let i = 0; i < N; i++) {
    const t0 = (i / N) * Math.PI * 2, t1 = ((i + 1) / N) * Math.PI * 2, tm = (t0 + t1) / 2;
    const tiers = tiersAt(tm);
    let y = 0;
    for (let tt = 0; tt < Math.min(3, tiers); tt++) {
      panel(a, b, t0, t1, y, tierH[tt], 0.14, true);
      if (hi) panel(a + 0.02, b + 0.02, t0, t1, y + tierH[tt] - 0.04, 0.05, 0.2, false); // cornice
      y += tierH[tt];
    }
    if (tiers === 4) {
      panel(a, b, t0, t1, y, attic, 0.14, false);
      if (hi && i % 2 === 0) panel(a + 0.005, b + 0.005, t0 + (t1 - t0) * 0.35, t1 - (t1 - t0) * 0.35, y + attic * 0.45, 0.09, 0.15, false);
    } else if (tiers > 0 && hi) {
      // the broken end: a jagged top
      panel(a, b, t0, t1, y, 0.12 + r() * 0.25, 0.14, false);
    }
    // the inner ring: two arcaded tiers all round
    panel(a2, b2, t0, t1, 0, 0.55, 0.12, true);
    panel(a2, b2, t0, t1, 0.55, 0.45, 0.12, i % 2 === 0);
    // the upper cavea between the rings: seats where the outer wall stands, bare radial vault walls where it fell
    const [ix0, iz0] = P2(a2, b2, t0), [ix1, iz1] = P2(a2, b2, t1);
    const [ox0, oz0] = P2(a - 0.08, b - 0.08, t0), [ox1, oz1] = P2(a - 0.08, b - 0.08, t1);
    if (tiers === 4) {
      seat.quad([ix1, 1.0, iz1], [ix0, 1.0, iz0], [ox0, 1.58, oz0], [ox1, 1.58, oz1]);
    } else {
      const hgt = 0.45 + tiers * 0.28 + r() * 0.15;
      wall.wall(ix0, iz0, ox0, oz0, 0, hgt, 0.08);
      if (hi) wall.wall((ix0 + ix1) / 2, (iz0 + iz1) / 2, (ox0 + ox1) / 2, (oz0 + oz1) / 2, 0, hgt * 0.6, 0.06);
    }
    // the lower cavea: stepped rings from the inner ring down to the podium round the arena
    const steps = hi ? 4 : 1;
    for (let sI = 0; sI < steps; sI++) {
      const f0 = sI / steps, f1 = (sI + 1) / steps;
      const ra0 = a2 - 0.07 - (a2 - 0.07 - a3 - 0.06) * f0, rb0 = b2 - 0.07 - (b2 - 0.07 - b3 - 0.06) * f0;
      const ra1 = a2 - 0.07 - (a2 - 0.07 - a3 - 0.06) * f1, rb1 = b2 - 0.07 - (b2 - 0.07 - b3 - 0.06) * f1;
      const yA = 0.95 - 0.6 * f0, yB = 0.95 - 0.6 * f1;
      const [p0x, p0z] = P2(ra0, rb0, t0), [p1x, p1z] = P2(ra0, rb0, t1), [q0x, q0z] = P2(ra1, rb1, t0), [q1x, q1z] = P2(ra1, rb1, t1);
      const yStep = steps > 1 ? yB + (yA - yB) * 0.5 : yB;
      seat.quad([q0x, yStep, q0z], [q1x, yStep, q1z], [p1x, yA, p1z], [p0x, yA, p0z]);
      if (steps > 1) seat.quad([q1x, yB, q1z], [q0x, yB, q0z], [q0x, yStep, q0z], [q1x, yStep, q1z]);
    }
    // the podium wall round the arena
    panel(a3 + 0.05, b3 + 0.05, t0, t1, 0, 0.36, 0.05, false);
  }
  // the arena: the hypogeum's walls exposed, a strip of reconstructed floor at the east end
  const fl = ellipse(a3, b3, hi ? 32 : 16, 0.02);
  arena.cap(fl, true);
  const rows = hi ? 7 : 4;
  for (let i = 0; i < rows; i++) {
    const z = -b3 * 0.75 + (1.5 * b3 * i) / (rows - 1);
    const xh = a3 * Math.sqrt(Math.max(0, 1 - (z / b3) ** 2)) * 0.9;
    hyp.wall(-xh, z, xh, z, 0.0, 0.22, 0.05);
  }
  hyp.wall(-a3 * 0.6, -b3 * 0.6, -a3 * 0.6, b3 * 0.6, 0, 0.22, 0.05);
  if (hi) wall.box(a3 * 0.62, 0.2, 0, a3 * 0.5, 0.04, b3 * 1.2);
  put(nb, wall, TRAV);
  put(nb, dark, P.dark);
  put(nb, seat, tint(TRAV, 0xc4ae88));
  put(nb, arena, { c: 0x6e5a44, m: 0, r: 0.96, d: 2 });
  put(nb, hyp, TRAV_DARK);
}

// ---------------------------------------------------------------------------------------------------------
// Leaning Tower of Pisa (3 x 3, ~4.3 tall): eight white marble storeys (a blind-arcaded base, six open galleries of
// columns, the belfry), leaning visibly to the east so the tilt reads from the RTS camera; its lawn
// ---------------------------------------------------------------------------------------------------------

const MARBLE = { c: 0xece6da, m: 0, r: 0.6, d: 1 as const };
const MARBLE_SHADE = { c: 0xc8c0b0, m: 0, r: 0.65, d: 1 as const };

function leaningTower(k: LCtx): void {
  const { nb, hi } = k;
  mound(k, 3, 3, 0.04, 0x6c8a42, 0x7a9a4c, k.seed, 0.02, P.grass);
  const lean = 0.1; // radians (exaggerated a little: the real 4 degrees hides from above)
  const m = new THREE.Matrix4().makeTranslation(-0.3, 0, 0).multiply(new THREE.Matrix4().makeRotationZ(-lean));
  const core = new Poly(), cols = new Poly(), shade = new Poly(), dark = new Poly(), win = new Poly();
  for (const p of [core, cols, shade, dark, win]) p.xf = m;
  const sides = hi ? 20 : 12;
  const R = 0.6;
  // base storey with its blind arcade
  core.ngon(0, -0.3, 0, R + 0.04, R + 0.02, 1.05, sides);
  const pil = hi ? 15 : 8;
  for (let i = 0; i < pil; i++) {
    const a = (i / pil) * Math.PI * 2;
    shade.box(Math.cos(a) * (R + 0.03), 0, -Math.sin(a) * (R + 0.03), 0.06, 0.72, 0.06);
  }
  let y = 0.75;
  const gal = 0.47;
  for (let g = 0; g < 6; g++) {
    shade.ngon(0, y, 0, R + 0.08, R + 0.08, 0.06, sides); // gallery floor / cornice
    core.ngon(0, y + 0.06, 0, R - 0.1, R - 0.1, gal - 0.06, sides); // the inner wall
    const n = hi ? 18 : 8;
    for (let i = 0; i < n; i++) {
      const a = ((i + (g % 2) * 0.5) / n) * Math.PI * 2;
      if (hi) cols.ngon(Math.cos(a) * (R + 0.02), y + 0.06, -Math.sin(a) * (R + 0.02), 0.03, 0.026, gal - 0.12, 5);
      else cols.box(Math.cos(a) * (R + 0.02), y + 0.06, -Math.sin(a) * (R + 0.02), 0.06, gal - 0.12, 0.06);
      if (i % 3 === 0) win.box(Math.cos(a) * (R - 0.09), y + 0.12, -Math.sin(a) * (R - 0.09), 0.06, 0.16, 0.06);
    }
    shade.ngon(0, y + gal - 0.07, 0, R + 0.07, R + 0.07, 0.07, sides); // the arcade's arch band
    y += gal;
  }
  // the belfry and its little roof
  shade.ngon(0, y, 0, R + 0.06, R + 0.06, 0.06, sides);
  core.ngon(0, y + 0.06, 0, R - 0.18, R - 0.18, 0.46, sides);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    dark.box(Math.cos(a) * (R - 0.17), y + 0.16, -Math.sin(a) * (R - 0.17), 0.1, 0.24, 0.1);
  }
  shade.ngon(0, y + 0.52, 0, R - 0.12, R - 0.2, 0.08, sides);
  put(nb, core, MARBLE);
  put(nb, cols, MARBLE);
  put(nb, shade, MARBLE_SHADE);
  put(nb, dark, P.dark);
  put(nb, win, WIN);
  // the marble path across the lawn
  const path = new Poly();
  path.box(0.3, -0.05, 0.95, 0.5, 0.08, 1.05);
  put(nb, path, tint(P.marble, 0xd8d2c4));
}

// ---------------------------------------------------------------------------------------------------------
// Parthenon (7 x 5, ~2.3 tall): the Doric temple on the Acropolis rock, roofless, its colonnades broken in the
// middle (the 1687 explosion), pediments at both ends; the Erechtheion beside it
// ---------------------------------------------------------------------------------------------------------

const PENTELIC = { c: 0xe2d6bc, m: 0, r: 0.7, d: 1 as const };

function parthenon(k: LCtx): void {
  const { nb, hi } = k;
  // the rock: a plateau with cliffs, dry stone and grass on top
  const rock = lin(0x9a8a72), rockDark = lin(0x7a6c58), top = lin(0xb8a888);
  heightField(nb, 7, 5, hi ? 40 : 16, hi ? 28 : 12, (x, z) => {
    const rr = Math.hypot(x / 3.45, z / 2.45) * (1 + 0.08 * (noise2(x * 1.3, z * 1.3, k.seed) - 0.5));
    const s = rr < 0.78 ? 1 : rr > 1 ? 0 : 1 - (rr - 0.78) / 0.22;
    return -0.1 + 1.05 * Math.pow(Math.max(0, s), 0.55) + 0.06 * (fbm2(x, z, 3, k.seed) - 0.5) * s;
  }, (x, z, y, slope) => (slope > 1.2 ? mixc(rock, rockDark, fbm2(x * 2, z * 2, 2, 7)) : mixc(top, rock, Math.min(1, slope))), P.limestone, 0.2);
  const y0 = 0.93;
  const st = new Poly(), col = new Poly(), ent = new Poly();
  // stylobate: three steps
  for (let i = 0; i < 3; i++) st.box(0.1, y0 - 0.05 + i * 0.05, -0.2, 4.6 - i * 0.12, 0.05, 2.25 - i * 0.12);
  const cy0 = y0 + 0.1, ch = 0.92;
  const xs = (i: number) => -2.05 + (4.1 * i) / 16;
  const zs = (i: number) => -0.2 - 0.92 + (1.84 * i) / 7;
  const sides = hi ? 10 : 6;
  const gapS = new Set([7, 8, 9]), gapN = new Set([5, 6, 7, 8, 9, 10, 11]);
  for (let i = 0; i <= 16; i++) {
    if (!gapS.has(i)) column(col, 0.1 + xs(i), cy0, -0.2 + 0.92, 0.072, ch, sides, hi);
    if (!gapN.has(i)) column(col, 0.1 + xs(i), cy0, -0.2 - 0.92, 0.072, ch, sides, hi);
  }
  for (let j = 1; j < 7; j++) for (const sx of [-1, 1]) column(col, 0.1 + sx * 2.05, cy0, zs(j), 0.072, ch, sides, hi);
  // entablature over the standing columns, the end pediments
  const ey = cy0 + ch;
  const run = (x0: number, x1: number, z: number) => ent.box((x0 + x1) / 2, ey, z, x1 - x0, 0.22, 0.2);
  run(0.1 + xs(0) - 0.08, 0.1 + xs(6) + 0.08, 0.72); run(0.1 + xs(10) - 0.08, 0.1 + xs(16) + 0.08, 0.72);
  run(0.1 + xs(0) - 0.08, 0.1 + xs(4) + 0.08, -1.12); run(0.1 + xs(12) - 0.08, 0.1 + xs(16) + 0.08, -1.12);
  for (const sx of [-1, 1]) {
    ent.box(0.1 + sx * 2.05, ey, -0.2, 0.2, 0.22, 2.04);
    gable(ent, 0.1 + sx * 2.05, ey + 0.22, -0.2, 0.22, 2.04, 0.3, 0.02, false);
  }
  // the cella's ruined walls inside
  st.box(-0.95, cy0, -0.2, 0.9, 0.55, 1.2).box(0.9, cy0, -0.55, 1.6, 0.3, 0.12).box(0.9, cy0, 0.15, 1.2, 0.2, 0.12);
  if (hi) {
    // the Erechtheion (with its porch of maidens) and the Propylaea's columns at the west end
    st.box(-1.4, y0 - 0.02, 1.25, 1.0, 0.55, 0.5);
    for (let i = 0; i < 6; i++) column(col, -1.85 + i * 0.18, y0 + 0.5, 1.58, 0.035, 0.32, 6, false);
    st.box(-1.4, y0 + 0.82, 1.4, 0.95, 0.06, 0.35);
    for (let i = 0; i < 5; i++) column(col, -2.95, y0 - 0.1, -0.9 + i * 0.4, 0.06, 0.7, 6, hi);
  }
  put(nb, st, tint(PENTELIC, 0xd8cbb0));
  put(nb, col, PENTELIC);
  put(nb, ent, tint(PENTELIC, 0xd2c4a6));
}

// ---------------------------------------------------------------------------------------------------------
// Brandenburg Gate (5 x 2, ~2.6 tall): twelve Doric columns forming five passages, the entablature and attic, the
// copper Quadriga on top (four horses abreast before the chariot of Victory), the side guardhouses
// ---------------------------------------------------------------------------------------------------------

const BG_STONE = { c: 0xdacaa2, m: 0, r: 0.88, d: 1 as const };

/** A stylised horse facing +z (about 0.36 long), bottom at y0. */
function horse(p: Poly, x: number, y0: number, z: number, s: number, rear = 0): void {
  for (const lx of [-1, 1]) for (const lz of [-1, 1]) p.box(x + lx * 0.035 * s, y0, z + lz * 0.11 * s + (lz > 0 ? rear * 0.05 : 0), 0.03 * s, 0.16 * s, 0.03 * s);
  p.box(x, y0 + 0.15 * s, z, 0.1 * s, 0.11 * s, 0.32 * s); // body
  p.beam([x, y0 + 0.22 * s, z + 0.14 * s], [x, y0 + 0.36 * s, z + 0.22 * s], 0.06 * s, 0.07 * s); // neck
  p.boxR(x, y0 + 0.32 * s, z + 0.25 * s, 0.05 * s, 0.06 * s, 0.13 * s, 0); // head
  p.beam([x, y0 + 0.22 * s, z - 0.16 * s], [x, y0 + 0.1 * s, z - 0.22 * s], 0.025 * s); // tail
}

function brandenburg(k: LCtx): void {
  const { nb, hi } = k;
  const st = new Poly(), col = new Poly(), cu = new Poly();
  st.box(0, -0.2, 0, 4.7, 0.28, 1.4); // stylobate
  const xsC = [-1.76, -1.08, -0.42, 0.42, 1.08, 1.76];
  const ch = 1.38, y0 = 0.08;
  for (const x of xsC) for (const z of [-0.45, 0.45]) column(col, x, y0, z, 0.1, ch, hi ? 10 : 6, true);
  // the walls between the passages (front column to back column)
  for (const x of xsC) st.box(x, y0, 0, 0.2, ch - 0.05, 0.75);
  // entablature with its triglyph frieze, the stepped attic
  st.box(0, y0 + ch, 0, 4.05, 0.3, 1.2);
  if (hi) {
    const tri = new Poly();
    for (let i = 0; i < 22; i++) tri.box(-1.95 + i * 0.186, y0 + ch + 0.08, 0.6, 0.05, 0.16, 0.012);
    put(nb, tri, tint(BG_STONE, 0xb8a882));
  }
  st.box(0, y0 + ch + 0.3, 0, 2.7, 0.42, 1.0);
  st.box(0, y0 + ch + 0.3, 0, 4.0, 0.16, 1.1);
  // the Quadriga: Victory in her chariot, four horses abreast facing +z
  const qy = y0 + ch + 0.72;
  st.box(0, qy, -0.05, 0.9, 0.06, 0.62);
  cu.box(0, qy + 0.06, -0.18, 0.34, 0.2, 0.22); // chariot
  for (const s of [-1, 1]) cu.ngon(s * 0.18, qy + 0.06, -0.2, 0.1, 0.1, 0.02, 8); // wheels (seen edge-on)
  const fig = robedFigure(cu, 0, qy + 0.18, -0.2, 0.46, hi ? 8 : 5);
  cu.beam([0.1, fig.shoulder - 0.05, -0.18], [0.14, fig.shoulder + 0.28, -0.16], 0.025); // staff
  cu.ngon(0.14, fig.shoulder + 0.28, -0.16, 0.06, 0.06, 0.04, 8); // wreath
  for (const [i, hx] of [-0.3, -0.1, 0.1, 0.3].entries()) horse(cu, hx, qy + 0.06, 0.1, 1.15, i % 2);
  // the guardhouses at both ends: small temple fronts
  for (const sx of [-1, 1]) {
    st.box(sx * 2.15, -0.1, -0.1, 0.5, 1.15, 0.85);
    for (const z of [0.36]) for (const dx of [-0.17, 0.17]) column(col, sx * 2.15 + dx, 0, z + 0.1, 0.05, 0.9, 6, true);
    gable(st, sx * 2.15, 1.05, -0.05, 0.52, 0.95, 0.2, 0.03, true);
  }
  put(nb, st, BG_STONE);
  put(nb, col, tint(BG_STONE, 0xe2d4b0));
  put(nb, cu, P.verdigris);
}

// ---------------------------------------------------------------------------------------------------------
// St Basil's Cathedral (5 x 5, ~5 tall): the central tent tower ringed by eight chapels, each crowned with its own
// patterned onion dome (stripes, zigzags, spirals in red, green, gold and blue), on a red-brick gallery
// ---------------------------------------------------------------------------------------------------------

const BRICK_RED = { c: 0xa43c2a, m: 0, r: 0.85, d: 1 as const };
const TRIM_WHITE = { c: 0xece6d8, m: 0, r: 0.75, d: 1 as const };

type C3 = [number, number, number];
const spiral = (c1: C3, c2: C3, n: number, twist: number) => (u: number, v: number): C3 => (Math.floor(u * n + v * twist) % 2 ? c1 : c2);
const zigzag = (c1: C3, c2: C3, n: number, rows: number) => (u: number, v: number): C3 => (Math.floor(u * n + Math.abs(((v * rows) % 1) - 0.5) * 2) % 2 ? c1 : c2);
const bands = (c1: C3, c2: C3, rows: number) => (_u: number, v: number): C3 => (Math.floor(v * rows) % 2 ? c1 : c2);

function stBasils(k: LCtx): void {
  const { nb, hi } = k;
  const brick = new Poly(), white = new Poly(), green = new Poly(), gold = new Poly(), win = new Poly();
  const base = 0.55;
  brick.box(0, -0.2, 0, 3.9, base + 0.2, 3.9);
  white.box(0, base - 0.06, 0, 4.0, 0.06, 4.0);
  if (hi) for (const f of [0, 1, 2, 3]) for (let i = 0; i < 9; i++) {
    const t = -1.75 + i * 0.44;
    const pt: V3 = f === 0 ? [t, 0.25, 1.96] : f === 1 ? [1.96, 0.25, -t] : f === 2 ? [-t, 0.25, -1.96] : [-1.96, 0.25, t];
    win.box(pt[0], 0.12, pt[2], f % 2 ? 0.02 : 0.16, 0.24, f % 2 ? 0.16 : 0.02);
  }
  const sides = hi ? 16 : 8;
  const R = (hex: number) => lin(hex);
  const red = R(0xc23a2a), wht = R(0xf0ece2), grn = R(0x2f8a4c), gld = R(0xe0b040), blu = R(0x2a5aa8), yel = R(0xe8c84a), orn = R(0xd8702a);
  const tower = (x: number, z: number, r0: number, h: number, dome: number, pattern: (u: number, v: number) => C3) => {
    brick.ngon(x, base, z, r0, r0 * 0.92, h, 8, Math.PI / 8);
    white.ngon(x, base + h * 0.55, z, r0 + 0.03, r0 + 0.03, 0.05, 8, Math.PI / 8);
    white.ngon(x, base + h - 0.05, z, r0 * 0.98, r0 * 0.8, 0.22, 8, Math.PI / 8); // kokoshnik collar
    brick.ngon(x, base + h + 0.17, z, r0 * 0.62, r0 * 0.6, dome * 0.35, 8); // drum
    colouredLathe(nb, onionProfile(dome, dome * 2, dome * 0.72, hi ? 10 : 6), sides, { c: 0xffffff, m: 0.15, r: 0.45, d: 3 }, pattern, [x, base + h + 0.17 + dome * 0.35, z]);
    gold.ngon(x, base + h + 0.17 + dome * 2.35, z, 0.025, 0.0, dome * 0.6, 4);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      win.box(x + Math.cos(a) * (r0 + 0.005), base + h * 0.25, z - Math.sin(a) * (r0 + 0.005), 0.07, 0.16, 0.07);
    }
  };
  // the four great chapels on the axes, four smaller on the diagonals
  tower(0, 1.45, 0.38, 1.6, 0.42, spiral(grn, yel, 6, 1.5));
  tower(1.45, 0, 0.38, 1.6, 0.42, zigzag(red, wht, 8, 3));
  tower(0, -1.45, 0.38, 1.6, 0.42, spiral(blu, wht, 6, -1.2));
  tower(-1.45, 0, 0.38, 1.6, 0.42, bands(gld, grn, 6));
  tower(1.05, 1.05, 0.25, 1.15, 0.29, zigzag(orn, grn, 6, 2));
  tower(-1.05, 1.05, 0.25, 1.15, 0.29, spiral(red, gld, 5, 1));
  tower(1.05, -1.05, 0.25, 1.15, 0.29, bands(blu, yel, 5));
  tower(-1.05, -1.05, 0.25, 1.15, 0.29, spiral(grn, wht, 6, 2));
  // the central tent: an octagonal shaft, tiers of kokoshniki, the tall tent and its small gilded onion
  brick.ngon(0, base, 0, 0.55, 0.5, 2.1, 8, Math.PI / 8);
  for (let i = 0; i < 3; i++) white.ngon(0, base + 1.4 + i * 0.25, 0, 0.56 - i * 0.03, 0.5 - i * 0.03, 0.12, 8, Math.PI / 8);
  const tentY = base + 2.1;
  colouredLathe(nb, latheTent(), 8, { c: 0xffffff, m: 0.1, r: 0.5, d: 3 }, bands(lin(0x2f8a4c), lin(0xe8dcc0), 7), [0, tentY, 0]);
  colouredLathe(nb, onionProfile(0.17, 0.4, 0.1, hi ? 8 : 5), sides, { c: 0xe4b440, m: 0.8, r: 0.35, d: 3 }, () => [1, 1, 1], [0, tentY + 1.58, 0]);
  gold.ngon(0, tentY + 1.98, 0, 0.02, 0, 0.25, 4);
  // the bell tower at the south-east corner
  brick.box(1.85, 0, 1.75, 0.42, 1.9, 0.42);
  green.ngon(1.85, 1.9, 1.75, 0.3, 0, 0.75, 8, Math.PI / 8);
  put(nb, brick, BRICK_RED);
  put(nb, white, TRIM_WHITE);
  put(nb, green, P.tileGlazedGreen);
  put(nb, gold, P.gold);
  put(nb, win, WIN);
}

/** St Basil's central tent profile (an octagonal tent: lathe with 8 sides). */
function latheTent(): [number, number][] {
  return [[0.47, 0], [0.4, 0.4], [0.3, 0.8], [0.2, 1.2], [0.1, 1.55]];
}

// ---------------------------------------------------------------------------------------------------------
// Winter Palace (9 x 5, ~2.9 with the column): the long baroque palace in mint green and white round its courtyard,
// three storeys of white columns and windows, statues on the roofline; the Alexander Column on the square in front
// ---------------------------------------------------------------------------------------------------------

const PALACE_GREEN = { c: 0x86c4a2, m: 0, r: 0.8, d: 1 as const };
const PALACE_WHITE = { c: 0xf0eee6, m: 0, r: 0.7, d: 1 as const };

function winterPalace(k: LCtx): void {
  const { nb, hi } = k;
  const g = new Poly(), w = new Poly(), roof = new Poly(), gold = new Poly(), win = new Poly(), granite = new Poly();
  const cx = 0, cz = -0.7, W = 8.6, D = 3.4, wing = 0.95, H = 1.3;
  // the four wings round the courtyard
  g.box(cx, -0.2, cz + D / 2 - wing / 2, W, H + 0.2, wing);
  g.box(cx, -0.2, cz - D / 2 + wing / 2, W, H + 0.2, wing);
  g.box(cx - W / 2 + wing / 2, -0.2, cz, wing, H + 0.2, D - 2 * wing + 0.02);
  g.box(cx + W / 2 - wing / 2, -0.2, cz, wing, H + 0.2, D - 2 * wing + 0.02);
  // the courtyard: paving and the inner facades' windows (so it never reads as a pool)
  const yard = new Poly();
  yard.box(cx, -0.1, cz, W - 2 * wing, 0.13, D - 2 * wing);
  put(nb, yard, { c: 0x9a948a, m: 0, r: 0.92, d: 1 });
  for (let i = 0; i < (hi ? 18 : 8); i++) for (let j = 0; j < 2; j++) {
    const x = cx - W / 2 + wing + 0.2 + (i * (W - 2 * wing - 0.4)) / ((hi ? 18 : 8) - 1);
    pane(win, x, 0.4 + j * 0.42, 0.1, 0.2, cz - D / 2 + wing + 0.006);
  }
  // the central projection on the square side with its triple gateway
  g.box(cx, -0.2, cz + D / 2 + 0.08, 2.2, H + 0.34, 0.3);
  w.box(cx, H + 0.1, cz + D / 2 + 0.08, 2.24, 0.08, 0.34);
  // roofs: low metal roofs with a white balustrade, statues and urns on the roofline
  for (const [x, z, ww, dd] of [[cx, cz + D / 2 - wing / 2, W, wing], [cx, cz - D / 2 + wing / 2, W, wing], [cx - W / 2 + wing / 2, cz, wing, D], [cx + W / 2 - wing / 2, cz, wing, D]] as const) {
    hip(roof, x, H + 0.05, z, ww - 0.1, dd - 0.1, 0.22, 0);
  }
  w.box(cx, H - 0.02, cz + D / 2 - 0.02, W + 0.04, 0.09, 0.06);
  w.box(cx, H - 0.02, cz - D / 2 + 0.02, W + 0.04, 0.09, 0.06);
  const fz = cz + D / 2 + 0.005;
  // the facade: two tiers of paired white columns between the windows, three rows of windows
  const bays = hi ? 30 : 14;
  for (let i = 0; i < bays; i++) {
    const x = cx - W / 2 + (W * (i + 0.5)) / bays;
    if (Math.abs(x - cx) < 1.15) continue;
    for (let j = 0; j < 3; j++) pane(win, x, 0.25 + j * 0.4, hi ? 0.1 : 0.16, 0.2, fz);
    if (hi || i % 2 === 0) w.box(x - W / bays / 2, 0.06, fz + 0.02, 0.05, H - 0.1, 0.05);
  }
  // the central projection: three arched gates, columns, windows above
  for (const dx of [-0.55, 0, 0.55]) pane(win, cx + dx, 0.24, 0.3, 0.36, cz + D / 2 + 0.235);
  for (let i = 0; i < 8; i++) w.box(cx - 1.05 + i * 0.3, 0.06, cz + D / 2 + 0.25, 0.06, H + 0.1, 0.06);
  for (const dx of [-0.75, -0.25, 0.25, 0.75]) for (const y of [0.7, 1.08]) pane(win, cx + dx, y, 0.14, 0.24, cz + D / 2 + 0.235);
  if (hi) {
    for (let i = 0; i < 40; i++) {
      const x = cx - W / 2 + 0.1 + (i * (W - 0.2)) / 39;
      gold.box(x, H + 0.07, fz - 0.01, 0.035, 0.12, 0.035);
    }
    for (let j = 0; j < 3; j++) for (let i = 0; i < 26; i++) pane(win, cx - W / 2 + 0.2 + i * 0.32, 0.25 + j * 0.4, 0.1, 0.18, cz - D / 2 - 0.005 - 0.0001);
  }
  // Palace Square and the Alexander Column with its angel
  const ax = cx, az = 1.85;
  granite.box(ax, -0.1, az, 0.42, 0.42, 0.42);
  granite.box(ax, 0.32, az, 0.34, 0.08, 0.34);
  granite.ngon(ax, 0.4, az, 0.09, 0.075, 2.0, hi ? 12 : 8);
  granite.box(ax, 2.4, az, 0.16, 0.08, 0.16);
  const angel = new Poly();
  const f = robedFigure(angel, ax, 2.48, az, 0.36, 6);
  angel.beam([ax, f.shoulder, az], [ax, f.shoulder + 0.22, az + 0.02], 0.02); // the cross-staff
  angel.beam([ax - 0.12, f.shoulder + 0.02, az - 0.03], [ax + 0.12, f.shoulder + 0.02, az - 0.03], 0.05, 0.012); // wings
  put(nb, g, PALACE_GREEN);
  put(nb, w, PALACE_WHITE);
  put(nb, roof, { c: 0x56625e, m: 0.4, r: 0.55, d: 0 });
  put(nb, gold, P.gold);
  put(nb, win, WIN);
  put(nb, granite, tint(P.redstone, 0x9a4e3e));
  put(nb, angel, P.verdigrisDark);
}

// ---------------------------------------------------------------------------------------------------------
// Neuschwanstein (6 x 5, ~5 tall): the white fairy-tale castle on its forested crag: the tall palace with a steep
// roof and turrets, the slim round tower with its spire, the red-brick gatehouse
// ---------------------------------------------------------------------------------------------------------

const NS_WHITE = { c: 0xece8de, m: 0, r: 0.8, d: 1 as const };
const NS_ROOF = { c: 0x4a5866, m: 0.25, r: 0.55, d: 3 as const };

function neuschwanstein(k: LCtx): void {
  const { nb, hi } = k;
  const rock = lin(0x7c776c), forest = lin(0x2f4a28), meadow = lin(0x4f6a34);
  heightField(nb, 6, 5, hi ? 36 : 14, hi ? 30 : 12, (x, z) => {
    const ridge = Math.hypot((x - 0.1) / 2.7, (z + 0.1) / 1.8);
    const s = ridge < 0.6 ? 1 : ridge > 1.05 ? 0 : 1 - (ridge - 0.6) / 0.45;
    return -0.1 + 1.35 * Math.pow(Math.max(0, s), 0.8) + 0.25 * (fbm2(x * 0.9, z * 0.9, 3, k.seed) - 0.5) * (1 - s * 0.7);
  }, (x, z, y, slope) => (slope > 1.4 ? rock : mixc(meadow, forest, Math.min(1, y * 1.2 + (noise2(x * 2, z * 2, 3) - 0.5)))), P.granite, 0.2);
  const y0 = 1.2;
  const w = new Poly(), roof = new Poly(), brick = new Poly(), win = new Poly(), gold = new Poly();
  // the palace (Palas): tall and narrow along x, steep roof, stepped gable, windows in rows
  w.box(0.55, y0 - 0.5, -0.45, 2.5, 2.4, 0.8);
  gable(roof, 0.55, y0 + 1.9, -0.45, 2.5, 0.8, 0.65, 0.03, false);
  for (let j = 0; j < 4; j++) for (let i = 0; i < (hi ? 9 : 5); i++) pane(win, 0.55 - 1.05 + (2.1 * i) / ((hi ? 9 : 5) - 1), y0 + 0.25 + j * 0.42, 0.09, 0.2, -0.045);
  // turrets on the palace corners and the tall front turret
  for (const [x, z, h, r] of [[1.83, -0.05, 2.75, 0.14], [1.8, -0.85, 2.35, 0.11], [-0.7, -0.85, 2.3, 0.11]] as const) {
    w.ngon(x, y0 - 0.3, z, r, r, h, 10);
    roof.ngon(x, y0 - 0.3 + h, z, r + 0.04, 0, r * 5, 10);
    gold.ngon(x, y0 - 0.3 + h + r * 5, z, 0.012, 0, 0.12, 4);
  }
  // the slim round tower (stair tower) with the tallest spire
  w.ngon(-0.85, y0 - 0.4, -0.35, 0.24, 0.22, 3.0, 12);
  w.ngon(-0.85, y0 + 2.55, -0.35, 0.28, 0.28, 0.12, 12);
  roof.ngon(-0.85, y0 + 2.67, -0.35, 0.3, 0, 1.0, 12);
  gold.ngon(-0.85, y0 + 3.67, -0.35, 0.015, 0, 0.15, 4);
  for (let j = 0; j < 5; j++) pane(win, -0.85, y0 + 0.2 + j * 0.45, 0.07, 0.16, -0.35 + 0.235);
  // the knights' house and the bower, lower, with their turrets; the gatehouse in red brick
  w.box(-0.35, y0 - 0.4, 0.45, 1.1, 1.4, 0.55);
  gable(roof, -0.35, y0 + 1.0, 0.45, 1.1, 0.55, 0.42, 0.03, false);
  w.box(0.85, y0 - 0.4, 0.45, 0.9, 1.25, 0.5);
  hip(roof, 0.85, y0 + 0.85, 0.45, 0.9, 0.5, 0.36, 0.03);
  w.ngon(1.38, y0 - 0.3, 0.62, 0.1, 0.1, 1.7, 10);
  roof.ngon(1.38, y0 + 1.4, 0.62, 0.13, 0, 0.5, 10);
  for (let i = 0; i < 4; i++) pane(win, -0.75 + i * 0.27, y0 + 0.4, 0.08, 0.18, 0.726);
  for (let i = 0; i < 3; i++) pane(win, 0.6 + i * 0.25, y0 + 0.35, 0.08, 0.18, 0.705);
  brick.box(-1.65, y0 - 0.6, 0.55, 0.95, 1.5, 0.6);
  for (const sz of [-1, 1]) {
    brick.ngon(-1.65 + 0.45, y0 - 0.6, 0.55 + sz * 0.3, 0.11, 0.11, 1.75, 8);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      brick.box(-1.2 + Math.cos(a) * 0.1, y0 + 1.15, 0.55 + sz * 0.3 - Math.sin(a) * 0.1, 0.05, 0.08, 0.05);
    }
  }
  pane(win, -1.65, y0 + 0.5, 0.2, 0.24, 0.856);
  w.box(-1.65, y0 - 0.6, 0.856, 0.32, 0.5, 0.01);
  put(nb, w, NS_WHITE);
  put(nb, roof, NS_ROOF);
  put(nb, brick, { c: 0xb0644a, m: 0, r: 0.85, d: 1 });
  put(nb, win, WIN);
  put(nb, gold, P.gold);
}

// ---------------------------------------------------------------------------------------------------------
// Dutch windmills (6 x 3, ~3 tall): three thatched octagonal polder mills in a row by a canal, sails set
// ---------------------------------------------------------------------------------------------------------

function windmill(nb: NB, ps: { thatch: Poly; brick: Poly; wood: Poly; cloth: Poly; white: Poly; win: Poly }, x: number, z: number, phase: number, hi: boolean): void {
  const { thatch, brick, wood, cloth, white, win } = ps;
  brick.ngon(x, -0.15, z, 0.58, 0.55, 0.5, 8, Math.PI / 8);
  thatch.ngon(x, 0.35, z, 0.55, 0.34, 1.45, 8, Math.PI / 8);
  wood.ngon(x, 0.95, z, 0.74, 0.74, 0.04, 8, Math.PI / 8); // reefing stage
  if (hi) for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    wood.beam([x + Math.cos(a) * 0.72, 0.99, z - Math.sin(a) * 0.72], [x + Math.cos(a) * 0.5, 0.45, z - Math.sin(a) * 0.5], 0.025);
  }
  // the cap: boat-shaped, thatched
  thatch.frustum(x, 1.8, z, 0.62, 0.5, 0.32, 0.36, 0.28);
  // windows and door (white frames)
  white.box(x, 0.0, z + 0.555, 0.2, 0.32, 0.02);
  win.quad([x - 0.06, 0.05, z + 0.57], [x + 0.06, 0.05, z + 0.57], [x + 0.06, 0.27, z + 0.57], [x - 0.06, 0.27, z + 0.57]);
  win.quad([x - 0.05, 1.3, z + 0.43], [x + 0.05, 1.3, z + 0.43], [x + 0.05, 1.44, z + 0.43], [x - 0.05, 1.44, z + 0.43]);
  // the sails: four lattice blades round the hub (in the x-y plane in front of the cap)
  const hub: V3 = [x, 1.95, z + 0.5];
  wood.beam([x, 1.95, z + 0.2], hub, 0.09);
  for (let b = 0; b < 4; b++) {
    const a = phase + (b * Math.PI) / 2;
    const dx = Math.cos(a), dy = Math.sin(a);
    const tip: V3 = [hub[0] + dx * 1.05, hub[1] + dy * 1.05, hub[2]];
    wood.beam(hub, tip, 0.045, 0.03); // stock
    const px = -dy, py = dx; // across the blade
    const r0 = 0.25, r1 = 1.02, wdt = 0.22;
    const edge = (r: number, off: number): V3 => [hub[0] + dx * r + px * off, hub[1] + dy * r + py * off, hub[2] + 0.015];
    if (hi) {
      wood.beam(edge(r0, wdt), edge(r1, wdt), 0.018);
      for (let i = 0; i <= 7; i++) { const r = r0 + ((r1 - r0) * i) / 7; wood.beam(edge(r, 0), edge(r, wdt), 0.014); }
    }
    // canvas set on two sails, furled on the others
    if (b % 2 === 0) cloth.quad(edge(r0, 0.01), edge(r1, 0.01), edge(r1, wdt), edge(r0, wdt));
    else cloth.beam(edge(r0, 0.03), edge(r1, 0.03), 0.04);
  }
  void nb;
}

function dutchWindmills(k: LCtx): void {
  const { nb, hi } = k;
  const ps = { thatch: new Poly(), brick: new Poly(), wood: new Poly(), cloth: new Poly(), white: new Poly(), win: new Poly() };
  const r = rng(k.seed);
  // three big mills along the canal, receding a little (the Kinderdijk view), built 1.3x and their sails set diagonally
  const S = 1.3;
  const mills: [number, number, number][] = [[-1.85, 0.25, 0.75], [0.15, -0.15, 0.6 + r() * 0.2], [2.0, -0.55, 0.8]];
  for (const [x, z, ph] of mills) {
    const t = { thatch: new Poly(), brick: new Poly(), wood: new Poly(), cloth: new Poly(), white: new Poly(), win: new Poly() };
    windmill(nb, t, 0, 0, ph, hi);
    const m = new THREE.Matrix4().makeScale(S, S, S).setPosition(x, 0, z);
    for (const key of Object.keys(t) as (keyof typeof t)[]) ps[key].merge(t[key], m);
  }
  // the canal in front and its grassy dike edge
  const water = new Poly();
  water.box(0, -0.06, 1.2, 6.0, 0.08, 0.5);
  put(nb, water, P.water);
  const dike = new Poly();
  dike.frustum(0, -0.1, 0.86, 6.0, 0.24, 6.0, 0.16, 0.12);
  put(nb, dike, P.grass);
  put(nb, ps.thatch, { c: 0x5e5446, m: 0, r: 0.95, d: 2 });
  put(nb, ps.brick, P.brickDark);
  put(nb, ps.wood, P.woodDark);
  put(nb, ps.cloth, { c: 0xe2dccb, m: 0, r: 0.9, d: 2 });
  put(nb, ps.white, P.white);
  put(nb, ps.win, WIN);
}

// ---------------------------------------------------------------------------------------------------------
// Matterhorn (8 x 8, 7 tall): the four-faced pyramid peak with its hooked summit, snow on the ledges, rock faces,
// meadows at its foot
// ---------------------------------------------------------------------------------------------------------

function matterhorn(k: LCtx): void {
  const { nb, hi } = k;
  const H = 6.9, ax = 0.25, az = -0.55;
  const rockA = lin(0x5e5852), rockB = lin(0x857c72), snow = lin(0xf2f4f7), meadow = lin(0x5f7f3e), scree = lin(0x968e82);
  // ridged noise: sharp crests and gullies down the faces
  const ridged = (x: number, z: number) => {
    let s = 0, amp = 0.5, f = 0.7;
    for (let o = 0; o < 4; o++) { s += amp * (1 - Math.abs(noise2(x * f, z * f, k.seed + o * 13) * 2 - 1)); amp *= 0.5; f *= 2.1; }
    return s;
  };
  heightField(nb, 8, 8, hi ? 72 : 26, hi ? 72 : 26, (x, z) => {
    const u = (x - ax) / (x > ax ? 4 - ax : 4 + ax), v = (z - az) / (z > az ? 4 - az : 4 + az);
    // a square pyramid blended with a diamond: ridges to the corners and down the faces
    const d = 0.62 * Math.max(Math.abs(u), Math.abs(v)) + 0.38 * Math.min(1.3, (Math.abs(u) + Math.abs(v)) / 1.3);
    const e = Math.min(1, Math.max(0, 1 - Math.max(Math.abs(x), Math.abs(z)) / 4) / 0.2);
    const core = Math.pow(Math.max(0, 1 - d), 1.45);
    const hook = 0.45 * Math.exp(-((x - ax + 0.3) ** 2 + (z - az) ** 2) / 0.3); // the summit leans east
    const rough = 0.95 * (ridged(x, z) - 0.45) * (0.25 + core);
    return -0.1 + (H * core + hook * core + rough) * e;
  }, (x, z, y, slope) => {
    const n = fbm2(x * 2.6, z * 2.6, 3, 21);
    if (y < 0.45 && slope < 1.6) return mixc(meadow, scree, Math.max(0, y / 0.45 - 0.2));
    const rk = mixc(rockA, rockB, fbm2(x * 1.6, z * 1.6, 2, 9));
    // snow clings to the ledges and gullies: more of it higher up, less on the steepest rock
    const want = (y - 1.6) / 4.5 + (2.4 - slope) * 0.22 + (n - 0.5) * 0.9;
    return want > 0.45 ? mixc(rk, snow, Math.min(1, (want - 0.45) * 5)) : rk;
  }, { c: 0xffffff, m: 0, r: 0.9, d: 1 }, 0.25);
}

// ---------------------------------------------------------------------------------------------------------
// Galata Tower (3 x 3, ~5 tall): the stone cylinder over old Istanbul, its gallery of arched windows and the tall
// conical lead roof; a few old houses at its foot
// ---------------------------------------------------------------------------------------------------------

function galata(k: LCtx): void {
  const { nb, hi } = k;
  mound(k, 3, 3, 0.18, 0x8a7a5a, 0x9a8a68, k.seed, 0.05, P.sand);
  const st = new Poly(), band = new Poly(), roof = new Poly(), win = new Poly(), houses = new Poly(), tiles = new Poly();
  const sides = hi ? 18 : 10;
  st.ngon(0, -0.1, 0, 0.62, 0.57, 3.2, sides);
  for (const y of [0.9, 1.9]) band.ngon(0, y, 0, 0.6, 0.6, 0.05, sides);
  band.ngon(0, 3.08, 0, 0.58, 0.7, 0.12, sides); // corbels
  st.ngon(0, 3.2, 0, 0.62, 0.62, 0.45, sides); // the gallery storey
  band.ngon(0, 3.2, 0, 0.76, 0.76, 0.04, sides); // the balcony
  roof.ngon(0, 3.65, 0, 0.7, 0, 1.4, sides);
  const n = hi ? 14 : 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const c = Math.cos(a), s = -Math.sin(a);
    win.quad([c * 0.625 - s * 0.05, 3.27, s * 0.625 + c * 0.05], [c * 0.625 + s * 0.05, 3.27, s * 0.625 - c * 0.05],
      [c * 0.625 + s * 0.05, 3.55, s * 0.625 - c * 0.05], [c * 0.625 - s * 0.05, 3.55, s * 0.625 + c * 0.05]);
    if (i % 2 === 0) for (const y of [0.55, 1.45, 2.4]) win.quad([c * 0.605 - s * 0.03, y, s * 0.605 + c * 0.03], [c * 0.605 + s * 0.03, y, s * 0.605 - c * 0.03], [c * 0.605 + s * 0.03, y + 0.16, s * 0.605 - c * 0.03], [c * 0.605 - s * 0.03, y + 0.16, s * 0.605 + c * 0.03]);
  }
  roof.ngon(0, 5.05, 0, 0.03, 0, 0.18, 4);
  if (hi) {
    const r = rng(k.seed);
    for (const [x, z] of [[-1.05, 0.95], [1.05, 0.9], [-1.1, -1.0], [1.0, -1.05], [0.0, 1.15]]) {
      const w = 0.45 + r() * 0.2, d = 0.4 + r() * 0.15, h = 0.35 + r() * 0.2;
      houses.box(x, -0.1, z, w, h + 0.1, d);
      hip(tiles, x, h, z, w, d, 0.16, 0.04);
    }
  }
  put(nb, st, { c: 0xb4a585, m: 0, r: 0.9, d: 1 });
  put(nb, band, { c: 0x9a8b6c, m: 0, r: 0.9, d: 1 });
  put(nb, roof, { c: 0x4a5560, m: 0.35, r: 0.55, d: 3 });
  put(nb, win, WIN);
  put(nb, houses, P.plaster);
  put(nb, tiles, P.tile);
}

// ---------------------------------------------------------------------------------------------------------
// Alhambra (7 x 5, ~2 tall): the red fortress-palace on its hill: crenellated walls and square towers, the great
// Comares tower, the Alcazaba's watchtower, tiled palace roofs round the long pool, cypresses
// ---------------------------------------------------------------------------------------------------------

const TAPIAL = { c: 0xbc6c46, m: 0, r: 0.92, d: 1 as const };

function alhambra(k: LCtx): void {
  const { nb, hi } = k;
  const grass = lin(0x667a3e), dry = lin(0xa08860);
  heightField(nb, 7, 5, hi ? 36 : 14, hi ? 26 : 10, (x, z) => {
    const rr = Math.hypot(x / 3.35, z / 2.35) * (1 + 0.1 * (noise2(x, z, k.seed) - 0.5));
    const s = rr < 0.82 ? 1 : rr > 1 ? 0 : 1 - (rr - 0.82) / 0.18;
    return -0.1 + 0.55 * Math.pow(Math.max(0, s), 0.6);
  }, (x, z, y) => mixc(grass, dry, Math.min(1, y * 1.5 + (noise2(x * 2, z * 2, 2) - 0.5) * 0.4)), P.sand, 0.2);
  const y0 = 0.42;
  const wall = new Poly(), merl = new Poly(), roof = new Poly(), plaster = new Poly(), water = new Poly(), trees = new Poly(), win = new Poly();
  const ring: [number, number][] = [[-3.0, 0.25], [-2.5, 1.35], [-0.6, 1.65], [1.5, 1.45], [2.8, 0.75], [2.95, -0.45], [2.1, -1.5], [0.2, -1.75], [-2.0, -1.25]];
  for (let i = 0; i < ring.length; i++) {
    const [x0, z0] = ring[i], [x1, z1] = ring[(i + 1) % ring.length];
    wall.wall(x0, z0, x1, z1, y0 - 0.35, 0.85, 0.14);
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.floor(len / (hi ? 0.16 : 0.32));
    for (let j = 0; j < n; j++) {
      const t = (j + 0.5) / n;
      merl.boxR(x0 + (x1 - x0) * t, y0 + 0.5, z0 + (z1 - z0) * t, hi ? 0.07 : 0.12, 0.08, 0.15, Math.atan2(-(z1 - z0), x1 - x0));
    }
    // a square tower at every corner
    wall.box(x0, y0 - 0.3, z0, 0.4, 1.15, 0.4);
    for (const [dx, dz] of [[-0.15, -0.15], [0.15, -0.15], [-0.15, 0.15], [0.15, 0.15]]) merl.box(x0 + dx, y0 + 0.85, z0 + dz, 0.08, 0.08, 0.08);
  }
  // the Comares tower (back), the Alcazaba's Torre de la Vela (west end) with its bell gable
  wall.box(0.35, y0 - 0.3, -1.55, 0.8, 1.85, 0.8);
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) { merl.box(0.35 - 0.3 + i * 0.2, y0 + 1.55, -1.55 + s * 0.38, 0.08, 0.08, 0.06); merl.box(0.35 + s * 0.38, y0 + 1.55, -1.85 + i * 0.2, 0.06, 0.08, 0.08); }
  for (let i = 0; i < 3; i++) win.quad([0.15 + i * 0.2, y0 + 0.9, -1.149], [0.25 + i * 0.2, y0 + 0.9, -1.149], [0.25 + i * 0.2, y0 + 1.15, -1.149], [0.15 + i * 0.2, y0 + 1.15, -1.149]);
  wall.box(-2.75, y0 - 0.3, 0.2, 0.6, 1.5, 0.6);
  plaster.box(-2.75, y0 + 1.2, 0.2, 0.3, 0.25, 0.08);
  // the Nasrid palaces: courtyards with tiled roofs round the long pool of the Court of the Myrtles
  for (const [x, z, w, d] of [[0.35, -0.75, 1.5, 0.25], [0.35, 0.05, 1.5, 0.25], [-0.5, -0.35, 0.25, 1.05], [1.2, -0.35, 0.25, 1.05]] as const) {
    plaster.box(x, y0 - 0.1, z, w, 0.5, d);
    hip(roof, x, y0 + 0.4, z, w, d, 0.12, 0.04);
  }
  water.box(0.35, y0 - 0.05, -0.35, 1.3, 0.06, 0.32);
  // the Palace of Charles V: a square with a round courtyard
  plaster.box(1.45, y0 - 0.1, 0.75, 1.0, 0.65, 1.0);
  roof.ngon(1.45, y0 + 0.55, 0.75, 0.3, 0.3, 0.02, hi ? 16 : 8);
  // cypresses and the Generalife gardens at the east end
  const r = rng(k.seed);
  for (let i = 0; i < (hi ? 16 : 7); i++) {
    const a = r() * Math.PI * 2;
    const x = 2.2 + Math.cos(a) * 0.7 * r(), z = -0.2 + Math.sin(a) * 1.1 * r();
    cypress(trees, x, y0 - 0.05, z, 0.45 + r() * 0.2, 0.07, 5);
  }
  for (let i = 0; i < (hi ? 10 : 4); i++) cypress(trees, -1.9 + i * 0.42, 0.1, 2.05, 0.4, 0.07, 5);
  put(nb, wall, TAPIAL);
  put(nb, merl, tint(TAPIAL, 0xa85c3c));
  put(nb, roof, P.tile);
  put(nb, plaster, tint(P.plaster, 0xe2d4b8));
  put(nb, water, P.water);
  put(nb, trees, { c: 0x2a4426, m: 0, r: 0.95, d: 2 });
  put(nb, win, WIN);
}

export const EUROPE: Partial<Record<string, LandmarkBuilder>> = {
  'eiffel-tower': eiffel,
  'big-ben': bigBen,
  'tower-bridge': towerBridge,
  colosseum,
  'leaning-tower': leaningTower,
  parthenon,
  'brandenburg-gate': brandenburg,
  'st-basils': stBasils,
  'winter-palace': winterPalace,
  neuschwanstein,
  'dutch-windmills': dutchWindmills,
  matterhorn,
  'galata-tower': galata,
  alhambra,
};
