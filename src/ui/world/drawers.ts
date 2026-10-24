/**
 * World Conquest dialogs: the cards tray (set trading), the rivals panel (troops, territories, cards, personality,
 * relation, ceasefire offers), the war diary, the campaign menu and the rules summary.
 */
import type { LoggedEvent, WorldEvent, WorldRun } from '../../conquest/world/state';
import type { CardKind } from '../../conquest/world/types';
import { tx } from '../../i18n/core';
import { picto } from '../../meta/art';
import type { WorldApp } from './app';
import { W } from './api';
import { cardIcon, cardName, commanderName, continentName, diffName, homelandName, persDesc, persName, sizeName, esc, fmtInt, hex, pct, powerColor, powerName, territoryName, tW, zoneName, landmarkName } from './view';

// ---------------------------------------------------------------------------------------------------
// Diary lines: STRAT's templates (world.event.<kind>), every event field passed as a param of the same name
// (territory ids as names, power ids as names)
// ---------------------------------------------------------------------------------------------------
// (world.ts names its parameters: the event's `to` is {territory}, `with` is {other}; booleans are a yes/other select)
const RENAME: Record<string, string> = { to: 'territory', with: 'other' };
const POWER_KEYS = new Set(['power', 'with', 'by', 'defender', 'prev']);
export function eventParams(run: WorldRun, e: WorldEvent): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(e)) {
    if (k === 'kind' || k === 'dice') continue;
    const name = RENAME[k] ?? k;
    if ((k === 'from' || k === 'to') && typeof v === 'string') out[name] = territoryName(v);
    else if (POWER_KEYS.has(k) && typeof v === 'number') out[name] = v === run.player ? tx('world.regime.player') : powerName(run, v); // ("Your Command attacks", not "You attacks")
    else if (k === 'zone' && typeof v === 'string') out[name] = zoneName(v);
    else if (k === 'card' && typeof v === 'string') out[name] = cardName(v);
    else if (k === 'cards' && Array.isArray(v)) out[name] = (v as CardKind[]).map(cardName).join(', ');
    else if (k === 'medal' && typeof v === 'string') out[name] = medalName(v, run);
    else if (k === 'ending' && typeof v === 'string') out[name] = tx(`world.ending.${v}`, undefined, v);
    else if (typeof v === 'boolean') out[name] = v ? 'yes' : 'other';
    else if (typeof v === 'number' || typeof v === 'string') out[name] = v;
  }
  return out;
}
export function eventLine(run: WorldRun, e: WorldEvent): string {
  const p = eventParams(run, e);
  return tx(`world.event.${e.kind}`, p, Object.values(p).join(' · '));
}
/** A medal id ("continent:europe", "wonder:pyramids", "victory:blitz:hard"...) as text (world.ts medal.*). */
export function medalName(id: string, run?: WorldRun | null): string {
  const [raw, a = '', b = ''] = id.split(':');
  const kind = raw === 'dice-only' ? 'diceOnly' : raw;
  const name = kind === 'continent' ? continentName(a) : kind === 'wonder' ? landmarkName(a) : kind === 'homeland' ? homelandName(a) : a;
  const sized = kind === 'victory' || kind === 'ironman';
  return tx(`world.medal.${kind}`, { name, size: sized && a ? sizeName(a) : '', difficulty: sized && b ? diffName(b) : '' }, id);
}

