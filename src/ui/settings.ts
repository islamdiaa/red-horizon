import type { Quality } from '../render/renderer';
import { applyA11y, type SubtitleSize, type TeamPalette } from './a11y';
import { setKeymap, type GroupMods, type KeymapOverrides } from './keymap';

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
  /** In-battle interface: 'modern' (bottom build bar, corner panels; the default) or 'classic' (right-hand sidebar). */
  hudLayout?: HudLayout;
  /** Model detail: baked 'hd' models or the procedural 'standard' ones (unset: HD on High / Medium, Standard on Low). */
  modelDetail?: ModelDetail;
  /** Render resolution of the 3D view: 'auto' (dynamic, the default) or a fixed scale 0.5..1. */
  renderScale?: 'auto' | number;
  /** Team colours: setup colours, a colour-blind safe palette, or you blue / enemies orange (display only). */
  teamPalette?: TeamPalette;
  /** Interface scale for the HUD and menus, 0.8–1.5 (1 = default). */
  uiScale?: number;
  /** Announcer captions (default on). */
  subtitles?: boolean;
  subtitleSize?: SubtitleSize;
  /** Rebound hotkeys: only the actions that differ from the defaults (ui/keymap.ts). */
  keys?: KeymapOverrides;
  /** Control-group modifiers (default Ctrl assigns, Shift adds). */
  groupMods?: Partial<GroupMods>;
}

/** Model detail setting. */
export type ModelDetail = 'hd' | 'standard';
/** The model detail in effect for a quality preset (the player's choice, else HD unless Low). */
export const modelDetailOf = (s: Settings, quality: Quality = s.quality): ModelDetail => s.modelDetail ?? (quality === 'low' ? 'standard' : 'hd');
/** Use the baked HD models for a match at this quality (URL ?hd=0 / ?hd=1 overrides, for tests). */
export function hdModelsWanted(s: Settings, quality: Quality): boolean {
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('hd') : null;
  if (q === '0' || q === '1') return q === '1';
  return modelDetailOf(s, quality) === 'hd';
}

/** In-battle interface layout. */
export type HudLayout = 'modern' | 'classic';
/** The layout to use (Modern unless the player picked Classic). */
export const hudLayoutOf = (s: Settings): HudLayout => (s.hudLayout === 'classic' ? 'classic' : 'modern');

const SETTINGS_KEY = 'rh.settings';
const listeners = new Set<(s: Settings) => void>();

export function loadSettings(): Settings {
  // (the performance overlay is opt-in: Settings › Graphics; a first battle shows the battlefield, not renderer stats)
  const def: Settings = { quality: 'high', edgeScroll: true, unitVoices: true, hints: true, showFps: false, reduceMotion: false, fullscreen: true };
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
  setKeymap(s.keys, s.groupMods);
  applyA11y(s);
  document.body.classList.toggle('reduce-motion', !!s.reduceMotion);
  document.body.classList.toggle('hide-fps', s.showFps === false);
}

/** Subscribe to settings changes; returns an unsubscribe function. */
export function onSettingsChanged(fn: (s: Settings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
