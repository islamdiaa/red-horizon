/**
 * Accessibility: team colour palettes (display only, never the simulation), interface scale, focus rings and a
 * screen-reader live region.
 *
 *   teamColor(player, local)   the colour to draw a player in (3D paint, minimap, HUD pips)
 *   ringColors() / healthColors()   selection rings and health bars for the active palette
 *   applyA11y(settings)   called by settings.ts whenever the settings change
 *
 * Palettes:
 * - `default`: each player's setup colour.
 * - `cvd`: Okabe–Ito colours (safe for protanopia, deuteranopia and tritanopia), handed out by slot so the most
 *   distinct colours are always in use: you first (blue), then the other players in order.
 * - `vs`: you blue, allies bluish green, every enemy orange.
 */

export type TeamPalette = 'default' | 'cvd' | 'vs';
export type SubtitleSize = 'small' | 'medium' | 'large' | 'xl';

/** The colour-related player fields (sim Player satisfies it). */
export interface PlayerLike { id: number; color: number; team: number }

/**
 * Okabe–Ito, by slot (you first): blue, vermillion, yellow, reddish purple are the most distinct four under every
 * colour-vision type (min CIE76 ΔE 25 with simulated protanopia, deuteranopia and tritanopia; the setup colours: 17).
 */
export const CVD_COLORS = [0x2a8ad4, 0xe0600a, 0xf0e442, 0xcc79a7, 0x009e73, 0xe69f00, 0x56b4e9, 0xc8c8c8] as const;
/** "You vs enemies": you, allies, enemies. */
export const VS_COLORS = { own: 0x2f8de4, ally: 0x30d0b0, enemy: 0xe8590c } as const;
/** Neutral structures and convoys (sim/events.ts) keep their grey. */
const NEUTRAL_TEAM = -1;

let palette: TeamPalette = 'default';
let paletteLocal: PlayerLike | null = null;
let version = 0;

export const teamPalette = (): TeamPalette => palette;
/** Bumped when the palette changes (renderers re-colour their models). */
export const paletteVersion = () => version;

export function setTeamPalette(p: unknown) {
  const next: TeamPalette = p === 'cvd' || p === 'vs' ? p : 'default';
  if (next !== palette) { palette = next; version++; }
}

/** The player the palette is relative to (the renderer sets it; replays switch it). */
export function setPaletteLocal(p: PlayerLike | null) {
  paletteLocal = p;
}

/** The slot of a player for the colour-blind palette: you 0, the others by id. */
function slotOf(p: PlayerLike, local: PlayerLike | null): number {
  if (!local || p === local || p.id === local.id) return local ? 0 : Math.max(0, p.id);
  return p.id < local.id ? p.id + 1 : p.id;
}

/** The colour to draw a player in (0xRRGGBB). */
export function teamColor(p: PlayerLike, local: PlayerLike | null = paletteLocal, mode: TeamPalette = palette): number {
  if (mode === 'default' || p.team === NEUTRAL_TEAM || p.id < 0) return p.color;
  if (mode === 'cvd') return CVD_COLORS[slotOf(p, local) % CVD_COLORS.length];
  if (!local) return p.color;
  if (p === local || p.id === local.id) return VS_COLORS.own;
  return p.team === local.team ? VS_COLORS.ally : VS_COLORS.enemy;
}

export const hexCss = (c: number) => '#' + (c & 0xffffff).toString(16).padStart(6, '0');

/** Selection ring colours: own, ally, enemy. */
export function ringColors(mode: TeamPalette = palette): { own: number; ally: number; enemy: number } {
  if (mode === 'cvd') return { own: 0x56b4e9, ally: 0xf0e442, enemy: 0xff6a1a };
  if (mode === 'vs') return { own: 0x56b4e9, ally: 0x2fd6b0, enemy: 0xff6a1a };
  return { own: 0x58ff8a, ally: 0x5ac8ff, enemy: 0xff4a3a };
}

