// Autopilots that stand in for a competent human in tools/campaigntest.ts.
// They may use full knowledge of the map; the goal is to prove each mission is winnable and stable.
import { AIController } from '../src/sim/ai';
import { aiPlacement } from '../src/sim/ai-naval';
import { ARMOR_INDEX, BUILDINGS, WARHEADS } from '../src/data/rules';
import { maxRange, pickWeapon } from '../src/sim/combat';
import type { World } from '../src/sim/world';
import type { MissionRuntime } from '../src/sim/mission';
import type { Building, Entity, Unit } from '../src/sim/entities';

export type Pilot = (world: World, rt: MissionRuntime, s: Record<string, any>, log: (t: string) => void) => void;

const T = 20; // ticks per second; pilots are called every 10 ticks

/** Shared building brain for the human (economy + production), created on first use. */
export function brain(world: World, s: Record<string, any>, mode?: 'defensive'): AIController {
  if (!s.brain) {
    const diff = (process.env.BRAIN ?? 'hard') as 'normal' | 'hard' | 'brutal';
    s.brain = new AIController(world, world.players[0], diff);
    if (mode) s.brain.setMode(mode);
    world.ais.push(s.brain);
  }
  return s.brain;
}

export function army(world: World, includeAir = false): Unit[] {
  return world.units.filter((u) => u.alive && u.owner.id === 0 && u.weapons.length && !u.ut.harvester && !u.ut.deploysInto && !u.ut.medic && (includeAir || u.kind !== 'aircraft'));
}

export function enemyThings(world: World): Entity[] {
  const me = world.players[0];
  return [...world.buildings.filter((b) => b.alive && me.isEnemy(b.owner) && !b.bt.wall), ...world.units.filter((u) => u.alive && me.isEnemy(u.owner))];
}

export function nearestTo(list: Entity[], x: number, y: number): Entity | null {
  let best: Entity | null = null, bd = Infinity;
  for (const e of list) { const d = Math.hypot(e.x - x, e.y - y); if (d < bd) { bd = d; best = e; } }
  return best;
}

export function attackMove(world: World, units: Unit[], x: number, y: number) {
  if (units.length) world.issue({ c: 'move', player: 0, units: units.map((u) => u.id), x, y, attackMove: true });
}
export function moveTo(world: World, units: Unit[], x: number, y: number) {
  if (units.length) world.issue({ c: 'move', player: 0, units: units.map((u) => u.id), x, y, attackMove: false });
}
export function attack(world: World, units: Unit[], target: Entity) {
  if (units.length) world.issue({ c: 'attack', player: 0, units: units.map((u) => u.id), target: target.id });
}

/** Every `sec` seconds (pilot granularity is 0.5 s). */
export function every(world: World, s: Record<string, any>, key: string, sec: number): boolean {
  const next = s['ev:' + key] ?? 0;
  if (world.time >= next) { s['ev:' + key] = world.time + sec; return true; }
  return false;
}

/** Generic: AI base building + push the army at the nearest enemy every 40 s once it is big enough. */
export const genericPilot: Pilot = (world, rt, s) => {
  brain(world, s);
  expertMicro(world, s, army(world));
  if (world.time > 60 && every(world, s, 'push', 40)) {
    const a = army(world);
    const value = a.reduce((v, u) => v + u.ut.cost, 0);
    if (value < 2500 && world.time < 600) return;
    const c = a.length ? { x: a.reduce((v, u) => v + u.x, 0) / a.length, y: a.reduce((v, u) => v + u.y, 0) / a.length } : { x: 0, y: 0 };
    const t = nearestTo(enemyThings(world).filter((e) => e.kind === 'building'), c.x, c.y) ?? nearestTo(enemyThings(world), c.x, c.y);
    if (t) attackMove(world, a, t.x, t.y);
  }
};

export const PILOTS: Record<string, Pilot> = {};

export function isBuilding(e: Entity): e is Building {
  return e.kind === 'building';
}
void T;

/**
 * A steadier "commander": defensive economy brain + deliberate attack waves.
 * Gathers at a rally point until the army is worth `threshold`, then attack-moves at the best target
 * (pickTarget) as a blob; falls back when the wave is broken, and raises the bar for the next wave.
 * With `waves`, units built after a wave left gather at the rally point and follow as a group (no trickle).
 */
