/**
 * The Classic commander's sense of when to fight (simulation version 4; AIController.classicPro: Classic rules,
 * skirmish, normal and up). Built only from what the AI has seen (ai-intel.ts): no map-hack, no extra money.
 *
 *  - An estimate of the enemy army that outlives the 150-second memory of sightings: the most it has seen at once,
 *    less what it has seen destroyed since, plus a modest allowance for what the enemy builds out of sight.
 *  - The defences it knows around a target.
 *  - A wave sets out only when it outweighs both by a margin; until then the army stays home, where its own defences
 *    fight beside it, and grows. An enemy attack that breaks on the base is answered at once (the counter-punch),
 *    while the enemy is weakest.
 *
 * In pure Red Alert rules the scripted casual player (tools/selfplay/standin.ts), who masses tanks behind four
 * defences and counter-attacks, beat every AI level more often than the experienced stand-in did: the AI kept sending
 * waves into his base and losing them, then had nothing left at home when his tanks came.
 */
import type { AIController } from './ai';
import { TICK_HZ } from './types';

/** A wave must outweigh the enemy army it expects and the defences at its target by this much. */
const EDGE = 1.25;
/** Known defences count this many times their price (they out-trade mobile units of the same price, and repair). */
const DEFENCE_WEIGHT = 1.5;
/** Cells around the target whose known defences the wave expects to meet. */
const DEFENCE_REACH = 12;
/** Credits a minute the enemy is assumed to add to his army out of sight (a commander reckons with what he can't see). */
const GROWTH_PER_MIN = 300;

/** Refresh the enemy army estimate (call every think). */
export function trackEnemy(ai: AIController) {
  const intel = ai.intel, tick = ai.world.tick;
  // what it saw destroyed since the last look comes off the estimate
  let killed = 0;
  for (const d of intel.deaths) if (d.tick > ai.estTick) killed += d.value;
  const dt = Math.max(0, tick - ai.estTick) / (TICK_HZ * 60);
  ai.estTick = tick;
  const seen = intel.armyMix(150).total;
  ai.enemyEst = Math.max(seen, ai.enemyEst - killed + GROWTH_PER_MIN * dt);
  // a real attack on the base keeps the army at home (AIController.military); a scout or a paradrop does not
  const [bx, by] = ai.baseCenter();
  if (intel.strengthNear(bx, by, ASSAULT_R, 5, false) >= ASSAULT_VALUE) ai.lastAssault = tick;
}

/** An enemy force at least this big (credits) within ASSAULT_R cells of the base is an attack, not a probe. */
const ASSAULT_VALUE = 2500;
const ASSAULT_R = 14;

/** Known ground defences within reach of a target, weighted. */
export function defenceAt(ai: AIController, x: number, y: number): number {
  let v = 0;
  for (const s of ai.intel.structures.values()) {
    if (!s.armed || s.aa || ai.world.players[s.owner]?.defeated) continue;
    if (Math.hypot(s.x - x, s.y - y) <= DEFENCE_REACH + s.range) v += s.cost * DEFENCE_WEIGHT;
  }
  return v;
}

/** The army value (credits) a wave against this target needs before it sets out. */
export function waveNeeds(ai: AIController, target: [number, number], caution: number): number {
  return (ai.enemyEst + defenceAt(ai, target[0], target[1])) * EDGE * caution;
}

/** A wave on its way or in the fight that has met more than it can beat (what it sees around it, defences included). */
export function outmatchedWave(ai: AIController, alive: { x: number; y: number; healthFrac: number; ut: { cost: number } }[]): boolean {
  if (!alive.length || ai.world.tick - ai.lastFallback < TICK_HZ * 20) return false;
  let cx = 0, cy = 0, v = 0;
  for (const u of alive) { cx += u.x; cy += u.y; v += u.ut.cost * u.healthFrac; }
  cx /= alive.length; cy /= alive.length;
  return ai.intel.strengthNear(cx, cy, 10, 8) > v * RETREAT_AT;
}

/** A wave turns back when what it faces is this much stronger than itself. */
const RETREAT_AT = 1.15;
