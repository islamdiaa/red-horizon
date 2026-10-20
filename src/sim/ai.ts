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
import { AIIntel } from './ai-intel';
import { bestFitness, counterWeights } from './ai-counter';
import { DEFAULT_TUNING, resolvePersonality, trait, type AITuning, type Personality } from './ai-personality';
import { expansionStructure, expansionPlacement, focusFire, harass, manageExpansion, manageRepairs, retreatDamaged, scouting } from './ai-ops';
import { ceasefireActive, hostileTarget, inHomeArea } from './ceasefire';
import { commanderAI } from './ai-commander';
import { doctrineDefences, doctrinePrefer } from './doctrine';
import { econAI, econDocks, econPlacement, econReserve, econStructure } from './economy-ai'; // Commander economy
import { alliedAir, alliedArtillery, alliedChrono, alliedSpies, alliedTools, coilPenalty } from './ai-allies'; // the Allied commander's own tools

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
  /** Seconds an intruder must have been at the base before the army answers, and before a lost structure is rebuilt. */
  defendDelay: number;
  rebuildDelay: number;
}

const UNCAPPED = 1e9;
/** What the full AI may use (hard and brutal; the easier levels below scale it down). */
const FULL = {
  maxRefs: UNCAPPED, maxHarv: UNCAPPED, expansions: 3, outposts: UNCAPPED, neutral: true, events: 1,
  maxTier: 3, tierPace: 1, research: 2, researchMax: UNCAPPED, upgrades: null, projects: 3, processors: UNCAPPED, econPlus: true, econResearch: true, bunkers: 3,
  doctrine: true, powerTier: 3, powerUse: 1, offensivePowers: true, powers: null, powerGap: 0,
  raids: true, agents: true, siege: true, waveCap: UNCAPPED, armyCap: UNCAPPED, defendDelay: 0, rebuildDelay: 0,
};

/**
 * The difficulty levels (simulation version 3: the difficulty overhaul, docs/BALANCE.md). Recruit and easy are
 * scaled down everywhere: one or two refineries and few trucks, no expansions, outposts or derrick hunting, late and
 * capped tech, no doctrine and at most Field Repair among the commander powers, small capped waves, no raids on
 * harvesters, no agents or mines, no superweapons, slow reactions and slow rebuilding. Measured against scripted
 * human stand-ins (tools/selfplay/standins.ts).
 */
