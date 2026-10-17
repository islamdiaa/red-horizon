/**
 * Attract mode: the menu backdrop as a directed battle. Two developed HD bases (Construction Yards, Tesla
 * Coils, missile silos, naval yards) on a battlefield with a sea, armies clashing in the middle, and a
 * camera program that shows it off: an establishing crane, an orbit of the Soviet base, a Tesla Coil
 * frying a raid, the main clash, a naval battle, the Allied base, a nuclear strike in slow motion.
 *
 * The battle is staged with plain units and orders on a demo world (never recorded or saved), so the
 * simulation code is untouched; the AIs keep playing in between. The program loops; after a few loops (or
 * when one side is wiped out) main.ts rebuilds a fresh battlefield behind a fade.
 *
 * The same staging and shots make the `?trailer=1` cut (trailer.ts) with title cards.
 */
import type { Game, GameSetup } from '../game';
import type { Quality, TimeOfDay } from '../render/renderer';
import { generateMap } from '../sim/mapgen';
import { T, type GameMap } from '../sim/map';
import type { World } from '../sim/world';
import type { Player } from '../sim/player';
import { Building } from '../sim/entities';
import { chargeArmies } from '../debug';
import { fireSuperweapon, superFull } from '../sim/superweapons';
import { actionFocus, baseOf, Director, ease, fleetFocus, findStructure, lerp, nukeInFlight, type Shot, type TitleCard } from './director';

const SIZE = 64;
const WATER = 0.62;

/** Water body for the naval clash: two far-apart points on the largest sea. */
export interface Sea { cells: number; a: [number, number]; b: [number, number]; cx: number; cy: number }

/** The largest connected body of water (null when the map has none worth a naval battle). */
export function largestSea(map: GameMap, minCells = 110): Sea | null {
  const n = map.w * map.h;
  const seen = new Uint8Array(n);
  let best: number[] = [];
  const stack: number[] = [];
  for (let i = 0; i < n; i++) {
    if (seen[i] || map.terrain[i] !== T.Water) continue;
    const comp: number[] = [];
    stack.push(i);
    seen[i] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      comp.push(c);
      const x = c % map.w, y = (c / map.w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h) continue;
        const j = ny * map.w + nx;
        if (!seen[j] && map.terrain[j] === T.Water) { seen[j] = 1; stack.push(j); }
      }
    }
    if (comp.length > best.length) best = comp;
  }
  if (best.length < minCells) return null;
  // open water only (every neighbour wet), so ships fit
  const open = best.filter((c) => {
    const x = c % map.w, y = (c / map.w) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h || map.terrain[ny * map.w + nx] !== T.Water) return false;
    }
    return true;
  });
  if (open.length < 20) return null;
  let cx = 0, cy = 0;
  for (const c of open) { cx += c % map.w; cy += (c / map.w) | 0; }
  cx /= open.length; cy /= open.length;
  const far = (fx: number, fy: number) => {
    let bi = open[0], bd = -1;
    for (const c of open) { const d = (c % map.w - fx) ** 2 + (((c / map.w) | 0) - fy) ** 2; if (d > bd) { bd = d; bi = c; } }
    return [bi % map.w + 0.5, ((bi / map.w) | 0) + 0.5] as [number, number];
  };
  const a = far(cx, cy);
  const b = far(a[0], a[1]);
  return { cells: best.length, a, b, cx, cy };
}

/** A seed whose battlefield has a sea for the naval clash (tries a few; keeps the best). */
export function pickBattlefield(rand: () => number = Math.random): { seed: number; sea: Sea | null } {
  let best: { seed: number; sea: Sea | null } | null = null;
  for (let k = 0; k < 6; k++) {
    const seed = (rand() * 1e9) | 0;
    let sea: Sea | null = null;
    try {
      sea = largestSea(generateMap({ size: SIZE, players: 2, seed, ore: 0.8, water: WATER, trees: 0.6 }));
    } catch { /* keep looking */ }
    const dist = sea ? Math.hypot(sea.a[0] - sea.b[0], sea.a[1] - sea.b[1]) : 0;
    if (!best || (sea && (!best.sea || dist > Math.hypot(best.sea.a[0] - best.sea.b[0], best.sea.a[1] - best.sea.b[1])))) best = { seed, sea };
    if (sea && dist > 14 && sea.cells < SIZE * SIZE * 0.4) break;
  }
  return best!;
}

// ---------------------------------------------------------------------------------------------
// Staging (demo worlds only: plain units and orders)

