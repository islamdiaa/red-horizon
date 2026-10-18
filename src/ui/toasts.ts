/** Toast notifications with de-duplication, lifetime bars and an openable event log. */
import { formatTime } from '../core/util';
import { el, esc, type UiSound } from './dom';
import { ICONS } from './icons';
import { ARIA_TEXT } from './a11y-strings';
import { trSource } from '../i18n/core';
import tToasts from '../i18n/en/toasts';

export type ToastKind = 'warn' | 'info' | 'success' | 'economy';

const KIND_ICON: Record<ToastKind, string> = { warn: ICONS.warn, info: ICONS.info, success: ICONS.success, economy: ICONS.coin };
const LIFE: Record<ToastKind, number> = { warn: 6.5, info: 4.5, success: 5, economy: 5 };
const MAX_VISIBLE = 4;
const MAX_LOG = 60;

/** Infer the toast style from the message text (callers only pass a boolean "warn" flag). */
export function classifyMessage(text: string, warn: boolean): ToastKind {
  const t = text.toLowerCase();
  if (/fund|silo|credit|\$|money|cash|sold/.test(t)) return 'economy';
  if (warn) return 'warn';
  if (/attack|lost|destroyed\.?$|offline|low power|warning|defeated|cannot|can't|not ready|already|requires|failed|detected/.test(t) && !/enemy destroyed/.test(t)) return 'warn';
  if (/complete|ready|online|promot|captured|reinforce|accomplished|enemy destroyed|eliminated|charged|launched|arrived|new construction/.test(t)) return 'success';
  return 'info';
}

interface Active { key: string; kind: ToastKind; count: number; life: number; max: number; el: HTMLElement; countEl: HTMLElement; lifeEl: HTMLElement; leaving: boolean }
interface LogEntry { key: string; text: string; kind: ToastKind; count: number; time: number; at: number }

const keyOf = (text: string) => text.trim().replace(/[.!]+$/, '').toLowerCase();
const clean = (text: string) => text.trim().replace(/\.$/, '');

export class Toasts {
  readonly stack: HTMLElement;
  readonly bell: HTMLButtonElement;
  private badge: HTMLElement;
  private panel: HTMLElement;
  private list: HTMLElement;
  private active: Active[] = [];
  private log: LogEntry[] = [];
  private unread = 0;
  private outside = (e: PointerEvent) => {
    if (!this.panel.contains(e.target as Node) && !this.bell.contains(e.target as Node)) this.toggle(false);
  };

  constructor(parent: HTMLElement, bellParent: HTMLElement, private clock: () => number, private sound: UiSound) {
    this.stack = el('div');
    this.stack.id = 'toasts';
    this.stack.setAttribute('role', 'log'); // new toasts are read out politely
    this.stack.setAttribute('aria-live', 'polite');
    this.stack.setAttribute('aria-relevant', 'additions');
    this.stack.setAttribute('aria-label', ARIA_TEXT.toasts);
    parent.appendChild(this.stack);

    this.bell = el('button', 'tb-btn tb-bell', `${ICONS.bell}<span class="bell-badge"></span>`);
    this.bell.setAttribute('aria-label', ARIA_TEXT.eventLog);
    this.bell.setAttribute('aria-expanded', 'false');
    this.bell.dataset.tip = `<div class="tt-head"><b>${tToasts.html('logTitle')}</b></div><p>${tToasts.html('logTip')}</p>`;
    this.bell.dataset.tipSide = 'bottom';
    this.badge = this.bell.querySelector('.bell-badge')!;
    this.bell.onclick = () => { this.sound.play('click'); this.toggle(); };
    bellParent.appendChild(this.bell);

    this.panel = el('div', 'notif-log panel', `<div class="nl-head">${ICONS.history}<b>${tToasts.html('logTitle')}</b><span class="nl-count"></span><button class="nl-clear" data-tip="${esc(tToasts.html('clearLog'))}" data-tip-side="bottom">${ICONS.trash}</button></div><div class="nl-list"></div>`);
    this.list = this.panel.querySelector('.nl-list')!;
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-label', ARIA_TEXT.eventLog);
    this.panel.querySelector('.nl-clear')?.setAttribute('aria-label', ARIA_TEXT.clearLog);
    (this.panel.querySelector('.nl-clear') as HTMLElement).onclick = () => { this.log = []; this.renderLog(); this.sound.play('click'); };
    bellParent.appendChild(this.panel);
    this.renderLog();
  }

  /**
   * Show a toast and log it; `logOnly` just logs it (the line is on screen as a subtitle). English from a
   * registered source (announcer lines, mission scripts: src/i18n/core.ts sourceStrings) is shown translated.
   */
  push(text: string, kind: ToastKind, logOnly = false) {
    text = trSource(text);
    const key = keyOf(text);
    const now = performance.now();
    // history (merge with a recent identical entry)
    const last = this.log[0];
    if (last && last.key === key && now - last.at < 15000) { last.count++; last.at = now; last.time = this.clock(); }
    else {
      this.log.unshift({ key, text: clean(text), kind, count: 1, time: this.clock(), at: now });
      if (this.log.length > MAX_LOG) this.log.length = MAX_LOG;
    }
    if (!this.panel.classList.contains('open')) {
      this.unread++;
      this.bell.classList.remove('ring');
      if (kind === 'warn') { void this.bell.offsetWidth; this.bell.classList.add('ring'); }
    }
    this.renderLog();
    this.renderBadge();
    if (logOnly) return;

    // live toast (dedupe)
    const ex = this.active.find((a) => a.key === key && !a.leaving);
    if (ex) {
      ex.count++;
      ex.life = ex.max;
      ex.countEl.textContent = `×${ex.count}`;
      ex.el.classList.add('multi');
      ex.el.classList.remove('bump');
      void ex.el.offsetWidth;
      ex.el.classList.add('bump');
      // move to the top
      this.stack.prepend(ex.el);
      return;
    }
    const t = el('div', `toast t-${kind}`, `<div class="toast-in"><span class="t-ic">${KIND_ICON[kind]}</span><span class="t-text">${esc(clean(text))}</span><span class="t-count"></span><span class="t-life"><i></i></span></div>`);
    const a: Active = { key, kind, count: 1, life: LIFE[kind], max: LIFE[kind], el: t, countEl: t.querySelector('.t-count')!, lifeEl: t.querySelector('.t-life i')!, leaving: false };
    t.addEventListener('click', () => this.dismiss(a));
    this.stack.prepend(t);
    this.active.unshift(a);
    // over capacity: evict the oldest routine toast first so warnings stay on screen
    let live = this.active.filter((x) => !x.leaving);
    while (live.length > MAX_VISIBLE) {
      const victim = [...live].reverse().find((x) => x.kind !== 'warn' && x !== a) ?? live[live.length - 1];
      this.dismiss(victim);
      live = live.filter((x) => x !== victim);
    }
  }

  update(dt: number) {
    for (const a of this.active) {
      if (a.leaving) continue;
      a.life -= dt;
      a.lifeEl.style.transform = `scaleX(${Math.max(0, a.life / a.max).toFixed(3)})`;
      if (a.life <= 0) this.dismiss(a);
    }
  }

  private dismiss(a: Active) {
    if (a.leaving) return;
    a.leaving = true;
    a.el.classList.add('out');
    setTimeout(() => {
      a.el.remove();
      this.active = this.active.filter((x) => x !== a);
    }, 420);
  }

  toggle(open = !this.panel.classList.contains('open')) {
    this.panel.classList.toggle('open', open);
    this.bell.classList.toggle('active', open);
    this.bell.setAttribute('aria-expanded', String(open));
    this.stack.classList.toggle('hush', open);
    if (open) {
      this.unread = 0;
      this.renderBadge();
      document.addEventListener('pointerdown', this.outside, true);
    } else document.removeEventListener('pointerdown', this.outside, true);
  }

  private renderBadge() {
    this.badge.textContent = this.unread > 9 ? '9+' : String(this.unread);
    this.badge.classList.toggle('on', this.unread > 0);
  }

  private renderLog() {
    (this.panel.querySelector('.nl-count') as HTMLElement).textContent = this.log.length ? String(this.log.length) : '';
    if (!this.log.length) {
      this.list.innerHTML = `<div class="nl-empty">${tToasts.html('empty')}</div>`;
      return;
    }
    this.list.innerHTML = this.log.map((e) =>
      `<div class="nl-row t-${e.kind}"><span class="nl-time">${formatTime(e.time)}</span><span class="t-ic">${KIND_ICON[e.kind]}</span><span class="nl-text">${esc(e.text)}</span>${e.count > 1 ? `<span class="t-count">×${e.count}</span>` : ''}</div>`).join('');
  }
}
