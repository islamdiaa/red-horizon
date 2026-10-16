/**
 * Rivals UI: the "Rivals" board (roster, records, titles, the file they keep on you), the opponent-row controls
 * of the skirmish setup ("Rival" next to the difficulties), procedural portraits in the campaign's bust style, and
 * the in-match rival radio: pre-battle taunts that reference your history and lines on key events, plus the
 * habit tracking that feeds every rival's counter-plan (src/meta/rivals.ts).
 *
 * The radio only reads the simulation (never issues commands), so matches stay deterministic.
 */
import type { Faction } from '../data/rules';
import type { AIDifficulty } from '../sim/ai';
import { PERSONALITIES, type Personality } from '../sim/ai-personality';
import { UNITS, BUILDINGS } from '../data/rules';
import type { World } from '../sim/world';
import type { Player } from '../sim/player';
import {
  callSign, counterPlan, ensureRoster, favouriteUnit, habitsFor, loadRivals, prepareRivalOpponent, rankName, recordHabits, recordRivalBattle,
  rivalDifficulty, rivalName, rosterOrder, saveRivals, taunt, type MatchHabits, type PortraitSpec, type Rival, type RivalRef, type RivalStore, type TauntEvent,
} from '../meta/rivals';
import { loadProfile } from '../meta';

