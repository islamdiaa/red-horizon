/**
 * Landmarks of the Americas and Oceania (front to +z = south, towards the default camera).
 */
import * as THREE from 'three';
import type { NB, V3 } from '../models/builder';
import type { LandmarkBuilder, LCtx } from './common';
import { mound } from './common';
import { ridged, LAMP, P, Poly, WIN, boulder, colonnade, cypress, fbm2, heightField, hip, lin, mixc, noise2, put, rng, stepped, tint, tree } from './kit';

// ---------------------------------------------------------------------------------------------------------
// Statue of Liberty (5 x 5, ~6.4 tall): Liberty Island, the eleven-pointed star of Fort Wood, the granite pedestal
// with its loggias, the copper statue (torch raised in the right hand, tablet in the left, the seven-rayed crown)
// ---------------------------------------------------------------------------------------------------------

const COPPER = P.verdigris;
const PEDESTAL = tint(P.granite, 0xb4ab9a);
const FORT = tint(P.granite, 0x9c958a);
const FLAME: { glow: number; i: number } = { glow: 0xffc24a, i: 1.9 };

function starPrism(points: number, rOut: number, rIn: number, h: number, y0: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  for (let i = 0; i < points * 2; i++) {
    const a = (i / (points * 2)) * Math.PI * 2 + Math.PI / 2;
    const r = i % 2 === 0 ? rOut : rIn;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0, 0);
  return g;
}

function liberty(k: LCtx): void {
  const { nb, hi } = k;
  // the island (lawns) and the star fort
  // the island's lawn: an organic mound whose rim sinks into the ground / water round it (no square plate)
  mound(k, 5, 5, 0.1, 0x6a7a44, 0x6f8c48, k.seed, 0.05, P.grass);
  const fortH = 0.42;
  nb.add(starPrism(11, 2.15, 1.62, fortH + 0.2, -0.2), FORT);
  nb.add(starPrism(11, 2.0, 1.5, 0.03, fortH), tint(P.grass, 0x6a8448)); // the lawn on the fort's top
  const ped = new Poly();
  const y0 = fortH;
  // pedestal: stepped base, the shaft with its loggias, the cornice and the parapet
  ped.frustum(0, y0, 0, 1.55, 1.55, 1.38, 1.38, 0.32);
  ped.box(0, y0 + 0.32, 0, 1.3, 0.08, 1.3);
  const shaft0 = y0 + 0.4, shaftH = 1.62;
  ped.frustum(0, shaft0, 0, 1.12, 1.12, 0.98, 0.98, shaftH);
  ped.box(0, shaft0 + shaftH, 0, 1.12, 0.1, 1.12); // cornice
  ped.box(0, shaft0 + shaftH + 0.1, 0, 0.94, 0.22, 0.94); // attic
  ped.box(0, shaft0 + shaftH + 0.32, 0, 1.0, 0.06, 1.0); // parapet
  const top = shaft0 + shaftH + 0.38;
  // loggias: a recessed band with columns on each face, near the top of the shaft
  const cols = new Poly();
  for (let f = 0; f < 4; f++) {
    const m = new THREE.Matrix4().makeRotationY((f * Math.PI) / 2);
    const c = new Poly();
    if (hi) colonnade(c, 4, -0.3, 0.3, 0.51, shaft0 + shaftH - 0.62, 0.035, 0.5, 6);
    else c.box(0, shaft0 + shaftH - 0.62, 0.5, 0.7, 0.5, 0.04);
    c.box(0, shaft0 + 0.25, 0.53, 0.5, 0.5, 0.04); // the panel below
    cols.merge(c, m);
  }
  put(nb, ped, PEDESTAL);
  put(nb, cols, tint(P.granite, 0xc7bfb0));
  // the statue (about 3.3 tall from her feet to the flame)
  const s = new Poly();
  const sb = top; // statue base
  const sides = hi ? 10 : 7;
  s.ngon(0, sb, 0, 0.32, 0.36, 0.1, sides); // plinth of the statue / hem
  s.ngon(0, sb + 0.1, 0.02, 0.36, 0.27, 1.55, sides); // robe
  s.ngon(0, sb + 1.65, 0.02, 0.27, 0.24, 0.5, sides); // torso
  const sh = sb + 2.15;
  s.ngon(0, sh, 0.02, 0.09, 0.08, 0.1, sides); // neck
  s.ngon(0, sh + 0.1, 0.03, 0.12, 0.1, 0.24, sides); // head
  // crown: a band and seven bold rays fanning out and up (they must read at the default zoom)
  s.ngon(0, sh + 0.24, 0.03, 0.14, 0.14, 0.07, sides);
  for (let i = 0; i < 7; i++) {
    const a = Math.PI * (0.1 + (0.8 * i) / 6);
    const dir: V3 = [Math.cos(a) * 0.85, 0.5, Math.sin(a) * 0.85];
    const o: V3 = [0, sh + 0.28, 0.03];
    s.beam(o, [o[0] + dir[0] * 0.34, o[1] + dir[1] * 0.34, o[2] + dir[2] * 0.34], hi ? 0.055 : 0.07, hi ? 0.03 : 0.045);
  }
  // right arm raised high with the torch (she faces +z, so her right is -x: the torch on the viewer's left)
  const shoulderR: V3 = [-0.22, sh - 0.04, 0.02];
  const elbowR: V3 = [-0.34, sh + 0.42, 0.0];
  const handR: V3 = [-0.37, sh + 0.86, 0.02];
  s.beam(shoulderR, elbowR, 0.14);
  s.beam(elbowR, handR, 0.12);
  s.ngon(handR[0], handR[1] - 0.04, handR[2], 0.045, 0.05, 0.32, 6); // torch handle
  s.frustum(handR[0], handR[1] + 0.28, handR[2], 0.09, 0.09, 0.22, 0.22, 0.09); // the flame's cup and balcony
  // left arm bent, holding the tablet against her side
  const shoulderL: V3 = [0.22, sh - 0.06, 0.02];
  const elbowL: V3 = [0.31, sh - 0.45, 0.1];
  const handL: V3 = [0.24, sh - 0.3, 0.28];
  s.beam(shoulderL, elbowL, 0.13);
  s.beam(elbowL, handL, 0.11);
  s.boxR(0.27, sh - 0.72, 0.24, 0.11, 0.62, 0.38, 0.25); // the tablet, bold enough to read
  if (hi) {
    // drapery: the sash over the left shoulder and the folds of the robe
    s.beam([0.2, sh - 0.05, 0.2], [-0.22, sb + 1.3, 0.25], 0.06, 0.04);
    for (let i = 0; i < 5; i++) {
      const a = -0.9 + i * 0.45;
      s.beam([Math.sin(a) * 0.36, sb + 0.12, 0.02 + Math.cos(a) * 0.36], [Math.sin(a) * 0.27, sb + 1.5, 0.02 + Math.cos(a) * 0.27], 0.035);
    }
  }
  put(nb, s, COPPER);
  // the flame (gilded, lit at night): a bold teardrop
  const fl = new Poly();
  fl.frustum(handR[0], handR[1] + 0.37, handR[2], 0.18, 0.18, 0.2, 0.2, 0.08);
  fl.frustum(handR[0], handR[1] + 0.45, handR[2], 0.2, 0.2, 0, 0, 0.3);
  put(nb, fl, FLAME);
  // floodlights on the fort's points
  const lamps = new Poly();
  for (let i = 0; i < 11; i += 2) {
    const a = (i / 11) * Math.PI * 2 + Math.PI / 2;
    lamps.box(Math.cos(a) * 1.9, fortH + 0.03, -Math.sin(a) * 1.9, 0.06, 0.05, 0.06);
  }
  put(nb, lamps, LAMP);
}

