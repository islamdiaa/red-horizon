/**
 * Challenges hub: today's Daily Challenge (modifiers, countdown, personal bests, streak), the
 * Survival variants with their records, and a medal-case summary.
 */
import {
  ACH_BY_ID, MODIFIER_BY_ID, achievementMetal, achievementTitle, allAchievementStates, dailyConfig, dailyModDesc, dailyModName, dailyPlace, dayKey, insigniaSvg, loadProfile,
  medalSvg, medalTotals, msUntilNextDaily, picto, prevDay, rankProgress, shiftDay, type DailyConfig, type Profile,
} from '../meta';
import { currentLang, dt, fmtDate, fmtInt, fmtMoney, fmtPct } from '../i18n/core';
import tChallenges from '../i18n/en/challenges';
import tCommon from '../i18n/en/common';
import { SURVIVAL_VARIANTS, currentDailyDay, type SurvivalVariant } from '../missions/special';
import { alliedEmblem, sovietEmblem } from './icons';
import { focusTrap } from './a11y'; // Tab stays inside the screen
import { bindCoopSwitch, coopSwitchHtml, survivalDeployId, survivalRecord } from './coop'; // co-op survival
import { openScenarioChallenges } from '../modes/ui'; // scenario challenges

type PlayKey = 'click' | 'tab' | 'hover';

