/**
 * Tiny inline-styled UI kit for platform overlays (error screens, device-lost notices,
 * unsupported-browser page). Deliberately independent of src/ui/styles.css so these screens
 * still render when the game's own UI failed to load or crashed.
 */

export const ACCENT = '#5ab4ff';
export const ACCENT_RGB = '90, 180, 255';
export const DANGER_RGB = '255, 74, 58';
export const FONT = "'Rajdhani', 'Oxanium', 'Segoe UI', system-ui, sans-serif";
export const MONO = "'Share Tech Mono', 'JetBrains Mono', ui-monospace, monospace";
/** Above everything the game creates. */
export const Z_TOP = 2147483000;

type Style = Partial<Record<keyof CSSStyleDeclaration, string>>;

export function css(e: HTMLElement, style: Style): void {
  Object.assign(e.style, style);
}

/** createElement + inline style + text/children. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K, style: Style = {}, children: (Node | string | null | undefined)[] = [], attrs: Record<string, string> = {},
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  css(e, style);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const c of children) if (c != null) e.append(c);
  return e;
}

export const prefersReducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Full-screen dimmed, blurred backdrop that centres its content. */
export function backdrop(z = Z_TOP): HTMLDivElement {
  return h('div', {
    position: 'fixed', inset: '0', zIndex: String(z), display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '1.5rem', boxSizing: 'border-box', background: 'radial-gradient(ellipse at 50% 40%, rgba(12, 20, 32, 0.72), rgba(2, 4, 8, 0.9))',
    backdropFilter: 'blur(6px)', webkitBackdropFilter: 'blur(6px)', fontFamily: FONT, color: '#e9f0f7',
    userSelect: 'text', webkitUserSelect: 'text', pointerEvents: 'auto',
  } as Style);
}

/** The game's "dark glass" panel with an accent hairline on top. */
export function glassPanel(accentRgb = ACCENT_RGB, width = '34rem'): HTMLDivElement {
  const p = h('div', {
    position: 'relative', width: '100%', maxWidth: width, boxSizing: 'border-box', padding: '1.6rem 1.7rem 1.4rem',
    borderRadius: '0.9rem', overflow: 'hidden',
    background: 'linear-gradient(180deg, rgba(20, 28, 39, 0.9), rgba(8, 12, 18, 0.94))',
    border: `1px solid rgba(${accentRgb}, 0.32)`,
    boxShadow: `0 1.6rem 4rem rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 0 3rem rgba(${accentRgb}, 0.08)`,
  });
  p.append(h('div', {
    position: 'absolute', left: '0', right: '0', top: '0', height: '2px',
    background: `linear-gradient(90deg, transparent, rgb(${accentRgb}), transparent)`, opacity: '0.85',
  }));
  return p;
}

export function title(text: string, accentRgb = ACCENT_RGB): HTMLHeadingElement {
  return h('h2', {
    margin: '0 0 0.35rem', fontSize: '1.65rem', fontWeight: '700', letterSpacing: '0.12em', textTransform: 'uppercase',
    color: '#f3f7fb', textShadow: `0 0 1.2rem rgba(${accentRgb}, 0.45)`, lineHeight: '1.1',
  }, [text]);
}

export function paragraph(text: string): HTMLParagraphElement {
  return h('p', { margin: '0 0 1rem', fontSize: '1.02rem', fontWeight: '500', lineHeight: '1.4', color: '#b6c3d1' }, [text]);
}

/** Monospace scroll box for error text / technical details. */
export function codeBox(text: string, maxHeight = '9.5rem'): HTMLPreElement {
  return h('pre', {
    margin: '0 0 1.1rem', padding: '0.7rem 0.8rem', maxHeight, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
    fontFamily: MONO, fontSize: '0.78rem', lineHeight: '1.45', color: '#cfe6ff',
    background: 'rgba(0, 0, 0, 0.35)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '0.5rem',
  }, [text]);
}

