/**
 * Procedural textures generated once at start-up:
 *  - particle atlas (4x4 frames, 256px each): glows, flares, lit smoke puffs (normal-mapped),
 *    flames, fireball billows, sparks, stars, rings, debris, dust, chevron, plus, crackle
 *  - decal atlas (2x2): scorches, splat, crater
 *  - tileable noise texture (beams / ribbons)
 *  - colour ramp texture (HalfFloat, HDR): colour + occlusion over particle life
 *
 * Atlas convention: frame f lives at column f % 4, row floor(f / 4) counted from the BOTTOM (v = 0).
 * Pixel generators get (u, v) in [-1, 1] with +v = up on screen.
 *
 * "Lit" frames store a tangent-space normal in RG, ambient occlusion in B and coverage in A;
 * the particle shader lights them with the sun direction. Other frames store brightness in RGB.
 */
import * as THREE from 'three';
import { Noise2, smoothstep, clamp01 } from './noise';

/** Particle atlas frames. */
export const F = {
  GLOW: 0,
  FLARE: 1,
  SMOKE_A: 2,
  SMOKE_B: 3,
  SMOKE_C: 4,
  FLAME: 5,
  FIREBALL: 6,
  SPARK: 7,
  STAR: 8,
  RING: 9,
  SHOCK: 10,
  DEBRIS: 11,
  DUST: 12,
  CHEVRON: 13,
  PLUS: 14,
  CRACKLE: 15,
} as const;

/** Decal atlas frames. */
export const D = { SCORCH_A: 0, SCORCH_B: 1, SPLAT: 2, CRATER: 3 } as const;

/** Colour ramp rows (colour + occlusion over normalised life). */
export const R = {
  WHITE: 0,
  FIRE: 1,
  FIREBALL: 2,
  SMOKE_DARK: 3,
  SMOKE: 4,
  STEAM: 5,
  DUST: 6,
  SPARK: 7,
  TESLA: 8,
  EMBER: 9,
  NUKE: 10,
  DEBRIS: 11,
  DEBRIS_BURN: 12,
  SMOKE_FIRE: 13,
  TRAIL: 14,
  FLAME_JET: 15,
} as const;
export const RAMP_ROWS = 16;

const FRAME = 256;
const ATLAS_COLS = 4;

type PixelFn = (u: number, v: number, out: Float32Array) => void;

function makeCanvas(w: number, h: number): CanvasRenderingContext2D {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c.getContext('2d', { willReadFrequently: true })!;
}

