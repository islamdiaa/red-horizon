/**
 * Daily Challenge generator. Pure and deterministic: the same UTC date always yields the same
 * battlefield, matchup, AI difficulty and modifiers, on every machine. No DOM, no sim imports, so
 * both the mission script (src/missions/special.ts) and the menus can use it.
 */
import { Rng } from '../core/rng';

export type Climate = 'temperate' | 'winter' | 'desert';
export type DailyFaction = 'allies' | 'soviet';
export type DailyDifficulty = 'normal' | 'hard' | 'brutal';

export interface DailyModifierInfo {
  id: string;
  name: string;
  desc: string;
  /** Icon key into MOD_ICONS (inline SVG). */
  icon: string;
  /** Only one modifier per group. */
  group: string;
  /** Eligibility given the already chosen climate / faction. */
  when?: (c: { climate: Climate; faction: DailyFaction }) => boolean;
  /** Score multiplier contribution (harder modifiers are worth more). */
  bonus: number;
}

export const DAILY_MODIFIERS: DailyModifierInfo[] = [
  { id: 'night-ops', name: 'Night Ops', desc: 'Eternal midnight. Fight by floodlight and muzzle flash.', icon: 'moon', group: 'weather', bonus: 0.1 },
  { id: 'blizzard', name: 'Blizzard', desc: 'Whiteout conditions. Frozen ore yields 20% less.', icon: 'snow', group: 'weather', when: (c) => c.climate === 'winter', bonus: 0.15 },
  { id: 'sandstorm', name: 'Sandstorm', desc: 'Choking dust storms. Ore trucks return 15% lighter.', icon: 'dust', group: 'weather', when: (c) => c.climate === 'desert', bonus: 0.12 },
  { id: 'storm-front', name: 'Storm Front', desc: 'A thunderstorm rolls across the battlefield.', icon: 'storm', group: 'weather', when: (c) => c.climate === 'temperate', bonus: 0.05 },
  { id: 'double-ore', name: 'Mother Lode', desc: 'Ore fields are twice as rich for everyone.', icon: 'ore', group: 'economy', bonus: 0 },
  { id: 'lean-times', name: 'Lean Times', desc: 'Every commander starts with only $2,500.', icon: 'coin', group: 'economy', bonus: 0.2 },
  { id: 'credits-rain', name: 'Supply Drops', desc: '+$400 every 30 seconds and crates fall from the sky.', icon: 'crate', group: 'economy', bonus: 0 },
  { id: 'glass-cannons', name: 'Glass Cannons', desc: 'All units fight at 60% of their normal health.', icon: 'glass', group: 'army', bonus: 0.15 },
  { id: 'veteran-start', name: 'Veteran Corps', desc: 'Every unit you field arrives as a Veteran.', icon: 'chevrons', group: 'army', bonus: -0.1 },
  { id: 'fast-production', name: 'War Economy', desc: 'Factories everywhere run at double speed.', icon: 'gear', group: 'tech', bonus: 0 },
  { id: 'no-radar', name: 'Radar Blackout', desc: 'Radar Domes are banned, and with them all high technology.', icon: 'radarOff', group: 'tech', bonus: 0.3 },
  { id: 'tesla-only', name: 'Tesla Doctrine', desc: 'Tesla Coils are the only static defence you may build.', icon: 'bolt', group: 'tech', when: (c) => c.faction === 'soviet', bonus: 0.15 },
  { id: 'pillbox-line', name: 'Pillbox Line', desc: 'Pillboxes are the only static defence you may build.', icon: 'shield', group: 'tech', when: (c) => c.faction === 'allies', bonus: 0.15 },
  { id: 'clear-skies', name: 'Clear Skies', desc: 'No fog of war. Both sides see everything.', icon: 'eye', group: 'intel', bonus: 0 },
  { id: 'fanatics', name: 'Fanatics', desc: 'Enemy factories run 35% faster and harvest 20% more.', icon: 'skull', group: 'enemy', bonus: 0.25 },
  { id: 'bounty', name: 'Bounty Hunter', desc: 'Every enemy unit destroyed pays $100, every structure $300.', icon: 'target', group: 'enemy', bonus: -0.05 },
];
export const MODIFIER_BY_ID: Record<string, DailyModifierInfo> = Object.fromEntries(DAILY_MODIFIERS.map((m) => [m.id, m]));

