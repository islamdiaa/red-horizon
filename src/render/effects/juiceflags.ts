/**
 * [JUICE] Switches for the game-feel layer. `?juice=0` in the URL turns every JUICE addition off (A/B
 * screenshots and performance comparisons); the director also mirrors settings.reduceMotion here.
 */
export const JUICE = {
  /** Master switch for the JUICE additions (spectacle layers, hit flashes, moments, mix changes). */
  on: true,
  /** settings.reduceMotion (or prefers-reduced-motion): no screen shake, no slow motion, no letterbox. */
  reduceMotion: false,
};

try {
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('juice') === '0') JUICE.on = false;
} catch {
  /* not a browser */
}
