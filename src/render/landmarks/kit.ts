/**
 * A small modelling kit for World Conquest scenery (landmarks and civilian buildings), on top of the game's own
 * template builder (models/builder.ts): every shape goes into an NB with a surface (Mat / Glow), so the result
 * merges into ONE body mesh drawn with the shared body material (weather, snow, cavity AO, damage and the
 * night-lit windows come for free, and nothing compiles a new shader).
 *
 * Shapes are built bottom-up (y0 = the bottom of a part) in model units (1 unit = 1 map cell). `Poly` is a
 * flat-shaded triangle soup for the faceted shapes (beams, trusses, prisms, roofs, frusta); smooth shapes
 * (domes, onion domes, drums) are lathes. Nothing here is random: callers pass seeds (`rng`) for variety.
 */
import * as THREE from 'three';
import { NB, type AddOpts, type Glow, type Mat, type Surface, type V3 } from '../models/builder';

export type Detail = 'low' | 'high';

// ---------------------------------------------------------------------------------------------------------
// palette (sRGB hex; d = detail channel of the body material: 0 metal, 1 concrete / stone, 2 organic, 3 none)
// ---------------------------------------------------------------------------------------------------------

/** Stone, plaster, metal and roof surfaces shared by the landmarks and the city styles. */
export const P = {
  limestone: { c: 0xcfc3a6, m: 0, r: 0.9, d: 1 },
  limestoneDark: { c: 0xa4987c, m: 0, r: 0.92, d: 1 },
  sandstone: { c: 0xc89a66, m: 0, r: 0.92, d: 1 },
  sandstoneDark: { c: 0x9c7348, m: 0, r: 0.94, d: 1 },
  redstone: { c: 0xb0603e, m: 0, r: 0.92, d: 1 },
  granite: { c: 0x8f8d88, m: 0, r: 0.9, d: 1 },
  graniteDark: { c: 0x66645f, m: 0, r: 0.92, d: 1 },
  basalt: { c: 0x6d6158, m: 0, r: 0.92, d: 1 },
  marble: { c: 0xe8e4da, m: 0, r: 0.55, d: 1 },
  marbleShade: { c: 0xc9c3b6, m: 0, r: 0.6, d: 1 },
  travertine: { c: 0xd2b98e, m: 0, r: 0.92, d: 1 },
  brick: { c: 0x9a4a32, m: 0, r: 0.9, d: 1 },
  brickDark: { c: 0x6e3424, m: 0, r: 0.92, d: 1 },
  brickYellow: { c: 0xc4a46a, m: 0, r: 0.9, d: 1 },
  plaster: { c: 0xe6dfcf, m: 0, r: 0.88, d: 1 },
  adobe: { c: 0xb88a5e, m: 0, r: 0.95, d: 1 },
  concrete: { c: 0xa9a397, m: 0, r: 0.92, d: 1 },
  slate: { c: 0x4c525a, m: 0.05, r: 0.7, d: 3 },
  tile: { c: 0xa9502e, m: 0, r: 0.75, d: 3 },
  tileGlazedYellow: { c: 0xd9a628, m: 0.1, r: 0.35, d: 3 },
  tileGlazedGreen: { c: 0x3f7a4c, m: 0.1, r: 0.4, d: 3 },
  tileBlue: { c: 0x2f78b8, m: 0.1, r: 0.35, d: 3 },
  tileTurquoise: { c: 0x2aa5b0, m: 0.1, r: 0.35, d: 3 },
  thatch: { c: 0x9c8350, m: 0, r: 0.98, d: 2 },
  tin: { c: 0x8c9196, m: 0.6, r: 0.45, d: 0 },
  tinRust: { c: 0x8a5a3c, m: 0.45, r: 0.6, d: 0 },
  wood: { c: 0x7a5434, m: 0, r: 0.85, d: 2 },
  woodDark: { c: 0x4a3322, m: 0, r: 0.88, d: 2 },
  woodRed: { c: 0x8e2a20, m: 0, r: 0.8, d: 2 },
  lacquerRed: { c: 0xa3231b, m: 0.05, r: 0.5, d: 3 },
  iron: { c: 0x5e4a3a, m: 0.6, r: 0.55, d: 0 },
  ironDark: { c: 0x3a3330, m: 0.6, r: 0.55, d: 0 },
  steel: { c: 0x8a9096, m: 0.7, r: 0.4, d: 0 },
  steelGrey: { c: 0x6c7176, m: 0.6, r: 0.45, d: 0 },
  bridgeRed: { c: 0xc0442a, m: 0.4, r: 0.5, d: 0 },
  verdigris: { c: 0x6fae98, m: 0.25, r: 0.55, d: 3 },
  verdigrisDark: { c: 0x4d8a76, m: 0.25, r: 0.6, d: 3 },
  copper: { c: 0xb8743e, m: 0.85, r: 0.35, d: 3 },
  gold: { c: 0xe4b440, m: 0.9, r: 0.3, d: 3 },
  dark: { c: 0x26282c, m: 0.2, r: 0.7, d: 3 },
  black: { c: 0x18181a, m: 0.1, r: 0.8, d: 3 },
  white: { c: 0xe9e6de, m: 0, r: 0.7, d: 1 },
  glass: { c: 0x2c3c4a, m: 0.6, r: 0.12, d: 3 },
  water: { c: 0x3b6e86, m: 0.3, r: 0.08, d: 3, snow: 0 },
  foam: { c: 0xe8f0f2, m: 0, r: 0.5, d: 3, snow: 0 },
  grass: { c: 0x5f7a3a, m: 0, r: 0.95, d: 2 },
  sand: { c: 0xd2b47c, m: 0, r: 0.96, d: 2 },
  snowcap: { c: 0xf0f2f4, m: 0, r: 0.8, d: 3 },
} satisfies Record<string, Mat>;

