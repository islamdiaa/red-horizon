/** Terrain types per cell. */
export const T = {
  Clear: 0,
  Water: 1,
  Rock: 2,
  Sand: 3,
  Dirt: 4,
} as const;

export const ORE_MAX = 9;
export const WATER_LEVEL = -0.32;

/**
 * Grid map. Cell (cx, cy) covers [cx, cx+1) x [cy, cy+1) in map space.
 * World space: X = map x, Z = map y, Y = height.
 */
export class GameMap {
  readonly w: number;
  readonly h: number;
  readonly terrain: Uint8Array;
  /** Vertex heights, (w+1) x (h+1). */
  readonly heights: Float32Array;
  /** Ore bails per cell. */
  readonly ore: Uint8Array;
  /** 1 = gems instead of gold. */
  readonly gems: Uint8Array;
  /** Cells belonging to an ore field (ore regrows here). 1 = gold field, 2 = gem field. */
  readonly oreField: Uint8Array;
  /** Indices of all ore-field cells. */
  oreFieldCells: number[] = [];
  /** Tree variant + 1, 0 = none. */
  readonly tree: Uint8Array;
  /** Building id occupying a cell (0 = none). */
  readonly occupant: Int32Array;
  /** Cells kept clear for docks / exits (not buildable, passable). */
  readonly reserved: Uint8Array;
  /** Cells inside a building footprint that units may drive over (repair pad). */
  readonly passableOverride: Uint8Array;
  startPositions: { x: number; y: number }[] = [];
  /** Incremented when ore changes so renderers can refresh. */
  oreVersion = 0;
  treeVersion = 0;
  /** Cells whose ore changed since last renderer sync. */
  oreDirty = new Set<number>();
  seed = 0;
  /** Visual climate (affects rendering only). */
  climate: 'temperate' | 'winter' | 'desert' = 'temperate';

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    const n = w * h;
    this.terrain = new Uint8Array(n);
    this.heights = new Float32Array((w + 1) * (h + 1));
    this.ore = new Uint8Array(n);
    this.gems = new Uint8Array(n);
    this.oreField = new Uint8Array(n);
    this.tree = new Uint8Array(n);
    this.occupant = new Int32Array(n);
    this.reserved = new Uint8Array(n);
    this.passableOverride = new Uint8Array(n);
  }

  idx(x: number, y: number) {
    return y * this.w + x;
  }
  inBounds(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  /** Static terrain passability for ground units (ignores buildings). */
  terrainPassable(i: number): boolean {
    const t = this.terrain[i];
    return t !== T.Water && t !== T.Rock && this.tree[i] === 0;
  }

  /** Ground passability including buildings. */
  passable(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    const i = y * this.w + x;
    if (!this.terrainPassable(i)) return false;
    return this.occupant[i] === 0 || this.passableOverride[i] === 1;
  }
  passableIdx(i: number): boolean {
    if (!this.terrainPassable(i)) return false;
    return this.occupant[i] === 0 || this.passableOverride[i] === 1;
  }

  buildable(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    const i = y * this.w + x;
    const t = this.terrain[i];
    return (t === T.Clear || t === T.Sand || t === T.Dirt) && this.tree[i] === 0 && this.occupant[i] === 0 &&
      this.reserved[i] === 0 && this.ore[i] === 0;
  }

  vertexHeight(vx: number, vy: number): number {
    vx = vx < 0 ? 0 : vx > this.w ? this.w : vx;
    vy = vy < 0 ? 0 : vy > this.h ? this.h : vy;
    return this.heights[vy * (this.w + 1) + vx];
  }

  /** Bilinear terrain height at map position. */
  heightAt(x: number, y: number): number {
    const fx = x < 0 ? 0 : x > this.w ? this.w : x;
    const fy = y < 0 ? 0 : y > this.h ? this.h : y;
    const x0 = Math.min(Math.floor(fx), this.w - 1), y0 = Math.min(Math.floor(fy), this.h - 1);
    const tx = fx - x0, ty = fy - y0;
    const W = this.w + 1;
    const a = this.heights[y0 * W + x0], b = this.heights[y0 * W + x0 + 1];
    const c = this.heights[(y0 + 1) * W + x0], d = this.heights[(y0 + 1) * W + x0 + 1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  }

  /** Ground height, never below the water surface (for things floating / drawn on water). */
  surfaceAt(x: number, y: number): number {
    return Math.max(this.heightAt(x, y), WATER_LEVEL);
  }

  setOre(i: number, amount: number) {
    if (this.ore[i] === amount) return;
    this.ore[i] = amount;
    if (amount === 0) this.gems[i] = 0;
    else if (this.oreField[i] === 2) this.gems[i] = 1;
    this.oreVersion++;
    this.oreDirty.add(i);
  }

  removeTree(i: number) {
    if (!this.tree[i]) return;
    this.tree[i] = 0;
    this.treeVersion++;
  }
}
