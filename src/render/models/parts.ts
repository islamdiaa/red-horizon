/**
 * Palette + reusable geometry generators and composite parts (tracks, wheels, barrels,
 * windows, lamps, decals, hazard stripes, foundations...).
 */
import * as THREE from 'three';
import { NB, maxSeg, type Glow, type Mat, type Surface, type V3 } from './builder';

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
  seg = Math.min(seg, maxSeg(Math.max(...pts.map((p) => p[0]))));
  return new THREE.LatheGeometry(
    ordered.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.0001), y)),
    seg,
    phiStart,
    phiLen,
  );
}

/** 5-pointed star lying flat (XZ plane), one point toward -Z, from y=0 to y=thick. */
export function starGeo(rOut: number, thick = 0, inner = 0.42): THREE.BufferGeometry {
  const pts: P2[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const r = i % 2 === 0 ? rOut : rOut * inner;
    pts.push([Math.sin(a) * r, -Math.cos(a) * r]);
  }
  if (thick > 0.006) return prismXZ(pts, thick, 0);
  return flatXZ(pts);
}

/** Flat polygon lying in the XZ plane (normal +Y), top-view coordinates (x, z). */
export function flatXZ(pts: P2[]): THREE.BufferGeometry {
  const g = new THREE.ShapeGeometry(shapeFrom(pts.map(([x, z]) => [x, -z] as P2)));
  g.rotateX(-Math.PI / 2);
  return g;
}

/** Flat disc lying in XZ (y=0..thick). */
export function discGeo(r: number, thick = 0.004, seg = 24): THREE.BufferGeometry {
  seg = Math.min(seg, maxSeg(r));
  if (thick <= 0.006) {
    const c = new THREE.CircleGeometry(r, seg);
    c.rotateX(-Math.PI / 2);
    c.translate(0, thick, 0);
    return c;
  }
  const g = new THREE.CylinderGeometry(r, r, thick, seg);
  g.translate(0, thick / 2, 0);
  return g;
}

/** Hollow ring (annulus) around Y from y=-h/2..h/2. */
export function ringGeo(rIn: number, rOut: number, h: number, seg = 24): THREE.BufferGeometry {
  if (h <= 0.006) {
    const g = new THREE.RingGeometry(rIn, rOut, Math.min(seg, maxSeg(rOut)));
    g.rotateX(-Math.PI / 2);
    g.translate(0, h / 2, 0);
    return g;
  }
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
  const arcSeg = 4;
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
    if (poly.length >= 3) n.add(new THREE.ShapeGeometry(shapeFrom(poly)), M.yellow, { p: [0, 0, 0.0045] });
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
  n.add(starGeo(size * 1.22), M.yellow, { p: [0, 0.001, 0] });
  n.add(starGeo(size), M.red, { p: [0, 0.0025, 0] });
  mergeChild(nb, n);
}

/** Allied insignia: white star in a dark blue disc, flat on XZ. */
export function alliedStar(nb: NB, size: number, p: V3, r: V3 = [0, 0, 0]): void {
  const n = new NB('_astar', p, r);
  n.add(discGeo(size * 1.15, 0.001, 10), M.navy);
  n.add(starGeo(size, 0, 0.4), M.white, { p: [0, 0.0025, 0] });
  mergeChild(nb, n);
}

/** Lamp: glowing sphere + small dark housing below. */
export function lamp(nb: NB, glow: Glow, p: V3, size = 0.022, slot?: string): void {
  nb.box(M.dark, size * 1.5, size * 0.6, size * 1.5, p[0], p[1] - size * 0.6, p[2], { b: 0 });
  nb.add(new THREE.OctahedronGeometry(size * 0.75, 0), glow, { p, slot });
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
    row.box(M.dark, w + 0.012, h + 0.012, 0.01, x, 0, 0, { b: 0 });
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
  /** tread link length */
  link?: number;
  /** draw road-wheel faces (false for hidden inner tracks) */
  faces?: boolean;
}

/** Pair of tracks with road wheels and sprockets (belts in 'track' slot). */
export function tracks(nb: NB, o: TrackOpts): void {
  const belt = trackBelt(o.L, o.H, o.W, 0.02, o.link ?? 0.05);
  const x0 = o.x ?? 0;
  const yC = o.H / 2;
  const nW = o.wheels ?? 5;
  const wr = o.H * 0.34;
  const wheelDisc = new THREE.CircleGeometry(wr, 6);
  const sprDisc = new THREE.CircleGeometry(o.H * 0.42, 7);
  for (const side of [-1, 1]) {
    const z = o.Z * side;
    nb.add(belt, M.dark, { p: [x0, yC, z], slot: 'track', keepUv: true });
    // road wheel faces on the outer side only
    const span = o.L - o.H * 1.1;
    const face = z + side * o.W * 0.42;
    const rot: V3 = [0, side > 0 ? 0 : Math.PI, 0];
    if (o.faces === false) continue;
    for (let i = 0; i < nW; i++) {
      const x = x0 - span / 2 + (span * i) / (nW - 1);
      nb.add(wheelDisc, M.gun, { p: [x, wr + 0.012, face], r: rot });
    }
    for (const ex of [-1, 1]) {
      nb.add(sprDisc, M.dark, { p: [x0 + ex * (o.L / 2 - o.H / 2), yC, face + side * 0.002], r: rot });
    }
  }
}

/** Tyre: open cylinder (axis Z) whose UVs wrap the tread texture ~8 times; goes in the 'track' slot
 *  so the scrolling tread makes the wheel appear to roll. */
export function tyreGeo(r: number, w: number, seg = 8): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, w, seg, 1, true);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const reps = Math.max(4, Math.round((Math.PI * 2 * r) / 0.05));
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * reps, uv.getY(i));
  g.rotateX(Math.PI / 2);
  return g;
}

/**
 * Wheel at p (axis along Z): scrolling tyre tread + rim/hub faces on the outer side.
 */
export function wheel(nb: NB, r: number, w: number, p: V3): void {
  const side = Math.sign(p[2]) || 1;
  nb.add(tyreGeo(r, w, 8), M.dark, { p, slot: 'track', keepUv: true });
  const rot: V3 = [0, side > 0 ? 0 : Math.PI, 0];
  nb.add(new THREE.CircleGeometry(r * 0.98, 8), M.rubber, { p: [p[0], p[1], p[2] + side * w * 0.48], r: rot });
  nb.add(new THREE.CircleGeometry(r * 0.6, 6), M.gun, { p: [p[0], p[1], p[2] + side * w * 0.5], r: rot });
  nb.add(new THREE.CircleGeometry(r * 0.25, 5), M.steel, { p: [p[0], p[1], p[2] + side * w * 0.52], r: rot });
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
  nb.cyl(mat, r * 0.92, r * 1.12, len, len / 2, y, z, { r: rot, seg: 6, open: true });
  if (o.sleeve) nb.cyl(M.dark, r * 1.35, r * 1.35, len * 0.18, len * 0.5, y, z, { r: rot, seg: 6, open: true });
  if (o.brake) nb.box(M.dark, len * 0.08, r * 1.6, r * 3.0, len * 0.96, y, z, { b: 0 });
  else nb.cyl(M.dark, r * 1.2, r * 1.2, len * 0.06, len * 0.97, y, z, { r: rot, seg: 6, open: true });
  nb.add(new THREE.CircleGeometry(r * 0.75, 6), M.darker, { p: [len + 0.001, y, z], r: [0, Math.PI / 2, 0] });
}

