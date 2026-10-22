/**
 * Challenge screens: the list (built-ins + made / imported challenges, personal bests, import / export /
 * delete), the result screen after an attempt, and the "make this a challenge" offers on the end screen.
 */
import { BUILTIN_LIST } from '../modes/builtins';
import { challengeClock } from '../modes/challenge';
import { deleteChallenge, exportChallenge, importChallenge, listChallenges, loadBests, saveChallenge, FILE_EXT, type ChallengeBest } from '../modes/store';
import type { ChallengeDef, ChallengeResult } from '../modes/types';
import { formatTime } from '../core/util';
import { picto } from '../meta';
import { ICONS } from './icons';
import { el, esc } from './dom';
import { focusTrap } from './a11y'; // Tab stays inside the screen
import { ensureModesCss } from './modes-css';
import { openShareDialog, SHARE_ICONS } from '../share/dialog'; // share links
import { dt, fmtInt, trSource } from '../i18n/core';
import { CURATED_MAPS } from '../maps';
import tChallenges from '../i18n/en/challenges';
import tModes from '../i18n/en/modes';
import tCommon from '../i18n/en/common';

export const stars = (n: number, of = 3) => `<span class="mx-stars">${'★'.repeat(Math.max(0, n))}<i>${'★'.repeat(Math.max(0, of - n))}</i></span>`;
const fmtN = (n: number) => fmtInt(n);
/** Short goal tag ("Win · 15:00") in the active language. */
function goalTag(c: Pick<ChallengeDef, 'goal' | 'timeLimit'>): string {
  return tModes(`tag.${c.goal.kind}`, { hold: challengeClock(c.goal.seconds ?? 60), limit: challengeClock(c.timeLimit) });
}

/** A challenge's map name (stored in English): curated maps and "Random 96×96" translate. */
function mapLabel(name: string): string {
  const r = /^Random (\d+)×(\d+)$/.exec(name);
  if (r) return tModes('randomMap', { w: r[1], h: r[2] });
  const def = CURATED_MAPS.find((m) => m.name === name);
  return def ? dt('map', def.id, 'name', def.name) : name;
}

export interface ChallengeListOptions {
  play(c: ChallengeDef): void;
  onBack(): void;
  sound?(k: 'click' | 'hover' | 'tab' | 'error'): void;
}

function card(c: ChallengeDef, b: ChallengeBest | undefined, i: number, builtin: boolean): string {
  const src = tChallenges.html(c.source?.kind === 'moment' ? 'list.src.moment' : c.source?.kind === 'replay' ? 'list.src.replay' : c.source?.kind === 'import' ? 'list.src.import' : builtin ? 'list.src.builtin' : 'list.src.other');
  const where = c.source?.map ? ` · ${esc(mapLabel(c.source.map))}${c.source.tick !== undefined ? ` ${formatTime(c.source.tick / 20)}` : ''}` : '';
  // (built-in and suggested challenges are stored in English: trSource translates them; the player's own text stays)
  return `<div class="chx-card" style="--i:${i}" data-id="${esc(c.id)}">
    <div class="k">${picto(builtin ? 'medal' : 'target', 'ic')}<span>${src}</span><em>${esc(goalTag(c))}${where}</em></div>
    <h3>${esc(trSource(c.title))}</h3>
    <p>${esc(trSource(c.description ?? ''))}</p>
    <div class="chx-stats"><span class="pb"><small>${tChallenges.html('list.bestScore')}</small><b>${b?.completed ? fmtN(b.bestScore) : '–'}</b></span><span><small>${tChallenges.html('list.stars')}</small><b>${stars(b?.bestStars ?? 0)}</b></span>
      <span><small>${tChallenges.html('list.bestTime')}</small><b>${b?.bestTime != null ? formatTime(b.bestTime) : '–'}</b></span><span><small>${tChallenges.html('list.attempts')}</small><b>${b?.attempts ?? 0}</b></span></div>
    <div class="chx-acts"><button class="btn go" data-a="play">${ICONS.play}<span>${tChallenges.html('list.play')}</span></button>
      <button class="rpl-btn" data-a="export" title="${tChallenges.html('list.exportTip', { ext: FILE_EXT })}">${ICONS.download}</button>
      <button class="rpl-btn" data-a="link" title="${tChallenges.html('list.linkTip')}">${SHARE_ICONS.link}</button>
      ${builtin ? '' : `<button class="rpl-btn del" data-a="del" title="${tChallenges.html('list.deleteTip')}">${ICONS.trash}</button>`}</div>
  </div>`;
}

