/**
 * Replays list as trees: each original match followed by its branches (rewind & take command), indented
 * per level, with watch / continue / export / delete. "Continue" plays the recording to its end and takes
 * command there (a new branch), for matches that were left before they ended.
 */
import { VERSION } from '../config';
import { formatTime } from '../core/util';
import { DT } from '../sim/types';
import type { ReplayData } from '../replay/format';
import { flattenTree, replayTree } from '../replay/branch';
import { ICONS } from './icons';
import { el, esc, hexColor } from './dom';
import { ensureModesCss } from './modes-css';

const RESULT_LABEL: Record<ReplayData['result'], string> = { victory: 'Victory', defeat: 'Defeat', abandoned: 'Left' };

export interface ReplayTreeActions {
  watch(r: ReplayData): void;
  /** Take command at the end of the recording (left matches only). */
  cont(r: ReplayData): void;
  exportReplay(r: ReplayData): void;
  del(r: ReplayData): Promise<void>;
}

/** "Custom map" / "Modded" markers (setups carry the map content and the mod set). */
function tags(r: ReplayData): string {
  const mods = r.setup.mods?.mods ?? [];
  return (r.setup.customMap ? ' · <span class="rpl-tag" title="Made in the map editor">custom map</span>' : '')
    + (mods.length ? ` · <span class="rpl-tag mod" title="Mods: ${esc(mods.map((m) => m.name ?? m.id).join(', '))}">modded</span>` : '');
}

/** Render the replay rows (trees) into `list`. */
export function renderReplayTree(list: HTMLElement, replays: ReplayData[], act: ReplayTreeActions, rerender: () => void) {
  ensureModesCss();
  const rows = flattenTree(replayTree(replays));
  rows.forEach((n, i) => {
    const r = n.data;
    const br = r.setup.branch;
    const d = new Date(r.createdAt);
    const players = r.players.map((p, k) => `<span class="rpl-pl${k === r.local ? ' me' : ''}" style="--c:${hexColor(p.color)}"><i></i>${k === r.local ? '<b>' : ''}${esc(p.name)}${k === r.local ? '</b>' : ''}${p.ai ? `<small>${esc(p.ai)}</small>` : ''}</span>`).join('');
    const when = br
      ? `<span class="rpl-when"><b>${formatTime(br.tick * DT)}</b><small>${n.orphan ? '<span class="rpl-orphan" title="The replay it branched from is no longer stored">parent gone</span>' : `as ${esc(br.name ?? r.players[br.local]?.name ?? '')}`}</small></span>`
      : `<span class="rpl-when"><b>${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</b><small>${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}${r.gameVersion !== VERSION ? ` · <span class="rpl-old" title="Recorded with build ${esc(r.gameVersion)}: it may desync on this build">v${esc(r.gameVersion)}</span>` : ''}</small></span>`;
    const label = br ? (r.result === 'abandoned' ? 'Branch' : RESULT_LABEL[r.result]) : RESULT_LABEL[r.result];
    const row = el('div', `rpl-row res-${r.result}${br && !n.orphan ? ' branch' : ''}`, `
      <span class="rpl-res" title="${br ? `Branch of ${n.orphan ? 'a deleted replay' : 'the replay above'}, taken at ${formatTime(br.tick * DT)}` : ''}">${label}</span>
      ${when}
      <span class="rpl-map"><b>${esc(r.mapName)}${r.setup.koth ? ' · KOTH' : ''}</b><small>${r.mapW}×${r.mapH}${tags(r)}${r.mapCode ? ` · <code>${esc(r.mapCode)}</code>` : ''}</small></span>
      <span class="rpl-pls">${players}</span>
      <span class="rpl-dur">${ICONS.clock}${formatTime((r.ticks - (br?.tick ?? 0)) * DT)}</span>`);
    row.style.setProperty('--i', String(i));
    row.style.setProperty('--d', String(Math.min(4, n.depth)));
    const acts = el('span', 'rpl-acts');
    const btn = (icon: string, title: string, fn: (b: HTMLButtonElement) => void, cls = '', disabled = false) => {
      const b = el('button', 'rpl-btn ' + cls, icon) as HTMLButtonElement;
      b.title = title;
      b.setAttribute('aria-label', title);
      b.disabled = disabled;
      b.onclick = () => fn(b);
      acts.appendChild(b);
    };
    btn(ICONS.play, 'Watch', () => act.watch(r), 'watch');
    const done = r.result !== 'abandoned';
    btn(ICONS.flag, done ? 'The match is over: watch it and take command at an earlier moment (T in the replay)' : 'Continue: take command where the recording stops', () => act.cont(r), 'cont', done);
    btn(ICONS.download, 'Export to a .json file', () => act.exportReplay(r));
    btn(ICONS.trash, n.children.length ? 'Delete (its branches stay)' : 'Delete', (b) => {
      if (!b.classList.contains('confirm')) {
        b.classList.add('confirm');
        b.title = 'Click again to delete';
        setTimeout(() => b.classList.remove('confirm'), 2500);
        return;
      }
      void act.del(r).then(rerender);
    }, 'del');
    row.appendChild(acts);
    row.ondblclick = () => act.watch(r);
    list.appendChild(row);
  });
}
