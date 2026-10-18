/**
 * Subtitles: captions for spoken lines (the announcer), bottom-centre on a semi-opaque band, sized by the
 * Subtitle size setting. Off: the caller shows the line as a regular notification instead.
 *
 *   if (!showSubtitle(text, { warn })) hud.message(text, warn);
 */
import { SUB_TEXT } from './a11y-strings';
import { srAnnounce, subtitlesEnabled } from './a11y';
import { trSource } from '../i18n/core';
import tSpeech from '../i18n/en/speech';

interface Line { el: HTMLElement; text: string; timer: number }

let box: HTMLElement | null = null;
const lines: Line[] = [];
const MAX_LINES = 2;

const CSS = `
#rh-subs { position: fixed; left: 50%; transform: translateX(-50%); bottom: 3.2rem; z-index: 60; width: max-content; max-width: min(60rem, 92vw);
  display: flex; flex-direction: column; align-items: center; gap: 0.3rem; pointer-events: none; }
body.hud-modern #rh-subs { bottom: calc(var(--dock-h, 12rem) + 1.6rem); }
body:not(.hud-modern) #rh-subs { left: calc(50% - var(--sidebar-w, 0px) / 2); }
body.photo-mode #rh-subs { opacity: 0; }
.rh-sub { font-family: var(--font, sans-serif); font-size: var(--sub-rem, 1.1rem); line-height: 1.35; color: #fff; text-align: center;
  background: rgba(0, 0, 0, 0.74); padding: 0.22em 0.75em 0.26em; border-radius: 0.3em; text-shadow: 0 1px 2px #000;
  transition: opacity 0.3s; animation: rhSubIn 0.18s ease-out; }
.rh-sub b { color: #ffd34d; font-weight: 700; margin-right: 0.55em; letter-spacing: 0.08em; text-transform: uppercase; font-size: 0.74em; }
.rh-sub.warn b { color: #ff9a7a; }
.rh-sub.out { opacity: 0; }
@keyframes rhSubIn { from { opacity: 0; transform: translateY(0.3em); } to { opacity: 1; transform: none; } }
body.reduce-motion .rh-sub { animation: none; }
`;

function ensureBox(): HTMLElement {
  if (box && box.isConnected) return box;
  if (!document.getElementById('rh-subs-style')) {
    const st = document.createElement('style');
    st.id = 'rh-subs-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  box = document.createElement('div');
  box.id = 'rh-subs';
  box.setAttribute('role', 'log');
  box.setAttribute('aria-label', SUB_TEXT.region);
  box.setAttribute('aria-live', 'off'); // read out through the shared live region (one voice for every caption source)
  document.body.appendChild(box);
  return box;
}

function drop(l: Line) {
  window.clearTimeout(l.timer);
  const i = lines.indexOf(l);
  if (i >= 0) lines.splice(i, 1);
  l.el.classList.add('out');
  window.setTimeout(() => l.el.remove(), 320);
}

/**
 * Caption a spoken line. Returns false when subtitles are off (or there is no page), so the caller can fall
 * back to a notification. English from a registered source (the announcer's lines, src/i18n/en/speech.ts) is
 * shown in the interface language; the speech stays English.
 */
export function showSubtitle(text: string, o: { speaker?: string; warn?: boolean } = {}): boolean {
  if (!subtitlesEnabled() || typeof document === 'undefined' || !document.body) return false;
  const t = trSource(String(text).trim());
  if (!t) return true;
  const host = ensureBox();
  const life = Math.max(3000, 2200 + t.length * 60);
  const same = lines.find((l) => l.text === t);
  if (same) { // a repeat: keep the line up longer instead of stacking it
    window.clearTimeout(same.timer);
    same.timer = window.setTimeout(() => drop(same), life);
    return true;
  }
  const speaker = o.speaker ?? SUB_TEXT.announcer;
  const el = document.createElement('div');
  el.className = 'rh-sub' + (o.warn ? ' warn' : '');
  const b = document.createElement('b');
  b.textContent = speaker;
  el.append(b, document.createTextNode(t));
  host.appendChild(el);
  const line: Line = { el, text: t, timer: 0 };
  line.timer = window.setTimeout(() => drop(line), life);
  lines.push(line);
  while (lines.length > MAX_LINES) drop(lines[0]);
  srAnnounce(tSpeech('srLine', { speaker, text: t }));
  return true;
}

/** Remove every caption (end of a match). */
export function clearSubtitles() {
  while (lines.length) drop(lines[0]);
}