/** Window glass that lights up at night (baked emissive; dark glass by day). */
export const WIN: Glow = { glow: 0xffd9a0, i: 0.62 };
/** Floodlights / lamps (warm, brighter). */
export const LAMP: Glow = { glow: 0xffe2b0, i: 1.4 };

/** A surface with another base colour. */
export const tint = (m: Mat, c: number): Mat => ({ ...m, c });

// ---------------------------------------------------------------------------------------------------------
// deterministic helpers
// ---------------------------------------------------------------------------------------------------------

/** Small fast seeded generator (mulberry32): returns [0, 1). */
export function rng(seed: number): () => number {
  let a = (seed | 0) ^ 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** String hash (FNV-1a) for seeds from ids. */
export function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

function h2(x: number, y: number, s: number): number {
  let h = (x * 374761393 + y * 668265263 + s * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth 2D value noise in [0, 1). */
export function noise2(x: number, y: number, seed = 0): number {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = h2(x0, y0, seed), b = h2(x0 + 1, y0, seed), c = h2(x0, y0 + 1, seed), d = h2(x0 + 1, y0 + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Fractal value noise in about [0, 1). */
export function fbm2(x: number, y: number, oct = 4, seed = 0): number {
  let s = 0, amp = 0.5, n = 0, f = 1;
  for (let o = 0; o < oct; o++) {
    s += noise2(x * f, y * f, seed + o * 31) * amp;
    n += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return s / n;
}

// ---------------------------------------------------------------------------------------------------------
// Poly: flat-shaded triangle soup
// ---------------------------------------------------------------------------------------------------------

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _u = new THREE.Vector3();
const _w = new THREE.Vector3();
const _t = new THREE.Vector3();

/** Flat-shaded triangle soup (front faces counter-clockwise seen from outside). */
export class Poly {
  readonly p: number[] = [];
  /** Optional transform applied to every point added (a rotation + translation: a facade's local frame). */
  xf: THREE.Matrix4 | null = null;

  get tris(): number {
    return this.p.length / 9;
  }

  tri(a: V3, b: V3, c: V3): this {
    const m = this.xf;
    if (m) {
      for (const q of [a, b, c]) {
        _t.set(q[0], q[1], q[2]).applyMatrix4(m);
        this.p.push(_t.x, _t.y, _t.z);
      }
      return this;
    }
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    return this;
  }

  /** Quad a-b-c-d counter-clockwise seen from its front. */
  quad(a: V3, b: V3, c: V3, d: V3): this {
    return this.tri(a, b, c).tri(a, c, d);
  }

  /** Convex polygon (fan), counter-clockwise seen from its front. */
  fan(pts: V3[]): this {
    for (let i = 1; i < pts.length - 1; i++) this.tri(pts[0], pts[i], pts[i + 1]);
    return this;
  }

  /**
   * Side walls between two loops of equal length (both counter-clockwise seen from above): `lo` below `hi`.
   * Faces point outward.
   */
  loft(lo: V3[], hi: V3[], closed = true): this {
    const n = lo.length;
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const j = (i + 1) % n;
      this.quad(lo[i], lo[j], hi[j], hi[i]);
    }
    return this;
  }

  /** Cap a loop (counter-clockwise seen from above): up = facing +y. */
  cap(loop: V3[], up: boolean): this {
    return this.fan(up ? loop : [...loop].reverse());
  }

  /** Axis-aligned box: centre x / z, bottom y0. `bottom` adds the underside. */
  box(x: number, y0: number, z: number, w: number, h: number, d: number, bottom = false): this {
    return this.frustum(x, y0, z, w, d, w, d, h, true, bottom);
  }

  /** Box rotated about y by `ry` (radians), centre x / z, bottom y0. */
  boxR(x: number, y0: number, z: number, w: number, h: number, d: number, ry: number): this {
    const c = Math.cos(ry), s = Math.sin(ry);
    const pt = (dx: number, y: number, dz: number): V3 => [x + dx * c + dz * s, y, z - dx * s + dz * c];
    const lo = [pt(-w / 2, y0, d / 2), pt(w / 2, y0, d / 2), pt(w / 2, y0, -d / 2), pt(-w / 2, y0, -d / 2)];
    const hi = lo.map((q) => [q[0], y0 + h, q[2]] as V3);
    return this.loft(lo, hi).cap(hi, true);
  }

  /**
   * Truncated pyramid: rectangle w0 x d0 at y0 to w1 x d1 at y0 + h (centred on x / z). A zero top size gives a
   * pyramid; `top` / `bottom` cap the ends.
   */
  frustum(x: number, y0: number, z: number, w0: number, d0: number, w1: number, d1: number, h: number, top = true, bottom = false, dx1 = 0, dz1 = 0): this {
    const y1 = y0 + h;
    const lo: V3[] = [[x - w0 / 2, y0, z + d0 / 2], [x + w0 / 2, y0, z + d0 / 2], [x + w0 / 2, y0, z - d0 / 2], [x - w0 / 2, y0, z - d0 / 2]];
    const cx = x + dx1, cz = z + dz1;
    if (w1 <= 1e-6 && d1 <= 1e-6) {
      const apex: V3 = [cx, y1, cz];
      for (let i = 0; i < 4; i++) this.tri(lo[i], lo[(i + 1) % 4], apex);
    } else {
      const hi: V3[] = [[cx - w1 / 2, y1, cz + d1 / 2], [cx + w1 / 2, y1, cz + d1 / 2], [cx + w1 / 2, y1, cz - d1 / 2], [cx - w1 / 2, y1, cz - d1 / 2]];
      this.loft(lo, hi);
      if (top) this.cap(hi, true);
    }
    if (bottom) this.cap(lo, false);
    return this;
  }

  /** Square-section beam from a to b (thickness t, or t x t2), e.g. truss members, cables, struts. */
  beam(a: V3, b: V3, t: number, t2 = t): this {
    _a.set(a[0], a[1], a[2]);
    _b.set(b[0], b[1], b[2]);
    _w.subVectors(_b, _a);
    const len = _w.length();
    if (len < 1e-6) return this;
    _w.multiplyScalar(1 / len);
    // a stable side vector: horizontal where possible
    if (Math.abs(_w.y) < 0.95) _u.set(-_w.z, 0, _w.x).normalize();
    else _u.set(1, 0, 0);
    _c.crossVectors(_w, _u).normalize();
    const hu = t / 2, hc = t2 / 2;
    const corner = (base: THREE.Vector3, su: number, sc: number): V3 => [
      base.x + _u.x * su * hu + _c.x * sc * hc,
      base.y + _u.y * su * hu + _c.y * sc * hc,
      base.z + _u.z * su * hu + _c.z * sc * hc,
    ];
    const ring = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const A = ring.map(([su, sc]) => corner(_a, su, sc));
    const B = ring.map(([su, sc]) => corner(_b, su, sc));
    // orientation: the loop (u, c) is counter-clockwise around w when u x c = w
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      this.quad(A[i], A[j], B[j], B[i]);
    }
    this.fan([...A].reverse()).fan(B);
    return this;
  }

  /** Prism along x: a profile in (z, y) (counter-clockwise seen from +x) from x0 to x1, with end caps. */
  prismX(profile: [number, number][], x0: number, x1: number, cx = 0, cz = 0): this {
    const L = profile.map(([z, y]) => [cx + x0, y, cz + z] as V3);
    const R = profile.map(([z, y]) => [cx + x1, y, cz + z] as V3);
    const n = profile.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.quad(R[i], L[i], L[j], R[j]);
    }
    this.fan(R).fan([...L].reverse());
    return this;
  }

  /** Prism along z: a profile in (x, y) (counter-clockwise seen from +z) from z0 to z1. */
  prismZ(profile: [number, number][], z0: number, z1: number, cx = 0, cz = 0): this {
    const B = profile.map(([x, y]) => [cx + x, y, cz + z0] as V3);
    const F = profile.map(([x, y]) => [cx + x, y, cz + z1] as V3);
    const n = profile.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.quad(F[i], B[i], B[j], F[j]);
    }
    this.fan(F).fan([...B].reverse());
    return this;
  }

  /** Regular n-sided prism / frustum (cylinder-like, faceted) of radii r0 -> r1 from y0 up h. */
  ngon(x: number, y0: number, z: number, r0: number, r1: number, h: number, n: number, rot = 0, top = true): this {
    const lo: V3[] = [], hi: V3[] = [];
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * Math.PI * 2;
      lo.push([x + Math.cos(a) * r0, y0, z - Math.sin(a) * r0]);
      hi.push([x + Math.cos(a) * r1, y0 + h, z - Math.sin(a) * r1]);
    }
    if (r1 <= 1e-6) {
      for (let i = 0; i < n; i++) this.tri(lo[i], lo[(i + 1) % n], [x, y0 + h, z]);
      return this;
    }
    this.loft(lo, hi);
    if (top) this.cap(hi, true);
    return this;
  }

  /** Vertical wall of thickness t from ground point (x0, z0) to (x1, z1), from y0 up h. */
  wall(x0: number, z0: number, x1: number, z1: number, y0: number, h: number, t: number): this {
    const dx = x1 - x0, dz = z1 - z0;
    return this.boxR((x0 + x1) / 2, y0, (z0 + z1) / 2, Math.hypot(dx, dz), h, t, Math.atan2(-dz, dx));
  }

  /** Append another soup transformed by a matrix. */
  merge(o: Poly, m?: THREE.Matrix4): this {
    if (!m) {
      for (const v of o.p) this.p.push(v);
      return this;
    }
    const v = new THREE.Vector3();
    for (let i = 0; i < o.p.length; i += 3) {
      v.set(o.p[i], o.p[i + 1], o.p[i + 2]).applyMatrix4(m);
      this.p.push(v.x, v.y, v.z);
    }
    if (m.determinant() < 0) {
      // mirrored: swap winding
      const base = this.p.length - o.p.length;
      for (let t = base; t < this.p.length; t += 9) {
        for (let k = 0; k < 3; k++) {
          const tmp = this.p[t + 3 + k];
          this.p[t + 3 + k] = this.p[t + 6 + k];
          this.p[t + 6 + k] = tmp;
        }
      }
    }
    return this;
  }

  geo(): THREE.BufferGeometry | null {
    // drop degenerate triangles (collapsed ridges, zero-size caps): their zero normals are NaN on real GPUs
    const src = this.p;
    const out: number[] = [];
    for (let i = 0; i < src.length; i += 9) {
      const ux = src[i + 3] - src[i], uy = src[i + 4] - src[i + 1], uz = src[i + 5] - src[i + 2];
      const vx = src[i + 6] - src[i], vy = src[i + 7] - src[i + 1], vz = src[i + 8] - src[i + 2];
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      if (cx * cx + cy * cy + cz * cz < 1e-14) continue;
      for (let k = 0; k < 9; k++) out.push(src[i + k]);
    }
    if (!out.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
    g.computeVertexNormals(); // non-indexed: flat face normals
    return g;
  }
}

/** Add a soup to a builder with one surface (no-op when empty). */
export function put(nb: NB, poly: Poly, surf: Surface, o: AddOpts = {}): void {
  const g = poly.geo();
  if (g) nb.add(g, surf, o);
}

// ---------------------------------------------------------------------------------------------------------
// smooth shapes
// ---------------------------------------------------------------------------------------------------------

/** Surface of revolution: profile [radius, y] bottom to top (outward normals), `seg` sides. */
export function latheGeo(pts: [number, number][], seg: number): THREE.BufferGeometry {
  const ordered = pts[0][1] > pts[pts.length - 1][1] ? [...pts].reverse() : pts;
  return new THREE.LatheGeometry(ordered.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-4), y)), seg);
}

