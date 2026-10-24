/**
 * World Conquest display helpers: names (territories, zones, homelands, powers), colours, small formatters and
 * icons, shared by every world screen.
 */
import { tx, fmtInt, fmtPct } from '../../i18n/core';
import { personName } from '../../i18n/en/players';
import tW from '../../i18n/en/world-ui';
import tWorld from '../../i18n/en/world';
import type { WorldRun, WPower } from '../../conquest/world/state';
import { geography } from './data';
import * as G from '../../conquest/world/names';
import { HOMELAND_BY_ID, REGION_BY_ID, ZONE_BY_ID } from '../../conquest/world/regions';
import type { LandmarkId } from '../../conquest/world/types';
import { teamPalette, CVD_COLORS } from '../a11y';

export { tW, tWorld };
type WK = Parameters<typeof tWorld>[0];
/** Names from the rules' catalogue (src/i18n/en/world.ts). */
export const diffName = (d: string) => tWorld(`difficulty.${d}.name` as WK);
export const diffDesc = (d: string) => tWorld(`difficulty.${d}.desc` as WK);
export const persName = (p: string) => (p === 'human' ? tW('rivals.you') : tWorld(`personality.${p}.name` as WK));
export const persDesc = (p: string) => (p === 'human' ? '' : tWorld(`personality.${p}.desc` as WK));
export const cardName = (k: string) => tWorld(`card.${k}` as WK);
export const sizeName = (s: string) => tWorld(`size.${s}` as WK);
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const NEUTRAL_COLOR = 0x76808a; // (slate: unowned land reads apart from every power's colour)
export const SIDE_RGB = { allies: '61,123,224', soviet: '210,58,44' } as const;
export const hex = (c: number) => `#${(c & 0xffffff).toString(16).padStart(6, '0')}`;
export { fmtInt };
export const pct = (p: number) => fmtPct(Math.max(0, Math.min(1, p)), 0);

/** Place names: GEO's names table (translated), the atlas's English for the stub geography. */
export function territoryName(id: string): string {
  if (REGION_BY_ID[id]) return G.regionName(id);
  const g = geography(), i = g.byId.get(id);
  return i == null ? id : g.regions[i].name;
}
export function zoneName(id: string): string {
  if (ZONE_BY_ID[id]) return G.zoneName(id);
  return geography().zones.find((x) => x.id === id)?.name ?? id;
}
export function homelandName(id: string): string {
  if (HOMELAND_BY_ID[id]) return G.homelandName(id);
  return geography().homelands.find((x) => x.id === id)?.name ?? id;
}
export function homelandBlurb(id: string): string {
  if (HOMELAND_BY_ID[id]) return G.homelandBlurb(id);
  return geography().homelands.find((x) => x.id === id)?.blurb ?? '';
}
export const landmarkName = (id: string): string => G.landmarkName(id as LandmarkId);
export const landmarkBlurb = (id: string): string => G.landmarkBlurb(id as LandmarkId);
export const continentName = (id: string): string => tW(`continent.${id}` as Parameters<typeof tW>[0]);

/** A power's name: "You" for the human, the rival regime's name otherwise. */
export function powerName(run: WorldRun, id: number): string {
  if (id < 0) return tW('owner.neutral');
  if (id === run.player) return tW('rivals.you');
  const p = run.powers[id];
  return p ? tWorld(`regime.${p.name}` as WK) : '?';
}
export function commanderName(p: WPower): string {
  return p.commander ? personName(p.commander) : '';
}

/** Display colour of a power (the colour-blind palette when that accessibility option is on). */
export function powerColor(run: WorldRun, id: number): number {
  if (id < 0) return NEUTRAL_COLOR;
  if (teamPalette() === 'cvd') return CVD_COLORS[id % CVD_COLORS.length];
  return run.powers[id]?.color ?? 0x888888;
}

export function ownerName(run: WorldRun, owner: number): string {
  return owner === run.player ? tW('owner.you') : owner < 0 ? tW('owner.neutral') : powerName(run, owner);
}

/** Card art (small inline SVG). */
export function cardIcon(kind: string): string {
  if (kind === 'infantry') return '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="24" cy="11" r="5"/><path d="M24 16v14M15 22l9-3 9 3M24 30l-6 12M24 30l6 12M33 22l5-9"/></svg>';
  if (kind === 'armour') return '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="24" width="36" height="10" rx="5"/><path d="M13 24v-6h16l4 6M29 19h14"/><circle cx="13" cy="29" r="2"/><circle cx="24" cy="29" r="2"/><circle cx="35" cy="29" r="2"/></svg>';
  return '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M24 6c2 0 3 2 3 5v9l15 8v4l-15-4v8l5 4v3l-8-2-8 2v-3l5-4v-8L6 32v-4l15-8v-9c0-3 1-5 3-5z"/></svg>';
}

/** Dice pips for a value 1-6 (3x3 grid cells). */
const PIPS: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
export function dieHtml(v: number, cls: string): string {
  const on = new Set(PIPS[v] ?? []);
  let pips = '';
  for (let k = 0; k < 9; k++) pips += on.has(k) ? '<i></i>' : '<span></span>';
  return `<div class="wc-die ${cls}" aria-label="${v}">${pips}</div>`;
}

/** Map-pin icon of a homeland's default doctrine. */
export const isoWeekOf = (d: Date) => {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const w = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return { year: y, week: w };
};
