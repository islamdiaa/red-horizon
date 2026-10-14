/**
 * Palette + reusable geometry generators and composite parts (tracks, wheels, barrels,
 * windows, lamps, decals, hazard stripes, foundations...).
 */
import * as THREE from 'three';
import { NB, type Glow, type Mat, type Surface, type V3 } from './builder';

// ---------------------------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------------------------

export const M = {
  team: { c: 0xffffff, m: 0.28, r: 0.5, t: 1, d: 0 },
  teamLight: { c: 0xffffff, m: 0.2, r: 0.4, t: 0.7, d: 0 },
  teamDark: { c: 0x7e7e7e, m: 0.28, r: 0.54, t: 1, d: 0 },
  teamDeep: { c: 0x555555, m: 0.3, r: 0.55, t: 1, d: 0 },
  teamCloth: { c: 0xf0f0f0, m: 0, r: 0.82, t: 1, d: 2 },
  teamClothDark: { c: 0x8c8c8c, m: 0, r: 0.86, t: 1, d: 2 },
  gun: { c: 0x40454c, m: 0.62, r: 0.4, d: 0 },
  dark: { c: 0x26282c, m: 0.5, r: 0.55, d: 0 },
  darker: { c: 0x151618, m: 0.4, r: 0.65, d: 0 },
  steel: { c: 0x9aa2ab, m: 0.85, r: 0.3, d: 0 },
  chrome: { c: 0xd0d4da, m: 1, r: 0.16, d: 3 },
  rubber: { c: 0x1c1c1e, m: 0, r: 0.9, d: 2 },
  olive: { c: 0x5c6240, m: 0.15, r: 0.62, d: 0 },
  oliveDark: { c: 0x3f4430, m: 0.15, r: 0.66, d: 0 },
  khaki: { c: 0x968a68, m: 0, r: 0.9, d: 2 },
  canvas: { c: 0xb8ab84, m: 0, r: 0.92, d: 2 },
  sand: { c: 0xb09a6c, m: 0, r: 0.96, d: 2 },
  concrete: { c: 0xa9a397, m: 0, r: 0.92, d: 1 },
  concreteLight: { c: 0xbab4a8, m: 0, r: 0.92, d: 1 },
  concreteDark: { c: 0x7c7870, m: 0, r: 0.94, d: 1 },
  asphalt: { c: 0x46474b, m: 0, r: 0.86, d: 1 },
  white: { c: 0xc2bfb8, m: 0.05, r: 0.66, d: 0 },
  offwhite: { c: 0xaca89e, m: 0.08, r: 0.62, d: 0 },
  red: { c: 0xc41e1a, m: 0.2, r: 0.42, d: 3 },
  yellow: { c: 0xf2b916, m: 0.2, r: 0.48, d: 3 },
  black: { c: 0x18181a, m: 0.3, r: 0.6, d: 3 },
  navy: { c: 0x1d2e5a, m: 0.25, r: 0.45, d: 3 },
  glass: { c: 0x1a2a3a, m: 0.7, r: 0.08, d: 3 },
  glassBlue: { c: 0x3a6a92, m: 0.5, r: 0.06, d: 3 },
  brass: { c: 0xc89540, m: 0.9, r: 0.32, d: 3 },
  gold: { c: 0xe8b434, m: 0.85, r: 0.38, d: 3 },
  copper: { c: 0xc06c3c, m: 0.92, r: 0.32, d: 3 },
  skin: { c: 0xe2a682, m: 0, r: 0.68, d: 3 },
  hair: { c: 0x3a2214, m: 0, r: 0.75, d: 2 },
  boot: { c: 0x2b2420, m: 0.05, r: 0.72, d: 2 },
  webbing: { c: 0x4d4a36, m: 0, r: 0.85, d: 2 },
  wood: { c: 0x8c623e, m: 0, r: 0.82, d: 2 },
  roofRed: { c: 0x9c2f22, m: 0.1, r: 0.7, d: 0 },
} satisfies Record<string, Mat>;

