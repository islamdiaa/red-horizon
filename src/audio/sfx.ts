/**
 * Procedural sound-effect recipes. Every SfxKey is synthesised from oscillators, filtered
 * noise, waveshaping and convolution reverb inside an OfflineAudioContext, then cleaned and
 * peak-normalised (see dsp.postProcess). Rendering happens once per variation; playback is
 * just an AudioBufferSourceNode.
 */
import { hashStr, mulberry32, postProcess, type IrKind, type PostResult } from './dsp';
import { Synth, type Vowel } from './synth';
import type { SfxKey } from './types';

/** Internal (non-public) sounds used by the announcer / unit responses. */
export type InternalKey = '_chirp' | '_radio';
export type AnyKey = SfxKey | InternalKey;

export interface Recipe {
  /** Render length in seconds (tail is trimmed automatically). */
  dur: number;
  /** Target peak level in dBFS after normalisation. */
  peak: number;
  /** Number of pre-rendered random variations. */
  vars?: number;
  /** Audible-range multiplier for positional playback (1 = normal). */
  range?: number;
  /** Max simultaneous instances of this key. */
  maxVoices?: number;
  build(s: Synth, t: number): void;
}

const T0 = 0.004;

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

/** A dry bus feeding the output plus a reverb send. */
function bus(s: Synth, verb: IrKind | null, wet: number, dest: AudioNode = s.out, level = 1): GainNode {
  const g = s.gain(level);
  g.connect(dest);
  if (verb && wet > 0) s.send(g, verb, wet);
  return g;
}

interface ShotOpts { hp: number; tau: number; body: number; bodyTau: number; f0: number; f1: number; thumpTau: number; level: number; drive?: number }

/** One small-arms report: crack + band-passed body + low thump. */
function shot(s: Synth, dest: AudioNode, t: number, o: ShotOpts): void {
  s.crack(dest, t, 0.9 * o.level, s.vary(o.tau, 0.15), s.vary(o.hp, 0.1), o.drive ?? 3);
  s.noiseHit(dest, t, { color: 'pink', type: 'bandpass', f0: s.vary(o.body, 0.12), q: 1.1, attack: 0.0008, tau: o.bodyTau, level: 0.65 * o.level });
  s.thump(dest, t, s.vary(o.f0, 0.08), o.f1, 0.03, o.thumpTau, 0.6 * o.level, 1.5);
}

/** Tank / artillery gun. size 0 (light) .. 1 (howitzer). */
function cannon(s: Synth, t: number, size: number): void {
  const dry = bus(s, 'outdoor', 0.26 + 0.16 * size);
  s.thump(dry, t, s.vary(140 - 70 * size, 0.05), 40 - 15 * size, 0.1 + 0.15 * size, 0.07 + 0.12 * size, 1.0, 1.8 + 2 * size);
  s.thump(dry, t, s.vary(320 - 120 * size, 0.06), 110 - 30 * size, 0.05, 0.035 + 0.03 * size, 0.55, 2, 'triangle');
  s.crack(dry, t, 0.75, 0.016 + 0.02 * size, 900 - 300 * size, 4);
  s.noiseHit(dry, t, { color: 'pink', type: 'lowpass', f0: 6000 - 2500 * size, f1: 380 - 150 * size, sweep: 0.2 + 0.35 * size, attack: 0.002, tau: 0.07 + 0.14 * size, level: 0.9, drive: 2.5 + 2 * size });
  const rum = s.noiseHit(dry, t + 0.01, { color: 'pink', type: 'lowpass', f0: 260 - 80 * size, q: 0.9, attack: 0.03, tau: 0.22 + 0.45 * size, level: 0.45 + 0.25 * size, drive: 1.5 });
  s.jitter(rum.gain, t + 0.05, 0.4 + size, (0.45 + 0.25 * size) * 0.6, 0.45 + 0.25 * size, 0.09);
  // breech / turret clank
  s.metal(dry, t + 0.06 + s.r(0, 0.03), s.r(700, 950), [1, 2.31, 3.89, 5.13], 0.06, 0.06 + 0.05 * (1 - size));
}

/** Generic explosion. size 0 (pop) .. 1 (massive). */
function explosion(s: Synth, dest: AudioNode, t: number, size: number, verb: IrKind, wet: number): void {
  const dry = bus(s, verb, wet, dest);
  s.thump(dry, t, s.vary(120 - 60 * size, 0.08), 45 - 25 * size, 0.08 + 0.35 * size, 0.06 + 0.3 * size, 1, 2 + 3 * size);
  s.thump(dry, t, s.vary(260 - 100 * size, 0.08), 90 - 30 * size, 0.06, 0.04 + 0.05 * size, 0.5, 2, 'triangle');
  s.crack(dry, t, 0.7, 0.008 + 0.03 * size, 700, 4 + 2 * size);
  s.noiseHit(dry, t, { color: 'pink', type: 'lowpass', f0: 7000 - 3000 * size, f1: 500 - 330 * size, sweep: 0.15 + 0.9 * size, attack: 0.002, tau: 0.07 + 0.45 * size, level: 1, drive: 2 + 3 * size });
  if (size > 0.25) {
    const lvl = 0.35 + 0.45 * size;
    const r = s.noiseHit(dry, t + 0.02, { color: 'pink', type: 'lowpass', f0: 220 - 90 * size, q: 1, attack: 0.04 + 0.15 * size, tau: 0.25 + 1.1 * size, level: lvl, drive: 2 });
    s.jitter(r.gain, t + 0.05, 0.5 + 3 * size, lvl * 0.45, lvl, 0.11);
  }
  s.grains(dry, t + 0.02, 0.25 + 1.6 * size, Math.round(6 + 30 * size), { fMin: 600, fMax: 5000, q: 1.5, dMin: 0.002, dMax: 0.015 + 0.02 * size, level: 0.25, decay: 1.8 });
}

/** Dog bark: formant-filtered saw + breath "huff". */
function bark(s: Synth, dest: AudioNode, t: number, ps: number, level: number, len = 0.13): void {
  s.voice(dest, t, len, {
    pitch: [[0, 330 * ps], [0.025, 560 * ps], [len, 280 * ps]],
    vowel: 'a', vowel2: 'u', level, breath: 0.35, jitter: 40, rasp: 3, attack: 0.006, release: 0.03, formantScale: 1.15,
  });
  s.noiseHit(dest, t, { type: 'bandpass', f0: 1200 * ps, q: 0.8, attack: 0.004, tau: 0.04, level: level * 0.35 });
}

