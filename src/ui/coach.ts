/**
 * Coaching, DOM-free: the conditions behind the Field Manual's skirmish alerts (ui/hints.ts) and the results
 * screen's economy suggestion (ui/results.ts), so a player who loses can see why.
 *
 * Read-only: nothing here changes the world (the alerts only read players, buildings, the map and the AIs' public
 * state), and nothing here is part of a save or replay.
 */
import type { Player } from '../sim/player';
import type { World } from '../sim/world';
import type { ReportSample } from '../meta/report';
import { idleFactories } from './army';

// ---------------------------------------------------------------------------------------------------------------
// In-match alerts
// ---------------------------------------------------------------------------------------------------------------

/** Seconds of harvest history the income comparison looks at, and the least it needs. */
export const INCOME_WINDOW = 90;
const INCOME_MIN_SPAN = 75;
/** A factory idle this long with this much money gets the "keep units queued" alert. */
export const IDLE_SECS = 40;
export const IDLE_CREDITS = 1000;
/** Low power for this long gets the "build a Power Plant" alert. */
export const LOW_POWER_SECS = 20;

/** A defensive structure: anything armed that isn't a wall (the existing "no defences" alert's notion). */
export function hasDefences(w: World, p: Player): boolean {
  return w.buildings.some((b) => b.alive && b.owner === p && !b.bt.wall && !!b.bt.primary);
}

/** Ore Refineries plus Commander Mining Outposts (both dock Ore Trucks). */
export function refineryCount(w: World, p: Player): number {
  let n = 0;
  for (const b of w.buildings) if (b.alive && b.owner === p && (b.bt.id === 'proc' || b.bt.id === 'mout')) n++;
  return n;
}

/** Whether the enemy's income (per minute) is far above the player's: at least 1.6 times and $500 a minute more. */
export function incomeGap(mine: number, richest: number): boolean {
  return richest >= 1.6 * Math.max(0, mine) && richest - mine >= 500;
}

/** The refinery alert's window: from 6:00, while the player still has exactly one refinery (and ore to mine). */
export function secondRefineryDue(time: number, refineries: number, oreNearby: number): boolean {
  return time >= 360 && time < 600 && refineries === 1 && oreNearby >= 100;
}

/** Ore bails within `r` cells of the player's refineries (enough left to make a second one worth it?). */
export function oreNearRefineries(w: World, p: Player, r = 18): number {
  const m = w.map;
  let n = 0;
  for (const b of w.buildings) {
    if (!b.alive || b.owner !== p || (b.bt.id !== 'proc' && b.bt.id !== 'mout')) continue;
    const fx = Math.floor(b.x), fy = Math.floor(b.y);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (m.inBounds(fx + dx, fy + dy)) n += m.ore[m.idx(fx + dx, fy + dy)];
    if (n >= 100) break;
  }
  return n;
}

/** Whether a point is within `r` cells of one of the player's structures. */
export function nearBase(w: World, p: Player, x: number, y: number, r = 30): boolean {
  return w.buildings.some((b) => b.alive && b.owner === p && Math.hypot(b.x - x, b.y - y) <= r);
}

/**
 * An enemy AI's first attack wave is under way towards the player: it launched exactly one wave, is attacking, and
 * the wave's target (its radio chatter) is the player's base (or unknown).
 */
export function firstWaveIncoming(w: World, p: Player): boolean {
  for (const ai of w.ais) {
    if (ai.waves !== 1 || ai.state !== 'attack' || ai.player.defeated || !p.isEnemy(ai.player)) continue;
    let last: { x?: number; y?: number } | undefined;
    for (let i = ai.chatter.length - 1; i >= 0; i--) if (ai.chatter[i].kind === 'attack') { last = ai.chatter[i]; break; }
    if (!last || last.x === undefined || last.y === undefined || nearBase(w, p, last.x, last.y)) return true;
  }
  return false;
}

/**
 * What the alerts need to remember between checks: the harvest history (income per player over the last 90 s),
 * how long a factory has been idle with money to spend, and how long power has been low. Call `update` every
 * check (the Hints panel does, about every half second).
 */
export class CoachWatch {
  private income: { t: number; h: number[] }[] = [];
  private idleSince = -1;
  private lowSince = -1;

  update(w: World, p: Player) {
    const t = w.time;
    const last = this.income[this.income.length - 1];
    if (!last || t - last.t >= 5) {
      this.income.push({ t, h: w.players.map((o) => o.stats.harvested) });
      while (this.income.length > 2 && t - this.income[1].t >= INCOME_WINDOW) this.income.shift();
    }
    // barracks and war factory only (an idle naval yard or airfield is a choice, not a mistake)
    const idle = p.credits >= IDLE_CREDITS && [...idleFactories(w, p, IDLE_CREDITS).keys()].some((k) => k === 'infantry' || k === 'vehicle');
    this.idleSince = idle ? (this.idleSince < 0 ? t : this.idleSince) : -1;
    const low = p.powerUse > 0 && p.lowPower;
    this.lowSince = low ? (this.lowSince < 0 ? t : this.lowSince) : -1;
  }

