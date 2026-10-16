/**
 * Campaign select (theatre map + briefing) and the mission debrief screen.
 * Styles are injected once; everything is plain DOM + inline SVG.
 */
import { campaignMissions } from '../missions';
import { isUnlocked, loadProgress, type MissionRecord } from '../missions/progress';
import { MissionRuntime, type MissionDef, type Objective, type Portrait } from '../sim/mission';
import { BUILDINGS, UNITS } from '../data/rules';
import { formatTime } from '../core/util';
import { customMissionDefs } from '../editor/store'; // [EDIT] custom missions from the editor

type Tab = 'allies' | 'soviet' | 'special';

// =====================================================================================================
// Styles
// =====================================================================================================
const CSS = `
.cmp { position: fixed; inset: 0; z-index: 22; display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(380px, 0.9fr); gap: 18px; padding: 3.2vh 2.6vw;
  background: radial-gradient(ellipse at 30% 35%, rgba(0,0,0,0.35), rgba(0,0,0,0.88) 75%); font-family: var(--font, sans-serif); color: #dfe8f2; animation: cmpIn .45s ease-out; }
@keyframes cmpIn { from { opacity: 0; transform: scale(1.01); } to { opacity: 1; transform: none; } }
.cmp-panel { background: linear-gradient(180deg, rgba(20,28,38,0.9), rgba(8,11,16,0.93)); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.55); backdrop-filter: blur(6px); }
.cmp-left { display: flex; flex-direction: column; gap: 12px; min-height: 0; }
.cmp-head { display: flex; align-items: flex-end; gap: 18px; padding: 14px 18px; }
.cmp-head .ttl { flex: 1; min-width: 0; }
.cmp-kick { font-size: 12px; letter-spacing: .34em; color: rgb(var(--accent-rgb, 90,180,255)); font-weight: 700; }
.cmp-head h1 { margin: 2px 0 0; font-size: 30px; letter-spacing: .14em; line-height: 1.05; white-space: nowrap; text-overflow: ellipsis; overflow: hidden; }
.cmp-prog { text-align: right; font-family: var(--mono, monospace); font-size: 12px; color: #9fb0c2; letter-spacing: .12em; }
.cmp-prog b { display: block; font-size: 22px; color: #ffd34d; letter-spacing: .06em; font-family: var(--font, sans-serif); }
.cmp-tabs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.cmp-tab { height: 40px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.03); color: #9fb0c2; cursor: pointer; font: inherit; font-size: 13px; letter-spacing: .16em; text-transform: uppercase; display: flex; align-items: center; justify-content: center; gap: 8px; transition: all .15s; }
.cmp-tab:hover { color: #fff; border-color: rgba(var(--accent-rgb, 90,180,255),0.5); }
.cmp-tab.on { color: #fff; background: rgba(var(--accent-rgb, 90,180,255),0.2); border-color: rgba(var(--accent-rgb, 90,180,255),0.75); box-shadow: inset 0 -2px 0 rgb(var(--accent-rgb, 90,180,255)); }
.cmp-tab svg { width: 18px; height: 18px; }
.cmp-map { position: relative; flex: 1; min-height: 0; overflow: hidden; padding: 0; background: radial-gradient(ellipse at 45% 40%, #0c1824, #03070b 80%); }
.cmp-map > svg.theatre { position: absolute; inset: 0; width: 100%; height: 100%; }
.cmp-map::before { content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 2; border-radius: 16px;
  background: repeating-linear-gradient(0deg, rgba(255,255,255,0.025) 0 1px, transparent 1px 4px); mix-blend-mode: screen; }
.cmp-sweep { position: absolute; left: 50%; top: 50%; width: 160%; aspect-ratio: 1; transform: translate(-50%, -50%); pointer-events: none; z-index: 1; border-radius: 50%;
  background: conic-gradient(from 0deg, transparent 0deg, transparent 300deg, rgba(var(--accent-rgb, 90,180,255),0.05) 340deg, rgba(var(--accent-rgb, 90,180,255),0.16) 359deg, transparent 360deg); animation: cmpSweep 9s linear infinite; }
@keyframes cmpSweep { to { transform: translate(-50%, -50%) rotate(360deg); } }
.cmp-map .legend { position: absolute; left: 14px; bottom: 12px; z-index: 3; display: flex; gap: 14px; font-family: var(--mono, monospace); font-size: 11px; letter-spacing: .12em; color: #8a99aa; }
.cmp-map .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; vertical-align: -1px; }
.cmp-map .coords { position: absolute; right: 14px; top: 10px; z-index: 3; font-family: var(--mono, monospace); font-size: 11px; color: rgba(var(--accent-rgb, 90,180,255),0.75); letter-spacing: .14em; text-align: right; }
.node { cursor: pointer; }
.node .ring { fill: rgba(6,10,14,0.92); stroke: rgba(255,255,255,0.25); stroke-width: 1.5; transition: all .2s; }
.node text.num { font-family: var(--font, sans-serif); font-weight: 800; font-size: 13px; fill: #dfe8f2; text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.node.avail .ring { stroke: rgb(var(--accent-rgb, 90,180,255)); stroke-width: 2.2; fill: rgba(var(--accent-rgb, 90,180,255),0.18); }
.node.avail .pulse { fill: none; stroke: rgb(var(--accent-rgb, 90,180,255)); stroke-width: 2; transform-box: fill-box; transform-origin: center; animation: nodePulse 1.8s ease-out infinite; }
@keyframes nodePulse { from { transform: scale(1); opacity: .9; } to { transform: scale(2.4); opacity: 0; } }
.node.done .ring { fill: rgb(var(--accent-rgb, 90,180,255)); stroke: rgba(255,255,255,0.7); }
.node.done text.num { fill: #061018; }
.node.locked { cursor: not-allowed; opacity: .55; }
.node.locked .ring { stroke-dasharray: 3 3; }
.node.sel .ring { stroke: #fff; stroke-width: 2.6; filter: drop-shadow(0 0 8px rgba(var(--accent-rgb, 90,180,255),0.95)); }
.node .tick { stroke: #fff; stroke-width: 2; opacity: 0; transition: opacity .2s; }
.node.sel .tick { opacity: .9; }
.node:hover:not(.locked) .ring { stroke: #fff; }
.node .lbl { font-family: var(--font, sans-serif); font-size: 12px; letter-spacing: .1em; fill: #c8d6e4; paint-order: stroke; stroke: rgba(0,0,0,0.85); stroke-width: 3px; pointer-events: none; opacity: 0; transition: opacity .2s; text-transform: uppercase; }
.node:hover .lbl, .node.sel .lbl { opacity: 1; }
.node .star { fill: rgba(255,255,255,0.18); }
.node .star.on { fill: #ffd34d; filter: drop-shadow(0 0 3px rgba(255,211,77,0.8)); }
.cmp-specials { position: absolute; inset: 0; z-index: 3; display: flex; flex-direction: column; gap: 10px; padding: 22px; overflow-y: auto; }
.cmp-sp { display: flex; gap: 14px; align-items: center; padding: 14px 16px; border-radius: 12px; cursor: pointer; border: 1px solid rgba(255,255,255,0.08); background: rgba(8,12,18,0.82); transition: all .15s; }
.cmp-sp:hover { border-color: rgba(var(--accent-rgb, 90,180,255),0.6); transform: translateX(3px); }
.cmp-sp.sel { border-color: rgb(var(--accent-rgb, 90,180,255)); background: rgba(var(--accent-rgb, 90,180,255),0.14); }
.cmp-sp b { display: block; font-size: 18px; letter-spacing: .08em; }
.cmp-sp span { font-size: 12px; color: #8a99aa; letter-spacing: .12em; }
.cmp-sp .rec { margin-left: auto; font-family: var(--mono, monospace); color: #ffd34d; font-size: 13px; }
.cmp-sp.locked { opacity: .45; cursor: not-allowed; }
.cmp-sp.locked:hover { transform: none; border-color: rgba(255,255,255,0.08); }
.cmp-sp .lk { width: 18px; height: 18px; color: #9fb0c2; margin-left: auto; }
.cmp-right { display: flex; flex-direction: column; min-height: 0; }
.cmp-brief { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 18px 20px 16px; overflow: hidden; }
.cmp-brief .kick { display: flex; justify-content: space-between; align-items: center; }
.cmp-brief h1 { margin: 4px 0 0; font-size: 34px; letter-spacing: .1em; line-height: 1.02; }
.cmp-brief h3 { margin: 4px 0 0; font-size: 13px; letter-spacing: .3em; color: #9fb0c2; font-weight: 600; }
.cmp-meta { display: flex; gap: 16px; flex-wrap: wrap; font-family: var(--mono, monospace); font-size: 12px; letter-spacing: .1em; color: #9fb0c2; margin: 12px 0 12px; }
.cmp-meta span { display: inline-flex; align-items: center; gap: 6px; }
.cmp-meta svg { width: 14px; height: 14px; color: rgb(var(--accent-rgb, 90,180,255)); }
.cmp-speaker { flex: 1 1 auto; min-height: 150px; display: flex; gap: 14px; align-items: flex-start; padding: 12px; border-radius: 12px; background: rgba(0,0,0,0.28); border: 1px solid rgba(255,255,255,0.06); overflow: hidden; }
.cmp-pt { width: 84px; height: 98px; flex-shrink: 0; border-radius: 10px; overflow: hidden; position: relative;
  background: radial-gradient(ellipse at 50% 30%, rgba(var(--accent-rgb, 90,180,255),0.35), #05080c 75%); border: 1px solid rgba(var(--accent-rgb, 90,180,255),0.45); }
.cmp-pt svg { width: 100%; height: 100%; display: block; }
.cmp-pt::after { content: ''; position: absolute; inset: 0; background: repeating-linear-gradient(0deg, rgba(255,255,255,0.06) 0 1px, transparent 1px 3px); }
.cmp-say { flex: 1; min-width: 0; align-self: stretch; display: flex; flex-direction: column; min-height: 0; }
.cmp-say .who { font-size: 12px; letter-spacing: .24em; color: rgb(var(--accent-rgb, 90,180,255)); font-weight: 700; }
.cmp-say .role { font-size: 11px; letter-spacing: .14em; color: #7c8b9b; margin-bottom: 6px; }
.cmp-speaker { position: relative; }
.cmp-wm { position: absolute; right: 14px; bottom: 10px; width: 120px; height: 120px; opacity: .06; pointer-events: none; color: rgb(var(--accent-rgb, 90,180,255)); }
.cmp-stamp { position: absolute; left: 112px; bottom: 10px; font-family: var(--mono, monospace); font-size: 10px; letter-spacing: .3em; color: rgba(255,120,100,0.45); pointer-events: none; }
.cmp-text { flex: 1; min-height: 0; overflow-y: auto; margin-top: 8px; padding-right: 6px; cursor: pointer; }
.cmp-text p { font-size: 15.5px; line-height: 1.58; color: #d4e0ec; margin: 0 0 11px; min-height: 1.2em; }
.cmp-text p.typing::after { content: '▌'; color: rgb(var(--accent-rgb, 90,180,255)); animation: cmpCaret .8s steps(1) infinite; margin-left: 1px; }
@keyframes cmpCaret { 50% { opacity: 0; } }
.cmp-tips { margin-top: 10px; padding: 10px 14px; border-radius: 10px; background: rgba(var(--accent-rgb, 90,180,255),0.07); border: 1px solid rgba(var(--accent-rgb, 90,180,255),0.22); }
.cmp-tips h4, .cmp-tech h4 { margin: 0 0 4px; font-size: 11px; letter-spacing: .26em; color: rgb(var(--accent-rgb, 90,180,255)); }
.cmp-tips div { font-size: 13px; color: #b8c8d8; margin: 4px 0; padding-left: 14px; position: relative; line-height: 1.4; }
.cmp-tips div::before { content: ''; position: absolute; left: 0; top: 6px; width: 6px; height: 6px; transform: rotate(45deg); background: rgb(var(--accent-rgb, 90,180,255)); }
.cmp-tech { margin-top: 10px; display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.cmp-tech h4 { width: 100%; }
.cmp-chip { font-size: 12px; padding: 3px 9px; border-radius: 999px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.12); color: #d4e0ec; letter-spacing: .04em; }
.cmp-foot { display: flex; gap: 10px; align-items: center; margin-top: 12px; }
.cmp-rec { flex: 1; display: flex; gap: 12px; align-items: center; font-family: var(--mono, monospace); font-size: 12px; letter-spacing: .1em; color: #9fb0c2; }
.cmp-stars { display: inline-flex; gap: 4px; }
.cmp-stars svg { width: 18px; height: 18px; }
.cmp-btn { height: 50px; padding: 0 28px; border-radius: 12px; border: 0; cursor: pointer; font: inherit; font-weight: 800; letter-spacing: .3em; text-transform: uppercase; font-size: 16px; color: #fff;
  background: linear-gradient(180deg, rgba(var(--accent-rgb, 90,180,255),0.95), rgba(var(--accent-rgb, 90,180,255),0.55)); box-shadow: 0 0 28px rgba(var(--accent-rgb, 90,180,255),0.4); transition: filter .15s, transform .15s; }
.cmp-btn:hover { filter: brightness(1.15); transform: translateY(-1px); }
.cmp-btn.sec { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.14); box-shadow: none; font-size: 13px; padding: 0 20px; }
.cmp-btn:disabled { opacity: .4; cursor: not-allowed; filter: none; transform: none; }
.cmp-empty { color: #8a99aa; font-size: 14px; padding: 20px; text-align: center; }

/* ---- debrief ---- */
.dbf { position: fixed; inset: 0; z-index: 40; display: flex; align-items: center; justify-content: center; font-family: var(--font, sans-serif); color: #dfe8f2;
  background: radial-gradient(ellipse at 50% 40%, rgba(0,0,0,0.45), rgba(0,0,0,0.9) 70%); animation: cmpIn .5s ease-out; }
.dbf.lose { background: radial-gradient(ellipse at 50% 40%, rgba(60,0,0,0.35), rgba(0,0,0,0.92) 70%); }
.dbf-card { width: min(980px, 94vw); max-height: 94vh; overflow-y: auto; padding: 26px 30px 22px; display: grid; grid-template-columns: 1fr 1fr; gap: 18px 26px; }
.dbf-top { grid-column: 1 / -1; text-align: center; }
.dbf-top .kick { font-size: 12px; letter-spacing: .4em; color: rgb(var(--accent-rgb, 90,180,255)); font-weight: 700; }
.dbf-top h1 { margin: 6px 0 0; font-size: 46px; letter-spacing: .22em; text-shadow: 0 0 30px rgba(var(--accent-rgb, 90,180,255),0.45); }
.dbf.lose .dbf-top h1 { color: #ff8a7a; text-shadow: 0 0 30px rgba(255,80,60,0.5); }
.dbf-top .sub { font-size: 14px; letter-spacing: .26em; color: #9fb0c2; margin-top: 4px; }
.dbf-reason { margin-top: 8px; color: #ffb0a0; font-size: 15px; letter-spacing: .06em; }
.dbf-stars { grid-column: 1 / -1; display: flex; justify-content: center; gap: 34px; margin: 6px 0 4px; }
.dbf-star { display: flex; flex-direction: column; align-items: center; gap: 6px; width: 150px; }
.dbf-star svg { width: 76px; height: 76px; }
.dbf-star .s-off { fill: rgba(255,255,255,0.08); stroke: rgba(255,255,255,0.25); stroke-width: 1.2; }
.dbf-star .s-on { fill: #ffd34d; stroke: #fff3c4; stroke-width: 1.2; transform-box: fill-box; transform-origin: center; transform: scale(0); }
.dbf-star.lit svg { filter: drop-shadow(0 0 10px rgba(255,211,77,0.75)); }
.dbf-star.lit .s-on { animation: starPop .55s cubic-bezier(.2,1.6,.4,1) forwards; }
@keyframes starPop { 0% { transform: scale(0) rotate(-40deg); } 100% { transform: scale(1) rotate(0); } }
.dbf-star span { font-size: 12px; letter-spacing: .14em; color: #9fb0c2; text-align: center; text-transform: uppercase; }
.dbf-star.lit span { color: #ffe8a0; }
.dbf-sec h4 { margin: 0 0 8px; font-size: 11px; letter-spacing: .3em; color: rgb(var(--accent-rgb, 90,180,255)); }
.dbf-time { font-family: var(--mono, monospace); font-size: 13px; color: #b8c8d8; }
.dbf-bar { position: relative; height: 10px; border-radius: 6px; background: rgba(255,255,255,0.08); margin: 8px 0 6px; overflow: visible; }
.dbf-bar i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 6px; background: linear-gradient(90deg, rgba(var(--accent-rgb, 90,180,255),0.6), rgb(var(--accent-rgb, 90,180,255))); width: 0; transition: width 1.2s cubic-bezier(.2,.8,.2,1); }
.dbf-bar i.over { background: linear-gradient(90deg, #ffb060, #ff6a4a); }
.dbf-bar b { position: absolute; top: -5px; bottom: -5px; width: 2px; background: #ffd34d; box-shadow: 0 0 6px #ffd34d; }
.dbf-bar em { position: absolute; top: 14px; transform: translateX(-50%); font-style: normal; font-size: 10px; letter-spacing: .14em; color: #ffd34d; font-family: var(--mono, monospace); }
.dbf-big { display: flex; gap: 18px; margin-top: 18px; }
.dbf-big div { flex: 1; padding: 10px 12px; border-radius: 10px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.06); }
.dbf-big small { display: block; font-size: 10px; letter-spacing: .26em; color: #8a99aa; }
.dbf-big b { font-size: 24px; font-family: var(--mono, monospace); letter-spacing: .04em; }
.dbf-obj { display: flex; flex-direction: column; gap: 6px; }
.dbf-o { display: flex; gap: 10px; align-items: flex-start; font-size: 14px; line-height: 1.3; opacity: 0; transform: translateX(-8px); animation: dbfIn .35s ease-out forwards; }
@keyframes dbfIn { to { opacity: 1; transform: none; } }
.dbf-o.opt { font-size: 13px; color: #b8c8d8; }
.dbf-o svg { width: 16px; height: 16px; flex-shrink: 0; margin-top: 1px; }
.dbf-o.done { color: #b9ffcf; }
.dbf-o.failed { color: #ff9a8a; }
.dbf-o .tag { margin-left: auto; font-size: 10px; letter-spacing: .2em; color: #8a99aa; white-space: nowrap; padding-left: 8px; }
.dbf-radio { grid-column: 1 / -1; display: flex; gap: 14px; align-items: flex-start; padding: 14px; border-radius: 12px; background: rgba(0,0,0,0.32); border: 1px solid rgba(255,255,255,0.07); }
.dbf-radio .txt { flex: 1; min-height: 70px; }
.dbf-radio .who { font-size: 12px; letter-spacing: .24em; color: rgb(var(--accent-rgb, 90,180,255)); font-weight: 700; margin-bottom: 6px; }
.dbf-radio .line { font-size: 16px; line-height: 1.5; color: #e8f0f8; }
.dbf-actions { grid-column: 1 / -1; display: flex; gap: 10px; justify-content: flex-end; }
`;