/** Dome profile: radius r, height h (h = r gives a hemisphere), from y = 0, closing at the top. */
export function domeProfile(r: number, h: number, rings: number, flare = 0): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= rings; i++) {
    const a = (i / rings) * Math.PI / 2;
    out.push([r * Math.cos(a) * (1 + flare * Math.sin(a * 2)), h * Math.sin(a)]);
  }
  out[out.length - 1][0] = 0;
  return out;
}

/** Onion dome profile: neck radius `neck`, bulge r at about 40 % height, a pointed tip at h. */
export function onionProfile(r: number, h: number, neck: number, rings: number): [number, number][] {
  const out: [number, number][] = [[neck, 0]];
  for (let i = 1; i <= rings; i++) {
    const t = i / rings;
    // bulge then a concave taper into the spike
    const bulge = Math.sin(Math.min(1, t / 0.42) * Math.PI / 2);
    const taper = t < 0.42 ? 1 : Math.pow(1 - (t - 0.42) / 0.58, 1.6);
    const rr = t < 0.42 ? neck + (r - neck) * bulge : r * taper;
    out.push([Math.max(0.0001, rr), h * t]);
  }
  out[out.length - 1][0] = 0;
  return out;
}

/** Add a lathe to a builder at (x, y0, z). */
export function addLathe(nb: NB, surf: Surface, pts: [number, number][], seg: number, x: number, y0: number, z: number, o: AddOpts = {}): void {
  nb.add(latheGeo(pts, seg), surf, { ...o, p: [x, y0, z] });
}

