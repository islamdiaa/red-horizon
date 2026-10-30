/**
 * Audio preview page (dev/preview-audio.html) + headless self-test (?selftest=1).
 * The self-test renders every SFX offline, prints duration / peak / RMS per sound, renders
 * 16 bars of music at three intensities, renders every ambience bed / thunder / stinger offline
 * (levels, silence, NaN, clipping, clicks, loop seams), measures the soundscape CPU cost, and
 * smoke-tests the realtime API. Results go to the page and to console.warn (so tools/shot.mjs
 * prints them). Modes: ?selftest=1 (all), sfx, music, amb, cpu-amb, rt, parts, cpu.
 */
import { AudioSystem } from './index';
import { AmbBank, EnvReverb, LOOP_SPECS, envSpec, renderSoundscapeOffline } from './ambience';
import { GENERATORS, type BankKey } from './ambgen';
import { analyze, activeRms, gainToDb } from './dsp';
import { renderMusicOffline } from './music';
import { ALL_SFX_KEYS, RECIPES, SfxBank, renderSfx, type AnyKey } from './sfx';
import { ANNOUNCER_TEXT } from './speech';
import { renderStingerOffline } from './stingers';
import type { AmbienceState, AnnouncerKey, ResponseKind, SfxKey, StingerKind, VoiceKind, WeatherKind } from './types';

const STINGERS: StingerKind[] = ['mission_start', 'enemy_spotted', 'reinforcements', 'promotion', 'superweapon_ready', 'victory', 'defeat', 'battle_joined', 'battle_won', 'milestone'];

/** Named ambience presets (preview buttons + self-test beds). */
const AMB_PRESETS: Record<string, AmbienceState> = {
  day: { night: 0, weather: 'clear', intensity: 0, wind: 0.3, water: 0, forest: 0.35, battle: 0, offscreenBattle: 0, zoom: 0.3 },
  'day forest': { night: 0.05, weather: 'clear', intensity: 0, wind: 0.45, water: 0, forest: 1, battle: 0, offscreenBattle: 0, zoom: 0.15 },
  dusk: { night: 0.45, weather: 'clear', intensity: 0, wind: 0.25, water: 0.2, forest: 0.5, battle: 0, offscreenBattle: 0, zoom: 0.3 },
  night: { night: 1, weather: 'clear', intensity: 0, wind: 0.25, water: 0, forest: 0.5, battle: 0, offscreenBattle: 0, zoom: 0.3 },
  water: { night: 0.1, weather: 'clear', intensity: 0, wind: 0.35, water: 1, forest: 0.2, battle: 0, offscreenBattle: 0, zoom: 0.2 },
  'night lake': { night: 0.9, weather: 'clear', intensity: 0, wind: 0.2, water: 0.9, forest: 0.6, battle: 0, offscreenBattle: 0, zoom: 0.2 },
  rain: { night: 0.2, weather: 'rain', intensity: 1, wind: 0.4, water: 0, forest: 0.6, battle: 0, offscreenBattle: 0, zoom: 0.3 },
  storm: { night: 0.4, weather: 'storm', intensity: 1, wind: 0.9, water: 0, forest: 0.4, battle: 0, offscreenBattle: 0, zoom: 0.4 },
  snow: { night: 0.2, weather: 'snow', intensity: 1, wind: 0.5, water: 0, forest: 0.3, battle: 0, offscreenBattle: 0, zoom: 0.4 },
  fog: { night: 0.5, weather: 'fog', intensity: 1, wind: 0.15, water: 0.7, forest: 0.2, battle: 0, offscreenBattle: 0, zoom: 0.3 },
  dust: { night: 0.1, weather: 'dust', intensity: 1, wind: 0.8, water: 0, forest: 0, battle: 0, offscreenBattle: 0, zoom: 0.4 },
  offscreen: { night: 0.3, weather: 'clear', intensity: 0, wind: 0.3, water: 0, forest: 0.2, battle: 0.2, offscreenBattle: 1, zoom: 0.4 },
  'max zoom': { night: 0.1, weather: 'clear', intensity: 0, wind: 0.5, water: 0.5, forest: 0.6, battle: 0, offscreenBattle: 0, zoom: 1 },
};

const params = new URLSearchParams(location.search);
const out = document.getElementById('out') as HTMLPreElement;
const app = document.getElementById('app') as HTMLDivElement;

const db = (g: number) => (g <= 1e-9 ? '  -inf' : gainToDb(g).toFixed(1).padStart(6));

if (params.has('selftest')) void selftest(params.get('selftest') ?? '1');
else if (params.has('bench')) void bench();
else buildUi();

/**
 * Realtime CPU bench (driven by an external script that samples per-thread CPU time): a live
 * AudioSystem with hooks to switch ambience presets / force every layer on.
 */
