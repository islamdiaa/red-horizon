/**
 * [CTRL] Shared unit-control UI: the 2D order layer drawn on the overlay canvas (patrol routes, escort links,
 * rally-to-unit lines, planned structures, the patrol route being placed), the formation selector of the
 * selection panel, a radial menu (touch long-press, gamepad), the icons for the new orders, and the CSS for
 * touch / gamepad / radial UI (injected once, so styles.css stays untouched).
 */
import { BUILDINGS, getType } from '../data/rules';
import { lerp } from '../core/util';
import { Building, Unit } from '../sim/entities';
import type { Player } from '../sim/player';
import type { FormationShape } from '../sim/types';
import type { World } from '../sim/world';
import { esc, tipHtml } from './dom';

const svg = (body: string) =>
  `<svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const dots = (pts: [number, number][]) => svg(pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.9" fill="currentColor" stroke="none"/>`).join(''));

export const CTRL_ICONS = {
  patrol: svg('<path d="M4.5 11a7.5 7.5 0 0 1 13-4.6"/><path d="M18.5 2.8v4h-4"/><path d="M19.5 13a7.5 7.5 0 0 1-13 4.6"/><path d="M5.5 21.2v-4h4"/>'),
  guard: svg('<path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z"/><path d="M8.5 12l2.4 2.4 4.6-4.8"/>'),
  stop: svg('<rect x="5.5" y="5.5" width="13" height="13" rx="2"/>'),
  attackMove: svg('<circle cx="15" cy="9" r="5.5"/><path d="M15 1.5v3M15 13.5v3M7.5 9h3M19.5 9h3"/><path d="M3 21l7.5-7.5M10.5 13.5H5.5M10.5 13.5v5"/>'),
  force: svg('<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.5"/><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4"/>'),
  scatter: svg('<path d="M12 12l-6-6M12 12l6-6M12 12l-6 6M12 12l6 6"/><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>'),
  deploy: svg('<path d="M4 18h16M6 18V9l6-4 6 4v9"/><path d="M10 18v-5h4v5"/>'),
  box: svg('<rect x="4" y="4" width="16" height="16" rx="1.5" stroke-dasharray="3 2.4"/><path d="M14 14l6 6"/>'),
  add: svg('<path d="M12 5v14M5 12h14"/>'),
  all: svg('<circle cx="7" cy="8" r="2.4"/><circle cx="17" cy="8" r="2.4"/><circle cx="12" cy="16" r="2.4"/><path d="M2.5 21c.8-2.6 2.6-3.8 4.5-3.8M21.5 21c-.8-2.6-2.6-3.8-4.5-3.8"/>'),
  stance: svg('<path d="M14.5 17.5L3 6V3h3l11.5 11.5"/><path d="M13 19l6-6M16 16l4 4"/>'),
  formation: dots([[6, 7], [12, 7], [18, 7], [6, 13], [12, 13], [18, 13]]),
  sell: svg('<circle cx="12" cy="12" r="8.5"/><path d="M14.8 8.8c-.6-.9-1.6-1.3-2.8-1.3-1.7 0-2.9.9-2.9 2.2 0 3.2 6 1.7 6 4.8 0 1.4-1.3 2.3-3.1 2.3-1.3 0-2.4-.5-3-1.4M12 5.5v13"/>'),
  repair: svg('<path d="M14.5 6.5a4 4 0 0 0-5.3 5.2L4 17l3 3 5.3-5.2a4 4 0 0 0 5.2-5.3l-2.5 2.5-2.5-.5-.5-2.5z"/>'),
  primary: svg('<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/>'),
  rally: svg('<path d="M6 21V4M6 4h11l-2.5 4L17 12H6"/>'),
  home: svg('<path d="M3 11.5L12 4l9 7.5M5.5 9.5V20h13V9.5"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
};

export const FORMATION_INFO: { id: FormationShape; title: string; desc: string; icon: string }[] = [
  { id: 'none', title: 'Auto formation', desc: 'Keep your relative positions on the move; a spread-out group gathers into a box (armour in front, artillery at the back).', icon: dots([[6, 8], [14, 6], [10, 13], [18, 14], [6, 18]]) },
  { id: 'line', title: 'Line', desc: 'A broad battle line facing the direction of travel: every gun can fire forward.', icon: dots([[3, 12], [7.5, 12], [12, 12], [16.5, 12], [21, 12]]) },
  { id: 'box', title: 'Box', desc: 'A compact block: armour in the front rows, rocket infantry and artillery protected in the middle and back.', icon: dots([[6, 6], [12, 6], [18, 6], [6, 12], [12, 12], [18, 12], [6, 18], [12, 18], [18, 18]]) },
  { id: 'wedge', title: 'Wedge', desc: 'An arrowhead led by the toughest unit: punches through and covers both flanks.', icon: dots([[12, 4], [8, 10], [16, 10], [4, 16], [12, 16], [20, 16]]) },
];

/** Formation selector for the selection panel (own ground units). */
export function formationBar(units: Unit[], set: (shape: FormationShape) => void): HTMLElement | null {
  const ground = units.filter((u) => u.kind === 'infantry' || u.kind === 'vehicle');
  if (ground.length < 2) return null;
  const box = document.createElement('div');
  box.className = 'stances formations';
  box.innerHTML = '<span class="st-lbl">Formation</span>';
  for (const f of FORMATION_INFO) {
    const b = document.createElement('button');
    b.className = 'stance fm';
    b.dataset.fm = f.id;
    b.innerHTML = f.icon;
    b.dataset.tip = tipHtml(f.title, `${f.desc} The group moves at the pace of its slowest unit.`, [['L', 'cycle formations']]);
    b.setAttribute('aria-label', `Formation: ${f.title}`);
    b.onclick = () => set(f.id);
    box.appendChild(b);
  }
  return box;
}

/** Highlight the selection's formation (none when mixed). */
export function refreshFormationBar(panel: HTMLElement, units: Unit[]) {
  const box = panel.querySelector('.formations');
  if (!box) return;
  let cur: string | null = null;
  for (const u of units) {
    if (u.kind !== 'infantry' && u.kind !== 'vehicle') continue;
    if (cur === null) cur = u.formShape ?? 'none';
    else if (cur !== (u.formShape ?? 'none')) { cur = 'mixed'; break; }
  }
  for (const b of box.querySelectorAll<HTMLElement>('.fm')) b.classList.toggle('on', b.dataset.fm === cur);
}

// ---------------------------------------------------------------------------
// Order layer on the overlay canvas
// ---------------------------------------------------------------------------

/** What the order layer needs from the input controller. */
export interface OrderVizHost {
  world: World;
  local: Player;
  selection: Set<number>;
  alpha: number;
  mode: string;
  placeType: string | null;
  patrolPts: [number, number][];
  groundX: number;
  groundY: number;
  /** Plan placement ghost validity (plan mode). */
  planOk: boolean;
}

type Project = (x: number, y: number, z: number) => [number, number] | null;

const PATROL = '#ffc24a';
const ESCORT = '#5fd8ff';

export class OrderViz {
  constructor(private h: OrderVizHost) {}

  draw(ctx: CanvasRenderingContext2D, project: Project): boolean {
    const { world, local, selection } = this.h;
    const map = world.map;
    const a = this.h.alpha;
    const time = performance.now() / 1000;
    let drawn = false;
    const at = (x: number, y: number, lift = 0.06) => project(x, map.surfaceAt(x, y) + lift, y);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // --- planned structures (always visible: they are the base layout to come)
    const plan = local.buildPlan;
    if (plan.length) {
      const strong = this.h.mode === 'plan' || this.h.mode === 'place' || [...selection].some((id) => (world.getEntity(id) as Building | undefined)?.bt?.factory === 'building');
      plan.forEach((it, k) => {
        const bt = BUILDINGS[it.type];
        if (!bt) return;
        const pts = [at(it.cx, it.cy), at(it.cx + bt.size[0], it.cy), at(it.cx + bt.size[0], it.cy + bt.size[1]), at(it.cx, it.cy + bt.size[1])];
        if (pts.some((p) => !p)) return;
        drawn = true;
        const head = k === 0;
        ctx.globalAlpha = strong ? 1 : 0.6;
        ctx.beginPath();
        pts.forEach((p, i) => (i ? ctx.lineTo(p![0], p![1]) : ctx.moveTo(p![0], p![1])));
        ctx.closePath();
        ctx.fillStyle = head ? 'rgba(255, 210, 80, 0.20)' : 'rgba(110, 200, 255, 0.13)';
        ctx.fill();
        ctx.setLineDash([5, 4]);
        ctx.lineDashOffset = head ? -time * 14 : 0;
        ctx.strokeStyle = head ? 'rgba(255, 215, 90, 0.95)' : 'rgba(140, 210, 255, 0.85)';
        ctx.lineWidth = 1.6;
        ctx.stroke();
        ctx.setLineDash([]);
        const c = at(it.cx + bt.size[0] / 2, it.cy + bt.size[1] / 2, 0.3);
        if (c) this.badge(ctx, c[0], c[1], `${k + 1}`, getType(it.type).name, head);
        ctx.globalAlpha = 1;
      });
    }

    // --- per selected own unit: patrol loops and escort links
    const seenRoutes = new Set<string>();
    for (const id of selection) {
      const e = world.getEntity(id);
      if (e instanceof Building && e.owner === local && e.rallyUnit) {
        const t = world.getEntity(e.rallyUnit);
        if (t instanceof Unit && t.alive) {
          const p0 = at(e.x, e.y, 0.3), p1 = at(lerp(t.prevX, t.x, a), lerp(t.prevY, t.y, a), 0.1);
          if (p0 && p1) {
            drawn = true;
            this.dashed(ctx, p0, p1, '#ffd34d', 2, time * 20);
            this.ring(ctx, p1[0], p1[1], 13, '#ffd34d', time);
          }
        }
        continue;
      }
      if (!(e instanceof Unit) || e.owner !== local || !e.alive) continue;
      const ux = lerp(e.prevX, e.x, a), uy = lerp(e.prevY, e.y, a);
      const orders = [e.order, ...e.orderQueue];
      for (let o of orders) {
        if (o.type === 'attack' && o.resume) o = o.resume;
        if (o.type === 'patrol' && o.points?.length) {
          const key = o.points.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('|');
          const u0 = at(ux, uy);
          const cur = at(o.points[o.idx % o.points.length][0], o.points[o.idx % o.points.length][1]);
          if (u0 && cur) { drawn = true; this.dashed(ctx, u0, cur, PATROL, 1.4, 0, 0.45); }
          if (seenRoutes.has(key)) continue;
          seenRoutes.add(key);
          const pts = o.points.map(([x, y]) => at(x, y));
          if (pts.some((p) => !p)) continue;
          drawn = true;
          for (let k = 0; k < pts.length; k++) {
            const p = pts[k]!, q = pts[(k + 1) % pts.length]!;
            this.dashed(ctx, p, q, PATROL, 1.8, -time * 16, 0.8);
            this.chevron(ctx, p, q, PATROL);
          }
          for (const p of pts) this.node(ctx, p![0], p![1], PATROL);
        } else if (o.type === 'escort') {
          const t = world.getEntity(o.target);
          if (!t || !t.alive) continue;
          const tx = t instanceof Unit ? lerp(t.prevX, t.x, a) : t.x, ty = t instanceof Unit ? lerp(t.prevY, t.y, a) : t.y;
          const p0 = at(ux, uy, 0.1), p1 = at(tx, ty, 0.1);
          if (!p0 || !p1) continue;
          drawn = true;
          this.dashed(ctx, p0, p1, ESCORT, 1.4, -time * 10, 0.55);
          this.shield(ctx, p1[0], p1[1] - 16, ESCORT);
        }
      }
    }

    // --- the patrol route being placed (patrol mode)
    if (this.h.mode === 'patrol') {
      const units = [...selection].map((id) => world.getEntity(id)).filter((u): u is Unit => u instanceof Unit && u.owner === local && u.alive);
      if (units.length) {
        let cx = 0, cy = 0;
        for (const u of units) { cx += u.x; cy += u.y; }
        const route: [number, number][] = [[cx / units.length, cy / units.length], ...this.h.patrolPts, [this.h.groundX, this.h.groundY]];
        const pts = route.map(([x, y]) => at(x, y));
        if (pts.every(Boolean)) {
          drawn = true;
          for (let k = 0; k < pts.length; k++) {
            const p = pts[k]!, q = pts[(k + 1) % pts.length]!;
            this.dashed(ctx, p, q, PATROL, 2, -time * 18, k === pts.length - 1 ? 0.35 : 0.9);
            if (k < pts.length - 1) this.chevron(ctx, p, q, PATROL);
          }
          for (const p of pts.slice(1)) this.node(ctx, p![0], p![1], PATROL);
        }
      }
    }
    return drawn;
  }

  private dashed(ctx: CanvasRenderingContext2D, p: [number, number], q: [number, number], col: string, w: number, offset = 0, alpha = 0.85) {
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.strokeStyle = col;
    ctx.lineWidth = w;
    ctx.setLineDash([6, 5]);
    ctx.lineDashOffset = offset;
    ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
    ctx.restore();
  }

  private chevron(ctx: CanvasRenderingContext2D, p: [number, number], q: [number, number], col: string) {
    const dx = q[0] - p[0], dy = q[1] - p[1];
    const l = Math.hypot(dx, dy);
    if (l < 30) return;
    const ux = dx / l, uy = dy / l;
    const mx = p[0] + dx * 0.5, my = p[1] + dy * 0.5;
    ctx.save();
    ctx.strokeStyle = col;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(mx - ux * 6 - uy * 5, my - uy * 6 + ux * 5);
    ctx.lineTo(mx, my);
    ctx.lineTo(mx - ux * 6 + uy * 5, my - uy * 6 - ux * 5);
    ctx.stroke();
    ctx.restore();
  }

  private node(ctx: CanvasRenderingContext2D, x: number, y: number, col: string) {
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  private ring(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, col: string, time: number) {
    ctx.save();
    ctx.strokeStyle = col;
    ctx.globalAlpha = 0.5 + 0.4 * Math.sin(time * 4);
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.55, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  private shield(ctx: CanvasRenderingContext2D, x: number, y: number, col: string) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(4, 18, 26, 0.8)';
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -7); ctx.lineTo(6, -4.5); ctx.lineTo(6, 0.5); ctx.quadraticCurveTo(5, 5.5, 0, 7.5); ctx.quadraticCurveTo(-5, 5.5, -6, 0.5); ctx.lineTo(-6, -4.5);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  private badge(ctx: CanvasRenderingContext2D, x: number, y: number, n: string, name: string, head: boolean) {
    ctx.save();
    ctx.font = '700 11px "Rajdhani", "Segoe UI", sans-serif';
    const label = `${n} · ${name}`;
    const w = ctx.measureText(label).width + 12;
    ctx.fillStyle = head ? 'rgba(60, 44, 6, 0.85)' : 'rgba(6, 24, 40, 0.82)';
    ctx.strokeStyle = head ? 'rgba(255, 215, 90, 0.9)' : 'rgba(140, 210, 255, 0.8)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - 8, w, 16, 4);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = head ? '#ffe9a8' : '#cfeaff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y + 0.5);
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// Radial menu (touch long-press, gamepad)
// ---------------------------------------------------------------------------

export interface RadialItem {
  id: string;
  label: string;
  icon: string;
  /** Keyboard equivalent shown under the label. */
  key?: string;
  on?: boolean;
  disabled?: boolean;
  /** Opens a nested ring instead of running. */
  sub?: RadialItem[];
  run?(): void;
}

export class RadialMenu {
  readonly el: HTMLElement;
  private items: RadialItem[] = [];
  private stack: { items: RadialItem[]; title: string }[] = [];
  private buttons: HTMLButtonElement[] = [];
  private center: HTMLElement;
  private hl = -1;
  private x = 0;
  private y = 0;
  private onClose: (() => void) | null = null;

  constructor() {
    injectCtrlStyles();
    this.el = document.createElement('div');
    this.el.id = 'rh-radial';
    this.el.innerHTML = '<div class="rr-back"></div><div class="rr-center"></div>';
    this.center = this.el.querySelector('.rr-center')!;
    this.el.querySelector('.rr-back')!.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.close(); });
    document.body.appendChild(this.el);
  }

  get isOpen(): boolean {
    return this.el.classList.contains('on');
  }

  open(x: number, y: number, items: RadialItem[], title = '', onClose?: () => void) {
    const R = this.radius(items.length);
    this.x = Math.max(R + 40, Math.min(window.innerWidth - R - 40, x));
    this.y = Math.max(R + 40, Math.min(window.innerHeight - R - 40, y));
    this.stack = [];
    this.onClose = onClose ?? null;
    this.show(items, title);
  }

  private radius(n: number) {
    return Math.max(78, Math.min(130, 24 + n * 10));
  }

  private show(items: RadialItem[], title: string) {
    this.items = items;
    for (const b of this.buttons) b.remove();
    this.buttons = [];
    const n = items.length;
    const R = this.radius(n);
    items.forEach((it, k) => {
      const ang = -Math.PI / 2 + (k / n) * Math.PI * 2;
      const b = document.createElement('button');
      b.className = 'rr-item' + (it.on ? ' on' : '') + (it.sub ? ' has-sub' : '');
      b.disabled = !!it.disabled;
      b.innerHTML = `${it.icon}<span>${esc(it.label)}</span>${it.key ? `<kbd>${esc(it.key)}</kbd>` : ''}`;
      b.style.left = `${this.x + Math.cos(ang) * R}px`;
      b.style.top = `${this.y + Math.sin(ang) * R}px`;
      b.style.setProperty('--d', `${k * 18}ms`);
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      b.addEventListener('click', (e) => { e.stopPropagation(); this.pick(k); });
      this.el.appendChild(b);
      this.buttons.push(b);
    });
    this.center.style.left = `${this.x}px`;
    this.center.style.top = `${this.y}px`;
    this.center.textContent = title;
    this.hl = -1;
    this.el.classList.add('on');
  }

  /** Gamepad: highlight the item in direction (dx, dy) (stick); centre = none. */
  aim(dx: number, dy: number) {
    if (Math.hypot(dx, dy) < 0.45) return;
    const n = this.items.length;
    let a = Math.atan2(dy, dx) + Math.PI / 2;
    if (a < 0) a += Math.PI * 2;
    this.highlight(Math.round((a / (Math.PI * 2)) * n) % n);
  }

  /** Step the highlight (D-pad). */
  step(d: number) {
    const n = this.items.length;
    this.highlight(((this.hl < 0 ? (d > 0 ? -1 : 0) : this.hl) + d + n) % n);
  }

  private highlight(k: number) {
    if (k === this.hl) return;
    this.hl = k;
    this.buttons.forEach((b, i) => b.classList.toggle('hl', i === k));
    const it = this.items[k];
    if (it) this.center.textContent = it.label;
  }

  confirm() {
    if (this.hl >= 0) this.pick(this.hl);
  }

  /** B / tap outside: leave a sub-ring, or close. */
  back() {
    const prev = this.stack.pop();
    if (prev) this.show(prev.items, prev.title);
    else this.close();
  }

  private pick(k: number) {
    const it = this.items[k];
    if (!it || it.disabled) return;
    if (it.sub) {
      this.stack.push({ items: this.items, title: this.center.textContent ?? '' });
      this.show(it.sub, it.label);
      return;
    }
    this.close();
    it.run?.();
  }

  close() {
    if (!this.isOpen) return;
    this.el.classList.remove('on');
    for (const b of this.buttons) b.remove();
    this.buttons = [];
    const cb = this.onClose;
    this.onClose = null;
    cb?.();
  }

  dispose() {
    this.close();
    this.el.remove();
  }
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

let styled = false;
const cursor = (body: string, hot = 16, fallback = 'pointer') => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'>${body}</svg>`)}") ${hot} ${hot}, ${fallback}`;

export function injectCtrlStyles() {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  const st = document.createElement('style');
  st.id = 'ctrl-styles';
  st.textContent = `
body.cur-guard #game-canvas { cursor: ${cursor("<g fill='none' stroke='#5fd8ff' stroke-width='2.4' stroke-linejoin='round'><path d='M16 5l8 3v6c0 4.6-3.4 8.4-8 9.4-4.6-1-8-4.8-8-9.4V8z'/><path d='M12.5 15l2.6 2.6 4.6-5'/></g>")}; }
body.cur-patrol #game-canvas { cursor: ${cursor("<g fill='none' stroke='#ffc24a' stroke-width='2.4' stroke-linecap='round'><path d='M7 15a9 9 0 0 1 15.6-6'/><path d='M23 4v5h-5'/><path d='M25 17a9 9 0 0 1-15.6 6'/><path d='M9 28v-5h5'/></g>", 16, 'crosshair')}; }
body.cur-rally #game-canvas { cursor: ${cursor("<g fill='none' stroke='#ffd34d' stroke-width='2.4' stroke-linejoin='round'><path d='M9 28V5h14l-3 5 3 5H9'/></g>")}; }
.formations .fm svg { font-size: 1.15rem; }
.bitem[data-planned]::after { content: 'Planned ' attr(data-planned); position: absolute; left: 0.3rem; top: 0.3rem; z-index: 3; padding: 0.05rem 0.3rem; border-radius: 0.3rem;
  background: rgba(6, 24, 40, 0.88); border: 1px solid rgba(140, 210, 255, 0.7); color: #cfeaff; font: 700 0.55rem 'Rajdhani', 'Segoe UI', sans-serif; letter-spacing: 0.05em; text-transform: uppercase; pointer-events: none; }
.stance.fm.on { color: #fff; }

/* --- radial menu */
#rh-radial { position: fixed; inset: 0; z-index: 80; pointer-events: none; visibility: hidden; }
#rh-radial.on { visibility: visible; }
#rh-radial .rr-back { position: absolute; inset: 0; background: radial-gradient(circle at var(--x, 50%) var(--y, 50%), rgba(0, 0, 0, 0.15), rgba(0, 0, 0, 0.35)); opacity: 0; transition: opacity 0.18s; }
#rh-radial.on .rr-back { opacity: 1; pointer-events: auto; }
#rh-radial .rr-center { position: absolute; transform: translate(-50%, -50%); padding: 0.3rem 0.7rem; border-radius: 1rem; background: rgba(8, 14, 20, 0.88); border: 1px solid rgba(120, 220, 255, 0.35);
  color: #dff4ff; font: 700 0.8rem 'Rajdhani', 'Segoe UI', sans-serif; letter-spacing: 0.08em; text-transform: uppercase; white-space: nowrap; }
#rh-radial .rr-center:empty { display: none; }
#rh-radial .rr-item { position: absolute; width: 4.3rem; height: 4.3rem; margin: -2.15rem 0 0 -2.15rem; border-radius: 50%; pointer-events: auto; cursor: pointer;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.12rem; color: #e6f3ff;
  background: radial-gradient(circle at 50% 35%, rgba(40, 60, 78, 0.96), rgba(10, 16, 24, 0.96)); border: 1.5px solid rgba(140, 210, 255, 0.4);
  box-shadow: 0 0.4rem 1rem rgba(0, 0, 0, 0.5); font: 700 0.62rem 'Rajdhani', 'Segoe UI', sans-serif; letter-spacing: 0.03em; text-transform: uppercase;
  animation: rrIn 0.22s cubic-bezier(.2,1.4,.4,1) both; animation-delay: var(--d); touch-action: none; }
#rh-radial .rr-item svg { font-size: 1.35rem; }
#rh-radial .rr-item span { max-width: 4rem; text-align: center; line-height: 1; }
#rh-radial .rr-item kbd { font-size: 0.5rem; padding: 0 0.2rem; opacity: 0.7; background: rgba(0, 0, 0, 0.35); border: 0; border-radius: 0.2rem; }
#rh-radial .rr-item.on { border-color: #ffd34d; color: #fff2c0; }
#rh-radial .rr-item.has-sub::after { content: ''; position: absolute; right: 0.45rem; top: 50%; border: 0.22rem solid transparent; border-left-color: currentColor; transform: translateY(-50%); opacity: 0.6; }
#rh-radial .rr-item.hl, #rh-radial .rr-item:hover { border-color: #8fffc0; background: radial-gradient(circle at 50% 35%, rgba(60, 150, 100, 0.98), rgba(14, 44, 30, 0.98)); transform: scale(1.12); color: #fff; }
#rh-radial .rr-item:disabled { opacity: 0.35; }
@keyframes rrIn { from { opacity: 0; transform: scale(0.4); } }

/* --- touch */
body.touch-ui #game-canvas { touch-action: none; }
#touch-bar { position: fixed; z-index: 7; left: 0.6rem; top: 50%; transform: translateY(-50%); display: none; flex-direction: column; gap: 0.45rem; pointer-events: none; }
body.touch-ui #touch-bar { display: flex; }
#touch-bar button { pointer-events: auto; width: 3.6rem; height: 3.6rem; border-radius: 0.9rem; border: 1px solid rgba(140, 210, 255, 0.35); color: #e6f3ff;
  background: linear-gradient(180deg, rgba(30, 44, 58, 0.9), rgba(10, 16, 24, 0.9)); box-shadow: 0 0.3rem 0.8rem rgba(0, 0, 0, 0.45);
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.1rem; font: 700 0.56rem 'Rajdhani', 'Segoe UI', sans-serif; letter-spacing: 0.04em; text-transform: uppercase; touch-action: manipulation; }
#touch-bar button svg { font-size: 1.4rem; }
#touch-bar button.on { border-color: #ffd34d; color: #fff2c0; background: linear-gradient(180deg, rgba(110, 84, 10, 0.92), rgba(40, 28, 4, 0.92)); box-shadow: 0 0 0.9rem rgba(255, 211, 77, 0.45); }
#touch-bar button:active { transform: scale(0.93); }
#touch-bar .tb-sep { height: 0.2rem; }
#touch-hint { position: fixed; z-index: 7; left: 50%; top: 4.2rem; transform: translateX(-50%); padding: 0.35rem 0.9rem; border-radius: 1rem; pointer-events: none;
  background: rgba(8, 14, 20, 0.85); border: 1px solid rgba(255, 211, 77, 0.5); color: #fff2c0; font: 700 0.8rem 'Rajdhani', 'Segoe UI', sans-serif; letter-spacing: 0.06em; opacity: 0; transition: opacity 0.2s; }
#touch-hint.on { opacity: 1; }
.touch-press { position: fixed; z-index: 79; width: 4.4rem; height: 4.4rem; margin: -2.2rem 0 0 -2.2rem; border-radius: 50%; pointer-events: none; border: 3px solid rgba(255, 211, 77, 0.9);
  animation: touchPress 0.5s linear both; }
@keyframes touchPress { from { transform: scale(1.6); opacity: 0; } to { transform: scale(0.7); opacity: 1; } }
@media (pointer: coarse) {
  .cmds { grid-template-columns: repeat(3, 3.3rem); grid-auto-rows: 3.1rem; }
  .stances { grid-template-columns: repeat(2, 3rem); grid-auto-rows: 2.7rem; }
  #groups .grp { min-width: 3.2rem; min-height: 3.2rem; }
  #sidebar .tab { min-height: 2.9rem; }
  #topbar .tb-btn { min-height: 2.8rem; }
}

/* --- gamepad */
#gp-cursor { position: fixed; z-index: 90; left: 0; top: 0; width: 34px; height: 34px; margin: -17px 0 0 -17px; pointer-events: none; display: none; filter: drop-shadow(0 0 3px rgba(0, 0, 0, 0.9)); }
body.gamepad-ui #gp-cursor { display: block; }
body.gamepad-ui #game-canvas { cursor: none !important; }
#gp-cursor.box svg .gp-ring { stroke-dasharray: 4 3; }
.gp-focus { outline: 3px solid #ffd34d !important; outline-offset: 2px !important; box-shadow: 0 0 1rem rgba(255, 211, 77, 0.6) !important; }
#gp-help { position: fixed; z-index: 7; left: calc((100vw - var(--sidebar-w, 22rem)) / 2); top: 3.6rem; transform: translateX(-50%); display: none; gap: 0.9rem; padding: 0.25rem 0.8rem; border-radius: 1rem; pointer-events: none;
  background: rgba(8, 14, 20, 0.75); color: #cfe6f7; font: 600 0.72rem 'Rajdhani', 'Segoe UI', sans-serif; letter-spacing: 0.04em; white-space: nowrap; }
body.gamepad-ui #gp-help { display: flex; }
#gp-help b { display: inline-flex; align-items: center; justify-content: center; min-width: 1.2rem; height: 1.2rem; margin-right: 0.25rem; border-radius: 50%; font-size: 0.65rem; color: #08121c; background: #cfe6f7; }
#gp-help b.A { background: #5ee08a; } #gp-help b.B { background: #ff6a5a; } #gp-help b.X { background: #5ab4ff; } #gp-help b.Y { background: #ffd34d; }

/* [HUD] Modern layout: planned tag above the card's name, touch toolbar under the objectives column (wraps on short
   screens), larger build tabs for fingers */
body.hud-modern #buildbar .bitem[data-planned]::after { left: 50%; top: auto; bottom: 2.45rem; transform: translateX(-50%); white-space: nowrap; }
body.hud-modern #touch-bar { top: calc(var(--edge, 0.7rem) + var(--tl-h, 7rem) + 0.6rem); transform: none; flex-wrap: wrap; align-content: flex-start;
  max-height: calc(100vh - var(--tl-h, 7rem) - var(--dock-h, 16rem) - 2.6rem); }
body.hud-modern.touch-ui .hint { left: calc(var(--edge, 0.7rem) + 4.4rem); }
@media (pointer: coarse) {
  body.hud-modern #buildbar .tab { min-height: 0; padding: 0 1rem; }
  body.hud-modern #buildbar .bb-top { height: 2.6rem; }
}
`;
  document.head.appendChild(st);
}
