/**
 * Top-down 2D editing view: the map rendered to a bitmap (terrain colours by climate with smooth
 * per-pixel hill shading, water depth, forests, ore and gems, bridges), drawn with pan / zoom, plus
 * the shared overlays. Fast enough to repaint while a stroke is in progress.
 */
import { T, WATER_LEVEL, type GameMap } from '../sim/map';
import type { Climate } from '../maps/format';
import { hash2 } from '../core/rng';
import { drawOverlay, type OverlayState, type Proj } from './overlay';

type RGB = [number, number, number];
const PAL: Record<Climate, { clear: RGB; sand: RGB; dirt: RGB; rock: RGB; deep: RGB; shallow: RGB; tree: RGB; treeHi: RGB }> = {
  temperate: { clear: [86, 118, 58], sand: [184, 164, 116], dirt: [118, 94, 64], rock: [120, 114, 104], deep: [16, 48, 78], shallow: [44, 108, 128], tree: [30, 62, 30], treeHi: [62, 104, 48] },
  winter: { clear: [214, 222, 232], sand: [176, 178, 184], dirt: [140, 134, 130], rock: [104, 110, 120], deep: [52, 84, 112], shallow: [120, 160, 186], tree: [44, 70, 62], treeHi: [180, 196, 200] },
  desert: { clear: [196, 160, 104], sand: [224, 194, 140], dirt: [168, 118, 78], rock: [146, 98, 70], deep: [22, 74, 92], shallow: [54, 132, 136], tree: [92, 96, 48], treeHi: [140, 138, 70] },
};

export class View2D {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private bmp = document.createElement('canvas');
  private bmpScale = 6;
  /** Pixels per cell and the canvas position of map (0, 0). */
  zoom = 6;
  ox = 0;
  oy = 0;
  private mapW = 0;
  private dpr = 1;