// ---------------------------------------------------------------------------------------------------------
// shared bits
// ---------------------------------------------------------------------------------------------------------

const sstep = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

/** A pane quad in a facade frame (face normal +z, x along it). */
function pane(p: Poly, x: number, y: number, w: number, h: number, z0: number): void {
  p.quad([x - w / 2, y - h / 2, z0], [x + w / 2, y - h / 2, z0], [x + w / 2, y + h / 2, z0], [x - w / 2, y + h / 2, z0]);
}

/** Run `fn` with the soups in each side's frame of a w x d block centred at (cx, cz) (local +z outward, x along). */
function faces4(polys: Poly[], w: number, d: number, fn: (len: number) => void, cx = 0, cz = 0): void {
  for (let f = 0; f < 4; f++) {
    const ry = [0, Math.PI / 2, Math.PI, -Math.PI / 2][f];
    const off = new THREE.Vector3(0, 0, f % 2 === 0 ? d / 2 : w / 2).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry);
    const m = new THREE.Matrix4().makeRotationY(ry).setPosition(cx + off.x, 0, cz + off.z);
    for (const p of polys) p.xf = m;
    fn(f % 2 === 0 ? w : d);
  }
  for (const p of polys) p.xf = null;
}

// ---------------------------------------------------------------------------------------------------------
// Golden Gate Bridge (16 x 3, ~5.9 tall; water under the middle 12 cells): the two International Orange art deco
// towers, the main cables sweeping between them and down to the anchorages, the suspenders, the deck and its truss
// ---------------------------------------------------------------------------------------------------------

const GG_ORANGE = { c: 0xc8482c, m: 0.3, r: 0.55, d: 0 as const };
const CONCRETE = { c: 0xa8a49a, m: 0, r: 0.92, d: 1 as const };

