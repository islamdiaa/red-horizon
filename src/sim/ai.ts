import { BUILDINGS, UNITS, type BuildingTypeDef, type Faction } from '../data/rules';
import { Building, Entity, Unit } from './entities';
import type { Player } from './player';
import { buildSeconds } from './production';
import { pickWeapon } from './combat';
import { superReady } from './superweapons';
import { TICK_HZ } from './types';
import type { World } from './world';
import { aiNavalStructure, aiNavalThink, aiPlacement } from './ai-naval';
import { contentAI } from './ai-content';
import { aftermathAI, aiManaged } from './aftermath'; // Aftermath units: production share + special-unit use
import { apparentType } from './infiltration';
import { AIIntel, type KnownStructure } from './ai-intel';
import { bestFitness, counterWeights } from './ai-counter';
import { DEFAULT_TUNING, resolvePersonality, trait, type AITuning, type Personality } from './ai-personality';
import { canReach, expansionStructure, expansionPlacement, focusFire, harass, landZones, lanesOpen, manageExpansion, manageRepairs, onRepairPad, retreatDamaged, scouting } from './ai-ops';
import { ceasefireActive, hostileTarget, inHomeArea } from './ceasefire';
import { commanderAI } from './ai-commander';
import { costOf, doctrineDefences, doctrinePrefer } from './doctrine';
import { econAI, econDocks, econPlacement, econReserve, econStructure } from './economy-ai'; // Commander economy
import { alliedAir, alliedArtillery, alliedChrono, alliedSpies, alliedTools, coilPenalty } from './ai-allies'; // the Allied commander's own tools
import { facingNear, outmatchedWave, powerTargets, trackEnemy, waveNeeds } from './ai-engage'; // Classic: when to fight (normal and up)
import { guardHarvesters } from './ai-harvest'; // Classic: Ore Truck care (normal and up)
import { helpMates, humanMates, matePush, spareMatesOre } from './ai-team'; // human teammates (version 5)

export type AIDifficulty = 'recruit' | 'easy' | 'normal' | 'hard' | 'brutal';
/** Every AI difficulty, easiest first (menus, Quick Battle, validation). */
export const AI_DIFFICULTIES: readonly AIDifficulty[] = ['recruit', 'easy', 'normal', 'hard', 'brutal'];
/** Mission behaviour: passive = holds position only; defensive = builds and defends, never attacks. */
export type AIBehaviour = AIDifficulty | 'passive' | 'defensive';

export interface DiffParams {
  buildSpeed: number;
  income: number;
  firstAttack: number;     // seconds before the first wave
  waveValue: number;       // army value needed for the first wave
  waveGrowth: number;
  defenses: number;
  reaction: number;        // fraction of army sent to defend
  superweapons: boolean;
  /**
   * 0..1: how much of the tactical toolbox the AI uses. Recruit and easy play the classic straightforward AI (scouts
   * late, no raids, no retreats); normal adds counter-composition, retreats, focus fire and occasional raids; hard and
   * brutal flank, harass often and time their superweapons.
   */
  skill: number;
  /** Seconds into the match before the first scout goes out. */
  scoutAt: number;
  // --- how much of the economy it runs (skirmish; missions keep their scripted economies)
  /** Refineries at most (build order, extra refineries, expansions) and Ore Trucks at most. */
  maxRefs: number;
  maxHarv: number;
  /** MCV expansions to new ore fields and Commander mining outposts at most. */
  expansions: number;
  outposts: number;
  /** Sends engineers for neutral tech structures (oil derricks and the like) and for the ones its enemies took. */
  neutral: boolean;
  /** 0..1: the share of battlefield events (convoys, airdrops, downed pilots, mercenaries) it takes part in. */
  events: number;
  // --- the Commander economy (economy-ai.ts) and Commander rules (ai-commander.ts)
  /** Highest tech tier, a multiplier of its tier timing, research level per line and research levels in all at most, projects at once, Ore Processors, the structure upgrades it buys (null = any). */
  maxTier: number;
  tierPace: number;
  research: number;
  researchMax: number;
  upgrades: readonly string[] | null;
  projects: number;
  processors: number;
  /** Ore Purifier / Smelter, Logistics Centre and a second lab (the economy's multipliers); the harvesting research lines (Improved Harvesters, Chrono Logistics); bunkers at most. */
  econPlus: boolean;
  econResearch: boolean;
  bunkers: number;
  /** Plays a doctrine; highest commander-power tier it unlocks, how often it reaches for a ready power (0..1), and whether it uses the offensive ones (Barrage, Tesla Storm, Sabotage). */
  doctrine: boolean;
  powerTier: number;
  powerUse: number;
  offensivePowers: boolean;
  /** The commander powers it may use at all (null = any), and the seconds it lets pass between two of them. */
  powers: readonly string[] | null;
  powerGap: number;
  // --- how it fights
  /** Hunts harvesters and refineries (raids, air strikes, wave targets); agents and mines (spies, thieves, minelayers); siege specials (demolition trucks, M.A.D. tanks). */
  raids: boolean;
  agents: boolean;
  siege: boolean;
  /** One wave's value at most, and the land-army value at which it stops adding combat units (credits). */
  waveCap: number;
  armyCap: number;
  /**
   * (recruit and easy) The army cap at the start of the match and how much it grows a minute, up to armyCap: the
   * army grows over the match as a new player's does, instead of the whole starting bank turning into riflemen in the
   * first three minutes (simulation version 5).
   */
  armyStart: number;
  armyRamp: number;
  /** Infantry at most before its first war factory stands. */
  infOpening: number;
  /** Aircraft and ships count toward the army cap too (recruit and easy). */
  capAll: boolean;
  /** Structures of a type at most (recruit and easy: one of each factory, no kennel...); null = the build order decides. */
  maxOf: Readonly<Record<string, number>> | null;
  /** Seconds into the match before its first ground defence (recruit and easy: a new player's first attacks meet an army, not a fortress). */
  defenceAfter: number;
  /** Structures at most, power plants aside (recruit and easy: a new player's base, not a city); UNCAPPED = no limit. */
  maxStructures: number;
  /** Cells in front of the construction yard (toward the enemy) where the army gathers between waves (negative: behind it). */
  rallyAhead: number;
  /** Unit types it never builds (recruit and easy: no artillery, heavies or specials), and combat vehicles at most. */
  noUnits: readonly string[];
  maxVehicles: number;
  /** Seconds an intruder must have been at the base before the army answers, and before a lost structure is rebuilt. */
  defendDelay: number;
  rebuildDelay: number;
  /**
   * Classic skirmish, normal and up (AIController.classicPro, version 6): the army masses until this many seconds into
   * the match before its first wave, unless an enemy attack has just broken on its base (0 = firstAttack decides); and
   * in the first 25 minutes, while its army is under `classicThrift` times its estimate of the enemy's, the luxuries wait
   * whatever the bank (tech centre, extras, a second war factory, a third refinery, expansions; 0 = off).
   */
  classicFirst: number;
  classicThrift: number;
}

const UNCAPPED = 1e9;
/** What the full AI may use (hard and brutal; the easier levels below scale it down). */
const FULL = {
  maxRefs: UNCAPPED, maxHarv: UNCAPPED, expansions: 3, outposts: UNCAPPED, neutral: true, events: 1,
  maxTier: 3, tierPace: 1, research: 2, researchMax: UNCAPPED, upgrades: null, projects: 3, processors: UNCAPPED, econPlus: true, econResearch: true, bunkers: 3,
  doctrine: true, powerTier: 3, powerUse: 1, offensivePowers: true, powers: null, powerGap: 0,
  raids: true, agents: true, siege: true, waveCap: UNCAPPED, armyCap: UNCAPPED, defendDelay: 0, rebuildDelay: 0,
  armyStart: UNCAPPED, armyRamp: 0, infOpening: UNCAPPED, capAll: false, maxOf: null, defenceAfter: 0, maxStructures: UNCAPPED, rallyAhead: 5, noUnits: [], maxVehicles: UNCAPPED,
  classicFirst: 0, classicThrift: 0,
};

/** Recruit and easy (version 5): one barracks, war factory, airfield and helipad; no kennel, decoys or gap generator. */
const LOW_STRUCTURES: Readonly<Record<string, number>> = { tent: 1, barr: 1, weap: 1, afld: 1, hpad: 1, kenn: 0, facf: 0, weaf: 0, gap: 0 };
/** Recruit and easy (version 5): no artillery, heavy or special units (V2s, howitzers, Mammoths, Tesla tanks and the like). */
const LOW_UNITS: readonly string[] = ['v2rl', 'arty', '4tnk', 'ttnk', 'qtnk', 'ctnk', 'stnk', 'dtrk', 'mgg', 'mrj', 'shok', 'e7'];

/**
 * The difficulty levels (simulation version 3: the difficulty overhaul, docs/BALANCE.md). Recruit and easy are
 * scaled down everywhere: one or two refineries and few trucks, no expansions, outposts or derrick hunting, late and
 * capped tech, no doctrine and at most Field Repair among the commander powers, small capped waves, no raids on
 * harvesters, no agents or mines, no superweapons, slow reactions and slow rebuilding. Measured against scripted
 * human stand-ins (tools/selfplay/standins.ts).
 */
const DIFF: Record<AIDifficulty, DiffParams> = {
  recruit: {
    buildSpeed: 0.5, income: 0.7, firstAttack: 600, waveValue: 1000, waveGrowth: 300, defenses: 1, reaction: 0.3, superweapons: false, skill: 0.1, scoutAt: 240,
    maxRefs: 1, maxHarv: 2, expansions: 0, outposts: 0, neutral: false, events: 0,
    maxTier: 1, tierPace: 2, research: 0, researchMax: 0, upgrades: [], projects: 0, processors: 0, econPlus: false, econResearch: false, bunkers: 0,
    doctrine: false, powerTier: 0, powerUse: 0, offensivePowers: false, powers: [], powerGap: 120,
    raids: false, agents: false, siege: false, waveCap: 3000, armyCap: 4000, defendDelay: 15, rebuildDelay: 150,
    armyStart: 1200, armyRamp: 250, infOpening: 6, capAll: true, maxOf: LOW_STRUCTURES, defenceAfter: 600, maxStructures: 10, rallyAhead: -3, noUnits: LOW_UNITS, maxVehicles: 2,
    classicFirst: 0, classicThrift: 0,
  },
  easy: {
    buildSpeed: 0.6, income: 0.75, firstAttack: 540, waveValue: 1800, waveGrowth: 700, defenses: 1, reaction: 0.4, superweapons: false, skill: 0.3, scoutAt: 150,
    maxRefs: 2, maxHarv: 3, expansions: 0, outposts: 0, neutral: false, events: 0,
    maxTier: 2, tierPace: 3, research: 1, researchMax: 1, upgrades: ['powr_turbine'], projects: 1, processors: 0, econPlus: false, econResearch: false, bunkers: 0,
    doctrine: false, powerTier: 1, powerUse: 0.35, offensivePowers: false, powers: ['repair'], powerGap: 120,
    raids: false, agents: false, siege: false, waveCap: 3000, armyCap: 6000, defendDelay: 6, rebuildDelay: 60,
    armyStart: 1500, armyRamp: 300, infOpening: 8, capAll: true, maxOf: LOW_STRUCTURES, defenceAfter: 600, maxStructures: 12, rallyAhead: -3, noUnits: LOW_UNITS, maxVehicles: 4,
    classicFirst: 0, classicThrift: 0,
  },
  normal: {
    buildSpeed: 1.0, income: 1.05, firstAttack: 420, waveValue: 3500, waveGrowth: 1800, defenses: 3, reaction: 0.7, superweapons: true, skill: 0.6, scoutAt: 70,
    ...FULL,
    maxRefs: 3, maxHarv: 6, expansions: 1, outposts: 1, events: 0.6,
    tierPace: 1.3, researchMax: 4, projects: 2, processors: 2, econPlus: false, bunkers: 2,
    powerUse: 0.6, powerGap: 45, powers: ['recon', 'repair', 'funds', 'rally', 'elite', 'barrage', 'reinforce', 'aegis'], // (no Tesla Storm or Sabotage)
    waveCap: 12000, armyCap: 30000, defendDelay: 2, rebuildDelay: 20,
    classicThrift: 1,
  },
  hard: {
    buildSpeed: 1.05, income: 1.05, firstAttack: 300, waveValue: 3500, waveGrowth: 2000, defenses: 4, reaction: 0.85, superweapons: true, skill: 0.85, scoutAt: 45,
    ...FULL,
    expansions: 2, outposts: 2, events: 0.8, tierPace: 1.1, processors: 3, powerUse: 0.8, powerGap: 30,
    classicFirst: 780, classicThrift: 1,
  },
  brutal: { buildSpeed: 1.4, income: 1.35, firstAttack: 210, waveValue: 3500, waveGrowth: 2200, defenses: 5, reaction: 1, superweapons: true, skill: 1, scoutAt: 30, ...FULL },
};

/**
 * Scripted missions (campaigns, special operations, co-op survival) keep the version-2 levels their balance was built
 * on: the classic economy and timing, none of the skirmish caps.
 */
const MISSION_DIFF: Record<AIDifficulty, DiffParams> = {
  recruit: DIFF.recruit,
  easy: { buildSpeed: 0.65, income: 0.9, firstAttack: 600, waveValue: 3200, waveGrowth: 1200, defenses: 2, reaction: 0.4, superweapons: false, skill: 0.3, scoutAt: 150, ...FULL },
  normal: { buildSpeed: 0.95, income: 1.0, firstAttack: 420, waveValue: 3500, waveGrowth: 1800, defenses: 3, reaction: 0.7, superweapons: true, skill: 0.6, scoutAt: 70, ...FULL },
  hard: { buildSpeed: 1.15, income: 1.15, firstAttack: 300, waveValue: 3500, waveGrowth: 2000, defenses: 4, reaction: 0.85, superweapons: true, skill: 0.85, scoutAt: 45, ...FULL },
  brutal: { buildSpeed: 1.4, income: 1.35, firstAttack: 210, waveValue: 3500, waveGrowth: 2200, defenses: 5, reaction: 1, superweapons: true, skill: 1, scoutAt: 30, ...FULL },
};

