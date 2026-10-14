/**
 * Audio preview page (preview-audio.html) + headless self-test (?selftest=1).
 * The self-test renders every SFX offline, prints duration / peak / RMS per sound, renders
 * 16 bars of music at three intensities, and smoke-tests the realtime API. Results go to the
 * page and to console.warn (so tools/shot.mjs prints them).
 */
import { AudioSystem } from './index';
import { analyze, activeRms, gainToDb } from './dsp';
import { renderMusicOffline } from './music';
import { ALL_SFX_KEYS, RECIPES, SfxBank, renderSfx, type AnyKey } from './sfx';
import { ANNOUNCER_TEXT } from './speech';
import type { AnnouncerKey, ResponseKind, SfxKey, VoiceKind } from './types';

const params = new URLSearchParams(location.search);
const out = document.getElementById('out') as HTMLPreElement;
const app = document.getElementById('app') as HTMLDivElement;

const db = (g: number) => (g <= 1e-9 ? '  -inf' : gainToDb(g).toFixed(1).padStart(6));

if (params.has('selftest')) void selftest(params.get('selftest') ?? '1');
else buildUi();

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
  for (const k of ['master', 'sfx', 'music', 'voice'] as const) {
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
    ['ui', ['click', 'hover', 'error', 'tab', 'ready_ping']],
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

  const resp = section('Unit responses');
  resp.style.flexDirection = 'column';
  resp.style.alignItems = 'flex-start';
  for (const v of ['infantry', 'vehicle', 'tanya', 'engineer', 'medic', 'harvester', 'aircraft', 'dog'] as VoiceKind[]) {
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

  // 2. SFX -------------------------------------------------------------------------------
  if (mode === '1' || mode === 'sfx') {
    const sr = 48000;
    log('');
    log(`SFX @${sr} Hz (final = after DC-block/trim/normalise; raw = straight out of the offline graph)`);
    log('key               var   dur(s)  peak(dB) rms(dB) actRMS(dB) crest  raw-peak(dB)  ms  energy%(<250|250-2k|>2k) tail(dB)  flags');
    const keys = [...ALL_SFX_KEYS, '_chirp', '_radio'] as AnyKey[];
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
      let last = performance.now();
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 50));
        const now = performance.now();
        a.update((now - last) / 1000);
        last = now;
      }
      log(`[rt] voices after burst=${peakVoices} (cap 40), now=${a.activeVoices}; music notes scheduled in 2 s=${a.musicNotes}; subtitles=${subs.length} (${subs.join(' | ')})`);
      if (a.musicNotes === 0) problems.push('realtime music scheduled nothing');
      if (peakVoices > 40) problems.push('voice cap exceeded');
      a.setVolumes({ music: 0.5 });
      const stored = localStorage.getItem('rh.audio.volumes');
      log(`[rt] volumes persisted: ${stored}`);
      a.stopMusic();
    } else {
      log('[rt] context did not start (expected without autoplay permission) — realtime test skipped');
    }
  }

  log('');
  log(problems.length ? `SELFTEST DONE — PROBLEMS: ${problems.join('; ')}` : 'SELFTEST DONE — all OK');
}