export const G = {
  warm: { glow: 0xffb860 },
  window: { glow: 0xffcf86, i: 0.55 },
  head: { glow: 0xfff2d8, i: 1 },
  red: { glow: 0xff2a18 },
  green: { glow: 0x38ff70 },
  cyan: { glow: 0x4ad8ff },
  tesla: { glow: 0x5aa2ff },
  fire: { glow: 0xff7418 },
  amber: { glow: 0xffa020 },
  white: { glow: 0xfff6ea },
  blue: { glow: 0x3c8cff },
  purple: { glow: 0xb050ff },
} satisfies Record<string, Glow>;

/** Team-tinted variant of a surface with a different base shade. */
export const shade = (m: Mat, c: number): Mat => ({ ...m, c });

// ---------------------------------------------------------------------------------------------
// Geometry generators
// ---------------------------------------------------------------------------------------------

type P2 = [number, number];

function shapeFrom(pts: P2[]): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  return s;
}

/** Side profile (x,y) extruded along Z, centred on z=0. Bevel keeps the outline size. */
export function prismXY(pts: P2[], depth: number, bevel = 0.01): THREE.BufferGeometry {
  const b = Math.min(bevel, depth * 0.3);
  const g = new THREE.ExtrudeGeometry(shapeFrom(pts), {
    depth: Math.max(0.0005, depth - 2 * b),
    bevelEnabled: b > 0,
    bevelThickness: b,
    bevelSize: b,
    bevelOffset: -b,
    bevelSegments: 1,
    curveSegments: 6,
  });
  g.translate(0, 0, -(depth / 2 - b));
  return g;
}

/** Top-view polygon (x,z) extruded upward from y=0 to y=h. */
export function prismXZ(pts: P2[], h: number, bevel = 0.01): THREE.BufferGeometry {
  // shape y = -z, extrude along +Z, then rotate so +Z -> +Y.
  const g = prismXY(
    pts.map(([x, z]) => [x, -z] as P2),
    h,
    bevel,
  );
  g.rotateX(-Math.PI / 2);
  g.translate(0, h / 2, 0);
  return g;
}

/** Surface of revolution around Y. pts = [radius, y]. */
export function lathe(pts: P2[], seg = 16, phiStart = 0, phiLen = Math.PI * 2): THREE.BufferGeometry {
  // LatheGeometry expects the profile to run bottom -> top for outward-facing normals.
  const ordered = pts[0][1] > pts[pts.length - 1][1] ? [...pts].reverse() : pts;
  return new THREE.LatheGeometry(
    ordered.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.0001), y)),
    seg,
    phiStart,
    phiLen,
  );
}

/** 5-pointed star lying flat (XZ plane), one point toward -Z, from y=0 to y=thick. */
export function starGeo(rOut: number, thick = 0.004, inner = 0.42): THREE.BufferGeometry {
  const pts: P2[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const r = i % 2 === 0 ? rOut : rOut * inner;
    pts.push([Math.sin(a) * r, -Math.cos(a) * r]);
  }
  return prismXZ(pts, thick, 0);
}

/** Flat disc lying in XZ (y=0..thick). */
export function discGeo(r: number, thick = 0.004, seg = 24): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, thick, seg);
  g.translate(0, thick / 2, 0);
  return g;
}

/** Hollow ring (annulus) around Y from y=-h/2..h/2. */
export function ringGeo(rIn: number, rOut: number, h: number, seg = 24): THREE.BufferGeometry {
  return lathe(
    [
      [rIn, -h / 2],
      [rOut, -h / 2],
      [rOut, h / 2],
      [rIn, h / 2],
      [rIn, -h / 2],
    ],
    seg,
  );
}

/**
 * Closed track belt (stadium loop) in the XY plane, width along Z, centred at origin.
 * U runs along the belt in units of links (scrolls with the tread texture).
 */