export function commander(world: World, rt: MissionRuntime, s: Record<string, any>, log: (t: string) => void,
  opts: { threshold?: number; pickTarget?: (from: { x: number; y: number }) => Entity | null; rally?: [number, number]; deadline?: () => boolean; noBrain?: boolean; units?: (u: Unit) => boolean; maxThreshold?: number;
    /** Seconds after a broken wave before the army goes again with half the bar (a player's patience). */
    patience?: number;
    /** Keep each wave together: fresh units gather and join the attack as a group, not one by one. */
    waves?: boolean;
    /** "Clearly stronger than what's out there" counts the enemy's armed structures too (a player sees the guns). */
    countDefences?: boolean;
    /** The expert's hands (expertMicro: focus fire, repairs). Off by default: measured over every mission at Hard and
     * Brutal it helped where the AI brain fights (allied-01/02) and cost wins where the waves are scripted. */
    micro?: boolean } = {}) {
  if (!opts.noBrain) brain(world, s, 'defensive');
  const held = opts.micro ? expertMicro(world, s, army(world).filter((u) => !opts.units || opts.units(u))) : null;
  if (!every(world, s, 'cmd', 5)) return;
  const st = rt.start(0);
  const all = army(world).filter((u) => !u.ut.hero && u.ut.id !== 'e6' && (!opts.units || opts.units(u)) && !held?.has(u.id));
  const worth = (l: Unit[]) => l.reduce((v, u) => v + u.ut.cost, 0);
  s.threshold ??= opts.threshold ?? 7000;
  s.mode ??= 'gather';
  const pick = opts.pickTarget ?? ((from) => nearestTo(enemyThings(world).filter((e) => e.kind === 'building'), from.x, from.y) ?? nearestTo(enemyThings(world), from.x, from.y));
  const rally = opts.rally ?? (() => { const t = pick(st); if (!t) return [st.x, st.y] as [number, number]; const d = Math.hypot(t.x - st.x, t.y - st.y) || 1; return [st.x + (t.x - st.x) / d * 9, st.y + (t.y - st.y) / d * 9] as [number, number]; })();
  // (waves: the attack belongs to the units that set out; the rest gather)
  const inWave = (u: Unit) => !opts.waves || s.mode !== 'attack' || (s.wave as Set<number> | undefined)?.has(u.id);
  const a = all.filter(inWave);
  const fresh = all.filter((u) => !inWave(u));
  const value = worth(a);
  const c = a.length ? { x: a.reduce((v, u) => v + u.x, 0) / a.length, y: a.reduce((v, u) => v + u.y, 0) / a.length } : st;
  // base defence: anything hostile near home gets the idle units' attention
  const threat = enemyThings(world).find((e) => e.kind !== 'building' && Math.hypot(e.x - st.x, e.y - st.y) < 16);
  const gather = (l: Unit[]) => {
    if (threat) attackMove(world, l.filter((u) => u.order.type === 'idle' || Math.hypot(u.x - threat.x, u.y - threat.y) < 12), threat.x, threat.y);
    else {
      const stray = l.filter((u) => (u.order.type === 'idle' || (opts.waves && u.order.type === 'move' && Math.hypot(u.x - rally[0], u.y - rally[1]) > 12 && !s.sent?.has(u.id))) && Math.hypot(u.x - rally[0], u.y - rally[1]) > 6);
      if (stray.length) attackMove(world, stray, rally[0], rally[1]);
    }
  };
  if (s.mode === 'gather') {
    gather(a);
    const foes = enemyThings(world).filter((e) => (e.kind !== 'building' || opts.countDefences) && e.weapons.length && !(e as Unit).ut?.harvester);
    const foeValue = foes.reduce((v, u) => v + u.type.cost, 0);
    // (patience: the first wave waits twice as long)
    const impatient = opts.patience !== undefined && world.time - (s.brokeAt ?? 0) > opts.patience * (s.brokeAt === undefined ? 2 : 1) && value >= Math.max(1500, s.threshold * 0.5);
    // (a last few structures and next to nothing defending them: go and finish it with whatever is left)
    const endgame = value > 0 && value > foeValue * 2 && enemyThings(world).filter((e) => e.kind === 'building').length <= 3;
    if (value >= s.threshold || (opts.deadline?.() && value > 2000) || (value > 1500 && value > foeValue * 2.5) || impatient || endgame) {
      s.mode = 'attack';
      s.waveStart = value;
      s.wave = new Set(a.map((u) => u.id));
      s.sent = new Set<number>();
      log(`pilot: attack with ${a.length} units (value ${value}, bar ${s.threshold})`);
    }
  } else {
    const t = pick(c);
    if (!t) { s.mode = 'gather'; return; }
    // (units on an explicit attack, the expert's focus fire, finish it first)
    attackMove(world, a.filter((u) => !(u.order.type === 'attack' && world.getEntity((u.order as { target: number }).target)?.alive)), t.x, t.y);
    if (opts.waves && fresh.length) {
      // reinforcements: a group worth a third of the wave sets out together, while the wave still holds (a thin wave
      // falls back below and everyone goes again together: no feeding groups one after another into the guns)
      if (worth(fresh) >= Math.max(1200, s.waveStart * 0.3) && value >= s.waveStart * 0.6) {
        for (const u of fresh) { (s.wave as Set<number>).add(u.id); s.sent.add(u.id); }
        attackMove(world, fresh, t.x, t.y);
        log(`pilot: reinforcements, ${fresh.length} units (value ${worth(fresh)})`);
      } else gather(fresh);
    }
    // (a broken wave falls back and regroups; against the clock the old commander kept going, the wave-keeping one
    // regroups too and leaves again as soon as it is worth 2000)
    if (value < s.waveStart * 0.35 && (opts.waves || !opts.deadline?.())) {
      s.mode = 'gather';
      s.threshold = Math.min(s.threshold + 2500, opts.maxThreshold ?? Infinity);
      s.brokeAt = world.time;
      attackMove(world, all, rally[0], rally[1]);
      log(`pilot: wave broken (value ${value}); next bar ${s.threshold}`);
    }
  }
}