function goldenGate(k: LCtx): void {
  const { nb, hi } = k;
  const o = new Poly(), con = new Poly(), deck = new Poly(), cab = new Poly(), lamps = new Poly();
  const deckY = 1.55, towerX = 3.7, top = 5.85, cz = 0.58, anchorX = 7.55;
  for (const sx of [-1, 1]) {
    const x = sx * towerX;
    con.box(x, -1.1, 0, 1.15, 1.25, 1.75); // the pier and its fender
    // the two legs with their setbacks, joined by the portal struts
    const lv = [0.15, 2.2, 3.3, 4.35, 5.25, top];
    for (const z of [-cz, cz]) for (let i = 0; i < lv.length - 1; i++) {
      const f = i / (lv.length - 1);
      o.box(x, lv[i], z, 0.36 - f * 0.08, lv[i + 1] - lv[i] + 0.01, 0.44 - f * 0.1);
    }
    for (const y of [0.9, 2.15, 3.25, 4.3, 5.2]) {
      o.box(x, y, 0, 0.26, 0.22, 2 * cz - 0.1);
      if (hi) for (const dz of [-0.24, 0, 0.24]) o.box(x + 0.135, y - 0.05, dz, 0.012, 0.32, 0.05); // art deco fins
    }
    o.box(x, top - 0.08, 0, 0.3, 0.12, 2 * cz + 0.36);
    lamps.box(x, top + 0.04, -cz, 0.06, 0.06, 0.06).box(x, top + 0.04, cz, 0.06, 0.06, 0.06);
    // the anchorages and the land piers of the approach
    con.box(sx * anchorX, -0.2, 0, 0.75, deckY + 0.3, 1.5);
    for (const px of [5.4, 6.4]) con.box(sx * px, -0.8, 0, 0.3, deckY + 0.7, 0.9);
  }
  // the deck and its stiffening trusses
  deck.box(0, deckY, 0, 16, 0.08, 1.0);
  for (const z of [-0.47, 0.47]) {
    o.beam([-8, deckY - 0.05, z], [8, deckY - 0.05, z], 0.05, 0.08);
    o.beam([-8, deckY - 0.34, z], [8, deckY - 0.34, z], 0.05, 0.06);
    const n = hi ? 40 : 0;
    for (let i = 0; i < n; i++) {
      const x0 = -8 + (16 * i) / n, x1 = -8 + (16 * (i + 1)) / n;
      o.beam([x0, deckY - 0.34, z], [x1, deckY - 0.05, z], 0.025);
    }
    if (!hi) o.quad([-8, deckY - 0.34, z + Math.sign(z) * 0.026], [8, deckY - 0.34, z + Math.sign(z) * 0.026], [8, deckY - 0.05, z + Math.sign(z) * 0.026], [-8, deckY - 0.05, z + Math.sign(z) * 0.026]);
  }
  // the main cables (main span parabola, side spans down to the anchorages) and the suspenders
  const cableY = (x: number) => {
    const ax = Math.abs(x);
    if (ax <= towerX) return 1.95 + (top - 1.95) * (ax / towerX) ** 2;
    const t = (ax - towerX) / (anchorX - towerX);
    return top + (deckY + 0.2 - top) * t - 0.35 * Math.sin(t * Math.PI);
  };
  for (const z of [-cz, cz]) {
    const n = hi ? 48 : 20;
    for (let i = 0; i < n; i++) {
      const x0 = -anchorX + (2 * anchorX * i) / n, x1 = -anchorX + (2 * anchorX * (i + 1)) / n;
      cab.beam([x0, cableY(x0), z], [x1, cableY(x1), z], 0.07);
    }
    const step = hi ? 0.3 : 0.9;
    for (let x = -anchorX + step; x < anchorX - 0.1; x += step) {
      if (Math.abs(Math.abs(x) - towerX) < 0.2) continue;
      const y = cableY(x);
      if (y - deckY > 0.15) cab.beam([x, deckY + 0.05, z], [x, y, z], 0.014);
    }
  }
  put(nb, o, GG_ORANGE);
  put(nb, cab, tint(GG_ORANGE, 0xb43e26));
  put(nb, con, CONCRETE);
  put(nb, deck, P.dark);
  put(nb, lamps, { glow: 0xff3020, i: 2 });
}

// ---------------------------------------------------------------------------------------------------------
// Empire State Building (3 x 3, ~7.5 tall): limestone art deco setbacks, vertical window bands, the mooring mast
// and the television antenna
// ---------------------------------------------------------------------------------------------------------

const ESB_STONE = { c: 0xd2c8b2, m: 0, r: 0.8, d: 1 as const };
const ESB_METAL = { c: 0xa0a6ac, m: 0.7, r: 0.35, d: 0 as const };

function empireState(k: LCtx): void {
  const { nb, hi } = k;
  const st = new Poly(), win = new Poly(), metal = new Poly(), red = new Poly();
  // [width x, depth z, bottom, top]: the base, the setbacks, the tower, its crown
  const tiers: [number, number, number, number][] = [
    [2.75, 2.45, -0.2, 0.42], [2.3, 2.0, 0.42, 1.15], [1.95, 1.62, 1.15, 1.95], [1.45, 1.0, 1.95, 5.95], [1.2, 0.82, 5.95, 6.25], [0.95, 0.66, 6.25, 6.5],
  ];
  for (const [w, d, y0, y1] of tiers) {
    st.box(0, y0, 0, w, y1 - y0, d);
    // window bands: narrow vertical strips between limestone piers (lit at night)
    faces4([win, metal], w, d, (len) => {
      const n = Math.max(2, Math.round(len / (hi ? 0.11 : 0.2)));
      for (let i = 0; i < n; i++) {
        const x = -len / 2 + (len * (i + 0.5)) / n;
        pane(win, x, (y0 + y1) / 2 + 0.02, hi ? 0.045 : 0.07, y1 - y0 - 0.16, 0.004);
        if (hi && i % 2 === 0) metal.box(x, y0 + 0.08, 0.0, 0.012, y1 - y0 - 0.16, 0.012);
      }
    });
    st.box(0, y1 - 0.04, 0, w + 0.03, 0.05, d + 0.03);
  }
  // the mooring mast: an octagonal shaft with fins, its glazed lantern, the dome, the antenna
  st.ngon(0, 6.5, 0, 0.36, 0.3, 0.42, 8, Math.PI / 8);
  if (hi) for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; metal.box(Math.cos(a) * 0.34, 6.5, -Math.sin(a) * 0.34, 0.03, 0.42, 0.03); }
  win.ngon(0, 6.92, 0, 0.27, 0.24, 0.16, 8, Math.PI / 8);
  metal.ngon(0, 7.08, 0, 0.24, 0.06, 0.2, 8, Math.PI / 8);
  metal.beam([0, 7.25, 0], [0, 7.58, 0], 0.035);
  red.box(0, 7.55, 0, 0.05, 0.05, 0.05);
  put(nb, st, ESB_STONE);
  put(nb, win, WIN);
  put(nb, metal, ESB_METAL);
  put(nb, red, { glow: 0xff3020, i: 2.2, a: 1 });
}