class AtlasBuilder {
  readonly data: Uint8Array;
  constructor(readonly cols: number, readonly frame: number) {
    const size = cols * frame;
    this.data = new Uint8Array(size * size * 4);
  }
  private offset(f: number, x: number, y: number): number {
    const fx = (f % this.cols) * this.frame;
    const fy = Math.floor(f / this.cols) * this.frame;
    return ((fy + y) * this.cols * this.frame + fx + x) * 4;
  }
  pixels(f: number, fn: PixelFn): void {
    const out = new Float32Array(4);
    const N = this.frame;
    for (let y = 0; y < N; y++) {
      const v = ((y + 0.5) / N) * 2 - 1;
      for (let x = 0; x < N; x++) {
        const u = ((x + 0.5) / N) * 2 - 1;
        out[0] = out[1] = out[2] = 1;
        out[3] = 0;
        fn(u, v, out);
        const o = this.offset(f, x, y);
        this.data[o] = Math.round(clamp01(out[0]) * 255);
        this.data[o + 1] = Math.round(clamp01(out[1]) * 255);
        this.data[o + 2] = Math.round(clamp01(out[2]) * 255);
        this.data[o + 3] = Math.round(clamp01(out[3]) * 255);
      }
    }
  }
  /**
   * Lit frame from a height/density field: field(u,v) -> density (>=0).
   * coverage(d) maps density to alpha. Normals come from the field gradient.
   */
  lit(f: number, field: (u: number, v: number) => number, coverage: (d: number, u: number, v: number) => number, bump: number, ao?: (d: number, u: number, v: number) => number): void {
    const N = this.frame;
    const F = new Float32Array(N * N);
    for (let y = 0; y < N; y++) {
      const v = ((y + 0.5) / N) * 2 - 1;
      for (let x = 0; x < N; x++) {
        const u = ((x + 0.5) / N) * 2 - 1;
        F[y * N + x] = field(u, v);
      }
    }
    for (let y = 0; y < N; y++) {
      const v = ((y + 0.5) / N) * 2 - 1;
      for (let x = 0; x < N; x++) {
        const u = ((x + 0.5) / N) * 2 - 1;
        const d = F[y * N + x];
        const dx = F[y * N + Math.min(N - 1, x + 1)] - F[y * N + Math.max(0, x - 1)];
        const dy = F[Math.min(N - 1, y + 1) * N + x] - F[Math.max(0, y - 1) * N + x];
        let nx = -dx * bump;
        let ny = -dy * bump;
        const nz = 1;
        const l = Math.hypot(nx, ny, nz);
        nx /= l;
        ny /= l;
        const o = this.offset(f, x, y);
        this.data[o] = Math.round(clamp01(nx * 0.5 + 0.5) * 255);
        this.data[o + 1] = Math.round(clamp01(ny * 0.5 + 0.5) * 255);
        this.data[o + 2] = Math.round(clamp01(ao ? ao(d, u, v) : 1) * 255);
        this.data[o + 3] = Math.round(clamp01(coverage(d, u, v)) * 255);
      }
    }
  }
  /** Draw with canvas 2D (white on transparent); alpha taken from the canvas, rgb = white. */
  canvas(f: number, draw: (ctx: CanvasRenderingContext2D, N: number) => void): void {
    const N = this.frame;
    const ctx = makeCanvas(N, N);
    draw(ctx, N);
    const img = ctx.getImageData(0, 0, N, N).data;
    for (let y = 0; y < N; y++) {
      const sy = N - 1 - y; // canvas is top-down, atlas bottom-up
      for (let x = 0; x < N; x++) {
        const s = (sy * N + x) * 4;
        const o = this.offset(f, x, y);
        // canvas colours are white with alpha -> keep rgb from canvas (un-premultiplied) for glow tint
        this.data[o] = img[s];
        this.data[o + 1] = img[s + 1];
        this.data[o + 2] = img[s + 2];
        this.data[o + 3] = img[s + 3];
      }
    }
  }
  texture(): THREE.DataTexture {
    const size = this.cols * this.frame;
    const t = new THREE.DataTexture(this.data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.colorSpace = THREE.NoColorSpace;
    t.anisotropy = 1;
    t.needsUpdate = true;
    return t;
  }
}

/** Soft fall-off to zero at the frame edge (r = 1). */
function edge(r: number): number {
  return smoothstep(1.0, 0.82, r);
}

/** Billowy cauliflower density field built from random blobs + fbm. */
function billowField(noise: Noise2, seed: number, blobs: number, radius: number, detail: number) {
  let s = seed * 9301 + 49297;
  const r = (): number => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  const B: number[] = [];
  for (let i = 0; i < blobs; i++) {
    const a = r() * Math.PI * 2;
    const d = i === 0 ? 0 : (0.2 + r() * 0.8) * radius;
    B.push(Math.cos(a) * d, Math.sin(a) * d * 0.9, 0.22 + r() * 0.2 + (i === 0 ? 0.12 : 0));
  }
  const ox = seed * 3.17;
  const oy = seed * 1.91;
  return (u: number, v: number): number => {
    let d = 0;
    for (let i = 0; i < B.length; i += 3) {
      const dx = u - B[i];
      const dy = v - B[i + 1];
      const rr = B[i + 2];
      d += Math.exp(-(dx * dx + dy * dy) / (rr * rr));
    }
    const n = noise.fbm(u * 2.6 + ox, v * 2.6 + oy, 5);
    const n2 = noise.fbm(u * 7 + oy, v * 7 + ox, 3);
    d *= 0.62 + detail * (0.55 * n + 0.25 * n2);
    const rr = Math.hypot(u, v);
    return Math.max(0, d) * edge(rr);
  };
}

export interface EffectTextures {
  atlas: THREE.DataTexture;
  decals: THREE.DataTexture;
  noise: THREE.DataTexture;
  ramp: THREE.DataTexture;
  dispose(): void;
}

function buildParticleAtlas(): THREE.DataTexture {
  const A = new AtlasBuilder(ATLAS_COLS, FRAME);
  const noise = new Noise2(1337);

  // GLOW: soft gaussian
  A.pixels(F.GLOW, (u, v, o) => {
    const r = Math.hypot(u, v);
    o[3] = Math.pow(Math.max(0, 1 - r * r), 3.5);
  });

  // FLARE: hot pin-point core + halo
  A.pixels(F.FLARE, (u, v, o) => {
    const r = Math.hypot(u, v);
    o[3] = Math.min(1, Math.exp(-r * r * 70) + 0.5 * Math.exp(-r * r * 9) + 0.18 * Math.exp(-r * 3.5)) * edge(r);
  });

  // Lit smoke puffs
  const smokeCov = (lo: number, hi: number) => (d: number) => Math.pow(smoothstep(lo, hi, d), 1.3);
  const smokeAo = (d: number, u: number, v: number) => 0.72 + 0.28 * smoothstep(0.1, 1.3, d) + 0.06 * noise.noise(u * 9, v * 9);
  A.lit(F.SMOKE_A, billowField(noise, 1, 7, 0.42, 1.0), smokeCov(0.06, 1.0), 14, smokeAo);
  A.lit(F.SMOKE_B, billowField(noise, 2, 9, 0.48, 1.1), smokeCov(0.07, 1.05), 14, smokeAo);
  A.lit(F.SMOKE_C, billowField(noise, 3, 6, 0.38, 1.25), smokeCov(0.05, 0.95), 14, smokeAo);

  // FLAME: teardrop tongue with noisy edges, tip at the top
  A.pixels(F.FLAME, (u, v, o) => {
    const y = v;
    const wob = noise.fbm(u * 2.5 + 7, v * 2.0 - 3, 4) * 0.22 * (1 + y);
    const ux = u + wob;
    let rad: number;
    const cy = -0.4;
    const cr = 0.42;
    if (y < cy) rad = Math.sqrt(Math.max(0, cr * cr - (y - cy) * (y - cy)));
    else rad = cr * Math.pow(Math.max(0, 1 - (y - cy) / 1.32), 1.3);
    const dd = Math.abs(ux) / Math.max(rad, 1e-3);
    let a = smoothstep(1.0, 0.35, dd) * smoothstep(-0.85, -0.6, y);
    const n = noise.fbm(u * 5 + 11, v * 4 - 5, 4);
    a *= 0.75 + 0.35 * n;
    const core = smoothstep(0.7, 0.0, dd) * smoothstep(0.6, -0.4, y);
    o[0] = o[1] = o[2] = 0.65 + 0.35 * core;
    o[3] = a * edge(Math.hypot(u, v) * 0.95);
  });

  // FIREBALL: billow with hot inner regions (brightness in rgb)
  {
    const field = billowField(noise, 5, 8, 0.4, 1.2);
    A.pixels(F.FIREBALL, (u, v, o) => {
      const d = field(u, v);
      const hot = noise.fbm(u * 4 + 2, v * 4 + 9, 4);
      o[0] = o[1] = o[2] = clamp01(0.5 + 0.35 * smoothstep(0.3, 1.5, d) + 0.25 * hot);
      o[3] = smoothstep(0.1, 0.7, d);
    });
  }

  // SPARK: streak along +u (head at u = +1)
  A.pixels(F.SPARK, (u, v, o) => {
    const along = (u + 1) * 0.5; // 0 tail .. 1 head
    const across = Math.exp(-v * v * 45) + 0.3 * Math.exp(-v * v * 8);
    const prof = Math.pow(smoothstep(0.0, 0.85, along), 1.2) * smoothstep(1.0, 0.86, along);
    o[3] = Math.min(1, across * prof * 1.2);
  });

  // STAR: 4 strong rays + 4 weak diagonals + core
  A.pixels(F.STAR, (u, v, o) => {
    const r = Math.hypot(u, v);
    let a = Math.exp(-r * r * 30) + 0.35 * Math.exp(-r * r * 6);
    const ray = (px: number, py: number, w: number, k: number) => {
      const along = Math.abs(u * px + v * py);
      const perp = Math.abs(-u * py + v * px);
      return Math.exp(-(perp * perp) / (w * w * (0.1 + along))) * Math.pow(Math.max(0, 1 - along), k);
    };
    a += ray(1, 0, 0.05, 1.6) + ray(0, 1, 0.05, 1.6);
    const s = Math.SQRT1_2;
    a += 0.45 * (ray(s, s, 0.035, 2.5) + ray(s, -s, 0.035, 2.5));
    o[3] = Math.min(1, a) * edge(r);
  });

  // RING: soft ring
  A.pixels(F.RING, (u, v, o) => {
    const r = Math.hypot(u, v);
    const ring = Math.exp(-Math.pow((r - 0.78) / 0.085, 2));
    o[3] = Math.min(1, ring + 0.08 * smoothstep(0.8, 0.0, r)) * edge(r);
  });

  // SHOCK: shock front with sharp outer edge and faint gradient inside, slightly broken up
  A.pixels(F.SHOCK, (u, v, o) => {
    const r = Math.hypot(u, v);
    const ang = Math.atan2(v, u);
    const n = noise.fbm(Math.cos(ang) * 3 + 5, Math.sin(ang) * 3 + 5, 4);
    const outer = 0.9 + 0.03 * n;
    const front = Math.exp(-Math.pow((r - outer + 0.03) / 0.045, 2));
    const inner = 0.25 * Math.pow(smoothstep(0.35, outer, r), 3);
    const a = (front + inner) * smoothstep(outer + 0.05, outer, r);
    o[3] = a * (0.8 + 0.3 * n) * edge(r * 0.98);
  });

  // DEBRIS: irregular bevelled chunk (lit)
  {
    const pts: number[] = [];
    const n = 7;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.sin(i * 12.9898) * 0.35;
      const rr = 0.42 + 0.22 * Math.abs(Math.sin(i * 78.233));
      pts.push(Math.cos(a) * rr, Math.sin(a) * rr * 0.85);
    }
    const sdf = (u: number, v: number): number => {
      // distance inside convex-ish polygon (positive inside)
      let dmin = 1e9;
      let inside = true;
      for (let i = 0; i < n; i++) {
        const ax = pts[i * 2], ay = pts[i * 2 + 1];
        const bx = pts[((i + 1) % n) * 2], by = pts[((i + 1) % n) * 2 + 1];
        const ex = bx - ax, ey = by - ay;
        const wx = u - ax, wy = v - ay;
        const cross = ex * wy - ey * wx;
        if (cross < 0) inside = false;
        const t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey)));
        const dx = wx - ex * t, dy = wy - ey * t;
        dmin = Math.min(dmin, Math.hypot(dx, dy));
      }
      return inside ? dmin : -dmin;
    };
    A.lit(
      F.DEBRIS,
      (u, v) => {
        const d = sdf(u, v);
        return Math.min(Math.max(d, 0), 0.14) / 0.14 + 0.08 * noise.fbm(u * 8, v * 8, 3);
      },
      (_d, u, v) => smoothstep(-0.01, 0.02, sdf(u, v)),
      9,
      (_d, u, v) => 0.6 + 0.4 * clamp01(0.5 + noise.fbm(u * 6 + 3, v * 6, 3)),
    );
  }

  // DUST: wispy lit puff
  {
    const field = billowField(noise, 9, 10, 0.5, 1.6);
    A.lit(F.DUST, field, (d, u, v) => Math.pow(smoothstep(0.0, 1.5, d), 1.25) * (0.7 + 0.3 * noise.fbm(u * 5, v * 5, 3)) * smoothstep(1.0, 0.55, Math.hypot(u, v)), 4, () => 0.92);
  }

  // CHEVRON: arrow pointing up
  A.canvas(F.CHEVRON, (ctx, N) => {
    ctx.strokeStyle = '#fff';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = '#fff';
    ctx.shadowBlur = N * 0.08;
    ctx.lineWidth = N * 0.12;
    ctx.beginPath();
    ctx.moveTo(N * 0.2, N * 0.68);
    ctx.lineTo(N * 0.5, N * 0.32);
    ctx.lineTo(N * 0.8, N * 0.68);
    ctx.stroke();
  });

  // PLUS: soft plus sign
  A.canvas(F.PLUS, (ctx, N) => {
    ctx.fillStyle = '#fff';
    ctx.shadowColor = '#fff';
    ctx.shadowBlur = N * 0.1;
    const w = N * 0.16;
    const l = N * 0.56;
    ctx.beginPath();
    ctx.roundRect((N - w) / 2, (N - l) / 2, w, l, w * 0.3);
    ctx.roundRect((N - l) / 2, (N - w) / 2, l, w, w * 0.3);
    ctx.fill();
  });

  // CRACKLE: jagged electric arcs radiating from the centre
  A.canvas(F.CRACKLE, (ctx, N) => {
    let s = 4242;
    const r = (): number => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
    ctx.strokeStyle = '#fff';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = '#fff';
    const arc = (x: number, y: number, ang: number, len: number, w: number, depth: number) => {
      ctx.lineWidth = w;
      ctx.shadowBlur = w * 4;
      ctx.beginPath();
      ctx.moveTo(x, y);
      const steps = 6;
      for (let i = 0; i < steps; i++) {
        ang += (r() - 0.5) * 1.1;
        x += Math.cos(ang) * (len / steps);
        y += Math.sin(ang) * (len / steps);
        ctx.lineTo(x, y);
        if (depth > 0 && r() < 0.3) {
          ctx.stroke();
          arc(x, y, ang + (r() - 0.5) * 2, len * 0.45, w * 0.6, depth - 1);
          ctx.lineWidth = w;
          ctx.shadowBlur = w * 4;
          ctx.beginPath();
          ctx.moveTo(x, y);
        }
      }
      ctx.stroke();
    };
    for (let i = 0; i < 7; i++) {
      arc(N / 2, N / 2, (i / 7) * Math.PI * 2 + r() * 0.5, N * 0.4, N * 0.018, 2);
    }
    const g = ctx.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N * 0.16);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.shadowBlur = 0;
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, N, N);
  });

  return A.texture();
}

