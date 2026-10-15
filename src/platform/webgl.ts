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
import { readGpuStrings } from './gpu';
import {
  ACCENT_RGB, DANGER_RGB, FONT, MONO, Z_TOP, backdrop, button, buttonRow, codeBox, emblem, fadeIn, fadeOutAndRemove, glassPanel,
  h, paragraph, spinner, title,
} from './ui';

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
  const onErr = (e: Event) => { creationError = (e as WebGLContextEvent).statusMessage || creationError; };
  canvas.addEventListener('webglcontextcreationerror', onErr);
  try {
    gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: true });
    if (!gl) {
      gl = canvas.getContext('webgl2');
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
        ? { ok: false, reason: 'webgl1-only', message: 'Your browser only supports WebGL 1, but Red Horizon needs WebGL 2.', detail: 'WebGL2RenderingContext is not defined.', warnings }
        : { ok: false, reason: 'no-webgl', message: "Your browser doesn't support WebGL, which Red Horizon needs for its 3D graphics.", detail: 'No WebGL implementation.', warnings };
    }
    return {
      ok: false, reason: 'context-failed',
      message: 'Your browser supports WebGL 2, but could not start it. Hardware acceleration may be turned off, or the graphics driver is blocklisted.',
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
    return { ok: false, reason: 'missing-feature', message: 'Your graphics hardware is missing features Red Horizon needs.', detail: `${missing.join('; ')} (${detail})`, warnings, renderer };
  }
  return { ok: true, message: 'WebGL 2 available', detail, warnings, renderer };
}

const ADVICE: Record<UnsupportedReason, string[]> = {
  'no-webgl': [
    'Use a current version of Chrome, Edge, Firefox or Safari (15 or newer).',
    'If you are on a remote desktop or virtual machine, try a regular desktop session.',
  ],
  'webgl1-only': [
    'Update your browser: every current Chrome, Edge, Firefox and Safari (15+) supports WebGL 2.',
    'On Safari 14 and older, enable "WebGL 2.0" under Develop › Experimental Features, or update macOS / iOS.',
  ],
  'context-failed': [
    'Turn on hardware acceleration (Chrome / Edge: Settings › System › "Use graphics acceleration when available"; Firefox: Settings › Performance).',
    'Update your graphics driver, then restart the browser.',
    'Close other tabs or apps using the GPU heavily, then try again; a crashed GPU process is reset by restarting the browser.',
  ],
  'missing-feature': [
    'Try another browser on this device (Chrome and Firefox use different graphics back-ends).',
    'Update your graphics driver, or play on a device with a more capable GPU.',
  ],
};

/**
 * Replace the page with a friendly full-screen "can't run here" message. Hides the loading screen.
 * Returns the element (already attached).
 */
export function renderUnsupported(reason: SupportResult | UnsupportedReason, parent: HTMLElement = document.body): HTMLElement {
  const res: SupportResult = typeof reason === 'string'
    ? { ok: false, reason, message: "This browser can't run Red Horizon.", detail: '', warnings: [] }
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
      title("Can't start on this browser", DANGER_RGB),
    ]),
  ]));
  panel.append(paragraph(res.message));
  const list = h('ul', { margin: '0 0 1.1rem', paddingLeft: '1.2rem', color: '#d5e1ee', fontSize: '0.98rem', lineHeight: '1.45', fontWeight: '500' });
  for (const a of ADVICE[why]) list.append(h('li', { marginBottom: '0.35rem' }, [a]));
  panel.append(list);
  if (res.detail || res.warnings.length) {
    const det = h('details', { margin: '0 0 1rem', color: '#7d8c9d', fontFamily: MONO, fontSize: '0.75rem' });
    det.append(h('summary', { cursor: 'pointer', marginBottom: '0.5rem' }, ['Technical details']));
    det.append(codeBox([res.detail, ...res.warnings, typeof navigator !== 'undefined' ? navigator.userAgent : ''].filter(Boolean).join('\n'), '7rem'));
    panel.append(det);
  }
  const learn = h('a', {
    font: `700 0.95rem/1 ${FONT}`, letterSpacing: '0.14em', textTransform: 'uppercase', color: `rgb(${ACCENT_RGB})`, textDecoration: 'none',
    padding: '0.72rem 0.4rem 0.66rem', alignSelf: 'center',
  }, ['Check WebGL 2 ↗'], { href: 'https://get.webgl.org/webgl2/', target: '_blank', rel: 'noopener noreferrer' });
  panel.append(buttonRow([button('Try again', () => location.reload(), 'primary'), learn]));
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
    const msg = paragraph('Your graphics driver reset the GPU. Hold on while we bring the battlefield back — the game is paused and nothing is lost.');
    msg.style.margin = '0';
    const row = h('div', { display: 'flex', alignItems: 'center', gap: '1rem' }, [spinner(), h('div', {}, [title('Graphics device reset'), h('div', {
      fontFamily: MONO, fontSize: '0.78rem', letterSpacing: '0.1em', color: `rgb(${ACCENT_RGB})`, textTransform: 'uppercase', marginBottom: '0.6rem',
    }, ['Restoring…'], { 'data-state': '' }), msg])]);
    panel.append(row);
    root.append(panel);
    document.body.append(root);
    fadeIn(panel);
    overlay = root;
  };

  const showTimeout = () => {
    if (!overlay) return;
    const state = overlay.querySelector('[data-state]') as HTMLElement | null;
    if (state) { state.textContent = 'Still waiting for the GPU'; state.style.color = `rgb(${DANGER_RGB})`; }
    const panel = overlay.firstElementChild as HTMLElement;
    panel.append(h('div', { marginTop: '1rem' }, [buttonRow([button('Reload game', () => location.reload(), 'primary')])]));
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
 * QA helper: lose the context of `gl` and restore it after `ms` (WEBGL_lose_context).
 * e.g. simulateContextLoss(__game.gfx.renderer.getContext(), 2000)
 */
export function simulateContextLoss(gl: WebGLRenderingContext | WebGL2RenderingContext, ms = 1500): boolean {
  const ext = gl.getExtension('WEBGL_lose_context');
  if (!ext) return false;
  ext.loseContext();
  setTimeout(() => ext.restoreContext(), ms);
  return true;
}
