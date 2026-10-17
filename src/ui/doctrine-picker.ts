/**
 * [DOCTRINE] Doctrine picker for the skirmish setup (Commander rules).
 *
 * Two parts:
 *  - `createDoctrinePicker(opts)`: a compact selector (one row: the chosen doctrine's icon, name and its bonuses /
 *    drawback at a glance) that opens a chooser overlay with a card per doctrine of the side: icon, two bonuses
 *    (green), one drawback (red), and a lock with the commander rank that opens it. Mouse, touch, keyboard (Tab /
 *    Enter / Esc) and gamepad (the menu focus walks the buttons) all work.
 *  - The registration into VARIETY's skirmish "Rules" tab slot (ui/variety.ts `registerDoctrineSlot`), done when this
 *    module loads (main.ts imports it).
 *
 * Unlock gating is a UI rule: two doctrines per faction from the start, the others by commander rank (meta/ranks.ts,
 * read from the local profile). The simulation only ever receives the chosen ids (GameSetup.doctrines).
 */
import type { Faction } from '../data/rules';
import { DOCTRINES, doctrineUnlocked, doctrinesFor, type DoctrineDef } from '../sim/doctrine';
import { loadProfile } from '../meta/profile';
import { rankIndexFor, rankName } from '../meta/ranks';
import { el, esc } from './dom';
import { ICONS } from './icons';
import { DOCTRINE_ICONS } from './commander';
import { registerDoctrineSlot } from './variety';

const STORE = 'rh.doctrine';

export interface DoctrinePickerOptions {
  faction: Faction;
  /** Selected doctrine id, null = none. A value that isn't valid for the faction falls back to the remembered pick. */
  value: string | null;
  onChange(id: string | null): void;
  /** Commander rank index (meta/ranks.ts); default: the local profile's. */
  rank?: number;
  /** Greyed out and not clickable (e.g. Classic rules). */
  disabled?: boolean;
}

export interface DoctrinePicker {
  el: HTMLElement;
  value(): string | null;
  setValue(id: string | null): void;
  /** Switch side: keeps a valid choice, else the remembered / first open doctrine of that faction. */
  setFaction(f: Faction): void;
  setDisabled(on: boolean): void;
  dispose(): void;
}

/** The commander rank of the local profile (0 when unreadable). */
export function profileRank(): number {
  try { return rankIndexFor(loadProfile().xp); } catch { return 0; }
}

function remembered(f: Faction): string | null | undefined {
  try {
    const v = (JSON.parse(localStorage.getItem(STORE) ?? '{}') as Record<string, string | null>)[f];
    return v === undefined ? undefined : v;
  } catch { return undefined; }
}
function remember(f: Faction, id: string | null) {
  try {
    const o = JSON.parse(localStorage.getItem(STORE) ?? '{}') as Record<string, string | null>;
    o[f] = id;
    localStorage.setItem(STORE, JSON.stringify(o));
  } catch { /* storage blocked */ }
}

/** A choice that is valid for the faction and unlocked at this rank (null = no doctrine). */
export function resolveDoctrineChoice(f: Faction, want: string | null | undefined, rank: number): string | null {
  const ok = (id: string | null | undefined) => !!id && !!DOCTRINES[id] && DOCTRINES[id].faction === f && doctrineUnlocked(DOCTRINES[id], rank);
  if (want === null) return null;
  if (ok(want)) return want!;
  const mem = remembered(f);
  if (mem === null) return null;
  if (ok(mem)) return mem!;
  return doctrinesFor(f).find((d) => doctrineUnlocked(d, rank))?.id ?? null;
}

const icon = (d: DoctrineDef | null) => (d ? DOCTRINE_ICONS[d.icon] ?? ICONS.flag : ICONS.close);

