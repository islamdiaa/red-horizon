// Human-like campaign pilots at two skill levels, for measuring every mission at every campaign difficulty
// (tools/campaign-levels.ts). The expert is the mission-specific autopilot in tools/campaign-pilots*.ts.
//
//   newcomer: plays what the mission gives. Looks at the game every 6 s. A slow, simple base (power, barracks,
//             refinery, war factory; one unit queued per factory at a time, no extra trucks, no defences, no
//             repairs). Every 45 s, once it has a handful of units, it attack-moves everything at the objective;
//             it answers a raid on its base after ten seconds. Does the bare action an objective names (an
//             engineer into the building, the team into the APCs, the MCV to the oasis), with no micro and no
//             special abilities (no superweapons, no C4 picks, no route planning). It reads the Field Manual: the
//             alerts the game raises (src/ui/coach.ts) change what it builds and how it attacks (fieldManual below).
//             Like Boot Camp and the loading tips teach, its attacks are attack-moves.
//   casual:   follows the briefing's hints with basic control. Looks every 3 s. A sensible base (two refineries,
//             two trucks each, the defences the tips suggest, power planned ahead) and the unit mix the tips name.
//             Gathers an army and attacks in waves, falls back when a wave breaks, defends its base at once,
//             keeps escorts with what they escort and the engineer back until the way is clear.
//
// Neither gets any economy bonus (the expert's AI brain plays with the Hard mission level's +15%). Both may read the
// map the way a player reads the briefing and the radar (where the objective is), not the enemy's plans.
import { AIController } from '../src/sim/ai';
import { aiPlacement } from '../src/sim/ai-naval';
import { BUILDINGS, UNITS } from '../src/data/rules';
import type { World } from '../src/sim/world';
import type { MissionRuntime } from '../src/sim/mission';
import type { Building, Entity, Unit } from '../src/sim/entities';
import { ground } from '../src/missions/common';
import { army, attack, attackMove, builder, commander, enemyThings, every, moveTo, nearestTo, type Pilot } from './campaign-pilots';
import { ALERTS, AlertQueue, CoachWatch, coachTick } from '../src/ui/coach';

export type Skill = 'newcomer' | 'casual';
type Pt = [number, number];
type Target = Entity | Pt | null;

const cen = (l: { x: number; y: number }[]) => ({ x: l.reduce((a, u) => a + u.x, 0) / Math.max(1, l.length), y: l.reduce((a, u) => a + u.y, 0) / Math.max(1, l.length) });
const pt = (t: Entity | Pt): Pt => (Array.isArray(t) ? t : [t.x, t.y]);
const mine = (w: World) => w.units.filter((u) => u.alive && u.owner.id === 0);
/** Everything a player drags a box around to send into battle (no trucks, MCVs or aircraft). */
const troops = (w: World) => mine(w).filter((u) => !u.ut.harvester && !u.ut.deploysInto && u.kind !== 'aircraft' && !u.transport && (u.weapons.length || u.ut.medic));
const enemyStructures = (w: World) => w.buildings.filter((b) => b.alive && !b.bt.wall && w.players[0].isEnemy(b.owner));
const enemyUnits = (w: World) => w.units.filter((u) => u.alive && w.players[0].isEnemy(u.owner));
const homeOf = (w: World, rt: MissionRuntime) => { const f = w.buildings.find((b) => b.alive && b.owner.id === 0 && b.bt.id === 'fact'); return f ? { x: f.x, y: f.y } : rt.start(0); };
const flagEnt = <T extends Entity>(w: World, id: number | undefined) => { const e = id ? w.getEntity(id) : undefined; return e && e.alive ? (e as T) : null; };
const objActive = (rt: MissionRuntime, id: string) => rt.state(id) === 'active';

/** No economy bonus: the AI placement helper sets the player's multipliers from its level; put back what the mission gave. */
function keepEconomy(w: World, make: () => void) {
  const p = w.players[0];
  const keep = [p.buildSpeed, p.incomeBias];
  make();
  [p.buildSpeed, p.incomeBias] = keep;
}

// =====================================================================================================
// The Field Manual
// =====================================================================================================
/**
 * The newcomer reads the Field Manual: the in-game coaching (src/ui/coach.ts, the same watch and alert queue the Hints
 * panel runs, about every half second) raises its alerts as they would show on screen, and the newcomer follows the
 * ones it has read: tanks against the defences that roast its infantry, bigger armies sent all together by
 * attack-move after piecemeal losses, units kept queued (and a second factory) when the money piles up. FM=0 turns it
 * off (the earlier stand-in that never read an alert).
 */
function fieldManual(w: World, s: Record<string, any>, log: (t: string) => void) {
  if (process.env.FM === '0') return;
  const p = w.players[0];
  s.fm ??= { watch: new CoachWatch(), queue: new AlertQueue(), read: new Set<string>() };
  const r = coachTick(s.fm.watch, s.fm.queue, w, p, true);
  if (!r.fresh) return;
  const a = ALERTS[r.idx];
  const key = typeof a.text === 'function' ? a.text(p, s.fm.watch, w) : a.text;
  s.fm.read.add(key);
  log(`field manual: ${key}`);
}
/** Whether the newcomer has read one of these alerts. */
const learnt = (s: Record<string, any>, ...keys: string[]) => !!s.fm && keys.some((k) => (s.fm.read as Set<string>).has(k));

// =====================================================================================================
// Economy
// =====================================================================================================
interface BaseSpec { order: string[]; inf: string[]; veh: string[]; air?: string[]; naval?: string[] }