/** Flame roar layer (used by flamethrower, burning infantry, fire explosions). */
function flameRoar(s: Synth, dest: AudioNode, t: number, len: number, level: number): void {
  const src = s.noise(t, len + 1.2, 'pink');
  const lp = s.filter('lowpass', 900, 0.8);
  const turb = s.gain(1);
  s.jitter(turb.gain, t, len + 0.5, 0.55, 1, 0.025);
  const env = s.gain(0);
  s.perc(env.gain, t, 1, 0.06, 0.12, len);
  s.chain(src, lp, turb, env, s.shaper(2.5), s.gain(0.8 * level), dest);
  s.noiseHit(dest, t, { type: 'bandpass', f0: 2500, q: 0.6, attack: 0.03, hold: len * 0.8, tau: 0.12, level: 0.4 * level });
  s.grains(dest, t + 0.03, len + 0.1, Math.round(30 * len + 8), { fMin: 2000, fMax: 6500, q: 2, dMin: 0.0015, dMax: 0.006, level: 0.22 * level, decay: 1 });
}

/** Mechanical ratchet click. */
function ratchet(s: Synth, dest: AudioNode, t: number, level: number): void {
  s.noiseHit(dest, t, { type: 'bandpass', f0: s.r(2400, 3200), q: 3, attack: 0.0005, tau: 0.005, level });
  s.metal(dest, t, s.r(2000, 2600), [1, 1.71], 0.012, level * 0.4);
}

/** Low motor / servo hum. */
function motor(s: Synth, dest: AudioNode, t: number, len: number, f0: number, f1: number, cutoff: number, level: number): void {
  const o = s.osc('sawtooth', f0, t, len + 0.6);
  s.sweep(o.frequency, t, f0, t + len, f1);
  const lp = s.filter('lowpass', cutoff, 1.5);
  const env = s.gain(0);
  s.perc(env.gain, t, 1, 0.06, 0.06, len);
  s.chain(o, lp, env, s.gain(level), dest);
}

/** Square-wave tone with flat envelope (UI / blips). */
function tone(s: Synth, dest: AudioNode, t: number, f: number, len: number, level: number, type: OscillatorType = 'square', lp = 4000): void {
  const o = s.osc(type, f, t, len + 0.05);
  const fl = s.filter('lowpass', lp);
  const env = s.gain(0);
  s.lin(env.gain, [[t, 0], [t + 0.003, 1], [t + len, 1], [t + len + 0.012, 0]]);
  s.chain(o, fl, env, s.gain(level), dest);
}

/** Bell-ish chime note. */
function chime(s: Synth, dest: AudioNode, t: number, f: number, tau: number, level: number): void {
  const o = s.osc('sine', f, t, tau * 9 + 0.01);
  const o2 = s.osc('sine', f * 2.0, t, tau * 6);
  const o3 = s.osc('sine', f * 2.76, t, tau * 4);
  const g = s.gain(0);
  s.perc(g.gain, t, level, 0.002, tau);
  const g2 = s.gain(0);
  s.perc(g2.gain, t, level * 0.25, 0.002, tau * 0.5);
  const g3 = s.gain(0);
  s.perc(g3.gain, t, level * 0.12, 0.002, tau * 0.3);
  o.connect(g).connect(dest);
  o2.connect(g2).connect(dest);
  o3.connect(g3).connect(dest);
}

const pick = <T>(s: Synth, arr: T[]): T => arr[Math.floor(s.rng() * arr.length)];

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

