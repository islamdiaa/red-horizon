/**
 * Tiny graph-building toolkit used by the SFX recipes. A `Synth` wraps a BaseAudioContext
 * (normally an OfflineAudioContext) plus an output node and a seeded RNG, and offers
 * oscillators, noise sources, filters, envelopes and a handful of reusable sound "layers"
 * (thump, crack, noise blast, debris grains, metallic partials, formant voice, crackle).
 */
import { fuzzCurve, impulseResponse, noiseBuffer, softClipCurve, type IrKind, type NoiseColor, type Rng } from './dsp';

export interface NoiseHitOpts {
  color?: NoiseColor;
  type?: BiquadFilterType;
  f0: number;
  f1?: number;
  sweep?: number;
  q?: number;
  attack?: number;
  tau: number;
  hold?: number;
  level: number;
  drive?: number;
  rate?: number;
}

export type Vowel = 'a' | 'u' | 'e' | 'o' | 'i' | 'scream';
export const VOWELS: Record<Vowel, [number, number, number]> = {
  a: [730, 1090, 2440],
  u: [640, 1190, 2390], // as in "uh"
  e: [530, 1840, 2480],
  o: [570, 840, 2410],
  i: [300, 2200, 2950],
  scream: [920, 1450, 2900],
};

export class Synth {
  readonly sr: number;
  private verbs = new Map<IrKind, ConvolverNode>();

  constructor(readonly ctx: BaseAudioContext, readonly out: AudioNode, readonly rng: Rng) {
    this.sr = ctx.sampleRate;
  }

  /** Uniform random in [a, b). */
  r(a: number, b: number): number { return a + (b - a) * this.rng(); }
  /** v ± pct (relative). */
  vary(v: number, pct: number): number { return v * (1 + (this.rng() * 2 - 1) * pct); }

