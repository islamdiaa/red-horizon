/** Commander ranks: a 15-step Cold War ladder with faction-flavoured names and an XP curve. */
import { currentLang, dt } from '../i18n/core';

export interface RankDef {
  index: number;
  allied: string;
  soviet: string;
  /** Russian transliteration shown under Soviet names. */
  ru: string;
  short: string;
  /** Total XP needed to reach this rank. */
  xp: number;
}

const NAMES: [string, string, string, string][] = [
  ['Private', 'Private', 'Ryadovoy', 'PVT'],
  ['Private First Class', 'Lance Corporal', 'Yefreytor', 'PFC'],
  ['Corporal', 'Junior Sergeant', 'Mladshiy Serzhant', 'CPL'],
  ['Sergeant', 'Sergeant', 'Serzhant', 'SGT'],
  ['Second Lieutenant', 'Junior Lieutenant', 'Mladshiy Leytenant', '2LT'],
  ['First Lieutenant', 'Lieutenant', 'Leytenant', '1LT'],
  ['Captain', 'Captain', 'Kapitan', 'CPT'],
  ['Major', 'Major', 'Mayor', 'MAJ'],
  ['Lieutenant Colonel', 'Lieutenant Colonel', 'Podpolkovnik', 'LTC'],
  ['Colonel', 'Colonel', 'Polkovnik', 'COL'],
  ['Brigadier General', 'Major General', 'General-Mayor', 'BG'],
  ['Major General', 'Lieutenant General', 'General-Leytenant', 'MG'],
  ['Lieutenant General', 'Colonel General', 'General-Polkovnik', 'LTG'],
  ['General', 'General of the Army', 'General Armii', 'GEN'],
  ['Field Marshal', 'Marshal of the Soviet Union', 'Marshal Sovetskogo Soyuza', 'FM'],
];

/** XP needed for rank n: 100,000 x (n / 14)^2.2, rounded to 50. Early ranks come fast, the top takes ~80 wins. */
export function xpForRank(n: number): number {
  if (n <= 0) return 0;
  const top = NAMES.length - 1;
  return Math.round((100000 * Math.pow(Math.min(n, top) / top, 2.2)) / 50) * 50;
}

export const RANKS: RankDef[] = NAMES.map(([allied, soviet, ru, short], index) => ({ index, allied, soviet, ru, short, xp: xpForRank(index) }));
export const MAX_RANK = RANKS.length - 1;

export function rankIndexFor(xp: number): number {
  let r = 0;
  for (let i = 0; i < RANKS.length; i++) if (xp >= RANKS[i].xp) r = i;
  return r;
}

/** A rank's display name for a faction (translated: game data rank.<index>.allied / .soviet). */
export function rankName(index: number, faction: string): string {
  const r = RANKS[Math.max(0, Math.min(MAX_RANK, index))];
  return faction === 'soviet' ? dt('rank', String(r.index), 'soviet', r.soviet) : dt('rank', String(r.index), 'allied', r.allied);
}

/** A rank's short form (PVT, CPT...). */
export function rankShort(index: number): string {
  const r = RANKS[Math.max(0, Math.min(MAX_RANK, index))];
  return dt('rank', String(r.index), 'short', r.short);
}

/** The Russian transliteration shown under Soviet rank names ('' when the interface is Russian: the name already is). */
export function rankTransliteration(index: number): string {
  if (currentLang() === 'ru') return '';
  return RANKS[Math.max(0, Math.min(MAX_RANK, index))].ru;
}

export interface RankProgress {
  index: number;
  name: string;
  next: RankDef | null;
  /** XP earned inside the current rank / needed for the next one. */
  into: number;
  span: number;
  frac: number;
}

export function rankProgress(xp: number, faction: string): RankProgress {
  const index = rankIndexFor(xp);
  const cur = RANKS[index];
  const next = index < MAX_RANK ? RANKS[index + 1] : null;
  const into = xp - cur.xp;
  const span = next ? next.xp - cur.xp : 1;
  return { index, name: rankName(index, faction), next, into, span, frac: next ? Math.min(1, into / span) : 1 };
}