async function bench(): Promise<void> {
  const audio = new AudioSystem();
  const w = window as unknown as Record<string, unknown>;
  w.audio = audio;
  out.textContent = 'bench: unlocking…';
  await audio.unlock();
  const sc = audio.ambience;
  if (!sc) { out.textContent = 'bench: no soundscape'; return; }
  audio.setAmbience(AMB_PRESETS.day);
  const t0 = performance.now();
  while (!sc.bank.done && performance.now() - t0 < 60000) await new Promise((r) => setTimeout(r, 100));
  audio.stopAmbience();
  w.__setPreset = (name: string) => { sc.debugForce = false; audio.setAmbience(AMB_PRESETS[name]); return sc.levels(); };
  w.__force = (on: boolean) => { sc.debugForce = on; audio.setAmbience(AMB_PRESETS.day); return true; };
  w.__off = () => { sc.debugForce = false; audio.stopAmbience(); return true; };
  w.__stats = () => ({ loops: sc.activeLoops, events: sc.stats.events, tickMs: sc.stats.tickMs, ticks: sc.stats.ticks, worker: sc.bank.timings.filter((t) => t.worker).length });
  w.__benchReady = true;
  out.textContent = `bench ready (bank ${sc.bank.done ? 'done' : 'pending'} after ${(performance.now() - t0).toFixed(0)} ms, worker=${sc.bank.timings.some((t) => t.worker)})`;
  let last = performance.now();
  const loop = (now: number) => { audio.update((now - last) / 1000); last = now; requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// Interactive UI
// ---------------------------------------------------------------------------

function buildUi(): void {
  const audio = new AudioSystem();
  (window as unknown as { audio: AudioSystem }).audio = audio;
  const logEl = document.createElement('div');
  logEl.id = 'log';
  const log = (s: string) => {
    const d = document.createElement('div');
    d.textContent = `${new Date().toLocaleTimeString()}  ${s}`;
    logEl.prepend(d);
  };
  audio.onAnnounce = (text, key) => log(`ANNOUNCER [${key}] "${text}"`);
  const go = (fn: () => void) => () => { void audio.unlock().then(fn); };
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, parent: HTMLElement = app) => {
    const e = document.createElement(tag);
    Object.assign(e, props);
    parent.appendChild(e);
    return e;
  };
  const section = (title: string) => { el('h2', { textContent: title }); return el('div', { className: 'row' }); };

  // --- mixer / music
  const mix = section('Mixer & music');
  const vols = audio.getVolumes();
  for (const k of ['master', 'sfx', 'music', 'voice', 'ambience'] as const) {
    const lab = el('label', { textContent: k }, mix);
    const r = el('input', { type: 'range', min: '0', max: '1', step: '0.01', value: String(vols[k]) }, lab);
    r.oninput = () => audio.setVolumes({ [k]: +r.value });
  }
  const mus = section('Music');
  el('button', { textContent: '▶ Start music (new seed)', className: 'big', onclick: go(() => { audio.startMusic(); log('music started'); }) }, mus);
  el('button', { textContent: '■ Stop music', className: 'big', onclick: go(() => { audio.stopMusic(); log('music stopped'); }) }, mus);
  const il = el('label', { textContent: 'intensity' }, mus);
  const ir = el('input', { type: 'range', min: '0', max: '1', step: '0.01', value: '0' }, il);
  const iv = el('span', { textContent: '0.00' }, il);
  ir.oninput = () => { audio.setMusicIntensity(+ir.value); iv.textContent = (+ir.value).toFixed(2); };
  for (const v of [0, 0.5, 1]) el('button', { textContent: `→ ${v}`, onclick: go(() => { ir.value = String(v); ir.dispatchEvent(new Event('input')); }) }, mus);

  // --- positional
  const posRow = section('SFX position (listener at 0,0, view radius 10 cells)');
  const pl = el('label', { textContent: 'x offset' }, posRow);
  const px = el('input', { type: 'range', min: '-30', max: '30', step: '1', value: '0' }, pl);
  const pv = el('span', { textContent: 'UI (non-positional)' }, pl);
  const usePos = el('input', { type: 'checkbox' }, el('label', { textContent: 'positional' }, posRow));
  const showPos = () => { pv.textContent = usePos.checked ? `${px.value} cells` : 'UI (non-positional)'; };
  px.oninput = showPos;
  usePos.onchange = showPos;
  audio.setListener(0, 0, 10);

  const groups: [string, SfxKey[]][] = [
    ['weapons', ['pistol', 'rifle', 'mg', 'cannon_small', 'cannon_med', 'cannon_heavy', 'rocket', 'grenade', 'flame', 'artillery', 'missile_launch', 'tesla_charge', 'tesla_zap', 'dog_attack', 'dog_bark', 'heal', 'flak', 'nuke_launch']],
    ['explosions', ['expl_piff', 'expl_small', 'expl_medium', 'expl_large', 'expl_huge', 'expl_fire', 'expl_electric', 'expl_nuke', 'expl_building']],
    ['deaths', ['inf_die', 'inf_scream', 'inf_burn', 'inf_electro', 'crush', 'vehicle_die']],
    ['base', ['build_place', 'build_rise', 'sell', 'repair', 'cash_tick', 'harvest', 'ore_dump', 'door', 'deploy', 'power_down', 'radar_on', 'chrono', 'iron_curtain', 'crate']],
    ['ui', ['click', 'hover', 'error', 'tab', 'ready_ping', 'promote']],
  ];
  const sfxRow = section('Sound effects');
  sfxRow.style.flexDirection = 'column';
  sfxRow.style.alignItems = 'flex-start';
  for (const [g, keys] of groups) {
    const r = el('div', { className: 'row' }, sfxRow);
    el('span', { className: 'grp', textContent: g }, r);
    for (const k of keys) {
      el('button', {
        textContent: k,
        onclick: go(() => audio.play(k, usePos.checked ? { x: +px.value, y: 0 } : undefined)),
      }, r);
    }
  }
  const extra = el('div', { className: 'row' }, sfxRow);
  el('span', { className: 'grp', textContent: 'stress' }, extra);
  el('button', { textContent: 'battle burst (60 sounds/1s)', onclick: go(() => battleBurst(audio)) }, extra);
  el('button', { textContent: 'cash counter', onclick: go(() => { for (let i = 0; i < 30; i++) setTimeout(() => audio.play('cash_tick'), i * 45); }) }, extra);
  el('button', { textContent: 'tesla charge→zap', onclick: go(() => { audio.play('tesla_charge'); setTimeout(() => audio.play('tesla_zap'), 670); }) }, extra);

  const ann = section('Announcer');
  for (const k of Object.keys(ANNOUNCER_TEXT) as AnnouncerKey[]) el('button', { textContent: k, onclick: go(() => audio.announce(k)) }, ann);

  buildAmbienceUi(audio, section, el, go, log);

  const resp = section('Unit responses');
  resp.style.flexDirection = 'column';
  resp.style.alignItems = 'flex-start';
  for (const v of ['infantry', 'vehicle', 'tanya', 'engineer', 'medic', 'harvester', 'aircraft', 'naval', 'spy', 'mechanic', 'shock', 'dog'] as VoiceKind[]) {
    const r = el('div', { className: 'row' }, resp);
    el('span', { className: 'grp', textContent: v }, r);
    for (const k of ['select', 'move', 'attack'] as ResponseKind[]) el('button', { textContent: k, onclick: go(() => audio.unitResponse(k, v)) }, r);
  }
  app.appendChild(logEl);

  let last = performance.now();
  const loop = (now: number) => {
    audio.update((now - last) / 1000);
    last = now;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

type El = <K extends keyof HTMLElementTagNameMap>(tag: K, props?: Partial<HTMLElementTagNameMap[K]>, parent?: HTMLElement) => HTMLElementTagNameMap[K];

function buildAmbienceUi(audio: AudioSystem, section: (t: string) => HTMLDivElement, el: El, go: (fn: () => void) => () => void, log: (s: string) => void): void {
  const st: AmbienceState = { ...AMB_PRESETS.day };
  let enabled = false;
  const pre = section('Soundscape presets (setAmbience at 10 Hz)');
  const sliders = new Map<keyof AmbienceState, HTMLInputElement>();
  const vals = new Map<keyof AmbienceState, HTMLSpanElement>();
  let wsel: HTMLSelectElement;
  const sync = () => {
    for (const [k, r] of sliders) { r.value = String(st[k]); vals.get(k)!.textContent = (+r.value).toFixed(2); }
    wsel.value = st.weather;
  };
  for (const [name, p] of Object.entries(AMB_PRESETS)) {
    el('button', { textContent: name, onclick: go(() => { Object.assign(st, p); enabled = true; sync(); log(`ambience preset: ${name}`); }) }, pre);
  }
  el('button', { textContent: '■ off', className: 'big', onclick: go(() => { enabled = false; audio.stopAmbience(); log('ambience off'); }) }, pre);

  const ctl = section('Soundscape state');
  wsel = el('select', {}, el('label', { textContent: 'weather' }, ctl));
  for (const w of ['clear', 'rain', 'storm', 'snow', 'fog', 'dust'] as WeatherKind[]) el('option', { value: w, textContent: w }, wsel);
  wsel.onchange = go(() => { st.weather = wsel.value as WeatherKind; enabled = true; });
  for (const k of ['night', 'intensity', 'wind', 'water', 'forest', 'battle', 'offscreenBattle', 'zoom'] as const) {
    const lab = el('label', { textContent: k }, ctl);
    const r = el('input', { type: 'range', min: '0', max: '1', step: '0.01', value: String(st[k]) }, lab);
    const v = el('span', { textContent: st[k].toFixed(2) }, lab);
    r.style.width = '90px';
    r.oninput = () => { st[k] = +r.value; v.textContent = st[k].toFixed(2); enabled = true; void audio.unlock(); };
    sliders.set(k, r);
    vals.set(k, v);
  }
  const th = section('Thunder (flash → delayed by distance × 0.03 s)');
  for (const [label, d, i] of [['overhead', 0, 1.2], ['near (6)', 6, 1], ['mid (20)', 20, 0.9], ['far (40)', 40, 0.8], ['very far (70)', 70, 0.7]] as [string, number, number][]) {
    el('button', { textContent: label, onclick: go(() => { setTimeout(() => audio.thunder(d, i), d * 30); log(`thunder d=${d} i=${i}`); }) }, th);
  }
  const sg = section('Stingers (aligned to the music beat when music runs)');
  for (const k of STINGERS) el('button', { textContent: k, onclick: go(() => { audio.stinger(k); log(`stinger ${k}`); }) }, sg);
  const meter = el('div', { className: 'hint' });
  meter.style.whiteSpace = 'pre';
  meter.style.font = '11px ui-monospace, monospace';
  meter.style.marginTop = '6px';
  setInterval(() => {
    if (enabled) audio.setAmbience(st);
    const sc = audio.ambience;
    if (!sc) return;
    const lv = sc.levels();
    const loops = Object.entries(lv.loops).filter(([, v]) => v > 1e-4).map(([k, v]) => `${k} ${(20 * Math.log10(v)).toFixed(0)}dB`).join('  ');
    const ev = Object.entries(lv.events).filter(([, v]) => v > 0.01).map(([k, v]) => `${k} ${v.toFixed(1)}/min`).join('  ');
    meter.textContent = `beds: ${loops || '-'}\nevents: ${ev || '-'}\nreverb preset: ${lv.reverb}  active events: ${lv.activeEvents}  playing beds: ${sc.activeLoops}  bank pending: ${sc.bank.pending}`;
  }, 100);
}

function battleBurst(audio: AudioSystem): void {
  const keys: SfxKey[] = ['mg', 'rifle', 'cannon_med', 'cannon_heavy', 'expl_small', 'expl_medium', 'expl_large', 'rocket', 'inf_die', 'tesla_zap', 'expl_piff', 'flak'];
  for (let i = 0; i < 60; i++) {
    setTimeout(() => audio.play(keys[i % keys.length], { x: (Math.random() - 0.5) * 24, y: (Math.random() - 0.5) * 12 }), Math.random() * 1000);
  }
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

/** Crude spectral balance: % of energy below 250 Hz, 250 Hz-2 kHz, above 2 kHz (one-pole splits). */
function bandSplit(d: Float32Array, sr: number): string {
  const a1 = 1 - Math.exp((-2 * Math.PI * 250) / sr);
  const a2 = 1 - Math.exp((-2 * Math.PI * 2000) / sr);
  let l1 = 0, l2 = 0, eL = 0, eM = 0, eH = 0;
  for (let i = 0; i < d.length; i++) {
    const x = d[i];
    l1 += a1 * (x - l1);
    l2 += a2 * (x - l2);
    const lo = l1, mid = l2 - l1, hi = x - l2;
    eL += lo * lo; eM += mid * mid; eH += hi * hi;
  }
  const tot = eL + eM + eH || 1;
  const pc = (e: number) => String(Math.round((100 * e) / tot)).padStart(3);
  return `${pc(eL)}|${pc(eM)}|${pc(eH)}`;
}

async function selftest(mode: string): Promise<void> {
  const lines: string[] = [];
  const log = (s: string) => {
    console.warn(s);
    lines.push(s);
    out.textContent = lines.join('\n');
  };
  const problems: string[] = [];
  log(`AUDIO SELFTEST (mode=${mode})  OfflineAudioContext=${typeof OfflineAudioContext !== 'undefined'}  speechSynthesis=${'speechSynthesis' in window}`);

  // 1. API is a safe no-op before unlock -------------------------------------------------
  {
    const a = new AudioSystem();
    const subs: string[] = [];
    a.onAnnounce = (t) => subs.push(t);
    try {
      a.setListener(10, 10, 12);
      a.play('cannon_heavy', { x: 1, y: 2 });
      a.play('click');
      a.unitResponse('move', 'infantry');
      a.startMusic();
      a.setMusicIntensity(0.7);
      a.update(0.016);
      a.announce('unit_ready');
      a.announce('unit_ready'); // throttled
      a.announce('base_under_attack');
      a.stopMusic();
      a.getVolumes();
      log(`[api] pre-unlock calls OK (no throw); subtitles delivered: ${subs.length} (${subs.join(' | ')})`);
      if (subs.length !== 2) problems.push('pre-unlock subtitle count');
    } catch (e) {
      log(`[api] FAIL pre-unlock threw: ${String(e)}`);
      problems.push('pre-unlock throw');
    }
  }

  // 1b. Ambience, thunder, stingers (first, so the new results land early in short runs) ---
  if (mode === '1' || mode === 'amb') {
    const bank = await ambienceTests(log, problems);
    await ambienceCpu(log, problems, bank, mode === '1');
  }
  if (mode === 'cpu-amb') await ambienceCpu(log, problems, null, false);

  // 2. SFX -------------------------------------------------------------------------------
  if (mode === '1' || mode === 'sfx') {
    const sr = 48000;
    log('');
    log(`SFX @${sr} Hz (final = after DC-block/trim/normalise; raw = straight out of the offline graph)`);
    log('key               var   dur(s)  peak(dB) rms(dB) actRMS(dB) crest  raw-peak(dB)  ms  energy%(<250|250-2k|>2k) tail(dB)  flags');
    const keys = [...ALL_SFX_KEYS, '_chirp', '_radio', '_rankup'] as AnyKey[];
    let totalMs = 0;
    let totalSamples = 0;
    let n = 0;
    for (const key of keys) {
      const vars = RECIPES[key].vars ?? 1;
      for (let v = 0; v < vars; v++) {
        let flags = '';
        try {
          const r = await renderSfx(key, sr, v);
          totalMs += r.renderMs;
          totalSamples += r.buffer.length;
          n++;
          const st = analyze(r.buffer);
          if (r.rawNan || st.nan) flags += ' NAN';
          if (st.peak < 1e-4) flags += ' SILENT';
          if (st.peak > 1) flags += ' CLIP';
          if (r.rawPeak > 1) flags += ' (raw>0dBFS, normalised)';
          if (r.buffer.duration < 0.02) flags += ' TOO-SHORT';
          if (flags.includes('NAN') || flags.includes('SILENT') || flags.includes('CLIP') || flags.includes('TOO-SHORT')) problems.push(`${key}#${v}:${flags.trim()}`);
          const act = activeRms(r.buffer.getChannelData(0), st.peak);
          const bands = bandSplit(r.buffer.getChannelData(0), sr);
          log(`${key.padEnd(17)} ${String(v).padStart(2)}  ${st.duration.toFixed(3).padStart(7)}  ${db(st.peak)}  ${db(st.rms)}  ${db(act)}    ${(gainToDb(st.peak) - gainToDb(act)).toFixed(1).padStart(5)}   ${db(r.rawPeak)}     ${r.renderMs.toFixed(0).padStart(4)}   ${bands}  ${db(r.tailRel)}  ${flags || 'ok'}`);
        } catch (e) {
          log(`${key.padEnd(17)} ${v}  RENDER FAILED: ${String(e)}`);
          problems.push(`${key}#${v}: render failed`);
        }
      }
    }
    log(`SFX total: ${n} buffers, ${(totalSamples / sr).toFixed(1)} s audio, ${(totalSamples * 4 / 1048576).toFixed(1)} MB, sequential render ${totalMs.toFixed(0)} ms`);
    // background bank timing (what unlock() does)
    const t0 = performance.now();
    const bank = new SfxBank(sr);
    bank.start();
    await bank.done;
    log(`SfxBank (concurrency 3) pre-render of everything: ${(performance.now() - t0).toFixed(0)} ms${bank.lastError ? '  ERROR: ' + String(bank.lastError) : ''}`);
    if (bank.lastError) problems.push('bank error');
  }

  // 3. Music -----------------------------------------------------------------------------
  if (mode === '1' || mode === 'music') {
    log('');
    log('MUSIC offline render, 16 bars, seed 1234, 44.1 kHz stereo');
    for (const inten of [0, 0.5, 1]) {
      try {
        const r = await renderMusicOffline(inten, 16, 1234);
        const st = analyze(r.buffer);
        const sr = r.buffer.sampleRate;
        const barLen = Math.floor((60 / r.bpm) * 4 * sr);
        const bars: string[] = [];
        let minBar = Infinity;
        for (let b = 0; b < 16; b++) {
          let s = 0;
          let c = 0;
          for (let ch = 0; ch < 2; ch++) {
            const d = r.buffer.getChannelData(ch);
            const start = Math.floor(0.05 * sr) + b * barLen;
            for (let i = start; i < Math.min(d.length, start + barLen); i++) { s += d[i] * d[i]; c++; }
          }
          const rms = Math.sqrt(s / Math.max(1, c));
          minBar = Math.min(minBar, rms);
          bars.push(gainToDb(rms).toFixed(0));
        }
        const flags = `${st.nan ? ' NAN' : ''}${st.peak > 1 ? ' CLIP' : ''}${st.peak < 1e-3 ? ' SILENT' : ''}${minBar < 1e-4 ? ' SILENT-BAR' : ''}`;
        if (flags) problems.push(`music@${inten}:${flags.trim()}`);
        log(`intensity ${inten.toFixed(1)}: bpm=${r.bpm} ${r.musicSeconds.toFixed(1)}s notes=${r.notes} peak=${db(st.peak)} dB rms=${db(st.rms)} dB render=${r.renderMs.toFixed(0)}ms (≈${(100 * r.renderMs / 1000 / r.musicSeconds).toFixed(1)}% of one core in realtime) ${flags || 'ok'}`);
        log(`   per-bar RMS dB: ${bars.join(' ')}`);
      } catch (e) {
        log(`intensity ${inten}: MUSIC RENDER FAILED ${String(e)}`);
        problems.push(`music@${inten} failed`);
      }
    }
  }

  // 3a. Variety: other seeds, 32 bars (section changes, key changes, breakdowns) -----------
  if (mode === '1' || mode === 'music') {
    log('MUSIC variety check: 32 bars @ intensity 0.9, three more seeds');
    for (const seed of [7, 4242, 987654]) {
      try {
        const r = await renderMusicOffline(0.9, 32, seed);
        const st = analyze(r.buffer);
        const sr = r.buffer.sampleRate;
        const barLen = Math.floor((60 / r.bpm) * 4 * sr);
        let minBar = Infinity, maxBar = 0;
        for (let b = 0; b < 32; b++) {
          let sum = 0, c = 0;
          const d = r.buffer.getChannelData(0);
          const start = Math.floor(0.05 * sr) + b * barLen;
          for (let i = start; i < Math.min(d.length, start + barLen); i++) { sum += d[i] * d[i]; c++; }
          const rms = Math.sqrt(sum / Math.max(1, c));
          minBar = Math.min(minBar, rms);
          maxBar = Math.max(maxBar, rms);
        }
        const flags = `${st.nan ? ' NAN' : ''}${st.peak > 1 ? ' CLIP' : ''}${minBar < 1e-3 ? ' SILENT-BAR' : ''}`;
        if (flags) problems.push(`music seed ${seed}:${flags.trim()}`);
        log(`  seed ${String(seed).padStart(6)}: bpm=${r.bpm} notes=${r.notes} peak=${db(st.peak)} dB rms=${db(st.rms)} dB bar-RMS range ${db(minBar)}..${db(maxBar)} dB ${flags || 'ok'}`);
      } catch (e) {
        log(`  seed ${seed}: FAILED ${String(e)}`);
        problems.push(`music seed ${seed} failed`);
      }
    }
  }

  // 3b. Per-instrument level/cost breakdown (diagnostics) ---------------------------------
  if (mode === 'parts') {
    log('');
    log('MUSIC per-instrument breakdown (16 bars each, solo)');
    const groups: [number, string[]][] = [
      [0, ['__none__', 'pad', 'sub', 'pluck', 'clockTick', 'ping', 'metalHit']],
      [0.5, ['kick', 'clap', 'hat', 'bassNote', 'arp', 'snare', 'riser']],
      [1, ['kick', 'snare', 'hat', 'crash', 'tom', 'metalHit', 'bassNote', 'chug', 'stab', 'lead', 'arp']],
    ];
    for (const [inten, names] of groups) {
      for (const nm of names) {
        const r = await renderMusicOffline(inten, 16, 1234, 44100, [nm]);
        const st = analyze(r.buffer);
        log(`  i=${inten.toFixed(1)} ${nm.padEnd(10)} peak=${db(st.peak)} rms=${db(st.rms)} notes=${String(r.notes).padStart(5)} render=${r.renderMs.toFixed(0)}ms (${(100 * r.renderMs / 1000 / r.musicSeconds).toFixed(1)}% of realtime)`);
      }
    }
  }

  if (mode === 'cpu') {
    log('');
    log('MUSIC cost probes (16 bars @ intensity 0 unless noted; "!send" = effect sends disabled)');
    const probes: [number, string[]][] = [
      [0, ['__none__']], [0, ['pad']], [0, ['pad', '!send']], [0, ['sub']], [0, ['pluck']], [0, ['pluck', '!send']],
      [0, ['pad', 'sub', 'pluck', 'clockTick', 'ping', 'metalHit']], [0, ['pad', 'sub', 'pluck', 'clockTick', 'ping', 'metalHit', '!send']],
      [1, ['__none__']], [1, ['bassNote']], [1, ['chug']], [1, ['kick', 'snare', 'hat', 'crash', 'tom', 'clap']], [1, ['lead']], [1, ['lead', '!send']], [1, ['arp']], [1, ['arp', '!send']],
    ];
    for (const [inten, names] of probes) {
      const r = await renderMusicOffline(inten, 16, 1234, 44100, names);
      log(`  i=${inten} ${names.join('+').padEnd(60)} render=${r.renderMs.toFixed(0).padStart(5)}ms (${(100 * r.renderMs / 1000 / r.musicSeconds).toFixed(1)}%)`);
    }
  }

  // 4. Realtime smoke test (needs autoplay allowed; shot.mjs passes the flag) -----------
  if (mode === '1' || mode === 'rt') {
    log('');
    const a = new AudioSystem();
    const subs: string[] = [];
    a.onAnnounce = (t) => subs.push(t);
    const ok = await Promise.race([a.unlock().then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 3000))]);
    const ctx = a.context;
    log(`[rt] unlock resolved=${ok} state=${ctx?.state} sampleRate=${ctx?.sampleRate} baseLatency=${ctx?.baseLatency}`);
    if (ok && ctx) {
      const t0 = performance.now();
      await a.whenSfxReady();
      log(`[rt] SFX bank ready after ${(performance.now() - t0).toFixed(0)} ms`);
      a.setListener(50, 50, 12);
      a.startMusic(99);
      a.setMusicIntensity(1);
      for (let i = 0; i < 80; i++) a.play(ALL_SFX_KEYS[i % ALL_SFX_KEYS.length], { x: 50 + (i % 9) - 4, y: 50 + (i % 5) - 2 });
      const peakVoices = a.activeVoices;
      for (let i = 0; i < 10; i++) a.play('mg', { x: 50, y: 50 }); // merged / limited
      a.play('expl_huge', { x: 500, y: 500 }); // culled (far away)
      a.announce('mission_start');
      a.announce('unit_ready');
      a.announce('low_power');
      a.announce('insufficient_funds'); // queue full -> dropped (lower priority)
      a.unitResponse('move', 'infantry');
      a.unitResponse('attack', 'dog');
      a.setAmbience({ night: 0.8, weather: 'rain', intensity: 0.8, wind: 0.6, water: 0.4, forest: 0.7, battle: 0.3, offscreenBattle: 0.5, zoom: 0.3 });
      a.setAmbience({ night: Number.NaN, weather: 'bogus' as WeatherKind }); // garbage must be ignored
      a.thunder(8, 1);
      a.thunder(60, 0.7, -0.5);
      a.stinger('mission_start');
      a.stinger('promotion'); // lower priority while mission_start plays → dropped
      a.play('promote', { x: 50, y: 50 });
      let last = performance.now();
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 50));
        const now = performance.now();
        a.update((now - last) / 1000);
        last = now;
      }
      log(`[rt] voices after burst=${peakVoices} (cap 40), now=${a.activeVoices}; music notes scheduled in 2 s=${a.musicNotes}; subtitles=${subs.length} (${subs.join(' | ')})`);
      if (a.musicNotes === 0) problems.push('realtime music scheduled nothing');
      const sc = a.ambience;
      if (sc) {
        // the bank renders in idle slices: give it a moment, then the beds must be playing
        const tb = performance.now();
        for (let i = 0; i < 60 && sc.activeLoops === 0; i++) await new Promise((r) => setTimeout(r, 100));
        const firstBed = performance.now() - tb;
        for (let i = 0; i < 150 && !sc.bank.done; i++) await new Promise((r) => setTimeout(r, 100));
        const wt = sc.bank.timings.filter((t) => t.worker).length;
        log(`[rt] ambience bank: worker=${sc.bank.usingWorker} (${wt}/${sc.bank.timings.length} items rendered in the worker), first bed playing after ${firstBed.toFixed(0)} ms, bank done=${sc.bank.done} after ${(performance.now() - tb).toFixed(0)} ms, ${(sc.bank.bytes / 1048576).toFixed(1)} MB`);
        if (!sc.bank.usingWorker) problems.push('ambience worker not used');
        const lv = sc.levels();
        const beds = Object.entries(lv.loops).filter(([, v]) => v > 1e-4).map(([k]) => k);
        log(`[rt] soundscape: active=${sc.active} playing beds=${sc.activeLoops} (${beds.join(', ')}), events fired=${sc.stats.events}, thunders=${sc.stats.thunders}, reverb=${lv.reverb}, bank pending=${sc.bank.pending}, avg tick ${(sc.stats.tickMs / Math.max(1, sc.stats.ticks)).toFixed(3)} ms`);
        if (!sc.active || sc.activeLoops === 0) problems.push('realtime soundscape not playing');
        if (sc.stats.thunders !== 2) problems.push('realtime thunder count');
      } else problems.push('no soundscape in realtime');
      if (peakVoices > 40) problems.push('voice cap exceeded');
      a.setVolumes({ music: 0.5, ambience: 0.65 });
      a.stopAmbience();
      const stored = localStorage.getItem('rh.audio.volumes');
      log(`[rt] volumes persisted: ${stored}`);
      if (!stored || !stored.includes('"ambience":0.65')) problems.push('ambience volume not persisted');
      a.stopMusic();
    } else {
      log('[rt] context did not start (expected without autoplay permission) — realtime test skipped');
    }
  }

  log('');
  log(problems.length ? `SELFTEST DONE — PROBLEMS: ${problems.join('; ')}` : 'SELFTEST DONE — all OK');
}

