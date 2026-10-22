/**
 * Campaign difficulty: Red Alert's handicaps.
 *
 * Red Alert's campaign asked for a difficulty before every mission and handicapped two sides with it: the player's
 * house got `Scen.Difficulty`, every computer house `Scen.CDifficulty` (EA's GPL release, CnC_Remastered_Collection
 * REDALERT/SCENARIO.CPP Read_Scenario_INI → `PlayerPtr->Assign_Handicap(Scen.Difficulty)`; HOUSE.CPP HouseClass
 * constructor and Init_Data → `Assign_Handicap(Scen.CDifficulty)`). HOUSE.CPP `Assign_Handicap` copies the
 * RULES.INI section of that difficulty (RULES.CPP `Difficulty_Get`: [Easy], [Normal], [Difficult]) into the house's
 * FirepowerBias, ArmorBias, ROFBias, GroundspeedBias, AirspeedBias, CostBias and BuildSpeedBias. The slider
 * (SPECIAL.CPP `Fetch_Difficulty`; INIT.CPP, "case 0" to "case 4") had five positions with RULES.INI
 * `FineDiffControl=yes`, three without:
 *
 *   slider   player     computer       here
 *     0      Easy       Difficult      Recruit   (RA's plain "Easy")
 *     1      Normal     Difficult      Easy
 *     2      Normal     Normal         Normal    (RA's "Normal": no handicap at all)
 *     3      Normal     Easy           Hard
 *     4      Difficult  Easy           Brutal    (RA's plain "Hard")
 *
 * The values are the ones RULES.INI shipped with (Red Alert 3.03; the data file is not part of the GPL source
 * release, only the code that reads it):
 *
 *   [Easy]      FirePower=1.2 Groundspeed=1.2 Airspeed=1.2 Armor=1.2 ROF=.8  Cost=.8 BuildTime=.8
 *   [Normal]    every multiplier 1.0
 *   [Difficult] FirePower=.8  Groundspeed=.8  Airspeed=.8  Armor=.8  ROF=1.2 Cost=1  BuildTime=1
 *
 * How the engine reads them (TECHNO.CPP and friends): damage dealt × FirePower (`Fire_At`), reload × ROF
 * (`Rearm_Delay`; larger is slower), price × Cost (FACTORY.CPP), build time × BuildTime (`Time_To_Build`), top speed ×
 * Groundspeed / Airspeed (DRIVE.CPP, INFANTRY.CPP, AIRCRAFT.CPP). Those five apply here exactly so.
 *
 * Armor is left out. RULES.INI documents it as "armor strength", but TECHNO.CPP `Take_Damage` multiplies the damage
 * taken by it, so in the shipped game an Easy house (Armor=1.2) took 20% *more* damage and a Difficult house 20% less:
 * it never did what the file says. Both readings were measured against the campaign (tools/campaign-levels.ts):
 * the engine's made a timed demolition mission harder on Easy than on Normal (the enemy's Difficult structures
 * were tougher), and the documented one, on top of the other four, made Hard close to unwinnable even for the expert
 * autopilots (about 1.8 times the enemy's fighting strength, more than Red Alert's own Hard ever gave). Without it the
 * levels are monotonic and the extremes stay near what Red Alert played like.
 *
 * Also left out: RepairDelay, BuildDelay (never read by the engine), BuildSlowdown, DestroyWalls and ContentScan, which
 * only tune how the computer plays; the scripted missions' AI level (`MISSION_DIFF` in sim/ai.ts) already does.
 *
 * Who gets which: the human and the AI players on the human's team take the player's handicap (RA gave friendly
 * computer houses the computer's, which made Easy weaker allies, not a gentler war), players hostile to the human
 * take the computer's. Normal attaches nothing, so a Normal mission plays exactly as before. The handicap is a
 * non-enumerable `Player.hc` (like `cmd`), recomputed from the level and the current teams whenever either changes
 * (MissionRuntime.setLevel / setTeam, and after a save loads), so saves only carry the level.
 */
import type { Player } from './player';
import type { Unit } from './entities';