export interface DailyConfig {
  /** UTC date key, YYYY-MM-DD. */
  day: string;
  /** Sequential challenge number (days since the first daily). */
  number: number;
  seed: number;
  codename: string;
  location: string;
  climate: Climate;
  size: number;
  water: number;
  trees: number;
  ore: number;
  hour: number;
  dayCycle: boolean;
  weather: string;
  fog: boolean;
  faction: DailyFaction;
  enemies: DailyFaction[];
  difficulty: DailyDifficulty;
  credits: number;
  startUnits: 'mcv' | 'light' | 'heavy';
  modifiers: string[];
  /** Final score multiplier (difficulty x modifiers x opponents). */
  multiplier: number;
}

const DIFF_MULT: Record<DailyDifficulty, number> = { normal: 1, hard: 1.4, brutal: 1.9 };

/** UTC date key YYYY-MM-DD. */
export function dayKey(d: Date | number = Date.now()): string {
  const t = typeof d === 'number' ? new Date(d) : d;
  return t.toISOString().slice(0, 10);
}
function dayToMs(day: string): number {
  return Date.parse(day + 'T00:00:00Z');
}
export function shiftDay(day: string, delta: number): string {
  return dayKey(dayToMs(day) + delta * 86400000);
}
export const prevDay = (day: string) => shiftDay(day, -1);
/** Milliseconds until the next daily challenge (UTC midnight). */
export function msUntilNextDaily(now = Date.now()): number {
  const next = dayToMs(dayKey(now)) + 86400000;
  return Math.max(0, next - now);
}
const EPOCH = dayToMs('2026-01-01');
function dailyNumber(day: string): number {
  return Math.max(1, Math.round((dayToMs(day) - EPOCH) / 86400000) + 1);
}

/** FNV-1a string hash. */
function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const ADJ = ['IRON', 'CRIMSON', 'SILENT', 'BROKEN', 'FROZEN', 'BURNING', 'STEEL', 'MIDNIGHT', 'AMBER', 'COBALT', 'SCARLET', 'GHOST', 'THUNDER', 'SHATTERED', 'HOLLOW', 'COLD'];
const NOUN = ['HAMMER', 'TIDE', 'ANVIL', 'SPEAR', 'VIGIL', 'FALCON', 'CURTAIN', 'TEMPEST', 'BASTION', 'LANTERN', 'SERPENT', 'WOLF', 'HARVEST', 'SABRE', 'COMET', 'GAMBIT'];
const PLACES: Record<Climate, string[]> = {
  temperate: ['Rhine Valley', 'Ardennes Forest', 'Bavarian Hills', 'Danube Crossing', 'Polish Lowlands', 'Normandy Hedgerows', 'Black Forest', 'Elbe Floodplain'],
  winter: ['Carpathian Pass', 'Siberian Steppe', 'Murmansk Approaches', 'Finnish Frontier', 'Ural Foothills', 'Kamchatka Ridge'],
  desert: ['Sinai Peninsula', 'Kara-Kum Basin', 'Libyan Plateau', 'Persian Gulf Coast', 'Gobi Outpost', 'Negev Escarpment'],
};

