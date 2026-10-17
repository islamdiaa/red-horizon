/**
 * Switches for the game-feel layer. `?juice=0` in the URL turns every game-feel addition off (A/B
 * screenshots and performance comparisons); the director also mirrors settings.reduceMotion here.
 */
export const JUICE = {
  /** Master switch for the game-feel additions (spectacle layers, hit flashes, moments, mix changes). */
  on: true,
  /** settings.reduceMotion (or prefers-reduced-motion): no screen shake, no slow motion, no letterbox. */
  reduceMotion: false,
};

try {
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('juice') === '0') JUICE.on = false;
} catch {
  /* not a browser */
}