// ---------------------------------------------------------------------------
// Ambience self-tests
// ---------------------------------------------------------------------------

interface ClickStats { maxJump: number; clicks: number; worst: number; at: number }

/**
 * Discontinuity scan: per 128-sample block, the largest sample-to-sample jump vs the RMS of the jumps
 * in the ±12 surrounding blocks. A click is a jump > 0.004 that is > 14× its neighbourhood.
 */
function clickScan(buf: AudioBuffer, skipSec = 0): ClickStats {
  const B = 128;
  const sr = buf.sampleRate;
  let maxJump = 0, clicks = 0, worst = 0, at = -1;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    const nb = Math.floor(d.length / B);
    const rmsD = new Float32Array(nb);
    const maxD = new Float32Array(nb);
    for (let b = 0; b < nb; b++) {
      let sum = 0, m = 0;
      for (let i = Math.max(1, b * B); i < (b + 1) * B; i++) {
        const x = d[i] - d[i - 1];
        sum += x * x;
        if (Math.abs(x) > m) m = Math.abs(x);
      }
      rmsD[b] = Math.sqrt(sum / B);
      maxD[b] = m;
    }
    const skip = Math.ceil((skipSec * sr) / B);
    for (let b = skip; b < nb; b++) {
      let sum = 0, c = 0;
      for (let k = Math.max(0, b - 12); k <= Math.min(nb - 1, b + 12); k++) if (k !== b) { sum += rmsD[k]; c++; }
      const ref = sum / Math.max(1, c);
      const ratio = maxD[b] / Math.max(ref, 1e-5);
      if (maxD[b] > maxJump) maxJump = maxD[b];
      if (maxD[b] > 0.004 && ratio > 14) {
        clicks++;
        if (ratio > worst) { worst = ratio; at = (b * B) / sr; }
      }
    }
  }
  return { maxJump, clicks, worst, at };
}

