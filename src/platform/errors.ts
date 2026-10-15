/**
 * Error resilience: global error capture with a ring buffer, non-fatal toasts, a guarded main
 * loop that degrades into a polished "Something went wrong" screen, and copyable error reports.
 *
 *   installErrorBoundary({ onReturnToMenu, getContext })   // once, at boot
 *   const frame = guardFrame((t) => game.frame(t), { onFatal: () => game.stop() });
 *   requestAnimationFrame(function loop(t) { requestAnimationFrame(loop); frame(t); });
 */
import { GAME_TITLE, VERSION } from '../config';
import { getGpuInfo } from './gpu';
import {
  ACCENT_RGB, DANGER_RGB, FONT, MONO, Z_TOP, backdrop, button, buttonRow, codeBox, css, emblem, fadeIn, fadeOutAndRemove,
  glassPanel, h, paragraph, title,
} from './ui';

export type ErrorKind = 'error' | 'rejection' | 'frame' | 'manual';

export interface ErrorRecord {
  /** Date.now() of the first occurrence. */
  time: number;
  /** Date.now() of the latest repeat. */
  last: number;
  kind: ErrorKind;
  name: string;
  message: string;
  stack: string;
  /** script URL:line:col for window.onerror events. */
  source?: string;
  /** Consecutive identical errors are folded into one record. */
  count: number;
}

export interface ErrorBoundaryOptions {
  /** Ring buffer size (default 50). */
  capacity?: number;
  /** Show small toasts for recoverable errors (default true). */
  toasts?: boolean;
  /** Called by the fatal screen's "Return to menu" button (button hidden if absent). */
  onReturnToMenu?: () => void;
  /** Extra diagnostics for reports, e.g. () => ({ tick: world.tick, seed }). */
  getContext?: () => Record<string, unknown>;
  /** The game's GL context, so reports use it instead of probing a new one. */
  getGl?: () => WebGLRenderingContext | WebGL2RenderingContext | null | undefined;
  /** Messages to ignore entirely (noise from extensions, benign browser warnings). */
  ignore?: (string | RegExp)[];
}

export interface ErrorBoundary {
  /** Most recent first. */
  recent(): ErrorRecord[];
  record(err: unknown, kind?: ErrorKind): ErrorRecord | null;
  report(): string;
  showFatal(err?: unknown): void;
  dismissFatal(): void;
  uninstall(): void;
}

const DEFAULT_IGNORE: (string | RegExp)[] = [
  /ResizeObserver loop (limit exceeded|completed with undelivered notifications)/i,
  /^Script error\.?$/i, // opaque cross-origin error without details
  /chrome-extension:|moz-extension:|safari-extension:/i,
  /The play\(\) request was interrupted/i,
  /AbortError: The user aborted a request/i,
];

// ---------------------------------------------------------------------------
// State (module singleton: there is one page and one boundary)
// ---------------------------------------------------------------------------

let opts: ErrorBoundaryOptions = {};
let installed = false;
const ring: ErrorRecord[] = [];
let fatalEl: HTMLElement | null = null;
let fatalResetHooks: (() => void)[] = [];
let toastEl: HTMLElement | null = null;
let toastTimer = 0;
let toastCount = 0;
let lastToastKey = '';

function normalize(err: unknown): { name: string; message: string; stack: string } {
  if (err instanceof Error) return { name: err.name || 'Error', message: err.message || String(err), stack: err.stack ?? '' };
  if (err && typeof err === 'object') {
    const o = err as { name?: unknown; message?: unknown; stack?: unknown; reason?: unknown };
    if (o.message !== undefined) return { name: String(o.name ?? 'Error'), message: String(o.message), stack: String(o.stack ?? '') };
    try { return { name: 'Error', message: JSON.stringify(err).slice(0, 500), stack: '' }; } catch { /* circular */ }
  }
  return { name: 'Error', message: String(err), stack: '' };
}

function ignored(message: string, source = ''): boolean {
  const list = [...DEFAULT_IGNORE, ...(opts.ignore ?? [])];
  return list.some((p) => (typeof p === 'string' ? message.includes(p) || source.includes(p) : p.test(message) || p.test(source)));
}