export function trackBelt(L: number, H: number, W: number, thick = 0.022, link = 0.05): THREE.BufferGeometry {
  const r = H / 2;
  const half = L / 2 - r;
  const path: { x: number; y: number; nx: number; ny: number }[] = [];
  const arcSeg = 10;
  // top run (rear -> front)
  path.push({ x: -half, y: r, nx: 0, ny: 1 });
  path.push({ x: half, y: r, nx: 0, ny: 1 });
  // front arc (top -> bottom)
  for (let i = 1; i < arcSeg; i++) {
    const a = Math.PI / 2 - (i / arcSeg) * Math.PI;
    path.push({ x: half + Math.cos(a) * r, y: Math.sin(a) * r, nx: Math.cos(a), ny: Math.sin(a) });
  }
  // bottom run (front -> rear)
  path.push({ x: half, y: -r, nx: 0, ny: -1 });
  path.push({ x: -half, y: -r, nx: 0, ny: -1 });
  // rear arc (bottom -> top)
  for (let i = 1; i < arcSeg; i++) {
    const a = -Math.PI / 2 - (i / arcSeg) * Math.PI;
    path.push({ x: -half + Math.cos(a) * r, y: Math.sin(a) * r, nx: Math.cos(a), ny: Math.sin(a) });
  }
  path.push({ ...path[0] }); // close
  const s: number[] = [0];
  for (let i = 1; i < path.length; i++) {
    s.push(s[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y));
  }
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const hw = W / 2;
  const quadStrip = (
    getA: (i: number) => [number, number, number],
    getB: (i: number) => [number, number, number],
    getN: (i: number) => [number, number, number],
    vA: number,
    vB: number,
    flip: boolean,
  ) => {
    const base = pos.length / 3;
    for (let i = 0; i < path.length; i++) {
      const a = getA(i);
      const b = getB(i);
      const n = getN(i);
      pos.push(...a, ...b);
      nrm.push(...n, ...n);
      uv.push(s[i] / link, vA, s[i] / link, vB);
    }
    for (let i = 0; i < path.length - 1; i++) {
      const a = base + i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      if (flip) idx.push(a, c, b, b, c, d);
      else idx.push(a, b, c, b, d, c);
    }
  };
  // outer surface
  quadStrip(
    (i) => [path[i].x, path[i].y, -hw],
    (i) => [path[i].x, path[i].y, hw],
    (i) => [path[i].nx, path[i].ny, 0],
    0,
    1,
    false,
  );
  // inner surface
  quadStrip(
    (i) => [path[i].x - path[i].nx * thick, path[i].y - path[i].ny * thick, -hw],
    (i) => [path[i].x - path[i].nx * thick, path[i].y - path[i].ny * thick, hw],
    (i) => [-path[i].nx, -path[i].ny, 0],
    0,
    1,
    true,
  );
  // side faces
  for (const side of [-1, 1]) {
    quadStrip(
      (i) => [path[i].x, path[i].y, hw * side],
      (i) => [path[i].x - path[i].nx * thick, path[i].y - path[i].ny * thick, hw * side],
      () => [0, 0, side],
      0,
      0.12,
      side < 0,
    );
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Simple quad facing +Z (XY plane), centred. */
export function quadGeo(w: number, h: number): THREE.BufferGeometry {
  return new THREE.PlaneGeometry(w, h);
}

/** Clip a polygon to xmin<=x<=xmax (Sutherland-Hodgman, two planes). */
function clipX(poly: P2[], xmin: number, xmax: number): P2[] {
  const clip = (p: P2[], inside: (q: P2) => boolean, cut: (a: P2, b: P2) => P2) => {
    const out: P2[] = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[i];
      const b = p[(i + 1) % p.length];
      const ia = inside(a);
      const ib = inside(b);
      if (ia) out.push(a);
      if (ia !== ib) out.push(cut(a, b));
    }
    return out;
  };
  const at = (x: number) => (a: P2, b: P2): P2 => {
    const t = (x - a[0]) / (b[0] - a[0]);
    return [x, a[1] + (b[1] - a[1]) * t];
  };
  let r = clip(poly, (q) => q[0] >= xmin, at(xmin));
  if (r.length) r = clip(r, (q) => q[0] <= xmax, at(xmax));
  return r;
}

// ---------------------------------------------------------------------------------------------
// Composite parts
// ---------------------------------------------------------------------------------------------

/**
 * Hazard stripe plate: lies in the XY plane facing +Z, length `len` along X, height `h`.
 * Placed at p with rotation r.
 */
export function hazard(nb: NB, len: number, h: number, p: V3, r: V3 = [0, 0, 0], stripe = 0.05): void {
  const n = new NB('_hz', p, r);
  n.box(M.black, len, h, 0.008, 0, 0, 0, { b: 0 });
  const slant = h * 0.8;
  for (let x = -len / 2 - slant; x < len / 2; x += stripe * 2) {
    const poly = clipX(
      [
        [x, -h / 2],
        [x + stripe, -h / 2],
        [x + stripe + slant, h / 2],
        [x + slant, h / 2],
      ],
      -len / 2,
      len / 2,
    );
    if (poly.length >= 3) n.add(prismXY(poly, 0.004, 0), M.yellow, { p: [0, 0, 0.005] });
  }
  mergeChild(nb, n);
}

/** Merge a temporary child builder's body/glow parts into `nb` applying its transform. */
export function mergeChild(nb: NB, child: NB): void {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(...child.pos),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...child.rot)),
    new THREE.Vector3(1, 1, 1),
  );
  for (const [slot, list] of child.parts) {
    for (const g of list) {
      g.applyMatrix4(m);
      let l = nb.parts.get(slot);
      if (!l) nb.parts.set(slot, (l = []));
      l.push(g);
    }
  }
}