/** Hemispherical / elliptical dome. */
export function dome(nb: NB, surf: Surface, r: number, h: number, x: number, y0: number, z: number, hi: boolean): void {
  addLathe(nb, surf, domeProfile(r, h, hi ? 7 : 4), hi ? 20 : 10, x, y0, z);
}

/** Onion dome with a small finial. */
export function onion(nb: NB, surf: Surface, r: number, h: number, x: number, y0: number, z: number, hi: boolean, finial: Surface | null = null): void {
  addLathe(nb, surf, onionProfile(r, h, r * 0.62, hi ? 10 : 5), hi ? 16 : 8, x, y0, z);
  if (finial) nb.add(new THREE.CylinderGeometry(0.0, r * 0.08, h * 0.35, 4), finial, { p: [x, y0 + h + h * 0.15, z] });
}

/** Smooth cylinder (drum) from y0 up h. */
export function drum(nb: NB, surf: Surface, r0: number, r1: number, h: number, x: number, y0: number, z: number, seg: number, o: AddOpts = {}): void {
  nb.add(new THREE.CylinderGeometry(r1, r0, h, seg, 1, false), surf, { ...o, p: [x, y0 + h / 2, z] });
}

/** Cone spire. */
export function spire(nb: NB, surf: Surface, r: number, h: number, x: number, y0: number, z: number, sides = 8, rot = 0): void {
  const p = new Poly().ngon(x, y0, z, r, 0, h, sides, rot);
  put(nb, p, surf);
}

// ---------------------------------------------------------------------------------------------------------
// architecture
// ---------------------------------------------------------------------------------------------------------

export interface ArchOpening {
  /** centre x along the wall */
  x: number;
  /** opening width */
  w: number;
  /** height where the arch springs (the straight jambs) */
  spring: number;
  /** bottom of the opening above the wall's base (0 = a doorway / arcade) */
  sill?: number;
  /** 'round' semicircle, 'pointed' Gothic / Islamic, 'flat' lintel, 'ogee' keel */
  top?: 'round' | 'pointed' | 'flat' | 'horseshoe';
}

/**
 * A wall in the x / y plane (thickness t along z, centred on z = 0) with arched openings. Built with a shape
 * and holes, extruded: the arches show through (seen through, not painted on).
 */