function buildDecalAtlas(): THREE.DataTexture {
  const A = new AtlasBuilder(2, FRAME);
  const noise = new Noise2(777);

  const scorch = (seed: number, streaks: number, crater: boolean): PixelFn => (u, v, o) => {
    const r = Math.hypot(u, v);
    const ang = Math.atan2(v, u);
    const ca = Math.cos(ang), sa = Math.sin(ang);
    // irregular boundary
    const bound = 0.62 + 0.16 * noise.fbm(ca * 1.8 + seed, sa * 1.8 + seed, 4);
    // radial blast streaks
    const st = Math.pow(clamp01(0.5 + 0.5 * noise.fbm(ca * 6 + seed * 3, sa * 6 - seed, 3)), 3) * streaks;
    const reach = bound + st * 0.35;
    const fine = noise.fbm(u * 9 + seed, v * 9 - seed, 4);
    let a = smoothstep(reach, reach * 0.55, r);
    a *= 0.8 + 0.3 * fine;
    a = clamp01(a);
    // colour: charred black centre -> brown/ash edges
    const t = smoothstep(0.0, reach, r);
    let c = 0.07 + 0.22 * t + 0.05 * fine;
    if (crater) {
      const rim = Math.exp(-Math.pow((r - 0.28) / 0.08, 2));
      c = c * (1 - 0.4 * smoothstep(0.3, 0.0, r)) + 0.12 * rim;
    }
    o[0] = c * 1.05;
    o[1] = c * 0.95;
    o[2] = c * 0.85;
    o[3] = a * edge(r);
  };
  A.pixels(D.SCORCH_A, scorch(1, 1, false));
  A.pixels(D.SCORCH_B, scorch(7, 0.6, false));
  A.pixels(D.CRATER, scorch(13, 1.3, true));

  // SPLAT: small irregular dark red-brown stain with droplets
  {
    const drops: number[] = [];
    let s = 99;
    const r = (): number => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
    for (let i = 0; i < 9; i++) {
      const a = r() * Math.PI * 2;
      const d = 0.35 + r() * 0.4;
      drops.push(Math.cos(a) * d, Math.sin(a) * d, 0.03 + r() * 0.06);
    }
    A.pixels(D.SPLAT, (u, v, o) => {
      const rr = Math.hypot(u, v);
      const ang = Math.atan2(v, u);
      const bound = 0.36 + 0.1 * noise.fbm(Math.cos(ang) * 2 + 40, Math.sin(ang) * 2, 4);
      let a = smoothstep(bound, bound * 0.75, rr);
      for (let i = 0; i < drops.length; i += 3) {
        const dd = Math.hypot(u - drops[i], v - drops[i + 1]);
        a = Math.max(a, smoothstep(drops[i + 2], drops[i + 2] * 0.5, dd));
      }
      const fine = noise.fbm(u * 10, v * 10, 3);
      o[0] = 0.32 + 0.06 * fine;
      o[1] = 0.12 + 0.03 * fine;
      o[2] = 0.09;
      o[3] = clamp01(a * (0.85 + 0.2 * fine)) * edge(rr);
    });
  }
  return A.texture();
}