/** A scripted mission (campaign, special operation, co-op, Conquest), not a skirmish-based mode runtime (King of the Hill, challenges). */
export function scriptedMission(w: Pick<World, 'mission'>): boolean {
  const id = w.mission?.def.id;
  return !!id && id !== 'koth' && id !== 'challenge';
}

/** A difficulty's parameters (read-only; tools and tests). */
export function difficultyParams(d: AIDifficulty, mission = false): Readonly<DiffParams> {
  return (mission ? MISSION_DIFF : DIFF)[d] ?? DIFF.normal;
}

/**
 * [type, how many] goals in priority order. Power is handled separately.
 * (Allies: the third refinery, second war factory and service depot come before the Tech Center, whose
 * $1500 and 200 power cost the Allies the decisive first battles in self-play, and the decoys, gap generator and
 * second helipad wait until the core is built: Allied win share on generated land maps at equal difficulty went from
 * about 15-20% to 30-38% (tools/selfplay/run.ts).)
 */
const GOALS: Record<Faction, [string, number][]> = {
  allies: [
    ['tent', 1], ['proc', 1], ['weap', 1], ['proc', 2], ['dome', 1], ['gun', 1], ['pbox', 1], ['gun', 2],
    ['proc', 3], ['weap', 2], ['fix', 1], ['atek', 1], ['agun', 1], ['hpad', 1], ['hbox', 1], ['gun', 3], ['gun', 4], ['agun', 2], ['pbox', 2], ['pdox', 1], ['mslo', 1], ['gun', 6], ['pbox', 4], ['weaf', 1], ['gap', 1], ['hpad', 2], ['facf', 1], ['hbox', 2],
  ],
  soviet: [
    ['barr', 1], ['proc', 1], ['weap', 1], ['proc', 2], ['dome', 1], ['ftur', 1], ['tsla', 1], ['kenn', 1],
    ['stek', 1], ['sam', 1], ['afld', 1], ['ftur', 2], ['tsla', 2], ['proc', 3], ['hpad', 1], ['weap', 2], ['fix', 1], ['sam', 2], ['tsla', 3], ['iron', 1], ['mslo', 1], ['tsla', 4], ['ftur', 4],
  ],
};

/**
 * Skirmish build orders (missions keep GOALS, which their balance assumes). Allies: the third refinery and the
 * second war factory before the second turret and the pillbox, so the army keeps pace with the Soviet armour, and
 * the Chronosphere and the Missile Silo last, as a luxury of a floating economy (`allowed`). Self-play
 * (tools/selfplay): +4 and +6 points of Allied win share at equal difficulty.
 */
const SKIRMISH_GOALS: Record<Faction, [string, number][]> = {
  allies: [
    ['tent', 1], ['proc', 1], ['weap', 1], ['proc', 2], ['dome', 1], ['gun', 1], ['proc', 3], ['weap', 2], ['gun', 2], ['fix', 1], ['pbox', 1],
    ['atek', 1], ['agun', 1], ['hpad', 1], ['hbox', 1], ['gun', 3], ['gun', 4], ['agun', 2], ['pbox', 2], ['gun', 6], ['pbox', 4], ['weaf', 1], ['gap', 1], ['hpad', 2], ['facf', 1], ['hbox', 2],
    ['pdox', 1], ['mslo', 1],
  ],
  soviet: GOALS.soviet,
};

/**
 * Classic skirmish build orders, normal and up (AIController.classicPro): the core of a tank army first (two
 * refineries, the war factory, radar, three defences, the service depot, and for the Soviets the airfield and its
 * free support powers), then the third refinery, the tech centre and the rest; no decoys. The AI spent about
 * $27,000 a game on structures against the casual stand-in's $16,000, and fielded half his army. The extras
 * (PRO_EXTRAS) wait until the money floats or the army is ahead.
 */
const CLASSIC_GOALS: Record<Faction, [string, number][]> = {
  allies: [
    ['tent', 1], ['proc', 1], ['weap', 1], ['proc', 2], ['dome', 1], ['gun', 1], ['pbox', 1], ['gun', 2], ['fix', 1], ['proc', 3], ['weap', 2],
    ['atek', 1], ['hbox', 1], ['gun', 3], ['agun', 1], ['hpad', 1], ['gun', 4], ['pbox', 2], ['agun', 2], ['gun', 6], ['pbox', 4], ['hpad', 2], ['gap', 1],
    ['pdox', 1], ['mslo', 1],
  ],
  soviet: [
    ['barr', 1], ['proc', 1], ['weap', 1], ['proc', 2], ['dome', 1], ['ftur', 1], ['tsla', 1], ['afld', 1], ['tsla', 2], ['fix', 1], ['proc', 3],
    ['weap', 2], ['stek', 1], ['sam', 1], ['ftur', 2], ['kenn', 1], ['tsla', 3], ['hpad', 1], ['sam', 2], ['iron', 1], ['mslo', 1], ['tsla', 4], ['ftur', 4],
  ],
};
/** Classic, normal and up: structures that wait until the bank covers most of their price or the army is ahead. */
const PRO_EXTRAS = new Set(['hpad', 'kenn', 'gap', 'pdox', 'mslo', 'iron', 'agun', 'sam']);

/** The first attack wave commits at most this multiple of the difficulty's wave value. */
const FIRST_WAVE_CAP = 1.3;

/**
 * Build-up time (skirmish ceasefire, ceasefire.ts). `cap`: the army value (credits) an AI grows to while the
 * ceasefire holds; land unit production pauses there (harvesters, structures and defences go on), so an unlimited
 * ceasefire doesn't build forever. `commit`: the share of the army (by value) the first wave after a timed
 * ceasefire throws at the enemy; the rest stays home. `min`: the smallest army that still opens with that wave.
 */
// (version 3: recruit and easy grow small armies and open with under half of them; normal's grand wave is also capped
// by its wave cap, $12,000)
export const BUILDUP: Record<AIDifficulty, { cap: number; commit: number; min: number }> = {
  recruit: { cap: 4000, commit: 0.4, min: 1500 },
  easy: { cap: 7000, commit: 0.45, min: 2000 },
  normal: { cap: 16000, commit: 0.6, min: 3000 },
  hard: { cap: 30000, commit: 0.85, min: 3500 },
  brutal: { cap: 40000, commit: 0.9, min: 3500 },
};

export const DEFENSES = new Set(['gun', 'pbox', 'hbox', 'ftur', 'tsla']);
export const AIR_DEFENSE = new Set(['agun', 'sam']);

const INF_MIX: Record<Faction, [string, number][]> = {
  allies: [['e1', 45], ['e3', 35], ['medi', 8], ['e7', 4]],
  soviet: [['e1', 40], ['e2', 22], ['e3', 25], ['e4', 10], ['dog', 6]],
};
const AIR_MIX: Record<Faction, [string, number][]> = {
  allies: [['heli', 1]],
  soviet: [['hind', 35], ['mig', 40], ['yak', 25]],
};
const VEH_MIX: Record<Faction, [string, number][]> = {
  allies: [['2tnk', 46], ['1tnk', 24], ['jeep', 6], ['arty', 16]],
  soviet: [['3tnk', 50], ['v2rl', 16], ['4tnk', 28]],
};
/** Classic, normal and up (AIController.classicPro): infantry per combat vehicle (plus four), and before the war factory. */
const PRO_INF_PER_VEH = 0.6;
const PRO_INF_OPENING = 10;
/** Classic, normal and up: the longest a ready army holds back for want of an edge while the enemy doesn't attack either (s). */
const PRO_HOLD = 300;
const ARTILLERY = new Set(['arty', 'v2rl']);
const FAST_RAIDERS = new Set(['jeep', '1tnk', 'dog']);

/** Notable decisions, for the rivals' radio (UI only: never read by the simulation, not saved). */
export interface AIChatter {
  tick: number;
  kind: 'scouted' | 'attack' | 'flank' | 'harass' | 'fallback' | 'expand' | 'nuke' | 'ironcurtain' | 'chrono' | 'broken';
  x?: number;
  y?: number;
}

/** An expansion in progress (ai-ops.ts): MCV to a new ore field, then a refinery and a defence there. */
export interface Expansion {
  x: number;
  y: number;
  stage: 'build' | 'move' | 'yard' | 'defend';
  mcv: number;
  started: number;
}

export class AIController {
  personality: Personality;
  tune: AITuning;
  intel: AIIntel;
  state: 'build' | 'attack' = 'build';
  stage: 'gather' | 'assault' = 'assault';
  stageX = 0;
  stageY = 0;
  stageTarget: [number, number] = [0, 0];
  stageStart = 0;
  wave = new Set<number>();
  waveStart = 0;
  nextWaveValue: number;
  lastDefend = -9999;
  deployTries = 0;
  behaviour: 'full' | 'passive' | 'defensive' = 'full';
  // --- strategic state (saved by saveState)
  /** Part of the current wave sent on a flanking / feint attack. */
  flank = new Set<number>();
  flankTarget: [number, number] | null = null;
  flankX = 0;
  flankY = 0;
  /** Wave value (cost x health) when it set out, and fall-backs so far. */
  waveValueStart = 0;
  regroups = 0;
  lastFallback = -9999;
  waves = 0;
  /** Damaged vehicles pulled out of a fight for repairs. */
  repairs = new Set<number>();
  focus = 0;
  focusUntil = 0;
  scout = 0;
  lastScout = -9999;
  scoutPlan: [number, number][] = [];
  raid = new Set<number>();
  raidX = 0;
  raidY = 0;
  raidStart = 0;
  raidValue = 0;
  lastRaid = -9999;
  expansion: Expansion | null = null;
  escort = new Set<number>();
  expansions = 0;
  lastExpandTry = -9999;
  nukeSince = -1;
  chronoSince = -1;
  /** Allied AI (ai-allies.ts): spies sent for the enemy Radar Dome so far, and when the last one was bought. */
  spyTries = 0;
  lastSpy = -9999;
  /** The spy on its way to the enemy Radar Dome (0 = none). */
  radarSpy = 0;
  /** Tick an intruder was first seen at the base (-1 = none); structure types lost and not yet replaced (tick of the loss), and the most of each type it has stood. */
  threatSince = -1;
  /** Tick of its last commander power (the gap between two of them, ai-commander.ts). */
  lastPower = -99999;
  lostAt: Record<string, number> = {};
  had: Record<string, number> = {};
  /** Classic (ai-engage.ts): the enemy army it reckons with (credits) and the tick of that estimate. */
  enemyEst = 0;
  estTick = 0;
  /** Classic (ai-engage.ts): tick an enemy force of real size (not a scout or a paradrop) was last seen at the base. */
  lastAssault = -99999;
  /** Classic siege (version 5): the wave value the regrouped wave waits for before it goes in again (0 = no siege). */
  siegeNeed = 0;
  /** Team play (ai-team.ts): tick a human teammate's base was first seen under attack (-1 = none), and of the last help sent. */
  mateThreat = -1;
  lastMateHelp = -99999;
  /** UI feed (rivals radio). */
  chatter: AIChatter[] = [];
  private foundSaid = false;

  get player(): Player {
    return this.p;
  }

  /** The difficulty's parameters (scripted missions keep the version-2 levels: MISSION_DIFF). */
  get d(): DiffParams {
    return difficultyParams(this.difficulty, scriptedMission(this.world));
  }

  /** Switch behaviour mid-game (missions). */
  setMode(mode: AIBehaviour) {
    const first = !this.modeSet;
    this.modeSet = true;
    if (mode === 'passive' || mode === 'defensive') {
      this.behaviour = mode;
      // (a mission AI that only ever gets a behaviour: the mission levels' economy, once, before the mission's setup)
      if (!first || !scriptedMission(this.world)) return;
    } else {
      this.behaviour = 'full';
      if (DIFF[mode]) this.difficulty = mode;
    }
    this.p.buildSpeed = this.d.buildSpeed;
    this.p.incomeBias = this.d.income;
  }
  private modeSet = false;

  constructor(public world: World, public p: Player, public difficulty: AIDifficulty, personality?: string | Personality | null) {
    if (!DIFF[difficulty]) this.difficulty = difficulty = 'normal'; // (unknown level from an old or hand-made record)
    this.personality = resolvePersonality(personality);
    this.tune = { ...DEFAULT_TUNING, ...(this.personality.tuning ?? {}) };
    this.intel = new AIIntel(world, p);
    this.intel.mapHack = !!this.tune.mapHack;
    this.intel.powerAware = !!this.tune.proPower;
    p.buildSpeed = this.d.buildSpeed;
    p.incomeBias = this.d.income;
    this.nextWaveValue = this.d.waveValue;
  }

  /** Think calls so far. Periodic tasks gate on this rather than world.tick: AIs think on staggered ticks. */
  thinks = 0;
  /** True once every `ticks` sim ticks of thinking (think() runs every 10 ticks). */
  due(ticks: number) {
    return this.thinks % Math.max(1, Math.round(ticks / 10)) === 0;
  }

  /** Skirmish-only tactics (missions are balanced around the classic AI). */
  get skirmish(): boolean {
    return !this.world.mission;
  }

  /** Plays the version-3 skirmish levels (everything but scripted missions, which keep MISSION_DIFF and their classic AI). */
  get levelled(): boolean {
    return !scriptedMission(this.world);
  }

  /**
   * Classic rules in a skirmish, normal and up: the Classic commander's own judgement (simulation version 4). In pure
   * Red Alert rules main battle tanks decide the fights, so the army is built tank-first, and waves are weighed
   * against everything it has seen of the enemy (army and defences) before they go. Commander rules, the easier
   * levels and every mission keep the version-3 behaviour.
   */
  get classicPro(): boolean {
    return !this.world.commander && this.skirmish && this.d.skill >= 0.6;
  }

  /** Build-up time (ceasefire.ts): no offensive action of any kind, only building and defending. */
  get ceasefire(): boolean {
    return ceasefireActive(this.world);
  }

  /** The first wave after a timed ceasefire: everything built up goes in at once (normal play after it). */
  get grandWave(): boolean {
    const end = this.world.ceasefireUntil;
    return end > 0 && this.world.tick >= end && this.waves === 0;
  }