/** A newcomer's base: the first structures of the order, one unit per factory at a time, from the mix in turn. */
function newbieBase(w: World, s: Record<string, any>, spec: BaseSpec) {
  const p = w.players[0];
  if (!s.placer) keepEconomy(w, () => { s.placer = new AIController(w, p, 'normal'); });
  const units = mine(w);
  if (!p.has('fact')) {
    const mcv = units.find((u) => u.ut.deploysInto);
    if (mcv && mcv.order.type === 'idle' && !s.mcvHold) {
      if (w.canDeploy(mcv)) w.issue({ c: 'deploy', player: 0, units: [mcv.id] });
      else w.issue({ c: 'move', player: 0, units: [mcv.id], x: mcv.x + (w.rng.next() - 0.5) * 4, y: mcv.y + (w.rng.next() - 0.5) * 4 });
    }
  } else {
    const q = p.queues.structure;
    s.noRoom ??= {};
    if (q.ready) {
      const bt = BUILDINGS[q.ready];
      const spot = bt.water ? aiPlacement(w, p, bt) : aiPlacement(w, p, bt) ?? s.placer.findPlacement(bt);
      if (spot) w.issue({ c: 'place', player: 0, type: q.ready, cx: spot[0], cy: spot[1] });
      else { w.issue({ c: 'cancel', player: 0, type: q.ready }); s.noRoom[q.ready] = w.time; }
    } else if (!q.items.length) {
      const count = (t: string) => w.buildings.filter((b) => b.alive && b.owner === p && b.bt.id === t).length;
      const seen: Record<string, number> = {};
      let next: string | null = null;
      // (the Field Manual's "money in the bank... build a second factory")
      const order = learnt(s, 'alerts.bankFactory') ? [...spec.order, ...(spec.veh.length ? ['weap'] : []), p.faction === 'soviet' ? 'barr' : 'tent'] : spec.order;
      for (const t of order) {
        seen[t] = (seen[t] ?? 0) + 1;
        if (count(t) < seen[t] && p.canBuild(t) && !(w.time - (s.noRoom[t] ?? -1e9) < 60)) { next = t; break; }
      }
      // power only once the lights have been low for a while (half a minute of "low power")
      if (p.lowPower) s.lowSince ??= w.time; else s.lowSince = undefined;
      if (s.lowSince !== undefined && w.time - s.lowSince > 30) next = p.canBuild('powr') ? 'powr' : p.canBuild('apwr') ? 'apwr' : next;
      if (next && p.credits >= BUILDINGS[next].cost) w.issue({ c: 'build', player: 0, type: next });
    }
  }
  // factories: one unit at a time, from the mix in turn; a truck if the last one is lost
  const pick = (mix: string[] | undefined, key: string) => {
    const opts = (mix ?? []).filter((t) => p.canBuild(t));
    if (!opts.length) return null;
    s[key] = ((s[key] ?? -1) + 1) % opts.length;
    return opts[s[key]];
  };
  const harvs = units.filter((u) => u.ut.harvester).length;
  if (!harvs && p.has('proc') && p.canBuild('harv') && !p.queues.vehicle.items.length && p.credits >= UNITS.harv.cost) { w.issue({ c: 'build', player: 0, type: 'harv' }); return; }
  // (a few clicks on the unit button each look: up to three queued; the money runs out before the queue does). The short
  // build order comes first: the briefing and the objectives ask for those structures.
  const count = (t: string) => w.buildings.filter((b) => b.alive && b.owner === p && b.bt.id === t).length;
  const seenN: Record<string, number> = {};
  const pending = p.has('fact') ? spec.order.find((t) => { seenN[t] = (seenN[t] ?? 0) + 1; return count(t) < seenN[t] && p.canBuild(t); }) : undefined;
  const keep = pending ? BUILDINGS[pending].cost : 0;
  // (the factories take turns at the money: tanks get built too, not just whatever button was clicked first)
  const kinds = ([['infantry', spec.inf, 'ni'], ['vehicle', spec.veh, 'nv'], ['aircraft', spec.air, 'na'], ['naval', spec.naval, 'nn']] as const)
    .filter(([, mix]) => (mix ?? []).some((t: string) => p.canBuild(t)));
  s.rot = ((s.rot ?? -1) + 1) % Math.max(1, kinds.length);
  let spend = p.credits - keep;
  // (the Field Manual: "attack defences with tanks" puts the war factory first, and the infantry only gets what a tank
  // leaves; "keep units queued" / "loop a unit card" keeps longer queues)
  const tanks = learnt(s, 'alerts.infantryDefence', 'alerts.infantryDefenceFactory') && kinds.some(([kind]) => kind === 'vehicle');
  const depth = learnt(s, 'alerts.idle', 'alerts.bankLoop', 'alerts.bankFactory') ? 5 : 3;
  const tankCost = tanks ? Math.min(...spec.veh.filter((t) => p.canBuild(t)).map((t) => UNITS[t].cost)) : 0;
  for (let k = 0; k < kinds.length; k++) {
    const [kind, mix, key] = tanks ? kinds[k === 0 ? kinds.findIndex(([x]) => x === 'vehicle') : (kinds.findIndex(([x]) => x === 'vehicle') + k) % kinds.length] : kinds[(s.rot + k) % kinds.length];
    const q = p.queues[kind];
    for (let n = q.items.length; n < depth; n++) {
      const t = pick(mix as string[] | undefined, key);
      if (!t || spend < UNITS[t].cost + (tanks && kind === 'infantry' && !p.queues.vehicle.items.length ? tankCost : 0)) break;
      w.issue({ c: 'build', player: 0, type: t });
      spend -= UNITS[t].cost;
    }
  }
}

/** A casual player's base: the shared build manager (power planned, two trucks a refinery, factories busy). */
function casualBase(w: World, s: Record<string, any>, spec: BaseSpec) {
  if (!s.placer) keepEconomy(w, () => { s.placer = new AIController(w, w.players[0], 'normal'); });
  builder(w, s, spec.order, spec.inf, spec.veh, spec.air ?? []);
  const p = w.players[0];
  if (spec.naval?.length && every(w, s, 'naval', 3) && !p.queues.naval.items.length) {
    const opts = spec.naval.filter((t) => p.canBuild(t));
    if (opts.length && p.credits > 1200) w.issue({ c: 'build', player: 0, type: opts[w.rng.int(0, opts.length - 1)] });
  }
}

// =====================================================================================================
// Army
// =====================================================================================================
/** Answer enemies near the base: the newcomer after ten seconds, the casual player at once. Returns true while busy. */
function guardHome(w: World, rt: MissionRuntime, s: Record<string, any>, skill: Skill, units = troops(w)): boolean {
  const home = homeOf(w, rt);
  const mineB = w.buildings.filter((b) => b.alive && b.owner.id === 0 && !b.bt.wall);
  const near = enemyUnits(w).filter((e) => e.kind !== 'aircraft' && (Math.hypot(e.x - home.x, e.y - home.y) < 14 || mineB.some((b) => b.distTo(e.x, e.y) < 6)));
  if (!near.length) { s.raidSince = undefined; return false; }
  s.raidSince ??= w.time;
  if (skill === 'newcomer' && w.time - s.raidSince < 10) return false;
  const t = nearestTo(near, home.x, home.y)!;
  const who = skill === 'newcomer' ? units.filter((u) => u.order.type === 'idle' || Math.hypot(u.x - home.x, u.y - home.y) < 20) : units.filter((u) => Math.hypot(u.x - t.x, u.y - t.y) < 30);
  attackMove(w, who, t.x, t.y);
  return true;
}

