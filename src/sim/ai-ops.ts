/**
 * Field operations of the skirmish AI (called from AIController): scouting, harassment raids, expansions to new
 * ore fields, pulling damaged vehicles out for repairs and focus fire. All of it works from the AI's own intel
 * (ai-intel.ts), never from hidden information, and its state lives on the controller (saved by saveState).
 */
import { BUILDINGS, UNITS, WARHEADS, type BuildingTypeDef } from '../data/rules';
import { Building, Unit, type Entity } from './entities';
import type { GameMap } from './map';
import type { Player } from './player';
import type { World } from './world';
import { pickWeapon } from './combat';
import { TICK_HZ } from './types';
import { trait } from './ai-personality';
import type { AIController } from './ai';
import { ceasefireActive } from './ceasefire';

// ---------------------------------------------------------------------------
// Scouting
// ---------------------------------------------------------------------------

/** Cheap, fast units make the best scouts. */
function scoutScore(u: Unit): number {
  if (u.ut.dog) return 100;
  if (u.ut.id === 'jeep') return 90;
  if (u.kind === 'infantry' && u.ut.id === 'e1') return 60;
  if (u.kind === 'vehicle' && u.ut.armor === 'light' && u.ut.cost <= 700) return 50;
  if (u.kind === 'infantry' && u.ut.cost <= 300) return 30;
  return -1;
}

export function scouting(ai: AIController) {
  const w = ai.world, p = ai.p;
  if (ai.intel.omniscient || !ai.tune.scoutOn || !ai.due(TICK_HZ)) return;
  const [bx, by] = ai.baseCenter();
  let scout = ai.scout ? w.entities.get(ai.scout) : undefined;
  if (scout && (!(scout instanceof Unit) || !scout.alive || scout.owner !== p)) { ai.scout = 0; scout = undefined; }
  if (scout instanceof Unit) {
    // hurt or done: come home and rejoin the army
    const done = !ai.scoutPlan.length;
    if (scout.healthFrac < 0.5 || (done && scout.order.type === 'idle')) {
      if (Math.hypot(scout.x - bx, scout.y - by) > 8) w.issue({ c: 'move', player: p.id, units: [scout.id], x: bx, y: by });
      ai.scout = 0;
      ai.scoutPlan = [];
      return;
    }
    const order = scout.order;
    const arrived = order.type === 'idle' || (order.type === 'move' && Math.hypot(order.x - scout.x, order.y - scout.y) < 3);
    if (arrived && ai.scoutPlan.length) {
      const [x, y] = ai.scoutPlan.shift()!;
      w.issue({ c: 'move', player: p.id, units: [scout.id], x, y });
    }
    return;
  }
  // time for a (re)scout?
  const first = ai.intel.foundTick < 0;
  if (w.time < ai.d.scoutAt) return;
  if (first ? w.tick - ai.lastScout < TICK_HZ * 45 : ai.d.skill < 0.5 || w.tick - ai.lastScout < ai.tune.rescoutEvery * TICK_HZ) return;
  const plan = scoutRoute(ai, bx, by, first);
  if (!plan.length) return;
  const pool = ai.army().filter((u) => !ai.wave.has(u.id) && !ai.raid.has(u.id) && !ai.repairs.has(u.id) && !ai.escort.has(u.id) && (u.order.type === 'idle' || u.order.type === 'guard'));
  let best: Unit | null = null, bestScore = 0;
  for (const u of pool) {
    const s = scoutScore(u);
    if (s > bestScore) { bestScore = s; best = u; }
  }
  if (!best) return;
  ai.scout = best.id;
  ai.lastScout = w.tick;
  ai.scoutPlan = plan.slice(1);
  w.issue({ c: 'move', player: p.id, units: [best.id], x: plan[0][0], y: plan[0][1] });
}

