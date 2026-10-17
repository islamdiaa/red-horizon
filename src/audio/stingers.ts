/**
 * Musical stingers: short orchestral-synth phrases (brass, timpani, snare, cymbals, bells, strings)
 * synthesised live in the current key of the score and started on its beat grid, so they sit on top
 * of the (ducked) music instead of clashing with it. Each call builds a few dozen short-lived nodes;
 * the shared hall reverb idles (silent input) between stingers.
 */
import { clamp, impulseResponse, midiToHz, mulberry32, noiseBuffer, type Rng } from './dsp';
import type { StingerKind } from './types';

export type { StingerKind } from './types';

export interface StingerHarmony {
  /** Tonic as a MIDI note (any octave; only the pitch class is used). */
  key: number;
  /** Duration of a 16th note in seconds (music tempo). */
  stepDur: number;
  /** Context time of the first note (normally the next beat of the score). */
  when: number;
}

/** Duck depth (music gain while the stinger plays) and priority. */
export const STINGER_INFO: Record<StingerKind, { duck: number; priority: number }> = {
  victory: { duck: 0.12, priority: 9 },
  defeat: { duck: 0.12, priority: 9 },
  mission_start: { duck: 0.3, priority: 6 },
  superweapon_ready: { duck: 0.35, priority: 5 },
  reinforcements: { duck: 0.4, priority: 4 },
  enemy_spotted: { duck: 0.45, priority: 3 },
  promotion: { duck: 0.5, priority: 2 },
  battle_won: { duck: 0.35, priority: 5 },
  milestone: { duck: 0.4, priority: 4 },
  battle_joined: { duck: 0.55, priority: 3 },
};

interface BrassOpts { bright?: number; attack?: number; release?: number; pan?: number; verb?: number; single?: boolean }

export class StingerEngine {
  private readonly out: GainNode;
  private verbIn: GainNode | null = null;
  private rng: Rng;

  constructor(private readonly ctx: BaseAudioContext, dest: AudioNode, seed = 0x51ce) {
    this.out = ctx.createGain();
    this.out.gain.value = 1.4;
    this.out.connect(dest);
    this.rng = mulberry32(seed);
  }

  private verb(): GainNode {
    if (!this.verbIn) {
      const ctx = this.ctx;
      const conv = ctx.createConvolver();
      try { conv.channelCount = 1; conv.channelCountMode = 'explicit'; } catch { /* keep default */ }
      conv.buffer = impulseResponse(ctx.sampleRate, 'hall', 2);
      const ret = ctx.createGain();
      ret.gain.value = 0.55;
      this.verbIn = ctx.createGain();
      this.verbIn.connect(conv).connect(ret).connect(this.out);
    }
    return this.verbIn;
  }

  // -------------------------------------------------------------------------
  // Instruments
  // -------------------------------------------------------------------------

  private gain(v = 0): GainNode { const g = this.ctx.createGain(); g.gain.value = v; return g; }

  private route(node: AudioNode, pan: number, verb: number): void {
    let o: AudioNode = node;
    if (pan !== 0 && typeof this.ctx.createStereoPanner === 'function') {
      const p = this.ctx.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      node.connect(p);
      o = p;
    }
    o.connect(this.out);
    if (verb > 0) {
      const s = this.gain(verb);
      node.connect(s).connect(this.verb());
    }
  }