const CSS = `
.chl { position: fixed; inset: 0; z-index: 22; display: grid; grid-template-columns: minmax(0, 1.12fr) minmax(0, 1fr); gap: 1.2rem; padding: 4.2vh 3.2vw 3.6vh;
  background: radial-gradient(ellipse at 25% 35%, rgba(255,140,60,.08), transparent 50%), radial-gradient(ellipse at 30% 40%, rgba(0,0,0,.3), rgba(0,0,0,.86) 75%);
  font-family: var(--font, sans-serif); color: var(--text, #e9f0f7); animation: chlIn .45s ease-out; overflow: hidden; }
.chl.leaving { animation: chlOut .3s ease-in forwards; }
@keyframes chlIn { from { opacity: 0; } }
@keyframes chlOut { to { opacity: 0; } }
@keyframes chlUp { from { opacity: 0; transform: translateY(1rem); } }
.chl-col { display: flex; flex-direction: column; gap: 1rem; min-height: 0; min-width: 0; }
.chl > .chl-col { overflow-y: auto; scrollbar-width: none; } /* (long languages on 720p-class screens: the footer stays reachable) */
.chl-panel { position: relative; background: linear-gradient(180deg, rgba(20,28,39,.9), rgba(8,12,18,.93)); border: 1px solid rgba(255,255,255,.08); border-radius: 1rem; padding: 1rem 1.15rem;
  box-shadow: 0 1.4rem 3.5rem rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.05); animation: chlUp .6s var(--ease, ease-out) both; }
.chl-h2 { display: flex; align-items: center; gap: .55rem; margin: 0 0 .75rem; font-size: .72rem; font-weight: 700; letter-spacing: .32em; text-transform: uppercase; color: rgb(var(--accent-rgb, 90,180,255)); }
.chl-h2 .mx-ic { font-size: 1rem; }
.chl-h2 .sp { flex: 1; height: 1px; background: linear-gradient(90deg, rgba(var(--accent-rgb, 90,180,255), .45), transparent); }
.chl-h2 small { font-family: var(--mono, monospace); font-size: .78rem; letter-spacing: .04em; color: var(--muted, #7d8c9d); text-transform: none; }

/* daily hero */
.chl-daily { flex: 1; display: flex; flex-direction: column; padding: 0; overflow: hidden auto; scrollbar-width: thin; border-color: rgba(255,170,80,.25); }
@media (max-height: 800px) { .chl-daily .chl-hero { height: 11rem; } }
.chl-hero { position: relative; height: 15.5rem; flex-shrink: 0; overflow: hidden; }
.chl-hero > svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.chl-hero::after { content: ''; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(4,7,11,0) 0%, rgba(4,7,11,.12) 40%, rgba(12,17,24,.98) 100%), linear-gradient(90deg, rgba(4,7,11,.55), transparent 60%); }
.chl-hero-t { position: absolute; left: 1.4rem; right: 1.4rem; bottom: 1.05rem; z-index: 1; }
.chl-kick { display: flex; align-items: center; gap: .6rem; font-size: .7rem; font-weight: 700; letter-spacing: .34em; text-transform: uppercase; color: #ffb45a; }
.chl-kick i { width: 1.8rem; height: 2px; background: linear-gradient(90deg, #ff7a3a, transparent); box-shadow: 0 0 .5rem #ff7a3a; }
.chl-title { margin: .35rem 0 .25rem; font-size: 2.45rem; font-weight: 700; letter-spacing: .1em; line-height: 1; text-transform: uppercase;
  background: linear-gradient(180deg, #ffffff 10%, #ffd9b8 60%, #ff9a5a 120%); -webkit-background-clip: text; background-clip: text; color: transparent; filter: drop-shadow(0 .2rem .6rem rgba(0,0,0,.7)); }
.chl-loc { display: flex; flex-wrap: wrap; align-items: center; gap: .9rem; font-family: var(--mono, monospace); font-size: .8rem; letter-spacing: .08em; color: #c8d4e0; text-transform: uppercase; }
.chl-loc span { display: inline-flex; align-items: center; gap: .35rem; }
.chl-loc .mx-ic { color: #ffb45a; }
.chl-clock { position: absolute; top: 1rem; right: 1rem; z-index: 1; display: flex; align-items: center; gap: .55rem; padding: .45rem .75rem; border-radius: .6rem;
  background: rgba(4,7,11,.62); border: 1px solid rgba(255,255,255,.12); backdrop-filter: blur(6px); }
.chl-clock .mx-ic { color: #ffb45a; font-size: 1.05rem; }
.chl-clock small { display: block; font-size: .56rem; font-weight: 700; letter-spacing: .28em; text-transform: uppercase; color: var(--muted, #7d8c9d); }
.chl-clock b { font-family: var(--mono, monospace); font-weight: 400; font-size: 1.15rem; letter-spacing: .06em; color: #fff; }
.chl-body { flex: 1; display: flex; flex-direction: column; gap: .9rem; padding: .95rem 1.4rem 1.2rem; min-height: 0; }
.chl-vs { display: flex; align-items: center; gap: .8rem; }
.chl-side { display: flex; align-items: center; gap: .55rem; font-size: 1rem; font-weight: 700; letter-spacing: .18em; text-transform: uppercase; }
.chl-side .emb { width: 3.1rem; height: 2rem; display: flex; align-items: center; justify-content: center; }
.chl-side .emb.sv { width: 2.1rem; }
.chl-side .emb svg { width: 100%; height: 100%; }
.chl-side small { display: block; font-size: .58rem; letter-spacing: .26em; color: var(--muted, #7d8c9d); }
.chl-vsx { font-size: .8rem; font-weight: 700; letter-spacing: .2em; color: #ff7a5a; padding: .2rem .5rem; border: 1px solid rgba(255,122,90,.35); border-radius: .35rem; }
.chl-badges { margin-left: auto; display: flex; gap: .45rem; }
.chl-badge { display: flex; flex-direction: column; align-items: center; padding: .3rem .7rem; border-radius: .55rem; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.1); }
.chl-badge small { font-size: .52rem; font-weight: 700; letter-spacing: .26em; text-transform: uppercase; color: var(--muted, #7d8c9d); }
.chl-badge b { font-family: var(--mono, monospace); font-weight: 400; font-size: 1.05rem; }
.chl-badge.d-normal b { color: #5ab4ff; } .chl-badge.d-hard b { color: #ffb43c; } .chl-badge.d-brutal b { color: #ff4a3a; text-shadow: 0 0 .6rem rgba(255,74,58,.6); }
.chl-badge.mult { border-color: rgba(255,207,63,.35); background: rgba(255,207,63,.07); } .chl-badge.mult b { color: #ffd34d; }
.chl-mods { display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); gap: .55rem; }
.chl-mod { position: relative; display: flex; gap: .65rem; padding: .65rem .7rem; border-radius: .7rem; background: linear-gradient(135deg, rgba(255,150,70,.12), rgba(255,255,255,.02) 60%); border: 1px solid rgba(255,150,70,.25);
  animation: chlUp .5s calc(.2s + var(--i) * .08s) both; overflow: hidden; }
.chl-mod .ic { width: 2.3rem; height: 2.3rem; flex-shrink: 0; border-radius: .55rem; display: flex; align-items: center; justify-content: center; font-size: 1.3rem; color: #ffcf9a;
  background: radial-gradient(circle at 40% 30%, rgba(255,160,80,.35), rgba(60,20,8,.6)); border: 1px solid rgba(255,170,90,.4); box-shadow: 0 0 .9rem rgba(255,120,40,.25); }
.chl-mod b { display: block; font-size: .9rem; letter-spacing: .12em; text-transform: uppercase; }
.chl-mod span { display: block; font-size: .76rem; line-height: 1.3; color: var(--text-2, #b6c3d1); margin-top: .1rem; }
.chl-brief { margin: -.15rem 0 0; font-size: .95rem; line-height: 1.45; color: #c9d4df; }
.chl-brief b { color: #fff; font-weight: 700; }
.chl-objs { display: flex; gap: .45rem; flex-wrap: wrap; }
.chl-obj { display: flex; align-items: center; gap: .45rem; padding: .32rem .65rem; border-radius: 2rem; font-size: .76rem; letter-spacing: .06em; color: var(--text-2, #b6c3d1); background: rgba(255,255,255,.035); border: 1px solid rgba(255,255,255,.08); }
.chl-obj svg { width: .9rem; height: .9rem; }
.chl-obj.p { color: #fff; border-color: rgba(255,170,80,.35); background: rgba(255,140,60,.08); }
.chl-objs small { align-self: center; font-size: .58rem; font-weight: 700; letter-spacing: .24em; text-transform: uppercase; color: var(--muted, #7d8c9d); margin-right: .2rem; }
.chl-stats { display: grid; grid-template-columns: 1fr 1fr 1.25fr; gap: .55rem; }
.chl-stat.rw b { font-size: 1.1rem; color: #ffe27a; }
.chl-stat.rw .rl { display: flex; justify-content: space-between; font-size: .72rem; color: var(--text-2, #b6c3d1); margin-top: .12rem; }
.chl-stat.rw .rl i { font-style: normal; font-family: var(--mono, monospace); color: #ffd34d; }
.chl-hist { flex: 1; min-height: 6.5rem; max-height: 11.5rem; display: flex; flex-direction: column; padding: .6rem .8rem .5rem; border-radius: .65rem; background: rgba(255,255,255,.025); border: 1px solid rgba(255,255,255,.06); }
.chl-hist .hd { display: flex; justify-content: space-between; align-items: center; font-size: .58rem; font-weight: 700; letter-spacing: .22em; text-transform: uppercase; color: var(--muted, #7d8c9d); }
.chl-hist .hd span { display: flex; align-items: center; gap: .35rem; }
.chl-hist .hd .mx-ic { font-size: .9rem; color: #ffb45a; }
.chl-hist .lg { display: flex; gap: .8rem; letter-spacing: .14em; }
.chl-hist .lg i { display: inline-block; width: .5rem; height: .5rem; border-radius: .1rem; margin-right: .3rem; vertical-align: 0; }
.chl-stat { padding: .55rem .7rem; border-radius: .65rem; background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.06); min-width: 0; }
.chl-stat small { display: flex; align-items: center; gap: .35rem; font-size: .58rem; font-weight: 700; letter-spacing: .22em; text-transform: uppercase; color: var(--muted, #7d8c9d); }
.chl-stat small .mx-ic { font-size: .9rem; color: #ffb45a; }
.chl-stat b { display: block; margin-top: .2rem; font-family: var(--mono, monospace); font-weight: 400; font-size: 1.35rem; color: #fff; white-space: nowrap; }
.chl-stat b em { font-style: normal; font-size: .7rem; color: var(--muted, #7d8c9d); margin-left: .3rem; }
.chl-stat .note { display: block; font-size: .68rem; color: #ffb45a; letter-spacing: .06em; margin-top: .1rem; line-height: 1.25; }
.chl-stat.streak b { color: #ffcf6a; text-shadow: 0 0 .8rem rgba(255,160,60,.55); }
.chl-chart { flex: 1; display: flex; align-items: flex-end; gap: .35rem; min-height: 4rem; margin-top: .45rem; }
.chl-chart div { flex: 1; display: flex; flex-direction: column; align-items: center; gap: .15rem; height: 100%; justify-content: flex-end; min-width: 0; }
.chl-chart em { font-style: normal; font-family: var(--mono, monospace); font-size: .56rem; color: #ffe27a; white-space: nowrap; }
.chl-chart i { width: 100%; min-height: 3px; border-radius: .2rem .2rem 0 0; background: rgba(255,255,255,.08); }
.chl-chart i.won { background: linear-gradient(180deg, #ffcf3f, #a8741a); box-shadow: 0 0 .5rem rgba(255,207,63,.4); }
.chl-chart i.lost { background: linear-gradient(180deg, rgba(255,110,80,.75), rgba(120,30,20,.6)); }
.chl-chart div.today i { outline: 1px solid rgba(255,255,255,.55); outline-offset: 1px; }
.chl-chart u { text-decoration: none; font-family: var(--mono, monospace); font-size: .56rem; color: var(--muted, #7d8c9d); }
.chl-chart div.today u { color: #fff; }
.chl-go { margin-top: auto; display: flex; gap: .6rem; }
.chl-btn { position: relative; flex: 1; height: 3.3rem; border-radius: .75rem; border: 0; cursor: pointer; font: inherit; font-weight: 700; letter-spacing: .32em; text-transform: uppercase; font-size: 1.05rem; color: #fff; overflow: hidden;
  display: flex; align-items: center; justify-content: center; gap: .7rem;
  background: linear-gradient(180deg, #ff8a4a, #c8401c); box-shadow: 0 0 2rem rgba(255,110,50,.35), inset 0 1px 0 rgba(255,255,255,.35); transition: filter .2s, transform .2s; }
.chl-btn:hover { filter: brightness(1.12); transform: translateY(-1px); }
.chl-btn::after { content: ''; position: absolute; top: 0; bottom: 0; width: 30%; left: -40%; background: linear-gradient(100deg, transparent, rgba(255,255,255,.35), transparent); transform: skewX(-20deg); animation: chlShine 3.6s 1s ease-in-out infinite; }
@keyframes chlShine { 0%, 65% { left: -40%; } 100% { left: 130%; } }
.chl-btn small { font-size: .7rem; letter-spacing: .2em; opacity: .8; }

/* survival */
.chl-sv-list { display: flex; flex-direction: column; gap: .6rem; }
.chl-sv { position: relative; display: grid; grid-template-columns: 9.5rem minmax(0, 1fr) auto; align-items: stretch; border-radius: .85rem; overflow: hidden; cursor: pointer;
  background: linear-gradient(90deg, rgba(255,255,255,.04), rgba(255,255,255,.015)); border: 1px solid rgba(255,255,255,.08); transition: transform .2s, border-color .2s, box-shadow .2s;
  animation: chlUp .5s calc(.15s + var(--i) * .08s) both; }
.chl-sv:hover { transform: translateX(3px); border-color: rgba(var(--sc), .6); box-shadow: 0 .8rem 2rem rgba(0,0,0,.45), 0 0 1.4rem rgba(var(--sc), .18); }
.chl-sv.temperate { --sc: 120, 210, 120; } .chl-sv.winter { --sc: 150, 210, 255; } .chl-sv.desert { --sc: 255, 180, 90; }
.chl-sv-art { position: relative; overflow: hidden; }
.chl-sv-art svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.chl-sv-art::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, transparent 55%, rgba(12,17,24,.95)); }
.chl-sv-b { padding: .7rem .2rem .7rem .5rem; min-width: 0; }
.chl-sv-list { flex: 1; }
.chl-sv-t { display: flex; align-items: center; gap: .5rem; font-size: 1.18rem; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }
.chl-sv-t em { font-style: normal; font-family: var(--mono, monospace); font-size: .7rem; letter-spacing: .04em; padding: .05rem .35rem; border-radius: .3rem; color: rgb(var(--sc)); border: 1px solid rgba(var(--sc), .45); }
.chl-sv-s { font-size: .74rem; letter-spacing: .14em; text-transform: uppercase; color: var(--muted, #7d8c9d); margin-top: .05rem; line-height: 1.3; }
.chl-sv-r { display: flex; gap: 1.1rem; margin-top: .45rem; }
.chl-sv-r span small { display: block; font-size: .54rem; font-weight: 700; letter-spacing: .24em; text-transform: uppercase; color: var(--muted, #7d8c9d); }
.chl-sv-r span b { font-family: var(--mono, monospace); font-weight: 400; font-size: 1.05rem; color: #fff; }
.chl-sv-r span.pb b { color: #ffd34d; }
.chl-wt { position: relative; display: flex; gap: 2px; margin: .55rem 0 .7rem; padding-right: .6rem; }
.chl-wt i { flex: 1; height: .38rem; border-radius: 1px; background: rgba(255,255,255,.08); }
.chl-wt i.boss { height: .6rem; margin-top: -.11rem; background: rgba(255,255,255,.14); }
.chl-wt i.on { background: rgba(var(--sc), .85); box-shadow: 0 0 .35rem rgba(var(--sc), .6); }
.chl-wt i.boss.on { background: #ff8a5a; box-shadow: 0 0 .45rem rgba(255,120,70,.8); }
.chl-wt b { position: absolute; top: .62rem; width: 0; height: 0; margin-left: -.3rem; border-left: .3rem solid transparent; border-right: .3rem solid transparent; border-bottom: .42rem solid var(--m); opacity: .55; }
.chl-wt b.got { opacity: 1; filter: drop-shadow(0 0 .25rem var(--m)); }
.chl-wt b.t0 { --m: #d08a4e; } .chl-wt b.t1 { --m: #c9d3de; } .chl-wt b.t2 { --m: #ffcf3f; }
.chl-sv-go { display: flex; align-items: center; padding: 0 1rem; }
.chl-sv-go button { height: 2.5rem; padding: 0 1rem; border-radius: .6rem; cursor: pointer; font: inherit; font-size: .8rem; font-weight: 700; letter-spacing: .24em; text-transform: uppercase; color: #fff;
  background: rgba(var(--sc), .16); border: 1px solid rgba(var(--sc), .55); display: flex; align-items: center; gap: .4rem; transition: all .2s; }
.chl-sv:hover .chl-sv-go button { background: rgba(var(--sc), .32); box-shadow: 0 0 1rem rgba(var(--sc), .35); }

/* medals */
.chl-med { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: .9rem 1.1rem; align-items: center; }
.chl-med-top { display: flex; align-items: center; gap: .8rem; }
.chl-med-top > svg.ring { width: 3.6rem; height: 3.6rem; }
.chl-med-top b { font-family: var(--mono, monospace); font-weight: 400; font-size: 1.5rem; }
.chl-med-top small { display: block; font-size: .62rem; letter-spacing: .22em; text-transform: uppercase; color: var(--muted, #7d8c9d); }
.chl-rank { display: flex; align-items: center; gap: .6rem; margin-top: .5rem; }
.chl-rank svg { width: 2.2rem; height: 2.2rem; }
.chl-rank b { display: block; font-size: .85rem; letter-spacing: .14em; text-transform: uppercase; color: #ffd34d; }
.chl-rank small { font-family: var(--mono, monospace); font-size: .7rem; color: var(--muted, #7d8c9d); }
.chl-near { display: flex; flex-direction: column; gap: .45rem; min-width: 0; }
.chl-medp { flex: 1 1 0; min-height: 0; overflow: hidden; display: flex; flex-direction: column; } /* (gives way first on short screens, so the footer stays on screen) */
@media (max-height: 800px) { .chl .chl-foot .chl-sbtn { font-size: .74rem; letter-spacing: .08em; } }
.chl-recent { margin-top: auto; padding-top: .8rem; border-top: 1px solid rgba(255,255,255,.06); }
.chl-recent small { display: block; font-size: .58rem; font-weight: 700; letter-spacing: .24em; text-transform: uppercase; color: var(--muted, #7d8c9d); margin-bottom: .4rem; }
.chl-recent div { display: flex; gap: .5rem; }
.chl-recent span { width: 2.3rem; height: 3rem; transition: transform .2s; }
.chl-recent span:hover { transform: translateY(-3px) scale(1.08); }
.chl-recent svg { width: 100%; height: 100%; filter: drop-shadow(0 .2rem .35rem rgba(0,0,0,.6)); }
.chl-near-r { display: flex; align-items: center; gap: .6rem; min-width: 0; }
.chl-near-r .art { width: 1.75rem; height: 2.3rem; flex-shrink: 0; }
.chl-near-r .art svg { width: 100%; height: 100%; }
.chl-near-r div { flex: 1; min-width: 0; }
.chl-near-r b { display: flex; justify-content: space-between; gap: .5rem; font-size: .8rem; letter-spacing: .08em; text-transform: uppercase; white-space: nowrap; }
.chl-near-r b em { font-style: normal; font-family: var(--mono, monospace); font-size: .7rem; letter-spacing: 0; color: var(--muted, #7d8c9d); }
.chl-near-r .tr { height: .28rem; border-radius: 1rem; background: rgba(255,255,255,.07); overflow: hidden; margin-top: .25rem; position: relative; }
.chl-near-r .tr i { position: absolute; inset: 0 auto 0 0; border-radius: 1rem; background: linear-gradient(90deg, #a8741a, #ffcf3f); box-shadow: 0 0 .4rem rgba(255,207,63,.6); }
.chl-foot { display: flex; gap: .6rem; margin-top: auto; }
/* the footer buttons share the row: long labels (German, Russian, narrow screens) break onto a second line */
.chl-foot .chl-sbtn { flex: 0 1 auto; min-width: 0; }
.chl-foot .chl-sbtn span { white-space: normal; line-height: 1.15; text-align: left; }
@media (max-width: 1440px) { .chl-foot .chl-sbtn { padding: 0 .75rem; letter-spacing: .12em; gap: .4rem; } }
/* portrait screens (tablets, phones): one column that scrolls as a whole */
@media (max-aspect-ratio: 1/1) {
  .chl { grid-template-columns: minmax(0, 1fr); grid-auto-rows: max-content; align-content: start; overflow-y: auto; padding: 1rem .8rem 1.4rem; }
  .chl > .chl-col { overflow: visible; }
  .chl-daily, .chl-medp { flex: none; overflow: visible; }
  .chl-h2 { flex-wrap: wrap; row-gap: .3rem; }
  .chl-foot { flex-wrap: wrap; }
  .chl-foot .chl-sbtn { flex: 1 1 auto; min-height: 2.9rem; height: auto; padding: .4rem .75rem; }
}
/* phones: the hero text flows under the clock, single-column cards, survival rows stack their Deploy button */
@media (max-width: 600px) {
  .chl-hero { height: auto; min-height: 12rem; padding-top: 4.4rem; }
  .chl-hero-t { position: relative; left: auto; right: auto; bottom: auto; padding: 0 1rem 1rem; }
  .chl-clock { left: 1rem; right: auto; }
  .chl-title { font-size: 1.75rem; }
  .chl-body { padding: .9rem .9rem 1rem; }
  .chl-vs { flex-wrap: wrap; }
  .chl-mods { grid-template-columns: minmax(0, 1fr); }
  .chl-stats { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .chl-stats > :last-child { grid-column: 1 / -1; }
  .chl-sv { grid-template-columns: 5.5rem minmax(0, 1fr); }
  .chl-sv-go { grid-column: 1 / -1; padding: 0 .7rem .7rem; }
  .chl-sv-go button { width: 100%; min-height: 2.9rem; }
  .chl-sv-r { flex-wrap: wrap; gap: .4rem .9rem; }
  .chl-med { grid-template-columns: minmax(0, 1fr); }
}
.chl-sbtn { height: 2.7rem; padding: 0 1.2rem; display: inline-flex; align-items: center; gap: .55rem; border-radius: .6rem; cursor: pointer; font: inherit; font-size: .85rem; font-weight: 700; letter-spacing: .24em; text-transform: uppercase;
  color: #dfe8f2; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.12); transition: all .2s; }
.chl-sbtn:hover { color: #fff; border-color: rgba(var(--accent-rgb, 90,180,255), .55); background: rgba(var(--accent-rgb, 90,180,255), .14); }
.chl-sbtn kbd { font-family: var(--mono, monospace); font-size: .65rem; padding: .1rem .3rem; border-radius: .25rem; border: 1px solid rgba(255,255,255,.2); color: var(--muted, #7d8c9d); letter-spacing: 0; }
`;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const fmt = (n: number) => fmtInt(n);
const pad = (n: number) => String(n).padStart(2, '0');
/** A number with fixed decimals in the active language ("1.35"). */
const fixed = (v: number, d: number) => {
  try { return new Intl.NumberFormat(currentLang(), { minimumFractionDigits: d, maximumFractionDigits: d }).format(v); } catch { return v.toFixed(d); }
};
/** A UTC date key (YYYY-MM-DD) as a date. */
const dayDate = (k: string, opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' }) => fmtDate(new Date(k + 'T12:00:00Z'), { ...opts, timeZone: 'UTC' });
/** Survival variant texts (game data mission.<id>.*, survival.<id>.hordeName). */
const svTitle = (v: SurvivalVariant) => dt('mission', v.id, 'title', v.title);
const svLocation = (v: SurvivalVariant) => dt('mission', v.id, 'location', v.location);
const svHorde = (v: SurvivalVariant) => dt('survival', v.id, 'hordeName', v.hordeName);
function hms(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}

let uid = 0;
/** Layered landscape silhouette for a climate (sky, far ridge, hills, foreground detail). */
function landscape(climate: string, mood: 'day' | 'night' | 'storm' | 'dusk' = 'day', seed = 1): string {
  const id = `ls${++uid}`;
  const rnd = (k: number) => { const x = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };
  const ridge = (y: number, amp: number, n: number, k: number, sharp = false) => {
    let d = `M0 140L0 ${y}`;
    for (let i = 0; i <= n; i++) {
      const x = (i / n) * 320;
      const h = y - amp * (0.35 + rnd(k + i) * 0.65) * (sharp && i % 2 ? 1 : sharp ? 0.35 : 1);
      d += sharp ? `L${x.toFixed(1)} ${h.toFixed(1)}` : `Q${(x - 160 / n).toFixed(1)} ${(h - amp * 0.3).toFixed(1)} ${x.toFixed(1)} ${h.toFixed(1)}`;
    }
    return d + 'L320 140Z';
  };
  type Pal = { sky: [string, string, string]; sun: string; far: string; mid: string; near: string; detail: string };
  const P: Record<string, Pal> = {
    temperate: { sky: ['#1e3a66', '#c9744a', '#ffcf8a'], sun: '#fff1c8', far: '#4a5f72', mid: '#2c4636', near: '#14241a', detail: '#0c170f' },
    winter: { sky: ['#2a4670', '#8fb3d6', '#e8f2fb'], sun: '#ffffff', far: '#a9bfd6', mid: '#6f8aa8', near: '#e8f0f8', detail: '#22364a' },
    desert: { sky: ['#5a2a3a', '#e0763a', '#ffd38a'], sun: '#fff0c0', far: '#b06a3a', mid: '#d08a48', near: '#8a4f25', detail: '#5a3016' },
  };
  const pal = { ...(P[climate] ?? P.temperate) };
  if (mood === 'night') pal.sky = ['#03060e', '#0d1a33', '#23385e'];
  if (mood === 'storm') pal.sky = ['#10141c', '#2c3646', '#5a6676'];
  let stars = '';
  if (mood === 'night') for (let i = 0; i < 40; i++) stars += `<circle cx="${(rnd(i + 50) * 320).toFixed(1)}" cy="${(rnd(i + 90) * 70).toFixed(1)}" r="${(0.4 + rnd(i) * 0.7).toFixed(2)}" fill="#fff" opacity="${(0.4 + rnd(i + 7) * 0.6).toFixed(2)}"/>`;
  const sunY = mood === 'night' ? 28 : 62;
  const sunX = 70 + rnd(3) * 180;
  const orb = mood === 'storm' ? '' : mood === 'night'
    ? `<circle cx="${sunX}" cy="${sunY}" r="11" fill="#e8eefc"/><circle cx="${sunX + 4}" cy="${sunY - 3}" r="10" fill="${pal.sky[0]}"/>`
    : `<circle cx="${sunX}" cy="${sunY}" r="34" fill="url(#${id}g)"/><circle cx="${sunX}" cy="${sunY}" r="${climate === 'desert' ? 18 : 12}" fill="${pal.sun}"/>`;
  const clouds = mood === 'storm'
    ? `<path d="M0 20Q40 8 80 22T160 18T240 24T320 14V0H0Z" fill="#0b0e14" opacity=".9"/><path d="M0 34Q60 22 120 36T240 30T320 38V0H0Z" fill="#1a2030" opacity=".6"/><path d="M${sunX} 30l-8 22h7l-6 20 16-27h-8l7-15z" fill="#e8f0ff" opacity=".9"/>`
    : '';
  let detail = '';
  if (climate === 'temperate' || climate === 'winter') {
    for (let i = 0; i < 16; i++) {
      const x = rnd(i + 200) * 320, h = 14 + rnd(i + 300) * 16, y = 128 - rnd(i + 400) * 10;
      detail += `<path d="M${x.toFixed(1)} ${(y - h).toFixed(1)}L${(x + h * 0.32).toFixed(1)} ${y.toFixed(1)}L${(x - h * 0.32).toFixed(1)} ${y.toFixed(1)}Z" fill="${pal.detail}"/>`;
      if (climate === 'winter') detail += `<path d="M${x.toFixed(1)} ${(y - h).toFixed(1)}L${(x + h * 0.12).toFixed(1)} ${(y - h * 0.62).toFixed(1)}L${(x - h * 0.12).toFixed(1)} ${(y - h * 0.62).toFixed(1)}Z" fill="#f4f8fc"/>`;
    }
  } else {
    detail = `<path d="M0 132Q80 112 170 126T320 118V140H0Z" fill="${pal.detail}"/><path d="M250 118v-14M250 108h-5v-6M250 110h5v-8" stroke="${pal.detail}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  }
  const caps = climate === 'winter' ? `<path d="${ridge(70, 40, 9, 1, true)}" fill="#f2f7fc" opacity=".55" transform="translate(0 -2)"/>` : '';
  return `<svg viewBox="0 0 320 140" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs><linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${pal.sky[0]}"/><stop offset=".62" stop-color="${pal.sky[1]}"/><stop offset="1" stop-color="${pal.sky[2]}"/></linearGradient>
    <radialGradient id="${id}g"><stop offset="0" stop-color="${pal.sun}" stop-opacity=".75"/><stop offset="1" stop-color="${pal.sun}" stop-opacity="0"/></radialGradient></defs>
    <rect width="320" height="140" fill="url(#${id}s)"/>${stars}${orb}${clouds}
    <path d="${ridge(70, 40, 9, 1, climate !== 'desert')}" fill="${pal.far}" opacity=".9"/>${caps}
    <path d="${ridge(96, 26, 6, 20)}" fill="${pal.mid}"/>
    <path d="${ridge(116, 14, 5, 40)}" fill="${pal.near}"/>${detail}
  </svg>`;
}

function ring(frac: number): string {
  const r = 20, c = 2 * Math.PI * r;
  return `<svg class="ring" viewBox="0 0 48 48"><circle cx="24" cy="24" r="${r}" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="4"/>
    <circle cx="24" cy="24" r="${r}" fill="none" stroke="#ffcf3f" stroke-width="4" stroke-linecap="round" stroke-dasharray="${(c * frac).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 24 24)" style="filter:drop-shadow(0 0 3px rgba(255,207,63,.7))"/>
    <text x="24" y="28" text-anchor="middle" fill="#fff" font-size="12" font-family="monospace">${fmtPct(Math.round(frac * 100) / 100)}</text></svg>`;
}

function emblem(f: string): string {
  return `<span class="emb${f === 'soviet' ? ' sv' : ''}">${f === 'soviet' ? sovietEmblem() : alliedEmblem()}</span>`;
}

function briefLine(cfg: DailyConfig): string {
  const params = {
    difficulty: tCommon(`difficulty.${cfg.difficulty}`), faction: tCommon(cfg.enemies[0] === 'soviet' ? 'faction.sovietAdj' : 'faction.alliesAdj'),
    location: dailyPlace(cfg), money: fmtMoney(cfg.credits),
  };
  const squad = cfg.startUnits !== 'mcv';
  return tChallenges.html(cfg.enemies.length > 1 ? (squad ? 'daily.briefTwoSquad' : 'daily.briefTwo') : squad ? 'daily.briefOneSquad' : 'daily.briefOne', params);
}

function dailyCard(cfg: DailyConfig, p: Profile, day: string): string {
  const mood = cfg.modifiers.includes('night-ops') ? 'night' : cfg.modifiers.includes('storm-front') ? 'storm' : cfg.hour > 17 ? 'dusk' : 'day';
  const mods = cfg.modifiers.map((id) => MODIFIER_BY_ID[id]).filter(Boolean);
  const best = p.daily.best[day];
  const playedToday = p.daily.lastDay === day;
  const streakLive = playedToday || p.daily.lastDay === prevDay(day);
  const streak = streakLive ? p.daily.streak : 0;
  const streakNote = tChallenges.html(playedToday ? 'daily.streakSecured' : streakLive && streak ? 'daily.streakKeep' : 'daily.streakStart');
  const facName = (f: string) => tCommon.html(f === 'soviet' ? 'faction.sovietAdj' : 'faction.alliesAdj');
  const enemyFacs = [...new Set(cfg.enemies)];
  // last 14 days of personal bests
  const days = Array.from({ length: 14 }, (_, i) => shiftDay(day, i - 13));
  const maxScore = Math.max(1, ...days.map((k) => p.daily.best[k]?.score ?? 0));
  const chart = days.map((k) => {
    const r = p.daily.best[k];
    const h = r ? Math.max(8, (r.score / maxScore) * 78) : 3;
    const date = dayDate(k);
    const tip = r ? tChallenges(r.won ? 'daily.dayScore' : 'daily.dayDefeat', { date, score: fmt(r.score) }) : tChallenges('daily.dayNotPlayed', { date });
    const wd = dayDate(k, { weekday: 'short' }).toLocaleUpperCase(currentLang());
    return `<div class="${k === day ? 'today' : ''}" title="${esc(tip)}">${r ? `<em>${r.score >= 1000 ? tChallenges.html('k', { n: fixed(r.score / 1000, 1) }) : r.score}</em>` : ''}<i class="${r ? (r.won ? 'won' : 'lost') : ''}" style="height:${h.toFixed(0)}%"></i><u>${k === day ? tChallenges.html('daily.today') : esc(wd)}</u></div>`;
  }).join('');
  const firstWinXp = 600 + 100 * cfg.modifiers.length;
  const streakXp = 50 * Math.min((playedToday ? streak : streak + 1), 10);
  const climateName = tChallenges.html(`daily.climate.${cfg.climate}`);
  return `<div class="chl-panel chl-daily">
    <div class="chl-hero">${landscape(cfg.climate, mood as 'day', cfg.seed)}
      <div class="chl-clock">${picto('clock')}<div><small>${tChallenges.html('daily.nextChallenge')}</small><b data-countdown>${hms(msUntilNextDaily())}</b></div></div>
      <div class="chl-hero-t">
        <div class="chl-kick"><i></i><span>${tChallenges.html('daily.kicker', { n: String(cfg.number), date: dayDate(day) })}</span></div>
        <div class="chl-title">${tChallenges.html('daily.operation', { codename: cfg.codename })}</div>
        <div class="chl-loc"><span>${picto('flag')}${esc(dailyPlace(cfg))}</span><span>${picto(cfg.climate === 'winter' ? 'snow' : cfg.climate === 'desert' ? 'sun' : 'tree')}${climateName}</span><span>${picto('target')}${cfg.size}x${cfg.size}</span><span>${picto('coin')}${fmtMoney(cfg.credits)}</span></div>
      </div>
    </div>
    <div class="chl-body">
      <div class="chl-vs">
        <div class="chl-side">${emblem(cfg.faction)}<span><small>${tChallenges.html('daily.you')}</small>${facName(cfg.faction)}</span></div>
        <span class="chl-vsx">${tChallenges.html('daily.vs')}</span>
        <div class="chl-side">${enemyFacs.map(emblem).join('')}<span><small>${tChallenges.html(cfg.enemies.length > 1 ? 'daily.twoCommanders' : 'daily.enemy')}</small>${cfg.enemies.map(facName).join(' + ')}</span></div>
        <div class="chl-badges"><div class="chl-badge d-${cfg.difficulty}"><small>${tChallenges.html('daily.ai')}</small><b>${esc(tCommon(`difficulty.${cfg.difficulty}`).toLocaleUpperCase(currentLang()))}</b></div><div class="chl-badge mult"><small>${tChallenges.html('daily.score')}</small><b>x${fixed(cfg.multiplier, 2)}</b></div></div>
      </div>
      <p class="chl-brief">${briefLine(cfg)}</p>
      <div class="chl-mods" style="--n:${mods.length}">${mods.map((mo, i) => `<div class="chl-mod" style="--i:${i}"><span class="ic">${picto(mo.icon)}</span><div><b>${esc(dailyModName(mo))}</b><span>${esc(dailyModDesc(mo))}</span></div></div>`).join('')}</div>
      <div class="chl-objs"><small>${tChallenges.html('daily.objectives')}</small><span class="chl-obj p">${picto('target')}${tChallenges.html(cfg.enemies.length > 1 ? 'daily.destroyTwo' : 'daily.destroyOne')}</span><span class="chl-obj">${picto('stopwatch')}${tChallenges.html('daily.bonusTime')}</span><span class="chl-obj">${picto('untouchable')}${tChallenges.html('daily.bonusLosses')}</span></div>
      <div class="chl-stats">
        <div class="chl-stat"><small>${picto('trophy')}${tChallenges.html('daily.todaysBest')}</small><b>${best ? fmt(best.score) : '–'}${best ? `<em>${tChallenges.html('daily.runs', { n: best.attempts })}</em>` : ''}</b><span class="note">${tChallenges.html(best ? (best.won ? 'daily.victoryRecorded' : 'daily.noVictory') : 'daily.notAttempted')}</span></div>
        <div class="chl-stat streak"><small>${picto('streak')}${tChallenges.html('daily.streak')}</small><b>${streak}<em>${tChallenges.html('daily.streakDays', { n: streak, best: String(p.daily.longest) })}</em></b><span class="note">${streakNote}</span></div>
        <div class="chl-stat rw"><small>${picto('medal')}${tChallenges.html('daily.rewards')}</small>
          <div class="rl"><span>${tChallenges.html('daily.firstWin')}</span><i>${tChallenges.html('daily.xp', { n: fmt(firstWinXp) })}</i></div>
          <div class="rl"><span>${tChallenges.html('daily.streakBonus')}</span><i>${tChallenges.html('daily.xp', { n: fmt(streakXp) })}</i></div>
          <div class="rl"><span>${tChallenges.html('daily.perMedal')}</span><i>${tChallenges.html('daily.pts', { n: 500 })}</i></div></div>
      </div>
      <div class="chl-hist"><div class="hd"><span>${picto('chart')}${tChallenges.html('daily.history')}</span><span class="lg"><span><i style="background:#ffcf3f"></i>${tCommon.html('victory')}</span><span><i style="background:#c8503a"></i>${tCommon.html('defeat')}</span></span></div><div class="chl-chart">${chart}</div></div>
      <div class="chl-go"><button class="chl-btn" data-deploy="daily">${picto('play')}<span>${tChallenges.html('daily.deploy')}</span><small>${tChallenges.html('daily.deployBonus')}</small></button></div>
    </div>
  </div>`;
}

function survivalCard(v: SurvivalVariant, p: Profile, i: number): string {
  const r = survivalRecord(v, p); // solo or co-op record
  return `<div class="chl-sv ${v.climate}" style="--i:${i}" data-deploy="${survivalDeployId(v.id)}">
    <div class="chl-sv-art">${landscape(v.climate, 'day', v.seed)}</div>
    <div class="chl-sv-b">
      <div class="chl-sv-t">${esc(svTitle(v))}<em>x${fixed(v.factor, 2)}</em></div>
      <div class="chl-sv-s">${tChallenges.html('survival.where', { location: svLocation(v), horde: svHorde(v) })}</div>
      <div class="chl-sv-r"><span class="pb"><small>${tChallenges.html('survival.bestScore')}</small><b>${r ? fmt(r.bestScore) : '–'}</b></span><span><small>${tChallenges.html('survival.bestWave')}</small><b>${r ? r.bestWave : '–'}</b></span><span><small>${tChallenges.html('survival.runs')}</small><b>${r ? r.runs : 0}</b></span></div>
      <div class="chl-wt" title="${tChallenges.html('survival.waveTip')}">${Array.from({ length: 30 }, (_, k) => `<i class="${(k + 1) % 5 === 0 ? 'boss' : ''}${k < (r?.bestWave ?? 0) ? ' on' : ''}"></i>`).join('')}${[5, 15, 30].map((w, t) => `<b class="t${t}${(r?.bestWave ?? 0) >= w ? ' got' : ''}" style="left:calc(${((w - 0.5) / 30) * 100}% - ${((w - 0.5) / 30) * 0.6}rem)"></b>`).join('')}</div>
    </div>
    <div class="chl-sv-go"><button>${picto('play')}<span>${tChallenges.html('survival.deploy')}</span></button></div>
  </div>`;
}

/** Challenges hub. Returns a close function. `onProfile` (optional) adds a medal-case shortcut. */
export function showChallenges(opts: { onDeploy(missionId: string): void; onBack(): void; play(k: PlayKey): void; onProfile?(): void }): () => void {
  if (!document.getElementById('chl-style')) {
    const st = document.createElement('style');
    st.id = 'chl-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  const root = document.createElement('div');
  root.className = 'chl';
  document.body.appendChild(root);
  let day = currentDailyDay();

  const render = () => {
    day = currentDailyDay();
    const p = loadProfile();
    const cfg = dailyConfig(day);
    const totals = medalTotals(p);
    const rp = rankProgress(p.xp, p.faction);
    const near = allAchievementStates(p).filter((s) => !s.done && !s.secret).sort((a, b) => b.frac - a.frac).slice(0, 5);
    const recent = Object.entries(p.medals).map(([id, m]) => ({ id, tier: m.tier, at: m.at[m.at.length - 1] ?? 0 })).sort((a, b) => b.at - a.at).slice(0, 9)
      .map((r) => ({ r, def: ACH_BY_ID[r.id] })).filter((x) => !!x.def);
    root.innerHTML = `
      <div class="chl-col">${dailyCard(cfg, p, day)}</div>
      <div class="chl-col">
        <div class="chl-panel" style="animation-delay:.06s">
          <div class="chl-h2">${picto('tower')}<span>${tChallenges.html('survival.title')}</span><i class="sp"></i><small>${tChallenges.html('survival.sub')}</small>${coopSwitchHtml()}</div>
          <div class="chl-sv-list">${SURVIVAL_VARIANTS.map((v, i) => survivalCard(v, p, i)).join('')}</div>
        </div>
        <div class="chl-panel chl-medp" style="animation-delay:.12s">
          <div class="chl-h2">${picto('medal')}<span>${tChallenges.html('medals.title')}</span><i class="sp"></i><small>${totals.earned} / ${totals.total}</small></div>
          <div class="chl-med">
            <div><div class="chl-med-top">${ring(totals.earned / totals.total)}<div><b>${totals.complete}/${totals.achievements}</b><small>${tChallenges.html('medals.complete')}</small></div></div>
              <div class="chl-rank">${insigniaSvg(rp.index, p.faction)}<div><b>${esc(rp.name)}</b><small>${tChallenges.html('medals.xp', { n: fmt(p.xp) })}</small></div></div></div>
            <div class="chl-near">${near.map((s) => `<div class="chl-near-r"><span class="art">${medalSvg({ metal: achievementMetal(s.def, s.tier), picto: s.def.picto, category: s.def.category, locked: s.tier === 0 })}</span>
              <div><b><span>${esc(achievementTitle(s.def))}</span><em>${s.def.money ? fmtMoney(Math.round(s.cur)) : fmt(s.cur)} / ${s.def.money ? fmtMoney(Math.round(s.target)) : fmt(s.target)}</em></b><div class="tr"><i style="width:${(s.frac * 100).toFixed(1)}%"></i></div></div></div>`).join('')}</div>
          </div>
          ${recent.length ? `<div class="chl-recent"><small>${tChallenges.html('medals.recent')}</small><div>${recent.map(({ r, def }) => `<span title="${esc(achievementTitle(def))}">${medalSvg({ metal: achievementMetal(def, r.tier - 1), picto: def.picto, category: def.category })}</span>`).join('')}</div></div>` : ''}
        </div>
        <div class="chl-foot"><button class="chl-sbtn" data-act="back">${picto('back')}<span>${tCommon.html('back')}</span><kbd>${tCommon.html('keys.esc')}</kbd></button>${opts.onProfile ? `<button class="chl-sbtn" data-act="profile">${picto('user')}<span>${tChallenges.html('foot.profile')}</span></button>` : ''}<button class="chl-sbtn" data-act="scenarios">${picto('target')}<span>${tChallenges.html('foot.scenarios')}</span></button><button class="chl-sbtn" data-act="boards">${picto('trophy')}<span>${tChallenges.html('foot.leaderboards')}</span></button></div>
      </div>`;
    root.querySelectorAll<HTMLElement>('[data-deploy]').forEach((b) => (b.onclick = (e) => {
      e.stopPropagation();
      opts.play('click');
      close();
      opts.onDeploy(b.dataset.deploy!);
    }));
    (root.querySelector('[data-act="back"]') as HTMLElement).onclick = () => { opts.play('click'); close(); opts.onBack(); };
    const prof = root.querySelector('[data-act="profile"]') as HTMLElement | null;
    if (prof) prof.onclick = () => { opts.play('click'); close(); opts.onProfile!(); };
    // co-op switch on the Survival panel; scenario challenges list (back reopens this hub)
    bindCoopSwitch(root, render);
    (root.querySelector('[data-act="scenarios"]') as HTMLElement).onclick = () => { opts.play('click'); close(); openScenarioChallenges(() => showChallenges(opts)); };
    // verified global leaderboards (src/ui/leaderboard.ts)
    (root.querySelector('[data-act="boards"]') as HTMLElement).onclick = () => { opts.play('click'); close(); void import('./leaderboard').then((m) => m.showLeaderboard({ play: (k) => opts.play(k), onClose: () => showChallenges(opts) })); };
  };

  const timer = window.setInterval(() => {
    if (!root.isConnected) { window.clearInterval(timer); return; }
    if (currentDailyDay() !== day) { render(); return; }
    const el = root.querySelector('[data-countdown]');
    if (el) el.textContent = hms(msUntilNextDaily());
  }, 1000);
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !root.isConnected) return;
    e.preventDefault();
    e.stopPropagation();
    opts.play('click');
    close();
    opts.onBack();
  };
  document.addEventListener('keydown', onKey, true);
  let hovered: Element | null = null;
  root.addEventListener('pointerover', (e) => {
    const t = (e.target as HTMLElement).closest('button, .chl-sv');
    if (t && t !== hovered) opts.play('hover');
    hovered = t;
  });
  const untrap = focusTrap(root, { initial: false });
  const close = () => {
    untrap();
    window.clearInterval(timer);
    document.removeEventListener('keydown', onKey, true);
    root.classList.add('leaving');
    setTimeout(() => root.remove(), 280);
  };
  render();
  return close;
}

export { dayKey };
