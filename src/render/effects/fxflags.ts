/**
 * Switch for the effects director's cut (heat haze, lens rain, soft / fire-lit particles). `?fxdc=0` turns
 * them off for A/B screenshots and performance comparisons (the persistent battlefield damage stays).
 */
export const FXDC = { on: true };

try {
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('fxdc') === '0') FXDC.on = false;
} catch {
  /* not a browser */
}