export function archWallGeo(w: number, h: number, t: number, holes: ArchOpening[], curveSeg: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(w / 2, h);
  s.lineTo(-w / 2, h);
  s.closePath();
  for (const o of holes) {
    const hp = new THREE.Path();
    const x0 = o.x - o.w / 2, x1 = o.x + o.w / 2, r = o.w / 2, sill = o.sill ?? 0;
    const top = o.top ?? 'round';
    // holes run clockwise (opposite to the outline)
    hp.moveTo(x0, sill);
    hp.lineTo(x0, o.spring);
    if (top === 'flat') {
      hp.lineTo(x1, o.spring);
    } else if (top === 'round') {
      hp.absarc(o.x, o.spring, r, Math.PI, 0, true);
    } else if (top === 'horseshoe') {
      hp.absarc(o.x, o.spring, r * 1.12, Math.PI + 0.45, -0.45, true);
    } else {
      // pointed: two arcs meeting at the apex
      const apex = o.spring + r * 1.25;
      hp.quadraticCurveTo(x0, apex - r * 0.35, o.x, apex);
      hp.quadraticCurveTo(x1, apex - r * 0.35, x1, o.spring);
    }
    hp.lineTo(x1, sill);
    hp.lineTo(x0, sill);
    s.holes.push(hp);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: curveSeg });
  g.translate(0, 0, -t / 2);
  return g;
}

/** Arcade: a wall of n equal arches (centre x / z, bottom y0), rotated about y by ry. */
export function arcade(nb: NB, surf: Surface, n: number, w: number, h: number, t: number, x: number, y0: number, z: number, hi: boolean,
  o: { ry?: number; spring?: number; open?: number; top?: ArchOpening['top']; sill?: number } = {}): void {
  const bay = w / n;
  const ow = bay * (o.open ?? 0.62);
  const spring = o.spring ?? Math.min(h - ow / 2 - h * 0.08, h * 0.62);
  const holes: ArchOpening[] = [];
  for (let i = 0; i < n; i++) holes.push({ x: -w / 2 + bay * (i + 0.5), w: ow, spring, sill: o.sill, top: o.top });
  nb.add(archWallGeo(w, h, t, holes, hi ? 6 : 3), surf, { p: [x, y0, z], r: [0, o.ry ?? 0, 0] });
}

/** Column with a base and a capital (classical). */
export function column(p: Poly, x: number, y0: number, z: number, r: number, h: number, sides: number, capital = true): void {
  if (capital) {
    p.box(x, y0, z, r * 2.6, h * 0.04, r * 2.6);
    p.ngon(x, y0 + h * 0.04, z, r, r * 0.86, h * 0.9, sides);
    p.frustum(x, y0 + h * 0.94, z, r * 1.8, r * 1.8, r * 2.7, r * 2.7, h * 0.03, false);
    p.box(x, y0 + h * 0.97, z, r * 2.7, h * 0.03, r * 2.7);
  } else {
    p.ngon(x, y0, z, r, r, h, sides);
  }
}

/** Row of columns along x from x0 to x1 (n columns) at z. */
export function colonnade(p: Poly, n: number, x0: number, x1: number, z: number, y0: number, r: number, h: number, sides: number): void {
  for (let i = 0; i < n; i++) column(p, n === 1 ? (x0 + x1) / 2 : x0 + ((x1 - x0) * i) / (n - 1), y0, z, r, h, sides);
}

/** Gable roof: ridge along x (or along z when alongZ), eaves at y0, ridge at y0 + h, overhang `over`. */
export function gable(p: Poly, x: number, y0: number, z: number, w: number, d: number, h: number, over = 0.05, alongZ = false): void {
  if (!alongZ) {
    const hd = d / 2 + over;
    p.prismX([[hd, y0], [-hd, y0], [0, y0 + h]].map(([zz, yy]) => [zz, yy]) as [number, number][], -w / 2 - over, w / 2 + over, x, z);
  } else {
    const hw = w / 2 + over;
    p.prismZ([[-hw, y0], [hw, y0], [0, y0 + h]], -d / 2 - over, d / 2 + over, x, z);
  }
}

/** Hip roof over w x d (ridge along the longer side), eaves at y0, ridge at y0 + h. */
export function hip(p: Poly, x: number, y0: number, z: number, w: number, d: number, h: number, over = 0.05): void {
  const W = w + over * 2, D = d + over * 2;
  const y1 = y0 + h;
  const a: V3 = [x - W / 2, y0, z + D / 2], b: V3 = [x + W / 2, y0, z + D / 2], c: V3 = [x + W / 2, y0, z - D / 2], e: V3 = [x - W / 2, y0, z - D / 2];
  if (W >= D) {
    const r = (W - D) / 2;
    const r0: V3 = [x - r, y1, z], r1: V3 = [x + r, y1, z];
    p.quad(a, b, r1, r0).tri(b, c, r1).quad(c, e, r0, r1).tri(e, a, r0);
  } else {
    const r = (D - W) / 2;
    const r0: V3 = [x, y1, z + r], r1: V3 = [x, y1, z - r];
    p.tri(a, b, r0).quad(b, c, r1, r0).tri(c, e, r1).quad(e, a, r0, r1);
  }
  p.cap([a, b, c, e], false);
}

/**
 * Curved East Asian roof: a hip roof whose eaves sweep up at the corners (the four slopes are subdivided along
 * their length and the corners lifted), over w x d with overhang. `tiers` > 1 stacks smaller roofs (pagoda).
 */
