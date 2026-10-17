/**
 * AudioSystem — procedural audio for the game (raw Web Audio API, no asset files).
 *
 *   sfx voices ─┬──────── sfxBus ─────┐
 *               └ distance send ┐      ├─ world (high-shelf: snow/fog) ─┐
 *   soundscape (./ambience.ts) ─┼ ambience bus ──┘                     │
 *                               └─ env reverb (night/weather) ─────────┤
 *   music engine ─ musicIn (stinger duck) ─ musicBus ──────────────────┼─ master ─ limiter ─ destination
 *   stingers (./stingers.ts) ──────────────┘                           │
 *   voice chirps ─ voiceBus ───────────────────────────────────────────┘
 *
 * - SFX are synthesised once per variation in OfflineAudioContexts (background, after unlock)
 *   and played back as AudioBufferSourceNode → [lowpass] → gain → StereoPanner → sfxBus.
 * - Music is a seeded procedural engine with intensity-crossfaded layers (./music.ts).
 * - Announcer / unit responses use the Web Speech API (./speech.ts) plus synthesised radio chirps.
 * - The living soundscape (./ambience.ts, beds rendered in a Web Worker by ./ambgen.ts) follows
 *   setAmbience(); it also owns the environment reverb (fed by distance-scaled SFX sends) and the
 *   world high-shelf. Stingers (./stingers.ts) follow the score's key and beat and duck it.
 * Everything is a silent no-op until unlock() succeeds, and never throws.
 */
import type { AmbienceState, AnnouncerKey, AudioApi, AudioVolumes, ResponseKind, SfxKey, StingerKind, VoiceKind } from './types';
import { clamp } from './dsp';
import { Soundscape } from './ambience';
import { MusicEngine } from './music';
import { RECIPES, SfxBank, type AnyKey } from './sfx';
import { STINGER_INFO, StingerEngine } from './stingers';
import {
  ANNOUNCER_PRIORITY, ANNOUNCER_TEXT, ANNOUNCER_THROTTLE, DEFAULT_THROTTLE, RESPONSE_LINES, Speech, VOICE_PARAMS,
} from './speech';
import { DUCK_HOLD, DUCK_LEVEL, SMALL_ARMS_CAP, VOICE_BUDGET, ducksSmallArms, isSmallArms, newMixStats, pickVictim, sfxTier, type MixStats } from './mixer';
import { JUICE } from '../render/effects/juiceflags';

export type { AmbienceState, AnnouncerKey, AudioApi, AudioVolumes, ResponseKind, SfxKey, StingerKind, VoiceKind, WeatherKind } from './types';
export type { MixStats } from './mixer';

const STORAGE_KEY = 'rh.audio.volumes';
const DEFAULT_VOLUMES: AudioVolumes = { master: 0.85, sfx: 0.9, music: 0.6, voice: 0.9, ambience: 0.7 };
const MAX_VOICES = VOICE_BUDGET;
const MAX_PER_KEY = 4;
const MERGE_WINDOW = 0.03; // s
const PITCH_VARIATION = 0.05;
const RESPONSE_GAP_MS = 600;
/** Keys that should always play at their exact pitch (UI consistency). */
const STEADY = new Set<AnyKey>(['click', 'hover', 'tab', 'error', 'ready_ping', 'cash_tick', '_chirp', '_radio', '_rankup']);

/** Slider value (0..1) → linear gain. Squared curve ≈ perceptually even steps. */
const curve = (v: number): number => v * v;

/**
 * Announcer voice preset (cosmetic announcer styles, meta/cosmetics.ts). Fields are read each time an
 * announcement is spoken, so a preset object may change underneath (getters work). Missing / invalid fields
 * fall back to the default announcer: female voice, pitch 0.92, rate 1.04, full volume.
 */
export interface AnnouncerVoice {
  /** 'male' | 'female' (default 'female'); a voice-name fragment ('Daniel', 'en-GB') is matched when present. */
  voiceHint?: string;
  pitch?: number;
  rate?: number;
  /** 0..1 multiplier on the voice volume. */
  volume?: number;
}

interface Voice {
  key: AnyKey;
  src: AudioBufferSourceNode;
  gain: GainNode;
  send: GainNode | null;
  start: number;
  end: number;
  vol: number;
  stopping: boolean;
  /** mix priority tier (mixer.ts) and small-arms category. */
  tier: number;
  small: boolean;
}

