/**
 * Highlight clips: "Record clip" on a results-screen highlight or in the replay viewer plays the replay
 * through a cinematic camera (src/share/director.ts) and records ~18 s of it (canvas + the game's audio,
 * src/share/recorder.ts), then offers the video: download (WebM, or MP4 where the browser records that) and
 * the system share sheet on mobile. Real time, at the current graphics quality; nothing leaves the device.
 *
 *  - From the results screen: requestClip() remembers the moment, the replay opens seeked a few seconds
 *    before it, and the playback (src/replay/playback.ts) starts the recording once the seek is done.
 *  - From the replay viewer: records from the current moment.
 */
import type { Game } from '../game';
import type { ReplayData } from '../replay/format';
import { DT, TICK_HZ } from '../sim/types';
import { formatTime } from '../core/util';
import { ICONS } from './icons';
import { el, esc } from './dom';
import { actionFocus, Director, ease, lerp, type Shot } from '../share/director';
import { CanvasRecorder, canRecordVideo, canShareFile, downloadBlob, paintOverlay, videoFileName } from '../share/recorder';
import { openModal, SHARE_ICONS } from '../share/dialog';

/** What the clip recorder needs from the replay player (structural: ReplayPlayback satisfies it). */
export interface ClipPlayback {
  readonly data: ReplayData;
  readonly startTick: number;
  readonly isSeeking: boolean;
  view: number;
  setPaused(p: boolean): void;
  setSpeed(s: number): void;
  setView(view: number): void;
  seek(tick: number): void;
}

export const CLIP_SECONDS = 18;
/** Seconds of lead-in before a highlight's moment. */
export const CLIP_LEAD = 5;

interface PendingClip { replayId: string; atTick: number; label: string }
let pending: PendingClip | null = null;

export function canRecordClips(): boolean {
  return canRecordVideo();
}

/** Remember a highlight to record when its replay opens (results screen → replay viewer). */
export function requestClip(replayId: string, atTick: number, label: string): void {
  pending = { replayId, atTick, label };
}

/** The tick a highlight's replay should open at (a few seconds before the moment). */
export function clipStartTick(atTick: number): number {
  return Math.max(0, Math.round(atTick - CLIP_LEAD * TICK_HZ));
}

/** Called by the replay player when it opens: start a pending clip for this replay. */
export function startPendingClip(game: Game, pb: ClipPlayback): void {
  const p = pending;
  if (!p || p.replayId !== pb.data.id) return;
  pending = null;
  const t0 = performance.now();
  // wait for the opening seek (fast simulation up to the lead-in), then roll
  const wait = () => {
    if (!game.world || performance.now() - t0 > 120_000) return;
    if (pb.isSeeking || game.world.tick < clipStartTick(p.atTick) - 2) { setTimeout(wait, 120); return; }
    void recordClip(game, pb, { label: p.label, atTick: p.atTick });
  };
  setTimeout(wait, 200);
}

const CSS = `
body.clip-rec #ui, body.clip-rec .overlay-canvas, body.clip-rec #replay-bar, body.clip-rec .rp-players, body.clip-rec #tooltip, body.clip-rec .rp-end,
body.clip-rec #toasts, body.clip-rec .notif-log { opacity: 0 !important; pointer-events: none !important; }
.clip-block { position: fixed; inset: 0; z-index: 90; cursor: progress; }
.clip-hud { position: fixed; top: 2.2vh; left: 50%; transform: translateX(-50%); z-index: 91; display: flex; align-items: center; gap: .8rem; padding: .55rem .8rem .55rem 1rem;
  border-radius: .7rem; background: rgba(6, 9, 14, .78); border: 1px solid rgba(255,255,255,.12); backdrop-filter: blur(8px); font-family: var(--font, sans-serif); color: #eef4fa; }
.clip-hud .dot { width: .7rem; height: .7rem; border-radius: 50%; background: #ff3b30; box-shadow: 0 0 .7rem #ff3b30; animation: clipBlink 1s steps(2) infinite; }
@keyframes clipBlink { 50% { opacity: .25; } }
.clip-hud b { letter-spacing: .25em; font-size: .78rem; }
.clip-hud .bar { width: 12rem; height: .35rem; border-radius: 1rem; background: rgba(255,255,255,.12); overflow: hidden; }
.clip-hud .bar i { display: block; height: 100%; width: 0; background: linear-gradient(90deg, #ff6a46, #ffb08a); }
.clip-hud .t { font-family: var(--mono, monospace); font-size: .8rem; min-width: 5.6rem; text-align: right; color: var(--text-2, #c8d2dc); }
.clip-hud button { border: 1px solid rgba(255,255,255,.18); background: rgba(255,255,255,.06); color: #fff; border-radius: .45rem; padding: .3rem .6rem; cursor: pointer; font: inherit; font-size: .75rem; letter-spacing: .1em; }
.clip-hud button:hover { border-color: rgba(255,90,60,.8); background: rgba(255,90,60,.25); }
.clip-video { width: 100%; max-height: 52vh; border-radius: .6rem; background: #000; border: 1px solid var(--line, rgba(255,255,255,.1)); display: block; }
.sh-panel.clip-panel { width: min(46rem, 94vw); }
`;

