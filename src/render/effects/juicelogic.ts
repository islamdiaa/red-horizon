/**
 * [JUICE] Pure, GPU-free logic behind the game feel director (render/effects/juice.ts): screen-shake
 * trauma, clash detection for the battle music / announcer, and throttled "moment" call-outs. No three.js,
 * no DOM, no allocations per call: everything here is unit-tested in node (tests/juice.test.ts).
 *
 * Times are seconds on any monotonic clock the caller owns (the director uses real time, so a paused or
 * fast-forwarded game neither spams nor starves the call-outs).
 */

// ---------------------------------------------------------------------------------------------
// Screen shake

/** Old-style shake amounts (explosion recipes: small 0.03 … huge 0.6, nuke ≈ 5) → trauma. */
export const SHAKE_GAIN = 0.45;
/** Peak camera offset (world units) at full trauma, at the reference zoom. */
export const SHAKE_MAX = 0.55;
/** Trauma lost per second. */
export const SHAKE_DECAY = 1.35;
/** Camera distance the offsets are tuned for (zoomed out further, the offset grows to look the same). */
export const SHAKE_REF_DIST = 25;

/**
 * How much of an explosion's shake reaches the camera: 1 near the view centre, fading out to 0 a bit past
 * the screen edge (`viewRadius` = half the visible width in world units).
 */
export function shakeFalloff(dx: number, dz: number, viewRadius: number): number {
  const r = Math.max(1, viewRadius);
  const d = Math.hypot(dx, dz) / r;
  if (d <= 0.45) return 1;
  if (d >= 1.5) return 0;
  const k = 1 - (d - 0.45) / 1.05;
  return k * k;
}

/**
 * Trauma-based screen shake (amplitude ∝ trauma^1.3, smooth multi-sine noise instead of per-frame white
 * noise, linear trauma decay). Small hits stay imperceptible, a dying tank nudges the view, a nuke rocks it.
 */
export class ShakeModel {
  trauma = 0;
  private t = 0;
  /** Seconds since the last kick (the noise phase restarts on big kicks so they always start sharp). */
  private sinceKick = 9;

  /** Add old-style shake `amount` (already distance-attenuated). */
  kick(amount: number): void {
    if (!(amount > 0)) return;
    const add = amount * SHAKE_GAIN;
    if (add > 0.2 && this.trauma < 0.1) this.sinceKick = 0;
    this.trauma = Math.min(1, this.trauma + add);
  }

  /** Current offset amplitude in world units for camera distance `camDist`. */
  amplitude(camDist = SHAKE_REF_DIST): number {
    const tr = this.trauma;
    if (tr <= 0) return 0;
    return SHAKE_MAX * Math.pow(tr, 1.3) * Math.min(3, Math.max(0.6, camDist / SHAKE_REF_DIST));
  }

  /** Advance by dt and write the camera offset into `out` (scale 0 = reduceMotion: no shake at all). */
  update(dt: number, out: { x: number; y: number; z: number }, camDist = SHAKE_REF_DIST, scale = 1): void {
    const d = dt > 0 ? Math.min(dt, 0.1) : 0;
    this.t += d;
    this.sinceKick += d;
    this.trauma = Math.max(0, this.trauma - d * SHAKE_DECAY);
    const a = this.amplitude(camDist) * scale;
    if (a <= 1e-5) { out.x = 0; out.y = 0; out.z = 0; return; }
    const t = this.t;
    // incommensurate sines ≈ smooth band-limited noise around 9–23 Hz
    out.x = a * (0.62 * Math.sin(t * 61.3) + 0.38 * Math.sin(t * 143.7 + 1.7)) * 0.5;
    out.y = a * (0.6 * Math.sin(t * 73.1 + 0.4) + 0.4 * Math.sin(t * 121.9 + 2.9)) * 0.3;
    out.z = a * (0.65 * Math.sin(t * 57.7 + 2.2) + 0.35 * Math.sin(t * 131.3 + 0.6)) * 0.5;
  }
}

// ---------------------------------------------------------------------------------------------
// Clash detection (big battles in view)

/** Units fighting in view needed to call it a clash, and the level below which it winds down. */
export const CLASH_START = 25;
export const CLASH_END = 12;
/** A shooter counts as fighting for this long after its last shot. */
export const FIGHT_MEMORY = 4;

export interface ClashResult {
  /** Seconds the clash lasted. */
  duration: number;
  /** Enemy / friendly units lost during it (visible to us). */
  enemyLosses: number;
  ownLosses: number;
  /** The local side clearly won it (big enough, lopsided enough). */
  won: boolean;
}

/**
 * Counts units that fired recently while on screen (both sides) and turns that into a clash level with
 * hysteresis: a clash starts after `CLASH_START` fighters for 1.5 s and ends after fewer than `CLASH_END`
 * for 5 s. Losses on both sides are tallied while it lasts so the end can be judged (sector won?).
 */
export class ClashMeter {
  /** Fighters in view right now (both sides). */
  fighters = 0;
  /** Smoothed 0..1 clash level (drives the music). */
  level = 0;
  active = false;
  private last = new Map<number, number>();
  private above = 0;
  private below = 0;
  private startT = 0;
  private enemyLosses = 0;
  private ownLosses = 0;
  private recount = 0;

  /** A unit fired; `inView` = the shooter or its target is on screen. */
  onFire(id: number, now: number, inView: boolean): void {
    if (inView) this.last.set(id, now);
  }

  /** A unit died where we could see it. */
  onLoss(own: boolean): void {
    if (!this.active) return;
    if (own) this.ownLosses++;
    else this.enemyLosses++;
  }

