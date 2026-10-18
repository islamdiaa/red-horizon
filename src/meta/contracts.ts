/**
 * Contracts: three daily and three weekly goals ("orders") that rotate deterministically with the UTC date,
 * so every commander gets the same orders on the same day. Each pays XP and Commendations (an earned,
 * never-purchasable currency spent in the Locker). Missing them costs nothing: the next day simply brings
 * new orders. One free reroll per day swaps an unfinished contract for another of the same kind.
 *
 * Progress comes from metric events fed by the MetaTracker (src/meta/index.ts) during skirmishes, campaign
 * missions, Conquest battles, the daily challenge, survival and scenario challenges; each contract says
 * which of those count. Pure logic (no DOM, no storage): node tests drive it with synthetic events.
 *
 * Rewards are granted exactly once: applyContractEvent() reports a slot only on the event that completes
 * it (its `done` flag flips once), and the caller pays out for exactly those slots.
 */
import { Rng } from '../core/rng';
import { dayKey } from './daily';
import { currentLang, dt, fmtInt, fmtMoney } from '../i18n/core';
import tMeta from '../i18n/en/meta';

export type ContractMode = 'skirmish' | 'campaign' | 'conquest' | 'daily' | 'survival' | 'challenge' | 'other';
export type Cadence = 'daily' | 'weekly';
export type ContractGroup = 'combat' | 'victory' | 'ops';

export interface ContractDef {
  id: string;
  title: string;
  /** `{n}` is replaced by the target. */
  desc: string;
  picto: string;
  /** Metric key the MetaTracker reports (see MetaTracker.progress). */
  metric: string;
  /** 'sum' adds amounts (default), 'max' keeps the best single value, 'set' counts distinct keys. */
  kind?: 'sum' | 'max' | 'set';
  /** Targets offered at each cadence (missing = not offered). */
  daily?: number[];
  weekly?: number[];
  /** Modes where progress counts (default: all tracked battles). */
  modes?: ContractMode[];
  money?: boolean;
  /** Draw weight (default 1). */
  weight?: number;
  /** Reward multiplier for harder orders (default 1). */
  effort?: number;
  group: ContractGroup;
}

const BATTLES: ContractMode[] = ['skirmish', 'campaign', 'conquest', 'daily'];
const FIGHTS: ContractMode[] = ['skirmish', 'campaign', 'conquest', 'daily', 'survival'];

