// World Conquest headless play: pilot policies for the human's side, a battle model for the RTS route, and one
// whole game played to the end. Used by tools/world/strat-*.ts and tests/world-strat*.test.ts.
//
// Pilots (the human's stand-ins; they play through the public API in src/conquest/world/run.ts):
//   greedy        attacks whatever it can take, piles troops next to the weakest neighbour, ignores zones
//   zone          zone-focused: completes and walls zones, trades cards with care, fights key battles as RTS
//   cautious      turtles: big odds only, defends every border
//   dice          the zone-focused plan, but every attack and defence is left to the dice
// RTS battles are drawn from a model of the battle pilots' measured win rates in world battles (tools/world/qa-battles.ts
// on the region battlefields; see BASE_WIN): skill newcomer | casual | auto, by battle difficulty, kind, garrison
// strength and the troop ratio. It stands in for real battles (QA plays real ones with tools/conquest-harness.ts).
import { Rng } from '../../src/core/rng';
import type { BattleKind, BattleOutcome } from '../../src/conquest/battle';
import {
  HUMAN, NEUTRAL, aiProfile, applyBattle, battlePreview, endTurn, newWorldRun, ownedCount, resolveDefence, startBattle, startDefenceBattle,
  type NewWorldOptions, type WorldRun,
} from '../../src/conquest/world/run';
import { battleDifficulty } from '../../src/conquest/world/resolve';
import { aiTurn, type AIProfile } from '../../src/conquest/world/powers';

export type PilotId = 'greedy' | 'zone' | 'cautious' | 'dice';
export type Skill = 'newcomer' | 'casual' | 'auto';
export const PILOTS: PilotId[] = ['greedy', 'zone', 'cautious', 'dice'];

export function profileFor(run: WorldRun, pilot: PilotId): AIProfile {
  // a sharp (Normal-level precision) brain with the pilot's priorities
  const base: AIProfile = { ...aiProfile(run, HUMAN), noise: 0.1, randomPlace: 0, maxAttacks: 30, fortifyP: 1, humanW: 1, leaderFocus: 0.3 };
  switch (pilot) {
    // greedy: grab the weakest target every time, pile troops next to it, no zones, no defence, cards at once
    case 'greedy': return { ...base, minP: 0.5, contP: 0.3, zoneW: 0, breakW: 0, elimW: 0, weakW: 3, defShare: 0, concentrate: 1, exposureW: 0, tradeEarly: true, caution: 0.5, fortifyP: 0.3, lossW: 0.4, killW: 0 };
    // cautious: big odds only, every border defended
    case 'cautious': return { ...base, minP: 0.78, contP: 0.6, zoneW: 1.0, breakW: 0.5, elimW: 0.8, weakW: 0.3, defShare: 0.65, concentrate: 0.4, exposureW: 1.2, tradeEarly: false, caution: 1.5, lossW: 1.3, killW: 0.5 };
    // zone-focused: greedy's momentum, plus what a strategist adds: completing and breaking zones, not leaving a new
    // conquest open to a big stack, fortifying every turn, hunting eliminations (an ablation from greedy, Blitz Normal,
    // 200 games each: zones +6 points, exposure +5, fortify +5, eliminations +3; border reserves -5, spreading -3)
    case 'zone': case 'dice': return { ...base, minP: 0.5, contP: 0.3, zoneW: 1.8, breakW: 1.3, elimW: 1.3, weakW: 3, defShare: 0, concentrate: 1, exposureW: 0.5, tradeEarly: true, caution: 0.5, fortifyP: 1, lossW: 0.4, killW: 0 };
  }
}

// =====================================================================================================
// Battle model
// =====================================================================================================
/**
 * Measured win rates at garrison strength 3 (6 v 4 troops), [easy, normal, hard] per kind: World Conquest battles on
 * the region battlefields after the STRAT-3 core fix (QA runs/battles-2 + STRAT runs/qa-battles/after-core, pooled;
 * Easy holds after the lighter Easy hold guard), Europe Conquest (round 5 runs/final-cq.md) where a cell had no data
 * (defend, most boss cells).
 */
const BASE_WIN: Record<Skill, Record<BattleKind, [number, number, number]>> = {
  newcomer: { assault: [0.97, 0.18, 0.03], capture: [0.97, 0.15, 0.03], hold: [0.95, 0.75, 0.95], defend: [0.97, 0.97, 0.75], naval: [0.95, 0.1, 0.15], boss: [0.8, 0.04, 0.02] },
  casual: { assault: [0.93, 0.5, 0.31], capture: [0.97, 0.67, 0.36], hold: [0.97, 0.8, 0.9], defend: [0.97, 0.9, 0.9], naval: [0.92, 0.75, 0.42], boss: [0.95, 0.1, 0.05] },
  auto: { assault: [0.99, 0.99, 0.97], capture: [0.99, 0.99, 0.97], hold: [0.99, 0.99, 0.97], defend: [0.99, 0.99, 0.99], naval: [0.97, 0.97, 0.97], boss: [0.97, 0.9, 0.9] },
};
const logit = (p: number) => Math.log(p / (1 - p));
const sigm = (x: number) => 1 / (1 + Math.exp(-x));

