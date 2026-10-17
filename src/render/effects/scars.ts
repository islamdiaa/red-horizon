/**
 * Persistent scorch marks: the blast marks of shells, wrecks and fallen structures stay on the ground for the
 * whole match, within a budget per quality preset.
 *
 *  - LruSlots (pure; tests): a fixed set of slots, each live one stamped with when it was last touched. When the
 *    live count passes `cap - reserve`, the least recently touched marks are retired: they fade out over a few
 *    seconds and their slots come free afterwards (never a visible pop). A new mark landing on a live one of
 *    about its size merges into it instead (darker, touched again) rather than taking another slot.
 *  - ScarDecals: one decal draw call (DecalSystem) driven by LruSlots. A retired mark is baked into the
 *    terrain's persistent burn map first (onBake), so the ground there stays darker for good.
 */
import { DecalSystem } from './decals';

/** Live slot states. */
const FREE = 0, LIVE = 1, FADING = 2;

export class LruSlots {
  readonly state: Uint8Array;
  /** Last touch (live) or end of the fade (fading), seconds. */
  readonly time: Float64Array;
  private live = 0;

  constructor(readonly cap: number, readonly reserve: number) {
    this.state = new Uint8Array(cap);
    this.time = new Float64Array(cap);
  }

  /** Live slots right now (fading ones excluded). */
  get liveCount(): number {
    return this.live;
  }

  /**
   * Take a slot at time `now`. `retired` receives the slots that must start fading now (least recently
   * touched first) to keep the live count within cap - reserve. Returns the slot, or -1 when every slot is
   * live or still fading (the caller may skip the mark).
   */
  alloc(now: number, fade: number, retired: number[]): number {
    retired.length = 0;
    const st = this.state, tm = this.time;
    // fades that have finished free their slots
    for (let i = 0; i < this.cap; i++) if (st[i] === FADING && tm[i] <= now) st[i] = FREE;
    // over budget: retire the least recently touched
    const limit = Math.max(1, this.cap - this.reserve);
    while (this.live >= limit) {
      let lru = -1, lt = Infinity;
      for (let i = 0; i < this.cap; i++) if (st[i] === LIVE && tm[i] < lt) { lt = tm[i]; lru = i; }
      if (lru < 0) break;
      st[lru] = FADING;
      tm[lru] = now + fade;
      this.live--;
      retired.push(lru);
    }
    let slot = -1;
    for (let i = 0; i < this.cap; i++) if (st[i] === FREE) { slot = i; break; }
    if (slot < 0) return -1;
    st[slot] = LIVE;
    tm[slot] = now;
    this.live++;
    return slot;
  }

  /** Mark a live slot as used now (it moves to the back of the eviction queue). */
  touch(slot: number, now: number): void {
    if (this.state[slot] === LIVE) this.time[slot] = now;
  }

  isLive(slot: number): boolean {
    return this.state[slot] === LIVE;
  }

  clear(): void {
    this.state.fill(FREE);
    this.live = 0;
  }
}

/** What scorch recipes call (ctx.scars; absent on preview pages). */
export interface ScarApi {
  /** A lasting scorch mark centred at (x, z), `size` wide (world units). */
  add(x: number, z: number, size: number, frame: number, intensity: number, rot: number, delay?: number): void;
}

/** Persistent scorch decals per quality preset (live budget). */
export const SCAR_CAPACITY: Record<'low' | 'medium' | 'high', number> = { low: 48, medium: 120, high: 192 };
const FADE = 4;
/** Effectively forever (seconds). */
const FOREVER = 1e7;

export class ScarDecals implements ScarApi {
  readonly slots: LruSlots;
  /** Per slot: x, z, size, intensity (baking into the burn map, merging). */
  private rec: Float32Array;
  private retired: number[] = [];
  now = 0;
  /** Bake a retired mark into the persistent burn map (x, z, radius, amount 0..1). */
  onBake: ((x: number, z: number, r: number, amount: number) => void) | null = null;
  /** Called once, when the first mark is laid (the layer starts drawing). */
  onFirst: (() => void) | null = null;
  /** Marks added / merged / retired so far. */
  readonly stats = { added: 0, merged: 0, retired: 0, dropped: 0 };

  constructor(readonly layer: DecalSystem) {
    const cap = layer.capacity;
    this.slots = new LruSlots(cap, Math.max(2, Math.round(cap / 10)));
    this.rec = new Float32Array(cap * 4);
  }

  add(x: number, z: number, size: number, frame: number, intensity: number, rot: number, delay = 0): void {
    if (!(size > 0) || !Number.isFinite(x + z)) return;
    const now = this.now;
    // merge: a mark of about this size (or larger) already lies here
    const rec = this.rec, sl = this.slots;
    for (let i = 0; i < sl.cap; i++) {
      if (!sl.isLive(i)) continue;
      const o = i * 4;
      const dx = rec[o] - x, dz = rec[o + 1] - z;
      if (rec[o + 2] >= size * 0.75 && dx * dx + dz * dz < (0.3 * rec[o + 2]) ** 2) {
        rec[o + 3] = Math.min(0.97, Math.max(rec[o + 3], intensity) + 0.06);
        this.layer.setIntensity(i, rec[o + 3]);
        sl.touch(i, now);
        this.stats.merged++;
        return;
      }
    }
    const slot = sl.alloc(now, FADE, this.retired);
    for (const r of this.retired) {
      const o = r * 4;
      this.layer.retire(r, FADE);
      this.onBake?.(rec[o], rec[o + 1], rec[o + 2] * 0.42, rec[o + 3] * 0.45);
      this.stats.retired++;
    }
    if (slot < 0) { this.stats.dropped++; return; }
    const o = slot * 4;
    rec[o] = x; rec[o + 1] = z; rec[o + 2] = size; rec[o + 3] = intensity;
    this.layer.write(slot, x, z, size, frame, intensity, FOREVER, rot, delay);
    if (this.stats.added++ === 0) this.onFirst?.();
  }

  /** Live marks as [x, z, size, intensity] (saves). */
  snapshot(): number[][] {
    const out: number[][] = [];
    for (let i = 0; i < this.slots.cap; i++) {
      if (!this.slots.isLive(i)) continue;
      const o = i * 4;
      out.push([+this.rec[o].toFixed(2), +this.rec[o + 1].toFixed(2), +this.rec[o + 2].toFixed(2), +this.rec[o + 3].toFixed(2)]);
    }
    return out;
  }
}