  /** Army value (credits) of the land army: what the build-up cap and the grand wave are measured in. */
  armyValue(units: Unit[] = this.myUnits()): number {
    let v = 0;
    for (const u of units) if (u.weapons.length && !u.ut.harvester && !u.ut.deploysInto && !u.ut.medic && u.kind !== 'aircraft' && u.kind !== 'naval' && !aiManaged(u)) v += u.ut.cost;
    return v;
  }

  /** The level's army cap right now (recruit and easy: it grows over the match, armyStart + armyRamp a minute). */
  armyCapNow(): number {
    const d = this.d;
    return Math.min(d.armyCap, d.armyStart + d.armyRamp * (this.world.time / 60));
  }

  /** What the level's army cap counts: the land army, and on the levels that count them (capAll) aircraft and ships. */
  capValue(units: Unit[] = this.myUnits()): number {
    let v = this.armyValue(units);
    if (this.d.capAll) for (const u of units) if ((u.kind === 'aircraft' || u.kind === 'naval') && u.weapons.length && !u.ut.supportPlane) v += u.ut.cost;
    return v;
  }

  /** The army has reached the level's cap (recruit, easy and normal): no more combat units for now. `extra`: ordered this think. */
  atArmyCap(units?: Unit[], extra = 0): boolean {
    if (this.d.armyCap >= UNCAPPED) return false;
    let v = this.capValue(units) + extra;
    // (recruit and easy: what is already in production counts too, so three factories at once don't overshoot it)
    if (this.d.capAll) for (const q of [this.p.queues.infantry, this.p.queues.vehicle, this.p.queues.aircraft]) for (const it of q.items) {
      const t = UNITS[it.type];
      if (t && t.primary && !t.harvester && !t.deploysInto) v += t.cost;
    }
    return v >= this.armyCapNow();
  }

  /** During the ceasefire: the army has reached its build-up size for this difficulty (land production pauses). */
  atBuildupCap(units?: Unit[]): boolean {
    return this.ceasefire && this.armyValue(units) >= BUILDUP[this.difficulty].cap;
  }

  think() {
    this.thinks++;
    const p = this.p;
    if (p.defeated) return;
    if (this.behaviour === 'passive') { this.intel.update(); this.defendOnly(); return; }
    this.intel.update();
    if (this.classicPro) trackEnemy(this);
    if (!this.foundSaid && this.intel.foundTick >= 0 && !this.intel.omniscient) {
      this.foundSaid = true;
      const [bx, by] = this.baseCenter();
      const e = this.intel.enemyBase(bx, by);
      this.say('scouted', e?.[0], e?.[1]);
    }
    if (this.tune.endConcede > 0 && this.due(TICK_HZ * 2) && this.lastStand()) return;
    this.handleMcv();
    this.placeReadyStructure();
    if (this.d.rebuildDelay > 0 && this.due(TICK_HZ * 2)) this.noteLosses();
    this.planStructures();
    this.planUnits();
    this.recoverEconomy();
    this.repairBase();
    aiNavalThink(this.world, this.p, this.thinks, this.difficulty, this.behaviour !== 'full' || this.ceasefire, this); // (ceasefire: home waters only)
    if (this.behaviour === 'defensive') { this.defendOnly(); return; }
    if (this.skirmish) {
      scouting(this);
      manageExpansion(this);
    }
    this.military();
    if (this.classicPro) guardHarvesters(this);
    if (this.skirmish && this.behaviour === 'full') { const mates = humanMates(this); if (mates.length) spareMatesOre(this, mates); } // (a human teammate's ore is his)
    if (this.skirmish) harass(this);
    this.airStrikes();
    this.superweapons();
    contentAI(this);
    if (this.tune.spyOn && this.d.skill >= 0.5 && alliedTools(this)) alliedSpies(this); // a spy for the enemy Radar Dome (shared radar)
    if (this.world.commander) commanderAI(this); // commander powers (Commander rules only)
    if (this.world.econ) econAI(this); // tiers, upgrades, research, bunker garrisons (Commander economy)
    aftermathAI(this); // builds ttnk/qtnk/dtrk/shok/msub/ctnk/stnk/mech, drives qtnk/dtrk/ctnk/mech/msub
    if (this.chatter.length > 40) this.chatter.splice(0, this.chatter.length - 40);
  }

  /**
   * Version 6: beaten. With no Construction Yard or MCV to rebuild with and no factory it can pay to train an army in, an AI can't
   * come back: what army it has goes for the enemy (the last stand), and once that is down to less than
   * tune.endConcede credits it concedes, as a player would (resign.ts), instead of keeping the match alive with a
   * helicopter over the map, an Ore Truck in a corner or a power plant nobody has found. Skirmishes only; never while a
   * human teammate plays on (the side fights on), and with an AI teammate still in the game it fights on without
   * conceding (a surrender concedes for the whole side). Returns true when it has nothing else to do.
   */
  private lastStand(): boolean {
    const w = this.world, p = this.p;
    if (!this.levelled || w.mission || this.ceasefire) return false;
    // (a factory keeps it in the game while it can pay for units: a refinery, or money in the bank)
    let factory = false;
    for (const b of w.buildings) {
      if (!b.alive || b.owner !== p) continue;
      if (b.bt.id === 'fact') return false;
      // (a helipad or an airfield alone doesn't: aircraft can't take back a map)
      if (b.bt.factory && b.bt.factory !== 'building' && b.bt.factory !== 'aircraft') factory = true;
    }
    if (factory && (p.credits >= 1000 || p.has('proc'))) return false;
    const units = this.myUnits();
    if (units.some((u) => u.ut.deploysInto)) return false;
    if (humanMates(this).length) return false;
    const army = this.army();
    // (a teammate still in the game: no surrender, which would concede for the whole side, resign.ts)
    const mates = w.players.some((q) => q !== p && q.team === p.team && !q.defeated);
    if (!mates && this.armyValue(army) < this.tune.endConcede) {
      w.issue({ c: 'resign', player: p.id });
      return true;
    }
    const idle = army.filter((u) => (u.order.type === 'idle' || u.order.type === 'guard') && !u.target);
    if (idle.length) {
      const t = this.pickAttackTarget(idle[0].x, idle[0].y);
      if (t) w.issue({ c: 'move', player: p.id, units: idle.map((u) => u.id), x: t[0], y: t[1], attackMove: true });
    }
    return true;
  }

  /**
   * Classic, normal and up: the army-to-estimate ratio under which the luxuries wait (DiffParams.classicThrift;
   * tune.proThrift experiments), for the first 25 minutes: in a longer war the tech centre and the rest come back.
   */
  thrift(): number {
    return this.world.time >= 1500 ? 0 : this.tune.proThrift || this.d.classicThrift;
  }

  /**
   * Version 6: broke. No Ore Truck left, an empty bank and ore still on the map: an expansion MCV waiting in the queue is
   * cancelled (what was paid comes back), and what the base can spare is sold, one structure at a time, until a truck is
   * paid for. AIs used to sit out the rest of the match with $2 and an Ore Truck half paid for in the queue. Skirmishes
   * only (scripted missions keep the AI they were balanced with).
   */
  private recoverEconomy() {
    const w = this.world, p = this.p;
    if (!this.skirmish || !this.due(TICK_HZ * 5) || p.credits >= 100 || !p.has('proc') || !p.has('fact')) return;
    const mine = this.myBuildings();
    if (mine.some((b) => b.selling >= 0)) return; // (one sale at a time)
    if (this.myUnits().some((u) => u.ut.harvester)) return;
    if (this.oreCellsNear(36) < 12) return; // (a mined-out map: a truck would not pay for itself)
    const vq = p.queues.vehicle;
    if (vq.items.some((i) => i.type === 'mcv')) {
      w.issue({ c: 'cancel', player: p.id, type: 'mcv' });
      this.expansion = null;
      return;
    }
    if (!vq.items.some((i) => i.type === 'harv')) return; // (planUnits queues the truck first)
    const n = (t: string) => mine.filter((b) => b.bt.id === t).length;
    const spare = (b: Building): number => {
      const t = b.bt.id;
      if (t === 'fact' || t === 'proc' || b.bt.wall || b.bt.mine || !b.active) return -1;
      if ((t === 'weap' || t === 'tent' || t === 'barr') && n(t) <= 1) return -1;
      if ((t === 'powr' || t === 'apwr') && p.powerOut - (b.bt.power ?? 0) < p.powerUse) return -1;
      // (luxuries first, then a second factory, then the defences)
      if (b.bt.superweapon || t === 'silo' || t === 'gap' || t === 'kenn' || t === 'hpad' || t === 'afld' || t === 'atek' || t === 'stek' || t === 'fix') return 3;
      if (t === 'weap' || t === 'tent' || t === 'barr' || t === 'dome') return 2;
      return 1;
    };
    let best: Building | null = null, bs = 0;
    for (const b of mine) {
      const v = spare(b);
      if (v > bs || (v === bs && v > 0 && best && b.bt.cost > best.bt.cost)) { bs = v; best = b; }
    }
    if (best) w.issue({ c: 'sell', player: p.id, building: best.id });
  }

  /** Which structure types were lost (for the rebuild delay of the easier levels). */
  private noteLosses() {
    const now: Record<string, number> = {};
    for (const b of this.world.buildings) if (b.alive && b.owner === this.p && !b.bt.wall && !b.bt.mine && b.bt.id !== 'fact') now[b.bt.id] = (now[b.bt.id] ?? 0) + 1;
    for (const t of Object.keys(this.had).sort()) {
      const n = now[t] ?? 0;
      if (n < this.had[t]) { if (this.lostAt[t] === undefined) this.lostAt[t] = this.world.tick; }
      else delete this.lostAt[t];
    }
    for (const [t, n] of Object.entries(now)) if (n > (this.had[t] ?? 0)) this.had[t] = n;
    for (const t of Object.keys(this.lostAt)) if ((now[t] ?? 0) >= this.had[t]) delete this.lostAt[t];
  }

  say(kind: AIChatter['kind'], x?: number, y?: number) {
    this.chatter.push({ tick: this.world.tick, kind, x, y });
  }

  // ---------------------------------------------------------------------------
  myBuildings(): Building[] {
    return this.world.buildings.filter((b) => b.alive && b.owner === this.p);
  }
  myUnits(): Unit[] {
    return this.world.units.filter((u) => u.alive && u.owner === this.p);
  }
  count(type: string): number {
    let n = 0;
    for (const b of this.world.buildings) if (b.alive && b.owner === this.p && b.bt.id === type) n++;
    const q = this.p.queues.structure;
    if (q.ready === type) n++;
    if (q.items[0]?.type === type) n++;
    return n;
  }

  baseCenter(): [number, number] {
    const fact = this.world.buildings.find((b) => b.alive && b.owner === this.p && b.bt.id === 'fact');
    if (fact) return [fact.x, fact.y];
    const bs = this.myBuildings();
    if (bs.length) return [bs.reduce((s, b) => s + b.x, 0) / bs.length, bs.reduce((s, b) => s + b.y, 0) / bs.length];
    const s = this.world.map.startPositions[this.p.id % this.world.map.startPositions.length];
    return [s.x, s.y];
  }

  /** Nearest enemy base as far as the AI knows (intel), else the nearest enemy it has seen. */
  enemyCenter(): [number, number] | null {
    const [bx, by] = this.baseCenter();
    const guess = this.intel.enemyBase(bx, by);
    if (guess) return guess;
    let best: [number, number] | null = null, bestD = Infinity;
    for (const s of this.intel.units.values()) {
      const d = Math.hypot(s.x - bx, s.y - by);
      if (d < bestD) { bestD = d; best = [s.x, s.y]; }
    }
    return best;
  }