function reportError(e: unknown): void {
  // surface errors from user callbacks without breaking our own state machines
  setTimeout(() => { throw e; }, 0);
}

export class AudioSystem implements AudioApi {
  onAnnounce?: (text: string, key: AnnouncerKey) => void;

  private ctx: AudioContext | null = null;
  private unlocked = false;
  private unlockPromise: Promise<void> | null = null;
  private resolveUnlock: (() => void) | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private voiceBus: GainNode | null = null;
  private musicIn: GainNode | null = null;
  private world: BiquadFilterNode | null = null;
  private sfxVerb: GainNode | null = null;
  // small-arms sub-bus (ducked under big guns), the explosion "thump" low-pass + dip, mix stats
  private smallBus: GainNode | null = null;
  private thumpLp: BiquadFilterNode | null = null;
  private thumpGain: GainNode | null = null;
  private duckUntil = 0;
  private lastThump = 0;
  private clashBoost = 0;
  private heatIntensity = 0;
  /** Live mix diagnostics (voice counts, drops, steals, ducks). */
  readonly mixStats: MixStats = newMixStats();
  private scape: Soundscape | null = null;
  private pendingAmb: Partial<AmbienceState> | null = null;
  private stingers: StingerEngine | null = null;
  private stingerEnd = 0;
  private stingerPri = 0;
  private bank: SfxBank | null = null;

  private voices: Voice[] = [];
  private lastByKey = new Map<AnyKey, Voice>();
  private lastVariation = new Map<AnyKey, number>();

  private lx = 0;
  private ly = 0;
  private lr = 16;
  private hasListener = false;

  private vol: AudioVolumes;

  private music: MusicEngine | null = null;
  private musicDucked = false;
  private musicWanted = false;
  private musicSeed: number | undefined;
  private intensity = 0;

  private speech: Speech;
  private speechPrimed = false;
  private annQueue: { key: AnnouncerKey; at: number }[] = [];
  private annBusy = false;
  private annCurrent: AnnouncerKey | null = null;
  private annLast = new Map<AnnouncerKey, number>();
  private lastResponseAt = -Infinity;
  private lastLine = new Map<string, string>();
  private annVoice: AnnouncerVoice | null = null;

  constructor() {
    this.vol = { ...DEFAULT_VOLUMES };
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
      if (raw) {
        const v = JSON.parse(raw) as Partial<AudioVolumes>;
        for (const k of Object.keys(DEFAULT_VOLUMES) as (keyof AudioVolumes)[]) {
          const x = v?.[k];
          if (typeof x === 'number' && Number.isFinite(x)) this.vol[k] = clamp(x, 0, 1);
        }
      }
    } catch { /* ignore corrupt storage */ }
    this.speech = new Speech();
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** True once the AudioContext is running. */
  get isUnlocked(): boolean { return this.unlocked; }
  /** The underlying AudioContext (null before unlock / when unsupported). */
  get context(): AudioContext | null { return this.ctx; }
  /** Fraction of SFX variations rendered (0..1). */
  get loadProgress(): number { return this.bank?.progress ?? 0; }
  /** Resolves when every SFX variation has been pre-rendered (resolves immediately if audio is unavailable). */
  whenSfxReady(): Promise<void> { return this.bank ? this.bank.done : Promise.resolve(); }

