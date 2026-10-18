/**
 * The research tree (Commander economy, src/sim/economy.ts): opened from a Research Lab's selection panel or the
 * economy readout's tier badge. One row per research line (the faction's four, then the two shared ones), two
 * levels each, plus the tech-tier track at the top.
 *
 * Each node shows its state at a glance: researched, in progress (with the lab's progress), available (click to
 * start at the selected or first idle lab), not affordable yet, or locked (Level II needs Tier 3, already running at
 * another lab, no lab). The research that fits your doctrine is marked and costs 25% less. Mouse, touch (taps) and
 * the gamepad (D-pad focus reaches `#rsch button`); Esc or the close button shuts it. The game keeps running.
 */
import type { Building } from '../sim/entities';
import type { Player } from '../sim/player';
import type { Command } from '../sim/types';
import type { World } from '../sim/world';
import { LEVEL2_TIER, RESEARCH, SYNERGY, UPGRADES, researchFor } from '../sim/economy-data';
import { researchCost, researchIssue, taskSeconds } from '../sim/economy';
import { ICONS } from './icons';
import { el, esc, tipHtml, type Tooltip } from './dom';
import { tierName } from './economy';
import tRes from '../i18n/en/research';
import { currentLang, fmtMoney, fmtPct } from '../i18n/core';
import { researchBlurb, researchEffect, researchName, upgradeName } from '../i18n/names';

export interface ResearchHost {
  world: World;
  local: Player;
  issue(cmd: Command): void;
  sound(key: 'click' | 'error' | 'tab'): void;
  message(text: string, warn?: boolean): void;
  spectator?: boolean;
  /** The HUD tooltip, refreshed live while a node is hovered. */
  tip?: Tooltip;
}

const ROMAN = ['', 'I', 'II'];
const money = (n: number) => fmtMoney(n);

interface Node { id: string; level: 1 | 2; el: HTMLButtonElement; bar: HTMLElement; st: HTMLElement; key: string }

export class ResearchTree {
  readonly root: HTMLElement;
  private nodes: Node[] = [];
  private labsEl: HTMLElement;
  private tierEl: HTMLElement;
  private lab: Building | null = null;
  private headKey = '';
  private faction = '';
  private lang = '';

  constructor(private host: ResearchHost, parent: HTMLElement) {
    injectCss();
    const r = el('div', 'rsch panel');
    r.id = 'rsch';
    r.setAttribute('role', 'dialog');
    r.innerHTML = `<div class="rs-head"><span class="rs-ic">${ICONS.flag}</span><span class="rs-title"><small></small><b></b></span>
      <span class="rs-labs"></span><button type="button" class="rs-x">${ICONS.close}</button></div>
      <div class="rs-tiers"></div><div class="rs-grid"></div>
      <div class="rs-foot"></div>`;
    this.root = r;
    this.labsEl = r.querySelector('.rs-labs')!;
    this.tierEl = r.querySelector('.rs-tiers')!;
    r.querySelector<HTMLButtonElement>('.rs-x')!.onclick = () => { this.host.sound('click'); this.close(); };
    r.addEventListener('mousedown', (e) => { if ((e.target as HTMLElement).closest('button')) e.preventDefault(); });
    parent.appendChild(r);
    window.addEventListener('keydown', this.onKey, true);
  }

  get open(): boolean {
    return this.root.classList.contains('on');
  }

