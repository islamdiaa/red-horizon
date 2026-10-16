/**
 * Browser side of the mod loader: model aliases for cloned variants, the "Modded" markers (HUD build
 * cards, tooltips, an in-match badge, the skirmish panel) and the Mods screen (src/mods/ui.ts).
 * The rules engine itself (src/mods/engine.ts) has no DOM and is shared with the tests.
 */
import { setModelAlias } from '../render/models';
import { appliedModSet, onTypesChanged, typeModInfo } from './engine';
import { activeModSet } from './store';
import type { ModSet } from './format';

export { showMods } from './ui';
export { activeModSet } from './store';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

// cloned variants render with their base type's model
onTypesChanged((added, removed) => {
  for (const a of added) if (a.table === 'units' || a.table === 'buildings') setModelAlias(a.id, a.base);
  for (const id of removed) setModelAlias(id, null);
});

const CSS = `
.bi-mod { position: absolute; left: 4px; top: 4px; z-index: 3; font: 800 9px/1 var(--font, sans-serif); letter-spacing: .12em; padding: 3px 5px 2px; border-radius: 4px;
  color: #1a1200; background: linear-gradient(180deg, #ffd34d, #e0a020); box-shadow: 0 0 8px rgba(255,200,60,.55); pointer-events: none; }
.tt-mod { margin-top: 8px; padding: 7px 9px; border-radius: 8px; background: rgba(255,200,60,.08); border: 1px solid rgba(255,200,60,.35); font-size: 12px; color: #f2e2b0; }
.tt-mod b { color: #ffd34d; letter-spacing: .08em; font-size: 11px; display: block; margin-bottom: 3px; }
.tt-mod div { font-family: var(--mono, monospace); font-size: 11px; color: #e8dcc0; line-height: 1.45; }
.rh-modbadge { position: fixed; left: 50%; top: 6px; transform: translateX(-50%); z-index: 30; pointer-events: auto; cursor: default;
  font: 700 11px/1 var(--font, sans-serif); letter-spacing: .18em; text-transform: uppercase; color: #1a1200; padding: 5px 12px 4px; border-radius: 999px;
  background: linear-gradient(180deg, #ffd34d, #e0a020); box-shadow: 0 2px 14px rgba(255,190,40,.45); opacity: .92; }
.rh-modbadge span { font-weight: 600; letter-spacing: .06em; text-transform: none; margin-left: 6px; }
.mods-chip { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; margin-left: auto; padding: 5px 10px; border-radius: 8px; cursor: pointer; max-width: 55%;
  background: rgba(255,200,60,.08); border: 1px solid rgba(255,200,60,.4); color: #f2e2b0; font-size: 12px; letter-spacing: .03em; line-height: 1.15; text-align: right; }
.mods-chip b { color: #ffd34d; letter-spacing: .2em; font-size: 10px; }
.mods-chip span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.mods-chip:hover { background: rgba(255,200,60,.14); }
`;
function injectCss() {
  if (document.getElementById('mods-css')) return;
  const st = document.createElement('style');
  st.id = 'mods-css';
  st.textContent = CSS;
  document.head.appendChild(st);
}

/** Corner tag for a HUD build card ('' when the type isn't modded). */
export function modCardTag(typeId: string): string {
  const info = typeModInfo(typeId);
  if (!info) return '';
  injectCss();
  return `<span class="bi-mod" title="Modded by ${esc(info.mods.join(', '))}">${info.variant ? 'NEW' : 'MOD'}</span>`;
}

/** Tooltip section listing what the active mods changed on a type ('' when unmodded). */
export function modTipHtml(typeId: string): string {
  const info = typeModInfo(typeId);
  if (!info) return '';
  injectCss();
  const head = info.variant ? `Mod variant · ${esc(info.mods.join(', '))}` : `Modded · ${esc(info.mods.join(', '))}`;
  return `<div class="tt-mod"><b>${head.toUpperCase()}</b>${info.lines.slice(0, 8).map((l) => `<div>${esc(l)}</div>`).join('')}</div>`;
}

/** In-match "MODDED" badge (removed when `set` is empty or the next match starts). */
export function showModBadge(set: ModSet | null | undefined) {
  document.getElementById('rh-modbadge')?.remove();
  if (!set?.mods.length) return;
  injectCss();
  const b = document.createElement('div');
  b.id = 'rh-modbadge';
  b.className = 'rh-modbadge';
  b.innerHTML = `Modded<span>${esc(set.mods.map((m) => m.name).join(' + '))}</span>`;
  b.title = `Rules changed by mods (set ${set.hash.slice(0, 8)}); saves and replays of this match keep these rules.`;
  document.body.appendChild(b);
}

/** Skirmish-panel chip naming the enabled mods (null when none). */
export function activeModsChip(onClick: () => void): HTMLElement | null {
  const set = activeModSet();
  if (!set) return null;
  injectCss();
  const c = document.createElement('div');
  c.className = 'mods-chip';
  c.innerHTML = `<b>MODDED</b><span>${esc(set.mods.map((m) => m.name).join(' + '))}</span>`;
  c.title = 'These mods change the rules of the next match. Click to manage mods.';
  c.onclick = onClick;
  return c;
}

/** The mod set applied to the running rules (for debugging / UI). */
export { appliedModSet };