export const CONTRACTS: ContractDef[] = [
  // ---- combat: what you destroy
  { id: 'tank-hunter', title: 'Tank Hunter', desc: 'Destroy {n} enemy tanks.', picto: 'tank', metric: 'tanks', daily: [10, 15], weekly: [60], group: 'combat', weight: 1.4 },
  { id: 'clean-sweep', title: 'Clean Sweep', desc: 'Destroy {n} enemy infantry.', picto: 'helmet', metric: 'infantry', daily: [30, 45], weekly: [200], group: 'combat' },
  { id: 'demolition-crew', title: 'Demolition Crew', desc: 'Destroy {n} enemy structures.', picto: 'building', metric: 'structures', daily: [8, 12], weekly: [50], group: 'combat', weight: 1.2 },
  { id: 'body-count', title: 'Body Count', desc: 'Destroy {n} enemy units.', picto: 'skull', metric: 'kills', daily: [60, 90], weekly: [350], group: 'combat' },
  { id: 'flak-alley', title: 'Flak Alley', desc: 'Shoot down {n} enemy aircraft.', picto: 'plane', metric: 'aircraft', daily: [4], weekly: [20], group: 'combat', weight: 0.6, effort: 1.2 },
  { id: 'sink-the-fleet', title: 'Sink the Fleet', desc: 'Sink {n} enemy ships.', picto: 'anchor', metric: 'ships', weekly: [12], group: 'combat', weight: 0.5, effort: 1.2 },
  { id: 'field-promotions', title: 'Field Promotions', desc: 'Promote {n} of your units to Elite.', picto: 'chevrons', metric: 'elite', daily: [3], weekly: [12], group: 'combat', weight: 0.8 },
  // ---- victory: how you win
  { id: 'for-the-alliance', title: 'For the Alliance', desc: 'Win {n} battle(s) as the Allies.', picto: 'liberty', metric: 'win.allies', daily: [1], weekly: [4], modes: BATTLES, group: 'victory' },
  { id: 'for-the-union', title: 'For the Union', desc: 'Win {n} battle(s) as the Soviets.', picto: 'motherland', metric: 'win.soviet', daily: [1], weekly: [4], modes: BATTLES, group: 'victory' },
  { id: 'green-fields', title: 'Green Fields', desc: 'Win a battle on a temperate battlefield.', picto: 'globe', metric: 'win.temperate', daily: [1], modes: BATTLES, group: 'victory', weight: 0.8 },
  { id: 'winter-war', title: 'Winter War', desc: 'Win a battle on a winter battlefield.', picto: 'globe', metric: 'win.winter', daily: [1], modes: BATTLES, group: 'victory', weight: 0.8 },
  { id: 'desert-fox', title: 'Desert Fox', desc: 'Win a battle on a desert battlefield.', picto: 'globe', metric: 'win.desert', daily: [1], modes: BATTLES, group: 'victory', weight: 0.8 },
  { id: 'blitz', title: 'Blitz', desc: 'Win {n} battle(s) in under 15 minutes.', picto: 'stopwatch', metric: 'win.fast', daily: [1], weekly: [3], modes: BATTLES, group: 'victory', effort: 1.2 },
  { id: 'hard-target', title: 'Hard Target', desc: 'Win {n} skirmish(es) against a Hard or Brutal AI.', picto: 'ironwill', metric: 'win.hard', daily: [1], weekly: [3], modes: ['skirmish'], group: 'victory', effort: 1.3 },
  { id: 'band-of-veterans', title: 'Band of Veterans', desc: 'Win a battle with 5 or more Elite units still standing.', picto: 'chevrons', metric: 'win.elite', daily: [1], modes: BATTLES, group: 'victory', weight: 0.7, effort: 1.3 },
  { id: 'not-a-scratch', title: 'Not a Scratch', desc: 'Win a skirmish without losing a structure.', picto: 'untouchable', metric: 'win.untouched', daily: [1], modes: ['skirmish'], group: 'victory', weight: 0.7, effort: 1.2 },
  { id: 'winning-streak', title: 'Field Commander', desc: 'Win {n} battles.', picto: 'laurel', metric: 'win', daily: [2], weekly: [6], modes: BATTLES, group: 'victory' },
  { id: 'world-tour', title: 'World Tour', desc: 'Win on all three climates: temperate, winter and desert.', picto: 'globe', metric: 'win.climate', kind: 'set', weekly: [3], modes: BATTLES, group: 'victory', effort: 1.2 },
  { id: 'both-sides', title: 'Both Sides of the Curtain', desc: 'Win as the Allies and as the Soviets.', picto: 'flag', metric: 'win.faction', kind: 'set', weekly: [2], modes: BATTLES, group: 'victory' },
  { id: 'settle-the-score', title: 'Settle the Score', desc: 'Beat {n} rival commander(s) in a skirmish.', picto: 'skull', metric: 'rival', daily: [1], weekly: [3], modes: ['skirmish'], group: 'victory', weight: 0.8, effort: 1.2 },
  // ---- operations: everything else that makes a commander
  { id: 'iron-fist', title: 'Iron Fist', desc: 'Field an army worth {n}.', picto: 'tank', metric: 'army', kind: 'max', daily: [15000, 20000], weekly: [30000], money: true, modes: FIGHTS, group: 'ops', weight: 1.3 },
  { id: 'hostile-takeover', title: 'Hostile Takeover', desc: 'Capture {n} enemy structure(s) with Engineers.', picto: 'capture', metric: 'captures', daily: [1, 2], weekly: [6], group: 'ops' },
  { id: 'doomsday-clock', title: 'Doomsday Clock', desc: 'Launch {n} superweapon(s): atomic strike, Iron Curtain or Chronosphere.', picto: 'nuke', metric: 'superweapon', daily: [1], weekly: [4], group: 'ops', effort: 1.2 },
  { id: 'hold-the-line', title: 'Hold the Line', desc: 'Survive 3 minutes after a skirmish build-up ceasefire ends.', picto: 'tower', metric: 'ceasefire', daily: [1], modes: ['skirmish'], group: 'ops', weight: 0.6 },
  { id: 'textbook-operation', title: 'Textbook Operation', desc: 'Complete {n} campaign mission(s) with 3 stars.', picto: 'stars3', metric: 'stars3', daily: [1], weekly: [3], modes: ['campaign'], group: 'ops', weight: 0.8, effort: 1.3 },
  { id: 'campaign-orders', title: 'Campaign Orders', desc: 'Win {n} campaign missions.', picto: 'flag', metric: 'mission.win', weekly: [3], modes: ['campaign'], group: 'ops', weight: 0.8 },
  { id: 'theatre-command', title: 'Theatre Command', desc: 'Fight {n} Conquest battle(s).', picto: 'globe', metric: 'conquest', daily: [1], weekly: [4], modes: ['conquest'], group: 'ops', weight: 0.8 },
  { id: 'ore-rush', title: 'Ore Rush', desc: 'Harvest {n} worth of ore.', picto: 'ore', metric: 'harvest', daily: [10000, 15000], weekly: [80000], money: true, modes: FIGHTS, group: 'ops' },
  { id: 'production-line', title: 'Production Line', desc: 'Build {n} units.', picto: 'helmet', metric: 'built', daily: [40], weekly: [200], modes: FIGHTS, group: 'ops' },
  { id: 'cloak-and-dagger', title: 'Cloak and Dagger', desc: 'Infiltrate {n} enemy structure(s) with Spies or Thieves.', picto: 'spy', metric: 'infiltrate', daily: [1], weekly: [5], group: 'ops', weight: 0.6 },
  { id: 'scavenger', title: 'Scavenger', desc: 'Collect {n} bonus crates.', picto: 'crate', metric: 'crates', daily: [3], group: 'ops', weight: 0.6 },
  { id: 'daily-orders', title: 'Daily Orders', desc: "Play today's Daily Challenge.", picto: 'calendar', metric: 'daily', kind: 'set', daily: [1], modes: ['daily'], group: 'ops', weight: 0.8 },
  { id: 'dedication', title: 'Dedication', desc: 'Play the Daily Challenge on {n} different days.', picto: 'streak', metric: 'daily', kind: 'set', weekly: [3], modes: ['daily'], group: 'ops', weight: 0.8 },
  { id: 'last-stand', title: 'Last Stand', desc: 'Survive {n} waves in a single Survival run.', picto: 'tower', metric: 'waves', kind: 'max', daily: [6], weekly: [12], modes: ['survival'], group: 'ops', weight: 0.6, effort: 1.2 },
  { id: 'challenger', title: 'Challenger', desc: 'Complete {n} scenario challenge(s).', picto: 'target', metric: 'challenge', daily: [1], weekly: [4], modes: ['challenge'], group: 'ops', weight: 0.6 },
  { id: 'report-for-duty', title: 'Report for Duty', desc: 'Fight {n} battles to the end.', picto: 'helmet', metric: 'play', daily: [3], weekly: [12], modes: BATTLES.concat('survival'), group: 'ops' },
];

