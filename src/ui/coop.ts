/**
 * Co-op survival in the Challenges hub: a Solo / +1 ally / +2 allies switch (with the allies' difficulty)
 * on the Survival panel, the mission id to deploy, and co-op records (localStorage "rh.coop.records").
 */
import type { AIDifficulty } from '../sim/ai';
import type { Profile } from '../meta';
import { coopMissionId, type SurvivalVariant } from '../missions/special';
import { ensureModesCss } from './modes-css';
import { esc } from './dom';
import tLobby from '../i18n/en/lobby';
import tCommon from '../i18n/en/common';

const KEY = 'rh.coop';
const REC_KEY = 'rh.coop.records';

export interface CoopPref { allies: 0 | 1 | 2; difficulty: AIDifficulty }
export interface CoopRecord { bestScore: number; bestWave: number; runs: number }

export function loadCoop(): CoopPref {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { allies: v.allies === 1 || v.allies === 2 ? v.allies : 0, difficulty: ['easy', 'normal', 'hard', 'brutal'].includes(v.difficulty) ? v.difficulty : 'hard' };
  } catch {
    return { allies: 0, difficulty: 'hard' };
  }
}
function saveCoop(p: CoopPref) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

/** Mission id the Survival card deploys with the current switch. */
export function survivalDeployId(variantId: string, pref = loadCoop()): string {
  return pref.allies ? coopMissionId(variantId, Array.from({ length: pref.allies }, () => ({ difficulty: pref.difficulty }))) : variantId;
}

function loadRecords(): Record<string, CoopRecord> {
  try { return JSON.parse(localStorage.getItem(REC_KEY) ?? '{}') ?? {}; } catch { return {}; }
}
/** Record a co-op run (called when a co-op survival match ends). */
export function recordCoopRun(id: string, score: number, waves: number) {
  const all = loadRecords();
  const r = all[id] ?? { bestScore: 0, bestWave: 0, runs: 0 };
  all[id] = { bestScore: Math.max(r.bestScore, score), bestWave: Math.max(r.bestWave, waves), runs: r.runs + 1 };
  try { localStorage.setItem(REC_KEY, JSON.stringify(all)); } catch { /* ignore */ }
}

/** Record shown on a Survival card: the solo profile record, or the co-op one for the current switch. */
export function survivalRecord(v: SurvivalVariant, p: Profile): CoopRecord | undefined {
  const pref = loadCoop();
  if (!pref.allies) return p.survival[v.id];
  return loadRecords()[survivalDeployId(v.id, pref)];
}

/** Switch markup for the Survival panel header. */
export function coopSwitchHtml(): string {
  ensureModesCss();
  const p = loadCoop();
  const b = (attr: string, v: string | number, label: string, on: boolean, tip: string) => `<button data-${attr}="${v}" class="${on ? 'on' : ''}" title="${esc(tip)}">${esc(label)}</button>`;
  return `<span class="coop-sw">${b('coop', 0, tLobby('coop.solo'), p.allies === 0, tLobby('coop.soloTip'))}${b('coop', 1, tLobby('coop.one'), p.allies === 1, tLobby('coop.oneTip'))}${b('coop', 2, tLobby('coop.two'), p.allies === 2, tLobby('coop.twoTip'))}</span>`
    + (p.allies ? `<span class="coop-sw">${(['normal', 'hard', 'brutal'] as const).map((d) => b('coopd', d, tCommon(`difficulty.${d}`), p.difficulty === d, tLobby('coop.levelTip', { level: d }))).join('')}</span>` : '');
}

/** Wire the switch (re-renders the hub on change). */
export function bindCoopSwitch(root: HTMLElement, rerender: () => void) {
  root.querySelectorAll<HTMLElement>('[data-coop]').forEach((b) => {
    b.onclick = (e) => { e.stopPropagation(); saveCoop({ ...loadCoop(), allies: +b.dataset.coop! as 0 | 1 | 2 }); rerender(); };
  });
  root.querySelectorAll<HTMLElement>('[data-coopd]').forEach((b) => {
    b.onclick = (e) => { e.stopPropagation(); saveCoop({ ...loadCoop(), difficulty: b.dataset.coopd as AIDifficulty }); rerender(); };
  });
}
