// Frozen copy of the simulation-version-2 skirmish AI (src/sim/ai-commander.ts as it was then), used by
// the self-play harness as the "experienced player" stand-in (tools/selfplay/standin.ts). Do not edit: it is a
// fixed yardstick, so the difficulty benchmarks stay comparable across AI changes.
/**
 * The skirmish AI under Commander rules: which commander powers it unlocks and when it uses them.
 *
 * Called once per think from AIController.think (only when the world has Commander rules). Stateless apart from
 * what the world already saves (the player's PlayerCmd, the AI's own wave state and intel), so save / load and
 * replays stay exact; randomness comes from world.rng, which Classic worlds never reach here.
 *
 * What a sensible commander does with each power:
 *  - Field Repair after (or during) fights, on the knot of damaged units worth the most,
 *  - Artillery Barrage / Tesla Storm on the densest cluster of enemy value it knows of (structures and defences
 *    near its wave's target when assaulting, an army at its gates when defending), never on its own troops,
 *  - Reinforcements when losing (army behind the enemy's, base under attack), else to back up an assault,
 *  - Rally Cry / Aegis Shield on the wave once it is engaged, Sabotage on the defence its wave is about to hit or on
 *    a power plant, Recon Sweep to find or re-check the enemy base, Emergency Funds when broke, Elite Training
 *    while the factories are busy.
 * Difficulty scales it: easier AIs react less often, pick their unlocks partly at random and settle for any target
 * worth hitting rather than the best one.
 */
import { Building, Unit } from '../../../src/sim/entities';
import type { AIController } from './ai';
import { TICK_HZ } from '../../../src/sim/types';
import { POWERS, TIER_COST, powerReady, powerTree, sabotageTarget, tierOpen, type PowerDef, type PowerId } from '../../../src/sim/commander';
import type { PlayerCmd } from '../../../src/sim/doctrine';

/** Base appetite for each power (higher = unlocked earlier). */
const APPETITE: Record<PowerId, number> = {
  funds: 5, repair: 6, recon: 3, barrage: 8, rally: 6, elite: 6, reinforce: 9, storm: 9, aegis: 7, sabotage: 6,
};

export function commanderAI(ai: AIController) {
  const w = ai.world, p = ai.p, c = p.cmd;
  if (!c || c.disabled || p.defeated || !ai.due(TICK_HZ)) return;
  aiUnlock(ai, c);
  // reaction: easier commanders notice the moment less often
  if (w.rng.next() > 0.3 + 0.7 * ai.d.skill) return;
  const ready = (id: PowerId) => powerReady(w, c, id);
  const truce = ai.ceasefire;
  const order: PowerId[] = ['reinforce', 'repair', 'storm', 'barrage', 'aegis', 'rally', 'sabotage', 'funds', 'elite', 'recon'];
  for (const id of order) {
    if (!ready(id)) continue;
    if (POWERS[id].offensive && truce) continue;
    if (tryPower(ai, id)) return;
  }
}

// ---------------------------------------------------------------------------------------------- unlocks

function aiUnlock(ai: AIController, c: PlayerCmd) {
  const w = ai.world, p = ai.p, pers = ai.personality, skill = ai.d.skill;
  const open: PowerDef[] = [];
  for (const tier of powerTree(p.faction)) for (const d of tier) if (!c.unlocked.includes(d.id) && tierOpen(c, d.tier)) open.push(d);
  if (!open.length) return;
  const score = (d: PowerDef) => {
    let s = APPETITE[d.id] + (d.tier - 1) * 2 * skill;
    if (d.id === 'barrage' || d.id === 'rally' || d.id === 'storm') s += (pers.aggression - 0.5) * 4;
    if (d.id === 'repair' || d.id === 'aegis' || d.id === 'reinforce') s += (pers.caution - 0.5) * 3 + (pers.defence - 0.5) * 2;
    if (d.id === 'funds') s += (pers.economy - 0.5) * 4;
    if (d.id === 'sabotage' || d.id === 'recon') s += (pers.subterfuge - 0.5) * 4;
    if (d.id === 'elite') s += (pers.tech - 0.5) * 2;
    // weaker commanders pick by feel
    s += (w.rng.next() - 0.5) * 8 * (1 - skill);
    return s;
  };
  let best: PowerDef | null = null, bestS = -Infinity, cheap: PowerDef | null = null, cheapS = -Infinity;
  for (const d of open) {
    const s = score(d);
    if (s > bestS) { bestS = s; best = d; }
    if (c.points + 1e-9 >= TIER_COST[d.tier] && s > cheapS) { cheapS = s; cheap = d; }
  }
  // save up for the favourite unless it is far off and something nearly as good is affordable now
  let pick: PowerDef | null = null;
  if (best && c.points + 1e-9 >= TIER_COST[best.tier]) pick = best;
  else if (cheap && (bestS - cheapS < 3 || TIER_COST[best!.tier] - c.points > 3)) pick = cheap;
  if (pick) w.issue({ c: 'unlockPower', player: p.id, power: pick.id });
}