export const CONTRACT_BY_ID: Record<string, ContractDef> = Object.fromEntries(CONTRACTS.map((c) => [c.id, c]));
/** The contract with this id, if it is one (never an inherited property: ids come from stored data). */
export const contractDef = (id: unknown): ContractDef | undefined => (typeof id === 'string' && Object.hasOwn(CONTRACT_BY_ID, id) ? CONTRACT_BY_ID[id] : undefined);

/** One assigned contract. `p` = progress (clamped to the target), `k` = distinct keys for 'set' contracts. */
export interface ContractSlot {
  id: string;
  n: number;
  p: number;
  done: boolean;
  /** When it was completed (ms). */
  at?: number;
  k?: string[];
}

export interface ContractsState {
  /** UTC day of the daily set. */
  day: string | null;
  daily: ContractSlot[];
  /** Monday (UTC day) of the weekly set. */
  week: string | null;
  weekly: ContractSlot[];
  /** Day the free reroll was used. */
  rerollDay: string | null;
  /** Lifetime contracts completed / Commendations earned from them. */
  completed: number;
  earned: number;
}

export const DAILY_COUNT = 3;
export const WEEKLY_COUNT = 3;
const GROUPS: ContractGroup[] = ['combat', 'victory', 'ops'];

export function defaultContracts(): ContractsState {
  return { day: null, daily: [], week: null, weekly: [], rerollDay: null, completed: 0, earned: 0 };
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (v: unknown): v is string => typeof v === 'string' && DAY_RE.test(v) && Number.isFinite(Date.parse(v + 'T00:00:00Z'));

/** Monday (UTC) of the week containing `day`. */
export function weekKey(day: string): string {
  const t = Date.parse(day + 'T00:00:00Z');
  const dow = (new Date(t).getUTCDay() + 6) % 7; // Monday = 0
  return dayKey(t - dow * 86400000);
}

// ---------------------------------------------------------------------------
// Deterministic rotation
// ---------------------------------------------------------------------------
function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function targets(def: ContractDef, cadence: Cadence): number[] {
  return (cadence === 'daily' ? def.daily : def.weekly) ?? [];
}

function weightedPick(rng: Rng, pool: ContractDef[]): ContractDef | null {
  let total = 0;
  for (const d of pool) total += d.weight ?? 1;
  if (total <= 0) return null;
  let r = rng.next() * total;
  for (const d of pool) {
    r -= d.weight ?? 1;
    if (r <= 0) return d;
  }
  return pool[pool.length - 1] ?? null;
}

function slotFor(def: ContractDef, cadence: Cadence, rng: Rng): ContractSlot {
  const t = targets(def, cadence);
  return { id: def.id, n: t[Math.floor(rng.next() * t.length)] ?? 1, p: 0, done: false };
}

/** The contracts for a cadence and period key: one per group (combat, victory, operations), same for everyone. */
export function contractsFor(cadence: Cadence, key: string): ContractSlot[] {
  const rng = new Rng(hashStr(`rh-contracts:${cadence}:${key}`));
  const out: ContractSlot[] = [];
  for (const g of GROUPS) {
    const def = weightedPick(rng, CONTRACTS.filter((d) => d.group === g && targets(d, cadence).length && !out.some((s) => s.id === d.id)));
    if (def) out.push(slotFor(def, cadence, rng));
  }
  return out;
}

/** Bring the daily / weekly sets up to date (new day or week: new orders, nothing lost). True when changed. */
export function refreshContracts(st: ContractsState, now: number): boolean {
  const day = dayKey(now);
  const week = weekKey(day);
  let changed = false;
  if (st.day !== day || st.daily.length !== DAILY_COUNT) { st.day = day; st.daily = contractsFor('daily', day); changed = true; }
  if (st.week !== week || st.weekly.length !== WEEKLY_COUNT) { st.week = week; st.weekly = contractsFor('weekly', week); changed = true; }
  return changed;
}

export function canReroll(st: ContractsState, now: number): boolean {
  return st.rerollDay !== dayKey(now);
}

/**
 * Use today's free reroll on an unfinished contract: it is replaced by another contract of the same group
 * (deterministic for the day and slot). Returns the new slot, or null when not allowed.
 */
export function rerollContract(st: ContractsState, cadence: Cadence, index: number, now: number): ContractSlot | null {
  refreshContracts(st, now);
  const list = cadence === 'daily' ? st.daily : st.weekly;
  const old = list[index];
  if (!old || old.done || !canReroll(st, now)) return null;
  const oldDef = CONTRACT_BY_ID[old.id];
  const day = dayKey(now);
  const rng = new Rng(hashStr(`rh-contracts:reroll:${cadence}:${day}:${index}:${old.id}`));
  const taken = new Set(list.map((s) => s.id));
  let pool = CONTRACTS.filter((d) => d.group === oldDef?.group && targets(d, cadence).length && !taken.has(d.id));
  if (!pool.length) pool = CONTRACTS.filter((d) => targets(d, cadence).length && !taken.has(d.id));
  const def = weightedPick(rng, pool);
  if (!def) return null;
  const slot = slotFor(def, cadence, rng);
  list[index] = slot;
  st.rerollDay = day;
  return slot;
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------
export interface ContractEvent {
  metric: string;
  /** Amount to add ('sum'), value to compare ('max'); default 1. */
  amount?: number;
  /** Distinct key for 'set' contracts (climate, faction, day). */
  key?: string;
  mode: ContractMode;
}

/**
 * Apply one metric event to every matching, unfinished contract. Returns the slots this event completed
 * (each slot is returned at most once in its lifetime: pay its reward for exactly these).
 */
export function applyContractEvent(st: ContractsState, ev: ContractEvent, now: number): ContractSlot[] {
  const amount = ev.amount === undefined ? 1 : ev.amount;
  if (!(amount > 0) || !Number.isFinite(amount)) return NONE;
  let done: ContractSlot[] | null = null;
  for (let i = 0, n = st.daily.length + st.weekly.length; i < n; i++) {
    const slot = i < st.daily.length ? st.daily[i] : st.weekly[i - st.daily.length];
    if (slot.done) continue;
    const def = contractDef(slot.id);
    if (!def || def.metric !== ev.metric) continue;
    if (def.modes && !def.modes.includes(ev.mode)) continue;
    const kind = def.kind ?? 'sum';
    if (kind === 'set') {
      const key = (ev.key ?? '').slice(0, 40);
      if (!key) continue;
      const k = (slot.k ??= []);
      if (k.includes(key)) continue;
      k.push(key);
      slot.p = Math.min(slot.n, k.length);
    } else if (kind === 'max') {
      slot.p = Math.min(slot.n, Math.max(slot.p, amount));
    } else {
      slot.p = Math.min(slot.n, slot.p + amount);
    }
    if (slot.p >= slot.n) {
      slot.done = true;
      slot.at = now;
      (done ??= []).push(slot);
    }
  }
  return done ?? NONE;
}
const NONE = Object.freeze([]) as unknown as ContractSlot[]; // (shared, never mutated)

/** Cadence of a slot inside a state. */
export function cadenceOf(st: ContractsState, slot: ContractSlot): Cadence {
  return st.weekly.includes(slot) ? 'weekly' : 'daily';
}

/** XP and Commendations a contract pays. */
export function contractReward(id: string, cadence: Cadence): { xp: number; cmd: number } {
  const def = CONTRACT_BY_ID[id];
  const e = def?.effort ?? 1;
  return cadence === 'weekly'
    ? { xp: Math.round((1500 * e) / 50) * 50, cmd: Math.round(12 * e) }
    : { xp: Math.round((300 * e) / 50) * 50, cmd: Math.round(3 * e) };
}

/** Short money: "$12k" (`frac` decimals: "$12.5k"), in the active language. */
export function moneyShort(n: number, frac = 0): string {
  let v: string;
  try { v = new Intl.NumberFormat(currentLang(), { minimumFractionDigits: frac, maximumFractionDigits: frac }).format(n / 1000); } catch { v = (n / 1000).toFixed(frac); }
  return tMeta('moneyK', { n: v });
}

export function fmtContractValue(def: ContractDef | undefined, v: number): string {
  const n = Math.floor(v);
  if (def?.money) return n >= 10000 ? moneyShort(Math.round(n / 1000) * 1000) : fmtMoney(n);
  return fmtInt(n);
}

/** A contract's display title (game data contract.<id>.title). */
export const contractTitle = (def: Pick<ContractDef, 'id' | 'title'>): string => dt('contract', def.id, 'title', def.title);

/**
 * The description with the target filled in (translated: contract.<id>.desc). In the English data "(s)" / "(es)"
 * marks a plural ending; translations use {n, plural, ...} instead.
 */
export function contractDesc(slot: ContractSlot): string {
  const def = CONTRACT_BY_ID[slot.id];
  if (!def) return '';
  const en = def.desc.replace(/\((e?s)\)/g, (_, s: string) => (slot.n === 1 ? '' : s));
  return dt('contract', def.id, 'desc', en, { n: def.money ? fmtMoney(slot.n) : slot.n });
}

// ---------------------------------------------------------------------------
// Normalisation (profile load: anything malformed falls back to safe values)
// ---------------------------------------------------------------------------
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const nonNeg = (v: unknown, cap = 1e9) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(cap, Math.floor(v))) : 0);

