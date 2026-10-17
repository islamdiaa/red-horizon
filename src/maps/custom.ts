/**
 * Custom maps (made in the editor, src/editor): the same MapDef format as the curated maps,
 * validated structurally when they are imported or loaded from a save / replay, plus content hashes.
 * Custom map ids start with "custom-" so they never collide with curated ones.
 */
import type { Climate, Feature, FeatureKind, MapDef, Pt, Symmetry } from './format';
import { symmetryGroup } from './build';

export const CUSTOM_PREFIX = 'custom-';
export const MAP_SIZE_MIN = 32;
export const MAP_SIZE_MAX = 192;

export const isCustomMapId = (id: string | undefined | null): boolean => !!id && id.startsWith(CUSTOM_PREFIX);

export function newCustomId(rand: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < 8; i++) s += '0123456789abcdefghijklmnopqrstuvwxyz'[Math.floor(rand() * 36)];
  return CUSTOM_PREFIX + s;
}

const CLIMATES: Climate[] = ['temperate', 'winter', 'desert'];
export const SYMMETRIES: Symmetry[] = ['none', 'mirrorX', 'mirrorY', 'mirrorD', 'rot2', 'rot3', 'rot4', 'mirror4'];
const KINDS: FeatureKind[] = ['water', 'rock', 'clear', 'sand', 'dirt', 'ford', 'forest', 'ore', 'gems', 'deforest', 'noore', 'raise', 'lower'];
const GROUNDS = ['clear', 'water', 'dirt', 'sand'] as const;