/** Soviet star with a thin yellow outline, flat on XZ; rotate to place on other faces. */
export function sovietStar(nb: NB, size: number, p: V3, r: V3 = [0, 0, 0]): void {
  const n = new NB('_star', p, r);
  n.add(starGeo(size * 1.22, 0.003), M.yellow);
  n.add(starGeo(size, 0.003), M.red, { p: [0, 0.0025, 0] });
  mergeChild(nb, n);
}

/** Allied insignia: white star in a dark blue disc, flat on XZ. */
export function alliedStar(nb: NB, size: number, p: V3, r: V3 = [0, 0, 0]): void {
  const n = new NB('_astar', p, r);
  n.add(discGeo(size * 1.15, 0.003), M.navy);
  n.add(starGeo(size, 0.003, 0.4), M.white, { p: [0, 0.0025, 0] });
  mergeChild(nb, n);
}

/** Lamp: glowing sphere + small dark housing below. */
export function lamp(nb: NB, glow: Glow, p: V3, size = 0.022, slot?: string): void {
  nb.box(M.dark, size * 1.5, size * 0.6, size * 1.5, p[0], p[1] - size * 0.6, p[2], { b: 0.002 });
  nb.add(new THREE.SphereGeometry(size * 0.7, 8, 6), glow, { p, slot });
}

/**
 * Row of windows facing +Z on a wall plane: dark frame + glowing panes.
 * Centre at p, n windows of size w x h with spacing `gap`, rotation r applied to the whole row.
 */
export function windows(
  nb: NB,
  n: number,
  w: number,
  h: number,
  gap: number,
  p: V3,
  r: V3 = [0, 0, 0],
  glow: Glow = G.window,
  slot = 'glow',
  lit: number[] | null = null,
): void {
  const row = new NB('_win', p, r);
  const total = n * w + (n - 1) * gap;
  for (let i = 0; i < n; i++) {
    const x = -total / 2 + w / 2 + i * (w + gap);
    row.box(M.dark, w + 0.012, h + 0.012, 0.01, x, 0, 0, { b: 0.002 });
    const on = lit ? lit.includes(i) : true;
    if (on) row.add(quadGeo(w, h), glow, { p: [x, 0, 0.0058], slot });
    else row.add(quadGeo(w, h), M.glass, { p: [x, 0, 0.0058] });
  }
  mergeChild(nb, row);
}