// ---------------------------------------------------------------------------------------------- use

function cast(ai: AIController, id: PowerId, x?: number, y?: number, target?: number): true {
  ai.world.issue({ c: 'commanderPower', player: ai.p.id, power: id, x, y, target });
  return true;
}

function tryPower(ai: AIController, id: PowerId): boolean {
  const w = ai.world, p = ai.p, skill = ai.d.skill;
  const [bx, by] = ai.baseCenter();
  const assault = ai.state === 'attack' && ai.stage === 'assault';
  const underAttack = w.tick - ai.lastDefend < TICK_HZ * 6;
  switch (id) {
    case 'funds':
      return p.credits < 700 + 500 * skill ? cast(ai, id) : false;
    case 'elite': {
      const busy = p.queues.vehicle.items.length + p.queues.infantry.items.length + p.queues.aircraft.items.length;
      return busy > 0 ? cast(ai, id) : false;
    }
    case 'repair': {
      const spot = bestOwnCluster(ai, POWERS.repair.radius, (u) => u.ut.cost * (1 - u.healthFrac), skill);
      return spot && spot[2] >= 1400 - 500 * skill ? cast(ai, id, spot[0], spot[1]) : false;
    }
    case 'rally': case 'aegis': {
      if (!assault && !underAttack) return false;
      const units = assault ? ai.waveUnits() : ai.army();
      const r = POWERS[id].radius;
      let best: Unit | null = null, bestN = 0;
      for (const u of units) {
        let n = 0;
        for (const o of units) if (Math.hypot(o.x - u.x, o.y - u.y) <= r) n++;
        if (n > bestN) { bestN = n; best = u; }
      }
      if (!best || bestN < (id === 'aegis' ? 4 : 5)) return false;
      if (ai.intel.strengthNear(best.x, best.y, 8, 5) <= 0) return false; // not in the fight yet
      return cast(ai, id, best.x, best.y);
    }
    case 'barrage': case 'storm': {
      const spot = bestEnemyCluster(ai, POWERS[id].radius, id === 'storm', assault ? ai.stageTarget : null, skill);
      return spot && spot[2] >= (id === 'storm' ? 1800 : 1500) ? cast(ai, id, spot[0], spot[1]) : false;
    }
    case 'reinforce': {
      const enemy = ai.intel.armyMix(120).total;
      let mine = 0;
      for (const u of ai.army()) mine += u.ut.cost * u.healthFrac;
      if (underAttack || mine < enemy * 0.75) return cast(ai, id, bx, by);
      if (assault) {
        const units = ai.waveUnits();
        if (units.length) {
          let sx = 0, sy = 0;
          for (const u of units) { sx += u.x; sy += u.y; }
          return cast(ai, id, sx / units.length, sy / units.length);
        }
      }
      return false;
    }
    case 'sabotage': {
      const tgt = sabotagePick(ai, assault);
      return tgt ? cast(ai, id, tgt.x, tgt.y, tgt.id) : false;
    }
    case 'recon': {
      if (ai.intel.foundTick < 0 && !ai.intel.omniscient) {
        const s = ai.intel.candidateStarts(bx, by)[0];
        return s ? cast(ai, id, s[0], s[1]) : false;
      }
      if (ai.state === 'attack' && ai.stage === 'gather') return cast(ai, id, ai.stageTarget[0], ai.stageTarget[1]);
      if ((p.cmd!.uses.recon ?? 0) * 150 * TICK_HZ < w.tick) {
        const e = ai.intel.enemyBase(bx, by);
        return e ? cast(ai, id, e[0], e[1]) : false;
      }
      return false;
    }
  }
  return false;
}

