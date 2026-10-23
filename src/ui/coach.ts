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
import { BUILDINGS } from '../data/rules';
import { typeName } from '../i18n/names';
import { fmtMoney } from '../i18n/core';
import type tHints from '../i18n/en/hints';

/** A Field Manual text (src/i18n/en/hints.ts). */
export type HintKey = Parameters<typeof tHints>[0];

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

/** Enemy defences that cut infantry down (tanks are the answer): Flame Tower, Pillbox, Camo Pillbox, Tesla Coil. */
export const ANTI_INFANTRY = new Set(['ftur', 'pbox', 'hbox', 'tsla']);

/** Losses that teach: infantry killed next to an anti-infantry defence, units killed on a plain move order. */
export const DEFENCE_LOSSES = 5;
export const DEFENCE_WINDOW = 150;
export const MOVE_LOSSES = 4;
export const MOVE_WINDOW = 120;
/** "Attack together": this many armed units lost away from the base in the window, for under 40% as many kills. */
export const PIECEMEAL_LOSSES = 10;
export const PIECEMEAL_WINDOW = 240;
/** No Ore Truck left (with a refinery) for this long. */
export const NO_TRUCK_SECS = 15;
/** A structure under half health, out of the fight, for this long (with money for the repair). */
export const DAMAGED_SECS = 25;

/**
 * Closing out a match the player is winning (the UI newcomer of tools/e2e often outlasted Recruit and Easy and timed
 * out at 30 minutes without finishing): from CLOSE_FROM, with at least CLOSE_MIN_ARMED armed units, when the
 * enemies have lost half the most structures they had (and the player's army is worth at least theirs), or when the
 * player's army is worth CLOSE_ADVANTAGE times the enemies' army and armed structures together.
 */
export const CLOSE_FROM = 480;
export const CLOSE_MIN_ARMED = 8;
export const CLOSE_LOST_SHARE = 0.5;
export const CLOSE_ADVANTAGE = 2;
/**
 * Money piling up: this much in the bank for this long, with a barracks or war factory to spend it in, from BANK_FROM
 * (the starting money goes into the base first).
 */
export const BANK_CREDITS = 1500;
export const BANK_SECS = 60;
export const BANK_FROM = 180;
/**
 * Alerts that may come back at Recruit and Easy (gentleLevel) while their condition holds: this many seconds after
 * they were last raised, unless the player dismissed them.
 */
export const CLOSE_REPEAT = 150;
export const BANK_REPEAT = 180;
/** A repeating alert comes at most this many times a match (a player who lets it go three times has heard it). */
export const REPEAT_MAX = 3;

/** Whether this is an enemy structure that keeps its owner in the game (victory counts these: world.checkVictory). */
const counts = (b: { bt: { wall?: unknown; mine?: unknown; tech?: unknown } }) => !b.bt.wall && !b.bt.mine && !b.bt.tech;

/** An enemy structure as the player last saw it. */
export interface KnownStructure { id: number; type: string; owner: number; x: number; y: number; cx: number; cy: number; w: number; h: number }

/**
 * The close-out advice: the enemy is nearly beaten / the player's army is far stronger; 'scout' and 'explore' are
 * the same two when the player knows of no enemy structure to hit (all seen ones are gone / none seen yet).
 */
export type CloseOut = 'finish' | 'advantage' | 'scout' | 'explore';

/** Recruit and Easy: every living enemy AI plays at one of them (a campaign mission: its level). */
export function gentleLevel(w: World, p: Player): boolean {
  if (w.mission) return w.mission.level === 'recruit' || w.mission.level === 'easy';
  const foes = w.ais.filter((ai) => !ai.player.defeated && p.isEnemy(ai.player));
  return foes.length > 0 && foes.every((ai) => ai.difficulty === 'recruit' || ai.difficulty === 'easy');
}

/** Whether any cell of a footprint is in the player's view right now. */
function inView(w: World, p: Player, k: { cx: number; cy: number; w: number; h: number }): boolean {
  if (!w.fog) return true;
  const m = w.map;
  for (let y = k.cy; y < k.cy + k.h; y++) for (let x = k.cx; x < k.cx + k.w; x++) if (m.inBounds(x, y) && p.visible[m.idx(x, y)]) return true;
  return false;
}