// ---------------------------------------------------------------------------------------------------------
// Mount Rushmore (8 x 4, ~3.7 tall): four colossal heads carved into the granite face of the Black Hills, the talus
// below, pines round the crest
// ---------------------------------------------------------------------------------------------------------

const RUSH_GRANITE = { c: 0xa9a399, m: 0, r: 0.88, d: 1 as const };

/** A stylised carved head facing +z: the skull mass, brow, nose, eye shadows, mouth, chin (beard for one). */
function head(nb: NB, light: Poly, shadow: Poly, x: number, y: number, z: number, s: number, yaw: number, beard: boolean, hi: boolean): void {
  const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(x, y, z);
  light.xf = m;
  shadow.xf = m;
  const skull = new THREE.SphereGeometry(0.42 * s, hi ? 12 : 8, hi ? 9 : 6).scale(0.86, 1.22, 0.52);
  skull.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0.05 * s, 0).premultiply(m));
  nb.add(skull, RUSH_GRANITE);
  light.box(0, 0.14 * s, 0.25 * s, 0.56 * s, 0.09 * s, 0.14 * s); // brow ridge
  light.frustum(0, -0.18 * s, 0.33 * s, 0.1 * s, 0.13 * s, 0.05 * s, 0.03 * s, 0.32 * s, true, false, 0, -0.04 * s); // nose
  for (const sx of [-1, 1]) shadow.box(sx * 0.12 * s, 0.03 * s, 0.24 * s, 0.11 * s, 0.07 * s, 0.05 * s); // eye sockets
  shadow.box(0, -0.29 * s, 0.27 * s, 0.2 * s, 0.03 * s, 0.04 * s); // mouth
  light.box(0, -0.48 * s, 0.2 * s, beard ? 0.3 * s : 0.24 * s, beard ? 0.2 * s : 0.14 * s, 0.16 * s); // chin / beard
  light.box(0, -0.62 * s, 0.05 * s, 0.34 * s, 0.22 * s, 0.3 * s); // the neck merging into the rock
  light.frustum(0, 0.3 * s, -0.12 * s, 0.7 * s, 0.4 * s, 0.4 * s, 0.25 * s, 0.32 * s); // hair and crown worked into the cliff
  light.xf = null;
  shadow.xf = null;
}

function mountRushmore(k: LCtx): void {
  const { nb, hi } = k;
  const gr = lin(0x9a948a), grDark = lin(0x7a746a), pine = lin(0x2c4428), talus = lin(0x8e887e);
  heightField(nb, 8, 4, hi ? 56 : 22, hi ? 28 : 11, (x, z) => {
    const crest = 3.35 + 0.35 * Math.sin(x * 0.7 + 0.4) + 0.3 * (ridged(x * 0.6, z * 0.6, k.seed) - 0.5);
    const sides = sstep(4.0, 2.6, Math.abs(x));
    const face = 1 - sstep(0.05, 0.42, z + 0.04 * Math.sin(x * 2));
    const talusH = 0.5 * (1 - sstep(0.4, 1.5, z)) * sstep(3.6, 2.2, Math.abs(x)) * (0.7 + 0.6 * ridged(x * 2, z * 2, k.seed + 1));
    return -0.1 + Math.max(crest * face * (0.35 + 0.65 * sides), talusH) + 0.08 * (fbm2(x, z, 3, k.seed) - 0.5);
  }, (x, z, y, slope) => {
    if (z > 0.35 && y < 0.8) return mixc(talus, gr, y);
    if (slope < 0.9 && y > 1.2) return mixc(pine, gr, 0.15);
    return mixc(gr, grDark, fbm2(x * 2, y * 2, 2, 6) * 0.8);
  }, { c: 0xffffff, m: 0, r: 0.9, d: 1 }, 0.25);
  // the four heads: Washington (forward, left), Jefferson (behind his shoulder), Roosevelt (recessed), Lincoln
  const light = new Poly(), shadow = new Poly();
  head(nb, light, shadow, -2.0, 2.45, 0.32, 1.12, 0.12, false, hi);
  head(nb, light, shadow, -0.85, 2.62, 0.12, 1.0, -0.22, false, hi);
  head(nb, light, shadow, 0.25, 2.5, -0.02, 0.95, 0.1, false, hi);
  head(nb, light, shadow, 1.4, 2.4, 0.22, 1.05, -0.1, true, hi);
  put(nb, light, RUSH_GRANITE);
  put(nb, shadow, { c: 0x6e6a62, m: 0, r: 0.95, d: 1 });
  // pines on the crest and the flanks
  const trees = new Poly();
  const r = rng(k.seed);
  for (let i = 0; i < (hi ? 30 : 12); i++) {
    const x = (r() < 0.5 ? -1 : 1) * (2.6 + r() * 1.2), z = -1.6 + r() * 2.2;
    cypress(trees, x, 1.2 + r() * 1.2, z, 0.5 + r() * 0.3, 0.14, 5);
  }
  put(nb, trees, { c: 0x2a4226, m: 0, r: 0.95, d: 2 });
}