export function createDoctrinePicker(opts: DoctrinePickerOptions): DoctrinePicker {
  injectCss();
  let faction = opts.faction;
  const rank = opts.rank ?? profileRank();
  let value = resolveDoctrineChoice(faction, opts.value, rank);
  let disabled = !!opts.disabled;
  let overlay: HTMLElement | null = null;
  const root = el('button', 'dp-sel');
  root.type = 'button';
  root.setAttribute('aria-haspopup', 'dialog');
  const render = () => {
    const d = value ? DOCTRINES[value] : null;
    root.classList.toggle('none', !d);
    root.disabled = disabled;
    root.innerHTML = `<span class="dp-ic">${icon(d)}</span><span class="dp-txt"><b>${esc(d ? d.name : 'No doctrine')}</b>
      <small>${d ? `<i class="dp-plus">+</i>${esc(d.bonuses[0])} <i class="dp-plus">+</i>${esc(d.bonuses[1])} <i class="dp-minus">−</i>${esc(d.drawback)}` : 'Standard rules for your side'}</small></span>
      <span class="dp-chg">${ICONS.chevR}</span>`;
    root.title = d ? `${d.name}\n+ ${d.bonuses[0]}\n+ ${d.bonuses[1]}\n− ${d.drawback}` : 'No doctrine';
  };
  const set = (id: string | null, user: boolean) => {
    value = id;
    if (user) remember(faction, id);
    render();
    opts.onChange(id);
  };
  const close = () => {
    if (!overlay) return;
    const o = overlay;
    overlay = null;
    o.classList.add('leaving');
    window.setTimeout(() => o.remove(), 200);
    document.removeEventListener('keydown', onKey, true);
    root.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  };
  const open = () => {
    if (disabled || overlay) return;
    const ov = el('div', 'dp-overlay');
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-label', 'Choose a doctrine');
    const pnl = el('div', 'dp-panel panel');
    pnl.innerHTML = `<div class="dp-head"><span class="dp-hic">${ICONS.flag}</span><div><small>${faction === 'soviet' ? 'Soviet' : 'Allied'} doctrine</small><b>Choose how you fight</b></div></div>
      <p class="dp-sub">Two bonuses and one drawback for the whole match. Commander rules only; your opponents pick their own.</p>`;
    const x = el('button', 'dp-x', ICONS.close);
    x.type = 'button';
    x.setAttribute('aria-label', 'Close');
    x.onclick = close;
    pnl.appendChild(x);
    const grid = el('div', 'dp-grid');
    const opts2: (DoctrineDef | null)[] = [...doctrinesFor(faction), null];
    let first: HTMLButtonElement | null = null;
    for (const d of opts2) {
      const locked = !!d && !doctrineUnlocked(d, rank);
      const card = el('button', 'dp-card' + (locked ? ' locked' : '') + ((d?.id ?? null) === value ? ' on' : '') + (d ? '' : ' none'));
      card.type = 'button';
      card.innerHTML = d
        ? `<span class="dp-cic">${icon(d)}</span><b>${esc(d.name)}</b><em>${esc(d.blurb)}</em>
          <ul><li class="dp-b"><i>+</i>${esc(d.bonuses[0])}</li><li class="dp-b"><i>+</i>${esc(d.bonuses[1])}</li><li class="dp-d"><i>−</i>${esc(d.drawback)}</li></ul>
          ${locked ? `<span class="dp-lock">${ICONS.lock}<span>Commander rank ${d.rank}: ${esc(rankName(d.rank, faction))}</span></span>` : ''}`
        : `<span class="dp-cic">${ICONS.close}</span><b>No doctrine</b><em>Plain rules for your side: no bonus, no drawback.</em>`;
      card.disabled = locked;
      if (locked) card.title = `Reach commander rank ${d!.rank} (${rankName(d!.rank, faction)}) to unlock`;
      card.onclick = () => { set(d?.id ?? null, true); close(); };
      if (!first && !locked && (d?.id ?? null) === value) first = card;
      grid.appendChild(card);
    }
    pnl.appendChild(grid);
    ov.appendChild(pnl);
    ov.addEventListener('pointerdown', (e) => { if (e.target === ov) close(); });
    document.body.appendChild(ov);
    overlay = ov;
    document.addEventListener('keydown', onKey, true);
    (first ?? grid.querySelector<HTMLButtonElement>('.dp-card:not([disabled])'))?.focus();
  };
  root.onclick = open;
  render();
  return {
    el: root,
    value: () => value,
    setValue: (id) => { value = resolveDoctrineChoice(faction, id, rank); render(); },
    setFaction: (f) => {
      if (f === faction) return;
      faction = f;
      const v = resolveDoctrineChoice(f, value && DOCTRINES[value]?.faction === f ? value : undefined, rank);
      set(v, false);
    },
    setDisabled: (on) => { disabled = on; render(); },
    dispose: () => { close(); root.remove(); },
  };
}

