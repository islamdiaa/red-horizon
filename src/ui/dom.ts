/** Small DOM helpers shared by the HUD and menus. */
import type { SfxKey } from '../audio/types';

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const hexColor = (c: number) => '#' + c.toString(16).padStart(6, '0');

/** Restart a one-shot CSS animation class and remove it again afterwards. */
export function replay(e: Element, cls: string, ms = 700) {
  e.classList.remove(cls);
  void (e as HTMLElement).offsetWidth;
  e.classList.add(cls);
  const t = +((e as HTMLElement).dataset[`t_${cls}`] ?? 0);
  if (t) clearTimeout(t);
  (e as HTMLElement).dataset[`t_${cls}`] = String(window.setTimeout(() => e.classList.remove(cls), ms));
}

export function reducedMotion(): boolean {
  return document.body.classList.contains('reduce-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches;
}

interface SoundSink { play(key: SfxKey, pos?: { x: number; y: number }, opts?: { volume?: number; pitch?: number }): void }

/** Throttled UI sounds so sweeping the mouse over a grid doesn't machine-gun the hover blip. */
export class UiSound {
  private last: Record<string, number> = {};
  constructor(private audio: SoundSink) {}
  play(key: 'hover' | 'click' | 'tab' | 'error' | 'ready_ping', minGap = key === 'hover' ? 70 : 40, volume?: number) {
    const now = performance.now();
    if (now - (this.last[key] ?? 0) < minGap) return;
    this.last[key] = now;
    try {
      this.audio.play(key, undefined, volume !== undefined ? { volume } : key === 'hover' ? { volume: 0.35 } : undefined);
    } catch { /* audio not unlocked yet */ }
  }
  /** Wire hover / press sounds for every element matching `selector` inside `root` (event delegation). */
  bind(root: HTMLElement, selector: string) {
    let lastHover: Element | null = null;
    root.addEventListener('pointerover', (e) => {
      const t = (e.target as HTMLElement).closest(selector);
      if (!t || t === lastHover || (t as HTMLButtonElement).disabled) return;
      lastHover = t;
      this.play('hover');
    });
    root.addEventListener('pointerout', (e) => {
      const t = (e.target as HTMLElement).closest(selector);
      if (t && !t.contains(e.relatedTarget as Node)) lastHover = null;
    });
  }
}

/** Rolling odometer digits (each digit rolls in the direction of change). */
export class Odometer {
  readonly el: HTMLElement;
  private cols: { strip: HTMLElement; digit: number; timer: number }[] = [];
  private value = -1;
  private len = 0;
  constructor(cls = 'odo') {
    this.el = el('span', cls);
  }
  set(v: number) {
    v = Math.max(0, Math.round(v));
    if (v === this.value) return;
    const up = v > this.value;
    const s = String(v);
    if (s.length !== this.len) this.rebuild(s.length);
    for (let i = 0; i < s.length; i++) this.roll(this.cols[i], +s[i], up, this.value < 0);
    this.value = v;
  }
  private rebuild(n: number) {
    this.len = n;
    this.el.innerHTML = '';
    this.cols = [];
    for (let i = 0; i < n; i++) {
      if (i > 0 && (n - i) % 3 === 0) this.el.appendChild(el('span', 'odo-sep', ','));
      const col = el('span', 'odo-col');
      const strip = el('span', 'odo-strip', [0, 1, 2].map(() => '<i>0</i><i>1</i><i>2</i><i>3</i><i>4</i><i>5</i><i>6</i><i>7</i><i>8</i><i>9</i>').join(''));
      col.appendChild(strip);
      this.el.appendChild(col);
      const c = { strip, digit: 0, timer: 0 };
      this.place(c, 10, false);
      this.cols.push(c);
    }
    this.value = -1;
  }
  private place(c: { strip: HTMLElement }, pos: number, animate: boolean) {
    c.strip.style.transition = animate ? '' : 'none';
    c.strip.style.transform = `translateY(${-pos * 10 / 3}%)`;
  }
  private roll(c: { strip: HTMLElement; digit: number; timer: number }, d: number, up: boolean, snap: boolean) {
    if (c.digit === d) return;
    if (c.timer) { clearTimeout(c.timer); c.timer = 0; this.place(c, 10 + c.digit, false); void c.strip.offsetWidth; }
    const from = c.digit;
    c.digit = d;
    if (snap) { this.place(c, 10 + d, false); return; }
    const target = up ? (d > from ? 10 + d : 20 + d) : (d < from ? 10 + d : d);
    this.place(c, target, true);
    if (target !== 10 + d) c.timer = window.setTimeout(() => { c.timer = 0; this.place(c, 10 + d, false); }, 320);
  }
}

/** Animate numbers inside elements with data-count from 0 to their value. */
export function countUp(root: HTMLElement, duration = 1400, delayStep = 90) {
  const els = [...root.querySelectorAll<HTMLElement>('[data-count]')];
  const fast = reducedMotion();
  els.forEach((e, i) => {
    const target = +e.dataset.count!;
    const prefix = e.dataset.prefix ?? '';
    const fmt = (v: number) => prefix + Math.round(v).toLocaleString('en-US');
    if (fast || !isFinite(target)) { e.textContent = fmt(target); return; }
    e.textContent = fmt(0);
    const start = performance.now() + i * delayStep;
    const tick = (now: number) => {
      const k = Math.min(1, Math.max(0, (now - start) / duration));
      e.textContent = fmt(target * (1 - Math.pow(1 - k, 3)));
      if (k < 1 && e.isConnected) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** Subtle 3D tilt + glare that follows the pointer (sets --rx/--ry/--gx/--gy/--px/--py). */
export function bindTilt(card: HTMLElement, maxDeg = 9) {
  card.addEventListener('pointermove', (e) => {
    if (reducedMotion()) return;
    const r = card.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    card.style.setProperty('--rx', `${((x - 0.5) * 2 * maxDeg).toFixed(2)}deg`);
    card.style.setProperty('--ry', `${(-(y - 0.5) * 2 * maxDeg).toFixed(2)}deg`);
    card.style.setProperty('--gx', `${(x * 100).toFixed(1)}%`);
    card.style.setProperty('--gy', `${(y * 100).toFixed(1)}%`);
    card.style.setProperty('--px', (x - 0.5).toFixed(3));
    card.style.setProperty('--py', (y - 0.5).toFixed(3));
  });
  card.addEventListener('pointerleave', () => {
    for (const k of ['--rx', '--ry', '--px', '--py']) card.style.removeProperty(k);
  });
}

export type TipSide = 'left' | 'right' | 'top' | 'bottom';

/** The shared #tooltip element, anchored to an element rect (no jitter while moving the mouse). */
export class Tooltip {
  readonly el: HTMLElement;
  private anchor: HTMLElement | null = null;
  private html = '';
  constructor() {
    document.getElementById('tooltip')?.remove();
    this.el = el('div', 'panel');
    this.el.id = 'tooltip';
    document.body.appendChild(this.el);
  }
  show(anchor: HTMLElement, html: string, side: TipSide = 'left') {
    this.anchor = anchor;
    this.html = html;
    this.el.innerHTML = html;
    this.el.dataset.side = side;
    this.el.classList.add('on');
    this.position(side);
  }
  /** Refresh the content if this anchor is still showing. */
  refresh(anchor: HTMLElement, html: string) {
    if (this.anchor === anchor && this.el.classList.contains('on') && html !== this.html) {
      this.html = html;
      this.el.innerHTML = html;
      this.position(this.el.dataset.side as TipSide);
    }
  }
  isFor(anchor: HTMLElement) {
    return this.anchor === anchor && this.el.classList.contains('on');
  }
  hide(anchor?: HTMLElement) {
    if (anchor && anchor !== this.anchor) return;
    this.anchor = null;
    this.el.classList.remove('on');
  }
  private position(side: TipSide) {
    if (!this.anchor) return;
    const a = this.anchor.getBoundingClientRect();
    const t = this.el.getBoundingClientRect();
    const gap = 10, W = window.innerWidth, H = window.innerHeight;
    let x: number, y: number;
    if (side === 'left' || side === 'right') {
      x = side === 'left' ? a.left - t.width - gap : a.right + gap;
      if (x < 6) x = a.right + gap;
      if (x + t.width > W - 6) x = a.left - t.width - gap;
      y = a.top + a.height / 2 - t.height / 2;
    } else {
      y = side === 'top' ? a.top - t.height - gap : a.bottom + gap;
      if (y < 6) y = a.bottom + gap;
      if (y + t.height > H - 6) y = a.top - t.height - gap;
      x = a.left + a.width / 2 - t.width / 2;
    }
    x = Math.max(6, Math.min(W - t.width - 6, x));
    y = Math.max(6, Math.min(H - t.height - 6, y));
    this.el.style.left = `${Math.round(x)}px`;
    this.el.style.top = `${Math.round(y)}px`;
  }
  /** Delegate: any element under `root` with data-tip shows it (data-tip-side picks the side). */
  bind(root: HTMLElement, defSide: TipSide) {
    root.addEventListener('pointerover', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]');
      if (!t || !root.contains(t) || this.anchor === t) return;
      this.show(t, t.dataset.tip!, (t.dataset.tipSide as TipSide) ?? defSide);
    });
    root.addEventListener('pointerout', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]');
      if (t && !t.contains(e.relatedTarget as Node)) this.hide(t);
    });
  }
}

/** Builds tooltip markup: title, optional right-aligned tag, body and key hints. */
export function tipHtml(title: string, body = '', keys: [string, string][] = [], tag = ''): string {
  return `<div class="tt-head"><b>${title}</b>${tag ? `<span class="tt-tag">${tag}</span>` : ''}</div>` +
    (body ? `<p>${body}</p>` : '') +
    (keys.length ? `<div class="tt-keys">${keys.map(([k, v]) => `<span><kbd>${k}</kbd>${v}</span>`).join('')}</div>` : '');
}