const HEALTH_DEFAULT = ['#4cff7a', '#ffd23c', '#ff4a3a'] as const;
const HEALTH_CVD = ['#56b4e9', '#f0e442', '#d55e00'] as const;
/** Health bar colours above 50%, 25–50%, below 25% (shared constants: called per bar per frame). */
export function healthColors(mode: TeamPalette = palette): readonly [string, string, string] {
  return mode === 'default' ? HEALTH_DEFAULT : HEALTH_CVD;
}

// ---------------------------------------------------------------------------
// Colour science for the tests and the contrast check (WCAG relative luminance, Machado 2009 CVD simulation)
// ---------------------------------------------------------------------------

const lin = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const rgb = (c: number): [number, number, number] => [(c >> 16) & 255, (c >> 8) & 255, c & 255];

export function luminance(c: number): number {
  const [r, g, b] = rgb(c).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio (1–21). */
export function contrastRatio(a: number, b: number): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export type CvdKind = 'protanopia' | 'deuteranopia' | 'tritanopia';
const CVD_M: Record<CvdKind, number[]> = {
  protanopia: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deuteranopia: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritanopia: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
};

/** CIE L*a*b* of a colour as seen with a colour-vision deficiency (null: normal vision). */
export function labOf(c: number, cvd: CvdKind | null = null): [number, number, number] {
  let [r, g, b] = rgb(c).map(lin);
  if (cvd) {
    const m = CVD_M[cvd];
    [r, g, b] = [m[0] * r + m[1] * g + m[2] * b, m[3] * r + m[4] * g + m[5] * b, m[6] * r + m[7] * g + m[8] * b].map((v) => Math.min(1, Math.max(0, v)));
  }
  const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, Y = 0.2126 * r + 0.7152 * g + 0.0722 * b, Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIE76 colour difference under a colour-vision deficiency. */
export function deltaE(a: number, b: number, cvd: CvdKind | null = null): number {
  const x = labOf(a, cvd), y = labOf(b, cvd);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

// ---------------------------------------------------------------------------
// Applying the settings (DOM)
// ---------------------------------------------------------------------------

export const UI_SCALE_MIN = 0.8;
export const UI_SCALE_MAX = 1.5;
export const clampUiScale = (v: unknown): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 1;
  return Math.round(Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, n)) * 100) / 100;
};
export const subtitleSizeOf = (v: unknown): SubtitleSize => (v === 'small' || v === 'large' || v === 'xl' ? v : 'medium');
/** Subtitle text size (rem) per option, and the factor applied to the radio transmission panels. */
export const SUBTITLE_REM: Record<SubtitleSize, number> = { small: 0.9, medium: 1.1, large: 1.4, xl: 1.8 };
export const SUBTITLE_K: Record<SubtitleSize, number> = { small: 0.85, medium: 1, large: 1.25, xl: 1.6 };

export interface A11ySettings {
  teamPalette?: TeamPalette;
  uiScale?: number;
  subtitles?: boolean;
  subtitleSize?: SubtitleSize;
}

let subtitlesOn = true;
/** Announcer captions on (the default)? */
export const subtitlesEnabled = () => subtitlesOn;

/** Apply the accessibility settings: palette state, interface scale, subtitle size, focus styles. */
export function applyA11y(s: A11ySettings) {
  setTeamPalette(s.teamPalette);
  subtitlesOn = s.subtitles !== false;
  if (typeof document === 'undefined') return;
  injectA11yCss();
  const root = document.documentElement;
  root.style.setProperty('--ui-scale', String(clampUiScale(s.uiScale)));
  const size = subtitleSizeOf(s.subtitleSize);
  root.style.setProperty('--sub-rem', `${SUBTITLE_REM[size]}rem`);
  root.style.setProperty('--sub-k', String(SUBTITLE_K[size]));
  const b = document.body;
  if (!b) return;
  for (const m of ['default', 'cvd', 'vs'] as const) b.classList.toggle('pal-' + m, palette === m);
  b.classList.toggle('subs-off', !subtitlesOn);
  b.classList.toggle('ui-scale-up', clampUiScale(s.uiScale) > 1.1);
}

let cssDone = false;
function injectA11yCss() {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  const st = document.createElement('style');
  st.id = 'a11y-style';
  st.textContent = A11Y_CSS;
  document.head.appendChild(st);
}

