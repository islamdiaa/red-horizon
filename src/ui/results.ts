/**
 * Post-match results screen: the "one more game" moment.
 *
 *   left   service record: animated XP bar with the rank-up moment, XP breakdown, contracts ticking up
 *          (+ Commendations), medals earned, and the next unlock ("2 more wins → Arctic White paint")
 *   right  battle report: army value, income and kills over time per player (10 s samples, src/meta/report.ts),
 *          the scoreboard, the MVP unit and the match highlights
 *   foot   a big "Play again" (same settings, new map seed), "Rematch" (same seed), replay, keep watching, menu
 *
 * Fast to skip: Enter / Space (or a click on the progress panel) finishes the animations; Enter / Space again
 * plays again. Reduced motion shows the final state at once. Built inside the end screen Menus.showEnd opens
 * (keeps its .end-wrap / .end-btns, where "Make this a challenge" offers are added).
 */
import type { Game } from '../game';
import type { AudioSystem } from '../audio';
import { formatTime } from '../core/util';
import { getMapDef } from '../maps';
import { mapCodeForSetup } from '../maps/code';
import { ICONS, medalSvg as gradeSvg, rankBadge, type MedalTier } from './icons';
import { el, esc, hexColor, reducedMotion } from './dom';
import {
  ACH_BY_ID, achievementMetal, insigniaSvg, isTiered, loadProfile, medalSvg, nextUnlock, picto, rankName, unlockContext, type MatchSummary,
} from '../meta';
import type { BattleReport, ReportSample } from '../meta/report';
import { commanderLook } from '../meta/cosmetics';
import { showLocker } from './locker';

export interface ResultsCallbacks {
  playAgain(): void;
  /** Same settings and seed (skirmish only). */
  rematch?(): void;
  watchReplay?(): void;
  keepWatching(): void;
  menu(): void;
  copyCode?(code: string, el: HTMLElement): void;
}