export type MissionLevel = 'recruit' | 'easy' | 'normal' | 'hard' | 'brutal';
export const MISSION_LEVELS: readonly MissionLevel[] = ['recruit', 'easy', 'normal', 'hard', 'brutal'];

export function isMissionLevel(v: unknown): v is MissionLevel {
  return typeof v === 'string' && (MISSION_LEVELS as readonly string[]).includes(v);
}

/** One RULES.INI difficulty section (the multipliers applied; Armor is left out, see above). */
export interface Handicap {
  readonly section: 'easy' | 'normal' | 'difficult';
  /** Damage dealt. */
  readonly firepower: number;
  /** Reload time (larger = slower fire). */
  readonly rof: number;
  /** Top speed of ground units and vessels. */
  readonly ground: number;
  /** Top speed of aircraft. */
  readonly air: number;
  /** Price (and so build time: here time follows the price, and RA's tables always pair Cost with BuildTime). */
  readonly cost: number;
}

export const RA_HANDICAPS: Readonly<Record<Handicap['section'], Handicap>> = {
  easy: { section: 'easy', firepower: 1.2, rof: 0.8, ground: 1.2, air: 1.2, cost: 0.8 },
  normal: { section: 'normal', firepower: 1, rof: 1, ground: 1, air: 1, cost: 1 },
  difficult: { section: 'difficult', firepower: 0.8, rof: 1.2, ground: 0.8, air: 0.8, cost: 1 },
};

/** The RA slider position of each level: the player's and the computer's section. */
export const LEVEL_SECTIONS: Readonly<Record<MissionLevel, { player: Handicap['section']; computer: Handicap['section'] }>> = {
  recruit: { player: 'easy', computer: 'difficult' },
  easy: { player: 'normal', computer: 'difficult' },
  normal: { player: 'normal', computer: 'normal' },
  hard: { player: 'normal', computer: 'easy' },
  brutal: { player: 'difficult', computer: 'easy' },
};

/** The handicap of a player of the human's side (null = none). */
export function playerHandicap(level: MissionLevel): Handicap | null {
  const s = LEVEL_SECTIONS[level]?.player;
  return s && s !== 'normal' ? RA_HANDICAPS[s] : null;
}
/** The handicap of a player hostile to the human (null = none). */
export function computerHandicap(level: MissionLevel): Handicap | null {
  const s = LEVEL_SECTIONS[level]?.computer;
  return s && s !== 'normal' ? RA_HANDICAPS[s] : null;
}

/**
 * Attach (or clear) every player's handicap for a level: the human's team gets the player's, its enemies the
 * computer's, anyone else (neutral pseudo-players) nothing.
 */
export function assignHandicaps(players: readonly Player[], human: Player, level: MissionLevel) {
  const mine = playerHandicap(level), theirs = computerHandicap(level);
  for (const p of players) {
    const h = p.team === human.team ? mine : human.isEnemy(p) ? theirs : null;
    if (h) Object.defineProperty(p, 'hc', { value: h, enumerable: false, writable: true, configurable: true });
    else if (p.hc) delete p.hc;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Hooks (each called behind an `owner.hc` check, so worlds without a handicap never reach them)
// ---------------------------------------------------------------------------------------------------------------
/** Top-speed multiplier of a unit (Groundspeed, or Airspeed for aircraft). */
export function hcSpeed(u: Unit): number {
  const h = u.owner.hc;
  return h ? (u.kind === 'aircraft' ? h.air : h.ground) : 1;
}

/** Player-facing summary of a level (percent changes for each side), for the picker and the briefing. */
export function levelSummary(level: MissionLevel): { side: 'you' | 'enemy'; firepower: number; rof: number; speed: number; cost: number }[] {
  const out: ReturnType<typeof levelSummary> = [];
  const pct = (v: number) => Math.round((v - 1) * 100);
  for (const [side, h] of [['you', playerHandicap(level)], ['enemy', computerHandicap(level)]] as const) {
    if (!h) continue;
    // rate of fire as shots per minute
    out.push({ side, firepower: pct(h.firepower), rof: pct(1 / h.rof), speed: pct(h.ground), cost: pct(h.cost) });
  }
  return out;
}