// [VARIETY] slot in the skirmish "Rules" tab
registerDoctrineSlot((host, ctx) => {
  const rank = profileRank();
  // (the prefs hold null both for "none" and "never chosen": the pick remembered per side decides, a new player
  // starts with the side's first doctrine)
  const v = resolveDoctrineChoice(ctx.faction, ctx.value && DOCTRINES[ctx.value]?.faction === ctx.faction ? ctx.value : undefined, rank);
  const p = createDoctrinePicker({ faction: ctx.faction, value: v, rank, disabled: !ctx.enabled, onChange: ctx.onChange });
  host.appendChild(p.el);
  if (v !== ctx.value) ctx.onChange(v);
});

function injectCss() {
  if (document.getElementById('dp-style')) return;
  const st = document.createElement('style');
  st.id = 'dp-style';
  st.textContent = CSS;
  document.head.appendChild(st);
}

const CSS = `
.dp-sel { all: unset; box-sizing: border-box; flex: 1; min-width: 0; display: flex; align-items: center; gap: .55rem; padding: .3rem .5rem .3rem .35rem; border-radius: .55rem; cursor: pointer;
  background: linear-gradient(180deg, rgba(var(--accent-rgb), .16), rgba(var(--accent-rgb), .05)); border: 1px solid rgba(var(--accent-rgb), .45); transition: border-color .2s, background .2s; }
.dp-sel:hover, .dp-sel:focus-visible { border-color: rgba(var(--accent-rgb), .85); background: linear-gradient(180deg, rgba(var(--accent-rgb), .26), rgba(var(--accent-rgb), .08)); }
.dp-sel:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.dp-sel.none { background: rgba(0,0,0,.25); border-color: var(--line-2); }
.dp-sel:disabled { cursor: default; opacity: .5; }
.dp-ic { width: 1.9rem; height: 1.9rem; flex-shrink: 0; border-radius: .45rem; display: grid; place-items: center; font-size: 1.15rem; color: var(--accent-hi);
  background: radial-gradient(circle at 50% 30%, rgba(var(--accent-rgb), .4), rgba(var(--accent-rgb), .1)); border: 1px solid rgba(var(--accent-rgb), .5); }
.dp-sel.none .dp-ic { color: var(--muted); background: rgba(255,255,255,.04); border-color: var(--line-2); }
.dp-txt { display: flex; flex-direction: column; min-width: 0; line-height: 1.15; }
.dp-txt b { font-size: .86rem; letter-spacing: .05em; color: var(--text); }
.dp-txt small { font-size: .66rem; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dp-plus { font-style: normal; color: var(--ok); font-weight: 700; margin-right: .12rem; }
.dp-minus { font-style: normal; color: var(--danger); font-weight: 700; margin-right: .12rem; }
.dp-chg { margin-left: auto; color: var(--muted); font-size: .95rem; flex-shrink: 0; }
.dp-overlay { position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center; background: radial-gradient(ellipse at center, rgba(2,5,9,.6), rgba(0,0,0,.86));
  backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); animation: dpIn .22s var(--ease) both; }
.dp-overlay.leaving { animation: dpOut .2s var(--ease) both; pointer-events: none; }
@keyframes dpIn { from { opacity: 0; } } @keyframes dpOut { to { opacity: 0; } }
.dp-panel { position: relative; width: min(62rem, calc(100vw - 2rem)); max-height: calc(100vh - 2rem); overflow-y: auto; display: flex; flex-direction: column; gap: .6rem; padding: 1.1rem 1.2rem 1.2rem; border-radius: .9rem;
  background: var(--glass); border: 1px solid var(--line-2); box-shadow: 0 1rem 3rem rgba(0,0,0,.6); scrollbar-width: thin; }
.dp-head { display: flex; align-items: center; gap: .7rem; }
.dp-hic { width: 2.4rem; height: 2.4rem; display: grid; place-items: center; font-size: 1.3rem; border-radius: .55rem; color: var(--accent-hi); background: rgba(var(--accent-rgb), .18); border: 1px solid rgba(var(--accent-rgb), .5); }
.dp-head small { display: block; font-size: .66rem; letter-spacing: .24em; text-transform: uppercase; color: var(--muted); font-weight: 700; }
.dp-head b { font-size: 1.3rem; letter-spacing: .06em; }
.dp-sub { margin: 0; font-size: .8rem; color: var(--text-2); }
.dp-x { all: unset; position: absolute; right: .8rem; top: .8rem; width: 2rem; height: 2rem; display: grid; place-items: center; border-radius: .45rem; cursor: pointer; color: var(--muted); border: 1px solid var(--line); }
.dp-x:hover, .dp-x:focus-visible { color: #fff; border-color: var(--line-2); }
.dp-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(10.5rem, 1fr)); gap: .55rem; }
.dp-card { all: unset; box-sizing: border-box; position: relative; display: flex; flex-direction: column; gap: .35rem; padding: .75rem .75rem .8rem; border-radius: .7rem; cursor: pointer; min-height: 12.5rem;
  background: linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.015)); border: 1px solid var(--line-2); transition: border-color .2s, transform .15s, background .2s; }
.dp-card:hover:not([disabled]), .dp-card:focus-visible { border-color: rgba(var(--accent-rgb), .8); transform: translateY(-2px); }
.dp-card:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.dp-card.on { border-color: var(--accent); background: linear-gradient(180deg, rgba(var(--accent-rgb), .22), rgba(var(--accent-rgb), .05)); box-shadow: 0 0 1.2rem rgba(var(--accent-rgb), .25); }
.dp-cic { width: 2.6rem; height: 2.6rem; display: grid; place-items: center; font-size: 1.5rem; border-radius: .6rem; color: var(--accent-hi);
  background: radial-gradient(circle at 50% 30%, rgba(var(--accent-rgb), .42), rgba(var(--accent-rgb), .1)); border: 1px solid rgba(var(--accent-rgb), .5); }
.dp-card.none .dp-cic { color: var(--muted); background: rgba(255,255,255,.04); border-color: var(--line-2); }
.dp-card b { font-size: 1.02rem; letter-spacing: .05em; }
.dp-card em { font-style: normal; font-size: .72rem; color: var(--muted); line-height: 1.3; }
.dp-card ul { list-style: none; margin: .2rem 0 0; padding: 0; display: flex; flex-direction: column; gap: .3rem; }
.dp-card li { display: flex; gap: .35rem; font-size: .76rem; line-height: 1.25; color: var(--text); }
.dp-card li i { font-style: normal; font-weight: 700; width: .7rem; flex-shrink: 0; }
.dp-b i { color: var(--ok); } .dp-d i { color: var(--danger); } .dp-d { color: #ffc4bd !important; }
.dp-card.locked { cursor: not-allowed; }
.dp-card.locked > :not(.dp-lock) { opacity: .38; filter: saturate(.2); }
.dp-lock { margin-top: auto; display: flex; align-items: center; gap: .4rem; padding: .35rem .5rem; border-radius: .45rem; font-size: .7rem; color: var(--gold);
  background: rgba(0,0,0,.55); border: 1px solid rgba(var(--gold-rgb), .45); }
@media (prefers-reduced-motion: reduce) { .dp-overlay, .dp-overlay.leaving { animation: none; } .dp-card { transition: none; } }
body.reduce-motion .dp-overlay, body.reduce-motion .dp-overlay.leaving { animation: none; }
`;