/** Full-screen challenge list. Returns a close function. */
export function openChallengeList(o: ChallengeListOptions): () => void {
  ensureModesCss();
  const root = el('div', 'chx');
  document.body.appendChild(root);
  const play = (k: 'click' | 'hover' | 'tab' | 'error') => o.sound?.(k);
  root.innerHTML = `<div class="chx-top"><div><small>${tChallenges.html('list.kicker')}</small><h1>${tChallenges.html('list.title')}</h1></div><span class="sp"></span>
      <input type="file" accept="${FILE_EXT},.json,application/json" style="display:none"><button class="btn" data-a="import">${ICONS.upload}<span>${tChallenges.html('list.import')}</span></button></div>
    <div class="chx-body"><div class="chx-empty"><span class="rpl-spin"></span></div></div>
    <div class="chx-foot"><button class="btn btn-back" data-a="back">${ICONS.chevL}<span>${tCommon.html('back')}</span><kbd>${tCommon.html('keys.esc')}</kbd></button><span class="note">${tChallenges.html('list.note')}</span></div>`;
  const body = root.querySelector('.chx-body') as HTMLElement;
  const note = root.querySelector('.note') as HTMLElement;
  const file = root.querySelector('input[type=file]') as HTMLInputElement;
  let closed = false;
  const untrap = focusTrap(root, { initial: false });
  const close = () => {
    if (closed) return;
    closed = true;
    untrap();
    document.removeEventListener('keydown', onKey, true);
    root.classList.add('leaving');
    setTimeout(() => root.remove(), 240);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    close();
    o.onBack();
  };
  document.addEventListener('keydown', onKey, true);
  (root.querySelector('[data-a="back"]') as HTMLElement).onclick = () => { play('click'); close(); o.onBack(); };
  (root.querySelector('[data-a="import"]') as HTMLElement).onclick = () => file.click();
  file.onchange = async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    try {
      const { challenge: c, already } = await importChallenge(f);
      // a challenge that is already in the list (a built-in, or one imported before) gets no second card: say so and show it
      note.textContent = already ? tChallenges('list.already', { title: trSource(c.title) }) : tChallenges('list.imported', { title: trSource(c.title) });
      note.classList.remove('bad');
      void render().then(() => showCard(c.id));
    } catch (e) {
      note.textContent = (e as Error).message;
      note.classList.add('bad');
      play('error');
    }
  };

  /** Bring a card into view and flash it (the challenge just imported, or the one it already was). */
  const showCard = (id: string) => {
    const cardEl = Array.from(body.querySelectorAll<HTMLElement>('.chx-card')).find((x) => x.dataset.id === id);
    if (!cardEl) return;
    cardEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    cardEl.animate?.([{ boxShadow: '0 0 0 0 rgba(255, 211, 77, 0)' }, { boxShadow: '0 0 0 3px rgba(255, 211, 77, .9), 0 0 1.4rem rgba(255, 211, 77, .55)' }, { boxShadow: '0 0 0 0 rgba(255, 211, 77, 0)' }], { duration: 1600, iterations: 2, easing: 'ease-in-out' });
    cardEl.querySelector<HTMLElement>('[data-a="play"]')?.focus({ preventScroll: true });
  };

  const render = async () => {
    let mine: ChallengeDef[] = [];
    try { mine = await listChallenges(); } catch { /* no storage */ }
    if (closed) return;
    const bests = loadBests();
    body.innerHTML = `<div class="mx-sec">${tChallenges.html('list.builtins')}</div><div class="chx-grid">${BUILTIN_LIST.map((c, i) => card(c, bests[c.id], i, true)).join('')}</div>
      <div class="mx-sec">${tChallenges.html('list.mine')}</div>${mine.length ? `<div class="chx-grid">${mine.map((c, i) => card(c, bests[c.id], i, false)).join('')}</div>`
        : `<div class="chx-empty">${tChallenges.html('list.empty', { ext: FILE_EXT })}</div>`}`;
    const all = [...BUILTIN_LIST, ...mine];
    body.querySelectorAll<HTMLElement>('.chx-card').forEach((cardEl) => {
      const c = all.find((x) => x.id === cardEl.dataset.id);
      if (!c) return;
      cardEl.querySelector<HTMLElement>('[data-a="play"]')!.onclick = () => { play('click'); close(); o.play(c); };
      cardEl.querySelector<HTMLElement>('[data-a="export"]')!.onclick = () => { void exportChallenge(c); };
      cardEl.querySelector<HTMLElement>('[data-a="link"]')!.onclick = () => { play('click'); void openShareDialog({ kind: 'challenge', title: c.title, data: c, exportFile: () => void exportChallenge(c) }); }; // share links
      const del = cardEl.querySelector<HTMLElement>('[data-a="del"]');
      if (del) del.onclick = () => {
        if (!del.classList.contains('confirm')) {
          del.classList.add('confirm');
          del.title = tChallenges('list.deleteConfirm');
          setTimeout(() => del.classList.remove('confirm'), 2500);
          return;
        }
        void deleteChallenge(c.id).then(render);
      };
    });
  };
  void render();
  return close;
}

export interface ChallengeResultOptions {
  retry(): void;
  list(): void;
  menu(): void;
  watch(): void;
}