/** A match's losses, summed up for the results screen (CoachWatch.lessons). */
export interface Lessons {
  /** Armed units lost in the whole match. */
  armedLost: number;
  /** Of those, lost on a plain move order away from the base. */
  movingLost: number;
  /** Infantry lost next to an enemy anti-infantry defence, and the defence type that killed most. */
  infantryToDefences: number;
  defence: string | null;
}

/** One of the player's armed units lost: where, and what it was doing. */
export interface Loss {
  t: number;
  infantry: boolean;
  /** The anti-infantry defence type next to where it fell (null: none). */
  defence: string | null;
  /** It was on a plain move order (not an attack-move). */
  moving: boolean;
  /** It fell away from the player's base. */
  away: boolean;
}

/** An enemy anti-infantry defence within `r` cells of a point (its type id), else null. */
export function defenceNear(w: World, p: Player, x: number, y: number, r = 7): string | null {
  for (const b of w.buildings) if (b.alive && ANTI_INFANTRY.has(b.bt.id) && p.isEnemy(b.owner) && Math.hypot(b.x - x, b.y - y) <= r) return b.bt.id;
  return null;
}

/** The defence that killed most of the player's infantry in the window, when that happened DEFENCE_LOSSES times. */
export function infantryKiller(losses: readonly Loss[], now: number): string | null {
  const n = new Map<string, number>();
  let total = 0;
  for (const l of losses) if (l.infantry && l.defence && now - l.t <= DEFENCE_WINDOW) { total++; n.set(l.defence, (n.get(l.defence) ?? 0) + 1); }
  if (total < DEFENCE_LOSSES) return null;
  return [...n].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
}

/** Units lost on a plain move order away from the base (they walk past the enemy without fighting). */
export function movingLosses(losses: readonly Loss[], now: number): number {
  return losses.filter((l) => l.moving && l.away && now - l.t <= MOVE_WINDOW).length;
}

/** Attacks beaten one group at a time: many units lost away from home for few kills. */
export function piecemeal(losses: readonly Loss[], now: number, kills: number): boolean {
  const lost = losses.filter((l) => l.away && now - l.t <= PIECEMEAL_WINDOW).length;
  return lost >= PIECEMEAL_LOSSES && kills < 0.4 * lost;
}

/**
 * What the alerts need to remember between checks: the harvest history (income per player over the last 90 s),
 * how long a factory has been idle with money to spend, how long power has been low, the armed units lost (and how),
 * the kills, and how long the player has had no Ore Truck or a badly damaged structure. Call `update` every check
 * (the Hints panel does, about every half second).
 */
export class CoachWatch {
  private income: { t: number; h: number[] }[] = [];
  private idleSince = -1;
  private lowSince = -1;
  private noTruckSince = -1;
  private damagedSince = -1;
  /** The player's armed units at the last check: where they were, and whether on a plain move order. */
  private armed = new Map<number, { x: number; y: number; inf: boolean; move: boolean }>();
  /** Armed units lost over the last few minutes. */
  readonly losses: Loss[] = [];
  /** Kills (units + structures) over time, for the "attack together" comparison. */
  private kills: { t: number; k: number }[] = [];
  /** Whole-match totals for the results screen's advice (see lessons()). */
  private totals = { armed: 0, moving: 0, byDefence: new Map<string, number>() };
  /**
   * Enemy structures the player has seen, where it saw them (like the fog "ghosts" on screen): kept until the player
   * looks at the spot again and finds them gone. The close-out alert points at these only (no fog cheating).
   */
  readonly known = new Map<number, KnownStructure>();
  /** Living enemies' structures (those victory counts): now, and the most they ever had. */
  private foeNow = 0;
  private foePeak = 0;
  private bankSince = -1;

