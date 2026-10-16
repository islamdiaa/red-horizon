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

export const RIVALS_KEY = 'rh.rivals';
export const RIVALS_VERSION = 1;
/** Active rivals kept on the roster. */
export const ROSTER_SIZE = 4;

export const RIVAL_RANKS: Record<Faction, string[]> = {
  soviet: ['Lieutenant', 'Captain', 'Major', 'Colonel', 'General', 'Marshal'],
  allies: ['Lieutenant', 'Captain', 'Major', 'Colonel', 'General', 'Field Marshal'],
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
  /** Minutes until the player first damaged an enemy structure (-1 = never). */
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
const NICKS: Record<string, string[]> = {
  balanced: ['the Professor', 'the Chessmaster', 'Old Owl'],
  rusher: ['the Hammer', 'Blitz', 'Iron Gauntlet'],
  turtle: ['the Wall', 'the Tortoise', 'Lightning Rod'],
  admiral: ['Sea Wolf', 'the Admiral', 'Riptide'],
  airmarshal: ['Skyfall', 'the Hawk', 'Thunderbird'],
  saboteur: ['the Ghost', 'Whisper', 'the Locksmith'],
  siege: ['the Long Arm', 'Big Bertha', 'the Mason'],
  guerrilla: ['the Fox', 'Shadow', 'the Wasp'],
  ironfist: ['the Anvil', 'Steel Rain', 'the Bulldozer'],
  horde: ['the Tide', 'Many Hands', 'the Swarm'],
  tycoon: ['the Baron', 'Goldfinger', 'the Banker'],
};

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

/** Short radio call sign: "Col. Volkov". */
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
      addTrait(back, back.returns > 1 ? 'Undying' : 'Scarred', { aggression: 0.08, caution: -0.05 });
      if (!back.titles.includes('the Returned')) back.titles.push('the Returned');
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

export function counterPlan(r: Rival, h: Habits): CounterPlan {
  const plan: CounterPlan = { traits: {}, prefer: {}, notes: [] };
  const add = (k: TraitKey, d: number) => { plan.traits[k] = (plan.traits[k] ?? 0) + d; };
  const like = (ids: string[], m: number) => { for (const id of ids) plan.prefer[id] = (plan.prefer[id] ?? 1) * m; };
  const sov = r.faction === 'soviet';
  if (h.games < 1) {
    plan.notes.push('Has no file on you yet: plays its own game.');
    return plan;
  }
  if (h.armour > 0.5) {
    like(['e3'], 1.6);
    like(sov ? ['4tnk', 'tsla'] : ['2tnk', 'gun'], 1.4);
    add('defence', 0.1);
    plan.notes.push('Expects your armour: rocket teams and anti-tank guns.');
  }
  if (h.infantry > 0.4) {
    like(sov ? ['e2', 'e4', 'ftur', 'v2rl'] : ['pbox', 'arty', 'jeep'], 1.6);
    add('artillery', 0.15);
    plan.notes.push('Knows you love infantry: flamers, grenades and machine guns.');
  }
  if (h.air > 0.12) {
    like(['e3'], 1.4);
    like(sov ? ['sam', '4tnk'] : ['agun'], 1.8);
    add('defence', 0.1);
    plan.notes.push('Has seen your air force: anti-aircraft everywhere.');
  }
  if (h.naval > 0.12) {
    add('naval', 0.35);
    like(sov ? ['ss'] : ['dd', 'pt'], 1.5);
    plan.notes.push('Ready for your fleet: its own navy is waiting.');
  }
  if (h.rushMinute > 0 && h.rushMinute < 6.5) {
    add('defence', 0.25);
    add('caution', 0.1);
    add('aggression', -0.1);
    plan.notes.push('Braced for your early rush: defences first.');
  } else if (h.rushMinute > 13 || h.defence > 0.4) {
    add('aggression', 0.2);
    add('artillery', 0.2);
    add('economy', 0.15);
    plan.notes.push('Counts on you turtling: artillery and an early push.');
  }
  if (h.superweapons >= 0.5) {
    add('aggression', 0.15);
    add('subterfuge', 0.15);
    plan.notes.push('Means to end it before your superweapons charge.');
  }
  if (h.subterfuge > 1.2 && sov) {
    like(['dog'], 2);
    plan.notes.push('Dogs on the perimeter for your spies.');
  }
  if (!plan.notes.length) plan.notes.push('Has studied your balanced style: plays the long game.');
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
    rushMinute: m.rushMinute >= 0 ? e(h.rushMinute, m.rushMinute) : e(h.rushMinute, Math.max(h.rushMinute, 15)),
    superweapons: e(h.superweapons, m.superweapons), subterfuge: e(h.subterfuge, m.subterfuge), units,
  };
}

/** Feed any finished skirmish into the player's habits (rivals study every battle). */
export function recordHabits(store: RivalStore, m: MatchHabits) {
  store.habits = emaHabits(store.habits, m);
}

