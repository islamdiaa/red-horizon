/**
 * Editor document model (no DOM): a custom map (MapDef, src/maps/format.ts) plus an optional mission,
 * with brush strokes turned into map features, start / bridge editing, symmetry helpers and undo / redo.
 *
 * Every edit appends to or changes the MapDef; the GameMap is rebuilt from it with the same builder
 * the curated maps use (buildMap), so whatever the editor shows is exactly what a match, a save or a
 * replay rebuilds. Symmetric maps store the authored copy only: the builder replicates every stroke
 * through the symmetry group (a stroke with `once` stays a single, asymmetric copy).
 */
import { buildMap, symmetryGroup, traceBridge } from '../maps/build';
import type { BridgeDef, Climate, Feature, FeatureKind, MapDef, Pt, Symmetry } from '../maps/format';
import { newCustomId, playerCount } from '../maps/custom';
import { T, type GameMap } from '../sim/map';
import type { MissionSpec } from './mission';
import tEd from '../i18n/en/editor'; // the default map name

export interface EditorDoc {
  id: string;
  map: MapDef;
  mission: MissionSpec | null;
  createdAt: number;
  updatedAt: number;
}

export type BrushKind = FeatureKind;

export interface BrushParams {
  /** Radius in cells. */
  radius: number;
  /** Edge roughness 0..1 (noise wobble). */
  rough: number;
  /** forest */
  density: number;
  /** ore / gems */
  rich: number;
  /** raise / lower */
  amount: number;
  /** Paint a single copy only (ignore the map's symmetry). */
  once: boolean;
}

export const DEFAULT_BRUSH: BrushParams = { radius: 3, rough: 0.5, density: 0.7, rich: 1, amount: 0.6, once: false };

/** Symmetry options for the editor: players per authored start (names: src/i18n/en/editor.ts sym.*). */
export const SYMMETRY_INFO: Record<Symmetry, { group: number }> = {
  none: { group: 1 },
  mirrorX: { group: 2 },
  mirrorY: { group: 2 },
  mirrorD: { group: 2 },
  rot2: { group: 2 },
  rot3: { group: 3 },
  rot4: { group: 4 },
  mirror4: { group: 4 },
};

export const MAX_PLAYERS = 4;

/** Authored starts a symmetry allows (players = authored × group, at most 4). */
export const maxAuthoredStarts = (sym: Symmetry) => Math.max(1, Math.floor(MAX_PLAYERS / SYMMETRY_INFO[sym].group));

const r1 = (v: number) => Math.round(v * 10) / 10;
const cellCentre = (v: number) => Math.floor(v) + 0.5;

export interface NewMapOptions {
  name?: string;
  size?: number;
  climate?: Climate;
  symmetry?: Symmetry;
  ground?: MapDef['ground'];
  seed?: number;
  /** Lay out starter ore fields (default true). */
  starter?: boolean;
}

/** Default authored start(s) for a symmetry on an N×N map. */
export function defaultStarts(sym: Symmetry, N: number): Pt[] {
  const m = Math.max(10.5, Math.round(N * 0.13) + 0.5);
  switch (sym) {
    case 'none': return [[m, N - m], [N - m, m]];
    case 'mirrorX': return [[m, Math.floor(N / 2) + 0.5]];
    case 'mirrorY': return [[Math.floor(N / 2) + 0.5, N - m]];
    case 'rot3': return [[Math.floor(N / 2) + 0.5, N - m]];
    default: return [[m, N - m]];
  }
}

/** A fresh map: flat ground, starts for the symmetry and a few ore fields around every base. */
export function newMapDef(o: NewMapOptions = {}): MapDef {
  const N = o.size ?? 96;
  const sym = o.symmetry ?? 'rot2';
  const def: MapDef = {
    id: newCustomId(),
    name: o.name ?? tEd('untitled'),
    desc: '',
    size: N,
    players: 0,
    climate: o.climate ?? 'temperate',
    symmetry: sym,
    starts: defaultStarts(sym, N),
    features: [],
    seed: o.seed ?? Math.floor(Math.random() * 1e6),
    format: 1,
  };
  if (o.ground && o.ground !== 'clear') def.ground = o.ground;
  if (def.ground === 'water') {
    // island maps: every base gets an island
    for (const s of def.starts) def.features.push({ t: 'clear', circle: [s[0], s[1]], r: Math.min(18, N * 0.17), wobble: 2 });
  }
  if (o.starter !== false) {
    const c = N / 2;
    for (const s of def.starts) {
      const dx = c - s[0], dy = c - s[1], l = Math.hypot(dx, dy) || 1;
      const ux = dx / l, uy = dy / l;
      const at = (d: number, side: number): Pt => [r1(s[0] + ux * d - uy * side), r1(s[1] + uy * d + ux * side)];
      // crisp edges on free layouts: the same shape at every base keeps the ore fair without a symmetry
      const w = sym === 'none' ? { wobble: 0 } : {};
      def.features.push({ t: 'ore', circle: at(11, 6), r: 3.7, ...w }, { t: 'ore', circle: at(11, -6), r: 3.7, ...w }, { t: 'ore', circle: at(19, 0), r: 4, ...w });
    }
    if (sym !== 'none') def.features.push({ t: 'gems', circle: [r1(c), r1(c)], r: 2.4 });
  }
  def.players = playerCount(def);
  return def;
}

