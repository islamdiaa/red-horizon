/**
 * Low-level DSP helpers shared by the SFX renderer and the music engine:
 * seeded RNG, cached noise / impulse-response buffers, waveshaper curves,
 * buffer post-processing (DC removal, trimming, normalisation) and level stats.
 * Everything here is pure / side-effect free apart from small caches.
 */

export type Rng = () => number;

/** Small fast seeded PRNG (mulberry32). Returns floats in [0, 1). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a string hash → uint32 (used to derive per-sound seeds). */
export function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}
export const dbToGain = (db: number): number => Math.pow(10, db / 20);
export const gainToDb = (g: number): number => 20 * Math.log10(Math.max(Math.abs(g), 1e-12));
export const midiToHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

/** Construct an AudioBuffer without needing a context (falls back to a throwaway offline context). */
export function makeBuffer(channels: number, length: number, sampleRate: number): AudioBuffer {
  try {
    return new AudioBuffer({ numberOfChannels: channels, length: Math.max(1, length), sampleRate });
  } catch {
    const oc = new OfflineAudioContext(channels, Math.max(1, length), sampleRate);
    return oc.createBuffer(channels, Math.max(1, length), sampleRate);
  }
}

// ---------------------------------------------------------------------------
// Noise
// ---------------------------------------------------------------------------

export type NoiseColor = 'white' | 'pink';
const noiseCache = new Map<string, AudioBuffer>();

/** 4-second looping mono noise buffer (deterministic content), cached per sample rate. */
export function noiseBuffer(sampleRate: number, color: NoiseColor = 'white'): AudioBuffer {
  const k = `${color}@${sampleRate}`;
  const hit = noiseCache.get(k);
  if (hit) return hit;
  const len = Math.floor(sampleRate * 4);
  const buf = makeBuffer(1, len, sampleRate);
  const d = buf.getChannelData(0);
  const rng = mulberry32(color === 'white' ? 0x1234567 : 0x7654321);
  if (color === 'white') {
    for (let i = 0; i < len; i++) d[i] = rng() * 2 - 1;
  } else {
    // Paul Kellet's refined pink noise filter.
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    let peak = 0;
    for (let i = 0; i < len; i++) {
      const w = rng() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      const v = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
      d[i] = v;
    }
    // remove DC + normalise
    let mean = 0;
    for (let i = 0; i < len; i++) mean += d[i];
    mean /= len;
    for (let i = 0; i < len; i++) {
      d[i] -= mean;
      peak = Math.max(peak, Math.abs(d[i]));
    }
    const g = 0.98 / (peak || 1);
    for (let i = 0; i < len; i++) d[i] *= g;
  }
  // Crossfade the loop seam (last 20 ms blends into the first samples) so looping never clicks.
  const xf = Math.floor(sampleRate * 0.02);
  for (let i = 0; i < xf; i++) {
    const w = i / xf;
    d[len - xf + i] = d[len - xf + i] * (1 - w) + d[i] * w;
  }
  noiseCache.set(k, buf);
  return buf;
}

// ---------------------------------------------------------------------------
// Impulse responses (procedural convolution reverb)
// ---------------------------------------------------------------------------

export type IrKind = 'room' | 'hall' | 'outdoor' | 'huge' | 'music';

interface IrSpec { len: number; t60: number; bright0: number; bright1: number; pre: number; early: number; echoes?: [number, number][] }

const IR_SPECS: Record<IrKind, IrSpec> = {
  room: { len: 0.6, t60: 0.45, bright0: 7000, bright1: 2500, pre: 0.004, early: 6 },
  hall: { len: 2.2, t60: 1.8, bright0: 8000, bright1: 1500, pre: 0.012, early: 8 },
  // open battlefield: short diffuse part plus a few discrete slap-back echoes off terrain
  outdoor: { len: 2.0, t60: 1.4, bright0: 5000, bright1: 700, pre: 0.008, early: 4, echoes: [[0.18, 0.35], [0.41, 0.22], [0.77, 0.12]] },
  huge: { len: 5.5, t60: 4.8, bright0: 3500, bright1: 300, pre: 0.02, early: 5, echoes: [[0.6, 0.4], [1.3, 0.3], [2.2, 0.18]] },
  music: { len: 1.9, t60: 1.6, bright0: 9000, bright1: 1800, pre: 0.015, early: 10 },
};