// ---------------------------------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------------------------------
export function openCards(app: WorldApp, after: () => void) {
  const run = app.run!;
  const picked = new Set<number>();
  const best = safe(() => W.bestSet(run), null);
  if (best) best.forEach((i) => picked.add(i));
  const m = app.modal('', 'narrow', after);
  const draw = () => {
    const cards = run.powers[run.player].cards;
    const sel = [...picked].map((i) => cards[i]);
    const isSet = sel.length === 3 && (new Set(sel).size === 1 || new Set(sel).size === 3);
    const val = safe(() => W.setValue(run), 0);
    const canTrade = run.phase === 'reinforce' && run.current === run.player;
    m.dlg.innerHTML = `<div class="wc-kick">${esc(tW('top.cards'))}</div><h2 class="wc-h1">${esc(tW('cards.title'))}</h2>
      <p class="wc-small">${esc(tW('cards.intro'))}</p>
      ${safe(() => W.mustTrade(run), false) ? `<div class="wc-warn">${esc(tW('cards.must'))}</div>` : ''}
      <div class="wc-cards" role="group" aria-label="${esc(tW('cards.title'))}">${cards.length ? cards.map((c, i) => `<button class="wc-card ${c} ${picked.has(i) ? 'on' : ''}" data-card="${i}" aria-pressed="${picked.has(i)}">${cardIcon(c)}<span>${esc(cardName(c))}</span></button>`).join('') : `<p class="wc-p">${esc(tW('cards.none'))}</p>`}</div>
      <div class="wc-small">${esc(tW('cards.next', { n: val }))}</div>
      ${picked.size && !isSet ? `<div class="wc-small" style="color:#ffcf8a">${esc(tW('cards.notSet'))}</div>` : ''}
      <div class="acts">${best ? `<button class="wc-btn" data-best>${esc(tW('cards.best'))}</button>` : ''}<button class="wc-btn gold pri" data-trade data-focus ${isSet && canTrade ? '' : 'disabled'}>${picto('medal')}${esc(tW('cards.trade', { n: val }))}</button></div>
      <button class="wc-x" data-close aria-label="${esc(tW('setup.back'))}">×</button>`;
    m.dlg.querySelector<HTMLElement>('[data-close]')!.onclick = () => m.close();
    m.dlg.querySelectorAll<HTMLElement>('[data-card]').forEach((b) => (b.onclick = () => {
      const i = +b.dataset.card!;
      if (picked.has(i)) picked.delete(i); else if (picked.size < 3) picked.add(i);
      app.opts.play('tab');
      draw();
      m.dlg.querySelector<HTMLElement>(`[data-card="${i}"]`)?.focus();
    }));
    m.dlg.querySelector<HTMLElement>('[data-best]')?.addEventListener('click', () => { picked.clear(); (safe(() => W.bestSet(run), null) ?? []).forEach((i) => picked.add(i)); draw(); });
    m.dlg.querySelector<HTMLElement>('[data-trade]')!.onclick = () => {
      const n = safe(() => W.tradeCards(run, [...picked].sort((a, b) => a - b)), 0);
      if (!n) return;
      app.opts.play('click');
      app.save();
      app.toast(`+${n}`, 'gold');
      m.close();
    };
  };
  draw();
}

