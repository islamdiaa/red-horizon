/**
 * How hard each homeland's start is, measured: the share of test campaigns won from it. Source: the homeland-fairness
 * runs of the strategic benchmarks (World and Blitz): Normal difficulty, the zone-focused pilot (casual skill), 20 seeds
 * per homeland and size; overall World 63%, Blitz 51%. Re-measure and update this table when the rules or the map
 * change (tools/world/strat-*.ts fairness run).
 */
export type StartRating = 'easy' | 'medium' | 'hard';

/** Wins out of 20 per homeland: [World, Blitz]. */
const WINS: Record<string, [number, number]> = {
  afghanistan: [6, 8], algeria: [12, 9], arabia: [8, 10], argentina: [13, 11], australia: [16, 16], brazil: [13, 17],
  britain: [18, 8], canada: [12, 7], chile: [15, 11], china: [11, 11], congo: [10, 11], cuba: [13, 12], egypt: [10, 10],
  ethiopia: [10, 11], france: [16, 11], germany: [15, 14], greece: [14, 15], iceland: [16, 9], india: [8, 11],
  indonesia: [19, 10], iran: [8, 9], ireland: [17, 8], italy: [16, 10], japan: [10, 5], 'low-countries': [16, 7],
  mexico: [11, 8], mongolia: [8, 18], morocco: [13, 8], 'new-zealand': [16, 12], nigeria: [12, 9], pakistan: [7, 9],
  peru: [11, 14], philippines: [12, 6], poland: [15, 10], 'south-africa': [14, 12], 'soviet-union': [14, 11],
  spain: [17, 16], sweden: [13, 5], thailand: [7, 11], turkey: [9, 9], ukraine: [16, 11], usa: [12, 6],
  venezuela: [17, 7], vietnam: [7, 9],
};
const SEEDS = 20;
/** The overall win rate per size: a start 15 points or more off it is Easy or Hard. */
const OVERALL = { world: 0.63, blitz: 0.51 } as const;

/** The measured win rate from a homeland at a size, or null (not measured). */
export function startWinRate(home: string, size: 'world' | 'blitz'): number | null {
  const w = WINS[home];
  return w ? w[size === 'world' ? 0 : 1] / SEEDS : null;
}

export function startRating(home: string, size: 'world' | 'blitz'): StartRating | null {
  const r = startWinRate(home, size);
  if (r == null) return null;
  const o = OVERALL[size];
  return r <= o - 0.15 ? 'hard' : r >= o + 0.15 ? 'easy' : 'medium';
}

/** 1-3 bars (1 = easy, 3 = hard) for lists and cards. */
export function startBars(r: StartRating): string {
  const n = r === 'easy' ? 1 : r === 'medium' ? 2 : 3;
  const col = r === 'easy' ? '#8dffb0' : r === 'medium' ? '#ffd34d' : '#ff8a7a';
  let s = '<span class="wc-bars" aria-hidden="true">';
  for (let k = 0; k < 3; k++) s += `<i style="${k < n ? `background:${col}` : ''}"></i>`;
  return s + '</span>';
}
