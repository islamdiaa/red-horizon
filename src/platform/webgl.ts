/**
 * WebGL resilience: up-front capability check with a friendly "unsupported browser" screen,
 * and GPU context-loss handling with a "Graphics device reset" overlay.
 *
 * three.js r186 notes (WebGLRenderer.js onContextLost / onContextRestore):
 *  - On `webglcontextlost` three calls preventDefault() (so the browser may restore the context)
 *    and sets an internal flag that turns render() into a no-op.
 *  - On `webglcontextrestored` it re-runs initGLContext(): new WebGLState, WebGLProperties,
 *    WebGLTextures, geometries, program cache, WebGLInfo and WebGLBackground. Every buffer,
 *    texture and shader is lazily re-uploaded / recompiled from its CPU-side copy on the next
 *    render. It preserves info.autoReset and the shadowMap flags, but NOT the clear colour, and
 *    render-target *contents* come back empty. Anything rendered once into a render target (the
 *    PMREM environment map from RoomEnvironment in render/renderer.ts) must be re-baked.
 */
import { GAME_TITLE } from '../config';
import { classifyGpu, readGpuStrings } from './gpu';
import {
  ACCENT_RGB, DANGER_RGB, FONT, MONO, Z_TOP, backdrop, button, buttonRow, codeBox, emblem, fadeIn, fadeOutAndRemove, glassPanel,
  h, paragraph, spinner, title,
} from './ui';
import tErrors from '../i18n/en/errors';

export type UnsupportedReason = 'no-webgl' | 'webgl1-only' | 'context-failed' | 'missing-feature';

export interface SupportResult {
  ok: boolean;
  /** Set when !ok. */
  reason?: UnsupportedReason;
  /** One-line human explanation. */
  message: string;
  /** Technical detail for the "details" section. */
  detail: string;
  /** Non-fatal problems (performance caveat, missing optional extensions...). */
  warnings: string[];
  renderer?: string;
  /** The browser refused a context with failIfMajorPerformanceCaveat (software rendering or a blocklisted driver). */
  caveat?: boolean;
}

/** Minimum limits the renderer relies on (shadow maps, post-processing targets, model textures). */
const MIN_TEXTURE_SIZE = 4096;
const MIN_RENDERBUFFER_SIZE = 4096;
const MIN_TEXTURE_UNITS = 16;

/**
 * Detect WebGL2 and the features the game needs. Creates and immediately releases a 1x1 context.
 * Call before constructing the game; on failure call renderUnsupported(result).
 */
export function checkSupport(): SupportResult {
  const warnings: string[] = [];
  if (typeof document === 'undefined') return { ok: false, reason: 'no-webgl', message: 'No document', detail: '', warnings };
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  let gl: WebGL2RenderingContext | null = null;
  let creationError = '';
  let caveat = false;
  const onErr = (e: Event) => { creationError = (e as WebGLContextEvent).statusMessage || creationError; };
  canvas.addEventListener('webglcontextcreationerror', onErr);
  try {
    gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: true });
    if (!gl) {
      gl = canvas.getContext('webgl2');
      caveat = !!gl;
      if (gl) warnings.push('The browser reports a major performance caveat (software rendering or a blocklisted GPU driver): expect a low frame rate.');
    }
  } catch (e) {
    creationError = (e as Error).message;
  }
  canvas.removeEventListener('webglcontextcreationerror', onErr);

  if (!gl) {
    if (typeof WebGL2RenderingContext === 'undefined') {
      const c1 = document.createElement('canvas');
      const has1 = !!(c1.getContext('webgl') || c1.getContext('experimental-webgl'));
      return has1
        ? { ok: false, reason: 'webgl1-only', message: tErrors('unsupported.webgl1', { game: GAME_TITLE }), detail: 'WebGL2RenderingContext is not defined.', warnings }
        : { ok: false, reason: 'no-webgl', message: tErrors('unsupported.noWebgl', { game: GAME_TITLE }), detail: 'No WebGL implementation.', warnings };
    }
    return {
      ok: false, reason: 'context-failed',
      message: tErrors('unsupported.contextFailed'),
      detail: creationError || 'getContext("webgl2") returned null.', warnings,
    };
  }

  const { renderer } = readGpuStrings(gl);
  const missing: string[] = [];
  const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  const maxRb = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number;
  const units = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) as number;
  if (maxTex < MIN_TEXTURE_SIZE) missing.push(`MAX_TEXTURE_SIZE ${maxTex} < ${MIN_TEXTURE_SIZE}`);
  if (maxRb < MIN_RENDERBUFFER_SIZE) missing.push(`MAX_RENDERBUFFER_SIZE ${maxRb} < ${MIN_RENDERBUFFER_SIZE}`);
  if (units < MIN_TEXTURE_UNITS) missing.push(`MAX_TEXTURE_IMAGE_UNITS ${units} < ${MIN_TEXTURE_UNITS}`);
  // post-processing renders into RGBA16F targets (HalfFloatType): needs a colour-renderable float format
  if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float')) {
    warnings.push('Float render targets are not supported (EXT_color_buffer_float): post-processing may render black.');
  }
  if (!gl.getExtension('OES_texture_float_linear')) warnings.push('OES_texture_float_linear missing: some effects will be blockier.');
  try { gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* ignore */ }

  const detail = `${renderer || 'unknown GPU'}; max texture ${maxTex}, renderbuffer ${maxRb}, texture units ${units}`;
  if (missing.length) {
    return { ok: false, reason: 'missing-feature', message: tErrors('unsupported.missingFeature', { game: GAME_TITLE }), detail: `${missing.join('; ')} (${detail})`, warnings, renderer };
  }
  return { ok: true, message: 'WebGL 2 available', detail, warnings, renderer, caveat };
}