  /** Income in $ per minute of every player over the window, or null while there is not enough history. */
  incomeRates(): number[] | null {
    const a = this.income[0], b = this.income[this.income.length - 1];
    if (!a || !b || b.t - a.t < INCOME_MIN_SPAN) return null;
    const dt = b.t - a.t;
    return b.h.map((h, i) => (Math.max(0, h - (a.h[i] ?? 0)) / dt) * 60);
  }

  /** The richest living enemy's income is far above the player's (after 4:00). */
  enemyOutEarning(w: World, p: Player): boolean {
    if (w.time < 240) return false;
    const r = this.incomeRates();
    if (!r) return false;
    let richest = 0;
    for (const o of w.players) if (o !== p && !o.defeated && p.isEnemy(o)) richest = Math.max(richest, r[o.id] ?? 0);
    return incomeGap(r[p.id] ?? 0, richest);
  }

  /** Seconds a barracks or war factory has stood idle with $1,000+ in the bank (0 = busy). */
  idleFor(w: World): number {
    return this.idleSince < 0 ? 0 : w.time - this.idleSince;
  }

  /** Seconds power has been low (0 = fine). */
  lowPowerFor(w: World): number {
    return this.lowSince < 0 ? 0 : w.time - this.lowSince;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Results screen: the economy comparison and one suggestion
// ---------------------------------------------------------------------------------------------------------------

export interface EconomySide {
  /** Money harvested over the match. */
  harvested: number;
  /** Highest army value at any sample. */
  peakArmy: number;
}

export interface EconomyFacts {
  won: boolean;
  /** Match length, seconds. */
  time: number;
  faction: 'allies' | 'soviet';
  you: EconomySide & { peakDefences: number };
  /** The strongest enemy (most harvested). */
  foe: EconomySide;
}

export type EconomyTip = 'income' | 'army' | 'defendAllies' | 'defendSoviet' | 'close' | 'won';

/**
 * The facts for the local player and their strongest enemy (the one who harvested most) from the battle report's
 * samples, with the final harvest totals. Null without an enemy or samples.
 */
export function economyFacts(o: {
  samples: readonly ReportSample[]; me: number; foes: readonly number[]; harvested: readonly number[]; won: boolean; time: number; faction: 'allies' | 'soviet';
}): EconomyFacts | null {
  if (!o.foes.length || o.samples.length < 2) return null;
  const peak = (i: number, pick: (s: ReportSample['players'][number]) => number) => o.samples.reduce((m, s) => Math.max(m, s.players[i] ? pick(s.players[i]) : 0), 0);
  const foe = o.foes.reduce((a, b) => ((o.harvested[b] ?? 0) > (o.harvested[a] ?? 0) ? b : a));
  return {
    won: o.won, time: o.time, faction: o.faction,
    you: { harvested: o.harvested[o.me] ?? 0, peakArmy: peak(o.me, (s) => s.army), peakDefences: peak(o.me, (s) => s.defences ?? 0) },
    foe: { harvested: o.harvested[foe] ?? 0, peakArmy: peak(foe, (s) => s.army) },
  };
}

/**
 * Whether to show the economy block and which suggestion: always after a defeat, after a victory only when it
 * was close (the enemy reached three quarters of your harvest or army). The first rule that fits:
 *   won -> a short positive line;
 *   the enemy harvested 1.4x as much (and $1,500 more) -> refineries and Ore Trucks;
 *   lost before 12:00 with at most one defensive structure -> defences before the first attack;
 *   the enemy's peak army 1.4x yours (and $1,500 more) -> keep factories busy, spend the money;
 *   otherwise -> a close fight: keep the army together.
 */
export function economyAdvice(f: EconomyFacts): { tip: EconomyTip; ratio: number } | null {
  const ratio = f.foe.harvested / Math.max(1, f.you.harvested);
  if (f.won) {
    const close = f.foe.harvested >= 0.75 * f.you.harvested || f.foe.peakArmy >= 0.75 * f.you.peakArmy;
    return close ? { tip: 'won', ratio } : null;
  }
  if (ratio >= 1.4 && f.foe.harvested - f.you.harvested >= 1500) return { tip: 'income', ratio };
  if (f.time < 720 && f.you.peakDefences <= 1) return { tip: f.faction === 'soviet' ? 'defendSoviet' : 'defendAllies', ratio };
  if (f.foe.peakArmy >= 1.4 * Math.max(1, f.you.peakArmy) && f.foe.peakArmy - f.you.peakArmy >= 1500) return { tip: 'army', ratio };
  return { tip: 'close', ratio };
}
