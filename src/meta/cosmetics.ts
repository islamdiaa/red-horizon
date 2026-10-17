/**
 * Applies the equipped cosmetics (src/meta/unlocks.ts): the unit paint scheme of the local player's army
 * (render only, through the team-colour uniforms in src/render/models/materials.ts), the HUD accent theme
 * (CSS variables), the announcer voice style, the victory fanfare, portraits and banners. Nothing here can
 * change the simulation: paint, colour, voice and music are presentation.
 *
 * Browser-only module (DOM, WebAudio, WebGL thumbnails); node tests use unlocks.ts directly.
 */
import type { AudioSystem } from '../audio';
import { setPaintScheme, type PaintScheme } from '../render/models/materials';
import { renderThumbnails } from '../render/thumbnails';
import { rivalPortraitSvg } from '../ui/rivals';
import { COSMETICS, COSMETIC_BY_ID, equipped, type CosmeticDef, type FanfareSpec, type UnlockCtx, type VoiceSpec } from './unlocks';
import { unlockContext } from './index';
import { rankIndexFor } from './ranks';
import type { Profile } from './profile';

// ---------------------------------------------------------------------------
// Paint schemes
// ---------------------------------------------------------------------------
let activePaint: { hex: number; scheme: PaintScheme | null } = { hex: -1, scheme: null };

function setPaint(hex: number, scheme: PaintScheme | null) {
  setPaintScheme(hex, scheme);
  activePaint = { hex: scheme ? hex : -1, scheme };
}

/**
 * Start-of-match cosmetics: the local army's paint scheme (only for a match the player commands: not the
 * menu backdrop or a replay), the HUD theme and the announcer voice.
 */
export function applyMatchCosmetics(opts: { teamColor: number; commanded: boolean; audio?: AudioSystem }) {
  try {
    const ctx = unlockContext();
    const paint = equipped('paint', ctx).paint ?? null;
    setPaint(opts.teamColor, opts.commanded ? paint : null);
    applyHudTheme(ctx);
    if (opts.audio) bindCosmeticsAudio(opts.audio);
    voiceNow = voiceSpecFor(ctx);
  } catch (e) {
    console.warn('cosmetics', e);
  }
}

/** Back to factory colours (the match is over and torn down). */
export function clearMatchCosmetics() {
  if (activePaint.scheme) setPaint(activePaint.hex, null);
}

/** Locker previews: one portrait of a tank per paint scheme, in the player's colour (procedural models). */
export function paintPreviews(hex: number, faction: 'allies' | 'soviet', w = 216, h = 150): Map<string, string> {
  const out = new Map<string, string>();
  const unit = faction === 'soviet' ? '3tnk' : '2tnk';
  const keep = activePaint;
  try {
    for (const def of COSMETICS) {
      if (def.slot !== 'paint') continue;
      setPaintScheme(hex, def.paint ?? null);
      const url = renderThumbnails([unit], hex, w, h, faction).get(unit);
      if (url) out.set(def.id, url);
    }
  } catch (e) {
    console.warn('paint previews', e);
  } finally {
    setPaintScheme(hex, null);
    if (keep.scheme) setPaintScheme(keep.hex, keep.scheme);
  }
  return out;
}

// ---------------------------------------------------------------------------
// HUD accent themes
// ---------------------------------------------------------------------------
function ensureThemeCss() {
  if (typeof document === 'undefined' || document.getElementById('rh-theme-style')) return;
  const st = document.createElement('style');
  st.id = 'rh-theme-style';
  st.textContent = COSMETICS.filter((c) => c.theme).map((c) => {
    const t = c.theme!;
    return `body.rh-${c.id}, body.rh-${c.id}.faction-soviet { --accent: ${t.accent}; --accent-rgb: ${t.rgb}; --accent-hi: ${t.hi}; }`;
  }).join('\n');
  document.head.appendChild(st);
}

/** Apply the equipped HUD accent theme (a body class; the faction colours when none). */
export function applyHudTheme(ctx: UnlockCtx = unlockContext()) {
  if (typeof document === 'undefined') return;
  ensureThemeCss();
  const id = equipped('theme', ctx).id;
  for (const c of [...document.body.classList]) if (c.startsWith('rh-theme-') && c !== `rh-${id}`) document.body.classList.remove(c);
  if (COSMETIC_BY_ID[id]?.theme) document.body.classList.add(`rh-${id}`);
}