function injectCss() {
  if (document.getElementById('cmp-style')) return;
  const st = document.createElement('style');
  st.id = 'cmp-style';
  st.textContent = CSS;
  document.head.appendChild(st);
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

// =====================================================================================================
// Icons
// =====================================================================================================
const IC = {
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s7-7.2 7-12a7 7 0 1 0-14 0c0 4.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7L12 17.3 5.8 20.9l1.6-7L2 9.2l7.1-.6z"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/></svg>',
  hammer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 4l6 6-3 3-6-6zM11 7l-8 8 3 3 8-8"/></svg>',
  target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="#58ff8a" stroke-width="3"><path d="M4 12l5 5L20 6"/></svg>',
  cross: '<svg viewBox="0 0 24 24" fill="none" stroke="#ff5a46" stroke-width="3"><path d="M5 5l14 14M19 5L5 19"/></svg>',
  dot: '<svg viewBox="0 0 24 24" fill="none" stroke="#8a99aa" stroke-width="2"><circle cx="12" cy="12" r="6"/></svg>',
};
const STAR_PATH = 'M50 4l13.5 29.8 32.5 3.4-24.3 22 6.9 32L50 75.3 21.4 91.2l6.9-32L4 37.2l32.5-3.4z';
function starsHtml(n: number, total = 3): string {
  return `<span class="cmp-stars">${Array.from({ length: total }, (_, k) => `<svg viewBox="0 0 100 100"><path d="${STAR_PATH}" fill="${k < n ? '#ffd34d' : 'rgba(255,255,255,0.14)'}"${k < n ? ' style="filter:drop-shadow(0 0 3px rgba(255,211,77,.8))"' : ''}/></svg>`).join('')}</span>`;
}

// =====================================================================================================
// Portraits: stylised busts for the recurring cast (fallback by portrait kind)
// =====================================================================================================
const BUST = (coat: string, skin = '#c9a58f') => `<path d="M6 104 C8 74 22 62 42 62 C62 62 76 74 78 104 Z" fill="${coat}"/><rect x="35" y="52" width="14" height="14" rx="3" fill="${skin}" opacity=".9"/>`;
const HEAD = (skin = '#c9a58f') => `<ellipse cx="42" cy="40" rx="15" ry="17.5" fill="${skin}"/>`;
const EYES = (c = '#1b2430') => `<circle cx="36.5" cy="40" r="1.6" fill="${c}"/><circle cx="47.5" cy="40" r="1.6" fill="${c}"/>`;
function portraitSvg(name: string, kind: Portrait): string {
  const n = name.toLowerCase();
  const wrap = (inner: string) => `<svg viewBox="0 0 84 98" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
  if (n.includes('rourke')) {
    return wrap(`${BUST('#4a5a3c')}<path d="M30 64 L42 80 L54 64" fill="#d8d2b8"/><path d="M40 66 L44 66 L43 90 L41 90Z" fill="#7a1e1e"/>${HEAD('#d4ae96')}${EYES()}
      <path d="M33 49 C37 47 47 47 51 49 C49 52 35 52 33 49Z" fill="#cfcfcf"/><path d="M24 33 C24 18 60 18 60 33 L60 30 C54 22 30 22 24 30Z" fill="#3e4a33"/>
      <rect x="22" y="28" width="40" height="6" rx="2" fill="#2f3828"/><path d="M27 28 C30 20 54 20 57 28" fill="#5b6b48"/><circle cx="42" cy="27" r="3" fill="#ffd34d"/><path d="M14 72 l10 -2 2 6 -10 2z" fill="#ffd34d" opacity=".8"/>`);
  }
  if (n.includes('brandt')) {
    return wrap(`${BUST('#2c3440')}<path d="M32 64 L42 74 L52 64" fill="#e6e9ee"/>${HEAD('#e2c2ad')}${EYES()}<path d="M37 49 Q42 51 47 49" stroke="#8a4a4a" stroke-width="1.6" fill="none"/>
      <path d="M25 44 C22 22 62 22 59 44 C58 30 52 26 42 26 C32 26 27 32 25 44Z" fill="#c9a14a"/><path d="M25 44 C24 52 27 58 29 60 L29 44Z M59 44 C60 52 57 58 55 60 L55 44Z" fill="#c9a14a"/>
      <rect x="31" y="38" width="9" height="5" rx="2" fill="none" stroke="#222" stroke-width="1.2"/><rect x="44" y="38" width="9" height="5" rx="2" fill="none" stroke="#222" stroke-width="1.2"/><path d="M40 40 L44 40" stroke="#222" stroke-width="1.2"/>`);
  }
  if (n.includes('kestrel')) {
    return wrap(`${BUST('#2d3a2a')}<path d="M20 74 L64 98" stroke="#5a4630" stroke-width="5"/>${HEAD('#d9b398')}${EYES()}<path d="M37 49 Q42 50 48 48" stroke="#7a3a3a" stroke-width="1.6" fill="none"/>
      <path d="M48 33 L53 46" stroke="#a0605a" stroke-width="1.4"/><path d="M26 40 C22 18 60 16 58 36 C52 28 40 26 30 32 C28 36 27 40 26 40Z" fill="#2a1c16"/>
      <path d="M24 30 C30 18 56 16 62 30 L62 26 C56 16 28 16 22 26Z" fill="#6b1f1f"/><path d="M58 30 C66 34 66 46 60 58 C64 46 62 38 56 34Z" fill="#2a1c16"/><path d="M28 47 l6 1 M50 48 l6 -1" stroke="#3a3a3a" stroke-width="2" opacity=".55"/>`);
  }
  if (n.includes('saarinen')) {
    return wrap(`${BUST('#e9edf1')}<path d="M34 64 L42 72 L50 64" fill="#5a6b80"/>${HEAD('#ecd0bf')}${EYES()}<path d="M37 50 Q42 52 47 50" stroke="#8a5a5a" stroke-width="1.5" fill="none"/>
      <path d="M25 36 C22 20 34 16 42 18 C50 16 62 20 59 36 C56 26 52 24 48 25 C44 22 36 22 32 26 C28 26 26 30 25 36Z" fill="#e6e6e6"/><path d="M24 34 C20 30 22 26 25 28 M60 34 C64 30 62 26 59 28" stroke="#e6e6e6" stroke-width="3"/>
      <circle cx="36.5" cy="40" r="5" fill="none" stroke="#2a2a2a" stroke-width="1.5"/><circle cx="47.5" cy="40" r="5" fill="none" stroke="#2a2a2a" stroke-width="1.5"/><path d="M41.5 40 L42.5 40" stroke="#2a2a2a" stroke-width="1.5"/>`);
  }
  if (n.includes('hollander')) {
    return wrap(`${BUST('#5a4a36')}<path d="M24 70 C30 66 54 66 60 70 L60 76 L24 76Z" fill="#8a7050"/>${HEAD('#d6b298')}${EYES()}<path d="M36 50 Q42 53 48 50" stroke="#7a4a4a" stroke-width="1.6" fill="none"/>
      <path d="M24 38 C22 16 62 16 60 38 L58 36 C56 24 28 24 26 36Z" fill="#4a3f33"/><rect x="27" y="31" width="30" height="8" rx="4" fill="#ffc060" opacity=".85"/><rect x="27" y="31" width="30" height="8" rx="4" fill="none" stroke="#3a3026" stroke-width="2"/>`);
  }
  if (n.includes('morozov')) {
    return wrap(`${BUST('#5a2a26')}<path d="M24 72 l8 -3 1 6 -8 3z M52 69 l8 3 -1 6 -8 -3z" fill="#d8b04a"/>${HEAD('#c79a86')}${EYES()}<path d="M34 34 L40 36 M44 36 L50 34" stroke="#3a2a22" stroke-width="2.6"/>
      <path d="M35 50 C38 48 46 48 49 50" stroke="#3a2a22" stroke-width="2.4" fill="none"/><path d="M20 30 C20 14 64 14 64 30 L66 31 C60 34 24 34 18 31Z" fill="#4a2420"/><rect x="22" y="27" width="40" height="6" rx="2" fill="#2a1412"/>
      <path d="M24 33 L60 33 L58 36 L26 36Z" fill="#111"/><path d="M42 19 l2 4.4 4.8.4-3.6 3.2 1.1 4.7L42 29.2l-4.2 2.5 1.1-4.7-3.6-3.2 4.8-.4z" fill="#ff4a3a"/>`);
  }
  if (n.includes('orlova')) {
    return wrap(`${BUST('#3a3f2c')}<path d="M32 64 L42 72 L52 64" fill="#8a1a1a"/>${HEAD('#e4c4b2')}<circle cx="36.5" cy="40.5" r="1.6" fill="#101820"/><circle cx="47.5" cy="40.5" r="1.6" fill="#101820"/><path d="M33 37 L40 38 M44 38 L51 37" stroke="#2a2420" stroke-width="1.6"/>
      <path d="M38 50 L46 50" stroke="#8a2a2a" stroke-width="1.8"/><path d="M26 48 C24 38 26 32 30 30 L30 52Z M58 48 C60 38 58 32 54 30 L54 52Z" fill="#1c1a18"/>
      <path d="M22 30 C22 16 62 16 62 30 L64 31 C58 33 26 33 20 31Z" fill="#2f5a8a"/><rect x="24" y="28" width="36" height="5" rx="2" fill="#8a1a1a"/><path d="M26 33 L58 33 L56 36 L28 36Z" fill="#111"/><circle cx="42" cy="24" r="2.6" fill="#ff4a3a"/>`);
  }
  if (n.includes('belinsky')) {
    return wrap(`${BUST('#d9dde2')}<path d="M34 64 L42 70 L50 64" fill="#7a2a2a"/>${HEAD('#e0c0aa')}${EYES()}<path d="M36 50 Q42 55 48 50" stroke="#7a3a3a" stroke-width="1.6" fill="none"/>
      <path d="M22 34 C14 22 26 10 34 18 C36 8 50 8 52 18 C60 10 72 22 62 34 C62 26 56 24 52 26 C48 20 36 20 32 26 C28 24 22 26 22 34Z" fill="#4a3a30"/>
      <rect x="28" y="24" width="28" height="8" rx="3" fill="#2a2a2a"/><circle cx="35" cy="28" r="3.2" fill="#7fd8ff"/><circle cx="49" cy="28" r="3.2" fill="#7fd8ff"/><path d="M62 70 l6 -8 -2 6 6 -2 -8 10 2 -6z" fill="#7fd8ff"/>`);
  }
  if (n.includes('gromova')) {
    return wrap(`${BUST('#5a5a48')}${HEAD('#d8b49c')}${EYES()}<path d="M37 50 Q42 49 47 50" stroke="#7a3a3a" stroke-width="1.6" fill="none"/>
      <path d="M20 40 C16 18 68 18 64 40 L60 40 C60 30 24 30 24 40Z" fill="#6a5a46"/><path d="M18 36 C18 22 66 22 66 36 C60 28 24 28 18 36Z" fill="#8a7a62"/><path d="M18 38 L18 56 C22 58 26 54 25 46Z M66 38 L66 56 C62 58 58 54 59 46Z" fill="#6a5a46"/>
      <circle cx="42" cy="27" r="2.6" fill="#ff4a3a"/><path d="M60 80 C64 74 72 74 74 80 L72 86 C68 84 64 84 60 86Z" fill="#6b5a44"/><path d="M64 76 l-2 -6 4 3z M70 76 l2 -6 -4 3z" fill="#6b5a44"/>`);
  }
  // generic by kind
  switch (kind) {
    case 'eva':
      return wrap(`<circle cx="42" cy="49" r="28" fill="none" stroke="#5ab4ff" stroke-width="2"/><circle cx="42" cy="49" r="17" fill="none" stroke="#5ab4ff" stroke-width="1.5" opacity=".6"/><circle cx="42" cy="49" r="6" fill="#9fdcff"/><path d="M42 14v10M42 74v10M7 49h10M67 49h10" stroke="#5ab4ff" stroke-width="2"/>`);
    case 'enemy':
      return wrap(`${BUST('#7a3a34')}${HEAD('#c8a09a')}${EYES()}<path d="M22 30 C22 16 62 16 62 30 L60 33 L24 33Z" fill="#4a2420"/><circle cx="42" cy="24" r="3" fill="#ff4a3a"/>`);
    case 'scientist':
      return wrap(`${BUST('#d8dde2')}${HEAD()}${EYES()}<path d="M25 34 C24 20 60 20 59 34 C54 26 30 26 25 34Z" fill="#dcdcdc"/>`);
    case 'pilot':
      return wrap(`${BUST('#556070')}${HEAD()}${EYES()}<path d="M24 38 C22 16 62 16 60 38 L58 36 C56 24 28 24 26 36Z" fill="#556070"/><rect x="27" y="31" width="30" height="8" rx="4" fill="#ffc060" opacity=".8"/>`);
    case 'commando':
      return wrap(`${BUST('#2d3a2a')}${HEAD()}${EYES()}<path d="M26 40 C22 18 60 16 58 36 C52 28 40 26 30 32Z" fill="#3a2a22"/>`);
    case 'intel':
      return wrap(`${BUST('#2c3440')}${HEAD()}${EYES()}<path d="M24 30 L60 30 L56 20 L28 20Z" fill="#2c3440"/><rect x="22" y="29" width="40" height="3" fill="#2c3440"/>`);
    default:
      return wrap(`${BUST('#4a5a3c')}${HEAD()}${EYES()}<path d="M22 30 C22 16 62 16 62 30 L60 33 L24 33Z" fill="#3c4a3a"/><circle cx="42" cy="25" r="2.6" fill="#ffd34d"/>`);
  }
}

const ROLES: Record<string, string> = {
  'field marshal rourke': 'Allied Command, Europe',
  'major brandt': 'Allied Intelligence',
  kestrel: 'Special Operations',
  'dr. saarinen': 'Project Looking Glass',
  'capt. hollander': 'Allied Air Transport',
  'general morozov': 'Commander, Western Front',
  'commissar orlova': 'Political Directorate',
  'dr. belinsky': 'Horizon Directorate',
  'sgt. gromova': 'Raider Section, Guards Division',
  'battle control': 'Tactical Network',
};

const BRIEFER: Record<Tab, { name: string; portrait: Portrait }> = {
  allies: { name: 'Field Marshal Rourke', portrait: 'commander' },
  soviet: { name: 'General Morozov', portrait: 'enemy' },
  special: { name: 'Battle Control', portrait: 'eva' },
};

// =====================================================================================================
// Theatre map: an equirectangular Europe silhouette (lon -11..57.5, lat 72.5..28)
// =====================================================================================================
const MAP_W = 1000, MAP_H = 694;
const proj = (lon: number, lat: number): [number, number] => [(lon + 11) * 14.6, (72.5 - lat) * 15.6];

/** Main landmass: Europe + Asia Minor + Middle East + North Africa, traced clockwise from Gibraltar. */
const LAND: [number, number][] = [
  [-5.6, 36.0], [-2.0, 36.7], [0.2, 38.8], [-0.3, 39.5], [0.9, 41.0], [3.2, 41.9], [3.1, 43.1], [4.8, 43.4], [6.5, 43.1], [7.5, 43.8], [8.8, 44.4], [10.2, 43.9],
  [11.1, 42.4], [12.3, 41.7], [14.2, 40.8], [15.6, 40.0], [15.7, 38.2], [16.6, 38.9], [17.2, 39.4], [18.5, 40.1], [17.0, 41.0], [16.0, 41.6], [14.2, 42.4], [13.6, 43.5],
  [12.3, 44.6], [12.4, 45.4], [13.8, 45.7], [15.2, 44.3], [17.4, 43.0], [19.4, 41.9], [19.4, 40.4], [20.2, 39.6], [21.2, 37.8], [22.4, 36.5], [23.0, 37.9], [24.0, 38.2],
  [22.9, 40.6], [24.5, 40.9], [26.0, 40.8], [26.4, 40.1], [26.2, 39.2], [27.2, 37.9], [28.2, 36.7], [30.6, 36.8], [32.8, 36.1], [34.6, 36.8], [36.2, 36.6], [35.9, 35.4],
  [35.6, 33.9], [34.9, 32.5], [34.3, 31.3], [32.3, 31.3], [29.9, 31.2], [25.0, 31.6], [23.0, 32.6], [20.1, 32.1], [19.9, 30.5], [17.5, 31.0], [15.2, 32.4], [11.5, 33.1],
  [10.2, 34.3], [11.1, 36.8], [10.3, 37.3], [8.6, 36.9], [3.0, 36.8], [1.0, 36.5], [-2.2, 35.1], [-5.9, 35.8], [-6.8, 34.0], [-8.5, 32.8], [-9.8, 30.5], [-10.5, 27.0],
  [58.5, 27.0], [58.5, 72.8], [56.0, 70.6], [53.0, 68.3], [49.0, 68.0], [44.0, 66.2], [40.5, 64.5], [37.0, 64.2], [34.8, 64.5], [33.5, 66.4], [32.5, 67.1], [36.0, 66.5],
  [41.0, 66.9], [40.5, 67.9], [38.0, 68.4], [33.0, 69.4], [31.0, 69.8], [28.5, 70.4], [25.8, 71.1], [23.5, 70.6], [19.5, 70.0], [16.5, 68.8], [14.5, 68.0], [13.0, 66.5],
  [12.3, 65.0], [10.5, 64.0], [8.5, 63.3], [5.6, 62.3], [5.0, 61.0], [5.0, 59.6], [5.6, 58.9], [6.8, 58.1], [8.1, 58.1], [10.3, 59.0], [10.6, 59.8], [11.2, 59.1],
  [11.9, 58.0], [12.6, 56.2], [12.9, 55.4], [14.2, 55.4], [16.4, 56.3], [16.6, 57.8], [18.2, 59.3], [17.3, 60.6], [17.5, 62.4], [19.5, 63.6], [21.3, 64.6], [22.5, 65.8],
  [25.4, 65.0], [24.6, 64.2], [22.4, 63.4], [21.4, 61.5], [21.5, 60.5], [22.9, 59.9], [25.5, 60.3], [28.5, 60.6], [30.2, 59.9], [28.0, 59.5], [24.0, 59.4], [23.5, 58.6],
  [24.4, 57.3], [21.6, 57.4], [21.0, 56.1], [21.1, 55.2], [19.9, 54.4], [18.6, 54.4], [16.5, 54.5], [14.2, 53.9], [13.4, 54.4], [11.9, 54.2], [10.9, 54.0], [10.0, 54.8],
  [10.6, 55.6], [10.5, 57.6], [8.6, 57.1], [8.1, 56.0], [8.6, 55.0], [8.6, 53.9], [7.0, 53.5], [6.0, 53.4], [4.8, 53.0], [4.4, 52.2], [3.6, 51.5], [2.5, 51.1],
  [1.6, 50.9], [1.5, 50.2], [0.1, 49.5], [-1.3, 49.6], [-1.6, 48.6], [-3.0, 48.8], [-4.8, 48.4], [-4.3, 47.8], [-2.3, 47.2], [-1.2, 46.2], [-1.2, 45.0], [-1.5, 43.5],
  [-3.8, 43.4], [-7.0, 43.6], [-8.0, 43.7], [-9.3, 43.0], [-8.8, 42.0], [-8.7, 41.0], [-9.5, 38.7], [-8.9, 37.0], [-7.4, 37.2], [-6.3, 36.5],
];
const ISLANDS: [number, number][][] = [
  // Great Britain
  [[-5.7, 50.1], [-3.4, 50.6], [-1.0, 50.8], [1.4, 51.2], [1.7, 52.7], [0.3, 53.4], [-0.1, 54.5], [-1.6, 55.6], [-2.1, 57.0], [-1.8, 57.6], [-3.1, 58.6], [-5.0, 58.6],
    [-5.6, 57.6], [-6.2, 56.4], [-4.9, 55.6], [-5.1, 54.8], [-3.0, 54.0], [-3.1, 53.4], [-4.7, 52.8], [-4.1, 51.9], [-5.3, 51.7], [-3.2, 51.4], [-4.5, 51.1]],
  // Ireland
  [[-6.0, 52.2], [-6.2, 53.3], [-5.9, 54.6], [-7.5, 55.3], [-8.5, 54.4], [-10.0, 54.0], [-9.6, 52.6], [-10.3, 51.8], [-8.4, 51.6]],
  // Sicily, Sardinia, Corsica, Crete, Cyprus
  [[12.4, 37.9], [15.6, 38.2], [15.1, 36.7]],
  [[8.4, 41.0], [9.8, 41.0], [9.6, 39.1], [8.4, 38.9]],
  [[8.6, 42.9], [9.5, 42.9], [9.4, 41.4], [8.8, 41.6]],
  [[23.5, 35.6], [26.3, 35.2], [24.0, 34.9]],
  [[32.3, 35.1], [34.6, 35.6], [33.9, 34.6], [32.5, 34.7]],
  // Zealand
  [[11.0, 55.9], [12.6, 56.0], [12.2, 55.2], [11.2, 55.2]],
];
const SEAS: [number, number][][] = [
  // Black Sea
  [[28.0, 41.3], [27.5, 42.5], [28.6, 43.8], [29.7, 45.2], [30.7, 46.5], [33.0, 46.0], [32.5, 45.4], [33.5, 44.4], [35.5, 45.0], [36.6, 45.4], [37.5, 44.7], [39.7, 43.6], [41.5, 41.6], [39.7, 41.0], [36.3, 41.3], [33.4, 42.0], [31.0, 41.1]],
  // Caspian Sea
  [[47.0, 44.9], [47.9, 46.3], [49.2, 46.4], [51.3, 47.0], [53.0, 46.8], [53.2, 45.3], [51.4, 44.5], [51.3, 43.2], [52.7, 42.0], [53.0, 40.0], [53.9, 37.4], [51.5, 36.8], [49.8, 37.5], [48.9, 38.4], [49.5, 40.4], [48.4, 41.9], [47.5, 43.0]],
  // Persian Gulf
  [[48.0, 30.0], [50.2, 29.2], [51.4, 27.9], [54.0, 26.5], [56.3, 26.9], [56.6, 26.0], [52.0, 26.0], [49.5, 27.0]],
  // Sea of Azov and the White Sea's inner bay are left as land for clarity
];
const pathOf = (pts: [number, number][]) => pts.map(([lo, la], i) => { const [x, y] = proj(lo, la); return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`; }).join('') + 'Z';
const LAND_D = [LAND, ...ISLANDS].map(pathOf).join('');
const SEA_D = SEAS.map(pathOf).join('');