/** Newcomer: every 45 s, with a handful of units (or after three quiet minutes), everything attack-moves at the target. */
function newbiePush(w: World, rt: MissionRuntime, s: Record<string, any>, target: Target, units = troops(w), minWave = 6) {
  if (!target || !units.length) return;
  s.lastPush ??= 0;
  const since = w.time - s.lastPush;
  // (the Field Manual's "attack together": gather a bigger army at home, then attack-move with everyone at once)
  const together = learnt(s, 'alerts.together');
  if (s.leading && units.filter((u) => u.kind === 'vehicle').length < 2) s.leading = false;
  const go = together
    ? (units.length >= Math.max(12, minWave * 2) && since >= 45) || (since >= 240 && units.length >= minWave)
    : (units.length >= minWave && since >= 45) || (since >= 180 && units.length >= 2);
  // (the Field Manual's "attack defences with tanks and keep the soldiers behind them": the tanks lead, the infantry
  // follows a few cells behind them)
  const lead = learnt(s, 'alerts.infantryDefence', 'alerts.infantryDefenceFactory');
  const tanks = units.filter((u) => u.kind === 'vehicle'), inf = units.filter((u) => u.kind !== 'vehicle');
  const trail = () => {
    const c = cen(tanks), h = homeOf(w, rt);
    const d = Math.hypot(h.x - c.x, h.y - c.y) || 1;
    return [c.x + (h.x - c.x) / d * 5, c.y + (h.y - c.y) / d * 5] as Pt;
  };
  if (go) {
    const [x, y] = pt(target);
    const who = lead && tanks.length >= 2 ? tanks : units;
    // (Boot Camp, the loading tips and the Field Manual's key tip all teach the attack-move: the newcomer who reads them
    // sends armies with it; the earlier stand-in, FM=0, right-clicked the objective and walked past its guns)
    if (!Array.isArray(target) && target.kind === 'building' && process.env.FM === '0' && !together && !learnt(s, 'alerts.attackMove')) attack(w, who, target);
    else attackMove(w, who, x, y);
    if (who !== units) { const [bx, by] = trail(); attackMove(w, inf, bx, by); s.leading = true; }
    s.lastPush = w.time;
  } else if (s.leading && tanks.length >= 2) {
    const [bx, by] = trail();
    attackMove(w, inf.filter((u) => Math.hypot(u.x - bx, u.y - by) > 3), bx, by);
  } else if (together && every(w, s, 'muster', 12)) {
    // (the army gathers at home while it grows: idle units out in the field come back)
    const h = homeOf(w, rt);
    const far = units.filter((u) => u.order.type === 'idle' && Math.hypot(u.x - h.x, u.y - h.y) > 12);
    if (far.length) attackMove(w, far, h.x, h.y);
  }
}

/** Default objective: the nearest enemy structure to home (then the nearest enemy unit). */
function nearestEnemy(w: World, rt: MissionRuntime): Target {
  const h = homeOf(w, rt);
  return nearestTo(enemyStructures(w), h.x, h.y) ?? nearestTo(enemyUnits(w).filter((u) => u.kind !== 'aircraft'), h.x, h.y);
}

/** Defend a point: idle units go back to it, threats around it are attacked. */
function holdPoint(w: World, s: Record<string, any>, at: Pt, skill: Skill, units = troops(w), r = 16) {
  const threats = enemyUnits(w).filter((e) => e.kind !== 'aircraft' && Math.hypot(e.x - at[0], e.y - at[1]) < r);
  if (threats.length) {
    s.holdSince ??= w.time;
    if (skill === 'newcomer' && w.time - s.holdSince < 6) return;
    const t = nearestTo(threats, at[0], at[1])!;
    attackMove(w, skill === 'newcomer' ? units.filter((u) => u.order.type === 'idle' || u.order.type === 'guard') : units, t.x, t.y);
    return;
  }
  s.holdSince = undefined;
  const far = units.filter((u) => u.order.type === 'idle' && Math.hypot(u.x - at[0], u.y - at[1]) > 7);
  if (far.length) attackMove(w, far, at[0], at[1]);
}

// =====================================================================================================
// Missions
// =====================================================================================================
const ALLIED_MIX = { inf: ['e1', 'e3'], veh: ['2tnk', '1tnk'] };
const SOVIET_MIX = { inf: ['e1', 'e2'], veh: ['3tnk'] };

interface MissionPlan {
  /** What to build (newcomer: the first `newbieOrder` entries of `order`). */
  base?: BaseSpec | ((w: World, rt: MissionRuntime) => BaseSpec);
  newbieOrder?: number;
  /** The objective to attack-move at (default: the nearest enemy structure). */
  target?: (w: World, rt: MissionRuntime) => Target;
  /** Casual: the army value to gather before a wave. */
  wave?: number;
  /** The HUD countdown (timer key) that loses the mission when it runs out (the casual player attacks sooner). */
  deadline?: string | ((w: World, rt: MissionRuntime) => string | null);
  /** Mission actions; return true to take over the army for this tick. */
  act?: (w: World, rt: MissionRuntime, s: Record<string, any>, skill: Skill, log: (t: string) => void) => boolean;
}

const PLANS: Record<string, MissionPlan> = {};