export const RECIPES: Record<AnyKey, Recipe> = {
  // ----------------------------------------------------------------- weapons
  pistol: {
    dur: 0.7, peak: -9, vars: 3,
    build(s, t) {
      const dry = bus(s, 'outdoor', 0.22);
      shot(s, dry, t, { hp: 1300, tau: 0.011, body: 800, bodyTau: 0.03, f0: 240, f1: 100, thumpTau: 0.025, level: 1 });
    },
  },
  rifle: {
    dur: 0.9, peak: -8, vars: 3,
    build(s, t) {
      const dry = bus(s, 'outdoor', 0.25);
      const o: ShotOpts = { hp: 1700, tau: 0.013, body: 1100, bodyTau: 0.035, f0: 200, f1: 90, thumpTau: 0.03, level: 1, drive: 3.5 };
      shot(s, dry, t, o);
      shot(s, dry, t + s.r(0.08, 0.095), { ...o, level: 0.85 });
    },
  },
  mg: {
    dur: 1.3, peak: -7, vars: 3,
    build(s, t) {
      const dry = bus(s, 'outdoor', 0.22);
      const n = 6;
      let tt = t;
      for (let i = 0; i < n; i++) {
        shot(s, dry, tt, { hp: 1100, tau: 0.009, body: 600, bodyTau: 0.022, f0: 170, f1: 70, thumpTau: 0.022, level: s.r(0.8, 1), drive: 3 });
        tt += s.r(0.054, 0.064);
      }
    },
  },
  cannon_small: { dur: 1.3, peak: -6, vars: 3, build: (s, t) => cannon(s, t, 0.2) },
  cannon_med: { dur: 1.7, peak: -5, vars: 3, build: (s, t) => cannon(s, t, 0.5) },
  cannon_heavy: { dur: 2.2, peak: -4, vars: 3, range: 1.2, build: (s, t) => cannon(s, t, 0.85) },
  artillery: {
    dur: 3.2, peak: -3.5, vars: 2, range: 1.4,
    build(s, t) {
      cannon(s, t, 1);
      const dry = bus(s, 'outdoor', 0.45);
      s.thump(dry, t, 55, 24, 0.3, 0.3, 0.8, 3);
      // terrain slap-back
      s.noiseHit(dry, t + s.r(0.3, 0.36), { color: 'pink', type: 'lowpass', f0: 900, attack: 0.01, tau: 0.12, level: 0.25, drive: 2 });
    },
  },
  rocket: {
    dur: 1.4, peak: -7, vars: 3,
    build(s, t) {
      const dry = bus(s, 'outdoor', 0.25);
      s.thump(dry, t, 320, 120, 0.03, 0.02, 0.5, 2);
      s.crack(dry, t, 0.35, 0.008, 2000, 2);
      const src = s.noise(t, 1.8);
      const bp = s.filter('bandpass', 700, 1.3);
      const fpk = s.vary(2600, 0.1);
      bp.frequency.setValueAtTime(700, t);
      bp.frequency.exponentialRampToValueAtTime(fpk, t + 0.12);
      bp.frequency.exponentialRampToValueAtTime(s.vary(900, 0.1), t + 0.8);
      const env = s.gain(0);
      s.lin(env.gain, [[t, 0], [t + 0.015, 1], [t + 0.12, 0.8]]);
      env.gain.setTargetAtTime(0, t + 0.15, 0.2);
      s.chain(src, bp, env, s.shaper(1.5), s.gain(1), dry);
      s.noiseHit(dry, t + 0.005, { type: 'highpass', f0: 4500, attack: 0.01, tau: 0.12, level: 0.25 });
      s.noiseHit(dry, t, { color: 'pink', type: 'lowpass', f0: 450, attack: 0.008, tau: 0.15, level: 0.5, drive: 2 });
    },
  },
  missile_launch: {
    dur: 3.2, peak: -5, vars: 2, range: 1.2,
    build(s, t) {
      const dry = bus(s, 'outdoor', 0.3);
      s.thump(dry, t, 120, 45, 0.1, 0.1, 0.9, 2);
      s.noiseHit(dry, t, { color: 'pink', type: 'lowpass', f0: 3000, f1: 500, sweep: 0.3, attack: 0.002, tau: 0.1, level: 0.7, drive: 3 });
      // sustained motor roar, rising with thrust
      const src = s.noise(t, 4.0, 'pink');
      const bp = s.filter('bandpass', 400, 0.7);
      s.sweep(bp.frequency, t, 400, t + 1.2, 900);
      const turb = s.gain(1);
      s.jitter(turb.gain, t, 1.6, 0.6, 1, 0.03);
      const env = s.gain(0);
      s.perc(env.gain, t, 1, 0.05, 0.35, 0.85);
      s.chain(src, bp, turb, env, s.shaper(3), s.gain(0.8), dry);
      // whoosh as it leaves
      s.noiseHit(dry, t + 0.05, { type: 'bandpass', f0: 1500, f1: 3500, sweep: 0.4, q: 1, attack: 0.1, tau: 0.4, level: 0.5 });
      s.grains(dry, t + 0.05, 1.2, 25, { fMin: 1500, fMax: 4000, q: 2, level: 0.25, decay: 1 });
    },
  },
  grenade: {
    dur: 0.6, peak: -8, vars: 3,
    build(s, t) {
      const dry = bus(s, 'room', 0.2);
      s.thump(dry, t, s.vary(260, 0.08), 110, 0.05, 0.04, 0.8, 1.5);
      s.noiseHit(dry, t, { color: 'pink', type: 'lowpass', f0: 1200, attack: 0.001, tau: 0.03, level: 0.5 });
      s.noiseHit(dry, t + 0.03, { type: 'bandpass', f0: 900, f1: 2200, sweep: 0.25, q: 2, attack: 0.05, tau: 0.07, level: 0.25 });
    },
  },
  flame: {
    dur: 1.5, peak: -8, vars: 2,
    build(s, t) {
      const dry = bus(s, 'room', 0.2);
      s.noiseHit(dry, t, { type: 'bandpass', f0: 400, f1: 1800, sweep: 0.15, q: 1, attack: 0.02, tau: 0.08, level: 0.5 });
      s.noiseHit(dry, t, { color: 'pink', type: 'lowpass', f0: 250, attack: 0.04, tau: 0.2, level: 0.6, drive: 1.5 });
      flameRoar(s, dry, t + 0.01, 0.55, 1);
    },
  },
  tesla_charge: {
    dur: 1.1, peak: -9, vars: 2,
    build(s, t) {
      const dry = bus(s, 'room', 0.15);
      const end = t + 0.68;
      const mix = s.gain(0.5);
      for (const [f0, f1] of [[120, 1500], [121.5, 1512]]) {
        const o = s.osc('sawtooth', f0, t, 0.75);
        s.sweep(o.frequency, t, f0, end, f1);
        o.connect(mix);
        const lfo = s.osc('sine', 9, t, 0.75);
        s.sweep(lfo.frequency, t, 9, end, 34);
        const lg = s.gain(40);
        lfo.connect(lg).connect(o.detune);
      }
      const bp = s.filter('bandpass', 300, 2.5);
      s.sweep(bp.frequency, t, 300, end, 4000);
      const env = s.gain(0);
      s.lin(env.gain, [[t, 0], [t + 0.1, 0.25], [end - 0.02, 1], [end + 0.03, 0]]);
      s.chain(mix, bp, env, s.shaper(2), s.gain(0.6), dry);
      const hum = s.osc('square', 60, t, 0.75);
      s.sweep(hum.frequency, t, 60, end, 120);
      const hl = s.filter('lowpass', 500);
      const he = s.gain(0);
      s.lin(he.gain, [[t, 0], [t + 0.2, 0.3], [end, 0.5], [end + 0.04, 0]]);
      s.chain(hum, hl, he, s.gain(0.35), dry);
      s.crackle(dry, t + 0.25, 0.43, 0.3, { hp: 4000, density: 0.4, fade: false });
    },
  },
  tesla_zap: {
    dur: 1.3, peak: -4.5, vars: 3, range: 1.2,
    build(s, t) {
      const dry = bus(s, 'outdoor', 0.3);
      // brief rising whine into the discharge
      const o = s.osc('sawtooth', 500, t, 0.12);
      s.sweep(o.frequency, t, 500, t + 0.09, 2600);
      const bp = s.filter('bandpass', 2000, 1.5);
      const e = s.gain(0);
      s.lin(e.gain, [[t, 0], [t + 0.07, 0.35], [t + 0.095, 0]]);
      s.chain(o, bp, e, dry);
      const tz = t + 0.09;
      s.crack(dry, tz, 1, 0.006, 1500, 5);
      // arc buzz with random pitch jumps
      const b = s.osc('square', 95, tz, 0.9);
      s.jitter(b.frequency, tz, 0.45, 70, 170, 0.012, 0.2);
      const bbp = s.filter('bandpass', 1600, 0.7);
      const be = s.gain(0);
      s.perc(be.gain, tz, 1, 0.002, 0.1, 0.2);
      s.chain(b, s.shaper(3, 'fuzz'), bbp, be, s.gain(0.8), dry);
      s.crackle(dry, tz, 0.45, 0.9, { hp: 1200, density: 0.65, minGap: 0.0015, maxGap: 0.012 });
      s.thump(dry, tz, 3200, 350, 0.25, 0.07, 0.3);
      s.thump(dry, tz, 140, 60, 0.05, 0.05, 0.5, 2);
    },
  },
  dog_attack: {
    dur: 0.95, peak: -9, vars: 3,
    build(s, t) {
      const dry = bus(s, 'room', 0.15);
      s.voice(dry, t, 0.3, {
        pitch: [[0, 105], [0.15, 125], [0.3, 98]], vowel: 'u', vowel2: 'a', level: 0.6, breath: 0.5,
        jitter: 120, rasp: 4, attack: 0.04, release: 0.05, formantScale: 0.9,
      });
      bark(s, dry, t + 0.3, s.vary(1.15, 0.06), 1, 0.12);
      s.crack(dry, t + 0.43, 0.8, 0.004, 2500, 2);
      s.crack(dry, t + 0.47, 0.6, 0.004, 2500, 2);
      s.thump(dry, t + 0.43, 260, 110, 0.02, 0.02, 0.5);
    },
  },
  dog_bark: {
    dur: 0.85, peak: -10, vars: 3,
    build(s, t) {
      const dry = bus(s, 'room', 0.15);
      const ps = s.vary(1, 0.08);
      bark(s, dry, t, ps, 1);
      bark(s, dry, t + s.r(0.21, 0.25), ps * 0.94, 0.85);
    },
  },
  heal: {
    dur: 1.8, peak: -10, vars: 1,
    build(s, t) {
      const dry = bus(s, 'hall', 0.4);
      [659.3, 830.6, 987.8, 1318.5].forEach((f, i) => chime(s, dry, t + i * 0.07, f, 0.22, 0.3));
      s.noiseHit(dry, t, { type: 'bandpass', f0: 6500, q: 4, attack: 0.2, tau: 0.2, level: 0.08 });
    },
  },
  flak: {
    dur: 1.6, peak: -6, vars: 3,
    build(s, t) {
      const dry = bus(s, 'outdoor', 0.3);
      for (let i = 0; i < 4; i++) {
        const tt = t + i * s.r(0.095, 0.105);
        const lv = s.r(0.8, 1);
        s.thump(dry, tt, 190, 70, 0.04, 0.045, 0.8 * lv, 2.5);
        s.crack(dry, tt, 0.7 * lv, 0.014, 1300, 3);
        s.noiseHit(dry, tt, { color: 'pink', type: 'lowpass', f0: 1500, attack: 0.001, tau: 0.05, level: 0.5 * lv });
      }
    },
  },
  nuke_launch: {
    dur: 6.5, peak: -4, vars: 1, range: 2, maxVoices: 2,
    build(s, t) {
      const dry = bus(s, 'huge', 0.3);
      s.thump(dry, t, 80, 32, 0.3, 0.2, 1, 3);
      s.noiseHit(dry, t, { color: 'pink', type: 'lowpass', f0: 2500, f1: 300, sweep: 0.5, attack: 0.005, tau: 0.2, level: 0.8, drive: 3 });
      const src = s.noise(t, 6.5, 'pink');
      const lp = s.filter('lowpass', 250, 1.2);
      s.sweep(lp.frequency, t, 250, t + 3, 1400);
      const turb = s.gain(1);
      s.jitter(turb.gain, t, 3.6, 0.65, 1, 0.06);
      const env = s.gain(0);
      s.lin(env.gain, [[t, 0], [t + 0.5, 0.9], [t + 3, 1]]);
      env.gain.setTargetAtTime(0, t + 3, 0.35);
      s.chain(src, lp, turb, env, s.shaper(3), s.gain(0.9), dry);
      s.noiseHit(dry, t + 0.2, { color: 'pink', type: 'bandpass', f0: 600, f1: 1800, sweep: 3, q: 0.8, attack: 0.6, hold: 2.2, tau: 0.35, level: 0.45 });
      s.grains(dry, t + 0.3, 3, 70, { fMin: 1200, fMax: 5000, q: 2, level: 0.25, decay: 1 });
    },
  },

  // -------------------------------------------------------------- explosions
  expl_piff: {
    dur: 0.2, peak: -16, vars: 3,
    build(s, t) {
      s.noiseHit(s.out, t, { type: 'bandpass', f0: s.r(3000, 4500), q: 0.9, attack: 0.0005, tau: 0.007, level: 1, drive: 2 });
      s.noiseHit(s.out, t + 0.002, { color: 'pink', type: 'lowpass', f0: 1800, attack: 0.001, tau: 0.018, level: 0.5 });
      s.thump(s.out, t, 500, 180, 0.02, 0.01, 0.3);
    },
  },
  expl_small: { dur: 1.2, peak: -8, vars: 3, build: (s, t) => explosion(s, s.out, t, 0.15, 'outdoor', 0.22) },
  expl_medium: { dur: 2.0, peak: -6, vars: 3, build: (s, t) => explosion(s, s.out, t, 0.4, 'outdoor', 0.28) },
  expl_large: { dur: 2.8, peak: -4.5, vars: 2, range: 1.3, build: (s, t) => explosion(s, s.out, t, 0.65, 'outdoor', 0.32) },
  expl_huge: {
    dur: 4.0, peak: -3.5, vars: 2, range: 1.6,
    build(s, t) {
      explosion(s, s.out, t, 0.9, 'huge', 0.3);
      explosion(s, bus(s, null, 0, s.out, 0.6), t + s.r(0.24, 0.32), 0.55, 'outdoor', 0.25);
    },
  },
  expl_fire: {
    dur: 1.8, peak: -6, vars: 2,
    build(s, t) {
      const dry = bus(s, 'outdoor', 0.25);
      const src = s.noise(t, 2.6, 'pink');
      const bp = s.filter('bandpass', 250, 0.8);
      bp.frequency.setValueAtTime(250, t);
      bp.frequency.exponentialRampToValueAtTime(900, t + 0.12);
      bp.frequency.exponentialRampToValueAtTime(400, t + 0.9);
      const env = s.gain(0);
      s.perc(env.gain, t, 1, 0.05, 0.3);
      s.chain(src, bp, env, s.shaper(2), dry);
      s.noiseHit(dry, t, { type: 'bandpass', f0: 3000, q: 0.7, attack: 0.03, tau: 0.2, level: 0.3 });
      s.thump(dry, t, 80, 40, 0.15, 0.15, 0.6, 2);
      s.grains(dry, t + 0.05, 1, 25, { fMin: 1800, fMax: 6000, q: 2, dMin: 0.0015, dMax: 0.006, level: 0.25, decay: 1.2 });
    },
  },
  expl_electric: {
    dur: 1.0, peak: -7, vars: 3,
    build(s, t) {
      const dry = bus(s, 'outdoor', 0.25);
      s.crack(dry, t, 1, 0.004, 2000, 4);
      s.crackle(dry, t, 0.35, 0.8, { hp: 1500, density: 0.6 });
      s.thump(dry, t, 2500, 150, 0.35, 0.1, 0.4);
      const b = s.osc('square', 120, t, 0.9);
      const bp = s.filter('bandpass', 1500, 0.8);
      const be = s.gain(0);
      s.perc(be.gain, t, 1, 0.002, 0.08);
      s.chain(b, s.shaper(3, 'fuzz'), bp, be, s.gain(0.4), dry);
      s.thump(dry, t, 150, 60, 0.05, 0.05, 0.5, 2);
    },
  },
  expl_nuke: {
    dur: 9, peak: -3, vars: 1, range: 3, maxVoices: 2,
    build(s, t) {
      const dry = bus(s, 'huge', 0.45);
      s.crack(dry, t, 0.9, 0.05, 500, 6);
      s.thump(dry, t, 55, 18, 1.2, 0.9, 1.0, 4);
      s.thump(dry, t, 140, 45, 0.4, 0.25, 0.6, 3, 'triangle');
      s.noiseHit(dry, t, { color: 'pink', type: 'lowpass', f0: 3500, f1: 140, sweep: 2.8, attack: 0.01, tau: 1.0, level: 1, drive: 4 });
      const r = s.noiseHit(dry, t + 0.05, { color: 'pink', type: 'lowpass', f0: 110, q: 1.2, attack: 0.5, tau: 2.6, level: 0.9, drive: 2.5 });
      s.jitter(r.gain, t + 0.05, 8, 0.35, 0.9, 0.18, 0.6);
      s.noiseHit(dry, t + 0.1, { color: 'pink', type: 'lowpass', f0: 60, q: 0.9, attack: 0.8, tau: 2, level: 0.6 });
      for (const [dt, lv, f] of [[0.75, 0.5, 900], [1.6, 0.38, 600], [2.7, 0.25, 400], [3.9, 0.15, 300]]) {
        s.noiseHit(dry, t + dt, { color: 'pink', type: 'lowpass', f0: f, attack: 0.03, tau: 0.35, level: lv, drive: 2 });
        s.thump(dry, t + dt, 70, 30, 0.2, 0.15, lv * 0.6, 2);
      }
      s.grains(dry, t + 0.1, 4.5, 60, { fMin: 300, fMax: 3000, q: 1.5, dMin: 0.005, dMax: 0.04, level: 0.2, decay: 1.4 });
    },
  },
  expl_building: {
    dur: 3.8, peak: -3.5, vars: 2, range: 1.5,
    build(s, t) {
      explosion(s, s.out, t, 0.7, 'outdoor', 0.3);
      const dry = bus(s, 'outdoor', 0.3);
      s.grains(dry, t + 0.35, 2.4, 45, { fMin: 150, fMax: 1600, q: 1.2, dMin: 0.01, dMax: 0.05, level: 0.3, decay: 1.1 });
      s.metal(dry, t + 0.5 + s.r(0, 0.2), s.r(250, 450), [1, 2.76, 5.4, 8.93], 0.25, 0.18);
      s.metal(dry, t + 1.1 + s.r(0, 0.3), s.r(400, 700), [1, 2.4, 4.1, 6.8], 0.2, 0.12);
      s.noiseHit(dry, t + 0.3, { color: 'pink', type: 'lowpass', f0: 160, attack: 0.25, hold: 0.5, tau: 0.7, level: 0.45 });
    },
  },

  // ------------------------------------------------------------------ deaths
  inf_die: {
    dur: 0.7, peak: -10, vars: 3,
    build(s, t) {
      const dry = bus(s, 'room', 0.12);
      const p0 = s.r(130, 190);
      const vs: Vowel[] = ['u', 'a', 'e', 'o'];
      s.voice(dry, t, s.r(0.14, 0.22), {
        pitch: [[0, p0 * 1.1], [0.04, p0 * 1.3], [0.22, p0 * 0.75]],
        vowel: pick(s, vs), vowel2: pick(s, vs), level: 1, breath: 0.25, jitter: 25, rasp: 2.5, attack: 0.012, release: 0.05,
      });
    },
  },
  inf_scream: {
    dur: 1.9, peak: -11, vars: 3,
    build(s, t) {
      const dry = bus(s, 'outdoor', 0.2);
      const p0 = s.r(330, 460);
      s.voice(dry, t, s.r(0.55, 0.75), {
        pitch: [[0, p0 * 0.8], [0.08, p0 * 1.15], [0.3, p0], [0.75, p0 * 0.6]],
        vowel: 'scream', vowel2: 'a', level: 1, breath: 0.3, vibrato: 35, vibRate: 6.5, jitter: 40, rasp: 3,
        attack: 0.03, release: 0.12, formantScale: 1.1,
      });
    },
  },
  inf_burn: {
    dur: 2.0, peak: -11, vars: 2,
    build(s, t) {
      const dry = bus(s, 'outdoor', 0.18);
      const p0 = s.r(340, 420);
      s.voice(dry, t, 0.8, {
        pitch: [[0, p0], [0.15, p0 * 1.2], [0.8, p0 * 0.7]],
        vowel: 'scream', vowel2: 'o', level: 1, breath: 0.35, vibrato: 80, vibRate: 9, jitter: 50, rasp: 3, attack: 0.04, release: 0.1,
      });
      flameRoar(s, dry, t, 0.8, 0.55);
    },
  },
  inf_electro: {
    dur: 1.1, peak: -10, vars: 2,
    build(s, t) {
      const dry = bus(s, 'room', 0.15);
      const b = s.osc('square', 68, t, 1.4);
      const bp = s.filter('bandpass', 900, 0.8);
      const trem = s.gain(0.5);
      const lfo = s.osc('square', 24, t, 1.4);
      const lg = s.gain(0.5);
      lfo.connect(lg).connect(trem.gain);
      const env = s.gain(0);
      s.perc(env.gain, t, 1, 0.005, 0.1, 0.5);
      s.chain(b, s.shaper(4, 'fuzz'), bp, trem, env, s.gain(0.5), dry);
      s.crackle(dry, t, 0.6, 0.7, { hp: 2000, density: 0.6 });
      s.voice(dry, t + 0.02, 0.45, { pitch: [[0, 300], [0.45, 380]], vowel: 'e', level: 0.6, vibrato: 120, vibRate: 17, rasp: 4, breath: 0.2 });
    },
  },
  crush: {
    dur: 0.5, peak: -10, vars: 3,
    build(s, t) {
      const dry = bus(s, 'room', 0.1);
      s.noiseHit(dry, t, { color: 'pink', type: 'lowpass', f0: 900, attack: 0.002, tau: 0.04, level: 1 });
      s.grains(dry, t, 0.08, 8, { fMin: 1000, fMax: 3000, q: 2, dMin: 0.002, dMax: 0.006, level: 0.6, decay: 1 });
      s.thump(dry, t, 120, 60, 0.05, 0.05, 0.6);
      s.noiseHit(dry, t + 0.01, { type: 'bandpass', f0: 400, f1: 200, sweep: 0.1, q: 3, attack: 0.005, tau: 0.08, level: 0.4 });
    },
  },
  vehicle_die: {
    dur: 2.6, peak: -5, vars: 2, range: 1.2,
    build(s, t) {
      explosion(s, s.out, t, 0.5, 'outdoor', 0.3);
      const dry = bus(s, 'outdoor', 0.25);
      s.metal(dry, t + 0.02, s.r(150, 220), [1, 2.32, 4.25, 6.63, 9.38], 0.45, 0.35);
      explosion(s, bus(s, null, 0, s.out, 0.5), t + s.r(0.3, 0.42), 0.1, 'outdoor', 0.2);
    },
  },

  // ---------------------------------------------------------- base & economy
  build_place: {
    dur: 0.8, peak: -8, vars: 2,
    build(s, t) {
      const dry = bus(s, 'room', 0.2);
      s.thump(dry, t, 160, 70, 0.05, 0.05, 0.8, 2);
      s.metal(dry, t, s.r(380, 460), [1, 2.4, 3.9, 5.6], 0.12, 0.35);
      s.noiseHit(dry, t, { color: 'pink', type: 'lowpass', f0: 800, attack: 0.002, tau: 0.05, level: 0.5 });
      for (const dt of [0.12, 0.17, 0.22]) ratchet(s, dry, t + dt, 0.25);
    },
  },
  build_rise: {
    dur: 2.2, peak: -10, vars: 1,
    build(s, t) {
      const dry = bus(s, 'room', 0.2);
      motor(s, dry, t, 1.1, 70, 150, 900, 0.45);
      motor(s, dry, t + 0.3, 0.8, 140, 300, 1200, 0.15);
      const whine = s.osc('sine', 600, t, 1.8);
      s.sweep(whine.frequency, t, 600, t + 1.1, 1100);
      const we = s.gain(0);
      s.perc(we.gain, t, 0.08, 0.2, 0.05, 0.9);
      whine.connect(we).connect(dry);
      let tt = t + 0.1;
      let gap = 0.09;
      while (tt < t + 1.1) {
        ratchet(s, dry, tt, 0.25);
        tt += gap;
        gap = Math.max(0.04, gap * 0.93);
      }
      s.thump(dry, t + 1.2, 140, 60, 0.05, 0.06, 0.7, 2);
      s.metal(dry, t + 1.2, 300, [1, 2.4, 3.9], 0.12, 0.3);
    },
  },
  sell: {
    dur: 1.8, peak: -9, vars: 1,
    build(s, t) {
      const dry = bus(s, 'room', 0.25);
      motor(s, dry, t, 0.55, 150, 60, 800, 0.4);
      for (let i = 0; i < 5; i++) ratchet(s, dry, t + 0.05 + i * 0.09, 0.2);
      chime(s, dry, t + 0.58, 1568, 0.15, 0.4);
      chime(s, dry, t + 0.66, 2093, 0.25, 0.45);
      s.noiseHit(dry, t + 0.58, { type: 'highpass', f0: 6000, attack: 0.001, tau: 0.03, level: 0.15 });
    },
  },
  repair: {
    dur: 1.2, peak: -10, vars: 2,
    build(s, t) {
      const dry = bus(s, 'room', 0.18);
      for (let i = 0; i < 4; i++) ratchet(s, dry, t + i * 0.09, 0.4);
      s.metal(dry, t + 0.4, s.r(650, 760), [1, 2.31, 3.89, 5.13], 0.1, 0.3);
      const o = s.osc('sawtooth', 220, t + 0.45, 0.4);
      const trem = s.gain(0.5);
      const lfo = s.osc('sine', 30, t + 0.45, 0.4);
      const lg = s.gain(0.5);
      lfo.connect(lg).connect(trem.gain);
      const env = s.gain(0);
      s.perc(env.gain, t + 0.45, 1, 0.02, 0.03, 0.2);
      s.chain(o, s.filter('lowpass', 1500), trem, env, s.gain(0.25), dry);
    },
  },
  cash_tick: {
    dur: 0.07, peak: -20, vars: 1, maxVoices: 2,
    build(s, t) {
      s.thump(s.out, t, 2400, 2200, 0.01, 0.005, 0.6);
      s.thump(s.out, t, 4800, 4400, 0.01, 0.003, 0.25, 0, 'square');
      s.noiseHit(s.out, t, { type: 'highpass', f0: 5000, attack: 0.0003, tau: 0.0015, level: 0.3 });
    },
  },
  harvest: {
    dur: 1.6, peak: -13, vars: 2,
    build(s, t) {
      const dry = bus(s, 'room', 0.12);
      const src = s.noise(t, 2.0, 'pink');
      const bp = s.filter('bandpass', 900, 1.5);
      const gr = s.gain(1);
      s.jitter(gr.gain, t, 0.9, 0.1, 1, 0.022, 0.15);
      const env = s.gain(0);
      s.perc(env.gain, t, 1, 0.08, 0.15, 0.6);
      s.chain(src, bp, gr, env, s.gain(0.6), dry);
      s.grains(dry, t + 0.05, 0.8, 30, { fMin: 1500, fMax: 5000, q: 2, level: 0.4, decay: 1 });
      const m = s.osc('sawtooth', 55, t, 1.9);
      s.jitter(m.frequency, t, 1, 52, 60, 0.1);
      const me = s.gain(0);
      s.perc(me.gain, t, 1, 0.1, 0.1, 0.7);
      s.chain(m, s.filter('lowpass', 300), me, s.gain(0.3), dry);
    },
  },
  ore_dump: {
    dur: 3.0, peak: -12, vars: 1,
    build(s, t) {
      const dry = bus(s, 'room', 0.18);
      motor(s, dry, t, 1.4, 80, 110, 400, 0.25);
      const src = s.noise(t + 0.2, 3.0, 'pink');
      const lp = s.filter('lowpass', 1500, 0.7);
      const turb = s.gain(1);
      s.jitter(turb.gain, t + 0.2, 1.4, 0.4, 1, 0.03);
      const env = s.gain(0);
      s.perc(env.gain, t + 0.2, 1, 0.2, 0.3, 1.0);
      s.chain(src, lp, turb, env, s.gain(0.5), dry);
      s.grains(dry, t + 0.2, 1.3, 60, { fMin: 500, fMax: 3000, q: 1.5, dMin: 0.003, dMax: 0.015, level: 0.35, decay: 0.8 });
      s.thump(dry, t + 1.55, 120, 60, 0.05, 0.06, 0.35, 2);
    },
  },
  door: {
    dur: 1.2, peak: -12, vars: 1,
    build(s, t) {
      const dry = bus(s, 'room', 0.18);
      motor(s, dry, t, 0.5, 95, 110, 500, 0.4);
      s.noiseHit(dry, t, { type: 'bandpass', f0: 3500, q: 1, attack: 0.05, tau: 0.2, level: 0.15 });
      s.thump(dry, t + 0.55, 180, 80, 0.04, 0.04, 0.6, 2);
      s.metal(dry, t + 0.55, 520, [1, 2.31, 3.89], 0.08, 0.3);
    },
  },
  deploy: {
    dur: 1.4, peak: -9, vars: 1,
    build(s, t) {
      const dry = bus(s, 'room', 0.2);
      s.noiseHit(dry, t, { type: 'bandpass', f0: 2000, f1: 1200, sweep: 0.4, q: 1, attack: 0.02, tau: 0.3, level: 0.4 });
      motor(s, dry, t + 0.05, 0.6, 200, 420, 1500, 0.25);
      for (const dt of [0.5, 0.85]) {
        s.thump(dry, t + dt, 150, 65, 0.05, 0.05, 0.7, 2);
        s.metal(dry, t + dt, s.r(350, 500), [1, 2.4, 3.9, 5.6], 0.1, 0.25);
      }
    },
  },
  power_down: {
    dur: 2.2, peak: -11, vars: 1,
    build(s, t) {
      const dry = bus(s, 'room', 0.2);
      const o = s.osc('sawtooth', 330, t, 2.2);
      s.sweep(o.frequency, t, 330, t + 1.0, 40);
      const o2 = s.osc('sine', 660, t, 2.2);
      s.sweep(o2.frequency, t, 660, t + 1.0, 80);
      const lp = s.filter('lowpass', 2000, 2);
      s.sweep(lp.frequency, t, 2000, t + 1.0, 200);
      const env = s.gain(0);
      s.perc(env.gain, t, 1, 0.01, 0.25, 0.7);
      const mix = s.gain(0.5);
      o.connect(mix);
      o2.connect(mix);
      s.chain(mix, lp, env, dry);
      const hum = s.osc('square', 60, t, 1.6);
      const he = s.gain(0);
      s.perc(he.gain, t, 0.2, 0.01, 0.2, 0.3);
      s.chain(hum, s.filter('bandpass', 400, 1), he, dry);
      s.thump(dry, t + 0.9, 110, 50, 0.05, 0.06, 0.4, 2);
    },
  },
  radar_on: {
    dur: 2.4, peak: -9, vars: 1,
    build(s, t) {
      const dry = bus(s, 'hall', 0.3);
      const o = s.osc('sine', 300, t, 0.4);
      s.sweep(o.frequency, t, 300, t + 0.35, 1500);
      const e = s.gain(0);
      s.lin(e.gain, [[t, 0], [t + 0.05, 0.3], [t + 0.33, 0.3], [t + 0.36, 0]]);
      o.connect(e).connect(dry);
      for (const dt of [0.4, 0.5, 0.6]) tone(s, dry, t + dt, 1200, 0.03, 0.3, 'square', 3000);
      chime(s, dry, t + 0.75, 1000, 0.25, 0.5);
    },
  },
  chrono: {
    dur: 3.0, peak: -6, vars: 1,
    build(s, t) {
      const dry = bus(s, 'hall', 0.45);
      const tp = t + 0.8;
      s.noiseHit(dry, t, { type: 'bandpass', f0: 300, f1: 5000, sweep: 0.8, q: 2, attack: 0.78, tau: 0.03, level: 0.5 });
      [1, 1.5, 2.01, 2.99, 4.02].forEach((r) => {
        const o = s.osc('sine', 220 * r, t, 0.85);
        s.sweep(o.frequency, t, 220 * r, tp, 440 * r);
        const g = s.gain(0);
        s.lin(g.gain, [[t, 0], [tp - 0.02, 0.12], [tp + 0.01, 0]]);
        o.connect(g).connect(dry);
      });
      s.crack(dry, tp, 0.8, 0.02, 1000, 3);
      s.thump(dry, tp, 200, 60, 0.08, 0.08, 0.7, 2);
      s.thump(dry, tp, 2000, 200, 0.15, 0.1, 0.3);
      for (const f of [1760, 2637]) {
        const o = s.osc('sine', f, tp, 3.2);
        const trem = s.gain(0.5);
        const lfo = s.osc('sine', 11, tp, 3.2);
        const lg = s.gain(0.5);
        lfo.connect(lg).connect(trem.gain);
        const g = s.gain(0);
        s.perc(g.gain, tp, 0.12, 0.02, 0.35);
        s.chain(o, trem, g, dry);
      }
    },
  },
  iron_curtain: {
    dur: 4.5, peak: -6, vars: 1,
    build(s, t) {
      const dry = bus(s, 'hall', 0.45);
      const mix = s.gain(0.4);
      for (const f of [55, 55.4, 82.5]) s.osc('sawtooth', f, t, 4.0).connect(mix);
      const lp = s.filter('lowpass', 200, 6);
      s.sweep(lp.frequency, t, 200, t + 1.2, 1500);
      const env = s.gain(0);
      s.perc(env.gain, t, 1, 0.5, 0.3, 0.9);
      s.chain(mix, lp, env, s.shaper(2), s.gain(0.6), dry);
      s.voice(dry, t + 0.1, 1.1, { pitch: [[0, 110], [1.1, 112]], vowel: 'o', level: 0.2, vibrato: 10, attack: 0.6, release: 0.3, breath: 0.2 });
      s.metal(dry, t + 1.2, 110, [1, 2.7, 4.1, 6.3, 8.2], 0.7, 0.5);
      s.thump(dry, t + 1.2, 90, 40, 0.1, 0.12, 0.6, 2);
    },
  },
  crate: {
    dur: 1.1, peak: -10, vars: 1,
    build(s, t) {
      const dry = bus(s, 'room', 0.2);
      [1046.5, 1318.5, 1568, 2093].forEach((f, i) => {
        const o = s.osc('square', f, t + i * 0.06, 1.0);
        const g = s.gain(0);
        s.perc(g.gain, t + i * 0.06, 0.25, 0.002, i === 3 ? 0.15 : 0.05);
        s.chain(o, s.filter('lowpass', 5000), g, dry);
      });
      chime(s, dry, t + 0.2, 4186, 0.1, 0.1);
    },
  },

  // ---------------------------------------------------------------------- ui
  click: {
    dur: 0.07, peak: -12, vars: 1, maxVoices: 3,
    build(s, t) {
      s.thump(s.out, t, 2400, 1400, 0.012, 0.006, 0.6);
      s.noiseHit(s.out, t, { type: 'highpass', f0: 4000, attack: 0.0004, tau: 0.0018, level: 0.5 });
      s.thump(s.out, t, 700, 500, 0.01, 0.008, 0.25);
    },
  },
  hover: {
    dur: 0.05, peak: -24, vars: 1, maxVoices: 2,
    build(s, t) { s.thump(s.out, t, 3200, 3000, 0.01, 0.005, 0.5); },
  },
  error: {
    dur: 0.35, peak: -17, vars: 1, maxVoices: 2,
    build(s, t) {
      tone(s, s.out, t, 220, 0.085, 0.4, 'square', 1600);
      tone(s, s.out, t + 0.11, 165, 0.13, 0.4, 'square', 1600);
    },
  },
  tab: {
    dur: 0.15, peak: -14, vars: 1, maxVoices: 2,
    build(s, t) {
      s.thump(s.out, t, 1300, 900, 0.02, 0.012, 0.6);
      s.thump(s.out, t, 650, 600, 0.02, 0.015, 0.3, 0, 'triangle');
      s.noiseHit(s.out, t, { type: 'highpass', f0: 3000, attack: 0.0004, tau: 0.002, level: 0.3 });
    },
  },
  ready_ping: {
    dur: 1.2, peak: -10, vars: 1, maxVoices: 2,
    build(s, t) {
      const dry = bus(s, 'room', 0.25);
      chime(s, dry, t, 1318.5, 0.18, 0.5);
      chime(s, dry, t + 0.08, 1975.5, 0.2, 0.45);
    },
  },

  // ---------------------------------------------------------------- internal
  _chirp: {
    dur: 0.2, peak: -16, vars: 1, maxVoices: 1,
    build(s, t) {
      s.noiseHit(s.out, t, { type: 'bandpass', f0: 2500, q: 1.2, attack: 0.002, tau: 0.012, level: 0.35 });
      tone(s, s.out, t + 0.03, 1450, 0.035, 0.3, 'square', 4500);
      tone(s, s.out, t + 0.075, 2150, 0.04, 0.3, 'square', 4500);
    },
  },
  _radio: {
    dur: 0.2, peak: -18, vars: 1, maxVoices: 1,
    build(s, t) {
      s.noiseHit(s.out, t, { type: 'bandpass', f0: 2800, q: 1.5, attack: 0.001, tau: 0.02, level: 0.5 });
      s.thump(s.out, t, 1800, 1600, 0.01, 0.006, 0.3);
    },
  },
};