function normSlots(raw: unknown, cadence: Cadence, count: number): ContractSlot[] | null {
  if (!Array.isArray(raw) || raw.length !== count) return null;
  const out: ContractSlot[] = [];
  for (const r of raw) {
    if (!isObj(r)) return null;
    const def = contractDef(r.id);
    const n = typeof r.n === 'number' ? r.n : NaN;
    if (!def || !targets(def, cadence).includes(n) || out.some((s) => s.id === def.id)) return null;
    const slot: ContractSlot = { id: def.id, n, p: Math.min(n, nonNeg(r.p, n)), done: r.done === true };
    if (slot.done && typeof r.at === 'number' && Number.isFinite(r.at)) slot.at = r.at;
    if (Array.isArray(r.k)) {
      const k = [...new Set(r.k.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 40))].slice(0, 8);
      if (k.length) slot.k = k;
      if ((def.kind ?? 'sum') === 'set') slot.p = Math.min(n, k.length);
    }
    if (slot.p >= slot.n) slot.done = true;
    out.push(slot);
  }
  return out;
}

export function normalizeContracts(raw: unknown): ContractsState {
  const d = defaultContracts();
  if (!isObj(raw)) return d;
  const daily = isDay(raw.day) ? normSlots(raw.daily, 'daily', DAILY_COUNT) : null;
  const weekly = isDay(raw.week) ? normSlots(raw.weekly, 'weekly', WEEKLY_COUNT) : null;
  return {
    day: daily ? (raw.day as string) : null, daily: daily ?? [],
    week: weekly ? (raw.week as string) : null, weekly: weekly ?? [],
    rerollDay: isDay(raw.rerollDay) ? raw.rerollDay : null,
    completed: nonNeg(raw.completed), earned: nonNeg(raw.earned),
  };
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------
export interface ContractProgress {
  id: string;
  title: string;
  desc: string;
  picto: string;
  cadence: Cadence;
  /** Progress when the battle began / now, and the target. */
  before: number;
  after: number;
  target: number;
  done: boolean;
  /** Completed during this battle. */
  justDone: boolean;
  xp: number;
  cmd: number;
  money: boolean;
}

/** Every current contract with its progress over a battle; the ones that moved come first. */
export function contractProgressList(st: ContractsState, before?: Map<string, number>, doneNow: string[] = []): ContractProgress[] {
  const out: ContractProgress[] = [];
  for (const cadence of ['daily', 'weekly'] as const) {
    for (const slot of cadence === 'daily' ? st.daily : st.weekly) {
      const def = CONTRACT_BY_ID[slot.id];
      if (!def) continue;
      const r = contractReward(slot.id, cadence);
      out.push({
        id: slot.id, title: contractTitle(def), desc: contractDesc(slot), picto: def.picto, cadence, before: Math.min(slot.p, before?.get(slot.id) ?? slot.p), after: slot.p,
        target: slot.n, done: slot.done, justDone: doneNow.includes(slot.id), xp: r.xp, cmd: r.cmd, money: !!def.money,
      });
    }
  }
  const moved = (c: ContractProgress) => (c.justDone ? 2 : c.after > c.before ? 1 : 0);
  return out.map((c, i) => [c, i] as const).sort((a, b) => moved(b[0]) - moved(a[0]) || a[1] - b[1]).map(([c]) => c);
}
