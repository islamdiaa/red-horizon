/**
 * Skirmish mutators: the 16 Daily Challenge modifiers (src/meta/daily.ts) plus skirmish-only ones, picked in the
 * skirmish setup, rolled by "Surprise me" or by Quick Battle. DOM-free and deterministic.
 *
 * A match's mutators live in GameSetup.mutators (so saves, replays and branches carry them) and act in three
 * layers, all derived from the id list alone:
 *   1. setup  mutateSetup(setup)      credits, fog, weather and time of day, before the World exists (idempotent)
 *   2. rules  withMutatorMods(mods)   rule-table changes expressed as one more mod (src/mods), so the mod engine
 *                                     applies and restores them exactly like any mod
 *   3. world  MUTATOR_EFFECTS         economy multipliers, bans and live effects, run by src/sim/events.ts inside
 *                                     the deterministic tick
 * Contracts (src/meta/contracts.ts) can reference mutators by id (MUTATORS / MUTATOR_BY_ID).
 */
import { DAILY_MODIFIERS, type Climate, type DailyFaction } from '../meta/daily';
import { Rng } from '../core/rng';
import { WEAPONS } from '../data/rules';
import { makeModSet, type ModFile, type ModSet, type ScaleRule } from '../mods/format';

export interface MutatorInfo {
  id: string;
  name: string;
  /** What it does in a skirmish (the daily texts are rewritten where the skirmish rule differs). */
  desc: string;
  /** Pictogram key (src/meta/art.ts PICTO). */
  icon: string;
  /** "Surprise me" draws at most one mutator per group. */
  group: string;
  /** Mutually exclusive set: picking one drops the others of the set (two weathers, two ore values...). */
  excl?: string;
  /** Offered only for this climate / faction (the weather and doctrine modifiers of the daily). */
  when?: (c: MutatorContext) => boolean;
  /** Daily modifier (true) or one of the skirmish additions. */
  daily: boolean;
  /** Rolled by Quick Battle (fun, not punishing). */
  quick: boolean;
  /**
   * Safe for a newcomer: changes the look or helps both sides alike without favouring the AI's faster build-up and
   * spending (the only pool Quick Battle draws from on Recruit and Easy).
   */
  newcomer?: boolean;
}

export interface MutatorContext {
  climate: Climate;
  faction: DailyFaction;
}

/** Skirmish wording / grouping for the daily modifiers (everything else comes from DAILY_MODIFIERS). */
const DAILY_SKIRMISH: Record<string, Partial<MutatorInfo>> = {
  'night-ops': { excl: 'weather', quick: true, newcomer: true },
  blizzard: { excl: 'weather', quick: true, newcomer: true },
  sandstorm: { excl: 'weather', quick: true, newcomer: true },
  'storm-front': { excl: 'weather', quick: true, newcomer: true },
  'double-ore': { excl: 'ore', quick: true },
  'lean-times': { quick: false },
  'credits-rain': { desc: '+$400 for every commander every 30 seconds, and crates fall from the sky.', quick: true, newcomer: true },
  'glass-cannons': { desc: 'Every unit has 60% of its normal health: battles are short and brutal.', quick: true },
  'veteran-start': { desc: 'Every unit fielded, on every side, arrives as a Veteran.', quick: true, newcomer: true },
  'fast-production': { excl: 'speed', quick: true },
  'no-radar': { desc: 'Radar Domes are banned for everyone, and with them all high technology.', quick: false },
  'tesla-only': { excl: 'defence', desc: 'Tesla Coils are the only ground defence anyone may build (anti-air sites still allowed).', quick: false },
  'pillbox-line': { excl: 'defence', desc: 'Pillboxes are the only ground defence anyone may build (anti-air sites still allowed).', quick: false },
  'clear-skies': { excl: 'sight', quick: true },
  fanatics: { desc: 'AI factories run 35% faster and their harvesters bring in 20% more.', quick: false },
  bounty: { desc: 'Every enemy unit destroyed pays $100, every structure $300, to whoever destroys it.', quick: true },
};

