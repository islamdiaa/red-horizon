/**
 * Challenge screens: the list (built-ins + made / imported challenges, personal bests, import / export /
 * delete), the result screen after an attempt, and the "make this a challenge" offers on the end screen.
 */
import { BUILTIN_LIST } from '../modes/builtins';
import { goalTag } from '../modes/challenge';
import { deleteChallenge, exportChallenge, importChallengeFile, listChallenges, loadBests, saveChallenge, FILE_EXT, type ChallengeBest } from '../modes/store';
import type { ChallengeDef, ChallengeResult } from '../modes/types';
import { formatTime } from '../core/util';
import { picto } from '../meta';
import { ICONS } from './icons';
import { el, esc } from './dom';
import { ensureModesCss } from './modes-css';

export const stars = (n: number, of = 3) => `<span class="mx-stars">${'★'.repeat(Math.max(0, n))}<i>${'★'.repeat(Math.max(0, of - n))}</i></span>`;
const fmtN = (n: number) => Math.round(n).toLocaleString('en-US');

export interface ChallengeListOptions {
  play(c: ChallengeDef): void;
  onBack(): void;
  sound?(k: 'click' | 'hover' | 'tab' | 'error'): void;
}

function card(c: ChallengeDef, b: ChallengeBest | undefined, i: number, builtin: boolean): string {
  const src = c.source?.kind === 'moment' ? 'From your match' : c.source?.kind === 'replay' ? 'From a replay' : c.source?.kind === 'import' ? 'Imported' : builtin ? 'Field exercise' : 'Challenge';
  const where = c.source?.map ? ` · ${esc(c.source.map)}${c.source.tick !== undefined ? ` ${formatTime(c.source.tick / 20)}` : ''}` : '';
  return `<div class="chx-card" style="--i:${i}" data-id="${esc(c.id)}">
    <div class="k">${picto(builtin ? 'medal' : 'target', 'ic')}<span>${src}</span><em>${esc(goalTag(c))}${where}</em></div>
    <h3>${esc(c.title)}</h3>
    <p>${esc(c.description ?? '')}</p>
    <div class="chx-stats"><span class="pb"><small>Best score</small><b>${b?.completed ? fmtN(b.bestScore) : '–'}</b></span><span><small>Stars</small><b>${stars(b?.bestStars ?? 0)}</b></span>
      <span><small>Best time</small><b>${b?.bestTime != null ? formatTime(b.bestTime) : '–'}</b></span><span><small>Attempts</small><b>${b?.attempts ?? 0}</b></span></div>
    <div class="chx-acts"><button class="btn go" data-a="play">${ICONS.play}<span>Play</span></button>
      <button class="rpl-btn" data-a="export" title="Export a ${FILE_EXT} file">${ICONS.download}</button>
      ${builtin ? '' : `<button class="rpl-btn del" data-a="del" title="Delete">${ICONS.trash}</button>`}</div>
  </div>`;
}

