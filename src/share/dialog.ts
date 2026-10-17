/**
 * Share dialogs: "Copy link" (a link to the map / challenge / replay, copied at once, with the system share
 * sheet where there is one) and the shared modal frame the import confirmation (open.ts) and the clip
 * recorder (ui/clips.ts) use. Every dynamic string is escaped; shared content never becomes markup.
 */
import { el, esc } from '../ui/dom';
import { ICONS } from '../ui/icons';
import { ensureModesCss } from '../ui/modes-css';
import { KIND_LABEL } from './content';
import { canShareLink, copyToClipboard, makeShareLink, shareLinkNatively } from './links';
import { SHARE_LIMITS, type ShareKind } from './codec';

const s = (body: string) =>
  `<svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

/** Icons for sharing (same style as ui/icons.ts). */
export const SHARE_ICONS = {
  link: s('<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3.2-3.2a4.5 4.5 0 0 0-6.4-6.4L11.8 5.8"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3.2 3.2a4.5 4.5 0 0 0 6.4 6.4l1.4-1.4"/>'),
  share: s('<circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="M8.2 10.8l7.6-4.1M8.2 13.2l7.6 4.1"/>'),
  record: s('<rect x="2.5" y="6" width="13" height="12" rx="2"/><path d="M15.5 10.5l6-3.5v10l-6-3.5z"/><circle cx="9" cy="12" r="2.2" fill="currentColor" stroke="none"/>'),
  lock: s('<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>'),
};

const CSS = `
.sh-overlay { z-index: 95; }
.sh-panel { width: min(36rem, 94vw); }
.sh-url { display: flex; gap: .5rem; align-items: stretch; }
.sh-url input { flex: 1; min-width: 0; height: 2.6rem; font-family: var(--mono, monospace); font-size: .78rem; color: #cfe3ff; background: rgba(0,0,0,.45);
  border: 1px solid var(--line-2); border-radius: .5rem; padding: 0 .7rem; }