/** The skirmish additions. */
const NEW_MUTATORS: MutatorInfo[] = [
  { id: 'golden-ore', name: 'Golden Ore', desc: 'Ore is worth three times as much. Expect huge armies.', icon: 'coin', group: 'economy', excl: 'ore', daily: false, quick: true },
  { id: 'mega-crates', name: 'Mega Crates', desc: 'Crates drop every 20 seconds: money crates pay double and unit crates bring two.', icon: 'crate', group: 'crates', daily: false, quick: true },
  { id: 'tank-rush', name: 'Tank Rush', desc: 'Light, medium, heavy, Mammoth and Tesla tanks cost 40% less.', icon: 'tank', group: 'army', daily: false, quick: true },
  { id: 'heavy-metal', name: 'Heavy Metal', desc: 'Mammoth Tanks for both sides, straight from the War Factory.', icon: 'mammoth', group: 'tech', daily: false, quick: true, newcomer: true },
  { id: 'fog-plus', name: 'Fog of War+', desc: 'Every unit and structure sees 35% less. Scout or be ambushed.', icon: 'eye', group: 'intel', excl: 'sight', daily: false, quick: true },
  { id: 'lightning-war', name: 'Lightning War', desc: 'Everything builds twice as fast, and superweapons and support powers charge twice as fast.', icon: 'lightning', group: 'tech', excl: 'speed', daily: false, quick: true },
  { id: 'glass-base', name: 'Glass Base', desc: 'Every structure has half its normal health.', icon: 'building', group: 'army', daily: false, quick: true },
  { id: 'big-guns', name: 'Big Guns', desc: 'Every weapon reaches 30% further.', icon: 'crosshair', group: 'army', daily: false, quick: true, newcomer: true },
];

export const MUTATORS: MutatorInfo[] = [
  ...DAILY_MODIFIERS.map((m): MutatorInfo => ({
    id: m.id, name: m.name, desc: m.desc, icon: m.icon, group: m.group, when: m.when, daily: true, quick: false,
    ...DAILY_SKIRMISH[m.id],
  })),
  ...NEW_MUTATORS,
];
export const MUTATOR_BY_ID: Record<string, MutatorInfo> = Object.fromEntries(MUTATORS.map((m) => [m.id, m]));

/** Known ids only, deduplicated, exclusive sets resolved (the last pick wins), in catalogue order. */
export function normaliseMutators(ids: readonly unknown[] | undefined | null): string[] {
  if (!Array.isArray(ids)) return [];
  const keep: string[] = [];
  for (const raw of ids) {
    if (typeof raw !== 'string' || !MUTATOR_BY_ID[raw] || keep.includes(raw)) continue;
    const ex = MUTATOR_BY_ID[raw].excl;
    if (ex) for (let k = keep.length - 1; k >= 0; k--) if (MUTATOR_BY_ID[keep[k]].excl === ex) keep.splice(k, 1);
    keep.push(raw);
  }
  return keep.sort((a, b) => MUTATORS.indexOf(MUTATOR_BY_ID[a]) - MUTATORS.indexOf(MUTATOR_BY_ID[b]));
}

/** Toggle one mutator in a list (picking a member of an exclusive set drops the others). */
export function toggleMutator(ids: readonly string[], id: string): string[] {
  if (ids.includes(id)) return ids.filter((x) => x !== id);
  return normaliseMutators([...ids, id]);
}

/** Whether a mutator is offered for this climate / faction. */
export function mutatorEligible(m: MutatorInfo, ctx: MutatorContext): boolean {
  return !m.when || m.when(ctx);
}

/**
 * "Surprise me": `count` (default 2-3) compatible mutators, at most one per group, eligible for the climate and
 * faction. `quick` restricts the pool to the Quick Battle friendly ones, `newcomer` to the newcomer-safe ones.
 * Deterministic for a seed.
 */
export function surpriseMutators(seed: number, ctx: MutatorContext, opts: { count?: number; quick?: boolean; newcomer?: boolean } = {}): string[] {
  const rng = new Rng((seed ^ 0x2c1b3c6d) >>> 0);
  const count = opts.count ?? (rng.chance(0.5) ? 3 : 2);
  const pool = rng.shuffle(MUTATORS.filter((m) => mutatorEligible(m, ctx) && (!opts.quick || m.quick) && (!opts.newcomer || !!m.newcomer)));
  const out: string[] = [];
  const groups = new Set<string>();
  const excl = new Set<string>();
  for (const m of pool) {
    if (out.length >= count) break;
    if (groups.has(m.group) || (m.excl && excl.has(m.excl))) continue;
    groups.add(m.group);
    if (m.excl) excl.add(m.excl);
    out.push(m.id);
  }
  return normaliseMutators(out);
}

