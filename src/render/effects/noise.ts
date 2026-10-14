/**
 * CPU-side 2D gradient noise used once at start-up to build procedural textures.
 * Supports an optional integer period so textures can tile.
 */
export class Noise2 {
  private perm = new Uint16Array(512);
  private gx = new Float32Array(256);
  private gy = new Float32Array(256);

  constructor(seed: number) {
    let s = seed >>> 0 || 1;
    const r = (): number => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), s | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const p = new Uint16Array(256);
    for (let i = 0; i < 256; i++) {
      p[i] = i;
      const a = r() * Math.PI * 2;
      this.gx[i] = Math.cos(a);
      this.gy[i] = Math.sin(a);
    }
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  /** Gradient noise in roughly [-1, 1]. `period` > 0 makes it tile with that integer period. */
  noise(x: number, y: number, period = 0): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    let x0 = xi, y0 = yi, x1 = xi + 1, y1 = yi + 1;
    if (period > 0) {
      x0 = ((x0 % period) + period) % period;
      y0 = ((y0 % period) + period) % period;
      x1 = ((x1 % period) + period) % period;
      y1 = ((y1 % period) + period) % period;
    }
    const P = this.perm;
    const h00 = P[P[x0 & 255] + (y0 & 255)];
    const h10 = P[P[x1 & 255] + (y0 & 255)];
    const h01 = P[P[x0 & 255] + (y1 & 255)];
    const h11 = P[P[x1 & 255] + (y1 & 255)];
    const d00 = this.gx[h00] * xf + this.gy[h00] * yf;
    const d10 = this.gx[h10] * (xf - 1) + this.gy[h10] * yf;
    const d01 = this.gx[h01] * xf + this.gy[h01] * (yf - 1);
    const d11 = this.gx[h11] * (xf - 1) + this.gy[h11] * (yf - 1);
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const a = d00 + (d10 - d00) * u;
    const b = d01 + (d11 - d01) * u;
    return (a + (b - a) * v) * 1.4;
  }

  /** Fractal sum, roughly [-1, 1]. */
  fbm(x: number, y: number, octaves: number, period = 0): number {
    let sum = 0;
    let amp = 0.5;
    let f = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.noise(x * f, y * f, period > 0 ? period * f : 0);
      norm += amp;
      amp *= 0.5;
      f *= 2;
    }
    return sum / norm;
  }
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