// ---- Allied ----------------------------------------------------------------------------------------
PLANS['allied-01'] = {
  // (the tips: riflemen for infantry, rockets for the tanks; the outpost and its raids are mostly infantry)
  base: { order: ['powr', 'tent', 'proc', 'powr', 'pbox', 'proc', 'pbox', 'powr'], inf: ['e1', 'e1', 'e3'], veh: [] },
  newbieOrder: 4,
  wave: 4500, // (the starting squad waits for the rest: "when you are strong enough")
  act: (w, rt, s, skill) => {
    // the casual player answers Brandt's call: the vehicles and whoever is near go for the supply column
    const trucks = rt.livingUnits(rt.flags.trucks);
    if (skill !== 'casual' || !trucks.length || rt.state('convoy') !== 'active') return false;
    if (every(w, s, 'convoy', 3)) {
      const who = troops(w).filter((u) => u.kind === 'vehicle' || Math.hypot(u.x - trucks[0].x, u.y - trucks[0].y) < 25);
      const c = cen(who);
      attack(w, who, nearestTo(trucks, c.x, c.y)!);
    }
    return true;
  },
};
PLANS['allied-02'] = {
  base: { order: ['gun', 'gun', 'powr', 'pbox', 'gun', 'proc'], inf: ['e1', 'e3'], veh: ['1tnk'] },
  newbieOrder: 0,
  act: (w, rt, s, skill) => {
    const yard = flagEnt<Building>(w, rt.flags.yard);
    const st = rt.start(0), e = rt.start(1);
    const at: Pt = yard ? rt.between(st, e, 0.12, -3) : [st.x, st.y];
    holdPoint(w, s, at, skill, troops(w), 22);
    return true;
  },
};
PLANS['allied-03'] = {
  act: (w, rt, s, skill) => {
    const k = flagEnt<Unit>(w, rt.flags.kestrel);
    if (!k) return true;
    const team = troops(w).filter((u) => u !== k);
    const engs = rt.livingUnits(rt.flags.engineers);
    const others = mine(w).filter((u) => u !== k && !engs.includes(u) && !team.includes(u));
    const follow = (who: Unit[], dist = 2.5) => {
      // the casual player keeps the engineers and the medic back at the staging point while Kestrel works (the tips)
      if (skill === 'casual' && s.stage) {
        const lag = who.filter((u) => Math.hypot(u.x - s.stage[0], u.y - s.stage[1]) > 2 && u.order.type !== 'enter');
        if (lag.length) moveTo(w, lag, s.stage[0], s.stage[1]);
        return;
      }
      const st = rt.start(0);
      const back = Math.atan2(st.y - k.y, st.x - k.x);
      const fx = k.x + Math.cos(back) * dist, fy = k.y + Math.sin(back) * dist;
      const lag = who.filter((u) => Math.hypot(u.x - fx, u.y - fy) > 2 && u.order.type !== 'enter');
      if (lag.length) moveTo(w, lag, fx, fy);
    };
    const plants = rt.living(rt.flags.plants) as Building[];
    const techs = rt.livingUnits(rt.flags.techs);
    const gen = flagEnt<Building>(w, rt.flags.generator);
    const lab = flagEnt<Building>(w, rt.flags.lab);
    const lz = rt.flags.lz as Pt | undefined;
    const near = enemyUnits(w).filter((u) => u.kind === 'infantry' && Math.hypot(u.x - k.x, u.y - k.y) < 6.5);
    const fts = w.buildings.filter((b) => b.alive && b.owner.id === 1 && b.bt.id === 'ftur');
    const safe = (x: number, y: number) => skill === 'newcomer' || fts.every((f) => f.distTo(x, y) > 5.2);
    const busy = k.order.type === 'enter' || k.c4Timer > 0 || (k.order.type === 'attack' && !!w.getEntity((k.order as { target: number }).target)?.alive);
    if (lz && lab?.owner.id === 0) {
      moveTo(w, [k, ...team, ...others], lz[0], lz[1]);
      return true;
    }
    if (plants.length) {
      if (skill === 'casual') {
        // the tips: go around the flame towers, keep the engineers behind, deal with the guards first
        s.ps ??= cen(plants);
        const st = rt.start(0);
        const route: Pt[] = [ground(rt, st.x, s.ps.y + 2), ground(rt, s.ps.x - 9, s.ps.y + 1)];
        s.wp ??= 0;
        s.stage ??= route[1];
        if (s.wp < route.length) {
          const wp = route[s.wp];
          if (Math.hypot(k.x - wp[0], k.y - wp[1]) < 2.5 || (k.order.type === 'idle' && Math.hypot(k.x - wp[0], k.y - wp[1]) < 5)) s.wp++;
          else if (near.length && safe(near[0].x, near[0].y)) attack(w, [k], near[0]);
          else attackMove(w, [k], wp[0], wp[1]);
          follow([...team, ...others, ...engs]);
          return true;
        }
        if (near.length && safe(near[0].x, near[0].y)) { attack(w, [k], near[0]); follow([...team, ...others, ...engs]); return true; }
      }
      // C4: right-click the structure once she is next to it (the newcomer attack-moves her there first)
      const plant = nearestTo(plants, k.x, k.y)!;
      if (!busy) { if (skill === 'casual' || plant.distTo(k.x, k.y) < 4) attack(w, [k], plant); else attackMove(w, [k], plant.x, plant.y); }
      follow([...team, ...others, ...engs]);
      return true;
    }
    if (gen) { if (!busy) { if (skill === 'casual' || gen.distTo(k.x, k.y) < 4) attack(w, [k], gen); else attackMove(w, [k], gen.x, gen.y); } follow([...team, ...others, ...engs]); return true; }
    if (techs.length) {
      const t = nearestTo(techs, k.x, k.y)!;
      if (skill === 'casual' && near.length && !near.some((u) => techs.includes(u))) attack(w, [k], near[0]);
      else attack(w, [k], t);
      follow([...team, ...others, ...engs]);
      return true;
    }
    if (lab && lab.owner.id !== 0) {
      const guards = enemyUnits(w).filter((u) => Math.hypot(u.x - lab.x, u.y - lab.y) < 8 && safe(u.x, u.y));
      if (near.length && safe(near[0].x, near[0].y)) attack(w, [k], near[0]);
      else if (guards.length) attackMove(w, [k], guards[0].x, guards[0].y);
      else attackMove(w, [k], lab.x - 2, lab.y + 2);
      // the newcomer sends the engineer straight in; the casual player once the guards are down
      if (engs.length && (skill === 'newcomer' || !guards.length) && engs[0].order.type !== 'enter') attack(w, [engs[0]], lab);
      follow(others);
      return true;
    }
    return true;
  },
};
PLANS['allied-04'] = {
  act: (w, rt, s, skill) => {
    const team = rt.livingUnits(rt.flags.team);
    const apcs = rt.livingUnits(rt.flags.apcs);
    const lz = rt.flags.lz as Pt;
    const esc = troops(w).filter((u) => !u.ut.passengers && !team.includes(u));
    if (!s.boarded) {
      team.forEach((u, i) => {
        if (u.transport || u.order.type === 'enter') return;
        const apc = apcs[i === 0 ? 0 : Math.min(1, apcs.length - 1)] ?? apcs[0];
        if (apc) w.issue({ c: 'enter', player: 0, units: [u.id], target: apc.id });
      });
      if (team.every((u) => u.transport) || w.time > 60) s.boarded = true;
      guardHome(w, rt, s, skill, esc);
      return true;
    }
    if (skill === 'newcomer') {
      // everything heads for the harbour (the APCs drive, the army attack-moves)
      if (every(w, s, 'go', 12)) { attackMove(w, esc, lz[0], lz[1]); moveTo(w, apcs, lz[0], lz[1]); moveTo(w, team.filter((u) => !u.transport), lz[0], lz[1]); }
      return true;
    }
    // casual: the army leads, the APCs follow behind it
    const veh = esc.filter((u) => u.kind === 'vehicle');
    const lead = veh.length ? cen(veh) : esc.length ? cen(esc) : cen(apcs);
    const toLz = Math.hypot(lz[0] - lead.x, lz[1] - lead.y);
    const threats = enemyThings(w).filter((t) => Math.hypot(t.x - lead.x, t.y - lead.y) < 9 && (t.kind !== 'building' || (t as Building).weapons.length));
    if (threats.length && esc.length) {
      const t = nearestTo(threats, lead.x, lead.y)!;
      attackMove(w, esc, t.x, t.y);
      if (rt.flags.betrayed) moveTo(w, apcs, lz[0], lz[1]);
      else {
        // shooting ahead: the APCs pull up behind the escort instead of driving into it
        const back = rt.toward(lead, rt.start(0), 5);
        const close = apcs.filter((a) => Math.hypot(a.x - t.x, a.y - t.y) < 9 || a.order.type === 'move');
        if (close.length) moveTo(w, close, back[0], back[1]);
      }
    } else {
      const step = Math.min(8, toLz);
      attackMove(w, esc, lead.x + ((lz[0] - lead.x) / (toLz || 1)) * step, lead.y + ((lz[1] - lead.y) / (toLz || 1)) * step);
      if (toLz < 7 || !esc.length) moveTo(w, apcs, lz[0], lz[1]);
      else moveTo(w, apcs, lead.x, lead.y);
    }
    moveTo(w, team.filter((u) => !u.transport), lz[0], lz[1]);
    return true;
  },
};
PLANS['allied-05'] = {
  base: { order: ['powr', 'proc', 'weap', 'tent', 'powr', 'proc', 'hpad', 'hpad', 'dome', 'powr'], inf: ['e3'], veh: ['2tnk', '2tnk', '1tnk'], air: ['heli'] },
  newbieOrder: 4,
  target: (w, rt) => {
    const h = homeOf(w, rt);
    return nearestTo(w.units.filter((u) => u.alive && u.owner.id === 1 && u.ut.harvester), h.x, h.y) ?? (rt.flags.camp as Pt);
  },
  wave: 4000,
  deadline: 'reserve',
  act: (w, rt, s, skill) => {
    if (skill !== 'casual') return false;
    // the tips: Longbows hunt the trucks, away from the SAM sites
    const helis = mine(w).filter((u) => u.kind === 'aircraft' && u.weapons.length);
    if (helis.length && every(w, s, 'heli', 4)) {
      const sams = w.buildings.filter((b) => b.alive && b.owner.id === 1 && b.bt.id === 'sam');
      const open = w.units.filter((u) => u.alive && u.owner.id === 1 && u.ut.harvester && sams.every((b) => b.distTo(u.x, u.y) > 9));
      for (const h of helis) {
        if (h.order.type === 'attack' && w.getEntity((h.order as { target: number }).target)?.alive) continue;
        const t = nearestTo(open, h.x, h.y);
        if (t && h.ammo >= (h.ut.ammo ?? 1)) attack(w, [h], t); // (full racks: a player sends them out after they rearm)
      }
    }
    return false;
  },
};
PLANS['allied-06'] = {
  base: { order: ['powr', 'tent', 'proc', 'weap', 'powr', 'proc', 'dome', 'powr', 'weap', 'fix'], ...ALLIED_MIX, veh: ['2tnk', '2tnk', 'arty'] },
  newbieOrder: 5,
  // the newcomer goes for the silo; the casual player follows the tips: the generator yard, then the silo
  target: (w, rt) => flagEnt(w, rt.flags.silo),
  wave: 7000,
  deadline: 'launch',
  act: (w, rt, s, skill) => {
    if (skill !== 'casual') return false;
    const silo = flagEnt<Building>(w, rt.flags.silo);
    const yard = rt.living(rt.flags.yard) as Building[];
    s.casualTarget = silo && (w.players[1].lowPower || !yard.length) ? silo : nearestTo(yard, rt.start(0).x, rt.start(0).y) ?? silo;
    const k = flagEnt<Unit>(w, rt.flags.kestrel);
    if (k && silo && w.players[1].lowPower && k.c4Timer <= 0 && k.order.type !== 'enter' && every(w, s, 'kes', 6)) attack(w, [k], silo);
    return false;
  },
};
PLANS['allied-07'] = {
  base: { order: ['proc', 'weap', 'apwr'], ...ALLIED_MIX, veh: ['2tnk', '2tnk', 'arty'] },
  newbieOrder: 0,
  wave: 9000,
  deadline: 'silo',
  act: (w, rt, s, skill) => {
    if (skill === 'casual') {
      const silo = flagEnt(w, rt.flags.silo);
      s.casualTarget = silo ?? null;
    }
    return false;
  },
};