export const ALL_SFX_KEYS = Object.keys(RECIPES).filter((k) => !k.startsWith('_')) as SfxKey[];

/** Render one variation of a recipe to a cleaned, normalised mono AudioBuffer. */
export async function renderSfx(key: AnyKey, sampleRate: number, variation = 0): Promise<PostResult & { renderMs: number }> {
  const r = RECIPES[key];
  const len = Math.ceil(r.dur * sampleRate);
  const oc = new OfflineAudioContext(1, len, sampleRate);
  const out = oc.createGain();
  out.gain.value = 0.2; // headroom inside the offline graph (result is peak-normalised anyway)
  out.connect(oc.destination);
  const s = new Synth(oc, out, mulberry32((hashStr(key) ^ Math.imul(variation + 1, 0x9e3779b1)) >>> 0));
  r.build(s, T0);
  const t0 = performance.now();
  const buf = await oc.startRendering();
  const res = postProcess(buf, r.peak);
  return { ...res, renderMs: performance.now() - t0 };
}

/** Rendering priority: UI + announcer first, then common combat sounds, then the long rare ones. */
const PRIORITY: AnyKey[] = [
  'click', 'hover', 'tab', 'error', 'ready_ping', '_chirp', '_radio', 'cash_tick',
  'rifle', 'mg', 'pistol', 'cannon_small', 'cannon_med', 'cannon_heavy', 'rocket', 'expl_piff', 'expl_small',
  'expl_medium', 'inf_die', 'build_place', 'build_rise', 'dog_bark',
];

