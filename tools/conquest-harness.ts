// Headless Conquest battles: world creation mirroring src/game.ts (generated / curated maps, rocks, commander
// personalities) and simple autopilots per battle kind. Used by tests/conquest.test.ts and tools/conquesttest.ts.
//
// The autopilots stand in for a decent player with a head start: they get a strike force (cheat) so a battle
// resolves in a few simulated minutes; the point is to prove each battle type's script, objectives and outcome.
import { generateMap } from '../src/sim/mapgen';
import { World, type PlayerSetup } from '../src/sim/world';
import { MissionRuntime } from '../src/sim/mission';
import { AIController } from '../src/sim/ai';
import { TICK_HZ } from '../src/sim/types';
import { UNITS } from '../src/data/rules';
import type { Building, Entity, Unit } from '../src/sim/entities';
import { loadCuratedMap } from '../src/maps';
import { regionMapFor } from '../src/sim/mapgen-region';
import { battleOutcome, conquestMission, isSeaBattle, type BattleMap, type BattleOutcome, type ConquestSetup } from '../src/conquest/battle';
import { skillPilot, type Skill } from './campaign-players';

const TEAM_COLORS = [0x3d7be0, 0xd23a2c, 0xe0b030, 0x3fa34d];

/** World + mission runtime for a conquest battle, built like src/game.ts does (`forLoad`: skip the setup, a save restores it). */
export function createConquestWorld(setup: ConquestSetup, forLoad = false) {
  const def = conquestMission(setup);
  const mp = def.map as BattleMap;
  const curated = mp.mapId ? loadCuratedMap(mp.mapId) : regionMapFor(mp); // (World Conquest: the region battlefield, as game.ts)
  const climate = curated?.climate ?? mp.climate ?? 'temperate';
  const water = mp.water ?? 0.5, trees = mp.trees ?? 0.5;
  const map = curated ?? generateMap({
    size: mp.size, players: mp.players, seed: mp.seed, ore: mp.ore ?? 0.6, rocks: mp.rocks,
    water: climate === 'desert' && water < 0.9 ? Math.min(water, 0.2) : water,
    trees: climate === 'desert' ? trees * 0.35 : climate === 'winter' ? Math.min(1, trees * 1.2) : trees,
  });
  map.climate = climate;
  const players: PlayerSetup[] = def.players.map((ps, i) => ({
    name: ps.name, faction: ps.faction, color: ps.color ?? TEAM_COLORS[i], team: ps.team ?? i, isHuman: i === 0,
    ai: i === 0 ? undefined : ps.ai === 'passive' || ps.ai === 'defensive' || !ps.ai ? 'normal' : ps.ai,
    personality: i === 0 ? undefined : ps.personality,
  }));
  const world = new World({
    map, players, credits: def.credits ?? 5000, startUnits: 'none',
    startUnitsPer: def.players.map(() => 'none'),
    creditsPer: def.players.map((ps, i) => (i === 0 ? def.credits : ps.credits ?? 5000)),
    fog: def.fog ?? true, seed: mp.seed,
  });
  const rt = new MissionRuntime(world, def);
  world.mission = rt;
  def.players.forEach((ps, i) => { if (i > 0 && ps.ai) rt.setAI(i, ps.ai); });
  if (def.allowedBuild) rt.allowBuild(def.allowedBuild);
  if (!forLoad) {
    def.setup(rt);
    for (const p of world.players) { world.updateVisibility(p); for (const o of p.buildOptions()) p.knownOptions.add(o); }
  }
  return { world, rt, def };
}

/** The same world rebuilt for a save (no setup: the save restores everything). */
export function createConquestWorldForLoad(setup: ConquestSetup) {
  return createConquestWorld(setup, true);
}

// =====================================================================================================
// Autopilots
// =====================================================================================================
type S = Record<string, any>;