/**
 * Lean build manager for the human (stands in for a competent player's macro):
 * deploys the MCV, follows a build order (repeats = more of a type), keeps power positive,
 * keeps two ore trucks per refinery and spends the rest on the given unit mix.
 */
export function builder(world: World, s: Record<string, any>, order: string[], infMix: string[], vehMix: string[], airMix: string[] = []) {
  const p = world.players[0];
  s.placer ??= new AIController(world, p, 'normal');
  if (!every(world, s, 'build', 1)) return;
  const mine = world.units.filter((u) => u.alive && u.owner === p);
  if (!p.has('fact')) {
    const mcv = mine.find((u) => u.ut.deploysInto);
    if (mcv && mcv.order.type === 'idle') {
      if (world.canDeploy(mcv)) world.issue({ c: 'deploy', player: 0, units: [mcv.id] });
      else world.issue({ c: 'move', player: 0, units: [mcv.id], x: mcv.x + (world.rng.next() - 0.5) * 4, y: mcv.y + (world.rng.next() - 0.5) * 4 });
    }
    return;
  }
  const q = p.queues.structure;
  s.noRoom ??= {};
  if (q.ready) {
    const bt = BUILDINGS[q.ready];
    // (shipyards and sub pens go on the water; power plants step the base towards the shore while no water is in reach)
    const spot = bt.water ? aiPlacement(world, p, bt) : aiPlacement(world, p, bt) ?? s.placer.findPlacement(bt);
    if (spot) world.issue({ c: 'place', player: 0, type: q.ready, cx: spot[0], cy: spot[1] });
    else { world.issue({ c: 'cancel', player: 0, type: q.ready }); s.noRoom[q.ready] = world.time; }
  } else if (!q.items.length) {
    const count = (t: string) => world.buildings.filter((b) => b.alive && b.owner === p && b.bt.id === t).length;
    const seen: Record<string, number> = {};
    let next: string | null = null;
    for (const t of order) {
      seen[t] = (seen[t] ?? 0) + 1;
      // (a structure with nowhere to go waits a minute while the rest of the order goes on)
      if (count(t) < seen[t] && p.canBuild(t) && !(world.time - (s.noRoom[t] ?? -1e9) < 60)) { next = t; break; }
    }
    const drain = next ? Math.max(0, -BUILDINGS[next].power) : 0;
    if (p.powerOut - p.powerUse - drain < 20) next = p.canBuild('apwr') ? 'apwr' : p.canBuild('powr') ? 'powr' : next;
    if (next && p.credits >= Math.min(BUILDINGS[next].cost, 1500) * 0.6) world.issue({ c: 'build', player: 0, type: next });
  }
  // structures first: hold money for the next build-order item until the war factory is up
  const counts: Record<string, number> = {};
  let pending: string | null = null;
  for (const t of order) {
    counts[t] = (counts[t] ?? 0) + 1;
    if (world.buildings.filter((b) => b.alive && b.owner === p && b.bt.id === t).length < counts[t] && p.canBuild(t)) { pending = t; break; }
  }
  const early = !p.has('weap');
  const reserve = (pending ? Math.min(BUILDINGS[pending].cost, early ? 2000 : 1000) : 300) + 0;
  // ore trucks first (two per refinery)
  const refs = world.buildings.filter((b) => b.alive && b.owner === p && b.bt.id === 'proc').length;
  const harvs = mine.filter((u) => u.ut.harvester).length + p.queues.vehicle.items.filter((i) => i.type === 'harv').length;
  let hold = 0;
  if (harvs < refs * 2 && p.canBuild('harv')) {
    if (p.credits >= 1400 && !p.queues.vehicle.items.length) { world.issue({ c: 'build', player: 0, type: 'harv' }); return; }
    hold = harvs === 0 ? 1400 : 600;
  }
  const pick = (mix: string[]) => { const opts = mix.filter((t) => p.canBuild(t)); return opts.length ? opts[world.rng.int(0, opts.length - 1)] : null; };
  const veh = pick(vehMix);
  if (veh && p.queues.vehicle.items.length < 2 && p.credits > reserve + hold + 700) world.issue({ c: 'build', player: 0, type: veh });
  if (airMix.length && p.queues.aircraft.items.length < 1 && p.credits > reserve + 1300) { const t = pick(airMix); if (t) world.issue({ c: 'build', player: 0, type: t }); }
  if (p.queues.infantry.items.length < 2 && p.credits > reserve + (veh ? 1100 : 200)) { const t = pick(infMix); if (t) world.issue({ c: 'build', player: 0, type: t }); }
}