const CSS = `
.rr-results { overflow: hidden; }
.rr-results .end-wrap { width: min(78rem, calc(100vw - 3rem)); max-height: calc(100vh - 1.6rem); gap: .55rem; }
.rr-head { display: flex; flex-direction: column; align-items: center; gap: .25rem; }
.rr-results .end-title { font-size: clamp(2.6rem, 6.2vh, 4.6rem); }
.rr-results .end-kicker { font-size: .75rem; }
.rr-grade { display: inline-flex; align-items: center; gap: .35rem; font-family: var(--font); font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: var(--gold); }
.rr-grade svg { width: 1.35rem; height: 1.35rem; }
.rr-grid { display: grid; grid-template-columns: minmax(20rem, 27rem) minmax(0, 1fr); gap: .9rem; width: 100%; min-height: 0; flex: 1 1 auto; }
.rr-col { position: relative; border-radius: .9rem; padding: .85rem 1rem; min-height: 0; display: flex; flex-direction: column; gap: .7rem; animation: panelIn .6s .35s var(--spring) both; }
.rr-report { overflow-y: auto; scrollbar-width: thin; animation-delay: .45s; }
.rr-h { display: flex; align-items: center; gap: .5rem; font-size: .64rem; font-weight: 700; letter-spacing: .3em; text-transform: uppercase; color: rgb(var(--accent-rgb)); }
.rr-h .sp { flex: 1; height: 1px; background: linear-gradient(90deg, rgba(var(--accent-rgb), .4), transparent); }
.rr-h small { font-family: var(--mono); letter-spacing: .02em; text-transform: none; color: var(--muted); font-size: .75rem; }
.rr-h .cmd { color: var(--gold); font-family: var(--mono); letter-spacing: .02em; font-size: .78rem; }
/* service record */
.rr-svc { position: relative; display: grid; grid-template-columns: 3.6rem 1fr auto; gap: .2rem .8rem; align-items: center; padding: .6rem .7rem; border-radius: .7rem; overflow: hidden; border: 1px solid rgba(255,255,255,.08); }
.rr-svc::before { content: ''; position: absolute; inset: 0; background: var(--banner); opacity: .55; z-index: 0; }
.rr-svc::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, rgba(6,9,14,.55), rgba(6,9,14,.85)); z-index: 0; }
.rr-svc > * { position: relative; z-index: 1; }
.rr-por { width: 3.6rem; height: 4.2rem; grid-row: span 2; border-radius: .45rem; background: rgba(0,0,0,.35); border: 1px solid rgba(255,255,255,.14); overflow: hidden; display: flex; align-items: flex-end; }
.rr-por svg { width: 100%; height: 100%; }
.rr-who { min-width: 0; }
.rr-who small { display: block; font-size: .6rem; font-weight: 700; letter-spacing: .26em; text-transform: uppercase; color: var(--gold); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rr-who b { display: block; font-size: 1.15rem; letter-spacing: .08em; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rr-who em { display: block; font-style: normal; font-size: .72rem; color: var(--text-2); letter-spacing: .06em; }
.rr-xpn { text-align: right; font-family: var(--mono); font-size: 1.9rem; line-height: 1; color: #fff; text-shadow: 0 0 1rem rgba(255, 210, 80, .45); }
.rr-xpn small { display: block; font-family: var(--font); font-size: .56rem; font-weight: 700; letter-spacing: .3em; color: var(--gold); }
.rr-rank { grid-column: 2 / -1; display: flex; align-items: center; gap: .55rem; }
.rr-rank .ins { width: 2.1rem; height: 2.1rem; flex-shrink: 0; transition: transform .35s var(--spring); }
.rr-rank .ins svg { width: 100%; height: 100%; }
.rr-bw { flex: 1; min-width: 0; }
.rr-bw .rn { display: flex; justify-content: space-between; font-size: .78rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
.rr-bw .rn small { font-family: var(--mono); font-weight: 400; letter-spacing: 0; color: var(--muted); }
.rr-bar { position: relative; height: .5rem; margin-top: .25rem; border-radius: 1rem; background: rgba(255,255,255,.08); overflow: hidden; box-shadow: inset 0 1px 2px rgba(0,0,0,.6); }
.rr-bar i { position: absolute; inset: 0 auto 0 0; border-radius: 1rem; background: linear-gradient(90deg, #a8741a, #ffcf3f, #fff2c0); box-shadow: 0 0 .7rem rgba(255,210,80,.7); }
.rr-promo { position: absolute; inset: 0; z-index: 3 !important; display: flex; align-items: center; justify-content: center; gap: .5rem; font-size: 1.15rem; font-weight: 700; letter-spacing: .32em; text-transform: uppercase; color: #fff;
  background: radial-gradient(ellipse at center, rgba(255, 120, 60, .55), rgba(40, 14, 6, .92) 70%); opacity: 0; pointer-events: none; text-shadow: 0 0 1rem rgba(255, 150, 60, .9); }
.rr-promo.on { animation: rrPromo 1.9s ease-out both; }
.rr-instant .rr-promo.on { animation: none; opacity: 0; }
@keyframes rrPromo { 0% { opacity: 0; transform: scale(1.15); } 12% { opacity: 1; transform: none; } 70% { opacity: 1; } 100% { opacity: 0; } }
.rr-rank.up .ins { animation: rrIns .7s var(--spring); }
@keyframes rrIns { from { transform: scale(1.8) rotate(-12deg); } }
.rr-lines { display: grid; grid-template-columns: 1fr 1fr; gap: .1rem 1rem; }
.rr-line { display: flex; justify-content: space-between; font-size: .76rem; color: var(--text-2); white-space: nowrap; overflow: hidden; }
.rr-line span { overflow: hidden; text-overflow: ellipsis; }
.rr-line b { font-family: var(--mono); font-weight: 400; color: #ffe27a; margin-left: .4rem; }
/* contracts */
.rr-cts { display: flex; flex-direction: column; gap: .3rem; }
.rr-ct { display: grid; grid-template-columns: 1.6rem 1fr auto; gap: .05rem .55rem; align-items: center; padding: .38rem .55rem; border-radius: .55rem; background: rgba(255,255,255,.025); border: 1px solid rgba(255,255,255,.05); transition: background .3s, border-color .3s; }
.rr-ct .ic { grid-row: span 2; font-size: 1.25rem; color: var(--muted); display: flex; }
.rr-ct b { font-size: .84rem; letter-spacing: .05em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rr-ct b em { font-style: normal; font-size: .56rem; letter-spacing: .2em; text-transform: uppercase; color: var(--muted); margin-left: .4rem; }
.rr-ct .v { font-family: var(--mono); font-size: .76rem; color: var(--text-2); white-space: nowrap; }
.rr-ct .tr { grid-column: 2 / -1; height: .26rem; border-radius: 1rem; background: rgba(255,255,255,.07); position: relative; overflow: hidden; }
.rr-ct .tr u { position: absolute; inset: 0 auto 0 0; border-radius: 1rem; background: rgb(var(--accent-rgb)); }
.rr-ct .tr s { position: absolute; inset: 0 auto 0 0; border-radius: 1rem; background: rgba(var(--accent-rgb), .3); text-decoration: none; }
.rr-ct.moved .ic { color: rgb(var(--accent-rgb)); }
.rr-ct.done { background: linear-gradient(90deg, rgba(77,255,154,.12), rgba(77,255,154,.02)); border-color: rgba(77,255,154,.35); }
.rr-ct.done .ic, .rr-ct.done .v { color: #8dffb0; }
.rr-ct.done .tr u { background: #4dff9a; box-shadow: 0 0 .5rem rgba(77,255,154,.7); }
.rr-ct.pop { animation: rrPop .5s var(--spring); }
@keyframes rrPop { 40% { transform: scale(1.04); } }
.rr-none { font-size: .8rem; color: var(--muted); }
/* medals */
.rr-medals { display: flex; gap: .45rem; flex-wrap: wrap; }
.rr-medal { display: flex; align-items: center; gap: .4rem; padding: .25rem .55rem .25rem .3rem; border-radius: .5rem; background: rgba(255,207,63,.07); border: 1px solid rgba(255,207,63,.22); font-size: .76rem; opacity: 0; transform: scale(.6); transition: opacity .3s, transform .4s var(--spring); }
.rr-medal.in { opacity: 1; transform: none; }
.rr-medal svg { width: 1.6rem; height: 2rem; }
/* next unlock */
.rr-tease { display: grid; grid-template-columns: 2rem 1fr auto; gap: .1rem .6rem; align-items: center; padding: .55rem .65rem; border-radius: .65rem; border: 1px dashed rgba(127, 211, 255, .35); background: linear-gradient(90deg, rgba(127,211,255,.09), rgba(127,211,255,.01)); }
.rr-tease .ic { grid-row: span 2; font-size: 1.5rem; color: #7fd3ff; display: flex; }
.rr-tease small { font-size: .56rem; font-weight: 700; letter-spacing: .28em; text-transform: uppercase; color: #7fd3ff; }
.rr-tease b { font-size: .92rem; letter-spacing: .03em; }
.rr-tease .tr { grid-column: 2 / 3; height: .3rem; border-radius: 1rem; background: rgba(255,255,255,.07); position: relative; overflow: hidden; }
.rr-tease .tr i { position: absolute; inset: 0 auto 0 0; border-radius: 1rem; background: linear-gradient(90deg, #4a8ad8, #7fd3ff); box-shadow: 0 0 .5rem rgba(127,211,255,.7); }
.rr-tease.new { border-style: solid; border-color: rgba(77,255,154,.45); background: linear-gradient(90deg, rgba(77,255,154,.12), rgba(77,255,154,.02)); }
.rr-tease.new .ic, .rr-tease.new small { color: #8dffb0; }
.rr-lk { grid-row: span 2; height: 2.1rem; padding: 0 .8rem; border-radius: .5rem; font: inherit; font-size: .72rem; font-weight: 700; letter-spacing: .2em; text-transform: uppercase; color: #dfe8f2; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.16); cursor: pointer; }
.rr-lk:hover, .rr-lk:focus-visible { color: #fff; border-color: rgba(var(--accent-rgb), .7); background: rgba(var(--accent-rgb), .18); }
/* battle report */
.rr-charts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .6rem; }
.rr-chart { position: relative; padding: .45rem .5rem .3rem; border-radius: .6rem; background: rgba(0,0,0,.22); border: 1px solid rgba(255,255,255,.06); }
.rr-chart h4 { margin: 0 0 .15rem; font-size: .6rem; font-weight: 700; letter-spacing: .22em; text-transform: uppercase; color: var(--text-2); display: flex; justify-content: space-between; }
.rr-chart h4 span:last-child { font-family: var(--mono); letter-spacing: 0; color: var(--muted); text-transform: none; }
.rr-chart svg { display: block; width: 100%; height: auto; overflow: visible; }
.rr-chart .ax { font: 9px var(--mono); fill: #7d8c9d; }
.rr-chart .gl { stroke: rgba(255,255,255,.07); stroke-width: 1; }
.rr-chart .ln { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; vector-effect: non-scaling-stroke; }
.rr-chart .ln.me { stroke-width: 2.6; }
.rr-chart .xh { stroke: rgba(255,255,255,.35); stroke-width: 1; }
.rr-chart.draw .ln { stroke-dasharray: 1000; stroke-dashoffset: 1000; animation: rrDraw 1.4s .7s var(--ease) forwards; }
.rr-instant .rr-chart.draw .ln { animation: none; stroke-dashoffset: 0; }
@keyframes rrDraw { to { stroke-dashoffset: 0; } }
.rr-tip { position: absolute; z-index: 5; top: 1.4rem; pointer-events: none; min-width: 7.5rem; padding: .35rem .5rem; border-radius: .45rem; background: rgba(6,9,14,.95); border: 1px solid rgba(255,255,255,.14); font-size: .7rem; color: var(--text); box-shadow: 0 .5rem 1.2rem rgba(0,0,0,.5); display: none; }
.rr-tip div { display: flex; align-items: center; gap: .35rem; white-space: nowrap; }
.rr-tip div i { width: .55rem; height: .55rem; border-radius: 50%; flex-shrink: 0; }
.rr-tip div b { margin-left: auto; padding-left: .6rem; font-family: var(--mono); font-weight: 400; }
.rr-tip > small { display: block; font-family: var(--mono); color: var(--muted); margin-bottom: .15rem; }
.rr-legend { display: flex; flex-wrap: wrap; gap: .3rem 1rem; font-size: .74rem; color: var(--text-2); }
.rr-legend span { display: inline-flex; align-items: center; gap: .35rem; }
.rr-legend i { width: 1rem; height: .22rem; border-radius: 1rem; }
.rr-legend em { font-style: normal; font-size: .6rem; font-weight: 700; letter-spacing: .18em; color: var(--gold); text-transform: uppercase; }
.rr-results .stats-table { font-size: .82rem; animation-delay: .6s; }
.rr-results .stats-table th, .rr-results .stats-table td { padding: .36rem .65rem; }
.rr-bottom { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); gap: .6rem; }
.rr-results .end-mvp { animation-delay: .8s; padding: .5rem .7rem; }
.rr-results .mvp-por { width: 4.6rem; height: 3.4rem; }
.rr-hl { display: flex; flex-direction: column; gap: .2rem; padding: .45rem .6rem; border-radius: .7rem; background: rgba(0,0,0,.2); border: 1px solid rgba(255,255,255,.06); }
.rr-hl h5 { margin: 0 0 .15rem; font-size: .58rem; font-weight: 700; letter-spacing: .26em; text-transform: uppercase; color: var(--text-2); }
.rr-hl div { display: flex; gap: .55rem; align-items: center; font-size: .76rem; color: var(--text-2); }
.rr-hl div em { font-style: normal; font-family: var(--mono); font-size: .7rem; color: var(--muted); min-width: 2.6rem; }
.rr-hl div .mx-ic { color: rgb(var(--accent-rgb)); flex-shrink: 0; }
.rr-results .mom-offers { margin: 0; }
/* buttons */
.rr-btns { display: flex; gap: .6rem; justify-content: center; align-items: stretch; flex-wrap: wrap; }
.rr-btns .btn-primary.rr-again { height: 3.4rem; min-width: 17rem; font-size: 1.15rem; letter-spacing: .3em; }
.rr-btns .btn-primary.rr-again kbd, .rr-btns .btn kbd { font-family: var(--mono); font-size: .62rem; letter-spacing: 0; padding: .1rem .35rem; border-radius: .25rem; border: 1px solid rgba(255,255,255,.3); opacity: .8; margin-left: .3rem; }
.rr-btns .btn { height: 3.4rem; }
.rr-skip { position: absolute; right: 0; top: 0; font-size: .62rem; letter-spacing: .2em; text-transform: uppercase; color: var(--muted); }
.rr-instant .rr-skip { display: none; }
@media (max-height: 820px) {
  .rr-results .end-meta { font-size: .76rem; }
  .rr-col { padding: .65rem .8rem; gap: .5rem; }
  .rr-lines { display: none; }
}
`;

