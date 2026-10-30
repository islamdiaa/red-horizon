// Frozen copy of the simulation-version-2 skirmish AI (src/sim/economy-ai.ts as it was then), used by
// the self-play harness as the "experienced player" stand-in (tools/selfplay/standin.ts). Do not edit: it is a
// fixed yardstick, so the difficulty benchmarks stay comparable across AI changes.
/**
 * The skirmish AI under the Commander economy: when it climbs the tech tiers, which upgrades and research it buys,
 * which of the new structures it builds and where, and who garrisons its bunkers.
 *
 * Called from AIController (ai.ts) through small hooks: `econAI` once per think, `econStructure` from its build
 * order, `econPlacement` when a structure is ready, `econReserve` / `econDocks` for its money and harvester plans.
 * Stateless apart from what the world saves, so save / load and replays stay exact. Randomness: world.rng, which
 * Classic worlds never reach here.
 *
 * Personality and difficulty shape it: aggressive commanders tech late and buy army-wide upgrades (Assembly Line,
 * Logistics); tycoons go economy first (Processors, a Purifier, outposts, Improved Harvesters); turtles reinforce
 * defences and man bunkers; tech-minded ones climb tiers early and research more. Easier AIs start later, run fewer
 * projects at once and pick research partly at random.
 */
import { BUILDINGS, UNITS, type BuildingTypeDef } from '../../../src/data/rules';
import type { Building } from '../../../src/sim/entities';
import type { AIController } from './ai';
import { trait } from './ai-personality';
import { TICK_HZ } from '../../../src/sim/types';
import { SYNERGY, UPGRADES, researchFor, tierOf, type ResearchDef } from '../../../src/sim/economy-data';
import { canGarrison, outpostSiteOk, researchCost, researchIssue, upgradeCost, upgradeIssue } from '../../../src/sim/economy';

/** Seconds into the match when this commander wants Tier 2 / Tier 3. */
function tierTimes(ai: AIController): [number, number] {
  const pers = ai.personality, skill = ai.d.skill;
  const t2 = 270 * trait(pers.tech, 1.7, 0.6) * trait(pers.aggression, 0.85, 1.35) * (1.45 - 0.45 * skill) * trait(pers.economy, 1.1, 0.9);
  const t3 = t2 + 330 * trait(pers.tech, 1.6, 0.7) * trait(pers.superweapons, 1.2, 0.85) * (1.4 - 0.4 * skill);
  return [t2, t3];
}

/** How many upgrade / research projects it runs at once. */
function maxTasks(ai: AIController): number {
  const pers = ai.personality, skill = ai.d.skill;
  return 1 + (skill >= 0.8 ? 1 : 0) + (pers.economy > 0.75 || pers.tech > 0.7 ? 1 : 0);
}

function tasks(ai: AIController): Building[] {
  return ai.myBuildings().filter((b) => b.task);
}

/** Credits still to pay on the running projects (ai.ts keeps that much back from unit production, capped). */
export function econReserve(ai: AIController): number {
  let left = 0;
  for (const b of tasks(ai)) {
    const t = b.task!;
    const cost = t.kind === 'upgrade' ? upgradeCost(ai.p, b.bt, t.id) : researchCost(ai.p, t.id, t.level);
    left += cost * (1 - t.progress);
  }
  // a tier project is worth saving for; the rest only takes a share
  const tier = tasks(ai).some((b) => b.task!.id === 'cy_t2' || b.task!.id === 'cy_t3');
  return Math.min(tier ? 1600 : 700, left * (tier ? 0.8 : 0.35));
}

/** Docks besides refineries (mining outposts): more harvesters for the AI. */
export function econDocks(ai: AIController): number {
  return ai.count('mout');
}

// ---------------------------------------------------------------------------------------------- think