const A11Y_CSS = `
/* keyboard focus: one consistent, high-contrast ring everywhere (mouse clicks don't show it) */
:where(button, a[href], input, select, textarea, summary, [tabindex], [role="button"], [role="switch"], [role="tab"]):not([tabindex="-1"]):focus-visible {
  outline: 2px solid #ffd34d !important; outline-offset: 2px !important; box-shadow: 0 0 0 4px rgba(0, 0, 0, 0.75) !important;
}
canvas:focus-visible { outline: none !important; box-shadow: none !important; }
/* settings: the Accessibility section spans the panel; long panels scroll (large interface sizes, small screens) */
.settings-panel .set-grid, .help-panel .help-grid { overflow-y: auto; min-height: 0; padding-right: 0.3rem; }
.set-sec.set-col { gap: 1rem; }
.set-row.set-wide { flex-wrap: wrap; row-gap: 0.4rem; }
.set-row.set-wide .seg { width: 100%; }
.set-status, .acc-status { min-height: 1rem; font-size: 0.74rem; color: var(--accent-hi, #b9e0ff); }
.btn.btn-sm { height: 2rem; padding: 0 0.8rem; font-size: 0.74rem; letter-spacing: 0.12em; flex-shrink: 0; }
.help-foot { display: flex; gap: 0.6rem; align-items: center; justify-content: space-between; flex-wrap: wrap; }

.sr-only { position: absolute !important; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
/* colour-blind palettes: HUD health bars follow the overlay's colours */
body.pal-cvd .grp-hp i[data-c='ok'], body.pal-cvd .spm-bar i[data-c='ok'], body.pal-cvd .spm-hp i[data-c='ok'],
body.pal-vs .grp-hp i[data-c='ok'], body.pal-vs .spm-bar i[data-c='ok'], body.pal-vs .spm-hp i[data-c='ok'] { background: #56b4e9; }
body.pal-cvd .grp-hp i[data-c='mid'], body.pal-cvd .spm-bar i[data-c='mid'], body.pal-cvd .spm-hp i[data-c='mid'],
body.pal-vs .grp-hp i[data-c='mid'], body.pal-vs .spm-bar i[data-c='mid'], body.pal-vs .spm-hp i[data-c='mid'] { background: #f0e442; }
body.pal-cvd .grp-hp i[data-c='low'], body.pal-cvd .spm-bar i[data-c='low'], body.pal-cvd .spm-hp i[data-c='low'],
body.pal-vs .grp-hp i[data-c='low'], body.pal-vs .spm-bar i[data-c='low'], body.pal-vs .spm-hp i[data-c='low'] { background: #d55e00; }
body.pal-cvd .hp-bar[data-c='ok'] .hp-fill, body.pal-vs .hp-bar[data-c='ok'] .hp-fill { background: linear-gradient(180deg, #b6e2fa, #56b4e9 60%, #2a7fb0); }
body.pal-cvd .hp-bar[data-c='mid'] .hp-fill, body.pal-vs .hp-bar[data-c='mid'] .hp-fill { background: linear-gradient(180deg, #fbf5b8, #f0e442 60%, #b8ae20); }
body.pal-cvd .hp-bar[data-c='low'] .hp-fill, body.pal-vs .hp-bar[data-c='low'] .hp-fill { background: linear-gradient(180deg, #ffb08a, #d55e00 60%, #9a4000); }
/* larger interface sizes: the Classic top bar drops its text labels (as it does on narrow screens) so the left and
   right clusters never overlap */
body.ui-scale-up:not(.hud-modern) .tb-obj .obj-txt, body.ui-scale-up:not(.hud-modern) .tb-menu span { display: none; }
/* touch, larger sizes: the touch toolbar wraps into a second column on most tablets, so the field manual moves past it */
body.hud-modern.touch-ui.ui-scale-up .hint { left: calc(var(--edge, 0.7rem) + 8.6rem); }
/* radio transmissions (missions, rivals) follow the subtitle size */
html body .mh-tx .tt, html body .rv-tx .tt { font-size: calc(15px * var(--sub-k, 1) * var(--ui-scale, 1)); }
html body.hud-modern .mh-tx .tt, html body.hud-modern .rv-tx .tt { font-size: calc(0.92rem * var(--sub-k, 1)); }
/* health thresholds as tick marks (50% and 25%), so the level reads without colour */
.spm-hp { position: relative; }
.hp-bar::after, .spm-bar::after, .spm-hp::after {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(90deg, transparent calc(25% - 1px), rgba(0, 0, 0, 0.85) calc(25% - 1px), rgba(0, 0, 0, 0.85) calc(25% + 1px), transparent calc(25% + 1px),
    transparent calc(50% - 1px), rgba(0, 0, 0, 0.85) calc(50% - 1px), rgba(0, 0, 0, 0.85) calc(50% + 1px), transparent calc(50% + 1px));
}
`;