/**
 * WebGL 2 works, but without the graphics card: a software rasteriser (SwiftShader, llvmpipe, Windows' Basic Render
 * Driver) or a context the browser flags with a major performance caveat (hardware acceleration off, a blocklisted
 * driver). The game then runs at a few frames per second at best, and its clock with it.
 */
export function isSlowRenderer(s: SupportResult): boolean {
  if (!s.ok) return false;
  return !!s.caveat || (!!s.renderer && classifyGpu(s.renderer).tier === 'software');
}

const SLOW_NOTICE_KEY = 'rh.slowGpuNotice';

/**
 * Tell a player whose browser draws in software why the game is slow and how to fix it: a dismissible banner over
 * the loading screen and the menus, shown until dismissed for this renderer (a new driver or browser shows it again).
 * It steps aside while a battle runs (it never covers the HUD) and comes back in the menus. Automated browsers
 * (navigator.webdriver: the test bots, which run on software GPUs) don't get it unless the URL asks for it
 * (?slowgpu=1, which also shows it on a fast GPU; a dismissal still counts). Returns the banner, or null when none is shown.
 */
export function showSlowRendererNotice(s: SupportResult, parent: HTMLElement = document.body): HTMLElement | null {
  const forced = typeof location !== 'undefined' && new URLSearchParams(location.search).get('slowgpu') === '1';
  if (!forced && (!isSlowRenderer(s) || (typeof navigator !== 'undefined' && navigator.webdriver))) return null;
  const id = (s.renderer || 'unknown').slice(0, 160);
  try { if (localStorage.getItem(SLOW_NOTICE_KEY) === id) return null; } catch { /* storage blocked: show it */ }
  const box = h('div', {
    position: 'fixed', left: '50%', top: '0.75rem', transform: 'translateX(-50%)', zIndex: String(Z_TOP - 3),
    width: 'min(36rem, calc(100vw - 1.5rem))', boxSizing: 'border-box', padding: '0.9rem 1.1rem 0.85rem', borderRadius: '0.7rem',
    background: 'linear-gradient(180deg, rgba(20, 28, 39, 0.95), rgba(8, 12, 18, 0.97))', border: '1px solid rgba(255, 176, 64, 0.45)',
    boxShadow: '0 1rem 2.6rem rgba(0, 0, 0, 0.55)', color: '#e9f0f7', font: `500 0.95rem/1.4 ${FONT}`, pointerEvents: 'auto',
  }, [], { role: 'status', 'aria-live': 'polite', 'data-notice': 'slow-gpu' });
  const head = h('div', { font: `700 1rem/1.2 ${FONT}`, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#ffb040', marginBottom: '0.35rem' }, [tErrors('slowGpu.title')]);
  const body = h('div', { marginBottom: '0.35rem' }, [tErrors('slowGpu.body', { game: GAME_TITLE })]);
  const advice = h('div', { color: '#b9c7d6', fontSize: '0.88rem', marginBottom: '0.6rem' }, [tErrors('slowGpu.advice')]);
  const ok = button(tErrors('slowGpu.dismiss'), () => {
    try { localStorage.setItem(SLOW_NOTICE_KEY, id); } catch { /* not remembered */ }
    clearInterval(timer);
    fadeOutAndRemove(box);
  }, 'primary', '255, 176, 64');
  ok.style.padding = '0.55rem 1rem 0.5rem';
  ok.style.minHeight = '2.75rem'; // a finger-sized target on phones (44 px)
  ok.style.minWidth = '6rem';
  box.append(head, body, advice, h('div', { display: 'flex', justifyContent: 'flex-end' }, [ok]));
  parent.append(box);
  fadeIn(box);
  // out of the way during a battle (the in-match top bar is visible), back in the menus
  const timer = setInterval(() => {
    if (!box.isConnected) { clearInterval(timer); return; }
    const bar = document.getElementById('topbar');
    const inBattle = !!bar && bar.getClientRects().length > 0 && getComputedStyle(bar).visibility !== 'hidden';
    box.style.display = inBattle ? 'none' : '';
  }, 1000);
  return box;
}

/**
 * checkSupport(), retried when the browser has WebGL 2 but could not create a context: on a cold start the GPU process
 * can still be coming up, or have just been lost (seen on Windows: Chrome on Direct3D 11 WARP failed some first launches
 * with "Web page caused context loss and was blocked" even on a blank page; Chrome blocks every page's 3D APIs for about
 * 10 s after a GPU-process loss it cannot blame on one page). Waits `delaysMs` between attempts (a fresh canvas each
 * time; 12 s in all by default, longer than that block) and only then reports 'context-failed', with every attempt's
 * creation error in `detail`. Other results return at once. The loading screen stays up meanwhile.
 */
export async function checkSupportRetrying(delaysMs: number[] = [500, 1500, 4000, 6000], check: () => SupportResult = checkSupport, wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<SupportResult> {
  let res = check();
  const fails: string[] = [];
  for (const ms of delaysMs) {
    if (res.ok || res.reason !== 'context-failed') break;
    fails.push(res.detail);
    await wait(ms);
    res = check();
  }
  if (!fails.length) return res;
  if (res.ok) {
    const w = `WebGL 2 started on attempt ${fails.length + 1} (earlier: ${fails.join(' | ')})`;
    console.warn(`[webgl] ${w}`);
    return { ...res, warnings: [...res.warnings, w] };
  }
  return { ...res, detail: [...fails, res.detail].map((d, i) => `attempt ${i + 1}: ${d}`).join('\n') };
}

/** What to try, per reason (catalogue keys: looked up when the screen is shown). */
const ADVICE: Record<UnsupportedReason, Parameters<typeof tErrors>[0][]> = {
  'no-webgl': ['unsupported.noWebglAdvice1', 'unsupported.noWebglAdvice2'],
  'webgl1-only': ['unsupported.webgl1Advice1', 'unsupported.webgl1Advice2'],
  'context-failed': ['unsupported.contextAdvice1', 'unsupported.contextAdvice2', 'unsupported.contextAdvice3'],
  'missing-feature': ['unsupported.featureAdvice1', 'unsupported.featureAdvice2'],
};

/**
 * Replace the page with a friendly full-screen "can't run here" message. Hides the loading screen.
 * Returns the element (already attached).
 */
export function renderUnsupported(reason: SupportResult | UnsupportedReason, parent: HTMLElement = document.body): HTMLElement {
  const res: SupportResult = typeof reason === 'string'
    ? { ok: false, reason, message: tErrors('unsupported.generic', { game: GAME_TITLE }), detail: '', warnings: [] }
    : reason;
  const why = res.reason ?? 'no-webgl';
  const loading = document.getElementById('loading');
  if (loading) loading.style.display = 'none';
  const root = backdrop(Z_TOP - 2);
  root.style.background = 'radial-gradient(ellipse at 50% 35%, #101a28, #05070b 70%)';
  root.setAttribute('role', 'alert');
  const panel = glassPanel(DANGER_RGB, '38rem');
  panel.append(h('div', { display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }, [
    emblem('3.4rem'),
    h('div', {}, [
      h('div', { fontSize: '1.05rem', fontWeight: '700', letterSpacing: '0.32em', color: '#ff6a46' }, [GAME_TITLE]),
      title(tErrors('unsupported.title'), DANGER_RGB),
    ]),
  ]));
  panel.append(paragraph(res.message));
  const list = h('ul', { margin: '0 0 1.1rem', paddingLeft: '1.2rem', color: '#d5e1ee', fontSize: '0.98rem', lineHeight: '1.45', fontWeight: '500' });
  // Chrome "...context loss and was blocked": its GPU process failed and 3D stays off for this page until the browser
  // restarts, so restarting the browser goes first
  const advice = why === 'context-failed' && /was blocked/i.test(res.detail) ? ['unsupported.contextAdvice3', 'unsupported.contextAdvice1', 'unsupported.contextAdvice2'] as const : ADVICE[why];
  for (const a of advice) list.append(h('li', { marginBottom: '0.35rem' }, [tErrors(a)]));
  panel.append(list);
  if (res.detail || res.warnings.length) {
    const det = h('details', { margin: '0 0 1rem', color: '#7d8c9d', fontFamily: MONO, fontSize: '0.75rem' });
    det.append(h('summary', { cursor: 'pointer', marginBottom: '0.5rem' }, [tErrors('unsupported.details')]));
    det.append(codeBox([res.detail, ...res.warnings, typeof navigator !== 'undefined' ? navigator.userAgent : ''].filter(Boolean).join('\n'), '7rem'));
    panel.append(det);
  }
  const learn = h('a', {
    font: `700 0.95rem/1 ${FONT}`, letterSpacing: '0.14em', textTransform: 'uppercase', color: `rgb(${ACCENT_RGB})`, textDecoration: 'none',
    padding: '0.72rem 0.4rem 0.66rem', alignSelf: 'center',
  }, [tErrors('unsupported.checkWebgl')], { href: 'https://get.webgl.org/webgl2/', target: '_blank', rel: 'noopener noreferrer' });
  panel.append(buttonRow([button(tErrors('unsupported.tryAgain'), () => location.reload(), 'primary'), learn]));
  root.append(panel);
  parent.append(root);
  fadeIn(panel, 300);
  return root;
}

export interface ContextLossHandlers {
  /** Context lost: pause the simulation, stop audio-heavy effects, etc. */
  onLost?: () => void;
  /** Context restored by the browser: re-bake GPU-only data (env maps), resume. */
  onRestored?: () => void;
  /** Not restored within `timeoutMs`: the overlay offers a reload; you may rebuild the renderer. */
  onTimeout?: () => void;
  /** Default 8000 ms. */
  timeoutMs?: number;
}

export interface ContextWatch {
  readonly lost: boolean;
  /** Stop listening (call BEFORE an intentional renderer.forceContextLoss() on dispose). */
  dispose(): void;
}

/**
 * Watch a WebGL canvas for GPU resets and show a "Graphics device reset - restoring..." overlay
 * until the browser restores the context.
 */
export function watchContextLoss(canvas: HTMLCanvasElement, handlers: ContextLossHandlers = {}): ContextWatch {
  let lost = false;
  let disposed = false;
  let overlay: HTMLElement | null = null;
  let timer = 0;

  const show = () => {
    overlay?.remove();
    const root = backdrop(Z_TOP - 1);
    root.style.background = 'rgba(2, 4, 8, 0.66)';
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'assertive');
    const panel = glassPanel(ACCENT_RGB, '31rem');
    const msg = paragraph(tErrors('gpuReset.body'));
    msg.style.margin = '0';
    const row = h('div', { display: 'flex', alignItems: 'center', gap: '1rem' }, [spinner(), h('div', {}, [title(tErrors('gpuReset.title')), h('div', {
      fontFamily: MONO, fontSize: '0.78rem', letterSpacing: '0.1em', color: `rgb(${ACCENT_RGB})`, textTransform: 'uppercase', marginBottom: '0.6rem',
    }, [tErrors('gpuReset.restoring')], { 'data-state': '' }), msg])]);
    panel.append(row);
    root.append(panel);
    document.body.append(root);
    fadeIn(panel);
    overlay = root;
  };

  const showTimeout = () => {
    if (!overlay) return;
    const state = overlay.querySelector('[data-state]') as HTMLElement | null;
    if (state) { state.textContent = tErrors('gpuReset.stillWaiting'); state.style.color = `rgb(${DANGER_RGB})`; }
    const panel = overlay.firstElementChild as HTMLElement;
    panel.append(h('div', { marginTop: '1rem' }, [buttonRow([button(tErrors('gpuReset.reload'), () => location.reload(), 'primary')])]));
  };

  const onLost = (e: Event) => {
    e.preventDefault(); // tell the browser we can handle a restore
    if (disposed || lost) return;
    lost = true;
    show();
    try { handlers.onLost?.(); } catch (err) { console.error(err); }
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (!lost || disposed) return;
      showTimeout();
      try { handlers.onTimeout?.(); } catch (err) { console.error(err); }
    }, handlers.timeoutMs ?? 8000);
  };

  const onRestored = () => {
    if (disposed) return;
    lost = false;
    clearTimeout(timer);
    if (overlay) fadeOutAndRemove(overlay, 250);
    overlay = null;
    try { handlers.onRestored?.(); } catch (err) { console.error(err); }
  };

  canvas.addEventListener('webglcontextlost', onLost, false);
  canvas.addEventListener('webglcontextrestored', onRestored, false);
  return {
    get lost() { return lost; },
    dispose() {
      disposed = true;
      clearTimeout(timer);
      canvas.removeEventListener('webglcontextlost', onLost, false);
      canvas.removeEventListener('webglcontextrestored', onRestored, false);
      overlay?.remove();
      overlay = null;
    },
  };
}

/**
 * Test helper: lose the context of `gl` and restore it after `ms` (WEBGL_lose_context).
 * e.g. simulateContextLoss(__game.gfx.renderer.getContext(), 2000)
 */
export function simulateContextLoss(gl: WebGLRenderingContext | WebGL2RenderingContext, ms = 1500): boolean {
  const ext = gl.getExtension('WEBGL_lose_context');
  if (!ext) return false;
  ext.loseContext();
  setTimeout(() => ext.restoreContext(), ms);
  return true;
}