// ---------------------------------------------------------------------------------------------------------
// Chichen Itza: El Castillo (6 x 6, ~2.6 tall): the nine-terraced pyramid with a stairway up each side, the temple of
// Kukulcan on top, the feathered-serpent heads at the foot of the stairs
// ---------------------------------------------------------------------------------------------------------

const MAYA = { c: 0xbdb196, m: 0, r: 0.92, d: 1 as const };

function chichenItza(k: LCtx): void {
  const { nb, hi } = k;
  const st = new Poly(), stair = new Poly(), dark = new Poly(), shade = new Poly();
  stepped(st, 0, -0.15, 0, 4.5, 4.5, 1.75, 1.75, 2.0, 9, 0.04);
  for (let f = 0; f < 4; f++) {
    const m = new THREE.Matrix4().makeRotationY([0, Math.PI / 2, Math.PI, -Math.PI / 2][f]);
    stair.xf = m;
    shade.xf = m;
    // the stairway (a ramp of steps) and its balustrades
    stair.prismX([[2.38, -0.15], [0.86, -0.15], [0.86, 1.85]], -0.42, 0.42);
    for (const s of [-1, 1]) shade.prismX([[2.42, -0.15], [0.86, -0.15], [0.86, 1.95]], s * 0.42 - 0.05, s * 0.42 + 0.05);
    if (hi) for (let i = 0; i < 16; i++) {
      const t = i / 16;
      stair.box(0, -0.15 + 2.0 * t, 2.38 - 1.52 * t - 0.05, 0.84, 0.03, 0.06);
    }
    if (hi && f === 0) for (const s of [-1, 1]) { shade.box(s * 0.42, -0.15, 2.5, 0.16, 0.16, 0.2); shade.box(s * 0.42, -0.05, 2.6, 0.12, 0.05, 0.08); }
    stair.xf = null;
    shade.xf = null;
  }
  // the temple on top: three doorways at the front, one on each other side, a crest of merlons
  const ty = 1.85;
  st.box(0, ty, 0, 1.25, 0.62, 1.25);
  st.box(0, ty + 0.62, 0, 1.32, 0.06, 1.32);
  for (const dx of [-0.32, 0, 0.32]) pane(dark, dx, ty + 0.25, 0.18, 0.38, 0.627);
  faces4([dark], 1.25, 1.25, () => { pane(dark, 0, ty + 0.25, 0.22, 0.38, 0.003); });
  if (hi) for (let i = 0; i < 9; i++) for (const s of [-1, 1]) { st.box(-0.6 + i * 0.15, ty + 0.68, s * 0.6, 0.06, 0.08, 0.06); st.box(s * 0.6, ty + 0.68, -0.6 + i * 0.15, 0.06, 0.08, 0.06); }
  put(nb, st, MAYA);
  put(nb, stair, tint(MAYA, 0xcbc0a6));
  put(nb, shade, tint(MAYA, 0xa89e86));
  put(nb, dark, P.dark);
}

// ---------------------------------------------------------------------------------------------------------
// Machu Picchu (9 x 7, ~4.8 tall): the citadel's roofless granite houses and green terraces on the saddle, the
// sugarloaf peak of Huayna Picchu rising behind it, the gorge falling away
// ---------------------------------------------------------------------------------------------------------

