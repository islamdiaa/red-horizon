/**
 * Persistent rivals ("nemesis commanders"): a roster of named enemy commanders who remember you.
 *
 * Each rival has a name, rank, faction, commander personality (src/sim/ai-personality.ts), a procedural portrait
 * and a record against the player. Before a match the rival studies how you have been playing (unit mix, air and
 * naval use, how early you attack, superweapons; tracked by the rivals radio in src/ui/rivals.ts) and picks a
 * counter-plan: personality tweaks decided before the first tick and stored in the skirmish setup (so replays and
 * saves reproduce the match exactly). Afterwards a winning rival is promoted and may earn a title; a beaten one is
 * demoted, or killed outright, and may come back scarred later. New rivals rise to keep the roster full.
 *
 * Storage: localStorage key `rh.rivals` next to the commander profile (`rh.profile`; kept separate so the profile's
 * in-match save can never overwrite rival updates). Format (version 1):
 *   { v: 1, seq: number, rivals: Rival[], habits: Habits, nemesis?: string }
 * Pure logic, no DOM: node tests and tools can use it with an in-memory KV.
 */
import type { Faction } from '../data/rules';
import type { AIDifficulty } from '../sim/ai';
import { PERSONALITIES, resolvePersonality, withTweaks, type Personality, type TraitKey } from '../sim/ai-personality';
import { defaultStorage, type KV } from './profile';
import { flatten, format, trSource, tx, type Params } from '../i18n/core';
import { formatMessage } from '../i18n/format';
import tRivals, { RIVAL_SRC, TAUNT_TEXT } from '../i18n/en/rivals';
import { personName } from '../i18n/en/players'; // (rival names in Russian / Chinese script)

// The rival logic stores and compares English (rh.rivals, the skirmish setup and its replays): the display helpers at
// the end of this file (rivalText, rivalRankLabel, rivalDisplayName...) translate it.
const R = RIVAL_SRC.rank;
/** English text with parameters (never the interface language: it is stored). */
const fillEn = (tpl: string, params: Params) => formatMessage(tpl, params, 'en');

export const RIVALS_KEY = 'rh.rivals';
export const RIVALS_VERSION = 1;
/** Active rivals kept on the roster. */
export const ROSTER_SIZE = 4;

/** Rival ranks in English (stored; rivalRankLabel() translates). */
export const RIVAL_RANKS: Record<Faction, string[]> = {
  soviet: [R.lieutenant, R.captain, R.major, R.colonel, R.general, R.marshal],
  allies: [R.lieutenant, R.captain, R.major, R.colonel, R.general, R.fieldMarshal],
};
export const MAX_RIVAL_RANK = 5;

/** How the player tends to play (exponential moving averages over recent skirmishes). */
export interface Habits {
  games: number;
  /** Shares of the value of units built (0..1). */
  infantry: number;
  armour: number;
  artillery: number;
  air: number;
  naval: number;
  /** Share of structure spending that went into static defences. */
  defence: number;
  /** Minute of the first strike on the enemy base (lower = rusher). */
  rushMinute: number;
  /** Superweapon launches per match. */
  superweapons: number;
  /** Spies, thieves, minelayers per match. */
  subterfuge: number;
  /** Value built per unit type (EMA), for "your favourite toy" taunts. */
  units: Record<string, number>;
}

/** What one match told us about the player (filled by the rivals radio). */
export interface MatchHabits {
  built: Record<string, number>;
  /** Value spent per class. */
  infantry: number;
  armour: number;
  artillery: number;
  air: number;
  naval: number;
  defenceValue: number;
  structureValue: number;
  /** Minutes until the player first damaged an enemy structure (-1 = never, -2 = not measured: build-up time). */
  rushMinute: number;
  superweapons: number;
  subterfuge: number;
}

export interface PortraitSpec {
  seed: number;
  skin: number;
  hair: number;
  hat: number;
  facial: number;
  eyewear: number;
}

export interface RivalBattle {
  at: number;
  rivalWon: boolean;
  minutes: number;
  playerFaction: string;
  /** What happened to the rival afterwards ("promoted to Colonel", "killed in action", …). */
  note: string;
  /** The counter-plan it went in with. */
  plan?: string[];
}

