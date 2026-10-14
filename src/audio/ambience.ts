/**
 * Living soundscape: layered procedural ambience beds, randomized nature / weather / distant-battle
 * events, thunder and a global environment reverb that follows the time of day and the weather.
 *
 *   loop beds  (BufferSource ×2 → ChannelMerger) → level ─[→ gust]─┐
 *   events     (BufferSource → gain → StereoPanner) ───────────────┼→ mix → duck ─┐
 *   thunder    ────────────────────────────────────────────────────────────────────┼→ bus (ambience volume) → dest
 *   event / thunder reverb sends → duckV → verbVol (ambience volume) ─┐
 *   SFX sends (wired by AudioSystem) ─────────────────────────────────┼→ verbIn → EnvReverb → dest
 *   EnvReverb: [conv A | conv B] (preset crossfade) → damping LP → wet → Haas-widened stereo
 *
 * All beds are pre-rendered in plain JS (./ambgen.ts) in small background tasks, so the realtime
 * cost is a handful of looping buffer sources, gains and one mono convolver. Every parameter change
 * goes through setTargetAtTime (never a step), so nothing clicks.
 *
 * Works with any BaseAudioContext: realtime uses a 100 ms timer; offline tests drive `tick()`.
 */
import { clamp, lerp, mulberry32, smoothstep, type Rng } from './dsp';
import { GENERATORS, envImpulse, genToBuffer, renderBankItem, type BankKey, type EnvIrSpec, type EventKey, type LoopKey } from './ambgen';
import type { AmbienceState, WeatherKind } from './types';

export type { AmbienceState, WeatherKind } from './types';

type Wx = Exclude<WeatherKind, 'clear'>;
const WEATHERS: Wx[] = ['rain', 'storm', 'snow', 'fog', 'dust'];
const TICK = 0.1;

/** Per-quantum (k-rate) automation: our gains/filters move slowly, so per-sample automation is wasted CPU. */
function kRate(p: AudioParam): void {
  try { if ('automationRate' in p) p.automationRate = 'k-rate'; } catch { /* unsupported: stay a-rate */ }
}
const LOOK = 0.15;
const MAX_EVENTS = 28;

/** Smoothed & derived values every layer formula reads. */
export interface Mix {
  nightRaw: number;
  day: number;
  night: number;
  rain: number;
  storm: number;
  snow: number;
  fog: number;
  dust: number;
  wind: number;
  water: number;
  forest: number;
  battle: number;
  off: number;
  zoom: number;
  /** 1 close to the ground … 0.2 at max zoom: scales the small close-up sounds. */
  detail: number;
  /** Dawn/dusk chorus bump (0..1). */
  chorus: number;
}

const DEFAULT_STATE: AmbienceState = {
  night: 0, weather: 'clear', intensity: 0, wind: 0.3, water: 0, forest: 0, battle: 0, offscreenBattle: 0, zoom: 0.4,
};

// ---------------------------------------------------------------------------
// Buffer bank (background rendering, priority on what is needed now)
// ---------------------------------------------------------------------------

const BANK_ORDER: BankKey[] = [
  'wind', 'insects', 'bird_chirp', 'bird_song', 'bird_trill', 'bird_feebee', 'leaves', 'water', 'crickets', 'cricket',
  'rain', 'drip', 'rainHeavy', 'snowWind', 'howl', 'fogDrone', 'rumble', 'boom_far', 'mg_far', 'bird_warbler', 'bird_dove',
  'woodpecker', 'bird_crow', 'flyby', 'owl', 'dog', 'frog', 'plop', 'foghorn', 'bell', 'thunder_crack', 'thunder_roll',
];

interface WorkerReply { id: number; key: BankKey; v: number; sr?: number; ch?: Float32Array[]; error?: string; ms: number }

/**
 * Buffer bank. In the game the items are rendered by a Web Worker (./ambworker.ts, two in flight,
 * whatever the current mix needs first); without worker support it falls back to main-thread
 * rendering in idle slices. Tests render everything synchronously with renderAll().
 */
export class AmbBank {
  private bufs = new Map<BankKey, AudioBuffer[]>();
  private have = new Set<string>();
  private queue: [BankKey, number][] = [];
  private wanted: BankKey[] = [];
  private worker: Worker | null = null;
  private inFlight = new Map<number, [BankKey, number]>();
  private nextId = 1;
  /** Called when the worker dies (the owner then pumps the rest on the main thread). */
  onWorkerFail: (() => void) | null = null;
  /** Per-item generation time (diagnostics). */
  readonly timings: { key: string; ms: number; worker: boolean }[] = [];
  /** Total PCM memory of rendered buffers (bytes). */
  bytes = 0;

  constructor(readonly seed = 1) {
    for (const k of BANK_ORDER) this.queue.push([k, 0]);
    for (const k of BANK_ORDER) for (let v = 1; v < GENERATORS[k].vars; v++) this.queue.push([k, v]);
  }

  get done(): boolean { return this.queue.length === 0 && this.inFlight.size === 0; }
  get pending(): number { return this.queue.length + this.inFlight.size; }
  get usingWorker(): boolean { return this.worker !== null; }
  get(key: BankKey): AudioBuffer[] | undefined { return this.bufs.get(key); }

  /** Move `key` to the front of the queue. */
  want(key: BankKey): void {
    if (!this.bufs.has(key) && !this.wanted.includes(key)) {
      this.wanted.push(key);
      this.feed();
    }
  }

  private take(): [BankKey, number] | null {
    if (!this.queue.length) return null;
    let idx = 0;
    while (this.wanted.length) {
      const w = this.wanted.shift()!;
      const i = this.queue.findIndex(([k]) => k === w);
      if (i >= 0) { idx = i; break; }
    }
    return this.queue.splice(idx, 1)[0];
  }