// ---------------------------------------------------------------------------
// Announcer voice styles
// ---------------------------------------------------------------------------
let boundAudio: AudioSystem | null = null;
let voiceNow: VoiceSpec | null = null;

function voiceSpecFor(ctx: UnlockCtx): VoiceSpec | null {
  const d = equipped('voice', ctx);
  return d.req.kind === 'default' ? null : d.voice ?? null;
}

/**
 * Give the announcer the equipped voice style. Uses the engine's public announcer-voice preset
 * (AudioSystem.setAnnouncerVoice) instead of wrapping its speech instance: the preset's fields are getters on
 * `voiceNow`, read each time an announcement is spoken, so refreshVoice() takes effect at once. No style
 * equipped (default) = undefined fields = the default announcer. Unit voices are untouched.
 */
export function bindCosmeticsAudio(audio: AudioSystem) {
  boundAudio = audio;
  voiceNow = voiceSpecFor(unlockContext());
  if (typeof audio.setAnnouncerVoice !== 'function') return;
  audio.setAnnouncerVoice({
    get voiceHint() { return voiceNow?.gender; },
    get pitch() { return voiceNow?.pitch; },
    get rate() { return voiceNow?.rate; },
  });
}

/** Re-read the equipped voice (after the Locker changed it). */
export function refreshVoice() {
  voiceNow = voiceSpecFor(unlockContext());
}

/** Locker preview of a voice style. */
export function previewVoice(def: CosmeticDef): boolean {
  const v = def.voice;
  if (!v || !boundAudio) return false;
  // public audio API (no reach into the speech engine's internals)
  return boundAudio.previewAnnouncerVoice({ voiceHint: v.gender, pitch: v.pitch, rate: v.rate });
}

// ---------------------------------------------------------------------------
// Victory fanfares (a small WebAudio synth on the game's audio context)
// ---------------------------------------------------------------------------
const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

function playSpec(spec: FanfareSpec): boolean {
  const audio = boundAudio;
  const ctx = audio?.context;
  if (!audio || !ctx || ctx.state !== 'running') return false;
  const v = audio.getVolumes();
  const out = ctx.createGain();
  out.gain.value = Math.max(0, Math.min(1, (v.master ?? 0.85) * Math.max(0.35, v.music ?? 0.6))) * 0.5;
  // a short hall: two damped echoes
  const dl = ctx.createDelay(1);
  dl.delayTime.value = 0.19;
  const fb = ctx.createGain();
  fb.gain.value = 0.28;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2400;
  out.connect(ctx.destination);
  out.connect(dl);
  dl.connect(lp).connect(fb).connect(dl);
  fb.connect(ctx.destination);
  const beat = 60 / spec.bpm;
  const t0 = ctx.currentTime + 0.06;
  let end = t0;
  for (const [semi, at, len, inst] of spec.notes) {
    const t = t0 + at * beat, d = Math.max(0.08, len * beat);
    end = Math.max(end, t + d + 1.6);
    note(ctx, out, inst, inst === 'timp' ? 48 + semi : inst === 'snare' ? 60 : 60 + semi, t, d);
  }
  window.setTimeout(() => { try { out.disconnect(); fb.disconnect(); dl.disconnect(); lp.disconnect(); } catch { /* gone */ } }, (end - ctx.currentTime + 1.5) * 1000);
  return true;
}

function env(ctx: BaseAudioContext, g: GainNode, t: number, a: number, peak: number, d: number, rel: number) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.setTargetAtTime(peak * 0.7, t + a, d * 0.4);
  g.gain.setTargetAtTime(0.0001, t + d, rel);
}

let noiseBuf: AudioBuffer | null = null;
function noise(ctx: BaseAudioContext): AudioBuffer {
  if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf;
  const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const ch = b.getChannelData(0);
  let s = 0x2468ace;
  for (let i = 0; i < ch.length; i++) { s = (Math.imul(s, 1103515245) + 12345) >>> 0; ch[i] = (s / 4294967296) * 2 - 1; }
  return (noiseBuf = b);
}