  gain(v = 1): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = v;
    return g;
  }

  filter(type: BiquadFilterType, freq: number, Q = 0.707, gainDb = 0): BiquadFilterNode {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = Math.min(freq, this.sr * 0.45);
    f.Q.value = Q;
    f.gain.value = gainDb;
    return f;
  }

  shaper(drive: number, kind: 'tanh' | 'fuzz' = 'tanh'): WaveShaperNode {
    const w = this.ctx.createWaveShaper();
    w.curve = kind === 'tanh' ? softClipCurve(drive) : fuzzCurve(drive);
    w.oversample = '4x';
    return w;
  }

  osc(type: OscillatorType, freq: number, t: number, dur: number): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.start(t);
    o.stop(t + dur);
    return o;
  }

  /** Looping noise source starting at a random point of the shared buffer. */
  noise(t: number, dur: number, color: NoiseColor = 'white', rate = 1): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = noiseBuffer(this.sr, color);
    src.loop = true;
    src.playbackRate.value = rate;
    src.start(t, this.rng() * 3.5);
    src.stop(t + dur);
    return src;
  }

  /** Shared convolution reverb (one per IR kind) feeding the output. Returns its input. */
  reverb(kind: IrKind): AudioNode {
    let c = this.verbs.get(kind);
    if (!c) {
      c = this.ctx.createConvolver();
      c.buffer = impulseResponse(this.sr, kind, 1);
      c.connect(this.out);
      this.verbs.set(kind, c);
    }
    return c;
  }

  /** Send `node` to a reverb with the given wet gain. */
  send(node: AudioNode, kind: IrKind, wet: number): void {
    const g = this.gain(wet);
    node.connect(g);
    g.connect(this.reverb(kind));
  }

  chain(...nodes: AudioNode[]): AudioNode {
    for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
    return nodes[nodes.length - 1];
  }

  // -------------------------------------------------------------------------
  // Envelopes (all click-free: linear attack from 0, exponential decay)
  // -------------------------------------------------------------------------

  /** 0 → peak over `attack`, then exponential decay with time constant `tau` (optionally after `hold`). */
  perc(p: AudioParam, t: number, peak: number, attack: number, tau: number, hold = 0): number {
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(peak, t + attack);
    if (hold > 0) p.setValueAtTime(peak, t + attack + hold);
    p.setTargetAtTime(0, t + attack + hold, tau);
    return t + attack + hold + tau * 9; // effectively silent by now
  }

  /** Piece-wise linear envelope through [time, value] points (absolute times). */
  lin(p: AudioParam, pts: [number, number][]): void {
    p.setValueAtTime(pts[0][1], pts[0][0]);
    for (let i = 1; i < pts.length; i++) p.linearRampToValueAtTime(pts[i][1], pts[i][0]);
  }

  /** Exponential sweep v0 → v1 between t0 and t1 (values must be > 0). */
  sweep(p: AudioParam, t0: number, v0: number, t1: number, v1: number): void {
    p.setValueAtTime(v0, t0);
    p.exponentialRampToValueAtTime(Math.max(v1, 0.0001), t1);
  }

  /** Random-step modulation (turbulence/jitter) on a param: values in [lo, hi] every `step` s, smoothed. */
  jitter(p: AudioParam, t: number, dur: number, lo: number, hi: number, step: number, glide = 0.4): void {
    p.setValueAtTime(this.r(lo, hi), t);
    for (let tt = t + step; tt < t + dur; tt += step * this.r(0.6, 1.4)) {
      p.setTargetAtTime(this.r(lo, hi), tt, step * glide);
    }
  }

  // -------------------------------------------------------------------------
  // Reusable layers
  // -------------------------------------------------------------------------

  /** Pitched body hit: sine sweeping f0 → f1, percussive envelope, optional saturation for harmonics. */
  thump(dest: AudioNode, t: number, f0: number, f1: number, sweep: number, tau: number, level: number, drive = 0, type: OscillatorType = 'sine'): void {
    const end = t + 0.003 + tau * 9;
    const o = this.osc(type, f0, t, end - t);
    this.sweep(o.frequency, t, f0, t + sweep, f1);
    const env = this.gain(0);
    this.perc(env.gain, t, 1, 0.003, tau);
    const lv = this.gain(level);
    if (drive > 0) this.chain(o, env, this.shaper(drive), lv, dest);
    else this.chain(o, env, lv, dest);
  }

  /** Filtered noise burst with optional filter sweep, hold and saturation. */
  noiseHit(dest: AudioNode, t: number, o: NoiseHitOpts): GainNode {
    const attack = o.attack ?? 0.002;
    const hold = o.hold ?? 0;
    const dur = attack + hold + o.tau * 9 + 0.01;
    const src = this.noise(t, dur, o.color ?? 'white', o.rate ?? 1);
    const f = this.filter(o.type ?? 'lowpass', o.f0, o.q ?? 0.707);
    if (o.f1 !== undefined) this.sweep(f.frequency, t, o.f0, t + (o.sweep ?? 0.2), o.f1);
    const env = this.gain(0);
    this.perc(env.gain, t, 1, attack, o.tau, hold);
    const lv = this.gain(o.level);
    if (o.drive) this.chain(src, f, env, this.shaper(o.drive), lv, dest);
    else this.chain(src, f, env, lv, dest);
    return lv;
  }

  /** Sharp broadband transient (the "crack" of a gun or blast). */
  crack(dest: AudioNode, t: number, level: number, tau: number, hp = 1000, drive = 3): void {
    this.noiseHit(dest, t, { type: 'highpass', f0: hp, q: 0.5, attack: 0.0006, tau, level, drive });
  }

  /** Many tiny band-passed noise grains scattered over [t, t+span] with decaying density/level. */
  grains(dest: AudioNode, t: number, span: number, count: number, o: { fMin: number; fMax: number; q?: number; dMin?: number; dMax?: number; level: number; decay?: number }): void {
    for (let i = 0; i < count; i++) {
      const u = Math.pow(this.rng(), o.decay ?? 1.6); // bias towards the start
      const tt = t + u * span;
      const lvl = o.level * (1 - u * 0.8) * this.r(0.4, 1);
      this.noiseHit(dest, tt, {
        type: 'bandpass',
        f0: this.r(o.fMin, o.fMax),
        q: o.q ?? 2,
        attack: 0.0008,
        tau: this.r(o.dMin ?? 0.002, o.dMax ?? 0.012),
        level: lvl,
      });
    }
  }

  /** Inharmonic metallic partials (clang / bell / anvil). Higher partials decay faster. */
  metal(dest: AudioNode, t: number, base: number, ratios: number[], tau: number, level: number, type: OscillatorType = 'sine'): void {
    ratios.forEach((r, i) => {
      const f = base * r;
      if (f > this.sr * 0.45) return;
      const ptau = tau / (1 + i * 0.45);
      const o = this.osc(type, f * this.r(0.995, 1.005), t, 0.002 + ptau * 9);
      const g = this.gain(0);
      this.perc(g.gain, t, level / (1 + i * 0.35), 0.0015, ptau);
      this.chain(o, g, dest);
    });
  }

  /** Electrical crackle: high-passed noise gated on/off at random short intervals. */
  crackle(dest: AudioNode, t: number, dur: number, level: number, o: { hp?: number; density?: number; minGap?: number; maxGap?: number; fade?: boolean } = {}): void {
    const src = this.noise(t, dur + 0.02);
    const f = this.filter('highpass', o.hp ?? 1500, 0.6);
    const gate = this.gain(0);
    const p = gate.gain;
    p.setValueAtTime(0, t);
    const dens = o.density ?? 0.55;
    let tt = t;
    while (tt < t + dur) {
      const on = this.rng() < dens;
      const fadeK = o.fade === false ? 1 : 1 - ((tt - t) / dur) * 0.7;
      const v = on ? this.r(0.3, 1) * fadeK : 0;
      p.linearRampToValueAtTime(v, tt + 0.0004);
      tt += this.r(o.minGap ?? 0.002, o.maxGap ?? 0.018);
      p.setValueAtTime(v, tt);
    }
    p.linearRampToValueAtTime(0, tt + 0.002);
    const lv = this.gain(level);
    this.chain(src, f, gate, lv, dest);
  }

  /**
   * Formant voice approximation: sawtooth "glottis" with pitch contour + breath noise,
   * through three parallel band-pass formants (optionally morphing between two vowels).
   */
  voice(dest: AudioNode, t: number, dur: number, o: {
    pitch: [number, number][]; // [relative time, Hz]
    vowel: Vowel;
    vowel2?: Vowel;
    level: number;
    breath?: number;
    vibrato?: number; // cents
    vibRate?: number;
    jitter?: number; // cents
    rasp?: number; // shaper drive
    attack?: number;
    release?: number;
    formantScale?: number;
  }): void {
    const end = t + dur + (o.release ?? 0.08) * 9;
    const src = this.osc('sawtooth', o.pitch[0][1], t, end - t);
    src.frequency.setValueAtTime(o.pitch[0][1], t);
    for (let i = 1; i < o.pitch.length; i++) src.frequency.exponentialRampToValueAtTime(o.pitch[i][1], t + o.pitch[i][0]);
    if (o.vibrato) {
      const lfo = this.osc('sine', o.vibRate ?? 6, t, end - t);
      const lg = this.gain(o.vibrato);
      lfo.connect(lg).connect(src.detune);
    }
    if (o.jitter) this.jitter(src.detune, t, dur, -o.jitter, o.jitter, 0.03, 0.5);
    const mix = this.gain(1);
    src.connect(mix);
    if (o.breath) {
      const n = this.noise(t, end - t);
      const ng = this.gain(o.breath);
      this.chain(n, ng, mix);
    }
    const fs = o.formantScale ?? 1;
    const v1 = VOWELS[o.vowel];
    const v2 = VOWELS[o.vowel2 ?? o.vowel];
    const gains = [1, 0.7, 0.45];
    const qs = [7, 10, 14];
    const sum = this.gain(1);
    for (let k = 0; k < 3; k++) {
      const f = this.filter('bandpass', v1[k] * fs, qs[k]);
      if (o.vowel2) {
        f.frequency.setValueAtTime(v1[k] * fs, t);
        f.frequency.linearRampToValueAtTime(v2[k] * fs, t + dur);
      }
      const g = this.gain(gains[k] * (k === 0 ? 1 : 1.6));
      this.chain(mix, f, g, sum);
    }
    const env = this.gain(0);
    const a = o.attack ?? 0.02;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1, t + a);
    env.gain.setValueAtTime(1, t + dur);
    env.gain.setTargetAtTime(0, t + dur, o.release ?? 0.08);
    const lv = this.gain(o.level * 3);
    if (o.rasp) this.chain(sum, env, this.shaper(o.rasp), lv, dest);
    else this.chain(sum, env, lv, dest);
  }
}
