/**
 * HD infantry animation: which baked clip a soldier plays, and where in the vertex animation texture (VAT) it is.
 *
 * Pure logic (no GPU): the crowd renderer (infantry-hd.ts) feeds every soldier's ModelAnimState and measured ground
 * speed into an InfantryAnimator each frame and reads back two clip rows and a cross-fade weight, which go to the
 * GPU as instance attributes. The clips are authored in tools/assets/models/infantry/_clips.py (and _dog.py):
 * '<set>.<state>' names, one set per soldier type (TYPE_SET).
 *
 * State mapping (per frame, first match wins):
 *   dying > 0           death clip by kind (shot: back / front at random, blown, burn, electro; bite = front;
 *                       crushed = the end of the 'back' death, flattened by the caller)
 *   parachute > 0       'para'
 *   a new shot          'fire' (pistols alternate 'fire' / 'fire2' by muzzle; grenadiers 'throw'; medics,
 *                       mechanics and engineers 'use'), restarted on every shot
 *   one-shot playing    keep it (fire, throw, reload) unless the soldier starts moving
 *   moving              'run' (or 'walk' below half the run speed), playback rate locked to the ground speed
 *   in combat (< 3 s)   'aim' (reload now and then between shots when the set has one)
 *   otherwise           'idle', with 'idle2' / 'idle3' variants every few loops
 * Clip changes cross-fade (0.06-0.25 s).
 */
import type { ModelAnimState } from './types';

/** One clip of the VAT (anim.<rig>.glb extras.rh_anim.clips). */
export interface ClipInfo {
  name: string;
  /** First texture row. */
  row: number;
  /** Rows (sampled frames, including the closing frame of a loop). */
  frames: number;
  duration: number;
  fps: number;
  loop: boolean;
  /** Model units travelled per cycle (locomotion). */
  stride?: number;
  /** Event times (seconds into the clip). */
  shot?: number;
  release?: number;
}

export type InfSet = 'rifle' | 'flamer' | 'launcher' | 'pistol' | 'unarmed' | 'grenade' | 'dog';

/** Clip set per soldier type. */
export const TYPE_SET: Readonly<Record<string, InfSet>> = {
  e1: 'rifle', shok: 'rifle', e4: 'flamer', e3: 'launcher', e7: 'pistol', e2: 'grenade',
  e6: 'unarmed', medi: 'unarmed', spy: 'unarmed', thf: 'unarmed', mech: 'unarmed', dog: 'dog',
};

/** Where a set borrows the clips it does not have. */
const SET_FALLBACK: Readonly<Record<InfSet, InfSet | null>> = {
  rifle: null, flamer: 'rifle', launcher: 'rifle', pistol: 'unarmed', unarmed: null, grenade: 'unarmed', dog: null,
};

/** Types whose 'fire' is a hands-on job (healing, repairs): they play 'use'. */
const USE_TYPES = new Set(['medi', 'mech', 'e6']);

export type InfState = 'idle' | 'idle2' | 'idle3' | 'walk' | 'run' | 'aim' | 'fire' | 'fire2' | 'reload' | 'use' | 'throw' | 'para'
  | 'crouch_aim' | 'crouch_fire' | 'bite';

export type DeathKind = NonNullable<ModelAnimState['deathKind']>;

/** A clip library: name -> clip. */
export class ClipLib {
  readonly byName = new Map<string, ClipInfo>();
  constructor(readonly clips: ClipInfo[], readonly height: number) {
    for (const c of clips) this.byName.set(c.name, c);
  }

  get(name: string): ClipInfo | undefined {
    return this.byName.get(name);
  }

  private memo: Partial<Record<InfSet, Partial<Record<InfState, ClipInfo | null>>>> = {};

  /** The clip a set plays for a state (with the set's fallbacks), or null. Memoised: no allocation per frame. */
  forState(set: InfSet, state: InfState): ClipInfo | null {
    const m = this.memo[set] ?? (this.memo[set] = {});
    const hit = m[state];
    if (hit !== undefined) return hit;
    return (m[state] = this.lookup(set, state));
  }

  private lookup(set: InfSet, state: InfState): ClipInfo | null {
    if (state === 'para') return this.byName.get(set === 'dog' ? 'dog.run' : 'para') ?? null;
    let s: InfSet | null = set;
    while (s) {
      const c = this.byName.get(`${s}.${state}`);
      if (c) return c;
      s = SET_FALLBACK[s];
    }
    return null;
  }

  death(set: InfSet, kind: DeathKind, seed: number): ClipInfo | null {
    if (set === 'dog') return this.byName.get(seed > 0.5 ? 'dog.death2' : 'dog.death') ?? this.byName.get('dog.death') ?? null;
    const name = kind === 'blown' ? 'death.blown' : kind === 'burn' ? 'death.burn' : kind === 'electro' ? 'death.electro'
      : kind === 'bite' ? 'death.front' : kind === 'crushed' ? 'death.back' : seed > 0.45 ? 'death.back' : 'death.front';
    return this.byName.get(name) ?? this.byName.get('death.back') ?? null;
  }
}