// ---- Soviet ----------------------------------------------------------------------------------------
PLANS['soviet-01'] = {
  target: (w, rt) => flagEnt(w, rt.flags.dome) ?? nearestEnemy(w, rt),
  act: (w, rt, s, skill) => {
    if (skill === 'newcomer') return false;
    // casual: the V2 stays behind the tanks, everyone goes for the dome, then the rest
    const v2 = flagEnt<Unit>(w, rt.flags.v2);
    const t = flagEnt<Building>(w, rt.flags.dome) ?? nearestEnemy(w, rt);
    if (!t) return true;
    const front = troops(w).filter((u) => u !== v2);
    const [x, y] = pt(t);
    if (every(w, s, 'go', 6)) attackMove(w, front, x, y);
    if (v2) {
      const c = front.length ? cen(front) : { x: v2.x, y: v2.y };
      const back = rt.toward(c, rt.start(0), 3);
      if (Math.hypot(v2.x - back[0], v2.y - back[1]) > 3) attackMove(w, [v2], back[0], back[1]);
    }
    return true;
  },
};
PLANS['soviet-02'] = {
  // (the tips: riflemen and grenadiers; flamethrowers burn their own side in a crowd, measured 0/8 with them in the mix)
  base: { order: ['powr', 'barr', 'proc', 'powr', 'ftur', 'proc', 'ftur', 'powr'], inf: ['e1', 'e1', 'e2', 'e2'], veh: [] },
  newbieOrder: 4,
  wave: 2800,
};
PLANS['soviet-03'] = {
  act: (w, rt, s, skill) => {
    const station = flagEnt<Building>(w, rt.flags.station);
    const engs = rt.livingUnits(rt.flags.engineers);
    const fighters = troops(w).filter((u) => !u.ut.engineer);
    if (rt.state('camp') === 'active') {
      const t = nearestEnemy(w, rt);
      if (t && every(w, s, 'camp', skill === 'newcomer' ? 30 : 10)) attackMove(w, troops(w), ...pt(t));
      return true;
    }
    if (!station) return true;
    if (station.owner.id !== 0) {
      const guards = enemyUnits(w).filter((u) => Math.hypot(u.x - station.x, u.y - station.y) < 11);
      if (skill === 'newcomer') {
        if (every(w, s, 'go', 6)) attackMove(w, fighters, station.x, station.y);
        if (engs.length && engs[0].order.type !== 'enter') attack(w, [engs[0]], station);
        return true;
      }
      // casual, as the tips say: dogs and riflemen go in, flamers and grenadiers stay out of the melee, the engineer waits
      const hold = rt.toward(station, rt.start(0), 10);
      const splash = fighters.filter((u) => u.ut.id === 'e4' || u.ut.id === 'e2');
      const front = fighters.filter((u) => !splash.includes(u));
      if (guards.length && fighters.length) {
        attackMove(w, front.length ? front : splash, guards[0].x, guards[0].y);
        if (front.length) { const lag = splash.filter((u) => Math.hypot(u.x - hold[0], u.y - hold[1]) > 3); if (lag.length) moveTo(w, lag, hold[0], hold[1]); }
        const lagE = engs.filter((u) => Math.hypot(u.x - hold[0], u.y - hold[1]) > 2);
        if (lagE.length) moveTo(w, lagE, hold[0], hold[1]);
      } else if (engs.length && engs[0].order.type !== 'enter') attack(w, [engs[0]], station);
      return true;
    }
    // hold the station (the casual player keeps it repaired, as Belinsky asks)
    if (skill === 'casual' && station.hp < station.maxHp * 0.9 && !station.repairing && every(w, s, 'rep', 5)) w.issue({ c: 'repair', player: 0, building: station.id });
    holdPoint(w, s, [station.x, station.y], skill, troops(w), 14);
    return true;
  },
};
PLANS['soviet-04'] = {
  base: { order: ['powr', 'barr', 'proc', 'weap', 'powr', 'proc', 'ftur', 'dome', 'powr', 'fix'], ...SOVIET_MIX, veh: ['3tnk', '3tnk', 'v2rl'] },
  newbieOrder: 5,
  wave: 5000,
  act: (w, rt, s, skill) => {
    if (w.players[0].has('fact') || rt.isDone('deploy')) return false;
    const mcv = flagEnt<Unit>(w, rt.flags.mcv);
    const oasis = rt.flags.oasis as Pt;
    s.mcvHold = true;
    if (!mcv) return true;
    const esc = troops(w);
    if (Math.hypot(mcv.x - oasis[0], mcv.y - oasis[1]) < 3.5) {
      if (w.canDeploy(mcv)) w.issue({ c: 'deploy', player: 0, units: [mcv.id] });
      else moveTo(w, [mcv], mcv.x + (w.rng.next() - 0.5) * 3, mcv.y + (w.rng.next() - 0.5) * 3);
      return true;
    }
    if (skill === 'newcomer') {
      if (every(w, s, 'go', 12)) { attackMove(w, esc, oasis[0], oasis[1]); moveTo(w, [mcv], oasis[0], oasis[1]); }
      return true;
    }
    // casual: the escort leads, the MCV follows behind it
    const lead = esc.length ? cen(esc) : { x: mcv.x, y: mcv.y };
    const d = Math.hypot(oasis[0] - lead.x, oasis[1] - lead.y);
    const threats = enemyUnits(w).filter((u) => Math.hypot(u.x - lead.x, u.y - lead.y) < 9);
    if (threats.length) attackMove(w, esc, threats[0].x, threats[0].y);
    else attackMove(w, esc, ...rt.toward(lead, { x: oasis[0], y: oasis[1] }, Math.min(7, d)));
    if (d < 6 || !esc.length) moveTo(w, [mcv], oasis[0], oasis[1]);
    else if (!threats.length) moveTo(w, [mcv], lead.x, lead.y);
    return true;
  },
};
PLANS['soviet-05'] = {
  base: { order: ['powr', 'barr', 'proc', 'weap', 'powr', 'proc', 'tsla', 'powr', 'dome', 'fix'], ...SOVIET_MIX },
  newbieOrder: 5,
  wave: 6000,
  target: (w, rt) => (rt.isDone('capture') ? null : flagEnt(w, rt.flags.pdox)),
  act: (w, rt, s, skill) => {
    const pd = flagEnt<Building>(w, rt.flags.pdox);
    if (!pd) return false;
    const engs = mine(w).filter((u) => u.ut.engineer);
    if (pd.owner.id === 0) { holdPoint(w, s, [pd.x, pd.y], skill, troops(w).filter((u) => !u.ut.engineer), 16); return true; }
    // the newcomer sends the engineers in with the army; the casual player once the housing is critical
    const critical = pd.healthFrac <= 0.25;
    if (engs.length && (skill === 'newcomer' ? (s.lastPush ?? 0) > 0 : critical) && every(w, s, 'eng', 6)) attack(w, engs.filter((e) => e.order.type !== 'enter'), pd);
    if (skill === 'casual' && !critical) s.casualTarget = pd;
    // (the objective names an engineer: with none left, both train one; the casual player keeps two)
    const p0 = w.players[0], want = skill === 'newcomer' ? 1 : 2;
    const queued = p0.queues.infantry.items.filter((i) => i.type === 'e6').length;
    if (engs.length + queued < want && p0.canBuild('e6') && (skill === 'casual' || !p0.queues.infantry.items.length)) w.issue({ c: 'build', player: 0, type: 'e6' });
    return false;
  },
};
PLANS['soviet-06'] = {
  base: { order: ['powr', 'tsla', 'ftur', 'powr', 'tsla'], ...SOVIET_MIX, veh: ['3tnk', '3tnk', 'v2rl'] },
  newbieOrder: 0,
  wave: 6000,
  act: (w, rt, s, skill) => {
    if (rt.flags.coup && rt.state('nkvd') === 'active') {
      s.casualTarget = nearestTo(enemyStructures(w).filter((b) => b.owner.id === 2), homeOf(w, rt).x, homeOf(w, rt).y);
      if (skill === 'newcomer') { newbiePush(w, rt, s, s.casualTarget, troops(w), 8); guardHome(w, rt, s, skill); return true; }
      return false;
    }
    const iron = flagEnt<Building>(w, rt.flags.iron);
    holdPoint(w, s, iron ? [iron.x, iron.y] : [rt.start(0).x, rt.start(0).y], skill, troops(w), 22);
    return true;
  },
};
PLANS['soviet-07'] = {
  base: { order: ['proc', 'apwr', 'weap', 'tsla', 'apwr'], ...SOVIET_MIX, veh: ['3tnk', '3tnk', '4tnk', 'v2rl'] },
  newbieOrder: 0,
  wave: 9000,
  deadline: 'overload',
  target: (w, rt) => (rt.state('chrono') === 'active' ? flagEnt(w, rt.flags.pdox) : nearestEnemy(w, rt)),
  act: (w, rt, s) => {
    s.casualTarget = rt.state('chrono') === 'active' ? flagEnt(w, rt.flags.pdox) : null;
    return false;
  },
};