const CSS = `
.rv { position: fixed; inset: 0; z-index: 40; display: flex; flex-direction: column; gap: 1rem; padding: 4vh 4vw; overflow: hidden;
  background: radial-gradient(ellipse at 30% 20%, rgba(255,74,58,.12), transparent 55%), radial-gradient(ellipse at 50% 50%, rgba(0,0,0,.55), rgba(0,0,0,.92) 80%);
  font-family: var(--font, sans-serif); color: var(--text, #e9f0f7); animation: rvIn .35s ease-out; }
.rv.leaving { animation: rvOut .25s ease-in forwards; }
@keyframes rvIn { from { opacity: 0; } } @keyframes rvOut { to { opacity: 0; } }
.rv-head { display: flex; align-items: flex-end; gap: 1rem; }
.rv-head h2 { margin: 0; font-size: 2rem; letter-spacing: .14em; text-transform: uppercase; }
.rv-head small { display: block; font-size: .7rem; letter-spacing: .34em; text-transform: uppercase; color: #ff8a7a; font-weight: 700; }
.rv-head .sp { flex: 1; }
.rv-body { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 20rem; gap: 1rem; }
.rv-list { min-height: 0; overflow-y: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(21rem, 1fr)); grid-auto-rows: max-content; gap: .8rem; padding-right: .3rem; }
.rv-card { position: relative; display: flex; gap: .9rem; padding: .9rem; border-radius: .9rem; background: linear-gradient(160deg, rgba(40,22,22,.9), rgba(10,12,16,.93));
  border: 1px solid rgba(255,90,70,.22); box-shadow: 0 1rem 2.5rem rgba(0,0,0,.45); animation: rvUp .45s calc(var(--i) * 60ms) both; }
.rv-card.allies { background: linear-gradient(160deg, rgba(20,30,46,.9), rgba(10,12,16,.93)); border-color: rgba(90,180,255,.22); }
.rv-card.dead { filter: grayscale(.85); opacity: .62; }
.rv-card.nemesis { border-color: rgba(255,207,63,.6); box-shadow: 0 0 1.6rem rgba(255,207,63,.18), 0 1rem 2.5rem rgba(0,0,0,.45); }
@keyframes rvUp { from { opacity: 0; transform: translateY(.8rem); } }
.rv-pt { width: 6.2rem; height: 7.2rem; flex-shrink: 0; border-radius: .6rem; overflow: hidden; background: radial-gradient(ellipse at 50% 30%, rgba(255,120,90,.3), #05080c 75%); border: 1px solid rgba(255,255,255,.12); }
.rv-card.allies .rv-pt { background: radial-gradient(ellipse at 50% 30%, rgba(90,180,255,.3), #05080c 75%); }
.rv-pt svg { width: 100%; height: 100%; }
.rv-info { flex: 1; min-width: 0; }
.rv-rank { font-size: .64rem; font-weight: 700; letter-spacing: .26em; text-transform: uppercase; color: #ff8a7a; }
.rv-card.allies .rv-rank { color: #8cc8ff; }
.rv-name { font-size: 1.12rem; font-weight: 700; letter-spacing: .04em; line-height: 1.2; margin: .15rem 0 .25rem; }
.rv-name em { font-style: normal; color: #ffd34d; }
.rv-pers { font-size: .78rem; color: var(--text-2, #b6c3d1); line-height: 1.3; }
.rv-pers b { color: #fff; }
.rv-stats { display: flex; gap: .8rem; margin-top: .45rem; font-family: var(--mono, monospace); font-size: .8rem; color: #dfe8f2; flex-wrap: wrap; }
.rv-stats span em { font-style: normal; color: var(--muted, #7d8c9d); font-family: var(--font, sans-serif); font-size: .62rem; letter-spacing: .16em; text-transform: uppercase; margin-right: .25rem; }
.rv-tags { display: flex; flex-wrap: wrap; gap: .25rem; margin-top: .45rem; }
.rv-tags i { font-style: normal; font-size: .62rem; letter-spacing: .12em; text-transform: uppercase; padding: .12rem .4rem; border-radius: .3rem; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12); color: #cfd8e2; }
.rv-tags i.t { color: #ffd34d; border-color: rgba(255,211,77,.4); }
.rv-tags i.k { color: #ff8a7a; border-color: rgba(255,90,70,.4); }
.rv-hist { display: flex; gap: .2rem; margin-top: .45rem; }
.rv-hist b { width: 1.05rem; height: 1.05rem; border-radius: .22rem; font-size: .62rem; display: flex; align-items: center; justify-content: center; }
.rv-hist b.w { background: rgba(255,74,58,.22); color: #ff9a8a; } .rv-hist b.l { background: rgba(77,255,154,.16); color: #8dffb0; }
.rv-plan { margin-top: .45rem; font-size: .74rem; color: #c8b070; font-style: italic; line-height: 1.3; }
.rv-act { margin-top: .55rem; display: flex; gap: .4rem; }
.rv-btn { height: 2.2rem; padding: 0 .9rem; border-radius: .5rem; cursor: pointer; font: inherit; font-size: .74rem; font-weight: 700; letter-spacing: .2em; text-transform: uppercase;
  color: #fff; background: rgba(255,90,70,.18); border: 1px solid rgba(255,90,70,.55); transition: all .2s; }
.rv-btn:hover { background: rgba(255,90,70,.34); }
.rv-btn.ghost { background: rgba(255,255,255,.05); border-color: rgba(255,255,255,.15); color: #dfe8f2; }
.rv-file { min-height: 0; overflow-y: auto; padding: 1rem; border-radius: .9rem; background: linear-gradient(180deg, rgba(20,28,39,.9), rgba(8,12,18,.93)); border: 1px solid rgba(255,255,255,.08); }
.rv-file h4 { margin: 0 0 .6rem; font-size: .7rem; letter-spacing: .3em; text-transform: uppercase; color: rgb(var(--accent-rgb, 90,180,255)); }
.rv-bar { display: grid; grid-template-columns: 5.2rem 1fr 2.6rem; gap: .4rem; align-items: center; font-size: .76rem; margin: .3rem 0; color: #b6c3d1; }
.rv-bar .tr { height: .4rem; border-radius: 1rem; background: rgba(255,255,255,.07); overflow: hidden; }
.rv-bar .tr i { display: block; height: 100%; background: linear-gradient(90deg, #ff7a5a, #ffd34d); }
.rv-bar b { font-family: var(--mono, monospace); font-weight: 400; color: #fff; text-align: right; }
.rv-note { font-size: .78rem; color: #9fb0c2; line-height: 1.4; margin-top: .7rem; }
/* opponent row chip (skirmish setup) */
.rv-chip { display: flex; align-items: center; gap: .45rem; min-width: 0; height: 2.3rem; padding: 0 .55rem 0 .2rem; border-radius: .55rem; cursor: pointer; font: inherit; color: #fff;
  background: linear-gradient(90deg, rgba(255,90,70,.22), rgba(255,255,255,.03)); border: 1px solid rgba(255,90,70,.5); }
.rv-chip.allies { background: linear-gradient(90deg, rgba(90,180,255,.22), rgba(255,255,255,.03)); border-color: rgba(90,180,255,.5); }
.rv-chip .rv-mini { width: 1.9rem; height: 2.1rem; border-radius: .35rem; overflow: hidden; flex-shrink: 0; background: #05080c; }
.rv-chip .rv-mini svg { width: 100%; height: 100%; }
.rv-chip span { min-width: 0; text-align: left; line-height: 1.05; }
.rv-chip b { display: block; font-size: .74rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rv-chip small { display: block; font-size: .56rem; letter-spacing: .14em; text-transform: uppercase; color: #ffb0a0; white-space: nowrap; }
.opponent .op-diff[style*="--n: 5"] button, .opponent .op-diff[style*="--n:5"] button { font-size: .7rem; padding: 0 .1rem; }
.opponent[data-diff='rival'] .op-diff .seg-thumb { background: linear-gradient(180deg, rgba(255,207,63,.5), rgba(255,140,40,.22)); box-shadow: 0 0 .8rem rgba(255,180,60,.4), inset 0 0 0 1px rgba(255,207,63,.8); }
/* in-match radio (same look as the mission radio) */
.rv-tx { position: absolute; left: 12px; bottom: 14px; width: 440px; z-index: 7; pointer-events: none; display: flex; gap: 12px;
  background: linear-gradient(180deg, rgba(34,16,14,0.92), rgba(11,8,8,0.9)); border: 1px solid rgba(255,90,70,0.25); border-radius: 12px; padding: 12px;
  box-shadow: 0 10px 40px rgba(0,0,0,0.55); transform: translateY(20px); opacity: 0; transition: transform 0.35s cubic-bezier(.2,.8,.2,1), opacity 0.35s, bottom 0.3s ease; font-family: var(--font, sans-serif); }
body:not(.hud-modern):has(#selpanel.on) .rv-tx, body:not(.hud-modern):has(#groups.on) .rv-tx { bottom: calc(var(--dock-h, 128px) + 22px); }
body:not(.hud-modern):has(#selpanel.on):has(#groups.on) .rv-tx { bottom: 182px; }
/* [HUD] Modern layout: above the minimap / build bar, sized with the HUD */
body.hud-modern .rv-tx { left: var(--edge, 0.7rem); bottom: calc(var(--dock-h, 16rem) + var(--edge, 0.7rem) * 2 + var(--bot, 0px)); width: min(29rem, calc(100vw - 2 * var(--edge, 0.7rem))); gap: 0.75rem; padding: 0.75rem; border-radius: 0.8rem; }
body.hud-modern .rv-tx .pt { width: 4.6rem; height: 5.4rem; border-radius: 0.5rem; }
body.hud-modern .rv-tx .sp { font-size: 0.68rem; }
body.hud-modern .rv-tx .tt { font-size: 0.92rem; }
.rv-tx.on { transform: none; opacity: 1; }
.rv-tx .pt { width: 74px; height: 86px; flex-shrink: 0; border-radius: 8px; overflow: hidden; background: radial-gradient(ellipse at 50% 30%, rgba(255,90,70,0.35), #05080c 75%); border: 1px solid rgba(255,90,70,0.4); }
.rv-tx .pt svg { width: 100%; height: 100%; }
.rv-tx .sp { font-size: 11px; letter-spacing: 0.24em; color: #ff8a7a; font-weight: 700; margin-bottom: 4px; }
.rv-tx .tt { font-size: 15px; line-height: 1.38; color: #f2e8e4; min-height: 2.6em; }
.rv-tx .sys { color: #ffd34d; font-style: italic; }
body.cine-active .rv-tx { opacity: 0 !important; }
`;