export function newDoc(map: MapDef, mission: MissionSpec | null = null, now = Date.now()): EditorDoc {
  return { id: map.id, map, mission, createdAt: now, updatedAt: now };
}

// =====================================================================================================
// Strokes
// =====================================================================================================
/** Edge noise for a brush of radius r at roughness 0..1. */
export const wobbleFor = (r: number, rough: number) => r1(rough * Math.min(1.6, 0.2 + r * 0.32));

/** Turn a painted stroke (map points) into a feature: a circle for a dab, a thick path for a drag. */
export function strokeFeature(kind: BrushKind, points: Pt[], p: BrushParams): Feature {
  const pts = simplify(points, Math.max(0.35, p.radius * 0.35));
  const shape = pts.length <= 1 ? { circle: [r1(pts[0][0]), r1(pts[0][1])] as Pt, r: r1(p.radius) } : { path: pts.map(([x, y]) => [r1(x), r1(y)] as Pt), w: r1(p.radius * 2) };
  const f = { t: kind, ...shape } as Feature;
  if (kind !== 'raise' && kind !== 'lower') {
    const w = wobbleFor(p.radius, p.rough);
    if (w !== 1.2) f.wobble = w;
  }
  if (kind === 'forest') f.density = Math.round(p.density * 100) / 100;
  if ((kind === 'ore' || kind === 'gems') && p.rich !== 1) f.rich = Math.round(p.rich * 100) / 100;
  if (kind === 'raise' || kind === 'lower') f.amount = Math.round(p.amount * 100) / 100;
  if (p.once) f.once = true;
  return f;
}

/** Drop points closer than `step` to the previous kept one (always keeps the last). */
export function simplify(points: Pt[], step: number): Pt[] {
  if (points.length <= 1) return points.slice();
  const out: Pt[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const [lx, ly] = out[out.length - 1];
    if (Math.hypot(points[i][0] - lx, points[i][1] - ly) >= step) out.push(points[i]);
  }
  const last = points[points.length - 1], kept = out[out.length - 1];
  if (kept !== last && Math.hypot(last[0] - kept[0], last[1] - kept[1]) > 0.05) out.push(last);
  // a drag that never left the brush is a dab
  if (out.length === 2 && Math.hypot(out[1][0] - out[0][0], out[1][1] - out[0][1]) < step * 0.5) return [out[0]];
  return out;
}

// =====================================================================================================
// Starts
// =====================================================================================================
export interface StartRef {
  /** Index into the built map's startPositions (player number - 1). */
  index: number;
  /** Authored start it comes from, and the symmetry element (index into symmetryGroup). */
  authored: number;
  g: number;
  x: number;
  y: number;
}

/** Every start position with the authored start and symmetry copy that produced it (builder order). */
export function startRefs(def: MapDef): StartRef[] {
  const G = symmetryGroup(def);
  const out: StartRef[] = [];
  def.starts.forEach((s, a) => G.forEach((g, gi) => {
    const [x, y] = g.f(s[0], s[1]);
    out.push({ index: out.length, authored: a, g: gi, x: cellCentre(x), y: cellCentre(y) });
  }));
  return out;
}

export function nearestStart(def: MapDef, x: number, y: number, within = 4): StartRef | null {
  let best: StartRef | null = null, bd = within;
  for (const r of startRefs(def)) {
    const d = Math.hypot(r.x - x, r.y - y);
    if (d < bd) { bd = d; best = r; }
  }
  return best;
}

/** Move the start `ref` (any symmetric copy) to (x, y): its authored source moves accordingly. */
export function moveStart(def: MapDef, ref: StartRef, x: number, y: number) {
  const G = symmetryGroup(def);
  const N = def.size;
  const [ax, ay] = G[ref.g].inv(Math.max(0.5, Math.min(N - 0.5, x)), Math.max(0.5, Math.min(N - 0.5, y)));
  def.starts[ref.authored] = [cellCentre(Math.max(0, Math.min(N - 1, ax))), cellCentre(Math.max(0, Math.min(N - 1, ay)))];
  def.players = playerCount(def);
}

