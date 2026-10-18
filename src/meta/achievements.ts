/** Medal & achievement catalogue (40 entries, tiered and hidden ones included). */
import type { Metal } from './art';
import { dt, fmtInt, fmtMoney } from '../i18n/core';
import tMeta from '../i18n/en/meta';

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';
export type Category = 'combat' | 'career' | 'economy' | 'campaign' | 'challenge' | 'secret';

export interface AchievementDef {
  id: string;
  title: string;
  /** `{n}` is replaced by the (next) tier threshold. */
  desc: string;
  picto: string;
  category: Category;
  /** Rarity of single-tier achievements (tiered ones use bronze / silver / gold). */
  rarity?: Rarity;
  /** Counter key that drives progress (see MetaTracker counters). */
  counter?: string;
  /** Thresholds: three for bronze / silver / gold, one for a single medal. */
  tiers?: number[];
  hidden?: boolean;
  /** Formats the threshold in descriptions and progress labels. */
  money?: boolean;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  // ---- combat
  { id: 'first-blood', title: 'First Blood', desc: 'Destroy your first enemy unit.', picto: 'crosshair', category: 'combat', rarity: 'common', counter: 'kills', tiers: [1] },
  { id: 'warmonger', title: 'Warmonger', desc: 'Destroy {n} enemy units.', picto: 'skull', category: 'combat', counter: 'kills', tiers: [100, 1000, 5000] },
  { id: 'tank-buster', title: 'Tank Buster', desc: 'Destroy {n} enemy tanks.', picto: 'tank', category: 'combat', counter: 'tanks', tiers: [25, 100, 500] },
  { id: 'big-game', title: 'Big Game Hunter', desc: 'Destroy {n} Mammoth Tanks.', picto: 'mammoth', category: 'combat', rarity: 'rare', counter: 'mammoths', tiers: [10] },
  { id: 'demolition', title: 'Demolition Expert', desc: 'Destroy {n} enemy structures.', picto: 'building', category: 'combat', counter: 'structures', tiers: [25, 250, 1000] },
  { id: 'flak-jacket', title: 'Flak Jacket', desc: 'Shoot down {n} enemy aircraft.', picto: 'plane', category: 'combat', rarity: 'rare', counter: 'aircraft', tiers: [25] },
  { id: 'road-rage', title: 'Road Rage', desc: 'Crush {n} enemy infantry beneath your treads.', picto: 'tread', category: 'combat', rarity: 'rare', counter: 'crushed', tiers: [25] },
  { id: 'one-woman-army', title: 'One-Woman Army', desc: 'Kill {n} enemy infantry with Tanya.', picto: 'pistol', category: 'combat', rarity: 'epic', counter: 'commando', tiers: [50] },
  { id: 'band-of-brothers', title: 'Band of Brothers', desc: 'Promote {n} units to Elite.', picto: 'chevrons', category: 'combat', counter: 'elite', tiers: [1, 10, 50] },
  { id: 'shock-therapy', title: 'Shock Therapy', desc: 'Destroy {n} enemies with Tesla Coils.', picto: 'bolt', category: 'combat', rarity: 'rare', counter: 'tesla', tiers: [100] },
  { id: 'hostile-takeover', title: 'Hostile Takeover', desc: 'Capture {n} enemy structures with Engineers.', picto: 'capture', category: 'combat', counter: 'captures', tiers: [1, 5, 25] },
  { id: 'ace-of-aces', title: 'Ace of Aces', desc: 'Destroy {n} enemies with aircraft.', picto: 'wings', category: 'combat', rarity: 'rare', counter: 'airKills', tiers: [50] },
  { id: 'admiral', title: 'Admiral of the Fleet', desc: 'Sink {n} enemy ships.', picto: 'anchor', category: 'combat', counter: 'ships', tiers: [10, 50, 200] },
  { id: 'silent-service', title: 'Silent Service', desc: 'Sink {n} enemy ships with submarines.', picto: 'periscope', category: 'combat', rarity: 'epic', counter: 'subKills', tiers: [25] },
  { id: 'spymaster', title: 'Spymaster', desc: 'Infiltrate {n} enemy structures with Spies.', picto: 'spy', category: 'combat', counter: 'infiltrations', tiers: [1, 10, 50] },
  { id: 'grand-larceny', title: 'Grand Larceny', desc: 'Steal {n} with Thieves.', picto: 'money', category: 'economy', rarity: 'rare', counter: 'stolen', tiers: [10000], money: true },
  { id: 'airborne', title: 'Airborne', desc: 'Call in {n} air support missions (paratroopers, parabombs, spy planes).', picto: 'parachute', category: 'combat', counter: 'airPowers', tiers: [5, 25, 100] },
  { id: 'minefield', title: 'Minefield', desc: 'Destroy {n} enemy units with mines.', picto: 'mine', category: 'combat', rarity: 'rare', counter: 'mineKills', tiers: [25] },
  { id: 'burn-the-bridges', title: 'Burn the Bridges', desc: 'Watch {n} bridges fall with your forces nearby.', picto: 'bridge', category: 'secret', rarity: 'rare', counter: 'bridges', tiers: [3], hidden: true },
  { id: 'mutually-assured', title: 'Mutually Assured', desc: 'Destroy an enemy structure with an atomic strike.', picto: 'nuke', category: 'combat', rarity: 'epic' },
  { id: 'out-of-time', title: 'Out of Time', desc: 'Chronoshift a tank into an enemy base.', picto: 'chrono', category: 'combat', rarity: 'epic' },
  // ---- career
  { id: 'first-victory', title: 'Baptism of Fire', desc: 'Win your first battle.', picto: 'trophy', category: 'career', rarity: 'common' },
  { id: 'conqueror', title: 'Conqueror', desc: 'Win {n} battles.', picto: 'laurel', category: 'career', counter: 'wins', tiers: [5, 25, 100] },
  { id: 'old-guard', title: 'Old Guard', desc: 'Fight {n} battles.', picto: 'helmet', category: 'career', counter: 'games', tiers: [10, 50, 200] },
  { id: 'iron-will', title: 'Iron Will', desc: 'Defeat a Brutal AI in a skirmish.', picto: 'ironwill', category: 'career', rarity: 'epic' },
  { id: 'untouchable', title: 'Untouchable', desc: 'Win a skirmish without losing a single structure.', picto: 'untouchable', category: 'career', rarity: 'rare' },
  { id: 'blitzkrieg', title: 'Blitzkrieg', desc: 'Win a skirmish in under 10 minutes.', picto: 'stopwatch', category: 'career', rarity: 'rare' },
  { id: 'against-all-odds', title: 'Against All Odds', desc: 'Win a skirmish against three AI opponents.', picto: 'odds', category: 'career', rarity: 'epic' },
  { id: 'riders-on-the-storm', title: 'Riders on the Storm', desc: 'Win a battle fought in a thunderstorm.', picto: 'storm', category: 'career', rarity: 'rare' },
  { id: 'globetrotter', title: 'Globetrotter', desc: 'Fight in every climate: temperate, winter and desert.', picto: 'globe', category: 'career', rarity: 'rare', counter: 'climates', tiers: [3] },
  { id: 'great-wall', title: 'The Great Wall', desc: 'Build a continuous wall of {n} segments.', picto: 'wall', category: 'career', rarity: 'rare', counter: 'wall', tiers: [30] },
  // ---- economy
  { id: 'ore-baron', title: 'Ore Baron', desc: 'Harvest {n} worth of ore.', picto: 'ore', category: 'economy', counter: 'harvested', tiers: [10000, 100000, 1000000], money: true },
  { id: 'scavenger', title: 'Scavenger', desc: 'Collect {n} bonus crates.', picto: 'crate', category: 'economy', counter: 'crates', tiers: [5, 25, 100] },
  // ---- campaign
  { id: 'for-liberty', title: 'For Liberty', desc: 'Complete the Allied campaign.', picto: 'liberty', category: 'campaign', rarity: 'epic' },
  { id: 'for-the-motherland', title: 'For the Motherland', desc: 'Complete the Soviet campaign.', picto: 'motherland', category: 'campaign', rarity: 'epic' },
  { id: 'perfectionist', title: 'Perfectionist', desc: 'Earn three stars on every campaign mission.', picto: 'stars3', category: 'campaign', rarity: 'legendary' },
  // ---- challenge
  { id: 'last-stand', title: 'Last Stand', desc: 'Survive {n} waves in a single Survival run.', picto: 'tower', category: 'challenge', counter: 'bestWave', tiers: [5, 15, 30] },
  { id: 'arcade-legend', title: 'Arcade Legend', desc: 'Score {n} points in a single Survival run.', picto: 'chart', category: 'challenge', counter: 'bestSurvival', tiers: [10000, 40000, 120000] },
  { id: 'giant-slayer', title: 'Giant Slayer', desc: 'Destroy {n} Survival boss waves.', picto: 'sword', category: 'challenge', counter: 'bosses', tiers: [1, 5, 20] },
  { id: 'daily-orders', title: 'Daily Orders', desc: 'Win {n} Daily Challenges.', picto: 'calendar', category: 'challenge', counter: 'dailyWins', tiers: [1, 7, 30] },
  { id: 'dedication', title: 'Dedication', desc: 'Play the Daily Challenge {n} days in a row.', picto: 'streak', category: 'challenge', counter: 'streak', tiers: [3, 7, 30] },
  // scenario challenges, King of the Hill, co-op survival, branching replays
  { id: 'challenger', title: 'Challenger', desc: 'Complete {n} scenario challenges.', picto: 'target', category: 'challenge', counter: 'challenges', tiers: [1, 10, 25] },
  { id: 'textbook', title: 'By the Book', desc: 'Earn three stars on a scenario challenge.', picto: 'stars3', category: 'challenge', rarity: 'rare' },
  { id: 'king-of-the-hill', title: 'King of the Hill', desc: 'Win a King of the Hill skirmish.', picto: 'flag', category: 'challenge', rarity: 'rare' },
  { id: 'brothers-in-arms', title: 'Brothers in Arms', desc: 'Survive {n} waves of co-op Survival alongside AI allies.', picto: 'helmet', category: 'challenge', counter: 'coopWave', tiers: [10] },
  { id: 'alternate-history', title: 'Alternate History', desc: 'Take command from a replay and win the battle.', picto: 'history', category: 'secret', rarity: 'epic', hidden: true },
  // ---- secret
  { id: 'phoenix', title: 'Phoenix', desc: 'Win a battle after losing your Construction Yard.', picto: 'phoenix', category: 'secret', rarity: 'epic', hidden: true },
  { id: 'who-let-the-dogs-out', title: 'Who Let the Dogs Out', desc: 'Attack dogs maul {n} enemy infantry.', picto: 'paw', category: 'secret', rarity: 'rare', counter: 'dogs', tiers: [25], hidden: true },
  { id: 'well-done', title: 'Well Done', desc: 'Burn {n} enemy infantry with flame weapons.', picto: 'fire', category: 'secret', rarity: 'rare', counter: 'burned', tiers: [50], hidden: true },
  { id: 'lightning-war', title: 'Lightning War', desc: 'Win a skirmish in under 6 minutes.', picto: 'lightning', category: 'secret', rarity: 'legendary', hidden: true },
  { id: 'overkill', title: 'Overkill', desc: 'Destroy 8 enemy units or structures with a single atomic strike.', picto: 'mushroom', category: 'secret', rarity: 'epic', hidden: true },
  { id: 'hell-march', title: 'Hell March', desc: 'Defeat three Brutal AIs at once.', picto: 'flames', category: 'secret', rarity: 'legendary', hidden: true },
];