// =====================================================================================================
// Layer 1: the setup (before the World exists)
// =====================================================================================================

/** The setup fields mutators override. */
export interface MutableSetup {
  mutators?: string[];
  credits: number;
  fog: boolean;
  weather?: string;
  timeOfDay: 'day' | 'dusk' | 'night';
  dayCycle?: boolean;
  mission?: string;
  conquest?: unknown;
  demo?: boolean;
}

/**
 * The setup with its mutators' conditions applied: Lean Times credits, Clear Skies (no fog), the weather of
 * Night Ops / Blizzard / Sandstorm / Storm Front. Idempotent (a saved setup re-applies to itself), and a no-op
 * for missions, Conquest and setups without mutators.
 */
export function mutateSetup<T extends MutableSetup>(setup: T): T {
  if (setup.mission || setup.conquest || setup.demo) return setup;
  const ids = normaliseMutators(setup.mutators);
  if (!ids.length) return setup;
  const out: T = { ...setup, mutators: ids };
  const has = (id: string) => ids.includes(id);
  if (has('lean-times')) out.credits = Math.min(out.credits, 2500);
  if (has('clear-skies')) out.fog = false;
  if (has('night-ops')) { out.timeOfDay = 'night'; out.dayCycle = false; if (out.weather !== 'fog') out.weather = 'clear'; }
  if (has('blizzard')) out.weather = 'snow';
  if (has('sandstorm')) out.weather = 'dust';
  if (has('storm-front')) out.weather = 'storm';
  return out;
}

// =====================================================================================================
// Layer 2: the rules (a mod merged into the match's mod set)
// =====================================================================================================

/** Id of the generated mod (shown by the "Modded" type markers as its name). */
export const MUTATOR_MOD_ID = 'skirmish-mutators';
const TANKS = ['1tnk', '2tnk', '3tnk', '4tnk', 'ttnk'];

/** The rule changes of these mutators as one mod file, or null when they change no rules. */
export function mutatorMod(ids: readonly string[] | undefined): ModFile | null {
  const list = normaliseMutators(ids);
  const has = (id: string) => list.includes(id);
  const scale: ScaleRule[] = [];
  const units: Record<string, Record<string, unknown>> = {};
  if (has('glass-cannons')) scale.push({ table: 'units', fields: { strength: 0.6 } });
  if (has('glass-base')) scale.push({ table: 'buildings', fields: { strength: 0.5 } });
  if (has('tank-rush')) scale.push({ table: 'units', ids: TANKS, fields: { cost: 0.6 } });
  if (has('fog-plus')) {
    scale.push({ table: 'units', fields: { sight: 0.65 } });
    scale.push({ table: 'buildings', fields: { sight: 0.65 } });
  }
  if (has('big-guns')) {
    // (not the map-wide ones: the nuke, naval guns and the like already reach far enough)
    const ids = Object.values(WEAPONS).filter((w) => w.range < 15 && w.damage > 0).map((w) => w.id);
    scale.push({ table: 'weapons', ids, fields: { range: 1.3 } });
  }
  if (has('heavy-metal')) units['4tnk'] = { owner: ['allies', 'soviet'], prereq: ['weap'] };
  if (!scale.length && !Object.keys(units).length) return null;
  const names = list.filter((id) => ['glass-cannons', 'glass-base', 'tank-rush', 'fog-plus', 'big-guns', 'heavy-metal'].includes(id)).map((id) => MUTATOR_BY_ID[id].name);
  return {
    format: 'rhmod', version: 1, id: MUTATOR_MOD_ID, name: `Mutators: ${names.join(', ')}`.slice(0, 60),
    description: 'Rule changes of the skirmish mutators.', ...(Object.keys(units).length ? { units } : {}), ...(scale.length ? { scale } : {}),
  };
}

/** The match's mod set plus its mutators' rule changes (applied by applyModSet before the World exists). */
export function withMutatorMods(set: ModSet | null | undefined, ids: readonly string[] | undefined): ModSet | undefined {
  const mod = mutatorMod(ids);
  if (!mod) return set ?? undefined;
  return makeModSet([...(set?.mods ?? []).filter((m) => m.id !== MUTATOR_MOD_ID), mod]);
}

// =====================================================================================================
// Layer 3: the world (run by src/sim/events.ts)
// =====================================================================================================