const WIN_TITLES = ['the Unbroken', 'Victor of the Steppe', 'the Relentless', 'the Iron-Willed', 'Hero of the Front', 'the Unstoppable'];
const FAST_TITLES = ['the Swift', 'Lightning'];
const WIN_TRAITS: [string, Partial<Record<TraitKey, number>>][] = [
  ['Confident', { aggression: 0.06 }], ['Methodical', { tech: 0.06, caution: 0.04 }], ['Greedy', { economy: 0.08 }],
  ['Bloodthirsty', { aggression: 0.08, caution: -0.06 }], ['Fortifier', { defence: 0.08 }], ['Raider', { harass: 0.08 }],
];

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
    out.note = out.promoted ? `Promoted to ${rankName(r)}` : 'Held the line';
  } else {
    r.losses++;
    r.streak = Math.min(-1, r.streak - 1);
    // two defeats in a row (a lieutenant has nowhere left to fall), or bad luck, and the rival is gone
    if (r.streak <= -2 || (r.rank <= 2 && rnd() < 0.2)) {
      r.status = 'dead';
      r.died = store.seq;
      out.killed = true;
      out.note = 'Killed in action';
    } else if (r.rank === 0) {
      addTrait(r, 'Humbled', { caution: 0.05 });
      out.note = 'Retreated in disgrace';
    } else {
      r.rank--;
      out.demoted = true;
      addTrait(r, 'Humbled', { caution: 0.05 });
      out.note = `Demoted to ${rankName(r)}`;
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
const UNIT_NAMES: Record<string, string> = {
  e1: 'riflemen', e2: 'grenadiers', e3: 'rocket teams', e4: 'flamethrowers', e7: 'Tanya', dog: 'dogs', medi: 'medics', spy: 'spies', jeep: 'Rangers',
  '1tnk': 'light tanks', '2tnk': 'Medium Tanks', '3tnk': 'Heavy Tanks', '4tnk': 'Mammoths', arty: 'artillery', v2rl: 'V2 rockets', apc: 'APCs',
  heli: 'Longbows', hind: 'Hinds', mig: 'MiGs', yak: 'Yaks', dd: 'destroyers', ca: 'cruisers', pt: 'gunboats', ss: 'submarines', mnly: 'minelayers',
  ttnk: 'Tesla Tanks', ctnk: 'Chrono Tanks', shok: 'Shock Troopers', qtnk: 'M.A.D. Tanks', dtrk: 'demolition trucks', msub: 'missile subs', stnk: 'Phase Transports',
};

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
  if (r.returns > 0 && last && !last.rivalWon) lines.push(`You left me for dead, ${player}. You should have made sure.`, 'They pulled me from the wreckage. I have been waiting for this.');
  else if (!r.wins && !r.losses) lines.push(`${rankName(r)} ${r.last}. They say you are good, ${player}. We shall see.`, `So you are the famous ${player}. I expected someone taller.`, `${r.last} here. Let us keep this professional, ${player}.`);
  else if (last?.rivalWon) lines.push(`Back for more? Last time it took me ${Math.max(1, Math.round(last.minutes))} minutes.`, `${r.wins} to ${r.losses}, ${player}. Shall we make it ${r.wins + 1}?`, `I kept your last defeat on my wall, ${player}.`);
  else lines.push(`You got lucky last time, ${player}. Luck runs out.`, `${r.losses} defeats. I remember every one of them.`, 'I have rebuilt, retrained and rethought. Have you?');
  if (fav && h.games >= 2) lines.push(`Your ${UNIT_NAMES[fav]} will not save you this time.`);
  if (plan.notes.some((n) => n.includes('rush'))) lines.push('Rush me again, I dare you. My guns are already waiting.');
  if (plan.notes.some((n) => n.includes('turtling'))) lines.push('Dig in as deep as you like. I brought shovels.');
  if (plan.notes.some((n) => n.includes('air force'))) lines.push('Your pilots will find my skies crowded.');
  return pickOf(rnd, lines);
}

export type TauntEvent = 'contact' | 'attack' | 'flank' | 'harass' | 'nuke' | 'ironcurtain' | 'firstBlood' | 'losing' | 'winning' | 'fallback' | 'expand' | 'won' | 'lost';

const TAUNTS: Record<TauntEvent, string[]> = {
  contact: ['There you are. Nice base. It would be a shame if something happened to it.', 'Found you, {player}.', 'My scouts have your measure.'],
  attack: ['Here they come. Try to look surprised.', 'Advance! Let us see what you are made of.', 'My columns are rolling, {player}.'],
  flank: ['Watch your flank, {player}.', 'One fist in front, one behind you.'],
  harass: ['Your harvesters look lonely.', 'Just a little visit to your ore fields.'],
  nuke: ['Fire. Let them see the sun rise twice today.', 'Launch confirmed. You may want to step outside.'],
  ironcurtain: ['Iron Curtain engaged. Shoot all you like.'],
  firstBlood: ['A scratch. Is that all?', 'You found my door. Now try to get through it.'],
  losing: ['This is not over!', 'Fall back and regroup... I said regroup!', 'You will pay for every one of those buildings.'],
  winning: ['Your lines are breaking, {player}.', 'Surrender now and I will be generous.', 'Was that your best? Truly?'],
  fallback: ['Pull back! Regroup at the rally point.', 'A tactical withdrawal. Nothing more.'],
  expand: ['More ore, more tanks. Simple arithmetic.'],
  won: ['Victory. Remember this day, {player}.', 'Another one for the wall.', 'Well fought. Not well enough.'],
  lost: ['This... this is not the end of {rival}.', 'Well played, {player}. I will not forget it.', 'Tell them I fought to the last.'],
};

/** A radio line for an event (rotates through the variants by count). */
export function taunt(ev: TauntEvent, n: number, ctx: { player: string; rival: string }): string {
  const list = TAUNTS[ev];
  return list[n % list.length].replace(/\{player\}/g, ctx.player).replace(/\{rival\}/g, ctx.rival);
}

/** The roster in board order: active first (nemesis on top), then the fallen. */
export function rosterOrder(store: RivalStore): Rival[] {
  const act = store.rivals.filter((x) => x.status === 'active').sort((a, b) => (a.id === store.nemesis ? -1 : b.id === store.nemesis ? 1 : 0) || b.rank - a.rank || (b.wins + b.losses) - (a.wins + a.losses));
  const dead = store.rivals.filter((x) => x.status === 'dead').sort((a, b) => b.lastFought - a.lastFought);
  return [...act, ...dead];
}