  unlock(): Promise<void> {
    if (!this.speechPrimed) {
      this.speechPrimed = true;
      this.speech.prime();
    }
    if (this.unlocked) {
      if (this.ctx && this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
      return Promise.resolve();
    }
    if (!this.unlockPromise) this.unlockPromise = new Promise<void>((res) => { this.resolveUnlock = res; });
    try {
      if (!this.ctx) {
        const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
        const Ctor = w.AudioContext ?? w.webkitAudioContext;
        if (!Ctor) { this.resolveUnlock?.(); return this.unlockPromise; }
        try { this.ctx = new Ctor({ latencyHint: 'interactive' }); } catch { this.ctx = new Ctor(); } // old WebKit: no options
        this.buildGraph(this.ctx);
        this.ctx.addEventListener('statechange', () => { if (this.ctx?.state === 'running') this.markUnlocked(); });
      }
      const ctx = this.ctx;
      // iOS/Safari: starting a (silent) source inside the gesture unlocks output
      const b = ctx.createBuffer(1, 1, ctx.sampleRate);
      const s = ctx.createBufferSource();
      s.buffer = b;
      s.connect(ctx.destination);
      s.start(0);
      if (ctx.state === 'running') this.markUnlocked();
      else ctx.resume().then(() => { if (ctx.state === 'running') this.markUnlocked(); }).catch(() => {});
    } catch {
      // Web Audio unusable: stay silent but don't hang callers
      this.ctx = null;
      this.resolveUnlock?.();
    }
    return this.unlockPromise;
  }

  private markUnlocked(): void {
    if (this.unlocked || !this.ctx) return;
    this.unlocked = true;
    this.bank?.start();
    try { this.scape?.start(); } catch { /* ambience is optional */ }
    this.resolveUnlock?.();
    if (this.musicWanted) this.startMusicNow();
  }

  private buildGraph(ctx: AudioContext): void {
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 3;
    limiter.ratio.value = 16;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.15;
    limiter.connect(ctx.destination);
    const mk = (v: number, to: AudioNode) => { const g = ctx.createGain(); g.gain.value = v; g.connect(to); return g; };
    this.master = mk(curve(this.vol.master), limiter);
    // big nearby blasts briefly low-pass and dip everything diegetic + the score ("ears ringing" thump)
    const thumpLp = ctx.createBiquadFilter();
    thumpLp.type = 'lowpass';
    thumpLp.frequency.value = 20000;
    thumpLp.Q.value = 0.5;
    const thumpGain = mk(1, this.master);
    thumpLp.connect(thumpGain);
    this.thumpLp = thumpLp;
    this.thumpGain = thumpGain;
    // "world" = everything diegetic (sfx, ambience, env reverb); snow / fog dull its highs a little
    const world = ctx.createBiquadFilter();
    world.type = 'highshelf';
    world.frequency.value = 3200;
    world.gain.value = 0;
    world.connect(thumpLp);
    this.world = world;
    this.sfxBus = mk(curve(this.vol.sfx), world);
    this.smallBus = mk(1, this.sfxBus);
    this.musicBus = mk(curve(this.vol.music), thumpLp);
    this.musicIn = mk(1, this.musicBus);
    this.voiceBus = mk(curve(this.vol.voice), this.master);
    try {
      const scape = new Soundscape(ctx, world, { shelf: world });
      scape.setVolume(curve(this.vol.ambience), 0.001);
      if (scape.verbIn) this.sfxVerb = mk(curve(this.vol.sfx), scape.verbIn);
      if (this.pendingAmb) scape.setState(this.pendingAmb);
      this.pendingAmb = null;
      this.scape = scape;
    } catch {
      this.scape = null;
    }
    // render at ≤48 kHz (playback resamples if the device runs faster)
    const rate = ctx.sampleRate > 48000 ? 48000 : ctx.sampleRate < 22050 ? 44100 : ctx.sampleRate;
    this.bank = new SfxBank(rate);
  }

  // -------------------------------------------------------------------------
  // Sound effects
  // -------------------------------------------------------------------------

  setListener(x: number, y: number, viewRadius: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    this.lx = x;
    this.ly = y;
    this.lr = Number.isFinite(viewRadius) && viewRadius > 0.5 ? viewRadius : 0.5;
    this.hasListener = true;
  }

  /** `delay`: start this many seconds from now (layered kill sounds, cook-off pops). */
  play(key: SfxKey, pos?: { x: number; y: number }, opts?: { volume?: number; pitch?: number; delay?: number }): void {
    try {
      this.playKey(key, this.sfxBus, pos, opts?.volume ?? 1, opts?.pitch ?? 1, opts?.delay ?? 0);
    } catch { /* never throw into game code */ }
  }

  private playKey(key: AnyKey, bus: GainNode | null, pos: { x: number; y: number } | undefined, volume: number, pitch: number, delay = 0): void {
    const ctx = this.ctx;
    if (!this.unlocked || !ctx || !bus || !this.bank) return;
    this.mixStats.requested++;
    if (ctx.state !== 'running') { ctx.resume().catch(() => {}); return; }
    const recipe = RECIPES[key];
    if (!recipe) return;
    const bufs = this.bank.get(key);
    if (!bufs || !bufs.length) { this.bank.request(key); return; }

    // --- spatialisation
    let att = 1;
    let pan = 0;
    let lp = 0;
    let send = 0;
    if (pos && this.hasListener && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
      const dx = pos.x - this.lx;
      const dy = pos.y - this.ly;
      const d = Math.hypot(dx, dy * 1.15) / (this.lr * (recipe.range ?? 1));
      // distant sounds are more reverberant (env reverb send grows with distance)
      send = 0.3 + 0.7 * clamp((d - 0.2) / 1.4, 0, 1);
      att = d <= 0.6 ? 1 : Math.pow(Math.max(0, 1 - (d - 0.6) / 1.6), 2);
      if (att < 0.015) { this.mixStats.culled++; return; } // well off-screen: cull
      pan = clamp(dx / (this.lr * 1.1), -1, 1) * 0.85;
      if (d > 0.8) lp = 18000 * Math.pow(2500 / 18000, clamp((d - 0.8) / 1.4, 0, 1));
    }
    const vol = att * clamp(Number.isFinite(volume) ? volume : 1, 0, 4);
    if (vol < 0.002) return;
    const now = ctx.currentTime;

    const juice = JUICE.on;
    const tier = juice ? sfxTier(key) : 2;
    const small = juice && bus === this.sfxBus && isSmallArms(key);
    const at = now + (delay > 0 ? Math.min(delay, 4) : 0);

    // --- merge rapid duplicates
    const last = this.lastByKey.get(key);
    if (last && !last.stopping && Math.abs(at - last.start) < MERGE_WINDOW) {
      if (vol > last.vol) {
        last.vol = Math.min(vol, last.vol * 1.5 + 0.1);
        last.gain.gain.setTargetAtTime(last.vol, Math.max(now, last.start), 0.005);
      }
      this.mixStats.merged++;
      return;
    }

    // --- voice limiting (priority tiers + a small-arms cap: rifles never cut off a tank gun)
    this.reap(now);
    const maxKey = recipe.maxVoices ?? MAX_PER_KEY;
    let sameKey = 0;
    let oldestSame: Voice | null = null;
    let active = 0;
    let smallN = 0;
    let oldestSmall: Voice | null = null;
    for (const v of this.voices) {
      if (v.stopping) continue;
      active++;
      if (v.small) {
        smallN++;
        if (!oldestSmall || v.start < oldestSmall.start) oldestSmall = v;
      }
      if (v.key === key) {
        sameKey++;
        if (!oldestSame || v.start < oldestSame.start) oldestSame = v;
      }
    }
    if (sameKey >= maxKey && oldestSame) this.stopVoice(oldestSame, now);
    else if (small && smallN >= SMALL_ARMS_CAP && oldestSmall) {
      if (vol < oldestSmall.vol * 0.5) { this.mixStats.dropped++; return; }
      this.stopVoice(oldestSmall, now);
      this.mixStats.stolen++;
    } else if (active >= MAX_VOICES) {
      const vi = pickVictim(this.voices, tier, vol, now);
      if (vi < 0) { this.mixStats.dropped++; return; } // quieter / lower priority than everything playing: skip
      this.stopVoice(this.voices[vi], now);
      this.mixStats.stolen++;
    }

    // --- pick variation (avoid immediate repeats)
    let vi = Math.floor(Math.random() * bufs.length);
    if (bufs.length > 1 && vi === this.lastVariation.get(key)) vi = (vi + 1) % bufs.length;
    this.lastVariation.set(key, vi);
    const buf = bufs[vi];

    const src = ctx.createBufferSource();
    src.buffer = buf;
    const rate = clamp(Number.isFinite(pitch) ? pitch : 1, 0.25, 4) * (STEADY.has(key) ? 1 : 1 + (Math.random() * 2 - 1) * PITCH_VARIATION);
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = vol;
    let node: AudioNode = src;
    if (lp > 0) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lp;
      node.connect(f);
      node = f;
    }
    node.connect(g);
    node = g;
    if (pan !== 0 && typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      node.connect(p);
      node = p;
    }
    node.connect(small && this.smallBus ? this.smallBus : bus);
    if (juice && att > 0.3 && ducksSmallArms(key)) this.duckSmallArms(at);
    let sg: GainNode | null = null;
    if (send > 0 && this.sfxVerb && bus === this.sfxBus) {
      sg = ctx.createGain();
      sg.gain.value = send;
      g.connect(sg);
      sg.connect(this.sfxVerb);
    }
    src.start(at);
    const voice: Voice = { key, src, gain: g, send: sg, start: at, end: at + buf.duration / rate + 0.05, vol, stopping: false, tier, small };
    src.onended = () => this.release(voice);
    this.voices.push(voice);
    this.lastByKey.set(key, voice);
    // stats
    const ms = this.mixStats;
    ms.started++;
    ms.active = active + 1;
    if (ms.active > ms.peak) ms.peak = ms.active;
    if (small) { ms.small = smallN + 1; if (ms.small > ms.smallPeak) ms.smallPeak = ms.small; }
  }

