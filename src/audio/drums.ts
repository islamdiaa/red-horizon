/**
 * Drum-kit one-shots for the music engine, computed directly in JS (no audio graph) when an
 * engine is created (~10 ms). Playing a drum hit is then just BufferSource → Gain, which keeps
 * the realtime node count low during dense battle patterns.
 */
import { makeBuffer, mulberry32, type Rng } from './dsp';

export type DrumName = 'kick' | 'snare' | 'clap' | 'hat' | 'ohat' | 'crash' | 'tom190' | 'tom140' | 'tom100' | 'tom82' | 'metal';
export type DrumKit = Record<DrumName, AudioBuffer[]>;

/** RBJ biquad, processed in place. */
function biquad(x: Float32Array, sr: number, type: 'lowpass' | 'highpass' | 'bandpass', f: number, q: number): void {
  const w = (2 * Math.PI * Math.min(f, sr * 0.45)) / sr;
  const cs = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  let b0: number, b1: number, b2: number;
  if (type === 'lowpass') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; }
  else if (type === 'highpass') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; }
  else { b0 = alpha; b1 = 0; b2 = -alpha; }
  const a0 = 1 + alpha;
  const a1 = -2 * cs;
  const a2 = 1 - alpha;
  b0 /= a0; b1 /= a0; b2 /= a0;
  const c1 = a1 / a0, c2 = a2 / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    const y = b0 * xi + b1 * x1 + b2 * x2 - c1 * y1 - c2 * y2;
    x2 = x1; x1 = xi; y2 = y1; y1 = y;
    x[i] = y;
  }
}

function noise(n: number, rng: Rng): Float32Array {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = rng() * 2 - 1;
  return a;
}

/** Linear attack then exponential decay (time constant tau), starting after `hold`. */
function env(t: number, attack: number, tau: number, hold = 0): number {
  if (t < attack) return t / attack;
  const d = t - attack - hold;
  return d <= 0 ? 1 : Math.exp(-d / tau);
}

function toBuffer(d: Float32Array, sr: number): AudioBuffer {
  // short fade-out so a buffer never ends on a non-zero sample
  const fo = Math.min(d.length, Math.floor(sr * 0.005));
  for (let i = 0; i < fo; i++) d[d.length - 1 - i] *= i / fo;
  const b = makeBuffer(1, d.length, sr);
  b.getChannelData(0).set(d);
  return b;
}

function kick(sr: number, rng: Rng): Float32Array {
  const n = Math.floor(sr * 0.55);
  const out = new Float32Array(n);
  const click = noise(Math.floor(sr * 0.03), rng);
  biquad(click, sr, 'highpass', 2500, 0.7);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = t < 0.07 ? 155 * Math.pow(52 / 155, t / 0.07) : Math.max(40, 52 * Math.pow(40 / 52, (t - 0.07) / 0.23));
    ph += (2 * Math.PI * f) / sr;
    let v = Math.sin(ph) * 0.3 * env(t, 0.002, 0.1, 0.018);
    if (i < click.length) v += click[i] * 0.1 * env(t, 0.0005, 0.005);
    out[i] = v;
  }
  return out;
}

function snare(sr: number, rng: Rng): Float32Array {
  const n = Math.floor(sr * 0.5);
  const nz = noise(n, rng);
  biquad(nz, sr, 'bandpass', 1900, 0.9);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = 165 + 45 * Math.exp(-t / 0.02);
    ph += f / sr;
    const tri = 1 - 4 * Math.abs((ph % 1) - 0.5);
    nz[i] = nz[i] * 0.56 * env(t, 0.001, 0.065) + tri * 0.4 * env(t, 0.001, 0.045);
  }
  return nz;
}

function clap(sr: number, rng: Rng): Float32Array {
  const n = Math.floor(sr * 0.6);
  const nz = noise(n, rng);
  biquad(nz, sr, 'bandpass', 1300, 1.2);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let e: number;
    if (t < 0.001) e = t / 0.001;
    else if (t < 0.01) e = 1 - 0.8 * ((t - 0.001) / 0.009);
    else if (t < 0.012) e = 0.2 + 0.8 * ((t - 0.01) / 0.002);
    else if (t < 0.021) e = 1 - 0.8 * ((t - 0.012) / 0.009);
    else if (t < 0.023) e = 0.2 + 0.8 * ((t - 0.021) / 0.002);
    else e = Math.exp(-(t - 0.023) / 0.07);
    nz[i] *= e;
  }
  return nz;
}

function hat(sr: number, rng: Rng, tau: number): Float32Array {
  const n = Math.floor(sr * (tau * 8 + 0.002));
  const nz = noise(n, rng);
  biquad(nz, sr, 'highpass', 7200, 0.7);
  biquad(nz, sr, 'highpass', 7200, 0.7);
  for (let i = 0; i < n; i++) nz[i] *= 0.38 * env(i / sr, 0.0008, tau);
  return nz;
}

function crash(sr: number, rng: Rng): Float32Array {
  const n = Math.floor(sr * 3.6);
  const nz = noise(n, rng);
  biquad(nz, sr, 'highpass', 4200, 0.7);
  for (let i = 0; i < n; i++) nz[i] *= 0.3 * env(i / sr, 0.002, 0.6);
  return nz;
}

function tom(sr: number, f: number): Float32Array {
  const n = Math.floor(sr * 0.95);
  const out = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const ff = t < 0.1 ? f * 1.5 * Math.pow(1 / 1.5, t / 0.1) : f;
    ph += (2 * Math.PI * ff) / sr;
    out[i] = Math.sin(ph) * 0.8 * env(t, 0.002, 0.13);
  }
  return out;
}

function metal(sr: number, ratio: number): Float32Array {
  const n = Math.floor(sr * 0.7);
  const out = new Float32Array(n);
  const fs = [317, 491, 768].map((f) => f * ratio);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let v = 0;
    for (const f of fs) v += (t * f) % 1 < 0.5 ? 1 : -1;
    out[i] = v / 3;
  }
  biquad(out, sr, 'bandpass', 2000, 1.2);
  for (let i = 0; i < n; i++) out[i] *= 0.22 * 3 * env(i / sr, 0.001, 0.09);
  return out;
}

export function renderDrumKit(sampleRate: number, seed: number, metalRatio: number): DrumKit {
  const rng = mulberry32(seed ^ 0x2545f491);
  const sr = sampleRate;
  const many = (k: number, f: () => Float32Array) => Array.from({ length: k }, () => toBuffer(f(), sr));
  return {
    kick: many(2, () => kick(sr, rng)),
    snare: many(3, () => snare(sr, rng)),
    clap: many(2, () => clap(sr, rng)),
    hat: many(4, () => hat(sr, rng, 0.016)),
    ohat: many(2, () => hat(sr, rng, 0.08)),
    crash: many(1, () => crash(sr, rng)),
    tom190: many(1, () => tom(sr, 190)),
    tom140: many(1, () => tom(sr, 140)),
    tom100: many(1, () => tom(sr, 100)),
    tom82: many(1, () => tom(sr, 82)),
    metal: many(1, () => metal(sr, metalRatio)),
  };
}
