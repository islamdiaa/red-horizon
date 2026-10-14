/**
 * Pure-JS generators for the living soundscape (./ambience.ts): seamless loop beds, one-shot
 * nature / weather / distant-battle events, thunder and the environment-reverb impulse responses.
 * Everything is computed sample by sample (deterministic per seed, no audio graph) at the lowest
 * sample rate the content needs, so the whole bank costs ≈ 12 MB and a few hundred ms of CPU spread
 * over many small background tasks.
 */
import { clamp, hashStr, makeBuffer, mulberry32, type Rng } from './dsp';

const TAU = 2 * Math.PI;

/** Rendered audio: 1 or 2 channels at `sr`. */
export interface Gen { sr: number; ch: Float32Array[] }

// ---------------------------------------------------------------------------
// DSP primitives
// ---------------------------------------------------------------------------

export type BqType = 'lp' | 'hp' | 'bp';

/** RBJ biquad (direct form I). Band-pass has 0 dB peak gain. */
export class BQ {
  private b0 = 1; private b1 = 0; private b2 = 0; private a1 = 0; private a2 = 0;
  private x1 = 0; private x2 = 0; private y1 = 0; private y2 = 0;
  constructor(readonly sr: number, type: BqType = 'lp', f = 1000, q = 0.707) { this.set(type, f, q); }
  set(type: BqType, f: number, q = 0.707): this {
    const w = (TAU * clamp(f, 8, this.sr * 0.45)) / this.sr;
    const cs = Math.cos(w);
    const al = Math.sin(w) / (2 * q);
    let b0: number, b1: number, b2: number;
    if (type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; }
    else if (type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; }
    else { b0 = al; b1 = 0; b2 = -al; }
    const a0 = 1 + al;
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0;
    this.a1 = (-2 * cs) / a0; this.a2 = (1 - al) / a0;
    return this;
  }
  run(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x;
    this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

/** One-pole low-pass. */
class LP1 {
  private a: number;
  y = 0;
  constructor(sr: number, f: number) { this.a = 1 - Math.exp((-TAU * f) / sr); }
  run(x: number): number { return (this.y += this.a * (x - this.y)); }
}

class Pink {
  private b0 = 0; private b1 = 0; private b2 = 0; private b3 = 0; private b4 = 0; private b5 = 0; private b6 = 0;
  constructor(private readonly rng: Rng) {}
  next(): number {
    const w = this.rng() * 2 - 1;
    this.b0 = 0.99886 * this.b0 + w * 0.0555179;
    this.b1 = 0.99332 * this.b1 + w * 0.0750759;
    this.b2 = 0.969 * this.b2 + w * 0.153852;
    this.b3 = 0.8665 * this.b3 + w * 0.3104856;
    this.b4 = 0.55 * this.b4 + w * 0.5329522;
    this.b5 = -0.7616 * this.b5 - w * 0.016898;
    const v = this.b0 + this.b1 + this.b2 + this.b3 + this.b4 + this.b5 + this.b6 + w * 0.5362;
    this.b6 = w * 0.115926;
    return v * 0.12;
  }
}

class Brown {
  private y = 0;
  constructor(private readonly rng: Rng) {}
  next(): number {
    this.y = (this.y + 0.02 * (this.rng() * 2 - 1)) / 1.02;
    return this.y * 3.5;
  }
}

/** Smooth random curve in [lo, hi]: smoothstep interpolation between random knots ~`period` s apart. */
class Wander {
  private a: number;
  private b: number;
  private t = 0;
  private step: number;
  constructor(private readonly rng: Rng, private readonly sr: number, private readonly period: number, private readonly lo = 0, private readonly hi = 1) {
    this.a = lo + (hi - lo) * rng();
    this.b = lo + (hi - lo) * rng();
    this.step = 1 / (sr * period * (0.6 + 0.8 * rng()));
  }
  next(): number {
    this.t += this.step;
    if (this.t >= 1) {
      this.t -= 1;
      this.a = this.b;
      this.b = this.lo + (this.hi - this.lo) * this.rng();
      this.step = 1 / (this.sr * this.period * (0.6 + 0.8 * this.rng()));
    }
    const x = this.t;
    return this.a + (this.b - this.a) * x * x * (3 - 2 * x);
  }
}

const rr = (rng: Rng, a: number, b: number): number => a + (b - a) * rng();
const pickOf = <T>(rng: Rng, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];

/** Raised-cosine window: 0 → 1 over `a`, 1 → 0 over the last `r` (fractions of u ∈ [0,1]). */
function win(u: number, a: number, r: number): number {
  if (u < a) return 0.5 - 0.5 * Math.cos((Math.PI * u) / a);
  if (u > 1 - r) return 0.5 - 0.5 * Math.cos((Math.PI * (1 - u)) / r);
  return 1;
}

/**
 * Add a (mostly) sinusoidal note to `d`: frequency trajectory f(u) and envelope a(u), u ∈ [0,1].
 * h2/h3 = relative harmonic levels (skipped above Nyquist).
 */
function tone(d: Float32Array, sr: number, t0: number, dur: number, f: (u: number) => number, a: (u: number) => number, amp: number, h2 = 0, h3 = 0): void {
  const i0 = Math.round(t0 * sr);
  const n = Math.max(1, Math.round(dur * sr));
  const nyq = sr * 0.45;
  const K = 16; // trajectories are evaluated every K samples and interpolated linearly
  const w = TAU / sr;
  let ph = 0;
  let f0 = f(0), a0 = a(0);
  for (let c = 0; c < n; c += K) {
    const ce = Math.min(n, c + K);
    const f1 = f(ce / n), a1 = a(ce / n);
    const k = ce - c;
    const df = (f1 - f0) / k, da = (a1 - a0) / k;
    const fm = f0 > f1 ? f0 : f1;
    const u2 = h2 !== 0 && fm * 2 < nyq;
    const u3 = h3 !== 0 && fm * 3 < nyq;
    let fr = f0, am = a0 * amp;
    const dam = da * amp;
    for (let i = c; i < ce; i++) {
      ph += w * fr;
      const j = i0 + i;
      if (j >= 0 && j < d.length) {
        let v = Math.sin(ph);
        if (u2) v += h2 * Math.sin(2 * ph);
        if (u3) v += h3 * Math.sin(3 * ph);
        d[j] += am * v;
      }
      fr += df;
      am += dam;
    }
    if (ph > 1e4) ph %= TAU;
    f0 = f1;
    a0 = a1;
    if (i0 + ce >= d.length) break;
  }
}

/** Short filtered noise burst with exponential decay (attack `att` s, decay time constant `tau` s). */
function burst(d: Float32Array, sr: number, rng: Rng, t0: number, amp: number, att: number, tau: number, f: BQ | null, len = tau * 7 + att): void {
  const i0 = Math.round(t0 * sr);
  const n = Math.round(len * sr);
  const na = Math.max(1, Math.round(att * sr));
  const k = Math.exp(-1 / (tau * sr));
  let e = 1;
  for (let i = 0; i < n; i++) {
    const j = i0 + i;
    if (j >= d.length) break;
    const w = rng() * 2 - 1;
    const x = f ? f.run(w) : w;
    const env = i < na ? i / na : (e *= k);
    if (j >= 0) d[j] += amp * env * x;
  }
}

/** Scale to an RMS target, then soft-limit rare peaks above `ceil`. */
function normRms(ch: Float32Array[], target: number, ceil = 0.9): void {
  let s = 0, n = 0;
  for (const d of ch) for (let i = 0; i < d.length; i++) { s += d[i] * d[i]; n++; }
  const rms = Math.sqrt(s / Math.max(1, n));
  const g = rms > 1e-9 ? target / rms : 0;
  const knee = ceil * 0.7;
  for (const d of ch) {
    for (let i = 0; i < d.length; i++) {
      let v = d[i] * g;
      const a = Math.abs(v);
      if (a > knee) v = Math.sign(v) * (knee + (ceil - knee) * Math.tanh((a - knee) / (ceil - knee)));
      d[i] = v;
    }
  }
}

/** Normalise a one-shot to `peak`, remove DC, fade the edges and trim trailing silence. */
function finishEvent(sr: number, ch: Float32Array[], peak = 0.9): Gen {
  let p = 0;
  for (const d of ch) {
    let mean = 0;
    for (let i = 0; i < d.length; i++) mean += d[i];
    mean /= Math.max(1, d.length);
    // DC blocker instead of mean removal for long sounds (keeps tails clean)
    const R = 1 - (TAU * 12) / sr;
    let x1 = 0, y1 = 0;
    for (let i = 0; i < d.length; i++) {
      const x = d[i] - mean;
      const y = x - x1 + R * y1;
      x1 = x; y1 = y;
      d[i] = y;
      p = Math.max(p, Math.abs(y));
    }
  }
  const g = p > 1e-9 ? peak / p : 0;
  let end = 0;
  const thr = peak * 0.002; // −54 dB: event tails below that vanish under the beds anyway (shorter voices = less CPU)
  for (const d of ch) {
    for (let i = 0; i < d.length; i++) d[i] *= g;
    for (let i = d.length - 1; i > end; i--) if (Math.abs(d[i]) > thr) { end = i; break; }
  }
  end = Math.min(ch[0].length, end + Math.round(sr * 0.03));
  const out = ch.map((d) => d.slice(0, end));
  const fi = Math.min(Math.round(sr * 0.002), end);
  const fo = Math.min(Math.round(sr * 0.025), end);
  for (const d of out) {
    for (let i = 0; i < fi; i++) d[i] *= i / fi;
    for (let i = 0; i < fo; i++) d[end - 1 - i] *= i / fo;
  }
  return { sr, ch: out };
}

/**
 * Seamless loop: `fill` renders pre-roll + n + crossfade samples per channel; the pre-roll (filter
 * warm-up) is dropped and the extra tail is equal-power crossfaded into the head, so sample n-1 flows
 * into sample 0 exactly like the continuous render did.
 */
function makeLoop(sr: number, seconds: number, xfade: number, channels: number, fill: (ch: Float32Array[]) => void, rms = 0.1): Gen {
  const n = Math.round(sr * seconds);
  const x = Math.round(sr * xfade);
  const pre = Math.round(sr * 1.5);
  const raw = Array.from({ length: channels }, () => new Float32Array(pre + n + x));
  fill(raw);
  const out = raw.map((r) => {
    const o = r.slice(pre, pre + n);
    for (let i = 0; i < x; i++) {
      const t = (i + 0.5) / x;
      o[i] = r[pre + i] * Math.sin((t * Math.PI) / 2) + r[pre + n + i] * Math.cos((t * Math.PI) / 2);
    }
    return o;
  });
  normRms(out, rms);
  return { sr, ch: out };
}

// ---------------------------------------------------------------------------
// Loop beds
// ---------------------------------------------------------------------------

function windBed(rng: Rng, sr: number, dark: boolean): Gen {
  return makeLoop(sr, 16, 2.5, 1, ([d]) => {
    const pink = new Pink(rng);
    const brown = new Brown(rng);
    const gustA = new Wander(rng, sr, dark ? 3.5 : 2.4, 0.15, 1);
    const gustB = new Wander(rng, sr, dark ? 9 : 7, 0.3, 1);
    const whistleF = new Wander(rng, sr, 3.3, 0, 1);
    const bp = new BQ(sr, 'bp', 400, 0.55);
    const lp = new BQ(sr, 'lp', dark ? 520 : 1300, 0.6);
    const wh = new BQ(sr, 'bp', 700, 14);
    const body = new BQ(sr, 'lp', 140, 0.7);
    let g = 0.5, wf = 0, gw = 0;
    for (let i = 0; i < d.length; i++) {
      if ((i & 31) === 0) {
        g = gustA.next() * 0.65 + gustB.next() * 0.35;
        wf = whistleF.next();
        gw = 1.8 * Math.pow(g, 2.2);
        bp.set('bp', (dark ? 120 : 170) + (dark ? 260 : 560) * g, 0.55);
        if (!dark) wh.set('bp', 480 + 620 * wf * (0.6 + 0.4 * g), 16);
      } else { gustA.next(); gustB.next(); whistleF.next(); }
      const p = pink.next();
      let v = lp.run(bp.run(p)) * (0.25 + 0.75 * g) * 2.2 + body.run(brown.next()) * (0.3 + 0.4 * g) * 0.6;
      if (!dark) v += wh.run(p) * gw;
      d[i] = v;
    }
  }, 0.1);
}

function leavesBed(rng: Rng, sr: number): Gen {
  return makeLoop(sr, 11, 1.5, 1, ([d]) => {
    const gust = new Wander(rng, sr, 1.7, 0, 1);
    const slow = new Wander(rng, sr, 6, 0.35, 1);
    const bp = new BQ(sr, 'bp', 3400, 0.5);
    const hp = new BQ(sr, 'hp', 1300, 0.7);
    const grainEnv = new LP1(sr, 90);
    let grain = 0, g = 0;
    for (let i = 0; i < d.length; i++) {
      const gv = gust.next() * slow.next();
      if ((i & 31) === 0) g = Math.pow(gv, 1.4);
      // leaf contacts: sparse decaying impulses, denser with the gust
      if (rng() < (40 + 900 * g) / sr) grain += rr(rng, 0.3, 1);
      grain *= 0.996;
      const e = grainEnv.run(grain);
      d[i] = hp.run(bp.run(rng() * 2 - 1)) * (0.12 * g + e * (0.4 + 0.6 * g));
    }
  }, 0.1);
}

function insectBed(rng: Rng, sr: number): Gen {
  return makeLoop(sr, 12, 1.5, 1, ([d]) => {
    const n = d.length;
    // field hiss
    const hb = new BQ(sr, 'bp', 6500, 1.2);
    const hw = new Wander(rng, sr, 4, 0.5, 1);
    for (let i = 0; i < n; i++) d[i] = hb.run(rng() * 2 - 1) * 0.05 * hw.next();
    // cicada-like singers: AM-pulsed narrow-band noise in phrases
    for (let k = 0; k < 4; k++) {
      const fc = rr(rng, 4300, 7600);
      const bp = new BQ(sr, 'bp', fc, rr(rng, 5, 9));
      const pr = rr(rng, 34, 95);
      const lvl = rr(rng, 0.25, 1) * (k === 0 ? 1 : 0.6);
      let t = rr(rng, 0, 2);
      while (t < n / sr) {
        const len = rr(rng, 1.2, 4.5);
        const i0 = Math.round(t * sr), m = Math.round(len * sr);
        let ph = rng();
        for (let i = 0; i < m && i0 + i < n; i++) {
          const u = i / m;
          ph += pr / sr;
          const x = 0.5 + 0.5 * Math.sin(TAU * ph);
          d[i0 + i] += bp.run(rng() * 2 - 1) * x * x * x * lvl * win(u, 0.18, 0.3) * 0.9;
        }
        t += len + rr(rng, 0.6, 3.5);
      }
    }
    // grasshopper chirps: short buzzy bursts in groups
    for (let k = 0; k < 2; k++) {
      const bp = new BQ(sr, 'bp', rr(rng, 7500, 9800), 4);
      const lvl = rr(rng, 0.25, 0.6);
      let t = rr(rng, 0, 1.5);
      while (t < n / sr) {
        const reps = 2 + Math.floor(rng() * 4);
        for (let r = 0; r < reps; r++) {
          const i0 = Math.round((t + r * 0.22) * sr), m = Math.round(rr(rng, 0.07, 0.12) * sr);
          for (let i = 0; i < m && i0 + i < n; i++) {
            const x = 0.5 + 0.5 * Math.sin((TAU * 210 * i) / sr);
            const am = x * x * x * x;
            d[i0 + i] += bp.run(rng() * 2 - 1) * am * lvl * win(i / m, 0.2, 0.3);
          }
        }
        t += reps * 0.22 + rr(rng, 1.5, 5);
      }
    }
  }, 0.1);
}

function cricketBed(rng: Rng, sr: number): Gen {
  return makeLoop(sr, 12, 1.2, 1, ([d]) => {
    const n = d.length;
    const T = n / sr;
    const chirper = (fc: number, lvl: number, period: number, pulses: number, pulseLen: number, pulseGap: number) => {
      let t = rr(rng, 0, period);
      while (t < T) {
        const p = pulses + (rng() < 0.3 ? (rng() < 0.5 ? -1 : 1) : 0);
        for (let k = 0; k < Math.max(2, p); k++) {
          tone(d, sr, t + k * (pulseLen + pulseGap), pulseLen, (u) => fc * (1 - 0.025 * u), (u) => { const x = Math.sin(Math.PI * u); return x * Math.sqrt(x); }, lvl, 0.12);
        }
        t += period * rr(rng, 0.94, 1.06);
      }
    };
    // close-ish field crickets
    for (let k = 0; k < 4; k++) {
      chirper(rr(rng, 3900, 5100), rr(rng, 0.35, 1), rr(rng, 0.33, 0.8), 3 + Math.floor(rng() * 3), rr(rng, 0.012, 0.02), rr(rng, 0.014, 0.022));
    }
    // distant chorus
    for (let k = 0; k < 12; k++) {
      chirper(rr(rng, 3600, 5400), rr(rng, 0.05, 0.14), rr(rng, 0.3, 0.9), 2 + Math.floor(rng() * 4), rr(rng, 0.01, 0.018), rr(rng, 0.012, 0.02));
    }
    // tree-cricket trills: continuous pulse trains in long phrases
    for (let k = 0; k < 2; k++) {
      const fc = rr(rng, 2500, 3100);
      const rate = rr(rng, 45, 62);
      const lvl = rr(rng, 0.12, 0.25);
      let t = rr(rng, 0, 3);
      while (t < T) {
        const len = rr(rng, 2.5, 6);
        tone(d, sr, t, len, () => fc, (u) => win(u, 0.08, 0.12) * Math.pow(0.5 + 0.5 * Math.sin(TAU * rate * u * len), 2), lvl, 0.1);
        t += len + rr(rng, 1, 4);
      }
    }
  }, 0.08);
}

function waterBed(rng: Rng, sr: number): Gen {
  return makeLoop(sr, 18, 2.5, 1, ([d]) => {
    const n = d.length;
    const brown = new Brown(rng);
    const under = new BQ(sr, 'lp', 260, 0.6);
    const uw = new Wander(rng, sr, 3, 0.5, 1);
    for (let i = 0; i < n; i++) d[i] = under.run(brown.next()) * 0.45 * uw.next();
    let t = rr(rng, 0, 1.5);
    while (t < n / sr) {
      const strength = rr(rng, 0.45, 1);
      const rise = rr(rng, 0.5, 1.1);
      const fall = rr(rng, 0.9, 1.8);
      // swell: low noise rising and falling
      {
        const lp = new BQ(sr, 'lp', rr(rng, 450, 800), 0.7);
        const i0 = Math.round(t * sr), m = Math.round((rise + fall) * sr);
        for (let i = 0; i < m && i0 + i < n; i++) {
          const tt = i / sr;
          const e = tt < rise ? 0.5 - 0.5 * Math.cos((Math.PI * tt) / rise) : Math.exp(-(tt - rise) / (fall * 0.35));
          d[i0 + i] += lp.run(rng() * 2 - 1) * e * 0.55 * strength;
        }
      }
      // lap: soft slap + foamy fizz with tiny bubbles
      const tl = t + rise * rr(rng, 0.85, 1);
      burst(d, sr, rng, tl, 0.5 * strength, 0.018, 0.07, new BQ(sr, 'bp', rr(rng, 500, 1200), 1.1));
      burst(d, sr, rng, tl + 0.04, 0.25 * strength, 0.03, 0.12, new BQ(sr, 'bp', rr(rng, 1200, 2200), 1.4));
      {
        const hp = new BQ(sr, 'hp', 2400, 0.7);
        const len = rr(rng, 0.6, 1.3);
        const i0 = Math.round((tl + 0.03) * sr), m = Math.round(len * sr);
        let g = 0;
        for (let i = 0; i < m && i0 + i < n; i++) {
          if (rng() < 0.012) g = rr(rng, 0.4, 1);
          g *= 0.993;
          d[i0 + i] += hp.run(rng() * 2 - 1) * g * 0.16 * strength * (1 - i / m);
        }
        const nb = 3 + Math.floor(rng() * 9);
        for (let b = 0; b < nb; b++) {
          const f0 = rr(rng, 700, 2300);
          tone(d, sr, tl + rr(rng, 0.02, len), rr(rng, 0.015, 0.04), (u) => f0 * (1 + 0.35 * u), (u) => (u < 0.08 ? u / 0.08 : Math.exp(-(u - 0.08) * 5)), 0.06 * strength * rr(rng, 0.3, 1));
        }
      }
      t += rise + fall * rr(rng, 0.9, 2.2) + rr(rng, 0.3, 2);
    }
  }, 0.1);
}

/** Grain table for rain drops: short decaying noise ticks of varying colour. */
function dropGrains(rng: Rng, sr: number, count: number, fLo: number, fHi: number, tauLo: number, tauHi: number): Float32Array[] {
  const out: Float32Array[] = [];
  for (let k = 0; k < count; k++) {
    const tau = rr(rng, tauLo, tauHi);
    const len = Math.round(tau * 6 * sr) + 4;
    const g = new Float32Array(len);
    const f = new BQ(sr, 'bp', rr(rng, fLo, fHi), rr(rng, 0.7, 2.2));
    const kk = Math.exp(-1 / (tau * sr));
    let e = 1;
    for (let i = 0; i < len; i++) { g[i] = f.run(rng() * 2 - 1) * (i < 2 ? i / 2 : (e *= kk)); }
    out.push(g);
  }
  return out;
}

function addGrain(d: Float32Array, g: Float32Array, at: number, amp: number): void {
  for (let i = 0; i < g.length && at + i < d.length; i++) d[at + i] += g[i] * amp;
}

function rainBed(rng: Rng, sr: number): Gen {
  return makeLoop(sr, 11, 1.2, 1, ([d]) => {
    const n = d.length;
    const pink = new Pink(rng);
    const hp = new BQ(sr, 'hp', 420, 0.6);
    const hp2 = new BQ(sr, 'hp', 420, 0.6);
    const lp = new BQ(sr, 'lp', 8500, 0.6);
    const sw = new Wander(rng, sr, 2.5, 0.85, 1);
    for (let i = 0; i < n; i++) d[i] = lp.run(hp2.run(hp.run(pink.next()))) * 1.1 * sw.next();
    const grains = dropGrains(rng, sr, 32, 1800, 9000, 0.0006, 0.0025);
    const rate = 1000;
    let t = 0;
    while (true) {
      t += -Math.log(1 - rng()) / rate;
      const i0 = Math.round(t * sr);
      if (i0 >= n) break;
      const a = 0.03 + 0.5 * Math.pow(rng(), 5);
      addGrain(d, grains[Math.floor(rng() * grains.length)], i0, a);
      if (rng() < 0.12) {
        const f0 = rr(rng, 1300, 4200);
        tone(d, sr, t, rr(rng, 0.008, 0.022), (u) => f0 * (1 + 0.3 * u), (u) => (u < 0.06 ? u / 0.06 : Math.exp(-(u - 0.06) * 4.5)), a * 0.5);
      }
    }
  }, 0.1);
}

function rainHeavyBed(rng: Rng, sr: number): Gen {
  return makeLoop(sr, 11, 1.2, 1, ([d]) => {
    const n = d.length;
    const pink = new Pink(rng);
    const brown = new Brown(rng);
    const hp = new BQ(sr, 'hp', 160, 0.6);
    const lp = new BQ(sr, 'lp', 5200, 0.6);
    const roar = new BQ(sr, 'lp', 550, 0.7);
    const surge = new Wander(rng, sr, 3.2, 0.7, 1);
    for (let i = 0; i < n; i++) {
      const s = surge.next();
      d[i] = lp.run(hp.run(pink.next())) * 1.3 * s + roar.run(brown.next()) * 0.7 * s;
    }
    const grains = dropGrains(rng, sr, 32, 1200, 7000, 0.0005, 0.002);
    let t = 0;
    while (true) {
      t += -Math.log(1 - rng()) / 2400;
      const i0 = Math.round(t * sr);
      if (i0 >= n) break;
      addGrain(d, grains[Math.floor(rng() * grains.length)], i0, 0.02 + 0.3 * Math.pow(rng(), 4));
    }
    // heavier splats
    t = 0;
    while (true) {
      t += -Math.log(1 - rng()) / 45;
      if (t * sr >= n) break;
      burst(d, sr, rng, t, rr(rng, 0.05, 0.22), 0.001, rr(rng, 0.006, 0.02), new BQ(sr, 'bp', rr(rng, 700, 2200), 1.2));
    }
  }, 0.1);
}

function howlBed(rng: Rng, sr: number): Gen {
  return makeLoop(sr, 15, 2.5, 1, ([d]) => {
    const pink = new Pink(rng);
    const gust = new Wander(rng, sr, 2.2, 0.2, 1);
    const gust2 = new Wander(rng, sr, 6.5, 0.4, 1);
    const fA = new Wander(rng, sr, 2.8, 0, 1);
    const fB = new Wander(rng, sr, 4.1, 0, 1);
    const base = new BQ(sr, 'lp', 850, 0.6);
    const base2 = new BQ(sr, 'hp', 90, 0.6);
    const h1 = new BQ(sr, 'bp', 400, 12);
    const h2 = new BQ(sr, 'bp', 600, 14);
    const grit = new BQ(sr, 'hp', 3200, 0.7);
    const gritEnv = new LP1(sr, 400);
    let g = 0.5, sand = 0, gh = 0;
    for (let i = 0; i < d.length; i++) {
      const ga = gust.next(), gb = gust2.next(), a = fA.next(), b = fB.next();
      if ((i & 31) === 0) {
        g = ga * 0.7 + gb * 0.3;
        gh = Math.pow(g, 1.6) * 2.4;
        const f1 = 260 + 420 * a * (0.6 + 0.4 * g);
        h1.set('bp', f1, 12);
        h2.set('bp', f1 * (1.45 + 0.2 * b), 15);
      }
      const w = rng() * 2 - 1;
      if (rng() < (300 + 2600 * g * g) / sr) sand += rr(rng, 0.2, 1);
      sand *= 0.985;
      const s = gritEnv.run(sand);
      d[i] = base2.run(base.run(pink.next())) * (0.35 + 0.65 * g) * 1.6
        + (h1.run(w) * 1.0 + h2.run(w) * 0.6) * gh
        + grit.run(w) * s * 0.35;
    }
  }, 0.1);
}

function rumbleBed(rng: Rng, sr: number): Gen {
  return makeLoop(sr, 14, 2, 1, ([d]) => {
    const brown = new Brown(rng);
    const lp = new BQ(sr, 'lp', 95, 0.8);
    const lp2 = new BQ(sr, 'lp', 220, 0.6);
    const w = new Wander(rng, sr, 1.4, 0.25, 1);
    for (let i = 0; i < d.length; i++) d[i] = lp2.run(lp.run(brown.next())) * w.next();
    // distant salvos baked in as swells
    let t = rr(rng, 0, 1);
    while (t * sr < d.length) {
      const i0 = Math.round(t * sr), m = Math.round(2.5 * sr), a = rr(rng, 0.4, 1);
      const f = new BQ(sr, 'lp', rr(rng, 70, 140), 0.9);
      for (let i = 0; i < m && i0 + i < d.length; i++) {
        const tt = i / sr;
        d[i0 + i] += f.run(rng() * 2 - 1) * a * 2.2 * (tt < 0.12 ? tt / 0.12 : Math.exp(-(tt - 0.12) / 0.7));
      }
      t += rr(rng, 0.8, 3);
    }
  }, 0.1);
}

function fogBed(rng: Rng, sr: number): Gen {
  return makeLoop(sr, 16, 3, 1, ([d]) => {
    const pink = new Pink(rng);
    const air = new BQ(sr, 'lp', 320, 0.6);
    const r1 = new BQ(sr, 'bp', 140, 22);
    const r2 = new BQ(sr, 'bp', 211, 26);
    const r3 = new BQ(sr, 'bp', 297, 30);
    const m1 = new Wander(rng, sr, 4.5, 0, 1);
    const m2 = new Wander(rng, sr, 6, 0, 1);
    const amp = new Wander(rng, sr, 5, 0.4, 1);
    for (let i = 0; i < d.length; i++) {
      const a = m1.next(), b = m2.next(), g = amp.next();
      if ((i & 63) === 0) {
        r1.set('bp', 136 + 10 * a, 22);
        r2.set('bp', 205 + 14 * b, 26);
        r3.set('bp', 290 + 16 * a * b, 30);
      }
      const w = rng() * 2 - 1;
      d[i] = air.run(pink.next()) * 0.5 * g + (r1.run(w) * (1 - b) + r2.run(w) * a + r3.run(w) * 0.5 * b) * 3.2 * g;
    }
  }, 0.1);
}

// ---------------------------------------------------------------------------
// Events: birds & insects (day)
// ---------------------------------------------------------------------------

function birdChirps(rng: Rng, sr: number): Gen {
  const d = new Float32Array(Math.round(sr * 1.4));
  const n = 2 + Math.floor(rng() * 4);
  const sc = rr(rng, 0.88, 1.12);
  const chevron = rng() < 0.5;
  let t = 0.01;
  for (let k = 0; k < n; k++) {
    const dur = rr(rng, 0.035, 0.075);
    const hi = rr(rng, 5200, 6800) * sc, lo = rr(rng, 2800, 3700) * sc;
    const shape = rr(rng, 0.6, 1.6);
    const f = chevron ? (u: number) => lo + (hi - lo) * Math.sin(Math.PI * Math.pow(u, 0.7)) : (u: number) => lo + (hi - lo) * Math.pow(1 - u, shape);
    tone(d, sr, t, dur, f, (u) => win(u, 0.15, 0.4), rr(rng, 0.6, 1), 0.08);
    t += dur + rr(rng, 0.05, 0.14);
  }
  return finishEvent(sr, [d]);
}

function birdTrill(rng: Rng, sr: number): Gen {
  const len = rr(rng, 0.6, 1.3);
  const d = new Float32Array(Math.round(sr * (len + 0.1)));
  const rate = rr(rng, 15, 27);
  const f0 = rr(rng, 3600, 5200);
  const span = rr(rng, 0.15, 0.35);
  const up = rng() < 0.6;
  const n = Math.floor(len * rate);
  for (let k = 0; k < n; k++) {
    const u0 = k / n;
    const fb = f0 * (1 - 0.1 * u0);
    const ed = (1 / rate) * 0.72;
    tone(d, sr, 0.01 + k / rate, ed, (u) => fb * (up ? 1 + span * u : 1 + span * (1 - u)), (u) => win(u, 0.2, 0.35), 0.5 + 0.5 * win(u0, 0.25, 0.4), 0.06);
  }
  return finishEvent(sr, [d]);
}

function birdSong(rng: Rng, sr: number): Gen {
  const d = new Float32Array(Math.round(sr * 1.8));
  const base = rr(rng, 1750, 2350);
  const steps = [1, 9 / 8, 5 / 4, 4 / 3, 3 / 2, 5 / 3, 15 / 8, 2];
  let idx = Math.floor(rng() * 5);
  let prev = base * steps[idx];
  let t = 0.01;
  const n = 4 + Math.floor(rng() * 4);
  for (let k = 0; k < n; k++) {
    idx = clamp(idx + pickOf(rng, [-2, -1, 1, 2, 3, -3]), 0, steps.length - 1);
    const target = base * steps[idx];
    const dur = rr(rng, 0.08, 0.2);
    const from = prev;
    const vib = rng() < 0.3 ? rr(rng, 0.01, 0.025) : 0;
    const vr = rr(rng, 14, 22);
    const slurEnd = k === n - 1 && rng() < 0.5 ? rr(rng, 0.75, 0.9) : 1;
    tone(d, sr, t, dur, (u) => {
      const g = u < 0.22 ? from + (target - from) * (u / 0.22) : target * (1 + (slurEnd - 1) * Math.max(0, (u - 0.5) * 2));
      return g * (1 + vib * Math.sin(TAU * vr * u * dur));
    }, (u) => win(u, 0.12, 0.3), rr(rng, 0.6, 1), 0.15, 0.03);
    prev = target;
    t += dur + rr(rng, 0.015, 0.08);
  }
  return finishEvent(sr, [d]);
}

function birdFeeBee(rng: Rng, sr: number): Gen {
  const d = new Float32Array(Math.round(sr * 1.1));
  const sc = rr(rng, 0.94, 1.06);
  const a = 3950 * sc, b = 3320 * sc;
  tone(d, sr, 0.01, 0.28, (u) => a * (1 - 0.025 * u), (u) => win(u, 0.15, 0.3), 1, 0.04);
  tone(d, sr, 0.36, 0.34, (u) => b * (1 - 0.03 * Math.sin(Math.PI * u)), (u) => win(u, 0.12, 0.35), 0.85, 0.04);
  if (rng() < 0.35) tone(d, sr, 0.74, 0.26, (u) => b * 0.99, (u) => win(u, 0.12, 0.4), 0.6, 0.04);
  return finishEvent(sr, [d]);
}

function birdDove(rng: Rng, sr: number): Gen {
  const d = new Float32Array(Math.round(sr * 2.4));
  const f0 = rr(rng, 470, 600);
  const notes: [number, number, number, number][] = [[0.02, 0.2, 0.92, 1.05], [0.32, 0.55, 1.05, 0.95], [1.0, 0.28, 0.98, 0.94], [1.4, 0.3, 0.96, 0.92]];
  const bp = new BQ(sr, 'bp', f0 * 1.2, 2);
  for (const [t, dur, s, e] of notes) {
    tone(d, sr, t, dur, (u) => f0 * (s + (e - s) * u + 0.05 * Math.sin(Math.PI * u)), (u) => win(u, 0.25, 0.4), 0.8, 0.3, 0.12);
    const i0 = Math.round(t * sr), m = Math.round(dur * sr);
    for (let i = 0; i < m; i++) d[i0 + i] += bp.run(rng() * 2 - 1) * 0.08 * win(i / m, 0.25, 0.4);
  }
  return finishEvent(sr, [d]);
}

function birdWarbler(rng: Rng, sr: number): Gen {
  const d = new Float32Array(Math.round(sr * 1.6));
  const n = 7 + Math.floor(rng() * 5);
  let t = 0.01;
  const sc = rr(rng, 0.9, 1.1);
  for (let k = 0; k < n; k++) {
    const dur = 0.075 - (0.04 * k) / n;
    tone(d, sr, t, dur, (u) => sc * (2800 + 2600 * u), (u) => win(u, 0.2, 0.3), 0.5 + (0.5 * k) / n, 0.05);
    t += dur + 0.025;
  }
  for (let k = 0; k < 2; k++) {
    tone(d, sr, t + 0.03, 0.11, (u) => sc * (5200 - 2300 * u), (u) => win(u, 0.15, 0.3), 1, 0.05);
    t += 0.15;
  }
  return finishEvent(sr, [d]);
}

function birdCrow(rng: Rng, sr: number): Gen {
  const d = new Float32Array(Math.round(sr * 1.8));
  const n = 2 + Math.floor(rng() * 2);
  const f1 = new BQ(sr, 'bp', 1150, 4), f2 = new BQ(sr, 'bp', 2250, 5), f3 = new BQ(sr, 'bp', 3300, 6);
  const lp = new BQ(sr, 'lp', 3400, 0.7);
  let t = 0.02;
  const p0 = rr(rng, 480, 580);
  for (let k = 0; k < n; k++) {
    const dur = rr(rng, 0.22, 0.32);
    const i0 = Math.round(t * sr), m = Math.round(dur * sr);
    let ph = 0;
    for (let i = 0; i < m; i++) {
      const u = i / m;
      const f = p0 * (1.05 - 0.15 * u) * (1 + 0.02 * (rng() - 0.5));
      ph = (ph + f / sr) % 1;
      const src = (2 * ph - 1) * 0.7 + (rng() * 2 - 1) * 0.5;
      const v = f1.run(src) + 0.8 * f2.run(src) + 0.4 * f3.run(src);
      d[i0 + i] += lp.run(v) * win(u, 0.08, 0.35);
    }
    t += dur + rr(rng, 0.2, 0.38);
  }
  return finishEvent(sr, [d]);
}

function woodpecker(rng: Rng, sr: number): Gen {
  const d = new Float32Array(Math.round(sr * 1.6));
  const n = 13 + Math.floor(rng() * 8);
  const rate = rr(rng, 15, 21);
  const fc = rr(rng, 900, 1500);
  const res = rr(rng, 420, 650);
  for (let k = 0; k < n; k++) {
    const t = 0.01 + (k / rate) * (1 + 0.012 * k);
    const a = 1 - (0.5 * k) / n;
    burst(d, sr, rng, t, a, 0.0004, 0.0018, new BQ(sr, 'bp', fc, 3));
    tone(d, sr, t, 0.03, () => res, (u) => Math.exp(-u * 6), 0.45 * a);
  }
  return finishEvent(sr, [d]);
}

function flyby(rng: Rng, sr: number): Gen {
  const len = rr(rng, 2.4, 3.2);
  const d = new Float32Array(Math.round(sr * len));
  const f0 = rr(rng, 170, 240);
  const bp = new BQ(sr, 'bp', 900, 0.8);
  const hp = new BQ(sr, 'hp', 250, 0.7);
  const jit = new Wander(rng, sr, 0.06, -1, 1);
  const tp = len * rr(rng, 0.42, 0.55);
  let ph = 0;
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    const dop = 1 + 0.045 * Math.tanh((tp - t) * 2.5);
    const f = f0 * dop * (1 + 0.03 * jit.next());
    ph = (ph + f / sr) % 1;
    const saw = 2 * ph - 1;
    const q = (t - tp) * 2.2;
    const near = 1 / (1 + q * q);
    d[i] = hp.run(bp.run(saw)) * near * win(t / len, 0.1, 0.15);
  }
  return finishEvent(sr, [d], 0.8);
}

// ---------------------------------------------------------------------------
// Events: night
// ---------------------------------------------------------------------------

function cricketSolo(rng: Rng, sr: number): Gen {
  const len = rr(rng, 2.5, 4);
  const d = new Float32Array(Math.round(sr * len));
  const fc = rr(rng, 4000, 4900);
  const period = rr(rng, 0.35, 0.6);
  const pulses = 3 + Math.floor(rng() * 3);
  const pl = rr(rng, 0.013, 0.019), pg = rr(rng, 0.014, 0.02);
  for (let t = 0.02; t < len - 0.3; t += period * rr(rng, 0.96, 1.04)) {
    for (let k = 0; k < pulses; k++) tone(d, sr, t + k * (pl + pg), pl, (u) => fc * (1 - 0.03 * u), (u) => { const x = Math.sin(Math.PI * u); return x * Math.sqrt(x); }, 1, 0.15);
  }
  return finishEvent(sr, [d], 0.7);
}

function owl(rng: Rng, sr: number, variation: number): Gen {
  const d = new Float32Array(Math.round(sr * 3.2));
  const f0 = rr(rng, 330, 420);
  const lp = new BQ(sr, 'lp', 1100, 0.7);
  const note = (t: number, dur: number, s: number, e: number, a: number, vib = 0) => {
    tone(d, sr, t, dur, (u) => f0 * (s + (e - s) * u) * (1 + vib * Math.sin(TAU * 7 * u * dur) * Math.min(1, u * 3)), (u) => win(u, 0.18, 0.4), a, 0.12, 0.04);
    burst(d, sr, rng, t, 0.025 * a, dur * 0.2, dur * 0.4, new BQ(sr, 'bp', f0 * 2, 1.5));
  };
  if (variation % 2 === 0) {
    // great-horned style: hoo, h'hoo — hoo — hoo
    note(0.02, 0.3, 0.97, 1.0, 0.9);
    note(0.45, 0.16, 0.98, 1.02, 0.6);
    note(0.64, 0.42, 1.03, 0.97, 1);
    note(1.25, 0.34, 1.0, 0.96, 0.8);
    note(1.78, 0.38, 0.99, 0.94, 0.7);
  } else {
    // tawny style: hooo … hu, hu-hooooo (vibrato)
    note(0.02, 0.55, 1.05, 1.0, 1);
    note(1.05, 0.12, 0.95, 1.0, 0.45);
    note(1.25, 0.12, 0.97, 1.02, 0.5);
    note(1.42, 1.1, 1.06, 0.96, 0.9, 0.02);
  }
  for (let i = 0; i < d.length; i++) d[i] = lp.run(d[i]);
  return finishEvent(sr, [d], 0.8);
}

function dogFar(rng: Rng, sr: number): Gen {
  const d = new Float32Array(Math.round(sr * 3.2));
  const n = 2 + Math.floor(rng() * 3);
  const ps = rr(rng, 0.85, 1.15);
  const F = [new BQ(sr, 'bp', 700 * ps, 5), new BQ(sr, 'bp', 1150 * ps, 6), new BQ(sr, 'bp', 2300 * ps, 8)];
  let t = 0.02;
  for (let k = 0; k < n; k++) {
    const dur = rr(rng, 0.11, 0.16);
    const i0 = Math.round(t * sr), m = Math.round(dur * sr);
    let ph = 0;
    for (let i = 0; i < m; i++) {
      const u = i / m;
      const f = ps * (u < 0.2 ? 340 + 240 * (u / 0.2) : 580 - 270 * ((u - 0.2) / 0.8));
      ph = (ph + f / sr) % 1;
      const src = (2 * ph - 1) + (rng() * 2 - 1) * 0.35;
      const v = F[0].run(src) + 0.7 * F[1].run(src) + 0.25 * F[2].run(src);
      d[i0 + i] += v * win(u, 0.06, 0.4);
    }
    t += dur + rr(rng, 0.22, 0.45);
  }
  // distance: low-pass + a faint echo off the far side of the valley
  const lp = new BQ(sr, 'lp', 1400, 0.7);
  for (let i = 0; i < d.length; i++) d[i] = lp.run(d[i]);
  const ed = Math.round(rr(rng, 0.35, 0.6) * sr);
  const elp = new LP1(sr, 700);
  for (let i = d.length - 1; i >= ed; i--) d[i] += d[i - ed] * 0.22;
  for (let i = 0; i < d.length; i++) d[i] = d[i] * 0.85 + elp.run(d[i]) * 0.15;
  return finishEvent(sr, [d], 0.8);
}

function frog(rng: Rng, sr: number, variation: number): Gen {
  const d = new Float32Array(Math.round(sr * 1.8));
  if (variation === 2) {
    // spring-peeper style peeps
    const n = 3 + Math.floor(rng() * 4);
    const f0 = rr(rng, 2500, 3100);
    for (let k = 0; k < n; k++) tone(d, sr, 0.02 + k * rr(rng, 0.22, 0.3), 0.1, (u) => f0 * (0.9 + 0.15 * u), (u) => win(u, 0.2, 0.3), 1, 0.05);
    return finishEvent(sr, [d], 0.8);
  }
  const res = rr(rng, 450, 900);
  const reps = 1 + Math.floor(rng() * 3);
  for (let r = 0; r < reps; r++) {
    const t0 = 0.02 + r * rr(rng, 0.4, 0.55);
    const pulses = 8 + Math.floor(rng() * 10);
    const pr = rr(rng, 45, 80);
    for (let k = 0; k < pulses; k++) {
      const u = k / pulses;
      const a = Math.sin(Math.PI * Math.min(1, u * 1.3 + 0.1)) * 0.9 + 0.1;
      tone(d, sr, t0 + k / pr, 0.022, () => res * (1 + 0.1 * u), (v) => Math.exp(-v * 5) * Math.min(1, v * 20), a, 0.3);
      burst(d, sr, rng, t0 + k / pr, 0.15 * a, 0.0005, 0.003, new BQ(sr, 'bp', res * 2, 2));
    }
  }
  return finishEvent(sr, [d], 0.8);
}

// ---------------------------------------------------------------------------
// Events: water & weather
// ---------------------------------------------------------------------------

function drip(rng: Rng, sr: number, variation: number): Gen {
  const d = new Float32Array(Math.round(sr * 0.6));
  if (variation % 3 === 2) {
    // patter on a hard surface: a few brittle ticks with a tinny ring
    const n = 3 + Math.floor(rng() * 5);
    const ring = rr(rng, 2400, 4200);
    for (let k = 0; k < n; k++) {
      const t = 0.005 + rng() * 0.25;
      const a = rr(rng, 0.3, 1);
      burst(d, sr, rng, t, a, 0.0003, 0.0012, new BQ(sr, 'hp', 2500, 0.7));
      tone(d, sr, t, 0.04, () => ring * rr(rng, 0.97, 1.03), (u) => Math.exp(-u * 7), 0.25 * a);
    }
  } else {
    // a single drop into a puddle: tick + rising bubble "plink"
    const f0 = rr(rng, 900, 2600);
    burst(d, sr, rng, 0.004, 0.6, 0.0003, 0.0008, new BQ(sr, 'hp', 3000, 0.7));
    tone(d, sr, 0.006, rr(rng, 0.03, 0.07), (u) => f0 * (1 + 0.6 * u * u), (u) => (u < 0.04 ? u / 0.04 : Math.exp(-(u - 0.04) * 5)), 1);
    if (rng() < 0.4) tone(d, sr, 0.09 + rng() * 0.1, 0.03, (u) => f0 * 1.3 * (1 + 0.5 * u), (u) => (u < 0.05 ? u / 0.05 : Math.exp(-(u - 0.05) * 6)), 0.35);
  }
  return finishEvent(sr, [d], 0.8);
}

function plop(rng: Rng, sr: number): Gen {
  const d = new Float32Array(Math.round(sr * 1.2));
  const f0 = rr(rng, 260, 520);
  tone(d, sr, 0.01, 0.09, (u) => f0 * (1 + 0.9 * u), (u) => (u < 0.05 ? u / 0.05 : Math.exp(-(u - 0.05) * 4)), 1);
  burst(d, sr, rng, 0.012, 0.35, 0.004, 0.05, new BQ(sr, 'bp', 1800, 0.8));
  for (let k = 0; k < 6; k++) {
    const f = rr(rng, 900, 2400);
    tone(d, sr, 0.08 + rng() * 0.5, 0.02, (u) => f * (1 + 0.4 * u), (u) => (u < 0.08 ? u / 0.08 : Math.exp(-(u - 0.08) * 6)), rr(rng, 0.05, 0.2));
  }
  return finishEvent(sr, [d], 0.8);
}

function foghorn(rng: Rng, sr: number, variation: number): Gen {
  const len = 7.5;
  const d = new Float32Array(Math.round(sr * len));
  const f0 = rr(rng, 82, 110);
  const blast = (t0: number, dur: number, f: number, a: number) => {
    const i0 = Math.round(t0 * sr), m = Math.round((dur + 0.6) * sr);
    const H = 14;
    const phs = new Float64Array(H);
    const amps = new Float64Array(H);
    for (let k = 1; k <= H; k++) amps[k - 1] = Math.pow(k, -0.7) * Math.exp((-k * f) / 520);
    let grunt = 1, env = 0;
    for (let i = 0; i < m && i0 + i < d.length; i++) {
      if ((i & 15) === 0) {
        const t = i / sr;
        grunt = t > dur - 0.35 ? 1 - 0.16 * Math.min(1, (t - (dur - 0.35)) / 0.35) : 1;
        env = (t < 0.35 ? 0.5 - 0.5 * Math.cos((Math.PI * t) / 0.35) : 1) * (t > dur ? Math.exp(-(t - dur) / 0.12) : 1) * (t > dur - 0.35 ? 0.6 + 0.4 * grunt : 1);
      }
      let v = 0;
      const base = (TAU * f * grunt) / sr;
      for (let k = 0; k < H; k++) {
        phs[k] += base * (k + 1) * (1 + 0.0015 * (k + 1));
        v += Math.sin(phs[k]) * amps[k];
      }
      d[i0 + i] += v * env * a;
    }
  };
  if (variation % 2 === 0) blast(0.05, 2.6, f0, 1);
  else { blast(0.05, 1.5, f0 * 1.26, 0.9); blast(1.6, 1.8, f0, 1); }
  // distant reflections across the water
  const echo = (delay: number, g: number, fc: number) => {
    const ed = Math.round(delay * sr);
    const lp = new BQ(sr, 'lp', fc, 0.7);
    const src = d.slice();
    for (let i = ed; i < d.length; i++) d[i] += lp.run(src[i - ed]) * g;
  };
  echo(0.85, 0.32, 500);
  echo(1.9, 0.16, 380);
  const lp = new BQ(sr, 'lp', 900, 0.7);
  for (let i = 0; i < d.length; i++) d[i] = lp.run(d[i]);
  return finishEvent(sr, [d], 0.85);
}

function bell(rng: Rng, sr: number): Gen {
  const d = new Float32Array(Math.round(sr * 4.5));
  const f0 = rr(rng, 290, 440);
  const parts: [number, number, number][] = [[0.5, 0.5, 3.5], [1, 1, 2.6], [1.19, 0.5, 2], [1.5, 0.35, 1.5], [2.0, 0.4, 1.2], [2.74, 0.2, 0.8], [3.4, 0.12, 0.5]];
  const strikes = rng() < 0.5 ? [0.02] : [0.02, rr(rng, 0.7, 1.1)];
  for (const s of strikes) {
    for (const [r, a, tau] of parts) {
      const fr = f0 * r * rr(rng, 0.998, 1.002);
      const len = Math.min(4.4 - s, tau * 4);
      tone(d, sr, s, len, () => fr, (u) => Math.min(1, u * 400) * Math.exp((-u * len) / tau), a * (s > 0.1 ? 0.7 : 1));
    }
  }
  const lp = new BQ(sr, 'lp', 2200, 0.7);
  for (let i = 0; i < d.length; i++) d[i] = lp.run(d[i]);
  return finishEvent(sr, [d], 0.8);
}

// ---------------------------------------------------------------------------
// Events: distant battle & thunder
// ---------------------------------------------------------------------------

function boomFar(rng: Rng, sr: number): Gen {
  const d = new Float32Array(Math.round(sr * 4));
  const size = rng();
  tone(d, sr, 0.01, 0.6 + 0.4 * size, (u) => 58 - 28 * Math.sqrt(u), (u) => Math.min(1, u * 60) * Math.exp(-u * 4.5), 1);
  const lp = new BQ(sr, 'lp', 260, 0.8);
  {
    const m = Math.round(2.4 * sr);
    for (let i = 0; i < m; i++) {
      const t = i / sr;
      d[i] += lp.run(rng() * 2 - 1) * 2.2 * (t < 0.03 ? t / 0.03 : Math.exp(-(t - 0.03) / (0.35 + 0.5 * size)));
    }
  }
  // rolling echoes off terrain
  const ne = 2 + Math.floor(rng() * 3);
  for (let k = 0; k < ne; k++) {
    const t0 = rr(rng, 0.25, 1.6);
    const f = new BQ(sr, 'lp', rr(rng, 90, 180), 0.8);
    const i0 = Math.round(t0 * sr), m = Math.round(1.6 * sr), a = rr(rng, 0.3, 0.8) * (1 - t0 / 2.5);
    for (let i = 0; i < m && i0 + i < d.length; i++) {
      const t = i / sr;
      d[i0 + i] += f.run(rng() * 2 - 1) * a * 2 * (t < 0.08 ? t / 0.08 : Math.exp(-(t - 0.08) / 0.4));
    }
  }
  return finishEvent(sr, [d], 0.9);
}

function mgFar(rng: Rng, sr: number): Gen {
  const d = new Float32Array(Math.round(sr * 2.6));
  const bursts = rng() < 0.5 ? 1 : 2;
  let t = 0.02;
  for (let b = 0; b < bursts; b++) {
    const n = 5 + Math.floor(rng() * 9);
    const rate = rr(rng, 8, 12.5);
    for (let k = 0; k < n; k++) {
      const a = rr(rng, 0.6, 1);
      burst(d, sr, rng, t, a, 0.0008, 0.006, new BQ(sr, 'lp', 900, 0.8));
      tone(d, sr, t, 0.05, (u) => 140 - 60 * u, (u) => Math.min(1, u * 40) * Math.exp(-u * 6), 0.5 * a);
      t += (1 / rate) * rr(rng, 0.93, 1.07);
    }
    t += rr(rng, 0.25, 0.6);
  }
  const lp = new BQ(sr, 'lp', 1100, 0.7);
  const e = new LP1(sr, 300);
  const ed = Math.round(0.21 * sr);
  const src = d.slice();
  for (let i = 0; i < d.length; i++) d[i] = lp.run(d[i] + (i >= ed ? e.run(src[i - ed]) * 0.5 : 0));
  return finishEvent(sr, [d], 0.9);
}

function thunderCrack(rng: Rng, sr: number): Gen {
  const d = new Float32Array(Math.round(sr * 2.2));
  const tc = rr(rng, 0.08, 0.22);
  // tearing lead-in: a flurry of impulses accelerating into the main crack
  const nPre = 25 + Math.floor(rng() * 40);
  for (let k = 0; k < nPre; k++) {
    const u = Math.pow(rng(), 0.6);
    burst(d, sr, rng, u * tc, rr(rng, 0.15, 0.6) * (0.3 + 0.7 * u), 0.0002, rr(rng, 0.0004, 0.002), new BQ(sr, 'hp', rr(rng, 900, 3000), 0.7));
  }
  // main crack + boom
  burst(d, sr, rng, tc, 1.6, 0.0008, 0.035, new BQ(sr, 'lp', 11000, 0.6), 0.6);
  burst(d, sr, rng, tc, 0.7, 0.002, 0.22, new BQ(sr, 'lp', 3500, 0.6), 1.6);
  tone(d, sr, tc, 1.2, (u) => 85 - 50 * Math.sqrt(u), (u) => Math.min(1, u * 100) * Math.exp(-u * 4), 1.1);
  // sizzle
  {
    const hp = new BQ(sr, 'hp', 2200, 0.7);
    const i0 = Math.round(tc * sr), m = Math.round(1.5 * sr);
    let g = 0;
    for (let i = 0; i < m && i0 + i < d.length; i++) {
      if (rng() < 0.01) g = rr(rng, 0.3, 1);
      g *= 0.996;
      d[i0 + i] += hp.run(rng() * 2 - 1) * g * 0.35 * Math.exp(-i / sr / 0.45);
    }
  }
  for (let i = 0; i < d.length; i++) d[i] = Math.tanh(d[i] * 1.6) / 1.2;
  return finishEvent(sr, [d], 0.95);
}

function thunderRoll(rng: Rng, sr: number): Gen {
  const len = 10;
  const L = new Float32Array(Math.round(sr * len));
  const R = new Float32Array(L.length);
  const bl = new Brown(rng), br = new Brown(rng);
  const fl = new BQ(sr, 'lp', 600, 0.8), fr = new BQ(sr, 'lp', 600, 0.8);
  const flutterL = new Wander(rng, sr, 0.09, 0.55, 1), flutterR = new Wander(rng, sr, 0.09, 0.55, 1);
  const cw = new Wander(rng, sr, 1.2, 0, 1);
  // rolls: onset, attack, decay, left gain, right gain (equal-power pan)
  const rolls: [number, number, number, number, number][] = [];
  const nr = 6 + Math.floor(rng() * 5);
  for (let k = 0; k < nr; k++) {
    const t0 = k === 0 ? 0 : Math.pow(rng(), 1.3) * 6.5;
    const amp = (k === 0 ? 1 : rr(rng, 0.35, 1)) * Math.pow(1 - t0 / 9, 1.3);
    const th = ((rr(rng, -0.85, 0.85) + 1) * Math.PI) / 4;
    rolls.push([t0, rr(rng, 0.06, 0.45), rr(rng, 0.5, 1.9), amp * Math.cos(th), amp * Math.sin(th)]);
  }
  let gl0 = 0, gr0 = 0, gl1 = 0, gr1 = 0;
  for (let i = 0; i < L.length; i++) {
    const t = i / sr;
    if ((i & 63) === 0) {
      const fc = (520 - 300 * Math.min(1, t / 7)) * (0.75 + 0.5 * cw.next());
      fl.set('lp', fc, 0.8);
      fr.set('lp', fc * 1.05, 0.8);
    } else cw.next();
    if ((i & 31) === 0) {
      // roll envelopes at control rate (they are smooth), interpolated over the next 32 samples
      const env = (tq: number): [number, number] => {
        let l = 0, r = 0;
        for (const [t0, a, dk, al, ar] of rolls) {
          if (tq < t0) continue;
          const tt = tq - t0;
          const e = tt < a ? 0.5 - 0.5 * Math.cos((Math.PI * tt) / a) : Math.exp(-(tt - a) / dk);
          l += e * al;
          r += e * ar;
        }
        const fade = tq > len - 1.5 ? Math.max(0, (len - tq) / 1.5) : 1;
        return [l * fade, r * fade];
      };
      [gl0, gr0] = env(t);
      [gl1, gr1] = env(t + 32 / sr);
    }
    const k = (i & 31) / 32;
    L[i] = fl.run(bl.next()) * (gl0 + (gl1 - gl0) * k) * flutterL.next();
    R[i] = fr.run(br.next()) * (gr0 + (gr1 - gr0) * k) * flutterR.next();
  }
  return finishEvent(sr, [L, R], 0.9);
}

// ---------------------------------------------------------------------------
// Environment-reverb impulse responses
// ---------------------------------------------------------------------------

export interface EnvIrSpec {
  len: number;
  t60: number;
  bright0: number;
  bright1: number;
  pre: number;
  /** Discrete terrain echoes: [delay s, gain]. */
  echoes: [number, number][];
}

/** Mono exponentially-decaying filtered noise with early reflections and smeared distant echoes. */
export function envImpulse(sr: number, s: EnvIrSpec, seed = 1): Float32Array {
  const rng = mulberry32(0x5eed ^ seed);
  const len = Math.floor(s.len * sr);
  const d = new Float32Array(len);
  const pre = Math.floor(s.pre * sr);
  const ratio = s.bright1 / s.bright0;
  let y = 0, a = 0, comp = 0, env = 0;
  const lr = Math.log(ratio) / s.len;
  const dk = Math.exp(-6.9 / s.t60 / sr);
  for (let i = pre; i < len; i++) {
    const t = (i - pre) / sr;
    if (((i - pre) & 31) === 0) {
      // filter coefficient & loudness compensation at control rate
      const fc = s.bright0 * Math.exp(lr * t);
      a = 1 - Math.exp((-TAU * fc) / sr);
      comp = Math.sqrt(1 / Math.max(a, 0.02)) * 0.25;
      env = Math.exp((-6.9 * t) / s.t60);
    } else env *= dk;
    y += a * (rng() * 2 - 1 - y);
    // slow build-up (diffuse field arriving) then exponential decay
    d[i] = y * env * comp * Math.min(1, 0.25 + t / 0.06);
  }
  for (let e = 0; e < 4; e++) {
    const idx = Math.floor((s.pre + 0.004 + rng() * 0.05) * sr);
    if (idx < len) d[idx] += (rng() < 0.5 ? -1 : 1) * (0.35 - e * 0.05);
  }
  for (const [et, eg] of s.echoes) {
    const start = Math.floor(et * sr);
    const w = Math.floor(0.03 * sr);
    let z = 0;
    for (let i = 0; i < w && start + i < len; i++) {
      z += 0.12 * (rng() * 2 - 1 - z);
      d[start + i] += z * eg * 4 * Math.sin((Math.PI * i) / w);
    }
  }
  const fo = Math.floor(0.08 * sr);
  for (let i = 0; i < fo && i < len; i++) d[len - 1 - i] *= i / fo;
  return d;
}

// ---------------------------------------------------------------------------
// Bank registry
// ---------------------------------------------------------------------------

export type LoopKey = 'wind' | 'snowWind' | 'howl' | 'leaves' | 'insects' | 'crickets' | 'water' | 'rain' | 'rainHeavy' | 'fogDrone' | 'rumble';
export type EventKey =
  | 'bird_chirp' | 'bird_trill' | 'bird_song' | 'bird_feebee' | 'bird_dove' | 'bird_warbler' | 'bird_crow' | 'woodpecker' | 'flyby'
  | 'cricket' | 'owl' | 'dog' | 'frog' | 'drip' | 'plop' | 'foghorn' | 'bell' | 'boom_far' | 'mg_far' | 'thunder_crack' | 'thunder_roll';
export type BankKey = LoopKey | EventKey;

interface GenSpec { vars: number; make: (rng: Rng, variation: number) => Gen }

export const GENERATORS: Record<BankKey, GenSpec> = {
  wind: { vars: 1, make: (r) => windBed(r, 16000, false) },
  snowWind: { vars: 1, make: (r) => windBed(r, 12000, true) },
  howl: { vars: 1, make: (r) => howlBed(r, 22050) },
  leaves: { vars: 1, make: (r) => leavesBed(r, 22050) },
  insects: { vars: 1, make: (r) => insectBed(r, 32000) },
  crickets: { vars: 1, make: (r) => cricketBed(r, 24000) },
  water: { vars: 1, make: (r) => waterBed(r, 22050) },
  rain: { vars: 1, make: (r) => rainBed(r, 32000) },
  rainHeavy: { vars: 1, make: (r) => rainHeavyBed(r, 24000) },
  fogDrone: { vars: 1, make: (r) => fogBed(r, 11025) },
  rumble: { vars: 1, make: (r) => rumbleBed(r, 8000) },
  bird_chirp: { vars: 4, make: (r) => birdChirps(r, 32000) },
  bird_trill: { vars: 3, make: (r) => birdTrill(r, 32000) },
  bird_song: { vars: 4, make: (r) => birdSong(r, 24000) },
  bird_feebee: { vars: 2, make: (r) => birdFeeBee(r, 24000) },
  bird_dove: { vars: 2, make: (r) => birdDove(r, 16000) },
  bird_warbler: { vars: 2, make: (r) => birdWarbler(r, 32000) },
  bird_crow: { vars: 2, make: (r) => birdCrow(r, 16000) },
  woodpecker: { vars: 2, make: (r) => woodpecker(r, 22050) },
  flyby: { vars: 2, make: (r) => flyby(r, 16000) },
  cricket: { vars: 3, make: (r) => cricketSolo(r, 24000) },
  owl: { vars: 2, make: (r, v) => owl(r, 11025, v) },
  dog: { vars: 2, make: (r) => dogFar(r, 11025) },
  frog: { vars: 3, make: (r, v) => frog(r, 16000, v) },
  drip: { vars: 6, make: (r, v) => drip(r, 32000, v) },
  plop: { vars: 3, make: (r) => plop(r, 22050) },
  foghorn: { vars: 2, make: (r, v) => foghorn(r, 8000, v) },
  bell: { vars: 2, make: (r) => bell(r, 11025) },
  boom_far: { vars: 5, make: (r) => boomFar(r, 8000) },
  mg_far: { vars: 3, make: (r) => mgFar(r, 11025) },
  thunder_crack: { vars: 3, make: (r) => thunderCrack(r, 32000) },
  thunder_roll: { vars: 3, make: (r) => thunderRoll(r, 11025) },
};

/** Render one bank item as raw PCM (deterministic per key, variation and seed). Worker-safe. */
export function renderGen(key: BankKey, variation: number, seed: number): Gen {
  return GENERATORS[key].make(mulberry32((hashStr(key) ^ Math.imul(variation + 1, 0x9e3779b1) ^ seed) >>> 0), variation);
}

/** Wrap rendered PCM in an AudioBuffer (main thread). */
export function genToBuffer(g: Gen): AudioBuffer {
  const buf = makeBuffer(g.ch.length, g.ch[0].length, g.sr);
  g.ch.forEach((d, i) => buf.getChannelData(i).set(d));
  return buf;
}

/** Render one bank item into an AudioBuffer on the calling thread. */
export function renderBankItem(key: BankKey, variation: number, seed: number): AudioBuffer {
  return genToBuffer(renderGen(key, variation, seed));
}
