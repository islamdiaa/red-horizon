/**
 * [META] The Locker: browse, preview, claim and equip cosmetics (src/meta/unlocks.ts). Paint schemes show a
 * rendered tank in your colour, HUD themes a mini HUD, portraits / titles / banners your commander card,
 * announcer styles and fanfares play a sample. Locked items say exactly what earns them. Claims spend
 * Commendations (earned from contracts; nothing is for sale).
 *
 * Opened from the main menu (session card), the profile and the results screen; an overlay above them.
 */
import type { AudioSystem } from '../audio';
import { el, esc } from './dom';
import {
  COSMETICS, COSMETIC_SLOTS, SLOT_LABEL, SLOT_PICTO, claimCosmetic, equipCosmetic, equippedId, insigniaSvg, loadProfile, markSeen, picto, rankProgress, saveProfile, syncTrackers,
  unlockContext, unlockStatus, type CosmeticDef, type CosmeticSlot, type UnlockCtx,
} from '../meta';
import { applyHudTheme, bindCosmeticsAudio, commanderLook, paintPreviews, portraitSvg, previewFanfare, previewVoice, refreshVoice } from '../meta/cosmetics';

const CSS = `
.rh-locker { position: fixed; inset: 0; z-index: 40; display: flex; flex-direction: column; gap: .9rem; padding: 3.2vh 3vw; font-family: var(--font, sans-serif); color: var(--text, #e9f0f7);
  background: radial-gradient(ellipse at 30% 20%, rgba(var(--accent-rgb, 90,180,255), .12), transparent 55%), radial-gradient(ellipse at 50% 50%, rgba(4,7,11,.96), rgba(0,0,0,.985)); backdrop-filter: blur(4px); animation: lkIn .35s ease-out; }
.rh-locker.leaving { animation: lkOut .25s ease-in forwards; }
@keyframes lkIn { from { opacity: 0; } }
@keyframes lkOut { to { opacity: 0; } }
.lk-head { position: relative; display: flex; align-items: center; gap: 1rem; padding: .8rem 1rem; border-radius: 1rem; overflow: hidden; border: 1px solid rgba(255,255,255,.1); box-shadow: 0 1rem 2.4rem rgba(0,0,0,.45); }
.lk-head::before { content: ''; position: absolute; inset: 0; background: var(--banner); }
.lk-head::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, rgba(5,8,12,.55), rgba(5,8,12,.2) 50%, rgba(5,8,12,.75)); }
.lk-head > * { position: relative; z-index: 1; }
.lk-por { width: 4.6rem; height: 5.4rem; border-radius: .55rem; background: rgba(0,0,0,.35); border: 1px solid rgba(255,255,255,.2); overflow: hidden; flex-shrink: 0; }
.lk-por svg { width: 100%; height: 100%; display: block; }
.lk-ins { width: 3rem; height: 3rem; flex-shrink: 0; }
.lk-ins svg { width: 100%; height: 100%; }
.lk-id { flex: 1; min-width: 0; }
.lk-id small { display: block; font-size: .64rem; font-weight: 700; letter-spacing: .3em; text-transform: uppercase; color: #ffd34d; }
.lk-id b { display: block; font-size: 1.8rem; letter-spacing: .08em; text-transform: uppercase; line-height: 1.05; text-shadow: 0 2px 8px rgba(0,0,0,.7); }
.lk-id em { display: block; font-style: normal; font-size: .9rem; letter-spacing: .08em; color: #e6eef7; text-shadow: 0 1px 6px rgba(0,0,0,.8); }
.lk-cmd { text-align: right; padding: .45rem .8rem; border-radius: .7rem; background: rgba(0,0,0,.45); border: 1px solid rgba(255,207,63,.35); }
.lk-cmd b { display: flex; align-items: center; gap: .35rem; font-family: var(--mono, monospace); font-weight: 400; font-size: 1.5rem; color: #ffe27a; }
.lk-cmd small { font-size: .56rem; font-weight: 700; letter-spacing: .26em; text-transform: uppercase; color: #b89a52; }
.lk-tabs { display: flex; gap: .35rem; flex-wrap: wrap; }
.lk-tab { position: relative; display: inline-flex; align-items: center; gap: .4rem; height: 2.3rem; padding: 0 .95rem; border-radius: .5rem; border: 1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.03); color: #9fb0c2; cursor: pointer;
  font: inherit; font-size: .78rem; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; transition: all .2s; }
.lk-tab .mx-ic { font-size: 1rem; }
.lk-tab:hover, .lk-tab:focus-visible { color: #fff; border-color: rgba(var(--accent-rgb), .5); outline: none; }
.lk-tab.on { color: #fff; background: rgba(var(--accent-rgb), .22); border-color: rgba(var(--accent-rgb), .75); box-shadow: inset 0 -2px 0 rgb(var(--accent-rgb)); }
.lk-tab i.new { position: absolute; top: .3rem; right: .35rem; width: .45rem; height: .45rem; border-radius: 50%; background: #4dff9a; box-shadow: 0 0 .4rem #4dff9a; }
.lk-tab .cnt { font-family: var(--mono, monospace); font-size: .68rem; letter-spacing: 0; color: var(--muted, #7d8c9d); }
.lk-body { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) minmax(19rem, 25rem); gap: 1rem; }
.lk-grid { min-height: 0; overflow-y: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(12.5rem, 1fr)); grid-auto-rows: max-content; gap: .6rem; align-content: start; padding: .1rem .3rem .3rem .1rem; scrollbar-width: thin; }
.lk-card { position: relative; display: flex; flex-direction: column; gap: .4rem; padding: .55rem; border-radius: .75rem; text-align: left; cursor: pointer; font: inherit; color: inherit;
  background: linear-gradient(180deg, rgba(20,28,39,.92), rgba(8,12,18,.94)); border: 1px solid rgba(255,255,255,.08); transition: transform .2s, border-color .2s, box-shadow .2s; }
.lk-card:hover, .lk-card:focus-visible { transform: translateY(-2px); border-color: rgba(var(--accent-rgb), .55); outline: none; box-shadow: 0 .6rem 1.4rem rgba(0,0,0,.45); }
.lk-card.sel { border-color: rgb(var(--accent-rgb)); box-shadow: 0 0 0 1px rgb(var(--accent-rgb)), 0 .6rem 1.6rem rgba(0,0,0,.5); }
.lk-card.locked .lk-pv { filter: grayscale(.85) brightness(.55); }
.lk-pv { position: relative; height: 6.4rem; border-radius: .5rem; overflow: hidden; display: flex; align-items: center; justify-content: center; background: radial-gradient(ellipse at 50% 70%, rgba(255,255,255,.07), rgba(0,0,0,.35)); }
.lk-pv img { width: 100%; height: 100%; object-fit: contain; }
.lk-pv svg.por { height: 100%; width: auto; }
.lk-pv .ttl { padding: .3rem .8rem; border-radius: .35rem; border: 1px solid rgba(255,207,63,.45); color: #ffe7a0; font-size: .95rem; letter-spacing: .1em; text-transform: uppercase; text-align: center; background: rgba(0,0,0,.35); }
.lk-pv .big { font-size: 2.4rem; color: rgba(255,255,255,.55); }
.lk-pv .hud { display: flex; flex-direction: column; gap: .35rem; width: 80%; }
.lk-pv .hud i { height: .55rem; border-radius: .3rem; background: var(--a); box-shadow: 0 0 .7rem var(--a); }
.lk-pv .hud i:nth-child(2) { width: 62%; opacity: .55; }
.lk-pv .hud span { display: flex; gap: .3rem; }
.lk-pv .hud span b { flex: 1; height: 1.2rem; border-radius: .3rem; border: 1px solid var(--a); background: color-mix(in srgb, var(--a) 22%, transparent); }
.lk-nm { display: flex; align-items: center; justify-content: space-between; gap: .4rem; font-size: .9rem; font-weight: 700; letter-spacing: .05em; }
.lk-st { font-size: .6rem; font-weight: 700; letter-spacing: .18em; text-transform: uppercase; padding: .1rem .35rem; border-radius: .25rem; white-space: nowrap; }
.lk-st.eq { color: #8dffb0; border: 1px solid rgba(77,255,154,.5); }
.lk-st.own { color: #b6c3d1; border: 1px solid rgba(255,255,255,.18); }
.lk-st.buy { color: #ffe27a; border: 1px solid rgba(255,207,63,.5); }
.lk-st.lock { color: #7d8c9d; border: 1px solid rgba(255,255,255,.1); }
.lk-st.new { color: #4dff9a; border: 1px solid rgba(77,255,154,.6); }
.lk-pr { height: .22rem; border-radius: 1rem; background: rgba(255,255,255,.07); overflow: hidden; }
.lk-pr i { display: block; height: 100%; border-radius: 1rem; background: rgb(var(--accent-rgb)); }
.lk-how { font-size: .7rem; color: var(--muted, #7d8c9d); line-height: 1.25; min-height: 1.75em; }
.lk-side { min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: .7rem; padding: 1rem; border-radius: 1rem; background: linear-gradient(180deg, rgba(20,28,39,.94), rgba(8,12,18,.96)); border: 1px solid rgba(255,255,255,.09); }
.lk-side .lk-pv { height: 13rem; }
.lk-side h3 { margin: 0; font-size: 1.35rem; letter-spacing: .08em; text-transform: uppercase; }
.lk-side small.k { font-size: .62rem; font-weight: 700; letter-spacing: .3em; text-transform: uppercase; color: rgb(var(--accent-rgb)); }
.lk-side p { margin: 0; color: var(--text-2, #b6c3d1); font-size: .92rem; line-height: 1.4; }
.lk-req { font-size: .82rem; color: #dfe8f2; padding: .55rem .7rem; border-radius: .55rem; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.07); }
.lk-req b { color: #ffe27a; font-weight: 600; }
.lk-acts { display: flex; gap: .5rem; flex-wrap: wrap; }
.lk-btn { height: 2.6rem; padding: 0 1.1rem; display: inline-flex; align-items: center; gap: .5rem; border-radius: .55rem; cursor: pointer; font: inherit; font-size: .8rem; font-weight: 700; letter-spacing: .2em; text-transform: uppercase;
  color: #dfe8f2; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.14); transition: all .2s; }
.lk-btn:hover:not(:disabled), .lk-btn:focus-visible { color: #fff; border-color: rgba(var(--accent-rgb), .7); background: rgba(var(--accent-rgb), .2); outline: none; }
.lk-btn.pri { color: #04111f; background: rgb(var(--accent-rgb)); border-color: rgb(var(--accent-rgb)); }
.lk-btn.pri:hover:not(:disabled) { color: #04111f; filter: brightness(1.12); }
.lk-btn:disabled { opacity: .45; cursor: default; }
.lk-btn kbd { font-family: var(--mono, monospace); font-size: .62rem; padding: .08rem .3rem; border-radius: .25rem; border: 1px solid rgba(255,255,255,.25); color: var(--muted, #7d8c9d); letter-spacing: 0; }
.lk-note { font-size: .74rem; color: var(--muted, #7d8c9d); line-height: 1.4; }
@media (max-width: 1100px) { .rh-locker .lk-body { grid-template-columns: 1fr; } .lk-side { order: -1; max-height: 15rem; } .lk-side .lk-pv { height: 7rem; } }
`;