  constructor(host: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'ed-canvas ed-2d';
    host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.resize();
  }

  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(window.innerWidth * this.dpr);
    this.canvas.height = Math.round(window.innerHeight * this.dpr);
  }

  /** Fit the whole map into the free area between the panels. */
  fit(N: number, area: { left: number; right: number; top: number; bottom: number }) {
    const w = window.innerWidth - area.left - area.right, h = window.innerHeight - area.top - area.bottom;
    this.zoom = Math.max(1, Math.min(w, h) / N * 0.94);
    this.ox = area.left + (w - N * this.zoom) / 2;
    this.oy = area.top + (h - N * this.zoom) / 2;
  }

  zoomAt(sx: number, sy: number, factor: number) {
    const z = Math.max(1.5, Math.min(64, this.zoom * factor));
    const k = z / this.zoom;
    this.ox = sx - (sx - this.ox) * k;
    this.oy = sy - (sy - this.oy) * k;
    this.zoom = z;
  }

  pan(dx: number, dy: number) {
    this.ox += dx;
    this.oy += dy;
  }

  toMap(sx: number, sy: number): [number, number] {
    return [(sx - this.ox) / this.zoom, (sy - this.oy) / this.zoom];
  }

  /** Re-render the map bitmap (call when the map changes). */
  paint(map: GameMap) {
    const N = map.w;
    this.mapW = N;
    const S = N <= 96 ? 8 : N <= 128 ? 6 : 4;
    this.bmpScale = S;
    const W = N * S;
    if (this.bmp.width !== W) { this.bmp.width = W; this.bmp.height = W; }
    const c = this.bmp.getContext('2d')!;
    const img = c.createImageData(W, W);
    const d = img.data;
    const pal = PAL[map.climate as keyof typeof PAL] ?? PAL.temperate; // (no tropical maps in the editor)
    const V = N + 1;
    const H = map.heights;
    const lx = -0.55, ly = -0.75; // light from the top-left
    // per-cell base colours (water by depth at the cell centre), blended bilinearly between cell centres
    // so shores and terrain borders read smoothly; hill shading per pixel from the bilinear heights
    const cr = new Float32Array(N * N), cg = new Float32Array(N * N), cb = new Float32Array(N * N), wet = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) {
      const t = map.terrain[i];
      const cx = i % N, cy = (i / N) | 0;
      let col: RGB;
      if (t === T.Water) {
        const depth = Math.min(1, Math.max(0, (WATER_LEVEL - map.heightAt(cx + 0.5, cy + 0.5)) / 0.55));
        col = [pal.shallow[0] + (pal.deep[0] - pal.shallow[0]) * depth, pal.shallow[1] + (pal.deep[1] - pal.shallow[1]) * depth, pal.shallow[2] + (pal.deep[2] - pal.shallow[2]) * depth];
        wet[i] = 1;
      } else {
        const base = t === T.Sand ? pal.sand : t === T.Dirt ? pal.dirt : t === T.Rock ? pal.rock : pal.clear;
        const n = (hash2(cx, cy, 77) - 0.5) * 10;
        col = [base[0] + n, base[1] + n, base[2] + n * 0.6];
      }
      cr[i] = col[0]; cg[i] = col[1]; cb[i] = col[2];
    }
    const at = (x: number, y: number) => Math.min(N - 1, Math.max(0, y)) * N + Math.min(N - 1, Math.max(0, x));
    for (let py = 0; py < W; py++) {
      const my = (py + 0.5) / S;
      const fy = my - 0.5, y0 = Math.floor(fy), ty = fy - y0;
      const cyi = Math.min(N - 1, Math.floor(my)), vty = my - cyi;
      for (let px = 0; px < W; px++) {
        const mx = (px + 0.5) / S;
        const fx = mx - 0.5, x0 = Math.floor(fx), tx = fx - x0;
        const i00 = at(x0, y0), i10 = at(x0 + 1, y0), i01 = at(x0, y0 + 1), i11 = at(x0 + 1, y0 + 1);
        const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
        let r = cr[i00] * w00 + cr[i10] * w10 + cr[i01] * w01 + cr[i11] * w11;
        let g = cg[i00] * w00 + cg[i10] * w10 + cg[i01] * w01 + cg[i11] * w11;
        let bl = cb[i00] * w00 + cb[i10] * w10 + cb[i01] * w01 + cb[i11] * w11;
        const wat = wet[i00] * w00 + wet[i10] * w10 + wet[i01] * w01 + wet[i11] * w11;
        // hill shading on land (from this pixel's cell)
        const cxi = Math.min(N - 1, Math.floor(mx)), vtx = mx - cxi;
        const a = H[cyi * V + cxi], b = H[cyi * V + cxi + 1], c2 = H[(cyi + 1) * V + cxi], d2 = H[(cyi + 1) * V + cxi + 1];
        const h = (a * (1 - vtx) + b * vtx) * (1 - vty) + (c2 * (1 - vtx) + d2 * vtx) * vty;
        if (wat < 0.999) {
          const gx = (b - a) * (1 - vty) + (d2 - c2) * vty, gy = (c2 - a) * (1 - vtx) + (d2 - b) * vtx;
          const k = map.terrain[cyi * N + cxi] === T.Rock ? 2.2 : 1.5;
          const shade = 1 + (Math.max(0.55, Math.min(1.5, 1 - (gx * lx + gy * ly) * k + Math.max(h, WATER_LEVEL) * 0.12)) - 1) * (1 - wat);
          r *= shade; g *= shade; bl *= shade;
        }
        // a soft foam line along the shore
        const foam = wat > 0.25 && wat < 0.75 ? (1 - Math.abs(wat - 0.5) * 4) * 0.35 : 0;
        const o = (py * W + px) * 4;
        d[o] = r + (235 - r) * foam; d[o + 1] = g + (240 - g) * foam; d[o + 2] = bl + (240 - bl) * foam; d[o + 3] = 255;
      }
    }
    c.putImageData(img, 0, 0);
    // ore, gems and trees
    for (let cy = 0; cy < N; cy++) for (let cx = 0; cx < N; cx++) {
      const i = cy * N + cx;
      if (map.ore[i]) {
        const k = 0.45 + (map.ore[i] / 9) * 0.55;
        const gem = map.gems[i];
        for (let j = 0; j < 3; j++) {
          const ox = hash2(cx, cy, 11 + j) * 0.7 + 0.15, oy = hash2(cx, cy, 31 + j) * 0.7 + 0.15;
          c.fillStyle = gem ? `rgba(${200 * k + 40},${110 * k + 40},255,0.95)` : `rgba(255,${190 * k + 30},${60 * k},0.95)`;
          c.beginPath();
          c.arc((cx + ox) * S, (cy + oy) * S, S * (0.12 + 0.1 * k), 0, Math.PI * 2);
          c.fill();
        }
      }
      if (map.tree[i]) {
        const ox = 0.5 + (hash2(cx, cy, 5) - 0.5) * 0.3, oy = 0.5 + (hash2(cx, cy, 6) - 0.5) * 0.3;
        const r = S * (0.36 + hash2(cx, cy, 7) * 0.12);
        c.fillStyle = 'rgba(0,0,0,0.3)';
        c.beginPath(); c.arc((cx + ox) * S + r * 0.25, (cy + oy) * S + r * 0.3, r, 0, Math.PI * 2); c.fill();
        c.fillStyle = `rgb(${pal.tree.join(',')})`;
        c.beginPath(); c.arc((cx + ox) * S, (cy + oy) * S, r, 0, Math.PI * 2); c.fill();
        c.fillStyle = `rgba(${pal.treeHi.join(',')},0.8)`;
        c.beginPath(); c.arc((cx + ox) * S - r * 0.3, (cy + oy) * S - r * 0.3, r * 0.45, 0, Math.PI * 2); c.fill();
      }
    }
    // bridges: plank decks
    for (const br of map.bridges) {
      for (const [x, y] of br.cells) {
        c.fillStyle = '#8a6440';
        if (br.axis === 'x') c.fillRect(x * S, y * S + S * 0.15, S, S * 0.7); else c.fillRect(x * S + S * 0.15, y * S, S * 0.7, S);
        c.fillStyle = 'rgba(0,0,0,0.35)';
        for (let k = 1; k < 4; k++) {
          if (br.axis === 'x') c.fillRect(x * S + (k * S) / 4, y * S + S * 0.15, 1, S * 0.7); else c.fillRect(x * S + S * 0.15, y * S + (k * S) / 4, S * 0.7, 1);
        }
      }
    }
  }

  /** Draw the bitmap, the grid and the overlays. */
  draw(o: OverlayState, time: number, grid: boolean) {
    const ctx = this.ctx;
    const k = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const g = ctx.createRadialGradient(this.canvas.width / 2, this.canvas.height / 2, 0, this.canvas.width / 2, this.canvas.height / 2, this.canvas.width * 0.7);
    g.addColorStop(0, '#101820');
    g.addColorStop(1, '#03060a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    const N = this.mapW;
    if (N) {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = 30;
      ctx.fillStyle = '#000';
      ctx.fillRect(this.ox, this.oy, N * this.zoom, N * this.zoom);
      ctx.restore();
      ctx.imageSmoothingEnabled = this.zoom < this.bmpScale * 1.6;
      ctx.drawImage(this.bmp, this.ox, this.oy, N * this.zoom, N * this.zoom);
      if (grid && this.zoom >= 7) {
        ctx.strokeStyle = 'rgba(0,0,0,0.16)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        const step = this.zoom >= 14 ? 1 : 4;
        for (let i = 0; i <= N; i += step) {
          ctx.moveTo(this.ox + i * this.zoom + 0.5, this.oy);
          ctx.lineTo(this.ox + i * this.zoom + 0.5, this.oy + N * this.zoom);
          ctx.moveTo(this.ox, this.oy + i * this.zoom + 0.5);
          ctx.lineTo(this.ox + N * this.zoom, this.oy + i * this.zoom + 0.5);
        }
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.strokeRect(this.ox - 0.5, this.oy - 0.5, N * this.zoom + 1, N * this.zoom + 1);
    }
    const proj: Proj = (x, y) => [this.ox + x * this.zoom, this.oy + y * this.zoom];
    drawOverlay(ctx, proj, o, time);
  }

  dispose() {
    this.canvas.remove();
  }
}
