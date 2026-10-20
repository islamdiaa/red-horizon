import { MinHeap } from '../core/util';
import type { GameMap } from './map';

const SQRT2 = Math.SQRT2;
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];
const COST = [1, 1, 1, 1, SQRT2, SQRT2, SQRT2, SQRT2];

/** A path waypoint; `bay`: a passing place a vehicle pulls into to let another one by (unitlogic.ts giveWay). */
export interface PathPoint { x: number; y: number; bay?: boolean }

/** Movement layer: ground units (land, bridges) or ships (open water). */
export type Locomotor = 'ground' | 'naval';

/**
 * Grid A* (8-connected, no corner cutting) with nearest-reachable fallback and
 * line-of-sight path smoothing. Uses generation counters to avoid clearing arrays.
 */
export class PathFinder {
  private g: Float32Array;
  private from: Int32Array;
  private gen: Uint32Array;
  private closed: Uint32Array;
  private curGen = 0;
  private heap = new MinHeap(4096);
  /** Cells temporarily treated as passable (e.g. the factory a unit is leaving). */
  private ignoreOccupant = 0;
  /**
   * Fortress gates (Commander rules, sim/economy.ts): cell index -> owner team. A search for `team` treats that
   * team's gates as open (they open as its units arrive); everybody else finds them shut. Empty under Classic rules.
   */
  readonly gates = new Map<number, number>();
  private team = -1;
  /** Separate searcher for ships (water cells), created on first use so ground searches stay as they were. */
  private navalFinder: NavalPathFinder | null = null;
  /** Diagnostics. */
  expandedLastSearch = 0;

  constructor(protected map: GameMap) {
    const n = map.w * map.h;
    this.g = new Float32Array(n);
    this.from = new Int32Array(n);
    this.gen = new Uint32Array(n);
    this.closed = new Uint32Array(n);
  }

  protected ok(i: number): boolean {
    const m = this.map;
    if (m.passableIdx(i)) return true;
    if (this.team >= 0 && this.gates.size && this.gates.get(i) === this.team) return true; // own fortress gate
    return this.ignoreOccupant !== 0 && m.occupant[i] === this.ignoreOccupant && m.terrainPassable(i);
  }

  /**
   * Find a path between cell coordinates. Returns smoothed waypoints (cell centres),
   * excluding the start, ending at the goal or the closest reachable cell. Null if no progress possible.
   * `loco` 'naval' searches open water for ships instead of ground cells.
   */
  find(sx: number, sy: number, tx: number, ty: number, maxNodes = 12000, ignoreOccupant = 0, loco: Locomotor = 'ground', team = -1): PathPoint[] | null {
    if (loco === 'naval') {
      const nf = (this.navalFinder ??= new NavalPathFinder(this.map));
      const path = nf.find(sx, sy, tx, ty, maxNodes);
      this.expandedLastSearch = nf.expandedLastSearch;
      return path;
    }
    this.ignoreOccupant = ignoreOccupant;
    this.team = team;
    try {
      return this.search(sx, sy, tx, ty, maxNodes);
    } finally {
      this.ignoreOccupant = 0;
      this.team = -1;
    }
  }