export function econAI(ai: AIController) {
  const w = ai.world, p = ai.p, e = p.econ;
  if (!e || p.defeated || !ai.due(TICK_HZ * 2) || !ai.tune.econOn) return;
  garrison(ai);
  if (ai.behaviour !== 'full' && ai.behaviour !== 'defensive') return;
  const running = tasks(ai);
  if (running.length >= maxTasks(ai)) return;
  // broke: projects wait (the army and the base come first)
  if (p.credits < 400 && running.length) return;
  const [t2, t3] = tierTimes(ai);
  const time = w.time;
  const yard = ai.myBuildings().find((b) => b.bt.id === 'fact' && b.active && !b.task);
  // tiers first
  if (yard) {
    const blocked = ai.goalList().some(([t, n]) => ai.count(t) < n && tierOf(t) > e.tier && p.prereqsMet(BUILDINGS[t] ?? UNITS[t]));
    if (e.tier === 1 && (time >= t2 || (blocked && time >= t2 * 0.7)) && !upgradeIssue(w, p, yard, 'cy_t2')) return start(ai, yard, 'cy_t2');
    if (e.tier === 2 && time >= t3 && !upgradeIssue(w, p, yard, 'cy_t3') && p.credits > 800) return start(ai, yard, 'cy_t3');
  }
  if (running.some((b) => b.task!.id === 'cy_t2' || b.task!.id === 'cy_t3')) return;
  // power: a turbine instead of another plant
  if (p.powerOut - p.powerUse < 60) {
    const plant = ai.myBuildings().find((b) => (b.bt.id === 'powr' || b.bt.id === 'apwr') && !upgradeIssue(w, p, b, 'powr_turbine'));
    if (plant) return start(ai, plant, 'powr_turbine');
  }
  // easier commanders take their time: a research level every 8 minutes, an upgrade every 5
  const slow = ai.d.skill < 0.5;
  let levels = 0, installed = 0;
  for (const id in e.levels) levels += e.levels[id];
  for (const b of ai.myBuildings()) installed += (b.upgrades?.length ?? 0) + ((b.hpBoost ?? 1) > 1 ? 1 : 0);
  // research at a free lab
  const lab = ai.myBuildings().find((b) => b.bt.id === 'rlab' && b.active && !b.task);
  if (lab && p.credits > 600 && (!slow || levels < 1 + Math.floor(time / 480))) {
    const pick = pickResearch(ai, lab);
    if (pick) { w.issue({ c: 'research', player: p.id, building: lab.id, tech: pick }); return; }
  }
  if (slow && installed >= 2 + Math.floor(time / 300)) return;
  const up = pickUpgrade(ai);
  if (up) start(ai, up[0], up[1]);
}

function start(ai: AIController, b: Building, id: string) {
  ai.world.issue({ c: 'upgrade', player: ai.p.id, building: b.id, upgrade: id });
}

/** The research this commander wants most at `lab` (null = nothing worth it now). */
function pickResearch(ai: AIController, lab: Building): string | null {
  const w = ai.world, p = ai.p, pers = ai.personality, skill = ai.d.skill;
  const doctrine = p.cmd?.doctrine ?? '';
  let best: string | null = null, bestS = -Infinity;
  const army = armyValues(ai);
  for (const r of researchFor(p.faction)) {
    if (researchIssue(w, p, lab, r.id)) continue;
    const lv = (p.econ!.levels[r.id] ?? 0) + 1;
    let s = score(ai, r, army);
    if (SYNERGY[doctrine] === r.id) s += 3;
    if (lv === 2) s -= 1.5; // breadth first
    s += (w.rng.next() - 0.5) * 6 * (1 - skill); // weaker commanders pick by feel
    if (s > bestS) { bestS = s; best = r.id; }
  }
  // easy commanders research little; tech-shy ones only what really pays
  const bar = 2 + (1 - skill) * 3 + (0.5 - pers.tech) * 3;
  return bestS >= bar ? best : null;
}

/** What the army is made of, by value (credits): research is worth what it improves. */
function armyValues(ai: AIController) {
  const out = { vehicles: 0, tanks: 0, infantry: 0, tesla: 0, harvs: 0 };
  for (const u of ai.myUnits()) {
    if (u.ut.harvester) { out.harvs++; continue; }
    if (!u.weapons.length || u.ut.deploysInto) continue;
    if (u.kind === 'vehicle') { out.vehicles += u.ut.cost; if (u.ut.id === '3tnk' || u.ut.id === '4tnk' || u.ut.id === 'ttnk' || u.ut.id === 'qtnk') out.tanks += u.ut.cost; }
    else if (u.kind === 'infantry') out.infantry += u.ut.cost;
    if (u.ut.id === 'ttnk' || u.ut.id === 'shok') out.tesla += u.ut.cost;
  }
  return out;
}

