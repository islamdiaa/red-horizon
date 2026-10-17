/**
 * The battlefield's memory (pure logic, no WebGL; tests): craters, burnt ground and burnt trees that accumulate
 * over a match within a budget, and a compact snapshot of them for save games.
 *
 *  - Craters: a blast close to a live crater merges into it (deepens it up to a cap, refreshes it) instead of
 *    adding another; over the live budget the least recently hit crater is evicted (the renderer heals its relief
 *    back over a few seconds but keeps the ground burnt).
 *  - Burn: a coarse per-cell record of how scorched the ground is (the terrain keeps the fine burn map; this is
 *    what a save game needs to paint it again).
 *  - Trees: where a tree burnt down (a charred stump, maybe its fallen trunk); the oldest go first over budget.
 *  - Ruins: the rubble piles of destroyed structures go into the snapshot too (footprint + seed: rubble.ts lays
 *    the same pile again).
 *
 * The snapshot is plain JSON (numbers only); `restore` validates everything it reads (save files can be
 * imported), clamps to the map and caps every list.
 */

export interface ScarCrater {
  x: number;
  y: number;
  r: number;
  /** Total depth pressed here so far. */
  d: number;
  /** Last time it was hit (LRU). */
  used: number;
}

export interface BurntTree {
  x: number;
  y: number;
  /** Ground height at the stump. */
  z: number;
  /** Tree scale. */
  s: number;
  yaw: number;
  /** Fallen trunk direction (radians), or NaN for a stump only. */
  fall: number;
}

export interface RuinPile { cx: number; cy: number; w: number; h: number; seed: number }

/** Budgets per quality preset. */
export const SCAR_BUDGET: Record<'low' | 'medium' | 'high', { craters: number; trees: number }> = {
  low: { craters: 48, trees: 160 },
  medium: { craters: 72, trees: 320 },
  high: { craters: 96, trees: 480 },
};

/** Deepest a merged crater record gets (world units; the terrain caps the relief itself). */
export const CRATER_MAX_DEPTH = 0.45;
const MAX_RUINS = 256;
export const SCAR_SNAPSHOT_VERSION = 1;

export interface ScarSnapshot {
  v: number;
  w: number;
  h: number;
  /** [x, y, r, d] */
  craters: number[][];
  /** [x, y, z, s, yaw, fall | -9] */
  trees: number[][];
  /** Run-length encoded burn grid: [value, count, value, count, ...] over w * h cells. */
  burn: number[];
  /** [x, z, size, intensity] lasting scorch decals */
  marks: number[][];
  /** [cx, cy, w, h, seed] */
  ruins: number[][];
}