const irCache = new Map<string, AudioBuffer>();

/** Exponentially decaying filtered noise with early reflections; darker towards the tail. */
export function impulseResponse(sampleRate: number, kind: IrKind, channels = 1): AudioBuffer {
  const k = `${kind}@${sampleRate}x${channels}`;
  const hit = irCache.get(k);
  if (hit) return hit;
  const s = IR_SPECS[kind];
  const len = Math.floor(s.len * sampleRate);
  const buf = makeBuffer(channels, len, sampleRate);
  for (let ch = 0; ch < channels; ch++) {
    const d = buf.getChannelData(ch);
    const rng = mulberry32(hashStr(kind) + ch * 7919);
    const pre = Math.floor(s.pre * sampleRate);
    let y = 0;
    const ratio = s.bright1 / s.bright0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sampleRate;
      const frac = t / s.len;
      const fc = s.bright0 * Math.pow(ratio, frac);
      const a = 1 - Math.exp((-2 * Math.PI * fc) / sampleRate);
      y += a * (rng() * 2 - 1 - y);
      const env = Math.exp((-6.9 * t) / s.t60);
      // compensate for energy lost to the lowpass so the decay curve stays as specified
      d[i] = y * env * Math.sqrt(1 / Math.max(a, 0.02)) * 0.25;
    }
    // early reflections
    for (let e = 0; e < s.early; e++) {
      const tt = s.pre + 0.003 + rng() * 0.06;
      const idx = Math.floor(tt * sampleRate);
      if (idx < len) d[idx] += (rng() < 0.5 ? -1 : 1) * (0.6 - e * 0.04) * (0.5 + rng() * 0.5);
    }
    // discrete echoes (smeared over a few ms so they are not pure clicks)
    if (s.echoes) {
      for (const [et, eg] of s.echoes) {
        const start = Math.floor((et + (ch ? 0.011 : 0)) * sampleRate);
        const w = Math.floor(0.012 * sampleRate);
        let z = 0;
        for (let i = 0; i < w && start + i < len; i++) {
          z += 0.15 * (rng() * 2 - 1 - z);
          d[start + i] += z * eg * 4 * Math.sin((Math.PI * i) / w);
        }
      }
    }
    // short fade-out on the very end
    const fo = Math.floor(0.05 * sampleRate);
    for (let i = 0; i < fo; i++) d[len - 1 - i] *= i / fo;
  }
  irCache.set(k, buf);
  return buf;
}

// ---------------------------------------------------------------------------
// Waveshaper curves
// ---------------------------------------------------------------------------

const curveCache = new Map<string, Float32Array<ArrayBuffer>>();

/** Symmetric tanh soft-clip curve normalised so that ±1 maps to ±1 (no DC offset). */
export function softClipCurve(drive: number, n = 2048): Float32Array<ArrayBuffer> {
  const k = `tanh${drive.toFixed(2)}`;
  const hit = curveCache.get(k);
  if (hit) return hit;
  const c = new Float32Array(n);
  const norm = Math.tanh(Math.max(drive, 0.01));
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(drive * x) / norm;
  }
  curveCache.set(k, c);
  return c;
}

/** Harder "fuzz" curve: drive into a cubic soft limiter (flat-topped), symmetric. */
export function fuzzCurve(drive: number, n = 2048): Float32Array<ArrayBuffer> {
  const k = `fuzz${drive.toFixed(2)}`;
  const hit = curveCache.get(k);
  if (hit) return hit;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const y = clamp(x * drive, -1, 1);
    c[i] = 1.5 * (y - (y * y * y) / 3);
  }
  curveCache.set(k, c);
  return c;
}

// ---------------------------------------------------------------------------
// Post-processing & analysis
// ---------------------------------------------------------------------------

export interface LevelStats {
  duration: number;
  peak: number;     // linear
  rms: number;      // linear
  nan: boolean;
}