export function sweptRoof(p: Poly, x: number, y0: number, z: number, w: number, d: number, h: number, over: number, lift: number, hi: boolean): void {
  const W = w / 2 + over, D = d / 2 + over;
  const n = hi ? 6 : 3;
  const ridgeHalf = Math.max(0, W - D) * 0.8;
  // eave line: corners lifted by `lift`, sagging in the middle of each side
  const eave = (t: number) => y0 + lift * Math.pow(Math.abs(t * 2 - 1), 2.2);
  const mid = (t: number) => y0 + h * 0.55 + lift * 0.25 * Math.pow(Math.abs(t * 2 - 1), 2); // concave slope
  const sideRows = (P0: (t: number) => V3, P1: (t: number) => V3, P2: (t: number) => V3) => {
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n;
      p.quad(P0(t0), P0(t1), P1(t1), P1(t0));
      p.quad(P1(t0), P1(t1), P2(t1), P2(t0));
    }
  };
  const top = y0 + h;
  // front (+z) and back (-z) slopes run along x; side slopes along z
  sideRows(
    (t) => [x - W + 2 * W * t, eave(t), z + D],
    (t) => [x - (W + ridgeHalf) / 2 + (W + ridgeHalf) * t, mid(t), z + D * 0.45],
    (t) => [x - ridgeHalf + 2 * ridgeHalf * t, top, z],
  );
  sideRows(
    (t) => [x + W - 2 * W * t, eave(t), z - D],
    (t) => [x + (W + ridgeHalf) / 2 - (W + ridgeHalf) * t, mid(t), z - D * 0.45],
    (t) => [x + ridgeHalf - 2 * ridgeHalf * t, top, z],
  );
  sideRows(
    (t) => [x + W, eave(t), z + D - 2 * D * t],
    (t) => [x + (W + ridgeHalf) / 2, mid(t), z + D * 0.45 - D * 0.9 * t],
    () => [x + ridgeHalf, top, z],
  );
  sideRows(
    (t) => [x - W, eave(t), z - D + 2 * D * t],
    (t) => [x - (W + ridgeHalf) / 2, mid(t), z - D * 0.45 + D * 0.9 * t],
    () => [x - ridgeHalf, top, z],
  );
  // underside of the eaves (a flat ceiling so the roof never shows through from below)
  p.cap([[x - W, y0 + 0.002, z + D], [x + W, y0 + 0.002, z + D], [x + W, y0 + 0.002, z - D], [x - W, y0 + 0.002, z - D]], false);
  if (ridgeHalf > 0) p.beam([x - ridgeHalf - 0.02, top + 0.015, z], [x + ridgeHalf + 0.02, top + 0.015, z], Math.max(0.03, h * 0.12));
}

/** Stepped pyramid: `levels` stacked frusta from w0 x d0 to w1 x d1, total height h. */
export function stepped(p: Poly, x: number, y0: number, z: number, w0: number, d0: number, w1: number, d1: number, h: number, levels: number, batter = 0.06): void {
  const lh = h / levels;
  for (let i = 0; i < levels; i++) {
    const t0 = i / levels, t1 = (i + 1) / levels;
    const wa = w0 + (w1 - w0) * t0, da = d0 + (d1 - d0) * t0;
    const wb = w0 + (w1 - w0) * t1, db = d0 + (d1 - d0) * t1;
    p.frustum(x, y0 + lh * i, z, wa, da, wa - batter * 2 * lh, da - batter * 2 * lh, lh * 0.98, true);
    if (i < levels - 1) p.box(x, y0 + lh * (i + 0.98), z, Math.min(wa - batter * 2 * lh, wb), lh * 0.02, Math.min(da - batter * 2 * lh, db));
  }
}

/** Battlements along a wall top from a to b (merlons of size m). */
export function crenels(p: Poly, a: V3, b: V3, t: number, m: number): void {
  const dx = b[0] - a[0], dz = b[2] - a[2];
  const len = Math.hypot(dx, dz);
  const n = Math.max(1, Math.floor(len / (m * 2)));
  const ry = Math.atan2(-dz, dx);
  for (let i = 0; i < n; i++) {
    const f = (i + 0.5) / n;
    p.boxR(a[0] + dx * f, a[1], a[2] + dz * f, m, m * 0.9, t, ry);
  }
}

/**
 * Lattice column between two square loops (corner chords + horizontal ties + diagonal bracing on each face):
 * Eiffel Tower legs, pylons, towers. lo / hi = 4 corners each (counter-clockwise from above).
 */
export function lattice(p: Poly, lo: V3[], hi: V3[], levels: number, chord: number, brace: number, diag: boolean): void {
  const at = (i: number, t: number): V3 => [
    lo[i][0] + (hi[i][0] - lo[i][0]) * t,
    lo[i][1] + (hi[i][1] - lo[i][1]) * t,
    lo[i][2] + (hi[i][2] - lo[i][2]) * t,
  ];
  for (let i = 0; i < 4; i++) p.beam(lo[i], hi[i], chord);
  for (let l = 0; l <= levels; l++) {
    const t = l / levels;
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      if (l > 0 && l < levels) p.beam(at(i, t), at(j, t), brace);
      if (diag && l < levels) {
        const t1 = (l + 1) / levels;
        p.beam(at(i, t), at(j, t1), brace * 0.8);
        p.beam(at(j, t), at(i, t1), brace * 0.8);
      }
    }
  }
}

/** A sagging cable from a to b (catenary-ish parabola, `sag` below the chord at mid-span), n segments. */
export function cable(p: Poly, a: V3, b: V3, sag: number, n: number, t: number): V3[] {
  const pts: V3[] = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    pts.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f - sag * 4 * f * (1 - f), a[2] + (b[2] - a[2]) * f]);
  }
  for (let i = 0; i < n; i++) p.beam(pts[i], pts[i + 1], t);
  return pts;
}