export const ACH_BY_ID: Record<string, AchievementDef> = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));

/** Counters that keep a best value instead of a running total. */
export const MAX_COUNTERS = new Set(['wall', 'bestWave', 'bestSurvival', 'streak', 'climates', 'coopWave']); // coopWave

/** Achievements that depend on each counter (for O(1) checks). */
export const BY_COUNTER: Record<string, AchievementDef[]> = {};
for (const a of ACHIEVEMENTS) if (a.counter) (BY_COUNTER[a.counter] ??= []).push(a);

/** English tier names (display: tierName()). */
export const TIER_NAMES = ['Bronze', 'Silver', 'Gold'];
const TIER_KEYS = ['tier.bronze', 'tier.silver', 'tier.gold'] as const;
/** A medal tier's display name (0 = bronze). */
export const tierName = (t: number): string => tMeta(TIER_KEYS[Math.max(0, Math.min(2, t))]);
/** A rarity's display name. */
export const rarityName = (r: Rarity): string => tMeta(`rarity.${r}`);
/** A medal's display title. */
export const achievementTitle = (a: Pick<AchievementDef, 'id' | 'title'>): string => dt('achievement', a.id, 'title', a.title);
const TIER_XP = [100, 250, 600];
const RARITY_XP: Record<Rarity, number> = { common: 100, rare: 250, epic: 500, legendary: 1000 };
const RARITY_METAL: Record<Rarity, Metal> = { common: 'bronze', rare: 'silver', epic: 'gold', legendary: 'platinum' };
const TIER_METAL: Metal[] = ['bronze', 'silver', 'gold'];