/** The daily challenge for a UTC date (default: today). */
export function dailyConfig(day = dayKey()): DailyConfig {
  const seed = hashStr('rh-daily:' + day);
  const rng = new Rng(seed);
  const climate = rng.pick<Climate>(['temperate', 'temperate', 'winter', 'desert']);
  const faction: DailyFaction = rng.chance(0.5) ? 'allies' : 'soviet';
  const opponents = rng.chance(0.3) ? 2 : 1;
  const enemies: DailyFaction[] = [];
  for (let i = 0; i < opponents; i++) enemies.push(rng.chance(0.65) ? (faction === 'allies' ? 'soviet' : 'allies') : faction);
  let difficulty = rng.pick<DailyDifficulty>(['normal', 'normal', 'hard', 'hard', 'hard', 'brutal']);
  if (opponents > 1 && difficulty === 'brutal') difficulty = 'hard';

  // 2-3 modifiers, one per group
  const count = rng.chance(0.45) ? 3 : 2;
  const pool = rng.shuffle(DAILY_MODIFIERS.filter((m) => !m.when || m.when({ climate, faction })));
  const modifiers: string[] = [];
  const groups = new Set<string>();
  for (const m of pool) {
    if (modifiers.length >= count) break;
    if (groups.has(m.group)) continue;
    groups.add(m.group);
    modifiers.push(m.id);
  }
  modifiers.sort((a, b) => DAILY_MODIFIERS.findIndex((m) => m.id === a) - DAILY_MODIFIERS.findIndex((m) => m.id === b));
  // the harshest tech modifier softens the AI a notch
  if (modifiers.includes('no-radar') && difficulty === 'brutal') difficulty = 'hard';

  const has = (id: string) => modifiers.includes(id);
  let hour = rng.range(8, 16.5);
  let weather = 'auto';
  let dayCycle = true;
  if (has('night-ops')) { hour = 23.2; dayCycle = false; weather = rng.chance(0.4) ? 'fog' : 'clear'; }
  if (has('blizzard')) weather = 'snow';
  if (has('sandstorm')) weather = 'dust';
  if (has('storm-front')) { weather = 'storm'; hour = rng.range(14, 18); }
  const size = opponents > 1 ? rng.pick([80, 96]) : rng.pick([64, 80, 80, 96]);
  const mult = DIFF_MULT[difficulty] * (1 + modifiers.reduce((s, id) => s + (MODIFIER_BY_ID[id]?.bonus ?? 0), 0)) * (opponents > 1 ? 1.35 : 1);

  return {
    day, number: dailyNumber(day), seed: (seed % 900000) + 1000,
    codename: `${rng.pick(ADJ)} ${rng.pick(NOUN)}`,
    location: rng.pick(PLACES[climate]),
    climate, size,
    water: climate === 'desert' ? rng.range(0.05, 0.25) : rng.range(0.25, 0.75),
    trees: rng.range(0.35, 0.8),
    ore: has('double-ore') ? 0.95 : rng.range(0.5, 0.8),
    hour, dayCycle, weather,
    fog: !has('clear-skies'),
    faction, enemies, difficulty,
    credits: has('lean-times') ? 2500 : 7500,
    startUnits: rng.chance(0.6) ? 'light' : 'mcv',
    modifiers,
    multiplier: Math.round(mult * 100) / 100,
  };
}

export const DAILY_DIFFICULTY_MULT = DIFF_MULT;

/**
 * Daily score (deterministic, computed by the mission script):
 * - kills: +5 per unit, +20 per structure (live)
 * - victory: 5000, speed bonus max(0, 4000 - 100 x minutes), losses -25 per unit lost (max -3000)
 * - everything above is multiplied by the challenge multiplier on victory
 * The meta layer adds +500 per medal earned during the match.
 */
export function dailyVictoryScore(cfg: DailyConfig, seconds: number, unitsLost: number): { victory: number; speed: number; losses: number } {
  const minutes = seconds / 60;
  return {
    victory: Math.round(5000 * cfg.multiplier),
    speed: Math.round(Math.max(0, 4000 - 100 * minutes) * cfg.multiplier),
    losses: -Math.min(3000, unitsLost * 25),
  };
}
export const DAILY_MEDAL_BONUS = 500;
