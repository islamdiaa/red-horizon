/** Loading screen: rotating gameplay tips and a percentage readout mirroring the bar set by main.ts. */
import { fillKeys } from './keymap';
import { fmtPct, onLanguageChange } from '../i18n/core';
import tCommon from '../i18n/en/common';
import tLoading, { TIP_KEYS } from '../i18n/en/loading';

/**
 * The screen's static text (index.html shows it in English before the language is known): the subtitle, the
 * stage label until main.ts sets one, and the tip heading.
 */
function applyStaticText(root: HTMLElement, label = false) {
  const set = (sel: string, text: string) => { const e = root.querySelector(sel); if (e) e.textContent = text; };
  set('.ld-sub', tCommon('gameSubtitle'));
  set('.ld-tip-k', tLoading('tipHead'));
  if (label) set('.label', tLoading('stage.loading').toUpperCase());
}

export function initLoadingScreen() {
  const root = document.getElementById('loading');
  if (!root || root.dataset.tips) return;
  root.dataset.tips = '1';
  applyStaticText(root, true);
  const tip = root.querySelector('.ld-tip-t') as HTMLElement | null;
  const pct = root.querySelector('.ld-pct') as HTMLElement | null;
  const bar = root.querySelector('.bar div') as HTMLElement | null;
  let i = Math.floor(Math.random() * TIP_KEYS.length);
  /** `animate` is off when the screen appears: game construction blocks the main thread right after,
   *  so a fade-in started then would leave the tip invisible for the whole load. */
  const next = (animate = true) => {
    if (!tip) return;
    i = (i + 1) % TIP_KEYS.length;
    tip.classList.remove('in');
    if (animate) void tip.offsetWidth;
    tip.innerHTML = fillKeys(tLoading.html(`tips.${TIP_KEYS[i]}`)); // the active key bindings
    if (animate) tip.classList.add('in');
  };
  next(false);
  onLanguageChange(() => { applyStaticText(root); i = (i + TIP_KEYS.length - 1) % TIP_KEYS.length; next(false); }); // (the same tip, re-read)
  const visible = () => root.style.display !== 'none' && root.style.opacity !== '0';
  setInterval(() => { if (visible()) next(); }, 4500);
  let wasVisible = visible();
  new MutationObserver(() => {
    const v = visible();
    if (v && !wasVisible) next(false);
    wasVisible = v;
  }).observe(root, { attributes: true, attributeFilter: ['style'] });
  if (bar && pct) {
    const sync = () => { pct.textContent = bar.style.width ? fmtPct(parseInt(bar.style.width, 10) / 100) : ''; };
    sync();
    new MutationObserver(sync).observe(bar, { attributes: true, attributeFilter: ['style'] });
  }
}
