/**
 * Replays list as trees: each original match followed by its branches (rewind & take command), indented
 * per level, with watch / continue / export / delete. "Continue" plays the recording to its end and takes
 * command there (a new branch), for matches that were left before they ended.
 */
import { SIM_VERSION, otherSimVersion, simVersionOf } from '../sim/version';
import { formatTime } from '../core/util';
import { DT } from '../sim/types';
import type { ReplayData } from '../replay/format';
import { flattenTree, replayTree } from '../replay/branch';
import { replayMapName } from '../replay/store';
import { ICONS } from './icons';
import { el, esc, hexColor } from './dom';
import { ensureModesCss } from './modes-css';
import { openShareDialog, SHARE_ICONS } from '../share/dialog'; // share links
import { replayShareData } from '../share/content'; // share links
import { fmtDate, tx } from '../i18n/core';
import tCommon from '../i18n/en/common';
import tMenu from '../i18n/en/menu';
import { playerName } from '../i18n/en/players'; // built-in names (Commander, the AI commanders) in the interface language

/** A replay's result label. */
const resultLabel = (r: ReplayData['result']): string => (r === 'victory' ? tCommon('victory') : r === 'defeat' ? tCommon('defeat') : tMenu('replays.left'));

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
  return (r.setup.customMap ? ` · <span class="rpl-tag" title="${esc(tMenu('replays.customMapTip'))}">${tMenu.html('replays.customMap')}</span>` : '')
    + (mods.length ? ` · <span class="rpl-tag mod" title="${esc(tMenu('replays.moddedTip', { list: mods.map((m) => m.name ?? m.id).join(', ') }))}">${tMenu.html('replays.modded')}</span>` : '');
}

/** Render the replay rows (trees) into `list`. */
export function renderReplayTree(list: HTMLElement, replays: ReplayData[], act: ReplayTreeActions, rerender: () => void) {
  ensureModesCss();
  const rows = flattenTree(replayTree(replays));
  rows.forEach((n, i) => {
    const r = n.data;
    const br = r.setup.branch;
    const d = new Date(r.createdAt);
    const players = r.players.map((p, k) => `<span class="rpl-pl${k === r.local ? ' me' : ''}" style="--c:${hexColor(p.color)}"><i></i>${k === r.local ? '<b>' : ''}${esc(playerName(p.name))}${k === r.local ? '</b>' : ''}${p.ai ? `<small>${esc(tx(`common.difficulty.${p.ai}`, undefined, p.ai))}</small>` : ''}</span>`).join('');
    // (recorded with another simulation version, src/sim/version.ts: playback tries anyway and warns if it drifts)
    const sv = simVersionOf(r);
    const old = otherSimVersion(r)
      ? ` · <span class="rpl-old" title="${esc(tMenu(sv < SIM_VERSION ? 'replays.olderTip' : 'replays.newerTip', { build: String(r.gameVersion), sim: String(sv), current: String(SIM_VERSION) }))}">${tMenu.html(sv < SIM_VERSION ? 'replays.olderVersion' : 'replays.newerVersion')}</span>`
      : '';
    const when = br
      ? `<span class="rpl-when"><b>${formatTime(br.tick * DT)}</b><small>${n.orphan ? `<span class="rpl-orphan" title="${esc(tMenu('replays.parentGoneTip'))}">${tMenu.html('replays.parentGone')}</span>` : tMenu.html('replays.asPlayer', { name: br.name ?? r.players[br.local]?.name ?? '' })}${old}</small></span>`
      : `<span class="rpl-when"><b>${esc(fmtDate(d, { month: 'short', day: 'numeric' }))}</b><small>${esc(fmtDate(d, { hour: '2-digit', minute: '2-digit' }))}${old}</small></span>`;
    const label = esc(br && r.result === 'abandoned' ? tMenu('replays.branch') : resultLabel(r.result));
    const row = el('div', `rpl-row res-${r.result}${br && !n.orphan ? ' branch' : ''}`, `
      <span class="rpl-res" title="${br ? esc(tMenu(n.orphan ? 'replays.branchOfDeleted' : 'replays.branchOfAbove', { time: formatTime(br.tick * DT) })) : ''}">${label}</span>
      ${when}
      <span class="rpl-map"><b>${esc(replayMapName(r))}${r.setup.koth ? ` · ${tMenu.html('replays.koth')}` : ''}</b><small>${r.mapW}×${r.mapH}${tags(r)}${r.mapCode ? ` · <code>${esc(r.mapCode)}</code>` : ''}</small></span>
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
    btn(ICONS.play, tMenu('replays.watch'), () => act.watch(r), 'watch');
    const done = r.result !== 'abandoned';
    btn(ICONS.flag, tMenu(done ? 'replays.continueDone' : 'replays.continue'), () => act.cont(r), 'cont', done);
    btn(ICONS.download, tMenu('replays.export'), () => act.exportReplay(r));
    btn(SHARE_ICONS.link, tMenu('replays.share'), () => void openShareDialog({ kind: 'replay', title: replayMapName(r), data: replayShareData(r), exportFile: () => act.exportReplay(r) })); // share links
    btn(ICONS.trash, tMenu(n.children.length ? 'replays.deleteKeepBranches' : 'replays.delete'), (b) => {
      if (!b.classList.contains('confirm')) {
        b.classList.add('confirm');
        b.title = tMenu('replays.deleteConfirm');
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