  /**
   * Advance; returns 'start' / 'end' on transitions, else null. After 'end', `lastResult` describes the
   * clash that just ended.
   */
  update(dt: number, now: number): 'start' | 'end' | null {
    this.recount -= dt;
    if (this.recount <= 0) {
      this.recount = 0.25;
      let n = 0;
      for (const [id, t] of this.last) {
        if (now - t > FIGHT_MEMORY) this.last.delete(id);
        else n++;
      }
      this.fighters = n;
    }
    const target = this.active ? Math.min(1, 0.55 + 0.45 * Math.min(1, this.fighters / (CLASH_START * 2))) : 0;
    const tau = target > this.level ? 1.2 : 3.5;
    this.level += (target - this.level) * (1 - Math.exp(-Math.max(0, dt) / tau));
    if (!this.active) {
      this.above = this.fighters >= CLASH_START ? this.above + dt : 0;
      if (this.above >= 1.5) {
        this.active = true;
        this.below = 0;
        this.startT = now;
        this.enemyLosses = this.ownLosses = 0;
        return 'start';
      }
    } else {
      this.below = this.fighters < CLASH_END ? this.below + dt : 0;
      if (this.below >= 5) {
        this.active = false;
        this.above = 0;
        const e = this.enemyLosses, o = this.ownLosses;
        this.lastResult = { duration: now - this.startT, enemyLosses: e, ownLosses: o, won: e >= 6 && o <= e * 0.6 };
        return 'end';
      }
    }
    return null;
  }

  lastResult: ClashResult | null = null;

  reset(): void {
    this.last.clear();
    this.fighters = 0;
    this.level = 0;
    this.active = false;
    this.above = this.below = 0;
  }
}

// ---------------------------------------------------------------------------------------------
// Sliding-window counters for announcer moments

/** Fixed-capacity ring of event times: how many happened within the last `window` seconds. */
export class EventWindow {
  private times: Float64Array;
  private head = 0;
  private n = 0;

  constructor(readonly window: number, capacity = 64) {
    this.times = new Float64Array(capacity);
  }

  push(now: number): void {
    this.times[this.head] = now;
    this.head = (this.head + 1) % this.times.length;
    if (this.n < this.times.length) this.n++;
  }

  count(now: number): number {
    let c = 0;
    const cap = this.times.length;
    for (let i = 0; i < this.n; i++) {
      const t = this.times[(this.head - 1 - i + cap) % cap];
      if (now - t <= this.window) c++;
      else break; // newest first: everything older is out too
    }
    return c;
  }

  clear(): void {
    this.n = 0;
  }
}

/** Minimum gap between two call-outs of the same moment (s), and between any two moments. */
export const MOMENT_GAP: Record<MomentKey, number> = {
  armour_neutralised: 45,
  base_heavy_attack: 60,
  sector_victorious: 90,
  enemy_base_destroyed: 20,
};
export const MOMENT_ANY_GAP = 6;

export type MomentKey = 'armour_neutralised' | 'base_heavy_attack' | 'sector_victorious' | 'enemy_base_destroyed';

/**
 * Decides when the announcer calls a battle moment: enemy armour neutralised (≥ 4 enemy vehicles destroyed
 * in sight within 12 s), our base under heavy attack (≥ 24 hits on our structures from ≥ 5 attackers in
 * 8 s, or 2 structures lost within 25 s), sector won (a clash we clearly won). Each key is throttled, and
 * any two call-outs are at least `MOMENT_ANY_GAP` apart.
 */
export class MomentTracker {
  private armour = new EventWindow(12, 32);
  private baseHits = new EventWindow(8, 128);
  private lostWin = new EventWindow(25, 16);
  private attackers = new Map<number, number>();
  private lastAt = new Map<MomentKey, number>();
  private lastAny = -Infinity;

  /** Throttle gate: returns true (and records it) if `key` may be called now. */
  allow(key: MomentKey, now: number): boolean {
    const last = this.lastAt.get(key);
    if (last !== undefined && now - last < MOMENT_GAP[key]) return false;
    if (now - this.lastAny < MOMENT_ANY_GAP) return false;
    this.lastAt.set(key, now);
    this.lastAny = now;
    return true;
  }

  /** An enemy armoured vehicle died in sight. */
  enemyArmourLost(now: number): MomentKey | null {
    this.armour.push(now);
    if (this.armour.count(now) >= 4 && this.allow('armour_neutralised', now)) {
      this.armour.clear();
      return 'armour_neutralised';
    }
    return null;
  }

  /** One of our structures was shot at by `attacker`. */
  baseHit(attacker: number, now: number): MomentKey | null {
    this.baseHits.push(now);
    this.attackers.set(attacker, now);
    if (this.baseHits.count(now) < 24) return null;
    let n = 0;
    for (const [id, t] of this.attackers) {
      if (now - t > 8) this.attackers.delete(id);
      else n++;
    }
    if (n >= 5 && this.allow('base_heavy_attack', now)) { this.baseHits.clear(); return 'base_heavy_attack'; }
    return null;
  }

  /** One of our structures was destroyed. */
  baseLost(now: number): MomentKey | null {
    this.lostWin.push(now);
    if (this.lostWin.count(now) >= 2 && this.allow('base_heavy_attack', now)) return 'base_heavy_attack';
    return null;
  }

  /** A clash ended. */
  clashEnded(res: ClashResult, now: number): MomentKey | null {
    return res.won && this.allow('sector_victorious', now) ? 'sector_victorious' : null;
  }
}