/** Waypoints: unexplored enemy starts first; later, the known base and ore fields near it (expansions). */
function scoutRoute(ai: AIController, bx: number, by: number, first: boolean): [number, number][] {
  const w = ai.world, m = w.map;
  const out: [number, number][] = [];
  const starts = ai.intel.candidateStarts(bx, by);
  if (first) {
    // approach each candidate from the side (the enemy army waits on the direct line, at its rally point)
    for (const [sx, sy] of starts.slice(0, 3)) {
      const dx = sx - bx, dy = sy - by, l = Math.hypot(dx, dy) || 1;
      const side = (ai.p.id % 2 ? 1 : -1) * Math.min(14, l * 0.3);
      const ox = sx - (dx / l) * l * 0.25 - (dy / l) * side, oy = sy - (dy / l) * l * 0.25 + (dx / l) * side;
      if (m.inBounds(Math.floor(ox), Math.floor(oy)) && m.passable(Math.floor(ox), Math.floor(oy))) out.push([ox, oy]);
      out.push([sx, sy]);
    }
    if (!out.length) {
      // nobody where the map says they should be: sweep unexplored ground
      const cell = unexploredCell(ai, bx, by);
      if (cell) out.push(cell);
    }
    return out;
  }
  const base = ai.intel.enemyBase(bx, by);
  if (base) out.push(base);
  // ore fields closer to the enemy than to us (expansions), least recently seen first
  for (const f of oreFields(m)) {
    if (!base) break;
    const dMe = Math.hypot(f.x - bx, f.y - by), dThem = Math.hypot(f.x - base[0], f.y - base[1]);
    if (dThem < dMe && dThem > 10 && out.length < 4) out.push([f.x, f.y]);
  }
  return out;
}

function unexploredCell(ai: AIController, bx: number, by: number): [number, number] | null {
  const m = ai.world.map, ex = ai.p.explored;
  let best: [number, number] | null = null, bestD = Infinity;
  for (let y = 4; y < m.h - 4; y += 6) for (let x = 4; x < m.w - 4; x += 6) {
    if (ex[m.idx(x, y)] || !m.passable(x, y)) continue;
    const d = Math.hypot(x - bx, y - by);
    if (d < bestD) { bestD = d; best = [x + 0.5, y + 0.5]; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Ore fields (cached per map)
// ---------------------------------------------------------------------------

interface OreField { x: number; y: number; cells: number }
/** (keyed by the field-cell list and its length: ore spreads to new cells during a match, and a loaded game must see
 * the same fields as the one it was saved from, or the AI's choices drift apart after a load) */
const fieldCache = new WeakMap<GameMap, { cells: number[]; n: number; f: OreField[] }>();

/** Ore / gem fields of the map: clusters of field cells (8 cells apart at most), from the current field layout. */
export function oreFields(m: GameMap): OreField[] {
  const c = fieldCache.get(m);
  if (c && c.cells === m.oreFieldCells && c.n === m.oreFieldCells.length) return c.f;
  let f: OreField[];
  const cells = m.oreFieldCells.slice().sort((a, b) => a - b);
  const label = new Map<number, number>();
  const groups: number[][] = [];
  for (const c of cells) {
    if (label.has(c)) continue;
    const g: number[] = [c];
    label.set(c, groups.length);
    for (let k = 0; k < g.length; k++) {
      const x = g[k] % m.w, y = (g[k] / m.w) | 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx, ny = y + dy;
        if (!m.inBounds(nx, ny)) continue;
        const j = m.idx(nx, ny);
        if (m.oreField[j] && !label.has(j)) { label.set(j, groups.length); g.push(j); }
      }
    }
    groups.push(g);
  }
  f = groups.filter((g) => g.length >= 6).map((g) => {
    let sx = 0, sy = 0;
    for (const c of g) { sx += c % m.w; sy += (c / m.w) | 0; }
    return { x: sx / g.length + 0.5, y: sy / g.length + 0.5, cells: g.length };
  });
  fieldCache.set(m, { cells: m.oreFieldCells, n: m.oreFieldCells.length, f });
  return f;
}

function oreLeft(m: GameMap, x: number, y: number, r: number): number {
  let n = 0;
  const fx = Math.floor(x), fy = Math.floor(y);
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (!m.inBounds(fx + dx, fy + dy)) continue;
    n += m.ore[m.idx(fx + dx, fy + dy)];
  }
  return n;
}

// ---------------------------------------------------------------------------
// Expansion: an MCV to a new ore field, then a refinery and a guard tower there
// ---------------------------------------------------------------------------

/** A spot to deploy a Construction Yard (3x3 buildable, clear) near a field, or null. */
function yardSpot(ai: AIController, f: OreField): [number, number] | null {
  const m = ai.world.map;
  let best: [number, number] | null = null, bestD = Infinity;
  for (let r = 3; r <= 7; r++) for (let a = 0; a < 16; a++) {
    const x = Math.floor(f.x + Math.cos((a / 16) * Math.PI * 2) * r), y = Math.floor(f.y + Math.sin((a / 16) * Math.PI * 2) * r);
    let ok = true;
    for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!m.buildable(x + dx, y + dy) || m.occupant[m.idx(x + dx, y + dy)] || m.ore[m.idx(x + dx, y + dy)]) { ok = false; break; }
    }
    if (!ok) continue;
    const d = Math.hypot(x - f.x, y - f.y);
    if (d < bestD) { bestD = d; best = [x + 0.5, y + 0.5]; }
  }
  return best;
}