/** Concrete foundation slab under a structure: sx x sz cells, y from -0.15 to `top`. */
export function foundation(nb: NB, sx: number, sz: number, top = 0.04, margin = 0.05, mat: Mat = M.concrete): void {
  const w = sx - margin * 2;
  const d = sz - margin * 2;
  const h = 0.15 + top;
  nb.box(mat, w, h, d, 0, top - h / 2, 0, { b: 0.025, seg: 1 });
  // darker kerb edge strip
  nb.box(M.concreteDark, w + 0.01, 0.03, d + 0.01, 0, top - 0.03, 0, { b: 0.012 });
}

export interface TrackOpts {
  /** belt length */
  L: number;
  /** belt height */
  H: number;
  /** belt width */
  W: number;
  /** centre z of each belt (placed at +Z and -Z) */
  Z: number;
  /** number of road wheels */
  wheels?: number;
  /** x offset */
  x?: number;
  /** extra belts at other z (e.g. mammoth outer tracks) */
  link?: number;
}

/** Pair of tracks with road wheels and sprockets (belts in 'track' slot). */
export function tracks(nb: NB, o: TrackOpts): void {
  const belt = trackBelt(o.L, o.H, o.W, 0.02, o.link ?? 0.05);
  const x0 = o.x ?? 0;
  const yC = o.H / 2;
  const nW = o.wheels ?? 5;
  const wr = o.H * 0.34;
  for (const side of [-1, 1]) {
    const z = o.Z * side;
    nb.add(belt, M.dark, { p: [x0, yC, z], slot: 'track', keepUv: true });
    // road wheels
    const span = o.L - o.H * 1.1;
    for (let i = 0; i < nW; i++) {
      const x = x0 - span / 2 + (span * i) / (nW - 1);
      nb.cyl(M.gun, wr, wr, o.W * 0.86, x, wr + 0.012, z, { r: [Math.PI / 2, 0, 0], seg: 12 });
      nb.cyl(M.steel, wr * 0.42, wr * 0.42, o.W * 0.9, x, wr + 0.012, z, { r: [Math.PI / 2, 0, 0], seg: 8 });
    }
    // sprocket + idler
    const sr = o.H * 0.4;
    for (const ex of [-1, 1]) {
      const x = x0 + ex * (o.L / 2 - o.H / 2);
      nb.cyl(M.dark, sr, sr, o.W * 0.92, x, yC, z, { r: [Math.PI / 2, 0, 0], seg: 10 });
      nb.cyl(M.steel, sr * 0.45, sr * 0.45, o.W * 0.96, x, yC, z, { r: [Math.PI / 2, 0, 0], seg: 8 });
    }
  }
}

/**
 * Wheel geometry centred at origin with axis along Z: tyre + rim + hub bolts.
 * Returns parts added to `nb` at position p.
 */
export function wheel(nb: NB, r: number, w: number, p: V3): void {
  const rot: V3 = [Math.PI / 2, 0, 0];
  nb.cyl(M.rubber, r, r, w, p[0], p[1], p[2], { r: rot, seg: 14 });
  // tread blocks
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    nb.box(M.rubber, r * 0.3, r * 0.14, w * 1.02, p[0] + Math.cos(a) * r * 0.98, p[1] + Math.sin(a) * r * 0.98, p[2], {
      r: [0, 0, a + Math.PI / 2],
      b: 0,
    });
  }
  const side = Math.sign(p[2]) || 1;
  nb.cyl(M.gun, r * 0.62, r * 0.62, w * 1.04, p[0], p[1], p[2], { r: rot, seg: 12 });
  nb.cyl(M.steel, r * 0.24, r * 0.3, w * 1.12, p[0], p[1], p[2], { r: rot, seg: 8 });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    nb.box(M.dark, r * 0.12, r * 0.12, 0.006, p[0] + Math.cos(a) * r * 0.42, p[1] + Math.sin(a) * r * 0.42, p[2] + side * w * 0.53, {
      b: 0,
    });
  }
}