  /** Duck the small-arms sub-bus for a moment under a big gun / explosion starting at `at`. */
  private duckSmallArms(at: number): void {
    const ctx = this.ctx;
    const g = this.smallBus?.gain;
    if (!ctx || !g) return;
    const now = ctx.currentTime;
    const t = Math.max(now, at);
    const already = t < this.duckUntil;
    this.duckUntil = Math.max(this.duckUntil, t + DUCK_HOLD);
    // (re)schedule: down at t (a no-op when already down), back up once the latest big sound's hold is over
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.setTargetAtTime(DUCK_LEVEL, already ? now : t, 0.012);
    g.setTargetAtTime(1, this.duckUntil, 0.25);
    if (!already) this.mixStats.ducks++;
  }

  /**
   * Low-pass "thump" after a big blast close to the camera: everything diegetic and the score dull
   * down for a moment and swell back (0..1 strength; ~0.4 for a dying tank next to the camera, 1 for a nuke).
   */
  thump(strength: number): void {
    try {
      const ctx = this.ctx;
      const lp = this.thumpLp, tg = this.thumpGain;
      if (!JUICE.on || !this.unlocked || !ctx || !lp || !tg || !(strength > 0.05)) return;
      const now = ctx.currentTime;
      if (now - this.lastThump < 0.35) return;
      this.lastThump = now;
      const k = clamp(strength, 0, 1);
      const f = 1400 - 1050 * k; // 1.4 kHz light … 350 Hz massive
      const rel = 0.25 + 0.6 * k;
      lp.frequency.cancelScheduledValues(now);
      lp.frequency.setValueAtTime(lp.frequency.value, now);
      lp.frequency.setTargetAtTime(f, now, 0.015);
      lp.frequency.setTargetAtTime(20000, now + 0.08 + 0.12 * k, rel);
      tg.gain.cancelScheduledValues(now);
      tg.gain.setValueAtTime(tg.gain.value, now);
      tg.gain.setTargetAtTime(1 - 0.28 * k, now, 0.02);
      tg.gain.setTargetAtTime(1, now + 0.1 + 0.1 * k, rel * 0.8);
      this.mixStats.thumps++;
    } catch { /* never throw */ }
  }