export function manageExpansion(ai: AIController) {
  const w = ai.world, p = ai.p, pers = ai.personality;
  if (!ai.due(TICK_HZ * 2)) return;
  const ex = ai.expansion;
  if (ex) {
    stepExpansion(ai, ex);
    return;
  }
  // when to expand: a healthy economy at home, money in the bank, nothing on fire; and anybody whose home ore
  // is running out
  const homeOre = ai.oreCellsNear(18);
  // (an expansion costs an MCV, a refinery and harvesters: about $7000 that only pays back in a long game, so a
  // commander without an eye for economy waits until the ore at home is nearly gone)
  const maxExp = Math.max(pers.economy >= 0.8 ? 3 : pers.economy >= 0.6 ? 1 : 0, homeOre < 12 && w.time > 900 && pers.economy >= 0.3 ? ai.expansions + 1 : 0);
  if (!ai.tune.expandOn || ai.expansions >= Math.min(3, maxExp, ai.d.expansions) || ai.d.skill < 0.3) return;
  if (w.time < ai.tune.expandAfter * trait(pers.economy, 1.6, 0.55) / (0.6 + ai.d.skill * 0.4)) return;
  if (w.tick - ai.lastExpandTry < TICK_HZ * 45 || w.tick - ai.lastDefend < TICK_HZ * 20) return;
  if (ai.count('proc') < 2 || !p.canBuild('mcv')) return;
  // (Classic, version 6: not while behind on army, DiffParams.classicThrift; unless the ore at home is running out, or
  // the commander is an economist by taste)
  if (ai.classicPro && ai.thrift() > 0 && pers.economy < 0.8 && homeOre >= 40 && ai.armyValue() < ai.enemyEst * ai.thrift()) return;
  // affordable: money in the bank, or the ore at home running out (the MCV is paid as it is built anyway)
  if (p.credits < ai.tune.expandCredits * trait(pers.economy, 1.4, 0.5) && homeOre > 40 && pers.economy < 0.8) return;
  ai.lastExpandTry = w.tick;
  const [bx, by] = ai.baseCenter();
  const enemy = ai.intel.enemyBase(bx, by);
  const procs = w.buildings.filter((b) => b.alive && b.owner === p && b.bt.id === 'proc');
  let best: [number, number] | null = null, bestScore = Infinity;
  for (const f of oreFields(w.map)) {
    if (procs.some((r) => Math.hypot(r.x - f.x, r.y - f.y) < 14)) continue;
    if (oreLeft(w.map, f.x, f.y, 4) < 60) continue;
    const d = Math.hypot(f.x - bx, f.y - by);
    if (d > Math.max(w.map.w, w.map.h) * 0.62) continue;
    // stay on our side of the map (the middle is fair game), away from anything hostile we know of
    if (enemy && Math.hypot(f.x - enemy[0], f.y - enemy[1]) < d * 0.9) continue;
    if ([...ai.intel.structures.values()].some((s) => Math.hypot(s.x - f.x, s.y - f.y) < 14)) continue;
    if (ai.intel.strengthNear(f.x, f.y, 10, 60) > 0) continue;
    const spot = yardSpot(ai, f);
    if (!spot) continue;
    const score = d - f.cells * 0.15;
    if (score < bestScore) { bestScore = score; best = spot; }
  }
  if (!best) return;
  ai.expansion = { x: best[0], y: best[1], stage: 'build', mcv: 0, started: w.tick };
  w.issue({ c: 'build', player: p.id, type: 'mcv' });
}