/** Result of an attempt (shown instead of the skirmish end screen). */
export function showChallengeResult(c: ChallengeDef, r: ChallengeResult | null, best: { best: ChallengeBest; newBest: boolean; previous: ChallengeBest | null } | null, o: ChallengeResultOptions): () => void {
  ensureModesCss();
  const won = !!r?.won;
  const ov = el('div', 'mx-overlay');
  const p = el('div', `mx-panel panel chr ${won ? 'win' : 'lose'}`);
  ov.appendChild(p);
  // (the reason and bonus label come from the simulation in English: trSource)
  const rows: [string, string][] = r ? [
    [tChallenges('result.objective'), won ? `+${fmtN(1000)}` : '0'],
    [r.bonusLabel ? trSource(r.bonusLabel) : tChallenges('result.bonus'), won ? `+${fmtN(r.bonus)}` : '–'],
    [tChallenges('result.unitsDestroyed', { n: String(r.kills) }), won ? `+${fmtN(r.kills * 25)}` : '–'],
    [tChallenges('result.structuresDestroyed', { n: String(r.structuresKilled) }), won ? `+${fmtN(r.structuresKilled * 60)}` : '–'],
    [tChallenges('result.unitsLost', { n: String(r.losses) }), won ? `−${fmtN(r.losses * 15)}` : '–'],
    [tChallenges('result.structuresLost', { n: String(r.structuresLost) }), won ? `−${fmtN(r.structuresLost * 50)}` : '–'],
  ] : [];
  const prev = best?.previous;
  const pb = !best ? '' : best.newBest ? (prev?.completed ? tChallenges.html('result.newBestWas', { score: fmtN(prev.bestScore) }) : tChallenges.html('result.firstCompletion'))
    : tChallenges.html('result.personalBest', { score: best.best.completed ? fmtN(best.best.bestScore) : '–', n: String(best.best.attempts) });
  p.innerHTML = `<div class="chr-k">${tChallenges.html('result.kicker', { title: trSource(c.title) })}</div>
    <h1>${tChallenges.html(won ? 'result.completed' : 'result.failed')}</h1>
    <div class="chr-reason">${esc(trSource(r?.reason ?? ''))}${r ? ` · ${formatTime(r.time)}` : ''}</div>
    <div class="chr-stars">${stars(r?.stars ?? 0)}</div>
    ${r ? `<table>${rows.map(([a, b]) => `<tr><td>${esc(a)}</td><td>${b}</td></tr>`).join('')}<tr class="total"><td>${tChallenges.html('result.score')}</td><td>${fmtN(r.score)}</td></tr></table>` : ''}
    ${best ? `<div class="chr-pb${best.newBest ? ' new' : ''}">${picto('trophy', 'ic')}<span>${pb}</span></div>` : ''}
    <div class="mx-actions"><button class="btn-primary" data-a="retry">${ICONS.restart}<span>${tChallenges.html('result.retry')}</span></button><button class="btn" data-a="watch">${ICONS.eye}<span>${tChallenges.html('result.battlefield')}</span></button>
      <button class="btn" data-a="export">${ICONS.download}<span>${tChallenges.html('result.export')}</span></button><button class="btn" data-a="list">${picto('trophy', 'ic')}<span>${tChallenges.html('result.challenges')}</span></button><button class="btn" data-a="menu">${ICONS.exit}<span>${tCommon.html('menu')}</span></button></div>`;
  document.body.appendChild(ov);
  let closed = false;
  const close = () => { if (closed) return; closed = true; ov.classList.add('leaving'); setTimeout(() => ov.remove(), 220); };
  const on = (a: string, fn: () => void) => { (p.querySelector(`[data-a="${a}"]`) as HTMLElement).onclick = fn; };
  on('retry', () => { close(); o.retry(); });
  on('list', () => { close(); o.list(); });
  on('menu', () => { close(); o.menu(); });
  on('watch', () => { close(); o.watch(); });
  on('export', () => { void exportChallenge(c); });
  return close;
}

/** "Make this a challenge" cards for the end screen. */
export function momentOffers(host: HTMLElement, offers: { def: ChallengeDef; at: number }[], play: (c: ChallengeDef) => void): HTMLElement | null {
  if (!offers.length) return null;
  ensureModesCss();
  const box = el('div', 'mom-offers panel');
  box.innerHTML = `<div class="mom-h">${picto('trophy', 'ic')}<span>${tChallenges.html('offers.title')}</span><small>${tChallenges.html('offers.sub')}</small></div><div class="mom-list"></div>`;
  const list = box.querySelector('.mom-list') as HTMLElement;
  for (const { def, at } of offers) {
    const c = el('div', 'mom-card', `<div class="t"><span>${esc(trSource(def.title))}</span><em>${formatTime(at)}</em></div><p>${esc(trSource(def.description ?? ''))}</p>
      <div class="a"><button class="btn" data-a="play">${ICONS.play}<span>${tChallenges.html('offers.play')}</span></button><button class="btn" data-a="save">${ICONS.check}<span>${tChallenges.html('offers.save')}</span></button></div>`);
    (c.querySelector('[data-a="play"]') as HTMLElement).onclick = () => { void saveChallenge(def).catch(() => {}); play(def); };
    const save = c.querySelector('[data-a="save"]') as HTMLButtonElement;
    save.onclick = () => {
      void saveChallenge(def).then(() => { save.classList.add('saved'); save.innerHTML = `${ICONS.check}<span>${tChallenges.html('offers.saved')}</span>`; save.disabled = true; }).catch(() => {});
    };
    list.appendChild(c);
  }
  host.appendChild(box);
  return box;
}
