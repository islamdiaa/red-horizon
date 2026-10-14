/**
 * Procedural adaptive soundtrack: an original, seeded, industrial-military electronic score.
 *
 * Three layers play in lock-step on one 16th-note grid and are crossfaded by intensity:
 *   0 calm   – pads, sub bass, sparse plucked pulse, ticking clock, distant pings
 *   1 build  – half-time kick, clap, hats, gritty 8th bass pulse, 16th arpeggio, risers
 *   2 battle – driving kick/snare/hats, distorted 16th bass, chugging power chords, stabs, lead
 * Arrangement is generated per 8-bar section (progressions, mutated pattern templates,
 * generated lead motifs, fills on every 8th bar, occasional breakdowns, key changes).
 *
 * The engine works with any BaseAudioContext: in realtime it runs a setInterval lookahead
 * scheduler; offline (tests) the caller drives `scheduleUntil()` directly.
 */
import { clamp, fuzzCurve, impulseResponse, midiToHz, mulberry32, noiseBuffer, smoothstep, softClipCurve, type Rng } from './dsp';
import { renderDrumKit, type DrumKit, type DrumName } from './drums';

const SCALES: Record<string, number[]> = {
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  harmonic: [0, 2, 3, 5, 7, 8, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
};

// Chord degrees per bar. Every chord used with a scale has a perfect fifth in that scale, because the
// power-chord timbre is root + just fifth + octave (no diminished chords under the chugs).
const PROGS: { deg: number[]; scales: string[] }[] = [
  { deg: [0, 0, 5, 6, 0, 0, 5, 4], scales: ['aeolian'] },
  { deg: [0, 5, 3, 6, 0, 5, 3, 4], scales: ['aeolian'] },
  { deg: [0, 0, 1, 1, 0, 0, 6, 6], scales: ['phrygian'] },
  { deg: [0, 3, 0, 3, 5, 6, 0, 0], scales: ['aeolian'] },
  { deg: [0, 0, 0, 0, 5, 5, 6, 6], scales: ['aeolian', 'phrygian'] },
  { deg: [0, 6, 5, 6, 0, 6, 5, 4], scales: ['aeolian'] },
  { deg: [0, 1, 0, 6, 0, 1, 5, 6], scales: ['phrygian'] },
  { deg: [0, 0, 3, 3, 5, 5, 4, 4], scales: ['harmonic', 'aeolian'] },
  { deg: [0, 0, 5, 5, 3, 3, 4, 4], scales: ['harmonic'] },
  { deg: [0, 3, 0, 3, 6, 6, 3, 3], scales: ['dorian'] },
];

// 16-step pattern templates. Bass: x root, o octave, f fifth. Chug: A open accent, x palm-muted.
const KICKS = ['x...x...x...x...', 'x..x..x...x..x..', 'x...x..xx...x...', 'x.x...x.x.x...x.', 'x...x...x...x.x.', 'x..x....x.xx....', 'x.....x.x.....x.'];
const SNARES = ['....x.......x...', '....x.......x..x', '....x..x....x...', '....x.......x.xx', '....x....x..x...'];
const HATS = ['xxxxxxxxxxxxxxxx', 'x.x.x.x.x.x.x.x.', '.x.o.x.o.x.o.x.o', 'xx.xxx.xxx.xxx.o', 'x.xxx.xxx.xxx.xx'];
const BASSES = ['x.xxx.xxx.xxx.xo', 'xxoxxxoxxxoxxfox', 'x..x..x.x..x..xo', 'x.x.xox.x.x.xofx', 'xx.xx.xx.xx.x.ox', 'xxxxxxxxxxxxxxxx', 'x.xx.xx.x.xx.xfo'];
const CHUGS = ['Ax.xx.xx.xx.x.x.', 'A.xxx.xxx.xxx.xx', 'Axxxxxxxxxxxxxxx', 'A..x.xA..x.xA.x.', 'A.x.A.x.A.x.A.xx', 'Axx.Axx.Axx.A.xx', 'A.......A..x.x..'];
const STABS = ['A.....A.....A...', '......A..A......', 'A..A..A.........', '..A...A...A...A.', 'A.......A.A.....'];
const LEAD_RHYTHMS: [number, number][][] = [
  [[0, 3], [3, 3], [6, 2], [8, 6], [16, 3], [19, 3], [22, 2], [24, 8]],
  [[0, 2], [2, 2], [4, 4], [8, 2], [10, 2], [12, 4], [16, 6], [22, 2], [24, 4], [28, 4]],
  [[0, 6], [6, 2], [8, 4], [12, 4], [16, 3], [19, 3], [22, 4], [26, 6]],
  [[0, 1], [2, 1], [4, 2], [6, 2], [8, 8], [16, 1], [18, 1], [20, 2], [22, 2], [24, 8]],
  [[0, 4], [4, 4], [8, 3], [11, 3], [14, 2], [16, 8], [24, 4], [28, 4]],
];
const ARPS = [[0, 1, 2, 3], [3, 2, 1, 0], [0, 1, 2, 3, 2, 1], [0, 2, 1, 3], [0, 1, 2, 1], [0, 2, 3, 2, 1, 2]];
const PULSES = [[0, 8], [0, 6, 10], [0, 3, 8, 11], [0, 10], [0, 6, 8, 14]];

interface LeadNote { len: number; midi: number; vel: number }

interface Section {
  index: number;
  key: number;
  scale: number[];
  prog: number[];
  kick: string;
  snare: string;
  hat: string;
  bass: string;
  chug: string;
  stab: string | null;
  lead: Map<number, LeadNote> | null;
  arp: number[];
  arpWave: OscillatorType;
  pulse: number[];
  buildKick: number[];
  fill: number;
  breakdown: boolean;
  padEvery: number;
  metalStep: number;
}

function kRate(p: AudioParam): void {
  try { if ('automationRate' in p) p.automationRate = 'k-rate'; } catch { /* unsupported: stay a-rate */ }
}

const sawCoef = (m: number): number => ((m % 2 ? 1 : -1) * 2) / (Math.PI * m);

function makeWave(ctx: BaseAudioContext, coef: (k: number) => number, n = 256): PeriodicWave {
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  for (let k = 1; k < n; k++) imag[k] = coef(k);
  return ctx.createPeriodicWave(real, imag);
}

/** Layer target levels for an intensity value. */
export function layerLevels(i: number): [number, number, number] {
  return [
    1 - 0.6 * smoothstep(0.35, 0.9, i),
    smoothstep(0.1, 0.42, i) * (1 - 0.72 * smoothstep(0.6, 0.95, i)),
    smoothstep(0.5, 0.88, i),
  ];
}

export function bpmForSeed(seed: number): number {
  return 138 + Math.floor(mulberry32(seed ^ 0x5bd1e995)() * 13); // 138..150
}

class Layer {
  readonly dry: GainNode;
  readonly verb: GainNode;
  readonly dly: GainNode;
  readonly drums: GainNode;
  readonly bass: GainNode;
  readonly gtr: GainNode;
  private readonly faders: GainNode[];
  /** Every persistent node of this layer (disconnected on dispose). */
  readonly nodes: AudioNode[] = [];
  value = 0;
  target = 0;

  constructor(ctx: BaseAudioContext, out: AudioNode, verbIn: AudioNode, dlyIn: AudioNode) {
    const keep = <T extends AudioNode>(n: T): T => { this.nodes.push(n); return n; };
    const g = (v: number) => { const n = keep(ctx.createGain()); n.gain.value = v; return n; };
    const level = g(0), verbLevel = g(0), dlyLevel = g(0);
    this.faders = [level, verbLevel, dlyLevel];
    this.dry = g(1);
    this.verb = g(1);
    this.dly = g(1);
    this.dry.connect(level).connect(out);
    this.verb.connect(verbLevel).connect(verbIn);
    this.dly.connect(dlyLevel).connect(dlyIn);

    const shaper = (curve: Float32Array<ArrayBuffer>, os: OverSampleType) => { const w = keep(ctx.createWaveShaper()); w.curve = curve; w.oversample = os; return w; };
    const bq = (type: BiquadFilterType, f: number, q = 0.707, gain = 0) => {
      const b = keep(ctx.createBiquadFilter()); b.type = type; b.frequency.value = f; b.Q.value = q; b.gain.value = gain; return b;
    };
    // drum bus: gentle saturation for industrial grit
    this.drums = g(0.8);
    this.drums.connect(shaper(softClipCurve(1.6), 'none')).connect(g(0.75)).connect(this.dry);
    // bass bus: driven, then tamed
    this.bass = g(1);
    this.bass.connect(shaper(softClipCurve(4), 'none')).connect(bq('lowpass', 2400, 0.9)).connect(g(0.1)).connect(this.dry);
    // guitar bus: fuzz power chords, mid scoop, Haas-widened
    this.gtr = g(1);
    const gOut = g(0.09);
    this.gtr.connect(bq('highpass', 110)).connect(shaper(fuzzCurve(10), '2x')).connect(bq('peaking', 450, 1, -5)).connect(bq('lowpass', 3400, 0.8)).connect(gOut);
    if (typeof ctx.createStereoPanner === 'function') {
      const pl = keep(ctx.createStereoPanner()); pl.pan.value = -0.65;
      const pr = keep(ctx.createStereoPanner()); pr.pan.value = 0.65;
      const d = keep(ctx.createDelay(0.05)); d.delayTime.value = 0.013;
      gOut.connect(pl).connect(this.dry);
      gOut.connect(d).connect(pr).connect(this.dry);
    } else {
      gOut.connect(this.dry);
    }
  }

  set(v: number, time: number, tau: number): void {
    this.target = v;
    for (const f of this.faders) {
      if (tau <= 0) { f.gain.cancelScheduledValues(time); f.gain.setValueAtTime(v, time); }
      else f.gain.setTargetAtTime(v, time, tau);
    }
    this.value = v;
  }
}

export class MusicEngine {
  readonly bpm: number;
  readonly stepDur: number;
  /** Total notes scheduled (diagnostics). */
  notes = 0;
  sections = 0;
  intensity = 0;
  target = 0;
  /** Debug/diagnostics: when set, only these instruments sound (e.g. ['kick', 'bass']). */
  only: Set<string> | null = null;

  private readonly rng: Rng;
  private readonly fade: GainNode;
  private readonly layers: Layer[];
  private readonly noise: AudioBuffer;
  private readonly allNodes: AudioNode[] = [];
  private step = 0;
  private nextTime = 0;
  private sec!: Section;
  private key: number;
  private scaleName = 'aeolian';
  private applied = -1;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastSmoothWall = 0;
  private stopAt = Infinity;
  private running = false;
  private metalRatio: number;
  private disposed = false;
  /** Saw at f + square one octave below, as one oscillator running at f/2. */
  private readonly bassWave: PeriodicWave;
  /** Just-intonation power chord (root, fifth, octave saws) as one oscillator running at f/2. */
  private readonly chordWave: PeriodicWave;
  /** Square + octave saw lead timbre. */
  private readonly leadWave: PeriodicWave;
  private readonly kit: DrumKit;

  constructor(readonly ctx: BaseAudioContext, dest: AudioNode, seed: number) {
    this.rng = mulberry32(seed);
    this.bpm = bpmForSeed(seed);
    this.stepDur = 60 / this.bpm / 4;
    this.key = 24 + Math.floor(this.rng() * 10); // C1..A1
    this.metalRatio = 0.9 + this.rng() * 0.25;
    this.noise = noiseBuffer(ctx.sampleRate, 'white');
    this.bassWave = makeWave(ctx, (k) => (k % 2 ? (0.55 * 4) / (Math.PI * k) : sawCoef(k / 2)));
    this.leadWave = makeWave(ctx, (k) => (k % 2 ? 4 / (Math.PI * k) : 0) + (k % 2 === 0 ? 0.35 * sawCoef(k / 2) : 0), 128);
    this.kit = renderDrumKit(ctx.sampleRate, seed, this.metalRatio);
    this.chordWave = makeWave(ctx, (k) => (k % 2 === 0 ? sawCoef(k / 2) : 0) + (k % 3 === 0 ? sawCoef(k / 3) : 0) + (k % 4 === 0 ? 0.8 * sawCoef(k / 4) : 0));

    const keep = <T extends AudioNode>(n: T): T => { this.allNodes.push(n); return n; };
    this.fade = keep(ctx.createGain());
    this.fade.gain.value = 0;
    const comp = keep(ctx.createDynamicsCompressor());
    comp.threshold.value = -14;
    comp.knee.value = 8;
    comp.ratio.value = 3;
    comp.attack.value = 0.01;
    comp.release.value = 0.25;
    const out = keep(ctx.createGain());
    out.gain.value = 0.6;
    out.connect(comp).connect(this.fade).connect(dest);

    // shared reverb: one mono convolution (the dominant CPU cost of the engine), widened with a Haas delay
    const conv = keep(ctx.createConvolver());
    try { conv.channelCount = 1; conv.channelCountMode = 'explicit'; } catch { /* keep default */ }
    conv.buffer = impulseResponse(ctx.sampleRate, 'music', 1);
    const verbOut = keep(ctx.createGain());
    verbOut.gain.value = 0.5;
    conv.connect(verbOut);
    if (typeof ctx.createStereoPanner === 'function') {
      const vl = keep(ctx.createStereoPanner()); vl.pan.value = -0.55;
      const vr = keep(ctx.createStereoPanner()); vr.pan.value = 0.55;
      const vd = keep(ctx.createDelay(0.1)); vd.delayTime.value = 0.019;
      verbOut.connect(vl).connect(out);
      verbOut.connect(vd).connect(vr).connect(out);
    } else {
      verbOut.connect(out);
    }
    // ping-pong dotted-8th delay with damped feedback
    const dlyIn = keep(ctx.createGain());
    const dA = keep(ctx.createDelay(2));
    const dB = keep(ctx.createDelay(2));
    dA.delayTime.value = this.stepDur * 3;
    dB.delayTime.value = this.stepDur * 3;
    const fbA = keep(ctx.createGain());
    const fbB = keep(ctx.createGain());
    fbA.gain.value = 0.42;
    fbB.gain.value = 0.42;
    const damp = keep(ctx.createBiquadFilter());
    damp.type = 'lowpass';
    damp.frequency.value = 2600;
    const dOut = keep(ctx.createGain());
    dOut.gain.value = 0.45;
    dlyIn.connect(dA);
    dA.connect(fbA).connect(dB);
    dB.connect(damp).connect(fbB).connect(dA);
    if (typeof ctx.createStereoPanner === 'function') {
      const pa = keep(ctx.createStereoPanner()); pa.pan.value = -0.6;
      const pb = keep(ctx.createStereoPanner()); pb.pan.value = 0.6;
      dA.connect(pa).connect(dOut);
      dB.connect(pb).connect(dOut);
    } else {
      dA.connect(dOut);
      dB.connect(dOut);
    }
    dOut.connect(out);
    this.layers = [0, 1, 2].map(() => new Layer(ctx, out, conv, dlyIn));
  }

  get isRunning(): boolean { return this.running; }

  /**
   * Harmonic context and beat grid (used to fit stingers to the score): current tonic (MIDI),
   * 16th-note duration and the context time of the next quarter-note beat at least 60 ms ahead.
   */
  harmony(): { key: number; stepDur: number; nextBeat: number } {
    const sec = this.sec as Section | undefined;
    const key = sec ? sec.key : this.key;
    const now = this.ctx.currentTime + 0.06;
    let nextBeat = now;
    if (this.running && this.nextTime > 0) {
      // steps before nextTime are already scheduled; find the first beat (step % 4 == 0) at/after `now`
      const idx = this.step - (this.nextTime - now) / this.stepDur;
      const s = Math.ceil(idx / 4 - 1e-6) * 4;
      nextBeat = this.nextTime + (s - this.step) * this.stepDur;
      while (nextBeat < now) nextBeat += 4 * this.stepDur;
    }
    return { key, stepDur: this.stepDur, nextBeat };
  }

  /** Begin playback at context time `when`. */
  start(when: number, fadeIn = 1.2): void {
    this.running = true;
    this.step = 0;
    this.nextTime = when;
    this.applyLevels(when, 0);
    this.fade.gain.cancelScheduledValues(when);
    this.fade.gain.setValueAtTime(0, when);
    if (fadeIn > 0) this.fade.gain.linearRampToValueAtTime(1, when + fadeIn);
    else this.fade.gain.setValueAtTime(1, when);
  }

  /** Start the realtime lookahead scheduler (setInterval + AudioContext clock). */
  startTimer(): void {
    if (this.timer !== null) return;
    this.lastSmoothWall = performance.now();
    this.timer = setInterval(() => this.tick(), 25);
    this.tick();
  }

  setIntensity(v: number, immediate = false): void {
    this.target = clamp(Number.isFinite(v) ? v : 0, 0, 1);
    if (immediate) {
      this.intensity = this.target;
      this.applyLevels(this.ctx.currentTime, 0);
    }
  }

  /** Smooth intensity towards its target (fast attack, slow release) and push layer gains. */
  smooth(dt: number): void {
    this.lastSmoothWall = performance.now();
    if (!this.running) return;
    const d = clamp(dt, 0, 0.5);
    const tau = this.target > this.intensity ? 1.6 : 4.5;
    this.intensity += (this.target - this.intensity) * (1 - Math.exp(-d / tau));
    if (Math.abs(this.intensity - this.applied) > 0.006) this.applyLevels(this.ctx.currentTime, 0.12);
  }

  /** Fade out and stop scheduling; the graph is released afterwards. */
  stop(fade = 1.5): void {
    if (!this.running) return;
    const now = this.ctx.currentTime;
    this.fade.gain.cancelScheduledValues(now);
    this.fade.gain.setValueAtTime(this.fade.gain.value, now);
    this.fade.gain.linearRampToValueAtTime(0, now + fade);
    this.stopAt = now + fade;
    setTimeout(() => this.dispose(), (fade + 4) * 1000);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    // break every persistent connection (incl. the delay feedback cycle) so the graph can be collected
    for (const n of [...this.allNodes, ...this.layers.flatMap((l) => l.nodes)]) {
      try { n.disconnect(); } catch { /* ignore */ }
    }
  }

  /** Schedule every 16th step whose start time is < `until`. */
  scheduleUntil(until: number): void {
    const end = Math.min(until, this.stopAt);
    while (this.running && this.nextTime < end) {
      this.scheduleStep(this.step, this.nextTime);
      this.step++;
      this.nextTime += this.stepDur;
    }
  }

  private tick(): void {
    if (!this.running) return;
    const ctx = this.ctx;
    const nowWall = performance.now();
    // if the host stopped calling update(), keep the intensity crossfade alive ourselves
    if (nowWall - this.lastSmoothWall > 200) this.smooth((nowWall - this.lastSmoothWall) / 1000);
    const now = ctx.currentTime;
    if (now > this.stopAt + 0.5) { this.dispose(); return; }
    if (this.nextTime < now - 0.05) {
      // we fell behind (tab throttled / context suspended): skip ahead instead of bursting
      const skip = Math.ceil((now + 0.05 - this.nextTime) / this.stepDur);
      this.step += skip;
      this.nextTime += skip * this.stepDur;
    }
    const hidden = typeof document !== 'undefined' && document.hidden;
    this.scheduleUntil(now + (hidden ? 1.5 : 0.2));
  }

  private applyLevels(time: number, tau: number): void {
    const lv = layerLevels(this.intensity);
    this.layers.forEach((l, i) => l.set(lv[i], time, tau));
    this.applied = this.intensity;
  }

  // -------------------------------------------------------------------------
  // Arrangement
  // -------------------------------------------------------------------------

  private pick<T>(arr: T[]): T { return arr[Math.floor(this.rng() * arr.length)]; }

  private mutate(p: string, n: number, on: string): string {
    const a = p.split('');
    for (let i = 0; i < n; i++) {
      const k = 1 + Math.floor(this.rng() * 15);
      a[k] = a[k] === '.' ? on : '.';
    }
    return a.join('');
  }

  private degSemi(scale: number[], deg: number): number {
    const o = Math.floor(deg / 7);
    return scale[((deg % 7) + 7) % 7] + 12 * o;
  }

  /** Chord root semitone offset folded into [-6, 6] around the tonic (keeps bass in register). */
  private rootSemi(sec: Section, chord: number): number {
    const s = this.degSemi(sec.scale, chord) % 12;
    return s > 6 ? s - 12 : s;
  }

  private makeSection(index: number): Section {
    const prev = this.sec as Section | undefined;
    if (index > 0 && index % 2 === 0 && this.rng() < 0.55) {
      this.key += this.pick([2, 3, 5, -2, -3, -5]);
      if (this.key > 35) this.key -= 12;
      if (this.key < 24) this.key += 12;
    }
    const prog = this.pick(PROGS);
    this.scaleName = this.pick(prog.scales);
    const scale = SCALES[this.scaleName];
    const keepGroove = prev && this.rng() < 0.45;
    const sec: Section = {
      index,
      key: this.key,
      scale,
      prog: prog.deg,
      kick: keepGroove ? prev!.kick : this.mutate(this.pick(KICKS), this.rng() < 0.5 ? 1 : 0, 'x'),
      snare: this.pick(SNARES),
      hat: this.pick(HATS),
      bass: keepGroove ? this.mutate(prev!.bass, 1, 'x') : this.mutate(this.pick(BASSES), Math.floor(this.rng() * 2), 'x'),
      chug: keepGroove ? prev!.chug : this.pick(CHUGS),
      stab: this.rng() < 0.55 ? this.pick(STABS) : null,
      lead: null,
      arp: this.pick(ARPS),
      arpWave: this.rng() < 0.5 ? 'square' : 'sawtooth',
      pulse: this.pick(PULSES),
      buildKick: this.pick([[0], [0, 10], [0, 7, 10], [0, 8]]),
      fill: Math.floor(this.rng() * 3),
      breakdown: index > 1 && !(prev && prev.breakdown) && this.rng() < 0.2,
      padEvery: this.rng() < 0.5 ? 1 : 2,
      metalStep: this.pick([6, 14, 10, -1]),
    };
    if (index > 0 && this.rng() < 0.65) sec.lead = this.makeLead(sec);
    this.sections++;
    return sec;
  }

  private makeLead(sec: Section): Map<number, LeadNote> {
    const rh = this.pick(LEAD_RHYTHMS);
    const base = sec.key + 36;
    const chordAt = (step: number) => sec.prog[Math.floor(step / 16) % 8];
    const snap = (deg: number, chord: number) => {
      // nearest chord tone (chord, chord+2, chord+4 in scale-degree space)
      let best = deg, bd = 99;
      for (let d = deg - 3; d <= deg + 3; d++) {
        const rel = (((d - chord) % 7) + 7) % 7;
        if ((rel === 0 || rel === 2 || rel === 4) && Math.abs(d - deg) < bd) { bd = Math.abs(d - deg); best = d; }
      }
      return best;
    };
    const walk = (startDeg: number): number[] => {
      const out: number[] = [];
      let d = startDeg;
      for (let i = 0; i < rh.length; i++) {
        if (i > 0) d += this.pick([-2, -1, -1, 1, 1, 2, 0, 3, -3]);
        d = clamp(d, -2, 9);
        out.push(d);
      }
      return out;
    };
    const motif = walk(this.pick([0, 2, 4]));
    const map = new Map<number, LeadNote>();
    for (let phrase = 0; phrase < 4; phrase++) {
      const degs = motif.slice();
      if (phrase === 1) {
        const tail = walk(degs[degs.length - 3]);
        degs[degs.length - 2] = tail[1];
        degs[degs.length - 1] = tail[2];
      } else if (phrase === 3) {
        degs[degs.length - 2] = clamp(degs[degs.length - 2], 1, 6);
        degs[degs.length - 1] = this.rng() < 0.6 ? 0 : 4;
      }
      rh.forEach(([st, len], i) => {
        const step = phrase * 32 + st;
        let d = degs[i];
        if (st % 8 === 0) d = snap(d, chordAt(step));
        map.set(step, { len, midi: base + this.degSemi(sec.scale, d), vel: st % 8 === 0 ? 1 : 0.8 });
      });
    }
    return map;
  }

  private scheduleStep(step: number, t: number): void {
    const s16 = step % 16;
    const bar = Math.floor(step / 16);
    const secBar = bar % 8;
    if (!this.sec || (s16 === 0 && secBar === 0)) this.sec = this.makeSection(Math.floor(bar / 8));
    const sec = this.sec;
    const chord = sec.prog[secBar];
    const audible = (i: number) => Math.max(this.layers[i].value, this.layers[i].target) > 0.003;
    if (audible(0)) this.calm(sec, secBar, s16, t, chord);
    if (audible(1)) this.build(sec, step, secBar, s16, t, chord);
    if (audible(2)) this.battle(sec, secBar, s16, t, chord);
  }

  private chordMidis(sec: Section, chord: number, base: number, n: number): number[] {
    const out: number[] = [];
    const lift = this.degSemi(sec.scale, chord) > 7 ? -12 : 0;
    for (let i = 0; i < n; i++) out.push(base + lift + this.degSemi(sec.scale, chord + i * 2));
    return out;
  }

  private calm(sec: Section, secBar: number, s16: number, t: number, chord: number): void {
    const L = this.layers[0];
    const barDur = this.stepDur * 16;
    if (s16 === 0 && secBar % sec.padEvery === 0) {
      this.pad(L, t, this.chordMidis(sec, chord, sec.key + 24, this.rng() < 0.5 ? 4 : 3), sec.padEvery * barDur + 0.2, 0.045);
    }
    if (s16 === 0) this.sub(L, t, sec.key + 12 + this.rootSemi(sec, chord), barDur * 0.96, 0.32);
    if (sec.pulse.includes(s16)) this.pluck(L, t, sec.key + 24 + this.rootSemi(sec, chord) + (s16 === 0 ? 0 : this.pick([0, 7, 12])), 0.22);
    if (s16 % 4 === 0) this.clockTick(L, t, s16 === 0 ? 0.5 : 0.3);
    if (s16 === 6 && (secBar === 1 || secBar === 5) && this.rng() < 0.5) {
      this.ping(L, t, midiToHz(sec.key + 60 + this.degSemi(sec.scale, this.pick([0, 2, 4, 7]))), 0.12);
    }
    if (s16 === 10 && secBar === 3 && this.rng() < 0.4) this.metalHit(L, t, 0.25, 0.8);
  }

  private build(sec: Section, step: number, secBar: number, s16: number, t: number, chord: number): void {
    const L = this.layers[1];
    const fillBar = secBar === 7;
    const barDur = this.stepDur * 16;
    if (sec.buildKick.includes(s16) && !(fillBar && s16 >= 8)) this.kick(L, t, 0.8);
    if (s16 === 8 && !fillBar) this.clap(L, t, 0.55);
    if (s16 % 2 === 0) this.hat(L, t, s16 % 4 === 2 ? 0.5 : 0.3, false);
    else if (secBar >= 4) this.hat(L, t, 0.18, false);
    if (s16 % 2 === 0) this.bassNote(L, t, sec.key + 12 + this.rootSemi(sec, chord), this.stepDur * 1.5, s16 % 4 === 0 ? 0.6 : 0.45, 0.35);
    const tones = this.chordMidis(sec, chord, sec.key + 36, 3);
    tones.push(tones[0] + 12);
    const idx = sec.arp[step % sec.arp.length];
    this.arp(L, t, tones[idx], sec.arpWave, s16 % 4 === 0 ? 0.32 : 0.24, 900 + secBar * 220);
    if (fillBar && (s16 >= 8 || s16 % 4 === 0)) this.snare(L, t, 0.2 + 0.5 * (s16 / 15), 0.3);
    if (secBar === 6 && s16 === 0) this.riser(L, t, barDur * 2, 0.22);
  }

  private battle(sec: Section, secBar: number, s16: number, t: number, chord: number): void {
    const L = this.layers[2];
    const bd = sec.breakdown && secBar < 4;
    const bdBuild = sec.breakdown && secBar >= 4;
    const fillZone = secBar === 7 && s16 >= 8;
    const root = sec.key + 12 + this.rootSemi(sec, chord);
    const barDur = this.stepDur * 16;

    if (s16 === 0 && ((secBar === 0 && !sec.breakdown) || (sec.breakdown && secBar === 4) || (secBar === 4 && !sec.breakdown && this.rng() < 0.3))) {
      this.crash(L, t, 0.7);
    }
    if (bd) {
      if (s16 === 0) this.chug(L, t, root, barDur * 0.95, 0.75, true);
      if (s16 === 0 && secBar === 3) this.riser(L, t, barDur, 0.3);
    } else {
      // kick
      const k = bdBuild ? s16 % 4 === 0 : sec.kick[s16] === 'x';
      if (k && !(fillZone && sec.fill === 1)) this.kick(L, t, s16 % 4 === 0 ? 1 : 0.85);
      // snare / fills
      if (fillZone) this.fill(L, sec.fill, s16, t);
      else if (bdBuild ? (s16 === 4 || s16 === 12) : sec.snare[s16] === 'x') this.snare(L, t, s16 === 4 || s16 === 12 ? 0.9 : 0.4, 0.5);
      if (secBar === 3 && s16 === 15) this.snare(L, t, 0.5, 0.5);
      // hats
      if (!fillZone) {
        const c = bdBuild ? (s16 % 2 === 0 ? 'x' : '.') : sec.hat[s16];
        if (c !== '.') this.hat(L, t, s16 % 4 === 2 ? 0.55 : 0.35, c === 'o');
      }
      // bass
      const bc = bdBuild ? (s16 % 2 === 0 ? 'x' : '.') : sec.bass[s16];
      if (bc !== '.') {
        const next = sec.bass[(s16 + 1) % 16];
        const off = bc === 'o' ? 12 : bc === 'f' ? 7 : 0;
        this.bassNote(L, t, root + off, this.stepDur * (next === '.' ? 1.7 : 0.85), s16 % 4 === 0 ? 1 : 0.85, 1);
      }
      // power chords
      const cc = sec.chug[s16];
      if (!bdBuild || s16 % 4 === 0) {
        if (cc === 'A') this.chug(L, t, root, this.stepDur * 2.6, 0.9, true);
        else if (cc === 'x') this.chug(L, t, root, this.stepDur * 0.8, 0.7, false);
      }
      // stabs on odd bars
      if (sec.stab && !bdBuild && secBar % 2 === 1 && sec.stab[s16] === 'A') {
        this.stab(L, t, this.chordMidis(sec, chord, sec.key + 36, 3), this.stepDur * 1.5, 0.5);
      }
      if (sec.metalStep >= 0 && s16 === sec.metalStep && secBar % 2 === 1) this.metalHit(L, t, 0.4, 0.4);
    }
    // lead
    if (sec.lead) {
      const n = sec.lead.get(secBar * 16 + s16);
      if (n) this.lead(L, t, n.midi, n.len * this.stepDur * 0.92, n.vel * 0.55);
    }
  }

  private fill(L: Layer, type: number, s16: number, t: number): void {
    const p = (s16 - 8) / 7;
    if (type === 0) this.snare(L, t, 0.35 + 0.6 * p, 0.4);
    else if (type === 1) {
      const toms: Record<number, number> = { 8: 190, 10: 190, 12: 140, 13: 140, 14: 100, 15: 82 };
      if (toms[s16]) this.tom(L, t, toms[s16], 0.9);
      if (s16 === 8 || s16 === 15) this.snare(L, t, 0.8, 0.4);
    } else if (s16 % 2 === 0 || s16 >= 14) {
      this.kick(L, t, 0.9);
      this.snare(L, t, 0.5 + 0.4 * p, 0.4);
    }
  }

  // -------------------------------------------------------------------------
  // Instruments (each call creates a few short-lived nodes)
  // -------------------------------------------------------------------------

  private g(v = 0): GainNode { const n = this.ctx.createGain(); n.gain.value = v; return n; }
  private bq(type: BiquadFilterType, f: number, q = 0.707): BiquadFilterNode {
    const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q;
    // per-quantum coefficient updates: much cheaper than a-rate, inaudible for envelope sweeps
    kRate(b.frequency);
    return b;
  }
  private osc(type: OscillatorType, f: number, t: number, end: number, detune = 0): OscillatorNode {
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = detune; o.start(t); o.stop(end); return o;
  }
  private noiseSrc(t: number, dur: number): AudioBufferSourceNode {
    const n = this.ctx.createBufferSource(); n.buffer = this.noise; n.loop = true; n.start(t, this.rng() * 3.5); n.stop(t + dur); return n;
  }
  /** Percussive envelope; returns the stop time (`k` time constants after the attack). */
  private perc(p: AudioParam, t: number, peak: number, attack: number, tau: number, k = 7): number {
    p.setValueAtTime(0, t); p.linearRampToValueAtTime(peak, t + attack); p.setTargetAtTime(0, t + attack, tau);
    return t + attack + tau * k;
  }
  /** Flat note with attack/release (gate-style). */
  private gate(p: AudioParam, t: number, peak: number, attack: number, dur: number, release: number, k = 7): number {
    p.setValueAtTime(0, t); p.linearRampToValueAtTime(peak, t + attack); p.setValueAtTime(peak, t + Math.max(attack, dur));
    p.setTargetAtTime(0, t + Math.max(attack, dur), release);
    return t + Math.max(attack, dur) + release * k;
  }
  private send(from: AudioNode, to: AudioNode, amt: number): void {
    if (this.only && this.only.has('!send')) return;
    const s = this.g(amt); from.connect(s); s.connect(to);
  }

  /** One-shot from the pre-rendered kit: BufferSource → Gain(vel) → dest [+ reverb send]. */
  private hit(name: DrumName, dest: AudioNode, t: number, vel: number, verbSend?: AudioNode, verb = 0): void {
    const arr = this.kit[name];
    const src = this.ctx.createBufferSource();
    src.buffer = arr[arr.length > 1 ? Math.floor(this.rng() * arr.length) : 0];
    const g = this.g(vel);
    src.connect(g).connect(dest);
    if (verbSend && verb > 0) this.send(g, verbSend, verb);
    src.start(t);
    this.notes++;
  }

  private kick(L: Layer, t: number, vel: number): void {
    if (this.only && !this.only.has('kick')) return;
    this.hit('kick', L.drums, t, vel);
  }

  private snare(L: Layer, t: number, vel: number, verb: number): void {
    if (this.only && !this.only.has('snare')) return;
    this.hit('snare', L.drums, t, vel, L.verb, verb);
  }

  private clap(L: Layer, t: number, vel: number): void {
    if (this.only && !this.only.has('clap')) return;
    this.hit('clap', L.drums, t, vel, L.verb, 0.6);
  }

  private hat(L: Layer, t: number, vel: number, open: boolean): void {
    if (this.only && !this.only.has('hat')) return;
    this.hit(open ? 'ohat' : 'hat', L.drums, t, vel);
  }

  private crash(L: Layer, t: number, vel: number): void {
    if (this.only && !this.only.has('crash')) return;
    this.hit('crash', L.dry, t, vel, L.verb, 0.4);
  }

  private tom(L: Layer, t: number, f: number, vel: number): void {
    if (this.only && !this.only.has('tom')) return;
    const name: DrumName = f >= 170 ? 'tom190' : f >= 120 ? 'tom140' : f >= 90 ? 'tom100' : 'tom82';
    this.hit(name, L.drums, t, vel, L.verb, 0.25);
  }

  private metalHit(L: Layer, t: number, vel: number, verb: number): void {
    if (this.only && !this.only.has('metalHit')) return;
    this.hit('metal', L.dry, t, vel, L.verb, verb);
  }

  private bassNote(L: Layer, t: number, midi: number, dur: number, vel: number, bright: number): void {
    if (this.only && !this.only.has('bassNote')) return;
    const f = midiToHz(midi);
    const e = this.g();
    const end = this.gate(e.gain, t, vel, 0.003, dur, 0.015);
    const lp = this.bq('lowpass', 160, 5);
    lp.frequency.setValueAtTime(160, t);
    lp.frequency.linearRampToValueAtTime(160 + 1600 * bright, t + 0.006);
    lp.frequency.setTargetAtTime(220, t + 0.008, 0.06);
    const o = this.osc('sine', f / 2, t, end);
    o.setPeriodicWave(this.bassWave);
    o.connect(lp).connect(e).connect(L.bass);
    this.notes++;
  }

  private chug(L: Layer, t: number, midi: number, dur: number, vel: number, open: boolean): void {
    if (this.only && !this.only.has('chug')) return;
    const f = midiToHz(midi);
    const e = this.g();
    const end = this.gate(e.gain, t, vel, 0.003, dur, open ? 0.12 : 0.03);
    const lp = this.bq('lowpass', open ? 2600 : 1400, 1);
    if (!open) lp.frequency.setTargetAtTime(450, t + 0.005, 0.04);
    for (const det of [-8, 8]) {
      const o = this.osc('sine', f / 2, t, end, det);
      o.setPeriodicWave(this.chordWave);
      o.connect(lp);
    }
    lp.connect(e).connect(L.gtr);
    this.notes++;
  }

  private stab(L: Layer, t: number, midis: number[], dur: number, vel: number): void {
    if (this.only && !this.only.has('stab')) return;
    const e = this.g();
    const end = this.gate(e.gain, t, vel * 0.12, 0.004, dur, 0.06);
    const lp = this.bq('lowpass', 5000, 3);
    lp.frequency.setValueAtTime(5000, t);
    lp.frequency.setTargetAtTime(900, t + 0.01, 0.06);
    for (const m of midis) this.osc('sawtooth', midiToHz(m), t, end).connect(lp);
    lp.connect(e).connect(L.dry);
    this.send(e, L.verb, 0.35);
    this.send(e, L.dly, 0.25);
    this.notes++;
  }

  private lead(L: Layer, t: number, midi: number, dur: number, vel: number): void {
    if (this.only && !this.only.has('lead')) return;
    const e = this.g();
    const end = this.gate(e.gain, t, vel * 0.15, 0.008, dur, 0.05);
    const o = this.osc('sine', midiToHz(midi), t, end);
    o.setPeriodicWave(this.leadWave);
    // delayed vibrato as a detune automation curve (no LFO nodes)
    const len = end - t;
    const n = Math.max(4, Math.ceil(len * 60));
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const tt = (i / (n - 1)) * len;
      curve[i] = 22 * Math.min(1, tt / 0.25) * Math.sin(2 * Math.PI * 5.6 * tt);
    }
    kRate(o.detune);
    o.detune.setValueCurveAtTime(curve, t, len);
    const lp = this.bq('lowpass', 2800, 2);
    o.connect(lp).connect(e).connect(L.dry);
    this.send(e, L.dly, 0.35);
    this.send(e, L.verb, 0.25);
    this.notes++;
  }

  private arp(L: Layer, t: number, midi: number, wave: OscillatorType, vel: number, cutoff: number): void {
    if (this.only && !this.only.has('arp')) return;
    const e = this.g();
    const end = this.perc(e.gain, t, vel * 0.22, 0.002, 0.07, 5);
    const lp = this.bq('lowpass', cutoff * 1.8, 2);
    lp.frequency.setValueAtTime(cutoff * 1.8, t);
    lp.frequency.setTargetAtTime(cutoff * 0.6, t + 0.005, 0.05);
    this.osc(wave, midiToHz(midi), t, end).connect(lp);
    lp.connect(e).connect(L.dry);
    this.send(e, L.dly, 0.3);
    this.notes++;
  }

  private pad(L: Layer, t: number, midis: number[], dur: number, vel: number): void {
    if (this.only && !this.only.has('pad')) return;
    // voices alternate between two sides; each side shares one filter + envelope (+ panner)
    for (let side = 0; side < 2; side++) {
      const e = this.g();
      const end = this.gate(e.gain, t, vel, 0.7, dur, 0.3, 5);
      const lp = this.bq('lowpass', 500, 0.7);
      lp.frequency.setValueAtTime(500, t);
      lp.frequency.linearRampToValueAtTime(1300, t + dur * 0.5);
      lp.frequency.linearRampToValueAtTime(700, t + dur);
      midis.forEach((m, i) => {
        if (i % 2 !== side) return;
        const f = midiToHz(m);
        this.osc('sawtooth', f, t, end, -9).connect(lp);
        this.osc('sawtooth', f, t, end, 9).connect(lp);
      });
      lp.connect(e);
      let outNode: AudioNode = e;
      if (typeof this.ctx.createStereoPanner === 'function') {
        const p = this.ctx.createStereoPanner();
        p.pan.value = side ? 0.45 : -0.45;
        e.connect(p);
        outNode = p;
      }
      outNode.connect(L.dry);
      this.send(outNode, L.verb, 0.55);
    }
    this.notes++;
  }

  private sub(L: Layer, t: number, midi: number, dur: number, vel: number): void {
    if (this.only && !this.only.has('sub')) return;
    const e = this.g();
    const end = this.gate(e.gain, t, vel * 0.2, 0.08, dur, 0.1);
    this.osc('triangle', midiToHz(midi), t, end).connect(this.bq('lowpass', 300)).connect(e).connect(L.dry);
    this.notes++;
  }

  private pluck(L: Layer, t: number, midi: number, vel: number): void {
    if (this.only && !this.only.has('pluck')) return;
    const e = this.g();
    const end = this.perc(e.gain, t, vel * 0.8, 0.002, 0.12, 5);
    const lp = this.bq('lowpass', 1200, 1);
    lp.frequency.setTargetAtTime(400, t + 0.005, 0.08);
    this.osc('triangle', midiToHz(midi), t, end).connect(lp).connect(e).connect(L.dry);
    this.send(e, L.dly, 0.35);
    this.notes++;
  }

  private clockTick(L: Layer, t: number, vel: number): void {
    if (this.only && !this.only.has('clockTick')) return;
    const n = this.noiseSrc(t, 0.06);
    const e = this.g();
    this.perc(e.gain, t, vel * 0.7, 0.0005, 0.006);
    n.connect(this.bq('bandpass', 3200, 3)).connect(e).connect(L.dry);
    this.notes++;
  }

  private ping(L: Layer, t: number, f: number, vel: number): void {
    if (this.only && !this.only.has('ping')) return;
    const e = this.g();
    const end = this.perc(e.gain, t, vel * 1.5, 0.004, 0.35);
    this.osc('sine', f, t, end).connect(e);
    this.send(e, L.dry, 0.4);
    this.send(e, L.dly, 0.6);
    this.send(e, L.verb, 0.5);
    this.notes++;
  }

  private riser(L: Layer, t: number, dur: number, vel: number): void {
    if (this.only && !this.only.has('riser')) return;
    const n = this.noiseSrc(t, dur + 0.3);
    const bp = this.bq('bandpass', 300, 3);
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(6000, t + dur);
    const e = this.g();
    e.gain.setValueAtTime(0, t);
    e.gain.linearRampToValueAtTime(vel * 1.25, t + dur);
    e.gain.setTargetAtTime(0, t + dur, 0.02);
    n.connect(bp).connect(e).connect(L.dry);
    this.send(e, L.verb, 0.3);
    this.notes++;
  }
}

