/**
 * Commander profile: rank insignia & XP, service record, wins by faction / difficulty, the medal
 * case (earned, in progress, locked, classified) and the last 20 operations.
 */
import {
  RANKS, allAchievementStates, achievementDesc, achievementMetal, achievementRarity, favouriteUnit, insigniaSvg, loadProfile, medalSvg, medalTotals,
  picto, rankName, rankProgress, setCommanderName, TIER_NAMES, type AchievementState, type MatchRecord, type Profile,
} from '../meta';
import { star } from '../meta/art';
import { UNITS } from '../data/rules';
import { formatTime } from '../core/util';
import { showRivals } from './rivals';
import { CONTRACT_BY_ID, canReroll, contractDesc, contractReward, fmtContractValue, profileWithContracts, rerollContractNow, unlockContext, unseenUnlocks, type Cadence } from '../meta';
import { commanderLook } from '../meta/cosmetics'; // portrait, banner, title
import { showLocker } from './locker';

type PlayKey = 'click' | 'tab' | 'hover';

const CSS = `
.pf { position: fixed; inset: 0; z-index: 22; display: grid; grid-template-columns: minmax(23rem, 30rem) minmax(0, 1fr); gap: 1.2rem; padding: 4.2vh 3.2vw 3.6vh;
  background: radial-gradient(ellipse at 22% 30%, rgba(var(--accent-rgb, 90,180,255), .1), transparent 50%), radial-gradient(ellipse at 30% 40%, rgba(0,0,0,.3), rgba(0,0,0,.86) 75%);
  font-family: var(--font, sans-serif); color: var(--text, #e9f0f7); animation: pfIn .45s ease-out; overflow: hidden; }
.pf.leaving { animation: pfOut .3s ease-in forwards; }
@keyframes pfIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes pfOut { to { opacity: 0; } }
.pf-col { display: flex; flex-direction: column; gap: 1rem; min-height: 0; }
.pf-panel { position: relative; background: linear-gradient(180deg, rgba(20,28,39,.9), rgba(8,12,18,.93)); border: 1px solid rgba(255,255,255,.08); border-radius: 1rem; padding: 1.05rem 1.15rem;
  box-shadow: 0 1.4rem 3.5rem rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.05); animation: pfUp .6s var(--ease, ease-out) both; }
.pf-col > .pf-panel:nth-child(2) { animation-delay: .07s; } .pf-col > .pf-panel:nth-child(3) { animation-delay: .14s; }
@keyframes pfUp { from { opacity: 0; transform: translateY(1rem); } }
.pf-h2 { display: flex; align-items: center; gap: .55rem; margin: 0 0 .8rem; font-size: .72rem; font-weight: 700; letter-spacing: .32em; text-transform: uppercase; color: rgb(var(--accent-rgb, 90,180,255)); }
.pf-h2 .mx-ic { font-size: 1rem; }
.pf-h2 .sp { flex: 1; height: 1px; background: linear-gradient(90deg, rgba(var(--accent-rgb, 90,180,255), .45), transparent); }
.pf-h2 small { font-family: var(--mono, monospace); font-size: .78rem; letter-spacing: .04em; color: var(--muted, #7d8c9d); text-transform: none; }

/* commander card */
.pf-cmd { overflow: hidden; padding: 1.3rem 1.3rem 1.15rem; background: radial-gradient(ellipse at 18% 30%, rgba(255,207,63,.16), transparent 55%), linear-gradient(180deg, rgba(24,30,40,.94), rgba(8,12,18,.95)); }
.pf-cmd::after { content: ''; position: absolute; inset: 0; pointer-events: none; background: repeating-linear-gradient(0deg, rgba(255,255,255,.015) 0 1px, transparent 1px 3px); }
.pf-cmd-top { display: flex; gap: 1.15rem; align-items: center; }
.pf-ins { position: relative; width: 7.2rem; height: 7.2rem; flex-shrink: 0; }
.pf-ins > svg { position: relative; width: 100%; height: 100%; filter: drop-shadow(0 .5rem 1rem rgba(0,0,0,.6)); animation: pfIns .9s .15s cubic-bezier(.2,1.5,.3,1) both; }
.pf-ins::before { content: ''; position: absolute; inset: -18%; border-radius: 50%; background: radial-gradient(circle, rgba(255,207,63,.32), transparent 62%); animation: pfGlow 3.5s ease-in-out infinite alternate; }
@keyframes pfIns { from { transform: scale(.4) rotate(-12deg); opacity: 0; } }
@keyframes pfGlow { from { opacity: .55; transform: scale(.94); } to { opacity: 1; transform: scale(1.04); } }
.pf-id { min-width: 0; flex: 1; }
.pf-kick { font-size: .66rem; font-weight: 700; letter-spacing: .34em; text-transform: uppercase; color: var(--muted, #7d8c9d); }
.pf-rank { font-size: 1.05rem; font-weight: 700; letter-spacing: .2em; text-transform: uppercase; color: #ffd34d; margin-top: .3rem; text-shadow: 0 0 1rem rgba(255,207,63,.35); }
.pf-ru { font-family: var(--mono, monospace); font-size: .72rem; color: #b89a52; letter-spacing: .06em; }
.pf-name { display: flex; align-items: center; gap: .5rem; margin-top: .15rem; font-size: 2.1rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; line-height: 1.05; cursor: text; }
.pf-name span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pf-name .mx-ic { font-size: .95rem; color: var(--muted, #7d8c9d); opacity: 0; transition: opacity .2s; flex-shrink: 0; }
.pf-name:hover .mx-ic { opacity: 1; }
.pf-name input { width: 100%; font: inherit; letter-spacing: inherit; text-transform: uppercase; color: #fff; background: rgba(0,0,0,.35); border: 1px solid rgba(255,207,63,.5); border-radius: .4rem; padding: 0 .4rem; outline: none; }
.pf-xp { margin-top: 1.05rem; }
.pf-xp-row { display: flex; justify-content: space-between; align-items: baseline; font-size: .78rem; color: var(--text-2, #b6c3d1); letter-spacing: .06em; }
.pf-xp-row b { font-family: var(--mono, monospace); font-weight: 400; color: #fff; font-size: .95rem; }
.pf-xp-row small { font-size: .7rem; letter-spacing: .22em; text-transform: uppercase; color: var(--muted, #7d8c9d); }
.pf-bar { position: relative; height: .62rem; margin: .4rem 0 .3rem; border-radius: 1rem; background: rgba(255,255,255,.07); overflow: hidden; box-shadow: inset 0 1px 3px rgba(0,0,0,.6); }
.pf-bar i { position: absolute; inset: 0 auto 0 0; border-radius: 1rem; background: linear-gradient(90deg, #8f5c0f, #ffcf3f 70%, #fff3c4); box-shadow: 0 0 .9rem rgba(255,207,63,.6);
  transform-origin: left; animation: pfBar 1.4s .35s cubic-bezier(.3,.1,.2,1) both; }
.pf-bar i::after { content: ''; position: absolute; inset: 0; background: linear-gradient(100deg, transparent 30%, rgba(255,255,255,.55) 50%, transparent 70%); background-size: 250% 100%; animation: pfSheen 2.8s 1.6s ease-in-out infinite; }
@keyframes pfBar { from { transform: scaleX(0); } }
@keyframes pfSheen { from { background-position: 150% 0; } to { background-position: -100% 0; } }
.pf-ladder { display: flex; gap: .16rem; margin-top: .85rem; }
.pf-ladder span { flex: 1; aspect-ratio: 1; opacity: .26; filter: grayscale(1); transition: transform .2s, opacity .2s; cursor: help; }
.pf-ladder span.on { opacity: 1; filter: none; }
.pf-ladder span.cur { transform: scale(1.32); filter: drop-shadow(0 0 .35rem rgba(255,207,63,.8)); }
.pf-ladder span:hover { opacity: 1; transform: scale(1.4); filter: none; }
.pf-ladder svg { width: 100%; height: 100%; display: block; }

/* banner, portrait, title, Commendations */
.pf-cmd { --banner: none; }
.pf-cmd::before { content: ''; position: absolute; inset: 0; background: var(--banner); opacity: .42; pointer-events: none; }
.pf-cmd > * { position: relative; }
.pf-por { position: relative; width: 6.2rem; height: 7.2rem; flex-shrink: 0; border-radius: .7rem; background: rgba(0,0,0,.35); border: 1px solid rgba(255,255,255,.16); box-shadow: 0 .6rem 1.4rem rgba(0,0,0,.5); }
.pf-por > svg { width: 100%; height: 100%; display: block; border-radius: .7rem; }
.pf-por .pf-ins { position: absolute; right: -.9rem; bottom: -.7rem; width: 3.4rem; height: 3.4rem; }
.pf-title { font-size: .86rem; letter-spacing: .1em; color: #ffe7a0; margin-top: .1rem; }
.pf-cmdn { display: flex; align-items: center; gap: .35rem; margin-top: .55rem; font-family: var(--mono, monospace); font-size: .82rem; color: #ffe27a; }
.pf-cmdn small { font-family: var(--font, sans-serif); font-size: .6rem; font-weight: 700; letter-spacing: .22em; text-transform: uppercase; color: #b89a52; }
.pf-favs .cols { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .6rem; margin-top: .12rem; }
.pf-favs .cols > span { display: flex; flex-direction: column; gap: .12rem; min-width: 0; }
.pf-favs .cols b { font-size: .8rem; letter-spacing: .02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pf-favs .cols u { display: block; height: .22rem; border-radius: 1rem; background: rgba(255,255,255,.07); overflow: hidden; }
.pf-favs .cols u i { display: block; height: 100%; border-radius: 1rem; background: linear-gradient(90deg, #a8741a, #ffcf3f); }
.pf-favs .cols em { font-style: normal; font-family: var(--mono, monospace); font-size: .7rem; color: #ffe27a; }
.pf-mode { display: inline-flex; border-radius: .45rem; overflow: hidden; border: 1px solid rgba(255,255,255,.12); }
.pf-mode button { height: 1.9rem; padding: 0 .8rem; border: 0; cursor: pointer; font: inherit; font-size: .7rem; font-weight: 700; letter-spacing: .2em; text-transform: uppercase; color: #9fb0c2; background: rgba(255,255,255,.03); }
.pf-mode button.on { color: #fff; background: rgba(var(--accent-rgb, 90,180,255), .25); }
.pf-ct { position: relative; display: flex; flex-direction: column; gap: .3rem; padding: .65rem .75rem; border-radius: .7rem; background: linear-gradient(135deg, rgba(var(--accent-rgb, 90,180,255), .08), rgba(255,255,255,.015) 55%); border: 1px solid rgba(255,255,255,.08); animation: pfUp .45s calc(var(--i) * 30ms) both; }
.pf-ct.done { border-color: rgba(77,255,154,.4); background: linear-gradient(135deg, rgba(77,255,154,.1), rgba(255,255,255,.015) 55%); }
.pf-ct-t { display: flex; align-items: center; gap: .45rem; font-size: .95rem; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; }
.pf-ct-t .mx-ic { font-size: 1.2rem; color: rgb(var(--accent-rgb, 90,180,255)); }
.pf-ct.done .pf-ct-t .mx-ic { color: #8dffb0; }
.pf-ct-t em { margin-left: auto; font-style: normal; font-size: .56rem; letter-spacing: .2em; color: var(--muted, #7d8c9d); }
.pf-ct p { margin: 0; font-size: .8rem; color: var(--text-2, #b6c3d1); }
.pf-ct .tr { height: .32rem; border-radius: 1rem; background: rgba(255,255,255,.07); overflow: hidden; }
.pf-ct .tr i { display: block; height: 100%; border-radius: 1rem; background: rgb(var(--accent-rgb, 90,180,255)); }
.pf-ct.done .tr i { background: #4dff9a; }
.pf-ct-f { display: flex; align-items: center; justify-content: space-between; gap: .6rem; font-family: var(--mono, monospace); font-size: .74rem; color: var(--muted, #7d8c9d); white-space: nowrap; }
.pf-ct-f b { font-weight: 400; color: #ffe27a; }
.pf-ct-rr { position: absolute; top: .5rem; right: .55rem; display: inline-flex; align-items: center; gap: .25rem; height: 1.45rem; padding: 0 .45rem; border-radius: .35rem; border: 1px solid rgba(255,255,255,.16); background: rgba(8,12,18,.85); color: #b6c3d1; cursor: pointer; font: inherit; font-size: .6rem; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; }
.pf-ct-rr:hover, .pf-ct-rr:focus-visible { color: #fff; border-color: rgba(var(--accent-rgb, 90,180,255), .7); }
.pf-ct:has(.pf-ct-rr) .pf-ct-t em { visibility: hidden; }
.pf-ct-h { grid-column: 1 / -1; font-size: .62rem; font-weight: 700; letter-spacing: .3em; text-transform: uppercase; color: var(--muted, #7d8c9d); margin-top: .2rem; }
.pf-btn .dot { width: .45rem; height: .45rem; border-radius: 50%; background: #4dff9a; box-shadow: 0 0 .4rem #4dff9a; }

/* service record */
.pf-tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: .5rem; }
.pf-tile { padding: .55rem .65rem .5rem; border-radius: .6rem; background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.06); min-width: 0; }
.pf-tile small { display: flex; align-items: center; gap: .35rem; font-size: .6rem; font-weight: 700; letter-spacing: .2em; text-transform: uppercase; color: var(--muted, #7d8c9d); white-space: nowrap; }
.pf-tile small .mx-ic { font-size: .85rem; color: rgba(var(--accent-rgb, 90,180,255), .85); }
.pf-tile b { display: block; margin-top: .2rem; font-family: var(--mono, monospace); font-weight: 400; font-size: 1.22rem; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pf-tile b em { font-style: normal; font-size: .72rem; color: var(--muted, #7d8c9d); margin-left: .25rem; }
.pf-fav { display: flex; align-items: center; gap: .7rem; margin-top: .55rem; padding: .55rem .7rem; border-radius: .6rem; background: linear-gradient(90deg, rgba(255,207,63,.1), rgba(255,255,255,.02)); border: 1px solid rgba(255,207,63,.18); }
.pf-fav .mx-ic { font-size: 1.6rem; color: #ffd34d; }
.pf-fav span { flex: 1; min-width: 0; }
.pf-fav small { display: block; font-size: .6rem; font-weight: 700; letter-spacing: .24em; text-transform: uppercase; color: #b89a52; }
.pf-fav b { font-size: 1.05rem; letter-spacing: .06em; }
.pf-fav i { font-style: normal; font-family: var(--mono, monospace); color: #ffe27a; }
.pf-bars { display: grid; grid-template-columns: 1fr 1fr; gap: .2rem 1.2rem; }
.pf-bars h5 { grid-column: span 1; margin: 0 0 .25rem; font-size: .6rem; letter-spacing: .26em; text-transform: uppercase; color: var(--muted, #7d8c9d); font-weight: 700; }
.pf-br { display: grid; grid-template-columns: 4.3rem 1fr 3.2rem; align-items: center; gap: .45rem; font-size: .78rem; color: var(--text-2, #b6c3d1); margin: .18rem 0; }
.pf-br .tr { height: .42rem; border-radius: 1rem; background: rgba(255,255,255,.06); overflow: hidden; position: relative; }
.pf-br .tr i { position: absolute; inset: 0 auto 0 0; border-radius: 1rem; background: var(--c); box-shadow: 0 0 .5rem var(--c); animation: pfBar 1.1s .5s cubic-bezier(.3,.1,.2,1) both; transform-origin: left; }
.pf-br .tr u { position: absolute; inset: 0 auto 0 0; border-radius: 1rem; background: var(--c); opacity: .22; }
.pf-br b { font-family: var(--mono, monospace); font-weight: 400; font-size: .74rem; text-align: right; color: #fff; }

/* medal case */
.pf-right { min-width: 0; }
.pf-case { flex: 1.65; display: flex; flex-direction: column; min-height: 0; }
.pf-case-head { display: flex; align-items: center; gap: 1rem; margin-bottom: .75rem; }
.pf-case-head .pf-h2 { margin: 0; flex: 1; }
.pf-tabs { display: flex; gap: .3rem; }
.pf-tab { height: 1.9rem; padding: 0 .8rem; border-radius: .45rem; border: 1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.03); color: #9fb0c2; cursor: pointer; font: inherit; font-size: .72rem; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; transition: all .2s; }
.pf-tab:hover { color: #fff; border-color: rgba(var(--accent-rgb, 90,180,255), .4); }
.pf-tab.on { color: #fff; background: rgba(var(--accent-rgb, 90,180,255), .22); border-color: rgba(var(--accent-rgb, 90,180,255), .7); box-shadow: inset 0 -2px 0 rgb(var(--accent-rgb, 90,180,255)); }
.pf-sum { display: flex; align-items: center; gap: .9rem; margin-bottom: .8rem; padding: .55rem .8rem; border-radius: .65rem; background: rgba(255,255,255,.025); border: 1px solid rgba(255,255,255,.05); }
.pf-sum .ring { width: 2.9rem; height: 2.9rem; flex-shrink: 0; }
.pf-sum b { font-family: var(--mono, monospace); font-weight: 400; font-size: 1.35rem; }
.pf-sum small { display: block; font-size: .66rem; letter-spacing: .2em; text-transform: uppercase; color: var(--muted, #7d8c9d); }
.pf-sum .cnt { display: flex; gap: 1rem; margin-left: auto; }
.pf-sum .cnt span { display: flex; align-items: center; gap: .35rem; font-family: var(--mono, monospace); font-size: .85rem; color: var(--text-2, #b6c3d1); }
.pf-sum .cnt span em { font-family: var(--font, sans-serif); font-style: normal; font-size: .58rem; font-weight: 700; letter-spacing: .18em; text-transform: uppercase; color: var(--muted, #7d8c9d); }
.pf-sum .cnt i { width: .62rem; height: .62rem; border-radius: 50%; background: var(--c); box-shadow: 0 0 .4rem var(--c); }
.pf-grid { flex: 1; min-height: 0; overflow-y: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(15.5rem, 1fr)); grid-auto-rows: max-content; gap: .55rem; align-content: start; padding: .1rem .3rem .2rem 0; }
.pf-grid::-webkit-scrollbar, .pf-hist::-webkit-scrollbar { width: 6px; }
.pf-grid::-webkit-scrollbar-thumb, .pf-hist::-webkit-scrollbar-thumb { background: rgba(255,255,255,.12); border-radius: 3px; }
.pf-md { --rc: 160,170,180; position: relative; display: flex; gap: .7rem; align-items: center; min-height: 4.7rem; padding: .55rem .7rem .55rem .5rem; border-radius: .7rem; overflow: hidden;
  background: linear-gradient(135deg, rgba(var(--rc), .1), rgba(255,255,255,.015) 55%); border: 1px solid rgba(var(--rc), .2); transition: transform .2s, border-color .2s, box-shadow .2s; animation: pfUp .45s calc(var(--i) * 18ms) both; }
.pf-md:hover { transform: translateY(-2px); border-color: rgba(var(--rc), .55); box-shadow: 0 .6rem 1.4rem rgba(0,0,0,.4), 0 0 1rem rgba(var(--rc), .15); }
.pf-md.r-common { --rc: 222,150,92; } .pf-md.r-rare { --rc: 160,205,255; } .pf-md.r-epic { --rc: 255,207,63; } .pf-md.r-legendary { --rc: 190,150,255; }
.pf-md.locked { --rc: 120,130,140; background: rgba(255,255,255,.018); }
.pf-md.earned::before { content: ''; position: absolute; top: 0; bottom: 0; width: 40%; left: -60%; background: linear-gradient(100deg, transparent, rgba(255,255,255,.12), transparent); transform: skewX(-20deg); animation: pfShine 5s calc(1s + var(--i) * 90ms) ease-in-out infinite; }
@keyframes pfShine { 0%, 70% { left: -60%; } 100% { left: 140%; } }
.pf-md-art { width: 2.9rem; height: 3.8rem; flex-shrink: 0; }
.pf-md-art svg { width: 100%; height: 100%; filter: drop-shadow(0 .25rem .4rem rgba(0,0,0,.55)); }
.pf-md.locked .pf-md-art svg { opacity: .75; }
.pf-md-b { flex: 1; min-width: 0; }
.pf-md-t { display: flex; align-items: center; gap: .4rem; font-size: .92rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; white-space: nowrap; }
.pf-md-t span { overflow: hidden; text-overflow: ellipsis; }
.pf-md.locked .pf-md-t { color: #9aa6b2; }
.pf-md-d { font-size: .76rem; color: var(--text-2, #b6c3d1); line-height: 1.25; margin-top: .1rem; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.pf-md.locked .pf-md-d { color: #6f7c89; }
.pf-md-p { display: flex; align-items: center; gap: .45rem; margin-top: .32rem; }
.pf-md-p .tr { flex: 1; height: .3rem; border-radius: 1rem; background: rgba(255,255,255,.07); overflow: hidden; position: relative; }
.pf-md-p .tr i { position: absolute; inset: 0 auto 0 0; border-radius: 1rem; background: rgb(var(--rc)); box-shadow: 0 0 .4rem rgba(var(--rc), .8); }
.pf-md-p span { font-family: var(--mono, monospace); font-size: .68rem; color: var(--muted, #7d8c9d); white-space: nowrap; }
.pf-md-p .done { color: #8dffb0; letter-spacing: .14em; font-family: var(--font, sans-serif); font-weight: 700; text-transform: uppercase; font-size: .6rem; }
.pf-tiers { position: absolute; top: .45rem; right: .55rem; display: flex; gap: .2rem; }
.pf-tiers i { width: .48rem; height: .48rem; border-radius: 50%; background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.12); }
.pf-tiers i.b.on { background: #d08a4e; box-shadow: 0 0 .35rem #d08a4e; border-color: #ffe2c6; }
.pf-tiers i.s.on { background: #c9d3de; box-shadow: 0 0 .35rem #c9d3de; border-color: #fff; }
.pf-tiers i.g.on { background: #ffcf3f; box-shadow: 0 0 .35rem #ffcf3f; border-color: #fff6cf; }
.pf-rar { font-size: .52rem; font-weight: 700; letter-spacing: .2em; padding: .05rem .3rem; border-radius: .25rem; color: rgb(var(--rc)); border: 1px solid rgba(var(--rc), .4); flex-shrink: 0; }

/* history */
.pf-histp { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.pf-hist { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: .3rem; padding-right: .3rem; }
.pf-hr { display: grid; grid-template-columns: 2.1rem minmax(0, 1fr) 4.6rem 4.4rem 6.6rem 5rem 4.4rem; align-items: center; gap: .6rem; padding: .42rem .6rem; border-radius: .55rem;
  background: rgba(255,255,255,.025); border: 1px solid rgba(255,255,255,.04); font-size: .82rem; animation: pfUp .4s calc(var(--i) * 30ms) both; }
.pf-hr:hover { background: rgba(var(--accent-rgb, 90,180,255), .07); border-color: rgba(var(--accent-rgb, 90,180,255), .2); }
.pf-res { width: 1.75rem; height: 1.75rem; border-radius: .4rem; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: .85rem; }
.pf-hr.win .pf-res { background: rgba(77,255,154,.14); color: #8dffb0; border: 1px solid rgba(77,255,154,.4); }
.pf-hr.loss .pf-res { background: rgba(255,74,58,.12); color: #ff8a7a; border: 1px solid rgba(255,74,58,.35); }
.pf-hr.abandoned .pf-res { background: rgba(255,255,255,.05); color: #8a99aa; border: 1px solid rgba(255,255,255,.12); }
.pf-ht { min-width: 0; }
.pf-ht b { display: block; font-size: .88rem; letter-spacing: .05em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pf-ht small { display: block; font-size: .66rem; letter-spacing: .14em; text-transform: uppercase; color: var(--muted, #7d8c9d); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pf-hc { font-family: var(--mono, monospace); font-size: .78rem; color: var(--text-2, #b6c3d1); white-space: nowrap; text-align: right; }
.pf-hc.xp { color: #ffe27a; }
.pf-hc.ago { color: var(--muted, #7d8c9d); font-size: .7rem; }
.pf-hc .mx-ic { color: var(--muted, #7d8c9d); vertical-align: -.12em; }
.pf-hc.score .mx-ic { color: #ffd34d; }
.pf-star { width: .85rem; height: .85rem; fill: rgba(255,255,255,.14); vertical-align: -.1em; }
.pf-star.on { fill: #ffd34d; filter: drop-shadow(0 0 3px rgba(255,211,77,.7)); }
.pf-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .5rem; padding: 1.6rem; color: var(--muted, #7d8c9d); font-size: .9rem; text-align: center; }
.pf-empty .mx-ic { font-size: 2rem; opacity: .5; }
.pf-back { position: absolute; left: 3.2vw; bottom: 3.6vh; display: none; }
.pf-foot { display: flex; gap: .6rem; }
.pf-btn { height: 2.7rem; padding: 0 1.2rem; display: inline-flex; align-items: center; gap: .55rem; border-radius: .6rem; cursor: pointer; font: inherit; font-size: .85rem; font-weight: 700; letter-spacing: .24em; text-transform: uppercase;
  color: #dfe8f2; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.12); transition: all .2s; }
.pf-btn:hover { color: #fff; border-color: rgba(var(--accent-rgb, 90,180,255), .55); background: rgba(var(--accent-rgb, 90,180,255), .14); }
.pf-btn kbd { font-family: var(--mono, monospace); font-size: .65rem; padding: .1rem .3rem; border-radius: .25rem; border: 1px solid rgba(255,255,255,.2); color: var(--muted, #7d8c9d); letter-spacing: 0; }
`;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60), h = Math.floor(m / 60);
  return h ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m ${String(Math.floor(sec % 60)).padStart(2, '0')}s`;
}
function ago(t: number): string {
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
function money(n: number): string {
  return n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e4 ? `$${(n / 1000).toFixed(1)}k` : `$${fmt(n)}`;
}

function ring(frac: number): string {
  const r = 20, c = 2 * Math.PI * r;
  return `<svg class="ring" viewBox="0 0 48 48"><circle cx="24" cy="24" r="${r}" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="4"/>
    <circle cx="24" cy="24" r="${r}" fill="none" stroke="#ffcf3f" stroke-width="4" stroke-linecap="round" stroke-dasharray="${(c * frac).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 24 24)" style="filter:drop-shadow(0 0 3px rgba(255,207,63,.7))"/>
    <text x="24" y="28" text-anchor="middle" fill="#fff" font-size="12" font-family="monospace">${Math.round(frac * 100)}%</text></svg>`;
}

function medalCard(s: AchievementState, i: number): string {
  const a = s.def;
  const earned = s.tier > 0;
  const t = Math.max(0, s.tier - 1);
  const rarity = achievementRarity(a, earned ? t : 0);
  const art = medalSvg({ metal: achievementMetal(a, earned ? t : 0), picto: a.picto, category: a.category, locked: !earned, hidden: s.secret });
  const title = s.secret ? 'Classified' : a.title;
  const desc = s.secret ? 'A secret commendation. Keep fighting to reveal it.' : achievementDesc(a, s.done ? s.tiers - 1 : s.tier);
  const tiers = s.tiers > 1 ? `<div class="pf-tiers">${['b', 's', 'g'].map((k, j) => `<i class="${k}${j < s.tier ? ' on' : ''}" title="${TIER_NAMES[j]}"></i>`).join('')}</div>` : '';
  const prog = s.done
    ? `<span class="done">${s.tiers > 1 ? 'Gold · complete' : 'Earned'}</span>`
    : s.secret ? '<span>???</span>' : `<span>${a.money ? money(s.cur) : fmt(s.cur)} / ${a.money ? money(s.target) : fmt(s.target)}</span>`;
  const rarLabel = s.tiers > 1 ? (earned ? TIER_NAMES[t] : 'Tiered') : rarity;
  return `<div class="pf-md ${earned ? 'earned' : 'locked'} r-${rarity}" style="--i:${i}" title="${esc(title)}">
    <div class="pf-md-art">${art}</div>
    <div class="pf-md-b"><div class="pf-md-t"><span>${esc(title)}</span>${s.secret ? '' : `<em class="pf-rar">${rarLabel.toUpperCase()}</em>`}</div>
      <div class="pf-md-d">${esc(desc)}</div>
      <div class="pf-md-p"><div class="tr"><i style="width:${(s.secret ? 0 : s.frac * 100).toFixed(1)}%"></i></div>${prog}</div></div>
    ${tiers}
  </div>`;
}

function historyRow(h: MatchRecord, i: number): string {
  const cls = h.abandoned ? 'abandoned' : h.won ? 'win' : 'loss';
  const res = h.abandoned ? '–' : h.won ? 'W' : 'L';
  const bits = [h.mode === 'skirmish' ? 'Skirmish' : h.missionId === 'daily' ? 'Daily' : h.wave !== undefined ? 'Survival' : 'Campaign', h.faction === 'soviet' ? 'Soviet' : 'Allied'];
  if (h.difficulty) bits.push(h.difficulty);
  if (h.climate) bits.push(h.climate);
  let extra = '';
  if (h.wave !== undefined) extra = `Wave ${h.wave}`;
  else if (h.stars !== undefined) extra = [0, 1, 2].map((k) => `<svg class="pf-star${k < (h.stars ?? 0) ? ' on' : ''}" viewBox="0 0 24 24"><path d="${star(12, 12.5, 11, 4.6)}"/></svg>`).join('');
  else if (h.score !== undefined) extra = fmt(h.score);
  if (h.medals.length) extra += ` ${picto('medal')}${h.medals.length}`;
  return `<div class="pf-hr ${cls}" style="--i:${i}"><span class="pf-res">${res}</span>
    <span class="pf-ht"><b>${esc(h.title)}</b><small>${esc(bits.join(' · '))}</small></span>
    <span class="pf-hc">${picto('clock')} ${formatTime(h.time)}</span><span class="pf-hc" title="Kills">${picto('crosshair')} ${fmt(h.kills)}</span><span class="pf-hc score">${extra}</span>
    <span class="pf-hc xp">+${fmt(h.xp)} XP</span><span class="pf-hc ago">${ago(h.at)}</span></div>`;
}

function barRow(label: string, wins: number, games: number, color: string, max: number): string {
  return `<div class="pf-br" style="--c:${color}"><span>${label}</span><span class="tr"><u style="width:${((games / max) * 100).toFixed(1)}%"></u><i style="width:${((wins / max) * 100).toFixed(1)}%"></i></span><b>${wins}/${games}</b></div>`;
}

/** Daily and weekly contracts with progress, rewards and the free daily reroll. */
function contractsGrid(p: Profile): string {
  const reroll = canReroll(p.contracts, Date.now());
  const card = (cad: Cadence, i: number) => {
    const s = (cad === 'daily' ? p.contracts.daily : p.contracts.weekly)[i];
    const def = CONTRACT_BY_ID[s.id];
    const r = contractReward(s.id, cad);
    return `<div class="pf-ct${s.done ? ' done' : ''}" style="--i:${i + (cad === 'weekly' ? 3 : 0)}">
      <div class="pf-ct-t">${picto(s.done ? 'untouchable' : def?.picto ?? 'target')}<span>${esc(def?.title ?? s.id)}</span><em>${cad}</em></div>
      <p>${esc(contractDesc(s))}</p>
      <div class="tr"><i style="width:${((s.p / Math.max(1, s.n)) * 100).toFixed(1)}%"></i></div>
      <div class="pf-ct-f"><span>${s.done ? 'Complete' : `${fmtContractValue(def, s.p)} / ${fmtContractValue(def, s.n)}`}</span><b>+${fmt(r.xp)} XP · +${r.cmd} ${picto('medal')}</b></div>
      ${!s.done && reroll ? `<button class="pf-ct-rr" data-rr="${cad}:${i}" title="Swap for another contract (one free reroll a day)">${picto('history')} Reroll</button>` : ''}</div>`;
  };
  return `<div class="pf-grid"><div class="pf-ct-h">Today's orders</div>${p.contracts.daily.map((_, i) => card('daily', i)).join('')}
    <div class="pf-ct-h">This week</div>${p.contracts.weekly.map((_, i) => card('weekly', i)).join('')}
    <div class="pf-ct-h">${reroll ? 'One free reroll a day: swap an unfinished contract for another.' : 'Reroll used today. New orders arrive with the date; nothing is lost by skipping a day.'}</div></div>`;
}

/** Full-screen commander profile. Returns a close function. */
export function showProfile(opts: { onBack(): void; play(k: PlayKey): void }): () => void {
  if (!document.getElementById('pf-style')) {
    const st = document.createElement('style');
    st.id = 'pf-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  const root = document.createElement('div');
  root.className = 'pf';
  document.body.appendChild(root);
  let filter: 'all' | 'earned' | 'progress' | 'locked' = 'all';
  let view: 'medals' | 'contracts' = 'medals';
  let p: Profile = loadProfile();

  const render = () => {
    p = profileWithContracts(); // (today's orders in place)
    const uctx = unlockContext(p);
    const look = commanderLook(uctx);
    const topUnits = Object.entries(p.stats.killsByUnit).filter(([id, k]) => UNITS[id] && k > 0).sort((a, b) => b[1] - a[1]).slice(0, 3); // career: favourite units
    const freshLocker = unseenUnlocks(uctx).length;
    const rp = rankProgress(p.xp, p.faction);
    const st = p.stats;
    const states = allAchievementStates(p);
    const totals = medalTotals(p);
    const fav = favouriteUnit(p);
    const favKind = fav ? UNITS[fav.id]?.kind : null;
    const winPct = st.games ? Math.round((st.wins / st.games) * 100) : 0;
    const ladder = RANKS.map((r) => `<span class="${r.index <= rp.index ? 'on' : ''}${r.index === rp.index ? ' cur' : ''}" title="${esc(rankName(r.index, p.faction))} · ${fmt(r.xp)} XP">${insigniaSvg(r.index, p.faction)}</span>`).join('');
    const maxF = Math.max(1, st.gamesByFaction.allies, st.gamesByFaction.soviet);
    const maxD = Math.max(1, ...Object.values(st.gamesByDifficulty));
    const list = states
      .filter((s) => filter === 'all' || (filter === 'earned' ? s.tier > 0 : filter === 'locked' ? s.tier === 0 : !s.done && !s.secret && s.frac > 0))
      .sort((a, b) => (filter === 'progress' ? b.frac - a.frac : 0));
    const ru = p.faction === 'soviet' ? RANKS[rp.index].ru : '';
    const byRarity = (r: string) => states.filter((s) => s.tier > 0 && achievementRarity(s.def, s.tier - 1) === r).length;

    root.innerHTML = `
    <div class="pf-col pf-left">
      <div class="pf-panel pf-cmd" style="--banner:${look.banner}">
        <div class="pf-cmd-top">
          <div class="pf-por">${look.portrait}<div class="pf-ins">${insigniaSvg(rp.index, p.faction)}</div></div>
          <div class="pf-id">
            <div class="pf-kick">Commander · rank ${rp.index + 1} of ${RANKS.length}</div>
            <div class="pf-rank">${esc(rp.name)}</div>${ru ? `<div class="pf-ru">${esc(ru)}</div>` : ''}
            <div class="pf-name" data-act="rename" title="Rename commander"><span>${esc(p.name)}</span>${picto('pencil')}</div>${look.title ? `<div class="pf-title">${esc(look.title)}</div>` : ''}
            <div class="pf-cmdn">${picto('medal')}${fmt(p.commendations)}<small>Commendations</small></div>
          </div>
        </div>
        <div class="pf-xp">
          <div class="pf-xp-row"><b>${fmt(p.xp)} XP</b><small>${rp.next ? `Next: ${esc(rankName(rp.next.index, p.faction))}` : 'Highest rank'}</small></div>
          <div class="pf-bar"><i style="width:${(rp.frac * 100).toFixed(2)}%"></i></div>
          <div class="pf-xp-row"><span>${rp.next ? `${fmt(rp.next.xp - p.xp)} XP to promotion` : 'Every medal still counts.'}</span><span>${rp.next ? `${fmt(rp.into)} / ${fmt(rp.span)}` : ''}</span></div>
        </div>
        <div class="pf-ladder">${ladder}</div>
      </div>
      <div class="pf-panel">
        <div class="pf-h2">${picto('chart')}<span>Service record</span><i class="sp"></i></div>
        <div class="pf-tiles">
          <div class="pf-tile"><small>${picto('flag')}Battles</small><b>${fmt(st.games)}</b></div>
          <div class="pf-tile"><small>${picto('trophy')}Victories</small><b>${fmt(st.wins)}<em>${winPct}%</em></b></div>
          <div class="pf-tile"><small>${picto('clock')}In service</small><b>${fmtDuration(st.timePlayed)}</b></div>
          <div class="pf-tile"><small>${picto('skull')}Kills</small><b>${fmt(st.kills)}</b></div>
          <div class="pf-tile"><small>${picto('building')}Razed</small><b>${fmt(st.structuresDestroyed)}</b></div>
          <div class="pf-tile"><small>${picto('ore')}Harvested</small><b>${money(st.harvested)}</b></div>
          <div class="pf-tile"><small>${picto('tower')}Best wave</small><b>${st.bestSurvivalWave || '–'}</b></div>
          <div class="pf-tile"><small>${picto('streak')}Daily streak</small><b>${p.daily.streak}<em>best ${p.daily.longest}</em></b></div>
          <div class="pf-tile"><small>${picto('stopwatch')}Fastest win</small><b>${st.fastestWin ? formatTime(st.fastestWin) : '–'}</b></div>
        </div>
        ${topUnits.length > 1 ? `<div class="pf-fav pf-favs">${picto(favKind === 'infantry' ? 'user' : favKind === 'aircraft' ? 'plane' : 'tank')}<span><small>Favourite units · kills</small><span class="cols">${topUnits.map(([id, k]) => `<span title="${esc(UNITS[id].name)}: ${fmt(k)} kills"><b>${esc(UNITS[id].name)}</b><u><i style="width:${((k / topUnits[0][1]) * 100).toFixed(1)}%"></i></u><em>${fmt(k)}</em></span>`).join('')}</span></span></div>` // career: favourite units
          : `<div class="pf-fav">${picto(favKind === 'infantry' ? 'user' : favKind === 'aircraft' ? 'plane' : 'tank')}<span><small>Favourite unit</small><b>${fav ? esc(fav.name) : 'None yet'}</b></span>${fav ? `<i>${fmt(fav.kills)} kills</i>` : ''}</div>`}
      </div>
      <div class="pf-panel">
        <div class="pf-h2">${picto('target')}<span>Victories</span><i class="sp"></i></div>
        <div class="pf-bars">
          <div><h5>By faction</h5>${barRow('Allies', st.winsByFaction.allies, st.gamesByFaction.allies, '#5ab4ff', maxF)}${barRow('Soviet', st.winsByFaction.soviet, st.gamesByFaction.soviet, '#ff5a46', maxF)}</div>
          <div><h5>By AI difficulty</h5>${barRow('Easy', st.winsByDifficulty.easy, st.gamesByDifficulty.easy, '#4dff9a', maxD)}${barRow('Normal', st.winsByDifficulty.normal, st.gamesByDifficulty.normal, '#5ab4ff', maxD)}${barRow('Hard', st.winsByDifficulty.hard, st.gamesByDifficulty.hard, '#ffb43c', maxD)}${barRow('Brutal', st.winsByDifficulty.brutal, st.gamesByDifficulty.brutal, '#ff4a3a', maxD)}</div>
        </div>

      </div>
      <div class="pf-foot"><button class="pf-btn" data-act="back">${picto('back')}<span>Back</span><kbd>Esc</kbd></button><button class="pf-btn" data-act="rivals">${picto('skull')}<span>Rivals</span></button><button class="pf-btn" data-act="locker">${picto('tank')}<span>Locker</span>${freshLocker ? '<i class="dot"></i>' : ''}</button></div>
    </div>
    <div class="pf-col pf-right">
      <div class="pf-panel pf-case">
        <div class="pf-case-head"><span class="pf-mode"><button class="${view === 'medals' ? 'on' : ''}" data-view="medals">Medals</button><button class="${view === 'contracts' ? 'on' : ''}" data-view="contracts">Contracts</button></span>
          <div class="pf-h2">${view === 'medals' ? `${picto('medal')}<span>Medal case</span><i class="sp"></i><small>${totals.earned} / ${totals.total} medals</small>` : `${picto('target')}<span>Contracts</span><i class="sp"></i><small>${fmt(p.contracts.completed)} completed · ${fmt(p.contracts.earned)} Commendations earned</small>`}</div>
          ${view === 'medals' ? `<div class="pf-tabs">${(['all', 'earned', 'progress', 'locked'] as const).map((k) => `<button class="pf-tab${k === filter ? ' on' : ''}" data-f="${k}">${k === 'progress' ? 'In progress' : k}</button>`).join('')}</div>` : ''}</div>
        ${view === 'contracts' ? contractsGrid(p) : `<div class="pf-sum">${ring(totals.earned / totals.total)}<div><b>${totals.complete} / ${totals.achievements}</b><small>Medals complete</small></div>
          <div class="cnt"><span style="--c:#d08a4e"><i></i>${byRarity('common')}<em>common</em></span><span style="--c:#a0cdff"><i></i>${byRarity('rare')}<em>rare</em></span><span style="--c:#ffcf3f"><i></i>${byRarity('epic')}<em>epic</em></span><span style="--c:#be96ff"><i></i>${byRarity('legendary')}<em>legendary</em></span></div></div>
        <div class="pf-grid">${list.length ? list.map(medalCard).join('') : `<div class="pf-empty">${picto('medal')}<span>Nothing here yet.</span></div>`}</div>`}
      </div>
      <div class="pf-panel pf-histp">
        <div class="pf-h2">${picto('history')}<span>Recent operations</span><i class="sp"></i><small>last ${Math.min(20, p.history.length)}</small></div>
        <div class="pf-hist">${p.history.length ? p.history.map(historyRow).join('') : `<div class="pf-empty">${picto('flag')}<span>No operations on record yet. Deploy to start your service record.</span></div>`}</div>
      </div>
    </div>`;

    root.querySelectorAll<HTMLElement>('[data-f]').forEach((b) => (b.onclick = () => { filter = b.dataset.f as typeof filter; opts.play('tab'); render(); }));
    (root.querySelector('[data-act="back"]') as HTMLElement).onclick = () => { opts.play('click'); close(); opts.onBack(); };
    (root.querySelector('[data-act="rivals"]') as HTMLElement).onclick = () => { opts.play('click'); showRivals({ play: opts.play, onBack: () => {} }); }; // rivals board
    // Locker, medals / contracts switch, the free daily reroll
    (root.querySelector('[data-act="locker"]') as HTMLElement).onclick = () => { opts.play('click'); showLocker({ play: opts.play, onBack: () => { if (root.isConnected) render(); } }); };
    root.querySelectorAll<HTMLElement>('[data-view]').forEach((b) => (b.onclick = () => { view = b.dataset.view as typeof view; opts.play('tab'); render(); }));
    root.querySelectorAll<HTMLElement>('[data-rr]').forEach((b) => (b.onclick = () => {
      const [cad, i] = (b.dataset.rr ?? '').split(':');
      if (rerollContractNow(cad as Cadence, Number(i))) { opts.play('click'); render(); }
    }));
    const nameEl = root.querySelector('[data-act="rename"]') as HTMLElement;
    nameEl.onclick = () => {
      if (nameEl.querySelector('input')) return;
      const input = document.createElement('input');
      input.value = p.name;
      input.maxLength = 24;
      nameEl.innerHTML = '';
      nameEl.appendChild(input);
      input.focus();
      input.select();
      let done = false;
      const commit = (save: boolean) => {
        if (done) return;
        done = true;
        if (save) setCommanderName(input.value);
        render();
      };
      input.onkeydown = (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') commit(true);
        else if (e.key === 'Escape') commit(false);
      };
      input.onblur = () => commit(true);
    };
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !root.isConnected || document.querySelector('.rv, .rh-locker')) return; // (the rivals board and the Locker close first)
    e.preventDefault();
    e.stopPropagation();
    opts.play('click');
    close();
    opts.onBack();
  };
  document.addEventListener('keydown', onKey, true);
  let hovered: Element | null = null;
  root.addEventListener('pointerover', (e) => {
    const t = (e.target as HTMLElement).closest('button, .pf-md');
    if (t && t !== hovered) opts.play('hover');
    hovered = t;
  });
  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    root.classList.add('leaving');
    setTimeout(() => root.remove(), 280);
  };
  render();
  return close;
}