/** Texture row (fractional: the shader's linear filter interpolates the two frames) of a clip at time t. */
export function clipRow(c: ClipInfo, t: number): number {
  const n = c.frames - 1;
  if (n <= 0 || c.duration <= 0) return c.row;
  let u: number;
  if (c.loop) {
    u = t / c.duration;
    u -= Math.floor(u);
  } else u = Math.min(1, Math.max(0, t / c.duration));
  return c.row + u * n;
}

interface Track {
  clip: ClipInfo;
  t: number;
  rate: number;
  state: InfState | 'death';
  oneShot: boolean;
}

const ONE_SHOT = new Set<InfState | 'death'>(['fire', 'fire2', 'throw', 'reload', 'crouch_fire', 'bite']);

/** Cross-fade durations (s). */
const FADE = { loco: 0.2, fire: 0.06, death: 0.08, aim: 0.18, idle: 0.3, oneshot: 0.12 };
/** Seconds after the last shot a soldier keeps aiming. */
export const COMBAT_HOLD = 3;

/** Per-soldier clip state machine. */
export class InfantryAnimator {
  cur: Track | null = null;
  prev: Track | null = null;
  /** Cross-fade progress 0..1 (1 = only cur). */
  fade = 1;
  private fadeDur = 0.2;
  private lastFiring = 0;
  private combat = Infinity;
  private shots = 0;
  private loops = 0;
  private variant = 0;
  private dyingClip: ClipInfo | null = null;
  /** The state picked this frame (tests / debugging). */
  state: InfState | 'death' = 'idle';
  /** Smoothed ground speed (world units / s). */
  speed = 0;

  /** The model's visual scale (strides are in model units). */
  scale = 1;

  constructor(readonly lib: ClipLib, readonly set: InfSet, readonly typeId: string, readonly seed = Math.random()) {}