  /** Reset the peak counters of mixStats (diagnostics). */
  resetMixStats(): void {
    Object.assign(this.mixStats, newMixStats());
  }

  private stopVoice(v: Voice, now: number): void {
    if (v.stopping) return;
    v.stopping = true;
    try {
      v.gain.gain.cancelScheduledValues(now);
      v.gain.gain.setValueAtTime(v.gain.gain.value, now);
      v.gain.gain.linearRampToValueAtTime(0, now + 0.015);
      v.src.stop(now + 0.02);
    } catch { /* already stopped */ }
  }

  private release(v: Voice): void {
    const i = this.voices.indexOf(v);
    if (i >= 0) this.voices.splice(i, 1);
    if (this.lastByKey.get(v.key) === v) this.lastByKey.delete(v.key);
    try { v.gain.disconnect(); v.send?.disconnect(); } catch { /* ignore */ }
  }

  /** Drop voices whose `ended` event was missed. */
  private reap(now: number): void {
    for (let i = this.voices.length - 1; i >= 0; i--) {
      if (this.voices[i].end < now - 0.25) this.release(this.voices[i]);
    }
  }

  /** Number of currently tracked SFX voices (diagnostics). */
  get activeVoices(): number {
    let n = 0;
    for (const v of this.voices) if (!v.stopping) n++;
    return n;
  }

  // -------------------------------------------------------------------------
  // Announcer & unit responses
  // -------------------------------------------------------------------------

