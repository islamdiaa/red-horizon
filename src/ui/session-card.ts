/**
 * Session goals on the main menu: a compact card with today's (or this week's) contracts, the daily
 * streak, Commendations and the next unlock, with the free daily reroll and a way into the Locker. It takes
 * the place of the menu's tagline once the player has fought a battle. No countdowns, no pressure: orders
 * simply change with the date.
 */
import type { AudioSystem } from '../audio';
import { el, esc } from './dom';
import {
  CONTRACT_BY_ID, canReroll, contractDesc, contractReward, fmtContractValue, nextUnlock, picto, profileWithContracts, rerollContractNow, unlockContext, unseenUnlocks,
  type Cadence,
} from '../meta';
import { applyHudTheme, bindCosmeticsAudio } from '../meta/cosmetics';
import { showLocker } from './locker';

const CSS = `
.sc { position: relative; width: 100%; max-width: 27rem; margin: -.2rem 0 1rem; padding: .5rem .65rem .5rem; border-radius: .8rem; font-family: var(--font, sans-serif);
  background: linear-gradient(180deg, rgba(16,22,31,.78), rgba(8,11,16,.84)); border: 1px solid rgba(255,255,255,.09); box-shadow: 0 .8rem 2rem rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.05);
  animation: fadeUp .8s .5s var(--ease, ease-out) both; }
.sc-h { display: flex; align-items: center; gap: .45rem; font-size: .6rem; font-weight: 700; letter-spacing: .26em; text-transform: uppercase; color: var(--text-2, #b6c3d1); }
.sc-h .sp { flex: 1; }
.sc-seg { display: inline-flex; border-radius: .35rem; overflow: hidden; border: 1px solid rgba(255,255,255,.12); }
.sc-seg button { font: inherit; font-size: .58rem; font-weight: 700; letter-spacing: .2em; text-transform: uppercase; padding: .16rem .45rem; border: 0; color: var(--muted, #7d8c9d); background: transparent; cursor: pointer; }
.sc-seg button.on { color: #fff; background: rgba(var(--accent-rgb), .3); }
.sc-seg button:focus-visible { outline: 1px solid rgb(var(--accent-rgb)); }
.sc-chip { display: inline-flex; align-items: center; gap: .25rem; font-family: var(--mono, monospace); font-size: .72rem; letter-spacing: 0; text-transform: none; color: #ffe27a; }
.sc-chip.streak { color: #ffb45a; }
.sc-chip .mx-ic { font-size: .85rem; }
.sc-cts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .4rem; margin-top: .4rem; }
.sc-ct { position: relative; display: flex; flex-direction: column; gap: .14rem; min-width: 0; padding: .28rem .42rem .32rem; border-radius: .5rem; background: rgba(255,255,255,.035); border: 1px solid rgba(255,255,255,.06); }
.sc-ct b { display: flex; align-items: center; gap: .3rem; font-size: .76rem; letter-spacing: .03em; white-space: nowrap; overflow: hidden; }
.sc-ct b span { overflow: hidden; text-overflow: ellipsis; }
.sc-ct b .mx-ic { flex-shrink: 0; font-size: .85rem; color: rgb(var(--accent-rgb)); }
.sc-ct small { font-family: var(--mono, monospace); font-size: .64rem; color: var(--muted, #7d8c9d); display: flex; justify-content: space-between; }
.sc-ct small em { font-style: normal; color: #b89a52; }
.sc-ct .tr { height: .2rem; border-radius: 1rem; background: rgba(255,255,255,.07); overflow: hidden; }
.sc-ct .tr i { display: block; height: 100%; border-radius: 1rem; background: rgb(var(--accent-rgb)); }
.sc-ct.done { border-color: rgba(77,255,154,.4); background: rgba(77,255,154,.07); }
.sc-ct.done b .mx-ic, .sc-ct.done small { color: #8dffb0; }
.sc-ct.done .tr i { background: #4dff9a; }
.sc-rr { position: absolute; top: .18rem; right: .2rem; width: 1.25rem; height: 1.25rem; padding: 0; display: inline-flex; align-items: center; justify-content: center; border-radius: .3rem; border: 1px solid rgba(255,255,255,.18); background: rgba(8,12,18,.92); color: #b6c3d1; cursor: pointer; font-size: .75rem; opacity: 0; transition: opacity .15s; }
.sc-ct:hover .sc-rr, .sc-rr:focus-visible, .sc.touch .sc-rr { opacity: 1; }
.sc-rr:hover { color: #fff; border-color: rgb(var(--accent-rgb)); }
.sc-ft { display: flex; align-items: center; gap: .5rem; margin-top: .4rem; font-size: .74rem; color: var(--text-2, #b6c3d1); }
.sc-ft > .mx-ic { color: #7fd3ff; flex-shrink: 0; }
.sc-ft .tx { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: .15rem; }
.sc-ft .tx span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sc-ft .tx span b { color: #fff; font-weight: 600; }
.sc-ft .tr { height: .18rem; border-radius: 1rem; background: rgba(255,255,255,.07); overflow: hidden; }
.sc-ft .tr i { display: block; height: 100%; background: linear-gradient(90deg, #4a8ad8, #7fd3ff); }
.sc-lk { position: relative; flex-shrink: 0; height: 1.6rem; padding: 0 .65rem; border-radius: .4rem; font: inherit; font-size: .64rem; font-weight: 700; letter-spacing: .2em; text-transform: uppercase; color: #dfe8f2; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.16); cursor: pointer; }
.sc-lk:hover, .sc-lk:focus-visible { color: #fff; border-color: rgba(var(--accent-rgb), .7); background: rgba(var(--accent-rgb), .18); outline: none; }
.sc-lk i { position: absolute; top: -.2rem; right: -.2rem; width: .5rem; height: .5rem; border-radius: 50%; background: #4dff9a; box-shadow: 0 0 .4rem #4dff9a; }
.sc-note { font-size: .64rem; color: var(--muted, #7d8c9d); margin-top: .3rem; }
`;