const combatUnits = (world: World, p: Player) => world.units.filter((u) => u.alive && u.owner === p && u.weapons.length && !u.ut.harvester && u.kind !== 'naval').length;

function spawn(world: World, p: Player, types: string[], x: number, y: number, naval = false): number[] {
  const ids: number[] = [];
  types.forEach((t, k) => {
    const [sx, sy] = world.findFreeSpot(x + (k % 4) * 1.2 - 1.8, y + Math.floor(k / 4) * 1.2 - 0.6, 6, true, naval);
    const u = world.addUnit(t, p, sx, sy);
    if (u.kind === 'aircraft') u.altitude = u.ut.vtol ? 1.55 : 2.3;
    ids.push(u.id);
  });
  (world as unknown as { dirtyLists: boolean }).dirtyLists = true;
  return ids;
}

const sideOf = (world: World, faction: string) => world.players.find((p) => p.faction === faction && !p.defeated) ?? null;

/** Fresh armour for both sides, heading for the middle (keeps the battle going between AI waves). */
export function stageReinforcements(world: World) {
  const mid = { x: world.map.w / 2, y: world.map.h / 2 };
  const waves: Record<string, string[]> = { allies: ['2tnk', '2tnk', '1tnk', 'arty', 'e1', 'e1', 'e3', 'jeep'], soviet: ['3tnk', '3tnk', '4tnk', 'v2rl', 'e1', 'e1', 'e2', 'e4'] };
  for (const p of world.players) {
    if (p.defeated || combatUnits(world, p) > 26) continue;
    const base = baseOf(world, p.faction);
    if (!base) continue;
    const x = base.x + (mid.x - base.x) * 0.35, y = base.y + (mid.y - base.y) * 0.35;
    const ids = spawn(world, p, waves[p.faction] ?? waves.allies, x, y);
    world.issue({ c: 'move', player: p.id, units: ids, x: mid.x, y: mid.y, attackMove: true });
  }
}

/** An Allied raid on a Soviet Tesla Coil (returns the coil). */
export function stageTeslaRaid(world: World): Building | null {
  const coil = findStructure(world, ['tsla'], 'soviet');
  const allies = sideOf(world, 'allies');
  if (!coil || !allies) return null;
  const home = baseOf(world, 'allies') ?? { x: world.map.w / 2, y: world.map.h / 2 };
  const d = Math.hypot(home.x - coil.x, home.y - coil.y) || 1;
  const x = coil.x + ((home.x - coil.x) / d) * 9, y = coil.y + ((home.y - coil.y) / d) * 9;
  const ids = spawn(world, allies, ['2tnk', '2tnk', '1tnk', '1tnk', 'e1', 'e1', 'e1', 'e3'], x, y);
  world.issue({ c: 'attack', player: allies.id, units: ids, target: coil.id, forced: true });
  return coil;
}

/** Fleets at both ends of the sea, ordered into each other. */
export function stageNaval(world: World, sea: Sea | null): boolean {
  if (!sea) return false;
  const live = world.units.filter((u) => u.alive && u.kind === 'naval').length;
  if (live >= 6) return true;
  const a = sideOf(world, 'allies'), s = sideOf(world, 'soviet');
  if (!a || !s) return false;
  const ia = spawn(world, a, ['dd', 'ca', 'dd', 'pt'], sea.a[0], sea.a[1], true);
  const is = spawn(world, s, ['ss', 'ss', 'msub', 'ss'], sea.b[0], sea.b[1], true);
  world.issue({ c: 'move', player: a.id, units: ia, x: sea.b[0], y: sea.b[1], attackMove: true });
  world.issue({ c: 'move', player: s.id, units: is, x: sea.a[0], y: sea.a[1], attackMove: true });
  return true;
}

/** Fire a nuke from a silo at the middle of the fighting (charges it first). Returns the silo. */
export function fireNuke(world: World): { silo: Building; x: number; y: number } | null {
  const silo = findStructure(world, ['mslo'], 'soviet') ?? findStructure(world, ['mslo']);
  if (!silo || !silo.active) return null;
  const p = silo.owner;
  const enemy = world.players.find((o) => o !== p && !o.defeated);
  const enemyBase = enemy ? baseOf(world, enemy.faction) : null;
  const mid = { x: world.map.w / 2, y: world.map.h / 2 };
  // the enemy's forward army: the middle, nudged towards their side (never onto either showcase base)
  const fight = actionFocus(world, { x: mid.x, y: mid.y, r: 18 });
  let x = fight?.x ?? mid.x, y = fight?.y ?? mid.y;
  if (enemyBase) { x = lerp(x, enemyBase.x, 0.12); y = lerp(y, enemyBase.y, 0.12); }
  // charged and fired at once (an order would wait a tick, and the AI could spend the charge on its own target)
  p.superCharge.nuke = superFull(world, p, 'nuke');
  fireSuperweapon(world, p, 'nuke', x, y);
  if (!world.projectiles.some((q) => q.alive && q.special === 'nuke')) return null;
  return { silo, x, y };
}