  update(w: World, p: Player) {
    const t = w.time;
    this.watchEnemy(w, p);
    // money piling up with a barracks or war factory to spend it in (busy or not: the bank reminder)
    const bank = p.credits >= BANK_CREDITS && w.buildings.some((b) => b.alive && b.owner === p && (b.bt.factory === 'infantry' || b.bt.factory === 'vehicle'));
    this.bankSince = bank ? (this.bankSince < 0 ? t : this.bankSince) : -1;
    const last = this.income[this.income.length - 1];
    if (!last || t - last.t >= 5) {
      this.income.push({ t, h: w.players.map((o) => o.stats.harvested) });
      while (this.income.length > 2 && t - this.income[1].t >= INCOME_WINDOW) this.income.shift();
      this.kills.push({ t, k: p.stats.unitsKilled + p.stats.buildingsKilled });
      while (this.kills.length > 2 && t - this.kills[1].t >= PIECEMEAL_WINDOW) this.kills.shift();
    }
    // barracks and war factory only (an idle naval yard or airfield is a choice, not a mistake)
    const idle = p.credits >= IDLE_CREDITS && [...idleFactories(w, p, IDLE_CREDITS).keys()].some((k) => k === 'infantry' || k === 'vehicle');
    this.idleSince = idle ? (this.idleSince < 0 ? t : this.idleSince) : -1;
    const low = p.powerUse > 0 && p.lowPower;
    this.lowSince = low ? (this.lowSince < 0 ? t : this.lowSince) : -1;
    // losses: armed units seen last time and gone now (a unit inside a transport or bunker is still alive)
    const seen = new Set<number>();
    let trucks = 0;
    for (const u of w.units) {
      if (!u.alive || u.owner !== p) continue;
      if (u.ut.harvester) { trucks++; continue; }
      if (!u.weapons.length) continue;
      seen.add(u.id);
      this.armed.set(u.id, { x: u.x, y: u.y, inf: u.kind === 'infantry', move: u.order.type === 'move' && !u.order.attackMove });
    }
    for (const [id, s] of this.armed) {
      if (seen.has(id)) continue;
      this.armed.delete(id);
      if (w.getEntity(id)?.alive) continue;
      const l: Loss = { t, infantry: s.inf, defence: s.inf ? defenceNear(w, p, s.x, s.y) : null, moving: s.move, away: !nearBase(w, p, s.x, s.y, 20) };
      this.losses.push(l);
      this.totals.armed++;
      if (l.moving && l.away) this.totals.moving++;
      if (l.defence) this.totals.byDefence.set(l.defence, (this.totals.byDefence.get(l.defence) ?? 0) + 1);
    }
    while (this.losses.length && t - this.losses[0].t > PIECEMEAL_WINDOW) this.losses.shift();
    // no Ore Truck left, with a refinery to deliver to (and none on order)
    const noTruck = trucks === 0 && refineryCount(w, p) > 0 && !p.queues.vehicle.items.some((i) => i.type === 'harv');
    this.noTruckSince = noTruck ? (this.noTruckSince < 0 ? t : this.noTruckSince) : -1;
    // a structure under half health, not being repaired, with no enemy near it, and money for the repair
    const damaged = p.credits >= 300 && w.buildings.some((b) => b.alive && b.owner === p && !b.bt.wall && b.buildAnim >= 1 && b.healthFrac < 0.5 && !b.repairing
      && !w.units.some((u) => u.alive && p.isEnemy(u.owner) && Math.abs(u.x - b.x) < 10 && Math.abs(u.y - b.y) < 10 && (!w.fog || w.canSee(p, u))));
    this.damagedSince = damaged ? (this.damagedSince < 0 ? t : this.damagedSince) : -1;
  }

  /** The enemy structures in sight join `known`; known ones gone (or no longer hostile) are forgotten once in view. */
  private watchEnemy(w: World, p: Player) {
    let n = 0;
    for (const b of w.buildings) {
      if (!b.alive || !counts(b) || !p.isEnemy(b.owner) || b.owner.defeated) continue;
      n++;
      if (w.fog && !w.canSee(p, b)) continue;
      const k = this.known.get(b.id);
      if (k) { k.x = b.x; k.y = b.y; continue; }
      this.known.set(b.id, { id: b.id, type: b.bt.id, owner: b.owner.id, x: b.x, y: b.y, cx: b.cx, cy: b.cy, w: b.w, h: b.h });
    }
    this.foeNow = n;
    this.foePeak = Math.max(this.foePeak, n);
    for (const [id, k] of this.known) {
      const e = w.getEntity(id);
      if (e && e.alive && p.isEnemy(e.owner) && !e.owner.defeated) continue;
      if (inView(w, p, k)) this.known.delete(id);
    }
  }