/** Offline render of the soundtrack (used by the self-test). Drives the scheduler in 1 s chunks via suspend(). */
export async function renderMusicOffline(intensity: number, bars = 16, seed = 1234, sampleRate = 44100, only?: string[]): Promise<{ buffer: AudioBuffer; notes: number; bpm: number; musicSeconds: number; renderMs: number }> {
  const bpm = bpmForSeed(seed);
  const stepDur = 60 / bpm / 4;
  const musicEnd = 0.05 + bars * 16 * stepDur;
  const total = musicEnd + 2.5;
  const oc = new OfflineAudioContext(2, Math.ceil(total * sampleRate), sampleRate);
  const eng = new MusicEngine(oc, oc.destination, seed);
  if (only) eng.only = new Set(only);
  eng.setIntensity(intensity, true);
  eng.start(0.05, 0);
  // 0.25 s chunks with 0.2 s lookahead ≈ the realtime scheduler, so render time ≈ realtime CPU cost
  const chunk = 0.25;
  eng.scheduleUntil(Math.min(chunk + 0.2, musicEnd));
  for (let tt = chunk; tt < total - 0.1; tt += chunk) {
    const at = tt;
    oc.suspend(at).then(() => {
      eng.scheduleUntil(Math.min(at + chunk + 0.2, musicEnd));
      return oc.resume();
    }).catch(() => { /* ignore */ });
  }
  const t0 = performance.now();
  const buffer = await oc.startRendering();
  return { buffer, notes: eng.notes, bpm, musicSeconds: musicEnd, renderMs: performance.now() - t0 };
}
