/**
 * Shared pieces of the landmark builders: the build context and the ground pieces a landmark may need (an
 * organic mound, an island, a rock outcrop). No hard plates: the battlefield's own terrain (painted by the map
 * generator: sand, lawn, paving) shows round every landmark, and any mound here has an irregular edge that sinks
 * below the ground so it blends in. Landmarks are built centred on the origin with the front to +z; index.ts merges,
 * fits and caches them.
 */
import { BufferGeometry, Float32BufferAttribute, Matrix4, SphereGeometry } from 'three';
import { NB as NBClass, type NB, type Mat } from '../models/builder';
import { P, heightField, lin, mixc, fbm2, noise2 } from './kit';

/** What a landmark builder gets: the builder node, the detail level and a per-landmark seed. */
export interface LCtx {
  nb: NB;
  hi: boolean;
  seed: number;
  /** Soft translucent cloud / mist puffs (drawn as one extra see-through mesh: the tablecloth, the falls' spray). */
  fx: BufferGeometry[];
}

/** A soft see-through cloud puff (flattened sphere; its edges fade out by the cloud material's fresnel). */
export function cloud(k: LCtx, r: number, x: number, y: number, z: number, sy: number, sx = 1, alpha = 0.8): void {
  const g = new SphereGeometry(r, k.hi ? 14 : 9, k.hi ? 9 : 6).scale(sx, sy, 1).translate(x, y, z);
  const n = g.getAttribute('position').count;
  const c = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { c[i * 4] = 1; c[i * 4 + 1] = 1; c[i * 4 + 2] = 1; c[i * 4 + 3] = alpha; }
  g.setAttribute('color', new Float32BufferAttribute(c, 4));
  k.fx.push(g);
}

/**
 * A thin cloud sheet: a grid of nu x nv quads from `at(u, v)` (u, v in 0..1) with a per-vertex alpha (`alpha(u, v)`):
 * patchy cover with soft, ragged edges (the tablecloth, tongues of cloud pouring over a cliff).
 */
export function cloudSheet(k: LCtx, nu: number, nv: number, at: (u: number, v: number) => [number, number, number], alpha: (u: number, v: number) => number): void {
  const pos: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const u = i / nu, v = j / nv;
    pos.push(...at(u, v));
    uv.push(u, v);
    col.push(1, 1, 1, Math.max(0, Math.min(1, alpha(u, v))));
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new Float32BufferAttribute(col, 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  k.fx.push(g);
}

export type LandmarkBuilder = (k: LCtx) => void;

/** Tallest a landmark may stand: with its base centred at the default zoom (26) the top stays on screen. */
export const MAX_HEIGHT = 7.6;

/**
 * An organic mound over (about) w x d rising to `h`: an irregular elliptical outline whose rim sinks 0.08 below the
 * ground (so the terrain cuts it with a natural, wavy edge), colour from `base` at the rim to `top` on the crown.
 */
export function mound(k: LCtx, w: number, d: number, h: number, base: number, top: number, seed: number, rough = 0.2, surf: Mat = P.sand): void {
  const res = k.hi ? 28 : 12;
  const cb = lin(base), ct = lin(top);
  const ar = Math.max(1, w / d);
  heightField(k.nb, w, d, Math.round(res * Math.sqrt(ar)), Math.round(res / Math.sqrt(ar)), (x, z) => profile(x, z, w, d, h, seed, rough),
    (x, z, y) => mixc(cb, ct, Math.min(1, Math.max(0, (y + 0.02) / Math.max(0.06, h * 0.8)) + (noise2(x * 2.1, z * 2.1, seed + 5) - 0.5) * 0.25)), surf, 0.1);
}

/** The height of a mound at (x, z): the shared shape of mounds and islands. */
export function profile(x: number, z: number, w: number, d: number, h: number, seed: number, rough: number): number {
  const a = Math.atan2(z / d, x / w);
  const wob = 1 + 0.16 * (noise2(Math.cos(a) * 1.7 + 3, Math.sin(a) * 1.7 + 3, seed) - 0.5) * 2;
  const r = Math.hypot(x / (w / 2), z / (d / 2)) / (0.92 * wob);
  const s = r >= 1 ? 0 : 1 - r * r * (3 - 2 * r); // smooth fall-off to the rim
  const lump = rough * (fbm2(x * 0.8, z * 0.8, 3, seed) - 0.5);
  return -0.08 + (h + 0.08) * Math.pow(s, 0.7) + lump * s;
}

/** Build into a temporary node and merge it scaled uniformly by `s` about the origin (keeps proportions). */
export function scaledInto(nb: NB, s: number, build: (n: NB) => void): void {
  const t = new NBClass('_scaled');
  build(t);
  const m = new Matrix4().makeScale(s, s, s);
  for (const [slot, list] of t.parts) {
    let l = nb.parts.get(slot);
    if (!l) nb.parts.set(slot, (l = []));
    for (const g of list) {
      g.applyMatrix4(m);
      l.push(g);
    }
  }
}