function ensureCss() {
  if (document.getElementById('lk-style')) return;
  const st = document.createElement('style');
  st.id = 'lk-style';
  st.textContent = CSS;
  document.head.appendChild(st);
}

/** The player's skirmish colour (menu preferences), for paint previews. */
function playerColor(faction: string): number {
  try {
    const c = JSON.parse(localStorage.getItem('rh.setup') ?? '{}')?.color;
    if (typeof c === 'number' && Number.isInteger(c) && c >= 0 && c <= 0xffffff) return c;
  } catch { /* defaults */ }
  return faction === 'soviet' ? 0xd23a2c : 0x3d7be0;
}

const previewCache = new Map<string, Map<string, string>>();

function previewHtml(def: CosmeticDef, ctx: UnlockCtx, paints: Map<string, string> | null): string {
  switch (def.slot) {
    case 'paint': {
      const url = paints?.get(def.id);
      return url ? `<img src="${url}" alt="">` : `<span class="big">${picto('tank')}</span>`;
    }
    case 'theme': {
      const a = def.theme?.accent ?? (ctx.profile.faction === 'soviet' ? '#ff5a46' : '#5ab4ff');
      return `<span class="hud" style="--a:${a}"><i></i><i></i><span><b></b><b></b><b></b></span></span>`;
    }
    case 'portrait':
      return portraitSvg(def, ctx.profile).replace('<svg ', '<svg class="por" ');
    case 'title':
      return `<span class="ttl">${def.req.kind === 'default' ? '—' : esc(def.name)}</span>`;
    case 'banner':
      return `<span style="position:absolute;inset:0;background:${def.banner}"></span>`;
    case 'voice':
      return `<span class="big">${picto('wave')}</span>`;
    case 'fanfare':
      return `<span class="big">${picto('trophy')}</span>`;
  }
}

