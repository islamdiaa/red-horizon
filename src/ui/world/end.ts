/**
 * World Conquest results: the report after an RTS battle (shown over the paused battle), and the endings
 * ("You rule the world" / "Your empire has fallen") with the score, medals, XP and the share and replay buttons.
 */
import type { World } from '../../sim/world';
import type { ConquestSetup } from '../../conquest/battle';
import { battleOutcome } from '../../conquest/battle';
import type { WorldReport, WorldRun } from '../../conquest/world/state';
import { deleteSave, readSave } from '../../sim/save';
import { focusTrap } from '../a11y';
import { rankBadge } from '../icons';
import { callSignName } from '../../i18n/en/codenames';
import { typeName } from '../../i18n/names';
import { UNITS } from '../../data/rules';
import { fmtMoney, tx } from '../../i18n/core';
import { picto } from '../../meta/art';
import type { View, WorldApp } from './app';
import { WorldStore } from './store';
import { injectCss } from './css';
import { W, ensureApi, type EndSummary } from './api';
import { cardName, cardIcon, esc, fmtInt, homelandName, territoryName, tW } from './view';
import { medalName } from './drawers';
import { startBars, startRating } from './start';

// ---------------------------------------------------------------------------------------------------
// After a battle (main.ts routes world battles here)
// ---------------------------------------------------------------------------------------------------
export async function showWorldAfterBattle(world: World, setup: ConquestSetup, opts: { play(k: 'click' | 'tab'): void; onContinue(): void; onMenu(): void }) {
  injectCss();
  await ensureApi();
  const run = safe(() => W.loadWorldRun(), null);
  const outcome = battleOutcome(world, setup.battle);
  let rep: WorldReport | null = null;
  if (run && run.id === setup.runId && run.pending?.spec.id === setup.battle.id) {
    rep = safe(() => W.applyBattle(run, outcome), null);
    if (rep) { new WorldStore(false).save(run); clearBattleSaves(setup.battle.id); }
  }
  document.body.classList.toggle('faction-soviet', setup.battle.faction === 'soviet');
  const host = document.createElement('div');
  host.className = 'wc-modal';
  document.body.appendChild(host);
  const ok = !!rep;
  const close = () => { untrap(); host.remove(); window.removeEventListener('keydown', onKey); };
  const go = () => { opts.play('click'); close(); ok ? opts.onContinue() : opts.onMenu(); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); go(); } };
  window.addEventListener('keydown', onKey);
  host.innerHTML = `<div class="wc-panel wc-dlg" role="dialog" aria-modal="true">${rep && run ? reportHtml(run, rep) : `<div class="wc-end lose"><div class="wc-kick">${esc(tW('kick'))}</div><h1>${esc(tW(outcome.won ? 'report.victory' : 'report.defeat'))}</h1><p class="wc-p">${esc(tW('report.orphan'))}</p></div>`}
    <div class="acts"><button class="wc-btn pri" data-go>${picto('globe')}${esc(ok ? tW('report.continue') : tW('end.menu'))}</button></div></div>`;
  const untrap = focusTrap(host, { initial: host.querySelector<HTMLElement>('[data-go]') ?? undefined, restore: false });
  host.querySelector<HTMLElement>('[data-go]')!.onclick = go;
}

function reportHtml(run: WorldRun, r: WorldReport): string {
  const title = tW(r.won ? 'report.victory' : 'report.defeat');
  const sub = r.action === 'defend' ? tW(r.won ? 'report.held' : 'report.lost', { territory: territoryName(r.to) }) : tW(r.captured ? 'report.captured' : 'report.failed', { territory: territoryName(r.to) });
  const rows: [string, string][] = [
    [tW('report.losses'), `${tW('attack.lossYou', { n: fmtInt(r.attLoss) })} · ${tW('attack.lossThem', { n: fmtInt(r.defLoss) })}`],
  ];
  if (r.captured) rows.push([tW('report.moved'), fmtInt(r.moved)]);
  if (r.warChest) rows.push([tW('report.warChest'), `+${fmtMoney(r.warChest)}`]);
  if (r.rp) rows.push([tW('report.rp'), `+${r.rp}`]);
  if (r.score) rows.push([tW('report.score'), `+${fmtInt(r.score)}`]);
  const vets = r.veterans.map((v) => `<span class="wc-chip ${v.fate === 'lost' ? 'red' : v.fate === 'promoted' || v.fate === 'recruit' ? 'green' : ''}">${rankBadge(v.rank)}${esc(callSignName(v.name))} · ${esc(UNITS[v.type] ? typeName(UNITS[v.type]) : v.type)} · ${esc(tW(`report.fate.${v.fate}`))}</span>`).join(' ');
  return `<div class="wc-end ${r.won ? '' : 'lose'}"><div class="wc-kick">${esc(tW('kick'))} · ${esc(tW('top.turn', { n: run.turn }))}</div><h1>${esc(title)}</h1><h3>${esc(sub)}</h3></div>
    <div class="wc-lines" style="max-width:520px;margin:0 auto">${rows.map(([l, v]) => `<div class="wc-line"><span>${esc(l)}</span><b>${esc(v)}</b></div>`).join('')}</div>
    ${r.card ? `<div style="display:flex;justify-content:center;margin:12px 0"><div class="wc-card ${r.card} on" style="cursor:default">${cardIcon(r.card)}<span>${esc(tW('report.card'))}: ${esc(cardName(r.card))}</span></div></div>` : ''}
    ${vets ? `<div class="wc-h4" style="text-align:center">${esc(tW('report.veterans'))}</div><div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center">${vets}</div>` : ''}`;
}

function clearBattleSaves(battleId: string) {
  for (const slot of ['conquest', 'auto', 'manual']) {
    const s = readSave(slot);
    if (s?.game?.setup?.conquest?.battle?.id === battleId) deleteSave(slot);
  }
}