/** Thin antenna whip. */
export function antenna(nb: NB, x: number, y: number, z: number, h: number, mat: Surface = M.dark): void {
  nb.cyl(mat as Mat, 0.0022, 0.0045, h, x, y + h / 2, z, { seg: 3 });
}

/** Jerry can / stowage box. */
export function stowage(nb: NB, w: number, h: number, d: number, x: number, y: number, z: number, mat: Mat = M.khaki): void {
  nb.box(mat, w, h, d, x, y + h / 2, z, { b: Math.min(w, h, d) * 0.25, seg: 1 });
  nb.box(M.webbing, w * 1.02, h * 1.02, d * 0.12, x, y + h / 2, z, { b: 0.002 });
}

/** Row of sandbags along X centred at p (rotation r). */
export function sandbags(nb: NB, len: number, rows: number, p: V3, r: V3 = [0, 0, 0]): void {
  const n = new NB('_sb', p, r);
  const bw = 0.11;
  const bh = 0.036;
  const count = Math.max(1, Math.round(len / bw));
  for (let row = 0; row < rows; row++) {
    const off = row % 2 ? bw / 2 : 0;
    const cnt = row % 2 ? count - 1 : count;
    for (let i = 0; i < cnt; i++) {
      const x = -len / 2 + bw / 2 + (i * (len - bw)) / Math.max(1, count - 1) + off;
      n.box(M.sand, bw * 0.96, bh, 0.05, x, row * bh * 0.92 + bh / 2, 0, { b: i % 2 ? 0 : 0.01 });
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
  n.lod = 0; // close-up detail
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
  const k = Math.min(slats, 4);
  for (let i = 0; i < k; i++) {
    const x = -w / 2 + (w * (i + 0.5)) / k;
    n.box(M.gun, (w / k) * 0.45, 0.012, d * 0.94, x, 0.003, 0, { b: 0 });
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
  nb.add(lathe([[rad, 0], [rad * 0.72, h * 0.5], [0.0, h]], 8), ORE_DIRT, { p: [x, y, z], s: [1, 1, 0.85] });
  let sd = seed;
  const rnd = () => {
    sd = (sd * 16807) % 2147483647;
    return sd / 2147483647;
  };
  const n = Math.round(rad * 32);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const d = Math.sqrt(rnd()) * rad * 0.85;
    const yy = h * (1 - (d / rad) ** 1.6) * 0.92;
    const sz = rad * (0.08 + rnd() * 0.1);
    nb.add(new THREE.OctahedronGeometry(sz * 1.2, 0), i % 4 === 0 ? ORE_BRIGHT : M.gold, {
      p: [x + Math.cos(a) * d, y + yy, z + Math.sin(a) * d * 0.85],
      r: [rnd() * 3, rnd() * 3, rnd() * 3],
    });
  }
}

const ORE_DIRT: Mat = { c: 0x7a5a2c, m: 0.35, r: 0.7, d: 1 };
const ORE_BRIGHT: Mat = { c: 0xffd860, m: 0.9, r: 0.3, d: 3 };


// ---------------------------------------------------------------------------------------------
// Close-up detail (LOD 0 only: dropped from the distant body)
// ---------------------------------------------------------------------------------------------

const RIVET = new THREE.OctahedronGeometry(1, 0);

/** Row of `n` rivet / bolt heads from a to b (close-up detail). */
export function rivets(nb: NB, a: V3, b: V3, n: number, size = 0.006, mat: Mat = M.gun): void {
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    nb.add(RIVET, mat, { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t], s: [size, size * 0.6, size], lod: 0 });
  }
}

/** Seven-segment stencil layout per digit: a b c d e f g. */
const SEGS: Record<string, string> = {
  '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg',
};

/**
 * Stencilled tactical number on a vertical face facing +Z (rotate with r), centred at p, digit height h.
 * Close-up detail: flat quads, about a dozen triangles per digit.
 */
export function stencilNumber(nb: NB, text: string, p: V3, r: V3 = [0, 0, 0], h = 0.04, mat: Mat = M.white): void {
  const n = new NB('_num', p, r);
  const w = h * 0.55;
  const t = h * 0.15;
  const gap = w * 0.45;
  const total = text.length * w + (text.length - 1) * gap;
  for (let i = 0; i < text.length; i++) {
    const segs = SEGS[text[i]];
    if (!segs) continue;
    const cx = -total / 2 + w / 2 + i * (w + gap);
    const put = (x: number, y: number, sw: number, sh: number) => n.add(quadGeo(sw, sh), mat, { p: [cx + x, y, 0], lod: 0 });
    const vy = h / 2 - t / 2;
    for (const s of segs) {
      if (s === 'a') put(0, vy, w, t);
      else if (s === 'd') put(0, -vy, w, t);
      else if (s === 'g') put(0, 0, w, t);
      else if (s === 'b') put(w / 2 - t / 2, h / 4, t, h / 2);
      else if (s === 'c') put(w / 2 - t / 2, -h / 4, t, h / 2);
      else if (s === 'e') put(-w / 2 + t / 2, -h / 4, t, h / 2);
      else if (s === 'f') put(-w / 2 + t / 2, h / 4, t, h / 2);
    }
  }
  mergeChild(nb, n);
}

/** Radiation trefoil (black on yellow disc) lying in XZ, normal +Y; rotate to place on other faces. */
export function trefoil(nb: NB, size: number, p: V3, r: V3 = [0, 0, 0]): void {
  const n = new NB('_tre', p, r);
  n.add(discGeo(size, 0.001, 12), M.yellow);
  for (let i = 0; i < 3; i++) {
    const g = new THREE.RingGeometry(size * 0.24, size * 0.82, 5, 1, (i * 2 * Math.PI) / 3 + Math.PI / 6, Math.PI / 3);
    g.rotateX(-Math.PI / 2);
    n.add(g, M.black, { p: [0, 0.0022, 0] });
  }
  n.add(discGeo(size * 0.15, 0.001, 6), M.black, { p: [0, 0.0024, 0] });
  mergeChild(nb, n);
}