/** Window panes (glowing at night) on a face: a grid on the plane z = z0 facing +z (or rotated by ry). */
export function windowGrid(nb: NB, cols: number, rows: number, w: number, h: number, x0: number, x1: number, y0: number, y1: number, z0: number, ry = 0, glow: Glow = WIN, cx = 0, cz = 0): void {
  const p = new Poly();
  const c = Math.cos(ry), s = Math.sin(ry);
  const pt = (x: number, y: number): V3 => [cx + x * c + z0 * s, y, cz - x * s + z0 * c];
  for (let i = 0; i < cols; i++) {
    const x = cols === 1 ? (x0 + x1) / 2 : x0 + ((x1 - x0) * i) / (cols - 1);
    for (let j = 0; j < rows; j++) {
      const y = rows === 1 ? (y0 + y1) / 2 : y0 + ((y1 - y0) * j) / (rows - 1);
      p.quad(pt(x - w / 2, y - h / 2), pt(x + w / 2, y - h / 2), pt(x + w / 2, y + h / 2), pt(x - w / 2, y + h / 2));
    }
  }
  put(nb, p, glow);
}

// ---------------------------------------------------------------------------------------------------------
// terrain-like shapes: mountains, rocks, cliffs
// ---------------------------------------------------------------------------------------------------------

/**
 * The battlefield's ground colour (linear RGB, by climate) while a landmark is being built: height fields fade their
 * low ground into it so a mountain's or mound's rim melts into the terrain with no visible edge. Set by the landmark
 * index around a build; null = no fade.
 */
let groundTone: [number, number, number] | null = null;
export function setGroundTone(rgb: [number, number, number] | null): void {
  groundTone = rgb;
}

/**
 * Height-field mesh over w x d centred on the origin (res x res quads, shared vertices: smooth shading), with a skirt
 * down to y = -skirt along the edges so it meets uneven ground. `colour` returns a linear RGB per vertex (snow caps,
 * rock bands, vegetation); the lowest ground fades into the battlefield's ground colour (setGroundTone).
 */
export function heightField(nb: NB, w: number, d: number, resX: number, resZ: number, height: (x: number, z: number) => number,
  colour: (x: number, z: number, y: number, slope: number) => [number, number, number], surf: Mat, skirt = 0.4): void {
  const nx = resX + 1, nz = resZ + 1;
  const H = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) H[j * nx + i] = height(-w / 2 + (w * i) / resX, -d / 2 + (d * j) / resZ);
  const dx = w / resX, dz = d / resZ;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const tone = groundTone;
  const shade = (c: [number, number, number], y: number): [number, number, number] => {
    if (!tone) return c;
    const t = Math.min(1, Math.max(0, (0.32 - y) / 0.4)); // fully ground-coloured at and below the ground line
    return mixc(c, tone, t * t * (3 - 2 * t));
  };
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = -w / 2 + dx * i, z = -d / 2 + dz * j, y = H[j * nx + i];
      const hl = H[j * nx + Math.max(0, i - 1)], hr = H[j * nx + Math.min(nx - 1, i + 1)];
      const hu = H[Math.max(0, j - 1) * nx + i], hd = H[Math.min(nz - 1, j + 1) * nx + i];
      const slope = Math.hypot((hr - hl) / (2 * dx), (hd - hu) / (2 * dz));
      pos.push(x, y, z);
      col.push(...shade(colour(x, z, y, slope), y));
    }
  }
  for (let j = 0; j < resZ; j++) {
    for (let i = 0; i < resX; i++) {
      const a = j * nx + i, b = (j + 1) * nx + i, c = (j + 1) * nx + i + 1, e = j * nx + i + 1;
      // counter-clockwise from above; split along the diagonal that follows the slope (fewer folds)
      if (Math.abs(H[a] - H[c]) < Math.abs(H[b] - H[e])) idx.push(a, b, c, a, c, e);
      else idx.push(a, b, e, b, c, e);
    }
  }
  // skirts (outward), their own vertices
  const edge = (i0: number, j0: number, i1: number, j1: number) => {
    const x0 = -w / 2 + dx * i0, z0 = -d / 2 + dz * j0, x1 = -w / 2 + dx * i1, z1 = -d / 2 + dz * j1;
    const y0 = H[j0 * nx + i0], y1 = H[j1 * nx + i1];
    const c0 = shade(colour(x0, z0, y0, 1), y0), c1 = shade(colour(x1, z1, y1, 1), y1);
    const base = pos.length / 3;
    pos.push(x0, y0, z0, x0, -skirt, z0, x1, -skirt, z1, x1, y1, z1);
    col.push(...c0, ...c0, ...c1, ...c1);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  for (let i = 0; i < resX; i++) { edge(i + 1, 0, i, 0); edge(i, resZ, i + 1, resZ); }
  for (let j = 0; j < resZ; j++) { edge(0, j, 0, j + 1); edge(resX, j + 1, resX, j); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  addColoured(nb, g, new Float32Array(col), surf);
}

/** Add a geometry whose per-vertex colours (linear RGB, one per vertex) replace the surface colour. */
export function addColoured(nb: NB, g: THREE.BufferGeometry, rgb: Float32Array, surf: Mat, o: AddOpts = {}): void {
  nb.add(g, { ...surf, c: 0xffffff }, o);
  const list = nb.parts.get('body')!;
  const out = list[list.length - 1];
  const col = out.getAttribute('color') as THREE.BufferAttribute;
  const a = col.array as Float32Array;
  // keep the builder's per-part vertical gradient (its colour is white * gradient)
  const n = Math.min(col.count, rgb.length / 3);
  for (let i = 0; i < n; i++) {
    a[i * 3] *= rgb[i * 3];
    a[i * 3 + 1] *= rgb[i * 3 + 1];
    a[i * 3 + 2] *= rgb[i * 3 + 2];
  }
}

/** Linear RGB of an sRGB hex. */
export function lin(hex: number): [number, number, number] {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}

/** Mix two linear colours. */
export function mixc(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  const k = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

/** A lumpy boulder (jittered icosahedron), radius r, squashed by sy. */
export function boulder(nb: NB, surf: Surface, r: number, x: number, y0: number, z: number, seed: number, sy = 0.7, hi = false): void {
  const g = new THREE.IcosahedronGeometry(r, hi ? 1 : 0);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const R = rng(seed);
  const seen = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const k = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    let f = seen.get(k);
    if (f === undefined) seen.set(k, (f = 0.75 + R() * 0.5));
    pos.setXYZ(i, pos.getX(i) * f, pos.getY(i) * f * sy, pos.getZ(i) * f);
  }
  g.computeVertexNormals();
  nb.add(g, surf, { p: [x, y0 + r * sy * 0.6, z] });
}

// ---------------------------------------------------------------------------------------------------------
// figures (stylised low-poly statues)
// ---------------------------------------------------------------------------------------------------------

/** A robed standing figure (statues): robe cone, torso, head; returns the shoulder height and width. */
export function robedFigure(p: Poly, x: number, y0: number, z: number, h: number, sides: number): { shoulder: number; sw: number; head: number } {
  const robeH = h * 0.62;
  p.ngon(x, y0, z, h * 0.15, h * 0.1, robeH, sides);
  const torsoH = h * 0.2;
  p.ngon(x, y0 + robeH, z, h * 0.1, h * 0.085, torsoH, sides);
  const sh = y0 + robeH + torsoH;
  p.ngon(x, sh, z, h * 0.035, h * 0.035, h * 0.04, sides); // neck
  p.ngon(x, sh + h * 0.04, z, h * 0.055, h * 0.045, h * 0.1, sides); // head
  return { shoulder: sh, sw: h * 0.11, head: sh + h * 0.04 };
}

/** Rotate a geometry-to-be in place: helper for facings (quarter turns clockwise from above). */
export function facingMatrix(facing: number): THREE.Matrix4 {
  return new THREE.Matrix4().makeRotationY((-(facing & 3) * Math.PI) / 2);
}

/** Points on an ellipse (radii a along x, b along z), counter-clockwise seen from above, at height y. */
export function ellipse(a: number, b: number, n: number, y = 0, cx = 0, cz = 0): V3[] {
  const out: V3[] = [];
  for (let i = 0; i < n; i++) {
    const t = (-i / n) * Math.PI * 2;
    out.push([cx + a * Math.cos(t), y, cz + b * Math.sin(t)]);
  }
  return out;
}

/** Add a lathe whose vertices are coloured by `colour(angle 0..1, height 0..1)` (striped / zigzag domes). */
export function colouredLathe(nb: NB, pts: [number, number][], seg: number, surf: Mat, colour: (u: number, v: number) => [number, number, number], p: V3): void {
  const g = latheGeo(pts, seg);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  let y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < pos.count; i++) { y0 = Math.min(y0, pos.getY(i)); y1 = Math.max(y1, pos.getY(i)); }
  const rgb = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const u = (Math.atan2(pos.getZ(i), pos.getX(i)) / (Math.PI * 2) + 1) % 1;
    const c = colour(u, (pos.getY(i) - y0) / Math.max(1e-6, y1 - y0));
    rgb[i * 3] = c[0]; rgb[i * 3 + 1] = c[1]; rgb[i * 3 + 2] = c[2];
  }
  addColoured(nb, g, rgb, surf, { p });
}