// ---------------------------------------------------------------------------
// Screen-reader announcements
// ---------------------------------------------------------------------------

let live: HTMLElement | null = null;
let liveTimer = 0;

/** Read a line out through a polite live region (radio transmissions, captions). */
export function srAnnounce(text: string) {
  if (typeof document === 'undefined' || !document.body) return;
  if (!live || !live.isConnected) {
    live = document.createElement('div');
    live.className = 'sr-only';
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('aria-atomic', 'false');
    document.body.appendChild(live);
  }
  const line = document.createElement('div');
  line.textContent = text;
  live.appendChild(line);
  while (live.childElementCount > 6) live.firstElementChild?.remove();
  window.clearTimeout(liveTimer);
  liveTimer = window.setTimeout(() => { if (live) live.textContent = ''; }, 15000);
}

// ---------------------------------------------------------------------------
// Focus containment for menus and dialogs
// ---------------------------------------------------------------------------

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const traps: HTMLElement[] = [];

/**
 * Keep Tab / Shift+Tab inside `root` while it is the topmost trap (a dialog over the game or over another
 * screen), and give focus back to whatever had it when released. `initial`: an element or selector to focus
 * now, `false` to leave focus alone (the screen focuses something itself), default: the first focusable.
 * Gamepad and touch navigation are unaffected (they don't use Tab).
 */
export function focusTrap(root: HTMLElement, o: { initial?: HTMLElement | string | false; restore?: boolean } = {}): () => void {
  if (typeof document === 'undefined') return () => {};
  // (only kept when focus is to be restored: an old screen's button would keep its whole match alive through its handlers)
  let prev = o.restore === false ? null : (document.activeElement as HTMLElement | null);
  const items = () => [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0 && !el.closest('[inert], [aria-hidden="true"]'));
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey) return;
    while (traps.length && !traps[traps.length - 1].isConnected) traps.pop(); // screens removed without release
    if (traps[traps.length - 1] !== root || !root.isConnected) return;
    const modal = (document.activeElement as HTMLElement | null)?.closest?.('[aria-modal="true"], [role="alertdialog"]');
    if (modal && !root.contains(modal) && !modal.contains(root)) return; // another modal on top (the crash screen) owns Tab
    const list = items();
    if (!list.length) { e.preventDefault(); return; }
    const first = list[0], last = list[list.length - 1];
    const a = document.activeElement as HTMLElement | null;
    if (!a || !root.contains(a)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); return; }
    if (e.shiftKey && a === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
  };
  document.addEventListener('keydown', onKey, true);
  traps.push(root);
  if (o.initial !== false) {
    requestAnimationFrame(() => {
      if (!root.isConnected || root.contains(document.activeElement)) return;
      const t = typeof o.initial === 'string' ? root.querySelector<HTMLElement>(o.initial) : o.initial || null;
      (t ?? items()[0])?.focus({ preventScroll: true });
    });
  }
  let done = false;
  return () => {
    if (done) return;
    done = true;
    document.removeEventListener('keydown', onKey, true);
    const i = traps.lastIndexOf(root);
    if (i >= 0) traps.splice(i, 1);
    if (o.restore !== false && prev && prev.isConnected && prev !== document.body && (!document.activeElement || document.activeElement === document.body || root.contains(document.activeElement))) {
      try { prev.focus({ preventScroll: true }); } catch { /* gone */ }
    }
    prev = null;
  };
}
