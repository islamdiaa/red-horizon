/**
 * Fullscreen play. An RTS scrolls the map at the screen edge, which only works well without the
 * browser's own window around the page. Entering fullscreen needs a user gesture (a click or key),
 * so callers invoke it from input handlers (Deploy, the top-bar button, Alt+Enter).
 * While fullscreen, Esc is kept for the game (pause menu) where the browser allows it: the browser
 * then asks the player to press and hold Esc to leave fullscreen.
 */
type KeyboardLock = { lock?: (keys?: string[]) => Promise<void>; unlock?: () => void };
const keyboard = () => (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard;

export const fullscreenSupported = () => typeof document !== 'undefined' && !!document.documentElement.requestFullscreen;
export const isFullscreen = () => !!document.fullscreenElement;

export async function enterFullscreen(): Promise<void> {
  if (!fullscreenSupported() || isFullscreen()) return;
  try {
    await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    await keyboard()?.lock?.(['Escape']);
  } catch {
    // refused (no user gesture, embedded frame policy, …): the game simply stays windowed
  }
}

export async function exitFullscreen(): Promise<void> {
  if (!isFullscreen()) return;
  keyboard()?.unlock?.();
  await document.exitFullscreen().catch(() => {});
}

export function toggleFullscreen(): Promise<void> {
  return isFullscreen() ? exitFullscreen() : enterFullscreen();
}

/** Run `fn` whenever fullscreen is entered or left; returns an unsubscribe function. */
export function onFullscreenChange(fn: (on: boolean) => void): () => void {
  const h = () => fn(isFullscreen());
  document.addEventListener('fullscreenchange', h);
  return () => document.removeEventListener('fullscreenchange', h);
}