function army(world: World): Unit[] {
  return world.units.filter((u) => u.alive && u.owner.id === 0 && u.weapons.length && !u.ut.harvester && !u.ut.deploysInto && !u.ut.engineer && u.kind !== 'aircraft');
}
function enemies(world: World): Entity[] {
  const me = world.players[0];
  return [...world.buildings.filter((b) => b.alive && me.isEnemy(b.owner) && !b.bt.wall && !b.bt.mine), ...world.units.filter((u) => u.alive && me.isEnemy(u.owner))];
}
function nearest<T extends Entity>(list: T[], x: number, y: number): T | null {
  let best: T | null = null, bd = Infinity;
  for (const e of list) { const d = Math.hypot(e.x - x, e.y - y); if (d < bd) { bd = d; best = e; } }
  return best;
}
function centre(list: Entity[]): [number, number] {
  return list.length ? [list.reduce((s, u) => s + u.x, 0) / list.length, list.reduce((s, u) => s + u.y, 0) / list.length] : [0, 0];
}
function every(world: World, s: S, key: string, sec: number): boolean {
  const next = s['ev:' + key] ?? 0;
  if (world.time >= next) { s['ev:' + key] = world.time + sec; return true; }
  return false;
}

/** Strike force handed to the autopilot at the start (scaled to the garrison). */
function boost(world: World, rt: MissionRuntime, s: S) {
  if (s.boosted) return;
  s.boosted = true;
  const me = world.players[0];
  const st = rt.def.map as BattleMap;
  const f = me.faction;
  const strength = (rt.def as any).__strength ?? 3;
  const start = rt.start(0), enemy = rt.start(1);
  const n = 6 + strength * 2;
  const tank = f === 'allies' ? '2tnk' : '3tnk';
  const types: string[] = [];
  for (let k = 0; k < n; k++) types.push(k % 4 === 3 ? 'e3' : k % 5 === 4 && f === 'soviet' ? '4tnk' : tank);
  const [x, y] = rt.toward(start, enemy, 6);
  for (const t of types) rt.spawnUnit(0, t, x, y);
  if (isSeaBattle({ map: st })) {
    const bay = rt.toward(start, { x: rt.mapW / 2, y: rt.mapH / 2 }, 12);
    const ships = f === 'allies' ? ['dd', 'dd', 'dd', 'ca', 'ca', 'dd'] : ['ss', 'ss', 'ss', 'ss', 'ss', 'ss', 'ss'];
    for (const t of ships) {
      const [wx, wy] = world.findFreeSpot(bay[0], bay[1], 14, true, true);
      if (world.map.navalPassable(Math.floor(wx), Math.floor(wy))) world.addUnit(t, me, wx, wy);
    }
  }
  me.cash += 6000;
}

function brain(world: World, s: S, mode?: 'defensive') {
  if (!s.brain) {
    s.brain = new AIController(world, world.players[0], 'hard');
    if (mode) s.brain.setMode(mode);
    world.ais.push(s.brain);
  }
}

export type ConquestPilot = (world: World, rt: MissionRuntime, s: S) => void;

