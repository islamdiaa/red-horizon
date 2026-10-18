/**
 * Commander personalities: trait vectors that bias what an AIController builds, when it attacks and how it
 * fights. A personality never cheats; it only reshapes choices (build order, unit mix, wave timing and size,
 * harassment, retreat threshold, power use). Difficulty still sets income / build speed and how much of the
 * tactical toolbox the AI uses (see SKILL in ai.ts).
 *
 * Traits run 0..1 with 0.5 = neutral. `trait()` maps a trait onto a multiplier that is exactly 1 at 0.5, so the
 * default personality (`balanced`, every trait 0.5) plays like the classic skirmish AI.
 *
 * Personalities are plain JSON (they travel in GameSetup / replays / saves and across worker threads); rivals
 * (src/meta/rivals.ts) derive tweaked copies with `withTweaks`.
 */
import type { Faction } from '../data/rules';

export interface AITuning {
  /** Vehicles below this health fraction leave an assault to be repaired (scaled by the caution trait). */
  retreatHp: number;
  /** A wave whose strength drops below this fraction of the enemy force it faces falls back to regroup. */
  fallbackRatio: number;
  /** A wave reduced to this fraction of its size is broken and returns home. */
  brokenFrac: number;
  /** 0..1: how strongly the unit mix follows the enemy army the AI has seen. */
  counterStrength: number;
  /** Seconds between harassment raids at harass trait 0.5. */
  harassEvery: number;
  /** Army value committed to a harassment raid. */
  harassValue: number;
  /** Fraction of a wave sent on a flanking / feint attack (hard and brutal). */
  flankFrac: number;
  /** Seconds after the start before the AI considers its first expansion. */
  expandAfter: number;
  /** Bank (credits) at which the AI considers paying for an expansion. */
  expandCredits: number;
  /** Seconds a ready nuke is held for an attack wave before it is fired at the best target anyway. */
  nukeHold: number;
  /** Seconds between scouting runs once the enemy base is known (re-scouting keeps intel fresh). */
  rescoutEvery: number;
  /** Attack only when the wave is at least this strong compared with what it knows of the enemy army. */
  attackRatio: number;
  /** Harvesters per refinery, and at most this many more harvesters than refineries. */
  harvPerRef: number;
  harvExtra: number;
  /** Refineries kept near the base once `refAt` seconds have passed (as long as ore is in reach). */
  minRefs: number;
  refAt: number;
  /** Launch a wave early when the idle army is this many times the enemy army seen recently (normal and up). */
  advantage: number;
  /** Hold the wave while the idle army is below this fraction of the enemy army seen recently (normal and up). */
  holdRatio: number;
  /** Multiplier of the difficulty's wave values. */
  waveMul: number;
  /** Multiplier of the difficulty's share of the army sent to defend the base. */
  reactionMul: number;
  /** Medics / mechanics at most this share of the infantry. */
  medicCap: number;
  /** Counter-attack at once after destroying this much enemy value near the base within a minute (0 = never). */
  counterPunch: number;
  /**
   * Feature switches (1 = on) for self-play ablation experiments (tools/selfplay): scouting, wave fall-back,
   * retreat for repairs, focus fire, harassment raids, flanking, expansions, counter-composition. `mapHack` = 1
   * gives the AI the classic omniscient view (experiments only; never set by personalities or rivals).
   */
  scoutOn: number;
  fallbackOn: number;
  retreatOn: number;
  focusOn: number;
  harassOn: number;
  flankOn: number;
  expandOn: number;
  counterOn: number;
  /** Defend outlying structures and harvesters / react to enemy aircraft with AA defences / time superweapons with waves. */
  outlyingOn: number;
  aaOn: number;
  swTimingOn: number;
  mapHack: number;
  /** Commander economy (economy-ai.ts): tiers, upgrades, research and the new structures (0 = ignore them; experiments). */
  econOn: number;
  /** The Allied commander's own tools (ai-allies.ts; skirmish, normal and up): master switch, Longbow strikes, Chronosphere, radar spies, artillery. */
  alliedOn: number;
  heliOn: number;
  chronoOn: number;
  spyOn: number;
  artyOn: number;
  /** Allied AI: wave targets weighed by the reach and price of the defences covering them (Tesla Coils above all). */
  teslaOn: number;
}