function stepExpansion(ai: AIController, ex: NonNullable<AIController['expansion']>) {
  const w = ai.world, p = ai.p;
  const give = () => { ai.expansion = null; ai.escort.clear(); };
  if (w.tick - ex.started > TICK_HZ * 420) { give(); return; }
  if (ex.stage === 'build') {
    // the new MCV rolls out of the factory (any MCV other than one deploying at home)
    const mcv = w.units.find((u) => u.alive && u.owner === p && u.ut.deploysInto && u.order.type !== 'deploy');
    if (!mcv) {
      if (!p.queues.vehicle.items.some((i) => i.type === 'mcv') && w.tick - ex.started > TICK_HZ * 30) give();
      return;
    }
    if (!p.has('fact')) { give(); return; } // the home yard is gone: handleMcv redeploys it at home
    ex.mcv = mcv.id;
    ex.stage = 'move';
    w.issue({ c: 'move', player: p.id, units: [mcv.id], x: ex.x, y: ex.y });
    // a small escort
    const guards = ai.available().filter((u) => !ai.wave.has(u.id) && (u.order.type === 'idle' || u.order.type === 'guard') && u.kind === 'vehicle')
      .sort((a, b) => Math.hypot(a.x - mcv.x, a.y - mcv.y) - Math.hypot(b.x - mcv.x, b.y - mcv.y)).slice(0, 3);
    for (const g of guards) ai.escort.add(g.id);
    if (guards.length) w.issue({ c: 'move', player: p.id, units: guards.map((g) => g.id), x: ex.x, y: ex.y, attackMove: true });
    ai.say('expand', ex.x, ex.y);
    return;
  }
  if (ex.stage === 'move') {
    const mcv = w.entities.get(ex.mcv);
    if (!(mcv instanceof Unit) || !mcv.alive) {
      // deployed (a new yard next to the spot) or destroyed
      const yard = w.buildings.find((b) => b.alive && b.owner === p && b.bt.id === 'fact' && Math.hypot(b.x - ex.x, b.y - ex.y) < 4);
      if (yard) { ex.stage = 'yard'; ai.expansions++; } else give();
      return;
    }
    if (mcv.order.type === 'deploy' || mcv.moving || mcv.path) return;
    if (Math.hypot(mcv.x - ex.x, mcv.y - ex.y) < 2.5 && w.canDeploy(mcv)) w.issue({ c: 'deploy', player: p.id, units: [mcv.id] });
    else {
      const a = (w.tick % 16) * 0.4;
      w.issue({ c: 'move', player: p.id, units: [mcv.id], x: ex.x + Math.cos(a) * 1.2, y: ex.y + Math.sin(a) * 1.2 });
    }
    return;
  }
  const yard = w.buildings.find((b) => b.alive && b.owner === p && b.bt.id === 'fact' && Math.hypot(b.x - ex.x, b.y - ex.y) < 4);
  if (!yard) { give(); return; }
  if (ex.stage === 'yard' && w.buildings.some((b) => b.alive && b.owner === p && b.bt.id === 'proc' && Math.hypot(b.x - ex.x, b.y - ex.y) < 9)) {
    ex.stage = 'defend';
    // the escort goes back to the army
    ai.escort.clear();
  }
  if (ex.stage === 'defend' && w.buildings.some((b) => b.alive && b.owner === p && b.weapons.length && Math.hypot(b.x - ex.x, b.y - ex.y) < 9)) give();
}

/** nextStructure hook: what the expansion yard needs (a refinery, then one defence). */
export function expansionStructure(ai: AIController): string | null {
  const ex = ai.expansion;
  if (!ex || (ex.stage !== 'yard' && ex.stage !== 'defend')) return null;
  const p = ai.p;
  if (ex.stage === 'yard') return p.canBuild('proc') ? 'proc' : null;
  for (const t of p.faction === 'allies' ? ['gun', 'pbox'] : ['tsla', 'ftur']) if (p.canBuild(t) && p.credits >= BUILDINGS[t].cost * 0.5) return t;
  return null;
}

/** placeReadyStructure hook: expansion structures go next to the expansion yard. */
export function expansionPlacement(ai: AIController, bt: BuildingTypeDef): [number, number] | null {
  const ex = ai.expansion;
  if (!ex || (ex.stage !== 'yard' && ex.stage !== 'defend')) return null;
  if (ex.stage === 'yard' ? bt.id !== 'proc' : !bt.primary) return null;
  // refinery between the yard and the ore, defence on the far side of the field
  const ore = ai.nearestOre(ex.x, ex.y);
  const c: [number, number] = ore ? [(ex.x + ore[0]) / 2, (ex.y + ore[1]) / 2] : [ex.x, ex.y];
  return ai.findPlacement(bt, c);
}