  dispose() {
    window.removeEventListener('keydown', this.onKey, true);
    this.root.remove();
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && this.open) { e.preventDefault(); e.stopImmediatePropagation(); this.close(); }
  };

  /** Open (at `lab`, if given) or close it if it is already open for that lab. */
  toggle(lab: Building | null) {
    if (this.open && (!lab || lab === this.lab)) { this.close(); return; }
    this.lab = lab;
    this.root.classList.add('on');
    this.host.sound('tab');
    this.headKey = '';
    this.update();
  }

  close() {
    this.root.classList.remove('on');
  }

  private build() {
    const grid = this.root.querySelector('.rs-grid')!;
    grid.innerHTML = '';
    this.nodes = [];
    this.faction = this.host.local.faction;
    this.lang = currentLang();
    this.headKey = '';
    const r0 = this.root;
    r0.setAttribute('aria-label', tRes('aria'));
    r0.querySelector('.rs-title small')!.textContent = tRes('kicker');
    r0.querySelector('.rs-title b')!.textContent = tRes('title');
    r0.querySelector('.rs-x')!.setAttribute('aria-label', tRes('close'));
    r0.querySelector('.rs-foot')!.textContent = tRes('foot', { n: LEVEL2_TIER });
    const doctrine = this.host.local.cmd?.doctrine ?? '';
    for (const r of researchFor(this.host.local.faction)) {
      const syn = SYNERGY[doctrine] === r.id;
      const row = el('div', 'rs-row' + (syn ? ' syn' : ''));
      row.innerHTML = `<div class="rs-line"><span class="rs-lic">${(ICONS as Record<string, string>)[r.icon] ?? ICONS.star}</span><span class="rs-lt"><b>${esc(researchName(r))}</b>
        <small>${tRes.html(`branch.${r.branch}`)}${r.factions.length > 1 ? ` · ${tRes.html('shared')}` : ''}</small></span>${syn ? `<span class="rs-syn" title="${esc(tRes('synergyTip'))}">${tRes.html('synergy')}</span>` : ''}</div>`;
      for (const level of [1, 2] as const) {
        const b = el('button', 'rs-node', `<span class="rn-l">${ROMAN[level]}</span><span class="rn-fx">${esc(researchEffect(r, level))}</span>
          <span class="rn-meta"></span><span class="rn-bar"><i></i></span><span class="rn-st"></span>`);
        b.type = 'button';
        b.dataset.tech = r.id;
        b.dataset.level = String(level);
        b.setAttribute('aria-label', tRes('node', { name: researchName(r), level: ROMAN[level] }));
        b.onclick = () => this.click(r.id, level);
        row.appendChild(b);
        this.nodes.push({ id: r.id, level, el: b, bar: b.querySelector('.rn-bar i')!, st: b.querySelector('.rn-st')!, key: '' });
      }
      grid.appendChild(row);
    }
  }

  private labs(): Building[] {
    const { world, local } = this.host;
    return world.buildings.filter((b) => b.alive && b.owner === local && b.bt.id === 'rlab' && b.buildAnim >= 1);
  }

  /** Where a new project goes: the lab it was opened at if idle, else the first idle lab. */
  private targetLab(): Building | null {
    const labs = this.labs().filter((b) => b.active && !b.task);
    if (this.lab && labs.includes(this.lab)) return this.lab;
    return labs[0] ?? null;
  }

  private running(id: string): Building | null {
    return this.labs().find((b) => b.task?.kind === 'research' && b.task.id === id) ?? null;
  }

  private click(id: string, level: 1 | 2) {
    const { world, local } = this.host;
    if (this.host.spectator) return;
    const lv = local.econ?.levels[id] ?? 0;
    const run = this.running(id);
    if (run && run.task!.level === level) {
      this.host.sound('click');
      this.host.issue({ c: 'research', player: local.id, building: run.id, tech: id, cancel: true });
      return;
    }
    if (lv >= level) { this.host.sound('error'); return; }
    if (level > lv + 1) { this.host.sound('error'); this.host.message(tRes('msg.needsLevel', { name: researchName(RESEARCH[id]), level: ROMAN[level], prev: ROMAN[lv + 1] }), true); return; }
    const lab = this.targetLab();
    if (!lab) {
      this.host.sound('error');
      this.host.message(tRes(this.labs().length ? 'msg.labsBusy' : 'msg.buildLab'), true);
      return;
    }
    const issue = researchIssue(world, local, lab, id);
    if (issue) {
      this.host.sound('error');
      this.host.message(issue === 'tier' ? tRes('msg.tier', { n: LEVEL2_TIER }) : tRes(issue === 'researching' ? 'msg.researching' : 'msg.unavailable'), true);
      return;
    }
    this.host.sound('click');
    this.host.issue({ c: 'research', player: local.id, building: lab.id, tech: id });
  }

  /** Refresh (the HUD calls it ~8 times a second while the panel is open). */
  update() {
    if (!this.open) return;
    const { world, local } = this.host;
    if (!world.econ) { this.close(); return; }
    if (this.faction !== local.faction || !this.nodes.length || this.lang !== currentLang()) this.build();
    if (this.lab && !this.lab.alive) this.lab = null;
    const e = local.econ!;
    const labs = this.labs();
    const idle = labs.filter((b) => !b.task).length;
    const head = `${labs.length}|${idle}|${e.tier}`;
    if (head !== this.headKey) {
      this.headKey = head;
      this.labsEl.innerHTML = labs.length ? tRes.html('labs', { n: labs.length, idle }) : `<span class="rs-bad">${tRes.html('noLab')}</span>`;
      const next = e.tier < 3 ? UPGRADES[e.tier === 1 ? 'cy_t2' : 'cy_t3'] : null;
      this.tierEl.innerHTML = [1, 2, 3].map((t) => `<span class="rt${t <= e.tier ? ' on' : ''}${t === e.tier ? ' cur' : ''}"><b>${tRes.html('tierShort', { n: t })}</b><small>${esc(tierName(t))}</small></span>`).join('<i></i>') +
        `<span class="rt-next">${next ? tRes.html('next', { name: upgradeName(next), cost: money(next.cost) }) : tRes.html('topTier')}</span>`;
    }
    const lab = this.targetLab();
    for (const n of this.nodes) {
      const lv = e.levels[n.id] ?? 0;
      const run = this.running(n.id);
      const active = !!run && run.task!.level === n.level;
      const cost = researchCost(local, n.id, n.level);
      let st: string;
      let why = '';
      if (lv >= n.level) st = 'done';
      else if (active) st = 'build';
      else if (n.level > lv + 1) { st = 'locked'; why = tRes('why.needsLevel', { level: ROMAN[n.level - 1] }); }
      else if (n.level === 2 && e.tier < LEVEL2_TIER) { st = 'locked'; why = tRes('why.tier', { n: LEVEL2_TIER }); }
      else if (run) { st = 'locked'; why = tRes('why.researching'); }
      else if (!labs.length) { st = 'locked'; why = tRes('why.buildLab'); }
      else if (!lab) { st = 'wait'; why = tRes('why.labsBusy'); }
      else st = local.credits < cost ? 'poor' : 'ready';
      const pct = active ? Math.floor(run!.task!.progress * 100) : st === 'done' ? 100 : 0;
      const key = `${st}|${pct}|${cost}|${why}`;
      if (key === n.key) continue;
      n.key = key;
      n.el.dataset.state = st;
      n.bar.style.width = `${pct}%`;
      const secs = Math.ceil(taskSeconds(local, RESEARCH[n.id].levels[n.level - 1].time));
      (n.el.querySelector('.rn-meta') as HTMLElement).innerHTML = st === 'done' ? `<span class="rn-ok">${tRes.html('state.done')}</span>`
        : st === 'build' ? `<b>${fmtPct(pct / 100)}</b> <small>${tRes.html('state.cancel')}</small>` : `${money(cost)} · ${tRes.html('state.secsShort', { s: secs })}${why ? ` · <span class="rn-why">${esc(why)}</span>` : ''}`;
      n.st.innerHTML = st === 'done' ? ICONS.check : st === 'locked' ? ICONS.lock : '';
      const r = RESEARCH[n.id];
      n.el.dataset.tip = tipHtml(tRes.html('node', { name: researchName(r), level: ROMAN[n.level] }), `${esc(researchEffect(r, n.level))}<br><i>${esc(researchBlurb(r))}</i><br>${money(cost)} · ${tRes.html('state.secs', { s: secs })}${why ? `<br><span class="tt-bad">${esc(why)}</span>` : ''}`);
      this.host.tip?.refresh(n.el, n.el.dataset.tip);
    }
  }
}