/** Defaults (tuned with tools/selfplay/optimize.ts). */
export const DEFAULT_TUNING: AITuning = {
  retreatHp: 0.3,
  fallbackRatio: 0.55,
  brokenFrac: 0.25,
  counterStrength: 0.6,
  harassEvery: 150,
  harassValue: 1600,
  flankFrac: 0.25,
  expandAfter: 600,
  expandCredits: 3500,
  nukeHold: 60,
  rescoutEvery: 180,
  attackRatio: 0.8,
  harvPerRef: 2,
  harvExtra: 2,
  minRefs: 2,
  refAt: 240,
  advantage: 1.4,
  holdRatio: 0.7,
  waveMul: 1,
  reactionMul: 1,
  medicCap: 0.12,
  counterPunch: 2500,
  scoutOn: 1,
  fallbackOn: 1,
  retreatOn: 1,
  focusOn: 1,
  harassOn: 1,
  flankOn: 1,
  expandOn: 1,
  counterOn: 1,
  outlyingOn: 1,
  aaOn: 1,
  swTimingOn: 1,
  mapHack: 0,
  econOn: 1,
  alliedOn: 1,
  heliOn: 1,
  chronoOn: 1,
  spyOn: 1,
  artyOn: 1,
  teslaOn: 1,
};

export interface Personality {
  id: string;
  /** Display name ("Armour Rusher"). */
  name: string;
  /** One line for menus and the rivals board. */
  blurb: string;
  /** Earlier, smaller, more frequent attacks (high) vs late, massive ones (low). */
  aggression: number;
  /** Tech centres, top-tier units and superweapons early. */
  tech: number;
  /** Aircraft share and helipads / airfields. */
  air: number;
  /** Appetite for a navy (fleet size, builds one on smaller seas). */
  naval: number;
  /** Static defences and how much of the army stays home. */
  defence: number;
  /** Raids on harvesters and outlying refineries with fast units. */
  harass: number;
  /** Refineries, harvesters and expansions to new ore fields. */
  economy: number;
  /** Infantry share of the army. */
  infantry: number;
  /** Artillery / V2 share and siege tactics. */
  artillery: number;
  /** Spies, thieves, minelayers, paratroopers and parabombs. */
  subterfuge: number;
  /** Superweapon appetite and how early they are built. */
  superweapons: number;
  /** Retreats damaged units early and avoids bad fights (high) vs fights to the last (low). */
  caution: number;
  /** Unit / structure weight multipliers (e.g. { '4tnk': 2.5, tsla: 2 }). */
  prefer?: Record<string, number>;
  /** Hand-written build orders per faction ([type, how many] in priority order); default: the classic list. */
  goals?: Partial<Record<Faction, [string, number][]>>;
  /** Parameter overrides (optimizer experiments, rival counter-plans). */
  tuning?: Partial<AITuning>;
  /** Free-form tags (rival counter-plan notes, titles); ignored by the AI. */
  tags?: string[];
}

const BASE: Omit<Personality, 'id' | 'name' | 'blurb'> = {
  aggression: 0.5, tech: 0.5, air: 0.5, naval: 0.5, defence: 0.5, harass: 0.5, economy: 0.5, infantry: 0.5, artillery: 0.5,
  subterfuge: 0.5, superweapons: 0.5, caution: 0.5,
};

const P = (p: Partial<Personality> & Pick<Personality, 'id' | 'name' | 'blurb'>): Personality => ({ ...BASE, ...p });