/** Players a MapDef has: authored starts × size of its symmetry group. */
export function playerCount(def: Pick<MapDef, 'starts' | 'symmetry' | 'size' | 'center'>): number {
  return def.starts.length * symmetryGroup(def as MapDef).length;
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const pt = (v: unknown): v is Pt => Array.isArray(v) && v.length === 2 && num(v[0]) && num(v[1]);

/**
 * Check a MapDef read from a file / storage. Returns a clean copy (only known fields) or the list of
 * problems. `players` is recomputed from the starts and the symmetry.
 */
export function checkMapDef(x: unknown): { def: MapDef | null; errors: string[] } {
  const errors: string[] = [];
  const d = x as Record<string, unknown>;
  if (!d || typeof d !== 'object' || Array.isArray(d)) return { def: null, errors: ['not a map (expected a JSON object)'] };
  const size = d.size;
  if (!num(size) || !Number.isInteger(size) || size < MAP_SIZE_MIN || size > MAP_SIZE_MAX) errors.push(`size: a whole number of cells from ${MAP_SIZE_MIN} to ${MAP_SIZE_MAX}`);
  if (typeof d.name !== 'string' || !d.name.trim()) errors.push('name: required');
  if (!CLIMATES.includes(d.climate as Climate)) errors.push(`climate: one of ${CLIMATES.join(', ')}`);
  if (!SYMMETRIES.includes(d.symmetry as Symmetry)) errors.push(`symmetry: one of ${SYMMETRIES.join(', ')}`);
  if (d.ground !== undefined && !GROUNDS.includes(d.ground as typeof GROUNDS[number])) errors.push(`ground: one of ${GROUNDS.join(', ')}`);
  if (!num(d.seed)) errors.push('seed: a number');
  if (!Array.isArray(d.starts) || !d.starts.every(pt)) errors.push('starts: a list of [x, y] points');
  if (!Array.isArray(d.features)) errors.push('features: a list');
  if (d.bridges !== undefined && (!Array.isArray(d.bridges) || !d.bridges.every((b) => b && pt((b as Record<string, unknown>).at) && ((b as Record<string, unknown>).axis === 'x' || (b as Record<string, unknown>).axis === 'y')))) errors.push('bridges: a list of { at: [x, y], axis: "x" | "y" }');
  if (d.center !== undefined && !pt(d.center)) errors.push('center: an [x, y] point');
  if (errors.length) return { def: null, errors };
  const N = size as number;
  const features: Feature[] = [];
  (d.features as unknown[]).forEach((f, i) => {
    const r = checkFeature(f, N);
    if (typeof r === 'string') errors.push(`features[${i}]: ${r}`); else features.push(r);
  });
  if ((d.features as unknown[]).length > 6000) errors.push('features: at most 6000');
  const starts = (d.starts as Pt[]).map(([x, y]) => [x, y] as Pt);
  for (const [x, y] of starts) if (x < 0 || y < 0 || x >= N || y >= N) errors.push(`starts: (${x}, ${y}) is outside the map`);
  const def: MapDef = {
    id: typeof d.id === 'string' && d.id ? d.id : 'custom-map',
    name: String(d.name).slice(0, 48),
    desc: typeof d.desc === 'string' ? d.desc.slice(0, 400) : '',
    size: N,
    players: 0,
    climate: d.climate as Climate,
    symmetry: d.symmetry as Symmetry,
    starts,
    features,
    seed: Math.trunc(d.seed as number) | 0,
  };
  if (d.center !== undefined) def.center = [...(d.center as Pt)] as Pt;
  if (d.ground !== undefined) def.ground = d.ground as MapDef['ground'];
  if (Array.isArray(d.bridges)) def.bridges = (d.bridges as { at: Pt; axis: 'x' | 'y' }[]).map((b) => ({ at: [b.at[0], b.at[1]] as Pt, axis: b.axis }));
  if (num(d.clearRadius)) def.clearRadius = Math.max(4, Math.min(16, d.clearRadius));
  if (typeof d.naval === 'boolean') def.naval = d.naval;
  if (Array.isArray(d.tags)) def.tags = d.tags.filter((t): t is string => typeof t === 'string').slice(0, 6).map((t) => t.slice(0, 20));
  if (num(d.relief)) def.relief = Math.max(0, Math.min(3, d.relief));
  if (typeof d.author === 'string') def.author = d.author.slice(0, 40);
  if (num(d.format)) def.format = d.format;
  def.players = playerCount(def);
  if (def.players > 8) errors.push(`${def.players} start positions: at most 8`);
  return errors.length ? { def: null, errors } : { def, errors };
}

function checkFeature(f: unknown, N: number): Feature | string {
  const o = f as Record<string, unknown>;
  if (!o || typeof o !== 'object') return 'not an object';
  if (!KINDS.includes(o.t as FeatureKind)) return `t: one of ${KINDS.join(', ')}`;
  const far = (v: number) => Math.abs(v) > N * 4;
  let shape: Record<string, unknown>;
  if (o.circle !== undefined) {
    if (!pt(o.circle) || !num(o.r) || o.r <= 0 || o.r > N) return 'circle: [x, y] and a radius r > 0';
    shape = { circle: [o.circle[0], o.circle[1]], r: o.r };
  } else if (o.ellipse !== undefined) {
    if (!pt(o.ellipse) || !num(o.rx) || !num(o.ry) || o.rx <= 0 || o.ry <= 0) return 'ellipse: [x, y], rx, ry';
    shape = { ellipse: [o.ellipse[0], o.ellipse[1]], rx: o.rx, ry: o.ry };
    if (num(o.angle)) shape.angle = o.angle;
  } else if (o.path !== undefined) {
    if (!Array.isArray(o.path) || !o.path.length || o.path.length > 4000 || !o.path.every(pt) || !num(o.w) || o.w <= 0 || o.w > N) return 'path: a list of [x, y] points and a width w > 0';
    shape = { path: (o.path as Pt[]).map(([x, y]) => [x, y]), w: o.w };
  } else if (o.rect !== undefined) {
    const r = o.rect as unknown[];
    if (!Array.isArray(r) || r.length !== 4 || !r.every(num)) return 'rect: [x0, y0, x1, y1]';
    shape = { rect: [...r] };
  } else if (o.poly !== undefined) {
    if (!Array.isArray(o.poly) || o.poly.length < 3 || o.poly.length > 4000 || !o.poly.every(pt)) return 'poly: at least 3 [x, y] points';
    shape = { poly: (o.poly as Pt[]).map(([x, y]) => [x, y]) };
  } else return 'a shape: circle, ellipse, path, rect or poly';
  const coords = JSON.stringify(shape).match(/-?\d+(\.\d+)?(e-?\d+)?/g)?.map(Number) ?? [];
  if (coords.some(far)) return 'coordinates far outside the map';
  const out = { t: o.t, ...shape } as Feature;
  const opt = (k: 'wobble' | 'freq' | 'density' | 'rich' | 'amount', lo: number, hi: number) => {
    if (o[k] === undefined) return;
    if (num(o[k])) (out as Record<string, unknown>)[k] = Math.max(lo, Math.min(hi, o[k] as number));
  };
  opt('wobble', 0, 8); opt('freq', 0.01, 2); opt('density', 0, 1); opt('rich', 0.1, 3); opt('amount', 0, 4);
  if (o.once === true) out.once = true;
  return out;
}

/** Same hash scheme as mods (src/mods/format.ts): canonical JSON, 64-bit FNV. */
export function mapContentHash(def: MapDef): string {
  const canon = (v: unknown): string => {
    if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    const o = v as Record<string, unknown>;
    return '{' + Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + canon(o[k])).join(',') + '}';
  };
  const s = canon(def);
  let a = 0x811c9dc5, b = 0x9747b28c;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ (c + 0x9e3779b9), 0x01000193) ^ (b >>> 13);
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

// ---- registry: the editor's saved maps, so the skirmish map picker and getMapDef() see them ----------
let registry: MapDef[] = [];

/** Replace the list of custom maps offered in skirmish (src/editor/store.ts keeps it current). */
export function setCustomMaps(defs: MapDef[]) {
  registry = defs.slice();
}

/** Custom maps playable in skirmish (2+ starts), newest first. */
export function customMaps(): readonly MapDef[] {
  return registry;
}

export function getCustomMap(id: string): MapDef | undefined {
  return registry.find((m) => m.id === id);
}
