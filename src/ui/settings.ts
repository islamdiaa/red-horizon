import type { Quality } from '../render/renderer';

export interface Settings {
  quality: Quality;
  edgeScroll: boolean;
  unitVoices: boolean;
  hints: boolean;
  /** Show the FPS / renderer stats chip in the top bar. */
  showFps?: boolean;
  /** Reduce UI motion (also honoured automatically via prefers-reduced-motion). */
  reduceMotion?: boolean;
  /** Skip the cinematic fly-in at the start of each battle. */
  skipIntro?: boolean;
  /** Go fullscreen when a battle starts (edge scrolling needs the screen edge). */
  fullscreen?: boolean;
  /** [HUD] In-battle interface: 'modern' (bottom build bar, corner panels; the default) or 'classic' (right-hand sidebar). */
  hudLayout?: HudLayout;
}

/** [HUD] In-battle interface layout. */
export type HudLayout = 'modern' | 'classic';
/** [HUD] The layout to use (Modern unless the player picked Classic). */
export const hudLayoutOf = (s: Settings): HudLayout => (s.hudLayout === 'classic' ? 'classic' : 'modern');

const SETTINGS_KEY = 'rh.settings';
const listeners = new Set<(s: Settings) => void>();

export function loadSettings(): Settings {
  const def: Settings = { quality: 'high', edgeScroll: true, unitVoices: true, hints: true, showFps: true, reduceMotion: false, fullscreen: true };
  try {
    return { ...def, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return def;
  }
}

export function saveSettings(s: Settings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* private mode */ }
  applyUiSettings(s);
  for (const fn of listeners) fn(s);
}

/** UI-level settings that are pure presentation (body classes). */
export function applyUiSettings(s: Settings = loadSettings()) {
  document.body.classList.toggle('reduce-motion', !!s.reduceMotion);
  document.body.classList.toggle('hide-fps', s.showFps === false);
}

/** Subscribe to settings changes; returns an unsubscribe function. */
export function onSettingsChanged(fn: (s: Settings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
