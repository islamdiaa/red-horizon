/**
 * Editor overlays drawn on a 2D canvas on top of either view: symmetry guides, starts, bridges under
 * the cursor, the brush (and its symmetric ghosts), the stroke in progress, mission placements and
 * objective / trigger areas. Views pass a projection from map coordinates to canvas pixels.
 */
import { symmetryGroup } from '../maps/build';
import type { MapDef, Pt } from '../maps/format';
import { START_COLORS } from '../maps/preview';
import { BUILDINGS, UNITS } from '../data/rules';
import type { GameMap } from '../sim/map';
import { startRefs } from './doc';
import type { MissionSpec } from './mission';
import { typeName } from '../i18n/names';

/** Map (x, y) -> canvas pixel, or null when off-screen / behind the camera. */
export type Proj = (x: number, y: number) => [number, number] | null;

export interface OverlayState {
  def: MapDef;
  map: GameMap;
  mission: MissionSpec | null;
  /** Show mission placements / areas. */
  missionMode: boolean;
  hover: Pt | null;
  /** Brush ring radius (cells) at the cursor; 0 = none. */
  brushR: number;
  brushColor: string;
  /** Draw ghost rings at the symmetric copies. */
  ghosts: boolean;
  stroke: Pt[] | null;
  /** Bridge preview (cells) under the cursor. */
  bridgePreview: [number, number][] | null;
  selected: number | null;
  /** Structure footprint preview under the cursor (mission placing). */
  ghostFootprint: { w: number; h: number; ok: boolean } | null;
  guides: boolean;
  picking: boolean;
  /** Highlighted point (validation issue). */
  flash: Pt | null;
  /** The view shows the real models (3D): outline placements instead of filling them. */
  models?: boolean;
}

export const PLAYER_COLORS = START_COLORS;

function ring(ctx: CanvasRenderingContext2D, proj: Proj, x: number, y: number, r: number, seg = 40): boolean {
  let first = true, any = false;
  ctx.beginPath();
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const p = proj(x + Math.cos(a) * r, y + Math.sin(a) * r);
    if (!p) { first = true; continue; }
    any = true;
    if (first) { ctx.moveTo(p[0], p[1]); first = false; } else ctx.lineTo(p[0], p[1]);
  }
  return any;
}

function poly(ctx: CanvasRenderingContext2D, proj: Proj, pts: Pt[], close = false): boolean {
  let first = true, any = false;
  ctx.beginPath();
  for (const [x, y] of pts) {
    const p = proj(x, y);
    if (!p) { first = true; continue; }
    any = true;
    if (first) { ctx.moveTo(p[0], p[1]); first = false; } else ctx.lineTo(p[0], p[1]);
  }
  if (close && any) ctx.closePath();
  return any;
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color = '#fff', size = 12, bg = 'rgba(0,0,0,0.6)') {
  ctx.font = `700 ${size}px Rajdhani, 'RH Cyrillic', system-ui, 'RH CJK', sans-serif`;
  const w = ctx.measureText(text).width;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(x - w / 2 - 4, y - size * 0.62 - 2, w + 8, size * 1.24 + 4, 4);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + 0.5);
}

/** Pixels per cell around (x, y) for this projection. */
function pxPerCell(proj: Proj, x: number, y: number): number {
  const a = proj(x, y), b = proj(x + 1, y);
  return a && b ? Math.hypot(b[0] - a[0], b[1] - a[1]) : 0;
}