  /**
   * Whether (and how) to tell the player to finish the enemy (skirmish-like matches): null while the match is still
   * open; 'finish' when the enemies have lost half their structures and the player's army is worth at least theirs;
   * 'advantage' when the player's army is worth CLOSE_ADVANTAGE times the enemies' army and armed structures;
   * 'scout' / 'explore' instead when the player knows of no enemy structure (they must be found first).
   */
  closeOut(w: World, p: Player): CloseOut | null {
    if (w.time < CLOSE_FROM || w.mission) return null;
    let mine = 0, armed = 0, foeArmy = 0, foeDef = 0;
    for (const u of w.units) {
      if (!u.alive || !u.weapons.length || u.ut.harvester) continue;
      if (u.owner === p) { mine += u.ut.cost; armed++; } else if (p.isEnemy(u.owner) && !u.owner.defeated) foeArmy += u.ut.cost;
    }
    if (armed < CLOSE_MIN_ARMED || !this.foeNow) return null;
    for (const b of w.buildings) if (b.alive && b.weapons.length && !b.bt.wall && p.isEnemy(b.owner) && !b.owner.defeated) foeDef += b.bt.cost;
    const finish = this.foePeak >= 4 && this.foeNow <= this.foePeak * (1 - CLOSE_LOST_SHARE) && mine >= foeArmy;
    const ahead = mine >= CLOSE_ADVANTAGE * (foeArmy + foeDef);
    if (!finish && !ahead) return null;
    if (!this.known.size) return finish ? 'scout' : 'explore';
    return finish ? 'finish' : 'advantage';
  }

  /**
   * Up to `n` known enemy structures to attack, nearest to the player's base first (its Construction Yard, else any
   * structure, else its army).
   */
  targets(w: World, p: Player, n = 3): { x: number; y: number }[] {
    let home: { x: number; y: number } | undefined = w.buildings.find((b) => b.alive && b.owner === p && b.bt.id === 'fact') ?? w.buildings.find((b) => b.alive && b.owner === p);
    if (!home) home = w.units.find((u) => u.alive && u.owner === p);
    const hx = home?.x ?? 0, hy = home?.y ?? 0;
    return [...this.known.values()]
      .sort((a, b) => Math.hypot(a.x - hx, a.y - hy) - Math.hypot(b.x - hx, b.y - hy) || a.id - b.id)
      .slice(0, n)
      .map((k) => ({ x: k.x, y: k.y }));
  }

  /** Seconds $1,500+ has sat in the bank with a barracks or war factory to spend it (0 = less). */
  bankFor(w: World): number {
    return this.bankSince < 0 ? 0 : w.time - this.bankSince;
  }

  /** What the whole match taught (the results screen's advice): armed units lost, and how. */
  lessons(): Lessons {
    let defence: string | null = null, n = 0, total = 0;
    for (const [id, k] of [...this.totals.byDefence].sort((a, b) => (a[0] < b[0] ? -1 : 1))) { total += k; if (k > n) { n = k; defence = id; } }
    return { armedLost: this.totals.armed, movingLost: this.totals.moving, infantryToDefences: total, defence };
  }

  /** Kills (units + structures) the player made over the "attack together" window. */
  recentKills(): number {
    const a = this.kills[0], b = this.kills[this.kills.length - 1];
    return a && b ? b.k - a.k : 0;
  }

  /** Seconds without an Ore Truck while owning a refinery (0 = has one). */
  noTruckFor(w: World): number {
    return this.noTruckSince < 0 ? 0 : w.time - this.noTruckSince;
  }