function ensureCss() {
  if (document.getElementById('clip-css')) return;
  const st = document.createElement('style');
  st.id = 'clip-css';
  st.textContent = CSS;
  document.head.appendChild(st);
}

/** The clip's camera: establish over the fight, orbit it through the peak (a beat of slow motion), pull back. */
export function clipProgram(label: string, sub: string, seconds: number, near: () => { x: number; y: number } | null): Shot[] {
  const focus = (d: Director) => d.memo('focus', 0.5, () => near() ?? actionFocus(d.world)) ?? { x: d.world.map.w / 2, y: d.world.map.h / 2 };
  const a = seconds * 0.3, b = seconds * 0.45, c = seconds - a - b;
  return [
    {
      name: 'clip-open', dur: a, card: { kicker: 'Red Horizon · highlight', title: label, sub, at: 'lower' },
      begin: (d) => { const f = focus(d); d.follow.jump(f.x, f.y); d.state.yaw = (Math.random() - 0.5) * 0.9; return true; },
      pose: (d, t) => { const f = focus(d); d.follow.to(f.x, f.y, d.dt * 0.8); return { x: d.follow.x, y: d.follow.y, dist: lerp(36, 24, ease(t)), yaw: (d.state.yaw as number) + 0.15 * t, blur: 0.15 }; },
    },
    {
      name: 'clip-action', dur: b, continuous: true,
      pose: (d, t) => { const f = focus(d); d.follow.to(f.x, f.y, d.dt); return { x: d.follow.x, y: d.follow.y, dist: lerp(24, 15, ease(t)), yaw: (d.state.yaw as number) + 0.15 + 0.5 * t, dof: 0.35, blur: 0.3 }; },
      // a beat of slow motion at the heart of the clip
      speed: (_d, t) => (t > 0.35 && t < 0.65 ? 0.45 : 1),
    },
    {
      name: 'clip-close', dur: c, continuous: true, card: { title: 'Red Horizon', sub: 'Free in your browser', at: 'center' },
      pose: (d, t) => { const f = focus(d); d.follow.to(f.x, f.y, d.dt * 0.6); return { x: d.follow.x, y: d.follow.y, dist: lerp(15, 34, ease(t)), yaw: (d.state.yaw as number) + 0.65 + 0.2 * t, dof: 0.2, blur: 0.2 }; },
    },
  ];
}

let active = false;

/**
 * Record a clip of the replay from where it is now. `atTick` (optional) is the highlight's moment, for the
 * caption; `label` the highlight text.
 */
export async function recordClip(game: Game, pb: ClipPlayback, o: { label: string; atTick?: number; seconds?: number }): Promise<void> {
  if (active) return;
  if (!canRecordClips()) { showClipError('This browser cannot record video (MediaRecorder is missing).'); return; }
  active = true;
  ensureCss();
  const seconds = Math.max(6, Math.min(30, o.seconds ?? CLIP_SECONDS));
  const at = o.atTick ?? game.world.tick;
  const sub = `${pb.data.mapName} · ${formatTime(at * DT)}`;
  // observer view (no fog: the camera roams), normal speed, playing
  const view = pb.view;
  pb.setView(-1);
  pb.setSpeed(1);
  pb.setPaused(false);
  const input = game.input as unknown as { edgeScroll?: boolean } | null;
  const edge = input?.edgeScroll;
  if (input) input.edgeScroll = false;
  document.body.classList.add('clip-rec');
  // keep the fight the player was looking at in frame: start near the camera, then follow the action
  const cam = game.gfx.cam;
  const home = { x: cam.x, y: cam.y };
  const near = () => actionFocus(game.world, { x: home.x, y: home.y, r: 22 });
  try { await Promise.race([game.audio.unlock(), new Promise((r) => setTimeout(r, 1500))]); } catch { /* silent clip */ }
  try { await document.fonts?.load('700 32px Rajdhani'); } catch { /* fallback font */ }
  const dir = new Director(game, clipProgram(o.label, sub, seconds, near), { loop: false, lens: true, letterbox: 1, dip: 0.4 });
  const prev = game.cameraDirector;
  game.cameraDirector = dir;
  let rec: CanvasRecorder;
  try {
    rec = new CanvasRecorder({
      source: game.gfx.renderer.domElement, audio: game.audio.captureStream(), fps: 30,
      maxWidth: game.setup.quality === 'low' ? 1280 : 1920, maxHeight: game.setup.quality === 'low' ? 720 : 1080,
      overlay: (ctx, w, h) => paintOverlay(ctx, w, h, dir),
    });
  } catch (e) {
    cleanup();
    showClipError(e instanceof Error ? e.message : 'Recording failed.');
    return;
  }
  // progress overlay (blocks input; Esc or Cancel stops)
  const block = el('div', 'clip-block');
  const hud = el('div', 'clip-hud', `<span class="dot"></span><b>REC</b><span class="bar"><i></i></span><span class="t">0:00 / ${formatTime(seconds)}</span><button data-a="stop">Cancel</button>`);
  document.body.append(block, hud);
  let cancelled = false;
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelled = true; } else e.stopPropagation(); };
  window.addEventListener('keydown', onKey, true);
  (hud.querySelector('[data-a="stop"]') as HTMLElement).onclick = () => { cancelled = true; };
  const bar = hud.querySelector('.bar i') as HTMLElement;
  const tEl = hud.querySelector('.t') as HTMLElement;
  rec.start();
  await new Promise<void>((resolve) => {
    const iv = window.setInterval(() => {
      const e = rec.elapsed, p = dir.elapsed;
      bar.style.width = `${Math.min(100, (p / seconds) * 100).toFixed(1)}%`;
      tEl.textContent = `${formatTime(Math.min(p, seconds))} / ${formatTime(seconds)}`;
      // the program ends on its own (in game time); a very slow machine stops at a hard cap
      if (cancelled || dir.ended || e >= seconds * 2.5 + 1 || !document.body.contains(game.gfx.renderer.domElement)) { window.clearInterval(iv); resolve(); }
    }, 100);
  });
  let blob: Blob | null = null;
  if (cancelled) rec.cancel();
  else blob = await rec.stop().catch(() => null);
  window.removeEventListener('keydown', onKey, true);
  block.remove();
  hud.remove();
  cleanup();
  pb.setPaused(true);
  if (blob && blob.size > 0) showClipResult(blob, rec.format.ext, o.label, rec.width, rec.height, () => void recordClip(game, pb, o));
  else if (!cancelled) showClipError('The browser produced an empty recording.');

  function cleanup() {
    dir.dispose();
    if (game.cameraDirector === dir) game.cameraDirector = prev ?? null;
    game.audio.releaseCapture();
    if (input && edge !== undefined) input.edgeScroll = edge;
    document.body.classList.remove('clip-rec');
    try { pb.setView(view); } catch { /* replay closed */ }
    active = false;
  }
}