// ---------------------------------------------------------------------------
// Harassment: small raids with fast units on harvesters and outlying refineries
// ---------------------------------------------------------------------------

export function harass(ai: AIController) {
  const w = ai.world, p = ai.p, pers = ai.personality;
  if (!ai.due(TICK_HZ)) return;
  const squad: Unit[] = [];
  for (const id of ai.raid) {
    const u = w.entities.get(id);
    if (u instanceof Unit && u.alive) squad.push(u); else ai.raid.delete(id);
  }
  const [bx, by] = ai.baseCenter();
  if (squad.length) {
    const home = () => {
      w.issue({ c: 'move', player: p.id, units: squad.map((u) => u.id), x: bx, y: by });
      ai.raid.clear();
    };
    let cx = 0, cy = 0, v = 0;
    for (const u of squad) { cx += u.x; cy += u.y; v += u.ut.cost * u.healthFrac; }
    cx /= squad.length; cy /= squad.length;
    // hit and run: out when hurt, outnumbered or after a minute and a half
    const enemy = ai.intel.strengthNear(cx, cy, 7, 4);
    if (v < ai.raidValue * 0.45 || w.tick - ai.raidStart > TICK_HZ * 90 || enemy > v * trait(pers.caution, 2, 0.9)) { home(); return; }
    // harvesters in sight: kill them first
    let prey: Unit | null = null, pd = Infinity;
    for (const u of w.units) {
      if (!u.alive || !p.isEnemy(u.owner) || !u.ut.harvester || !ai.intel.sees(u)) continue;
      const d = Math.hypot(u.x - cx, u.y - cy);
      if (d < 9 && d < pd) { pd = d; prey = u; }
    }
    if (prey) {
      const ids = canReach(w.map, squad.filter((u) => u.target !== prey && pickWeapon(u, prey!)), prey).map((u) => u.id);
      if (ids.length) w.issue({ c: 'attack', player: p.id, units: ids, target: prey.id });
      return;
    }
    const idle = squad.filter((u) => u.order.type === 'idle');
    if (idle.length === squad.length) {
      // at the target and nothing there: a soft structure nearby, else home
      let soft: Building | null = null, sd = Infinity;
      for (const s of ai.intel.structures.values()) {
        const b = w.entities.get(s.id);
        if (!(b instanceof Building) || !b.alive || s.armed) continue;
        const d = Math.hypot(b.x - cx, b.y - cy);
        if (d < 10 && d < sd) { sd = d; soft = b; }
      }
      const able = soft ? canReach(w.map, squad, soft) : [];
      if (soft && able.some((u) => pickWeapon(u, soft!))) w.issue({ c: 'attack', player: p.id, units: able.map((u) => u.id), target: soft.id });
      else home();
    }
    return;
  }
  // a new raid? (never during the build-up time)
  if (!ai.tune.harassOn || !ai.d.raids || ai.d.skill < 0.55 || pers.harass < 0.15 || w.time < 240 || ceasefireActive(w)) return;
  const every = (ai.tune.harassEvery * trait(pers.harass, 2.5, 0.45)) / ai.d.skill;
  if (w.tick - ai.lastRaid < every * TICK_HZ) return;
  const target = raidTarget(ai, bx, by);
  if (!target) return;
  // raiders: cheap, fast vehicles that can hurt a harvester (main battle tanks stay with the army)
  const pool = ai.available().filter((u) => !ai.wave.has(u.id) && (u.order.type === 'idle' || u.order.type === 'guard') && u.kind === 'vehicle' &&
      u.ut.cost <= (pers.harass > 0.8 ? 1000 : 800) && (u.ut.speed >= 8 || (pers.harass > 0.8 && u.ut.speed >= 7)) && hurtsArmour(u))
    .sort((a, b) => b.ut.speed - a.ut.speed || a.id - b.id);
  const want = ai.tune.harassValue * trait(pers.harass, 0.6, 1.5);
  const picked: Unit[] = [];
  let v = 0;
  for (const u of pool) {
    if (v >= want) break;
    picked.push(u);
    v += u.ut.cost;
  }
  // never strip the home guard bare
  if (picked.length < 2 || ai.available().length - picked.length < 3) return;
  ai.lastRaid = w.tick;
  ai.raidStart = w.tick;
  ai.raidValue = v;
  ai.raidX = target[0];
  ai.raidY = target[1];
  for (const u of picked) ai.raid.add(u.id);
  w.issue({ c: 'move', player: p.id, units: picked.map((u) => u.id), x: target[0], y: target[1], attackMove: true });
  ai.say('harass', target[0], target[1]);
}