  /** Seconds a structure has stood under half health, out of the fight, unrepaired (0 = none). */
  damagedFor(w: World): number {
    return this.damagedSince < 0 ? 0 : w.time - this.damagedSince;
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
// The Field Manual's situational alerts (src/ui/hints.ts shows them; DOM-free so headless tools can replay a match
// and see which alerts a player would get, and when)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Situational warnings: shown (above the tutorial steps) while `when` holds, at most once per match (alerts that
 * share a `group` count as one), and never sooner than ALERT_GAP seconds after the previous alert appeared.
 */
export interface Alert {
  text: HintKey | ((p: Player, c: CoachWatch, w: World) => HintKey);
  /** Values for the text's placeholders. */
  vars?(w: World, p: Player, c: CoachWatch): Record<string, string>;
  when(w: World, p: Player, c: CoachWatch): boolean;
  group?: string;
  /** Coaching: skirmish-like matches only (not campaign missions)... */
  coach?: boolean;
  /** ...unless this is set: battle and base-keeping lessons hold whatever a mission's script does. */
  mission?: boolean;
  /**
   * May come back at Recruit and Easy (gentleLevel) this many seconds after it was last raised, while its condition
   * holds and unless the player dismissed it (calm reminders for the players who need them most).
   */
  repeat?: number;
  /** Places the alert points at (the Hints panel pings them on the radar and its Show button looks there). */
  targets?(w: World, p: Player, c: CoachWatch): { x: number; y: number }[];
  /**
   * Its trigger reads what the fog hides (the enemy's true army, structures, income, an AI's plans): fine coaching
   * against the computer, an unfair edge against a person, so never raised while a human enemy is in the game.
   */
  hidden?: boolean;
}

/** A living, not surrendered human among the player's enemies (multiplayer, a replay branch against people). */
export function humanFoe(w: World, p: Player): boolean {
  return w.players.some((o) => o !== p && p.isEnemy(o) && o.isHuman && !o.defeated && !o.resigned);
}

// a mission may restrict building, or give no base at all (a commando raid): advice it can't follow stays unsaid
const canReplaceTrucks = (p: Player) => (!p.allowedTypes || p.allowedTypes.has('harv')) && (p.has('weap') || p.canBuild('weap') || p.canBuild('proc'));
const buildsArmy = (p: Player) => p.has('tent') || p.has('barr') || p.has('weap');

/** Seconds between two new alerts. */
export const ALERT_GAP = 60;
/**
 * Seconds an alert stays up at most (it goes sooner once its condition clears). Short on purpose: a lasting condition
 * (still no defences at 9:00) kept its alert up for minutes and held back the coaching that came after it.
 */
export const ALERT_SHOW = 45;

export const ALERTS: Alert[] = [
  // coaching: the first enemy wave is coming and there is nothing to stop it (sooner than the general advice below)
  {
    text: (p) => (p.faction === 'soviet' ? 'alerts.attackSoviet' : 'alerts.attackAllies'),
    group: 'defence',
    coach: true,
    hidden: true, // (an AI's wave orders)
    when: (w, p) => !hasDefences(w, p) && firstWaveIncoming(w, p),
  },
  // coaching from what went wrong (the newcomer's usual mistakes, seen by tools/e2e's play matrix): no Ore Truck
  // left, infantry thrown at defences that roast it, units walking past the enemy on a plain move order, attacks
  // beaten one small group at a time
  {
    text: (p) => (p.has('weap') ? 'alerts.noTrucks' : 'alerts.noTrucksFactory'),
    coach: true,
    mission: true,
    when: (w, p, c) => c.noTruckFor(w) >= NO_TRUCK_SECS && (!w.mission || canReplaceTrucks(p)),
  },
  {
    text: (p) => (p.has('weap') ? 'alerts.infantryDefence' : 'alerts.infantryDefenceFactory'),
    coach: true,
    mission: true,
    vars: (w, _p, c) => { const id = infantryKiller(c.losses, w.time); const b = id ? BUILDINGS[id] : undefined; return { name: b ? typeName(b) : '' }; },
    when: (w, p, c) => !!infantryKiller(c.losses, w.time) && (!w.mission || p.has('weap') || p.canBuild('weap')),
  },
  {
    text: 'alerts.attackMove',
    coach: true,
    mission: true,
    when: (w, _p, c) => movingLosses(c.losses, w.time) >= MOVE_LOSSES,
  },
  {
    text: 'alerts.together',
    coach: true,
    mission: true,
    when: (w, p, c) => piecemeal(c.losses, w.time, c.recentKills()) && (!w.mission || buildsArmy(p)),
  },
  {
    text: 'alerts.storage',
    when: (_w, p) => p.storage > 0 && p.ore >= p.storage - 1,
  },
  {
    text: 'alerts.defences',
    group: 'defence',
    coach: true, // (skirmish advice: a mission's script decides whether defences are the answer)
    when: (w, p) => w.time > 210 && w.time < 600 && !hasDefences(w, p) && w.buildings.some((b) => b.alive && b.owner === p && b.bt.id === 'proc'),
  },
  // coaching: low power, idle factories, the economy
  {
    text: 'alerts.power',
    coach: true,
    mission: true,
    when: (w, _p, c) => c.lowPowerFor(w) >= LOW_POWER_SECS,
  },
  {
    text: 'alerts.idle',
    coach: true,
    mission: true,
    when: (w, _p, c) => c.idleFor(w) >= IDLE_SECS,
  },
  // coaching: money piling up (the UI newcomer kept $1,000+ in the bank 40-90% of the time): loop a unit card, or,
  // with loops running and the money still growing, a second factory (each extra one builds faster)
  {
    text: (p) => (p.repeat.length ? 'alerts.bankFactory' : 'alerts.bankLoop'),
    coach: true,
    mission: true,
    repeat: BANK_REPEAT,
    vars: (_w, p) => ({ money: fmtMoney(Math.floor(p.credits / 100) * 100) }),
    when: (w, p, c) => w.time >= BANK_FROM && c.bankFor(w) >= BANK_SECS && (!w.mission || buildsArmy(p)),
  },
  // coaching: the enemy is nearly beaten (or far weaker): finish it with everything, at the structures the player
  // has seen (skirmish-like matches; a mission's script decides how it ends)
  {
    text: (p, c, w) => { const k = c.closeOut(w, p); return k === 'scout' ? 'alerts.closeScout' : k === 'explore' ? 'alerts.closeExplore' : k === 'advantage' ? 'alerts.closeAdvantage' : 'alerts.closeFinish'; },
    coach: true,
    hidden: true, // (the enemy's true army and structure count)
    repeat: CLOSE_REPEAT,
    targets: (w, p, c) => c.targets(w, p),
    when: (w, p, c) => !!c.closeOut(w, p),
  },
  {
    text: 'alerts.refinery',
    coach: true,
    when: (w, p) => { const n = refineryCount(w, p); return secondRefineryDue(w.time, n, n === 1 ? oreNearRefineries(w, p) : 0); },
  },
  {
    text: 'alerts.income',
    coach: true,
    hidden: true, // (the enemy's true income)
    when: (w, p, c) => c.enemyOutEarning(w, p),
  },
  {
    text: 'alerts.repair',
    coach: true,
    mission: true,
    when: (w, _p, c) => c.damagedFor(w) >= DAMAGED_SECS,
  },
  // Commander economy (sim/economy.ts)
  {
    text: 'alerts.tier2',
    when: (w, p) => !!p.econ && p.econ.tier === 1 && w.time > 240 && p.credits >= 1000 && p.has('proc') && (p.has('tent') || p.has('barr')) && !w.buildings.some((b) => b.owner === p && b.task),
  },
  {
    text: 'alerts.research',
    when: (w, p) => !!p.econ && !Object.keys(p.econ.levels).length && w.buildings.some((b) => b.alive && b.owner === p && b.bt.id === 'rlab' && b.buildAnim >= 1 && !b.task),
  },
];

/**
 * Which alert is up: the current one while its condition holds (ALERT_SHOW seconds at most); otherwise the first
 * alert not shown yet whose condition holds (alerts of one group count as one), at most one new alert every ALERT_GAP
 * seconds.
 */
export class AlertQueue {
  /** Alerts raised so far (index -> still showing). */
  private shown = new Map<number, boolean>();
  private groups = new Set<string>();
  /** When the last alert was raised (world seconds). */
  private last = -1e9;
  /** When each alert was last raised and how often, and the ones the player dismissed (those never repeat). */
  private raisedAt = new Map<number, number>();
  private raised = new Map<number, number>();
  private dismissed = new Set<number>();
  /** The alert showing (index into ALERTS), or -1. */
  current = -1;