  announce(key: AnnouncerKey): void {
    try {
      const text = ANNOUNCER_TEXT[key];
      if (!text) return;
      const now = performance.now();
      const thr = ANNOUNCER_THROTTLE[key] ?? DEFAULT_THROTTLE;
      const last = this.annLast.get(key);
      if (last !== undefined && now - last < thr) return;
      if (this.annCurrent === key || this.annQueue.some((q) => q.key === key)) return;
      this.annLast.set(key, now);
      if (!this.unlocked) {
        // no audio yet: still deliver the subtitle
        this.emitSubtitle(text, key);
        return;
      }
      if (this.annQueue.length >= 2) {
        const pri = ANNOUNCER_PRIORITY[key] ?? 1;
        let lowI = -1;
        let lowP = Infinity;
        this.annQueue.forEach((q, i) => {
          const p = ANNOUNCER_PRIORITY[q.key] ?? 1;
          if (p < lowP) { lowP = p; lowI = i; }
        });
        if (lowI < 0 || lowP >= pri) return;
        this.annQueue.splice(lowI, 1);
      }
      this.annQueue.push({ key, at: now });
      this.pumpAnnouncer();
    } catch { /* never throw */ }
  }

  private emitSubtitle(text: string, key: AnnouncerKey): void {
    if (!this.onAnnounce) return;
    try { this.onAnnounce(text, key); } catch (e) { reportError(e); }
  }