function injectCss() {
  if (document.getElementById('rv-style')) return;
  const st = document.createElement('style');
  st.id = 'rv-style';
  st.textContent = CSS;
  document.head.appendChild(st);
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// ---------------------------------------------------------------------------
// Procedural portrait (bust style of the campaign cast, src/ui/campaign.ts)
// ---------------------------------------------------------------------------
const SKIN = ['#e2c2ad', '#d4ae96', '#c79a86', '#a8785e', '#7a5440'];
const HAIR = ['#2a1c16', '#4a3a30', '#8a6a40', '#c9a14a', '#9a9a9a', '#e6e6e6'];
const COAT: Record<Faction, string[]> = { soviet: ['#5a2a26', '#4a3f2c', '#3a3f2c', '#4a2420'], allies: ['#2c3440', '#3a4a5a', '#4a5a3c', '#33402e'] };

export function rivalPortraitSvg(p: PortraitSpec, faction: Faction, rank = 0, scarred = false): string {
  const skin = SKIN[p.skin % SKIN.length], hair = HAIR[p.hair % HAIR.length], coat = COAT[faction][p.seed % 4];
  const sov = faction === 'soviet';
  const accent = sov ? '#ff4a3a' : '#ffd34d';
  let s = `<path d="M6 104 C8 74 22 62 42 62 C62 62 76 74 78 104 Z" fill="${coat}"/><rect x="35" y="52" width="14" height="14" rx="3" fill="${skin}" opacity=".9"/>`;
  s += `<path d="M32 64 L42 74 L52 64" fill="${sov ? '#2a1412' : '#e6e9ee'}"/>`;
  // epaulettes: one star per rank
  for (let k = 0; k < Math.min(rank, 5); k++) s += `<circle cx="${17 + k * 2.6}" cy="${71 - k * 0.6}" r="1.05" fill="${accent}"/><circle cx="${67 - k * 2.6}" cy="${71 - k * 0.6}" r="1.05" fill="${accent}"/>`;
  // medals
  for (let k = 0; k < Math.min(rank, 4); k++) s += `<rect x="${26 + k * 4}" y="78" width="3" height="5" fill="${['#c94a3a', '#3a6ac9', '#d8b04a', '#4ac97a'][k]}"/><circle cx="${27.5 + k * 4}" cy="85" r="1.6" fill="#d8b04a"/>`;
  s += `<ellipse cx="42" cy="40" rx="15" ry="17.5" fill="${skin}"/>`;
  const hat = p.hat % 4;
  if (hat === 3 || hat === 1) s += `<path d="M26 40 C22 20 62 18 58 40 C56 30 50 26 42 26 C34 26 28 30 26 40Z" fill="${hair}"/>`;
  // eyes / eyewear
  const eye = p.eyewear % 6;
  if (eye === 3) s += `<circle cx="47.5" cy="40" r="1.6" fill="#1b2430"/><path d="M30 34 L54 42" stroke="#111" stroke-width="1.2"/><ellipse cx="36.5" cy="40" rx="4.2" ry="3.4" fill="#111"/>`;
  else s += `<circle cx="36.5" cy="40" r="1.6" fill="#1b2430"/><circle cx="47.5" cy="40" r="1.6" fill="#1b2430"/>`;
  if (eye === 1) s += `<circle cx="47.5" cy="40" r="4.4" fill="none" stroke="#d8b04a" stroke-width="1.2"/><path d="M51.5 42 Q54 52 50 60" stroke="#d8b04a" stroke-width=".6" fill="none"/>`;
  if (eye === 2) s += `<rect x="31" y="37.5" width="10" height="5.5" rx="2" fill="none" stroke="#222" stroke-width="1.2"/><rect x="43" y="37.5" width="10" height="5.5" rx="2" fill="none" stroke="#222" stroke-width="1.2"/><path d="M41 40 L43 40" stroke="#222" stroke-width="1.2"/>`;
  if (eye === 4) s += `<rect x="30.5" y="37" width="11" height="6" rx="2.5" fill="#111"/><rect x="42.5" y="37" width="11" height="6" rx="2.5" fill="#111"/><path d="M41.5 39.5 L42.5 39.5" stroke="#111" stroke-width="1.5"/>`;
  // brows and mouth: everyone looks a little smug
  s += `<path d="M32 34.5 L40 35.8 M44 35.8 L52 34.5" stroke="${hair}" stroke-width="1.8"/><path d="M37 50 Q42 52.5 48 49.5" stroke="#6a3a3a" stroke-width="1.6" fill="none"/>`;
  const facial = p.facial % 10;
  if (facial === 1) s += `<path d="M35 47.5 C38 45.5 46 45.5 49 47.5 C47 49 37 49 35 47.5Z" fill="${hair}"/>`;
  if (facial === 2) s += `<path d="M28 44 C28 58 34 60 42 60 C50 60 56 58 56 44 C54 52 50 54 42 54 C34 54 30 52 28 44Z" fill="${hair}"/>`;
  if (facial === 3) s += `<path d="M30 46 C31 56 36 58 42 58 C48 58 53 56 54 46" stroke="${hair}" stroke-width="3" fill="none" opacity=".35"/>`;
  if (facial === 4) s += `<path d="M36 47 Q42 45.5 48 47" stroke="${hair}" stroke-width="1.4" fill="none"/>`;
  if (scarred || facial === 9) s += `<path d="M48 31 L53 47 M50 34 l2 -.6 M51.5 39 l2 -.6 M52.6 43 l2 -.6" stroke="#9a4a4a" stroke-width="1.3"/>`;
  // headgear
  if (hat === 0) s += `<path d="M20 30 C20 15 64 15 64 30 L66 31 C60 34 24 34 18 31Z" fill="${sov ? '#4a2420' : coat}"/><rect x="22" y="27" width="40" height="6" rx="2" fill="${sov ? '#2a1412' : '#1c232c'}"/><path d="M24 33 L60 33 L58 36 L26 36Z" fill="#111"/><circle cx="42" cy="23" r="2.8" fill="${accent}"/>`;
  if (hat === 1) s += `<path d="M24 30 C26 18 58 16 62 26 C62 30 30 32 24 30Z" fill="${sov ? '#6b1f1f' : '#2a3a6a'}"/><circle cx="31" cy="28" r="2.2" fill="${accent}"/>`;
  if (hat === 2) {
    if (sov) s += `<path d="M20 38 C16 18 68 18 64 38 L60 38 C60 28 24 28 24 38Z" fill="#6a5a46"/><path d="M18 34 C18 20 66 20 66 34 C60 26 24 26 18 34Z" fill="#8a7a62"/><path d="M18 36 L18 54 C22 56 26 52 25 44Z M66 36 L66 54 C62 56 58 52 59 44Z" fill="#6a5a46"/><circle cx="42" cy="26" r="2.6" fill="${accent}"/>`;
    else s += `<path d="M22 34 C22 14 62 14 62 34 L66 36 L18 36Z" fill="#4a5a3c"/><path d="M18 36 L66 36" stroke="#2f3828" stroke-width="2"/>`;
  }
  return `<svg viewBox="0 0 84 98" xmlns="http://www.w3.org/2000/svg">${s}</svg>`;
}

function rivalSvg(r: Rival): string {
  return rivalPortraitSvg(r.portrait, r.faction, r.rank, r.returns > 0);
}

// ---------------------------------------------------------------------------
// Rivals board
// ---------------------------------------------------------------------------
const pct = (x: number) => `${Math.round(Math.max(0, Math.min(1, x)) * 100)}%`;

/** Full-screen rivals board. `onChallenge` adds a "Challenge" button per active rival (skirmish setup). */
export function showRivals(opts: { onBack(): void; play?(k: 'click' | 'tab' | 'hover'): void; onChallenge?(id: string): void; current?: string }): () => void {
  injectCss();
  const store = loadRivals();
  ensureRoster(store);
  saveRivals(store);
  const root = document.createElement('div');
  root.className = 'rv';
  const player = loadProfile().name || 'Commander';
  const h = store.habits;
  const fav = favouriteUnit(h);
  const cards = rosterOrder(store).map((r, i) => {
    const pers = PERSONALITIES[r.personality];
    const plan = r.status === 'active' ? counterPlan(r, habitsFor(store, r)).notes[0] : '';
    const hist = r.history.slice(-8).map((b) => `<b class="${b.rivalWon ? 'w' : 'l'}" title="${esc(b.note)} · ${b.minutes} min">${b.rivalWon ? 'W' : 'L'}</b>`).join('');
    const tags = [...r.titles.map((t) => `<i class="t">${esc(t)}</i>`), ...r.traits.map((t) => `<i>${esc(t)}</i>`), r.status === 'dead' ? '<i class="k">Killed in action</i>' : ''].join('');
    const act = r.status === 'active' ? `<div class="rv-act">${opts.onChallenge ? `<button class="rv-btn" data-ch="${r.id}">${opts.current === r.id ? 'Selected' : 'Challenge'}</button>` : ''}</div>` : '';
    return `<div class="rv-card ${r.faction}${r.status === 'dead' ? ' dead' : ''}${r.id === store.nemesis ? ' nemesis' : ''}" style="--i:${i}">
      <div class="rv-pt">${rivalSvg(r)}</div>
      <div class="rv-info"><div class="rv-rank">${esc(rankName(r))} · ${r.faction === 'soviet' ? 'Soviet' : 'Allied'}${r.id === store.nemesis ? ' · Nemesis' : ''}</div>
        <div class="rv-name">${esc(r.first)} <em>'${esc(r.nick)}'</em> ${esc(r.last)}</div>
        <div class="rv-pers"><b>${esc(pers?.name ?? r.personality)}</b> — ${esc(pers?.blurb ?? '')}</div>
        <div class="rv-stats"><span><em>vs you</em>${r.wins}–${r.losses}</span><span><em>AI</em>${rivalDifficulty(r)}</span>${r.returns ? `<span><em>returned</em>${r.returns}×</span>` : ''}</div>
        ${tags ? `<div class="rv-tags">${tags}</div>` : ''}${hist ? `<div class="rv-hist">${hist}</div>` : ''}
        ${plan ? `<div class="rv-plan">“${esc(plan)}”</div>` : ''}${act}
      </div></div>`;
  }).join('');
  const bars = ([['Infantry', h.infantry], ['Armour', h.armour], ['Artillery', h.artillery], ['Air', h.air], ['Naval', h.naval], ['Defences', h.defence]] as [string, number][])
    .map(([k, v]) => `<div class="rv-bar"><span>${k}</span><span class="tr"><i style="width:${pct(v)}"></i></span><b>${pct(v)}</b></div>`).join('');
  root.innerHTML = `
    <div class="rv-head"><div><small>Persistent enemy commanders</small><h2>Rivals</h2></div><span class="sp"></span><button class="rv-btn ghost" data-act="back">Back · Esc</button></div>
    <div class="rv-body"><div class="rv-list">${cards}</div>
      <div class="rv-file"><h4>Their file on ${esc(player)}</h4>
        ${h.games ? `${bars}<div class="rv-note">First strike at about <b>${h.rushMinute.toFixed(1)} min</b>. ${fav ? `Favourite: <b>${esc(UNITS[fav]?.name ?? fav)}</b>. ` : ''}${h.superweapons >= 0.3 ? 'Uses superweapons. ' : ''}Studied over ${h.games} battle${h.games === 1 ? '' : 's'}.</div>`
          : '<div class="rv-note">No battles on file yet. Every skirmish you fight, they watch: how you build, how early you strike, what you love to field.</div>'}
        <div class="rv-note">Pick <b>Rival</b> as an opponent's difficulty in the skirmish setup to face one. Win and they fall back, lose and they climb the ranks; the beaten may return, scarred and vengeful.</div>
      </div></div>`;
  document.body.appendChild(root);
  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    root.classList.add('leaving');
    setTimeout(() => root.remove(), 250);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !root.isConnected) return;
    e.preventDefault();
    e.stopPropagation();
    opts.play?.('click');
    close();
    opts.onBack();
  };
  document.addEventListener('keydown', onKey, true);
  (root.querySelector('[data-act="back"]') as HTMLElement).onclick = () => { opts.play?.('click'); close(); opts.onBack(); };
  root.querySelectorAll<HTMLElement>('[data-ch]').forEach((b) => (b.onclick = () => { opts.play?.('click'); close(); opts.onChallenge?.(b.dataset.ch!); }));
  return close;
}