function machuPicchu(k: LCtx): void {
  const { nb, hi } = k;
  const jungle = lin(0x2f6a2c), jungle2 = lin(0x3f7a34), terrace = lin(0x7cb04a), riser = lin(0x6e685e), rock = lin(0x6e6a62), plaza = lin(0x7aa64e);
  const top = 1.5;
  // the citadel's saddle: a long ridge whose flanks step down in agricultural terraces to the slopes round it
  const saddleR = (x: number, z: number) => Math.hypot((x + 0.3) / 4.1, (z - 0.6) / 2.6);
  const saddle = (x: number, z: number) => {
    const r = saddleR(x, z);
    if (r < 0.5) return top;
    const t = Math.min(1, (r - 0.5) / 0.5);
    const h = top * (1 - t * t * (3 - 2 * t));
    return Math.max(0, Math.floor(h / 0.2) * 0.2 + 0.03); // terraces
  };
  // Huayna Picchu: the steep, sharp, jungle-covered peak behind, joined to the saddle by a narrow ridge
  const peak = (x: number, z: number) => 4.6 * Math.pow(Math.max(0, 1 - Math.hypot((x - 1.2) / 1.15, (z + 2.45) / 0.95)), 0.75) * (0.88 + 0.24 * ridged(x * 1.6, z * 1.6, k.seed));
  const ridge = (x: number, z: number) => (z < 0 && z > -2.2 ? 1.2 * Math.exp(-(((x - 0.6 - z * -0.25) / 0.45) ** 2)) * Math.min(1, (z + 2.2) / 0.6) : 0);
  const ground = (x: number, z: number) => {
    const edge = Math.min(1, Math.max(0, (4.5 - Math.abs(x)) / 0.7)) * Math.min(1, Math.max(0, (3.5 - Math.abs(z)) / 0.6));
    return -0.12 + Math.max(peak(x, z), saddle(x, z), ridge(x, z)) * edge;
  };
  heightField(nb, 9, 7, hi ? 96 : 34, hi ? 76 : 28, ground, (x, z, y, slope) => {
    const onSaddle = saddleR(x, z) < 1 && peak(x, z) < saddle(x, z) + 0.05;
    if (onSaddle) {
      if (saddleR(x, z) < 0.5) return plaza;
      // terraces: green treads with a thin grey stone wall at the front of each step
      const f = ((y + 0.12) % 0.2 + 0.2) % 0.2;
      return f > 0.145 || slope > 1.6 ? riser : mixc(terrace, plaza, noise2(x * 3, z * 3, 9) * 0.3);
    }
    if (slope > 2.6 && y > 1.5) return mixc(rock, jungle, 0.4); // a few bare crags on the peak
    return mixc(jungle, jungle2, noise2(x * 2.5, z * 2.5, 5));
  }, { c: 0xffffff, m: 0, r: 0.92, d: 1 }, 0.25);
  // the citadel: blocks of small roofless granite rooms round the great plaza, a few thatched, the Temple of the Sun
  const walls = new Poly(), thatch = new Poly(), solid = new Poly();
  const r = rng(k.seed);
  const y0 = top - 0.14;
  const room = (x: number, z: number, w: number, d: number) => {
    if (hi) {
      walls.wall(x - w / 2, z - d / 2, x + w / 2, z - d / 2, y0, 0.26, 0.05);
      walls.wall(x - w / 2, z + d / 2, x + w / 2, z + d / 2, y0, 0.26, 0.05);
      walls.wall(x - w / 2, z - d / 2, x - w / 2, z + d / 2, y0, 0.26, 0.05);
      walls.wall(x + w / 2, z - d / 2, x + w / 2, z + d / 2, y0, 0.26, 0.05);
    } else solid.box(x, y0, z, w, 0.22, d);
  };
  // two quarters of larger roofless rooms either side of the plaza (west: the royal and temple quarter, east: houses)
  for (const [qx, cols] of [[-1.7, 3], [1.05, 3]] as const) {
    for (let i = 0; i < cols; i++) for (let j = 0; j < 2; j++) {
      if (r() < 0.12) continue;
      const w = 0.4 + r() * 0.1, d = 0.32 + r() * 0.06;
      const x = qx + (i - (cols - 1) / 2) * 0.5, z = 0.2 + j * 0.45;
      room(x, z, w, d);
      if (hi && r() < 0.2) { solid.box(x, y0, z, w, 0.26, d); thatch.frustum(x, y0 + 0.26, z, w + 0.06, d + 0.06, w * 0.5, 0.01, 0.26); }
    }
  }
  walls.ngon(-0.4, y0, 1.05, 0.2, 0.2, 0.26, hi ? 12 : 6); // Temple of the Sun (round)
  solid.box(-1.0, y0, -0.25, 0.5, 0.3, 0.28); // the Temple of the Three Windows
  solid.box(-1.3, y0 + 0.12, -0.45, 0.16, 0.22, 0.16); // Intihuatana on its knoll
  put(nb, walls, { c: 0x969186, m: 0, r: 0.92, d: 1 });
  put(nb, solid, { c: 0x8e897e, m: 0, r: 0.92, d: 1 });
  put(nb, thatch, P.thatch);
}

// ---------------------------------------------------------------------------------------------------------
// Sugarloaf Mountain (8 x 6, ~4.6 tall): the bare granite dome over the bay, the forested Morro da Urca beside it and
// the cable car slung between them
// ---------------------------------------------------------------------------------------------------------