/** Stylised conifers / cypresses (dark green cones on a short trunk), merged into one soup. */
export function cypress(p: Poly, x: number, y0: number, z: number, h: number, r: number, sides = 5): void {
  p.ngon(x, y0, z, r * 0.25, r * 0.25, h * 0.12, 4);
  p.ngon(x, y0 + h * 0.1, z, r, 0, h * 0.9, sides);
}

/** A round broadleaf tree crown (faceted blob) on a trunk. */
export function tree(p: Poly, x: number, y0: number, z: number, h: number, r: number): void {
  p.ngon(x, y0, z, r * 0.18, r * 0.14, h * 0.45, 4);
  p.ngon(x, y0 + h * 0.35, z, r * 0.7, r, h * 0.25, 6);
  p.ngon(x, y0 + h * 0.6, z, r, r * 0.55, h * 0.25, 6);
  p.ngon(x, y0 + h * 0.85, z, r * 0.55, 0, h * 0.15, 6);
}

/** A soft cloud / spray puff: a smooth flattened sphere (smooth normals, no facets), white, no snow. */
export function puff(nb: NB, r: number, x: number, y: number, z: number, sy: number, sx = 1, hi = false, c = 0xf2f5f7): void {
  const g = new THREE.SphereGeometry(r, hi ? 14 : 9, hi ? 9 : 6).scale(sx, sy, 1);
  nb.add(g, { c, m: 0, r: 1, d: 3, snow: 0 }, { p: [x, y, z] });
}

/** Ridged noise in [0, 1): sharp crests (mountain ridges, gullies). */
export function ridged(x: number, z: number, seed: number, oct = 4): number {
  let s = 0, amp = 0.5, f = 1, n = 0;
  for (let o = 0; o < oct; o++) { s += amp * (1 - Math.abs(noise2(x * f, z * f, seed + o * 13) * 2 - 1)); n += amp; amp *= 0.5; f *= 2.1; }
  return s / n;
}