/** Add an authored start at (x, y) if the symmetry has room for one more. */
export function addStart(def: MapDef, x: number, y: number): boolean {
  if (def.starts.length >= maxAuthoredStarts(def.symmetry)) return false;
  def.starts.push([cellCentre(x), cellCentre(y)]);
  def.players = playerCount(def);
  return true;
}

export function removeStart(def: MapDef, ref: StartRef): boolean {
  if (def.starts.length <= 1) return false;
  def.starts.splice(ref.authored, 1);
  def.players = playerCount(def);
  return true;
}

/**
 * Switch the symmetry. Going to "none" keeps every current start (now all authored); going to a
 * symmetric mode keeps as many authored starts as fit (the builder then mirrors / rotates them).
 */
export function setSymmetry(def: MapDef, sym: Symmetry) {
  if (sym === def.symmetry) return;
  if (sym === 'none') {
    def.starts = startRefs(def).slice(0, MAX_PLAYERS).map((r) => [r.x, r.y] as Pt);
  } else {
    const keep = def.starts.slice(0, maxAuthoredStarts(sym));
    def.starts = keep.length ? keep : defaultStarts(sym, def.size);
  }
  def.symmetry = sym;
  if (sym !== 'rot3') delete def.center;
  def.players = playerCount(def);
}

// =====================================================================================================
// Bridges
// =====================================================================================================
/** The bridge a click on water at (x, y) would build: the shorter valid span (or the forced axis). */
export function bridgeAt(map: GameMap, x: number, y: number, axis?: 'x' | 'y'): BridgeDef | null {
  const cx = Math.floor(x), cy = Math.floor(y);
  if (!map.inBounds(cx, cy) || map.terrain[map.idx(cx, cy)] !== T.Water) return null;
  const opts = (axis ? [axis] : ['x', 'y'] as const).map((a) => ({ a, br: traceBridge(map, cx, cy, a) })).filter((o) => o.br && o.br.cells.length <= 14);
  if (!opts.length) return null;
  opts.sort((p, q) => p.br!.cells.length - q.br!.cells.length);
  return { at: [cx + 0.5, cy + 0.5], axis: opts[0].a };
}

/** Index of the bridge definition whose built bridge (any symmetric copy) covers cell (x, y), or -1. */
export function bridgeDefAt(def: MapDef, map: GameMap, x: number, y: number): number {
  const G = symmetryGroup(def);
  const cx = Math.floor(x), cy = Math.floor(y);
  const list = def.bridges ?? [];
  for (let k = 0; k < list.length; k++) {
    const b = list[k];
    for (const g of G) {
      const [fx, fy] = g.f(Math.floor(b.at[0]) + 0.5, Math.floor(b.at[1]) + 0.5);
      const ax = g.swap ? (b.axis === 'x' ? 'y' : 'x') : b.axis;
      const br = traceBridge(map, Math.floor(fx), Math.floor(fy), ax);
      if (br?.cells.some(([bx, by]) => Math.abs(bx - cx) <= 1 && Math.abs(by - cy) <= 1)) return k;
    }
  }
  return -1;
}

// =====================================================================================================
// Resize
// =====================================================================================================
/** Change the map size; `scale` stretches every feature, start and bridge with it (else the content keeps its cells). */
export function resizeMap(def: MapDef, size: number, scale: boolean) {
  const k = scale ? size / def.size : 1;
  const p = ([x, y]: Pt): Pt => [r1(x * k), r1(y * k)];
  if (scale) {
    def.features = def.features.map((f) => {
      const o = { ...f } as Feature & Record<string, unknown>;
      if ('circle' in o) { o.circle = p(o.circle as Pt); o.r = r1((o.r as number) * k); }
      if ('ellipse' in o) { o.ellipse = p(o.ellipse as Pt); o.rx = r1((o.rx as number) * k); o.ry = r1((o.ry as number) * k); }
      if ('path' in o) { o.path = (o.path as Pt[]).map(p); o.w = r1((o.w as number) * k); }
      if ('rect' in o) o.rect = (o.rect as number[]).map((v) => r1(v * k)) as [number, number, number, number];
      if ('poly' in o) o.poly = (o.poly as Pt[]).map(p);
      return o as Feature;
    });
    def.starts = def.starts.map((s) => { const [x, y] = p(s); return [cellCentre(x), cellCentre(y)] as Pt; });
    if (def.bridges) def.bridges = def.bridges.map((b) => ({ ...b, at: p(b.at) }));
    if (def.center) def.center = p(def.center);
  } else {
    const inside = ([x, y]: Pt) => x < size && y < size;
    def.starts = def.starts.map(([x, y]) => [cellCentre(Math.min(size - 9, x)), cellCentre(Math.min(size - 9, y))] as Pt);
    if (def.bridges) def.bridges = def.bridges.filter((b) => inside(b.at));
  }
  def.size = size;
  def.players = playerCount(def);
}