function sugarloaf(k: LCtx): void {
  const { nb, hi } = k;
  const granite = lin(0x8a7f72), graniteLt = lin(0xa69a8a), jungle = lin(0x2f5a2a), jungle2 = lin(0x3e6a30);
  const loaf = (x: number, z: number) => {
    // leaning a little east, steeper on the bay side
    const lx = x - 1.4 - 0.25 * Math.max(0, 1 - Math.hypot((x - 1.6) / 1.4, (z + 0.6) / 1.2));
    const r = Math.hypot(lx / (lx > 0 ? 1.45 : 1.85), (z + 0.6) / 1.35);
    return r >= 1 ? 0 : 4.55 * Math.pow(1 - Math.pow(r, 2.0), 0.6);
  };
  const urca = (x: number, z: number) => 1.75 * Math.pow(Math.max(0, 1 - Math.hypot((x + 2.3) / 1.6, (z - 1.1) / 1.3)), 0.75);
  heightField(nb, 8, 6, hi ? 64 : 26, hi ? 48 : 20, (x, z) => {
    const base = 0.5 * Math.pow(Math.max(0, 1 - Math.hypot((x - 0.2) / 3.9, (z - 0.1) / 2.9)), 0.7);
    return -0.1 + Math.max(loaf(x, z), urca(x, z), base) + 0.06 * (fbm2(x, z, 3, k.seed) - 0.5);
  }, (x, z, y, slope) => {
    const onLoaf = loaf(x, z) > urca(x, z) && y > 0.9 + 0.5 * noise2(x * 3, z * 3, 8);
    if (onLoaf && slope > 0.5) return mixc(granite, graniteLt, (Math.sin(x * 18 + fbm2(x, y, 2, 4) * 6) * 0.5 + 0.5) * 0.7); // streaked rock
    return mixc(jungle, jungle2, noise2(x * 2.5, z * 2.5, 6));
  }, { c: 0xffffff, m: 0, r: 0.88, d: 1 }, 0.25);
  // the cable car: stations on both tops, the cables, a car on its way up
  const st = new Poly(), cab = new Poly(), car = new Poly(), lamps = new Poly();
  const a: V3 = [-2.25, urca(-2.25, 1.1) + 0.12, 1.05], b: V3 = [1.25, loaf(1.25, -0.5) + 0.12, -0.5];
  st.box(a[0], a[1] - 0.2, a[2], 0.4, 0.3, 0.3);
  st.box(b[0], b[1] - 0.2, b[2], 0.4, 0.3, 0.3);
  for (const dz of [-0.06, 0.06]) {
    const n = hi ? 16 : 6;
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n;
      const p0: V3 = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0 - 0.35 * 4 * t0 * (1 - t0), a[2] + (b[2] - a[2]) * t0 + dz];
      const p1: V3 = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1 - 0.35 * 4 * t1 * (1 - t1), a[2] + (b[2] - a[2]) * t1 + dz];
      cab.beam(p0, p1, 0.018);
    }
  }
  const t = 0.42;
  const cx = a[0] + (b[0] - a[0]) * t, cy = a[1] + (b[1] - a[1]) * t - 0.35 * 4 * t * (1 - t), czz = a[2] + (b[2] - a[2]) * t;
  car.box(cx, cy - 0.3, czz, 0.22, 0.16, 0.16);
  cab.beam([cx, cy - 0.14, czz], [cx, cy, czz], 0.02);
  lamps.box(a[0], a[1] + 0.12, a[2] + 0.16, 0.05, 0.05, 0.02).box(b[0], b[1] + 0.12, b[2] + 0.16, 0.05, 0.05, 0.02);
  put(nb, st, CONCRETE);
  put(nb, cab, P.dark);
  put(nb, car, { c: 0xc83a2a, m: 0.3, r: 0.5, d: 0 });
  put(nb, lamps, LAMP);
}

// ---------------------------------------------------------------------------------------------------------
// Panama Canal locks (10 x 5, ~1.1 tall): twin concrete lock chambers stepping up through mitre gates, the control
// house on the centre wall, the electric towing mules on their rails, a freighter in the lower chamber
// ---------------------------------------------------------------------------------------------------------

function panamaLocks(k: LCtx): void {
  const { nb, hi } = k;
  const con = new Poly(), water = new Poly(), gate = new Poly(), house = new Poly(), roof = new Poly(), mule = new Poly(), rail = new Poly(), lamps = new Poly(), win = new Poly();
  const top = 1.0;
  // walls: two side walls and the centre wall, full length
  for (const [z, w] of [[-1.95, 0.42], [0, 0.55], [1.95, 0.42]] as const) con.box(0, -0.25, z, 9.9, top + 0.25, w);
  for (const s of [-1, 1]) {
    // the two chambers: water low in the west (left), high in the east, the floors between
    const z = s * 0.98;
    water.box(-2.45, -0.1, z, 4.9, 0.38, 1.36);
    water.box(2.45, -0.1, z, 4.9, 0.82, 1.36);
    // mitre gates: a pair of leaves pointing upstream (east) at the step and at both ends
    for (const gx of [-4.75, 0, 4.75]) for (const side of [-1, 1]) {
      gate.beam([gx - 0.15, -0.1, z + side * 0.68], [gx + 0.12, -0.1, z + side * 0.02], 0.08, 0.02);
      gate.boxR(gx - 0.015, -0.1, z + side * 0.35, 0.09, top + 0.08, 0.7, side * 0.38);
    }
    // the rails and the towing mules on the walls
    for (const wz of [s * 1.95, s * 0.2]) rail.box(0, top, wz, 9.8, 0.02, 0.1);
    if (hi) for (const mx of [-3.2, -1.4, 1.8]) mule.box(mx, top + 0.02, s * 1.95, 0.32, 0.15, 0.2);
  }
  // the freighter rising in the west chamber
  const fz = -0.98, fy = 0.28;
  const hull = new Poly(), white = new Poly();
  hull.frustum(-2.3, fy - 0.2, fz, 2.9, 0.86, 3.0, 0.9, 0.4);
  hull.frustum(-0.75, fy - 0.2, fz, 0.2, 0.86, 0.02, 0.9, 0.4, true, false, 0.12, 0);
  white.box(-3.3, fy + 0.2, fz, 0.6, 0.38, 0.72);
  white.box(-3.3, fy + 0.58, fz, 0.4, 0.14, 0.6);
  hull.ngon(-3.15, fy + 0.7, fz, 0.08, 0.08, 0.25, 6);
  for (let i = 0; i < 4; i++) white.box(-2.6 + i * 0.5, fy + 0.2, fz, 0.32, 0.12, 0.6);
  for (let i = 0; i < 4; i++) win.box(-3.62, fy + 0.4, fz - 0.2 + i * 0.13, 0.01, 0.06, 0.06);
  // the control house on the centre wall
  house.box(0.6, top, 0, 0.75, 0.42, 0.42);
  hip(roof, 0.6, top + 0.42, 0, 0.75, 0.42, 0.16, 0.05);
  for (let i = 0; i < 4; i++) win.box(0.35 + i * 0.17, top + 0.18, 0.215, 0.09, 0.12, 0.01);
  for (let i = 0; i < 7; i++) for (const z of [-1.95, 0, 1.95]) lamps.box(-4.2 + i * 1.4, top + 0.01, z, 0.04, 0.2, 0.04);
  put(nb, con, { c: 0xb8b4aa, m: 0, r: 0.92, d: 1 });
  put(nb, water, P.water);
  put(nb, gate, { c: 0x46505a, m: 0.5, r: 0.5, d: 0 });
  put(nb, house, P.plaster);
  put(nb, roof, P.tile);
  put(nb, mule, { c: 0x9aa0a6, m: 0.6, r: 0.4, d: 0 });
  put(nb, rail, P.dark);
  put(nb, hull, { c: 0x6a2e24, m: 0.4, r: 0.6, d: 0 });
  put(nb, white, P.white);
  put(nb, lamps, LAMP);
  put(nb, win, WIN);
}