function note(ctx: BaseAudioContext, out: AudioNode, inst: FanfareSpec['notes'][number][3], midi: number, t: number, d: number) {
  const f = midiHz(midi);
  const g = ctx.createGain();
  g.connect(out);
  const stopAt = t + d + 2.5;
  const osc = (type: OscillatorType, freq: number, detune = 0) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    o.start(t);
    o.stop(stopAt);
    return o;
  };
  switch (inst) {
    case 'brass': {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 2;
      lp.frequency.setValueAtTime(500, t);
      lp.frequency.exponentialRampToValueAtTime(2600, t + 0.07);
      lp.frequency.setTargetAtTime(1300, t + 0.08, 0.25);
      lp.connect(g);
      osc('sawtooth', f, -7).connect(lp);
      osc('sawtooth', f, 7).connect(lp);
      env(ctx, g, t, 0.04, 0.32, d, 0.12);
      break;
    }
    case 'bugle': {
      const o = osc('triangle', f);
      const o2 = osc('sawtooth', f);
      const g2 = ctx.createGain();
      g2.gain.value = 0.18;
      o2.connect(g2).connect(g);
      o.connect(g);
      const lfo = osc('sine', 5.5);
      const lg = ctx.createGain();
      lg.gain.setValueAtTime(0, t);
      lg.gain.linearRampToValueAtTime(f * 0.012, t + Math.min(0.4, d));
      lfo.connect(lg).connect(o.frequency);
      env(ctx, g, t, 0.03, 0.42, d, 0.08);
      break;
    }
    case 'bell': {
      for (const [r, a] of [[1, 0.32], [2.76, 0.12], [5.4, 0.06], [0.5, 0.1]] as const) {
        const gg = ctx.createGain();
        gg.gain.setValueAtTime(a, t);
        gg.gain.exponentialRampToValueAtTime(0.0001, t + 2.4 / Math.sqrt(r));
        osc('sine', f * r).connect(gg).connect(g);
      }
      g.gain.value = 0.9;
      break;
    }
    case 'timp': {
      const o = osc('sine', f * 1.5);
      o.frequency.setValueAtTime(f * 1.5, t);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.08);
      o.connect(g);
      const n = ctx.createBufferSource();
      n.buffer = noise(ctx);
      const nl = ctx.createBiquadFilter();
      nl.type = 'lowpass';
      nl.frequency.value = 400;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.5, t);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      n.connect(nl).connect(ng).connect(g);
      n.start(t);
      n.stop(t + 0.3);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.7, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.6, d));
      break;
    }
    case 'snare': {
      const n = ctx.createBufferSource();
      n.buffer = noise(ctx);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1900;
      bp.Q.value = 0.8;
      n.connect(bp).connect(g);
      n.start(t);
      n.stop(t + 0.2);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.5, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      break;
    }
    case 'synth': {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1800;
      lp.Q.value = 4;
      lp.connect(g);
      osc('square', f).connect(lp);
      osc('sawtooth', f * 2, 5).connect(lp);
      env(ctx, g, t, 0.01, 0.22, d, 0.15);
      break;
    }
  }
}

/** Play the equipped victory fanfare. False for the standard one (the caller plays the score's stinger). */
export function playVictoryFanfare(): boolean {
  try {
    const spec = equipped('fanfare', unlockContext()).fanfare;
    return !!spec && playSpec(spec);
  } catch {
    return false;
  }
}

/** Locker preview of a fanfare (the standard one has no preview of its own). */
export function previewFanfare(def: CosmeticDef): boolean {
  return !!def.fanfare && playSpec(def.fanfare);
}

// ---------------------------------------------------------------------------
// Portraits, banners, titles
// ---------------------------------------------------------------------------
export function portraitSvg(def: CosmeticDef | undefined, p: Pick<Profile, 'faction' | 'xp'>): string {
  const spec = def?.portrait ?? COSMETIC_BY_ID['portrait-officer'].portrait!;
  return rivalPortraitSvg(spec, p.faction === 'soviet' ? 'soviet' : 'allies', Math.min(5, Math.floor(rankIndexFor(p.xp) / 3)), def?.id === 'portrait-scarred');
}

/** The equipped look of a profile: portrait markup, banner CSS background and title text ('' for none). */
export function commanderLook(ctx: UnlockCtx = unlockContext()): { portrait: string; banner: string; title: string } {
  const t = equipped('title', ctx);
  return {
    portrait: portraitSvg(equipped('portrait', ctx), ctx.profile),
    banner: equipped('banner', ctx).banner ?? COSMETIC_BY_ID['banner-standard'].banner!,
    title: t.req.kind === 'default' ? '' : t.name,
  };
}
