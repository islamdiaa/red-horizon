import * as THREE from 'three';
import { BAIL_COUNT } from '../data/rules';
import { lerp } from '../core/util';
import { Building, Entity, Unit } from '../sim/entities';
import type { Player } from '../sim/player';
import type { World } from '../sim/world';
import type { EntityRenderer } from './entities';

interface FloatText { x: number; y: number; z: number; text: string; color: string; t: number; life: number }

const _v = new THREE.Vector3();

/** Screen-space 2D overlay drawn on a canvas above the 3D view. */
export class Overlay {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private floats: FloatText[] = [];
  /** Projected screen position of the last project() call (no per-call array allocations). */
  private px = 0;
  private py = 0;
  /** Something was drawn last frame (otherwise the empty canvas needs no clear). */
  private drawn = true;
  private pts: [number, number, string][] = [];
  selectionBox: { x0: number; y0: number; x1: number; y1: number } | null = null;
  showAllBars = false;
  groups = new Map<number, number>();
  /**
   * Extra 2D layer drawn under the selection box (patrol routes, escort links, planned structures; see
   * ui/orderui.ts). `project` maps world (x, height, y) to CSS pixels or null; return true if anything was drawn.
   */
  extra: ((ctx: CanvasRenderingContext2D, project: (x: number, y: number, z: number) => [number, number] | null) => boolean) | null = null;

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'overlay-canvas';
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', this.onResize);
  }

  private onResize = () => this.resize();

  dispose() {
    window.removeEventListener('resize', this.onResize);
    this.canvas.remove();
  }

  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(window.innerWidth * this.dpr);
    this.canvas.height = Math.round(window.innerHeight * this.dpr);
  }

  addFloat(x: number, y: number, z: number, text: string, color = '#ffd34d') {
    this.floats.push({ x, y, z, text, color, t: 0, life: 1.6 });
  }

  /** Projects to screen space into this.px / this.py; returns false when outside the depth range. */
  private project(camera: THREE.Camera, x: number, y: number, z: number): boolean {
    _v.set(x, y, z).project(camera);
    this.px = (_v.x * 0.5 + 0.5) * this.vw;
    this.py = (-_v.y * 0.5 + 0.5) * this.vh;
    return _v.z < 1 && _v.z > -1;
  }

  private vw = 1;
  private vh = 1;

  draw(camera: THREE.Camera, world: World, ents: EntityRenderer, local: Player, selected: Set<number>, hovered: number, alpha: number, dt: number) {
    const ctx = this.ctx;
    const d = this.dpr;
    // the canvas covers the whole screen: skip the clear when it is already empty
    if (this.drawn) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.drawn = false;
    }
    ctx.setTransform(d, 0, 0, d, 0, 0);
    this.vw = window.innerWidth;
    this.vh = window.innerHeight;
    const map = world.map;
    const tick = world.tick;

    const drawFor = (e: Entity) => {
      if (!ents.isLive(e.id)) return; // no health bars on fogged last-seen structures
      const isSel = selected.has(e.id);
      const recent = tick - e.lastDamagedTick < 60;
      if (!isSel && hovered !== e.id && !this.showAllBars && !(recent && e.hp < e.maxHp)) return;
      let x: number, y: number;
      if (e instanceof Unit) { x = lerp(e.prevX, e.x, alpha); y = lerp(e.prevY, e.y, alpha); }
      else { x = e.x; y = e.y; }
      const top = ents.topOf(e.id);
      const h = map.surfaceAt(x, y) + top + 0.18 + (e instanceof Unit && e.kind === 'aircraft' ? e.altitude : 0);
      if (!this.project(camera, x, h, y)) return;
      const sx = this.px, sy = this.py;
      this.drawn = true;
      let w: number;
      if (e instanceof Building) w = 26 + e.w * 16;
      else if (e.kind === 'infantry') w = 22;
      else w = 34;
      this.healthBar(sx - w / 2, sy, w, e.healthFrac, isSel, e.owner === local);
      if (e.rank > 0) this.chevrons(sx - w / 2 - 9, sy + 2, e.rank);
      let yy = sy + 6;
      if (e instanceof Unit && e.ut.harvester && (isSel || hovered === e.id)) {
        this.bar(sx - w / 2, yy, w, 3, e.cargo / BAIL_COUNT, '#ffc93c');
        yy += 5;
      }
      if (e instanceof Building && e.owner === local) {
        if (e.repairing && Math.floor(world.time * 3) % 2 === 0) this.icon(sx + w / 2 + 8, sy + 2, '+', '#58ff8a');
        if (!e.powered && e.bt.requiresPower) this.icon(sx - w / 2 - 10, sy + 2, '⚡', '#ff5040');
        if (e.primary && isSel && e.bt.factory) this.tag(sx, sy - 10, 'PRIMARY');
      }
      const g = this.groups.get(e.id);
      if (g !== undefined && isSel) this.tag(sx + w / 2 + 6, sy - 4, String(g), true);
    };

    for (const b of world.buildings) if (b.alive) drawFor(b);
    for (const u of world.units) if (u.alive) drawFor(u);

    // planted demolition charges: a countdown that blinks faster as the fuse burns down
    for (const b of world.buildings) {
      if (!b.alive || b.c4Timer <= 0 || !ents.isLive(b.id)) continue;
      if (this.project(camera, b.x, map.surfaceAt(b.x, b.y) + ents.topOf(b.id) + 0.55, b.y)) {
        this.drawn = true;
        this.c4Tag(this.px, this.py, b.c4Timer, world.time);
      }
    }

    // order lines for selected own units (current order + shift-queued waypoints)
    ctx.save();
    ctx.lineWidth = 1.5;
    for (const id of selected) {
      const u = world.getEntity(id);
      if (!(u instanceof Unit) || u.owner !== local || !u.alive) continue;
      const pts = this.pts;
      pts.length = 0;
      const push = (o: typeof u.order) => {
        if (o.type === 'move' || o.type === 'attackGround' || o.type === 'guard') pts.push([o.x, o.y, o.type === 'move' && !o.attackMove ? '#58ff8a' : '#ff6a4a']);
        else if (o.type === 'attack' || o.type === 'enter') {
          const t = world.getEntity(o.target);
          if (t && t.alive) pts.push([t.x, t.y, o.type === 'attack' ? '#ff4a3a' : '#ffd34d']);
        }
      };
      push(u.order);
      for (const q of u.orderQueue) push(q);
      if (!pts.length) continue;
      this.drawn = true;
      this.project(camera, lerp(u.prevX, u.x, alpha), map.surfaceAt(u.x, u.y) + 0.05, lerp(u.prevY, u.y, alpha));
      let px = this.px, py = this.py;
      for (const [x, y, col] of pts) {
        if (!this.project(camera, x, map.surfaceAt(x, y) + 0.05, y)) break;
        const qx = this.px, qy = this.py;
        ctx.strokeStyle = col;
        ctx.globalAlpha = 0.35;
        ctx.setLineDash([4, 5]);
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(qx, qy); ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 0.7;
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(qx, qy, 2.5, 0, Math.PI * 2); ctx.fill();
        px = qx; py = qy;
      }
    }
    ctx.restore();

    // rally points of selected factories
    for (const id of selected) {
      const b = world.getEntity(id);
      if (!(b instanceof Building) || b.owner !== local || b.rallyX < 0) continue;
      this.project(camera, b.x, map.surfaceAt(b.x, b.y) + 0.3, b.y);
      const ax = this.px, ay = this.py;
      this.project(camera, b.rallyX, map.surfaceAt(b.rallyX, b.rallyY), b.rallyY);
      const bx = this.px, by = this.py;
      this.drawn = true;
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 220, 90, 0.85)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      ctx.lineDashOffset = -world.time * 20;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#ffd34d';
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx, by - 18); ctx.lineTo(bx + 12, by - 14); ctx.lineTo(bx, by - 10); ctx.fill();
      ctx.restore();
    }

    // floating texts
    for (const f of this.floats) {
      f.t += dt;
      const k = f.t / f.life;
      if (!this.project(camera, f.x, f.y + k * 0.8, f.z)) continue;
      const sx = this.px, sy = this.py;
      this.drawn = true;
      ctx.save();
      ctx.globalAlpha = Math.min(1, (1 - k) * 2);
      ctx.font = '700 15px "Rajdhani", "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.strokeText(f.text, sx, sy);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, sx, sy);
      ctx.restore();
    }
    let nf = 0;
    for (const f of this.floats) if (f.t < f.life) this.floats[nf++] = f;
    this.floats.length = nf;

    // order visualisation (ui/orderui.ts)
    if (this.extra) {
      ctx.save();
      if (this.extra(ctx, (x, y, z) => (this.project(camera, x, y, z) ? [this.px, this.py] : null))) this.drawn = true;
      ctx.restore();
    }

    // selection rectangle
    if (this.selectionBox) {
      const s = this.selectionBox;
      const x = Math.min(s.x0, s.x1), y = Math.min(s.y0, s.y1);
      const w = Math.abs(s.x1 - s.x0), h = Math.abs(s.y1 - s.y0);
      this.drawn = true;
      ctx.save();
      ctx.fillStyle = 'rgba(90, 255, 140, 0.08)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(120, 255, 160, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.shadowColor = 'rgba(80, 255, 140, 0.8)';
      ctx.shadowBlur = 8;
      ctx.strokeRect(x + 0.5, y + 0.5, w, h);
      ctx.restore();
    }
  }

  private healthBar(x: number, y: number, w: number, frac: number, selected: boolean, own: boolean) {
    const ctx = this.ctx;
    const h = 4;
    const col = frac > 0.5 ? '#4cff7a' : frac > 0.25 ? '#ffd23c' : '#ff4a3a';
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    this.round(x - 1.5, y - 1.5, w + 3, h + 3, 2.5);
    ctx.fill();
    const segs = Math.max(4, Math.round(w / 6));
    const sw = w / segs;
    const filled = frac * segs;
    for (let i = 0; i < segs; i++) {
      const f = Math.max(0, Math.min(1, filled - i));
      if (f <= 0) break;
      ctx.fillStyle = col;
      ctx.globalAlpha = selected || own ? 1 : 0.85;
      ctx.fillRect(x + i * sw + 0.5, y, sw * f - 1, h);
    }
    ctx.restore();
  }

  /** Gold rank chevrons (1 = veteran, 2 = elite). */
  private chevrons(x: number, y: number, rank: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 3;
    ctx.strokeStyle = rank >= 2 ? '#ffe27a' : '#e8b84a';
    for (let k = 0; k < rank; k++) {
      const yy = y - k * 4;
      ctx.beginPath();
      ctx.moveTo(x - 4, yy - 1);
      ctx.lineTo(x, yy + 2);
      ctx.lineTo(x + 4, yy - 1);
      ctx.stroke();
    }
    if (rank >= 2) {
      ctx.fillStyle = '#fff3b0';
      ctx.beginPath();
      ctx.arc(x, y - 9, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private bar(x: number, y: number, w: number, h: number, frac: number, color: string) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * Math.max(0, Math.min(1, frac)), h);
  }

  private icon(x: number, y: number, ch: string, color = '#ffffff') {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(ch, x, y);
    ctx.restore();
  }

  private c4Tag(x: number, y: number, left: number, time: number) {
    const blink = Math.sin(time * Math.PI * (left < 2 ? 8 : 3)) > 0;
    const ctx = this.ctx;
    ctx.save();
    ctx.font = '700 11px "Share Tech Mono", "Rajdhani", monospace';
    const text = `C4 ${left.toFixed(1)}`;
    const tw = ctx.measureText(text).width + 12;
    ctx.fillStyle = blink ? 'rgba(120, 10, 6, 0.9)' : 'rgba(40, 6, 4, 0.85)';
    ctx.shadowColor = '#ff3a1a';
    ctx.shadowBlur = blink ? 12 : 4;
    this.round(x - tw / 2, y - 8, tw, 16, 4);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#ff5a3a';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = blink ? '#fff' : '#ffb0a0';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + 0.5);
    ctx.restore();
  }

  private tag(x: number, y: number, text: string, square = false) {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = '700 10px "Rajdhani", "Segoe UI", sans-serif';
    const tw = ctx.measureText(text).width + 8;
    ctx.fillStyle = 'rgba(10, 20, 14, 0.8)';
    this.round(square ? x - 6 : x - tw / 2, y - 7, square ? 12 : tw, 13, 3);
    ctx.fill();
    ctx.strokeStyle = 'rgba(120, 255, 160, 0.7)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#b8ffcc';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  private round(x: number, y: number, w: number, h: number, r: number) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