// ---------------------------------------------------------------------------------------------------
// Endings
// ---------------------------------------------------------------------------------------------------
const RECORDED = 'rh.world.recorded';

export function showEnd(app: WorldApp) {
  app.setView(new EndView(app));
}

class EndView implements View {
  private el: HTMLElement;
  private sum: EndSummary | null = null;

  constructor(private app: WorldApp) {
    const run = app.run!;
    // the result is recorded once per run (profile XP, medals, the Weekly World best)
    // (a demo store records nothing: test screens never grant XP or medals)
    const store = app.store;
    if (store.get(RECORDED) !== run.id) {
      this.sum = store.recordEnd(run);
      if (run.status === 'won') app.opts.play('milestone');
      store.set(RECORDED, run.id);
      store.set(`${RECORDED}.sum`, JSON.stringify(this.sum));
    } else {
      try { this.sum = JSON.parse(store.get(`${RECORDED}.sum`) ?? 'null'); } catch { /* */ }
    }
    store.badge(run);
    app.useSites(run);
    app.paint(run);
    app.globe.setArrows([]);
    app.globe.setMarks({});
    const mine = run.territories.filter((t) => t.owner === run.player).map((t) => app.siteOf(t.id));
    app.globe.frameSites(mine.length ? mine : run.territories.map((t) => app.siteOf(t.id)));
    this.el = document.createElement('div');
    this.el.className = 'wc-modal';
    this.el.style.background = 'rgba(0,0,0,0.35)';
    app.root.appendChild(this.el); // (inside the screen's focus trap)
    this.render();
  }

  destroy() { this.el.remove(); }

  onKey(e: KeyboardEvent): boolean {
    if (e.key === 'Escape') { this.app.back(); return true; }
    return false;
  }

  private render() {
    const run = this.app.run!, won = run.status === 'won';
    const score = safe(() => W.worldScore(run), null);
    const sum = this.sum;
    const head = won ? tW(run.size === 'blitz' ? 'end.wonBlitz' : 'end.won') : tW('end.lost');
    const sub = tW(won ? 'end.wonSub' : 'end.lostSub', { home: homelandName(run.home), n: run.turn });
    const medals = sum?.medals ?? [];
    this.el.innerHTML = `<div class="wc-panel wc-dlg" role="dialog" aria-modal="true" aria-label="${esc(head)}">
      <div class="wc-end wc-end-grid ${won ? '' : 'lose'}"><div class="ea"><div class="wc-kick">${esc(tW('kick'))}</div><h1>${esc(head)}</h1><h3>${esc(sub)}</h3>
        ${run.ending ? `<p class="wc-small" style="margin:-4px 0 8px">${esc(tx(`world.event.${won ? 'won' : 'lost'}`, { ending: tx(`world.ending.${run.ending}`, undefined, run.ending) }))}</p>` : ''}
        ${score ? `<div class="wc-small">${esc(tW('end.score'))}</div><div class="tot">${fmtInt(score.total)}</div>` : ''}
        ${sum?.xp ? `<div class="wc-chip gold">${picto('chevrons')}${esc(tW('end.xp', { n: fmtInt(sum.xp) }))}</div>` : ''}
        ${sum?.weeklyBest ? `<div class="wc-chip gold">${picto('trophy')}${esc(tW('end.weeklyBest'))}</div>` : ''}
        ${startRating(run.home, run.size) === 'hard' ? `<div class="wc-chip red">${startBars('hard')}${esc(tW('start.hard'))}</div>` : ''}</div>
        <div class="eb">${score ? `<div class="wc-lines">${score.lines.map((l) => `<div class="wc-line"><span>${esc(tx(`world.score.${l.key}`, undefined, l.key))}</span><b>${fmtInt(l.value)}</b></div>`).join('')}
          ${score.multiplier !== 1 ? `<div class="wc-line"><span>${esc(tW('end.multiplier', { n: score.multiplier }))}</span><b>×${score.multiplier}</b></div>` : ''}</div>` : ''}
        ${medals.length ? `<div class="wc-h4">${esc(tW('end.medals'))}</div><div class="wc-medals">${medals.map((m) => `<span class="wc-chip gold">${picto('medal')}${esc(medalName(m))}</span>`).join('')}</div>` : ''}</div>
      </div>
      <div class="acts" style="justify-content:center">
        <button class="wc-btn gold pri" data-e="share" data-focus>${picto('globe')}${esc(tW('end.share'))}</button>
        <button class="wc-btn" data-e="again">${esc(tW('end.again'))}</button>
        <button class="wc-btn" data-e="new">${esc(tW('end.newRun'))}</button>
        <button class="wc-btn" data-e="menu">${esc(tW('end.menu'))}</button>
      </div></div>`;
    const on = (k: string, fn: () => void) => { this.el.querySelector<HTMLElement>(`[data-e="${k}"]`)!.onclick = () => { this.app.opts.play('click'); fn(); }; };
    on('share', () => void import('./share').then((s) => s.openShare(this.app)));
    on('again', () => {
      const r = this.app.run!;
      this.app.run = W.newWorldRun({ seed: r.seed, home: r.home, size: r.size, difficulty: r.difficulty, faction: r.faction, ironman: r.ironman, nonce: Date.now() });
      this.app.save();
      this.app.nav.turn({ fresh: true });
    });
    on('new', () => { this.app.store.clear(); this.app.run = null; this.app.nav.setup(); });
    on('menu', () => this.app.back());
    this.el.querySelector<HTMLElement>('[data-focus]')?.focus({ preventScroll: true });
  }
}

function safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch (e) { console.warn(e); return fallback; }
}