/**
 * An excellent player's hands in a fight (the expert pilots; EXPERT_MICRO=0 turns it off for comparison):
 *  - focus fire: units with enemies in reach shoot together at the targets that die soonest for the guns they carry,
 *    armed ones first, each target taking only as many shooters as it needs (no overkill);
 *  - badly hurt vehicles pull back to a Service Depot, when there is one, and rejoin once repaired.
 * Returns the units it holds back for repairs (leave them out of the waves).
 */
export function expertMicro(world: World, s: Record<string, any>, units: Unit[]): Set<number> {
  s.repairing ??= new Set<number>();
  const held = s.repairing as Set<number>;
  const mode = process.env.EXPERT_MICRO ?? 'all'; // (A/B: 0 | focus | repair | all)
  if (mode === '0' || !every(world, s, 'micro', 1)) return held;
  const me = world.players[0];
  // repairs
  const depot = world.buildings.find((b) => b.alive && b.owner === me && b.bt.repairPad && b.active);
  for (const id of [...held]) {
    const u = world.getEntity(id) as Unit | undefined;
    if (!u?.alive || u.healthFrac > 0.95 || !depot) held.delete(id);
  }
  if (depot && mode !== 'focus') {
    for (const u of units) {
      if (u.kind !== 'vehicle' || held.has(u.id) || u.healthFrac > 0.35 || u.ut.cost < 600) continue;
      held.add(u.id);
      world.issue({ c: 'enter', player: 0, units: [u.id], target: depot.id });
    }
  }
  // run infantry over: a tank's gun barely scratches a rifleman, its tracks kill him (not under the guns of a defence)
  const crushing = new Set<number>();
  if (mode === 'all' || mode === 'crush') {
    const guns = world.buildings.filter((b) => b.alive && me.isEnemy(b.owner) && b.weapons.length && world.canSee(me, b));
    const prey = world.units.filter((o) => o.alive && o.kind === 'infantry' && o.ut.crushable && me.isEnemy(o.owner) && world.canSee(me, o)
      && guns.every((b) => b.distTo(o.x, o.y) > maxRange(b) + 1.5));
    for (const u of units) {
      if (!u.ut.crusher || held.has(u.id) || u.healthFrac < 0.3) continue;
      const slot = u.weapons[0];
      if (slot && WARHEADS[slot.def.warhead].verses[ARMOR_INDEX.none] >= 0.6) continue; // (its gun does the job)
      let best: Unit | null = null, bd = 4.5;
      for (const o of prey) { const d = Math.hypot(o.x - u.x, o.y - u.y); if (d < bd) { bd = d; best = o; } }
      if (!best) continue;
      crushing.add(u.id);
      world.issue({ c: 'move', player: 0, units: [u.id], x: best.x, y: best.y, attackMove: false });
    }
  }
  // focus fire
  const fighters = units.filter((u) => !held.has(u.id) && !crushing.has(u.id) && u.weapons.length && u.kind !== 'aircraft');
  if (!fighters.length || mode === 'repair' || mode === 'crush') return held;
  const foes = [
    ...world.units.filter((u) => u.alive && me.isEnemy(u.owner) && u.kind !== 'aircraft' && !u.transport && world.canSee(me, u)),
    ...world.buildings.filter((b) => b.alive && me.isEnemy(b.owner) && b.weapons.length && !b.bt.wall && b.invulnerable <= 0 && world.canSee(me, b)),
  ];
  if (!foes.length) return held;
  // who can hit what, and how hard (damage a volley does to it)
  const options = new Map<Unit, { t: Entity; dmg: number }[]>();
  for (const u of fighters) {
    const r = maxRange(u) + 0.6;
    const list: { t: Entity; dmg: number }[] = [];
    for (const t of foes) {
      const d = t.kind === 'building' ? (t as Building).distTo(u.x, u.y) : Math.hypot(t.x - u.x, t.y - u.y);
      if (d > r) continue;
      const slot = pickWeapon(u, t);
      if (!slot) continue;
      const v = WARHEADS[slot.def.warhead].verses[ARMOR_INDEX[t.type.armor]];
      if (v <= 0.05) continue;
      list.push({ t, dmg: slot.def.damage * v * (slot.def.burst ?? 1) });
    }
    if (list.length) options.set(u, list);
  }
  if (!options.size) return held;
  // targets in order: armed before unarmed, then quickest to kill for the guns that reach them
  const reach = new Map<Entity, number>();
  for (const list of options.values()) for (const o of list) reach.set(o.t, (reach.get(o.t) ?? 0) + o.dmg);
  const order = [...reach.keys()].sort((a, b) => {
    const wa = a.weapons.length ? 0 : 1, wb = b.weapons.length ? 0 : 1;
    if (wa !== wb) return wa - wb;
    return a.hp / reach.get(a)! - b.hp / reach.get(b)! || a.id - b.id;
  });
  const left = new Set(options.keys());
  const plan = new Map<number, number[]>();
  for (const t of order) {
    let need = t.hp * 1.25;
    for (const u of [...left]) {
      if (need <= 0) break;
      const o = options.get(u)!.find((x) => x.t === t);
      if (!o) continue;
      left.delete(u);
      need -= o.dmg;
      const ids = plan.get(t.id) ?? [];
      ids.push(u.id);
      plan.set(t.id, ids);
    }
    if (!left.size) break;
  }
  for (const [tid, ids] of plan) {
    const fresh = ids.filter((id) => (world.getEntity(id) as Unit).target?.id !== tid);
    if (fresh.length) world.issue({ c: 'attack', player: 0, units: fresh, target: tid });
  }
  return held;
}