function perSecondRms(buf: AudioBuffer): string {
  const sr = buf.sampleRate;
  const out: string[] = [];
  for (let s0 = 0; s0 + sr <= buf.length; s0 += sr) {
    let sum = 0;
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = s0; i < s0 + sr; i++) sum += d[i] * d[i];
    }
    out.push(gainToDb(Math.sqrt(sum / (sr * buf.numberOfChannels))).toFixed(0));
  }
  return out.join(' ');
}

function fmtDb(g: number): string { return g <= 1e-9 ? '  -inf' : gainToDb(g).toFixed(1).padStart(6); }

async function ambienceTests(log: (s: string) => void, problems: string[]): Promise<AmbBank> {
  log('');
  log('AMBIENCE bank generation (pure JS, main thread, one item per idle slice in the game)');
  const bank = new AmbBank(1);
  const t0 = performance.now();
  bank.renderAll();
  const total = performance.now() - t0;
  const perKey = new Map<string, number>();
  let worst = { key: '', ms: 0 };
  for (const t of bank.timings) {
    const k = t.key.split('#')[0];
    perKey.set(k, (perKey.get(k) ?? 0) + t.ms);
    if (t.ms > worst.ms) worst = t;
  }
  log(`  ${bank.timings.length} items, ${total.toFixed(0)} ms total, slowest single item ${worst.key} ${worst.ms.toFixed(1)} ms, PCM ${(bank.bytes / 1048576).toFixed(1)} MB`);
  log('  ' + [...perKey.entries()].map(([k, v]) => `${k} ${v.toFixed(0)}`).join(', '));
  for (const k of Object.keys(GENERATORS) as BankKey[]) {
    const bufs = bank.get(k);
    if (!bufs || bufs.length !== GENERATORS[k].vars) { problems.push(`bank ${k}: ${bufs?.length ?? 0}/${GENERATORS[k].vars} variations`); continue; }
    for (const b of bufs) {
      const st = analyze(b);
      if (st.nan) problems.push(`bank ${k}: NaN`);
      if (st.peak < 1e-4) problems.push(`bank ${k}: silent`);
      if (st.peak > 1) problems.push(`bank ${k}: clip`);
    }
  }

  // loop seams: jump across the wrap point vs the typical sample-to-sample jump
  log('');
  log('AMBIENCE loop seams (|x[0]-x[n-1]| relative to the median |Δx| of the bed)');
  const seamLines: string[] = [];
  for (const spec of LOOP_SPECS) {
    const b = bank.get(spec.key)![0];
    const d = b.getChannelData(0);
    const diffs: number[] = [];
    for (let i = 1; i < d.length; i += 7) diffs.push(Math.abs(d[i] - d[i - 1]));
    diffs.sort((x, y) => x - y);
    const med = diffs[diffs.length >> 1] || 1e-9;
    const seam = Math.abs(d[0] - d[d.length - 1]);
    const ratio = seam / med;
    seamLines.push(`${spec.key} ${b.duration.toFixed(1)}s@${b.sampleRate} rms ${fmtDb(analyze(b).rms).trim()}dB seam ${ratio.toFixed(1)}×`);
    if (ratio > 8) problems.push(`loop seam ${spec.key}: ${ratio.toFixed(1)}× median step`);
  }
  for (let i = 0; i < seamLines.length; i += 3) log('  ' + seamLines.slice(i, i + 3).join(' | '));

  // beds: 6 s each, full soundscape (beds + events + env reverb) at default volumes, loops crossing their seam
  log('');
  log('AMBIENCE beds, 6 s @48 kHz stereo each, default volumes (ambience 0.7, master 0.85), loops start 1.2/2.9 s before their seam');
  log('bed           rms(dB) peak(dB) maxΔ   clicks(beds only)  transients(full)  events beds  energy%(<250|250-2k|>2k)  per-second RMS dB                 flags');
  const beds = ['day', 'day forest', 'dusk', 'night', 'night lake', 'water', 'rain', 'storm', 'snow', 'fog', 'dust', 'offscreen', 'max zoom'];
  const bedRms = new Map<string, number>();
  for (const name of beds) {
    try {
      const st = AMB_PRESETS[name];
      const full = await renderSoundscapeOffline(st, 6, { bank, seamTest: true, seed: 11 });
      const strict = await renderSoundscapeOffline(st, 6, { bank, seamTest: true, seed: 11, noEvents: true });
      const a = analyze(full.buffer);
      const cs = clickScan(strict.buffer, 0.05);
      const cf = clickScan(full.buffer, 0.05);
      bedRms.set(name, a.rms);
      let flags = '';
      if (a.nan || analyze(strict.buffer).nan) flags += ' NAN';
      if (a.peak > 1) flags += ' CLIP';
      if (a.rms < 1e-4) flags += ' SILENT';
      if (cs.clicks > 0) flags += ` CLICK@${cs.at.toFixed(2)}s(${cs.worst.toFixed(0)}×)`;
      if (flags) problems.push(`bed ${name}:${flags}`);
      log(`${name.padEnd(12)} ${fmtDb(a.rms)}  ${fmtDb(a.peak)}  ${cs.maxJump.toFixed(3)}   ${String(cs.clicks).padStart(3)}               ${String(cf.clicks).padStart(3)}            ${String(full.events).padStart(4)}  ${String(full.loops).padStart(3)}   ${bandSplit(full.buffer.getChannelData(0), full.buffer.sampleRate)}               ${perSecondRms(full.buffer).padEnd(32)} ${flags || 'ok'}`);
    } catch (e) {
      log(`${name}: RENDER FAILED ${String(e)}`);
      problems.push(`bed ${name} failed`);
    }
  }
  const ordered = [...bedRms.entries()].sort((x, y) => x[1] - y[1]).map(([k, v]) => `${k} ${gainToDb(v).toFixed(0)}`);
  log(`  loudness order (quiet → loud): ${ordered.join(' < ')}`);

  // transitions: weather / time-of-day / camera changes mid-render, beds only (strict click test)
  log('');
  log('AMBIENCE transitions, 16 s, beds only: clear day → rain ramp → storm (abrupt switch) → snow → fog night → zoom out → battle');
  try {
    const script = (t: number, sc: { setState(s: Partial<AmbienceState>): void }) => {
      if (t < 2) sc.setState({ weather: 'clear', intensity: 0 });
      else if (t < 5) sc.setState({ weather: 'rain', intensity: Math.min(1, (t - 2) / 2) });
      else if (t < 8) sc.setState({ weather: 'storm', intensity: 1, wind: 0.9 });
      else if (t < 10.5) sc.setState({ weather: 'snow', intensity: 1, wind: 0.4 });
      else if (t < 13) sc.setState({ weather: 'fog', intensity: 1, night: 1, water: 0.8 });
      else if (t < 14.5) sc.setState({ zoom: 1 });
      else sc.setState({ zoom: 0.2, battle: 1, offscreenBattle: 1 });
    };
    const r = await renderSoundscapeOffline({ ...AMB_PRESETS.day }, 16, { bank, seed: 5, noEvents: true, script });
    const a = analyze(r.buffer);
    const cs = clickScan(r.buffer, 0.05);
    const flags = `${a.nan ? ' NAN' : ''}${a.peak > 1 ? ' CLIP' : ''}${cs.clicks ? ` CLICK@${cs.at.toFixed(2)}s(${cs.worst.toFixed(0)}×)` : ''}`;
    if (flags) problems.push(`transitions:${flags}`);
    log(`  rms ${fmtDb(a.rms)} dB peak ${fmtDb(a.peak)} dB maxΔ ${cs.maxJump.toFixed(3)} clicks ${cs.clicks}  per-second: ${perSecondRms(r.buffer)}  ${flags || 'ok'}`);
    const rf = await renderSoundscapeOffline({ ...AMB_PRESETS.day }, 16, { bank, seed: 5, script });
    const af = analyze(rf.buffer);
    log(`  with events: rms ${fmtDb(af.rms)} dB peak ${fmtDb(af.peak)} dB events ${rf.events} ${af.nan ? 'NAN' : ''}`);
    if (af.nan || af.peak > 1) problems.push('transitions with events: NaN/clip');
  } catch (e) {
    log(`  FAILED ${String(e)}`);
    problems.push('transition render failed');
  }

  // thunder
  log('');
  log('THUNDER (inside a storm bed, 9 s): distance → peak / rms of the whole render');
  for (const [d, i] of [[0, 1.2], [8, 1], [25, 1], [48, 0.8], [80, 0.8]] as [number, number][]) {
    try {
      const r = await renderSoundscapeOffline({ ...AMB_PRESETS.storm }, 9, { bank, seed: 3, script: (t, sc) => { if (Math.abs(t - 0.5) < 0.01) (sc as unknown as { thunder(d: number, i: number, p?: number): void }).thunder(d, i, 0.2); } });
      const a = analyze(r.buffer);
      const base = bedRms.get('storm') ?? 1e-9;
      const flags = `${a.nan ? ' NAN' : ''}${a.peak > 1 ? ' CLIP' : ''}`;
      if (flags) problems.push(`thunder d=${d}:${flags}`);
      log(`  d=${String(d).padStart(2)} cells i=${i}: peak ${fmtDb(a.peak)} dB, rms ${fmtDb(a.rms)} dB (storm bed alone ${fmtDb(base)} dB) ${flags || 'ok'}`);
    } catch (e) {
      log(`  d=${d}: FAILED ${String(e)}`);
      problems.push(`thunder ${d} failed`);
    }
  }

  // env reverb calibration: a cannon through the reverb only vs dry
  log('');
  log('ENV REVERB wet/dry energy for a medium cannon at send 1.0 (a mid-distance voice uses ≈0.5 → −6 dB)');
  try {
    const probe = (await renderSfx('cannon_med', 48000, 0)).buffer;
    const dry = await renderSoundscapeOffline(null, 5.5, { bank, probe, probeDry: true, reverb: false, volume: 1 });
    const de = analyze(dry.buffer).rms;
    const parts: string[] = [];
    for (const [name, st] of [['day', AMB_PRESETS.day], ['night', AMB_PRESETS.night], ['snow', AMB_PRESETS.snow], ['fog', AMB_PRESETS.fog], ['storm', AMB_PRESETS.storm]] as [string, AmbienceState][]) {
      const wet = await renderSoundscapeOffline({ ...st, wind: 0, water: 0, forest: 0, offscreenBattle: 0, zoom: 0 }, 5.5, { bank, probe, volume: 1, noEvents: true, reverb: true });
      // subtract the beds: render the same state without the probe
      const beds = await renderSoundscapeOffline({ ...st, wind: 0, water: 0, forest: 0, offscreenBattle: 0, zoom: 0 }, 5.5, { bank, volume: 1, noEvents: true, reverb: true });
      const w = wet.buffer, b = beds.buffer;
      let sum = 0, n = 0;
      for (let ch = 0; ch < 2; ch++) {
        const x = w.getChannelData(ch), y = b.getChannelData(ch);
        for (let i = 0; i < x.length; i++) { const v = x[i] - y[i]; sum += v * v; n++; }
      }
      const we = Math.sqrt(sum / n);
      parts.push(`${name} ${(gainToDb(we) - gainToDb(de)).toFixed(1)} dB`);
    }
    log('  ' + parts.join(' | '));
  } catch (e) {
    log(`  FAILED ${String(e)}`);
    problems.push('reverb calibration failed');
  }

  // stingers
  log('');
  log('STINGERS offline (key A, 142 bpm, default music volume): length, peak, rms, transients');
  let musicRms = 0;
  try {
    const m = await renderMusicOffline(0.5, 8, 1234);
    musicRms = analyze(m.buffer).rms * 0.36 * 0.7225;
  } catch { /* ignore */ }
  for (const k of STINGERS) {
    try {
      const r = await renderStingerOffline(k);
      const a = analyze(r.buffer);
      const act = activeRms(r.buffer.getChannelData(0), a.peak);
      const cs = clickScan(r.buffer, 0);
      const flags = `${a.nan ? ' NAN' : ''}${a.peak > 1 ? ' CLIP' : ''}${a.peak < 1e-3 ? ' SILENT' : ''}`;
      if (flags) problems.push(`stinger ${k}:${flags}`);
      log(`  ${k.padEnd(18)} ${r.length.toFixed(2)} s  peak ${fmtDb(a.peak)} dB  active rms ${fmtDb(act)} dB  transients ${cs.clicks}  render ${r.renderMs.toFixed(0)} ms ${flags || 'ok'}`);
    } catch (e) {
      log(`  ${k}: FAILED ${String(e)}`);
      problems.push(`stinger ${k} failed`);
    }
  }
  if (musicRms) log(`  (music at intensity 0.5, same volume: rms ${fmtDb(musicRms)} dB; stingers duck it while they play)`);
  return bank;
}