  enemyDir(): [number, number] {
    const [bx, by] = this.baseCenter();
    const e = this.enemyCenter() ?? [this.world.map.w / 2, this.world.map.h / 2];
    const dx = e[0] - bx, dy = e[1] - by;
    const l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l];
  }

  // ---------------------------------------------------------------------------
  private handleMcv() {
    if (this.p.has('fact')) return;
    const mcv = this.myUnits().find((u) => u.ut.deploysInto);
    if (!mcv || mcv.order.type === 'deploy' || mcv.moving || mcv.path) return;
    if (this.world.canDeploy(mcv)) {
      this.world.issue({ c: 'deploy', player: this.p.id, units: [mcv.id] });
    } else {
      this.deployTries++;
      // (version 6: straight to the nearest spot where the yard fits; the spiral alone wandered round a cramped start
      // on ore and trees for the whole match without ever stopping where it could deploy)
      const spot = this.deploySpot(mcv);
      if (spot && Math.hypot(spot[0] - mcv.x, spot[1] - mcv.y) > 0.3) { this.world.issue({ c: 'move', player: this.p.id, units: [mcv.id], x: spot[0], y: spot[1] }); return; }
      const a = this.deployTries * 2.1;
      const r = 1.5 + this.deployTries * 0.5;
      this.world.issue({ c: 'move', player: this.p.id, units: [mcv.id], x: mcv.x + Math.cos(a) * r, y: mcv.y + Math.sin(a) * r });
    }
  }

  /** The nearest place (up to 16 cells away, on the MCV's own ground) where its Construction Yard fits; the MCV's position there. */
  private deploySpot(mcv: Unit): [number, number] | null {
    const w = this.world, m = w.map, bt = BUILDINGS[mcv.ut.deploysInto!];
    const [sw, sh] = bt.size;
    const zones = landZones(m);
    const fx = Math.floor(mcv.x), fy = Math.floor(mcv.y), z = zones[m.idx(fx, fy)];
    for (let r = 0; r <= 16; r++) {
      let best: [number, number] | null = null, bd = Infinity;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = fx + dx - (sw >> 1), ty = fy + dy - (sh >> 1);
        let ok = true;
        for (let y = ty; y < ty + sh && ok; y++) for (let x = tx; x < tx + sw; x++) if (!m.buildable(x, y)) { ok = false; break; }
        const cx = tx + sw / 2, cy = ty + sh / 2;
        if (!ok || (z && zones[m.idx(Math.floor(cx), Math.floor(cy))] !== z)) continue;
        // (another side's units standing there block the deployment, as World.canDeploy)
        let blocked = false;
        w.grid.query(cx, cy, 2.5, (o) => { if (o !== mcv && o.alive && !o.isAir && o.owner !== mcv.owner && o.x >= tx && o.x < tx + sw && o.y >= ty && o.y < ty + sh) blocked = true; });
        if (blocked) continue;
        const d = Math.hypot(cx - mcv.x, cy - mcv.y);
        if (d < bd) { bd = d; best = [cx, cy]; }
      }
      if (best) return best;
    }
    return null;
  }

  private placeReadyStructure() {
    const q = this.p.queues.structure;
    if (!q.ready) return;
    const bt = BUILDINGS[q.ready];
    const spot = expansionPlacement(this, bt) ?? (this.world.econ ? econPlacement(this, bt) : null) ?? aiPlacement(this.world, this.p, bt, this) ?? this.findPlacement(bt);
    if (spot) this.world.issue({ c: 'place', player: this.p.id, type: q.ready, cx: spot[0], cy: spot[1] });
    else this.world.issue({ c: 'cancel', player: this.p.id, type: q.ready });
  }

  private planStructures() {
    const p = this.p;
    const q = p.queues.structure;
    if (q.items.length || q.ready || !p.has('fact')) return;
    const want = aiNavalStructure(this.world, p, this) ?? this.nextStructure();
    if (want) this.world.issue({ c: 'build', player: p.id, type: want });
  }

  /** The personality's build order for our faction. */
  goalList(): [string, number][] {
    return this.personality.goals?.[this.p.faction] ?? (this.classicPro ? CLASSIC_GOALS : this.skirmish ? SKIRMISH_GOALS : GOALS)[this.p.faction];
  }

  /** The structure we want next, ignoring affordability. */
  private goalStructure(): string | null {
    const p = this.p;
    const surplus = p.powerOut - p.powerUse;
    const goal = this.goalList().find(([t, n]) => this.count(t) < n && p.canBuild(t) && this.allowed(t));
    const goalDrain = goal ? Math.max(0, -BUILDINGS[goal[0]].power) : 0;
    if (surplus < 20 || surplus - goalDrain < 0) return p.canBuild('apwr') && this.count('powr') >= 2 ? 'apwr' : 'powr';
    return goal ? goal[0] : null;
  }

  /**
   * Skirmish-based modes, version 5: no refinery yet and too little money for one after anything else (the $2,500 of Lean Times or
   * the smallest starting bank, or a refinery lost late with an empty bank): the power plant it needs, then the
   * refinery, before anything else. The opening used to put two power plants and a barracks first, and the refinery
   * then waited half-paid forever with no income to finish it.
   */
  private refineryFirst(): boolean {
    const p = this.p;
    return this.levelled && this.count('proc') === 0 && p.credits < costOf(p, BUILDINGS.proc) + 1000 && this.allowed('proc');
  }

  private nextStructure(): string | null {
    const p = this.p;
    if (this.refineryFirst()) return p.canBuild('proc') ? 'proc' : p.canBuild('powr') && this.count('powr') === 0 ? 'powr' : null;
    // power first
    const surplus = p.powerOut - p.powerUse;
    const goal = this.goalList().find(([t, n]) => this.count(t) < n && p.canBuild(t) && this.allowed(t));
    const goalDrain = goal ? Math.max(0, -BUILDINGS[goal[0]].power) : 0;
    if (surplus < 20 || surplus - goalDrain < 0) {
      if (p.canBuild('apwr')) return 'apwr';
      if (p.canBuild('powr')) return 'powr';
    }
    // (recruit and easy: a small base; power plants above, and replacements for what was lost, still come)
    if (this.d.maxStructures < UNCAPPED) {
      let n = 0;
      for (const b of this.world.buildings) if (b.alive && b.owner === p && !b.bt.wall && !b.bt.mine && b.bt.id !== 'powr' && b.bt.id !== 'apwr') n++;
      if (n >= this.d.maxStructures) return null;
    }
    if (p.ore > p.storage * 0.85 && p.storage > 0 && p.canBuild('silo') && this.count('silo') < 3) return 'silo';
    // keep enough refineries working the ore around the base
    if (this.skirmish && this.count('proc') < Math.min(this.tune.minRefs, this.d.maxRefs) && this.world.time > this.tune.refAt && p.canBuild('proc') && this.oreCellsNear(18) >= 24) return 'proc';
    // an expansion yard wants its refinery and a guard tower
    const ex = expansionStructure(this);
    if (ex) return ex;
    const ec = this.world.econ ? econStructure(this) : null; // Commander economy structures
    if (ec) return ec;
    // seen enemy aircraft: anti-aircraft defences now (normal and up)
    const aa = this.antiAirWanted();
    if (aa && p.credits >= BUILDINGS[aa].cost * 0.5) return aa;
    if (goal) {
      const t = BUILDINGS[goal[0]];
      if (p.credits >= Math.min(t.cost, 2000) * 0.5 || goal[0] === 'proc' || goal[0] === 'powr') return goal[0];
    }
    return null;
  }

  /** AA structure type when the enemy has shown aircraft and we lack air defence. */
  private antiAirWanted(): string | null {
    if (this.d.skill < 0.5 || !this.tune.aaOn || !this.skirmish) return null;
    const type = this.p.faction === 'allies' ? 'agun' : 'sam';
    if (!this.p.canBuild(type)) return null;
    const air = this.intel.armyMix(300).air;
    if (air < 1000) return null;
    let have = 0;
    for (const b of this.world.buildings) if (b.alive && b.owner === this.p && AIR_DEFENSE.has(b.bt.id)) have++;
    if (this.p.queues.structure.items[0]?.type === type) have++;
    return have < Math.min(4, 1 + Math.floor(air / 2400)) ? type : null;
  }

  private defenceCap(): number {
    // (recruit and easy: a defensive personality adds no defences)
    const taste = Math.round((this.personality.defence - 0.5) * 8);
    const low = this.d.skill < 0.5 && this.levelled;
    return this.d.defenses + (low ? Math.min(taste, 0) : taste) + (this.world.time > 900 ? (low ? Math.min(2, this.d.defenses - 1) : 2) : 0) + (this.p.cmd ? doctrineDefences(this.p) : 0);
  }

  private allowed(t: string): boolean {
    const pers = this.personality;
    if (t === 'proc' && this.count('proc') >= this.d.maxRefs) return false;
    // (recruit and easy: one of each factory, whatever the personality's build order asks for)
    const most = this.d.maxOf?.[t];
    if (most !== undefined && this.count(t) >= most) return false;
    // (Classic, normal and up: the army first; extras and a second war factory once the money floats or the army is ahead)
    // (version 5, tune.proLean: in the first 15 minutes the tech centre, a third refinery and a second Tesla Coil wait
    // the same way: a casual player who spends his money on tanks had twice the army of the Classic AI at minute 10)
    const lean = this.tune.proLean > 0 && this.world.time < 900 && (t === 'stek' || t === 'atek' || (t === 'proc' && this.count('proc') >= 2) || (t === 'tsla' && this.count('tsla') >= 1));
    // (version 6, DiffParams.classicThrift: behind on army, they wait whatever the bank)
    if (this.classicPro && this.thrift() > 0 && (PRO_EXTRAS.has(t) || t === 'stek' || t === 'atek' || t === 'gap' || t === 'hbox' || (t === 'proc' && this.count('proc') >= 2) || (t === 'weap' && this.count('weap') >= 1)) &&
      this.armyValue() < this.enemyEst * this.thrift()) return false;
    if (this.classicPro && (PRO_EXTRAS.has(t) || lean || (t === 'weap' && this.count('weap') >= 1)) && this.p.credits < BUILDINGS[t].cost * 0.8 &&
      this.armyValue() < this.enemyEst * 1.2 + 3000) return false;
    // (easier levels take their time to replace what they lost)
    const lost = this.lostAt[t];
    if (lost !== undefined && this.world.tick - lost < this.d.rebuildDelay * TICK_HZ) return false;
    if (AIR_DEFENSE.has(t)) {
      // (recruit and easy: only once enemy aircraft have shown up)
      return this.intel.armyMix(600).air > 0 || (this.d.skill >= 0.5 || !this.levelled) && this.world.time > 720 * trait(pers.defence, 1.4, 0.6);
    }
    if (DEFENSES.has(t)) {
      if (this.world.time < this.d.defenceAfter) return false;
      let n = 0;
      for (const b of this.myBuildings()) if (DEFENSES.has(b.bt.id)) n++;
      return n < this.defenceCap();
    }
    if (BUILDINGS[t].superweapon) {
      // (the Allied commander: only once the money floats; $2,500+ that early is an army lost: ai-allies.ts)
      if (alliedTools(this) && (this.world.time < 1200 * trait(pers.superweapons, 1.5, 0.6) || this.p.credits < BUILDINGS[t].cost)) return false;
      return this.d.superweapons && pers.superweapons > 0.1 && this.world.time > 600 * trait(pers.superweapons, 1.8, 0.6);
    }
    if ((t === 'hpad' || t === 'afld') && pers.air < 0.15 && this.world.time < 1200) return t === 'afld' && this.count('afld') < 1;
    if ((t === 'atek' || t === 'stek') && pers.tech < 0.3 && this.world.time < 720) return false;
    if (this.d.skill < 0.5 && this.levelled) {
      // (recruit and easy: one Tesla Coil at most, and no Tech Center, so no Mammoths, before minute 15)
      if (t === 'tsla' && this.count('tsla') >= 1) return false;
      if ((t === 'atek' || t === 'stek') && this.world.time < 900) return false;
    }
    return true;
  }

  findPlacement(bt: BuildingTypeDef, center?: [number, number]): [number, number] | null {
    const w = this.world;
    const [bx, by] = center ?? this.baseCenter();
    const [ex, ey] = this.enemyDir();
    let cx = bx, cy = by;
    const isDef = DEFENSES.has(bt.id) || AIR_DEFENSE.has(bt.id);
    if (center) {
      // (expansions: right next to the given spot)
    } else if (isDef) {
      const dist = 6 + w.rng.range(0, 3);
      const side = w.rng.range(-0.9, 0.9);
      cx = bx + ex * dist - ey * side * 4;
      cy = by + ey * dist + ex * side * 4;
    } else if (bt.id === 'proc') {
      const ore = this.nearestOre(bx, by);
      if (ore) { cx = (bx + ore[0]) / 2; cy = (by + ore[1]) / 2; }
    } else {
      // keep factories and tech behind the front line a bit
      cx = bx - ex * 2;
      cy = by - ey * 2;
    }
    let best: [number, number] | null = null;
    let bestScore = Infinity;
    const R = 13;
    const ox = Math.round(cx - bt.size[0] / 2), oy = Math.round(cy - bt.size[1] / 2);
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const px = ox + dx, py = oy + dy;
        const score = Math.hypot(dx, dy) + w.rng.next() * 0.5;
        if (score >= bestScore) continue;
        if (!w.canPlace(this.p, bt.id, px, py)) continue;
        if (!isDef && !this.hasMargin(bt, px, py)) continue;
        if (!lanesOpen(w, this.p, bt, px, py)) continue; // (docks and factory exits stay reachable, version 6)
        bestScore = score;
        best = [px, py];
      }
    }
    return best;
  }

  /** Keep a one-cell walkway around non-defensive buildings so the base stays traversable. */
  private hasMargin(bt: BuildingTypeDef, px: number, py: number): boolean {
    const m = this.world.map;
    for (let y = py - 1; y <= py + bt.size[1]; y++) {
      for (let x = px - 1; x <= px + bt.size[0]; x++) {
        if (x >= px && x < px + bt.size[0] && y >= py && y < py + bt.size[1]) continue;
        if (!m.inBounds(x, y)) continue;
        const i = m.idx(x, y);
        if (m.occupant[i]) return false;
      }
    }
    return true;
  }

  /** Ore cells within r of the base centre (is another refinery worth it?). */
  oreCellsNear(r: number): number {
    const m = this.world.map;
    const [bx, by] = this.baseCenter();
    let n = 0;
    for (const i of m.oreFieldCells) {
      if (!m.ore[i]) continue;
      const x = i % m.w, y = (i / m.w) | 0;
      if ((x - bx) ** 2 + (y - by) ** 2 <= r * r) n++;
    }
    return n;
  }

  nearestOre(x: number, y: number): [number, number] | null {
    const m = this.world.map;
    let best: [number, number] | null = null, bestD = Infinity;
    for (let cy = 0; cy < m.h; cy++) for (let cx = 0; cx < m.w; cx++) {
      if (!m.ore[m.idx(cx, cy)]) continue;
      const d = (cx - x) ** 2 + (cy - y) ** 2;
      if (d < bestD) { bestD = d; best = [cx + 0.5, cy + 0.5]; }
    }
    return best;
  }

  // ---------------------------------------------------------------------------
  // Production
  // ---------------------------------------------------------------------------
  private planUnits() {
    const p = this.p;
    const pers = this.personality;
    const units = this.myUnits();
    const harvs = units.filter((u) => u.ut.harvester).length;
    const refs = this.count('proc') + (this.world.econ ? econDocks(this) : 0); // (mining outposts)
    const wantHarv = Math.min(Math.round(refs * this.tune.harvPerRef), refs + this.tune.harvExtra + (pers.economy > 0.75 ? 1 : 0), this.d.maxHarv);
    const vq = p.queues.vehicle;
    const iq = p.queues.infantry;
    const queuedHarv = vq.items.filter((i) => i.type === 'harv').length;
    if (harvs + queuedHarv < wantHarv && p.canBuild('harv')) {
      if (!vq.items.length || (vq.items.length < 2 && vq.items[0].type !== 'harv')) this.world.issue({ c: 'build', player: p.id, type: 'harv' });
      return;
    }
    // keep enough money for the next structure on the build list
    const next = p.queues.structure.items[0]?.type ?? (p.queues.structure.ready ? null : this.goalStructure());
    const nextCost = next ? BUILDINGS[next].cost : 0;
    const keyStruct = next === 'proc' || next === 'weap' || next === 'powr' || next === 'apwr';
    const early = this.world.time < 480;
    let reserve = keyStruct ? Math.min(early ? 2000 : 1200, nextCost * (early ? 0.8 : 0.6)) + 100 : early ? nextCost * 0.3 : 100;
    // (Classic, normal and up: the tanks take the money as it comes in, so the next structure on the list, tech and
    // defences included, keeps what it needs to start: nextStructure() waits for half its price)
    if (next && this.classicPro) reserve = Math.max(reserve, Math.min(nextCost, 2000) * 0.5 + 100);
    // (short of money before the first refinery: the refinery's price stays in the bank, version 5)
    if (this.refineryFirst()) reserve = Math.max(reserve, costOf(p, BUILDINGS.proc) + 100);
    // (a vehicle on the Service Depot's pad: the repairs get paid before new units, version 6; production used to take
    // every credit first and a broke AI's tank stood on the pad for the rest of the match)
    if (onRepairPad(this)) reserve = Math.max(reserve, 150);
    const underThreat = this.world.tick - this.lastDefend < TICK_HZ * 10;
    if (this.world.econ && p.credits < reserve + econReserve(this) && !underThreat) return; // (saving for upgrades / research)
    if (p.credits < reserve && !underThreat) return;
    // an expansion MCV in the queue goes first
    if (this.expansion?.stage === 'build' && vq.items.some((i) => i.type === 'mcv')) return;
    // build-up time: the army grows to its cap for this difficulty, then the money goes into the base
    if (this.atBuildupCap(units)) return;
    // (easier levels: an army this size is all they field; recruit and easy grow it over the match)
    if (this.atArmyCap(units)) return;
    const inf = units.filter((u) => u.kind === 'infantry').length;
    const veh = units.filter((u) => u.kind === 'vehicle' && !u.ut.harvester && !u.ut.deploysInto).length;
    const canVeh = p.has('weap');
    let infCap = (this.world.time > 600 ? veh * 0.8 + 4 : veh * 1.5 + 6) * trait(pers.infantry, 0.35, 3);
    // counter-composition at the arm level: against an army our infantry can't trade with (heavy armour crushes
    // riflemen), fewer foot soldiers and more vehicles
    const edge = canVeh && this.tune.counterOn && this.skirmish && this.d.skill >= 0.5 ? this.armEdge() : 0;
    if (edge < -1) infCap = Math.max(4, infCap * Math.max(0.35, 1 + edge * 0.25));
    // (Classic, normal and up: tanks first. Riflemen are cheap enough to soak up every credit as it comes in, which
    // left the war factory waiting for money it never saw, and the scripted casual player's tank columns beat the
    // AI's rifle crowds. Infantry is the escort: a few before the war factory, then only next to a vehicle in
    // production with money to spare, or when the money floats.)
    const pro = this.classicPro;
    const proVeh = pro && canVeh;
    // (recruit and easy: each factory checks the cap again, what the others just ordered included: orders take effect
    // on the next tick)
    let ordered = 0;
    const room = () => !this.d.capAll || !this.atArmyCap(units, ordered);
    const order = (t: string, count?: number) => { this.world.issue(count === undefined ? { c: 'build', player: p.id, type: t } : { c: 'build', player: p.id, type: t, count }); ordered += (UNITS[t]?.cost ?? 0) * (count ?? 1); };
    const vehicle = () => {
      // (build-up time: the army comes first, so a vehicle starts as soon as the reserve is covered)
      if (!vq.items.length && p.credits > reserve + (this.ceasefire ? 0 : proVeh ? 100 : 500) && room() && veh < this.d.maxVehicles) {
        const t = this.pick(this.mix(VEH_MIX[p.faction]));
        if (t) order(t);
      }
    };
    if (proVeh) vehicle();
    if (pro) infCap = (canVeh ? Math.min(infCap, veh * PRO_INF_PER_VEH + 4) : PRO_INF_OPENING) * trait(pers.infantry, 0.6, 2.5); // (a human-wave commander still fields his crowds)
    const infOk = !proVeh || (vq.items.length > 0 && p.credits > reserve + 300) || p.credits > reserve + 1200;
    if (!iq.items.length && (canVeh ? inf < infCap : inf < this.d.infOpening) && (!pro || inf < infCap) && infOk && room()) {
      // (healers only in proportion to the infantry they can look after)
      const healers = units.filter((u) => u.ut.medic).length;
      const mix = this.mix(INF_MIX[p.faction]).map(([t, wt]): [string, number] => [t, this.skirmish && UNITS[t]?.medic && healers >= Math.max(1, inf * this.tune.medicCap) ? 0 : wt]);
      const t = this.pick(mix);
      if (t) order(t, t === 'e1' ? 2 : 1);
    }
    if (!proVeh) vehicle();
    const aq = p.queues.aircraft;
    const air = units.filter((u) => u.kind === 'aircraft').length;
    const airCap = (2 + this.d.defenses / 2) * trait(pers.air, 0, 3);
    if (!aq.items.length && p.credits > reserve + 1200 * trait(pers.air, 1.6, 0.5) && air < airCap && room()) {
      const t = this.pick(this.mix(AIR_MIX[p.faction]));
      if (t) order(t);
    }
  }

  /** The army the enemy factions typically field (value per unit type), the counter-composition prior. */
  private enemyPrior(): Map<string, number> {
    const out = new Map<string, number>();
    for (const o of this.world.players) {
      if (o.defeated || !this.p.isEnemy(o)) continue;
      for (const mix of [INF_MIX[o.faction], VEH_MIX[o.faction]]) {
        const sum = mix.reduce((s, [, wt]) => s + wt, 0);
        for (const [t, wt] of mix) if (UNITS[t]?.primary && !UNITS[t].medic) out.set(t, (out.get(t) ?? 0) + (wt / sum) * 1000);
      }
    }
    return out;
  }

  /** Best infantry fitness minus best vehicle fitness against the enemy seen (log2 exchange; 0 when unknown). */
  private armEdge(): number {
    const f = this.p.faction;
    const ids = (mix: [string, number][]) => mix.map(([t]) => t).filter((t) => this.p.canBuild(t) && UNITS[t]?.primary && !UNITS[t].medic);
    const prior = this.enemyPrior();
    const inf = bestFitness(ids(INF_MIX[f]), this.intel, 1200, prior), veh = bestFitness(ids(VEH_MIX[f]), this.intel, 1200, prior);
    return inf === null || veh === null ? 0 : inf - veh;
  }

  /** A unit mix reshaped by the personality and by the enemy army we have seen (counter-composition). */
  mix(base: [string, number][]): [string, number][] {
    const pers = this.personality;
    const out: [string, number][] = base.map(([t, w]) => {
      let m = pers.prefer?.[t] ?? 1;
      if (this.p.cmd) m *= doctrinePrefer(this.p, t); // lean into the doctrine
      if (ARTILLERY.has(t)) m *= trait(pers.artillery, 0.25, 3);
      if (t === '4tnk' || t === 'e7') m *= trait(pers.tech, 0.5, 1.6);
      if (FAST_RAIDERS.has(t)) m *= trait(pers.harass, 0.8, 1.5);
      return [t, w * m];
    });
    // preferred units outside the classic mix (e.g. APCs for the human wave)
    const kind = UNITS[base[0][0]]?.kind;
    for (const [t, m] of Object.entries(pers.prefer ?? {})) {
      if (m > 1 && UNITS[t] && UNITS[t].kind === kind && !base.some(([b]) => b === t) && UNITS[t].primary) out.push([t, 6 * (m - 1)]);
    }
    const k = this.tune.counterOn && this.skirmish ? this.tune.counterStrength * this.d.skill * 1.5 : 0;
    if (k > 0) {
      const cw = counterWeights(out.filter(([t]) => this.p.canBuild(t) && UNITS[t].primary).map(([t]) => t), this.intel, k, 1200, this.enemyPrior());
      // (a commander's favourite units are only half as negotiable)
      for (const e of out) e[1] *= Math.pow(cw.get(e[0]) ?? 1, (pers.prefer?.[e[0]] ?? 1) > 1 ? 0.5 : 1);
    }
    return out;
  }

  private pick(mix: [string, number][]): string | null {
    const ban = this.d.noUnits;
    const opts = mix.filter(([t, w]) => w > 0 && this.p.canBuild(t) && !ban.includes(t));
    if (!opts.length) return null;
    const total = opts.reduce((s, [, w]) => s + w, 0);
    let r = this.world.rng.next() * total;
    for (const [t, w] of opts) { r -= w; if (r <= 0) return t; }
    return opts[0][0];
  }

  private repairBase() {
    if (!this.due(TICK_HZ * 2)) return;
    if (this.p.credits < 500) return;
    for (const b of this.myBuildings()) {
      if (b.active && !b.repairing && b.healthFrac < 0.7) {
        this.world.issue({ c: 'repair', player: this.p.id, building: b.id });
        break;
      }
    }
  }

  /** Hold ground: idle units engage intruders near the base, nothing else. */
  private defendOnly() {
    const w = this.world;
    if (!this.due(TICK_HZ * 2)) return;
    const [bx, by] = this.baseCenter();
    let threat: Unit | null = null;
    for (const u of w.units) {
      if (!u.alive || !this.p.isEnemy(u.owner) || u.kind === 'naval' || (u.ut.spy && u.disguise >= 0) || u.ut.supportPlane) continue; // ships: see ai-naval.ts
      if (Math.hypot(u.x - bx, u.y - by) < 14) { threat = u; break; }
    }
    if (!threat) return;
    const ids = this.army().filter((u) => u.order.type === 'idle' && Math.hypot(u.x - threat!.x, u.y - threat!.y) < 16).map((u) => u.id);
    if (ids.length) w.issue({ c: 'move', player: this.p.id, units: ids, x: threat.x, y: threat.y, attackMove: true });
  }

  // ---------------------------------------------------------------------------
  // Army
  // ---------------------------------------------------------------------------
  army(): Unit[] {
    return this.myUnits().filter((u) => u.weapons.length && !u.ut.harvester && !u.ut.deploysInto && !u.ut.medic && u.kind !== 'aircraft' && u.kind !== 'naval' && !aiManaged(u)); // aiManaged: demolition trucks / M.A.D. tanks
  }

  /** Army units free for waves and defence (not scouting, raiding, escorting or being repaired). */
  available(): Unit[] {
    return this.army().filter((u) => u.id !== this.scout && !this.raid.has(u.id) && !this.repairs.has(u.id) && !this.escort.has(u.id));
  }

  /** Units of the current wave that are still alive. */
  waveUnits(): Unit[] {
    const out: Unit[] = [];
    for (const id of this.wave) {
      const u = this.world.entities.get(id);
      if (u instanceof Unit && u.alive) out.push(u);
    }
    return out;
  }

  /** Aircraft strike harvesters, defences and soft targets when fully armed. */
  private airStrikes() {
    const w = this.world;
    if (this.due(TICK_HZ * 2) && this.tune.heliOn && alliedTools(this) && alliedAir(this)) return; // Longbow strikes (ai-allies.ts)
    if (!this.due(TICK_HZ * 4) || this.ceasefire) return; // (build-up time: aircraft wait on their pads)
    // idle and fully armed: landed on the pad or hovering at its post
    const ready = this.myUnits().filter((u) => u.kind === 'aircraft' && u.order.type === 'idle' && u.ammo >= (u.ut.ammo ?? 1) && !u.ut.passengers);
    if (ready.length < (this.personality.air > 0.8 ? 1 : 2)) return;
    let best: Entity | null = null, bestScore = Infinity;
    const [bx, by] = this.baseCenter();
    const flak = this.intel.knownStructures().filter((s) => s.aa);
    const consider = (e: Entity) => {
      if (!pickWeapon(ready[0], e)) return; // walls, aircraft in flight...
      // avoid heavily defended spots
      let aa = 0;
      for (const s of flak) if (s.owner === e.owner.id && Math.hypot(s.x - e.x, s.y - e.y) < 8) aa++;
      let score = Math.hypot(e.x - bx, e.y - by) * 0.3 + aa * 25;
      if (this.d.raids && e instanceof Unit && e.ut.harvester) score -= 20;
      if (this.d.raids && e instanceof Building && apparentType(e, this.p).id === 'proc') score -= 10;
      if (score < bestScore) { bestScore = score; best = e; }
    };
    for (const u of w.units) if (u.alive && this.p.isEnemy(u.owner) && this.intel.sees(u)) consider(u);
    for (const s of this.intel.structures.values()) {
      const b = w.entities.get(s.id);
      if (b instanceof Building && b.alive) consider(b);
    }
    if (best) w.issue({ c: 'attack', player: this.p.id, units: ready.map((u) => u.id), target: (best as Entity).id });
  }

  /** Visible enemies threatening the base, an outlying structure or a harvester. Returns true when the main base is under attack. */
  private defend(army: Unit[], bx: number, by: number): boolean {
    const w = this.world, p = this.p;
    const relevant = (u: Unit) => u.alive && p.isEnemy(u.owner) && !u.ut.harvester && u.kind !== 'naval' && !u.ut.supportPlane && !(u.ut.spy && u.disguise >= 0) && this.intel.sees(u);
    let threat: Unit | null = null;
    for (const u of w.units) {
      if (!relevant(u)) continue;
      if (Math.hypot(u.x - bx, u.y - by) < 13) { threat = u; break; }
    }
    // (easier levels notice an intruder late)
    if (!threat) this.threatSince = -1;
    else if (this.threatSince < 0) this.threatSince = w.tick;
    if (threat && w.tick - this.threatSince >= this.d.defendDelay * TICK_HZ && w.tick - this.lastDefend > TICK_HZ * 4) {
      this.lastDefend = w.tick;
      const defenders = army.filter((u) => (!this.wave.has(u.id) || this.state !== 'attack') && !this.repairs.has(u.id) && u.id !== this.scout);
      const n = Math.ceil(defenders.length * Math.min(1, this.d.reaction * this.tune.reactionMul));
      const ids = defenders.sort((a, b) => Math.hypot(a.x - threat!.x, a.y - threat!.y) - Math.hypot(b.x - threat!.x, b.y - threat!.y)).slice(0, n).map((u) => u.id);
      if (ids.length) w.issue({ c: 'move', player: p.id, units: ids, x: threat.x, y: threat.y, attackMove: true });
      return true;
    }
    // (an intruder still being dealt with does not stop the rest of the war: waves keep going, as in the classic AI)
    if (threat) return false;
    // build-up time: with no counter-attack allowed, whoever shoots into the base from outside it gets an answer
    // (a scout that wandered into the enemy's base and is shot at there fends for itself)
    let spot: [number, number] | null = null;
    if (this.ceasefire && this.due(TICK_HZ * 2) && w.tick - this.lastDefend >= TICK_HZ * 4) {
      for (const u of w.units) {
        if (!relevant(u) || Math.hypot(u.x - bx, u.y - by) >= 36) continue;
        const v = hostileTarget(w, p, u);
        if (v && inHomeArea(w, p, v.x, v.y)) { spot = [u.x, u.y]; break; }
      }
    }
    const reach = spot ? 40 : 24;
    if (!spot) {
      // outlying structures (expansions, forward refineries) and harvesters under attack (normal and up)
      if (!this.tune.outlyingOn || !this.skirmish || this.d.skill < 0.5 || !this.due(TICK_HZ * 2) || w.tick - this.lastDefend < TICK_HZ * 4) return false;
      for (const b of w.buildings) {
        if (!b.alive || b.owner !== p || b.bt.wall || b.bt.mine || Math.hypot(b.x - bx, b.y - by) < 11) continue;
        for (const u of w.units) if (relevant(u) && b.distTo(u.x, u.y) < 6) { spot = [u.x, u.y]; break; }
        if (spot) break;
      }
      if (!spot) {
        for (const h of w.units) {
          if (!h.alive || h.owner !== p || !h.ut.harvester || w.tick - h.lastDamagedTick > TICK_HZ * 3) continue;
          const a = w.entities.get(h.lastAttacker);
          if (a instanceof Unit && relevant(a) && Math.hypot(a.x - h.x, a.y - h.y) < 9) { spot = [a.x, a.y]; break; }
        }
      }
    }
    if (!spot) return false;
    const [sx, sy] = spot;
    let threatValue = 0;
    for (const u of w.units) if (relevant(u) && Math.hypot(u.x - sx, u.y - sy) < 7) threatValue += u.ut.cost * u.healthFrac;
    // (a lone scout is the defences' business; the army only answers a real raid)
    if (threatValue < 450) return false;
    const free = this.available().filter((u) => !this.wave.has(u.id) || this.state !== 'attack')
      .sort((a, b) => Math.hypot(a.x - sx, a.y - sy) - Math.hypot(b.x - sx, b.y - sy));
    // (Classic, normal and up: no defenders fed piecemeal to a stronger force outside the base; the army waits for it
    // at home, among its defences, and the Ore Trucks get out of the way, ai-harvest.ts)
    if (this.classicPro && !this.ceasefire) {
      let can = 0;
      for (const u of free) if (Math.hypot(u.x - sx, u.y - sy) <= reach) can += u.ut.cost * u.healthFrac;
      if (can < this.intel.strengthNear(sx, sy, 10, 10) * 1.2) return false;
    }
    const ids: number[] = [];
    let v = 0;
    for (const u of free) {
      if (v >= threatValue * 1.5 * this.d.reaction + 400 && ids.length >= 2) break;
      if (Math.hypot(u.x - sx, u.y - sy) > reach) break;
      ids.push(u.id);
      v += u.ut.cost * u.healthFrac;
    }
    if (ids.length) {
      this.lastDefend = w.tick;
      w.issue({ c: 'move', player: p.id, units: ids, x: sx, y: sy, attackMove: true });
    }
    return false;
  }

  private military() {
    const w = this.world;
    const p = this.p;
    const pers = this.personality;
    const army = this.army();
    const [bx, by] = this.baseCenter();
    const [gx, gy] = this.rallyPoint();
    // (version 6: Recruit and Easy with a human teammate play his support, see supportPoint)
    const support = !!this.supportPoint();

    // set rally points for factories
    if (this.due(TICK_HZ * 5)) {
      for (const b of this.myBuildings()) {
        if (b.bt.factory === 'naval') continue; // the naval AI keeps its own anchorage
        if (b.bt.factory === 'aircraft') {
          // aircraft wait on their pads (a ground rally point would leave them hovering there forever)
          if (b.rallyX >= 0) w.issue({ c: 'rally', player: p.id, building: b.id, x: -1, y: -1 });
          continue;
        }
        if (b.bt.factory && b.bt.factory !== 'building' && Math.hypot(b.rallyX - gx, b.rallyY - gy) > 2) {
          const spot = w.findFreeSpot(gx, gy, 5);
          w.issue({ c: 'rally', player: p.id, building: b.id, x: spot[0], y: spot[1] });
        }
      }
    }
    if (this.due(TICK_HZ * 2)) manageRepairs(this, gx, gy);

    // --- defend the base (and, from normal up, outlying structures and harvesters)
    if (this.defend(army, bx, by)) return;
    // --- human teammates (2v2, co-op): help when their base is attacked (version 5)
    const mates = this.skirmish && !this.ceasefire ? humanMates(this) : [];
    if (mates.length) helpMates(this, mates);

    // --- nothing left of the enemy that it knows of: search parties (version 6)
    if (this.huntNow()) { this.hunt(); return; }

    // --- attack waves
    if (this.state === 'build') {
      const idle = this.available().filter((u) => u.order.type === 'idle' || u.order.type === 'guard');
      const value = idle.reduce((s, u) => s + u.ut.cost, 0);
      // build-up time: no waves, the army masses at home (a bigger army spreads over a wider staging area)
      const gather = w.ceasefireUntil ? Math.max(6, Math.sqrt(idle.length) * 1.4) : 6;
      if (this.ceasefire) {
        if (this.due(TICK_HZ * 6)) {
          const stray = idle.filter((u) => Math.hypot(u.x - gx, u.y - gy) > gather).map((u) => u.id);
          if (stray.length) w.issue({ c: 'move', player: p.id, units: stray, x: gx, y: gy });
        }
        return;
      }
      // a human teammate's army is at an enemy base: go with him (version 5; version 6: three units at least, a lone unit
      // counted as a broken wave on the next think and went home, to be sent again 2 s later; and a push the human
      // leads doesn't raise the size of the AI's own next wave)
      if (mates.length && this.due(TICK_HZ * 2) && idle.length >= 3 && value >= Math.min(this.d.waveValue * 0.5, 1500)) {
        const push = matePush(this, mates);
        if (push) { this.launchWave(idle, push, bx, by, true); return; }
      }
      // the ceasefire is over: the army built up goes in, whatever the clock or the scouts say
      if (this.grandWave && value >= BUILDUP[this.difficulty].min) {
        const target = this.pickAttackTarget();
        if (target) { this.launchWave(idle, target, bx, by); return; }
      }
      const low = this.d.skill < 0.5 && this.levelled; // (recruit and easy: an aggressive personality attacks at most 15% sooner, and not with less, than the level does)
      const need = Math.min(this.d.waveCap, this.nextWaveValue * Math.max(low ? 0.85 : 0, this.tune.waveMul * trait(pers.aggression, 1.45, 0.62)));
      // (normal and up) attack early when clearly stronger than the enemy army we have seen, hold when outmatched
      const smart = this.d.skill >= 0.6 && this.skirmish;
      const enemyArmy = smart ? this.intel.armyMix(180).total : 0;
      const firstAt = this.d.firstAttack * Math.max(low ? 0.85 : 0, trait(pers.aggression, 1.6, 0.55));
      // (never for the first wave: early sightings show only part of the enemy army)
      const strong = smart && this.waves > 0 && enemyArmy > 0 && value >= enemyArmy * this.tune.advantage && value >= this.d.waveValue * 0.6 && w.time >= firstAt;
      const outmatched = smart && value < enemyArmy * this.tune.holdRatio && value < need * 2;
      // counter-punch: the enemy just broke its army on our defences, strike back before it rebuilds
      const broke = smart && this.tune.counterPunch > 0 && w.time >= firstAt * 0.8 && this.intel.killedNear(bx, by, 16, 60) >= this.tune.counterPunch &&
        value >= this.d.waveValue * 0.6 && value >= this.intel.armyMix(45).total * this.tune.advantage;
      // (normal and up) no blind first wave: wait for the scouts (a while) before marching on a guess
      const blind = smart && this.waves === 0 && this.intel.foundTick < 0 && !this.intel.omniscient && w.time < firstAt + 120;
      if (this.classicPro) {
        // (Classic, normal and up: a wave goes only when it outweighs what it has seen of the enemy army and the
        // defences at the target; until then the army stays home beside its own defences, ai-engage.ts)
        // (version 6: the army masses until DiffParams.classicFirst before its first wave, unless an attack broke on the base)
        const ready = (w.time >= Math.max(firstAt, this.waves ? 0 : this.tune.proFirst || this.d.classicFirst) && value >= need) || broke;
        // (and never on a guess: the scouts find the enemy base first)
        const unseen = this.intel.foundTick < 0 && !this.intel.omniscient && w.time < 900;
        const target = ready && !unseen ? this.pickAttackTarget() : null;
        // (but not forever against an enemy who doesn't come either: after PRO_HOLD seconds with neither a wave nor a
        // real attack on the base, scouts and paradrops aside, a ready army tries its luck, and turns back if it meets
        // more than it can beat; two such commanders would otherwise sit at home all game)
        const quiet = Math.min(w.tick - Math.max(this.stageStart, Math.round(firstAt * TICK_HZ)), w.tick - this.lastAssault);
        const held = quiet > PRO_HOLD * TICK_HZ;
        if (target && (held || value >= waveNeeds(this, target, trait(pers.caution, 0.8, 1.25)))) { this.launchWave(idle, target, bx, by); return; }
        if (this.due(TICK_HZ * 6)) {
          const stray = idle.filter((u) => Math.hypot(u.x - gx, u.y - gy) > gather).map((u) => u.id);
          if (stray.length) w.issue({ c: 'move', player: p.id, units: stray, x: gx, y: gy });
        }
        return;
      }
      if (((w.time >= firstAt && value >= need && !outmatched) || strong || broke) && !blind && !support) {
        const target = this.pickAttackTarget();
        // a wave too weak for the fortress it knows is waiting holds back for reinforcements (up to a point)
        const known = target && this.d.skill >= 0.6 && this.skirmish ? this.intel.strengthNear(target[0], target[1], 10, 240) : 0;
        const tooWeak = known > 0 && value < known * this.tune.attackRatio * trait(pers.caution, 0.6, 1.4) && value < need * 2.2;
        if (target && !tooWeak) this.launchWave(idle, target, bx, by);
      } else if (this.due(TICK_HZ * 6)) {
        // gather idle units at the rally point
        const stray = idle.filter((u) => Math.hypot(u.x - gx, u.y - gy) > gather).map((u) => u.id);
        if (stray.length) w.issue({ c: 'move', player: p.id, units: stray, x: gx, y: gy });
      }
      return;
    }

    const alive = this.waveUnits().filter((u) => !this.repairs.has(u.id));
    this.wave = new Set(alive.map((u) => u.id));
    for (const id of [...this.flank]) if (!this.wave.has(id)) this.flank.delete(id);
    if (alive.length <= Math.max(1, this.waveStart * this.tune.brokenFrac)) {
      // wave broken: regroup
      this.state = 'build';
      this.flank.clear();
      const ids = alive.map((u) => u.id);
      if (ids.length) w.issue({ c: 'move', player: p.id, units: ids, x: gx, y: gy });
      this.say('broken');
      return;
    }
    if (this.stage === 'gather') {
      const main = alive.filter((u) => !this.flank.has(u.id));
      const near = main.filter((u) => Math.hypot(u.x - this.stageX, u.y - this.stageY) < 7).length;
      // (a siege, version 5: reinforcements keep joining until the wave outweighs what stopped it, two minutes at most)
      let waiting = false;
      if (this.siegeNeed > 0) {
        if (this.due(TICK_HZ * 4)) this.reinforce();
        if (this.tune.proBombard > 0 && this.classicPro && this.due(TICK_HZ * 2)) this.bombard(main);
        waiting = main.reduce((s, u) => s + u.ut.cost * u.healthFrac, 0) < this.siegeNeed && w.tick - this.stageStart < TICK_HZ * 120;
      }
      if (!waiting && (near >= main.length * 0.75 || w.tick - this.stageStart > TICK_HZ * 60)) {
        this.siegeNeed = 0;
        this.stage = 'assault';
        const t = this.pickAttackTarget(this.stageX, this.stageY) ?? this.stageTarget;
        this.stageTarget = t;
        if (main.length) w.issue({ c: 'move', player: p.id, units: main.map((u) => u.id), x: t[0], y: t[1], attackMove: true });
        if (this.flank.size) {
          const ft = this.flankTarget ?? t;
          w.issue({ c: 'move', player: p.id, units: [...this.flank], x: ft[0], y: ft[1], attackMove: true });
          this.say('flank', ft[0], ft[1]);
        }
      }
      return;
    }
    // --- tactics during the assault (normal and up)
    if (this.d.skill >= 0.6 && this.skirmish) {
      if (this.due(TICK_HZ * 2)) {
        retreatDamaged(this, alive, gx, gy);
        if (this.classicPro && outmatchedWave(this, alive)) {
          // (version 5: stopped by defences rather than by an army, the wave holds at its staging point, out of their
          // reach, and the rest of the army joins it there before it tries again)
          if (this.siege(alive)) return;
          // (Classic, normal and up: a wave that meets more than it can beat comes home at once, before it is lost)
          this.state = 'build';
          this.flank.clear();
          this.lastFallback = w.tick;
          this.stageStart = w.tick;
          w.issue({ c: 'move', player: p.id, units: alive.map((u) => u.id), x: gx, y: gy });
          this.say('fallback');
          return;
        }
        if (this.fallBack(alive)) return;
        if (this.tune.proBombard > 0 && this.classicPro) this.bombard(alive);
        if (this.tune.artyOn && alliedTools(this)) alliedArtillery(this, alive); // howitzers stay behind the tanks
      }
      if (this.due(TICK_HZ)) focusFire(this, alive);
    }
    // keep pushing: idle wave units pick the next target
    const idle = alive.filter((u) => u.order.type === 'idle' && !u.target);
    if (idle.length && this.due(TICK_HZ * 3)) {
      const near = this.nearestEnemyBuilding(idle[0].x, idle[0].y);
      // walls in the way: blast through the nearest segment
      let wall: Building | null = null;
      for (const b of w.buildings) {
        if (b.alive && b.bt.wall && this.p.isEnemy(b.owner) && Math.hypot(b.x - idle[0].x, b.y - idle[0].y) < 3.5) { wall = b; break; }
      }
      // (only units that can breach it: small arms can't, and such orders are refused)
      // (and only those that can drive up to it: canReach)
      const breakers = wall ? canReach(w.map, idle.filter((u) => pickWeapon(u, wall!)), wall) : [];
      // (a structure next to the leader is for the units around him; stragglers across the map close up first)
      const local = idle.filter((u) => Math.hypot(u.x - idle[0].x, u.y - idle[0].y) < 20);
      const reach = near ? canReach(w.map, local, near) : [];
      if (wall && breakers.length && (!near || Math.hypot(near.x - idle[0].x, near.y - idle[0].y) > 5)) {
        w.issue({ c: 'attack', player: p.id, units: breakers.map((u) => u.id), target: wall.id, forced: true });
      } else if (near && reach.length && Math.hypot(near.x - idle[0].x, near.y - idle[0].y) < 12) {
        w.issue({ c: 'attack', player: p.id, units: reach.map((u) => u.id), target: near.id });
        const far = idle.filter((u) => !local.includes(u)).map((u) => u.id);
        if (far.length) w.issue({ c: 'move', player: p.id, units: far, x: idle[0].x, y: idle[0].y, attackMove: true });
      } else {
        const target = this.pickAttackTarget(idle[0].x, idle[0].y);
        if (target) w.issue({ c: 'move', player: p.id, units: idle.map((u) => u.id), x: target[0], y: target[1], attackMove: true });
        else { this.state = 'build'; this.flank.clear(); }
      }
    }
  }

  /**
   * Version 6: an enemy is still in the game but the AI knows nothing of him (no structure, no start left to look at,
   * no unit seen in the last 30 seconds): a beaten player's last units hiding somewhere, a base moved by MCV.
   */
  huntNow(): boolean {
    const w = this.world, p = this.p;
    if (!this.skirmish || this.ceasefire || this.intel.omniscient) return false;
    if (!w.players.some((o) => o !== p && !o.defeated && p.isEnemy(o))) return false;
    for (const s of this.intel.structures.values()) if (!w.players[s.owner]?.defeated) return false;
    const since = w.tick - TICK_HZ * 30;
    for (const s of this.intel.units.values()) if (s.seen >= since && !w.players[s.owner]?.defeated) return false;
    const [bx, by] = this.baseCenter();
    return !this.intel.enemyBase(bx, by);
  }

  /**
   * The hunt (version 6): the whole army fans out in parties of three, each to a different square of open ground it
   * has gone longest without seeing (AIIntel.huntPoint), attack-moving so that whatever they find is engaged. One wave
   * searching the map as a single column, while the rest of the army waited at home, could take most of an hour to
   * find a beaten player's last units hiding in a corner.
   */
  private hunt() {
    const w = this.world, p = this.p;
    if (this.state === 'attack') { this.state = 'build'; this.wave.clear(); this.flank.clear(); this.siegeNeed = 0; }
    if (!this.due(TICK_HZ * 2)) return;
    const units = this.available();
    const claimed: [number, number][] = [];
    for (const u of units) if (u.order.type === 'move') claimed.push([u.order.x, u.order.y]);
    const idle = units.filter((u) => (u.order.type === 'idle' || u.order.type === 'guard') && !u.target).sort((a, b) => a.id - b.id);
    const zones = landZones(w.map);
    while (idle.length) {
      const lead = idle.shift()!;
      const party = [lead, ...idle.filter((u) => Math.hypot(u.x - lead.x, u.y - lead.y) < 10).sort((a, b) => Math.hypot(a.x - lead.x, a.y - lead.y) - Math.hypot(b.x - lead.x, b.y - lead.y) || a.id - b.id).slice(0, 2)];
      for (const u of party) { const k = idle.indexOf(u); if (k >= 0) idle.splice(k, 1); }
      const z = zones[w.map.idx(Math.floor(lead.x), Math.floor(lead.y))];
      const pt = this.intel.huntPoint(lead.x, lead.y, z ? { zones, id: z } : undefined, claimed);
      if (!pt) continue;
      claimed.push(pt);
      w.issue({ c: 'move', player: p.id, units: party.map((u) => u.id), x: pt[0], y: pt[1], attackMove: true });
    }
  }

  /** Commit idle units to an attack: stage outside the target, optionally split off a flanking group. */
  private launchWave(idle: Unit[], target: [number, number], bx: number, by: number, mateLed = false) {
    const w = this.world, p = this.p;
    const grand = this.grandWave;
    this.state = 'attack';
    // the first wave commits only about 1.3x the wave value (closest to the target first);
    // the rest stays home as defence. Later waves take every idle unit.
    let wave = idle;
    if (grand) {
      // after the build-up: the difficulty's share of the whole army, closest to the target first
      const total = idle.reduce((s, u) => s + u.ut.cost, 0);
      const cap = total * BUILDUP[this.difficulty].commit;
      const byDist = idle.slice().sort((a, b) => Math.hypot(a.x - target[0], a.y - target[1]) - Math.hypot(b.x - target[0], b.y - target[1]) || a.id - b.id);
      wave = [];
      let sum = 0;
      for (const u of byDist) {
        if (sum >= cap) break;
        wave.push(u);
        sum += u.ut.cost;
      }
    } else if (this.nextWaveValue <= this.d.waveValue && !w.mission && !this.classicPro) {
      // (Classic, normal and up: the wave has been weighed against the enemy, ai-engage.ts, and goes in whole)
      // (skirmish only: campaign missions are balanced around their scripted openings)
      const cap = this.d.waveValue * FIRST_WAVE_CAP;
      const byDist = idle.slice().sort((a, b) => Math.hypot(a.x - target[0], a.y - target[1]) - Math.hypot(b.x - target[0], b.y - target[1]) || a.id - b.id);
      wave = [];
      let sum = 0;
      for (const u of byDist) {
        if (sum >= cap) break;
        if (sum + u.ut.cost > cap && sum >= this.d.waveValue) continue;
        wave.push(u);
        sum += u.ut.cost;
      }
    }
    // (easier levels: a wave never grows past its cap; the rest stays home)
    if (this.d.waveCap < UNCAPPED && wave.reduce((s, u) => s + u.ut.cost, 0) > this.d.waveCap) {
      const byDist = wave.slice().sort((a, b) => Math.hypot(a.x - target[0], a.y - target[1]) - Math.hypot(b.x - target[0], b.y - target[1]) || a.id - b.id);
      wave = [];
      let sum = 0;
      for (const u of byDist) {
        if (sum >= this.d.waveCap) break;
        wave.push(u);
        sum += u.ut.cost;
      }
    }
    this.wave = new Set(wave.map((u) => u.id));
    this.waveStart = this.wave.size;
    this.waveValueStart = wave.reduce((s, u) => s + u.ut.cost * u.healthFrac, 0);
    this.regroups = 0;
    this.siegeNeed = 0;
    this.waves++;
    // gather at a staging point outside the enemy base first
    const k = 0.55;
    const spot = w.findFreeSpot(bx + (target[0] - bx) * k, by + (target[1] - by) * k, 6);
    this.stage = 'gather';
    this.stageX = spot[0];
    this.stageY = spot[1];
    this.stageTarget = target;
    this.stageStart = w.tick;
    this.flank.clear();
    this.flankTarget = null;
    this.planFlank(wave, target, spot);
    const main = wave.filter((u) => !this.flank.has(u.id)).map((u) => u.id);
    if (main.length) w.issue({ c: 'move', player: p.id, units: main, x: spot[0], y: spot[1], attackMove: true });
    if (this.flank.size) w.issue({ c: 'move', player: p.id, units: [...this.flank], x: this.flankX, y: this.flankY, attackMove: true });
    // (growth capped: a long war of attrition must not freeze the AI at home)
    if (!mateLed) this.nextWaveValue += this.d.waveGrowth * trait(this.personality.aggression, 1.3, 0.75);
    if (this.skirmish) this.nextWaveValue = Math.min(this.nextWaveValue, this.d.waveValue + this.d.waveGrowth * 5, this.d.waveCap);
    this.say('attack', target[0], target[1]);
  }

  /** Hard / brutal (and raiding personalities on normal): send the fastest part of a big wave around the side. */
  private planFlank(wave: Unit[], target: [number, number], stage: [number, number]) {
    const pers = this.personality;
    const eager = Math.max(pers.harass, pers.aggression);
    if (!this.skirmish || !this.tune.flankOn || wave.length < 10 || this.d.skill < (eager > 0.7 ? 0.6 : 0.8)) return;
    const frac = this.tune.flankFrac * trait(eager, 0.6, 1.4);
    const total = wave.reduce((s, u) => s + u.ut.cost, 0);
    // (fast, light units only: the main battle tanks stay concentrated in the main thrust)
    const fast = wave.filter((u) => u.kind === 'vehicle' && u.ut.speed >= 8 && u.ut.cost <= 900).sort((a, b) => b.ut.speed - a.ut.speed || a.id - b.id);
    const picked: Unit[] = [];
    let v = 0;
    for (const u of fast) {
      if (v >= total * frac) break;
      picked.push(u);
      v += u.ut.cost;
    }
    if (picked.length < 2 || wave.length - picked.length < 4) return;
    // the flank target: a soft, valuable structure away from the main thrust; else the target from the side
    const [sx, sy] = stage;
    const dx = target[0] - sx, dy = target[1] - sy;
    const l = Math.hypot(dx, dy) || 1;
    const side = this.world.rng.chance(0.5) ? 1 : -1;
    const px = (-dy / l) * side, py = (dx / l) * side;
    let best: [number, number] | null = null, bestScore = Infinity;
    for (const s of this.intel.structures.values()) {
      const d = Math.hypot(s.x - target[0], s.y - target[1]);
      if (d < 6 || d > 20) continue;
      let score = d * 0.5 + this.intel.strengthNear(s.x, s.y, 7, 120) / 300;
      if (s.type === 'proc' || s.type === 'powr' || s.type === 'apwr') score -= 5;
      if (s.armed) score += 8;
      if (score < bestScore) { bestScore = score; best = [s.x, s.y + s.h / 2 + 0.5]; }
    }
    const ft: [number, number] = best ?? [target[0] + px * 7, target[1] + py * 7];
    const [fx, fy] = this.world.findFreeSpot(sx + px * 10, sy + py * 10, 6);
    this.flankTarget = ft;
    this.flankX = fx;
    this.flankY = fy;
    for (const u of picked) this.flank.add(u.id);
  }

  /**
   * Classic, normal and up (tune.proSiege, version 5): a wave held up by defences rather than by an enemy army falls
   * back to its staging point outside their reach and calls up the rest of the army, instead of going home; it goes
   * in again once it outweighs what stopped it by the usual margin. Returns false when this wave has sieged enough,
   * or an army is what stopped it.
   */
  private siege(alive: Unit[]): boolean {
    const w = this.world;
    // (only for a commander clearly ahead: against an army at home, holding outside its base strips our own base bare)
    if (this.regroups >= this.tune.proSiege || !alive.length || this.armyValue() < this.enemyEst * 1.5) return false;
    let cx = 0, cy = 0, v = 0;
    for (const u of alive) { cx += u.x; cy += u.y; v += u.ut.cost * u.healthFrac; }
    cx /= alive.length; cy /= alive.length;
    const facing = facingNear(this, cx, cy);
    const army = this.intel.strengthNear(cx, cy, 10, 8, false);
    if (army > v * 0.5) return false;
    this.regroups++;
    this.lastFallback = w.tick;
    this.stage = 'gather';
    this.stageStart = w.tick;
    this.siegeNeed = facing * 1.15;
    this.flank.clear();
    this.reinforce();
    w.issue({ c: 'move', player: this.p.id, units: [...this.wave], x: this.stageX, y: this.stageY });
    this.say('fallback', cx, cy);
    return true;
  }

  /**
   * (tune.proBombard, Classic) The wave's artillery shells the known defences round its target that it outranges (a V2
   * at 10 cells against a Tesla Coil's 8.5, a turret's 6, a pillbox's 5; a howitzer at 6 against pillboxes and flame
   * towers), all of them on the same one, the nearest first: an attack order on a structure it has seen is obeyed
   * through the fog, as a player's would be.
   */
  private bombard(units: Unit[]) {
    const w = this.world;
    const guns = units.filter((u) => u.kind === 'vehicle' && u.ut.noMovingFire && u.weapons.length && !(u.order.type === 'attack' && w.entities.get(u.order.target)?.alive));
    if (!guns.length) return;
    let cx = 0, cy = 0;
    for (const g of guns) { cx += g.x; cy += g.y; }
    cx /= guns.length; cy /= guns.length;
    const range = Math.min(...guns.map((g) => g.weapons[0].def.range));
    let best: KnownStructure | null = null, bd = Infinity;
    for (const s of this.intel.structures.values()) {
      if (!s.armed || s.aa || w.players[s.owner]?.defeated || this.intel.dark(s) || s.range >= range - 0.5) continue;
      const d = Math.hypot(s.x - cx, s.y - cy) + Math.hypot(s.x - this.stageTarget[0], s.y - this.stageTarget[1]) * 0.5;
      if (d < bd && Math.hypot(s.x - this.stageTarget[0], s.y - this.stageTarget[1]) < 16) { bd = d; best = s; }
    }
    if (!best) return;
    const b = w.entities.get(best.id);
    if (!(b instanceof Building) || !b.alive) return;
    w.issue({ c: 'attack', player: this.p.id, units: guns.map((g) => g.id), target: b.id });
  }

  /** The army at home (idle, or walking back to the rally point) joins the wave at its staging point. */
  private reinforce() {
    const [gx, gy] = this.rallyPoint();
    const add: number[] = [];
    for (const u of this.available()) {
      if (this.wave.has(u.id)) continue;
      if (u.order.type === 'idle' || u.order.type === 'guard' || (u.order.type === 'move' && Math.hypot(u.x - gx, u.y - gy) < 25)) { this.wave.add(u.id); add.push(u.id); }
    }
    this.waveStart = Math.max(this.waveStart, this.wave.size);
    if (add.length) this.world.issue({ c: 'move', player: this.p.id, units: add, x: this.stageX, y: this.stageY });
  }

  /** The army's rally point in front of the base (Recruit and Easy supporting a human teammate: supportPoint). */
  rallyPoint(): [number, number] {
    const sp = this.supportPoint();
    if (sp) return sp;
    const [bx, by] = this.baseCenter();
    const [ex, ey] = this.enemyDir();
    return [bx + ex * this.d.rallyAhead, by + ey * this.d.rallyAhead];
  }

  /**
   * Version 6: Recruit and Easy with a human teammate play his support, a modest helper's role: no waves of their own
   * (they still join his pushes, ai-team.ts matePush), and the army waits a third of the way from their base towards
   * his, so that it reaches either base in time when one is attacked. A Recruit ally used to send its few units at the
   * enemy, and had none left, or too far away, when the human's base was hit. Null otherwise.
   */
  supportPoint(): [number, number] | null {
    if (this.d.skill >= 0.5 || !this.skirmish || this.ceasefire) return null;
    const mates = humanMates(this);
    if (!mates.length) return null;
    let yard: Building | null = null;
    for (const b of this.world.buildings) {
      if (!b.alive || b.bt.wall || b.bt.mine || !mates.includes(b.owner)) continue;
      if (b.bt.id === 'fact') { yard = b; break; }
      yard ??= b;
    }
    if (!yard) return null;
    const [bx, by] = this.baseCenter();
    const x = bx + (yard.x - bx) / 3, y = by + (yard.y - by) / 3;
    // (the open ground nearest that point: a fixed spot, whoever stands there)
    const m = this.world.map, fx = Math.floor(x), fy = Math.floor(y);
    for (let r = 0; r <= 6; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) === r && m.passable(fx + dx, fy + dy)) return [fx + dx + 0.5, fy + dy + 0.5];
    }
    return null;
  }

  /** A wave outmatched by what it runs into falls back to its staging point and regroups with reinforcements. */
  private fallBack(alive: Unit[]): boolean {
    const w = this.world;
    if (!this.tune.fallbackOn || this.stage !== 'assault' || this.regroups >= 1 || w.tick - this.lastFallback < TICK_HZ * 30 || !alive.length) return false;
    let cx = 0, cy = 0, v = 0;
    for (const u of alive) { cx += u.x; cy += u.y; v += u.ut.cost * u.healthFrac; }
    cx /= alive.length; cy /= alive.length;
    if (v > this.waveValueStart * 0.75) return false;
    // (mobile enemy forces only: a wave that is winning the field keeps grinding down the defences)
    const enemy = this.intel.strengthNear(cx, cy, 9, 8, false);
    if (v >= enemy * this.tune.fallbackRatio * trait(this.personality.caution, 0.6, 1.5)) return false;
    this.lastFallback = w.tick;
    this.regroups++;
    this.stage = 'gather';
    this.stageStart = w.tick;
    // reinforcements from home join at the staging point
    for (const u of this.available()) if (!this.wave.has(u.id) && (u.order.type === 'idle' || u.order.type === 'guard')) this.wave.add(u.id);
    this.flank.clear();
    this.waveStart = Math.max(this.waveStart, this.wave.size);
    w.issue({ c: 'move', player: this.p.id, units: [...this.wave], x: this.stageX, y: this.stageY });
    this.say('fallback', cx, cy);
    return true;
  }

  /** The nearest enemy structure we know of (and that still stands, as far as an attack order is concerned). */
  private nearestEnemyBuilding(x: number, y: number): Building | null {
    let best: Building | null = null, bestD = Infinity;
    for (const s of this.intel.structures.values()) {
      const b = this.world.entities.get(s.id);
      if (!(b instanceof Building) || !b.alive || !this.p.isEnemy(b.owner)) continue;
      const d = Math.hypot(b.x - x, b.y - y);
      if (d < bestD) { bestD = d; best = b; }
    }
    return best;
  }

  /** Where to attack: the best known enemy structure (refineries and factories first, fortified spots avoided). */
  pickAttackTarget(fromX?: number, fromY?: number): [number, number] | null {
    const [bx, by] = fromX !== undefined ? [fromX, fromY!] : this.baseCenter();
    let best: [number, number] | null = null, bestScore = Infinity;
    const known = this.intel.knownStructures();
    const coilWise = this.tune.teslaOn && alliedTools(this); // (Allied AI: mind the coils' reach, ai-allies.ts)
    // (Classic, version 5: the power plants a Tesla Coil base can't spare come first, whatever covers them)
    const power = this.classicPro && this.tune.proPower ? powerTargets(this, known) : null;
    for (const s of known) {
      if (this.world.players[s.owner]?.defeated) continue;
      let score = Math.hypot(s.x - bx, s.y - by);
      if (power?.has(s.id)) { score -= 12; if (score < bestScore) { bestScore = score; best = [s.x, s.y + s.h / 2 + 0.5]; } continue; }
      const bt = BUILDINGS[s.type];
      if ((s.type === 'proc' && this.d.raids) || bt?.factory) score -= 4;
      // steer around fortified spots
      if (s.armed) score += 6;
      if (coilWise) score += coilPenalty(known, s);
      else for (const d of known) if (d.armed && d !== s && d.owner === s.owner && Math.hypot(d.x - s.x, d.y - s.y) < 7) score += 3;
      if (score < bestScore) { bestScore = score; best = [s.x, s.y + s.h / 2 + 0.5]; }
    }
    if (best) return best;
    // nothing known yet: the likeliest base location (unexplored enemy start)
    const guess = this.intel.enemyBase(bx, by);
    if (guess) return guess;
    for (const s of this.intel.units.values()) {
      const score = Math.hypot(s.x - bx, s.y - by);
      if (score < bestScore) { bestScore = score; best = [s.x, s.y]; }
    }
    // (version 5: an enemy still in the game whose last structures it has lost track of is searched for, the square
    // of the map it has gone longest without seeing first; the waves used to sit at home until the time limit)
    if (!best && this.skirmish && this.world.players.some((o) => o !== this.p && !o.defeated && this.p.isEnemy(o))) best = this.intel.huntPoint(bx, by);
    return best;
  }

  // ---------------------------------------------------------------------------
  // Superweapons: timed with the attack waves
  // ---------------------------------------------------------------------------
  private superweapons() {
    const w = this.world;
    const p = this.p;
    if (!this.d.superweapons || !this.due(TICK_HZ)) return;
    const timed = this.d.skill >= 0.6 && this.skirmish && !!this.tune.swTimingOn;
    // build-up time: nothing is launched at the enemy (a ready nuke waits for the end of the ceasefire)
    const truce = this.ceasefire;
    if (superReady(w, p, 'nuke') && !truce) {
      if (this.nukeSince < 0) this.nukeSince = w.tick;
      // the densest cluster of known enemy structures (near the wave's target while one is about to go in)
      const synced = this.state === 'attack' && this.stage === 'gather';
      const held = w.tick - this.nukeSince > this.tune.nukeHold * trait(this.personality.superweapons, 1.5, 0.6) * TICK_HZ;
      if (!timed || synced || held) {
        const near = synced ? this.stageTarget : null;
        let best: { x: number; y: number } | null = null, bestScore = -1;
        const known = this.intel.knownStructures();
        for (const s of known) {
          if (near && Math.hypot(s.x - near[0], s.y - near[1]) > 14) continue;
          let score = 0;
          for (const o of known) if (o.owner === s.owner && Math.hypot(o.x - s.x, o.y - s.y) < 4) score += o.cost * (o.armed ? 1.5 : 1);
          if (score > bestScore) { bestScore = score; best = s; }
        }
        if (best) {
          w.issue({ c: 'superweapon', player: p.id, kind: 'nuke', x: best.x, y: best.y });
          this.nukeSince = -1;
          this.say('nuke', best.x, best.y);
        }
      }
    }
    if (superReady(w, p, 'ironcurtain') && this.state === 'attack' && (!timed || this.stage === 'assault') && !truce) {
      const tanks = this.waveUnits().filter((u) => u.kind === 'vehicle');
      if (tanks.length >= 3) {
        // the densest knot of tanks, once it is in the fight
        let best = tanks[0], bestN = -1;
        for (const t of tanks) {
          let n = 0;
          for (const o of tanks) if (Math.hypot(o.x - t.x, o.y - t.y) < 1.8) n++;
          if (n > bestN) { bestN = n; best = t; }
        }
        const engaged = !timed || this.intel.strengthNear(best.x, best.y, 7, 5) > 0;
        if (engaged) {
          w.issue({ c: 'superweapon', player: p.id, kind: 'ironcurtain', x: best.x, y: best.y });
          this.say('ironcurtain', best.x, best.y);
        }
      }
    }
    if (superReady(w, p, 'chrono')) {
      if (this.chronoSince < 0) this.chronoSince = w.tick;
      // an expansion MCV on a long drive is shifted straight to its ore field
      const ex = this.expansion;
      const mcv = ex && ex.stage === 'move' ? w.entities.get(ex.mcv) : null;
      if (mcv instanceof Unit && mcv.alive && Math.hypot(mcv.x - ex!.x, mcv.y - ex!.y) > 16 && w.map.passable(Math.floor(ex!.x), Math.floor(ex!.y))) {
        w.issue({ c: 'superweapon', player: p.id, kind: 'chrono', x: ex!.x, y: ex!.y, unit: mcv.id });
        this.chronoSince = -1;
        this.say('chrono', ex!.x, ex!.y);
        return;
      }
      const allied = this.tune.chronoOn && alliedTools(this);
      if (allied && alliedChrono(this)) return; // an ore truck rescued, a tank shifted into the assault (ai-allies.ts)
      const assault = this.state === 'attack' && this.stage === 'assault';
      if (!truce && (!timed || (assault && !allied) || w.tick - this.chronoSince > TICK_HZ * (allied ? 180 : 120))) {
        const tank = this.available().find((u) => u.kind === 'vehicle' && u.ut.id === '2tnk' && !this.wave.has(u.id) && u.healthFrac > 0.8)
          ?? this.army().find((u) => u.kind === 'vehicle' && u.ut.id === '2tnk');
        const t = assault ? this.stageTarget : this.pickAttackTarget();
        if (tank && t) {
          const spot = w.findFreeSpot(t[0] + 2, t[1] + 2, 4);
          w.issue({ c: 'superweapon', player: p.id, kind: 'chrono', x: spot[0], y: spot[1], unit: tank.id });
          this.chronoSince = -1;
          this.say('chrono', spot[0], spot[1]);
        }
      }
    }
  }

  /** Expected seconds to build (unused helper kept for tuning). */
  eta(type: string) {
    return buildSeconds(this.world, this.p, type);
  }

  // ---------------------------------------------------------------------------
  // Save / load (sim/save.ts): everything above that isn't derived from the world
  // ---------------------------------------------------------------------------
  saveState() {
    return {
      intel: this.intel.saveState(), flank: [...this.flank], flankTarget: this.flankTarget, flankX: this.flankX, flankY: this.flankY,
      waveValueStart: this.waveValueStart, regroups: this.regroups, lastFallback: this.lastFallback, waves: this.waves,
      repairs: [...this.repairs], focus: this.focus, focusUntil: this.focusUntil, scout: this.scout, lastScout: this.lastScout, scoutPlan: this.scoutPlan,
      raid: [...this.raid], raidX: this.raidX, raidY: this.raidY, raidStart: this.raidStart, raidValue: this.raidValue, lastRaid: this.lastRaid,
      expansion: this.expansion, escort: [...this.escort], expansions: this.expansions, lastExpandTry: this.lastExpandTry,
      nukeSince: this.nukeSince, chronoSince: this.chronoSince, spyTries: this.spyTries, lastSpy: this.lastSpy, radarSpy: this.radarSpy,
      threatSince: this.threatSince, lostAt: { ...this.lostAt }, had: { ...this.had }, lastPower: this.lastPower,
      enemyEst: this.enemyEst, estTick: this.estTick, lastAssault: this.lastAssault,
      mateThreat: this.mateThreat, lastMateHelp: this.lastMateHelp, siegeNeed: this.siegeNeed,
    };
  }

  loadState(s: ReturnType<AIController['saveState']> | undefined) {
    if (!s) return;
    this.intel.loadState(s.intel);
    this.flank = new Set(s.flank ?? []);
    this.flankTarget = s.flankTarget ?? null;
    this.flankX = s.flankX ?? 0; this.flankY = s.flankY ?? 0;
    this.waveValueStart = s.waveValueStart ?? 0;
    this.regroups = s.regroups ?? 0;
    this.lastFallback = s.lastFallback ?? -9999;
    this.waves = s.waves ?? 0;
    this.repairs = new Set(s.repairs ?? []);
    this.focus = s.focus ?? 0; this.focusUntil = s.focusUntil ?? 0;
    this.scout = s.scout ?? 0; this.lastScout = s.lastScout ?? -9999; this.scoutPlan = s.scoutPlan ?? [];
    this.raid = new Set(s.raid ?? []);
    this.raidX = s.raidX ?? 0; this.raidY = s.raidY ?? 0; this.raidStart = s.raidStart ?? 0; this.raidValue = s.raidValue ?? 0; this.lastRaid = s.lastRaid ?? -9999;
    this.expansion = s.expansion ? { ...s.expansion } : null;
    this.escort = new Set(s.escort ?? []);
    this.expansions = s.expansions ?? 0; this.lastExpandTry = s.lastExpandTry ?? -9999;
    this.nukeSince = s.nukeSince ?? -1; this.chronoSince = s.chronoSince ?? -1;
    this.spyTries = s.spyTries ?? 0; this.lastSpy = s.lastSpy ?? -9999; this.radarSpy = s.radarSpy ?? 0;
    this.lastPower = s.lastPower ?? -99999;
    this.enemyEst = s.enemyEst ?? 0; this.estTick = s.estTick ?? 0; this.lastAssault = s.lastAssault ?? -99999;
    this.mateThreat = s.mateThreat ?? -1; this.lastMateHelp = s.lastMateHelp ?? -99999; this.siegeNeed = s.siegeNeed ?? 0;
    this.threatSince = s.threatSince ?? -1; this.lostAt = { ...(s.lostAt ?? {}) }; this.had = { ...(s.had ?? {}) };
  }
}

export { UNITS };