export function battleWinChance(skill: Skill, difficulty: 'easy' | 'normal' | 'hard', kind: BattleKind, strength: number): number {
  const base = BASE_WIN[skill][kind][difficulty === 'easy' ? 0 : difficulty === 'normal' ? 1 : 2];
  return sigm(logit(Math.max(0.01, Math.min(0.99, base))) - 0.45 * (strength - 3));
}
/** ...and with the troop ratio (a bigger army lands more tanks and funds). */
export function battleWinChanceRatio(skill: Skill, difficulty: 'easy' | 'normal' | 'hard', kind: BattleKind, strength: number, mine: number, theirs: number): number {
  const p = battleWinChance(skill, difficulty, kind, strength);
  const r = Math.max(-2, Math.min(2, 0.5 * Math.log2(Math.max(1, mine) / Math.max(1, theirs))));
  return sigm(logit(Math.max(0.01, Math.min(0.99, p))) + r);
}

/** A battle's outcome as the battle pilots would produce it (the spec's own id; kills/losses set the casualty share). */
export function modelOutcome(run: WorldRun, rng: Rng, skill: Skill): BattleOutcome {
  const S = run.pending!.spec;
  const W = S.world!;
  const mine = W.action === 'attack' ? W.attackers : W.defenders, theirs = W.action === 'attack' ? W.defenders : W.attackers;
  const won = rng.chance(battleWinChanceRatio(skill, S.difficulty ?? 'normal', S.kind, S.strength, mine, theirs));
  const share = won ? rng.range(0.12, 0.45) : rng.range(0.5, 0.85);
  const kills = 40, losses = Math.round((kills * share) / (1 - share));
  return {
    battleId: S.id, won, time: rng.range(420, 1200), creditsLeft: Math.round(rng.range(500, 5000)),
    objectives: [{ id: 'swift', text: '', primary: false, state: won && rng.chance(0.3) ? 'done' : 'failed' }],
    survivors: S.core.filter(() => won ? rng.chance(0.85) : rng.chance(0.4)).map((c) => ({ vet: c.vet, rank: Math.min(2, c.rank + (rng.chance(0.2) ? 1 : 0)), xp: c.xp + 200 })),
    recruits: won && rng.chance(0.5) ? [{ type: run.faction === 'allies' ? '2tnk' : '3tnk', rank: 1, xp: 400 }] : [],
    kills, losses, superweaponDestroyed: false,
  };
}

// =====================================================================================================
// One game
// =====================================================================================================
export interface GameResult {
  seed: number;
  home: string;
  size: string;
  difficulty: string;
  pilot: PilotId;
  skill: Skill;
  status: 'won' | 'lost' | 'active';
  ending: string;
  turns: number;
  battles: number;
  battlesWon: number;
  /** Turn each rival was eliminated (null: survived), and by whom. */
  eliminated: { power: number; personality: string; turn: number | null; by: number | null }[];
  /** Largest share of territories any rival held, and when. */
  peakRivalShare: number;
  /** Longest run of full rounds where no territory changed hands. */
  longestQuiet: number;
  humanPeak: number;
  ms: number;
  error?: string;
}

export interface PlayOptions {
  pilot: PilotId;
  skill?: Skill;
  /** Most RTS battles the pilot fights per turn (dice pilots: 0). */
  fightsPerTurn?: number;
  /** Play the pilot's plan with dice only (no RTS battles). */
  diceOnly?: boolean;
  /** Overrides of the pilot's brain (tuning experiments). */
  brain?: Partial<AIProfile>;
  maxTurns?: number;
}

/**
 * Should the pilot fight this attack as an RTS battle? Key targets (capitals, wonders) and big stacks, when it
 * expects to win the battle (a player knows which battles they can win: a casual player rolls the dice on a
 * Normal capital, whose boss battle it wins one time in ten).
 */