/** Map position per mission (lon, lat, nudge in px to keep the German cluster readable). */
const NODE_POS: Record<string, [number, number, number, number]> = {
  'allied-01': [9.7, 50.55, 0, 8], 'allied-02': [9.5, 51.3, -28, -12], 'allied-03': [10.6, 51.8, 24, -20], 'allied-04': [6.5, 60.3, 0, 0],
  'allied-05': [32.5, 37.9, 0, 0], 'allied-06': [13.4, 54.4, 10, -6], 'allied-07': [33.0, 68.0, 0, 0],
  'soviet-01': [11.9, 50.3, 16, 10], 'soviet-02': [9.2, 52.6, -6, -12], 'soviet-03': [8.5, 50.4, -22, 16], 'soviet-04': [48.0, 33.5, 0, 0],
  'soviet-05': [6.5, 60.3, 0, 0], 'soviet-06': [7.2, 51.4, -26, -4], 'soviet-07': [4.4, 51.2, -34, 10],
};
function nodeXY(def: MissionDef, k: number, count: number): [number, number] {
  const p = NODE_POS[def.id];
  if (p) { const [x, y] = proj(p[0], p[1]); return [x + p[2], y + p[3]]; }
  // unknown missions: a gentle arc across the map
  const t = count > 1 ? k / (count - 1) : 0.5;
  return [150 + t * 700, 470 - Math.sin(t * Math.PI) * 220];
}