// ---------------------------------------------------------------------------------------------------------
// Sydney Harbour Bridge (14 x 3, ~4.2 tall; water under the middle 10 cells): the great steel through-arch with its
// two trussed ribs, the deck hung beneath it, the four granite pylons at the ends, the approach spans
// ---------------------------------------------------------------------------------------------------------

const HB_STEEL = { c: 0x7a868c, m: 0.5, r: 0.5, d: 0 as const };
const HB_GRANITE = { c: 0xb8aa8e, m: 0, r: 0.9, d: 1 as const };

function harbourBridge(k: LCtx): void {
  const { nb, hi } = k;
  const steel = new Poly(), web = new Poly(), gran = new Poly(), deck = new Poly(), lamps = new Poly();
  const span = 4.35, deckY = 1.45;
  const lowY = (x: number) => 0.3 + 3.35 * (1 - (x / span) ** 2);
  const topY = (x: number) => 1.65 + 2.5 * (1 - (x / span) ** 2);
  const n = hi ? 24 : 12;
  for (const z of [-0.56, 0.56]) {
    for (let i = 0; i < n; i++) {
      const x0 = -span + (2 * span * i) / n, x1 = -span + (2 * span * (i + 1)) / n;
      steel.beam([x0, lowY(x0), z], [x1, lowY(x1), z], 0.12, 0.1);
      steel.beam([x0, topY(x0), z], [x1, topY(x1), z], 0.1, 0.08);
      web.beam([x0, lowY(x0), z], [x0, topY(x0), z], hi ? 0.04 : 0.06);
      if (hi) web.beam([x0, lowY(x0), z], [x1, topY(x1), z], 0.035);
      // hangers to the deck where the arch is above it, posts where it is below
      const lx = (x0 + x1) / 2;
      if (lowY(lx) > deckY + 0.1) web.beam([lx, deckY, z], [lx, lowY(lx), z], 0.025);
      else web.beam([lx, lowY(lx), z], [lx, deckY, z], 0.05);
    }
    web.beam([span, lowY(span), z], [span, topY(span), z], 0.06);
  }
  // cross bracing between the ribs along the top chord
  for (let i = 0; i <= (hi ? 12 : 6); i++) {
    const x = -span * 0.9 + (1.8 * span * i) / (hi ? 12 : 6);
    web.beam([x, topY(x), -0.56], [x, topY(x), 0.56], 0.05);
  }
  // the deck, its railings, the approach spans on granite piers
  deck.box(0, deckY, 0, 14, 0.1, 1.15);
  steel.box(0, deckY - 0.18, 0, 14, 0.18, 1.0);
  for (const s of [-1, 1]) {
    for (const px of [5.6, 6.6]) gran.box(s * px, -0.6, 0, 0.32, deckY + 0.42, 0.85);
    // the pylons: two granite towers at each end with stepped art deco tops
    for (const z of [-0.66, 0.66]) {
      gran.box(s * 4.75, -0.6, z, 0.62, 3.75, 0.5);
      gran.box(s * 4.75, 3.15, z, 0.5, 0.25, 0.4);
      gran.box(s * 4.75, 3.4, z, 0.36, 0.15, 0.28);
      if (hi) for (let j = 0; j < 4; j++) web.box(s * (4.75 - 0.32), 0.5 + j * 0.6, z, 0.01, 0.3, 0.12);
    }
    gran.box(s * 4.75, -0.6, 0, 0.62, deckY + 0.7, 0.85);
  }
  for (let i = 0; i < 9; i++) lamps.box(-6.5 + i * 1.62, deckY + 0.1, 0.58, 0.04, 0.14, 0.04);
  put(nb, steel, HB_STEEL);
  put(nb, web, tint(HB_STEEL, 0x6c777c));
  put(nb, gran, HB_GRANITE);
  put(nb, deck, P.dark);
  put(nb, lamps, LAMP);
}

export const AMERICAS: Partial<Record<string, LandmarkBuilder>> = {
  'statue-of-liberty': liberty,
  'golden-gate': goldenGate,
  'empire-state': empireState,
  'mount-rushmore': mountRushmore,
  'chichen-itza': chichenItza,
  'machu-picchu': machuPicchu,
  sugarloaf,
  'panama-locks': panamaLocks,
  'harbour-bridge': harbourBridge,
};

void tree;
