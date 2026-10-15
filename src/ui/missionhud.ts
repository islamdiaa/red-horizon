import type { MissionEvent, MissionRuntime, Objective, Portrait } from '../sim/mission';
import { formatTime } from '../core/util';

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
  box-shadow: 0 10px 40px rgba(0,0,0,0.55); transform: translateY(20px); opacity: 0; transition: transform 0.35s cubic-bezier(.2,.8,.2,1), opacity 0.35s; }
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
`;

/** Simple silhouette portraits (SVG) per speaker type. */
function portraitSvg(p: Portrait): string {
  const head = '<circle cx="37" cy="34" r="15" fill="#9fb6cc"/>';
  const body = '<path d="M8 90 C10 64 22 54 37 54 C52 54 64 64 66 90 Z" fill="#6f8aa3"/>';
  switch (p) {
    case 'commando':
      return `<svg viewBox="0 0 74 86">${body}${head}<path d="M22 30 C24 14 50 12 52 30 C54 22 50 44 58 50 C48 48 52 30 37 24 C26 26 26 40 22 30Z" fill="#3a2a22"/></svg>`;
    case 'enemy':
      return `<svg viewBox="0 0 74 86"><path d="M8 90 C10 64 22 54 37 54 C52 54 64 64 66 90 Z" fill="#7a3a34"/><circle cx="37" cy="34" r="15" fill="#c8a09a"/><path d="M19 28 L55 28 L52 18 C46 12 28 12 22 18 Z" fill="#4a2420"/><circle cx="37" cy="21" r="3" fill="#ff4a3a"/></svg>`;
    case 'eva':
      return `<svg viewBox="0 0 74 86"><circle cx="37" cy="43" r="24" fill="none" stroke="#5ab4ff" stroke-width="2"/><circle cx="37" cy="43" r="14" fill="none" stroke="#5ab4ff" stroke-width="1.5" opacity="0.6"/><circle cx="37" cy="43" r="5" fill="#9fdcff"/></svg>`;
    case 'scientist':
      return `<svg viewBox="0 0 74 86"><path d="M8 90 C10 64 22 54 37 54 C52 54 64 64 66 90 Z" fill="#d8dde2"/>${head}<path d="M22 26 C24 12 50 12 52 26 C46 20 28 20 22 26Z" fill="#dcdcdc"/><rect x="27" y="31" width="20" height="5" rx="2" fill="none" stroke="#333" stroke-width="1.5"/></svg>`;
    case 'pilot':
      return `<svg viewBox="0 0 74 86">${body}${head}<path d="M20 34 C20 14 54 14 54 34 L50 34 C50 22 24 22 24 34 Z" fill="#556070"/><rect x="25" y="30" width="24" height="7" rx="3" fill="#ffc060" opacity="0.8"/></svg>`;
    case 'intel':
      return `<svg viewBox="0 0 74 86">${body}${head}<path d="M20 26 L54 26 L50 16 L24 16Z" fill="#2c3440"/><rect x="18" y="25" width="38" height="3" fill="#2c3440"/></svg>`;
    default:
      return `<svg viewBox="0 0 74 86">${body}${head}<path d="M21 28 C21 15 53 15 53 28 L53 24 C50 14 24 14 21 24Z" fill="#3c4a3a"/><rect x="20" y="24" width="34" height="5" rx="2" fill="#3c4a3a"/><circle cx="37" cy="24" r="2.5" fill="#ffd34d"/></svg>`;
  }
}

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
    this.tx = document.createElement('div');
    this.tx.className = 'mh-tx';
    this.timer = document.createElement('div');
    this.timer.className = 'mh-timer';
    this.scoreEl = document.createElement('div');
    this.scoreEl.className = 'mh-score';
    ui.append(this.obj, this.tx, this.timer, this.scoreEl);
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
        this.scoreEl.innerHTML = `${Math.round(ev.value).toLocaleString('en-US')}<small>${ev.label.toUpperCase()}</small>`;
        break;
    }
  }

  private renderObjectives(flashId?: string) {
    const list = this.runtime.objectives;
    if (!list.length) { this.obj.style.opacity = '0'; return; }
    this.obj.style.opacity = '1';
    const row = (o: Objective) => `<div class="mh-row ${o.primary ? '' : 'secondary'} ${o.state} ${o.id === flashId ? 'flash' : ''}"><span class="bx"></span><span class="tx">${o.text}</span>${o.progress ? `<span class="pg">${o.progress}</span>` : ''}</div>`;
    const prim = list.filter((o) => o.primary), sec = list.filter((o) => !o.primary);
    this.obj.innerHTML = `<h5>OBJECTIVES</h5>${prim.map(row).join('')}${sec.length ? `<h5 style="margin-top:8px">OPTIONAL</h5>${sec.map(row).join('')}` : ''}`;
  }

  update(dt: number) {
    // transmissions
    if (!this.showing && this.queue.length) {
      const m = this.queue.shift()!;
      this.showing = true;
      this.full = m.text;
      this.typing = 0;
      this.hideT = 2.8 + m.text.length * 0.045;
      this.tx.innerHTML = `<div class="pt">${portraitSvg(m.portrait)}</div><div style="flex:1"><div class="sp">${m.speaker.toUpperCase()}</div><div class="tt"></div><div class="wave">${'<i></i>'.repeat(12)}</div></div>`;
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
      this.timer.innerHTML = `<div class="lb">${this.timerLabel.toUpperCase()}</div><div class="tm">${formatTime(Math.ceil(t))}</div>`;
    } else {
      this.timer.classList.remove('on');
    }
  }

  dispose() {
    this.obj.remove();
    this.tx.remove();
    this.timer.remove();
    this.scoreEl.remove();
  }
}