// ---- Special operations ------------------------------------------------------------------------------
PLANS['wolfpack'] = {
  base: { order: [], inf: [], veh: [] }, // (the boats are built below)
  act: (w, rt, s, skill) => {
    const p = w.players[0];
    const subs = mine(w).filter((u) => u.ut.id === 'ss');
    const transports = w.units.filter((u) => u.alive && u.owner.id === 1 && u.ut.id === 'lst');
    if (skill === 'newcomer') {
      // attack-move the boats at the latest convoy beacon (where the group enters), every 30 s
      if (every(w, s, 'go', 30)) {
        const lx = rt.flags.laneX ?? rt.flags.midX, ly = rt.flags.laneY ?? rt.flags.midY;
        const t = nearestTo(transports, lx, ly);
        if (t) attack(w, subs, t); else attackMove(w, subs, lx, ly);
      }
    } else if (every(w, s, 'hunt', 3)) {
      for (const sub of subs) {
        if (sub.order.type === 'attack' && w.getEntity((sub.order as { target: number }).target)?.alive) continue;
        const t = nearestTo(transports, sub.x, sub.y);
        if (t && Math.hypot(t.x - sub.x, t.y - sub.y) < 12) attack(w, [sub], t);
        else {
          const lx = rt.flags.laneX ?? rt.flags.midX, ly = rt.flags.laneY ?? rt.flags.midY;
          if (Math.hypot(sub.x - lx, sub.y - ly) > 4) moveTo(w, [sub], lx, ly);
        }
      }
    }
    if (every(w, s, 'boats', skill === 'newcomer' ? 6 : 3) && p.canBuild('ss') && !p.queues.naval.items.length && p.credits >= UNITS.ss.cost) w.issue({ c: 'build', player: 0, type: 'ss' });
    return true;
  },
};
PLANS['ironcoast'] = {
  base: { order: [], inf: [], veh: [] }, // (the boats are built below)
  act: (w, rt, s, skill) => {
    const p = w.players[0], foe = w.players[1];
    const ships = mine(w).filter((u) => u.kind === 'naval');
    const target = ['pen', 'afld', 'fact'].map((k) => flagEnt(w, rt.flags[k])).find((e) => !!e) ?? nearestEnemy(w, rt);
    if (!target) return true;
    if (skill === 'newcomer') {
      if (every(w, s, 'go', 30)) attack(w, ships, target as Entity);
    } else if (every(w, s, 'fleet', 3)) {
      const cruisers = ships.filter((u) => u.ut.id === 'ca');
      const escorts = ships.filter((u) => u.ut.id !== 'ca');
      for (const ca of cruisers) if (ca.order.type !== 'attack') attack(w, [ca], target as Entity);
      const lead = cruisers[0] ?? null;
      const threats = w.units.filter((u) => u.alive && u.owner === foe && (u.ut.id === 'ss' || u.kind === 'aircraft') && w.canSee(p, u));
      for (const e of escorts) {
        const t = nearestTo(threats, e.x, e.y);
        if (t && Math.hypot(t.x - e.x, t.y - e.y) < 12) { if (e.order.type !== 'attack') attack(w, [e], t); }
        else if (lead && Math.hypot(e.x - lead.x, e.y - lead.y) > 4) attackMove(w, [e], lead.x + (e.id % 3) - 1, lead.y + ((e.id >> 1) % 3) - 1);
      }
    }
    if (every(w, s, 'boats', skill === 'newcomer' ? 6 : 3) && !p.queues.naval.items.length) {
      const cr = ships.filter((u) => u.ut.id === 'ca').length;
      const want = skill === 'newcomer' ? (p.canBuild('dd') ? 'dd' : null) : cr < 1 && p.canBuild('ca') ? 'ca' : p.canBuild('dd') ? 'dd' : null;
      if (want && p.credits >= UNITS[want].cost) w.issue({ c: 'build', player: 0, type: want });
    }
    return true;
  },
};
// Boot Camp: the drills say what to do, step by step (the Sergeant Major's radio and the objective line): walk to the
// beacon, shoot the scouts, then the base drills, the raid and the assault (the earlier stand-in skipped the first two
// and marched on the camp with five riflemen)
PLANS['bootcamp'] = {
  base: { order: ['powr', 'proc', 'tent', 'pbox', 'weap', 'powr'], inf: ['e1', 'e1', 'e3'], veh: ['1tnk', '2tnk'] },
  newbieOrder: 6,
  target: (w, rt) => (rt.flags.step === 'assault' ? nearestEnemy(w, rt) : null),
  act: (w, rt, s, skill) => {
    const step = rt.flags.step as string;
    const units = troops(w);
    if (step === 'move') { if (every(w, s, 'drill', skill === 'newcomer' ? 6 : 3)) moveTo(w, units, rt.flags.bx, rt.flags.by); return true; }
    if (step === 'fight') {
      const scouts = rt.livingUnits(rt.flags.scouts);
      if (scouts.length) { const c = cen(scouts); attackMove(w, units, c.x, c.y); }
      return true;
    }
    if (step === 'defend') { guardHome(w, rt, s, skill); return true; }
    return step !== 'assault' && step !== 'done';
  },
};