export interface Rival {
  id: string;
  first: string;
  last: string;
  nick: string;
  faction: Faction;
  /** Base personality id (PERSONALITIES). */
  personality: string;
  rank: number;
  titles: string[];
  /** Earned traits (display) and the personality drift they brought. */
  traits: string[];
  tweaks: Partial<Record<TraitKey, number>>;
  wins: number;
  losses: number;
  /** Positive = rival's win streak, negative = losing streak. */
  streak: number;
  status: 'active' | 'dead';
  /** Times it came back from the dead. */
  returns: number;
  /** Store sequence number at its death (the fallen only return a while later). */
  died?: number;
  portrait: PortraitSpec;
  history: RivalBattle[];
  /** How the player played against this rival specifically. */
  seen: Habits;
  created: number;
  lastFought: number;
}

export interface RivalStore {
  v: number;
  seq: number;
  rivals: Rival[];
  habits: Habits;
  /** Rival id the skirmish menu offers by default. */
  nemesis?: string;
}

/** What GameSetup carries for a rival opponent (recorded in replays / saves with the setup). */
export interface RivalRef {
  id: string;
  name: string;
  rank: string;
  faction: Faction;
  personality: string;
  portrait: PortraitSpec;
  /** Counter-plan notes (shown on the board / used for taunts). */
  plan: string[];
  /** Record before this match. */
  wins: number;
  losses: number;
  returns: number;
  titles: string[];
  /** Pre-battle radio line, chosen before the match. */
  intro: string;
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------
const FIRST: Record<Faction, string[]> = {
  soviet: ['Dmitri', 'Nadia', 'Yuri', 'Katarina', 'Viktor', 'Irina', 'Pavel', 'Ludmila', 'Sergei', 'Olga', 'Anatoly', 'Vera', 'Mikhail', 'Tatiana', 'Grigori', 'Zoya', 'Arkady', 'Yelena'],
  allies: ['Marcus', 'Helena', 'Pierre', 'Ingrid', 'Thomas', 'Clara', 'Henrik', 'Sophie', 'James', 'Margot', 'Erik', 'Lena', 'Arthur', 'Freya', 'Victor', 'Rosalind', 'Jan', 'Elise'],
};
/** Soviet first names that take the feminine surname form (Volkov -> Volkova). */
const FEMININE = new Set(['Nadia', 'Katarina', 'Irina', 'Ludmila', 'Olga', 'Vera', 'Tatiana', 'Zoya', 'Yelena']);
const LAST: Record<Faction, string[]> = {
  soviet: ['Volkov', 'Kuznetsov', 'Drozdov', 'Belov', 'Sokolov', 'Petrov', 'Orlov', 'Zaitsev', 'Morozko', 'Gromov', 'Karpov', 'Lebedev', 'Ryabov', 'Tikhonov', 'Shubin', 'Yermakov'],
  allies: ['Harrington', 'Lindqvist', 'Moreau', 'Calloway', 'van Dijk', 'Ashford', 'Brennan', 'Delacroix', 'Whitmore', 'Bergstrom', 'Kessler', 'Fairfax', 'Rasmussen', 'Duval', 'Hale', 'Okafor'],
};
const surname = (first: string, last: string) => (FEMININE.has(first) && /(ov|ev|in)$/.test(last) ? last + 'a' : last);
const NICKS: Record<string, string[]> = Object.fromEntries(Object.entries(RIVAL_SRC.nick).map(([k, v]) => [k, Object.values(v)]));

// ---------------------------------------------------------------------------
// Small seeded RNG (the roster is generated deterministically from the store's sequence number)
// ---------------------------------------------------------------------------
function rng(seed: number) {
  let s = (seed ^ 0x9e3779b9) >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}
const pickOf = <T>(r: () => number, a: readonly T[]): T => a[Math.floor(r() * a.length) % a.length];

// ---------------------------------------------------------------------------
// Defaults & storage
// ---------------------------------------------------------------------------
export function defaultHabits(): Habits {
  return { games: 0, infantry: 0.3, armour: 0.45, artillery: 0.08, air: 0.05, naval: 0.02, defence: 0.25, rushMinute: 9, superweapons: 0, subterfuge: 0.5, units: {} };
}

export function defaultRivals(): RivalStore {
  return { v: RIVALS_VERSION, seq: 1, rivals: [], habits: defaultHabits() };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown, d: string) => (typeof v === 'string' ? v : d);

function normHabits(v: unknown): Habits {
  const d = defaultHabits();
  if (!isObj(v)) return d;
  const units: Record<string, number> = {};
  if (isObj(v.units)) for (const [k, x] of Object.entries(v.units)) if (typeof x === 'number' && Number.isFinite(x)) units[k] = x;
  return {
    games: num(v.games, 0), infantry: num(v.infantry, d.infantry), armour: num(v.armour, d.armour), artillery: num(v.artillery, d.artillery),
    air: num(v.air, d.air), naval: num(v.naval, d.naval), defence: num(v.defence, d.defence), rushMinute: num(v.rushMinute, d.rushMinute),
    superweapons: num(v.superweapons, 0), subterfuge: num(v.subterfuge, d.subterfuge), units,
  };
}

function normRival(v: unknown): Rival | null {
  if (!isObj(v) || typeof v.id !== 'string') return null;
  const faction: Faction = v.faction === 'allies' ? 'allies' : 'soviet';
  const pr = isObj(v.portrait) ? v.portrait : {};
  const tweaks: Partial<Record<TraitKey, number>> = {};
  if (isObj(v.tweaks)) for (const [k, x] of Object.entries(v.tweaks)) if (typeof x === 'number' && Number.isFinite(x)) tweaks[k as TraitKey] = x;
  return {
    id: v.id, first: str(v.first, 'Ivan'), last: str(v.last, 'Petrov'), nick: str(v.nick, ''), faction,
    personality: typeof v.personality === 'string' && PERSONALITIES[v.personality] ? v.personality : 'balanced',
    rank: Math.max(0, Math.min(MAX_RIVAL_RANK, Math.floor(num(v.rank, 0)))),
    titles: Array.isArray(v.titles) ? v.titles.filter((x): x is string => typeof x === 'string').slice(0, 6) : [],
    traits: Array.isArray(v.traits) ? v.traits.filter((x): x is string => typeof x === 'string').slice(0, 8) : [],
    tweaks, wins: num(v.wins, 0), losses: num(v.losses, 0), streak: num(v.streak, 0), status: v.status === 'dead' ? 'dead' : 'active',
    returns: num(v.returns, 0), died: typeof v.died === 'number' ? v.died : undefined,
    portrait: { seed: num(pr.seed, 1), skin: num(pr.skin, 0), hair: num(pr.hair, 0), hat: num(pr.hat, 0), facial: num(pr.facial, 0), eyewear: num(pr.eyewear, 0) },
    history: Array.isArray(v.history) ? v.history.filter(isObj).slice(-12).map((h) => ({
      at: num(h.at, 0), rivalWon: !!h.rivalWon, minutes: num(h.minutes, 0), playerFaction: str(h.playerFaction, 'allies'), note: str(h.note, ''),
      plan: Array.isArray(h.plan) ? h.plan.filter((x): x is string => typeof x === 'string') : undefined,
    })) : [],
    seen: normHabits(v.seen), created: num(v.created, 0), lastFought: num(v.lastFought, 0),
  };
}

export function normalizeRivals(raw: unknown): RivalStore {
  const d = defaultRivals();
  if (!isObj(raw)) return d;
  return {
    ...raw, // keep fields written by newer builds
    v: Math.max(RIVALS_VERSION, num(raw.v, RIVALS_VERSION)),
    seq: Math.max(1, Math.floor(num(raw.seq, 1))),
    rivals: Array.isArray(raw.rivals) ? raw.rivals.map(normRival).filter((r): r is Rival => !!r) : [],
    habits: normHabits(raw.habits),
    nemesis: typeof raw.nemesis === 'string' ? raw.nemesis : undefined,
  };
}

export function loadRivals(storage: KV = defaultStorage()): RivalStore {
  try {
    const s = storage.getItem(RIVALS_KEY);
    return normalizeRivals(s ? JSON.parse(s) : null);
  } catch {
    return defaultRivals();
  }
}

export function saveRivals(store: RivalStore, storage: KV = defaultStorage()) {
  try { storage.setItem(RIVALS_KEY, JSON.stringify(store)); } catch { /* quota / private mode */ }
}

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------
export function rankName(r: Rival): string {
  return RIVAL_RANKS[r.faction][Math.min(r.rank, MAX_RIVAL_RANK)];
}

/** "Colonel Dmitri 'the Anvil' Volkov". */
export function rivalName(r: Rival, withRank = true): string {
  const nick = r.nick ? ` '${r.nick}'` : '';
  return `${withRank ? rankName(r) + ' ' : ''}${r.first}${nick} ${r.last}`;
}

/** Short radio call sign: "Col. Volkov" (English: stored by the setup; rivalCallSign() is the display form). */
export function callSign(r: Rival): string {
  const short: Record<string, string> = { Lieutenant: 'Lt.', Captain: 'Capt.', Major: 'Maj.', Colonel: 'Col.', General: 'Gen.', Marshal: 'Marshal', 'Field Marshal': 'F.M.' };
  return `${short[rankName(r)] ?? rankName(r)} ${r.last}`;
}

/** AI difficulty of a rival: grows with rank (a fresh lieutenant is beatable, a marshal is brutal). */
export function rivalDifficulty(r: Rival): AIDifficulty {
  return (['easy', 'normal', 'normal', 'hard', 'hard', 'brutal'] as AIDifficulty[])[Math.min(r.rank, MAX_RIVAL_RANK)];
}

/** Create a new rival (deterministic from the store sequence). */
export function generateRival(store: RivalStore, opts: { faction?: Faction; personality?: string; now?: number } = {}): Rival {
  const seq = store.seq++;
  const r = rng(seq * 7919 + 17);
  const faction: Faction = opts.faction ?? (r() < 0.5 ? 'soviet' : 'allies');
  const used = new Set(store.rivals.filter((x) => x.status === 'active').map((x) => x.personality));
  const ids = Object.keys(PERSONALITIES).filter((k) => !used.has(k));
  const personality = opts.personality ?? pickOf(r, ids.length ? ids : Object.keys(PERSONALITIES));
  const takenLast = new Set(store.rivals.map((x) => x.last));
  let last = pickOf(r, LAST[faction]);
  for (let k = 0; k < 6 && takenLast.has(last); k++) last = pickOf(r, LAST[faction]);
  const first = pickOf(r, FIRST[faction]);
  const rival: Rival = {
    id: `r${seq}`, first, last: surname(first, last), nick: pickOf(r, NICKS[personality] ?? NICKS.balanced), faction, personality,
    rank: 0, titles: [], traits: [], tweaks: {}, wins: 0, losses: 0, streak: 0, status: 'active', returns: 0,
    portrait: { seed: seq, skin: Math.floor(r() * 5), hair: Math.floor(r() * 6), hat: Math.floor(r() * 4), facial: Math.floor(r() * 5), eyewear: Math.floor(r() * 6) },
    history: [], seen: defaultHabits(), created: opts.now ?? Date.now(), lastFought: 0,
  };
  store.rivals.push(rival);
  return rival;
}

/** Keep ROSTER_SIZE active rivals (new ones rise; now and then a dead one comes back scarred). */
export function ensureRoster(store: RivalStore, now = Date.now()): Rival[] {
  const risen: Rival[] = [];
  const r = rng(store.seq * 31 + 5);
  while (store.rivals.filter((x) => x.status === 'active').length < ROSTER_SIZE) {
    const dead = store.rivals.filter((x) => x.status === 'dead' && x.returns < 2 && store.seq - (x.died ?? 0) >= 6);
    if (dead.length && r() < 0.35) {
      const back = pickOf(r, dead);
      back.status = 'active';
      back.returns++;
      addTrait(back, back.returns > 1 ? RIVAL_SRC.trait.undying : RIVAL_SRC.trait.scarred, { aggression: 0.08, caution: -0.05 });
      if (!back.titles.includes(RIVAL_SRC.title.returned)) back.titles.push(RIVAL_SRC.title.returned);
      back.portrait.facial = 9; // the scar
      risen.push(back);
      store.seq++;
    } else {
      risen.push(generateRival(store, { now }));
    }
  }
  // drop very old dead rivals (keep the list short)
  const dead = store.rivals.filter((x) => x.status === 'dead');
  if (dead.length > 8) store.rivals = store.rivals.filter((x) => x.status === 'active' || dead.slice(-8).includes(x));
  if (!store.nemesis || !store.rivals.some((x) => x.id === store.nemesis && x.status === 'active')) store.nemesis = nemesisOf(store)?.id;
  return risen;
}

/** The rival you have the most history with (ties: the higher rank). */
export function nemesisOf(store: RivalStore): Rival | null {
  const act = store.rivals.filter((x) => x.status === 'active');
  act.sort((a, b) => (b.wins + b.losses) - (a.wins + a.losses) || b.rank - a.rank || a.id.localeCompare(b.id));
  return act[0] ?? null;
}

function addTrait(r: Rival, name: string, tweak: Partial<Record<TraitKey, number>>) {
  if (!r.traits.includes(name)) r.traits.push(name);
  for (const [k, d] of Object.entries(tweak)) r.tweaks[k as TraitKey] = Math.max(-0.35, Math.min(0.35, (r.tweaks[k as TraitKey] ?? 0) + (d ?? 0)));
}

// ---------------------------------------------------------------------------
// Counter-plan (decided before the match from the player's habits)
// ---------------------------------------------------------------------------
export interface CounterPlan {
  traits: Partial<Record<TraitKey, number>>;
  prefer: Record<string, number>;
  notes: string[];
}

/** Blend of what this rival saw of you and your general habits (its own memory weighs more). */
export function habitsFor(store: RivalStore, r: Rival): Habits {
  const g = store.habits, s = r.seen;
  if (!s.games) return g;
  const w = Math.min(0.75, 0.35 + s.games * 0.15);
  const mix = (a: number, b: number) => a * (1 - w) + b * w;
  const units: Record<string, number> = { ...g.units };
  for (const [k, v] of Object.entries(s.units)) units[k] = mix(units[k] ?? 0, v);
  return {
    games: g.games + s.games, infantry: mix(g.infantry, s.infantry), armour: mix(g.armour, s.armour), artillery: mix(g.artillery, s.artillery),
    air: mix(g.air, s.air), naval: mix(g.naval, s.naval), defence: mix(g.defence, s.defence), rushMinute: mix(g.rushMinute, s.rushMinute),
    superweapons: mix(g.superweapons, s.superweapons), subterfuge: mix(g.subterfuge, s.subterfuge), units,
  };
}

const P = RIVAL_SRC.plan;

export function counterPlan(r: Rival, h: Habits): CounterPlan {
  const plan: CounterPlan = { traits: {}, prefer: {}, notes: [] };
  const add = (k: TraitKey, d: number) => { plan.traits[k] = (plan.traits[k] ?? 0) + d; };
  const like = (ids: string[], m: number) => { for (const id of ids) plan.prefer[id] = (plan.prefer[id] ?? 1) * m; };
  const sov = r.faction === 'soviet';
  if (h.games < 1) {
    plan.notes.push(P.noFile);
    return plan;
  }
  if (h.armour > 0.5) {
    like(['e3'], 1.6);
    like(sov ? ['4tnk', 'tsla'] : ['2tnk', 'gun'], 1.4);
    add('defence', 0.1);
    plan.notes.push(P.armour);
  }
  if (h.infantry > 0.4) {
    like(sov ? ['e2', 'e4', 'ftur', 'v2rl'] : ['pbox', 'arty', 'jeep'], 1.6);
    add('artillery', 0.15);
    plan.notes.push(P.infantry);
  }
  if (h.air > 0.12) {
    like(['e3'], 1.4);
    like(sov ? ['sam', '4tnk'] : ['agun'], 1.8);
    add('defence', 0.1);
    plan.notes.push(P.air);
  }
  if (h.naval > 0.12) {
    add('naval', 0.35);
    like(sov ? ['ss'] : ['dd', 'pt'], 1.5);
    plan.notes.push(P.naval);
  }
  if (h.rushMinute > 0 && h.rushMinute < 6.5) {
    add('defence', 0.25);
    add('caution', 0.1);
    add('aggression', -0.1);
    plan.notes.push(P.rush);
  } else if (h.rushMinute > 13 || h.defence > 0.4) {
    add('aggression', 0.2);
    add('artillery', 0.2);
    add('economy', 0.15);
    plan.notes.push(P.turtle);
  }
  if (h.superweapons >= 0.5) {
    add('aggression', 0.15);
    add('subterfuge', 0.15);
    plan.notes.push(P.superweapons);
  }
  if (h.subterfuge > 1.2 && sov) {
    like(['dog'], 2);
    plan.notes.push(P.dogs);
  }
  if (!plan.notes.length) plan.notes.push(P.balanced);
  return plan;
}

/** The personality a rival takes into a match: base + earned drift + counter-plan. */
export function rivalPersonality(r: Rival, plan: CounterPlan): Personality {
  const base = resolvePersonality(r.personality);
  const traits: Partial<Record<TraitKey, number>> = { ...r.tweaks };
  for (const [k, d] of Object.entries(plan.traits)) traits[k as TraitKey] = (traits[k as TraitKey] ?? 0) + (d ?? 0);
  const p = withTweaks(base, { traits, prefer: plan.prefer, tags: [`rival:${r.id}`] });
  p.name = `${base.name} (${r.last})`;
  return p;
}

/** Everything the skirmish setup needs for a rival opponent, decided now (before the match). */
export function prepareRivalOpponent(store: RivalStore, id: string, playerName = 'Commander'): { faction: Faction; difficulty: AIDifficulty; personality: Personality; rival: RivalRef } | null {
  const r = store.rivals.find((x) => x.id === id && x.status === 'active');
  if (!r) return null;
  const h = habitsFor(store, r);
  const plan = counterPlan(r, h);
  return {
    faction: r.faction, difficulty: rivalDifficulty(r), personality: rivalPersonality(r, plan),
    rival: {
      id: r.id, name: rivalName(r), rank: rankName(r), faction: r.faction, personality: r.personality, portrait: { ...r.portrait }, plan: plan.notes,
      wins: r.wins, losses: r.losses, returns: r.returns, titles: [...r.titles], intro: introLine(r, h, plan, playerName),
    },
  };
}

// ---------------------------------------------------------------------------
// After the match
// ---------------------------------------------------------------------------
const ALPHA = 0.35;

function emaHabits(h: Habits, m: MatchHabits): Habits {
  const total = Math.max(1, m.infantry + m.armour + m.artillery + m.air + m.naval);
  const a = h.games ? ALPHA : 1;
  const e = (old: number, v: number) => old * (1 - a) + v * a;
  const units: Record<string, number> = {};
  for (const [k, v] of Object.entries(h.units)) units[k] = v * (1 - a);
  for (const [k, v] of Object.entries(m.built)) units[k] = (units[k] ?? 0) + v * a;
  for (const [k, v] of Object.entries(units)) if (v < 50) delete units[k];
  return {
    games: h.games + 1, infantry: e(h.infantry, m.infantry / total), armour: e(h.armour, m.armour / total), artillery: e(h.artillery, m.artillery / total),
    air: e(h.air, m.air / total), naval: e(h.naval, m.naval / total), defence: e(h.defence, m.defenceValue / Math.max(1, m.structureValue)),
    // (-2: a match with a build-up time, where the first strike tells nothing; -1: the player never struck)
    rushMinute: m.rushMinute >= 0 ? e(h.rushMinute, m.rushMinute) : m.rushMinute === -2 ? h.rushMinute : e(h.rushMinute, Math.max(h.rushMinute, 15)),
    superweapons: e(h.superweapons, m.superweapons), subterfuge: e(h.subterfuge, m.subterfuge), units,
  };
}

/** Feed any finished skirmish into the player's habits (rivals study every battle). */
export function recordHabits(store: RivalStore, m: MatchHabits) {
  store.habits = emaHabits(store.habits, m);
}

const T = RIVAL_SRC.title, TR = RIVAL_SRC.trait;
const WIN_TITLES = [T.unbroken, T.steppe, T.relentless, T.ironWilled, T.hero, T.unstoppable];
const FAST_TITLES = [T.swift, T.lightning];
const WIN_TRAITS: [string, Partial<Record<TraitKey, number>>][] = [
  [TR.confident, { aggression: 0.06 }], [TR.methodical, { tech: 0.06, caution: 0.04 }], [TR.greedy, { economy: 0.08 }],
  [TR.bloodthirsty, { aggression: 0.08, caution: -0.06 }], [TR.fortifier, { defence: 0.08 }], [TR.raider, { harass: 0.08 }],
];
const N = RIVAL_SRC.note;

export interface RivalOutcome {
  rival: Rival;
  rivalWon: boolean;
  promoted: boolean;
  demoted: boolean;
  killed: boolean;
  newTitle?: string;
  newTrait?: string;
  /** Rivals that rose to fill the roster. */
  risen: Rival[];
  note: string;
}

/** Record a finished rival match: record, rank, titles, death; then refill the roster. */
export function recordRivalBattle(store: RivalStore, id: string, res: { rivalWon: boolean; minutes: number; playerFaction: string; plan?: string[]; habits?: MatchHabits; now?: number }): RivalOutcome | null {
  const r = store.rivals.find((x) => x.id === id);
  if (!r) return null;
  const now = res.now ?? Date.now();
  // (this rival's own memory of you; the caller folds the match into the global habits with recordHabits)
  if (res.habits) r.seen = emaHabits(r.seen, res.habits);
  const out: RivalOutcome = { rival: r, rivalWon: res.rivalWon, promoted: false, demoted: false, killed: false, risen: [], note: '' };
  const rnd = rng(store.seq * 131 + r.wins * 7 + r.losses * 13);
  store.seq++;
  r.lastFought = now;
  if (res.rivalWon) {
    r.wins++;
    r.streak = Math.max(1, r.streak + 1);
    if (r.rank < MAX_RIVAL_RANK) { r.rank++; out.promoted = true; }
    // a title for a fast win or a streak, a trait now and then
    const titles = res.minutes < 12 ? FAST_TITLES : r.streak >= 2 ? WIN_TITLES : [];
    const fresh = titles.filter((t) => !r.titles.includes(t));
    if (fresh.length && (r.streak >= 2 || res.minutes < 12)) { out.newTitle = pickOf(rnd, fresh); r.titles.push(out.newTitle); }
    const traits = WIN_TRAITS.filter(([n]) => !r.traits.includes(n));
    if (traits.length && rnd() < 0.6) {
      const [name, tw] = pickOf(rnd, traits);
      addTrait(r, name, tw);
      out.newTrait = name;
    }
    out.note = out.promoted ? fillEn(N.promoted, { rank: rankName(r) }) : N.held;
  } else {
    r.losses++;
    r.streak = Math.min(-1, r.streak - 1);
    // two defeats in a row (a lieutenant has nowhere left to fall), or bad luck, and the rival is gone
    if (r.streak <= -2 || (r.rank <= 2 && rnd() < 0.2)) {
      r.status = 'dead';
      r.died = store.seq;
      out.killed = true;
      out.note = N.killed;
    } else if (r.rank === 0) {
      addTrait(r, TR.humbled, { caution: 0.05 });
      out.note = N.retreated;
    } else {
      r.rank--;
      out.demoted = true;
      addTrait(r, TR.humbled, { caution: 0.05 });
      out.note = fillEn(N.demoted, { rank: rankName(r) });
    }
  }
  r.history.push({ at: now, rivalWon: res.rivalWon, minutes: Math.round(res.minutes * 10) / 10, playerFaction: res.playerFaction, note: out.note, plan: res.plan });
  if (r.history.length > 12) r.history.splice(0, r.history.length - 12);
  out.risen = ensureRoster(store, now);
  if (out.killed && store.nemesis === r.id) store.nemesis = nemesisOf(store)?.id;
  return out;
}

// ---------------------------------------------------------------------------
// Radio lines
// ---------------------------------------------------------------------------
const UNIT_NAMES: Record<string, string> = RIVAL_SRC.units;

export function favouriteUnit(h: Habits): string | null {
  let best: string | null = null, bv = 0;
  for (const [k, v] of Object.entries(h.units)) if (v > bv && UNIT_NAMES[k] && k !== 'harv' && k !== 'mcv') { bv = v; best = k; }
  return best;
}

function introLine(r: Rival, h: Habits, plan: CounterPlan, player: string): string {
  const rnd = rng(r.portrait.seed * 17 + r.wins * 5 + r.losses * 3 + r.returns);
  const fav = favouriteUnit(h);
  const last = r.history[r.history.length - 1];
  const lines: string[] = [];
  const I = RIVAL_SRC.intro;
  const p = { player, rank: rankName(r), last: r.last, wins: String(r.wins), losses: String(r.losses), next: String(r.wins + 1) };
  if (r.returns > 0 && last && !last.rivalWon) lines.push(fillEn(I.revenge, p), I.wreckage);
  else if (!r.wins && !r.losses) lines.push(fillEn(I.firstMeet, p), fillEn(I.famous, p), fillEn(I.professional, p));
  else if (last?.rivalWon) lines.push(fillEn(I.backForMore, { n: String(Math.max(1, Math.round(last.minutes))) }), fillEn(I.record, p), fillEn(I.wall, p));
  else lines.push(fillEn(I.lucky, p), fillEn(I.defeats, p), I.rebuilt);
  if (fav && h.games >= 2) lines.push(fillEn(I.favourite, { units: UNIT_NAMES[fav] }));
  if (plan.notes.includes(P.rush)) lines.push(I.rush);
  if (plan.notes.includes(P.turtle)) lines.push(I.turtle);
  if (plan.notes.includes(P.air)) lines.push(I.air);
  return pickOf(rnd, lines);
}

export type TauntEvent = 'contact' | 'attack' | 'flank' | 'harass' | 'nuke' | 'ironcurtain' | 'firstBlood' | 'losing' | 'winning' | 'fallback' | 'expand' | 'won' | 'lost';

/** A radio line for an event in the active language (rotates through the variants by count). Display only. */
export function taunt(ev: TauntEvent, n: number, ctx: { player: string; rival: string }): string {
  const list: readonly string[] = TAUNT_TEXT[ev];
  return format(list[n % list.length], { player: ctx.player, rival: ctx.rival });
}

/** The roster in board order: active first (nemesis on top), then the fallen. */
export function rosterOrder(store: RivalStore): Rival[] {
  const act = store.rivals.filter((x) => x.status === 'active').sort((a, b) => (a.id === store.nemesis ? -1 : b.id === store.nemesis ? 1 : 0) || b.rank - a.rank || (b.wins + b.losses) - (a.wins + a.losses));
  const dead = store.rivals.filter((x) => x.status === 'dead').sort((a, b) => b.lastFought - a.lastFought);
  return [...act, ...dead];
}

// ---------------------------------------------------------------------------
// Display (translated): the logic above keeps English
// ---------------------------------------------------------------------------
const RANK_KEYS: Record<string, keyof typeof RIVAL_SRC.rank> = Object.fromEntries(Object.entries(RIVAL_SRC.rank).map(([k, v]) => [v, k as keyof typeof RIVAL_SRC.rank]));
const reEsc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
let matchers: { key: string; re: RegExp; names: string[] }[] | null = null;

/** Patterns for the stored lines with parameters (intro lines, history notes); a {rank} only matches a rank. */
function lineMatchers() {
  if (matchers) return matchers;
  const ranks = Object.values(RIVAL_SRC.rank).sort((a, b) => b.length - a.length).map(reEsc).join('|');
  const flat = { ...flatten(RIVAL_SRC.intro, 'rivals.src.intro'), ...flatten(RIVAL_SRC.note, 'rivals.src.note') };
  matchers = Object.entries(flat).filter(([, v]) => /\{\w+\}/.test(v)).map(([key, v]) => {
    const names: string[] = [];
    const re = new RegExp(`^${v.split(/(\{\w+\})/).map((part) => {
      const m = /^\{(\w+)\}$/.exec(part);
      if (!m) return reEsc(part);
      names.push(m[1]);
      return m[1] === 'rank' ? `(${ranks})` : '(.+?)';
    }).join('')}$`, 's');
    return { key, re, names };
  });
  return matchers;
}

/**
 * Stored rival English (radio intro, history notes, titles, traits, nicknames, plan notes, ranks) in the active
 * language; anything unknown (an older build's text) unchanged.
 */
export function rivalText(text: string): string {
  if (!text) return text;
  for (const m of lineMatchers()) {
    const hit = m.re.exec(text);
    if (!hit) continue;
    const params: Params = {};
    m.names.forEach((n, i) => { params[n] = n === 'rank' || n === 'units' ? trSource(hit[i + 1]) : n === 'last' ? personName(hit[i + 1]) : hit[i + 1]; });
    return tx(m.key, params);
  }
  return trSource(text);
}

/** A rival's rank in the active language. */
export function rivalRankLabel(r: Rival): string {
  return trSource(rankName(r));
}

function nameParts(rank: string, first: string, nick: string, last: string, withRank: boolean): string {
  const p = { rank: rank ? trSource(rank) : '', first: personName(first), nick: nick ? trSource(nick) : '', last: personName(last) };
  if (!withRank || !rank) return tRivals(nick ? 'name.plain' : 'name.plainNoNick', p);
  return tRivals(nick ? 'name.full' : 'name.fullNoNick', p);
}

/** "Colonel Dmitri 'the Anvil' Volkov" in the active language (rank and nickname translated). */
export function rivalDisplayName(r: Rival, withRank = true, rank = rankName(r)): string {
  return nameParts(rank, r.first, r.nick, r.last, withRank);
}

/** The display name of a rival in a setup (RivalRef.name holds the English "Rank First 'Nick' Last"). */
export function rivalRefName(ref: Pick<RivalRef, 'name' | 'rank'>): string {
  const rest = ref.rank && ref.name.startsWith(ref.rank + ' ') ? ref.name.slice(ref.rank.length + 1) : null;
  const m = rest ? /^(.*?) '(.*)' (.+)$/.exec(rest) : null;
  if (!m) return ref.name;
  return nameParts(ref.rank, m[1], m[2], m[3], true);
}

/** "Col. Volkov" in the active language. */
export function rivalCallSign(r: Rival): string {
  const k = RANK_KEYS[rankName(r)];
  return tRivals('name.callSign', { rank: k ? tRivals(`short.${k}`) : rivalRankLabel(r), last: personName(r.last) });
}