/** Barrel along +X starting at local origin. */
export function barrel(
  nb: NB,
  len: number,
  r: number,
  o: { brake?: boolean; sleeve?: boolean; mat?: Mat; y?: number; z?: number; tip?: boolean } = {},
): void {
  const y = o.y ?? 0;
  const z = o.z ?? 0;
  const rot: V3 = [0, 0, -Math.PI / 2];
  const mat = o.mat ?? M.gun;
  nb.cyl(mat, r * 0.92, r * 1.12, len, len / 2, y, z, { r: rot, seg: 12 });
  if (o.sleeve) {
    nb.cyl(M.dark, r * 1.35, r * 1.35, len * 0.16, len * 0.42, y, z, { r: rot, seg: 12 });
    nb.cyl(M.dark, r * 1.3, r * 1.3, len * 0.12, len * 0.72, y, z, { r: rot, seg: 12 });
  }
  if (o.brake) {
    nb.cyl(M.dark, r * 1.5, r * 1.5, len * 0.1, len * 0.96, y, z, { r: rot, seg: 10 });
    nb.box(M.dark, len * 0.05, r * 0.9, r * 3.4, len * 0.96, y, z, { b: 0.002 });
  } else {
    nb.cyl(M.dark, r * 1.18, r * 1.18, len * 0.06, len * 0.97, y, z, { r: rot, seg: 10 });
  }
  // dark bore
  nb.add(new THREE.CircleGeometry(r * 0.6, 10), M.darker, { p: [len + 0.0015, y, z], r: [0, Math.PI / 2, 0] });
}

/** Thin antenna whip with a tip ball. */
export function antenna(nb: NB, x: number, y: number, z: number, h: number, mat: Surface = M.dark): void {
  nb.cyl(M.dark, 0.006, 0.006, 0.02, x, y + 0.01, z, { seg: 6 });
  nb.cyl(mat as Mat, 0.0022, 0.0035, h, x, y + h / 2, z, { seg: 5 });
}

/** Jerry can / stowage box. */
export function stowage(nb: NB, w: number, h: number, d: number, x: number, y: number, z: number, mat: Mat = M.khaki): void {
  nb.box(mat, w, h, d, x, y + h / 2, z, { b: Math.min(w, h, d) * 0.25, seg: 1 });
  nb.box(M.webbing, w * 1.02, h * 1.02, d * 0.12, x, y + h / 2, z, { b: 0.002 });
}

/** Row of sandbags along X centred at p (rotation r). */
export function sandbags(nb: NB, len: number, rows: number, p: V3, r: V3 = [0, 0, 0]): void {
  const n = new NB('_sb', p, r);
  const bw = 0.085;
  const bh = 0.036;
  const count = Math.max(1, Math.round(len / bw));
  for (let row = 0; row < rows; row++) {
    const off = row % 2 ? bw / 2 : 0;
    const cnt = row % 2 ? count - 1 : count;
    for (let i = 0; i < cnt; i++) {
      const x = -len / 2 + bw / 2 + i * (len - bw) / Math.max(1, count - 1) + off;
      n.box(M.sand, bw * 0.98, bh, 0.05, x, row * bh * 0.92 + bh / 2, 0, { b: 0.014, seg: 1 });
    }
  }
  mergeChild(nb, n);
}

/** Pipe between two points (cylinder). */
export function pipe(nb: NB, a: V3, b: V3, r: number, mat: Mat = M.steel, seg = 8): void {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const d = vb.clone().sub(va);
  const len = d.length();
  const mid = va.clone().add(vb).multiplyScalar(0.5);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  const e = new THREE.Euler().setFromQuaternion(q);
  nb.cyl(mat, r, r, len, mid.x, mid.y, mid.z, { r: [e.x, e.y, e.z], seg });
}

/** Ladder on a wall facing +Z (rails + rungs), base at p. */
export function ladder(nb: NB, h: number, p: V3, rotY = 0): void {
  const n = new NB('_lad', p, [0, rotY, 0]);
  n.box(M.steel, 0.008, h, 0.008, -0.03, h / 2, 0, { b: 0 });
  n.box(M.steel, 0.008, h, 0.008, 0.03, h / 2, 0, { b: 0 });
  for (let y = 0.04; y < h; y += 0.05) n.box(M.steel, 0.06, 0.006, 0.006, 0, y, 0, { b: 0 });
  mergeChild(nb, n);
}

