import { GameMap, T } from '../sim/map';
import type { Player } from '../sim/player';
import type { World } from '../sim/world';

const TERRAIN_RGB: Record<number, [number, number, number]> = {
  [T.Clear]: [58, 84, 44],
  [T.Water]: [16, 46, 70],
  [T.Rock]: [96, 94, 90],
  [T.Sand]: [146, 128, 92],
  [T.Dirt]: [92, 74, 52],
};

export class Minimap {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cellCanvas: HTMLCanvasElement;
  private cellCtx: CanvasRenderingContext2D;
  private img: ImageData;
  private base: Uint8ClampedArray;
  private noiseCanvas = document.createElement('canvas');
  private onlineT = 0;
  private wasOnline = false;
  private dragging = false;
  private vignette: CanvasGradient | null = null;
  pings: { x: number; y: number; t: number; color: string }[] = [];

  constructor(
    container: HTMLElement,
    private world: World,
    private local: Player,
    private onPoint: (x: number, y: number, button: number, drag: boolean) => void,
  ) {
    const map = world.map;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 512;
    this.canvas.height = 512;
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.cellCanvas = document.createElement('canvas');
    this.cellCanvas.width = map.w;
    this.cellCanvas.height = map.h;
    this.cellCtx = this.cellCanvas.getContext('2d')!;
    this.img = this.cellCtx.createImageData(map.w, map.h);
    this.base = new Uint8ClampedArray(map.w * map.h * 3);
    this.buildBase(map);

    const toMap = (ev: PointerEvent): [number, number] => {
      const r = this.canvas.getBoundingClientRect();
      return [((ev.clientX - r.left) / r.width) * map.w, ((ev.clientY - r.top) / r.height) * map.h];
    };
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('pointerdown', (ev) => {
      if (!this.local.radar && this.world.fog) return;
      const [x, y] = toMap(ev);
      if (ev.button === 0) {
        this.dragging = true;
        this.canvas.setPointerCapture(ev.pointerId);
      }
      this.onPoint(x, y, ev.button, false);
    });
    this.canvas.addEventListener('pointermove', (ev) => {
      if (!this.dragging) return;
      const [x, y] = toMap(ev);
      this.onPoint(x, y, 0, true);
    });
    this.canvas.addEventListener('pointerup', () => { this.dragging = false; });
  }

  private buildBase(map: GameMap) {
    for (let y = 0; y < map.h; y++) {
      for (let x = 0; x < map.w; x++) {
        const i = map.idx(x, y);
        const c = TERRAIN_RGB[map.terrain[i]] ?? TERRAIN_RGB[T.Clear];
        // hill shading from the height gradient
        const h0 = map.vertexHeight(x, y), h1 = map.vertexHeight(x + 1, y + 1);
        const shade = Math.max(0.6, Math.min(1.4, 1 + (h0 - h1) * 1.2 + (map.vertexHeight(x, y + 1) - map.vertexHeight(x + 1, y)) * 0.3));
        let [r, g, b] = c;
        if (map.tree[i]) { r = 30; g = 58; b = 28; }
        this.base[i * 3] = r * shade;
        this.base[i * 3 + 1] = g * shade;
        this.base[i * 3 + 2] = b * shade;
      }
    }
  }

  ping(x: number, y: number, color = '#ff4a3a') {
    this.pings.push({ x, y, t: 0, color });
  }