/** Full-screen Locker. Returns a close function. */
export function showLocker(opts: { onBack(): void; audio?: AudioSystem; play?(k: 'click' | 'tab' | 'hover'): void; slot?: CosmeticSlot }): () => void {
  ensureCss();
  if (opts.audio) bindCosmeticsAudio(opts.audio);
  document.querySelector('.rh-locker')?.remove();
  const root = el('div', 'rh-locker');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Locker');
  document.body.appendChild(root);
  let slot: CosmeticSlot = opts.slot ?? 'paint';
  let selected: string | null = null;
  let note = '';
  const seenAtOpen = new Set(loadProfile().cosmetics.seen);
  const visited = new Set<CosmeticSlot>();
  const play = (k: 'click' | 'tab' | 'hover') => { try { opts.play?.(k); } catch { /* no audio */ } };

  // paint previews are real renders: drawn once per colour, a frame after the Locker opens (cached afterwards)
  let rendering = false;
  const paintsFor = (ctx: UnlockCtx): Map<string, string> | null => {
    const hex = playerColor(ctx.profile.faction);
    const key = `${hex}|${ctx.profile.faction}`;
    const m = previewCache.get(key);
    if (m || rendering) return m ?? null;
    rendering = true;
    requestAnimationFrame(() => setTimeout(() => {
      const r = paintPreviews(hex, ctx.profile.faction === 'soviet' ? 'soviet' : 'allies');
      if (r.size) previewCache.set(key, r);
      if (root.isConnected && slot === 'paint') { render(); focusSel(); }
    }, 0));
    return null;
  };

  const render = () => {
    const profile = loadProfile();
    const ctx = unlockContext(profile);
    const look = commanderLook(ctx);
    const rp = rankProgress(profile.xp, profile.faction);
    const items = COSMETICS.filter((c) => c.slot === slot);
    const eqId = equippedId(slot, ctx);
    if (!selected || !items.some((c) => c.id === selected)) selected = eqId;
    const paints = slot === 'paint' ? paintsFor(ctx) : null;
    const isNew = (d: CosmeticDef) => d.req.kind !== 'default' && !seenAtOpen.has(d.id) && unlockStatus(d, ctx).unlocked;
    // looking at a tab clears its "new" markers next time
    if (!visited.has(slot)) {
      visited.add(slot);
      const fresh = items.filter(isNew).map((d) => d.id);
      if (fresh.length) { markSeen(ctx, fresh); saveProfile(profile); syncTrackers(); }
    }
    const tabs = COSMETIC_SLOTS.map((sl) => {
      const all = COSMETICS.filter((c) => c.slot === sl);
      const have = all.filter((c) => unlockStatus(c, ctx).unlocked).length;
      return `<button class="lk-tab${sl === slot ? ' on' : ''}" data-slot="${sl}">${picto(SLOT_PICTO[sl])}<span>${SLOT_LABEL[sl]}</span><span class="cnt">${have}/${all.length}</span>${all.some(isNew) && !visited.has(sl) ? '<i class="new"></i>' : ''}</button>`;
    }).join('');
    const cards = items.map((d, i) => {
      const st = unlockStatus(d, ctx);
      const status = d.id === eqId ? '<span class="lk-st eq">Equipped</span>'
        : isNew(d) ? '<span class="lk-st new">New</span>'
          : st.unlocked ? '<span class="lk-st own">Owned</span>'
            : st.purchasable ? `<span class="lk-st buy">${st.target} ${picto('medal')}</span>` : `<span class="lk-st lock">${picto('lock')}</span>`;
      return `<button class="lk-card${st.unlocked ? '' : ' locked'}${d.id === selected ? ' sel' : ''}" data-id="${d.id}" style="--i:${i}">
        <span class="lk-pv">${previewHtml(d, ctx, paints)}</span>
        <span class="lk-nm"><span>${esc(d.name)}</span>${status}</span>
        ${st.unlocked ? `<span class="lk-how">${esc(d.desc)}</span>` : `<span class="lk-pr"><i style="width:${(st.frac * 100).toFixed(1)}%"></i></span><span class="lk-how">${esc(st.how)}</span>`}
      </button>`;
    }).join('');
    const sel = items.find((c) => c.id === selected) ?? items[0];
    const ss = unlockStatus(sel, ctx);
    const audible = sel.slot === 'voice' || (sel.slot === 'fanfare' && !!sel.fanfare);
    const action = sel.id === eqId ? `<button class="lk-btn" disabled>${picto('untouchable')}<span>Equipped</span></button>`
      : ss.unlocked ? `<button class="lk-btn pri" data-act="equip">${picto('untouchable')}<span>Equip</span><kbd>Enter</kbd></button>`
        : ss.purchasable ? `<button class="lk-btn pri" data-act="claim"${ss.affordable ? '' : ' disabled'}>${picto('medal')}<span>Claim · ${ss.target}</span></button>` : '';
    root.innerHTML = `
      <div class="lk-head" style="--banner:${look.banner}">
        <div class="lk-por">${look.portrait}</div><div class="lk-ins">${insigniaSvg(rp.index, profile.faction)}</div>
        <div class="lk-id"><small>Locker · ${esc(rp.name)}</small><b>${esc(profile.name)}</b>${look.title ? `<em>${esc(look.title)}</em>` : ''}</div>
        <div class="lk-cmd"><b>${picto('medal')}${profile.commendations.toLocaleString('en-US')}</b><small>Commendations</small></div>
        <button class="lk-btn" data-act="back">${picto('back')}<span>Back</span><kbd>Esc</kbd></button>
      </div>
      <div class="lk-tabs">${tabs}</div>
      <div class="lk-body">
        <div class="lk-grid">${cards}</div>
        <div class="lk-side">
          <span class="lk-pv">${previewHtml(sel, ctx, paints)}</span>
          <div><small class="k">${SLOT_LABEL[sel.slot]}</small><h3>${esc(sel.name)}</h3></div>
          <p>${esc(sel.desc)}</p>
          <div class="lk-req">${ss.unlocked ? `${picto('untouchable')} ${sel.req.kind === 'default' ? 'Standard issue.' : sel.req.kind === 'cmd' ? 'Claimed with Commendations.' : `Requirement met: ${esc(ss.how)}.`}` : `${picto('lock')} ${esc(ss.how)}${ss.need ? ` · <b>${esc(ss.need)}</b>` : ''}`}</div>
          <div class="lk-acts">${action}${audible ? `<button class="lk-btn" data-act="listen">${picto('play')}<span>Listen</span></button>` : ''}</div>
          ${note ? `<div class="lk-note">${esc(note)}</div>` : ''}
          <div class="lk-note">Cosmetics never change the battle: paint applies to your own units' look only, and Commendations are earned from contracts, never bought.</div>
        </div>
      </div>`;
    root.querySelectorAll<HTMLElement>('[data-slot]').forEach((b) => (b.onclick = () => { slot = b.dataset.slot as CosmeticSlot; selected = null; note = ''; play('tab'); render(); focusSel(); }));
    root.querySelectorAll<HTMLElement>('[data-id]').forEach((b) => (b.onclick = () => {
      if (selected === b.dataset.id) { equip(); return; }
      selected = b.dataset.id!; note = ''; play('click'); render(); focusSel();
    }));
    (root.querySelector('[data-act="back"]') as HTMLElement).onclick = () => { play('click'); close(); opts.onBack(); };
    const eq = root.querySelector('[data-act="equip"]') as HTMLElement | null;
    if (eq) eq.onclick = () => equip();
    const cl = root.querySelector('[data-act="claim"]') as HTMLElement | null;
    if (cl) cl.onclick = () => claim();
    const ls = root.querySelector('[data-act="listen"]') as HTMLElement | null;
    if (ls) ls.onclick = () => {
      const ok = sel.slot === 'voice' ? previewVoice(sel) : previewFanfare(sel);
      if (!ok) { note = 'Sound is not available yet: click anywhere in the game first, or check the volume settings.'; render(); }
    };
  };
  const focusSel = () => (root.querySelector('.lk-card.sel') as HTMLElement | null)?.focus({ preventScroll: false });

  const commit = (fn: (ctx: UnlockCtx) => boolean): boolean => {
    const profile = loadProfile();
    const ctx = unlockContext(profile);
    if (!fn(ctx)) return false;
    saveProfile(profile);
    syncTrackers();
    applyHudTheme(unlockContext(profile));
    refreshVoice();
    return true;
  };
  const equip = () => {
    const id = selected;
    if (!id) return;
    if (commit((ctx) => equipCosmetic(ctx, id))) { play('click'); note = ''; render(); focusSel(); }
  };
  const claim = () => {
    const id = selected;
    if (!id) return;
    if (commit((ctx) => claimCosmetic(ctx, id) && equipCosmetic(ctx, id))) { play('click'); note = 'Claimed and equipped.'; render(); focusSel(); }
  };

  const onKey = (e: KeyboardEvent) => {
    if (!root.isConnected) { document.removeEventListener('keydown', onKey, true); return; }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      play('click');
      close();
      opts.onBack();
    } else if (e.key === 'Enter' || e.key === ' ') {
      // Enter on a focused card selects / equips it (native button click); keep it away from screens underneath
      e.stopPropagation();
    }
  };
  document.addEventListener('keydown', onKey, true);
  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    root.classList.add('leaving');
    setTimeout(() => root.remove(), 240);
  };
  render();
  requestAnimationFrame(focusSel);
  return close;
}