export function analyze(buf: AudioBuffer): LevelStats {
  let peak = 0;
  let sum = 0;
  let n = 0;
  let nan = false;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) {
      const v = d[i];
      if (!Number.isFinite(v)) { nan = true; continue; }
      const a = Math.abs(v);
      if (a > peak) peak = a;
      sum += v * v;
      n++;
    }
  }
  return { duration: buf.duration, peak, rms: Math.sqrt(sum / Math.max(1, n)), nan };
}

/** RMS over the "active" part of the sound (samples within 40 dB of peak), a better loudness proxy for one-shots. */
export function activeRms(d: Float32Array, peak: number): number {
  const thr = peak * 0.01;
  let sum = 0;
  let n = 0;
  const win = 256;
  for (let i = 0; i < d.length; i += win) {
    let s = 0;
    let m = 0;
    const end = Math.min(d.length, i + win);
    for (let j = i; j < end; j++) {
      s += d[j] * d[j];
      m = Math.max(m, Math.abs(d[j]));
    }
    if (m > thr) { sum += s; n += end - i; }
  }
  return Math.sqrt(sum / Math.max(1, n));
}

export interface PostResult {
  buffer: AudioBuffer;
  rawPeak: number;
  rawNan: boolean;
  peak: number;
  rms: number;
  activeRms: number;
  /** RMS of the 50 ms before the fade-out, relative to peak (linear). */
  tailRel: number;
}

/**
 * Clean up a freshly rendered mono SFX buffer: replace NaN, remove DC, trim the silent tail
 * (−66 dB below peak), apply tiny fades, and normalise the peak to `targetDb` dBFS.
 */
export function postProcess(buf: AudioBuffer, targetDb: number): PostResult {
  const sr = buf.sampleRate;
  const d = buf.getChannelData(0);
  let rawNan = false;
  let rawPeak = 0;
  for (let i = 0; i < d.length; i++) {
    const v = d[i];
    if (!Number.isFinite(v)) { d[i] = 0; rawNan = true; continue; }
    const a = Math.abs(v);
    if (a > rawPeak) rawPeak = a;
  }
  // DC blocker (one-pole high-pass, ~4 Hz)
  const R = 1 - (2 * Math.PI * 4) / sr;
  let x1 = 0, y1 = 0, peak = 0;
  for (let i = 0; i < d.length; i++) {
    const x = d[i];
    const y = x - x1 + R * y1;
    x1 = x;
    y1 = y;
    d[i] = y;
    const a = Math.abs(y);
    if (a > peak) peak = a;
  }
  // trim tail
  let end = d.length;
  if (peak > 1e-9) {
    const thr = peak * dbToGain(-66);
    let last = 0;
    for (let i = d.length - 1; i >= 0; i--) if (Math.abs(d[i]) > thr) { last = i; break; }
    end = Math.min(d.length, last + Math.floor(sr * 0.015) + 1);
  }
  // fades
  const fi = Math.min(Math.floor(sr * 0.0008), end);
  for (let i = 0; i < fi; i++) d[i] *= i / fi;
  // tail level just before the fade (diagnostic: how much reverb tail gets cut)
  const fo = Math.min(Math.floor(sr * 0.2), Math.floor(end * 0.12));
  let tailSum = 0;
  const tw = Math.min(Math.floor(sr * 0.05), end - fo);
  for (let i = end - fo - tw; i < end - fo; i++) if (i >= 0) tailSum += d[i] * d[i];
  const tailRms = Math.sqrt(tailSum / Math.max(1, tw));
  for (let i = 0; i < fo; i++) {
    const w = i / fo; // 0 at the very end → 1 at fade start
    d[end - 1 - i] *= w * w * (3 - 2 * w);
  }
  // normalise
  const g = peak > 1e-9 ? dbToGain(targetDb) / peak : 0;
  const out = end < d.length ? makeBuffer(1, end, sr) : buf;
  const od = out.getChannelData(0);
  let sum = 0;
  for (let i = 0; i < end; i++) {
    const v = d[i] * g;
    od[i] = v;
    sum += v * v;
  }
  const finalPeak = peak * g;
  return {
    buffer: out,
    rawPeak,
    rawNan,
    peak: finalPeak,
    rms: Math.sqrt(sum / Math.max(1, end)),
    activeRms: activeRms(od, finalPeak),
    tailRel: peak > 1e-9 ? tailRms / peak : 0,
  };
}