  /** Brass section: detuned saws with a "blat" filter envelope and a small pitch scoop. */
  private brass(t: number, midis: number[], dur: number, vel: number, o: BrassOpts = {}): void {
    const ctx = this.ctx;
    const a = o.attack ?? 0.045;
    const rel = o.release ?? 0.22;
    const bright = o.bright ?? 0.7;
    const end = t + dur + rel * 5 + 0.05;
    const e = this.gain(0);
    const lvl = (vel * 0.2) / Math.sqrt(midis.length * (o.single ? 1 : 2));
    e.gain.setValueAtTime(0, t);
    e.gain.linearRampToValueAtTime(lvl, t + a);
    e.gain.setTargetAtTime(lvl * 0.72, t + a, 0.18);
    e.gain.setTargetAtTime(0, t + Math.max(a, dur), rel);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 1.3;
    const peak = 900 + 3600 * bright * clamp(vel, 0.3, 1.2);
    lp.frequency.setValueAtTime(260, t);
    lp.frequency.exponentialRampToValueAtTime(peak, t + a * 1.3 + 0.015);
    lp.frequency.setTargetAtTime(500 + 1700 * bright, t + a * 1.3 + 0.015, 0.16);
    for (const m of midis) {
      const f = midiToHz(m);
      for (const det of o.single ? [0] : [-7, 6]) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = f;
        osc.detune.setValueAtTime(det - 28, t);
        osc.detune.linearRampToValueAtTime(det, t + 0.06);
        osc.connect(lp);
        osc.start(t);
        osc.stop(end);
      }
    }
    lp.connect(e);
    this.route(e, o.pan ?? 0, o.verb ?? 0.35);
  }

  /** Timpani: pitched sine with a slight downward glide, two partials and a felt-mallet thud. */
  private timp(t: number, midi: number, vel: number, tau = 0.5): void {
    const ctx = this.ctx;
    const f = midiToHz(midi);
    const sum = this.gain(1);
    for (const [r, a, tk] of [[1, 1, 1], [1.5, 0.35, 0.5], [1.99, 0.22, 0.35]] as const) {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(f * r * 1.04, t);
      o.frequency.exponentialRampToValueAtTime(f * r, t + 0.12);
      const g = this.gain(0);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(a, t + 0.004);
      g.gain.setTargetAtTime(0, t + 0.004, tau * tk);
      o.connect(g).connect(sum);
      o.start(t);
      o.stop(t + tau * tk * 8 + 0.05);
    }
    const n = ctx.createBufferSource();
    n.buffer = noiseBuffer(ctx.sampleRate, 'pink');
    n.loop = true;
    const nf = ctx.createBiquadFilter();
    nf.type = 'lowpass';
    nf.frequency.value = 900;
    const ng = this.gain(0);
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(0.5, t + 0.002);
    ng.gain.setTargetAtTime(0, t + 0.002, 0.018);
    n.connect(nf).connect(ng).connect(sum);
    n.start(t, this.rng() * 3);
    n.stop(t + 0.2);
    const out = this.gain(vel * 0.32);
    sum.connect(out);
    this.route(out, -0.15, 0.3);
  }

  private timpRoll(t: number, midi: number, dur: number, v0: number, v1: number): void {
    const rate = 18;
    const n = Math.max(1, Math.floor(dur * rate));
    for (let i = 0; i < n; i++) {
      const u = i / Math.max(1, n - 1);
      this.timp(t + i / rate + (this.rng() - 0.5) * 0.008, midi, (v0 + (v1 - v0) * u) * (0.75 + 0.25 * this.rng()), 0.3);
    }
  }

  private noise(t: number, dur: number): AudioBufferSourceNode {
    const n = this.ctx.createBufferSource();
    n.buffer = noiseBuffer(this.ctx.sampleRate, 'white');
    n.loop = true;
    n.start(t, this.rng() * 3.5);
    n.stop(t + dur);
    return n;
  }

  private snare(t: number, vel: number): void {
    const ctx = this.ctx;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2600;
    bp.Q.value = 0.7;
    const g = this.gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel * 0.3, t + 0.002);
    g.gain.setTargetAtTime(0, t + 0.002, 0.07);
    this.noise(t, 0.6).connect(bp).connect(g);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(230, t);
    o.frequency.exponentialRampToValueAtTime(180, t + 0.04);
    const og = this.gain(0);
    og.gain.setValueAtTime(0, t);
    og.gain.linearRampToValueAtTime(vel * 0.25, t + 0.002);
    og.gain.setTargetAtTime(0, t + 0.002, 0.04);
    o.connect(og);
    o.start(t);
    o.stop(t + 0.4);
    const sum = this.gain(1);
    g.connect(sum);
    og.connect(sum);
    this.route(sum, 0.1, 0.25);
  }

  private snareRoll(t: number, dur: number, v0: number, v1: number): void {
    const rate = 24;
    const n = Math.max(1, Math.floor(dur * rate));
    for (let i = 0; i < n; i++) {
      const u = i / Math.max(1, n - 1);
      this.snare(t + i / rate + (this.rng() - 0.5) * 0.006, (v0 + (v1 - v0) * u) * (i % 2 ? 0.8 : 1));
    }
  }

  private cymbal(t: number, vel: number, tau = 1.1): void {
    const ctx = this.ctx;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 5200;
    const g = this.gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel * 0.16, t + 0.003);
    g.gain.setTargetAtTime(0, t + 0.003, tau);
    this.noise(t, tau * 7).connect(hp).connect(g);
    this.route(g, 0.25, 0.3);
  }

  /** Reverse-cymbal swell ending exactly at t + dur. */
  private swell(t: number, dur: number, vel: number): void {
    const ctx = this.ctx;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(2500, t);
    hp.frequency.exponentialRampToValueAtTime(7000, t + dur);
    const g = this.gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel * 0.03, t + dur * 0.5);
    g.gain.exponentialRampToValueAtTime(vel * 0.16, t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.04);
    this.noise(t, dur + 0.1).connect(hp).connect(g);
    this.route(g, -0.2, 0.2);
  }

  private boom(t: number, vel: number): void {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(75, t);
    o.frequency.exponentialRampToValueAtTime(32, t + 0.6);
    const g = this.gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel * 0.55, t + 0.006);
    g.gain.setTargetAtTime(0, t + 0.006, 0.45);
    o.connect(g);
    o.start(t);
    o.stop(t + 3.5);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 170;
    const ng = this.gain(0);
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(vel * 0.7, t + 0.01);
    ng.gain.setTargetAtTime(0, t + 0.01, 0.3);
    this.noise(t, 2.5).connect(lp).connect(ng);
    const sum = this.gain(1);
    g.connect(sum);
    ng.connect(sum);
    this.route(sum, 0, 0.2);
  }

  private bell(t: number, midi: number, vel: number, tau = 1.4, pan = 0.3): void {
    const ctx = this.ctx;
    const f = midiToHz(midi);
    const sum = this.gain(1);
    for (const [r, a, tk] of [[1, 1, 1], [2.0, 0.45, 0.6], [2.76, 0.3, 0.4], [4.07, 0.16, 0.25], [5.4, 0.1, 0.18]] as const) {
      if (f * r > ctx.sampleRate * 0.45) continue;
      const o = ctx.createOscillator();
      o.frequency.value = f * r;
      const g = this.gain(0);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(a, t + 0.002);
      g.gain.setTargetAtTime(0, t + 0.002, tau * tk);
      o.connect(g).connect(sum);
      o.start(t);
      o.stop(t + tau * tk * 8 + 0.05);
    }
    const out = this.gain(vel * 0.12);
    sum.connect(out);
    this.route(out, pan, 0.5);
  }

  /** String section pad (optional tremolo for tension). */
  private strings(t: number, midis: number[], dur: number, vel: number, tremolo = 0, pan = 0): void {
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1700;
    lp.Q.value = 0.6;
    const e = this.gain(0);
    const lvl = (vel * 0.13) / Math.sqrt(midis.length * 2);
    e.gain.setValueAtTime(0, t);
    e.gain.linearRampToValueAtTime(lvl, t + 0.3);
    e.gain.setTargetAtTime(0, t + dur, 0.35);
    const end = t + dur + 2.2;
    for (const m of midis) {
      for (const det of [-10, 9]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midiToHz(m);
        o.detune.value = det;
        o.connect(lp);
        o.start(t);
        o.stop(end);
      }
    }
    let node: AudioNode = lp;
    if (tremolo > 0) {
      const tg = this.gain(1 - tremolo / 2);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 11;
      const lg = this.gain(tremolo / 2);
      lfo.connect(lg).connect(tg.gain);
      lfo.start(t);
      lfo.stop(end);
      lp.connect(tg);
      node = tg;
    }
    node.connect(e);
    this.route(e, pan, 0.5);
  }

  // -------------------------------------------------------------------------
  // Phrases
  // -------------------------------------------------------------------------

  /** Schedule a stinger; returns its length in seconds (from h.when, including the main tail). */
  play(kind: StingerKind, h: StingerHarmony): number {
    const pc = ((Math.round(h.key) % 12) + 12) % 12;
    const R = 50 + ((pc - 2 + 12) % 12); // brass root D3..C#4
    const T = R - 12; // timpani
    const s = clamp(h.stepDur, 0.08, 0.14);
    const b = s * 4;
    const t0 = h.when;
    const TR = R > 55 ? R : R + 12; // trumpet line register
    switch (kind) {
      case 'victory': {
        this.swell(t0, 2 * b, 0.35);
        this.brass(t0, [R - 4, R, R + 3], b * 0.9, 0.8);
        this.brass(t0 + b, [R - 2, R + 2, R + 5], b * 0.9, 0.85);
        this.brass(t0 + 2 * b, [R - 12, R, R + 4, R + 7], b * 3.5, 1, { release: 0.5 });
        this.brass(t0, [TR + 3], b * 0.8, 0.8, { bright: 1, single: true, pan: 0.2 });
        this.brass(t0 + b, [TR + 5], b * 0.8, 0.85, { bright: 1, single: true, pan: 0.2 });
        this.brass(t0 + 2 * b, [TR + 7], b * 0.45, 0.9, { bright: 1, single: true, pan: 0.2 });
        this.brass(t0 + 2.5 * b, [TR + 12], b * 3, 1, { bright: 1, single: true, pan: 0.2, release: 0.5 });
        this.timp(t0, T - 4, 0.8);
        this.timp(t0 + b, T - 2, 0.85);
        this.timp(t0 + 2 * b, T, 1);
        this.timpRoll(t0 + 3 * b, T, 1.5 * b, 0.35, 0.8);
        this.timp(t0 + 4.5 * b, T, 1, 0.8);
        this.cymbal(t0 + 2 * b, 0.8, 1.4);
        this.bell(t0 + 2.5 * b, R + 24, 0.5);
        this.bell(t0 + 3 * b, R + 31, 0.35, 1.4, -0.3);
        return 5.5 * b + 1.4;
      }
      case 'defeat': {
        const B = b * 1.5;
        this.strings(t0, [R - 12, R - 5, R, R + 3], 2 * B, 0.9);
        this.strings(t0 + 2 * B, [R - 7, R - 4, R, R + 5], 2 * B, 0.9);
        this.strings(t0 + 4 * B, [R - 12, R - 5, R, R + 3], 3 * B, 0.9);
        const line: [number, number, number][] = [[0, 7, 1], [1, 8, 1], [2, 8, 1], [3, 5, 1], [4, 3, 1], [5, 2, 0.5], [5.5, 0, 1.6]];
        for (const [at, n, d] of line) this.brass(t0 + at * B, [R + n], d * B * 0.95, 0.6, { bright: 0.3, attack: 0.09, release: 0.35, single: false });
        this.brass(t0 + 4 * B, [R - 24, R - 12], 3 * B, 0.7, { bright: 0.25, attack: 0.2, release: 0.6 });
        this.timp(t0, T, 0.7);
        this.timp(t0 + 2 * B, T - 7, 0.6);
        this.timp(t0 + 4 * B, T, 0.8);
        this.timpRoll(t0 + 4.5 * B, T, 2 * B, 0.5, 0.15);
        this.boom(t0, 0.5);
        this.boom(t0 + 4 * B, 0.65);
        return 7 * B + 1.5;
      }
      case 'superweapon_ready': {
        for (let k = 0; k < 4; k++) this.brass(t0 + (k * b) / 2, [T, T + 7], b * 0.3, 0.45 + 0.15 * k, { bright: 0.35, attack: 0.01, release: 0.08 });
        this.swell(t0, 2 * b, 0.4);
        this.brass(t0 + 2 * b, [R - 12, R, R + 1, R + 6], b * 1.6, 1.1, { bright: 1, release: 0.4 });
        this.boom(t0 + 2 * b, 0.9);
        this.timp(t0 + 2 * b, T, 1);
        this.cymbal(t0 + 2 * b, 0.55, 1.2);
        this.bell(t0 + 2 * b, R + 25, 0.45, 2.2, 0.4);
        this.bell(t0 + 2 * b + s, R + 30, 0.35, 2.2, -0.4);
        this.strings(t0 + 2 * b, [R + 12, R + 13], 2 * b, 0.45, 0.8, 0.1);
        return 4 * b + 1.5;
      }
      case 'promotion': {
        const notes = [TR, TR + 4, TR + 7];
        notes.forEach((n, i) => this.brass(t0 + i * s, [n], s * 0.85, 0.75, { bright: 1, single: true, attack: 0.02, release: 0.08 }));
        this.brass(t0 + 3 * s, [TR + 12], b * 1.5, 0.9, { bright: 1, single: true, release: 0.4 });
        this.brass(t0 + 3 * s, [R, R + 4, R + 7], b * 1.5, 0.55, { release: 0.4 });
        this.timp(t0 + 3 * s, T, 0.5);
        this.bell(t0 + 3 * s, R + 24, 0.4);
        this.bell(t0 + 4 * s, R + 31, 0.28, 1.2, -0.3);
        this.cymbal(t0 + 3 * s, 0.25, 0.8);
        return 3 * s + 1.5 * b + 1;
      }
      case 'reinforcements': {
        this.snareRoll(t0, 2 * b, 0.15, 0.85);
        const bug: [number, number, number][] = [[2, 7, 0.45], [2.5, 12, 0.45], [3, 16, 0.45], [3.5, 19, 2]];
        for (const [at, n, d] of bug) this.brass(t0 + at * b, [TR - 12 + n], d * b * 0.9, 0.85, { bright: 0.9, single: true, attack: 0.025, release: 0.15, pan: 0.15 });
        this.brass(t0 + 3.5 * b, [R - 12, R, R + 7], 1.8 * b, 0.6, { release: 0.4 });
        this.snare(t0 + 2 * b, 1);
        this.snare(t0 + 3.5 * b, 0.9);
        this.timp(t0 + 2 * b, T, 0.8);
        this.timp(t0 + 3.5 * b, T, 0.9);
        this.cymbal(t0 + 3.5 * b, 0.5);
        return 5.5 * b + 1;
      }
      case 'mission_start': {
        this.swell(t0, b, 0.45);
        this.boom(t0 + b, 1);
        this.timp(t0 + b, T, 1);
        this.brass(t0 + b, [R - 12, R - 5, R, R + 7], b * 0.9, 1.05, { bright: 0.9 });
        this.cymbal(t0 + b, 0.6);
        this.strings(t0 + b, [R - 12, R - 5, R], 4 * b, 0.6);
        this.brass(t0 + 2.5 * b, [R - 4, R, R + 3], b * 0.4, 0.85, { bright: 0.8 });
        this.timp(t0 + 2.5 * b, T - 4, 0.7);
        this.brass(t0 + 3 * b, [R - 12, R, R + 3, R + 7], 2 * b, 1.05, { bright: 0.85, release: 0.45 });
        this.timp(t0 + 3 * b, T, 0.95);
        this.snare(t0 + 3 * b, 0.6);
        this.timpRoll(t0 + 3.5 * b, T, 1.5 * b, 0.45, 0.1);
        return 5 * b + 1.2;
      }
      case 'battle_joined': {
        // war drums swelling into a heavy brass hit: the battle theme takes over from here
        this.timpRoll(t0, T, 1.5 * b, 0.2, 0.9);
        this.swell(t0, 1.5 * b, 0.35);
        this.boom(t0 + 1.5 * b, 0.8);
        this.timp(t0 + 1.5 * b, T, 1);
        this.brass(t0 + 1.5 * b, [R - 12, R - 5, R, R + 3], b * 0.6, 1.05, { bright: 0.95, attack: 0.02, release: 0.18 });
        this.brass(t0 + 2.25 * b, [R - 12, R - 5, R, R + 7], b * 1.2, 1.1, { bright: 1, attack: 0.02, release: 0.35 });
        this.snare(t0 + 1.5 * b, 0.9);
        this.snare(t0 + 2.25 * b, 0.8);
        this.cymbal(t0 + 1.5 * b, 0.55, 1.1);
        return 3.5 * b + 1;
      }
      case 'battle_won': {
        // a short triumphant brass call (the sector is ours), lighter than the victory theme
        this.brass(t0, [TR + 7], b * 0.4, 0.85, { bright: 1, single: true, attack: 0.02, release: 0.1, pan: 0.15 });
        this.brass(t0 + 0.5 * b, [TR + 7], b * 0.4, 0.85, { bright: 1, single: true, attack: 0.02, release: 0.1, pan: 0.15 });
        this.brass(t0 + b, [TR + 12], b * 2.2, 1, { bright: 1, single: true, release: 0.45, pan: 0.15 });
        this.brass(t0 + b, [R - 12, R, R + 4, R + 7], b * 2.2, 0.85, { release: 0.45 });
        this.timp(t0, T, 0.6);
        this.timp(t0 + 0.5 * b, T, 0.6);
        this.timp(t0 + b, T, 1);
        this.cymbal(t0 + b, 0.6, 1.3);
        this.bell(t0 + b, R + 24, 0.4);
        this.strings(t0 + b, [R, R + 4, R + 7, R + 12], 2.5 * b, 0.55);
        return 3.5 * b + 1.3;
      }
      case 'milestone': {
        // a big build is finished: rising brass and bells
        const notes = [R, R + 4, R + 7];
        notes.forEach((n, i) => this.brass(t0 + i * s * 2, [n, n + 12], s * 1.8, 0.75, { bright: 0.9, attack: 0.02, release: 0.1 }));
        this.brass(t0 + 6 * s, [R - 12, R, R + 4, R + 7, R + 12], b * 2, 0.95, { bright: 1, release: 0.5 });
        this.timp(t0 + 6 * s, T, 0.9);
        this.cymbal(t0 + 6 * s, 0.5, 1.4);
        this.bell(t0 + 6 * s, R + 24, 0.45, 1.8);
        this.bell(t0 + 7 * s, R + 31, 0.35, 1.8, -0.3);
        return 6 * s + 2 * b + 1.2;
      }
      case 'enemy_spotted': {
        this.brass(t0, [R + 12, R + 13], b * 0.35, 0.8, { bright: 1, attack: 0.015, release: 0.1 });
        this.timp(t0, T, 0.7);
        this.brass(t0 + 0.75 * b, [R, R + 1, R + 6, R + 12], b * 0.5, 1, { bright: 1, attack: 0.015, release: 0.15 });
        this.snare(t0 + 0.75 * b, 0.7);
        this.boom(t0 + 0.75 * b, 0.4);
        this.strings(t0 + 0.75 * b, [R + 24, R + 25], 1.5 * b, 0.35, 0.9, 0.2);
        return 2.5 * b + 1;
      }
    }
    return 0;
  }
}

/** Offline render of one stinger (self-test). */
export async function renderStingerOffline(kind: StingerKind, key = 33, bpm = 142, sampleRate = 44100): Promise<{ buffer: AudioBuffer; length: number; renderMs: number }> {
  const len = 9;
  const oc = new OfflineAudioContext(2, Math.ceil(len * sampleRate), sampleRate);
  const out = oc.createGain();
  out.gain.value = 0.36 * 0.7225; // default music² × master² volume
  out.connect(oc.destination);
  const eng = new StingerEngine(oc, out);
  const length = eng.play(kind, { key, stepDur: 60 / bpm / 4, when: 0.05 });
  const t0 = performance.now();
  const buffer = await oc.startRendering();
  return { buffer, length, renderMs: performance.now() - t0 };
}