export function drawOverlay(ctx: CanvasRenderingContext2D, proj: Proj, s: OverlayState, time: number) {
  const { def, map } = s;
  const N = def.size;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // ---- symmetry guides
  if (s.guides && def.symmetry !== 'none') {
    ctx.strokeStyle = 'rgba(255,211,77,0.55)';
    ctx.setLineDash([10, 8]);
    ctx.lineWidth = 1.5;
    const c = def.center ?? [N / 2, N / 2];
    const clip = ([x, y]: Pt): Pt => [Math.max(0, Math.min(N, x)), Math.max(0, Math.min(N, y))];
    const line = (a: Pt, b: Pt) => {
      // clip the segment to the map square (parametric, then sample along it so 3D follows the terrain)
      let t0 = 0, t1 = 1;
      const dx = b[0] - a[0], dy = b[1] - a[1];
      for (const [p, q] of [[-dx, a[0]], [dx, N - a[0]], [-dy, a[1]], [dy, N - a[1]]]) {
        if (p === 0) { if (q < 0) return; continue; }
        const r = q / p;
        if (p < 0) t0 = Math.max(t0, r); else t1 = Math.min(t1, r);
      }
      if (t0 >= t1) return;
      const A = clip([a[0] + dx * t0, a[1] + dy * t0]), B = clip([a[0] + dx * t1, a[1] + dy * t1]);
      if (poly(ctx, proj, Array.from({ length: 21 }, (_, i) => [A[0] + ((B[0] - A[0]) * i) / 20, A[1] + ((B[1] - A[1]) * i) / 20] as Pt))) ctx.stroke();
    };
    if (def.symmetry === 'mirrorX' || def.symmetry === 'mirror4') line([N / 2, 0], [N / 2, N]);
    if (def.symmetry === 'mirrorY' || def.symmetry === 'mirror4') line([0, N / 2], [N, N / 2]);
    if (def.symmetry === 'mirrorD') line([0, 0], [N, N]);
    if (def.symmetry === 'rot2' || def.symmetry === 'rot4' || def.symmetry === 'rot3') {
      const k = def.symmetry === 'rot2' ? 2 : def.symmetry === 'rot4' ? 4 : 3;
      // sector borders halfway between the players' starts
      const s0 = def.starts[0];
      const base = s0 ? Math.atan2(s0[1] - c[1], s0[0] - c[0]) : Math.PI / 2;
      for (let i = 0; i < k; i++) {
        const a = base + Math.PI / k + (i / k) * Math.PI * 2;
        line([c[0], c[1]], [c[0] + Math.cos(a) * N * 2, c[1] + Math.sin(a) * N * 2]);
      }
      ctx.setLineDash([]);
      if (ring(ctx, proj, c[0], c[1], 1.2)) { ctx.fillStyle = 'rgba(255,211,77,0.85)'; ctx.fill(); }
    }
    ctx.setLineDash([]);
  }

  // ---- bridges (outline every built bridge)
  ctx.lineWidth = 2;
  for (const b of map.bridges) {
    const [x0, y0] = b.cells[0], [x1, y1] = b.cells[b.cells.length - 1];
    if (poly(ctx, proj, [[x0, y0], [x1 + 1, y0], [x1 + 1, y1 + 1], [x0, y1 + 1]], true)) {
      ctx.strokeStyle = 'rgba(255,230,180,0.75)';
      ctx.stroke();
    }
  }
  if (s.bridgePreview?.length) {
    const c = s.bridgePreview;
    const [x0, y0] = c[0], [x1, y1] = c[c.length - 1];
    if (poly(ctx, proj, [[x0, y0], [x1 + 1, y0], [x1 + 1, y1 + 1], [x0, y1 + 1]], true)) {
      ctx.fillStyle = 'rgba(255,211,77,0.35)';
      ctx.fill();
      ctx.strokeStyle = '#ffd34d';
      ctx.stroke();
    }
  }

  // ---- mission: areas and placements
  if (s.mission && s.missionMode) {
    const areas: { x: number; y: number; r: number; text: string; color: string }[] = [];
    for (const o of s.mission.objectives) if (o.kind === 'reach' && o.x !== undefined && o.y !== undefined) areas.push({ x: o.x, y: o.y, r: o.r ?? 3, text: `◎ ${o.text || o.id}`, color: '#58ff8a' });
    for (const t of s.mission.triggers) {
      if (t.when === 'area' && t.x !== undefined && t.y !== undefined) areas.push({ x: t.x, y: t.y, r: t.r ?? 4, text: `⚑ ${t.id}`, color: '#5ab4ff' });
      for (const a of t.actions) {
        if (a.kind === 'reinforce' && a.x !== undefined && a.y !== undefined) {
          const from = proj(a.x, a.y), to = a.tx !== undefined && a.ty !== undefined ? proj(a.tx, a.ty) : null;
          if (from && to) {
            ctx.strokeStyle = 'rgba(90,180,255,0.8)'; ctx.setLineDash([6, 5]); ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(from[0], from[1]); ctx.lineTo(to[0], to[1]); ctx.stroke(); ctx.setLineDash([]);
          }
          if (from) label(ctx, `➜ ${t.id}`, from[0], from[1], '#9fd4ff', 11);
        }
        if (a.kind === 'reveal' && a.x !== undefined && a.y !== undefined) areas.push({ x: a.x, y: a.y, r: a.r ?? 8, text: `👁 ${t.id}`, color: '#b98cff' });
      }
    }
    for (const a of areas) {
      if (!ring(ctx, proj, a.x, a.y, a.r)) continue;
      ctx.fillStyle = a.color + '22';
      ctx.fill();
      ctx.strokeStyle = a.color;
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
      const p = proj(a.x, a.y);
      if (p) label(ctx, a.text, p[0], p[1], a.color, 12);
    }
    s.mission.placements.forEach((pl, i) => {
      const col = PLAYER_COLORS[pl.player % PLAYER_COLORS.length];
      const sel = i === s.selected;
      if (pl.kind === 'structure') {
        const bt = BUILDINGS[pl.type];
        if (!bt) return;
        const x = Math.round(pl.x), y = Math.round(pl.y), w = bt.size[0], h = bt.size[1];
        if (!poly(ctx, proj, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true)) return;
        if (!s.models) { ctx.fillStyle = col + (sel ? 'cc' : '88'); ctx.fill(); }
        ctx.lineWidth = sel ? 3 : s.models ? 2 : 1.5;
        ctx.strokeStyle = sel ? '#fff' : s.models ? col + 'cc' : 'rgba(0,0,0,0.7)';
        if (s.models && !sel) ctx.setLineDash([6, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
        const p = proj(x + w / 2, y + h + 0.55);
        if (p && pxPerCell(proj, x, y) > 5 && (pl.tag || sel || pxPerCell(proj, x, y) > 12)) label(ctx, (pl.tag ? '★ ' + pl.tag + ' · ' : '') + typeName(bt), p[0], p[1], '#fff', 11, 'rgba(0,0,0,0.55)');
      } else {
        const ut = UNITS[pl.type];
        if (!ut) return;
        const k = Math.max(0.28, ut.radius);
        if (!ring(ctx, proj, pl.x, pl.y, s.models ? k + 0.25 : k, 14)) return;
        if (!s.models) { ctx.fillStyle = col; ctx.fill(); }
        ctx.lineWidth = sel ? 3 : s.models ? 2 : 1.2;
        ctx.strokeStyle = sel ? '#fff' : s.models ? col : 'rgba(0,0,0,0.8)';
        ctx.stroke();
        const p = proj(pl.x, pl.y - 0.9);
        if (p && (pl.tag || sel) && pxPerCell(proj, pl.x, pl.y) > 4) label(ctx, (pl.tag ? '★ ' + pl.tag : typeName(ut)), p[0], p[1], '#fff', 11);
      }
    });
  }

  // ---- starts
  const refs = startRefs(def);
  for (const r of refs) {
    const col = PLAYER_COLORS[r.index % PLAYER_COLORS.length];
    const R = def.clearRadius ?? 9.5;
    if (ring(ctx, proj, r.x, r.y, R, 48)) {
      ctx.strokeStyle = col + 'aa';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 6]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const p = proj(r.x, r.y);
    if (!p) continue;
    const rad = Math.max(9, Math.min(18, pxPerCell(proj, r.x, r.y) * 1.3));
    ctx.beginPath();
    ctx.arc(p[0], p[1], rad * 1.7, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(p[0], p[1], rad, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = r.g === 0 ? '#fff' : 'rgba(255,255,255,0.6)';
    if (r.g !== 0) ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#fff';
    ctx.font = `800 ${Math.round(rad * 1.15)}px Rajdhani, 'RH Cyrillic', system-ui, 'RH CJK', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(r.index + 1), p[0], p[1] + 1);
  }

  // ---- stroke in progress
  if (s.stroke && s.stroke.length > 1 && s.brushR > 0) {
    const pts = s.stroke.map((q) => proj(q[0], q[1])).filter((q): q is [number, number] => !!q);
    if (pts.length > 1) {
      ctx.strokeStyle = s.brushColor + '66';
      ctx.lineWidth = Math.max(2, pxPerCell(proj, s.stroke[0][0], s.stroke[0][1]) * s.brushR * 2);
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (const q of pts.slice(1)) ctx.lineTo(q[0], q[1]);
      ctx.stroke();
    }
  }

  // ---- brush / cursor
  if (s.hover) {
    const [hx, hy] = s.hover;
    if (s.ghostFootprint) {
      const { w, h, ok } = s.ghostFootprint;
      const x = Math.round(hx - w / 2), y = Math.round(hy - h / 2);
      if (poly(ctx, proj, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true)) {
        ctx.fillStyle = ok ? 'rgba(88,255,138,0.25)' : 'rgba(255,74,58,0.3)';
        ctx.fill();
        ctx.strokeStyle = ok ? '#58ff8a' : '#ff4a3a';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    } else if (s.brushR > 0) {
      const G = symmetryGroup(def);
      if (s.ghosts) {
        for (const g of G.slice(1)) {
          const [gx, gy] = g.f(hx, hy);
          if (!ring(ctx, proj, gx, gy, s.brushR)) continue;
          ctx.strokeStyle = 'rgba(255,255,255,0.45)';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([5, 5]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      if (ring(ctx, proj, hx, hy, s.brushR)) {
        ctx.fillStyle = s.brushColor + '2a';
        ctx.fill();
        ctx.strokeStyle = s.brushColor;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    } else if (s.picking) {
      const p = proj(hx, hy);
      if (p) {
        ctx.strokeStyle = '#58ff8a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(p[0] - 12, p[1]); ctx.lineTo(p[0] + 12, p[1]);
        ctx.moveTo(p[0], p[1] - 12); ctx.lineTo(p[0], p[1] + 12);
        ctx.stroke();
      }
    }
  }

  // ---- flash (a validation issue was clicked)
  if (s.flash) {
    const k = (Math.sin(time * 8) + 1) / 2;
    if (ring(ctx, proj, s.flash[0], s.flash[1], 3 + k * 2)) {
      ctx.strokeStyle = `rgba(255,74,58,${0.5 + k * 0.5})`;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }
  ctx.restore();
}