/** The point among own units where `value` summed within r is highest: [x, y, value]. */
function bestOwnCluster(ai: AIController, r: number, value: (u: Unit) => number, skill: number): [number, number, number] | null {
  const units = ai.world.units.filter((u) => u.alive && u.owner === ai.p && !u.isAir && !u.ut.supportPlane && value(u) > 0);
  if (!units.length) return null;
  const step = skill < 0.5 ? 3 : 1; // (weaker commanders look less carefully)
  let best: [number, number, number] | null = null;
  for (let k = 0; k < units.length; k += step) {
    const u = units[k];
    let v = 0, sx = 0, sy = 0, n = 0;
    for (const o of units) if (Math.hypot(o.x - u.x, o.y - u.y) <= r) { const x = value(o); v += x; sx += o.x * x; sy += o.y * x; n++; }
    if (n && (!best || v > best[2])) best = [sx / v, sy / v, v];
  }
  return best;
}

/**
 * The best spot for an area strike: enemy value (known structures, armed ones x1.5, and enemy units in sight)
 * within r, minus twice the own value that would be caught in it. Near `focus` (the wave's target) when given.
 */
function bestEnemyCluster(ai: AIController, r: number, unitsOnly: boolean, focus: [number, number] | null, skill: number): [number, number, number] | null {
  const w = ai.world, p = ai.p;
  const pts: { x: number; y: number; v: number; own: boolean }[] = [];
  for (const s of ai.intel.knownStructures()) {
    const b = w.entities.get(s.id);
    if (!(b instanceof Building) || !b.alive || b.bt.wall || b.bt.mine) continue;
    pts.push({ x: s.x, y: s.y, v: (unitsOnly ? 0.5 : 1) * s.cost * (s.armed ? 1.5 : 1) * b.healthFrac, own: false });
  }
  for (const u of w.units) {
    if (!u.alive || u.isAir || u.ut.supportPlane) continue;
    if (u.owner.team === p.team) { pts.push({ x: u.x, y: u.y, v: u.ut.cost, own: true }); continue; }
    if (!p.isEnemy(u.owner) || !ai.intel.sees(u)) continue;
    pts.push({ x: u.x, y: u.y, v: u.ut.cost * u.healthFrac * (unitsOnly ? 1.3 : 1), own: false });
  }
  let best: [number, number, number] | null = null;
  const stride = skill < 0.5 ? 4 : skill < 0.8 ? 2 : 1;
  let k = 0;
  for (const c of pts) {
    if (c.own) continue;
    if (k++ % stride) continue;
    if (focus && Math.hypot(c.x - focus[0], c.y - focus[1]) > 16) continue;
    let v = 0;
    for (const o of pts) {
      const d = Math.hypot(o.x - c.x, o.y - c.y);
      if (o.own ? d <= r + 1.5 : d <= r) v += o.own ? -2 * o.v : o.v;
    }
    if (!best || v > best[2]) best = [c.x, c.y, v];
    if (skill < 0.5 && v >= 1500) break; // (good enough)
  }
  return best;
}

/** Sabotage: the defence nearest the assault target, else the enemy's best known power plant. */
function sabotagePick(ai: AIController, assault: boolean): Building | null {
  const w = ai.world, p = ai.p;
  let best: Building | null = null, bestScore = -Infinity;
  for (const s of ai.intel.knownStructures()) {
    const b = w.entities.get(s.id);
    if (!(b instanceof Building) || !b.alive || !b.active || !p.isEnemy(b.owner) || b.owner.cmd?.offline.has(b.id)) continue;
    let score = -Infinity;
    if (assault && s.armed && Math.hypot(s.x - ai.stageTarget[0], s.y - ai.stageTarget[1]) < 12) score = 100 + s.cost / 10;
    else if (b.bt.power > 0) score = b.bt.power / 10; // (the biggest plant it knows of: it can't read the enemy's power margin)
    if (score > bestScore && sabotageTarget(w, p, undefined, undefined, b.id)) { bestScore = score; best = b; }
  }
  return best;
}