function ensureCss() {
  if (document.getElementById('sc-style')) return;
  const st = document.createElement('style');
  st.id = 'sc-style';
  st.textContent = CSS;
  document.head.appendChild(st);
}

/**
 * Mount the session card in the main menu's left column (in place of the tagline) and apply the equipped
 * HUD theme. Returns the card, or null when the player has not fought a battle yet (the tagline stays).
 */
export function mountSessionCard(left: HTMLElement, opts: { audio?: AudioSystem; play?(k: 'click' | 'tab' | 'hover'): void } = {}): HTMLElement | null {
  try {
    if (opts.audio) bindCosmeticsAudio(opts.audio);
    applyHudTheme();
    const p0 = profileWithContracts();
    if (p0.stats.games < 1 || typeof document === 'undefined') return null;
    ensureCss();
    const card = el('div', 'sc');
    card.setAttribute('aria-label', 'Session goals');
    let cadence: Cadence = 'daily';
    let note = '';
    if (matchMedia?.('(hover: none)').matches) card.classList.add('touch');
    const play = (k: 'click' | 'tab' | 'hover') => { try { opts.play?.(k); } catch { /* no audio */ } };
    const render = () => {
      const p = profileWithContracts();
      const ctx = unlockContext(p);
      const list = cadence === 'daily' ? p.contracts.daily : p.contracts.weekly;
      const done = list.filter((s) => s.done).length;
      const reroll = canReroll(p.contracts, Date.now());
      const t = nextUnlock(ctx);
      const fresh = unseenUnlocks(ctx).length;
      card.innerHTML = `<div class="sc-h">${picto('target')}<span>${cadence === 'daily' ? "Today's orders" : "This week's orders"}</span>
          <span class="sc-seg"><button class="${cadence === 'daily' ? 'on' : ''}" data-c="daily">Daily</button><button class="${cadence === 'weekly' ? 'on' : ''}" data-c="weekly">Weekly</button></span>
          <span class="sp"></span><span class="sc-chip" title="Contracts done">${done}/${list.length}</span>
          ${p.daily.streak > 0 ? `<span class="sc-chip streak" title="Daily Challenge streak (best ${p.daily.longest})">${picto('streak')}${p.daily.streak}</span>` : ''}
          <span class="sc-chip" title="Commendations: claim cosmetics in the Locker">${picto('medal')}${p.commendations.toLocaleString('en-US')}</span></div>
        <div class="sc-cts">${list.map((s, i) => {
          const def = CONTRACT_BY_ID[s.id];
          const r = contractReward(s.id, cadence);
          return `<div class="sc-ct${s.done ? ' done' : ''}" title="${esc(`${contractDesc(s)} · +${r.xp} XP · +${r.cmd} Commendations`)}">
            <b>${picto(s.done ? 'untouchable' : def?.picto ?? 'target')}<span>${esc(def?.title ?? s.id)}</span></b>
            <small><span>${s.done ? 'Complete' : `${fmtContractValue(def, s.p)} / ${fmtContractValue(def, s.n)}`}</span><em>+${r.cmd}</em></small>
            <span class="tr"><i style="width:${((s.p / Math.max(1, s.n)) * 100).toFixed(1)}%"></i></span>
            ${!s.done && reroll ? `<button class="sc-rr" data-rr="${i}" title="Swap for another contract (one free reroll a day)" aria-label="Reroll ${esc(def?.title ?? '')}">${picto('history')}</button>` : ''}</div>`;
        }).join('')}</div>
        <div class="sc-ft">${picto('lock')}<span class="tx"><span>${t ? `Next: <b>${esc(t.text)}</b>` : '<b>Every cosmetic unlocked</b>'}</span>${t ? `<span class="tr"><i style="width:${(t.status.frac * 100).toFixed(1)}%"></i></span>` : ''}</span>
          <button class="sc-lk" data-act="locker">Locker${fresh ? '<i></i>' : ''}</button></div>
        ${note ? `<div class="sc-note">${esc(note)}</div>` : ''}`;
      card.querySelectorAll<HTMLElement>('[data-c]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); cadence = b.dataset.c as Cadence; note = ''; play('tab'); render(); }));
      card.querySelectorAll<HTMLElement>('[data-rr]').forEach((b) => (b.onclick = (e) => {
        e.stopPropagation();
        const r = rerollContractNow(cadence, Number(b.dataset.rr));
        note = r ? 'New orders received. The next free reroll comes tomorrow.' : '';
        play('click');
        render();
      }));
      (card.querySelector('[data-act="locker"]') as HTMLElement).onclick = (e) => {
        e.stopPropagation();
        play('click');
        showLocker({ audio: opts.audio, play: opts.play, onBack: () => { if (card.isConnected) render(); } });
      };
    };
    render();
    const tag = left.querySelector('.mm-tag');
    if (tag) tag.replaceWith(card);
    else left.appendChild(card);
    return card;
  } catch (e) {
    console.warn('session card', e);
    return null;
  }
}