/** Whether a unit's weapons do real damage to heavy armour (harvesters, trucks). */
function hurtsArmour(u: Unit): boolean {
  return u.weapons.some((s) => s.def.damage > 0 && s.def.antiGround && (WARHEADS[s.def.warhead]?.verses[3] ?? 0) >= 0.25);
}

/** Harvesters seen working away from defences, or the least defended refinery we know of. */
function raidTarget(ai: AIController, bx: number, by: number): [number, number] | null {
  const w = ai.world;
  let best: [number, number] | null = null, bestScore = Infinity;
  const since = w.tick - TICK_HZ * 90;
  for (const s of ai.intel.units.values()) {
    if (s.type !== 'harv' || s.seen < since) continue;
    const def = ai.intel.strengthNear(s.x, s.y, 8, 90);
    const score = Math.hypot(s.x - bx, s.y - by) * 0.3 + def / 150;
    if (score < bestScore) { bestScore = score; best = [s.x, s.y]; }
  }
  for (const s of ai.intel.structures.values()) {
    if (s.type !== 'proc') continue;
    const def = ai.intel.strengthNear(s.x, s.y, 8, 90);
    const score = Math.hypot(s.x - bx, s.y - by) * 0.3 + def / 150 + 6;
    if (score < bestScore) { bestScore = score; best = [s.x, s.y + 2]; }
  }
  // a heavily defended target is no raid
  if (best && ai.intel.strengthNear(best[0], best[1], 8, 90) > ai.tune.harassValue * 1.6) return null;
  return best;
}

// ---------------------------------------------------------------------------
// Retreat for repairs
// ---------------------------------------------------------------------------

function depot(ai: AIController): Building | null {
  return ai.world.buildings.find((b) => b.alive && b.owner === ai.p && b.bt.repairPad && b.active) ?? null;
}

/** Badly damaged vehicles leave the assault for the service depot (when there is one). */
export function retreatDamaged(ai: AIController, alive: Unit[], gx: number, gy: number) {
  const fix = depot(ai);
  if (!fix || !ai.tune.retreatOn) return;
  const limit = ai.tune.retreatHp * trait(ai.personality.caution, 0.55, 1.6);
  const out: number[] = [];
  for (const u of alive) {
    if (u.kind !== 'vehicle' || u.healthFrac >= limit || u.invulnerable > 0 || u.ut.cost < 500) continue;
    ai.wave.delete(u.id);
    ai.flank.delete(u.id);
    ai.repairs.add(u.id);
    out.push(u.id);
  }
  if (out.length) ai.world.issue({ c: 'move', player: ai.p.id, units: out, x: gx, y: gy });
}

/** Repair queue: one vehicle on the depot pad at a time; healed ones rejoin the army. */
/** A damaged vehicle of ours waiting on a Service Depot's pad (planUnits keeps the repair money back for it, version 6). */
export function onRepairPad(ai: AIController): boolean {
  if (!ai.repairs.size) return false;
  const fix = depot(ai);
  if (!fix) return false;
  for (const id of ai.repairs) {
    const u = ai.world.entities.get(id);
    if (u instanceof Unit && u.alive && u.hp < u.maxHp && !u.moving && fix.distTo(u.x, u.y) < 0.5) return true;
  }
  return false;
}

export function manageRepairs(ai: AIController, gx: number, gy: number) {
  if (!ai.repairs.size) return;
  const w = ai.world;
  const fix = depot(ai);
  const units: Unit[] = [];
  for (const id of ai.repairs) {
    const u = w.entities.get(id);
    if (!(u instanceof Unit) || !u.alive) { ai.repairs.delete(id); continue; }
    if (u.healthFrac >= 0.95 || !fix) {
      ai.repairs.delete(id);
      if (Math.hypot(u.x - gx, u.y - gy) > 5) w.issue({ c: 'move', player: ai.p.id, units: [u.id], x: gx, y: gy });
      continue;
    }
    units.push(u);
  }
  if (!fix || !units.length) return;
  const onPad = units.some((u) => u.order.type === 'enter' || (fix.distTo(u.x, u.y) < 0.5 && !u.moving));
  if (onPad) return;
  units.sort((a, b) => a.healthFrac - b.healthFrac || a.id - b.id);
  w.issue({ c: 'enter', player: ai.p.id, units: [units[0].id], target: fix.id });
}