/** The front line: Soviet-held territory east of it. Moves with campaign progress. */
function frontPath(tab: Tab, done: number): string {
  const base = tab === 'soviet' ? 15.5 - done * 1.7 : tab === 'allies' ? 12.5 + done * 3.2 : 14;
  const pts: string[] = [];
  for (let lat = 72.5; lat >= 37; lat -= 1.5) {
    const lon = base + Math.sin(lat * 0.9) * 1.4 + Math.sin(lat * 2.3 + 1) * 0.6 + (lat < 46 ? (46 - lat) * 0.35 : 0);
    const [x, y] = proj(lon, lat);
    pts.push(`${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return 'M' + pts.join(' L');
}

function theatreSvg(tab: Tab, missions: MissionDef[], prog: Record<string, MissionRecord>, order: string[], selected: string | null, unlockAll: boolean): string {
  const done = missions.filter((m) => prog[m.id]?.completed).length;
  const front = frontPath(tab, done);
  const [fx0] = proj(58.5, 72.5);
  const [, y37] = proj(0, 37);
  const sovietArea = `${front} L${fx0} ${y37.toFixed(1)} L${fx0} 0 Z`;
  const pos = missions.map((m, k) => nodeXY(m, k, missions.length));
  // route through the nodes
  let route = '', routeDone = '';
  for (let k = 1; k < pos.length; k++) {
    const [ax, ay] = pos[k - 1], [bx, by] = pos[k];
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    const dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1;
    const bend = Math.min(60, l * 0.22) * (k % 2 ? 1 : -1);
    const seg = `M${ax.toFixed(1)} ${ay.toFixed(1)} Q${(mx - (dy / l) * bend).toFixed(1)} ${(my + (dx / l) * bend).toFixed(1)} ${bx.toFixed(1)} ${by.toFixed(1)}`;
    if (prog[missions[k - 1].id]?.completed) routeDone += seg; else route += seg;
  }
  const grat: string[] = [];
  for (let lon = -10; lon <= 55; lon += 10) { const [x] = proj(lon, 0); grat.push(`M${x.toFixed(1)} 0 V${MAP_H}`); }
  for (let lat = 30; lat <= 70; lat += 10) { const [, y] = proj(0, lat); grat.push(`M0 ${y.toFixed(1)} H${MAP_W}`); }
  const nodes = missions.map((m, k) => {
    const [x, y] = pos[k];
    const unlocked = unlockAll || isUnlocked(m.id, order);
    const rec = prog[m.id];
    const cls = !unlocked ? 'locked' : rec?.completed ? 'done' : 'avail';
    const sel = selected === m.id ? ' sel' : '';
    const stars = rec?.completed ? [0, 1, 2].map((s) => `<path class="star ${s < (rec.stars ?? 0) ? 'on' : ''}" transform="translate(${(x - 17 + s * 12).toFixed(1)} ${(y + 17).toFixed(1)}) scale(0.1)" d="${STAR_PATH}"/>`).join('') : '';
    const lblRight = x < MAP_W * 0.72;
    return `<g class="node ${cls}${sel}" data-id="${m.id}">
      ${cls === 'avail' ? `<circle class="pulse" cx="${x}" cy="${y}" r="13"/>` : ''}
      <circle class="ring" cx="${x}" cy="${y}" r="13"/>
      ${cls === 'locked' ? `<g transform="translate(${x - 6} ${y - 6}) scale(0.5)" fill="none" stroke="#9fb0c2" stroke-width="2.4"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></g>` : `<text class="num" x="${x}" y="${y + 0.5}">${m.index}</text>`}
      <path class="tick" d="M${x - 21} ${y - 13} v-8 h8 M${x + 21} ${y - 13} v-8 h-8 M${x - 21} ${y + 13} v8 h8 M${x + 21} ${y + 13} v8 h-8" fill="none"/>
      ${stars}
      <text class="lbl" x="${lblRight ? x + 22 : x - 22}" y="${y - 2}" text-anchor="${lblRight ? 'start' : 'end'}">${esc(m.title)}</text>
    </g>`;
  }).join('');
  const accent = 'rgb(var(--accent-rgb, 90,180,255))';
  return `<svg class="theatre" viewBox="0 0 ${MAP_W} ${MAP_H}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="cmpSea" cx="45%" cy="40%" r="75%"><stop offset="0" stop-color="#0c1824"/><stop offset="1" stop-color="#03070b"/></radialGradient>
      <linearGradient id="cmpLand" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1c2a36"/><stop offset="1" stop-color="#121c25"/></linearGradient>
      <pattern id="cmpHatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><rect width="8" height="8" fill="rgba(210,58,44,0.10)"/><path d="M0 0 V8" stroke="rgba(255,90,70,0.22)" stroke-width="2"/></pattern>
      <clipPath id="cmpLandClip"><path d="${LAND_D}"/></clipPath>
      <filter id="cmpGlow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    <rect width="${MAP_W}" height="${MAP_H}" fill="url(#cmpSea)"/>
    <path d="${grat.join('')}" stroke="rgba(var(--accent-rgb, 90,180,255),0.08)" stroke-width="1" fill="none"/>
    <path d="${LAND_D}" fill="url(#cmpLand)" stroke="rgba(var(--accent-rgb, 90,180,255),0.45)" stroke-width="1.2" stroke-linejoin="round" filter="url(#cmpGlow)"/>
    <g clip-path="url(#cmpLandClip)">
      <rect width="${MAP_W}" height="${MAP_H}" fill="rgba(61,123,224,0.06)"/>
      <path d="${sovietArea}" fill="url(#cmpHatch)"/>
      <path d="${front}" fill="none" stroke="rgba(255,90,70,0.75)" stroke-width="2.2" stroke-dasharray="7 5"/>
    </g>
    <path d="${SEA_D}" fill="#08121b" stroke="rgba(var(--accent-rgb, 90,180,255),0.35)" stroke-width="1"/>
    <path d="${route}" fill="none" stroke="rgba(255,255,255,0.28)" stroke-width="2" stroke-dasharray="2 7" stroke-linecap="round"/>
    <path d="${routeDone}" fill="none" stroke="${accent}" stroke-width="2.6" stroke-linecap="round" opacity="0.9"/>
    ${nodes}
  </svg>`;
}

// =====================================================================================================
// Tech shown on the briefing: what is new compared with the previous mission of the campaign
// =====================================================================================================
function newTech(def: MissionDef, missions: MissionDef[]): string[] {
  if (!def.allowedBuild || !def.allowedBuild.length) return [];
  const prev = missions.filter((m) => m.index < def.index && m.allowedBuild && m.allowedBuild.length).sort((a, b) => b.index - a.index)[0];
  const before = new Set(prev?.allowedBuild ?? []);
  return def.allowedBuild.filter((t) => !before.has(t)).map((t) => (BUILDINGS[t] ?? UNITS[t])?.name).filter((n): n is string => !!n);
}

// =====================================================================================================
// Campaign screen
// =====================================================================================================
/** Campaign / special-ops mission select with a theatre map and briefings. */
export function showCampaign(opts: { onDeploy: (missionId: string) => void; onBack: () => void; play: (k: 'click' | 'tab') => void }): () => void {
  injectCss();
  const root = document.createElement('div');
  root.className = 'cmp';
  document.body.appendChild(root);
  const unlockAll = new URLSearchParams(location.search).has('unlockall');
  let tab: Tab = (localStorage.getItem('rh.campaign.tab') as Tab) || 'allies';
  if (!['allies', 'soviet', 'special'].includes(tab)) tab = 'allies';
  let selected: MissionDef | null = null;
  let typer = 0;
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    cancelAnimationFrame(typer);
    window.removeEventListener('keydown', onKey);
    root.remove();
    document.body.classList.remove('faction-soviet');
  };
  const deploy = () => {
    if (!selected) return;
    const id = selected.id;
    opts.play('click');
    close();
    opts.onDeploy(id);
  };
  const back = () => { opts.play('click'); close(); opts.onBack(); };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); back(); }
    else if (e.key === 'Enter') { e.preventDefault(); deploy(); }
  };
  window.addEventListener('keydown', onKey);

  const render = () => {
    localStorage.setItem('rh.campaign.tab', tab);
    document.body.classList.toggle('faction-soviet', tab === 'soviet');
    const missions = tab === 'special' ? [...campaignMissions(tab), ...customMissionDefs()] : campaignMissions(tab); // [EDIT] + custom missions
    const order = missions.map((m) => m.id);
    const prog = loadProgress();
    // campaigns unlock in order; special operations (survival, daily) are always open
    const open = (m: MissionDef) => unlockAll || tab === 'special' || isUnlocked(m.id, order);
    if (!selected || selected.campaign !== tab) {
      selected = missions.find((m) => open(m) && !prog[m.id]?.completed) ?? missions[missions.length - 1] ?? null;
    }
    const done = missions.filter((m) => prog[m.id]?.completed).length;
    const totalStars = missions.reduce((s, m) => s + (prog[m.id]?.stars ?? 0), 0);
    const names: Record<Tab, [string, string]> = { allies: ['ALLIED CAMPAIGN', 'Operation Dawnbreak'], soviet: ['SOVIET CAMPAIGN', 'Operation Red Horizon'], special: ['SPECIAL OPERATIONS', 'Off the Record'] };
    const tabIcon: Record<Tab, string> = { allies: IC.shield, soviet: IC.star, special: IC.target };
    const mapInner = tab === 'special'
      ? `<div class="cmp-specials">${missions.length ? missions.map((m) => {
          const r = prog[m.id];
          const isOpen = open(m);
          return `<div class="cmp-sp ${selected?.id === m.id ? 'sel' : ''} ${isOpen ? '' : 'locked'}" data-id="${m.id}"><div><b>${esc(m.title)}</b><span>${esc(m.location.toUpperCase())}</span></div>
            ${isOpen ? `<div class="rec">${m.scored ? (r?.bestScore ? 'BEST ' + r.bestScore.toLocaleString('en-US') : '') : r?.completed ? starsHtml(r.stars) : ''}</div>` : `<span class="lk">${IC.lock}</span>`}</div>`;
        }).join('') : '<div class="cmp-empty">No special operations yet.</div>'}</div>`
      : theatreSvg(tab, missions, prog, order, selected?.id ?? null, unlockAll);
    root.innerHTML = `
      <div class="cmp-left">
        <div class="cmp-panel cmp-head">
          <div class="ttl"><div class="cmp-kick">${names[tab][0]}</div><h1>${names[tab][1].toUpperCase()}</h1></div>
          ${tab !== 'special' ? `<div class="cmp-prog"><b>${done} / ${missions.length}</b>MISSIONS · ${totalStars} / ${missions.length * 3} STARS</div>` : ''}
        </div>
        <div class="cmp-tabs">${(['allies', 'soviet', 'special'] as Tab[]).map((t) => `<button class="cmp-tab ${t === tab ? 'on' : ''}" data-tab="${t}">${tabIcon[t]}${t === 'allies' ? 'Allies' : t === 'soviet' ? 'Soviets' : 'Special'}</button>`).join('')}</div>
        <div class="cmp-panel cmp-map">
          <div class="cmp-sweep"></div>
          ${mapInner}
          ${tab !== 'special' ? `<div class="coords">THEATRE: EUROPE · 1953<br>${selected ? esc(selected.location.toUpperCase()) : ''}</div>
          <div class="legend"><span><i style="background:rgba(61,123,224,0.55)"></i>ALLIED</span><span><i style="background:rgba(255,90,70,0.55)"></i>SOVIET</span><span><i style="background:transparent;border:1px dashed rgba(255,90,70,0.9)"></i>FRONT</span></div>` : ''}
        </div>
      </div>
      <div class="cmp-right">${selected ? briefing(selected, prog[selected.id], missions, tab) : '<div class="cmp-panel cmp-brief"><div class="cmp-empty">Select a mission.</div></div>'}</div>`;

    root.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => (b.onclick = () => {
      if (b.dataset.tab === tab) return;
      tab = b.dataset.tab as Tab; selected = null; opts.play('tab'); render();
    }));
    const pick = (id: string | undefined) => {
      const m = missions.find((x) => x.id === id);
      if (!m || !open(m) || m === selected) return;
      selected = m;
      opts.play('click');
      render();
    };
    root.querySelectorAll<SVGGElement>('.node').forEach((g) => g.addEventListener('click', () => pick(g.dataset.id)));
    root.querySelectorAll<HTMLElement>('.cmp-sp').forEach((el) => (el.onclick = () => pick(el.dataset.id)));
    (root.querySelector('[data-act="back"]') as HTMLElement | null)?.addEventListener('click', back);
    (root.querySelector('[data-act="deploy"]') as HTMLElement | null)?.addEventListener('click', deploy);
    startTypewriter();
  };

  const briefing = (m: MissionDef, r: MissionRecord | undefined, missions: MissionDef[], t: Tab) => {
    const who = BRIEFER[t];
    const tech = newTech(m, missions);
    const kick = m.scored ? 'SPECIAL OPERATION' : m.id.startsWith('custom-') ? 'CUSTOM MISSION' : `MISSION ${m.index} OF ${missions.length}`; // [EDIT]
    return `<div class="cmp-panel cmp-brief">
      <div class="kick"><span class="cmp-kick">${kick} · BRIEFING</span>${r?.completed ? starsHtml(r.stars) : ''}</div>
      <h1>${esc(m.title.toUpperCase())}</h1>
      <h3>OPERATION ${esc(m.codename)}</h3>
      <div class="cmp-meta"><span>${IC.pin}${esc(m.location.toUpperCase())}</span>${m.date ? `<span>${IC.clock}${esc(m.date.toUpperCase())}</span>` : ''}${m.parTime ? `<span>${IC.flag}PAR ${formatTime(m.parTime)}</span>` : ''}</div>
      <div class="cmp-speaker">
        <div class="cmp-pt">${portraitSvg(who.name, who.portrait)}</div>
        <div class="cmp-say"><div class="who">${esc(who.name.toUpperCase())}</div><div class="role">${esc((ROLES[who.name.toLowerCase()] ?? '').toUpperCase())}</div>
          <div class="cmp-text" title="Click to skip">${m.briefing.map((p) => `<p data-full="${esc(p)}"></p>`).join('')}</div>
        </div>
        <div class="cmp-wm">${t === 'soviet' ? IC.star : t === 'allies' ? IC.shield : IC.target}</div>
        <div class="cmp-stamp">TOP SECRET // ${t === 'soviet' ? 'SOVERSHENNO SEKRETNO' : 'EYES ONLY'} // ${esc(m.codename)}</div>
      </div>
      ${m.tips?.length ? `<div class="cmp-tips"><h4>FIELD NOTES</h4>${m.tips.map((x) => `<div>${esc(x)}</div>`).join('')}</div>` : ''}
      ${tech.length ? `<div class="cmp-tech"><h4>NEW EQUIPMENT</h4>${tech.map((x) => `<span class="cmp-chip">${esc(x)}</span>`).join('')}</div>` : ''}
      <div class="cmp-foot">
        <div class="cmp-rec">${r?.completed ? `${starsHtml(r.stars)}<span>BEST ${r.bestTime ? formatTime(r.bestTime) : '--:--'}</span>` : r?.bestScore ? `<span>BEST SCORE ${r.bestScore.toLocaleString('en-US')}</span>` : '<span>NOT YET ATTEMPTED</span>'}</div>
        <button class="cmp-btn sec" data-act="back">Back</button>
        <button class="cmp-btn" data-act="deploy">Deploy</button>
      </div>
    </div>`;
  };

  const startTypewriter = () => {
    cancelAnimationFrame(typer);
    const ps = Array.from(root.querySelectorAll<HTMLElement>('.cmp-text p'));
    const box = root.querySelector<HTMLElement>('.cmp-text');
    let pi = 0, ci = 0, last = performance.now();
    const finish = () => { ps.forEach((p) => { p.textContent = p.dataset.full ?? ''; p.classList.remove('typing'); }); pi = ps.length; };
    if (box) box.onclick = finish;
    const step = (now: number) => {
      if (closed || pi >= ps.length) return;
      const n = Math.max(1, Math.round((now - last) / 14));
      last = now;
      const full = ps[pi].dataset.full ?? '';
      ci = Math.min(full.length, ci + n);
      ps[pi].textContent = full.slice(0, ci);
      ps[pi].classList.add('typing');
      if (ci >= full.length) { ps[pi].classList.remove('typing'); pi++; ci = 0; }
      typer = requestAnimationFrame(step);
    };
    typer = requestAnimationFrame(step);
  };

  render();
  return close;
}

// =====================================================================================================
// Debrief
// =====================================================================================================
const GENERIC_DEBRIEF: Record<string, { speaker: string; portrait: Portrait; win: string; lose: string }> = {
  allies: { speaker: 'Field Marshal Rourke', portrait: 'commander', win: 'Well done, Commander. Rest your people; there is more work tomorrow.', lose: 'We will regroup and try again, Commander.' },
  soviet: { speaker: 'General Morozov', portrait: 'enemy', win: 'The Motherland is pleased, Comrade.', lose: 'Regroup, Comrade. History is patient, but I am not.' },
  special: { speaker: 'Battle Control', portrait: 'eva', win: 'Operation complete. Results logged.', lose: 'Operation terminated. Results logged.' },
};

/**
 * Mission-complete / mission-failed screen: animated stars, time against par, objective summary and a
 * closing radio line. Returns a function that closes it.
 */
export function showDebrief(
  result: { won: boolean; stars: number; time: number; score: number },
  def: MissionDef,
  actions: { onNext?: () => void; onRetry: () => void; onMenu: () => void },
): () => void {
  injectCss();
  const rt = MissionRuntime.current && MissionRuntime.current.def.id === def.id ? MissionRuntime.current : null;
  const objectives: Objective[] = rt ? rt.objectives.map((o) => ({ ...o })) : [];
  const reason = !result.won ? rt?.endReason ?? null : null;
  const optional = objectives.filter((o) => !o.primary);
  const optionalOk = optional.every((o) => o.state === 'done');
  const fast = !def.parTime || result.time <= def.parTime;
  const camp = def.campaign === 'allies' || def.campaign === 'soviet' ? def.campaign : 'special';
  const line = def.debrief ?? GENERIC_DEBRIEF[camp];
  const text = result.won ? line.win : line.lose;
  const factionClass = camp === 'soviet';
  const prevFaction = document.body.classList.contains('faction-soviet');
  document.body.classList.toggle('faction-soviet', factionClass);

  const root = document.createElement('div');
  root.className = `dbf ${result.won ? 'win' : 'lose'}`;
  const starLabels = [
    'Mission complete',
    def.parTime ? `Under par ${formatTime(def.parTime)}` : 'Speed',
    optional.length ? 'All optional objectives' : 'Clean sweep',
  ];
  const earned = [result.won, result.won && fast, result.won && optionalOk];
  const parPct = def.parTime ? Math.min(100, (result.time / Math.max(def.parTime, result.time) ) * 100) : 100;
  const parMark = def.parTime ? Math.min(100, (def.parTime / Math.max(def.parTime, result.time)) * 100) : 100;
  const objRow = (o: Objective, k: number) => `<div class="dbf-o ${o.primary ? '' : 'opt'} ${o.state}" style="animation-delay:${0.6 + k * 0.12}s">
      ${o.state === 'done' ? IC.check : o.state === 'failed' ? IC.cross : IC.dot}<span>${esc(o.text)}</span><span class="tag">${o.primary ? 'PRIMARY' : 'OPTIONAL'}</span></div>`;
  root.innerHTML = `
    <div class="cmp-panel dbf-card">
      <div class="dbf-top">
        <div class="kick">${def.scored ? 'SPECIAL OPERATION' : `MISSION ${def.index}`} · OPERATION ${esc(def.codename)}</div>
        <h1>${result.won ? 'MISSION ACCOMPLISHED' : 'MISSION FAILED'}</h1>
        <div class="sub">${esc(def.title.toUpperCase())} · ${esc(def.location.toUpperCase())}</div>
        ${reason ? `<div class="dbf-reason">${esc(reason)}</div>` : ''}
      </div>
      ${def.scored ? '' : `<div class="dbf-stars">${starLabels.map((l, k) => `<div class="dbf-star" data-k="${k}"><svg viewBox="0 0 100 100"><path class="s-off" d="${STAR_PATH}"/><path class="s-on" d="${STAR_PATH}"/></svg><span>${esc(l)}</span></div>`).join('')}</div>`}
      <div class="dbf-sec">
        <h4>TIME</h4>
        <div class="dbf-time">${formatTime(result.time)}${def.parTime ? ` · PAR ${formatTime(def.parTime)}${result.won ? ` · ${fast ? `${formatTime(def.parTime - result.time)} UNDER` : `${formatTime(result.time - def.parTime)} OVER`}` : ''}` : ''}</div>
        ${def.parTime && result.won ? `<div class="dbf-bar"><i class="${fast ? '' : 'over'}" data-w="${parPct.toFixed(1)}"></i><b style="left:${parMark.toFixed(1)}%"></b><em style="left:${parMark.toFixed(1)}%">PAR</em></div>` : ''}
        <div class="dbf-big">
          <div><small>RESULT</small><b>${result.won ? 'VICTORY' : 'DEFEAT'}</b></div>
          ${def.scored ? `<div><small>SCORE</small><b>${Math.round(result.score).toLocaleString('en-US')}</b></div>` : `<div><small>STARS</small><b>${result.won ? result.stars : 0} / 3</b></div>`}
        </div>
      </div>
      <div class="dbf-sec">
        <h4>OBJECTIVES</h4>
        <div class="dbf-obj">${objectives.length ? objectives.map(objRow).join('') : '<div class="dbf-o">No objective record.</div>'}</div>
      </div>
      <div class="dbf-radio">
        <div class="cmp-pt">${portraitSvg(line.speaker, line.portrait)}</div>
        <div class="txt"><div class="who">${esc(line.speaker.toUpperCase())}</div><div class="line"></div></div>
      </div>
      <div class="dbf-actions">
        <button class="cmp-btn sec" data-act="menu">Main menu</button>
        <button class="cmp-btn sec" data-act="retry">${result.won ? 'Replay' : 'Retry'}</button>
        ${result.won && actions.onNext ? '<button class="cmp-btn" data-act="next">Next mission</button>' : ''}
      </div>
    </div>`;
  document.body.appendChild(root);

  const timers: number[] = [];
  let raf = 0;
  let closed = false;
  // animate stars, the par bar and the radio line
  earned.forEach((on, k) => {
    if (!on) return;
    timers.push(window.setTimeout(() => root.querySelector(`.dbf-star[data-k="${k}"]`)?.classList.add('lit'), 500 + k * 450));
  });
  timers.push(window.setTimeout(() => {
    const bar = root.querySelector<HTMLElement>('.dbf-bar i');
    if (bar) bar.style.width = `${bar.dataset.w}%`;
  }, 200));
  const lineEl = root.querySelector<HTMLElement>('.dbf-radio .line')!;
  let ci = 0, last = 0;
  const type = (now: number) => {
    if (closed) return;
    if (!last) last = now;
    ci = Math.min(text.length, ci + Math.max(1, Math.round((now - last) / 22)));
    last = now;
    lineEl.textContent = text.slice(0, ci);
    if (ci < text.length) raf = requestAnimationFrame(type);
  };
  timers.push(window.setTimeout(() => { raf = requestAnimationFrame(type); }, 1300));

  const close = () => {
    if (closed) return;
    closed = true;
    timers.forEach((t) => clearTimeout(t));
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKey);
    root.remove();
    document.body.classList.toggle('faction-soviet', prevFaction);
  };
  const act = (fn?: () => void) => () => { if (!fn) return; close(); fn(); };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); (result.won && actions.onNext ? act(actions.onNext) : act(actions.onRetry))(); }
    else if (e.key === 'Escape') { e.preventDefault(); act(actions.onMenu)(); }
  };
  window.addEventListener('keydown', onKey);
  (root.querySelector('[data-act="menu"]') as HTMLElement).onclick = act(actions.onMenu);
  (root.querySelector('[data-act="retry"]') as HTMLElement).onclick = act(actions.onRetry);
  const next = root.querySelector('[data-act="next"]') as HTMLElement | null;
  if (next) next.onclick = act(actions.onNext);
  return close;
}
export { portraitSvg as castPortrait };