// ---------------------------------------------------------------------------
// Skirmish setup: the opponent row
// ---------------------------------------------------------------------------
export interface RivalOpponentPrefs {
  faction: Faction | 'random';
  difficulty: AIDifficulty;
  /** Chosen rival (skirmish prefs); resolved into OpponentSetup.rival / personality at deploy. */
  rivalId?: string;
}

/** Difficulty seg change: 'rival' picks the nemesis (or keeps the chosen rival); anything else clears it. */
export function setOpponentKind(o: RivalOpponentPrefs, v: AIDifficulty | 'rival') {
  if (v !== 'rival') { o.rivalId = undefined; o.difficulty = v; return; }
  const store = loadRivals();
  ensureRoster(store);
  saveRivals(store);
  if (!o.rivalId || !store.rivals.some((r) => r.id === o.rivalId && r.status === 'active')) o.rivalId = store.nemesis;
}

/** The chip shown instead of the faction choice when an opponent is a rival (click: pick another on the board). */
export function rivalChip(o: RivalOpponentPrefs, rerender: () => void, play?: (k: 'click') => void): HTMLElement {
  injectCss();
  const store = loadRivals();
  ensureRoster(store);
  let r = store.rivals.find((x) => x.id === o.rivalId && x.status === 'active');
  if (!r) { r = store.rivals.find((x) => x.id === store.nemesis) ?? store.rivals.find((x) => x.status === 'active'); o.rivalId = r?.id; }
  const b = document.createElement('button');
  b.className = `rv-chip ${r?.faction ?? ''}`;
  b.title = 'Choose your rival';
  b.innerHTML = r ? `<span class="rv-mini">${rivalSvg(r)}</span><span><b>${esc(callSign(r))}</b><small>${esc(PERSONALITIES[r.personality]?.name ?? '')} · ${r.wins}–${r.losses}</small></span>` : '<span><b>No rival</b></span>';
  b.onclick = () => {
    play?.('click');
    showRivals({ onBack: () => {}, onChallenge: (id) => { o.rivalId = id; rerender(); }, current: o.rivalId });
  };
  return b;
}

