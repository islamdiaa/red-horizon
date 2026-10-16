/**
 * Built-in challenges: scripted setups that seed the Challenges list (no replay needed). Each one is a
 * normal skirmish setup (fixed seed) whose script clears the starting kit and builds the stage on the
 * fresh world, plus optional scripted pressure every tick. Deterministic: world.rng / fixed data only.
 */
import type { MissionRuntime, Pt } from '../sim/mission';
import type { Building, Unit } from '../sim/entities';
import { TICK_HZ } from '../sim/types';
import type { ChallengeDef } from './types';
import { findHill } from './koth';

export interface BuiltinChallenge {
  def: ChallengeDef;
  /** Build the stage on a fresh world; returns goal targets / zone. */
  script(m: MissionRuntime): { targets?: number[]; zone?: { x: number; y: number; r: number } };
  /** Scripted pressure while the challenge runs. */
  update?(m: MissionRuntime): void;
}

const BLUE = 0x3d7be0;
const pxy = (p: Pt): [number, number] => (Array.isArray(p) ? p : [p.x, p.y]);

/** Seconds since the challenge started. */
function elapsed(m: MissionRuntime): number {
  return (m.world.tick - (m.flags.ch?.t0 ?? 0)) / TICK_HZ;
}

/** Remove the starting kit (MCVs, squads) without counting losses. */
function clearStart(m: MissionRuntime) {
  for (const u of [...m.world.units]) m.remove(u);
}

/** Structures around a point: each one at the free spot nearest to its offset (cells, toward the enemy = +x). */
function base(m: MissionRuntime, p: number, at: Pt, toward: Pt, list: [string, number, number][]): Building[] {
  const [ax, ay] = pxy(at), [tx, ty] = pxy(toward);
  const l = Math.hypot(tx - ax, ty - ay) || 1;
  const fx = (tx - ax) / l, fy = (ty - ay) / l;
  const out: Building[] = [];
  for (const [type, fwd, side] of list) {
    const x = ax + fx * fwd - fy * side, y = ay + fy * fwd + fx * side;
    const b = m.placeNear(p, type, x, y);
    if (b) out.push(b);
  }
  return out;
}

function group(m: MissionRuntime, p: number, types: string[], at: Pt, face: Pt): Unit[] {
  const [x, y] = pxy(at), [fx, fy] = pxy(face);
  return m.spawnGroup(p, types, x, y, Math.atan2(fy - y, fx - x));
}

const rep = (t: string, n: number) => Array.from({ length: n }, () => t);

/** Living, armed units of a player that are standing around. */
function idleArmy(m: MissionRuntime, p: number): Unit[] {
  return m.units(p).filter((u) => u.weapons.length && !u.ut.harvester && u.order.type === 'idle' && !u.target);
}