/** Conquest battles: whatever the objective names (destroy the base, capture the post, hold the zone, defend the HQ). */
PLANS['conquest'] = {
  wave: 4500,
  // a sea battle needs a shipyard and a fleet (the objectives name them)
  base: (w, rt) => {
    const sov = w.players[0].faction === 'soviet';
    const sea = objActive(rt, 'fleet') || objActive(rt, 'yards');
    const b = defaultBase(w);
    if (!sea) return b;
    return sov
      ? { order: ['powr', 'proc', 'spen', 'barr', 'powr', 'spen', 'proc', 'powr'], inf: ['e1'], veh: [], naval: ['ss'] }
      : { order: ['powr', 'proc', 'syrd', 'tent', 'powr', 'proc', 'dome', 'atek', 'powr'], inf: ['e1'], veh: [], naval: ['dd', 'dd', 'ca'] };
  },
  newbieOrder: 4,
  target: (w, rt) => {
    if (objActive(rt, 'capture')) return flagEnt(w, rt.flags.target);
    if (objActive(rt, 'hold')) return rt.flags.zone as Pt;
    if (objActive(rt, 'yards')) return nearestTo(enemyStructures(w).filter((b) => b.bt.water), homeOf(w, rt).x, homeOf(w, rt).y);
    if (objActive(rt, 'command')) return nearestTo(enemyStructures(w).filter((b) => b.bt.id === 'fact'), homeOf(w, rt).x, homeOf(w, rt).y) ?? nearestEnemy(w, rt);
    return nearestEnemy(w, rt);
  },
  act: (w, rt, s, skill) => {
    if (objActive(rt, 'hq') || objActive(rt, 'holdout')) {
      const hq = flagEnt<Building>(w, rt.flags.hq);
      const h = hq ?? homeOf(w, rt);
      holdPoint(w, s, [h.x, h.y], skill, troops(w).filter((u) => u.kind !== 'naval'), 18);
      return true;
    }
    if (objActive(rt, 'hold')) {
      const z = rt.flags.zone as Pt;
      if (skill === 'newcomer') { if (every(w, s, 'zone', 20)) attackMove(w, troops(w), z[0], z[1]); return true; }
      s.casualTarget = nearestTo(enemyUnits(w).filter((u) => Math.hypot(u.x - z[0], u.y - z[1]) < 8), z[0], z[1]) ?? null;
      holdPoint(w, s, z, skill, troops(w), 9);
      return true;
    }
    if (objActive(rt, 'capture')) {
      // the objective says: damage it, then send in an Engineer
      const t = flagEnt<Building>(w, rt.flags.target);
      if (!t) return false;
      const engs = mine(w).filter((u) => u.ut.engineer);
      // (the casual player walks the engineers up behind the army and sends them in from there; on their own across
      // the map they met the base's guns and the battle stalled with none left: 7 of 24 Easy captures timed out)
      const fighters = troops(w).filter((u) => !u.ut.engineer);
      const front = fighters.length ? cen(fighters) : null;
      const near = skill === 'newcomer' || (front !== null && Math.hypot(front.x - t.x, front.y - t.y) < 14);
      if (t.healthFrac <= 0.25 && engs.length && near && every(w, s, 'eng', skill === 'newcomer' ? 6 : 3)) attack(w, engs.filter((e) => e.order.type !== 'enter'), t);
      else if (skill === 'casual' && front && engs.length && every(w, s, 'engFollow', 5)) {
        const h = homeOf(w, rt), d = Math.hypot(h.x - front.x, h.y - front.y) || 1;
        const bx = front.x + (h.x - front.x) / d * 4, by = front.y + (h.y - front.y) / d * 4;
        moveTo(w, engs.filter((e) => e.order.type !== 'enter' && Math.hypot(e.x - bx, e.y - by) > 3), bx, by);
      }
      const iq = w.players[0].queues.infantry.items;
      if (!engs.length && w.players[0].canBuild('e6') && (skill === 'newcomer' ? !iq.length : !iq.some((i) => i.type === 'e6')) && w.players[0].credits >= UNITS.e6.cost) w.issue({ c: 'build', player: 0, type: 'e6' });
      if (skill === 'casual') {
        // stop hitting it once it is weak enough, and clear the guards instead
        const fighters = troops(w).filter((u) => !u.ut.engineer);
        if (t.healthFrac <= 0.3) { s.casualTarget = nearestTo(enemyUnits(w), t.x, t.y) ?? nearestTo(enemyStructures(w).filter((b) => b !== t), t.x, t.y); for (const u of fighters) if (u.target === t) w.issue({ c: 'stop', player: 0, units: [u.id] }); }
        else s.casualTarget = t;
      }
      return false;
    }
    return false;
  },
};