/** Small hatch with a handle on a horizontal surface (close-up handle). */
export function hatch(nb: NB, r: number, p: V3, mat: Mat = M.teamDark): void {
  nb.cyl(mat, r, r * 1.05, 0.01, p[0], p[1] + 0.005, p[2], { seg: 10 });
  nb.box(M.steel, r * 0.9, 0.006, 0.006, p[0], p[1] + 0.013, p[2], { b: 0, slot: undefined });
  rivets(nb, [p[0] - r * 0.7, p[1] + 0.011, p[2] - r * 0.7], [p[0] + r * 0.7, p[1] + 0.011, p[2] - r * 0.7], 3, 0.004);
}

// =============================================================================================
// Structure kit: faction styles, stencil text, banners, emblems, lights, catwalks, roof clutter
// =============================================================================================

export type Fac = 'allies' | 'soviet';

/** Structure palette additions (heavy concrete, dark steel, roofing, signage). */
export const S = {
  /** Soviet: heavy, darker concrete and gunmetal steel */
  sovWall: { c: 0x8a867e, m: 0, r: 0.9, d: 1 },
  sovWallDark: { c: 0x66635d, m: 0, r: 0.92, d: 1 },
  sovSteel: { c: 0x4c5056, m: 0.55, r: 0.5, d: 0 },
  sovSteelLight: { c: 0x6c7076, m: 0.55, r: 0.46, d: 0 },
  /** Allied: clean light concrete, steel cladding and glass */
  allWall: { c: 0xc0bcb1, m: 0, r: 0.86, d: 1 },
  allWallDark: { c: 0x95918a, m: 0, r: 0.9, d: 1 },
  allSteel: { c: 0x87909a, m: 0.7, r: 0.36, d: 0 },
  allSteelLight: { c: 0xa9b1b9, m: 0.7, r: 0.34, d: 0 },
  roofTar: { c: 0x3b3c3f, m: 0.05, r: 0.92, d: 1, uv: 1.6 },
  roofSteel: { c: 0x5a6066, m: 0.6, r: 0.5, d: 0 },
  grating: { c: 0x33363a, m: 0.6, r: 0.55, d: 0, uv: 6 },
  rust: { c: 0x6e4128, m: 0.35, r: 0.82, d: 0 },
  brick: { c: 0x7a4636, m: 0, r: 0.92, d: 1, uv: 2.4 },
  signRed: { c: 0xa31f19, m: 0.1, r: 0.6, d: 3 },
  signBlue: { c: 0x1d3b78, m: 0.1, r: 0.55, d: 3 },
  stencilWhite: { c: 0xd8d4c8, m: 0.05, r: 0.7, d: 3, w: 0 },
  stencilYellow: { c: 0xe8b51a, m: 0.1, r: 0.6, d: 3, w: 0 },
  cloth: { c: 0xffffff, m: 0, r: 0.85, t: 1, d: 2, snow: 0.2 },
  clothDark: { c: 0x6a6a6a, m: 0, r: 0.88, t: 1, d: 2, snow: 0.2 },
} satisfies Record<string, Mat>;

/** Faction look of a structure: wall / steel / roof materials, railing paint, light colours. */
export interface FStyle {
  fac: Fac;
  wall: Mat;
  wallDark: Mat;
  steel: Mat;
  steelLight: Mat;
  roof: Mat;
  rail: Mat;
  /** steady accent light (Soviet red, Allied white) */
  accent: Glow;
  /** window glow */
  win: Glow;
}

export const FSTYLE: Record<Fac, FStyle> = {
  soviet: {
    fac: 'soviet',
    wall: S.sovWall,
    wallDark: S.sovWallDark,
    steel: S.sovSteel,
    steelLight: S.sovSteelLight,
    roof: S.roofTar,
    rail: { c: 0x3a3c40, m: 0.6, r: 0.5, d: 0 },
    accent: { glow: 0xff2414, i: 1.6 },
    win: { glow: 0xffb35c, i: 0.75 },
  },
  allies: {
    fac: 'allies',
    wall: S.allWall,
    wallDark: S.allWallDark,
    steel: S.allSteel,
    steelLight: S.allSteelLight,
    roof: S.roofSteel,
    rail: M.yellow,
    accent: { glow: 0xe8f2ff, i: 1.5 },
    win: { glow: 0xcfe6ff, i: 0.7 },
  },
};

// ---------------------------------------------------------------------------------------------
// Stencil text: a stroke font (Latin capitals, digits, a few Cyrillic letters) as flat quads
// ---------------------------------------------------------------------------------------------

