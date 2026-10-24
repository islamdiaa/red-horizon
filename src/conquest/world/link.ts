/**
 * Seeded world links and the Weekly World.
 *
 *   #world=<seed base36>&home=<homeland>&size=world|blitz&diff=<level>[&side=allies|soviet][&iron=1][&fog=1]
 *
 * A link challenges a friend to the same world: the same seed, homeland, size and difficulty give the same run.
 * decodeWorldLink treats the text as untrusted input (any field malformed or unknown -> null).
 * The Weekly World's seed comes from the ISO week; the only clock reading happens at the UI edge, which passes
 * the UTC date parts in (isoWeek).
 */
import { atlas } from './atlas';
import { WORLD_DIFFICULTIES, hashStr, mix, type WorldDifficulty, type WorldSize } from './state';
import type { NewWorldOptions } from './run';

export function encodeWorldLink(o: Pick<NewWorldOptions, 'seed' | 'home' | 'size' | 'difficulty' | 'faction' | 'ironman' | 'fog'>): string {
  const parts = [`world=${(o.seed >>> 0).toString(36)}`, `home=${encodeURIComponent(o.home)}`, `size=${o.size}`, `diff=${o.difficulty}`];
  if (o.faction) parts.push(`side=${o.faction}`);
  if (o.ironman) parts.push('iron=1');
  if (o.fog) parts.push('fog=1');
  return parts.join('&');
}

/** Parse a link's hash ("#world=..." or "world=..."). Null if anything is malformed or unknown. */
export function decodeWorldLink(hash: string): NewWorldOptions | null {
  if (typeof hash !== 'string' || hash.length > 300) return null;
  const q = hash.replace(/^#/, '');
  const get = (k: string): string | null => {
    for (const part of q.split('&')) {
      const i = part.indexOf('=');
      if (i > 0 && part.slice(0, i) === k) {
        try { return decodeURIComponent(part.slice(i + 1)); } catch { return null; }
      }
    }
    return null;
  };
  const w = get('world');
  if (!w || !/^[0-9a-z]{1,7}$/.test(w)) return null;
  const seed = parseInt(w, 36);
  if (!Number.isFinite(seed) || seed < 0 || seed > 0xffffffff) return null;
  const home = get('home');
  if (!home || !/^[a-z0-9-]{1,40}$/.test(home) || !atlas().homelands.some((h) => h.id === home)) return null;
  const size = get('size');
  if (size !== 'world' && size !== 'blitz') return null;
  const diff = get('diff');
  if (!diff || !(WORLD_DIFFICULTIES as string[]).includes(diff)) return null;
  const side = get('side');
  if (side !== null && side !== 'allies' && side !== 'soviet') return null;
  const out: NewWorldOptions = { seed: seed >>> 0, home, size: size as WorldSize, difficulty: diff as WorldDifficulty };
  if (side) out.faction = side;
  if (get('iron') === '1') out.ironman = true;
  if (get('fog') === '1' && (diff === 'hard' || diff === 'brutal')) out.fog = true;
  return out;
}

// =====================================================================================================
// ISO week (pure calendar arithmetic, no Date)
// =====================================================================================================
/** Days since 1970-01-01 of a proleptic Gregorian date (Howard Hinnant's days_from_civil). */
export function daysFromCivil(y: number, m: number, d: number): number {
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** ISO 8601 week of a date (year, month 1-12, day): weeks start on Monday, week 1 holds the year's first Thursday. */
export function isoWeek(y: number, m: number, d: number): { year: number; week: number } {
  const days = daysFromCivil(y, m, d);
  const dow = ((days + 3) % 7 + 7) % 7; // 0 = Monday (1970-01-01 was a Thursday)
  const thursday = days - dow + 3;
  // the ISO year is the year of that Thursday
  let ty = y + 1;
  while (daysFromCivil(ty, 1, 1) > thursday) ty--;
  const week = Math.floor((thursday - daysFromCivil(ty, 1, 1)) / 7) + 1;
  return { year: ty, week };
}

export const weekKey = (year: number, week: number) => `${year}-W${String(week).padStart(2, '0')}`;

export function weeklySeed(year: number, week: number): number {
  return mix(hashStr('rh-weekly-world'), year * 100 + week) >>> 0;
}

/** The Weekly World: the same for everyone (seed, homeland, Blitz on Normal). */
export function weeklyWorld(year: number, week: number): NewWorldOptions {
  const seed = weeklySeed(year, week);
  const homes = atlas().homelands;
  const home = homes[mix(seed, 7) % homes.length].id;
  return { seed, home, size: 'blitz', difficulty: 'normal', weekly: weekKey(year, week) };
}