/** Accent (primary) or outlined (ghost) button with hover/focus feedback done in JS (no stylesheet). */
export function button(label: string, onClick: () => void, variant: 'primary' | 'ghost' = 'ghost', accentRgb = ACCENT_RGB): HTMLButtonElement {
  const primary = variant === 'primary';
  const base: Style = {
    font: `700 0.95rem/1 ${FONT}`, letterSpacing: '0.14em', textTransform: 'uppercase', cursor: 'pointer',
    padding: '0.72rem 1.15rem 0.66rem', borderRadius: '0.5rem', outline: 'none', transition: 'all 0.16s ease',
    color: primary ? '#04101c' : '#e9f0f7',
    background: primary ? `linear-gradient(180deg, rgb(${accentRgb}), rgba(${accentRgb}, 0.78))` : 'rgba(255, 255, 255, 0.04)',
    border: primary ? `1px solid rgba(${accentRgb}, 0.9)` : '1px solid rgba(255, 255, 255, 0.16)',
    boxShadow: primary ? `0 0.4rem 1.2rem rgba(${accentRgb}, 0.28)` : 'none',
  };
  const b = h('button', base, [label], { type: 'button' });
  const hover = (on: boolean) => css(b, primary
    ? { filter: on ? 'brightness(1.12)' : '', transform: on ? 'translateY(-1px)' : '' }
    : { borderColor: on ? `rgba(${accentRgb}, 0.7)` : 'rgba(255, 255, 255, 0.16)', background: on ? `rgba(${accentRgb}, 0.12)` : 'rgba(255, 255, 255, 0.04)' });
  b.addEventListener('pointerenter', () => hover(true));
  b.addEventListener('pointerleave', () => hover(false));
  b.addEventListener('focus', () => css(b, { boxShadow: `0 0 0 2px rgba(${accentRgb}, 0.65)` }));
  b.addEventListener('blur', () => css(b, { boxShadow: base.boxShadow ?? 'none' }));
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return b;
}

export function buttonRow(buttons: HTMLElement[]): HTMLDivElement {
  return h('div', { display: 'flex', flexWrap: 'wrap', gap: '0.6rem', marginTop: '0.2rem' }, buttons);
}

/** Small rotating ring (Web Animations API, so no keyframes stylesheet is needed). */
export function spinner(accentRgb = ACCENT_RGB, size = '2.6rem'): HTMLDivElement {
  const s = h('div', {
    width: size, height: size, borderRadius: '50%', boxSizing: 'border-box', flexShrink: '0',
    border: `3px solid rgba(${accentRgb}, 0.18)`, borderTopColor: `rgb(${accentRgb})`,
  });
  if (!prefersReducedMotion() && typeof s.animate === 'function') {
    s.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: 900, iterations: Infinity });
  }
  return s;
}

/** The Red Horizon emblem (red star in a ring), same artwork as the favicon / PWA icon. */
export function emblem(size = '3.4rem'): HTMLElement {
  const wrap = h('div', { width: size, height: size, flexShrink: '0' });
  wrap.innerHTML = '<svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true">'
    + '<circle cx="50" cy="50" r="44" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="3"/>'
    + '<circle cx="50" cy="50" r="44" fill="none" stroke="#ff5a3a" stroke-width="3" stroke-linecap="round" stroke-dasharray="70 207"/>'
    + '<path d="M50 24l7.6 15.6 17.2 2.5-12.4 12.1 2.9 17.1L50 63.2l-15.3 8.1 2.9-17.1-12.4-12.1 17.2-2.5z" fill="#ff6a46"/></svg>';
  return wrap;
}

/** Fade an element in (respects reduced motion). */
export function fadeIn(e: HTMLElement, ms = 220) {
  if (prefersReducedMotion() || typeof e.animate !== 'function') return;
  e.animate([{ opacity: 0, transform: 'translateY(6px) scale(0.985)' }, { opacity: 1, transform: 'none' }], { duration: ms, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
}

/** Fade out then remove. */
export function fadeOutAndRemove(e: HTMLElement, ms = 200) {
  if (prefersReducedMotion() || typeof e.animate !== 'function') { e.remove(); return; }
  const a = e.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: 'ease-in' });
  a.onfinish = () => e.remove();
}