export interface CraterResult {
  /** The crater it merged into (already updated), or null. */
  merged: ScarCrater | null;
  /** The crater added, or null. */
  added: ScarCrater | null;
  /** Craters pushed out of the budget (heal them). */
  evicted: ScarCrater[];
}

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export class ScarLedger {
  readonly craters: ScarCrater[] = [];
  readonly trees: BurntTree[] = [];
  /** Per-cell burn, 0..255. */
  readonly burn: Uint8Array;
  private evictedBuf: ScarCrater[] = [];

  constructor(readonly w: number, readonly h: number, readonly maxCraters = 96, readonly maxTrees = 480) {
    this.burn = new Uint8Array(Math.max(1, w * h));
  }

  /**
   * Record a crater pressed at (x, y). Close to a live crater (within 60 % of the larger radius) it merges:
   * depth accumulates (capped), radius grows a little, the crater counts as freshly hit. Returns what changed.
   */
  addCrater(x: number, y: number, r: number, d: number, now: number): CraterResult {
    const ev = this.evictedBuf;
    ev.length = 0;
    const res: CraterResult = { merged: null, added: null, evicted: ev };
    if (!fin(x) || !fin(y) || !(r > 0) || !(d > 0)) return res;
    let best: ScarCrater | null = null, bd = Infinity;
    for (const c of this.craters) {
      const dd = Math.hypot(c.x - x, c.y - y);
      if (dd < Math.max(c.r, r) * 0.6 && dd < bd) { bd = dd; best = c; }
    }
    if (best) {
      best.d = Math.min(CRATER_MAX_DEPTH, best.d + d);
      best.r = Math.min(Math.max(best.r, r) * 1.04, Math.max(best.r, r) + 0.3);
      best.used = now;
      res.merged = best;
      return res;
    }
    const c: ScarCrater = { x, y, r, d: Math.min(CRATER_MAX_DEPTH, d), used: now };
    this.craters.push(c);
    res.added = c;
    while (this.craters.length > this.maxCraters) {
      let k = 0;
      for (let i = 1; i < this.craters.length; i++) if (this.craters[i].used < this.craters[k].used) k = i;
      ev.push(this.craters[k]);
      this.craters.splice(k, 1);
    }
    return res;
  }

  /** Depth already pressed near (x, y) (the stacking cap). */
  depthNear(x: number, y: number): number {
    let s = 0;
    for (const c of this.craters) if (Math.hypot(c.x - x, c.y - y) < c.r * 0.6) s = Math.max(s, c.d);
    return s;
  }

  /** Record scorched ground: amount 0..1 within radius r of (x, y) (max per cell). */
  burnAt(x: number, y: number, r: number, amount: number): void {
    if (!fin(x) || !fin(y) || !(r > 0) || !(amount > 0)) return;
    const v = Math.min(255, Math.round(amount * 255));
    const x0 = Math.max(0, Math.floor(x - r)), x1 = Math.min(this.w - 1, Math.floor(x + r));
    const y0 = Math.max(0, Math.floor(y - r)), y1 = Math.min(this.h - 1, Math.floor(y + r));
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const d = Math.hypot(cx + 0.5 - x, cy + 0.5 - y);
        if (d > r + 0.35) continue;
        const k = cy * this.w + cx;
        const w = d <= r * 0.5 ? 1 : Math.max(0, 1 - (d - r * 0.5) / (r * 0.5 + 0.35));
        this.burn[k] = Math.max(this.burn[k], Math.round(v * w));
      }
    }
  }

  /** A tree burnt down. Over budget the oldest stump goes (returned, so the renderer can drop it). */
  addTree(t: BurntTree): BurntTree | null {
    if (!fin(t.x) || !fin(t.y) || !fin(t.z)) return null;
    this.trees.push(t);
    return this.trees.length > this.maxTrees ? this.trees.shift()! : null;
  }

  /** Compact JSON snapshot (save games). `marks` = the lasting scorch decals, `ruins` = rubble piles. */
  snapshot(marks: number[][] = [], ruins: readonly RuinPile[] = []): ScarSnapshot {
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const burn: number[] = [];
    let cur = this.burn[0], n = 0;
    for (let i = 0; i < this.burn.length; i++) {
      if (this.burn[i] === cur && n < 65535) n++;
      else { burn.push(cur, n); cur = this.burn[i]; n = 1; }
    }
    burn.push(cur, n);
    return {
      v: SCAR_SNAPSHOT_VERSION, w: this.w, h: this.h,
      craters: this.craters.map((c) => [r2(c.x), r2(c.y), r2(c.r), Math.round(c.d * 1000) / 1000]),
      trees: this.trees.map((t) => [r2(t.x), r2(t.y), r2(t.z), r2(t.s), r2(t.yaw), Number.isNaN(t.fall) ? -9 : r2(t.fall)]),
      burn,
      marks,
      ruins: ruins.slice(-MAX_RUINS).map((p) => [p.cx, p.cy, p.w, p.h, p.seed]),
    };
  }

  /**
   * Rebuild a ledger from untrusted JSON (null when it is not a snapshot of this map size). Out-of-range or
   * malformed entries are dropped; lists are capped to the budgets. `marks` are returned validated.
   */
  static restore(json: unknown, w: number, h: number, maxCraters = 96, maxTrees = 480, maxMarks = 256): { ledger: ScarLedger; marks: number[][]; ruins: RuinPile[] } | null {
    if (!json || typeof json !== 'object') return null;
    const s = json as Partial<ScarSnapshot>;
    if (s.v !== SCAR_SNAPSHOT_VERSION || s.w !== w || s.h !== h) return null;
    const L = new ScarLedger(w, h, maxCraters, maxTrees);
    const inMap = (x: unknown, y: unknown) => fin(x) && fin(y) && x >= 0 && y >= 0 && x <= w && y <= h;
    const rows = (v: unknown, n: number, cap: number): number[][] => {
      if (!Array.isArray(v)) return [];
      const out: number[][] = [];
      for (const r of v) {
        if (out.length >= cap) break;
        if (Array.isArray(r) && r.length === n && r.every(fin)) out.push(r as number[]);
      }
      return out;
    };
    for (const [x, y, r, d] of rows(s.craters, 4, maxCraters)) {
      if (!inMap(x, y) || !(r > 0 && r <= 12) || !(d > 0)) continue;
      L.craters.push({ x, y, r, d: Math.min(CRATER_MAX_DEPTH, d), used: 0 });
    }
    for (const [x, y, z, sc, yaw, fall] of rows(s.trees, 6, maxTrees)) {
      if (!inMap(x, y) || Math.abs(z) > 50 || !(sc > 0 && sc < 5)) continue;
      L.trees.push({ x, y, z, s: sc, yaw, fall: fall === -9 ? NaN : fall });
    }
    const ruins: RuinPile[] = [];
    for (const [cx, cy, pw, ph, seed] of rows(s.ruins, 5, MAX_RUINS)) {
      if (!inMap(cx, cy) || !(pw >= 1 && pw <= 8) || !(ph >= 1 && ph <= 8) || !Number.isInteger(cx + cy + pw + ph)) continue;
      ruins.push({ cx, cy, w: pw, h: ph, seed: Math.trunc(seed) });
    }
    // burn: run-length pairs that add up to the map exactly
    if (Array.isArray(s.burn) && s.burn.length % 2 === 0 && s.burn.length <= 2 * w * h) {
      let k = 0, ok = true;
      for (let i = 0; i < s.burn.length && ok; i += 2) {
        const v = s.burn[i], n = s.burn[i + 1];
        if (!fin(v) || !fin(n) || v < 0 || v > 255 || n < 1 || !Number.isInteger(n) || k + n > w * h) { ok = false; break; }
        if (v > 0) L.burn.fill(Math.round(v), k, k + n);
        k += n;
      }
      if (!ok || k !== w * h) L.burn.fill(0);
    }
    const marks = rows(s.marks, 4, maxMarks).filter(([x, z, sz, a]) => inMap(x, z) && sz > 0 && sz <= 16 && a > 0 && a <= 1);
    return { ledger: L, marks, ruins };
  }
}