// ---------------------------------------------------------------------------------------------
// Shots

const yawToward = (from: { x: number; y: number }, to: { x: number; y: number }) => Math.atan2(to.x - from.x, -(to.y - from.y));

export interface ProgramOptions {
  sea: Sea | null;
  /** Title cards per shot name (the trailer). */
  cards?: Partial<Record<string, TitleCard>>;
  /** Duration multiplier for every shot (default 1). */
  pace?: number;
  /** Fire the nuke every n-th loop only (the menu backdrop: every other loop); 0 = never. */
  nukeEvery?: number;
}

/** The directed program: establishing shot, Soviet base, Tesla Coil, clash, navy, Allied base, nuke, aftermath. */
export function battleProgram(o: ProgramOptions): Shot[] {
  const S = (name: string, shot: Omit<Shot, 'name' | 'card'>): Shot => ({ name, card: o.cards?.[name], ...shot });
  const k = o.pace ?? 1;
  const mid = (d: Director) => ({ x: d.world.map.w / 2, y: d.world.map.h / 2 });
  return [
    S('establish', {
      dur: 9 * k,
      begin: (d) => { stageReinforcements(d.world); const m = actionFocus(d.world) ?? mid(d); d.follow.jump(m.x, m.y); d.state.estYaw = -0.55 + Math.random() * 0.3; return true; },
      pose: (d, t) => {
        const m = d.memo('action', 0.5, () => actionFocus(d.world)) ?? mid(d);
        d.follow.to(m.x, m.y, d.dt * 0.4);
        const e = ease(t);
        return { x: d.follow.x, y: d.follow.y + lerp(6, 0, e), dist: lerp(58, 36, e), yaw: (d.state.estYaw as number) + 0.35 * t, blur: 0.12 };
      },
    }),
    S('soviet-base', {
      dur: 9 * k,
      prep: (d) => { d.state.coil = stageTeslaRaid(d.world)?.id ?? null; },
      begin: (d) => {
        const b = findStructure(d.world, ['fact', 'weap', 'stek', 'proc'], 'soviet');
        if (!b) return false;
        d.state.subject = b.id;
        d.follow.jump(b.x, b.y + 0.5);
        d.state.yaw0 = yawToward(b, mid(d)) + Math.PI + 0.5;
        return true;
      },
      pose: (d, t) => ({ x: d.follow.x, y: d.follow.y, dist: lerp(19, 15, ease(t)), yaw: (d.state.yaw0 as number) - 0.9 * t, dof: 0.38, blur: 0.15 }),
    }),
    S('tesla', {
      dur: 9 * k,
      begin: (d) => {
        const coil = (d.world.getEntity(d.state.coil as number) as Building | undefined) ?? findStructure(d.world, ['tsla'], 'soviet');
        if (!coil || !coil.alive) return false;
        d.state.coilId = coil.id;
        const foe = d.world.units.filter((u) => u.alive && u.owner !== coil.owner && Math.hypot(u.x - coil.x, u.y - coil.y) < 14);
        const f = foe.length ? { x: foe.reduce((s, u) => s + u.x, 0) / foe.length, y: foe.reduce((s, u) => s + u.y, 0) / foe.length } : mid(d);
        d.state.teslaYaw = yawToward(coil, f);
        d.state.foe = f;
        d.follow.jump(lerp(coil.x, f.x, 0.3), lerp(coil.y, f.y, 0.3));
        return true;
      },
      pose: (d, t) => {
        const coil = d.world.getEntity(d.state.coilId as number);
        const f = d.state.foe as { x: number; y: number };
        if (coil) d.follow.to(lerp(coil.x, f.x, 0.32), lerp(coil.y, f.y, 0.32), d.dt);
        return { x: d.follow.x, y: d.follow.y, dist: lerp(15, 12, ease(t)), yaw: (d.state.teslaYaw as number) - 0.35 + 0.5 * t, dof: 0.32, blur: 0.18 };
      },
    }),
    S('clash', {
      dur: 10 * k,
      prep: (d) => { stageNaval(d.world, o.sea); },
      begin: (d) => { const a = actionFocus(d.world); if (!a) return false; d.follow.jump(a.x, a.y); d.state.clashYaw = (Math.random() - 0.5) * 1.2; return true; },
      pose: orbitWith((d) => d.memo('action', 0.5, () => actionFocus(d.world)), { dist: 22, dist2: 16, yawKey: 'clashYaw', sweep: 0.45, dof: 0.3, blur: 0.3 }),
    }),
    S('naval', {
      dur: 9 * k,
      begin: (d) => { const f = fleetFocus(d.world); if (!f || f.n < 2) return false; d.follow.jump(f.x, f.y); d.state.navYaw = o.sea ? yawToward({ x: o.sea.a[0], y: o.sea.a[1] }, { x: o.sea.b[0], y: o.sea.b[1] }) + Math.PI / 2 : 0.4; return true; },
      pose: orbitWith((d) => d.memo('fleet', 0.3, () => fleetFocus(d.world)), { dist: 24, dist2: 18, yawKey: 'navYaw', sweep: -0.4, dof: 0.25, blur: 0.2 }),
    }),
    S('allied-base', {
      dur: 8 * k,
      begin: (d) => {
        const b = findStructure(d.world, ['fact', 'weap', 'atek', 'proc'], 'allies');
        if (!b) return false;
        const m = mid(d);
        const across = yawToward(b, m) + Math.PI / 2;
        d.state.ab = { x: b.x, y: b.y, ax: Math.sin(across), ay: -Math.cos(across), yaw: yawToward(b, m) + Math.PI + 0.35 };
        return true;
      },
      pose: (_d, t) => {
        const a = _d.state.ab as { x: number; y: number; ax: number; ay: number; yaw: number };
        const s = lerp(-5, 5, ease(t));
        return { x: a.x + a.ax * s, y: a.y + a.ay * s, dist: 17, yaw: a.yaw, dof: 0.4, blur: 0.15 };
      },
    }),
    S('nuke-launch', {
      dur: 3.4 * k,
      begin: (d) => {
        d.state.nukeAt = null;
        const every = o.nukeEvery ?? 1;
        if (every <= 0 || d.loops % every !== 0) return false;
        const silo = findStructure(d.world, ['mslo'], 'soviet') ?? findStructure(d.world, ['mslo']);
        if (!silo || !silo.active) return false;
        d.state.silo = silo.id;
        d.state.fired = false;
        d.state.nukeYaw = yawToward(silo, mid(d)) + Math.PI - 0.6;
        d.follow.jump(silo.x, silo.y);
        return true;
      },
      tick: (d, time) => {
        if (d.state.fired || time < 0.7) return;
        d.state.fired = true;
        const shot = fireNuke(d.world);
        d.state.nukeAt = shot ? { x: shot.x, y: shot.y } : null;
      },
      pose: (d, t) => ({ x: d.follow.x, y: d.follow.y, dist: lerp(13, 15, t), yaw: d.state.nukeYaw as number, dof: 0.3, blur: 0.25 }),
    }),
    S('nuke-impact', {
      dur: 9.5 * k,
      begin: (d) => {
        const at = (d.state.nukeAt as { x: number; y: number } | null) ?? (nukeInFlight(d.world) ? { x: nukeInFlight(d.world)!.tx, y: nukeInFlight(d.world)!.ty } : null);
        if (!at) return false;
        d.state.impactAt = null;
        d.follow.jump(at.x, at.y);
        d.state.impactYaw = (Math.random() - 0.5) * 0.8;
        return true;
      },
      tick: (d, time) => { if (d.state.impactAt == null && !nukeInFlight(d.world)) d.state.impactAt = time; },
      pose: (d, _t, time) => {
        const hit = d.state.impactAt as number | null;
        const after = hit == null ? 0 : time - hit;
        const e = ease(after / 4);
        return { x: d.follow.x, y: d.follow.y, dist: hit == null ? lerp(30, 26, ease(time / 5)) : lerp(26, 40, e), yaw: (d.state.impactYaw as number) + 0.12 * e, dof: hit == null ? 0.2 : 0.1, blur: 0.25 };
      },
      // slow motion through the blast
      speed: (d, _t, time) => { const hit = d.state.impactAt as number | null; return hit != null && time - hit < 3.2 ? 0.35 : 1; },
    }),
    S('aftermath', {
      dur: 8 * k,
      begin: (d) => { const a = actionFocus(d.world) ?? mid(d); d.follow.jump(a.x, a.y); d.state.aftYaw = (Math.random() - 0.5) * 1.4; return true; },
      pose: orbitWith((d) => d.memo('action', 0.5, () => actionFocus(d.world)), { dist: 30, dist2: 24, yawKey: 'aftYaw', sweep: 0.5, blur: 0.2 }),
    }),
  ];
}