/** Store an error in the ring buffer (folding consecutive repeats). Returns null if ignored. */
export function recordError(err: unknown, kind: ErrorKind = 'manual', source?: string): ErrorRecord | null {
  const n = normalize(err);
  if (ignored(n.message, source ?? n.stack)) return null;
  const now = Date.now();
  const head = ring[ring.length - 1];
  if (head && head.message === n.message && head.stack === n.stack && head.kind === kind) {
    head.count++;
    head.last = now;
    return head;
  }
  const rec: ErrorRecord = { time: now, last: now, kind, name: n.name, message: n.message, stack: n.stack, source, count: 1 };
  ring.push(rec);
  const cap = Math.max(5, opts.capacity ?? 50);
  while (ring.length > cap) ring.shift();
  return rec;
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

const pad = (s: string, n = 13) => (s + ':').padEnd(n);

/** Plain-text report for bug trackers: environment, GPU, context and the recent error stacks. */
export function buildErrorReport(): string {
  const lines: string[] = [];
  const nav = (typeof navigator !== 'undefined' ? navigator : {}) as Navigator & { deviceMemory?: number };
  let gpu = { vendor: '?', renderer: '?', webgl2: false, maxTextureSize: 0 };
  try {
    const gl = opts.getGl?.();
    gpu = gl && !gl.isContextLost() ? getGpuInfo(gl) : getGpuInfo();
  } catch { /* ignore */ }
  lines.push(`${GAME_TITLE} error report`, '='.repeat(GAME_TITLE.length + 13));
  lines.push(`${pad('Version')}${VERSION}${typeof import.meta !== 'undefined' && import.meta.env?.PROD === false ? ' (dev)' : ''}`);
  lines.push(`${pad('Time')}${new Date().toISOString()}`);
  if (typeof location !== 'undefined') lines.push(`${pad('URL')}${location.href}`);
  lines.push(`${pad('User agent')}${nav.userAgent ?? '?'}`);
  lines.push(`${pad('GPU')}${gpu.renderer || '?'}${gpu.vendor ? `  (vendor: ${gpu.vendor})` : ''}`);
  lines.push(`${pad('WebGL')}${gpu.webgl2 ? 'WebGL2' : 'no WebGL2'}, max texture ${gpu.maxTextureSize}`);
  if (typeof screen !== 'undefined') {
    lines.push(`${pad('Screen')}${screen.width}x${screen.height} @${typeof devicePixelRatio === 'number' ? devicePixelRatio : 1}x, window ${innerWidth}x${innerHeight}`);
  }
  lines.push(`${pad('Device')}${nav.hardwareConcurrency ?? '?'} threads, ${nav.deviceMemory ?? '?'} GB, ${nav.language ?? ''}`);
  try {
    const ctx = opts.getContext?.();
    if (ctx && Object.keys(ctx).length) lines.push(`${pad('Context')}${JSON.stringify(ctx)}`);
  } catch (e) { lines.push(`${pad('Context')}<getContext failed: ${normalize(e).message}>`); }
  lines.push('', 'Recent errors (newest first)', '----------------------------');
  if (!ring.length) lines.push('(none recorded)');
  for (const r of [...ring].reverse()) {
    const t = new Date(r.time).toISOString().slice(11, 23);
    lines.push(`[${t}] ${r.kind}${r.count > 1 ? ` x${r.count}` : ''}  ${r.name}: ${r.message}`);
    if (r.source) lines.push(`    at ${r.source}`);
    const stack = r.stack.split('\n').filter((l) => !l.includes(r.message)).slice(0, 12);
    for (const l of stack) lines.push(`    ${l.trim()}`);
  }
  return lines.join('\n');
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through */ }
  try {
    const ta = h('textarea', { position: 'fixed', left: '-9999px', top: '0', opacity: '0' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

// ---------------------------------------------------------------------------
// Non-fatal toast
// ---------------------------------------------------------------------------

/** Small, throttled, self-dismissing notice for errors the game survived. */
export function showErrorToast(message: string) {
  if (typeof document === 'undefined' || opts.toasts === false || fatalEl) return;
  const key = message.slice(0, 120);
  if (toastEl && toastEl.isConnected) {
    toastCount = key === lastToastKey ? toastCount + 1 : 1;
    lastToastKey = key;
    const msg = toastEl.querySelector('[data-msg]') as HTMLElement;
    const cnt = toastEl.querySelector('[data-count]') as HTMLElement;
    msg.textContent = message;
    cnt.textContent = toastCount > 1 ? `x${toastCount}` : '';
    cnt.style.display = toastCount > 1 ? 'inline-block' : 'none';
  } else {
    toastCount = 1;
    lastToastKey = key;
    const icon = h('div', {
      width: '1.7rem', height: '1.7rem', borderRadius: '0.4rem', flexShrink: '0', display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: `rgb(${ACCENT_RGB})`, background: `rgba(${ACCENT_RGB}, 0.16)`, boxShadow: `inset 0 0 0 1px rgba(${ACCENT_RGB}, 0.32)`,
      fontWeight: '700', fontSize: '1rem',
    }, ['!']);
    const text = h('div', { minWidth: '0', flex: '1' }, [
      h('div', { fontSize: '0.78rem', fontWeight: '700', letterSpacing: '0.14em', textTransform: 'uppercase', color: '#f3f7fb' }, ['Recovered from an error']),
      h('div', { fontFamily: MONO, fontSize: '0.72rem', color: '#9fb3c8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, [message], { 'data-msg': '' }),
    ]);
    const count = h('span', {
      display: 'none', fontFamily: MONO, fontSize: '0.74rem', color: `rgb(${ACCENT_RGB})`, padding: '0.05rem 0.3rem', borderRadius: '0.3rem',
      border: `1px solid rgba(${ACCENT_RGB}, 0.35)`, background: `rgba(${ACCENT_RGB}, 0.12)`,
    }, [], { 'data-count': '' });
    toastEl = h('div', {
      position: 'fixed', left: '50%', top: '0.9rem', transform: 'translateX(-50%)', zIndex: String(Z_TOP - 1), maxWidth: 'min(30rem, 92vw)',
      display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.5rem 0.75rem 0.5rem 0.5rem', borderRadius: '0.6rem', cursor: 'pointer',
      fontFamily: FONT, background: `linear-gradient(90deg, rgba(${ACCENT_RGB}, 0.18), rgba(10, 14, 20, 0.92) 45%), rgba(10, 14, 20, 0.7)`,
      border: `1px solid rgba(${ACCENT_RGB}, 0.4)`, boxShadow: `0 0.5rem 1.4rem rgba(0, 0, 0, 0.45), inset 3px 0 0 rgb(${ACCENT_RGB})`,
      backdropFilter: 'blur(8px)', pointerEvents: 'auto',
    } as Record<string, string>, [icon, text, count], { role: 'status', 'aria-live': 'polite', title: 'Click to dismiss' });
    toastEl.addEventListener('click', () => hideToast());
    document.body.append(toastEl);
    fadeIn(toastEl);
  }
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(hideToast, 5000);
}

function hideToast() {
  clearTimeout(toastTimer);
  if (toastEl) fadeOutAndRemove(toastEl);
  toastEl = null;
}

// ---------------------------------------------------------------------------
// Fatal overlay
// ---------------------------------------------------------------------------

/** Show the "Something went wrong" screen (idempotent). */
export function showFatalError(err?: unknown) {
  if (typeof document === 'undefined') return;
  if (err !== undefined) recordError(err, 'manual');
  if (fatalEl?.isConnected) return;
  hideToast();
  const latest = ring[ring.length - 1];
  const summary = latest
    ? `${latest.name}: ${latest.message}${latest.count > 1 ? `  (x${latest.count})` : ''}\n${latest.stack.split('\n').filter((l) => !l.includes(latest.message)).slice(0, 5).map((l) => '  ' + l.trim()).join('\n')}`
    : 'Unknown error';

  const root = backdrop(Z_TOP);
  root.setAttribute('role', 'alertdialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'rh-fatal-title');
  const panel = glassPanel(ACCENT_RGB, '36rem');
  const head = h('div', { display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.9rem' });
  const t = title('Something went wrong');
  t.id = 'rh-fatal-title';
  head.append(emblem('3.2rem'), h('div', {}, [
    t,
    h('div', { fontFamily: MONO, fontSize: '0.74rem', letterSpacing: '0.08em', color: `rgba(${DANGER_RGB}, 0.9)`, textTransform: 'uppercase' }, ['Simulation halted']),
  ]));
  panel.append(head);
  panel.append(paragraph('The game hit an unexpected error and stopped to protect your session. You can return to the main menu, reload the page, or copy a report for the developers.'));
  panel.append(codeBox(summary));

  const status = h('div', { minHeight: '1.1rem', marginTop: '0.75rem', fontFamily: MONO, fontSize: '0.74rem', color: '#7d8c9d' });
  const buttons: HTMLElement[] = [];
  if (opts.onReturnToMenu) {
    buttons.push(button('Return to menu', () => {
      dismissFatalError();
      try { opts.onReturnToMenu?.(); } catch (e) { recordError(e, 'manual'); showFatalError(); }
    }, 'primary'));
  }
  buttons.push(button('Reload', () => location.reload(), opts.onReturnToMenu ? 'ghost' : 'primary'));
  const copyBtn = button('Copy error report', async () => {
    const ok = await copyText(buildErrorReport());
    copyBtn.textContent = ok ? 'Copied ✓' : 'Copy failed';
    status.textContent = ok ? 'Report copied to the clipboard — paste it into a bug report.' : 'Clipboard unavailable: the report was printed to the browser console.';
    if (!ok) console.error(buildErrorReport());
    setTimeout(() => { copyBtn.textContent = 'Copy error report'; }, 2500);
  });
  buttons.push(copyBtn);
  panel.append(buttonRow(buttons), status);
  panel.append(h('div', {
    marginTop: '0.4rem', paddingTop: '0.7rem', borderTop: '1px solid rgba(255, 255, 255, 0.07)',
    fontFamily: MONO, fontSize: '0.68rem', color: '#556270', display: 'flex', justifyContent: 'space-between', gap: '1rem',
  }, [h('span', {}, [`${GAME_TITLE} v${VERSION}`]), h('span', {}, [`${ring.reduce((n, r) => n + r.count, 0)} error(s) logged`])]));
  root.append(panel);
  // swallow input so the (possibly half-broken) game underneath can't be clicked
  for (const ev of ['pointerdown', 'mousedown', 'wheel', 'contextmenu', 'keydown'] as const) {
    root.addEventListener(ev, (e) => { if (ev !== 'keydown' || (e as KeyboardEvent).key !== 'Tab') e.stopPropagation(); });
  }
  document.body.append(root);
  fatalEl = root;
  fadeIn(panel, 260);
  (buttons[0] as HTMLButtonElement).focus({ preventScroll: true });
}

export function dismissFatalError() {
  if (fatalEl) fatalEl.remove();
  fatalEl = null;
  const hooks = fatalResetHooks;
  fatalResetHooks = [];
  for (const fn of hooks) fn();
}

export const isFatalShown = () => !!fatalEl?.isConnected;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function onWindowError(e: ErrorEvent) {
  const src = e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : undefined;
  const rec = recordError(e.error ?? e.message, 'error', src);
  if (rec) showErrorToast(rec.message);
}

function onRejection(e: PromiseRejectionEvent) {
  const rec = recordError(e.reason, 'rejection');
  if (rec) showErrorToast(rec.message);
}

/**
 * Capture window errors and unhandled promise rejections. Safe to call more than once (the
 * options are merged). Returns a handle for reports and tests.
 */
export function installErrorBoundary(options: ErrorBoundaryOptions = {}): ErrorBoundary {
  opts = { ...opts, ...options };
  if (!installed && typeof window !== 'undefined') {
    window.addEventListener('error', onWindowError);
    window.addEventListener('unhandledrejection', onRejection);
    installed = true;
  }
  return {
    recent: () => [...ring].reverse(),
    record: (err, kind = 'manual') => recordError(err, kind),
    report: buildErrorReport,
    showFatal: showFatalError,
    dismissFatal: dismissFatalError,
    uninstall() {
      window.removeEventListener('error', onWindowError);
      window.removeEventListener('unhandledrejection', onRejection);
      installed = false;
      hideToast();
      dismissFatalError();
    },
  };
}

/** Log an error you caught yourself; `fatal` shows the error screen, otherwise a toast. */
export function reportError(err: unknown, fatal = false) {
  const rec = recordError(err, 'manual');
  console.error(err);
  if (fatal) showFatalError();
  else if (rec) showErrorToast(rec.message);
}

export interface GuardOptions {
  /** Errors within `windowMs` that make the failure fatal (default 5). */
  maxErrors?: number;
  /** Sliding window in ms (default 2000). */
  windowMs?: number;
  /** Called once when the loop is declared dead (stop audio, pause the sim, ...). */
  onFatal?: (err: unknown) => void;
}

export type Guarded<A extends unknown[]> = ((...args: A) => void) & {
  /** Re-arm after a fatal stop (done automatically by "Return to menu"). */
  reset(): void;
  readonly dead: boolean;
};

/**
 * Wrap a per-frame callback. A throwing frame is logged and toasted and the loop carries on;
 * `maxErrors` throws within `windowMs` stop calling `fn` and show the fatal overlay.
 */
export function guardFrame<A extends unknown[]>(fn: (...args: A) => void, options: GuardOptions = {}): Guarded<A> {
  const max = Math.max(1, options.maxErrors ?? 5);
  const windowMs = options.windowMs ?? 2000;
  const times: number[] = [];
  let dead = false;
  const reset = () => { dead = false; times.length = 0; };
  const wrapped = ((...args: A) => {
    if (dead) return;
    try {
      fn(...args);
    } catch (e) {
      const rec = recordError(e, 'frame');
      const now = performance.now();
      times.push(now);
      while (times.length && now - times[0] > windowMs) times.shift();
      if (times.length >= max) {
        dead = true;
        console.error('[guardFrame] main loop failed repeatedly, stopping', e);
        try { options.onFatal?.(e); } catch (e2) { recordError(e2, 'manual'); }
        fatalResetHooks.push(reset);
        showFatalError();
      } else {
        if (times.length === 1) console.error('[guardFrame] frame error', e);
        if (rec) showErrorToast(rec.message);
      }
    }
  }) as Guarded<A>;
  Object.defineProperty(wrapped, 'dead', { get: () => dead });
  wrapped.reset = reset;
  return wrapped;
}