// ---------------------------------------------------------------------------------------------------
// Rivals
// ---------------------------------------------------------------------------------------------------
export function openRivals(app: WorldApp, after: () => void) {
  const run = app.run!;
  const m = app.modal('', 'wide', after);
  const draw = () => {
    const rows = run.powers.map((p) => {
      const owned = run.territories.filter((t) => t.owner === p.id);
      const troops = owned.reduce((a, t) => a + t.troops, 0);
      const me = p.id === run.player;
      const cease = !me && p.ceasefire >= run.turn ? p.ceasefire - run.turn + 1 : 0;
      const distrust = !me && p.distrust >= run.turn;
      const rel = me ? '' : !p.alive ? `<span class="wc-chip">${esc(tW('rivals.eliminated'))}</span>` : cease ? `<span class="wc-chip green">${esc(tW('rivals.ceasefire', { n: cease }))}</span>` : `<span class="wc-chip red">${esc(tW('rivals.war'))}</span>${distrust ? ` <span class="wc-chip">${esc(tW('rivals.distrust'))}</span>` : ''}`;
      const chance = !me && p.alive && !cease ? safe(() => W.ceasefireChance(run, p.id), -1) : -1;
      const pers = p.personality;
      return `<div class="wc-rival" style="--pc:${hex(powerColor(run, p.id))}">
        <div class="wc-pw ${p.alive ? '' : 'dead'}"><span class="wc-sw" style="background:${hex(powerColor(run, p.id))}"></span><div><b>${esc(powerName(run, p.id))}</b><small>${esc(me ? homelandName(run.home) : [commanderName(p), persName(pers), territoryName(p.capital)].filter(Boolean).join(' · '))}</small></div></div>
        <div class="nums"><span><small>${esc(tW('rivals.troops'))}</small>${fmtInt(troops)}</span><span><small>${esc(tW('rivals.territories'))}</small>${owned.length}</span><span><small>${esc(tW('rivals.cards'))}</small>${p.cards.length}</span></div>
        ${me ? '' : `<div class="rel"><span class="wc-small">${esc(persDesc(pers))}</span><span style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">${rel}${chance >= 0 ? `<button class="wc-btn sm" data-offer="${p.id}">${esc(tW('rivals.offer'))} · ${esc(tW('rivals.chance', { pct: pct(chance) }))}</button>` : ''}</span></div>`}
      </div>`;
    }).join('');
    m.dlg.innerHTML = `<div class="wc-kick">${esc(tW('top.rivals'))}</div><h2 class="wc-h1">${esc(tW('rivals.title'))}</h2><div class="wc-rivals">${rows}</div>
      <button class="wc-x" data-close aria-label="${esc(tW('setup.back'))}">×</button>`;
    m.dlg.querySelector<HTMLElement>('[data-close]')!.onclick = () => m.close();
    m.dlg.querySelectorAll<HTMLElement>('[data-offer]').forEach((b) => (b.onclick = () => {
      const id = +b.dataset.offer!;
      const r = safe(() => W.offerCeasefire(run, id), null);
      if (!r) return;
      app.opts.play('click');
      app.save();
      const why = r.why ? tx(`world.ceasefire.${r.why}`, undefined, '') : '';
      app.toast(`${tW(r.accepted ? 'rivals.accepted' : 'rivals.refused', { power: powerName(run, id), n: r.turns })}${why ? ` ${why}` : ''}`, r.accepted ? 'good' : 'bad');
      draw();
    }));
  };
  draw();
}

// ---------------------------------------------------------------------------------------------------
// War diary
// ---------------------------------------------------------------------------------------------------
export function openLog(app: WorldApp) {
  const run = app.run!;
  const byTurn = new Map<number, LoggedEvent[]>();
  for (const e of [...run.log].reverse()) {
    if (e.kind === 'turn' || e.kind === 'reinforce') continue;
    if (!byTurn.has(e.turn)) byTurn.set(e.turn, []);
    byTurn.get(e.turn)!.push(e);
  }
  const cls = (e: LoggedEvent) => {
    if (e.kind === 'medal' || e.kind === 'card' || e.kind === 'zone') return e.power === run.player ? 'gold' : '';
    if (e.kind === 'conquer') return e.power === run.player ? 'good' : e.prev === run.player ? 'bad' : '';
    return '';
  };
  const body = [...byTurn].slice(0, 30).map(([turn, es]) => `<h5>${esc(tW('log.turn', { n: turn }))}</h5>${es.slice(0, 40).map((e) => `<div class="wc-le ${cls(e)}"><span class="wc-sw" style="background:${hex(powerColor(run, e.power))}"></span><span>${esc(eventLine(run, e))}</span></div>`).join('')}`).join('');
  app.modal(`<div class="wc-kick">${esc(tW('top.log'))}</div><h2 class="wc-h1">${esc(tW('log.title'))}</h2><div class="wc-log">${body || `<p class="wc-p">${esc(tW('log.empty'))}</p>`}</div>`);
}

// ---------------------------------------------------------------------------------------------------
// Menu and help
// ---------------------------------------------------------------------------------------------------
export function openMenu(app: WorldApp, turn: { tool(k: string): void }) {
  const run = app.run!;
  const m = app.modal(`<div class="wc-kick">${esc(tW('kick'))}</div><h2 class="wc-h1">${esc(tW('menu.title'))}</h2>
    <p class="wc-small">${esc(tW('menu.seed', { n: run.seed }))}</p>
    <div style="display:flex;flex-direction:column;gap:8px;margin-top:10px">
      <button class="wc-btn pri" data-m="resume" data-focus>${picto('play')}${esc(tW('menu.resume'))}</button>
      <button class="wc-btn" data-m="help">${picto('question')}${esc(tW('top.help'))}</button>
      <button class="wc-btn" data-m="share">${picto('globe')}${esc(tW('menu.photo'))}</button>
      <button class="wc-btn" data-m="list">${picto('chart')}${esc(tW('top.list'))}</button>
      <button class="wc-btn" data-m="save">${picto('back')}${esc(tW('menu.save'))}</button>
      <button class="wc-btn danger" data-m="abandon">${esc(tW('menu.abandon'))}</button>
    </div>`, 'narrow');
  const on = (k: string, fn: () => void) => { m.el.querySelector<HTMLElement>(`[data-m="${k}"]`)!.onclick = () => { app.opts.play('click'); fn(); }; };
  on('resume', () => m.close());
  on('help', () => { m.close(); openHelp(app); });
  on('share', () => { m.close(); void import('./share').then((s) => s.openShare(app)); });
  on('list', () => { m.close(); turn.tool('list'); });
  on('save', () => { app.save(); m.close(); app.back(); });
  on('abandon', () => {
    void app.confirm(tW('menu.abandonConfirm'), tW('menu.abandon')).then((ok) => {
      if (!ok) return;
      m.close();
      run.status = 'lost';
      run.ending = 'abandoned';
      app.store.recordEnd(run);
      app.store.clear();
      app.run = null;
      app.nav.setup();
    });
  });
}

export function openHelp(app: WorldApp) {
  const keys = ['goal', 'reinforce', 'attack', 'fortify', 'cards', 'rivals', 'keys'] as const;
  app.modal(`<div class="wc-kick">${esc(tW('kick'))}</div><h2 class="wc-h1">${esc(tW('help.title'))}</h2>${keys.map((k) => `<p class="wc-p">${tW.html(`help.${k}`)}</p>`).join('')}`, 'narrow');
}

function safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch (e) { console.warn(e); return fallback; }
}

export { landmarkName };