function score(ai: AIController, r: ResearchDef, a: ReturnType<typeof armyValues>): number {
  const pers = ai.personality, p = ai.p;
  // (each line scores about 1 point per $2,000-3,000 of army it improves, plus the commander's taste)
  switch (r.id) {
    case 'composite_armor': return 3 + a.vehicles / 2500 + (1 - pers.infantry) * 2;
    case 'reactive_armor': return 3 + a.tanks / 2000 + (1 - pers.infantry) * 2;
    case 'precision_optics': return 3 + a.vehicles / 4000 + pers.artillery * 2 + pers.defence;
    case 'rapid_deployment': return 3 + pers.aggression * 3;
    case 'chrono_logistics': return 2 + pers.economy * 3 + a.harvs * 0.3;
    case 'tesla_amplifiers': return 2 + ai.count('tsla') * 1.2 + a.tesla / 2000 + pers.defence;
    case 'conscription': return 2 + a.infantry / 1500 + pers.infantry * 4;
    case 'heavy_industry': return 3 + a.vehicles / 3000 + pers.aggression * 1.5;
    case 'improved_harvesters': return 2 + a.harvs * 0.6 + pers.economy * 3;
    case 'field_medicine': return 2 + a.infantry / 2000 + pers.caution * 2 + pers.infantry;
  }
  return p.econ ? 1 : 0;
}

/** The structure upgrade this commander wants most now ([structure, upgrade id] or null). */
function pickUpgrade(ai: AIController): [Building, string] | null {
  const w = ai.world, p = ai.p, pers = ai.personality, skill = ai.d.skill;
  const doctrine = p.cmd?.doctrine ?? '';
  let best: [Building, string] | null = null, bestS = -Infinity;
  const procs = ai.count('proc');
  let processors = 0, reinforced = 0;
  for (const b of ai.myBuildings()) {
    if (b.upgrades?.includes('proc_processor')) processors++;
    if ((b.hpBoost ?? 1) > 1) reinforced++;
  }
  for (const b of ai.myBuildings()) {
    if (!b.active || b.task) continue;
    for (const id of Object.keys(UPGRADES)) {
      const u = UPGRADES[id];
      if (!u.hosts.includes(b.bt.id) || id === 'cy_t2' || id === 'cy_t3' || id === 'powr_turbine') continue;
      if (upgradeIssue(w, p, b, id)) continue;
      let s = 0;
      switch (id) {
        case 'proc_processor': s = 4 + pers.economy * 4 - processors * (1.5 - pers.economy) + (procs >= 2 ? 1 : 0); break;
        case 'weap_assembly': s = 4 + pers.aggression * 2 + (1 - pers.infantry) * 1.5; break;
        case 'weap_armor': s = 3 + pers.tech * 2 + (1 - pers.infantry); break;
        case 'barr_training': s = 1 + pers.infantry * 6 - (b.primary ? 0 : 2); break;
        case 'def_reinforced': s = (pers.defence - 0.45) * 8 + (b.bt.cost >= 1000 ? 1.5 : 0) - reinforced * 0.4; break;
        // (it speeds up GPS for the Allies, and the airfield's spy plane, paratroopers and parabombs for the Soviets)
        case 'dome_uplink': s = 1 + pers.subterfuge * 2 + pers.air * 2 + (p.faction === 'allies' ? 1 : ai.count('afld') ? 1.5 : 0); break;
      }
      if (SYNERGY[doctrine] === id) s += 2.5;
      if (s > bestS) { bestS = s; best = [b, id]; }
    }
  }
  const bar = 3 + (1 - skill) * 2.5;
  return bestS >= bar && p.credits > 500 ? best : null;
}

// ---------------------------------------------------------------------------------------------- structures

/** ai.ts nextStructure hook: a Commander structure this commander wants now (null = carry on with its list). */
export function econStructure(ai: AIController): string | null {
  const w = ai.world, p = ai.p, e = p.econ, pers = ai.personality, skill = ai.d.skill;
  if (!e || !ai.skirmish || !ai.tune.econOn) return null;
  const time = w.time;
  const can = (t: string) => p.canBuild(t) && p.credits >= BUILDINGS[t].cost * 0.4;
  // bunkers: defensive commanders put one or two on the approach early
  const bunkers = ai.count('bnkr');
  const wantBunkers = Math.round((pers.defence - 0.35) * 4 + (pers.infantry - 0.5) * 2);
  if (bunkers < Math.min(3, wantBunkers) && time > 150 && can('bnkr') && ai.myUnits().some((u) => u.kind === 'infantry' && u.weapons.length)) return 'bnkr';
  if (e.tier < 2) return null;
  // a research lab once the tier is in (tech-shy commanders a bit later)
  if (ai.count('rlab') < 1 && time > tierTimes(ai)[0] + 30 * trait(pers.tech, 2.5, 0.5) && can('rlab')) return 'rlab';
  // economy commanders: purifier / smelter once two refineries run
  const pur = p.faction === 'allies' ? 'purf' : 'smlt';
  if (ai.count(pur) < 1 && ai.count('proc') >= 2 && pers.economy + skill * 0.3 >= 0.6 && can(pur) && p.powerOut - p.powerUse > 40) return pur;
  // logistics centre for big armies
  if (ai.count('lgst') < 1 && time > 480 * trait(pers.aggression, 1.4, 0.75) && (pers.aggression > 0.4 || pers.infantry > 0.6 || skill >= 0.85) && can('lgst')) return 'lgst';
  // a forward mining outpost on a field in view, away from our docks
  const outposts = ai.count('mout');
  if (outposts < Math.round(pers.economy * 3 + skill) && time > 300 && can('mout') && outpostSpot(ai)) return 'mout';
  if (ai.count(pur) < 1 && can(pur) && time > 900 && p.powerOut - p.powerUse > 40) return pur;
  if (ai.count('rlab') < 2 && e.tier >= 3 && pers.tech > 0.6 && skill >= 0.85 && can('rlab')) return 'rlab';
  return null;
}