  draw(view: [number, number][], dt: number, time: number) {
    const world = this.world;
    const map = world.map;
    const p = this.local;
    const online = p.radar || !world.fog;
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    if (online && !this.wasOnline) this.onlineT = 0;
    this.wasOnline = online;
    this.onlineT += dt;

    if (!online) {
      // static noise
      const nc = this.noiseCanvas;
      if (nc.width !== W / 4) { nc.width = W / 4; nc.height = H / 4; }
      const nctx = nc.getContext('2d')!;
      const id = nctx.createImageData(nc.width, nc.height);
      for (let i = 0; i < id.data.length; i += 4) {
        const v = Math.random() * 40;
        id.data[i] = v * 0.6; id.data[i + 1] = v * 0.8; id.data[i + 2] = v; id.data[i + 3] = 255;
      }
      nctx.putImageData(id, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(nc, 0, 0, W, H);
      return;
    }

    // terrain + ore + fog per cell
    const d = this.img.data;
    const fogOn = world.fog;
    for (let i = 0, n = map.w * map.h; i < n; i++) {
      let r = this.base[i * 3], g = this.base[i * 3 + 1], b = this.base[i * 3 + 2];
      if (map.ore[i]) {
        if (map.gems[i]) { r = 170; g = 90; b = 220; } else { r = 200; g = 160; b = 60; }
      }
      if (fogOn) {
        if (!p.explored[i]) { r = 0; g = 0; b = 0; }
        else if (!p.visible[i]) { r *= 0.5; g *= 0.5; b *= 0.55; }
      }
      d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255;
    }
    this.cellCtx.putImageData(this.img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.cellCanvas, 0, 0, W, H);

    const sx = W / map.w, sy = H / map.h;
    // structures
    // subtle vignette so the edges read as a scope
    if (!this.vignette) {
      this.vignette = ctx.createRadialGradient(W / 2, H / 2, W * 0.32, W / 2, H / 2, W * 0.75);
      this.vignette.addColorStop(0, 'rgba(0,0,0,0)');
      this.vignette.addColorStop(1, 'rgba(0,6,12,0.55)');
    }
    ctx.fillStyle = this.vignette;
    ctx.fillRect(0, 0, W, H);

    for (const b of world.buildings) {
      if (!b.alive) continue;
      if (b.owner.team !== p.team && fogOn && !p.explored[map.idx(b.cx, b.cy)]) continue;
      const x = b.cx * sx, y = b.cy * sy, w = b.w * sx, h = b.h * sy;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
      ctx.fillStyle = hex(b.owner.color);
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
    }
    // units
    for (const u of world.units) {
      if (!u.alive) continue;
      if (u.owner.team !== p.team && fogOn && !world.isVisible(p, u.x, u.y)) continue;
      const s = u.kind === 'infantry' ? 4 : u.kind === 'aircraft' ? 7 : 6;
      const x = u.x * sx - s / 2, y = u.y * sy - s / 2;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(x - 1, y - 1, s + 2, s + 2);
      ctx.fillStyle = u.owner === p ? lighten(u.owner.color) : hex(u.owner.color);
      ctx.fillRect(x, y, s, s);
    }
    // camera view
    if (view.length === 4) {
      ctx.save();
      ctx.beginPath();
      view.forEach(([x, y], k) => (k ? ctx.lineTo(x * sx, y * sy) : ctx.moveTo(x * sx, y * sy)));
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fill();
      ctx.shadowColor = 'rgba(255,255,255,0.8)';
      ctx.shadowBlur = 8;
      ctx.strokeStyle = 'rgba(255,255,255,0.92)';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.restore();
    }
    // attack pings: double ripple + beacon
    for (const pg of this.pings) {
      pg.t += dt;
      const k = pg.t / 2;
      const cx = pg.x * sx, cy = pg.y * sy;
      ctx.strokeStyle = pg.color;
      for (const off of [0, 0.3]) {
        const kk = k - off;
        if (kk < 0) continue;
        ctx.globalAlpha = Math.max(0, 1 - kk) * 0.9;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, 6 + kk * 46, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 0.5 + 0.5 * Math.sin(pg.t * 14);
      ctx.fillStyle = pg.color;
      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    this.pings = this.pings.filter((pg) => pg.t < 2);
    // radar boot-up sweep
    if (this.onlineT < 1.4) {
      const r = (this.onlineT / 1.4) * W * 0.75;
      ctx.save();
      ctx.globalCompositeOperation = 'destination-in';
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = 'rgba(120,255,170,0.8)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    void time;
  }
}

function hex(c: number): string {
  return '#' + c.toString(16).padStart(6, '0');
}

/** Own units are drawn slightly brighter so they pop against allied structures. */
function lighten(c: number): string {
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  const l = (v: number) => Math.min(255, Math.round(v + (255 - v) * 0.35));
  return `rgb(${l(r)},${l(g)},${l(b)})`;
}