  private search(sx: number, sy: number, tx: number, ty: number, maxNodes: number): PathPoint[] | null {
    const m = this.map;
    const W = m.w;
    sx = Math.max(0, Math.min(m.w - 1, sx)); sy = Math.max(0, Math.min(m.h - 1, sy));
    tx = Math.max(0, Math.min(m.w - 1, tx)); ty = Math.max(0, Math.min(m.h - 1, ty));
    const start = sy * W + sx, goal = ty * W + tx;
    if (start === goal) return [{ x: tx + 0.5, y: ty + 0.5 }];

    const gen = ++this.curGen;
    const heap = this.heap;
    heap.clear();
    const g = this.g, from = this.from, gens = this.gen, closed = this.closed;
    g[start] = 0;
    from[start] = -1;
    gens[start] = gen;
    const h0 = octile(sx, sy, tx, ty);
    heap.push(h0, start);
    let best = start, bestH = h0;
    let expanded = 0;
    let found = false;

    while (heap.size > 0) {
      const cur = heap.pop();
      if (closed[cur] === gen) continue;
      closed[cur] = gen;
      if (cur === goal) { found = true; break; }
      if (++expanded > maxNodes) break;
      const cx = cur % W, cy = (cur / W) | 0;
      const hc = octile(cx, cy, tx, ty);
      if (hc < bestH) { bestH = hc; best = cur; }
      for (let k = 0; k < 8; k++) {
        const nx = cx + DX[k], ny = cy + DY[k];
        if (nx < 0 || ny < 0 || nx >= W || ny >= m.h) continue;
        const ni = ny * W + nx;
        if (closed[ni] === gen) continue;
        if (!this.ok(ni) && ni !== goal) continue;
        if (ni === goal && !this.ok(ni)) {
          // goal is blocked: we can stand next to it, never inside
          continue;
        }
        if (k >= 4) {
          // no corner cutting
          if (!this.ok(cy * W + nx) || !this.ok(ny * W + cx)) continue;
        }
        const ng = g[cur] + COST[k];
        if (gens[ni] !== gen || ng < g[ni]) {
          gens[ni] = gen;
          g[ni] = ng;
          from[ni] = cur;
          heap.push(ng + octile(nx, ny, tx, ty) * 1.001, ni);
        }
      }
    }
    this.expandedLastSearch = expanded;
    const end = found ? goal : best;
    if (end === start) return null;

    // reconstruct
    const cells: number[] = [];
    for (let c = end; c !== -1; c = from[c]) cells.push(c);
    cells.reverse();
    return this.smooth(cells);
  }

  /** String-pull the cell path using grid line-of-sight. */
  private smooth(cells: number[]): PathPoint[] {
    const W = this.map.w;
    const out: PathPoint[] = [];
    let anchor = 0;
    let i = 1;
    while (i < cells.length) {
      // advance as far as LOS holds
      let j = i;
      while (j + 1 < cells.length && this.los(cells[anchor], cells[j + 1])) j++;
      const c = cells[j];
      out.push({ x: (c % W) + 0.5, y: ((c / W) | 0) + 0.5 });
      anchor = j;
      i = j + 1;
    }
    return out;
  }

  /** Conservative line of sight between cell centres: every cell the thick line touches must be passable. */
  los(a: number, b: number): boolean {
    const W = this.map.w;
    const ax = (a % W) + 0.5, ay = ((a / W) | 0) + 0.5;
    const bx = (b % W) + 0.5, by = ((b / W) | 0) + 0.5;
    return this.losPoints(ax, ay, bx, by, 0.35);
  }

  /** Thick-line passability test between two map points. */
  losPoints(ax: number, ay: number, bx: number, by: number, radius: number): boolean {
    const m = this.map;
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy);
    const steps = Math.ceil(len * 3) + 1;
    const nx = len > 0 ? -dy / len * radius : 0, ny = len > 0 ? dx / len * radius : 0;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const px = ax + dx * t, py = ay + dy * t;
      for (let o = -1; o <= 1; o++) {
        const qx = Math.floor(px + nx * o), qy = Math.floor(py + ny * o);
        if (qx < 0 || qy < 0 || qx >= m.w || qy >= m.h) return false;
        if (!this.ok(qy * m.w + qx)) return false;
      }
    }
    return true;
  }
}

/** Path search over open water for ships (same A* / smoothing, different passability). */
class NavalPathFinder extends PathFinder {
  protected ok(i: number): boolean {
    return this.map.navalPassableIdx(i);
  }
}

function octile(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx), dy = Math.abs(ay - by);
  return dx > dy ? dx + (SQRT2 - 1) * dy : dy + (SQRT2 - 1) * dx;
}
