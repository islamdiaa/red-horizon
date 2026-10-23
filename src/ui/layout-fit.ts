/**
 * Whether the Classic interface layout (the right-hand sidebar, 22rem wide) fits the window. On a narrow, short or
 * portrait window the sidebar covered most of the battlefield (at 390x844 three quarters of it), so the HUD uses the
 * Modern layout there instead and switches back when the window grows again; the setting itself is kept.
 */
import type { HudLayout } from './settings';

/** The sidebar may take at most this share of the window's width. */
export const CLASSIC_MAX_SHARE = 0.4;
/** Below this height the sidebar's radar and build grid don't fit. */
export const CLASSIC_MIN_HEIGHT = 500;

/**
 * The root font size Classic would have (styles.css: `html { font-size: min(clamp(13px, 1.5556vh, 22px) * scale,
 * max(clamp(13px, 1.5556vh, 22px), min(2.3334vh, 1.6vw))) }`), computed rather than read, since the Modern layout
 * on show sizes the root differently.
 */
export function classicRootPx(width: number, height: number, uiScale = 1): number {
  const base = Math.min(22, Math.max(13, 0.015556 * height));
  return Math.min(base * uiScale, Math.max(base, Math.min(0.023334 * height, 0.016 * width)));
}

/** Whether Classic fits a window of this size (landscape, tall enough, sidebar at most 40% of the width). */
export function classicFits(width: number, height: number, uiScale = 1): boolean {
  return width >= height && height >= CLASSIC_MIN_HEIGHT && 22 * classicRootPx(width, height, uiScale) <= CLASSIC_MAX_SHARE * width;
}

/** The interface size setting as the stylesheet sees it (--ui-scale on the root, ui/a11y.ts). */
function uiScale(): number {
  if (typeof document === 'undefined') return 1;
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale'));
  return Number.isFinite(v) && v > 0 ? v : 1;
}

/** The layout to show for the chosen one in the current window. */
export function fitLayout(chosen: HudLayout): HudLayout {
  if (chosen !== 'classic' || typeof window === 'undefined') return chosen;
  return classicFits(window.innerWidth, window.innerHeight, uiScale()) ? 'classic' : 'modern';
}
