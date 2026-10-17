import type { MissionEvent, MissionRuntime, Objective, Portrait } from '../sim/mission';
import { formatTime } from '../core/util';
import { castPortrait } from './campaign';
import { esc } from './dom';
import { ICONS } from './icons';

const CSS = `
.mh-obj { position: absolute; top: calc(var(--rem, 1px) * 0 + 58px); left: 12px; width: 330px; z-index: 6; pointer-events: none;
  background: linear-gradient(180deg, rgba(14,20,28,0.86), rgba(8,11,16,0.8)); border: 1px solid rgba(255,255,255,0.08);
  border-left: 3px solid rgb(var(--accent-rgb, 90,180,255)); border-radius: 10px; padding: 10px 12px 8px; backdrop-filter: blur(8px);
  font-family: var(--font, sans-serif); color: #dfe8f2; box-shadow: 0 8px 30px rgba(0,0,0,0.45); transition: opacity 0.4s; }
.mh-obj h5 { margin: 0 0 6px; font-size: 11px; letter-spacing: 0.24em; color: rgb(var(--accent-rgb, 90,180,255)); font-weight: 700; }
.mh-row { display: flex; gap: 8px; align-items: flex-start; font-size: 14px; line-height: 1.3; margin: 5px 0; transition: all 0.4s; }
.mh-row .bx { flex-shrink: 0; width: 14px; height: 14px; margin-top: 2px; border-radius: 3px; border: 1.5px solid rgba(255,255,255,0.45); position: relative; }
.mh-row.secondary { font-size: 12.5px; opacity: 0.8; }
.mh-row.secondary .bx { border-radius: 50%; }
.mh-row.done { color: #8dffb0; }
.mh-row.done .bx { border-color: #58ff8a; background: rgba(88,255,138,0.25); }
.mh-row.done .bx::after { content: ''; position: absolute; left: 3px; top: 0px; width: 4px; height: 8px; border: solid #8dffb0; border-width: 0 2px 2px 0; transform: rotate(45deg); }
.mh-row.done .tx { text-decoration: line-through; text-decoration-color: rgba(141,255,176,0.5); }
.mh-row.failed { color: #ff8a7a; }
.mh-row.failed .bx { border-color: #ff4a3a; background: rgba(255,74,58,0.25); }
.mh-row .pg { margin-left: auto; font-family: var(--mono, monospace); font-size: 12px; color: #ffd34d; padding-left: 8px; white-space: nowrap; }
.mh-row.flash { animation: mhFlash 1.2s ease-out; }
@keyframes mhFlash { 0% { background: rgba(var(--accent-rgb, 90,180,255),0.35); } 100% { background: transparent; } }
.mh-timer { position: absolute; top: 58px; left: 50%; transform: translateX(calc(-50% - var(--sidebar-w, 312px) / 2)); z-index: 6; pointer-events: none;
  font-family: var(--mono, monospace); color: #fff; text-align: center; display: none; }
.mh-timer.on { display: block; }
.mh-timer .lb { font-family: var(--font, sans-serif); font-size: 11px; letter-spacing: 0.3em; color: #ffb0a0; }
.mh-timer .tm { font-size: 34px; letter-spacing: 0.08em; text-shadow: 0 0 18px rgba(255,90,70,0.7); }
.mh-timer.urgent .tm { color: #ff6a5a; animation: mhPulse 0.8s infinite alternate; }
@keyframes mhPulse { to { opacity: 0.55; } }
.mh-tx { position: absolute; left: 12px; bottom: 14px; width: 440px; z-index: 7; pointer-events: none; display: flex; gap: 12px;
  background: linear-gradient(180deg, rgba(14,20,28,0.92), rgba(8,11,16,0.9)); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 12px;
  box-shadow: 0 10px 40px rgba(0,0,0,0.55); transform: translateY(20px); opacity: 0; transition: transform 0.35s cubic-bezier(.2,.8,.2,1), opacity 0.35s, bottom 0.3s ease; }
/* lift the radio above the unit panel / group bar when they are on screen (they share the bottom-left) */
body:not(.hud-modern):has(#selpanel.on) .mh-tx, body:not(.hud-modern):has(#groups.on) .mh-tx { bottom: calc(var(--dock-h, 128px) + 22px); }
.mh-tx.on { transform: none; opacity: 1; }
.mh-tx .pt { width: 74px; height: 86px; flex-shrink: 0; border-radius: 8px; overflow: hidden; position: relative;
  background: radial-gradient(ellipse at 50% 30%, rgba(var(--accent-rgb, 90,180,255),0.35), #05080c 75%); border: 1px solid rgba(var(--accent-rgb, 90,180,255),0.4); }
.mh-tx .pt svg { width: 100%; height: 100%; }
.mh-tx .pt::after { content: ''; position: absolute; inset: 0; background: repeating-linear-gradient(0deg, rgba(255,255,255,0.05) 0 1px, transparent 1px 3px); animation: mhScan 4s linear infinite; }
@keyframes mhScan { to { background-position: 0 40px; } }
.mh-tx .sp { font-size: 11px; letter-spacing: 0.24em; color: rgb(var(--accent-rgb, 90,180,255)); font-weight: 700; margin-bottom: 4px; font-family: var(--font, sans-serif); }
.mh-tx .tt { font-size: 15px; line-height: 1.38; color: #e8f0f8; font-family: var(--font, sans-serif); min-height: 2.6em; }
.mh-tx .wave { display: flex; gap: 2px; align-items: flex-end; height: 10px; margin-top: 6px; }
.mh-tx .wave i { width: 3px; background: rgb(var(--accent-rgb, 90,180,255)); animation: mhWave 0.5s ease-in-out infinite alternate; opacity: 0.8; }
@keyframes mhWave { from { height: 2px; } to { height: 10px; } }
.mh-score { position: absolute; top: 58px; right: calc(var(--sidebar-w, 312px) + 16px); z-index: 6; pointer-events: none; font-family: var(--mono, monospace);
  color: #ffd34d; font-size: 22px; text-shadow: 0 0 14px rgba(255,200,60,0.5); display: none; text-align: right; }
.mh-score.on { display: block; }
.mh-score small { display: block; font-family: var(--font, sans-serif); font-size: 10px; letter-spacing: 0.3em; color: #c8b070; }
body.cine-active .mh-obj, body.cine-active .mh-tx, body.cine-active .mh-timer, body.cine-active .mh-score { opacity: 0 !important; }
/* Modern layout: the checklist is the objectives panel of the top-left column (countdown and score inline),
   the radio sits above the minimap, the big countdown only appears for the final minute */
.mh-ic, .mh-trow, .mh-srow { display: none; }
body.hud-modern .mh-obj { position: relative; top: auto; left: auto; width: 100%; z-index: auto; padding: 0.55rem 0.75rem 0.6rem; border-radius: 0.7rem;
  border: 1px solid var(--line-2, rgba(255,255,255,0.13)); border-left: 1px solid var(--line-2, rgba(255,255,255,0.13)); background: linear-gradient(180deg, rgba(16,24,34,0.8), rgba(8,12,18,0.74));
  box-shadow: 0 0.6rem 1.8rem rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05); backdrop-filter: blur(10px); }
body.hud-modern .mh-obj.empty { display: none; }
body.hud-modern .mh-obj h5 { display: flex; align-items: center; gap: 0.4rem; margin: 0 0 0.35rem; font-size: 0.74rem; letter-spacing: 0.22em; color: #fff; }
body.hud-modern .mh-obj h5 + .mh-row { margin-top: 0; }
body.hud-modern .mh-obj h5.opt { margin-top: 0.45rem; font-size: 0.62rem; color: var(--muted, #7d8c9d); }
body.hud-modern .mh-ic { display: flex; font-size: 0.95rem; color: rgb(var(--accent-rgb, 90,180,255)); filter: drop-shadow(0 0 4px rgba(var(--accent-rgb, 90,180,255),0.6)); }
body.hud-modern .mh-row { gap: 0.5rem; font-size: 0.86rem; line-height: 1.25; margin: 0.28rem 0; padding: 0.06rem 0.15rem; border-radius: 0.3rem; }
body.hud-modern .mh-row .bx { width: 0.9rem; height: 0.9rem; margin-top: 0.1rem; border-radius: 0.2rem; border-width: 1.5px; }
body.hud-modern .mh-row.done .bx::after { left: 0.24rem; top: 0.02rem; width: 0.26rem; height: 0.5rem; }
body.hud-modern .mh-row.secondary { font-size: 0.8rem; }
body.hud-modern .mh-row .pg { font-size: 0.76rem; }
body.hud-modern .mh-trow.on, body.hud-modern .mh-srow.on { display: flex; align-items: center; gap: 0.45rem; margin-top: 0.4rem; padding-top: 0.4rem; border-top: 1px solid rgba(255,255,255,0.08); font-size: 0.8rem; color: #dfe8f2; }
body.hud-modern .mh-trow svg, body.hud-modern .mh-srow svg { font-size: 0.9rem; color: #ffb0a0; flex-shrink: 0; }
body.hud-modern .mh-trow .lb, body.hud-modern .mh-srow .lb { flex: 1; min-width: 0; letter-spacing: 0.1em; text-transform: uppercase; font-size: 0.7rem; color: #ffb0a0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
body.hud-modern .mh-trow .tm, body.hud-modern .mh-srow .tm { font-family: var(--mono, monospace); font-size: 1rem; color: #fff; }
body.hud-modern .mh-trow.urgent .tm { color: #ff6a5a; animation: mhPulse 0.8s infinite alternate; }
body.hud-modern .mh-srow svg, body.hud-modern .mh-srow .lb { color: #c8b070; }
body.hud-modern .mh-srow .tm { color: #ffd34d; }
body.hud-modern .mh-timer { top: calc(var(--edge, 0.7rem) + 0.2rem); transform: translateX(-50%); }
body.hud-modern .mh-timer:not(.soon), body.hud-modern .mh-score { display: none !important; }
@media (max-width: 1100px) { body.hud-modern .mh-timer { top: calc(var(--edge, 0.7rem) + 3.4rem); } }
body.hud-modern .mh-timer .lb { font-size: 0.7rem; }
body.hud-modern .mh-timer .tm { font-size: 2.2rem; }
body.hud-modern .mh-tx { left: var(--edge, 0.7rem); bottom: calc(var(--dock-h, 16rem) + var(--edge, 0.7rem) * 2 + var(--bot, 0px)); width: min(29rem, calc(100vw - 2 * var(--edge, 0.7rem))); gap: 0.75rem; padding: 0.75rem; border-radius: 0.8rem; }
body.hud-modern .mh-tx .pt { width: 4.6rem; height: 5.4rem; border-radius: 0.5rem; }
body.hud-modern .mh-tx .sp { font-size: 0.68rem; }
body.hud-modern .mh-tx .tt { font-size: 0.92rem; }
`;