/** Railing around a rectangle at height y (posts + top rail). */
export function railing(nb: NB, w: number, d: number, y: number, x = 0, z = 0, h = 0.06): void {
  const posts: P2[] = [];
  const step = 0.12;
  for (let t = -w / 2; t <= w / 2 + 1e-6; t += w / Math.max(1, Math.round(w / step))) {
    posts.push([t, -d / 2], [t, d / 2]);
  }
  for (let t = -d / 2 + d / Math.max(1, Math.round(d / step)); t < d / 2 - 1e-6; t += d / Math.max(1, Math.round(d / step))) {
    posts.push([-w / 2, t], [w / 2, t]);
  }
  for (const [px, pz] of posts) nb.box(M.yellow, 0.007, h, 0.007, x + px, y + h / 2, z + pz, { b: 0 });
  nb.box(M.yellow, w, 0.008, 0.008, x, y + h, z - d / 2, { b: 0 });
  nb.box(M.yellow, w, 0.008, 0.008, x, y + h, z + d / 2, { b: 0 });
  nb.box(M.yellow, 0.008, 0.008, d, x - w / 2, y + h, z, { b: 0 });
  nb.box(M.yellow, 0.008, 0.008, d, x + w / 2, y + h, z, { b: 0 });
}

/** Vent grille: dark plate with slats, lying flat (top face) at p. */
export function grille(nb: NB, w: number, d: number, p: V3, slats = 5, r: V3 = [0, 0, 0]): void {
  const n = new NB('_gr', p, r);
  n.box(M.darker, w, 0.008, d, 0, 0, 0, { b: 0 });
  for (let i = 0; i < slats; i++) {
    const x = -w / 2 + (w * (i + 0.5)) / slats;
    n.box(M.gun, (w / slats) * 0.45, 0.012, d * 0.94, x, 0.003, 0, { b: 0 });
  }
  mergeChild(nb, n);
}

export type Face = '+x' | '-x' | '+z' | '-z' | '+y';

/**
 * Euler rotation that turns a flat decal built in the XZ plane (normal +Y, "up" toward -Z)
 * so that it faces the given direction with its "up" pointing world +Y.
 */
export function faceRot(face: Face): V3 {
  if (face === '+y') return [0, 0, 0];
  const yaw = face === '+z' ? 0 : face === '+x' ? Math.PI / 2 : face === '-z' ? Math.PI : -Math.PI / 2;
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, yaw, 0, 'YXZ'));
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
  return [e.x, e.y, e.z];
}

/** Ore mound: earthy base with gold nuggets. */
export function orePile(nb: NB, x: number, y: number, z: number, rad: number, h: number, seed = 3): void {
  nb.add(lathe([[rad, 0], [rad * 0.78, h * 0.45], [rad * 0.4, h * 0.85], [0.0, h]], 12), ORE_DIRT, { p: [x, y, z], s: [1, 1, 0.85] });
  let sd = seed;
  const rnd = () => {
    sd = (sd * 16807) % 2147483647;
    return sd / 2147483647;
  };
  const n = Math.round(rad * 70);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const d = Math.sqrt(rnd()) * rad * 0.85;
    const yy = h * (1 - (d / rad) ** 1.6) * 0.92;
    const sz = rad * (0.08 + rnd() * 0.1);
    nb.add(new THREE.DodecahedronGeometry(sz, 0), i % 4 === 0 ? ORE_BRIGHT : M.gold, {
      p: [x + Math.cos(a) * d, y + yy, z + Math.sin(a) * d * 0.85],
      r: [rnd() * 3, rnd() * 3, rnd() * 3],
    });
  }
}

const ORE_DIRT: Mat = { c: 0x7a5a2c, m: 0.35, r: 0.7, d: 1 };
const ORE_BRIGHT: Mat = { c: 0xffd860, m: 0.9, r: 0.3, d: 3 };