export const PILOTS: Record<string, ConquestPilot> = {
  assault(world, rt, s) {
    boost(world, rt, s);
    brain(world, s);
    if (!every(world, s, 'push', 8)) return;
    const a = army(world);
    const [cx, cy] = centre(a);
    const t = nearest(enemies(world).filter((e) => e.kind === 'building'), cx, cy) ?? nearest(enemies(world), cx, cy);
    if (t && a.length) world.issue({ c: 'move', player: 0, units: a.map((u) => u.id), x: t.x, y: t.y, attackMove: true });
  },
  boss(world, rt, s) {
    boost(world, rt, s);
    // a player at the gates of the enemy capital has a big army and keeps it coming
    if (every(world, s, 'reinforce', 60)) boost(world, rt, {});
    brain(world, s);
    if (!every(world, s, 'push', 8)) return;
    const a = army(world);
    const [cx, cy] = centre(a);
    const me = world.players[0];
    const facts = world.buildings.filter((b) => b.alive && me.isEnemy(b.owner) && b.bt.id === 'fact');
    const t = nearest(facts, cx, cy) ?? nearest(enemies(world), cx, cy);
    if (t && a.length) world.issue({ c: 'move', player: 0, units: a.map((u) => u.id), x: t.x, y: t.y, attackMove: true });
  },
  capture(world, rt, s) {
    boost(world, rt, s);
    brain(world, s, 'defensive');
    const target = world.getEntity(rt.flags.target) as Building | undefined;
    if (!target?.alive) return;
    target.invulnerable = 40; // the strike force must not flatten the objective
    if (!every(world, s, 'push', 6)) return;
    const a = army(world);
    const rest = enemies(world).filter((e) => e !== target);
    const near = nearest(rest, target.x, target.y);
    if (near && Math.hypot(near.x - target.x, near.y - target.y) < 12) {
      world.issue({ c: 'move', player: 0, units: a.map((u) => u.id), x: near.x, y: near.y, attackMove: true });
      return;
    }
    // area secured: knock the post down to capture level and send the engineers
    if (target.healthFrac > 0.25) target.hp = target.maxHp * 0.2;
    const eng = world.units.filter((u) => u.alive && u.owner.id === 0 && u.ut.engineer);
    if (eng.length) world.issue({ c: 'enter', player: 0, units: eng.map((u) => u.id), target: target.id });
    else rt.spawnUnit(0, 'e6', ...rt.toward(target, rt.start(0), 5));
  },
  hold(world, rt, s) {
    boost(world, rt, s);
    brain(world, s, 'defensive');
    if (!every(world, s, 'push', 8)) return;
    const [zx, zy] = rt.flags.zone as [number, number];
    const a = army(world);
    world.issue({ c: 'move', player: 0, units: a.map((u) => u.id), x: zx, y: zy, attackMove: true });
  },
  defend(world, rt, s) {
    boost(world, rt, s);
    brain(world, s, 'defensive');
    if (!every(world, s, 'guard', 10)) return;
    const hq = world.getEntity(rt.flags.hq);
    const a = army(world).filter((u) => u.kind !== 'naval');
    if (hq && a.length) {
      const threat = nearest(world.units.filter((u) => u.alive && world.players[0].isEnemy(u.owner)), hq.x, hq.y);
      const tgt = threat && Math.hypot(threat.x - hq.x, threat.y - hq.y) < 16 ? threat : hq;
      world.issue({ c: 'move', player: 0, units: a.map((u) => u.id), x: tgt.x, y: tgt.y, attackMove: true });
    }
  },
  naval(world, rt, s) {
    boost(world, rt, s);
    brain(world, s);
    if (!every(world, s, 'push', 8)) return;
    const fleet = world.units.filter((u) => u.alive && u.owner.id === 0 && u.kind === 'naval' && u.weapons.length);
    const me = world.players[0];
    const yards = world.buildings.filter((b) => b.alive && me.isEnemy(b.owner) && b.bt.water);
    const ships = world.units.filter((u) => u.alive && me.isEnemy(u.owner) && u.kind === 'naval');
    const [cx, cy] = centre(fleet);
    const t = nearest([...ships, ...yards], cx, cy);
    if (t && fleet.length) world.issue({ c: 'attack', player: 0, units: fleet.map((u) => u.id), target: t.id });
    PILOTS.assault(world, rt, s);
  },
};

export interface HeadlessResult {
  outcome: BattleOutcome;
  ended: boolean;
  won: boolean;
  time: number;
  reason: string | null;
  objectives: string[];
  error?: string;
}

/** Run a conquest battle headless with the autopilot for its kind (pilot = 'idle' does nothing). */
export function runConquestBattle(setup: ConquestSetup, minutes: number, pilot: 'auto' | 'idle' | Skill = 'auto', onTick?: (world: World, rt: MissionRuntime) => void): HeadlessResult & { world: World; rt: MissionRuntime } {
  const { world, rt, def } = createConquestWorld(setup);
  (def as any).__strength = setup.battle.strength;
  // 'auto': the strike-force autopilot for the battle kind; 'newcomer' / 'casual': the human-like pilots (no head start)
  const skill = pilot === 'newcomer' || pilot === 'casual' ? skillPilot(pilot) : null;
  const p: ConquestPilot | null = pilot === 'auto' ? PILOTS[setup.battle.kind] : skill ? (w, r, st) => skill(w, r, st, process.env.CQLOG ? (t) => console.log(`  [${Math.floor(w.time / 60)}:${String(Math.floor(w.time % 60)).padStart(2, '0')}] ${t}`) : () => {}) : null;
  const s: S = {};
  let error: string | undefined;
  try {
    for (let t = 0; t < minutes * 60 * TICK_HZ && !world.gameOver; t++) {
      world.step();
      if (p && t % 10 === 0) p(world, rt, s);
      onTick?.(world, rt);
      rt.events.length = 0;
      world.events.length = 0;
    }
  } catch (e) {
    error = (e as Error).stack ?? String(e);
  }
  return {
    world, rt, outcome: battleOutcome(world, setup.battle), ended: rt.ended, won: rt.won, time: world.time, reason: rt.endReason,
    objectives: rt.objectives.map((o) => `${o.primary ? '' : '(opt)'}${o.id}:${o.state}${o.progress ? '[' + o.progress + ']' : ''}`), error,
  };
}

export { UNITS };