/** Background pre-renderer + cache of SFX buffers. */
export class SfxBank {
  private bufs = new Map<AnyKey, AudioBuffer[]>();
  private queue: [AnyKey, number][] = [];
  private active = 0;
  private started = false;
  private total = 0;
  private finished = 0;
  private resolveDone!: () => void;
  readonly done: Promise<void>;
  /** Last error, if any render failed (kept for debugging, never thrown). */
  lastError: unknown = null;

  constructor(readonly sampleRate: number, private readonly concurrency = 3) {
    this.done = new Promise((res) => { this.resolveDone = res; });
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    const keys = Object.keys(RECIPES) as AnyKey[];
    const order = [...PRIORITY, ...keys.filter((k) => !PRIORITY.includes(k))];
    for (const k of order) this.queue.push([k, 0]);
    for (const k of order) for (let v = 1; v < (RECIPES[k].vars ?? 1); v++) this.queue.push([k, v]);
    this.total = this.queue.length;
    this.pump();
  }

  get progress(): number { return this.total ? this.finished / this.total : 0; }

  get(key: AnyKey): AudioBuffer[] | undefined { return this.bufs.get(key); }

  /** Move a key's first variation to the front of the queue (it was needed before it was ready). */
  request(key: AnyKey): void {
    const i = this.queue.findIndex(([k, v]) => k === key && v === 0);
    if (i > 0) this.queue.unshift(...this.queue.splice(i, 1));
  }

  private pump(): void {
    while (this.active < this.concurrency && this.queue.length) {
      const [key, v] = this.queue.shift()!;
      this.active++;
      renderSfx(key, this.sampleRate, v)
        .then((res) => {
          const arr = this.bufs.get(key) ?? [];
          arr.push(res.buffer);
          this.bufs.set(key, arr);
        })
        .catch((e) => { this.lastError = e; })
        .finally(() => {
          this.active--;
          this.finished++;
          if (this.finished >= this.total) this.resolveDone();
          this.pump();
        });
    }
  }
}