// ---------------------------------------------------------------------------
// Focus fire
// ---------------------------------------------------------------------------

/** Targets worth concentrating on: they kill a lot, cost a lot, or keep the enemy going. */
const HIGH_VALUE: Record<string, number> = {
  arty: 2.5, v2rl: 2.5, '4tnk': 1.6, e7: 2.2, harv: 1.4, mcv: 2.5, ca: 1.8, tsla: 2.2, ftur: 1.3, gun: 1.4, pbox: 1.2, hbox: 1.2, sam: 1.2, agun: 1.2, e6: 2, medi: 1.4, mnly: 1.5, spy: 1.5,
};

export function focusFire(ai: AIController, alive: Unit[]) {
  const w = ai.world;
  if (!ai.tune.focusOn || ai.stage !== 'assault' || alive.length < 3) return;
  const cur = ai.focus ? w.entities.get(ai.focus) : undefined;
  if (cur && cur.alive && w.tick < ai.focusUntil) return;
  let cx = 0, cy = 0;
  for (const u of alive) { cx += u.x; cy += u.y; }
  cx /= alive.length; cy /= alive.length;
  let best: Entity | null = null, bestScore = 0;
  const score = (e: Entity) => (e.type.cost * (HIGH_VALUE[e.type.id] ?? 1) * (e.weapons.length ? 1.3 : 0.7)) / (e.hp + 60);
  for (const u of w.units) {
    if (!u.alive || !ai.p.isEnemy(u.owner) || u.isAir || Math.hypot(u.x - cx, u.y - cy) > 8 || !ai.intel.sees(u)) continue;
    const s = score(u);
    if (s > bestScore) { bestScore = s; best = u; }
  }
  for (const b of w.buildings) {
    if (!b.alive || !ai.p.isEnemy(b.owner) || !b.weapons.length || b.distTo(cx, cy) > 8 || !ai.intel.sees(b)) continue;
    const s = score(b);
    if (s > bestScore) { bestScore = s; best = b; }
  }
  if (!best) { ai.focus = 0; return; }
  const t = best as Entity;
  // enough shooters to finish it quickly (nearest first), not the whole army
  const shooters = alive.filter((u) => {
    const s = pickWeapon(u, t);
    return s && Math.hypot(u.x - t.x, u.y - t.y) <= s.def.range + 3;
  }).sort((a, b) => Math.hypot(a.x - t.x, a.y - t.y) - Math.hypot(b.x - t.x, b.y - t.y) || a.id - b.id);
  const ids: number[] = [];
  let dmg = 0;
  for (const u of shooters) {
    if (dmg >= t.hp * 1.4) break;
    const s = pickWeapon(u, t)!;
    dmg += (s.def.damage * s.def.burst * 4 * 15) / Math.max(1, s.def.rof);
    if (u.target !== t) ids.push(u.id);
  }
  ai.focus = t.id;
  ai.focusUntil = w.tick + TICK_HZ * 4;
  if (ids.length) w.issue({ c: 'attack', player: ai.p.id, units: ids, target: t.id });
}

void UNITS;

// ---------------------------------------------------------------------------
// Reachability: ground regions of the map (terrain, trees and intact bridges; buildings and units ignored)
// ---------------------------------------------------------------------------

/**
 * Version 6: the lanes a base needs kept open. The cells round each of the side's refinery docks and war-factory exits
 * (the 3x3 block centred on the dock or exit cell, outside the building itself) take no structure, defences included,
 * and a new refinery or war factory goes only where its own lane is open. The AI used to box an Ore Truck in for the
 * rest of a match: a power plant below the refinery's dock and a turret on either side of it.
 */