  private play(clip: ClipInfo | null, fade: number, restart = false, t0 = 0, state: InfState | 'death' = 'idle') {
    if (!clip) return;
    if (this.cur && this.cur.clip === clip && !restart) return;
    if (this.cur && fade > 0) {
      this.prev = this.cur;
      this.fade = 0;
      this.fadeDur = fade;
    } else {
      this.prev = null;
      this.fade = 1;
    }
    // three recycled track objects: the new one is neither the fading one nor the one it replaces
    const old = this.prev === null ? this.cur : null;
    let tr = this.pool[0];
    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[i];
      if (p !== this.prev && p !== old && p !== this.cur) { tr = p; break; }
    }
    tr.clip = clip;
    tr.t = t0;
    tr.rate = 1;
    tr.state = state;
    tr.oneShot = ONE_SHOT.has(state);
    this.cur = tr;
  }

  private pool: Track[] = [0, 1, 2].map(() => ({ clip: null as unknown as ClipInfo, t: 0, rate: 1, state: 'idle' as InfState | 'death', oneShot: false }));

  /** The current one-shot (fire / throw / reload / use / death) has played to its end. */
  private oneShotDone(): boolean {
    const c = this.cur;
    return !c || c.clip.loop || c.t >= c.clip.duration;
  }


  /**
   * Advance one frame. s: the model's animation inputs; groundSpeed: measured root speed (world units / s);
   * dt: frame seconds.
   */
  /** Pin a clip (previews, contact sheets): update() then only advances it at `rate` (0 = a still frame). */
  pin(clip: ClipInfo, t: number, rate = 0): void {
    this.cur = { clip, t, rate, state: 'idle', oneShot: false };
    this.prev = null;
    this.fade = 1;
    this.pinned = true;
  }

  private pinned = false;

  update(s: ModelAnimState, groundSpeed: number, dt: number): void {
    const lib = this.lib;
    const set = this.set;
    dt = Math.min(Math.max(dt, 0), 0.1);
    if (this.pinned) {
      this.advance(dt);
      return;
    }
    this.speed += (groundSpeed - this.speed) * Math.min(1, dt * 8);
    // ---- death
    if (s.dying > 0) {
      if (!this.dyingClip) {
        const kind = s.deathKind ?? 'normal';
        this.dyingClip = lib.death(set, kind, this.seed);
        this.play(this.dyingClip, kind === 'crushed' ? 0 : FADE.death, true, kind === 'crushed' && this.dyingClip ? this.dyingClip.duration : 0, 'death');
      }
      this.state = 'death';
      this.advance(dt);
      return;
    }
    if (this.dyingClip) {
      // revived (a replay seek): start over
      this.dyingClip = null;
      this.cur = null;
    }
    // ---- shots
    const newShot = s.firing > this.lastFiring + 0.3;
    this.lastFiring = s.firing;
    if (newShot) {
      this.combat = 0;
      this.shots++;
    } else this.combat += dt;
    const moving = s.moving && (this.speed > 0.03 || (s.speed ?? 0) > 0.05);
    let want: InfState;
    let fade = FADE.loco;
    let restart = false;
    if ((s.parachute ?? 0) > 0.5) want = 'para';
    else if (newShot && !(moving && set !== 'dog' && set !== 'pistol')) {
      want = set === 'dog' ? 'bite' : USE_TYPES.has(this.typeId) ? 'use' : set === 'grenade' ? 'throw' : set === 'pistol' && s.firingMuzzle % 2 === 1 ? 'fire2' : 'fire';
      fade = FADE.fire;
      restart = want !== 'use';
    } else if (this.cur && this.cur.oneShot && !this.oneShotDone() && !moving) {
      this.state = this.cur.state;
      this.advance(dt);
      return;
    } else if (moving) {
      const run = lib.forState(set, 'run');
      const runSpeed = run?.stride ? (run.stride * this.scale) / run.duration : 1;
      want = this.speed < runSpeed * 0.5 && lib.forState(set, 'walk') ? 'walk' : 'run';
    } else if (this.combat < COMBAT_HOLD) {
      want = USE_TYPES.has(this.typeId) ? 'use' : 'aim';
      fade = FADE.aim;
      // between shots now and then: reload (rifles every 5th shot, launchers after every rocket)
      const cs = this.cur?.state;
      if ((cs === 'fire' || cs === 'crouch_fire') && this.oneShotDone()) {
        const every = set === 'launcher' ? 1 : set === 'rifle' ? 5 : 0;
        if (every && this.shots % every === 0 && lib.forState(set, 'reload')) {
          want = 'reload';
          fade = FADE.oneshot;
          restart = true;
        }
      }
    } else {
      want = this.idleVariant();
      fade = FADE.idle;
    }
    const clip = lib.forState(set, want) ?? lib.forState(set, 'idle');
    this.state = want;
    if (clip) {
      if (want === 'idle' && this.cur?.clip !== clip) this.loops = 0;
      // a new idle cycle starts at a random phase (crowds don't breathe in step)
      const t0 = want === 'idle' && this.cur?.clip !== clip ? this.seed * clip.duration : 0;
      this.play(clip, fade, restart, t0, want);
    }
    // locomotion: the playback rate follows the ground speed (feet stay planted)
    const c = this.cur;
    if (c) {
      if ((want === 'run' || want === 'walk') && c.clip.stride) {
        const base = (c.clip.stride * this.scale) / c.clip.duration;
        c.rate = Math.min(1.8, Math.max(0.55, this.speed / Math.max(1e-3, base)));
      } else c.rate = 1;
    }
    this.advance(dt);
  }

  /** Idle, with a variant (look around, adjust the gear) every few loops. */
  private idleVariant(): InfState {
    const c = this.cur;
    const st = c?.state;
    const isIdle = st === 'idle' || st === 'idle2' || st === 'idle3';
    if (isIdle && c && c.clip.loop && c.t >= c.clip.duration) {
      // a loop finished: count it, maybe switch to a variant (or back to the plain idle)
      if (st === 'idle') {
        c.t -= c.clip.duration;
        this.loops++;
        if (this.loops >= 2 + Math.floor(this.seed * 3)) {
          this.loops = 0;
          this.variant++;
          const v = (Math.floor(this.seed * 1000) + this.variant) % 2 === 0 ? 'idle2' : 'idle3';
          // only the set's own variants (a borrowed rifle idle would hold a launcher like a rifle)
          if (this.lib.get(`${this.set}.${v}`)) return v;
        }
        return 'idle';
      }
      return 'idle'; // a variant played once: back to the plain idle
    }
    if (isIdle && c) return st as InfState;
    return 'idle';
  }

  private advance(dt: number): void {
    const c = this.cur;
    if (c) {
      c.t += dt * c.rate;
      // loops wrap (idles count their cycles in idleVariant before wrapping)
      const idle = c.state === 'idle' || c.state === 'idle2' || c.state === 'idle3';
      if (c.clip.loop && c.t >= c.clip.duration && !idle) c.t -= c.clip.duration * Math.floor(c.t / c.clip.duration);
      else if (c.clip.loop && c.t >= c.clip.duration * 2) c.t -= c.clip.duration;
      if (!c.clip.loop && c.t > c.clip.duration) c.t = c.clip.duration;
    }
    if (this.prev) {
      this.prev.t += dt * this.prev.rate;
      if (this.prev.clip.loop) this.prev.t %= this.prev.clip.duration;
      else this.prev.t = Math.min(this.prev.t, this.prev.clip.duration);
      this.fade = Math.min(1, this.fade + dt / Math.max(1e-3, this.fadeDur));
      if (this.fade >= 1) this.prev = null;
    }
  }

  /** Texture rows and the cross-fade: rowA = current clip, rowB = previous clip, w = previous clip's weight. */
  rows(out: { a: number; b: number; w: number }): { a: number; b: number; w: number } {
    const c = this.cur;
    if (!c) {
      out.a = out.b = 0;
      out.w = 0;
      return out;
    }
    out.a = clipRow(c.clip, c.t);
    if (this.prev) {
      out.b = clipRow(this.prev.clip, this.prev.t);
      const f = this.fade;
      out.w = 1 - f * f * (3 - 2 * f);
    } else {
      out.b = out.a;
      out.w = 0;
    }
    return out;
  }
}