/** Every commander personality, keyed by id. `balanced` is the default (the classic skirmish AI). */
export const PERSONALITIES: Record<string, Personality> = {
  balanced: P({
    id: 'balanced', name: 'Balanced Professor',
    blurb: 'Reads the battlefield and answers it: a sound economy, a mixed army, attacks when ready.',
    // (self-play: one spy and a modest minefield beat a spy ring and 15 mines; agents cost the Allies their first battles)
    subterfuge: 0.25,
  }),
  rusher: P({
    id: 'rusher', name: 'Armour Rusher',
    blurb: 'War factory first, tanks early and often. Hits before your defences are up.',
    aggression: 0.92, tech: 0.25, defence: 0.2, economy: 0.4, infantry: 0.25, artillery: 0.25, superweapons: 0.2, caution: 0.25, air: 0.25, naval: 0.3,
    prefer: { '1tnk': 1.6, '2tnk': 1.5, '3tnk': 1.6, jeep: 1.3, e3: 0.7 },
    goals: {
      allies: [['proc', 1], ['tent', 1], ['weap', 1], ['proc', 2], ['dome', 1], ['weap', 2], ['gun', 1], ['fix', 1], ['proc', 3], ['atek', 1], ['hpad', 1], ['gun', 2], ['agun', 1], ['pbox', 1]],
      soviet: [['proc', 1], ['barr', 1], ['weap', 1], ['proc', 2], ['dome', 1], ['weap', 2], ['ftur', 1], ['fix', 1], ['proc', 3], ['stek', 1], ['tsla', 1], ['sam', 1], ['afld', 1]],
    },
  }),
  turtle: P({
    id: 'turtle', name: 'Tesla Turtle',
    blurb: 'Fortifies every approach, techs up behind the guns and comes out late with overwhelming force.',
    aggression: 0.12, defence: 0.95, tech: 0.75, superweapons: 0.85, economy: 0.6, caution: 0.75, harass: 0.1, air: 0.4,
    prefer: { tsla: 2.2, gun: 1.8, pbox: 1.4, ftur: 1.5, sam: 1.5, agun: 1.5, '4tnk': 1.8, arty: 1.3, v2rl: 1.3 },
    goals: {
      allies: [['tent', 1], ['proc', 1], ['pbox', 1], ['gun', 1], ['weap', 1], ['proc', 2], ['gun', 2], ['dome', 1], ['hbox', 1], ['gun', 3], ['agun', 1], ['atek', 1], ['gap', 1], ['pbox', 2], ['fix', 1], ['proc', 3], ['gun', 5], ['agun', 2], ['pdox', 1], ['mslo', 1], ['hpad', 1], ['weap', 2], ['gun', 7], ['hbox', 3]],
      soviet: [['barr', 1], ['proc', 1], ['ftur', 1], ['weap', 1], ['tsla', 1], ['proc', 2], ['dome', 1], ['tsla', 2], ['ftur', 2], ['sam', 1], ['stek', 1], ['tsla', 3], ['kenn', 1], ['fix', 1], ['proc', 3], ['iron', 1], ['sam', 2], ['mslo', 1], ['tsla', 5], ['afld', 1], ['weap', 2], ['ftur', 4], ['tsla', 6]],
    },
  }),
  admiral: P({
    id: 'admiral', name: 'Naval Raider',
    blurb: 'Rules the waves: an early shipyard, a big fleet, coastal raids and shore bombardment.',
    naval: 1, harass: 0.65, aggression: 0.55, defence: 0.45, air: 0.3,
    prefer: { dd: 1.5, ca: 1.5, ss: 1.6, pt: 1.2, e3: 1.2 },
  }),
  airmarshal: P({
    id: 'airmarshal', name: 'Air Marshal',
    blurb: 'Owns the sky: helipads and airfields early, strike after strike on harvesters and defences.',
    air: 1, aggression: 0.55, harass: 0.6, tech: 0.6, infantry: 0.4,
    prefer: { heli: 2, hind: 2, mig: 2, yak: 1.6, agun: 1.4, sam: 1.4 },
    goals: {
      allies: [['tent', 1], ['proc', 1], ['weap', 1], ['dome', 1], ['hpad', 1], ['proc', 2], ['hpad', 2], ['gun', 1], ['agun', 1], ['atek', 1], ['hpad', 3], ['pbox', 1], ['proc', 3], ['gun', 2], ['agun', 2], ['hpad', 4], ['fix', 1], ['pdox', 1], ['gun', 4], ['mslo', 1]],
      soviet: [['barr', 1], ['proc', 1], ['weap', 1], ['dome', 1], ['afld', 1], ['proc', 2], ['hpad', 1], ['afld', 2], ['sam', 1], ['ftur', 1], ['stek', 1], ['afld', 3], ['tsla', 1], ['proc', 3], ['hpad', 2], ['sam', 2], ['tsla', 2], ['fix', 1], ['iron', 1], ['mslo', 1]],
    },
  }),
  saboteur: P({
    id: 'saboteur', name: 'Saboteur',
    blurb: 'Spies in your power plants, mines on your roads, thieves in your silos and bombs from the sky.',
    subterfuge: 1, harass: 0.7, aggression: 0.4, defence: 0.55, tech: 0.6, caution: 0.6,
    prefer: { spy: 2, thf: 2, mnly: 2, e7: 2, dog: 2, e6: 1, jeep: 1.3 },
    goals: {
      allies: [['tent', 1], ['proc', 1], ['weap', 1], ['dome', 1], ['proc', 2], ['fix', 1], ['gun', 1], ['hbox', 1], ['atek', 1], ['gap', 1], ['pbox', 1], ['weaf', 1], ['facf', 1], ['gun', 2], ['agun', 1], ['proc', 3], ['hpad', 1], ['pdox', 1], ['gun', 4], ['hbox', 2], ['mslo', 1]],
      soviet: [['barr', 1], ['proc', 1], ['kenn', 1], ['weap', 1], ['dome', 1], ['afld', 1], ['proc', 2], ['fix', 1], ['ftur', 1], ['tsla', 1], ['stek', 1], ['sam', 1], ['proc', 3], ['tsla', 2], ['afld', 2], ['iron', 1], ['mslo', 1], ['tsla', 3]],
    },
  }),
  siege: P({
    id: 'siege', name: 'Siege Master',
    blurb: 'Patient and methodical: artillery parks and V2 batteries grind your base down from range.',
    artillery: 1, aggression: 0.35, defence: 0.65, caution: 0.65, tech: 0.55, infantry: 0.35,
    prefer: { arty: 2.6, v2rl: 2.6, '2tnk': 1.1, '3tnk': 1, '4tnk': 1.3, ca: 1.6 },
  }),
  guerrilla: P({
    id: 'guerrilla', name: 'Guerrilla Harasser',
    blurb: 'Never where you expect: fast raiders hit your harvesters and vanish before you can respond.',
    harass: 1, caution: 0.85, aggression: 0.6, economy: 0.55, defence: 0.35, tech: 0.35, infantry: 0.45,
    prefer: { jeep: 2.4, '1tnk': 1.8, dog: 2, yak: 1.6, mig: 1.3, heli: 1.2, e1: 1.2, '3tnk': 0.8, '4tnk': 0.5 },
  }),
  ironfist: P({
    id: 'ironfist', name: 'Iron Fist',
    blurb: 'Heavy armour and nothing but: slow, crushing columns of the best tanks money can buy.',
    tech: 0.8, aggression: 0.45, infantry: 0.15, artillery: 0.3, defence: 0.45, superweapons: 0.65, caution: 0.35,
    prefer: { '4tnk': 2.6, '3tnk': 1.4, '2tnk': 1.6, fix: 1, jeep: 0.4, '1tnk': 0.6 },
    goals: {
      allies: [['tent', 1], ['proc', 1], ['weap', 1], ['proc', 2], ['dome', 1], ['gun', 1], ['fix', 1], ['weap', 2], ['atek', 1], ['proc', 3], ['gun', 2], ['pbox', 1], ['agun', 1], ['pdox', 1], ['hpad', 1], ['gun', 4], ['mslo', 1]],
      soviet: [['barr', 1], ['proc', 1], ['weap', 1], ['proc', 2], ['dome', 1], ['stek', 1], ['ftur', 1], ['fix', 1], ['weap', 2], ['tsla', 1], ['proc', 3], ['sam', 1], ['iron', 1], ['tsla', 2], ['afld', 1], ['mslo', 1], ['tsla', 3]],
    },
  }),
  horde: P({
    id: 'horde', name: 'Human Wave',
    blurb: 'Endless infantry: rifles, rockets, grenades and flamethrowers by the hundred.',
    infantry: 1, aggression: 0.75, tech: 0.3, defence: 0.4, caution: 0.15, economy: 0.45, artillery: 0.4,
    prefer: { e1: 1.4, e2: 1.6, e3: 1.4, e4: 1.8, dog: 1.4, medi: 1.5, apc: 2, pbox: 1.2 },
  }),
  tycoon: P({
    id: 'tycoon', name: 'Tycoon',
    blurb: 'Grabs every ore field on the map, then buries you under a mountain of money.',
    economy: 1, aggression: 0.3, defence: 0.55, tech: 0.6, harass: 0.35, caution: 0.6, superweapons: 0.6,
    prefer: { harv: 1.5, silo: 1 },
    goals: {
      allies: [['tent', 1], ['proc', 1], ['proc', 2], ['weap', 1], ['proc', 3], ['dome', 1], ['gun', 1], ['fix', 1], ['pbox', 1], ['gun', 2], ['atek', 1], ['proc', 4], ['agun', 1], ['hpad', 1], ['weap', 2], ['gun', 4], ['hbox', 1], ['pdox', 1], ['mslo', 1], ['gun', 6]],
      soviet: [['barr', 1], ['proc', 1], ['proc', 2], ['weap', 1], ['proc', 3], ['dome', 1], ['ftur', 1], ['fix', 1], ['tsla', 1], ['stek', 1], ['proc', 4], ['sam', 1], ['afld', 1], ['weap', 2], ['tsla', 2], ['iron', 1], ['mslo', 1], ['tsla', 4]],
    },
  }),
};

