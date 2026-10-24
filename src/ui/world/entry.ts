/**
 * World Conquest's footprint in the initial bundle: the main-menu entry (an animated globe icon and a pill), the
 * "is this a world battle" test main.ts routes results by, and the challenge-link check. Everything else of the mode
 * is the lazy chunk src/ui/world/index.ts. Keep this file tiny (the initial bundle budget is +5 KB for the mode).
 */

/** What the menu entry shows about a run in progress (written by the world screens: no run code needed here). */
export const BADGE_KEY = 'rh.world.badge';

/** The active world run's turn, or null (no run, or it is over). */
export function worldBadge(): { turn: number } | null {
  try {
    const raw = localStorage.getItem(BADGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { turn?: unknown; active?: unknown };
    return v && v.active === true && typeof v.turn === 'number' && Number.isFinite(v.turn) ? { turn: Math.max(1, Math.floor(v.turn)) } : null;
  } catch {
    return null;
  }
}

/** Whether a Conquest battle setup belongs to World Conquest (its spec carries the world fields). */
export function isWorldBattle(setup: { battle?: unknown } | undefined | null): boolean {
  const b = setup?.battle as { world?: unknown } | undefined;
  return !!b && !!b.world;
}

/**
 * The ?world=<state> test screens (src/ui/world/index.ts runDemo) run only in a development build or with ?debug=1:
 * a link someone shares must never put a test state in front of a player.
 */
export function demoAllowed(search: string = typeof location !== 'undefined' ? location.search : ''): boolean {
  let dev = false;
  try { dev = !!(import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV; } catch { /* not built by Vite */ }
  return dev || new URLSearchParams(search).get('debug') === '1';
}

/** A world challenge link (#world=<seed>&home=…), or the test switch (?world=…, debug only), is on the address. */
export function worldLinkPending(): boolean {
  return /^#(?:.*&)?world=/.test(location.hash) || (new URLSearchParams(location.search).has('world') && demoAllowed());
}

const CSS = `.mm-world{position:relative;overflow:hidden;border-color:rgba(255,211,77,.32)!important;background:linear-gradient(90deg,rgba(255,211,77,.14),rgba(var(--accent-rgb),.04) 70%)}
.mm-world::after{content:'';position:absolute;inset:0;pointer-events:none;background:linear-gradient(100deg,transparent 30%,rgba(255,230,160,.16) 45%,transparent 60%);transform:translateX(-100%);animation:mwSheen 5.5s 1.6s ease-in-out infinite}
@keyframes mwSheen{0%,70%{transform:translateX(-100%)}100%{transform:translateX(100%)}}
.mm-world .nb-label{color:#ffe7a3}
.mm-world .mw-g{width:1.35em;height:1.35em;display:block}
.mm-world .mw-m{animation:mwSpin 9s linear infinite}
@keyframes mwSpin{to{transform:translateX(-20px)}}
@media (prefers-reduced-motion:reduce){.mm-world::after,.mm-world .mw-m{animation:none}}
body.reduce-motion .mm-world::after,body.reduce-motion .mm-world .mw-m{animation:none}`;

/** The globe icon: meridians slide behind a round clip, so it seems to turn. */
export function worldIcon(): string {
  if (!document.getElementById('mw-css')) {
    const st = document.createElement('style');
    st.id = 'mw-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  let m = '';
  for (let k = -2; k < 5; k++) { const x = 2 + k * 5; m += `<path d="M${x} 2Q${x + 3.2} 12 ${x} 22"/>`; }
  return `<svg class="mw-g" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4"><defs><clipPath id="mwc"><circle cx="12" cy="12" r="9.6"/></clipPath></defs>
<circle cx="12" cy="12" r="10" stroke="#ffd34d" stroke-width="1.7"/><g clip-path="url(#mwc)" opacity=".75"><g class="mw-m">${m}</g><path d="M2 8.5H22M1 12H23M2 15.5H22"/></g></svg>`;
}