/** The battle win chance a pilot wants before it fights (FIGHT_AT env for experiments). */
const FIGHT_AT = +(process.env.FIGHT_AT ?? 0.7);
function wantsFight(run: WorldRun, from: string, to: string, skill: Skill): boolean {
  const T = run.territories;
  const t = T.find((x) => x.id === to)!, f = T.find((x) => x.id === from)!;
  const key = (t.capital !== undefined && t.owner !== NEUTRAL) || !!t.landmark || (t.troops >= 4 && f.troops - 1 >= t.troops);
  if (!key) return false;
  const P = battlePreview(run, from, to);
  return battleWinChanceRatio(skill, battleDifficulty(run), P.kind, P.strength, P.attackers, P.defenders) >= FIGHT_AT;
}

export function playGame(opts: NewWorldOptions, play: PlayOptions): GameResult {
  const t0 = performance.now();
  const skill = play.skill ?? 'casual';
  const fights = play.pilot === 'dice' || play.diceOnly ? 0 : play.fightsPerTurn ?? 1;
  const run = newWorldRun(opts);
  const brng = new Rng((opts.seed ^ 0x6a09e667) >>> 0);
  const res: GameResult = {
    seed: opts.seed, home: run.home, size: run.size, difficulty: run.difficulty, pilot: play.pilot, skill, status: 'active', ending: '', turns: 0,
    battles: 0, battlesWon: 0, eliminated: [], peakRivalShare: 0, longestQuiet: 0, humanPeak: 0, ms: 0,
  };
  const maxTurns = play.maxTurns ?? 400;
  let quiet = 0;
  const fight = (fromId: string, toId: string): boolean => {
    const setup = startBattle(run, fromId, toId);
    if (!setup) return false;
    res.battles++;
    const rep = applyBattle(run, modelOutcome(run, brng, skill));
    if (rep?.won) res.battlesWon++;
    if (run.army.perkChoice) { run.army.perks.push(run.army.perkChoice[0]); run.army.perkChoice = null; }
    return true;
  };
  try {
    for (let guard = 0; guard < maxTurns * 3 && run.status === 'active'; guard++) {
      if (run.current === HUMAN && !run.defence && !run.pending) {
        let fought = 0;
        const profile = { ...profileFor(run, play.pilot), ...(play.brain ?? {}) };
        aiTurn(run, HUMAN, [], {
          profile,
          attack: (r, from, to) => {
            if (fought >= fights || !wantsFight(r, from, to, skill)) return false;
            fought++;
            return fight(from, to);
          },
        });
      }
      if (run.status !== 'active') break;
      const before = run.turn;
      endTurn(run);
      // defence choices
      for (let k = 0; k < 20 && run.defence && run.status === 'active'; k++) {
        // (the pilots fight for their own capital themselves; anything else goes to the dice)
        const own = run.territories.find((t) => t.id === run.defence!.to)?.capital === HUMAN;
        if (fights > 0 && own && startDefenceBattle(run)) {
          res.battles++;
          const rep = applyBattle(run, modelOutcome(run, brng, skill));
          if (rep?.won) res.battlesWon++;
        } else resolveDefence(run, 'dice');
        endTurn(run);
      }
      if (run.turn !== before) {
        const rivalShare = Math.max(...run.powers.filter((p) => p.id !== HUMAN).map((p) => ownedCount(run, p.id))) / run.territories.length;
        // (a snowball is a rival running away while you are still in the game: rounds where you hold 10% or more)
        if (ownedCount(run, HUMAN) >= 0.1 * run.territories.length) res.peakRivalShare = Math.max(res.peakRivalShare, rivalShare);
        res.humanPeak = Math.max(res.humanPeak, ownedCount(run, HUMAN));
        // quiet rounds: run.quiet counts power turns without a conquest
        quiet = Math.max(quiet, run.quiet / Math.max(1, run.powers.filter((p) => p.alive).length));
      }
      if (run.turn > maxTurns) break;
    }
  } catch (e) {
    res.error = (e as Error).stack ?? String(e);
  }
  res.status = run.status;
  res.ending = run.ending ?? '';
  res.turns = run.turn;
  res.longestQuiet = Math.round(quiet * 10) / 10;
  res.eliminated = run.powers.filter((p) => p.id !== HUMAN).map((p) => ({ power: p.id, personality: p.personality, turn: p.alive ? null : p.eliminatedTurn ?? null, by: p.alive ? null : p.eliminatedBy ?? null }));
  res.ms = performance.now() - t0;
  return res;
}

/** 95% Wilson score interval for k successes in n trials. */
export function wilson(k: number, n: number): [number, number] {
  if (!n) return [0, 0];
  const z = 1.96, p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const r = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(c - r) / d, (c + r) / d];
}
export const pct = (x: number) => `${Math.round(x * 100)}%`;
export function rate(k: number, n: number): string {
  const [lo, hi] = wilson(k, n);
  return `${pct(n ? k / n : 0)} (${pct(lo)}-${pct(hi)})`;
}