export const DEFAULT_PERSONALITY = 'balanced';

/** Trait value → multiplier: 0 → lo, 0.5 → 1, 1 → hi (piecewise linear). */
export function trait(v: number, lo: number, hi: number): number {
  const x = Math.max(0, Math.min(1, v));
  return x <= 0.5 ? lo + (1 - lo) * (x / 0.5) : 1 + (hi - 1) * ((x - 0.5) / 0.5);
}

/** Resolve a personality reference (id, object or nothing) into a complete, independent personality. */
export function resolvePersonality(p?: string | Personality | null): Personality {
  if (!p) return structuredCloneJson(PERSONALITIES[DEFAULT_PERSONALITY]);
  if (typeof p === 'string') return structuredCloneJson(PERSONALITIES[p] ?? PERSONALITIES[DEFAULT_PERSONALITY]);
  const base = PERSONALITIES[p.id] ?? PERSONALITIES[DEFAULT_PERSONALITY];
  // fill any trait the caller left out (older replays / hand-written rival data)
  const out = { ...base, ...structuredCloneJson(p) } as Personality;
  for (const k of TRAITS) if (typeof out[k] !== 'number' || !Number.isFinite(out[k])) out[k] = base[k];
  return out;
}

/** Numeric trait keys (for rivals' counter-plans and the optimizer). */
export const TRAITS = ['aggression', 'tech', 'air', 'naval', 'defence', 'harass', 'economy', 'infantry', 'artillery', 'subterfuge', 'superweapons', 'caution'] as const;
export type TraitKey = (typeof TRAITS)[number];

/** A copy of `base` with trait deltas (clamped to 0..1), extra preferences and tuning merged in. */
export function withTweaks(base: Personality, tweak: { traits?: Partial<Record<TraitKey, number>>; prefer?: Record<string, number>; tuning?: Partial<AITuning>; tags?: string[] }): Personality {
  const out = structuredCloneJson(base);
  for (const [k, d] of Object.entries(tweak.traits ?? {})) {
    const key = k as TraitKey;
    out[key] = Math.max(0, Math.min(1, out[key] + (d ?? 0)));
  }
  if (tweak.prefer) {
    out.prefer = { ...(out.prefer ?? {}) };
    for (const [t, m] of Object.entries(tweak.prefer)) out.prefer[t] = (out.prefer[t] ?? 1) * m;
  }
  if (tweak.tuning) out.tuning = { ...(out.tuning ?? {}), ...tweak.tuning };
  if (tweak.tags) out.tags = [...(out.tags ?? []), ...tweak.tags];
  return out;
}

function structuredCloneJson<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