/** On-screen mission UI: objectives, radio transmissions, countdown and score. */
export class MissionHud {
  private obj: HTMLElement;
  private tx: HTMLElement;
  private timer: HTMLElement;
  private scoreEl: HTMLElement;
  private queue: { speaker: string; text: string; portrait: Portrait }[] = [];
  private showing = false;
  private hideT = 0;
  private typing = 0;
  private full = '';
  private textEl: HTMLElement | null = null;
  private timerLabel = '';
  /** The checklist, and the Modern layout's inline countdown / score rows. */
  private list: HTMLElement;
  private trow: HTMLElement;
  private srow: HTMLElement;
  private trowKey = '';

  constructor(private runtime: MissionRuntime, private sound: (k: 'tab' | 'ready_ping' | 'click') => void) {
    if (!document.getElementById('mh-style')) {
      const st = document.createElement('style');
      st.id = 'mh-style';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    const ui = document.getElementById('ui')!;
    this.obj = document.createElement('div');
    this.obj.className = 'mh-obj';
    // list + inline countdown / score (the rows only show in the Modern layout)
    this.list = document.createElement('div');
    this.list.className = 'mh-list';
    this.trow = document.createElement('div');
    this.trow.className = 'mh-trow';
    this.srow = document.createElement('div');
    this.srow.className = 'mh-srow';
    this.obj.append(this.list, this.trow, this.srow);
    this.tx = document.createElement('div');
    this.tx.className = 'mh-tx';
    this.timer = document.createElement('div');
    this.timer.className = 'mh-timer';
    this.scoreEl = document.createElement('div');
    this.scoreEl.className = 'mh-score';
    ui.append(this.obj, this.tx, this.timer, this.scoreEl);
    // Modern: the checklist heads the top-left column (the HUD moves it back if the layout changes)
    const col = document.getElementById('topbar');
    if (col && document.body.classList.contains('hud-modern')) col.prepend(this.obj);
    this.renderObjectives();
  }

  handle(ev: MissionEvent) {
    switch (ev.e) {
      case 'message':
        this.queue.push({ speaker: ev.speaker, text: ev.text, portrait: ev.portrait });
        break;
      case 'objective':
        this.renderObjectives(ev.objective.id);
        if (ev.change === 'done') this.sound('ready_ping');
        else if (ev.change === 'added') this.sound('tab');
        break;
      case 'timer':
        this.timerLabel = ev.seconds === null ? '' : ev.label;
        break;
      case 'score':
        this.scoreEl.classList.add('on');
        this.scoreEl.innerHTML = `${Math.round(ev.value).toLocaleString('en-US')}<small>${esc(ev.label.toUpperCase())}</small>`;
        this.srow.classList.add('on');
        this.srow.innerHTML = `${ICONS.trophy}<span class="lb">${esc(ev.label)}</span><span class="tm">${Math.round(ev.value).toLocaleString('en-US')}</span>`;
        break;
    }
  }

  private renderObjectives(flashId?: string) {
    const list = this.runtime.objectives;
    this.obj.classList.toggle('empty', !list.length); // Modern drops the empty panel from the column
    if (!list.length) { this.obj.style.opacity = '0'; return; }
    this.obj.style.opacity = '1';
    const row = (o: Objective) => `<div class="mh-row ${o.primary ? '' : 'secondary'} ${o.state} ${o.id === flashId ? 'flash' : ''}"><span class="bx"></span><span class="tx">${esc(o.text)}</span>${o.progress ? `<span class="pg">${esc(String(o.progress))}</span>` : ''}</div>`;
    const prim = list.filter((o) => o.primary), sec = list.filter((o) => !o.primary);
    this.list.innerHTML = `<h5><span class="mh-ic">${ICONS.target}</span>OBJECTIVES</h5>${prim.map(row).join('')}${sec.length ? `<h5 class="opt" style="margin-top:8px">OPTIONAL</h5>${sec.map(row).join('')}` : ''}`;
  }

  update(dt: number) {
    // transmissions
    if (!this.showing && this.queue.length) {
      const m = this.queue.shift()!;
      this.showing = true;
      this.full = m.text;
      this.typing = 0;
      this.hideT = 2.8 + m.text.length * 0.045;
      this.tx.innerHTML = `<div class="pt">${castPortrait(m.speaker, m.portrait)}</div><div style="flex:1"><div class="sp">${esc(m.speaker.toUpperCase())}</div><div class="tt"></div><div class="wave">${'<i></i>'.repeat(12)}</div></div>`;
      this.tx.querySelectorAll<HTMLElement>('.wave i').forEach((i, k) => { i.style.animationDelay = `${(k * 0.07) % 0.5}s`; });
      this.textEl = this.tx.querySelector('.tt');
      this.tx.classList.add('on');
      this.sound('click');
    }
    if (this.showing) {
      if (this.typing < this.full.length) {
        this.typing = Math.min(this.full.length, this.typing + dt * 55);
        if (this.textEl) this.textEl.textContent = this.full.slice(0, Math.floor(this.typing));
      } else {
        const wave = this.tx.querySelector<HTMLElement>('.wave');
        if (wave) wave.style.opacity = '0.2';
      }
      this.hideT -= dt;
      if (this.hideT <= 0) {
        this.tx.classList.remove('on');
        this.showing = false;
      }
    }
    // countdown
    const t = this.runtime.hudTimerKey ? this.runtime.timeLeft(this.runtime.hudTimerKey) : null;
    if (this.timerLabel && t !== null) {
      this.timer.classList.add('on');
      this.timer.classList.toggle('urgent', t < 30);
      this.timer.classList.toggle('soon', t < 60); // Modern shows the big countdown for the final minute only
      this.timer.innerHTML = `<div class="lb">${esc(this.timerLabel.toUpperCase())}</div><div class="tm">${formatTime(Math.ceil(t))}</div>`;
      // inline countdown row of the Modern checklist
      const tk = `${this.timerLabel}|${Math.ceil(t)}`;
      if (tk !== this.trowKey) {
        this.trowKey = tk;
        this.trow.classList.add('on');
        this.trow.classList.toggle('urgent', t < 30);
        this.trow.innerHTML = `${ICONS.clock}<span class="lb">${esc(this.timerLabel)}</span><span class="tm">${formatTime(Math.ceil(t))}</span>`;
      }
    } else {
      this.timer.classList.remove('on');
      if (this.trowKey) { this.trowKey = ''; this.trow.classList.remove('on'); }
    }
  }

  dispose() {
    this.obj.remove();
    this.tx.remove();
    this.timer.remove();
    this.scoreEl.remove();
  }
}