const DIFF: Record<AIDifficulty, DiffParams> = {
  recruit: {
    buildSpeed: 0.5, income: 0.7, firstAttack: 900, waveValue: 1800, waveGrowth: 400, defenses: 1, reaction: 0.3, superweapons: false, skill: 0.1, scoutAt: 240,
    maxRefs: 1, maxHarv: 2, expansions: 0, outposts: 0, neutral: false, events: 0,
    maxTier: 1, tierPace: 2, research: 0, researchMax: 0, upgrades: [], projects: 0, processors: 0, econPlus: false, econResearch: false, bunkers: 0,
    doctrine: false, powerTier: 0, powerUse: 0, offensivePowers: false, powers: [], powerGap: 120,
    raids: false, agents: false, siege: false, waveCap: 3000, armyCap: 4000, defendDelay: 15, rebuildDelay: 150,
  },
  easy: {
    buildSpeed: 0.6, income: 0.75, firstAttack: 720, waveValue: 2500, waveGrowth: 700, defenses: 2, reaction: 0.4, superweapons: false, skill: 0.3, scoutAt: 150,
    maxRefs: 2, maxHarv: 3, expansions: 0, outposts: 0, neutral: false, events: 0,
    maxTier: 2, tierPace: 3, research: 1, researchMax: 1, upgrades: ['powr_turbine'], projects: 1, processors: 0, econPlus: false, econResearch: false, bunkers: 0,
    doctrine: false, powerTier: 1, powerUse: 0.35, offensivePowers: false, powers: ['repair'], powerGap: 120,
    raids: false, agents: false, siege: false, waveCap: 6000, armyCap: 8000, defendDelay: 6, rebuildDelay: 60,
  },
  normal: {
    buildSpeed: 0.95, income: 1.0, firstAttack: 420, waveValue: 3500, waveGrowth: 1800, defenses: 3, reaction: 0.7, superweapons: true, skill: 0.6, scoutAt: 70,
    ...FULL,
    maxRefs: 3, maxHarv: 6, expansions: 1, outposts: 1, events: 0.6,
    tierPace: 1.3, researchMax: 4, projects: 2, processors: 2, econPlus: false, bunkers: 2,
    powerUse: 0.6, powerGap: 45, powers: ['recon', 'repair', 'funds', 'rally', 'elite', 'barrage', 'reinforce', 'aegis'], // (no Tesla Storm or Sabotage)
    waveCap: 12000, armyCap: 30000, defendDelay: 2, rebuildDelay: 20,
  },
  hard: {
    buildSpeed: 1.05, income: 1.05, firstAttack: 300, waveValue: 3500, waveGrowth: 2000, defenses: 4, reaction: 0.85, superweapons: true, skill: 0.85, scoutAt: 45,
    ...FULL,
    expansions: 2, outposts: 2, events: 0.8, tierPace: 1.1, processors: 3, powerUse: 0.8, powerGap: 30,
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
    if (!this.foundSaid && this.intel.foundTick >= 0 && !this.intel.omniscient) {
      this.foundSaid = true;
      const [bx, by] = this.baseCenter();
      const e = this.intel.enemyBase(bx, by);
      this.say('scouted', e?.[0], e?.[1]);
    }
    this.handleMcv();
    this.placeReadyStructure();
    if (this.d.rebuildDelay > 0 && this.due(TICK_HZ * 2)) this.noteLosses();
    this.planStructures();
    this.planUnits();
    this.repairBase();
    aiNavalThink(this.world, this.p, this.thinks, this.difficulty, this.behaviour !== 'full' || this.ceasefire, this); // (ceasefire: home waters only)
    if (this.behaviour === 'defensive') { this.defendOnly(); return; }
    if (this.skirmish) {
      scouting(this);
      manageExpansion(this);
    }
    this.military();
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
      const a = this.deployTries * 2.1;
      const r = 1.5 + this.deployTries * 0.5;
      this.world.issue({ c: 'move', player: this.p.id, units: [mcv.id], x: mcv.x + Math.cos(a) * r, y: mcv.y + Math.sin(a) * r });
    }
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
    return this.personality.goals?.[this.p.faction] ?? (this.skirmish ? SKIRMISH_GOALS : GOALS)[this.p.faction];
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

  private nextStructure(): string | null {
    const p = this.p;
    // power first
    const surplus = p.powerOut - p.powerUse;
    const goal = this.goalList().find(([t, n]) => this.count(t) < n && p.canBuild(t) && this.allowed(t));
    const goalDrain = goal ? Math.max(0, -BUILDINGS[goal[0]].power) : 0;
    if (surplus < 20 || surplus - goalDrain < 0) {
      if (p.canBuild('apwr')) return 'apwr';
      if (p.canBuild('powr')) return 'powr';
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
    // (easier levels take their time to replace what they lost)
    const lost = this.lostAt[t];
    if (lost !== undefined && this.world.tick - lost < this.d.rebuildDelay * TICK_HZ) return false;
    if (AIR_DEFENSE.has(t)) {
      // (recruit and easy: only once enemy aircraft have shown up)
      return this.intel.armyMix(600).air > 0 || (this.d.skill >= 0.5 || !this.levelled) && this.world.time > 720 * trait(pers.defence, 1.4, 0.6);
    }
    if (DEFENSES.has(t)) {
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
    const reserve = keyStruct ? Math.min(early ? 2000 : 1200, nextCost * (early ? 0.8 : 0.6)) + 100 : early ? nextCost * 0.3 : 100;
    const underThreat = this.world.tick - this.lastDefend < TICK_HZ * 10;
    if (this.world.econ && p.credits < reserve + econReserve(this) && !underThreat) return; // (saving for upgrades / research)
    if (p.credits < reserve && !underThreat) return;
    // an expansion MCV in the queue goes first
    if (this.expansion?.stage === 'build' && vq.items.some((i) => i.type === 'mcv')) return;
    // build-up time: the army grows to its cap for this difficulty, then the money goes into the base
    if (this.atBuildupCap(units)) return;
    // (easier levels: an army this size is all they field)
    if (this.d.armyCap < UNCAPPED && this.armyValue(units) >= this.d.armyCap) return;
    const inf = units.filter((u) => u.kind === 'infantry').length;
    const veh = units.filter((u) => u.kind === 'vehicle' && !u.ut.harvester && !u.ut.deploysInto).length;
    const canVeh = p.has('weap');
    let infCap = (this.world.time > 600 ? veh * 0.8 + 4 : veh * 1.5 + 6) * trait(pers.infantry, 0.35, 3);
    // counter-composition at the arm level: against an army our infantry can't trade with (heavy armour crushes
    // riflemen), fewer foot soldiers and more vehicles
    const edge = canVeh && this.tune.counterOn && this.skirmish && this.d.skill >= 0.5 ? this.armEdge() : 0;
    if (edge < -1) infCap = Math.max(4, infCap * Math.max(0.35, 1 + edge * 0.25));
    if (!iq.items.length && (!canVeh || inf < infCap)) {
      // (healers only in proportion to the infantry they can look after)
      const healers = units.filter((u) => u.ut.medic).length;
      const mix = this.mix(INF_MIX[p.faction]).map(([t, wt]): [string, number] => [t, this.skirmish && UNITS[t]?.medic && healers >= Math.max(1, inf * this.tune.medicCap) ? 0 : wt]);
      const t = this.pick(mix);
      if (t) this.world.issue({ c: 'build', player: p.id, type: t, count: t === 'e1' ? 2 : 1 });
    }
    // (build-up time: the army comes first, so a vehicle starts as soon as the reserve is covered)
    if (!vq.items.length && p.credits > reserve + (this.ceasefire ? 0 : 500)) {
      const t = this.pick(this.mix(VEH_MIX[p.faction]));
      if (t) this.world.issue({ c: 'build', player: p.id, type: t });
    }
    const aq = p.queues.aircraft;
    const air = units.filter((u) => u.kind === 'aircraft').length;
    const airCap = (2 + this.d.defenses / 2) * trait(pers.air, 0, 3);
    if (!aq.items.length && p.credits > reserve + 1200 * trait(pers.air, 1.6, 0.5) && air < airCap) {
      const t = this.pick(this.mix(AIR_MIX[p.faction]));
      if (t) this.world.issue({ c: 'build', player: p.id, type: t });
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
    const opts = mix.filter(([t, w]) => w > 0 && this.p.canBuild(t));
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
    const [ex, ey] = this.enemyDir();
    const gx = bx + ex * 5, gy = by + ey * 5;

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
      if (((w.time >= firstAt && value >= need && !outmatched) || strong || broke) && !blind) {
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
      if (near >= main.length * 0.75 || w.tick - this.stageStart > TICK_HZ * 60) {
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
        if (this.fallBack(alive)) return;
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
      const breakers = wall ? idle.filter((u) => pickWeapon(u, wall!)) : [];
      if (wall && breakers.length && (!near || Math.hypot(near.x - idle[0].x, near.y - idle[0].y) > 5)) {
        w.issue({ c: 'attack', player: p.id, units: breakers.map((u) => u.id), target: wall.id, forced: true });
      } else if (near && Math.hypot(near.x - idle[0].x, near.y - idle[0].y) < 12) {
        w.issue({ c: 'attack', player: p.id, units: idle.map((u) => u.id), target: near.id });
      } else {
        const target = this.pickAttackTarget(idle[0].x, idle[0].y);
        if (target) w.issue({ c: 'move', player: p.id, units: idle.map((u) => u.id), x: target[0], y: target[1], attackMove: true });
        else { this.state = 'build'; this.flank.clear(); }
      }
    }
  }

  /** Commit idle units to an attack: stage outside the target, optionally split off a flanking group. */
  private launchWave(idle: Unit[], target: [number, number], bx: number, by: number) {
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
    } else if (this.nextWaveValue <= this.d.waveValue && !w.mission) {
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
    this.nextWaveValue += this.d.waveGrowth * trait(this.personality.aggression, 1.3, 0.75);
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
    for (const s of known) {
      if (this.world.players[s.owner]?.defeated) continue;
      let score = Math.hypot(s.x - bx, s.y - by);
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
    this.threatSince = s.threatSince ?? -1; this.lostAt = { ...(s.lostAt ?? {}) }; this.had = { ...(s.had ?? {}) };
  }
}

export { UNITS };