export function lanesOpen(world: World, p: Player, bt: BuildingTypeDef, px: number, py: number): boolean {
  const m = world.map, [sw, sh] = bt.size;
  const inFoot = (x: number, y: number) => x >= px && x < px + sw && y >= py && y < py + sh;
  for (const b of world.buildings) {
    if (!b.alive || b.owner !== p || (!b.bt.dock && b.bt.factory !== 'vehicle')) continue;
    const [lx, ly] = b.bt.dock ? b.dockCell()! : b.exitCell();
    if (lx < px - 1 || lx > px + sw || ly < py - 1 || ly > py + sh) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = lx + dx, y = ly + dy;
      if (x >= b.cx && x < b.cx + b.w && y >= b.cy && y < b.cy + b.h) continue;
      if (inFoot(x, y)) return false;
    }
  }
  const own = bt.dock ?? (bt.factory === 'vehicle' ? bt.exit ?? [Math.floor(sw / 2), sh] : null);
  if (own) {
    const lx = px + own[0], ly = py + own[1];
    if (!m.inBounds(lx, ly) || !m.passable(lx, ly)) return false;
    let open = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = lx + dx, y = ly + dy;
      if ((!dx && !dy) || inFoot(x, y) || !m.inBounds(x, y)) continue;
      const i = m.idx(x, y);
      if (m.occupant[i]) return false;
      if (m.terrainPassable(i)) open++;
    }
    if (open < 2) return false;
    // (version 7: and the lane leads somewhere: trees, rock, the map edge and the new structure itself can close a corner
    // off; a refinery's free Ore Truck sat at such a dock for the rest of a match)
    if (!roomAround(m, lx, ly, inFoot)) return false;
  }
  return true;
}

/** Open ground (4-neighbour, passable now, the new footprint counted as blocked) reachable from (x, y): at least ROOM_MIN cells. */
const ROOM_MIN = 30;
function roomAround(m: GameMap, x0: number, y0: number, blocked: (x: number, y: number) => boolean): boolean {
  const seen = new Set<number>([m.idx(x0, y0)]);
  const q = [m.idx(x0, y0)];
  for (let h = 0; h < q.length && seen.size < ROOM_MIN; h++) {
    const x = q[h] % m.w, y = (q[h] / m.w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!m.inBounds(nx, ny) || blocked(nx, ny)) continue;
      const j = m.idx(nx, ny);
      if (seen.has(j) || !m.passableIdx(j)) continue;
      seen.add(j);
      q.push(j);
    }
  }
  return seen.size >= ROOM_MIN;
}

const zoneCache = new WeakMap<GameMap, { trees: number; bridges: number; zone: Int32Array }>();

/** Ground regions of the map, one id per cell (0 = not passable ground). Derived from the map alone, so a loaded game sees the same. */
export function landZones(m: GameMap): Int32Array {
  let bridges = 0;
  for (let i = 0; i < m.bridgeAt.length; i++) if (m.bridgeAt[i]) bridges++;
  const c = zoneCache.get(m);
  if (c && c.trees === m.treeVersion && c.bridges === bridges) return c.zone;
  const zone = new Int32Array(m.w * m.h);
  let next = 0;
  const q: number[] = [];
  for (let s = 0; s < zone.length; s++) {
    if (zone[s] || !m.terrainPassable(s)) continue;
    zone[s] = ++next;
    q.length = 0;
    q.push(s);
    for (let h = 0; h < q.length; h++) {
      const i = q[h], cx = i % m.w, cy = (i / m.w) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = cx + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = cy + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue;
        const j = ny * m.w + nx;
        if (!zone[j] && m.terrainPassable(j)) { zone[j] = next; q.push(j); }
      }
    }
  }
  zoneCache.set(m, { trees: m.treeVersion, bridges, zone });
  return zone;
}

function zoneAt(m: GameMap, zone: Int32Array, x: number, y: number): number {
  const fx = Math.floor(x), fy = Math.floor(y);
  return m.inBounds(fx, fy) ? zone[fy * m.w + fx] : 0;
}

/**
 * The ground units of a list that can drive up to an entity (aircraft and ships always pass; a structure is reached
 * at its edge). Orders to targets across water or cliffs left units waiting on a path that never comes.
 */
export function canReach<T extends Unit>(m: GameMap, units: T[], e: { x: number; y: number; w?: number; h?: number }): T[] {
  const zone = landZones(m);
  const goal = new Set<number>();
  const hw = Math.ceil((e.w ?? 1) / 2) + 1, hh = Math.ceil((e.h ?? 1) / 2) + 1;
  for (let dy = -hh; dy <= hh; dy++) for (let dx = -hw; dx <= hw; dx++) goal.add(zoneAt(m, zone, e.x + dx, e.y + dy));
  return units.filter((u) => {
    if (u.kind === 'aircraft' || u.kind === 'naval') return true;
    const z = zoneAt(m, zone, u.x, u.y);
    return !z || goal.has(z); // (standing somewhere odd: the pathfinder decides)
  });
}