function injectCss() {
  if (document.getElementById('rsch-style')) return;
  const st = document.createElement('style');
  st.id = 'rsch-style';
  st.textContent = CSS;
  document.head.appendChild(st);
}

const CSS = `
#rsch { position: absolute; z-index: 6; left: 50%; top: 46%; transform: translate(-50%, -50%) scale(0.97); width: min(46rem, calc(100vw - 2rem)); max-height: calc(100vh - 6rem);
  display: none; flex-direction: column; gap: 0.5rem; padding: 0.75rem 0.85rem 0.6rem; border-radius: 0.85rem; background: var(--glass); border: 1px solid var(--line-2);
  box-shadow: 0 1rem 3rem rgba(0, 0, 0, 0.6); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); font-family: var(--font); color: var(--text); opacity: 0; }
#rsch.on { display: flex; animation: rsIn 0.28s var(--ease) forwards; }
@keyframes rsIn { to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
.rs-head { display: flex; align-items: center; gap: 0.6rem; }
.rs-ic { width: 2rem; height: 2rem; border-radius: 0.5rem; display: grid; place-items: center; font-size: 1.15rem; color: var(--accent-hi);
  background: radial-gradient(circle at 50% 30%, rgba(var(--accent-rgb), 0.35), rgba(var(--accent-rgb), 0.08)); border: 1px solid rgba(var(--accent-rgb), 0.45); }
.rs-title { display: flex; flex-direction: column; line-height: 1; flex: 1; }
.rs-title small { font-size: 0.58rem; letter-spacing: 0.22em; text-transform: uppercase; color: var(--muted); font-weight: 700; }
.rs-title b { font-size: 1.15rem; letter-spacing: 0.08em; text-transform: uppercase; margin-top: 0.15rem; }
.rs-labs { font-size: 0.78rem; color: var(--text-2); }
.rs-labs b { font-family: var(--mono); font-weight: 400; color: var(--text); }
.rs-bad { color: #ff8a7a; }
.rs-x { all: unset; cursor: pointer; width: 1.8rem; height: 1.8rem; display: grid; place-items: center; border-radius: 0.4rem; color: var(--muted); border: 1px solid var(--line); }
.rs-x:hover, .rs-x.gp-focus { color: var(--text); border-color: var(--accent); }
.rs-tiers { display: flex; align-items: center; gap: 0.3rem; padding: 0.35rem 0.5rem; border-radius: 0.5rem; background: rgba(255, 255, 255, 0.03); border: 1px solid var(--line); }
.rs-tiers .rt { display: inline-flex; flex-direction: column; align-items: center; padding: 0.15rem 0.6rem; border-radius: 0.35rem; border: 1px solid var(--line); color: var(--dim); line-height: 1.05; }
.rs-tiers .rt b { font-family: var(--mono); font-weight: 400; font-size: 0.95rem; }
.rs-tiers .rt small { font-size: 0.52rem; letter-spacing: 0.16em; text-transform: uppercase; }
.rs-tiers .rt.on { color: var(--gold); border-color: rgba(var(--gold-rgb), 0.5); background: rgba(var(--gold-rgb), 0.07); }
.rs-tiers .rt.cur { box-shadow: 0 0 0.8rem rgba(var(--gold-rgb), 0.35); }
.rs-tiers > i { width: 1.4rem; height: 2px; background: var(--line-2); }
.rt-next { margin-left: auto; font-size: 0.72rem; color: var(--text-2); }
.rs-grid { display: flex; flex-direction: column; gap: 0.32rem; overflow-y: auto; }
.rs-row { display: grid; grid-template-columns: 11.5rem 1fr 1fr; gap: 0.35rem; align-items: stretch; }
.rs-line { display: flex; align-items: center; gap: 0.45rem; position: relative; padding-right: 0.3rem; }
.rs-lic { width: 1.8rem; height: 1.8rem; flex: 0 0 1.8rem; border-radius: 0.4rem; display: grid; place-items: center; color: var(--accent); background: rgba(var(--accent-rgb), 0.1); border: 1px solid rgba(var(--accent-rgb), 0.3); }
.rs-lt { display: flex; flex-direction: column; line-height: 1.1; min-width: 0; }
.rs-lt b { font-size: 0.86rem; letter-spacing: 0.03em; }
.rs-lt small { font-size: 0.6rem; color: var(--muted); letter-spacing: 0.1em; text-transform: uppercase; }
.rs-syn { position: absolute; right: 0.2rem; bottom: -0.15rem; font-size: 0.52rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ok); }
.rs-row.syn .rs-lic { color: var(--ok); border-color: rgba(var(--ok-rgb), 0.45); background: rgba(var(--ok-rgb), 0.1); }
.rs-node { all: unset; box-sizing: border-box; position: relative; display: grid; grid-template-columns: auto 1fr; grid-template-rows: auto auto; column-gap: 0.45rem; row-gap: 0.1rem;
  padding: 0.35rem 1.4rem 0.45rem 0.45rem; border-radius: 0.45rem; cursor: pointer; background: rgba(255, 255, 255, 0.035); border: 1px solid var(--line-2); overflow: hidden;
  transition: border-color 0.2s, box-shadow 0.2s, transform 0.15s var(--ease); }
.rs-node:hover, .rs-node.gp-focus { border-color: var(--accent); box-shadow: 0 0 0.7rem rgba(var(--accent-rgb), 0.35); transform: translateY(-1px); }
.rs-node:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.rn-l { grid-row: span 2; align-self: center; width: 1.6rem; height: 1.6rem; display: grid; place-items: center; border-radius: 50%; font-family: var(--mono); font-size: 0.8rem;
  color: var(--accent-hi); border: 1px solid rgba(var(--accent-rgb), 0.5); background: rgba(var(--accent-rgb), 0.12); }
.rn-fx { font-size: 0.74rem; color: var(--text); line-height: 1.2; }
.rn-meta { font-size: 0.64rem; color: var(--gold); font-family: var(--mono); }
.rn-meta small { font-family: var(--font); color: var(--muted); }
.rn-why { color: var(--muted); font-family: var(--font); }
.rn-ok { color: var(--ok); font-family: var(--font); letter-spacing: 0.08em; text-transform: uppercase; }
.rn-bar { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: rgba(255, 255, 255, 0.05); }
.rn-bar i { display: block; height: 100%; width: 0; background: linear-gradient(90deg, rgba(var(--gold-rgb), 0.5), var(--gold)); transition: width 0.3s linear; }
.rn-st { position: absolute; top: 0.3rem; right: 0.35rem; font-size: 0.8rem; display: flex; color: var(--muted); }
.rs-node[data-state="done"] { border-color: rgba(var(--ok-rgb), 0.5); background: linear-gradient(180deg, rgba(var(--ok-rgb), 0.12), rgba(var(--ok-rgb), 0.03)); cursor: default; }
.rs-node[data-state="done"] .rn-l { color: var(--ok); border-color: rgba(var(--ok-rgb), 0.6); background: rgba(var(--ok-rgb), 0.15); }
.rs-node[data-state="done"] .rn-st { color: var(--ok); }
.rs-node[data-state="done"] .rn-bar i { background: var(--ok); }
.rs-node[data-state="build"] { border-color: rgba(var(--gold-rgb), 0.7); animation: rsPulse 1.6s ease-in-out infinite; }
.rs-node[data-state="locked"], .rs-node[data-state="wait"] { opacity: 0.55; }
.rs-node[data-state="locked"] .rn-l { color: var(--dim); border-color: var(--line-2); background: none; }
.rs-node[data-state="poor"] .rn-meta { color: #ff8a7a; }
@keyframes rsPulse { 50% { box-shadow: 0 0 0.9rem rgba(var(--gold-rgb), 0.4); } }
.rs-foot { font-size: 0.64rem; color: var(--muted); letter-spacing: 0.04em; text-align: center; }
@media (max-width: 900px) { .rs-row { grid-template-columns: 1fr 1fr; } .rs-line { grid-column: span 2; } }
@media (prefers-reduced-motion: reduce) { #rsch.on { animation: none; opacity: 1; transform: translate(-50%, -50%); } .rs-node[data-state="build"] { animation: none; } }
`;