/** Orbit a moving subject from a yaw stored in state. */
function orbitWith(subject: (d: Director) => { x: number; y: number } | null, o: { dist: number; dist2: number; yawKey: string; sweep: number; dof?: number; blur?: number }) {
  return (d: Director, t: number) => {
    const s = subject(d);
    if (s) d.follow.to(s.x, s.y, d.dt);
    const yaw = d.state[o.yawKey] as number;
    return { x: d.follow.x, y: d.follow.y, dist: lerp(o.dist, o.dist2, ease(t)), yaw: yaw + o.sweep * t, dof: o.dof, blur: o.blur };
  };
}

// ---------------------------------------------------------------------------------------------
// The menu backdrop

export interface AttractOptions {
  /** Create the demo Game for a setup (main.ts: `new Game(setup, audio, …)`). */
  makeGame(setup: GameSetup): Game;
  quality: Quality;
  /** Rebuild the backdrop (called after a few loops, or when one side has been wiped out). */
  rebuild(): void;
  /** Loops before a fresh battlefield (default 3). */
  loops?: number;
  /** Fixed time of day / climate (URL ?tod= / ?climate=, for screenshots); random otherwise. */
  tod?: string | null;
  climate?: string | null;
}

/** The demo setup for a directed battlefield (`seed` from pickBattlefield). */
export function attractSetup(seed: number, quality: Quality, rand: () => number = Math.random): GameSetup {
  const tods: TimeOfDay[] = ['day', 'dusk', 'day', 'night'];
  const climates = ['temperate', 'winter', 'temperate'];
  return {
    faction: 'allies', color: 0x3d7be0, opponents: [{ faction: 'soviet', difficulty: 'hard' }], mapSize: SIZE, water: WATER, trees: 0.6, ore: 0.8,
    credits: 10000, startUnits: 'heavy', fog: false, timeOfDay: tods[Math.floor(rand() * tods.length)], quality, seed, demo: true,
    climate: climates[Math.floor(rand() * climates.length)], weather: 'clear', dayCycle: false,
  };
}

