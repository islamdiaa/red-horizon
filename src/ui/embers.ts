/** Floating embers / dust motes drawn over the live demo battle behind the main menu. */
import { reducedMotion } from './dom';

interface Mote { x: number; y: number; vx: number; vy: number; size: number; life: number; max: number; depth: number; phase: number; hot: boolean }

export class Embers {
  private ctx: CanvasRenderingContext2D;
  private motes: Mote[] = [];
  private raf = 0;
  private last = 0;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private mx = 0;
  private my = 0;
  private sprites: HTMLCanvasElement[];
  private onResize = () => this.resize();

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.sprites = [this.sprite('255,150,60', '255,230,180'), this.sprite('255,80,40', '255,190,120'), this.sprite('180,210,255', '255,255,255')];
    window.addEventListener('resize', this.onResize);
    this.resize();
    if (reducedMotion()) return;
    for (let i = 0; i < this.count(); i++) this.motes.push(this.spawn(true));
    this.last = performance.now();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  /** Pointer position in -0.5..0.5 for parallax. */
  pointer(x: number, y: number) {
    this.mx = x;
    this.my = y;
  }

  private sprite(edge: string, core: string): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d')!;
    const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grd.addColorStop(0, `rgba(${core},1)`);
    grd.addColorStop(0.25, `rgba(${edge},0.85)`);
    grd.addColorStop(1, `rgba(${edge},0)`);
    g.fillStyle = grd;
    g.fillRect(0, 0, 32, 32);
    return c;
  }

  private count() {
    return Math.round(Math.min(110, Math.max(40, (this.w * this.h) / 22000)));
  }

  private resize() {
    this.dpr = Math.min(1.5, window.devicePixelRatio || 1);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
  }

  private spawn(anywhere: boolean): Mote {
    const depth = 0.3 + Math.random() * 0.7;
    const hot = Math.random() < 0.82;
    const max = 6 + Math.random() * 9;
    return {
      x: Math.random() * this.w,
      y: anywhere ? Math.random() * this.h : this.h + 20,
      vx: (Math.random() - 0.3) * 14 * depth,
      vy: -(14 + Math.random() * 36) * depth,
      size: (hot ? 3 + Math.random() * 6 : 2 + Math.random() * 3) * depth,
      life: anywhere ? Math.random() * max : 0,
      max,
      depth,
      phase: Math.random() * 10,
      hot,
    };
  }

  private frame(now: number) {
    if (!this.canvas.isConnected) {
      window.removeEventListener('resize', this.onResize);
      return;
    }
    this.raf = requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.globalCompositeOperation = 'lighter';
    const t = now / 1000;
    for (let i = 0; i < this.motes.length; i++) {
      const m = this.motes[i];
      m.life += dt;
      m.x += (m.vx + Math.sin(t * 0.9 + m.phase) * 10 * m.depth) * dt;
      m.y += m.vy * dt;
      if (m.life > m.max || m.y < -30 || m.x > this.w + 30) { this.motes[i] = this.spawn(false); continue; }
      const k = m.life / m.max;
      const fade = Math.min(1, k * 5) * Math.min(1, (1 - k) * 3);
      const flicker = m.hot ? 0.65 + 0.35 * Math.sin(t * 9 + m.phase * 3) : 1;
      ctx.globalAlpha = Math.max(0, fade * flicker * (m.hot ? 0.9 : 0.35) * m.depth);
      const px = m.x - this.mx * 40 * m.depth, py = m.y - this.my * 26 * m.depth;
      const s = m.size * (m.hot ? 1 - k * 0.5 : 1);
      ctx.drawImage(this.sprites[m.hot ? (m.phase > 7 ? 1 : 0) : 2], px - s, py - s, s * 2, s * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  stop() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
  }
}
