/**
 * [JUICE] Mix policy for big battles: every SFX key gets a priority tier and a category, so a 100-unit fight
 * stays readable instead of turning to mush.
 *
 *  - Voice stealing: when the voice budget is full, a new sound may only replace a voice of a lower tier (or
 *    an equal tier that is quieter / nearly finished); small arms never cut off a tank gun or an explosion.
 *  - Category caps: at most SMALL_ARMS_CAP small-arms voices at once (rifles, MGs, pistols, bullet hits).
 *  - Ducking: big guns and big explosions duck the small-arms sub-bus for a moment (see AudioSystem).
 *
 * Pure functions (no Web Audio) so the policy is unit-tested in node (tests/juice.test.ts).
 */
import type { AnyKey } from './sfx';

/** 0 ambient detail · 1 small arms · 2 medium weapons / small blasts · 3 big guns / big blasts / kills · 4 critical. */
export type Tier = 0 | 1 | 2 | 3 | 4;

const SMALL = new Set<string>(['pistol', 'rifle', 'mg', 'expl_piff', 'dog_attack', 'dog_bark', 'flak', 'heal']);
const BIG = new Set<string>([
  'cannon_heavy', 'artillery', 'naval_gun', 'tesla_zap', 'expl_large', 'expl_huge', 'expl_building', 'vehicle_die',
  'kill_armor', 'kill_heavy', 'bridge_collapse', 'mad_pulse', 'depth_charge', 'torpedo',
]);
const CRITICAL = new Set<string>([
  'expl_nuke', 'nuke_launch', 'chrono', 'iron_curtain', 'satellite_launch', 'promote', 'click', 'hover', 'error', 'tab',
  'ready_ping', 'cash_tick', '_chirp', '_radio', '_rankup', 'crate', 'build_place', 'sell', 'infiltrate',
]);
const AMBIENT = new Set<string>(['harvest', 'door', 'build_rise', 'repair', 'ore_dump', 'metal_groan', 'debris_rain']);

/** Priority tier of a key. */
export function sfxTier(key: AnyKey | string): Tier {
  if (CRITICAL.has(key)) return 4;
  if (BIG.has(key)) return 3;
  if (SMALL.has(key)) return 1;
  if (AMBIENT.has(key)) return 0;
  return 2;
}

/** Small-arms category (shares one voice cap and the ducked sub-bus). */
export function isSmallArms(key: AnyKey | string): boolean {
  return SMALL.has(key);
}

/** Sounds that duck the small arms when they start. */
export function ducksSmallArms(key: AnyKey | string): boolean {
  return BIG.has(key) || key === 'expl_nuke' || key === 'cannon_med';
}

/** Simultaneous small-arms voices at most. */
export const SMALL_ARMS_CAP = 10;
/** Total SFX voice budget. */
export const VOICE_BUDGET = 40;
/** Small-arms bus gain while ducked, and how long the duck holds (s) before releasing. */
export const DUCK_LEVEL = 0.42;
export const DUCK_HOLD = 0.18;

/** What the allocator needs to know about a playing voice. */
export interface VoiceInfo {
  tier: number;
  vol: number;
  start: number;
  end: number;
  stopping: boolean;
}

/**
 * Pick the voice to steal for a new sound of `tier` at volume `vol` (index into `voices`), or -1 when the
 * new sound should be dropped instead. Lower tiers go first; within a tier, the quietest / most finished.
 */
export function pickVictim(voices: readonly VoiceInfo[], tier: number, vol: number, now: number): number {
  let best = -1;
  let bestScore = Infinity;
  for (let i = 0; i < voices.length; i++) {
    const v = voices[i];
    if (v.stopping || v.tier > tier) continue;
    const remaining = Math.min(1, Math.max(0, (v.end - now) / Math.max(0.05, v.end - v.start)));
    // a lower tier always loses to a higher one; within the tier, weakest audible contribution loses
    const score = v.tier * 10 + v.vol * (0.3 + 0.7 * remaining);
    if (score < bestScore) { bestScore = score; best = i; }
  }
  if (best < 0) return -1;
  const v = voices[best];
  if (v.tier === tier) {
    const remaining = Math.min(1, Math.max(0, (v.end - now) / Math.max(0.05, v.end - v.start)));
    if (vol < v.vol * (0.3 + 0.7 * remaining)) return -1; // quieter than everything of its tier: skip
  }
  return best;
}

/** Running mix statistics (diagnostics: `audio.mixStats`). */
export interface MixStats {
  /** Voices playing now / the most at once since the last reset. */
  active: number;
  peak: number;
  /** Small-arms voices playing now / peak. */
  small: number;
  smallPeak: number;
  /** Sounds requested, started, merged into a voice already playing, culled by distance, dropped by the budget, voices stolen. */
  requested: number;
  started: number;
  merged: number;
  culled: number;
  dropped: number;
  stolen: number;
  /** Times the small arms were ducked under a big gun / explosion, and low-pass thumps. */
  ducks: number;
  thumps: number;
}

export function newMixStats(): MixStats {
  return { active: 0, peak: 0, small: 0, smallPeak: 0, requested: 0, started: 0, merged: 0, culled: 0, dropped: 0, stolen: 0, ducks: 0, thumps: 0 };
}