/** Build the battle: developed bases, armies charging the middle, superweapons discharged (the director fires the nuke). */
export function stageBattle(game: Game): void {
  game.applyScenario('battle');
  const w = game.world;
  for (const p of w.players) { p.superCharge.nuke = 0; p.superCharge.ironcurtain = 0; p.superCharge.chrono = 0; }
  chargeArmies(w);
  game.fastForward(2);
}

/** Create the directed menu backdrop. Throws if the game cannot be created (the caller falls back). */
export function createAttractGame(o: AttractOptions): Game {
  const { seed, sea } = pickBattlefield();
  const setup = attractSetup(seed, o.quality);
  if (o.tod === 'day' || o.tod === 'dusk' || o.tod === 'night') setup.timeOfDay = o.tod;
  if (o.climate === 'temperate' || o.climate === 'winter' || o.climate === 'desert') setup.climate = o.climate;
  const game = o.makeGame(setup);
  try {
    stageBattle(game);
  } catch (e) {
    game.dispose();
    throw e;
  }
  const loops = o.loops ?? 3;
  let rebuilt = false;
  // never inside the game's own frame (the director runs there): on the next task
  const rebuild = () => { if (rebuilt) return; rebuilt = true; setTimeout(() => o.rebuild(), 0); };
  // reduced motion: no nuclear flash, no lens effects behind the menu
  const calm = typeof document !== 'undefined' && (document.body.classList.contains('reduce-motion') || !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  game.cameraDirector = new Director(game, battleProgram({ sea, nukeEvery: calm ? 0 : 2 }), {
    loop: true, lens: !calm,
    // wide shots draw more of the map: Low stays as close as the old backdrop drift (24-28), High tops out at 46
    maxDist: o.quality === 'low' ? 26 : o.quality === 'medium' ? 40 : 46,
    onProgramEnd: (n) => { if (n >= loops) rebuild(); },
    onShot: () => { if (game.world.gameOver || game.world.players.some((p) => p.defeated)) rebuild(); },
  });
  return game;
}