function buildNoise(): THREE.DataTexture {
  const N = 128;
  const noise = new Noise2(4242);
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = (x / N) * 8;
      const v = (y / N) * 8;
      const o = (y * N + x) * 4;
      data[o] = Math.round(clamp01(0.5 + 0.5 * noise.fbm(u, v, 4, 8)) * 255);
      data[o + 1] = Math.round(clamp01(0.5 + 0.5 * noise.fbm(u + 31, v + 17, 4, 8)) * 255);
      data[o + 2] = Math.round(clamp01(0.5 + 0.5 * noise.fbm(u * 2 + 5, v * 2 + 9, 3, 16)) * 255);
      data[o + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Key = [t, r, g, b, occlusion]. Colours are linear HDR. occlusion 0 = additive, 1 = opaque smoke. */
type Key = [number, number, number, number, number];

const RAMPS: Record<number, Key[]> = {
  [R.WHITE]: [[0, 1, 1, 1, 0], [1, 1, 1, 1, 0]],
  [R.FIRE]: [
    [0.0, 4.2, 2.8, 1.1, 0],
    [0.15, 3.4, 1.5, 0.35, 0],
    [0.4, 1.9, 0.55, 0.1, 0],
    [0.7, 0.65, 0.15, 0.03, 0],
    [1.0, 0.1, 0.02, 0.005, 0],
  ],
  [R.FIREBALL]: [
    [0.0, 1.6, 1.0, 0.4, 0.4],
    [0.07, 1.3, 0.52, 0.12, 0.45],
    [0.18, 1.0, 0.31, 0.06, 0.5],
    [0.28, 0.55, 0.15, 0.035, 0.6],
    [0.38, 0.1, 0.06, 0.045, 0.92],
    [0.55, 0.075, 0.07, 0.065, 1.0],
    [1.0, 0.13, 0.125, 0.12, 1.0],
  ],
  [R.SMOKE_DARK]: [[0, 0.05, 0.047, 0.044, 1], [0.5, 0.075, 0.072, 0.07, 1], [1, 0.12, 0.118, 0.115, 1]],
  [R.SMOKE]: [[0, 0.14, 0.135, 0.13, 1], [1, 0.22, 0.215, 0.21, 1]],
  [R.STEAM]: [[0, 0.42, 0.42, 0.43, 1], [1, 0.48, 0.48, 0.5, 1]],
  [R.DUST]: [[0, 0.14, 0.11, 0.075, 1], [1, 0.17, 0.14, 0.1, 1]],
  [R.SPARK]: [
    [0.0, 9.0, 7.5, 5.0, 0],
    [0.3, 6.5, 3.2, 0.9, 0],
    [0.7, 2.4, 0.6, 0.1, 0],
    [1.0, 0.6, 0.1, 0.02, 0],
  ],
  [R.TESLA]: [
    [0.0, 8.0, 9.0, 12.0, 0],
    [0.3, 2.5, 4.0, 10.0, 0],
    [1.0, 0.3, 0.6, 2.5, 0],
  ],
  [R.EMBER]: [
    [0.0, 6.0, 3.0, 0.8, 0],
    [0.4, 3.2, 1.0, 0.18, 0],
    [1.0, 0.8, 0.15, 0.02, 0],
  ],
  [R.NUKE]: [
    [0.0, 9.0, 8.0, 6.0, 0],
    [0.04, 3.5, 2.0, 0.7, 0.2],
    [0.12, 2.0, 0.75, 0.16, 0.35],
    [0.24, 1.3, 0.42, 0.08, 0.45],
    [0.34, 0.6, 0.18, 0.05, 0.7],
    [0.45, 0.16, 0.09, 0.06, 0.92],
    [0.7, 0.13, 0.11, 0.1, 1.0],
    [1.0, 0.18, 0.17, 0.16, 1.0],
  ],
  [R.DEBRIS]: [[0, 0.07, 0.06, 0.05, 1], [1, 0.07, 0.06, 0.05, 1]],
  [R.DEBRIS_BURN]: [
    [0.0, 4.0, 1.8, 0.5, 0.3],
    [0.35, 1.4, 0.45, 0.1, 0.7],
    [0.7, 0.18, 0.08, 0.05, 1.0],
    [1.0, 0.07, 0.06, 0.05, 1.0],
  ],
  [R.SMOKE_FIRE]: [
    [0.0, 0.9, 0.35, 0.09, 0.45],
    [0.18, 0.2, 0.1, 0.06, 0.85],
    [0.45, 0.07, 0.065, 0.06, 1.0],
    [1.0, 0.12, 0.118, 0.115, 1.0],
  ],
  [R.TRAIL]: [
    [0.0, 2.0, 1.2, 0.5, 0.2],
    [0.04, 0.38, 0.36, 0.34, 0.85],
    [0.4, 0.3, 0.3, 0.3, 1.0],
    [1.0, 0.27, 0.27, 0.28, 1.0],
  ],
  [R.FLAME_JET]: [
    [0.0, 2.4, 1.5, 0.55, 0],
    [0.12, 2.0, 0.8, 0.18, 0.12],
    [0.42, 1.1, 0.3, 0.06, 0.3],
    [0.7, 0.3, 0.1, 0.04, 0.62],
    [1.0, 0.08, 0.075, 0.07, 0.9],
  ],
};

function buildRamp(): THREE.DataTexture {
  const W = 64;
  const data = new Uint16Array(W * RAMP_ROWS * 4);
  for (let row = 0; row < RAMP_ROWS; row++) {
    const keys = RAMPS[row] ?? RAMPS[R.WHITE];
    for (let x = 0; x < W; x++) {
      const t = x / (W - 1);
      let k = 0;
      while (k < keys.length - 2 && t > keys[k + 1][0]) k++;
      const a = keys[k];
      const b = keys[Math.min(k + 1, keys.length - 1)];
      const f = b[0] > a[0] ? clamp01((t - a[0]) / (b[0] - a[0])) : 0;
      const o = (row * W + x) * 4;
      for (let c = 0; c < 4; c++) {
        data[o + c] = THREE.DataUtils.toHalfFloat(a[c + 1] + (b[c + 1] - a[c + 1]) * f);
      }
    }
  }
  const t = new THREE.DataTexture(data, W, RAMP_ROWS, THREE.RGBAFormat, THREE.HalfFloatType);
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

export function createEffectTextures(): EffectTextures {
  const atlas = buildParticleAtlas();
  const decals = buildDecalAtlas();
  const noise = buildNoise();
  const ramp = buildRamp();
  return {
    atlas,
    decals,
    noise,
    ramp,
    dispose() {
      atlas.dispose();
      decals.dispose();
      noise.dispose();
      ramp.dispose();
    },
  };
}