function showClipError(msg: string) {
  const m = openModal(SHARE_ICONS.record, 'Highlight clip', 'Cannot record');
  (m.panel.querySelector('.sh-body') as HTMLElement).innerHTML = `<div class="mx-note bad">${esc(msg)}</div>
    <div class="mx-actions"><button class="btn-primary" data-a="ok">${ICONS.check}<span>OK</span></button></div>`;
  (m.panel.querySelector('[data-a="ok"]') as HTMLElement).onclick = () => m.close();
  m.focus();
}

/** The finished clip: preview, download, share. */
export function showClipResult(blob: Blob, ext: string, label: string, w: number, h: number, again?: () => void) {
  const name = videoFileName(label, ext);
  const file = new File([blob], name, { type: blob.type });
  const url = URL.createObjectURL(blob);
  const m = openModal(SHARE_ICONS.record, 'Highlight clip', label, { cls: 'clip-panel' });
  const body = m.panel.querySelector('.sh-body') as HTMLElement;
  const mb = (blob.size / 1048576).toFixed(1);
  body.innerHTML = `<video class="clip-video" src="${esc(url)}" controls autoplay muted loop playsinline></video>
    <div class="mx-note" style="margin-top:.6rem">${w}×${h} · ${esc(ext.toUpperCase())} · ${mb} MB. Recorded on this device; nothing was uploaded.</div>
    <div class="sh-status" role="status" aria-live="polite"></div>
    <div class="mx-actions"><button class="btn-primary" data-a="dl">${ICONS.download}<span>Download</span></button>
      ${canShareFile(file) ? `<button class="btn" data-a="share">${SHARE_ICONS.share}<span>Share…</span></button>` : ''}
      ${again ? `<button class="btn" data-a="again">${SHARE_ICONS.record}<span>Record again</span></button>` : ''}</div>`;
  const status = body.querySelector('.sh-status') as HTMLElement;
  (body.querySelector('[data-a="dl"]') as HTMLElement).onclick = () => { downloadBlob(blob, name); status.textContent = `Saved as ${name}`; };
  const sh = body.querySelector<HTMLElement>('[data-a="share"]');
  if (sh) sh.onclick = () => { void navigator.share({ files: [file], title: 'Red Horizon', text: label }).catch(() => {}); };
  const ag = body.querySelector<HTMLElement>('[data-a="again"]');
  if (ag && again) ag.onclick = () => { m.close(); again(); };
  m.onClose(() => setTimeout(() => URL.revokeObjectURL(url), 1000));
  m.focus();
}

/** The "Record clip" button for the replay bar (records from the current moment). */
export function clipButton(onClick: () => void): HTMLElement | null {
  if (!canRecordClips()) return null;
  const b = el('button', 'rp-btn rp-clip', SHARE_ICONS.record);
  b.title = `Record a ${CLIP_SECONDS} s highlight clip from here (WebM video with sound)`;
  b.setAttribute('aria-label', 'Record clip');
  b.onclick = onClick;
  b.addEventListener('mousedown', (e) => e.preventDefault());
  return b;
}
