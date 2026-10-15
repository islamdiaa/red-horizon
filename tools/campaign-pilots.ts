// Autopilots that stand in for a competent human in tools/campaigntest.ts.
// They may use full knowledge of the map; the goal is to prove each mission is winnable and stable.
import { AIController } from '../src/sim/ai';
import { BUILDINGS } from '../src/data/rules';
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
 */
export function commander(world: World, rt: MissionRuntime, s: Record<string, any>, log: (t: string) => void,
  opts: { threshold?: number; pickTarget?: (from: { x: number; y: number }) => Entity | null; rally?: [number, number]; deadline?: () => boolean; noBrain?: boolean } = {}) {
  if (!opts.noBrain) brain(world, s, 'defensive');
  if (!every(world, s, 'cmd', 5)) return;
  const st = rt.start(0);
  const a = army(world).filter((u) => !u.ut.hero && u.ut.id !== 'e6');
  const value = a.reduce((v, u) => v + u.ut.cost, 0);
  s.threshold ??= opts.threshold ?? 7000;
  s.mode ??= 'gather';
  const c = a.length ? { x: a.reduce((v, u) => v + u.x, 0) / a.length, y: a.reduce((v, u) => v + u.y, 0) / a.length } : st;
  const pick = opts.pickTarget ?? ((from) => nearestTo(enemyThings(world).filter((e) => e.kind === 'building'), from.x, from.y) ?? nearestTo(enemyThings(world), from.x, from.y));
  const rally = opts.rally ?? (() => { const t = pick(st); if (!t) return [st.x, st.y] as [number, number]; const d = Math.hypot(t.x - st.x, t.y - st.y) || 1; return [st.x + (t.x - st.x) / d * 9, st.y + (t.y - st.y) / d * 9] as [number, number]; })();
  // base defence: anything hostile near home gets the idle units' attention
  const threat = enemyThings(world).find((e) => e.kind !== 'building' && Math.hypot(e.x - st.x, e.y - st.y) < 16);
  if (s.mode === 'gather') {
    if (threat) attackMove(world, a.filter((u) => u.order.type === 'idle' || Math.hypot(u.x - threat.x, u.y - threat.y) < 12), threat.x, threat.y);
    else {
      const stray = a.filter((u) => u.order.type === 'idle' && Math.hypot(u.x - rally[0], u.y - rally[1]) > 6);
      if (stray.length) attackMove(world, stray, rally[0], rally[1]);
    }
    const foes = enemyThings(world).filter((e) => e.kind !== 'building' && (e as Unit).weapons.length && !(e as Unit).ut.harvester);
    const foeValue = foes.reduce((v, u) => v + (u as Unit).ut.cost, 0);
    if (value >= s.threshold || (opts.deadline?.() && value > 2000) || (value > 1500 && value > foeValue * 2.5)) {
      s.mode = 'attack';
      s.waveStart = value;
      log(`pilot: attack with ${a.length} units (value ${value}, bar ${s.threshold})`);
    }
  } else {
    const t = pick(c);
    if (!t) { s.mode = 'gather'; return; }
    attackMove(world, a, t.x, t.y);
    if (value < s.waveStart * 0.35 && !opts.deadline?.()) {
      s.mode = 'gather';
      s.threshold += 2500;
      attackMove(world, a, rally[0], rally[1]);
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
  if (q.ready) {
    const spot = s.placer.findPlacement(BUILDINGS[q.ready]);
    if (spot) world.issue({ c: 'place', player: 0, type: q.ready, cx: spot[0], cy: spot[1] });
    else world.issue({ c: 'cancel', player: 0, type: q.ready });
  } else if (!q.items.length) {
    const count = (t: string) => world.buildings.filter((b) => b.alive && b.owner === p && b.bt.id === t).length;
    const seen: Record<string, number> = {};
    let next: string | null = null;
    for (const t of order) {
      seen[t] = (seen[t] ?? 0) + 1;
      if (count(t) < seen[t] && p.canBuild(t)) { next = t; break; }
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