/**
 * Deploy: turn a "Rival" opponent into a full OpponentSetup (faction, difficulty, personality with the counter-plan,
 * rival ref). Decided here, before the match, so the setup (and its replay) carries everything.
 */
export function resolveRivalOpponent(o: RivalOpponentPrefs): { faction: Faction | 'random'; difficulty: AIDifficulty; personality?: Personality; rival?: RivalRef } {
  const { rivalId, ...plain } = o;
  if (!rivalId) return plain;
  const store = loadRivals();
  ensureRoster(store);
  const id = store.rivals.some((r) => r.id === rivalId && r.status === 'active') ? rivalId : store.nemesis;
  const prep = id ? prepareRivalOpponent(store, id, loadProfile().name || 'Commander') : null;
  saveRivals(store);
  if (!prep) return plain;
  return { faction: prep.faction, difficulty: prep.difficulty, personality: prep.personality, rival: prep.rival };
}

// ---------------------------------------------------------------------------
// In-match: rival radio + habit tracking (attached to every skirmish by game.ts)
// ---------------------------------------------------------------------------
interface GameLike {
  world: World;
  local: Player;
  setup: { opponents: { rival?: RivalRef }[]; demo?: boolean; replay?: unknown; load?: unknown };
  paused?: boolean;
}

const DEFENCE = new Set(['pbox', 'hbox', 'gun', 'agun', 'ftur', 'tsla', 'sam', 'gap']);
const SUBTERFUGE = new Set(['spy', 'thf', 'mnly']);