/** ai.ts placeReadyStructure hook: where the Commander structures go (null = the usual placement). */
export function econPlacement(ai: AIController, bt: BuildingTypeDef): [number, number] | null {
  if (!ai.p.econ) return null;
  if (bt.id === 'mout') return outpostSpot(ai);
  if (bt.id === 'bnkr') {
    const [bx, by] = ai.baseCenter();
    const [ex, ey] = ai.enemyDir();
    const side = ai.world.rng.range(-0.8, 0.8);
    return ai.findPlacement(bt, [bx + ex * 7 - ey * side * 4, by + ey * 7 + ex * side * 4]);
  }
  return null;
}

/** A spot for a mining outpost next to a visible ore field at least 12 cells from our docks. */
function outpostSpot(ai: AIController): [number, number] | null {
  const w = ai.world, p = ai.p, m = w.map;
  const bt = BUILDINGS.mout;
  const docks = ai.myBuildings().filter((b) => b.bt.dock).map((b) => [b.x, b.y] as [number, number]);
  const [bx, by] = ai.baseCenter();
  let best: [number, number] | null = null, bestD = Infinity;
  for (const i of m.oreFieldCells) {
    if (m.ore[i] < 3) continue;
    const x = i % m.w, y = (i / m.w) | 0;
    if (w.fog && !p.visible[i]) continue;
    if (docks.some(([dx, dy]) => Math.hypot(dx - x, dy - y) < 12)) continue;
    const d = Math.hypot(x - bx, y - by);
    if (d < bestD) { bestD = d; best = [x, y]; }
  }
  if (!best) return null;
  // ring around the ore cell, nearest our base first
  let spot: [number, number] | null = null, spotD = Infinity;
  for (let dy = -5; dy <= 4; dy++) for (let dx = -5; dx <= 4; dx++) {
    const cx = best[0] + dx, cy = best[1] + dy;
    if (!w.canPlace(p, 'mout', cx, cy) || !outpostSiteOk(w, p, bt, cx, cy)) continue;
    const d = Math.hypot(cx + 1 - bx, cy + 1 - by) + Math.abs(Math.hypot(dx, dy) - 3) * 2;
    if (d < spotD) { spotD = d; spot = [cx, cy]; }
  }
  return spot;
}

// ---------------------------------------------------------------------------------------------- garrisons

/** Idle infantry at home fill the bunkers (rocket soldiers first, then riflemen). */
function garrison(ai: AIController) {
  const w = ai.world, p = ai.p;
  const bunkers = ai.myBuildings().filter((b) => b.bt.garrison && b.active && (b.garrison?.length ?? 0) < b.bt.garrison);
  if (!bunkers.length) return;
  for (const b of bunkers) {
    const room = b.bt.garrison! - (b.garrison?.length ?? 0) - ai.myUnits().filter((u) => u.order.type === 'enter' && u.order.target === b.id).length;
    if (room <= 0) continue;
    const cands = ai.myUnits().filter((u) => canGarrison(u, b) && !ai.wave.has(u.id) && !ai.raid.has(u.id) && (u.order.type === 'idle' || u.order.type === 'guard') && Math.hypot(u.x - b.x, u.y - b.y) < 16)
      .sort((a, c) => (c.ut.id === 'e3' ? 1 : 0) - (a.ut.id === 'e3' ? 1 : 0) || Math.hypot(a.x - b.x, a.y - b.y) - Math.hypot(c.x - b.x, c.y - b.y));
    const pick = cands.slice(0, room).map((u) => u.id);
    if (pick.length) w.issue({ c: 'enter', player: p.id, units: pick, target: b.id });
  }
}