export function isTiered(a: AchievementDef): boolean {
  return (a.tiers?.length ?? 0) > 1;
}
export function tierCount(a: AchievementDef): number {
  return isTiered(a) ? a.tiers!.length : 1;
}
/** XP for reaching tier `t` (0-based). */
export function achievementXp(a: AchievementDef, t = 0): number {
  return isTiered(a) ? TIER_XP[Math.min(t, 2)] : RARITY_XP[a.rarity ?? 'common'];
}
export function achievementMetal(a: AchievementDef, t = 0): Metal {
  return isTiered(a) ? TIER_METAL[Math.min(t, 2)] : RARITY_METAL[a.rarity ?? 'common'];
}
export function achievementRarity(a: AchievementDef, t = 0): Rarity {
  return isTiered(a) ? (['common', 'rare', 'epic'] as Rarity[])[Math.min(t, 2)] : a.rarity ?? 'common';
}
export function fmtThreshold(a: AchievementDef, n: number): string {
  return a.money ? fmtMoney(n) : fmtInt(n);
}
/** Description (translated) with the threshold of tier `t` filled in. */
export function achievementDesc(a: AchievementDef, t = 0): string {
  const n = a.tiers?.[Math.min(t, (a.tiers?.length ?? 1) - 1)] ?? 0;
  return dt('achievement', a.id, 'desc', a.desc, { n: fmtThreshold(a, n) });
}