type Stroke = number[][];
const O_: Stroke = [[1, 0], [0, 1], [0, 5], [1, 6], [3, 6], [4, 5], [4, 1], [3, 0], [1, 0]];
const P_: Stroke = [[0, 0], [0, 6], [3, 6], [4, 5], [4, 3.8], [3, 2.8], [0, 2.8]];
const B1_: Stroke = [[0, 0], [0, 6], [3, 6], [4, 5], [4, 4.1], [3, 3.2], [0, 3.2]];
const B2_: Stroke = [[3, 3.2], [4, 2.3], [4, 1], [3, 0], [0, 0]];
const GLYPHS: Record<string, Stroke[]> = {
  A: [[[0, 0], [0, 4.5], [1.4, 6], [2.6, 6], [4, 4.5], [4, 0]], [[0, 2.7], [4, 2.7]]],
  B: [B1_, B2_],
  C: [[[4, 6], [1, 6], [0, 5], [0, 1], [1, 0], [4, 0]]],
  D: [[[0, 0], [0, 6], [2.6, 6], [4, 4.6], [4, 1.4], [2.6, 0], [0, 0]]],
  E: [[[4, 6], [0, 6], [0, 0], [4, 0]], [[0, 3.1], [3, 3.1]]],
  F: [[[4, 6], [0, 6], [0, 0]], [[0, 3.1], [3, 3.1]]],
  G: [[[4, 6], [1, 6], [0, 5], [0, 1], [1, 0], [4, 0], [4, 2.8], [2.2, 2.8]]],
  H: [[[0, 0], [0, 6]], [[4, 0], [4, 6]], [[0, 3.1], [4, 3.1]]],
  I: [[[2, 0], [2, 6]], [[0.8, 6], [3.2, 6]], [[0.8, 0], [3.2, 0]]],
  J: [[[4, 6], [4, 1], [3, 0], [1, 0], [0, 1]]],
  K: [[[0, 0], [0, 6]], [[4, 6], [0.5, 3], [4, 0]]],
  L: [[[0, 6], [0, 0], [4, 0]]],
  M: [[[0, 0], [0, 6], [2, 3.2], [4, 6], [4, 0]]],
  N: [[[0, 0], [0, 6], [4, 0], [4, 6]]],
  O: [O_],
  P: [P_],
  Q: [O_, [[2.6, 1.4], [4.2, -0.3]]],
  R: [P_, [[2, 2.8], [4, 0]]],
  S: [[[4, 6], [1, 6], [0, 5], [0, 4], [1, 3.1], [3, 3.1], [4, 2.1], [4, 1], [3, 0], [0, 0]]],
  T: [[[0, 6], [4, 6]], [[2, 6], [2, 0]]],
  U: [[[0, 6], [0, 1], [1, 0], [3, 0], [4, 1], [4, 6]]],
  V: [[[0, 6], [2, 0], [4, 6]]],
  W: [[[0, 6], [0.8, 0], [2, 3.4], [3.2, 0], [4, 6]]],
  X: [[[0, 6], [4, 0]], [[4, 6], [0, 0]]],
  Y: [[[0, 6], [2, 3]], [[4, 6], [2, 3], [2, 0]]],
  Z: [[[0, 6], [4, 6], [0, 0], [4, 0]]],
  '0': [O_, [[0.6, 1.2], [3.4, 4.8]]],
  '1': [[[0.8, 4.8], [2.2, 6], [2.2, 0]], [[0.8, 0], [3.6, 0]]],
  '2': [[[0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [0, 0], [4, 0]]],
  '3': [[[0, 6], [3, 6], [4, 5], [4, 4.1], [3, 3.1], [1.2, 3.1]], [[3, 3.1], [4, 2.2], [4, 1], [3, 0], [0, 0]]],
  '4': [[[3, 0], [3, 6], [0, 2], [4, 2]]],
  '5': [[[4, 6], [0, 6], [0, 3.3], [3, 3.3], [4, 2.3], [4, 1], [3, 0], [0, 0]]],
  '6': [[[4, 6], [1, 6], [0, 5], [0, 1], [1, 0], [3, 0], [4, 1], [4, 2.3], [3, 3.3], [0, 3.3]]],
  '7': [[[0, 6], [4, 6], [1.4, 0]]],
  '8': [[[1, 3.1], [0, 4], [0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [3, 3.1], [1, 3.1], [0, 2.2], [0, 1], [1, 0], [3, 0], [4, 1], [4, 2.2], [3, 3.1]]],
  '9': [[[0, 0], [3, 0], [4, 1], [4, 5], [3, 6], [1, 6], [0, 5], [0, 3.7], [1, 2.7], [4, 2.7]]],
  '-': [[[0.8, 3], [3.2, 3]]],
  '.': [[[2, 0], [2, 0.7]]],
  '!': [[[2, 6], [2, 1.8]], [[2, 0.7], [2, 0]]],
  '/': [[[0, 0], [4, 6]]],
  // Cyrillic (С Р В А Е О Т Н К М map onto Latin glyphs)
  Л: [[[0, 0], [0.8, 0.6], [1.4, 6], [4, 6], [4, 0]]],
  И: [[[0, 6], [0, 0], [4, 6], [4, 0]]],
  Я: [[[4, 0], [4, 6], [1, 6], [0, 5], [0, 3.8], [1, 2.8], [4, 2.8]], [[2, 2.8], [0, 0]]],
  Г: [[[0, 0], [0, 6], [4, 6]]],
  П: [[[0, 0], [0, 6], [4, 6], [4, 0]]],
  Д: [[[0.4, 0], [1.2, 6], [3.6, 6], [3.6, 0]], [[-0.4, -1], [-0.4, 0], [4.4, 0], [4.4, -1]]],
  У: [[[0, 6], [0, 3.6], [1, 2.6], [4, 2.6]], [[4, 6], [4, 1], [3, 0], [0.4, 0]]],
  З: [[[0, 6], [3, 6], [4, 5], [4, 4.1], [3, 3.1], [1.2, 3.1]], [[3, 3.1], [4, 2.2], [4, 1], [3, 0], [0, 0]]],
  Ь: [[[0, 6], [0, 0], [3, 0], [4, 1], [4, 2.2], [3, 3.2], [0, 3.2]]],
  Э: [[[0, 6], [3, 6], [4, 5], [4, 1], [3, 0], [0, 0]], [[1.2, 3.1], [4, 3.1]]],
  Ф: [[[2, 0], [2, 6]], [[1, 5], [0, 4], [0, 3], [1, 2], [3, 2], [4, 3], [4, 4], [3, 5], [1, 5]]],
};
const CYR_ALIAS: Record<string, string> = { С: 'C', Р: 'P', В: 'B', А: 'A', Е: 'E', О: 'O', Т: 'T', Н: 'H', К: 'K', М: 'M', Х: 'X' };

const textCache = new Map<string, THREE.BufferGeometry>();

/**
 * Flat stencil-text geometry in the XY plane facing +Z, centred on the origin, letter height `h`.
 * `bold` = stroke weight relative to the letter height. One merged geometry (two triangles per stroke).
 */
export function stencilTextGeo(text: string, h: number, bold = 0.16, spacing = 0.32): THREE.BufferGeometry {
  const key = `${text}|${h.toFixed(4)}|${bold}|${spacing}`;
  const hit = textCache.get(key);
  if (hit) return hit;
  const u = h / 6;
  const t = h * bold;
  const adv = 4 * u + spacing * h;
  const chars = [...text];
  const total = chars.length * adv - spacing * h;
  const pos: number[] = [];
  const idx: number[] = [];
  let x0 = -total / 2;
  for (const ch0 of chars) {
    const ch = CYR_ALIAS[ch0] ?? ch0;
    const g = GLYPHS[ch] ?? GLYPHS[ch.toUpperCase()];
    if (g) {
      for (const line of g) {
        for (let k = 0; k < line.length - 1; k++) {
          const ax = x0 + line[k][0] * u, ay = line[k][1] * u - h / 2;
          const bx = x0 + line[k + 1][0] * u, by = line[k + 1][1] * u - h / 2;
          const dx = bx - ax, dy = by - ay;
          const len = Math.hypot(dx, dy) || 1;
          const ex = (dx / len) * t * 0.5, ey = (dy / len) * t * 0.5; // square caps: joints overlap
          const nx = -ey, ny = ex;
          const base = pos.length / 3;
          pos.push(ax - ex + nx, ay - ey + ny, 0, ax - ex - nx, ay - ey - ny, 0, bx + ex - nx, by + ey - ny, 0, bx + ex + nx, by + ey + ny, 0);
          idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
      }
    }
    x0 += adv;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  // winding may vary per stroke: force +Z normals and fix the order
  const P = geo.getAttribute('position').array as Float32Array;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const cz = (P[b] - P[a]) * (P[c + 1] - P[a + 1]) - (P[b + 1] - P[a + 1]) * (P[c] - P[a]);
    if (cz < 0) {
      const tmp = idx[i + 1];
      idx[i + 1] = idx[i + 2];
      idx[i + 2] = tmp;
    }
  }
  geo.setIndex(idx);
  const nrm = new Float32Array(pos.length);
  for (let i = 2; i < nrm.length; i += 3) nrm[i] = 1;
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  textCache.set(key, geo);
  return geo;
}

/** Width of a stencil text line (same metrics as stencilTextGeo). */
export function stencilTextWidth(text: string, h: number, spacing = 0.32): number {
  const n = [...text].length;
  return n * ((4 / 6) * h + spacing * h) - spacing * h;
}

/**
 * Stencilled text on a vertical face facing +Z (rotate with r), centred at p, letter height h.
 * Big slogans keep showing from afar (lod -1); small labels are close-up detail.
 */
export function stencilText(nb: NB, text: string, p: V3, r: V3 = [0, 0, 0], h = 0.06, mat: Mat = S.stencilWhite, bold = 0.16): void {
  nb.add(stencilTextGeo(text, h, bold), mat, { p, r, keepUv: false, lod: h >= 0.05 ? undefined : 0 });
}

// ---------------------------------------------------------------------------------------------
// Emblems
// ---------------------------------------------------------------------------------------------

let eagleCache: THREE.BufferGeometry | null = null;

/** Heraldic spread eagle silhouette in the XY plane facing +Z, about 2 wide x 1.2 tall (unit scale). */
export function eagleGeo(): THREE.BufferGeometry {
  if (eagleCache) return eagleCache;
  const half: P2[] = [
    [0.0, 0.72], [0.09, 0.69], [0.12, 0.6], [0.2, 0.52], [0.48, 0.66], [0.82, 0.84], [1.0, 0.82],
    [0.9, 0.66], [0.98, 0.6], [0.82, 0.48], [0.9, 0.4], [0.72, 0.31], [0.77, 0.21], [0.56, 0.18],
    [0.4, 0.2], [0.22, 0.1], [0.17, -0.1], [0.32, -0.42], [0.13, -0.34], [0.0, -0.46],
  ];
  const pts: P2[] = [...half, ...half.slice(1, -1).reverse().map(([x, y]) => [-x, y] as P2)];
  // the head looks to the viewer's left: a small beak
  const beak: P2[] = [[-0.04, 0.68], [-0.22, 0.63], [-0.06, 0.58]];
  const g1 = new THREE.ShapeGeometry(shapeFrom(pts.reverse()));
  const g2 = new THREE.ShapeGeometry(shapeFrom(beak.reverse()));
  const merged = mergeGeoms([g1, g2]);
  merged.translate(0, -0.13, 0);
  eagleCache = merged;
  return merged;
}

function mergeGeoms(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (const g of list) {
    const base = pos.length / 3;
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) pos.push(p.getX(i), p.getY(i), p.getZ(i));
    const ia = g.index ? (g.index.array as ArrayLike<number>) : [...Array(p.count).keys()];
    for (let i = 0; i < ia.length; i++) idx.push(base + ia[i]);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const nrm = new Float32Array(pos.length);
  for (let i = 2; i < nrm.length; i += 3) nrm[i] = 1;
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setIndex(idx);
  return out;
}

/**
 * Faction emblem on a vertical face facing +Z (rotate with r): Soviet = red star with a gold rim,
 * Allied = white eagle (or a white star in a blue roundel when `roundel`).
 */
export function emblem(nb: NB, fac: Fac, size: number, p: V3, r: V3 = [0, 0, 0], roundel = false): void {
  const n = new NB('_emb', p, r);
  if (fac === 'soviet') {
    n.add(starGeo(size * 1.2), S.stencilYellow, { r: faceRot('+z') });
    n.add(starGeo(size), M.red, { p: [0, 0, 0.002], r: faceRot('+z') });
  } else if (roundel) {
    n.add(discGeo(size * 1.15, 0.001, 12), M.navy, { r: [Math.PI / 2, 0, 0] });
    n.add(starGeo(size, 0, 0.4), M.white, { p: [0, 0, 0.002], r: faceRot('+z') });
  } else {
    n.add(eagleGeo(), M.white, { s: [size, size, 1] });
  }
  mergeChild(nb, n);
}

// ---------------------------------------------------------------------------------------------
// Banners, slogan boards
// ---------------------------------------------------------------------------------------------

/**
 * Cloth banner hanging from a rod, front facing +Z after rotY, top centre at p (just off the wall).
 * Team-coloured cloth with a darker border, swallowtail end and the faction emblem (Soviet gold-rimmed star,
 * Allied white eagle). `free` = also a back face (flags and banners hanging in the open).
 */
export function banner(nb: NB, fac: Fac, w: number, h: number, p: V3, rotY = 0, free = false): void {
  const n = new NB('_ban', p, [0, rotY, 0]);
  n.cyl(M.dark, 0.008, 0.008, w + 0.05, 0, 0, 0, { r: [0, 0, Math.PI / 2], seg: 5 });
  n.sph(M.brass, 0.012, -(w / 2 + 0.03), 0, 0, { seg: 4 });
  n.sph(M.brass, 0.012, w / 2 + 0.03, 0, 0, { seg: 4 });
  const notch = fac === 'soviet' ? h * 0.12 : 0;
  const cloth: P2[] = [
    [-w / 2, -0.01],
    [w / 2, -0.01],
    [w / 2, -h],
    [0, -h + notch],
    [-w / 2, -h],
  ];
  const border: P2[] = cloth.map(([x, y]) => [x * 1.0, y] as P2);
  // darker border cloth behind, main cloth inset in front
  n.add(new THREE.ShapeGeometry(shapeFrom(border)), S.clothDark, { p: [0, 0, 0.004] });
  const inset = Math.min(w, h) * 0.07;
  const inner: P2[] = [
    [-w / 2 + inset, -0.01 - inset * 0.6],
    [w / 2 - inset, -0.01 - inset * 0.6],
    [w / 2 - inset, -h + inset * 1.4],
    [0, -h + notch + inset * 1.2],
    [-w / 2 + inset, -h + inset * 1.4],
  ];
  n.add(new THREE.ShapeGeometry(shapeFrom(inner)), S.cloth, { p: [0, 0, 0.007] });
  const ey = -h * 0.36;
  const es = Math.min(w * 0.36, h * 0.3);
  const e = new NB('_be', [0, ey, 0.009]);
  emblem(e, fac, es, [0, 0, 0]);
  mergeChild(n, e);
  if (fac === 'soviet') {
    // gold bars under the star
    n.box(S.stencilYellow, w * 0.56, h * 0.025, 0.002, 0, -h * 0.68, 0.009, { b: 0 });
    n.box(S.stencilYellow, w * 0.56, h * 0.025, 0.002, 0, -h * 0.73, 0.009, { b: 0 });
  }
  if (free) n.add(new THREE.ShapeGeometry(shapeFrom(border)), S.clothDark, { p: [0, 0, 0.001], r: [0, Math.PI, 0] });
  mergeChild(nb, n);
}

/**
 * Slogan board: framed panel with stencilled text (Soviet red board, Allied navy board) facing +Z after
 * rotY, centred at p. Optional emblem at the right end.
 */
export function sloganBoard(nb: NB, fac: Fac, text: string, w: number, h: number, p: V3, rotY = 0, withEmblem = true, lines?: string[]): void {
  const n = new NB('_slg', p, [0, rotY, 0]);
  n.box(M.dark, w + 0.03, h + 0.03, 0.02, 0, 0, 0, { b: 0.005 });
  n.box(fac === 'soviet' ? M.teamDark : S.signBlue, w, h, 0.02, 0, 0, 0.006, { b: 0.003 });
  const em = withEmblem ? h * 0.36 : 0;
  const textW = w - (withEmblem ? h * 0.95 : 0) - h * 0.2;
  const rows = lines ?? [text];
  const lh = Math.min((h * 0.72) / rows.length, (h * 0.62) / Math.max(1, rows.length - 0.3));
  for (let i = 0; i < rows.length; i++) {
    const tw = stencilTextWidth(rows[i], lh * 0.78);
    const scale = Math.min(1, textW / tw);
    const y = ((rows.length - 1) / 2 - i) * lh;
    // faintly self-lit lettering: reads at night, dims with the power
    n.add(stencilTextGeo(rows[i], lh * 0.78 * scale), { glow: 0xfff0e0, i: 0.3 }, {
      p: [withEmblem ? -h * 0.45 : 0, y, 0.0175],
    });
  }
  if (withEmblem) emblem(n, fac, em, [w / 2 - h * 0.5, 0, 0.0175]);
  // sign lamps on short arms above the board
  for (const sx of w > 0.5 ? [-0.3, 0.3] : [0]) {
    n.box(M.dark, 0.008, 0.008, 0.06, sx * w, h / 2 + 0.03, 0.03, { b: 0 });
    n.box(M.dark, 0.05, 0.016, 0.03, sx * w, h / 2 + 0.03, 0.06, { b: 0 });
    n.add(quadGeo(0.044, 0.024), { glow: 0xffe2b0, i: 2 }, { p: [sx * w, h / 2 + 0.02, 0.076], r: [0.5, 0, 0] });
  }
  mergeChild(nb, n);
}

// ---------------------------------------------------------------------------------------------
// Lights
// ---------------------------------------------------------------------------------------------

/** Red warning light with a dark housing (baked into the body; blinks in the shader unless steady). */
export function warnLight(nb: NB, p: V3, steady = false, size = 0.02, glow: Glow = { glow: 0xff2414, i: 2.2 }): void {
  nb.box(M.dark, size * 1.6, size * 0.8, size * 1.6, p[0], p[1] - size * 0.7, p[2], { b: 0 });
  nb.add(new THREE.OctahedronGeometry(size * 0.8, 0), { ...glow, a: steady ? 0 : 1 + ((p[0] * 7.3 + p[2] * 3.1 + 10) % 1) * 0.99 }, { p, s: [1, 1.2, 1] });
}

/** Ring of steady red lights around the rim of a stack (a glowing red crown). */
export function lightRing(nb: NB, x: number, y: number, z: number, rad: number, n = 6, glow: Glow = { glow: 0xff2414, i: 2.4 }): void {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    nb.add(new THREE.OctahedronGeometry(0.014, 0), glow, { p: [x + Math.cos(a) * rad, y, z + Math.sin(a) * rad] });
  }
}

/**
 * Floodlight: bracket + angled housing with a glowing lens, mounted at p, aiming toward local +Z after yaw,
 * tilted down by pitch.
 */
export function floodlight(nb: NB, p: V3, yaw = 0, pitch = 0.6, size = 0.04, glow: Glow = { glow: 0xf4f6ff, i: 2.6 }): void {
  const n = new NB('_fl', p, [0, yaw, 0]);
  n.box(M.dark, size * 0.25, size * 0.25, size * 0.9, 0, 0, -size * 0.3, { b: 0 });
  const h = new NB('_flh', [0, 0, size * 0.15], [pitch, 0, 0]);
  h.box(M.gun, size * 1.2, size * 0.8, size * 0.6, 0, 0, 0, { b: size * 0.1 });
  h.add(quadGeo(size * 1.0, size * 0.62), glow, { p: [0, 0, size * 0.305] });
  mergeChild(n, h);
  mergeChild(nb, n);
}

/** Lamp post with a hooded lamp (body-baked glow) at (x, y0, z), lamp hanging toward +Z after rotY. */
export function lampPost(nb: NB, x: number, y0: number, z: number, h = 0.42, rotY = 0, glow: Glow = { glow: 0xffd49a, i: 2.2 }): void {
  const n = new NB('_lp', [x, y0, z], [0, rotY, 0]);
  n.cyl(M.dark, 0.008, 0.012, h, 0, h / 2, 0, { seg: 5 });
  n.lod = 0;
  n.box(M.dark, 0.012, 0.012, 0.08, 0, h - 0.01, 0.035, { b: 0 });
  n.box(M.gun, 0.04, 0.018, 0.05, 0, h - 0.02, 0.075, { b: 0.004 });
  n.add(quadGeo(0.032, 0.04), glow, { p: [0, h - 0.0295, 0.075], r: [Math.PI / 2, 0, 0] });
  mergeChild(nb, n);
}

// ---------------------------------------------------------------------------------------------
// Catwalks, railings, pipes, stairs
// ---------------------------------------------------------------------------------------------

/** Railing between two points at the same height (posts every ~0.1, top and mid rails). */
export function railLine(nb: NB, a: V3, b: V3, h = 0.07, mat: Mat = M.yellow): void {
  if (nb.lod === undefined) {
    const d = detailNode(nb);
    railLine(d, a, b, h, mat);
    mergeChild(nb, d);
    return;
  }
  const dx = b[0] - a[0], dz = b[2] - a[2];
  const len = Math.hypot(dx, dz);
  if (len < 0.01) return;
  const yaw = -Math.atan2(dz, dx);
  const cx = (a[0] + b[0]) / 2, cz = (a[2] + b[2]) / 2;
  const n = new NB('_rl', [cx, a[1], cz], [0, yaw, 0]);
  n.lod = nb.lod;
  const k = Math.max(1, Math.round(len / 0.11));
  for (let i = 0; i <= k; i++) n.box(mat, 0.007, h, 0.007, -len / 2 + (len * i) / k, h / 2, 0, { b: 0 });
  n.box(mat, len, 0.008, 0.008, 0, h, 0, { b: 0 });
  n.box(mat, len, 0.006, 0.006, 0, h * 0.52, 0, { b: 0 });
  mergeChild(nb, n);
}

/**
 * Catwalk along X at height y, centred at (x, z): grating deck, brackets into the wall behind (-Z) and a
 * railing on the open side (+Z) after rotY.
 */
export function catwalk(nb: NB, x: number, y: number, z: number, len: number, depth = 0.09, rotY = 0, rail: Mat = M.yellow): void {
  const n = new NB('_cw', [x, y, z], [0, rotY, 0]);
  n.box(S.grating, len, 0.012, depth, 0, 0, 0, { b: 0 });
  n.lod = 0; // brackets and railing: close-up
  n.box(M.dark, len, 0.02, 0.012, 0, -0.008, depth / 2, { b: 0 });
  const k = Math.max(1, Math.round(len / 0.3));
  for (let i = 0; i <= k; i++) {
    const bx = -len / 2 + (len * i) / k;
    n.box(M.dark, 0.012, 0.05, depth * 0.9, bx, -0.03, -depth * 0.05, { b: 0, r: [0.5, 0, 0] });
  }
  railLine(n, [-len / 2, 0.006, depth / 2 - 0.006], [len / 2, 0.006, depth / 2 - 0.006], 0.07, rail);
  mergeChild(nb, n);
}

/** Pipe through a list of points with flanged joints at the bends and clamps (supports) at the ends. */
export function pipeRun(nb: NB, pts: V3[], r: number, mat: Mat = M.steel, seg = 6): void {
  // thin pipes are close-up detail; big ones keep their runs in the distant body, joints only close up
  const main = r < 0.025 ? detailNode(nb) : nb;
  for (let i = 0; i < pts.length - 1; i++) pipe(main, pts[i], pts[i + 1], r, mat, seg);
  const j = detailNode(nb);
  for (let i = 1; i < pts.length - 1; i++) j.sph(mat, r * 1.35, pts[i][0], pts[i][1], pts[i][2], { seg: 6 });
  for (const q of [pts[0], pts[pts.length - 1]]) j.sph(M.dark, r * 1.5, q[0], q[1], q[2], { seg: 5 });
  if (main !== nb) mergeChild(nb, main);
  mergeChild(nb, j);
}

/** Temporary child node for close-up-only detail (merge it back with mergeChild). */
export function detailNode(nb: NB): NB {
  const n = new NB('_det');
  n.lod = nb.lod === 1 ? 1 : 0;
  return n;
}

/** External stair (stringers + treads) from (x, y0, z) rising toward +X after rotY by `rise` over `run`. */
export function stairs(nb: NB, x: number, y0: number, z: number, run: number, rise: number, w = 0.12, rotY = 0, mat: Mat = M.gun): void {
  const n = new NB('_st', [x, y0, z], [0, rotY, 0]);
  n.lod = 0;
  const len = Math.hypot(run, rise);
  const ang = Math.atan2(rise, run);
  for (const s of [-1, 1]) n.box(mat, len, 0.03, 0.01, run / 2, rise / 2, (s * w) / 2, { b: 0, r: [0, 0, ang] });
  const k = Math.max(2, Math.round(rise / 0.045));
  for (let i = 1; i < k; i++) n.box(S.grating, run / k, 0.006, w, (run * i) / k, (rise * i) / k, 0, { b: 0 });
  railLine(n, [0, 0, w / 2], [0, 0, w / 2], 0.07);
  pipe(n, [0, 0.08, w / 2], [run, rise + 0.08, w / 2], 0.004, M.yellow, 3);
  mergeChild(nb, n);
}

// ---------------------------------------------------------------------------------------------
// Roof clutter
// ---------------------------------------------------------------------------------------------

/** Box AC unit / blower on a roof at (x, y, z): casing, fan grille on top, side louvres. */
export function acUnit(nb: NB, x: number, y: number, z: number, rotY = 0, s = 1): void {
  const n = new NB('_ac', [x, y, z], [0, rotY, 0]);
  n.box(M.offwhite, 0.2 * s, 0.1 * s, 0.14 * s, 0, 0.05 * s, 0, { b: 0.01 * s });
  n.lod = 0; // fan, louvres: close-up
  n.add(discGeo(0.045 * s, 0.004, 10), M.darker, { p: [-0.045 * s, 0.1 * s, 0] });
  n.box(M.steel, 0.09 * s, 0.006, 0.006, -0.045 * s, 0.104 * s, 0, { b: 0 });
  n.box(M.steel, 0.006, 0.006, 0.09 * s, -0.045 * s, 0.104 * s, 0, { b: 0 });
  for (let i = 0; i < 4; i++) n.box(M.dark, 0.06 * s, 0.006, 0.004, 0.05 * s, 0.025 * s + i * 0.018 * s, 0.071 * s, { b: 0 });
  n.box(M.dark, 0.21 * s, 0.012, 0.15 * s, 0, 0.006, 0, { b: 0 });
  mergeChild(nb, n);
}

/** Mushroom roof vent / extractor. */
export function roofVent(nb: NB, x: number, y: number, z: number, r = 0.04): void {
  const n = new NB('_rv');
  n.cyl(M.gun, r * 0.7, r * 0.75, r * 1.6, x, y + r * 0.8, z, { seg: 8 });
  n.cyl(M.dark, r * 1.3, r * 0.9, r * 0.5, x, y + r * 1.75, z, { seg: 8 });
  mergeChild(nb, n);
}

/** Stack of crates (and a tarp) on a roof or yard. */
export function crateStack(nb: NB, x: number, y: number, z: number, s = 0.1, n = 3, rotY = 0): void {
  const mats = [M.olive, M.wood, M.oliveDark, M.khaki];
  const pts: V3[] = [
    [0, 0, 0],
    [s * 1.08, 0, 0.01],
    [s * 0.5, s, 0.0],
    [0.02, 0, s * 1.06],
  ];
  const g = new NB('_cs', [x, y, z], [0, rotY, 0]);
  for (let i = 0; i < Math.min(n, pts.length); i++) {
    const [px, py, pz] = pts[i];
    const m = mats[i % mats.length];
    g.box(m, s, s * 0.9, s, px, py + s * 0.45, pz, { b: s * 0.08, r: [0, (i * 0.37) % 0.4, 0] });
    g.box(M.dark, s * 1.02, s * 0.1, s * 1.02, px, py + s * 0.45, pz, { b: 0, r: [0, (i * 0.37) % 0.4, 0] });
  }
  mergeChild(nb, g);
}

/** Cluster of oil drums. */
export function drums(nb0: NB, x: number, y: number, z: number, n = 3, mat: Mat = { c: 0x5a2a20, m: 0.4, r: 0.6, d: 0 }): void {
  const nb = new NB('_dr');
  const off: [number, number][] = [
    [0, 0],
    [0.07, 0.02],
    [0.03, 0.065],
    [-0.05, 0.05],
  ];
  for (let i = 0; i < Math.min(n, off.length); i++) {
    const m = i % 2 ? { ...mat, c: 0x3e4a2e } : mat;
    nb.cyl(m, 0.032, 0.032, 0.09, x + off[i][0], y + 0.045, z + off[i][1], { seg: 8 });
    nb.cyl(M.dark, 0.033, 0.033, 0.006, x + off[i][0], y + 0.06, z + off[i][1], { seg: 8 });
  }
  mergeChild(nb0, nb);
}

/** Parabolic dish antenna on a short stand at (x, y, z), facing yaw, tilted up by tilt. */
export function dish(nb: NB, x: number, y: number, z: number, rad = 0.12, yaw = 0, tilt = 0.7, mat: Mat = M.offwhite): void {
  const n = new NB('_dsh', [x, y, z], [0, yaw, 0]);
  n.cyl(M.gun, 0.012, 0.016, rad * 0.9, 0, rad * 0.45, 0, { seg: 6 });
  const d = new NB('_dd', [0, rad * 0.95, 0], [tilt - Math.PI / 2, 0, 0]);
  d.add(lathe([[0.0, 0.0], [rad * 0.45, rad * 0.06], [rad * 0.8, rad * 0.2], [rad, rad * 0.34]], 12), mat);
  d.cyl(M.dark, 0.004, 0.004, rad * 0.7, 0, rad * 0.35, 0, { seg: 3 });
  d.sph(M.gun, rad * 0.08, 0, rad * 0.7, 0, { seg: 4 });
  mergeChild(n, d);
  mergeChild(nb, n);
}

/** Lattice radio mast with crossbars and a blinking red light on top. */
export function radioMast(nb: NB, x: number, y: number, z: number, h: number, mat: Mat = M.dark): void {
  nb.cyl(mat, 0.006, 0.012, h, x, y + h / 2, z, { seg: 4 });
  for (let k = 1; k <= 3; k++) nb.box(mat, 0.1 - k * 0.02, 0.006, 0.006, x, y + (h * k) / 4, z, { b: 0 });
  pipe(nb, [x, y + h * 0.8, z], [x + 0.12, y, z + 0.06], 0.0025, M.steel, 3);
  pipe(nb, [x, y + h * 0.8, z], [x - 0.1, y, z - 0.08], 0.0025, M.steel, 3);
  warnLight(nb, [x, y + h + 0.012, z], false, 0.014);
}

// ---------------------------------------------------------------------------------------------
// Walls & facades
// ---------------------------------------------------------------------------------------------

/** Vertical pilasters / ribs along a facade (face toward +Z after rotY), from x0 to x1, base y0, height h. */
export function ribs(nb: NB, mat: Mat, x0: number, x1: number, y0: number, h: number, z: number, n: number, w = 0.04, depth = 0.03, rotY = 0): void {
  const g = new NB('_rb', [0, 0, 0], [0, rotY, 0]);
  for (let i = 0; i < n; i++) {
    const x = n === 1 ? (x0 + x1) / 2 : x0 + ((x1 - x0) * i) / (n - 1);
    g.box(mat, w, h, depth, x, y0 + h / 2, z + depth / 2, { b: 0.006 });
  }
  mergeChild(nb, g);
}

/** Low parapet wall around a flat roof (w x d at height y, centred at x, z) with a cap. */
export function parapet(nb: NB, mat: Mat, w: number, d: number, y: number, x = 0, z = 0, h = 0.05, t = 0.035): void {
  nb.box(mat, w, h, t, x, y + h / 2, z - d / 2 + t / 2, { b: 0.006 });
  nb.box(mat, w, h, t, x, y + h / 2, z + d / 2 - t / 2, { b: 0.006 });
  nb.box(mat, t, h, d - 2 * t, x - w / 2 + t / 2, y + h / 2, z, { b: 0.006 });
  nb.box(mat, t, h, d - 2 * t, x + w / 2 - t / 2, y + h / 2, z, { b: 0.006 });
}

/** Corrugated roof sheet along X on top of y: a dark sheet with raised ribs (team trims belong elsewhere). */
export function corrugated(nb: NB, mat: Mat, w: number, d: number, y: number, x = 0, z = 0, step = 0.07, alongZ = false): void {
  nb.box(mat, w, 0.014, d, x, y + 0.007, z, { b: 0.004 });
  const span = alongZ ? w : d;
  const k = Math.max(2, Math.floor(span / step));
  for (let i = 0; i < k; i++) {
    const o = -span / 2 + (span * (i + 0.5)) / k;
    if (alongZ) nb.box(mat, 0.012, 0.012, d, x + o, y + 0.018, z, { b: 0 });
    else nb.box(mat, w, 0.012, 0.012, x, y + 0.018, z + o, { b: 0 });
  }
}

/**
 * Industrial chimney: tapered stack with bands, ladder, a dark rim and (Soviet) a crown of red lights;
 * adds the smoke node `name` at the top. Returns the top y.
 */
export function chimney(nb: NB, name: string, x: number, z: number, y0: number, h: number, r0: number, r1: number, fac: Fac, mat: Mat = S.sovSteelLight): number {
  const top = y0 + h;
  nb.cyl(mat, r1, r0, h, x, y0 + h / 2, z, { seg: 14 });
  nb.cyl(M.dark, r0 * 1.08, r0 * 1.12, 0.05, x, y0 + 0.025, z, { seg: 14 });
  // bands: team colour high up, dark rings lower
  nb.cyl(M.team, r1 * 1.07, r1 * 1.08 + (r0 - r1) * 0.12, h * 0.1, x, top - h * 0.12, z, { seg: 14 });
  nb.cyl(fac === 'soviet' ? M.team : M.white, r1 * 1.07 + (r0 - r1) * 0.25, r1 * 1.07 + (r0 - r1) * 0.3, h * 0.05, x, top - h * 0.27, z, { seg: 14 });
  for (const f of [0.35, 0.6]) {
    const rr = r0 + (r1 - r0) * f;
    nb.cyl(M.dark, rr * 1.04, rr * 1.04, 0.018, x, y0 + h * f, z, { seg: 14 });
  }
  nb.cyl(M.darker, r1 * 1.1, r1 * 1.12, 0.035, x, top - 0.0175, z, { seg: 14 });
  nb.cyl(M.darker, r1 * 0.88, r1 * 0.88, 0.004, x, top + 0.001, z, { seg: 12 });
  if (fac === 'soviet') lightRing(nb, x, top - 0.045, z, r1 * 1.14, 6);
  else warnLight(nb, [x + r1 * 1.1, top - 0.03, z], false, 0.016);
  ladder(nb, h * 0.92, [x, y0 + 0.04, z + r0 * 0.98], 0);
  nb.node(name, [x, top + 0.03, z]);
  return top;
}