/** Full-screen challenge list. Returns a close function. */
export function openChallengeList(o: ChallengeListOptions): () => void {
  ensureModesCss();
  const root = el('div', 'chx');
  document.body.appendChild(root);
  const play = (k: 'click' | 'hover' | 'tab' | 'error') => o.sound?.(k);
  root.innerHTML = `<div class="chx-top"><div><small>Can you win from here?</small><h1>Scenario challenges</h1></div><span class="sp"></span>
      <input type="file" accept="${FILE_EXT},.json,application/json" style="display:none"><button class="btn" data-a="import">${ICONS.upload}<span>Import</span></button></div>
    <div class="chx-body"><div class="chx-empty"><span class="rpl-spin"></span></div></div>
    <div class="chx-foot"><button class="btn btn-back" data-a="back">${ICONS.chevL}<span>Back</span><kbd>Esc</kbd></button><span class="note">Make your own: pause any replay and press <b>Make a challenge</b>, or pick a suggested moment on the end screen after a match.</span></div>`;
  const body = root.querySelector('.chx-body') as HTMLElement;
  const note = root.querySelector('.note') as HTMLElement;
  const file = root.querySelector('input[type=file]') as HTMLInputElement;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
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
      const c = await importChallengeFile(f);
      note.textContent = `Imported: ${c.title}`;
      note.classList.remove('bad');
      void render();
    } catch (e) {
      note.textContent = (e as Error).message;
      note.classList.add('bad');
      play('error');
    }
  };

  const render = async () => {
    let mine: ChallengeDef[] = [];
    try { mine = await listChallenges(); } catch { /* no storage */ }
    if (closed) return;
    const bests = loadBests();
    body.innerHTML = `<div class="mx-sec">Field exercises</div><div class="chx-grid">${BUILTIN_LIST.map((c, i) => card(c, bests[c.id], i, true)).join('')}</div>
      <div class="mx-sec">Your challenges</div>${mine.length ? `<div class="chx-grid">${mine.map((c, i) => card(c, bests[c.id], i, false)).join('')}</div>`
        : `<div class="chx-empty"><b>No challenges yet.</b> After a skirmish, the end screen suggests turning points of the match ("Make this a challenge"). In any replay, pause and press <b>Make a challenge</b> to set a goal from that moment. Friends' ${FILE_EXT} files can be imported above.</div>`}`;
    const all = [...BUILTIN_LIST, ...mine];
    body.querySelectorAll<HTMLElement>('.chx-card').forEach((cardEl) => {
      const c = all.find((x) => x.id === cardEl.dataset.id);
      if (!c) return;
      cardEl.querySelector<HTMLElement>('[data-a="play"]')!.onclick = () => { play('click'); close(); o.play(c); };
      cardEl.querySelector<HTMLElement>('[data-a="export"]')!.onclick = () => { void exportChallenge(c); };
      const del = cardEl.querySelector<HTMLElement>('[data-a="del"]');
      if (del) del.onclick = () => {
        if (!del.classList.contains('confirm')) {
          del.classList.add('confirm');
          del.title = 'Click again to delete';
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
  const rows: [string, string][] = r ? [
    ['Objective', won ? '+1,000' : '0'],
    [r.bonusLabel || 'Bonus', won ? `+${fmtN(r.bonus)}` : '–'],
    [`Units destroyed (${r.kills})`, won ? `+${fmtN(r.kills * 25)}` : '–'],
    [`Structures destroyed (${r.structuresKilled})`, won ? `+${fmtN(r.structuresKilled * 60)}` : '–'],
    [`Units lost (${r.losses})`, won ? `−${fmtN(r.losses * 15)}` : '–'],
    [`Structures lost (${r.structuresLost})`, won ? `−${fmtN(r.structuresLost * 50)}` : '–'],
  ] : [];
  const prev = best?.previous;
  p.innerHTML = `<div class="chr-k">Challenge · ${esc(c.title)}</div>
    <h1>${won ? 'Completed' : 'Failed'}</h1>
    <div class="chr-reason">${esc(r?.reason ?? '')}${r ? ` · ${formatTime(r.time)}` : ''}</div>
    <div class="chr-stars">${stars(r?.stars ?? 0)}</div>
    ${r ? `<table>${rows.map(([a, b]) => `<tr><td>${esc(a)}</td><td>${b}</td></tr>`).join('')}<tr class="total"><td>Score</td><td>${fmtN(r.score)}</td></tr></table>` : ''}
    ${best ? `<div class="chr-pb${best.newBest ? ' new' : ''}">${picto('trophy', 'ic')}<span>${best.newBest ? (prev?.completed ? `New personal best (was ${fmtN(prev.bestScore)})` : 'First completion!') : `Personal best ${best.best.completed ? fmtN(best.best.bestScore) : '–'} · attempt ${best.best.attempts}`}</span></div>` : ''}
    <div class="mx-actions"><button class="btn-primary" data-a="retry">${ICONS.restart}<span>Retry</span></button><button class="btn" data-a="watch">${ICONS.eye}<span>Battlefield</span></button>
      <button class="btn" data-a="export">${ICONS.download}<span>Export</span></button><button class="btn" data-a="list">${picto('trophy', 'ic')}<span>Challenges</span></button><button class="btn" data-a="menu">${ICONS.exit}<span>Menu</span></button></div>`;
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
  box.innerHTML = `<div class="mom-h">${picto('trophy', 'ic')}<span>Make this a challenge</span><small>key moments of this match, ready to replay with a goal</small></div><div class="mom-list"></div>`;
  const list = box.querySelector('.mom-list') as HTMLElement;
  for (const { def, at } of offers) {
    const c = el('div', 'mom-card', `<div class="t"><span>${esc(def.title)}</span><em>${formatTime(at)}</em></div><p>${esc(def.description ?? '')}</p>
      <div class="a"><button class="btn" data-a="play">${ICONS.play}<span>Play</span></button><button class="btn" data-a="save">${ICONS.check}<span>Save</span></button></div>`);
    (c.querySelector('[data-a="play"]') as HTMLElement).onclick = () => { void saveChallenge(def).catch(() => {}); play(def); };
    const save = c.querySelector('[data-a="save"]') as HTMLButtonElement;
    save.onclick = () => {
      void saveChallenge(def).then(() => { save.classList.add('saved'); save.innerHTML = `${ICONS.check}<span>Saved</span>`; save.disabled = true; }).catch(() => {});
    };
    list.appendChild(c);
  }
  host.appendChild(box);
  return box;
}