  private pumpAnnouncer(): void {
    if (this.annBusy) return;
    let item: { key: AnnouncerKey; at: number } | undefined;
    while ((item = this.annQueue.shift())) {
      if (performance.now() - item.at < 8000) break; // stale news is dropped
    }
    if (!item) {
      if (this.musicDucked) this.setDuck(false);
      return;
    }
    const key = item.key;
    const text = ANNOUNCER_TEXT[key];
    this.annBusy = true;
    this.annCurrent = key;
    this.emitSubtitle(text, key);
    if (this.speech.speaking) this.speech.cancel(); // announcements override unit chatter
    this.playKey(key === 'unit_promoted' ? '_rankup' : '_chirp', this.voiceBus, undefined, 1, 1);
    this.setDuck(true);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      this.annBusy = false;
      this.annCurrent = null;
      if (!this.annQueue.length) this.setDuck(false);
      setTimeout(() => this.pumpAnnouncer(), 250);
    };
    setTimeout(() => {
      const o = this.announcerSpeakOpts(); // cosmetic announcer voice (default when none)
      const ok = o.volume > 0.001 && this.speech.speak(text, o, finish);
      // no speech available: keep subtitle pacing / non-overlap with an estimated duration
      if (!ok) setTimeout(finish, 450 + text.length * 55);
    }, 170);
  }

  /**
   * Set the announcer's voice style (cosmetics); null restores the default announcer. Only the
   * announcer changes: unit acknowledgements keep their own voices.
   */
  setAnnouncerVoice(preset: AnnouncerVoice | null): void {
    this.annVoice = preset && typeof preset === 'object' ? preset : null;
  }

  /** Speak a line in an announcer voice right now (Locker preview); false when speech is unavailable. */
  previewAnnouncerVoice(preset: AnnouncerVoice | null, text = 'Reinforcements have arrived. Construction complete.'): boolean {
    try {
      const keep = this.annVoice;
      this.annVoice = preset;
      const o = this.announcerSpeakOpts();
      this.annVoice = keep;
      if (o.volume <= 0.001) return false;
      if (this.speech.speaking) this.speech.cancel();
      return this.speech.speak(String(text).slice(0, 200), o, () => {});
    } catch {
      return false;
    }
  }

  private announcerSpeakOpts(): { voice: SpeechSynthesisVoice | null; pitch: number; rate: number; volume: number } {
    const p = this.annVoice;
    const num = (v: unknown, lo: number, hi: number, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : d);
    let voice: SpeechSynthesisVoice | null = null;
    let hint: unknown;
    try { hint = p?.voiceHint; } catch { hint = undefined; }
    if (typeof hint === 'string' && hint && hint !== 'male' && hint !== 'female') {
      const h = hint.toLowerCase();
      try {
        const all = typeof speechSynthesis !== 'undefined' ? speechSynthesis.getVoices() : [];
        voice = all.find((v) => v.name.toLowerCase().includes(h) || v.lang.toLowerCase() === h) ?? null;
      } catch { voice = null; }
    }
    voice ??= this.speech.voiceFor(hint === 'male' ? 'male' : 'female');
    return {
      voice,
      pitch: num(p?.pitch, 0.1, 2, 0.92),
      rate: num(p?.rate, 0.5, 2, 1.04),
      volume: this.speechVolume() * num(p?.volume, 0, 1, 1),
    };
  }

  /** Lower the music ~5 dB while the announcer talks (speech bypasses Web Audio, so we can't sidechain it). */
  private setDuck(on: boolean): void {
    this.musicDucked = on;
    const ctx = this.ctx;
    if (ctx && this.musicBus) this.musicBus.gain.setTargetAtTime(this.musicGain(), ctx.currentTime, on ? 0.08 : 0.4);
    this.scape?.setAnnouncerDuck(on);
  }

  private musicGain(): number {
    return curve(this.vol.music) * (this.musicDucked ? 0.55 : 1);
  }

  private speechVolume(): number {
    return clamp(curve(this.vol.master) * curve(this.vol.voice) * 1.15, 0, 1);
  }

  unitResponse(kind: ResponseKind, voice: VoiceKind): void {
    try {
      if (!this.unlocked) return;
      const now = performance.now();
      if (now - this.lastResponseAt < RESPONSE_GAP_MS || this.annBusy) return;
      if (voice === 'dog') {
        this.lastResponseAt = now;
        this.play('dog_bark', undefined, { volume: 0.7 });
        return;
      }
      const lines = RESPONSE_LINES[voice]?.[kind];
      const p = VOICE_PARAMS[voice];
      if (!lines || !lines.length || !p) return;
      this.lastResponseAt = now;
      const lk = voice + ':' + kind;
      let line = lines[Math.floor(Math.random() * lines.length)];
      if (lines.length > 1 && line === this.lastLine.get(lk)) line = lines[(lines.indexOf(line) + 1) % lines.length];
      this.lastLine.set(lk, line);
      const vol = this.speechVolume() * 0.9;
      if (p.radio || !this.speech.hasVoices) this.playKey('_radio', this.voiceBus, undefined, 1, 1);
      if (vol <= 0.001 || !this.speech.hasVoices) return;
      const opts = { voice: this.speech.voiceFor(p.gender), pitch: p.pitch, rate: p.rate, volume: vol };
      if (this.speech.speaking) {
        this.speech.cancel();
        setTimeout(() => { if (!this.annBusy) this.speech.speak(line, opts, () => {}); }, 60);
      } else {
        this.speech.speak(line, opts, () => {});
      }
    } catch { /* never throw */ }
  }

  // -------------------------------------------------------------------------
  // Music
  // -------------------------------------------------------------------------

  /** Start (or restart with a fresh seed) the procedural soundtrack. Deferred until unlock if needed. */
  startMusic(seed?: number): void {
    this.musicWanted = true;
    this.musicSeed = seed;
    if (this.unlocked) this.startMusicNow();
  }

  private startMusicNow(): void {
    try {
      const ctx = this.ctx;
      if (!ctx || !this.musicBus) return;
      if (this.music) this.music.stop(1.2);
      const seed = this.musicSeed ?? (Math.floor(Math.random() * 0xffffffff) >>> 0);
      this.musicSeed = undefined;
      const eng = new MusicEngine(ctx, this.musicIn ?? this.musicBus, seed);
      eng.setIntensity(this.intensity, true);
      eng.start(ctx.currentTime + 0.1, 2.5);
      eng.startTimer();
      this.music = eng;
    } catch {
      this.music = null;
    }
  }

  stopMusic(): void {
    this.musicWanted = false;
    try { this.music?.stop(1.5); } catch { /* ignore */ }
    this.music = null;
  }

  setMusicIntensity(v: number): void {
    if (!Number.isFinite(v)) return;
    this.heatIntensity = clamp(v, 0, 1);
    // a big clash in view keeps the score at full battle intensity
    this.intensity = Math.max(this.heatIntensity, this.clashBoost);
    this.music?.setIntensity(this.intensity);
  }

  /**
   * Big-battle level 0..1 (from the battle director): pushes the score to full intensity and layers
   * the battle theme on top (taiko ostinato, brass, choir pad; see MusicEngine.setClash).
   */
  setClash(level: number): void {
    if (!Number.isFinite(level)) return;
    const l = clamp(level, 0, 1);
    this.clashBoost = l > 0.05 ? Math.min(1, 0.7 + 0.3 * l) : 0;
    this.intensity = Math.max(this.heatIntensity, this.clashBoost);
    this.music?.setIntensity(this.intensity);
    this.music?.setClash(l);
  }

  /** Diagnostics: notes scheduled by the current music engine. */
  get musicNotes(): number { return this.music?.notes ?? 0; }

  // -------------------------------------------------------------------------
  // Volumes & housekeeping
  // -------------------------------------------------------------------------

  setVolumes(v: Partial<AudioVolumes>): void {
    try {
      for (const k of Object.keys(DEFAULT_VOLUMES) as (keyof AudioVolumes)[]) {
        const x = v?.[k];
        if (typeof x === 'number' && Number.isFinite(x)) this.vol[k] = clamp(x, 0, 1);
      }
      const ctx = this.ctx;
      if (ctx) {
        const t = ctx.currentTime;
        this.master?.gain.setTargetAtTime(curve(this.vol.master), t, 0.02);
        this.sfxBus?.gain.setTargetAtTime(curve(this.vol.sfx), t, 0.02);
        this.musicBus?.gain.setTargetAtTime(this.musicGain(), t, 0.02);
        this.voiceBus?.gain.setTargetAtTime(curve(this.vol.voice), t, 0.02);
        this.sfxVerb?.gain.setTargetAtTime(curve(this.vol.sfx), t, 0.02);
        this.scape?.setVolume(curve(this.vol.ambience));
      }
      if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(this.vol));
    } catch { /* storage may be unavailable */ }
  }

  getVolumes(): AudioVolumes {
    return { ...this.vol };
  }

  // -------------------------------------------------------------------------
  // Living soundscape, thunder & stingers
  // -------------------------------------------------------------------------

  /**
   * Ambience state (call ~10×/s). Values are smoothed internally; missing fields keep their previous
   * value. The soundscape stays silent until the first call (and after stopAmbience()).
   */
  setAmbience(a: Partial<AmbienceState>): void {
    try {
      if (!a || typeof a !== 'object') return;
      if (this.scape) this.scape.setState(a);
      else this.pendingAmb = { ...(this.pendingAmb ?? {}), ...a };
    } catch { /* never throw */ }
  }

  /** Fade the soundscape out (e.g. back to the main menu); the next setAmbience() fades it back in. */
  stopAmbience(): void {
    this.pendingAmb = null;
    try { this.scape?.reset(); } catch { /* ignore */ }
  }

  /**
   * Thunder: crack + long rolling rumble. `distanceCells` 0 = overhead … ≥ 48 = far (low-passed, no
   * crack); `intensity` 0..1 (up to 1.5 for a monster strike); `pan` −1..1 optional. Call it after the
   * flash with a delay of ≈ distanceCells × 0.03 s.
   */
  thunder(distanceCells: number, intensity: number, pan?: number): void {
    try {
      if (!this.unlocked || !this.ctx || this.ctx.state !== 'running') return;
      this.scape?.thunder(distanceCells, intensity, pan);
    } catch { /* never throw */ }
  }

  /** Short musical phrase in the current key of the score, on its next beat; ducks the music meanwhile. */
  stinger(kind: StingerKind): void {
    try {
      const ctx = this.ctx;
      const info = STINGER_INFO[kind];
      if (!info || !this.unlocked || !ctx || !this.musicBus || ctx.state !== 'running') return;
      const now = ctx.currentTime;
      // one at a time: a stinger only interrupts a lower-priority one
      if (now < this.stingerEnd && info.priority <= this.stingerPri) return;
      if (!this.stingers) this.stingers = new StingerEngine(ctx, this.musicBus);
      const h = this.music?.isRunning ? this.music.harmony() : { key: 26, stepDur: 60 / 140 / 4, nextBeat: now + 0.03 };
      let when = Math.max(h.nextBeat, now + 0.03);
      // don't make the player wait more than ~half a bar: fall back to the next 8th
      if (when - now > 0.75) when = now + 0.05 + ((when - now - 0.05) % (h.stepDur * 2));
      const len = this.stingers.play(kind, { key: h.key, stepDur: h.stepDur, when });
      this.stingerEnd = when + len * 0.8;
      this.stingerPri = info.priority;
      const g = this.musicIn?.gain;
      if (g) {
        g.cancelScheduledValues(now);
        g.setValueAtTime(g.value, now);
        g.setTargetAtTime(info.duck, Math.max(now, when - 0.12), 0.05);
        g.setTargetAtTime(1, when + len * (info.duck < 0.2 ? 0.95 : 0.7), info.duck < 0.2 ? 1.2 : 0.6);
      }
    } catch { /* never throw */ }
  }

  /** The soundscape (diagnostics / preview UI); null before the graph exists. */
  get ambience(): Soundscape | null { return this.scape; }

  update(dt: number): void {
    try {
      if (!this.ctx) return;
      this.music?.smooth(Number.isFinite(dt) ? dt : 0);
      if (this.voices.length) this.reap(this.ctx.currentTime);
    } catch { /* ignore */ }
  }
}
