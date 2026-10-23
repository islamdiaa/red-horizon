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
import type { KnownStructure } from './ai-intel';
import { BUILDINGS } from '../data/rules';
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
    if (!s.armed || s.aa || ai.world.players[s.owner]?.defeated || ai.intel.dark(s)) continue;
    if (Math.hypot(s.x - x, s.y - y) <= DEFENCE_REACH + s.range) v += s.cost * DEFENCE_WEIGHT;
  }
  return v;
}

/** The army value (credits) a wave against this target needs before it sets out. */
export function waveNeeds(ai: AIController, target: [number, number], caution: number): number {
  return (ai.enemyEst + defenceAt(ai, target[0], target[1])) * EDGE * caution * (late(ai) ? 0.75 : 1);
}

/** A wave on its way or in the fight that has met more than it can beat (what it sees around it, defences included). */
export function outmatchedWave(ai: AIController, alive: { x: number; y: number; healthFrac: number; ut: { cost: number } }[]): boolean {
  if (!alive.length || ai.world.tick - ai.lastFallback < TICK_HZ * 20) return false;
  let cx = 0, cy = 0, v = 0;
  for (const u of alive) { cx += u.x; cy += u.y; v += u.ut.cost * u.healthFrac; }
  cx /= alive.length; cy /= alive.length;
  return facingNear(ai, cx, cy) > v * (late(ai) ? 1.5 : RETREAT_AT);
}

/**
 * What a wave at (x, y) faces: the enemy army it sees around it and the defences that reach it, the defences weighed
 * by tune.proTowerW times their price (strengthNear's own weight is 2; version 5 experiments).
 */
export function facingNear(ai: AIController, x: number, y: number): number {
  const all = ai.intel.strengthNear(x, y, 10, 8);
  const w = ai.tune.proTowerW;
  // (a lighter weight only when clearly ahead: against a strong army the defences are worth what they always were)
  if (w === 2 || ai.armyValue() < ai.enemyEst * 1.5) return all;
  const army = ai.intel.strengthNear(x, y, 10, 8, false);
  return army + ((all - army) / 2) * w;
}

/**
 * Classic, normal and up (tune.proPower, version 5): an enemy's known power plants whose loss would leave his known
 * Tesla Coils without power (what the AI has seen of his plants and consumers). In Red Alert a coil base falls with
 * its power, not to a frontal assault.
 */
export function powerTargets(ai: AIController, known: KnownStructure[]): Set<number> {
  const out = new Set<number>();
  const owners = new Set<number>();
  for (const s of known) if (s.type === 'tsla' && !ai.world.players[s.owner]?.defeated) owners.add(s.owner);
  for (const o of [...owners].sort((a, b) => a - b)) {
    let make = 0, use = 0;
    for (const s of known) {
      if (s.owner !== o) continue;
      const pw = BUILDINGS[s.type]?.power ?? 0;
      if (pw > 0) make += pw; else use -= pw;
    }
    for (const s of known) {
      const pw = BUILDINGS[s.type]?.power ?? 0;
      if (s.owner === o && pw > 0 && make - pw < use) out.add(s.id);
    }
  }
  return out;
}

/** (tune.proLate) A long war: from tune.proLate seconds the commander takes more risk. */
function late(ai: AIController): boolean {
  return ai.tune.proLate > 0 && ai.world.time >= ai.tune.proLate;
}

/** A wave turns back when what it faces is this much stronger than itself. */
const RETREAT_AT = 1.15;