async function ambienceCpu(log: (s: string) => void, problems: string[], shared: AmbBank | null, quick: boolean): Promise<void> {
  log('');
  log(`AMBIENCE CPU: offline render time / audio time (48 kHz stereo, 0.25 s scheduler chunks), ${quick ? 'single 10 s run each (?selftest=cpu-amb: best of 3 × 20 s)' : 'best of 3 runs × 20 s'} ≈ audio-thread cost`);
  // machine-speed reference (a modern desktop core does this in ≈ 2–4 ns/op)
  {
    let x = 0x1234567, acc = 0;
    const N = 3_000_000;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) { x = (x + 0x6d2b79f5) | 0; let t = Math.imul(x ^ (x >>> 15), x | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); acc += (t ^ (t >>> 14)) >>> 0; }
    log(`  host speed reference: mulberry32 ${(((performance.now() - t0) * 1e6) / N).toFixed(1)} ns/op (${acc > 0 ? 'ok' : ''}), hardwareConcurrency ${navigator.hardwareConcurrency}`);
  }
  const bank = shared ?? new AmbBank(1);
  bank.renderAll();
  const secs = quick ? 10 : 20;
  const best3 = async (fn: () => Promise<number>) => { let m = Infinity; for (let i = 0; i < (quick ? 1 : 3); i++) m = Math.min(m, await fn()); return m; };
  // reverb alone, continuously fed with noise
  for (const [label, band] of [['env reverb alone (day preset, 1.2 s IR)', 0], ['env reverb alone (night preset, 2.0 s IR)', 2]] as [string, number][]) {
    const pct = await best3(async () => {
      const sr = 48000;
      const oc = new OfflineAudioContext(2, secs * sr, sr);
      const rv = new EnvReverb(oc, oc.destination, false);
      rv.setPreset(`b${band}`, envSpec(band, 'clear'), 0);
      rv.setParams(0.3, 8000, 0);
      const src = oc.createBufferSource();
      src.buffer = bank.get('rain')![0];
      src.loop = true;
      src.connect(rv.input);
      src.start();
      const t0 = performance.now();
      await oc.startRendering();
      return (100 * (performance.now() - t0)) / 1000 / secs;
    });
    log(`  ${label.padEnd(52)} ${pct.toFixed(2)}% of one core`);
  }
  const runs: [string, Partial<AmbienceState>, { forceAll?: boolean; reverb?: boolean; noEvents?: boolean }][] = [
    ['ALL 11 beds forced on, no events, no reverb', AMB_PRESETS.day, { forceAll: true, reverb: false, noEvents: true }],
    ['ALL 11 beds + all 12 event layers forced, no reverb', AMB_PRESETS.day, { forceAll: true, reverb: false }],
    ['ALL beds + all events forced on + env reverb', AMB_PRESETS.day, { forceAll: true }],
    ['typical: day forest', AMB_PRESETS['day forest'], {}],
    ['typical: night lake', AMB_PRESETS['night lake'], {}],
    ['typical: storm', AMB_PRESETS.storm, {}],
    ['typical: offscreen battle', AMB_PRESETS.offscreen, {}],
  ];
  for (const [label, st, o] of runs) {
    try {
      let info = '';
      const pct = await best3(async () => {
        const r = await renderSoundscapeOffline(st, secs, { bank, chunk: 0.25, seed: 9, ...o });
        info = `beds ${r.loops}, events ${r.events}, JS scheduler ${(r.tickMs / (secs / 0.25)).toFixed(3)} ms/tick`;
        return (100 * r.renderMs) / 1000 / secs;
      });
      log(`  ${label.padEnd(52)} ${pct.toFixed(2)}% of one core  (${info})`);
      if (o.forceAll && o.reverb !== false && pct > 6) problems.push(`ambience CPU ${pct.toFixed(1)}%`);
    } catch (e) {
      log(`  ${label}: FAILED ${String(e)}`);
      problems.push('ambience cpu run failed');
    }
  }
}