/** Move a mission's placements / areas with a resize (same mapping as resizeMap). */
export function resizeMission(m: MissionSpec, from: number, to: number, scale: boolean) {
  const k = scale ? to / from : 1;
  const f = (v: number | undefined) => (v === undefined ? v : Math.min(to - 1, r1(v * k)));
  for (const pl of m.placements) { pl.x = pl.kind === 'structure' ? Math.round(f(pl.x)!) : f(pl.x)!; pl.y = pl.kind === 'structure' ? Math.round(f(pl.y)!) : f(pl.y)!; }
  for (const o of m.objectives) { o.x = f(o.x); o.y = f(o.y); }
  for (const t of m.triggers) {
    t.x = f(t.x); t.y = f(t.y);
    for (const a of t.actions) { a.x = f(a.x); a.y = f(a.y); a.tx = f(a.tx); a.ty = f(a.ty); }
  }
  m.placements = m.placements.filter((p) => p.x >= 0 && p.y >= 0 && p.x < to && p.y < to);
}

// =====================================================================================================
// Model with undo / redo and a cached GameMap
// =====================================================================================================
interface Snap { map: MapDef; mission: MissionSpec | null }

export class EditorModel {
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private built: { version: number; map: GameMap } | null = null;
  /** Increments on every change (views redraw / rebuild when it moves). */
  version = 0;
  /** Unsaved changes since the last save / load. */
  dirty = false;
  /** Max undo steps kept. */
  limit = 200;
  onChange: (() => void) | null = null;

  constructor(public doc: EditorDoc) {}

  private snap(): string {
    return JSON.stringify({ map: this.doc.map, mission: this.doc.mission } satisfies Snap);
  }

  private group = 0;
  private groupPushed = false;

  /** Merge the edits until endGroup() into one undo step (drags). */
  beginGroup() {
    this.group++;
    this.groupPushed = false;
  }
  endGroup() {
    this.group = Math.max(0, this.group - 1);
    if (!this.group) this.groupPushed = false;
  }

  /** Apply an edit as one undo step. Returns false (and records nothing) when `fn` returns false. */
  edit(fn: (doc: EditorDoc) => boolean | void): boolean {
    const before = this.snap();
    if (fn(this.doc) === false) return false;
    if (this.snap() === before) return false;
    if (!this.group || !this.groupPushed) {
      this.undoStack.push(before);
      if (this.undoStack.length > this.limit) this.undoStack.shift();
      this.groupPushed = !!this.group;
    }
    this.redoStack.length = 0;
    this.touch();
    return true;
  }

  private touch() {
    this.doc.map.players = playerCount(this.doc.map);
    this.doc.updatedAt = Date.now();
    this.version++;
    this.dirty = true;
    this.onChange?.();
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  private restore(s: string) {
    const v = JSON.parse(s) as Snap;
    this.doc.map = v.map;
    this.doc.mission = v.mission;
    this.touch();
  }

  undo(): boolean {
    const s = this.undoStack.pop();
    if (!s) return false;
    this.redoStack.push(this.snap());
    this.restore(s);
    return true;
  }

  redo(): boolean {
    const s = this.redoStack.pop();
    if (!s) return false;
    this.undoStack.push(this.snap());
    this.restore(s);
    return true;
  }

  /** Replace the whole document (open / new / import): clears the history. */
  load(doc: EditorDoc) {
    this.doc = doc;
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.built = null;
    this.version++;
    this.dirty = false;
    this.onChange?.();
  }

  /** The GameMap built from the current MapDef (cached per version; treat as read-only). */
  map(): GameMap {
    if (!this.built || this.built.version !== this.version) this.built = { version: this.version, map: buildMap(this.doc.map) };
    return this.built.map;
  }

  /** Build with an extra (in-progress) feature, without recording anything. */
  preview(extra: Feature): GameMap {
    return buildMap({ ...this.doc.map, features: [...this.doc.map.features, extra] });
  }
}