function ensureCss() {
  if (document.getElementById('rr-style')) return;
  const st = document.createElement('style');
  st.id = 'rr-style';
  st.textContent = CSS;
  document.head.appendChild(st);
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const money = (n: number) => (n >= 10000 ? `$${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : `$${fmt(n)}`);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const ease = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);

/** Clean axis maximum (1, 2, 2.5, 5 x 10^n). */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

interface Series { name: string; color: string; me: boolean; values: number[] }

/** A small line chart (SVG): one line per player, recessive grid, end dots, hover crosshair + tooltip. */
function lineChart(title: string, unit: string, times: number[], series: Series[], f: (v: number) => string): HTMLElement {
  const W = 240, H = 104, L = 34, R = 236, T = 8, B = 86;
  const box = el('div', 'rr-chart draw');
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const tEnd = Math.max(1, times[times.length - 1] ?? 1);
  const x = (t: number) => L + ((R - L) * t) / tEnd;
  const y = (v: number) => B - ((B - T) * v) / max;
  let svg = '';
  for (const k of [0, 0.5, 1]) svg += `<line class="gl" x1="${L}" x2="${R}" y1="${y(max * k).toFixed(1)}" y2="${y(max * k).toFixed(1)}"/><text class="ax" x="${L - 4}" y="${(y(max * k) + 3).toFixed(1)}" text-anchor="end">${esc(f(max * k))}</text>`;
  svg += `<text class="ax" x="${L}" y="${H - 4}">0:00</text><text class="ax" x="${R}" y="${H - 4}" text-anchor="end">${formatTime(tEnd)}</text>`;
  // the local player's line on top, with a faint wash under it
  const order = [...series].sort((a, b) => Number(a.me) - Number(b.me));
  for (const s of order) {
    if (!s.values.length) continue;
    const pts = s.values.map((v, i) => `${x(times[i]).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    if (s.me && s.values.length > 1) svg += `<polygon points="${x(times[0]).toFixed(1)},${B} ${pts} ${x(times[s.values.length - 1]).toFixed(1)},${B}" fill="${s.color}" opacity=".1"/>`;
    svg += `<polyline class="ln${s.me ? ' me' : ''}" points="${pts}" stroke="${s.color}" pathLength="1000"/>`;
    const lv = s.values[s.values.length - 1];
    svg += `<circle cx="${x(times[s.values.length - 1]).toFixed(1)}" cy="${y(lv).toFixed(1)}" r="3.5" fill="${s.color}" stroke="#0a0f16" stroke-width="2"/>`;
  }
  svg += `<line class="xh" x1="0" x2="0" y1="${T}" y2="${B}" style="display:none"/><rect x="${L}" y="${T}" width="${R - L}" height="${B - T}" fill="transparent" class="hit"/>`;
  const me = series.find((s) => s.me);
  const last = me?.values[me.values.length - 1] ?? 0;
  box.innerHTML = `<h4><span>${esc(title)}</span><span>${esc(me ? f(last) : '')}${esc(unit)}</span></h4>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`${title} over time. ${series.map((s) => `${s.name}: ${f(s.values[s.values.length - 1] ?? 0)}`).join(', ')}`)}">${svg}</svg><div class="rr-tip"></div>`;
  // hover / touch: crosshair and the values at that moment
  const sv = box.querySelector('svg') as SVGSVGElement;
  const xh = box.querySelector('.xh') as SVGLineElement;
  const tip = box.querySelector('.rr-tip') as HTMLElement;
  const show = (clientX: number) => {
    const r = sv.getBoundingClientRect();
    const vx = ((clientX - r.left) / Math.max(1, r.width)) * W;
    const t = ((vx - L) / (R - L)) * tEnd;
    let i = 0;
    for (let k = 0; k < times.length; k++) if (Math.abs(times[k] - t) < Math.abs(times[i] - t)) i = k;
    const px = x(times[i]);
    xh.setAttribute('x1', px.toFixed(1));
    xh.setAttribute('x2', px.toFixed(1));
    xh.style.display = '';
    tip.innerHTML = `<small>${formatTime(times[i])}</small>${series.map((s) => `<div><i style="background:${s.color}"></i><span>${esc(s.name)}</span><b>${esc(f(s.values[i] ?? 0))}</b></div>`).join('')}`;
    tip.style.display = 'block';
    const left = (px / W) * r.width;
    tip.style.left = `${Math.min(Math.max(0, left - 60), r.width - 130)}px`;
  };
  const hide = () => { xh.style.display = 'none'; tip.style.display = 'none'; };
  sv.addEventListener('pointermove', (e) => show(e.clientX));
  sv.addEventListener('pointerdown', (e) => show(e.clientX));
  sv.addEventListener('pointerleave', hide);
  return box;
}

function battleReport(game: Game, report: BattleReport | null): HTMLElement {
  const box = el('div', 'rr-rep');
  const samples: ReportSample[] = report?.samples ?? [];
  if (samples.length < 2) {
    box.innerHTML = '<div class="rr-none">The battle was too short for a report.</div>';
    return box;
  }
  const players = game.world.players;
  const times = samples.map((s) => s.t);
  const series = (pick: (p: ReportSample['players'][number]) => number): Series[] => players.map((p, i) => ({
    name: p === game.local ? `${p.name} (you)` : p.name, color: hexColor(p.color), me: p === game.local, values: samples.map((s) => (s.players[i] ? pick(s.players[i]) : 0)),
  }));
  const charts = el('div', 'rr-charts');
  charts.append(
    lineChart('Army value', '', times, series((p) => p.army), money),
    lineChart('Income', '/min', times, series((p) => p.income), money),
    lineChart('Kills', '', times, series((p) => p.kills), (v) => fmt(v)),
  );
  box.appendChild(charts);
  box.appendChild(el('div', 'rr-legend', players.map((p) => `<span><i style="background:${hexColor(p.color)}"></i>${esc(p.name)}${p === game.local ? ' <em>you</em>' : ''}</span>`).join('')));
  return box;
}

function scoreboard(game: Game): HTMLElement {
  const me = game.local;
  const rows = game.world.players.map((p) => {
    const kills = p.stats.unitsKilled + p.stats.buildingsKilled;
    return `<tr class="${p === me ? 'me' : ''}${p.defeated ? ' dead' : ''}" style="--c:${hexColor(p.color)}">
      <td><span class="pl"><i></i><span><b>${esc(p.name)}</b><small>${p.faction === 'soviet' ? 'Soviet' : 'Allied'}${p.defeated ? ' · eliminated' : p.team === game.world.winnerTeam ? ' · victor' : ''}</small></span></span></td>
      <td>${fmt(p.stats.unitsBuilt)}</td><td>${fmt(p.stats.unitsLost)}</td><td>${fmt(kills)}</td><td>${fmt(p.stats.buildingsLost)}</td><td>${money(Math.round(p.stats.harvested))}</td></tr>`;
  }).join('');
  const t = el('table', 'stats-table');
  t.innerHTML = `<thead><tr><th>Commander</th><th>Built</th><th>Lost</th><th>Kills</th><th>Structures lost</th><th>Harvested</th></tr></thead><tbody>${rows}</tbody>`;
  return t;
}

const HL_ICON: Record<string, string> = { 'first-blood': 'crosshair', superweapon: 'nuke', elite: 'chevrons', capture: 'capture', eliminated: 'skull', peak: 'tank', clash: 'flames', comeback: 'phoenix', chrono: 'chrono' };

function mvpAndHighlights(game: Game, won: boolean, report: BattleReport | null): HTMLElement {
  const wrap = el('div', 'rr-bottom');
  const me = game.local;
  const m = report?.mvp() ?? (() => {
    const u = game.world.units.filter((x) => x.alive && x.owner === me && x.kills > 0).sort((a, b) => b.kills - a.kills || b.xp - a.xp)[0];
    return u ? { id: u.id, type: u.type.id, name: u.type.name, kills: u.kills, xp: u.xp, rank: u.rank, alive: true } : null;
  })();
  if (m) {
    const img = game.thumbs.get(m.type);
    wrap.appendChild(el('div', 'end-mvp', `<div class="mvp-tag">${ICONS.trophy}<span>MVP</span></div>
      <div class="mvp-por">${img ? `<img src="${img}" alt="">` : ICONS.vehicle}<span class="mvp-rank">${rankBadge(m.rank)}</span></div>
      <div class="mvp-info"><b>${esc(m.name)}</b><small>${['Rookie', 'Veteran', 'Elite'][m.rank] ?? 'Elite'}${m.alive ? '' : ' · fell in battle'}</small></div>
      <div class="mvp-stat"><b>${fmt(m.kills)}</b><small>kills</small></div>`));
  } else {
    wrap.appendChild(el('div', 'end-mvp none', `<div class="mvp-tag">${ICONS.trophy}<span>MVP</span></div><div class="mvp-info"><b>No kills on record</b><small>Next time, take the fight to them</small></div>`));
  }
  const hl = report?.highlights(won) ?? [];
  wrap.appendChild(el('div', 'rr-hl', `<h5>Highlights</h5>${hl.length ? hl.map((h) => `<div><em>${formatTime(h.t)}</em>${picto(HL_ICON[h.kind] ?? 'flag')}<span>${esc(h.text)}</span></div>`).join('') : '<div><span>A quiet battle.</span></div>'}`));
  return wrap;
}

/**
 * Fill the end screen `s` (opened by Menus.showEnd). `summary` = the MetaTracker's summary of this battle
 * (null for unrecorded games: replay branches, challenges).
 */
export function showResults(s: HTMLElement, game: Game, won: boolean, opts: ResultsCallbacks & {
  summary: MatchSummary | null; report: BattleReport | null; rating: { score: number; tier: MedalTier; grade: string; title: string }; audio?: AudioSystem;
}): void {
  ensureCss();
  document.querySelector('.rhx-sum')?.remove(); // the XP card's content is part of this screen
  s.classList.add('rr-results');
  const instant = reducedMotion();
  if (instant) s.classList.add('rr-instant');
  const me = game.local;
  const sum = opts.summary;
  const title = won ? 'VICTORY' : 'DEFEAT';
  const foes = game.world.players.filter((o) => me.isEnemy(o));
  const code = mapCodeForSetup(game.setup);
  s.innerHTML = '<div class="end-wash"></div><div class="end-rays"></div>';
  const wrap = el('div', 'end-wrap');
  wrap.innerHTML = `<div class="rr-head">
      <div class="end-kicker">${won ? 'Mission accomplished' : 'Mission failed'}</div>
      <h1 class="end-title" data-text="${title}">${[...title].map((c, i) => `<span class="ltr" style="--i:${i}">${c}</span>`).join('')}</h1>
      <div class="end-meta"><span>${ICONS.clock}${formatTime(game.world.time)}</span><span>${ICONS.map}${game.setup.mapId ? esc(getMapDef(game.setup.mapId)?.name ?? '') + ' · ' : ''}${game.world.map.w}×${game.world.map.h}</span><span>${ICONS.target}${foes.length} opponent${foes.length === 1 ? '' : 's'}</span>${code ? `<span class="end-code">${ICONS.copy}<code>${esc(code)}</code></span>` : ''}<span class="rr-grade" title="${esc(opts.rating.title)} · score ${fmt(opts.rating.score)}">${gradeSvg(opts.rating.tier)}Grade ${opts.rating.grade} · ${fmt(opts.rating.score)}</span></div>
    </div>`;
  const grid = el('div', 'rr-grid');
  // ---------------------------------------------------------------- progression
  const prog = el('section', 'rr-col panel rr-prog');
  const profile = loadProfile();
  const ctx = unlockContext(profile);
  const look = commanderLook(ctx);
  const promoted = !!sum && sum.rankAfter > sum.rankBefore;
  const nextLabel = (r: number) => (sum && r < 14 ? `Next: ${rankName(r + 1, sum.faction)}` : 'Highest rank');
  const rankBefore = sum ? nextLabel(sum.rankBefore) : '';
  prog.innerHTML = `<div class="rr-h">${picto('chevrons')}<span>Service record</span><i class="sp"></i><span class="rr-skip">Enter · skip</span></div>
    <div class="rr-svc" style="--banner:${look.banner}">
      <div class="rr-por">${look.portrait}</div>
      <div class="rr-who"><small>${esc(sum ? sum.rankName : '')}</small><b>${esc(profile.name)}</b>${look.title ? `<em>${esc(look.title)}</em>` : ''}</div>
      <div class="rr-xpn">${sum ? '+<span data-xp>0</span>' : '—'}<small>XP</small></div>
      <div class="rr-rank"><span class="ins">${sum ? insigniaSvg(sum.rankBefore, sum.faction === 'soviet' ? 'soviet' : 'allies') : ''}</span>
        <div class="rr-bw"><div class="rn"><span data-rn>${esc(rankBefore || (sum?.rankName ?? 'Unranked battle'))}</span><small>${sum ? (sum.nextName ? `${fmt(sum.intoAfter)} / ${fmt(sum.spanAfter)}` : 'MAX') : ''}</small></div>
        <div class="rr-bar"><i style="width:${sum ? sum.fracBefore * 100 : 0}%"></i></div></div></div>
      <div class="rr-promo">${picto('chevrons')}<span>Promoted${promoted && sum ? ` · ${esc(sum.rankName)}` : ''}</span></div>
    </div>
    ${sum && sum.lines.length ? `<div class="rr-lines">${sum.lines.filter((l) => l.xp > 0).slice(0, 6).map((l) => `<div class="rr-line"><span>${esc(l.label)}</span><b>+${fmt(l.xp)}</b></div>`).join('')}</div>` : ''}`;
  // contracts
  const cts = sum?.contracts ?? [];
  const shown = cts.filter((c) => c.after > c.before || c.justDone);
  for (const c of cts) if (shown.length < 4 && !shown.includes(c) && c.cadence === 'daily') shown.push(c);
  const ctBox = el('div', 'rr-sec');
  ctBox.innerHTML = `<div class="rr-h">${picto('target')}<span>Contracts</span><i class="sp"></i>${sum?.commendations ? `<span class="cmd">+<span data-cmd>0</span> ${picto('medal')}</span>` : `<small>${fmt(profile.commendations)} Commendations</small>`}</div>
    <div class="rr-cts">${shown.length ? shown.slice(0, 4).map((c, i) => `<div class="rr-ct${c.after > c.before || c.justDone ? ' moved' : ''}${c.done && !c.justDone ? ' done' : ''}" data-ct="${i}">
      <span class="ic">${picto(c.done && !c.justDone ? 'untouchable' : c.picto)}</span><b>${esc(c.title)}<em>${c.cadence}</em></b><span class="v">${c.done && !c.justDone ? 'Complete' : ''}</span>
      <span class="tr"><s style="width:${((c.before / Math.max(1, c.target)) * 100).toFixed(1)}%"></s><u style="width:${((c.before / Math.max(1, c.target)) * 100).toFixed(1)}%"></u></span></div>`).join('')
      : `<div class="rr-none">${sum ? 'No contract progress this time. Today\'s orders are on the main menu.' : 'This battle does not count towards contracts.'}</div>`}</div>`;
  prog.appendChild(ctBox);
  // medals
  const medalIds = [...new Set(sum?.medalIds ?? [])]; // (a medal can climb two tiers in one battle: shown once, at its tier)
  if (medalIds.length) {
    const md = el('div', 'rr-sec');
    md.innerHTML = `<div class="rr-h">${picto('medal')}<span>Medals earned</span><i class="sp"></i><small>${medalIds.length}</small></div><div class="rr-medals">${medalIds.slice(0, 6).map((id) => {
      const a = ACH_BY_ID[id];
      if (!a) return '';
      const t = Math.max(0, (profile.medals[id]?.tier ?? 1) - 1);
      return `<span class="rr-medal" title="${esc(a.title)}">${medalSvg({ metal: achievementMetal(a, isTiered(a) ? t : 0), picto: a.picto, category: a.category })}<span>${esc(a.title)}</span></span>`;
    }).join('')}${medalIds.length > 6 ? `<span class="rr-medal">+${medalIds.length - 6}</span>` : ''}</div>`;
    prog.appendChild(md);
  }
  // next unlock / new unlocks
  const tz = el('div', 'rr-tease');
  const fresh = sum?.unlocks ?? [];
  const nextT = sum ? null : nextUnlock(ctx);
  if (fresh.length) {
    tz.classList.add('new');
    tz.innerHTML = `<span class="ic">${picto('lock')}</span><small>Unlocked</small><button class="rr-lk">Locker</button><b>${esc(fresh.slice(0, 3).map((u) => u.name).join(', '))}${fresh.length > 3 ? ` +${fresh.length - 3}` : ''}</b>`;
  } else if (sum?.teaser) {
    tz.innerHTML = `<span class="ic">${picto('lock')}</span><small>Next unlock</small><button class="rr-lk">Locker</button><b>${esc(sum.teaser.text)}</b><span class="tr"><i style="width:${(sum.teaser.before * 100).toFixed(1)}%"></i></span>`;
  } else if (!sum && nextT) {
    tz.innerHTML = `<span class="ic">${picto('lock')}</span><small>Next unlock</small><button class="rr-lk">Locker</button><b>${esc(nextT.text)}</b><span class="tr"><i style="width:${(nextT.status.frac * 100).toFixed(1)}%"></i></span>`;
  } else {
    tz.innerHTML = `<span class="ic">${picto('lock')}</span><small>Locker</small><button class="rr-lk">Locker</button><b>Every cosmetic earned. Impressive.</b>`;
  }
  (tz.querySelector('.rr-lk') as HTMLElement).onclick = () => showLocker({ audio: opts.audio, onBack: () => {} });
  prog.appendChild(tz);
  // ---------------------------------------------------------------- battle report
  const rep = el('section', 'rr-col panel rr-report');
  rep.innerHTML = `<div class="rr-h">${picto('chart')}<span>Battle report</span><i class="sp"></i><small>every ${10} s</small></div>`;
  rep.append(battleReport(game, opts.report), scoreboard(game), mvpAndHighlights(game, won, opts.report));
  grid.append(prog, rep);
  wrap.appendChild(grid);
  // ---------------------------------------------------------------- buttons
  const btns = el('div', 'btn-row end-btns rr-btns');
  const again = el('button', 'btn-primary rr-again', `${ICONS.restart}<span>Play again</span><kbd>Enter</kbd>`);
  again.title = 'Same settings, a fresh battlefield';
  again.onclick = () => { done(); opts.playAgain(); };
  btns.appendChild(again);
  if (opts.rematch) {
    const rm = el('button', 'btn', `${ICONS.dice}<span>Rematch</span>`);
    rm.title = 'The same battlefield and seed';
    rm.onclick = () => { done(); opts.rematch!(); };
    btns.appendChild(rm);
  }
  if (opts.watchReplay) {
    const rb = el('button', 'btn', `${ICONS.replay}<span>Watch replay</span>`);
    rb.onclick = () => { done(); opts.watchReplay!(); };
    btns.appendChild(rb);
  }
  const watch = el('button', 'btn', `${ICONS.eye}<span>Keep watching</span>`);
  watch.onclick = () => { done(); opts.keepWatching(); };
  const quit = el('button', 'btn', `${ICONS.exit}<span>Menu</span>`);
  quit.onclick = () => { done(); opts.menu(); };
  btns.append(watch, quit);
  wrap.appendChild(btns);
  s.appendChild(wrap);
  const codeEl = wrap.querySelector('.end-code') as HTMLElement | null;
  if (codeEl && code) { codeEl.title = 'Copy the map code'; codeEl.onclick = () => opts.copyCode?.(code, codeEl); }
  // "Make this a challenge" offers (src/modes/ui.ts) land before the buttons: keep them inside the report column
  const mo = new MutationObserver(() => {
    const box = wrap.querySelector(':scope > .mom-offers');
    if (box) rep.appendChild(box);
  });
  mo.observe(wrap, { childList: true });

  // ---------------------------------------------------------------- timeline
  const xpEl = prog.querySelector('[data-xp]') as HTMLElement | null;
  const cmdEl = prog.querySelector('[data-cmd]') as HTMLElement | null;
  const bar = prog.querySelector('.rr-bar i') as HTMLElement;
  const rankRow = prog.querySelector('.rr-rank') as HTMLElement;
  const promo = prog.querySelector('.rr-promo') as HTMLElement;
  const rows = [...prog.querySelectorAll<HTMLElement>('[data-ct]')];
  const medals = [...prog.querySelectorAll<HTMLElement>('.rr-medal')];
  const teaseBar = tz.querySelector('.tr i') as HTMLElement | null;
  const ctRows = shown.slice(0, 4);
  let promoDone = false;
  const popped = new Set<number>();
  const T_XP = 0.6, T_CT = 1.5;
  const end = sum ? T_CT + ctRows.length * 0.45 + 1.4 : 0.5;
  const t0 = performance.now();
  let raf = 0, finished = false;
  const frame = (t: number) => {
    if (sum) {
      if (xpEl) xpEl.textContent = fmt(sum.xp * ease((t - T_XP) / 1.3));
      if (promoted) {
        const a = clamp01((t - T_XP) / 0.8);
        if (t < T_XP + 0.8) bar.style.width = `${(sum.fracBefore + (1 - sum.fracBefore) * ease(a)) * 100}%`;
        else {
          if (!promoDone) {
            promoDone = true;
            (rankRow.querySelector('.ins') as HTMLElement).innerHTML = insigniaSvg(sum.rankAfter, sum.faction === 'soviet' ? 'soviet' : 'allies');
            (rankRow.querySelector('[data-rn]') as HTMLElement).textContent = nextLabel(sum.rankAfter);
            rankRow.classList.add('up');
            if (t < 1e6) { promo.classList.add('on'); try { opts.audio?.stinger('promotion'); } catch { /* audio off */ } }
          }
          bar.style.width = `${sum.fracAfter * 100 * ease((t - T_XP - 0.9) / 0.8)}%`;
        }
      } else {
        bar.style.width = `${(sum.fracBefore + (sum.fracAfter - sum.fracBefore) * ease((t - T_XP) / 1.2)) * 100}%`;
      }
      ctRows.forEach((c, i) => {
        const row = rows[i];
        if (!row) return;
        const k = ease((t - T_CT - i * 0.45) / 0.6);
        const v = c.before + (c.after - c.before) * k;
        const pct = `${((v / Math.max(1, c.target)) * 100).toFixed(1)}%`;
        (row.querySelector('.tr u') as HTMLElement).style.width = pct;
        const val = row.querySelector('.v') as HTMLElement;
        if (!(c.done && !c.justDone)) val.textContent = c.money ? `${money(v)} / ${money(c.target)}` : `${fmt(Math.floor(v))} / ${fmt(c.target)}`;
        if (c.justDone && k >= 1 && !popped.has(i)) {
          popped.add(i);
          row.classList.add('done', 'pop');
          (row.querySelector('.ic') as HTMLElement).innerHTML = picto('untouchable');
          val.textContent = `+${fmt(c.xp)} XP`;
          if (t < 1e6) { try { opts.audio?.play('ready_ping'); } catch { /* audio off */ } }
        }
      });
      if (cmdEl && sum.commendations) cmdEl.textContent = fmt(sum.commendations * ease((t - T_CT) / Math.max(0.6, ctRows.length * 0.45)));
      medals.forEach((m, i) => { if (t > T_CT + 0.3 + i * 0.15) m.classList.add('in'); });
      if (teaseBar && sum.teaser) teaseBar.style.width = `${(sum.teaser.before + (sum.teaser.frac - sum.teaser.before) * ease((t - end + 0.8) / 0.8)) * 100}%`;
    }
  };
  const tick = (now: number) => {
    if (!s.isConnected) return;
    const t = (now - t0) / 1000;
    frame(t);
    if (t < end + 0.2) raf = requestAnimationFrame(tick);
    else finish();
  };
  const finish = () => {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(raf);
    s.classList.add('rr-instant');
    frame(1e6);
    // keyboard / gamepad focus lands on "Play again" once the numbers have settled (Enter during them skips)
    try { if (s.isConnected && !document.querySelector('.rh-locker')) again.focus({ preventScroll: true }); } catch { /* ignore */ }
  };
  if (instant) finish(); else raf = requestAnimationFrame(tick);
  prog.addEventListener('click', (e) => { if (!(e.target as HTMLElement).closest('button')) finish(); });

  // ---------------------------------------------------------------- keyboard: Enter / Space skips, then plays again
  const onKey = (e: KeyboardEvent) => {
    if (!s.isConnected || s.classList.contains('leaving')) { done(); return; }
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (document.querySelector('.rh-locker, .pf, .rv')) return; // another screen on top (Locker...)
    const active = document.activeElement as HTMLElement | null;
    if (!finished) { e.preventDefault(); e.stopPropagation(); finish(); return; }
    if (active && active !== document.body && s.contains(active) && active.tagName === 'BUTTON') return; // the focused button handles it
    e.preventDefault();
    e.stopPropagation();
    again.click();
  };
  document.addEventListener('keydown', onKey, true);
  function done() {
    document.removeEventListener('keydown', onKey, true);
    mo.disconnect();
    cancelAnimationFrame(raf);
  }
}