.sh-url input:focus { outline: none; border-color: rgba(var(--accent-rgb), .8); }
.sh-meter { display: flex; align-items: center; gap: .55rem; margin-top: .55rem; font-size: .74rem; color: var(--text-2); }
.sh-meter .bar { flex: 1; height: .35rem; border-radius: 1rem; background: rgba(255,255,255,.08); overflow: hidden; }
.sh-meter .bar i { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #3ec46d, #c8e04a); }
.sh-meter.browser .bar i { background: linear-gradient(90deg, #e0b030, #ff9a3a); }
.sh-meter.too-long .bar i { background: linear-gradient(90deg, #ff6a4a, #ff3a2a); }
.sh-meter b { font-family: var(--mono, monospace); color: #fff; font-weight: 400; }
.sh-priv { display: flex; gap: .55rem; align-items: flex-start; margin-top: .9rem; padding: .6rem .75rem; border-radius: .6rem; border: 1px solid rgba(120, 200, 140, .22);
  background: rgba(60, 160, 90, .08); font-size: .76rem; line-height: 1.4; color: var(--text-2); }
.sh-priv .ic { flex-shrink: 0; font-size: 1rem; color: #8de0a4; margin-top: .05rem; }
.sh-facts { display: flex; flex-wrap: wrap; gap: .35rem; margin-top: .4rem; }
.sh-facts span { font-size: .72rem; letter-spacing: .06em; padding: .2rem .55rem; border-radius: 1rem; background: rgba(255,255,255,.06); border: 1px solid var(--line); color: var(--text-2); }
.sh-status { min-height: 1.2em; margin-top: .55rem; font-size: .78rem; color: #8de0a4; }
.sh-status.bad { color: #ff8a7a; }
.sh-panel .mx-actions { flex-wrap: wrap; }
`;

function ensureCss() {
  ensureModesCss();
  if (document.getElementById('share-css')) return;
  const st = document.createElement('style');
  st.id = 'share-css';
  st.textContent = CSS;
  document.head.appendChild(st);
}

export interface Modal {
  overlay: HTMLElement;
  panel: HTMLElement;
  close(): void;
  /** Called once when the modal closes (any way). */
  onClose(fn: () => void): void;
  /** Move keyboard focus to the main action (after the body is filled). */
  focus(): void;
}

/** A modal panel in the game's style (Esc / click outside closes unless `sticky`). */
export function openModal(icon: string, kicker: string, title: string, opts: { sticky?: boolean; cls?: string } = {}): Modal {
  ensureCss();
  const ov = el('div', 'mx-overlay sh-overlay');
  const panel = el('div', `mx-panel panel sh-panel ${opts.cls ?? ''}`);
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.innerHTML = `<div class="mx-head"><span class="mx-ic">${icon}</span><div><small>${esc(kicker)}</small><h2>${esc(title)}</h2></div>
    <button class="mx-x" data-a="close" title="Close (Esc)" aria-label="Close">${ICONS.close}</button></div><div class="sh-body"></div>`;
  ov.appendChild(panel);
  document.body.appendChild(ov);
  const handlers: (() => void)[] = [];
  let closed = false;
  const keys = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape' && !opts.sticky) { e.preventDefault(); close(); }
  };
  window.addEventListener('keydown', keys, true);
  const close = () => {
    if (closed) return;
    closed = true;
    window.removeEventListener('keydown', keys, true);
    ov.classList.add('leaving');
    setTimeout(() => ov.remove(), 220);
    for (const h of handlers) { try { h(); } catch { /* ignore */ } }
  };
  ov.addEventListener('pointerdown', (e) => { if (e.target === ov && !opts.sticky) close(); });
  (panel.querySelector('[data-a="close"]') as HTMLElement).onclick = () => close();
  return { overlay: ov, panel, close, onClose: (fn) => handlers.push(fn), focus: () => (panel.querySelector<HTMLElement>('.sh-body .btn-primary') ?? panel.querySelector<HTMLElement>('.sh-body button'))?.focus({ preventScroll: true }) };
}

export interface ShareRequest {
  kind: ShareKind;
  /** Display title (escaped here). */
  title: string;
  /** The document to share (see content.ts). */
  data: unknown;
  /** Download the same content as a file (the fallback when the link is too long). */
  exportFile(): void;
  /** UI sound. */
  play?(k: 'click' | 'ready_ping'): void;
}

/**
 * "Copy link": encode, copy at once (still inside the click), and show the link with its reach (chat apps /
 * browsers / too long → file). Returns the modal.
 */
export async function openShareDialog(req: ShareRequest): Promise<Modal> {
  const label = KIND_LABEL[req.kind];
  const m = openModal(SHARE_ICONS.link, `Share ${label.toLowerCase()}`, req.title || label);
  const body = m.panel.querySelector('.sh-body') as HTMLElement;
  body.innerHTML = `<div class="mx-note">Preparing the link…</div>`;
  const link = await makeShareLink(req.kind, req.title, req.data);
  const pct = Math.min(100, (link.chars / SHARE_LIMITS.maxFragmentChars) * 100);
  const reachText = link.problem === 'unsupported' ? 'This browser cannot build share links.'
    : link.problem === 'no-address' ? 'This copy of the game has no public web address to link to.'
    : link.reach === 'too-long' ? `Too long for a link (${link.chars.toLocaleString('en-US')} characters; links hold up to ${SHARE_LIMITS.maxFragmentChars.toLocaleString('en-US')}).`
    : link.reach === 'chat' ? 'Short enough for Discord, WhatsApp, X and email.'
    : 'Works in WhatsApp, email and browsers; too long for a Discord message.';
  const fallback = !link.url;
  body.innerHTML = `
    ${link.url ? `<div class="sh-url"><input readonly spellcheck="false" aria-label="Share link" value="${esc(link.url)}"></div>` : ''}
    <div class="sh-meter ${link.reach}"><span class="bar"><i style="width:${pct.toFixed(1)}%"></i></span><span>${link.chars ? `<b>${link.chars.toLocaleString('en-US')}</b> chars` : ''}</span></div>
    <div class="mx-note${fallback ? ' bad' : ''}" style="margin-top:.45rem">${esc(reachText)}${fallback ? ' Download the file instead and send it as an attachment: it opens with Import.' : ''}</div>
    <div class="sh-status" role="status" aria-live="polite"></div>
    <div class="mx-actions">
      ${link.url ? `<button class="btn-primary" data-a="copy">${ICONS.copy}<span>Copy link</span></button>` : ''}
      ${link.url && canShareLink() ? `<button class="btn" data-a="native">${SHARE_ICONS.share}<span>Share…</span></button>` : ''}
      <button class="${fallback ? 'btn-primary' : 'btn'}" data-a="file">${ICONS.download}<span>Download file</span></button>
    </div>
    <div class="sh-priv">${SHARE_ICONS.lock}<span>Everything is inside the link, after the <b>#</b>: browsers never send that part to any server, and nothing is uploaded. Whoever opens it is asked before anything is imported.</span></div>`;
  const status = body.querySelector('.sh-status') as HTMLElement;
  const say = (t: string, bad = false) => { status.textContent = t; status.classList.toggle('bad', bad); };
  const input = body.querySelector('input');
  if (input) input.onfocus = () => input.select();
  const copy = async (quiet = false) => {
    if (!link.url) return;
    const ok = await copyToClipboard(link.url);
    if (ok) { req.play?.('ready_ping'); say('Link copied to the clipboard.'); } else if (!quiet) { input?.focus(); input?.select(); say('Copy blocked by the browser: the link is selected, press Ctrl+C.', true); }
  };
  const btn = (a: string) => body.querySelector<HTMLElement>(`[data-a="${a}"]`);
  const c = btn('copy');
  if (c) c.onclick = () => void copy();
  const n = btn('native');
  if (n) n.onclick = () => void shareLinkNatively(`Red Horizon: ${req.title}`, `${label} for Red Horizon: ${req.title}`, link.url!);
  btn('file')!.onclick = () => { req.exportFile(); say('File downloaded.'); };
  if (link.url) void copy(true); // still inside the click's user activation in most browsers (quiet if refused)
  m.focus();
  return m;
}