/** Radio for rival opponents and the player-habit tracker for every skirmish. Returns an attachment (dispose). */
export function attachRivals(game: GameLike): { dispose(): void } {
  const w = game.world;
  const me = game.local;
  // rival opponents: setup.opponents[i] is player i + 1
  const rivals = game.setup.opponents.map((o, i) => (o.rival ? { ref: o.rival, player: w.players[i + 1] } : null)).filter((x): x is { ref: RivalRef; player: Player } => !!x && !!x.player);
  const playerName = loadProfile().name || 'Commander';
  const hab: MatchHabits = { built: {}, infantry: 0, armour: 0, artillery: 0, air: 0, naval: 0, defenceValue: 0, structureValue: 0, rushMinute: -1, superweapons: 0, subterfuge: 0 };
  const seenUnits = new Set<number>();
  const seenBld = new Set<number>();
  for (const u of w.units) seenUnits.add(u.id); // the starting kit is no choice
  for (const b of w.buildings) seenBld.add(b.id);
  const lastCharge: Record<string, number> = {};
  const peak = new Map<number, number>();
  const said = new Map<string, number>();
  const chatSeen = new Map<number, number>();
  let tx: HTMLElement | null = null;
  const queue: { who: string; svg: string; text: string; sys?: boolean }[] = [];
  let showing = 0, lastLine = -1e9, done = false;
  const fresh = !game.setup.load;

  if (rivals.length) {
    injectCss();
    tx = document.createElement('div');
    tx.className = 'rv-tx';
    (document.getElementById('ui') ?? document.body).appendChild(tx);
  }
  const svgOf = (ref: RivalRef) => rivalPortraitSvg(ref.portrait, ref.faction, Math.max(0, ['Lieutenant', 'Captain', 'Major', 'Colonel', 'General', 'Marshal', 'Field Marshal'].indexOf(ref.rank)), ref.returns > 0);
  const say = (ref: RivalRef, text: string, sys = false) => {
    queue.push({ who: sys ? 'Battle control' : ref.name, svg: svgOf(ref), text, sys });
  };
  const sayEvent = (r: { ref: RivalRef }, ev: TauntEvent, gap = 35) => {
    const k = `${r.ref.id}:${ev}`;
    const n = said.get(k) ?? 0;
    if (w.time - lastLine < gap && ev !== 'won' && ev !== 'lost') return;
    said.set(k, n + 1);
    lastLine = w.time;
    say(r.ref, taunt(ev, n, { player: playerName, rival: r.ref.name.split(' ').slice(-1)[0] }));
  };

  const track = () => {
    for (const u of w.units) {
      if (u.owner !== me || seenUnits.has(u.id)) continue;
      seenUnits.add(u.id);
      const t = u.ut;
      if (t.harvester || t.deploysInto || t.supportPlane) continue;
      hab.built[t.id] = (hab.built[t.id] ?? 0) + t.cost;
      if (SUBTERFUGE.has(t.id)) hab.subterfuge++;
      if (t.kind === 'aircraft') hab.air += t.cost;
      else if (t.kind === 'naval') hab.naval += t.cost;
      else if (t.kind === 'infantry') hab.infantry += t.cost;
      else if (t.noMovingFire) hab.artillery += t.cost;
      else hab.armour += t.cost;
    }
    for (const b of w.buildings) {
      if (b.owner !== me || seenBld.has(b.id)) continue;
      seenBld.add(b.id);
      if (b.bt.mine || b.bt.wall) continue;
      hab.structureValue += b.bt.cost;
      if (DEFENCE.has(b.bt.id) || (b.weapons.length && !b.bt.factory)) hab.defenceValue += b.bt.cost;
    }
    // first strike on an enemy structure
    if (hab.rushMinute < 0) {
      for (const b of w.buildings) {
        if (!b.alive || !me.isEnemy(b.owner) || w.tick - b.lastDamagedTick > 12) continue;
        const a = w.entities.get(b.lastAttacker);
        if (a && a.owner === me) { hab.rushMinute = w.time / 60; break; }
      }
    }
    for (const k of ['nuke', 'ironcurtain', 'chrono'] as const) {
      const c = me.superCharge[k];
      if ((lastCharge[k] ?? 0) > 30 && c < 1) hab.superweapons++;
      lastCharge[k] = c;
    }
  };

  const radio = () => {
    for (const r of rivals) {
      const ai = w.ais.find((a) => a.player === r.player);
      const pid = r.player.id;
      if (!r.player.defeated && ai) {
        const from = chatSeen.get(pid) ?? (fresh ? -1 : w.tick);
        for (const c of ai.chatter) {
          if (c.tick <= from) continue;
          const ev: TauntEvent | null = c.kind === 'scouted' ? 'contact' : c.kind === 'attack' ? 'attack' : c.kind === 'flank' ? 'flank' : c.kind === 'harass' ? 'harass'
            : c.kind === 'nuke' ? 'nuke' : c.kind === 'ironcurtain' ? 'ironcurtain' : c.kind === 'fallback' ? 'fallback' : c.kind === 'expand' ? 'expand' : null;
          if (ev) sayEvent(r, ev, ev === 'nuke' || ev === 'contact' ? 0 : 35);
        }
        if (ai.chatter.length) chatSeen.set(pid, ai.chatter[ai.chatter.length - 1].tick);
      }
      // structures: first blood, losing, winning
      let theirs = 0, mine = 0;
      for (const b of w.buildings) {
        if (!b.alive || b.bt.wall || b.bt.mine) continue;
        if (b.owner === r.player) theirs++;
        else if (b.owner === me) mine++;
        if (b.owner === r.player && w.tick - b.lastDamagedTick < 12 && !said.has(`${r.ref.id}:firstBlood`)) {
          const a = w.entities.get(b.lastAttacker);
          if (a && a.owner === me) sayEvent(r, 'firstBlood', 0);
        }
      }
      peak.set(pid, Math.max(peak.get(pid) ?? 0, theirs));
      peak.set(-1, Math.max(peak.get(-1) ?? 0, mine));
      if (theirs >= 1 && theirs < (peak.get(pid) ?? 0) * 0.5 && !said.has(`${r.ref.id}:losing`)) sayEvent(r, 'losing', 0);
      if (mine < (peak.get(-1) ?? 0) * 0.5 && w.time > 300 && !said.has(`${r.ref.id}:winning`)) sayEvent(r, 'winning', 0);
    }
  };

  const finishPlain = () => {
    if (done) return;
    done = true;
    if (w.time < 120) return;
    const store = loadRivals();
    recordHabits(store, hab);
    saveRivals(store);
  };

  let last = performance.now();
  const timer = window.setInterval(() => {
    const now = performance.now();
    const dt = Math.min(1, (now - last) / 1000);
    last = now;
    if (!done) track();
    if (w.gameOver && !done) {
      if (rivals.length) finishRivals();
      else finishPlain();
    }
    if (!rivals.length || !tx) return;
    if (!done && fresh && w.time > 2.5 && !said.has('intro')) {
      said.set('intro', 1);
      for (const r of rivals) say(r.ref, r.ref.intro);
    }
    if (!done && !w.gameOver) radio();
    // show queued lines one at a time
    if (showing > 0) {
      showing -= dt;
      if (showing <= 0) tx.classList.remove('on');
    } else if (queue.length && !game.paused) {
      const m = queue.shift()!;
      tx.innerHTML = `<div class="pt">${m.svg}</div><div style="flex:1"><div class="sp">${esc(m.who.toUpperCase())}</div><div class="tt${m.sys ? ' sys' : ''}">${esc(m.text)}</div></div>`;
      tx.classList.add('on');
      showing = 3.2 + m.text.length * 0.045;
    }
  }, 250);
  const finishRivals = () => {
    if (done) return;
    done = true;
    const won = w.winnerTeam === me.team;
    const store: RivalStore = loadRivals();
    recordHabits(store, hab);
    rivals.forEach((r) => {
      const out = recordRivalBattle(store, r.ref.id, { rivalWon: !won, minutes: w.time / 60, playerFaction: me.faction, plan: r.ref.plan, habits: hab });
      if (!out) return;
      sayEvent(r, won ? 'lost' : 'won', 0);
      const name = callSign(out.rival);
      say(r.ref, out.killed ? `${r.ref.name} is confirmed killed in action.` : out.promoted ? `${name} has been promoted to ${rankName(out.rival)}${out.newTitle ? `, now called "${out.newTitle}"` : ''}.` : out.demoted ? `${r.ref.name} has been demoted to ${rankName(out.rival)}.` : `${name} holds the line.`, true);
      for (const n of out.risen) if (n.id !== r.ref.id) say(r.ref, `A new rival rises: ${rivalName(n)}.`, true);
    });
    saveRivals(store);
  };
  return {
    dispose() {
      window.clearInterval(timer);
      tx?.remove();
    },
  };
}

void BUILDINGS;