  /** Start background rendering in a Web Worker; false when workers are unavailable. */
  startWorker(): boolean {
    if (this.worker) return true;
    try {
      if (typeof Worker === 'undefined') return false;
      const w = new Worker(new URL('./ambworker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<WorkerReply>) => this.onReply(e.data);
      w.onerror = (e) => { e.preventDefault?.(); this.failWorker(); };
      this.worker = w;
      this.feed();
      return true;
    } catch {
      this.worker = null;
      return false;
    }
  }

  private failWorker(): void {
    if (!this.worker) return;
    try { this.worker.terminate(); } catch { /* ignore */ }
    this.worker = null;
    // re-queue whatever was in flight
    for (const item of this.inFlight.values()) this.queue.unshift(item);
    this.inFlight.clear();
    this.onWorkerFail?.();
  }

  private feed(): void {
    const w = this.worker;
    while (w && this.inFlight.size < 2) {
      const item = this.take();
      if (!item) return;
      const id = this.nextId++;
      this.inFlight.set(id, item);
      try { w.postMessage({ id, key: item[0], v: item[1], seed: this.seed }); } catch { this.failWorker(); return; }
    }
  }

  private onReply(r: WorkerReply): void {
    if (!this.inFlight.has(r.id)) return;
    this.inFlight.delete(r.id);
    if (!r.error && r.ch && r.sr) {
      try { this.add(r.key, r.v, genToBuffer({ sr: r.sr, ch: r.ch })); } catch { /* ignore */ }
    }
    this.timings.push({ key: `${r.key}#${r.v}`, ms: r.ms, worker: true });
    this.feed();
  }

  private add(key: BankKey, v: number, buf: AudioBuffer): void {
    const id = `${key}#${v}`;
    if (this.have.has(id)) return;
    this.have.add(id);
    const arr = this.bufs.get(key) ?? [];
    arr.push(buf);
    this.bufs.set(key, arr);
    this.bytes += buf.length * buf.numberOfChannels * 4;
  }

  /** Render one queued item on this thread; returns false when nothing is left. */
  renderNext(): boolean {
    const item = this.take();
    if (!item) return false;
    this.renderItem(item[0], item[1]);
    return true;
  }

  /** Synchronously render the first missing variation of `key` (used when something is needed *now*). */
  renderNow(key: BankKey): void {
    if (this.bufs.has(key)) return;
    const i = this.queue.findIndex(([k]) => k === key);
    if (i >= 0) {
      const [k, v] = this.queue.splice(i, 1)[0];
      this.renderItem(k, v);
      return;
    }
    // in flight in the worker: render a copy now; the late worker result is ignored
    for (const [k, v] of this.inFlight.values()) if (k === key) { this.renderItem(k, v); return; }
  }

  renderAll(): void { while (this.renderNext()) { /* keep going */ } }

  private renderItem(key: BankKey, v: number): void {
    const t0 = performance.now();
    try { this.add(key, v, renderBankItem(key, v, this.seed)); } catch { /* a broken generator must never take the soundscape down */ }
    this.timings.push({ key: `${key}#${v}`, ms: performance.now() - t0, worker: false });
  }
}

// ---------------------------------------------------------------------------
// Layer specifications
// ---------------------------------------------------------------------------

/** Fair-weather amount (insects, birds). */
const fair = (m: Mix) => clamp(1 - m.rain - m.storm - m.snow - m.dust - 0.6 * m.fog, 0, 1);
/** Conditions crickets / night creatures tolerate. */
const calmNight = (m: Mix) => clamp(1 - m.storm - m.snow - m.dust - 0.65 * m.rain - 0.3 * m.fog, 0, 1);

interface LoopSpec {
  key: LoopKey;
  wide: boolean;
  /** 0 = steady, 1 = full gust modulation, 2 = half. */
  gust: 0 | 1 | 2;
  /** Calibration gain. */
  gain: number;
  level(m: Mix): number;
}

export const LOOP_SPECS: LoopSpec[] = [
  { key: 'wind', wide: true, gust: 1, gain: 0.5, level: (m) => (0.2 + 0.8 * m.wind) * (0.5 + 0.9 * m.zoom) * (1 - 0.75 * m.snow) * (1 + 0.8 * m.storm + 0.25 * m.dust) * (1 - 0.5 * m.fog) },
  { key: 'snowWind', wide: true, gust: 1, gain: 0.6, level: (m) => m.snow * (0.45 + 0.55 * m.wind) * (0.75 + 0.5 * m.zoom) },
  { key: 'howl', wide: true, gust: 1, gain: 0.75, level: (m) => (m.dust * (0.6 + 0.4 * m.wind) + 0.35 * m.storm * (0.3 + 0.7 * m.wind)) * (0.75 + 0.4 * m.zoom) },
  { key: 'leaves', wide: true, gust: 1, gain: 0.36, level: (m) => m.forest * (0.3 + 0.7 * m.wind) * m.detail * (1 - m.snow) * (1 - 0.45 * (m.rain + m.storm)) * (1 - 0.5 * m.dust) },
  { key: 'insects', wide: true, gust: 0, gain: 0.2, level: (m) => m.day * fair(m) * m.detail * (1 - 0.45 * m.forest) * (1 - 0.5 * m.battle) * (1 - 0.5 * m.wind) },
  { key: 'crickets', wide: true, gust: 0, gain: 0.3, level: (m) => m.night * calmNight(m) * (0.25 + 0.75 * m.detail) * (1 - 0.5 * m.battle) * (1 - 0.3 * m.wind) },
  { key: 'water', wide: true, gust: 0, gain: 0.45, level: (m) => m.water * (0.3 + 0.7 * m.detail) * (1 + 0.4 * m.wind + 0.5 * m.storm) },
  { key: 'rain', wide: true, gust: 0, gain: 0.7, level: (m) => (m.rain + 0.4 * m.storm) * (0.75 + 0.25 * m.detail) },
  { key: 'rainHeavy', wide: true, gust: 2, gain: 0.8, level: (m) => (m.storm + 0.1 * m.rain) * (0.85 + 0.15 * m.detail) },
  { key: 'fogDrone', wide: false, gust: 0, gain: 0.22, level: (m) => m.fog * (0.6 + 0.4 * m.night) },
  { key: 'rumble', wide: false, gust: 0, gain: 0.65, level: (m) => m.off },
];

interface EventSpec {
  name: string;
  pick(m: Mix, rng: Rng): EventKey;
  /** Events per second. */
  rate(m: Mix): number;
  gain: number;
  vol: [number, number];
  pan: number;
  pitch: [number, number];
  /** Reverb send [loud/close, quiet/far]. */
  verb: [number, number];
  minGap?: number;
  /** Probability that another bird answers from elsewhere. */
  answer?: number;
  /** Pan sweep across the stereo field (fly-by). */
  sweep?: boolean;
}

function weighted<T>(rng: Rng, items: [T, number][]): T {
  let tot = 0;
  for (const [, w] of items) tot += Math.max(0, w);
  let r = rng() * tot;
  for (const [k, w] of items) { r -= Math.max(0, w); if (r <= 0) return k; }
  return items[0][0];
}

const birdWx = (m: Mix) => clamp(1 - 1.3 * (m.rain + m.storm + m.snow + m.dust) - 0.5 * m.fog, 0, 1);

export const EVENT_SPECS: EventSpec[] = [
  {
    name: 'birds', gain: 0.5, vol: [0.22, 1], pan: 0.95, pitch: [0.92, 1.1], verb: [0.12, 0.55], answer: 0.35,
    rate: (m) => Math.pow(m.day, 1.5) * (0.18 + 0.9 * m.forest) * (1 + 1.2 * m.chorus) * birdWx(m) * Math.pow(1 - m.battle, 2) * m.detail,
    pick: (m, rng) => {
      const f = m.forest;
      return weighted<EventKey>(rng, [['bird_chirp', 3 - f], ['bird_song', 2 + 1.5 * f], ['bird_feebee', 1.5], ['bird_trill', 2], ['bird_warbler', 1 + f], ['bird_crow', 0.35 + 0.4 * f], ['bird_dove', 1.6 * f], ['woodpecker', 0.8 * f]]);
    },
  },
  { name: 'flyby', gain: 0.3, vol: [0.5, 1], pan: 0.9, pitch: [0.9, 1.12], verb: [0.02, 0.1], sweep: true, minGap: 8, rate: (m) => 0.03 * m.day * fair(m) * m.detail * m.detail * (1 - m.battle), pick: () => 'flyby' },
  { name: 'cricket', gain: 0.28, vol: [0.4, 1], pan: 0.9, pitch: [0.95, 1.05], verb: [0.1, 0.3], rate: (m) => 0.12 * m.night * calmNight(m) * m.detail, pick: () => 'cricket' },
  { name: 'owl', gain: 0.42, vol: [0.4, 1], pan: 0.85, pitch: [0.94, 1.06], verb: [0.4, 0.8], minGap: 12, rate: (m) => 0.035 * m.night * m.night * (0.25 + m.forest) * calmNight(m), pick: () => 'owl' },
  { name: 'dog', gain: 0.3, vol: [0.4, 1], pan: 0.9, pitch: [0.92, 1.08], verb: [0.5, 0.9], minGap: 20, rate: (m) => 0.018 * m.night * (1 - 0.6 * m.forest) * calmNight(m) * (1 - m.battle), pick: () => 'dog' },
  { name: 'frog', gain: 0.25, vol: [0.3, 1], pan: 0.9, pitch: [0.9, 1.1], verb: [0.1, 0.35], rate: (m) => 0.5 * m.night * m.water * calmNight(m) * m.detail, pick: () => 'frog' },
  { name: 'drip', gain: 0.32, vol: [0.2, 1], pan: 0.95, pitch: [0.85, 1.2], verb: [0.05, 0.2], rate: (m) => (m.rain + m.storm) * (0.5 + 3 * m.forest) * m.detail, pick: () => 'drip' },
  { name: 'plop', gain: 0.28, vol: [0.3, 1], pan: 0.9, pitch: [0.85, 1.15], verb: [0.1, 0.3], rate: (m) => 0.06 * m.water * m.detail * (1 - m.storm), pick: () => 'plop' },
  { name: 'foghorn', gain: 0.5, vol: [0.6, 1], pan: 0.8, pitch: [0.97, 1.03], verb: [0.6, 0.9], minGap: 16, rate: (m) => 0.035 * m.fog * (0.3 + 0.7 * m.water), pick: () => 'foghorn' },
  { name: 'bell', gain: 0.22, vol: [0.5, 1], pan: 0.8, pitch: [0.95, 1.05], verb: [0.6, 0.9], minGap: 25, rate: (m) => 0.02 * m.fog * (0.3 + m.water), pick: () => 'bell' },
  { name: 'boom', gain: 0.6, vol: [0.25, 1], pan: 1, pitch: [0.85, 1.12], verb: [0.3, 0.6], rate: (m) => 1.2 * m.off, pick: () => 'boom_far' },
  { name: 'mg', gain: 0.28, vol: [0.3, 1], pan: 1, pitch: [0.9, 1.1], verb: [0.3, 0.5], rate: (m) => 0.5 * m.off, pick: () => 'mg_far' },
];

// ---------------------------------------------------------------------------
// Environment reverb
// ---------------------------------------------------------------------------

type WxClass = 'clear' | 'wet' | 'snow' | 'fog' | 'dust';

// day: short & bright open field · dusk: a little longer · night: long dark tail with valley echoes
const ENV_BASE: EnvIrSpec[] = [
  { len: 1.2, t60: 0.9, bright0: 6500, bright1: 1500, pre: 0.012, echoes: [[0.19, 0.16], [0.43, 0.09]] },
  { len: 1.6, t60: 1.35, bright0: 5500, bright1: 1000, pre: 0.018, echoes: [[0.26, 0.2], [0.6, 0.13], [1.05, 0.07]] },
  { len: 2.0, t60: 1.8, bright0: 4500, bright1: 600, pre: 0.025, echoes: [[0.34, 0.24], [0.8, 0.16], [1.35, 0.1]] },
];

export function envSpec(band: number, w: WxClass): EnvIrSpec {
  const b = ENV_BASE[clamp(band, 0, 2)];
  const mod: Record<WxClass, [number, number, number, number]> = {
    // t60 ×, brightness ×, echoes ×, len ×
    clear: [1, 1, 1, 1],
    wet: [0.8, 0.85, 0.6, 0.85],
    snow: [0.45, 0.6, 0.3, 0.6],
    fog: [1.1, 0.7, 1.2, 1.05],
    dust: [0.6, 0.6, 0.4, 0.7],
  };
  const [t, br, e, l] = mod[w];
  return {
    len: b.len * l,
    t60: b.t60 * t,
    bright0: b.bright0 * br,
    bright1: b.bright1 * br,
    pre: b.pre,
    echoes: b.echoes.filter(([et]) => et < b.len * l - 0.2).map(([et, eg]) => [et, eg * e] as [number, number]),
  };
}

/** Global "world" reverb: mono convolution with crossfaded presets, damping and Haas widening. */
export class EnvReverb {
  readonly input: GainNode;
  private readonly sum: GainNode;
  private readonly damp: BiquadFilterNode;
  private readonly wet: GainNode;
  private cur: { conv: ConvolverNode; feed: GainNode; key: string } | null = null;
  private cache = new Map<string, AudioBuffer>();
  presetKey = '';

  constructor(private readonly ctx: BaseAudioContext, out: AudioNode, private readonly realtime: boolean) {
    this.input = ctx.createGain();
    this.sum = ctx.createGain();
    this.damp = ctx.createBiquadFilter();
    this.damp.type = 'lowpass';
    this.damp.frequency.value = 8000;
    this.damp.Q.value = 0.5;
    this.wet = ctx.createGain();
    this.wet.gain.value = 0;
    kRate(this.damp.frequency);
    kRate(this.wet.gain);
    this.sum.connect(this.damp).connect(this.wet);
    if (typeof ctx.createStereoPanner === 'function') {
      const l = ctx.createStereoPanner(); l.pan.value = -0.6;
      const r = ctx.createStereoPanner(); r.pan.value = 0.6;
      const dl = ctx.createDelay(0.1); dl.delayTime.value = 0.017;
      this.wet.connect(l).connect(out);
      this.wet.connect(dl).connect(r).connect(out);
    } else {
      this.wet.connect(out);
    }
  }

  private ir(key: string, spec: EnvIrSpec): AudioBuffer {
    let b = this.cache.get(key);
    if (!b) {
      const d = envImpulse(this.ctx.sampleRate, spec, key.length * 31 + spec.len * 100);
      b = this.ctx.createBuffer(1, d.length, this.ctx.sampleRate);
      b.getChannelData(0).set(d);
      if (this.cache.size >= 6) this.cache.delete(this.cache.keys().next().value as string);
      this.cache.set(key, b);
    }
    return b;
  }

  /** Switch to an IR preset with a linear crossfade (the old convolver goes idle once silent). */
  setPreset(key: string, spec: EnvIrSpec, now: number, fade = 2.5): void {
    if (this.cur?.key === key) return;
    this.presetKey = key;
    const conv = this.ctx.createConvolver();
    try { conv.channelCount = 1; conv.channelCountMode = 'explicit'; } catch { /* keep default */ }
    conv.buffer = this.ir(key, spec);
    const feed = this.ctx.createGain();
    feed.gain.value = 0;
    kRate(feed.gain);
    this.input.connect(feed).connect(conv).connect(this.sum);
    if (!this.cur) {
      feed.gain.setValueAtTime(1, now);
    } else {
      feed.gain.setValueAtTime(0, now);
      feed.gain.linearRampToValueAtTime(1, now + fade);
      const old = this.cur;
      old.feed.gain.cancelScheduledValues(now);
      old.feed.gain.setValueAtTime(old.feed.gain.value, now);
      old.feed.gain.linearRampToValueAtTime(0, now + fade); // exactly 0 → the convolver stops processing after its tail
      if (this.realtime) {
        const tail = (old.conv.buffer?.duration ?? 3) + fade + 0.5;
        setTimeout(() => { try { old.feed.disconnect(); old.conv.disconnect(); } catch { /* ignore */ } }, tail * 1000);
      }
    }
    this.cur = { conv, feed, key };
  }

  setParams(wet: number, dampHz: number, now: number): void {
    this.wet.gain.setTargetAtTime(wet, now, 0.4);
    this.damp.frequency.setTargetAtTime(clamp(dampHz, 500, 16000), now, 0.4);
  }
}

// ---------------------------------------------------------------------------
// Soundscape
// ---------------------------------------------------------------------------

interface LoopLayer {
  spec: LoopSpec;
  level: GainNode;
  srcs: AudioBufferSourceNode[] | null;
  merger: ChannelMergerNode | null;
  applied: number;
  quiet: number;
}

interface EventLayer { spec: EventSpec; nextAllowed: number; fired: number }

export interface SoundscapeOpts {
  seed?: number;
  bank?: AmbBank;
  /** World high-shelf (snow / fog dull the highs of sfx + ambience); controlled by the soundscape. */
  shelf?: BiquadFilterNode | null;
  /** Build the environment reverb (default true). */
  reverb?: boolean;
  /** Seconds of fade-in when started (default 3). */
  fadeIn?: number;
  /** Debug: start loops ~1–3 s before their loop seam (seam-click test). */
  seamTest?: boolean;
  /** Debug: force every layer on (CPU worst case). */
  forceAll?: boolean;
  /** Debug: loop beds only, no random events (strict click test). */
  noEvents?: boolean;
}

export class Soundscape {
  readonly bank: AmbBank;
  /** Ambience bus (volume). */
  readonly bus: GainNode;
  /** Environment-reverb input (null when built without reverb). Feed SFX sends here. */
  readonly verbIn: GainNode | null;
  readonly reverb: EnvReverb | null;
  /** Diagnostics: events fired per layer, thunder count, main-thread ms spent in tick(). */
  stats = { events: 0, thunders: 0, tickMs: 0, ticks: 0 };
  /** Debug: force every bed and event layer on (CPU worst case). */
  debugForce = false;

  private readonly rng: Rng;
  private readonly realtime: boolean;
  private readonly mix: GainNode;
  private readonly duck: GainNode;
  private readonly duckV: GainNode;
  private readonly verbVol: GainNode;
  private readonly thunderBus: GainNode;
  private readonly gustFull: GainNode;
  private readonly gustHalf: GainNode;
  private readonly shelf: BiquadFilterNode | null;
  private readonly loops: LoopLayer[];
  private readonly events: EventLayer[];
  private readonly opts: SoundscapeOpts;
  private target: AmbienceState = { ...DEFAULT_STATE };
  private hasState = false;
  readonly m: Mix = {
    nightRaw: 0, day: 1, night: 0, rain: 0, storm: 0, snow: 0, fog: 0, dust: 0, wind: 0.3, water: 0, forest: 0,
    battle: 0, off: 0, zoom: 0.4, detail: 0.68, chorus: 0,
  };
  private started = false;
  private startTime = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastWall = 0;
  private annDuck = false;
  private duckApplied = -1;
  private nextGust = 0;
  private activeEv = 0;
  private nightBand = 0;
  private wxClass: WxClass = 'clear';
  private shelfApplied = 99;
  private verbApplied = -1;
  private lastPick = new Map<string, number>();

  constructor(readonly ctx: BaseAudioContext, dest: AudioNode, opts: SoundscapeOpts = {}) {
    this.opts = opts;
    this.rng = mulberry32(opts.seed ?? ((Math.random() * 0xffffffff) >>> 0));
    this.realtime = typeof AudioContext !== 'undefined' && ctx instanceof AudioContext;
    this.bank = opts.bank ?? new AmbBank(opts.seed ?? 1);
    this.shelf = opts.shelf ?? null;
    const g = (v: number) => { const n = ctx.createGain(); n.gain.value = v; kRate(n.gain); return n; };
    if (this.shelf) { kRate(this.shelf.gain); kRate(this.shelf.frequency); }
    this.bus = g(1);
    this.bus.connect(dest);
    this.mix = g(1);
    this.duck = g(0);
    this.mix.connect(this.duck).connect(this.bus);
    this.thunderBus = g(1);
    this.thunderBus.connect(this.bus);
    this.gustFull = g(1);
    this.gustHalf = g(1);
    this.gustFull.connect(this.mix);
    this.gustHalf.connect(this.mix);
    this.verbVol = g(1);
    this.duckV = g(0);
    this.duckV.connect(this.verbVol);
    if (opts.reverb !== false) {
      this.reverb = new EnvReverb(ctx, dest, this.realtime);
      this.verbIn = this.reverb.input;
      this.verbVol.connect(this.verbIn);
    } else {
      this.reverb = null;
      this.verbIn = null;
    }
    this.loops = LOOP_SPECS.map((spec) => {
      const level = g(0);
      level.connect(spec.gust === 1 ? this.gustFull : spec.gust === 2 ? this.gustHalf : this.mix);
      return { spec, level, srcs: null, merger: null, applied: 0, quiet: 0 };
    });
    this.events = EVENT_SPECS.map((spec) => ({ spec, nextAllowed: 0, fired: 0 }));
  }

  /** Ambience volume (linear gain, applied to the beds, events, thunder and their reverb sends). */
  setVolume(gain: number, tau = 0.02): void {
    const t = this.ctx.currentTime;
    this.bus.gain.setTargetAtTime(gain, t, tau);
    this.verbVol.gain.setTargetAtTime(gain, t, tau);
  }

  setState(s: Partial<AmbienceState>): void {
    const t = this.target;
    const num = (v: unknown, lo = 0, hi = 1): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : undefined);
    t.night = num(s.night) ?? t.night;
    if (s.weather && (s.weather === 'clear' || (WEATHERS as string[]).includes(s.weather))) t.weather = s.weather;
    t.intensity = num(s.intensity) ?? t.intensity;
    t.wind = num(s.wind) ?? t.wind;
    t.water = num(s.water) ?? t.water;
    t.forest = num(s.forest) ?? t.forest;
    t.battle = num(s.battle) ?? t.battle;
    t.offscreenBattle = num(s.offscreenBattle) ?? t.offscreenBattle;
    t.zoom = num(s.zoom) ?? t.zoom;
    if (!this.hasState) {
      this.hasState = true;
      this.smooth(0, true); // first state: start from it instead of fading from defaults
      if (this.started) this.startTime = this.ctx.currentTime; // and fade in from now
    }
  }

  /** Fade everything out and go idle until the next setState(). */
  reset(): void {
    this.hasState = false;
    const now = this.ctx.currentTime;
    this.duck.gain.setTargetAtTime(0, now, 0.6);
    this.duckV.gain.setTargetAtTime(0, now, 0.6);
    this.duckApplied = 0;
  }

  /** True once setState() has been called (the soundscape is silent before that). */
  get active(): boolean { return this.hasState; }

  getState(): AmbienceState { return { ...this.target }; }

  /** Announcer ducking (speech bypasses Web Audio, so this is driven explicitly). */
  setAnnouncerDuck(on: boolean): void {
    this.annDuck = on;
    if (this.started) this.applyDuck(this.ctx.currentTime, true);
  }

  /** Realtime start: background bank rendering + 100 ms scheduler. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.startTime = this.ctx.currentTime;
    this.lastWall = performance.now();
    this.bank.onWorkerFail = () => this.pumpBank();
    if (!this.bank.startWorker()) this.pumpBank();
    this.timer = setInterval(() => {
      const now = performance.now();
      const dt = clamp((now - this.lastWall) / 1000, 0, 1);
      this.lastWall = now;
      this.tick(dt);
    }, TICK * 1000);
    this.tick(0);
  }

  /** Offline start (tests): the caller renders the bank first and then drives tick(). */
  startOffline(): void {
    this.started = true;
    this.startTime = this.ctx.currentTime - (this.opts.fadeIn ?? 0);
    this.smooth(0, true);
    this.tick(0);
  }

  dispose(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.started = false;
    for (const L of this.loops) this.stopLoop(L, this.ctx.currentTime);
  }

  /** Main-thread fallback: render bank items in idle slices. */
  private pumpBank = (): void => {
    if (!this.started || this.bank.done || this.bank.usingWorker) return;
    const w = globalThis as unknown as { requestIdleCallback?: (cb: (d: { timeRemaining(): number }) => void, o?: { timeout: number }) => number };
    const work = (budget: () => number) => {
      let n = 0;
      // at least one item per slice; more while the idle budget lasts
      while ((n === 0 || budget() > 6) && this.bank.renderNext()) n++;
      if (!this.bank.done) setTimeout(this.pumpBank, 25);
    };
    if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback((d) => work(() => d.timeRemaining()), { timeout: 250 });
    else setTimeout(() => { const t0 = performance.now(); work(() => 8 - (performance.now() - t0)); }, 0);
  };

  // -------------------------------------------------------------------------
  // Mixing
  // -------------------------------------------------------------------------

  private smooth(dt: number, snap = false): void {
    const t = this.target;
    const m = this.m;
    const f = (tau: number) => (snap ? 1 : 1 - Math.exp(-dt / tau));
    m.nightRaw += (t.night - m.nightRaw) * f(1.5);
    for (const w of WEATHERS) m[w] += ((t.weather === w ? t.intensity : 0) - m[w]) * f(2.2);
    m.wind += (t.wind - m.wind) * f(1.2);
    m.water += (t.water - m.water) * f(0.8);
    m.forest += (t.forest - m.forest) * f(0.8);
    m.zoom += (t.zoom - m.zoom) * f(0.3);
    m.battle += (t.battle - m.battle) * f(t.battle > m.battle ? 0.5 : 2.5);
    m.off += (t.offscreenBattle - m.off) * f(t.offscreenBattle > m.off ? 1 : 3.5);
    m.day = 1 - smoothstep(0.3, 0.7, m.nightRaw);
    m.night = smoothstep(0.35, 0.75, m.nightRaw);
    m.detail = 1 - 0.8 * m.zoom;
    m.chorus = Math.exp(-Math.pow((m.nightRaw - 0.42) / 0.12, 2));
  }

  /** One scheduler step: smooth the mix, update layer gains, schedule events and gusts. */
  tick(dt: number): void {
    if (!this.started) return;
    const w0 = performance.now();
    try {
      const ctx = this.ctx;
      const now = ctx.currentTime;
      this.smooth(dt);
      const m = this.m;
      const force = this.debugForce || !!this.opts.forceAll;
      const on = this.hasState;
      const live = on && (!this.realtime || (ctx as AudioContext).state === 'running');

      // --- loop beds
      for (const L of this.loops) {
        const lv = on ? (force ? 0.6 : clamp(L.spec.level(m), 0, 1.6)) * L.spec.gain : 0;
        if (lv > 2e-4) {
          L.quiet = 0;
          if (!L.srcs) this.startLoop(L, now);
        } else {
          L.quiet += dt;
          if (L.srcs && L.quiet > 3) this.stopLoop(L, now);
        }
        if (Math.abs(lv - L.applied) > Math.max(1e-4, 0.015 * L.applied)) {
          L.level.gain.setTargetAtTime(lv, now, 0.12);
          L.applied = lv;
        }
      }

      // --- ducking (battle on screen, announcer) + fade-in
      this.applyDuck(now, false);

      // --- gusts
      this.gusts(now, m);
      // thunder is caller-driven: make sure its buffers exist before the first strike
      if (on && m.rain + m.storm > 0.05 && !this.bank.get('thunder_roll')) { this.bank.want('thunder_roll'); this.bank.want('thunder_crack'); }

      // --- events
      if (live && dt > 0 && !this.opts.noEvents) {
        for (const E of this.events) {
          const r = force ? Math.max(0.6, E.spec.rate(m)) : E.spec.rate(m);
          if (r <= 1e-5) continue;
          const n = this.poisson(r * dt);
          for (let i = 0; i < n; i++) {
            const when = now + LOOK + this.rng() * dt;
            if (when < E.nextAllowed) continue;
            const key = E.spec.pick(m, this.rng);
            if (this.fire(E, key, when)) {
              E.nextAllowed = when + (E.spec.minGap ?? 0);
              if (E.spec.answer && this.rng() < E.spec.answer) this.fire(E, key, when + 0.6 + this.rng() * 2, 0.7, true);
            }
          }
        }
      }

      // --- world acoustics
      this.updateWorld(now, m);
    } catch { /* never throw from the scheduler */ }
    this.stats.tickMs += performance.now() - w0;
    this.stats.ticks++;
  }

  private applyDuck(now: number, fast: boolean): void {
    const m = this.m;
    const fadeIn = this.opts.fadeIn ?? 3;
    const fi = fadeIn > 0 ? clamp((now - this.startTime) / fadeIn, 0, 1) : 1;
    const d = this.hasState ? (1 - 0.42 * m.battle) * (this.annDuck ? 0.55 : 1) * fi * fi : 0;
    if (!fast && Math.abs(d - this.duckApplied) < 0.004) return;
    const tau = fast ? (this.annDuck ? 0.1 : 0.5) : 0.25;
    this.duck.gain.setTargetAtTime(d, now, tau);
    this.duckV.gain.setTargetAtTime(d, now, tau);
    this.duckApplied = d;
  }

  private poisson(lambda: number): number {
    if (lambda < 0.05) return this.rng() < lambda ? 1 : 0;
    const L = Math.exp(-lambda);
    let k = 0, p = 1;
    do { k++; p *= this.rng(); } while (p > L && k < 20);
    return k - 1;
  }

  private gusts(now: number, m: Mix): void {
    const depth = clamp(0.1 + 0.45 * m.wind + 0.6 * m.storm + 0.5 * m.dust + 0.2 * m.snow, 0, 1);
    if (now + LOOK < this.nextGust) return;
    const t0 = Math.max(now + LOOK, this.nextGust);
    const r = this.rng;
    const wild = Math.max(m.storm, m.dust);
    const att = (0.4 + r() * 0.8) * (1 - 0.4 * wild);
    const hold = 0.3 + r() * 1.5;
    const rel = 0.7 + r() * 1.3;
    const peak = depth * (0.3 + 0.7 * r());
    this.gustFull.gain.setTargetAtTime(1 + peak, t0, att / 3);
    this.gustFull.gain.setTargetAtTime(1 - depth * 0.35, t0 + att + hold, rel / 3);
    this.gustHalf.gain.setTargetAtTime(1 + peak * 0.4, t0, att / 3);
    this.gustHalf.gain.setTargetAtTime(1 - depth * 0.12, t0 + att + hold, rel / 3);
    this.nextGust = t0 + att + hold + rel + (0.5 + r() * 4.5) * (1 - 0.6 * wild);
  }

  private updateWorld(now: number, m: Mix): void {
    // reverb preset with hysteresis on the day/dusk/night bands
    const n = m.nightRaw;
    let band = this.nightBand;
    if (band === 0 && n > 0.35) band = 1;
    if (band === 1 && n < 0.25) band = 0;
    if (band === 1 && n > 0.75) band = 2;
    if (band === 2 && n < 0.65) band = 1;
    this.nightBand = band;
    const cands: [WxClass, number][] = [['wet', m.rain + m.storm], ['snow', m.snow], ['fog', m.fog], ['dust', m.dust]];
    let best: WxClass = 'clear', bv = 0.45;
    for (const [k, v] of cands) if (v > bv) { best = k; bv = v; }
    if (best !== this.wxClass && (bv > 0.55 || best === 'clear')) this.wxClass = best;
    const rv = this.reverb;
    if (rv) {
      const key = `${band}:${this.wxClass}`;
      rv.setPreset(key, envSpec(band, this.wxClass), now);
      // the night IR itself is longer/denser (≈ +5 dB of tail energy); the wet gain only follows the weather
      const wet = 0.3 * (1 - 0.6 * m.snow) * (1 - 0.1 * m.fog) * (1 - 0.2 * (m.rain + m.storm)) * (1 - 0.3 * m.dust);
      const damp = 9000 * (1 - 0.55 * m.snow) * (1 - 0.45 * m.fog) * (1 - 0.3 * (m.rain + m.storm)) * (1 - 0.45 * m.dust) * (1 - 0.25 * n);
      if (Math.abs(wet - this.verbApplied) > 0.004) {
        rv.setParams(wet, damp, now);
        this.verbApplied = wet;
      }
    }
    if (this.shelf) {
      const db = -(7 * m.snow + 3 * m.fog + 1 * m.rain + 1.5 * m.storm + 2.5 * m.dust);
      if (Math.abs(db - this.shelfApplied) > 0.1) {
        this.shelf.gain.setTargetAtTime(db, now, 0.4);
        this.shelfApplied = db;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Loops & events
  // -------------------------------------------------------------------------

  private startLoop(L: LoopLayer, now: number): void {
    const bufs = this.bank.get(L.spec.key);
    if (!bufs || !bufs.length) { this.bank.want(L.spec.key); return; }
    const buf = bufs[0];
    const dur = buf.duration;
    const ctx = this.ctx;
    const offs = this.opts.seamTest ? [dur - 1.2, dur - 2.9] : [this.rng() * dur, 0];
    if (!this.opts.seamTest) offs[1] = (offs[0] + dur * (0.4 + 0.2 * this.rng())) % dur;
    L.level.gain.cancelScheduledValues(now);
    L.level.gain.setValueAtTime(0, now);
    L.applied = 0;
    const srcs: AudioBufferSourceNode[] = [];
    if (L.spec.wide) {
      const mg = ctx.createChannelMerger(2);
      for (let c = 0; c < 2; c++) {
        const s = ctx.createBufferSource();
        s.buffer = buf;
        s.loop = true;
        s.connect(mg, 0, c);
        s.start(now, offs[c]);
        srcs.push(s);
      }
      mg.connect(L.level);
      L.merger = mg;
    } else {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      s.connect(L.level);
      s.start(now, offs[0]);
      srcs.push(s);
    }
    L.srcs = srcs;
  }

  private stopLoop(L: LoopLayer, now: number): void {
    if (!L.srcs) return;
    L.level.gain.cancelScheduledValues(now);
    L.level.gain.setTargetAtTime(0, now, 0.05);
    L.applied = 0;
    const srcs = L.srcs, mg = L.merger;
    for (const s of srcs) {
      try { s.stop(now + 0.5); } catch { /* ignore */ }
    }
    srcs[0].onended = () => { for (const s of srcs) { try { s.disconnect(); } catch { /* ignore */ } } try { mg?.disconnect(); } catch { /* ignore */ } };
    L.srcs = null;
    L.merger = null;
  }

  private fire(E: EventLayer, key: EventKey, when: number, volMul = 1, answer = false): boolean {
    if (this.activeEv >= MAX_EVENTS) return false;
    const bufs = this.bank.get(key);
    if (!bufs || !bufs.length) { this.bank.want(key); return false; }
    const r = this.rng;
    const ctx = this.ctx;
    const sp = E.spec;
    // pick a variation, avoiding immediate repeats
    let vi = Math.floor(r() * bufs.length);
    if (bufs.length > 1 && vi === this.lastPick.get(key)) vi = (vi + 1) % bufs.length;
    this.lastPick.set(key, vi);
    const buf = bufs[vi];
    const v = lerp(sp.vol[0], sp.vol[1], r()) * volMul;
    const rate = lerp(sp.pitch[0], sp.pitch[1], r());
    const pan = (answer ? -Math.sign(r() - 0.5) : r() * 2 - 1) * sp.pan * (answer ? 0.5 + 0.5 * r() : 1);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = sp.gain * v;
    src.connect(g);
    let out: AudioNode = g;
    let p: StereoPannerNode | null = null;
    if (typeof ctx.createStereoPanner === 'function') {
      p = ctx.createStereoPanner();
      if (sp.sweep) {
        const dir = r() < 0.5 ? -1 : 1;
        p.pan.setValueAtTime(-0.9 * dir, when);
        p.pan.linearRampToValueAtTime(0.9 * dir, when + buf.duration / rate);
      } else p.pan.value = clamp(pan, -1, 1);
      g.connect(p);
      out = p;
    }
    out.connect(this.mix);
    const send = lerp(sp.verb[1], sp.verb[0], clamp(v, 0, 1));
    let sg: GainNode | null = null;
    if (this.verbIn && send > 0.01) {
      sg = ctx.createGain();
      sg.gain.value = send;
      g.connect(sg).connect(this.duckV);
    }
    src.start(when);
    this.activeEv++;
    this.stats.events++;
    E.fired++;
    src.onended = () => {
      this.activeEv--;
      try { g.disconnect(); p?.disconnect(); sg?.disconnect(); } catch { /* ignore */ }
    };
    return true;
  }

  // -------------------------------------------------------------------------
  // Thunder
  // -------------------------------------------------------------------------

  /** Crack + rolling rumble. distanceCells: 0 = overhead … ≥ 48 = far (low-passed, no crack). */
  thunder(distanceCells: number, intensity: number, pan?: number): void {
    if (!this.started) return;
    try {
      const ctx = this.ctx;
      const d = clamp(Number.isFinite(distanceCells) ? distanceCells / 48 : 0.5, 0, 1);
      const I = clamp(Number.isFinite(intensity) ? intensity : 1, 0, 1.5);
      if (I < 0.01) return;
      if (!this.bank.get('thunder_roll')) this.bank.renderNow('thunder_roll');
      if (d < 0.8 && !this.bank.get('thunder_crack')) this.bank.renderNow('thunder_crack');
      const r = this.rng;
      const now = ctx.currentTime + 0.02;
      const pn = clamp(Number.isFinite(pan as number) ? (pan as number) : (r() * 2 - 1) * 0.6, -1, 1);
      const mk = (buf: AudioBuffer, gain: number, lpHz: number, panV: number, send: number, at: number, rate: number) => {
        const s = ctx.createBufferSource();
        s.buffer = buf;
        s.playbackRate.value = rate;
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = lpHz;
        f.Q.value = 0.6;
        const g = ctx.createGain();
        g.gain.value = gain;
        s.connect(f).connect(g);
        let out: AudioNode = g;
        if (typeof ctx.createStereoPanner === 'function') {
          const p = ctx.createStereoPanner();
          p.pan.value = panV;
          g.connect(p);
          out = p;
        }
        out.connect(this.thunderBus);
        let sg: GainNode | null = null;
        if (this.verbIn && send > 0) {
          sg = ctx.createGain();
          sg.gain.value = send;
          g.connect(sg).connect(this.verbVol);
        }
        s.start(at);
        s.onended = () => { try { g.disconnect(); f.disconnect(); sg?.disconnect(); } catch { /* ignore */ } };
      };
      const rolls = this.bank.get('thunder_roll');
      if (rolls?.length) {
        const buf = rolls[Math.floor(r() * rolls.length)];
        const lp = 7000 * Math.pow(220 / 7000, Math.pow(d, 0.7));
        mk(buf, 1.1 * I * (0.4 + 0.6 * Math.pow(1 - d, 0.7)), lp, pn * 0.5, 0.3 + 0.4 * d, now + (1 - d) * 0.06, 0.85 + 0.23 * r());
      }
      const cracks = this.bank.get('thunder_crack');
      const cg = I * Math.pow(1 - d, 2.2);
      if (cracks?.length && cg > 0.02) {
        const buf = cracks[Math.floor(r() * cracks.length)];
        mk(buf, 0.95 * cg, lerp(15000, 2200, Math.sqrt(d)), pn, 0.3, now, 0.92 + 0.16 * r());
      }
      this.stats.thunders++;
    } catch { /* ignore */ }
  }

  // -------------------------------------------------------------------------
  // Diagnostics
  // -------------------------------------------------------------------------

  /** Current (target) gain of every loop bed and the current event rates (per minute). */
  levels(): { loops: Record<string, number>; events: Record<string, number>; reverb: string; activeEvents: number } {
    const loops: Record<string, number> = {};
    for (const L of this.loops) loops[L.spec.key] = L.applied;
    const events: Record<string, number> = {};
    for (const E of this.events) events[E.spec.name] = this.hasState ? E.spec.rate(this.m) * 60 : 0;
    return { loops, events, reverb: this.reverb?.presetKey ?? '-', activeEvents: this.activeEv };
  }

  /** Number of loop beds currently playing. */
  get activeLoops(): number { return this.loops.filter((l) => l.srcs).length; }
}

// ---------------------------------------------------------------------------
// Offline rendering (self-test / CPU measurement)
// ---------------------------------------------------------------------------

export interface OfflineAmbOpts {
  sr?: number;
  seed?: number;
  bank?: AmbBank;
  seamTest?: boolean;
  forceAll?: boolean;
  reverb?: boolean;
  /** Linear output gain (default: ambience 0.7² × master 0.85²). */
  volume?: number;
  /** Scheduler step (s). */
  chunk?: number;
  /** Called at every chunk boundary (for scripted state changes / thunder). */
  script?: (t: number, s: Soundscape) => void;
  /** Extra source to feed through the env reverb (calibration): played at t=1.5 s via a send of 1. */
  probe?: AudioBuffer;
  probeDry?: boolean;
  noEvents?: boolean;
}

export async function renderSoundscapeOffline(state: Partial<AmbienceState> | null, seconds: number, o: OfflineAmbOpts = {}): Promise<{ buffer: AudioBuffer; renderMs: number; tickMs: number; events: number; loops: number }> {
  const sr = o.sr ?? 48000;
  const oc = new OfflineAudioContext(2, Math.ceil(seconds * sr), sr);
  const shelf = oc.createBiquadFilter();
  shelf.type = 'highshelf';
  shelf.frequency.value = 3200;
  shelf.gain.value = 0;
  const out = oc.createGain();
  out.gain.value = o.volume ?? 0.49 * 0.7225;
  shelf.connect(out).connect(oc.destination);
  const bank = o.bank ?? new AmbBank(o.seed ?? 1);
  bank.renderAll();
  const s = new Soundscape(oc, shelf, { seed: o.seed ?? 7, bank, shelf, reverb: o.reverb, seamTest: o.seamTest, forceAll: o.forceAll, noEvents: o.noEvents, fadeIn: 0 });
  s.setVolume(1, 0.001);
  if (state) s.setState(state);
  if (o.probe) {
    const p = oc.createBufferSource();
    p.buffer = o.probe;
    const pg = oc.createGain();
    pg.gain.value = 1;
    p.connect(pg);
    if (o.probeDry) pg.connect(shelf);
    if (s.verbIn) pg.connect(s.verbIn);
    p.start(1.5);
  }
  s.startOffline();
  const chunk = o.chunk ?? TICK;
  let maxLoops = s.activeLoops;
  for (let t = chunk; t < seconds - 0.01; t += chunk) {
    const at = Math.round(t * sr) / sr;
    oc.suspend(at).then(() => {
      o.script?.(at, s);
      s.tick(chunk);
      maxLoops = Math.max(maxLoops, s.activeLoops);
      return oc.resume();
    }).catch(() => { /* ignore */ });
  }
  const t0 = performance.now();
  const buffer = await oc.startRendering();
  return { buffer, renderMs: performance.now() - t0, tickMs: s.stats.tickMs, events: s.stats.events, loops: maxLoops };
}