function nearestOf(list: { x: number; y: number; alive: boolean }[], x: number, y: number) {
  let best: { x: number; y: number } | null = null, bd = Infinity;
  for (const e of list) {
    if (!e.alive) continue;
    const d = Math.hypot(e.x - x, e.y - y);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

const def = (d: Omit<ChallengeDef, 'v' | 'createdAt' | 'gameVersion' | 'source'>): ChallengeDef => ({ v: 1, createdAt: 0, gameVersion: 'builtin', source: { kind: 'builtin' }, ...d });

// -----------------------------------------------------------------------------------------------
const lastBastion: BuiltinChallenge = {
  def: def({
    id: 'b-last-bastion', builtin: 'b-last-bastion', title: 'Last Bastion',
    description: 'A Soviet tank army is rolling on the last Allied base in the pass. Keep the Construction Yard standing for five minutes.',
    setup: { faction: 'allies', color: BLUE, opponents: [{ faction: 'soviet', difficulty: 'hard' }], mapSize: 64, water: 0.15, trees: 0.4, ore: 0.5, credits: 3000,
      startUnits: 'mcv', fog: true, timeOfDay: 'dusk', seed: 40404, climate: 'winter', weather: 'snow', dayCycle: false },
    side: 0, ai: 'hard', goal: { kind: 'protect', label: 'Keep your Construction Yard standing for 5:00' }, timeLimit: 300, par: { losses: 10 },
  }),
  script(m) {
    clearStart(m);
    const s0 = m.start(0), s1 = m.start(1);
    const yard = base(m, 0, s0, s1, [['fact', 0, 0], ['powr', -4, -3], ['powr', -4, 2], ['proc', -1, 5], ['tent', 3, -4], ['weap', 1, -7], ['dome', -5, 6]]);
    base(m, 0, s0, s1, [['pbox', 7, -3], ['pbox', 7, 3], ['gun', 8, -6], ['gun', 8, 0], ['gun', 8, 6]]);
    group(m, 0, [...rep('2tnk', 3), '1tnk', ...rep('e1', 6), ...rep('e3', 3)], m.toward(s0, s1, 5), s1);
    base(m, 1, s1, s0, [['fact', 0, 0], ['powr', -4, -3], ['powr', -4, 2], ['powr', -6, 0], ['proc', -1, 6], ['barr', 3, -4], ['weap', 1, -7], ['dome', -5, 6], ['tsla', 6, 0]]);
    const first = group(m, 1, [...rep('3tnk', 4), 'v2rl', ...rep('e1', 6), ...rep('e2', 2)], m.toward(s1, s0, 12), s0);
    m.move(first, yard[0].x, yard[0].y, true);
    m.flags.bWave = 0;
    return { targets: yard[0] ? [yard[0].id] : [] };
  },
  update(m) {
    const t = elapsed(m);
    const waves: [number, string[]][] = [
      [70, [...rep('3tnk', 3), ...rep('e1', 4), ...rep('e2', 2)]],
      [140, [...rep('3tnk', 3), '4tnk', 'v2rl', ...rep('e1', 4)]],
      [210, [...rep('4tnk', 2), ...rep('3tnk', 3), ...rep('e1', 6), 'e4', 'e4']],
    ];
    const n = m.flags.bWave ?? 0;
    if (n < waves.length && t >= waves[n][0]) {
      m.flags.bWave = n + 1;
      const s0 = m.start(0), s1 = m.start(1);
      const yard = m.buildings(m.humanId, 'fact')[0];
      const to = yard ? [yard.x, yard.y] : [s0.x, s0.y];
      m.reinforce(1, waves[n][1], m.toward(s1, s0, 8, n % 2 ? 5 : -5), [to[0], to[1]]);
      m.say('Intelligence', `Soviet wave ${n + 2} of 4 is on its way!`, 'intel');
    }
    if (m.world.tick % (TICK_HZ * 6) === 3) {
      const yard = m.buildings(m.humanId, 'fact')[0];
      const idle = idleArmy(m, 1).filter((u) => Math.hypot(u.x - m.start(1).x, u.y - m.start(1).y) > 10);
      if (yard && idle.length) m.move(idle, yard.x, yard.y, true);
    }
  },
};

// -----------------------------------------------------------------------------------------------
const armouredClash: BuiltinChallenge = {
  def: def({
    id: 'b-armoured-clash', builtin: 'b-armoured-clash', title: 'Armoured Clash',
    description: 'Two tank columns meet in the open desert. No base, no reinforcements: destroy the Soviet column within four minutes.',
    setup: { faction: 'allies', color: BLUE, opponents: [{ faction: 'soviet', difficulty: 'hard' }], mapSize: 64, water: 0, trees: 0.25, ore: 0.3, credits: 0,
      startUnits: 'mcv', fog: false, timeOfDay: 'day', seed: 77012, climate: 'desert', weather: 'clear', dayCycle: false },
    side: 0, ai: 'hard', goal: { kind: 'win', label: 'Destroy the Soviet column within 4:00' }, timeLimit: 240, par: { time: 150 },
  }),
  script(m) {
    clearStart(m);
    const s0 = m.start(0), s1 = m.start(1);
    const a = m.between(s0, s1, 0.33), b = m.between(s0, s1, 0.67);
    group(m, 0, [...rep('2tnk', 5), 'arty', 'arty', 'jeep', 'jeep', ...rep('e3', 4)], a, b);
    const foe = group(m, 1, [...rep('3tnk', 4), '4tnk', 'v2rl', 'v2rl', ...rep('e1', 4)], b, a);
    m.move(foe, a[0], a[1], true);
    return {};
  },
  update(m) {
    if (m.world.tick % (TICK_HZ * 5) !== 4) return;
    const mine = m.units(m.humanId);
    for (const u of idleArmy(m, 1)) {
      const t = nearestOf(mine, u.x, u.y);
      if (t) m.move([u], t.x, t.y, true);
    }
  },
};

// -----------------------------------------------------------------------------------------------
const decapitation: BuiltinChallenge = {
  def: def({
    id: 'b-decapitation', builtin: 'b-decapitation', title: 'Decapitation',
    description: 'Tanya and a light strike group are behind the lines. Blow up the Soviet Construction Yard before the garrison regroups: six minutes.',
    setup: { faction: 'allies', color: BLUE, opponents: [{ faction: 'soviet', difficulty: 'normal' }], mapSize: 64, water: 0.3, trees: 0.55, ore: 0.5, credits: 0,
      startUnits: 'mcv', fog: true, timeOfDay: 'night', seed: 91919, climate: 'temperate', weather: 'clear', dayCycle: false },
    side: 0, ai: 'normal', goal: { kind: 'destroy', label: 'Destroy the Soviet Construction Yard within 6:00' }, timeLimit: 360, par: { time: 200 },
  }),
  script(m) {
    clearStart(m);
    const s0 = m.start(0), s1 = m.start(1);
    const blds = base(m, 1, s1, s0, [['fact', 0, 0], ['powr', -4, -3], ['powr', -4, 2], ['proc', -1, 6], ['barr', 3, -4], ['kenn', 4, 3], ['tsla', 6, -3], ['tsla', 6, 3], ['ftur', 5, 0], ['sam', -2, -6]]);
    group(m, 1, [...rep('e1', 5), 'e2', 'e2', 'dog', 'dog', '3tnk', '3tnk'], m.toward(s1, s0, 4), s0);
    group(m, 0, ['e7', ...rep('1tnk', 4), 'jeep', 'jeep', ...rep('e1', 4), 'e3', 'e3', 'medi'], m.between(s0, s1, 0.42), s1);
    m.setAI(1, 'defensive');
    const yard = blds.find((b) => b.bt.id === 'fact');
    return { targets: yard ? [yard.id] : [] };
  },
};

// -----------------------------------------------------------------------------------------------
const crossroads: BuiltinChallenge = {
  def: def({
    id: 'b-crossroads', builtin: 'b-crossroads', title: 'Crossroads',
    description: 'The Soviets hold the crossroads. Take it and keep it clear of enemy units for two minutes; counter-attacks come every minute.',
    setup: { faction: 'allies', color: BLUE, opponents: [{ faction: 'soviet', difficulty: 'hard' }], mapSize: 64, water: 0.3, trees: 0.45, ore: 0.6, credits: 2000,
      startUnits: 'mcv', fog: true, timeOfDay: 'day', seed: 24680, climate: 'temperate', weather: 'clear', dayCycle: false },
    side: 0, ai: 'hard', goal: { kind: 'hold', seconds: 120, label: 'Hold the crossroads for 2:00 within 6:00' }, timeLimit: 360, par: { time: 220 },
  }),
  script(m) {
    clearStart(m);
    const s0 = m.start(0), s1 = m.start(1);
    const hill = findHill(m.world);
    const zone = { x: hill.x, y: hill.y, r: 5 };
    base(m, 0, s0, zone, [['fact', 0, 0], ['powr', -4, -3], ['tent', 3, -4], ['proc', -1, 5]]);
    group(m, 0, [...rep('2tnk', 4), '1tnk', '1tnk', 'arty', 'arty', ...rep('e1', 6), ...rep('e3', 4)], m.toward(s0, zone, 8), zone);
    base(m, 1, s1, zone, [['fact', 0, 0], ['powr', -4, -3], ['powr', -4, 2], ['barr', 3, -4], ['weap', 1, -7], ['proc', -1, 6]]);
    group(m, 1, [...rep('3tnk', 3), ...rep('e1', 6), 'e2', 'e2'], [zone.x, zone.y], s0);
    m.flags.bWave = 0;
    return { zone };
  },
  update(m) {
    const t = elapsed(m);
    const n = m.flags.bWave ?? 0;
    if (n < 6 && t >= 45 + n * 60) {
      m.flags.bWave = n + 1;
      const zone = m.flags.ch?.zone as { x: number; y: number } | undefined;
      if (!zone) return;
      const types = [...rep('3tnk', 2 + Math.floor(n / 2)), ...rep('e1', 4 + n), ...(n >= 2 ? ['v2rl'] : []), ...(n >= 4 ? ['4tnk'] : [])];
      m.reinforce(1, types, m.toward(m.start(1), zone, 6, n % 2 ? 4 : -4), [zone.x, zone.y]);
      m.say('Intelligence', `Soviet counter-attack inbound to the crossroads!`, 'intel');
    }
  },
};

export const BUILTINS: Record<string, BuiltinChallenge> = Object.fromEntries([lastBastion, armouredClash, decapitation, crossroads].map((b) => [b.def.id, b]));
export const BUILTIN_LIST: ChallengeDef[] = Object.values(BUILTINS).map((b) => b.def);