export interface MutatorEffect {
  /** Harvest income multiplier, every player. */
  income?: number;
  /** Production speed multiplier, every player. */
  build?: number;
  /** AI players only. */
  aiIncome?: number;
  aiBuild?: number;
  /** Types nobody may build. */
  ban?: string[];
  /** Extra superweapon / support power charge rate (1 = twice as fast). */
  charge?: number;
  /** Per-tick effect in src/sim/events.ts. */
  live?: 'veteran' | 'rain' | 'bounty' | 'mega-crates';
}

const STATIC_DEFENCE = ['pbox', 'hbox', 'gun', 'agun', 'ftur', 'tsla', 'sam'];

export const MUTATOR_EFFECTS: Record<string, MutatorEffect> = {
  blizzard: { income: 0.8 },
  sandstorm: { income: 0.85 },
  'double-ore': { income: 2 },
  'golden-ore': { income: 3 },
  'credits-rain': { live: 'rain' },
  'veteran-start': { live: 'veteran' },
  'fast-production': { build: 2 },
  'lightning-war': { build: 2, charge: 1 },
  'no-radar': { ban: ['dome'] },
  'tesla-only': { ban: STATIC_DEFENCE.filter((t) => t !== 'tsla' && t !== 'sam' && t !== 'agun') },
  'pillbox-line': { ban: STATIC_DEFENCE.filter((t) => t !== 'pbox' && t !== 'hbox' && t !== 'sam' && t !== 'agun') },
  fanatics: { aiBuild: 1.35, aiIncome: 1.2 },
  bounty: { live: 'bounty' },
  'mega-crates': { live: 'mega-crates' },
};

/** English names of a list (the simulation's battlefield announcements: src/sim/events.ts); display: names.ts mutatorName. */
export function mutatorNames(ids: readonly string[] | undefined): string[] {
  return normaliseMutators(ids).map((id) => MUTATOR_BY_ID[id].name);
}


// =====================================================================================================
// Setup -> World options
// =====================================================================================================

/** The setup fields that switch on the variety systems. */
export interface VarietySetup {
  rules?: 'classic' | 'commander';
  /** Commander economy (sim/economy.ts); see withEconFlag. */
  econ?: boolean;
  mutators?: string[];
  events?: boolean;
  dynamicDifficulty?: boolean;
  demo?: boolean;
  mission?: string;
  conquest?: unknown;
}

/** What withEconFlag reads of a setup. */
export interface EconFlagSetup {
  rules?: 'classic' | 'commander';
  econ?: boolean;
  mission?: string;
  conquest?: unknown;
  demo?: boolean;
  replay?: unknown;
  load?: unknown;
  branch?: unknown;
  challenge?: unknown;
}

/**
 * The setup with its Commander economy flag (sim/economy.ts) made explicit, so recordings and saves carry it.
 * A fresh Commander setup (menu, Quick Battle, autostart) gets the economy; a recorded one (a replay, branch,
 * challenge or save) keeps what it recorded, and one recorded before the economy existed (no field) plays
 * without it, exactly as it was played. Classic setups, missions, Conquest and the menu backdrop are unchanged.
 */
export function withEconFlag<T extends EconFlagSetup>(setup: T): T {
  if (setup.rules !== 'commander' || setup.mission || setup.conquest || setup.demo || typeof setup.econ === 'boolean') return setup;
  return { ...setup, econ: !(setup.replay || setup.load || setup.branch || setup.challenge) };
}

/**
 * World options of a setup's variety systems (src/sim/events.ts). Missions, campaigns, Conquest and the menu
 * backdrop are always Classic with nothing enabled; old saves and replays (no fields) load as Classic.
 */
export function varietyOptions(setup: VarietySetup, isMission: boolean): { rules?: 'classic' | 'commander'; mutators?: string[]; events?: boolean; dynamicDifficulty?: boolean; econ?: boolean } {
  if (isMission || setup.demo || setup.mission || setup.conquest) return {};
  return {
    rules: setup.rules === 'commander' ? 'commander' : undefined,
    econ: setup.rules === 'commander' && typeof setup.econ === 'boolean' ? setup.econ : undefined, // (normalised by withEconFlag)
    mutators: normaliseMutators(setup.mutators),
    events: setup.events,
    dynamicDifficulty: !!setup.dynamicDifficulty,
  };
}