/** Challenges (src/modes/challenge.ts): hold the zone, destroy the targets, protect your own, or win. */
PLANS['challenge'] = {
  wave: 2500,
  target: (w, rt) => {
    const ch = rt.flags.ch as { targets: number[]; zone: { x: number; y: number } | null } | undefined;
    if (ch?.zone) return [ch.zone.x, ch.zone.y];
    const foe = (ch?.targets ?? []).map((id) => flagEnt(w, id)).filter((e): e is Entity => !!e && w.players[0].isEnemy(e.owner));
    const h = homeOf(w, rt);
    return nearestTo(foe, h.x, h.y) ?? nearestEnemy(w, rt);
  },
  act: (w, rt, s, skill) => {
    const ch = rt.flags.ch as { targets: number[]; zone: { x: number; y: number; r: number } | null } | undefined;
    if (!ch) return false;
    const mineT = ch.targets.map((id) => flagEnt(w, id)).filter((e): e is Entity => !!e && e.owner.id === 0);
    if (ch.zone) { holdPoint(w, s, [ch.zone.x, ch.zone.y], skill, troops(w), ch.zone.r + 6); return true; }
    if (mineT.length) { const c = cen(mineT); holdPoint(w, s, [c.x, c.y], skill, troops(w), 14); return true; }
    return false;
  },
};

/** Survival (solo and co-op): build up and hold the base; the casual player adds the defences the briefing suggests. */
const SURVIVAL_PLAN: MissionPlan = {
  act: (w, rt, s, skill) => {
    const h = homeOf(w, rt);
    holdPoint(w, s, [h.x, h.y], skill, troops(w), 20);
    return true;
  },
};
function survivalBase(w: World): BaseSpec {
  return w.players[0].faction === 'soviet'
    ? { order: ['powr', 'barr', 'proc', 'weap', 'powr', 'ftur', 'proc', 'tsla', 'powr', 'ftur', 'tsla', 'dome', 'apwr', 'sam', 'tsla'], ...SOVIET_MIX, veh: ['3tnk', '3tnk', 'v2rl'] }
    // (the briefings warn of MiGs: an AA gun with the first defences; with it last the casual lost its refineries to the
    // first air raid in the desert and survived fewer waves than the newcomer, 7 against 8)
    : { order: ['powr', 'tent', 'proc', 'weap', 'powr', 'proc', 'gun', 'dome', 'agun', 'pbox', 'gun', 'powr', 'agun', 'apwr', 'gun'], ...ALLIED_MIX, veh: ['2tnk', '2tnk', 'arty'] };
}

// =====================================================================================================
// The pilots
// =====================================================================================================
/** Default base for missions with no plan: build what the faction's basics allow. */
function defaultBase(w: World): BaseSpec {
  const sov = w.players[0].faction === 'soviet';
  return sov
    ? { order: ['powr', 'barr', 'proc', 'weap', 'powr', 'proc', 'ftur', 'powr'], ...SOVIET_MIX }
    : { order: ['powr', 'tent', 'proc', 'weap', 'powr', 'proc', 'gun', 'powr'], ...ALLIED_MIX };
}

export function skillPilot(skill: Skill): Pilot {
  return (w, rt, s, log) => {
    const survival = rt.def.scored && rt.def.id.startsWith('survival');
    const plan = PLANS[rt.def.id] ?? (survival ? { ...SURVIVAL_PLAN, base: survivalBase(w), newbieOrder: 5 } : {});
    const period = skill === 'newcomer' ? 6 : 3;
    if (skill === 'newcomer') fieldManual(w, s, log);
    if (!every(w, s, 'look', period)) return;
    const base = (typeof plan.base === 'function' ? plan.base(w, rt) : plan.base) ?? defaultBase(w);
    const hasBase = w.players[0].has('fact') || mine(w).some((u) => u.ut.deploysInto);
    if (hasBase) {
      if (skill === 'newcomer') newbieBase(w, s, { ...base, order: base.order.slice(0, plan.newbieOrder ?? 4) });
      else casualBase(w, s, base);
    }
    if (plan.act?.(w, rt, s, skill, log)) return;
    if (skill === 'newcomer') {
      if (guardHome(w, rt, s, skill)) return;
      newbiePush(w, rt, s, (plan.target ?? nearestEnemy)(w, rt));
    } else {
      // the first wave waits until the army is well past what the mission handed over ("when you are strong enough")
      // (with no base to build more, what the mission gave is the army: it goes at once)
      s.threshold ??= hasBase ? Math.max(plan.wave ?? 3500, 1.6 * army(w).filter((u) => !u.ut.hero && u.ut.id !== 'e6').reduce((v, u) => v + u.ut.cost, 0)) : 0;
      s.bar0 ??= s.threshold;
      const pick = () => (s.casualTarget && (Array.isArray(s.casualTarget) || s.casualTarget.alive) ? s.casualTarget : (plan.target ?? nearestEnemy)(w, rt));
      // a countdown on the HUD that ends the mission: the casual player goes once half of it has run
      const clock = plan.deadline ? (typeof plan.deadline === 'function' ? plan.deadline(w, rt) : plan.deadline) : null;
      if (clock && rt.timeLeft(clock) !== null) s.clockMax = Math.max(s.clockMax ?? 0, rt.timeLeft(clock)!);
      commander(w, rt, s, log, {
        noBrain: true, threshold: plan.wave ?? 3500,
        // (a player does not wait for an ever larger army after a broken wave: one raise of the bar, and after four
        // quiet minutes the army goes again with half of it)
        maxThreshold: s.bar0 + 2500, patience: 240, waves: true, micro: false, countDefences: true,
        deadline: clock ? () => { const left = rt.timeLeft(clock); return left !== null && left < 0.5 * (s.clockMax ?? left); } : undefined,
        pickTarget: () => { const t = pick(); return t && !Array.isArray(t) ? t : t ? (nearestTo([...enemyStructures(w), ...enemyUnits(w)], t[0], t[1]) ?? null) : null; },
      });
    }
  };
}