  /** The player dismissed the alert on show. */
  dismiss() {
    if (this.current >= 0) { this.shown.set(this.current, false); this.dismissed.add(this.current); }
    this.current = -1;
  }

  /** The Field Manual was switched off: the alert on show goes (as if it had run its time). */
  hide() {
    if (this.current >= 0) this.shown.set(this.current, false);
    this.current = -1;
  }

  /** Whether alert i may be raised now (not shown yet, or a repeat that is due). */
  private due(i: number, w: World, p: Player): boolean {
    const a = ALERTS[i];
    if (!this.shown.has(i)) return !(a.group && this.groups.has(a.group));
    return !!a.repeat && !this.dismissed.has(i) && (this.raised.get(i) ?? 0) < REPEAT_MAX && w.time - (this.raisedAt.get(i) ?? 0) >= a.repeat && gentleLevel(w, p);
  }

  /**
   * The alert to show now (-1: none) and whether it was just raised. `coach`: coaching alerts are allowed ('mission':
   * only those marked `mission`).
   */
  update(w: World, p: Player, c: CoachWatch, coach: boolean | 'mission'): { idx: number; fresh: boolean } {
    if (this.current >= 0) {
      if (this.shown.get(this.current) && w.time - this.last < ALERT_SHOW && ALERTS[this.current].when(w, p, c)) return { idx: this.current, fresh: false };
      this.shown.set(this.current, false);
      this.current = -1;
    }
    const people = humanFoe(w, p);
    for (let i = 0; i < ALERTS.length && w.time - this.last >= ALERT_GAP; i++) {
      const a = ALERTS[i];
      if (a.hidden && people) continue;
      if ((a.coach && (!coach || (coach === 'mission' && !a.mission))) || !this.due(i, w, p) || !a.when(w, p, c)) continue;
      this.shown.set(i, true);
      if (a.group) this.groups.add(a.group);
      this.last = w.time;
      this.raisedAt.set(i, w.time);
      this.raised.set(i, (this.raised.get(i) ?? 0) + 1);
      this.current = i;
      return { idx: i, fresh: true };
    }
    return { idx: -1, fresh: false };
  }
}

/**
 * Whether coaching applies to the player now: not once the match is over or the player is out of it (defeated, or
 * surrendered: a team game hands the side to an AI, sim/resign.ts, and the alerts would be about the AI's units);
 * in a campaign mission only the alerts marked `mission`.
 */
export function coachMode(w: World, p: Player): boolean | 'mission' {
  if (w.gameOver || p.defeated || p.resigned || !p.isHuman) return false;
  return w.mission ? 'mission' : true;
}

/**
 * One check of the Hints panel (DOM-free): the watch follows the match whenever coaching applies, also while the
 * Field Manual is switched off (else turning it back on would count every loss since as just now and raise stale
 * alerts, and the results advice would miss them); alerts only while it is on.
 */
export function coachTick(c: CoachWatch, q: AlertQueue, w: World, p: Player, enabled: boolean): { idx: number; fresh: boolean } {
  const mode = coachMode(w, p);
  if (mode) c.update(w, p);
  if (!enabled) { q.hide(); return { idx: -1, fresh: false }; }
  return q.update(w, p, c, mode);
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

export type EconomyTip = 'income' | 'army' | 'defendAllies' | 'defendSoviet' | 'tanks' | 'attackMove' | 'close' | 'won';

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
 *   (with the match's lessons) 8+ soldiers, at least a third of the losses, fell to enemy defences -> tanks;
 *   (with the match's lessons) 6+ units, at least a quarter of the losses, fell on a plain move order -> attack-move;
 *   the enemy's peak army 1.4x yours (and $1,500 more) -> keep factories busy, spend the money;
 *   otherwise -> a close fight: keep the army together.
 */
export function economyAdvice(f: EconomyFacts, lessons?: Lessons | null): { tip: EconomyTip; ratio: number } | null {
  const ratio = f.foe.harvested / Math.max(1, f.you.harvested);
  if (f.won) {
    const close = f.foe.harvested >= 0.75 * f.you.harvested || f.foe.peakArmy >= 0.75 * f.you.peakArmy;
    return close ? { tip: 'won', ratio } : null;
  }
  if (ratio >= 1.4 && f.foe.harvested - f.you.harvested >= 1500) return { tip: 'income', ratio };
  if (f.time < 720 && f.you.peakDefences <= 1) return { tip: f.faction === 'soviet' ? 'defendSoviet' : 'defendAllies', ratio };
  if (lessons && lessons.infantryToDefences >= 8 && lessons.infantryToDefences * 3 >= lessons.armedLost) return { tip: 'tanks', ratio };
  if (lessons && lessons.movingLost >= 6 && lessons.movingLost * 4 >= lessons.armedLost) return { tip: 'attackMove', ratio };
  if (f.foe.peakArmy >= 1.4 * Math.max(1, f.you.peakArmy) && f.foe.peakArmy - f.you.peakArmy >= 1500) return { tip: 'army', ratio };
  return { tip: 'close', ratio };
}
